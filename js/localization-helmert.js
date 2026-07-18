// ===== AR Geodet — HELMERTOVA LOKALIZACE STAVENIŠTĚ (ODPOJITELNÁ vrstva) =======
// Neinvazivní, samostatný nástroj. NEEDITUJE logika.js, grafika.js ani jiný
// soubor — jen si registruje dlaždici přes agRegisterFieldTool a vystaví
// window.agOpenLocalize + window.AGLocalize.
//
// Princip: telefonní GPS má na malém území SYSTEMATICKÝ posun (a mírné pootočení
// i změnu měřítka podle konstelace družic). Když na několika ZNÁMÝCH bodech
// (přesné S-JTSK z ČÚZK / vlastní zaměření) uděláme robustní GPS průměr, můžeme
// z dvojic {měřená GPS ↔ známé S-JTSK} proložit 2D podobnostní (Helmertovu)
// transformaci — posun (tx,ty) + rotaci + měřítko — a tou pak srovnat celé
// staveniště. Volitelně proložíme i výškový trend (rovina přes 3+ výšek).
//
//   ⚠ Pořád je to jen telefon (±3–7 m surově). Lokalizace systematiku zmenší,
//   ale výsledek je ORIENTAČNÍ, ne přejímací měření. Extrapolace mimo obalový
//   polygon referenčních bodů je nespolehlivá a hlásí se.
//
// Aplikace (integraci do ukládací cesty udělá hlavní autor — viz shrnutí):
//   window.AGLocalize.apply(lat,lng)  -> [lat,lng]  (srovnané WGS84)
//   window.AGLocalize.applyZ(lat,lng,z) -> z'       (srovnaná výška, když je trend)
//   window.AGLocalize.active, .params, .residuals
//
// Uložení: transformace per zakázka do localStorage ('<pid>_helmertLoc').
// Odstranění: smaž js/localization-helmert.js + jeho <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M4 4h16v16H4z" opacity=".35"/><path d="M7 17 17 7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="7" r="2"/>'
        + '<path d="M4 20 2 22M20 4l2-2"/></svg>';

    var D2R = Math.PI / 180, R2D = 180 / Math.PI;
    var EARTH_M_LAT = 111320;

    // ---- stav -----------------------------------------------------------------
    var _pairs = [];        // [{id,name,knownLat,knownLng,knownY,knownX,knownH,measLat,measLng,measAlt,measN,measSig}]
    var _selKnownId = null; // právě vybraný známý bod pro nový pár
    var _model = null;      // spočítaná transformace (viz buildModel)
    var _capTimer = null, _capSamples = [], _capAltSamples = [], _capT0 = 0, _capDur = 8000;

    // ---- pomocné (defenzivně, jako okolní moduly) -----------------------------
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} try { alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e2) {} }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function curAlt() { try { return (typeof userAlt !== 'undefined' && userAlt != null && isFinite(userAlt)) ? userAlt : null; } catch (e) { return null; } }
    function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function lsKey() { return pid() + '_helmertLoc'; }

    function metersPerDeg(lat) {
        if (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) { try { var m = GeoCore.metersPerDeg(lat); if (m && m.lat) return m; } catch (e) {} }
        return { lat: EARTH_M_LAT, lng: EARTH_M_LAT * Math.cos(lat * D2R) };
    }
    // WGS -> S-JTSK Y,X (kladné metry) nebo null
    function toSJTSK(lat, lng) {
        try {
            if (typeof GeoCore !== 'undefined' && GeoCore.toSJTSK) { var s = GeoCore.toSJTSK(lat, lng); if (s && isFinite(s.Y)) return { Y: Math.abs(s.Y), X: Math.abs(s.X) }; }
        } catch (e) {}
        try { if (typeof proj4 === 'function') { var p = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); return { Y: Math.abs(p[0]), X: Math.abs(p[1]) }; } } catch (e) {}
        return null;
    }
    // S-JTSK Y,X (kladné) -> WGS84 {lat,lng} nebo null
    function fromSJTSK(Y, X) {
        try { if (typeof proj4 === 'function') { var w = proj4('EPSG:5514', 'EPSG:4326', [-Math.abs(Y), -Math.abs(X)]); return { lat: w[1], lng: w[0] }; } } catch (e) {}
        return null;
    }

    function ptById(id) { try { if (typeof arPoints === 'undefined') return null; return arPoints.find(function (q) { return q.id === id; }) || null; } catch (e) { return null; } }
    function candidatePoints() {
        try {
            if (typeof arPoints === 'undefined') return [];
            return arPoints.filter(function (p) { return !p.hidden; })
                .map(function (p) { return { p: p, d: haveUser() ? getDistance(userLat, userLng, p.lat, p.lng) : null }; })
                .sort(function (a, b) {
                    if (a.d == null && b.d == null) return 0;
                    if (a.d == null) return 1; if (b.d == null) return -1; return a.d - b.d;
                });
        } catch (e) { return []; }
    }

    // ---- robustní GPS průměr --------------------------------------------------
    // Preferuj appkou průměrovaný gpsAvgResult; jinak posbírej vzorky z userLat/Lng.
    function currentAvg() {
        try { if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && !gpsAvgResult.coarse && isFinite(gpsAvgResult.lat) && isFinite(gpsAvgResult.lng)) return { lat: gpsAvgResult.lat, lng: gpsAvgResult.lng, alt: (isFinite(gpsAvgResult.alt) ? gpsAvgResult.alt : curAlt()), sig: (isFinite(gpsAvgResult.sterr) ? gpsAvgResult.sterr : (isFinite(gpsAvgResult.sigma) ? gpsAvgResult.sigma : null)), n: gpsAvgResult.n, from: 'avg' }; } catch (e) {}
        return null;
    }
    // robustní průměr posbíraných vzorků [{lat,lng}] přes medián E/N kolem 1. vzorku
    function robustMean(samples, altSamples) {
        if (!samples.length) return null;
        var lat0 = samples[0].lat, lng0 = samples[0].lng, m = metersPerDeg(lat0);
        var es = [], ns = [];
        samples.forEach(function (s) { es.push((s.lng - lng0) * m.lng); ns.push((s.lat - lat0) * m.lat); });
        function median(arr) { var a = arr.slice().sort(function (x, y) { return x - y; }); var h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; }
        var mE = median(es), mN = median(ns);
        // MAD ořez odlehlých fixů
        var dev = es.map(function (e, i) { return Math.hypot(e - mE, ns[i] - mN); }).slice().sort(function (a, b) { return a - b; });
        var mad = dev[dev.length >> 1] || 0, thr = Math.max(3 * 1.4826 * mad, 1.0);
        var se = 0, sn = 0, k = 0;
        es.forEach(function (e, i) { if (Math.hypot(e - mE, ns[i] - mN) <= thr) { se += e; sn += ns[i]; k++; } });
        if (k < 1) { se = mE; sn = mN; k = 1; }
        var avE = se / k, avN = sn / k;
        // rozptyl inlierů -> střední chyba průměru
        var ss = 0, kk = 0;
        es.forEach(function (e, i) { if (Math.hypot(e - mE, ns[i] - mN) <= thr) { ss += Math.pow(e - avE, 2) + Math.pow(ns[i] - avN, 2); kk++; } });
        var sigma = kk > 1 ? Math.sqrt(ss / (kk - 1)) / Math.sqrt(kk) : null;
        var alt = null;
        if (altSamples && altSamples.length) { var av = altSamples.slice().filter(function (a) { return isFinite(a); }); if (av.length) { av.sort(function (a, b) { return a - b; }); alt = av[av.length >> 1]; } }
        return { lat: lat0 + avN / m.lat, lng: lng0 + avE / m.lng, alt: alt, sig: sigma, n: k, from: 'sampled' };
    }

    // ---- lineární MNČ (přes LinAlg, fallback vlastní Gaussova eliminace) -------
    function solveLinear(A, b) {
        try { if (window.LinAlg && LinAlg.lstsq) { var x = LinAlg.lstsq(A, b); if (x) return x; } } catch (e) {}
        return lstsqLocal(A, b);
    }
    // vlastní normální rovnice AtA x = Atb + Gaussova eliminace s pivotováním
    function lstsqLocal(A, b) {
        var m = A.length; if (!m) return null; var n = A[0].length;
        var AtA = [], Atb = [];
        for (var i = 0; i < n; i++) { AtA.push(new Array(n).fill(0)); Atb.push(0); }
        for (var r = 0; r < m; r++) {
            for (var i2 = 0; i2 < n; i2++) {
                Atb[i2] += A[r][i2] * b[r];
                for (var j = 0; j < n; j++) AtA[i2][j] += A[r][i2] * A[r][j];
            }
        }
        return gaussSolve(AtA, Atb);
    }
    function gaussSolve(A, b) {
        var n = A.length, M = [];
        for (var i = 0; i < n; i++) { M.push(A[i].slice()); M[i].push(b[i]); }
        for (var c = 0; c < n; c++) {
            var piv = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
            if (Math.abs(M[piv][c]) < 1e-12) return null;
            var t = M[c]; M[c] = M[piv]; M[piv] = t;
            for (var r2 = 0; r2 < n; r2++) { if (r2 === c) continue; var f = M[r2][c] / M[c][c]; for (var cc = c; cc <= n; cc++) M[r2][cc] -= f * M[c][cc]; }
        }
        var x = new Array(n); for (var k = 0; k < n; k++) x[k] = M[k][n] / M[k][k];
        for (var q = 0; q < n; q++) if (!isFinite(x[q])) return null;
        return x;
    }

    // ---- jádro: sestav Helmertův model ze všech dvojic ------------------------
    // Fit:  KE = a*ME - b*MN + tx ;  KN = b*ME + a*MN + ty
    //   ME,MN = měřená GPS v lokální ENU (rel. centroidu měřených, metry)
    //   KE,KN = známé S-JTSK rel. centroidu známých (metry)
    //   a = s*cos(rot), b = s*sin(rot)   -> měřítko s=hypot(a,b), rotace=atan2(b,a)
    function buildModel() {
        var P = _pairs.filter(function (p) { return isFinite(p.measLat) && isFinite(p.measLng) && isFinite(p.knownY) && isFinite(p.knownX); });
        var nP = P.length;
        if (nP < 2) return null;

        // centroid měřených (WGS) + přepočet na ENU
        var latC = 0, lngC = 0;
        P.forEach(function (p) { latC += p.measLat; lngC += p.measLng; });
        latC /= nP; lngC /= nP;
        var m = metersPerDeg(latC);
        // centroid známých (S-JTSK)
        var kE0 = 0, kN0 = 0;
        P.forEach(function (p) { kE0 += p.knownY; kN0 += p.knownX; });
        kE0 /= nP; kN0 /= nP;

        var ME = [], MN = [], KE = [], KN = [];
        P.forEach(function (p) {
            ME.push((p.measLng - lngC) * m.lng);
            MN.push((p.measLat - latC) * m.lat);
            KE.push(p.knownY - kE0);
            KN.push(p.knownX - kN0);
        });

        // soustava: neznámé [a,b,tx,ty], 2 rovnice na dvojici
        //   KE = a*ME - b*MN + tx
        //   KN = b*ME + a*MN + ty
        var A = [], bb = [];
        for (var i = 0; i < nP; i++) {
            A.push([ME[i], -MN[i], 1, 0]); bb.push(KE[i]);
            A.push([MN[i], ME[i], 0, 1]); bb.push(KN[i]);
        }
        var x = solveLinear(A, bb);
        if (!x) return null;
        var a = x[0], b = x[1], tx = x[2], ty = x[3];
        var scale = Math.hypot(a, b), rot = Math.atan2(b, a) * R2D;

        // rezidua na bod (v S-JTSK metrech)
        var residuals = [], sumsq = 0, maxRes = 0, maxName = '';
        for (var j = 0; j < nP; j++) {
            var pe = a * ME[j] - b * MN[j] + tx;
            var pn = b * ME[j] + a * MN[j] + ty;
            var rE = pe - KE[j], rN = pn - KN[j], rr = Math.hypot(rE, rN);
            residuals.push({ name: P[j].name, dE: rE, dN: rN, r: rr });
            sumsq += rE * rE + rN * rN;
            if (rr > maxRes) { maxRes = rr; maxName = P[j].name; }
        }
        // střední chyba na bod: SSR / (2n - 4) stupňů volnosti (4 parametry)
        var dof = 2 * nP - 4;
        var sigma0 = dof > 0 ? Math.sqrt(sumsq / dof) : null;   // ~ střední polohová chyba (m)

        // podmíněnost / kolinearita: geometrie referenčních bodů. Když leží skoro
        // na přímce nebo jsou namačkané, transformace (hlavně rotace/měřítko) je
        // nespolehlivá. Měříme přes „šířku" mračna kolmo na hlavní osu.
        var geom = geometryQuality(ME, MN);

        // obalový (konvexní) polygon měřených bodů v ENU — pro test extrapolace
        var hull = convexHull(ME.map(function (e, i) { return { x: e, y: MN[i] }; }));

        // volitelný výškový trend: rovina dz = c0 + c1*KE + c2*KN přes dvojice,
        // kde dz = knownH(Bpv) - measAlt_Bpv (potřeba ≥3 dvojice s oběma výškami).
        // #11: measAlt je ELIPSOIDICKÁ (WGS84) GPS výška — před fitem ji převeď na Bpv odečtením
        // undulace geoidu, jinak by applyZ (vstup Bpv) vracel výšku posunutou o ~ -45 m.
        function _bpv(p) { var u = (typeof getGeoidUndulation === 'function') ? getGeoidUndulation(p.measLat, p.measLng) : (45.5 + 0.55 * (p.measLng - 15.5) - 0.4 * (p.measLat - 49.8)); return p.measAlt - u; }
        var heightPlane = null;
        var HP = P.filter(function (p) { return isFinite(p.knownH) && isFinite(p.measAlt); });
        if (HP.length >= 3) {
            var Ah = [], bh = [];
            HP.forEach(function (p) { Ah.push([1, p.knownY - kE0, p.knownX - kN0]); bh.push(p.knownH - _bpv(p)); });
            var xh = solveLinear(Ah, bh);
            if (xh) {
                var hres = 0, hn = 0;
                HP.forEach(function (p) { var pred = xh[0] + xh[1] * (p.knownY - kE0) + xh[2] * (p.knownX - kN0); hres += Math.pow((p.knownH - _bpv(p)) - pred, 2); hn++; });
                heightPlane = { c0: xh[0], c1: xh[1], c2: xh[2], n: hn, rms: hn > 3 ? Math.sqrt(hres / (hn - 3)) : null };
            }
        }

        return {
            a: a, b: b, tx: tx, ty: ty, scale: scale, rot: rot,
            latC: latC, lngC: lngC, mLat: m.lat, mLng: m.lng, kE0: kE0, kN0: kN0,
            n: nP, residuals: residuals, sigma0: sigma0, maxRes: maxRes, maxName: maxName,
            geom: geom, hull: hull, heightPlane: heightPlane, ts: Date.now()
        };
    }

    // kvalita geometrie: hlavní/vedlejší poloosa mračna (PCA 2×2). Vrací
    // {spanMajor, spanMinor, ratio, collinear}
    function geometryQuality(ME, MN) {
        var n = ME.length, mx = 0, my = 0;
        for (var i = 0; i < n; i++) { mx += ME[i]; my += MN[i]; }
        mx /= n; my /= n;
        var sxx = 0, syy = 0, sxy = 0;
        for (var j = 0; j < n; j++) { var dx = ME[j] - mx, dy = MN[j] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
        sxx /= n; syy /= n; sxy /= n;
        var tr = sxx + syy, dt = sxx * syy - sxy * sxy;
        var disc = Math.sqrt(Math.max(0, tr * tr / 4 - dt));
        var l1 = tr / 2 + disc, l2 = tr / 2 - disc;
        var major = 2 * Math.sqrt(Math.max(0, l1)), minor = 2 * Math.sqrt(Math.max(0, l2));
        var ratio = major > 1e-6 ? minor / major : 0;
        return { spanMajor: major, spanMinor: minor, ratio: ratio, collinear: (ratio < 0.08 || minor < 0.5) };
    }

    // ---- konvexní obal + test bod uvnitř (Andrew monotone chain) --------------
    function convexHull(pts) {
        var P = pts.filter(function (p) { return isFinite(p.x) && isFinite(p.y); }).slice()
            .sort(function (a, b) { return a.x - b.x || a.y - b.y; });
        if (P.length < 3) return P;
        function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
        var lo = [], hi = [];
        for (var i = 0; i < P.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 0) lo.pop(); lo.push(P[i]); }
        for (var k = P.length - 1; k >= 0; k--) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], P[k]) <= 0) hi.pop(); hi.push(P[k]); }
        lo.pop(); hi.pop();
        return lo.concat(hi);
    }
    function pointInPoly(x, y, poly) {
        if (!poly || poly.length < 3) return false;
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }

    // ---- persistence transformace per zakázka ---------------------------------
    function saveModel(mdl) {
        try { if (mdl) localStorage.setItem(lsKey(), JSON.stringify({ m: mdl, pairs: _pairs, on: true })); } catch (e) {}
    }
    function loadModel() {
        try {
            var raw = localStorage.getItem(lsKey()); if (!raw) return;
            var o = JSON.parse(raw);
            // #17: dvojice obnov NEZÁVISLE na platnosti modelu (jinak se rozpracované páry po reloadu ztratí)
            if (o) { if (Array.isArray(o.pairs)) _pairs = o.pairs; if (o.m && isFinite(o.m.a)) { _model = o.m; _model._on = (o.on !== false); } }
        } catch (e) {}
    }
    function clearModel() { try { localStorage.removeItem(lsKey()); } catch (e) {} _model = null; }

    // ---- veřejné API: AGLocalize ----------------------------------------------
    // apply(lat,lng): srovná surové WGS na lokalizovaný S-JTSK a zpět na WGS.
    //   Vrací [lat,lng]. Mimo obalový polygon vrací srovnané, ale nastaví
    //   _lastExtrapolated=true (volající si může vyžádat kontrolu).
    function _apply(lat, lng) {
        var mdl = _activeModel(); if (!mdl) return [lat, lng];
        var e = (lng - mdl.lngC) * mdl.mLng, n = (lat - mdl.latC) * mdl.mLat;
        AGLocalize._lastExtrapolated = !pointInPoly(e, n, mdl.hull);
        var KE = mdl.a * e - mdl.b * n + mdl.tx + mdl.kE0;
        var KN = mdl.b * e + mdl.a * n + mdl.ty + mdl.kN0;
        var w = fromSJTSK(KE, KN);
        return w ? [w.lat, w.lng] : [lat, lng];
    }
    function _applyZ(lat, lng, z) {
        var mdl = _activeModel(); if (!mdl || !mdl.heightPlane || !isFinite(z)) return z;
        var s = toSJTSK(lat, lng); if (!s) return z;
        var hp = mdl.heightPlane;
        var dz = hp.c0 + hp.c1 * (s.Y - mdl.kE0) + hp.c2 * (s.X - mdl.kN0);
        return z + dz;
    }
    function _activeModel() {
        if (_model && _model._on !== false && isFinite(_model.a)) return _model;
        return null;
    }
    var AGLocalize = {
        apply: _apply,
        applyZ: _applyZ,
        _lastExtrapolated: false,
        get active() { return !!_activeModel(); },
        get params() { var m = _activeModel(); return m ? { tx: m.tx, ty: m.ty, scale: m.scale, rot: m.rot, sigma0: m.sigma0, n: m.n, heightTrend: !!m.heightPlane } : null; },
        get residuals() { var m = _activeModel(); return m ? m.residuals : null; },
        // ruční přepnutí aktivní/neaktivní (nechává model uložený)
        setActive: function (on) { if (_model) { _model._on = !!on; saveModel(_model); renderState(); } },
        recompute: function () { _model = buildModel(); if (_model) { _model._on = true; saveModel(_model); } return _model; }
    };
    try { window.AGLocalize = AGLocalize; } catch (e) {}

    // ================= UI ======================================================
    function ensureModal() {
        if (document.getElementById('aghl-modal')) return;
        injectStyles();
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'aghl-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Lokalizace staveniště (Helmert)</h3>'
            + '<p style="font-size:12.5px;opacity:.82;margin:2px 0 10px;line-height:1.45;">Srovná systematiku telefonní GPS přes celé staveniště. '
            + 'Na každém <b>známém bodě</b> udělej robustní GPS průměr a spáruj ho s jeho přesnou polohou. '
            + 'Z <b>2+</b> dvojic vznikne posun+rotace+měřítko (Helmert), od <b>3</b> i kontrola přesnosti. '
            + '<b>Orientační, ne přejímací měření.</b></p>'
            + '<div id="aghl-state" class="aghl-state"></div>'
            + '<div class="aghl-add">'
            + '  <label class="aghl-fld"><span>známý bod (přesné S-JTSK)</span><select id="aghl-sel"></select></label>'
            + '  <div id="aghl-gps" class="aghl-gps"></div>'
            + '  <div class="aghl-addbtns">'
            + '    <button class="btn" id="aghl-measure"><svg class="icon"><use href="#i-crosshair"/></svg> Změřit GPS zde</button>'
            + '    <button class="btn btn-secondary" id="aghl-useavg">Použít průměr appky</button>'
            + '  </div>'
            + '  <div id="aghl-capbar" class="aghl-capbar" style="display:none;"><div id="aghl-capfill"></div><span id="aghl-captxt"></span></div>'
            + '</div>'
            + '<div id="aghl-list" class="aghl-list"></div>'
            + '<div id="aghl-warn" style="font-size:12px;color:#fbbf24;margin:6px 2px;"></div>'
            + '<div id="aghl-result" class="aghl-result" style="display:none;"></div>'
            + '<div id="aghl-actions" style="display:none;">'
            + '  <button class="btn btn-blue" id="aghl-apply-pose" style="display:none;"><svg class="icon"><use href="#i-check"/></svg> Aplikovat na AR počátek</button>'
            + '  <button class="btn btn-secondary" id="aghl-off" style="margin-top:10px;">Vypnout lokalizaci</button>'
            + '  <button class="btn btn-secondary" id="aghl-clear" style="margin-top:10px;">Smazat lokalizaci</button>'
            + '</div>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" onclick="window.agCloseLocalize&&window.agCloseLocalize()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('aghl-sel').addEventListener('change', function (e) { _selKnownId = e.target.value || null; renderGps(); });
        document.getElementById('aghl-measure').addEventListener('click', startCapture);
        document.getElementById('aghl-useavg').addEventListener('click', useAppAvg);
        document.getElementById('aghl-off').addEventListener('click', function () { AGLocalize.setActive(false); toast('Lokalizace vypnuta (model zůstal uložen).'); });
        document.getElementById('aghl-clear').addEventListener('click', doClear);
        document.getElementById('aghl-apply-pose').addEventListener('click', applyToPose);
    }

    function fillSelect() {
        var sel = document.getElementById('aghl-sel'); if (!sel) return;
        var list = candidatePoints();
        var opts = '<option value="">— vyber známý bod —</option>';
        list.slice(0, 120).forEach(function (x) {
            var used = _pairs.some(function (pr) { return pr.id === x.p.id; });
            var tag = (x.p.cat && x.p.cat !== 'CUSTOM') ? ' [' + escapeHtml(x.p.cat) + ']' : '';
            var dd = (x.d != null ? ' · ' + x.d.toFixed(0) + ' m' : '');
            opts += '<option value="' + x.p.id + '"' + (used ? ' disabled' : '') + '>#' + escapeHtml(x.p.name) + tag + dd + (used ? ' ✓' : '') + '</option>';
        });
        sel.innerHTML = opts; sel.value = _selKnownId || '';
    }

    function renderGps() {
        var g = document.getElementById('aghl-gps'); if (!g) return;
        if (!_selKnownId) { g.innerHTML = '<span class="aghl-dim">Vyber známý bod, na kterém stojíš.</span>'; return; }
        var a = currentAvg();
        if (a) g.innerHTML = 'Průměr appky: <b>' + a.lat.toFixed(6) + ', ' + a.lng.toFixed(6) + '</b> <span class="aghl-dim">(n=' + (a.n || '?') + (a.sig != null ? ' · ±' + a.sig.toFixed(2) + ' m' : '') + ')</span>';
        else if (haveUser()) g.innerHTML = '<span class="aghl-dim">Průměr appky zatím není — použij „Změřit GPS zde" (posbírá vzorky).</span>';
        else g.innerHTML = '<span class="aghl-dim">Čekám na GPS polohu…</span>';
    }

    // ---- sběr GPS vzorků na místě ---------------------------------------------
    function startCapture() {
        if (!_selKnownId) { agAlert('Vyber bod', 'Nejdřív vyber známý bod, na kterém stojíš.'); return; }
        if (!haveUser()) { agAlert('Není GPS', 'Počkej na zaměření GPS polohy.'); return; }
        if (_capTimer) return;
        _capSamples = []; _capAltSamples = []; _capT0 = 0;
        var bar = document.getElementById('aghl-capbar'); if (bar) bar.style.display = 'block';
        var btn = document.getElementById('aghl-measure'); if (btn) btn.disabled = true;
        _capTimer = setInterval(function () {
            if (haveUser()) { _capSamples.push({ lat: userLat, lng: userLng }); var al = curAlt(); if (al != null) _capAltSamples.push(al); }
            _capT0 += 400;
            var fill = document.getElementById('aghl-capfill'), txt = document.getElementById('aghl-captxt');
            if (fill) fill.style.width = Math.min(100, (_capT0 / _capDur) * 100) + '%';
            if (txt) txt.textContent = 'Měřím… ' + _capSamples.length + ' vzorků (' + Math.round(_capT0 / 1000) + ' s) — stůj klidně';
            if (_capT0 >= _capDur) finishCapture();
        }, 400);
    }
    function finishCapture() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        var bar = document.getElementById('aghl-capbar'); if (bar) bar.style.display = 'none';
        var btn = document.getElementById('aghl-measure'); if (btn) btn.disabled = false;
        var avg = robustMean(_capSamples, _capAltSamples);
        if (!avg) { toast('Nezachyceno — zkus znovu.'); return; }
        addPair(avg);
    }

    function useAppAvg() {
        if (!_selKnownId) { agAlert('Vyber bod', 'Nejdřív vyber známý bod.'); return; }
        var a = currentAvg();
        if (!a) { agAlert('Není průměr', 'Průměr GPS z appky zatím není hotový (stůj chvíli na místě), nebo použij „Změřit GPS zde".'); return; }
        addPair(a);
    }

    function addPair(avg) {
        var p = ptById(_selKnownId);
        if (!p) { agAlert('Bod zmizel', 'Vybraný bod už není v seznamu.'); return; }
        var sj = toSJTSK(p.lat, p.lng);
        if (!sj) { agAlert('Převod selhal', 'Nepodařilo se převést známý bod do S-JTSK (proj4 nedostupné).'); return; }
        // odeber případný starší pár na stejný bod
        _pairs = _pairs.filter(function (pr) { return pr.id !== p.id; });
        _pairs.push({
            id: p.id, name: p.name,
            knownLat: p.lat, knownLng: p.lng, knownY: sj.Y, knownX: sj.X,
            knownH: (isFinite(p.vyska) ? p.vyska : null),
            measLat: avg.lat, measLng: avg.lng, measAlt: (isFinite(avg.alt) ? avg.alt : null),
            measN: avg.n || null, measSig: (isFinite(avg.sig) ? avg.sig : null)
        });
        _selKnownId = null;
        recomputeAndRender();
        toast('Dvojice #' + p.name + ' přidána (' + _pairs.length + ' celkem).');
    }
    function removePair(id) { _pairs = _pairs.filter(function (pr) { return pr.id !== id; }); recomputeAndRender(); }

    function recomputeAndRender() {
        _model = buildModel();
        if (_model) { _model._on = true; saveModel(_model); }
        else { try { localStorage.setItem(lsKey(), JSON.stringify({ m: null, pairs: _pairs, on: false })); } catch (e) {} }
        fillSelect(); renderState(); renderList(); renderResult(); renderGps(); updateWarn();
    }

    function renderState() {
        var st = document.getElementById('aghl-state'); if (!st) return;
        var m = _activeModel();
        if (m) {
            st.className = 'aghl-state on';
            st.innerHTML = '<b>Lokalizace aktivní</b> · ' + m.n + ' bodů · posun/měřítko/rotace nastaveny'
                + (m.sigma0 != null ? ' · ±' + (m.sigma0 * 100).toFixed(0) + ' cm/bod' : '');
        } else if (_model) {
            st.className = 'aghl-state off';
            st.innerHTML = 'Lokalizace <b>vypnutá</b> (model uložen). Zapni tlačítkem níže nebo přidej bod.';
        } else {
            st.className = 'aghl-state none';
            st.innerHTML = 'Lokalizace zatím <b>nenastavena</b> — přidej alespoň 2 dvojice.';
        }
    }

    function renderList() {
        var box = document.getElementById('aghl-list'); if (!box) return;
        if (!_pairs.length) { box.innerHTML = '<div class="aghl-dim" style="padding:6px 2px;font-size:12.5px;">Zatím žádné dvojice. Vyber známý bod nahoře a změř na něm GPS.</div>'; return; }
        var resById = {};
        if (_model && _model.residuals) _model.residuals.forEach(function (r, i) { var pr = _pairs.filter(function (p) { return isFinite(p.measLat); })[i]; if (pr) resById[pr.id] = r; });
        var html = '';
        _pairs.forEach(function (pr) {
            var r = resById[pr.id];
            var col = r ? (r.r > 0.5 ? '#f87171' : (r.r > 0.15 ? '#fbbf24' : '#34d399')) : '#94a3b8';
            html += '<div class="aghl-row">'
                + '<span class="aghl-nm">#' + escapeHtml(pr.name) + '</span>'
                + '<span class="aghl-meta">' + (pr.measSig != null ? '±' + pr.measSig.toFixed(2) + ' m GPS' : (pr.measN ? 'n=' + pr.measN : '')) + '</span>'
                + '<span class="aghl-res" style="color:' + col + '">' + (r ? 'opr ' + (r.r * 100).toFixed(0) + ' cm' : '—') + '</span>'
                + '<button class="aghl-del" data-id="' + pr.id + '" title="Smazat dvojici">✕</button>'
                + '</div>';
        });
        box.innerHTML = html;
        box.querySelectorAll('.aghl-del').forEach(function (b) { b.addEventListener('click', function () { removePair(b.getAttribute('data-id')); }); });
    }

    function updateWarn() {
        var w = document.getElementById('aghl-warn'); if (!w) return;
        var msg = '';
        if (_pairs.length === 1) msg = 'Přidej ještě aspoň 1 bod — Helmert potřebuje 2+ dvojice (3+ dá i kontrolu přesnosti).';
        else if (_pairs.length === 2) msg = '2 body = transformace bez kontroly (nulová nadbytečnost). Pro rezidua a přesnost přidej 3. bod.';
        else if (_model && _model.geom && _model.geom.collinear) msg = '⚠ Referenční body leží skoro na přímce — rotace/měřítko jsou nespolehlivé. Rozmísti body do plochy (trojúhelník/čtverec kolem staveniště).';
        w.innerHTML = msg;
    }

    function renderResult() {
        var box = document.getElementById('aghl-result'), acts = document.getElementById('aghl-actions');
        if (!box) return;
        var m = _model;
        if (!m) { box.style.display = 'none'; if (acts) acts.style.display = 'none'; return; }
        var scalePpm = (m.scale - 1) * 1e6;
        var html = '<div class="aghl-big">Transformace spočítána (' + m.n + ' bodů)</div>'
            + '<div style="font-family:var(--font-mono,monospace);font-size:12.5px;margin:6px 0;line-height:1.6;">'
            + 'posun: <b>' + m.tx.toFixed(2) + ' m E · ' + m.ty.toFixed(2) + ' m N</b><br>'
            + 'rotace: <b>' + m.rot.toFixed(4) + '°</b> · měřítko: <b>' + m.scale.toFixed(6) + '</b> (' + (scalePpm >= 0 ? '+' : '') + scalePpm.toFixed(0) + ' ppm)</div>';
        if (m.sigma0 != null) {
            var col = m.sigma0 > 0.5 ? '#f87171' : (m.sigma0 > 0.15 ? '#fbbf24' : '#34d399');
            html += '<div style="font-size:12.5px;">Polohová přesnost: <b style="color:' + col + '">±' + (m.sigma0 * 100).toFixed(0) + ' cm</b> na bod'
                + (m.maxName ? ' · největší oprava <b>#' + escapeHtml(m.maxName) + '</b> (' + (m.maxRes * 100).toFixed(0) + ' cm)' : '') + '</div>';
        } else {
            html += '<div style="font-size:12.5px;opacity:.85;">2 body — bez kontroly přesnosti (nulová nadbytečnost).</div>';
        }
        if (m.heightPlane) {
            html += '<div style="font-size:12.5px;margin-top:4px;">Výškový trend: rovina z ' + m.heightPlane.n + ' výšek'
                + (m.heightPlane.rms != null ? ' · ±' + (m.heightPlane.rms * 100).toFixed(0) + ' cm' : '') + ' <span class="aghl-dim">(applyZ)</span></div>';
        } else if (_pairs.filter(function (p) { return isFinite(p.knownH) && isFinite(p.measAlt); }).length > 0) {
            html += '<div style="font-size:12px;opacity:.7;margin-top:4px;">Výškový trend potřebuje 3+ bodů s výškou (známou i GPS).</div>';
        }
        html += '<div style="font-size:11.5px;opacity:.65;margin-top:6px;line-height:1.4;">Orientační zpřesnění, ne přejímací měření. Body <b>uvnitř</b> obalového polygonu referencí jsou spolehlivější; mimo něj jde o extrapolaci.</div>';
        box.innerHTML = html; box.style.display = 'block';
        if (acts) acts.style.display = 'block';
        // AGPose origin: nabídni srovnání jen když je platný a GPS-odvozený
        var pb = document.getElementById('aghl-apply-pose');
        // #6: NEvyžaduj valid (to nastaví až tenhle úkon sám) — stačí, že AR nekotví resekcí (source 'gps') a je hotový model
        if (pb) { var showPose = !!(window.AGPose && window.AGPose.source === 'gps' && _activeModel()); pb.style.display = showPose ? 'block' : 'none'; }
    }

    function applyToPose() {
        try {
            if (!window.AGPose || !_activeModel()) return;   // #6: origin() vrátí fallback [userLat,userLng] i když ještě není valid
            var o = window.AGPose.origin(userLat, userLng);
            if (!o || o[0] == null) return;
            var c = _apply(o[0], o[1]);
            var extr = AGLocalize._lastExtrapolated;
            window.AGPose.set({
                originLat: c[0], originLng: c[1],
                originZ: (window.AGPose.originZ != null ? _applyZ(o[0], o[1], window.AGPose.originZ) : null),
                posSigma: (_model && _model.sigma0 != null) ? _model.sigma0 : window.AGPose.posSigma,
                eyeH: window.AGPose.eyeH, source: 'localized', note: 'Helmert lokalizace'
            });
            // #6 idempotence: source 'localized' → showPose (vyžaduje 'gps') zhasne, druhý klik nemožný (žádný dvojitý posun)
            try { renderResult(); } catch (e) {}
            agAlert('AR počátek srovnán', 'Počátek AR byl posunut Helmertovou lokalizací (' + (_model.n) + ' bodů).'
                + (extr ? '\n\n⚠ Počátek leží MIMO obalový polygon referenčních bodů — jde o extrapolaci, ber s rezervou.' : ''));
        } catch (e) { agAlert('Nelze aplikovat', 'Srovnání AR počátku selhalo.'); }
    }

    function doClear() {
        var go = function (ok) { if (!ok) return; _pairs = []; clearModel(); fillSelect(); renderState(); renderList(); renderResult(); renderGps(); updateWarn(); toast('Lokalizace smazána.'); };
        if (typeof window.agConfirm === 'function') window.agConfirm({ title: 'Smazat lokalizaci?', message: 'Smaže všechny dvojice i uloženou transformaci této zakázky.', okText: 'Smazat', danger: true }).then(go);
        else go(window.confirm('Smazat lokalizaci a všechny dvojice?'));
    }

    // ---- otevření/zavření -----------------------------------------------------
    var _liveTimer = null;
    function openTool() {
        ensureModal(); loadModel();
        fillSelect(); renderState(); renderList(); renderResult(); renderGps(); updateWarn();
        document.getElementById('aghl-modal').style.display = 'flex';
        if (!_liveTimer) _liveTimer = setInterval(function () {
            var mo = document.getElementById('aghl-modal');
            if (mo && mo.style.display === 'flex' && !_capTimer) renderGps();
        }, 1200);
    }
    window.agCloseLocalize = function () {
        var mo = document.getElementById('aghl-modal'); if (mo) mo.style.display = 'none';
        if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; var bar = document.getElementById('aghl-capbar'); if (bar) bar.style.display = 'none'; var btn = document.getElementById('aghl-measure'); if (btn) btn.disabled = false; }
    };
    window.agOpenLocalize = openTool;
    window.agOpenLocalizeHelmert = openTool;   // alias

    // ---- styly ----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('aghl-style')) return;
        var st = document.createElement('style'); st.id = 'aghl-style';
        st.textContent = [
            '#aghl-modal .aghl-fld{display:block;margin:6px 0;}',
            '#aghl-modal .aghl-fld>span{display:block;font-size:12px;opacity:.75;margin-bottom:3px;}',
            '#aghl-modal .aghl-fld select{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.05);color:var(--text-color,#e8edf2);font:600 14px/1.1 var(--font-ui,system-ui),sans-serif;}',
            '#aghl-modal .aghl-state{margin:6px 0;padding:8px 12px;border-radius:10px;font-size:12.5px;background:rgba(255,255,255,0.05);}',
            '#aghl-modal .aghl-state.on{background:rgba(47,158,116,0.16);outline:1px solid rgba(47,158,116,0.4);}',
            '#aghl-modal .aghl-state.off{background:rgba(251,191,36,0.12);}',
            '#aghl-modal .aghl-add{margin:8px 0;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.04);}',
            '#aghl-modal .aghl-gps{font-size:12.5px;margin:4px 2px 8px;line-height:1.5;}',
            '#aghl-modal .aghl-dim{opacity:.6;}',
            '#aghl-modal .aghl-addbtns{display:flex;gap:8px;flex-wrap:wrap;}',
            '#aghl-modal .aghl-addbtns .btn{width:auto;flex:1 1 auto;min-width:130px;margin:0;}',
            '#aghl-modal .aghl-capbar{position:relative;height:22px;margin-top:8px;border-radius:8px;background:rgba(255,255,255,0.08);overflow:hidden;}',
            '#aghl-modal #aghl-capfill{position:absolute;inset:0 auto 0 0;width:0;background:var(--accent,#2f9e74);opacity:.5;transition:width .3s linear;}',
            '#aghl-modal #aghl-captxt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:#fff;}',
            '#aghl-modal .aghl-list{margin:8px 0;max-height:30vh;overflow:auto;}',
            '#aghl-modal .aghl-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;background:rgba(255,255,255,0.05);margin-bottom:6px;}',
            '#aghl-modal .aghl-nm{font-weight:600;flex:1;}',
            '#aghl-modal .aghl-meta{font-family:var(--font-mono,monospace);font-size:11.5px;opacity:.7;white-space:nowrap;}',
            '#aghl-modal .aghl-res{font-family:var(--font-mono,monospace);font-size:12px;white-space:nowrap;}',
            '#aghl-modal .aghl-del{border:none;background:rgba(248,113,113,0.15);color:#f87171;width:26px;height:26px;border-radius:7px;cursor:pointer;flex:0 0 26px;font-size:13px;}',
            '#aghl-modal .aghl-result{margin:12px 0;padding:12px 14px;border-radius:10px;background:rgba(47,158,116,0.12);}',
            '#aghl-modal .aghl-big{font-size:15px;margin-bottom:2px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- registrace do launcheru + fallback tlačítko --------------------------
    function register() {
        try { loadModel(); } catch (e) {}
        injectStyles();
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'localization-helmert', label: 'Lokalizace (Helmert)', icon: ICON, cat: 'AR a kalibrace', onClick: openTool, order: 8 });
            var stale = document.getElementById('aghl-fab'); if (stale) stale.remove();
        } else {
            ensureFallbackFab();
        }
    }
    function ensureFallbackFab() {
        if (document.getElementById('aghl-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'aghl-fab'; b.type = 'button';
        b.title = 'Lokalizace (Helmert)'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:322px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#2f9e74);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        var svg = b.querySelector('svg'); if (svg) svg.style.cssText = 'width:24px;height:24px;';
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
