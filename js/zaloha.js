// ===== AR Geodet - ZALOHA / OBNOVA VSECH DAT =====
// Export/import KOMPLETNIHO stavu appky (vsechny zakazky + nastaveni) do jednoho souboru.
// Pojistka proti tomu, ze localStorage tise spadne/vycisti se. Cte/zapisuje primo
// localStorage, nezavisle na ostatnich modulech. Po obnove se appka znovu nacte (reload).

(function () {
    'use strict';

    function _dl(filename, text) {
        const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // DALSI IndexedDB databaze modulu — DRIVE v zaloze NEBYLY (zurnal, rastr podkladu,
    // fotky vytyceni se "uplnou" zalohou tise ztracely). Hodnoty jsou JSON-safe
    // (dataURL retezce / plain objekty). argeodet-usage ZAMERNE chybi: telemetrie
    // ma vlastni sync do cloudu, do zalohy dat nepatri.
    const EXTRA_DBS = {
        'argeodet-journal': { store: 'ops', schema: function (db) { var os = db.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true }); os.createIndex('proj', 'proj', { unique: false }); os.createIndex('pt', ['proj', 'id'], { unique: false }); } },
        'agGeoOverlay': { store: 'kv', schema: function (db) { db.createObjectStore('kv'); } },
        'arGeodetFotky': { store: 'fotky', schema: function (db) { db.createObjectStore('fotky'); } },
        // Tyhle tri chybely a "Stahnout zalohu (vse)" se pritom tvarila kompletni.
        // Cely obsah techhle modulu lezi VYHRADNE v IndexedDB (v localStorage maji
        // jen par prepinacu), takze po obnove na novem telefonu byly geo-fotky,
        // hlasovky i fotky zavad nenavratne pryc — a u zavad zbyl seznam s mrtvymi
        // odkazy na fotky. Presne ten scenar, kvuli kteremu js/auto-zaloha.js
        // zalohu pripomina (iOS smaze uloziste PWA po ~7 dnech neaktivity).
        'agGeoFoto1': { store: 'foto', schema: function (db) { db.createObjectStore('foto', { keyPath: 'id' }); } },
        'agHlasovky1': { store: 'rec', schema: function (db) { db.createObjectStore('rec', { keyPath: 'id' }); } },
        'arGeodetZavady': { store: 'fotky', schema: function (db) { db.createObjectStore('fotky'); } }
    };
    // KLICE, KTERE DO ZALOHY NESMI. Zaloha je jeden JSON, ktery uzivatel posila
    // mailem nebo AirDropem - drive s ni odchazel i PRISTUP K FIREMNIMU UCTU:
    //   agFirmaTok_v1   ... Bearer token tohoto zarizeni (plati 60 dni)
    //   agFirmaOff_v1   ... sul + PBKDF2 hash hesla (offline overovadlo)
    //   agFirmaBio_v1   ... navazani na Face ID / odemknuti telefonem
    //   agFirmaTrust_v1 ... pamatovane prihlaseni
    //   agFirmaSess_v1  ... aktivni prihlaseni
    //   agFirmaLastUser_v1 / agFirmaDevUsers_v1 ... kdo se na TOMHLE telefonu prihlasil
    //   agLoginFail_v1  ... brzda proti hadani hesla (obnovou by sla obejit)
    // Vsechny jsou navic vazane na konkretni telefon, takze v jinem zarizeni
    // stejne nedavaji smysl. agFirma_v1 (konfigurace firmy) v zaloze ZUSTAVA -
    // bez ni by obnova firemnimu uzivateli appku nerozchodila.
    // POZOR: seznam je vyctem, ne prefixem 'agFirma' - ten by sebral i agFirma_v1.
    const SECRET_KEYS = [
        'agFirmaTok_v1', 'agFirmaOff_v1', 'agFirmaBio_v1', 'agFirmaTrust_v1',
        'agFirmaSess_v1', 'agFirmaLastUser_v1', 'agFirmaDevUsers_v1',
        'agLoginFail_v1'
    ];
    function isSecretKey(k) { return SECRET_KEYS.indexOf(k) >= 0; }

    // ZANORENA KOPIE TYCHZ UDAJU. Ulozene firmy (agFirmy_v1) drzi u KAZDEHO profilu
    // snapshot PROF_KEYS (js/ucty.js) - a v nem je zase agFirmaTok_v1 a agFirmaOff_v1.
    // Vyhozeni klicu o uroven vys je tedy neodstrani; profily se musi projit zvlast.
    // Kdyz obsahu nerozumime, klic radeji vypustime celý - nejistota se nevyvazi.
    // Dusledek pro uzivatele: po obnove zalohy chce prepnuti na JINOU firmu jedno
    // online prihlaseni. Prihlaseni do te prave aktivni zustava (viz import nize).
    var PROFILES_KEY = 'agFirmy_v1';
    function stripProfiles(json) {
        var a;
        try { a = JSON.parse(json); } catch (e) { return null; }
        if (!Array.isArray(a)) return null;
        a.forEach(function (p) {
            if (p && p.snap) SECRET_KEYS.forEach(function (k) { try { delete p.snap[k]; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zaloha:stripProfiles'); } });
        });
        try { return JSON.stringify(a); } catch (e) { return null; }
    }

    function _openDb(name, cfg) {
        return new Promise(function (res) {
            var r; try { r = indexedDB.open(name, 1); } catch (e) { return res(null); }
            r.onupgradeneeded = function (e) { try { if (!e.target.result.objectStoreNames.contains(cfg.store)) cfg.schema(e.target.result); } catch (er) { window.AG && AG.swallow && AG.swallow(er, 'zaloha:onupgradeneeded'); } };
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { res(null); };
            r.onblocked = function () { res(null); };
        });
    }
    // ⚠⚠ BLOB SE DO JSONU NEVEJDE. Geo-fotky (agGeoFoto1) i hlasovky (agHlasovky1)
    // drží média jako Blob a `JSON.stringify(blob)` z něj udělá `{}` — záloha by
    // tedy vypadala kompletní, ale obnovila by fotky a nahrávky PRÁZDNÉ, což je
    // horší než je tam nemít vůbec (uživatel se na ni spolehne). Proto se každý
    // Blob v hodnotě převede na dataURL a při obnově zpátky. Ostatní databáze
    // (dataURL řetězce, plain objekty) tím projdou beze změny.
    var BLOB_MARK = '__agBlob';
    function _blobToDataUrl(b) {
        return new Promise(function (res) {
            try {
                var fr = new FileReader();
                fr.onload = function () { res({ __agBlob: 1, type: b.type || '', d: String(fr.result || '') }); };
                fr.onerror = function () { res(null); };
                fr.readAsDataURL(b);
            } catch (e) { res(null); }
        });
    }
    function _dataUrlToBlob(o) {
        try {
            var s = String(o.d || ''), i = s.indexOf(',');
            if (i < 0) return null;
            var bin = atob(s.slice(i + 1));
            var arr = new Uint8Array(bin.length);
            for (var n = 0; n < bin.length; n++) arr[n] = bin.charCodeAt(n);
            return new Blob([arr], { type: o.type || '' });
        } catch (e) { return null; }
    }
    // Projde vlastní vlastnosti hodnoty a Bloby vymění za značku (a zpět).
    function _packRow(v) {
        if (!v || typeof v !== 'object') return Promise.resolve(v);
        var jobs = [];
        Object.keys(v).forEach(function (k) {
            if (typeof Blob !== 'undefined' && v[k] instanceof Blob) {
                jobs.push(_blobToDataUrl(v[k]).then(function (packed) { v[k] = packed; }));
            }
        });
        return jobs.length ? Promise.all(jobs).then(function () { return v; }) : Promise.resolve(v);
    }
    function _unpackRow(v) {
        if (!v || typeof v !== 'object') return v;
        Object.keys(v).forEach(function (k) {
            var x = v[k];
            if (x && typeof x === 'object' && x[BLOB_MARK]) v[k] = _dataUrlToBlob(x);
        });
        return v;
    }

    function _dumpDb(name, cfg) {
        return _openDb(name, cfg).then(function (db) {
            return new Promise(function (res) {
                if (!db || !db.objectStoreNames.contains(cfg.store)) return res(null);
                try {
                    var rows = [], inline = false;
                    var tx = db.transaction(cfg.store, 'readonly');
                    var st = tx.objectStore(cfg.store);
                    inline = st.keyPath != null;
                    var cur = st.openCursor();
                    cur.onsuccess = function (e) { var c = e.target.result; if (c) { rows.push([c.key, c.value]); c.continue(); } };
                    tx.oncomplete = function () {
                        try { db.close(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zaloha:oncomplete'); }
                        Promise.all(rows.map(function (r) { return _packRow(r[1]); }))
                            .then(function () { res({ inline: inline, rows: rows }); })
                            ['catch'](function () { res({ inline: inline, rows: rows }); });
                    };
                    tx.onerror = function () { try { db.close(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zaloha:onerror'); } res(null); };
                } catch (e) { res(null); }
            });
        });
    }
    function _restoreDb(name, cfg, dump) {
        return _openDb(name, cfg).then(function (db) {
            return new Promise(function (res) {
                if (!db || !dump || !Array.isArray(dump.rows) || !db.objectStoreNames.contains(cfg.store)) { if (db) try { db.close(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zaloha:_restoreDb'); } return res(false); }
                try {
                    var tx = db.transaction(cfg.store, 'readwrite');
                    var st = tx.objectStore(cfg.store);
                    try { st.clear(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zaloha:_restoreDb'); }
                    dump.rows.forEach(function (row) { try { var v = _unpackRow(row[1]); if (dump.inline) st.put(v); else st.put(v, row[0]); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zaloha:_restoreDb'); } });
                    tx.oncomplete = function () { try { db.close(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zaloha:oncomplete'); } res(true); };
                    tx.onerror = function () { try { db.close(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zaloha:onerror'); } res(false); };
                } catch (e) { res(false); }
            });
        });
    }

    window.exportAllData = async function () {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (isSecretKey(k)) continue;          // prihlasovaci udaje do souboru nepatri
            data[k] = localStorage.getItem(k);
        }
        if (typeof data[PROFILES_KEY] === 'string') {
            const _clean = stripProfiles(data[PROFILES_KEY]);
            if (_clean === null) delete data[PROFILES_KEY]; else data[PROFILES_KEY] = _clean;
        }
        const idb = (typeof idbDumpAll === 'function') ? await idbDumpAll() : {};
        const extra = {};
        for (const name of Object.keys(EXTRA_DBS)) {
            try { const d = await _dumpDb(name, EXTRA_DBS[name]); if (d && d.rows.length) extra[name] = d; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zaloha:onerror'); }
        }
        const d = new Date(); const p = n => String(n).padStart(2, '0');
        const payload = {
            app: 'AR Geodet', type: 'full-backup', version: 3,
            exportedAt: d.toISOString(), keys: Object.keys(data).length, data: data, idb: idb, extra: extra
        };
        _dl(`ar-geodet-zaloha-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`, JSON.stringify(payload));
        // Razitko poslední zálohy. Klíče jsou historicky TŘI (kazdá vrstva si zavedla
        // vlastní) a čtou je různá místa — arLastBackupAt výpis úložiště v logika.js,
        // agLastBackupTs pruh v auto-zaloha.js, agLastBackup vylepseni.js. Píšeme
        // všechny naráz, aby se nestalo, že jedna vrstva má zálohu za čerstvou a druhá
        // za starou (přesně z toho vznikala trojice upozornění na totéž).
        try {
            var _ts = String(Date.now());
            localStorage.setItem('arLastBackupAt', _ts);
            localStorage.setItem('agLastBackupTs', _ts);
            localStorage.setItem('agLastBackup', _ts);
            localStorage.removeItem('agBackupSnoozeTs');
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zaloha:onerror'); }
        if (typeof window.agRenderStorageUsage === 'function') { try { window.agRenderStorageUsage(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zaloha:onerror'); } }
    };

    // ⚠ 29. 8. 2026: PŘIPOMÍNKA ZÁLOHY UŽ TADY NENÍ. Byla tu jako toast po 14 dnech
    // a spolu s modálem z js/vylepseni.js a pruhem z js/auto-zaloha.js na uživatele
    // po startu vyskakovala tři upozornění na totéž, každé s vlastním razítkem
    // i odkladem. Zbyl JEDEN pruh v js/auto-zaloha.js.

    window.importAllData = function (event) {
        const file = event.target.files[0]; event.target.value = '';
        if (!file) return;
        const r = new FileReader();
        r.onload = async function (e) {
            let payload;
            try { payload = JSON.parse(e.target.result); }
            catch (err) { agInfo('Soubor zálohy je poškozený nebo to není JSON.'); return; }
            if (!payload || typeof payload.data !== 'object' || payload.data === null) {
                agInfo('Tohle nevypadá jako záloha AR Geodet.'); return;
            }
            const keys = Object.keys(payload.data);
            // destruktivni potvrzeni v app dialogu (fallback na nativni, kdyz bridge chybi)
            const msg = `Obnovit zálohu (${keys.length} položek)?\n\nPřepíše současná data této aplikace a stránka se znovu načte.`;
            const ok = (typeof window.agAsk === 'function') ? await agAsk(msg, { danger: true, okText: 'Obnovit' }) : confirm(msg);
            if (!ok) return;
            // Atomicky: snapshot -> smazat -> zapsat; pri chybe (plna kvota) vratit snapshot,
            // aby nikdy nezustal polovicne obnoveny stav (cast klicu novych, cast starych).
            const snapshot = {};
            for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); snapshot[k] = localStorage.getItem(k); }
            try {
                localStorage.clear();
                keys.forEach(k => {
                    if (isSecretKey(k)) return;
                    let v = payload.data[k];
                    if (typeof v !== 'string') return;
                    // starsi zalohy (porizene pred touhle opravou) nesou udaje i uvnitr profilu
                    if (k === PROFILES_KEY) { const c = stripProfiles(v); if (c === null) return; v = c; }
                    localStorage.setItem(k, v);
                });
                // Prihlaseni patri TOMUHLE telefonu, ne zaloze: stara (nebo cizi)
                // zaloha nesmi podstrcit svuj token ani odhlasit toho, kdo obnovuje.
                SECRET_KEYS.forEach(k => { if (typeof snapshot[k] === 'string') localStorage.setItem(k, snapshot[k]); });
            } catch (err) {
                try { localStorage.clear(); Object.keys(snapshot).forEach(k => localStorage.setItem(k, snapshot[k])); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'zaloha:importAllData'); }
                agInfo('Obnova se nezdařila (úložiště plné?), původní data byla vrácena beze změny: ' + ((err && err.message) ? err.message : err));
                return;
            }
            if (payload.idb && typeof idbRestoreAll === 'function') {
                try { await idbRestoreAll(payload.idb); }
                catch (e3) { agInfo('Nastavení se obnovilo, ale databázi bodů se nepodařilo obnovit celou: ' + ((e3 && e3.message) ? e3.message : e3)); }
            }
            // zalohy v3: obnova dalsich databazi (zurnal, rastr podkladu, fotky vytyceni);
            // starsi zalohy (v2) polozku extra nemaji -> preskoci se
            if (payload.extra && typeof payload.extra === 'object') {
                for (const name of Object.keys(EXTRA_DBS)) {
                    if (payload.extra[name]) { try { await _restoreDb(name, EXTRA_DBS[name], payload.extra[name]); } catch (e4) { window.AG && AG.swallow && AG.swallow(e4, 'zaloha:importAllData'); } }
                }
            }
            location.reload();
        };
        r.readAsText(file);
    };
})();
