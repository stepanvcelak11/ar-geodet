// ===== QTRIG — HRANY A ROHY Z MAPY: sdílená geometrie pro přesnost (ODPOJITELNÁ, ag/lazy) ===
// (16. 9. 2026, fáze 2 „vlastní mapa" — základ pro P1 korekci po hraně, P2 přichycení,
//  P3 mapu kvality GPS; viz paměť project-vlastni-mapa-svet-vyber-16-9)
//
// Telefon má ±3 m, mapa má centimetry — parcely z RÚIAN (js/cadastre-vector.js), obrysy
// budov z vektorové mapy (js/mapa-vektor.js; v ČR jsou budovy v OSM z importu RÚIAN),
// a vlastní výkres DXF (js/project-import.js). Tenhle modul je z těch tří zdrojů sesbírá
// do jednoho tvaru a umí odpovědět: „který lomový bod / která hrana je nejblíž?"
//
//   AGHrany.sber(lat, lng, r)            → { vrcholy: [...], hrany: [...] } v okruhu r metrů
//   AGHrany.nejblizsiVrchol(lat, lng, r) → { lat, lng, d, zdroj, popis, presnost } | null
//   AGHrany.nejblizsiHrana(lat, lng, r)  → { a, b, d, t, bod, zdroj, popis, presnost, klic } | null
//   AGHrany.budovyPolygony(lat, lng, r)  → [{ rings:[[{lat,lng}]], vyska, popis }] (pro P3)
//
// zdroj: 'parcela' (RÚIAN, přesnost 0,1 m) · 'dxf' (výkres, 0,05 m — je to projekt) ·
//        'budova' (OSM, 0,5 m) — přesnost je odhad, do provenience bodu jde jako acc.
// Nic tu nekreslí, na nic nesahá; jen čte. Bez zdrojů vrací prázdno.
// Odstranění: smaž js/hrany.js + <script> v index.html; P1/P2/P3 pak nemají data.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGHrany) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'hrany:' + kde); } catch (e2) { /* nic */ } };
    var PRESNOST = { parcela: 0.1, dxf: 0.05, budova: 0.5 };

    function mPerDeg(lat) { var c = Math.cos(lat * Math.PI / 180); return { lat: 111320, lng: 111320 * c }; }
    function dist(a, b) { try { return GeoCore.getDistance(a.lat, a.lng, b.lat, b.lng); } catch (e) { var m = mPerDeg(a.lat); return Math.hypot((b.lat - a.lat) * m.lat, (b.lng - a.lng) * m.lng); } }

    // ---- zdroje --------------------------------------------------------------------------------
    function parcely() {
        try { if (window.AGParcely && AGParcely.seznam) return AGParcely.seznam() || []; } catch (e) { swallow(e, 'parcely'); }
        return [];
    }
    function budovy() {
        try { if (window.AGMapaVektor && AGMapaVektor.budovy) return AGMapaVektor.budovy() || []; } catch (e) { swallow(e, 'budovy'); }
        return [];
    }
    function budovaPopis(f) {
        var p = (f && f.properties) || {};
        return 'budova' + (p.addr_housenumber ? ' č. ' + p.addr_housenumber : '');
    }
    function budovaVyska(f) {
        var p = (f && f.properties) || {};
        var h = parseFloat(p.height); if (isFinite(h) && h > 0) return h;
        return 8;
    }
    function ringsZGeoJson(g) {
        if (!g) return [];
        var out = [];
        function ring(r) { return r.map(function (c) { return { lat: c[1], lng: c[0] }; }); }
        if (g.type === 'Polygon') g.coordinates.forEach(function (r) { out.push(ring(r)); });
        else if (g.type === 'MultiPolygon') g.coordinates.forEach(function (poly) { poly.forEach(function (r) { out.push(ring(r)); }); });
        return out;
    }
    function vBoxu(p, lat, lng, dlat, dlng) { return Math.abs(p.lat - lat) <= dlat && Math.abs(p.lng - lng) <= dlng; }

    // ---- sběr -----------------------------------------------------------------------------------
    function sber(lat, lng, r) {
        var m = mPerDeg(lat), dlat = r / m.lat, dlng = r / m.lng;
        var vrcholy = [], hrany = [];
        function pridejRing(ring, zdroj, popis, uzavreny) {
            // aspoň jeden bod prstence v boxu (hrubě, ať se neprochází celé okolí)
            var uvnitr = false;
            for (var i = 0; i < ring.length; i++) if (vBoxu(ring[i], lat, lng, dlat * 1.5, dlng * 1.5)) { uvnitr = true; break; }
            if (!uvnitr) return;
            for (var j = 0; j < ring.length; j++) {
                var q = ring[j];
                if (vBoxu(q, lat, lng, dlat, dlng)) vrcholy.push({ lat: q.lat, lng: q.lng, zdroj: zdroj, popis: popis, presnost: PRESNOST[zdroj] });
                if (j + 1 < ring.length) hrany.push({ a: ring[j], b: ring[j + 1], zdroj: zdroj, popis: popis, presnost: PRESNOST[zdroj] });
            }
        }
        parcely().forEach(function (p) { (p.rings || []).forEach(function (ring) { pridejRing(ring, 'parcela', 'hranice parcely ' + (p.cislo || '') + (p.ku ? ' (' + p.ku + ')' : ''), true); }); });
        budovy().forEach(function (f) { ringsZGeoJson(f.geometry).forEach(function (ring) { pridejRing(ring, 'budova', budovaPopis(f), true); }); });
        try {
            var d = window.AGProjektDxf && AGProjektDxf.design();
            if (d) {
                (d.polys || []).forEach(function (p) { if (d.layers[p.layer] && d.layers[p.layer].on === false) return; pridejRing(p.pts, 'dxf', 'výkres · ' + p.layer + (d.osa === p.layer ? ' (osa)' : ''), p.closed); });
                (d.points || []).forEach(function (q) { if (d.layers[q.layer] && d.layers[q.layer].on === false) return; if (vBoxu(q, lat, lng, dlat, dlng)) vrcholy.push({ lat: q.lat, lng: q.lng, zdroj: 'dxf', popis: 'výkres · bod ' + q.name, presnost: PRESNOST.dxf }); });
            }
        } catch (e) { swallow(e, 'dxf'); }
        return { vrcholy: vrcholy, hrany: hrany };
    }
    function nejblizsiVrchol(lat, lng, r) {
        var s = sber(lat, lng, r), best = null;
        s.vrcholy.forEach(function (v) { var d = dist({ lat: lat, lng: lng }, v); if (d <= r && (!best || d < best.d)) best = { lat: v.lat, lng: v.lng, d: d, zdroj: v.zdroj, popis: v.popis, presnost: v.presnost }; });
        return best;
    }
    // kolmý průmět na úsečku v místní rovině (metry)
    function prumet(a, b, p) {
        var m = mPerDeg(a.lat);
        var bx = (b.lng - a.lng) * m.lng, by = (b.lat - a.lat) * m.lat, px = (p.lng - a.lng) * m.lng, py = (p.lat - a.lat) * m.lat;
        var L2 = bx * bx + by * by; if (!L2) return null;
        var t = Math.max(0, Math.min(1, (px * bx + py * by) / L2));
        var qx = t * bx, qy = t * by;
        // znaménko: kladné vlevo od směru a→b
        var cross = bx * py - by * px, d = Math.hypot(px - qx, py - qy);
        return { t: t, d: d, dz: cross >= 0 ? d : -d, bod: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, delka: Math.sqrt(L2), smer: Math.atan2(bx, by) * 180 / Math.PI };
    }
    function nejblizsiHrana(lat, lng, r, hranyHotove) {
        var hr = hranyHotove || sber(lat, lng, r).hrany, best = null, p = { lat: lat, lng: lng };
        hr.forEach(function (h) {
            var q = prumet(h.a, h.b, p); if (!q || q.d > r) return;
            if (!best || q.d < best.d) best = { a: h.a, b: h.b, d: q.d, dz: q.dz, t: q.t, bod: q.bod, delka: q.delka, smer: q.smer, zdroj: h.zdroj, popis: h.popis, presnost: h.presnost, klic: h.a.lat.toFixed(6) + ',' + h.a.lng.toFixed(6) + '-' + h.b.lat.toFixed(6) + ',' + h.b.lng.toFixed(6) };
        });
        return best;
    }
    function budovyPolygony(lat, lng, r) {
        var m = mPerDeg(lat), dlat = r / m.lat, dlng = r / m.lng, out = [];
        budovy().forEach(function (f) {
            var rings = ringsZGeoJson(f.geometry); if (!rings.length) return;
            var ok = false; for (var i = 0; i < rings[0].length && !ok; i++) if (vBoxu(rings[0][i], lat, lng, dlat, dlng)) ok = true;
            if (ok) out.push({ rings: rings, vyska: budovaVyska(f), popis: budovaPopis(f) });
        });
        return out;
    }

    window.AGHrany = { sber: sber, nejblizsiVrchol: nejblizsiVrchol, nejblizsiHrana: nejblizsiHrana, prumet: prumet, budovyPolygony: budovyPolygony, PRESNOST: PRESNOST, dist: dist, mPerDeg: mPerDeg };
})();
