// ===== QTRIG — KARTA BODU, eager shim (obaluje showDetails z grafika.js) ===================
// Obsah karty (mozaika dat, náčrt okolí nad mapou, tažení za proužek) je v ODLOŽENÉM
// js/karta-bodu-plus.js (~40 kB, do rozpočtu startu se nevejde). Tenhle shim jen zachytí
// otevření karty a obsah dotáhne přes AGLazy.need — poprvé o zlomek vteřiny později,
// pak už je modul v paměti. Odstranění: smaž oba soubory + řádky v index.html a sw.js.
// ============================================================================================
(function () {
    'use strict';
    if (window.AGKartaBodu) return;
    var PLUS = 'js/karta-bodu-plus.js';

    function render(pt) {
        window.__agKbCekaBod = pt;
        var go = function () {
            var P = window.AGKartaBoduPlus;
            if (P) { window.__agKbCekaBod = null; try { P.render(pt); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:render'); } return true; }
            return false;
        };
        if (go()) return;
        var n = 0, t = setInterval(function () { if (go() || ++n > 60 || window.__agKbCekaBod !== pt) clearInterval(t); }, 100);
        try { if (window.AGLazy && typeof AGLazy.need === 'function') AGLazy.need(PLUS, go); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:need'); }
    }
    function wrap() {
        if (window.__agKbWrapped || typeof window.showDetails !== 'function') return;
        var orig = window.showDetails;
        window.showDetails = function (pt, distance) {
            var r = orig.apply(this, arguments);
            try { var bs = document.getElementById('bottom-sheet'); if (pt && bs && bs.classList.contains('open')) render(pt); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:showDetails'); }
            return r;
        };
        window.__agKbWrapped = true;
    }
    function init() {
        wrap();
        if (!window.__agKbWatch0) {
            window.__agKbWatch0 = setInterval(wrap, 1500);
            setTimeout(function () { clearInterval(window.__agKbWatch0); window.__agKbWatch0 = 0; }, 15000);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });

    window.AGKartaBodu = { render: render, refresh: function () { var P = window.AGKartaBoduPlus; if (P) P.refresh(); } };
})();
