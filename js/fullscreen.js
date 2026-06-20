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
            try { req.call(el); } catch (e2) {}
        }
    }

    function bind() {
        var btn = document.getElementById('welcome-start-btn');
        if (btn) btn.addEventListener('click', enterFullscreen, { passive: true });
        // Průvodce i jiné vstupy: po prvním KLIKU kdekoli se taky pokusíme (jen jednou),
        // aby fullscreen naskočil, i když uživatel nezačne hlavním tlačítkem.
        // POZOR: záměrně 'click', NE 'pointerdown' — vstup do fullscreenu přeskládá layout
        // (skryjí se systémové lišty) a kdyby se spustil na pointerdown, prvek se uhne a
        // první tap na tlačítko (Nastavení/Body/Více…) by se „snědl" a nic by neotevřel.
        // Na 'click' se tlačítko stihne provést a fullscreen naskočí až po něm.
        document.addEventListener('click', enterFullscreen, { once: true, passive: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();

    // Veřejné API, kdyby to chtěl zavolat jiný modul po vlastním gestu
    window.AGFullscreen = { enter: enterFullscreen };
})();
