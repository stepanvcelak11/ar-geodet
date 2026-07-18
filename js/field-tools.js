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
    var COLL_KEY = 'agToolCatsClosed_v1';   // sbalené kategorie (názvy)
    var USE_KEY = 'agToolUsage_v1';         // počítadlo použití nástrojů (klíč -> počet)
    var _items = [];          // {id,label,icon,onClick,order}

    // Kategorie pro injektované nástroje, které si ji samy neurčí (cat v registraci
    // má přednost). Neznámé id spadnou do záchytné sekce „Terénní nástroje".
    var TOOL_CATS = {
        'brutal-gps': 'Měření', 'vyska-objektu': 'Měření', 'rangefinder': 'Měření',
        'epochy': 'Měření', 'zapisnik': 'Měření', 'track-log': 'Měření',
        'stakeout-line': 'Vytyčování a náčrt', 'offset-point': 'Vytyčování a náčrt', 'vrstvy': 'Vytyčování a náčrt',
        'cadastre-vector': 'Katastr a data', 'parcela': 'Katastr a data', 'project-import': 'Katastr a data', 'geo-overlay': 'Katastr a data',
        'ar-resection': 'AR a kalibrace', 'ar-intersection': 'AR a kalibrace', 'orient-point': 'AR a kalibrace',
        'postupy': 'Pomůcky', 'urovnani': 'Pomůcky'
    };

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
            '#tools-modal .ag-ft-tile svg{width:24px;height:24px;color:var(--accent,#2f9e74);}',
            '#tools-modal .ag-ft-tile span{display:block;}',
            // sbalitelné kategorie: nadpis je klikací, šipka ukazuje stav
            '#tools-modal .tool-cat,#tools-modal .ag-ft-head{cursor:pointer;-webkit-user-select:none;user-select:none;}',
            '#tools-modal .tool-cat:not(#ag-fav-head)::after,#tools-modal .ag-ft-head::after{content:"▾";float:right;font-size:11px;color:var(--text-muted,#9aa1ac);}',
            '#tools-modal .ag-cat-closed::after{content:"▸" !important;}',
            // řádek „Nejčastější" pod vyhledáváním
            '#ag-ft-freq{display:none;flex-wrap:wrap;align-items:center;gap:6px;margin:2px 0 10px;}',
            '#ag-ft-freq.on{display:flex;}',
            '#ag-ft-freq .ag-ft-freq-l{font:700 11px/1 var(--font-display,system-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#ag-ft-freq .ag-ft-chip{border:1px solid var(--accent-line,rgba(47,158,116,0.42));background:var(--accent-soft,rgba(47,158,116,0.14));',
            '  color:var(--accent,#2f9e74);border-radius:999px;padding:8px 13px;font:600 12.5px/1 var(--font-ui,system-ui);cursor:pointer;}',
            'body.ag-tp-edit #ag-ft-freq{display:none !important;}'
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
    function loadClosed() { try { var a = JSON.parse(localStorage.getItem(COLL_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function saveClosed(a) { try { localStorage.setItem(COLL_KEY, JSON.stringify(a)); } catch (e) {} }
    function applyFilter() {
        var grid = getGrid(); if (!grid) return;
        var inp = document.getElementById('tools-search');
        var q = norm(inp ? inp.value : '');
        var closed = loadClosed();
        var kids = grid.children, lastHead = null, headHasHit = false, secClosed = false;
        // při hledání se sbalení ignoruje (ukázat zásahy), bez hledání se nadpisy nechávají vidět
        function flushHead() { if (lastHead) lastHead.style.display = (q && !headHasHit) ? 'none' : ''; }
        for (var i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (el.classList.contains('tool-cat') || el.classList.contains('ag-ft-head')) {
                flushHead(); lastHead = el; headHasHit = false;
                secClosed = !q && el.id !== 'ag-fav-head' && closed.indexOf((el.textContent || '').trim()) !== -1;
                el.classList.toggle('ag-cat-closed', secClosed);
                continue;
            }
            if (el.classList.contains('tool-tile') || el.classList.contains('ag-ft-tile')) {
                var hit = !q || norm(el.textContent).indexOf(q) !== -1;
                el.style.display = (hit && !secClosed) ? '' : 'none';
                if (hit) headHasHit = true;
            }
        }
        flushHead();
    }
    window.agFilterTools = applyFilter;
    // klepnutí na nadpis kategorie = sbalit/rozbalit (mimo ★ Oblíbené)
    document.addEventListener('click', function (e) {
        var head = e.target.closest ? e.target.closest('#tools-modal .tool-cat, #tools-modal .ag-ft-head') : null;
        if (!head || head.id === 'ag-fav-head') return;
        var name = (head.textContent || '').trim(); if (!name) return;
        var closed = loadClosed(); var ix = closed.indexOf(name);
        if (ix === -1) closed.push(name); else closed.splice(ix, 1);
        saveClosed(closed); applyFilter();
    });

    // ---- počítadlo použití + řádek „Nejčastější" --------------------------------
    function loadUsage() { try { var o = JSON.parse(localStorage.getItem(USE_KEY)); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    function tileToolKey(tile) {
        var dt = tile.getAttribute('data-tool'); if (dt) return dt;
        var ms = (tile.getAttribute('onclick') || '').match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;   // poslední volaná funkce = otevření nástroje
    }
    function tileToolLabel(tile) {
        var s = tile.querySelector('span');
        var d = document.createElement('div');
        d.innerHTML = ((s ? s.innerHTML : tile.innerHTML) || '').replace(/<br\s*\/?>/gi, ' ');   // <br> v názvu = mezera
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function bumpUsage(key) { try { var u = loadUsage(); u[key] = (u[key] || 0) + 1; localStorage.setItem(USE_KEY, JSON.stringify(u)); } catch (e) {} }
    document.addEventListener('click', function (e) {
        if (document.body.classList.contains('ag-tp-edit')) return;   // režim úprav oblíbených nepočítat
        var tile = e.target.closest ? e.target.closest('#tools-modal .tool-tile') : null;
        if (!tile || e.target.closest('.ag-tp-star') || e.target.closest('.ag-tp-help')) return;
        var k = tileToolKey(tile); if (k) bumpUsage(k);
    });
    var _freqSig = '';
    function renderFreq() {
        var m = document.getElementById('tools-modal'); if (!m) return;
        var inp = document.getElementById('tools-search'); if (!inp) return;
        var row = document.getElementById('ag-ft-freq');
        if (!row) {
            row = document.createElement('div'); row.id = 'ag-ft-freq';
            inp.parentNode.insertBefore(row, inp.nextSibling);
        }
        var u = loadUsage();
        var top = Object.keys(u).filter(function (k) { return u[k] >= 2; })
            .sort(function (a, b) { return u[b] - u[a]; }).slice(0, 4);
        // SEED: dokud si uzivatel „nenaklika" vlastni, nabidni bezne DENNI nastroje na 1 tap
        // (mereni vzdalenosti/plochy, omerne, vytycovani) — jinak je vsechny schovava zed 35 dlazdic.
        var DEFAULTS = ['openMeasureModal', 'startAreaMode', 'openCheckDist', 'openStakeoutModal'];
        for (var di = 0; di < DEFAULTS.length && top.length < 4; di++) { if (top.indexOf(DEFAULTS[di]) === -1) top.push(DEFAULTS[di]); }
        var grid = getGrid();
        var chips = [];
        top.forEach(function (k) {
            var tiles = grid ? grid.querySelectorAll('.tool-tile') : [];
            for (var i = 0; i < tiles.length; i++) {
                if (tileToolKey(tiles[i]) === k) { chips.push({ key: k, label: tileToolLabel(tiles[i]), tile: tiles[i] }); break; }
            }
        });
        var sig = chips.map(function (c) { return c.key; }).join('|');
        if (sig === _freqSig && row.childNodes.length) { return; }
        _freqSig = sig;
        row.innerHTML = '';
        row.classList.toggle('on', chips.length >= 2);
        if (chips.length < 2) return;
        var l = document.createElement('span'); l.className = 'ag-ft-freq-l'; l.textContent = 'Nejčastější'; row.appendChild(l);
        chips.forEach(function (c) {
            var b = document.createElement('button'); b.type = 'button'; b.className = 'ag-ft-chip'; b.textContent = c.label;
            b.addEventListener('click', function () {
                var grid2 = getGrid(); if (!grid2) return;
                var tiles = grid2.querySelectorAll('.tool-tile');
                for (var i = 0; i < tiles.length; i++) { if (tileToolKey(tiles[i]) === c.key) { tiles[i].click(); return; } }
            });
            row.appendChild(b);
        });
    }

    // ---- veřejné API: registrace nástroje --------------------------------------
    window.agRegisterFieldTool = function (item) {
        if (!item || !item.id || typeof item.onClick !== 'function') return;
        // přepsat existující se stejným id (idempotentní při dvojím initu modulu)
        _items = _items.filter(function (x) { return x.id !== item.id; });
        _items.push({ id: item.id, label: item.label || item.id, icon: item.icon || '', onClick: item.onClick, order: item.order, cat: item.cat || TOOL_CATS[item.id] || '' });
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
            renderFreq();
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
