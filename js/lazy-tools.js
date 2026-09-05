// ===== AR Geodet — DĚLENÉ NAČÍTÁNÍ NÁSTROJŮ (ODPOJITELNÁ vrstva) ================
// Neinvazivní vrstva ve stylu js/field-tools.js. NEEDITUJE logika.js ani grafika.js.
//
// PROČ: při každém startu se stahovalo a spouštělo 118 skriptů (~3,1 MB). Většinu
// z toho tvoří nástroje, které se za celý den ani neotevřou — a každý nový nástroj
// zdražoval start VŠEM. Tohle je dávka 29 nástrojů, které do doby, než je
// uživatel otevře, nedělají NIC než že zapíší svou dlaždici (~1 054 kB).
//
// JAK: modul za ně zapíše ZÁSTUPNOU dlaždici (stejný popisek, ikona, kategorie
// i pořadí) a teprve klepnutí stáhne skutečný soubor. Ten se pak zaregistruje sám
// pod stejným id — window.agRegisterFieldTool nahrazuje záznam podle id, takže se
// zástupná dlaždice tiše přepíše skutečnou a dál se chová jako předtím.
//
// OFFLINE: soubory ZŮSTÁVAJÍ v ASSETS_TO_CACHE (scripts/gen_sw_assets.py má na to
// seznam EXTRA_ASSETS), takže je service worker předcacheuje při instalaci a lazy
// načtení funguje i bez signálu. Bez toho by nástroj v terénu nešel otevřít.
//
// API STUBY: nástroj, na který si volá jiný modul (Počasí z brífinku, Zápisníky
// z Průvodce), dostane zástupnou globální funkci — ta soubor dotáhne a předá volání
// dál. Skutečný modul si pak stub přepíše sám.
//
// CO TU ZÁMĚRNĚ NENÍ (a proč se to načítá dál hned při startu):
//   • slunce.js       — AGSun čte bezpecnost.js, ucty.js i tlačítko v Kompasu
//   • gps-semafor.js  — AGSemafor čte brutal-gps.js a stavová bublina
//   • parcela.js      — při startu se hlásí do lišty „Pokračovat" (AGDraft)
//   • brifink.js      — sám se otevírá při prvním spuštění dne
//   • cokoli, co při startu vkládá řádek do Nastavení, do menu „Více", kreslí do
//     mapy/AR, obaluje funkce appky nebo hlásí odznak (epochy, závady, docházka…)
// Pravidlo pro rozšiřování dávky: nástroj smí do MANIFESTu, jen když jeho init()
// nedělá nic než agRegisterFieldTool a nikdo jiný nevolá jeho API. Ověřuje se to
// ČTENÍM modulu, ne odhadem: `register()` musí končit u dlaždice, tělo IIFE smí
// nanejvýš definovat globály a poslouchat 'pagehide', a grep přes celou appku
// nesmí najít jinou cestu do jeho API než otevírací funkci z `open`.
//
// STYLOPIS: `css: 'css/neco.css'` — připojí se až s modulem. V <head> index.html
// je <link> render-blokující, takže okno otvírané jednou za měsíc tam zdržovalo
// PRVNÍ OBRAZ appky. Soubor musí zůstat v EXTRA_ASSETS (gen_sw_assets.py).
//
// Odstranění: smaž js/lazy-tools.js + jeho řádek <script> v index.html, vrať do
// index.html <script> řádky nástrojů z MANIFESTu a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.__agLazyInit) return;
    window.__agLazyInit = true;

    // ---- manifest ------------------------------------------------------------------
    // label / cat / order / icon jsou OPSANÉ z registrace v samotném modulu — musí
    // sedět, jinak dlaždice po načtení poskočí jinam v mřížce.
    // open: název globální funkce, kterou modul vystavuje (může být 'A.b').
    var I_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2M4.9 4.9l1.4 1.4M2 12h2M19.1 4.9l-1.4 1.4M17.7 9.2A5 5 0 1 0 9 12.5"/><path d="M13 22H7a4 4 0 1 1 .6-7.96A5.5 5.5 0 0 1 18.4 16 3 3 0 0 1 18 22h-5z"/></svg>';
    var MANIFEST = [
        {
            id: 'pocasi', src: 'js/pocasi.js', label: 'Počasí', cat: 'Pomůcky', order: 7,
            open: 'agOpenPocasi', icon: I_SUN, css: 'css/pocasi.css'
        },
        {
            id: 'zapisnik', src: 'js/zapisnik.js', label: 'Zápisníky (nivelace, směry)', order: 4,
            open: 'agOpenZapisnik',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>'
        },
        {
            id: 'dgps', src: 'js/dgps.js', label: 'Dvoutelefonní DGPS', cat: 'Měření', order: 7,
            open: 'AGDgps.open',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="7" height="14" rx="2"/><rect x="14" y="5" width="7" height="14" rx="2"/><path d="M10 12h4"/></svg>'
        },
        {
            id: 'vrstvy', src: 'js/vrstvy.js', label: 'Vrstvy / pokládka', order: 7,
            open: 'agOpenVrstvy', icon: '<svg class="icon"><use href="#i-layers"/></svg>'
        },
        {
            id: 'kontrola-vrstvy', src: 'js/kontrola-vrstvy.js', label: 'Kontrola vrstvy',
            cat: 'Vytyčování a náčrt', order: 15,
            open: 'agOpenKontrolaVrstvy',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h18"/><path d="M3 12h18"/><path d="m7 8 2-3 3 4 2-2 3 5"/><path d="M5 20h1M11 20h2M18 20h1"/></svg>'
        },
        {
            id: 'denik-dne', src: 'js/denik-dne.js', label: 'Deník dne', cat: 'Pomůcky', order: 62,
            open: 'agOpenDenikDne',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 9.5h18"/><path d="m8.7 15.2 2.2 2.2 4.4-4.4"/></svg>'
        },
        {
            id: 'kniha-jizd', src: 'js/kniha-jizd.js', label: 'Kniha jízd', cat: 'Pomůcky', order: 63,
            open: 'agOpenKnihaJizd',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17V12l1.6-4a2 2 0 0 1 1.9-1.3h9a2 2 0 0 1 1.9 1.3L20 12v5"/><path d="M4 17h16M6.5 17v2M17.5 17v2M6 12.5h12"/><path d="M9 21h6"/></svg>'
        },
        {
            id: 'postupy', src: 'js/postupy.js', label: 'Postupy měření', order: 3,
            open: 'agOpenPostupy',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><polyline points="9 7 11 9 15 5"/><line x1="9" y1="13" x2="15" y2="13"/></svg>'
        },
        {
            id: 'gnss-forecast', src: 'js/gnss-forecast.js', label: 'GNSS předpověď', cat: 'Měření', order: 9,
            open: 'agOpenGnssForecast',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2M4.6 5.6l1.4 1.4M19.4 5.6 18 7"/><circle cx="12" cy="11" r="4"/><path d="M3 19h18M6 22h12"/></svg>'
        },
        {
            id: 'korekce', src: 'js/korekce.js', label: 'Korekce měření', cat: 'Měření', order: 10,
            open: 'agOpenKorekce',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5h4v10.2a4 4 0 1 1-4 0z"/><path d="M12 17.5v.01"/><path d="M16.5 6.5H20M16.5 10H19M16.5 13.5H20"/></svg>'
        },
        {
            id: 'checklist', src: 'js/checklist.js', label: 'Co s sebou', cat: 'Pomůcky', order: 10,
            open: 'agOpenChecklist',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"/><rect x="4" y="6" width="16" height="15" rx="2"/><path d="m8.5 12 1.8 1.8 3.5-3.6M8.5 17.5h7"/></svg>'
        },

        // ---- 2. dávka (5. 9. 2026) — samá okna, která do klepnutí nedělají NIC -------
        // Ověřeno u každého zvlášť: jeho register() jen vloží vlastní <style> a zapíše
        // dlaždici, tělo modulu při načtení nanejvýš zaregistruje 'pagehide' (uklidit
        // kameru/nahrávání) a jeho API nevolá nikdo jiný než přes otevírací funkci níž.
        // Dřív visely v index.html jako type="ag/lazy", jenže tu frontu js/lazy-load.js
        // pouští 700 ms po startu BEZPODMÍNEČNĚ — takže se stáhly a spustily všem,
        // i tomu, kdo za celý den otevře tři nástroje. Tohle je 495 kB, které se
        // teď stahují až na klepnutí.
        // ZÁMĚRNĚ TU NEJSOU (ověřeno, že by to rozbily):
        //   rajon, ar-intersection, stakeout-line, offset-point — hlásí se do lišty
        //     „Pokračovat" (AGDraft), takže rozdělaná úloha by po restartu zmizela
        //   utility-networks, project-import — při startu kreslí uložené sítě/situaci
        //     do mapy a AR
        //   epochy — obaluje loadProjectSettings()
        //   foto-protinani — window.AGFotoProtinani.test čte scripts/test_navrhy_d2.py
        //   plakat-dne — má vlastní tik 1,5 s (hookDenik)
        {
            id: 'ar-resection', src: 'js/ar-resection.js', label: 'Resekce ze známých bodů (poloha + sever)', order: 5,
            open: 'agOpenResection',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.4"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/></svg>'
        },
        {
            id: 'free-station', src: 'js/free-station.js', label: 'Volné stanovisko (průvodce)', cat: 'AR a kalibrace', order: 4,
            open: 'agOpenFreeStation',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>'
        },
        {
            id: 'orient-point', src: 'js/orient-point.js', label: 'Srovnat sever podle bodu', order: 10,
            open: 'agOpenOrientTool',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="12,7 14.5,14.5 12,13 9.5,14.5" fill="currentColor" stroke="none"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>'
        },
        {
            id: 'ar-calib2', src: 'js/ar-calib2.js', label: 'Srovnat AR na 2 body', cat: 'AR a kalibrace', order: 1,
            open: 'agOpenCalib2',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="18" r="2.3"/><circle cx="19" cy="6" r="2.3"/><path d="M6.7 16.3 17.3 7.7"/></svg>'
        },
        {
            id: 'fov-kalib', src: 'js/fov-kalibrace.js', label: 'Zorný úhel kamery', cat: 'AR a kalibrace', order: 20,
            open: 'agOpenFovKalibrace',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V7"/><path d="M4 20 12 7l8 13"/><path d="M3.5 9.5a11 11 0 0 1 17 0"/></svg>'
        },
        {
            id: 'ar-metr', src: 'js/ar-metr.js', label: 'Metr v kameře', cat: 'Měření', order: 13,
            open: 'agOpenMetr',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="8" rx="1.6"/><path d="M6 8v3M10 8v4.5M14 8v3M18 8v4.5"/></svg>'
        },
        {
            id: 'indoor', src: 'js/indoor.js', label: 'Uvnitř budovy', cat: 'Měření', order: 12,
            open: 'agOpenIndoor',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V6.5L12 3l7 3.5V21"/><path d="M10 21v-5h4v5"/><circle cx="12" cy="10" r="1.4"/></svg>'
        },
        {
            id: 'obchuzka', src: 'js/obchuzka.js', label: 'Obchůzka výkopu', cat: 'Měření', order: 8,
            open: 'agOpenObchuzka',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 8 5l8 3 5-2.5"/><path d="M3 8.5V18l5 3 8-3 5 2.5V6.5"/><path d="M8 5v16M16 8v10"/></svg>'
        },
        {
            id: 'pdr-offset', src: 'js/pdr-offset.js', label: 'Krokový offset', cat: 'Měření', order: 8,
            open: 'AGPdr.open',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21v-3a3 3 0 0 1 3-3h0a3 3 0 0 0 3-3V9"/><circle cx="13" cy="5" r="2"/><path d="M17 21l2-5-3-2"/></svg>'
        },
        {
            id: 'hlas-kod', src: 'js/hlas-kod.js', label: 'Hlasové kódování', cat: 'Měření', order: 11,
            open: 'agOpenHlasKod',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="2.5" width="5" height="10" rx="2.5"/><path d="M5 10.5a6 6 0 0 0 12 0"/><path d="M11 16.5v2"/><path d="M17.5 17.5h4M19.5 15.5v4"/></svg>'
        },
        {
            id: 'vyska-objektu', src: 'js/vyska-objektu.js', label: 'Výška objektu', order: 9,
            open: 'agOpenVyskaObjektu',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h16"/><path d="M7 21V8l5-4 5 4v13" opacity="0.85"/><path d="M20 4v13M20 4l-2 2M20 4l2 2M20 17l-2-2M20 17l2-2" transform="translate(-1 0)"/></svg>'
        },
        {
            id: 'job-transfer', src: 'js/job-transfer.js', label: 'Poslat/načíst zakázku', cat: 'Data a přenos', order: 20,
            open: 'agOpenJobTransfer',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/><path d="M8 8l4-4 4 4"/><path d="M12 4v12"/></svg>'
        },
        {
            id: 'geo-foto', src: 'js/geo-foto.js', label: 'Geo-fotka', cat: 'Pomůcky', order: 64,
            open: 'agOpenGeoFoto',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H8l1.2-2h5.6L16 6h2.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.4"/><path d="M12 8.4v1.2M12 16.4v1.2M7.4 13h1.2M15.4 13h1.2"/></svg>'
        },
        {
            id: 'kde-je', src: 'js/kde-je.js', label: 'Kde co mám', cat: 'Pomůcky', order: 9,
            open: 'agOpenKdeJe',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16V11l1.7-4.2A2 2 0 0 1 8.6 5.5h6.8a2 2 0 0 1 1.9 1.3L19 11v5"/><path d="M5 16h14M7.5 16v2M16.5 16v2M7 11.5h10"/></svg>'
        },
        {
            id: 'trenazer', src: 'js/trenazer.js', label: 'Terénní trenažér', cat: 'Pomůcky', order: 64,
            open: 'AGTrenazer.open',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>'
        },
        {
            id: 'rocenka', src: 'js/rocenka.js', label: 'Ročenka',
            open: 'openRocenka',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/><circle cx="19" cy="6" r="1.6"/></svg>'
        },
        {
            // Oba konzumenti se ptají `if (window.agOpenHiddenPoints)` a zástupce
            // z stubApi() jim stačí — ten je funkce jako každá jiná, takže dotaz projde
            // a modul se dotáhne až při klepnutí. POZOR na rozdíl: index.html:761 se ptá
            // až UVNITŘ onclick, kdežto grafika.js:1385 („Správa bodů") při VYKRESLENÍ
            // řádku, tedy dřív. Drží to jen díky tomu, že se zástupci vystavují hned
            // v init() (DOMContentLoaded), tj. dávno před otevřením Správy bodů. Kdyby
            // se stubApi() někdy zpozdila nebo se zástupce nevystavil (vypnutý nástroj),
            // vykreslí se ve Správě bodů chudší varianta „Obnovit skryté body" bez
            // seznamu — nespadne to, ale je to tichá ztráta funkce.
            // Modul sám při načtení jen zapíše dlaždici.
            id: 'hidden-points', src: 'js/hidden-points.js', label: 'Skryté body',
            cat: 'Katastr a data', order: 50,
            open: 'agOpenHiddenPoints', icon: '<svg class="icon"><use href="#i-eye-off"/></svg>'
        },
        {
            id: 'odhadovacka', src: 'js/odhadovacka.js', label: 'Odhadni to', cat: 'Pomůcky',
            open: 'agOpenOdhad',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>'
        }
    ];

    var _loaded = {};    // src -> Promise

    function toast(msg) {
        try { if (typeof quickToast === 'function') { quickToast(msg); return; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'lazy-tools:toast'); }
    }
    function fail(msg) {
        try { if (typeof window.agAlert === 'function') { window.agAlert('Nástroj se nepovedlo načíst', msg); return; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'lazy-tools:fail'); }
        toast(msg);
    }

    // ---- načtení souboru -----------------------------------------------------------
    // Stylopis nástroje (css: v manifestu). Dřív visel jako <link> v <head>
    // index.html, kde je render-blokující — u Počasí to bylo 21 kB, o které se
    // odkládal PRVNÍ OBRAZ appky kvůli oknu, co se za den většinou neotevře.
    // Připojí se těsně před skriptem, ať je styl na místě dřív, než okno vyskočí.
    // Soubor MUSÍ zůstat v EXTRA_ASSETS (scripts/gen_sw_assets.py), jinak by
    // v terénu bez signálu nedorazil.
    function loadCss(href) {
        if (!href) return;
        try {
            if (window.AG && typeof AG.cssFile === 'function') { AG.cssFile('agcss-' + href.replace(/[^\w]+/g, '-'), href); return; }
            var id = 'agcss-' + href.replace(/[^\w]+/g, '-');
            if (document.getElementById(id)) return;
            var l = document.createElement('link');
            l.id = id; l.rel = 'stylesheet'; l.href = href;
            (document.head || document.documentElement).appendChild(l);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'lazy-tools:css'); }
    }

    function load(src) {
        if (_loaded[src]) return _loaded[src];
        _loaded[src] = new Promise(function (res, rej) {
            // kdyby soubor už byl v DOM (ruční <script>, dvojí init), nepřidávej ho znovu
            var have = document.querySelector('script[src="' + src + '"], script[src="./' + src + '"]');
            if (have) { res(); return; }
            var el = document.createElement('script');
            el.src = src;
            el.async = false;                  // pořadí spuštění dle pořadí vložení
            el.onload = function () { res(); };
            el.onerror = function () {
                delete _loaded[src];           // aby šlo zkusit znovu (třeba až bude signál)
                rej(new Error('nelze načíst ' + src));
            };
            (document.head || document.documentElement).appendChild(el);
        });
        return _loaded[src];
    }

    // ---- zástupci (stuby) a jejich úklid --------------------------------------------
    // POZOR (nalezeno 8.8. v prohlížeči — appka TVRDĚ zamrzla po klepnutí na
    // „Dvoutelefonní DGPS"): některé moduly se brání dvojímu načtení testem na SVŮJ
    // globální objekt, např. js/dgps.js má `if (window.AGDgps) return;`. Když tam ale
    // leží náš ZÁSTUPCE (stubApi ho tvoří dopředu, aby šel nástroj otevřít i z kódu),
    // modul se rovnou ukončí a NIC nedefinuje. openTool pak vyresolvuje znovu TENTÝŽ
    // stub a zavolá ho:  stub -> load() (slib už splněný) -> stub -> ...  Je to
    // nekonečná smyčka v mikrotaskách, takže se ani nevyčerpá zásobník — jen se úplně
    // zastaví event loop: nereaguje nic, ani vykreslování. Proto stub PŘED načtením
    // modulu odklidíme a navíc ho nikdy nevoláme jako „výsledek" načtení.
    function markStub(fn) { try { fn._agLazyStub = true; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'lazy-tools:markStub'); } return fn; }
    function isStub(o) { return !!(o && o._agLazyStub); }
    function dropStub(t) {
        if (!t.open) return;
        var parts = t.open.split('.');
        if (parts.length === 1) {
            if (isStub(window[parts[0]])) clearGlobal(parts[0]);
        } else {
            var h = window[parts[0]];
            // maž jen držák, který jsme sami vyrobili — cizí objekt necháme být
            if (h && h._agLazyHolder && isStub(h[parts[1]])) clearGlobal(parts[0]);
        }
        t._stub = false;   // kdyby se modul nenačetl, smí stubApi() zástupce vrátit
    }
    function clearGlobal(name) {
        try { delete window[name]; } catch (e) { try { window[name] = undefined; } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'lazy-tools:clearGlobal'); } }
    }

    // 'AGDgps.open' -> window.AGDgps.open
    function resolve(path) {
        var parts = String(path || '').split('.'), o = window, i;
        for (i = 0; i < parts.length; i++) {
            if (o == null) return null;
            o = o[parts[i]];
        }
        return (typeof o === 'function') ? o : null;
    }

    // Otevření nástroje: dotáhni soubor a zavolej jeho vlastní otevírací funkci.
    // Modul si při načtení sám přepíše i případný stub, takže druhé klepnutí už jde
    // přímo na něj a tímhle kódem vůbec neprojde.
    // VYPÍNAČ MODULŮ (js/priznaky.js) se vymáhal jen u registrace dlaždice a u lazy
    // fronty z index.html. Tenhle soubor má ale vlastní načítací cestu i vlastní
    // zástupné globály, takže zhasnutý nástroj šel dál otevřít z rozcestníku,
    // z ranního brífinku i přes window.agOpenPocasi() — vlastník ho viděl vypnutý,
    // uživatel ho měl dál k dispozici. Ptáme se na id i na soubor, protože vlastník
    // smí zapsat obojí.
    function vypnuty(t) {
        try { return !!(window.AGFlags && (AGFlags.off(t.id) || AGFlags.off(t.src))); }
        catch (e) { return false; }
    }

    function openTool(t, args) {
        // Kontrola i tady, ne jen ve stubApi(): vypínač může dorazit ze serveru AŽ
        // ZA BĚHU (tick v priznaky.js), kdy zástupce dávno existuje — a přes
        // window.AGLazyTools.open(id) se sem dá vejít i mimo něj.
        if (vypnuty(t)) { toast('Nástroj „' + t.label + '" správce aplikace vypnul.'); return Promise.resolve(); }
        var slow = setTimeout(function () { toast('Načítám ' + t.label + '…'); }, 250);
        loadCss(t.css);                    // styl okna jede s modulem, ne v <head>
        dropStub(t);                       // ať modul nevidí našeho zástupce (viz dropStub)
        return load(t.src).then(function () {
            clearTimeout(slow);
            var fn = resolve(t.open);
            // POJISTKA: zástupce se NIKDY nesmí zavolat jako výsledek načtení —
            // to je přesně ta nekonečná smyčka popsaná u dropStub().
            if (isStub(fn)) fn = null;
            if (fn) { fn.apply(window, args || []); return; }
            // Modul se načetl, ale nevystavil opener pod jménem z manifestu — to je
            // chyba v manifestu (přejmenované API), ne v datech uživatele.
            fail('Nástroj „' + t.label + '" se načetl, ale nejde otevřít — nahlas to prosím.');
        })['catch'](function (err) {
            clearTimeout(slow);
            console.warn('[lazy-tools]', err);
            fail('Soubor nástroje „' + t.label + '" chybí v offline paměti. Připoj se na chvíli k internetu '
                + 'a dej „Uložit pro offline".');
        });
    }

    // ---- zástupné dlaždice a API stuby ---------------------------------------------
    function registerAll() {
        if (typeof window.agRegisterFieldTool !== 'function') return false;
        MANIFEST.forEach(function (t) {
            if (t._reg) return;
            t._reg = true;
            var item = {
                id: t.id, label: t.label, icon: t.icon, order: t.order,
                onClick: function () { openTool(t); }
            };
            if (t.cat) item.cat = t.cat;
            window.agRegisterFieldTool(item);
        });
        return true;
    }

    function stubApi() {
        MANIFEST.forEach(function (t) {
            // Zástupce vypnutého nástroje se vůbec nevystaví: runTool() v
            // js/tools-hub.js pak vrátí false, brífink tlačítko schová a
            // balíček zakázky řekne, že nástroj v téhle sestavě není.
            if (!t.open || t._stub || vypnuty(t)) return;
            var parts = t.open.split('.');
            if (parts.length === 1) {
                if (typeof window[parts[0]] === 'function') return;   // modul už je načtený
                window[parts[0]] = markStub(function () { return openTool(t, [].slice.call(arguments)); });
            } else {
                // 'AGDgps.open' — objekt s jednou metodou; skutečný modul ho celý přepíše
                var holder = window[parts[0]];
                if (holder && typeof holder[parts[1]] === 'function') return;
                var obj = {};
                obj[parts[1]] = markStub(function () { return openTool(t, [].slice.call(arguments)); });
                obj._agLazyHolder = true;      // značka pro dropStub(): držák je náš
                window[parts[0]] = obj;
            }
            t._stub = true;
        });
    }

    // ---- init -----------------------------------------------------------------------
    var _tries = 0;
    function init() {
        stubApi();
        if (registerAll()) return;
        // field-tools.js se ještě nenačetl — zkusíme to znovu (stejný vzor jako moduly)
        if (_tries++ < 20) setTimeout(init, 400);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });

    // veřejné API: přednačtení (např. po startu na Wi-Fi) a ruční dotažení
    window.AGLazyTools = {
        manifest: MANIFEST,
        load: load,
        open: function (id) {
            for (var i = 0; i < MANIFEST.length; i++) if (MANIFEST[i].id === id) return openTool(MANIFEST[i]);
        }
    };
})();
