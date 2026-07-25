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
        'arGeodetFotky': { store: 'fotky', schema: function (db) { db.createObjectStore('fotky'); } }
    };
    function _openDb(name, cfg) {
        return new Promise(function (res) {
            var r; try { r = indexedDB.open(name, 1); } catch (e) { return res(null); }
            r.onupgradeneeded = function (e) { try { if (!e.target.result.objectStoreNames.contains(cfg.store)) cfg.schema(e.target.result); } catch (er) {} };
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { res(null); };
            r.onblocked = function () { res(null); };
        });
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
                    tx.oncomplete = function () { try { db.close(); } catch (e) {} res({ inline: inline, rows: rows }); };
                    tx.onerror = function () { try { db.close(); } catch (e) {} res(null); };
                } catch (e) { res(null); }
            });
        });
    }
    function _restoreDb(name, cfg, dump) {
        return _openDb(name, cfg).then(function (db) {
            return new Promise(function (res) {
                if (!db || !dump || !Array.isArray(dump.rows) || !db.objectStoreNames.contains(cfg.store)) { if (db) try { db.close(); } catch (e) {} return res(false); }
                try {
                    var tx = db.transaction(cfg.store, 'readwrite');
                    var st = tx.objectStore(cfg.store);
                    try { st.clear(); } catch (e) {}
                    dump.rows.forEach(function (row) { try { if (dump.inline) st.put(row[1]); else st.put(row[1], row[0]); } catch (e) {} });
                    tx.oncomplete = function () { try { db.close(); } catch (e) {} res(true); };
                    tx.onerror = function () { try { db.close(); } catch (e) {} res(false); };
                } catch (e) { res(false); }
            });
        });
    }

    window.exportAllData = async function () {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); data[k] = localStorage.getItem(k); }
        const idb = (typeof idbDumpAll === 'function') ? await idbDumpAll() : {};
        const extra = {};
        for (const name of Object.keys(EXTRA_DBS)) {
            try { const d = await _dumpDb(name, EXTRA_DBS[name]); if (d && d.rows.length) extra[name] = d; } catch (e) {}
        }
        const d = new Date(); const p = n => String(n).padStart(2, '0');
        const payload = {
            app: 'AR Geodet', type: 'full-backup', version: 3,
            exportedAt: d.toISOString(), keys: Object.keys(data).length, data: data, idb: idb, extra: extra
        };
        _dl(`ar-geodet-zaloha-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`, JSON.stringify(payload));
        try { localStorage.setItem('arLastBackupAt', String(Date.now())); } catch (e) {}
        if (typeof window.agRenderStorageUsage === 'function') { try { window.agRenderStorageUsage(); } catch (e) {} }
    };

    // Nenapadna pripominka zalohy: kdyz jsou v aktualni zakazce vlastni body a posledni zaloha
    // je starsi nez 14 dni (nebo nikdy), jednou za spusteni pripomeneme. Data ziji jen v telefonu.
    window.addEventListener('load', function () {
        setTimeout(function () {
            try {
                var last = parseInt(localStorage.getItem('arLastBackupAt') || '0', 10);
                var days = last ? (Date.now() - last) / 86400000 : 999;
                var hasPts = (typeof persistentCustomPoints !== 'undefined' && persistentCustomPoints.length > 0);
                if (hasPts && days > 14 && typeof quickToast === 'function') {
                    quickToast('Tip: zálohujte data (Nastavení → Údržba → Stáhnout zálohu). ' + (last ? 'Poslední záloha ' + Math.round(days) + ' dní zpět.' : 'Zatím bez zálohy.'));
                }
            } catch (e) {}
        }, 8000);
    });

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
                keys.forEach(k => { if (typeof payload.data[k] === 'string') localStorage.setItem(k, payload.data[k]); });
            } catch (err) {
                try { localStorage.clear(); Object.keys(snapshot).forEach(k => localStorage.setItem(k, snapshot[k])); } catch (e2) {}
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
                    if (payload.extra[name]) { try { await _restoreDb(name, EXTRA_DBS[name], payload.extra[name]); } catch (e4) {} }
                }
            }
            location.reload();
        };
        r.readAsText(file);
    };
})();
