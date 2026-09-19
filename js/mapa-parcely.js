// ===== QTRIG — PARCELY Z KATASTRU JAKO VEKTOR VE VLASTNÍ MAPĚ (ODPOJITELNÁ, ag/lazy) =====
// (19. 9. 2026, uživatel: „v tý mapě, jak je čistě ve 2D, abych tam mohl vidět hranice pozemků,
// protože teďka tam mám prostě budovy uprostřed něčeho … hrany podél, který se dá kalibrovat za chůze")
//
// PROČ: karta Katastr kreslila přes vlastní mapu WMS ČÚZK — rastrový obrázek s celou katastrální
// mapou (šrafy, značky, čísla v cizím písmu), v tmavém motivu invertovaný. Tady jsou hranice parcel
// GEOMETRIE: stáhnou se z RÚIAN ČÚZK (vrstva 5 „Parcela", stejný host jako bodová pole) podle
// výřezu mapy a MapLibre je nakreslí v barvě stylu (den · noc · tisk) i s parcelními čísly —
// vrstvy 'parcely-hranice' a 'parcely-cisla' + zdroj 'parcely' jsou v js/mapa-styl.js, tenhle
// modul je jen plní. A protože jsou to geometrie, Kalibrace chůzí po hraně se na ně přichytí
// bez dalšího stahování (AGMapaParcely.parcely(); hranice DKM ±0,3 m, UKM ±1 m).
//
// KDY: karta Katastr zapnutá (visSettings.showKatastr) + vlastní mapa jako podklad (#map.base-vektor)
// + měřím v Česku (RÚIAN) + přiblížení ≥ 16 (jinak by výřez měl tisíce parcel). Jinak — Ortofoto,
// rastr, cizina — zůstává WMS jako dřív (applyMapLayers v grafika.js ho přidává; tady se při
// aktivním vektoru zase odebere, ať nejsou hranice dvakrát). Výřez se stahuje po BUŇKÁCH
// ~0,004° × 0,0025° (≈ 290 × 280 m): co je jednou stažené, zůstává v paměti do reloadu; jeden dotaz
// naráz, stránkování po 1000 (resultOffset), okraj výřezu +25 %, ať se při posunu nečeká.
//
// NEEDITUJE logika.js ani grafika.js. Odstranění: smaž js/mapa-parcely.js + <script> v index.html,
// python scripts/gen_sw_assets.py --bump; vrstvy ve stylu zůstanou prázdné (nic nekreslí).
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGMapaParcely) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'mapa-parcely:' + kde); } catch (e2) { /* nic */ } };

    var SVC = 'https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/5/query';
    var MIN_Z = 16;                 // od kdy stahovat (Leaflet zoom)
    var BUNKA_LNG = 0.004, BUNKA_LAT = 0.0025;
    var OKRAJ = 0.25;               // výřez +25 % na každou stranu
    var STRANKA = 1000, MAX_STRAN = 6;
    var STROP = 25000;              // parcel v paměti; nad to se začíná znovu (telefon)
    var PRAZDNE = { type: 'FeatureCollection', features: [] };

    var _by = {};                   // id → GeoJSON Feature
    var _seznam = null;             // cache pro parcely()
    var _bunky = {};                // klíč buňky → 1 (stažená)
    var _fc = PRAZDNE;
    var _busy = false, _znovu = false, _tik = null, _hookMl = null, _naposledy = false;
    var _stat = { dotazy: 0, chyby: 0, posledni: '' };

    function lmap() { try { return (typeof map !== 'undefined' && map && map.getBounds) ? map : null; } catch (e) { return null; } }
    function ml() { try { return (window.AGMapaVektor && AGMapaVektor.mapa()) || null; } catch (e) { return null; } }
    function katastrOn() { try { return !!(typeof visSettings !== 'undefined' && visSettings && visSettings.showKatastr); } catch (e) { return false; } }
    function vektorNaMape() { try { var el = document.getElementById('map'); return !!(el && el.classList.contains('base-vektor')); } catch (e) { return false; } }
    function cesko() { try { var k = window.AGSour && AGSour.kod ? AGSour.kod() : 'CZ'; return !k || k === 'CZ'; } catch (e) { return true; } }
    function wms() { try { return (typeof katastrLayer !== 'undefined' && katastrLayer) ? katastrLayer : null; } catch (e) { return null; } }
    // aktivní = hranice kreslí vektor (a WMS má být pryč); bez signálu zůstává WMS — Stáhnout oblast
    // má jeho dlaždice v cache, kdežto RÚIAN se bez sítě nezeptáš
    function aktivni() { return katastrOn() && vektorNaMape() && cesko() && navigator.onLine !== false; }

    // ---- data z RÚIAN ------------------------------------------------------------------
    function fetchTO(url, ms) {
        if (typeof fetchWithTimeout === 'function') return fetchWithTimeout(url, ms);
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 15000);
        return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).finally(function () { clearTimeout(t); });
    }
    function url(bb, offset) {
        var p = { where: '1=1', geometry: bb.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects',
            outFields: 'id,cisloparcely,zdroj,druhpozemkukod', returnGeometry: 'true', geometryPrecision: '7', f: 'json', resultRecordCount: String(STRANKA), resultOffset: String(offset || 0) };
        return SVC + '?' + Object.keys(p).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
    }
    function pridej(f) {
        var a = f.attributes || {}, g = f.geometry;
        if (!g || !g.rings || !g.rings.length) return;
        var id = a.id != null ? String(a.id) : ('r' + g.rings[0][0]);
        if (_by[id]) return;
        _by[id] = { type: 'Feature', id: Number(a.id) || undefined, properties: { id: id, cislo: a.cisloparcely || '', zdroj: a.zdroj || 1, druh: a.druhpozemkukod || 0 },
            geometry: { type: 'Polygon', coordinates: g.rings } };
        _seznam = null;
    }
    function stahni(bb, offset, stran) {
        _stat.dotazy++;
        return fetchTO(url(bb, offset), 15000).then(function (r) { return r.json(); }).then(function (j) {
            if (!j || j.error) throw new Error((j && j.error && j.error.message) || 'RÚIAN neodpověděl');
            (j.features || []).forEach(pridej);
            if (j.exceededTransferLimit && (j.features || []).length >= STRANKA && stran < MAX_STRAN) return stahni(bb, offset + STRANKA, stran + 1);
            return true;
        });
    }

    // ---- buňky výřezu ------------------------------------------------------------------
    function klic(i, j) { return i + '_' + j; }
    function chybejici(b) {
        var out = [], i0 = Math.floor(b[0] / BUNKA_LNG), i1 = Math.floor(b[2] / BUNKA_LNG), j0 = Math.floor(b[1] / BUNKA_LAT), j1 = Math.floor(b[3] / BUNKA_LAT);
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64) return null;   // moc velký výřez (nemělo by při z ≥ 16 nastat)
        for (var i = i0; i <= i1; i++) for (var j = j0; j <= j1; j++) if (!_bunky[klic(i, j)]) out.push([i, j]);
        return out;
    }
    function vyrez() {
        var m = lmap(); if (!m) return null;
        try {
            var b = m.getBounds(), w = b.getEast() - b.getWest(), h = b.getNorth() - b.getSouth();
            return [b.getWest() - w * OKRAJ, b.getSouth() - h * OKRAJ, b.getEast() + w * OKRAJ, b.getNorth() + h * OKRAJ];
        } catch (e) { swallow(e, 'vyrez'); return null; }
    }
    function nacti() {
        if (!aktivni()) { prekresli(); return; }
        var m = lmap(); if (!m || m.getZoom() < MIN_Z) { prekresli(); return; }
        if (_busy) { _znovu = true; return; }
        var b = vyrez(); if (!b) return;
        var ch = chybejici(b);
        if (!ch || !ch.length) { prekresli(); return; }
        if (Object.keys(_by).length > STROP) { _by = {}; _bunky = {}; _seznam = null; }
        // obálka chybějících buněk (většinou souvislý pás na kraji výřezu) = jeden dotaz
        var i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
        ch.forEach(function (c) { i0 = Math.min(i0, c[0]); i1 = Math.max(i1, c[0]); j0 = Math.min(j0, c[1]); j1 = Math.max(j1, c[1]); });
        var bb = [i0 * BUNKA_LNG, j0 * BUNKA_LAT, (i1 + 1) * BUNKA_LNG, (j1 + 1) * BUNKA_LAT];
        _busy = true;
        stahni(bb, 0, 1).then(function () {
            for (var i = i0; i <= i1; i++) for (var j = j0; j <= j1; j++) _bunky[klic(i, j)] = 1;
            _stat.posledni = '';
        }).catch(function (e) { _stat.chyby++; _stat.posledni = (e && e.message) || String(e); swallow(e, 'stahni'); })
            .then(function () { _busy = false; prekresli(); if (_znovu) { _znovu = false; naplanuj(); } });
    }
    function naplanuj() { clearTimeout(_tik); _tik = setTimeout(nacti, 350); }

    // ---- kreslení: zdroj 'parcely' ve stylu MapLibre ------------------------------------
    function sestav() {
        var fs = [], k; for (k in _by) fs.push(_by[k]);
        _fc = fs.length ? { type: 'FeatureCollection', features: fs } : PRAZDNE;
        return _fc;
    }
    function prekresli() {
        var m = ml(), on = aktivni();
        if (m) {
            hook(m);
            try { var src = m.getSource && m.getSource('parcely'); if (src && src.setData) src.setData(on ? sestav() : PRAZDNE); } catch (e) { swallow(e, 'setData'); }
        }
        // 3D pohled má týž styl (a tedy i zdroj 'parcely'): stejná data, když je karta Katastr zapnutá
        try { var m3 = window.AGPohled3d && AGPohled3d.mapa && AGPohled3d.mapa(); if (m3 && m3.getSource) { hook3d(m3); var s3 = m3.getSource('parcely'); if (s3 && s3.setData) s3.setData((katastrOn() && cesko()) ? sestav() : PRAZDNE); } } catch (e) { swallow(e, '3d'); }
        // WMS ČÚZK: při vektoru pryč (hranice by byly dvakrát), jinak zpět tak, jak ho applyMapLayers chce
        var w = wms(), lm = lmap();
        if (w && lm) {
            try {
                if (on && lm.hasLayer(w)) lm.removeLayer(w);
                else if (!on && katastrOn() && !lm.hasLayer(w) && typeof applyMapLayers === 'function') applyMapLayers();
            } catch (e) { swallow(e, 'wms'); }
        }
        if (on !== _naposledy) { _naposledy = on; try { document.dispatchEvent(new CustomEvent('ag:mapa-parcely', { detail: { zap: on } })); } catch (e) { /* nic */ } }
    }
    // po setStyle() (jiná varianta, jiný díl dat) je zdroj nový a prázdný → naplnit znovu
    function hook(m) {
        if (_hookMl === m) return; _hookMl = m;
        try { m.on('style.load', function () { setTimeout(prekresli, 0); }); } catch (e) { swallow(e, 'hook'); }
    }
    var _hook3d = null;
    function hook3d(m3) {
        if (_hook3d === m3) return; _hook3d = m3;
        try { m3.on('style.load', function () { setTimeout(prekresli, 0); }); } catch (e) { swallow(e, 'hook3d'); }
    }

    // ---- API pro ostatní moduly (kalibrace po hraně: {rings:[[{lat,lng}]], zdroj, cislo}) ----
    function parcely() {
        if (_seznam) return _seznam;
        var out = [], k;
        for (k in _by) {
            var f = _by[k];
            out.push({ id: k, cislo: f.properties.cislo, zdroj: f.properties.zdroj, rings: f.geometry.coordinates.map(function (r) { return r.map(function (c) { return { lat: c[1], lng: c[0] }; }); }) });
        }
        _seznam = out; return out;
    }

    // ---- zapojení -------------------------------------------------------------------------
    function start() {
        var lm = lmap();
        if (!lm) { setTimeout(start, 1500); return; }
        lm.on('moveend zoomend', naplanuj);
        // applyMapLayers WMS přidá při každém volání — při aktivním vektoru ho hned zase sundat
        lm.on('layeradd', function (ev) { try { if (ev && ev.layer && ev.layer === wms()) setTimeout(function () { if (aktivni()) { var w = wms(); if (w && lm.hasLayer(w)) lm.removeLayer(w); } }, 0); } catch (e) { swallow(e, 'layeradd'); } });
        lm.on('layeradd layerremove', function (ev) { try { if (ev && ev.layer && ev.layer === wms()) naplanuj(); } catch (e) { /* nic */ } });
        document.addEventListener('ag:mapa-vektor', function () { setTimeout(naplanuj, 300); });
        document.addEventListener('ag:zeme', naplanuj);
        // podklad (vektor ↔ ortofoto) se pozná podle třídy #map.base-vektor
        try { var el = document.getElementById('map'); if (el) new MutationObserver(naplanuj).observe(el, { attributes: true, attributeFilter: ['class'] }); } catch (e) { swallow(e, 'observer'); }
        window.addEventListener('online', naplanuj);
        // 3D pohled (js/pohled-3d.js) se otevírá až na klepnutí — jeho mapu naplnit, jakmile existuje
        setInterval(function () { try { var m3 = window.AGPohled3d && AGPohled3d.mapa && AGPohled3d.mapa(); if (m3 && m3 !== _hook3d && katastrOn()) prekresli(); } catch (e) { /* nic */ } }, 2000);
        naplanuj();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.AGMapaParcely = { aktivni: aktivni, parcely: parcely, pocet: function () { return Object.keys(_by).length; }, nacti: naplanuj, prekresli: prekresli,
        stat: function () { return { dotazy: _stat.dotazy, chyby: _stat.chyby, posledni: _stat.posledni, bunky: Object.keys(_bunky).length, parcel: Object.keys(_by).length, busy: _busy }; },
        _test: { pridej: pridej, chybejici: chybejici, oznacBunky: function (b) { (chybejici(b) || []).forEach(function (c) { _bunky[klic(c[0], c[1])] = 1; }); }, vymaz: function () { _by = {}; _bunky = {}; _seznam = null; }, MIN_Z: MIN_Z } };
})();
