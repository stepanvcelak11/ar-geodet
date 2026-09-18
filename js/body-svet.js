// ===== QTRIG — ÚŘEDNÍ BODY V CIZINĚ, KDE JE STÁT ZVEŘEJŇUJE (ODPOJITELNÁ, ag/lazy) ===========
// (18. 9. 2026 noc, uživatel: „jsi schopen získat data aspoň od 3 stran? … ať lidi z ciziny
//  vědí, že body v mapě jsou jen v zemích, kde je to veřejné")
//
// Slovensko má vlastní modul js/body-sk.js (WMS GetFeatureInfo GKÚ SR). Tady jsou země, které
// bodové pole dávají jako otevřená data s dotazem podle polohy — OVĚŘENO 18. 9. 2026 naostro:
//   CH  swisstopo, api3.geo.admin.ch (identify): Lagefixpunkte LFP1 (federální, ordnung „LFP1 1.–3.
//       Ordnung" / „LV95-Haupt/-Verdichtung"), LFP2 (kantonální zhušťovací), Höhenfixpunkte HFP1/HFP2
//       (výška LN02 = národní systém CH). Souřadnice LV95 (EPSG:2056) v atributech e95/n95, u LFP2 v
//       textu „E / N"; k bodu odkaz na protokol (PDF) → karta ho ukáže jako „Otevřít nákres".
//       Trik dotazu: identify bere toleranci v pixelech, tak se mapExtent 5 km posílá jako obrázek
//       5000 px → 1 px = 1 m a tolerance = poloměr v metrech (Bern: 27 bodů do 1,2 km).
//   NL  Kadaster RDinfo přes PDOK WFS (rdinfo:punten): Rijksdriehoekspunten (kostelní věže, GPS
//       kernnet), bbox v EPSG:4326, souřadnice RD v xrd/yrd, foto bodu (afbeelding) → „Otevřít nákres".
//       Jen polohové (NAP výškové značky nemají otevřenou službu).
// Ostatní země (PL, AT, DE, FR, HU…): stát body nezveřejňuje jako data (geoportály chtějí klíč
// nebo platbu, PL/DE vrací 401/404) — tam zůstávají jen vlastní body. Ať to lidi vědí, říká to
// panel Body (grafika.js) i hláška po přejezdu hranice (zdroje-zemi.js).
//
// CO DĚLÁ: když je země měření (AGSour) CH nebo NL a mám polohu, stáhne body do R metrů, přemapuje
// na kategorie appky a vloží do arPoints jako úřední body (stejný tvar jako agCuzkBod / body-sk:
// name, cat, druh, vyska, ku, rawData, zdroj, vrstva = kód země). Znovu po přesunu > 800 m.
// Odstranění: smaž js/body-svet.js + <script> v index.html.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGBodySvet) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'body-svet:' + kde); } catch (e2) { /* nic */ } };
    var ZNOVU_M = 800;
    var _posl = null, _bezi = false, _tik = null, _pocet = 0, _kod = null;

    function kod() { try { return (window.AGSour && AGSour.kod && AGSour.kod()) || 'CZ'; } catch (e) { return 'CZ'; } }
    function poloha() { try { return (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng } : null; } catch (e) { return null; } }
    function num(v) { if (v == null) return null; var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
    function str(v) { if (v == null) return null; var t = String(v).trim(); return t === '' ? null : t; }
    function proj(def, x, y) { try { var ll = proj4(def, 'WGS84', [x, y]); return { lat: ll[1], lng: ll[0] }; } catch (e) { return null; } }
    function zpet(def, lat, lng) { try { var xy = proj4('WGS84', def, [lng, lat]); return { x: xy[0], y: xy[1] }; } catch (e) { return null; } }

    // ---- CH: swisstopo ---------------------------------------------------------------------
    var LV95 = '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs';
    var CH = {
        kod: 'CH', zdroj: 'swisstopo', R: 1200,
        URL: 'https://api3.geo.admin.ch/rest/services/all/MapServer/identify',
        vrstvy: 'ch.swisstopo.fixpunkte-lfp1,ch.swisstopo.fixpunkte-lfp2,ch.swisstopo.fixpunkte-hfp1,ch.swisstopo.fixpunkte-hfp2',
        url: function (lat, lng) {
            var c = zpet(LV95, lat, lng); if (!c) return null;
            var e = Math.round(c.x), n = Math.round(c.y), h = 2500;   // extent 5 km = 5000 px → 1 px = 1 m
            return CH.URL + '?geometry=' + e + ',' + n + '&geometryType=esriGeometryPoint&layers=all:' + CH.vrstvy
                + '&tolerance=' + CH.R + '&sr=2056&mapExtent=' + (e - h) + ',' + (n - h) + ',' + (e + h) + ',' + (n + h)
                + '&imageDisplay=' + (2 * h) + ',' + (2 * h) + ',96&returnGeometry=true&limit=500';
        },
        seznam: function (d) { return (d && d.results) || []; },
        bod: function (f) {
            var a = f.attributes || {}, v = f.layerBodId || '';
            var E = num(a.e95), N = num(a.n95);
            if ((E == null || N == null) && a.koordinate) { var m = /([\d.]+)\s*\/\s*([\d.]+)/.exec(a.koordinate); if (m) { E = num(m[1]); N = num(m[2]); } }
            if ((E == null || N == null) && f.geometry) { E = num(f.geometry.x); N = num(f.geometry.y); }
            if (E == null || N == null) return null;
            var ll = proj(LV95, E, N); if (!ll) return null;
            var hfp = /hfp/.test(v), lfp2 = /lfp2/.test(v);
            var cat = hfp ? 'NIVEL' : (lfp2 ? 'ZHB' : 'TB');
            var name = str(a.nummer) || str(a.label && String(a.label).replace(/^CH\d{10}/, '')) || str(a.punktname) || str(f.featureId);
            if (!name) return null;
            var raw = {}; Object.keys(a).forEach(function (k) { raw[k] = a[k]; });
            raw.E_LV95 = E; raw.N_LV95 = N;
            var vyska = num(a.h02) != null ? num(a.h02) : num(a.hoehe_geom_m);
            if (vyska != null) raw.VYSKA = vyska;
            var proto = str(a.proto_url) || str(a.url_punktprotokoll); if (proto) raw.GEODETICKE_UDAJE = proto;
            var druh = hfp ? 'Höhenfixpunkt ' + (str(a.ordnung) || (/hfp1/.test(v) ? 'HFP1' : 'HFP2')) : (lfp2 ? 'Lagefixpunkt LFP2 (kantonální)' : 'Lagefixpunkt ' + (str(a.ordnung) || 'LFP1'));
            return { id: 'ch_' + name, name: name, lat: ll.lat, lng: ll.lng, cat: cat, type: hfp ? 'vyskovy' : 'polohovy', rawData: raw, hidden: false, currentDist: 0, bestAccuracy: null,
                vrstva: 'CH', druh: druh, zdroj: 'swisstopo', nazevBodu: str(a.punktname), ku: str(a.kanton), vyska: vyska, znacka: str(a.kennzeichnung) || str(a.punktzeichen), popis: str(a.zugang) };
        }
    };

    // ---- NL: Kadaster RDinfo (PDOK) -------------------------------------------------------
    var NL = {
        kod: 'NL', zdroj: 'Kadaster RDinfo', R: 2500,
        URL: 'https://service.pdok.nl/kadaster/rdinfo/wfs/v1_0',
        url: function (lat, lng) {
            var dlat = NL.R / 111320, dlng = NL.R / (111320 * Math.cos(lat * Math.PI / 180));
            return NL.URL + '?service=WFS&version=2.0.0&request=GetFeature&typeNames=rdinfo:punten&count=500&outputFormat=json&srsName=EPSG:4326'
                + '&bbox=' + (lat - dlat).toFixed(5) + ',' + (lng - dlng).toFixed(5) + ',' + (lat + dlat).toFixed(5) + ',' + (lng + dlng).toFixed(5) + ',EPSG:4326';
        },
        seznam: function (d) { return (d && d.features) || []; },
        bod: function (f) {
            var p = f.properties || {}, g = f.geometry && f.geometry.coordinates;
            if (!g || !isFinite(g[0]) || !isFinite(g[1])) return null;
            var lat = g[1], lng = g[0];
            if (Math.abs(lat) > 90) { lat = g[0]; lng = g[1]; }   // kdyby služba prohodila osy
            var name = (str(p.blad) || '') + (p.punt != null ? String(p.punt) : ''); if (!name) return null;
            var raw = {}; Object.keys(p).forEach(function (k) { raw[k] = p[k]; });
            var gps = String(p.gps) === '1' || p.gps === true;
            return { id: 'nl_' + name, name: name, lat: lat, lng: lng, cat: gps ? 'TB' : 'ZHB', type: 'polohovy', rawData: raw, hidden: false, currentDist: 0, bestAccuracy: null,
                vrstva: 'NL', druh: gps ? 'Rijksdriehoekspunt (GPS kernnet)' : 'Rijksdriehoekspunt', zdroj: 'Kadaster RDinfo', nazevBodu: str(p.benaming), vyska: null, popis: str(p.beheerinfo) };
        }
    };
    var ZEME = { CH: CH, NL: NL };

    function stahni(z, lat, lng) {
        var q = z.url(lat, lng); if (!q) return Promise.reject(new Error('proj4'));
        return fetch(q, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error(z.zdroj + ' ' + r.status); return r.json(); }).then(function (d) {
            var mapa = {};
            z.seznam(d).forEach(function (f) { var b = z.bod(f); if (b) mapa[b.id] = b; });
            return Object.keys(mapa).map(function (k) { return mapa[k]; });
        });
    }
    function vloz(body) {
        if (typeof arPoints === 'undefined') return 0;
        var ix = {}; arPoints.forEach(function (p) { if (p && p.id) ix[p.id] = p; });
        var n = 0;
        body.forEach(function (b) { var e = ix[b.id]; if (e) { if (e.hidden) e.hidden = false; ['cat', 'type', 'druh', 'vyska', 'ku', 'znacka', 'popis', 'zdroj', 'vrstva', 'nazevBodu', 'rawData'].forEach(function (k) { if (b[k] != null) e[k] = b[k]; }); return; } arPoints.push(b); n++; });
        try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) { swallow(e, 'ar'); }
        try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { swallow(e, 'mapa'); }
        try { if (typeof updateInfoPanel === 'function') updateInfoPanel(); } catch (e) { /* nic */ }
        return n;
    }
    function obnov(vynutit) {
        var z = ZEME[kod()];
        if (!z || _bezi) return Promise.resolve(0);
        var me = poloha(); if (!me) return Promise.resolve(0);
        if (!vynutit && _posl && _kod === z.kod && GeoCore.getDistance(_posl.lat, _posl.lng, me.lat, me.lng) < ZNOVU_M) return Promise.resolve(0);
        if (navigator.onLine === false) return Promise.resolve(0);
        _bezi = true; var stred = { lat: me.lat, lng: me.lng };
        return stahni(z, stred.lat, stred.lng).then(function (body) {
            _posl = stred; _kod = z.kod; _pocet = body.length; var n = vloz(body);
            if (n) { try { (window.quickToast || window.agInfo)(hlaska(z, body.length)); } catch (e) { /* nic */ } }
            return n;
        }).catch(function (e) { _posl = stred; _kod = z.kod; try { (window.quickToast || window.agInfo)('Úřední body (' + z.zdroj + ') se nepodařilo stáhnout: ' + ((e && e.message) || e)); } catch (e2) { /* nic */ } return 0; }).finally(function () { _bezi = false; });
    }
    function hlaska(z, n) {
        if (z.kod === 'CH') return 'Švýcarsko: ' + n + ' bodů swisstopo v okolí (LFP1, LFP2, HFP). Výšky LN02.';
        return 'Nizozemsko: ' + n + ' bodů Kadaster RDinfo v okolí (Rijksdriehoekspunten). Jen polohové.';
    }
    // pro panel Body a hlášku po přejezdu hranice: kde stát body zveřejňuje
    function zdrojPro(k) { return k === 'CZ' ? 'ČÚZK' : k === 'SK' ? 'GKÚ SR' : (ZEME[k] ? ZEME[k].zdroj : null); }
    function start() {
        document.addEventListener('ag:zeme', function () { _posl = null; setTimeout(function () { obnov(true); }, 300); });
        if (!_tik) _tik = setInterval(function () { try { obnov(false); } catch (e) { swallow(e, 'tik'); } }, 8000);
        setTimeout(function () { obnov(false); }, 3000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    window.AGBodySvet = { obnov: obnov, stahni: stahni, ZEME: ZEME, zdrojPro: zdrojPro, pocet: function () { return _pocet; } };
})();
