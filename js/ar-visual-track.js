// ===== AR Geodet — VIZUÁLNĚ-INERCIÁLNÍ KOTVENÍ AR (SLAM-lite, ODPOJITELNÉ) =======
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Cíl: mezi pomalými GPS /
// kompas fixy držet AR obraz STABILNÍ tím, že se čte pohyb SAMOTNÉHO obrazu z kamery
// (vizuální odometrie). Kompas/gyro jsou pomalá absolutní reference; kamera je rychlá
// krátkodobá — spojení obou = AR neujíždí a přitom nedriftuje.
//
// DVĚ CESTY (feature-detekce, uživatel VOLÍ přepínačem, NIC se nespouští samo):
//  (A) WebXR (Android Chrome): navigator.xr + immersive-ar. Experimentální — WebXR
//      si bere kameru, takže KOLIDUJE s DOM AR (<video id=camera-feed>) a s existující
//      projekcí. Nabízí se jen jako „rychlý test kotvení"; při jakémkoli problému se
//      čistě vrátí k senzorům. NEspouští se automaticky.
//  (B) Fallback (iOS / bez WebXR): řídký OPTICKÝ TOK z <video id=camera-feed>. Snímek se
//      grabne do offscreen canvasu (~160 px, grayscale), najde se ~20–30 FAST rohů a
//      pyramidovým Lucas-Kanade se sledují do dalšího snímku. Medián posunu featur ->
//      delta-yaw / delta-pitch (přes aktuální FOV z window._arProj / visSettings).
//
// VÝSTUP: window.AGVisualTrack.getCorrection() -> {dyaw, dpitch} ve STUPNÍCH — jemná
// KRÁTKODOBÁ korekce, kterou renderAR přičte k smoothedHeading / cameraPitchDown.
// Korekce se sама pomalu VYBLÉDÁVÁ zpět k senzoru (senzor = dlouhodobá absolutní
// reference), takže nikdy nezpůsobí trvalý drift.
//
// ZAPOJENÍ do grafika.js (udělá to integrátor RUČNĚ, tento modul nic needituje):
//   • za řádek se smoothedHeading (kolem ř. 640):
//       if (window.AGVisualTrack && window.AGVisualTrack.enabled) {
//           var _vc = window.AGVisualTrack.getCorrection();
//           if (_vc) { smoothedHeading = ((smoothedHeading + _vc.dyaw) % 360 + 360) % 360; }
//       }
//   • u výpočtu cameraPitchDown (kolem ř. 669), po jeho určení:
//       if (window.AGVisualTrack && window.AGVisualTrack.enabled) {
//           var _vc2 = window.AGVisualTrack.getCorrection();
//           if (_vc2) cameraPitchDown += _vc2.dpitch;
//       }
//   (getCorrection() je idempotentní čtení posledního odhadu — lze volat vícekrát.)
//
// VÝKON: agresivní downscale (160 px), zpracování jen ~10×/s (skip snímků), běží JEN
// když je kamera vidět (viewMode != 'map') a stránka je viditelná; měří dobu zpracování
// a při přetížení / nízkém FPS se SÁM vypne. Registruje přepínač do Nástrojů
// (cat 'AR a kalibrace') i do Nastavení -> AR & přesnost.
//
// Odstranění: smaž js/ar-visual-track.js + řádek <script> v index.html (a v sw.js);
// volitelně odeber 2 hooky výše z grafika.js (bez nich modul jen nic neovlivní).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
        + '<path d="M4.5 4.5l3 3M19.5 4.5l-3 3"/></svg>';

    var LS_KEY = 'agVisualTrack';   // '1' = zapnuto, '0'/null = vypnuto (DEFAULT VYPNUTO)

    // ---- pomocné (nezávislé na globálech; vlastní fallbacky) -------------------
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} try { alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e2) {} }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }
    function curViewMode() { try { return (typeof viewMode !== 'undefined') ? viewMode : 'both'; } catch (e) { return 'both'; } }
    function pageVisible() { try { return !document.hidden && document.visibilityState !== 'hidden'; } catch (e) { return true; } }
    function nowMs() { try { return (performance && performance.now) ? performance.now() : Date.now(); } catch (e) { return Date.now(); } }
    function angDiff(a, b) { return ((a - b + 540) % 360) - 180; }
    // #4: čti SYROVÝ senzorový směr/sklon (bez naší korekce), jinak by filtr četl vlastní výstup a rozkmital se
    function curHeading() { try { if (typeof window._sensorHeadingRaw === 'number' && isFinite(window._sensorHeadingRaw)) return window._sensorHeadingRaw; return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; } catch (e) { return null; } }
    function fovH() { try { return (typeof visSettings !== 'undefined' && visSettings && visSettings.fovH) ? visSettings.fovH : (window._arProj ? window._arProj.halfH * 2 : 90); } catch (e) { return 90; } }
    function fovV() { try { return (typeof visSettings !== 'undefined' && visSettings && visSettings.fovV) ? visSettings.fovV : (window._arProj ? window._arProj.halfV * 2 : 75); } catch (e) { return 75; } }
    function sensorPitch() { try { if (typeof window._sensorPitchRaw === 'number' && isFinite(window._sensorPitchRaw)) return window._sensorPitchRaw; return (window._arProj && isFinite(window._arProj.pitch)) ? window._arProj.pitch : null; } catch (e) { return null; } }

    // ==========================================================================
    //  STAV
    // ==========================================================================
    var enabled = false;         // běží aktuálně sledování?
    var mode = null;             // 'flow' | 'xr' | null
    var _raf = 0;                // id requestAnimationFrame
    var _lastProc = 0;           // čas posledního ZPRACOVANÉHO snímku
    var PROC_INTERVAL = 100;     // ms — cíl ~10 Hz (skip snímků mezi tím)
    var DOWN_W = 160;            // šířka pracovního obrazu (px)

    // optický tok
    var _cv = null, _ctx = null; // offscreen canvas
    var _prevGray = null, _prevW = 0, _prevH = 0, _prevPts = null;
    var _prevHeading = null, _prevPitch = null;

    // korekce (to, co čte renderAR)
    var _corr = { dyaw: 0, dpitch: 0 };
    var _corrTs = 0;             // čas poslední aktualizace korekce
    var _quality = 0;            // 0..1 kvalita sledování
    var DECAY = 0.88;            // vyblednutí korekce zpět k senzoru (per zpracovaný snímek, ~10 Hz -> τ≈0.8 s)
    var MAX_CORR = 10;           // max. dovolená korekce (deg) — pojistka proti ujetí

    // výkonový dohled
    var _procEma = 0;            // EMA doby zpracování (ms)
    var _overCnt = 0;            // kolikrát po sobě zpracování přetáhlo rozpočet
    var _fpsWin = [];            // časy zpracovaných snímků (klouzavé okno)

    // WebXR
    var _xrSession = null, _xrRefSpace = null, _xrRaf = 0, _xrSupported = null;

    // ==========================================================================
    //  OPTICKÝ TOK — grayscale grab
    // ==========================================================================
    function ensureCanvas() {
        if (_cv) return true;
        try {
            _cv = document.createElement('canvas');
            _ctx = _cv.getContext('2d', { willReadFrequently: true });
            return !!_ctx;
        } catch (e) { _cv = null; _ctx = null; return false; }
    }

    // vrátí {gray:Uint8Array, w, h} z aktuálního snímku videa, nebo null
    function grabGray() {
        var v = document.getElementById('camera-feed');
        if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null;
        if (!ensureCanvas()) return null;
        var w = DOWN_W, h = Math.max(60, Math.round(w * v.videoHeight / v.videoWidth));
        if (_cv.width !== w || _cv.height !== h) { _cv.width = w; _cv.height = h; }
        try { _ctx.drawImage(v, 0, 0, w, h); } catch (e) { return null; }
        var img;
        try { img = _ctx.getImageData(0, 0, w, h); } catch (e) { return null; }  // typicky tainted canvas / žádný obraz
        var d = img.data, n = w * h, gray = new Uint8Array(n);
        for (var i = 0, j = 0; i < n; i++, j += 4) {
            // luma (integer aproximace) — rychlé
            gray[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
        }
        return { gray: gray, w: w, h: h };
    }

    // ==========================================================================
    //  FAST rohy (segment test, kruh r=3, 16 pixelů) + jednoduchá non-max suprese
    // ==========================================================================
    var FAST16 = [
        [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
        [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3]
    ];
    function detectCorners(gray, w, h, maxN) {
        var margin = 4, t = 20, cand = [];
        // rychlá předběžná mřížka (krok 3) — nekontrolujeme každý pixel
        for (var y = margin; y < h - margin; y += 3) {
            for (var x = margin; x < w - margin; x += 3) {
                var c = gray[y * w + x], hi = c + t, lo = c - t;
                var bright = 0, dark = 0, maxBright = 0, maxDark = 0, kdiff = 0;
                // segment test: potřebujeme 9 souvislých pixelů jasnějších/tmavších.
                // projdeme 16+9 (dvakrát začátek) pro souvislost přes hranici pole.
                for (var k = 0; k < 25; k++) {
                    var o = FAST16[k % 16], p = gray[(y + o[1]) * w + (x + o[0])];
                    if (p > hi) { bright++; dark = 0; } else if (p < lo) { dark++; bright = 0; } else { bright = 0; dark = 0; }
                    if (bright > maxBright) maxBright = bright;
                    if (dark > maxDark) maxDark = dark;
                    kdiff += Math.abs(p - c);
                }
                if (maxBright >= 9 || maxDark >= 9) cand.push({ x: x, y: y, s: kdiff });
            }
        }
        if (!cand.length) return [];
        cand.sort(function (a, b) { return b.s - a.s; });
        // non-max suprese v mřížkových buňkách ~ (w/8) sloupců -> rozprostři body
        var cell = 10, taken = {}, out = [];
        for (var i = 0; i < cand.length && out.length < maxN; i++) {
            var cx = (cand[i].x / cell) | 0, cy = (cand[i].y / cell) | 0, key = cx + ',' + cy;
            if (taken[key]) continue;
            taken[key] = 1;
            out.push({ x: cand[i].x, y: cand[i].y });
        }
        return out;
    }

    // ==========================================================================
    //  Lucas-Kanade — bilineární vzorkování + 2-úrovňová pyramida
    // ==========================================================================
    function downsample(gray, w, h) {
        var w2 = w >> 1, h2 = h >> 1, out = new Uint8Array(w2 * h2);
        for (var y = 0; y < h2; y++) {
            for (var x = 0; x < w2; x++) {
                var sx = x << 1, sy = y << 1;
                out[y * w2 + x] = (gray[sy * w + sx] + gray[sy * w + sx + 1]
                    + gray[(sy + 1) * w + sx] + gray[(sy + 1) * w + sx + 1]) >> 2;
            }
        }
        return { g: out, w: w2, h: h2 };
    }
    function sampleBil(g, w, h, x, y) {
        if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
        if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
        var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
        var a = g[i], b = g[i + 1], c = g[i + w], d = g[i + w + 1];
        return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    }
    // sleduj body prev -> cur; vrací pole {x,y,u,v,ok}
    function lkTrack(prevG, curG, w, h, pts) {
        // pyramida (2 úrovně): hrubá pro velký pohyb, jemná pro přesnost
        var pP = downsample(prevG, w, h), cP = downsample(curG, w, h);
        var win = 3, iters = 4, res = [];
        for (var pi = 0; pi < pts.length; pi++) {
            var px = pts[pi].x, py = pts[pi].y;
            var u = 0, v = 0, ok = true;
            // 2 úrovně: L1 (poloviční), L0 (plné)
            var levels = [
                { g0: pP.g, g1: cP.g, w: pP.w, h: pP.h, sc: 0.5 },
                { g0: prevG, g1: curG, w: w, h: h, sc: 1.0 }
            ];
            for (var L = 0; L < levels.length; L++) {
                var lv = levels[L], lx = px * lv.sc, ly = py * lv.sc;
                if (L === 0) { u *= 1; v *= 1; } else { u *= 2; v *= 2; }   // přenos guess mezi úrovněmi
                for (var it = 0; it < iters; it++) {
                    var A11 = 0, A12 = 0, A22 = 0, b1 = 0, b2 = 0;
                    for (var wy = -win; wy <= win; wy++) {
                        for (var wx = -win; wx <= win; wx++) {
                            var sx = lx + wx, sy = ly + wy;
                            if (sx < 1 || sy < 1 || sx > lv.w - 2 || sy > lv.h - 2) { ok = false; continue; }
                            var Ix = (sampleBil(lv.g0, lv.w, lv.h, sx + 1, sy) - sampleBil(lv.g0, lv.w, lv.h, sx - 1, sy)) * 0.5;
                            var Iy = (sampleBil(lv.g0, lv.w, lv.h, sx, sy + 1) - sampleBil(lv.g0, lv.w, lv.h, sx, sy - 1)) * 0.5;
                            var It = sampleBil(lv.g1, lv.w, lv.h, sx + u, sy + v) - sampleBil(lv.g0, lv.w, lv.h, sx, sy);
                            A11 += Ix * Ix; A12 += Ix * Iy; A22 += Iy * Iy;
                            b1 += Ix * It; b2 += Iy * It;
                        }
                    }
                    var det = A11 * A22 - A12 * A12;
                    if (Math.abs(det) < 1e-3) { ok = false; break; }
                    var du = -(A22 * b1 - A12 * b2) / det;
                    var dv = -(A11 * b2 - A12 * b1) / det;
                    u += du; v += dv;
                    if (du * du + dv * dv < 0.01) break;
                    if (u * u + v * v > (lv.w * lv.w)) { ok = false; break; }  // uteklo -> zahodit
                }
            }
            res.push({ x: px, y: py, u: u, v: v, ok: ok });
        }
        return res;
    }

    function median(arr) {
        if (!arr.length) return 0;
        var a = arr.slice().sort(function (x, y) { return x - y; });
        var m = a.length >> 1;
        return (a.length & 1) ? a[m] : (a[m - 1] + a[m]) * 0.5;
    }

    // ==========================================================================
    //  JÁDRO: jeden zpracovaný snímek optického toku
    // ==========================================================================
    function processFlowFrame() {
        var t0 = nowMs();
        var frame = grabGray();
        if (!frame) { return; }
        var w = frame.w, h = frame.h, gray = frame.gray;

        if (_prevGray && _prevW === w && _prevH === h && _prevPts && _prevPts.length) {
            var tracked = lkTrack(_prevGray, gray, w, h, _prevPts);
            var us = [], vs = [];
            for (var i = 0; i < tracked.length; i++) {
                var tr = tracked[i];
                if (!tr.ok) continue;
                if (Math.abs(tr.u) > w * 0.4 || Math.abs(tr.v) > h * 0.4) continue;   // nesmysl -> ven
                us.push(tr.u); vs.push(tr.v);
            }
            if (us.length >= 5) {
                var mu = median(us), mv = median(vs);
                // rozptyl kolem mediánu -> inliers (odolnost proti pohybujícím se objektům)
                var inl = 0, sd = 0;
                for (var k = 0; k < us.length; k++) {
                    var e = Math.hypot(us[k] - mu, vs[k] - mv);
                    if (e < 2.0) inl++;
                    sd += e * e;
                }
                sd = Math.sqrt(sd / us.length);
                // medián posunu (px) -> stupně přes aktuální FOV
                // kamera se otočí PO směru hod. -> obraz jede DOLEVA (u<0); yaw roste -> visDyaw = -u/ w * fovH
                var visDyaw = -(mu / w) * fovH();
                var visDpitch = -(mv / h) * fovV();

                // senzorová reference (pomalá, absolutní) — rozdíl pohybu od minula
                var hNow = curHeading(), pNow = sensorPitch();
                var sensDyaw = (hNow != null && _prevHeading != null) ? angDiff(hNow, _prevHeading) : 0;
                var sensDpitch = (pNow != null && _prevPitch != null) ? (pNow - _prevPitch) : 0;
                _prevHeading = hNow; _prevPitch = pNow;

                // KOMPLEMENTÁRNÍ SLOŽENÍ: krátkodobě věř kameře, ale korekce se decayem
                // vrací k 0 (senzor = dlouhodobá absolutní reference) -> žádný trvalý drift.
                _corr.dyaw = _corr.dyaw * DECAY + (visDyaw - sensDyaw);
                _corr.dpitch = _corr.dpitch * DECAY + (visDpitch - sensDpitch);
                if (_corr.dyaw > MAX_CORR) _corr.dyaw = MAX_CORR; else if (_corr.dyaw < -MAX_CORR) _corr.dyaw = -MAX_CORR;
                if (_corr.dpitch > MAX_CORR) _corr.dpitch = MAX_CORR; else if (_corr.dpitch < -MAX_CORR) _corr.dpitch = -MAX_CORR;
                _corrTs = nowMs();

                // kvalita: podíl inlierů, počet featur a nízký rozptyl
                var qN = Math.min(1, us.length / 18);
                var qInl = inl / us.length;
                var qSd = Math.max(0, 1 - sd / 3);
                _quality = Math.max(0, Math.min(1, qN * 0.35 + qInl * 0.45 + qSd * 0.20));
            } else {
                // málo featur (rozmazáno / tma / holá stěna) — korekci nech vyblednout
                _corr.dyaw *= DECAY; _corr.dpitch *= DECAY;
                _quality *= 0.7;
                _prevHeading = curHeading(); _prevPitch = sensorPitch();
            }
        } else {
            _prevHeading = curHeading(); _prevPitch = sensorPitch();
        }

        // připrav další iteraci: aktuální snímek se stane referenčním + nové rohy
        _prevGray = gray; _prevW = w; _prevH = h;
        _prevPts = detectCorners(gray, w, h, 30);

        // ---- výkonový dohled: doba zpracování ----
        var dt = nowMs() - t0;
        _procEma = _procEma ? (_procEma * 0.8 + dt * 0.2) : dt;
        if (_procEma > 45) { _overCnt++; } else { _overCnt = Math.max(0, _overCnt - 1); }
        if (_overCnt >= 12) {   // ~1,2 s trvalého přetížení -> sám se vypni
            selfDisable('výkon (zpracování ' + _procEma.toFixed(0) + ' ms/snímek)');
        }
    }

    // ==========================================================================
    //  SMYČKA (rAF s throttlingem; běží jen když kamera vidět + stránka viditelná)
    // ==========================================================================
    function loop() {
        if (!enabled || mode !== 'flow') { _raf = 0; return; }
        _raf = requestAnimationFrame(loop);
        // gating: bez kamery / v mapě / na pozadí NIC neděláme (a resetujeme referenci)
        if (curViewMode() === 'map' || !pageVisible()) {
            _prevGray = null; _prevPts = null; _prevHeading = null; _prevPitch = null;
            _corr.dyaw *= 0.9; _corr.dpitch *= 0.9; _quality = 0;
            return;
        }
        var t = nowMs();
        if (t - _lastProc < PROC_INTERVAL) return;   // skip snímků -> cíl ~10 Hz
        _lastProc = t;
        // sledování reálného FPS zpracování — klouzavé okno
        _fpsWin.push(t); while (_fpsWin.length && t - _fpsWin[0] > 2000) _fpsWin.shift();
        try { processFlowFrame(); }
        catch (e) { /* jakákoli chyba -> jen tento snímek zahodíme, hook renderAR nikdy nespadne */ }
    }

    function startFlow() {
        if (!ensureCanvas()) { agAlert('Nelze spustit', 'Prohlížeč neumožňuje čtení obrazu z canvasu.'); return false; }
        mode = 'flow'; enabled = true;
        _prevGray = null; _prevPts = null; _prevHeading = null; _prevPitch = null;
        _corr.dyaw = 0; _corr.dpitch = 0; _quality = 0; _procEma = 0; _overCnt = 0; _lastProc = 0;
        if (!_raf) _raf = requestAnimationFrame(loop);
        return true;
    }
    function stopFlow() {
        if (_raf) { try { cancelAnimationFrame(_raf); } catch (e) {} _raf = 0; }
        _prevGray = null; _prevPts = null; _corr.dyaw = 0; _corr.dpitch = 0; _quality = 0;
    }

    function selfDisable(reason) {
        setEnabled(false);
        toast('Vizuální stabilizace vypnuta — ' + (reason || 'výkon'));
    }

    // ==========================================================================
    //  WebXR (experimentální rychlý test kotvení) — VOLITELNÝ, může kolidovat
    // ==========================================================================
    function checkXR() {
        if (_xrSupported !== null) return Promise.resolve(_xrSupported);
        try {
            if (!navigator.xr || !navigator.xr.isSessionSupported) { _xrSupported = false; return Promise.resolve(false); }
            return navigator.xr.isSessionSupported('immersive-ar').then(function (ok) { _xrSupported = !!ok; return _xrSupported; })
                .catch(function () { _xrSupported = false; return false; });
        } catch (e) { _xrSupported = false; return Promise.resolve(false); }
    }
    function quatToYawPitch(o) {
        // orientace viewer pose (kvaternion). Yaw kolem svislé osy (Y), pitch kolem X.
        var x = o.x, y = o.y, z = o.z, w = o.w;
        var yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x)) * 180 / Math.PI;
        var sp = 2 * (w * x - y * z); if (sp > 1) sp = 1; else if (sp < -1) sp = -1;
        var pitch = Math.asin(sp) * 180 / Math.PI;
        return { yaw: yaw, pitch: pitch };
    }
    function startXR() {
        checkXR().then(function (ok) {
            if (!ok) { agAlert('WebXR není k dispozici', 'Toto zařízení/prohlížeč nepodporuje immersive-ar. Použij variantu B (optický tok).'); return; }
            try {
                navigator.xr.requestSession('immersive-ar', {
                    optionalFeatures: ['local', 'local-floor', 'anchors', 'hit-test']
                }).then(function (session) {
                    _xrSession = session; mode = 'xr'; enabled = true;
                    session.addEventListener('end', function () { _xrSession = null; if (mode === 'xr') { mode = null; enabled = false; syncUi(); } });
                    var refType = 'local';
                    session.requestReferenceSpace(refType).then(function (rs) {
                        _xrRefSpace = rs;
                        var prevYaw = null, prevPitch = null;
                        var onXR = function (t, frame) {
                            if (!_xrSession) return;
                            _xrRaf = session.requestAnimationFrame(onXR);
                            try {
                                var pose = frame.getViewerPose(_xrRefSpace);
                                if (pose) {
                                    var yp = quatToYawPitch(pose.transform.orientation);
                                    var hNow = curHeading(), pNow = sensorPitch();
                                    var sensDyaw = (hNow != null && _prevHeading != null) ? angDiff(hNow, _prevHeading) : 0;
                                    var sensDpitch = (pNow != null && _prevPitch != null) ? (pNow - _prevPitch) : 0;
                                    _prevHeading = hNow; _prevPitch = pNow;
                                    if (prevYaw != null) {
                                        var visDyaw = -angDiff(yp.yaw, prevYaw);   // XR yaw je proti smyslu azimutu
                                        var visDpitch = -(yp.pitch - prevPitch);
                                        _corr.dyaw = _corr.dyaw * DECAY + (visDyaw - sensDyaw);
                                        _corr.dpitch = _corr.dpitch * DECAY + (visDpitch - sensDpitch);
                                        if (_corr.dyaw > MAX_CORR) _corr.dyaw = MAX_CORR; else if (_corr.dyaw < -MAX_CORR) _corr.dyaw = -MAX_CORR;
                                        if (_corr.dpitch > MAX_CORR) _corr.dpitch = MAX_CORR; else if (_corr.dpitch < -MAX_CORR) _corr.dpitch = -MAX_CORR;
                                        _corrTs = nowMs(); _quality = 0.9;
                                    }
                                    prevYaw = yp.yaw; prevPitch = yp.pitch;
                                }
                            } catch (e) {}
                        };
                        _xrRaf = session.requestAnimationFrame(onXR);
                        syncUi();
                        toast('WebXR kotvení běží (experimentální)');
                    }).catch(function () { stopXR(); agAlert('WebXR', 'Nepodařilo se získat referenční prostor. Vrať se k optickému toku.'); });
                }).catch(function () {
                    mode = null; enabled = false;
                    agAlert('WebXR se nespustil', 'Relaci se nepodařilo otevřít (kolize s kamerou nebo odepřený souhlas). Použij variantu B (optický tok).');
                });
            } catch (e) { mode = null; enabled = false; }
        });
    }
    function stopXR() {
        try { if (_xrSession) { if (_xrRaf) try { _xrSession.cancelAnimationFrame(_xrRaf); } catch (e) {} _xrSession.end().catch(function () {}); } } catch (e) {}
        _xrSession = null; _xrRefSpace = null; _xrRaf = 0;
        _corr.dyaw = 0; _corr.dpitch = 0; _quality = 0;
    }

    // ==========================================================================
    //  PŘEPÍNÁNÍ + PREFERENCE
    // ==========================================================================
    function readPref() { try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; } }
    function writePref(on) { try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (e) {} }

    function setEnabled(on, useXR) {
        writePref(!!on);
        if (on) {
            if (mode === 'xr' || mode === 'flow') return;   // už běží
            if (useXR) startXR(); else startFlow();
        } else {
            if (mode === 'xr') stopXR();
            else stopFlow();
            enabled = false; mode = null;
        }
        syncUi();
    }

    // ==========================================================================
    //  VEŘEJNÉ API (čte renderAR)
    // ==========================================================================
    var api = {
        start: function (useXR) { setEnabled(true, useXR); },
        stop: function () { setEnabled(false); },
        // {dyaw, dpitch} ve stupních; null když vypnuto / zastaralé / bez kamery.
        // Idempotentní čtení — lze volat vícekrát za snímek renderAR.
        getCorrection: function () {
            if (!enabled) return null;
            if (nowMs() - _corrTs > 500) return null;         // starší než 0,5 s -> nevěř
            if (_quality < 0.25) return null;                  // nízká kvalita -> radši nic
            return { dyaw: _corr.dyaw, dpitch: _corr.dpitch };
        },
        get enabled() { return enabled; },
        set enabled(v) { setEnabled(!!v); },
        get quality() { return _quality; },
        get mode() { return mode; }
    };
    try { window.AGVisualTrack = api; } catch (e) {}

    // ==========================================================================
    //  UI — modal z Nástrojů + přepínač v Nastavení
    // ==========================================================================
    var _statTimer = null;
    function ensureModal() {
        if (document.getElementById('agvt-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agvt-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Vizuální stabilizace AR <span style="font-size:12px;opacity:.6;">(beta)</span></h3>'
            + '<p style="font-size:12.5px;opacity:.82;margin:2px 0 10px;line-height:1.45;">Mezi pomalými GPS/kompas fixy sleduje appka <b>pohyb obrazu z kamery</b> a drží AR značky stabilní. '
            + 'Kamera nese <b>krátkodobou plynulost</b>, kompas/gyro <b>dlouhodobý absolutní směr</b> (korekce se sama vrací k senzoru, takže neujíždí). '
            + 'Jde o <b>orientační stabilizaci</b>, ne o měřicí přesnost.</p>'
            + '<div class="agvt-row" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0;">'
            + '  <span style="font-weight:600;">Zapnout optický tok (doporučeno)</span>'
            + '  <label class="st-sw"><input type="checkbox" id="agvt-cb"><span class="st-sw-face"></span></label>'
            + '</div>'
            + '<div id="agvt-stat" style="font-family:var(--font-mono,monospace);font-size:12px;opacity:.85;margin:4px 2px 8px;min-height:18px;"></div>'
            + '<div style="font-size:12px;color:#fbbf24;margin:2px 2px 10px;line-height:1.4;">Funguje jen se zapnutou kamerou (AR nebo Split). Za tmy, na holé stěně nebo při rozmazání se sám ztlumí. Při přetížení telefonu se sám vypne.</div>'
            + '<details style="margin:6px 0 10px;"><summary style="cursor:pointer;font-size:12.5px;opacity:.8;">WebXR kotvení (experimentální, Android)</summary>'
            + '  <p style="font-size:12px;opacity:.75;line-height:1.4;margin:6px 0;">WebXR si bere kameru celého systému a může kolidovat s běžným AR zobrazením. Jen rychlý test na zařízeních s ARCore.</p>'
            + '  <button class="btn btn-secondary" id="agvt-xr" style="width:100%;">Zkusit WebXR kotvení</button>'
            + '</details>'
            + '<button class="btn btn-secondary" style="margin-top:6px;" onclick="window.agCloseVisualTrack&&window.agCloseVisualTrack()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('agvt-cb').addEventListener('change', function (e) { setEnabled(e.target.checked, false); });
        document.getElementById('agvt-xr').addEventListener('click', function () { setEnabled(false); setEnabled(true, true); });
    }

    function renderStat() {
        var s = document.getElementById('agvt-stat'); if (!s) return;
        if (!enabled) { s.textContent = 'stav: vypnuto'; return; }
        var camOk = curViewMode() !== 'map';
        var q = Math.round(_quality * 100);
        var bar = camOk ? ('kvalita ' + q + '%  ·  korekce ' + _corr.dyaw.toFixed(2) + '° / ' + _corr.dpitch.toFixed(2) + '°  ·  ' + (mode || '?')) : 'čekám na kameru (přepni na AR/Split)';
        s.textContent = 'stav: ' + bar + (_procEma ? ('  ·  ' + _procEma.toFixed(0) + ' ms/snímek') : '');
    }

    function openTool() {
        ensureModal(); injectStyles();
        var cb = document.getElementById('agvt-cb'); if (cb) cb.checked = !!enabled;
        document.getElementById('agvt-modal').style.display = 'flex';
        if (!_statTimer) _statTimer = setInterval(function () {
            var m = document.getElementById('agvt-modal');
            if (m && m.style.display === 'flex') renderStat();
        }, 400);
    }
    window.agCloseVisualTrack = function () {
        var m = document.getElementById('agvt-modal'); if (m) m.style.display = 'none';
        if (_statTimer) { clearInterval(_statTimer); _statTimer = null; }
    };
    window.agOpenVisualTrack = openTool;

    // ---- přepínač v Nastavení -> AR & přesnost (jako ar-fusion) ----------------
    function syncUi() {
        var cb = document.getElementById('agvt-cb'); if (cb) cb.checked = !!enabled;
        var scb = document.getElementById('agvt-settings-cb'); if (scb) scb.checked = !!enabled;
    }
    function injectSettingsToggle() {
        if (document.getElementById('agvt-settings-row')) return;
        var tab = document.getElementById('tab-ar');
        if (!tab) return;
        var row = document.createElement('div');
        row.className = 'st-row'; row.id = 'agvt-settings-row';
        var lab = document.createElement('span');
        lab.className = 'st-lab';
        lab.innerHTML = 'Vizuální stabilizace AR (beta)<small>drží obraz z kamery stabilní mezi GPS/kompas fixy — orientační, ne měřicí</small>';
        var sw = document.createElement('label');
        sw.className = 'st-sw';
        var cb = document.createElement('input');
        cb.type = 'checkbox'; cb.id = 'agvt-settings-cb'; cb.checked = !!enabled;
        cb.addEventListener('change', function () { setEnabled(cb.checked, false); });
        var face = document.createElement('span'); face.className = 'st-sw-face';
        sw.appendChild(cb); sw.appendChild(face);
        row.appendChild(lab); row.appendChild(sw);
        var anchor = tab.querySelector('#ag-arfusion-row');
        if (anchor && anchor.nextSibling) tab.insertBefore(row, anchor.nextSibling);
        else if (anchor) tab.appendChild(row);
        else {
            var anchor2 = tab.querySelector('button[onclick*="openCompassModal"]');
            if (anchor2) tab.insertBefore(row, anchor2); else tab.appendChild(row);
        }
        syncUi();
    }

    // ---- styly (minimální; sdílí st-sw z appky) --------------------------------
    function injectStyles() {
        if (document.getElementById('agvt-style')) return;
        var st = document.createElement('style'); st.id = 'agvt-style';
        st.textContent = [
            '#agvt-modal .agvt-row{padding:9px 10px;border-radius:10px;background:rgba(255,255,255,0.05);}',
            // fallback vzhledu přepínače, kdyby appka st-sw neměla (defenzivně)
            '#agvt-modal .st-sw input{width:auto;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ==========================================================================
    //  REGISTRACE (launcher Nástrojů) + fallback tlačítko
    // ==========================================================================
    function register() {
        injectStyles();
        try { injectSettingsToggle(); } catch (e) {}
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'ar-visual-track', label: 'Vizuální stabilizace AR (beta)', icon: ICON, cat: 'AR a kalibrace', onClick: openTool, order: 9 });
        } else {
            ensureFallbackFab();
        }
    }
    function ensureFallbackFab() {
        if (document.getElementById('agvt-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'agvt-fab'; b.type = 'button';
        b.title = 'Vizuální stabilizace AR'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:214px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#2f9e74);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        var svg = b.querySelector('svg'); if (svg) svg.style.cssText = 'width:24px;height:24px;';
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }

    // ---- vypnout, když stránka zmizí na pozadí (šetři baterii) ------------------
    try {
        document.addEventListener('visibilitychange', function () {
            if (document.hidden && mode === 'flow') {
                // smyčka se sама uspí (gating v loop), jen vyčistíme referenci
                _prevGray = null; _prevPts = null; _quality = 0;
            }
        });
    } catch (e) {}

    // ---- init (idempotentní; DEFAULT VYPNUTO — nikdy nespouštět samo od sebe) ---
    function init() {
        try { register(); } catch (e) { try { console.warn('[ar-visual-track] register', e); } catch (e2) {} }
        // pokud uživatel DŘÍVE zapnul, obnovíme (jeho volba, ne auto-start) — jen optický tok
        try { if (readPref() && !enabled) startFlow(); syncUi(); } catch (e) {}
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    // druhý průchod — #tab-ar / launcher vznikají později
    window.addEventListener('load', function () { setTimeout(function () { try { injectSettingsToggle(); register(); } catch (e) {} }, 350); });
})();
