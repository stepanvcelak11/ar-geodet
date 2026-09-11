// ===== QTRIG — MAPA A VRSTVY: chování panelu (ODPOJITELNÁ vrstva) ===========
// Doplněk k markupu #map-controls v index.html a bloku „MAPA A VRSTVY" ve
// style.css. Nástroje mapy byly dřív 6 bezejmenných koleček schovaných ve
// „Více → Nástroje mapy" — nešlo poznat, co která ikona dělá ani co je zapnuté.
// Tenhle modul dodává panelu život:
//   • agMapSetBase('osm'|'ortofoto') — podklad se VYBÍRÁ (dřív jedno tlačítko
//     cyklilo naslepo). Deleguje na cycleBaseLayer() z grafika.js, takže
//     ukládání do visSettings zůstává na jednom místě.
//   • STAV: grafika.js věší .ctrl-active na #btn-baselayer / #btn-katastr /
//     #btn-connect — modul to zrcadlí do segmentu, přepínačů a počítadla
//     zapnutých vrstev na vstupním tlačítku (MutationObserver, žádné polling).
//   • VOLITELNÉ ŘÁDKY: Parcely (vektor) a Vlastní podklad se zobrazí, když
//     příslušný modul existuje — nebo když jsou zamčené (viz níž): i v balíčku
//     Základ, kde Pro moduly fyzicky nejsou, má být vidět, že to existuje.
//   • ADOPCE: cokoli, co jiný modul injektuje do #map-ctrl-stack, dostane
//     popisek z aria-label a vzhled dlaždice — nové nástroje mapy tak nepřijdou
//     do panelu jako bezejmenná ikona.
//   • ZÁMKY PRO (11. 9. 2026): uživatel — „Vrstvy bych dal taky do Pročka. Nechal
//     bych tam mapu nebo ortofoto, ale zbytek bych hodil do Pro. Uzamknout po
//     směru / sever nahoře bych tam v klidu nechal. A to tlačítko Na mě."
//     Co je Pro, říká atribut data-ms-pro="…" v index.html (a všechno, co si do
//     #map-ctrl-stack injektují cizí moduly). Bez licence dostane prvek
//     data-agpro="1" — TÝŽ atribut, jaký věší js/pro-zamky.js na dlaždice
//     Nástrojů, takže zámek vypadá všude stejně — a klik v CAPTURE fázi místo
//     akce otevře kartu Pro. Zdarma zůstává Podklad, Otáčení mapy (vkládá si ho
//     js/map-rotate.js za #ms-base), Na mě a Měřit plochu (startAreaMode je
//     v registru `base: 1`; zamknout ho tady by byl rozpor s Nástroji).
//   • Akční dlaždice po klepnutí panel zavřou (ať je vidět mapa); přepínače
//     vrstev ne — jich se obvykle mačká víc za sebou.
//   • Vstupní tlačítko lze schovat: Nastavení → Vzhled → „Tlačítko vrstev v mapě"
//     (klíč agMapFab, třída body.ag-mapfab-off). VÝCHOZE je od 9. 8. 2026 SCHOVANÉ,
//     když stejný panel otevírá i „Vrstvy" v liště — viz fabOn() níž.
//
// Řádek „Terén (DMR 5G)" a adopce #btn-terrain tu byly do 11. 9. 2026 — terénní
// AR je zrušený (js/dmr-terrain.js zůstal jen jako datová služba výšek).
//
// NEEDITUJE logika.js ani grafika.js. Odstranění: smaž js/map-tools.js + řádek
// <script> v index.html (a přegeneruj sw.js). Panel pak zůstane staticky
// funkční (tlačítka mají inline onclick), jen bez stavu, adopce, přepínače
// A BEZ ZÁMKŮ — Pro vrstvy by v Základu šly zapnout.
// ================================================================================
(function () {
    'use strict';
    if (window.__agMapToolsInit) return;
    window.__agMapToolsInit = true;

    var FAB_KEY = 'agMapFab';        // '0' = vstupní tlačítko v mapě schované
    var PRO_MODAL_ID = 'ag-map-pro-modal';
    var PRO_STYLE_ID = 'ag-map-pro-style';
    var ADRESA_PRO = './pro/';       // stejně jako js/pro-zamky.js: Pro bydlí na téže adrese pod /pro/

    function $(id) { return document.getElementById(id); }
    function controls() { return $('map-controls'); }
    function sheet() { return $('map-sheet'); }
    function isOpen() { var c = controls(); return !!(c && c.classList.contains('expanded')); }
    function close() { var c = controls(); if (c) c.classList.remove('expanded'); }
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'map-tools:' + kde); } catch (x) { } }

    // ---- podklad: výběr místo cyklení -------------------------------------------
    // grafika.js umí jen cycleBaseLayer() (přepnutí OSM<->ortofoto). Podkladů jsou
    // dva, takže „nastav na X" = zavolej cycle, když tam ještě nejsem.
    function curBase() {
        try { if (typeof visSettings !== 'undefined' && visSettings) return (visSettings.baseLayer === 'ortofoto') ? 'ortofoto' : 'osm'; } catch (e) { swallow(e, 'curBase'); }
        // fallback: stav si drží třída na #btn-baselayer (věší ji applyMapLayers)
        var b = $('btn-baselayer');
        return (b && b.classList.contains('ctrl-active')) ? 'ortofoto' : 'osm';
    }
    window.agMapSetBase = function (which) {
        var want = (which === 'ortofoto') ? 'ortofoto' : 'osm';
        if (curBase() === want) { syncBase(); return; }
        try {
            if (typeof window.cycleBaseLayer === 'function') window.cycleBaseLayer();
        } catch (e) { swallow(e, 'agMapSetBase'); }
        syncBase();
    };

    // ---- zrcadlení stavu do panelu ------------------------------------------------
    function syncBase() {
        var orto = curBase() === 'ortofoto';
        var bo = $('btn-baselayer'), bm = $('ms-base-osm');
        if (bo) bo.classList.toggle('on', orto);
        if (bm) bm.classList.toggle('on', !orto);
    }
    function activeLayers() {
        var n = 0;
        var k = $('btn-katastr'); if (k && k.classList.contains('ctrl-active')) n++;
        return n;
    }
    function syncBadge() {
        var b = $('map-ctrl-badge');
        if (!b) return;
        var n = activeLayers();
        b.hidden = (n === 0);
        b.textContent = n ? String(n) : '';
    }
    function syncAll() { syncBase(); syncBadge(); syncPro(); }

    // ---- kompaktní režim: nízká mapa (Split) --------------------------------------
    // Panel se stropem 430 px se do poloviční mapy nevejde; v kompaktu zmizí popisky
    // pod názvy vrstev a smrsknou se odsazení, takže je vidět i spodní řada dlaždic.
    function syncCompact() {
        var box = controls(), sh = sheet();
        if (!box || !sh) return;
        var h = box.clientHeight || 0;
        if (!h) return;                        // mapa schovaná (režim „jen AR")
        sh.classList.toggle('ms-compact', h < 430);
    }

    // ---- zámky Pro ------------------------------------------------------------------
    function maPro() { try { return !!(window.AGLic && AGLic.isPro && AGLic.isPro()); } catch (e) { return false; } }
    function jeZaklad() { try { return !!(window.AGLic && AGLic.vydani && AGLic.vydani() === 'zaklad'); } catch (e) { return false; } }
    // Klíč registru (js/tools-registry.js) pro kartu s popisem — u vrstev katastru
    // je to cadastre-vector; "1" = obecná karta bez klíče.
    function proKlic(el) {
        var v = el.getAttribute('data-ms-pro');
        return (v && v !== '1') ? v : null;
    }
    // Všechno, co je bez Pro zamčené: prvky s data-ms-pro + děti #map-ctrl-stack
    // (cizí moduly — js/poloha-z-mapy.js, js/cil-navigace.js — si atribut nenesou).
    function proPrvky() {
        var sh = sheet(); if (!sh) return [];
        var out = [], i;
        var a = sh.querySelectorAll('[data-ms-pro]');
        for (i = 0; i < a.length; i++) out.push(a[i]);
        var stack = $('map-ctrl-stack');
        // „Ukázat cíl" (#ms-cil, js/cil-navigace.js) je jen srovnání mapy na cíl,
        // ke kterému uživatel právě jde — Pro funkce to není, zůstává zdarma.
        if (stack) for (i = 0; i < stack.children.length; i++) { if (stack.children[i].id !== 'ms-cil') out.push(stack.children[i]); }
        return out;
    }
    function syncPro() {
        try {
            var zamk = !maPro();
            var els = proPrvky();
            for (var i = 0; i < els.length; i++) {
                var el = els[i];
                if (zamk) { if (el.getAttribute('data-agpro') !== '1') el.setAttribute('data-agpro', '1'); }
                else if (el.hasAttribute('data-agpro')) el.removeAttribute('data-agpro');
            }
            // Volitelné řádky bez modulu (balíček Základ Pro moduly nemá): zamčené
            // se ukážou, ať je vidět, že vrstva existuje; odemčené bez modulu ne —
            // klik by neměl co otevřít.
            ['ms-parcely', 'ms-overlay'].forEach(function (id) {
                var r = $(id); if (!r) return;
                if (r.__wired) { r.hidden = false; return; }
                r.hidden = !zamk;
            });
        } catch (e) { swallow(e, 'syncPro'); }
    }

    // Klik na zamčený prvek: chytá se v CAPTURE fázi na #map-sheet, tedy dřív než
    // inline onclick (toggleKatastr, saveForOffline…) i než posluchače řádků
    // a injektovaných tlačítek. Zastaví se úplně, aby nedoběhlo ani zavírání
    // panelu po akci (#ms-actions). js/pro-zamky.js má vlastní past na documentu —
    // ta běží dřív, ale prvek s klíčem toggleKatastr pro ni Pro nástroj není,
    // takže ho nechá projít až sem.
    function wireProClick() {
        var sh = sheet(); if (!sh || sh.__proWired) return;
        sh.__proWired = true;
        sh.addEventListener('click', function (e) {
            try {
                if (!e.target || !e.target.closest) return;
                var el = e.target.closest('[data-agpro="1"]');
                if (!el || !sh.contains(el)) return;
                if (maPro()) return;                       // licence přišla mezi dvěma synchronizacemi
                e.preventDefault(); e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                otevriProKartu(proKlic(el));
            } catch (err) { swallow(err, 'proClick'); }
        }, true);
    }

    // Karta „Vrstvy a nástroje mapy jsou ve verzi Pro". Vzhled opsaný z #ag-pro-modal
    // (js/pro-zamky.js), aby zámek vypadal všude stejně. Pro klíč, který registr zná
    // jako Pro nástroj, se použije karta pro-zamky s popisem nástroje a polem na klíč;
    // obecná karta nabídne „Verze Pro" — v Základu je to přechod na ./pro/, ve vydání
    // Pro bez licence přehled pro-zamky (má pole na klíč).
    function otevriProKartu(klic) {
        try {
            if (klic && window.AGProZamky && typeof AGProZamky.karta === 'function'
                && window.AGReg && AGReg.isPro && AGReg.isPro(klic)) {
                AGProZamky.karta(klic);
                return;
            }
        } catch (e) { swallow(e, 'otevriProKartu'); }
        var m = proKarta();
        m.classList.add('on');
    }
    function proStyly() {
        if ($(PRO_STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = PRO_STYLE_ID;
        // Vlastní maska zámku pro případ, že js/pro-zamky.js chybí (--ag-pro-mask
        // definuje on); s ním se použije jeho.
        var mask = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
        ) + '")';
        st.textContent = [
            // řádek vrstvy: zámek místo přepínače/šipky (pro-zamky ho dává do pravého
            // horního rohu — na řádku by ležel přes přepínač), obsah ztlumený
            '#map-sheet .ms-row[data-agpro="1"]{position:relative;}',
            '#map-sheet .ms-row[data-agpro="1"] .ms-sw,#map-sheet .ms-row[data-agpro="1"] .ms-go{display:none;}',
            '#map-sheet .ms-row[data-agpro="1"] > .icon,#map-sheet .ms-row[data-agpro="1"] .ms-row-t{opacity:.6;}',
            '#map-sheet .ms-row[data-agpro="1"]::after{content:"";position:absolute;top:50%;right:14px;transform:translateY(-50%);',
            '  width:13px;height:13px;padding:3px;border-radius:50%;opacity:.85;background:var(--accent,#2f9e74);',
            '  -webkit-mask:var(--ag-pro-mask,' + mask + ') center/10px 10px no-repeat;mask:var(--ag-pro-mask,' + mask + ') center/10px 10px no-repeat;}',
            // dlaždice: zámek v rohu jako u dlaždic Nástrojů, obsah ztlumený
            '#map-sheet .ms-tile[data-agpro="1"]{position:relative;}',
            '#map-sheet .ms-tile[data-agpro="1"] > *{opacity:.55;}',
            '#map-sheet .ms-tile[data-agpro="1"]::after{content:"";position:absolute;top:4px;right:4px;',
            '  width:13px;height:13px;padding:3px;border-radius:50%;opacity:.85;background:var(--accent,#2f9e74);',
            '  -webkit-mask:var(--ag-pro-mask,' + mask + ') center/10px 10px no-repeat;mask:var(--ag-pro-mask,' + mask + ') center/10px 10px no-repeat;}',
            // karta (stejná kostra jako #ag-pro-modal)
            '#' + PRO_MODAL_ID + '{position:fixed;inset:0;z-index:100060;display:none;align-items:center;',
            '  justify-content:center;padding:16px;background:rgba(0,0,0,.62);}',
            '#' + PRO_MODAL_ID + '.on{display:flex;}',
            '#' + PRO_MODAL_ID + ' .agp-box{width:min(430px,94vw);max-height:88vh;overflow:auto;border-radius:16px;',
            '  padding:18px 18px 16px;background:var(--modal-bg,#141a26);color:var(--text-color,#e9eef7);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,.12));box-shadow:0 18px 50px rgba(0,0,0,.5);}',
            'body.light-mode #' + PRO_MODAL_ID + ' .agp-box{background:#fff;color:#16202e;}',
            '#' + PRO_MODAL_ID + ' h2{margin:0 0 4px;font-size:calc(18px * var(--ag-font-scale,1));display:flex;align-items:center;gap:9px;}',
            '#' + PRO_MODAL_ID + ' h2 span{flex:0 0 auto;width:21px;height:21px;color:var(--accent,#2f9e74);}',
            '#' + PRO_MODAL_ID + ' h2 span svg{width:21px;height:21px;}',
            '#' + PRO_MODAL_ID + ' .agp-pod{margin:0 0 13px;opacity:.75;font-size:calc(13px * var(--ag-font-scale,1));line-height:1.45;}',
            '#' + PRO_MODAL_ID + ' .agp-co{margin:0 0 14px;padding:11px 13px;border-radius:11px;',
            '  background:var(--accent-soft,rgba(47,158,116,.13));font-size:calc(13px * var(--ag-font-scale,1));line-height:1.5;}',
            '#' + PRO_MODAL_ID + ' .agp-co b{display:block;margin-bottom:5px;}',
            '#' + PRO_MODAL_ID + ' .agp-co ul{margin:0;padding-left:18px;}',
            '#' + PRO_MODAL_ID + ' .agp-co li{margin:2px 0;}',
            '#' + PRO_MODAL_ID + ' .agp-rada{display:flex;gap:9px;margin-top:14px;}',
            '#' + PRO_MODAL_ID + ' .agp-rada button{flex:1 1 0;padding:12px;border-radius:11px;font:inherit;',
            '  font-weight:600;cursor:pointer;border:1px solid var(--glass-border,rgba(255,255,255,.16));',
            '  background:transparent;color:inherit;}',
            '#' + PRO_MODAL_ID + ' .agp-rada button.hlavni{background:var(--accent,#2f9e74);border-color:transparent;color:#fff;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }
    function proKarta() {
        var m = $(PRO_MODAL_ID);
        if (m) return m;
        proStyly();
        var ZAMEK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
        m = document.createElement('div');
        m.id = PRO_MODAL_ID;
        m.innerHTML =
            '<div class="agp-box" role="dialog" aria-modal="true">' +
            '  <h2><span>' + ZAMEK + '</span>Vrstvy a nástroje mapy jsou ve verzi Pro</h2>' +
            '  <p class="agp-pod">Základ má mapu i ortofoto, otáčení mapy, návrat na mou polohu a měření plochy.</p>' +
            '  <div class="agp-co"><b>Tohle je ve verzi Pro</b>' +
            '  <ul>' +
            '  <li>katastrální mapa a parcely jako čáry — v mapě i v AR, i bez signálu</li>' +
            '  <li>vlastní podklad: situace nebo geometrák nakalibrovaný do mapy</li>' +
            '  <li>body v okolí, spojnice bodů, poloha z mapy a mapa uložená pro offline</li>' +
            '  </ul></div>' +
            '  <div class="agp-rada">' +
            '    <button type="button" class="agp-zpet">Zpět</button>' +
            '    <button type="button" class="hlavni agp-pro">Verze Pro</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        function zavri() { m.classList.remove('on'); }
        m.addEventListener('click', function (e) { if (e.target === m) zavri(); });
        m.querySelector('.agp-zpet').addEventListener('click', zavri);
        m.querySelector('.agp-pro').addEventListener('click', function () {
            zavri();
            try {
                if (jeZaklad()) { window.location.href = ADRESA_PRO; return; }
                if (window.AGProZamky && typeof AGProZamky.prehled === 'function') AGProZamky.prehled();
            } catch (e) { swallow(e, 'proKarta'); }
        });
        return m;
    }

    // ---- volitelné řádky podle dostupných modulů ------------------------------------
    function wireOptionalRows() {
        var p = $('ms-parcely');
        if (p && !p.__wired && typeof window.agOpenCadastreVector === 'function') {
            p.__wired = true; p.hidden = false;
            p.addEventListener('click', function () { close(); window.agOpenCadastreVector(); });
        }
        var o = $('ms-overlay');
        if (o && !o.__wired && typeof window.agOpenGeoOverlay === 'function') {
            o.__wired = true; o.hidden = false;
            o.addEventListener('click', function () { close(); window.agOpenGeoOverlay(); });
        }
    }

    // ---- adopce tlačítek injektovaných jinými moduly ----------------------------------
    // Modul jako js/poloha-z-mapy.js si do #map-ctrl-stack vloží bezejmenné kolečko.
    // Dáme mu popisek z aria-label a vzhled dlaždice, ať v panelu nevypadá cizí.
    function adopt() {
        var stack = $('map-ctrl-stack');
        if (!stack) return;
        var kids = stack.children, i;
        for (i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (el.__agAdopted) continue;
            el.__agAdopted = true;
            var label = el.getAttribute('aria-label') || el.title || 'Nástroj';
            // popisek zkrátit na první závorku/pomlčku, ať se vejde pod ikonu
            label = String(label).split('(')[0].split(' — ')[0].trim();
            el.classList.remove('map-ctrl-btn', 'glass-panel');
            el.classList.add('ms-tile');
            if (!el.querySelector('span')) {
                var s = document.createElement('span');
                s.textContent = label;
                el.appendChild(s);
            }
            el.addEventListener('click', function () { setTimeout(syncAll, 60); });
        }
        syncAll();
    }

    // ---- akční dlaždice zavřou panel (ať je vidět mapa) --------------------------------
    function wireActions() {
        var box = $('ms-actions');
        if (!box || box.__wired) return;
        box.__wired = true;
        // bublání: inline onclick dlaždice proběhne první, pak zavřeme
        box.addEventListener('click', function (ev) {
            var t = ev.target;
            while (t && t !== box && !(t.classList && t.classList.contains('ms-tile'))) t = t.parentNode;
            if (t && t !== box) { close(); setTimeout(syncAll, 60); }
        });
    }

    // ---- přepínač „Tlačítko vrstev v mapě" v Nastavení → Vzhled -------------------------
    // VÝCHOZÍ STAV SE OD 9. 8. 2026 ODVOZUJE OD LIŠTY. Od chvíle, kdy slot „Více"
    // v doku drží „Vrstvy" (commit b9c29fe), vedly do stejného panelu DVA vstupy —
    // kolečko vlevo dole v mapě a tlačítko v liště vpravo. Uživatel: „jak se vrstvy
    // přesunuly doprava do ovládacího panelu, tak už je nepotřebuju mít vlevo dole".
    // Netvrdíme to ale natvrdo: kdo tlačítko Vrstvy v liště NEMÁ (firemní role bez
    // oprávnění 'dock.vice' — ucty.js mu dá style.display:none), by se jinak
    // k podkladům a katastru nedostal vůbec. Tomu kolečko v mapě zůstane.
    // Ruční volba (klíč agMapFab '1'/'0') má vždycky přednost.
    function dockHasLayers() {
        try {
            var b = document.getElementById('dock-vice-btn');
            if (!b) return false;
            if (b.style.display === 'none') return false;              // schované oprávněním
            // slot je přenastavitelný — ověř, že opravdu otevírá panel vrstev
            return (b.getAttribute('onclick') || '').indexOf('toggleMapControls') !== -1;
        } catch (e) { return false; }
    }
    function fabOn() {
        var v = null;
        try { v = localStorage.getItem(FAB_KEY); } catch (e) { swallow(e, 'fabOn'); }
        if (v === '1') return true;
        if (v === '0') return false;
        return !dockHasLayers();
    }
    function applyFab() {
        try { document.body.classList.toggle('ag-mapfab-off', !fabOn()); } catch (e) { swallow(e, 'applyFab'); }
    }
    function injectSetting() {
        var anchor = $('s-lefthand');
        if (!anchor || $('s-mapfab')) return;
        var row = anchor.closest ? anchor.closest('.st-row') : null;
        if (!row || !row.parentNode) return;
        var d = document.createElement('div');
        d.className = 'st-row';
        d.innerHTML = '<span class="st-lab">Tlačítko vrstev v mapě<small>kolečko vlevo dole v mapě; vypnuté se vrstvy otevírají tlačítkem <b>Vrstvy</b> v liště</small></span>'
            + '<label class="st-sw"><input type="checkbox" id="s-mapfab"><span class="st-sw-face"></span></label>';
        row.parentNode.insertBefore(d, row.nextSibling);
        var chk = $('s-mapfab');
        chk.checked = fabOn();
        chk.addEventListener('change', function () {
            try { localStorage.setItem(FAB_KEY, this.checked ? '1' : '0'); } catch (e) { swallow(e, 'injectSetting'); }
            applyFab();
        });
    }

    // ---- otevření v režimu „jen AR" ----------------------------------------------------
    // Panel žije uvnitř #map-container, který applyViewMode() v režimu 'ar' schová
    // (display:none) — „Více → Mapa a vrstvy" tam dřív jen tiše nic neudělalo.
    // Když si uživatel vrstvy vyžádá, přepneme na Split, ať je vidí.
    function ensureMapVisible() {
        try {
            if (typeof viewMode === 'undefined' || viewMode !== 'ar') return;
            viewMode = 'both';
            if (typeof applyViewMode === 'function') applyViewMode();
            if (typeof window.agSyncViewControls === 'function') window.agSyncViewControls();
        } catch (e) { swallow(e, 'ensureMapVisible'); }
    }

    // ---- vybledání s ostatním HUD (zrcadlí tlačítko Menu, jako js/view-cycle.js) --------
    function syncFade() {
        var b = $('map-ctrl-toggle'), mt = $('menu-toggle-btn');
        if (b && mt) b.classList.toggle('ui-faded', mt.classList.contains('ui-faded'));
    }

    // ---- init -----------------------------------------------------------------------------
    function init() {
        applyFab();
        injectSetting();
        proStyly();
        wireProClick();
        wireOptionalRows();
        wireActions();
        adopt();
        syncCompact();
        syncAll();

        // otevření panelu (odkudkoli — tlačítko v mapě i „Více") hlídáme na třídě;
        // při každém otevření se přepočítají i zámky Pro (licence mohla přijít mezitím)
        try {
            var wasOpen = isOpen();
            new MutationObserver(function () {
                var now = isOpen();
                if (now && !wasOpen) { ensureMapVisible(); syncCompact(); wireOptionalRows(); syncAll(); }
                wasOpen = now;
            }).observe(controls(), { attributes: true, attributeFilter: ['class'] });
        } catch (e) { swallow(e, 'init'); }

        // změna licence (js/licence.js: klíč opsaný, tarif účtu, režim vlastníka)
        window.addEventListener('aglic:zmena', function () { wireOptionalRows(); syncAll(); });

        // stav: grafika.js přehazuje .ctrl-active na těchto tlačítkách
        try {
            var obs = new MutationObserver(function () { syncAll(); });
            ['btn-baselayer', 'btn-katastr', 'btn-connect'].forEach(function (id) {
                var el = $(id);
                if (el) obs.observe(el, { attributes: true, attributeFilter: ['class'] });
            });
            // nová tlačítka injektovaná moduly (hlásí se až po DOMContentLoaded)
            var stack = $('map-ctrl-stack');
            if (stack) {
                new MutationObserver(function () { adopt(); wireOptionalRows(); }).observe(stack, { childList: true });
            }
        } catch (e) { swallow(e, 'init'); }

        // Esc zavře panel (na desktopu/při klávesnici)
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && isOpen()) close();
        });

        // změna velikosti mapy: přepnutí AR/Split/Mapa i tažení dělítka mezi kamerou
        // a mapou (#resizer) mění výšku, od které se odvíjí kompaktní režim
        window.addEventListener('resize', syncCompact);
        window.addEventListener('orientationchange', function () { setTimeout(syncCompact, 250); });
        try {
            if (window.ResizeObserver && controls()) new ResizeObserver(syncCompact).observe(controls());
        } catch (e) { swallow(e, 'init'); }

        // vybledání + dopočet stavu (levné, sdílený UI časovač appky kvůli baterii)
        (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
            try { syncFade(); if (isOpen()) { syncCompact(); wireOptionalRows(); syncAll(); } } catch (e) { swallow(e, 'init'); }
            // Výchozí stav kolečka v mapě závisí na tom, jestli je „Vrstvy" v liště —
            // a to se dozvíme až po přihlášení (applyPerms v js/ucty.js běží po initu).
            // Přepínač v Nastavení proto dorovnáváme taky, jinak by ukazoval starý stav.
            try {
                applyFab();
                var c = $('s-mapfab');
                if (c && c.checked !== fabOn()) c.checked = fabOn();
            } catch (e) { swallow(e, 'init'); }
        }, 3000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    // veřejné API (jiné moduly / hledání)
    window.AGMapTools = { sync: syncAll, close: close, adopt: adopt, compact: syncCompact, pro: syncPro };
})();
