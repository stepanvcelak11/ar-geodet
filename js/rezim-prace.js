// ===== AR Geodet — REŽIM PRÁCE NA ÚVODNÍ OBRAZOVCE (ODPOJITELNÁ vrstva) ========
// Neinvazivní vrstva ve stylu js/pokracovat.js: NEEDITUJE logika.js, grafika.js
// ani tools-simple.js — jen si na úvodní obrazovku přidá kartu a přepisuje TÉŽ
// klíče v localStorage, které už čte js/tools-simple.js.
//
// PROČ: v Nástrojích je ~58 dlaždic. Filtr podle „typu práce" v appce už existuje
// (js/tools-simple.js), ale schovaný jako <select> UVNITŘ modálu Nástroje — tedy
// přesně tam, kam se člověk dostane až když se v té mřížce ztratí. Volba přitom
// patří na začátek dne, kdy uživatel ví, co jde dělat.
//
// CO DĚLÁ: na úvodní obrazovce (pod kartou aktivní zakázky) nabídne
// „Jak dnes budeš appku používat?" a volbu z typů práce. Vybraný typ:
//   • uloží se jako typ práce AKTIVNÍ ZAKÁZKY (klíč agWorkProfile::<pid>, stejný
//     jako v tools-simple.js — obě místa se tedy vidí a nepřetahují se),
//   • zapne jednoduchý panel Nástrojů (agSimpleTools_v1), takže v mřížce zůstane
//     6–8 dlaždic pro tuhle práci; zbytek je za „Zobrazit všechny nástroje"
//     a hledání prohledává vždy všechno.
// „Univerzální (vše)" filtr vypne a vrátí jednoduchý panel do stavu, v jakém ho
// uživatel měl před prvním použitím téhle karty (pamatuje si ho agRpPrevSimple).
//
// VOLITELNÉ: karta jde odklidit odkazem „Nezobrazovat" (agRpHide) — pak se volba
// dělá dál jen v Nástrojích. Zapnout zpátky: Nastavení → Vzhled → „Volba režimu
// práce na úvodu". Nic se nikdy nemaže a žádná dlaždice nezmizí nevratně.
//
// ZÁMĚRNĚ NEMĚNÍ zobrazení (AR/Split/Mapa), dok ani HUD — o ty se stará
// js/view-cycle.js a stavová bublina; míchat jim do toho by znamenalo dvě místa,
// která si přepisují stejné nastavení.
//
// Odstranění: smaž js/rezim-prace.js + řádek <script> v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agRpInit) return;
    window.__agRpInit = true;

    var STYLE_ID = 'ag-rp-style';
    var PROF_PREFIX = 'agWorkProfile::';    // shodné s js/tools-simple.js
    var SIMPLE_KEY = 'agSimpleTools_v1';    // shodné s js/tools-simple.js
    var HIDE_KEY = 'agRpHide';              // '1' = kartu na úvodu nezobrazovat
    var PREV_KEY = 'agRpPrevSimple';        // stav jednoduchého panelu před 1. volbou

    // Popisky a ikony k typům práce z tools-simple.js. Klíče MUSÍ zůstat shodné,
    // jinak si obě místa uloží každé něco jiného.
    var MODES = [
        { id: 'univerzal', t: 'Univerzální', s: 'Vše bez filtru — nic se neschovává', ic: 'grid' },
        { id: 'pokladka', t: 'Pokládka / vrstvy', s: 'Vrstvy, přesná GPS, oměrné, závady, stopa', ic: 'layers' },
        { id: 'vytycovani', t: 'Vytyčování', s: 'Checklist, přímka, offset, rajón, usadit AR', ic: 'target' },
        { id: 'katastr', t: 'Katastr a mapování', s: 'Katastr, parcely, plocha, náčrt, import', ic: 'area' },
        { id: 'kontrola', t: 'Kontrola a monitoring', s: 'Oměrné, epochy, závady, kubatury, zápisník', ic: 'ruler' }
    ];
    // Ikony beru z <symbol> sady v index.html; kdyby some chyběl, prostě se nevykreslí.
    var ICONS = { grid: '#i-grid', layers: '#i-layers', target: '#i-crosshair', area: '#i-area', ruler: '#i-ruler' };

    function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function pid() { return ls('arActiveProjectId') || 'default'; }
    function known(id) { for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return true; return false; }
    function curMode() { var v = ls(PROF_PREFIX + pid()); return known(v) ? v : 'univerzal'; }
    function hidden() { return ls(HIDE_KEY) === '1'; }
    function simpleOn() { return ls(SIMPLE_KEY) === '1'; }

    // ---- styly -------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-rp-wrap{margin:-18px 0 26px;}',           // karta zakázky má pod sebou 30px
            '#ag-rp-wrap[hidden]{display:none;}',
            '#ag-rp-head{display:flex;align-items:baseline;gap:8px;margin:0 0 8px;}',
            '#ag-rp-head .t{font:700 11px/1.2 var(--font-ui,system-ui),sans-serif;letter-spacing:.12em;',
            '  text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#ag-rp-head .x{margin-left:auto;background:none;border:none;padding:2px 0;cursor:pointer;',
            '  color:var(--text-muted,#9aa1ac);font:500 11px/1 var(--font-ui,system-ui),sans-serif;text-decoration:underline;}',
            // vodorovný pás voleb — na úzkém displeji se scrolluje, ať karta neroste do výšky
            '#ag-rp-list{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 4px;scroll-snap-type:x proximity;',
            '  -webkit-overflow-scrolling:touch;}',
            '#ag-rp-list::-webkit-scrollbar{height:0;}',
            '#ag-rp-list button{flex:0 0 auto;scroll-snap-align:start;min-width:126px;max-width:170px;',
            '  display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:11px 12px;',
            '  border-radius:14px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:rgba(255,255,255,0.04);color:var(--text-color,#eceef2);cursor:pointer;text-align:left;}',
            '#ag-rp-list button .icon{width:19px;height:19px;color:var(--accent-bright,#3eb487);}',
            '#ag-rp-list button b{font:700 13px/1.2 var(--font-ui,system-ui),sans-serif;}',
            '#ag-rp-list button span{font:500 10.5px/1.3 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-muted,#9aa1ac);white-space:normal;}',
            '#ag-rp-list button.on{border-color:var(--accent-line,rgba(47,158,116,0.42));',
            '  background:var(--accent-soft,rgba(47,158,116,0.14));}',
            '#ag-rp-list button.on b{color:var(--accent,#2f9e74);}',
            '#ag-rp-list button:active{transform:scale(0.98);}',
            '#ag-rp-note{margin:6px 2px 0;font:500 11.5px/1.45 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-muted,#9aa1ac);}',
            '#ag-rp-note b{color:var(--accent,#2f9e74);font-weight:700;}',
            'body.ag-glove #ag-rp-list button{min-width:140px;padding:13px 14px;}',
            'body.ag-glove #ag-rp-list button b{font-size:14px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- volba režimu ------------------------------------------------------------
    function pick(id) {
        if (!known(id)) return;
        // Stav jednoduchého panelu před prvním zásahem si pamatuj, ať se dá vrátit.
        if (ls(PREV_KEY) == null) lsSet(PREV_KEY, simpleOn() ? '1' : '0');
        lsSet(PROF_PREFIX + pid(), id);
        if (id === 'univerzal') lsSet(SIMPLE_KEY, ls(PREV_KEY) === '1' ? '1' : '0');
        else lsSet(SIMPLE_KEY, '1');
        render();
        // tools-simple.js se sám dorovná svým tickem; když je po ruce, ať to je hned
        try { if (window.AGToolsSimple && typeof AGToolsSimple.sync === 'function') AGToolsSimple.sync(); } catch (e) {}
    }

    function noteFor(id) {
        if (id === 'univerzal') {
            return 'V Nástrojích uvidíš <b>všechny dlaždice</b>. Režim si můžeš vybrat i později v Nástrojích.';
        }
        return 'V Nástrojích budou nahoře dlaždice <b>pro tuhle práci</b>; ostatní zůstávají pod „Zobrazit '
            + 'všechny nástroje" a hledání najde vždy vše. Platí pro aktivní zakázku.';
    }

    // ---- vykreslení do úvodní obrazovky -------------------------------------------
    function ensureWrap() {
        var w = document.getElementById('ag-rp-wrap');
        if (w) return w;
        var ws = document.getElementById('welcome-screen');
        if (!ws) return null;
        var content = ws.querySelector('.modal-content');
        var row = ws.querySelector('.w-proj-row');
        if (!content || !row) return null;
        w = document.createElement('div');
        w.id = 'ag-rp-wrap';
        w.innerHTML =
            '<div id="ag-rp-head"><span class="t">Jak dnes budeš appku používat</span>'
            + '<button type="button" class="x" id="ag-rp-hide">Nezobrazovat</button></div>'
            + '<div id="ag-rp-list" role="group" aria-label="Režim práce"></div>'
            + '<p id="ag-rp-note"></p>';
        // pod kartu zakázky (režim se vztahuje k zakázce), nad tlačítka Spustit
        if (row.nextSibling) content.insertBefore(w, row.nextSibling);
        else content.appendChild(w);
        w.querySelector('#ag-rp-hide').addEventListener('click', function () {
            lsSet(HIDE_KEY, '1');
            render();
            try { if (typeof window.quickToast === 'function') window.quickToast('Volbu režimu vrátíš v Nastavení → Vzhled'); } catch (e) {}
        });
        w.querySelector('#ag-rp-list').addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('button[data-mode]') : null;
            if (b) pick(b.getAttribute('data-mode'));
        });
        return w;
    }

    function render() {
        injectStyles();
        var w = ensureWrap();
        if (!w) return;
        if (hidden()) { w.hidden = true; return; }
        w.hidden = false;
        var cur = curMode();
        var list = w.querySelector('#ag-rp-list');
        // překreslit jen při změně — úvodní obrazovka se refreshuje i po přepnutí zakázky
        if (list.getAttribute('data-cur') !== cur) {
            list.setAttribute('data-cur', cur);
            list.innerHTML = MODES.map(function (m) {
                return '<button type="button" data-mode="' + m.id + '"' + (m.id === cur ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>'
                    + '<svg class="icon"><use href="' + (ICONS[m.ic] || '#i-grid') + '"/></svg>'
                    + '<b>' + m.t + '</b><span>' + m.s + '</span></button>';
            }).join('');
        }
        var note = w.querySelector('#ag-rp-note');
        var html = noteFor(cur);
        if (note.innerHTML !== html) note.innerHTML = html;
    }

    // ---- přepínač v Nastavení → Vzhled (cesta zpět, když si kartu uklidí) ----------
    function injectSettingRow() {
        if (document.getElementById('ag-rp-setrow')) return;
        // kotvíme na řádek jednoduchého panelu z tools-simple.js, ať jsou volby spolu;
        // kdyby ten modul chyběl, spadneme na režim levé ruky jako ostatní moduly
        var anchor = document.getElementById('ag-ts-setrow') || document.getElementById('s-lefthand');
        var row = (anchor && anchor.classList && anchor.classList.contains('st-row'))
            ? anchor : (anchor && anchor.closest ? anchor.closest('.st-row') : null);
        if (!row || !row.parentNode) return;
        var d = document.createElement('div');
        d.className = 'st-row'; d.id = 'ag-rp-setrow';
        d.innerHTML = '<span class="st-lab">Volba režimu práce na úvodu<small>na úvodní obrazovce vybereš, co dnes děláš, a Nástroje se podle toho zúží</small></span>'
            + '<label class="st-sw"><input type="checkbox" id="ag-rp-sw"><span class="st-sw-face"></span></label>';
        row.parentNode.insertBefore(d, row.nextSibling);
        var cb = d.querySelector('#ag-rp-sw');
        cb.checked = !hidden();
        cb.addEventListener('change', function () { lsSet(HIDE_KEY, cb.checked ? '0' : '1'); render(); });
    }

    // ---- init ---------------------------------------------------------------------
    function tick() {
        try {
            render();
            injectSettingRow();
            var cb = document.getElementById('ag-rp-sw');
            if (cb && cb.checked === hidden()) cb.checked = !hidden();
        } catch (e) {}
    }
    function init() {
        tick();
        // Úvodní obrazovka se překresluje při změně zakázky (renderProjectSelect) —
        // sdílený UI časovač appky stačí, vlastní observer by byl navíc kvůli baterii.
        if (!window.__agRpTimer) {
            window.__agRpTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(tick, 1500);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });

    // veřejné API (hledání funkcí appky / jiné moduly)
    window.AGRezimPrace = { set: pick, get: curMode, render: render };
})();
