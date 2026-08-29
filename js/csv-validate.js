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
//   ověříme zpětným převodem proj4 EPSG:4326 -> EPSG:5514 (stejná transformace, jakou
//   používá sjtskToLatLng v logika.js) — kontroluje se tedy přesně S-JTSK rozsah.
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
    // Fail-open: když převod nelze provést (chybí proj4 / nesmyslné vstupy), bod NEZAHAZUJEME
    //   — kontrolu rozsahu prostě nepřidáváme a chování zůstane jako bez této vrstvy.
    function inSjtskRange(lat, lng) {
        try {
            if (typeof proj4 !== 'function') return true;
            if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return true;
            const sj = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]);
            if (!sj || !isFinite(sj[0]) || !isFinite(sj[1])) return true;
            // V Křováku jsou obě souřadnice záporné; bereme absolutní hodnoty.
            // sjtskToLatLng() bere menší = Y, větší = X — stejné pořadí dodržíme i tady.
            const a = Math.abs(sj[0]), b = Math.abs(sj[1]);
            const Y = Math.min(a, b), X = Math.max(a, b);
            return (Y >= Y_MIN && Y <= Y_MAX && X >= X_MIN && X <= X_MAX);
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
