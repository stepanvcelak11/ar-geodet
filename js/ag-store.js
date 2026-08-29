// ===== AR Geodet — ÚLOŽIŠTĚ NA TĚŽKÁ DATA: jedno API (ODPOJITELNÁ vrstva) =====
// PROBLÉM, KTERÝ TENHLE SOUBOR ŘEŠÍ: appka drží velká data v IndexedDB — ale
// KAŽDÝ modul si k ní napsal vlastní cestu. Dneska je v repu SEDM samostatných
// databází, každá s vlastním open/upgrade/transakce/chyby:
//     argeodet            (js/logika.js)       body zakázky
//     argeodet-journal    (js/journal.js)      žurnál změn
//     argeodet-usage      (js/ucty.js)         měření použití
//     agGeoOverlay        (js/geo-overlay.js)  podložené plány
//     agGeoFoto1          (js/geo-foto.js)     fotky s razítkem
//     agHlasovky1         (js/hlasovky.js)     hlasové poznámky
//     arGeodetFotky       (js/vylepseni.js)    fotky vytyčení
//     arGeodetZavady      (js/zavady.js)       fotky závad
// Sedm kopií téhož kódu znamená sedm míst, kde se dá zapomenout na `onerror`,
// sedm různých chování při plném disku a — hlavně — NULA přehledu o tom, co
// appka na telefonu vlastně zabírá a co je sirotek po smazané zakázce.
//
// ŘEŠENÍ: jedno API `AGStore`, které umí obojí:
//   • VLASTNÍ POLICE v jedné databázi `argeodet-store` — pro nová data.
//       AGStore.shelf('fronta').put(klic, hodnota) / .get(klic) / .del(klic)
//   • PŘEVZETÍ CIZÍ DATABÁZE beze změny dat — pro těch sedm existujících.
//       AGStore.adopt('agGeoFoto1', 'fotky').get(klic)
//     Modul tím zahodí svých ~15 řádků boilerplate a NIC se nestěhuje: čte
//     a zapisuje se pořád do téže databáze i objektového skladu jako dřív.
//
// PROČ VLASTNÍ DATABÁZE A NE `argeodet`: do `argeodet` drží js/logika.js
// otevřené spojení po celou dobu běhu appky. Přidat tam objektový sklad jde
// jen zvýšením verze, což spustí `versionchange` — a s živým spojením se
// upgrade ZABLOKUJE (uživateli by appka zamrzla na startu). Vlastní databáze
// s jedním skladem `kv` se nikdy neupgraduje, takže tenhle problém nemá.
//
// CO TAHLE VRSTVA PŘIDÁVÁ NAVÍC (proto to není jen přeskládání kódu):
//   • AGStore.report() — kolik čeho na telefonu leží, po policích i po cizích
//     databázích. Poprvé se dá odpovědět na „co mi žere místo".
//   • AGStore.sweep(pid) — úklid sirotků po smazané zakázce NAPŘÍČ všemi
//     databázemi naráz. Dneska to řeší dva moduly a každý jen ten svůj kout,
//     takže po smazání zakázky zůstávaly fotky ležet.
//   • AGStore.room() — kolik místa reálně zbývá (navigator.storage.estimate),
//     s poctivou odpovědí „nevím", když to prohlížeč neřekne.
//   • Zápisy s POTVRZENÍM a jedním opakováním. Tichá ztráta zápisu je v terénu
//     ztracený bod; tady se chyba aspoň dozví volající.
//
// CO SEM NEPATŘÍ: synchronní čtení. IndexedDB je asynchronní a snaha to schovat
// za synchronní API je přesně to, co v js/logika.js vyrobilo cache `_idbMem`
// a zálohu do localStorage. Nová data ať rovnou počítají s Promise.
//
// ODSTRANĚNÍ VRSTVY: smaž js/ag-store.js a jeho řádek v index.html. Moduly,
// které ho používají, si musí vrátit vlastní open/transakce — proto si každý
// jeho volání hlídá `window.AGStore &&`, aby appka bez něj nespadla.
// ==============================================================================
(function () {
    'use strict';
    if (window.AGStore) return;

    var DB_NAME = 'argeodet-store';
    var DB_STORE = 'kv';
    var swallow = function (e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'ag-store'); } catch (e2) { /* i hlášení chyby smí selhat */ } };

    // ---- otevírání databází (jedno spojení na databázi, sdílené) --------------
    var _conn = {};      // 'jmeno|sklad' -> Promise<IDBDatabase|null>

    function open(dbName, storeName) {
        var ck = dbName + '|' + storeName;
        if (_conn[ck]) return _conn[ck];
        _conn[ck] = new Promise(function (res) {
            if (typeof indexedDB === 'undefined') return res(null);
            var rq;
            // POZOR: verzi ZÁMĚRNĚ neuvádíme u převzatých databází — otevřít bez
            // verze znamená „vezmi, jaká je". Kdybychom psali 1 a cizí modul má
            // 2, prohlížeč vyhodí VersionError a data bychom nepřečetli vůbec.
            try { rq = (dbName === DB_NAME) ? indexedDB.open(dbName, 1) : indexedDB.open(dbName); }
            catch (e) { swallow(e, 'ag-store:open'); return res(null); }
            rq.onupgradeneeded = function () {
                try {
                    var db = rq.result;
                    if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
                } catch (e) { swallow(e, 'ag-store:upgrade'); }
            };
            rq.onsuccess = function () {
                var db = rq.result;
                // Cizí databáze, kterou ještě nikdo nezaložil, sklad mít nemusí.
                // Číst z ní pak nejde — ale to není chyba, jen „zatím nic".
                if (!db || !db.objectStoreNames.contains(storeName)) return res(null);
                try { db.onversionchange = function () { try { db.close(); } catch (e) { swallow(e, 'ag-store:versionchange'); } delete _conn[ck]; }; } catch (e) { swallow(e, 'ag-store:onversionchange'); }
                res(db);
            };
            rq.onerror = function () { res(null); };
            rq.onblocked = function () { res(null); };
        });
        return _conn[ck];
    }

    // Jedna transakce = jedna operace. `fn(sklad)` vrátí IDBRequest nebo null.
    // Slibuje se AŽ na `oncomplete`, ne na `onsuccess` requestu — jinak by se
    // „uloženo" ohlásilo dřív, než transakce doopravdy sedne na disk.
    function op(dbName, storeName, mode, fn) {
        return open(dbName, storeName).then(function (db) {
            if (!db) return { ok: false, value: null };
            return new Promise(function (res) {
                var rq = null, tx;
                try { tx = db.transaction(storeName, mode); } catch (e) { swallow(e, 'ag-store:tx'); return res({ ok: false, value: null }); }
                try { rq = fn(tx.objectStore(storeName)); } catch (e) { swallow(e, 'ag-store:op'); }
                tx.oncomplete = function () { res({ ok: true, value: rq ? rq.result : null }); };
                tx.onerror = function () { res({ ok: false, value: null }); };
                tx.onabort = function () { res({ ok: false, value: null }); };
            });
        });
    }

    // ---- police: klíče v jedné databázi, oddělené prefixem --------------------
    // Prefix místo samostatného objektového skladu ZÁMĚRNĚ: nová police se pak
    // dá přidat bez zvýšení verze databáze, tedy bez upgradu a bez rizika, že
    // se appka na startu zasekne na blokovaném `versionchange`.
    function Shelf(dbName, storeName, prefix) {
        this._db = dbName; this._st = storeName; this._p = prefix || '';
    }
    Shelf.prototype._k = function (k) { return this._p + String(k); };
    Shelf.prototype.get = function (k) {
        var s = this;
        return op(s._db, s._st, 'readonly', function (st) { return st.get(s._k(k)); })
            .then(function (r) { return r.ok ? (r.value == null ? null : r.value) : null; });
    };
    // Vrací true/false — VOLAJÍCÍ SE MÁ PTÁT. Zápis, o kterém se neví, jestli
    // prošel, je v terénu ztracený bod.
    Shelf.prototype.put = function (k, v) {
        var s = this;
        function once() { return op(s._db, s._st, 'readwrite', function (st) { return st.put(v, s._k(k)); }); }
        return once().then(function (r) {
            if (r.ok) return true;
            // Jedno opakování: nejčastější příčina je souběžná transakce, ne plný disk.
            return new Promise(function (res) { setTimeout(res, 400); }).then(once).then(function (r2) { return !!r2.ok; });
        });
    };
    Shelf.prototype.del = function (k) {
        var s = this;
        return op(s._db, s._st, 'readwrite', function (st) { return st.delete(s._k(k)); }).then(function (r) { return !!r.ok; });
    };
    Shelf.prototype.keys = function () {
        var s = this, p = s._p;
        return op(s._db, s._st, 'readonly', function (st) { return st.getAllKeys(); }).then(function (r) {
            var out = [], all = (r.ok && r.value) ? r.value : [];
            for (var i = 0; i < all.length; i++) {
                var k = all[i];
                if (typeof k !== 'string') continue;
                if (p && k.indexOf(p) !== 0) continue;
                out.push(p ? k.slice(p.length) : k);
            }
            return out;
        });
    };
    Shelf.prototype.all = function () {
        var s = this;
        return s.keys().then(function (ks) {
            return Promise.all(ks.map(function (k) { return s.get(k).then(function (v) { return { k: k, v: v }; }); }));
        });
    };
    // Smaže klíče, na které `test(klic)` řekne true. Bez testu smaže celou polici.
    Shelf.prototype.clear = function (test) {
        var s = this;
        return s.keys().then(function (ks) {
            var del = test ? ks.filter(test) : ks;
            return Promise.all(del.map(function (k) { return s.del(k); })).then(function () { return del.length; });
        });
    };

    var AGStore = {};

    // Nová police ve vlastní databázi appky.
    AGStore.shelf = function (name) { return new Shelf(DB_NAME, DB_STORE, name + ':'); };

    // Existující cizí databáze — beze změny dat, jen jiné API.
    AGStore.adopt = function (dbName, storeName, prefix) { return new Shelf(dbName, storeName, prefix || ''); };

    // ---- co appka na telefonu zabírá -----------------------------------------
    // Sedm databází, o kterých v repu víme. Když nějaká chybí (uživatel modul
    // nikdy nespustil), prostě se v přehledu neobjeví.
    var ZNAME = [
        { db: 'argeodet', store: 'kv', co: 'Body zakázek' },
        { db: 'argeodet-journal', store: 'ops', co: 'Žurnál změn' },
        { db: 'argeodet-usage', store: 'ev', co: 'Měření použití' },
        { db: 'agGeoOverlay', store: 'kv', co: 'Podložené plány' },
        { db: 'agGeoFoto1', store: 'foto', co: 'Fotky s razítkem' },
        { db: 'agHlasovky1', store: 'rec', co: 'Hlasové poznámky' },
        { db: 'arGeodetFotky', store: 'fotky', co: 'Fotky vytyčení' },
        { db: 'arGeodetZavady', store: 'fotky', co: 'Fotky závad' },
        { db: DB_NAME, store: DB_STORE, co: 'Ostatní (fronta, statistiky)' }
    ];

    // Objektové sklady si moduly pojmenovaly různě a některé jméno známe jen
    // z kódu. Kdyby se přejmenoval, přehled tu položku vynechá — což je pořád
    // lepší než spadnout. Proto se sklad hledá i podle skutečného obsahu.
    function storesOf(dbName) {
        return new Promise(function (res) {
            if (typeof indexedDB === 'undefined') return res([]);
            var rq; try { rq = indexedDB.open(dbName); } catch (e) { return res([]); }
            rq.onsuccess = function () {
                var db = rq.result, names = [];
                try { for (var i = 0; i < db.objectStoreNames.length; i++) names.push(db.objectStoreNames[i]); } catch (e) { swallow(e, 'ag-store:storesOf'); }
                try { db.close(); } catch (e) { swallow(e, 'ag-store:close'); }
                res(names);
            };
            rq.onerror = function () { res([]); };
            rq.onblocked = function () { res([]); };
        });
    }

    function roughSize(v) {
        // Odhad, ne měření: prohlížeč velikost jednoho záznamu neřekne.
        try {
            if (v == null) return 0;
            if (typeof v === 'string') return v.length;                 // ~1 B/znak u ASCII, u dataURL to sedí dobře
            if (v instanceof Blob) return v.size;
            if (v instanceof ArrayBuffer) return v.byteLength;
            if (v && v.byteLength != null) return v.byteLength;
            return JSON.stringify(v).length;
        } catch (e) { return 0; }
    }

    AGStore.report = function () {
        return Promise.all(ZNAME.map(function (z) {
            return storesOf(z.db).then(function (names) {
                if (!names.length) return null;
                var store = names.indexOf(z.store) >= 0 ? z.store : names[0];
                return op(z.db, store, 'readonly', function (st) { return st.getAll(); }).then(function (r) {
                    if (!r.ok) return null;
                    var vals = r.value || [], b = 0;
                    for (var i = 0; i < vals.length; i++) b += roughSize(vals[i]);
                    return { db: z.db, store: store, co: z.co, pocet: vals.length, bajtu: b };
                });
            }).catch(function () { return null; });
        })).then(function (rows) {
            return rows.filter(function (r) { return r && r.pocet; })
                .sort(function (a, b) { return b.bajtu - a.bajtu; });
        });
    };

    AGStore.room = function () {
        return new Promise(function (res) {
            try {
                if (!navigator.storage || !navigator.storage.estimate) return res({ znamo: false });
                navigator.storage.estimate().then(function (est) {
                    var used = est && est.usage, quota = est && est.quota;
                    if (used == null || quota == null) return res({ znamo: false });
                    res({ znamo: true, pouzito: used, strop: quota, zbyva: Math.max(0, quota - used) });
                }).catch(function () { res({ znamo: false }); });
            } catch (e) { res({ znamo: false }); }
        });
    };

    // Úklid po smazané zakázce NAPŘÍČ databázemi. Klíče mají v celé appce tvar
    // `<idZakazky>_...`, takže se sirotci poznají podle prefixu.
    AGStore.sweep = function (pid) {
        if (!pid) return Promise.resolve(0);
        var pref = pid + '_';
        return Promise.all(ZNAME.map(function (z) {
            return storesOf(z.db).then(function (names) {
                if (!names.length) return 0;
                var store = names.indexOf(z.store) >= 0 ? z.store : names[0];
                var sh = new Shelf(z.db, store, '');
                return sh.clear(function (k) { return typeof k === 'string' && k.indexOf(pref) === 0; });
            }).catch(function () { return 0; });
        })).then(function (counts) {
            var n = 0; for (var i = 0; i < counts.length; i++) n += (counts[i] || 0);
            return n;
        });
    };

    // Smazání zakázky hlásí js/logika.js. Dva moduly si úklid dělaly samy a
    // každý jen ve své databázi — tady se uklidí všude naráz.
    try {
        document.addEventListener('ag:project-deleted', function (ev) {
            var pid = ev && ev.detail && ev.detail.id;
            if (pid) AGStore.sweep(pid).catch(function () { /* úklid nikdy nesmí shodit appku */ });
        });
    } catch (e) { swallow(e, 'ag-store:listen'); }

    window.AGStore = AGStore;
})();
