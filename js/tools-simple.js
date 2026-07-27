// ===== AR Geodet — JEDNODUCHÝ PANEL NÁSTROJŮ + TYP PRÁCE ZAKÁZKY (ODPOJITELNÁ) =====
// Panel Nástrojů má přes 50 dlaždic — pro běžný den v terénu zbytečně mnoho.
// Tenhle modul přidává dvě věci (obě čistě nad existující mřížkou #tools-modal,
// NEEDITUJE logika.js, grafika.js ani field-tools.js):
//
// 1) JEDNODUCHÝ REŽIM (přepínač v Nastavení → Vzhled → Ovládání):
//    v Nástrojích zůstane jen základní sada + ★ Oblíbené; zbytek schová.
//    Dole v mřížce je tlačítko „Zobrazit všechny nástroje (N)" — odkryje vše
//    do zavření modálu. Hledání (#tools-search) prohledává VŽDY všechno,
//    při psaní se schovávání pozastaví (jinak by nešlo najít schovaný nástroj).
//
// 2) TYP PRÁCE (volitelný, per zakázka, výchozí „Univerzální" = žádná změna):
//    výběr nahoře v modálu Nástroje. Zvolený typ přisune sekci „Pro tuto práci"
//    s doporučenými dlaždicemi na začátek mřížky (mechanika stejná jako
//    ★ Oblíbené v tools-plus.js — přesun originálu + neviditelná kotva zpět).
//    V jednoduchém režimu typ práce zároveň NAHRADÍ základní sadu.
//
// Klíče dlaždic = data-tool id (injektované) nebo název otevírací funkce
// (statické) — shodné s tools-plus.js/field-tools.js. Oblíbené dlaždice se
// neschovávají nikdy (uživatel si je vybral sám).
// Odstranění: smaž js/tools-simple.js + řádek <script> v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agTsInit) return;
    window.__agTsInit = true;

    var STYLE_ID = 'ag-ts-style';
    var SIMPLE_KEY = 'agSimpleTools_v1';        // '1' = jednoduchý režim zapnut
    var PROF_PREFIX = 'agWorkProfile::';        // + <pid> -> id profilu
    var FAV_KEY = 'agToolFavs_v1';              // čteno kvůli výjimce ze schovávání

    // Základní sada jednoduchého režimu (typ práce „Univerzální")
    var BASE_SET = ['openMeasureModal', 'startAreaMode', 'openStakeoutModal', 'openKatastr',
        'agOpenCalibrate', 'brutal-gps', 'project-import', 'zapisnik'];

    // Typy práce: id -> {label, tools[]} (pořadí = pořadí v sekci „Pro tuto práci")
    var PROFILES = {
        univerzal: { label: 'Univerzální', tools: [] },
        vytycovani: { label: 'Vytyčování', tools: ['openStakeoutModal', 'stakeout-line', 'offset-point', 'usadit-ar', 'agOpenCalibrate', 'rajon', 'project-import', 'openMeasureModal'] },
        pokladka: { label: 'Pokládka / vrstvy', tools: ['vrstvy', 'brutal-gps', 'gps-semafor', 'openCheckDist', 'track-log', 'zavady', 'epochy', 'openMeasureModal'] },
        katastr: { label: 'Katastr a mapování', tools: ['openKatastr', 'cadastre-vector', 'parcela', 'startAreaMode', 'openTachymetrie', 'project-import', 'openMeasureModal'] },
        kontrola: { label: 'Kontrola a monitoring', tools: ['openCheckDist', 'epochy', 'zavady', 'openDmtVolume', 'vyska-objektu', 'track-log', 'zapisnik', 'openMeasureModal'] }
    };
    var PROF_ORDER = ['univerzal', 'vytycovani', 'pokladka', 'katastr', 'kontrola'];

    // ---- drobné utility (kopie vzoru z tools-plus.js, ať je modul samostatný) ----
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function getGrid() { var m = document.getElementById('tools-modal'); return m ? m.querySelector('.tool-grid') : null; }
    function loadFavs() { try { var a = JSON.parse(localStorage.getItem(FAV_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function simpleOn() { try { return localStorage.getItem(SIMPLE_KEY) === '1'; } catch (e) { return false; } }
    function setSimple(on) { try { localStorage.setItem(SIMPLE_KEY, on ? '1' : '0'); } catch (e) {} }
    function profileId() {
        var id; try { id = localStorage.getItem(PROF_PREFIX + pid()); } catch (e) {}
        return (id && PROFILES[id]) ? id : 'univerzal';
    }
    function setProfileId(id) { try { localStorage.setItem(PROF_PREFIX + pid(), id); } catch (e) {} }
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool');
        if (dt) return dt;
        var oc = tile.getAttribute('onclick') || '';
        // stejné pořadí hledání jako field-tools: poslední volaná funkce = otevření nástroje
        var ms = oc.match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }

    // ---- styly ---------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // jednoduchý režim: schovej pokročilé dlaždice a osiřelé nadpisy kategorií;
            // .ag-sm-all (Zobrazit vše) a .ag-sm-search (píše se do hledání) schovávání ruší
            'body.ag-simple-tools #tools-modal .tool-grid:not(.ag-sm-all):not(.ag-sm-search) .ag-sm-adv{display:none !important;}',
            // tlačítko „Zobrazit všechny nástroje" — jen v jednoduchém režimu a mimo hledání
            '#ag-sm-allbtn{display:none;grid-column:1/-1;margin:10px 2px 2px;padding:11px;border-radius:12px;',
            '  border:1px dashed var(--glass-border,rgba(255,255,255,0.2));background:transparent;',
            '  color:var(--text-muted,#9aa1ac);font:600 12.5px/1 var(--font-ui,system-ui),sans-serif;cursor:pointer;}',
            'body.ag-simple-tools #tools-modal .tool-grid:not(.ag-sm-search) #ag-sm-allbtn{display:block;}',
            '#tools-modal .tool-grid.ag-sm-all #ag-sm-allbtn{border-style:solid;color:var(--accent,#2f9e74);border-color:var(--accent-line,rgba(47,158,116,0.4));}',
            // řádek volby typu práce nad mřížkou
            '#ag-ts-prof{display:flex;align-items:center;gap:10px;margin:2px 0 10px;}',
            '#ag-ts-prof label{flex:1;font:600 12.5px/1.3 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);margin:0;}',
            '#ag-ts-prof label small{display:block;font-weight:500;font-size:11px;opacity:0.75;}',
            '#ag-ts-prof select{width:auto;min-width:150px;max-width:55%;}',
            // nadpis sekce doporučených
            '#ag-ts-head{color:var(--accent,#2f9e74) !important;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- přepínač v Nastavení → Vzhled → Ovládání ------------------------------------
    function injectSettingRow() {
        if (document.getElementById('ag-ts-setrow')) return;
        var anchor = document.getElementById('s-lefthand');   // stabilní kotva (viz komentář v index.html)
        var row = anchor ? anchor.closest('.st-row') : null;
        if (!row || !row.parentNode) return;
        var div = document.createElement('div');
        div.className = 'st-row'; div.id = 'ag-ts-setrow';
        div.innerHTML = '<span class="st-lab">Jednoduchý panel Nástrojů<small>jen základní dlaždice; vše ostatní přes „Zobrazit vše" nebo hledání</small></span>'
            + '<label class="st-sw"><input type="checkbox" id="ag-ts-simple"><span class="st-sw-face"></span></label>';
        row.parentNode.insertBefore(div, row.nextSibling);
        var cb = div.querySelector('#ag-ts-simple');
        cb.checked = simpleOn();
        cb.addEventListener('change', function () { setSimple(cb.checked); sync(); });
    }

    // ---- volba typu práce nad mřížkou Nástrojů -----------------------------------------
    function injectProfileRow() {
        if (document.getElementById('ag-ts-prof')) return;
        var m = document.getElementById('tools-modal'); if (!m) return;
        var body = m.querySelector('.modal-body'); if (!body) return;
        var grid = getGrid(); if (!grid) return;
        var div = document.createElement('div');
        div.id = 'ag-ts-prof';
        var opts = PROF_ORDER.map(function (id) { return '<option value="' + id + '">' + PROFILES[id].label + '</option>'; }).join('');
        div.innerHTML = '<label>Typ práce<small>volitelné, platí pro aktivní zakázku</small></label>'
            + '<select id="ag-ts-profsel" class="st-sel">' + opts + '</select>';
        body.insertBefore(div, grid);
        div.querySelector('#ag-ts-profsel').addEventListener('change', function () {
            setProfileId(this.value); sync();
        });
    }

    // ---- sekce „Pro tuto práci" (přesun originálních dlaždic, kotvy pro návrat) --------
    function findTile(grid, key) {
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) { if (tileKey(tiles[i]) === key) return tiles[i]; }
        return null;
    }
    function restoreTile(tile) {
        if (tile.classList.contains('ag-ft-tile')) {
            // injektovanou vrátí field-tools — hned, ať mřížka neproblikává čekáním na tick
            tile.remove();
            try { if (typeof window.agFtSyncTiles === 'function') window.agFtSyncTiles(); } catch (e) {}
            return;
        }
        var ph = tile._agTsPh;
        if (ph && ph.isConnected) { ph.parentNode.insertBefore(tile, ph); ph.remove(); tile._agTsPh = null; }
    }
    function syncProfileSection(grid, prof) {
        var head = document.getElementById('ag-ts-head');
        var favs = loadFavs();
        var wanted = (prof === 'univerzal') ? [] : PROFILES[prof].tools.filter(function (k) { return favs.indexOf(k) === -1; });
        // vrať dlaždice, které už v sekci být nemají
        var current = grid.querySelectorAll('.tool-tile[data-ag-ts="1"]');
        for (var i = 0; i < current.length; i++) {
            if (wanted.indexOf(tileKey(current[i])) === -1) { current[i].removeAttribute('data-ag-ts'); restoreTile(current[i]); }
        }
        if (!wanted.length) { if (head) head.remove(); return; }
        if (!head) {
            head = document.createElement('div');
            head.id = 'ag-ts-head'; head.className = 'tool-cat';
        }
        head.textContent = '◆ Pro tuto práci · ' + PROFILES[prof].label;
        // sekce patří ZA blok „⚡ Teď se hodí" (usadit-ar drží úplný začátek mřížky)
        // a ZA blok ★ Oblíbené (tools-plus) — kdo by chtěl stejné místo, přetahoval by
        // se s nimi každý tick a mřížka by přeskakovala
        var after = null;
        var uaBox = document.getElementById('ag-ua-now');
        if (uaBox && uaBox.parentNode === grid) after = uaBox;
        var favHead = document.getElementById('ag-fav-head');
        if (favHead && favHead.parentNode === grid) {
            after = favHead;
            while (after.nextSibling && after.nextSibling.nodeType === 1 && after.nextSibling.classList
                && after.nextSibling.classList.contains('tool-tile') && !after.nextSibling.getAttribute('data-ag-ts')) {
                after = after.nextSibling;
            }
        }
        var refNode = after ? after.nextSibling : grid.firstChild;
        if (head.parentNode !== grid || head.previousSibling !== after) grid.insertBefore(head, refNode);
        var anchor = head;
        wanted.forEach(function (k) {
            var t = findTile(grid, k); if (!t) return;
            if (!t.classList.contains('ag-ft-tile') && !t._agTsPh && !t.getAttribute('data-ag-ts')) {
                var ph = document.createElement('span');
                ph.style.display = 'none'; ph.setAttribute('data-ag-ts-ph', k);
                t.parentNode.insertBefore(ph, t);
                t._agTsPh = ph;
            }
            t.setAttribute('data-ag-ts', '1');
            if (anchor.nextSibling !== t) grid.insertBefore(t, anchor.nextSibling);
            anchor = t;
        });
    }

    // ---- označení pokročilých dlaždic pro jednoduchý režim ------------------------------
    function effectiveSet(prof) {
        var set = (prof !== 'univerzal') ? PROFILES[prof].tools.slice() : BASE_SET.slice();
        return set.concat(loadFavs());   // oblíbené se neschovávají nikdy
    }
    function tagTiles(grid, prof) {
        var keep = effectiveSet(prof);
        var kids = grid.children, lastHead = null, headHasVisible = false;
        function flushHead() { if (lastHead) lastHead.classList.toggle('ag-sm-adv', !headHasVisible); }
        for (var i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (el.id === 'ag-ft-empty' || el.id === 'ag-sm-allbtn') continue;
            if (el.classList.contains('tool-cat') || el.classList.contains('ag-ft-head')) {
                flushHead(); lastHead = el;
                // Oblíbené a Pro tuto práci se neschovávají
                headHasVisible = (el.id === 'ag-fav-head' || el.id === 'ag-ts-head');
                continue;
            }
            if (el.classList.contains('tool-tile')) {
                var key = tileKey(el);
                var adv = !(key && keep.indexOf(key) !== -1) && el.id !== 'ag-fav-head';
                // dlaždice v sekcích Oblíbené/Pro tuto práci nech vidět vždy
                if (el.getAttribute('data-ag-ts')) adv = false;
                el.classList.toggle('ag-sm-adv', adv);
                if (!adv) headHasVisible = true;
            }
        }
        flushHead();
    }

    // ---- tlačítko „Zobrazit všechny nástroje" -------------------------------------------
    function ensureAllBtn(grid) {
        var btn = document.getElementById('ag-sm-allbtn');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button'; btn.id = 'ag-sm-allbtn';
            btn.addEventListener('click', function () {
                grid.classList.toggle('ag-sm-all');
                updateAllBtn(grid);
            });
        }
        if (btn.parentNode !== grid || grid.lastElementChild !== btn) grid.appendChild(btn);   // drž na konci mřížky
        updateAllBtn(grid);
    }
    function updateAllBtn(grid) {
        var btn = document.getElementById('ag-sm-allbtn'); if (!btn) return;
        if (grid.classList.contains('ag-sm-all')) { btn.textContent = '✓ Skrýt pokročilé nástroje'; return; }
        var n = grid.querySelectorAll('.tool-tile.ag-sm-adv').length;
        btn.textContent = 'Zobrazit všechny nástroje' + (n ? ' (+' + n + ')' : '');
    }

    // ---- hledání a zavření modálu --------------------------------------------------------
    function wireSearchAndClose() {
        var m = document.getElementById('tools-modal'); if (!m || m._agTsWatch) return;
        m._agTsWatch = true;
        document.addEventListener('input', function (e) {
            if (!e.target || e.target.id !== 'tools-search') return;
            var grid = getGrid(); if (!grid) return;
            grid.classList.toggle('ag-sm-search', !!e.target.value);
        }, true);
        new MutationObserver(function () {
            if (m.style.display === 'none') {
                var grid = getGrid();
                if (grid) { grid.classList.remove('ag-sm-all'); grid.classList.remove('ag-sm-search'); updateAllBtn(grid); }
            }
        }).observe(m, { attributes: true, attributeFilter: ['style'] });
    }

    // ---- hlavní sync (idempotentní, volaný periodicky jako ostatní moduly) ---------------
    function sync() {
        var grid = getGrid(); if (!grid) return;
        injectStyles(); injectSettingRow(); injectProfileRow(); wireSearchAndClose();
        var prof = profileId();
        var sel = document.getElementById('ag-ts-profsel');
        if (sel && sel.value !== prof && document.activeElement !== sel) sel.value = prof;   // po přepnutí zakázky
        var cb = document.getElementById('ag-ts-simple');
        if (cb && cb.checked !== simpleOn()) cb.checked = simpleOn();
        document.body.classList.toggle('ag-simple-tools', simpleOn());
        syncProfileSection(grid, prof);
        tagTiles(grid, prof);
        ensureAllBtn(grid);
    }

    function init() {
        try { sync(); } catch (e) { console.warn('[tools-simple] init', e); }
        if (!window.__agTsTimer) window.__agTsTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () {
            try { sync(); } catch (e) {}
        }, 1700);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 500); });

    // Veřejné API: js/rezim-prace.js (volba režimu na úvodu) zapisuje TÉŽ klíče
    // a chce, aby se panel dorovnal hned, ne až dalším tickem.
    window.AGToolsSimple = { sync: sync, profiles: PROFILES, order: PROF_ORDER };
})();
