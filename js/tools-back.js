// ===== AR Geodet — NÁVRAT DO NÁSTROJŮ (ODPOJITELNÁ vrstva) =====================
// Když si v Nástrojích otevřeš špatný nástroj a zavřeš ho, appka tě dosud vyhodila
// na hlavní obrazovku a musel jsi Nástroje otevírat znovu. Tahle vrstva si pamatuje,
// že nástroj byl otevřen Z NÁSTROJŮ, a po jeho zavření mřížku zase vytáhne — takže
// rovnou vybereš ten správný.
//
// Jak to pozná: klik na dlaždici (capture, tedy dřív než inline onclick, který
// Nástroje zavírá) → „ozbrojíme se". Pak čekáme, jestli se do 1,5 s něco otevřelo:
//   - když ano, hlídáme, až všechno zmizí → znovu otevřeme Nástroje,
//   - když ne, jde o dlaždici, která jen přepne režim mapy nebo otevře externí
//     okno (měření plochy, katastr, DronView) — tam by návrat do Nástrojů překážel,
//     takže se tiše odzbrojíme.
//
// Nesahá do žádného modulu. Odstranění: smaž js/tools-back.js + řádek v index.html
// a v sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGToolsBack) return;

    var POLL_MS = 350;          // jak často se kouká, jestli je ještě něco otevřené
    var ARM_MS = 1500;          // do kdy se nástroj musí otevřít, jinak to nebyl modál
    var MAX_MS = 4 * 3600000;   // pojistka: po 4 h hlídání zahodit

    // dlaždice, po kterých se do Nástrojů NEVRACÍME (režim mapy / externí okno)
    var NO_BACK = {
        'startAreaMode': 1, 'openKatastr': 1, 'openDronView': 1, 'startMapPick': 1,
        'openNewPointModal': 1, 'agOpenTutorialPro': 1, 'startTutorial': 1
    };
    // prvky, které se tváří jako otevřené okno, ale nejsou nástroj
    var SKIP_IDS = {
        'tools-modal': 1, 'welcome-screen': 1, 'ag-gate': 1, 'ag-login': 1,
        'qr-scan-modal': 0, 'update-banner': 1, 'compass-interference': 1
    };

    var _armed = 0, _seenOpen = false;
    var _timer = null;

    function toolsModal() { return document.getElementById('tools-modal'); }

    // jedno místo pro otevření Nástrojů (dřív to byl inline kód na třech místech)
    window.agOpenTools = function () {
        var m = toolsModal(); if (!m) return;
        m.style.display = 'flex';
    };

    function shown(el) {
        if (!el) return false;
        // offsetParent je null u display:none i u skrytého rodiče; position:fixed prvky
        // ho mají null taky, proto ještě kontrola rozměrů
        try {
            var cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        } catch (e) { return false; }
    }

    // Je otevřené JAKÉKOLI okno nástroje? Kromě klasických .modal-overlay sem patří
    // i vlastní celoobrazovkové vrstvy modulů (počasí, kubatury, předpisy, zpravodaj…)
    // a režimy sběru bodů z mapy, kdy je vlastní modál dočasně schovaný.
    function anyToolOpen() {
        var sel = '.modal-overlay, .ag-dlg-overlay, [id$="-overlay"], [id$="-modal"], [id*="pick"], #side-menu.open, #bottom-sheet.open';
        var nodes;
        try { nodes = document.querySelectorAll(sel); } catch (e) { return false; }
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (SKIP_IDS[n.id]) continue;
            if (n.id === 'tools-modal') continue;
            if (shown(n)) return true;
        }
        return false;
    }

    function disarm() {
        _armed = 0; _seenOpen = false;
        if (_timer) { clearInterval(_timer); _timer = null; }
    }

    function watch() {
        if (_timer) return;
        _timer = setInterval(function () {
            if (!_armed) { disarm(); return; }
            var age = Date.now() - _armed;
            if (age > MAX_MS) { disarm(); return; }
            var open = anyToolOpen();
            if (open) { _seenOpen = true; return; }
            // nic není otevřené
            if (!_seenOpen) {
                // nástroj se do ARM_MS vůbec neotevřel → nebyl to modál (režim mapy apod.)
                if (age > ARM_MS) disarm();
                return;
            }
            disarm();
            window.agOpenTools();
        }, POLL_MS);
    }

    // klíč dlaždice: data-tool u injektovaných, jinak název funkce z onclick
    function tileKey(tile) {
        var k = tile.getAttribute('data-tool');
        if (k) return k;
        var oc = tile.getAttribute('onclick') || '';
        var m = oc.match(/([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?\s*$/);
        return m ? m[1] : '';
    }

    document.addEventListener('click', function (e) {
        var tile = e.target && e.target.closest ? e.target.closest('#tools-modal .tool-tile') : null;
        if (!tile) return;
        if (document.body.classList.contains('ag-tp-edit')) return;        // režim úprav oblíbených
        if (e.target.closest('.ag-tp-star') || e.target.closest('.ag-tp-help')) return;
        var k = tileKey(tile);
        if (NO_BACK[k]) { disarm(); return; }
        _armed = Date.now(); _seenOpen = false;
        watch();
    }, true);

    window.AGToolsBack = { open: window.agOpenTools, disarm: disarm };
})();
