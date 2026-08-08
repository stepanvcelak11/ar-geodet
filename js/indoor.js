// ===== AR Geodet — UVNITŘ BUDOVY: navigace bez GPS (ODPOJITELNÁ vrstva) ==========
// Jakmile se vejde do haly, garáží nebo tunelu, GPS končí — a s ní i všechno, na
// čem appka venku stojí. Tenhle nástroj drží polohu dál: od bodu, který znáš,
// počítá, kam ses posunul, a ukazuje vzdálenost a směr k bodům zakázky.
//
// JAK SE POLOHA DRŽÍ (dvě cesty, appka si vybere lepší):
//   1) VIZUÁLNÍ SLEDOVÁNÍ (WebXR) — Android Chrome umí pustit appku k systémovému
//      sledování polohy z kamery a čidel (VIO, totéž co pohání ARCore). To je
//      řádově přesnější než kroky a nezajímá ho magnetické rušení. iOS Safari
//      WebXR nemá, takže tam tahle cesta prostě není a appka to napíše.
//   2) KROKOVÝ VÝPOČET (PDR) — počítání kroků z akcelerometru a směr z kompasu.
//      Funguje všude, ale DRIFTUJE: chyba roste s ušlou dráhou (jednotky procent)
//      a uvnitř budov navíc kompas střílí u kovu, výtahů a rozvaděčů.
//      Detekce kroku i délka kroku jsou schválně STEJNÉ jako v js/pdr-offset.js
//      (sdílený klíč agPdrStepLen_v1) — zkalibruješ jednou, platí to pro obojí.
//
// PROČ JE TU „PŘESEDLÁNÍ" A PROČ JE TO TA NEJDŮLEŽITĚJŠÍ FUNKCE: každé počítání
// polohy bez vnějšího měření driftuje. Geodeticky správná odpověď není lepší
// filtr, ale VÁZAT SE NA ZNÁMÉ BODY. Když dojdeš k bodu, který je zaměřený,
// klepneš na „Jsem na bodě" — poloha se srovná na jeho souřadnice, nejistota
// spadne zpět na nulu a appka ti ukáže, jak velký drift do té chvíle nasbírala.
// Ta hodnota je zpětná vazba: říká, jak často se musíš vázat.
//
// CO TÍMHLE NEJDE DĚLAT (a je to napsané i v návodu): tohle NENÍ vytyčování.
// Ani při krátkém úseku nespadne nejistota pod decimetry a po padesáti metrech
// chůze jsou to metry. Na příčky, prostupy a otvory patří totálka nebo laser —
// tenhle nástroj tě k místu DOVEDE a ukáže, co je kolem, nic víc. Nejistota se
// proto pořád ukazuje jako číslo a jako kruh, ne jako jeden „přesný" bod.
//
// PŮDORYS: kreslí se z bodů zakázky a z ušlé stopy do vlastního plátna (mapa ani
// AR se nedotknou). Podklad si natáhneš tak, že si DXF půdorys naimportuješ
// nástrojem Import projektu a lomové body přeneseš do zakázky — IFC/BIM appka
// nečte a slibovat to nebude.
//
// NEEDITUJE logika.js ani grafika.js. Odstranění: smaž js/indoor.js + řádek
// <script> v index.html a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGIndoor) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V6.5L12 3l7 3.5V21"/><path d="M10 21v-5h4v5"/><circle cx="12" cy="10" r="1.4"/></svg>';
    var STYLE_ID = 'ag-in-style';
    var LS_STEP = 'agPdrStepLen_v1';  // SDÍLENO s js/pdr-offset.js — jedna kalibrace pro obojí
    var STEP_DEF = 0.72;              // výchozí délka kroku (m)
    var STEP_MIN_MS = 350;            // refrakterní doba mezi kroky
    var STEP_THR = 1.15;              // m/s² nad klouzavý průměr = krok
    var STEP_ERR = 0.03;              // relativní chyba délky kroku uvnitř (víc než venku: zatáčky, schody)
    var HEAD_ERR = 8 * Math.PI / 180; // uvnitř budovy je kompas horší než venku (kov, rozvody)
    var XR_ERR = 0.01;                // relativní drift vizuálního sledování (řádově 1 %)

    // ---- stav ----------------------------------------------------------------------
    var _mode = 'idle';               // 'idle' | 'walk'
    var _src = 'pdr';                 // 'pdr' | 'xr'
    var _anchor = null;               // {lat, lng, name, ts} — odkud se počítá
    var _dE = 0, _dN = 0, _dist = 0, _steps = 0;   // posun od kotvy (m, východ/sever)
    var _err = 0;                     // odhad nejistoty (m)
    var _track = [];                  // [{e,n}] pro půdorys (od kotvy)
    var _fixes = [];                  // historie přesedlání {ts, name, drift}
    var _target = null;               // bod, ke kterému navádíme

    var _motionOn = false, _oriOn = false, _tick = null;
    var _accAvg = 9.81, _lastStepTs = 0;
    var _sinS = 0, _cosS = 0, _nHead = 0;
    var _ownHead = null, _ownHeadTs = 0, _absSeen = false;
    var _extHeadPrev = null, _extHeadChangedTs = 0;
    var _wake = null;

    // WebXR
    var _xrSession = null, _xrRefSpace = null, _xrGl = null, _xrCanvas = null;
    var _xrOrigin = null;             // {x, z} první pozice v XR prostoru
    var _xrYaw = 0;                   // azimut, kterým byl telefon otočený při startu
    var _xrSupported = null;          // null = ještě nezjištěno

    // ---- pomocné --------------------------------------------------------------------
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} try { agInfo(m); } catch (e2) {} }
    function info(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert(t, m); } catch (e) {} toast(m); }
    function points() {
        try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; } catch (e) { return []; }
    }
    function mPerDeg(lat) {
        try { if (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) return GeoCore.metersPerDeg(lat); } catch (e) {}
        return { lat: 111320, lng: 111320 * Math.cos(lat * Math.PI / 180) };
    }
    function stepLen() { try { var v = parseFloat(localStorage.getItem(LS_STEP)); if (isFinite(v) && v >= 0.4 && v <= 1.2) return v; } catch (e) {} return STEP_DEF; }
    function toSJTSK(lat, lng) {
        try { if (window.GeoCore && GeoCore.toSJTSK) return GeoCore.toSJTSK(lat, lng); } catch (e) {}
        try { if (typeof proj4 === 'function') { var c = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); return { y: Math.abs(c[0]), x: Math.abs(c[1]) }; } } catch (e2) {}
        return null;
    }
    function fmtNum(v) { return v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    // aktuální odhad polohy = kotva + posun
    function here() {
        if (!_anchor) return null;
        var m = mPerDeg(_anchor.lat);
        return { lat: _anchor.lat + _dN / m.lat, lng: _anchor.lng + _dE / m.lng };
    }

    // ---- směr (stejná fúze jako pdr-offset.js) ----------------------------------------
    function decl() { try { return (typeof magneticDeclination === 'number' && isFinite(magneticDeclination)) ? magneticDeclination : 0; } catch (e) { return 0; } }
    function extHead() { try { return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; } catch (e) { return null; } }
    function heading() {
        var h = extHead(), now = Date.now();
        if (h != null) {
            if (_extHeadPrev == null || Math.abs(h - _extHeadPrev) > 0.01) { _extHeadPrev = h; _extHeadChangedTs = now; }
            if (now - _extHeadChangedTs < 3000) return h;   // globál se hýbe → kompas appky žije
        }
        if (_ownHead != null && now - _ownHeadTs < 3000) return _ownHead;
        return h;
    }
    function onOri(e) {
        var h = null;
        if (!_absSeen && e && e.absolute === true && e.alpha != null) _absSeen = true;
        if (typeof e.webkitCompassHeading === 'number' && isFinite(e.webkitCompassHeading)) h = e.webkitCompassHeading + decl();
        else if (e.absolute === true && e.alpha != null && isFinite(e.alpha)) h = 360 - e.alpha + decl();
        if (h == null) return;
        _ownHead = ((h % 360) + 360) % 360; _ownHeadTs = Date.now();
    }
    function startOri() {
        try {
            var attach = function () {
                window.addEventListener('deviceorientationabsolute', onOri, true);
                _oriOn = true;
                setTimeout(function () { if (_oriOn && !_absSeen) window.addEventListener('deviceorientation', onOri, true); }, 1200);
            };
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission().then(function (p) { if (p === 'granted') attach(); })['catch'](function () {});
            } else if (typeof DeviceOrientationEvent !== 'undefined') attach();
        } catch (e) {}
    }
    function stopOri() {
        try { window.removeEventListener('deviceorientationabsolute', onOri, true); window.removeEventListener('deviceorientation', onOri, true); } catch (e) {}
        _oriOn = false;
    }

    // ---- kroky (PDR) --------------------------------------------------------------------
    function onMotion(e) {
        var a = e.accelerationIncludingGravity; if (!a) return;
        var mag = Math.sqrt((a.x || 0) * (a.x || 0) + (a.y || 0) * (a.y || 0) + (a.z || 0) * (a.z || 0));
        _accAvg = _accAvg * 0.95 + mag * 0.05;
        var now = Date.now();
        if (mag - _accAvg > STEP_THR && now - _lastStepTs > STEP_MIN_MS) { _lastStepTs = now; onStep(); }
    }
    function onStep() {
        if (_src !== 'pdr') return;                 // vizuální sledování si polohu vede samo
        var h;
        if (_nHead > 0) h = Math.atan2(_sinS / _nHead, _cosS / _nHead) * 180 / Math.PI;
        else { var hh = heading(); if (hh == null) return; h = hh; }
        _sinS = 0; _cosS = 0; _nHead = 0;
        var L = stepLen(), rad = h * Math.PI / 180;
        _steps++; _dist += L;
        _dE += L * Math.sin(rad);
        _dN += L * Math.cos(rad);
        pushTrack();
        recalcErr();
    }
    function sampleHead() {
        var h = heading();
        if (h == null) return;
        var r = h * Math.PI / 180;
        _sinS += Math.sin(r); _cosS += Math.cos(r); _nHead++;
    }
    function startMotion() {
        try {
            var attach = function () { window.addEventListener('devicemotion', onMotion); _motionOn = true; };
            if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
                DeviceMotionEvent.requestPermission().then(function (p) {
                    if (p === 'granted') attach();
                    else info('Bez čidel to nejde', 'iOS nepustil appku k pohybovým čidlům — bez nich se kroky počítat nedají.');
                })['catch'](function () {});
            } else if (typeof DeviceMotionEvent !== 'undefined') attach();
            else info('Bez čidel to nejde', 'Telefon nehlásí pohybová čidla.');
        } catch (e) {}
    }
    function stopMotion() { try { window.removeEventListener('devicemotion', onMotion); } catch (e) {} _motionOn = false; }

    function pushTrack() {
        var last = _track[_track.length - 1];
        if (!last || Math.abs(last.e - _dE) + Math.abs(last.n - _dN) > 0.4) _track.push({ e: _dE, n: _dN });
        if (_track.length > 3000) _track.splice(0, 1000);
    }
    // Nejistota: podélná (délka kroku / drift sledování) ⊕ příčná (chyba směru).
    // Roste s ušlou DRÁHOU, ne se vzdušnou vzdáleností — chodba tam a zpátky
    // nevrátí nejistotu na nulu, i když jsi zpátky na začátku.
    function recalcErr() {
        var rel = (_src === 'xr') ? XR_ERR : STEP_ERR;
        var lon = rel * _dist;
        var lat = (_src === 'xr') ? (XR_ERR * _dist) : (Math.sin(HEAD_ERR) * _dist);
        _err = Math.sqrt(lon * lon + lat * lat);
    }

    // ---- WebXR (vizuální sledování) ------------------------------------------------------
    function xrCheck() {
        if (_xrSupported !== null) return Promise.resolve(_xrSupported);
        try {
            if (!navigator.xr || !navigator.xr.isSessionSupported) { _xrSupported = false; return Promise.resolve(false); }
            return navigator.xr.isSessionSupported('immersive-ar').then(function (ok) { _xrSupported = !!ok; return _xrSupported; })
            ['catch'](function () { _xrSupported = false; return false; });
        } catch (e) { _xrSupported = false; return Promise.resolve(false); }
    }
    // Sever: XR prostor má vlastní osy (obvykle -Z = kam se koukáš při startu). Kompas
    // se proto použije JEDNOU při startu na srovnání os — dál už rotaci řeší sledování
    // samo a magnetické rušení uvnitř budovy do polohy nemluví. Tohle je hlavní rozdíl
    // proti krokové metodě, kde do každého kroku vstupuje aktuální (rušený) kompas.
    function startXr() {
        return xrCheck().then(function (ok) {
            if (!ok) return false;
            var h = heading();
            if (h == null) { info('Chybí sever', 'Kompas zatím nic nehlásí — chvíli podrž telefon svisle a zkus to znovu. Bez severu by se posun kreslil do špatné strany.'); return false; }
            _xrYaw = h;
            try {
                _xrCanvas = document.createElement('canvas');
                _xrGl = _xrCanvas.getContext('webgl', { xrCompatible: true });
                if (!_xrGl) return false;
            } catch (e) { return false; }
            var overlay = document.getElementById('ag-in-modal');
            var opts = { requiredFeatures: ['local'] };
            if (overlay) { opts.optionalFeatures = ['dom-overlay']; opts.domOverlay = { root: overlay }; }
            return navigator.xr.requestSession('immersive-ar', opts).then(function (s) {
                _xrSession = s;
                s.addEventListener('end', function () { onXrEnd(); });
                return _xrGl.makeXRCompatible().then(function () {
                    s.updateRenderState({ baseLayer: new XRWebGLLayer(s, _xrGl) });
                    return s.requestReferenceSpace('local');
                }).then(function (ref) {
                    _xrRefSpace = ref;
                    _xrOrigin = null;
                    _src = 'xr';
                    s.requestAnimationFrame(onXrFrame);
                    return true;
                });
            })['catch'](function () { return false; });
        });
    }
    function onXrFrame(t, frame) {
        if (!_xrSession) return;
        try {
            var pose = frame.getViewerPose(_xrRefSpace);
            if (pose) {
                var p = pose.transform.position;
                if (!_xrOrigin) _xrOrigin = { x: p.x, z: p.z };
                // XR: x doprava, z dozadu (vůči startovnímu pohledu). Vodorovný posun
                // otočíme o azimut, kterým byl telefon při startu namířený.
                var fx = p.x - _xrOrigin.x;         // doprava od startu
                var fz = -(p.z - _xrOrigin.z);      // dopředu od startu
                var r = _xrYaw * Math.PI / 180;
                var e = fx * Math.cos(r) + fz * Math.sin(r);
                var n = -fx * Math.sin(r) + fz * Math.cos(r);
                var moved = Math.sqrt((e - _dE) * (e - _dE) + (n - _dN) * (n - _dN));
                if (moved > 0.05) { _dist += moved; _dE = e; _dN = n; pushTrack(); recalcErr(); }
            }
        } catch (e) {}
        try { _xrSession.requestAnimationFrame(onXrFrame); } catch (e2) {}
    }
    function stopXr() {
        var s = _xrSession; _xrSession = null;
        if (s) { try { s.end(); } catch (e) {} }
        onXrEnd();
    }
    function onXrEnd() {
        _xrSession = null; _xrRefSpace = null; _xrOrigin = null;
        if (_mode === 'walk' && _src === 'xr') {
            // Sledování spadlo (uživatel session ukončil, kamera zakrytá) — poloha se
            // nesmí zastavit potichu: přepneme na kroky a řekneme to.
            _src = 'pdr';
            startMotion();
            toast('Vizuální sledování skončilo — pokračuju krokovým výpočtem.');
            render();
        }
    }

    // ---- start / stop / přesedlání ---------------------------------------------------------
    function anchorFromPoint(p) {
        _anchor = { lat: p.lat, lng: p.lng, name: p.name || 'bod', ts: Date.now() };
        resetOffset();
    }
    function anchorFromGps() {
        try {
            if (typeof userLat === 'undefined' || userLat == null) { info('Není fix', 'GPS nemá polohu — vejdi dovnitř až potom, co se venku ustálí, nebo začni na známém bodě.'); return false; }
            var acc = (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy != null) ? currentGpsAccuracy : null;
            _anchor = { lat: userLat, lng: userLng, name: 'poslední GPS' + (acc != null ? ' (±' + Math.round(acc) + ' m)' : ''), ts: Date.now() };
            resetOffset();
            // Nejistota nezačíná na nule: dědí se přesnost fixu, ze kterého se vyšlo.
            _err = acc != null ? acc : 10;
            return true;
        } catch (e) { return false; }
    }
    function resetOffset() {
        _dE = 0; _dN = 0; _dist = 0; _steps = 0; _err = 0;
        _track = [{ e: 0, n: 0 }];
        _xrOrigin = null;
    }
    function start() {
        if (!_anchor) { info('Chybí začátek', 'Nejdřív vyber, odkud vycházíš — známý bod nebo poslední polohu z GPS.'); return; }
        _mode = 'walk';
        startOri();
        lockScreen();
        startXr().then(function (ok) {
            if (!ok) { _src = 'pdr'; startMotion(); }
            render();
        });
        if (_tick) clearInterval(_tick);
        _tick = setInterval(function () { sampleHead(); refresh(); }, 250);
        render();
    }
    function stop() {
        _mode = 'idle';
        if (_tick) { clearInterval(_tick); _tick = null; }
        stopMotion(); stopOri(); stopXr();
        unlockScreen();
        render();
    }
    // Přesedlání na známý bod: srovná polohu a ukáže, kolik driftu se nasbíralo.
    function reanchor(p) {
        var cur = here();
        var drift = null;
        if (cur) {
            var m = mPerDeg(p.lat);
            drift = Math.sqrt(Math.pow((cur.lng - p.lng) * m.lng, 2) + Math.pow((cur.lat - p.lat) * m.lat, 2));
        }
        _fixes.unshift({ ts: Date.now(), name: p.name || 'bod', drift: drift, dist: _dist });
        _fixes = _fixes.slice(0, 20);
        anchorFromPoint(p);
        if (_src === 'xr') _xrOrigin = null;         // vizuální sledování počítá od nové kotvy
        toast(drift != null
            ? ('Srovnáno na ' + (p.name || 'bod') + '. Drift byl ' + drift.toFixed(1) + ' m na ' + Math.round(_fixes[0].dist) + ' m chůze.')
            : ('Srovnáno na ' + (p.name || 'bod') + '.'));
        render();
    }
    function lockScreen() {
        try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { _wake = w; })['catch'](function () {}); } catch (e) {}
    }
    function unlockScreen() { try { if (_wake) { _wake.release(); _wake = null; } } catch (e) {} }

    // ---- půdorys ------------------------------------------------------------------------------
    // Vlastní plátno: body zakázky + ušlá stopa + kruh nejistoty. Hlavní mapy ani AR
    // se to netýká — uvnitř budovy by mapa stejně ukazovala střechu.
    function drawPlan() {
        var cv = document.getElementById('ag-in-plan');
        if (!cv || !_anchor) return;
        var w = cv.clientWidth || 300, h = 220;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
            cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
            cv.style.height = h + 'px';
        }
        var ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // co všechno se má vejít: stopa + body zakázky do 60 m od kotvy
        var m = mPerDeg(_anchor.lat);
        var pts = points().filter(function (p) {
            if (!p || p.lat == null) return false;
            var e = (p.lng - _anchor.lng) * m.lng, n = (p.lat - _anchor.lat) * m.lat;
            return Math.sqrt(e * e + n * n) < 60;
        }).map(function (p) {
            return { e: (p.lng - _anchor.lng) * m.lng, n: (p.lat - _anchor.lat) * m.lat, name: p.name, id: p.id };
        });
        var all = _track.concat(pts).concat([{ e: _dE, n: _dN }]);
        var minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
        all.forEach(function (q) {
            if (q.e < minE) minE = q.e; if (q.e > maxE) maxE = q.e;
            if (q.n < minN) minN = q.n; if (q.n > maxN) maxN = q.n;
        });
        var padM = Math.max(3, _err + 2);
        minE -= padM; maxE += padM; minN -= padM; maxN += padM;
        var sx = (w - 16) / Math.max(1, maxE - minE), sy = (h - 16) / Math.max(1, maxN - minN);
        var s = Math.min(sx, sy);
        function X(e) { return 8 + (e - minE) * s; }
        function Y(n) { return h - 8 - (n - minN) * s; }

        // měřítko
        ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
        var barM = (s > 12) ? 1 : (s > 4 ? 5 : 10);
        ctx.beginPath(); ctx.moveTo(10, h - 12); ctx.lineTo(10 + barM * s, h - 12); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '10px system-ui,sans-serif';
        ctx.fillText(barM + ' m', 10, h - 16);

        // stopa
        if (_track.length > 1) {
            ctx.strokeStyle = 'rgba(47,158,116,0.75)'; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(X(_track[0].e), Y(_track[0].n));
            for (var i = 1; i < _track.length; i++) ctx.lineTo(X(_track[i].e), Y(_track[i].n));
            ctx.stroke();
        }
        // body zakázky
        pts.forEach(function (p) {
            ctx.fillStyle = (_target && _target.id === p.id) ? '#fbbf24' : 'rgba(255,255,255,0.75)';
            ctx.beginPath(); ctx.arc(X(p.e), Y(p.n), 3.5, 0, 6.283); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillText(String(p.name || '').slice(0, 8), X(p.e) + 6, Y(p.n) + 3);
        });
        // kotva
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(X(0), Y(0), 5, 0, 6.283); ctx.stroke();
        // já + kruh nejistoty (nejistota patří na obrazovku, ne do poznámky pod čarou)
        if (_err > 0.05) {
            ctx.fillStyle = 'rgba(47,158,116,0.16)';
            ctx.beginPath(); ctx.arc(X(_dE), Y(_dN), Math.max(3, _err * s), 0, 6.283); ctx.fill();
        }
        ctx.fillStyle = '#2f9e74';
        ctx.beginPath(); ctx.arc(X(_dE), Y(_dN), 5, 0, 6.283); ctx.fill();
    }

    // ---- UI ------------------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-in-modal .modal-content{display:flex;flex-direction:column;}',
            '#ag-in-body{flex:1;overflow-y:auto;min-height:0;}',
            '.ag-in-h{font:700 11px/1 var(--font-display,system-ui);letter-spacing:.09em;text-transform:uppercase;',
            '  color:var(--text-muted,#9aa1ac);margin:14px 0 7px;}',
            '.ag-in-h:first-child{margin-top:0;}',
            '#ag-in-plan{width:100%;display:block;border-radius:12px;background:rgba(0,0,0,0.28);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));}',
            '.ag-in-big{display:flex;gap:10px;margin:10px 0;}',
            '.ag-in-cell{flex:1;padding:10px 12px;border-radius:12px;text-align:center;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '.ag-in-cell b{display:block;font:800 22px/1.15 var(--font-display,system-ui);color:var(--text-color,#e6e8eb);}',
            '.ag-in-cell small{display:block;margin-top:3px;font:600 10.5px/1.3 var(--font-ui,system-ui);',
            '  letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.ag-in-src{padding:9px 11px;border-radius:11px;margin-bottom:8px;font:600 12px/1.45 var(--font-ui,system-ui);}',
            '.ag-in-src.xr{border:1px solid var(--accent-line,rgba(47,158,116,0.42));background:var(--accent-soft,rgba(47,158,116,0.12));color:var(--accent,#2f9e74);}',
            '.ag-in-src.pdr{border:1px solid rgba(251,191,36,0.42);background:rgba(251,191,36,0.09);color:#fbbf24;}',
            '.ag-in-row{display:flex;gap:8px;margin-bottom:8px;}',
            '.ag-in-row button,.ag-in-row select{flex:1;min-width:0;padding:11px 10px;border-radius:12px;box-sizing:border-box;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:var(--glass-bg,rgba(255,255,255,0.05));',
            '  color:var(--text-color,#e6e8eb);font:600 13px/1.2 var(--font-ui,system-ui);}',
            '.ag-in-row button.prim{border-color:var(--accent-line,rgba(47,158,116,0.5));background:var(--accent-soft,rgba(47,158,116,0.16));color:var(--accent,#2f9e74);}',
            '.ag-in-row button.warn{border-color:rgba(220,68,68,0.45);color:#f87171;}',
            '.ag-in-nav{display:flex;align-items:center;gap:12px;padding:12px;border-radius:13px;margin-bottom:8px;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.4));background:var(--accent-soft,rgba(47,158,116,0.1));}',
            '.ag-in-arrow{flex:none;width:46px;height:46px;border-radius:99px;display:flex;align-items:center;justify-content:center;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.5));color:var(--accent,#2f9e74);font-size:22px;}',
            '.ag-in-navt{flex:1;min-width:0;font:500 12px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.ag-in-navt b{display:block;font:800 20px/1.2 var(--font-display,system-ui);color:var(--text-color,#e6e8eb);}',
            '.ag-in-fix{display:flex;gap:8px;padding:7px 10px;margin-bottom:5px;border-radius:10px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.09));font:500 11.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.ag-in-note{padding:9px 11px;border-radius:11px;margin-bottom:8px;font:500 12px/1.5 var(--font-ui,system-ui);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--glass-bg,rgba(255,255,255,0.04));color:var(--text-muted,#9aa1ac);}',
            '#ag-in-modal .ag-in-foot{display:flex;gap:8px;margin-top:12px;}',
            '#ag-in-modal .ag-in-foot .btn{flex:1;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function nearList(n) {
        var cur = here() || (_anchor ? { lat: _anchor.lat, lng: _anchor.lng } : null);
        if (!cur) return [];
        var m = mPerDeg(cur.lat);
        return points().filter(function (p) { return p && p.lat != null; }).map(function (p) {
            var e = (p.lng - cur.lng) * m.lng, nn = (p.lat - cur.lat) * m.lat;
            return { p: p, d: Math.sqrt(e * e + nn * nn), az: (Math.atan2(e, nn) * 180 / Math.PI + 360) % 360 };
        }).sort(function (a, b) { return a.d - b.d; }).slice(0, n || 8);
    }

    // Vykreslení má DVĚ úrovně a je to schválně:
    //   render()  — postaví okno (mění se jen při přepnutí režimu / kotvy)
    //   refresh() — 4x za sekundu přepíše JEN čísla, šipku a půdorys
    // Kdyby se překresloval celý obsah, vypadl by uživateli výběr v roletce
    // pokaždé, když se pohne — a vybrat cíl by prakticky nešlo.
    var _built = '';        // co je právě postavené: 'idle' | 'walk'
    var _selSig = '';       // otisk seznamu bodů v roletce

    function render() {
        var body = document.getElementById('ag-in-body');
        if (!body) return;
        _built = (_mode === 'walk') ? 'walk' : 'idle';
        _selSig = '';
        body.innerHTML = (_mode === 'walk') ? walkHtml() : idleHtml();
        if (_mode === 'walk') { fillTargetSel(); bindWalk(); refresh(); }
        else { fillStartSel(); bindIdle(); }
    }
    function idleHtml() {
        var h = '<div class="ag-in-h">Odkud vycházíš</div>'
            + '<div class="ag-in-note">Poloha se počítá <b>od známého místa</b>. Vyber bod, na kterém teď stojíš — '
            + 'nebo, jestli jsi ještě u vchodu s fixem, vezmi poslední GPS (nejistota si pak s sebou nese její přesnost).</div>'
            + '<div class="ag-in-row"><select id="ag-in-startsel"></select></div>'
            + '<div class="ag-in-row">'
            + '<button type="button" id="ag-in-usept" class="prim">Stojím na tomhle bodě</button>'
            + '<button type="button" id="ag-in-usegps">Vzít poslední GPS</button>'
            + '</div>';
        if (_anchor) {
            h += '<div class="ag-in-note">Začátek: <b>' + esc(_anchor.name) + '</b></div>'
                + '<div class="ag-in-row"><button type="button" id="ag-in-start" class="prim">Začít sledovat polohu</button></div>';
        }
        h += '<div class="ag-in-h">Čím se poloha drží</div>'
            + '<div class="ag-in-note">'
            + (_xrSupported === true
                ? '<b>Vizuální sledování je k dispozici</b> (WebXR) — appka ho zkusí zapnout jako první. Je řádově přesnější než kroky a nevadí mu magnetické rušení.'
                : (_xrSupported === false
                    ? '<b>Vizuální sledování tenhle telefon nenabízí</b> (na iPhonu WebXR není). Použije se krokový výpočet: kroky z akcelerometru, směr z kompasu — uvnitř budov s ním počítej jako s jednotkami procent ušlé dráhy.'
                    : 'Zjišťuji, jestli telefon umí vizuální sledování…'))
            + '</div>'
            + '<div class="ag-in-note">Délka kroku: <b>' + stepLen().toFixed(2) + ' m</b> — kalibruje se venku v nástroji '
            + '<b>Krokový offset</b> (sdílená hodnota). Nezkalibrovaný krok je největší zdroj chyby.</div>';
        if (_fixes.length) {
            h += '<div class="ag-in-h">Historie srovnání</div>';
            _fixes.forEach(function (f) {
                h += '<div class="ag-in-fix"><div style="flex:1;">' + esc(f.name) + '</div><div>'
                    + (f.drift != null ? 'drift ' + f.drift.toFixed(1) + ' m / ' + Math.round(f.dist) + ' m chůze' : 'srovnáno') + '</div></div>';
            });
        }
        return h;
    }
    function walkHtml() {
        return '<div class="ag-in-src pdr" id="ag-in-srcline"></div>'
            + '<canvas id="ag-in-plan"></canvas>'
            + '<div class="ag-in-big" id="ag-in-cells"></div>'
            + '<div id="ag-in-pos" class="ag-in-note"></div>'
            + '<div id="ag-in-navbox"></div>'
            + '<div class="ag-in-row">'
            + '<select id="ag-in-tgt"></select>'
            + '<button type="button" id="ag-in-here" class="prim">Jsem na bodě</button>'
            + '</div>'
            + '<div class="ag-in-row"><button type="button" id="ag-in-stop" class="warn">Ukončit sledování</button></div>'
            + '<div class="ag-in-note">Nejistota roste s <b>ušlou dráhou</b>. Až dojdeš k nějakému zaměřenému bodu, vyber ho vlevo '
            + 'a klepni <b>Jsem na bodě</b> — poloha se srovná a nejistota spadne zpět na nulu.</div>'
            + '<div id="ag-in-fixbox"></div>';
    }
    function refresh() {
        if (_built !== 'walk') return;
        var el = document.getElementById('ag-in-srcline');
        if (el) {
            el.className = 'ag-in-src ' + (_src === 'xr' ? 'xr' : 'pdr');
            el.textContent = (_src === 'xr')
                ? 'Vizuální sledování (WebXR) — polohu drží kamera a čidla telefonu.'
                : ('Krokový výpočet — ' + _steps + ' kroků po ' + stepLen().toFixed(2) + ' m, směr z kompasu. '
                    + 'Uvnitř budovy kompas ruší kov: sleduj, jestli šipka odpovídá realitě.');
        }
        var cells = document.getElementById('ag-in-cells');
        if (cells) {
            cells.innerHTML = '<div class="ag-in-cell"><b>' + _dist.toFixed(1) + ' m</b><small>ušlá dráha</small></div>'
                + '<div class="ag-in-cell"><b>±' + _err.toFixed(1) + ' m</b><small>nejistota</small></div>'
                + '<div class="ag-in-cell"><b>' + Math.round(Math.sqrt(_dE * _dE + _dN * _dN)) + ' m</b><small>od kotvy</small></div>';
        }
        var cur = here();
        var pos = document.getElementById('ag-in-pos');
        if (pos) {
            var sj = cur ? toSJTSK(cur.lat, cur.lng) : null;
            pos.innerHTML = sj
                ? ('Odhad polohy: Y ' + esc(fmtNum(sj.y)) + ' · X ' + esc(fmtNum(sj.x)) + ' <span style="opacity:.7">(dopočet, ne měření)</span>')
                : 'Odhad polohy se nedá převést do S-JTSK.';
        }
        var nav = document.getElementById('ag-in-navbox');
        if (nav) {
            if (_target && cur) {
                var m2 = mPerDeg(cur.lat);
                var e = (_target.lng - cur.lng) * m2.lng, n = (_target.lat - cur.lat) * m2.lat;
                var d = Math.sqrt(e * e + n * n);
                var az = (Math.atan2(e, n) * 180 / Math.PI + 360) % 360;
                var hd = heading();
                var rot = (hd != null) ? (az - hd) : null;
                nav.innerHTML = '<div class="ag-in-nav">'
                    + '<div class="ag-in-arrow"' + (rot != null ? ' style="transform:rotate(' + rot.toFixed(0) + 'deg);"' : '') + '>↑</div>'
                    + '<div class="ag-in-navt"><b>' + d.toFixed(1) + ' m</b>' + esc(_target.name || 'cíl')
                    + ' · azimut ' + Math.round(az) + '°'
                    + (d < _err ? ' · <span style="color:#fbbf24;">jsi uvnitř kruhu nejistoty — hledej okolo</span>' : '')
                    + '</div></div>';
            } else nav.innerHTML = '';
        }
        var fb = document.getElementById('ag-in-fixbox');
        if (fb) {
            var fh = '';
            if (_fixes.length) {
                fh = '<div class="ag-in-h">Srovnání</div>';
                _fixes.slice(0, 5).forEach(function (f) {
                    fh += '<div class="ag-in-fix"><div style="flex:1;">' + esc(f.name) + '</div><div>'
                        + (f.drift != null ? 'drift ' + f.drift.toFixed(1) + ' m / ' + Math.round(f.dist) + ' m' : 'srovnáno') + '</div></div>';
                });
            }
            if (fb.innerHTML !== fh) fb.innerHTML = fh;
        }
        fillTargetSel();
        drawPlan();
    }
    function fillStartSel() {
        var sel = document.getElementById('ag-in-startsel');
        if (!sel) return;
        var list = nearList(30);
        if (!list.length) list = points().slice(0, 30).map(function (p) { return { p: p, d: null }; });
        if (!list.length) { sel.innerHTML = '<option value="">V zakázce nejsou žádné body</option>'; return; }
        var h = '';
        list.forEach(function (r) {
            h += '<option value="' + esc(r.p.id) + '">' + esc(r.p.name || r.p.id) + (r.d != null ? ' · ' + Math.round(r.d) + ' m' : '') + '</option>';
        });
        sel.innerHTML = h;
    }
    function fillTargetSel() {
        var sel = document.getElementById('ag-in-tgt');
        if (!sel) return;
        var list = nearList(20);
        // Otisk seznamu: bez tohohle by se roletka přestavovala 4x za sekundu a
        // uživateli by při každém kroku vypadl vybraný cíl.
        var sig = list.map(function (r) { return r.p.id + ':' + Math.round(r.d); }).join(',');
        if (sig === _selSig) return;
        _selSig = sig;
        var h = '<option value="">— vyber bod —</option>';
        list.forEach(function (r) {
            h += '<option value="' + esc(r.p.id) + '"' + (_target && _target.id === r.p.id ? ' selected' : '') + '>'
                + esc(r.p.name || r.p.id) + ' · ' + Math.round(r.d) + ' m</option>';
        });
        sel.innerHTML = h;
    }
    function byId(id) {
        var list = points();
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }
    function bindIdle() {
        var u = document.getElementById('ag-in-usept');
        if (u) u.addEventListener('click', function () {
            var sel = document.getElementById('ag-in-startsel');
            var p = sel ? byId(sel.value) : null;
            if (!p) { toast('Vyber bod ze seznamu.'); return; }
            anchorFromPoint(p); render();
        });
        var g = document.getElementById('ag-in-usegps');
        if (g) g.addEventListener('click', function () { if (anchorFromGps()) render(); });
        var s = document.getElementById('ag-in-start');
        if (s) s.addEventListener('click', start);
    }
    function bindWalk() {
        var t = document.getElementById('ag-in-tgt');
        if (t) t.addEventListener('change', function () { _target = byId(this.value); refresh(); });
        var hh = document.getElementById('ag-in-here');
        if (hh) hh.addEventListener('click', function () {
            var sel = document.getElementById('ag-in-tgt');
            var p = sel ? byId(sel.value) : null;
            if (!p) { toast('Vlevo vyber bod, na kterém stojíš.'); return; }
            reanchor(p);
        });
        var st = document.getElementById('ag-in-stop');
        if (st) st.addEventListener('click', stop);
    }

    // ---- modal --------------------------------------------------------------------------------------
    function open() {
        injectStyles();
        var m = document.getElementById('ag-in-modal');
        if (!m) {
            m = document.createElement('div');
            m.className = 'modal-overlay';
            m.id = 'ag-in-modal';
            m.innerHTML =
                '<div class="modal-content">' +
                '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Uvnitř budovy</h3>' +
                '  <div id="ag-in-body"></div>' +
                '  <div class="ag-in-foot">' +
                '    <button type="button" class="btn btn-secondary" id="ag-in-close">Zavřít</button>' +
                '  </div>' +
                '</div>';
            document.body.appendChild(m);
            m.querySelector('#ag-in-close').addEventListener('click', function () { m.style.display = 'none'; });
            // Zavření křížkem/gestem nesmí nechat běžet čidla ani wake lock.
            try {
                new MutationObserver(function () {
                    if (m.style.display === 'none' && _mode === 'walk') stop();
                }).observe(m, { attributes: true, attributeFilter: ['style'] });
            } catch (e) {}
        }
        m.style.display = 'flex';
        xrCheck().then(function () { render(); });
        render();
    }

    try {
        window.addEventListener('pagehide', function () { if (_mode === 'walk') stop(); });
    } catch (e) {}

    // ---- dlaždice v Nástrojích --------------------------------------------------------------------------
    var _tries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'indoor', label: 'Uvnitř budovy', icon: ICON, cat: 'Měření', onClick: open, order: 12 });
            return;
        }
        if (_tries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.AGIndoor = { open: open, here: here };
    window.agOpenIndoor = open;
})();
