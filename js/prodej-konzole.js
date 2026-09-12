// ===== QTRIG — LIDÉ A PRODEJ: konzole vlastníka (ODPOJITELNÁ vrstva) ========
// Druhá obrazovka konzole vlastníka vedle „Všechny firmy" (js/sprava-appky.js).
// Ta je o FIRMÁCH (stropy, zmrazení, úklid); tahle je o LIDECH a o PENĚZÍCH:
//
//   LIDÉ — každý účet v appce: kdo to je, ve kterých prostorech je a co dělá
//          (poslední aktivita), tarif. U každého: Zapnout Pro (měsíc / rok /
//          navždy), Vypnout Pro, Zablokovat („vyhodit z appky", vratné),
//          Zprávy (schránka od lidí).
//   OBJEDNÁVKY — co lidi objednali a zaplatili, stav automatu z banky (Fio),
//          tlačítko Zaplaceno pro ruční potvrzení, nezařazené platby k přiřazení.
//   ŽÁDOSTI (12. 9. 2026) — Pro se neprodává samo: člověk o ně z karty Verze Pro
//          POŽÁDÁ (js/pro-karta.js → POST /feedback, kind 'pro', kód účtu v meta)
//          a tady se žádost vyřídí: Zapnout Pro (navždy / rok / měsíc) najde účet
//          podle kódu a zprávu označí jako vyřízenou. Rozhodnutí uživatele:
//          „Pro nechám uzavřené, ale musí mě požádat, abych jim to otevřel."
//
// ⚠ O PŘÍSTUPU ROZHODUJE SERVER, NE SKRYTÍ V UI. Všechno jde přes /owner/* s
//   hlavičkou X-Owner-Key (tentýž klíč jako Správa aplikace, localStorage
//   agFbKey_v1). Kdo klíč nemá, dostane 403, i kdyby si tlačítko našel.
//
// ⚠ „ZABLOKOVAT" NEMAŽE. Účet dostane disabled=1, server ho při příštím
//   požadavku odmítne (auth() čte účet čerstvý z DB) a appka ho do minuty
//   odhlásí. Data zůstávají; Odblokovat všechno vrátí. Mazání lidí schválně
//   není — ztráta naměřených dat cizího člověka je nevratná.
//
// Vstup: Konzole vlastníka (js/vlastnik.js) → „Lidé a prodej Pro";
//   window.AGProdej.open().
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + './js/prodej-konzole.js'
// v sw.js + položku v js/vlastnik.js. Routy /owner/ucty, /owner/objednavky,
// /owner/blokace ve workeru pak jen zůstanou nepoužité.
// ================================================================================
(function () {
    'use strict';
    if (window.AGProdej) return;

    var LS_KEY = 'agFbKey_v1';
    var MODAL_ID = 'ag-pd-modal';
    var STYLE_ID = 'ag-pd-style';
    var API_FALLBACK = 'https://ar-geodet-api.ar-geodet.workers.dev';
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="9" cy="8" r="4"/><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/><path d="M17 3.5a3 3 0 0 1 0 6"/><path d="M19 13.5a5 5 0 0 1 3 4.5v3"/></svg>';

    var _tab = 'lide', _lide = null, _obj = null, _zad = null, _q = '', _open = '', _busy = false;

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'prodej-konzole:' + kde); } catch (x) { } }
    function esc(s) {
        if (window.AG && AG.esc) return AG.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function agAlert(t, m) {
        try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { swallow(e, 'agAlert'); }
        try { alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e) { swallow(e, 'agAlert2'); }
    }
    function ask(m) {
        try { if (typeof window.agAsk === 'function') return window.agAsk(m); } catch (e) { swallow(e, 'ask'); }
        return Promise.resolve(window.confirm(m));
    }
    function base() {
        try {
            var u = window.AGUcty;
            if (u && typeof u.apiUrl === 'function') return u.apiUrl();
            if (u && u.DEFAULT_API) return u.DEFAULT_API;
        } catch (e) { swallow(e, 'base'); }
        return API_FALLBACK;
    }
    function ownerKey() { try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; } }
    function api(path, opts) {
        opts = opts || {};
        // klíč mimo ASCII fetch() odmítne dřív, než cokoli odešle — říct to rovnou
        if (!/^[ -~]+$/.test(ownerKey())) return Promise.resolve({ ok: false, status: 0, data: { error: 'klic-neascii' } });
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null, to = null, p;
        try {
            p = fetch(base() + path, {
                method: opts.method || 'GET',
                headers: { 'Content-Type': 'application/json', 'X-Owner-Key': ownerKey() },
                body: opts.body != null ? JSON.stringify(opts.body) : undefined,
                signal: ctrl ? ctrl.signal : undefined
            });
            if (ctrl) to = setTimeout(function () { try { ctrl.abort(); } catch (e) { swallow(e, 'abort'); } }, opts.timeoutMs || 15000);
        } catch (e) { if (to) clearTimeout(to); return Promise.resolve({ ok: false, status: 0, data: null }); }
        return p.then(function (r) {
            if (to) clearTimeout(to);
            return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
        }).catch(function () { if (to) clearTimeout(to); return { ok: false, status: 0, data: null }; });
    }
    function sayFail(r, kde) {
        if (r.status === 0 && r.data && r.data.error === 'klic-neascii') return agAlert('Klíč vlastníka', 'Klíč obsahuje znak, který HTTP hlavička neunese (háček, čárka, emoji…). Nastav OWNER_KEY jen z písmen a–z, číslic a pomlček, aspoň 24 znaků.');
        if (r.status === 0) return agAlert('Bez signálu', 'Server neodpověděl. Zkus to, až bude síť.');
        if (r.status === 503) return agAlert('Konzole není nastavená', 'Na serveru chybí tajemství <b>OWNER_KEY</b> (nebo je kratší než 24 znaků).');
        if (r.status === 403) return agAlert('Špatný klíč', 'Klíč konzole nesedí — změň ho v Konzoli vlastníka.');
        agAlert('Nepovedlo se', esc((r.data && r.data.error) || ('Chyba ' + r.status + ' — ' + kde)));
    }
    function den(ts) {
        if (!ts) return 'nikdy';
        var s = Math.max(0, Date.now() - ts) / 1000;
        if (s < 3600) return 'před ' + Math.round(s / 60) + ' min';
        if (s < 172800) return 'před ' + Math.round(s / 3600) + ' h';
        return 'před ' + Math.round(s / 86400) + ' dny';
    }
    function datum(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleDateString('cs-CZ'); } catch (e) { return '—'; } }
    function bezDia(s) { s = String(s || '').toLowerCase(); try { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { return s; } }

    // ---- styly ------------------------------------------------------------------------
    function styly() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + MODAL_ID + ' .pd-tabs{display:flex;gap:6px;margin:0 0 12px;}',
            '#' + MODAL_ID + ' .pd-tabs button{flex:1;padding:9px;border-radius:10px;font:600 13px/1 var(--font-ui,system-ui);cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,.16));background:transparent;color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .pd-tabs button.on{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,.14));color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .pd-top{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:0 0 10px;}',
            '#' + MODAL_ID + ' .pd-cell{background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  border-radius:12px;padding:8px 4px;text-align:center;}',
            '#' + MODAL_ID + ' .pd-cell b{display:block;font:800 17px/1.1 var(--font-display,system-ui);color:var(--text-color,#e6e8eb);}',
            '#' + MODAL_ID + ' .pd-cell span{display:block;margin-top:3px;font:600 10px/1.2 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);',
            '  text-transform:uppercase;letter-spacing:.04em;}',
            '#' + MODAL_ID + ' .pd-cell.warn b{color:#d4a02c;}',
            '#' + MODAL_ID + ' .pd-row{display:flex;align-items:center;gap:9px;padding:9px 8px;border-radius:11px;cursor:pointer;border:1px solid transparent;}',
            '#' + MODAL_ID + ' .pd-row:hover{background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '#' + MODAL_ID + ' .pd-row.on{background:var(--glass-bg,rgba(255,255,255,0.06));border-color:var(--glass-border,rgba(255,255,255,0.14));}',
            '#' + MODAL_ID + ' .pd-dot{width:9px;height:9px;border-radius:50%;flex:none;background:var(--text-muted,#9aa1ac);opacity:.5;}',
            '#' + MODAL_ID + ' .pd-dot.pro{background:var(--accent,#2f9e74);opacity:1;}',
            '#' + MODAL_ID + ' .pd-dot.blok{background:#e0574a;opacity:1;}',
            '#' + MODAL_ID + ' .pd-dot.ceka{background:#d4a02c;opacity:1;}',
            '#' + MODAL_ID + ' .pd-nm{flex:1;min-width:0;}',
            '#' + MODAL_ID + ' .pd-nm b{display:block;font:700 13.5px/1.25 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);',
            '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#' + MODAL_ID + ' .pd-nm small{display:block;margin-top:2px;font:500 11px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);',
            '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#' + MODAL_ID + ' .pd-cnt{flex:none;text-align:right;font:700 12px/1.25 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '#' + MODAL_ID + ' .pd-cnt small{display:block;margin-top:2px;font:500 10.5px/1.2 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .pd-det{padding:4px 8px 14px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.08));margin-bottom:4px;}',
            '#' + MODAL_ID + ' .pd-lab{font:600 10.5px/1 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);text-transform:uppercase;letter-spacing:.05em;margin:10px 0 5px;}',
            '#' + MODAL_ID + ' .pd-tools{display:flex;gap:6px;margin:8px 0 0;flex-wrap:wrap;}',
            '#' + MODAL_ID + ' .pd-b{border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:transparent;color:var(--text-muted,#9aa1ac);',
            '  border-radius:9px;padding:7px 11px;font:600 11.5px/1 var(--font-ui,system-ui);cursor:pointer;flex:none;}',
            '#' + MODAL_ID + ' .pd-b.on{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.14));color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .pd-b.cv{border-color:rgba(224,87,74,0.5);color:#e0574a;}',
            '#' + MODAL_ID + ' .pd-b:disabled{opacity:.5;cursor:default;}',
            '#' + MODAL_ID + ' .pd-note{margin:8px 0 0;font:500 11.5px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .pd-pl{font:500 12px/1.4 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);margin:3px 0;}',
            '#' + MODAL_ID + ' .pd-empty{text-align:center;padding:26px 10px;color:var(--text-muted,#9aa1ac);font:500 13px/1.5 var(--font-ui,system-ui);}',
            '#' + MODAL_ID + ' .pd-fio{border-radius:12px;padding:10px 12px;margin:0 0 10px;font:500 12px/1.45 var(--font-ui,system-ui);',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.1));color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .pd-fio b{color:var(--text-color,#e6e8eb);}',
            '#' + MODAL_ID + ' .pd-fio.bad{border-color:rgba(224,87,74,0.5);}',
            '#' + MODAL_ID + ' .pd-nez{border:1px solid rgba(212,160,44,0.42);background:rgba(212,160,44,0.09);border-radius:12px;padding:10px 12px;margin:0 0 8px;}',
            '#' + MODAL_ID + ' .pd-nez h4{margin:0 0 4px;font:700 13px/1.3 var(--font-ui,system-ui);color:#d4a02c;}',
            '#' + MODAL_ID + ' .pd-nez p{margin:0 0 6px;font:500 12px/1.45 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);word-break:break-word;}',
            '#' + MODAL_ID + ' .pd-nez input{width:130px;text-transform:uppercase;font-family:var(--font-mono,monospace);}',
            '#' + MODAL_ID + ' #ag-pd-q{margin:0 0 8px;}'
        ].join('');
        document.head.appendChild(st);
    }

    // ---- okno --------------------------------------------------------------------------
    function build() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        styly();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = MODAL_ID;
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h2 style="margin-top:0;"><span style="display:inline-block;width:22px;height:22px;vertical-align:-4px;color:var(--accent);">' + ICON + '</span> Lidé a prodej Pro</h2>' +
            '  <div class="modal-body" id="ag-pd-body"></div>' +
            '</div>';
        document.body.appendChild(m);
        return m;
    }
    function open(tab) {
        var m = build();
        if (tab) _tab = tab;
        m.style.display = 'flex';
        m.classList.add('ag-open');
        if (!ownerKey()) { agAlert('Chybí klíč vlastníka', 'Nejdřív se přihlas jako vlastník (Konzole vlastníka → Změnit klíč).'); close(); return; }
        render(true);
        load();
    }
    function close() {
        var m = document.getElementById(MODAL_ID);
        if (!m) return;
        m.style.display = 'none';
        m.classList.remove('ag-open');
        _open = '';
    }
    function load() {
        _busy = true;
        // Žádosti o Pro jdou schránkou zpětné vazby (GET /feedback?stav=open, jen
        // vlastník) — filtruje se kind 'pro'. Starší worker vrátí i ostatní druhy,
        // ty se tu nezobrazují.
        var a = api('/owner/ucty'), b = api('/owner/objednavky'), c = api('/feedback?stav=open');
        Promise.all([a, b, c]).then(function (rr) {
            _busy = false;
            if (!rr[0].ok) { _lide = null; render(); sayFail(rr[0], 'lidé'); return; }
            _lide = rr[0].data || null;
            _obj = rr[1].ok ? (rr[1].data || null) : null;
            _zad = rr[2].ok ? ((rr[2].data || {}).messages || []).filter(function (m) { return m.kind === 'pro'; }) : null;
            render();
        });
    }

    // ---- vykreslení -------------------------------------------------------------------
    function render(loading) {
        var m = document.getElementById(MODAL_ID);
        if (!m) return;
        var b = m.querySelector('#ag-pd-body');
        if (!b) return;
        if (loading || (!_lide && _busy)) { b.innerHTML = '<div class="pd-empty">Načítám…</div>'; return; }
        var h = [];
        h.push('<div class="pd-tabs">' +
            '<button type="button" data-tab="lide"' + (_tab === 'lide' ? ' class="on"' : '') + '>Lidé' + (_lide ? ' (' + (_lide.ucty || []).length + ')' : '') + '</button>' +
            '<button type="button" data-tab="zad"' + (_tab === 'zad' ? ' class="on"' : '') + '>Žádosti' + (_zad && _zad.length ? ' · ' + _zad.length : '') + '</button>' +
            '<button type="button" data-tab="obj"' + (_tab === 'obj' ? ' class="on"' : '') + '>Objednávky' + cekaBadge() + '</button>' +
            '</div>');
        if (!_lide) {
            h.push('<div class="pd-empty">Přehled se nenačetl.</div>');
        } else if (_tab === 'lide') h.push(renderLide());
        else if (_tab === 'zad') h.push(renderZadosti());
        else h.push(renderObj());
        h.push('<button type="button" class="btn btn-secondary" id="pd-again" style="margin-top:14px;">Načíst znovu</button>');
        h.push('<button type="button" class="btn btn-secondary" id="pd-close" style="margin-top:8px;">Zavřít</button>');
        b.innerHTML = h.join('');
        wire(b);
    }
    function cekaBadge() {
        if (!_obj) return '';
        var n = (_obj.objednavky || []).filter(function (o) { return !o.paid_ts && !o.cancelled; }).length;
        var z = (_obj.pohyby || []).length;
        return (n || z) ? ' · ' + (n + z) + ' čeká' : '';
    }
    function tarifText(u) {
        if (u.disabled) return 'zablokován';
        if (u.tarifPlati) return 'Pro' + (u.tarif_do ? ' do ' + datum(u.tarif_do) : ' navždy');
        if (u.tarif === 'pro' && u.tarif_do) return 'Pro vypršelo ' + datum(u.tarif_do);
        return 'Základ';
    }
    function renderLide() {
        var h = [], ucty = _lide.ucty || [];
        var pro = 0, blok = 0, akt = 0;
        ucty.forEach(function (u) { if (u.tarifPlati) pro++; if (u.disabled) blok++; if (u.aktivita && Date.now() - u.aktivita < 7 * 864e5) akt++; });
        h.push('<div class="pd-top">' +
            '<div class="pd-cell"><b>' + ucty.length + '</b><span>účtů</span></div>' +
            '<div class="pd-cell"><b>' + pro + '</b><span>s Pro</span></div>' +
            '<div class="pd-cell"><b>' + akt + '</b><span>aktivních 7 d</span></div>' +
            '<div class="pd-cell' + (blok ? ' warn' : '') + '"><b>' + blok + '</b><span>blokovaných</span></div>' +
            '</div>');
        h.push('<input type="search" id="ag-pd-q" placeholder="Hledat člověka (jméno, kód, prostor)" value="' + esc(_q) + '">');
        var q = bezDia(_q);
        var list = ucty.filter(function (u) {
            if (!q) return true;
            if (bezDia(u.name).indexOf(q) >= 0 || bezDia(u.code).indexOf(q) >= 0) return true;
            return (u.prostory || []).some(function (p) { return bezDia(p.nazev || '').indexOf(q) >= 0 || bezDia(p.kod || '').indexOf(q) >= 0; });
        });
        if (!list.length) h.push('<div class="pd-empty">Nikdo takový tu není.</div>');
        list.forEach(function (u) {
            var firmy = (u.prostory || []).filter(function (p) { return !p.vlastni && !p.archiv; }).map(function (p) { return p.nazev; });
            var dot = u.disabled ? 'blok' : (u.tarifPlati ? 'pro' : (u.objednavky && u.objednavky.ceka ? 'ceka' : ''));
            h.push('<div class="pd-row' + (_open === u.id ? ' on' : '') + '" data-u="' + esc(u.id) + '">' +
                '<span class="pd-dot ' + dot + '"></span>' +
                '<span class="pd-nm"><b>' + esc(u.name || '?') + '</b>' +
                '<small>' + esc(u.code) + ' · ' + esc(firmy.length ? firmy.join(', ') : 'jen vlastní prostor') + '</small></span>' +
                '<span class="pd-cnt">' + esc(tarifText(u)) + '<small>' + esc(den(u.aktivita)) + '</small></span>' +
                '</div>');
            if (_open === u.id) h.push(detailLide(u));
        });
        return h.join('');
    }
    function detailLide(u) {
        var h = ['<div class="pd-det">'];
        h.push('<div class="pd-lab">Účet</div>');
        h.push('<div class="pd-pl">Kód <b>' + esc(u.code) + '</b> · založen ' + datum(u.created) + ' · poslední přihlášení ' + den(u.last_login) +
            ' · za 30 dní ' + (u['akcí30d'] || 0) + ' akcí' + (u.trial_ts ? ' · zkouška zdarma ' + datum(u.trial_ts) : '') + '</div>');
        h.push('<div class="pd-lab">Kde je</div>');
        (u.prostory || []).forEach(function (p) {
            h.push('<div class="pd-pl">' + (p.vlastni ? 'vlastní prostor' : '<b>' + esc(p.nazev || '?') + '</b> (' + esc(p.kod || '') + ')') +
                ' · ' + esc(p.role) + (p.archiv ? ' · odešel' : '') + ' · ' + p.lidi + ' lidí · přihlášen ' + den(p.lastLogin) + '</div>');
        });
        var o = u.objednavky || {};
        if (o.n) h.push('<div class="pd-pl">Objednávky: ' + o.n + ' (zaplaceno ' + o.zaplaceno + ', čeká ' + o.ceka + ')</div>');
        h.push('<div class="pd-lab">Pro</div>');
        h.push('<div class="pd-tools">' +
            '<button type="button" class="pd-b on" data-pro="' + esc(u.id) + '" data-dni="30">+ měsíc</button>' +
            '<button type="button" class="pd-b on" data-pro="' + esc(u.id) + '" data-dni="365">+ rok</button>' +
            '<button type="button" class="pd-b" data-pro="' + esc(u.id) + '" data-dni="0">navždy</button>' +
            (u.tarif === 'pro' ? '<button type="button" class="pd-b cv" data-propryc="' + esc(u.id) + '">Vypnout Pro</button>' : '') +
            '</div>');
        h.push('<div class="pd-lab">Účet</div>');
        h.push('<div class="pd-tools">' +
            (u.disabled
                ? '<button type="button" class="pd-b on" data-blok="' + esc(u.id) + '" data-on="0">Odblokovat</button>'
                : '<button type="button" class="pd-b cv" data-blok="' + esc(u.id) + '" data-on="1">Zablokovat (vyhodit z appky)</button>') +
            '<button type="button" class="pd-b" data-zpravy="' + esc(u.code) + '">Zprávy od lidí</button>' +
            '<button type="button" class="pd-b" data-obj="' + esc(u.code) + '">Objednávky</button>' +
            '</div>');
        h.push('<div class="pd-note">Zablokování nemaže nic — člověk se jen nepřihlásí a na telefonu se do minuty odhlásí. Odblokovat jde kdykoli.</div>');
        h.push('</div>');
        return h.join('');
    }

    // ---- žádosti o Pro ---------------------------------------------------------------
    function metaZ(m) { try { return JSON.parse(m.meta || 'null') || {}; } catch (e) { return {}; } }
    function ucetPodleKodu(kod) {
        var r = null; kod = String(kod || '').toUpperCase();
        if (!kod) return null;
        ((_lide || {}).ucty || []).forEach(function (u) { if (String(u.code || '').toUpperCase() === kod) r = u; });
        return r;
    }
    function renderZadosti() {
        var h = [];
        if (_zad === null) return '<div class="pd-empty">Žádosti se nenačetly (schránka chce OWNER_KEY — viz Stav serveru v Konzoli vlastníka).</div>';
        h.push('<div class="pd-note" style="margin:0 0 10px;">Tohle poslali lidé tlačítkem <b>Požádat o Pro</b> v appce. Zapnutím Pro se žádost sama označí jako vyřízená; člověku se Pro rozsvítí do minuty (s připojením).</div>');
        if (!_zad.length) { h.push('<div class="pd-empty">Žádná nevyřízená žádost.</div>'); return h.join(''); }
        _zad.forEach(function (m) {
            var mt = metaZ(m), u = ucetPodleKodu(mt.ucet);
            var kdo = m.who || 'bez jména';
            if (mt.ucet && kdo.indexOf(mt.ucet) === -1) kdo += ' · účet ' + mt.ucet;
            if (!mt.ucet) kdo += ' · bez účtu';
            var nastroj = mt.nastroj ? (function (k) { try { var r = AGReg.get(k); return (r && r.help && r.help.t) || k; } catch (e) { return k; } })(mt.nastroj) : '';
            h.push('<div class="pd-nez" data-zad="' + esc(m.id) + '">' +
                '<h4>' + esc(kdo) + '</h4>' +
                '<p>' + datum(m.ts) + (m.contact ? ' · <b>' + esc(m.contact) + '</b>' : ' · bez kontaktu') +
                (nastroj ? ' · chtěl: ' + esc(nastroj) : '') + (mt.vydani ? ' · vydání ' + esc(mt.vydani) : '') + '</p>' +
                '<p style="white-space:pre-wrap;">' + esc(m.txt) + '</p>' +
                (u ? ('<p>Účet v seznamu: <b>' + esc(u.name) + '</b> · teď ' + esc(tarifText(u)) + '</p>' +
                      '<div class="pd-tools">' +
                      '<button type="button" class="pd-b on" data-zpro="' + esc(u.id) + '" data-zid="' + esc(m.id) + '" data-dni="0">Zapnout Pro navždy</button>' +
                      '<button type="button" class="pd-b" data-zpro="' + esc(u.id) + '" data-zid="' + esc(m.id) + '" data-dni="365">na rok</button>' +
                      '<button type="button" class="pd-b" data-zpro="' + esc(u.id) + '" data-zid="' + esc(m.id) + '" data-dni="30">na měsíc</button>' +
                      '<button type="button" class="pd-b cv" data-zhotovo="' + esc(m.id) + '">Jen vyřídit (nezapínat)</button>' +
                      '</div>')
                   : ('<p><b>Účet se nenašel</b>' + (mt.ucet ? ' (kód ' + esc(mt.ucet) + ' v seznamu není — člověk ho možná smazal nebo píše ze staršího workeru)' : ' — žádost přišla bez kódu účtu') +
                      '. Zapni Pro ručně v záložce Lidé podle jména, pak žádost vyřiď.</p>' +
                      '<div class="pd-tools"><button type="button" class="pd-b" data-clovek="' + esc(m.who || '') + '">Hledat v Lidech</button>' +
                      '<button type="button" class="pd-b cv" data-zhotovo="' + esc(m.id) + '">Vyřízeno</button></div>')) +
                '</div>');
        });
        return h.join('');
    }
    function zadostPro(id, zid, dni) {
        var u = najdi(id); if (!u) return;
        ask('Zapnout Pro účtu ' + u.name + ' (' + u.code + ') ' + (dni ? 'na ' + dniText(dni) : 'NAVŽDY') + ' a žádost vyřídit?').then(function (ok) {
            if (!ok) return;
            api('/owner/tarif', { method: 'POST', body: { id: id, tarif: 'pro', dni: dni } }).then(function (r) {
                if (!r.ok) { sayFail(r, 'tarif'); return; }
                return api('/feedback/done', { method: 'POST', body: { id: zid, done: true } }).then(function () { load(); });
            });
        });
    }
    function zadostHotovo(zid) {
        api('/feedback/done', { method: 'POST', body: { id: zid, done: true } }).then(function (r) { hotovo(r, 'žádost'); });
    }

    function renderObj() {
        var h = [];
        if (!_obj) return '<div class="pd-empty">Objednávky se nenačetly (starý worker?).</div>';
        var cfg = _obj.prodej || {}, fio = _obj.fio || {};
        var list = _obj.objednavky || [], pohyby = _obj.pohyby || [];
        var ceka = list.filter(function (o) { return !o.paid_ts && !o.cancelled; });
        var zapl = list.filter(function (o) { return !!o.paid_ts; });
        var kc = 0; zapl.forEach(function (o) { kc += o.paid_amount || o.amount || 0; });
        h.push('<div class="pd-top">' +
            '<div class="pd-cell' + (ceka.length ? ' warn' : '') + '"><b>' + ceka.length + '</b><span>čeká</span></div>' +
            '<div class="pd-cell"><b>' + zapl.length + '</b><span>zaplaceno</span></div>' +
            '<div class="pd-cell"><b>' + kc.toLocaleString('cs-CZ') + '</b><span>Kč celkem</span></div>' +
            '<div class="pd-cell' + (pohyby.length ? ' warn' : '') + '"><b>' + pohyby.length + '</b><span>nezařazeno</span></div>' +
            '</div>');
        // stav prodeje + banky
        var fioTxt;
        if (!cfg.zapnuto) fioTxt = '<b>Prodej je vypnutý</b> — na serveru chybí PRODEJ_IBAN (Cloudflare → Workers → ar-geodet-api → Settings → Variables). Lidé zatím vidí jen ceník a klíč.';
        else if (!fio.nastaveno) fioTxt = 'Účet <b>' + esc(cfg.ucet || cfg.iban) + '</b> · ceník ' + cenik(cfg) + '.<br>Automat z banky <b>není zapnutý</b> (chybí FIO_TOKEN) — platby potvrzuješ ručně tlačítkem Zaplaceno.';
        else fioTxt = 'Účet <b>' + esc(cfg.ucet || cfg.iban) + '</b> · ceník ' + cenik(cfg) + '.<br>Automat Fio: naposledy ' + (fio.posledniOk ? den(fio.posledniOk) : 'ještě nikdy') +
            (fio.posledni && fio.posledni.chyba ? ' · <b>chyba:</b> ' + esc(fio.posledni.chyba) : ' · v pořádku');
        h.push('<div class="pd-fio' + (fio.posledni && fio.posledni.chyba ? ' bad' : '') + '">' + fioTxt +
            (fio.nastaveno ? '<div class="pd-tools"><button type="button" class="pd-b" id="pd-fio-now">Kouknout do banky teď</button></div>' : '') + '</div>');

        // nezařazené platby
        pohyby.forEach(function (p) {
            h.push('<div class="pd-nez" data-pohyb="' + esc(p.id) + '">' +
                '<h4>' + (p.stav === 'podplaceno' ? 'Podplaceno' : (p.stav === 'duplicitni' ? 'Platba na už zaplacenou objednávku' : 'Nezařazená platba')) +
                ' · ' + esc(p.castka) + ' ' + esc(p.mena || 'Kč') + '</h4>' +
                '<p>' + datum(p.ts) + ' · od ' + esc(p.nazev || p.protiucet || '?') + (p.vs ? ' · VS ' + esc(p.vs) : '') + (p.msg ? ' · „' + esc(p.msg) + '"' : '') +
                (p.order_vs ? ' · objednávka ' + esc(p.order_vs) : '') + '</p>' +
                '<div class="pd-tools"><input type="text" placeholder="kód účtu" maxlength="8" data-kod="' + esc(p.id) + '">' +
                '<button type="button" class="pd-b on" data-prirad="' + esc(p.id) + '">Přiřadit a zapnout Pro</button></div>' +
                '</div>');
        });

        if (!list.length) h.push('<div class="pd-empty">Zatím žádná objednávka.</div>');
        list.forEach(function (o) {
            var st = o.cancelled ? 'zrušena' : (o.paid_ts ? 'zaplaceno ' + datum(o.paid_ts) + ' (' + (o.paid_by === 'fio' ? 'banka' : 'ručně') + ')' : 'čeká na platbu');
            var dot = o.cancelled ? '' : (o.paid_ts ? 'pro' : 'ceka');
            h.push('<div class="pd-row' + (_open === 'o' + o.vs ? ' on' : '') + '" data-o="' + esc(o.vs) + '">' +
                '<span class="pd-dot ' + dot + '"></span>' +
                '<span class="pd-nm"><b>' + esc(o.jmeno || o.code) + ' · ' + esc(o.amount) + ' Kč / ' + dniText(o.dni) + '</b>' +
                '<small>VS ' + esc(o.vs) + ' · ' + esc(o.code) + ' · ' + datum(o.created) + '</small></span>' +
                '<span class="pd-cnt">' + esc(st) + '</span></div>');
            if (_open === 'o' + o.vs) {
                h.push('<div class="pd-det"><div class="pd-tools">' +
                    (!o.paid_ts && !o.cancelled
                        ? '<button type="button" class="pd-b on" data-zapl="' + esc(o.vs) + '">Zaplaceno → zapnout Pro</button>' +
                          '<button type="button" class="pd-b cv" data-zrus="' + esc(o.vs) + '">Zrušit</button>'
                        : '') +
                    '<button type="button" class="pd-b" data-clovek="' + esc(o.code) + '">Ukázat člověka</button>' +
                    '</div>' + (o.paid_note ? '<div class="pd-note">' + esc(o.paid_note) + '</div>' : '') + '</div>');
            }
        });
        return h.join('');
    }
    function cenik(cfg) {
        return (cfg.produkty || []).map(function (p) { return esc(p.nazev.toLowerCase()) + ' ' + esc(p.cena) + ' Kč'; }).join(', ') +
            (cfg.zkouska && cfg.zkouska.dni ? ', zkouška ' + cfg.zkouska.dni + ' dny' : '');
    }
    function dniText(d) { return d === 0 ? 'navždy' : (d >= 360 ? 'rok' : (d >= 28 && d <= 31 ? 'měsíc' : d + ' dní')); }

    // ---- akce -------------------------------------------------------------------------
    function each(root, sel, ev, fn) {
        Array.prototype.forEach.call(root.querySelectorAll(sel), function (el) { el.addEventListener(ev, function (e) { fn(el, e); }); });
    }
    function wire(b) {
        each(b, '[data-tab]', 'click', function (el) { _tab = el.getAttribute('data-tab'); _open = ''; render(); });
        var q = b.querySelector('#ag-pd-q');
        if (q) {
            q.addEventListener('input', function () {
                _q = q.value; render();
                var nq = b.querySelector('#ag-pd-q'); if (nq) { nq.focus(); try { nq.setSelectionRange(nq.value.length, nq.value.length); } catch (e) { swallow(e, 'sel'); } }
            });
        }
        each(b, '[data-u]', 'click', function (el, ev) {
            if (ev.target && ev.target.closest && ev.target.closest('button,input')) return;
            var id = el.getAttribute('data-u'); _open = (_open === id) ? '' : id; render();
        });
        each(b, '[data-o]', 'click', function (el, ev) {
            if (ev.target && ev.target.closest && ev.target.closest('button,input')) return;
            var id = 'o' + el.getAttribute('data-o'); _open = (_open === id) ? '' : id; render();
        });
        each(b, '[data-pro]', 'click', function (el) { zapniPro(el.getAttribute('data-pro'), parseInt(el.getAttribute('data-dni'), 10) || 0); });
        each(b, '[data-zpro]', 'click', function (el) { zadostPro(el.getAttribute('data-zpro'), parseInt(el.getAttribute('data-zid'), 10), parseInt(el.getAttribute('data-dni'), 10) || 0); });
        each(b, '[data-zhotovo]', 'click', function (el) { zadostHotovo(parseInt(el.getAttribute('data-zhotovo'), 10)); });
        each(b, '[data-propryc]', 'click', function (el) { vypniPro(el.getAttribute('data-propryc')); });
        each(b, '[data-blok]', 'click', function (el) { blokace(el.getAttribute('data-blok'), el.getAttribute('data-on') === '1'); });
        each(b, '[data-zpravy]', 'click', function () {
            if (window.AGZpetna && AGZpetna.inbox) { close(); AGZpetna.inbox(); }
            else agAlert('Schránka není načtená', 'Otevři ji z Konzole vlastníka → Zprávy od lidí.');
        });
        each(b, '[data-obj]', 'click', function (el) { _tab = 'obj'; _q = ''; _open = ''; render(); });
        each(b, '[data-clovek]', 'click', function (el) { _tab = 'lide'; _q = el.getAttribute('data-clovek'); _open = ''; render(); });
        each(b, '[data-zapl]', 'click', function (el) { zaplaceno(parseInt(el.getAttribute('data-zapl'), 10)); });
        each(b, '[data-zrus]', 'click', function (el) { zrusit(parseInt(el.getAttribute('data-zrus'), 10)); });
        each(b, '[data-prirad]', 'click', function (el) {
            var id = el.getAttribute('data-prirad');
            var inp = b.querySelector('[data-kod="' + id + '"]');
            priradit(id, inp ? inp.value : '');
        });
        var fn = b.querySelector('#pd-fio-now'); if (fn) fn.addEventListener('click', fioTed);
        var ag = b.querySelector('#pd-again'); if (ag) ag.addEventListener('click', function () { render(true); load(); });
        var cl = b.querySelector('#pd-close'); if (cl) cl.addEventListener('click', close);
    }
    function najdi(id) { var r = null; ((_lide || {}).ucty || []).forEach(function (u) { if (u.id === id) r = u; }); return r; }
    function hotovo(r, kde) { if (!r.ok) { sayFail(r, kde); return; } load(); }

    function zapniPro(id, dni) {
        var u = najdi(id); if (!u) return;
        ask('Zapnout Pro účtu ' + u.name + ' (' + u.code + ') ' + (dni ? 'na ' + dniText(dni) + ' (připočte se za konec běžícího)' : 'NAVŽDY') + '?').then(function (ok) {
            if (!ok) return;
            api('/owner/tarif', { method: 'POST', body: { id: id, tarif: 'pro', dni: dni } }).then(function (r) { hotovo(r, 'tarif'); });
        });
    }
    function vypniPro(id) {
        var u = najdi(id); if (!u) return;
        ask('Vypnout Pro účtu ' + u.name + '? Zámky se mu do minuty zavřou.').then(function (ok) {
            if (!ok) return;
            api('/owner/tarif', { method: 'POST', body: { id: id, tarif: 'zaklad' } }).then(function (r) { hotovo(r, 'tarif'); });
        });
    }
    function blokace(id, zapnout) {
        var u = najdi(id); if (!u) return;
        ask(zapnout
            ? 'Zablokovat účet ' + u.name + ' (' + u.code + ')? Nepřihlásí se a na telefonu se do minuty odhlásí. Data zůstanou.'
            : 'Odblokovat účet ' + u.name + '?').then(function (ok) {
            if (!ok) return;
            api('/owner/blokace', { method: 'POST', body: { id: id, disabled: zapnout ? 1 : 0 } }).then(function (r) { hotovo(r, 'blokace'); });
        });
    }
    function zaplaceno(vs) {
        var o = null; ((_obj || {}).objednavky || []).forEach(function (x) { if (x.vs === vs) o = x; });
        if (!o) return;
        ask('Označit objednávku ' + vs + ' (' + (o.jmeno || o.code) + ', ' + o.amount + ' Kč) jako zaplacenou a zapnout Pro?').then(function (ok) {
            if (!ok) return;
            api('/owner/objednavky/' + vs + '/zaplaceno', { method: 'POST', body: {} }).then(function (r) { hotovo(r, 'zaplaceno'); });
        });
    }
    function zrusit(vs) {
        ask('Zrušit objednávku ' + vs + '?').then(function (ok) {
            if (!ok) return;
            api('/owner/objednavky/' + vs + '/zrusit', { method: 'POST', body: {} }).then(function (r) { hotovo(r, 'zrušit'); });
        });
    }
    function priradit(id, kod) {
        kod = String(kod || '').trim().toUpperCase();
        if (kod.length !== 8) { agAlert('Kód účtu', 'Napiš osmiznakový kód účtu, kterému platba patří.'); return; }
        ask('Přiřadit platbu účtu ' + kod + ' a zapnout mu Pro podle částky?').then(function (ok) {
            if (!ok) return;
            api('/owner/fio/' + encodeURIComponent(id) + '/priradit', { method: 'POST', body: { code: kod } }).then(function (r) { hotovo(r, 'přiřadit'); });
        });
    }
    function fioTed() {
        api('/owner/fio/zkontrolovat', { method: 'POST', body: {} }).then(function (r) {
            if (!r.ok) { sayFail(r, 'banka'); return; }
            var d = r.data || {};
            agAlert('Banka', d.chyba ? esc(d.chyba) : ('Nových pohybů ' + (d.novych || 0) + ', spárováno ' + (d.sparovano || 0) + ', k ruce ' + (d.nezarazeno || 0) + '.'));
            load();
        });
    }

    window.AGProdej = { open: open, close: close };
})();
