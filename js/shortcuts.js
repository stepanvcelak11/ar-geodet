// ===== AR Geodet — ZKRATKY Z PLOCHY TELEFONU (ODPOJITELNÁ) =====
// Dlouhé podržení ikony appky (PWA/TWA "app shortcuts" z manifest.json) nabídne:
//   • Nový bod    → ?zkratka=novy-bod    (spustí appku a otevře formulář nového bodu)
//   • Pokračovat  → ?zkratka=pokracovat  (klikne na tlačítko „Pokračovat" z js/pokracovat.js,
//                                         případně rovnou otevře poslední nástroj)
//   • Docházka    → ?zkratka=dochazka    (otevře píchačky z js/dochazka.js; jen firemní režim)
//
// Parametr se HNED po přečtení odstraní z adresy (history.replaceState), aby
// obnovení stránky akci neopakovalo. Firemní zámek (html.ag-prelock + overlaye
// #ag-login / #ag-gate z js/ucty.js) se NEOBCHÁZÍ — akce čeká, dokud se uživatel
// nepřihlásí; když se nepřihlásí do ~2 minut, akce tiše propadne.
// NEEDITUJE logika.js/grafika.js — jen volá existující globály
// (startAppFromWelcome, openNewPointModal, AGDochazka.open) a klape na tlačítka.
// Odstranění: smaž js/shortcuts.js + řádek <script> v index.html + blok
// "shortcuts" v manifest.json (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agShortcutsInit) return;
    window.__agShortcutsInit = true;

    // ---- přečtení a okamžité smazání parametru z URL ---------------------------------
    var action = null;
    try {
        var q = String(window.location.search || '');
        var m = /[?&]zkratka=([^&]*)/.exec(q);
        if (m) {
            try { action = decodeURIComponent(m[1]); } catch (e) { action = m[1]; }
            // adresa bez parametru zkratka (ostatní parametry zůstávají)
            var parts = q.replace(/^\?/, '').split('&');
            var keep = [];
            for (var i = 0; i < parts.length; i++) {
                if (parts[i] && parts[i].indexOf('zkratka=') !== 0) keep.push(parts[i]);
            }
            var clean = window.location.pathname + (keep.length ? '?' + keep.join('&') : '') + (window.location.hash || '');
            try { window.history.replaceState(null, '', clean); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'shortcuts'); }
        }
    } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'shortcuts'); }
    if (action !== 'novy-bod' && action !== 'pokracovat' && action !== 'dochazka') return;

    // ---- pomocníci --------------------------------------------------------------------
    function toast(msg) {
        try { if (typeof window.quickToast === 'function') return window.quickToast(msg); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'shortcuts:toast'); }
        try { agInfo(msg); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'shortcuts:toast'); }
    }
    // firemní zámek: stejná podmínka, jakou používá samo ucty.js — třída ag-prelock
    // pryč a žádný přihlašovací overlay v DOM (po úspěšném přihlášení se odstraní)
    function gateClear() {
        try {
            if (document.documentElement.classList.contains('ag-prelock')) return false;
            if (document.getElementById('ag-login')) return false;
            if (document.getElementById('ag-gate')) return false;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'shortcuts:gateClear'); }
        return true;
    }
    function appStarted() { return !!(document.body && document.body.classList.contains('app-started')); }
    function welcomeVisible() {
        var ws = document.getElementById('welcome-screen');
        if (!ws) return false;
        try { return getComputedStyle(ws).display !== 'none'; } catch (e) { return ws.style.display !== 'none'; }
    }
    // jednorázové čekání na podmínku (poll 300 ms, ohraničené timeoutem — samo se uklidí)
    function waitFor(cond, timeoutMs, cb) {
        var ok = false;
        try { ok = !!cond(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'shortcuts:waitFor'); }
        if (ok) { cb(true); return; }
        var waited = 0;
        var t = setInterval(function () {
            waited += 300;
            var fine = false;
            try { fine = !!cond(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'shortcuts:waitFor'); }
            if (fine) { clearInterval(t); cb(true); }
            else if (waited >= timeoutMs) { clearInterval(t); cb(false); }
        }, 300);
    }
    function startApp() {
        if (appStarted()) return;
        try { if (typeof window.startAppFromWelcome === 'function') window.startAppFromWelcome(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'shortcuts:startApp'); }
    }

    // klíč dlaždice v Nástrojích — stejná logika jako js/pokracovat.js / tools-plus.js
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool');
        if (dt) return dt;
        var oc = tile.getAttribute('onclick') || '';
        var ms = oc.match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function findTile(key) {
        var modal = document.getElementById('tools-modal');
        var grid = modal ? modal.querySelector('.tool-grid') : null;
        if (!grid) return null;
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) { if (tileKey(tiles[i]) === key) return tiles[i]; }
        return null;
    }
    function lastToolRec() {
        var raw; try { raw = localStorage.getItem('agLastTool_v1'); } catch (e) { return null; }
        if (!raw) return null;
        var r; try { r = JSON.parse(raw); } catch (e) { return null; }
        return (r && r.key) ? r : null;
    }

    // ---- akce ---------------------------------------------------------------------------
    // NOVÝ BOD: (po odemčení) spustit appku a otevřít modál vložení bodu
    function runNovyBod() {
        // firemní režim může po přihlášení appku spustit sám (enterApp v ucty.js) —
        // krátce počkat, ať se startAppFromWelcome nevolá dvakrát
        waitFor(appStarted, 900, function (auto) {
            if (!auto) startApp();
            waitFor(appStarted, 20000, function (ok) {
                if (!ok) return;
                setTimeout(function () {
                    try {
                        if (typeof window.openNewPointModal === 'function') { window.openNewPointModal(); return; }
                    } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'shortcuts:runNovyBod'); }
                    toast('Formulář nového bodu se nepodařilo otevřít.');
                }, 900);
            });
        });
    }

    // POKRAČOVAT: kliknout na tlačítko z js/pokracovat.js; když appka mezitím
    // najela sama (firemní režim), otevřít poslední nástroj přímo; jinak jen start
    function runPokracovat() {
        function btnOn() { var b = document.getElementById('ag-pk-btn'); return !!(b && b.classList.contains('on')); }
        waitFor(function () { return btnOn() || appStarted(); }, 8000, function () {
            if (appStarted()) {
                var rec = lastToolRec();
                var tile = rec ? findTile(rec.key) : null;
                if (tile) setTimeout(function () { try { tile.click(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'shortcuts:btnOn'); } }, 900);
                return;
            }
            var b = document.getElementById('ag-pk-btn');
            if (b && b.classList.contains('on')) { try { b.click(); return; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'shortcuts:btnOn'); } }
            startApp();   // záložní cesta: bez záznamu aspoň spustit appku
        });
    }

    // DOCHÁZKA: otevřít píchačky (bez firemního režimu jen vysvětlit)
    function runDochazka() {
        setTimeout(function () {   // ucty.js po odemčení chvilku srovnává stav
            var U = window.AGUcty;
            if (!U || typeof U.getFirm !== 'function' || !U.getFirm()) {
                toast('Docházka funguje jen ve firemním režimu (Nástroje → Firma a účty).');
                return;
            }
            waitFor(function () { return !!(window.AGDochazka && window.AGDochazka.open); }, 5000, function (ok) {
                if (!ok) { toast('Modul docházky se nepodařilo načíst.'); return; }
                try { window.AGDochazka.open(); } catch (e) { return; }
                // úvodní obrazovka má z-index 999999 — když je ještě vidět,
                // musí modál docházky vystoupit nad ni (píchnout jde i bez startu AR)
                if (welcomeVisible() && !appStarted()) {
                    var mdl = document.getElementById('agdo-modal');
                    if (mdl) mdl.style.zIndex = '1000001';
                }
            });
        }, 400);
    }

    // ---- start: napřed počkat na firemní zámek, pak teprve akce -------------------------
    function boot() {
        waitFor(gateClear, 120000, function (ok) {
            if (!ok) return;   // uživatel se nepřihlásil — zkratka tiše propadá
            if (action === 'novy-bod') runNovyBod();
            else if (action === 'pokracovat') runPokracovat();
            else if (action === 'dochazka') runDochazka();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
