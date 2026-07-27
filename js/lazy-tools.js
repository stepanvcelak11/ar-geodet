// ===== AR Geodet — DĚLENÉ NAČÍTÁNÍ NÁSTROJŮ (ODPOJITELNÁ vrstva) ================
// Neinvazivní vrstva ve stylu js/field-tools.js. NEEDITUJE logika.js ani grafika.js.
//
// PROČ: při každém startu se stahovalo a spouštělo 118 skriptů (~3,1 MB). Většinu
// z toho tvoří nástroje, které se za celý den ani neotevřou — a každý nový nástroj
// zdražoval start VŠEM. Tohle je startovní dávka: 10 nástrojů, které do doby, než
// je uživatel otevře, nedělají NIC než že zapíší svou dlaždici (~362 kB).
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
// nedělá nic než agRegisterFieldTool a nikdo jiný nevolá jeho API.
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
            open: 'agOpenPocasi', icon: I_SUN
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
        }
    ];

    var _loaded = {};    // src -> Promise

    function toast(msg) {
        try { if (typeof quickToast === 'function') { quickToast(msg); return; } } catch (e) {}
    }
    function fail(msg) {
        try { if (typeof window.agAlert === 'function') { window.agAlert('Nástroj se nepovedlo načíst', msg); return; } } catch (e) {}
        toast(msg);
    }

    // ---- načtení souboru -----------------------------------------------------------
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
    function openTool(t, args) {
        var slow = setTimeout(function () { toast('Načítám ' + t.label + '…'); }, 250);
        return load(t.src).then(function () {
            clearTimeout(slow);
            var fn = resolve(t.open);
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
            if (!t.open || t._stub) return;
            var parts = t.open.split('.');
            if (parts.length === 1) {
                if (typeof window[parts[0]] === 'function') return;   // modul už je načtený
                window[parts[0]] = function () { return openTool(t, [].slice.call(arguments)); };
            } else {
                // 'AGDgps.open' — objekt s jednou metodou; skutečný modul ho celý přepíše
                var holder = window[parts[0]];
                if (holder && typeof holder[parts[1]] === 'function') return;
                var obj = {};
                obj[parts[1]] = function () { return openTool(t, [].slice.call(arguments)); };
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
