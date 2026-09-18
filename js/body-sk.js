// ===== QTRIG — ÚŘEDNÍ BODY NA SLOVENSKU (GKÚ SR, ODPOJITELNÁ, ag/lazy) =====================
// (18. 9. 2026, uživatel: „na Slovensku nevidím vůbec žádný slovenský bod — to chci kontrolovat")
//
// ZDROJ: WMS „Referenčný geodetický bod" GKÚ Bratislava (zbgisws.skgeodesy.sk): Štátna
// trigonometrická sieť (ŠTS: I.–V. rád, OB, ZB), Štátna nivelačná sieť (ŠNS), Štátna gravimetrická
// sieť (ŠGS), Štátna priestorová sieť (ŠPS). ArcGIS REST /query na zbgis.skgeodesy.sk vrací 503
// (ochrana před roboty), tak se body berou přes WMS GetFeatureInfo ve formátu geo+json s TRIKEM:
// obrázek 6 × 6 px přes 2,4 km → jeden pixel je 400 m a tolerance dotazu (pár px) pokryje celé
// okolí; přijde seznam bodů s atributy (bez geometrie — poloha je v S-JTSK X/Y, převádí proj4).
// Ověřeno 18. 9. 2026 (Bratislava: 424 prvků na 4 km). Tolerance přesnosti polohy: JTSK → WGS84
// přes sedmiprvkovou transformaci (~1 m).
//
// CO DĚLÁ: když je země měření SK (AGSour) a mám polohu, stáhne body do 1,2 km, přemapuje na
// kategorie appky (ŠTS → TB / ZhB (ZB) / PBPP (OB), ŠNS → NIVEL, ŠGS → TIHA, ŠPS → TB) a vloží je
// do arPoints jako úřední body (stejný tvar jako agCuzkBod: name, cat, druh, vyska, ku, okres,
// rawData). Znovu se stahuje po přesunu > 800 m. Karta bodu, AR, navigace i náčrt s nimi umí
// pracovat jako s českými; oficiální náčrt ČÚZK samozřejmě nemají.
// Odstranění: smaž js/body-sk.js + <script> v index.html; na Slovensku pak zůstanou jen vlastní body.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGBodySK) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'body-sk:' + kde); } catch (e2) { /* nic */ } };
    var URL = 'https://zbgisws.skgeodesy.sk/zbgis_referencny_geodeticky_bod_wms_featureinfo/service.svc/get';
    var VRSTVY = '1,2,3,4,5,6,7,8,10,11,12,13,14,15,17,18,19,21,22';
    var R = 1200, PX = 6, ZNOVU_M = 800;
    var JTSK_DEF = '+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=485.021,169.465,483.839,7.786342,4.397554,4.102655,0 +units=m +no_defs';
    var _posl = null, _bezi = false, _tik = null, _pocet = 0;

    function jeSK() { try { return !!(window.AGSour && AGSour.kod() === 'SK'); } catch (e) { return false; } }
    function poloha() { try { return (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng } : null; } catch (e) { return null; } }
    function num(v) { if (v == null) return null; var s = String(v).replace(/\s*m$/, '').replace(/\s/g, '').replace(',', '.'); if (s === '' || s === 'Null') return null; var n = parseFloat(s); return isFinite(n) ? n : null; }
    function str(v) { if (v == null) return null; var t = String(v).trim(); return (t === '' || t === 'Null') ? null : t; }
    function kategorie(vrstva) {
        var v = vrstva || '';
        if (/nivela/i.test(v)) return { cat: 'NIVEL', type: 'vyskovy' };
        if (/gravimetr/i.test(v)) return { cat: 'TIHA', type: 'tihovy' };
        if (/priestorov|SKPOS/i.test(v)) return { cat: 'TB', type: 'polohovy' };
        if (/ZB\)/.test(v)) return { cat: 'ZHB', type: 'polohovy' };
        if (/OB\)/.test(v)) return { cat: 'PBPP', type: 'polohovy' };
        return { cat: 'TB', type: 'polohovy' };
    }
    // vnořené vrstvy (ŠTS × ŠTS – V. rád): stejný bod přijde vícekrát — nechat ten s konkrétním řádem
    function konkretnost(v) { return /r[áa]d|OB\)|ZB\)|ZNS|ZNB|SKPOS|- [ABC]\)/.test(v || '') ? 2 : 1; }
    function bod(f) {
        var p = f.properties || {}, vrstva = f.layerName || p.layerName || '';
        var oznaceni = str(p['Úplné označenie bodu']) || str(p.OBJECTID); if (!oznaceni) return null;
        var lat = num(p['ϕ (ETRS89)']), lng = num(p['λ (ETRS89)']);
        if (lat == null || lng == null) {
            var X = num(p['X S-JTSK (JTSK)']), Y = num(p['Y S-JTSK (JTSK)']); if (X == null || Y == null) return null;
            try { var ll = proj4(JTSK_DEF, 'WGS84', [-Math.abs(Y), -Math.abs(X)]); lng = ll[0]; lat = ll[1]; } catch (e) { return null; }
        }
        if (!isFinite(lat) || !isFinite(lng)) return null;
        var k = kategorie(vrstva);
        return { id: 'sk_' + lat.toFixed(6) + '_' + lng.toFixed(6), name: oznaceni, lat: lat, lng: lng, cat: k.cat, type: k.type, rawData: p, hidden: false, currentDist: 0, bestAccuracy: null,
            vrstva: 'SK', druh: vrstva.replace(/^Štátna /, 'Štátna ') || 'Referenčný geodetický bod (GKÚ SR)', zdroj: 'GKÚ SR', ku: str(p['Názov k. ú.']), okres: str(p['Názov okresu']), vyska: num(p['Výška (Bpv)']),
            znacka: str(p['Druh značky']), popis: str(p['Topografický popis']), _konkret: konkretnost(vrstva) };
    }
    function stahni(lat, lng) {
        var dlat = R / 111320, dlng = R / (111320 * Math.cos(lat * Math.PI / 180));
        var q = URL + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=' + VRSTVY + '&QUERY_LAYERS=' + VRSTVY + '&CRS=EPSG:4326&BBOX=' + (lat - dlat).toFixed(5) + ',' + (lng - dlng).toFixed(5) + ',' + (lat + dlat).toFixed(5) + ',' + (lng + dlng).toFixed(5)
            + '&WIDTH=' + PX + '&HEIGHT=' + PX + '&I=' + (PX / 2) + '&J=' + (PX / 2) + '&INFO_FORMAT=application/geo%2Bjson&FEATURE_COUNT=1000';
        return fetch(q, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('GKÚ ' + r.status); return r.json(); }).then(function (d) {
            var mapa = {};
            ((d && d.features) || []).forEach(function (f) { var b = bod(f); if (!b) return; var k = b.id + '|' + b.name; if (!mapa[k] || mapa[k]._konkret < b._konkret) mapa[k] = b; });
            return Object.keys(mapa).map(function (k) { var b = mapa[k]; delete b._konkret; return b; });
        });
    }
    function vloz(body) {
        if (typeof arPoints === 'undefined') return 0;
        var ix = {}; arPoints.forEach(function (p) { if (p && p.id) ix[p.id] = p; });
        var n = 0;
        body.forEach(function (b) { var e = ix[b.id]; if (e) { if (e.hidden) e.hidden = false; if (e.cat !== b.cat) { e.cat = b.cat; e.type = b.type; } ['druh', 'vyska', 'ku', 'okres', 'znacka', 'popis', 'zdroj', 'vrstva'].forEach(function (k) { if (b[k] != null) e[k] = b[k]; }); return; } arPoints.push(b); n++; });
        try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) { swallow(e, 'ar'); }
        try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { swallow(e, 'mapa'); }
        try { if (typeof updateInfoPanel === 'function') updateInfoPanel(); } catch (e) { /* nic */ }
        return n;
    }
    function obnov(vynutit) {
        if (!jeSK() || _bezi) return Promise.resolve(0);
        var me = poloha(); if (!me) return Promise.resolve(0);
        if (!vynutit && _posl && GeoCore.getDistance(_posl.lat, _posl.lng, me.lat, me.lng) < ZNOVU_M) return Promise.resolve(0);
        if (navigator.onLine === false) return Promise.resolve(0);
        _bezi = true; var stred = { lat: me.lat, lng: me.lng };
        return stahni(stred.lat, stred.lng).then(function (body) {
            _posl = stred; _pocet = body.length; var n = vloz(body);
            if (n) { try { window.agInfo && window.agInfo('Slovensko: ' + body.length + ' bodů GKÚ SR v okolí (ŠTS, ŠNS, ŠGS). Poloha z S-JTSK, ±1 m.'); } catch (e) { /* nic */ } }
            return n;
        }).catch(function (e) { _posl = stred; try { window.agInfo && window.agInfo('Body GKÚ SR se nepodařilo stáhnout: ' + ((e && e.message) || e)); } catch (e2) { /* nic */ } return 0; }).finally(function () { _bezi = false; });
    }
    function start() {
        document.addEventListener('ag:zeme', function () { _posl = null; setTimeout(function () { obnov(true); }, 300); });
        if (!_tik) _tik = setInterval(function () { try { obnov(false); } catch (e) { swallow(e, 'tik'); } }, 8000);
        setTimeout(function () { obnov(false); }, 3000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    window.AGBodySK = { obnov: obnov, stahni: stahni, bod: bod, kategorie: kategorie, pocet: function () { return _pocet; }, URL: URL };
})();
