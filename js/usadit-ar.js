// ===== AR Geodet — USADIT AR (průvodce) + ZJEDNODUŠENÁ MŘÍŽKA NÁSTROJŮ =========
// ODPOJITELNÁ vrstva. NEEDITUJE logika.js ani grafika.js. Řeší zahlcení Nástrojů:
//
//   • „Usadit AR (průvodce)": v appce je 7 nástrojů, které všechny znamenají
//     „srovnej mi AR se skutečností" (Srovnat sever, Srovnat podle bodu, Srovnat
//     AR na 2 body, Kalibrace na ref. bod, Lokalizace Helmert, AR resekce, Volné
//     stanovisko). Průvodce se zeptá 1–2 otázkami a sám spustí správný nástroj.
//   • Zjednodušená mřížka: když je průvodce k dispozici, těch 7 dlaždic se
//     v mřížce SKRYJE (přes vyhledávání jdou pořád najít a spustit!).
//     Přepínač „Zjednodušené Nástroje" v Nastavení → Vzhled; výchozí ZAPNUTO.
//   • „⚡ Teď se hodí": kontextový řádek nahoře v Nástrojích — podle stavu
//     (slabá GPS, nesrovnaný sever, otevřené závady) + nejpoužívanější nástroje.
//
// Nic se nemaže — jen se to přestane ukazovat všechno naráz.
// Odstranění: smaž js/usadit-ar.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg>';

    var SIMPLE_KEY = 'agSimpleTools';       // '1' = zjednodušená mřížka (výchozí)
    var USE_KEY = 'agToolUsage_v1';         // počítadlo z field-tools.js (jen čteme)
    // klíče dlaždic, které průvodce nahrazuje (data-tool / funkce z onclick)
    var HIDE_KEYS = ['agOpenCalibrate', 'orient-point', 'ar-calib2', 'ref-calibration', 'localization-helmert', 'ar-resection', 'free-station'];

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function simpleOn() { try { return localStorage.getItem(SIMPLE_KEY) !== '0'; } catch (e) { return true; } }
    function getGrid() { var m = document.getElementById('tools-modal'); return m ? m.querySelector('.tool-grid') : null; }
    function closeTools() { var m = document.getElementById('tools-modal'); if (m) m.style.display = 'none'; }

    // klíč dlaždice — stejná logika jako tools-plus.js/field-tools.js
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool'); if (dt) return dt;
        var oc = tile.getAttribute('onclick') || '';
        for (var i = 0; i < HIDE_KEYS.length; i++) { if (oc.indexOf(HIDE_KEYS[i]) !== -1) return HIDE_KEYS[i]; }
        var ms = oc.match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function findTile(key) {
        var grid = getGrid(); if (!grid) return null;
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) { if (tileKey(tiles[i]) === key) return tiles[i]; }
        return null;
    }
    function tileLabel(tile) {
        var s = tile.querySelector('span');
        var d = document.createElement('div');
        d.innerHTML = ((s ? s.innerHTML : tile.innerHTML) || '').replace(/<br\s*\/?>/gi, ' ');
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    // spuštění nástroje = klik na jeho dlaždici (funguje pro statické i injektované)
    function runTool(key, fallbackFn) {
        var t = findTile(key);
        closeModal();
        if (t) { t.click(); return true; }
        if (fallbackFn && typeof window[fallbackFn] === 'function') { closeTools(); try { window[fallbackFn](); } catch (e) {} return true; }
        return false;
    }

    // ---- styly ---------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('ag-ua-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-ua-style';
        st.textContent = [
            // průvodce
            '#ag-ua-ov{position:fixed;inset:0;z-index:1000055;display:none;align-items:center;justify-content:center;background:rgba(4,8,12,0.62);}',
            '#ag-ua-ov.open{display:flex;}',
            '#ag-ua-card{width:min(94vw,440px);max-height:86vh;overflow:auto;padding:20px;border-radius:18px;',
            '  background:var(--glass-bg,rgba(14,18,24,0.97));border:1px solid var(--glass-border-strong,rgba(255,255,255,0.16));color:var(--text-color,#eceef2);}',
            '#ag-ua-card h3{margin:0 0 6px;color:var(--accent,#2f9e74);font-size:17px;display:flex;align-items:center;gap:8px;}',
            '#ag-ua-card h3 svg{width:20px;height:20px;}',
            '#ag-ua-sub{margin:0 0 14px;font-size:13px;color:var(--text-muted,#9aa1ac);line-height:1.45;}',
            '.ag-ua-opt{display:block;width:100%;text-align:left;margin-bottom:8px;padding:13px 14px;border-radius:14px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--surface-1,rgba(255,255,255,0.05));color:inherit;cursor:pointer;}',
            '.ag-ua-opt b{display:block;font-size:14.5px;margin-bottom:2px;}',
            '.ag-ua-opt small{display:block;font-size:12.5px;color:var(--text-muted,#9aa1ac);line-height:1.4;}',
            '.ag-ua-opt:active{background:var(--accent-soft,rgba(47,158,116,0.15));border-color:var(--accent-line,rgba(47,158,116,0.4));}',
            '.ag-ua-foot{display:flex;gap:8px;margin-top:8px;}',
            '.ag-ua-foot button{flex:1;padding:11px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:transparent;color:var(--text-muted,#9aa1ac);font-weight:600;cursor:pointer;}',
            'body.ag-glove .ag-ua-opt{padding:16px;}',
            'body.outdoor-mode #ag-ua-card{background:#0a0e1a;}',
            'body.light-mode.outdoor-mode #ag-ua-card{background:#fff;}',
            // „Teď se hodí"
            '#ag-ua-now{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;margin:0 0 4px;}',
            '#ag-ua-now-head{grid-column:1/-1;margin:0 2px 2px;font:700 11px/1 var(--font-display,system-ui),sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--data,#e6bd76);}',
            '.ag-ua-chip{display:inline-flex;align-items:center;gap:6px;padding:9px 13px;border-radius:999px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:var(--surface-1,rgba(255,255,255,0.05));',
            '  color:var(--text-color,#eceef2);font:600 12.5px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '.ag-ua-chip svg{width:15px;height:15px;color:var(--accent,#2f9e74);}',
            'body.ag-glove .ag-ua-chip{padding:12px 16px;font-size:14px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- PRŮVODCE --------------------------------------------------------------------
    function ensureModal() {
        var m = document.getElementById('ag-ua-ov');
        if (!m) {
            m = document.createElement('div'); m.id = 'ag-ua-ov';
            m.innerHTML = '<div id="ag-ua-card"><h3>' + ICON + ' Usadit AR</h3><p id="ag-ua-sub"></p><div id="ag-ua-body"></div>'
                + '<div class="ag-ua-foot"><button type="button" id="ag-ua-back">Zpět</button><button type="button" id="ag-ua-close">Zavřít</button></div></div>';
            m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
            document.body.appendChild(m);
            m.querySelector('#ag-ua-close').addEventListener('click', closeModal);
            m.querySelector('#ag-ua-back').addEventListener('click', function () { stepStart(); });
        }
        return m;
    }
    function closeModal() { var m = document.getElementById('ag-ua-ov'); if (m) m.classList.remove('open'); }
    function renderStep(sub, opts, backVisible) {
        var m = ensureModal();
        m.querySelector('#ag-ua-sub').innerHTML = sub;
        var body = m.querySelector('#ag-ua-body');
        body.innerHTML = '';
        opts.forEach(function (o) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'ag-ua-opt';
            b.innerHTML = '<b>' + o.t + '</b>' + (o.s ? '<small>' + o.s + '</small>' : '');
            b.addEventListener('click', o.act);
            body.appendChild(b);
        });
        m.querySelector('#ag-ua-back').style.display = backVisible ? '' : 'none';
        m.classList.add('open');
    }
    function stepStart() {
        renderStep('AR srovnáš se skutečností podle toho, co kolem sebe máš. Vyber, co tě trápí:', [
            { t: 'Značky jsou pootočené', s: 'Bod je v AR o kus vedle, směrem stranou — sever (kompas) nesedí.', act: stepSever },
            { t: 'Všechno je posunuté / GPS táhne', s: 'Body sedí tvarem, ale celé je to posunuté o pár metrů.', act: stepPosun },
            { t: 'Nevím, kde přesně stojím', s: 'GPS nestačí a potřebuju polohu stanoviska.', act: stepStojim },
            { t: 'Usadit celou zakázku na dané body', s: 'Mám dvojice: moje měření ↔ dané souřadnice (identické body).', act: function () { runTool('localization-helmert'); } }
        ], false);
    }
    function stepSever() {
        renderStep('Kolik <b>známých bodů</b> (které jsou i v appce) kolem sebe bezpečně vidíš?', [
            { t: 'Jeden', s: 'Rychlé srovnání severu podle jednoho bodu.', act: function () { runTool('agOpenCalibrate', 'agOpenCalibrate'); } },
            { t: 'Dva', s: 'Přesnější: srovná natočení i posun (2 body v různých směrech).', act: function () { runTool('ar-calib2'); } },
            { t: 'Žádný', s: 'Zkus kompas zkalibrovat osmičkou a drž se dál od aut a plotů. Pomůže i „Vizuální stabilizace AR".', act: function () { runTool('ar-visual-track'); } }
        ], true);
    }
    function stepPosun() {
        renderStep('Jak můžeš posun určit?', [
            { t: 'Stojím na známém bodě', s: 'Kalibrace na referenční bod — spočítá posun GPS a průběžně ho opravuje.', act: function () { runTool('ref-calibration'); } },
            { t: 'Vidím dva známé body', s: 'Srovnání AR na 2 body — vyřeší natočení i posun najednou.', act: function () { runTool('ar-calib2'); } },
            { t: 'Mám dvojice měřené ↔ dané', s: 'Lokalizace (Helmert): posun, natočení a měřítko z identických bodů.', act: function () { runTool('localization-helmert'); } }
        ], true);
    }
    function stepStojim() {
        renderStep('Vidíš z místa aspoň <b>2–3 známé body</b>?', [
            { t: 'Ano, vidím', s: 'Volné stanovisko (průvodce) — poloha + sever ze záměr na známé body.', act: function () { runTool('free-station'); } },
            { t: 'Nevidím žádný', s: 'Zbývá GPS: Brutální GPS (dlouhé průměrování s otočením) dá nejlepší možnou polohu z telefonu.', act: function () { runTool('brutal-gps'); } }
        ], true);
    }
    function openWizard() { injectStyles(); stepStart(); }

    // ---- ZJEDNODUŠENÁ MŘÍŽKA ----------------------------------------------------------
    function searchQuery() {
        var inp = document.getElementById('tools-search');
        return inp ? (inp.value || '').trim() : '';
    }
    function applySimple() {
        var grid = getGrid(); if (!grid) return;
        var on = simpleOn() && !searchQuery();
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) {
            var k = tileKey(tiles[i]);
            if (k && HIDE_KEYS.indexOf(k) !== -1) {
                if (on) tiles[i].style.display = 'none';
                // když je zjednodušení vypnuté a dlaždici jsme skryli my, vrátit
                else if (tiles[i].style.display === 'none' && !searchQuery()) tiles[i].style.display = '';
            }
        }
        // nadpis „AR a kalibrace" nechat — zůstává v něm průvodce a další dlaždice
    }
    // po každém průchodu vyhledávání znovu prosadit skrytí (field-tools přepisuje display)
    function wrapFilter() {
        if (window.__agUaWrapped || typeof window.agFilterTools !== 'function') return;
        var orig = window.agFilterTools;
        window.agFilterTools = function (v) { var r = orig.apply(this, arguments); try { applySimple(); } catch (e) {} return r; };
        window.__agUaWrapped = true;
    }

    // ---- přepínač v Nastavení → Vzhled -------------------------------------------------
    function injectSettingsToggle() {
        if (document.getElementById('ag-ua-simple-row')) return;
        var tab = document.getElementById('tab-vzhled'); if (!tab) return;
        var row = document.createElement('div');
        row.className = 'st-row'; row.id = 'ag-ua-simple-row';
        var lab = document.createElement('span');
        lab.className = 'st-lab';
        lab.innerHTML = 'Zjednodušené Nástroje<small>7 kalibračních dlaždic nahradí průvodce „Usadit AR" (hledáním je najdeš dál)</small>';
        var sw = document.createElement('label'); sw.className = 'st-sw';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = simpleOn();
        cb.addEventListener('change', function () {
            try { localStorage.setItem(SIMPLE_KEY, cb.checked ? '1' : '0'); } catch (e) {}
            applySimple();
        });
        var face = document.createElement('span'); face.className = 'st-sw-face';
        sw.appendChild(cb); sw.appendChild(face);
        row.appendChild(lab); row.appendChild(sw);
        tab.appendChild(row);
    }

    // ---- „⚡ TEĎ SE HODÍ" ---------------------------------------------------------------
    function loadUsage() { try { var o = JSON.parse(localStorage.getItem(USE_KEY)); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    function suggestions() {
        var out = [], seen = {};
        function add(key) { if (!seen[key] && out.length < 4 && findTile(key)) { seen[key] = 1; out.push(key); } }
        // 1) slabá GPS → predikce signálu / brutální GPS
        var acc = (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy) ? currentGpsAccuracy : null;
        if (acc != null && acc > 10) { add('sky-obstruction'); add('brutal-gps'); }
        // 2) nesrovnaný sever a nic zakotveného → průvodce
        var hoff = (typeof userHeadingOffset !== 'undefined') ? userHeadingOffset : 0;
        var anchored = !!(window.AGPose && window.AGPose.valid);
        if (!hoff && !anchored) add('usadit-ar');
        // 3) otevřené závady → seznam závad
        try { if (window.AGZavady && window.AGZavady.count() > 0) add('zavady'); } catch (e) {}
        // 4) doplň nejpoužívanějšími
        var usage = loadUsage();
        Object.keys(usage).sort(function (a, b) { return usage[b] - usage[a]; }).forEach(function (k) {
            if (out.length < 4 && usage[k] >= 2) add(k);
        });
        return out;
    }
    function renderNow() {
        var grid = getGrid(); if (!grid) return;
        var head = document.getElementById('ag-ua-now-head');
        var box = document.getElementById('ag-ua-now');
        if (searchQuery()) { if (head) head.style.display = 'none'; if (box) box.style.display = 'none'; return; }
        var keys = suggestions();
        if (!keys.length) { if (head) head.remove(); if (box) box.remove(); return; }
        if (!head) { head = document.createElement('div'); head.id = 'ag-ua-now-head'; head.textContent = '⚡ Teď se hodí'; }
        if (!box) { box = document.createElement('div'); box.id = 'ag-ua-now'; }
        head.style.display = ''; box.style.display = '';
        // vždy jako první dva prvky mřížky (i po překreslení oblíbených)
        if (grid.firstChild !== head) grid.insertBefore(head, grid.firstChild);
        if (head.nextSibling !== box) grid.insertBefore(box, head.nextSibling);
        // překreslit chipy jen když se sada změnila
        var sig = keys.join('|');
        if (box._agSig === sig) return;
        box._agSig = sig;
        box.innerHTML = '';
        keys.forEach(function (k) {
            var tile = findTile(k); if (!tile) return;
            var chip = document.createElement('button');
            chip.type = 'button'; chip.className = 'ag-ua-chip';
            var ic = tile.querySelector('svg');
            chip.innerHTML = (ic ? ic.outerHTML : '') + esc(tileLabel(tile));
            chip.addEventListener('click', function () { tile.click(); });
            box.appendChild(chip);
        });
    }

    // ---- život modulu -------------------------------------------------------------------
    function tick() {
        try {
            injectStyles();
            wrapFilter();
            injectSettingsToggle();
            applySimple();
            var m = document.getElementById('tools-modal');
            if (m && m.style.display === 'flex') renderNow();
        } catch (e) {}
    }
    function init() {
        injectStyles();
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'usadit-ar', label: 'Usadit AR (průvodce)', icon: ICON, cat: 'AR a kalibrace', onClick: openWizard, order: 0 });
        }
        if (!window.__agUaTimer) window.__agUaTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1200);
        tick();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    window.agOpenUsaditAR = openWizard;
})();
