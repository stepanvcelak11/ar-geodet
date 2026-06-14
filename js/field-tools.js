// ===== AR Geodet — TERÉNNÍ NÁSTROJE: launcher (ODPOJITELNÁ vrstva) =============
// Neinvazivní vrstva ve stylu js/gps-warn.js / js/kml-export.js: NEEDITUJE
// logika.js ani grafika.js. Vytvoří jedno plovoucí tlačítko „Terénní nástroje"
// (vlevo nad dokem) a jednoduché vysouvací menu. Ostatní moduly (offset bodu,
// stopa trasy, orientace přes bod, vytyčení přímky) se do něj REGISTRUJÍ přes
//   window.agRegisterFieldTool({ id, label, icon, onClick, order })
// Když tento soubor chybí, každý modul si vyrobí vlastní nouzové tlačítko, takže
// je každý odpojitelný samostatně.
//
// Odstranění: smaž js/field-tools.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var FAB_ID = 'ag-ft-fab';
    var MENU_ID = 'ag-ft-menu';
    var _items = [];          // {id,label,icon,onClick,order}
    var _open = false;

    function isLive() { try { return (typeof appStarted !== 'undefined') && !!appStarted; } catch (e) { return false; } }

    // ---- styly (injektované, ať se nesahá do style.css) ------------------------
    function injectStyles() {
        if (document.getElementById('ag-ft-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-ft-style';
        st.textContent = [
            '#ag-ft-fab{position:fixed;left:12px;bottom:104px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;',
            '  background:var(--accent,#34d399);color:#04110b;display:none;align-items:center;justify-content:center;',
            '  box-shadow:0 6px 16px rgba(0,0,0,0.45);cursor:pointer;-webkit-tap-highlight-color:transparent;}',
            '#ag-ft-fab.show{display:flex;}',
            '#ag-ft-fab svg{width:24px;height:24px;}',
            '#ag-ft-fab.on{background:var(--surface-2,#1c2230);color:var(--accent,#34d399);outline:2px solid var(--accent,#34d399);}',
            '#ag-ft-menu{position:fixed;left:12px;bottom:160px;z-index:99991;display:none;flex-direction:column;gap:8px;',
            '  max-width:min(78vw,300px);}',
            '#ag-ft-menu.open{display:flex;}',
            '#ag-ft-menu .ag-ft-btn{display:flex;align-items:center;gap:10px;padding:11px 14px;border:none;border-radius:12px;',
            '  background:var(--surface-2,#1c2230);color:var(--text,#e8edf2);font:600 14px/1.1 var(--font,system-ui),sans-serif;',
            '  text-align:left;box-shadow:0 4px 14px rgba(0,0,0,0.4);cursor:pointer;}',
            '#ag-ft-menu .ag-ft-btn:active{transform:scale(0.98);}',
            '#ag-ft-menu .ag-ft-btn svg{width:20px;height:20px;flex:0 0 20px;color:var(--accent,#34d399);}',
            '#ag-ft-menu .ag-ft-head{font:700 11px/1 var(--font,system-ui),sans-serif;letter-spacing:.08em;text-transform:uppercase;',
            '  opacity:.6;color:var(--text,#e8edf2);padding:2px 4px 4px;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    function ensureFab() {
        var fab = document.getElementById(FAB_ID);
        if (fab) return fab;
        if (!document.body) return null;
        injectStyles();
        fab = document.createElement('button');
        fab.id = FAB_ID;
        fab.type = 'button';
        fab.setAttribute('aria-label', 'Terénní nástroje');
        fab.title = 'Terénní nástroje';
        fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            + '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="currentColor"/>'
            + '<circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/></svg>';
        fab.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
        document.body.appendChild(fab);

        var menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.setAttribute('role', 'menu');
        document.body.appendChild(menu);

        // klik mimo menu = zavřít
        document.addEventListener('click', function (e) {
            if (!_open) return;
            if (e.target && (e.target.closest('#' + MENU_ID) || e.target.closest('#' + FAB_ID))) return;
            close();
        });
        return fab;
    }

    function renderMenu() {
        var menu = document.getElementById(MENU_ID);
        if (!menu) return;
        var sorted = _items.slice().sort(function (a, b) { return (a.order || 50) - (b.order || 50); });
        var html = '<div class="ag-ft-head">Terénní nástroje</div>';
        sorted.forEach(function (it) {
            html += '<button type="button" class="ag-ft-btn" data-tool="' + it.id + '">'
                + (it.icon || '') + '<span>' + it.label + '</span></button>';
        });
        menu.innerHTML = html;
        menu.querySelectorAll('.ag-ft-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-tool');
                var it = _items.filter(function (x) { return x.id === id; })[0];
                close();
                if (it && typeof it.onClick === 'function') { try { it.onClick(); } catch (err) { console.warn('[field-tools]', err); } }
            });
        });
    }

    function toggle() { _open ? close() : open(); }
    function open() {
        ensureFab(); renderMenu();
        var menu = document.getElementById(MENU_ID), fab = document.getElementById(FAB_ID);
        if (menu) menu.classList.add('open');
        if (fab) fab.classList.add('on');
        _open = true;
    }
    function close() {
        var menu = document.getElementById(MENU_ID), fab = document.getElementById(FAB_ID);
        if (menu) menu.classList.remove('open');
        if (fab) fab.classList.remove('on');
        _open = false;
    }

    // ---- veřejné API: registrace nástroje --------------------------------------
    window.agRegisterFieldTool = function (item) {
        if (!item || !item.id || typeof item.onClick !== 'function') return;
        // přepsat existující se stejným id (idempotentní při dvojím initu modulu)
        _items = _items.filter(function (x) { return x.id !== item.id; });
        _items.push({ id: item.id, label: item.label || item.id, icon: item.icon || '', onClick: item.onClick, order: item.order });
        if (_open) renderMenu();
    };
    window.agCloseFieldTools = close;

    // ---- viditelnost FABu (jen po startu appky) --------------------------------
    function tick() {
        var fab = ensureFab();
        if (!fab) return;
        var show = isLive() && _items.length > 0;
        fab.classList.toggle('show', show);
        if (!show && _open) close();
    }

    function init() {
        try { ensureFab(); if (!window.__agFtTimer) window.__agFtTimer = setInterval(tick, 1000); tick(); }
        catch (e) { console.warn('[field-tools] init', e); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
