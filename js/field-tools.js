// ===== AR Geodet — TERÉNNÍ NÁSTROJE: dlaždice v sekci „Nástroje" (ODPOJITELNÁ) ==
// Neinvazivní vrstva ve stylu js/gps-warn.js / js/kml-export.js: NEEDITUJE
// logika.js ani grafika.js. Ostatní moduly (orientace přes bod, offset bodu,
// stopa trasy, vytyčení přímky, AR resekce, import projektu, katastr, parcela…)
// se REGISTRUJÍ přes
//   window.agRegisterFieldTool({ id, label, icon, onClick, order, cat })
// a tento launcher je vykreslí jako DLAŽDICE přímo do mřížky v modalu „Nástroje"
// (#tools-modal .tool-grid), pod oddělovací nadpis „Terénní nástroje".
// Volitelné `cat: 'Pomůcky'` zařadí dlaždici na konec existující statické
// kategorie (.tool-cat se stejným názvem) místo sekce „Terénní nástroje".
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
    function makeTile(it) {
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
        return btn;
    }
    // Vloží dlaždici na KONEC pojmenované statické kategorie (např. cat: 'Pomůcky').
    // Vrací false, když kategorie v mřížce není — dlaždice pak spadne do „Terénní nástroje".
    function placeInCategory(grid, it) {
        var cats = grid.querySelectorAll('.tool-cat');
        for (var i = 0; i < cats.length; i++) {
            if ((cats[i].textContent || '').trim() !== it.cat) continue;
            // konec bloku kategorie = další nadpis (.tool-cat / .ag-ft-head), jinak konec mřížky
            var node = cats[i].nextSibling;
            while (node) {
                if (node.nodeType === 1 && node.classList &&
                    (node.classList.contains('tool-cat') || node.classList.contains('ag-ft-head'))) break;
                node = node.nextSibling;
            }
            grid.insertBefore(makeTile(it), node);
            return true;
        }
        return false;
    }
    function syncTiles() {
        var grid = getGrid();
        if (!grid) return;
        injectStyles();
        // odstraň dříve injektované prvky (idempotentní)
        var old = grid.querySelectorAll('.ag-ft-tile, .ag-ft-head');
        for (var i = 0; i < old.length; i++) old[i].remove();
        if (!_items.length) return;

        var sorted = _items.slice().sort(function (a, b) { return (a.order || 50) - (b.order || 50); });
        // dlaždice s cat jdou do své statické kategorie, zbytek pod „Terénní nástroje"
        var rest = sorted.filter(function (it) { return !(it.cat && placeInCategory(grid, it)); });
        if (rest.length) {
            var head = document.createElement('div');
            head.className = 'ag-ft-head';
            head.textContent = 'Terénní nástroje';
            grid.appendChild(head);
            rest.forEach(function (it) { grid.appendChild(makeTile(it)); });
        }
        try { applyFilter(); } catch (e) {}   // znovu aplikuj aktivní hledání i na čerstvě vložené dlaždice
    }

    // ---- vyhledávání nástroje podle názvu --------------------------------------
    function norm(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
        return s.replace(/\s+/g, ' ').trim();
    }
    function applyFilter() {
        var grid = getGrid(); if (!grid) return;
        var inp = document.getElementById('tools-search');
        var q = norm(inp ? inp.value : '');
        var kids = grid.children, lastHead = null, headHasHit = false;
        function flushHead() { if (lastHead) lastHead.style.display = headHasHit ? '' : 'none'; }
        for (var i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (el.classList.contains('tool-cat') || el.classList.contains('ag-ft-head')) {
                flushHead(); lastHead = el; headHasHit = false; continue;
            }
            if (el.classList.contains('tool-tile') || el.classList.contains('ag-ft-tile')) {
                var hit = !q || norm(el.textContent).indexOf(q) !== -1;
                el.style.display = hit ? '' : 'none';
                if (hit) headHasHit = true;
            }
        }
        flushHead();
    }
    window.agFilterTools = applyFilter;

    // ---- veřejné API: registrace nástroje --------------------------------------
    window.agRegisterFieldTool = function (item) {
        if (!item || !item.id || typeof item.onClick !== 'function') return;
        // přepsat existující se stejným id (idempotentní při dvojím initu modulu)
        _items = _items.filter(function (x) { return x.id !== item.id; });
        _items.push({ id: item.id, label: item.label || item.id, icon: item.icon || '', onClick: item.onClick, order: item.order, cat: item.cat || '' });
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
    var _wasOpen = false;
    function tick() {
        try {
            if (needsSync()) syncTiles();
            // Vyhledávání vyresetuj při zavření modalu, ať se příště otevře čisté.
            var m = document.getElementById('tools-modal');
            var open = !!(m && m.style.display !== 'none' && m.style.display !== '');
            var inp = document.getElementById('tools-search');
            if (_wasOpen && !open && inp && inp.value) { inp.value = ''; applyFilter(); }
            _wasOpen = open;
        } catch (e) {}
    }

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
