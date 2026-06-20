// ===== AR Geodet — FUZE SMERU (komplementarni filtr gyro + magnetometr) ==========
// NAHRADA za beta js/ar-stabilize.js. Na rozdil od stabilizace, ktera jen ladila
// silu vyhlazeni (visSettings.headingSmoothing), tato vrstva pocita SKUTECNY
// komplementarni filtr azimutu:
//
//   smoothedHeading = ARFusion.fuse(corrected, smoothedHeading, event)
//
// kde `corrected` je absolutni azimut k PRAVEMU severu (magnetometr/iOS compass,
// uz po deklinaci a korekcich) a `event` je aktualni DeviceOrientationEvent
// (kvuli sklonu beta/gamma). Modul si SAM registruje posluchac `devicemotion`
// a z `rotationRate` (uhlova rychlost telefonu, deg/s) integruje YAW kolem
// SVISLE osy sveta -> rychla, plynula slozka mezi pomalymi magnetometr-updaty.
//
// PRINCIP (komplementarni filtr):
//   predikce = prevHeading + yawDelta_z(gyro, dt)          // rychla slozka (gyro)
//   vystup   = predikce + w * angDiff(corrected, predikce) // pomala korekce driftu
// Vaha `w` je MALA (klid ~0.08, prudky pohyb ~0.02) — gyro nese kratkodobou
// dynamiku, magnetometr drzi dlouhodoby smer (zadne dlouhodobe ujeti). Kdyz gyro neni
// k dispozici (zadny devicemotion / rotationRate), fuse() spadne zpet na proste
// smoothAngle, takze hook funguje VZDY a chovani je jako pred zapojenim.
//
// Vse je v IIFE, idempotentni init (DOMContentLoaded i window load), obranne
// try/catch, zadne externi zavislosti. Default ZAPNUTO. Toggle v #side-menu,
// volba v localStorage.
//
// Odstraneni: smaz js/ar-fusion.js + css/ar-fusion.css, vrat hook v grafika.js na
// puvodni radek smoothAngle a smaz oba radky v index.html (+ z sw.js cache).
// ================================================================================
(function () {
    'use strict';

    var LS_KEY = 'agArFusion';   // '1' = zapnuto, '0' = vypnuto (default ZAPNUTO)

    var enabled = true;          // default zapnuto
    var listening = false;

    // ---- stav gyro integrace ----
    var yawRate = 0;             // posledni odhad yaw rate kolem svisle osy sveta (deg/s)
    var lastMotionT = 0;         // cas posledniho devicemotion vzorku (ms)
    var pendingYaw = 0;          // naintegrovany yaw od posledniho fuse() (deg)
    var haveGyro = false;        // dorazila aspon jedna pouzitelna rotationRate?
    var lastTilt = { beta: 90, gamma: 0 }; // posledni znamy sklon (z deviceorientation pres fuse)

    // ---- lokalni helper (nezavisly na globalu angDiff z logika.js) ----
    function adiff(a, b) { return ((a - b + 540) % 360) - 180; } // nejkratsi rozdil uhlu (-180..180)
    function norm360(a) { return ((a % 360) + 360) % 360; }

    // Fallback vyhlazeni — identicke s renderAR (smoothAngle + smoothAlpha v grafika.js),
    // aby chovani bez gyra presne odpovidalo puvodnimu radku.
    function fallbackSmooth(prev, next) {
        var alpha = 0.2;
        try {
            if (typeof visSettings !== 'undefined' && visSettings) {
                alpha = Math.max(0.05, 1 - (visSettings.headingSmoothing || 0) / 100);
            }
        } catch (e) {}
        if (prev == null) return norm360(next);
        return norm360(prev + alpha * adiff(next, prev));
    }

    // ---- gyro: devicemotion -> yaw rate kolem SVISLE osy SVETA -----------------
    // rotationRate.{alpha,beta,gamma} je uhlova rychlost telefonu (deg/s) kolem jeho
    // OS TELEFONU (z=kolmo na displej, x=napric, y=podel). Kdyz telefon stoji svisle
    // (beta~90, AR rezim), je svisla osa sveta zhruba telefonni osa Y. Kdyz lezi
    // (beta~0), je to telefonni osa Z. Obecne projektujeme vektor uhlove rychlosti
    // na svetovou svislici pres aktualni sklon (beta) — dostatecne presne pro yaw,
    // ktery nas pro azimut zajima. Gamma (roll) ma na yaw druhotny vliv, zahrnuto.
    function worldYawRate(rr) {
        var rx = rr.beta, ry = rr.alpha, rz = rr.gamma;
        // pozn.: spec mapuje rotationRate.alpha->z(displej), beta->x, gamma->y telefonu;
        // ruzne prohlizece se lisi, proto kombinujeme robustne pres sklon.
        if (rx == null) rx = 0; if (ry == null) ry = 0; if (rz == null) rz = 0;
        var bDeg = (lastTilt.beta != null) ? lastTilt.beta : 90;
        var gDeg = (lastTilt.gamma != null) ? lastTilt.gamma : 0;
        var b = bDeg * Math.PI / 180;
        var g = gDeg * Math.PI / 180;
        // Telefonni osa Z (kolma na displej) v souradnicich sveta ma svislou slozku
        // cos(beta); telefonni osa Y (podel) ma svislou slozku sin(beta). Roll (gamma)
        // primicha osu X (napric) pres sin(gamma). Slozeni je projekce vektoru
        // uhlove rychlosti (rx,ry,rz) na svetovou svislici:
        //   yaw_world = rz*cos(beta) + ry*sin(beta) - rx*sin(gamma)*cos(beta)
        var aRot = rr.alpha; // u vetsiny zarizeni je rotationRate.alpha kolem osy Z displeje
        if (aRot == null) aRot = 0;
        var yaw =
            aRot * Math.cos(b) +
            rx * Math.sin(b) -
            rz * Math.sin(g) * Math.cos(b);
        // Kompenzace orientace displeje (landscape) — znamenko yaw musi sedet s azimutem,
        // ktery v grafika.js roste po smeru hodinovych rucicek. rotationRate je proti.
        return -yaw;
    }

    function onMotion(ev) {
        if (!enabled) return;
        var rr = ev && ev.rotationRate;
        if (!rr || (rr.alpha == null && rr.beta == null && rr.gamma == null)) return;
        var now = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : (ev.timeStamp || Date.now());
        var yr = worldYawRate(rr);
        if (!isFinite(yr)) return;
        // lehke vyhlazeni rate (potlaci sum gyra), reaguje rychle nahoru
        var k = Math.abs(yr) > Math.abs(yawRate) ? 0.6 : 0.3;
        yawRate = yawRate + k * (yr - yawRate);
        if (lastMotionT) {
            var dt = (now - lastMotionT) / 1000;
            if (dt > 0 && dt < 0.5) {
                pendingYaw += yawRate * dt; // integruj na uhel (deg)
            }
        }
        lastMotionT = now;
        haveGyro = true;
    }

    // ---- jadro: komplementarni filtr ------------------------------------------
    // corrected   = absolutni azimut k pravemu severu (z magnetometru, uz korigovany)
    // prevHeading = predchozi vyhlazeny azimut (smoothedHeading z grafika.js)
    // event       = aktualni DeviceOrientationEvent (kvuli sklonu beta/gamma)
    function fuse(corrected, prevHeading, event) {
        try {
            // aktualizuj znamy sklon (pro projekci yaw rate na svetovou svislici)
            if (event) {
                if (event.beta != null && !isNaN(event.beta)) lastTilt.beta = event.beta;
                if (event.gamma != null && !isNaN(event.gamma)) lastTilt.gamma = event.gamma;
            }

            if (corrected == null || isNaN(corrected)) {
                return (prevHeading == null) ? prevHeading : norm360(prevHeading);
            }
            // bez gyra nebo vypnuto -> proste vyhlazeni (puvodni chovani)
            if (!enabled || !haveGyro) {
                return fallbackSmooth(prevHeading, corrected);
            }
            if (prevHeading == null) {
                pendingYaw = 0;
                return norm360(corrected);
            }

            // 1) PREDIKCE: posun predchozi smer o gyro-yaw naintegrovany od minula
            var predicted = norm360(prevHeading + pendingYaw);
            pendingYaw = 0; // spotrebovano

            // 2) KOREKCE DRIFTU smerem k absolutnimu magnetometru — JEMNE.
            //    Vaha podle aktualni rychlosti otaceni: v klidu duveruj magnetometru
            //    vic (rychlejsi srovnani driftu), pri prudkem pohybu min (nech gyro
            //    vest, magnetometr za pohybu sumi a zaostava).
            var speed = Math.abs(yawRate);          // deg/s
            var W_REST = 0.08;                       // klid: silnejsi tah k pravde
            var W_FAST = 0.02;                       // rychlo: hlavne gyro
            var REST = 6;                            // deg/s pod tim = klid
            var FAST = 90;                           // deg/s nad tim = rychle
            var t;
            if (speed <= REST) t = 0;
            else if (speed >= FAST) t = 1;
            else t = (speed - REST) / (FAST - REST);
            var w = W_REST + (W_FAST - W_REST) * t;

            // pojistka proti velkemu rozjeti predikce vs. magnetometr (napr. po
            // restartu senzoru) — kdyz je rozdil obrovsky, pritahni razneji
            var err = adiff(corrected, predicted);
            if (Math.abs(err) > 45) w = Math.max(w, 0.2);

            var out = predicted + w * err;
            return norm360(out);
        } catch (e) {
            // jakakoli chyba -> bezpecny fallback, hook nikdy nespadne
            try { return fallbackSmooth(prevHeading, corrected); } catch (e2) {
                return (prevHeading == null) ? corrected : prevHeading;
            }
        }
    }

    // ---- zapnuti / vypnuti -----------------------------------------------------
    function startListening() {
        if (listening) return;
        try {
            window.addEventListener('devicemotion', onMotion, true);
            listening = true;
        } catch (e) {}
    }
    function stopListening() {
        if (!listening) return;
        try { window.removeEventListener('devicemotion', onMotion, true); } catch (e) {}
        listening = false;
    }

    function enable() {
        if (enabled && listening) return;
        enabled = true;
        yawRate = 0; pendingYaw = 0; lastMotionT = 0;
        startListening();
    }
    function disable() {
        enabled = false;
        stopListening();
        yawRate = 0; pendingYaw = 0; lastMotionT = 0; haveGyro = false;
    }

    function readPref() {
        try {
            var v = localStorage.getItem(LS_KEY);
            if (v === null) return true; // default ZAPNUTO
            return v === '1';
        } catch (e) { return true; }
    }
    function writePref(on) {
        try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (e) {}
    }

    function setEnabled(on) {
        writePref(!!on);
        if (on) enable(); else disable();
        syncToggleUi();
    }

    // ---- UI: prepinac v bocnim menu (stejny vzor jako ar-stabilize.js) ---------
    function syncToggleUi() {
        var cb = document.getElementById('ag-arfusion-cb');
        if (cb) cb.checked = !!enabled;
    }
    function injectToggle() {
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('ag-arfusion-row')) return;

        var row = document.createElement('label');
        row.className = 'menu-toggle-row';
        row.id = 'ag-arfusion-row';

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'ag-arfusion-cb';
        cb.checked = !!enabled;
        cb.addEventListener('change', function () { setEnabled(cb.checked); });

        row.appendChild(cb);
        row.appendChild(document.createTextNode(' Plynulý směr (fúze gyro)'));

        var hint = document.createElement('div');
        hint.className = 'ag-arfusion-hint';
        hint.textContent = 'Spojí gyroskop a kompas: směr je svižný a plynulý při otáčení, ale dlouhodobě neujíždí. Doporučeno zapnuté.';

        menu.appendChild(row);
        menu.appendChild(hint);
        syncToggleUi();
    }

    // ---- public API ------------------------------------------------------------
    // window.ARFusion.enabled cteme primo v grafika.js hooku, proto je to gettr-vlastnost.
    var api = {
        fuse: fuse,
        setEnabled: setEnabled,
        get enabled() { return enabled; },
        set enabled(v) { setEnabled(!!v); }
    };
    try { window.ARFusion = api; } catch (e) {}

    // ---- init (idempotentni) ---------------------------------------------------
    function init() {
        try { injectToggle(); } catch (e) { console.warn('[ar-fusion] toggle', e); }
        try {
            var want = readPref();
            if (want) { if (!listening) enable(); }
            else { disable(); }
            syncToggleUi();
        } catch (e) { console.warn('[ar-fusion] init', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // Druhy pruchod — #side-menu i visSettings vznikaji pozdeji nez tento skript.
    window.addEventListener('load', function () { setTimeout(init, 350); });
})();
