// ===== QTRIG — TRASA K BODU PODLE TERÉNU + VÝŠKOVÝ PROFIL (ODPOJITELNÁ, ag/lazy) ==========
// (17. 9. 2026, fáze 3 „chytrý terén" — B1 + B3; viz paměť project-vlastni-mapa-svet-vyber-16-9)
//
// Geodet nechodí po silnicích — jde přes pole, ale ne skrz dům, rybník nebo oplocený areál.
// Proto NE cizí routovací služba (zná jen cesty), ale vlastní výpočet v telefonu z dat
// vektorové mapy (A1) a ručních překážek (B2):
//   • kolem mě a cíle (okraj 40 m, nejvýš ~1,5 km) mřížka 2 m (delší trasy 3–4 m),
//   • cena políčka: cesta/silnice 1,0 · louka 1,3 · pole 1,6 · křoví 2,5 · les 3 · areál
//     (průmysl, dráha, lom, vojsko) 4 · koleje 6 (přejít jde, ale draze) · budova, voda,
//     dálnice, ruční překážka = neprůchodné; silnice se kreslí až po vodě → most je průchozí,
//   • A* (8 sousedů, binární halda) najde nejlevnější průchod → lomená čára (RDP 1,5 m).
// Výsledek: v mapě čára po trase místo přímky (js/cil-navigace.js), páska i šipka v AR
// vedou na NEJBLIŽŠÍ LOM (ne na cíl), vzdálenost = délka trasy. Když zboudím > 15 m od trasy,
// přepočet. Bez vektorové mapy (nebo když A* nic nenajde) zůstává přímka jako dřív.
//
// PROFIL (B3): výšky z výškových dlaždic (AWS Terrarium, celý svět; v ČR SRTM ~30 m) po 10 m
// podél trasy → stoupání ↑ / klesání ↓ / nejstrmější úsek; v popisku trasy v mapě a klepnutím
// na trasu graf. Vstřikovatelné AGTrasa.vyskaFn (testy, DMR).
// Nastavení → AR & přesnost → „Navigace k bodu podle terénu". Odstranění: smaž
// js/trasa-terenem.js + <script> v index.html + tři háčky (cil-navigace.js, grafika.js: AGTrasa).
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGTrasa) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'trasa-terenem:' + kde); } catch (e2) { /* nic */ } };
    var KEY = 'agTrasa_v1';
    var st = { zap: true };
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.zap != null) st.zap = !!s.zap; } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }

    var CENA = { open: 1.5, cesta: 1.0, louka: 1.3, pole: 1.6, krovi: 2.5, les: 3.0, areal: 4.0, koleje: 6.0, potok: 4.0 };
    var NEPRUCHOD = 255, OKRAJ = 40, MAX_STRANA = 1500, MAX_BUNEK = 420 * 420;
    var LES = ['forest', 'wood'], KROVI = ['scrub', 'heath'], LOUKA = ['grassland', 'grass', 'meadow', 'park', 'garden', 'village_green', 'recreation_ground', 'cemetery', 'golf_course', 'pitch', 'playground'], POLE = ['farmland', 'orchard', 'vineyard', 'allotments', 'farmyard'], AREAL = ['industrial', 'railway', 'quarry', 'military', 'aerodrome', 'landfill', 'naval_base'];

    var trasa = null;      // { id, body:[{lat,lng}], delka, ts, profil, lomy }
    var _grp = null, _tik = null, _posledniCil = null, _pocitam = false;
    function poloha() { try { return (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng } : null; } catch (e) { return null; } }
    function cil() { try { var id = (typeof highlightedPointId !== 'undefined') ? highlightedPointId : null; if (!id) return null; var p = (arPoints || []).find(function (q) { return q.id === id; }); return p ? { id: id, lat: p.lat, lng: p.lng, name: p.name } : null; } catch (e) { return null; } }
    function dist(a, b) { return AGHrany.dist(a, b); }
    function bearing(a, b) { try { return GeoCore.getBearing(a.lat, a.lng, b.lat, b.lng); } catch (e) { return 0; } }

    // ---- rastr cen -----------------------------------------------------------------------------
    function rastr(od, kam) {
        var m = AGHrany.mPerDeg((od.lat + kam.lat) / 2);
        var s = Math.min(od.lat, kam.lat) - OKRAJ / m.lat, n = Math.max(od.lat, kam.lat) + OKRAJ / m.lat;
        var w = Math.min(od.lng, kam.lng) - OKRAJ / m.lng, e = Math.max(od.lng, kam.lng) + OKRAJ / m.lng;
        var sirka = (e - w) * m.lng, vyska = (n - s) * m.lat;
        if (Math.max(sirka, vyska) > MAX_STRANA + 2 * OKRAJ) return null;
        var bunka = 2; while ((sirka / bunka) * (vyska / bunka) > MAX_BUNEK) bunka += 1;
        var W = Math.ceil(sirka / bunka), H = Math.ceil(vyska / bunka);
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        var ctx = cv.getContext('2d', { willReadFrequently: true });
        function px(p) { return { x: (p.lng - w) * m.lng / bunka, y: (n - p.lat) * m.lat / bunka }; }
        function barva(c) { return 'rgb(' + (c === NEPRUCHOD ? 255 : Math.min(254, Math.round(c * 10))) + ',0,0)'; }
        function plocha(rings, c) { ctx.fillStyle = barva(c); ctx.beginPath(); rings.forEach(function (ring) { ring.forEach(function (q, i) { var p = px(q); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); }); ctx.fill('evenodd'); }
        function cara(line, c, sirkaM) { ctx.strokeStyle = barva(c); ctx.lineWidth = Math.max(1, sirkaM / bunka); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); line.forEach(function (q, i) { var p = px(q); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
        ctx.fillStyle = barva(CENA.open); ctx.fillRect(0, 0, W, H);
        var MV = window.AGMapaVektor;
        try {
            // po druzích, dražší přes levnější (les přes louku)
            [[POLE, CENA.pole], [LOUKA, CENA.louka], [KROVI, CENA.krovi], [LES, CENA.les], [AREAL, CENA.areal]].forEach(function (d) {
                MV.plochy(['landcover', 'landuse'], d[0]).forEach(function (rings) { plocha(rings, d[1]); });
            });
        } catch (e) { swallow(e, 'plochy'); }
        try {
            var mv = MV.mapa(), vody = [];
            if (mv && mv.isStyleLoaded()) vody = mv.querySourceFeatures('pm', { sourceLayer: 'water' }) || [];
            vody.forEach(function (f) {
                var g = f.geometry; if (!g) return;
                if (g.type === 'Polygon' || g.type === 'MultiPolygon') { var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; polys.forEach(function (poly) { plocha(poly.map(function (r) { return r.map(function (c) { return { lat: c[1], lng: c[0] }; }); }), NEPRUCHOD); }); }
                else if (g.type === 'LineString' || g.type === 'MultiLineString') { var ls = g.type === 'LineString' ? [g.coordinates] : g.coordinates; var kind = f.properties && f.properties.kind; ls.forEach(function (l) { cara(l.map(function (c) { return { lat: c[1], lng: c[0] }; }), kind === 'stream' || kind === 'ditch' ? CENA.potok : NEPRUCHOD, kind === 'river' ? 8 : 3); }); }
            });
        } catch (e) { swallow(e, 'voda'); }
        try { AGHrany.budovyPolygony((s + n) / 2, (w + e) / 2, Math.max(sirka, vyska)).forEach(function (b) { plocha(b.rings, NEPRUCHOD); }); } catch (e) { swallow(e, 'budovy'); }
        try { if (window.AGOkoli) AGOkoli.prekazky().forEach(function (p) { plocha(AGOkoli.prekazkaRings(p), NEPRUCHOD); }); } catch (e) { swallow(e, 'prekazky'); }
        try {
            MV.cary('roads').forEach(function (l) {
                var k = l.vlastnosti.kind;
                if (k === 'highway') cara(l, NEPRUCHOD, 12);
                else if (k === 'rail') cara(l, CENA.koleje, 4);
                else if (k === 'ferry' || k === 'aerialway') return;
                else cara(l, CENA.cesta, k === 'path' ? 3 : 7);
            });
        } catch (e) { swallow(e, 'silnice'); }
        var data = ctx.getImageData(0, 0, W, H).data, cost = new Float32Array(W * H);
        for (var i = 0; i < W * H; i++) { var r = data[i * 4]; cost[i] = r >= 255 ? Infinity : Math.max(0.5, r / 10); }
        return { cost: cost, W: W, H: H, bunka: bunka, w: w, n: n, m: m, px: function (p) { return { x: Math.min(W - 1, Math.max(0, Math.floor((p.lng - w) * m.lng / bunka))), y: Math.min(H - 1, Math.max(0, Math.floor((n - p.lat) * m.lat / bunka))) }; }, ll: function (x, y) { return { lat: n - (y + 0.5) * bunka / m.lat, lng: w + (x + 0.5) * bunka / m.lng }; } };
    }
    // ---- A* ---------------------------------------------------------------------------------------
    function hledej(r, od, kam) {
        var W = r.W, H = r.H, N = W * H, start = r.px(od), cilPx = r.px(kam);
        var si = start.y * W + start.x, ci = cilPx.y * W + cilPx.x;
        // start/cíl uvnitř neprůchodného (stojím u zdi, cíl je roh budovy) → políčko uvolnit
        r.cost[si] = Math.min(r.cost[si], 1); r.cost[ci] = Math.min(r.cost[ci], 1);
        var g = new Float32Array(N); for (var i = 0; i < N; i++) g[i] = Infinity;
        var prev = new Int32Array(N); prev.fill(-1);
        var zavr = new Uint8Array(N);
        var heap = [], hk = [];   // binární halda: hk = f, heap = index
        function push(f, idx) { heap.push(idx); hk.push(f); var i = hk.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; var t = hk[p]; hk[p] = hk[i]; hk[i] = t; var u = heap[p]; heap[p] = heap[i]; heap[i] = u; i = p; } }
        function pop() { var top = heap[0]; var lf = hk.pop(), li = heap.pop(); if (hk.length) { hk[0] = lf; heap[0] = li; var i = 0, n = hk.length; for (;;) { var l = 2 * i + 1, rr = l + 1, mn = i; if (l < n && hk[l] < hk[mn]) mn = l; if (rr < n && hk[rr] < hk[mn]) mn = rr; if (mn === i) break; var t = hk[mn]; hk[mn] = hk[i]; hk[i] = t; var u = heap[mn]; heap[mn] = heap[i]; heap[i] = u; i = mn; } } return top; }
        var minC = 0.9, b = r.bunka;
        function h(idx) { var x = idx % W, y = (idx - x) / W; return Math.hypot(x - cilPx.x, y - cilPx.y) * b * minC; }
        g[si] = 0; push(h(si), si);
        var DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1], DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
        var kroku = 0;
        while (hk.length) {
            var cur = pop(); if (zavr[cur]) continue; zavr[cur] = 1;
            if (cur === ci) break;
            if (++kroku > 2000000) return null;
            var cx = cur % W, cy = (cur - cx) / W, gc = g[cur], cc = r.cost[cur];
            for (var k = 0; k < 8; k++) {
                var nx = cx + DX[k], ny = cy + DY[k]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                var ni = ny * W + nx; if (zavr[ni]) continue;
                var nc = r.cost[ni]; if (!isFinite(nc)) continue;
                if (k >= 4 && (!isFinite(r.cost[cy * W + nx]) || !isFinite(r.cost[ny * W + cx]))) continue;   // neřezat rohy budov
                var ng = gc + DL[k] * b * (cc + nc) / 2;
                if (ng < g[ni]) { g[ni] = ng; prev[ni] = cur; push(ng + h(ni), ni); }
            }
        }
        if (!isFinite(g[ci])) return null;
        var cesta = [], at = ci; while (at >= 0) { cesta.push(at); at = prev[at]; }
        cesta.reverse();
        var body = cesta.map(function (idx) { var x = idx % W; return r.ll(x, (idx - x) / W); });
        body[0] = { lat: od.lat, lng: od.lng }; body[body.length - 1] = { lat: kam.lat, lng: kam.lng };
        return { body: zjednodus(body, 1.5), cena: g[ci] };
    }
    // Ramer–Douglas–Peucker v metrech
    function zjednodus(pts, tol) {
        if (pts.length < 3) return pts;
        var m = AGHrany.mPerDeg(pts[0].lat);
        function d(p, a, b) { var q = AGHrany.prumet(a, b, p); return q ? q.d : 0; }
        function rdp(i, j, out) {
            var maxD = 0, k = -1;
            for (var t = i + 1; t < j; t++) { var dd = d(pts[t], pts[i], pts[j]); if (dd > maxD) { maxD = dd; k = t; } }
            if (maxD > tol && k > 0) { rdp(i, k, out); rdp(k, j, out); } else out.push(pts[j]);
        }
        var out = [pts[0]]; rdp(0, pts.length - 1, out); void m; return out;
    }
    function delka(body) { var d = 0; for (var i = 1; i < body.length; i++) d += dist(body[i - 1], body[i]); return d; }

    // ---- profil (B3) ---------------------------------------------------------------------------
    var TEREN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', Z = 14, _dl = {};
    function dlazdice(z, x, y) {
        var k = z + '/' + x + '/' + y; if (_dl[k]) return _dl[k];
        _dl[k] = new Promise(function (res, rej) {
            var img = new Image(); img.crossOrigin = 'anonymous';
            img.onload = function () { try { var cv = document.createElement('canvas'); cv.width = cv.height = 256; var c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0); res(c.getImageData(0, 0, 256, 256).data); } catch (e) { rej(e); } };
            img.onerror = function () { rej(new Error('teren ' + k)); };
            img.src = TEREN.replace('{z}', z).replace('{x}', x).replace('{y}', y);
        }).catch(function (e) { delete _dl[k]; throw e; });
        return _dl[k];
    }
    function vyskaTerrarium(lat, lng) {
        var n = Math.pow(2, Z), xf = (lng + 180) / 360 * n, latR = lat * Math.PI / 180, yf = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
        var x = Math.floor(xf), y = Math.floor(yf), px = Math.floor((xf - x) * 256), py = Math.floor((yf - y) * 256);
        return dlazdice(Z, x, y).then(function (d) { var i = (py * 256 + px) * 4; return (d[i] * 256 + d[i + 1] + d[i + 2] / 256) - 32768; });
    }
    function profil(body) {
        var L = delka(body), krok = L > 2000 ? 25 : 10, vz = [];
        for (var s = 0; s <= L; s += krok) { var acc = 0, pos = null; for (var i = 1; i < body.length && !pos; i++) { var d = dist(body[i - 1], body[i]); if (acc + d >= s) { var t = d ? (s - acc) / d : 0; pos = { s: s, lat: body[i - 1].lat + (body[i].lat - body[i - 1].lat) * t, lng: body[i - 1].lng + (body[i].lng - body[i - 1].lng) * t }; } acc += d; } if (pos) vz.push(pos); }
        var fn = (typeof AGTrasa.vyskaFn === 'function') ? function (p) { return Promise.resolve(AGTrasa.vyskaFn(p.lat, p.lng)); } : function (p) { return vyskaTerrarium(p.lat, p.lng); };
        return Promise.all(vz.map(fn)).then(function (h) {
            var up = 0, down = 0, maxSklon = 0, maxKde = 0;
            for (var i = 1; i < h.length; i++) { var dh = h[i] - h[i - 1]; if (dh > 0) up += dh; else down -= dh; var sk = Math.abs(dh) / (vz[i].s - vz[i - 1].s) * 100; if (sk > maxSklon) { maxSklon = sk; maxKde = vz[i].s; } }
            return { s: vz.map(function (p) { return p.s; }), h: h, up: up, down: down, maxSklon: maxSklon, maxKde: maxKde, min: Math.min.apply(null, h), max: Math.max.apply(null, h) };
        });
    }
    function svgProfil(p) {
        if (!p || !p.h.length) return '';
        var W = 300, H = 110, mL = 34, mB = 18, hmin = Math.floor(p.min) - 1, hmax = Math.ceil(p.max) + 1, L = p.s[p.s.length - 1] || 1;
        function X(s) { return mL + s / L * (W - mL - 6); } function Y(h) { return 6 + (hmax - h) / (hmax - hmin) * (H - mB - 6); }
        var d = 'M' + X(p.s[0]) + ',' + Y(p.h[0]); for (var i = 1; i < p.h.length; i++) d += 'L' + X(p.s[i]) + ',' + Y(p.h[i]);
        var area = d + 'L' + X(L) + ',' + (H - mB) + 'L' + X(0) + ',' + (H - mB) + 'Z';
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" style="display:block;max-width:100%"><path d="' + area + '" fill="rgba(251,191,36,.25)"/><path d="' + d + '" fill="none" stroke="#fbbf24" stroke-width="2"/>'
            + '<text x="2" y="12" font-size="10" fill="currentColor">' + hmax + ' m</text><text x="2" y="' + (H - mB) + '" font-size="10" fill="currentColor">' + hmin + ' m</text>'
            + '<text x="' + X(L) + '" y="' + (H - 4) + '" font-size="10" text-anchor="end" fill="currentColor">' + Math.round(L) + ' m</text></svg>';
    }
    function popisekProfilu(p) { return p ? ('↑' + Math.round(p.up) + ' ↓' + Math.round(p.down) + ' m' + (p.maxSklon >= 8 ? ' · sklon ' + Math.round(p.maxSklon) + ' %' : '')) : ''; }

    // ---- řízení -----------------------------------------------------------------------------------
    function pripraveno() { return !!(st.zap && window.AGMapaVektor && AGMapaVektor.stav() === 'zapnuto' && window.AGHrany && AGMapaVektor.mapa() && AGMapaVektor.mapa().isStyleLoaded()); }
    function spocitej(od, c) {
        var r = rastr(od, c); if (!r) return null;
        var v = hledej(r, od, c); if (!v || v.body.length < 2) return null;
        return { id: c.id, name: c.name, body: v.body, delka: delka(v.body), bunka: r.bunka, ts: Date.now(), profil: null, od: od };
    }
    function prepocitej(duvod) {
        var me = poloha(), c = cil();
        if (!me || !c || !pripraveno()) { if (trasa) { trasa = null; kresli(); } return null; }
        if (_pocitam) return trasa; _pocitam = true;
        try {
            var t0 = Date.now(), t = spocitej(me, c);
            if (t) {
                t.ms = Date.now() - t0; t.duvod = duvod; trasa = t; kresli();
                // profil potřebuje výškové dlaždice ze sítě — bez signálu prostě není (žádná chyba pro uživatele)
                profil(t.body).then(function (p) { if (trasa === t) { t.profil = p; kresli(); } }).catch(function () { if (trasa === t) t.profilChyba = true; });
            }
            else { trasa = null; kresli(); }
        } catch (e) { swallow(e, 'prepocitej'); trasa = null; } finally { _pocitam = false; }
        return trasa;
    }
    // vzdálenost ode mě k trase + index nejbližšího úseku
    function kTrase(me) {
        if (!trasa) return null; var best = null;
        for (var i = 1; i < trasa.body.length; i++) { var q = AGHrany.prumet(trasa.body[i - 1], trasa.body[i], me); if (q && (!best || q.d < best.d)) best = { d: q.d, i: i, t: q.t, bod: q.bod }; }
        return best;
    }
    function dalsiLom(me) {
        var k = kTrase(me); if (!k) return null;
        // další lom = konec nejbližšího úseku; když jsem u něj (< 6 m), vezmi ten za ním
        var i = k.i; while (i < trasa.body.length - 1 && dist(me, trasa.body[i]) < 6) i++;
        return { bod: trasa.body[i], i: i, zbyva: dist(me, trasa.body[i]) + delka(trasa.body.slice(i)) };
    }
    function tik() {
        try {
            var c = cil();
            if (!c) { if (trasa) { trasa = null; kresli(); } _posledniCil = null; return; }
            var me = poloha(); if (!me) return;
            var klic = c.id + '|' + c.lat.toFixed(6) + '|' + c.lng.toFixed(6);
            if (klic !== _posledniCil) { _posledniCil = klic; prepocitej('cíl'); return; }
            if (!trasa) { if (pripraveno() && Date.now() - (tik._posl || 0) > 5000) { tik._posl = Date.now(); prepocitej('znovu'); } return; }
            var k = kTrase(me); if (k && k.d > 15) prepocitej('zbloudění');
        } catch (e) { swallow(e, 'tik'); }
    }
    function kresli() {
        try {
            var m = (typeof map !== 'undefined') ? map : null; if (!m) return;
            if (!_grp) _grp = L.layerGroup().addTo(m);
            _grp.clearLayers();
            if (!trasa) return;
            var pl = L.polyline(trasa.body.map(function (q) { return [q.lat, q.lng]; }), { color: '#fbbf24', weight: 4, opacity: 0.95, lineJoin: 'round', interactive: true, bubblingMouseEvents: false, pane: 'overlayPane' });
            pl.bindPopup(function () { var p = trasa && trasa.profil; return '<b>Trasa k ' + (window.AG && AG.esc ? AG.esc(String(trasa.name)) : trasa.name) + '</b><br>' + Math.round(trasa.delka) + ' m po terénu' + (p ? ' · ' + popisekProfilu(p) : (trasa.profilChyba ? ' · profil bez signálu' : ' · profil se načítá…')) + (p ? '<div style="margin-top:6px">' + svgProfil(p) + '</div>' : '') + '<small>obchází budovy, vodu, dálnice a překážky; ' + trasa.ms + ' ms, mřížka ' + trasa.bunka + ' m</small>'; }, { maxWidth: 320 });
            pl.addTo(_grp);
            trasa.body.slice(1, -1).forEach(function (q) { L.circleMarker([q.lat, q.lng], { radius: 3, color: '#fbbf24', fillColor: '#1b2420', fillOpacity: 1, weight: 2, interactive: false }).addTo(_grp); });
        } catch (e) { swallow(e, 'kresli'); }
    }

    // ---- API pro navigaci (cil-navigace.js, grafika.js) ---------------------------------------
    function aktivni(id) { return !!(trasa && st.zap && (id == null || trasa.id === id)); }
    function smer() { var me = poloha(); var l = me && dalsiLom(me); return l ? bearing(me, l.bod) : null; }
    function zbyva() { var me = poloha(); var l = me && dalsiLom(me); return l ? l.zbyva : (trasa ? trasa.delka : null); }
    function popisek() { var d = zbyva(); if (d == null) return ''; return (d >= 1000 ? (d / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(d) + ' m') + (trasa && trasa.profil ? ' · ' + popisekProfilu(trasa.profil) : ''); }

    function ui() {
        if (document.getElementById('s-trasa')) return;
        var tab = document.getElementById('tab-ar'); if (!tab) return;
        var hs = tab.querySelectorAll('.set-h'), kotva = null;
        for (var i = 0; i < hs.length; i++) if (/Kompas/.test(hs[i].textContent)) { kotva = hs[i]; break; }
        var r = document.createElement('div'); r.className = 'st-row';
        r.innerHTML = '<span class="st-lab">Navigace k bodu podle terénu<small>místo přímky trasa, která obejde budovy, vodu, dálnice a překážky; šipka vede na další lom, k tomu převýšení</small></span><label class="st-sw"><input type="checkbox" id="s-trasa"' + (st.zap ? ' checked' : '') + '><span class="st-sw-face"></span></label>';
        if (kotva) tab.insertBefore(r, kotva); else tab.appendChild(r);
        r.querySelector('input').addEventListener('change', function (ev) { st.zap = !!ev.target.checked; uloz(); if (!st.zap) { trasa = null; kresli(); } else prepocitej('zapnuto'); });
    }
    function start() {
        try { ui(); } catch (e) { swallow(e, 'ui'); }
        document.addEventListener('click', function (ev) { try { if (ev.target && ev.target.closest && ev.target.closest('#settings-btn, [data-open="settings"]')) setTimeout(ui, 50); } catch (e) { /* nic */ } }, true);
        document.addEventListener('ag:prekazky', function () { if (trasa) prepocitej('překážka'); });
        if (!_tik) _tik = setInterval(tik, 1000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.AGTrasa = { aktivni: aktivni, smer: smer, zbyva: zbyva, popisek: popisek, body: function () { return trasa ? trasa.body : null; }, trasa: function () { return trasa; }, prepocitej: prepocitej, spocitej: spocitej, rastr: rastr, hledej: hledej, profil: profil, svgProfil: svgProfil, dalsiLom: dalsiLom, nastav: function (o) { if (o && o.zap != null) st.zap = !!o.zap; uloz(); }, zapnuto: function () { return st.zap; }, vyskaFn: null, CENA: CENA };
})();
