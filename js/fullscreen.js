// CELÁ OBRAZOVKA / IMMERSIVE (odpojitelné: smaž tento řádek v index.html + tento soubor)
// Schová systémovou navigační lištu Androidu (ten prázdný proužek dole),
// aby appka šla až do spodní hrany displeje. Spouští se na uživatelské gesto
// (tap na "Spustit vyhledávání"), protože requestFullscreen() jinak prohlížeč odmítne.
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
        // Fullscreen vyžadujeme POUZE při odchodu z úvodní obrazovky (jakékoli tlačítko
        // uvnitř #welcome-screen). Tím je fullscreen aktivní DŘÍV, než se uživatel dotkne
        // doku — vstup do fullscreenu totiž přeskládá layout (skryjí se systémové lišty),
        // a kdyby k tomu došlo na stejném kliknutí, které otevírá Nastavení/Body/Nástroje,
        // přeruší to jejich otevírací animaci (a tap by se mohl „sníst"). „Více" je odolné,
        // protože nemění display. Proto NEvážeme na globální první klik v dokumentu.
        var ws = document.getElementById('welcome-screen');
        if (ws) ws.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('button')) enterFullscreen();
        }, { passive: true });
        var btn = document.getElementById('welcome-start-btn');
        if (btn) btn.addEventListener('click', enterFullscreen, { passive: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();

    // Veřejné API, kdyby to chtěl zavolat jiný modul po vlastním gestu
    window.AGFullscreen = { enter: enterFullscreen };
})();
