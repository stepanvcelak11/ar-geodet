// ===== QTRIG — MÍSTOPISNÝ NÁČRT (ODPOJITELNÁ, lazy nástroj) ================================
// (17. 9. 2026, přání uživatele: „nový nástroj: tvorba místopisného náčrtu — z mapy hrubé obrysy,
// můj vybraný bod, klepnu odkud kam je jaká vzdálenost, přidávám objekty jako stromy, různé podklady")
//
// CO DĚLÁ: samostatné okno s mapou Leaflet kolem VYBRANÉHO BODU (úřední nebo vlastní):
//   • PODKLAD: Papír (bílý list + hrubé obrysy z vektorové mapy: budovy, silnice, cesty, voda,
//     koleje, les) · Mapa (rastr OSM) · Ortofoto (ČÚZK / podle země). Náčrt je v souřadnicích,
//     takže co nakreslím na ortofotu, vidím i na papíru a naopak.
//   • VZDÁLENOST: dvě klepnutí = kótovaná čára odkud kam s délkou ze souřadnic; klepnutím na
//     kótu se dá přepsat na hodnotu naměřenou pásmem (v náčrtu je pak tučně). Přichytává se
//     k bodům, rohům budov, objektům a koncům čar (do 14 px).
//   • OBJEKTY: strom, keř, sloup, šachta, hydrant, kámen, značka, plot/hrana (lomená čára), text.
//   • Zpět, Smazat (klepnutím na prvek), uložení PER BOD v zakázce (klíč agNacrty), export PNG
//     (papírová podoba + severka + měřítko + legenda) přes sdílení.
// Data obrysů: js/mapa-data.js (dlaždice PMTiles, nezávislé na výřezu); bez zapnuté vektorové
// mapy je „Papír" jen bílý list — nástroj poradí, kde mapu zapnout.
// Odstranění: smaž js/mistopisny-nacrt.js + css/mistopisny-nacrt.css, řádek v MANIFESTu
// js/lazy-tools.js, klíč 'mistopisny-nacrt' v js/tools-registry.js a data/navody.json.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGNacrt) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'mistopisny-nacrt:' + kde); } catch (e2) { /* nic */ } };
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M8 16l3-5 3 3 2-2 2 4"/><circle cx="9" cy="8" r="1.4"/></svg>';
    var KEY = 'agNacrty', R_DATA = 220, SNAP_PX = 14;
    var OBJEKTY = {
        strom: { n: 'Strom', svg: '<circle cx="12" cy="12" r="7" fill="none" stroke="#2f7d32" stroke-width="2"/><path d="M12 5v14M5 12h14" stroke="#2f7d32" stroke-width="1.4"/>' },
        ker: { n: 'Keř', svg: '<path d="M6 15a4 4 0 0 1 2-7 4 4 0 0 1 8 0 4 4 0 0 1 2 7Z" fill="none" stroke="#5c8f3a" stroke-width="2"/>' },
        sloup: { n: 'Sloup', svg: '<circle cx="12" cy="12" r="5" fill="none" stroke="#333" stroke-width="2"/><circle cx="12" cy="12" r="1.6" fill="#333"/>' },
        sachta: { n: 'Šachta', svg: '<rect x="6" y="6" width="12" height="12" fill="none" stroke="#333" stroke-width="2"/><path d="M6 6l12 12" stroke="#333" stroke-width="1.4"/>' },
        hydrant: { n: 'Hydrant', svg: '<circle cx="12" cy="12" r="7" fill="none" stroke="#c62828" stroke-width="2"/><text x="12" y="16" font-size="10" text-anchor="middle" fill="#c62828" font-weight="700">H</text>' },
        kamen: { n: 'Kámen / mezník', svg: '<path d="M12 4l7 7-7 9-7-9z" fill="none" stroke="#5d4037" stroke-width="2"/>' },
        znacka: { n: 'Značka / tabule', svg: '<rect x="7" y="4" width="10" height="8" rx="1" fill="none" stroke="#1565c0" stroke-width="2"/><path d="M12 12v8" stroke="#1565c0" stroke-width="2"/>' }
    };
    var CARY = { plot: { n: 'Plot', dash: '6,4', col: '#7b1fa2' }, hrana: { n: 'Hrana (obruba, zeď)', dash: null, col: '#37474f' } };

    var el = null, m = null, pt = null, data = null, rezim = 'vyber', objTyp = 'strom', caraTyp = 'plot', podklad = 'papir';
    var _vrstvy = {}, _prvky = null, _pending = null, _tmp = null, _snapy = [], _undo = [], _bodyObrysu = null;

    // ---- uložení per bod --------------------------------------------------------------------------
    function vse() { try { var s = (typeof getStoredData === 'function') ? getStoredData(KEY) : localStorage.getItem(KEY); var o = s ? JSON.parse(s) : {}; return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    function uloz() { try { var o = vse(); o[pt.id] = { podklad: podklad, prvky: _prvky, ts: Date.now(), name: pt.name }; var s = JSON.stringify(o); if (typeof setStoredData === 'function') setStoredData(KEY, s); else localStorage.setItem(KEY, s); } catch (e) { swallow(e, 'uloz'); } }
    function nacti() { var o = vse()[pt.id]; _prvky = (o && Array.isArray(o.prvky)) ? o.prvky : []; if (o && o.podklad) podklad = o.podklad; }

    // ---- geometrie ----------------------------------------------------------------------------------
    function dist(a, b) { try { return GeoCore.getDistance(a.lat, a.lng, b.lat, b.lng); } catch (e) { var k = 111320; return Math.hypot((a.lat - b.lat) * k, (a.lng - b.lng) * k * Math.cos(a.lat * Math.PI / 180)); } }
    function fmt(d) { return (d < 100 ? d.toFixed(2) : d.toFixed(1)).replace('.', ',') + ' m'; }
    function bod(lat, lng) { return { lat: +lat.toFixed(7), lng: +lng.toFixed(7) }; }
    function snap(ll) {
        if (!m) return ll;
        var p = m.latLngToContainerPoint(ll), best = null;
        _snapy.forEach(function (s) { var q = m.latLngToContainerPoint(s); var d = Math.hypot(q.x - p.x, q.y - p.y); if (d <= SNAP_PX && (!best || d < best.d)) best = { d: d, b: s }; });
        return best ? best.b : ll;
    }
    function sestavSnapy() {
        _snapy = [{ lat: pt.lat, lng: pt.lng }];
        try { (typeof arPoints !== 'undefined' ? arPoints : []).forEach(function (p) { if (p && !p.hidden && typeof p.lat === 'number' && dist(p, pt) <= R_DATA) _snapy.push({ lat: p.lat, lng: p.lng }); }); } catch (e) { /* nic */ }
        if (_bodyObrysu) _snapy = _snapy.concat(_bodyObrysu);
        (_prvky || []).forEach(function (x) { if (x.t === 'obj' || x.t === 'text') _snapy.push(x.p); else if (x.t === 'dim') { _snapy.push(x.a); _snapy.push(x.b); } else if (x.t === 'cara') x.pts.forEach(function (q) { _snapy.push(q); }); });
    }

    // ---- podklady ------------------------------------------------------------------------------------
    function klonVrstvy(orig) {
        try { if (orig && orig.wmsParams) return L.tileLayer.wms(orig._url, Object.assign({}, orig.wmsParams, { maxZoom: 22, zIndex: 1 })); if (orig && orig._url) return L.tileLayer(orig._url, Object.assign({}, orig.options || {}, { maxZoom: 22, maxNativeZoom: 18, zIndex: 1 })); } catch (e) { swallow(e, 'klon'); }
        return null;
    }
    function nastavPodklad(p) {
        podklad = p;
        ['osm', 'orto'].forEach(function (k) { if (_vrstvy[k] && m.hasLayer(_vrstvy[k])) m.removeLayer(_vrstvy[k]); });
        el.classList.toggle('papir', p === 'papir');
        if (p === 'mapa') { if (!_vrstvy.osm) _vrstvy.osm = klonVrstvy(typeof baseLayers !== 'undefined' && baseLayers.osm && baseLayers.osm._url ? baseLayers.osm : null) || L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22, maxNativeZoom: 18 }); _vrstvy.osm.addTo(m); }
        if (p === 'orto') { if (!_vrstvy.orto) _vrstvy.orto = klonVrstvy(typeof baseLayers !== 'undefined' ? baseLayers.ortofoto : null); if (_vrstvy.orto) _vrstvy.orto.addTo(m); }
        if (_vrstvy.obrysy) { _vrstvy.obrysy.eachLayer(function (l) { try { l.setStyle({ opacity: p === 'papir' ? 1 : 0.55, fillOpacity: p === 'papir' ? (l.options._fo || 0) : 0.08 }); } catch (e) { /* nic */ } }); }
        el.querySelectorAll('[data-podklad]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-podklad') === p); });
        uloz();
    }
    function obrysy() {
        if (_vrstvy.obrysy) { m.removeLayer(_vrstvy.obrysy); _vrstvy.obrysy = null; }
        _bodyObrysu = [];
        var g = L.layerGroup().addTo(m); _vrstvy.obrysy = g;
        if (!data) return;
        var fo = podklad === 'papir';
        function poly(rings, st) { var l = L.polygon(rings.map(function (r) { return r.map(function (q) { return [q.lat, q.lng]; }); }), Object.assign({ interactive: false, weight: 1.2 }, st)); l.options._fo = st.fillOpacity; l.addTo(g); return l; }
        function cara(pts, st) { var l = L.polyline(pts.map(function (q) { return [q.lat, q.lng]; }), Object.assign({ interactive: false }, st)); l.options._fo = 0; l.addTo(g); }
        try {
            data.landcover.concat(data.landuse).forEach(function (f) { if (f.geom === 'Polygon' && /forest|wood|scrub/.test(f.props.kind)) f.polys.forEach(function (rings) { poly(rings, { color: '#6b8f4e', fillColor: '#dfe8cf', fillOpacity: fo ? 0.6 : 0.08, dashArray: '3,3' }); }); });
            data.water.forEach(function (f) { if (f.geom === 'Polygon') f.polys.forEach(function (rings) { poly(rings, { color: '#3f7fa8', fillColor: '#cfe3f0', fillOpacity: fo ? 0.7 : 0.08 }); }); else f.lines.forEach(function (l) { cara(l, { color: '#3f7fa8', weight: 1.5 }); }); });
            data.buildings.forEach(function (f) { if (f.geom !== 'Polygon') return; f.polys.forEach(function (rings) { poly(rings, { color: '#5d554a', fillColor: '#e9e4d6', fillOpacity: fo ? 0.9 : 0.08 }); rings[0].forEach(function (q) { _bodyObrysu.push(q); }); }); });
            data.roads.forEach(function (f) {
                var k = f.props.kind, kd = f.props.kind_detail || '';
                f.lines.forEach(function (l) {
                    if (k === 'rail') { cara(l, { color: '#444', weight: 2 }); cara(l, { color: '#fff', weight: 1, dashArray: '4,4' }); }
                    else if (k === 'path') cara(l, { color: '#7a6a50', weight: 1.2, dashArray: /sidewalk|footway|pedestrian|crossing/.test(kd) ? '1,4' : '5,3' });
                    else cara(l, { color: '#333', weight: k === 'major_road' || k === 'highway' ? 2.4 : 1.6 });
                });
            });
        } catch (e) { swallow(e, 'obrysy'); }
    }
    function nactiData() {
        var MD = window.AGMapaData;
        if (!MD || !window.AGMapaVektor || AGMapaVektor.stav() !== 'zapnuto') { info('Obrysy z mapy potřebují zapnutou vektorovou mapu (Nastavení → Vzhled → Nová mapa).'); return; }
        var k = 111320, dl = R_DATA / k, dn = R_DATA / (k * Math.cos(pt.lat * Math.PI / 180));
        info('Načítám obrysy…');
        MD.oblast({ s: pt.lat - dl, n: pt.lat + dl, w: pt.lng - dn, e: pt.lng + dn }).then(function (d) { data = d; obrysy(); sestavSnapy(); info(d.buildings.length + ' budov, ' + d.roads.length + ' cest z mapy'); }).catch(function (e) { info('Obrysy se nenačetly: ' + ((e && e.message) || e)); });
    }

    // ---- kreslení prvků --------------------------------------------------------------------------------
    function ikona(k, vel) { var o = OBJEKTY[k] || OBJEKTY.strom; vel = vel || 26; return '<svg viewBox="0 0 24 24" width="' + vel + '" height="' + vel + '">' + o.svg + '</svg>'; }
    function kresli() {
        if (_vrstvy.prvky) m.removeLayer(_vrstvy.prvky);
        var g = L.layerGroup().addTo(m); _vrstvy.prvky = g;
        // bod náčrtu + ostatní body appky
        try { (typeof arPoints !== 'undefined' ? arPoints : []).forEach(function (p) { if (!p || p.hidden || p.id === pt.id || typeof p.lat !== 'number' || dist(p, pt) > R_DATA) return; L.circleMarker([p.lat, p.lng], { radius: 4, color: '#555', fillColor: '#fff', fillOpacity: 1, weight: 1.5, interactive: false }).bindTooltip(String(p.name), { permanent: true, direction: 'right', offset: [4, 0], className: 'agn-tip agn-tip-jiny' }).addTo(g); }); } catch (e) { /* nic */ }
        L.circleMarker([pt.lat, pt.lng], { radius: 7, color: '#b71c1c', fillColor: '#ff5252', fillOpacity: 1, weight: 2, interactive: false }).bindTooltip(String(pt.name), { permanent: true, direction: 'right', offset: [6, 0], className: 'agn-tip agn-tip-bod' }).addTo(g);
        (_prvky || []).forEach(function (x, i) {
            if (x.t === 'dim') {
                var d = x.v != null ? x.v : dist(x.a, x.b);
                var pl = L.polyline([[x.a.lat, x.a.lng], [x.b.lat, x.b.lng]], { color: '#1a237e', weight: 2, interactive: true, bubblingMouseEvents: false });
                pl.bindTooltip('<span class="agn-kota' + (x.v != null ? ' pasmo' : '') + '">' + fmt(d) + '</span>', { permanent: true, direction: 'center', className: 'agn-tip agn-tip-kota' });
                pl.on('click', function (ev) { L.DomEvent.stop(ev); klikPrvek(i); });
                pl.addTo(g);
                [x.a, x.b].forEach(function (q) { L.circleMarker([q.lat, q.lng], { radius: 3, color: '#1a237e', fillColor: '#fff', fillOpacity: 1, weight: 1.5, interactive: false }).addTo(g); });
            } else if (x.t === 'obj') {
                var mk = L.marker([x.p.lat, x.p.lng], { icon: L.divIcon({ className: 'agn-obj', html: ikona(x.k), iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: true });
                mk.on('click', function (ev) { L.DomEvent.stop(ev); klikPrvek(i); }); mk.addTo(g);
            } else if (x.t === 'cara') {
                var c = CARY[x.k] || CARY.plot;
                var cl = L.polyline(x.pts.map(function (q) { return [q.lat, q.lng]; }), { color: c.col, weight: 2.5, dashArray: c.dash, interactive: true, bubblingMouseEvents: false });
                cl.on('click', function (ev) { L.DomEvent.stop(ev); klikPrvek(i); }); cl.addTo(g);
            } else if (x.t === 'text') {
                var tm = L.marker([x.p.lat, x.p.lng], { icon: L.divIcon({ className: 'agn-text', html: '<span>' + esc(x.s) + '</span>', iconSize: null }), interactive: true });
                tm.on('click', function (ev) { L.DomEvent.stop(ev); klikPrvek(i); }); tm.addTo(g);
            }
        });
        if (_pending) L.circleMarker([_pending.lat, _pending.lng], { radius: 6, color: '#1a237e', fillColor: '#ffd600', fillOpacity: 1, weight: 2, interactive: false }).addTo(g);
        if (_tmp && _tmp.length) L.polyline(_tmp.map(function (q) { return [q.lat, q.lng]; }), { color: '#7b1fa2', weight: 2, dashArray: '4,4', interactive: false }).addTo(g);
        sestavSnapy();
    }
    function pridej(x) { _undo.push(JSON.stringify(_prvky)); _prvky.push(x); uloz(); kresli(); }
    function zpet() { if (!_undo.length) { _pending = null; _tmp = null; kresli(); return; } _prvky = JSON.parse(_undo.pop()); _pending = null; _tmp = null; uloz(); kresli(); }
    function klikPrvek(i) {
        var x = _prvky[i]; if (!x) return;
        if (rezim === 'smazat') { _undo.push(JSON.stringify(_prvky)); _prvky.splice(i, 1); uloz(); kresli(); return; }
        if (x.t === 'dim') {
            var d = dist(x.a, x.b);
            var pr = (typeof window.agPrompt === 'function') ? window.agPrompt({ title: 'Vzdálenost', message: 'Ze souřadnic ' + fmt(d) + '. Zadej hodnotu naměřenou pásmem (m), nebo nech prázdné = ze souřadnic.', value: x.v != null ? String(x.v).replace('.', ',') : '', okText: 'Uložit' }) : Promise.resolve(prompt('Naměřená vzdálenost (m):', x.v != null ? x.v : ''));
            pr.then(function (v) { if (v === null) return; var n = parseFloat(String(v).replace(',', '.')); _undo.push(JSON.stringify(_prvky)); x.v = isFinite(n) && n > 0 ? +n.toFixed(2) : null; uloz(); kresli(); });
        } else if (x.t === 'text') {
            var pr2 = (typeof window.agPrompt === 'function') ? window.agPrompt({ title: 'Text', value: x.s, okText: 'Uložit' }) : Promise.resolve(prompt('Text:', x.s));
            pr2.then(function (v) { if (v === null) return; _undo.push(JSON.stringify(_prvky)); if (!v) _prvky.splice(i, 1); else x.s = v; uloz(); kresli(); });
        } else info((x.t === 'obj' ? (OBJEKTY[x.k] || {}).n : (CARY[x.k] || {}).n) + ' · smazat: režim Smazat a klepni');
    }
    function klikMapa(ll) {
        var q = snap(ll);
        if (rezim === 'vzdalenost') {
            if (!_pending) { _pending = bod(q.lat, q.lng); kresli(); info('Odkud mám. Teď klepni kam.'); return; }
            var a = _pending; _pending = null; if (dist(a, q) < 0.05) { kresli(); return; }
            pridej({ t: 'dim', a: a, b: bod(q.lat, q.lng), v: null }); info('Kóta ' + fmt(dist(a, q)) + ' — klepnutím na ni zadáš hodnotu z pásma.');
        } else if (rezim === 'objekt') { pridej({ t: 'obj', k: objTyp, p: bod(q.lat, q.lng) }); }
        else if (rezim === 'cara') { _tmp = _tmp || []; _tmp.push(bod(q.lat, q.lng)); kresli(); info(_tmp.length < 2 ? 'Další bod čáry; Hotovo ukončí.' : (_tmp.length + ' bodů; Hotovo ukončí.')); }
        else if (rezim === 'text') {
            var pr = (typeof window.agPrompt === 'function') ? window.agPrompt({ title: 'Text do náčrtu', placeholder: 'např. roh garáže, obruba', okText: 'Vložit' }) : Promise.resolve(prompt('Text:'));
            pr.then(function (v) { if (v) pridej({ t: 'text', p: bod(q.lat, q.lng), s: v }); });
        }
    }
    function hotovoCara() { if (_tmp && _tmp.length >= 2) pridej({ t: 'cara', k: caraTyp, pts: _tmp }); _tmp = null; kresli(); }
    function nastavRezim(r) {
        if (rezim === 'cara' && r !== 'cara') hotovoCara();
        rezim = r; _pending = null; kresli();
        el.querySelectorAll('[data-rezim]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-rezim') === r); });
        var h = { vyber: 'Klepni na kótu nebo text = upravit. Posun mapy prstem.', vzdalenost: 'Klepni odkud, pak kam. Přichytává se k bodům a rohům.', objekt: 'Klepni, kam objekt patří (' + (OBJEKTY[objTyp] || {}).n + ').', cara: 'Klepej body čáry (' + (CARY[caraTyp] || {}).n + '), pak Hotovo.', text: 'Klepni, kam text patří.', smazat: 'Klepni na prvek, který chceš smazat.' };
        info(h[r] || ''); el.classList.toggle('kresli', r !== 'vyber');
        var ho = el.querySelector('#agn-hotovo'); if (ho) ho.style.display = r === 'cara' ? '' : 'none';
    }
    function info(t) { var i = el && el.querySelector('#agn-info'); if (i) i.textContent = t || ''; }

    // ---- export PNG (papírová podoba) --------------------------------------------------------------
    function exportPng() {
        var W = 1400, H = 1800, okraj = 70, cv = document.createElement('canvas'), cekaji = []; cv.width = W; cv.height = H;
        var c = cv.getContext('2d'); c.fillStyle = '#fffdf7'; c.fillRect(0, 0, W, H);
        var k = 111320, kl = k * Math.cos(pt.lat * Math.PI / 180);
        // rozsah: bod + prvky, nejmíň 60 m
        var lat0 = pt.lat, lng0 = pt.lng, r = 30;
        (_prvky || []).forEach(function (x) { var ps = x.t === 'dim' ? [x.a, x.b] : x.t === 'cara' ? x.pts : [x.p]; ps.forEach(function (q) { r = Math.max(r, Math.abs((q.lat - lat0) * k) + 5, Math.abs((q.lng - lng0) * kl) + 5); }); });
        r = Math.min(r, R_DATA);
        var hlav = 140, patka = 150, plocha = Math.min(W - 2 * okraj, H - hlav - patka - 2 * okraj), sc = plocha / (2 * r);
        var cx = W / 2, cy = hlav + okraj + plocha / 2;
        function X(q) { return cx + (q.lng - lng0) * kl * sc; } function Y(q) { return cy - (q.lat - lat0) * k * sc; }
        c.save(); c.beginPath(); c.rect(cx - plocha / 2, cy - plocha / 2, plocha, plocha); c.clip();
        function poly(rings, fill, stroke, dash) { c.beginPath(); rings.forEach(function (ring) { ring.forEach(function (q, i) { if (i) c.lineTo(X(q), Y(q)); else c.moveTo(X(q), Y(q)); }); c.closePath(); }); if (fill) { c.fillStyle = fill; c.fill('evenodd'); } c.setLineDash(dash || []); c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); c.setLineDash([]); }
        function line(pts, stroke, w, dash) { c.beginPath(); pts.forEach(function (q, i) { if (i) c.lineTo(X(q), Y(q)); else c.moveTo(X(q), Y(q)); }); c.setLineDash(dash || []); c.strokeStyle = stroke; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); c.setLineDash([]); }
        if (data) {
            try {
                data.landcover.concat(data.landuse).forEach(function (f) { if (f.geom === 'Polygon' && /forest|wood|scrub/.test(f.props.kind)) f.polys.forEach(function (rg) { poly(rg, '#e6eddb', '#7f9a62', [4, 4]); }); });
                data.water.forEach(function (f) { if (f.geom === 'Polygon') f.polys.forEach(function (rg) { poly(rg, '#d6e8f3', '#3f7fa8'); }); else f.lines.forEach(function (l) { line(l, '#3f7fa8', 2); }); });
                data.buildings.forEach(function (f) { if (f.geom === 'Polygon') f.polys.forEach(function (rg) { poly(rg, '#ebe6d8', '#4e463c'); }); });
                data.roads.forEach(function (f) { f.lines.forEach(function (l) { var kd = f.props.kind_detail || ''; if (f.props.kind === 'rail') { line(l, '#333', 3); line(l, '#fff', 1.2, [6, 6]); } else if (f.props.kind === 'path') line(l, '#7a6a50', 1.6, /sidewalk|footway|pedestrian|crossing/.test(kd) ? [2, 5] : [7, 4]); else line(l, '#333', f.props.kind === 'major_road' ? 3 : 2); }); });
            } catch (e) { swallow(e, 'png-obrysy'); }
        }
        c.font = '600 22px system-ui, sans-serif'; c.textBaseline = 'middle';
        try { (typeof arPoints !== 'undefined' ? arPoints : []).forEach(function (p) { if (!p || p.hidden || p.id === pt.id || typeof p.lat !== 'number' || dist(p, pt) > r * 1.4) return; c.beginPath(); c.arc(X(p), Y(p), 6, 0, 7); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = '#444'; c.lineWidth = 2; c.stroke(); c.fillStyle = '#333'; c.fillText(String(p.name), X(p) + 10, Y(p)); }); } catch (e) { /* nic */ }
        (_prvky || []).forEach(function (x) {
            if (x.t === 'cara') { var cc = CARY[x.k] || CARY.plot; line(x.pts, cc.col, 3, cc.dash ? [10, 6] : null); }
        });
        (_prvky || []).forEach(function (x) {
            if (x.t === 'dim') {
                line([x.a, x.b], '#1a237e', 2.5); [x.a, x.b].forEach(function (q) { c.beginPath(); c.arc(X(q), Y(q), 5, 0, 7); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = '#1a237e'; c.lineWidth = 2; c.stroke(); });
                var d = x.v != null ? x.v : dist(x.a, x.b), mx = (X(x.a) + X(x.b)) / 2, my = (Y(x.a) + Y(x.b)) / 2, ang = Math.atan2(Y(x.b) - Y(x.a), X(x.b) - X(x.a)); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
                c.save(); c.translate(mx, my); c.rotate(ang); c.font = (x.v != null ? '800' : '600') + ' 24px system-ui, sans-serif'; var t = fmt(d), tw = c.measureText(t).width; c.fillStyle = 'rgba(255,253,247,.92)'; c.fillRect(-tw / 2 - 6, -28, tw + 12, 28); c.fillStyle = '#1a237e'; c.textAlign = 'center'; c.fillText(t, 0, -14); c.restore();
            } else if (x.t === 'obj') {
                var o = OBJEKTY[x.k] || OBJEKTY.strom, img = obrazek(x.k);
                try { if (img.complete && img.naturalWidth) c.drawImage(img, X(x.p) - 20, Y(x.p) - 20, 40, 40); else cekaji.push(x); } catch (e) { cekaji.push(x); }
            } else if (x.t === 'text') { c.font = '600 22px system-ui, sans-serif'; c.textAlign = 'left'; var tw2 = c.measureText(x.s).width; c.fillStyle = 'rgba(255,253,247,.9)'; c.fillRect(X(x.p) - 4, Y(x.p) - 14, tw2 + 8, 28); c.fillStyle = '#222'; c.fillText(x.s, X(x.p), Y(x.p)); }
        });
        // bod náčrtu
        c.beginPath(); c.arc(X(pt), Y(pt), 10, 0, 7); c.fillStyle = '#ff5252'; c.fill(); c.strokeStyle = '#b71c1c'; c.lineWidth = 3; c.stroke();
        c.font = '800 26px system-ui, sans-serif'; c.textAlign = 'left'; c.fillStyle = '#b71c1c'; c.fillText(String(pt.name), X(pt) + 16, Y(pt));
        c.restore();
        c.strokeStyle = '#333'; c.lineWidth = 2; c.strokeRect(cx - plocha / 2, cy - plocha / 2, plocha, plocha);
        // hlavička, severka, měřítko, legenda
        c.fillStyle = '#111'; c.textAlign = 'left'; c.font = '800 40px system-ui, sans-serif'; c.fillText('Místopisný náčrt · ' + pt.name, okraj, 60);
        c.font = '400 22px system-ui, sans-serif'; c.fillStyle = '#444';
        var popis = []; try { if (pt.druh) popis.push(pt.druh); if (pt.ku) popis.push('k. ú. ' + pt.ku); var sj = GeoCore.toSJTSK(pt.lat, pt.lng); popis.push('Y ' + Math.abs(sj.y).toFixed(2) + '  X ' + Math.abs(sj.x).toFixed(2)); if (pt.vyska != null) popis.push('H ' + (+pt.vyska).toFixed(2) + ' m'); } catch (e) { /* nic */ }
        popis.push(new Date().toLocaleDateString('cs-CZ')); c.fillText(popis.join('  ·  '), okraj, 100);
        var nx = W - okraj - 40, ny = hlav + okraj + 50; c.beginPath(); c.moveTo(nx, ny - 34); c.lineTo(nx + 12, ny + 10); c.lineTo(nx, ny); c.lineTo(nx - 12, ny + 10); c.closePath(); c.fillStyle = '#111'; c.fill(); c.font = '800 24px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('S', nx, ny - 50);
        var mer = [1, 2, 5, 10, 20, 50, 100].filter(function (v) { return v * sc <= plocha / 3; }).pop() || 1, mx0 = cx - plocha / 2, my0 = cy + plocha / 2 + 30;
        c.fillStyle = '#111'; c.fillRect(mx0, my0, mer * sc, 8); c.font = '600 20px system-ui, sans-serif'; c.textAlign = 'left'; c.fillText(mer + ' m', mx0 + mer * sc + 10, my0 + 4);
        var ly = my0 + 50, lx = mx0; c.font = '400 20px system-ui, sans-serif';
        var pouzite = {}; (_prvky || []).forEach(function (x) { if (x.t === 'obj') pouzite[x.k] = 1; });
        Object.keys(pouzite).forEach(function (k2) { var o = OBJEKTY[k2]; if (o) { var im = obrazek(k2); try { if (im.complete && im.naturalWidth) c.drawImage(im, lx, ly - 14, 28, 28); } catch (e) { /* nic */ } c.fillStyle = '#333'; c.fillText(o.n, lx + 34, ly); lx += 34 + c.measureText(o.n).width + 30; if (lx > W - 260) { lx = mx0; ly += 34; } } });
        c.fillStyle = '#666'; c.font = '400 18px system-ui, sans-serif'; c.textAlign = 'right'; c.fillText('tučná kóta = pásmo · obrysy © OpenStreetMap · QTRIG', W - okraj, H - 30);
        // objekty jsou SVG obrázky — které ještě nebyly načtené, dokreslit po načtení; pak PNG
        var hotovo = function () {
            try {
                var du = cv.toDataURL('image/png'), bin = atob(du.split(',')[1]), u8 = new Uint8Array(bin.length);
                for (var i2 = 0; i2 < bin.length; i2++) u8[i2] = bin.charCodeAt(i2);
                var b = new Blob([u8], { type: 'image/png' }), jm = 'nacrt-' + String(pt.name).replace(/[^\w.-]+/g, '_') + '.png';
                if (typeof window.agShareOrDownload === 'function') window.agShareOrDownload(b, jm, 'image/png'); else { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = jm; a.click(); }
            } catch (e) { swallow(e, 'png-blob'); }
        };
        if (!cekaji.length) { hotovo(); return; }
        var zb = cekaji.length, tik = function () { if (--zb > 0) return; try { c.save(); c.beginPath(); c.rect(cx - plocha / 2, cy - plocha / 2, plocha, plocha); c.clip(); cekaji.forEach(function (x) { var im = obrazek(x.k); if (im.complete && im.naturalWidth) c.drawImage(im, X(x.p) - 20, Y(x.p) - 20, 40, 40); }); c.restore(); } catch (e) { /* nic */ } hotovo(); };
        cekaji.forEach(function (x) { var im = obrazek(x.k); if (im.complete) tik(); else { im.addEventListener('load', tik, { once: true }); im.addEventListener('error', tik, { once: true }); } });
    }
    var _obrazky = {};
    function obrazek(k) {
        if (_obrazky[k]) return _obrazky[k];
        var o = OBJEKTY[k] || OBJEKTY.strom, img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40">' + o.svg + '</svg>');
        _obrazky[k] = img; return img;
    }

    // ---- okno ---------------------------------------------------------------------------------------
    function html() {
        var ob = Object.keys(OBJEKTY).map(function (k) { return '<option value="' + k + '">' + OBJEKTY[k].n + '</option>'; }).join('');
        var ca = Object.keys(CARY).map(function (k) { return '<option value="' + k + '">' + CARY[k].n + '</option>'; }).join('');
        return '<div class="agn-top"><b>Místopisný náčrt</b><span id="agn-bod">' + esc(pt.name) + '</span><button type="button" class="agn-x" id="agn-zavrit" aria-label="Zavřít">✕</button></div>'
            + '<div id="agn-mapa"></div>'
            + '<div class="agn-podklad"><button type="button" data-podklad="papir">Papír</button><button type="button" data-podklad="mapa">Mapa</button><button type="button" data-podklad="orto">Ortofoto</button></div>'
            + '<div class="agn-info" id="agn-info"></div>'
            + '<div class="agn-bar">'
            + '<button type="button" data-rezim="vyber">Posun</button>'
            + '<button type="button" data-rezim="vzdalenost">Vzdálenost</button>'
            + '<span class="agn-sel"><button type="button" data-rezim="objekt">Objekt</button><select id="agn-obj">' + ob + '</select></span>'
            + '<span class="agn-sel"><button type="button" data-rezim="cara">Čára</button><select id="agn-cara">' + ca + '</select></span>'
            + '<button type="button" data-rezim="text">Text</button>'
            + '<button type="button" data-rezim="smazat">Smazat</button>'
            + '<button type="button" id="agn-hotovo" style="display:none">Hotovo</button>'
            + '<button type="button" id="agn-zpet">Zpět</button>'
            + '<button type="button" id="agn-png">PNG</button>'
            + '</div>';
    }
    function zavri() {
        if (rezim === 'cara') hotovoCara();
        try { if (m) { m.remove(); m = null; } } catch (e) { swallow(e, 'remove'); }
        _vrstvy = {}; data = null; _bodyObrysu = null;
        if (el) { el.style.display = 'none'; el.innerHTML = ''; }
    }
    function vyberBod() {
        try {
            var id = (typeof activePointIdForModal !== 'undefined' && activePointIdForModal) || (typeof highlightedPointId !== 'undefined' && highlightedPointId);
            var p = id && (arPoints || []).find(function (q) { return q.id === id; });
            if (p) return p;
            var me = (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng } : null, best = null;
            (arPoints || []).forEach(function (q) { if (!q || q.hidden || typeof q.lat !== 'number' || !me) return; var d = dist(me, q); if (!best || d < best.d) best = { d: d, p: q }; });
            return best ? best.p : null;
        } catch (e) { return null; }
    }
    function otevri(bodNebo) {
        var p = (bodNebo && typeof bodNebo.lat === 'number') ? bodNebo : vyberBod();
        if (!p) { return (window.agAlert || alert)({ title: 'Místopisný náčrt', message: 'Nejdřív vyber bod: otevři jeho kartu (nebo ho naviguj) a pak spusť náčrt. Náčrt se ukládá k bodu.' }); }
        pt = p; nacti();
        if (!document.querySelector('link[href$="css/mistopisny-nacrt.css"]')) { var lk = document.createElement('link'); lk.rel = 'stylesheet'; lk.href = 'css/mistopisny-nacrt.css'; document.head.appendChild(lk); }
        if (!el) { el = document.createElement('div'); el.id = 'agn'; document.body.appendChild(el); }
        el.innerHTML = html(); el.style.display = 'block';
        m = L.map('agn-mapa', { zoomControl: false, attributionControl: false, maxZoom: 22, minZoom: 14, tap: false, doubleClickZoom: false, zoomSnap: 0.5 });
        m.setView([pt.lat, pt.lng], 19);
        m.on('click', function (ev) { try { klikMapa(ev.latlng); } catch (e) { swallow(e, 'klik'); } });
        el.querySelector('#agn-zavrit').onclick = zavri;
        el.querySelectorAll('[data-podklad]').forEach(function (b) { b.onclick = function () { nastavPodklad(b.getAttribute('data-podklad')); }; });
        el.querySelectorAll('[data-rezim]').forEach(function (b) { b.onclick = function () { nastavRezim(b.getAttribute('data-rezim')); }; });
        var so = el.querySelector('#agn-obj'); so.value = objTyp; so.onchange = function () { objTyp = so.value; nastavRezim('objekt'); };
        var sc = el.querySelector('#agn-cara'); sc.value = caraTyp; sc.onchange = function () { caraTyp = sc.value; nastavRezim('cara'); };
        el.querySelector('#agn-hotovo').onclick = function () { hotovoCara(); info('Čára uložena. Další čára: klepej dál, nebo přepni režim.'); };
        el.querySelector('#agn-zpet').onclick = zpet;
        el.querySelector('#agn-png').onclick = function () { try { exportPng(); } catch (e) { swallow(e, 'png'); } };
        nastavPodklad(podklad); kresli(); nastavRezim('vyber'); nactiData();
    }
    window.agOpenMistopisnyNacrt = otevri;
    window.AGNacrt = { otevri: otevri, zavri: zavri, prvky: function () { return _prvky; }, data: function () { return vse(); }, mapa: function () { return m; }, klik: klikMapa, rezim: nastavRezim, podklad: nastavPodklad, exportPng: exportPng, OBJEKTY: OBJEKTY, bod: function () { return pt; } };

    function register() {
        try { if (typeof window.agRegisterFieldTool === 'function') window.agRegisterFieldTool({ id: 'mistopisny-nacrt', label: 'Místopisný náčrt', icon: ICON, cat: 'Katastr a data', onClick: function () { otevri(); }, order: 10 }); } catch (e) { swallow(e, 'register'); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register); else register();
})();
