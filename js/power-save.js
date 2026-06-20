// ===== AR Geodet — ÚSPORA BATERIE A SPRÁVA SENZORŮ (odpojitelná vrstva) =========
// Neinvazivní vrstva ve stylu js/gps-warn.js / js/kompas-check.js. NEEDITUJE
// logiku přímo — místo toho centrálně "obalí" navigator.geolocation.watchPosition
// a window.addEventListener('deviceorientation'…), takže umí GPS i kompas
// kdykoli uspat a zase probudit, ať se to dělá kdekoli v kódu.
//
// MUSÍ se načítat PŘED js/logika.js a js/kompas-check.js / js/ar-stabilize.js,
// jinak nestihne zachytit jejich registrace senzorů.
//
// Co dělá:
//   1) ÚSPORA BATERIE — když uživatel zrovna nepoužívá AR/mapu (otevřená kalkulačka,
//      zprávy, předpisy, slovník, nastavení; aplikace na pozadí; režim „Pouze mapa")
//      uspí kameru, kompas a (volitelně) GPS. Probudí je hned, jakmile jsou potřeba.
//      GPS se uspává až po krátké prodlevě, aby krátké nahlédnutí neshodilo fix.
//   2) INDIKÁTOR STAVU GPS — malá kontrolka potvrzující, že GPS opravdu běží a chodí
//      fixy (zelená), že hledá (oranžová), nebo že je úmyslně uspaná kvůli šetření.
//   3) VYPNUTÍ VAROVÁNÍ NA RUŠENÍ KOMPASU — přepínač, který skryje červený banner
//      „Kompas pravděpodobně rušen" (z js/kompas-check.js) přes třídu na <body>.
//
// Nastavení (vlastní, mimo zakázky) je v localStorage pod klíčem 'agPowerCfg'.
//
// Odstranění: smaž js/power-save.js + css/power-save.css a jejich řádky v index.html
// a sw.js. Aplikace pak jede přesně jako předtím (senzory zůstanou trvale zapnuté).
// ================================================================================
(function () {
    'use strict';

    // ---- konfigurace (uživatelská, ukládá se zvlášť od zakázek) ----------------
    var LS = 'agPowerCfg';
    var DEFAULTS = { enabled: true, gpsInTools: true, indicator: true, compassWarn: true };
    var cfg = loadCfg();

    function loadCfg() {
        var c = {};
        try { var s = localStorage.getItem(LS); if (s) c = JSON.parse(s) || {}; } catch (e) {}
        var out = {};
        for (var k in DEFAULTS) out[k] = (typeof c[k] === 'boolean') ? c[k] : DEFAULTS[k];
        return out;
    }
    function saveCfg() { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) {} }

    // ---- prodlevy (ms) ---------------------------------------------------------
    var POLL_MS = 500;
    // Prodleva ~2,5 s u všech senzorů = ochrana proti omylenému tapnutí (krátké nahlédnutí
    // nic nevypne); po ~2,5 s v otevřeném panelu se uspí kamera/kompas/GPS kvůli baterii.
    var CAM_DELAY_TOOL = 2500, CAM_DELAY_HIDDEN = 0;
    var COMPASS_DELAY_TOOL = 2500, COMPASS_DELAY_HIDDEN = 0;
    var GPS_DELAY_TOOL = 2500, GPS_DELAY_HIDDEN = 4000;
    var FIX_FRESH_MS = 6000;                                // do kolika ms od fixu považujeme GPS za živou

    // =====================================================================
    // 1a) OBAL navigator.geolocation — sledování watchů + uspání/probuzení GPS
    // =====================================================================
    var gpsLastFix = 0;
    var _watches = [];        // {success, error, opts, id, active}
    var _gpsPaused = false;
    var _natWatch = null, _natClear = null;   // PŮVODNÍ (nativní) funkce — drží se zvlášť od patche

    function _startOne(w) {
        if (!_natWatch) return;
        try {
            w.id = _natWatch(function (pos) {
                gpsLastFix = Date.now();
                try { if (typeof w.success === 'function') w.success(pos); } catch (e) {}
            }, w.error, w.opts);
            w.active = true;
        } catch (e) {}
    }

    (function patchGeolocation() {
        try {
            var geo = navigator.geolocation;
            if (!geo || typeof geo.watchPosition !== 'function') return;
            _natWatch = geo.watchPosition.bind(geo);
            _natClear = geo.clearWatch ? geo.clearWatch.bind(geo) : function () {};

            geo.watchPosition = function (success, error, opts) {
                var w = { success: success, error: error, opts: opts, id: null, active: false };
                _watches.push(w);
                if (!_gpsPaused) _startOne(w);
                return w.id;
            };
            geo.clearWatch = function (id) {
                _watches = _watches.filter(function (w) { return w.id !== id; });
                try { return _natClear(id); } catch (e) {}
            };
        } catch (e) { /* fail-silent — appka jede dál bez správy GPS */ }
    })();

    function pauseGPS() {
        _gpsPaused = true;
        _watches.forEach(function (w) {
            // POZOR: nativní clear (ne patchovaný) — záznam musí ve _watches zůstat, ať ho umíme probudit
            if (w.active && w.id != null) { try { _natClear(w.id); } catch (e) {} w.active = false; }
        });
    }
    function resumeGPS() {
        _gpsPaused = false;
        _watches.forEach(function (w) { if (!w.active) _startOne(w); });
    }
    function gpsActiveCount() { var n = 0; _watches.forEach(function (w) { if (w.active) n++; }); return n; }

    // =====================================================================
    // 1b) OBAL deviceorientation listenerů — uspání/probuzení kompasu
    // =====================================================================
    var ORIENT = { deviceorientation: 1, deviceorientationabsolute: 1 };
    var _orient = [];          // {type, fn, opts}
    var _orientPaused = false;

    (function patchOrientation() {
        try {
            var _add = window.addEventListener.bind(window);
            var _rem = window.removeEventListener.bind(window);
            window.__agOrigAdd = _add; window.__agOrigRem = _rem;

            window.addEventListener = function (type, fn, opts) {
                if (ORIENT[type] && typeof fn === 'function') {
                    if (!_orient.some(function (l) { return l.type === type && l.fn === fn; })) {
                        _orient.push({ type: type, fn: fn, opts: opts });
                    }
                    if (_orientPaused) return;   // za uspání listener fyzicky nepřipojíme
                }
                return _add(type, fn, opts);
            };
            window.removeEventListener = function (type, fn, opts) {
                if (ORIENT[type]) {
                    _orient = _orient.filter(function (l) { return !(l.type === type && l.fn === fn); });
                }
                return _rem(type, fn, opts);
            };
        } catch (e) { /* fail-silent */ }
    })();

    function pauseOrientation() {
        _orientPaused = true;
        var rem = window.__agOrigRem;
        _orient.forEach(function (l) { try { rem(l.type, l.fn, l.opts); } catch (e) {} });
    }
    function resumeOrientation() {
        _orientPaused = false;
        var add = window.__agOrigAdd;
        _orient.forEach(function (l) { try { add(l.type, l.fn, l.opts); } catch (e) {} });
    }

    // =====================================================================
    // 1c) Kamera — uspání/probuzení (využívá funkce z grafika.js, když existují)
    // =====================================================================
    function cameraLive() {
        try {
            var v = document.getElementById('camera-feed');
            var s = v && v.srcObject;
            var t = s && s.getVideoTracks && s.getVideoTracks()[0];
            return !!(t && t.readyState === 'live');
        } catch (e) { return false; }
    }
    function pauseCamera() {
        try {
            if (typeof stopCameraStream === 'function') { stopCameraStream(); return; }
            // záloha, kdyby grafika.js neměla helper: zastavit stopu přímo
            var v = document.getElementById('camera-feed');
            if (v && v.srcObject && v.srcObject.getTracks) {
                v.srcObject.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
            }
        } catch (e) {}
    }
    function resumeCamera() {
        try {
            if (!isLive()) return;
            if (typeof viewMode !== 'undefined' && viewMode === 'map') return; // v mapě kamera nemá běžet
            if (cameraLive()) return;                                          // appka už ji nahodila sama
            if (typeof startCameraAndCompass === 'function') startCameraAndCompass(true);
        } catch (e) {}
    }

    // =====================================================================
    // Detekce kontextu
    // =====================================================================
    function isLive() { try { return (typeof appStarted !== 'undefined') && !!appStarted; } catch (e) { return false; } }

    // Panely přes/přes část obrazovky, u kterých chceme šetřit baterii (uspat senzory).
    // Vč. doku „Nástroje" a „Nový bod" + menu „Více" (na přání — viz sideMenuOpen).
    var HEAVY_IDS = ['calc-modal', 'settings-modal', 'about-modal', 'dict-modal', 'manage-modal', 'tools-modal', 'custom-modal-overlay'];
    function shownById(id) {
        var el = document.getElementById(id);
        return !!(el && el.style && el.style.display && el.style.display !== 'none');
    }
    function sideMenuOpen() {
        var el = document.getElementById('side-menu');
        return !!(el && el.classList && el.classList.contains('open'));
    }
    function heavyOpen() {
        try { if (document.querySelector('.zpr-overlay.open, .prd-overlay.open')) return true; } catch (e) {}
        if (sideMenuOpen()) return true;                  // „Více"
        for (var i = 0; i < HEAVY_IDS.length; i++) if (shownById(HEAVY_IDS[i])) return true;
        return false;
    }
    // Tachymetrie překryje kameru, ale může chtít živou polohu → vypneme jen kameru.
    function cameraOnlyToolOpen() { return shownById('tachy-modal'); }

    // =====================================================================
    // Stavový automat uspávání (s prodlevami)
    // =====================================================================
    var st = {
        cam: { resting: false, since: 0 },
        compass: { resting: false, since: 0 },
        gps: { resting: false, since: 0 }
    };
    function manage(s, should, delay, now, pauseFn, resumeFn) {
        if (should) {
            if (s.resting) return;
            if (!s.since) s.since = now;
            if (now - s.since >= delay) { try { pauseFn(); } catch (e) {} s.resting = true; }
        } else {
            s.since = 0;
            if (s.resting) { try { resumeFn(); } catch (e) {} s.resting = false; }
        }
    }
    function wakeAll() {
        if (st.gps.resting) { try { resumeGPS(); } catch (e) {} st.gps.resting = false; }
        if (st.compass.resting) { try { resumeOrientation(); } catch (e) {} st.compass.resting = false; }
        if (st.cam.resting) { try { resumeCamera(); } catch (e) {} st.cam.resting = false; }
        st.gps.since = st.compass.since = st.cam.since = 0;
    }

    function tick() {
        try {
            if (!cfg.enabled) { wakeAll(); updateIndicator(); return; }
            if (!isLive()) { updateIndicator(); return; }   // do startu appky senzory neřešíme

            var now = Date.now();
            var hidden = (document.visibilityState !== 'visible');
            var heavy = heavyOpen();
            var camOnly = cameraOnlyToolOpen();
            var mapMode = (typeof viewMode !== 'undefined' && viewMode === 'map');

            manage(st.cam, hidden || heavy || camOnly || mapMode,
                hidden ? CAM_DELAY_HIDDEN : CAM_DELAY_TOOL, now, pauseCamera, resumeCamera);
            manage(st.compass, hidden || heavy,
                hidden ? COMPASS_DELAY_HIDDEN : COMPASS_DELAY_TOOL, now, pauseOrientation, resumeOrientation);
            manage(st.gps, hidden || (heavy && cfg.gpsInTools),
                hidden ? GPS_DELAY_HIDDEN : GPS_DELAY_TOOL, now, pauseGPS, resumeGPS);

            updateIndicator();
        } catch (e) { /* fail-silent */ }
    }

    // =====================================================================
    // 2) INDIKÁTOR STAVU GPS
    // =====================================================================
    var ind = null, indDot = null, indTxt = null;
    function buildIndicator() {
        if (ind || !document.body) return ind;
        ind = document.createElement('div');
        ind.id = 'ag-pwr';
        ind.setAttribute('role', 'status');
        ind.title = 'Stav GPS a úspory baterie';
        ind.innerHTML = '<span class="ag-pwr-dot"></span><span class="ag-pwr-txt">GPS</span>';
        document.body.appendChild(ind);
        indDot = ind.querySelector('.ag-pwr-dot');
        indTxt = ind.querySelector('.ag-pwr-txt');
        return ind;
    }
    function gpsAccuracyTxt() {
        try {
            if (typeof currentGpsAccuracy !== 'undefined' && isFinite(currentGpsAccuracy) && currentGpsAccuracy > 0) {
                return '±' + Math.round(currentGpsAccuracy) + ' m';
            }
        } catch (e) {}
        return '';
    }
    function updateIndicator() {
        try {
            if (!cfg.indicator || !isLive()) { if (ind) ind.classList.remove('show'); return; }
            if (!ind) buildIndicator();
            if (!ind) return;
            ind.classList.add('show');

            var saving = (st.cam.resting || st.compass.resting || st.gps.resting);
            ind.classList.toggle('saving', saving);

            var cls, label, tip;
            if (st.gps.resting) {
                cls = 'sleep'; label = 'GPS spí'; tip = 'GPS uspána kvůli úspoře baterie — probudí se po návratu do AR/mapy.';
            } else if (gpsActiveCount() > 0 && (Date.now() - gpsLastFix) < FIX_FRESH_MS) {
                var acc = gpsAccuracyTxt();
                cls = 'on'; label = 'GPS ' + (acc || '✓'); tip = 'GPS běží a přijímá polohu' + (acc ? ' (' + acc + ')' : '') + '.';
            } else if (gpsActiveCount() > 0) {
                cls = 'wait'; label = 'GPS hledá…'; tip = 'GPS běží, ale zatím nepřišel platný fix.';
            } else {
                cls = 'off'; label = 'GPS vyp.'; tip = 'GPS watch neběží.';
            }
            ind.classList.remove('on', 'wait', 'sleep', 'off');
            ind.classList.add(cls);
            if (indTxt) indTxt.textContent = label;
            ind.title = tip + (saving ? '  ·  šetřím baterii (uspáno: '
                + [st.cam.resting ? 'kamera' : '', st.compass.resting ? 'kompas' : '', st.gps.resting ? 'GPS' : '']
                    .filter(Boolean).join(', ') + ')' : '');
        } catch (e) {}
    }

    // =====================================================================
    // 3) VAROVÁNÍ NA RUŠENÍ KOMPASU (skrýt přes třídu na <body>)
    // =====================================================================
    function applyCompassWarn() {
        try { document.body.classList.toggle('ag-no-compass-warn', !cfg.compassWarn); } catch (e) {}
    }

    // =====================================================================
    // NASTAVENÍ — vložíme vlastní kartu do záložky „AR & přesnost"
    // =====================================================================
    function injectSettings() {
        try {
            var host = document.getElementById('tab-ar');
            if (!host || document.getElementById('agp-card')) return;
            var card = document.createElement('div');
            card.id = 'agp-card';
            card.className = 'agp-card';
            card.innerHTML =
                '<label style="margin-top:14px; color:var(--accent);">Úspora baterie a senzory</label>'
                + '<div class="filter-group">'
                + '  <label class="filter-row"><input type="checkbox" id="agp-enabled"> Šetřit baterii — uspat kameru/kompas/GPS mimo AR a mapu</label>'
                + '  <label class="filter-row"><input type="checkbox" id="agp-gps"> Uspat i GPS v nástrojích (kalkulačka, zprávy, předpisy, nastavení)</label>'
                + '  <label class="filter-row"><input type="checkbox" id="agp-ind"> Zobrazovat indikátor stavu GPS</label>'
                + '  <label class="filter-row" style="margin-bottom:0;"><input type="checkbox" id="agp-warn"> Upozornění na rušení kompasu</label>'
                + '</div>'
                + '<div class="agp-note">Kamera, kompas i GPS se vypnou, když zrovna používáš jiné nástroje nebo je appka na pozadí, a samy naběhnou po návratu. GPS se uspí až po chvíli, aby krátké nahlédnutí neshodilo zaměření.</div>';
            host.appendChild(card);

            var cEn = card.querySelector('#agp-enabled');
            var cGps = card.querySelector('#agp-gps');
            var cInd = card.querySelector('#agp-ind');
            var cWarn = card.querySelector('#agp-warn');
            cEn.checked = cfg.enabled; cGps.checked = cfg.gpsInTools; cInd.checked = cfg.indicator; cWarn.checked = cfg.compassWarn;

            function syncDisabled() { cGps.disabled = !cEn.checked; }
            syncDisabled();

            cEn.addEventListener('change', function () { cfg.enabled = cEn.checked; saveCfg(); syncDisabled(); tick(); });
            cGps.addEventListener('change', function () { cfg.gpsInTools = cGps.checked; saveCfg(); tick(); });
            cInd.addEventListener('change', function () { cfg.indicator = cInd.checked; saveCfg(); updateIndicator(); });
            cWarn.addEventListener('change', function () { cfg.compassWarn = cWarn.checked; saveCfg(); applyCompassWarn(); });
        } catch (e) {}
    }

    // =====================================================================
    // Init
    // =====================================================================
    var _timer = null, _visBound = false;
    function init() {
        try {
            applyCompassWarn();
            injectSettings();
            buildIndicator();
            if (!_timer) _timer = setInterval(tick, POLL_MS);
            // okamžitá reakce na přepnutí na pozadí / zpět (jen jednou)
            if (!_visBound) { document.addEventListener('visibilitychange', tick); _visBound = true; }
            tick();
        } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
