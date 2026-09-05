// ===== AR Geodet — VALIDACE IMPORTU CSV (kontrola rozsahu S-JTSK) ================
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu vylepseni.js: obaluje globální funkci
// importu bodů za běhu, NEEDITUJE logika.js. Načítá se jako jeden z posledních skriptů.
//
// Co dělá:
//   Import bodů (CSV/TXT "číslo;Y;X" v S-JTSK, JSON, i vložení v průvodci) jde v logice
//   přes JEDINÝ globální sink window.addImportedPoints(arr). Tato vrstva ho obalí a před
//   předáním dál ověří, že každý bod leží v rozsahu S-JTSK Křovák:
//       Y ~ 400 000 – 900 000 m,  X ~ 900 000 – 1 300 000 m  (kladné absolutní hodnoty).
//   Body mimo rozsah (překlep, prohozené sloupce, cizí souřadnicový systém, mezinárodní
//   souřadnice apod.) se PŘESKOČÍ — neuloží se a nezahltí mapu zbloudilým bodem.
//   Platné body se NEMĚNÍ a projdou beze změny. Na konci ohlásí počet přeskočených.
//
// Pozn.: addImportedPoints dostává body už převedené do WGS84 (lat/lng). Rozsah Křováku
//   ověříme zpětným převodem přes GeoCore.toSJTSK (js/geo-core.js) — jediný autoritativní
//   převod v appce, který si navíc ověří pořadí os. Vlastní volání proj4 tu bylo dřív,
//   ale s heuristikou min/max, která u souřadnic mimo ČR osy tiše prohazovala.
//
// Odstranění vrstvy: smaž js/csv-validate.js a její řádek v index.html (+ záznam v sw.js).
// Aplikace pak importuje přesně jako předtím (bez kontroly rozsahu).
// ================================================================================
(function () {
    'use strict';

    // Rozsah S-JTSK Křovák (kladné absolutní hodnoty souřadnic).
    // Tolerance mírná, ať neodmítáme body těsně u hranice ČR.
    const Y_MIN = 400000, Y_MAX = 900000;     // "menší" souřadnice
    const X_MIN = 900000, X_MAX = 1300000;    // "větší" souřadnice

    // Vrátí true, pokud bod (WGS84 lat/lng) po převodu do S-JTSK leží v rozsahu Křováku.
    // Fail-open: když převod nelze provést (chybí GeoCore / nesmyslné vstupy), bod
    //   NEZAHAZUJEME — kontrolu rozsahu prostě nepřidáváme a chování zůstane jako bez
    //   této vrstvy. Import je vstupní brána dat: nic se tu nesmí ztratit jen proto, že
    //   se nepodařilo spočítat kontrolu.
    function inSjtskRange(lat, lng) {
        try {
            if (!window.GeoCore || typeof GeoCore.toSJTSK !== 'function') return true;
            if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return true;
            // GeoCore vrací {y, x} kladné a v ověřeném pořadí os — proto tu už není
            // heuristika „menší = Y, větší = X", která u zahraničních souřadnic selhávala.
            const sj = GeoCore.toSJTSK(lat, lng);
            if (!sj || !isFinite(sj.y) || !isFinite(sj.x)) return true;
            return (sj.y >= Y_MIN && sj.y <= Y_MAX && sj.x >= X_MIN && sj.x <= X_MAX);
        } catch (e) { return true; }
    }

    // Ohlášení počtu přeskočených bodů (agAlert, jinak nativní alert, jinak tiše nic).
    function reportSkipped(skipped, accepted) {
        if (!skipped) return;
        const slovo = skipped === 1 ? 'řádek byl přeskočen' : (skipped < 5 ? 'řádky byly přeskočeny' : 'řádků bylo přeskočeno');
        const msg = '<b>' + skipped + '</b> ' + slovo + ' — souřadnice leží mimo rozsah S-JTSK Křovák ' +
            '(Y ' + (Y_MIN / 1000) + '–' + (Y_MAX / 1000) + ' tis., X ' + (X_MIN / 1000) + '–' + (X_MAX / 1000) + ' tis. m).<br>' +
            'Zkontroluj překlepy, prohozené sloupce Y/X a souřadnicový systém.' +
            (accepted ? ('<br>Platných bodů k importu: <b>' + accepted + '</b>.') : '');
        try {
            if (typeof window.agAlert === 'function') {
                window.agAlert({ title: 'Některé body přeskočeny', message: msg });
                return;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'csv-validate:reportSkipped'); }
        try {
            // Fallback bez HTML značek
            window.alert(skipped + ' ' + slovo + ' — souřadnice mimo rozsah S-JTSK Křovák.');
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'csv-validate:reportSkipped'); }
    }

    // Obalení jediného globálního sinku importu. Idempotentní (značka _csvValidated).
    function wrapImport() {
        if (typeof window.addImportedPoints !== 'function') return;
        if (window.addImportedPoints._csvValidated) return;

        const orig = window.addImportedPoints;
        const wrapped = function (arr) {
            try {
                if (!Array.isArray(arr)) return orig.apply(this, arguments);

                let skipped = 0;
                const valid = [];
                arr.forEach(function (p) {
                    if (!p) { skipped++; return; }
                    // body bez platných souřadnic přenecháme původní funkci (ta je sama odmítne);
                    // kontrolu rozsahu uplatníme jen tam, kde jsou souřadnice číselné a převoditelné.
                    if (typeof p.lat === 'number' && typeof p.lng === 'number' && isFinite(p.lat) && isFinite(p.lng)) {
                        if (!inSjtskRange(p.lat, p.lng)) { skipped++; return; }
                    }
                    valid.push(p);
                });

                const added = orig.call(this, valid);

                // Hlášení až po importu, ať nepřekryje případnou hlášku původní funkce.
                if (skipped) setTimeout(function () { reportSkipped(skipped, valid.length); }, 350);

                return added;
            } catch (e) {
                // Při jakékoli chybě validace radši propustíme původní (nerozbít import).
                try { return orig.apply(this, arguments); } catch (e2) { return 0; }
            }
        };
        wrapped._csvValidated = true;
        // zachovej případné jiné značky/vlastnosti původní funkce
        try { for (const k in orig) { if (k !== '_csvValidated') wrapped[k] = orig[k]; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'csv-validate:wrapped'); }
        window.addImportedPoints = wrapped;
    }

    function init() {
        try { wrapImport(); } catch (e) { console.warn('[csv-validate] wrap', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // Druhý průchod po plném loadu — addImportedPoints vzniká uvnitř IIFE logika.js,
    // může být dostupné až po startu.
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
