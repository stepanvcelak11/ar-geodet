// ===== QTRIG — DATA VEKTOROVÉ MAPY BEZ OHLEDU NA VÝŘEZ (ODPOJITELNÁ, ag/lazy) ==============
// (17. 9. 2026 — oprava hlášení „navigace mě vede zdmi domů")
//
// PROČ: trasa terénem (js/trasa-terenem.js), hlídač okolí i mapa kvality GPS si braly budovy
// a cesty přes MapLibre `querySourceFeatures` — to vrací JEN DLAŽDICE, KTERÉ MÁ MAPA ZROVNA
// NAČTENÉ PRO SVŮJ VÝŘEZ. Když je hlavní mapa oddálená (z < 14 nemá budovy vůbec) nebo cíl
// leží mimo obrazovku, rastr cen dostal prázdno a A* vedl rovně skrz domy. Tohle čte dlaždice
// PŘÍMO ze souboru PMTiles (stejná adresa jako mapa, stejná cache prohlížeče) pro libovolný
// obdélník, dekóduje Mapbox Vector Tile (protobuf) a vrací geometrie v lat/lng.
//
// API (vše bez vedlejších účinků, nic nekreslí):
//   AGMapaData.oblast({s,w,n,e}) → Promise<{buildings, roads, water, landuse, landcover}>
//       každý prvek: { geom:'Polygon'|'LineString'|'Point', polys:[[ring…]], lines:[[{lat,lng}…]],
//                      pts:[{lat,lng}], props:{…} }   (polygony = pole prstenců, první vnější)
//   AGMapaData.oblastHned(bbox) → totéž z paměti, nebo null, když dlaždice ještě nejsou stažené
//   AGMapaData.dlazdice(z,x,y) → Promise<{vrstvy:{name:[prvky]}}>  (LRU cache 40 dlaždic)
// Dlaždice: z = 15 (nejpodrobnější v základní mapě Protomaps; fixture testů má z11–15).
// Vyžaduje zapnutou vektorovou mapu (knihovna pmtiles + adresa dat) — bez ní vrací prázdno.
// Odstranění: smaž js/mapa-data.js + <script> v index.html; trasa se vrátí k datům z výřezu.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGMapaData) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'mapa-data:' + kde); } catch (e2) { /* nic */ } };
    var Z = 15, MAX_CACHE = 40, MAX_DLAZDIC = 12;
    var _cache = {}, _poradi = [];

    // ---- pmtiles: stejná instance, jakou používá mapa (Protocol drží cache podle adresy) --------
    // ⚠ NEZÁVISLE NA PODKLADU (17. 9. 2026, uživatel: „navigace je pořád přímka i v základní mapě"):
    //   dřív se data braly jen při ZAPNUTÉ vektorové mapě. Kdo jede na ortofotu nebo rastru, neměl
    //   nic → přímka. Teď stačí knihovna pmtiles (dotáhne se sama) a adresa dat; MapLibre mapa
    //   na obrazovce být nemusí.
    var _zdroj = null, _zdrojUrl = null;
    function zdroj() {
        try {
            if (!window.pmtiles || !window.AGMapaVektor) return null;
            var url = AGMapaVektor.url(); if (!url) return null;
            var proto = AGMapaVektor.protokol && AGMapaVektor.protokol();
            if (proto && proto.get(url)) return proto.get(url);
            if (_zdroj && _zdrojUrl === url) return _zdroj;
            _zdroj = new pmtiles.PMTiles(url); _zdrojUrl = url; if (proto) proto.add(_zdroj);
            return _zdroj;
        } catch (e) { swallow(e, 'zdroj'); return null; }
    }
    function zdrojAsync() {
        var z = zdroj(); if (z) return Promise.resolve(z);
        if (!window.AGMapaVektor || !AGMapaVektor.knihovny) return Promise.reject(new Error('modul vektorové mapy chybí'));
        if (window.AGLite && AGLite.lite) return Promise.reject(new Error('režim slabší telefon'));
        return AGMapaVektor.knihovny().then(function () { var z2 = zdroj(); if (!z2) throw new Error('data mapy nejsou k dispozici'); return z2; });
    }

    // ---- protobuf (jen to, co MVT potřebuje) ----------------------------------------------------
    function Pbf(buf) { this.b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); this.p = 0; this.dv = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength); }
    Pbf.prototype.varint = function () {
        var b = this.b, r = 0, s = 0, x;
        // do 2^53 stačí (id, tagy, geometrie); delší varinty se ořežou, nic z nich nepotřebujeme
        do { x = b[this.p++]; if (s < 53) r += (x & 0x7f) * Math.pow(2, s); s += 7; } while (x & 0x80);
        return r;
    };
    Pbf.prototype.bytes = function () { var n = this.varint(), out = this.b.subarray(this.p, this.p + n); this.p += n; return out; };
    Pbf.prototype.string = function () { var u = this.bytes(); try { return new TextDecoder('utf-8').decode(u); } catch (e) { var s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return s; } };
    Pbf.prototype.skip = function (typ) { if (typ === 0) this.varint(); else if (typ === 1) this.p += 8; else if (typ === 2) this.p += this.varint(); else if (typ === 5) this.p += 4; else throw new Error('pbf typ ' + typ); };
    Pbf.prototype.each = function (fn) { while (this.p < this.b.length) { var k = this.varint(), f = k >> 3, t = k & 7; if (!fn(f, t)) this.skip(t); } };
    function hodnota(u8) {
        var p = new Pbf(u8), v = null;
        p.each(function (f, t) {
            if (f === 1) { v = p.string(); return true; }
            if (f === 2) { v = p.dv.getFloat32(p.p, true); p.p += 4; return true; }
            if (f === 3) { v = p.dv.getFloat64(p.p, true); p.p += 8; return true; }
            if (f === 4 || f === 5) { v = p.varint(); return true; }
            if (f === 6) { var z = p.varint(); v = (z % 2) ? -(z + 1) / 2 : z / 2; return true; }
            if (f === 7) { v = !!p.varint(); return true; }
            return false;
        });
        return v;
    }
    function packed(p, fn) { var u = p.bytes(), q = new Pbf(u); while (q.p < q.b.length) fn(q.varint()); }
    function zigzag(n) { return (n % 2) ? -(n + 1) / 2 : n / 2; }

    // geometrie MVT → pole čar (každá = pole {x,y} v souřadnicích dlaždice)
    function geometrie(cmds, typ) {
        var out = [], cur = null, x = 0, y = 0, i = 0;
        while (i < cmds.length) {
            var c = cmds[i++], cmd = c & 7, n = c >> 3;
            if (cmd === 1) { for (var k = 0; k < n; k++) { x += zigzag(cmds[i++]); y += zigzag(cmds[i++]); cur = [{ x: x, y: y }]; out.push(cur); } }
            else if (cmd === 2) { for (var k2 = 0; k2 < n; k2++) { x += zigzag(cmds[i++]); y += zigzag(cmds[i++]); if (cur) cur.push({ x: x, y: y }); } }
            else if (cmd === 7) { if (cur && typ === 3 && cur.length && (cur[0].x !== cur[cur.length - 1].x || cur[0].y !== cur[cur.length - 1].y)) cur.push({ x: cur[0].x, y: cur[0].y }); }
            else break;
        }
        return out;
    }
    function plocha(ring) { var a = 0; for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y); return a / 2; }

    function dekoduj(buf, z, x, y) {
        var t = new Pbf(buf), vrstvy = {}, n = Math.pow(2, z);
        function ll(q, ext) {
            var lng = (x + q.x / ext) / n * 360 - 180;
            var yy = (y + q.y / ext) / n, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180 / Math.PI;
            return { lat: lat, lng: lng };
        }
        t.each(function (f, typ) {
            if (f !== 3) return false;
            var L = new Pbf(t.bytes()), name = '', ext = 4096, keys = [], vals = [], feats = [];
            L.each(function (lf) {
                if (lf === 1) { name = L.string(); return true; }
                if (lf === 3) { keys.push(L.string()); return true; }
                if (lf === 4) { vals.push(hodnota(L.bytes())); return true; }
                if (lf === 5) { ext = L.varint(); return true; }
                if (lf === 2) { feats.push(L.bytes()); return true; }
                return false;
            });
            var prvky = [];
            feats.forEach(function (fb) {
                var F = new Pbf(fb), props = {}, gt = 0, cmds = [], id = null;
                F.each(function (ff) {
                    if (ff === 1) { id = F.varint(); return true; }
                    if (ff === 2) { var tg = []; packed(F, function (v) { tg.push(v); }); for (var i = 0; i + 1 < tg.length; i += 2) props[keys[tg[i]]] = vals[tg[i + 1]]; return true; }
                    if (ff === 3) { gt = F.varint(); return true; }
                    if (ff === 4) { packed(F, function (v) { cmds.push(v); }); return true; }
                    return false;
                });
                var g = geometrie(cmds, gt), prvek = { id: id, props: props, polys: [], lines: [], pts: [] };
                if (gt === 1) { prvek.geom = 'Point'; g.forEach(function (l) { l.forEach(function (q) { prvek.pts.push(ll(q, ext)); }); }); }
                else if (gt === 2) { prvek.geom = 'LineString'; g.forEach(function (l) { if (l.length > 1) prvek.lines.push(l.map(function (q) { return ll(q, ext); })); }); }
                else if (gt === 3) {
                    prvek.geom = 'Polygon'; var poly = null;
                    g.forEach(function (ring) {
                        if (ring.length < 4) return;
                        var r = ring.map(function (q) { return ll(q, ext); });
                        // MVT: vnější prstenec má v souřadnicích dlaždice (y dolů) kladnou plochu, díry zápornou
                        if (plocha(ring) >= 0 || !poly) { poly = [r]; prvek.polys.push(poly); } else poly.push(r);
                    });
                }
                else return;
                prvky.push(prvek);
            });
            vrstvy[name] = prvky;
            return true;
        });
        return { vrstvy: vrstvy, z: z, x: x, y: y };
    }

    // ---- dlaždice s cache ---------------------------------------------------------------------
    function dlazdice(z, x, y) {
        var k = z + '/' + x + '/' + y;
        if (_cache[k]) return _cache[k];
        var pr = zdrojAsync().then(function (src) { return src.getZxy(z, x, y); }).then(function (r) {
            var d = (r && r.data) ? dekoduj(r.data, z, x, y) : { vrstvy: {}, z: z, x: x, y: y, prazdna: true };
            d.hotovo = true; return d;
        }).catch(function (e) { delete _cache[k]; throw e; });
        _cache[k] = pr; _poradi.push(k);
        while (_poradi.length > MAX_CACHE) { var s = _poradi.shift(); delete _cache[s]; }
        return pr;
    }
    function tilesPro(bbox, z) {
        var n = Math.pow(2, z);
        function tx(lng) { return Math.floor((lng + 180) / 360 * n); }
        function ty(lat) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); }
        var x0 = tx(bbox.w), x1 = tx(bbox.e), y0 = ty(bbox.n), y1 = ty(bbox.s), out = [];
        for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) out.push({ z: z, x: x, y: y });
        return out;
    }
    function sloz(dl) {
        var out = { buildings: [], roads: [], water: [], landuse: [], landcover: [], pois: [], dlazdic: dl.length };
        dl.forEach(function (d) { Object.keys(out).forEach(function (k) { if (d.vrstvy && d.vrstvy[k]) out[k] = out[k].concat(d.vrstvy[k]); }); });
        return out;
    }
    // po chybě (data pro zemi nejsou, bez signálu) 60 s nezkoušet znovu — tik trasy by jinak každých 5 s
    // střílel 404 na worker
    var _chybaDo = 0, _chybaText = '';
    function oblast(bbox) {
        var t = tilesPro(bbox, Z); if (t.length > MAX_DLAZDIC) return Promise.reject(new Error('oblast příliš velká (' + t.length + ' dlaždic)'));
        if (Date.now() < _chybaDo) return Promise.reject(new Error(_chybaText || 'data mapy nejsou k dispozici'));
        return Promise.all(t.map(function (q) { return dlazdice(q.z, q.x, q.y); })).then(sloz).catch(function (e) { _chybaDo = Date.now() + 60000; _chybaText = (e && e.message) || String(e); throw e; });
    }
    // synchronně z cache: Promise si ukládá výsledek do .vysledek, ať se nemusí čekat
    function oblastHned(bbox) {
        var t = tilesPro(bbox, Z), dl = [];
        for (var i = 0; i < t.length; i++) { var k = t[i].z + '/' + t[i].x + '/' + t[i].y; var p = _cache[k]; if (!p || !p._vysledek) return null; dl.push(p._vysledek); }
        return sloz(dl);
    }
    var _dlazdice = dlazdice;
    dlazdice = function (z, x, y) { var p = _dlazdice(z, x, y); if (!p._vysledek && !p._ceka) { p._ceka = true; p.then(function (d) { p._vysledek = d; }).catch(function () { /* z cache už je pryč */ }); } return p; };

    window.AGMapaData = { oblast: oblast, oblastHned: oblastHned, dlazdice: dlazdice, tilesPro: tilesPro, dekoduj: dekoduj, Z: Z, cache: function () { return Object.keys(_cache).length; }, pripraven: function () { return !!zdroj(); }, zdrojAsync: zdrojAsync, chyba: function () { return Date.now() < _chybaDo ? _chybaText : ''; } };
})();
