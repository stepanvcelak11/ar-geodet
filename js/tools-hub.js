// ===== AR Geodet — ROZCESTNÍKY NÁSTROJŮ (declutter mřížky, 2. kolo) ============
// ODPOJITELNÁ vrstva ve stylu js/usadit-ar.js. NEEDITUJE logika.js ani grafika.js.
// Pokračuje v úklidu Nástrojů: po „Usadit AR" (7 kalibračních dlaždic → průvodce)
// slučuje další příbuzné dlaždice do PĚTI rozcestníků:
//
//   • „Bod výpočtem"    = Rajón + Offset bod + Protínání vpřed
//   • „Signál GNSS"     = GNSS satelity + Predikce signálu + Semafor místa
//   • „Příručka"        = Předpisy & odchylky + Postupy měření + Slovník
//   • „Počasí a světlo" = Počasí + Slunce a světlo + GNSS předpověď + Dnešek v terénu
//   • „Auto a bezpečí"  = Kde mám auto + Kniha jízd + Bezpečnost + Co s sebou
//
// a navíc SKRÝVÁ dlaždice, které mají vstup jinde (v DOM zůstávají — hledáním
// i průvodcem „Usadit AR" jdou dál spustit):
//   • Brutální GPS       → tlačítko v modálu Nový bod (+ větev průvodce Usadit AR)
//   • Vizuální stabilizace → přepínač v Nastavení → AR & přesnost
//   • Skryté body        → tlačítko v Nastavení → Údržba
//
// Kromě slučování dělá modul ještě dvě věci proti „bordelu" v panelu:
//   • hlídá blok „⚡ Teď se hodí" (staví ho usadit-ar.js) — nechá nahoře nejvýš
//     NOW_MAX návrhů, zbytek schová pod nenápadné „další (N)" (viz komentář
//     u NOW_MAX, proč zrovna čtyři),
//   • sjednocuje rastr mřížky: stejně vysoké dlaždice, stejné mezery a stejně
//     odsazené nadpisy sekcí (statické .tool-cat i injektované .ag-ft-head).
//
// Řídí se STEJNÝM přepínačem „Zjednodušené Nástroje" (Nastavení → Vzhled,
// klíč agSimpleTools z usadit-ar.js, výchozí ZAPNUTO). Nic se nemaže.
// Odstranění: smaž js/tools-hub.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var SIMPLE_KEY = 'agSimpleTools';   // sdílený přepínač s usadit-ar.js

    // ---- definice rozcestníků ---------------------------------------------------
    // items: { key: klíč dlaždice (data-tool / funkce z onclicku), fn: nouzová
    //          globální funkce, t: titulek volby, s: popisek volby }
    var HUBS = [
        {
            id: 'bod-vypoctem', label: 'Bod<br>výpočtem', title: 'Bod výpočtem', cat: 'Měření', order: 6,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M6.5 17.5L17.5 6.5"/><path d="M12 12l7 7"/></svg>',
            sub: 'Nový bod z existujících bodů — vyber metodu podle toho, co umíš změřit:',
            items: [
                { key: 'rajon', t: 'Rajón (směr + délka)', s: 'Stojím na známém bodě a mám směr a vodorovnou délku (pásmo, dálkoměr).' },
                { key: 'offset-point', t: 'Offset bod (odsazení)', s: 'Bod odsadím od jiného bodu o azimut/směrník a vzdálenost — třeba roh budovy.' },
                { key: 'ar-intersection', t: 'Protínání vpřed (jen úhly)', s: 'Délku změřit nemůžu — bod protnu záměrami ze dvou známých stanovisek.' }
            ]
        },
        {
            id: 'gnss-signal', label: 'Signál<br>GNSS', title: 'Signál GNSS', cat: 'Měření', order: 7,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><circle cx="4" cy="20" r="0.5" fill="currentColor"/></svg>',
            sub: 'Jak dobré jsou teď (a budou) podmínky pro GPS měření:',
            items: [
                { key: 'openSatModal', fn: 'openSatModal', t: 'Družice teď', s: 'Kolik družic je nad obzorem a jaká je geometrie (GPS, Galileo, GLONASS, BeiDou).' },
                { key: 'sky-obstruction', t: 'Predikce signálu', s: 'Skyplot s maskou překážek — kolik družic zbude u lesa, v zástavbě, ve svahu.' },
                { key: 'gps-semafor', t: 'Semafor místa', s: 'Skóre aktuálního místa: odrazy od fasád (multipath), stabilita, doporučení.' }
            ]
        },
        {
            id: 'prirucka', label: 'Příručka', title: 'Příručka', cat: 'Pomůcky', order: 6,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
            sub: 'Offline tahák do terénu — vše s uvedeným zdrojem:',
            items: [
                { key: 'predpisy', t: 'Předpisy & odchylky', s: 'Mezní odchylky, kódy kvality, lhůty a paragrafy z katastrálních předpisů.' },
                { key: 'postupy', t: 'Postupy měření', s: 'Krok za krokem: rajón, volné stanovisko, polygonový pořad, nivelace, GNSS-RTK…' },
                { key: 'openDictModal', fn: 'openDictModal', t: 'Slovník', s: 'Pojmy a zkratky (TB, ZhB, Bpv, ZPMZ…), vlastní pojmy jdou přidat.' }
            ]
        },
        {
            id: 'pocasi-svetlo', label: 'Počasí<br>a světlo', title: 'Počasí a světlo', cat: 'Pomůcky', order: 7,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><path d="M8 2v1.4M8 12.6V14M2 8h1.4M12.6 8H14M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1"/><path d="M10.8 20.5h7.4a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.5-.8 3.4 3.4 0 0 0 .8 6.8z"/></svg>',
            sub: 'Co dnes udělá obloha — počasí, denní světlo i podmínky pro družice na jednom místě:',
            items: [
                { key: 'pocasi', fn: 'agOpenPocasi', t: 'Počasí', s: 'Předpověď pro místo měření z 18 zdrojů, srážkový radar, vítr, tlak v tvé výšce.' },
                { key: 'slunce', fn: 'agOpenSlunce', t: 'Slunce a světlo', s: 'Východ, západ, konec soumraku, délka stínu a hodiny, kdy budeš mít slunce v ose záměry.' },
                { key: 'gnss-forecast', fn: 'agOpenGnssForecast', t: 'GNSS předpověď', s: 'Kdy dnes bude nejlepší geometrie družic (PDOP) a jestli nezlobí ionosféra (Kp).' },
                { key: 'brifink', fn: 'agOpenBrifink', t: 'Dnešek v terénu', s: 'Ranní souhrn na jedné kartě: počasí, světlo, GNSS okna, body po termínu.' }
            ]
        },
        {
            id: 'auto-bezpeci', label: 'Auto<br>a bezpečí', title: 'Auto a bezpečí', cat: 'Pomůcky', order: 8,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H3v-5l2.4-4.9A2 2 0 0 1 7.2 6h9.6a2 2 0 0 1 1.8 1.1L21 12v5h-2"/><path d="M9 17h6"/><path d="M3 12h18"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
            sub: 'Kolem měření, ne měření samo — auto, kilometry a vlastní kůže:',
            items: [
                { key: 'kde-je', fn: 'agOpenKdeJe', t: 'Kde co mám', s: 'Označ, kde máš bázi, stativ, materiál nebo auto — pak tě tam navede šipka.' },
                { key: 'kniha-jizd', fn: 'agOpenKnihaJizd', t: 'Kniha jízd', s: 'Cesťák navázaný na zakázky, měsíční součty a export CSV pro účetní.' },
                { key: 'bezpecnost', fn: 'agOpenBezpecnost', t: 'Bezpečnost a rizika', s: 'Bouřka, vedro, mráz, vítr, blížící se tma — a poslání vlastní polohy.' },
                { key: 'checklist', fn: 'agOpenChecklist', t: 'Co s sebou', s: 'Balicí seznam podle typu práce a dnešního počasí; odškrtáváš ráno u auta.' }
            ]
        }
    ];
    // dlaždice skryté bez rozcestníku — vstup mají jinde (viz hlavička souboru)
    var EXTRA_HIDE = ['brutal-gps', 'ar-visual-track', 'hidden-points'];

    var HIDE_KEYS = EXTRA_HIDE.slice();
    HUBS.forEach(function (h) { h.items.forEach(function (it) { HIDE_KEYS.push(it.key); }); });

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function simpleOn() { try { return localStorage.getItem(SIMPLE_KEY) !== '0'; } catch (e) { return true; } }
    function getGrid() { var m = document.getElementById('tools-modal'); return m ? m.querySelector('.tool-grid') : null; }
    function closeTools() { var m = document.getElementById('tools-modal'); if (m) m.style.display = 'none'; }

    // klíč dlaždice — stejná logika jako usadit-ar.js / tools-plus.js
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
    // spuštění nástroje = klik na jeho (klidně skrytou) dlaždici; nouzově globál
    function runTool(key, fallbackFn) {
        var t = findTile(key);
        closeModal();
        if (t) { t.click(); return true; }
        if (fallbackFn && typeof window[fallbackFn] === 'function') { closeTools(); try { window[fallbackFn](); } catch (e) {} return true; }
        return false;
    }

    // ---- styly (vzhled shodný s průvodcem Usadit AR) -----------------------------
    function injectStyles() {
        if (document.getElementById('ag-th-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-th-style';
        st.textContent = [
            '#ag-th-ov{position:fixed;inset:0;z-index:1000055;display:none;align-items:center;justify-content:center;background:rgba(4,8,12,0.62);}',
            '#ag-th-ov.open{display:flex;}',
            '#ag-th-card{width:min(94vw,440px);max-height:86vh;overflow:auto;padding:20px;border-radius:18px;',
            '  background:var(--glass-bg,rgba(14,18,24,0.97));border:1px solid var(--glass-border-strong,rgba(255,255,255,0.16));color:var(--text-color,#eceef2);}',
            '#ag-th-card h3{margin:0 0 6px;color:var(--accent,#2f9e74);font-size:calc(17px * var(--ag-font-scale, 1));display:flex;align-items:center;gap:8px;}',
            '#ag-th-card h3 svg{width:20px;height:20px;}',
            '#ag-th-sub{margin:0 0 14px;font-size:calc(13px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);line-height:1.45;}',
            '.ag-th-opt{display:block;width:100%;text-align:left;margin-bottom:8px;padding:13px 14px;border-radius:14px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--surface-1,rgba(255,255,255,0.05));color:inherit;cursor:pointer;}',
            '.ag-th-opt b{display:block;font-size:calc(14.5px * var(--ag-font-scale, 1));margin-bottom:2px;}',
            '.ag-th-opt small{display:block;font-size:calc(12.5px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);line-height:1.4;}',
            '.ag-th-opt:active{background:var(--accent-soft,rgba(47,158,116,0.15));border-color:var(--accent-line,rgba(47,158,116,0.4));}',
            '#ag-th-close{width:100%;margin-top:4px;padding:11px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:transparent;color:var(--text-muted,#9aa1ac);font-weight:600;cursor:pointer;}',
            'body.ag-glove .ag-th-opt{padding:16px;}',
            'body.outdoor-mode #ag-th-card{background:#0a0e1a;}',
            'body.light-mode.outdoor-mode #ag-th-card{background:#fff;}',

            // --- strop bloku „⚡ Teď se hodí" (chipy nad limit se jen schovají) ---
            '#ag-ua-now .ag-ua-chip.ag-th-ovf{display:none;}',
            '#ag-ua-now.ag-th-open .ag-ua-chip.ag-th-ovf{display:inline-flex;}',
            '#ag-ua-now .ag-th-more{border-style:dashed;color:var(--text-muted,#9aa1ac);}',

            // --- jednotný rastr mřížky Nástrojů (méně vizuálního šumu) ---
            // Selektory mají navíc #tools-modal .tool-grid, aby přebily jak style.css,
            // tak pozdější <style> z field-tools.js — jinak by o vzhledu rozhodovalo
            // náhodné pořadí načtení skriptů.
            '#tools-modal .tool-grid{gap:8px;}',
            '#tools-modal .tool-grid .tool-tile{min-height:84px;padding:14px 6px;gap:7px;',
            '  font-size:calc(12px * var(--ag-font-scale, 1));line-height:1.2;}',
            '#tools-modal .tool-grid .tool-tile svg,#tools-modal .tool-grid .tool-tile .icon{width:23px;height:23px;}',
            '#tools-modal .tool-grid .tool-cat,#tools-modal .tool-grid .ag-ft-head{',
            '  margin:12px 2px 2px;padding-top:9px;}',
            '#tools-modal .tool-grid > .tool-cat:first-child,#tools-modal .tool-grid > .ag-ft-head:first-child{',
            '  margin-top:0;padding-top:0;border-top:none;}',
            // v rukavicích zůstávají dlaždice velké (jinak by je tenhle blok zmenšil)
            'body.ag-glove #tools-modal .tool-grid .tool-tile{min-height:96px;padding:16px 6px;font-size:calc(13px * var(--ag-font-scale, 1));}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- rozcestníkový modál ------------------------------------------------------
    function ensureModal() {
        var m = document.getElementById('ag-th-ov');
        if (!m) {
            m = document.createElement('div'); m.id = 'ag-th-ov';
            m.innerHTML = '<div id="ag-th-card"><h3></h3><p id="ag-th-sub"></p><div id="ag-th-body"></div>'
                + '<button type="button" id="ag-th-close">Zavřít</button></div>';
            m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
            document.body.appendChild(m);
            m.querySelector('#ag-th-close').addEventListener('click', closeModal);
        }
        return m;
    }
    function closeModal() { var m = document.getElementById('ag-th-ov'); if (m) m.classList.remove('open'); }
    function openHub(hub) {
        injectStyles();
        var m = ensureModal();
        m.querySelector('h3').innerHTML = hub.icon + ' ' + esc(hub.title);
        m.querySelector('#ag-th-sub').innerHTML = hub.sub;
        var body = m.querySelector('#ag-th-body');
        body.innerHTML = '';
        hub.items.forEach(function (it) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'ag-th-opt';
            b.innerHTML = '<b>' + esc(it.t) + '</b><small>' + esc(it.s) + '</small>';
            b.addEventListener('click', function () { runTool(it.key, it.fn); });
            body.appendChild(b);
        });
        m.classList.add('open');
    }

    // ---- skrývání sloučených dlaždic (stejné chování jako usadit-ar.js) ------------
    function searchQuery() {
        var inp = document.getElementById('tools-search');
        return inp ? (inp.value || '').trim() : '';
    }
    function applySimple() {
        var grid = getGrid(); if (!grid) return;
        // integrace s tools-simple.js: „Zobrazit všechny nástroje" (.ag-sm-all) ruší i naše skrývání
        var showAll = grid.classList.contains('ag-sm-all');
        // BATERIE: searchQuery() (getElementById + čtení value) se dřív volalo i UVNITŘ
        // smyčky přes všechny dlaždice — tick běží po 1,2 s, takže to byl zbytečný
        // průchod DOMem na každou dlaždici. Hodnota se během jednoho průchodu nemění.
        var q = searchQuery();
        var on = simpleOn() && !q && !showAll;
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) {
            if (tiles[i].classList.contains('ag-th-tile')) continue;   // vlastní rozcestníky neskrývat
            // Dlaždici, kterou si uživatel schoval sám v „Moje aktivita" (js/moje-aktivita.js
            // ji značí data-ag-hidden), tady NESMÍME odkrýt zpátky — jinak by se oba moduly
            // v ticku přetahovaly a dlaždice by problikávala.
            if (tiles[i].hasAttribute('data-ag-hidden')) continue;
            var k = tileKey(tiles[i]);
            if (k && HIDE_KEYS.indexOf(k) !== -1) {
                // dlaždice v sekci „Pro tuto práci" (tools-simple.js) se neskrývá
                if (tiles[i].getAttribute('data-ag-ts')) { if (tiles[i].style.display === 'none') tiles[i].style.display = ''; continue; }
                if (on) tiles[i].style.display = 'none';
                else if (tiles[i].style.display === 'none' && !q) tiles[i].style.display = '';
            }
        }
    }
    // po každém průchodu vyhledávání znovu prosadit skrytí (field-tools přepisuje display)
    function wrapFilter() {
        if (window.__agThWrapped || typeof window.agFilterTools !== 'function') return;
        var orig = window.agFilterTools;
        window.agFilterTools = function (v) { var r = orig.apply(this, arguments); try { applySimple(); } catch (e) {} return r; };
        window.__agThWrapped = true;
    }

    // ---- „⚡ Teď se hodí": strop na NOW_MAX návrhů --------------------------------
    // PROČ ZROVNA 4: blok je vodorovný řádek chipů úplně nahoře v Nástrojích a má se
    // číst na JEDEN pohled — v rukavicích, na slunci, často jednou rukou. Pátý a další
    // chip se zalomí na třetí řádek, odtlačí zbytek mřížky pod okraj displeje a
    // „doporučení" se změní v další seznam, který musí geodet přečíst. Čtyři se vejdou
    // na dva řádky i na úzkém iPhonu a pořád je to volba, ne výčet.
    // Nic se nesmí ZTRATIT POTICHU: co je nad limit, schová se pod „další (N)" a jedním
    // ťuknutím se rozbalí. (Zdroj návrhů — usadit-ar.js — dnes sám vrací nejvýš 4;
    // tohle je pojistka, aby strop platil i až kandidátů přibude.)
    var NOW_MAX = 4;
    function nowMoreLabel(box) {
        var m = box.querySelector('.ag-th-more'); if (!m) return;
        if (box.classList.contains('ag-th-open')) { m.textContent = 'méně'; return; }
        m.textContent = 'další (' + box.querySelectorAll('.ag-ua-chip.ag-th-ovf').length + ')';
    }
    function capNow() {
        var box = document.getElementById('ag-ua-now'); if (!box) return;
        var chips = box.querySelectorAll('.ag-ua-chip:not(.ag-th-more)');
        var more = box.querySelector('.ag-th-more');
        var i;
        if (chips.length <= NOW_MAX) {
            for (i = 0; i < chips.length; i++) chips[i].classList.remove('ag-th-ovf');
            box.classList.remove('ag-th-open');
            if (more) more.parentNode.removeChild(more);
            return;
        }
        for (i = 0; i < chips.length; i++) chips[i].classList.toggle('ag-th-ovf', i >= NOW_MAX);
        if (!more) {
            more = document.createElement('button');
            more.type = 'button';
            more.className = 'ag-ua-chip ag-th-more';
            more.addEventListener('click', function () {
                box.classList.toggle('ag-th-open');
                nowMoreLabel(box);
            });
        }
        // usadit-ar.js si blok při změně sady překreslí (innerHTML = ''), takže
        // tlačítko musíme umět kdykoli vrátit — a vždy na konec řádku
        if (box.lastChild !== more) box.appendChild(more);
        nowMoreLabel(box);
    }

    // ---- život modulu ---------------------------------------------------------------
    function tick() {
        try { injectStyles(); wrapFilter(); applySimple(); capNow(); } catch (e) {}
    }
    function init() {
        injectStyles();
        if (typeof window.agRegisterFieldTool === 'function') {
            HUBS.forEach(function (h) {
                window.agRegisterFieldTool({
                    id: h.id, label: h.label.replace(/<br>/g, ' '), icon: h.icon, cat: h.cat, order: h.order,
                    onClick: function () { openHub(h); }
                });
            });
        }
        if (!window.__agThTimer) window.__agThTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1200);
        tick();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    // ruční otevření (app-search, konzole)
    window.agOpenHub = function (id) { var h = null; HUBS.forEach(function (x) { if (x.id === id) h = x; }); if (h) openHub(h); };
})();
