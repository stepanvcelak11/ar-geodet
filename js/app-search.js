// ===== AR Geodet — CHYTRÉ VYHLEDÁVÁNÍ V MENU „VÍCE" (ODPOJITELNÁ) ===============
// Kolonka nahoře v menu „Více": napiš „předpisy", „nástroje", „kompas", „koš"…
// a klepnutím na výsledek se cíl rovnou OTEVŘE — bez hledání, kde co v appce je.
// Prohledává tři zdroje (bez diakritiky):
//   1) jádrové cíle (Nástroje, Body, Nový bod, Nastavení vč. záložek, Kompas…),
//   2) všechna tlačítka v menu „Více" (i injektovaná moduly: Koš, Zpravodaj…),
//   3) všechny dlaždice nástrojů z modálu Nástroje (i terénní moduly).
// Enter otevře první výsledek. Odstranění: smaž js/app-search.js + řádek
// <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var STYLE_ID = 'ag-as-style';
    var BOX_ID = 'ag-as-box';

    function norm(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
        return s.replace(/\s+/g, ' ').trim();
    }
    function closeMenu() { var m = document.getElementById('side-menu'); if (m) m.classList.remove('open'); }

    // ---- jádrové cíle (label se ukáže, keys jen pro hledání) -----------------------
    function tab(tabId, n) {
        return function () {
            if (typeof openSettings === 'function') openSettings();
            var btns = document.querySelectorAll('#settings-modal .settings-tiles .tab-btn');
            if (typeof switchTab === 'function' && btns[n]) switchTab(tabId, btns[n]);
        };
    }
    var CORE = [
        { label: 'Nástroje — všechny dlaždice', keys: 'nastroje tools mereni pomucky', run: function () { var m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; } },
        { label: 'Body — správa a seznam bodů', keys: 'body sprava seznam points import export hledat radit trideni hromadne vybrat smazat precislovat posun kod kody vrstva', run: function () { if (typeof openManageModal === 'function') openManageModal(); } },
        { label: 'Nový bod', keys: 'novy bod pridat vlozit new point souradnice', run: function () { if (typeof openNewPointModal === 'function') openNewPointModal(); } },
        { label: 'Nastavení', keys: 'nastaveni settings', run: function () { if (typeof openSettings === 'function') openSettings(); } },
        { label: 'Nastavení — Vzhled', keys: 'vzhled barvy motiv tema svetly tmavy rezim rukavice leva ruka', run: tab('tab-vzhled', 0) },
        { label: 'Nastavení — AR a přesnost', keys: 'ar presnost kamera dosah fov filtry rozvrzeni', run: tab('tab-ar', 1) },
        { label: 'Nastavení — Data', keys: 'data zakazka zaloha katastr zdroj offline', run: tab('tab-data', 2) },
        { label: 'Nastavení — Údržba', keys: 'udrzba oprava reset chyby log vymazat', run: tab('tab-udrzba', 3) },
        { label: 'Nastavení — Profily', keys: 'profil profily teren presnost ukazka vlastni rezim prace prednastaveni bez profilu vypnout', run: tab('tab-profily', 4) },
        { label: 'Kompas / Azimut', keys: 'kompas azimut sever gon jednotky nula korekce', run: function () { if (typeof openCompassModal === 'function') openCompassModal(); } },
        // Poloha z mapy: hledá se hlavně tehdy, když je GPS špatná — proto i klíče
        // „les", „mesto", „nepresna gps". Cíl je odpojitelný, tak jen když existuje.
        { label: 'Poloha z mapy — zpřesnit klepnutím', keys: 'poloha z mapy rucni presnost nepresna gps les mesto ulice ortofoto kde stojim zpresnit', run: function () { if (typeof window.agPosFromMap === 'function') window.agPosFromMap(); } }
    ];

    // ---- styly ---------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + BOX_ID + '{display:flex;flex-direction:column;gap:6px;margin:2px 0 8px;}',
            '#ag-as-input{width:100%;box-sizing:border-box;padding:11px 14px;border-radius:var(--r-pill,999px);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:rgba(255,255,255,0.06);',
            '  color:var(--text-color,#eceef2);font:inherit;font-size:calc(15px * var(--ag-font-scale, 1));outline:none;}',
            '#ag-as-input:focus{border-color:var(--accent,#2f9e74);}',
            '#ag-as-input::placeholder{color:var(--text-muted,#9aa1ac);}',
            '#ag-as-res{display:none;flex-direction:column;gap:4px;}',
            '#ag-as-res.on{display:flex;}',
            '.ag-as-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:10px 12px;',
            '  border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.10));',
            '  background:rgba(255,255,255,0.04);color:var(--text-color,#eceef2);font:600 13.5px/1.3 var(--font-ui,system-ui),sans-serif;cursor:pointer;}',
            '.ag-as-item small{color:var(--text-muted,#9aa1ac);font-weight:500;margin-left:auto;flex:0 0 auto;}',
            '.ag-as-item:first-child{border-color:var(--accent-line,rgba(47,158,116,0.42));background:var(--accent-soft,rgba(47,158,116,0.14));}',
            '.ag-as-empty{padding:8px 12px;color:var(--text-muted,#9aa1ac);font-size:calc(12.5px * var(--ag-font-scale, 1));}',
            'body.ag-glove .ag-as-item{padding:13px 14px;font-size:calc(14.5px * var(--ag-font-scale, 1));}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- sběr cílů -------------------------------------------------------------------
    function tileLabel(tile) {
        var s = tile.querySelector('span');
        var d = document.createElement('div');
        d.innerHTML = ((s ? s.innerHTML : tile.innerHTML) || '').replace(/<br\s*\/?>/gi, ' ');
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function collect() {
        var out = [];
        CORE.forEach(function (c) { out.push({ label: c.label, hay: norm(c.label + ' ' + c.keys), src: '', run: c.run }); });
        // tlačítka v menu Více (i injektovaná moduly) — kromě Zavřít
        document.querySelectorAll('#side-menu .menu-btn:not(.menu-close)').forEach(function (b) {
            var t = (b.textContent || '').replace(/\s+/g, ' ').trim();
            if (!t) return;
            out.push({ label: t, hay: norm(t), src: 'Více', run: function () { b.click(); } });
        });
        // dlaždice nástrojů (statické i terénní moduly); klik dlaždice si sám zavře modál
        document.querySelectorAll('#tools-modal .tool-tile').forEach(function (tile) {
            var t = tileLabel(tile);
            if (!t) return;
            out.push({ label: t, hay: norm(t), src: 'Nástroje', run: function () { tile.click(); } });
        });
        return out;
    }
    function search(q) {
        q = norm(q);
        if (!q) return [];
        var seen = {}, starts = [], within = [];
        collect().forEach(function (it) {
            if (seen[it.label]) return;
            var ix = it.hay.indexOf(q);
            if (ix === -1) return;
            seen[it.label] = 1;
            // shoda na začátku slova řadit před shodu uprostřed
            (ix === 0 || it.hay.charAt(ix - 1) === ' ' ? starts : within).push(it);
        });
        return starts.concat(within).slice(0, 8);
    }

    // ---- UI ---------------------------------------------------------------------------
    function render(list) {
        var res = document.getElementById('ag-as-res');
        if (!res) return;
        res.innerHTML = '';
        res.classList.toggle('on', list !== null);
        if (list === null) return;
        if (!list.length) {
            var e = document.createElement('div'); e.className = 'ag-as-empty'; e.textContent = 'Nic nenalezeno — zkus jiné slovo (např. „předpisy", „parcela", „kompas").';
            res.appendChild(e); return;
        }
        list.forEach(function (it) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'ag-as-item';
            b.appendChild(document.createTextNode(it.label));
            if (it.src) { var s = document.createElement('small'); s.textContent = it.src; b.appendChild(s); }
            b.addEventListener('click', function () {
                closeMenu(); reset();
                try { it.run(); } catch (err) { console.warn('[app-search]', err); }
            });
            res.appendChild(b);
        });
    }
    function reset() {
        var inp = document.getElementById('ag-as-input');
        if (inp) inp.value = '';
        render(null);
    }

    function ensureBox() {
        var scroll = document.querySelector('#side-menu .menu-scroll');
        if (!scroll || document.getElementById(BOX_ID)) return;
        var box = document.createElement('div');
        box.id = BOX_ID;
        var inp = document.createElement('input');
        inp.id = 'ag-as-input'; inp.type = 'search'; inp.autocomplete = 'off';
        inp.placeholder = 'Hledat v aplikaci… (nástroj, funkce)';
        var res = document.createElement('div'); res.id = 'ag-as-res';
        box.appendChild(inp); box.appendChild(res);
        var head = scroll.querySelector('.menu-head');
        scroll.insertBefore(box, head ? head.nextSibling : scroll.firstChild);
        inp.addEventListener('input', function () { render(inp.value.trim() ? search(inp.value) : null); });
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); var first = res.querySelector('.ag-as-item'); if (first) first.click(); }
            else if (e.key === 'Escape') { reset(); inp.blur(); }
        });
    }

    // při zavření menu vyhledávání vyresetovat, ať se příště otevře čisté
    var _wasOpen = false;
    function tick() {
        try {
            injectStyles(); ensureBox();
            var m = document.getElementById('side-menu');
            var open = !!(m && m.classList.contains('open'));
            if (_wasOpen && !open) reset();
            _wasOpen = open;
        } catch (e) {}
    }
    // ---- „Jinde v appce" — stejné hledání i pod mřížkou Nástrojů ----------------------
    // Jedno hledání pro celou appku: když uživatel píše do pole v Nástrojích,
    // pod dlaždicemi se ukážou i shody odjinud (Nastavení, menu Více, Kompas…).
    // Dlaždice nástrojů se tu vynechávají — ty filtruje mřížka sama.
    function ensureToolsHook() {
        var inp = document.getElementById('tools-search');
        if (!inp || inp._agAsHook) return;
        inp._agAsHook = true;
        inp.addEventListener('input', function () {
            var grid = document.querySelector('#tools-modal .tool-grid');
            if (!grid) return;
            var box = document.getElementById('ag-as-tools');
            var q = inp.value.trim();
            if (!q) { if (box) box.remove(); return; }
            var list = search(q).filter(function (it) { return it.src !== 'Nástroje'; }).slice(0, 4);
            if (!list.length) { if (box) box.remove(); return; }
            if (!box) {
                box = document.createElement('div');
                box.id = 'ag-as-tools';
                box.style.cssText = 'grid-column:1/-1;display:flex;flex-direction:column;gap:4px;margin-top:8px;order:9999;';
            }
            grid.appendChild(box);   // vždy na konec mřížky
            box.innerHTML = '<div style="font:700 11px/1 var(--font-display,system-ui),sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);margin:2px;">Jinde v appce</div>';
            list.forEach(function (it) {
                var b = document.createElement('button');
                b.type = 'button'; b.className = 'ag-as-item';
                b.appendChild(document.createTextNode(it.label));
                if (it.src) { var s = document.createElement('small'); s.textContent = it.src; b.appendChild(s); }
                b.addEventListener('click', function () {
                    var m = document.getElementById('tools-modal'); if (m) m.style.display = 'none';
                    inp.value = ''; if (window.agFilterTools) try { window.agFilterTools(''); } catch (e) {}
                    box.remove();
                    try { it.run(); } catch (err) { console.warn('[app-search]', err); }
                });
                box.appendChild(b);
            });
        });
    }

    function init() {
        tick();
        if (!window.__agAsTimer) window.__agAsTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    // hook na pole v Nástrojích (vzniká staticky v index.html, stačí zkoušet v ticku)
    if (!window.__agAsToolsTimer) window.__agAsToolsTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () { try { ensureToolsHook(); injectStyles(); } catch (e) {} }, 1500);
})();
