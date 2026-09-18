// ===== QTRIG — NÁSTROJE JAKO LISTOVÁNÍ PO SLOVESECH (ODPOJITELNÁ vrstva) ======
// PROBLÉM (původní, 2026): Nástroje měly 70 dlaždic v 6 kategoriích. Kategorie
// „Pomůcky" jich nesla 23 a byla to skládka, dlaždice byly zatoulané a hledat mezi
// ikonami v rukavicích na slunci je pomalé — geodet neví „která ikona", ví „co
// chci udělat". Proto seznam SLOVES: Změřit · Určit nový bod · Vytyčit · …
//
// PROBLÉM DRUHÝ (15. 9. 2026, přání uživatele): k nástroji vedly TŘI cesty —
// klepnutí (svislý seznam všech sloves, 4 470 px, sedm obrazovek), podržení
// tlačítka (kytka, js/kolecko-nastroju.js) a gesta — „je to hodně, je to složitý
// a ani jedno není dostatečně přehledný … pokud se chceš prolistovat a něco
// dohledat nebo zkoušet, tak nic není pro to ideální." Rozhodnutí:
//   • DVĚ cesty místo tří: tenhle panel = LISTOVAT A ZKOUŠET, gesta = spustit
//     zpaměti. Kytka je pryč (soubor smazán, tlačítko Nástroje jen otevírá panel).
//   • JEDNO SLOVESO = JEDNA STRÁNKA. Nahoře pásek sloves (zároveň mapa celé
//     appky), pod ním stránka s 3–10 řádky, která se vejde na displej. Mezi
//     stránkami se listuje tahem do strany (scroll-snap, nativní) nebo klepnutím
//     na sloveso. Dole je napsáno, co je vlevo a vpravo.
//   • PRVNÍ STRÁNKA „MOJE": Pokračovat (naposledy použitý), volba typu práce
//     (pás „Co dnes děláš" z js/rezim-prace.js se sem PŘESTĚHUJE), ★ Připnuté
//     s gestem a ◆ Pro tuto práci. Dřív každý z těchhle organizátorů stál ve
//     vlastní sekci NAD seznamem a první nástroj byl až v půlce displeje.
//     Panel je tím zároveň TAHÁK NA GESTA — kdo si gesto nezapamatoval, vidí ho
//     tam, kde nástroj hledá, ne v Nastavení pod osmi přepínači.
//   • POSLEDNÍ STRÁNKA „PRO" (jen v Základu): zamčené Pro nástroje NEJSOU
//     rozházené ve slovesech („aby to bylo stranou a nepřekáželo"), sejdou se
//     na dvanácté stránce se slovesem v popisku. Kdo Pro má, tu stránku nevidí.
//     Dřív totéž jako sekce „Ve verzi Pro" na konci sloupce (12. 9. 2026).
//   • ROZCESTNÍKY se ROZBALUJÍ NA MÍSTĚ (řádek se šipkou ›), ne do druhého okna
//     — při listování bylo druhé okno slepá ulička. Položky se stavějí až při
//     prvním rozbalení (levnější a v sbaleném stavu v seznamu nestojí, viz
//     test_uhlazeni_31_8 B3). Okno z js/tools-hub.js zůstává pro mřížku/hledání.
//   • ★ PŘIPNOUT je rovnou v řádku (hvězdička vpravo). Dřív „Upravit oblíbené"
//     přepínalo hvězdičky na DLAŽDICÍCH mřížky — kterou tenhle pohled schovává,
//     takže tlačítko v seznamu nedělalo nic viditelného. Klíč je pořád
//     agToolFavs_v1 z js/tools-plus.js (mřížka při hledání ho čte dál).
//   • Sbalování skupin (agUkonyClosed_v1) zaniklo — stránky ho nahrazují.
//   (nasazeno jako v332)
//
// KLÍČOVÉ (nezměněno): seznam si NEVEDE vlastní nástroje. Každý řádek jen KLIKNE
// na svou (schovanou) dlaždici v mřížce — takže dál platí všechno, co na mřížce
// staví ostatní moduly: počítadlo použití, návody (?), návrat do Nástrojů,
// oprávnění rolí, zámky Pro (js/pro-zamky.js věší data-agpro i na .ag-uk-i).
// Co v mapě sloves není (nový modul, který přibude potom), spadne na stránku
// „Další" — nikdy nezmizí.
//
// Mřížka `.tool-grid` zůstává v DOM jako KLIKACÍ CÍL a ukazuje se při HLEDÁNÍ
// (tam běží chytré vyhledávání z field-tools.js — synonyma, překlepy, řazení).
// Jakmile začneš psát, `body.ag-uk-on` spadne a je vidět mřížka; po smazání
// dotazu se vrátí listování.
//
// ⚠⚠ STROP: DALŠÍ POVRCH „JAK NAJÍT NÁSTROJ" UŽ NEPŘIDÁVAT (zapsáno 5. 9. 2026,
// 15. 9. jeden ubrán). Do jednoho nástroje vede: tenhle panel · mřížka při
// hledání · rozcestníky (v mřížce) · gesta · globální hledání · mini panel ·
// jednoduchý režim · průvodci. Každý nový nástroj se musí chovat správně ve
// všech. LEVNÝ PRŮBĚŽNÝ KROK: slučovat do rozcestníků (`inhub` v registru).
//
// ⚠ TAH DO STRANY UVNITŘ OKNA: js/modal-close.js zavírá okno tahem zleva
// doprava, ale tah, který začne v prvku s vodorovným rolováním (scrollWidth >
// clientWidth), nezakládá — pásek sloves i stránky jsou přesně takové prvky,
// takže se v nich listuje a okno se zavírá tahem přes hlavičku/hledání.
// `.modal-body{touch-action:pan-y}` (css/style.css) vodorovný tah NEBLOKUJE:
// rozhoduje touch-action mezi dotčeným prvkem a nejbližším rolovacím předkem,
// a tím je tady .ag-uk-pages (má pan-x pan-y).
//
// Odstranění: smaž js/nastroje-ukony.js + řádek <script> v index.html
// (a přegeneruj sw.js). Nástroje pak ukazují jen mřížku dlaždic.
// ================================================================================
(function () {
    'use strict';
    if (window.AGUkony) return;

    var STYLE_ID = 'ag-uk-style', LIST_ID = 'ag-uk-list', SEG_ID = 'ag-uk-seg';
    var FAV_KEY = 'agToolFavs_v1';          // týž klíč jako js/tools-plus.js
    var PAGE_MOJE = 'moje', PAGE_PRO = 'pro', PAGE_DALSI = 'dalsi';

    // ---- mapa sloves --------------------------------------------------------------
    // Slovesa i popisky jsou v js/tools-registry.js (jeden záznam na nástroj) a sem
    // přijdou hotové ve tvaru [{ t: 'Změřit', items: [{ k, l, h }] }]. Bez registru
    // zůstane listování bez sloves a všechny nástroje spadnou na stránku „Další".
    var GROUPS = (window.AGReg && window.AGReg.groups()) || [];
    // student-start (13. 9. 2026): kdo v „Kdo jsi?" řekl Student, má „Učit se" jako
    // první sloveso; ostatním zůstává na konci. Čte se při každém vykreslení.
    function poradiSkupin() {
        var stud = false, gs = GROUPS;
        try { stud = !!(window.AGProfilOsoby && AGProfilOsoby.je('student')); } catch (e) { stud = false; }
        try { gs = (window.AGReg && AGReg.groups()) || GROUPS; } catch (e) { gs = GROUPS; }   // čerstvé popisky (rozcestníky, Parta a účty)
        if (!stud) return gs;
        return gs.filter(function (g) { return g.t === 'Učit se'; }).concat(gs.filter(function (g) { return g.t !== 'Učit se'; }));
    }
    // KRÁTKÉ NÁZVY DO PÁSKU: na 390 px se jich vejde sedm, delší se dorolují palcem.
    // Klíčem je plný název slovesa z registru; co tu není, jde do pásku celé.
    var KRATCE = { 'Určit nový bod': 'Nový bod', 'Zjistit podmínky': 'Podmínky', 'Katastr a podklady': 'Katastr',
                   'Firma a papíry': 'Firma', 'Příručka a výpočty': 'Příručka', 'Přesné měření': 'Přesně měřit' };

    // ROZCESTNÍKY (js/tools-hub.js): v seznamu je rozcestník JEDEN řádek, položky se
    // samostatně nevypisují (`inhub`), rozbalí se pod ním.
    //   inhub  = položka rozcestníku — v seznamu ji zastupuje řádek rozcestníku
    //   hidden = „ať to není vidět" (řádek ani dlaždice); najde se dál hledáním
    //   noverb = zamerne bez slovesa, na stránku „Další" PATŘÍ
    var INHUB = {}, NOVERB = {}, HIDDEN = {}, HUB = {};
    ((window.AGReg && window.AGReg.all()) || []).forEach(function (r) {
        if (r.inhub) INHUB[r.k] = r.inhub;
        if (r.noverb) NOVERB[r.k] = 1;
        if (r.hidden) HIDDEN[r.k] = 1;
        if (r.hub) HUB[r.k] = 1;
    });
    // POJISTKA: když se js/tools-hub.js nenačte (je lazy, nebo ho někdo odpojil),
    // jeho dlaždice v mřížce není — položky by pak zmizely ÚPLNĚ. Proto se položka
    // skryje jen tehdy, když dlaždice jejího rozcestníku OPRAVDU existuje.
    function vHubu(k) { var h = INHUB[k]; return !!(h && findTile(h)); }

    var KNOWN = {};
    GROUPS.forEach(function (g) { g.items.forEach(function (it) { KNOWN[it.k] = 1; }); });
    var _restWarned = false;   // hlášení o nezařazených nástrojích jen jednou za běh

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function modal() { return document.getElementById('tools-modal'); }
    function grid() { var m = modal(); return m ? m.querySelector('.tool-grid') : null; }
    function searchVal() { var i = document.getElementById('tools-search'); return i ? (i.value || '').trim() : ''; }
    function swallow(e, kde) { if (window.AG && AG.swallow) AG.swallow(e, 'nastroje-ukony:' + kde); }
    function view() { return 'ukony'; }

    // klíč dlaždice — stejná logika jako v ostatních modulech mřížky
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool');
        if (dt) return dt;
        var ms = (tile.getAttribute('onclick') || '').match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function tileLabel(tile) {
        var s = tile.querySelector('span');
        var d = document.createElement('div');
        d.innerHTML = ((s ? s.innerHTML : tile.innerHTML) || '').replace(/<br\s*\/?>/gi, ' ');
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function findTile(key) {
        var g = grid(); if (!g) return null;
        var tiles = g.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) {
            if (tileKey(tiles[i]) !== key) continue;
            // Oprávnění podle role se v appce VYMÁHAJÍ SKRYTÍM dlaždice (ucty.js
            // applyPerms nastaví display:none + data-agucty). Bez téhle podmínky by
            // seznam zaměstnanci ukázal a přes t.click() i spustil nástroj, na který
            // nemá právo. Záměrně se testuje JEN data-agucty: dlaždice skryté
            // zjednodušením Nástrojů (usadit-ar, tools-simple) mají v seznamu zůstat.
            if (tiles[i].hasAttribute('data-agucty')) return null;
            // Nástroje, které si uživatel sám schoval v „Moje aktivita" (data-ag-hidden),
            // nemá cenu držet ani tady — jinak by schování zdánlivě nic nedělalo.
            if (tiles[i].hasAttribute('data-ag-hidden')) return null;
            return tiles[i];
        }
        return null;
    }
    // Spuštění = klik na původní dlaždici. Tím se započítá použití, zafunguje
    // návrat do Nástrojů i skrytí dlaždic podle role — nic se neobchází.
    function run(key) {
        var t = findTile(key);
        if (t) { t.click(); return true; }
        return false;
    }
    function iconOf(key) {
        var t = findTile(key); if (!t) return '';
        var svg = t.querySelector('svg');
        return svg ? svg.outerHTML : '';
    }

    // ---- styly ----------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + LIST_ID + '{display:none;}',
            'body.ag-uk-on #' + LIST_ID + '{display:block;}',
            'body.ag-uk-on #tools-modal .tool-grid{display:none !important;}',
            // tlačítko „Upravit oblíbené" (js/tools-plus.js) patří k mřížce — hvězdička je tu v řádku
            'body.ag-uk-on #ag-tp-editbtn{display:none !important;}',
            // ---- pásek sloves: slepený nahoře, roluje vodorovně, bez posuvníku
            '.ag-uk-tabs{position:sticky;top:0;z-index:4;display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;',
            '  margin:0 0 8px;padding:6px 2px 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;',
            '  background:var(--modal-bg,rgba(14,18,24,0.97));',
            '  border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.12));}',
            '.ag-uk-tabs::-webkit-scrollbar{display:none;}',
            'body.outdoor-mode .ag-uk-tabs{background:#0a0e1a;}',
            'body.light-mode.outdoor-mode .ag-uk-tabs{background:#fff;}',
            '.ag-uk-tab{flex:0 0 auto;-webkit-appearance:none;appearance:none;cursor:pointer;white-space:nowrap;',
            '  padding:8px 12px;border-radius:999px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:transparent;color:var(--text-muted,#9aa1ac);',
            '  font:600 calc(13px * var(--ag-font-scale, 1))/1 var(--font-ui,system-ui),sans-serif;',
            '  -webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;}',
            '.ag-uk-tab[aria-selected="true"]{background:var(--accent,#2f9e74);border-color:var(--accent,#2f9e74);color:#08130e;}',
            '.ag-uk-tab.ag-uk-tab-pro{color:#e6bd76;border-color:rgba(230,189,118,.45);}',
            '.ag-uk-tab.ag-uk-tab-pro[aria-selected="true"]{background:#e6bd76;border-color:#e6bd76;color:#1a1408;}',
            '.ag-uk-tab:focus-visible{outline:2px solid var(--accent,#2f9e74);outline-offset:2px;}',
            'body.ag-glove .ag-uk-tab{padding:10px 14px;}',
            // ---- stránky: vodorovný pás se zarážkami, výšku určuje AKTIVNÍ stránka (JS)
            '.ag-uk-pages{display:flex;align-items:flex-start;overflow-x:auto;overflow-y:hidden;',
            '  scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;',
            '  touch-action:pan-x pan-y;overscroll-behavior-x:contain;transition:height .18s ease;}',
            '.ag-uk-pages::-webkit-scrollbar{display:none;}',
            '@media (prefers-reduced-motion: reduce){.ag-uk-pages{transition:none;}}',
            '.ag-uk-page{flex:0 0 100%;width:100%;box-sizing:border-box;scroll-snap-align:start;scroll-snap-stop:always;padding:0 1px;}',
            // hlavička stránky / sekce (titulek + počet)
            '.ag-uk-h{display:flex;align-items:baseline;gap:8px;margin:0 0 7px;padding:6px 2px 7px;',
            '  border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  font:700 11px/1 var(--font-display,system-ui),sans-serif;',
            '  letter-spacing:.09em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.ag-uk-h .ag-uk-n{margin-left:auto;font-weight:600;font-size:calc(10.5px * var(--ag-font-scale, 1));',
            '  letter-spacing:.02em;color:var(--text-faint,#7b828c);}',
            '.ag-uk-h .ag-uk-hint{margin-left:auto;font-weight:500;font-size:calc(10.5px * var(--ag-font-scale, 1));',
            '  letter-spacing:0;text-transform:none;color:var(--text-faint,#7b828c);}',
            '.ag-uk-g{margin:0 0 14px;}',
            '.ag-uk-owner > .ag-uk-h > span:first-child{color:#d4a02c;}',
            '.ag-uk-owner .ag-uk-i{border-color:rgba(212,160,44,.45);}',
            '.ag-uk-fav > .ag-uk-h > span:first-child{color:var(--warning,#fbbf24);}',
            // ---- řádek nástroje
            '.ag-uk-i{display:flex;align-items:center;gap:11px;width:100%;box-sizing:border-box;position:relative;',
            '  margin:0 0 6px;padding:12px 11px 12px 13px;border-radius:12px;text-align:left;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.10));',
            '  background:var(--surface-1,rgba(255,255,255,0.045));color:inherit;',
            '  font:inherit;-webkit-tap-highlight-color:transparent;}',
            '.ag-uk-i:active{background:var(--accent-soft,rgba(47,158,116,0.15));',
            '  border-color:var(--accent-line,rgba(47,158,116,0.4));}',
            '.ag-uk-i:focus-visible{outline:2px solid var(--accent,#2f9e74);outline-offset:2px;}',
            '.ag-uk-ico{flex:0 0 auto;width:22px;height:22px;color:var(--accent,#2f9e74);}',
            '.ag-uk-ico svg{width:22px;height:22px;}',
            '.ag-uk-tx{flex:1 1 auto;min-width:0;}',
            '.ag-uk-tx b{display:block;font-size:calc(14.5px * var(--ag-font-scale, 1));font-weight:600;line-height:1.3;}',
            '.ag-uk-tx small{display:block;margin-top:2px;font-size:calc(12px * var(--ag-font-scale, 1));line-height:1.35;',
            '  color:var(--text-muted,#9aa1ac);}',
            // pravá strana řádku: gesto · ★ · ? · ›  (jsou to <i>, ne tlačítka — leží uvnitř <button>)
            '.ag-uk-r{flex:0 0 auto;display:flex;align-items:center;gap:4px;margin-left:2px;}',
            '.ag-uk-r i{font-style:normal;display:flex;align-items:center;justify-content:center;',
            '  width:30px;height:30px;border-radius:50%;color:var(--text-muted,#9aa1ac);',
            '  font:700 calc(12.5px * var(--ag-font-scale, 1))/1 var(--font-ui,system-ui);}',
            '.ag-uk-r i.ag-uk-q{border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.05);}',
            '.ag-uk-r i.ag-uk-q:active{color:var(--accent,#2f9e74);}',
            '.ag-uk-r i.ag-uk-star{font-size:calc(16px * var(--ag-font-scale, 1));color:var(--text-faint,#7b828c);opacity:.7;}',
            '.ag-uk-r i.ag-uk-star.on{color:var(--warning,#fbbf24);opacity:1;}',
            // gesto: šipky ve zlaté (jako v okně Gesta); chybějící gesto u připnutého = čárkovaná pilulka
            '.ag-uk-r i.ag-uk-gest{width:auto;height:26px;padding:0 8px;border-radius:8px;letter-spacing:.06em;',
            '  color:#e6bd76;background:rgba(230,189,118,.12);font-weight:600;font-size:calc(12px * var(--ag-font-scale, 1));}',
            '.ag-uk-r i.ag-uk-gest.ag-uk-gest-add{color:var(--text-faint,#7b828c);background:transparent;',
            '  border:1px dashed var(--glass-border,rgba(255,255,255,0.22));font-weight:500;letter-spacing:0;}',
            // rozcestník: šipka › se otočí dolů, položky pod ním s linkou vlevo
            '.ag-uk-r i.ag-uk-chev::before{content:"";width:7px;height:7px;box-sizing:border-box;',
            '  border-right:1.8px solid currentColor;border-bottom:1.8px solid currentColor;border-radius:1px;',
            '  transform:rotate(-45deg);transition:transform .16s ease;}',
            '.ag-uk-i[aria-expanded="true"] .ag-uk-r i.ag-uk-chev::before{transform:rotate(45deg);}',
            '@media (prefers-reduced-motion: reduce){.ag-uk-r i.ag-uk-chev::before{transition:none;}}',
            '.ag-uk-sub{position:relative;margin:-2px 0 8px;padding-left:20px;}',
            '.ag-uk-sub::before{content:"";position:absolute;left:8px;top:4px;bottom:10px;width:2px;border-radius:2px;',
            '  background:var(--glass-border,rgba(255,255,255,0.14));}',
            '.ag-uk-sub .ag-uk-i{padding:10px 10px 10px 12px;}',
            '.ag-uk-sub .ag-uk-tx b{font-size:calc(13.5px * var(--ag-font-scale, 1));}',
            '.ag-uk-sub .ag-uk-ico,.ag-uk-sub .ag-uk-ico svg{width:19px;height:19px;}',
            // zámek Pro (js/pro-zamky.js kreslí ::after vpravo) — nechat mu místo za „?"
            '.ag-uk-i[data-agpro="1"]{padding-right:32px;}',
            // blok „Pokračovat" nahoře na Moje
            '.ag-uk-now{margin:0 0 14px;padding:11px 13px;border-radius:12px;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.38));',
            '  background:var(--accent-soft,rgba(47,158,116,0.13));}',
            '.ag-uk-now .ag-uk-i{background:transparent;border:0;margin:0;padding:6px 0;}',
            // pás „Co dnes děláš" (js/rezim-prace.js) uvnitř Moje: bez vlastního odsazení navrch
            '.ag-uk-page #ag-rp-wrap{margin-top:0;}',
            // prázdné „Připnuté": jedna věta, co s tím
            '.ag-uk-empty{margin:0 0 12px;padding:10px 12px;border-radius:10px;border:1px dashed var(--glass-border,rgba(255,255,255,0.18));',
            '  font-size:calc(12.5px * var(--ag-font-scale, 1));line-height:1.4;color:var(--text-muted,#9aa1ac);}',
            // stránka Pro: zlatý nadpis se zámkem, úvodní věta, slovesa jako drobné titulky
            '.ag-uk-pro > .ag-uk-h > span:first-child{color:#e6bd76;}',
            '.ag-uk-pro > .ag-uk-h > span:first-child::before{content:"";display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-1px;',
            '  background:#e6bd76;-webkit-mask:var(--ag-pro-mask) center/12px 12px no-repeat;mask:var(--ag-pro-mask) center/12px 12px no-repeat;}',
            '.ag-uk-pro .ag-uk-intro{margin:0 0 10px;font-size:calc(12.5px * var(--ag-font-scale, 1));line-height:1.45;color:var(--text-muted,#9aa1ac);}',
            '.ag-uk-pro .ag-uk-intro button{margin-top:8px;width:100%;padding:9px;border-radius:10px;cursor:pointer;',
            '  border:1px solid rgba(230,189,118,.5);background:rgba(230,189,118,.1);color:#e6bd76;font:600 calc(13px * var(--ag-font-scale, 1)) var(--font-ui,system-ui);}',
            '.ag-uk-cap{margin:10px 2px 6px;font:600 calc(11px * var(--ag-font-scale, 1))/1 var(--font-ui,system-ui);letter-spacing:.06em;',
            '  text-transform:uppercase;color:var(--text-faint,#7b828c);}',
            '.ag-uk-cap:first-of-type{margin-top:2px;}',
            // patička pod stránkami: co je vlevo a vpravo (klikací)
            '.ag-uk-nav{display:flex;justify-content:space-between;gap:8px;margin:6px 0 0;padding:8px 0 4px;',
            '  border-top:1px solid var(--glass-border,rgba(255,255,255,0.10));}',
            '.ag-uk-nav button{-webkit-appearance:none;appearance:none;border:0;background:transparent;cursor:pointer;padding:6px 2px;',
            '  color:var(--text-muted,#9aa1ac);font:500 calc(12.5px * var(--ag-font-scale, 1)) var(--font-ui,system-ui);}',
            '.ag-uk-nav button b{color:var(--text-color,#e9eef7);font-weight:600;}',
            '.ag-uk-nav button:empty{visibility:hidden;}',
            // patička Moje — co se dělá zřídka (průvodce)
            '.ag-uk-foot{margin:14px 0 0;padding-top:10px;border-top:1px solid var(--glass-border,rgba(255,255,255,0.10));}',
            '.ag-uk-foot .ag-uk-i{background:transparent;}',
            'body.ag-glove .ag-uk-i{padding:15px 12px 15px 14px;}',
            'body.ag-glove .ag-uk-tx b{font-size:calc(15.5px * var(--ag-font-scale, 1));}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // Přepínač „Úkony / Vše" byl TADY, zrušen 31. 8. 2026. Zbytek po něm uklidíme,
    // kdyby v DOM zůstal ze starší verze appky:
    function dropSeg() {
        var seg = document.getElementById(SEG_ID);
        if (seg && seg.parentNode) seg.parentNode.removeChild(seg);
    }

    // ---- „Pokračovat" — naposledy použitý nástroj (js/pokracovat.js) ----------------
    function lastTool() {
        var r; try { r = JSON.parse(localStorage.getItem('agLastTool_v1')); } catch (e) { return null; }
        if (!r || !r.key || !r.ts) return null;
        if (Date.now() - r.ts > 48 * 3600 * 1000) return null;
        return findTile(r.key) ? r : null;
    }
    function nowBlock() {
        var rec = lastTool();
        if (!rec) return null;
        var box = document.createElement('div');
        box.className = 'ag-uk-now';
        box.appendChild(item({ l: 'Pokračovat: ' + rec.label, h: 'naposledy použitý nástroj' }, function () { run(rec.key); }));
        return box;
    }
    // Průvodce úkolem („Poradit, co použít") — dole na Moje, nestojí v cestě.
    function footBlock() {
        var box = document.createElement('div');
        box.className = 'ag-uk-foot';
        if (typeof window.openPruvodce === 'function') {
            box.appendChild(item({ l: 'Poradit, co použít', h: 'průvodce úkolem' }, function () {
                var m = modal(); if (m) m.style.display = 'none';
                try { window.openPruvodce(); } catch (e) { swallow(e, 'footBlock'); }
            }));
        }
        return box;
    }

    // ---- oblíbené (★ připnuté) a gesta --------------------------------------------------
    function favKeys() {
        try { var a = JSON.parse(localStorage.getItem(FAV_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    function toggleFav(k) {
        var a = favKeys(), ix = a.indexOf(k);
        if (ix === -1) a.push(k); else a.splice(ix, 1);
        try { localStorage.setItem(FAV_KEY, JSON.stringify(a)); } catch (e) { swallow(e, 'toggleFav'); }
        try { if (typeof window.quickToast === 'function') window.quickToast(ix === -1 ? 'Připnuto do Moje' : 'Odepnuto'); } catch (e) { swallow(e, 'toggleFav:toast'); }
        build();   // hned — tik by to přestavěl až za 1,4 s
    }
    // Gesto nástroje: js/gesta-zkratky.js vede mapu {kód: klíč}; tady se jen čte.
    var SIPKA = { U: '↑', D: '↓', L: '←', R: '→' };
    function sipky(code) { var s = ''; for (var i = 0; i < (code || '').length; i++) s += SIPKA[code.charAt(i)] || ''; return s; }
    function gestoPro(k) {
        try {
            if (!window.AGGesta || !AGGesta.get) return null;
            var g = AGGesta.get(); if (!g || g.off || !g.map) return null;
            for (var c in g.map) if (g.map[c] === k) return sipky(g.prefix) + ' ' + sipky(c);
        } catch (e) { swallow(e, 'gestoPro'); }
        return null;
    }
    function gestaZapnuta() { try { return !!(window.AGGesta && AGGesta.assignFor && !AGGesta.get().off); } catch (e) { return false; } }

    // tools-simple.js značí dlaždice zvoleného typu práce atributem data-ag-ts
    function profileKeys() {
        var g = grid(); if (!g) return [];
        var t = g.querySelectorAll('.tool-tile[data-ag-ts="1"]'), out = [];
        for (var i = 0; i < t.length; i++) { var k = tileKey(t[i]); if (k) out.push(k); }
        return out;
    }
    function profileLabel() {
        try {
            if (window.AGToolsSimple && AGToolsSimple.profiles) {
                var pid = localStorage.getItem('arActiveProjectId') || 'default';
                var id = localStorage.getItem('agWorkProfile::' + pid);
                if (!id || id === 'univerzal') return '';
                var p = AGToolsSimple.profiles[id];
                if (p && p.label) return p.label;
            }
        } catch (e) { swallow(e, 'profileLabel'); }
        var s = document.getElementById('ag-ts-profsel');
        if (!s || !s.options || s.selectedIndex < 0) return '';
        var v = s.options[s.selectedIndex];
        return (v && v.value !== 'univerzal') ? v.text : '';
    }
    // Táž dvojice podmínek jako zamceno() v js/pro-zamky.js — bez atributu
    // data-agpro z dlaždice, ten věší pro-zamky.js až po svém tiku.
    function zamceno(k) {
        try {
            if (window.AGProZamky && typeof AGProZamky.zamceno === 'function') return !!AGProZamky.zamceno(k);
            return !!(k && window.AGReg && AGReg.isPro && AGReg.isPro(k) && !(window.AGLic && AGLic.isPro()));
        } catch (e) { return false; }
    }

    function gridSig() {
        var g = grid(); if (!g) return '';
        var tiles = g.querySelectorAll('.tool-tile'), out = [];
        for (var i = 0; i < tiles.length; i++) { var k = tileKey(tiles[i]); if (k) out.push(k); }
        out.sort();
        // do otisku patří i personalizace (připnuté, typ práce, gesta), licence
        // (po odemčení Pro se stránka Pro rozpustí do sloves), režim vlastníka a „Kdo jsi"
        var pro = '0', own = '0', kdo = '', gz = '';
        try { pro = (window.AGLic && AGLic.isPro && AGLic.isPro()) ? '1' : '0'; } catch (e) { pro = '0'; }
        try { own = (window.AGVlastnik && AGVlastnik.isOn && AGVlastnik.isOn()) ? '1' : '0'; } catch (e) { own = '0'; }
        try { kdo = (window.AGProfilOsoby && AGProfilOsoby.get()) || ''; } catch (e) { kdo = ''; }
        try { if (window.AGGesta && AGGesta.get) { var gg = AGGesta.get(); gz = (gg.off ? 'x' : gg.prefix) + JSON.stringify(gg.map || {}); } } catch (e) { gz = ''; }
        return out.join(',') + '|f:' + favKeys().join(',') + '|p:' + profileKeys().join(',') + '|pro:' + pro + '|own:' + own + '|kdo:' + kdo + '|g:' + gz;
    }

    // ---- řádek nástroje -------------------------------------------------------------------
    // `key` se zapisuje do data-k. Seznam ho sám nepotřebuje (nástroj spouští closure
    // v onClick), ale odpojitelné vrstvy nad ním ano — js/gesta-zkratky.js podle něj
    // pozná, kterému nástroji přiřadit gesto při podržení řádku, js/pro-zamky.js
    // podle něj věší zámek.
    // opts: { fav: 1 = ukázat hvězdičku, gest: 1 = ukázat gesto / nabídnout ho,
    //         hub: 1 = řádek rozcestníku (rozbaluje, nespouští), q: 0 = bez „?" }
    function item(def, onClick, iconHtml, key, opts) {
        opts = opts || {};
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ag-uk-i';
        if (key) b.setAttribute('data-k', key);
        var r = '';
        if (key && opts.gest && gestaZapnuta()) {
            var gs = gestoPro(key);
            r += gs ? '<i class="ag-uk-gest" data-act="gest" title="Změnit gesto">' + esc(gs) + '</i>'
                    : '<i class="ag-uk-gest ag-uk-gest-add" data-act="gest" title="Nakreslit gesto">+ gesto</i>';
        }
        if (key && opts.fav) r += '<i class="ag-uk-star' + (favKeys().indexOf(key) !== -1 ? ' on' : '') + '" data-act="fav" title="Připnout do Moje">★</i>';
        if (key && opts.q !== 0 && !opts.hub && maNavod(key)) r += '<i class="ag-uk-q" data-act="q" title="Návod">?</i>';
        if (opts.hub) r += '<i class="ag-uk-chev" aria-hidden="true"></i>';
        b.innerHTML = (iconHtml ? '<span class="ag-uk-ico">' + iconHtml + '</span>' : '')
            + '<span class="ag-uk-tx"><b>' + esc(def.l) + '</b>'
            + (def.h ? '<small>' + esc(def.h) + '</small>' : '') + '</span>'
            + (r ? '<span class="ag-uk-r">' + r + '</span>' : '');
        if (opts.hub) b.setAttribute('aria-expanded', 'false');
        b.addEventListener('click', function (e) {
            var act = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
            if (act && b.contains(act)) {
                e.stopPropagation(); e.preventDefault();
                var a = act.getAttribute('data-act');
                if (a === 'fav') toggleFav(key);
                else if (a === 'q') { try { window.agToolHelp && window.agToolHelp(key, def.l); } catch (er) { swallow(er, 'item:q'); } }
                else if (a === 'gest') { try { AGGesta.assignFor(key); } catch (er) { swallow(er, 'item:gest'); } }
                return;
            }
            onClick(e);
        });
        return b;
    }
    function maNavod(k) {
        try { var h = window.AGReg && AGReg.help && AGReg.help(k); return !!(h && h.t); } catch (e) { return false; }
    }

    // ---- rozcestník rozbalený na místě ---------------------------------------------------
    // Položky se stavějí až při prvním klepnutí: sbalený rozcestník je v seznamu
    // JEDEN řádek (tak to čekají i regresní testy) a nic se nestaví do zavřených větví.
    var OTEVRENE = {};   // id rozcestníku → 1 (jen po dobu běhu; po zavření okna se sbalí)
    // Položky rozcestníku, které se pod ním v TÉHLE licenci rozbalí: bez `hidden`,
    // s dlaždicí a NEZAMČENÉ. Zamčené (Pro v Základu) jdou na stránku Pro jako
    // ostatní — jinak by se Pro vracelo do sloves zadními vrátky rozcestníku.
    function hubPolozky(hubId) {
        var keys = [];
        try { keys = (window.AGReg && AGReg.hubItems) ? AGReg.hubItems(hubId) : []; } catch (e) { keys = []; }
        return keys.filter(function (k) { return !HIDDEN[k] && !!findTile(k) && !zamceno(k); });
    }
    // podtitulek řádku rozcestníku = výčet toho, co se pod ním OPRAVDU rozbalí
    // (registr skládá výčet bez ohledu na licenci — v Základu by sliboval Pro položky)
    function hubPodtitul(hubId, zaloha) {
        var names = hubPolozky(hubId).map(function (k) {
            var r = (window.AGReg && AGReg.get(k)) || {}; var n = String((AGReg.label && AGReg.label(k)) || r.vl || k);   // živý popisek (Proč ±N m?)
            // každý název zvlášť přes slovník: spojený výčet žádný klíč nemá, v EN/DE… zůstával česky (18. 9. 2026)
            var cs = true;
            try { if (window.AGJazyk && typeof AGJazyk.t === 'function') { n = String(AGJazyk.t(n) || n); cs = (AGJazyk.get() || 'cs') === 'cs'; } } catch (e) { /* nic */ }
            return cs ? n.charAt(0).toLowerCase() + n.slice(1) : n;   // malé písmeno jen česky (německá podstatná jména jsou velká)
        });
        return names.length ? names.join(' · ') : (zaloha || '');
    }
    function hubRow(it, verb) {
        var wrap = document.createDocumentFragment();
        var def = { l: it.l, h: hubPodtitul(it.k, it.h) };
        var row = item(def, function () { toggleHub(row, sub, it.k); }, iconOf(it.k), it.k, { hub: 1, fav: 0 });
        var sub = document.createElement('div');
        sub.className = 'ag-uk-sub';
        sub.setAttribute('data-sub', it.k);
        sub.hidden = true;
        wrap.appendChild(row); wrap.appendChild(sub);
        if (OTEVRENE[it.k]) toggleHub(row, sub, it.k, true);
        return wrap;
    }
    function toggleHub(row, sub, hubId, force) {
        var open = force === true ? true : row.getAttribute('aria-expanded') !== 'true';
        // položky se stavějí při každém rozbalení znovu (pár řádků): popisek „Proč ±N m?" se mění s přesností GPS
        if (open) {
            sub.innerHTML = '';
            hubPolozky(hubId).forEach(function (k) {
                var r = (window.AGReg && AGReg.get(k)) || {};
                var b = item({ l: (AGReg.label && AGReg.label(k)) || r.vl || tileLabel(findTile(k)), h: r.vh || '' }, function () { run(k); }, iconOf(k), k, { fav: 1 });
                b.classList.add('ag-uk-sub-i');
                sub.appendChild(b);
            });
            if (!sub.childNodes.length) {
                // bez položek (odpojený modul / role) se rozcestník chová jako dřív: otevře své okno
                run(hubId); return;
            }
        }
        row.setAttribute('aria-expanded', String(open));
        sub.hidden = !open;
        if (open) OTEVRENE[hubId] = 1; else delete OTEVRENE[hubId];
        fitHeight();
    }

    // Sbalit všechny rozbalené rozcestníky (při novém otevření okna — ať je stránka
    // zase krátká). Položky zůstávají postavené, jen se schovají.
    function sbalHuby() {
        OTEVRENE = {};
        var host = document.getElementById(LIST_ID); if (!host) return;
        var rows = host.querySelectorAll('.ag-uk-i[aria-expanded="true"]');
        for (var i = 0; i < rows.length; i++) {
            rows[i].setAttribute('aria-expanded', 'false');
            var sub = host.querySelector('.ag-uk-sub[data-sub="' + rows[i].getAttribute('data-k') + '"]');
            if (sub) sub.hidden = true;
        }
    }

    // ---- stránky ------------------------------------------------------------------------------
    var PAGES = [];          // [{ id, t, el, tab }] v pořadí pásku
    var curPage = PAGE_MOJE; // id aktivní stránky; přežije přestavbu seznamu
    var _scrollT = null;

    function pageIndex(id) { for (var i = 0; i < PAGES.length; i++) if (PAGES[i].id === id) return i; return -1; }
    function pagesEl() { var h = document.getElementById(LIST_ID); return h ? h.querySelector('.ag-uk-pages') : null; }

    // Výška pásu = výška aktivní stránky. Sousední (vyšší) stránky se během tahu
    // ořežou, po zarážce se výška přepočte. Bez toho by pás měl výšku nejvyšší
    // stránky a pod krátkou (Vytyčit, 3 řádky) by zela díra na dvě obrazovky.
    function fitHeight() {
        var p = pagesEl(); if (!p) return;
        var ix = pageIndex(curPage); if (ix < 0) return;
        var el = PAGES[ix].el;
        p.style.height = el.offsetHeight + 'px';
    }
    function go(id, hned) {
        var ix = pageIndex(id);
        if (ix < 0) { ix = 0; id = PAGES.length ? PAGES[0].id : PAGE_MOJE; }
        if (!PAGES.length) return;
        curPage = id;
        var p = pagesEl();
        if (p) {
            var left = ix * p.clientWidth;
            var smooth = !hned && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            try { p.scrollTo({ left: left, behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { p.scrollLeft = left; }
        }
        oznacTab();
        fitHeight();
    }
    function oznacTab() {
        var host = document.getElementById(LIST_ID); if (!host) return;
        var ix = pageIndex(curPage);
        PAGES.forEach(function (pg, i) {
            pg.tab.setAttribute('aria-selected', i === ix ? 'true' : 'false');
            pg.el.setAttribute('aria-hidden', i === ix ? 'false' : 'true');
        });
        // aktivní sloveso v pásku na oči (pásek roluje vodorovně)
        try { var t = PAGES[ix] && PAGES[ix].tab; if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { swallow(e, 'oznacTab'); }
        var nav = host.querySelector('.ag-uk-nav');
        if (nav) {
            var l = nav.firstChild, r = nav.lastChild;
            l.innerHTML = ix > 0 ? '‹ <b>' + esc(PAGES[ix - 1].t) + '</b>' : '';
            r.innerHTML = ix < PAGES.length - 1 ? '<b>' + esc(PAGES[ix + 1].t) + '</b> ›' : '';
        }
    }
    // Po tahu prstem: která stránka zůstala na zarážce → označit ji (a přepočítat výšku).
    function poScrollu() {
        var p = pagesEl(); if (!p || !p.clientWidth) return;
        var ix = Math.round(p.scrollLeft / p.clientWidth);
        if (ix < 0 || ix >= PAGES.length) return;
        if (PAGES[ix].id !== curPage) { curPage = PAGES[ix].id; oznacTab(); }
        fitHeight();
    }

    // ---- sestavení -------------------------------------------------------------------------------
    // Přestavuje se jen když se změní otisk (dlaždice přibývají postupně, jak se
    // moduly registrují; připnutí; licence) — jinak by listování problikávalo při
    // každém tiku. Aktivní stránka přestavbu přežije (curPage).
    function build() {
        var g = grid(); if (!g) return;
        var host = document.getElementById(LIST_ID);
        if (!host) {
            host = document.createElement('div');
            host.id = LIST_ID;
            g.parentNode.insertBefore(host, g);
        }
        // Pás „Co dnes děláš" (js/rezim-prace.js) si vyrábí jiný modul a MUSÍ přežít
        // přestavbu: vyndat před smazáním obsahu, po sestavení vrátit na Moje.
        var rp = document.getElementById('ag-rp-wrap');
        if (rp && host.contains(rp)) host.parentNode.insertBefore(rp, host);
        host.innerHTML = '';
        PAGES = [];

        var tabs = document.createElement('div');
        tabs.className = 'ag-uk-tabs';
        tabs.setAttribute('role', 'tablist');
        var pager = document.createElement('div');
        pager.className = 'ag-uk-pages';
        var nav = document.createElement('div');
        nav.className = 'ag-uk-nav';
        var navL = document.createElement('button'), navR = document.createElement('button');
        navL.type = 'button'; navR.type = 'button';
        navL.addEventListener('click', function () { var ix = pageIndex(curPage); if (ix > 0) go(PAGES[ix - 1].id); });
        navR.addEventListener('click', function () { var ix = pageIndex(curPage); if (ix < PAGES.length - 1) go(PAGES[ix + 1].id); });
        nav.appendChild(navL); nav.appendChild(navR);
        host.appendChild(tabs); host.appendChild(pager); host.appendChild(nav);

        function page(id, title, kratce, cls) {
            var sec = document.createElement('section');
            sec.className = 'ag-uk-page' + (cls ? ' ' + cls : '');
            sec.setAttribute('data-page', id);
            sec.setAttribute('role', 'tabpanel');
            var tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'ag-uk-tab' + (id === PAGE_PRO ? ' ag-uk-tab-pro' : '');
            tab.setAttribute('role', 'tab');
            tab.setAttribute('data-page', id);
            tab.textContent = kratce || title;
            tab.addEventListener('click', function () { go(id); });
            tabs.appendChild(tab);
            pager.appendChild(sec);
            PAGES.push({ id: id, t: kratce || title, el: sec, tab: tab });
            return sec;
        }
        function heading(parent, title, count, hint) {
            var h = document.createElement('div');
            h.className = 'ag-uk-h';
            h.innerHTML = '<span>' + esc(title) + '</span>'
                + (hint ? '<span class="ag-uk-hint">' + esc(hint) + '</span>' : (count != null ? '<span class="ag-uk-n">' + count + '</span>' : ''));
            parent.appendChild(h);
            return h;
        }
        // sekce uvnitř stránky (Moje má tři; testy čekají .ag-uk-g + .ag-uk-h)
        function section(parent, title, count, cls, hint) {
            var sec = document.createElement('section');
            sec.className = 'ag-uk-g' + (cls ? ' ' + cls : '');
            heading(sec, title, count, hint);
            parent.appendChild(sec);
            return sec;
        }
        var used = {};

        // ---- MOJE --------------------------------------------------------------------------------
        var moje = page(PAGE_MOJE, 'Moje', '★ Moje');
        var nb = nowBlock();
        if (nb) moje.appendChild(nb);
        // VLASTNÍK APLIKACE ÚPLNĚ NAHOŘE (12. 9. 2026): dlaždice vlastnik-* padaly do
        // „Dalších nástrojů" a uživatel konzoli nenašel. Tady jsou první, zlatě,
        // jen když je režim zapnutý.
        var vlast = [];
        try {
            if (window.AGVlastnik && AGVlastnik.isOn && AGVlastnik.isOn()) {
                var vt = g.querySelectorAll('.tool-tile[data-tool^="vlastnik-"]');
                for (var vi = 0; vi < vt.length; vi++) { var vk = tileKey(vt[vi]); if (vk && findTile(vk)) vlast.push(vk); }
            }
        } catch (e) { vlast = []; }
        if (vlast.length) {
            var vsec = section(moje, 'Vlastník aplikace', vlast.length, 'ag-uk-owner');
            vlast.forEach(function (k) {
                used[k] = 1;
                vsec.appendChild(item({ l: tileLabel(findTile(k)) }, (function (kk) { return function () { run(kk); }; })(k), iconOf(k), k));
            });
        }
        // místo pro pás „Co dnes děláš" — vloží se po sestavení (adoptRp)
        var rpSlot = document.createElement('div');
        rpSlot.className = 'ag-uk-rpslot';
        moje.appendChild(rpSlot);
        // ★ Připnuté — VOLBA UŽIVATELE: co si sem dal sám, to rozcestník ani `hidden`
        // nepotlačuje. Připnutý nástroj tu ukazuje své gesto (nebo nabídne ho nakreslit).
        var favs = favKeys().filter(function (k) { return findTile(k); });
        // ★ Připnuté jen když něco připnuté JE (18. 9. 2026, N3) — prázdná sekce s poučkou
        // zabírala první obrazovku Nástrojů; poučka je teď jednou větou v patičce Moje.
        if (favs.length) {
            var fsec = section(moje, '★ Připnuté', favs.length, 'ag-uk-fav', gestaZapnuta() ? 'klepni na gesto = změnit' : null);
            favs.forEach(function (k) {
                var r = (window.AGReg && AGReg.get(k)) || {};
                var t = findTile(k);
                fsec.appendChild(item({ l: r.vl || tileLabel(t), h: r.vh || '' }, (function (kk) { return function () { run(kk); }; })(k), iconOf(k), k, { fav: 1, gest: 1 }));
            });
        }
        var pl = profileLabel();
        if (pl) {
            var pk = profileKeys().filter(function (k) { return findTile(k); });
            if (pk.length) {
                var psec = section(moje, '◆ Pro tuto práci · ' + pl, pk.length);
                pk.forEach(function (k) {
                    var r = (window.AGReg && AGReg.get(k)) || {};
                    psec.appendChild(item({ l: r.vl || tileLabel(findTile(k)), h: r.vh || '' }, (function (kk) { return function () { run(kk); }; })(k), iconOf(k), k, { fav: 1 }));
                });
            }
        }
        if (!favs.length) {
            var em = document.createElement('div');
            em.className = 'ag-uk-empty';
            em.textContent = 'Nástroj, který používáš pořád, si připni hvězdičkou ★ v jeho řádku — bude tady' + (gestaZapnuta() ? ' a půjde mu dát gesto.' : '.');
            moje.appendChild(em);
        }
        moje.appendChild(footBlock());
        // Moje bez obsahu (nic naposledy, nic připnutého, žádný profil) → okno se otevře na prvním
        // slovesu, ať je hned vidět nástroj a ne prázdná stránka s poučkou
        var mojePrazdne = !nb && !favs.length && !vlast.length && !(pl && profileKeys().filter(function (k) { return findTile(k); }).length);

        // ---- SLOVESA: jedno sloveso = jedna stránka ---------------------------------------------
        // ⚠ ČTYŘI SLOVESA POD „DALŠÍ" (18. 9. 2026, N3): pásek měl 14 záložek a na 390 px se jich
        //   vešlo sedm. Před výjezdem, Firma a papíry, Příručka a výpočty a Učit se nejsou terénní
        //   úkony — bydlí na stránce „Další" jako sekce s nadpisem (student má Učit se dál první).
        var DO_DALSI = { 'Před výjezdem': 1, 'Firma a papíry': 1, 'Příručka a výpočty': 1, 'Učit se': 1 };
        var dalsiSekce = [];
        try { if (window.AGProfilOsoby && AGProfilOsoby.je('student')) delete DO_DALSI['Učit se']; } catch (e) { /* nic */ }
        // ⚠ ZAMČENÉ (PRO BEZ LICENCE) STRANOU (12. 9. 2026 dolů, 15. 9. 2026 na vlastní
        //   stránku, přání: „aby ta Pro nebyly rozházený v těch daných kategoriích,
        //   ale aby to bylo stranou a nepřekáželo"). Slovesné stránky obsahují jen to,
        //   co jde spustit; co je za peníze, je na poslední stránce „Pro" — se
        //   slovesem v titulku skupiny, ať se dá najít. Zámek samotný (data-agpro,
        //   karta po klepnutí) věší dál js/pro-zamky.js.
        var zamcene = [];
        poradiSkupin().forEach(function (grp) {
            var live = grp.items.filter(function (it) {
                return !HIDDEN[it.k] && !vHubu(it.k) && !!findTile(it.k);
            });
            if (!live.length) return;                       // celá skupina chybí (role/odpojený modul)
            var volne = live.filter(function (it) {
                if (zamceno(it.k)) { used[it.k] = 1; zamcene.push({ it: it, verb: grp.t }); return false; }
                return true;
            });
            if (!volne.length) return;                      // celé sloveso je za peníze → jen na Pro
            if (DO_DALSI[grp.t]) { dalsiSekce.push({ grp: grp, volne: volne }); return; }
            var sec = page(grp.t, grp.t, KRATCE[grp.t] || grp.t);
            heading(sec, grp.t, volne.length);
            volne.forEach(function (it) {
                used[it.k] = 1;
                if (HUB[it.k]) {
                    sec.appendChild(hubRow(it, grp.t));
                    // zamčené položky rozcestníku → stránka Pro (s názvem rozcestníku v popisku)
                    var hk = [];
                    try { hk = (window.AGReg && AGReg.hubItems) ? AGReg.hubItems(it.k) : []; } catch (e) { hk = []; }
                    hk.forEach(function (k) {
                        if (HIDDEN[k] || !findTile(k) || !zamceno(k) || used[k]) return;
                        var r = (window.AGReg && AGReg.get(k)) || {};
                        used[k] = 1;
                        zamcene.push({ it: { k: k, l: r.vl || tileLabel(findTile(k)), h: it.l + (r.vh ? ' · ' + r.vh : '') }, verb: grp.t });
                    });
                }
                else sec.appendChild(item(it, function () { run(it.k); }, iconOf(it.k), it.k, { fav: 1 }));
            });
        });

        // ---- DALŠÍ: pojistka — co v mapě sloves není (nový modul), se ukáže tady ------------
        var rest = [];
        var tiles = g.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) {
            var k = tileKey(tiles[i]);
            if (!k || used[k] || KNOWN[k] || HIDDEN[k] || vHubu(k)) continue;
            // Stejná dvě skrytí jako ve findTile(): tahle smyčka sahá na dlaždice přímo.
            if (tiles[i].hasAttribute('data-agucty')) continue;
            if (tiles[i].hasAttribute('data-ag-hidden')) continue;
            if (tiles[i].id === 'ag-sm-allbtn') continue;
            rest.push({ k: k, l: tileLabel(tiles[i]) });
        }
        rest = rest.filter(function (r) {
            if (zamceno(r.k)) { zamcene.push({ it: { k: r.k, l: r.l }, verb: '' }); return false; }
            return true;
        });
        if (rest.length || dalsiSekce.length) {
            // „Další nástroje", ne „Další": překladač jde po přesném textu a holé „Další" má v slovníku
            // význam „Next" (tlačítka průvodců) — záložka pak v EN/DE… říkala „Next" (18. 9. 2026 večer, T2)
            var rsec = page(PAGE_DALSI, 'Další nástroje', 'Další nástroje');
            // slovesa sloučená pod Další — každé jako sekce s nadpisem (řádky mají stejné chování)
            dalsiSekce.forEach(function (d) {
                var dsec = section(rsec, d.grp.t, d.volne.length, 'ag-uk-dalsi');
                d.volne.forEach(function (it) {
                    used[it.k] = 1;
                    if (HUB[it.k]) {
                        dsec.appendChild(hubRow(it, d.grp.t));
                        var hk2 = [];
                        try { hk2 = (window.AGReg && AGReg.hubItems) ? AGReg.hubItems(it.k) : []; } catch (e) { hk2 = []; }
                        hk2.forEach(function (k) {
                            if (HIDDEN[k] || !findTile(k) || !zamceno(k) || used[k]) return;
                            var r = (window.AGReg && AGReg.get(k)) || {};
                            used[k] = 1;
                            zamcene.push({ it: { k: k, l: r.vl || tileLabel(findTile(k)), h: it.l + (r.vh ? ' · ' + r.vh : '') }, verb: d.grp.t });
                        });
                    }
                    else dsec.appendChild(item(it, function () { run(it.k); }, iconOf(it.k), it.k, { fav: 1 }));
                });
            });
            if (rest.length) {
                heading(rsec, 'Další nástroje', rest.length);
                rest.forEach(function (r) {
                    rsec.appendChild(item({ l: r.l }, function () { run(r.k); }, iconOf(r.k), r.k, { fav: 1 }));
                });
            }
            // Pojistka funguje, ale tiše: 9. 8. 2026 tu půl roku ležel „Metr v kameře"
            // a „Kontrola vrstvy", protože je nikdo do mapy sloves nedopsal. Ozve se
            // v konzoli. "noverb" z registru = nástroj tu MÁ být; bez registru je tu
            // celá appka a rada „dopsat do tools-registry.js" by byla mylná.
            var chybi = rest.filter(function (r) { return !NOVERB[r.k]; });
            try {
                if (!_restWarned && chybi.length && GROUPS.length) {
                    _restWarned = true;
                    console.warn('[nastroje-ukony] mimo mapu sloves (spadlo do „Další nástroje"): '
                        + chybi.map(function (r) { return r.k; }).join(', ')
                        + ' — dopsat do js/tools-registry.js (verb + vl), ať to jde najít podle toho, co chce uživatel udělat.');
                }
            } catch (e) { swallow(e, 'rest'); }
        }

        // ---- PRO: dvanáctá stránka, jen v Základu ------------------------------------------------
        if (zamcene.length) {
            var zsec = page(PAGE_PRO, PRO_SEKCE, 'Pro', 'ag-uk-pro');
            heading(zsec, PRO_SEKCE, zamcene.length);
            var intro = document.createElement('div');
            intro.className = 'ag-uk-intro';
            intro.innerHTML = '<span>Nástroje z placené verze — tady stranou, ať nepřekážejí ve slovesech. Klepnutím zjistíš, co který umí.</span>';
            if (window.AGProZamky && typeof AGProZamky.prehled === 'function') {
                var pb = document.createElement('button');
                pb.type = 'button'; pb.textContent = 'Co všechno umí Pro';
                pb.addEventListener('click', function () { try { AGProZamky.prehled(); } catch (e) { swallow(e, 'pro:prehled'); } });
                intro.appendChild(pb);
            }
            zsec.appendChild(intro);
            var lastVerb = null;
            zamcene.forEach(function (z) {
                var v = z.verb || 'Další nástroje';
                if (v !== lastVerb) {
                    var cap = document.createElement('div');
                    cap.className = 'ag-uk-cap'; cap.textContent = v;
                    zsec.appendChild(cap); lastVerb = v;
                }
                zsec.appendChild(item({ l: z.it.l, h: z.it.h || '' }, function () { run(z.it.k); }, iconOf(z.it.k), z.it.k));
            });
        }

        host.setAttribute('data-sig', gridSig());
        host.setAttribute('data-moje-prazdne', mojePrazdne ? '1' : '0');
        adoptRp();
        // posluchač tahu — jednou na pás (pás se staví s každou přestavbou znovu)
        pager.addEventListener('scroll', function () {
            if (_scrollT) clearTimeout(_scrollT);
            _scrollT = setTimeout(poScrollu, 90);
        }, { passive: true });
        go(curPage, true);
        // výška po vykreslení (offsetHeight před prvním snímkem bývá 0 při otevírání)
        try { requestAnimationFrame(function () { go(curPage, true); }); } catch (e) { swallow(e, 'build:raf'); }
    }
    // Sekce zamčených — jméno je tu od 12. 9. 2026, testy ho znají.
    var PRO_SEKCE = 'Ve verzi Pro';

    // Pás „Co dnes děláš" z js/rezim-prace.js patří na Moje (typ práce se tam projeví
    // v sekci „Pro tuto práci"). Modul ho vkládá před seznam; tady se jen přestěhuje.
    // Idempotentní — smí to volat periodický sync().
    function adoptRp() {
        var rp = document.getElementById('ag-rp-wrap');
        var host = document.getElementById(LIST_ID);
        if (!rp || !host) return;
        var slot = host.querySelector('.ag-uk-rpslot');
        if (!slot || rp.parentNode === slot) return;
        slot.appendChild(rp);
        fitHeight();
    }

    // ---- hlavní sync -------------------------------------------------------------------------
    var _byloOtevreno = false;
    function sync() {
        injectStyles();
        if (!grid()) return;
        dropSeg();

        // Při psaní jde slovo mřížce — tam běží chytré hledání se synonymy,
        // překlepy a řazením z field-tools.js. Psát ho znovu by bylo horší.
        var q = searchVal();
        var active = q ? 'vse' : view();

        var host = document.getElementById(LIST_ID);
        // ⚠⚠ SKLÁDAT SEZNAM DO ZAVŘENÉHO OKNA JE ČISTÁ ZTRÁTA (8. 9. 2026): tik běží
        //   každých 1400 ms a při startu do mřížky přibývají dlaždice, otisk se pokaždé
        //   změní a build() by skládal stovku položek do okna, které nikdo neotevřel.
        //   Po otevření okna se seznam postaví hned (pozorovatel níž).
        var _m = modal();
        var _otevreno = !!(_m && _m.style.display && _m.style.display !== 'none');
        // Okno se OTEVÍRÁ NA MOJE (rozhodnutí 15. 9. 2026) — ne tam, kde se naposledy
        // listovalo. Rozbalené rozcestníky se sbalí, ať je stránka zase krátká.
        if (_otevreno && !_byloOtevreno) { curPage = PAGE_MOJE; sbalHuby(); if (host) go(PAGE_MOJE, true); }
        var _prvniOtevreni = _otevreno && !_byloOtevreno;
        _byloOtevreno = _otevreno;
        if (_otevreno && active === 'ukony' && (!host || host.getAttribute('data-sig') !== gridSig())) build();
        // Prázdné Moje (nový uživatel) → rovnou první sloveso, ať je vidět nástroj (18. 9. 2026, N3)
        if (_prvniOtevreni && active === 'ukony') {
            try {
                var h2 = document.getElementById(LIST_ID);
                if (h2 && h2.getAttribute('data-moje-prazdne') === '1' && PAGES.length > 1 && curPage === PAGE_MOJE) go(PAGES[1].id, true);
            } catch (e) { swallow(e, 'sync:prvni'); }
        }

        // ⚠⚠⚠ `ag-uk-on` SMÍ BÝT JEN TEHDY, KDYŽ SEZNAM SKUTEČNĚ EXISTUJE. Ta třída
        //   schová mřížku, takže bez seznamu by okno Nástrojů zůstalo PRÁZDNÉ — přesně
        //   to se 8. 9. 2026 stalo každému, kdo okno otevřel jinak než klepnutím.
        document.body.classList.toggle('ag-uk-on',
            active === 'ukony' && !!document.getElementById(LIST_ID));
        if (active === 'ukony') { adoptRp(); fitHeight(); }
    }

    // Okno Nástrojů se otevírá inline onclickem (index.html), takže na něj není
    // událost. ⚠ HLÍDÁ SE ZMĚNA ATRIBUTU, NE KLEPNUTÍ — chytí i volání z kódu,
    // gesto, zkratku, test. Pozorovatel je levný: běží jen při skutečné změně.
    function hlidejOtevreni() {
        var m = modal();
        if (!m || m.getAttribute('data-uk-obs') === '1') return;
        try {
            m.setAttribute('data-uk-obs', '1');
            new MutationObserver(function () {
                try { sync(); } catch (e) { swallow(e, 'obs'); }
            }).observe(m, { attributes: true, attributeFilter: ['style', 'class'] });
        } catch (e) { swallow(e, 'hlidejOtevreni'); }
    }

    function init() {
        try { sync(); } catch (e) { console.warn('[nastroje-ukony] init', e); }
        try { hlidejOtevreni(); } catch (e) { console.warn('[nastroje-ukony] hlidejOtevreni', e); }
        (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () {
            try { hlidejOtevreni(); } catch (e) { swallow(e, 'tik-obs'); }
        }, 3000);
        if (!window.__agUkTimer) {
            window.__agUkTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () {
                try { sync(); } catch (e) { swallow(e, 'init'); }
            }, 1400);
        }
        document.addEventListener('input', function (e) {
            if (e.target && e.target.id === 'tools-search') { try { sync(); } catch (er) { swallow(er, 'init'); } }
        }, true);
        // ⚠ init() běží DVAKRÁT (DOMContentLoaded/readyState + pojistka po load) —
        //   posluchače níž smí vzniknout jen jednou, jinak šipka listovala o dvě stránky.
        if (window.__agUkKeys) return;
        window.__agUkKeys = 1;
        // otočení telefonu: zarážky zůstávají, ale posun je v pixelech → srovnat
        window.addEventListener('resize', function () { try { if (PAGES.length) go(curPage, true); } catch (e) { swallow(e, 'resize'); } });
        // klávesnice (tablet s klávesnicí, prohlížeč): šipky listují
        document.addEventListener('keydown', function (e) {
            if (!document.body.classList.contains('ag-uk-on')) return;
            var m = modal(); if (!m || m.style.display === 'none') return;
            if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
            var ix = pageIndex(curPage);
            if (e.key === 'ArrowRight' && ix < PAGES.length - 1) go(PAGES[ix + 1].id);
            else if (e.key === 'ArrowLeft' && ix > 0) go(PAGES[ix - 1].id);
        });
    }
    // ⚠ STAVBA AŽ ZA START (5. 9. 2026): build() je nejdražší modul startu hned po
    // Leafletu (311 ms při CPU 4×). Odsouvá se za první dotek a i pak do nečinnosti.
    function initPozdeji() {
        if (window.AG && typeof AG.poPrvnimDoteku === 'function') AG.poPrvnimDoteku(init, 3500);
        else init();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPozdeji);
    else initPozdeji();
    window.addEventListener('load', function () { setTimeout(initPozdeji, 500); });

    // groups/run/has zůstávají venku: gesta (js/gesta-zkratky.js) vybírají ze STEJNÉ
    // mapy sloves a spouštějí nástroje STEJNOU cestou (klik na původní dlaždici).
    window.AGUkony = {
        rebuild: build,
        setView: function () { sync(); },   // no-op po zrušení přepínače pohledů (starší volání)
        groups: GROUPS,
        run: run,
        // LISTOVÁNÍ: id stránky = plný název slovesa z registru, 'moje', 'pro', 'dalsi'
        go: go,
        page: function () { return curPage; },
        pages: function () { return PAGES.map(function (p) { return p.id; }); },
        // JDE TENHLE NÁSTROJ VŮBEC SPUSTIT? (dlaždice v DOM + právo role)
        // ⚠⚠ ZÁMĚRNĚ BEZ pravidla o rozcestnících: podle has() se ptají GESTA a zkratka
        //   na Počasí musí jet dál i po sloučení pod „Počasí a světlo" (test_opravy_31_8).
        has: function (k) { return !!findTile(k); },
        // PATŘÍ NÁSTROJ DO NABÍDKY? = has() + pravidlo rozcestníků a `hidden`.
        vVypisu: function (k) {
            if (HIDDEN[k]) return false;
            if (vHubu(k)) return false;
            return !!findTile(k);
        }
    };
})();
