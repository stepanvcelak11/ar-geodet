// ===== AR Geodet — BRUTÁLNÍ GPS MÓD (ODPOJITELNÁ vrstva) =======================
// Samostatná METODA měření (ne náhrada běžného průměrování): celoobrazovkový
// režim bez AR/kamery, který z HOLÉHO MOBILU vymáčkne maximum přesnosti při
// statickém měření jednoho bodu. NEEDITUJE logika.js ani grafika.js — jen čte
// globály a ukládá přes oficiální window.addImportedPoints().
//
// Co dělá pro přesnost (vše jen ze senzorů telefonu, žádný externí GNSS):
//   • Čistá obrazovka — vypne kameru (stopCameraStream) + drží Wake Lock.
//   • Warming-up — prvních ~20 s po startu zahodí (TTFF, nestabilní hodiny čipu).
//   • Anti-Fused filtr — pozná Wi-Fi/Cell polohu (zaseklá accuracy, chybí alt) a zahodí.
//   • Kinematické čištění — zahodí vzorek se speed>0.2 m/s nebo skokem výšky.
//   • Ověření klidu přes akcelerometr (DeviceMotion) — při pohybu pozastaví sběr.
//   • Robustní odhad — medián + MAD ořez hrubých chyb, pak vážený průměr.
//   • Vážení podle DVOU nezávislých zdrojů: accuracy z OS × geometrie družic (PDOP).
//   • PDOP brána — epochy se špatnou geometrií družic zahodí (pokud je TLE engine).
//   • Konvergenční kruh — živě ukazuje klesající chybu, cíl ±0,5 m.
//   • Re-okupace v čase — bod změříš ve více sezeních; appka přes satelitní engine
//     poradí, KDY se vrátit (jiná geometrie → vyruší se multipath), a sezení spojí.
//   • Otočení o 90° ve čtvrtinách ZVOLENÉ doby (0/90/180/270°) — průměruje multipath
//     i excentricitu antény podle orientace telefonu (A5).
//   • Napojení na lokální kalibraci (window.agRefShift) — přičte korekční vektor.
//
// Vstup: dlaždice „Brutální GPS" v launcheru (js/field-tools.js).
// Odstranění: smaž js/brutal-gps.js + css/brutal-gps.css a jejich řádky v index.html (a sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>';

    // ---- konfigurace ----------------------------------------------------------
    var WARMUP_S    = 20;     // zahozeno po startu (TTFF)
    var TARGET_M    = 0.5;    // cílová směrodatná chyba (sterr) — „zelená"
    var GOOD_M      = 1.0;    // hranice „dobré" kvality
    var MIN_DUR_S   = 120;    // doporučené minimum doby měření před uložením
    var SPEED_MAX   = 0.2;    // m/s — nad to je vzorek šum (statika)
    var ALT_JUMP_M  = 3.0;    // skok výšky mezi vzorky → odraz signálu
    var PDOP_MAX    = 6.0;    // nad to je geometrie družic moc špatná
    var MOTION_ACC  = 0.35;   // m/s² lineárního zrychlení = telefon se hýbe
    var MOTION_HOLD = 1500;   // ms po posledním pohybu sběr stále pozastaven
    var REOCC_GAP_M = 5.0;    // sezení do této vzdálenosti patří k témuž bodu
    var DURATIONS   = [2, 5, 10, 20];   // nabídky plánované doby měření (min)
    var LS_SESS     = 'agBrutalSessions';

    // ---- stav -----------------------------------------------------------------
    var _open = false, _phase = 'idle';      // 'idle'|'warmup'|'collect'|'paused'|'done'
    var _watchId = null, _wakeLock = null, _ui = null, _tick = null;
    var _t0 = 0;                              // start měření (ms)
    var _samples = [];                        // {t,lat,lng,acc,alt,pdop,w}
    var _result = null;                       // {lat,lng,n,sigma,sterr}
    var _rej = { warmup: 0, fused: 0, motion: 0, speed: 0, alt: 0, pdop: 0 };
    var _prevAlt = null, _accHist = [];
    var _lastMotionTs = 0, _motionOn = false;
    var _pdopNow = null, _pdopAt = 0, _satN = 0;
    var _sessions = [];                       // [{lat,lng,n,sigma,sterr,dur,t}]
    var _prevView = null, _camWasLive = false;
    var _rotStep = 0, _rotateTs = 0, _targetS = 300;   // cílová doba měření (s); otočení o 90° ve čtvrtinách (A5)

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:agAlert'); } agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }

    // ---- geometrie ------------------------------------------------------------
    // poloměry křivosti elipsoidu (GeoCore); fallback na starou konstantu jen kdyby
    // geo-core.js chyběl (odpojitelnost modulů)
    function mPerDeg(lat) {
        if (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) return GeoCore.metersPerDeg(lat);
        return { lat: 111320, lng: 111320 * Math.cos(lat * Math.PI / 180) };
    }
    function planarDist(aLat, aLng, bLat, bLng) {
        var m = mPerDeg((aLat + bLat) / 2);
        return Math.hypot((aLng - bLng) * m.lng, (aLat - bLat) * m.lat);
    }
    function median(arr) {
        if (!arr.length) return 0;
        var a = arr.slice().sort(function (p, q) { return p - q; });
        var i = a.length >> 1; return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
    }

    // ---- satelitní geometrie (PDOP) — využije engine ze satelity.js -----------
    function refreshPdop() {
        try {
            if (typeof computeSatPositions !== 'function' || typeof computePDOP !== 'function') { _pdopNow = null; return; }
            if (typeof userLat === 'undefined' || userLat == null) { _pdopNow = null; return; }
            var obs = (typeof satObs !== 'undefined' && satObs && satObs.length) ? satObs : computeSatPositions(new Date());
            var mask = (typeof SAT_EL_MASK !== 'undefined' && isFinite(SAT_EL_MASK)) ? SAT_EL_MASK : 10;
            _satN = obs.filter(function (o) { return o.el >= mask; }).length;
            var p = computePDOP(obs);
            _pdopNow = (p != null && isFinite(p)) ? p : null;
        } catch (e) { _pdopNow = null; }
        _pdopAt = Date.now();
    }

    // ---- robustní odhad polohy z přijatých vzorků -----------------------------
    // medián → MAD ořez hrubých chyb (3 iterace) → vážený průměr (1/acc² × 1/pdop²).
    function recompute() {
        if (_samples.length < 1) { _result = null; return; }
        var lat0 = _samples[0].lat, lng0 = _samples[0].lng, m = mPerDeg(lat0);
        var pts = _samples.map(function (s) {
            return { s: s, x: (s.lng - lng0) * m.lng, y: (s.lat - lat0) * m.lat };
        });
        var cx = median(pts.map(function (p) { return p.x; }));
        var cy = median(pts.map(function (p) { return p.y; }));
        for (var it = 0; it < 3 && pts.length >= 5; it++) {
            var r = pts.map(function (p) { return Math.hypot(p.x - cx, p.y - cy); });
            var thr = Math.max(3 * 1.4826 * median(r), 1.0);
            var inl = pts.filter(function (p, i) { return r[i] <= thr; });
            if (inl.length < 3 || inl.length === pts.length) { if (inl.length >= 3) pts = inl; break; }
            pts = inl;
            cx = median(pts.map(function (p) { return p.x; }));
            cy = median(pts.map(function (p) { return p.y; }));
        }
        // VÁHA = 1/acc² (přesnost z OS) × 1/pdop² (geometrie družic) × USTÁLENÍ (doba měření).
        // Telefon položený na bod se pořád ještě „usazuje": prvních ~dvě minuty jsou
        // nejhorší vzorky (doznívá pohyb ruky, přijímač dolaďuje iono/multipath model,
        // konstelace se ještě nezměnila). Váha proto roste z SETTLE_MIN na 1 za
        // SETTLE_FULL sekund od začátku sběru — čím delší měření, tím větší podíl mají
        // ustálená data. Ořez outlierů výše jde napřed, takže tohle nezvýhodňuje šum.
        var SETTLE_MIN = 0.2, SETTLE_FULL = 120;
        var t0s = pts.reduce(function (mn, p) { return Math.min(mn, p.s.t || 0); }, Infinity);
        function settle(s) {
            var age = ((s.t || 0) - t0s) / 1000;
            if (!isFinite(age) || age <= 0) return SETTLE_MIN;
            return SETTLE_MIN + (1 - SETTLE_MIN) * Math.min(1, age / SETTLE_FULL);
        }
        var sw = 0, swx = 0, swy = 0;
        pts.forEach(function (p) {
            var wa = 1 / Math.pow(Math.max(p.s.acc || 5, 1), 2);
            var wp = p.s.pdop ? 1 / Math.pow(Math.max(p.s.pdop, 1), 2) : 1;
            var w = wa * wp * settle(p.s); sw += w; swx += w * p.x; swy += w * p.y;
        });
        var wx = swx / sw, wy = swy / sw;
        // sigma kolem hlaseneho stredu (vazeny prumer) s N-2 stupni volnosti
        var resX = pts.map(function (p) { return p.x - wx; });
        var resY = pts.map(function (p) { return p.y - wy; });
        var sigma = Math.sqrt(resX.reduce(function (a, v, i) { return a + v * v + resY[i] * resY[i]; }, 0) / Math.max(1, pts.length - 2));
        // efektivni N z autokorelace rezidui + delky mereni (tau ~30 s); drive N/4
        // hlasilo centimetry tam, kde je realna nejistota decimetry az metr
        var neff = (typeof GeoCore !== 'undefined' && GeoCore.effectiveN)
            ? GeoCore.effectiveN(resX, resY, pts.map(function (p) { return p.s.t || 0; }), 30)
            : Math.max(1, Math.min(pts.length, 1 + ((pts[pts.length - 1].s.t || 0) - (pts[0].s.t || 0)) / 30000));
        // FALEŠNÁ PŘESNOST: sterr je jen vnitřní rozptyl. Systematickou chybu mobilní GNSS
        // (multipath/troposféra) průměrování neodstraní → sterr zdola omezíme realnou mezí,
        // ať nehlásíme nereálné centimetry.
        //
        // PROČ SE PŘESNOST ZASEKNE (uživatel: „nedostane se pod 0,60 m"): mez se počítala
        // jako 0,30 × nejlepší hlášená accuracy. Android hlásí u dobrého fixu skoro vždy
        // rovných 2,0 m (níž prostě nejde), takže mez = 0,60 m — a tam se to zastavilo,
        // ať měření běželo 2 nebo 30 minut. Vnitřní rozptyl už byl dávno menší, ale mez ho
        // přebila, takže delší měření nebylo na čem poznat.
        //
        // TEĎ: mez se s délkou měření a s otočeními POVOLUJE, protože se systematika
        // opravdu částečně vyruší — mění se konstelace družic (multipath se dekoreluje) a
        // otočení o 90° v každé čtvrtině průměruje vyzařovací charakteristiku antény.
        // Koeficient jde z 0,30 (do 2 min) na 0,15 (od 15 min) a po všech třech otočeních
        // se ještě sníží o 15 %. Absolutní dno je 0,12 m — pod to nemá holý mobil nárok
        // a hlásit to by byla lež (na to je rover, DGPS základna nebo kalibrace na bod).
        var bestAcc = pts.reduce(function (mn, p) { return Math.min(mn, (p.s.acc || 99)); }, 99);
        var durS = Math.max(0, ((pts[pts.length - 1].s.t || 0) - (pts[0].s.t || 0)) / 1000);
        var kDur = 0.30 - 0.15 * Math.min(1, Math.max(0, (durS - 120) / (900 - 120)));
        var kRot = (_rotStep >= 3) ? 0.85 : 1;
        var sterrFloor = Math.max(kDur * kRot * bestAcc, 0.12);
        var sterr = Math.max(sigma / Math.sqrt(neff), sterrFloor);
        _result = { lat: lat0 + wy / m.lat, lng: lng0 + wx / m.lng, n: pts.length, sigma: sigma, sterr: sterr, floor: sterrFloor, atFloor: (sigma / Math.sqrt(neff)) < sterrFloor };
    }

    // ---- příjem jednoho fixu --------------------------------------------------
    function onFix(pos) {
        if (!_open) return;
        var c = pos.coords, now = Date.now();
        var acc = c.accuracy, alt = (c.altitude != null && isFinite(c.altitude)) ? c.altitude : null;
        var spd = (c.speed != null && isFinite(c.speed)) ? c.speed : null;

        // PDOP každých ~5 s
        if (now - _pdopAt > 5000) refreshPdop();

        // 1) warming-up
        if (_phase === 'warmup') {
            if ((now - _t0) / 1000 < WARMUP_S) { _rej.warmup++; return; }
            _phase = 'collect';
        }
        if (_phase !== 'collect' && _phase !== 'paused') return;

        // 2) anti-Fused: accuracy „zaseklá" na fixní hodnotě + chybí výška = Wi-Fi/Cell poloha
        _accHist.push(acc); if (_accHist.length > 6) _accHist.shift();
        var stuck = _accHist.length >= 5 && _accHist.every(function (a) { return a === _accHist[0]; });
        if ((stuck && alt == null) || (alt == null && spd == null && acc >= 14)) { _rej.fused++; return; }

        // 3) pohyb (akcelerometr): při pohybu pozastav sběr
        if (_motionOn && (now - _lastMotionTs) < MOTION_HOLD) { _rej.motion++; _phase = 'paused'; return; }
        if (_phase === 'paused') _phase = 'collect';

        // 4) rychlost (statika)
        if (spd != null && spd > SPEED_MAX) { _rej.speed++; return; }

        // 5) skok výšky = multipath
        if (alt != null && _prevAlt != null && Math.abs(alt - _prevAlt) > ALT_JUMP_M) { _rej.alt++; _prevAlt = alt; return; }
        if (alt != null) _prevAlt = alt;

        // 6) PDOP brána
        if (_pdopNow != null && _pdopNow > PDOP_MAX) { _rej.pdop++; return; }

        // přijato
        _samples.push({ t: now, lat: c.latitude, lng: c.longitude, acc: acc, alt: alt, pdop: _pdopNow });
        recompute();
    }
    function onFixErr(err) { if (_open && _phase === 'warmup') setStatus('Čekám na GPS signál… (' + (err && err.message || '') + ')', 'warn'); }

    // ---- akcelerometr ---------------------------------------------------------
    function onMotion(e) {
        var a = e.acceleration || e.accelerationIncludingGravity; if (!a) return;
        var lin = e.acceleration ? Math.hypot(a.x || 0, a.y || 0, a.z || 0)
                                 : Math.abs(Math.hypot(a.x || 0, a.y || 0, a.z || 0) - 9.81);
        if (lin > MOTION_ACC) _lastMotionTs = Date.now();
    }
    function startMotion() {
        try {
            var attach = function () { window.addEventListener('devicemotion', onMotion); _motionOn = true; };
            if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
                DeviceMotionEvent.requestPermission().then(function (p) { if (p === 'granted') attach(); }).catch(function () {});
            } else if (typeof DeviceMotionEvent !== 'undefined') { attach(); }
        } catch (e) { _motionOn = false; }
    }
    function stopMotion() { try { window.removeEventListener('devicemotion', onMotion); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:stopMotion'); } _motionOn = false; }

    // ---- Wake Lock + kamera ---------------------------------------------------
    function lockScreen() { try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { _wakeLock = w; }).catch(function () {}); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:lockScreen'); } }
    function unlockScreen() { try { if (_wakeLock) { _wakeLock.release(); _wakeLock = null; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:unlockScreen'); } }
    function onVis() { if (_open && document.visibilityState === 'visible' && !_wakeLock) lockScreen(); }

    function pauseCamera() {
        try {
            _camWasLive = !!(typeof currentVideoStream !== 'undefined' && currentVideoStream);
            _prevView = (typeof viewMode !== 'undefined') ? viewMode : null;
            if (typeof stopCameraStream === 'function') stopCameraStream();
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:pauseCamera'); }
    }
    function resumeCamera() {
        try {
            if (_camWasLive && (_prevView === 'ar' || _prevView === 'split') && typeof startCameraAndCompass === 'function'
                && typeof appStarted !== 'undefined' && appStarted) {
                startCameraAndCompass(true);
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:resumeCamera'); }
    }

    // ====== UI =================================================================
    function ringSvg() {
        // dvě kružnice: cílová (čárkovaná) a aktuální (plná, barevná dle kvality)
        return '<svg viewBox="0 0 248 248">'
            + '<circle cx="124" cy="124" r="118" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="2"/>'
            + '<circle id="bgps-ring-target" cx="124" cy="124" r="40" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2" stroke-dasharray="4 5"/>'
            + '<circle id="bgps-ring-cur" cx="124" cy="124" r="110" fill="rgba(47,158,116,0.08)" stroke="var(--accent,#2f9e74)" stroke-width="4"/>'
            + '</svg>';
    }
    function build() {
        if (_ui) return _ui;
        var el = document.createElement('div');
        el.id = 'ag-bgps-overlay';
        el.innerHTML =
            '<div class="bgps-top"><h2>' + ICON + ' Přesná GPS</h2><button class="bgps-x" type="button" aria-label="Zavřít" id="bgps-close">×</button></div>'
            + '<p class="bgps-sub">Statické vysoce přesné měření jen z mobilu. Polož telefon <b>na plocho, displejem nahoru</b>, mimo tělo a kov, na měřený bod — a nech ležet. Čím déle, tím líp.</p>'
            + '<div class="bgps-dur"><span class="bgps-dur-lbl">Plánovaná doba (ve čtvrtinách vyzve otočit o 90°)</span><div class="bgps-dur-chips" id="bgps-dur-chips"></div></div>'
            + '<div class="bgps-ring-wrap"><div class="bgps-ring">' + ringSvg()
            + '<div class="bgps-ring-center"><div class="bgps-val" id="bgps-val">–</div><div class="bgps-val-sub" id="bgps-val-sub">čeká na start</div></div></div></div>'
            + '<div class="bgps-status" id="bgps-status">Připraveno. Umísti telefon a stiskni Spustit.</div>'
            + '<div class="bgps-stats">'
            + '<div class="bgps-stat"><div class="k">Vzorků</div><div class="v" id="bgps-n">0</div></div>'
            + '<div class="bgps-stat"><div class="k">Čas</div><div class="v" id="bgps-time">0:00</div></div>'
            + '<div class="bgps-stat"><div class="k">Družice / PDOP</div><div class="v" id="bgps-sat">–</div></div>'
            + '</div>'
            + '<div class="bgps-rej" id="bgps-rej"></div>'
            + '<div class="bgps-card amber bgps-hidden" id="bgps-reocc"></div>'
            + '<input class="bgps-name" id="bgps-name" type="text" placeholder="Název bodu (např. BG1)">'
            + '<div class="bgps-btns">'
            + '<button class="bgps-btn primary" id="bgps-start"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg> Spustit měření</button>'
            + '<button class="bgps-btn stop bgps-hidden" id="bgps-stop"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Zastavit</button>'
            + '<button class="bgps-btn primary bgps-hidden" id="bgps-save"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg> Uložit bod</button>'
            + '<button class="bgps-btn ghost bgps-hidden" id="bgps-reocc-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg> Přidat jako další sezení (re-okupace)</button>'
            + '<button class="bgps-btn ghost bgps-hidden" id="bgps-when"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> Kdy se vrátit na re-okupaci?</button>'
            + '</div>';
        document.body.appendChild(el);

        var chipBox = el.querySelector('#bgps-dur-chips');
        DURATIONS.forEach(function (min) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'bgps-chip'; b.setAttribute('data-min', min); b.textContent = min + ' min';
            b.addEventListener('click', function () { if (_phase === 'idle' || _phase === 'done') setTarget(min * 60); });
            chipBox.appendChild(b);
        });

        el.querySelector('#bgps-close').addEventListener('click', close);
        el.querySelector('#bgps-start').addEventListener('click', start);
        el.querySelector('#bgps-stop').addEventListener('click', stop);
        el.querySelector('#bgps-save').addEventListener('click', save);
        el.querySelector('#bgps-reocc-add').addEventListener('click', addSession);
        el.querySelector('#bgps-when').addEventListener('click', whenToReturn);
        _ui = el;
        return el;
    }

    function $(id) { return _ui ? _ui.querySelector('#' + id) : null; }
    function show(id, on) { var e = $(id); if (e) e.classList.toggle('bgps-hidden', !on); }
    function setStatus(txt, kind) {
        var e = $('bgps-status'); if (!e) return;
        e.textContent = txt;
        e.className = 'bgps-status' + (kind ? ' ' + kind : '');
    }
    function setTarget(s) {
        _targetS = s;
        if (!_ui) return;
        var chips = _ui.querySelectorAll('.bgps-chip');
        for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('on', (+chips[i].getAttribute('data-min')) * 60 === s);
    }

    function fmtTime(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
    function ringRadius(v) { return Math.max(6, Math.min(112, Math.sqrt(Math.max(v, 0)) * 49)); }

    function render() {
        if (!_open) return;
        var elapsed = _t0 ? (Date.now() - _t0) / 1000 : 0;
        var tEl = $('bgps-time'); if (tEl) tEl.textContent = fmtTime(elapsed);
        var sEl = $('bgps-sat'); if (sEl) sEl.textContent = (_pdopNow != null) ? (_satN + ' / ' + _pdopNow.toFixed(1)) : (_satN ? _satN + ' / –' : '–');
        var nEl = $('bgps-n'); if (nEl) nEl.textContent = _samples.length;

        // konvergenční kruh + hodnota
        var tgt = $('bgps-ring-target'); if (tgt) tgt.setAttribute('r', ringRadius(TARGET_M).toFixed(1));
        var cur = $('bgps-ring-cur');
        var val = $('bgps-val'), sub = $('bgps-val-sub');
        if (_result && _samples.length >= 3) {
            var st = _result.sterr;
            var col = st <= TARGET_M ? 'var(--accent,#2f9e74)' : (st <= GOOD_M ? 'var(--warning,#fbbf24)' : 'var(--danger,#fb7185)');
            if (cur) { cur.setAttribute('r', ringRadius(st).toFixed(1)); cur.setAttribute('stroke', col); cur.setAttribute('fill', 'transparent'); }
            if (val) val.innerHTML = '±' + st.toFixed(2) + '<small> m</small>';
            // Když číslo drží dolní mez (ne vlastní rozptyl), řekni to — jinak to vypadá,
            // že se měření „zaseklo" a delší ležení už nemá cenu.
            if (sub) sub.textContent = _result.atFloor
                ? ('dolní mez ±' + _result.floor.toFixed(2) + ' m · rozptyl je už menší, delší měření a otočení mez povolí')
                : ('rozptyl σ ±' + _result.sigma.toFixed(2) + ' m');
            try { if (window.AGQc) window.AGQc.onBrutal(st); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:render'); }   // QC: kód kvality (odpojitelné)
        } else if (cur) { cur.setAttribute('r', '110'); }

        // A5: otočení o 90° ve čtvrtinách zvolené doby (0/90/180/270°) — 3 výzvy
        if (_phase === 'collect' && _rotStep < 3 && elapsed >= WARMUP_S + 5 && elapsed >= _targetS * (_rotStep + 1) / 4) {
            _rotStep++; _rotateTs = Date.now();
        }
        // průběžný stav během sběru
        if (_phase === 'warmup') {
            setStatus('Zahřívání čipu… ' + Math.max(0, Math.ceil(WARMUP_S - elapsed)) + ' s (data zatím zahazuji)', 'warn');
        } else if (_phase === 'paused') {
            setStatus('Pohyb! Sběr pozastaven — nech telefon v klidu ležet.', 'bad');
        } else if (_phase === 'collect') {
            if (_rotateTs && (Date.now() - _rotateTs) < 14000) {
                setStatus((['¼', '½', '¾'][_rotStep - 1] || '') + ' času — OTOČ telefon o 90° po směru hodin a nech dál ležet (vyruší multipath).', 'warn');
            } else if (_result && _samples.length >= 3) {
                var done = elapsed >= _targetS, goodQ = _result.sterr <= GOOD_M;
                if (done) setStatus('Naměřeno ' + fmtTime(elapsed) + ' — ' + (goodQ ? 'kvalita OK, můžeš uložit.' : 'slabší kvalita, zvaž delší měření.'), goodQ ? 'good' : 'warn');
                else setStatus('Sbírám… ' + fmtTime(elapsed) + ' z ' + fmtTime(_targetS) + ', nech telefon ležet.', null);
            } else setStatus('Sbírám první vzorky…', null);
        }

        // odmítnuté vzorky (diagnostika)
        var rEl = $('bgps-rej');
        if (rEl) {
            var parts = [];
            if (_rej.fused) parts.push(_rej.fused + '× Wi-Fi/Cell');
            if (_rej.motion) parts.push(_rej.motion + '× pohyb');
            if (_rej.speed) parts.push(_rej.speed + '× rychlost');
            if (_rej.alt) parts.push(_rej.alt + '× skok výšky');
            if (_rej.pdop) parts.push(_rej.pdop + '× špatná geometrie');
            rEl.textContent = parts.length ? ('Odfiltrováno: ' + parts.join(' · ')) : '';
        }
        renderSessions();
    }

    function renderSessions() {
        var box = $('bgps-reocc');
        if (!box) return;
        if (!_sessions.length) { box.classList.add('bgps-hidden'); return; }
        box.classList.remove('bgps-hidden');
        var comb = combineSessions();
        var li = _sessions.map(function (s, i) {
            return '<li><span>Sezení ' + (i + 1) + ' · ' + s.n + ' vz. · ' + fmtTime(s.dur) + '</span><span>±' + s.sterr.toFixed(2) + ' m</span></li>';
        }).join('');
        box.innerHTML = '<b>Re-okupace: ' + _sessions.length + ' sezení</b>'
            + (comb ? ' → spojený výsledek <b>±' + comb.sterr.toFixed(2) + ' m</b>' + (comb.spread != null ? ' (rozptyl sezení ' + comb.spread.toFixed(2) + ' m)' : '') : '')
            + '<ul class="bgps-sessions">' + li + '</ul>';
    }

    // ---- re-okupace: spoj sezení (inverzně-varianční vážený průměr) -----------
    function combineSessions() {
        if (!_sessions.length) return null;
        var ref = _sessions[_sessions.length - 1];
        var grp = _sessions.filter(function (s) { return planarDist(s.lat, s.lng, ref.lat, ref.lng) <= REOCC_GAP_M; });
        // epochs/sigma nesou POCET ODECTU a jejich rozptyl — na rozdil od `n`,
        // ktere tu znamena pocet SEZENI. Do protokolu kvality patri epochs.
        if (grp.length === 1) return { lat: grp[0].lat, lng: grp[0].lng, sterr: grp[0].sterr, n: 1, spread: 0, epochs: grp[0].n || null, sigma: (grp[0].sigma != null ? grp[0].sigma : null) };
        var lat0 = grp[0].lat, lng0 = grp[0].lng, m = mPerDeg(lat0);
        var sw = 0, sx = 0, sy = 0;
        grp.forEach(function (s) {
            var w = 1 / Math.pow(Math.max(s.sterr, 0.05), 2);
            sw += w; sx += w * (s.lng - lng0) * m.lng; sy += w * (s.lat - lat0) * m.lat;
        });
        var wx = sx / sw, wy = sy / sw;
        var lat = lat0 + wy / m.lat, lng = lng0 + wx / m.lng;
        var spread = 0; grp.forEach(function (s) { spread = Math.max(spread, planarDist(s.lat, s.lng, lat, lng)); });
        // 1/sqrt(sum w) plati jen pro NEZAVISLA sezeni; multipath tehoz dne je ale
        // korelovany -> sterr zdola omezime realnym rozptylem mezi sezenimi
        var sterr = Math.max(1 / Math.sqrt(sw), spread / Math.sqrt(grp.length));
        // slouceny rozptyl odectu pres vsechna sezeni (pooled sigma):
        //   sqrt( sum (n_i - 1) * sigma_i^2  /  sum (n_i - 1) )
        // Prosty prumer sigem by kratkemu sezeni dal stejnou vahu jako dlouhemu.
        var epochs = 0, sc = 0, sn = 0;
        grp.forEach(function (s2) {
            var ni = (s2.n != null && isFinite(s2.n)) ? s2.n : 0;
            epochs += ni;
            if (ni > 1 && s2.sigma != null && isFinite(s2.sigma)) { sc += (ni - 1) * s2.sigma * s2.sigma; sn += (ni - 1); }
        });
        return { lat: lat, lng: lng, sterr: sterr, n: grp.length, spread: spread,
                 epochs: (epochs || null), sigma: (sn > 0 ? Math.sqrt(sc / sn) : null) };
    }

    function loadSessions() { try { var r = localStorage.getItem(LS_SESS); _sessions = r ? (JSON.parse(r) || []) : []; } catch (e) { _sessions = []; } if (!Array.isArray(_sessions)) _sessions = []; }
    function persistSessions() { try { localStorage.setItem(LS_SESS, JSON.stringify(_sessions)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:persistSessions'); } }

    // ====== akce ===============================================================
    function start() {
        if (typeof navigator === 'undefined' || !navigator.geolocation) { agAlert('GPS', 'Geolokace není dostupná.'); return; }
        _samples = []; _result = null; _prevAlt = null; _accHist = [];
        _rej = { warmup: 0, fused: 0, motion: 0, speed: 0, alt: 0, pdop: 0 };
        _rotStep = 0; _rotateTs = 0; _t0 = Date.now(); _phase = 'warmup';
        lockScreen(); startMotion(); refreshPdop();
        try {
            _watchId = navigator.geolocation.watchPosition(onFix, onFixErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 27000 });
        } catch (e) { agAlert('GPS', 'Nepodařilo se spustit měření.'); return; }
        show('bgps-start', false); show('bgps-stop', true);
        show('bgps-save', false); show('bgps-reocc-add', false); show('bgps-when', false);
        setStatus('Zahřívání čipu…', 'warn');
    }

    function stopWatch() {
        if (_watchId != null) { try { navigator.geolocation.clearWatch(_watchId); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:stopWatch'); } _watchId = null; }
        stopMotion(); unlockScreen();
    }

    function stop() {
        stopWatch(); _phase = 'done';
        var ok = _result && _samples.length >= 3;
        show('bgps-stop', false); show('bgps-start', true);
        $('bgps-start').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg> Měřit znovu';
        show('bgps-save', ok); show('bgps-reocc-add', ok); show('bgps-when', true);
        if (!ok) { setStatus('Málo vzorků — zkus to znovu a nech telefon déle ležet.', 'bad'); return; }
        var dur = (Date.now() - _t0) / 1000;
        var kind = (_result.sterr <= GOOD_M && dur >= MIN_DUR_S) ? 'good' : 'warn';
        setStatus('Hotovo: ±' + _result.sterr.toFixed(2) + ' m z ' + _result.n + ' vzorků za ' + fmtTime(dur) + '.', kind);
        render();
    }

    // přidej aktuální výsledek jako sezení (re-okupace)
    function addSession() {
        if (!_result || _samples.length < 3) { agAlert('Re-okupace', 'Nejdřív dokonči alespoň jedno měření.'); return; }
        _sessions.push({ lat: _result.lat, lng: _result.lng, n: _result.n, sigma: _result.sigma, sterr: _result.sterr, dur: (Date.now() - _t0) / 1000, t: Date.now() });
        persistSessions();
        try { if (window.AGCampaign && AGCampaign.onSession) AGCampaign.onSession(_sessions.slice(), _ui); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:addSession'); }
        var comb = combineSessions();
        if (comb && comb.spread != null && comb.spread > 1.0)
            setStatus('Sezení uloženo, ale rozptyl mezi sezeními je ' + comb.spread.toFixed(2) + ' m — zvaž další.', 'warn');
        else setStatus('Sezení uloženo (celkem ' + _sessions.length + '). Spojený výsledek je přesnější.', 'good');
        renderSessions();
        show('bgps-when', true);
    }

    // ---- kdy se vrátit: nejlepší/nejodlišnější geometrie družic v dalších 3 h --
    function whenToReturn() {
        if (typeof computeSatPositions !== 'function' || typeof computePDOP !== 'function' || typeof userLat === 'undefined' || userLat == null) {
            agAlert('Kdy se vrátit', 'Pro výpočet potřebuju stažené dráhy družic (otevři jednou „Satelity") a GPS polohu.\n\nObecné pravidlo: vrať se za 30–60 min, ať se geometrie družic výrazně změní.'); return;
        }
        var mask = (typeof SAT_EL_MASK !== 'undefined' && isFinite(SAT_EL_MASK)) ? SAT_EL_MASK : 10;
        var now = Date.now(), best = null;
        for (var min = 20; min <= 180; min += 5) {           // až 3 h dopředu, od 20 min
            try {
                var obs = computeSatPositions(new Date(now + min * 60000));
                var n = obs.filter(function (o) { return o.el >= mask; }).length;
                var p = computePDOP(obs);
                if (p != null && isFinite(p) && (best === null || p < best.pdop)) best = { min: min, pdop: p, n: n };
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:whenToReturn'); }
        }
        if (!best) { agAlert('Kdy se vrátit', 'Nepodařilo se spočítat geometrii. Vrať se za 30–60 min.'); return; }
        var when = new Date(now + best.min * 60000);
        var hh = ('0' + when.getHours()).slice(-2), mm = ('0' + when.getMinutes()).slice(-2);
        agAlert('Kdy se vrátit na re-okupaci',
            'Nejlepší geometrie družic bude přibližně v <b>' + hh + ':' + mm + '</b> (za ' + best.min + ' min) — PDOP ' + best.pdop.toFixed(1) + ', ' + best.n + ' družic.\n\n'
            + 'Vrať se na ten samý bod a spusť další sezení. Jiná konstelace družic vyruší část multipathu a spojený výsledek bude přesnější.');
    }

    function save() {
        var src = combineSessions() || _result;
        if (!src) { agAlert('Uložit', 'Nemám žádný výsledek k uložení.'); return; }
        var lat = src.lat, lng = src.lng, calibTxt = '';
        // lokální kalibrace (P-DGPS) — přičti korekční vektor, pokud je zapnutá
        try {
            var sh = window.agRefShift;
            if (sh && sh.on && isFinite(sh.dlat) && isFinite(sh.dlng)) {
                lat += sh.dlat; lng += sh.dlng;
                var m = mPerDeg(lat); var mag = Math.hypot(sh.dlng * m.lng, sh.dlat * m.lat);
                calibTxt = '\nKalibrace aplikována: +' + (mag * 100).toFixed(0) + ' cm';
                // expirace: konstantní posun stárne (systematika GPS se mění) → varuj nad 20 min
                var ageMin = sh.t ? (Date.now() - sh.t) / 60000 : null;
                if (ageMin != null && ageMin > 20) calibTxt += ' ⚠ kalibrace stará ' + Math.round(ageMin) + ' min (přesnost klesá)';
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:save'); }
        var name = ($('bgps-name').value || '').trim() || ('BG' + Date.now().toString().slice(-4));
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Funkce pro vkládání bodů není dostupná.'); return; }
        // #2/#5: provenience 'gps-avg' (= měřeno GPS průměrem). Pozn.: pokud je aktivní Helmert
        // lokalizace (#3), tenhle bod se jí srovná — nekombinuj ji s ref-kalibrací (dvojí korekce).
        // Provenience si nese i OKNO MĚŘENÍ (t0 = začátek okupace). Dvoutelefonní DGPS
        // podle něj bere korekci ze základny za celou dobu, kdy telefon na bodě ležel —
        // bez t0 uměla vzít jen posledních 6 minut před uložením, takže z 20minutového
        // brutálního měření se korigovala poslední třetina. Kombinace „Brutální GPS +
        // DGPS" je tím teprve doopravdy jedna metoda, ne dvě vedle sebe.
        // (pozor: _t0 je modulový začátek běžícího měření — tady se z něj jen ČTE)
        var provT0 = _sessions.length
            ? _sessions.reduce(function (mn, s) { return Math.min(mn, s.t - (s.dur || 0) * 1000); }, Infinity)
            : _t0;
        var accR = (src.sterr != null && isFinite(src.sterr)) ? Math.round(src.sterr * 100) / 100 : null;
        // KVALITA MĚŘENÍ do provenience (js/kvalita-bodu.js z toho dělá protokol).
        // Bez sigma a n nese bod jen tvrzení „±0,3 m"; s nimi je to doklad
        // („z 240 odečtů, rozptyl σ 0,42 m"). Počítá se to tu stejně tak jako tak.
        var sigR = (src.sigma != null && isFinite(src.sigma)) ? Math.round(src.sigma * 1000) / 1000 : null;
        var prov = {
            origin: 'gps-avg', ts: Date.now(), acc: accR,
            t0: (isFinite(provT0) && provT0 > 0 ? Math.round(provT0) : null),
            sess: (_sessions.length || 1),
            sigma: sigR,
            // POZOR: u spojenych sezeni je src.n pocet SEZENI, ne odectu — proto epochs
            n: (src.epochs != null && isFinite(src.epochs)) ? src.epochs
               : ((src.n != null && isFinite(src.n) && !_sessions.length) ? src.n : null)
        };
        var added = window.addImportedPoints([{ name: name, lat: lat, lng: lng, origin: 'gps-avg', acc: accR, prov: prov }]);
        if (added > 0) {
            var sj = (typeof proj4 === 'function') ? proj4('EPSG:4326', 'EPSG:5514', [lng, lat]) : null;
            var coords = sj ? ('\nY ' + Math.abs(sj[0]).toFixed(2) + '  X ' + Math.abs(sj[1]).toFixed(2)) : '';
            var srcTxt = (src.n && _sessions.length > 1) ? ('\nSpojeno z ' + src.n + ' sezení') : '';
            // re-okupace dokončena → vyčisti uložená sezení (+ ukonči případnou kampaň A1)
            _sessions = []; persistSessions();
            try { if (window.AGCampaign && AGCampaign.onSaved) AGCampaign.onSaved(name); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:save'); }
            agAlert('Bod uložen', '#' + name + ' uložen do zakázky.\nDosažená přesnost ±' + (src.sterr != null ? src.sterr.toFixed(2) : '?') + ' m' + coords + srcTxt + calibTxt);
            close();
        } else {
            agAlert('Neuloženo', 'Bod se stejným názvem a polohou už v zakázce je.');
        }
    }

    // ====== otevření / zavření =================================================
    function open() {
        build(); loadSessions(); setTarget(_targetS);
        _open = true; _phase = 'idle'; _samples = []; _result = null; _t0 = 0;
        _rej = { warmup: 0, fused: 0, motion: 0, speed: 0, alt: 0, pdop: 0 };
        pauseCamera();
        document.addEventListener('visibilitychange', onVis);
        _ui.classList.add('on');
        show('bgps-start', true); show('bgps-stop', false); show('bgps-save', false);
        show('bgps-reocc-add', false); show('bgps-when', _sessions.length > 0);
        $('bgps-start').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg> Spustit měření';
        var val = $('bgps-val'); if (val) val.textContent = '–';
        var sub = $('bgps-val-sub'); if (sub) sub.textContent = 'čeká na start';
        setStatus(_sessions.length ? ('Rozpracovaná re-okupace: ' + _sessions.length + ' sezení. Spusť další, nebo ulož.') : 'Připraveno. Umísti telefon a stiskni Spustit.', _sessions.length ? 'warn' : null);
        refreshPdop(); render();
        // A1/A3 (odpojitelné moduly): kampaň „3 návštěvy" + skóre místa se vloží
        // do overlaye, jen když jsou načtené — jinak se nic neděje
        try { if (window.AGCampaign && AGCampaign.onBrutalOpen) AGCampaign.onBrutalOpen(_ui); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:open'); }
        try { if (window.AGSemafor && AGSemafor.onBrutalOpen) AGSemafor.onBrutalOpen(_ui); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'brutal-gps:open'); }
        if (!_tick) _tick = setInterval(render, 300);
    }
    function close() {
        stopWatch();
        _open = false; _phase = 'idle';
        if (_tick) { clearInterval(_tick); _tick = null; }
        document.removeEventListener('visibilitychange', onVis);
        if (_ui) _ui.classList.remove('on');
        resumeCamera();
    }

    // ====== registrace =========================================================
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'brutal-gps', label: 'Přesná GPS (dlouhé průměrování)', icon: ICON, onClick: open, order: 5 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
    window.agOpenBrutalGps = open;     // ať jde navázat i ručně
})();
