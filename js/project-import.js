// ===== AR Geodet — IMPORT PROJEKTU (DXF / situace) + VYTYČENÍ (ODPOJITELNÁ) ====
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js — čte globály (map, L,
// userLat/userLng, currentHeading, window._arProj, arPoints, highlightedPointId)
// a ukládá body přes oficiální window.addImportedPoints().
//
// CO UMÍ:
//   • Naimportovat DXF (POINT / LINE / LWPOLYLINE / POLYLINE / TEXT / CIRCLE) v
//     S-JTSK (Křovák — kladný geodetický i záporný CAD; sjtskToLatLng si poradí).
//   • Zobrazit návrh PŘES MAPU i v AR KAMEŘE (vrstvy DXF lze zapínat/vypínat).
//   • VYTYČIT: u každého lomového bodu „Vytyčit" → uloží se jako bod zakázky a
//     appka na něj navádí svojí 3D šipkou; nebo „Přenést vše do bodů zakázky".
//   • Georeferencovat RASTR (foto/sken situace) dvěma body → poloprůhledný
//     podklad nad mapou (posun/otočení/měřítko dopočítané ze 2 bodů).
//
// Návrh se ukládá per zakázka (getStoredData/setStoredData → klíč 'agProjectDesign').
// Vstup: tlačítko „Import projektu (DXF/situace)" v launcheru (field-tools.js).
// Odstranění: smaž js/project-import.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4"/><path d="M3 17l9 4 9-4"/></svg>';
    var KEY = 'agProjectDesign';
    var COLORS = { line: '#e879f9', point: '#f0abfc', text: '#fde68a', poly: '#c084fc' };

    var _design = null;        // {layers:{name:{on}}, points:[], segs:[], texts:[]}  (lat/lng)
    var _raster = null;        // {url, w, h, cp:[{ix,iy,lat,lng}], opacity, on}
    var _mapGroup = null;      // L.layerGroup
    var _arSvg = null, _arRAF = null, _arOn = true, _arIdleT = 0;
    var _rasterEl = null;

    // ---- pomocné ---------------------------------------------------------------
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function sj2ll(a, b) {
        try { if (typeof sjtskToLatLng === 'function') return sjtskToLatLng(a, b); } catch (e) {}
        var Y = Math.min(Math.abs(a), Math.abs(b)), X = Math.max(Math.abs(a), Math.abs(b));
        var w = proj4('EPSG:5514', 'EPSG:4326', [-Y, -X]); return { lat: w[1], lng: w[0] };
    }
    function inCZ(ll) { return ll && ll.lat > 48 && ll.lat < 51.2 && ll.lng > 11.8 && ll.lng < 19.2; }

    // ---- DXF parser (ASCII, minimalní ale robustní) ---------------------------
    function parseDXF(text) {
        // čtení dvojic (code, value)
        var lines = text.split(/\r\n|\r|\n/);
        var pairs = [];
        for (var i = 0; i + 1 < lines.length; i += 2) {
            var code = parseInt(lines[i].trim(), 10);
            pairs.push({ c: isNaN(code) ? -1 : code, v: lines[i + 1] });
        }
        var pts = [], segs = [], texts = [], layers = {};
        var i2 = 0, N = pairs.length;
        // přeskoč na ENTITIES
        while (i2 < N && !(pairs[i2].c === 2 && /ENTITIES/i.test(pairs[i2].v))) i2++;
        function addLayer(n) { n = n || '0'; if (!layers[n]) layers[n] = { on: true }; return n; }
        function pushSeg(la, x1, y1, x2, y2) {
            var A = sj2ll(x1, y1), B = sj2ll(x2, y2);
            segs.push({ layer: la, a: A, b: B });
        }
        // stav pro starou POLYLINE (vrcholy ve VERTEX entitách až po SEQEND)
        var polyOpen = false, polyVerts = [], polyLayer = '0', polyClosed = false;
        function flushPoly() {
            if (polyVerts.length >= 2) {
                for (var k = 0; k + 1 < polyVerts.length; k++) pushSeg(polyLayer, polyVerts[k].x, polyVerts[k].y, polyVerts[k + 1].x, polyVerts[k + 1].y);
                if (polyClosed && polyVerts.length > 2) pushSeg(polyLayer, polyVerts[polyVerts.length - 1].x, polyVerts[polyVerts.length - 1].y, polyVerts[0].x, polyVerts[0].y);
            }
            polyOpen = false; polyVerts = [];
        }
        i2++;
        while (i2 < N) {
            var p = pairs[i2];
            if (p.c === 0 && /ENDSEC/i.test(p.v)) { if (polyOpen) flushPoly(); break; }
            if (p.c !== 0) { i2++; continue; }
            var type = (p.v || '').trim().toUpperCase();
            // sber atributů entity: 10/20 = body, 11/21 = druhý bod (LINE), zbytek do ent[code]
            var ent = {}; var j = i2 + 1;
            var verts = [];
            while (j < N && pairs[j].c !== 0) {
                var cc = pairs[j].c, vv = pairs[j].v;
                if (cc === 10) { verts.push({ x: parseFloat(vv) }); }
                else if (cc === 20) { if (verts.length) verts[verts.length - 1].y = parseFloat(vv); }
                else if (cc === 11) { verts.push({ x: parseFloat(vv) }); }
                else if (cc === 21) { if (verts.length) verts[verts.length - 1].y = parseFloat(vv); }
                else { if (ent[cc] === undefined) ent[cc] = vv; }
                j++;
            }
            var la = addLayer(ent[8] ? String(ent[8]).trim() : '0');
            try {
                if (type === 'POLYLINE') {              // stará polyline — sbírej následující VERTEX entity
                    polyOpen = true; polyVerts = []; polyLayer = la; polyClosed = !!(ent[70] && (parseInt(ent[70], 10) & 1));
                } else if (type === 'VERTEX' && polyOpen) {
                    if (verts.length && verts[0].y != null) polyVerts.push({ x: verts[0].x, y: verts[0].y });
                } else if (type === 'SEQEND' && polyOpen) {
                    flushPoly();
                } else if (type === 'POINT' && verts.length) {
                    var ll = sj2ll(verts[0].x, verts[0].y);
                    pts.push({ layer: la, lat: ll.lat, lng: ll.lng, name: null });
                } else if (type === 'LINE' && verts.length >= 2 && verts[0].y != null && verts[1].y != null) {
                    pushSeg(la, verts[0].x, verts[0].y, verts[1].x, verts[1].y);
                } else if (type === 'LWPOLYLINE' && verts.length >= 2) {
                    var closed = ent[70] && (parseInt(ent[70], 10) & 1);
                    for (var k = 0; k + 1 < verts.length; k++) {
                        if (verts[k].y == null || verts[k + 1].y == null) continue;
                        pushSeg(la, verts[k].x, verts[k].y, verts[k + 1].x, verts[k + 1].y);
                    }
                    if (closed && verts.length > 2) pushSeg(la, verts[verts.length - 1].x, verts[verts.length - 1].y, verts[0].x, verts[0].y);
                } else if ((type === 'TEXT' || type === 'MTEXT') && verts.length && ent[1] != null) {
                    var llt = sj2ll(verts[0].x, verts[0].y);
                    texts.push({ layer: la, lat: llt.lat, lng: llt.lng, text: String(ent[1]).replace(/\\[A-Za-z][^;]*;|[{}]/g, '').trim() });
                } else if (type === 'CIRCLE' && verts.length && ent[40] != null) {
                    var r = parseFloat(ent[40]); var cx = verts[0].x, cy = verts[0].y;
                    var prev = null, first = null;
                    for (var a = 0; a <= 24; a++) {
                        var ang = a / 24 * 2 * Math.PI; var vx = cx + r * Math.cos(ang), vy = cy + r * Math.sin(ang);
                        if (prev) pushSeg(la, prev.x, prev.y, vx, vy); else first = { x: vx, y: vy };
                        prev = { x: vx, y: vy };
                    }
                }
            } catch (e) {}
            i2 = j;
        }
        // pojmenování bodů: POINT entity → P1.., a lomové body čar
        pts.forEach(function (q, idx) { if (!q.name) q.name = 'P' + (idx + 1); });
        return { layers: layers, points: pts, segs: segs, texts: texts };
    }

    // ---- vytěžení lomových bodů (pro vytyčení) --------------------------------
    function stakeVertices() {
        if (!_design) return [];
        var out = [], seen = {};
        function add(lat, lng, name, layer) {
            if (!layerOn(layer)) return;
            var key = lat.toFixed(7) + ',' + lng.toFixed(7);
            if (seen[key]) return; seen[key] = 1;
            out.push({ lat: lat, lng: lng, name: name, layer: layer });
        }
        _design.points.forEach(function (q) { add(q.lat, q.lng, q.name, q.layer); });
        var li = 0;
        _design.segs.forEach(function (s) { li++; add(s.a.lat, s.a.lng, 'L' + li + 'a', s.layer); add(s.b.lat, s.b.lng, 'L' + li + 'b', s.layer); });
        return out;
    }
    function layerOn(name) { return !_design || !_design.layers[name] || _design.layers[name].on !== false; }

    // ---- render: MAPA ----------------------------------------------------------
    function ensureMapGroup() {
        var m = getMap(); if (!m || typeof L === 'undefined') return null;
        if (!_mapGroup) _mapGroup = L.layerGroup().addTo(m);
        return _mapGroup;
    }
    function drawMap() {
        var g = ensureMapGroup(); if (!g) return; g.clearLayers();
        if (!_design) return;
        _design.segs.forEach(function (s) {
            if (!layerOn(s.layer)) return;
            L.polyline([[s.a.lat, s.a.lng], [s.b.lat, s.b.lng]], { color: COLORS.line, weight: 3, opacity: 0.9, interactive: false }).addTo(g);
        });
        _design.points.forEach(function (q) {
            if (!layerOn(q.layer)) return;
            L.circleMarker([q.lat, q.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: COLORS.point, fillOpacity: 1, interactive: true })
                .bindTooltip('#' + q.name, { direction: 'top' }).addTo(g);
        });
        _design.texts.forEach(function (t) {
            if (!layerOn(t.layer) || !t.text) return;
            L.marker([t.lat, t.lng], { interactive: false, icon: L.divIcon({ className: 'agpi-txt', html: '<span>' + escapeHtml(t.text) + '</span>', iconSize: [0, 0] }) }).addTo(g);
        });
    }
    function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function fitMap() {
        var m = getMap(); if (!m || !_design) return;
        var lls = [];
        _design.segs.forEach(function (s) { if (layerOn(s.layer)) { lls.push([s.a.lat, s.a.lng], [s.b.lat, s.b.lng]); } });
        _design.points.forEach(function (q) { if (layerOn(q.layer)) lls.push([q.lat, q.lng]); });
        if (lls.length) { try { m.fitBounds(L.latLngBounds(lls).pad(0.2)); } catch (e) {} }
    }

    // ---- render: AR (vlastní SVG overlay + lehká rAF smyčka) ------------------
    function arOverlayEl() { return document.getElementById('ar-overlay'); }
    function projAR(lat, lng, heading, pj, eyeH, vOff) {
        var dist = getDistance(userLat, userLng, lat, lng);
        var bearing = getBearing(userLat, userLng, lat, lng);
        var diff = ((bearing - heading + 540) % 360) - 180;
        var uH = diff, vV = Math.atan2(eyeH, Math.max(dist, 0.5)) * 180 / Math.PI - pj.pitch;
        if (pj.roll) { var cr = Math.cos(pj.roll), sr = Math.sin(pj.roll); var tt = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = tt; }
        return { x: 50 + (uH / pj.halfH) * 50, y: 50 + (vV / pj.halfV) * 50 - vOff, diff: diff, dist: dist };
    }
    function ensureArSvg() {
        var ov = arOverlayEl(); if (!ov) return null;
        if (!_arSvg) {
            _arSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            _arSvg.setAttribute('viewBox', '0 0 100 100'); _arSvg.setAttribute('preserveAspectRatio', 'none');
            _arSvg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
            ov.appendChild(_arSvg);
        }
        return _arSvg;
    }
    function arLoop() {
        var svg = _arSvg;
        // BATERIE: bez načteného návrhu / v režimu Mapa / na pozadí nedrž 60 Hz řetěz snímků,
        // stačí kontrola 3×/s. Jakmile je co kreslit, smyčka se rozjede zpět na každý snímek.
        if (!svg || !_arOn || !_design || !haveUser() || !window._arProj
            || (typeof viewMode !== 'undefined' && viewMode === 'map')
            || document.visibilityState !== 'visible') {
            if (svg && svg.childNodes.length) svg.innerHTML = '';
            _arRAF = null;
            _arIdleT = setTimeout(function () { _arIdleT = 0; if (!_arRAF) _arRAF = requestAnimationFrame(arLoop); }, 300);
            return;
        }
        _arRAF = requestAnimationFrame(arLoop);
        var pj = window._arProj;
        var heading = (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null;
        if (heading == null) { svg.innerHTML = ''; return; }
        var eyeH = 1.6, vOff = 0; try { eyeH = visSettings.eyeHeight || 1.6; vOff = visSettings.arVerticalOffset || 0; } catch (e) {}
        var rad = (typeof arRadius !== 'undefined' && arRadius) ? arRadius : 150;
        var html = '';
        _design.segs.forEach(function (s) {
            if (!layerOn(s.layer)) return;
            var pa = projAR(s.a.lat, s.a.lng, heading, pj, eyeH, vOff), pb = projAR(s.b.lat, s.b.lng, heading, pj, eyeH, vOff);
            if (Math.min(pa.dist, pb.dist) > rad * 2) return;
            if (Math.abs(pa.diff) > 120 || Math.abs(pb.diff) > 120) return;
            html += '<line x1="' + pa.x.toFixed(2) + '" y1="' + pa.y.toFixed(2) + '" x2="' + pb.x.toFixed(2) + '" y2="' + pb.y.toFixed(2) + '" stroke="' + COLORS.line + '" stroke-width="3" stroke-linecap="round" opacity="0.9" vector-effect="non-scaling-stroke"/>';
        });
        _design.points.forEach(function (q) {
            if (!layerOn(q.layer)) return;
            var p = projAR(q.lat, q.lng, heading, pj, eyeH, vOff);
            if (p.dist > rad * 2 || Math.abs(p.diff) > 110) return;
            html += '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="1.1" fill="' + COLORS.point + '" stroke="#fff" stroke-width="0.4" vector-effect="non-scaling-stroke"/>';
        });
        svg.innerHTML = html;
    }
    function startAr() { if (ensureArSvg() && !_arRAF && !_arIdleT) _arRAF = requestAnimationFrame(arLoop); }
    function stopAr() { if (_arRAF) { cancelAnimationFrame(_arRAF); _arRAF = null; } if (_arIdleT) { clearTimeout(_arIdleT); _arIdleT = 0; } if (_arSvg) _arSvg.innerHTML = ''; }

    // ---- perzistence -----------------------------------------------------------
    function persist() {
        try {
            if (typeof setStoredData !== 'function') return;
            setStoredData(KEY, JSON.stringify({ design: _design, raster: _raster ? { url: _raster.url, w: _raster.w, h: _raster.h, cp: _raster.cp, opacity: _raster.opacity, on: _raster.on } : null }));
        } catch (e) {}
    }
    function load() {
        try {
            if (typeof getStoredData !== 'function') return;
            var s = getStoredData(KEY); if (!s) return;
            var o = JSON.parse(s);
            _design = o.design || null; _raster = o.raster || null;
            // blob: URL po reloadu nežije — rastr neumíme obnovit, zahoď ho (DXF návrh zůstává)
            if (_raster && (!_raster.url || _raster.url.indexOf('blob:') === 0)) _raster = null;
        } catch (e) { _design = null; }
    }

    // ---- vytyčení: ulož bod + zvýrazni (využije nativní šipku appky) ----------
    function stakeOut(v) {
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze', 'Vkládání bodů není dostupné.'); return; }
        var name = 'V_' + v.name;
        window.addImportedPoints([{ name: name, lat: v.lat, lng: v.lng }]);
        // najdi uložený bod a zvýrazni přes globální highlightedPointId (pohání AR šipku)
        var pid = null;
        try {
            var arr = (typeof persistentCustomPoints !== 'undefined') ? persistentCustomPoints : [];
            var hit = arr.find(function (p) { return p.name === name && Math.abs(p.lat - v.lat) < 1e-6 && Math.abs(p.lng - v.lng) < 1e-6; });
            if (hit) pid = hit.id;
        } catch (e) {}
        if (pid != null) {
            try { highlightedPointId = pid; } catch (e) {}
            try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) {}
            try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) {}
            try { if (typeof updateInfoPanel === 'function') updateInfoPanel(); } catch (e) {}
        }
        closeModal();
        toast('Vytyčuji #' + name + ' — sleduj šipku v AR');
    }
    function transferAll() {
        var vs = stakeVertices(); if (!vs.length) { agAlert('Nic k přenosu', 'Žádné body ve viditelných vrstvách.'); return; }
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze', 'Vkládání bodů není dostupné.'); return; }
        var added = window.addImportedPoints(vs.map(function (v) { return { name: 'V_' + v.name, lat: v.lat, lng: v.lng }; }));
        agAlert('Přeneseno', added + ' bodů návrhu uloženo do zakázky. Najdeš je v seznamu Body a navigovat můžeš nativní šipkou i nástrojem Vytyčení přímky.');
        renderStakeList();
    }

    // ===== RASTR (situace) — georeference 2 body ================================
    function ensureRasterEl() {
        var m = getMap(); if (!m) return null;
        if (!_rasterEl) {
            _rasterEl = document.createElement('img');
            _rasterEl.id = 'agpi-raster';
            _rasterEl.style.cssText = 'position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none;z-index:300;will-change:transform;';
            m.getContainer().appendChild(_rasterEl);
            m.on('move zoom viewreset resize zoomanim', drawRaster);
        }
        return _rasterEl;
    }
    function drawRaster() {
        var m = getMap(); if (!m) return;
        var el = _rasterEl;
        if (!_raster || !_raster.on || !_raster.cp || _raster.cp.length < 2 || !el) { if (el) el.style.display = 'none'; return; }
        el.style.display = '';
        el.style.opacity = (_raster.opacity != null ? _raster.opacity : 0.6);
        var c1 = _raster.cp[0], c2 = _raster.cp[1];
        var p1 = m.latLngToContainerPoint([c1.lat, c1.lng]), p2 = m.latLngToContainerPoint([c2.lat, c2.lng]);
        var dix = c2.ix - c1.ix, diy = c2.iy - c1.iy;
        var dlx = p2.x - p1.x, dly = p2.y - p1.y;
        var di = Math.hypot(dix, diy) || 1, dl = Math.hypot(dlx, dly) || 1;
        var s = dl / di;
        var ang = Math.atan2(dly, dlx) - Math.atan2(diy, dix);
        var ca = Math.cos(ang) * s, sa = Math.sin(ang) * s;
        // matrix(a,b,c,d,e,f): x'=a*ix+c*iy+e ; y'=b*ix+d*iy+f  (rotace+scale)
        var a = ca, b = sa, cc = -sa, d = ca;
        var e = p1.x - (a * c1.ix + cc * c1.iy);
        var f = p1.y - (b * c1.ix + d * c1.iy);
        el.style.transform = 'matrix(' + a + ',' + b + ',' + cc + ',' + d + ',' + e + ',' + f + ')';
    }

    // ---- UI --------------------------------------------------------------------
    function ensureModal() {
        if (document.getElementById('agpi-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agpi-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Import projektu a vytyčení</h3>'
            + '<div class="agpi-tabs"><button class="agpi-tab on" data-tab="dxf">DXF / výkres</button><button class="agpi-tab" data-tab="ras">Situace (foto)</button></div>'
            + '<div id="agpi-pane-dxf" class="agpi-pane">'
            + '  <button class="btn btn-blue" id="agpi-dxf-btn"><svg class="icon"><use href="#i-folder"/></svg> Načíst DXF soubor</button>'
            + '  <input type="file" id="agpi-dxf-file" accept=".dxf" style="display:none">'
            + '  <div id="agpi-summary" style="font-size:calc(13px * var(--ag-font-scale, 1));margin:10px 0;opacity:.85;"></div>'
            + '  <div id="agpi-layers" class="agpi-layers"></div>'
            + '  <div class="agpi-toggles">'
            + '    <label class="agpi-sw"><input type="checkbox" id="agpi-ar-on" checked> Zobrazit v AR kameře</label>'
            + '    <button class="btn btn-secondary" id="agpi-fit" style="margin-top:8px;"><svg class="icon"><use href="#i-crosshair"/></svg> Vystředit na mapě</button>'
            + '  </div>'
            + '  <div id="agpi-stake-head" style="font-weight:600;margin:14px 0 6px;display:none;">Vytyčení lomových bodů</div>'
            + '  <div id="agpi-stake" class="agpi-stake"></div>'
            + '  <button class="btn" id="agpi-transfer" style="margin-top:8px;display:none;"><svg class="icon"><use href="#i-download"/></svg> Přenést vše do bodů zakázky</button>'
            + '  <button class="btn btn-danger" id="agpi-clear" style="margin-top:10px;display:none;"><svg class="icon"><use href="#i-trash"/></svg> Odebrat návrh</button>'
            + '</div>'
            + '<div id="agpi-pane-ras" class="agpi-pane" style="display:none;">'
            + '  <p style="font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.8;margin:2px 0 8px;line-height:1.45;">Načti foto/sken situace, pak urči <b>2 kontrolní body</b> (na obrázku → reálná poloha). Podklad se umístí nad mapu.</p>'
            + '  <button class="btn btn-blue" id="agpi-ras-btn"><svg class="icon"><use href="#i-camera"/></svg> Načíst obrázek situace</button>'
            + '  <input type="file" id="agpi-ras-file" accept="image/*" style="display:none">'
            + '  <div id="agpi-ras-wrap" style="display:none;margin-top:10px;">'
            + '    <div style="position:relative;"><canvas id="agpi-ras-canvas" style="width:100%;border-radius:10px;touch-action:none;background:#111;"></canvas></div>'
            + '    <div id="agpi-ras-step" style="font-size:calc(13px * var(--ag-font-scale, 1));margin:8px 0;"></div>'
            + '    <div class="st-slider"><div class="st-slider-head"><span>Průhlednost</span><span><span id="agpi-ras-op">60</span>%</span></div>'
            + '      <input type="range" id="agpi-ras-opacity" min="10" max="100" step="5" value="60"></div>'
            + '    <label class="agpi-sw"><input type="checkbox" id="agpi-ras-on" checked> Zobrazit podklad na mapě</label>'
            + '    <button class="btn btn-danger" id="agpi-ras-clear" style="margin-top:10px;"><svg class="icon"><use href="#i-trash"/></svg> Odebrat podklad</button>'
            + '  </div>'
            + '</div>'
            + '<button class="btn btn-secondary" style="margin-top:14px;" onclick="window.agCloseProjectImport&&window.agCloseProjectImport()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        el.querySelectorAll('.agpi-tab').forEach(function (t) { t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); }); });
        document.getElementById('agpi-dxf-btn').addEventListener('click', function () { document.getElementById('agpi-dxf-file').click(); });
        document.getElementById('agpi-dxf-file').addEventListener('change', onDxfFile);
        document.getElementById('agpi-fit').addEventListener('click', fitMap);
        document.getElementById('agpi-ar-on').addEventListener('change', function () { _arOn = this.checked; if (_arOn) startAr(); else stopAr(); });
        document.getElementById('agpi-transfer').addEventListener('click', transferAll);
        document.getElementById('agpi-clear').addEventListener('click', clearDesign);
        document.getElementById('agpi-ras-btn').addEventListener('click', function () { document.getElementById('agpi-ras-file').click(); });
        document.getElementById('agpi-ras-file').addEventListener('change', onRasterFile);
        document.getElementById('agpi-ras-opacity').addEventListener('input', function () { document.getElementById('agpi-ras-op').innerText = this.value; if (_raster) { _raster.opacity = this.value / 100; drawRaster(); persist(); } });
        document.getElementById('agpi-ras-on').addEventListener('change', function () { if (_raster) { _raster.on = this.checked; drawRaster(); persist(); } });
        document.getElementById('agpi-ras-clear').addEventListener('click', clearRaster);
    }
    function switchTab(tab) {
        document.querySelectorAll('.agpi-tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-tab') === tab); });
        document.getElementById('agpi-pane-dxf').style.display = tab === 'dxf' ? 'block' : 'none';
        document.getElementById('agpi-pane-ras').style.display = tab === 'ras' ? 'block' : 'none';
    }

    // DXF z českých CADů bývá Windows-1250 (názvy vrstev s diakritikou). Zkus UTF-8,
    // při náhradních znacích spadni na Windows-1250. (Sdílí logiku s window._agDecodeBuf.)
    function decodeBuf(buf) {
        if (typeof buf === 'string') return buf;
        if (typeof window._agDecodeBuf === 'function') return window._agDecodeBuf(buf);
        try {
            var utf = new TextDecoder('utf-8', { fatal: false }).decode(buf);
            if (utf.indexOf('�') >= 0) { try { return new TextDecoder('windows-1250').decode(buf); } catch (e) {} }
            return utf;
        } catch (e) { try { return new TextDecoder('windows-1250').decode(buf); } catch (e2) { return ''; } }
    }
    function onDxfFile(ev) {
        var f = ev.target.files && ev.target.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
            try {
                var d = parseDXF(decodeBuf(rd.result));
                var nLand = 0, nTot = 0;
                d.points.forEach(function (q) { nTot++; if (inCZ(q)) nLand++; });
                d.segs.forEach(function (s) { nTot += 2; if (inCZ(s.a)) nLand++; if (inCZ(s.b)) nLand++; });
                if (!d.points.length && !d.segs.length) { agAlert('Prázdný výkres', 'V DXF jsem nenašel žádné body ani čáry (POINT/LINE/LWPOLYLINE).'); return; }
                if (nTot > 0 && nLand / nTot < 0.5) {
                    agAlert('Souřadnice mimo ČR', 'Body výkresu po převodu nepadnou do ČR — DXF nejspíš není v S-JTSK (Křovák), ale v lokálním systému. Pro lokální výkres použij záložku „Situace (foto)" a georeferencuj dvěma body.');
                }
                _design = d; persist(); drawMap(); fitMap(); renderDxf(); startAr();
                toast('Načteno: ' + d.points.length + ' bodů, ' + d.segs.length + ' úseků');
            } catch (e) { agAlert('Chyba čtení DXF', String(e && e.message || e)); }
        };
        rd.readAsArrayBuffer(f);   // binárně kvůli detekci kódování (Windows-1250 / UTF-8)
        ev.target.value = '';
    }

    function renderDxf() {
        var sum = document.getElementById('agpi-summary'); if (!sum) return;
        if (!_design) { sum.innerHTML = '<span style="opacity:.6">Žádný výkres. Načti DXF v S-JTSK.</span>'; document.getElementById('agpi-layers').innerHTML = ''; toggleStakeUi(false); return; }
        sum.innerHTML = '<b>' + _design.points.length + '</b> bodů · <b>' + _design.segs.length + '</b> úseků · <b>' + _design.texts.length + '</b> popisků · <b>' + Object.keys(_design.layers).length + '</b> vrstev';
        var box = document.getElementById('agpi-layers');
        box.innerHTML = Object.keys(_design.layers).map(function (n) {
            var on = _design.layers[n].on !== false;
            return '<label class="agpi-lay"><input type="checkbox" data-layer="' + escapeHtml(n) + '"' + (on ? ' checked' : '') + '><span>' + escapeHtml(n) + '</span></label>';
        }).join('');
        box.querySelectorAll('input').forEach(function (cb) {
            cb.addEventListener('change', function () { var n = cb.getAttribute('data-layer'); if (_design.layers[n]) _design.layers[n].on = cb.checked; persist(); drawMap(); renderStakeList(); });
        });
        toggleStakeUi(true);
        renderStakeList();
    }
    function toggleStakeUi(on) {
        ['agpi-stake-head', 'agpi-transfer', 'agpi-clear'].forEach(function (id) { var e = document.getElementById(id); if (e) e.style.display = on ? 'block' : 'none'; });
    }
    function renderStakeList() {
        var box = document.getElementById('agpi-stake'); if (!box) return;
        var vs = stakeVertices();
        if (!vs.length) { box.innerHTML = '<span style="opacity:.6;font-size:calc(13px * var(--ag-font-scale, 1));">Žádné lomové body ve viditelných vrstvách.</span>'; return; }
        if (haveUser()) vs.sort(function (a, b) { return getDistance(userLat, userLng, a.lat, a.lng) - getDistance(userLat, userLng, b.lat, b.lng); });
        box.innerHTML = vs.slice(0, 60).map(function (v) {
            var d = haveUser() ? getDistance(userLat, userLng, v.lat, v.lng) : null;
            return '<div class="agpi-srow"><span class="agpi-sname">#' + escapeHtml(v.name) + '</span><span class="agpi-sd">' + (d != null ? d.toFixed(0) + ' m' : '') + '</span>'
                + '<button class="agpi-stk" data-lat="' + v.lat + '" data-lng="' + v.lng + '" data-name="' + escapeHtml(v.name) + '">Vytyčit</button></div>';
        }).join('');
        box.querySelectorAll('.agpi-stk').forEach(function (b) {
            b.addEventListener('click', function () { stakeOut({ lat: parseFloat(b.getAttribute('data-lat')), lng: parseFloat(b.getAttribute('data-lng')), name: b.getAttribute('data-name') }); });
        });
    }
    function clearDesign() {
        if (!confirm('Odebrat naimportovaný návrh z této zakázky?')) return;
        _design = null; persist(); drawMap(); stopAr(); renderDxf();
    }

    // ---- raster: výběr obrázku + 2 kontrolní body ------------------------------
    var _rasImg = null, _rasStep = 0, _rasTmp = [];
    function onRasterFile(ev) {
        var f = ev.target.files && ev.target.files[0]; if (!f) return;
        var url = URL.createObjectURL(f);
        var img = new Image();
        img.onload = function () {
            _rasImg = img; _rasStep = 1; _rasTmp = [];
            _raster = { url: url, w: img.naturalWidth, h: img.naturalHeight, cp: [], opacity: 0.6, on: true };
            document.getElementById('agpi-ras-wrap').style.display = 'block';
            drawRasCanvas(); updateRasStep();
        };
        img.src = url; ev.target.value = '';
    }
    function drawRasCanvas() {
        var cv = document.getElementById('agpi-ras-canvas'); if (!cv || !_rasImg) return;
        var maxW = 520, scale = Math.min(1, maxW / _rasImg.naturalWidth);
        cv.width = Math.round(_rasImg.naturalWidth * scale); cv.height = Math.round(_rasImg.naturalHeight * scale);
        cv._scale = scale;
        var ctx = cv.getContext('2d'); ctx.drawImage(_rasImg, 0, 0, cv.width, cv.height);
        _rasTmp.forEach(function (p, i) {
            var x = p.ix * scale, y = p.iy * scale;
            ctx.strokeStyle = '#34d399'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke();
            ctx.fillStyle = '#34d399'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(String(i + 1), x + 11, y + 5);
        });
        cv.onclick = function (e) {
            if (_rasStep < 1 || _rasTmp.length >= 2) return;
            var r = cv.getBoundingClientRect();
            var ix = (e.clientX - r.left) * (cv.width / r.width) / scale, iy = (e.clientY - r.top) * (cv.height / r.height) / scale;
            askControlPoint(ix, iy);
        };
    }
    function updateRasStep() {
        var s = document.getElementById('agpi-ras-step'); if (!s) return;
        if (_rasTmp.length >= 2) { s.innerHTML = '<b style="color:#34d399">Hotovo</b> — podklad umístěn. Můžeš doladit průhlednost.'; }
        else s.innerHTML = 'Klepni na obrázek na <b>kontrolní bod ' + (_rasTmp.length + 1) + '</b> (roh, známý bod…), pak zadáš jeho reálnou polohu.';
    }
    function askControlPoint(ix, iy) {
        var canGps = haveUser();
        var msg = 'Kontrolní bod ' + (_rasTmp.length + 1) + ': zadej reálnou polohu.\n\n'
            + 'Napiš "Y X" v metrech (S-JTSK), NEBO nech prázdné a potvrď pro použití aktuální GPS' + (canGps ? '' : ' (GPS zatím není)') + '.';
        // nativní prompt() je v iOS PWA (standalone) nespolehlivý → použij agPrompt s fallbackem
        var getInput = (typeof window.agPrompt === 'function')
            ? window.agPrompt({ title: 'Kontrolní bod ' + (_rasTmp.length + 1), message: msg, value: '', okText: 'Potvrdit' })
            : Promise.resolve((function () { try { return prompt(msg, ''); } catch (e) { return null; } })());
        getInput.then(function (inp) {
            if (inp === null || inp === undefined) return;
            var lat, lng;
            inp = String(inp).trim();
            if (inp === '') {
                if (!canGps) { agAlert('Bez GPS', 'GPS poloha zatím není dostupná.'); return; }
                lat = userLat; lng = userLng;
            } else {
                var nums = inp.split(/[\s;,]+/).map(function (t) { return parseFloat(t.replace(',', '.')); }).filter(function (v) { return !isNaN(v); });
                if (nums.length < 2) { agAlert('Špatný vstup', 'Zadej dvě čísla: Y X v metrech.'); return; }
                var ll = sj2ll(nums[0], nums[1]); lat = ll.lat; lng = ll.lng;
            }
            _rasTmp.push({ ix: ix, iy: iy, lat: lat, lng: lng });
            drawRasCanvas(); updateRasStep();
            if (_rasTmp.length === 2) {
                _raster.cp = _rasTmp.slice();
                ensureRasterEl(); _rasterEl.src = _raster.url; drawRaster(); persist();
                toast('Situace umístěna na mapu');
            }
        });
    }
    function clearRaster() {
        _raster = null; _rasImg = null; _rasTmp = []; _rasStep = 0;
        if (_rasterEl) { _rasterEl.style.display = 'none'; _rasterEl.removeAttribute('src'); }
        document.getElementById('agpi-ras-wrap').style.display = 'none';
        persist();
    }

    // ---- otevření/zavření ------------------------------------------------------
    function openTool() {
        ensureModal();
        document.getElementById('agpi-modal').style.display = 'flex';
        renderDxf();
        if (_raster && _raster.cp && _raster.cp.length === 2) { ensureRasterEl(); _rasterEl.src = _raster.url; drawRaster(); }
        var op = document.getElementById('agpi-ras-opacity'); if (op && _raster) { op.value = Math.round((_raster.opacity || 0.6) * 100); document.getElementById('agpi-ras-op').innerText = op.value; }
    }
    function closeModal() { var m = document.getElementById('agpi-modal'); if (m) m.style.display = 'none'; }
    window.agCloseProjectImport = closeModal;
    window.agOpenProjectImport = openTool;

    // ---- styly -----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('agpi-style')) return;
        var st = document.createElement('style'); st.id = 'agpi-style';
        st.textContent = [
            '.agpi-tabs{display:flex;gap:6px;margin:4px 0 12px;}',
            '.agpi-tab{flex:1;padding:9px;border:none;border-radius:10px;background:rgba(255,255,255,0.06);color:var(--text-color,#e8edf2);font:600 13px/1 var(--font-ui,system-ui),sans-serif;cursor:pointer;}',
            '.agpi-tab.on{background:var(--accent,#2f9e74);color:#04110b;}',
            '.agpi-layers{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;}',
            '.agpi-lay{display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.05);font-size:calc(13px * var(--ag-font-scale, 1));cursor:pointer;}',
            '.agpi-lay input{accent-color:var(--accent,#2f9e74);}',
            '.agpi-toggles{margin:10px 0;}',
            '.agpi-sw{display:flex;align-items:center;gap:8px;font-size:calc(14px * var(--ag-font-scale, 1));}',
            '.agpi-sw input{width:18px;height:18px;accent-color:var(--accent,#2f9e74);}',
            '.agpi-stake{max-height:30vh;overflow:auto;}',
            '.agpi-srow{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;background:rgba(255,255,255,0.05);margin-bottom:5px;}',
            '.agpi-sname{flex:1;font-weight:600;}',
            '.agpi-sd{font-family:var(--font-mono,monospace);font-size:calc(12px * var(--ag-font-scale, 1));opacity:.75;}',
            '.agpi-stk{border:none;border-radius:8px;padding:6px 12px;background:var(--accent,#2f9e74);color:#04110b;font-weight:700;font-size:calc(12.5px * var(--ag-font-scale, 1));cursor:pointer;}',
            '.agpi-txt span{background:rgba(0,0,0,0.5);color:#fde68a;font-size:calc(11px * var(--ag-font-scale, 1));padding:1px 4px;border-radius:4px;white-space:nowrap;transform:translate(-50%,-50%);display:inline-block;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    function register() {
        injectStyles(); load();
        if (_design) { drawMap(); startAr(); }
        if (_raster && _raster.cp && _raster.cp.length === 2) { ensureRasterEl(); if (_rasterEl) { _rasterEl.src = _raster.url; drawRaster(); } }
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'project-import', label: 'Import projektu (DXF/situace)', icon: ICON, onClick: openTool, order: 8 });
        } else { ensureFallbackFab(); }
    }
    function ensureFallbackFab() {
        if (document.getElementById('agpi-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'agpi-fab'; b.type = 'button'; b.title = 'Import projektu'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:212px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#2f9e74);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        b.querySelector('svg').style.cssText = 'width:24px;height:24px;';
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 380); });
})();
