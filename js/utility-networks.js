// ===== AR Geodet — PODZEMNÍ SÍTĚ „RENTGEN DO ZEMĚ" (ODPOJITELNÁ vrstva) ========
// Neinvazivní vrstva ve stylu js/cadastre-vector.js + js/rajon.js. NEEDITUJE
// logika.js ani grafika.js. Přidá nástroj „Podzemní sítě":
//
//   • Naimportuje TRASY inženýrských sítí z DXF (LWPOLYLINE / POLYLINE / LINE)
//     a volitelně z GeoJSON / GML (LineString). Souřadnice čte v S-JTSK (5514)
//     NEBO WGS84 (volba). Hloubku bere ze Z vrcholu NEBO z názvu vrstvy se
//     znaménkovým číslem (např. 'PLYN_STL_-1.2', 'VODA_-1.5').
//   • Vykreslí sítě v AR kameře PROMÍTNUTÉ POD TERÉN (povrch z DMR 5G přes
//     window.terrainElev, mínus hloubka → depresní úhel). Barvy dle ČSN 73 6005
//     (voda modrá, plyn žlutý, teplo hnědé, kanalizace, silnoproud, slaboproud…).
//   • Ochranné pásmo: když stojíš blíž trase než je pásmo, hlásí „pod tebou <typ>,
//     jsi v ochranném pásmu" (vzdálenost bod–úsečka).
//
// POCTIVĚ: vodorovná AR poloha stojí na GPS+kompasu telefonu (±3–7 m) → jde o
//   ORIENTAČNÍ pomůcku, NE o vytyčení. Nenahrazuje geodetické vytyčení sítí ani
//   vyjádření správců. NEKOPAT naslepo. Vše běží 100% offline.
//
// Ukládá per zakázka pod klíčem '<pid>_utilNetworks'.
// Vstup: dlaždice „Podzemní sítě" v Nástrojích (agRegisterFieldTool, cat „Katastr a sítě").
// Odstranění: smaž js/utility-networks.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M3 7h18"/><path d="M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7"/>'
        + '<path d="M7 21v-6M12 21v-9M17 21v-4"/><path d="M8 4l1.5-1.5M15 4l1.5-1.5"/></svg>';

    var D2R = Math.PI / 180, R2D = 180 / Math.PI;

    // ---- ČSN 73 6005 — barvy a orientační ochranná pásma (poloměr od osy, m) -----
    // Pásma jsou ORIENTAČNÍ (energetický/plynárenský/vodní zákon rozlišuje dimenzi
    // a tlak/napětí); slouží jen k varování „jsi blízko". Skutečné pásmo ověř u správce.
    var TYPES = {
        voda:       { label: 'vodovod',            color: '#1e6fe0', zone: 1.5 },
        kanalizace: { label: 'kanalizace',         color: '#8b5cf6', zone: 1.5 },
        plyn:       { label: 'plynovod',           color: '#f2c200', zone: 1.0 },
        teplo:      { label: 'teplo / horkovod',   color: '#9a5a2b', zone: 2.5 },
        silnoproud: { label: 'silnoproud (el.)',   color: '#e0281f', zone: 1.0 },
        slaboproud: { label: 'slaboproud / optika',color: '#16a34a', zone: 1.0 },
        ostatni:    { label: 'neurčeno',           color: '#9aa4ad', zone: 1.5 }
    };
    var DEFAULT_DEPTH = 1.0;   // fallback hloubka, když ji nelze zjistit (m)

    var KEY_SUFFIX = '_utilNetworks';

    // stav
    var _nets = [];            // [{vrstva, typ, barvaCSN, hloubka_m, body:[{lat,lng,z?}]}]
    var _arOn = true;
    var _warnOn = true;
    var _arSvg = null, _arRAF = null, _arIdleT = 0;
    var _lastWarnKey = null, _lastWarnTs = 0;

    // ---- pomocné --------------------------------------------------------------
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'utility-networks:agAlert'); } agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'utility-networks:toast'); } }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function heading() { return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; }
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function escapeHtml(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function storeKey() { return pid() + KEY_SUFFIX; }

    // stanovisko pro AR: zakotvený origin (resekce) když je, jinak syrová GPS
    function originLL() {
        if (window.AGPose && typeof window.AGPose.origin === 'function' && haveUser()) {
            try { var o = window.AGPose.origin(userLat, userLng); if (o && o[0] != null) return { lat: o[0], lng: o[1] }; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'utility-networks:originLL'); }
        }
        return haveUser() ? { lat: userLat, lng: userLng } : null;
    }
    function surfaceEl(lat, lng) {
        try { if (typeof window.terrainElev === 'function') { var v = window.terrainElev(lat, lng); return (typeof v === 'number' && isFinite(v)) ? v : null; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'utility-networks:surfaceEl'); }
        return null;
    }
    function metersPerDeg(lat) {
        return (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) ? GeoCore.metersPerDeg(lat)
            : { lat: 111320, lng: 111320 * Math.cos(lat * D2R) };
    }

    // ---- klasifikace typu + hloubky z názvu vrstvy ----------------------------
    // Hloubka: znaménkové číslo v názvu vrstvy (např. '...-1.2' / '..._-1.5' / '..1,8').
    function depthFromLayer(name) {
        if (!name) return null;
        var m = String(name).match(/-?\d+(?:[.,]\d+)?/g);
        if (!m || !m.length) return null;
        // vezmi POSLEDNÍ číslo v názvu (typicky hloubka na konci); záporné = pod terénem
        var raw = m[m.length - 1].replace(',', '.');
        var v = parseFloat(raw);
        if (!isFinite(v)) return null;
        var d = Math.abs(v);
        // ochrana proti nesmyslům (číslo bylo jen index/rok apod.)
        if (d < 0.05 || d > 15) return null;
        return d;
    }
    function classifyType(name) {
        var s = String(name || '').toLowerCase();
        // pořadí kontrol dle jednoznačnosti
        if (/\b(kanal|splašk|splask|dešť|dest|odpad|stok)/.test(s)) return 'kanalizace';
        if (/(vodov|\bvoda\b|\bvod\b|pitn|water|\bhdpe\b|\blpe\b)/.test(s)) return 'voda';
        if (/(plyn|gas|stl|ntl|vtl|ipe)/.test(s)) return 'plyn';
        if (/(teplo|tepl|horkov|parovod|czt|chuv|clv)/.test(s)) return 'teplo';
        if (/(optik|sděl|sdel|slaboproud|telef|metropol|cetin|datov|\bo2\b|\bhdo\b|\bkts\b|fiber)/.test(s)) return 'slaboproud';
        if (/(silnopr|\belektr|\bnn\b|\bvn\b|\bvvn\b|kabel|energ|\bčez\b|\bcez\b|edg|edeg)/.test(s)) return 'silnoproud';
        return 'ostatni';
    }
    // #13: nápověda typu/hloubky pro GML — vylez od geometrie k nadřazenému feature prvku
    // a poskládej jeho localName + atributy + textové property (jako u DXF vrstvy / GeoJSON).
    function gmlFeatureHint(node) {
        var parts = [], hops = 0, n = node ? node.parentNode : null;
        var geomWrap = /(linestring|curve|geometry|pos|poslist|coordinates|segments|multi)/;
        while (n && n.nodeType === 1 && hops < 8) {
            var lname = (n.localName || '').toLowerCase();
            if (!geomWrap.test(lname)) {
                parts.push(lname);
                if (n.attributes) for (var a = 0; a < n.attributes.length; a++) parts.push(n.attributes[a].value || '');
                // textové property přímo pod feature (název/typ/materiál sítě)
                var ch = n.children || [];
                for (var c = 0; c < ch.length; c++) {
                    var cl = (ch[c].localName || '').toLowerCase();
                    if (!geomWrap.test(cl) && ch[c].children && ch[c].children.length === 0) parts.push(ch[c].textContent || '');
                }
                if (lname.indexOf('feature') >= 0 || lname.indexOf('member') >= 0) break;
            }
            n = n.parentNode; hops++;
        }
        return parts.join(' ');
    }

    // ---- převody souřadnic (volba S-JTSK 5514 / WGS84) -------------------------
    function inCZ(ll) { return ll && ll.lat > 48 && ll.lat < 51.2 && ll.lng > 11.8 && ll.lng < 19.2; }
    // S-JTSK (Křovák) → WGS84. DXF/vstup nemusí znát pořadí Y/X; roztřídíme podle
    // velikosti (v ČR |Y| < |X|) a do proj4 jdou záporné (shodně s project-import.js).
    function sj2ll(a, b) {
        try {
            var Y = Math.min(Math.abs(a), Math.abs(b)), X = Math.max(Math.abs(a), Math.abs(b));
            var w = proj4('EPSG:5514', 'EPSG:4326', [-Y, -X]);
            var ll = { lat: w[1], lng: w[0] };
            return isFinite(ll.lat) ? ll : null;
        } catch (e) { return null; }
    }
    // WGS84: rozhodni, které z čísel je zeměpisná šířka
    function wgs2ll(a, b) {
        var A = parseFloat(a), B = parseFloat(b);
        if (!isFinite(A) || !isFinite(B)) return null;
        if (A >= 47 && A <= 52 && B >= 11 && B <= 20) return { lat: A, lng: B };   // a=lat, b=lng
        if (B >= 47 && B <= 52 && A >= 11 && A <= 20) return { lat: B, lng: A };   // b=lat, a=lng
        // mimo ČR — ber první jako lat (nejčastější GeoJSON je [lng,lat], řeší volající)
        return { lat: A, lng: B };
    }
    // sjednocený převod dle zvoleného SRS; x=east/lng-ish, y=north/lat-ish (DXF)
    function convXY(x, y, srs) {
        if (srs === 'wgs') return wgs2ll(y, x);   // DXF: x=lng, y=lat
        return sj2ll(x, y);
    }

    // ---- DXF parser (ASCII; group-code páry, ve stylu project-import.js) -------
    // Vrací [{layer, verts:[{x,y,z}], closed}]
    function parseDXFPolylines(text) {
        var lines = text.split(/\r\n|\r|\n/);
        var pairs = [];
        for (var i = 0; i + 1 < lines.length; i += 2) {
            var code = parseInt(lines[i].trim(), 10);
            pairs.push({ c: isNaN(code) ? -1 : code, v: lines[i + 1] });
        }
        var out = [];
        var N = pairs.length, i2 = 0;
        while (i2 < N && !(pairs[i2].c === 2 && /ENTITIES/i.test(pairs[i2].v))) i2++;
        i2++;
        // stará POLYLINE — vrcholy jako VERTEX entity až po SEQEND
        var polyOpen = false, polyVerts = [], polyLayer = '0', polyClosed = false, polyElev = null;
        function flushPoly() {
            if (polyVerts.length >= 2) out.push({ layer: polyLayer, verts: polyVerts.slice(), closed: polyClosed, elev: polyElev });
            polyOpen = false; polyVerts = []; polyClosed = false; polyElev = null;
        }
        while (i2 < N) {
            var p = pairs[i2];
            if (p.c === 0 && /ENDSEC/i.test(p.v)) { if (polyOpen) flushPoly(); break; }
            if (p.c !== 0) { i2++; continue; }
            var type = (p.v || '').trim().toUpperCase();
            var ent = {}, verts = [], j = i2 + 1;
            while (j < N && pairs[j].c !== 0) {
                var cc = pairs[j].c, vv = pairs[j].v;
                if (cc === 10) { verts.push({ x: parseFloat(vv), y: null, z: null }); }
                else if (cc === 20) { if (verts.length) verts[verts.length - 1].y = parseFloat(vv); }
                else if (cc === 30) { if (verts.length) verts[verts.length - 1].z = parseFloat(vv); }
                else if (cc === 11) { verts.push({ x: parseFloat(vv), y: null, z: null }); }
                else if (cc === 21) { if (verts.length) verts[verts.length - 1].y = parseFloat(vv); }
                else if (cc === 31) { if (verts.length) verts[verts.length - 1].z = parseFloat(vv); }
                else { if (ent[cc] === undefined) ent[cc] = vv; }
                j++;
            }
            var la = ent[8] ? String(ent[8]).trim() : '0';
            var elev = (ent[38] != null) ? parseFloat(ent[38]) : null;   // LWPOLYLINE elevation
            try {
                if (type === 'POLYLINE') {
                    polyOpen = true; polyVerts = []; polyLayer = la;
                    polyClosed = !!(ent[70] && (parseInt(ent[70], 10) & 1));
                    polyElev = elev;
                } else if (type === 'VERTEX' && polyOpen) {
                    if (verts.length && verts[0].y != null) polyVerts.push({ x: verts[0].x, y: verts[0].y, z: verts[0].z });
                } else if (type === 'SEQEND' && polyOpen) {
                    flushPoly();
                } else if (type === 'LINE' && verts.length >= 2 && verts[0].y != null && verts[1].y != null) {
                    out.push({ layer: la, verts: [verts[0], verts[1]], closed: false, elev: elev });
                } else if (type === 'LWPOLYLINE' && verts.length >= 2) {
                    var vv2 = verts.filter(function (q) { return q.y != null; });
                    if (vv2.length >= 2) out.push({ layer: la, verts: vv2, closed: !!(ent[70] && (parseInt(ent[70], 10) & 1)), elev: elev });
                }
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'utility-networks:flushPoly'); }
            i2 = j;
        }
        return out;
    }

    // převod nasbíraných polylinií na síťové objekty
    function polylinesToNets(polys, srs) {
        var nets = [];
        polys.forEach(function (pl) {
            var typ = classifyType(pl.layer);
            var body = [];
            pl.verts.forEach(function (v) {
                var ll = convXY(v.x, v.y, srs);
                if (!ll || !isFinite(ll.lat)) return;
                var z = (typeof v.z === 'number' && isFinite(v.z)) ? v.z : (pl.elev != null && isFinite(pl.elev) ? pl.elev : null);
                body.push({ lat: +ll.lat.toFixed(8), lng: +ll.lng.toFixed(8), z: z });
            });
            if (pl.closed && body.length > 2) body.push({ lat: body[0].lat, lng: body[0].lng, z: body[0].z });
            if (body.length < 2) return;
            // hloubka: přednostně z názvu vrstvy; jinak z průměru záporných Z; jinak default
            var hl = depthFromLayer(pl.layer);
            if (hl == null) {
                var zs = body.map(function (b) { return b.z; }).filter(function (z) { return typeof z === 'number' && isFinite(z); });
                if (zs.length) {
                    var avg = zs.reduce(function (a, b) { return a + b; }, 0) / zs.length;
                    if (avg < -0.05 && avg > -15) hl = Math.abs(avg);   // Z je (relativní) hloubka pod 0
                }
            }
            nets.push({
                vrstva: pl.layer || '0', typ: typ, barvaCSN: (TYPES[typ] || TYPES.ostatni).color,
                hloubka_m: (hl != null ? hl : null), body: body
            });
        });
        return nets;
    }

    // ---- GeoJSON / GML (LineString) -------------------------------------------
    function parseGeoJSON(text, srs) {
        var gj = JSON.parse(text);
        var feats = gj.type === 'FeatureCollection' ? (gj.features || []) : (gj.type === 'Feature' ? [gj] : []);
        var nets = [];
        feats.forEach(function (f) {
            var g = f.geometry; if (!g) return;
            var pr = f.properties || {};
            var layer = pr.vrstva || pr.layer || pr.LAYER || pr.name || pr.typ || pr.type || '0';
            var typ = classifyType(pr.typ || pr.type || layer);
            var hl = depthFromLayer(layer);
            if (hl == null) { var hh = parseFloat(pr.hloubka || pr.depth || pr.HLOUBKA); if (isFinite(hh) && hh > 0) hl = Math.abs(hh); }
            var lines = [];
            if (g.type === 'LineString') lines = [g.coordinates];
            else if (g.type === 'MultiLineString') lines = g.coordinates;
            else return;
            lines.forEach(function (coords) {
                var body = [];
                coords.forEach(function (c) {
                    // GeoJSON standard: [lng, lat] (WGS) nebo [Y, X] (S-JTSK) — necháme na volbě SRS
                    var ll = (srs === 'wgs') ? wgs2ll(c[1], c[0]) : sj2ll(c[0], c[1]);
                    if (ll && isFinite(ll.lat)) body.push({ lat: +ll.lat.toFixed(8), lng: +ll.lng.toFixed(8), z: (c.length > 2 ? c[2] : null) });
                });
                if (body.length >= 2) nets.push({ vrstva: String(layer), typ: typ, barvaCSN: (TYPES[typ] || TYPES.ostatni).color, hloubka_m: (hl != null ? hl : null), body: body });
            });
        });
        return nets;
    }
    function parseGML(text, srs) {
        var nets = [];
        var doc;
        try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch (e) { return nets; }
        if (!doc || doc.getElementsByTagName('parsererror').length) return nets;
        // najdi všechny LineString (bez ohledu na prefix gml:)
        var all = doc.getElementsByTagName('*'), lss = [];
        for (var i = 0; i < all.length; i++) {
            var ln = (all[i].localName || all[i].nodeName || '').toLowerCase();
            if (ln === 'linestring') lss.push(all[i]);
        }
        lss.forEach(function (ls) {
            var nums = [];
            var kids = ls.getElementsByTagName('*');
            for (var k = 0; k < kids.length; k++) {
                var kn = (kids[k].localName || '').toLowerCase();
                if (kn === 'poslist' || kn === 'coordinates' || kn === 'pos') {
                    var raw = (kids[k].textContent || '').trim().replace(/,/g, ' ');
                    raw.split(/\s+/).forEach(function (t) { var n = parseFloat(t); if (isFinite(n)) nums.push(n); });
                }
            }
            if (nums.length < 4) return;
            var body = [];
            for (var m = 0; m + 1 < nums.length; m += 2) {
                // GML posList u EPSG:5514 bývá X Y (northing easting); sj2ll si roztřídí sám
                var ll = (srs === 'wgs') ? wgs2ll(nums[m], nums[m + 1]) : sj2ll(nums[m], nums[m + 1]);
                if (ll && isFinite(ll.lat)) body.push({ lat: +ll.lat.toFixed(8), lng: +ll.lng.toFixed(8), z: null });
            }
            if (body.length >= 2) {
                var hint = gmlFeatureHint(ls);                       // #13: klasifikuj z nadřazeného feature prvku
                var typ = classifyType(hint), hl = depthFromLayer(hint);
                nets.push({ vrstva: (hint ? 'GML ' + typ : 'GML'), typ: typ, barvaCSN: (TYPES[typ] || TYPES.ostatni).color, hloubka_m: hl, body: body });
            }
        });
        return nets;
    }

    // ---- import: rozhodni formát dle přípony/obsahu ---------------------------
    function importText(text, filename, srs) {
        var added = [];
        var lower = (filename || '').toLowerCase();
        var t = text.slice(0, 400).toLowerCase();
        try {
            if (/\.dxf$/.test(lower) || /\bsection\b/.test(t) && /\bentities\b/.test(t)) {
                added = polylinesToNets(parseDXFPolylines(text), srs);
            } else if (/\.(json|geojson)$/.test(lower) || t.indexOf('featurecollection') >= 0 || (t.indexOf('linestring') >= 0 && t.indexOf('{') >= 0)) {
                added = parseGeoJSON(text, srs);
            } else if (/\.(gml|xml)$/.test(lower) || t.indexOf('<gml') >= 0 || t.indexOf('linestring') >= 0) {
                added = parseGML(text, srs);
            } else {
                // poslední pokus: DXF
                added = polylinesToNets(parseDXFPolylines(text), srs);
            }
        } catch (e) { throw new Error('Soubor se nepodařilo přečíst: ' + (e && e.message || e)); }
        // kontrola, že to spadlo do ČR (typicky chyba SRS)
        var inside = 0, total = 0;
        added.forEach(function (nt) { nt.body.forEach(function (b) { total++; if (inCZ(b)) inside++; }); });
        if (!added.length) throw new Error('Nenašel jsem žádné trasy (LWPOLYLINE / POLYLINE / LINE / LineString).');
        if (total && inside / total < 0.3) throw new Error('Souřadnice padají mimo ČR — nejspíš špatně zvolený souřadnicový systém (S-JTSK × WGS84).');
        _nets = _nets.concat(added);
        persist();
        return added.length;
    }

    // ---- perzistence (per zakázka) --------------------------------------------
    function persist() {
        try {
            var s = JSON.stringify(_nets);
            if (s.length > 4000000) { toast('Sítě uloženy jen do paměti (moc velké)'); return; }
            localStorage.setItem(storeKey(), s);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'utility-networks:persist'); }
    }
    function load() {
        try { var s = localStorage.getItem(storeKey()); _nets = s ? (JSON.parse(s) || []) : []; }
        catch (e) { _nets = []; }
        if (!Array.isArray(_nets)) _nets = [];
    }

    // ---- geometrie: vzdálenost bod–úsečka (lokální metry) ---------------------
    function pointSegDist(px, py, ax, ay, bx, by) {
        var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        if (l2 < 1e-9) return Math.hypot(px - ax, py - ay);
        var t = ((px - ax) * dx + (py - ay) * dy) / l2; t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }
    // nejbližší vzdálenost uživatele k trase (m) + hloubka; napříč všemi sítěmi
    function nearestNetwork() {
        if (!haveUser() || !_nets.length) return null;
        var m = metersPerDeg(userLat), best = null;
        function enu(lat, lng) { return { e: (lng - userLng) * m.lng, n: (lat - userLat) * m.lat }; }
        _nets.forEach(function (nt) {
            if (nt._hidden) return;
            var b = nt.body;
            for (var i = 0; i + 1 < b.length; i++) {
                var A = enu(b[i].lat, b[i].lng), B = enu(b[i + 1].lat, b[i + 1].lng);
                var d = pointSegDist(0, 0, A.e, A.n, B.e, B.n);
                if (!best || d < best.dist) best = { dist: d, net: nt };
            }
        });
        return best;
    }
    function netDepth(nt) {
        if (nt.hloubka_m != null && isFinite(nt.hloubka_m)) return nt.hloubka_m;
        return DEFAULT_DEPTH;
    }
    function netZone(nt) {
        var t = TYPES[nt.typ] || TYPES.ostatni;
        return t.zone;
    }

    // ---- ochranné pásmo: varování --------------------------------------------
    function checkProximity() {
        if (!_warnOn || !_nets.length) { setBanner(''); return; }
        var nb = nearestNetwork();
        if (!nb) { setBanner(''); return; }
        var zone = netZone(nb.net);
        if (nb.dist <= zone) {
            var t = TYPES[nb.net.typ] || TYPES.ostatni;
            var dep = netDepth(nb.net);
            var msg = 'Pod tebou <b>' + escapeHtml(t.label) + '</b> — jsi v ochranném pásmu ('
                + nb.dist.toFixed(1) + ' m od osy, hloubka ~' + dep.toFixed(1) + ' m). NEKOPAT naslepo.';
            setBanner(msg, t.color);
            // haptika + toast maximálně jednou za 6 s na stejný typ
            var kk = nb.net.typ;
            var now = Date.now();
            if (kk !== _lastWarnKey || now - _lastWarnTs > 6000) {
                _lastWarnKey = kk; _lastWarnTs = now;
                if (navigator.vibrate) { try { navigator.vibrate([30, 40, 30]); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'utility-networks:checkProximity'); } }
                toast('Pod tebou ' + t.label + ' — ochranné pásmo');
            }
        } else {
            _lastWarnKey = null;
            setBanner('');
        }
    }
    function setBanner(html, color) {
        var el = document.getElementById('agun-banner');
        if (!html) { if (el) el.style.display = 'none'; return; }
        if (!el) {
            el = document.createElement('div'); el.id = 'agun-banner';
            (document.body || document.documentElement).appendChild(el);
        }
        el.style.setProperty('--zc', color || '#e0281f');
        el.innerHTML = '<span class="agun-dot"></span><span>' + html + '</span>';
        el.style.display = 'flex';
    }

    // ---- render: MAPA ----------------------------------------------------------
    var _mapGroup = null;
    function ensureMapGroup() { var m = getMap(); if (!m || typeof L === 'undefined') return null; if (!_mapGroup) _mapGroup = L.layerGroup().addTo(m); return _mapGroup; }
    function drawMap() {
        var g = ensureMapGroup(); if (!g) return; g.clearLayers();
        _nets.forEach(function (nt) {
            if (nt._hidden) return;
            var latlngs = nt.body.map(function (b) { return [b.lat, b.lng]; });
            var col = nt.barvaCSN || (TYPES[nt.typ] || TYPES.ostatni).color;
            L.polyline(latlngs, { color: col, weight: 3, opacity: 0.9, dashArray: '6 5', interactive: false }).addTo(g);
        });
    }

    // ---- render: AR (vlastní SVG overlay, promítnuto POD terén) ----------------
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
    // projekce jednoho podzemního vrcholu do AR (x,y 0..100), depth = hloubka pod povrchem
    function projUnder(lat, lng, depth, oLL, heading, pj, eyeH, vOff) {
        var dist = getDistance(oLL.lat, oLL.lng, lat, lng);
        var bearing = getBearing(oLL.lat, oLL.lng, lat, lng);
        var diff = ((bearing - heading + 540) % 360) - 180;
        // svislý pokles pod oko: (výška oka) − (absolutní výška potrubí)
        var eO = surfaceEl(oLL.lat, oLL.lng), eP = surfaceEl(lat, lng);
        var down;
        if (eO != null && eP != null) down = (eO + eyeH) - (eP - depth);   // reálný terén (DMR 5G)
        else down = eyeH + depth;                                          // degradace: rovný terén
        var vV = Math.atan2(down, Math.max(dist, 0.5)) * R2D - pj.pitch;
        var uH = diff;
        if (pj.roll) { var cr = Math.cos(pj.roll), sr = Math.sin(pj.roll); var tt = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = tt; }
        return { x: 50 + (uH / pj.halfH) * 50, y: 50 + (vV / pj.halfV) * 50 - vOff, diff: diff, dist: dist };
    }
    var _lastH = null, _lastP = null, _lastLat = null, _lastLng = null, _lastR = null, _lastRad = null;
    function arLoop() {
        var svg = _arSvg;
        var oLL = svg ? originLL() : null;
        // BATERIE: bez čeho kreslit (režim Mapa, appka na pozadí, žádné sítě) nedrž 60 Hz
        // řetěz snímků — stačí kontrola 3×/s. V AR se chování nemění, smyčka se rozjede zpět.
        if (!svg || !_arOn || !_nets.length || !oLL || !window._arProj
            || (typeof viewMode !== 'undefined' && viewMode === 'map')
            || document.visibilityState !== 'visible') {
            if (svg && svg.childNodes.length) svg.innerHTML = '';
            _lastH = null; _arRAF = null;
            _arIdleT = setTimeout(function () { _arIdleT = 0; if (!_arRAF) _arRAF = requestAnimationFrame(arLoop); }, 300);
            return;
        }
        _arRAF = requestAnimationFrame(arLoop);
        var pj = window._arProj;
        var hd = heading();
        if (hd == null) { if (svg.childNodes.length) svg.innerHTML = ''; _lastH = null; return; }
        // VÝKON: překresli jen když se směr/sklon/NÁKLON/poloha/dosah reálně změnily (jinak drží obraz)
        var pitch = pj.pitch || 0;
        var roll = pj.roll || 0;   // #12: roll do klíče — projUnder ho používá k rotaci vrcholů
        var rad = (typeof arRadius !== 'undefined' && arRadius) ? arRadius : 150;
        if (_lastH != null && Math.abs(hd - _lastH) < 0.3 && Math.abs(pitch - (_lastP || 0)) < 0.3 && Math.abs(roll - (_lastR || 0)) < 0.005 && _lastRad === rad && _lastLat === oLL.lat && _lastLng === oLL.lng) return;
        _lastH = hd; _lastP = pitch; _lastR = roll; _lastRad = rad; _lastLat = oLL.lat; _lastLng = oLL.lng;
        var eyeH = 1.6, vOff = 0;
        try { eyeH = visSettings.eyeHeight || 1.6; vOff = visSettings.arVerticalOffset || 0; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'utility-networks:arLoop'); }
        var html = '';
        _nets.forEach(function (nt) {
            if (nt._hidden) return;
            var col = nt.barvaCSN || (TYPES[nt.typ] || TYPES.ostatni).color;
            var depth = netDepth(nt);
            var b = nt.body;
            for (var i = 0; i + 1 < b.length; i++) {
                var da = getDistance(oLL.lat, oLL.lng, b[i].lat, b[i].lng), db = getDistance(oLL.lat, oLL.lng, b[i + 1].lat, b[i + 1].lng);
                if (Math.min(da, db) > rad) continue;
                var pa = projUnder(b[i].lat, b[i].lng, (b[i].z != null && b[i].z < 0 && nt.hloubka_m == null ? Math.abs(b[i].z) : depth), oLL, hd, pj, eyeH, vOff);
                var pb = projUnder(b[i + 1].lat, b[i + 1].lng, (b[i + 1].z != null && b[i + 1].z < 0 && nt.hloubka_m == null ? Math.abs(b[i + 1].z) : depth), oLL, hd, pj, eyeH, vOff);
                if (Math.abs(pa.diff) > 100 || Math.abs(pb.diff) > 100) continue;
                html += '<line x1="' + pa.x.toFixed(2) + '" y1="' + pa.y.toFixed(2) + '" x2="' + pb.x.toFixed(2) + '" y2="' + pb.y.toFixed(2)
                    + '" stroke="' + col + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 3" opacity="0.9" vector-effect="non-scaling-stroke"/>';
            }
        });
        svg.innerHTML = html;
    }
    function startAr() { if (ensureArSvg() && !_arRAF && !_arIdleT) _arRAF = requestAnimationFrame(arLoop); }
    function stopAr() { if (_arRAF) { cancelAnimationFrame(_arRAF); _arRAF = null; } if (_arIdleT) { clearTimeout(_arIdleT); _arIdleT = 0; } if (_arSvg) _arSvg.innerHTML = ''; _lastH = null; }

    // ---- UI: modal ------------------------------------------------------------
    var _srs = 'sjtsk';
    function ensureModal() {
        if (document.getElementById('agun-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agun-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Podzemní sítě — rentgen do země</h3>'
            + '<p style="font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.82;margin:2px 0 10px;line-height:1.45;">Naimportuj trasy sítí (DXF / GeoJSON / GML) a appka je promítne '
            + '<b>pod terén</b> v AR kameře, barevně dle ČSN. Když stojíš blízko, upozorní na <b>ochranné pásmo</b>. '
            + '<b style="color:#fbbf24">Orientační pomůcka</b> (poloha telefonu ±3–7 m) — nenahrazuje geodetické vytyčení, nekopat naslepo.</p>'

            + '<div class="agun-srs"><span style="font-size:calc(12px * var(--ag-font-scale, 1));opacity:.75;">Souřadnice v souboru:</span>'
            + '  <label class="agun-radio"><input type="radio" name="agun-srs" value="sjtsk" checked> S-JTSK (5514)</label>'
            + '  <label class="agun-radio"><input type="radio" name="agun-srs" value="wgs"> WGS84</label></div>'

            + '<button class="btn btn-blue" id="agun-imp"><svg class="icon"><use href="#i-folder"/></svg> Načíst trasy (DXF / GeoJSON / GML)</button>'
            + '<input type="file" id="agun-imp-file" accept=".dxf,.json,.geojson,.gml,.xml" style="display:none">'
            + '<div id="agun-status" style="font-size:calc(12.5px * var(--ag-font-scale, 1));color:#fbbf24;margin:6px 2px;"></div>'

            + '<div id="agun-list" class="agun-list"></div>'

            + '<label class="agun-sw" style="margin-top:8px;"><input type="checkbox" id="agun-ar" checked> Zobrazit sítě v AR kameře</label>'
            + '<label class="agun-sw"><input type="checkbox" id="agun-warn" checked> Varovat na ochranné pásmo</label>'

            + '<button class="btn btn-danger" id="agun-clear" style="margin-top:12px;"><svg class="icon"><use href="#i-trash"/></svg> Vymazat všechny sítě zakázky</button>'
            + '<p style="font-size:calc(11px * var(--ag-font-scale, 1));opacity:.6;margin:10px 2px 0;">Hloubka se čte ze Z vrcholu nebo z názvu vrstvy (např. „PLYN_STL_-1.2"). Svislé umístění závisí na výškopisu (DMR 5G) a přesnosti GPS/kompasu — jde o orientaci, ne vytyčení. Vše offline.</p>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" onclick="window.agCloseUtilityNetworks&&window.agCloseUtilityNetworks()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);

        Array.prototype.forEach.call(el.querySelectorAll('input[name=agun-srs]'), function (r) {
            r.addEventListener('change', function () { if (this.checked) _srs = this.value; });
        });
        document.getElementById('agun-imp').addEventListener('click', function () { document.getElementById('agun-imp-file').click(); });
        document.getElementById('agun-imp-file').addEventListener('change', onFile);
        document.getElementById('agun-ar').addEventListener('change', function () { _arOn = this.checked; if (_arOn) startAr(); else stopAr(); });
        document.getElementById('agun-warn').addEventListener('change', function () { _warnOn = this.checked; if (!_warnOn) setBanner(''); });
        document.getElementById('agun-clear').addEventListener('click', function () {
            agAsk('Vymazat všechny podzemní sítě z této zakázky?', { title: 'Vymazat sítě', okText: 'Vymazat', danger: true }).then(function (ok) {
                if (!ok) return;
                _nets = []; persist(); drawMap(); stopAr(); setBanner(''); renderList(); setStatus('');
            });
        });
    }
    function onFile(ev) {
        var f = ev.target.files && ev.target.files[0]; if (!f) { return; }
        setStatus('Načítám ' + f.name + '…');
        var rd = new FileReader();
        rd.onload = function () {
            try {
                var n = importText(String(rd.result), f.name, _srs);
                drawMap(); if (_arOn) startAr(); renderList();
                setStatus('Načteno ' + n + ' tras · celkem ' + _nets.length);
                toast('Načteno ' + n + ' tras sítí');
            } catch (e) { setStatus(''); agAlert('Import se nepovedl', String(e && e.message || e)); }
        };
        rd.onerror = function () { setStatus(''); agAlert('Chyba čtení', 'Soubor se nepodařilo přečíst.'); };
        rd.readAsText(f);
        ev.target.value = '';
    }
    function setStatus(t) { var e = document.getElementById('agun-status'); if (e) e.innerText = t || ''; }
    function renderList() {
        var box = document.getElementById('agun-list'); if (!box) return;
        if (!_nets.length) { box.innerHTML = '<div style="opacity:.6;font-size:calc(13px * var(--ag-font-scale, 1));padding:8px 2px;">Zatím žádné sítě. Načti trasy tlačítkem výše.</div>'; return; }
        // souhrn dle typu
        var byType = {};
        _nets.forEach(function (nt) { (byType[nt.typ] = byType[nt.typ] || []).push(nt); });
        var html = '';
        Object.keys(byType).forEach(function (tp) {
            var t = TYPES[tp] || TYPES.ostatni, arr = byType[tp];
            var anyHidden = arr.some(function (n) { return n._hidden; });
            html += '<div class="agun-row">'
                + '<span class="agun-swatch" style="background:' + t.color + '"></span>'
                + '<span class="agun-tname">' + escapeHtml(t.label) + ' <span style="opacity:.6">· ' + arr.length + ' tras</span></span>'
                + '<button class="agun-eye" data-tp="' + tp + '">' + (anyHidden ? 'zobrazit' : 'skrýt') + '</button>'
                + '</div>';
        });
        box.innerHTML = html;
        Array.prototype.forEach.call(box.querySelectorAll('.agun-eye'), function (b) {
            b.addEventListener('click', function () {
                var tp = b.getAttribute('data-tp');
                var arr = _nets.filter(function (n) { return n.typ === tp; });
                var willHide = !arr.some(function (n) { return n._hidden; });
                arr.forEach(function (n) { n._hidden = willHide; });
                drawMap(); _lastH = null; renderList();
            });
        });
    }

    // ---- otevření / zavření + živá kontrola pásma -----------------------------
    var _liveTimer = null;
    function openTool() {
        injectStyles(); ensureModal(); renderList();
        document.getElementById('agun-modal').style.display = 'flex';
        var arCb = document.getElementById('agun-ar'); if (arCb) arCb.checked = _arOn;
        var wCb = document.getElementById('agun-warn'); if (wCb) wCb.checked = _warnOn;
    }
    window.agCloseUtilityNetworks = function () {
        var m = document.getElementById('agun-modal'); if (m) m.style.display = 'none';
    };
    window.agOpenUtilityNetworks = openTool;

    function startLive() {
        if (_liveTimer) return;
        var mk = (window.AG && AG.uiInterval) ? AG.uiInterval : setInterval;
        _liveTimer = mk(function () { try { checkProximity(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'utility-networks:startLive'); } }, 2000);
    }

    // ---- styly ----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('agun-style')) return;
        var st = document.createElement('style'); st.id = 'agun-style';
        st.textContent = [
            '#agun-modal .agun-srs{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:6px 2px 10px;}',
            '#agun-modal .agun-radio{display:inline-flex;align-items:center;gap:6px;font-size:calc(13px * var(--ag-font-scale, 1));}',
            '#agun-modal .agun-radio input{width:16px;height:16px;accent-color:var(--accent,#2f9e74);}',
            '#agun-modal .agun-list{max-height:34vh;overflow:auto;margin:10px 0 4px;}',
            '#agun-modal .agun-row{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:10px;background:rgba(255,255,255,0.05);margin-bottom:6px;}',
            '#agun-modal .agun-swatch{width:16px;height:16px;flex:0 0 16px;border-radius:4px;box-shadow:0 0 0 1px rgba(255,255,255,.3) inset;}',
            '#agun-modal .agun-tname{flex:1;font-weight:600;font-size:calc(13.5px * var(--ag-font-scale, 1));}',
            '#agun-modal .agun-eye{border:1px solid var(--glass-border,rgba(255,255,255,.18));background:rgba(255,255,255,.06);color:var(--text-color,#e8edf2);border-radius:8px;padding:4px 10px;font-size:calc(12px * var(--ag-font-scale, 1));cursor:pointer;}',
            '#agun-modal .agun-sw{display:flex;align-items:center;gap:8px;font-size:calc(14px * var(--ag-font-scale, 1));margin-top:6px;}',
            '#agun-modal .agun-sw input{width:18px;height:18px;accent-color:var(--accent,#2f9e74);}',
            '#agun-banner{position:fixed;left:50%;transform:translateX(-50%);bottom:max(96px,calc(env(safe-area-inset-bottom) + 96px));z-index:100045;display:none;align-items:center;gap:9px;max-width:92vw;',
            '  background:rgba(20,10,8,0.9);color:#fff;border:1px solid var(--zc,#e0281f);border-left:5px solid var(--zc,#e0281f);border-radius:12px;padding:9px 14px;',
            '  font:600 13px/1.35 var(--font-ui,system-ui),sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);pointer-events:none;}',
            '#agun-banner .agun-dot{width:9px;height:9px;flex:0 0 9px;border-radius:50%;background:var(--zc,#e0281f);box-shadow:0 0 8px var(--zc,#e0281f);animation:agunPulse 1.2s ease-in-out infinite;}',
            '@keyframes agunPulse{0%,100%{opacity:1}50%{opacity:.3}}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- registrace do launcheru + fallback tlačítko --------------------------
    function register() {
        injectStyles(); load();
        if (_nets.length) { drawMap(); startAr(); }
        startLive();
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'utility-networks', label: 'Podzemní sítě (rentgen do země)', icon: ICON, cat: 'Katastr a data', onClick: openTool, order: 13 });
        } else {
            ensureFallbackFab();
        }
    }
    function ensureFallbackFab() {
        if (document.getElementById('agun-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'agun-fab'; b.type = 'button';
        b.title = 'Podzemní sítě'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:320px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#2f9e74);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        var svg = b.querySelector('svg'); if (svg) svg.style.cssText = 'width:24px;height:24px;';
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 400); });
})();
