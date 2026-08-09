// ===== AR Geodet — HLEDÁNÍ V NASTAVENÍ + KRÁTKÝ VÝCHOZÍ POHLED (ODPOJITELNÁ) ====
// PROBLÉM: záložka „Vzhled" má 10 přepínačů a rozbalovací „Pokročilé" s dalšími
// dvanácti jezdci a barvami — a moduly do ní ZA BĚHU přisypávají další řádky
// (stavový pruh, jednoduchý panel Nástrojů, režim rukavic, zjednodušené Nástroje).
// Každý nový modul záložku o řádek prodlouží a nikdo ji nezkrátí. Volby jako
// zorný úhel kamery nebo výška očí přitom patří ke kalibraci AR, ne k obecnému
// nastavení.
//
// ŘEŠENÍ, dvě věci naráz:
//
// 1) HLEDÁNÍ nahoře v okně Nastavení. Napíšeš „rukavice", „sever", „offline" —
//    vypadne seznam voleb i s cestou („Vzhled → Ovládání"). Klepnutí přepne
//    záložku, rozbalí „Pokročilé", odscrolluje na řádek a na chvíli ho zvýrazní.
//    Index se staví při každém otevření okna, takže najde i řádky, které do
//    nastavení přisypal modul až za běhu.
//
// 2) KRÁTKÝ VÝCHOZÍ POHLED. Každá záložka ukazuje jen to, co se v terénu mění
//    opravdu často (viz KEEP níž); zbytek — VČETNĚ toho, co přisypou moduly —
//    je pod tlačítkem „Zobrazit vše (+N)". Tím záložka přestane přerůstat: nový
//    modul si sice řádek přidá, ale výchozí pohled se nezvětší. Přepínač
//    „Krátké nastavení" ve Vzhledu to celé vypne.
//
// Volby patřící jednomu nástroji nechávám tam, kde jsou — saveSettings()
// v grafika.js je čte podle id a stěhování DOM by bylo zbytečné riziko. Místo
// toho je nástroj umí ODKÁZAT: window.AGSettings.reveal('s-fovh') otevře
// Nastavení přesně na tom jezdci. Napojeno na průvodce „Zorný úhel kamery".
//
// Odstranění: smaž js/nastaveni-hledani.js + řádek <script> v index.html
// (a přegeneruj sw.js). Nastavení pak vypadá přesně jako dřív.
// ================================================================================
(function () {
    'use strict';
    if (window.AGSettings) return;

    var STYLE_ID = 'ag-ns-style', BOX_ID = 'ag-ns-search', RES_ID = 'ag-ns-res';
    var SHORT_KEY = 'agShortSettings_v1';    // '0' = krátký pohled vypnut

    // Záložky a jejich lidské názvy (pro cestu ve výsledcích hledání)
    var TABS = [
        { id: 'tab-vzhled', t: 'Vzhled' },
        { id: 'tab-ar', t: 'AR a přesnost' },
        { id: 'tab-data', t: 'Data' },
        { id: 'tab-udrzba', t: 'Údržba' }
    ];

    // Co zůstává vidět v krátkém pohledu — id ovládacího prvku uvnitř řádku.
    // Vybráno podle toho, co geodet mění v terénu, ne podle toho, co existuje.
    var KEEP = {
        'tab-vzhled': ['seg-mode', 'v-theme', 's-outdoor', 'tgl-info', 'tgl-compass', 'tgl-gpsavg'],
        'tab-ar': ['s-ar-radius-slider', 's-max-ar-slider'],
        'tab-data': ['s-project-select', 'f-tb', 's-map-radius-slider'],
        'tab-udrzba': null           // null = nekrátit (jsou tam jen 4 tlačítka)
    };
    // Tlačítka, která v krátkém pohledu zůstávají (poznají se podle textu onclicku)
    var KEEP_BTN = { 'tab-ar': ['openCompassModal'], 'tab-data': ['saveForOffline'] };

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function norm(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
        return s.replace(/\s+/g, ' ').trim();
    }
    function shortOn() { try { return localStorage.getItem(SHORT_KEY) !== '0'; } catch (e) { return true; } }
    function modal() { return document.getElementById('settings-modal'); }
    function isOpen() { var m = modal(); return !!(m && m.style.display === 'flex'); }

    // ---- styly -----------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + BOX_ID + '{position:relative;margin:0 0 12px;}',
            '#' + BOX_ID + ' input{width:100%;box-sizing:border-box;margin:0;}',
            '#' + RES_ID + '{display:none;margin-top:8px;border-radius:12px;overflow:hidden;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  background:var(--surface-1,rgba(255,255,255,0.05));}',
            '#' + RES_ID + '.on{display:block;}',
            '.ag-ns-hit{display:block;width:100%;box-sizing:border-box;text-align:left;cursor:pointer;',
            '  padding:11px 13px;border:0;background:transparent;color:inherit;font:inherit;}',
            '.ag-ns-hit + .ag-ns-hit{border-top:1px solid var(--glass-border,rgba(255,255,255,0.08));}',
            '.ag-ns-hit b{display:block;font-size:calc(14px * var(--ag-font-scale, 1));font-weight:600;line-height:1.3;}',
            '.ag-ns-hit small{display:block;margin-top:2px;font-size:calc(11.5px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);}',
            '.ag-ns-hit .ag-ns-path{color:var(--accent,#2f9e74);font-weight:700;}',
            '.ag-ns-hit:active{background:var(--accent-soft,rgba(47,158,116,0.15));}',
            '.ag-ns-hit:focus-visible{outline:2px solid var(--accent,#2f9e74);outline-offset:-2px;}',
            '.ag-ns-none{padding:12px 13px;font-size:calc(13px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);}',

            // krátký pohled
            'body.ag-ns-short .settings-tab:not(.ag-ns-all) .ag-ns-adv{display:none !important;}',
            '.ag-ns-more{display:none;width:100%;box-sizing:border-box;margin:14px 0 2px;padding:11px;',
            '  border-radius:12px;cursor:pointer;border:1px dashed var(--glass-border,rgba(255,255,255,0.2));',
            '  background:transparent;color:var(--text-muted,#9aa1ac);',
            '  font:600 12.5px/1 var(--font-ui,system-ui),sans-serif;}',
            'body.ag-ns-short .ag-ns-more{display:block;}',
            '.settings-tab.ag-ns-all .ag-ns-more{border-style:solid;color:var(--accent,#2f9e74);',
            '  border-color:var(--accent-line,rgba(47,158,116,0.4));}',

            // zvýraznění nalezeného řádku
            '@keyframes ag-ns-flash{0%,100%{box-shadow:0 0 0 0 rgba(47,158,116,0);}',
            '  25%,75%{box-shadow:0 0 0 3px var(--accent-line,rgba(47,158,116,0.55));}}',
            '.ag-ns-found{border-radius:10px;animation:ag-ns-flash 1.8s ease-in-out 2;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- index voleb -------------------------------------------------------------------
    // Prochází PŘÍMÉ potomky každé záložky (řádky, jezdce, tlačítka, sekce) i obsah
    // rozbalovacího „Pokročilé". Titulek bere z popisku, ne z id.
    var _index = [];

    function labelOf(el) {
        var lab = el.querySelector ? el.querySelector('.st-lab') : null;
        if (lab) {
            var c = lab.cloneNode(true);
            var sm = c.querySelector('small');
            var hint = sm ? (sm.textContent || '').replace(/\s+/g, ' ').trim() : '';
            if (sm) sm.remove();
            return { t: (c.textContent || '').replace(/\s+/g, ' ').trim(), h: hint };
        }
        if (el.tagName === 'BUTTON') return { t: (el.textContent || '').replace(/\s+/g, ' ').trim(), h: '' };
        var l = el.querySelector ? el.querySelector('label') : null;
        if (l) return { t: (l.textContent || '').replace(/\s+/g, ' ').trim(), h: '' };
        if (el.tagName === 'LABEL') return { t: (el.textContent || '').replace(/\s+/g, ' ').trim(), h: '' };
        return null;
    }
    function collect(host, tabTitle, section, out) {
        var kids = host.children;
        for (var i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (el.classList.contains('set-h')) { section = (el.textContent || '').trim(); continue; }
            if (el.classList.contains('ag-ns-more') || el.id === BOX_ID) continue;
            if (el.tagName === 'DETAILS') {
                var b = el.querySelector('.adv-body');
                if (b) collect(b, tabTitle, section, out);
                continue;
            }
            if (el.tagName === 'INPUT' && el.type === 'file') continue;
            if (el.tagName === 'SELECT' && el.style.display === 'none') continue;
            var info = labelOf(el);
            if (!info || !info.t) continue;
            out.push({ el: el, t: info.t, h: info.h, path: tabTitle + (section ? ' → ' + section : '') });
        }
    }
    function buildIndex() {
        _index = [];
        TABS.forEach(function (tb) {
            var host = document.getElementById(tb.id);
            // Oprávnění podle role: ucty.js applyPerms() skrývá CELÉ záložky
            // Nastavení (panel i jeho tlačítko) přes display:none. Index se staví
            // z DOM, takže bez téhle podmínky by hledání našlo a přes reveal()
            // i otevřelo volbu ze záložky, na kterou uživatel nemá právo.
            // Index se přestavuje při každém otevření Nastavení, takže po
            // přihlášení / změně role je vždy aktuální.
            if (host && host.style.display !== 'none') collect(host, tb.t, '', _index);
        });
        // kompas je samostatné okno, ale uživatel ho hledá jako nastavení
        var k = document.getElementById('tab-kompas');
        if (k) collect(k, 'Kompas a sever', '', _index);
        _index.forEach(function (r) { r.q = norm(r.t + ' ' + r.h + ' ' + r.path); });
    }

    // ---- odhalení řádku ----------------------------------------------------------------
    function tabOf(el) {
        var t = el.closest ? el.closest('.settings-tab') : null;
        if (t) return t;
        return (el.closest && el.closest('#tab-kompas')) ? document.getElementById('tab-kompas') : null;
    }
    function switchToTab(tabEl) {
        if (!tabEl || !tabEl.id) return;
        if (tabEl.id === 'tab-kompas') {
            var sm = modal(); if (sm) sm.style.display = 'none';
            var cm = document.getElementById('compass-modal'); if (cm) cm.style.display = 'flex';
            return;
        }
        var btns = document.querySelectorAll('#settings-modal .tab-btn');
        for (var i = 0; i < btns.length; i++) {
            if ((btns[i].getAttribute('onclick') || '').indexOf(tabEl.id) !== -1) {
                try { if (typeof window.switchTab === 'function') return window.switchTab(tabEl.id, btns[i]); } catch (e) {}
                btns[i].click();
                return;
            }
        }
    }
    function reveal(target) {
        var el = (typeof target === 'string') ? document.getElementById(target) : target;
        if (!el) return false;
        // id může ukazovat na samotný input — pracujeme s celým řádkem
        var row = el.closest ? (el.closest('.st-row, .st-slider, .st-chips, .color-row') || el) : el;
        var tabEl = tabOf(row);

        if (!isOpen() && typeof window.openSettings === 'function') { try { window.openSettings(); } catch (e) {} }
        switchToTab(tabEl);
        if (tabEl) tabEl.classList.add('ag-ns-all');            // ať není schovaný v „Zobrazit vše"
        var d = row.closest ? row.closest('details') : null;
        if (d) d.open = true;

        closeResults();
        setTimeout(function () {
            try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { row.scrollIntoView(); } catch (e2) {} }
            row.classList.add('ag-ns-found');
            setTimeout(function () { row.classList.remove('ag-ns-found'); }, 4000);
        }, 160);
        return true;
    }

    // ---- hledání ------------------------------------------------------------------------
    function ensureBox() {
        if (document.getElementById(BOX_ID)) return;
        var m = modal(); if (!m) return;
        var tabs = m.querySelector('.tab-buttons'); if (!tabs) return;
        var wrap = document.createElement('div');
        wrap.id = BOX_ID;
        // Od 9. 8. 2026 se odsud hledá i MIMO nastavení (nástroje, Body, Kompas, menu
        // Více) — pole „Hledat v aplikaci" se z panelu „Více" přestěhovalo sem, aby
        // bylo hledání v appce jedno jediné a na místě, kde ho člověk čeká.
        wrap.innerHTML = '<input type="search" id="ag-ns-q" placeholder="Hledat v nastavení i v aplikaci…" autocomplete="off">'
            + '<div id="' + RES_ID + '" role="listbox"></div>';
        tabs.parentNode.insertBefore(wrap, tabs);
        var inp = wrap.querySelector('#ag-ns-q');
        inp.addEventListener('input', function () { runSearch(inp.value); });
        inp.addEventListener('focus', buildIndex);
    }
    function closeResults() {
        var r = document.getElementById(RES_ID);
        if (r) { r.classList.remove('on'); r.innerHTML = ''; }
        var i = document.getElementById('ag-ns-q');
        if (i) i.value = '';
    }
    function runSearch(q) {
        var res = document.getElementById(RES_ID); if (!res) return;
        var nq = norm(q);
        if (nq.length < 2) { res.classList.remove('on'); res.innerHTML = ''; return; }
        if (!_index.length) buildIndex();
        var toks = nq.split(' ');
        var hits = _index.filter(function (r) {
            for (var i = 0; i < toks.length; i++) { if (r.q.indexOf(toks[i]) === -1) return false; }
            return true;
        }).slice(0, 10);
        var app = appHits(q);

        res.innerHTML = '';
        if (!hits.length && !app.length) {
            res.innerHTML = '<div class="ag-ns-none">Nic takového v appce není. Zkus jiné slovo — třeba „rukavice", „sever", „offline", „baterie".</div>';
            res.classList.add('on');
            return;
        }
        hits.forEach(function (r) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'ag-ns-hit';
            b.innerHTML = '<b>' + esc(r.t) + '</b><small><span class="ag-ns-path">' + esc(r.path) + '</span>'
                + (r.h ? ' · ' + esc(r.h) : '') + '</small>';
            b.addEventListener('click', function () { reveal(r.el); });
            res.appendChild(b);
        });
        app.forEach(function (it) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'ag-ns-hit';
            b.innerHTML = '<b>' + esc(it.label) + '</b><small><span class="ag-ns-path">'
                + esc(it.src || 'Aplikace') + '</span></small>';
            b.addEventListener('click', function () { runOutside(it); });
            res.appendChild(b);
        });
        res.classList.add('on');
    }

    // ---- cíle MIMO nastavení (js/app-search.js) -----------------------------------------
    function appHits(q) {
        try {
            if (!window.AGAppSearch || typeof window.AGAppSearch.find !== 'function') return [];
            return window.AGAppSearch.find(q).slice(0, 6);
        } catch (e) { return []; }
    }
    // ⚠ Nastavení se ukládá TEPRVE tlačítkem „Uložit vše a Zavřít" — kdyby se odsud
    // skočilo do nástroje a okno se jen zavřelo, tiše by se zahodilo, co uživatel
    // přenastavil. Odchod proto jde přes uložení (stejná dohoda jako u zavření tahem
    // v js/modal-close.js), teprve pak se otevře cíl.
    function runOutside(it) {
        closeResults();
        try {
            if (typeof window.saveSettings === 'function') window.saveSettings();
            else { var m = modal(); if (m) m.style.display = 'none'; }
        } catch (e) {}
        setTimeout(function () {
            try { it.run(); } catch (err) { console.warn('[nastaveni-hledani]', err); }
        }, 60);
    }

    // ---- krátký pohled -------------------------------------------------------------------
    function keepEl(el, tabId) {
        var keep = KEEP[tabId];
        if (keep === null) return true;                  // záložka se nekrátí
        if (!keep) keep = [];
        for (var i = 0; i < keep.length; i++) {
            if (el.id === keep[i]) return true;
            if (el.querySelector && el.querySelector('#' + keep[i])) return true;
        }
        var kb = KEEP_BTN[tabId] || [];
        var oc = el.getAttribute ? (el.getAttribute('onclick') || '') : '';
        for (var j = 0; j < kb.length; j++) { if (oc.indexOf(kb[j]) !== -1) return true; }
        return false;
    }
    function tagTab(tabEl) {
        var tabId = tabEl.id;
        if (KEEP[tabId] === null) return 0;
        var kids = tabEl.children, hidden = 0;
        var lastHead = null, headHasVisible = false;
        // Samostatný <label> a jeho ovládací prvek jsou v index.html DVA sourozenci
        // („Barevný odstín" + <select>). Rozhodnutí se proto odkládá na ten prvek
        // a pak se použije i na popisek — jinak by zůstal jezdec bez názvu.
        var pending = [];
        function flush() { if (lastHead) lastHead.classList.toggle('ag-ns-adv', !headHasVisible); }
        // popisek sdílí osud svého prvku, ale do počtu „+N" se nepočítá —
        // uživatel by jinak čekal dvakrát tolik skrytých voleb, než jich je
        function settle(adv) {
            for (var p = 0; p < pending.length; p++) pending[p].classList.toggle('ag-ns-adv', adv);
            pending = [];
        }
        for (var i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (el.classList.contains('ag-ns-more') || el.id === BOX_ID) continue;
            if (el.classList.contains('set-h')) { settle(true); flush(); lastHead = el; headHasVisible = false; continue; }
            if (el.tagName === 'LABEL') { pending.push(el); continue; }
            if (el.tagName === 'INPUT' && el.type === 'file') continue;
            if (el.tagName === 'DATALIST') continue;
            if (el.tagName === 'SELECT' && el.style.display === 'none') continue;
            // „Pokročilé" zůstává vidět vždy — je to zavedená cesta k detailům
            if (el.tagName === 'DETAILS') { settle(false); headHasVisible = true; el.classList.remove('ag-ns-adv'); continue; }
            var adv = !keepEl(el, tabId);
            el.classList.toggle('ag-ns-adv', adv);
            settle(adv);                       // popisek sdílí osud svého prvku
            if (adv) hidden++; else headHasVisible = true;
        }
        settle(true);                          // popisek na konci bez prvku = detail
        flush();
        return hidden;
    }
    function ensureMore(tabEl, hidden) {
        var btn = tabEl.querySelector(':scope > .ag-ns-more');
        if (KEEP[tabEl.id] === null || !hidden) { if (btn) btn.remove(); return; }
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'ag-ns-more';
            btn.addEventListener('click', function () {
                tabEl.classList.toggle('ag-ns-all');
                syncShort();
            });
        }
        if (tabEl.lastElementChild !== btn) tabEl.appendChild(btn);
        btn.textContent = tabEl.classList.contains('ag-ns-all')
            ? '✓ Skrýt méně používané'
            : 'Zobrazit vše (+' + hidden + ')';
    }
    function syncShort() {
        document.body.classList.toggle('ag-ns-short', shortOn());
        TABS.forEach(function (tb) {
            var el = document.getElementById(tb.id);
            if (!el) return;
            var hidden = tagTab(el);
            ensureMore(el, hidden);
        });
    }

    // ---- přepínač „Krátké nastavení" ve Vzhledu ---------------------------------------------
    function injectToggle() {
        if (document.getElementById('ag-ns-setrow')) return;
        var tab = document.getElementById('tab-vzhled'); if (!tab) return;
        var row = document.createElement('div');
        row.className = 'st-row'; row.id = 'ag-ns-setrow';
        row.innerHTML = '<span class="st-lab">Krátké nastavení<small>ukázat jen často měněné; zbytek přes „Zobrazit vše" nebo hledání nahoře</small></span>'
            + '<label class="st-sw"><input type="checkbox" id="ag-ns-short-cb"><span class="st-sw-face"></span></label>';
        tab.appendChild(row);
        var cb = row.querySelector('#ag-ns-short-cb');
        cb.checked = shortOn();
        cb.addEventListener('change', function () {
            try { localStorage.setItem(SHORT_KEY, cb.checked ? '1' : '0'); } catch (e) {}
            syncShort();
        });
        // vlastní řádek zůstává vidět, jinak by ho krátký pohled schoval sám sebou
        KEEP['tab-vzhled'].push('ag-ns-short-cb');
    }

    // ---- život modulu -----------------------------------------------------------------------
    var _wasOpen = false;
    function tick() {
        try {
            injectStyles();
            injectToggle();
            ensureBox();
            var open = isOpen();
            if (open && !_wasOpen) { buildIndex(); closeResults(); }   // svěží index při každém otevření
            _wasOpen = open;
            syncShort();
            var cb = document.getElementById('ag-ns-short-cb');
            if (cb && cb.checked !== shortOn()) cb.checked = shortOn();
        } catch (e) {}
    }
    function init() {
        try { tick(); } catch (e) { console.warn('[nastaveni-hledani] init', e); }
        if (!window.__agNsTimer) {
            window.__agNsTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1600);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 500); });

    // Veřejné API: nástroj umí odkázat na svoji volbu — AGSettings.reveal('s-fovh')
    window.AGSettings = { reveal: reveal, reindex: buildIndex, search: runSearch };
})();
