// ===== AR Geodet — VEKTOROVÝ KATASTR OFFLINE (ODPOJITELNÁ vrstva) =============
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Z katastru dělá
// DOTAZOVATELNÁ GEODATA (ne jen obrázek jako WMS):
//
//   • Stáhne POLYGONY PARCEL (KN) v okolí z RÚIAN ArcGIS služby ČÚZK
//     (stejný host jako bodová pole → funguje z prohlížeče) a uloží je OFFLINE.
//   • Řekne ti „NA KTERÉ PARCELE STOJÍŠ" (číslo, výměra, druh) + vzdálenost k hranici.
//   • Vykreslí hranice v MAPĚ i v AR KAMEŘE.
//   • Naviguje na NEJBLIŽŠÍ LOMOVÝ BOD hranice (uloží ho jako bod + zvýrazní).
//   • Nouzově umí načíst parcely z GeoJSON souboru (offline, bez ČÚZK).
//
// Zdroj: RÚIAN Prohlížecí služba ČÚZK, vrstva 5 „Parcela". Data © ČÚZK.
// Ukládá per zakázka pod klíčem 'agCadastreParcels'.
// Vstup: tlačítko „Katastr — parcely" v launcheru (field-tools.js).
// Odstranění: smaž js/cadastre-vector.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M3 4l6 2 6-2 6 2v14l-6-2-6 2-6-2z"/><path d="M9 6v14M15 4v14"/></svg>';
    var KEY = 'agCadastreParcels';
    var SVC = 'https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/5/query';
    var BORDER = '#22d3ee', HEREFILL = 'rgba(34,211,238,0.22)';

    var _parcels = [];         // [{id, cislo, vymera, druh, ku, rings:[[{lat,lng}]]}]
    var _mapGroup = null;
    var _arSvg = null, _arRAF = null, _arOn = true, _arIdleT = 0;
    var _here = null;          // parcela, na které stojím
    var _busy = false;

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) {} }
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function escapeHtml(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    // ---- síť: stažení parcel z RÚIAN (ESRI JSON) ------------------------------
    function fetchTO(url, ms) {
        if (typeof fetchWithTimeout === 'function') return fetchWithTimeout(url, ms);
        var ctrl = new AbortController(); var t = setTimeout(function () { ctrl.abort(); }, ms || 15000);
        return fetch(url, { signal: ctrl.signal }).finally(function () { clearTimeout(t); });
    }
    function bbox(lat, lng, radius) {
        var dLat = radius / 111320, dLng = radius / (111320 * Math.cos(lat * Math.PI / 180));
        return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
    }
    function buildUrl(bb, offset) {
        var p = {
            where: '1=1', geometry: bb.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
            spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'true', f: 'json',
            outFields: 'cisloparcely,vymeraparcely,druhpozemkukod,zpusobyvyuzitipozemku,katastralniuzemi,id',
            resultRecordCount: '1000', resultOffset: String(offset || 0)
        };
        return SVC + '?' + Object.keys(p).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
    }
    function esriToParcel(f) {
        var a = f.attributes || {};
        var rings = (f.geometry && f.geometry.rings) ? f.geometry.rings.map(function (r) {
            return r.map(function (c) { return { lat: +c[1].toFixed(7), lng: +c[0].toFixed(7) }; });
        }) : [];
        return { id: a.id || a.objectid, cislo: a.cisloparcely || '?', vymera: a.vymeraparcely || null, druh: a.druhpozemkukod || null, ku: a.katastralniuzemi || null, rings: rings };
    }
    function downloadAround(radius) {
        if (!haveUser()) { agAlert('Bez GPS', 'Čekám na GPS polohu.'); return; }
        if (_busy) return; _busy = true; setStatus('Stahuji parcely z ČÚZK…');
        var bb = bbox(userLat, userLng, radius);
        var collected = [], offset = 0, MAXP = 6;
        function page(n) {
            return fetchTO(buildUrl(bb, offset), 15000).then(function (r) { return r.json(); }).then(function (j) {
                if (j && j.error) throw new Error(j.error.message || 'ČÚZK chyba');
                var feats = (j && j.features) || [];
                feats.forEach(function (f) { collected.push(esriToParcel(f)); });
                offset += feats.length;
                if (j && j.exceededTransferLimit && feats.length > 0 && n + 1 < MAXP) return page(n + 1);
            });
        }
        page(0).then(function () {
            _parcels = collected;
            persist(); drawMap(); whereAmI(); renderInfo();
            setStatus('');
            toast('Staženo ' + _parcels.length + ' parcel');
            _busy = false;
        }).catch(function (e) {
            _busy = false; setStatus('');
            agAlert('ČÚZK nedostupné', 'Parcely se nepodařilo stáhnout: ' + (e && e.message || e) + '\n\nZkus to s připojením, nebo nouzově načti parcely ze souboru GeoJSON.');
        });
    }

    // ---- nouzový import GeoJSON -----------------------------------------------
    function importGeoJSON(text) {
        var gj = JSON.parse(text);
        var feats = gj.type === 'FeatureCollection' ? gj.features : (gj.type === 'Feature' ? [gj] : []);
        var out = [];
        feats.forEach(function (f) {
            var g = f.geometry; if (!g) return;
            var pr = f.properties || {};
            var cislo = pr.cisloparcely || pr.cislo || pr.PARCISLO || pr.label || pr.name || '?';
            var vym = pr.vymeraparcely || pr.vymera || pr.AREA || null;
            var polys = [];
            if (g.type === 'Polygon') polys = [g.coordinates];
            else if (g.type === 'MultiPolygon') polys = g.coordinates;
            polys.forEach(function (poly) {
                var rings = poly.map(function (r) { return r.map(function (c) { return { lat: +(+c[1]).toFixed(7), lng: +(+c[0]).toFixed(7) }; }); });
                out.push({ id: pr.id || pr.objectid || (cislo + '_' + out.length), cislo: cislo, vymera: vym, druh: pr.druhpozemkukod || null, ku: pr.katastralniuzemi || null, rings: rings });
            });
        });
        if (!out.length) throw new Error('Žádné polygony parcel (Polygon/MultiPolygon) v souboru.');
        _parcels = out; persist(); drawMap(); whereAmI(); renderInfo();
        toast('Načteno ' + _parcels.length + ' parcel ze souboru');
    }

    // ---- geometrie -------------------------------------------------------------
    function enu(lat0, lng0, lat, lng) { var m = (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) ? GeoCore.metersPerDeg(lat0) : { lat: 111320, lng: 111320 * Math.cos(lat0 * Math.PI / 180) }; return { e: (lng - lng0) * m.lng, n: (lat - lat0) * m.lat }; }
    function pointInRing(lat, lng, ring) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i].lng, yi = ring[i].lat, xj = ring[j].lng, yj = ring[j].lat;
            var hit = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
            if (hit) inside = !inside;
        }
        return inside;
    }
    function pointInParcel(lat, lng, p) {
        if (!p.rings.length) return false;
        // první prsten = vnější; další prsteny = díry (ESRI: díry mají opačnou orientaci, ale jednoduše: liché počítáme)
        var c = 0; p.rings.forEach(function (r) { if (pointInRing(lat, lng, r)) c++; });
        return (c % 2) === 1;
    }
    // nejbližší bod na hraně k danému bodu (lokální metry); vrací {dist, lat, lng}
    function nearestOnSegments(lat, lng, p) {
        var best = null;
        p.rings.forEach(function (r) {
            for (var i = 0; i + 1 < r.length; i++) {
                var A = enu(lat, lng, r[i].lat, r[i].lng), B = enu(lat, lng, r[i + 1].lat, r[i + 1].lng);
                var d = pointSegDist(0, 0, A.e, A.n, B.e, B.n);
                if (!best || d < best.dist) best = { dist: d };
            }
        });
        return best;
    }
    function pointSegDist(px, py, ax, ay, bx, by) {
        var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        if (l2 < 1e-9) return Math.hypot(px - ax, py - ay);
        var t = ((px - ax) * dx + (py - ay) * dy) / l2; t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }
    function nearestVertex() {
        if (!haveUser()) return null;
        var best = null;
        _parcels.forEach(function (p) {
            p.rings.forEach(function (r) {
                r.forEach(function (v) {
                    var d = getDistance(userLat, userLng, v.lat, v.lng);
                    if (!best || d < best.d) best = { d: d, lat: v.lat, lng: v.lng, cislo: p.cislo };
                });
            });
        });
        return best;
    }
    function whereAmI() {
        _here = null;
        if (!haveUser() || !_parcels.length) return;
        for (var i = 0; i < _parcels.length; i++) { if (pointInParcel(userLat, userLng, _parcels[i])) { _here = _parcels[i]; break; } }
    }

    // ---- render: MAPA ----------------------------------------------------------
    function ensureMapGroup() { var m = getMap(); if (!m || typeof L === 'undefined') return null; if (!_mapGroup) _mapGroup = L.layerGroup().addTo(m); return _mapGroup; }
    function drawMap() {
        var g = ensureMapGroup(); if (!g) return; g.clearLayers();
        _parcels.forEach(function (p) {
            var latlngs = p.rings.map(function (r) { return r.map(function (v) { return [v.lat, v.lng]; }); });
            var isHere = (_here && _here === p);
            var poly = L.polygon(latlngs, { color: BORDER, weight: isHere ? 3 : 1.5, opacity: 0.9, fillColor: BORDER, fillOpacity: isHere ? 0.28 : 0.04 });
            poly.on('click', function (ev) { try { L.DomEvent.stopPropagation(ev); } catch (e) {} parcelPopup(p, ev.latlng); });
            poly.addTo(g);
        });
    }
    function parcelPopup(p, latlng) {
        var m = getMap(); if (!m) return;
        var html = '<div style="font:600 13px/1.4 system-ui,sans-serif;color:#0e1216;">Parcela <b>' + escapeHtml(p.cislo) + '</b>'
            + (p.vymera != null ? '<br>Výměra: <b>' + Number(p.vymera).toLocaleString('cs') + ' m²</b>' : '')
            + (p.ku ? '<br>KÚ: ' + escapeHtml(p.ku) : '')
            + '<br><span style="font-size:calc(11px * var(--ag-font-scale, 1));opacity:.7">© ČÚZK</span></div>';
        L.popup({ maxWidth: 220 }).setLatLng(latlng || [p.rings[0][0].lat, p.rings[0][0].lng]).setContent(html).openOn(m);
    }

    // ---- render: AR ------------------------------------------------------------
    function projAR(lat, lng, heading, pj, eyeH, vOff) {
        var dist = getDistance(userLat, userLng, lat, lng);
        var bearing = getBearing(userLat, userLng, lat, lng);
        var diff = ((bearing - heading + 540) % 360) - 180;
        var uH = diff, vV = Math.atan2(eyeH, Math.max(dist, 0.5)) * 180 / Math.PI - pj.pitch;
        if (pj.roll) { var cr = Math.cos(pj.roll), sr = Math.sin(pj.roll); var tt = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = tt; }
        return { x: 50 + (uH / pj.halfH) * 50, y: 50 + (vV / pj.halfV) * 50 - vOff, diff: diff, dist: dist };
    }
    function ensureArSvg() {
        var ov = document.getElementById('ar-overlay'); if (!ov) return null;
        if (!_arSvg) {
            _arSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            _arSvg.setAttribute('viewBox', '0 0 100 100'); _arSvg.setAttribute('preserveAspectRatio', 'none');
            _arSvg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
            ov.insertBefore(_arSvg, ov.firstChild);
        }
        return _arSvg;
    }
    var _lastArHeading = null, _lastArPitch = null, _lastArLat = null, _lastArLng = null;
    function arLoop() {
        var svg = _arSvg;
        // BATERIE: kdyz neni co kreslit (rezim Mapa, appka na pozadi, zadne parcely), nedrz
        // 60 Hz retez snimku — staci se prijit podivat 3x za sekundu. Jakmile podminky plati,
        // smycka se rozjede zpet na kazdy snimek, takze v AR se nic nezmeni.
        if (!svg || !_arOn || !_parcels.length || !haveUser() || !window._arProj
            || (typeof viewMode !== 'undefined' && viewMode === 'map')
            || document.visibilityState !== 'visible') {
            if (svg && svg.childNodes.length) svg.innerHTML = '';
            _lastArHeading = null; _arRAF = null;
            _arIdleT = setTimeout(function () { _arIdleT = 0; if (!_arRAF) _arRAF = requestAnimationFrame(arLoop); }, 300);
            return;
        }
        _arRAF = requestAnimationFrame(arLoop);
        var pj = window._arProj;
        var heading = (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null;
        if (heading == null) { if (svg.childNodes.length) svg.innerHTML = ''; _lastArHeading = null; return; }
        // VYKON: hranice prekresluj jen kdyz se smer/sklon/poloha realne zmenily; jinak desitky parcel x Haversine
        // kazdy snimek (60/s) zbytecne zahlcuji a hreji mobil. Pri klidu drzi posledni vykresleni.
        var _pitch = pj.pitch || 0;
        if (_lastArHeading != null && Math.abs(heading - _lastArHeading) < 0.3 && Math.abs(_pitch - (_lastArPitch || 0)) < 0.3 && _lastArLat === userLat && _lastArLng === userLng) return;
        _lastArHeading = heading; _lastArPitch = _pitch; _lastArLat = userLat; _lastArLng = userLng;
        var eyeH = 1.6, vOff = 0; try { eyeH = visSettings.eyeHeight || 1.6; vOff = visSettings.arVerticalOffset || 0; } catch (e) {}
        var rad = (typeof arRadius !== 'undefined' && arRadius) ? arRadius : 150;
        var html = '';
        // jen hrany blízko uživatele (do ~AR dosahu), ať se AR nezahltí
        _parcels.forEach(function (p) {
            p.rings.forEach(function (r) {
                for (var i = 0; i + 1 < r.length; i++) {
                    var da = getDistance(userLat, userLng, r[i].lat, r[i].lng), db = getDistance(userLat, userLng, r[i + 1].lat, r[i + 1].lng);
                    if (Math.min(da, db) > rad) continue;
                    var pa = projAR(r[i].lat, r[i].lng, heading, pj, eyeH, vOff), pb = projAR(r[i + 1].lat, r[i + 1].lng, heading, pj, eyeH, vOff);
                    if (Math.abs(pa.diff) > 120 || Math.abs(pb.diff) > 120) continue;
                    html += '<line x1="' + pa.x.toFixed(2) + '" y1="' + pa.y.toFixed(2) + '" x2="' + pb.x.toFixed(2) + '" y2="' + pb.y.toFixed(2) + '" stroke="' + BORDER + '" stroke-width="2.5" stroke-linecap="round" opacity="0.85" vector-effect="non-scaling-stroke"/>';
                }
            });
        });
        svg.innerHTML = html;
    }
    function startAr() { if (ensureArSvg() && !_arRAF && !_arIdleT) _arRAF = requestAnimationFrame(arLoop); }
    function stopAr() { if (_arRAF) { cancelAnimationFrame(_arRAF); _arRAF = null; } if (_arIdleT) { clearTimeout(_arIdleT); _arIdleT = 0; } if (_arSvg) _arSvg.innerHTML = ''; }

    // ---- vytyčení nejbližšího lomového bodu -----------------------------------
    function stakeNearestVertex() {
        var v = nearestVertex(); if (!v) { agAlert('Žádné parcely', 'Nejdřív stáhni parcely v okolí.'); return; }
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze', 'Vkládání bodů není dostupné.'); return; }
        var name = 'LB_' + v.cislo.replace(/[^0-9a-zA-Z]/g, '');
        window.addImportedPoints([{ name: name, lat: v.lat, lng: v.lng }]);
        var pid = null;
        try {
            var arr = (typeof persistentCustomPoints !== 'undefined') ? persistentCustomPoints : [];
            var hit = arr.find(function (q) { return q.name === name && Math.abs(q.lat - v.lat) < 1e-6 && Math.abs(q.lng - v.lng) < 1e-6; });
            if (hit) pid = hit.id;
        } catch (e) {}
        if (pid != null) { try { highlightedPointId = pid; } catch (e) {} try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) {} try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) {} }
        closeModal();
        toast('Navádím na lomový bod (' + v.d.toFixed(0) + ' m) — sleduj šipku');
    }

    // ---- perzistence -----------------------------------------------------------
    function persist() {
        try {
            if (typeof setStoredData !== 'function') return;
            var s = JSON.stringify(_parcels);
            if (s.length > 3500000) { toast('Parcely uloženy jen do paměti (moc velké)'); return; }
            setStoredData(KEY, s);
        } catch (e) {}
    }
    function load() { try { if (typeof getStoredData !== 'function') return; var s = getStoredData(KEY); if (s) _parcels = JSON.parse(s) || []; } catch (e) { _parcels = []; } }

    // ---- UI --------------------------------------------------------------------
    function setStatus(t) { var e = document.getElementById('agcv-status'); if (e) e.innerText = t || ''; }
    function ensureModal() {
        if (document.getElementById('agcv-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agcv-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Katastr — parcely (offline)</h3>'
            + '<div id="agcv-here" class="agcv-here"></div>'
            + '<div class="st-slider"><div class="st-slider-head"><span>Stáhnout v okruhu</span><span><span id="agcv-rad-val">300</span> m</span></div>'
            + '  <input type="range" id="agcv-rad" min="100" max="1000" step="50" value="300"></div>'
            + '<button class="btn btn-blue" id="agcv-dl"><svg class="icon"><use href="#i-download"/></svg> Stáhnout parcely v okolí</button>'
            + '<div id="agcv-status" style="font-size:calc(12.5px * var(--ag-font-scale, 1));color:#fbbf24;margin:6px 2px;"></div>'
            + '<div id="agcv-info" style="font-size:calc(13px * var(--ag-font-scale, 1));margin:8px 0;opacity:.9;"></div>'
            + '<label class="agcv-sw" style="margin-top:6px;"><input type="checkbox" id="agcv-ar" checked> Zobrazit hranice v AR kameře</label>'
            + '<button class="btn" id="agcv-stake" style="margin-top:10px;"><svg class="icon"><use href="#i-navigation"/></svg> Navést na nejbližší lomový bod</button>'
            + '<details class="adv" style="margin-top:12px;"><summary><svg class="icon"><use href="#i-folder"/></svg> Nouzově / offline: parcely ze souboru</summary><div class="adv-body">'
            + '  <p style="font-size:calc(12px * var(--ag-font-scale, 1));opacity:.75;margin:4px 0;">Načti GeoJSON s parcelami (Polygon/MultiPolygon; číslo v poli cisloparcely/cislo/PARCISLO).</p>'
            + '  <button class="btn btn-secondary" id="agcv-imp"><svg class="icon"><use href="#i-folder"/></svg> Načíst GeoJSON</button>'
            + '  <input type="file" id="agcv-imp-file" accept=".json,.geojson,application/json" style="display:none">'
            + '  <button class="btn btn-danger" id="agcv-clear" style="margin-top:10px;"><svg class="icon"><use href="#i-trash"/></svg> Vymazat stažené parcely</button>'
            + '</div></details>'
            + '<p style="font-size:calc(11px * var(--ag-font-scale, 1));opacity:.6;margin:10px 2px 0;">Zdroj: RÚIAN / katastr nemovitostí — data © ČÚZK. Hranice jsou orientační, ověřuj v terénu.</p>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" onclick="window.agCloseCadastreVector&&window.agCloseCadastreVector()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('agcv-rad').addEventListener('input', function () { document.getElementById('agcv-rad-val').innerText = this.value; });
        document.getElementById('agcv-dl').addEventListener('click', function () { downloadAround(parseInt(document.getElementById('agcv-rad').value, 10) || 300); });
        document.getElementById('agcv-ar').addEventListener('change', function () { _arOn = this.checked; if (_arOn) startAr(); else stopAr(); });
        document.getElementById('agcv-stake').addEventListener('click', stakeNearestVertex);
        document.getElementById('agcv-imp').addEventListener('click', function () { document.getElementById('agcv-imp-file').click(); });
        document.getElementById('agcv-imp-file').addEventListener('change', function (ev) {
            var f = ev.target.files && ev.target.files[0]; if (!f) return;
            var rd = new FileReader(); rd.onload = function () { try { importGeoJSON(String(rd.result)); } catch (e) { agAlert('Chyba souboru', String(e && e.message || e)); } }; rd.readAsText(f); ev.target.value = '';
        });
        document.getElementById('agcv-clear').addEventListener('click', async function () {
            if (!(await agAsk('Vymazat stažené parcely z této zakázky?', { okText: 'Vymazat', danger: true }))) return;
            _parcels = []; _here = null; persist(); drawMap(); stopAr(); renderInfo();
        });
    }
    function renderInfo() {
        var here = document.getElementById('agcv-here'), info = document.getElementById('agcv-info');
        if (here) {
            if (_here) {
                var nd = nearestOnSegments(userLat, userLng, _here);
                here.innerHTML = '<div class="agcv-here-in">Stojíš na parcele<br><b>' + escapeHtml(_here.cislo) + '</b>'
                    + (_here.vymera != null ? ' · ' + Number(_here.vymera).toLocaleString('cs') + ' m²' : '')
                    + (nd ? '<br><span style="font-size:calc(12px * var(--ag-font-scale, 1));opacity:.8">k hranici ' + nd.dist.toFixed(1) + ' m</span>' : '') + '</div>';
            } else if (_parcels.length) here.innerHTML = '<div class="agcv-here-out">Nejsi uvnitř žádné stažené parcely.</div>';
            else here.innerHTML = '';
        }
        if (info) info.innerHTML = _parcels.length ? ('Načteno <b>' + _parcels.length + '</b> parcel v okolí.') : '<span style="opacity:.6">Žádné parcely. Stáhni je tlačítkem výše (potřebuje internet) nebo načti ze souboru.</span>';
    }

    function openTool() { ensureModal(); whereAmI(); renderInfo(); document.getElementById('agcv-modal').style.display = 'flex'; }
    function closeModal() { var m = document.getElementById('agcv-modal'); if (m) m.style.display = 'none'; }
    window.agCloseCadastreVector = closeModal;
    window.agOpenCadastreVector = openTool;

    // periodicky aktualizuj „kde stojím" když je modal otevřený
    var _liveTimer = null;
    function startLive() { if (!_liveTimer) _liveTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () { var m = document.getElementById('agcv-modal'); if (m && m.style.display === 'flex') { whereAmI(); renderInfo(); } }, 1500); }

    function injectStyles() {
        if (document.getElementById('agcv-style')) return;
        var st = document.createElement('style'); st.id = 'agcv-style';
        st.textContent = [
            '.agcv-here{margin:4px 0 10px;}',
            '.agcv-here-in{padding:12px 14px;border-radius:10px;background:rgba(34,211,238,0.16);outline:1px solid rgba(34,211,238,0.5);font-size:calc(15px * var(--ag-font-scale, 1));}',
            '.agcv-here-out{padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.06);font-size:calc(13px * var(--ag-font-scale, 1));opacity:.85;}',
            '.agcv-sw{display:flex;align-items:center;gap:8px;font-size:calc(14px * var(--ag-font-scale, 1));}',
            '.agcv-sw input{width:18px;height:18px;accent-color:var(--accent,#2f9e74);}'
        ].join('\n');
        document.head.appendChild(st);
    }

    function register() {
        injectStyles(); load(); startLive();
        if (_parcels.length) { drawMap(); startAr(); }
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'cadastre-vector', label: 'Katastr — parcely', icon: ICON, onClick: openTool, order: 12 });
        } else { ensureFallbackFab(); }
    }
    function ensureFallbackFab() {
        if (document.getElementById('agcv-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'agcv-fab'; b.type = 'button'; b.title = 'Katastr — parcely'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:264px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#2f9e74);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        b.querySelector('svg').style.cssText = 'width:24px;height:24px;';
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 400); });
})();
