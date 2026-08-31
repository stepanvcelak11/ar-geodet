// ===== AR Geodet — KLID PO STARTU (ODPOJITELNÁ vrstva) ==========================
// ⚠ 31. 8. 2026 — SOUBOR SE VYPRÁZDNIL O SVOU PŮVODNÍ PRÁCI.
// Jmenuje se „welcome-card", protože plnil kartu aktivní zakázky na úvodní
// obrazovce (návrh C „Zakázka v centru"): název zakázky, chip počtu bodů, datum
// vzniku a letící hodnoty na pozadí. Úvodní obrazovka je zrušená — jediný vchod
// do appky je přihlášení (viz komentář u #welcome-screen v index.html) — takže
// všechno tohle mířilo na prvky, které v dokumentu nejsou.
//
// Co ODEŠLO a PROČ se to nemá vracet:
//   • updateWelcomeProjectCard() + obaly loadProjectSettings/renderProjectSelect
//     — plnily #w-proj-name / #w-proj-chips. Ty prvky neexistují; obaly by jen
//     při každém přepnutí zakázky volaly funkci, která hned vyskočí. Název
//     zakázky dnes ukazuje přihlašovací obrazovka sama (projInfoHtml v js/ucty.js).
//   • mountLiveBg() — vkládal letící hodnoty (čas, poloha, teplota) na pozadí
//     úvodní karty. Na přihlašovací obrazovce je AGUcty.mountLive() vykresluje
//     dál a je to jejich jediné správné místo; do skryté kostry by jen nastartoval
//     dvacetisekundový časovač, který by hned zase umřel.
//
// Co ZŮSTALO: podržení lišty „Nová verze" v prvních dvou minutách po startu.
// Nesouvisí to s úvodní kartou, jen to tu odjakživa bydlelo — a je to potřeba
// dál. Odstranění: smaž js/welcome-card.js + řádek <script> v index.html
// (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';

    // ================================================================================
    // KLID PO STARTU (29. 8. 2026 — zpětná vazba z testu balíčku pro Google Play)
    // ================================================================================
    // Lišta „Nová verze — klepni pro obnovení" naskakovala hned v první vteřině po
    // otevření appky. Člověk se ještě nestihl rozkoukat a už na něj bliká výzva
    // k restartu. Aktualizace nikam neutíká (čeká ve service workeru, dokud se
    // appka nezavře), tak se prvních QUIET_MS jen podrží.
    // POZOR: lištu zobrazuje showUpdateBanner() z js/grafika.js přes inline
    // style.display='flex' (výchozí je none z css/style.css) — proto se hlídá
    // inline styl, ne třída.
    var QUIET_MS = 120000;              // 2 minuty ticha po startu
    var _t0 = Date.now();
    var _quietTimer = null;

    function bannerQuiet() {
        var b = document.getElementById('update-banner');
        if (!b) return;
        if (Date.now() - _t0 < QUIET_MS) {
            if (b.style.display && b.style.display !== 'none') {
                b.setAttribute('data-ag-held', '1');
                b.style.display = 'none';
            }
            return;
        }
        // ticho skončilo — co se podrželo, se teď ukáže
        if (b.getAttribute('data-ag-held') === '1') {
            b.removeAttribute('data-ag-held');
            b.style.display = 'flex';
        }
        if (_quietTimer) { clearInterval(_quietTimer); _quietTimer = null; }
    }

    // HLÁŠKA „nenačetlo se to celé" UŽ TADY NENÍ — bydlí v <head> index.html.
    //
    // ⚠ NEVRACET SEM. Byla tu, dokud pojistka v index.html po 8 s zámek ODEMYKALA;
    //   od té doby ho drží a hlášku staví sama. Dvě kopie téhož `#ag-bootfail`
    //   se pak navzájem vyřadily a bylo to MĚŘITELNĚ HORŠÍ než jedna:
    //     • tahle verze vyskočila dřív (10 s proti 12 s) a zabrala id,
    //     • verze z <head> proto celý svůj blok přeskočila (`if (getElementById(
    //       'ag-bootfail')) return;`) — a s ním i hlídače, který hlášku uklízí,
    //     • tahle vlastního hlídače nemá, takže když se ucty.js opozdil a
    //       přihlášení PAK naběhlo, zůstala hláška viset přes funkční přihlašovací
    //       obrazovku a jediné, co šlo, bylo „Spustit znovu" — na pomalém spoji
    //       dokola.
    //   Naměřeno v prohlížeči (ucty.js zdržený o 18 s): hláška svítila i 14 s
    //   poté, co bylo přihlášení na obrazovce.
    //
    //   Verze v <head> je navíc jediná správná: nevisí na žádném modulu ani CSS,
    //   takže se ukáže i tehdy, když se nenačetlo vůbec nic — a přesně to je
    //   situace, kvůli které hláška existuje.

    function kick() {
        bannerQuiet();
        _quietTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(bannerQuiet, 1000);
        setTimeout(bannerQuiet, QUIET_MS + 200);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kick);
    else kick();
})();
