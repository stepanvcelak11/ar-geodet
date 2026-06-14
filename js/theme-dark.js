// ===== AR Geodet — VÝCHOZÍ TMAVÝ MOTIV (jednorázová migrace) ===================
// Odpojitelná vrstva. Fresh instalace už je tmavá (visSettings.mode je undefined →
// previewMode → tmavý). Tohle JEDNORÁZOVĚ překlopí starší uložené 'light' na 'dark',
// aby byl výchozí motiv tmavý. Po migraci si uživatel může v Nastavení zvolit světlý
// a ten už zůstane (migrace se víckrát nespustí).
//
// Odstranění: smaž js/theme-dark.js + řádek v index.html / sw.js.
// ================================================================================
(function () {
    'use strict';
    var FLAG = 'agDarkDefault1';

    function apply() {
        try {
            if (localStorage.getItem(FLAG)) return;   // už proběhlo → respektuj volbu uživatele
            localStorage.setItem(FLAG, '1');

            if (typeof visSettings !== 'undefined' && visSettings && typeof visSettings === 'object') {
                if (visSettings.mode !== 'dark') {
                    visSettings.mode = 'dark';
                    try { if (typeof setStoredData === 'function') setStoredData('arVisSettings12', JSON.stringify(visSettings)); } catch (e) {}
                }
            }
            // aplikuj hned vizuálně
            try {
                if (typeof previewMode === 'function') previewMode('dark');
                else document.body.classList.remove('light-mode');
            } catch (e) {}
            var sel = document.getElementById('v-mode'); if (sel) sel.value = 'dark';
        } catch (e) { /* fail-silent */ }
    }

    try {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
        else apply();
        window.addEventListener('load', function () { setTimeout(apply, 200); });
    } catch (e) {}
})();
