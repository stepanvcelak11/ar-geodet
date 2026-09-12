// ===== QTRIG — KARTA „VERZE PRO" (odložená vrstva) ===========================
// Celoobrazovková karta, kterou otevře klepnutí na zamčený nástroj i položka
// „Verze Pro" ve „Více". Do 12. 9. 2026 byla malé okno uprostřed, vyráběl ji
// js/pro-zamky.js a uživatel o ní řekl: „vypadá to příšerně — odemčeno a pod
// tím zase odemčeno, něco překryté, dej to na celou obrazovku". Tady je celá
// znovu; v pro-zamky.js zůstal jen zámek a prázdná skořápka okna (id
// #ag-pro-modal, název v .agp-nazev), kterou tenhle modul po načtení naplní.
//
// PROČ ODLOŽENÁ: js/pro-zamky.js jede při startu a rozpočet startu
// (scripts/check_start_budget.py) měl 2 kB rezervy. Karta se otevírá až na
// klepnutí, takže sem patří; skořápka se ukáže hned (testy i člověk vidí
// odezvu), obsah dojede za zlomek sekundy.
//
// ŽÁDOST O PRO MÍSTO NÁKUPU (12. 9. 2026): uživatel nechce řešit placení —
// „Pro nechám uzavřené, ale musí mě požádat, abych jim to otevřel". Karta má
// proto hlavní tlačítko „Požádat o Pro": formulář jde do schránky zpětné vazby
// (POST /feedback, kind 'pro', kód účtu v meta) a vlastník žádost vyřídí v
// konzoli Lidé a prodej → Žádosti (js/prodej-konzole.js), kde účtu Pro zapne.
// Koupě (js/pro-koupe.js) zůstává v kódu a ukáže se SAMA, jakmile vlastník
// na serveru nastaví PRODEJ_IBAN (prodej.zapnuto v agProdej_v1).
//
// Odstranění: smaž tenhle soubor + řádek <script type="ag/lazy"> v index.html
// + './js/pro-karta.js' v sw.js. Karta pak zůstane prázdná skořápka s názvem.
// ================================================================================
(function () {
    'use strict';
    if (window.AGProKarta) return;

    var STYLE_ID = 'ag-pro-karta-style';
    var LS_ZADOST = 'agProZadost_v1';
    var API_FALLBACK = 'https://ar-geodet-api.ar-geodet.workers.dev';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'pro-karta:' + kde); } catch (x) { } }
    function esc(s) {
        if (window.AG && AG.esc) return AG.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function maPro() { try { return !!(window.AGLic && AGLic.isPro()); } catch (e) { return false; } }
    function jeZaklad() { try { return !!(window.AGLic && AGLic.vydani && AGLic.vydani() === 'zaklad'); } catch (e) { return false; } }
    function stavLic() { try { return (window.AGLic && AGLic.stav && AGLic.stav()) || { pro: false }; } catch (e) { return { pro: false }; } }
    function ucet() { try { return (window.AGUcty && AGUcty.ucet && AGUcty.ucet()) || null; } catch (e) { return null; } }
    function apiBase() {
        try {
            if (window.AGUcty && typeof AGUcty.apiUrl === 'function') return AGUcty.apiUrl();
            if (window.AGUcty && AGUcty.DEFAULT_API) return AGUcty.DEFAULT_API;
        } catch (e) { swallow(e, 'apiBase'); }
        return API_FALLBACK;
    }
    function prodej() {
        try { return (JSON.parse(localStorage.getItem('agProdej_v1') || 'null') || {}).prodej || null; }
        catch (e) { return null; }
    }
    function prodejZapnuty() { var p = prodej(); return !!(p && p.zapnuto); }
    // Tichá obnova ceníku: „Koupit" se má objevit SAMO, jakmile vlastník na serveru
    // nastaví PRODEJ_IBAN — do té doby je tu jen „Požádat o Pro". Táž cesta a týž
    // tvar cache jako v js/pro-koupe.js (agProdej_v1), aby si obě vrstvy rozuměly.
    // Nejvýš jednou za hodinu, jen s tokenem a připojením; výsledek překreslí tlačítka.
    var _obnovaTs = 0;
    function obnovProdej(m, opts) {
        try {
            if (!(window.AGUcty && AGUcty.cloudFetch && AGUcty.hasToken && AGUcty.hasToken())) return;
            if (navigator.onLine === false) return;
            var c = null;
            try { c = JSON.parse(localStorage.getItem('agProdej_v1') || 'null'); } catch (e) { c = null; }
            var ted = Date.now();
            if (ted - _obnovaTs < 36e5) return;
            if (c && c.ts && ted - c.ts < 36e5) return;
            _obnovaTs = ted;
            AGUcty.cloudFetch('/objednavky/moje').then(function (r) {
                if (!(r.ok && r.data && r.data.prodej)) return;
                var byl = prodejZapnuty();
                try { localStorage.setItem('agProdej_v1', JSON.stringify({ prodej: r.data.prodej, objednavky: r.data.objednavky || [], ts: Date.now() })); } catch (e) { swallow(e, 'cache'); }
                if (byl !== prodejZapnuty() && m.classList.contains('on') && m._agOpts === opts && !m.querySelector('.agp-form')) render(m, opts);
            });
        } catch (e) { swallow(e, 'obnovProdej'); }
    }
    function jeTwa() { try { return !!(window.AGProZamky && AGProZamky.jeTwa && AGProZamky.jeTwa()); } catch (e) { return false; } }
    function zadostKdy() { try { return parseInt(localStorage.getItem(LS_ZADOST), 10) || 0; } catch (e) { return 0; } }

    // ---- ikony (inline SVG, ať se obarví podle motivu) ------------------------------------
    var I = {
        lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
        open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
        x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
        doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
        cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 8 4.5v11L12 22l-8-4.5v-11z"/><path d="M12 22V12M4 6.5l8 5.5 8-5.5"/></svg>',
        target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
        map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
        firm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
        send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>',
        key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M15 5l3 3M18 8l3-3"/></svg>'
    };

    // Co je v Pro — pět skupin, každá s ikonou. Stejný obsah jako dřív, jen jako
    // karty místo odrážek; přehled po nástrojích má „Co je v Pro" (js/pro-prehled.js).
    var SKUPINY = [
        { i: 'doc', t: 'Protokoly a papíry', p: 'vytyčení, kvalita bodu, deník, zápis dne' },
        { i: 'cube', t: 'Objemy a vrstvy', p: 'kubatury, DMT, kontrola pokládky' },
        { i: 'target', t: 'Přesné určení bodu', p: 'protínání, resekce, volné stanovisko, Helmert' },
        { i: 'map', t: 'Katastr a podklady', p: 'do mapy i do AR, dělení parcel, vlastní podklad' },
        { i: 'firm', t: 'Firma', p: 'účty, docházka, vysílačka, kniha jízd, přenosy' }
    ];

    // ---- vzhled ------------------------------------------------------------------------------
    function styly() {
        if (document.getElementById(STYLE_ID)) return;
        var M = '#ag-pro-modal';
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // skořápka z pro-zamky.js se tady přebíjí na celou obrazovku
            M + '{position:fixed;inset:0;z-index:100060;display:none;padding:0;background:var(--bg,#0d1117);',
            '  color:var(--text-color,#e9eef7);}',
            M + '.on{display:flex;flex-direction:column;}',
            M + ' .agp-box{width:100%;max-width:none;max-height:none;height:100%;border-radius:0;padding:0;border:0;',
            '  box-shadow:none;background:transparent;display:flex;flex-direction:column;overflow:hidden;}',
            'body.light-mode ' + M + '{background:#f5f7fa;color:#16202e;}',
            // horní lišta: štítek + křížek (jen křížek — žádné sbalení do pilulky,
            // zamčený nástroj se nemá kam sbalit)
            M + ' .agp-top{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;',
            '  padding:calc(10px + env(safe-area-inset-top,0px)) 10px 6px 18px;}',
            M + ' .agp-kicker{display:inline-flex;align-items:center;gap:7px;font:700 11.5px/1 var(--font-ui,system-ui);',
            '  letter-spacing:.14em;text-transform:uppercase;color:#e6bd76;}',
            M + ' .agp-kicker::before{content:"";width:8px;height:8px;border-radius:50%;background:#e6bd76;box-shadow:0 0 10px #e6bd76;}',
            M + ' .agp-x{width:44px;height:44px;border-radius:50%;border:1px solid var(--glass-border,rgba(255,255,255,.14));',
            '  background:var(--glass-bg,rgba(255,255,255,.06));color:inherit;display:flex;align-items:center;justify-content:center;',
            '  cursor:pointer;padding:0;}',
            M + ' .agp-x svg{width:20px;height:20px;}',
            // tělo roluje, tlačítka dole stojí
            M + ' .agp-scroll{flex:1 1 auto;overflow:auto;-webkit-overflow-scrolling:touch;padding:4px 18px 18px;}',
            M + ' .agp-hero{text-align:center;padding:10px 0 18px;}',
            M + ' .agp-badge{width:76px;height:76px;margin:0 auto 14px;border-radius:24px;display:flex;align-items:center;justify-content:center;',
            '  background:linear-gradient(150deg,rgba(230,189,118,.28),rgba(230,189,118,.06));border:1px solid rgba(230,189,118,.45);color:#e6bd76;',
            '  box-shadow:0 12px 34px rgba(230,189,118,.16);}',
            M + ' .agp-badge svg{width:36px;height:36px;}',
            M + ' .agp-badge.open{background:linear-gradient(150deg,rgba(63,188,140,.28),rgba(63,188,140,.06));border-color:rgba(63,188,140,.5);color:#3fbc8c;',
            '  box-shadow:0 12px 34px rgba(63,188,140,.16);}',
            M + ' .agp-title{margin:0;font:700 calc(24px * var(--ag-font-scale,1))/1.2 var(--font-ui,system-ui);letter-spacing:-.01em;}',
            M + ' .agp-sub{margin:8px 0 0;opacity:.78;font-size:calc(14px * var(--ag-font-scale,1));line-height:1.5;}',
            M + ' .agp-stav{display:inline-flex;align-items:center;gap:7px;margin-top:14px;padding:7px 13px;border-radius:999px;',
            '  font:600 calc(12.5px * var(--ag-font-scale,1))/1 var(--font-ui,system-ui);',
            '  background:rgba(230,189,118,.14);color:#e6bd76;border:1px solid rgba(230,189,118,.35);}',
            M + ' .agp-stav.open{background:rgba(63,188,140,.14);color:#3fbc8c;border-color:rgba(63,188,140,.4);}',
            M + ' .agp-stav svg{width:14px;height:14px;}',
            M + ' .agp-lbl{margin:6px 0 9px;font:700 11.5px/1 var(--font-ui,system-ui);letter-spacing:.12em;text-transform:uppercase;opacity:.55;}',
            M + ' .agp-feat{display:grid;grid-template-columns:1fr;gap:8px;}',
            '@media (min-width:640px){' + M + ' .agp-feat{grid-template-columns:1fr 1fr;}' + M + ' .agp-scroll{max-width:720px;margin:0 auto;width:100%;box-sizing:border-box;}' + M + ' .agp-acts{max-width:720px;margin:0 auto;width:100%;box-sizing:border-box;}}',
            M + ' .agp-f{display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:14px;',
            '  background:var(--glass-bg,rgba(255,255,255,.05));border:1px solid var(--glass-border,rgba(255,255,255,.1));}',
            'body.light-mode ' + M + ' .agp-f{background:#fff;}',
            M + ' .agp-f .ic{flex:0 0 38px;width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;',
            '  background:rgba(230,189,118,.12);color:#e6bd76;}',
            M + ' .agp-f.open .ic{background:rgba(63,188,140,.12);color:#3fbc8c;}',
            M + ' .agp-f .ic svg{width:20px;height:20px;}',
            M + ' .agp-f b{display:block;font-size:calc(14px * var(--ag-font-scale,1));}',
            M + ' .agp-f small{display:block;opacity:.7;font-size:calc(12.5px * var(--ag-font-scale,1));line-height:1.4;margin-top:2px;}',
            M + ' .agp-f .ok{margin-left:auto;color:#3fbc8c;flex:0 0 18px;}',
            M + ' .agp-f .ok svg{width:18px;height:18px;}',
            // klíč — sbalený pod odkazem, ať nepřekáží těm, kdo žádný nemají
            M + ' .agp-key{margin-top:16px;}',
            M + ' .agp-key summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:11px 13px;border-radius:12px;',
            '  border:1px dashed var(--glass-border,rgba(255,255,255,.2));font-size:calc(13.5px * var(--ag-font-scale,1));opacity:.85;}',
            M + ' .agp-key summary::-webkit-details-marker{display:none;}',
            M + ' .agp-key summary svg{width:17px;height:17px;flex:0 0 auto;}',
            M + ' .agp-key[open] summary{border-style:solid;border-bottom-left-radius:0;border-bottom-right-radius:0;}',
            M + ' .agp-keybox{padding:12px 13px 13px;border:1px solid var(--glass-border,rgba(255,255,255,.2));border-top:0;border-radius:0 0 12px 12px;}',
            M + ' input,' + M + ' textarea{width:100%;box-sizing:border-box;padding:12px;border-radius:11px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,.16));background:rgba(0,0,0,.18);',
            '  color:inherit;font:inherit;font-size:calc(15px * var(--ag-font-scale,1));}',
            M + ' input#agp-klic{letter-spacing:.08em;text-transform:uppercase;}',
            'body.light-mode ' + M + ' input,body.light-mode ' + M + ' textarea{background:#fff;}',
            M + ' label{display:block;margin:10px 0 5px;font-size:calc(12.5px * var(--ag-font-scale,1));opacity:.8;}',
            M + ' .agp-hl{margin:8px 0 0;min-height:17px;font-size:calc(12.5px * var(--ag-font-scale,1));}',
            M + ' .agp-hl.bad{color:#e2685f;}',
            M + ' .agp-hl.ok{color:#3fbc8c;}',
            // tlačítka dole
            M + ' .agp-acts{flex:0 0 auto;display:flex;flex-direction:column;gap:9px;padding:12px 18px calc(14px + env(safe-area-inset-bottom,0px));',
            '  border-top:1px solid var(--glass-border,rgba(255,255,255,.1));background:var(--bg,#0d1117);}',
            'body.light-mode ' + M + ' .agp-acts{background:#f5f7fa;}',
            M + ' .agp-acts button,' + M + ' .agp-keybox button{width:100%;padding:14px;border-radius:13px;font:inherit;font-weight:700;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,.16));background:transparent;color:inherit;',
            '  display:flex;align-items:center;justify-content:center;gap:9px;font-size:calc(15px * var(--ag-font-scale,1));}',
            M + ' .agp-acts button svg,' + M + ' .agp-keybox button svg{width:18px;height:18px;}',
            M + ' .agp-acts button.hlavni,' + M + ' .agp-keybox button.hlavni{background:#e6bd76;border-color:transparent;color:#1a1408;}',
            M + ' .agp-acts button.zel{background:#3fbc8c;border-color:transparent;color:#fff;}',
            M + ' .agp-acts button[disabled]{opacity:.5;cursor:default;}',
            M + ' .agp-pozn{margin:9px 0 0;opacity:.65;line-height:1.45;font-size:calc(12px * var(--ag-font-scale,1));text-align:center;}',
            // formulář žádosti
            M + ' .agp-form p{margin:0 0 8px;opacity:.8;line-height:1.5;font-size:calc(14px * var(--ag-font-scale,1));}',
            M + ' textarea{min-height:110px;resize:vertical;}',
            M + ' .agp-done{text-align:center;padding:26px 8px;}',
            // světlý motiv: zlatá #e6bd76 na světlém podkladu nemá kontrast — tmavší odstín
            'body.light-mode ' + M + ' .agp-kicker,body.light-mode ' + M + ' .agp-kicker::before{color:#9a6d18;background-color:#9a6d18;}',
            'body.light-mode ' + M + ' .agp-kicker{background:none;}',
            'body.light-mode ' + M + ' .agp-badge{color:#9a6d18;border-color:rgba(154,109,24,.45);background:linear-gradient(150deg,rgba(230,189,118,.45),rgba(230,189,118,.12));}',
            'body.light-mode ' + M + ' .agp-stav{color:#8a5f12;background:rgba(230,189,118,.28);border-color:rgba(154,109,24,.4);}',
            'body.light-mode ' + M + ' .agp-f .ic{color:#9a6d18;background:rgba(230,189,118,.28);}',
            'body.light-mode ' + M + ' .agp-badge.open{color:#1f8c66;}',
            'body.light-mode ' + M + ' .agp-stav.open{color:#1f8c66;}',
            M + ' .agp-done .agp-badge{margin-bottom:16px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- části obrazovky ---------------------------------------------------------------------
    function hero(opts) {
        var s = stavLic(), pro = !!s.pro;
        var badge = '<div class="agp-badge' + (pro ? ' open' : '') + '">' + (pro ? I.open : I.lock) + '</div>';
        var title, sub, pill;
        if (opts.k) {
            var r = (window.AGReg && AGReg.get(opts.k)) || {};
            title = (r.help && r.help.t) || r.vl || opts.k;
            sub = r.vl || '';
            if (r.vh) sub += (sub ? ' — ' : '') + r.vh;
            if (!sub) sub = 'Nástroj z verze Pro.';
            pill = pro ? 'Odemčeno' : 'Nástroj z verze Pro';
        } else {
            title = 'Verze Pro';
            if (!pro) { sub = 'Základ umí celý den v terénu. Pro přidává navrch tohle:'; pill = 'Máš Základ'; }
            else {
                sub = s.zdroj === 'vlastnik' ? 'Režim vlastníka aplikace — všechno je odemčené.'
                    : (s.zdroj === 'ucet'
                        ? ('Pro máš v účtu' + (s.do ? (' — platí ještě ' + s.dniDoKonce + ' dní.') : ', platí natrvalo.'))
                        : ('Klíč č. ' + s.cislo + (s.do ? (' — platí ještě ' + s.dniDoKonce + ' dní.') : ', platí natrvalo.')));
                pill = 'Odemčeno';
            }
        }
        return '<div class="agp-hero">' + badge +
            '<h2 class="agp-title">' + esc(title) + '</h2>' +
            '<p class="agp-sub">' + esc(sub) + '</p>' +
            '<span class="agp-stav' + (pro ? ' open' : '') + '">' + (pro ? I.check : I.lock) + esc(pill) + '</span>' +
            '</div>';
    }
    function skupiny(pro) {
        return '<div class="agp-lbl">' + (pro ? 'Máš k dispozici' : 'Co je ve verzi Pro') + '</div>' +
            '<div class="agp-feat">' + SKUPINY.map(function (g) {
                return '<div class="agp-f' + (pro ? ' open' : '') + '"><span class="ic">' + I[g.i] + '</span>' +
                    '<span><b>' + esc(g.t) + '</b><small>' + esc(g.p) + '</small></span>' +
                    (pro ? '<span class="ok">' + I.check + '</span>' : '') + '</div>';
            }).join('') + '</div>';
    }
    function klicBlok() {
        return '<details class="agp-key"><summary>' + I.key + ' Mám klíč Pro — opsat ho sem (funguje i bez signálu)</summary>' +
            '<div class="agp-keybox">' +
            '<input id="agp-klic" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ARG-0000-0000-0000-0000">' +
            '<p class="agp-hl"></p>' +
            '<button type="button" class="hlavni agp-ok" style="margin-top:10px;">Odemknout klíčem</button>' +
            '</div></details>';
    }
    function tlacitka(opts) {
        var s = stavLic(), pro = !!s.pro, h = [];
        var zapnuty = prodejZapnuty() && !jeTwa();
        if (!pro) {
            if (zapnuty) {
                var z = prodej().zkouska;
                h.push('<button type="button" class="hlavni agp-koupit">' + I.send + ' ' +
                    ((z && z.dni && !z.pouzita) ? ('Vyzkoušet ' + z.dni + ' dny zdarma / koupit') : 'Koupit Pro') + '</button>');
            }
            var kdy = zadostKdy();
            h.push('<button type="button" class="' + (zapnuty ? '' : 'hlavni') + ' agp-zadost">' + I.send + ' ' +
                (kdy ? 'Žádost už odešla · poslat znovu' : 'Požádat o Pro') + '</button>');
            if (kdy) h.push('<p class="agp-pozn">Žádost odeslána ' + esc(new Date(kdy).toLocaleDateString('cs-CZ')) + '. Až ti vlastník Pro zapne, appka to pozná sama do minuty — případně ji zavři a otevři.</p>');
        } else if (zapnuty && s.zdroj === 'ucet' && s.do) {
            h.push('<button type="button" class="hlavni agp-koupit">Prodloužit Pro</button>');
        }
        if (jeZaklad() && pro) {
            h.push('<button type="button" class="zel agp-otevri">Otevřít verzi Pro</button>');
            h.push('<p class="agp-pozn">Pro bydlí na téže adrese pod <b>/pro/</b>. Zakázky, body i klíč tam máš rovnou — nic se nepřenáší ručně.</p>');
        }
        return h.length ? '<div class="agp-acts">' + h.join('') + '</div>' : '<div class="agp-acts" hidden></div>';
    }

    function nazevNastroje(k) {
        var r = (window.AGReg && AGReg.get(k)) || {};
        return (r.help && r.help.t) || r.vl || k;
    }

    // ---- žádost o Pro ------------------------------------------------------------------------
    function formZadosti(m, opts) {
        var u = ucet() || {};
        var box = m.querySelector('.agp-scroll');
        var acts = m.querySelector('.agp-acts');
        box.innerHTML =
            '<div class="agp-hero"><div class="agp-badge">' + I.send + '</div>' +
            '<h2 class="agp-title">Požádat o Pro</h2>' +
            '<p class="agp-sub">Pro se nezapíná samo — zapne ti ho autor appky. Napiš mu, kdo jsi a na co Pro potřebuješ; kód tvého účtu jde s žádostí.</p></div>' +
            '<div class="agp-form">' +
            '<label for="agp-z-jm">Jméno / firma</label>' +
            '<input id="agp-z-jm" type="text" maxlength="80" autocomplete="name" value="' + esc(u.name || '') + '">' +
            '<label for="agp-z-kon">Kontakt (telefon nebo e-mail — ať se ti dá ozvat)</label>' +
            '<input id="agp-z-kon" type="text" maxlength="120" autocomplete="email">' +
            '<label for="agp-z-tx">Zpráva</label>' +
            '<textarea id="agp-z-tx" maxlength="1500" placeholder="Např. měřím pro firmu XY, potřebuju protokoly a katastr…">' +
            esc(opts.k ? ('Chtěl bych otevřít Pro — potřebuju hlavně: ' + nazevNastroje(opts.k) + '.') : '') + '</textarea>' +
            '<p class="agp-hl" id="agp-z-hl"></p>' +
            '<p class="agp-pozn" style="text-align:left;">Účet: <b>' + esc(u.code || 'bez účtu') + '</b>' + (u.name ? ' (' + esc(u.name) + ')' : '') +
            '. Zpráva jde do schránky autora, nikam jinam.</p>' +
            '</div>';
        acts.hidden = false;
        acts.innerHTML =
            '<button type="button" class="hlavni agp-z-poslat">' + I.send + ' Odeslat žádost</button>' +
            '<button type="button" class="agp-z-zpet">Zpět</button>';
        box.scrollTop = 0;
        acts.querySelector('.agp-z-zpet').addEventListener('click', function () { render(m, opts); });
        acts.querySelector('.agp-z-poslat').addEventListener('click', function () { poslatZadost(m, opts); });
        try { m.querySelector('#agp-z-kon').focus(); } catch (e) { swallow(e, 'focus'); }
    }
    function poslatZadost(m, opts) {
        var hl = m.querySelector('#agp-z-hl'), btn = m.querySelector('.agp-z-poslat');
        var jm = (m.querySelector('#agp-z-jm').value || '').trim();
        var kon = (m.querySelector('#agp-z-kon').value || '').trim();
        var tx = (m.querySelector('#agp-z-tx').value || '').trim();
        hl.className = 'agp-hl';
        if (!kon) { hl.className = 'agp-hl bad'; hl.textContent = 'Napiš kontakt — jinak se ti autor nemá jak ozvat.'; return; }
        if (!tx) { hl.className = 'agp-hl bad'; hl.textContent = 'Napiš aspoň větu, na co Pro potřebuješ.'; return; }
        var u = ucet() || {};
        var meta = { ucet: u.code || null, ucetId: u.id || null, nastroj: opts.k || null, zadost: 'pro' };
        try { meta.vydani = (window.AGLic && AGLic.vydani) ? AGLic.vydani() : null; } catch (e) { swallow(e, 'meta'); }
        try { meta.verze = window.__AG_VERZE || null; } catch (e) { swallow(e, 'meta'); }
        btn.disabled = true; hl.textContent = 'Odesílám…';
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var to = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) { swallow(e, 'abort'); } }, 15000) : null;
        var p;
        try {
            p = fetch(apiBase() + '/feedback', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: 'pro', txt: tx, contact: kon, who: (jm || u.name || '') + (u.code ? ' · ' + u.code : ''), meta: meta }),
                signal: ctrl ? ctrl.signal : undefined
            });
        } catch (e) { p = Promise.reject(e); }
        p.then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
            .catch(function () { return { ok: false, status: 0, data: null }; })
            .then(function (r) {
                if (to) clearTimeout(to);
                btn.disabled = false;
                if (!r.ok) {
                    hl.className = 'agp-hl bad';
                    hl.textContent = r.status === 0 ? 'Nepodařilo se odeslat — zkus to, až bude signál.'
                        : ((r.data && r.data.error) || ('Server odpověděl chybou ' + r.status + '.'));
                    return;
                }
                try { localStorage.setItem(LS_ZADOST, String(Date.now())); } catch (e) { swallow(e, 'ls'); }
                hotovo(m, opts);
            });
    }
    function hotovo(m, opts) {
        var box = m.querySelector('.agp-scroll'), acts = m.querySelector('.agp-acts');
        box.innerHTML = '<div class="agp-done"><div class="agp-badge open">' + I.check + '</div>' +
            '<h2 class="agp-title">Žádost odešla</h2>' +
            '<p class="agp-sub">Autor appky ji uvidí ve své konzoli a Pro ti zapne. Jakmile to udělá, appka to pozná sama (do minuty, s připojením) — ' +
            (jeZaklad() ? 'a nabídne ti otevřít verzi Pro.' : 'nástroje se odemknou.') + ' Kdyby ne, appku zavři a otevři znovu.</p></div>';
        acts.innerHTML = '<button type="button" class="hlavni agp-z-ok">Rozumím</button>';
        acts.querySelector('.agp-z-ok').addEventListener('click', function () { zavri(); });
    }

    // ---- klíč ----------------------------------------------------------------------------------
    function odemkni(m, opts) {
        var hl = m.querySelector('.agp-keybox .agp-hl'), inp = m.querySelector('#agp-klic');
        if (!hl || !inp) return;
        hl.className = 'agp-hl';
        if (!window.AGLic) { hl.className = 'agp-hl bad'; hl.textContent = 'Licence v téhle verzi appky není.'; return; }
        var r = AGLic.uloz(inp.value);
        if (r && r.ok) {
            hl.className = 'agp-hl ok';
            try { window.AGProZamky && AGProZamky.oznac && AGProZamky.oznac(); } catch (e) { swallow(e, 'oznac'); }
            if (jeZaklad()) {
                hl.textContent = 'Klíč platí. Pro nástroje jsou ale ve vydání Pro — otevři ho, klíč tam už bude.';
                setTimeout(function () { render(m, opts); }, 900);
                return;
            }
            hl.textContent = 'Hotovo — Pro je odemčené.';
            setTimeout(function () { render(m, opts); }, 900);
            return;
        }
        hl.className = 'agp-hl bad';
        hl.textContent = ({
            tvar: 'Klíč má mít 16 znaků ve tvaru ARG-0000-0000-0000-0000.',
            verze: 'Tenhle klíč je pro jinou verzi aplikace.',
            podpis: 'Klíč nesedí — zkontroluj, jestli není překlep.',
            vyprsel: 'Klíči vypršela platnost.'
        })[r && r.duvod] || 'Klíč nesedí.';
    }

    function zavri() { try { window.AGProZamky && AGProZamky.zavri ? AGProZamky.zavri() : document.getElementById('ag-pro-modal').classList.remove('on'); } catch (e) { swallow(e, 'zavri'); } }

    // ---- hlavní vykreslení ---------------------------------------------------------------------
    // `m` je skořápka #ag-pro-modal z js/pro-zamky.js; `opts` = { k: klíč nástroje }
    // nebo { prehled: true } (položka „Verze Pro" ve Více).
    function render(m, opts) {
        opts = opts || {};
        styly();
        var box = m.querySelector('.agp-box');
        if (!box) return;
        var pro = maPro();
        box.innerHTML =
            '<div class="agp-top"><span class="agp-kicker">QTRIG Pro</span>' +
            '<button type="button" class="agp-x" aria-label="Zavřít">' + I.x + '</button></div>' +
            '<div class="agp-scroll">' + hero(opts) + skupiny(pro) + (pro ? '' : klicBlok()) + '</div>' +
            tlacitka(opts);
        // Název drží pro-zamky.js v .agp-nazev (testy ho čtou hned po klepnutí) —
        // v novém rozvržení je to titulek karty.
        var nz = box.querySelector('.agp-title'); if (nz) nz.classList.add('agp-nazev');
        box.querySelector('.agp-x').addEventListener('click', zavri);
        var b;
        if ((b = box.querySelector('.agp-ok'))) b.addEventListener('click', function () { odemkni(m, opts); });
        if ((b = box.querySelector('#agp-klic'))) b.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); odemkni(m, opts); } });
        if ((b = box.querySelector('.agp-zadost'))) b.addEventListener('click', function () { formZadosti(m, opts); });
        if ((b = box.querySelector('.agp-koupit'))) b.addEventListener('click', function () { try { AGProZamky.koupit(); } catch (e) { swallow(e, 'koupit'); } });
        if ((b = box.querySelector('.agp-otevri'))) b.addEventListener('click', function () { try { window.location.href = './pro/'; } catch (e) { swallow(e, 'prechod'); } });
        if (!pro) obnovProdej(m, opts);
    }

    window.AGProKarta = { render: render, zadost: function () { var m = document.getElementById('ag-pro-modal'); if (m) formZadosti(m, {}); } };
    // Skořápka mohla být otevřená dřív, než tenhle soubor dojel — dokreslit.
    try {
        var m0 = document.getElementById('ag-pro-modal');
        if (m0 && m0.classList.contains('on') && m0._agOpts) render(m0, m0._agOpts);
    } catch (e) { swallow(e, 'dokresli'); }
})();
