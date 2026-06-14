// ===== AR Geodet — STABILIZACE AR (gyro vrstva, beta) ============================
// Neinvazivni, ODPOJITELNA vrstva ve stylu js/vylepseni.js a js/kompas-check.js:
// NEEDITUJE logika.js ani grafika.js, jen za behu cte/pise dokumentovane globaly.
// Nacita se jako jeden z poslednich skriptu.
//
// Odstraneni cele vrstvy: smaz js/ar-stabilize.js + css/ar-stabilize.css a oba radky
// s timto souborem v index.html (a v sw.js z cache). Aplikace pak funguje presne
// jako predtim.
//
// ----------------------------------------------------------------------------------
// PROC TAKHLE A NE JINAK (dulezite pro pochopeni rizika):
//   Skutecny smer pro AR pocita grafika.js ve funkci renderAR(event) z native
//   DeviceOrientationEvent (event.alpha / webkitCompassHeading + event.beta/gamma),
//   vyhlazuje ho pres smoothAngle() do lokalni promenne `smoothedHeading` a vysledek
//   ulozi do globalu `currentHeading`. Funkce handleOrientation, renderAR,
//   smoothedHeading i smoothAngle jsou UZAVRENE v closures grafika.js/logika.js a
//   NEJSOU na window -> z teto vrstvy je NELZE prepsat ani obalit. Plnohodnotny
//   "komplementarni filtr" primo v render pipeline tedy zvenku nainstalovat nejde,
//   aniz bychom editovali grafika.js (to zakazuje zadani).
//
//   Jediny BEZPECNY a aplikaci dokumentovany ovladaci prvek vyhlazovani je
//   visSettings.headingSmoothing (0..100), ktery renderAR cte KAZDY snimek:
//       smoothAlpha = max(0.05, 1 - headingSmoothing/100);
//       smoothedHeading = smoothAngle(smoothedHeading, corrected, smoothAlpha);
//   Tedy vyssi headingSmoothing = silnejsi vyhlazeni (mensi alpha = pomalejsi,
//   stabilnejsi, ale liknavejsi smer); nizsi = rychlejsi a roztresenejsi.
//
//   Tato vrstva proto bezi jako VLASTNI nezavisly posluchac deviceorientation
//   (presne jako kompas-check.js) a z gyro/magnetometru odhaduje uhlovou rychlost
//   otaceni telefonu. Z toho ADAPTIVNE rridi ZIVOU hodnotu visSettings.headingSmoothing:
//     - telefon stoji / mira se klidne -> zvys vyhlazeni (potlac plavani znacek),
//     - uzivatel se rychle otaci      -> sniz vyhlazeni (smer at staci a nezpozdi se).
//   Je to "komplementarni" princip aplikovany na jediny povoleny lever: rychla
//   slozka (gyro rate) urcuje responzivitu, pomala (ustaleni) tahne k silnemu
//   vyhlazeni. Vse jen v PAMETI; do uloziste NIC nezapisujeme, takze nastaveni
//   uzivatele zustava netknute a po vypnuti se ZIVA hodnota vrati na jeho baseline.
//
//   Kdyz je prepinac VYPNUTY (vychozi), modul neposloucha senzory a NESAHA na
//   visSettings -> chovani aplikace je 100% beze zmeny.
// ================================================================================
(function () {
    'use strict';

    var LS_KEY = 'agArStab';          // '1' = zapnuto, jinak vypnuto (default)
    var VIS_KEY = 'arVisSettings12';  // klic visSettings v setStoredData/getStoredData

    var enabled = false;
    var listening = false;
    var baseline = null;   // puvodni headingSmoothing uzivatele (vraci se pri vypnuti)
    var rafId = 0;

    // ---- stav adaptivniho filtru ----
    var lastAlpha = null;  // posledni absolutni azimut (deg) z eventu
    var lastT = 0;         // cas posledniho vzorku (ms)
    var rate = 0;          // vyhlazena uhlova rychlost otaceni (deg/s)
    var curSmooth = null;  // aktualne nastavene headingSmoothing (deg-less, 0..100)

    // Meze adaptace: klidna ruka -> hodne vyhlazeni, prudke otaceni -> malo.
    var SMOOTH_MIN = 35;   // pri rychlem otaceni (smer nesmi zaostavat)
    var SMOOTH_MAX = 88;   // pri klidu (max potlaceni plavani; ne 100, at nezamrzne)
    var RATE_LOW = 4;      // deg/s pod tim = "klid" -> SMOOTH_MAX
    var RATE_HIGH = 60;    // deg/s nad tim = "rychle" -> SMOOTH_MIN

    // ---- pomocne ----
    function adiff(a, b) { return ((a - b + 540) % 360) - 180; }

    function hasVis() {
        try { return (typeof visSettings !== 'undefined') && visSettings && typeof visSettings === 'object'; }
        catch (e) { return false; }
    }
    function curBaseFromVis() {
        try {
            var v = hasVis() ? visSettings.headingSmoothing : null;
            if (v == null || isNaN(v)) return null;
            v = Math.round(v); if (v < 0) v = 0; if (v > 100) v = 100;
            return v;
        } catch (e) { return null; }
    }

    // Zapis ZIVE hodnoty do visSettings (renderAR ji cte kazdy snimek). NIC neuklada.
    function applyLiveSmoothing(val) {
        if (!hasVis()) return;
        val = Math.round(val); if (val < 0) val = 0; if (val > 100) val = 100;
        if (curSmooth === val) return;
        try { visSettings.headingSmoothing = val; curSmooth = val; } catch (e) {}
    }

    // Heading ze surového eventu (stejny zdroj jako app i kompas-check.js).
    function headingOf(ev) {
        try {
            if (typeof ev.webkitCompassHeading === 'number' && !isNaN(ev.webkitCompassHeading)) return ev.webkitCompassHeading;
            if (ev.alpha != null) return ((360 - ev.alpha) % 360 + 360) % 360;
        } catch (e) {}
        return null;
    }

    function onOrient(ev) {
        if (!enabled) return;
        var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : (ev.timeStamp || Date.now());
        var h = headingOf(ev);
        if (h == null) { return; }

        if (lastAlpha != null && lastT) {
            var dt = (now - lastT) / 1000;
            if (dt > 0.002 && dt < 0.5) {
                var instRate = Math.abs(adiff(h, lastAlpha)) / dt; // deg/s
                if (isFinite(instRate)) {
                    // rychla slozka (gyro-rate): nizkoprurchozi vyhlazeni rychlosti,
                    // at jednotlive vzorky neskacou; reaguje rychleji nahoru nez dolu.
                    var k = instRate > rate ? 0.5 : 0.18;
                    rate = rate + k * (instRate - rate);
                }
            }
        }
        lastAlpha = h; lastT = now;
        // pomala slozka uz je v samotnem renderAR (smoothAngle nad magnetometrem);
        // my jen volime, JAK silne ma vyhlazovat — viz updateLoop.
    }

    // Plynuly prevod rate -> headingSmoothing (mimo event, at to nezavisi na frekvenci senzoru).
    function updateLoop() {
        rafId = 0;
        if (!enabled) return;
        // pokud uzivatel mezitim zmenil baseline v Nastaveni (a my zrovna nehybeme),
        // drz se v rozumnem okoli; jinak adaptuj podle rate.
        var r = rate;
        var t;
        if (r <= RATE_LOW) t = 0;
        else if (r >= RATE_HIGH) t = 1;
        else t = (r - RATE_LOW) / (RATE_HIGH - RATE_LOW);
        // t=0 -> klid -> SMOOTH_MAX ; t=1 -> rychle -> SMOOTH_MIN
        var target = SMOOTH_MAX + (SMOOTH_MIN - SMOOTH_MAX) * t;

        // nikdy nevyhlazuj mene, nez si uzivatel sam pral (jeho baseline je spodni strop klidu)
        if (baseline != null && target < baseline && r <= RATE_LOW) target = baseline;

        // jemny prechod aktualni -> target (zadne skoky vyhlazeni mezi snimky)
        if (curSmooth == null) curSmooth = curBaseFromVis();
        var cur = (curSmooth == null) ? target : curSmooth;
        var next = cur + 0.25 * (target - cur);
        applyLiveSmoothing(next);

        // pomalu utlumuj rate, kdyz prestanou chodit eventy (telefon polozeny)
        rate = rate * 0.96;

        rafId = requestAnimationFrame(updateLoop);
    }

    // ---- zapnuti / vypnuti ----
    function startListening() {
        if (listening) return;
        try {
            window.addEventListener('deviceorientationabsolute', onOrient, true);
            window.addEventListener('deviceorientation', onOrient, true);
            listening = true;
        } catch (e) {}
    }
    function stopListening() {
        if (!listening) return;
        try {
            window.removeEventListener('deviceorientationabsolute', onOrient, true);
            window.removeEventListener('deviceorientation', onOrient, true);
        } catch (e) {}
        listening = false;
    }

    function enable() {
        if (enabled) return;
        // zapamatuj si baseline uzivatele PRED prvni zmenou (jen jednou za session zapnuti)
        baseline = curBaseFromVis();
        curSmooth = baseline;
        rate = 0; lastAlpha = null; lastT = 0;
        enabled = true;
        startListening();
        if (!rafId) rafId = requestAnimationFrame(updateLoop);
    }
    function disable() {
        if (!enabled) { return; }
        enabled = false;
        stopListening();
        if (rafId) { try { cancelAnimationFrame(rafId); } catch (e) {} rafId = 0; }
        // VRAT zivou hodnotu na baseline uzivatele -> chovani jako pred zapnutim.
        if (baseline != null) { try { applyLiveSmoothing(baseline); } catch (e) {} }
        curSmooth = null; baseline = null; rate = 0; lastAlpha = null; lastT = 0;
    }

    function readPref() {
        try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; }
    }
    function writePref(on) {
        try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (e) {}
    }

    function setEnabled(on) {
        writePref(on);
        if (on) enable(); else disable();
        syncToggleUi();
    }

    // ---- UI: prepinac v bocnim menu (stejny vzor jako injectGloveToggle ve vylepseni.js)
    function syncToggleUi() {
        var cb = document.getElementById('ag-arstab-cb');
        if (cb) cb.checked = !!enabled;
    }
    function injectToggle() {
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('ag-arstab-row')) return;
        var row = document.createElement('label');
        row.className = 'menu-toggle-row';
        row.id = 'ag-arstab-row';

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'ag-arstab-cb';
        cb.checked = !!enabled;
        cb.addEventListener('change', function () { setEnabled(cb.checked); });

        row.appendChild(cb);
        row.appendChild(document.createTextNode(' Stabilizace AR (beta)'));

        // mala napoveda pod prepinacem
        var hint = document.createElement('div');
        hint.className = 'ag-arstab-hint';
        hint.textContent = 'Tlumí plavání AR značek — silnější vyhlazení v klidu, rychlejší při otáčení. Směr může mírně „dohánět".';

        menu.appendChild(row);
        menu.appendChild(hint);
        syncToggleUi();
    }

    // ---- init ----
    function init() {
        try { injectToggle(); } catch (e) { console.warn('[ar-stabilize] toggle', e); }
        // aplikuj ulozenou volbu (default VYPNUTO)
        try {
            var want = readPref();
            if (want && !enabled) {
                // pokud jeste neni visSettings nactene, enable() to zvladne (baseline=null),
                // pri dalsim pruchodu init se baseline doplni.
                enable();
            } else if (want && enabled && baseline == null) {
                // doplnit baseline, kdyz visSettings dorazilo az ted
                baseline = curBaseFromVis();
                if (curSmooth == null) curSmooth = baseline;
            }
            syncToggleUi();
        } catch (e) { console.warn('[ar-stabilize] init', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // Druhy pruchod po plnem loadu — prvky/globaly (side-menu, visSettings) vznikaji pozdeji.
    window.addEventListener('load', function () { setTimeout(init, 350); });
})();
