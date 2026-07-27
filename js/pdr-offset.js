// ===== AR Geodet — KROKOVÝ OFFSET / PDR (A4, ODPOJITELNÁ vrstva) ===============
// Na 10–30 m je relativní vektor z kroků + kompasu přesnější než rozdíl dvou
// samostatných GPS měření (jejich chyby se nesčítají příznivě). Bod A změř
// pořádně (Brutální GPS / import), k bodu B dojdi pěšky: kroky počítá
// akcelerometr, směr dává kompas — B = A + Σ(krok × směr).
// Ideální pro rohy budov a místa bez výhledu na oblohu (doplněk „Offset bodu").
//
// Detekce kroku: špička svislého zrychlení nad prahem s refrakterní dobou
// (~0,35 s). Směr: globál currentHeading z grafika.js (fúze kompas+gyro,
// deklinace už započtená); když stojí (AR neběží), vlastní posluchač
// deviceorientation jako záloha. Kruhový průměr směru mezi kroky.
// Nejistota: ~2 % délky (krok) ⊕ sin(4°) (kompas) → zapíše se k bodu jako acc.
//
// Kalibrace délky kroku „na GPS úseku": ujdi rovně ≥25 m s dobrým fixem,
// appka vydělí GPS vzdálenost počtem kroků (uloženo v localStorage).
//
// Vstup: dlaždice „Krokový offset" v Nástrojích (kategorie Měření).
// Odstranění: smaž js/pdr-offset.js + řádky v index.html a sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGPdr) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21v-3a3 3 0 0 1 3-3h0a3 3 0 0 0 3-3V9"/><circle cx="13" cy="5" r="2"/><path d="M17 21l2-5-3-2"/></svg>';
    var DLG_ID = 'ag-pdr-modal';
    var LS_STEP = 'agPdrStepLen_v1';
    var STEP_DEF = 0.72;              // výchozí délka kroku (m)
    var STEP_MIN_MS = 350;            // refrakterní doba mezi kroky
    var STEP_THR = 1.15;              // m/s² nad klouzavý průměr = krok
    var HEAD_ERR_RAD = 4 * Math.PI / 180;   // předpoklad chyby kompasu
    var STEP_ERR = 0.02;              // relativní chyba délky kroku po kalibraci
    var CAL_MIN_DIST = 25;            // minimální GPS úsek pro kalibraci (m)
    var CAL_ACC_MAX = 12;             // max accuracy fixu pro kalibraci

    // ---- stav -----------------------------------------------------------------
    var _mode = 'setup';              // 'setup' | 'walk' | 'calib'
    var _startPt = null;              // bod A {id,name,lat,lng}
    var _steps = 0, _dE = 0, _dN = 0, _dist = 0;
    var _motionOn = false, _oriOn = false, _tick = null;
    var _accAvg = 9.81, _lastStepTs = 0;
    var _sinS = 0, _cosS = 0, _nHead = 0;         // vzorky směru od posledního kroku
    var _ownHead = null, _ownHeadTs = 0;          // vlastní posluchač orientace
    var _extHeadPrev = null, _extHeadChangedTs = 0; // „žije" globální currentHeading?
    var _gpsWatch = null, _gpsFirst = null, _gpsLast = null;   // kalibrace
    var _wakeLock = null;

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }
    function mPerDeg(lat) {
        if (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) return GeoCore.metersPerDeg(lat);
        return { lat: 111320, lng: 111320 * Math.cos(lat * Math.PI / 180) };
    }
    function planarDist(aLat, aLng, bLat, bLng) {
        var m = mPerDeg((aLat + bLat) / 2);
        return Math.hypot((aLng - bLng) * m.lng, (aLat - bLat) * m.lat);
    }
    function points() { try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; } catch (e) { return []; } }
    function stepLen() { try { var v = parseFloat(localStorage.getItem(LS_STEP)); if (isFinite(v) && v >= 0.4 && v <= 1.2) return v; } catch (e) {} return STEP_DEF; }
    function setStepLen(v) { try { localStorage.setItem(LS_STEP, String(Math.round(v * 1000) / 1000)); } catch (e) {} }
    function decl() { try { return (typeof magneticDeclination === 'number' && isFinite(magneticDeclination)) ? magneticDeclination : 0; } catch (e) { return 0; } }

    // ---- směr: globál currentHeading, záloha vlastní deviceorientation ----------
    function extHead() { try { return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; } catch (e) { return null; } }
    function heading() {
        var h = extHead(), now = Date.now();
        if (h != null) {
            if (_extHeadPrev == null || Math.abs(h - _extHeadPrev) > 0.01) { _extHeadPrev = h; _extHeadChangedTs = now; }
            // globál se mění → kompas v appce žije, ber jeho (fúze + deklinace + korekce)
            if (now - _extHeadChangedTs < 3000) return h;
        }
        // záloha: vlastní posluchač (surový kompas + deklinace)
        if (_ownHead != null && now - _ownHeadTs < 3000) return _ownHead;
        return h;   // radši zamrzlý globál než nic
    }
    var _absSeen = false;   // dorazila pouzitelna ABSOLUTNI udalost? (viz attach() ve startOri)
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
                // BATERIE: Chrome na Androidu doruci obe udalosti (~60x/s kazdou) — a onOri
                // pritom relativni 'deviceorientation' STEJNE zahazuje (chce absolute===true
                // nebo webkitCompassHeading), takze druhy posluchac tam byl cista rezie.
                // Navesime jen absolutni; relativni doregistrujeme az kdyz do 1,2 s neprijde
                // pouzitelna absolutni udalost — to je prave iOS, kde jede webkitCompassHeading.
                // Pojistka `_oriOn`: kdyz uzivatel panel mezitim zavre (stopOri), nenavesujeme.
                window.addEventListener('deviceorientationabsolute', onOri, true);
                _oriOn = true;
                setTimeout(function () {
                    if (_oriOn && !_absSeen) window.addEventListener('deviceorientation', onOri, true);
                }, 1200);
            };
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission().then(function (p) { if (p === 'granted') attach(); }).catch(function () {});
            } else if (typeof DeviceOrientationEvent !== 'undefined') attach();
        } catch (e) {}
    }
    function stopOri() {
        try { window.removeEventListener('deviceorientationabsolute', onOri, true); window.removeEventListener('deviceorientation', onOri, true); } catch (e) {}
        _oriOn = false;
    }

    // ---- kroky -----------------------------------------------------------------
    function onMotion(e) {
        var a = e.accelerationIncludingGravity; if (!a) return;
        var mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
        _accAvg = _accAvg * 0.95 + mag * 0.05;          // pomalý klouzavý průměr (gravitace)
        var now = Date.now();
        if (mag - _accAvg > STEP_THR && now - _lastStepTs > STEP_MIN_MS) {
            _lastStepTs = now;
            onStep();
        }
    }
    function onStep() {
        // směr kroku = kruhový průměr vzorků od minulého kroku (jinak okamžitá hodnota)
        var h;
        if (_nHead > 0) h = Math.atan2(_sinS / _nHead, _cosS / _nHead) * 180 / Math.PI;
        else { var hh = heading(); if (hh == null) return; h = hh; }
        _sinS = 0; _cosS = 0; _nHead = 0;
        var L = stepLen(), rad = h * Math.PI / 180;
        _steps++;
        _dist += L;
        _dE += L * Math.sin(rad);
        _dN += L * Math.cos(rad);
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
                DeviceMotionEvent.requestPermission().then(function (p) { if (p === 'granted') attach(); else agAlert('Senzory', 'Bez přístupu k pohybovým senzorům nejde počítat kroky.'); }).catch(function () {});
            } else if (typeof DeviceMotionEvent !== 'undefined') attach();
            else agAlert('Senzory', 'Telefon nehlásí pohybové senzory.');
        } catch (e) {}
    }
    function stopMotion() { try { window.removeEventListener('devicemotion', onMotion); } catch (e) {} _motionOn = false; }

    function uncertainty(d) { return Math.sqrt(Math.pow(STEP_ERR * d, 2) + Math.pow(Math.sin(HEAD_ERR_RAD) * d, 2)); }

    // ---- kalibrační GPS --------------------------------------------------------
    function onCalFix(pos) {
        var c = pos.coords;
        if (c.accuracy == null || c.accuracy > CAL_ACC_MAX) return;
        var s = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, t: Date.now() };
        if (!_gpsFirst) _gpsFirst = s;
        _gpsLast = s;
    }

    // ---- chůze start/stop ---------------------------------------------------------
    function startWalk(calib) {
        _mode = calib ? 'calib' : 'walk';
        _steps = 0; _dE = 0; _dN = 0; _dist = 0;
        _accAvg = 9.81; _lastStepTs = 0; _sinS = 0; _cosS = 0; _nHead = 0;
        _gpsFirst = null; _gpsLast = null;
        startMotion(); startOri();
        if (calib && navigator.geolocation) {
            try { _gpsWatch = navigator.geolocation.watchPosition(onCalFix, function () {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 27000 }); } catch (e) {}
        }
        try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { _wakeLock = w; }).catch(function () {}); } catch (e) {}
        if (!_tick) _tick = setInterval(function () { sampleHead(); renderLive(); }, 250);
        renderModal();
    }
    function stopWalk() {
        stopMotion(); stopOri();
        if (_gpsWatch != null) { try { navigator.geolocation.clearWatch(_gpsWatch); } catch (e) {} _gpsWatch = null; }
        if (_tick) { clearInterval(_tick); _tick = null; }
        try { if (_wakeLock) { _wakeLock.release(); _wakeLock = null; } } catch (e) {}
    }

    // ---- UI ------------------------------------------------------------------------
    function ensureModal() {
        if (document.getElementById(DLG_ID)) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = DLG_ID;
        el.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent); margin-top:0; margin-bottom:5px;">' + ICON + ' Krokový offset (PDR)</h3>'
            + '<div class="modal-body" id="ag-pdr-body"></div>'
            + '<button class="btn btn-secondary" style="margin-top:15px;" id="ag-pdr-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        el.querySelector('#ag-pdr-close').addEventListener('click', function () { stopWalk(); _mode = 'setup'; el.style.display = 'none'; });
        el.addEventListener('mousedown', function (e) { if (e.target === el) { stopWalk(); _mode = 'setup'; el.style.display = 'none'; } });
    }
    function openModal() {
        ensureModal();
        document.getElementById(DLG_ID).style.display = 'flex';
        _mode = 'setup';
        renderModal();
    }

    function renderModal() {
        var body = document.getElementById('ag-pdr-body');
        if (!body) return;
        if (_mode === 'walk' || _mode === 'calib') { renderWalk(body); return; }
        // setup
        var pts = points().slice();
        try {
            if (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null) {
                pts.sort(function (a, b) { return planarDist(a.lat, a.lng, userLat, userLng) - planarDist(b.lat, b.lng, userLat, userLng); });
            }
        } catch (e) {}
        var opts = pts.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
        body.innerHTML =
            '<p style="font-size:12.5px; opacity:0.85; margin:0 0 10px;">Do ~30 m je vektor z kroků + kompasu přesnější než dvojí GPS. Stoupni si na <b>známý bod A</b>, spusť, dojdi na nový bod B a zastav — B se spočítá jako A + vektor.</p>'
            + (pts.length
                ? '<label style="font-size:12px; opacity:.8;">Startovní bod A (stojím na něm)</label>'
                  + '<select id="ag-pdr-pt" class="bgps-name" style="width:100%; margin:4px 0 10px;">' + opts + '</select>'
                : '<p style="font-size:13px; color:var(--warning,#fbbf24);">V zakázce nejsou body — nejdřív změř/naimportuj bod A.</p>')
            + '<label style="font-size:12px; opacity:.8;">Délka kroku (m)</label>'
            + '<input id="ag-pdr-len" class="bgps-name" type="number" step="0.01" min="0.4" max="1.2" value="' + stepLen().toFixed(2) + '" style="width:100%; margin:4px 0 10px;">'
            + (pts.length ? '<button class="btn" id="ag-pdr-go">▶ Start chůze od bodu A</button>' : '')
            + '<button class="btn btn-secondary" id="ag-pdr-cal" style="margin-top:8px;">📏 Kalibrace kroku (GPS úsek ≥ ' + CAL_MIN_DIST + ' m)</button>'
            + '<p style="font-size:11px; opacity:.55; margin:10px 0 0;">Drž telefon volně před sebou displejem nahoru a choď normálně. U budov kompas ruší kov — výsledek ber jako ±' + Math.round(Math.sin(HEAD_ERR_RAD) * 100 * 1.3) + ' cm na každých 10 m.</p>';
        var go = document.getElementById('ag-pdr-go');
        if (go) go.addEventListener('click', function () {
            var v = parseFloat(document.getElementById('ag-pdr-len').value);
            if (isFinite(v) && v >= 0.4 && v <= 1.2) setStepLen(v);
            var id = document.getElementById('ag-pdr-pt').value, pt = null, i;
            var ps = points();
            for (i = 0; i < ps.length; i++) if (ps[i].id === id) { pt = ps[i]; break; }
            if (!pt) return;
            _startPt = { id: pt.id, name: pt.name, lat: pt.lat, lng: pt.lng };
            startWalk(false);
        });
        document.getElementById('ag-pdr-cal').addEventListener('click', function () {
            var v = parseFloat(document.getElementById('ag-pdr-len').value);
            if (isFinite(v) && v >= 0.4 && v <= 1.2) setStepLen(v);
            startWalk(true);
        });
    }

    function renderWalk(body) {
        var calib = _mode === 'calib';
        body.innerHTML =
            '<div class="bgps-card amber">' + (calib
                ? '<b>📏 Kalibrace:</b> jdi ROVNĚ aspoň ' + CAL_MIN_DIST + ' m pod volným nebem, pak zastav.'
                : '<b>🚶 Jdu od bodu ' + esc(_startPt.name) + '</b> — dojdi na nový bod a zastav.') + '</div>'
            + '<div class="bgps-stats" style="margin-top:10px;">'
            + '<div class="bgps-stat"><div class="k">Kroky</div><div class="v" id="ag-pdr-steps">0</div></div>'
            + '<div class="bgps-stat"><div class="k">Vzdálenost</div><div class="v" id="ag-pdr-dist">0,0 m</div></div>'
            + '<div class="bgps-stat"><div class="k">Směr</div><div class="v" id="ag-pdr-head">–</div></div>'
            + '</div>'
            + (calib ? '<div id="ag-pdr-gps" style="font-size:12px; opacity:.75; margin-top:8px;">GPS: čekám na přesný fix…</div>'
                     : '<div id="ag-pdr-vec" style="font-size:12px; opacity:.75; margin-top:8px;">vektor: –</div>')
            + '<button class="btn" id="ag-pdr-stop" style="margin-top:12px;">⏹ Zastavit' + (calib ? ' a spočítat krok' : '') + '</button>';
        document.getElementById('ag-pdr-stop').addEventListener('click', function () {
            stopWalk();
            if (calib) finishCalib(); else finishWalk();
        });
        renderLive();
    }
    function renderLive() {
        var s = document.getElementById('ag-pdr-steps'); if (s) s.textContent = String(_steps);
        var d = document.getElementById('ag-pdr-dist'); if (d) d.textContent = _dist.toFixed(1).replace('.', ',') + ' m';
        var h = document.getElementById('ag-pdr-head'); if (h) { var hh = heading(); h.textContent = hh == null ? '–' : Math.round(hh) + '°'; }
        var v = document.getElementById('ag-pdr-vec');
        if (v) v.textContent = 'vektor: ' + _dE.toFixed(1) + ' m V / ' + _dN.toFixed(1) + ' m S · nejistota ±' + uncertainty(Math.hypot(_dE, _dN)).toFixed(2) + ' m';
        var g = document.getElementById('ag-pdr-gps');
        if (g && _gpsFirst && _gpsLast) {
            var gd = planarDist(_gpsFirst.lat, _gpsFirst.lng, _gpsLast.lat, _gpsLast.lng);
            g.textContent = 'GPS úsek: ' + gd.toFixed(1) + ' m (přesnost ±' + Math.round(Math.max(_gpsFirst.acc, _gpsLast.acc)) + ' m)';
        }
    }

    function finishCalib() {
        _mode = 'setup';
        if (!_gpsFirst || !_gpsLast) { agAlert('Kalibrace', 'Nebyl dost přesný GPS fix (potřebuji ±' + CAL_ACC_MAX + ' m) — zkus to pod volnějším nebem.'); renderModal(); return; }
        var gd = planarDist(_gpsFirst.lat, _gpsFirst.lng, _gpsLast.lat, _gpsLast.lng);
        if (gd < CAL_MIN_DIST) { agAlert('Kalibrace', 'Úsek jen ' + gd.toFixed(1) + ' m — potřebuji aspoň ' + CAL_MIN_DIST + ' m rovné chůze.'); renderModal(); return; }
        if (_steps < 15) { agAlert('Kalibrace', 'Napočítal jsem jen ' + _steps + ' kroků — to na kalibraci nestačí.'); renderModal(); return; }
        var L = gd / _steps;
        if (L < 0.4 || L > 1.2) { agAlert('Kalibrace', 'Vyšla nereálná délka kroku (' + L.toFixed(2) + ' m) — kroky se asi nepočítaly správně, zkus znovu.'); renderModal(); return; }
        setStepLen(L);
        agAlert('Kalibrace hotová', 'Délka kroku: <b>' + L.toFixed(2) + ' m</b> (' + _steps + ' kroků na ' + gd.toFixed(1) + ' m dle GPS).');
        renderModal();
    }

    function finishWalk() {
        _mode = 'setup';
        var body = document.getElementById('ag-pdr-body');
        if (!body) return;
        if (_steps < 2) { agAlert('Krokový offset', 'Skoro žádné kroky — telefon možná nemá přístup k senzorům.'); renderModal(); return; }
        var m = mPerDeg(_startPt.lat);
        var lat = _startPt.lat + _dN / m.lat;
        var lng = _startPt.lng + _dE / m.lng;
        var u = uncertainty(Math.hypot(_dE, _dN));
        var sj = null;
        try { if (typeof proj4 === 'function') sj = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); } catch (e) {}
        body.innerHTML =
            '<p style="font-size:13px;"><b>Došel jsi:</b> ' + _steps + ' kroků, ' + _dist.toFixed(1) + ' m<br>'
            + 'vektor ' + _dE.toFixed(2) + ' m V / ' + _dN.toFixed(2) + ' m S od bodu ' + esc(_startPt.name) + '<br>'
            + (sj ? 'Y ' + Math.abs(sj[0]).toFixed(2) + '  X ' + Math.abs(sj[1]).toFixed(2) + '<br>' : '')
            + 'odhad nejistoty <b>±' + u.toFixed(2) + ' m</b></p>'
            + '<input class="bgps-name" id="ag-pdr-name" type="text" placeholder="Název nového bodu (např. ROH1)" style="width:100%; margin:6px 0;">'
            + '<button class="btn" id="ag-pdr-save">✓ Uložit bod B</button>'
            + '<button class="btn btn-secondary" id="ag-pdr-again" style="margin-top:8px;">Zahodit a znovu</button>';
        document.getElementById('ag-pdr-save').addEventListener('click', function () {
            if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Funkce pro vkládání bodů není dostupná.'); return; }
            var name = (document.getElementById('ag-pdr-name').value || '').trim() || ('PDR' + Date.now().toString().slice(-4));
            var added = window.addImportedPoints([{ name: name, lat: lat, lng: lng, origin: 'pdr', acc: Math.round(u * 100) / 100 }]);
            if (added > 0) {
                agAlert('Bod uložen', '#' + name + ' uložen (krokový offset od ' + esc(_startPt.name) + ', ±' + u.toFixed(2) + ' m).');
                var el = document.getElementById(DLG_ID); if (el) el.style.display = 'none';
            } else agAlert('Neuloženo', 'Bod se stejným názvem a polohou už v zakázce je.');
        });
        document.getElementById('ag-pdr-again').addEventListener('click', renderModal);
    }

    // ---- registrace ----------------------------------------------------------------------
    window.AGPdr = { open: openModal };
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'pdr-offset', label: 'Krokový offset', icon: ICON, cat: 'Měření', onClick: openModal, order: 8 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
