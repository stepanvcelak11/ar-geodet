// ============================================================================
// AR Geodet — ADMINISTRACE FIRMY: uživatelé, oprávnění, dashboard užívání
// ----------------------------------------------------------------------------
// Nadstavba nad js/ucty.js (jádro účtů) — bez něj se modul tiše vypne.
// Vstup: dlaždice „Firma a účty" v Nástrojích (kategorie Pomůcky).
//   • firemní režim VYPNUT  -> průvodce: založit firmu v CLOUDU (funguje mezi
//     zařízeními, Cloudflare Worker z cloud/worker.js) / připojit zařízení
//     kódem firmy / LOKÁLNÍ režim (jen toto zařízení, bez serveru)
//   • admin                 -> plná administrace (4 sekce); v cloudu se změny
//     (uživatelé, oprávnění, název, auto-zámek) ukládají na server a propíší
//     se všem zařízením; dashboard čte užívání ze VŠECH zařízení
//   • vedení s oprávněním   -> jen Přehled užívání
// Navíc: tlačítko „Přepnout uživatele / zamknout" v menu Více (jen ve firemním
// režimu); v LOKÁLNÍM režimu export/import firmy souborem .argeofirma.json.
//
// Odstranění: smaž js/ucty-admin.js + řádek <script> v index.html (a v sw.js).
// ============================================================================
(function () {
    'use strict';
    if (window.AGUctyAdmin) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    var STYLE_ID = 'ag-uctyadm-style';

    function U() { return window.AGUcty || null; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function agConfirm(opts) {
        try { if (typeof window.agConfirm === 'function') return window.agConfirm(opts); } catch (e) {}
        return Promise.resolve(confirm((opts.title || '') + '\n\n' + String(opts.message || '').replace(/<[^>]*>/g, '')));
    }
    function roleTxt(r) { return r === 'admin' ? 'Admin' : (r === 'vedeni' ? 'Vedení' : 'Zaměstnanec'); }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // navigace: pilulky s ikonami, aktivní zvýrazněná
            // POZOR: nav se MUSÍ zabalovat (wrap). Rolovací řádek schoval na mobilu
            // půlku sekcí za okraj a admin je nenašel — proto mřížka pilulek.
            '#agfa-modal .agfa-nav{display:flex;gap:5px;flex-wrap:wrap;margin:2px 0 10px;}',
            '#agfa-modal .agfa-nav button{display:inline-flex;align-items:center;gap:5px;flex:1 1 auto;justify-content:center;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.13));',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));color:var(--text-muted,#9aa1ac);border-radius:999px;padding:8px 10px;',
            '  font:600 12px/1 var(--font-ui,system-ui);cursor:pointer;white-space:nowrap;transition:color .15s ease,border-color .15s ease,background .15s ease;}',
            '#agfa-modal .agfa-nav button svg{width:13px;height:13px;flex:none;}',
            '#agfa-modal .agfa-nav button.act{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.14));color:var(--accent,#2f9e74);}',
            // řádky seznamů + avatary
            '#agfa-modal .agfa-row{display:flex;align-items:center;gap:10px;padding:10px 6px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.07));}',
            '#agfa-modal .agfa-row:last-child{border-bottom:none;}',
            '#agfa-modal .agfa-row b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}',
            '#agfa-modal .agfa-list{background:var(--glass-bg,rgba(255,255,255,0.03));border:1px solid var(--glass-border,rgba(255,255,255,0.08));border-radius:14px;padding:2px 10px;margin:8px 0;}',
            '#agfa-modal .agfa-av{width:34px;height:34px;border-radius:50%;flex:none;color:#fff;display:flex;align-items:center;justify-content:center;',
            '  font:800 13px/1 var(--font-display,system-ui);box-shadow:inset 0 1px 0 rgba(255,255,255,0.25);}',
            // barevné role (barva + text, ne jen barva)
            '#agfa-modal .agfa-chip{font:600 10.5px/1 var(--font-ui,system-ui);border-radius:999px;padding:4px 9px;background:var(--glass-bg,rgba(255,255,255,0.07));color:var(--text-muted,#9aa1ac);white-space:nowrap;}',
            '#agfa-modal .agfa-chip.c-accent{background:var(--accent-soft,rgba(47,158,116,0.14));color:var(--accent,#2f9e74);}',
            '#agfa-modal .agfa-chip.c-admin{background:rgba(212,160,44,0.13);color:#d4a02c;}',
            '#agfa-modal .agfa-chip.c-vedeni{background:rgba(74,158,218,0.13);color:#4a9eda;}',
            '#agfa-modal .agfa-mini{border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:var(--glass-bg,rgba(255,255,255,0.03));color:var(--text,#e6e8eb);',
            '  border-radius:10px;padding:8px 11px;font:600 12px/1 var(--font-ui,system-ui);cursor:pointer;transition:border-color .15s ease,transform .12s ease;}',
            '#agfa-modal .agfa-mini:active{transform:scale(.96);border-color:var(--accent,#2f9e74);}',
            '#agfa-modal .agfa-mini.danger{color:var(--danger,#e5534b);border-color:rgba(229,83,75,0.4);}',
            '#agfa-modal label.agfa-lb{display:block;font:600 12px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:10px 0 4px;}',
            '#agfa-modal input[type=text],#agfa-modal input[type=password],#agfa-modal input[type=number],#agfa-modal select{width:100%;box-sizing:border-box;',
            '  background:var(--glass-bg,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.16));border-radius:11px;',
            '  color:var(--text,#e6e8eb);padding:11px 12px;font:500 14px/1.2 var(--font-ui,system-ui);outline:none;transition:border-color .15s ease,box-shadow .15s ease;}',
            '#agfa-modal input:focus,#agfa-modal select:focus{border-color:var(--accent,#2f9e74);box-shadow:0 0 0 3px var(--accent-soft,rgba(47,158,116,0.18));}',
            '#agfa-modal .agfa-perm{display:flex;align-items:center;gap:10px;padding:8px 2px;}',
            '#agfa-modal .agfa-perm input{width:19px;height:19px;accent-color:var(--accent,#2f9e74);}',
            // nadpisy sekcí s akcentní linkou
            '#agfa-modal .agfa-pg{display:flex;align-items:center;gap:8px;font:700 11px/1 var(--font-ui,system-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);margin:16px 0 5px;}',
            '#agfa-modal .agfa-pg::before{content:"";width:14px;height:3px;border-radius:2px;background:var(--accent,#2f9e74);}',
            // karty souhrnů
            '#agfa-modal .agfa-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px;margin:10px 0;}',
            '#agfa-modal .agfa-card{background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.09));border-radius:13px;padding:11px 12px;',
            '  border-top:2px solid var(--accent-soft,rgba(47,158,116,0.35));}',
            '#agfa-modal .agfa-card b{display:block;font:800 20px/1.2 var(--font-display,system-ui);color:var(--text,#e6e8eb);}',
            '#agfa-modal .agfa-card span{font:600 10.5px/1.3 var(--font-ui,system-ui);letter-spacing:.02em;color:var(--text-muted,#9aa1ac);}',
            // tabulky: zebra + zaoblený rám
            '#agfa-modal table.agfa-tbl{width:100%;border-collapse:collapse;font:500 12.5px/1.35 var(--font-ui,system-ui);margin:6px 0;}',
            '#agfa-modal table.agfa-tbl th{text-align:left;font:700 10.5px/1 var(--font-ui,system-ui);letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);padding:8px 7px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.14));}',
            '#agfa-modal table.agfa-tbl td{padding:8px 7px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.06));}',
            '#agfa-modal table.agfa-tbl tr:nth-child(even) td{background:var(--glass-bg,rgba(255,255,255,0.025));}',
            '#agfa-modal .agfa-note{font:500 12px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:8px 0;}',
            '#agfa-modal .agfa-filters{display:flex;gap:10px;flex-wrap:wrap;}',
            '#agfa-modal .agfa-filters>div{flex:1;min-width:130px;}',
            // grafy užívání (inline SVG): jedna barva appky, text v textových tónech
            '#agfa-modal .agc-wrap{background:var(--glass-bg,rgba(255,255,255,0.03));border:1px solid var(--glass-border,rgba(255,255,255,0.08));border-radius:13px;padding:10px 12px 6px;margin:8px 0;}',
            '#agfa-modal .agc-bar{fill:var(--accent,#2f9e74);}',
            '#agfa-modal .agc-bar.warn{fill:#d4a02c;}',
            '#agfa-modal .agc-axis{stroke:var(--glass-border,rgba(255,255,255,0.18));stroke-width:1;}',
            '#agfa-modal .agc-x{fill:var(--text-muted,#9aa1ac);font:500 10px var(--font-ui,system-ui);}',
            '#agfa-modal .agc-v{fill:var(--text,#e6e8eb);font:700 10.5px var(--font-ui,system-ui);}',
            '#agfa-modal .agc-nm{fill:var(--text,#e6e8eb);font:600 11px var(--font-ui,system-ui);}',
            // vytížení serveru: vodorovný ukazatel limitu
            '#agfa-modal .agfa-meter{height:10px;border-radius:999px;background:var(--glass-bg,rgba(255,255,255,0.07));overflow:hidden;margin:6px 0 4px;}',
            '#agfa-modal .agfa-meter>i{display:block;height:100%;border-radius:999px;background:var(--accent,#2f9e74);min-width:2px;}',
            '#agfa-modal .agfa-meter>i.warn{background:#d4a02c;}',
            '#agfa-modal .agfa-meter>i.crit{background:var(--danger,#e5534b);}',
            // rozpis docházky
            '#agfa-modal .agfa-shift-day{font:700 12px/1 var(--font-ui,system-ui);color:var(--text,#e6e8eb);margin:12px 0 2px;}',
            // hlavička: kterou firmu právě spravuju (+ přepnutí)
            '#agfa-modal .agfa-firmbar{display:none;}',
            '#agfa-modal .agfa-firmbar.on{display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:10px 12px;border-radius:13px;',
            '  background:var(--accent-soft,rgba(47,158,116,0.1));border:1px solid var(--accent-line,rgba(47,158,116,0.3));}',
            '#agfa-modal .agfa-fb-ico{flex:none;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;',
            '  color:var(--accent,#2f9e74);background:var(--glass-bg,rgba(255,255,255,0.06));}',
            '#agfa-modal .agfa-fb-ico svg{width:16px;height:16px;}',
            '#agfa-modal .agfa-fb-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
            '#agfa-modal .agfa-fb-txt b{font:700 13.5px/1.25 var(--font-ui,system-ui);color:var(--text,#e6e8eb);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#agfa-modal .agfa-fb-txt span{font:500 11px/1.25 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            // řádek uživatele: identita nahoře, akce pod tím zprava (urovnané)
            '#agfa-modal .agfa-urow{padding:11px 6px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.07));}',
            '#agfa-modal .agfa-urow:last-child{border-bottom:none;}',
            '#agfa-modal .agfa-uid{display:flex;align-items:center;gap:10px;}',
            '#agfa-modal .agfa-unm{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
            '#agfa-modal .agfa-unm b{font:700 13.5px/1.25 var(--font-ui,system-ui);color:var(--text,#e6e8eb);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#agfa-modal .agfa-usub{font:500 11px/1.25 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#agfa-modal .agfa-uact{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:9px;}',
            '#agfa-modal .agfa-uact .agfa-mini{flex:1 1 auto;min-width:92px;text-align:center;}',
            '#agfa-modal .agfa-chip.c-block{background:rgba(229,83,75,0.14);color:var(--danger,#e5534b);}',
            '#agfa-modal .agfa-urow.blocked .agfa-av,#agfa-modal .agfa-urow.blocked .agfa-unm b{opacity:.55;}',
            '#agfa-modal .agfa-urow.blocked{background:rgba(229,83,75,0.05);border-radius:10px;}',
            // editor vzhledu avataru (barvy + symboly)
            '#agfa-modal .agfa-ava-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;}',
            '#agfa-modal .agfa-ava-sw{width:38px;height:38px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;}',
            '#agfa-modal .agfa-ava-sw.on{border-color:var(--accent,#2f9e74);box-shadow:0 0 0 3px var(--accent-soft,rgba(47,158,116,0.25));}',
            '#agfa-modal .agfa-ava-em{width:42px;height:42px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.16));',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));color:var(--text,#e6e8eb);font-size:calc(20px * var(--ag-font-scale, 1));line-height:1;cursor:pointer;padding:0;}',
            '#agfa-modal .agfa-ava-em.on{border-color:var(--accent,#2f9e74);box-shadow:0 0 0 3px var(--accent-soft,rgba(47,158,116,0.25));}',
            // pojistka rozložení: obsah modálu je sloupec, tělo se roztahuje a scrolluje
            // (bez toho se v některých prohlížečích obsah hroutil a tlačítka „skákala")
            '#agfa-modal .modal-content{display:flex;flex-direction:column;}',
            '#agfa-modal #agfa-body{min-height:0;}',
            // Přehled (admin centrum): rychlé akce + lidé + chat + server na jedné stránce
            '#agfa-modal .agfa-qa{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:8px;margin:8px 0;}',
            '#agfa-modal .agfa-qa button{display:flex;align-items:center;gap:8px;justify-content:flex-start;border:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));color:var(--text,#e6e8eb);border-radius:12px;padding:11px 12px;',
            '  font:600 12.5px/1.2 var(--font-ui,system-ui);cursor:pointer;transition:border-color .15s ease,transform .12s ease;}',
            '#agfa-modal .agfa-qa button:active{transform:scale(.96);border-color:var(--accent,#2f9e74);}',
            '#agfa-modal .agfa-qa button svg{width:16px;height:16px;flex:none;color:var(--accent,#2f9e74);}',
            '#agfa-modal .agfa-person-sub{font:500 11px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);display:block;}',
            '#agfa-modal .agfa-chatprev{background:var(--glass-bg,rgba(255,255,255,0.03));border:1px solid var(--glass-border,rgba(255,255,255,0.08));',
            '  border-radius:13px;padding:8px 12px;margin:8px 0;}',
            '#agfa-modal .agfa-chatprev .r{display:flex;gap:8px;padding:5px 0;font:500 12.5px/1.4 var(--font-ui,system-ui);color:var(--text,#e6e8eb);border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.06));}',
            '#agfa-modal .agfa-chatprev .r:last-child{border-bottom:none;}',
            '#agfa-modal .agfa-chatprev .w{font-weight:700;flex:none;}',
            '#agfa-modal .agfa-chatprev .m{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted,#9aa1ac);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ------------------------------------------------------------------
    // Kostra modálu (vlastní overlay ve stylu appky, fullscreen dle konvence)
    // ------------------------------------------------------------------
    function ensureModal() {
        var m = document.getElementById('agfa-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'agfa-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Firma a účty</h3>' +
            '  <div class="agfa-firmbar" id="agfa-firmbar"></div>' +
            '  <div class="agfa-nav" id="agfa-nav"></div>' +
            '  <div class="modal-body" id="agfa-body" style="flex:1;overflow-y:auto;"></div>' +
            '  <button class="btn btn-secondary" style="margin-top:12px;" onclick="document.getElementById(\'agfa-modal\').style.display=\'none\'">Zavřít</button>' +
            '</div>';
        document.body.appendChild(m);
        return m;
    }
    function openModal(section) {
        var m = ensureModal();
        m.style.display = 'flex';
        renderNav(section || (U() && U().isAdmin() ? 'prehled' : 'uzivani'));
        limitWarnCheck();
    }

    // varování na čerpání limitu serveru hned při otevření administrace
    // (admin nemusí klikat do sekce Firma); max 1 dotaz za 10 minut
    var _limitTs = 0;
    function limitWarnCheck() {
        var u = U(); if (!u) return;
        var f = u.getFirm();
        if (!f || !f.cloud || !u.isAdmin()) return;
        if (Date.now() - _limitTs < 10 * 60e3) return;
        _limitTs = Date.now();
        u.cloudFetch('/stats').then(function (r) {
            if (!r.ok || !r.data) return;
            var lim = (r.data.limits && r.data.limits.reqPerDay) || 100000;
            var n = 0;
            (r.data.days || []).forEach(function (x) { if (x.day === r.data.today) n = x.n; });
            var pct = n / lim * 100;
            var old = document.getElementById('agfa-limit-warn');
            if (old) old.remove();
            if (pct < 50) return;
            var el = document.createElement('div');
            el.id = 'agfa-limit-warn';
            el.className = 'agfa-note';
            el.style.cssText = 'border:1px solid ' + (pct >= 80 ? 'rgba(229,83,75,0.5)' : 'rgba(212,160,44,0.5)') +
                ';border-radius:11px;padding:9px 12px;margin:0 0 10px;color:' + (pct >= 80 ? 'var(--danger,#e5534b)' : '#d4a02c') + ';';
            el.innerHTML = '⚠ Server dnes čerpá <b>' + Math.round(pct) + ' %</b> denního limitu požadavků (' +
                n.toLocaleString('cs-CZ') + ' ze ' + lim.toLocaleString('cs-CZ') + '). Detail v sekci Firma.';
            var nav = document.getElementById('agfa-nav');
            if (nav && nav.parentNode) nav.parentNode.insertBefore(el, nav);
        });
    }

    // ikonky navigace (čárová grafika ve stylu appky)
    var NAV_ICO = {
        prehled: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
        uzivatele: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>',
        opravneni: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
        uzivani: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
        dochazka: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
        firma: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-4h6v4"/></svg>',
        napoveda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.33c-.8.32-1.4 1-1.4 1.87v.3"/><path d="M12 17h.01"/></svg>',
        chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2.4-2.9A8 8 0 1 1 21 12z"/></svg>'
    };

    // ------------------------------------------------------------------
    // Hlavička: KTERÁ firma je právě spravovaná + rychlé přepnutí. Všechno
    // v administraci (uživatelé, oprávnění, užívání, docházka) patří TÉTO firmě.
    // ------------------------------------------------------------------
    function renderFirmBar() {
        var u = U(); if (!u) return;
        var bar = document.getElementById('agfa-firmbar');
        if (!bar) return;
        var f = u.getFirm();
        if (!f) { bar.innerHTML = ''; bar.className = 'agfa-firmbar'; return; }
        var me = u.currentUser();
        var profs = u.listProfiles ? u.listProfiles() : [];
        var more = profs.length > 1;
        bar.className = 'agfa-firmbar on';
        bar.innerHTML =
            '<span class="agfa-fb-ico">' + (NAV_ICO.firma || '') + '</span>' +
            '<span class="agfa-fb-txt"><b>' + esc(f.firmName || 'Moje firma') + '</b>' +
            '<span>' + (f.cloud ? 'cloud · kód ' + esc(f.code || '?') : 'jen toto zařízení') +
            (me ? ' · ' + esc(me.name) + ' (' + roleTxt(me.role).toLowerCase() + ')' : '') + '</span></span>' +
            (more ? '<button type="button" class="agfa-mini" id="agfa-fb-switch">Přepnout firmu</button>' : '');
        var sw = bar.querySelector('#agfa-fb-switch');
        if (sw) sw.onclick = function () { renderNav('firma'); setTimeout(function () {
            var el = document.getElementById('agfa-firms');
            if (el && el.scrollIntoView) try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
        }, 120); };
    }

    var _section = 'uzivatele';
    function renderNav(sec) {
        _section = sec;
        var u = U(); if (!u) return;
        renderFirmBar();
        var admin = u.isAdmin();
        var nav = document.getElementById('agfa-nav');
        var items = [];
        if (admin) {
            items = [['prehled', 'Přehled'], ['uzivatele', 'Uživatelé'], ['opravneni', 'Oprávnění'], ['uzivani', 'Užívání'], ['dochazka', 'Docházka'], ['firma', 'Firma'], ['napoveda', 'Nápověda']];
        } else {
            items = [['uzivani', 'Užívání'], ['dochazka', 'Docházka'], ['napoveda', 'Nápověda']];
            if (['uzivani', 'dochazka', 'napoveda'].indexOf(_section) === -1) _section = 'uzivani';
        }
        nav.innerHTML = items.map(function (it) {
            return '<button type="button" data-s="' + it[0] + '" class="' + (it[0] === _section ? 'act' : '') + '">' +
                (NAV_ICO[it[0]] || '') + it[1] + '</button>';
        }).join('');
        nav.onclick = function (e) {
            var b = e.target.closest ? e.target.closest('button[data-s]') : null;
            if (b) renderNav(b.getAttribute('data-s'));
        };
        var body = document.getElementById('agfa-body');
        // delegované handlery předchozí sekce zrušit, jinak reagují i v jiné
        // sekci (odtud „tlačítka blbnou": jeden klik dělal dvě věci)
        body.onclick = null;
        body.onchange = null;
        body.removeAttribute('data-permrole');
        if (_section === 'prehled') renderPrehled(body);
        else if (_section === 'uzivatele') renderUsers(body);
        else if (_section === 'opravneni') renderPerms(body);
        else if (_section === 'uzivani') renderUsage(body);
        else if (_section === 'dochazka') renderDochazka(body);
        else if (_section === 'napoveda') renderHelp(body);
        else renderFirm(body);
    }

    // ------------------------------------------------------------------
    // Sekce PŘEHLED (admin centrum): všechno podstatné na jedné stránce —
    // dnešní čísla, vytížení serveru, kdo je v práci a co kdo naposledy
    // dělal, poslední zprávy chatu a rychlé akce. Jen pro admina; zaměstnanci
    // a vedení vidí appku klasicky.
    // ------------------------------------------------------------------
    function qaBtn(id, ico, label) {
        return '<button type="button" data-qa="' + id + '">' + (NAV_ICO[ico] || '') + esc(label) + '</button>';
    }
    function renderPrehled(body) {
        var u = U(), f = u.getFirm(); if (!f) return;
        body.innerHTML = '<div class="agfa-note">Načítám přehled…</div>';
        var from = new Date(); from.setHours(0, 0, 0, 0);
        var getEvents = (f.cloud
            ? u.syncUsage().then(function () {
                return u.cloudFetch('/usage?from=' + from.getTime()).then(function (r) {
                    if (r.ok && r.data && Array.isArray(r.data.events)) return r.data.events;
                    return u.usageQuery(from.getTime());
                });
            })
            : u.usageQuery(from.getTime()));
        getEvents.then(function (evs) {
            // dnešní čísla + stav lidí (poslední aktivita, kdo je v práci)
            var ptAdd = 0, act = {}, lastBy = {}, lastTsBy = {}, inWork = {};
            evs.sort(function (a, b) { return a.ts - b.ts; }).forEach(function (ev) {
                if (ev.t === 'pt-add') ptAdd++;
                if (!ev.u || ev.u === '?') return;
                act[ev.u] = 1;
                lastTsBy[ev.u] = ev.ts;
                var kk = String(ev.k || '').split('|')[0];
                lastBy[ev.u] = ev.t === 'pt-add' ? 'přidal bod'
                    : (ev.t === 'pt-edit' ? 'upravil bod'
                    : (ev.t === 'tool' ? 'nástroj ' + kk.slice(0, 18)
                    : (ev.t === 'shift' ? (kk === 'in' ? 'příchod' : 'odchod')
                    : (ev.t === 'login' ? 'přihlášení' : 'aktivita'))));
                if (ev.t === 'shift') inWork[ev.u] = (kk === 'in');
            });
            var workN = 0;
            Object.keys(inWork).forEach(function (n) { if (inWork[n]) workN++; });

            var html =
                '<div class="agfa-cards">' +
                '  <div class="agfa-card"><b>' + ptAdd + '</b><span>bodů dnes</span></div>' +
                '  <div class="agfa-card"><b>' + Object.keys(act).length + '</b><span>aktivních dnes</span></div>' +
                '  <div class="agfa-card"><b>' + workN + '</b><span>teď v práci</span></div>' +
                '  <div class="agfa-card"><b>' + f.users.length + '</b><span>účtů ve firmě</span></div>' +
                '</div>';

            if (f.cloud) html += '<div class="agfa-pg">Server (Cloudflare)</div><div id="agfa-p-stats" class="agfa-note">Načítám vytížení…</div>';

            html += '<div class="agfa-pg">Rychlé akce</div><div class="agfa-qa">' +
                qaBtn('add-user', 'uzivatele', 'Přidat uživatele') +
                qaBtn('opravneni', 'opravneni', 'Oprávnění') +
                qaBtn('dochazka', 'dochazka', 'Docházka') +
                qaBtn('uzivani', 'uzivani', 'Užívání a grafy') +
                (f.cloud ? qaBtn('chat', 'chat', 'Otevřít chat') : '') +
                qaBtn('firma', 'firma', 'Firma a záloha') +
                '</div>';

            html += '<div class="agfa-pg">Lidé</div><div class="agfa-list">';
            f.users.forEach(function (us) {
                var initials = (us.name || '?').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase();
                var chipCls = us.role === 'admin' ? ' c-admin' : (us.role === 'vedeni' ? ' c-vedeni' : '');
                var sub = lastTsBy[us.name]
                    ? 'naposledy ' + new Date(lastTsBy[us.name]).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) + ' — ' + lastBy[us.name]
                    : 'dnes bez aktivity';
                html += '<div class="agfa-row">' +
                    (u.avatarHtml ? u.avatarHtml(us.name, 'agfa-av')
                        : '<span class="agfa-av" style="' + (u.avatarStyle ? u.avatarStyle(us.name) : '') + '">' + esc(initials) + '</span>') +
                    '<b>' + esc(us.name) + '<span class="agfa-person-sub">' + esc(us.disabled ? 'zablokovaný účet' : sub) + '</span></b>' +
                    (inWork[us.name] && !us.disabled ? '<span class="agfa-chip c-accent">v práci</span>' : '') +
                    (us.disabled ? '<span class="agfa-chip c-block">Zablokován</span>'
                        : '<span class="agfa-chip' + chipCls + '">' + roleTxt(us.role) + '</span>') +
                    '</div>';
            });
            html += '</div>';

            // poslední zprávy chatu — z mezipaměti zařízení, bez dalšího dotazu
            if (f.cloud) {
                var chatMsgs = [];
                try {
                    var cc = JSON.parse(localStorage.getItem('agChatCache_v1') || 'null');
                    if (cc && cc.code === f.code && Array.isArray(cc.msgs)) chatMsgs = cc.msgs.slice(-3);
                } catch (e) {}
                if (chatMsgs.length) {
                    html += '<div class="agfa-pg">Poslední zprávy</div><div class="agfa-chatprev">' +
                        chatMsgs.map(function (msg) {
                            var txt = String(msg.txt || '');
                            if (txt.indexOf('AG1\n') === 0) txt = 'poslal body';
                            return '<div class="r"><span class="w">' + esc(msg.u || '?') + '</span><span class="m">' + esc(txt) + '</span>' +
                                '<span style="color:var(--text-muted);font-size:calc(11px * var(--ag-font-scale, 1));flex:none;">' + new Date(msg.ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) + '</span></div>';
                        }).join('') + '</div>';
                }
            }
            body.innerHTML = html;

            body.onclick = function (e) {
                var b = e.target.closest ? e.target.closest('button[data-qa]') : null;
                if (!b) return;
                var qa = b.getAttribute('data-qa');
                if (qa === 'chat') {
                    document.getElementById('agfa-modal').style.display = 'none';
                    if (window.AGFirmaChat) AGFirmaChat.open();
                    return;
                }
                if (qa === 'add-user') {
                    renderNav('uzivatele');
                    var ab = document.getElementById('agfa-add');
                    if (ab) ab.click();
                    return;
                }
                renderNav(qa);
            };

            // vytížení serveru přímo v přehledu (a jasná hláška, když běží starý kód)
            if (f.cloud) {
                var el = body.querySelector('#agfa-p-stats');
                u.cloudFetch('/stats').then(function (r) {
                    if (!el) return;
                    if (!r.ok || !r.data) {
                        el.innerHTML = r.status === 404
                            ? '<span style="color:#d4a02c;">⚠ Server běží na <b>staré verzi</b> — vytížení, chat i záloha začnou fungovat až po nasazení nového <b>cloud/worker.js</b> (Cloudflare dashboard → ar-geodet-api → Edit code; návod v cloud/README.md).</span>'
                            : 'Vytížení se nepodařilo načíst (' + (r.status === 0 ? 'offline' : 'chyba ' + r.status) + ').';
                        return;
                    }
                    var lim = (r.data.limits && r.data.limits.reqPerDay) || 100000;
                    var n = 0;
                    (r.data.days || []).forEach(function (x) { if (x.day === r.data.today) n = x.n; });
                    var pct = Math.min(100, n / lim * 100);
                    var cls = pct >= 80 ? 'crit' : (pct >= 50 ? 'warn' : '');
                    el.innerHTML = '<b style="color:var(--text,#e6e8eb);">Dnes ' + n.toLocaleString('cs-CZ') + '</b> ze ' + lim.toLocaleString('cs-CZ') +
                        ' požadavků = <b>' + (Math.round(pct * 10) / 10).toLocaleString('cs-CZ') + ' %</b> denního limitu (free plán)' +
                        '<div class="agfa-meter"><i class="' + cls + '" style="width:' + Math.max(1, pct).toFixed(1) + '%"></i></div>' +
                        'Zelená = pohoda, žlutá od 50 %, červená od 80 %. Graf po dnech a počty záznamů jsou v sekci Firma.';
                });
            }
        });
    }

    // ------------------------------------------------------------------
    // Sekce Nápověda — jak celý firemní režim funguje (proti zmatkům)
    // ------------------------------------------------------------------
    function renderHelp(body) {
        var u = U(), f = u.getFirm() || {};
        body.innerHTML =
            '<div class="agfa-pg">Administrace patří jedné firmě</div>' +
            '<div class="agfa-note">Nahoře v zeleném pruhu je vidět, <b>kterou firmu právě spravuješ</b> (a jako kdo). Všechno níž — uživatelé, ' +
            'oprávnění, užívání i docházka — patří jen téhle firmě. Když má zařízení víc firem, přepneš je tlačítkem <b>Přepnout firmu</b> ' +
            'v tom pruhu (nebo v sekci Firma). Přepnutí vždy chce heslo/PIN.</div>' +
            '<div class="agfa-pg">Kdo co vidí</div>' +
            '<div class="agfa-note"><b>Zaměstnanec</b> používá appku klasicky — jen nástroje pro práci v terénu. ' +
            '<b>Vedení</b> vidí navíc firemní přehledy (užívání, docházka). <b>Admin</b> má sekci <b>Přehled</b> — ' +
            'admin centrum, kde je všechno pohromadě (dnešní čísla, kdo je v práci a co naposledy dělal, vytížení serveru, ' +
            'poslední zprávy, rychlé akce) — a nikde ho neomezují oprávnění. Administrace je adminovi po ruce i v menu <b>Více</b>.</div>' +
            '<div class="agfa-pg">Zámek při spuštění</div>' +
            '<div class="agfa-note">Appka po každém spuštění chce přihlášení (naposledy přihlášený je předvybraný, stačí heslo/PIN). ' +
            'Kdo to nechce, vypne v sekci <b>Firma → Zámek appky</b> — pak appka pokračuje pod posledním přihlášeným.</div>' +
            '<div class="agfa-pg">Jak funguje přihlašování</div>' +
            '<div class="agfa-note">Appka se otevře až po přihlášení. Každá firma má <b>kód</b> (např. K7M2PX) — ' +
            'zaměstnanec na svém mobilu zadá kód firmy + své jméno + heslo (účet mu předtím založí admin v sekci Uživatelé). ' +
            'Po prvním přihlášení s internetem funguje přihlášení i <b>offline</b> (heslo se ověří proti otisku uloženému v zařízení). ' +
            'Kdo nemá účet, může appku zkusit v <b>omezeném režimu</b> — jen základní měření bodů, bez nástrojů a exportu.</div>' +
            '<div class="agfa-pg">Role a oprávnění</div>' +
            '<div class="agfa-note"><b>Admin</b> vidí a může vše: spravuje uživatele, oprávnění i firmu a vidí přehled užívání. ' +
            '<b>Vedení</b> a <b>zaměstnanec</b> vidí jen to, co jim admin povolí v sekci Oprávnění (vedení může navíc dostat přehled užívání). ' +
            'Oprávnění platí pro celou firmu na všech zařízeních.</div>' +
            '<div class="agfa-pg">Více firem na jednom zařízení</div>' +
            '<div class="agfa-note">Zařízení si pamatuje každou firmu, ke které ses přihlásil. Mezi firmami se přepíná v sekci ' +
            '<b>Firma → Firmy na tomto zařízení</b>, nebo na přihlašovací obrazovce (odhlas se, firmy se nabídnou). ' +
            'Přepnutí vždy chce heslo/PIN — nikdo si bez ověření nepřepne do cizí firmy. ' +
            '<b>Body a zakázky se s firmou nepřepínají</b> — patří zařízení a zůstávají stejné; přepíná se jen „kdo je přihlášen, co smí a kam se hlásí užívání".</div>' +
            '<div class="agfa-pg">Cloud vs. lokální firma</div>' +
            '<div class="agfa-note"><b>Cloud</b> (doporučeno): firma žije na serveru, stejné účty na všech mobilech, změny oprávnění se propíší všem, ' +
            'užívání se sbírá ze všech zařízení. <b>Lokální</b>: účty žijí jen v jednom zařízení, na další se přenáší souborem v sekci Firma.</div>' +
            '<div class="agfa-pg">Zablokování účtu</div>' +
            '<div class="agfa-note">Když je s někým problém, admin ho v sekci <b>Uživatelé</b> tlačítkem <b>Zablokovat</b> odstřihne od firmy: ' +
            'účet se nepřihlásí a i na mobilu, kde je právě přihlášený, ho server do minuty odhlásí (platí i offline na tom telefonu). ' +
            'Nic se nemaže — docházka, body i záznamy užívání zůstávají a blokaci lze kdykoli zrušit tlačítkem <b>Povolit</b>. ' +
            'Posledního aktivního admina ani sám sebe zablokovat nelze. Trvalé odebrání je <b>Smazat</b>.</div>' +
            '<div class="agfa-pg">Přihlašování podle zařízení</div>' +
            '<div class="agfa-note">Na přihlašovací obrazovce se nabízejí <b>jen účty, které se na tom telefonu už přihlásily</b> — ' +
            'zaměstnanec tedy nevidí dlaždici admina ani vedení. Nový člověk na cizím telefonu použije „Přihlásit jiné jméno" ' +
            '(nebo naskenuje QR od admina).</div>' +
            '<div class="agfa-pg">Zapomenuté heslo</div>' +
            '<div class="agfa-note">Heslo komukoli změní admin v sekci Uživatelé (Upravit → nové heslo) — z libovolného zařízení. ' +
            'Když je nedostupný i admin, na přihlašovací obrazovce je nouzové odpojení zařízení (body a zakázky zůstanou).</div>' +
            '<div class="agfa-pg">Přehled užívání</div>' +
            '<div class="agfa-note">Appka si počítá přihlášení, přidané/upravené body, otevřené nástroje a hrubou stopu aktivity ' +
            '(max 1 záznam za 20 minut — z ní je odhad odpracovaných hodin). V cloudu se záznamy sbíhají ze všech zařízení firmy' +
            (f.cloud ? '' : ' (tady běží lokální režim — jen toto zařízení)') + '. Nic z toho neodchází mimo firmu.</div>' +
            '<div class="agfa-pg">Docházka</div>' +
            '<div class="agfa-note">Každý si značí příchod/odchod dlaždicí <b>Docházka</b> v Nástrojích (Pomůcky) — jedno velké tlačítko, ' +
            'funguje i bez signálu (záznam se odešle, až je internet). U příchodu jde doplnit <b>stavbu a s kým tam je</b>, u odchodu <b>co se dělalo</b> ' +
            '(vše nepovinné; admin to vidí v Rozpisu i ve výkazu). Příchod se váže k <b>aktivní zakázce</b> a ukládá i hrubou polohu píchnutí ' +
            '(v Rozpisu je u času ikona špendlíku — klepnutím se otevře v mapě). ' +
            'Když někdo zapomene odchod, appka mu ho druhý den nabídne doplnit; zpětně ho umí doplnit i admin v Rozpisu. ' +
            'Admin a vedení vidí spárovanou docházku všech, hodiny po zakázkách a umí <b>výkaz do CSV nebo tisk/PDF</b> (podklad pro mzdy). ' +
            'Je to orientační podklad, ne certifikovaný docházkový systém.</div>' +
            '<div class="agfa-pg">Firemní chat</div>' +
            '<div class="agfa-note">Dlaždice <b>Firemní chat</b> v Nástrojích (Pomůcky). Nahoře se vybírá adresát: <b>Všem</b> (vidí celá firma), ' +
            'nebo konkrétní kolega — pak je zpráva <b>soukromá</b> (se zámkem, vidí ji jen on a ty) a chat na to upozorní žlutým pruhem. ' +
            'Všechny zprávy jsou v <b>jednom seznamu</b> (soukromé jen označené zámkem), takže se nic neschová. ' +
            'Tlačítkem se špendlíkem vlevo od psacího pole jde poslat <b>vlastní body</b> — příjemce je jedním klepnutím převezme do svých bodů. ' +
            'Nové zprávy se hlásí tečkou na dlaždici a proužkem po startu. Funguje jen u cloudové firmy a s internetem; server drží posledních ~500 zpráv.</div>' +
            '<div class="agfa-pg">Připojení zařízení QR kódem</div>' +
            '<div class="agfa-note">Admin v sekci Uživatelé klepne u člověka na <b>QR</b>; zaměstnanec na přihlašovací obrazovce dá „Naskenovat QR od admina" ' +
            'a dopíše jen heslo — bez překlepávání kódu firmy. Heslo se v QR nikdy nepřenáší.</div>' +
            '<div class="agfa-pg">Vytížení serveru (admin)</div>' +
            '<div class="agfa-note">V sekci Firma admin vidí, kolik z denního limitu 100 000 požadavků free plánu Cloudflare se čerpá ' +
            'a kolik dat je uloženo. Malá firma limit prakticky nevyčerpá; kdyby ano, ukazatel zežloutne/zčervená.</div>';
    }

    // ------------------------------------------------------------------
    // Průvodce zřízením firmy (když je režim vypnutý): cloud / připojit / lokální
    // ------------------------------------------------------------------
    function openWizard() {
        var m = ensureModal();
        m.style.display = 'flex';
        document.getElementById('agfa-nav').innerHTML = '';
        var body = document.getElementById('agfa-body');
        body.innerHTML =
            '<div class="agfa-note"><b>Zaměstnanec</b> se jen přihlásí kódem firmy, který dostal od svého admina — nic nezakládá. ' +
            'Firmu <b>zakládá a spravuje admin</b> (kdo firmu založí, je jejím adminem: spravuje účty, oprávnění i nastavení).</div>' +
            '<button class="btn" style="width:100%;margin-top:8px;" id="agfa-w-join">Přihlásit se k firmě (mám kód)</button>' +
            '<div class="agfa-pg">Jsem správce firmy</div>' +
            '<button class="btn btn-secondary" style="width:100%;margin-top:4px;" id="agfa-w-cloud">Založit novou firmu v cloudu (více zařízení)</button>' +
            '<button class="btn btn-secondary" style="width:100%;margin-top:8px;" id="agfa-w-local">Založit jen pro toto zařízení (bez cloudu)</button>' +
            '<div class="agfa-note">Cloud = stejné účty na všech mobilech firmy, oprávnění i přehledy se propíší všude (server Cloudflare, zdarma). ' +
            'Lokální = účty žijí jen v tomto telefonu.</div>';
        body.querySelector('#agfa-w-cloud').onclick = function () {
            agConfirm({
                title: 'Založit novou firmu?',
                message: 'Tohle dělá <b>jen správce</b>. Staneš se adminem nové firmy a budeš spravovat účty, oprávnění a nastavení.<br><br>' +
                    'Jsi zaměstnanec a chceš se jen přihlásit? Dej Zrušit a použij „Přihlásit se k firmě (mám kód)".',
                okText: 'Jsem správce, založit'
            }).then(function (ok) { if (ok) wizardCloud(body); });
        };
        body.querySelector('#agfa-w-join').onclick = function () { wizardJoin(body); };
        body.querySelector('#agfa-w-local').onclick = function () {
            agConfirm({
                title: 'Založit lokální firmu?',
                message: 'Účty budou jen v tomto telefonu a staneš se jejich adminem. Pro firmu na více mobilů zvol cloud.',
                okText: 'Jsem správce, založit'
            }).then(function (ok) { if (ok) wizardLocal(body); });
        };
    }

    // ---- cloud: založení firmy na serveru -----------------------------
    function wizardCloud(body) {
        var u = U();
        body.innerHTML =
            '<div class="agfa-note">Založí firmu na serveru (Cloudflare, zdarma, bez karty). Dostaneš <b>kód firmy</b> — ' +
            'tím se pak přihlásí zaměstnanci na svých mobilech. Potřebuje internet.</div>' +
            '<label class="agfa-lb">Název firmy</label><input type="text" id="agfa-w-firm" placeholder="Geodetika s.r.o." maxlength="60">' +
            '<label class="agfa-lb">Tvoje jméno (admin)</label><input type="text" id="agfa-w-name" placeholder="Jan Novák" maxlength="40">' +
            '<label class="agfa-lb">Heslo admina (min. 4 znaky)</label><input type="password" id="agfa-w-pin" maxlength="64" placeholder="••••">' +
            '<label class="agfa-lb">Heslo znovu</label><input type="password" id="agfa-w-pin2" maxlength="64" placeholder="••••">' +
            '<button class="btn" style="margin-top:14px;width:100%;" id="agfa-w-go">Založit firmu</button>' +
            '<button class="btn btn-secondary" style="margin-top:8px;width:100%;" id="agfa-w-back">Zpět</button>';
        var prevName = '';
        try { prevName = localStorage.getItem('arSurveyor') || ''; } catch (e) {}
        if (prevName) body.querySelector('#agfa-w-name').value = prevName;
        body.querySelector('#agfa-w-back').onclick = function () { openWizard(); };
        body.querySelector('#agfa-w-go').onclick = function () {
            var firm = (body.querySelector('#agfa-w-firm').value || '').trim();
            var name = (body.querySelector('#agfa-w-name').value || '').trim();
            var p1 = body.querySelector('#agfa-w-pin').value || '';
            var p2 = body.querySelector('#agfa-w-pin2').value || '';
            if (!name) { agAlert('Chybí jméno', 'Zadej jméno administrátora.'); return; }
            if (p1.length < 4) { agAlert('Slabé heslo', 'Heslo musí mít aspoň 4 znaky.'); return; }
            if (p1 !== p2) { agAlert('Heslo nesouhlasí', 'Zadaná hesla se liší.'); return; }
            this.disabled = true; this.textContent = 'Zakládám…';
            var btn = this;
            u.cloudFetch('/firms', { method: 'POST', api: u.DEFAULT_API, body: { firmName: firm || 'Moje firma', adminName: name, password: p1 } })
                .then(function (r) {
                    btn.disabled = false; btn.textContent = 'Založit firmu';
                    if (!r.ok) {
                        agAlert('Založení selhalo', r.status === 0
                            ? 'Server není dosažitelný — zkontroluj internet.'
                            : esc((r.data && r.data.error) || ('Chyba ' + r.status)));
                        return;
                    }
                    u.adoptLogin(r.data, u.DEFAULT_API);
                    u.usageLog('login', 'setup');
                    wizardShowCode(body);
                });
        };
    }

    // po založení: velký kód firmy + poučení
    function wizardShowCode(body) {
        var u = U(), f = u.getFirm();
        body.innerHTML =
            '<div class="agfa-note">Firma <b>' + esc(f.firmName) + '</b> je založená a ty jsi přihlášený jako admin. ' +
            'Tohle je <b>kód firmy</b> — dej ho zaměstnancům:</div>' +
            '<div style="font:800 38px/1.2 var(--font-display,system-ui);letter-spacing:.18em;text-align:center;color:var(--accent,#2f9e74);margin:14px 0;user-select:all;">' + esc(f.code) + '</div>' +
            '<div class="agfa-note">Zaměstnanec na svém mobilu otevře Nástroje → <b>Firma a účty</b> → „Připojit toto zařízení k firmě" ' +
            'a zadá tento kód + své jméno a heslo (účet mu nejdřív založ v sekci Uživatelé).</div>' +
            '<button class="btn" style="margin-top:12px;width:100%;" id="agfa-w-next">Pokračovat do administrace</button>';
        body.querySelector('#agfa-w-next').onclick = function () { renderNav('uzivatele'); };
    }

    // ---- cloud: připojení zařízení kódem firmy -------------------------
    function wizardJoin(body) {
        var u = U();
        body.innerHTML =
            '<div class="agfa-note">Připojí tento mobil k existující firmě. Kód firmy ti dá admin; jméno a heslo ' +
            'máš od něj taky (admin ti účet založil v administraci). Potřebuje internet.</div>' +
            '<label class="agfa-lb">Kód firmy</label><input type="text" id="agfa-j-code" maxlength="6" placeholder="K7M2PX" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.15em;">' +
            '<label class="agfa-lb">Tvoje jméno</label><input type="text" id="agfa-j-name" maxlength="40" placeholder="Jan Novák">' +
            '<label class="agfa-lb">Heslo</label><input type="password" id="agfa-j-pass" maxlength="64" placeholder="••••">' +
            '<button class="btn" style="margin-top:14px;width:100%;" id="agfa-j-go">Připojit a přihlásit</button>' +
            '<button class="btn btn-secondary" style="margin-top:8px;width:100%;" id="agfa-j-back">Zpět</button>';
        body.querySelector('#agfa-j-back').onclick = function () { openWizard(); };
        body.querySelector('#agfa-j-go').onclick = function () {
            var code = (body.querySelector('#agfa-j-code').value || '').trim().toUpperCase();
            var name = (body.querySelector('#agfa-j-name').value || '').trim();
            var pass = body.querySelector('#agfa-j-pass').value || '';
            if (!code || !name || !pass) { agAlert('Chybí údaje', 'Vyplň kód firmy, jméno i heslo.'); return; }
            this.disabled = true; this.textContent = 'Připojuji…';
            var btn = this;
            u.cloudFetch('/login', { method: 'POST', api: u.DEFAULT_API, body: { code: code, name: name, password: pass } })
                .then(function (r) {
                    btn.disabled = false; btn.textContent = 'Připojit a přihlásit';
                    if (!r.ok) {
                        agAlert('Připojení selhalo', r.status === 0
                            ? 'Server není dosažitelný — zkontroluj internet.'
                            : esc((r.data && r.data.error) || ('Chyba ' + r.status)));
                        return;
                    }
                    u.adoptLogin(r.data, u.DEFAULT_API);
                    u.usageLog('login', 'join');
                    document.getElementById('agfa-modal').style.display = 'none';
                    agAlert('Zařízení připojeno', 'Jsi přihlášen jako <b>' + esc(r.data.user.name) + '</b> (' + roleTxt(r.data.user.role) + ') ve firmě <b>' + esc(r.data.config.firm.name) + '</b>.');
                });
        };
    }

    // ---- lokální režim (bez serveru) — původní průvodce -----------------
    function wizardLocal(body) {
        body.innerHTML =
            '<div class="agfa-note">Účty budou žít <b>jen v tomto zařízení</b> — žádný server. Na další mobily je přeneseš ' +
            'souborem v sekci Firma. Není to tvrdá bezpečnost, ale pořádek: kdo co měří, kdo co vidí.</div>' +
            '<label class="agfa-lb">Název firmy</label><input type="text" id="agfa-w-firm" placeholder="Geodetika s.r.o." maxlength="60">' +
            '<label class="agfa-lb">Tvoje jméno (admin)</label><input type="text" id="agfa-w-name" placeholder="Jan Novák" maxlength="40">' +
            '<label class="agfa-lb">PIN admina (4–8 číslic)</label><input type="password" id="agfa-w-pin" inputmode="numeric" maxlength="8" placeholder="••••">' +
            '<label class="agfa-lb">PIN znovu</label><input type="password" id="agfa-w-pin2" inputmode="numeric" maxlength="8" placeholder="••••">' +
            '<button class="btn" style="margin-top:14px;width:100%;" id="agfa-w-go">Zapnout firemní režim</button>' +
            '<button class="btn btn-secondary" style="margin-top:8px;width:100%;" id="agfa-w-back">Zpět</button>';
        var prevName = '';
        try { prevName = localStorage.getItem('arSurveyor') || ''; } catch (e) {}
        if (prevName) body.querySelector('#agfa-w-name').value = prevName;
        body.querySelector('#agfa-w-back').onclick = function () { openWizard(); };
        body.querySelector('#agfa-w-go').onclick = function () {
            var u = U(); if (!u) return;
            var firm = (body.querySelector('#agfa-w-firm').value || '').trim();
            var name = (body.querySelector('#agfa-w-name').value || '').trim();
            var pin = body.querySelector('#agfa-w-pin').value || '';
            var pin2 = body.querySelector('#agfa-w-pin2').value || '';
            if (!name) { agAlert('Chybí jméno', 'Zadej jméno administrátora.'); return; }
            if (!/^\d{4,8}$/.test(pin)) { agAlert('Neplatný PIN', 'PIN musí mít 4–8 číslic.'); return; }
            if (pin !== pin2) { agAlert('PIN nesouhlasí', 'Zadané PINy se liší.'); return; }
            var salt = u.makeSalt();
            u.hashPin(pin, salt).then(function (h) {
                var f = {
                    enabled: true,
                    firmName: firm || 'Moje firma',
                    createdTs: Date.now(),
                    autoLockMin: 0,
                    users: [{ id: 'u' + Date.now(), name: name, role: 'admin', salt: salt, pinHash: h, noPin: false }],
                    perms: u.defaultPerms()
                };
                u.saveFirm(f);
                try { localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: f.users[0].id, ts: Date.now() })); } catch (e) {}
                try { localStorage.setItem('arSurveyor', name); } catch (e) {}
                u.usageLog('login', 'setup');
                agAlert('Firemní režim zapnut', 'Jsi přihlášen jako admin <b>' + esc(name) + '</b>. Teď přidej uživatele a nastav oprávnění.');
                renderNav('uzivatele');
            });
        };
    }

    // ------------------------------------------------------------------
    // Sekce Uživatelé (cloud: CRUD na serveru, propíše se všem zařízením)
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // Vzhled avataru: barva + symbol místo písmen. Ukládá se per zařízení
    // (AGUcty.avatarSet) — cloudová firma o vzhledu nic neví, je to vizuální věc.
    // ------------------------------------------------------------------
    var AVA_HUES = [8, 32, 52, 95, 150, 175, 205, 235, 268, 300, 330, null];   // null = automaticky ze jména
    var AVA_EMOJI = ['', '👷', '🙂', '😎', '🦺', '🧭', '📐', '📏', '🛰️', '⛰️', '🌲', '🏗️', '🚜', '📡', '🎯', '⭐', '🦅', '🐺'];
    function avatarForm(body, us) {
        var u = U(); if (!u || !u.avatarSet) return;
        var box = body.querySelector('#agfa-uform'); if (!box) return;
        var cur = (u.avatarGet && u.avatarGet(us.name)) || {};
        var selH = (cur.h != null) ? cur.h : null;
        var selE = cur.e || '';
        function swatches() {
            return AVA_HUES.map(function (h) {
                var bg = (h == null) ? 'conic-gradient(hsl(0,44%,48%),hsl(120,44%,48%),hsl(240,44%,48%),hsl(0,44%,48%))'
                    : 'linear-gradient(150deg,hsl(' + h + ',44%,48%),hsl(' + h + ',48%,33%))';
                var on = (h === selH) || (h == null && selH == null);
                return '<button type="button" class="agfa-ava-sw' + (on ? ' on' : '') + '" data-h="' + (h == null ? '' : h) + '"'
                    + ' style="background:' + bg + ';" title="' + (h == null ? 'Automaticky ze jména' : 'Odstín ' + h + '°') + '"></button>';
            }).join('');
        }
        function emojis() {
            return AVA_EMOJI.map(function (e) {
                var on = (e === selE);
                return '<button type="button" class="agfa-ava-em' + (on ? ' on' : '') + '" data-e="' + e + '">' + (e || 'AB') + '</button>';
            }).join('');
        }
        function render() {
            box.innerHTML =
                '<div class="agfa-pg" style="margin-top:14px;">Vzhled avataru — ' + esc(us.name) + '</div>' +
                '<div style="display:flex;align-items:center;gap:12px;margin:8px 0 12px;">' +
                '  <span id="agfa-ava-prev"></span>' +
                '  <span style="font-size:calc(12px * var(--ag-font-scale, 1));opacity:.75;">Takhle bude účet vypadat na přihlašovací obrazovce, v administraci i v chatu. Uloženo na tomto zařízení.</span>' +
                '</div>' +
                '<label class="agfa-lb">Barva</label><div class="agfa-ava-row">' + swatches() + '</div>' +
                '<label class="agfa-lb" style="margin-top:10px;">Symbol (místo písmen)</label><div class="agfa-ava-row">' + emojis() + '</div>' +
                '<div style="display:flex;gap:8px;margin-top:14px;">' +
                '  <button class="btn" style="flex:1;" id="agfa-ava-save">Uložit vzhled</button>' +
                '  <button class="btn btn-secondary" style="flex:1;" id="agfa-ava-cancel">Zrušit</button>' +
                '</div>';
            preview();
            box.querySelectorAll('.agfa-ava-sw').forEach(function (b) {
                b.onclick = function () { var v = b.getAttribute('data-h'); selH = (v === '') ? null : +v; render(); };
            });
            box.querySelectorAll('.agfa-ava-em').forEach(function (b) {
                b.onclick = function () { selE = b.getAttribute('data-e') || ''; render(); };
            });
            box.querySelector('#agfa-ava-cancel').onclick = function () { box.innerHTML = ''; };
            box.querySelector('#agfa-ava-save').onclick = function () {
                u.avatarSet(us.name, { h: selH, e: selE });
                box.innerHTML = '';
                renderUsers(body, true);
            };
            try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
        }
        function preview() {
            var pv = box.querySelector('#agfa-ava-prev'); if (!pv) return;
            var hue = (selH != null) ? selH : null;
            // náhled počítáme lokálně (avatarGet by vrátil starý uložený stav)
            var initials = (us.name || '?').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase();
            var h = (hue != null) ? hue : (function (s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x; })(String(us.name || ''));
            pv.innerHTML = '<span class="agfa-av" style="width:52px;height:52px;font-size:' + (selE ? '26px' : '19px') + ';background:linear-gradient(150deg,hsl(' + h + ',44%,48%),hsl(' + h + ',48%,33%));">' + (selE || esc(initials)) + '</span>';
        }
        render();
    }

    function renderUsers(body, refreshed) {
        var u = U(), f = u.getFirm(); if (!f) return;
        var me = u.currentUser();
        var cloud = !!f.cloud;
        // v cloudu si jednou stáhni čerstvý seznam (mohl se změnit jinde)
        if (cloud && !refreshed) {
            u.refreshConfig().then(function (ok) { if (ok && _section === 'uzivatele') renderUsers(body, true); });
        }
        // řádek = 2 pásma: identita (avatar + jméno + role) a pod ní akce zprava.
        // Dřív bylo všechno v jedné řádce a na mobilu se to lámalo přes sebe.
        var rows = f.users.map(function (us) {
            var initials = (us.name || '?').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase();
            var chipCls = us.role === 'admin' ? ' c-admin' : (us.role === 'vedeni' ? ' c-vedeni' : '');
            var blocked = !!us.disabled;
            return '<div class="agfa-urow' + (blocked ? ' blocked' : '') + '" data-id="' + esc(us.id) + '">' +
                '<div class="agfa-uid">' +
                (u.avatarHtml ? u.avatarHtml(us.name, 'agfa-av')
                    : '  <span class="agfa-av" style="' + (u.avatarStyle ? u.avatarStyle(us.name) : '') + '">' + esc(initials) + '</span>') +
                '  <span class="agfa-unm"><b>' + esc(us.name) + '</b>' +
                '    <span class="agfa-usub">' + roleTxt(us.role) + (!cloud && us.noPin ? ' · bez PINu' : '') +
                (me && me.id === us.id ? ' · to jsi ty' : '') +
                (blocked ? ' · nemůže se přihlásit' : '') + '</span></span>' +
                (blocked ? '<span class="agfa-chip c-block">Zablokován</span>'
                    : '<span class="agfa-chip' + chipCls + '">' + roleTxt(us.role) + '</span>') +
                '</div>' +
                '<div class="agfa-uact">' +
                (cloud && !blocked ? '<button class="agfa-mini" data-act="qr">QR pro mobil</button>' : '') +
                '<button class="agfa-mini" data-act="avatar">Vzhled</button>' +
                '<button class="agfa-mini" data-act="edit">Upravit</button>' +
                (blocked
                    ? '<button class="agfa-mini" data-act="unblock">Povolit</button>'
                    : '<button class="agfa-mini danger" data-act="block">Zablokovat</button>') +
                '<button class="agfa-mini danger" data-act="del">Smazat</button>' +
                '</div></div>';
        }).join('');
        body.innerHTML =
            '<div class="agfa-pg">Účty firmy ' + esc(f.firmName || '') + '</div>' +
            (cloud ? '<div class="agfa-note">Účty platí pro celou tuto firmu — nový zaměstnanec se na svém mobilu přihlásí kódem <b>' + esc(f.code || '') + '</b>, svým jménem a heslem (nebo naskenuje QR níže).</div>' : '') +
            '<div id="agfa-userlist" class="agfa-list">' + rows + '</div>' +
            '<button class="btn" style="margin-top:12px;width:100%;" id="agfa-add">+ Přidat uživatele</button>' +
            '<div id="agfa-uform"></div>';
        body.querySelector('#agfa-add').onclick = function () { userForm(body, null); };
        body.querySelector('#agfa-userlist').onclick = function (e) {
            var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
            if (!btn) return;
            var id = btn.closest('.agfa-urow').getAttribute('data-id');
            var us = null;
            for (var i = 0; i < f.users.length; i++) if (f.users[i].id === id) us = f.users[i];
            if (!us) return;
            var act = btn.getAttribute('data-act');
            if (act === 'qr') { showUserQR(body, us, f, u); return; }
            if (act === 'avatar') { avatarForm(body, us); return; }
            if (act === 'edit') { userForm(body, us); return; }
            if (act === 'block' || act === 'unblock') { blockUser(body, us, act === 'block'); return; }
            // smazání: nesmí zmizet poslední admin (server to hlídá taky)
            var admins = f.users.filter(function (x) { return x.role === 'admin'; });
            if (us.role === 'admin' && admins.length <= 1) {
                agAlert('Nelze smazat', 'Toto je poslední admin. Nejdřív udělej adminem někoho jiného, nebo vypni firemní režim v sekci Firma.');
                return;
            }
            agConfirm({ title: 'Smazat uživatele', message: 'Opravdu smazat účet <b>' + esc(us.name) + '</b>? Jeho záznamy v žurnálu a přehledu užívání zůstanou.', okText: 'Smazat', danger: true }).then(function (ok) {
                if (!ok) return;
                if (cloud) {
                    u.cloudFetch('/users/' + encodeURIComponent(us.id), { method: 'DELETE' }).then(function (r) {
                        if (!r.ok) { agAlert('Smazání selhalo', cloudErr(r)); return; }
                        u.adoptConfig(r.data);
                        if (me && me.id === us.id) { u.logout(); document.getElementById('agfa-modal').style.display = 'none'; return; }
                        renderUsers(body, true);
                    });
                    return;
                }
                f.users = f.users.filter(function (x) { return x.id !== us.id; });
                u.saveFirm(f);
                if (me && me.id === us.id) { u.logout(); document.getElementById('agfa-modal').style.display = 'none'; return; }
                renderUsers(body);
            });
        };
    }
    function cloudErr(r) {
        if (r.status === 0) return 'Server není dosažitelný — správa firmy potřebuje internet.';
        return esc((r.data && r.data.error) || ('Chyba ' + r.status));
    }
    // ------------------------------------------------------------------
    // Zablokování / povolení účtu (admin). Blokace je šetrná alternativa
    // smazání: účet, jeho docházka i záznamy zůstanou, ale nejde se přihlásit
    // (server odmítne token okamžitě — i na mobilu, kde je zrovna přihlášený).
    // ------------------------------------------------------------------
    function blockUser(body, us, block) {
        var u = U(), f = u.getFirm(); if (!f) return;
        var me = u.currentUser();
        if (block && me && me.id === us.id) {
            agAlert('Sebe zablokovat nelze', 'Zablokoval bys sám sebe a přišel o přístup do administrace.');
            return;
        }
        if (block && us.role === 'admin') {
            var admins = f.users.filter(function (x) { return x.role === 'admin' && !x.disabled; });
            if (admins.length <= 1) {
                agAlert('Nelze zablokovat', 'Toto je poslední aktivní admin. Nejdřív udělej adminem někoho jiného.');
                return;
            }
        }
        var msg = block
            ? 'Účet <b>' + esc(us.name) + '</b> se nebude moct přihlásit — ani na mobilu, kde je právě přihlášený (odhlásí se do minuty). ' +
              'Body, docházka ani záznamy užívání se nemažou a blokaci lze kdykoli zrušit.'
            : 'Účet <b>' + esc(us.name) + '</b> se bude moct znovu přihlásit stejným heslem.';
        agConfirm({ title: block ? 'Zablokovat účet' : 'Povolit účet', message: msg, okText: block ? 'Zablokovat' : 'Povolit', danger: block }).then(function (ok) {
            if (!ok) return;
            if (f.cloud) {
                u.cloudFetch('/users/' + encodeURIComponent(us.id), { method: 'PATCH', body: { disabled: !!block } }).then(function (r) {
                    if (!r.ok) { agAlert(block ? 'Zablokování selhalo' : 'Povolení selhalo', cloudErr(r)); return; }
                    u.adoptConfig(r.data);
                    renderUsers(body, true);
                });
                return;
            }
            us.disabled = !!block;      // lokální firma: stačí příznak v konfiguraci
            u.saveFirm(f);
            renderUsers(body);
        });
    }

    // QR pro připojení zaměstnance: kód firmy + jméno (+ adresa API). Heslo se
    // NEpřenáší — to zaměstnanec na svém mobilu dopíše sám.
    function showUserQR(body, us, f, u) {
        var box = body.querySelector('#agfa-uform');
        box.innerHTML =
            '<div style="border:1px solid var(--glass-border,rgba(255,255,255,0.15));border-radius:12px;padding:14px;margin-top:12px;text-align:center;">' +
            '<div class="agfa-note" style="margin-top:0;">Zaměstnanec <b>' + esc(us.name) + '</b> na svém mobilu klepne na přihlašovací obrazovce na ' +
            '„Naskenovat QR od admina", namíří sem a dopíše už jen své heslo.</div>' +
            '<div id="agfa-uqr" style="min-height:120px;"><span class="agfa-note">Vytvářím QR…</span></div>' +
            '<button class="btn btn-secondary" style="width:100%;margin-top:10px;" id="agfa-uqr-x">Zavřít QR</button></div>';
        box.querySelector('#agfa-uqr-x').onclick = function () { box.innerHTML = ''; };
        function draw() {
            var out = box.querySelector('#agfa-uqr'); if (!out) return;
            if (typeof window.qrcode === 'undefined') {
                if (!u.ensureLib) { out.innerHTML = '<span class="agfa-note" style="color:var(--danger);">Chybí AGUcty.ensureLib.</span>'; return; }
                u.ensureLib('js/lib/qrcode.min.js').then(draw)
                    .catch(function () { out.innerHTML = '<span class="agfa-note" style="color:var(--danger);">Knihovnu QR se nepodařilo načíst (offline?).</span>'; });
                return;
            }
            try {
                var payload = 'AGF1\n' + (f.code || '') + '\t' + us.name + '\t' + (f.api || u.DEFAULT_API);
                if (window.qrcode.stringToBytesFuncs && window.qrcode.stringToBytesFuncs['UTF-8']) window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
                var qr = window.qrcode(0, 'M');
                qr.addData(payload, 'Byte');
                qr.make();
                out.innerHTML = '<img src="' + qr.createDataURL(6, 12) + '" alt="QR" style="width:100%;max-width:260px;image-rendering:pixelated;background:#fff;border-radius:10px;padding:4px;">';
            } catch (e) { out.innerHTML = '<span class="agfa-note" style="color:var(--danger);">QR se nepodařilo vytvořit.</span>'; }
        }
        draw();
    }

    // ---- zakázky přidělené účtu (jen NA TOMTO ZAŘÍZENÍ) -------------------------
    // Zakázky nežijí na serveru, ale v telefonu (arProjectsList) — přidělení je proto
    // taky per zařízení. Není to bezpečnostní hranice (kdo má odemčený telefon
    // a konzoli, na data se dostane), ale úklid: člověk pak v přihlášení i
    // v přepínačích zakázek vidí jen to, na čem má dělat. Nic nezaškrtnuto = všechno.
    function projAclHtml(u, us) {
        if (!us || !u.projList) return '';                       // nový účet: přidělíš po založení
        if (us.role === 'admin') return '';                      // admin má vždy vše
        var list = u.projList();
        if (!list || list.length < 2) return '';                 // jedna zakázka = není co přidělovat
        var acl = (u.projAclFor && u.projAclFor(us.id)) || null;
        var rows = list.map(function (p) {
            var on = acl ? acl.indexOf(p.id) !== -1 : false;
            return '<label class="agfa-perm"><input type="checkbox" class="agfa-u-proj" data-pid="' + esc(p.id) + '"' + (on ? ' checked' : '') + '> ' + esc(p.name || p.id) + '</label>';
        }).join('');
        return '<div class="agfa-pg">Zakázky na tomto zařízení</div>' +
            '<div class="agfa-note">Když nezaškrtneš nic, účet vidí <b>všechny</b> zakázky (výchozí stav). Zaškrtnutím ho omezíš — ' +
            'ostatní zakázky mu zmizí z výběru při přihlášení i z přepínačů v appce.</div>' + rows;
    }
    function readProjAcl(box, u, us) {
        if (!us || !u.setProjAcl) return;
        var cbs = box.querySelectorAll('.agfa-u-proj');
        if (!cbs.length) return;
        var out = [];
        for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) out.push(cbs[i].getAttribute('data-pid'));
        u.setProjAcl(us.id, out);
        try { if (u.applyProjPerms) u.applyProjPerms(); } catch (e) {}
    }

    function userForm(body, us) {
        var u = U(), f = u.getFirm(); if (!f) return;
        var cloud = !!f.cloud;
        var box = body.querySelector('#agfa-uform');
        var passLbl = cloud
            ? (us ? 'Nové heslo (nech prázdné = beze změny)' : 'Heslo (min. 4 znaky)')
            : (us ? 'Nový PIN (nech prázdné = beze změny)' : 'PIN (4–8 číslic; prázdné = bez PINu)');
        box.innerHTML =
            '<div style="border:1px solid var(--glass-border,rgba(255,255,255,0.15));border-radius:12px;padding:12px;margin-top:12px;">' +
            '<label class="agfa-lb">Jméno</label><input type="text" id="agfa-u-name" maxlength="40" value="' + esc(us ? us.name : '') + '">' +
            '<label class="agfa-lb">Role</label><select id="agfa-u-role">' +
            '  <option value="zamestnanec"' + (us && us.role === 'zamestnanec' ? ' selected' : '') + '>Zaměstnanec</option>' +
            '  <option value="vedeni"' + (us && us.role === 'vedeni' ? ' selected' : '') + '>Vedení</option>' +
            '  <option value="admin"' + (us && us.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
            '</select>' +
            '<label class="agfa-lb">' + passLbl + '</label>' +
            (cloud ? '<input type="password" id="agfa-u-pin" maxlength="64" placeholder="••••">'
                : '<input type="password" id="agfa-u-pin" inputmode="numeric" maxlength="8" placeholder="••••">') +
            projAclHtml(u, us) +
            '<div style="display:flex;gap:8px;margin-top:12px;">' +
            '  <button class="btn" style="flex:1;" id="agfa-u-save">' + (us ? 'Uložit změny' : 'Přidat') + '</button>' +
            '  <button class="btn btn-secondary" style="flex:1;" id="agfa-u-cancel">Zrušit</button>' +
            '</div></div>';
        box.querySelector('#agfa-u-cancel').onclick = function () { box.innerHTML = ''; };
        box.querySelector('#agfa-u-save').onclick = function () {
            var name = (box.querySelector('#agfa-u-name').value || '').trim();
            var role = box.querySelector('#agfa-u-role').value;
            var pin = box.querySelector('#agfa-u-pin').value || '';
            if (!name) { agAlert('Chybí jméno', 'Zadej jméno uživatele.'); return; }
            // degradace posledního admina (server v cloudu hlídá taky)
            if (us && us.role === 'admin' && role !== 'admin') {
                var admins = f.users.filter(function (x) { return x.role === 'admin'; });
                if (admins.length <= 1) { agAlert('Nelze změnit', 'Toto je poslední admin — nejdřív udělej adminem někoho jiného.'); return; }
            }
            var me = u.currentUser();
            if (cloud) {
                if (!us && pin.length < 4) { agAlert('Slabé heslo', 'Heslo musí mít aspoň 4 znaky.'); return; }
                if (us && pin && pin.length < 4) { agAlert('Slabé heslo', 'Heslo musí mít aspoň 4 znaky (nebo nech prázdné).'); return; }
                var req = us
                    ? u.cloudFetch('/users/' + encodeURIComponent(us.id), { method: 'PATCH', body: Object.assign({ name: name, role: role }, pin ? { password: pin } : {}) })
                    : u.cloudFetch('/users', { method: 'POST', body: { name: name, role: role, password: pin } });
                req.then(function (r) {
                    if (!r.ok) { agAlert(us ? 'Uložení selhalo' : 'Přidání selhalo', cloudErr(r)); return; }
                    // Přidělení zakázek je LOKÁLNÍ (na server nejde), ale uložit se smí
                    // teprve tady: applyProjPerms() ho hned vymáhá skrýváním zakázek,
                    // takže při chybě uložení účtu se nesmí propsat vůbec nic.
                    readProjAcl(box, u, us);
                    u.adoptConfig(r.data);
                    if (us && me && me.id === us.id) { try { localStorage.setItem('arSurveyor', name); } catch (e) {} }
                    renderUsers(body, true);
                });
                return;
            }
            if (pin && !/^\d{4,8}$/.test(pin)) { agAlert('Neplatný PIN', 'PIN musí mít 4–8 číslic (nebo nech prázdné).'); return; }
            function finish(pinHash, salt, noPin) {
                if (us) {
                    us.name = name; us.role = role;
                    if (pin) { us.pinHash = pinHash; us.salt = salt; us.noPin = false; }
                } else {
                    f.users.push({ id: 'u' + Date.now() + Math.floor(Math.random() * 1000), name: name, role: role, pinHash: pinHash, salt: salt, noPin: noPin });
                }
                u.saveFirm(f);
                if (us && me && me.id === us.id) { try { localStorage.setItem('arSurveyor', name); } catch (e) {} }
                // Až tady — před renderUsers(), který formulář zahodí, a zároveň až za
                // validací PINu, aby se přidělení zakázek neuložilo po chybové hlášce.
                readProjAcl(box, u, us);
                renderUsers(body);
            }
            if (pin) {
                var salt = u.makeSalt();
                u.hashPin(pin, salt).then(function (h) { finish(h, salt, false); });
            } else if (us) {
                finish(us.pinHash, us.salt, us.noPin);
            } else {
                finish(null, null, true);
            }
        };
    }

    // ------------------------------------------------------------------
    // Sekce Oprávnění (matice: co vidí vedení / zaměstnanec)
    // ------------------------------------------------------------------
    function renderPerms(body) {
        var u = U(), f = u.getFirm(); if (!f) return;
        var role = body.getAttribute('data-permrole') || 'zamestnanec';
        var perms = f.perms[role] || {};
        var html =
            '<div class="agfa-note">Admin vidí vždy vše. Tady firma určuje, co potřebuje <b>vedení</b> a co <b>zaměstnanci</b> — ' +
            'zbytek se v appce skryje (jednodušší obrazovka v terénu, méně omylů).</div>' +
            '<label class="agfa-lb">Role</label><select id="agfa-p-role">' +
            '  <option value="zamestnanec"' + (role === 'zamestnanec' ? ' selected' : '') + '>Zaměstnanec</option>' +
            '  <option value="vedeni"' + (role === 'vedeni' ? ' selected' : '') + '>Vedení</option>' +
            '</select>';
        var group = null;
        u.PERMS.forEach(function (p) {
            if (p.g !== group) { group = p.g; html += '<div class="agfa-pg">' + esc(group) + '</div>'; }
            var on = perms[p.k] !== false;
            html += '<label class="agfa-perm"><input type="checkbox" data-k="' + esc(p.k) + '"' + (on ? ' checked' : '') + '> ' + esc(p.t) + '</label>';
        });
        body.innerHTML = html;
        body.querySelector('#agfa-p-role').onchange = function () {
            body.setAttribute('data-permrole', this.value);
            renderPerms(body);
        };
        body.onchange = function (e) {
            var cb = e.target;
            if (!cb || cb.type !== 'checkbox' || !cb.getAttribute('data-k')) return;
            if (!f.perms[role]) f.perms[role] = {};
            f.perms[role][cb.getAttribute('data-k')] = cb.checked;
            if (f.cloud) {
                // uložit na server → propíše se všem zařízením; lokální cache hned
                u.saveFirm(f);
                u.cloudFetch('/config', { method: 'PUT', body: { perms: f.perms } }).then(function (r) {
                    if (!r.ok) {
                        agAlert('Změna se neuložila na server', cloudErr(r) + '<br><br>Na tomto zařízení platí, ale ostatní ji neuvidí — zopakuj ji s internetem.');
                    }
                });
                return;
            }
            u.saveFirm(f);
        };
    }

    // ------------------------------------------------------------------
    // Sekce Užívání (dashboard pro admina / vedení s oprávněním)
    // ------------------------------------------------------------------
    var _range = 7;    // dní zpět (1 = dnes)
    var _userF = '*';  // filtr uživatele ('*' = všichni)

    // ---- SVG grafy (bez knihoven; jedna barva appky, text v textových tónech) ----
    // sloupce (po dnech / hodinách): items = [{l: popisek osy, v: hodnota, t: tooltip}]
    function svgCols(items, opts) {
        opts = opts || {};
        var W = 560, H = opts.h || 150, padB = 18, padT = 14;
        var max = 0;
        items.forEach(function (it) { if (it.v > max) max = it.v; });
        if (!max) max = 1;
        var bw = W / items.length;
        var out = '<line x1="0" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" class="agc-axis"/>';
        var labeledMax = false;
        items.forEach(function (it, i) {
            var bh = Math.round((H - padB - padT) * it.v / max);
            var xc = (i * bw + bw / 2).toFixed(1);
            var y = H - padB - bh;
            out += '<rect x="' + (i * bw + bw * 0.18).toFixed(1) + '" y="' + y + '" width="' + (bw * 0.64).toFixed(1) +
                '" height="' + Math.max(bh, it.v ? 2 : 0) + '" rx="2" class="agc-bar"><title>' + esc(it.t || '') + '</title></rect>';
            if (it.l) out += '<text x="' + xc + '" y="' + (H - 5) + '" text-anchor="middle" class="agc-x">' + esc(it.l) + '</text>';
            if (!labeledMax && it.v === max && it.v > 0) {   // přímý popisek jen na vrcholu
                out += '<text x="' + xc + '" y="' + (y - 4) + '" text-anchor="middle" class="agc-v">' + it.v + '</text>';
                labeledMax = true;
            }
        });
        return '<svg viewBox="0 0 560 ' + H + '" style="width:100%;height:auto;display:block;" role="img">' + out + '</svg>';
    }
    // vodorovné pruhy (podle uživatele / nástroje): hodnota přímo za pruhem
    function svgBarsH(items) {
        var W = 560, rowH = 26, labW = 168;
        var max = 0;
        items.forEach(function (it) { if (it.v > max) max = it.v; });
        if (!max) max = 1;
        var span = W - labW - 52;
        var out = '';
        items.forEach(function (it, i) {
            var y = i * rowH, bw = Math.max(2, Math.round(span * it.v / max));
            out += '<text x="' + (labW - 8) + '" y="' + (y + rowH / 2 + 4) + '" text-anchor="end" class="agc-nm">' + esc(String(it.l).slice(0, 24)) + '</text>' +
                '<rect x="' + labW + '" y="' + (y + 6) + '" width="' + bw + '" height="14" rx="2" class="agc-bar"><title>' + esc(it.t || '') + '</title></rect>' +
                '<text x="' + (labW + bw + 8) + '" y="' + (y + rowH / 2 + 4) + '" class="agc-v">' + it.v + '</text>';
        });
        return '<svg viewBox="0 0 560 ' + (items.length * rowH) + '" style="width:100%;height:auto;display:block;" role="img">' + out + '</svg>';
    }
    // odhad odpracované doby ze stop aktivity: události se slijí do bloků
    // (mezera > 45 min = nový blok), samotný blok se počítá aspoň za 10 minut
    function workMs(tss) {
        if (!tss.length) return 0;
        tss.sort(function (a, b) { return a - b; });
        var total = 0, start = tss[0], prev = tss[0];
        for (var i = 1; i <= tss.length; i++) {
            if (i === tss.length || tss[i] - prev > 45 * 60e3) {
                total += Math.max(prev - start, 10 * 60e3);
                if (i < tss.length) start = tss[i];
            }
            if (i < tss.length) prev = tss[i];
        }
        return total;
    }
    function fmtH(ms) { return (Math.round(ms / 36e5 * 10) / 10).toLocaleString('cs-CZ'); }

    function renderUsage(body) {
        var u = U(), f = u.getFirm(); if (!f) return;
        body.innerHTML = '<div class="agfa-note">Načítám…</div>';
        var from = new Date();
        from.setHours(0, 0, 0, 0);
        if (_range > 1) from.setDate(from.getDate() - (_range - 1));
        var cloudNote = '';
        // cloud: nejdřív odešli lokální frontu, pak čti ze serveru (VŠECHNA zařízení);
        // bez signálu spadni na lokální záznamy tohoto zařízení
        var getEvents = (f.cloud
            ? u.syncUsage().then(function () {
                return u.cloudFetch('/usage?from=' + from.getTime()).then(function (r) {
                    if (r.ok && r.data && Array.isArray(r.data.events)) {
                        cloudNote = '<div class="agfa-note">Data ze všech zařízení firmy (server).</div>';
                        return r.data.events;
                    }
                    cloudNote = '<div class="agfa-note" style="color:var(--danger,#e5534b);">⚠ Server nedostupný — zobrazeny jen záznamy z tohoto zařízení.</div>';
                    return u.usageQuery(from.getTime());
                });
            })
            : u.usageQuery(from.getTime()));
        getEvents.then(function (all) {
            // možnosti filtru se berou z NEfiltrovaných dat, agregace z filtrovaných
            var names = {};
            all.forEach(function (ev) { if (ev.u && ev.u !== '?') names[ev.u] = 1; });
            if (_userF !== '*' && !names[_userF]) _userF = '*';
            var evs = (_userF === '*') ? all : all.filter(function (ev) { return ev.u === _userF; });

            var byUser = {}, tools = {}, byProj = {}, byDay = {}, byHour = [];
            var logins = 0, ptAdd = 0, ptEdit = 0, ptDel = 0, devs = {};
            for (var h = 0; h < 24; h++) byHour.push(0);
            evs.forEach(function (ev) {
                var b = byUser[ev.u] = byUser[ev.u] || { logins: 0, tools: 0, add: 0, edit: 0, del: 0, days: {}, tss: [], last: ev.ts };
                if (ev.ts > b.last) b.last = ev.ts;
                var d = new Date(ev.ts);
                b.days[d.toDateString()] = 1;
                b.tss.push(ev.ts);
                if (ev.dev) devs[ev.dev] = 1;
                byHour[d.getHours()]++;
                var dk = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
                var day = byDay[dk] = byDay[dk] || { add: 0, ev: 0 };
                day.ev++;
                var pr = null;
                if (ev.proj) {
                    pr = byProj[ev.proj] = byProj[ev.proj] || { add: 0, ev: 0, users: {}, last: 0 };
                    pr.ev++;
                    if (ev.u && ev.u !== '?') pr.users[ev.u] = 1;
                    if (ev.ts > pr.last) pr.last = ev.ts;
                }
                if (ev.t === 'login') { b.logins++; logins++; }
                else if (ev.t === 'tool') { b.tools++; tools[ev.k || '?'] = (tools[ev.k || '?'] || 0) + 1; }
                else if (ev.t === 'pt-add') { b.add++; ptAdd++; day.add++; if (pr) pr.add++; }
                else if (ev.t === 'pt-edit') { b.edit++; ptEdit++; }
                else if (ev.t === 'pt-del') { b.del++; ptDel++; }
            });
            var totalWork = 0;
            Object.keys(byUser).forEach(function (n) { byUser[n].work = workMs(byUser[n].tss); totalWork += byUser[n].work; });
            var topTools = Object.keys(tools).map(function (k) { return [k, tools[k]]; })
                .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);

            // ---- řada „body po dnech" (u ročního období po měsících) ----
            var dayItems = [];
            if (_range > 1) {
                var today = new Date(); today.setHours(0, 0, 0, 0);
                if (_range > 60) {
                    var months = {};
                    Object.keys(byDay).forEach(function (dk2) {
                        var p = dk2.split('-');
                        var mk = p[0] + '-' + p[1];
                        months[mk] = (months[mk] || 0) + byDay[dk2].add;
                    });
                    var mc = new Date(from.getTime());
                    mc.setDate(1);
                    while (mc <= today) {
                        var mk2 = mc.getFullYear() + '-' + (mc.getMonth() + 1);
                        var mv = months[mk2] || 0;
                        dayItems.push({ l: (mc.getMonth() + 1) + '/' + String(mc.getFullYear()).slice(2), v: mv, t: mc.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' }) + ': ' + mv + ' bodů' });
                        mc.setMonth(mc.getMonth() + 1);
                    }
                } else {
                    var cur = new Date(from.getTime()), di = 0;
                    var lblEvery = _range > 10 ? 5 : 1;
                    while (cur <= today) {
                        var dk3 = cur.getFullYear() + '-' + (cur.getMonth() + 1) + '-' + cur.getDate();
                        var dv = (byDay[dk3] || {}).add || 0;
                        dayItems.push({
                            l: (di % lblEvery === 0) ? (cur.getDate() + '.' + (cur.getMonth() + 1) + '.') : '',
                            v: dv,
                            t: cur.toLocaleDateString('cs-CZ') + ': ' + dv + ' bodů'
                        });
                        cur.setDate(cur.getDate() + 1);
                        di++;
                    }
                }
            }
            var hourItems = byHour.map(function (v, hh) {
                return { l: (hh % 3 === 0) ? String(hh) : '', v: v, t: hh + ':00–' + (hh + 1) + ':00 — ' + v + ' akcí' };
            });

            var userSel = '<option value="*">Všichni</option>' + Object.keys(names).sort().map(function (n) {
                return '<option value="' + esc(n) + '"' + (_userF === n ? ' selected' : '') + '>' + esc(n) + '</option>';
            }).join('');
            var html = cloudNote +
                '<div class="agfa-filters">' +
                '<div><label class="agfa-lb">Období</label><select id="agfa-d-range">' +
                '  <option value="1"' + (_range === 1 ? ' selected' : '') + '>Dnes</option>' +
                '  <option value="7"' + (_range === 7 ? ' selected' : '') + '>Posledních 7 dní</option>' +
                '  <option value="30"' + (_range === 30 ? ' selected' : '') + '>Posledních 30 dní</option>' +
                '  <option value="365"' + (_range === 365 ? ' selected' : '') + '>Poslední rok</option>' +
                '</select></div>' +
                '<div><label class="agfa-lb">Uživatel</label><select id="agfa-d-user">' + userSel + '</select></div>' +
                '</div>' +
                '<div class="agfa-cards">' +
                '  <div class="agfa-card"><b>' + ptAdd + '</b><span>bodů přidáno</span></div>' +
                '  <div class="agfa-card"><b>' + (ptEdit + ptDel) + '</b><span>úprav / smazání</span></div>' +
                '  <div class="agfa-card"><b>' + fmtH(totalWork) + '</b><span>≈ hodin práce</span></div>' +
                '  <div class="agfa-card"><b>' + logins + '</b><span>přihlášení</span></div>' +
                '  <div class="agfa-card"><b>' + Object.keys(byUser).length + '</b><span>aktivních lidí</span></div>' +
                '  <div class="agfa-card"><b>' + Object.keys(devs).length + '</b><span>zařízení</span></div>' +
                '</div>';

            if (dayItems.length > 1) {
                html += '<div class="agfa-pg">Body přidané ' + (_range > 60 ? 'po měsících' : 'po dnech') + '</div>' +
                    '<div class="agc-wrap">' + svgCols(dayItems) + '</div>';
            }
            html += '<div class="agfa-pg">Aktivita podle hodiny dne</div>' +
                '<div class="agc-wrap">' + svgCols(hourItems, { h: 110 }) + '</div>';

            html += '<div class="agfa-pg">Podle uživatele</div><table class="agfa-tbl"><tr><th>Uživatel</th><th>Body +</th><th>Úpr.</th><th>Dní</th><th>≈ práce</th><th>Naposledy</th></tr>';
            Object.keys(byUser).sort().forEach(function (name) {
                var b = byUser[name];
                html += '<tr><td><b>' + esc(name) + '</b></td><td>' + b.add + '</td><td>' + (b.edit + b.del) + '</td><td>' + Object.keys(b.days).length + '</td><td>' + fmtH(b.work) + ' h</td><td>' + new Date(b.last).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</td></tr>';
            });
            if (!Object.keys(byUser).length) html += '<tr><td colspan="6" style="color:var(--text-muted);">Zatím žádné záznamy ve zvoleném období.</td></tr>';
            html += '</table>';

            var userBars = Object.keys(byUser).map(function (n) {
                return { l: n, v: byUser[n].add, t: n + ': ' + byUser[n].add + ' bodů přidáno' };
            }).sort(function (a, b) { return b.v - a.v; }).slice(0, 12);
            if (userBars.length > 1) {
                html += '<div class="agfa-pg">Body přidané podle uživatele</div>' +
                    '<div class="agc-wrap">' + svgBarsH(userBars) + '</div>';
            }

            if (topTools.length) {
                html += '<div class="agfa-pg">Nejpoužívanější nástroje</div>' +
                    '<div class="agc-wrap">' + svgBarsH(topTools.map(function (t) {
                        return { l: t[0], v: t[1], t: t[0] + ': ' + t[1] + '× otevřeno' };
                    })) + '</div>';
            }

            var projKeys = Object.keys(byProj).sort(function (a, b) { return byProj[b].last - byProj[a].last; }).slice(0, 12);
            if (projKeys.length) {
                html += '<div class="agfa-pg">Podle zakázky</div><table class="agfa-tbl"><tr><th>Zakázka</th><th>Body +</th><th>Lidí</th><th>Poslední aktivita</th></tr>';
                projKeys.forEach(function (pk) {
                    var pr = byProj[pk];
                    html += '<tr><td><b>' + esc(pk) + '</b></td><td>' + pr.add + '</td><td>' + Object.keys(pr.users).length + '</td><td>' +
                        new Date(pr.last).toLocaleDateString('cs-CZ') + '</td></tr>';
                });
                html += '</table>';
            }

            // diagnostika appky (jen admin): chyby + úložiště
            if (u.isAdmin()) {
                html += '<div class="agfa-pg">Diagnostika appky</div><div id="agfa-diag" class="agfa-note">…</div>' +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
                    '  <button class="agfa-mini" id="agfa-d-csv">Export CSV</button>' +
                    '  <button class="agfa-mini" id="agfa-d-err">Protokol chyb</button>' +
                    '  <button class="agfa-mini danger" id="agfa-d-clear">Smazat záznamy užívání</button>' +
                    '</div>';
            }
            body.innerHTML = html;

            body.querySelector('#agfa-d-range').onchange = function () { _range = parseInt(this.value, 10) || 7; renderUsage(body); };
            body.querySelector('#agfa-d-user').onchange = function () { _userF = this.value || '*'; renderUsage(body); };

            if (u.isAdmin()) {
                var diag = body.querySelector('#agfa-diag');
                var errN = 0;
                try { if (window.agErrLog && typeof agErrLog.list === 'function') errN = (agErrLog.list() || []).length; } catch (e) {}
                var diagTxt = 'Zachycených chyb: <b>' + errN + '</b>';
                try {
                    if (navigator.storage && navigator.storage.estimate) {
                        navigator.storage.estimate().then(function (est) {
                            var used = est.usage ? (est.usage / 1048576).toFixed(1) : '?';
                            var quota = est.quota ? (est.quota / 1048576).toFixed(0) : '?';
                            diag.innerHTML = diagTxt + ' · Úložiště: <b>' + used + ' MB</b> z ' + quota + ' MB';
                        });
                    } else diag.innerHTML = diagTxt;
                } catch (e) { diag.innerHTML = diagTxt; }

                body.querySelector('#agfa-d-csv').onclick = function () { exportCsv(all); };   // CSV vždy bez filtru uživatele
                body.querySelector('#agfa-d-err').onclick = function () {
                    try { if (window.agErrLog && typeof agErrLog.show === 'function') agErrLog.show(); else agAlert('Protokol chyb', 'Modul err-log.js není načtený.'); } catch (e) {}
                };
                body.querySelector('#agfa-d-clear').onclick = function () {
                    agConfirm({ title: 'Smazat záznamy užívání', message: 'Smaže VŠECHNY záznamy o užívání (nejen zvolené období)' + (f.cloud ? ' — na serveru i v tomto zařízení' : '') + '. Žurnál bodů zůstane.', okText: 'Smazat', danger: true }).then(function (ok) {
                        if (!ok) return;
                        var done = function () { try { localStorage.removeItem('agFirmaSync_v1'); } catch (e) {} u.usageClear().then(function () { renderUsage(body); }); };
                        if (f.cloud) {
                            u.cloudFetch('/usage', { method: 'DELETE' }).then(function (r) {
                                if (!r.ok) { agAlert('Smazání na serveru selhalo', cloudErr(r)); return; }
                                done();
                            });
                        } else done();
                    });
                };
            }
        });
    }
    function exportCsv(evs) {
        var lines = ['datum;cas;uzivatel;typ;klic;zakazka'];
        evs.forEach(function (ev) {
            var d = new Date(ev.ts);
            lines.push([d.toLocaleDateString('cs-CZ'), d.toLocaleTimeString('cs-CZ'), ev.u, ev.t, ev.k || '', ev.proj || '']
                .map(function (v) { return String(v).replace(/;/g, ','); }).join(';'));
        });
        dl(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'ar-geodet-uzivani.csv');
    }
    function dl(blob, name) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }

    // ------------------------------------------------------------------
    // Sekce Docházka (admin/vedení s dashboardem): páruje příchody a odchody
    // ze všech zařízení. Data = události t='shift' (k='in'/'out'), které
    // zapisuje dlaždice Docházka (js/dochazka.js) stejnou cestou jako užívání
    // (IndexedDB fronta -> server), takže fungují i offline.
    // ------------------------------------------------------------------
    var _doRange = 7;
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmtDur(ms) {
        var m = Math.round(ms / 60000);
        return Math.floor(m / 60) + ':' + pad2(m % 60);
    }
    function renderDochazka(body) {
        var u = U(), f = u.getFirm(); if (!f) return;
        body.innerHTML = '<div class="agfa-note">Načítám…</div>';
        var from = new Date();
        from.setHours(0, 0, 0, 0);
        if (_doRange > 1) from.setDate(from.getDate() - (_doRange - 1));
        var cloudNote = '';
        var getEvents = (f.cloud
            ? u.syncUsage().then(function () {
                return u.cloudFetch('/usage?from=' + from.getTime()).then(function (r) {
                    if (r.ok && r.data && Array.isArray(r.data.events)) {
                        cloudNote = '<div class="agfa-note">Docházka ze všech zařízení firmy (server).</div>';
                        return r.data.events;
                    }
                    cloudNote = '<div class="agfa-note" style="color:var(--danger,#e5534b);">⚠ Server nedostupný — jen záznamy z tohoto zařízení.</div>';
                    return u.usageQuery(from.getTime());
                });
            })
            : u.usageQuery(from.getTime()));
        getEvents.then(function (all) {
            // klíč: 'in|poloha|meta' — [1] hrubá poloha píchnutí, [2] detail směny
            // (URI-encoded JSON {s:stavba, w:[s kým], c:činnost}; píše js/dochazka.js)
            function kDir(ev) { var s = String(ev.k || '').split('|'); return s[0]; }
            function kPos(ev) { var s = String(ev.k || '').split('|'); return s[1] || null; }
            function kMeta(ev) {
                var seg = String(ev.k || '').split('|')[2];
                if (!seg) return null;
                try {
                    var m = JSON.parse(decodeURIComponent(seg));
                    if (!m || typeof m !== 'object') return null;
                    // normalizace (záznam z jiného zařízení/verze): s,c řetězce, w pole řetězců
                    var out = {};
                    if (m.s != null && typeof m.s !== 'object') out.s = String(m.s);
                    if (m.c != null && typeof m.c !== 'object') out.c = String(m.c);
                    if (Array.isArray(m.w)) out.w = m.w.map(function (x) { return String(x); });
                    return (out.s || out.c || (out.w && out.w.length)) ? out : null;
                } catch (e) { return null; }
            }
            var PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:-2px;"><path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>';
            function posLink(pos) {
                return pos ? ' <a href="https://mapy.cz/zakladni?q=' + esc(pos) + '" target="_blank" rel="noopener" title="Poloha píchnutí: ' + esc(pos) + '" style="text-decoration:none;color:var(--accent,#2f9e74);">' + PIN + '</a>' : '';
            }
            function projName(id) {
                if (!id || id === 'default') return '';
                try {
                    if (typeof projects !== 'undefined' && Array.isArray(projects)) {
                        for (var i = 0; i < projects.length; i++) if (projects[i] && projects[i].id === id) return projects[i].name || id;
                    }
                } catch (e) {}
                return id;
            }
            var shifts = all.filter(function (ev) { return ev.t === 'shift'; })
                .sort(function (a, b) { return a.ts - b.ts; });
            // pairs: [{day,name,uid,inTs,outTs|null,ms,proj,inPos,outPos}] + souhrny
            var pairs = [], sum = {}, byProj = {}, open = {};
            var todayKey = (function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); })(new Date());
            shifts.forEach(function (ev) {
                var name = ev.u || '?';
                var dir = kDir(ev);
                if (dir === 'in') {
                    if (open[name]) pairs.push(open[name]);   // dvojí příchod: starý zůstane bez odchodu
                    var d = new Date(ev.ts);
                    open[name] = { day: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()), name: name, uid: ev.uid || null, inTs: ev.ts, outTs: null, ms: 0, proj: ev.proj || null, inPos: kPos(ev), outPos: null, inMeta: kMeta(ev), outMeta: null };
                } else if (dir === 'out') {
                    if (open[name]) {
                        open[name].outTs = ev.ts;
                        open[name].outPos = kPos(ev);
                        open[name].outMeta = kMeta(ev);
                        open[name].ms = Math.max(0, ev.ts - open[name].inTs);
                        pairs.push(open[name]);
                        delete open[name];
                    } else {
                        var d2 = new Date(ev.ts);   // odchod bez příchodu (např. příchod mimo období)
                        pairs.push({ day: d2.getFullYear() + '-' + pad2(d2.getMonth() + 1) + '-' + pad2(d2.getDate()), name: name, uid: ev.uid || null, inTs: null, outTs: ev.ts, ms: 0, proj: ev.proj || null, inPos: null, outPos: kPos(ev), inMeta: null, outMeta: kMeta(ev) });
                    }
                }
            });
            Object.keys(open).forEach(function (n) { if (open[n]) pairs.push(open[n]); });   // stále „v práci"
            pairs.forEach(function (p) {
                var s = sum[p.name] = sum[p.name] || { ms: 0, days: {}, open: false };
                s.days[p.day] = 1;
                var ms = 0;
                if (p.outTs && p.inTs) ms = p.ms;
                else if (p.inTs && p.day === todayKey) { ms = Date.now() - p.inTs; s.open = true; }
                s.ms += ms;
                if (ms && p.proj) {
                    var pr = byProj[p.proj] = byProj[p.proj] || { ms: 0, users: {} };
                    pr.ms += ms;
                    pr.users[p.name] = 1;
                }
            });

            var html = cloudNote +
                '<div class="agfa-filters"><div>' +
                '<label class="agfa-lb">Období</label><select id="agfa-do-range">' +
                '  <option value="1"' + (_doRange === 1 ? ' selected' : '') + '>Dnes</option>' +
                '  <option value="7"' + (_doRange === 7 ? ' selected' : '') + '>Posledních 7 dní</option>' +
                '  <option value="31"' + (_doRange === 31 ? ' selected' : '') + '>Posledních 31 dní</option>' +
                '</select></div>' +
                '<div style="display:flex;align-items:flex-end;gap:8px;">' +
                '  <button class="agfa-mini" id="agfa-do-csv">Export CSV</button>' +
                '  <button class="agfa-mini" id="agfa-do-print">Tisk / PDF</button>' +
                '</div></div>';

            var names = Object.keys(sum).sort();
            if (!names.length) {
                html += '<div class="agfa-note">Ve zvoleném období nikdo docházku nezapsal. Zaměstnanci si příchod/odchod ' +
                    'značí dlaždicí <b>Docházka</b> v Nástrojích (kategorie Pomůcky) — funguje i bez signálu.</div>';
            } else {
                html += '<div class="agfa-pg">Souhrn (' + (_doRange === 1 ? 'dnes' : 'za období') + ')</div>' +
                    '<table class="agfa-tbl"><tr><th>Uživatel</th><th>Dní</th><th>Hodin</th><th>Teď</th></tr>';
                names.forEach(function (n) {
                    var s = sum[n];
                    html += '<tr><td><b>' + esc(n) + '</b></td><td>' + Object.keys(s.days).length + '</td><td>' + fmtDur(s.ms) + '</td>' +
                        '<td>' + (s.open ? '<span class="agfa-chip c-accent">v práci</span>' : '') + '</td></tr>';
                });
                html += '</table>';

                var projKeys = Object.keys(byProj).sort(function (a, b) { return byProj[b].ms - byProj[a].ms; });
                if (projKeys.length) {
                    html += '<div class="agfa-pg">Hodiny podle zakázky</div>' +
                        '<table class="agfa-tbl"><tr><th>Zakázka</th><th>Hodin</th><th>Lidí</th></tr>';
                    projKeys.forEach(function (pk) {
                        html += '<tr><td><b>' + esc(projName(pk)) + '</b></td><td>' + fmtDur(byProj[pk].ms) + '</td><td>' + Object.keys(byProj[pk].users).length + '</td></tr>';
                    });
                    html += '</table>';
                }

                // rozpis po dnech (nejnovější nahoře); ikona špendlíku = poloha píchnutí
                var byDay = {};
                pairs.forEach(function (p) { (byDay[p.day] = byDay[p.day] || []).push(p); });
                html += '<div class="agfa-pg">Rozpis</div>';
                var rowIdx = 0, rowRef = [];
                Object.keys(byDay).sort().reverse().forEach(function (dk) {
                    var parts = dk.split('-');
                    html += '<div class="agfa-shift-day">' + parseInt(parts[2], 10) + '. ' + parseInt(parts[1], 10) + '. ' + parts[0] + '</div>' +
                        '<table class="agfa-tbl"><tr><th>Uživatel</th><th>Příchod</th><th>Odchod</th><th>Hodin</th><th>Zakázka</th></tr>';
                    byDay[dk].sort(function (a, b) { return (a.inTs || a.outTs) - (b.inTs || b.outTs); }).forEach(function (p) {
                        var tIn = p.inTs ? new Date(p.inTs).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) + posLink(p.inPos) : '<span style="color:var(--text-muted);">?</span>';
                        var missing = !p.outTs && p.inTs && p.day !== todayKey;
                        var tOut;
                        if (p.outTs) tOut = new Date(p.outTs).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) + posLink(p.outPos);
                        else if (p.inTs && p.day === todayKey) tOut = '<span class="agfa-chip c-accent">v práci</span>';
                        else if (missing && u.isAdmin()) { rowRef[rowIdx] = p; tOut = '<button class="agfa-mini" data-fix="' + rowIdx + '">Doplnit</button>'; rowIdx++; }
                        else tOut = '<span style="color:var(--text-muted);">chybí</span>';
                        var dur = p.outTs && p.inTs ? fmtDur(p.ms) : (p.inTs && p.day === todayKey ? fmtDur(Date.now() - p.inTs) : '—');
                        html += '<tr><td><b>' + esc(p.name) + '</b></td><td>' + tIn + '</td><td>' + tOut + '</td><td>' + dur + '</td><td>' + esc(String(projName(p.proj)).slice(0, 18)) + '</td></tr>';
                        // detail směny (stavba / parta / činnost) pod řádkem
                        var mi = p.inMeta || {}, mo = p.outMeta || {};
                        var det = [];
                        if (mi.s) det.push('🏗 ' + esc(mi.s));
                        if (mi.w && mi.w.length) det.push('👷 s: ' + esc(mi.w.join(', ')));
                        if (mo.c) det.push('✏ ' + esc(mo.c));
                        if (det.length) html += '<tr><td colspan="5" style="font-size:calc(11px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);padding-top:2px;">' + det.join(' · ') + '</td></tr>';
                    });
                    html += '</table>';
                });
                html += '<div class="agfa-note">Docházka je orientační podklad (páruje se příchod→odchod v pořadí záznamů; ikona špendlíku = hrubá poloha píchnutí, klepnutím se otevře v mapě). ' +
                    'Chybějící odchod z minulých dní se do součtu nepočítá — admin ho může tlačítkem Doplnit zapsat zpětně.</div>';
            }
            body.innerHTML = html;
            body.querySelector('#agfa-do-range').onchange = function () { _doRange = parseInt(this.value, 10) || 7; renderDochazka(body); };

            // admin: zpětné doplnění odchodu (zapíše se jako běžná událost a doputuje na server)
            body.onclick = function (e) {
                var btn = e.target.closest ? e.target.closest('button[data-fix]') : null;
                if (!btn) return;
                var p = rowRef[parseInt(btn.getAttribute('data-fix'), 10)];
                if (!p || !u.usageLogRaw) return;
                var v = prompt('Čas odchodu pro ' + p.name + ' (' + p.day + '), příchod byl ' + new Date(p.inTs).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) + '.\nZadej HH:MM:', '17:00');
                if (!v) return;
                var m = /^(\d{1,2})[:.](\d{2})$/.exec(v.trim());
                if (!m) { agAlert('Neplatný čas', 'Zadej např. 16:30.'); return; }
                var parts = p.day.split('-');
                var out = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
                if (out.getTime() <= p.inTs) { agAlert('Neplatný čas', 'Odchod musí být po příchodu.'); return; }
                u.usageLogRaw({ ts: out.getTime(), t: 'shift', k: 'out', uid: p.uid, u: p.name, proj: p.proj, dev: 'admin-fix' });
                if (f.cloud) setTimeout(function () { u.syncUsage().then(function () { renderDochazka(body); }); }, 700);
                else setTimeout(function () { renderDochazka(body); }, 400);
            };

            // exporty výkazu (CSV do mezd; Tisk/PDF přes systémový tisk)
            function exportRows() {
                var out = [];
                pairs.sort(function (a, b) { return (a.inTs || a.outTs) - (b.inTs || b.outTs); }).forEach(function (p) {
                    var mi = p.inMeta || {}, mo = p.outMeta || {};
                    out.push([p.day, p.name,
                        p.inTs ? new Date(p.inTs).toLocaleTimeString('cs-CZ') : '',
                        p.outTs ? new Date(p.outTs).toLocaleTimeString('cs-CZ') : '',
                        (p.inTs && p.outTs) ? fmtDur(p.ms) : '',
                        projName(p.proj) || '',
                        mi.s || '',
                        (mi.w && mi.w.length) ? mi.w.join(', ') : '',
                        mo.c || '',
                        p.inPos || '', p.outPos || '']);
                });
                return out;
            }
            body.querySelector('#agfa-do-csv').onclick = function () {
                var lines = ['datum;uzivatel;prichod;odchod;hodin;zakazka;stavba;s_kym;cinnost;poloha_prichod;poloha_odchod'];
                exportRows().forEach(function (r) {
                    lines.push(r.map(function (v) { return String(v).replace(/;/g, ','); }).join(';'));
                });
                dl(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'ar-geodet-dochazka.csv');
            };
            body.querySelector('#agfa-do-print').onclick = function () {
                var w = window.open('', '_blank');
                if (!w) { agAlert('Tisk', 'Prohlížeč zablokoval nové okno — povol vyskakovací okna.'); return; }
                var rows = exportRows().map(function (r) {
                    // sloupce: datum..zakázka + stavba + poznámka (s kým / činnost)
                    var note = [r[7] ? 's: ' + r[7] : '', r[8]].filter(Boolean).join(' — ');
                    return '<tr><td>' + r.slice(0, 7).concat([note]).map(esc).join('</td><td>') + '</td></tr>';
                }).join('');
                var sumRows = names.map(function (n) {
                    return '<tr><td>' + esc(n) + '</td><td>' + Object.keys(sum[n].days).length + '</td><td>' + fmtDur(sum[n].ms) + '</td></tr>';
                }).join('');
                w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Výkaz docházky</title>' +
                    '<style>body{font:13px/1.5 system-ui;margin:24px;color:#111;}h1{font-size:calc(19px * var(--ag-font-scale, 1));}h2{font-size:calc(14px * var(--ag-font-scale, 1));margin-top:22px;}' +
                    'table{border-collapse:collapse;width:100%;}th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;font-size:calc(12px * var(--ag-font-scale, 1));}' +
                    'th{background:#eee;}@media print{button{display:none;}}</style></head><body>' +
                    '<h1>Výkaz docházky — ' + esc(f.firmName || '') + '</h1>' +
                    '<div>Období: ' + esc(from.toLocaleDateString('cs-CZ')) + ' – ' + esc(new Date().toLocaleDateString('cs-CZ')) + ' · vytvořeno ' + esc(new Date().toLocaleString('cs-CZ')) + '</div>' +
                    '<h2>Souhrn</h2><table><tr><th>Uživatel</th><th>Dní</th><th>Hodin</th></tr>' + sumRows + '</table>' +
                    '<h2>Rozpis</h2><table><tr><th>Datum</th><th>Uživatel</th><th>Příchod</th><th>Odchod</th><th>Hodin</th><th>Zakázka</th><th>Stavba</th><th>Poznámka</th></tr>' + rows + '</table>' +
                    '<button onclick="window.print()" style="margin-top:16px;padding:8px 14px;">Vytisknout / uložit PDF</button>' +
                    '</body></html>');
                w.document.close();
                setTimeout(function () { try { w.print(); } catch (e) {} }, 400);
            };
        });
    }

    // ---- přihlášení při každém startu (per zařízení; výchozí ANO) --------
    function lockStartHtml(u) {
        var on = !u.getLockOnStart || u.getLockOnStart();
        var me = u.currentUser();
        var t = (me && u.trustFor) ? u.trustFor(me.id) : null;
        var bioOk = !!(u.bioSupported && u.bioSupported());
        var bioOn = !!(me && u.bioAvailable && u.bioAvailable(me.id));
        var html = '<div class="agfa-pg">Zámek appky</div>' +
            '<label class="agfa-perm"><input type="checkbox" id="agfa-lockstart"' + (on ? ' checked' : '') + '> ' +
            'Vyžadovat přihlášení při každém spuštění appky</label>' +
            '<div class="agfa-note">Zapnuto (doporučeno): appka po spuštění ověří, kdo ji drží. Nemusí to být psaní hesla — ' +
            'na přihlášení stačí zaškrtnout <b>Zůstat přihlášený na tomhle telefonu</b> a appka se pak otevírá přihlášená, ' +
            'jen každé <b>' + (u.TRUST_MAX || 20) + '.</b> spuštění se pro kontrolu zeptá na heslo. Vypnuto: nekontroluje se nikdy. ' +
            'Platí pro <b>toto zařízení</b>.</div>';
        if (me) {
            html += '<div class="agfa-note" style="margin-top:2px;"><b>Teď na tomhle telefonu:</b> ' +
                (t ? ('pamatované přihlášení ' + (t.mode === 'bio' ? '(odemyká se telefonem)' : '(bez ptaní)') +
                    ' · do kontrolního hesla zbývá ' + (u.trustLeft ? u.trustLeft(t) : '?') + ' spuštění')
                   : 'pamatované přihlášení vypnuté — příště se zadává ' + (u.getFirm() && u.getFirm().cloud ? 'heslo' : 'PIN')) +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">' +
                (bioOk
                    ? '  <button class="agfa-mini" id="agfa-bio">' + (bioOn ? 'Vypnout odemykání telefonem' : 'Zapnout odemykání telefonem (Face ID)') + '</button>'
                    : '') +
                (t ? '  <button class="agfa-mini danger" id="agfa-trust-off">Zrušit pamatované přihlášení</button>' : '') +
                '</div>';
            if (!bioOk) {
                html += '<div class="agfa-note">Odemykání telefonem (Face ID / Touch ID / kód obrazovky) tady není k dispozici — ' +
                    'vyžaduje HTTPS a telefon, který to umí.</div>';
            } else {
                html += '<div class="agfa-note">Ověřuje <b>telefon</b>, appka se dozví jen to, že ověření prošlo — heslo si nikam neukládá. ' +
                    'Není to náhrada firemního hesla, je to zámek proti půjčenému telefonu.</div>';
            }
        }
        return html;
    }
    function wireLockStart(body, u) {
        var cb = body.querySelector('#agfa-lockstart');
        if (cb && u.setLockOnStart) cb.onchange = function () { u.setLockOnStart(this.checked); };
        var me = u.currentUser();
        var bio = body.querySelector('#agfa-bio');
        if (bio && me) {
            bio.onclick = function () {
                if (u.bioAvailable && u.bioAvailable(me.id)) {
                    u.bioForget(me.id);
                    agAlert('Hotovo', 'Odemykání telefonem vypnuto. Pamatované přihlášení teď platí bez ověření — nebo ho zruš tlačítkem vedle.');
                    reopenSection(body);
                    return;
                }
                var btn = this;
                btn.disabled = true; btn.textContent = 'Ověřuji…';
                u.bioEnroll(me).then(function (ok) {
                    agAlert(ok ? 'Zapnuto' : 'Nepovedlo se',
                        ok ? 'Příště appku odemkneš Face ID / Touch ID nebo kódem obrazovky.'
                           : 'Telefon ověření nepovolil. Zkontroluj, že máš zapnutý Face ID / kód obrazovky, a zkus to znovu.');
                    reopenSection(body);
                });
            };
        }
        var off = body.querySelector('#agfa-trust-off');
        if (off) off.onclick = function () {
            u.clearTrust();
            agAlert('Hotovo', 'Při dalším spuštění se appka zeptá na ' + (u.getFirm() && u.getFirm().cloud ? 'heslo' : 'PIN') + '.');
            reopenSection(body);
        };
    }
    // Překreslení sekce Firma — tlačítka zámku mění stav, který sekce sama vypisuje.
    // renderFirm si podle f.cloud vybere lokální/cloudovou podobu, takže stačí ono.
    function reopenSection(body) {
        try { renderFirm(body); } catch (e) {}
    }

    // ------------------------------------------------------------------
    // Přepínání mezi firmami uloženými v zařízení (profily z js/ucty.js)
    // ------------------------------------------------------------------
    function firmsHtml(u, f) {
        var profs = u.listProfiles ? u.listProfiles() : [];
        var curKey = u.profileKeyOf ? u.profileKeyOf(f) : null;
        var rows = profs.map(function (p) {
            var cur = p.key === curKey;
            return '<div class="agfa-row" data-key="' + esc(p.key) + '">' +
                '<b>' + esc(p.label) + '</b>' +
                '<span class="agfa-chip' + (cur ? ' c-accent' : '') + '">' + (p.cloud ? 'cloud · ' + esc(p.code || '?') : 'lokální') + (cur ? ' · aktivní' : '') + '</span>' +
                (cur ? '' : '<button class="agfa-mini" data-act="sw">Přepnout</button><button class="agfa-mini danger" data-act="rm">Zapomenout</button>') +
                '</div>';
        }).join('');
        return '<div class="agfa-pg">Firmy na tomto zařízení</div>' +
            '<div class="agfa-note">Můžeš být ve více firmách (třeba vlastní + zákaznická). Přepnutí zobrazí přihlášení zvolené firmy — ' +
            'vždy chce heslo/PIN. Body a zakázky v zařízení se nemění. Podrobněji v záložce Nápověda.</div>' +
            '<div id="agfa-firms" class="agfa-list">' + rows + '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
            '  <button class="agfa-mini" id="agfa-f-join2">+ Připojit další firmu (kód)</button>' +
            '  <button class="agfa-mini" id="agfa-f-new2">Založit další firmu</button>' +
            '</div><div id="agfa-join2"></div>';
    }
    function wireFirms(body, u) {
        var list = body.querySelector('#agfa-firms');
        if (list) list.onclick = function (e) {
            var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
            if (!btn) return;
            var key = btn.closest('.agfa-row').getAttribute('data-key');
            if (btn.getAttribute('data-act') === 'rm') {
                agConfirm({ title: 'Zapomenout firmu', message: 'Odebere firmu jen ze seznamu tohoto zařízení (na serveru se nic nemění). Znovu se lze kdykoli přihlásit kódem firmy.', okText: 'Zapomenout', danger: true }).then(function (ok) {
                    if (!ok) return;
                    u.removeProfile(key);
                    renderNav('firma');
                });
                return;
            }
            agConfirm({ title: 'Přepnout firmu', message: 'Aktuální firma se uloží do seznamu a zobrazí se přihlášení zvolené firmy. Body a zakázky se nemění.', okText: 'Přepnout' }).then(function (ok) {
                if (!ok) return;
                document.getElementById('agfa-modal').style.display = 'none';
                u.switchProfile(key);
            });
        };
        var join2 = body.querySelector('#agfa-f-join2');
        if (join2) join2.onclick = function () {
            var box = body.querySelector('#agfa-join2');
            box.innerHTML =
                '<div style="border:1px solid var(--glass-border,rgba(255,255,255,0.15));border-radius:12px;padding:12px;margin-top:10px;">' +
                '<label class="agfa-lb">Kód firmy</label><input type="text" id="agfa-j2-code" maxlength="6" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.15em;">' +
                '<label class="agfa-lb">Tvoje jméno v té firmě</label><input type="text" id="agfa-j2-name" maxlength="40">' +
                '<label class="agfa-lb">Heslo</label><input type="password" id="agfa-j2-pass" maxlength="64">' +
                '<div style="display:flex;gap:8px;margin-top:12px;">' +
                '<button class="btn" style="flex:1;" id="agfa-j2-go">Přihlásit do firmy</button>' +
                '<button class="btn btn-secondary" style="flex:1;" id="agfa-j2-x">Zrušit</button></div></div>';
            box.querySelector('#agfa-j2-x').onclick = function () { box.innerHTML = ''; };
            box.querySelector('#agfa-j2-go').onclick = function () {
                var code = (box.querySelector('#agfa-j2-code').value || '').trim().toUpperCase();
                var name = (box.querySelector('#agfa-j2-name').value || '').trim();
                var pass = box.querySelector('#agfa-j2-pass').value || '';
                if (!code || !name || !pass) { agAlert('Chybí údaje', 'Vyplň kód firmy, jméno i heslo.'); return; }
                u.rememberCurrentFirm();                 // aktuální firma zůstane v seznamu
                u.cloudFetch('/login', { method: 'POST', api: u.DEFAULT_API, body: { code: code, name: name, password: pass } }).then(function (r) {
                    if (!r.ok) { agAlert('Přihlášení selhalo', cloudErr(r)); return; }
                    u.adoptLogin(r.data, u.DEFAULT_API);
                    u.usageLog('login', 'join');
                    agAlert('Přepnuto', 'Jsi přihlášen jako <b>' + esc(r.data.user.name) + '</b> ve firmě <b>' + esc(r.data.config.firm.name) + '</b>. Původní firma zůstává v seznamu firem zařízení.');
                    renderNav(u.isAdmin() ? 'firma' : 'uzivani');
                });
            };
        };
        var new2 = body.querySelector('#agfa-f-new2');
        if (new2) new2.onclick = function () {
            u.rememberCurrentFirm();   // po založení bude aktivní nová firma; tahle zůstane v seznamu
            wizardCloud(body);
        };
    }

    // ------------------------------------------------------------------
    // Sekce Firma (název, auto-zámek, export/import, vypnutí)
    // ------------------------------------------------------------------
    function renderFirm(body) {
        var u = U(), f = u.getFirm(); if (!f) return;
        if (f.cloud) { renderFirmCloud(body, u, f); return; }
        body.innerHTML =
            '<label class="agfa-lb">Název firmy</label><input type="text" id="agfa-f-name" maxlength="60" value="' + esc(f.firmName || '') + '">' +
            '<label class="agfa-lb">Auto-zámek po nečinnosti (minuty; 0 = vypnuto)</label>' +
            '<input type="number" id="agfa-f-lock" min="0" max="480" step="1" value="' + (parseInt(f.autoLockMin, 10) || 0) + '">' +
            lockStartHtml(u) +
            '<div class="agfa-pg">Přenos na další zařízení</div>' +
            '<div class="agfa-note">Export uloží účty (s PINy v podobě otisků, ne v čitelné podobě) a matici oprávnění do souboru ' +
            '<b>.argeofirma.json</b>. Ten naimportuješ na telefonech zaměstnanců — stejná firma, stejné účty, stejná pravidla. Body a zakázky se nepřenáší (na to je Přenos zakázky).</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '  <button class="agfa-mini" id="agfa-f-exp">Exportovat firmu</button>' +
            '  <button class="agfa-mini" id="agfa-f-imp">Importovat firmu</button>' +
            '  <input type="file" id="agfa-f-file" accept=".json,application/json" style="display:none;">' +
            '</div>' +
            firmsHtml(u, f) +
            '<div class="agfa-pg">Nebezpečná zóna</div>' +
            '<button class="agfa-mini danger" id="agfa-f-off">Vypnout firemní režim</button>' +
            '<div class="agfa-note">Vypnutí smaže účty a oprávnění na tomto zařízení. Body, zakázky, žurnál i záznamy užívání zůstanou.</div>';

        wireFirms(body, u);
        wireLockStart(body, u);
        body.querySelector('#agfa-f-name').onchange = function () { f.firmName = (this.value || '').trim() || 'Moje firma'; u.saveFirm(f); };
        body.querySelector('#agfa-f-lock').onchange = function () { f.autoLockMin = Math.max(0, parseInt(this.value, 10) || 0); u.saveFirm(f); };

        body.querySelector('#agfa-f-exp').onclick = function () {
            var out = { format: 'argeofirma', v: 1, exportedTs: Date.now(), firm: f };
            dl(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), (f.firmName || 'firma').replace(/[^\w\-]+/g, '_') + '.argeofirma.json');
        };
        var fileInp = body.querySelector('#agfa-f-file');
        body.querySelector('#agfa-f-imp').onclick = function () { fileInp.click(); };
        fileInp.onchange = function () {
            var file = this.files && this.files[0];
            if (!file) return;
            var rd = new FileReader();
            rd.onload = function () {
                try {
                    var data = JSON.parse(rd.result);
                    if (!data || data.format !== 'argeofirma' || !data.firm || !Array.isArray(data.firm.users) || !data.firm.users.length) {
                        agAlert('Neplatný soubor', 'Tohle není export firmy (.argeofirma.json).'); return;
                    }
                    agConfirm({ title: 'Importovat firmu', message: 'Nahradí zdejší firemní nastavení firmou <b>' + esc(data.firm.firmName || '?') + '</b> (' + data.firm.users.length + ' uživatelů). Body a zakázky se nemění.', okText: 'Importovat' }).then(function (ok) {
                        if (!ok) return;
                        data.firm.enabled = true;
                        u.saveFirm(data.firm);
                        document.getElementById('agfa-modal').style.display = 'none';
                        u.logout();   // vynutí přihlášení pod novou firmou
                    });
                } catch (e) { agAlert('Chyba importu', 'Soubor se nepodařilo přečíst: ' + esc(e.message || e)); }
            };
            rd.readAsText(file);
            this.value = '';
        };

        body.querySelector('#agfa-f-off').onclick = function () {
            agConfirm({ title: 'Vypnout firemní režim', message: 'Přihlašování i oprávnění se zruší, appka bude zase otevřená. Body a zakázky zůstanou.', okText: 'Vypnout', danger: true }).then(function (ok) {
                if (!ok) return;
                if (u.removeProfile && u.profileKeyOf) u.removeProfile(u.profileKeyOf(f));
                try { localStorage.removeItem('agFirma_v1'); localStorage.removeItem('agFirmaSess_v1'); } catch (e) {}
                document.getElementById('agfa-modal').style.display = 'none';
                if (u.applyPerms) u.applyPerms();
                agAlert('Hotovo', 'Firemní režim je vypnutý — appka se vrátí na přihlašovací bránu.');
            });
        };
    }

    // ---- sekce Firma v CLOUD režimu -------------------------------------
    function renderFirmCloud(body, u, f) {
        body.innerHTML =
            '<div class="agfa-pg">Kód firmy (pro připojení dalších zařízení)</div>' +
            '<div style="font:800 34px/1.2 var(--font-display,system-ui);letter-spacing:.18em;text-align:center;color:var(--accent,#2f9e74);margin:10px 0;user-select:all;">' + esc(f.code || '?') + '</div>' +
            '<div class="agfa-note">Zaměstnanec na svém mobilu otevře Nástroje → <b>Firma a účty</b> → „Připojit toto zařízení k firmě" a zadá kód + jméno + heslo (účet mu založ v sekci Uživatelé).</div>' +
            '<label class="agfa-lb">Název firmy</label><input type="text" id="agfa-f-name" maxlength="60" value="' + esc(f.firmName || '') + '">' +
            '<label class="agfa-lb">Auto-zámek po nečinnosti (minuty; 0 = vypnuto) — platí pro všechna zařízení</label>' +
            '<input type="number" id="agfa-f-lock" min="0" max="480" step="1" value="' + (parseInt(f.autoLockMin, 10) || 0) + '">' +
            lockStartHtml(u) +
            '<div class="agfa-pg">Vytížení serveru</div>' +
            '<div id="agfa-stats" class="agfa-note">Načítám vytížení…</div>' +
            '<div class="agfa-pg">Server</div>' +
            '<div class="agfa-note">Firma běží na Cloudflare (free plán, 100 000 požadavků/den). Adresa API: <code style="word-break:break-all;">' + esc(f.api || u.DEFAULT_API) + '</code><br>Kód serveru je v repu appky ve složce <b>cloud/</b> — provoz nezávisí na žádné AI.</div>' +
            '<button class="agfa-mini" id="agfa-f-backup">Stáhnout zálohu firmy (JSON)</button>' +
            '<div class="agfa-note">Záloha obsahuje účty (hesla jen jako otisky), oprávnění, užívání i chat — pojistka nezávislá na Cloudflare.</div>' +
            firmsHtml(u, f) +
            '<div class="agfa-pg">Nebezpečná zóna</div>' +
            '<button class="agfa-mini danger" id="agfa-f-detach">Odpojit toto zařízení od firmy</button>' +
            '<div class="agfa-note">Odpojení zruší přihlašování jen na TOMTO zařízení. Firma na serveru i ostatní mobily jedou dál. Body a zakázky zůstanou.</div>';

        function putCfg(patch, input, revert) {
            u.cloudFetch('/config', { method: 'PUT', body: patch }).then(function (r) {
                if (!r.ok) { agAlert('Uložení selhalo', cloudErr(r)); if (input) input.value = revert; return; }
                u.adoptConfig(r.data);
            });
        }
        wireFirms(body, u);
        wireLockStart(body, u);

        // záloha celé firmy ze serveru (GET /backup, jen admin)
        body.querySelector('#agfa-f-backup').onclick = function () {
            var btn = this;
            btn.disabled = true; btn.textContent = 'Stahuji…';
            u.cloudFetch('/backup').then(function (r) {
                btn.disabled = false; btn.textContent = 'Stáhnout zálohu firmy (JSON)';
                if (!r.ok || !r.data) {
                    agAlert('Záloha selhala', cloudErr(r) + (r.status === 404 ? '<br><br>Server nejspíš ještě nemá nasazený nový kód (endpoint /backup).' : ''));
                    return;
                }
                dl(new Blob([JSON.stringify(r.data, null, 1)], { type: 'application/json' }),
                    (f.firmName || 'firma').replace(/[^\w\-]+/g, '_') + '-zaloha.json');
            });
        };

        // vytížení serveru: dnešek proti limitu + poslední dny + velikost dat
        u.cloudFetch('/stats').then(function (r) {
            var el = body.querySelector('#agfa-stats');
            if (!el) return;
            if (!r.ok || !r.data) {
                el.innerHTML = 'Vytížení se nepodařilo načíst' + (r.status === 0 ? ' — server je offline nebo nemá nasazený nový kód (/stats).' : ' (chyba ' + r.status + ').');
                return;
            }
            var d = r.data;
            var lim = (d.limits && d.limits.reqPerDay) || 100000;
            var todayN = 0;
            (d.days || []).forEach(function (x) { if (x.day === d.today) todayN = x.n; });
            var pct = Math.min(100, todayN / lim * 100);
            var cls = pct >= 80 ? 'crit' : (pct >= 50 ? 'warn' : '');
            var cols = (d.days || []).map(function (x, i, arr) {
                return {
                    l: (arr.length <= 7 || i % 2 === 0) ? (parseInt(x.day.slice(8), 10) + '.' + parseInt(x.day.slice(5, 7), 10) + '.') : '',
                    v: x.n,
                    t: x.day + ': ' + x.n.toLocaleString('cs-CZ') + ' požadavků'
                };
            });
            var rows = d.rows || {};
            el.innerHTML =
                '<b style="color:var(--text,#e6e8eb);">Dnes ' + todayN.toLocaleString('cs-CZ') + '</b> z ' + lim.toLocaleString('cs-CZ') +
                ' požadavků za den (' + (Math.round(pct * 10) / 10).toLocaleString('cs-CZ') + ' %, ' + esc((d.limits && d.limits.plan) || 'free') + ')' +
                '<div class="agfa-meter"><i class="' + cls + '" style="width:' + Math.max(1, pct).toFixed(1) + '%"></i></div>' +
                (cols.length > 1 ? '<div class="agc-wrap">' + svgCols(cols, { h: 90 }) + '</div>' : '') +
                'Počítají se všechny požadavky na API (všechny firmy na serveru) včetně technických preflightů prohlížeče. ' +
                'Přes ~80 % denně = čas zvážit placený plán.' +
                '<br>Uloženo pro tuto firmu: užívání <b>' + (rows.usage != null ? rows.usage.toLocaleString('cs-CZ') : '?') + '</b> záznamů · chat <b>' +
                (rows.chat != null ? rows.chat : '?') + '</b> zpráv · uživatelů <b>' + (rows.users != null ? rows.users : '?') + '</b>' +
                (rows.firms != null ? ' · firem na serveru celkem <b>' + rows.firms + '</b>' : '');
        });

        var nameInp = body.querySelector('#agfa-f-name');
        nameInp.onchange = function () { putCfg({ firmName: (this.value || '').trim() || 'Moje firma' }, this, f.firmName); };
        var lockInp = body.querySelector('#agfa-f-lock');
        lockInp.onchange = function () { putCfg({ autoLockMin: Math.max(0, parseInt(this.value, 10) || 0) }, this, f.autoLockMin); };

        body.querySelector('#agfa-f-detach').onclick = function () {
            agConfirm({ title: 'Odpojit zařízení', message: 'Toto zařízení se odhlásí a zapomene firmu. Firma na serveru se NEmění — kdykoli se jde připojit znovu kódem. Body a zakázky zůstanou.', okText: 'Odpojit', danger: true }).then(function (ok) {
                if (!ok) return;
                if (u.removeProfile && u.profileKeyOf) u.removeProfile(u.profileKeyOf(f));
                try {
                    localStorage.removeItem('agFirma_v1');
                    localStorage.removeItem('agFirmaSess_v1');
                    localStorage.removeItem('agFirmaTok_v1');
                    localStorage.removeItem('agFirmaOff_v1');
                    localStorage.removeItem('agFirmaSync_v1');
                } catch (e) {}
                document.getElementById('agfa-modal').style.display = 'none';
                if (u.applyPerms) u.applyPerms();
                agAlert('Zařízení odpojeno', 'Appka se vrátí na přihlašovací bránu. Body a zakázky zůstaly.');
            });
        };
    }

    // ------------------------------------------------------------------
    // Vstupy do modulu: dlaždice v Nástrojích + tlačítko v menu Více
    // ------------------------------------------------------------------
    function openEntry() {
        var u = U();
        if (!u) { agAlert('Chybí jádro', 'Modul js/ucty.js není načtený.'); return; }
        var f = u.getFirm();
        if (!f) { openWizard(); return; }
        if (u.isAdmin()) { openModal('prehled'); return; }
        if (u.can('x.dashboard')) { openModal('uzivani'); return; }
        agAlert('Jen pro admina', 'Administraci firmy otevře administrátor. Ty se můžeš odhlásit nebo přepnout v menu Více.');
    }

    function syncMenuBtn() {
        var u = U(); if (!u) return;
        var f = u.getFirm();
        var btn = document.getElementById('agfa-switch-btn');
        var adm = document.getElementById('agfa-admin-btn');
        var scroll = document.querySelector('#side-menu .menu-scroll');
        if (!f) { if (btn) btn.remove(); if (adm) adm.remove(); return; }
        if (!scroll) return;
        var hr = scroll.querySelector('hr');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'agfa-switch-btn';
            btn.className = 'menu-btn';
            btn.innerHTML = '<svg class="icon"><use href="#i-users"/></svg> Přepnout uživatele / zamknout';
            btn.onclick = function () {
                try { if (typeof window.toggleMenu === 'function') toggleMenu(); } catch (e) {}
                var uu = U(); if (uu) uu.lock();
            };
            scroll.insertBefore(btn, hr || null);
        }
        // admin má administraci po ruce (nemusí ji hledat v Nástrojích)
        if (u.isAdmin()) {
            if (!adm) {
                adm = document.createElement('button');
                adm.id = 'agfa-admin-btn';
                adm.className = 'menu-btn';
                adm.innerHTML = '<svg class="icon"><use href="#i-users"/></svg> Administrace firmy (admin)';
                adm.onclick = function () {
                    try { if (typeof window.toggleMenu === 'function') toggleMenu(); } catch (e) {}
                    openEntry();
                };
                scroll.insertBefore(adm, btn);
            }
        } else if (adm) adm.remove();
    }

    function init() {
        if (!U()) return;   // jádro chybí -> nic neinjektovat
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'ucty-firma', label: 'Firma a účty', icon: ICON, onClick: openEntry, order: 90, cat: 'Pomůcky' });
        }
        syncMenuBtn();
        // BATERIE: jen DOM v bočním menu — přes AG.uiInterval se na pozadí uspí
        (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(syncMenuBtn, 3000);
        // dlaždici „Firma a účty" skrýt zaměstnancům (nemají v ní co dělat).
        // POZOR: musí umět i UKÁZAT — dřív jen skrývala, takže když se vyhodnotila
        // před přihlášením (zámek při startu: firma je, uživatel ještě ne), dlaždice
        // zmizela i adminovi a vrátila se až s překreslením mřížky Nástrojů.
        window.addEventListener('agucty:perms', function () {
            try {
                var u = U(); if (!u) return;
                var tile = document.querySelector('#tools-modal .tool-tile[data-tool="ucty-firma"]');
                if (!tile) return;
                if (!u.getFirm()) { tile.style.display = ''; return; }   // bez firmy = vstup pro založení
                var usr = u.currentUser ? u.currentUser() : null;
                // bez přihlášeného uživatele nerozhodovat (za zámkem stejně nejde otevřít)
                var show = !usr || u.isAdmin() || u.can('x.dashboard');
                tile.style.display = show ? '' : 'none';
            } catch (e) {}
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 400); });
    else setTimeout(init, 400);

    window.AGUctyAdmin = { open: openEntry, wizard: openWizard };
})();
