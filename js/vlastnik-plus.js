// ===== QTRIG — VLASTNÍK PLUS (ODLOŽENÁ vrstva nad Konzolí vlastníka) ===========
// 12. 9. 2026: uživatel vybral na stránce „Návrhy pro vlastníka" 13 ze 14 návrhů.
// Tenhle modul nese ty, které patří do konzole (js/vlastnik.js ho volá přes
// AGVlastnikPlus.view / .dashboard / .items):
//   dnes       — Souhrn dne: dlaždice nahoře v konzoli (lidé, body, účty, žádosti,
//                zprávy, chyby za 24 h) + pohled „prehled" s detailem
//   badge      — tečka „něco čeká" na zlatých vstupech do konzole (tichý dotaz
//                GET /owner/prehled?lite=1 jednou za 5 minut, jen v režimu vlastníka)
//   online     — kdo je v terénu (aktivita < 10 min) + mapa shluků, kde se měřilo
//   audit      — Deník vlastníka (GET /owner/log)
//   kalendar   — komu Pro vyprší (z /owner/ucty), s prodloužením
//   zaloha     — záloha serveru (GET /owner/export → soubor)
//   ocima      — pohled očima účtu (GET /owner/ucty/:id/pohled), otevírá se z Lidí
//   export     — body firmy do CSV (z dat, která už má js/sprava-appky.js)
// 13. 9. 2026 (2. kolo, 13 návrhů z artefaktu „Konzole vlastníka II"): od-minula, hlídač
// anomálií, push, trychtýř, deník člověka, „jako Základ", kapacita, úklid, vydání s
// verzemi, grafy 7/30/90 + minulé období + CSV, počítač (CSS ve vlastnik.js), hledání
// (vlastnik.js) a odpověď do appky (zpetna-vazba.js).
// Ostatní schválené kusy bydlí tam, kam patří: 14denní zkouška a poznámka u účtu
// a vzkaz v js/prodej-konzole.js, vzkaz firmě a CSV v js/sprava-appky.js, verze
// chyb + Vypnout modul a filtr „jen Pro" přímo v js/vlastnik.js.
//
// Odstranění: smaž tenhle soubor + řádek <script type="ag/lazy"> v index.html
// + './js/vlastnik-plus.js' v sw.js. Konzole pak jen nemá tyhle položky.
// ================================================================================
(function () {
    'use strict';
    if (window.AGVlastnikPlus) return;

    var LS_KEY = 'agFbKey_v1';
    var API_FALLBACK = 'https://ar-geodet-api.ar-geodet.workers.dev';
    var _cache = null, _cacheTs = 0, _lite = null, _liteTs = 0, _log = null, _ucty = null, _pohled = null, _pohledId = null, _zaloha = null;

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'vlastnik-plus:' + kde); } catch (x) { } }
    function X() { return (window.AGVlastnik && AGVlastnik.ext) || null; }
    function esc(s) { var x = X(); return x ? x.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function api(path, opts) { var x = X(); return x ? x.api(path, null, (opts && opts.timeoutMs) || 20000, opts) : Promise.resolve({ ok: false, status: 0, data: null }); }
    function isOn() { try { return !!(window.AGVlastnik && AGVlastnik.isOn()); } catch (e) { return false; } }
    function jdi(v) { try { AGVlastnik.jdi(v); } catch (e) { swallow(e, 'jdi'); } }
    // ⚠ Odpověď serveru může dorazit, až když je otevřený JINÝ pohled — kreslit
    //   do něj by ho přepsalo (kalendář přepsal zálohu). Každý callback se ptá.
    function plati(v) { try { return X().view() === v; } catch (e) { return true; } }
    function datum(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleDateString('cs-CZ'); } catch (e) { return '—'; } }
    function cas(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } }
    function pred(ts) {
        if (!ts) return '—';
        var m = Math.round((Date.now() - ts) / 60000);
        if (m < 1) return 'právě teď'; if (m < 60) return 'před ' + m + ' min';
        var h = Math.round(m / 60); if (h < 48) return 'před ' + h + ' h';
        return 'před ' + Math.round(h / 24) + ' dny';
    }
    function dni(ts) { return Math.ceil((ts - Date.now()) / 864e5); }

    function styly() {
        if (document.getElementById('ag-vp-style')) return;
        var st = document.createElement('style'); st.id = 'ag-vp-style';
        st.textContent = [
            '.agvp-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 14px;}',
            // tlačítko Grafy pod dlaždicemi (13. 9. 2026: uživatel grafy v konzoli nenašel — byly jen jako
            // třetí dlaždice v seznamu; teď jsou hned pod čísly souhrnu i v Souhrnu dne)
            '.agvp-grafy{grid-column:1/-1;display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;margin:2px 0 4px;padding:10px 12px;border-radius:12px;cursor:pointer;',
            '  background:var(--agv-gold-soft,rgba(212,160,44,.12));border:1px solid var(--agv-gold-line,rgba(212,160,44,.4));color:var(--text-color,#e6e8eb);text-align:left;}',
            '.agvp-grafy svg{flex:none;width:22px;height:22px;stroke:var(--agv-gold,#d4a02c);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
            '.agvp-grafy b{display:block;font:700 13px/1.25 var(--font-ui,system-ui);color:var(--agv-gold,#d4a02c);}',
            '.agvp-grafy small{display:block;font:500 11px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.agvp-grafy .go{margin-left:auto;color:var(--agv-gold,#d4a02c);font-size:18px;}',
            // grafy (13. 9. 2026): sloupce po dnech ve zlaté konzole; osa = tenká linka, popisek max vlevo nahoře
            '.agvp-g{margin:0 0 14px;padding:10px 12px 8px;border-radius:12px;border:1px solid rgba(230,189,118,.22);background:rgba(0,0,0,.16);}',
            '.agvp-g b{display:block;font:700 13px/1.2 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '.agvp-g small{display:block;font:500 11px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:2px 0 6px;}',
            '.agvp-g svg{display:block;width:100%;height:auto;}',
            '.agvp-g .os{font:500 9.5px var(--font-mono,ui-monospace,monospace);fill:var(--text-muted,#9aa1ac);}',
            '.agvp-hb{display:flex;align-items:center;gap:8px;margin:4px 0;font:500 12px/1.3 var(--font-ui,system-ui);}',
            '.agvp-hb .l{flex:0 0 118px;color:var(--text-color,#e6e8eb);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.agvp-hb .b{flex:1;height:10px;border-radius:5px;background:rgba(230,189,118,.14);overflow:hidden;}',
            '.agvp-hb .b i{display:block;height:100%;background:#e6bd76;border-radius:5px;}',
            '.agvp-hb .n{flex:0 0 40px;text-align:right;font-family:var(--font-mono,ui-monospace,monospace);color:var(--text-muted,#9aa1ac);}',
            // hlášení pro vývoj (13. 9. 2026): jeden text ke zkopírování
            '.agvp-pre{white-space:pre-wrap;word-break:break-word;font:500 11.5px/1.45 var(--font-mono,ui-monospace,monospace);color:var(--text-color,#e6e8eb);background:rgba(0,0,0,.22);border:1px solid rgba(230,189,118,.22);border-radius:12px;padding:10px 12px;max-height:46vh;overflow:auto;margin:0 0 10px;}',
            '.agvp-btns{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px;}',
            '.agvp-btns .btn{flex:1;min-width:120px;margin:0;}',
            '.agvp-t{padding:10px 8px;border-radius:12px;background:var(--glass-bg,rgba(255,255,255,.05));border:1px solid var(--glass-border,rgba(255,255,255,.12));text-align:center;cursor:pointer;}',
            '.agvp-t b{display:block;font:700 calc(20px * var(--ag-font-scale,1))/1.1 var(--font-mono,ui-monospace,monospace);color:var(--text-color,#e6e8eb);}',
            '.agvp-t small{display:block;margin-top:3px;font:600 10.5px/1.2 var(--font-ui,system-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.agvp-t.warn{border-color:var(--agv-gold,#d4a02c);}.agvp-t.warn b{color:var(--agv-gold,#d4a02c);}',
            '.agvp-t.bad{border-color:#e2685f;}.agvp-t.bad b{color:#e2685f;}',
            '.agvp-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:11px;margin:0 0 6px;background:var(--glass-bg,rgba(255,255,255,.04));border:1px solid var(--glass-border,rgba(255,255,255,.1));font-size:calc(13px * var(--ag-font-scale,1));}',
            '.agvp-row .tx{flex:1;min-width:0;}.agvp-row .tx b{display:block;}.agvp-row .tx small{display:block;color:var(--text-muted,#9aa1ac);font-size:calc(11.5px * var(--ag-font-scale,1));}',
            '.agvp-row .r{flex:none;text-align:right;font-family:var(--font-mono,ui-monospace,monospace);font-size:calc(12px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);}',
            '.agvp-dot{width:8px;height:8px;border-radius:50%;background:#3fbc8c;flex:none;box-shadow:0 0 8px #3fbc8c;}',
            '.agvp-map{height:220px;border-radius:12px;overflow:hidden;border:1px solid var(--glass-border,rgba(255,255,255,.12));margin:8px 0 12px;background:#0b1015;}',
            '.agvp-log{padding:8px 10px;border-left:2px solid var(--glass-border,rgba(255,255,255,.2));margin:0 0 6px 4px;font-size:calc(12.5px * var(--ag-font-scale,1));}',
            '.agvp-log b{color:var(--accent,#2f9e74);}.agvp-log small{display:block;color:var(--text-muted,#9aa1ac);}',
            '.agvp-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--agv-gold,#d4a02c);color:#fff;font:700 11.5px/1 var(--font-ui,system-ui);margin-left:8px;vertical-align:middle;}',
            '.agvp-m{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px;}',
            '.agvp-m button{font:600 12px var(--font-ui,system-ui);padding:6px 10px;border-radius:999px;border:1px solid var(--glass-border,rgba(255,255,255,.16));background:transparent;color:inherit;cursor:pointer;}',
            '.agvp-m button.on{border-color:var(--accent,#2f9e74);color:var(--accent,#2f9e74);}',
            // od minula + hlídač (13. 9. 2026)
            '.agvp-od{margin:0 0 12px;padding:10px 12px;border-radius:12px;background:var(--glass-bg,rgba(255,255,255,.04));border:1px solid var(--glass-border,rgba(255,255,255,.12));}',
            '.agvp-od b{display:block;font:700 12.5px/1.3 var(--font-ui,system-ui);color:var(--agv-gold,#d4a02c);margin:0 0 5px;}',
            '.agvp-od .ch{display:flex;flex-wrap:wrap;gap:6px;}',
            '.agvp-od .ch button{font:600 12px var(--font-ui,system-ui);padding:6px 10px;border-radius:999px;border:1px solid var(--glass-border,rgba(255,255,255,.16));background:transparent;color:var(--text-color,#e6e8eb);cursor:pointer;}',
            '.agvp-od .ch button.w{border-color:var(--agv-gold,#d4a02c);color:var(--agv-gold,#d4a02c);}',
            '.agvp-od .ch button.z{opacity:.55;}',
            '.agvp-od small{display:block;margin-top:6px;font:500 11px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.agvp-al{display:flex;align-items:flex-start;gap:9px;margin:0 0 6px;padding:9px 11px;border-radius:11px;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;',
            '  background:rgba(224,87,74,.10);border:1px solid rgba(224,87,74,.45);color:var(--text-color,#e6e8eb);}',
            '.agvp-al.w{background:rgba(212,160,44,.10);border-color:rgba(212,160,44,.5);}',
            '.agvp-al i{flex:none;font:800 13px/1 var(--font-ui,system-ui);font-style:normal;color:#e0574a;margin-top:1px;}.agvp-al.w i{color:var(--agv-gold,#d4a02c);}',
            '.agvp-al b{display:block;font:700 12.5px/1.3 var(--font-ui,system-ui);}.agvp-al small{display:block;font:500 11px/1.35 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.agvp-alh{font:600 10.5px/1 var(--font-ui,system-ui);letter-spacing:.06em;text-transform:uppercase;color:#e0574a;margin:0 0 6px;}',
            // trychtýř, kapacita, deník člověka, push
            '.agvp-tr{display:flex;align-items:flex-end;gap:6px;margin:8px 0 10px;}',
            '.agvp-tr .k{flex:1;text-align:center;}',
            '.agvp-tr .k .b{margin:0 auto;width:100%;border-radius:8px 8px 3px 3px;background:#e6bd76;min-height:6px;}',
            '.agvp-tr .k b{display:block;font:700 18px/1.1 var(--font-mono,ui-monospace,monospace);color:var(--text-color,#e6e8eb);margin:6px 0 1px;}',
            '.agvp-tr .k small{display:block;font:600 10px/1.25 var(--font-ui,system-ui);letter-spacing:.03em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.agvp-tr .k em{display:block;font:500 10.5px/1.2 var(--font-mono,ui-monospace,monospace);font-style:normal;color:var(--agv-gold,#d4a02c);}',
            '.agvp-kb{margin:0 0 10px;}.agvp-kb .l{display:flex;justify-content:space-between;font:600 12px/1.3 var(--font-ui,system-ui);}',
            '.agvp-kb .l span:last-child{font-family:var(--font-mono,ui-monospace,monospace);color:var(--text-muted,#9aa1ac);}',
            '.agvp-kb .b{height:10px;border-radius:5px;background:rgba(230,189,118,.14);overflow:hidden;margin:4px 0 0;}.agvp-kb .b i{display:block;height:100%;background:#3fbc8c;border-radius:5px;}',
            '.agvp-kb .b i.w{background:#e6bd76;}.agvp-kb .b i.bad{background:#e0574a;}',
            '.agvp-den{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,.08));font:500 12.5px/1.4 var(--font-ui,system-ui);}',
            '.agvp-den .d{flex:0 0 68px;font-family:var(--font-mono,ui-monospace,monospace);color:var(--text-muted,#9aa1ac);}',
            '.agvp-den .t{flex:1;min-width:0;}.agvp-den .t small{display:block;color:var(--text-muted,#9aa1ac);font-size:11px;}',
            '.agvp-den.klid .t{color:var(--text-muted,#9aa1ac);}.agvp-den .ch{color:#e0574a;}',
            '.agvp-sw{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,.08));font:500 13px/1.3 var(--font-ui,system-ui);}',
            '.agvp-sw input{width:20px;height:20px;margin:0;flex:none;}',
            '.agvp-min{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px;}.agvp-min .agv-b.on{border-color:var(--agv-gold,#d4a02c);color:var(--agv-gold,#d4a02c);}',
            '.agvp-star{grid-column:1/-1;font:500 11px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:-4px 0 6px;}',
            '.agvp-star b{color:var(--agv-gold,#d4a02c);}',
            '#ag-zaklad-chip{position:fixed;left:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);z-index:100060;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;',
            '  background:#1b1913;border:1px solid #e6bd76;color:#e6bd76;font:600 12px/1 var(--font-ui,system-ui);box-shadow:0 4px 16px rgba(0,0,0,.4);}',
            '#ag-zaklad-chip button{border:0;background:#e6bd76;color:#1b1406;border-radius:999px;padding:5px 9px;font:700 11px/1 var(--font-ui,system-ui);cursor:pointer;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- data ------------------------------------------------------------------------------
    // okno souhrnu: 24 h (výchozí), 3 dny, nebo „od minula" (ts poslední návštěvy)
    var _okno = 24, _cacheOkno = 24;
    function oknoOd() { if (_okno === 'minule') return posledniNavsteva() || (Date.now() - 864e5); return Date.now() - _okno * 3600e3; }
    function nactiPrehled(cb, vynut) {
        if (!vynut && _cache && _cacheOkno === _okno && Date.now() - _cacheTs < 60000) return cb(_cache);
        var od = oknoOd();
        api('/owner/prehled' + (_okno === 24 ? '' : '?od=' + Math.round(od))).then(function (r) {
            if (r.ok && r.data) { _cache = r.data; _cacheTs = Date.now(); _cacheOkno = _okno; cb(_cache); }
            else cb(null, r, _cache);   // třetí argument: poslední známá data (při výpadku se ukážou se štítkem)
        });
    }
    // Poslední návštěva konzole (návrh „od minula"): návštěva = otevření konzole s odstupem
    // ≥ 30 min od předchozího; kratší odstupy se počítají jako táž návštěva.
    var LS_NAV = 'agvNavsteva_v1';
    function posledniNavsteva() { try { var o = JSON.parse(localStorage.getItem(LS_NAV) || 'null'); return o && o.posl ? +o.posl : 0; } catch (e) { return 0; } }
    function zapisNavstevu() {
        try {
            var o = JSON.parse(localStorage.getItem(LS_NAV) || 'null') || {};
            var ted = Date.now();
            if (!o.ted || ted - o.ted > 30 * 60000) { o.posl = o.ted || 0; }
            o.ted = ted;
            localStorage.setItem(LS_NAV, JSON.stringify(o));
        } catch (e) { swallow(e, 'navsteva'); }
    }
    // Hlídač anomálií: porovná dnešek s posledními 14 dny (grafy) a ukáže jen výkyvy.
    var _g14 = null, _g14Ts = 0;
    function nactiG14(cb) {
        if (_g14 && Date.now() - _g14Ts < 10 * 60000) return cb(_g14);
        api('/owner/grafy?dni=14').then(function (r) { if (r.ok && r.data) { _g14 = r.data; _g14Ts = Date.now(); } cb(_g14); });
    }
    var PRAHY = { chybyKrat: 3, chybyMin: 5, ucetChyb: 20, bezBoduDni: 3, dotazyPodil: 0.7 };
    function anomalie(d, g) {
        var out = [];
        if (!d) return out;
        var prum = 0;
        if (g && g.chyby) { var sum = 0; g.chyby.forEach(function (r) { sum += +r.n || 0; }); prum = sum / 14; }
        if (d.chyby24 >= PRAHY.chybyMin && prum > 0 && d.chyby24 > PRAHY.chybyKrat * prum)
            out.push({ w: 0, t: 'Chyby dnes ' + d.chyby24 + ' — průměr ' + Math.round(prum) + ' za den', s: (d.topChyba && d.topChyba.msg ? 'nejčastěji: ' + String(d.topChyba.msg).slice(0, 80) : ''), go: 'errors' });
        if (d.chybyUcty && d.chybyUcty[0] && d.chybyUcty[0].n >= PRAHY.ucetChyb)
            out.push({ w: 1, t: d.chybyUcty[0].n + '× chyba u jednoho člověka: ' + (d.chybyUcty[0].uname || '?') + (d.chybyUcty[0].ver ? ' (' + d.chybyUcty[0].ver + ')' : ''), s: 'zacyklená smyčka, nebo rozbitý telefon — koukni na Deník člověka', go: 'errors' });
        if (g && g.body && g.body.length && d.poslBod && Date.now() - d.poslBod > PRAHY.bezBoduDni * 864e5)
            out.push({ w: 1, t: 'Od ' + datum(d.poslBod) + ' nikdo nesynchronizoval body', s: 'za 14 dní přitom chodily — vypadla synchronizace, nebo nikdo neměří?', go: 'prehled' });
        if (d.dotazyDnes > PRAHY.dotazyPodil * 100000)
            out.push({ w: 0, t: 'Server dnes: ' + d.dotazyDnes + ' požadavků ze 100 000 zdarma', s: 'při překročení Cloudflare přestane do půlnoci odpovídat', go: 'kapacita' });
        return out;
    }

    // ---- SOUHRN DNE: dlaždice nahoře v konzoli ----------------------------------------------
    function dashboard(b) {
        if (!b || b.querySelector('.agvp-tiles')) return;
        styly();
        var hd = b.querySelector('.agv-hd'); if (!hd) return;
        zapisNavstevu();
        var posl = posledniNavsteva();
        var od = document.createElement('div'); od.className = 'agvp-od';
        od.innerHTML = '<b>' + (posl ? 'Od tvé poslední návštěvy (' + esc(cas(posl)) + ')' : 'Za posledních 24 hodin') + '</b><small>načítám…</small>';
        var al = document.createElement('div'); al.className = 'agvp-alerts';
        var box = document.createElement('div'); box.className = 'agvp-tiles';
        box.innerHTML = '<div class="agvp-t"><b>…</b><small>načítám</small></div>';
        hd.parentNode.insertBefore(od, hd.nextSibling);
        hd.parentNode.insertBefore(al, od.nextSibling);
        hd.parentNode.insertBefore(box, al.nextSibling);
        // „od minula" = vlastní dotaz s ?od=, dlaždice zůstávají za 24 h
        var odFn = function (d) {
            if (!od.isConnected) return;
            if (!d) { od.innerHTML = '<b>Od tvé poslední návštěvy</b><small>nenačteno</small>'; return; }
            var ch = [];
            var chip = function (n, txt, go, w) { return '<button type="button" class="' + (n ? (w ? 'w' : '') : 'z') + '" data-go="' + go + '">' + n + ' ' + txt + '</button>'; };
            var nl = (d.noviLide || []).length;
            ch.push(chip(nl, nl === 1 ? 'nový člověk' : (nl >= 2 && nl <= 4 ? 'noví lidé' : 'nových lidí'), 'lide', nl > 0));
            ch.push(chip(d.zpravyOd || 0, (d.zpravyOd === 1 ? 'zpráva' : (d.zpravyOd >= 2 && d.zpravyOd <= 4 ? 'zprávy' : 'zpráv')), 'zpravy', d.zpravyOd > 0));
            ch.push(chip(d.zadostiOd || 0, (d.zadostiOd === 1 ? 'žádost o Pro' : 'žádostí o Pro'), 'zadosti', d.zadostiOd > 0));
            ch.push(chip(d.chyby24 || 0, 'chyb' + (d.noveDruhy ? ' (' + d.noveDruhy + ' nové druhy)' : ''), 'errors', d.noveDruhy > 0));
            var kdo = (d.noviLide || []).slice(0, 4).map(function (u) { return esc(u.name || u.code) + (u.ver ? ' (' + esc(u.ver) + ')' : ''); }).join(', ');
            od.innerHTML = '<b>' + (posl ? 'Od tvé poslední návštěvy (' + esc(cas(posl)) + ')' : 'Za posledních 24 hodin') + '</b><div class="ch">' + ch.join('') + '</div>' +
                ((kdo || (d.topChyba && d.topChyba.msg)) ? '<small>' + (kdo ? 'Kdo: ' + kdo : '') + (kdo && d.topChyba && d.topChyba.msg ? ' · ' : '') + (d.topChyba && d.topChyba.msg ? 'nejvíc padá: „' + esc(String(d.topChyba.msg).slice(0, 60)) + '" ' + (d.topChyba.n || 0) + '×' : '') + '</small>' : '');
            Array.prototype.forEach.call(od.querySelectorAll('[data-go]'), function (el) { el.addEventListener('click', function () { otevri(el.getAttribute('data-go')); }); });
        };
        if (posl) api('/owner/prehled?od=' + Math.round(posl)).then(function (r) { odFn(r.ok ? r.data : null); });
        nactiPrehled(function (d, r, stare) {
            if (!box.isConnected) return;
            if (!posl) odFn(d);
            if (!d && stare) { d = stare; }   // výpadek: poslední známá data + štítek
            if (!d) { box.innerHTML = '<div class="agvp-t" style="grid-column:1/-1;"><small>souhrn se nenačetl' + (r && r.status ? ' (' + r.status + ')' : '') + '</small></div>'; return; }
            nactiG14(function (g) {
                if (!al.isConnected) return;
                var an = anomalie(d, g);
                if (!an.length) { al.innerHTML = ''; return; }
                al.innerHTML = '<div class="agvp-alh">Hlídač: tohle není normální</div>' + an.map(function (a) {
                    return '<button type="button" class="agvp-al' + (a.w ? ' w' : '') + '" data-go="' + a.go + '"><i>▲</i><span><b>' + esc(a.t) + '</b>' + (a.s ? '<small>' + esc(a.s) + '</small>' : '') + '</span></button>';
                }).join('');
                Array.prototype.forEach.call(al.querySelectorAll('[data-go]'), function (el) { el.addEventListener('click', function () { otevri(el.getAttribute('data-go')); }); });
            });
            var vyp7 = (d.vyprsi || []).filter(function (u) { return dni(u.tarif_do) <= 7; }).length;
            box.innerHTML = (stare && !r ? '' : '') +
                tile(d.lidi24, 'lidí za 24 h', 'prehled') + tile(d.body24, 'bodů za 24 h', 'prehled') + tile((d.online || []).length, 'v terénu teď', 'prehled', (d.online || []).length ? 'ok' : '') +
                tile(d.zadosti, 'žádostí o Pro', 'zadosti', d.zadosti ? 'warn' : '') + tile(d.zpravy, 'zpráv čeká', 'zpravy', d.zpravy ? 'warn' : '') + tile(d.chyby24, 'chyb za 24 h', 'errors', d.chyby24 ? 'bad' : '') +
                (vyp7 ? tile(vyp7, 'Pro končí brzy', 'kalendar', 'warn') : '') + (d.ucty24 ? tile(d.ucty24, 'nových účtů', 'lide') : '')
                + grafyBtn('7 / 30 / 90 dní po dnech: lidé, akce, body, chyby, verze, nástroje')
                + (stare && d === stare ? '<div class="agvp-star" style="grid-column:1/-1;">⚠ Server teď neodpověděl — čísla jsou <b>z ' + esc(cas(_cacheTs)) + '</b>.</div>' : '');
            Array.prototype.forEach.call(box.querySelectorAll('[data-go]'), function (el) {
                el.addEventListener('click', function () { otevri(el.getAttribute('data-go')); });
            });
        });
    }
    function grafyBtn(txt) {
        return '<button type="button" class="agvp-grafy" data-go="grafy"><svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 15v-4M12 15V7M17 15v-6"/></svg>'
            + '<span><b>Grafy — vizuální přehled</b><small>' + txt + '</small></span><span class="go">›</span></button>';
    }
    function tile(n, popis, go, cls) {
        return '<div class="agvp-t' + (cls ? ' ' + cls : '') + '" data-go="' + go + '"><b>' + (n == null ? '—' : n) + '</b><small>' + popis + '</small></div>';
    }
    function otevri(kam) {
        if (kam === 'zadosti' || kam === 'lide') {
            var go = function () { try { AGVlastnik.close(); AGProdej.open(kam === 'zadosti' ? 'zad' : 'lide'); } catch (e) { swallow(e, 'prodej'); } };
            if (window.AGProdej) go(); else if (window.AGLazy) AGLazy.need('js/prodej-konzole.js', go);
            return;
        }
        if (kam === 'zpravy') {
            var go2 = function () { try { AGVlastnik.close(); AGZpetna.inbox(); } catch (e) { swallow(e, 'zpravy'); } };
            if (window.AGZpetna) go2(); else if (window.AGLazy) AGLazy.need('js/zpetna-vazba.js', go2);
            return;
        }
        if (kam === 'firmy') {
            var go3 = function () { try { AGVlastnik.close(); AGSprava.open(); } catch (e) { swallow(e, 'firmy'); } };
            if (window.AGSprava) go3(); else if (window.AGLazy) AGLazy.need('js/sprava-appky.js', go3);
            return;
        }
        jdi(kam);
    }

    // ---- POHLED: souhrn + kdo je v terénu + mapa ---------------------------------------------
    function viewPrehled(b) {
        var x = X(); styly();
        x.cekam(b, 'Sbírám souhrn…');
        nactiPrehled(function (d, r, stare) {
            if (!plati('prehled')) return;
            var vypadek = false;
            if (!d && stare) { d = stare; vypadek = true; }
            if (!d) { x.sayFail(r || { status: 0 }, 'souhrn'); jdi(''); return; }
            var oknoTxt = _okno === 'minule' ? 'od tvé poslední návštěvy' : (_okno === 72 ? 'za poslední 3 dny' : 'za posledních 24 hodin');
            var h = [x.hlava('Souhrn dne', 'Napříč všemi firmami, ' + oknoTxt + '. <button type="button" class="agv-b" id="agvp-refresh">znovu</button>')];
            h.push('<div class="agvp-min"><button type="button" class="agv-b' + (_okno === 24 ? ' on' : '') + '" data-okno="24">24 h</button><button type="button" class="agv-b' + (_okno === 72 ? ' on' : '') + '" data-okno="72">3 dny</button>' + (posledniNavsteva() ? '<button type="button" class="agv-b' + (_okno === 'minule' ? ' on' : '') + '" data-okno="minule">od minula</button>' : '') + '</div>');
            if (vypadek) h.push('<div class="agvp-star">⚠ Server teď neodpověděl (' + esc(String((r && r.status) || 0)) + ') — čísla jsou <b>z ' + esc(cas(_cacheTs)) + '</b>, nenačteno.</div>');
            h.push('<div class="agvp-tiles">' + tile(d.lidi24, 'lidí měřilo') + tile(d.body24, 'bodů přibylo') + tile(d.ucty24, 'nových účtů') +
                tile(d.zadosti, 'žádostí o Pro', 'zadosti', d.zadosti ? 'warn' : '') + tile(d.zpravy, 'zpráv čeká', 'zpravy', d.zpravy ? 'warn' : '') + tile(d.chyby24, 'chyb', 'errors', d.chyby24 ? 'bad' : '') +
                tile(d.uctyCelkem, 'účtů celkem') + tile(d.proCelkem, 's Pro') + tile((d.shluky || []).length, 'míst měření') + '</div>');
            h.push(grafyBtn('totéž za 30 dní jako sloupce po dnech'));
            h.push('<div class="agv-sec">Kdo je v terénu teď (aktivita do 10 minut)</div>');
            if (!(d.online || []).length) h.push('<div class="agv-p">Teď nikdo — poslední aktivitu najdeš v Lidech.</div>');
            (d.online || []).forEach(function (o) {
                h.push('<div class="agvp-row"><span class="agvp-dot"></span><span class="tx"><b>' + esc(o.jmeno || o.uid) + '</b><small>' + esc(o.firma || 'vlastní prostor') + (o.job ? ' · ' + esc(o.job) : '') + '</small></span><span class="r">' + esc(pred(o.ts)) + (o.n ? '<br>' + o.n + ' akcí' : '') + '</span></div>');
            });
            h.push('<div class="agv-sec">Kde se za 24 h měřilo</div>');
            if (!(d.shluky || []).length) h.push('<div class="agv-p">Žádné synchronizované body za 24 h (body chodí na server jen ze synchronizace v Pro).</div>');
            else h.push('<div class="agvp-map" id="agvp-map"></div><div class="agv-p">Shluky po ~2 km, počet bodů v každém. Konkrétní souřadnice se sem neposílají.</div>');
            if ((d.vyprsi || []).length) {
                h.push('<div class="agv-sec">Pro vyprší do 60 dní</div>');
                d.vyprsi.slice(0, 8).forEach(function (u) {
                    h.push('<div class="agvp-row"><span class="tx"><b>' + esc(u.name) + '</b><small>' + esc(u.code) + '</small></span><span class="r">' + datum(u.tarif_do) + '<br>za ' + dni(u.tarif_do) + ' d</span></div>');
                });
                h.push('<button type="button" class="agv-b" data-go="kalendar">Celý kalendář ›</button>');
            }
            b.innerHTML = h.join('');
            x.wireZpet(b);
            Array.prototype.forEach.call(b.querySelectorAll('[data-go]'), function (el) { el.addEventListener('click', function () { otevri(el.getAttribute('data-go')); }); });
            var rf = b.querySelector('#agvp-refresh'); if (rf) rf.addEventListener('click', function () { _cache = null; viewPrehled(b); });
            Array.prototype.forEach.call(b.querySelectorAll('[data-okno]'), function (el) { el.addEventListener('click', function () { var v = el.getAttribute('data-okno'); _okno = v === 'minule' ? 'minule' : parseInt(v, 10); viewPrehled(b); }); });
            if ((d.shluky || []).length) setTimeout(function () { mapa(d.shluky); }, 60);
        });
    }
    function mapa(shluky) {
        var el = document.getElementById('agvp-map');
        if (!el || !window.L) return;
        try {
            var m = L.map(el, { zoomControl: false, attributionControl: false });
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 16 }).addTo(m);
            var pts = [];
            shluky.forEach(function (s) {
                pts.push([s.lat, s.lng]);
                L.circleMarker([s.lat, s.lng], { radius: Math.min(22, 6 + Math.sqrt(s.n) * 3), color: '#e6bd76', fillColor: '#e6bd76', fillOpacity: .35, weight: 1.5 })
                    .bindTooltip(s.n + ' bodů').addTo(m);
            });
            if (pts.length === 1) m.setView(pts[0], 11); else m.fitBounds(pts, { padding: [20, 20], maxZoom: 12 });
        } catch (e) { swallow(e, 'mapa'); el.innerHTML = '<div class="agv-p" style="padding:12px;">Mapa se nevykreslila.</div>'; }
    }

    // ---- DENÍK VLASTNÍKA --------------------------------------------------------------------
    var AKCE = { 'pro-zapnout': 'Zapnuto Pro', 'pro-vypnout': 'Vypnuto Pro', blokace: 'Zablokován účet', odblokovat: 'Odblokován účet', vypinac: 'Vypínač modulů', 'hlaska-vsem': 'Hláška všem firmám',
        'firma-smazat': 'Smazána firma', 'firma-zmrazit': 'Zmrazení firmy', 'zprava-vyrizeno': 'Zpráva vyřízena', 'zprava-zpet': 'Zpráva zpět mezi nevyřízené', 'zprava-smazat': 'Zpráva smazána', vzkaz: 'Vzkaz', poznamka: 'Poznámka u účtu', zaloha: 'Záloha serveru', vydani: 'Vydání pro ostatní' };
    function viewDenik(b) {
        var x = X(); styly();
        if (!_log) {
            x.cekam(b, 'Načítám deník…');
            api('/owner/log').then(function (r) {
                if (!plati('denik')) return;
                if (!r.ok) { x.sayFail(r, 'deník'); jdi(''); return; }
                _log = r.data || { rows: [] }; viewDenik(b);
            });
            return;
        }
        var h = [x.hlava('Deník vlastníka', 'Každá akce z konzole se zapisuje na server: co, komu, kdy. Za měsíc si nepamatuješ, proč má někdo Pro navždy — tady to je.')];
        if (!_log.rows.length) h.push('<div class="agv-p" style="padding:20px 4px;text-align:center;">Zatím prázdný — plní se od téhle verze workeru.</div>');
        _log.rows.forEach(function (r) {
            h.push('<div class="agvp-log"><b>' + esc(AKCE[r.akce] || r.akce) + '</b>' + (r.cil ? ' — ' + esc(r.cil) : '') + (r.detail ? '<br>' + esc(r.detail) : '') + '<small>' + esc(cas(r.ts)) + '</small></div>');
        });
        if (_log.more) h.push('<button type="button" class="btn btn-secondary" id="agvp-more" style="margin-top:10px;">Starší záznamy</button>');
        h.push('<button type="button" class="btn btn-secondary" id="agvp-log-rf" style="margin-top:8px;">Načíst znovu</button>');
        b.innerHTML = h.join('');
        x.wireZpet(b);
        var mo = b.querySelector('#agvp-more');
        if (mo) mo.addEventListener('click', function () {
            var last = _log.rows[_log.rows.length - 1];
            api('/owner/log?before=' + (last ? last.id : 0)).then(function (r) {
                if (r.ok && r.data) { _log.rows = _log.rows.concat(r.data.rows || []); _log.more = !!r.data.more; viewDenik(b); }
            });
        });
        b.querySelector('#agvp-log-rf').addEventListener('click', function () { _log = null; viewDenik(b); });
    }

    // ---- KALENDÁŘ VYPRŠENÍ PRO ------------------------------------------------------------
    function nactiUcty(cb) {
        api('/owner/ucty').then(function (r) { cb(r.ok ? ((r.data && r.data.ucty) || []) : null, r); });
    }
    function viewKalendar(b) {
        var x = X(); styly();
        x.cekam(b, 'Načítám účty…');
        nactiUcty(function (ucty, r) {
            if (!plati('kalendar')) return;
            if (!ucty) { x.sayFail(r, 'účty'); jdi(''); return; }
            _ucty = ucty;
            var ted = Date.now();
            var pro = ucty.filter(function (u) { return u.tarif === 'pro' && u.tarif_do; }).sort(function (a, c) { return a.tarif_do - c.tarif_do; });
            var navzdy = ucty.filter(function (u) { return u.tarif === 'pro' && !u.tarif_do; }).length;
            var h = [x.hlava('Kalendář vypršení Pro', 'Komu Pro končí a kdy. Prodloužení se počítá od konce běžícího Pro, nikomu se nic nezkrátí.')];
            var skup = [['Už vypršelo', function (d) { return d < 0; }], ['Do 7 dní', function (d) { return d >= 0 && d <= 7; }], ['Do 30 dní', function (d) { return d > 7 && d <= 30; }], ['Do 90 dní', function (d) { return d > 30 && d <= 90; }], ['Později', function (d) { return d > 90; }]];
            var neco = false;
            skup.forEach(function (sk) {
                var list = pro.filter(function (u) { return sk[1](dni(u.tarif_do)); });
                if (!list.length) return;
                neco = true;
                h.push('<div class="agv-sec">' + sk[0] + ' (' + list.length + ')</div>');
                list.forEach(function (u) {
                    var d = dni(u.tarif_do);
                    h.push('<div class="agvp-row"><span class="tx"><b>' + esc(u.name) + '</b><small>' + esc(u.code) + (u.prostory && u.prostory.length ? ' · ' + esc(u.prostory.filter(function (p) { return !p.vlastni; }).map(function (p) { return p.nazev; }).join(', ') || 'jen vlastní prostor') : '') + '</small></span>' +
                        '<span class="r">' + datum(u.tarif_do) + '<br>' + (d < 0 ? 'před ' + (-d) + ' d' : 'za ' + d + ' d') + '</span>' +
                        '<div class="agvp-m" style="margin:0;"><button type="button" data-pro="' + esc(u.id) + '" data-dni="30">+ měsíc</button><button type="button" data-pro="' + esc(u.id) + '" data-dni="365">+ rok</button></div></div>');
                });
            });
            if (!neco) h.push('<div class="agv-p" style="padding:20px 4px;text-align:center;">Nikomu Pro nevyprší — ' + (navzdy ? navzdy + ' účtů má Pro navždy.' : 'nikdo zatím Pro s koncem nemá.') + '</div>');
            else if (navzdy) h.push('<div class="agv-p" style="margin-top:10px;">Dalších ' + navzdy + ' účtů má Pro navždy.</div>');
            b.innerHTML = h.join('');
            x.wireZpet(b);
            Array.prototype.forEach.call(b.querySelectorAll('[data-pro]'), function (el) {
                el.addEventListener('click', function () {
                    var id = el.getAttribute('data-pro'), dn = parseInt(el.getAttribute('data-dni'), 10) || 30;
                    var u = null; ucty.forEach(function (q) { if (q.id === id) u = q; });
                    x.ask('Prodloužit Pro účtu ' + (u ? u.name : id) + ' o ' + (dn >= 360 ? 'rok' : 'měsíc') + '?').then(function (ok) {
                        if (!ok) return;
                        api('/owner/tarif', { method: 'POST', body: { id: id, tarif: 'pro', dni: dn } }).then(function (r) {
                            if (!r.ok) { x.sayFail(r, 'tarif'); return; }
                            _cache = null; if (plati('kalendar')) viewKalendar(b);
                        });
                    });
                });
            });
        });
    }

    // ---- ZÁLOHA SERVERU -----------------------------------------------------------------------
    function viewZaloha(b) {
        var x = X(); styly();
        var h = [x.hlava('Záloha celého serveru', 'Stáhne všechny firmy, členství, účty (bez hesel), zakázky, body (do 20 000), zprávy, objednávky, vzkazy a deník jako jeden soubor JSON. Nic se na serveru nemění.')];
        h.push('<button type="button" class="btn btn-primary" id="agvp-zal" style="width:100%;">Stáhnout zálohu teď</button>');
        h.push('<div class="agv-p" id="agvp-zal-st" style="margin-top:10px;">' + (_zaloha ? 'Poslední záloha v tomhle běhu: ' + esc(cas(_zaloha.ts)) + ' · ' + _zaloha.kb + ' kB' : '') + '</div>');
        h.push('<div class="agv-p" style="margin-top:12px;">Obnova ze souboru není v appce — záloha je pojistka pro případ, že by databáze na Cloudflare zmizela; obnovit ji jde importem do D1 (viz cloud/README.md).</div>');
        b.innerHTML = h.join('');
        x.wireZpet(b);
        b.querySelector('#agvp-zal').addEventListener('click', function () {
            var btn = this, st = b.querySelector('#agvp-zal-st');
            btn.disabled = true; btn.textContent = 'Stahuji…';
            api('/owner/export', { timeoutMs: 120000 }).then(function (r) {
                btn.disabled = false; btn.textContent = 'Stáhnout zálohu teď';
                if (!r.ok) { x.sayFail(r, 'záloha'); return; }
                var txt = JSON.stringify(r.data);
                var kb = Math.round(txt.length / 1024);
                var d = new Date(), nazev = 'qtrig-zaloha-' + d.toISOString().slice(0, 10) + '.json';
                var pocty = Object.keys(r.data.tabulky || {}).map(function (k) { return k + ' ' + r.data.tabulky[k].length; }).join(', ');
                _zaloha = { ts: Date.now(), kb: kb };
                st.textContent = 'Staženo: ' + kb + ' kB · ' + pocty;
                ulozSoubor(nazev, txt, 'application/json');
            });
        });
    }
    // sdílení / stažení souboru — Web Share s files (iOS) a záloha přes <a download>
    function ulozSoubor(nazev, txt, typ) {
        try {
            var blob = new Blob([txt], { type: typ });
            var f = null;
            try { f = new File([blob], nazev, { type: typ }); } catch (e) { f = null; }
            if (f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
                navigator.share({ files: [f], title: nazev })['catch'](function () { stahni(blob, nazev); });
                return;
            }
            stahni(blob, nazev);
        } catch (e) { swallow(e, 'ulozSoubor'); }
    }
    function stahni(blob, nazev) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = nazev; document.body.appendChild(a); a.click();
        setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) { swallow(e, 'stahni'); } }, 4000);
    }

    // ---- POHLED OČIMA ÚČTU ------------------------------------------------------------------
    // Ne skutečná impersonace (přepínat cizí stav v telefonu by rozbilo vlastní data):
    // karta, která říká, co ten člověk má a vidí — tarif, role a oprávnění v každém
    // prostoru, které nástroje používá, na jakém telefonu, co mu padá, co dostal za vzkazy.
    function pohled(id) {
        _pohledId = id; _pohled = null;
        var go = function () { try { AGVlastnik.open(); AGVlastnik.jdi('pohled'); } catch (e) { swallow(e, 'pohled'); } };
        go();
    }
    function viewPohled(b) {
        var x = X(); styly();
        if (!_pohledId) { jdi(''); return; }
        if (!_pohled) {
            x.cekam(b, 'Skládám pohled účtu…');
            api('/owner/ucty/' + encodeURIComponent(_pohledId) + '/pohled').then(function (r) {
                if (!plati('pohled')) return;
                if (!r.ok) { x.sayFail(r, 'pohled'); jdi(''); return; }
                _pohled = r.data; viewPohled(b);
            });
            return;
        }
        var d = _pohled, u = d.ucet || {};
        var reg = [];
        try { reg = (window.AGReg && AGReg.all) ? AGReg.all() : []; } catch (e) { reg = []; }
        var proN = reg.filter(function (t) { return t.pro && !t.hidden; }).length, volN = reg.filter(function (t) { return !t.pro && !t.hidden; }).length;
        var h = [x.hlava('Očima účtu: ' + (u.name || u.code), 'Co tenhle člověk v appce má a vidí. Nic se tím nemění.')];
        h.push('<div class="agv-sec">Deník: co dělal den po dni (30 dní)</div><div id="agvp-denik" class="agv-p">Načítám…</div>');
        h.push('<div class="agvp-tiles">' + tile(u.tarifPlati ? 'Pro' : 'Základ', u.tarifPlati ? (u.tarif_do ? 'do ' + datum(u.tarif_do) : 'navždy') : 'tarif') +
            tile(u.tarifPlati ? (volN + proN) : volN, 'nástrojů vidí odemčených') + tile(u.tarifPlati ? 0 : proN, 'zamčených') + '</div>');
        h.push('<div class="agv-p">Kód <b>' + esc(u.code) + '</b> · založen ' + datum(u.created) + ' · poslední přihlášení ' + esc(pred(u.last_login)) + (u.disabled ? ' · <b style="color:#e2685f">ZABLOKOVÁN</b>' : '') + (u.note ? '<br>Poznámka: ' + esc(u.note) : '') + '</div>');
        h.push('<div class="agv-sec">Kde je a jakou má roli</div>');
        (d.clenstvi || []).forEach(function (c) {
            var p = c.perms || {};
            var zak = Object.keys(p).filter(function (k) { return p[k] === false || (p[k] && p[k][c.role] === false); });
            h.push('<div class="agvp-row"><span class="tx"><b>' + esc(c.vlastni ? 'vlastní prostor' : (c.nazev || '?')) + (c.kod ? ' (' + esc(c.kod) + ')' : '') + '</b><small>role ' + esc(c.role) + (c.archiv ? ' · odešel (archiv)' : '') + (c.blokovan ? ' · zablokován' : '') + (c.frozen ? ' · firma zmrazená' : '') +
                (zak.length ? ' · zakázáno: ' + esc(zak.join(', ')) : '') + '</small></span><span class="r">' + esc(pred(c.lastLogin)) + '</span></div>');
        });
        h.push('<div class="agv-sec">Co za 30 dní používá</div>');
        if (!(d.nastroje || []).length) h.push('<div class="agv-p">Žádný nástroj (nebo starší appka, která užívání neposílá).</div>');
        (d.nastroje || []).slice(0, 15).forEach(function (n) {
            var t = null; try { t = AGReg.get(n.k); } catch (e) { t = null; }
            h.push('<div class="agvp-row"><span class="tx"><b>' + esc(t && t.vl ? t.vl : n.k) + '</b>' + (t && t.pro ? '<small>Pro nástroj</small>' : '') + '</span><span class="r">' + n.n + '×<br>' + esc(pred(n.last)) + '</span></div>');
        });
        if ((d.zarizeni || []).length) h.push('<div class="agv-sec">Zařízení</div><div class="agv-p">' + d.zarizeni.map(function (z) { return esc(z.dev) + ' (' + esc(pred(z.last)) + ')'; }).join(' · ') + '</div>');
        h.push('<div class="agv-sec">Co mu padá (' + (d.chyby || []).length + ')</div>');
        if (!(d.chyby || []).length) h.push('<div class="agv-p">Žádná chyba od tohohle člověka.</div>');
        (d.chyby || []).slice(0, 8).forEach(function (c) {
            h.push('<div class="agvp-log">' + esc(c.msg || '') + '<small>' + esc((c.src || '').split('/').pop()) + (c.line ? ':' + c.line : '') + ' · ' + esc(c.ver || '') + ' · ' + esc(cas(c.ts)) + '</small></div>');
        });
        if ((d.vzkazy || []).length) {
            h.push('<div class="agv-sec">Vzkazy od tebe</div>');
            d.vzkazy.forEach(function (v) { h.push('<div class="agvp-log">' + esc(v.txt) + '<small>' + esc(cas(v.ts)) + ' · ' + (v.read_ts ? 'přečteno ' + esc(cas(v.read_ts)) : 'nepřečteno') + '</small></div>'); });
        }
        h.push('<button type="button" class="btn btn-secondary" id="agvp-poh-lide" style="margin-top:14px;">Zpět do Lidí</button>');
        b.innerHTML = h.join('');
        x.wireZpet(b);
        b.querySelector('#agvp-poh-lide').addEventListener('click', function () { otevri('lide'); });
        var dh = b.querySelector('#agvp-denik'); if (dh) denikCloveka(_pohledId, dh);
    }

    // ---- TEČKA „NĚCO ČEKÁ" NA VSTUPECH -----------------------------------------------------
    function badge() {
        if (!isOn()) { odznak(0); return; }
        if (Date.now() - _liteTs < 5 * 60000) { odznak(_lite ? (_lite.zadosti + _lite.zpravy) : 0); return; }
        _liteTs = Date.now();
        api('/owner/prehled?lite=1').then(function (r) {
            if (r.ok && r.data) { _lite = r.data; odznak(_lite.zadosti + _lite.zpravy); }
        });
    }
    function odznak(n) {
        styly();
        ['agv-set-btn', 'agv-tools-btn', 'agv-menu-btn'].forEach(function (id) {
            var el = document.getElementById(id); if (!el) return;
            var b = el.querySelector('.agvp-badge');
            if (!n) { if (b) b.remove(); return; }
            if (!b) { b = document.createElement('span'); b.className = 'agvp-badge'; el.appendChild(b); }
            var t = String(n); if (b.textContent !== t) b.textContent = t;
            b.title = (_lite ? _lite.zadosti + ' žádostí o Pro, ' + _lite.zpravy + ' zpráv' : '');
        });
    }

    // ---- CSV export bodů firmy (pro js/sprava-appky.js) --------------------------------------
    function csv(firma, jobs) {
        var radky = ['zakazka;cislo;kod;Y;X;lat;lng;vyska;presnost;kdo;kdy'];
        (jobs || []).forEach(function (j) {
            (j.points || []).forEach(function (p) {
                var yx = null;
                try { if (window.GeoCore && GeoCore.toSJTSK) yx = GeoCore.toSJTSK(p.lat, p.lng); } catch (e) { yx = null; }
                radky.push([j.name || j.key, p.name || '', p.kod || '', yx ? yx.y.toFixed(2) : '', yx ? yx.x.toFixed(2) : '', p.lat, p.lng, p.vyska != null ? p.vyska : '', p.acc != null ? p.acc : '', p.uname || '', p.ts ? new Date(p.ts).toISOString() : '']
                    .map(function (v) { return String(v == null ? '' : v).replace(/;/g, ','); }).join(';'));
            });
        });
        ulozSoubor('body-' + String(firma.code || firma.name || 'firma').replace(/[^\w-]+/g, '_') + '.csv', '﻿' + radky.join('\r\n'), 'text/csv');
        return radky.length - 1;
    }

    // ---- brzda vydání: pustit tuhle verzi ostatním ------------------------------------
    // Vlastník má na svém telefonu vždy nejnovější verzi (značka ag-vlastnik v Cache
    // Storage, sw.js ji respektuje). Ostatním se nová verze nainstaluje, až ji tady
    // pustí. Server drží jen číslo verze (GET /vydano, POST /owner/vydat).
    // DENÍK ČLOVĚKA (13. 9. 2026): svislý řádek událostí za 30 dní, dny bez aktivity sbalené
    function denikCloveka(id, host) {
        api('/owner/ucty/' + encodeURIComponent(id) + '/denik').then(function (r) {
            if (!host.isConnected) return;
            if (!r.ok || !r.data) { host.textContent = 'Deník se nenačetl (' + (r.status || 0) + ').'; return; }
            var d = r.data, dny = d.dny || [];
            if (!dny.length) { host.innerHTML = '<div class="agv-p">Za 30 dní žádná aktivita na serveru.</div>'; return; }
            var akt = dny.filter(function (x) { return x.akce > 0; }).length, body = 0, chyby = 0;
            dny.forEach(function (x) { body += x.body || 0; chyby += x.chyby || 0; });
            var h = ['<div class="agv-p" style="margin:0 0 6px;">Aktivních dní <b>' + akt + '</b> · bodů <b>' + body + '</b> · chyb <b>' + chyby + '</b>' + (d.ucet && d.ucet.ver ? ' · verze <b>' + esc(d.ucet.ver) + '</b>' + (d.ucet.ver_ts ? ' od ' + esc(datum(d.ucet.ver_ts)) : '') : '') + (d.ucet && d.ucet.dev ? ' · ' + esc(d.ucet.dev) : '') + '</div>'];
            var reg = null; try { reg = window.AGReg; } catch (e) { reg = null; }
            var jm = function (k) { try { var t = reg && reg.get ? reg.get(k) : null; return t && t.vl ? t.vl : k; } catch (e) { return k; } };
            var DNY = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
            dny.slice().reverse().forEach(function (x) {
                var dt = new Date(x.day + 'T12:00:00Z');
                var lab = DNY[dt.getUTCDay()] + ' ' + dt.getUTCDate() + '. ' + (dt.getUTCMonth() + 1) + '.';
                var co = [];
                if (x.body) co.push(x.body + (x.body === 1 ? ' bod' : (x.body < 5 ? ' body' : ' bodů')));
                if (x.nastroje && x.nastroje.length) co.push(x.nastroje.map(jm).join(', '));
                if (!co.length && x.akce) co.push(x.akce + ' akcí');
                h.push('<div class="agvp-den' + (!x.akce && !x.chyby ? ' klid' : '') + '"><span class="d">' + esc(lab) + '</span><span class="t">' + (co.length ? esc(co.join(' · ')) : 'nic') +
                    (x.chyby ? '<small class="ch">' + x.chyby + '× chyba' + (x.chybaMsg ? ': ' + esc(String(x.chybaMsg).slice(0, 70)) : '') + '</small>' : '') + '</span></div>');
            });
            host.innerHTML = h.join('');
        });
    }
    function viewVydani(b) {
        var x = X(); styly();
        var moje = (x && x.verze) ? x.verze() : null;
        var h = [x.hlava('Pustit tuhle verzi ostatním', 'Ty vyvíjíš a testuješ, lidem venku skáče nová verze do appky až po tvém „pustit". Do té doby jim zůstává ta, co mají.')];
        h.push('<div class="agvp-tiles" style="grid-template-columns:1fr 1fr;"><div class="agvp-t"><b>' + (moje ? 'v' + moje : '—') + '</b><small>tahle verze (u tebe)</small></div><div class="agvp-t" id="agvp-vyd-venku"><b>…</b><small>venku pro ostatní</small></div></div>');
        h.push('<div class="agv-p" id="agvp-vyd-st">Zjišťuji, co je venku…</div>');
        h.push('<div id="agvp-vyd-verze" class="agv-p">Načítám, kdo je na které verzi…</div>');
        h.push('<button type="button" class="btn btn-primary" id="agvp-vyd-go" style="width:100%;margin-top:10px;" disabled>Pustit ' + (moje ? 'v' + moje : 'tuhle verzi') + ' ostatním</button>');
        h.push('<button type="button" class="btn" id="agvp-vyd-off" style="width:100%;margin-top:8px;" disabled>Vypnout brzdu (každá verze hned všem)</button>');
        h.push('<div class="agv-p" style="margin-top:14px;">Jak to funguje: každý telefon se při kontrole aktualizace zeptá serveru, jaká verze je venku. Když je nová verze vyšší, nenainstaluje se — a nic se neukáže, lidé pracují dál po staru. Tvůj telefon má výjimku (režim vlastníka). Když server neodpoví, brzda se pro jistotu neuplatní, aby se appka nezasekla na věky. Nový telefon bez appky dostane vždy nejnovější verzi.</div>');
        b.innerHTML = h.join('');
        x.wireZpet(b);
        var venku = b.querySelector('#agvp-vyd-venku b'), st = b.querySelector('#agvp-vyd-st'), go = b.querySelector('#agvp-vyd-go'), off = b.querySelector('#agvp-vyd-off');
        function ukaz(d) {
            var v = d && d.verze != null ? d.verze : null;
            venku.textContent = v != null ? 'v' + v : 'vše';
            var t = venku.parentNode; t.classList.toggle('warn', moje != null && v != null && moje > v);
            if (v == null) st.textContent = 'Brzda je vypnutá — každá nasazená verze jde hned všem (jako dřív).';
            else st.textContent = 'Venku je v' + v + (d.ts ? ' od ' + cas(d.ts) : '') + (d.pozn ? ' · ' + d.pozn : '') + (moje != null && moje > v ? '. Tvoje v' + moje + ' ještě lidem nejede.' : (moje != null && moje === v ? '. Lidé mají to samé co ty.' : ''));
            go.disabled = !(moje != null && (v == null || moje !== v));
            off.disabled = (v == null);
        }
        var vydanoTs = 0;
        api('/owner/vydano').then(function (r) {
            if (!plati('vydani')) return;
            if (!r.ok) { st.textContent = 'Server neodpověděl — zkus to za chvíli.'; venku.textContent = '?'; return; }
            vydanoTs = (r.data && r.data.ts) || 0;
            ukaz(r.data);
            verzeULidi(r.data);
        });
        // KDO UŽ NOVOU VERZI MÁ (13. 9. 2026): verze účtů (accounts.ver od v302), šíření po dnech od puštění
        function verzeULidi(vyd) {
            var host = b.querySelector('#agvp-vyd-verze'); if (!host) return;
            api('/owner/ucty').then(function (r) {
                if (!plati('vydani') || !host.isConnected) return;
                if (!r.ok || !r.data) { host.textContent = 'Verze u lidí se nenačetly.'; return; }
                var ucty = (r.data.ucty || []).filter(function (u) { return u.ver; });
                if (!ucty.length) { host.textContent = 'Zatím nikdo verzi nehlásí (hlásí se od v302 při přihlášení).'; return; }
                var cnt = {}; ucty.forEach(function (u) { cnt[u.ver] = (cnt[u.ver] || 0) + 1; });
                var vers = Object.keys(cnt).sort(function (a, c) { return (parseInt(c.replace(/\D/g, ''), 10) || 0) - (parseInt(a.replace(/\D/g, ''), 10) || 0); });
                var venkuV = vyd && vyd.verze != null ? vyd.verze : null;
                var h2 = ['<div class="agv-sec">Kdo je na které verzi (' + ucty.length + ' lidí hlásí)</div>'];
                h2.push(pruhy(vers.map(function (v) { return { k: v + (venkuV != null && (parseInt(v.replace(/\D/g, ''), 10) || 0) < venkuV ? ' · stará' : ''), n: cnt[v] }; }), 'k', ''));
                if (venkuV != null && vyd.ts) {
                    var novi = ucty.filter(function (u) { return (parseInt(String(u.ver).replace(/\D/g, ''), 10) || 0) >= venkuV; });
                    var poDnech = {}; novi.forEach(function (u) { if (u.ver_ts && u.ver_ts >= vyd.ts) { var dd = new Date(u.ver_ts).toISOString().slice(0, 10); poDnech[dd] = (poDnech[dd] || 0) + 1; } });
                    var dnyK = Object.keys(poDnech).sort(), kum = 0;
                    if (dnyK.length) {
                        h2.push('<div class="agv-sec">Jak se v' + venkuV + ' šíří od ' + esc(cas(vyd.ts)) + '</div>');
                        h2.push('<div class="agv-p">' + dnyK.map(function (dd) { kum += poDnech[dd]; return esc(dd.slice(8, 10) + '. ' + dd.slice(5, 7) + '.') + ' <b>' + kum + '</b>'; }).join(' · ') + ' z ' + ucty.length + '</div>');
                    }
                    var stari = ucty.filter(function (u) { return (parseInt(String(u.ver).replace(/\D/g, ''), 10) || 0) < venkuV; }).sort(function (a, c) { return (c.last_login || 0) - (a.last_login || 0); });
                    if (stari.length) {
                        h2.push('<div class="agv-sec">Ještě na staré (' + stari.length + ')</div>');
                        stari.slice(0, 15).forEach(function (u) { h2.push('<div class="agvp-row"><span class="tx"><b>' + esc(u.name || u.code) + '</b><small>' + esc(u.ver) + ' · naposledy ' + esc(pred(u.last_login)) + (u.dev ? ' · ' + esc(u.dev) : '') + '</small></span></div>'); });
                        if (stari.length > 15) h2.push('<div class="agv-p">… a dalších ' + (stari.length - 15) + '.</div>');
                        h2.push('<div class="agv-p">Kdo je na staré déle než pár dní, appku prostě neotevřel — nebo mu stojí aktualizace. Napiš mu vzkaz z Lidí.</div>');
                    }
                }
                host.innerHTML = h2.join('');
            });
        }
        function posli(verze, txt) {
            go.disabled = true; off.disabled = true; st.textContent = txt;
            api('/owner/vydat', { method: 'POST', body: { verze: verze } }).then(function (r) {
                if (!plati('vydani')) return;
                if (!r.ok) { x.sayFail(r, 'vydání'); go.disabled = false; return; }
                ukaz(r.data);
                try { if (typeof window.quickToast === 'function') quickToast(verze == null ? 'Brzda vypnuta.' : 'v' + verze + ' puštěna ostatním.'); } catch (e) { swallow(e, 'toast'); }
            });
        }
        go.addEventListener('click', function () {
            if (moje == null) return;
            x.ask('Pustit v' + moje + ' všem lidem? Nainstaluje se jim při příštím otevření appky.').then(function (ok) { if (ok) posli(moje, 'Pouštím v' + moje + '…'); });
        });
        off.addEventListener('click', function () {
            x.ask('Vypnout brzdu? Každá další nasazená verze půjde hned všem.').then(function (ok) { if (ok) posli(null, 'Vypínám brzdu…'); });
        });
    }

    // ---- GRAFY: 30 dní po dnech + verze + nástroje ------------------------------------------
    var _grafy = null, _grafyDni = 30;
    function pct(ted, min) { if (!min) return ted ? '<b>nové</b>' : '—'; var p = Math.round((ted - min) / min * 100); return '<b>' + (p > 0 ? '+' : '') + p + ' %</b>'; }
    function grafyCsv(g) {
        var dny = dnyOsa(g.od, g.do), rady = { lide: g.lide, akce: g.akce, body: g.body, ucty: g.ucty, chyby: g.chyby, dotazy: g.dotazy };
        var m = {}; Object.keys(rady).forEach(function (k) { m[k] = {}; (rady[k] || []).forEach(function (r) { if (r && r.day) m[k][String(r.day).slice(0, 10)] = +r.n || 0; }); });
        var L = ['den;lide;akce;body;nove_ucty;chyby;dotazy'];
        dny.forEach(function (d) { L.push([d, m.lide[d] || 0, m.akce[d] || 0, m.body[d] || 0, m.ucty[d] || 0, m.chyby[d] || 0, m.dotazy[d] || 0].join(';')); });
        L.push(''); L.push('verze;uctu'); (g.verze || []).forEach(function (v) { L.push((v.ver || 'neznama') + ';' + v.n); });
        L.push(''); L.push('nastroj;pouziti'); (g.nastroje || []).forEach(function (v) { L.push(v.k + ';' + v.n); });
        return '\ufeff' + L.join('\r\n');
    }
    function dnyOsa(od, doD) {
        var out = [], a = new Date(od + 'T00:00:00Z'), b = new Date(doD + 'T00:00:00Z');
        for (var t = a.getTime(); t <= b.getTime(); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
        return out;
    }
    function sloupce(dny, rada, barva) {
        var m = {}; (rada || []).forEach(function (r) { if (r && r.day) m[String(r.day).slice(0, 10)] = +r.n || 0; });
        var vals = dny.map(function (d) { return m[d] || 0; });
        var max = Math.max(1, Math.max.apply(null, vals));
        var W = 300, H = 72, top = 12, bot = 14, bw = W / dny.length;
        var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="sloupce po dnech">';
        h += '<line x1="0" y1="' + (H - bot) + '" x2="' + W + '" y2="' + (H - bot) + '" stroke="rgba(230,189,118,.3)" stroke-width="1"/>';
        vals.forEach(function (v, i) {
            var hh = Math.round((H - top - bot) * v / max);
            h += '<rect x="' + (i * bw + 1).toFixed(1) + '" y="' + (H - bot - hh) + '" width="' + (bw - 2).toFixed(1) + '" height="' + hh + '" rx="1.5" fill="' + barva + '" opacity="' + (v ? 1 : .25) + '">' +
                '<title>' + dny[i].slice(8, 10) + '. ' + dny[i].slice(5, 7) + '. — ' + v + '</title></rect>';
        });
        h += '<text class="os" x="1" y="9">max ' + max + '</text>';
        h += '<text class="os" x="1" y="' + (H - 3) + '">' + dny[0].slice(8, 10) + '. ' + dny[0].slice(5, 7) + '.</text>';
        h += '<text class="os" x="' + W + '" y="' + (H - 3) + '" text-anchor="end">' + dny[dny.length - 1].slice(8, 10) + '. ' + dny[dny.length - 1].slice(5, 7) + '.</text>';
        return h + '</svg>';
    }
    function pruhy(rows, klic, popis) {
        var max = 0; rows.forEach(function (r) { max = Math.max(max, +r.n || 0); });
        if (!rows.length) return '<div class="agv-p">' + esc(popis) + '</div>';
        return rows.map(function (r) {
            var l = r[klic] == null || r[klic] === '' ? '(bez údaje)' : String(r[klic]);
            return '<div class="agvp-hb"><span class="l" title="' + esc(l) + '">' + esc(l) + '</span><span class="b"><i style="width:' + (max ? Math.round((+r.n || 0) / max * 100) : 0) + '%"></i></span><span class="n">' + (+r.n || 0) + '</span></div>';
        }).join('');
    }
    function viewGrafy(b) {
        var x = X(); styly();
        if (!_grafy || _grafy.dni !== _grafyDni) {
            x.cekam(b, 'Počítám grafy…');
            api('/owner/grafy?dni=' + _grafyDni).then(function (r) {
                if (!plati('grafy')) return;
                if (!r.ok || !r.data) {
                    if (_grafy) { _grafyDni = _grafy.dni; viewGrafy(b, r); return; }   // výpadek: poslední známé grafy se štítkem
                    x.sayFail(r, 'grafy'); jdi(''); return;
                }
                _grafy = r.data;
                if (_grafy.dni == null) _grafy.dni = _grafyDni;   // starší worker (< v20) dni nevrací — jinak by se dotaz točil
                viewGrafy(b);
            });
            return;
        }
        var vyp = arguments[1] || null;
        var g = _grafy, dny = dnyOsa(g.od, g.do), D = g.dni || 30, mn = g.minule || {};
        var sum = function (rada) { return (rada || []).reduce(function (a, r) { return a + (+r.n || 0); }, 0); };
        var h = [x.hlava('Grafy — posledních ' + D + ' dní', 'Jen počty ze serveru: kdo měřil, kolik akcí a bodů přišlo, kolik chyb spadlo. Srovnání je s předchozími ' + D + ' dny. <button type="button" class="agv-b" id="agvp-g-rf">Znovu</button> <button type="button" class="agv-b" id="agvp-g-csv">Stáhnout CSV</button> <button type="button" class="agv-b" id="agvp-g-tr">Trychtýř nováčků ›</button>')];
        h.push('<div class="agvp-min">' + [7, 30, 90].map(function (n) { return '<button type="button" class="agv-b' + (D === n ? ' on' : '') + '" data-dni="' + n + '">' + n + ' dní</button>'; }).join('') + '</div>');
        if (vyp) h.push('<div class="agvp-star">⚠ Server teď neodpověděl (' + esc(String(vyp.status || 0)) + ') — grafy jsou z minula, nenačteno.</div>');
        var lideTed = mn.lideTed != null ? mn.lideTed : null;
        h.push('<div class="agvp-g"><b>Lidé, kteří appku ten den použili</b><small>' + sum(g.lide) + ' člověko-dnů' + (lideTed != null ? ' · různých lidí ' + lideTed + ' (minule ' + (mn.lide || 0) + ', ' + pct(lideTed, mn.lide) + ')' : '') + '</small>' + sloupce(dny, g.lide, '#e6bd76') + '</div>');
        h.push('<div class="agvp-g"><b>Akce v appce</b><small>otevřené nástroje, uložené body… ' + sum(g.akce) + ' · minule ' + (mn.akce || 0) + ' · ' + pct(sum(g.akce), mn.akce) + '</small>' + sloupce(dny, g.akce, '#e6bd76') + '</div>');
        h.push('<div class="agvp-g"><b>Body přijaté na server</b><small>jen ze synchronizace v Pro · ' + sum(g.body) + ' · minule ' + (mn.body || 0) + ' · ' + pct(sum(g.body), mn.body) + '</small>' + sloupce(dny, g.body, '#3eb487') + '</div>');
        h.push('<div class="agvp-g"><b>Nové účty</b><small>' + sum(g.ucty) + ' · minule ' + (mn.ucty || 0) + ' · celkem ' + (g.uctyCelkem || 0) + '</small>' + sloupce(dny, g.ucty, '#7fb3ff') + '</div>');
        h.push('<div class="agvp-g"><b>Chyby hlášené appkou</b><small>' + sum(g.chyby) + ' · minule ' + (mn.chyby || 0) + ' · ' + pct(sum(g.chyby), mn.chyby) + ' · podrobně v „Chyby od lidí"</small>' + sloupce(dny, g.chyby, '#e0574a') + '</div>');
        h.push('<div class="agvp-g"><b>Dotazy na server za den</b><small>hrubá zátěž workeru · ' + sum(g.dotazy) + ' · minule ' + (mn.dotazy || 0) + '</small>' + sloupce(dny, g.dotazy, 'rgba(230,189,118,.6)') + '</div>');
        h.push('<div class="agvp-g"><b>Kdo jede na které verzi</b><small>podle posledního dotazu každého účtu (verze se hlásí od v302)</small>' + pruhy(g.verze || [], 'ver', 'Zatím nikdo verzi nehlásil — přijde s v302.') + '</div>');
        h.push('<div class="agvp-g"><b>Nejpoužívanější nástroje</b><small>za 30 dní, podle záznamů užívání</small>' + pruhy(g.nastroje || [], 'k', 'Zatím žádné záznamy.') + '</div>');
        b.innerHTML = h.join('');
        x.wireZpet(b);
        var rf = b.querySelector('#agvp-g-rf'); if (rf) rf.addEventListener('click', function () { _grafy = null; viewGrafy(b); });
        var cs = b.querySelector('#agvp-g-csv'); if (cs) cs.addEventListener('click', function () { ulozSoubor('qtrig-grafy-' + D + 'dni-' + g.do + '.csv', grafyCsv(g), 'text/csv;charset=utf-8'); });
        var tr = b.querySelector('#agvp-g-tr'); if (tr) tr.addEventListener('click', function () { jdi('trychtyr'); });
        Array.prototype.forEach.call(b.querySelectorAll('[data-dni]'), function (el) { el.addEventListener('click', function () { _grafyDni = parseInt(el.getAttribute('data-dni'), 10) || 30; viewGrafy(b); }); });
    }

    // ---- TRYCHTÝŘ NOVÁČKŮ (13. 9. 2026): registrace → první bod → 3. den → hodnocení ----
    var _tr = null, _trDni = 30;
    function viewTrychtyr(b) {
        var x = X(); styly();
        if (!_tr || _tr.dni !== _trDni) {
            x.cekam(b, 'Počítám trychtýř…');
            api('/owner/trychtyr?dni=' + _trDni).then(function (r) {
                if (!plati('trychtyr')) return;
                if (!r.ok || !r.data) { x.sayFail(r, 'trychtýř'); jdi(''); return; }
                _tr = r.data; viewTrychtyr(b);
            });
            return;
        }
        var t = _tr, n0 = t.registrace || 0;
        var h = [x.hlava('Trychtýř nováčků — ' + t.dni + ' dní', 'Kde lidé odpadnou: kdo se zaregistroval, kdo uložil aspoň jeden bod, kdo se vrátil třetí den a kdo dal hodnocení. Grafy říkají <em>kolik</em>, tohle říká <em>kde to drhne</em>.')];
        h.push('<div class="agvp-min">' + [30, 90, 180].map(function (n) { return '<button type="button" class="agv-b' + (t.dni === n ? ' on' : '') + '" data-dni="' + n + '">' + n + ' dní</button>'; }).join('') + '</div>');
        var k = function (n, lab, prev) { var p = prev ? Math.round(n / prev * 100) : (n ? 100 : 0); return '<div class="k"><div class="b" style="height:' + Math.max(6, Math.round(n0 ? n / n0 * 70 : 0)) + 'px;opacity:' + (n ? 1 : .25) + '"></div><b>' + n + '</b><small>' + lab + '</small><em>' + (prev != null ? p + ' %' : '&nbsp;') + '</em></div>'; };
        h.push('<div class="agvp-tr">' + k(n0, 'registrace', null) + k(t.bod || 0, 'první bod', n0) + k(t.den3 || 0, 'vrátil se 3. den', n0) + k(t.hodnoceni || 0, 'hodnocení', n0) + '</div>');
        var lidi = t.lidi || [];
        var odpadli = lidi.filter(function (l) { return !l.bod; }), bezNavratu = lidi.filter(function (l) { return l.bod && !l.den3; });
        if (!n0) h.push('<div class="agv-p">Za ' + t.dni + ' dní se nikdo nezaregistroval.</div>');
        if (odpadli.length) {
            h.push('<div class="agv-sec">Skončili hned po registraci (' + odpadli.length + ')</div>');
            h.push('<div class="agv-p">' + odpadli.slice(0, 20).map(function (l) { return esc(l.name || l.code) + ' <span style="opacity:.6">' + esc(datum(l.created)) + (l.ver ? ' · ' + esc(l.ver) : '') + '</span>'; }).join(' · ') + (odpadli.length > 20 ? ' …' : '') + '</div>');
            h.push('<div class="agv-p">Tihle uviděli prázdnou mapu a nic neuložili — problém je v prvních minutách appky, ne v nástrojích. Zkus jim napsat (Lidé → vzkaz).</div>');
        }
        if (bezNavratu.length) {
            h.push('<div class="agv-sec">Uložili bod, ale třetí den se nevrátili (' + bezNavratu.length + ')</div>');
            h.push('<div class="agv-p">' + bezNavratu.slice(0, 20).map(function (l) { return esc(l.name || l.code); }).join(' · ') + '</div>');
        }
        b.innerHTML = h.join('');
        x.wireZpet(b);
        Array.prototype.forEach.call(b.querySelectorAll('[data-dni]'), function (el) { el.addEventListener('click', function () { _trDni = parseInt(el.getAttribute('data-dni'), 10) || 30; viewTrychtyr(b); }); });
    }

    // ---- KAPACITA SERVERU (13. 9. 2026) + stav workeru + odkaz na úklid ----
    function mb(b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' MB'; }
    function viewKapacita(b) {
        var x = X(); styly();
        x.cekam(b, 'Měřím server…');
        Promise.all([api('/owner/kapacita'), api('/health')]).then(function (rs) {
            if (!plati('kapacita')) return;
            var r = rs[0], hh = rs[1].data || {};
            if (!r.ok || !r.data) { x.sayFail(r, 'kapacita'); jdi(''); return; }
            var d = r.data;
            var h = [x.hlava('Stav serveru a kapacita', 'Cloudflare zdarma: 100 000 požadavků denně a 500 MB databáze. Free plán ti nic neřekne předem — jednoho dne prostě přestane odpovídat; tady to uvidíš měsíce dopředu.')];
            h.push('<div class="agv-st">Worker <b>v' + esc(String(hh.v == null ? '?' : hh.v)) + '</b> · konzole ' + (hh.owner ? '<span class="ok">zapnutá</span>' : '<span class="bad">vypnutá</span>') + ' · klíč <span class="ok">sedí</span> · schránka ' + (hh.fb ? '<span class="ok">ano</span>' : '<span class="bad">ne</span>') + '</div>');
            var bar = function (lab, n, max, txt) { var p = max ? Math.min(100, Math.round(n / max * 100)) : 0; return '<div class="agvp-kb"><div class="l"><span>' + lab + '</span><span>' + txt + '</span></div><div class="b"><i class="' + (p > 85 ? 'bad' : (p > 60 ? 'w' : '')) + '" style="width:' + Math.max(1, p) + '%"></i></div></div>'; };
            h.push('<div class="agv-sec">Dnes</div>');
            h.push(bar('Požadavky dnes', d.dotazyDnes, d.limitDen, d.dotazyDnes + ' / ' + d.limitDen + ' · ' + Math.round(d.dotazyDnes / d.limitDen * 100) + ' %'));
            var prum = Math.round((d.dotazy30 || 0) / 30);
            h.push('<div class="agv-p">Průměr za 30 dní <b>' + prum + '</b> požadavků za den' + (prum ? ' — limit zdarma by dnešní tempo naplnilo při ' + Math.round(d.limitDen / prum) + '× víc lidech' : '') + '.</div>');
            h.push('<div class="agv-sec">Databáze</div>');
            h.push(bar('Velikost' + (d.odhad ? ' (odhad z řádků)' : ''), d.bajty, d.limitBajty, mb(d.bajty) + ' / ' + mb(d.limitBajty) + ' · ' + Math.round(d.bajty / d.limitBajty * 100) + ' %'));
            var tab = d.tab || {}, celkem = 0; Object.keys(tab).forEach(function (k) { celkem += tab[k] || 0; });
            var vahy = { usage: 110, errors: 420, sync_points: 600, accounts: 300, users: 200, feedback: 800, owner_log: 150, pos: 120, jobs: 300 };
            var NAZ = { usage: 'užívání (klepnutí)', errors: 'chyby', sync_points: 'body', accounts: 'účty', users: 'členství', firms: 'firmy', feedback: 'zprávy', owner_log: 'deník vlastníka', vzkazy: 'vzkazy', guard: 'brzda', pos: 'polohy', stats: 'statistika dnů', jobs: 'zakázky', orders: 'objednávky' };
            var rows = Object.keys(tab).map(function (k) { return { k: k, n: tab[k] || 0, b: (tab[k] || 0) * (vahy[k] || 100) }; }).sort(function (a, c) { return c.b - a.b; });
            var maxB = rows.length ? rows[0].b : 1;
            h.push(rows.slice(0, 7).map(function (r0) { return '<div class="agvp-hb"><span class="l" title="' + esc(NAZ[r0.k] || r0.k) + '">' + esc(NAZ[r0.k] || r0.k) + ' <span style="opacity:.6">' + r0.n + '</span></span><span class="b"><i style="width:' + Math.max(1, Math.round(r0.b / maxB * 100)) + '%"></i></span><span class="n" style="flex-basis:58px">' + esc(mb(r0.b)) + '</span></div>'; }).join(''));
            var r30 = d.rust30 || {}, bajtyDen = ((r30.usage || 0) * 110 + (r30.errors || 0) * 420 + (r30.body || 0) * 600) / 30;
            var mesicu = bajtyDen > 0 ? Math.round((d.limitBajty - d.bajty) / bajtyDen / 30) : null;
            h.push('<div class="agv-p" style="margin-top:10px;">Za 30 dní přibylo <b>' + (r30.usage || 0) + '</b> záznamů užívání, <b>' + (r30.errors || 0) + '</b> chyb a <b>' + (r30.body || 0) + '</b> bodů — zhruba ' + mb(bajtyDen * 30) + ' za měsíc. ' + (mesicu != null ? 'Při tomhle tempu vydrží databáze zdarma ještě <b>~' + (mesicu > 120 ? 'přes 10 let' : mesicu + ' měsíců') + '</b>.' : 'Zatím žádný růst k odhadu.') + '</div>');
            h.push('<button type="button" class="btn btn-secondary" id="agvp-kap-uklid" style="width:100%;margin-top:6px;">Úklid starých dat ›</button>');
            b.innerHTML = h.join('');
            x.wireZpet(b);
            b.querySelector('#agvp-kap-uklid').addEventListener('click', function () { jdi('uklid'); });
        });
    }

    // ---- ÚKLID STARÝCH DAT (13. 9. 2026): náhled, výběr, potvrzení s počty ----
    var _uklDni = 90;
    function viewUklid(b) {
        var x = X(); styly();
        x.cekam(b, 'Počítám, co je staré…');
        api('/owner/uklid?dni=' + _uklDni).then(function (r) {
            if (!plati('uklid')) return;
            if (!r.ok || !r.data) { x.sayFail(r, 'úklid'); jdi(''); return; }
            var n = r.data.nahled || {};
            var h = [x.hlava('Úklid starých dat', 'Smaže se jen to, co zaškrtneš, a až po potvrzení s počty. <b>Body a zakázky se neuklízí nikdy.</b> Účty jen ty, do kterých se za půl roku nikdo nepřihlásil a nemají žádné členství.')];
            h.push('<div class="agvp-min">' + [90, 180, 365].map(function (d0) { return '<button type="button" class="agv-b' + (_uklDni === d0 ? ' on' : '') + '" data-dni="' + d0 + '">starší než ' + d0 + ' dní</button>'; }).join('') + '</div>');
            var radek = function (id, lab, pocet, pozn) { return '<label class="agvp-sw"><input type="checkbox" data-co="' + id + '"' + (pocet ? '' : ' disabled') + '><span><b>' + lab + '</b> — ' + pocet + ' řádků' + (pozn ? '<br><small style="color:var(--text-muted,#9aa1ac)">' + pozn + '</small>' : '') + '</span></label>'; };
            h.push(radek('usage', 'Užívání (klepnutí, přihlášení)', n.usage || 0, 'nejrychleji rostoucí tabulka; grafy za starší období přestanou existovat'));
            h.push(radek('errors', 'Chyby z terénu', n.errors || 0, ''));
            h.push(radek('pos', 'Živé polohy (vysílačka — zrušená)', n.pos || 0, ''));
            h.push(radek('guard', 'Vypršelé zámky brzdy', n.guard || 0, 'neškodné, jen zabírají místo'));
            h.push(radek('ucty', 'Účty bez jediného přihlášení (půl roku, bez členství)', n.ucty || 0, 'nepřihlásil se nikdo, nikde nejsou'));
            h.push('<button type="button" class="btn btn-primary" id="agvp-ukl-go" style="width:100%;margin-top:14px;" disabled>Smazat vybrané</button>');
            h.push('<div class="agv-p" style="margin-top:10px;">Každý úklid se zapíše do Deníku vlastníka. Chceš-li mít jistotu, udělej napřed Zálohu celého serveru.</div>');
            b.innerHTML = h.join('');
            x.wireZpet(b);
            Array.prototype.forEach.call(b.querySelectorAll('[data-dni]'), function (el) { el.addEventListener('click', function () { _uklDni = parseInt(el.getAttribute('data-dni'), 10) || 90; viewUklid(b); }); });
            var go = b.querySelector('#agvp-ukl-go');
            var vybrane = function () { return Array.prototype.slice.call(b.querySelectorAll('[data-co]:checked')).map(function (c) { return c.getAttribute('data-co'); }); };
            Array.prototype.forEach.call(b.querySelectorAll('[data-co]'), function (c) { c.addEventListener('change', function () { go.disabled = !vybrane().length; }); });
            go.addEventListener('click', function () {
                var co = vybrane(); if (!co.length) return;
                var celkem = co.reduce(function (a, k) { return a + (n[k] || 0); }, 0);
                x.ask('Smazat ' + celkem + ' řádků (' + co.join(', ') + ') starších než ' + _uklDni + ' dní? Nejde to vrátit.').then(function (ok) {
                    if (!ok) return;
                    go.disabled = true; go.textContent = 'Mažu…';
                    api('/owner/uklid', { method: 'POST', body: { co: co, dni: _uklDni }, timeoutMs: 60000 }).then(function (r2) {
                        if (!plati('uklid')) return;
                        if (!r2.ok) { x.sayFail(r2, 'úklid'); go.disabled = false; go.textContent = 'Smazat vybrané'; return; }
                        var hv = r2.data.hotovo || {};
                        try { if (typeof window.quickToast === 'function') quickToast('Uklizeno: ' + Object.keys(hv).map(function (k) { return k + ' ' + hv[k]; }).join(', ')); } catch (e) { swallow(e, 'toast'); }
                        viewUklid(b);
                    });
                });
            });
        });
    }

    // ---- UPOZORNĚNÍ NA TELEFON (13. 9. 2026): Web Push, jen pro vlastníka ----
    function jeStandalone() { try { return !!(window.navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)); } catch (e) { return false; } }
    function urlB64ToBytes(s0) { var s1 = (s0 + '='.repeat((4 - s0.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'); var raw = atob(s1); var out = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }
    function viewPush(b) {
        var x = X(); styly();
        x.cekam(b, 'Zjišťuji stav upozornění…');
        var podpora = !!(('Notification' in window) && navigator.serviceWorker && ('PushManager' in window));
        var ios = /iPhone|iPad/.test(navigator.userAgent);
        Promise.all([api('/owner/push'), navigator.serviceWorker ? navigator.serviceWorker.getRegistration().catch(function () { return null; }) : Promise.resolve(null)]).then(function (rs) {
            if (!plati('push')) return;
            var r = rs[0], reg = rs[1];
            if (!r.ok || !r.data) { x.sayFail(r, 'upozornění'); jdi(''); return; }
            var d = r.data;
            (reg && reg.pushManager ? reg.pushManager.getSubscription().catch(function () { return null; }) : Promise.resolve(null)).then(function (sub) {
                if (!plati('push')) return;
                var moje = sub ? (d.subs || []).filter(function (s0) { return s0.endpoint === sub.endpoint; })[0] : null;
                var h = [x.hlava('Upozornění na telefon', 'Nová zpráva od člověka, žádost o Pro nebo náhlá vlna chyb ti přijde jako notifikace na zamčenou obrazovku — i když je appka zavřená. Jde to jen tobě, uživatelům nikdy.')];
                if (!podpora) h.push('<div class="agv-p"><b>Tenhle prohlížeč notifikace neumí.</b>' + (ios && !jeStandalone() ? ' Na iPhonu fungují jen z appky na ploše: Safari → Sdílet → Přidat na plochu, pak otevři QTRIG z plochy a zapni to tady.' : '') + '</div>');
                else if (ios && !jeStandalone()) h.push('<div class="agv-p"><b>Na iPhonu jen z appky na ploše.</b> Safari → Sdílet → Přidat na plochu, otevři QTRIG z plochy a zapni to tady.</div>');
                var perm = ('Notification' in window) ? Notification.permission : 'unsupported';
                h.push('<div class="agv-st">Tenhle telefon: ' + (moje ? '<span class="ok">zapnuto</span> od ' + esc(cas(moje.ts)) : '<span class="bad">vypnuto</span>') + ' · oprávnění prohlížeče: ' + esc(perm === 'granted' ? 'povoleno' : (perm === 'denied' ? 'ZAKÁZÁNO (povol v nastavení telefonu)' : perm)) + '</div>');
                var co = (moje && moje.co) || { zpravy: true, zadosti: true, chyby: true };
                h.push('<div class="agv-sec">O čem chceš vědět</div>');
                [['zpravy', 'Nová zpráva od člověka (i hodnocení)'], ['zadosti', 'Žádost o Pro'], ['chyby', 'Vlna chyb (≥ 15 za hodinu nebo 3× nad průměr; nejvýš 1× za hodinu)']].forEach(function (p) {
                    h.push('<label class="agvp-sw"><input type="checkbox" data-co="' + p[0] + '"' + (co[p[0]] !== false ? ' checked' : '') + '><span>' + p[1] + '</span></label>');
                });
                h.push('<button type="button" class="btn btn-primary" id="agvp-push-on" style="width:100%;margin-top:14px;"' + (podpora ? '' : ' disabled') + '>' + (moje ? 'Uložit volby' : 'Zapnout na tomhle telefonu') + '</button>');
                if (moje) h.push('<button type="button" class="btn btn-secondary" id="agvp-push-off" style="width:100%;margin-top:8px;">Vypnout na tomhle telefonu</button>');
                h.push('<button type="button" class="btn btn-secondary" id="agvp-push-test" style="width:100%;margin-top:8px;"' + ((d.subs || []).length ? '' : ' disabled') + '>Poslat zkušební upozornění</button>');
                if ((d.subs || []).length) {
                    h.push('<div class="agv-sec">Zapnuté telefony (' + d.subs.length + ')</div>');
                    d.subs.forEach(function (s0) { h.push('<div class="agvp-row"><span class="tx"><b>' + esc(s0.dev || s0.host || '?') + (sub && sub.endpoint === s0.endpoint ? ' (tenhle)' : '') + '</b><small>od ' + esc(cas(s0.ts)) + ' · ' + esc(Object.keys(s0.co || {}).filter(function (k) { return s0.co[k] !== false; }).join(', ') || 'nic') + '</small></span><button type="button" class="agv-b" data-del="' + s0.id + '">odebrat</button></div>'); });
                }
                b.innerHTML = h.join('');
                x.wireZpet(b);
                var volby = function () { var o = {}; Array.prototype.forEach.call(b.querySelectorAll('[data-co]'), function (c) { o[c.getAttribute('data-co')] = c.checked; }); return o; };
                var dev = (function () { var ua = navigator.userAgent; var m = /iPhone|iPad|Android|Windows|Macintosh/.exec(ua); return (m ? m[0] : 'telefon') + (jeStandalone() ? ' (appka na ploše)' : ' (prohlížeč)'); })();
                var on = b.querySelector('#agvp-push-on');
                on.addEventListener('click', function () {
                    on.disabled = true;
                    var kroky = Promise.resolve();
                    if (!sub) {
                        kroky = Notification.requestPermission().then(function (p) {
                            if (p !== 'granted') throw new Error('Oprávnění nepovoleno.');
                            return navigator.serviceWorker.ready;
                        }).then(function (reg2) {
                            return reg2.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(d.vapid) });
                        }).then(function (s2) { sub = s2; });
                    }
                    kroky.then(function () {
                        return api('/owner/push', { method: 'POST', body: { sub: sub.toJSON ? sub.toJSON() : sub, co: volby(), dev: dev } });
                    }).then(function (r2) {
                        if (!r2 || !r2.ok) throw new Error((r2 && r2.data && r2.data.error) || 'Server odběr neuložil.');
                        try { if (typeof window.quickToast === 'function') quickToast('Upozornění zapnuta.'); } catch (e) { swallow(e, 'toast'); }
                        viewPush(b);
                    })['catch'](function (e) {
                        on.disabled = false;
                        x.agAlert('Nepovedlo se', esc(e && e.message ? e.message : String(e)) + (ios && !jeStandalone() ? '<br><br>Na iPhonu to jde jen z appky přidané na plochu.' : ''));
                    });
                });
                var off = b.querySelector('#agvp-push-off');
                if (off) off.addEventListener('click', function () {
                    off.disabled = true;
                    var ep = sub.endpoint;
                    sub.unsubscribe().catch(function () { }).then(function () { return api('/owner/push', { method: 'DELETE', body: { endpoint: ep } }); }).then(function () { sub = null; viewPush(b); });
                });
                b.querySelector('#agvp-push-test').addEventListener('click', function () {
                    var tb = this; tb.disabled = true;
                    api('/owner/push/test', { method: 'POST', body: {} }).then(function (r3) {
                        tb.disabled = false;
                        var st = (r3.data && r3.data.stavy) || [];
                        x.agAlert('Zkušební upozornění', r3.ok ? ('Odesláno na ' + st.length + ' telefon' + (st.length === 1 ? '' : 'y') + ' (odpovědi push serveru: ' + esc(st.join(', ') || '—') + '). Mělo by přijít do pár vteřin — zamkni telefon a počkej.') : esc((r3.data && r3.data.error) || ('Chyba ' + r3.status)));
                    });
                });
                Array.prototype.forEach.call(b.querySelectorAll('[data-del]'), function (el) {
                    el.addEventListener('click', function () { el.disabled = true; api('/owner/push', { method: 'DELETE', body: { id: parseInt(el.getAttribute('data-del'), 10) } }).then(function () { viewPush(b); }); });
                });
            });
        });
    }

    // ---- „UKAŽ MI APPKU JAKO ZÁKLAD" (13. 9. 2026) ----
    function viewZaklad(b) {
        var x = X(); styly();
        var doKdy = (window.AGLic && AGLic.zakladDo) ? AGLic.zakladDo() : 0;
        var h = [x.hlava('Ukázat mi appku jako Základ', 'Jako vlastník máš vždycky všechno odemčené, takže to, co vidí tester bez Pro, ve svém telefonu nikdy neuvidíš. Tohle appku na chvíli přepne do Základu: zámky, zelená kytka, karta „Verze Pro". Pak se sama vrátí; nic se neodhlašuje, režim vlastníka běží dál.')];
        if (doKdy) h.push('<div class="agv-st">Teď: <b>Základ</b> ještě ' + Math.max(1, Math.ceil((doKdy - Date.now()) / 60000)) + ' min</div>');
        else h.push('<div class="agv-st">Teď: <b>Pro</b> (vlastník)</div>');
        h.push('<div class="agvp-min" style="margin-top:12px;">' + [15, 30, 60].map(function (m) { return '<button type="button" class="btn btn-primary" data-min="' + m + '" style="flex:1;margin:0;">' + m + ' min</button>'; }).join('') + '</div>');
        if (doKdy) h.push('<button type="button" class="btn btn-secondary" id="agvp-zak-zpet" style="width:100%;">Zpět na Pro hned</button>');
        h.push('<div class="agv-p" style="margin-top:12px;">Vlevo dole uvidíš štítek „Základ · N min" s tlačítkem Zpět na Pro. Konzole vlastníka zůstane dostupná.</div>');
        b.innerHTML = h.join('');
        x.wireZpet(b);
        Array.prototype.forEach.call(b.querySelectorAll('[data-min]'), function (el) {
            el.addEventListener('click', function () {
                if (!window.AGLic || !AGLic.zaklad) { x.agAlert('Nejde to', 'Chybí js/licence.js.'); return; }
                AGLic.zaklad(parseInt(el.getAttribute('data-min'), 10) || 15);
                zakladChip();
                try { if (typeof window.quickToast === 'function') quickToast('Appka se teď chová jako Základ.'); } catch (e) { swallow(e, 'toast'); }
                AGVlastnik.close();
            });
        });
        var z = b.querySelector('#agvp-zak-zpet'); if (z) z.addEventListener('click', function () { AGLic.zaklad(0); zakladChip(); viewZaklad(b); });
    }
    function zakladChip() {
        var doKdy = 0; try { doKdy = (window.AGLic && AGLic.zakladDo) ? AGLic.zakladDo() : 0; } catch (e) { doKdy = 0; }
        var ch = document.getElementById('ag-zaklad-chip');
        if (!doKdy) { if (ch) ch.remove(); return; }
        styly();
        if (!ch) {
            ch = document.createElement('div'); ch.id = 'ag-zaklad-chip';
            ch.innerHTML = '<span></span><button type="button">Zpět na Pro</button>';
            ch.querySelector('button').addEventListener('click', function () { try { AGLic.zaklad(0); } catch (e) { swallow(e, 'zaklad'); } zakladChip(); });
            document.body.appendChild(ch);
        }
        ch.querySelector('span').textContent = 'Základ · ' + Math.max(1, Math.ceil((doKdy - Date.now()) / 60000)) + ' min';
    }

    // ---- HLÁŠENÍ PRO VÝVOJ: všechno, co přišlo, v jednom textu -------------------------------
    // Přání vlastníka (13. 9. 2026): „ať se to všechno samo shrne na jednom místě a já ti to
    // pak akorát pošlu". Skládá se z nevyřízených zpráv (schránka), hodnocení, chyb z terénu
    // (/owner/errors, seskupené), verzí u lidí a protokolu chyb TOHOHLE telefonu. Výstup je
    // prostý text (Markdown), ať jde vložit do chatu s AI i do e-mailu.
    var _hl = null;
    function kdy(ts) { try { return new Date(+ts).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(ts); } }
    function metaObj(m) { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch (e) { return {}; } }
    function verzeAppky() { try { var l = document.querySelector('link[rel="stylesheet"][href*="css/style.css?v="]'); var m = l && (l.getAttribute('href') || '').match(/\?v=(\d+)/); return m ? 'v' + m[1] : '?'; } catch (e) { return '?'; } }
    function KINDS(k) { return { chyba: 'CHYBA', napad: 'NÁPAD', pochvala: 'POCHVALA', pro: 'ŽÁDOST O PRO', hodnoceni: 'HODNOCENÍ', jine: 'JINÉ' }[k] || String(k || 'jiné').toUpperCase(); }
    function slozHlaseni(d) {
        var L = [];
        L.push('# QTRIG — hlášení pro vývoj');
        L.push('Sestaveno ' + new Date().toLocaleString('cs-CZ') + ' · appka ' + verzeAppky() + (d.grafy && d.grafy.uctyCelkem != null ? ' · účtů celkem ' + d.grafy.uctyCelkem : ''));
        L.push('');
        var msgs = (d.fb && d.fb.messages) || [];
        var hodn = msgs.filter(function (m) { return m.kind === 'hodnoceni'; });
        var ost = msgs.filter(function (m) { return m.kind !== 'hodnoceni'; });
        L.push('## Nevyřízené zprávy od lidí (' + ost.length + ')');
        if (!ost.length) L.push('(žádné)');
        ost.forEach(function (m, i) {
            var mo = metaObj(m.meta);
            var hl = '' + (i + 1) + '. [' + KINDS(m.kind) + '] ' + (m.who || 'anonym') + ' · ' + kdy(m.ts) + (mo.v ? ' · v' + mo.v : '') + (mo.ua ? ' · ' + String(mo.ua).replace(/^Mozilla\/5\.0 \(/, '').slice(0, 60) : '') + (m.contact ? ' · kontakt: ' + m.contact : '');
            L.push(hl);
            L.push('   „' + String(m.txt || '').replace(/\s+/g, ' ').trim() + '"');
            var co = mo.co || {};
            var kde = [];
            if (co.okno) kde.push('okno ' + co.okno);
            if (co.nastroj) kde.push('nástroj ' + co.nastroj);
            if (co.bodu != null) kde.push(co.bodu + ' bodů');
            if (co.gps) kde.push('GPS ' + co.gps);
            if (co.online != null) kde.push(co.online ? 'online' : 'offline');
            if (co.chyby && co.chyby.length) kde.push('chyby: ' + co.chyby.slice(0, 3).join(' | '));
            if (kde.length) L.push('   Přiloženo: ' + kde.join(' · '));
        });
        L.push('');
        L.push('## Hodnocení „Jak ti to sedí?" (' + hodn.length + ')');
        if (!hodn.length) L.push('(zatím žádné)');
        hodn.forEach(function (m) { L.push('- ' + (m.who || 'anonym') + ' · ' + kdy(m.ts) + ': ' + String(m.txt || '').replace(/\s+/g, ' ').trim()); });
        L.push('');
        var er = d.errors || {};
        L.push('## Chyby z terénu za ' + (er.dni || 14) + ' dní (' + (er.total || 0) + ' výskytů, ' + ((er.rows || []).length) + ' různých)');
        if (!(er.rows || []).length) L.push('(žádné)');
        (er.rows || []).slice(0, 25).forEach(function (r) {
            L.push('- ' + (r.n || 1) + '× ' + String(r.msg || r.sig || '?').slice(0, 160) + (r.src ? ' — ' + String(r.src).replace(/^.*\//, '') + (r.line ? ':' + r.line : '') : '') + (r.firms ? ' — ' + r.firms + ' fir.' : '') + (r.ver ? ' — ' + r.ver : '') + (r.last ? ' — naposled ' + kdy(r.last) : ''));
        });
        if ((er.verze || []).length) L.push('Podle verze: ' + er.verze.map(function (v) { return (v.ver || '?') + ' ' + (v.n || 0) + '×'; }).join(', '));
        L.push('');
        if (d.grafy && (d.grafy.verze || []).length) {
            L.push('## Kdo jede na které verzi');
            L.push(d.grafy.verze.map(function (v) { return (v.ver || 'neznámá') + ': ' + v.n; }).join(', '));
            L.push('');
        }
        var loc = [];
        try { loc = (window.agErrLog && agErrLog.list && agErrLog.list()) || []; } catch (e) { loc = []; }
        L.push('## Chyby na tomhle telefonu (protokol chyb, posledních ' + Math.min(10, loc.length) + ' z ' + loc.length + ')');
        if (!loc.length) L.push('(protokol je prázdný)');
        loc.slice(-10).reverse().forEach(function (e) { L.push('- ' + (e.n > 1 ? e.n + '× ' : '') + String(e.msg || e.sig || '?').slice(0, 160) + (e.src ? ' — ' + String(e.src).replace(/^.*\//, '') + (e.line ? ':' + e.line : '') : '') + (e.t ? ' — ' + kdy(e.t) : '')); });
        return L.join('\n');
    }
    function viewHlaseni(b) {
        var x = X(); styly();
        if (!_hl) {
            x.cekam(b, 'Sbírám zprávy, hodnocení a chyby…');
            Promise.all([api('/feedback?stav=open'), api('/owner/errors?dni=14'), api('/owner/grafy')]).then(function (rs) {
                if (!plati('hlaseni')) return;
                if (!rs[0].ok && !rs[1].ok) { x.sayFail(rs[0], 'hlášení'); jdi(''); return; }
                _hl = { fb: rs[0].ok ? rs[0].data : { messages: [] }, errors: rs[1].ok ? rs[1].data : {}, grafy: rs[2].ok ? rs[2].data : null };
                _hl.txt = slozHlaseni(_hl);
                viewHlaseni(b);
            });
            return;
        }
        var h = [x.hlava('Hlášení pro vývoj', 'Všechno, co přišlo, v jednom textu: nevyřízené zprávy, hodnocení, chyby z terénu (14 dní), verze u lidí a protokol chyb tohohle telefonu. <b>Zkopíruj a pošli autorovi nebo AI</b> — nic víc.')];
        h.push('<div class="agvp-btns"><button type="button" class="btn" id="agvp-hl-copy">Zkopírovat</button>' +
            (navigator.share ? '<button type="button" class="btn btn-secondary" id="agvp-hl-share">Sdílet…</button>' : '') +
            '<button type="button" class="btn btn-secondary" id="agvp-hl-dl">Stáhnout .md</button>' +
            '<button type="button" class="btn btn-secondary" id="agvp-hl-rf">Znovu</button></div>');
        h.push('<div class="agvp-pre" id="agvp-hl-pre"></div>');
        b.innerHTML = h.join('');
        b.querySelector('#agvp-hl-pre').textContent = _hl.txt;
        x.wireZpet(b);
        b.querySelector('#agvp-hl-rf').addEventListener('click', function () { _hl = null; viewHlaseni(b); });
        b.querySelector('#agvp-hl-dl').addEventListener('click', function () { ulozSoubor('qtrig-hlaseni-' + new Date().toISOString().slice(0, 10) + '.md', _hl.txt, 'text/markdown;charset=utf-8'); });
        b.querySelector('#agvp-hl-copy').addEventListener('click', function () {
            var t = _hl.txt, btn = this;
            var hotovo = function () { btn.textContent = 'Zkopírováno ✓'; setTimeout(function () { btn.textContent = 'Zkopírovat'; }, 2500); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(hotovo, function () { vyber(); });
            else vyber();
            function vyber() { try { var r = document.createRange(); r.selectNodeContents(b.querySelector('#agvp-hl-pre')); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy'); hotovo(); } catch (e) { swallow(e, 'copy'); } }
        });
        var sh = b.querySelector('#agvp-hl-share');
        if (sh) sh.addEventListener('click', function () { try { navigator.share({ title: 'QTRIG — hlášení pro vývoj', text: _hl.txt }); } catch (e) { swallow(e, 'share'); } });
    }

    function view(name, b) {
        if (name === 'prehled') { viewPrehled(b); return true; }
        if (name === 'hlaseni') { viewHlaseni(b); return true; }
        if (name === 'grafy') { viewGrafy(b); return true; }
        if (name === 'denik') { viewDenik(b); return true; }
        if (name === 'kalendar') { viewKalendar(b); return true; }
        if (name === 'zaloha') { viewZaloha(b); return true; }
        if (name === 'vydani') { viewVydani(b); return true; }
        if (name === 'pohled') { viewPohled(b); return true; }
        if (name === 'trychtyr') { viewTrychtyr(b); return true; }
        if (name === 'kapacita') { viewKapacita(b); return true; }
        if (name === 'uklid') { viewUklid(b); return true; }
        if (name === 'push') { viewPush(b); return true; }
        if (name === 'zaklad') { viewZaklad(b); return true; }
        return false;
    }

    function tik() { try { badge(); zakladChip(); } catch (e) { swallow(e, 'tik'); } }
    (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(tik, 4000);
    setTimeout(tik, 1500);

    // zapomen(): paměť pohledů propadne (data zůstanou pro štítek „z 18:40, nenačteno"); zapomen(true) = smazat úplně
    function zapomen(vse) { _cacheTs = 0; _g14Ts = 0; if (vse) { _cache = null; _grafy = null; _g14 = null; _hl = null; _tr = null; } }
    window.AGVlastnikPlus = { view: view, dashboard: dashboard, items: function () { return []; }, pohled: pohled, csv: csv, ulozSoubor: ulozSoubor, badge: badge, zapomen: zapomen };
})();
