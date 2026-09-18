// ===== QTRIG — HLEDÁNÍ V NASTAVENÍ (ODPOJITELNÁ) ================================
// Pole nahoře v okně Nastavení: napíšeš „rukavice", „sever", „offline" — vypadne seznam
// voleb i s cestou („Mapa a body → Přesnost z mapy") a k tomu cíle mimo nastavení
// (js/app-search.js). Klepnutí otevře stránku, rozbalí „Pokročilé", odscrolluje na
// řádek a na chvíli ho zvýrazní. Index se staví při každém otevření okna, takže najde
// i řádky, které do nastavení přisypal modul až za běhu.
//
// Do 18. 9. 2026 večer tu byl i „KRÁTKÝ VÝCHOZÍ POHLED" (každá záložka ukazovala jen
// vybrané řádky, zbytek za „Zobrazit vše (+N)", přepínač Krátké nastavení). S Nastavením
// nanovo (první obrazovka Časté + kategorie + stránky) ztratil smysl a je pryč — strukturu
// drží samo rozdělení na stránky (index.html) a js/nastaveni-poradek.js.
//
// Volby patřící jednomu nástroji nechávám tam, kde jsou — saveSettings() v grafika.js
// je čte podle id a stěhování DOM by bylo zbytečné riziko. Místo toho je nástroj umí
// ODKÁZAT: window.AGSettings.reveal('s-fovh') otevře Nastavení přesně na tom jezdci.
// Napojeno na průvodce „Zorný úhel kamery".
//
// Odstranění: smaž js/nastaveni-hledani.js + řádek <script> v index.html
// (a přegeneruj sw.js). Nastavení pak bude bez hledání, jinak stejné.
// ================================================================================
(function () {
    'use strict';
    if (window.AGSettings) return;

    var STYLE_ID = 'ag-ns-style', BOX_ID = 'ag-ns-search', RES_ID = 'ag-ns-res';

    // Stránky a jejich lidské názvy (pro cestu ve výsledcích hledání) — pořadí jako v #set-home
    var TABS = [
        { id: 'set-caste', t: 'Časté' },
        { id: 'tab-ar', t: 'AR kamera' },
        { id: 'tab-mapa', t: 'Mapa a body' },
        { id: 'tab-vzhled', t: 'Vzhled' },
        { id: 'tab-ovladani', t: 'Ovládání' },
        { id: 'tab-vykon', t: 'Výkon a baterie' },
        { id: 'tab-data', t: 'Zakázka a data' },
        { id: 'tab-udrzba', t: 'Záloha a údržba' },
        { id: 'tab-ucet', t: 'Účet a aplikace' }
    ];

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function norm(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'nastaveni-hledani:norm'); }
        return s.replace(/\s+/g, ' ').trim();
    }
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
            if (el.classList.contains('ag-ns-more') || el.classList.contains('ag-set-drop') || el.id === BOX_ID) continue;
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
            if (host && host.style.display !== 'none') collect(host, tb.t, '', _index);   // #set-caste = karta Časté, ostatní stránky
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
        if (el.closest && el.closest('#set-home')) return document.getElementById('set-home');
        return (el.closest && el.closest('#tab-kompas')) ? document.getElementById('tab-kompas') : null;
    }
    function switchToTab(tabEl) {
        if (!tabEl || !tabEl.id) return;
        if (tabEl.id === 'tab-kompas') {
            var sm = modal(); if (sm) sm.style.display = 'none';
            var cm = document.getElementById('compass-modal'); if (cm) cm.style.display = 'flex';
            return;
        }
        if (tabEl.id === 'set-home') { try { if (typeof window.agSettingsHome === 'function') window.agSettingsHome(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'nastaveni-hledani:switchToTab'); } return; }
        var btn = document.querySelector('#settings-modal .tab-btn[data-tab="' + tabEl.id + '"]');
        try { if (typeof window.switchTab === 'function') return window.switchTab(tabEl.id, btn); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'nastaveni-hledani:switchToTab'); }
        if (btn) btn.click();
    }
    function reveal(target) {
        var el = (typeof target === 'string') ? document.getElementById(target) : target;
        if (!el) return false;
        // id může ukazovat na samotný input — pracujeme s celým řádkem
        var row = el.closest ? (el.closest('.st-row, .st-slider, .st-chips, .color-row') || el) : el;
        var tabEl = tabOf(row);

        if (!isOpen() && typeof window.openSettings === 'function') { try { window.openSettings(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'nastaveni-hledani:reveal'); } }
        switchToTab(tabEl);
        var d = row.closest ? row.closest('details') : null;
        if (d) d.open = true;
        // Sekce Nastavení se dají sbalit (js/nastaveni-poradek.js). Nalezená volba
        // může ležet právě ve sbalené sekci — pak by skok doskrolloval na prázdno.
        try { if (window.AGSettingsOrder && window.AGSettingsOrder.unfold) window.AGSettingsOrder.unfold(row); }
        catch (e) { window.AG && AG.swallow && AG.swallow(e, 'nastaveni-hledani:reveal'); }

        closeResults();
        setTimeout(function () {
            try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { row.scrollIntoView(); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'nastaveni-hledani:reveal'); } }
            row.classList.add('ag-ns-found');
            setTimeout(function () { row.classList.remove('ag-ns-found'); }, 4000);
        }, 160);
        return true;
    }

    // ---- hledání ------------------------------------------------------------------------
    function ensureBox() {
        if (document.getElementById(BOX_ID)) return;
        var m = modal(); if (!m) return;
        var home = document.getElementById('set-home'); if (!home || !home.parentNode) return;
        var wrap = document.createElement('div');
        wrap.id = BOX_ID;
        // Od 9. 8. 2026 se odsud hledá i MIMO nastavení (nástroje, Body, Kompas, menu
        // Více) — pole „Hledat v aplikaci" se z panelu „Více" přestěhovalo sem, aby
        // bylo hledání v appce jedno jediné a na místě, kde ho člověk čeká.
        wrap.innerHTML = '<input type="search" id="ag-ns-q" placeholder="Hledat v nastavení i v aplikaci…" autocomplete="off">'
            + '<div id="' + RES_ID + '" role="listbox"></div>';
        home.parentNode.insertBefore(wrap, home);
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
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'nastaveni-hledani:runOutside'); }
        setTimeout(function () {
            try { it.run(); } catch (err) { console.warn('[nastaveni-hledani]', err); }
        }, 60);
    }

    // ---- život modulu -----------------------------------------------------------------------
    var _wasOpen = false;
    function tick() {
        try {
            injectStyles();
            ensureBox();
            var open = isOpen();
            // svěží index při každém otevření. ⚠ NEMAZAT, když už člověk píše (12. 9. 2026):
            // tick běží na časovači, takže když někdo otevřel Nastavení a hned začal hledat,
            // první tick po otevření mu text z pole tiše smazal.
            if (open && !_wasOpen) { buildIndex(); var q0 = document.getElementById('ag-ns-q'); if (!(q0 && (document.activeElement === q0 || q0.value))) closeResults(); }
            _wasOpen = open;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'nastaveni-hledani:tick'); }
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
