// CELÁ OBRAZOVKA / IMMERSIVE (odpojitelné: smaž tento řádek v index.html + tento soubor)
// Schová systémovou navigační lištu Androidu (ten prázdný proužek dole),
// aby appka šla až do spodní hrany displeje. Spouští se na uživatelské gesto
// (tap na tlačítko na PŘIHLAŠOVACÍ obrazovce), protože requestFullscreen() jinak
// prohlížeč odmítne.
// ⚠ 31. 8. 2026: gesto bývalo „Spustit vyhledávání" na úvodní obrazovce. Ta je
// zrušená, takže by se fullscreen NIKDY nezapnul — appka by po celém dni v terénu
// koukala na navigační lištu Androidu. Vstupní obrazovkou je teď přihlášení
// (#ag-gate / #ag-login z js/ucty.js), tak se posloucháme tam.
// iOS Safari requestFullscreen na dokumentu neumí → tam to tiše přeskočí a spoléhá
// na PWA režim (přidat na plochu).
(function () {
    'use strict';

    function enterFullscreen() {
        var el = document.documentElement;
        var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (!req) return;                          // iOS Safari apod. — nepodporuje
        if (document.fullscreenElement || document.webkitFullscreenElement) return; // už jsme
        try {
            var p = req.call(el, { navigationUI: 'hide' });
            if (p && p.catch) p.catch(function () {}); // odmítnutí ignorujeme (není kritické)
        } catch (e) { /* některé prohlížeče neberou options objekt */
            try { req.call(el); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'fullscreen:enterFullscreen'); }
        }
    }

    function bind() {
        // Fullscreen vyžadujeme POUZE při odchodu ze vstupní obrazovky (jakékoli tlačítko
        // uvnitř #ag-gate / #ag-login). Tím je fullscreen aktivní DŘÍV, než se uživatel
        // dotkne doku — vstup do fullscreenu totiž přeskládá layout (skryjí se systémové
        // lišty), a kdyby k tomu došlo na stejném kliknutí, které otevírá
        // Nastavení/Body/Nástroje, přeruší to jejich otevírací animaci (a tap by se mohl
        // „sníst"). Proto NEvážeme na globální první klik v dokumentu.
        //
        // Posluchač je DELEGOVANÝ na dokumentu: brána i přihlášení se staví až za běhu
        // (a mezi odhlášením a novým přihlášením se postaví znovu), takže na konkrétní
        // uzel se navázat nedá. Zachytáváme ve fázi zachytávání, aby nás nepředběhlo
        // odstranění obrazovky ve vlastní obsluze tlačítka.
        document.addEventListener('click', function (e) {
            try {
                var t = e.target;
                if (!t || !t.closest) return;
                if (!t.closest('#ag-gate, #ag-login')) return;
                if (!t.closest('button')) return;
                enterFullscreen();
            } catch (er) { window.AG && AG.swallow && AG.swallow(er, 'fullscreen:bind'); }
        }, true);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();

    // Veřejné API, kdyby to chtěl zavolat jiný modul po vlastním gestu
    window.AGFullscreen = { enter: enterFullscreen };
})();
