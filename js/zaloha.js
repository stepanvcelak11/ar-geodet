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

    window.exportAllData = async function () {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); data[k] = localStorage.getItem(k); }
        const idb = (typeof idbDumpAll === 'function') ? await idbDumpAll() : {};
        const d = new Date(); const p = n => String(n).padStart(2, '0');
        const payload = {
            app: 'AR Geodet', type: 'full-backup', version: 2,
            exportedAt: d.toISOString(), keys: Object.keys(data).length, data: data, idb: idb
        };
        _dl(`ar-geodet-zaloha-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`, JSON.stringify(payload));
    };

    window.importAllData = function (event) {
        const file = event.target.files[0]; event.target.value = '';
        if (!file) return;
        const r = new FileReader();
        r.onload = async function (e) {
            let payload;
            try { payload = JSON.parse(e.target.result); }
            catch (err) { alert('Soubor zálohy je poškozený nebo to není JSON.'); return; }
            if (!payload || typeof payload.data !== 'object' || payload.data === null) {
                alert('Tohle nevypadá jako záloha AR Geodet.'); return;
            }
            const keys = Object.keys(payload.data);
            if (!confirm(`Obnovit zálohu (${keys.length} položek)?\n\nPřepíše současná data této aplikace a stránka se znovu načte.`)) return;
            try { keys.forEach(k => localStorage.setItem(k, payload.data[k])); }
            catch (err) { alert('Obnova se nezdařila (úložiště plné?): ' + ((err && err.message) ? err.message : err)); return; }
            if (payload.idb && typeof idbRestoreAll === 'function') { try { await idbRestoreAll(payload.idb); } catch (e) {} }
            location.reload();
        };
        r.readAsText(file);
    };
})();
