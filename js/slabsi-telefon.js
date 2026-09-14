// ===== QTRIG — SLABŠÍ TELEFON (odpojitelná vrstva) ==============================
// PROČ: 14. 9. 2026 — „appka se seká" na levnějším Androidu. Nejdražší věci na
// slabém telefonu nejsou výpočty, ale VYKRESLOVÁNÍ: sklo (backdrop-filter) přes
// deset panelů nad živou kamerou, stovky značek s vlastním DOM uzlem, kamera
// v 720p, stínové animace a kompas, který překresluje 30× za sekundu.
//
// CO DĚLÁ: jeden přepínač „Slabší telefon" (Nastavení → AR & přesnost), který
//   • dá na <html> třídu .ag-lite — css/style.css podle ní vypne sklo, stíny,
//     rozostření i animace v CELÉ appce (ne jen nad kamerou jako js/power-save.js),
//   • řekne grafika.js, ať kompas kreslí nejvýš 20× za sekundu (místo 30),
//     kameru pustí v 640×480 @ 15–20 fps a v AR ukáže nejvýš 40 značek,
//   • mapa se otáčí až po změně směru o 0,8° (místo 0,15°) a značky se do ní
//     sypou po menších dávkách.
//   Nic z toho nemění měření ani data — jen kolik práce dostane displej.
//
// AUTOMATIKA: výchozí volba „automaticky" zapne režim, když telefon hlásí ≤ 3 GB
// paměti (navigator.deviceMemory, jen Chrome/Android) NEBO když se po startu AR
// naměří, že třetina snímků trvá přes 50 ms (= pod 20 fps). Změřená pomalost si
// pamatuje v localStorage, takže příště jede úsporně od začátku. Uživatel to
// může kdykoli přebít na „zapnuto" / „vypnuto".
//
// ⚠ iPhone deviceMemory neposílá a snímky měří stejně — na iPhonu se tedy režim
//   zapne jen měřením, nebo ručně.
//
// Načítá se PŘED js/logika.js (třída na <html> má být dřív, než se cokoli
// vykreslí; grafika.js čte jen `AGLite.lite`, takže pořadí vůči ní nevadí).
//
// Odstranění: smaž js/slabsi-telefon.js + řádek <script> v index.html (přegeneruj
// sw.js), blok „SLABŠÍ TELEFON" v css/style.css a čtyři `AGLite.lite` v grafika.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGLite) return;

    var LS = 'agSlabsiTelefon_v1';        // 'auto' | 'on' | 'off'
    var LS_MERENO = 'agSlabsiTelefonMereno_v1'; // '1' = měřením zjištěná pomalost (drží do ručního přepnutí)
    var lite = false;

    function volba() { try { var v = localStorage.getItem(LS); return (v === 'on' || v === 'off') ? v : 'auto'; } catch (e) { return 'auto'; } }
    function mereno() { try { return localStorage.getItem(LS_MERENO) === '1'; } catch (e) { return false; } }
    function hardwareSlaby() {
        var mem = navigator.deviceMemory;
        return (typeof mem === 'number' && mem <= 3);
    }
    function duvod() {
        var v = volba();
        if (v === 'on') return 'ručně';
        if (v === 'off') return '';
        if (hardwareSlaby()) return 'málo paměti';
        if (mereno()) return 'změřená pomalost';
        return '';
    }

    // Kamera pro slabý telefon: méně pixelů, méně snímků. Obraz je v AR jen podklad.
    var CAM_VIDEO_LITE = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 } };

    function apply(tiche) {
        var novy = duvod() !== '';
        var zmena = (novy !== lite);
        lite = novy;
        try { document.documentElement.classList.toggle('ag-lite', lite); } catch (e) { /* bez DOM */ }
        window.AGLite.lite = lite;
        if (zmena && !tiche) {
            // kamera běží s parametry z doby spuštění — přepnout ji na nové
            // (cameraStarted / appStarted jsou globální `let` z grafika.js / logika.js — bez nich ReferenceError, proto try)
            try { if (cameraStarted && document.body.classList.contains('cam-live')) startCameraAndCompass(true); } catch (e) { /* kamera neběží */ }
            try { if (appStarted) drawAllMarkersOnMap(); } catch (e) { /* mapa ještě nestojí */ }
        }
        syncUI();
    }

    // ---------------------------------------------------------------------------
    // MĚŘENÍ SNÍMKŮ: 12 s po startu AR sbírá mezery mezi requestAnimationFrame.
    // Dlouhý snímek = hlavní vlákno nestíhalo (kreslení, kompas, mapa). Když je
    // dlouhých přes třetinu, telefon je slabý — bez ohledu na to, co o sobě tvrdí.
    // Měří se jen v automatice a jen jednou za spuštění; na pozadí se neměří.
    // ---------------------------------------------------------------------------
    var _mereni = null;
    function zacniMerit() {
        if (_mereni || volba() !== 'auto' || lite || mereno()) return;
        _mereni = { n: 0, dlouhe: 0, t: 0, od: performance.now() };
        var krok = function (t) {
            if (!_mereni) return;
            if (document.visibilityState === 'hidden') { _mereni.t = 0; requestAnimationFrame(krok); return; }
            if (_mereni.t) { var dt = t - _mereni.t; _mereni.n++; if (dt > 50) _mereni.dlouhe++; }
            _mereni.t = t;
            if (t - _mereni.od < 12000) { requestAnimationFrame(krok); return; }
            var m = _mereni; _mereni = null;
            if (m.n >= 120 && m.dlouhe / m.n > 0.33) {
                try { localStorage.setItem(LS_MERENO, '1'); } catch (e) { /* plné úložiště */ }
                apply(false);
                try { if (typeof quickToast === 'function') quickToast('Telefon nestíhá — appka přepnula na úsporné zobrazení (Nastavení → AR & přesnost → Slabší telefon).'); } catch (e) { /* bez toastu */ }
            }
        };
        requestAnimationFrame(krok);
    }
    // start AR = <body> dostane .app-started (logika.js); měřit se začne 3 s poté, až se
    // usadí start (stahování bodů, první kresba mapy), aby se neměřil rozjezd
    var _startSledovan = false;
    function sledujStart() {
        if (_startSledovan) return; _startSledovan = true;
        var mo = null;
        var zkus = function () {
            if (!document.body || !document.body.classList.contains('app-started')) return false;
            setTimeout(zacniMerit, 3000);
            if (mo) { mo.disconnect(); mo = null; }
            return true;
        };
        if (zkus()) return;
        try {
            mo = new MutationObserver(function () { zkus(); });
            mo.observe(document.body || document.documentElement, { attributes: true, attributeFilter: ['class'] });
        } catch (e) { setTimeout(zacniMerit, 20000); }
    }

    // ---------------------------------------------------------------------------
    // NASTAVENÍ → AR & přesnost: jedna karta s výběrem auto / zapnuto / vypnuto
    // ---------------------------------------------------------------------------
    function syncUI() {
        try {
            var sel = document.getElementById('agl-rezim'); if (sel) sel.value = volba();
            var st = document.getElementById('agl-stav');
            if (st) {
                // věta z oddělených uzlů — js/jazyky.js překládá jen celé texty uzlů
                var d = duvod();
                st.textContent = '';
                if (!lite) { st.appendChild(document.createTextNode('Teď: plné zobrazení.')); }
                else {
                    var a1 = document.createElement('span'); a1.textContent = 'Teď: úsporné zobrazení';
                    var a2 = document.createElement('span'); a2.textContent = d;
                    st.appendChild(a1); st.appendChild(document.createTextNode(' (')); st.appendChild(a2); st.appendChild(document.createTextNode(').'));
                }
            }
        } catch (e) { /* karta ještě není */ }
    }
    function injectSettings() {
        try {
            var host = document.getElementById('tab-ar');
            if (!host || document.getElementById('agl-card')) return;
            var card = document.createElement('div');
            card.id = 'agl-card';
            card.innerHTML =
                '<div class="set-h">Slabší telefon</div>'
                + '<div class="st-row"><span class="st-lab">Úsporné zobrazení<small>bez skla a animací, kamera 480p, nejvýš 40 značek v AR — appka je plynulejší, měření stejné</small></span>'
                + '<select id="agl-rezim" class="st-sel" style="width:auto; min-width:9em;">'
                + '<option value="auto">Automaticky</option><option value="on">Zapnuto</option><option value="off">Vypnuto</option>'
                + '</select></div>'
                + '<div class="agp-note" id="agl-stav"></div>';
            // před kartu Úspory baterie (js/power-save.js), když už tam je; jinak na konec
            var agp = document.getElementById('agp-card');
            if (agp) host.insertBefore(card, agp); else host.appendChild(card);
            var sel = card.querySelector('#agl-rezim');
            sel.addEventListener('change', function () {
                try { localStorage.setItem(LS, sel.value); if (sel.value !== 'auto') localStorage.removeItem(LS_MERENO); } catch (e) { /* plné úložiště */ }
                apply(false);
            });
            syncUI();
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'slabsi-telefon:injectSettings'); }
    }

    window.AGLite = {
        lite: false,
        on: function () { return lite; },
        camVideo: CAM_VIDEO_LITE,
        volba: volba,
        nastav: function (v) { try { localStorage.setItem(LS, v); if (v !== 'auto') localStorage.removeItem(LS_MERENO); } catch (e) { /* plné úložiště */ } apply(false); },
        apply: apply
    };

    apply(true);   // třída na <html> co nejdřív — ještě před prvním vykreslením
    function init() { injectSettings(); sledujStart(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
