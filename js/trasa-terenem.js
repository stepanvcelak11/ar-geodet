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

    var CENA = { open: 1.5, cesta: 1.0, stred: 0.7, louka: 1.3, pole: 1.6, krovi: 2.5, les: 3.0, areal: 4.0, koleje: 6.0, potok: 4.0 };
    var NEPRUCHOD = 255, OKRAJ = 40, MAX_STRANA = 3000, MAX_BUNEK = 480 * 480;   // do 3 km (mřížka pak až ~6 m); dál přímka
    var LES = ['forest', 'wood'], KROVI = ['scrub', 'heath'], LOUKA = ['grassland', 'grass', 'meadow', 'park', 'garden', 'village_green', 'recreation_ground', 'cemetery', 'golf_course', 'pitch', 'playground'], POLE = ['farmland', 'orchard', 'vineyard', 'allotments', 'farmyard'], AREAL = ['industrial', 'railway', 'quarry', 'military', 'aerodrome', 'landfill', 'naval_base'];

    var trasa = null;      // { id, body:[{lat,lng}], delka, ts, profil, lomy }
    var _grp = null, _tik = null, _posledniCil = null, _pocitam = false;
    function poloha() { try { return (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng } : null; } catch (e) { return null; } }
    function cil() { try { var id = (typeof highlightedPointId !== 'undefined') ? highlightedPointId : null; if (!id) return null; var p = (arPoints || []).find(function (q) { return q.id === id; }); return p ? { id: id, lat: p.lat, lng: p.lng, name: p.name } : null; } catch (e) { return null; } }
    function dist(a, b) { return AGHrany.dist(a, b); }
    function bearing(a, b) { try { return GeoCore.getBearing(a.lat, a.lng, b.lat, b.lng); } catch (e) { return 0; } }

    // ---- data: dlaždice PMTiles (js/mapa-data.js) pro CELÝ obdélník trasy, ne jen výřez mapy -----
    // ⚠⚠ OPRAVA 17. 9. 2026 („navigace mě vede zdmi domů"): querySourceFeatures vrací jen dlaždice
    //   načtené pro výřez hlavní mapy — oddálená mapa (z < 14) nebo cíl mimo obrazovku = žádné
    //   budovy v rastru = trasa skrz domy. Teď se data berou z dlaždic z15 pro obdélník trasy;
    //   než dojedou, počítá se ze starých dat výřezu (zdroj 'výřez') a po dojetí se přepočítá.
    var _dataFronta = {};
    function data(bbox) {
        var MD = window.AGMapaData, hned = null;
        try { if (MD) hned = MD.oblastHned(bbox); } catch (e) { swallow(e, 'oblastHned'); }
        if (hned) return { zdroj: 'dlaždice', t: hned };
        if (MD) {
            var k = [bbox.s.toFixed(4), bbox.w.toFixed(4), bbox.n.toFixed(4), bbox.e.toFixed(4)].join('|');
            if (!_dataFronta[k]) { _dataFronta[k] = true; MD.oblast(bbox).then(function () { delete _dataFronta[k]; prepocitej('data'); }).catch(function () { delete _dataFronta[k]; }); }
        }
        return { zdroj: 'výřez', t: null };
    }
    function ll(c) { return { lat: c[1], lng: c[0] }; }
    // ---- rastr cen -----------------------------------------------------------------------------
    function rastr(od, kam) {
        var m = AGHrany.mPerDeg((od.lat + kam.lat) / 2);
        var s = Math.min(od.lat, kam.lat) - OKRAJ / m.lat, n = Math.max(od.lat, kam.lat) + OKRAJ / m.lat;
        var w = Math.min(od.lng, kam.lng) - OKRAJ / m.lng, e = Math.max(od.lng, kam.lng) + OKRAJ / m.lng;
        var sirka = (e - w) * m.lng, vyska = (n - s) * m.lat;
        if (Math.max(sirka, vyska) > MAX_STRANA + 2 * OKRAJ) return null;
        // mřížka 1 m, dokud se vejde do rozpočtu buněk (do ~400 m trasy) — na cestě 3 m široké
        // je pak rozdíl mezi „po cestě" a „metr vedle" vidět
        var bunka = 1; while ((sirka / bunka) * (vyska / bunka) > MAX_BUNEK) bunka += 1;
        var W = Math.ceil(sirka / bunka), H = Math.ceil(vyska / bunka);
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        var ctx = cv.getContext('2d', { willReadFrequently: true });
        function px(p) { return { x: (p.lng - w) * m.lng / bunka, y: (n - p.lat) * m.lat / bunka }; }
        function barva(c) { return 'rgb(' + (c === NEPRUCHOD ? 255 : Math.min(254, Math.round(c * 10))) + ',0,0)'; }
        function cestaPath(rings) { ctx.beginPath(); rings.forEach(function (ring) { ring.forEach(function (q, i) { var p = px(q); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); }); }
        function plocha(rings, c) { ctx.fillStyle = barva(c); cestaPath(rings); ctx.fill('evenodd'); }
        // budova = neprůchodná PLUS lem 1 m kolem (GPS šum + „u zdi se nechodí") — trasa drží odstup
        var budovy = [];
        function budova(rings) { budovy.push(rings); plocha(rings, NEPRUCHOD); ctx.strokeStyle = barva(NEPRUCHOD); ctx.lineWidth = Math.max(1, 2 / bunka); ctx.lineJoin = 'round'; cestaPath(rings); ctx.stroke(); }
        function cara(line, c, sirkaM) { ctx.strokeStyle = barva(c); ctx.lineWidth = Math.max(1, sirkaM / bunka); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); line.forEach(function (q, i) { var p = px(q); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
        ctx.fillStyle = barva(CENA.open); ctx.fillRect(0, 0, W, H);
        var bbox = { s: s, w: w, n: n, e: e }, D = data(bbox), T = D.t, MV = window.AGMapaVektor, silnice = [], vchody = [];
        // bez dlaždic a bez vektorové mapy na obrazovce není z čeho počítat — počkat na data (tik zkouší
        // po 5 s, dojetí dlaždic spustí přepočet samo), ne kreslit „trasu" přes prázdný rastr
        if (!T && !mapaNaObrazovce()) { _rastrDuvod = window.AGMapaData ? 'data mapy se stahují (bez signálu to nejde)' : 'data mapy nejsou k dispozici'; return null; }
        if (T) {
            // z dlaždic: plochy (po druzích, dražší přes levnější), voda, budovy, silnice
            try {
                [[POLE, CENA.pole], [LOUKA, CENA.louka], [KROVI, CENA.krovi], [LES, CENA.les], [AREAL, CENA.areal]].forEach(function (d) {
                    T.landcover.concat(T.landuse).forEach(function (f) { if (f.geom === 'Polygon' && d[0].indexOf(f.props.kind) >= 0) f.polys.forEach(function (rings) { plocha(rings, d[1]); }); });
                });
            } catch (e2) { swallow(e2, 'plochy'); }
            try {
                T.water.forEach(function (f) {
                    if (f.geom === 'Polygon') f.polys.forEach(function (rings) { plocha(rings, NEPRUCHOD); });
                    else if (f.geom === 'LineString') { var kind = f.props.kind; f.lines.forEach(function (l) { cara(l, kind === 'stream' || kind === 'ditch' ? CENA.potok : NEPRUCHOD, kind === 'river' ? 8 : 3); }); }
                });
            } catch (e3) { swallow(e3, 'voda'); }
            try { T.buildings.forEach(function (f) { if (f.geom === 'Polygon') f.polys.forEach(budova); }); } catch (e4) { swallow(e4, 'budovy'); }
            try { T.roads.forEach(function (f) { if (f.geom === 'LineString') f.lines.forEach(function (l) { l.vlastnosti = f.props; silnice.push(l); }); }); } catch (e5) { swallow(e5, 'silnice'); }
            // vchody z OSM (pokud je základní mapa nese): kind 'entrance', únikové (emergency) NE
            try { (T.pois || []).forEach(function (f) { if (f.geom === 'Point' && f.props.kind === 'entrance' && f.props.kind_detail !== 'emergency' && f.props.kind_detail !== 'exit') f.pts.forEach(function (q) { vchody.push(q); }); }); } catch (e6) { swallow(e6, 'vchody'); }
        } else {
            // náhrada: to, co má mapa zrovna načtené (jen výřez) — přepočet přijde, až dojedou dlaždice
            try {
                [[POLE, CENA.pole], [LOUKA, CENA.louka], [KROVI, CENA.krovi], [LES, CENA.les], [AREAL, CENA.areal]].forEach(function (d) {
                    MV.plochy(['landcover', 'landuse'], d[0]).forEach(function (rings) { plocha(rings, d[1]); });
                });
            } catch (e) { swallow(e, 'plochy'); }
            try {
                var mv = MV.mapa(), vody = [];
                if (mv && mv.isStyleLoaded()) vody = mv.querySourceFeatures('pm', { sourceLayer: 'water' }) || [];
                vody.forEach(function (f) {
                    var g = f.geometry; if (!g) return;
                    if (g.type === 'Polygon' || g.type === 'MultiPolygon') { var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; polys.forEach(function (poly) { plocha(poly.map(function (r) { return r.map(ll); }), NEPRUCHOD); }); }
                    else if (g.type === 'LineString' || g.type === 'MultiLineString') { var ls = g.type === 'LineString' ? [g.coordinates] : g.coordinates; var kind = f.properties && f.properties.kind; ls.forEach(function (l) { cara(l.map(ll), kind === 'stream' || kind === 'ditch' ? CENA.potok : NEPRUCHOD, kind === 'river' ? 8 : 3); }); }
                });
            } catch (e) { swallow(e, 'voda'); }
            try { AGHrany.budovyPolygony((s + n) / 2, (w + e) / 2, Math.max(sirka, vyska)).forEach(function (b) { budova(b.rings); }); } catch (e) { swallow(e, 'budovy'); }
            try { silnice = MV.cary('roads'); } catch (e) { swallow(e, 'silnice'); }
        }
        // silnice a cesty: celá šířka za cenu cesty, OSA o třetinu levnější → A* drží střed, ne krajnici
        var osy = [];
        try {
            silnice.forEach(function (l) {
                var k = l.vlastnosti.kind, kd = l.vlastnosti.kind_detail;
                // metro, železniční tunely a dlouhé silniční tunely jsou POD zemí — v rastru by přepsaly budovy
                // a otevřely průchod skrz dům. PODCHODY A PRŮCHODY DOMEM (path / minor_road s is_tunnel) se
                // NECHÁVAJÍ — je to normální veřejná cesta (uživatel 17. 9. 2026).
                if (k === 'rail' && (kd === 'subway' || kd === 'light_rail' || l.vlastnosti.is_tunnel)) return;
                if ((k === 'major_road' || k === 'highway') && l.vlastnosti.is_tunnel) return;
                if (k === 'highway') { cara(l, NEPRUCHOD, 12); return; }
                if (k === 'rail') { cara(l, CENA.koleje, 4); return; }
                if (k === 'ferry' || k === 'aerialway') return;
                var sir = k === 'path' ? 3 : 7;
                cara(l, CENA.cesta, sir); osy.push({ l: l, sir: sir });
            });
            osy.forEach(function (o) { cara(o.l, CENA.stred, bunka); });
        } catch (e) { swallow(e, 'silnice'); }
        // ruční překážky AŽ NAKONEC — výkop nebo hromada na cestě tu cestu zavírá
        try { if (window.AGOkoli) AGOkoli.prekazky().forEach(function (p) { plocha(AGOkoli.prekazkaRings(p), NEPRUCHOD); }); } catch (e) { swallow(e, 'prekazky'); }
        var data8 = ctx.getImageData(0, 0, W, H).data, cost = new Float32Array(W * H);
        for (var i = 0; i < W * H; i++) { var r = data8[i * 4]; cost[i] = r >= 230 ? Infinity : Math.max(0.5, r / 10); }   // ≥ 230 = hrana neprůchodného rozmazaná vyhlazováním plátna
        return { cost: cost, W: W, H: H, bunka: bunka, w: w, n: n, m: m, zdroj: D.zdroj, osy: osy, budovy: budovy, vchody: vchody, px: function (p) { return { x: Math.min(W - 1, Math.max(0, Math.floor((p.lng - w) * m.lng / bunka))), y: Math.min(H - 1, Math.max(0, Math.floor((n - p.lat) * m.lat / bunka))) }; }, ll: function (x, y) { return { lat: n - (y + 0.5) * bunka / m.lat, lng: w + (x + 0.5) * bunka / m.lng }; } };
    }
    // lomy ležící na cestě přitáhnout na její osu (do půl šířky + 1 m) — čára v mapě pak leží
    // NA cestě, ne metr vedle (hlášení 17. 9. 2026)
    function naOsu(body, osy) {
        if (!osy || !osy.length || body.length < 3) return body;
        return body.map(function (q, i) {
            if (i === 0 || i === body.length - 1) return q;
            var best = null;
            for (var a = 0; a < osy.length; a++) { var l = osy[a].l, lim = osy[a].sir / 2 + 1; for (var j = 0; j + 1 < l.length; j++) { var pr = AGHrany.prumet(l[j], l[j + 1], q); if (pr && pr.d <= lim && (!best || pr.d < best.d)) best = pr; } }
            return best ? { lat: best.bod.lat, lng: best.bod.lng } : q;
        });
    }
    // ---- start uvnitř budovy → nejdřív k VÝCHODU (17. 9. 2026, uživatel: „nejspíš mě to vedlo
    // skrz zeď, protože jsem byl uvnitř budovy — ať mě to navádí od nejbližšího východu, ne
    // únikového") ---------------------------------------------------------------------------------
    // Vchod z OSM (kind entrance, ne emergency), když ho dlaždice mají; jinak odhad: bod obrysu
    // budovy nejblíž k ulici nebo cestě — tam bývá hlavní vchod. Uvnitř se jde rovně (čárkovaně).
    function vRingu(ring, p) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var yi = ring[i].lat, xi = ring[i].lng, yj = ring[j].lat, xj = ring[j].lng;
            if (((yi > p.lat) !== (yj > p.lat)) && (p.lng < (xj - xi) * (p.lat - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }
    function vychod(r, od) {
        var dum = null;
        for (var i = 0; i < r.budovy.length && !dum; i++) if (vRingu(r.budovy[i][0], od)) dum = r.budovy[i];
        if (!dum) return null;
        var obrys = dum[0], best = null, m = r.m;
        // 1) vchody OSM do 3 m od obrysu téhle budovy
        r.vchody.forEach(function (v) {
            var d = Infinity; for (var j = 0; j + 1 < obrys.length; j++) { var pr = AGHrany.prumet(obrys[j], obrys[j + 1], v); if (pr && pr.d < d) d = pr.d; }
            if (d <= 3) { var dm = dist(od, v); if (!best || dm < best.d) best = { bod: v, d: dm, jak: 'vchod' }; }
        });
        if (best) return best;
        // 2) odhad: vzorky obrysu po 2 m, skóre = vzdálenost k nejbližší silnici/cestě (+ trochu ode mě)
        var vzorky = [];
        for (var j = 0; j + 1 < obrys.length; j++) {
            var a = obrys[j], b = obrys[j + 1], L = dist(a, b), n = Math.max(1, Math.round(L / 2));
            for (var k = 0; k <= n; k++) { var t = k / n; vzorky.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }); }
        }
        var kUlici = null;
        vzorky.forEach(function (q) {
            var d = Infinity;
            for (var a2 = 0; a2 < r.osy.length; a2++) { var l = r.osy[a2].l; for (var j2 = 0; j2 + 1 < l.length; j2++) { var pr = AGHrany.prumet(l[j2], l[j2 + 1], q); if (pr && pr.d < d) d = pr.d; } }
            var skore = (isFinite(d) ? d : 60) + 0.15 * dist(od, q);
            if (!kUlici || skore < kUlici.skore) kUlici = { bod: q, d: dist(od, q), skore: skore, jak: 'ulice' };
        });
        void m;
        return kUlici;
    }
    // ---- A* ---------------------------------------------------------------------------------------
    function hledej(r, od, kam) {
        var W = r.W, H = r.H, N = W * H, start = r.px(od), cilPx = r.px(kam);
        var si = start.y * W + start.x, ci = cilPx.y * W + cilPx.x;
        // start/cíl uvnitř neprůchodného (stojím u zdi, cíl je roh budovy) → políčko uvolnit
        var R0 = Math.ceil(2 / b);
        [start, cilPx].forEach(function (c) { for (var dy = -R0; dy <= R0; dy++) for (var dx = -R0; dx <= R0; dx++) { var xx = c.x + dx, yy = c.y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { var ii = yy * W + xx; r.cost[ii] = Math.min(r.cost[ii], 1); } } });
        var g = new Float32Array(N); for (var i = 0; i < N; i++) g[i] = Infinity;
        var prev = new Int32Array(N); prev.fill(-1);
        var zavr = new Uint8Array(N);
        var heap = [], hk = [];   // binární halda: hk = f, heap = index
        function push(f, idx) { heap.push(idx); hk.push(f); var i = hk.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; var t = hk[p]; hk[p] = hk[i]; hk[i] = t; var u = heap[p]; heap[p] = heap[i]; heap[i] = u; i = p; } }
        function pop() { var top = heap[0]; var lf = hk.pop(), li = heap.pop(); if (hk.length) { hk[0] = lf; heap[0] = li; var i = 0, n = hk.length; for (;;) { var l = 2 * i + 1, rr = l + 1, mn = i; if (l < n && hk[l] < hk[mn]) mn = l; if (rr < n && hk[rr] < hk[mn]) mn = rr; if (mn === i) break; var t = hk[mn]; hk[mn] = hk[i]; hk[i] = t; var u = heap[mn]; heap[mn] = heap[i]; heap[i] = u; i = mn; } } return top; }
        var minC = 0.7, b = r.bunka;   // nejlevnější políčko = osa cesty (CENA.stred)
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
        // CÍL NEDOSAŽITELNÝ (uzavřený dvůr, bod uvnitř budovy, ohrazený areál): dojít k nejbližšímu
        // dosažitelnému políčku a zbytek rovně (v mapě čárkovaně) — lepší než žádná trasa
        var konec = ci, nedosazitelne = false;
        if (!isFinite(g[ci])) {
            var bd = Infinity;
            for (var q = 0; q < N; q++) { if (!zavr[q] || !isFinite(g[q])) continue; var qx = q % W, qy = (q - qx) / W, dd = Math.hypot(qx - cilPx.x, qy - cilPx.y); if (dd < bd) { bd = dd; konec = q; } }
            if (!isFinite(bd) || konec === si) return null;
            nedosazitelne = true;
        }
        var cesta = [], at = konec; while (at >= 0) { cesta.push(at); at = prev[at]; }
        cesta.reverse();
        var body = cesta.map(function (idx) { var x = idx % W; return r.ll(x, (idx - x) / W); });
        body[0] = { lat: od.lat, lng: od.lng };
        if (nedosazitelne) { body = naOsu(zjednodus(body, 1.5), r.osy); body.push({ lat: kam.lat, lng: kam.lng }); return { body: body, cena: g[konec], nedosazitelne: true }; }
        body[body.length - 1] = { lat: kam.lat, lng: kam.lng };
        return { body: naOsu(zjednodus(body, 1.5), r.osy), cena: g[konec], nedosazitelne: false };
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
    // připraveno = zapnuto + hrany + (dlaždice PMTiles nezávisle na podkladu NEBO vektorová mapa na obrazovce)
    function mapaNaObrazovce() { try { var m = window.AGMapaVektor && AGMapaVektor.stav() === 'zapnuto' && AGMapaVektor.mapa(); return !!(m && m.isStyleLoaded()); } catch (e) { return false; } }
    function pripraveno() { return !!(st.zap && window.AGHrany && window.AGMapaVektor && (window.AGMapaData || mapaNaObrazovce())); }
    var _duvod = '', _rastrDuvod = '';   // proč není trasa (diagnostika: AGTrasa.diag(), hláška při zapnutí cíle)
    function spocitej(od, c) {
        _duvod = ''; _rastrDuvod = '';
        var r = rastr(od, c); if (!r) { _duvod = _rastrDuvod || ('cíl je dál než ' + (MAX_STRANA / 1000) + ' km — vede přímka'); return null; }
        var vy = null; try { vy = vychod(r, od); } catch (e) { swallow(e, 'vychod'); }
        var start = vy ? vy.bod : od;
        var v = hledej(r, start, c); if (!v || v.body.length < 2) { _duvod = 'z místa, kde stojíš, podle mapy nevede průchod (' + r.zdroj + ')'; return null; }
        var body = v.body; if (vy) body = [{ lat: od.lat, lng: od.lng }].concat(body);
        return { id: c.id, name: c.name, body: body, delka: delka(body), bunka: r.bunka, ts: Date.now(), profil: null, od: od, zdroj: r.zdroj, vychod: vy, nedosazitelne: !!v.nedosazitelne };
    }
    function pripravenoProc() {
        if (!st.zap) return 'navigace podle terénu je vypnutá (Nastavení → AR & přesnost)';
        if (!window.AGHrany || !window.AGMapaVektor) return 'moduly mapy se ještě načítají';
        if (!window.AGMapaData && !mapaNaObrazovce()) return 'data mapy se ještě načítají';
        return '';
    }
    function prepocitej(duvod) {
        var me = poloha(), c = cil();
        if (!me || !c || !pripraveno()) { _duvod = !c ? '' : (!me ? 'bez polohy GPS' : pripravenoProc()); if (trasa) { trasa = null; kresli(); } return null; }
        if (_pocitam) return trasa; _pocitam = true;
        try {
            var t0 = Date.now(), t = spocitej(me, c);
            if (t) {
                t.ms = Date.now() - t0; t.duvod = duvod; trasa = t; kresli();
                // profil potřebuje výškové dlaždice ze sítě — bez signálu prostě není (žádná chyba pro uživatele)
                profil(t.body).then(function (p) { if (trasa === t) { t.profil = p; kresli(); } }).catch(function () { if (trasa === t) t.profilChyba = true; });
            }
            else { trasa = null; kresli(); }
        } catch (e) { swallow(e, 'prepocitej'); trasa = null; _duvod = 'chyba výpočtu: ' + ((e && e.message) || e); } finally { _pocitam = false; }
        // bez trasy řekni PROČ (jednou na cíl a důvod) — v348 uživatel viděl jen přímku a nevěděl, co se děje
        try { if (!trasa && _duvod && c && prepocitej._hlaseno !== c.id + '|' + _duvod) { prepocitej._hlaseno = c.id + '|' + _duvod; window.agInfo && window.agInfo('Trasa terénem: ' + _duvod + '.'); } } catch (e) { /* nic */ }
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
            pl.bindPopup(function () { var p = trasa && trasa.profil; return '<b>Trasa k ' + (window.AG && AG.esc ? AG.esc(String(trasa.name)) : trasa.name) + '</b><br>' + Math.round(trasa.delka) + ' m po terénu' + (p ? ' · ' + popisekProfilu(p) : (trasa.profilChyba ? ' · profil bez signálu' : ' · profil se načítá…')) + (p ? '<div style="margin-top:6px">' + svgProfil(p) + '</div>' : '') + (trasa.nedosazitelne ? '<br><small>⚠ K cíli podle mapy nevede průchod (uzavřený dvůr, budova, oplocený areál) — trasa končí u nejbližšího místa, zbytek rovně.</small>' : '') + (trasa.vychod ? '<br><small>Stojíš v budově: nejdřív k východu (' + (trasa.vychod.jak === 'vchod' ? 'vchod z mapy' : 'odhad — strana k ulici') + ', ' + Math.round(trasa.vychod.d) + ' m), pak po terénu.</small>' : '') + '<small>obchází budovy, vodu, dálnice a překážky; ' + trasa.ms + ' ms, mřížka ' + trasa.bunka + ' m, data: ' + (trasa.zdroj || '?') + '</small>'; }, { maxWidth: 320 });
            pl.addTo(_grp);
            if (trasa.nedosazitelne && trasa.body.length >= 2) {
                var pk = trasa.body[trasa.body.length - 2], pc = trasa.body[trasa.body.length - 1];
                L.polyline([[pk.lat, pk.lng], [pc.lat, pc.lng]], { color: '#f87171', weight: 4, opacity: 0.95, dashArray: '4,7', interactive: false }).addTo(_grp);
            }
            if (trasa.vychod) {
                // uvnitř budovy: k východu čárkovaně, východ = kroužek s popiskem
                L.polyline([[trasa.body[0].lat, trasa.body[0].lng], [trasa.vychod.bod.lat, trasa.vychod.bod.lng]], { color: '#fbbf24', weight: 4, opacity: 0.95, dashArray: '4,7', interactive: false }).addTo(_grp);
                L.circleMarker([trasa.vychod.bod.lat, trasa.vychod.bod.lng], { radius: 6, color: '#fff', fillColor: '#fbbf24', fillOpacity: 1, weight: 2, interactive: false })
                    .bindTooltip(trasa.vychod.jak === 'vchod' ? 'Východ (vchod z OSM)' : 'Východ (odhad: strana k ulici)', { permanent: true, direction: 'top', offset: [0, -6], className: 'ag-trasa-tip' }).addTo(_grp);
            }
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

    window.AGTrasa = { aktivni: aktivni, smer: smer, zbyva: zbyva, popisek: popisek, body: function () { return trasa ? trasa.body : null; }, trasa: function () { return trasa; }, prepocitej: prepocitej, spocitej: spocitej, rastr: rastr, hledej: hledej, profil: profil, svgProfil: svgProfil, dalsiLom: dalsiLom, nastav: function (o) { if (o && o.zap != null) st.zap = !!o.zap; uloz(); }, zapnuto: function () { return st.zap; }, vyskaFn: null, CENA: CENA, diag: function () { return _duvod; } };
})();
