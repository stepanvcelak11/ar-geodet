// ===== QTRIG — OBLASTI V TELEFONU: okres / kraj / celá ČR (ODPOJITELNÁ vrstva) ==
// PŘÁNÍ (15. 9. 2026): „Jako Pokémon Go — stáhnout mapy krajů či okresů či země,
// aby se to nemuselo načítat a mohlo to být plynulejší; to samé data o bodech."
//
// CO DĚLÁ: stáhne do telefonu VŠECHNY body bodového pole ČÚZK (TB, ZhB, PPBP,
// nivelační, tíhové) z celého okresu, kraje nebo republiky a k nim přehledovou
// mapu OSM. Od té chvíle:
//   • fetchGeodata() v logika.js se při chůzi na síť VŮBEC neptá — body kolem
//     člověka bere z telefonu (IndexedDB, mřížka buněk 0,05°), takže se objeví
//     hned a bez signálu; ČÚZK dostane pokoj (dřív 6 dotazů na dávku),
//   • mapa má podklad do přehledového měřítka i tam, kde signál není.
//
// ⚠ PROČ NE PODROBNÁ MAPA CELÉHO OKRESU. Dlaždice OSM na z18 (měřítko, ve kterém
//   se v terénu pracuje) je ~150 × 150 m — okres jich má ~115 000 (≈ 1,5 GB),
//   kraj ~700 000 a republika ~3,5 milionu. Server OSM navíc hromadné stahování
//   výslovně zakazuje (pravidla tile.openstreetmap.org). Proto balíček bere
//   PŘEHLED (okres do z15, kraj do z13, ČR do z11) a podrobnost z16–z18 zůstává
//   na „Uložit okolí" / „Sbalit zakázku" kolem místa, kde se skutečně měří.
//   Body jsou naopak kompletní — jsou to jen souřadnice a atributy.
//
// KOLIK TO JE (změřeno 15. 9. 2026 na službě ČÚZK, returnCountOnly):
//   TB 50 k · ZhB 49 k · PPBP 409 k · nivelace 126 k · tíhové 451 → ČR ≈ 635 000
//   bodů, tj. ~320 stránek po 2000 a řádově 100 MB v úložišti; okres ~5–15 tisíc
//   bodů (jednotky MB, pár minut). Stahování je PO STRÁNKÁCH S ULOŽENÝM
//   POSTUPEM — přerušené (zavřená appka, výpadek) pokračuje tam, kde skončilo.
//
// ULOŽENÍ: AGStore police 'oblasti' (js/ag-store.js):
//   'meta'        → { balicky: [ {id, typ, kod, nazev, bbox, ts, body:{…}, mapa:{…}} ] }
//   'c:<la>_<lo>' → JSON řetězec pole záhlaví bodů v buňce (viz compact/expand)
// Dlaždice mapy jdou do TILE_CACHE 'argeodet-offline-v12' (stejné jako Uložit okolí),
// takže je service worker najde cache-first jako dřív.
//
// Hranice okresů/krajů: data/oblasti.json (RÚIAN © ČÚZK, zjednodušené).
// Data bodů © ČÚZK, mapa © přispěvatelé OpenStreetMap.
// Odstranění: smaž js/oblasti-offline.js + css/oblasti-offline.css +
// data/oblasti.json, řádek <script> v index.html, záznam 'oblasti-offline'
// v js/tools-registry.js a jeho text v data/navody.json (přegenerovat sw.js).
// logika.js si existenci hlídá přes `window.AGOblasti &&`.
// ================================================================================
(function () {
    'use strict';
    if (window.AGOblasti) return;
    try { window.AG && AG.cssFile && AG.cssFile('ago-css', 'css/oblasti-offline.css'); } catch (e) { }

    var SHELF = 'oblasti';
    var META = 'meta';
    var CELL = 0.05;                        // buňka mřížky ve stupních (~5,5 × 3,6 km)
    var PAGE = 2000;                        // maxRecordCount služby BodovaPole
    var ENDPOINT = 'https://ags.cuzk.gov.cz/arcgis/rest/services/BodovaPole/MapServer';
    var TILE_CACHE = 'argeodet-offline-v12'; // MUSÍ sedět s sw.js / logika.js
    var TILE_CAP = 6000;                    // strop dlaždic na balíček (ohled na OSM)
    var ZOOMS = { okres: [9, 10, 11, 12, 13, 14, 15], kraj: [8, 9, 10, 11, 12, 13], cr: [6, 7, 8, 9, 10, 11] };
    var ZOOM_DETAIL = 16;                   // volitelně navíc u okresu
    var OKRAJ_LAT = 0.0032, OKRAJ_LNG = 0.005;   // ~350 m: u okraje balíčku se raději ptá sítě
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z"/><path d="M9 4v13M15 7v13"/><path d="M12 22v-4"/><circle cx="12" cy="15" r="2"/></svg>';

    var _meta = null;           // { balicky: [] }
    var _metaLoaded = false;
    var _cells = {};            // paměťová cache buněk: key -> pole záznamů
    var _cellOrder = [];        // LRU
    var _hranice = null;        // data/oblasti.json
    var _ov = null, _bezi = null, _abort = false;
    var _typ = 'okres', _vyber = null, _chceBody = true, _chceMapu = true, _chceDetail = false, _odhad = null;

    // --------------------------------------------------------------------------------
    // Pomůcky
    // --------------------------------------------------------------------------------
    function esc(s) {
        return (window.AG && AG.esc) ? AG.esc(s)
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde); } catch (x) { } }
    function toast(m) {
        try { if (window.AG && AG.toast) return AG.toast(m); } catch (e) { swallow(e, 'oblasti:toast'); }
        try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { swallow(e, 'oblasti:toast'); }
    }
    function alertBox(title, msg) {
        if (typeof window.agAlert === 'function') return window.agAlert({ title: title, message: msg });
        try { if (typeof agInfo === 'function') agInfo((title ? title + '\n\n' : '') + String(msg).replace(/<[^>]+>/g, '')); } catch (e) { swallow(e, 'oblasti:alertBox'); }
        return Promise.resolve(true);
    }
    function confirmBox(o) {
        if (typeof window.agConfirm === 'function') return window.agConfirm(o);
        return Promise.resolve(window.confirm(String(o.message || '').replace(/<[^>]+>/g, '')));
    }
    function shelf() { return (window.AGStore && AGStore.shelf) ? AGStore.shelf(SHELF) : null; }
    function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function mb(b) { return b < 1048576 ? Math.round(b / 1024) + ' kB' : (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' MB'; }
    function dist(a, b, c, d) {
        try { if (typeof getDistance === 'function') return getDistance(a, b, c, d); } catch (e) { }
        try { if (window.GeoCore && GeoCore.getDistance) return GeoCore.getDistance(a, b, c, d); } catch (e) { }
        var R = 6382000, dl = (d - b) * Math.PI / 180, dp = (c - a) * Math.PI / 180;
        var x = dl * Math.cos((a + c) / 2 * Math.PI / 180);
        return Math.sqrt(x * x + dp * dp) * R;
    }
    function cellKey(lat, lng) { return Math.floor(lat / CELL) + '_' + Math.floor(lng / CELL); }
    function fetchJson(url, ms) {
        var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
        var t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 40000) : null;
        return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (d) {
            if (d && d.error) throw new Error(d.error.message || 'ArcGIS error');
            return d;
        })['finally'](function () { if (t) clearTimeout(t); });
    }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    // bod v mnohoúhelníku (prstence [lng,lat]); díry se neřeší — okresy je nemají
    function vPoly(poly, lat, lng) {
        if (!poly) return false;
        var uvnitr = false;
        for (var r = 0; r < poly.length; r++) {
            var ring = poly[r], hit = false;
            for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
                if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) hit = !hit;
            }
            if (hit) uvnitr = true;
        }
        return uvnitr;
    }

    // --------------------------------------------------------------------------------
    // Záhlaví bodu: kompaktní zápis do buňky a zpět do tvaru, jaký vrací identify
    // (layerId, attributes, geometry) — fetchGeodata z něj staví body přes agCuzkBod.
    // --------------------------------------------------------------------------------
    var URL_RE = /^https:\/\/geoportal\.cuzk\.cz\/mistopis2\/mistopis_soap_hh\.asp\?NAME=([A-Z_]+)&TYP=([A-Z]+)&HID=([0-9a-f]+)$/;
    function compact(layerId, a, g, pkg) {
        var o = { l: layerId, x: Math.round(g.x * 1e7) / 1e7, y: Math.round(g.y * 1e7) / 1e7, p: pkg, a: {} };
        var id = a.OBJECTID != null ? a.OBJECTID : a.ID;
        o.i = layerId + ':' + id;
        for (var k in a) {
            if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
            var v = a[k];
            if (v == null || k === 'GEOMETRY' || k === 'OBJECTID' || k === 'ID') continue;
            if (typeof v === 'string') { v = v.trim(); if (v === '' || v === 'Null') continue; }
            if (k === 'GEODETICKE_UDAJE') { var m = URL_RE.exec(v); if (m) { o.u = [m[1], m[2], m[3]]; continue; } }
            o.a[k] = v;
        }
        return o;
    }
    function expand(o) {
        var a = {};
        for (var k in o.a) if (Object.prototype.hasOwnProperty.call(o.a, k)) a[k] = o.a[k];
        a.OBJECTID = o.i.split(':')[1]; a.ID = a.OBJECTID;
        if (o.u) a.GEODETICKE_UDAJE = 'https://geoportal.cuzk.cz/mistopis2/mistopis_soap_hh.asp?NAME=' + o.u[0] + '&TYP=' + o.u[1] + '&HID=' + o.u[2];
        return { layerId: o.l, attributes: a, geometry: { x: o.x, y: o.y } };
    }

    // --------------------------------------------------------------------------------
    // Úložiště
    // --------------------------------------------------------------------------------
    function loadMeta() {
        if (_meta) return Promise.resolve(_meta);
        var s = shelf();
        if (!s) { _meta = { balicky: [] }; _metaLoaded = true; return Promise.resolve(_meta); }
        return s.get(META).then(function (m) {
            _meta = (m && Array.isArray(m.balicky)) ? m : { balicky: [] };
            _metaLoaded = true;
            return _meta;
        }).catch(function () { _meta = { balicky: [] }; _metaLoaded = true; return _meta; });
    }
    function saveMeta() { var s = shelf(); return s ? s.put(META, _meta) : Promise.resolve(false); }
    function readCell(key) {
        if (_cells[key]) return Promise.resolve(_cells[key]);
        var s = shelf(); if (!s) return Promise.resolve([]);
        return s.get('c:' + key).then(function (raw) {
            var arr = [];
            if (raw) { try { arr = JSON.parse(raw); } catch (e) { arr = []; } }
            remember(key, arr);
            return arr;
        });
    }
    function remember(key, arr) {
        if (!_cells[key]) { _cellOrder.push(key); if (_cellOrder.length > 40) { var old = _cellOrder.shift(); delete _cells[old]; } }
        _cells[key] = arr;
    }
    function writeCell(key, arr) {
        var s = shelf(); if (!s) return Promise.resolve(false);
        if (_cells[key]) _cells[key] = arr;
        if (!arr.length) return s.del('c:' + key);
        return s.put('c:' + key, JSON.stringify(arr));
    }
    // Sloučení stránky bodů do buněk (klíč = i; novější záznam přepíše starší).
    function mergePage(items, pkg) {
        var byCell = {};
        items.forEach(function (it) {
            if (!it.geometry || !isFinite(it.geometry.x) || !isFinite(it.geometry.y)) return;
            var o = compact(it.layerId, it.attributes, it.geometry, pkg);
            var k = cellKey(o.y, o.x);
            (byCell[k] = byCell[k] || []).push(o);
        });
        var keys = Object.keys(byCell), i = 0;
        function dalsi() {
            if (i >= keys.length) return Promise.resolve(true);
            var k = keys[i++];
            return readCell(k).then(function (arr) {
                var ix = {}; arr.forEach(function (o, n) { ix[o.i] = n; });
                byCell[k].forEach(function (o) { if (ix[o.i] != null) arr[ix[o.i]] = o; else { ix[o.i] = arr.length; arr.push(o); } });
                return writeCell(k, arr);
            }).then(dalsi);
        }
        return dalsi();
    }

    // --------------------------------------------------------------------------------
    // Veřejné čtení pro fetchGeodata: je místo pokryté? a body kolem
    // --------------------------------------------------------------------------------
    function hotove() { return (_meta && _meta.balicky || []).filter(function (b) { return b.body && b.body.stav === 'hotovo'; }); }
    function pokryto(lat, lng) {
        if (!_metaLoaded || lat == null || lng == null) return false;
        var bs = hotove();
        for (var i = 0; i < bs.length; i++) {
            var b = bs[i].bbox;
            if (lng >= b[0] + OKRAJ_LNG && lng <= b[2] - OKRAJ_LNG && lat >= b[1] + OKRAJ_LAT && lat <= b[3] - OKRAJ_LAT) return true;
        }
        return false;
    }
    function body(lat, lng, r) {
        var dLat = r / 111320, dLng = r / (111320 * Math.cos(lat * Math.PI / 180));
        var keys = [];
        for (var la = Math.floor((lat - dLat) / CELL); la <= Math.floor((lat + dLat) / CELL); la++)
            for (var lo = Math.floor((lng - dLng) / CELL); lo <= Math.floor((lng + dLng) / CELL); lo++) keys.push(la + '_' + lo);
        return Promise.all(keys.map(readCell)).then(function (cells) {
            var out = [];
            cells.forEach(function (arr) {
                arr.forEach(function (o) { if (dist(lat, lng, o.y, o.x) <= r + 5) out.push(expand(o)); });
            });
            return out;
        });
    }

    // Nejbližší bod určený v ETRS89 s elipsoidickou výškou (HEL) do ~15 km — pro
    // místní undulaci geoidu (logika.js agGeoidLocal), když v dosahu arPoints žádný není.
    var ETRS = { 2: 1, 4: 1, 6: 1, 8: 1, 22: 1, 24: 1, 26: 1, 28: 1 };
    var _etrsMemo = {};
    function etrs(lat, lng) {
        var mk = lat.toFixed(2) + ',' + lng.toFixed(2);
        if (_etrsMemo[mk]) return _etrsMemo[mk];
        var dLat = 0.14, dLng = 0.21, keys = [];
        for (var la = Math.floor((lat - dLat) / CELL); la <= Math.floor((lat + dLat) / CELL); la++)
            for (var lo = Math.floor((lng - dLng) / CELL); lo <= Math.floor((lng + dLng) / CELL); lo++) keys.push(la + '_' + lo);
        _etrsMemo[mk] = Promise.all(keys.map(readCell)).then(function (cells) {
            var best = null, bd = 15000;
            cells.forEach(function (arr) {
                arr.forEach(function (o) {
                    if (!ETRS[o.l]) return;
                    var hel = parseFloat(o.a.HEL), h = parseFloat(String(o.a.VYSKA || '').replace(',', '.'));
                    if (!isFinite(hel) || !isFinite(h)) return;
                    var d = dist(lat, lng, o.y, o.x);
                    if (d < bd) { bd = d; best = { N: Math.round((hel - h) * 1000) / 1000, dist: d, lat: o.y, lng: o.x, name: String(o.a.CISLO || '') }; }
                });
            });
            return best;
        });
        return _etrsMemo[mk];
    }

    // --------------------------------------------------------------------------------
    // Hranice
    // --------------------------------------------------------------------------------
    function hranice() {
        if (_hranice) return Promise.resolve(_hranice);
        return fetch('./data/oblasti.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
            if (!j) return null;
            // Praha je v RÚIAN jen kraj — jako „okres" ji nabídneme taky
            var pr = null;
            (j.kraje || []).forEach(function (k) { if (k.kod === 19) pr = k; });
            if (pr && !(j.okresy || []).some(function (o) { return o.kod === 3100; })) j.okresy.push({ kod: 3100, nazev: 'Praha', kraj: 19, bbox: pr.bbox, poly: pr.poly });
            var col = function (a, b) { return String(a.nazev).localeCompare(String(b.nazev), 'cs'); };
            j.okresy.sort(col); j.kraje.sort(col);
            _hranice = j;
            return j;
        }).catch(function (e) { swallow(e, 'oblasti:hranice'); return null; });
    }
    function oblast(typ, kod) {
        if (!_hranice) return null;
        if (typ === 'cr') return { typ: 'cr', kod: 0, nazev: 'Celá ČR', bbox: _hranice.cr.bbox };
        var list = typ === 'kraj' ? _hranice.kraje : _hranice.okresy;
        for (var i = 0; i < list.length; i++) if (list[i].kod === kod) return { typ: typ, kod: kod, nazev: list[i].nazev, bbox: list[i].bbox, poly: list[i].poly, kraj: list[i].kraj };
        return null;
    }
    function kdeJsem() {
        var lat = null, lng = null;
        try { if (typeof userLat !== 'undefined' && userLat != null) { lat = userLat; lng = userLng; } } catch (e) { }
        if (lat == null) { try { var p = JSON.parse(localStorage.getItem('arLastPos')); if (p && p.lat != null) { lat = +p.lat; lng = +(p.lng != null ? p.lng : p.lon); } } catch (e) { } }
        if (lat == null || !_hranice) return null;
        var o = null, k = null;
        _hranice.okresy.forEach(function (x) { if (!o && x.kod !== 3100 && vPoly(x.poly, lat, lng)) o = x; });
        _hranice.kraje.forEach(function (x) { if (!k && vPoly(x.poly, lat, lng)) k = x; });
        if (!o && k && k.kod === 19) o = _hranice.okresy.filter(function (x) { return x.kod === 3100; })[0] || null;
        return { lat: lat, lng: lng, okres: o, kraj: k };
    }

    // --------------------------------------------------------------------------------
    // Dlaždice: výčet URL pro bbox a sadu zoomů
    // --------------------------------------------------------------------------------
    function tileRange(bbox, z) {
        var n = Math.pow(2, z);
        var x0 = Math.floor((bbox[0] + 180) / 360 * n), x1 = Math.floor((bbox[2] + 180) / 360 * n);
        var lat2y = function (lat) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
        var y0 = lat2y(bbox[3]), y1 = lat2y(bbox[1]);
        return { x0: x0, x1: x1, y0: y0, y1: y1, n: (x1 - x0 + 1) * (y1 - y0 + 1) };
    }
    function tileZooms(typ, detail) { var z = ZOOMS[typ].slice(); if (typ === 'okres' && detail) z.push(ZOOM_DETAIL); return z; }
    function tileCount(bbox, zooms) { var s = 0; zooms.forEach(function (z) { s += tileRange(bbox, z).n; }); return s; }
    // Když by to bylo přes strop, odpadají nejpodrobnější zoomy — přehled se stáhne vždycky.
    function tileZoomsCapped(bbox, zooms) { var zs = zooms.slice(); while (zs.length > 1 && tileCount(bbox, zs) > TILE_CAP) zs.pop(); return zs; }
    function tileUrls(bbox, zooms) {
        var out = [];
        zooms.forEach(function (z) {
            var r = tileRange(bbox, z);
            for (var x = r.x0; x <= r.x1; x++) for (var y = r.y0; y <= r.y1; y++) out.push('https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png');
        });
        return out;
    }

    // --------------------------------------------------------------------------------
    // Stahování (s uloženým postupem)
    // --------------------------------------------------------------------------------
    function najdiBalicek(id) { for (var i = 0; i < _meta.balicky.length; i++) if (_meta.balicky[i].id === id) return _meta.balicky[i]; return null; }
    function vrstvy() { return (window.AG_CUZK_BODOVE_VRSTVY || [2, 4, 6, 8, 18, 20, 22, 24, 26, 28, 38, 40, 42, 44, 46, 48]).slice(); }

    function stahnout(ob, opts, onStep) {
        if (_bezi) return Promise.reject(new Error('Už se stahuje.'));
        _abort = false;
        var id = ob.typ + ':' + ob.kod;
        var b = najdiBalicek(id);
        if (!b) { b = { id: id, typ: ob.typ, kod: ob.kod, nazev: ob.nazev, bbox: ob.bbox, ts: 0, body: null, mapa: null }; _meta.balicky.push(b); }
        var vr = vrstvy();
        if (opts.body) {
            if (!b.body || b.body.stav === 'hotovo' && opts.znovu) b.body = { stav: 'rozdelano', vi: 0, off: 0, pocet: 0, zrusene: 0 };
            else if (b.body.stav === 'hotovo') { /* body už jsou */ }
        }
        if (opts.mapa) {
            var zs = tileZoomsCapped(ob.bbox, tileZooms(ob.typ, opts.detail));
            if (!b.mapa || b.mapa.stav !== 'hotovo' || opts.znovu || (b.mapa.zooms || []).join() !== zs.join()) b.mapa = { stav: 'rozdelano', zooms: zs, hotovo: 0, celkem: tileCount(ob.bbox, zs), chyby: 0 };
        }
        _bezi = b;
        var geom = ob.bbox.join(',');

        function ulozit() { return saveMeta(); }
        function report(txt) { try { onStep && onStep(b, txt); } catch (e) { swallow(e, 'oblasti:report'); } }

        function bodyKrok() {
            if (!b.body || b.body.stav === 'hotovo') return Promise.resolve();
            if (_abort) return Promise.resolve();
            if (b.body.vi >= vr.length) { b.body.stav = 'hotovo'; b.ts = Date.now(); return ulozit(); }
            var L = vr[b.body.vi];
            report('Body: vrstva ' + (b.body.vi + 1) + '/' + vr.length + ' · zatím ' + num(b.body.pocet) + ' bodů');
            var url = ENDPOINT + '/' + L + '/query?where=1%3D1&geometry=' + geom + '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&orderByFields=OBJECTID&resultOffset=' + b.body.off + '&resultRecordCount=' + PAGE + '&f=json';
            var pokus = 0;
            function nacti() {
                return fetchJson(url).catch(function (e) {
                    pokus++;
                    if (pokus >= 3 || _abort) throw e;
                    return sleep(1500 * pokus).then(nacti);
                });
            }
            return nacti().then(function (d) {
                var feats = (d && d.features) || [];
                var items = feats.map(function (f) { return { layerId: L, attributes: f.attributes, geometry: f.geometry }; });
                return mergePage(items, id).then(function () {
                    b.body.pocet += items.length;
                    if (feats.length < PAGE && !(d && d.exceededTransferLimit)) { b.body.vi++; b.body.off = 0; }
                    else b.body.off += feats.length;
                    return ulozit();
                });
            }).then(function () { return sleep(150); }).then(bodyKrok);
        }

        function mapaKrok() {
            if (!b.mapa || b.mapa.stav === 'hotovo' || _abort) return Promise.resolve();
            if (!('caches' in window)) { b.mapa.stav = 'chyba'; b.mapa.msg = 'prohlížeč neumí ukládat dlaždice'; return ulozit(); }
            var urls = tileUrls(ob.bbox, b.mapa.zooms);
            b.mapa.celkem = urls.length; b.mapa.hotovo = 0; b.mapa.chyby = 0;
            return caches.open(TILE_CACHE).then(function (cache) {
                var i = 0;
                function davka() {
                    if (_abort) return Promise.resolve();
                    if (i >= urls.length) { b.mapa.stav = b.mapa.chyby > urls.length * 0.1 ? 'castecne' : 'hotovo'; b.ts = Date.now(); return ulozit(); }
                    var chunk = urls.slice(i, i + 6); i += 6;
                    return Promise.all(chunk.map(function (u) {
                        return cache.match(u).then(function (hit) {
                            if (hit) { b.mapa.hotovo++; return; }
                            return fetch(u, { mode: 'cors' }).then(function (r) {
                                if (!r.ok) throw new Error('HTTP ' + r.status);
                                return cache.put(u, r).then(function () { b.mapa.hotovo++; });
                            }).catch(function () { b.mapa.chyby++; });
                        });
                    })).then(function () {
                        if ((i / 6) % 10 === 0) { report('Mapa: ' + num(b.mapa.hotovo) + ' / ' + num(b.mapa.celkem) + ' dílků'); return ulozit(); }
                    }).then(davka);
                }
                return davka();
            });
        }

        return loadMeta().then(ulozit).then(bodyKrok).then(mapaKrok).then(function () {
            _bezi = null;
            _cells = {}; _cellOrder = [];
            return ulozit().then(function () { return b; });
        }).catch(function (e) {
            _bezi = null;
            return ulozit().then(function () { throw e; });
        });
    }

    // Dlaždice balíčku ven z TILE_CACHE (přání 15. 9. 2026: „mít možnost je smazat a uvolnit
    // místo"). Dlaždice sdílené s jiným balíčkem / s „Uložit okolí" se smažou taky — jsou
    // znovu stažitelné, kdežto neuvolněné místo v telefonu nikomu nepomůže.
    function smazatDlazdice(b) {
        if (!b || !b.mapa || !('caches' in window)) return Promise.resolve(0);
        var urls = tileUrls(b.bbox, b.mapa.zooms || []);
        return caches.open(TILE_CACHE).then(function (cache) {
            var i = 0, n = 0;
            function davka() {
                if (i >= urls.length) return n;
                var chunk = urls.slice(i, i + 50); i += 50;
                return Promise.all(chunk.map(function (u) { return cache.delete(u).then(function (ok) { if (ok) n++; }).catch(function () { }); })).then(davka);
            }
            return davka();
        }).catch(function (e) { swallow(e, 'oblasti:smazatDlazdice'); return 0; });
    }
    // Po smazání celé cache dlaždic (Nastavení → Údržba) balíčky mapu nemají — zapsat.
    function mapaSmazana() {
        return loadMeta().then(function () {
            _meta.balicky.forEach(function (b) { if (b.mapa) b.mapa = null; });
            return saveMeta();
        });
    }
    function smazat(id) {
        var b = najdiBalicek(id); if (!b) return Promise.resolve();
        var ostatni = _meta.balicky.filter(function (x) { return x.id !== id && x.body; });
        var s = shelf(); if (!s) return Promise.resolve();
        var dl = smazatDlazdice(b);
        // buňky v obálce balíčku: vyhodit záznamy tohoto balíčku, které neleží v jiném
        var bb = b.bbox, keys = [];
        for (var la = Math.floor(bb[1] / CELL); la <= Math.floor(bb[3] / CELL); la++)
            for (var lo = Math.floor(bb[0] / CELL); lo <= Math.floor(bb[2] / CELL); lo++) keys.push(la + '_' + lo);
        var i = 0;
        function dalsi() {
            if (i >= keys.length) return Promise.resolve();
            var k = keys[i++];
            return s.get('c:' + k).then(function (raw) {
                if (!raw) return;
                var arr; try { arr = JSON.parse(raw); } catch (e) { return; }
                var zbyva = arr.filter(function (o) {
                    if (o.p !== id) return true;
                    for (var j = 0; j < ostatni.length; j++) { var ob = ostatni[j].bbox; if (o.x >= ob[0] && o.x <= ob[2] && o.y >= ob[1] && o.y <= ob[3]) { o.p = ostatni[j].id; return true; } }
                    return false;
                });
                if (zbyva.length === arr.length && !zbyva.some(function (o) { return o.p !== id; })) return;
                return zbyva.length ? s.put('c:' + k, JSON.stringify(zbyva)) : s.del('c:' + k);
            }).then(dalsi);
        }
        return dalsi().then(function () { return dl; }).then(function () {
            _meta.balicky = _meta.balicky.filter(function (x) { return x.id !== id; });
            _cells = {}; _cellOrder = [];
            return saveMeta();
        });
    }

    // Odhad velikosti před stažením: počet bodů (6 rychlých dotazů returnCountOnly) + dlaždice.
    function odhad(ob, detail) {
        var zs = tileZoomsCapped(ob.bbox, tileZooms(ob.typ, detail));
        var dl = tileCount(ob.bbox, zs);
        var out = { dlazdice: dl, zooms: zs, body: null };
        var geom = ob.bbox.join(',');
        var vr = vrstvy();
        return Promise.all(vr.map(function (L) {
            return fetchJson(ENDPOINT + '/' + L + '/query?where=1%3D1&geometry=' + geom + '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnCountOnly=true&f=json', 15000)
                .then(function (d) { return (d && d.count) || 0; }).catch(function () { return null; });
        })).then(function (cnts) {
            var s = 0, nevim = false; cnts.forEach(function (c) { if (c == null) nevim = true; else s += c; });
            out.body = nevim ? null : s;
            return out;
        });
    }

    // --------------------------------------------------------------------------------
    // UI
    // --------------------------------------------------------------------------------
    function build() {
        if (_ov && document.body.contains(_ov)) return _ov;
        _ov = document.createElement('div');
        _ov.className = 'modal-overlay ago-overlay';
        _ov.id = 'ago-modal';
        _ov.innerHTML =
            '<div class="modal-content ago-content" role="dialog" aria-modal="true" aria-labelledby="ago-title">' +
            '  <h3 class="ago-title" id="ago-title">Stáhnout okres, kraj nebo celou ČR</h3>' +
            '  <div class="ago-note">Jako v Pokémon Go: <b>všechny úřední body</b> oblasti a přehledová mapa leží v telefonu. Při chůzi se pak nic nenačítá ze sítě — body kolem tebe naskočí hned a bez signálu.</div>' +
            '  <div class="modal-body ago-body">' +
            '    <div id="ago-kde" class="ago-kde"></div>' +
            '    <div class="ago-lbl">Co stáhnout</div>' +
            '    <div class="ago-seg" role="tablist" id="ago-seg">' +
            '      <button type="button" data-typ="okres" role="tab">Okres</button>' +
            '      <button type="button" data-typ="kraj" role="tab">Kraj</button>' +
            '      <button type="button" data-typ="cr" role="tab">Celá ČR</button>' +
            '    </div>' +
            '    <select id="ago-sel" class="st-sel ago-sel" aria-label="Oblast"></select>' +
            '    <label class="ago-chk"><input type="checkbox" id="ago-body" checked> <span>Body bodového pole <small>TB, ZhB, PPBP, nivelační, tíhové — kompletní</small></span></label>' +
            '    <label class="ago-chk"><input type="checkbox" id="ago-mapa" checked> <span>Přehledová mapa <small id="ago-mapa-pop"></small></span></label>' +
            '    <label class="ago-chk" id="ago-detail-row"><input type="checkbox" id="ago-detail"> <span>+ podrobnější mapa (z16) <small>jen u okresu; podrobnost z17–18 má „Uložit okolí"</small></span></label>' +
            '    <div id="ago-odhad" class="ago-odhad"></div>' +
            '    <div id="ago-prubeh" class="ago-prubeh" hidden></div>' +
            '    <div class="ago-lbl">V telefonu</div>' +
            '    <div id="ago-list" class="ago-list"></div>' +
            '  </div>' +
            '  <button type="button" class="btn btn-primary" id="ago-go">Stáhnout</button>' +
            '  <button type="button" class="btn btn-secondary" id="ago-close">Zavřít</button>' +
            '</div>';
        document.body.appendChild(_ov);
        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov && !_bezi) close(); });
        _ov.querySelector('#ago-close').addEventListener('click', function () {
            if (_bezi) { toast('Stahování běží na pozadí — postup se ukládá, můžeš se vrátit.'); }
            close();
        });
        _ov.querySelector('#ago-seg').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-typ]') : null; if (!b) return;
            _typ = b.getAttribute('data-typ'); _vyber = null; renderVyber();
        });
        _ov.querySelector('#ago-sel').addEventListener('change', function () { _vyber = parseInt(this.value, 10) || 0; renderOdhad(); });
        _ov.querySelector('#ago-body').addEventListener('change', function () { _chceBody = this.checked; renderOdhad(); });
        _ov.querySelector('#ago-mapa').addEventListener('change', function () { _chceMapu = this.checked; renderOdhad(); });
        _ov.querySelector('#ago-detail').addEventListener('change', function () { _chceDetail = this.checked; renderOdhad(); });
        _ov.querySelector('#ago-go').addEventListener('click', run);
        _ov.querySelector('#ago-list').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-act]') : null; if (!b) return;
            var id = b.getAttribute('data-id'), act = b.getAttribute('data-act');
            var bal = najdiBalicek(id); if (!bal) return;
            if (act === 'smazat') {
                confirmBox({ title: 'Smazat balíček', message: 'Smazat <b>' + esc(bal.nazev) + '</b> z telefonu? Body se pak zase budou stahovat ze sítě.', okText: 'Smazat', danger: true })
                    .then(function (ok) { if (ok) smazat(id).then(renderList); });
            } else if (act === 'pokracovat' || act === 'aktualizovat') {
                var ob = oblast(bal.typ, bal.kod) || { typ: bal.typ, kod: bal.kod, nazev: bal.nazev, bbox: bal.bbox };
                spustit(ob, { body: !!bal.body, mapa: !!bal.mapa, detail: !!(bal.mapa && bal.mapa.zooms && bal.mapa.zooms.indexOf(ZOOM_DETAIL) >= 0), znovu: act === 'aktualizovat' });
            } else if (act === 'zastavit') { _abort = true; toast('Zastavuji…'); }
        });
        return _ov;
    }

    function renderKde() {
        var host = _ov.querySelector('#ago-kde');
        var k = kdeJsem();
        if (!k) { host.innerHTML = '<span class="ago-dim">Poloha zatím není známá — vyber oblast ručně.</span>'; return; }
        var pok = pokryto(k.lat, k.lng);
        host.innerHTML = 'Teď stojíš v: <b>' + esc(k.okres ? k.okres.nazev : '?') + '</b>' + (k.kraj ? ' · ' + esc(k.kraj.nazev) : '') +
            (pok ? '<br><span class="ago-ok">✓ tohle místo už je v telefonu — body jdou bez sítě</span>' : '<br><span class="ago-dim">tohle místo v telefonu ještě není</span>');
        if (k.okres && _vyber == null && _typ === 'okres') _vyber = k.okres.kod;
        if (k.kraj && _vyber == null && _typ === 'kraj') _vyber = k.kraj.kod;
    }
    function renderVyber() {
        _ov.querySelectorAll('#ago-seg button').forEach(function (b) { var on = b.getAttribute('data-typ') === _typ; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
        var sel = _ov.querySelector('#ago-sel');
        var k = kdeJsem();
        if (_typ === 'cr') { sel.innerHTML = '<option value="0">Celá Česká republika</option>'; sel.disabled = true; _vyber = 0; }
        else {
            var list = _typ === 'kraj' ? _hranice.kraje : _hranice.okresy;
            if (_vyber == null) _vyber = (k && (_typ === 'kraj' ? k.kraj : k.okres)) ? (_typ === 'kraj' ? k.kraj.kod : k.okres.kod) : list[0].kod;
            sel.innerHTML = list.map(function (o) { return '<option value="' + o.kod + '"' + (o.kod === _vyber ? ' selected' : '') + '>' + esc(o.nazev) + '</option>'; }).join('');
            sel.disabled = false;
        }
        _ov.querySelector('#ago-detail-row').style.display = _typ === 'okres' ? '' : 'none';
        var zs = ZOOMS[_typ]; _ov.querySelector('#ago-mapa-pop').textContent = 'OSM do měřítka z' + zs[zs.length - 1] + (_typ === 'okres' ? ' (~1 : 20 000)' : _typ === 'kraj' ? ' (~1 : 70 000)' : ' (~1 : 300 000)');
        renderOdhad();
    }
    var _odhadTok = 0;
    function renderOdhad() {
        var host = _ov.querySelector('#ago-odhad');
        var ob = oblast(_typ, _vyber);
        if (!ob) { host.textContent = ''; return; }
        var zs = tileZoomsCapped(ob.bbox, tileZooms(_typ, _chceDetail));
        var dl = tileCount(ob.bbox, zs);
        var tok = ++_odhadTok;
        var mapTxt = _chceMapu ? num(dl) + ' dílků mapy (~' + mb(dl * 14000) + ')' + (zs.length < tileZooms(_typ, _chceDetail).length ? ' — podrobnější zoomy odpadly, bylo by jich přes ' + num(TILE_CAP) : '') : '';
        host.innerHTML = '<b>' + esc(ob.nazev) + '</b>: ' + (_chceBody ? '<span id="ago-odh-body">počítám body…</span>' : '') + (_chceBody && _chceMapu ? ' · ' : '') + esc(mapTxt);
        if (!_chceBody) return;
        if (!navigator.onLine) { var e0 = host.querySelector('#ago-odh-body'); if (e0) e0.textContent = 'body (počet zjistím online)'; return; }
        odhad(ob, _chceDetail).then(function (o) {
            if (tok !== _odhadTok) return;
            var el = host.querySelector('#ago-odh-body'); if (!el) return;
            if (o.body == null) el.textContent = 'body (počet se nepodařilo zjistit)';
            else el.innerHTML = num(o.body) + ' bodů (~' + mb(o.body * 160) + (o.body > 100000 ? ', ' + Math.round(o.body / 2000 * 2.5 / 60) + '–' + Math.round(o.body / 2000 * 5 / 60) + ' min' : '') + ')';
        });
    }
    function renderList() {
        var host = _ov && _ov.querySelector('#ago-list'); if (!host) return;
        var bs = (_meta && _meta.balicky) || [];
        if (!bs.length) { host.innerHTML = '<div class="ago-dim">Zatím nic. Stáhni okres, ve kterém pracuješ — je to pár MB.</div>'; return; }
        host.innerHTML = bs.map(function (b) {
            var st = [];
            if (b.body) st.push(b.body.stav === 'hotovo' ? '✓ ' + num(b.body.pocet) + ' bodů' : (b === _bezi ? '… body ' + num(b.body.pocet) : '! body rozdělané (' + num(b.body.pocet) + ')'));
            if (b.mapa) st.push(b.mapa.stav === 'hotovo' ? '✓ mapa ' + num(b.mapa.celkem) + ' dílků' : b.mapa.stav === 'castecne' ? '! mapa ' + num(b.mapa.hotovo) + '/' + num(b.mapa.celkem) : (b === _bezi ? '… mapa ' + num(b.mapa.hotovo) + '/' + num(b.mapa.celkem) : '! mapa rozdělaná'));
            var rozdel = (b.body && b.body.stav !== 'hotovo') || (b.mapa && b.mapa.stav !== 'hotovo' && b.mapa.stav !== 'castecne');
            var kdy = b.ts ? new Date(b.ts).toLocaleDateString('cs-CZ') : '';
            var akce = b === _bezi ? '<button type="button" class="btn btn-secondary ago-mini" data-act="zastavit" data-id="' + esc(b.id) + '">Zastavit</button>'
                : (rozdel ? '<button type="button" class="btn btn-primary ago-mini" data-act="pokracovat" data-id="' + esc(b.id) + '">Pokračovat</button>'
                    : '<button type="button" class="btn btn-secondary ago-mini" data-act="aktualizovat" data-id="' + esc(b.id) + '">Aktualizovat</button>')
                + '<button type="button" class="btn btn-secondary ago-mini ago-del" data-act="smazat" data-id="' + esc(b.id) + '" aria-label="Smazat">✕</button>';
            return '<div class="ago-item" data-st="' + (b === _bezi ? 'run' : rozdel ? 'warn' : 'ok') + '"><div class="ago-it-txt"><b>' + esc(b.nazev) + '</b> <span class="ago-dim">' + esc(b.typ === 'cr' ? '' : b.typ) + (kdy ? ' · ' + kdy : '') + '</span><small>' + esc(st.join(' · ')) + '</small></div><div class="ago-it-akce">' + akce + '</div></div>';
        }).join('');
    }
    function renderPrubeh(txt) {
        var host = _ov && _ov.querySelector('#ago-prubeh'); if (!host) return;
        if (!txt) { host.hidden = true; return; }
        host.hidden = false; host.textContent = txt;
        renderList();
    }

    function spustit(ob, opts) {
        if (_bezi) { toast('Už se něco stahuje — počkej, až to doběhne.'); return; }
        if (!navigator.onLine) { alertBox('Nejsi online', 'Stahování oblasti potřebuje internet — nejlíp Wi-Fi, u celé ČR jde o stovky MB.'); return; }
        var go = _ov.querySelector('#ago-go'); if (go) { go.disabled = true; go.textContent = 'Stahuji…'; }
        renderPrubeh('Začínám…');
        var t0 = Date.now();
        stahnout(ob, opts, function (b, txt) { renderPrubeh(txt); }).then(function (b) {
            renderPrubeh(null); renderList(); renderKde();
            var s = Math.round((Date.now() - t0) / 1000);
            if (_abort) { toast('Zastaveno — postup je uložený, dá se pokračovat.'); return; }
            var casti = [];
            if (b.body) casti.push(num(b.body.pocet) + ' bodů');
            if (b.mapa) casti.push(num(b.mapa.hotovo) + ' dílků mapy' + (b.mapa.chyby ? ' (' + b.mapa.chyby + ' se nestáhlo)' : ''));
            alertBox('Staženo', '<b>' + esc(b.nazev) + '</b>: ' + esc(casti.join(' a ')) + ' za ' + (s < 90 ? s + ' s' : Math.round(s / 60) + ' min') + '.<br><br>Body kolem tebe se teď berou z telefonu — i bez signálu.');
            try { if (typeof userLat !== 'undefined' && userLat && typeof initFetch === 'function') initFetch(userLat, userLng); } catch (e) { swallow(e, 'oblasti:refetch'); }
        }).catch(function (e) {
            swallow(e, 'oblasti:stahnout');
            renderPrubeh(null); renderList();
            alertBox('Stahování se přerušilo', esc((e && e.message) || 'neznámá chyba') + '<br><br>Postup je uložený — tlačítkem <b>Pokračovat</b> to naváže tam, kde skončilo.');
        }).then(function () { if (go) { go.disabled = false; go.textContent = 'Stáhnout'; } });
    }
    function run() {
        var ob = oblast(_typ, _vyber);
        if (!ob) { toast('Vyber oblast.'); return; }
        if (!_chceBody && !_chceMapu) { toast('Zaškrtni, co stáhnout.'); return; }
        var jdi = function () { spustit(ob, { body: _chceBody, mapa: _chceMapu, detail: _chceDetail, znovu: true }); };
        if (ob.typ === 'cr' && _chceBody) {
            confirmBox({ title: 'Celá republika', message: 'Bodové pole celé ČR je ~635 000 bodů (řádově 100 MB, 10–25 minut). Jde to přerušit a dokončit později. Pokračovat?', okText: 'Stáhnout' }).then(function (ok) { if (ok) jdi(); });
        } else jdi();
    }

    function open() {
        build();
        _ov.style.display = 'flex';
        _ov.querySelector('#ago-kde').innerHTML = '<span class="ago-dim">Načítám hranice okresů…</span>';
        Promise.all([loadMeta(), hranice()]).then(function (r) {
            if (!r[1]) { _ov.querySelector('#ago-kde').innerHTML = '<span class="ago-bad">Hranice okresů se nepodařilo načíst (bez signálu?). Stažené balíčky ale fungují dál.</span>'; renderList(); return; }
            if (!shelf()) { _ov.querySelector('#ago-kde').innerHTML = '<span class="ago-bad">Úložiště (js/ag-store.js) není k dispozici — balíčky nejde ukládat.</span>'; }
            renderKde(); renderVyber(); renderList();
        });
    }
    function close() { if (_ov) _ov.style.display = 'none'; }

    window.AGOblasti = { open: open, pokryto: pokryto, body: body, etrs: etrs, stahnout: stahnout, smazat: smazat, mapaSmazana: mapaSmazana, loadMeta: loadMeta, meta: function () { return _meta; }, hranice: hranice, kdeJsem: kdeJsem, _cell: cellKey };
    window.agOpenOblasti = open;

    // dlaždice v Nástrojích
    function injectTile() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'oblasti-offline', label: 'Stáhnout oblast', icon: ICON, cat: 'Katastr a data', onClick: open, order: 6 });
            return true;
        }
        return false;
    }
    function init() {
        // metadata hned při startu: fetchGeodata se ptá pokryto() synchronně
        loadMeta().then(function () {
            try {
                if (hotove().length && typeof userLat !== 'undefined' && userLat && pokryto(userLat, userLng) && typeof initFetch === 'function') initFetch(userLat, userLng);
            } catch (e) { swallow(e, 'oblasti:init'); }
        });
        if (!injectTile()) {
            var n = 0, t = setInterval(function () { if (injectTile() || ++n > 40) clearInterval(t); }, 500);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
