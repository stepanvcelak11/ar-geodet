// ===== QTRIG — PANEL „MAPA" VE TŘECH PATRECH: záložky, karty podkladu, přepínače (ODPOJITELNÁ) ======
// (17. 9. 2026, uživatel vybral „A" ze stránky „Kam s nástroji mapy" + „ať je to příjemné, ne zahlcující")
//
// Doplněk k markupu #map-sheet v index.html a k js/map-tools.js (stav, zámky Pro, adopce dlaždic):
//   • ZÁLOŽKY Podklad · Vrstvy · Nástroje (#ms-tabs) — vidět je vždy jen jedno patro; poslední
//     záložka se pamatuje (localStorage agMapaPanelTab). Bez tohoto modulu jsou patra pod sebou.
//   • PODKLAD jako dvě karty se vzorkem (Mapa · Ortofoto) + karta Katastr (přepínač vrstvy):
//     Mapa = vlastní vektorová mapa (js/mapa-vektor.js) a podklad „osm" — když se vektor nedá
//     zapnout (slabší telefon, bez dat), zůstává pod kartou tiše rastr OSM, karta svítí dál;
//     pod kartami styl vektorové mapy (Podle motivu · Den · Noc · Modrotisk · Tisk) a řádek
//     „Země měření". Karta „Mapa (rastr OSM)" jako samostatná volba ZRUŠENA 18. 9. 2026
//     (uživatel: „ta moje mapa vizuálně funguje líp, obyčejnou mapu pryč"); mapa() zůstává
//     jako API pro testy a pojistku.
//   • VRSTVY: řádky Překážky (schová/ukáže obtažené překážky, AGOkoli.viditelne) a Trasa terénem
//     (AGTrasa.nastav) — odkryjí se, jakmile moduly existují; stav se zrcadlí do přepínačů.
//   • NÁSTROJE: dlaždice 3D pohled / Kde se dá měřit / Náčrt / Stáhnout oblast volají otvíráky
//     lazy nástrojů (placeholdery z js/lazy-tools.js), zbytek je jako dřív.
// NEEDITUJE logika.js ani grafika.js. Odstranění: smaž js/mapa-panel.js + <script> v index.html;
// panel pak ukazuje všechna patra najednou (záložky zmizí přes CSS body:not(.ag-mapa-panel)).
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGMapaPanel) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'mapa-panel:' + kde); } catch (e2) { /* nic */ } };
    var KEY = 'agMapaPanelTab';
    function $(id) { return document.getElementById(id); }
    function sheet() { return $('map-sheet'); }

    // ---- záložky ---------------------------------------------------------------------------------
    var tab = 'vrstvy';
    try { var t0 = localStorage.getItem(KEY); if (t0 === 'podklad' || t0 === 'vrstvy' || t0 === 'nastroje') tab = t0; } catch (e) { /* nic */ }
    function ukazTab(t, bezUlozeni) {
        tab = t; if (!bezUlozeni) { try { localStorage.setItem(KEY, t); } catch (e) { /* nic */ } }
        var sh = sheet(); if (!sh) return;
        sh.querySelectorAll('.ms-tab').forEach(function (s) { s.hidden = s.getAttribute('data-ms-tab') !== t; });
        var btns = sh.querySelectorAll('#ms-tabs [data-ms-tab]'), i = 0, akt = 0;
        btns.forEach(function (b, k) { var on = b.getAttribute('data-ms-tab') === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); if (on) akt = k; });
        var ind = sh.querySelector('.ms-tabs-ind'); if (ind) { ind.style.width = (100 / btns.length) + '%'; ind.style.transform = 'translateX(' + (akt * 100) + '%)'; }
        var sc = sh.querySelector('.ms-scroll'); if (sc) sc.scrollTop = 0;
        void i;
    }
    function tabsUi() {
        var tb = $('ms-tabs'); if (!tb || tb.__wired) return; tb.__wired = true;
        tb.addEventListener('click', function (ev) { var b = ev.target.closest('[data-ms-tab]'); if (b) ukazTab(b.getAttribute('data-ms-tab')); });
        // přejetí prstem po obsahu = vedlejší záložka (jen vodorovný tah, ať to nepere se scrollem)
        var sc = sheet() && sheet().querySelector('.ms-scroll'), x0 = null, y0 = null;
        if (sc) {
            sc.addEventListener('touchstart', function (e) { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
            sc.addEventListener('touchend', function (e) {
                if (x0 == null) return; var t = e.changedTouches && e.changedTouches[0]; if (!t) return;
                var dx = t.clientX - x0, dy = t.clientY - y0; x0 = y0 = null;
                if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return;
                var poradi = ['podklad', 'vrstvy', 'nastroje'], i = poradi.indexOf(tab) + (dx < 0 ? 1 : -1);
                if (i >= 0 && i < poradi.length) ukazTab(poradi[i]);
            }, { passive: true });
        }
        document.body.classList.add('ag-mapa-panel');
        ukazTab(tab, true);
    }

    // ---- podklad -----------------------------------------------------------------------------------
    function MV() { return window.AGMapaVektor || null; }
    function vektorZap() { try { return !!(MV() && MV().stav() === 'zapnuto'); } catch (e) { return false; } }
    function base() { try { return (typeof visSettings !== 'undefined' && visSettings && visSettings.baseLayer === 'ortofoto') ? 'ortofoto' : 'osm'; } catch (e) { return 'osm'; } }
    function vektor() {
        var mv = MV();
        try { if (typeof agMapSetBase === 'function') agMapSetBase('osm'); } catch (e) { swallow(e, 'base'); }
        // bez modulu / ve slabším telefonu zůstává rastr — karta Mapa platí i tak, nic nehlásit
        if (!mv || (window.AGLite && AGLite.lite) || vektorZap()) { sync(); return; }
        try { $('ms-base-vektor').classList.add('busy'); } catch (e) { /* nic */ }
        mv.nastav({ zap: true }).then(function (ok) {
            try { $('ms-base-vektor').classList.remove('busy'); } catch (e) { /* nic */ }
            if (!ok) { try { window.agInfo && window.agInfo('Vektorová mapa se nezapnula: ' + (mv.chyba() || 'neznámá chyba')); } catch (e) { /* nic */ } }
            sync();
        });
    }
    function mapa() {
        var mv = MV();
        try { if (typeof agMapSetBase === 'function') agMapSetBase('osm'); } catch (e) { swallow(e, 'base'); }
        if (mv && vektorZap()) mv.nastav({ zap: false }).then(sync); else sync();
    }
    function styl(v) { var mv = MV(); if (!mv) return; mv.nastav({ styl: v }).then(sync); }
    // ve splitu (nízká mapa, .ms-compact) panel zakrývá celou mapu — po volbě podkladu se zavře, ať je
    // vidět, že se něco stalo (18. 9. 2026: „ve splitu se mi vektor ani ortofoto nezapíná")
    function poVolbePodkladu() { try { var sh = sheet(); if (sh && sh.classList.contains('ms-compact')) setTimeout(function () { var mc = $('map-controls'); if (mc) mc.classList.remove('expanded'); }, 250); } catch (e) { /* nic */ } }
    function podkladUi() {
        var bm = $('ms-base-osm'); if (bm && !bm.__wired) { bm.__wired = true; bm.addEventListener('click', function () { setTimeout(mapa, 0); poVolbePodkladu(); }); }
        var bo = $('btn-baselayer'); if (bo && !bo.__wired) { bo.__wired = true; bo.addEventListener('click', function () { setTimeout(sync, 0); poVolbePodkladu(); }); }
        var bv = $('ms-base-vektor'); if (bv && !bv.__wired) { bv.__wired = true; bv.addEventListener('click', function () { poVolbePodkladu(); }); }
        var st = $('ms-styl'); if (st && !st.__wired) { st.__wired = true; st.addEventListener('click', function (ev) { var b = ev.target.closest('[data-styl]'); if (b) styl(b.getAttribute('data-styl')); }); }
    }

    // ---- vrstvy: překážky, trasa ---------------------------------------------------------------------
    function prekazky() { try { if (window.AGOkoli && AGOkoli.viditelne) AGOkoli.viditelne(!AGOkoli.viditelne()); } catch (e) { swallow(e, 'prekazky'); } sync(); }
    function hlidac() { try { if (window.AGOkoli && AGOkoli.nastav) AGOkoli.nastav({ zap: !AGOkoli.zapnuto() }); } catch (e) { swallow(e, 'hlidac'); } sync(); }
    function trasa() { try { if (window.AGTrasa) { AGTrasa.nastav({ zap: !AGTrasa.zapnuto() }); if (AGTrasa.zapnuto()) AGTrasa.prepocitej('panel'); } } catch (e) { swallow(e, 'trasa'); } sync(); }

    // ---- zrcadlení stavu -----------------------------------------------------------------------------
    function sync() {
        try {
            var orto = base() === 'ortofoto', vek = !orto && vektorZap(), lite = !!(window.AGLite && AGLite.lite);
            var bo = $('btn-baselayer'), bm = $('ms-base-osm'), bv = $('ms-base-vektor');
            if (bo) bo.classList.toggle('on', orto);
            if (bm) bm.classList.toggle('on', !orto && !vek);   // starší markup se třemi kartami
            // karta Mapa svítí vždy, když není ortofoto — i když pod ní běží rastr (slabší telefon, bez dat)
            if (bv) {
                bv.classList.toggle('on', !orto);
                var sm = bv.querySelector('small');
                if (sm) { if (!sm.__cs) sm.__cs = sm.textContent; var chyba = !vek && !orto && MV() && MV().stav() === 'chyba'; sm.textContent = lite ? 'rastr (slabší telefon)' : (chyba ? 'rastr — data mapy nejsou' : sm.__cs); }
            }
            var st = $('ms-styl'); if (st) { st.hidden = !vek; var cur = (MV() && MV().nastaveni().styl) || 'auto'; st.querySelectorAll('[data-styl]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-styl') === cur); }); }
            var z = $('ms-zeme'); if (z) { var s = window.AGSour; z.hidden = !s; if (s) { var a = s.aktivni(); $('ms-zeme-t').textContent = 'Země měření: ' + (a && a.nazev || 'jinde') + (s.rezim() === 'auto' ? ' (podle GPS)' : ' (ručně)'); } }
            var rp = $('ms-prekazky'); if (rp) { var ok = !!(window.AGOkoli && AGOkoli.viditelne); rp.hidden = !ok || !(AGOkoli.prekazky() || []).length; if (ok) rp.classList.toggle('ctrl-active', !!AGOkoli.viditelne()); }
            var rt = $('ms-trasa'); if (rt) { rt.hidden = !window.AGTrasa; if (window.AGTrasa) rt.classList.toggle('ctrl-active', !!AGTrasa.zapnuto()); }
            var rh = $('ms-hlidac'); if (rh) { rh.hidden = !(window.AGOkoli && AGOkoli.zapnuto); if (!rh.hidden) rh.classList.toggle('ctrl-active', !!AGOkoli.zapnuto()); }
            var t3 = $('ms-t-3d'); if (t3) t3.hidden = !!(window.AGLite && AGLite.lite);
        } catch (e) { swallow(e, 'sync'); }
    }

    function start() {
        tabsUi(); podkladUi(); sync();
        var mc = $('map-controls');
        if (mc) { try { new MutationObserver(function () { if (mc.classList.contains('expanded')) sync(); }).observe(mc, { attributes: true, attributeFilter: ['class'] }); } catch (e) { swallow(e, 'observer'); } }
        ['ag:mapa-vektor', 'ag:zeme', 'ag:prekazky'].forEach(function (ev) { document.addEventListener(ev, function () { setTimeout(sync, 50); }); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    window.AGMapaPanel = { vektor: vektor, mapa: mapa, styl: styl, prekazky: prekazky, trasa: trasa, hlidac: hlidac, sync: sync, tab: ukazTab, aktualniTab: function () { return tab; } };
})();
