// ===== AR Geodet — MAPA A VRSTVY: chování panelu (ODPOJITELNÁ vrstva) ===========
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
//   • VOLITELNÉ ŘÁDKY: Terén (DMR 5G), Parcely (vektor) a Vlastní podklad se
//     zobrazí jen když příslušný modul existuje; Terén klikne na injektované
//     #btn-terrain, takže js/dmr-terrain.js zůstává nedotčený.
//   • ADOPCE: cokoli, co jiný modul injektuje do #map-ctrl-stack, dostane
//     popisek z aria-label a vzhled dlaždice — nové nástroje mapy tak nepřijdou
//     do panelu jako bezejmenná ikona.
//   • Akční dlaždice po klepnutí panel zavřou (ať je vidět mapa); přepínače
//     vrstev ne — jich se obvykle mačká víc za sebou.
//   • Vstupní tlačítko lze schovat: Nastavení → Vzhled → „Tlačítko vrstev v mapě"
//     (klíč agMapFab, třída body.ag-mapfab-off). VÝCHOZE je od 9. 8. 2026 SCHOVANÉ,
//     když stejný panel otevírá i „Vrstvy" v liště — viz fabOn() níž.
//
// NEEDITUJE logika.js ani grafika.js. Odstranění: smaž js/map-tools.js + řádek
// <script> v index.html (a přegeneruj sw.js). Panel pak zůstane staticky
// funkční (tlačítka mají inline onclick), jen bez stavu, adopce a přepínače.
// ================================================================================
(function () {
    'use strict';
    if (window.__agMapToolsInit) return;
    window.__agMapToolsInit = true;

    var FAB_KEY = 'agMapFab';        // '0' = vstupní tlačítko v mapě schované

    function $(id) { return document.getElementById(id); }
    function controls() { return $('map-controls'); }
    function isOpen() { var c = controls(); return !!(c && c.classList.contains('expanded')); }
    function close() { var c = controls(); if (c) c.classList.remove('expanded'); }

    // ---- podklad: výběr místo cyklení -------------------------------------------
    // grafika.js umí jen cycleBaseLayer() (přepnutí OSM<->ortofoto). Podkladů jsou
    // dva, takže „nastav na X" = zavolej cycle, když tam ještě nejsem.
    function curBase() {
        try { if (typeof visSettings !== 'undefined' && visSettings) return (visSettings.baseLayer === 'ortofoto') ? 'ortofoto' : 'osm'; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:curBase'); }
        // fallback: stav si drží třída na #btn-baselayer (věší ji applyMapLayers)
        var b = $('btn-baselayer');
        return (b && b.classList.contains('ctrl-active')) ? 'ortofoto' : 'osm';
    }
    window.agMapSetBase = function (which) {
        var want = (which === 'ortofoto') ? 'ortofoto' : 'osm';
        if (curBase() === want) { syncBase(); return; }
        try {
            if (typeof window.cycleBaseLayer === 'function') window.cycleBaseLayer();
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:agMapSetBase'); }
        syncBase();
    };

    // ---- zrcadlení stavu do panelu ------------------------------------------------
    function syncBase() {
        var orto = curBase() === 'ortofoto';
        var bo = $('btn-baselayer'), bm = $('ms-base-osm');
        if (bo) bo.classList.toggle('on', orto);
        if (bm) bm.classList.toggle('on', !orto);
    }
    // Terén: přepínač jen zrcadlí injektované #btn-terrain (dmr-terrain.js)
    function syncTerrain() {
        var row = $('ms-terrain'), src = $('btn-terrain');
        if (!row) return;
        if (!src) { row.hidden = true; return; }
        row.hidden = false;
        row.classList.toggle('ctrl-active', src.classList.contains('ctrl-active'));
    }
    function activeLayers() {
        var n = 0;
        var k = $('btn-katastr'); if (k && k.classList.contains('ctrl-active')) n++;
        var t = $('btn-terrain'); if (t && t.classList.contains('ctrl-active')) n++;
        return n;
    }
    function syncBadge() {
        var b = $('map-ctrl-badge');
        if (!b) return;
        var n = activeLayers();
        b.hidden = (n === 0);
        b.textContent = n ? String(n) : '';
    }
    function syncAll() { syncBase(); syncTerrain(); syncBadge(); }

    // ---- kompaktní režim: nízká mapa (Split) --------------------------------------
    // Panel se stropem 430 px se do poloviční mapy nevejde; v kompaktu zmizí popisky
    // pod názvy vrstev a smrsknou se odsazení, takže je vidět i spodní řada dlaždic.
    function syncCompact() {
        var box = controls(), sheet = $('map-sheet');
        if (!box || !sheet) return;
        var h = box.clientHeight || 0;
        if (!h) return;                        // mapa schovaná (režim „jen AR")
        sheet.classList.toggle('ms-compact', h < 430);
    }

    // ---- volitelné řádky podle dostupných modulů ------------------------------------
    function wireOptionalRows() {
        var t = $('ms-terrain');
        if (t && !t.__wired) {
            t.__wired = true;
            t.addEventListener('click', function () {
                var src = $('btn-terrain');
                if (!src) return;
                src.click();                      // veškerá logika zůstává v dmr-terrain.js
                setTimeout(syncAll, 60);          // stav si modul nastaví sám, pak ho zrcadlíme
            });
        }
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
    // Modul jako js/dmr-terrain.js si do #map-ctrl-stack vloží bezejmenné kolečko.
    // Dáme mu popisek z aria-label a vzhled dlaždice, ať v panelu nevypadá cizí.
    var KNOWN = { 'btn-terrain': 1 };   // Terén má vlastní řádek → dlaždici nechceme
    function adopt() {
        var stack = $('map-ctrl-stack');
        if (!stack) return;
        var kids = stack.children, i;
        for (i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (el.__agAdopted) continue;
            el.__agAdopted = true;
            if (KNOWN[el.id]) { el.hidden = true; el.style.display = 'none'; continue; }
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
        try { v = localStorage.getItem(FAB_KEY); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:fabOn'); }
        if (v === '1') return true;
        if (v === '0') return false;
        return !dockHasLayers();
    }
    function applyFab() {
        try { document.body.classList.toggle('ag-mapfab-off', !fabOn()); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:applyFab'); }
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
            try { localStorage.setItem(FAB_KEY, this.checked ? '1' : '0'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:injectSetting'); }
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
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:ensureMapVisible'); }
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
        wireOptionalRows();
        wireActions();
        adopt();
        syncCompact();
        syncAll();

        // otevření panelu (odkudkoli — tlačítko v mapě i „Více") hlídáme na třídě
        try {
            var wasOpen = isOpen();
            new MutationObserver(function () {
                var now = isOpen();
                if (now && !wasOpen) { ensureMapVisible(); syncCompact(); syncAll(); }
                wasOpen = now;
            }).observe(controls(), { attributes: true, attributeFilter: ['class'] });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:init'); }

        // stav: grafika.js přehazuje .ctrl-active na těchto tlačítkách
        try {
            var obs = new MutationObserver(function () { syncAll(); });
            ['btn-baselayer', 'btn-katastr', 'btn-connect', 'btn-terrain'].forEach(function (id) {
                var el = $(id);
                if (el) obs.observe(el, { attributes: true, attributeFilter: ['class'] });
            });
            // nová tlačítka injektovaná moduly (dmr-terrain se hlásí až po DOMContentLoaded)
            var stack = $('map-ctrl-stack');
            if (stack) {
                new MutationObserver(function () {
                    adopt(); wireOptionalRows();
                    var bt = $('btn-terrain');
                    if (bt) { try { obs.observe(bt, { attributes: true, attributeFilter: ['class'] }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:init'); } }
                }).observe(stack, { childList: true });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:init'); }

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
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:init'); }

        // vybledání + dopočet stavu (levné, sdílený UI časovač appky kvůli baterii)
        (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
            try { syncFade(); if (isOpen()) { syncCompact(); syncAll(); } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:init'); }
            // Výchozí stav kolečka v mapě závisí na tom, jestli je „Vrstvy" v liště —
            // a to se dozvíme až po přihlášení (applyPerms v js/ucty.js běží po initu).
            // Přepínač v Nastavení proto dorovnáváme taky, jinak by ukazoval starý stav.
            try {
                applyFab();
                var c = $('s-mapfab');
                if (c && c.checked !== fabOn()) c.checked = fabOn();
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-tools:init'); }
        }, 3000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    // veřejné API (jiné moduly / hledání)
    window.AGMapTools = { sync: syncAll, close: close, adopt: adopt, compact: syncCompact };
})();
