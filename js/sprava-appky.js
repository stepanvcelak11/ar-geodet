// ===== AR Geodet — SPRÁVA APLIKACE: konzole vlastníka (ODPOJITELNÁ vrstva) ======
// Jediné místo, odkud je vidět na CELOU aplikaci: všechny firmy, kolik má která
// lidí, kdy naposledy někdo měřil a kolik z denního limitu serveru spotřebovala.
// Odsud se taky zvedají stropy míst, mrazí firmy, uklízí mrtvé a píše hláška
// všem najednou.
//
// ⚠ TOHLE NENÍ „ADMINISTRACE FIRMY". Role `admin` v js/ucty-admin.js je admin
//   JEDNÉ firmy a vidí jen ji — tak to má zůstat. Konzole je nad tím: ovládá
//   aplikaci jako celek a nesmí se do ní dostat žádný firemní účet.
//
// ⚠ O PŘÍSTUPU ROZHODUJE SERVER, NE SKRYTÍ V UI. Konzole se neváže na firemní
//   token, ale na tajemství OWNER_KEY (hlavička X-Owner-Key) — TOTÉŽ, kterým se
//   otevírá schránka zpětné vazby, takže se pamatuje jediný klíč (agFbKey_v1).
//   Kdo klíč nemá, dostane od serveru 403, i kdyby si tlačítko našel.
//       wrangler secret put OWNER_KEY --name ar-geodet-api
//
// PROČ JEDNA ODPOVĚĎ A JEDNA OBRAZOVKA: firem jsou desítky, ne tisíce. Server
//   pošle v GET /owner/firms úplně všechno (firmy, žádosti, zátěž, hlášku) a
//   konzole nikam nenaviguje — detail firmy se rozbalí na místě v seznamu.
//   Dřívější „přehled" byl rozstrkaný po záložkách a obalený vysvětlováním;
//   tady je na řádku jen to, co se dá přečíst za pochodu.
//
// DRUHÁ, TICHÁ ÚLOHA MODULU: hláška vlastníka všem firmám. Ta chodí každému
//   uživateli v /config a modul ji ukáže v upozorněních (AGNotify) — proto se
//   načítá i těm, kdo klíč nemají. Bez klíče modul jinak nic nedělá.
//
// Vstupy: Nastavení → Údržba → „Správa aplikace" (jen když je klíč uložený);
//   window.agOpenSpravaAppky().
//
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + './js/sprava-appky.js'
// v sw.js. Routy /owner/* ve workeru pak jen zůstanou nepoužité.
// ================================================================================
(function () {
    'use strict';
    if (window.AGSprava) return;

    var LS_KEY = 'agFbKey_v1';        // tentýž klíč jako schránka zpětné vazby
    var LS_SEEN = 'agNoticeSeen_v1';  // razítko naposledy odbyté hlášky
    var STYLE_ID = 'ag-sa-style';
    var MODAL_ID = 'ag-sa-modal';
    var DEAD_DAYS = 90;               // bez aktivity → nabídne se k úklidu

    // Poslední záchrana, kdyby byla vrstva účtů odpojená (shodné s ucty.js).
    var API_FALLBACK = 'https://ar-geodet-api.ar-geodet.workers.dev';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/><path d="M9 11h.01M15 11h.01"/></svg>';

    // stav obrazovky (žije jen po dobu otevřeného okna)
    var _data = null, _open = '', _q = '', _dead = false, _busy = false, _pick = {};

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'sprava-appky:' + kde); } catch (x) { } }
    function esc(s) {
        if (window.AG && AG.esc) return AG.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function agAlert(t, m) {
        try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { swallow(e, 'agAlert'); }
        try { agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e) { swallow(e, 'agAlert2'); }
    }
    function ask(m) {
        try { if (typeof window.agAsk === 'function') return window.agAsk(m); } catch (e) { swallow(e, 'ask'); }
        return Promise.resolve(window.confirm(m));
    }

    // ---- cloud -----------------------------------------------------------------
    function base() {
        try {
            var u = window.AGUcty;
            if (u && typeof u.apiUrl === 'function') return u.apiUrl();
            if (u && u.DEFAULT_API) return u.DEFAULT_API;
        } catch (e) { swallow(e, 'base'); }
        return API_FALLBACK;
    }
    function ownerKey() { try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; } }
    function setOwnerKey(k) {
        try { if (k) localStorage.setItem(LS_KEY, k); else localStorage.removeItem(LS_KEY); } catch (e) { swallow(e, 'setOwnerKey'); }
    }
    // Vlastní fetch (ne AGUcty.cloudFetch) — ten neumí předat X-Owner-Key.
    // Timeout je tu ze stejného důvodu jako u schránky: na „mrtvém, ale
    // otevřeném" spoji visí dotaz jinak minuty a drží rádio ve vysokém příkonu.
    function api(path, opts) {
        opts = opts || {};
        var h = { 'Content-Type': 'application/json', 'X-Owner-Key': ownerKey() };
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var to = null, p;
        try {
            p = fetch(base() + path, {
                method: opts.method || 'GET',
                headers: h,
                body: opts.body != null ? JSON.stringify(opts.body) : undefined,
                signal: ctrl ? ctrl.signal : undefined
            });
            if (ctrl) to = setTimeout(function () { try { ctrl.abort(); } catch (e) { swallow(e, 'abort'); } }, opts.timeoutMs || 15000);
        } catch (e) {
            if (to) clearTimeout(to);
            return Promise.resolve({ ok: false, status: 0, data: null });
        }
        return p.then(function (r) {
            if (to) { clearTimeout(to); to = null; }
            return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
        }).catch(function () {
            if (to) clearTimeout(to);
            return { ok: false, status: 0, data: null };
        });
    }
    // společná hláška pro odmítnutou konzoli (ať se nepíše u každé akce znovu)
    function sayFail(r, kde) {
        if (r.status === 0) return agAlert('Bez signálu', 'Server neodpověděl. Zkus to, až bude síť.');
        // 503 = OWNER_KEY chybí, NEBO je kratší než 24 znaků (cloud/worker.js:263 ho pak
        // bere, jako by tam nebyl). Bez té druhé věty by ten, kdo má krátký klíč uložený,
        // marně přepisoval hodnotu, která podle Cloudflare „nastavená je".
        if (r.status === 503) return agAlert('Konzole není nastavená',
            'Na serveru chybí použitelné tajemství <b>OWNER_KEY</b> — buď není nastavené vůbec, ' +
            'nebo je <b>kratší než 24 znaků</b> a server ho odmítá. Nastavíš ho příkazem:<br><br>' +
            '<code>wrangler secret put OWNER_KEY --name ar-geodet-api</code>');
        if (r.status === 403) return agAlert('Špatný klíč', 'Klíč konzole nesedí. Zadej ho znovu tlačítkem <b>Změnit klíč</b>.');
        agAlert('Nepovedlo se', esc((r.data && r.data.error) || ('Chyba ' + r.status + ' — ' + kde)));
    }

    // ---- drobnosti pro čtení čísel ---------------------------------------------
    function den(ts) {
        if (!ts) return 'nikdy';
        var s = Math.max(0, Date.now() - ts) / 1000;
        if (s < 3600) return Math.round(s / 60) + ' min';
        if (s < 172800) return Math.round(s / 3600) + ' h';
        return Math.round(s / 86400) + ' d';
    }
    function datum(ts) {
        if (!ts) return '—';
        try { return new Date(ts).toLocaleDateString('cs-CZ'); } catch (e) { return '—'; }
    }
    function tis(n) {
        n = n || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
        return String(n);
    }
    function bezDia(s) {
        s = String(s || '').toLowerCase();
        try { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { return s; }
    }

    // ---- styly ------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // pruh čísel nahoře — čtyři buňky, žádné popisné věty
            '#ag-sa-modal .sa-top{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:0 0 12px;}',
            '#ag-sa-modal .sa-cell{background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  border-radius:12px;padding:8px 6px;text-align:center;}',
            '#ag-sa-modal .sa-cell b{display:block;font:800 17px/1.1 var(--font-display,system-ui);color:var(--text-color,#e6e8eb);}',
            '#ag-sa-modal .sa-cell span{display:block;margin-top:3px;font:600 10px/1.2 var(--font-ui,system-ui);',
            '  color:var(--text-muted,#9aa1ac);text-transform:uppercase;letter-spacing:.04em;}',
            '#ag-sa-modal .sa-cell.warn b{color:#d4a02c;}',
            '#ag-sa-modal .sa-cell.bad b{color:#e0574a;}',
            // řádek firmy
            '#ag-sa-modal .sa-row{display:flex;align-items:center;gap:9px;padding:9px 8px;border-radius:11px;cursor:pointer;',
            '  border:1px solid transparent;}',
            '#ag-sa-modal .sa-row:hover{background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '#ag-sa-modal .sa-row.on{background:var(--glass-bg,rgba(255,255,255,0.06));border-color:var(--glass-border,rgba(255,255,255,0.14));}',
            '#ag-sa-modal .sa-dot{width:9px;height:9px;border-radius:50%;flex:none;background:var(--accent,#2f9e74);}',
            '#ag-sa-modal .sa-dot.z1{background:#d4a02c;}#ag-sa-modal .sa-dot.z2{background:#e0574a;}',
            '#ag-sa-modal .sa-dot.old{background:var(--text-muted,#9aa1ac);opacity:.5;}',
            '#ag-sa-modal .sa-nm{flex:1;min-width:0;}',
            '#ag-sa-modal .sa-nm b{display:block;font:700 13.5px/1.25 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);',
            '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#ag-sa-modal .sa-nm small{display:block;margin-top:2px;font:500 11px/1.3 var(--font-mono,monospace);color:var(--text-muted,#9aa1ac);',
            '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#ag-sa-modal .sa-cnt{flex:none;text-align:right;font:700 12.5px/1.25 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '#ag-sa-modal .sa-cnt small{display:block;margin-top:2px;font:500 10.5px/1.2 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#ag-sa-modal .sa-cnt.full{color:#d4a02c;}',
            // rozbalený detail
            '#ag-sa-modal .sa-det{padding:4px 8px 14px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.08));margin-bottom:4px;}',
            '#ag-sa-modal .sa-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:6px 0 11px;}',
            '#ag-sa-modal .sa-grid div{background:var(--glass-bg,rgba(255,255,255,0.04));border-radius:9px;padding:6px 4px;text-align:center;',
            '  font:600 11px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#ag-sa-modal .sa-grid div b{display:block;font:800 14px/1.2 var(--font-display,system-ui);color:var(--text-color,#e6e8eb);}',
            '#ag-sa-modal .sa-lab{font:600 10.5px/1 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);',
            '  text-transform:uppercase;letter-spacing:.05em;margin:10px 0 5px;}',
            '#ag-sa-modal .sa-line{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}',
            '#ag-sa-modal .sa-line input,#ag-sa-modal .sa-line select{flex:1;min-width:70px;margin:0;}',
            '#ag-sa-modal .sa-b{border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:transparent;',
            '  color:var(--text-muted,#9aa1ac);border-radius:9px;padding:7px 11px;font:600 11.5px/1 var(--font-ui,system-ui);cursor:pointer;flex:none;}',
            '#ag-sa-modal .sa-b.on{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.14));color:var(--accent,#2f9e74);}',
            '#ag-sa-modal .sa-b.zl{border-color:rgba(212,160,44,0.5);color:#d4a02c;}',
            '#ag-sa-modal .sa-b.zl.on{background:rgba(212,160,44,0.14);}',
            '#ag-sa-modal .sa-b.cv{border-color:rgba(224,87,74,0.5);color:#e0574a;}',
            '#ag-sa-modal .sa-b.cv.on{background:rgba(224,87,74,0.14);}',
            // žádosti
            '#ag-sa-modal .sa-req{border:1px solid rgba(212,160,44,0.42);background:rgba(212,160,44,0.09);border-radius:12px;',
            '  padding:10px 12px;margin:0 0 8px;}',
            '#ag-sa-modal .sa-req h4{margin:0 0 4px;font:700 13px/1.3 var(--font-ui,system-ui);color:#d4a02c;}',
            '#ag-sa-modal .sa-req p{margin:0 0 8px;font:500 12.5px/1.45 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);',
            '  white-space:pre-wrap;word-break:break-word;}',
            '#ag-sa-modal .sa-req small{color:var(--text-muted,#9aa1ac);font:500 11px/1.4 var(--font-ui,system-ui);}',
            '#ag-sa-modal .sa-hist{opacity:.5;border-color:var(--glass-border,rgba(255,255,255,0.12));background:transparent;}',
            '#ag-sa-modal .sa-hist h4{color:var(--text-muted,#9aa1ac);}',
            // ostatní
            '#ag-sa-modal .sa-empty{text-align:center;padding:26px 10px;color:var(--text-muted,#9aa1ac);',
            '  font:500 13px/1.5 var(--font-ui,system-ui);}',
            '#ag-sa-modal .sa-tools{display:flex;gap:6px;margin:12px 0 0;flex-wrap:wrap;}',
            '#ag-sa-modal .sa-note{margin:10px 0 0;font:500 11.5px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#ag-sa-modal #ag-sa-q{margin:0 0 8px;}'
        ].join('');
        document.head.appendChild(st);
    }

    // ---- okno -------------------------------------------------------------------
    function build() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = MODAL_ID;
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h2 style="margin-top:0;"><span style="display:inline-block;width:22px;height:22px;vertical-align:-4px;color:var(--accent);">' + ICON + '</span> Správa aplikace</h2>' +
            '  <div class="modal-body" id="ag-sa-body"></div>' +
            '</div>';
        document.body.appendChild(m);
        return m;
    }

    function open() {
        var m = build();
        m.style.display = 'flex';
        m.classList.add('ag-open');
        if (!ownerKey()) { promptKey(true); return; }
        render(true);
        load();
    }
    function close() {
        var m = document.getElementById(MODAL_ID);
        if (!m) return;
        m.style.display = 'none';
        m.classList.remove('ag-open');
        _open = ''; _pick = {};
    }

    function promptKey(prvni) {
        var k = window.prompt('Klíč konzole (OWNER_KEY ze serveru):', '');
        if (k == null) { if (prvni) close(); return; }
        setOwnerKey(k.trim());
        if (!k.trim()) { close(); return; }
        render(true);
        load();
    }

    function load() {
        _busy = true;
        api('/owner/firms').then(function (r) {
            _busy = false;
            if (!r.ok) { _data = null; render(); sayFail(r, 'přehled'); return; }
            _data = r.data || null;
            render();
        });
    }

    // ---- vykreslení -------------------------------------------------------------
    function render(loading) {
        var m = document.getElementById(MODAL_ID);
        if (!m) return;
        var b = m.querySelector('#ag-sa-body');
        if (!b) return;

        if (loading || (!_data && _busy)) {
            b.innerHTML = '<div class="sa-empty">Načítám přehled…</div>';
            return;
        }
        if (!_data) {
            b.innerHTML = '<div class="sa-empty">Přehled se nenačetl.</div>' +
                '<button type="button" class="btn" id="sa-again" style="margin-top:12px;">Zkusit znovu</button>' +
                '<button type="button" class="btn btn-secondary" id="sa-key" style="margin-top:8px;">Změnit klíč</button>' +
                '<button type="button" class="btn btn-secondary" id="sa-close" style="margin-top:8px;">Zavřít</button>';
            wire(b);
            return;
        }

        var d = _data, firms = d.firms || [];
        var lidi = 0, dnes = 0;
        firms.forEach(function (f) { lidi += (f.users || 0); dnes += (f.reqToday || 0); });
        // Celkový počet požadavků za dnešek bere GLOBÁLNÍ čítač (`days`), ne součet
        // po firmách — do limitu se počítá i to, co proběhne bez přihlášení
        // (přihlašování, zpětná vazba, počasí, preflighty).
        var dnesAll = 0, dd = d.days || [];
        if (dd.length) dnesAll = dd[dd.length - 1].n || 0;
        var lim = (d.limits && d.limits.reqPerDay) || 100000;
        var pct = Math.round(dnesAll / lim * 100);
        var ceka = (d.requests || []).filter(function (r) { return r.state === 'new'; });

        var h = [];
        // ---- čtyři čísla nahoře
        h.push('<div class="sa-top">');
        h.push('<div class="sa-cell"><b>' + firms.length + '</b><span>firem</span></div>');
        h.push('<div class="sa-cell"><b>' + lidi + '</b><span>lidí</span></div>');
        h.push('<div class="sa-cell' + (pct >= 80 ? ' bad' : (pct >= 50 ? ' warn' : '')) + '"><b>' + pct + '%</b><span>limitu dnes</span></div>');
        h.push('<div class="sa-cell' + (ceka.length ? ' warn' : '') + '"><b>' + ceka.length + '</b><span>žádostí</span></div>');
        h.push('</div>');

        // ---- žádosti o víc míst (nahoře, protože jen na ně se čeká)
        (d.requests || []).forEach(function (r) {
            if (r.state !== 'new') return;
            h.push('<div class="sa-req" data-req="' + esc(r.id) + '">' +
                '<h4>' + esc(r.firmName || '?') + ' chce ' + (r.want || 0) + ' míst</h4>' +
                '<p>' + esc(r.reason || '') + '</p>' +
                '<small>' + esc(r.who || '?') + ' · ' + esc(r.firmCode || '') + ' · teď má ' + (r.maxUsers || 0) + ' · ' + datum(r.ts) + '</small>' +
                '<div class="sa-tools">' +
                '<button type="button" class="sa-b on" data-ok="' + esc(r.id) + '">Povolit ' + (r.want || 0) + '</button>' +
                '<button type="button" class="sa-b" data-jine="' + esc(r.id) + '">Jiný počet</button>' +
                '<button type="button" class="sa-b cv" data-ne="' + esc(r.id) + '">Zamítnout</button>' +
                '</div></div>');
        });

        // ---- hledání + přepínač mrtvých
        h.push('<input type="search" id="ag-sa-q" placeholder="Hledat firmu (název nebo kód)" value="' + esc(_q) + '">');
        var mrtve = firms.filter(function (f) { return jeMrtva(f); });
        if (mrtve.length) {
            h.push('<div class="sa-tools" style="margin:0 0 8px;">' +
                '<button type="button" class="sa-b' + (_dead ? ' on' : '') + '" id="sa-dead">' +
                'Bez aktivity ' + DEAD_DAYS + ' dní: ' + mrtve.length + '</button>' +
                (_dead ? '<button type="button" class="sa-b cv" id="sa-wipe">Smazat vybrané (' + Object.keys(_pick).length + ')</button>' : '') +
                '</div>');
        }

        // ---- seznam firem
        var q = bezDia(_q);
        var list = firms.filter(function (f) {
            if (_dead && !jeMrtva(f)) return false;
            if (!q) return true;
            return bezDia(f.name).indexOf(q) >= 0 || bezDia(f.code).indexOf(q) >= 0;
        });
        if (!list.length) h.push('<div class="sa-empty">Nic tu není.</div>');
        list.forEach(function (f) {
            var plno = (f.users || 0) >= (f.max_users || 10);
            h.push('<div class="sa-row' + (_open === f.id ? ' on' : '') + '" data-f="' + esc(f.id) + '">' +
                (_dead ? '<input type="checkbox" class="sa-ck" data-ck="' + esc(f.id) + '"' + (_pick[f.id] ? ' checked' : '') + '>' : '') +
                '<span class="sa-dot' + (f.frozen >= 2 ? ' z2' : (f.frozen >= 1 ? ' z1' : (jeMrtva(f) ? ' old' : ''))) + '"></span>' +
                '<span class="sa-nm"><b>' + esc(f.name || '?') + (f.pending ? ' ⏳' : '') + '</b>' +
                '<small>' + esc(f.code) + ' · ' + den(f.last) + ' · ' + tis(f.reqToday) + ' dnes</small></span>' +
                '<span class="sa-cnt' + (plno ? ' full' : '') + '">' + (f.users || 0) + '/' + (f.max_users || 10) +
                '<small>' + tis(f.pts) + ' bodů</small></span>' +
                '</div>');
            if (_open === f.id) h.push(detail(f));
        });

        // ---- spodní nástroje
        var n = d.notice;
        var zivy = n && n.txt && (!n.until || n.until > Date.now());
        h.push('<div class="sa-lab" style="margin-top:16px;">Hláška všem firmám</div>');
        h.push('<div class="sa-note">' + (zivy
            ? '„' + esc(n.txt) + '" — do ' + datum(n.until)
            : 'Teď nikde nic nevisí.') + '</div>');
        h.push('<div class="sa-tools">' +
            '<button type="button" class="sa-b' + (zivy ? ' on' : '') + '" id="sa-notice">' + (zivy ? 'Změnit' : 'Napsat') + '</button>' +
            (zivy ? '<button type="button" class="sa-b cv" id="sa-notice-off">Sundat</button>' : '') +
            '</div>');

        // ---- zátěž serveru za dva týdny
        h.push('<div class="sa-lab" style="margin-top:16px;">Zátěž serveru (' + tis(lim) + ' požadavků/den)</div>');
        h.push('<div class="sa-note">' + (dd.length
            ? dd.slice(-7).map(function (x) { return esc(x.day.slice(5)) + ' ' + tis(x.n); }).join(' · ')
            : 'Zatím nic.') + '</div>');

        h.push('<button type="button" class="btn btn-secondary" id="sa-again" style="margin-top:16px;">Načíst znovu</button>');
        h.push('<button type="button" class="btn btn-secondary" id="sa-key" style="margin-top:8px;">Změnit klíč konzole</button>');
        h.push('<button type="button" class="btn btn-secondary" id="sa-close" style="margin-top:8px;">Zavřít</button>');

        b.innerHTML = h.join('');
        wire(b);
    }

    function jeMrtva(f) {
        // „mrtvá" = nikdo v ní dlouho nic nedělal. Bez záznamu užívání se bere
        // datum založení — firma, kterou někdo založil a nechal ležet, je přesně
        // ten případ, kvůli kterému tenhle úklid existuje.
        var t = f.last || f.created || 0;
        return (Date.now() - t) > DEAD_DAYS * 864e5;
    }

    function detail(f) {
        var h = [];
        h.push('<div class="sa-det" data-det="' + esc(f.id) + '">');
        h.push('<div class="sa-grid">' +
            '<div><b>' + tis(f.jobs) + '</b>zakázek</div>' +
            '<div><b>' + tis(f.usage) + '</b>záznamů</div>' +
            '<div><b>' + tis(f.chat) + '</b>zpráv</div>' +
            '<div><b>' + tis(f.req7) + '</b>za 7 dní</div>' +
            '</div>');

        h.push('<div class="sa-lab">Míst ve firmě</div>');
        h.push('<div class="sa-line">' +
            '<input type="number" min="1" max="1000" value="' + (f.max_users || 10) + '" data-max="' + esc(f.id) + '">' +
            '<button type="button" class="sa-b" data-savemax="' + esc(f.id) + '">Uložit</button></div>');

        h.push('<div class="sa-lab">Stav</div>');
        h.push('<div class="sa-line">' +
            '<button type="button" class="sa-b' + (!f.frozen ? ' on' : '') + '" data-fz="' + esc(f.id) + '" data-v="0">Běží</button>' +
            '<button type="button" class="sa-b zl' + (f.frozen === 1 ? ' on' : '') + '" data-fz="' + esc(f.id) + '" data-v="1">Jen čtení</button>' +
            '<button type="button" class="sa-b cv' + (f.frozen >= 2 ? ' on' : '') + '" data-fz="' + esc(f.id) + '" data-v="2">Zamčeno</button>' +
            '</div>');

        h.push('<div class="sa-lab">Poznámka (vidíš jen ty)</div>');
        h.push('<div class="sa-line">' +
            '<input type="text" maxlength="500" placeholder="proč je zmrazená, s kým jsem mluvil…" value="' + esc(f.note || '') + '" data-note="' + esc(f.id) + '">' +
            '<button type="button" class="sa-b" data-savenote="' + esc(f.id) + '">Uložit</button></div>');

        h.push('<div class="sa-note">Založena ' + datum(f.created) + ' · zakladatel <code>' + esc(String(f.founder || '—').slice(0, 8)) + '</code>' +
            (f.off ? ' · ' + f.off + ' zablokovaných účtů' : '') + '</div>');
        h.push('<div class="sa-tools"><button type="button" class="sa-b cv" data-del="' + esc(f.id) + '">Smazat firmu i s daty</button></div>');
        h.push('</div>');
        return h.join('');
    }

    // ---- obsluha ----------------------------------------------------------------
    function wire(b) {
        var q = b.querySelector('#ag-sa-q');
        if (q) {
            q.addEventListener('input', function () {
                _q = q.value || '';
                // Překreslení SEBERE FOKUS z pole (přesun v DOM). Proto se při
                // hledání kreslí jen seznam a fokus se vrací zpátky s kurzorem
                // na konci — jinak by po každém písmenu vypadla klávesnice.
                var pos = q.selectionStart;
                render();
                var q2 = document.querySelector('#ag-sa-q');
                if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) { swallow(e, 'caret'); } }
            });
        }
        each(b, '[data-f]', 'click', function (el, ev) {
            if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-ck') != null) return;
            var id = el.getAttribute('data-f');
            _open = (_open === id) ? '' : id;
            render();
        });
        each(b, '[data-ck]', 'change', function (el) {
            var id = el.getAttribute('data-ck');
            if (el.checked) _pick[id] = 1; else delete _pick[id];
            render();
        });
        each(b, '[data-savemax]', 'click', function (el) {
            var id = el.getAttribute('data-savemax');
            var inp = b.querySelector('[data-max="' + id + '"]');
            patch(id, { maxUsers: parseInt(inp && inp.value, 10) || 10 });
        });
        each(b, '[data-savenote]', 'click', function (el) {
            var id = el.getAttribute('data-savenote');
            var inp = b.querySelector('[data-note="' + id + '"]');
            patch(id, { note: (inp && inp.value) || '' });
        });
        each(b, '[data-fz]', 'click', function (el) {
            patch(el.getAttribute('data-fz'), { frozen: parseInt(el.getAttribute('data-v'), 10) || 0 });
        });
        each(b, '[data-del]', 'click', function (el) { smazat(el.getAttribute('data-del')); });
        each(b, '[data-ok]', 'click', function (el) { resit(el.getAttribute('data-ok'), true, 0); });
        each(b, '[data-ne]', 'click', function (el) { resit(el.getAttribute('data-ne'), false, 0); });
        each(b, '[data-jine]', 'click', function (el) {
            var id = el.getAttribute('data-jine');
            var v = window.prompt('Kolik míst firmě povolit?', '');
            if (v == null) return;
            var n = parseInt(v, 10);
            if (!n || n < 1) return agAlert('Nesedí', 'Zadej počet míst jako číslo.');
            resit(id, true, n);
        });
        one(b, '#sa-dead', function () { _dead = !_dead; _pick = {}; render(); });
        one(b, '#sa-wipe', uklid);
        one(b, '#sa-notice', hlaska);
        one(b, '#sa-notice-off', function () { poslatHlasku('', 7); });
        one(b, '#sa-again', load);
        one(b, '#sa-key', function () { promptKey(false); });
        one(b, '#sa-close', close);
    }
    function each(root, sel, ev, fn) {
        Array.prototype.forEach.call(root.querySelectorAll(sel), function (el) {
            el.addEventListener(ev, function (e) { fn(el, e); });
        });
    }
    function one(root, sel, fn) {
        var el = root.querySelector(sel);
        if (el) el.addEventListener('click', fn);
    }

    // ---- akce -------------------------------------------------------------------
    function patch(id, body) {
        api('/owner/firms/' + encodeURIComponent(id), { method: 'PATCH', body: body }).then(function (r) {
            if (!r.ok) return sayFail(r, 'úprava firmy');
            load();
        });
    }
    function smazat(id) {
        var f = najdi(id);
        if (!f) return;
        var v = window.prompt('Smazat firmu „' + f.name + '" i se VŠEMI jejími daty?\n\nOpiš kód firmy ' + f.code + ':', '');
        if (v == null) return;
        if (String(v).trim().toUpperCase() !== String(f.code).toUpperCase())
            return agAlert('Nesmazáno', 'Kód nesedí — nic se nestalo.');
        api('/owner/firms/' + encodeURIComponent(id) + '?kod=' + encodeURIComponent(f.code), { method: 'DELETE' }).then(function (r) {
            if (!r.ok) return sayFail(r, 'mazání firmy');
            _open = '';
            load();
        });
    }
    function uklid() {
        var ids = Object.keys(_pick);
        if (!ids.length) return agAlert('Nic nevybráno', 'Zaškrtni firmy, které mají zmizet.');
        ask('Smazat ' + ids.length + ' firem i se všemi jejich daty? Tohle nejde vrátit.').then(function (ok) {
            if (!ok) return;
            api('/owner/cleanup', { method: 'POST', body: { ids: ids } }).then(function (r) {
                if (!r.ok) return sayFail(r, 'úklid');
                _pick = {}; _dead = false; _open = '';
                load();
            });
        });
    }
    function resit(id, ano, kolik) {
        api('/owner/requests/' + encodeURIComponent(id), {
            method: 'POST',
            body: { approve: !!ano, maxUsers: kolik || undefined }
        }).then(function (r) {
            if (!r.ok) return sayFail(r, 'žádost');
            load();
        });
    }
    function hlaska() {
        var n = _data && _data.notice;
        var txt = window.prompt('Co se má ukázat všem uživatelům? (prázdné = sundat)', (n && n.txt) || '');
        if (txt == null) return;
        poslatHlasku(String(txt).trim(), 7);
    }
    function poslatHlasku(txt, dni) {
        api('/owner/notice', { method: 'PUT', body: { txt: txt, dni: dni } }).then(function (r) {
            if (!r.ok) return sayFail(r, 'hláška');
            load();
        });
    }
    function najdi(id) {
        var f = null;
        (((_data || {}).firms) || []).forEach(function (x) { if (x.id === id) f = x; });
        return f;
    }

    // ---- hláška vlastníka pro OBYČEJNÉ uživatele --------------------------------
    // Tahle část běží každému, i bez klíče konzole: text chodí s /config a modul
    // ho jen vystrčí do upozornění. Odbytá hláška se pozná podle razítka `ts`,
    // takže se nová ukáže znovu, ale tatáž se už nevrací.
    function noticeTick() {
        if (!window.AGNotify) return;
        var f = null;
        try { f = window.AGUcty && AGUcty.getFirm ? AGUcty.getFirm() : null; } catch (e) { swallow(e, 'noticeTick'); }
        var n = f && f.notice;
        if (!n || !n.txt || (n.until && n.until < Date.now())) { try { AGNotify.clear('ag-notice'); } catch (e) { swallow(e, 'clear'); } return; }
        var seen = 0;
        try { seen = parseInt(localStorage.getItem(LS_SEEN) || '0', 10) || 0; } catch (e) { seen = 0; }
        if (seen >= (n.ts || 0)) { try { AGNotify.clear('ag-notice'); } catch (e) { swallow(e, 'clear2'); } return; }
        try {
            AGNotify.set('ag-notice', {
                text: n.txt, level: 'info', order: -5,
                onDismiss: function () { try { localStorage.setItem(LS_SEEN, String(n.ts || Date.now())); } catch (e) { swallow(e, 'seen'); } }
            });
        } catch (e) { swallow(e, 'set'); }
    }

    // ---- vstup v Nastavení → Údržba ---------------------------------------------
    // Tlačítko se ukáže jen tomu, kdo klíč zadal (ostatním by k ničemu nebylo).
    // O přístupu ale rozhoduje server, ne tohle skrytí.
    function injectSettings() {
        var tab = document.getElementById('tab-udrzba');
        if (!tab) return;
        var has = !!ownerKey();
        var btn = document.getElementById('ag-sa-set-btn');
        if (has && !btn) {
            btn = document.createElement('button');
            btn.id = 'ag-sa-set-btn'; btn.type = 'button'; btn.className = 'btn btn-secondary';
            btn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;vertical-align:-3px;">' + ICON + '</span> Správa aplikace (všechny firmy)';
            btn.addEventListener('click', function () {
                var mm = document.getElementById('settings-modal');
                if (mm) mm.style.display = 'none';
                open();
            });
            var after = document.getElementById('ag-fb-inbox-btn') || document.getElementById('ag-fb-set-btn');
            if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
            else tab.appendChild(btn);
        } else if (!has && btn && btn.parentNode) btn.parentNode.removeChild(btn);
    }

    function init() {
        injectSettings();
        noticeTick();
        (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
            try { injectSettings(); noticeTick(); } catch (e) { swallow(e, 'tick'); }
        }, 5000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.agOpenSpravaAppky = open;
    window.AGSprava = { open: open, close: close, hasKey: function () { return !!ownerKey(); } };
})();
