// ===== AR Geodet — POKRAČOVAT, KDE JSEM SKONČIL (ODPOJITELNÁ) =====
// Denní rutina: otevřít appku → vybrat zakázku → Spustit → Nástroje → najít dlaždici.
// Tenhle modul si pamatuje POSLEDNÍ použitý nástroj (klepnutí na dlaždici v modálu
// Nástroje) včetně zakázky a na úvodní obrazovce nabídne jedno tlačítko
// „Pokračovat: <nástroj> · <zakázka>" — jeden ťuk přepne zakázku, spustí appku
// a otevře nástroj.
//
// Doplňuje (neduplikuje) draft-store.js: draft bar řeší ROZDĚLANÝ STAV uvnitř
// vícekrokových úloh po startu, tohle řeší CESTU k nástroji před startem.
// Záznam max 48 h starý; nic jiného se neukládá (jen localStorage, offline).
// NEEDITUJE logika.js/grafika.js — jen volá existující globály
// (changeProject, startAppFromWelcome) a klapi na dlaždici.
// Odstranění: smaž js/pokracovat.js + řádek <script> v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agPkInit) return;
    window.__agPkInit = true;

    var KEY = 'agLastTool_v1';
    var MAX_AGE_MS = 48 * 3600 * 1000;
    var STYLE_ID = 'ag-pk-style';

    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function loadRec() {
        var raw; try { raw = localStorage.getItem(KEY); } catch (e) { return null; }
        if (!raw) return null;
        var r; try { r = JSON.parse(raw); } catch (e) { return null; }
        if (!r || !r.key || !r.ts || (Date.now() - r.ts) > MAX_AGE_MS) return null;
        return r;
    }
    function saveRec(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {} }

    function getGrid() { var m = document.getElementById('tools-modal'); return m ? m.querySelector('.tool-grid') : null; }
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool');
        if (dt) return dt;
        var oc = tile.getAttribute('onclick') || '';
        var ms = oc.match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function tileLabel(tile) {
        var s = tile.querySelector('span');
        var d = document.createElement('div');
        d.innerHTML = ((s ? s.innerHTML : '') || '').replace(/<br\s*\/?>/gi, ' ');
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function findTile(key) {
        var grid = getGrid(); if (!grid) return null;
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) { if (tileKey(tiles[i]) === key) return tiles[i]; }
        return null;
    }
    function projName(id) {
        var sel = document.getElementById('w-project-select');
        if (sel) for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === id) return sel.options[i].text; }
        return null;
    }
    function relAge(ts) {
        var min = Math.round((Date.now() - ts) / 60000);
        if (min < 2) return 'právě teď';
        if (min < 60) return 'před ' + min + ' min';
        var h = Math.round(min / 60);
        if (h < 24) return 'před ' + h + ' h';
        return 'včera';
    }

    // ---- záznam posledního nástroje (klepnutí na dlaždici v Nástrojích) --------------
    document.addEventListener('click', function (e) {
        if (document.body.classList.contains('ag-tp-edit')) return;   // režim úprav oblíbených
        var tile = e.target.closest ? e.target.closest('#tools-modal .tool-tile') : null;
        if (!tile || e.target.closest('.ag-tp-star') || e.target.closest('.ag-tp-help')) return;
        var key = tileKey(tile); if (!key) return;
        saveRec({ pid: pid(), key: key, label: tileLabel(tile) || key, ts: Date.now() });
    });

    // ---- tlačítko na úvodní obrazovce -------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-pk-btn{display:none;width:100%;margin:0;padding:11px 14px;border-radius:14px;cursor:pointer;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.4));background:var(--accent-soft,rgba(47,158,116,0.12));',
            '  color:var(--text-color,#eceef2);text-align:left;font:600 14px/1.3 var(--font-ui,system-ui),sans-serif;}',
            '#ag-pk-btn.on{display:block;}',
            '#ag-pk-btn small{display:block;margin-top:2px;font-weight:500;font-size:11.5px;color:var(--text-muted,#9aa1ac);}',
            '#ag-pk-btn b{color:var(--accent,#2f9e74);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }
    function ensureBtn() {
        var btn = document.getElementById('ag-pk-btn');
        if (btn) return btn;
        var actions = document.querySelector('#welcome-screen .w-c-actions');
        if (!actions) return null;
        btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'ag-pk-btn';
        btn.addEventListener('click', resume);
        // hned pod hlavní Start — je to nejpravděpodobnější ranní akce
        var start = actions.querySelector('#welcome-start-btn');
        if (start && start.nextSibling) actions.insertBefore(btn, start.nextSibling);
        else actions.appendChild(btn);
        return btn;
    }
    function refreshBtn() {
        injectStyles();
        var btn = ensureBtn(); if (!btn) return;
        var ws = document.getElementById('welcome-screen');
        var visible = ws && getComputedStyle(ws).display !== 'none';
        var rec = visible ? loadRec() : null;
        if (!rec) { btn.classList.remove('on'); return; }
        var pn = (rec.pid !== pid()) ? projName(rec.pid) : null;
        if (rec.pid !== pid() && !pn) { btn.classList.remove('on'); return; }   // zakázka už neexistuje
        btn.innerHTML = '▶ Pokračovat: <b></b><small></small>';
        btn.querySelector('b').textContent = rec.label;
        btn.querySelector('small').textContent = (pn ? 'zakázka ' + pn + ' · ' : '') + relAge(rec.ts);
        btn.classList.add('on');
    }

    // ---- obnovení: zakázka → start → nástroj -------------------------------------------
    function resume() {
        var rec = loadRec(); if (!rec) return;
        try {
            if (rec.pid !== pid()) {
                var sel = document.getElementById('w-project-select');
                if (sel && projName(rec.pid) != null) {
                    sel.value = rec.pid;
                    if (typeof window.changeProject === 'function') changeProject();
                }
            }
        } catch (e) {}
        // start s malým odstupem, ať se přepnutí zakázky stihne rozběhnout
        setTimeout(function () {
            try { if (typeof window.startAppFromWelcome === 'function') startAppFromWelcome(); } catch (e) {}
            var waited = 0;
            var t = setInterval(function () {
                waited += 500;
                var started = document.body && document.body.classList.contains('app-started');
                if (started) {
                    clearInterval(t);
                    setTimeout(function () {
                        var tile = findTile(rec.key);
                        if (tile) tile.click();   // dlaždice sama zavře modál a otevře nástroj
                        else if (typeof window.quickToast === 'function') { try { quickToast('Nástroj „' + rec.label + '" se nepodařilo najít.'); } catch (e) {} }
                    }, 900);
                } else if (waited >= 20000) clearInterval(t);
            }, 500);
        }, rec.pid !== pid() ? 700 : 0);
    }

    // ---- údržba ---------------------------------------------------------------------------
    function init() {
        try { refreshBtn(); } catch (e) { console.warn('[pokracovat] init', e); }
        if (!window.__agPkTimer) window.__agPkTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () {
            try { refreshBtn(); } catch (e) {}
        }, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });
})();
