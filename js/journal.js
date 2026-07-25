// ============================================================================
// AR Geodet — ŽURNÁL OPERACÍ + PROVENIENCE BODU (#5)
// ----------------------------------------------------------------------------
// Append-only záznam každé změny bodů (add / edit / delete) do VLASTNÍ IndexedDB
// (argeodet-journal), aby se nemuselo sahat do schématu hlavní DB 'argeodet' (v1).
// Z hromady anonymních souřadnic dělá auditovatelný elaborát: každý bod se dá
// zpětně dohledat — kdo/kdy/jak ho pořídil a s jakou přesností.
//
// Zápis je NEINVAZIVNÍ: logika.js (saveCustomPoint / addImportedPoints) a
// wrapper mazání volají window.AGJournal.commit(...) v try/catch. Když modul
// není načtený, appka funguje beze změny.
//
// API:
//   AGJournal.commit({op,id,before,after,origin})   — zapiš operaci
//   AGJournal.history(id) -> Promise<[rec]>          — historie jednoho bodu
//   AGJournal.recent(n)   -> Promise<[rec]>          — posledních n operací
//   AGJournal.all(proj?)  -> Promise<[rec]>          — celý žurnál (pro .argeo přenos)
//   AGJournal.showHistory(id)                        — modal s historií bodu
//   AGJournal.pid()                                  — id aktivní zakázky
// ============================================================================
(function () {
    'use strict';
    if (window.AGJournal) return;

    var DB = 'argeodet-journal', STORE = 'ops', VER = 1;
    var _db = null;

    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function author() { try { return localStorage.getItem('arSurveyor') || localStorage.getItem('arAuthor') || ''; } catch (e) { return ''; } }
    function dev() { try { var d = localStorage.getItem('arDeviceId'); if (!d) { d = 'd' + Math.abs((navigator.userAgent || '').split('').reduce(function (a, c) { return (a * 31 + c.charCodeAt(0)) | 0; }, 7)).toString(36); localStorage.setItem('arDeviceId', d); } return d; } catch (e) { return '?'; } }

    function open() {
        return new Promise(function (res) {
            if (_db) return res(_db);
            var r; try { r = indexedDB.open(DB, VER); } catch (e) { return res(null); }
            r.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    var os = db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
                    os.createIndex('proj', 'proj', { unique: false });
                    os.createIndex('pt', ['proj', 'id'], { unique: false });
                }
            };
            r.onsuccess = function () { _db = r.result; res(_db); };
            r.onerror = function () { res(null); };
            r.onblocked = function () { res(null); };
        });
    }

    // uchováváme jen podstatu bodu (ne runtime pole jako element/DOM)
    function slim(a) {
        if (!a || typeof a !== 'object') return null;
        return {
            name: a.name != null ? a.name : null,
            lat: a.lat, lng: a.lng,
            vyska: a.vyska != null ? a.vyska : null,
            acc: a.acc != null ? a.acc : null,
            cat: a.cat || null,
            prov: a.prov || null
        };
    }

    function commit(op) {
        if (!op || !op.op) return;
        var rec = {
            proj: pid(), ts: Date.now(), op: op.op, id: op.id || null,
            before: slim(op.before), after: slim(op.after),
            origin: op.origin || (op.after && op.after.prov && op.after.prov.origin) || null,
            author: author(), dev: dev()
        };
        open().then(function (db) {
            if (!db) return;
            try { db.transaction(STORE, 'readwrite').objectStore(STORE).add(rec); } catch (e) {}
        });
        try { window.dispatchEvent(new CustomEvent('agjournal:commit', { detail: rec })); } catch (e) {}
    }

    function _query(index, range, limit, reverse) {
        return open().then(function (db) {
            if (!db) return [];
            return new Promise(function (res) {
                var out = [];
                try {
                    var tx = db.transaction(STORE, 'readonly');
                    var src = index ? tx.objectStore(STORE).index(index) : tx.objectStore(STORE);
                    var rq = src.openCursor(range || null, reverse ? 'prev' : 'next');
                    rq.onsuccess = function (e) {
                        var c = e.target.result;
                        if (c && (!limit || out.length < limit)) { out.push(c.value); c.continue(); }
                        else res(out);
                    };
                    rq.onerror = function () { res(out); };
                } catch (e) { res(out); }
            });
        });
    }

    function history(id) {
        var range; try { range = IDBKeyRange.only([pid(), id]); } catch (e) { range = null; }
        return _query('pt', range, 0, false);
    }
    function recent(n) {
        var range; try { range = IDBKeyRange.only(pid()); } catch (e) { range = null; }
        return _query('proj', range, n || 50, true);
    }
    function all(proj) {
        var range; try { range = IDBKeyRange.only(proj || pid()); } catch (e) { range = null; }
        return _query('proj', range, 0, false);
    }
    // hromadný import žurnálu z přenesené zakázky (#6) — zachovej append-only
    function importRecords(recs, proj) {
        if (!Array.isArray(recs) || !recs.length) return Promise.resolve(0);
        return open().then(function (db) {
            if (!db) return 0;
            return new Promise(function (res) {
                var tx, os, ok = 0;
                try { tx = db.transaction(STORE, 'readwrite'); os = tx.objectStore(STORE); } catch (e) { return res(0); }
                recs.forEach(function (r) {
                    if (!r || !r.op) return;
                    var rec = { proj: proj || r.proj || pid(), ts: r.ts || Date.now(), op: r.op, id: r.id || null, before: r.before || null, after: r.after || null, origin: r.origin || null, author: r.author || '', dev: r.dev || '' };
                    try { os.add(rec); ok++; } catch (e) {}
                });
                tx.oncomplete = function () { res(ok); };
                tx.onerror = function () { res(ok); };
            });
        });
    }

    // ---- jednoduchý prohlížeč historie bodu -----------------------------------
    var OP_CZ = { add: 'vznik', edit: 'úprava', delete: 'smazání', add_import: 'import', restore: 'obnova' };
    var ORIG_CZ = { ruc: 'ruční zápis', import: 'import', 'gps-avg': 'GPS průměr', resekce: 'resekce', rajon: 'rajón', 'foto-shot': 'foto-totálka', transfer: 'přenos zakázky', legacy: '—' };

    function _fmt(ts) { try { var d = new Date(ts); return d.toLocaleDateString('cs-CZ') + ' ' + d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(ts); } }

    function showHistory(id) {
        history(id).then(function (recs) {
            var rows;
            if (!recs.length) {
                rows = '<div style="color:var(--text-muted);padding:10px 0;">Pro tento bod zatím není žádný záznam v žurnálu. (Body vytvořené před zavedením žurnálu historii nemají.)</div>';
            } else {
                // sdílené třídy .geo-data-row/.geo-label/.geo-value (style.css) — jednotný vzhled s kartou bodu
                rows = recs.map(function (r) {
                    var acc = (r.after && r.after.acc != null) ? (' · ±' + r.after.acc + ' m') : '';
                    var org = (r.origin && ORIG_CZ[r.origin]) || r.origin || '';
                    return '<div class="geo-data-row" style="align-items:flex-start;">'
                        + '<span class="geo-label" style="color:var(--text-color);"><b>' + (OP_CZ[r.op] || r.op) + '</b>' + (org ? ' · ' + org : '') + acc
                        + (r.author ? '<br><span style="color:var(--text-muted);font-size:12px;font-weight:400;">' + r.author + '</span>' : '') + '</span>'
                        + '<span class="geo-value" style="font-weight:400;font-size:12px;color:var(--text-muted);white-space:nowrap;">' + _fmt(r.ts) + '</span></div>';
                }).join('');
            }
            var html = '<div style="max-height:calc(var(--app-vh, 100dvh) * 0.6);overflow:auto;font-size:13.5px;">' + rows + '</div>';
            if (typeof window.agAlert === 'function') window.agAlert({ title: 'Historie bodu', message: html, cancelText: false });
            else agInfo('Historie bodu:\n' + recs.map(function (r) { return _fmt(r.ts) + ' ' + (OP_CZ[r.op] || r.op) + ' ' + (r.origin || ''); }).join('\n'));
        });
    }

    // zachycení mazání -> zápis delete opu (append-only). Chová se jako kos.js wrapper.
    function wrapDelete() {
        var orig = window.deleteCustomPoint;
        if (typeof orig !== 'function' || orig._journalWrapped) return;
        window.deleteCustomPoint = function (id) {
            var before = null;
            try { if (typeof persistentCustomPoints !== 'undefined') { var p = persistentCustomPoints.find(function (x) { return x.id === id; }); if (p) before = JSON.parse(JSON.stringify(p)); } } catch (e) {}
            var ret = orig.apply(this, arguments);
            try {
                var gone = !(typeof persistentCustomPoints !== 'undefined' && persistentCustomPoints.some(function (x) { return x.id === id; }));
                if (before && gone) commit({ op: 'delete', id: id, before: before, origin: (before.prov && before.prov.origin) || null });
            } catch (e) {}
            return ret;
        };
        window.deleteCustomPoint._journalWrapped = true;
    }
    // deleteCustomPoint definují jiné moduly (kalkulacka/kos) po startu -> zkusíme opakovaně
    var _tries = 0;
    (function tryWrap() { wrapDelete(); if (!(window.deleteCustomPoint && window.deleteCustomPoint._journalWrapped) && _tries++ < 40) setTimeout(tryWrap, 250); })();

    window.AGJournal = { commit: commit, history: history, recent: recent, all: all, importRecords: importRecords, showHistory: showHistory, pid: pid };
})();
