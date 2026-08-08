// ===== AR Geodet — POLOHA Z MAPY (ODPOJITELNÁ vrstva) ==========================
// PROČ: v lese, v úzké ulici a mezi paneláky je GPS telefonu nejslabší — odrazy
// od fasád a listí dělají chyby v metrech a průměrování je NEODSTRANÍ (je to
// systematická chyba, ne šum). Zatímco se telefon plete o 15 m, člověk často
// PŘESNĚ vidí, kde stojí: na ortofotu je pod ním roh budovy, obruba, kanál,
// rozvětvení cesty. Odečtení polohy z mapy je pak POCTIVĚJŠÍ zdroj než GPS.
//
// CO TO DĚLÁ: klepnutím do mapy nastavíš svoji polohu ručně. Appka ji pak bere
// jako svoji (AR šipky, vzdálenosti, azimuty, průměrovaná GPS, navigace na cíl),
// dokud režim nezrušíš.
//
// ČEHO SE DRŽÍ, ABY TO NEBYLO NEBEZPEČNÉ:
//   • Přesnost se NELŽE. Odvozuje se z měřítka mapy v okamžiku klepnutí
//     (metry na pixel × 8 px prst) a nikdy nejde pod 1 m — ortofoto ČÚZK má
//     svoji vlastní chybu a vlastní stanoviště se v něm taky nepozná lépe.
//     Když z toho vyjde horší číslo než hlásí GPS, appka to řekne.
//   • Stav je NEPŘEHLÉDNUTELNÝ: značka polohy zjantarová, kruh přesnosti je
//     čerchovaný a v upozorněních visí štítek „Poloha z mapy" s tlačítkem Zrušit.
//   • Sama se zruší, když odejdeš. Pozná se to na SUROVÉM GPS fixu: absolutní
//     poloha z GPS může být o 15 m vedle, ale ROZDÍL dvou fixů po sobě chůzi
//     spolehlivě ukáže. Po 25 m (třemi fixy za sebou, ať to nezruší jeden
//     zdivočelý fix) se ruční poloha pustí a appka se vrátí ke GPS.
//   • NEPŘEŽIJE restart appky. Ruční poloha se záměrně nikam neukládá — po
//     spuštění v jiné části zakázky by stará připnutá poloha byla past.
//
// Integrace (jen tři místa, jinak samostatné):
//   • js/logika.js — ve sledování polohy přebije userLat/userLng/přesnost
//     (bez toho by ruční polohu smazal hned nejbližší GPS fix) a nechá kruh
//     přesnosti jantarový.
//   • js/grafika.js — v obsluze kliknutí do mapy jedna větev pro sběr polohy.
//   • Tlačítko se injektuje do #map-ctrl-stack (panel Mapa a vrstvy si ho
//     „adoptuje" i s popiskem — viz js/map-tools.js).
//
// Odstranění: smaž tento soubor + řádek <script> v index.html (a přegeneruj
// sw.js). Zbylé tři háky jsou psané tak, že bez modulu nic nedělají.
// ================================================================================
(function () {
    'use strict';
    if (window.AGManualPos) return;

    var WALK_OFF_M = 25;      // o kolik se musí SUROVÝ GPS fix posunout = odešel jsem
    var WALK_OFF_HITS = 3;    // kolikrát za sebou (jeden divoký fix režim neshodí)
    var FINGER_PX = 8;        // reálná trefa prstem do mapy
    var ACC_FLOOR_M = 1;      // pod tuhle hodnotu se přesnost NELŽE (viz hlavička)
    var ACC_CEIL_M = 60;      // nad tím už je klepnutí do mapy nesmysl

    // ---- stav ------------------------------------------------------------------
    // Čte ho js/logika.js (onFix + lat/lng/acc), proto je na window.
    var S = {
        active: false,        // je ruční poloha zapnutá?
        armed: false,         // čekáme na klepnutí do mapy?
        lat: null, lng: null,
        acc: null,           // odhad přesnosti [m] odvozený z měřítka mapy
        ts: 0,               // kdy byla připnuta
        gpsAtPin: null,       // surový GPS fix v okamžiku připnutí {lat,lng}
        gpsAcc: null,        // co v tu chvíli hlásila GPS (do hlášky)
        offHits: 0           // počítadlo fixů „jsem daleko"
    };

    function $(id) { return document.getElementById(id); }
    function toast(msg) { try { if (typeof window.quickToast === 'function') window.quickToast(msg); } catch (e) {} }
    function num(v, d) { return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d).replace('.', ','); }

    // ---- vzhled ----------------------------------------------------------------
    function injectStyles() {
        if ($('agpos-css')) return;
        var st = document.createElement('style');
        st.id = 'agpos-css';
        st.textContent = [
            // lišta „klepni do mapy" — vzhled si bere z #map-pick-hint ve style.css,
            // ale je to VLASTNÍ prvek (režimy se nesmí přebíjet)
            '#agpos-hint{position:fixed;left:50%;transform:translateX(-50%);',
            '  top:max(calc(env(safe-area-inset-top,0px) + 10px), calc(var(--ag-stack-h,0px) + 10px));',
            // 1000000 = nad modaly, POD dialogy (--z-dialog 2000000) i undo-toastem;
            // width:max-content je povinne, jinak se lista pri left:50% vejde jen do
            // pulky displeje a slozi se na ctyri radky (stejna past jako u #update-banner)
            '  z-index:1000000;display:none;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px 12px;',
            '  width:max-content;max-width:calc(100vw - 20px);text-align:center;padding:9px 12px;border-radius:var(--r-lg,14px);',
            '  background:rgba(8,11,15,0.94);color:#fff;font-size:calc(13px * var(--ag-font-scale, 1));font-weight:600;',
            '  box-shadow:var(--shadow-2,0 8px 24px rgba(0,0,0,0.5));border:1px solid var(--warning,#f59e0b);}',
            '#agpos-hint.on{display:flex;}',
            '#agpos-hint small{display:block;width:100%;font-weight:500;opacity:.75;font-size:calc(11.5px * var(--ag-font-scale, 1));}',
            '#agpos-hint button{border:none;background:rgba(255,255,255,0.14);color:#fff;cursor:pointer;',
            '  font-size:calc(12px * var(--ag-font-scale, 1));font-weight:600;padding:6px 12px;border-radius:var(--r-pill,999px);}',
            // ZNAČKA POLOHY jantarově: CSS přebíjí i inline fill="#34d399" v divIconu
            // (prezentační atribut prohrává s pravidlem), takže logika.js zůstává beze změny.
            'body.ag-manual-pos #user-direction-container svg path{fill:var(--warning,#f59e0b) !important;}',
            'body.ag-manual-pos #user-direction-container > div:first-child{background:rgba(245,158,11,0.34) !important;}',
            // dlaždice v panelu Mapa a vrstvy, když režim běží
            '#btn-manualpos.ctrl-active{color:var(--warning,#f59e0b);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function hint(on, text) {
        injectStyles();
        var el = $('agpos-hint');
        if (!el) {
            el = document.createElement('div');
            el.id = 'agpos-hint';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        if (!on) { el.classList.remove('on'); el.innerHTML = ''; return; }
        el.innerHTML = text;
        el.classList.add('on');
        var c = el.querySelector('[data-act="cancel"]');
        if (c) c.addEventListener('click', function () { disarm(); });
        // návod: text je v TOOL_HELP (js/tools-plus.js), ať je na jednom místě
        var h = el.querySelector('[data-act="help"]');
        if (h) h.addEventListener('click', function () {
            try { if (typeof window.agToolHelp === 'function') window.agToolHelp('agPosFromMap', 'Poloha z mapy'); } catch (e) {}
        });
        var o = el.querySelector('[data-act="orto"]');
        if (o) o.addEventListener('click', function () {
            try { if (typeof window.agMapSetBase === 'function') window.agMapSetBase('ortofoto'); } catch (e) {}
            o.remove();
        });
    }

    // ---- přesnost z měřítka mapy ------------------------------------------------
    // Web Mercator: metry na pixel = 156543,034 * cos(šířka) / 2^zoom.
    // Tohle je jediné poctivé číslo, které z klepnutí do mapy vypadne: dál už
    // rozhoduje jen to, jak dobře poznáš sám sebe v podkladu (proto podlaha 1 m).
    function accFromZoom(lat, zoom) {
        var mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
        var a = mpp * FINGER_PX;
        if (!isFinite(a)) return 5;
        return Math.max(ACC_FLOOR_M, Math.min(ACC_CEIL_M, a));
    }

    // ---- zapsání polohy do appky ------------------------------------------------
    // userLat/userLng/currentGpsAccuracy jsou LEXIKÁLNÍ globály z logika.js (ne
    // window.*), takže se na ně dá psát holým přiřazením ze skriptu, který se
    // načítá po ní. Přepsat je hned je potřeba proto, aby AR a vzdálenosti
    // reagovaly OKAMŽITĚ — kdyby se čekalo na nejbližší GPS fix, uvnitř budovy
    // (kde fix nemusí přijít vůbec) by se nestalo nic.
    function apply() {
        try { userLat = S.lat; userLng = S.lng; currentGpsAccuracy = S.acc; } catch (e) {}
        try { magneticDeclination = getDeclination(S.lat, S.lng); } catch (e) {}
        try {
            window.AGFix = { ts: Date.now(), lat: S.lat, lng: S.lng, acc: S.acc, err: null, manual: true };
        } catch (e) {}
        // průměrování GPS začíná od čisté: staré vzorky jsou z chybné polohy a
        // „Z průměru GPS" by pak vrátilo mix ručního bodu a starého mraku fixů
        try { gpsSamples = []; gpsAvgResult = null; } catch (e) {}
        try { if (accuracyCircle) { accuracyCircle.setLatLng([S.lat, S.lng]); accuracyCircle.setRadius(S.acc); accuracyCircle.setStyle({ color: '#f59e0b', fillColor: '#f59e0b', dashArray: '5 5' }); } } catch (e) {}
        try { if (userMarker) userMarker.setLatLng([S.lat, S.lng]); } catch (e) {}
        // mapa se nemá cukat: klepnutí bylo mířené, tak si ho uživatel nechá tam,
        // kam ho dal — jen se srovná referenční střed, ať ho nesrovná příští fix
        try { lastCenterLat = S.lat; lastCenterLng = S.lng; } catch (e) {}
        // Vzdálenosti/azimuty přepočítat. Zakotvené stanovisko (AR resekce) má
        // přednost — tam AR záměrně nejede z GPS, takže do toho nesaháme.
        try {
            var anch = !!(window.AGPose && window.AGPose.valid && window.AGPose.originLat != null);
            if (!anch && typeof arPoints !== 'undefined' && arPoints && arPoints.length) {
                arPoints.forEach(function (p) {
                    p.currentDist = getDistance(S.lat, S.lng, p.lat, p.lng);
                    p.currentBearing = getBearing(S.lat, S.lng, p.lat, p.lng);
                });
                arPoints.sort(function (a, b) { return a.currentDist - b.currentDist; });
            }
        } catch (e) {}
        try { updateInfoPanel(); } catch (e) {}
    }

    // ---- štítek v upozorněních --------------------------------------------------
    var _tick = null;
    function status() {
        if (!S.active) return;
        var min = Math.round((Date.now() - S.ts) / 60000);
        var txt = 'Poloha z mapy (ručně) — ±' + num(S.acc, 1) + ' m'
            + (min >= 1 ? ' · ' + min + ' min' : '') + '. GPS se nepoužívá.';
        try {
            if (window.AGNotify && typeof AGNotify.set === 'function') {
                AGNotify.set('manual-pos', { level: 'warn', text: txt, order: -5, action: 'Zrušit', onAction: function () { clear(true); } });
            }
        } catch (e) {}
    }
    function statusOff() {
        try { if (window.AGNotify && typeof AGNotify.clear === 'function') AGNotify.clear('manual-pos'); } catch (e) {}
    }

    // ---- zapnutí / vypnutí režimu sběru ----------------------------------------
    function arm() {
        S.armed = true;
        // v režimu „jen AR" není mapa vidět, tak přepneme na Split — jinak by
        // tlačítko z Nástrojů jen tiše nic neudělalo
        try {
            if (typeof viewMode !== 'undefined' && viewMode === 'ar') {
                viewMode = 'both';
                if (typeof applyViewMode === 'function') applyViewMode();
                if (typeof window.agSyncViewControls === 'function') window.agSyncViewControls();
            }
        } catch (e) {}
        var orto = false;
        try { orto = (typeof visSettings !== 'undefined' && visSettings && visSettings.baseLayer === 'ortofoto'); } catch (e) {}
        hint(true,
            '<svg class="icon"><use href="#i-map-pin"/></svg> Klepni do mapy tam, kde <b>doopravdy stojíš</b>.'
            + '<small>Čím víc přiblížíš, tím přesnější poloha — přesnost se počítá z měřítka mapy.</small>'
            + (orto ? '' : '<button type="button" data-act="orto">Zapnout ortofoto</button>')
            + '<button type="button" data-act="help" aria-label="Návod">Jak na to?</button>'
            + '<button type="button" data-act="cancel">Zrušit</button>');
        syncBtn();
    }
    function disarm() {
        S.armed = false;
        hint(false);
        syncBtn();
    }

    // ---- připnutí polohy (volá hák v grafika.js) --------------------------------
    function take(lat, lng, zoom) {
        if (lat == null || lng == null) return;
        disarm();
        var acc = accFromZoom(lat, (zoom != null && isFinite(zoom)) ? zoom : 19);
        var gpsAcc = null, moved = null;
        try { if (typeof currentGpsAccuracy === 'number' && isFinite(currentGpsAccuracy)) gpsAcc = currentGpsAccuracy; } catch (e) {}
        // surový fix si necháme jako záchytný bod pro poznání odchodu
        var raw = null;
        try { if (window.AGFix && !window.AGFix.manual && window.AGFix.lat != null) raw = { lat: window.AGFix.lat, lng: window.AGFix.lng }; } catch (e) {}
        if (!raw && !S.active) { try { if (typeof userLat === 'number' && userLat != null) raw = { lat: userLat, lng: userLng }; } catch (e) {} }
        if (!raw && S.gpsAtPin) raw = S.gpsAtPin;    // přepnutí polohy za běhu režimu
        try { if (raw) moved = getDistance(raw.lat, raw.lng, lat, lng); } catch (e) {}

        S.active = true; S.armed = false;
        S.lat = lat; S.lng = lng; S.acc = acc; S.ts = Date.now();
        S.gpsAtPin = raw; S.gpsAcc = gpsAcc; S.offHits = 0;
        try { document.body.classList.add('ag-manual-pos'); } catch (e) {}
        apply();
        status();
        if (_tick) clearInterval(_tick);
        _tick = setInterval(status, 30000);
        syncBtn();

        var msg = 'Poloha z mapy: ±' + num(acc, 1) + ' m.';
        if (moved != null) msg += ' Posun proti GPS ' + num(moved, 1) + ' m.';
        // POCTIVOST: když je odečet z mapy horší než to, co hlásí GPS, řekni to.
        // Podmínka gpsAcc >= 1: nesmyslně malé číslo (0 z emulátoru, „0,3 m" ze
        // síťové polohy) by hlásilo, že GPS je lepší, i když právě není.
        if (gpsAcc != null && gpsAcc >= 1 && acc > gpsAcc * 1.5) {
            msg += ' Pozor: GPS hlásila ±' + num(gpsAcc, 1) + ' m, tedy lépe — přibliž mapu a klepni znovu.';
        }
        toast(msg);
    }

    // ---- zrušení ---------------------------------------------------------------
    function clear(quiet) {
        if (!S.active) { disarm(); return; }
        S.active = false; S.armed = false;
        S.lat = S.lng = S.acc = null; S.gpsAtPin = null; S.offHits = 0;
        if (_tick) { clearInterval(_tick); _tick = null; }
        try { document.body.classList.remove('ag-manual-pos'); } catch (e) {}
        statusOff();
        hint(false);
        // vzorky průměrování zahodit i teď: mrak by mísil ruční polohu s GPS
        try { gpsSamples = []; gpsAvgResult = null; } catch (e) {}
        // kruh přesnosti si barvu i polohu srovná sám při nejbližším fixu
        syncBtn();
        if (!quiet) toast('Zpět na GPS.');
        else toast('Ruční poloha zrušena — appka jede zase z GPS.');
    }

    // ---- co hlásí logika.js při každém GPS fixu ---------------------------------
    // Pozor: může režim sám ukončit, proto se v logika.js po zavolání znovu ptá
    // na S.active.
    function onFix(rawLat, rawLng, rawAcc) {
        if (!S.active) return;
        if (rawLat == null || rawLng == null) return;
        if (!S.gpsAtPin) { S.gpsAtPin = { lat: rawLat, lng: rawLng }; return; }
        var d;
        try { d = getDistance(S.gpsAtPin.lat, S.gpsAtPin.lng, rawLat, rawLng); } catch (e) { return; }
        // hrubý (síťový) fix o ničem nesvědčí — takový klidně skočí o 100 m na místě
        if (rawAcc != null && rawAcc > 20) return;
        if (d > WALK_OFF_M) {
            if (++S.offHits >= WALK_OFF_HITS) {
                clear(true);
                toast('Odešel jsi o víc než ' + WALK_OFF_M + ' m — ruční poloha se zrušila.');
            }
        } else if (S.offHits) S.offHits = 0;
    }

    // ---- tlačítko v panelu Mapa a vrstvy ---------------------------------------
    function syncBtn() {
        var b = $('btn-manualpos');
        if (!b) return;
        b.classList.toggle('ctrl-active', !!(S.active || S.armed));
        var lab = S.active ? 'Zpět na GPS' : (S.armed ? 'Zrušit výběr' : 'Poloha z mapy');
        var s = b.querySelector('span');
        if (s) s.textContent = lab;
        b.setAttribute('aria-label', S.active ? 'Zpět na GPS' : 'Poloha z mapy');
    }
    function injectBtn() {
        var stack = $('map-ctrl-stack');
        if (!stack || $('btn-manualpos')) return;
        var b = document.createElement('button');
        b.type = 'button';
        b.id = 'btn-manualpos';
        b.className = 'map-ctrl-btn glass-panel';
        b.setAttribute('aria-label', 'Poloha z mapy');
        b.innerHTML = '<svg class="icon"><use href="#i-map-pin"/></svg>';
        b.addEventListener('click', function () { window.agPosFromMap(); });
        stack.appendChild(b);
        // panel si tlačítko „adoptuje" (dá mu popisek a vzhled dlaždice)
        try { if (window.AGMapTools && typeof AGMapTools.adopt === 'function') AGMapTools.adopt(); } catch (e) {}
        syncBtn();
    }

    // ---- veřejný vstup ---------------------------------------------------------
    // Jedno tlačítko pro všechny tři stavy: vypnuto → sbírej, sbírám → zruš sběr,
    // ruční poloha běží → zpět na GPS.
    window.agPosFromMap = function () {
        injectStyles();
        if (S.active) { clear(false); return; }
        if (S.armed) { disarm(); return; }
        arm();
    };

    window.AGManualPos = {
        get active() { return S.active; },
        get armed() { return S.armed; },
        get lat() { return S.lat; },
        get lng() { return S.lng; },
        get acc() { return S.acc; },
        get ts() { return S.ts; },
        onFix: onFix,
        take: take,
        clear: clear
    };

    function init() {
        injectStyles();
        injectBtn();
        // panel Mapa a vrstvy se staví po DOMContentLoaded, tlačítko se může
        // vejít až potom — druhý pokus (stejně to dělá dmr-terrain.js)
        setTimeout(injectBtn, 1200);
        setTimeout(injectBtn, 4000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
