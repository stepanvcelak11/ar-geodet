// ===== AR Geodet — PARCELA: geometrie & dělení pozemku (ODPOJITELNÁ vrstva) =====
// Neinvazivní modul ve stylu js/offset-point.js / js/field-tools.js.
// NEEDITUJE logika.js ani grafika.js — jen čte globály (map, L, proj4, arPoints,
// userLat/Lng, gpsAvgResult) a ukládá body přes oficiální window.addImportedPoints().
//
// Co umí:
//  • Postavit polygon parcely (klepáním do mapy / z bodů zakázky / zadáním Y,X / z GPS).
//  • Spočítat výměru (Gaussův/shoelace vzorec přímo v rovinných S-JTSK souřadnicích —
//    legálně správný způsob výpočtu výměr v ČR), obvod a tabulku hranice
//    (délka + směrník σ v gonech i stupních pro každou stranu).
//  • DĚLENÍ PARCELY na zadanou výměru:
//      A) přímkou rovnoběžnou s vybranou hranou (řeší se odstup přímky),
//      B) přímkou z vybraného vrcholu (řeší se poloha výstupního bodu na hranici),
//      C) na N stejných dílů rovnoběžně s vybranou hranou.
//    Výpočet dělicí čáry je robustní: ořez polygonu půlrovinou (Sutherland–Hodgman)
//    + bisekce na monotónní výměře → funguje i pro nepravidelné (konvexní) parcely.
//  • Uložit nové lomové body (průsečíky dělicí čáry s hranicí) přes addImportedPoints
//    → propadnou do AR, vytyčení i exportů zbytku appky.
//  • Náhled na mapě (vlastní Leaflet vrstva — nemíchá se do markersGroup).
//  • Export protokolu (TXT: seznam souřadnic + popis hranice + dělení) a souřadnic (CSV).
//
// Vstup: dlaždice „Parcela" v launcheru terénních nástrojů (js/field-tools.js),
//        nebo přímo window.agOpenParcela(). Když launcher chybí, nouzové tlačítko vpravo.
//
// Odstranění: smaž js/parcela.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agParcelInit) return;          // idempotentní (dvojí načtení neuškodí)
    window.__agParcelInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M4 8 L13 4 L20 10 L16 20 L6 19 Z"/><path d="M13 4 L16 20" opacity="0.55" stroke-dasharray="2 2"/>'
        + '<circle cx="4" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="13" cy="4" r="1.4" fill="currentColor" stroke="none"/>'
        + '<circle cx="20" cy="10" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="20" r="1.4" fill="currentColor" stroke="none"/>'
        + '<circle cx="6" cy="19" r="1.4" fill="currentColor" stroke="none"/></svg>';

    // ---- stav ------------------------------------------------------------------
    var state = {
        verts: [],          // [{Y,X,lat,lng,name}]
        division: null,     // {lines:[[{Y,X},{Y,X}],...], points:[{Y,X,lat,lng}], areas:[..], label}
        minimized: false,
        picking: false,
        addMode: null       // null | 'point' | 'yx'
    };
    var layer = null;       // Leaflet vrstva s náhledem

    // =====================================================================
    //  Draft (AGDraft je odpojitelný modul — vše fail-silent): rozdělaná
    //  parcela přežije zabití appky. Ukládá se JEN serializovatelné jádro
    //  (verts + division jsou čistá data), NE Leaflet vrstva ani DOM.
    // =====================================================================
    var DRAFT_KEY = 'parcela';
    function draftSave() {
        if (!window.AGDraft) return;
        try {
            // prázdná úloha se nedraftuje — místo starého draftu úklid
            if (!state.verts.length) { window.AGDraft.clear(DRAFT_KEY); return; }
            var n = state.verts.length;
            window.AGDraft.save(DRAFT_KEY, { verts: state.verts, division: state.division },
                'Parcela – ' + n + ' ' + (n === 1 ? 'vrchol' : (n <= 4 ? 'vrcholy' : 'vrcholů')));
        } catch (e) {}
    }
    function draftClear() { if (window.AGDraft) try { window.AGDraft.clear(DRAFT_KEY); } catch (e) {} }

    // =====================================================================
    //  Dialogy (sjednoceno s vylepseni.js, fallback na nativní)
    // =====================================================================
    function agAlert(t, m) {
        try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {}
        alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : ''));
        return Promise.resolve(true);
    }
    function agConfirm(t, m) {
        try { if (typeof window.agConfirm === 'function') return window.agConfirm({ title: t, message: m }); } catch (e) {}
        return Promise.resolve(confirm(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')));
    }
    function toast(msg) {
        try {
            var t = document.getElementById('agpc-toast');
            if (!t) { t = document.createElement('div'); t.id = 'agpc-toast'; document.body.appendChild(t); }
            t.textContent = msg; t.classList.add('show');
            clearTimeout(window.__agpcToastT);
            window.__agpcToastT = setTimeout(function () { t.classList.remove('show'); }, 2600);
        } catch (e) {}
    }

    // =====================================================================
    //  Převody souřadnic  (lat/lng  <->  S-JTSK Y,X kladné)
    // =====================================================================
    function llToYX(lat, lng) {
        var r = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]);
        var a = Math.abs(r[0]), b = Math.abs(r[1]);
        return { Y: Math.min(a, b), X: Math.max(a, b) };   // v ČR Y < X
    }
    function yxToLL(Y, X) {
        var w = proj4('EPSG:5514', 'EPSG:4326', [-Math.abs(Y), -Math.abs(X)]);
        return { lat: w[1], lng: w[0] };
    }

    // =====================================================================
    //  Rovinná geometrie v S-JTSK  (pracujeme v rovině [Y, X])
    // =====================================================================
    // Plocha (Gaussův/shoelace vzorec). Body {Y,X}. Vrací m² (vždy kladné).
    function shoelace(pts) {
        var n = pts.length, s = 0;
        if (n < 3) return 0;
        // redukce o prvni vrchol: souciny surovych S-JTSK souradnic (~10^12) by
        // v double ztracely presnost vzajemnym rusenim clenu
        var Y0 = pts[0].Y, X0 = pts[0].X;
        for (var i = 0; i < n; i++) {
            var j = (i + 1) % n;
            s += (pts[i].Y - Y0) * (pts[j].X - X0) - (pts[j].Y - Y0) * (pts[i].X - X0);
        }
        return Math.abs(s) / 2;
    }
    function segLen(a, b) { var dY = b.Y - a.Y, dX = b.X - a.X; return Math.sqrt(dY * dY + dX * dX); }
    // ---- testy pro validaci dělení z vrcholu (nekonvexní parcely) ----------
    function _cross3(o, a, b) { return (a.Y - o.Y) * (b.X - o.X) - (a.X - o.X) * (b.Y - o.Y); }
    // pravé protnutí úsečky AB s hranou polygonu (dotek v koncovém bodě nevadí)
    function segCrossesBoundary(pts, A, B) {
        var n = pts.length, eps = 1e-7;
        for (var i = 0; i < n; i++) {
            var C = pts[i], D = pts[(i + 1) % n];
            var d1 = _cross3(A, B, C), d2 = _cross3(A, B, D), d3 = _cross3(C, D, A), d4 = _cross3(C, D, B);
            if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
                ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
        }
        return false;
    }
    function pointInPolyYX(pts, P) {
        var inside = false, n = pts.length;
        for (var i = 0, j = n - 1; i < n; j = i++) {
            var yi = pts[i].Y, xi = pts[i].X, yj = pts[j].Y, xj = pts[j].X;
            var hit = ((xi > P.X) !== (xj > P.X)) && (P.Y < (yj - yi) * (P.X - xi) / ((xj - xi) || 1e-12) + yi);
            if (hit) inside = !inside;
        }
        return inside;
    }
    function perimeter(pts) {
        var n = pts.length, p = 0;
        if (n < 2) return 0;
        for (var i = 0; i < n; i++) p += segLen(pts[i], pts[(i + 1) % n]);
        return p;
    }
    // Směrník σ od osy +X (sever) ve směru hod. ručiček, k ose +Y. Radiány [0,2π).
    function smernik(a, b) {
        var dY = b.Y - a.Y, dX = b.X - a.X;
        var s = Math.atan2(dY, dX);
        if (s < 0) s += 2 * Math.PI;
        return s;
    }
    function radToGon(r) { return r * 200 / Math.PI; }
    function radToDeg(r) { return r * 180 / Math.PI; }

    function centroid(pts) {
        var n = pts.length;
        if (n === 0) return { Y: 0, X: 0 };
        if (n < 3) { var sy = 0, sx = 0; for (var k = 0; k < n; k++) { sy += pts[k].Y; sx += pts[k].X; } return { Y: sy / n, X: sx / n }; }
        var a = 0, cy = 0, cx = 0;
        for (var i = 0; i < n; i++) {
            var j = (i + 1) % n;
            var cr = pts[i].Y * pts[j].X - pts[j].Y * pts[i].X;
            a += cr; cy += (pts[i].Y + pts[j].Y) * cr; cx += (pts[i].X + pts[j].X) * cr;
        }
        if (Math.abs(a) < 1e-9) { var s2y = 0, s2x = 0; for (var m = 0; m < n; m++) { s2y += pts[m].Y; s2x += pts[m].X; } return { Y: s2y / n, X: s2x / n }; }
        a *= 0.5; return { Y: cy / (6 * a), X: cx / (6 * a) };
    }

    // Ořez polygonu půlrovinou  {nx*Y + ny*X <= c}  (Sutherland–Hodgman).
    // Vrací nový polygon (může být prázdný). Korektní i pro nekonvexní subjekt.
    function clipHalfPlane(pts, nx, ny, c) {
        var out = [], n = pts.length;
        if (!n) return out;
        for (var i = 0; i < n; i++) {
            var cur = pts[i], prev = pts[(i + n - 1) % n];
            var dc = nx * cur.Y + ny * cur.X - c;
            var dp = nx * prev.Y + ny * prev.X - c;
            var curIn = dc <= 1e-7, prevIn = dp <= 1e-7;
            if (curIn) {
                if (!prevIn) out.push(intersectAt(prev, cur, dp, dc));
                out.push({ Y: cur.Y, X: cur.X });
            } else if (prevIn) {
                out.push(intersectAt(prev, cur, dp, dc));
            }
        }
        return out;
    }
    function intersectAt(p0, p1, d0, d1) {
        var t = d0 / (d0 - d1);
        return { Y: p0.Y + t * (p1.Y - p0.Y), X: p0.X + t * (p1.X - p0.X) };
    }
    function areaClip(pts, nx, ny, c) { return shoelace(clipHalfPlane(pts, nx, ny, c)); }

    // Průsečíky přímky {nx*Y + ny*X = c} s hranicí polygonu (typicky 2 pro konvexní).
    function lineCrossings(pts, nx, ny, c) {
        var res = [], n = pts.length;
        for (var i = 0; i < n; i++) {
            var a = pts[i], b = pts[(i + 1) % n];
            var da = nx * a.Y + ny * a.X - c;
            var db = nx * b.Y + ny * b.X - c;
            if ((da <= 0 && db > 0) || (da > 0 && db <= 0)) {
                if (Math.abs(da - db) > 1e-9) res.push(intersectAt(a, b, da, db));
            }
        }
        return res;
    }

    // ---- DĚLENÍ A: přímka rovnoběžná s hranou edgeIndex, díl u hrany = targetA ----
    function solveParallel(pts, edgeIndex, targetA) {
        var n = pts.length, total = shoelace(pts);
        if (total <= 0 || n < 3) return null;
        var A = pts[edgeIndex % n], B = pts[(edgeIndex + 1) % n];
        var dY = B.Y - A.Y, dX = B.X - A.X, L = Math.sqrt(dY * dY + dX * dX);
        if (L < 1e-6) return null;
        var nx = dX / L, ny = -dY / L;             // jednotková normála k hraně
        var cEdge = nx * A.Y + ny * A.X;
        var pmin = Infinity, pmax = -Infinity;
        for (var i = 0; i < n; i++) { var pr = nx * pts[i].Y + ny * pts[i].X; if (pr < pmin) pmin = pr; if (pr > pmax) pmax = pr; }
        var cFar = (Math.abs(cEdge - pmin) < Math.abs(cEdge - pmax)) ? pmax : pmin;
        if (cFar < cEdge) { nx = -nx; ny = -ny; cEdge = -cEdge; cFar = -cFar; }  // ať díl roste pro c: cEdge→cFar
        var t = Math.max(1e-6, Math.min(total - 1e-6, targetA));
        var lo = cEdge, hi = cFar, mid = cEdge;
        for (var it = 0; it < 80; it++) {
            mid = (lo + hi) / 2;
            if (areaClip(pts, nx, ny, mid) < t) lo = mid; else hi = mid;
        }
        var cr = lineCrossings(pts, nx, ny, mid);
        var a1 = areaClip(pts, nx, ny, mid);
        return { nx: nx, ny: ny, c: mid, crossings: cr, area1: a1, area2: total - a1, total: total };
    }

    // ---- DĚLENÍ B: přímka z vrcholu vIndex, díl mezi vrcholem a hranicí = targetA --
    function solveVertex(pts, vIndex, targetA) {
        var n = pts.length, total = shoelace(pts);
        if (total <= 0 || n < 3) return null;
        // délky hran obíhajíce od vrcholu V dopředu
        var lens = [], perim = 0;
        for (var k = 0; k < n; k++) {
            var a = pts[(vIndex + k) % n], b = pts[(vIndex + k + 1) % n];
            var l = segLen(a, b); lens.push(l); perim += l;
        }
        function pointAt(u) {
            var acc = 0;
            for (var k = 0; k < n; k++) {
                if (u <= acc + lens[k] || k === n - 1) {
                    var a = pts[(vIndex + k) % n], b = pts[(vIndex + k + 1) % n];
                    var tt = lens[k] > 1e-9 ? (u - acc) / lens[k] : 0;
                    tt = Math.max(0, Math.min(1, tt));
                    return { seg: k, P: { Y: a.Y + tt * (b.Y - a.Y), X: a.X + tt * (b.X - a.X) } };
                }
                acc += lens[k];
            }
            return { seg: n - 1, P: { Y: pts[vIndex].Y, X: pts[vIndex].X } };
        }
        function subArea(u) {
            var pa = pointAt(u), poly = [{ Y: pts[vIndex].Y, X: pts[vIndex].X }];
            for (var k = 1; k <= pa.seg; k++) poly.push({ Y: pts[(vIndex + k) % n].Y, X: pts[(vIndex + k) % n].X });
            poly.push(pa.P);
            return { area: shoelace(poly), P: pa.P };
        }
        var t = Math.max(1e-6, Math.min(total - 1e-6, targetA));
        var lo = 1e-4, hi = perim - 1e-4, mid = perim / 2, P = null;
        for (var it = 0; it < 80; it++) {
            mid = (lo + hi) / 2;
            var sa = subArea(mid);
            if (sa.area < t) lo = mid; else hi = mid;
            P = sa.P;
        }
        var a1 = subArea(mid).area;
        // VALIDACE (nekonvexní parcela): pokud spojnice V->P vybíhá z polygonu,
        // sub-polygon je self-intersecting a shoelace/bisekce vrací ŠPATNOU výměru.
        var V = { Y: pts[vIndex].Y, X: pts[vIndex].X };
        var midPt = { Y: (V.Y + P.Y) / 2, X: (V.X + P.X) / 2 };
        var valid = !segCrossesBoundary(pts, V, P) && pointInPolyYX(pts, midPt);
        return { P: P, V: V, area1: a1, area2: total - a1, total: total, valid: valid };
    }

    // =====================================================================
    //  Práce s vrcholy
    // =====================================================================
    function addVertexLL(lat, lng, name) {
        var yx = llToYX(lat, lng);
        state.verts.push({ Y: yx.Y, X: yx.X, lat: lat, lng: lng, name: name || ('V' + (state.verts.length + 1)) });
        state.division = null;
        renderAll();
        draftSave();
    }
    function addVertexYX(Y, X, name) {
        var ll = yxToLL(Y, X);
        state.verts.push({ Y: Math.abs(Y), X: Math.abs(X), lat: ll.lat, lng: ll.lng, name: name || ('V' + (state.verts.length + 1)) });
        state.division = null;
        renderAll();
        draftSave();
    }
    function removeVertex(i) { state.verts.splice(i, 1); state.division = null; renderAll(); draftSave(); }
    function moveVertex(i, dir) {
        var j = i + dir; if (j < 0 || j >= state.verts.length) return;
        var tmp = state.verts[i]; state.verts[i] = state.verts[j]; state.verts[j] = tmp;
        state.division = null; renderAll(); draftSave();
    }
    function clearAll() {
        state.verts = []; state.division = null; renderAll();
        draftClear();   // ruční reset = úloha skončila, draft pryč
    }
    function addMyGps() {
        try {
            if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && gpsAvgResult.n >= 2) {
                addVertexLL(gpsAvgResult.lat, gpsAvgResult.lng, 'V' + (state.verts.length + 1));
                toast('Vrchol z průměru GPS (' + gpsAvgResult.n + ' měření)'); return;
            }
        } catch (e) {}
        if (typeof userLat !== 'undefined' && userLat != null && userLng != null) {
            addVertexLL(userLat, userLng, 'V' + (state.verts.length + 1));
            toast('Vrchol z aktuální GPS');
        } else {
            agAlert('Není poloha', 'Zatím nemám GPS polohu — počkej na zaměření, nebo zadej Y,X ručně.');
        }
    }

    // =====================================================================
    //  Mapa — náhled
    // =====================================================================
    function mapReady() { try { return (typeof map !== 'undefined') && map && (typeof L !== 'undefined') && L; } catch (e) { return false; } }
    function ensureLayer() {
        if (!mapReady()) return null;
        if (!layer) { try { layer = L.layerGroup().addTo(map); } catch (e) { layer = null; } }
        return layer;
    }
    function clearLayer() { if (layer) { try { layer.clearLayers(); } catch (e) {} } }
    function accentColor() {
        try { var c = getComputedStyle(document.documentElement).getPropertyValue('--accent'); return (c && c.trim()) || '#2f9e74'; } catch (e) { return '#2f9e74'; }
    }
    function drawMap() {
        if (!ensureLayer()) return;
        clearLayer();
        var acc = accentColor();
        var lls = state.verts.map(function (v) { return [v.lat, v.lng]; });
        if (lls.length >= 2) {
            try {
                if (lls.length >= 3) {
                    L.polygon(lls, { color: acc, weight: 2, fillColor: acc, fillOpacity: 0.12 }).addTo(layer);
                } else {
                    L.polyline(lls, { color: acc, weight: 2, dashArray: '4 4' }).addTo(layer);
                }
            } catch (e) {}
        }
        // vrcholy
        state.verts.forEach(function (v, i) {
            try {
                L.circleMarker([v.lat, v.lng], { radius: 5, color: '#fff', weight: 2, fillColor: acc, fillOpacity: 1 })
                    .bindTooltip(String(i + 1), { permanent: true, direction: 'top', className: 'agpc-vtip', offset: [0, -6] })
                    .addTo(layer);
            } catch (e) {}
        });
        // popisek výměry
        if (state.verts.length >= 3) {
            try {
                var ctr = centroid(state.verts), cll = yxToLL(ctr.Y, ctr.X);
                L.marker([cll.lat, cll.lng], {
                    interactive: false,
                    icon: L.divIcon({ className: 'agpc-arealbl', html: fmtArea(shoelace(state.verts)), iconSize: [120, 22], iconAnchor: [60, 11] })
                }).addTo(layer);
            } catch (e) {}
        }
        // dělicí čáry + body
        if (state.division) {
            try {
                (state.division.lines || []).forEach(function (ln) {
                    var p0 = yxToLL(ln[0].Y, ln[0].X), p1 = yxToLL(ln[1].Y, ln[1].X);
                    L.polyline([[p0.lat, p0.lng], [p1.lat, p1.lng]], { color: '#fbbf24', weight: 3, dashArray: '7 5' }).addTo(layer);
                });
                (state.division.points || []).forEach(function (pt) {
                    L.circleMarker([pt.lat, pt.lng], { radius: 5, color: '#111', weight: 2, fillColor: '#fbbf24', fillOpacity: 1 }).addTo(layer);
                });
            } catch (e) {}
        }
    }
    function zoomToPolygon() {
        if (!mapReady() || state.verts.length < 1) return;
        try {
            var lls = state.verts.map(function (v) { return [v.lat, v.lng]; });
            if (lls.length === 1) map.setView(lls[0], Math.max(map.getZoom(), 18));
            else map.fitBounds(L.latLngBounds(lls).pad(0.25));
        } catch (e) {}
    }

    // =====================================================================
    //  Sběr bodů z mapy (overlay zachytávající klepnutí — neruší klik appky)
    // =====================================================================
    function startPick() {
        if (!mapReady()) { agAlert('Mapa není dostupná', 'Náhled a sběr z mapy fungují, až poběží mapa (spusť appku).'); return; }
        minimize(true);
        state.picking = true;
        var ov = document.getElementById('agpc-pick');
        if (!ov) {
            ov = document.createElement('div'); ov.id = 'agpc-pick';
            ov.innerHTML = '<div id="agpc-pick-hint"><span><svg class="icon"><use href="#i-map-pin"/></svg> Klepni do mapy — přidá vrchol. Pro posun/zoom mapy nejdřív klepni „Hotovo".</span>'
                + '<button type="button" id="agpc-pick-done">Hotovo</button></div>';
            document.body.appendChild(ov);
            ov.addEventListener('click', function (e) {
                if (e.target && e.target.closest('#agpc-pick-hint')) return;
                onPickTap(e);
            });
            document.getElementById('agpc-pick-done').addEventListener('click', function (e) { e.stopPropagation(); stopPick(); });
        }
        ov.classList.add('show');
        zoomToPolygon();
    }
    function onPickTap(e) {
        try {
            if (!map) return;
            // Mapa je v otočeném #map-wrapper (transform: rotate podle azimutu), takže
            // prosté odečtení getBoundingClientRect() dává bod mimo klik. Sdílený převod
            // v grafika.js rotaci zpětně vyruší — proto se používá přednostně.
            var ll = (typeof window.agScreenToLatLng === 'function') ? window.agScreenToLatLng(e.clientX, e.clientY) : null;
            if (!ll) {
                var mapEl = document.getElementById('map'); if (!mapEl) return;
                var rect = mapEl.getBoundingClientRect();
                var x = e.clientX - rect.left, y = e.clientY - rect.top;
                if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
                ll = map.containerPointToLatLng([x, y]);
            }
            if (!ll || !isFinite(ll.lat) || !isFinite(ll.lng)) return;
            addVertexLL(ll.lat, ll.lng);
            toast('Vrchol ' + state.verts.length + ' přidán');
        } catch (err) {}
    }
    function stopPick() {
        state.picking = false;
        var ov = document.getElementById('agpc-pick'); if (ov) ov.classList.remove('show');
        minimize(false);
    }

    // =====================================================================
    //  Formátování
    // =====================================================================
    function fmtArea(m2) {
        if (!isFinite(m2)) return '— m²';
        var ha = m2 / 10000;
        var s = m2.toLocaleString('cs-CZ', { maximumFractionDigits: 2 }) + ' m²';
        if (m2 >= 1000) s += ' (' + ha.toLocaleString('cs-CZ', { maximumFractionDigits: 4 }) + ' ha)';
        return s;
    }
    function fmtLen(m) { return (isFinite(m) ? m.toFixed(2) : '—') + ' m'; }
    function fmtYX(Y, X) { return 'Y ' + Math.abs(Y).toFixed(2) + '  X ' + Math.abs(X).toFixed(2); }

    // =====================================================================
    //  Render UI
    // =====================================================================
    function renderAll() { renderVerts(); renderStats(); renderBoundary(); renderDivisionControls(); renderMini(); drawMap(); }

    function renderVerts() {
        var box = document.getElementById('agpc-verts'); if (!box) return;
        if (!state.verts.length) { box.innerHTML = '<div style="opacity:.6;font-size:13px;padding:6px 2px;">Zatím žádné vrcholy. Přidej je tlačítky níže.</div>'; return; }
        var html = '';
        state.verts.forEach(function (v, i) {
            html += '<div class="agpc-vrow">'
                + '<span class="agpc-vn">' + (i + 1) + '</span>'
                + '<span class="agpc-vname">' + esc(v.name || '') + '</span>'
                + '<span class="agpc-vyx">' + fmtYX(v.Y, v.X) + '</span>'
                + '<span class="agpc-vbtns">'
                + '<button type="button" data-act="up" data-i="' + i + '" title="Nahoru">▲</button>'
                + '<button type="button" data-act="down" data-i="' + i + '" title="Dolů">▼</button>'
                + '<button type="button" data-act="del" data-i="' + i + '" title="Smazat">✕</button>'
                + '</span></div>';
        });
        box.innerHTML = html;
        box.querySelectorAll('button[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                var i = parseInt(b.getAttribute('data-i'), 10), act = b.getAttribute('data-act');
                if (act === 'del') removeVertex(i);
                else if (act === 'up') moveVertex(i, -1);
                else if (act === 'down') moveVertex(i, 1);
            });
        });
    }

    function renderStats() {
        var el = document.getElementById('agpc-stats'); if (!el) return;
        var n = state.verts.length;
        var area = n >= 3 ? shoelace(state.verts) : 0;
        var perim = n >= 2 ? perimeter(state.verts) : 0;
        el.innerHTML =
            '<div><span>Výměra</span><b>' + (n >= 3 ? fmtArea(area) : '—') + '</b></div>'
            + '<div><span>Obvod</span><b>' + (n >= 2 ? fmtLen(perim) : '—') + '</b></div>'
            + '<div><span>Vrcholů</span><b>' + n + '</b></div>';
    }

    function renderBoundary() {
        var el = document.getElementById('agpc-bound'); if (!el) return;
        var n = state.verts.length;
        if (n < 2) { el.innerHTML = '<div style="opacity:.6;font-size:13px;">Přidej alespoň 2 vrcholy.</div>'; return; }
        var html = '<table class="agpc-tbl"><thead><tr><th>Strana</th><th>Délka</th><th>Směrník</th></tr></thead><tbody>';
        for (var i = 0; i < n; i++) {
            var a = state.verts[i], b = state.verts[(i + 1) % n];
            if (i === n - 1 && n < 3) break; // u 2 bodů jen jedna strana
            var L = segLen(a, b), s = smernik(a, b);
            html += '<tr><td>' + (i + 1) + '→' + ((i + 1) % n + 1) + '</td><td>' + L.toFixed(2) + ' m</td>'
                + '<td>' + radToGon(s).toFixed(4) + ' g<br><span style="opacity:.6">' + radToDeg(s).toFixed(4) + '°</span></td></tr>';
        }
        html += '</tbody></table>';
        el.innerHTML = html;
    }

    function renderDivisionControls() {
        var el = document.getElementById('agpc-div-controls'); if (!el) return;
        var n = state.verts.length;
        if (n < 3) { el.innerHTML = '<div style="opacity:.6;font-size:13px;">Dělení je dostupné od 3 vrcholů.</div>'; return; }
        var edgeOpts = '', vertOpts = '';
        for (var i = 0; i < n; i++) {
            edgeOpts += '<option value="' + i + '">strana ' + (i + 1) + '→' + ((i + 1) % n + 1) + '</option>';
            vertOpts += '<option value="' + i + '">vrchol ' + (i + 1) + (state.verts[i].name ? ' (' + esc(state.verts[i].name) + ')' : '') + '</option>';
        }
        var total = shoelace(state.verts);
        el.innerHTML =
            '<label class="filter-row" style="font-size:13px;"><input type="radio" name="agpc-method" value="parallel" checked> Rovnoběžně s hranou (odměřit díl u hrany)</label>'
            + '<label class="filter-row" style="font-size:13px;"><input type="radio" name="agpc-method" value="vertex"> Přímkou z vrcholu</label>'
            + '<label class="filter-row" style="font-size:13px;"><input type="radio" name="agpc-method" value="equal"> Na N stejných dílů (rovnoběžně s hranou)</label>'
            + '<div id="agpc-div-row1" style="margin-top:8px;">'
            + '  <label>Hrana / vrchol</label>'
            + '  <select id="agpc-div-edge" class="agpc-sel">' + edgeOpts + '</select>'
            + '  <select id="agpc-div-vert" class="agpc-sel" style="display:none;">' + vertOpts + '</select>'
            + '</div>'
            + '<div id="agpc-div-area-wrap" style="margin-top:8px;">'
            + '  <label>Cílová výměra dílu (m²) — z celku ' + total.toFixed(2) + ' m²</label>'
            + '  <input type="number" id="agpc-div-area" step="0.01" inputmode="decimal" placeholder="např. ' + (total / 2).toFixed(2) + '">'
            + '</div>'
            + '<div id="agpc-div-n-wrap" style="margin-top:8px;display:none;">'
            + '  <label>Počet dílů N</label>'
            + '  <input type="number" id="agpc-div-n" step="1" min="2" value="2" inputmode="numeric">'
            + '</div>'
            + '<button class="btn" id="agpc-div-calc" style="margin-top:12px;"><svg class="icon"><use href="#i-scale"/></svg> Spočítat dělení</button>'
            + '<div id="agpc-div-result" style="margin-top:10px;"></div>';

        el.querySelectorAll('input[name="agpc-method"]').forEach(function (r) {
            r.addEventListener('change', function () { onMethodChange(r.value); });
        });
        document.getElementById('agpc-div-calc').addEventListener('click', computeDivision);
        onMethodChange('parallel');
    }
    function onMethodChange(m) {
        var edge = document.getElementById('agpc-div-edge'), vert = document.getElementById('agpc-div-vert');
        var areaW = document.getElementById('agpc-div-area-wrap'), nW = document.getElementById('agpc-div-n-wrap');
        if (!edge) return;
        if (m === 'vertex') { edge.style.display = 'none'; vert.style.display = ''; areaW.style.display = ''; nW.style.display = 'none'; }
        else if (m === 'equal') { edge.style.display = ''; vert.style.display = 'none'; areaW.style.display = 'none'; nW.style.display = ''; }
        else { edge.style.display = ''; vert.style.display = 'none'; areaW.style.display = ''; nW.style.display = 'none'; }
    }

    function currentMethod() {
        var r = document.querySelector('input[name="agpc-method"]:checked');
        return r ? r.value : 'parallel';
    }

    function computeDivision() {
        var n = state.verts.length;
        if (n < 3) { agAlert('Málo vrcholů', 'Potřebuju aspoň 3 vrcholy.'); return; }
        var method = currentMethod();
        var total = shoelace(state.verts);
        var resEl = document.getElementById('agpc-div-result');
        state.division = null;

        if (method === 'equal') {
            var N = parseInt((document.getElementById('agpc-div-n') || {}).value, 10);
            if (!(N >= 2)) { agAlert('Zadej N', 'Počet dílů musí být alespoň 2.'); return; }
            var edgeI = parseInt(document.getElementById('agpc-div-edge').value, 10) || 0;
            var lines = [], pts = [], areas = [], warnNC = false;
            for (var k = 1; k < N; k++) {
                var sol = solveParallel(state.verts, edgeI, total * k / N);
                if (!sol || sol.crossings.length < 2) continue;
                if (sol.crossings.length > 2) warnNC = true;       // nekonvexní: víc průsečíků s hranicí
                var cs = sol.crossings.slice(0, 2);
                lines.push([cs[0], cs[1]]);
                cs.forEach(function (p) { pts.push(p); });
            }
            for (var q = 0; q < N; q++) areas.push(total / N);
            state.division = { lines: lines, points: enrich(pts), areas: areas, label: 'Rovnoměrné dělení na ' + N + ' dílů' };
            resEl.innerHTML = divResultHTML('Rozděleno na ' + N + ' dílů po ' + fmtArea(total / N) + '.', pts.length);
            if (warnNC) resEl.innerHTML += ncWarnHTML();
        } else if (method === 'vertex') {
            var vI = parseInt(document.getElementById('agpc-div-vert').value, 10) || 0;
            var tA = parseFloat(String((document.getElementById('agpc-div-area') || {}).value).replace(',', '.'));
            if (!isFinite(tA) || tA <= 0 || tA >= total) { agAlert('Neplatná výměra', 'Zadej díl 0 < S < ' + total.toFixed(2) + ' m².'); return; }
            var sv = solveVertex(state.verts, vI, tA);
            if (!sv) { agAlert('Nepovedlo se', 'Zkontroluj geometrii parcely.'); return; }
            if (!sv.valid) {
                agAlert('Dělení z tohoto vrcholu nelze',
                    'Parcela je nekonvexní a dělicí spojnice z vrcholu ' + (vI + 1) + ' vybíhá mimo parcelu — vypočtené výměry by byly ŠPATNĚ.\n\nZkus jiný vrchol, nebo metodu „rovnoběžně s hranou" (ta je korektní i pro nekonvexní tvary).');
                return;
            }
            state.division = { lines: [[sv.V, sv.P]], points: enrich([sv.P]), areas: [sv.area1, sv.area2], label: 'Dělení z vrcholu ' + (vI + 1) };
            resEl.innerHTML = divResultHTML('Díl A = ' + fmtArea(sv.area1) + '<br>Díl B = ' + fmtArea(sv.area2)
                + '<br><span style="opacity:.7">Bod P: ' + fmtYX(sv.P.Y, sv.P.X) + '</span>', 1);
        } else {
            var eI = parseInt(document.getElementById('agpc-div-edge').value, 10) || 0;
            var tA2 = parseFloat(String((document.getElementById('agpc-div-area') || {}).value).replace(',', '.'));
            if (!isFinite(tA2) || tA2 <= 0 || tA2 >= total) { agAlert('Neplatná výměra', 'Zadej díl 0 < S < ' + total.toFixed(2) + ' m².'); return; }
            var sp = solveParallel(state.verts, eI, tA2);
            if (!sp || sp.crossings.length < 2) { agAlert('Nepovedlo se', 'Dělicí čára neprotnula hranici (zkus jinou hranu).'); return; }
            var cs2 = sp.crossings.slice(0, 2);
            state.division = { lines: [[cs2[0], cs2[1]]], points: enrich(cs2), areas: [sp.area1, sp.area2], label: 'Rovnoběžně s hranou ' + (eI + 1) };
            resEl.innerHTML = divResultHTML('Díl A (u hrany) = ' + fmtArea(sp.area1) + '<br>Díl B = ' + fmtArea(sp.area2)
                + '<br><span style="opacity:.7">P1: ' + fmtYX(cs2[0].Y, cs2[0].X) + '<br>P2: ' + fmtYX(cs2[1].Y, cs2[1].X) + '</span>', 2);
            if (sp.crossings.length > 2) resEl.innerHTML += ncWarnHTML();   // nekonvexní parcela
        }
        drawMap();
        draftSave();   // spočítané dělení je součást rozdělané práce
        var dc = document.getElementById('agpc-div-savebtn');
        if (dc) dc.addEventListener('click', saveDivisionPoints);
    }
    function divResultHTML(inner, nPts) {
        return '<div class="agpc-divbox">' + inner
            + '<button class="btn" id="agpc-div-savebtn" style="margin-top:10px;"><svg class="icon"><use href="#i-plus"/></svg> Uložit ' + nPts + ' lomových bodů do zakázky</button></div>';
    }
    // Nekonvexní parcela: dělicí čára protíná hranici na více než 2 místech. Výměry dílů
    // (areaClip) jsou správné, ale nakreslená čára / uložené body popíší jen první dva
    // průsečíky — varuj, ať uživatel nedůvěřuje neúplné čáře.
    function ncWarnHTML() {
        return '<div style="margin-top:8px;color:#fbbf24;font-size:12px;line-height:1.4;">⚠ Parcela je nekonvexní – dělicí čára protíná hranici na více místech. Výměry dílů jsou správné, ale nakreslená čára a uložené body nemusí dělení popsat úplně. Ověř geometrii ručně.</div>';
    }
    function enrich(pts) {
        return pts.map(function (p) { var ll = yxToLL(p.Y, p.X); return { Y: p.Y, X: p.X, lat: ll.lat, lng: ll.lng }; });
    }
    function saveDivisionPoints() {
        if (!state.division || !state.division.points || !state.division.points.length) { agAlert('Nic k uložení', 'Nejdřív spočítej dělení.'); return; }
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Funkce pro vkládání bodů není dostupná.'); return; }
        var prefix = 'DEL';
        var arr = state.division.points.map(function (p, i) { return { name: prefix + (i + 1), lat: p.lat, lng: p.lng }; });
        var added = window.addImportedPoints(arr);
        if (added > 0) { draftClear(); agAlert('Uloženo', added + ' lomových bodů uloženo do aktuální zakázky (názvy ' + prefix + '1…).'); }
        else { agAlert('Neuloženo', 'Body se stejnou polohou už v zakázce jsou.'); }
    }

    // =====================================================================
    //  Export
    // =====================================================================
    function download(name, text, mime) {
        try {
            var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = name;
            document.body.appendChild(a); a.click();
            setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
        } catch (e) { agAlert('Export selhal', String(e)); }
    }
    function exportCSV() {
        if (state.verts.length < 1) { agAlert('Prázdné', 'Žádné vrcholy.'); return; }
        var lines = state.verts.map(function (v, i) { return (v.name || ('V' + (i + 1))) + ';' + Math.abs(v.Y).toFixed(2) + ';' + Math.abs(v.X).toFixed(2); });
        download('parcela_souradnice.csv', '﻿' + 'cislo;Y;X\n' + lines.join('\n'), 'text/csv');
        draftClear();   // export = úloha dokončena
    }
    function exportProtokol() {
        if (state.verts.length < 3) { agAlert('Málo vrcholů', 'Protokol dává smysl od 3 vrcholů.'); return; }
        var n = state.verts.length, lines = [];
        lines.push('AR Geodet — PARCELA / protokol');
        lines.push('Vygenerováno: ' + new Date().toLocaleString('cs-CZ'));
        lines.push('Souřadnicový systém: S-JTSK (EPSG:5514), výměra Gaussovým vzorcem.');
        lines.push('');
        lines.push('SEZNAM SOUŘADNIC (číslo; Y; X):');
        state.verts.forEach(function (v, i) { lines.push('  ' + (v.name || ('V' + (i + 1))) + '; ' + Math.abs(v.Y).toFixed(2) + '; ' + Math.abs(v.X).toFixed(2)); });
        lines.push('');
        lines.push('VÝMĚRA: ' + fmtArea(shoelace(state.verts)));
        lines.push('OBVOD:  ' + fmtLen(perimeter(state.verts)));
        lines.push('');
        lines.push('POPIS HRANICE (strana: délka; směrník):');
        for (var i = 0; i < n; i++) {
            var a = state.verts[i], b = state.verts[(i + 1) % n];
            var L = segLen(a, b), s = smernik(a, b);
            lines.push('  ' + (i + 1) + '→' + ((i + 1) % n + 1) + ': ' + L.toFixed(2) + ' m; ' + radToGon(s).toFixed(4) + ' g (' + radToDeg(s).toFixed(4) + '°)');
        }
        if (state.division) {
            lines.push('');
            lines.push('DĚLENÍ — ' + state.division.label);
            (state.division.areas || []).forEach(function (ar, i) { lines.push('  Díl ' + String.fromCharCode(65 + i) + ': ' + fmtArea(ar)); });
            (state.division.points || []).forEach(function (p, i) { lines.push('  Lomový bod DEL' + (i + 1) + ': Y ' + Math.abs(p.Y).toFixed(2) + '  X ' + Math.abs(p.X).toFixed(2)); });
        }
        lines.push('');
        lines.push('Orientační podklad, ne nahrazuje úřední měření.');
        download('parcela_protokol.txt', lines.join('\n'), 'text/plain');
        draftClear();   // export = úloha dokončena
    }

    // =====================================================================
    //  Add panely (z bodů / Y,X)
    // =====================================================================
    function toggleAddMode(m) {
        state.addMode = (state.addMode === m) ? null : m;
        var pp = document.getElementById('agpc-add-point'), py = document.getElementById('agpc-add-yx');
        if (pp) pp.style.display = (state.addMode === 'point') ? 'block' : 'none';
        if (py) py.style.display = (state.addMode === 'yx') ? 'block' : 'none';
        if (state.addMode === 'point') fillPointSelect();
    }
    function fillPointSelect() {
        var sel = document.getElementById('agpc-ptsel'); if (!sel) return;
        if (typeof arPoints === 'undefined' || !arPoints.length) { sel.innerHTML = '<option value="">— žádné body v zakázce —</option>'; return; }
        sel.innerHTML = arPoints.filter(function (p) { return !p.hidden; }).map(function (p) {
            return '<option value="' + p.id + '">#' + esc(p.name) + '</option>';
        }).join('');
    }
    function addFromPoint() {
        var sel = document.getElementById('agpc-ptsel'); if (!sel || !sel.value || typeof arPoints === 'undefined') return;
        var p = arPoints.find(function (q) { return q.id === sel.value; });
        if (p) { addVertexLL(p.lat, p.lng, p.name); toast('Vrchol #' + p.name + ' přidán'); }
    }
    function addFromYX() {
        var Y = parseFloat(String((document.getElementById('agpc-in-y') || {}).value).replace(',', '.'));
        var X = parseFloat(String((document.getElementById('agpc-in-x') || {}).value).replace(',', '.'));
        var nm = (document.getElementById('agpc-in-name') || {}).value || '';
        if (!isFinite(Y) || !isFinite(X)) { agAlert('Neplatné Y,X', 'Zadej obě hodnoty v metrech (např. Y 596956.46, X 1163343.34).'); return; }
        addVertexYX(Y, X, nm.trim() || null);
        var iy = document.getElementById('agpc-in-y'), ix = document.getElementById('agpc-in-x'), inn = document.getElementById('agpc-in-name');
        if (iy) iy.value = ''; if (ix) ix.value = ''; if (inn) inn.value = '';
        toast('Vrchol z Y,X přidán');
    }

    // =====================================================================
    //  Minimalizace (odkrytí mapy)
    // =====================================================================
    function minimize(on) {
        state.minimized = !!on;
        var modal = document.getElementById('agpc-modal');
        var mini = document.getElementById('agpc-mini');
        if (modal) modal.style.display = on ? 'none' : 'flex';
        if (mini) mini.classList.toggle('show', !!on && !state.picking);
        if (on) { renderMini(); }
    }
    function renderMini() {
        var mini = document.getElementById('agpc-mini'); if (!mini) return;
        var n = state.verts.length, area = n >= 3 ? fmtArea(shoelace(state.verts)) : '—';
        var info = mini.querySelector('.agpc-mini-info');
        if (info) info.innerHTML = '<b>Parcela</b> · ' + n + ' vrcholů · ' + area;
    }

    // =====================================================================
    //  Modal
    // =====================================================================
    function ensureModal() {
        if (document.getElementById('agpc-modal')) return;
        injectStyles();
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agpc-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content">'
            + '<div class="agpc-head">'
            + '  <h3 style="color:var(--accent);margin:0;flex:1;">' + ICON + ' Parcela — geometrie &amp; dělení</h3>'
            + '  <button type="button" class="agpc-hbtn" id="agpc-min" title="Minimalizovat (ukázat mapu)">—</button>'
            + '  <button type="button" class="agpc-hbtn" id="agpc-close" title="Zavřít">✕</button>'
            + '</div>'
            + '<div class="modal-body">'
            // --- vrcholy ---
            + '<div class="agpc-sec-h">Vrcholy parcely</div>'
            + '<div id="agpc-verts"></div>'
            + '<div class="agpc-addrow">'
            + '  <button type="button" class="btn btn-secondary agpc-addbtn" id="agpc-b-map"><svg class="icon"><use href="#i-map-pin"/></svg> Z mapy</button>'
            + '  <button type="button" class="btn btn-secondary agpc-addbtn" id="agpc-b-point"><svg class="icon"><use href="#i-list"/></svg> Z bodu</button>'
            + '  <button type="button" class="btn btn-secondary agpc-addbtn" id="agpc-b-yx"><svg class="icon"><use href="#i-edit"/></svg> Y,X</button>'
            + '  <button type="button" class="btn btn-secondary agpc-addbtn" id="agpc-b-gps"><svg class="icon"><use href="#i-locate"/></svg> GPS</button>'
            + '</div>'
            + '<div id="agpc-add-point" class="agpc-addpanel" style="display:none;">'
            + '  <select id="agpc-ptsel" class="agpc-sel"></select>'
            + '  <button type="button" class="btn" id="agpc-ptadd" style="margin-top:8px;"><svg class="icon"><use href="#i-plus"/></svg> Přidat vrchol</button>'
            + '</div>'
            + '<div id="agpc-add-yx" class="agpc-addpanel" style="display:none;">'
            + '  <div style="display:flex;gap:8px;"><input type="number" id="agpc-in-y" step="any" inputmode="decimal" placeholder="Y (m)" style="flex:1;"><input type="number" id="agpc-in-x" step="any" inputmode="decimal" placeholder="X (m)" style="flex:1;"></div>'
            + '  <input type="text" id="agpc-in-name" placeholder="Název (volitelně)" style="margin-top:6px;">'
            + '  <button type="button" class="btn" id="agpc-yxadd" style="margin-top:8px;"><svg class="icon"><use href="#i-plus"/></svg> Přidat vrchol</button>'
            + '</div>'
            + '<div style="display:flex;gap:8px;margin-top:8px;">'
            + '  <button type="button" class="btn btn-secondary" id="agpc-zoom" style="flex:1;margin:0;">Ukázat na mapě</button>'
            + '  <button type="button" class="btn btn-danger" id="agpc-clear" style="flex:1;margin:0;">Vyčistit</button>'
            + '</div>'
            // --- souhrn ---
            + '<div id="agpc-stats" class="agpc-stats"></div>'
            + '<details class="agpc-det"><summary>Popis hranice (délky a směrníky)</summary><div id="agpc-bound"></div></details>'
            // --- dělení ---
            + '<div class="agpc-sec-h" style="margin-top:14px;"><svg class="icon"><use href="#i-scale"/></svg> Dělení parcely</div>'
            + '<div id="agpc-div-controls"></div>'
            // --- export ---
            + '<div style="display:flex;gap:8px;margin-top:16px;">'
            + '  <button type="button" class="btn btn-secondary" id="agpc-exp-txt" style="flex:1;margin:0;"><svg class="icon"><use href="#i-file-text"/></svg> Protokol (TXT)</button>'
            + '  <button type="button" class="btn btn-secondary" id="agpc-exp-csv" style="flex:1;margin:0;"><svg class="icon"><use href="#i-upload"/></svg> Souřadnice (CSV)</button>'
            + '</div>'
            + '</div>'
            + '<button class="btn btn-primary" id="agpc-done" style="margin-top:16px;">Hotovo</button>'
            + '</div>';
        document.body.appendChild(el);

        // minibar
        var mini = document.createElement('div');
        mini.id = 'agpc-mini';
        mini.innerHTML = '<span class="agpc-mini-info"></span><button type="button" id="agpc-mini-open">Rozbalit</button>';
        document.body.appendChild(mini);

        // handlery
        document.getElementById('agpc-min').addEventListener('click', function () { minimize(true); });
        document.getElementById('agpc-close').addEventListener('click', closeTool);
        document.getElementById('agpc-done').addEventListener('click', closeTool);
        document.getElementById('agpc-mini-open').addEventListener('click', function () { minimize(false); });
        document.getElementById('agpc-b-map').addEventListener('click', startPick);
        document.getElementById('agpc-b-point').addEventListener('click', function () { toggleAddMode('point'); });
        document.getElementById('agpc-b-yx').addEventListener('click', function () { toggleAddMode('yx'); });
        document.getElementById('agpc-b-gps').addEventListener('click', addMyGps);
        document.getElementById('agpc-ptadd').addEventListener('click', addFromPoint);
        document.getElementById('agpc-yxadd').addEventListener('click', addFromYX);
        document.getElementById('agpc-zoom').addEventListener('click', function () { minimize(true); zoomToPolygon(); });
        document.getElementById('agpc-clear').addEventListener('click', function () {
            agConfirm('Vyčistit parcelu?', 'Smaže všechny vrcholy i spočítané dělení.').then(function (ok) { if (ok) clearAll(); });
        });
        document.getElementById('agpc-exp-txt').addEventListener('click', exportProtokol);
        document.getElementById('agpc-exp-csv').addEventListener('click', exportCSV);
    }

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

    // =====================================================================
    //  Styly (injektované — ať se nesahá do style.css)
    // =====================================================================
    function injectStyles() {
        if (document.getElementById('agpc-style')) return;
        var st = document.createElement('style'); st.id = 'agpc-style';
        st.textContent = [
            '#agpc-modal .agpc-head{display:flex;align-items:center;gap:6px;margin-bottom:8px;}',
            '#agpc-modal .agpc-hbtn{width:34px;height:34px;flex:0 0 34px;border:1px solid var(--glass-border,rgba(255,255,255,.1));border-radius:10px;',
            '  background:var(--surface-2,rgba(255,255,255,.09));color:var(--text-color,#e8edf2);font-size:16px;line-height:1;cursor:pointer;}',
            '#agpc-modal .agpc-sec-h{font:700 12px/1 var(--font-ui,system-ui),sans-serif;letter-spacing:.06em;text-transform:uppercase;',
            '  color:var(--text-muted,#9aa1ac);margin:6px 0 8px;display:flex;align-items:center;gap:6px;}',
            '#agpc-modal .agpc-sec-h svg{width:15px;height:15px;}',
            '#agpc-verts{display:flex;flex-direction:column;gap:4px;max-height:34vh;overflow:auto;}',
            '.agpc-vrow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:9px;background:var(--surface-2,rgba(255,255,255,.06));font-size:13px;}',
            '.agpc-vrow .agpc-vn{flex:0 0 22px;height:22px;line-height:22px;text-align:center;border-radius:6px;background:var(--accent,#2f9e74);color:#04110b;font-weight:700;}',
            '.agpc-vrow .agpc-vname{flex:0 0 auto;max-width:30%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}',
            '.agpc-vrow .agpc-vyx{flex:1;font-family:var(--font-mono,monospace);font-size:11.5px;opacity:.85;text-align:right;}',
            '.agpc-vrow .agpc-vbtns{flex:0 0 auto;display:flex;gap:3px;}',
            '.agpc-vrow .agpc-vbtns button{width:26px;height:26px;border:none;border-radius:6px;background:var(--surface-3,rgba(255,255,255,.13));color:var(--text-color,#e8edf2);cursor:pointer;font-size:12px;}',
            '.agpc-addrow{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}',
            '.agpc-addrow .agpc-addbtn{flex:1 1 0;min-width:70px;margin:0;padding:9px 6px;font-size:12.5px;}',
            '.agpc-addpanel{margin-top:8px;padding:10px;border-radius:10px;background:var(--surface-2,rgba(255,255,255,.06));}',
            '.agpc-sel{width:100%;}',
            '.agpc-stats{display:flex;gap:8px;margin-top:14px;}',
            '.agpc-stats>div{flex:1;background:var(--accent-soft,rgba(47,158,116,.14));border:1px solid var(--accent-line,rgba(47,158,116,.42));border-radius:11px;padding:8px 6px;text-align:center;}',
            '.agpc-stats>div span{display:block;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;opacity:.7;}',
            '.agpc-stats>div b{display:block;font-family:var(--font-mono,monospace);font-size:13px;margin-top:3px;color:var(--accent,#2f9e74);}',
            '.agpc-det{margin-top:10px;}',
            '.agpc-det>summary{cursor:pointer;font-size:13px;padding:8px 0;color:var(--text-muted,#9aa1ac);}',
            '.agpc-tbl{width:100%;border-collapse:collapse;font-size:12px;}',
            '.agpc-tbl th,.agpc-tbl td{padding:5px 6px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,.1));text-align:left;}',
            '.agpc-tbl th{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;opacity:.6;}',
            '.agpc-tbl td:nth-child(2),.agpc-tbl td:nth-child(3){font-family:var(--font-mono,monospace);}',
            '.agpc-divbox{padding:10px 12px;border-radius:10px;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.4);font-size:13px;font-family:var(--font-mono,monospace);}',
            '#agpc-pick{position:fixed;inset:0;z-index:100000;display:none;}',
            '#agpc-pick.show{display:block;}',
            '#agpc-pick-hint{position:fixed;left:12px;right:12px;bottom:20px;z-index:100002;display:flex;align-items:center;gap:10px;',
            '  padding:12px 14px;border-radius:14px;background:var(--bg-elev,#171b20);border:1px solid var(--accent,#2f9e74);',
            '  box-shadow:0 10px 30px rgba(0,0,0,.5);font-size:13px;color:var(--text-color,#e8edf2);}',
            '#agpc-pick-hint span{flex:1;}#agpc-pick-hint svg{width:16px;height:16px;vertical-align:-2px;}',
            '#agpc-pick-hint button{flex:0 0 auto;border:none;border-radius:9px;padding:9px 16px;background:var(--accent,#2f9e74);color:#04110b;font-weight:700;cursor:pointer;}',
            '#agpc-mini{position:fixed;left:12px;right:12px;bottom:20px;z-index:99998;display:none;align-items:center;gap:10px;',
            '  padding:11px 14px;border-radius:14px;background:var(--bg-elev,#171b20);border:1px solid var(--glass-border,rgba(255,255,255,.12));',
            '  box-shadow:0 10px 30px rgba(0,0,0,.5);font-size:13px;color:var(--text-color,#e8edf2);}',
            '#agpc-mini.show{display:flex;}',
            '#agpc-mini .agpc-mini-info{flex:1;}#agpc-mini b{color:var(--accent,#2f9e74);}',
            '#agpc-mini button{flex:0 0 auto;border:none;border-radius:9px;padding:9px 16px;background:var(--accent,#2f9e74);color:#04110b;font-weight:700;cursor:pointer;}',
            '.agpc-arealbl{background:rgba(0,0,0,.6);color:#fff;border-radius:8px;padding:2px 8px;font:600 11px/1.4 var(--font-mono,monospace);white-space:nowrap;text-align:center;}',
            '.leaflet-tooltip.agpc-vtip{background:var(--accent,#2f9e74);color:#04110b;border:none;font-weight:700;padding:1px 6px;box-shadow:none;}',
            '.leaflet-tooltip.agpc-vtip:before{display:none;}',
            '#agpc-toast{position:fixed;left:50%;bottom:120px;transform:translateX(-50%) translateY(10px);z-index:100003;',
            '  padding:10px 16px;border-radius:12px;background:var(--bg-elev,#171b20);border:1px solid var(--accent,#2f9e74);',
            '  color:var(--text-color,#e8edf2);font-size:13px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;}',
            '#agpc-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // =====================================================================
    //  Otevření / zavření / registrace
    // =====================================================================
    function openTool() {
        ensureModal();
        ensureLayer();
        state.minimized = false;
        var modal = document.getElementById('agpc-modal');
        var mini = document.getElementById('agpc-mini');
        if (mini) mini.classList.remove('show');
        if (modal) modal.style.display = 'flex';
        renderAll();
        zoomToPolygon();
    }
    function closeTool() {
        stopPick();
        var modal = document.getElementById('agpc-modal'); if (modal) modal.style.display = 'none';
        var mini = document.getElementById('agpc-mini'); if (mini) mini.classList.remove('show');
        // Kresba parcely i dělení patří k otevřenému nástroji — po zavření by v mapě jen
        // překážela. Data (vrcholy i dělení) zůstávají ve `state`, po otevření se překreslí.
        clearLayer();
    }
    window.agOpenParcela = openTool;
    window.agCloseParcela = closeTool;

    function fallbackButton() {
        if (document.getElementById('agpc-fab') || document.getElementById('ag-ft-fab')) return; // launcher má přednost
        if (typeof appStarted === 'undefined' || !appStarted) return;
        injectStyles();
        var b = document.createElement('button');
        b.id = 'agpc-fab'; b.type = 'button'; b.title = 'Parcela';
        b.style.cssText = 'position:fixed;right:12px;bottom:160px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#2f9e74);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,.45);cursor:pointer;';
        b.innerHTML = ICON;
        var svg = b.querySelector('svg'); if (svg) { svg.style.width = '24px'; svg.style.height = '24px'; }
        b.addEventListener('click', openTool);
        document.body.appendChild(b);
    }

    function register() {
        // obnova rozdělané parcely přes lištu „Pokračovat" (AGDraft je odpojitelný)
        if (window.AGDraft) try {
            window.AGDraft.register(DRAFT_KEY, {
                label: 'Parcela',
                open: function (st) {
                    if (st && st.verts && st.verts.length) { state.verts = st.verts; state.division = st.division || null; }
                    openTool();   // renderAll + drawMap uvnitř překreslí obnovený stav
                }
            });
        } catch (e) {}
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'parcela', label: 'Parcela / dělení', icon: ICON, onClick: openTool, order: 15 });
        } else {
            // launcher zatím není — zkus znovu za chvíli, jinak nouzové tlačítko
            setTimeout(function () {
                if (typeof window.agRegisterFieldTool === 'function') {
                    window.agRegisterFieldTool({ id: 'parcela', label: 'Parcela / dělení', icon: ICON, onClick: openTool, order: 15 });
                } else { fallbackButton(); }
            }, 1200);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 400); });
})();
