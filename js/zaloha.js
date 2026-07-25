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
            catch (err) { alert('Soubor zálohy je poškozený nebo to není JSON.'); return; }
            if (!payload || typeof payload.data !== 'object' || payload.data === null) {
                alert('Tohle nevypadá jako záloha AR Geodet.'); return;
            }
            const keys = Object.keys(payload.data);
            if (!confirm(`Obnovit zálohu (${keys.length} položek)?\n\nPřepíše současná data této aplikace a stránka se znovu načte.`)) return;
            // Atomicky: snapshot -> smazat -> zapsat; pri chybe (plna kvota) vratit snapshot,
            // aby nikdy nezustal polovicne obnoveny stav (cast klicu novych, cast starych).
            const snapshot = {};
            for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); snapshot[k] = localStorage.getItem(k); }
            try {
                localStorage.clear();
                keys.forEach(k => { if (typeof payload.data[k] === 'string') localStorage.setItem(k, payload.data[k]); });
            } catch (err) {
                try { localStorage.clear(); Object.keys(snapshot).forEach(k => localStorage.setItem(k, snapshot[k])); } catch (e2) {}
                alert('Obnova se nezdařila (úložiště plné?), původní data byla vrácena beze změny: ' + ((err && err.message) ? err.message : err));
                return;
            }
            if (payload.idb && typeof idbRestoreAll === 'function') {
                try { await idbRestoreAll(payload.idb); }
                catch (e3) { alert('Nastavení se obnovilo, ale databázi bodů se nepodařilo obnovit celou: ' + ((e3 && e3.message) ? e3.message : e3)); }
            }
            location.reload();
        };
        r.readAsText(file);
    };
})();
