// ===== AR Geodet — TERÉNNÍ NÁSTROJE: dlaždice v sekci „Nástroje" (ODPOJITELNÁ) ==
// Neinvazivní vrstva ve stylu js/gps-warn.js / js/kml-export.js: NEEDITUJE
// logika.js ani grafika.js. Ostatní moduly (orientace přes bod, offset bodu,
// stopa trasy, vytyčení přímky, AR resekce, import projektu, katastr, parcela…)
// se REGISTRUJÍ přes
//   window.agRegisterFieldTool({ id, label, icon, onClick, order })
// a tento launcher je vykreslí jako DLAŽDICE přímo do mřížky v modalu „Nástroje"
// (#tools-modal .tool-grid), pod oddělovací nadpis „Terénní nástroje".
// Když tento soubor chybí, každý modul si vyrobí vlastní nouzové tlačítko, takže
// je každý odpojitelný samostatně.
//
// Odstranění: smaž js/field-tools.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var STYLE_ID = 'ag-ft-style';
    var _items = [];          // {id,label,icon,onClick,order}

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }

    // ---- styly (injektované, ať se nesahá do style.css) ------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // oddělovací nadpis přes celou šířku mřížky
            '#tools-modal .ag-ft-head{grid-column:1/-1;margin:8px 2px 0;padding-top:8px;border-top:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  font:700 11px/1 var(--font-display,system-ui),sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);text-align:left;}',
            // ikona uvnitř injektované dlaždice (moduly dodávají <svg> bez rozměrů)
            '#tools-modal .ag-ft-tile svg{width:24px;height:24px;color:var(--accent,#34d399);}',
            '#tools-modal .ag-ft-tile span{display:block;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function getGrid() {
        var m = document.getElementById('tools-modal');
        return m ? m.querySelector('.tool-grid') : null;
    }
    function closeToolsModal() { var m = document.getElementById('tools-modal'); if (m) m.style.display = 'none'; }

    // ---- vykreslení dlaždic do mřížky Nástrojů --------------------------------
    function syncTiles() {
        var grid = getGrid();
        if (!grid) return;
        injectStyles();
        // odstraň dříve injektované prvky (idempotentní)
        var old = grid.querySelectorAll('.ag-ft-tile, .ag-ft-head');
        for (var i = 0; i < old.length; i++) old[i].remove();
        if (!_items.length) return;

        var sorted = _items.slice().sort(function (a, b) { return (a.order || 50) - (b.order || 50); });
        var head = document.createElement('div');
        head.className = 'ag-ft-head';
        head.textContent = 'Terénní nástroje';
        grid.appendChild(head);

        sorted.forEach(function (it) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tool-tile ag-ft-tile';
            btn.setAttribute('data-tool', it.id);
            btn.innerHTML = (it.icon || '') + '<span>' + esc(it.label) + '</span>';
            btn.addEventListener('click', function () {
                closeToolsModal();
                if (typeof it.onClick === 'function') {
                    try { it.onClick(); } catch (err) { console.warn('[field-tools]', err); }
                }
            });
            grid.appendChild(btn);
        });
    }

    // ---- veřejné API: registrace nástroje --------------------------------------
    window.agRegisterFieldTool = function (item) {
        if (!item || !item.id || typeof item.onClick !== 'function') return;
        // přepsat existující se stejným id (idempotentní při dvojím initu modulu)
        _items = _items.filter(function (x) { return x.id !== item.id; });
        _items.push({ id: item.id, label: item.label || item.id, icon: item.icon || '', onClick: item.onClick, order: item.order });
        syncTiles();
    };
    // zpětná kompatibilita (dříve zavíralo plovoucí menu — teď není potřeba)
    window.agCloseFieldTools = function () {};

    // ---- bezpečnostní udržování dlaždic (kdyby se mřížka objevila/přerenderovala) -
    function needsSync() {
        var grid = getGrid();
        if (!grid) return false;
        return grid.querySelectorAll('.ag-ft-tile').length !== _items.length;
    }
    function tick() { try { if (needsSync()) syncTiles(); } catch (e) {} }

    function init() {
        try {
            syncTiles();
            if (!window.__agFtTimer) window.__agFtTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1500);
        } catch (e) { console.warn('[field-tools] init', e); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
