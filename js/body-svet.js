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
//   FR  IGN Géoplateforme WFS 2.0 (data.geopf.fr/wfs/ows, bez klíče, CORS) — OVĚŘENO 19. 9. 2026 (E3):
//       IGNF_GEODESIE:site-rbf (2 141 GNSS bodů RBF → TB), point-rdf (podrobná síť RDF → ZHB),
//       rn (387 281 nivelačních repérů → NIVEL, výška NGF-IGN69 v `altitude`). Každý má stav („BON ETAT",
//       „IMPRENABLE", „DETRUIT") a odkaz na fiche PDF → „Otevřít nákres". BBOX u site-rbf/point-rdf
//       v pořadí lat,lon; vrstva rn BBOX ignoruje → filtr CQL `lambda BETWEEN … AND phi BETWEEN …`.
//       Tři dotazy naráz (z.urls), výsledky se slijí.
//   ES  IGN España WMS 1.3.0 (www.ign.es/wms-inspire/redes-geodesicas, CORS) — OVĚŘENO 19. 9. 2026 (E3):
//       GetFeatureInfo INFO_FORMAT=application/json, vrstvy RED_ROI (síť ROI → TB), RED_REGENTE (→ TB),
//       RED_NAP (nivelace → NIVEL). Trik jako u SK: bbox 2R v EPSG:3857 jako obrázek 50 px, I=J=25,
//       BUFFER=25 (GeoServer víc nepustí) → tolerance = R. Atributy se u NAP jmenují jinak
//       (latitud_etrs89, altitud_elipsoidal, ortometrica) než u ROI (lat_etrs89, alt_elip, alt_orto);
//       reseña PDF → „Otevřít nákres".
//   DE  (25. 9. 2026, 6. hodnocení e1) Německo body vede po spolkových zemích (AFIS). Otevřeně, bez klíče
//       a s CORS je dávají jen tři — OVĚŘENO curlem 25. 9. 2026 u všech 16:
//       BE  Berlín gdi.berlin.de/services/wfs/afis (GeoServer WFS 2.0, GeoJSON, bbox v EPSG:4326 lat,lon):
//           Höhenfestpunkte a_/b_/c_afis_hfp1–3 (výška DHHN2016 `hoh2`), Grundnetzpunkte d_/e_/f_afis_ggp1–3
//           (GNSS body se souřadnicemi UTM33 rew/how), atributy pkn, bezpvm (stabilizace), nal (kde).
//       MV  Meklenbursko-Přední Pomořansko geodaten-mv.de/dienste/afis_wfs (MapServer, OUTPUTFORMAT=geojson —
//           `application/json` vrací 400): adv_afis_lfp (polohové, řád, výška), adv_afis_hfp (nivelace);
//           u každého pdf_url = místopis → „Otevřít nákres".
//       BW  Bádensko-Württembersko owsproxy.lgl-bw.de (GeoServer): JEN výškové body řádu 1–3; bbox MUSÍ
//           být v EPSG:25832 (ve 4326 vrátí 0) a souřadnice se berou nativně (SRSNAME=4326 je zaokrouhlí na 1 km).
//       Víc vrstev v jednom GetFeature nejde (MV pak vrátí slepené GeoJSONy) → dotaz na vrstvu, slije se.
//       Ostatní spolkové země: služba chce přihlášení (SN, ST, SH, RP = 403), jen obrázek (RP), jen GML NAS
//       (BB), jen číslo bodu bez souřadnic (BY, HB) nebo nic veřejného (NI, HE, TH, HH, SL). NRW dává jen CSV
//       celé země (7 MB). Tam appka řekne, že spolková země body nezveřejňuje.
//   AT  Rakousko: BEV dává trigonometrické body (TP) jako otevřené CSV (CC BY 4.0), ale server NEPOSÍLÁ
//       CORS a WMS má queryable=0 → scripts/body_at.py CSV předem rozřeže na dlaždice 0,25° v data/body-at/
//       (86 561 značek, 211 dlaždic); tady se stáhnou jen dlaždice kolem polohy (z.nacti místo z.urls).
//       Výška = elipsoidická ETRS89 − undulace geoidu (UNDULATION_GRS80 z téhož CSV).
// Ostatní země (PL, HU, SI, NO, EE…): stát body nezveřejňuje jako data (geoportály chtějí klíč nebo
// platbu, PL vrací 401 — zkoušeno 18. a 19. 9. 2026) — tam zůstávají jen vlastní body. Ať to lidi
// vědí, říká to panel Body (grafika.js) i karta „Měříš v zemi" (zdroje-zemi.js).
//
// CO DĚLÁ: když je země měření (AGSour) CH, NL, FR, ES, DE nebo AT a mám polohu, stáhne body do R metrů, přemapuje
// na kategorie appky a vloží do arPoints jako úřední body (stejný tvar jako agCuzkBod / body-sk:
// name, cat, druh, vyska, ku, rawData, zdroj, vrstva = kód země). Znovu po přesunu > 800 m.
// Odstranění: smaž js/body-svet.js + <script> v index.html.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGBodySvet) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'body-svet:' + kde); } catch (e2) { /* nic */ } };
    var ZNOVU_M = 800;
    var _posl = null, _bezi = false, _tik = null, _pocet = 0, _kod = null, _deMimo = false;
    function T(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }

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
    // ---- FR: IGN Géoplateforme (WFS) ------------------------------------------------------
    var L93 = '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
    var FR = {
        kod: 'FR', zdroj: 'IGN (géodésie)', R: 1200,
        URL: 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&OUTPUTFORMAT=application/json&COUNT=400&TYPENAMES=IGNF_GEODESIE:',
        urls: function (lat, lng) {
            var dlat = FR.R / 111320, dlng = FR.R / (111320 * Math.cos(lat * Math.PI / 180));
            var la0 = (lat - dlat).toFixed(5), la1 = (lat + dlat).toFixed(5), lo0 = (lng - dlng).toFixed(5), lo1 = (lng + dlng).toFixed(5);
            var bbox = '&BBOX=' + la0 + ',' + lo0 + ',' + la1 + ',' + lo1;   // lat,lon (urn EPSG:4326)
            return [FR.URL + 'site-rbf' + bbox, FR.URL + 'point-rdf' + bbox,
                FR.URL + 'rn&CQL_FILTER=' + encodeURIComponent('lambda BETWEEN ' + lo0 + ' AND ' + lo1 + ' AND phi BETWEEN ' + la0 + ' AND ' + la1)];
        },
        seznam: function (d) { return (d && d.features) || []; },
        bod: function (f) {
            var p = f.properties || {}, g = f.geometry && f.geometry.coordinates;
            if (!g || !isFinite(g[0]) || !isFinite(g[1])) return null;
            var lat = g[1], lng = g[0]; if (Math.abs(lat) > 90) { lat = g[0]; lng = g[1]; }
            var typ = /^rn\./.test(f.id || '') ? 'rn' : (/^point-rdf/.test(f.id || '') ? 'rdf' : 'rbf');
            var name = str(p.nom) || str(p.id); if (!name) return null;
            var raw = {}; Object.keys(p).forEach(function (k) { raw[k] = p[k]; });
            var xy = zpet(L93, lat, lng); if (xy) { raw.E_L93 = Math.round(xy.x * 100) / 100; raw.N_L93 = Math.round(xy.y * 100) / 100; }
            var vyska = typ === 'rn' ? num(p.altitude) : null; if (vyska != null) raw.VYSKA = vyska;
            if (str(p.url)) raw.GEODETICKE_UDAJE = str(p.url);
            var etat = str(p.etat) || '';
            var druh = typ === 'rn' ? 'Repère de nivellement (NGF-IGN69)' : (typ === 'rdf' ? 'Point RDF (réseau de détail)' : 'Site RBF (GNSS)');
            if (etat) druh += ' · ' + etat;
            return { id: 'fr_' + typ + '_' + (p.id != null ? p.id : name), name: name, lat: lat, lng: lng, cat: typ === 'rn' ? 'NIVEL' : (typ === 'rdf' ? 'ZHB' : 'TB'), type: typ === 'rn' ? 'vyskovy' : 'polohovy',
                rawData: raw, hidden: false, currentDist: 0, bestAccuracy: null, vrstva: 'FR', druh: druh, zdroj: 'IGN (géodésie)', nazevBodu: str(p.groupe_info) || null, ku: str(p.insee) || null, vyska: vyska, popis: etat || null };
        }
    };

    // ---- ES: IGN España (WMS GetFeatureInfo) ----------------------------------------------
    var ES = {
        kod: 'ES', zdroj: 'IGN España', R: 2000,
        URL: 'https://www.ign.es/wms-inspire/redes-geodesicas',
        vrstvy: 'RED_ROI,RED_REGENTE,RED_NAP',
        url: function (lat, lng) {
            var x = lng * 20037508.34 / 180, y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180, R = ES.R;
            return ES.URL + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=' + ES.vrstvy + '&QUERY_LAYERS=' + ES.vrstvy + '&CRS=EPSG:3857'
                + '&BBOX=' + (x - R).toFixed(1) + ',' + (y - R).toFixed(1) + ',' + (x + R).toFixed(1) + ',' + (y + R).toFixed(1)
                + '&WIDTH=50&HEIGHT=50&I=25&J=25&BUFFER=25&INFO_FORMAT=application/json&FEATURE_COUNT=300';
        },
        seznam: function (d) { return (d && d.features) || []; },
        bod: function (f) {
            var p = f.properties || {}, id = String(f.id || '');
            var nap = /^RED_NAP/.test(id), reg = /^RED_REGENTE/.test(id);
            var lat = num(nap ? p.latitud_etrs89 : p.lat_etrs89), lng = num(nap ? p.longitud_etrs89 : p.long_etrs89);
            if ((lat == null || lng == null) && f.geometry && f.geometry.coordinates) {   // záloha: geometrie ve 3857
                var gx = num(f.geometry.coordinates[0]), gy = num(f.geometry.coordinates[1]);
                if (gx != null && gy != null) { lng = gx * 180 / 20037508.34; lat = Math.atan(Math.exp(gy * Math.PI / 20037508.34)) * 360 / Math.PI - 90; }
            }
            if (lat == null || lng == null) return null;
            var name = (p.numero != null ? String(p.numero) : '') || str(p.nombre); if (!name) return null;
            var raw = {}; Object.keys(p).forEach(function (k) { if (k !== 'bbox') raw[k] = p[k]; });
            var vyska = num(nap ? p.ortometrica : p.alt_orto); if (vyska != null) { vyska = Math.round(vyska * 1000) / 1000; raw.VYSKA = vyska; }
            if (str(p.resena)) raw.GEODETICKE_UDAJE = str(p.resena);
            var druh = nap ? 'Señal de nivelación REDNAP' + (str(p.tipo) ? ' (' + p.tipo + ')' : '') : (reg ? 'Vértice REGENTE (GNSS)' : 'Vértice geodésico ROI');
            return { id: 'es_' + (nap ? 'nap' : (reg ? 'reg' : 'roi')) + '_' + name, name: name, lat: lat, lng: lng, cat: nap ? 'NIVEL' : 'TB', type: nap ? 'vyskovy' : 'polohovy',
                rawData: raw, hidden: false, currentDist: 0, bestAccuracy: null, vrstva: 'ES', druh: druh, zdroj: 'IGN España', nazevBodu: str(p.nombre), ku: str(p.municipio) || str(p.nombre_muni), vyska: vyska, popis: str(p.linea) || null };
        }
    };

    // ---- DE: AFIS spolkových zemí (Berlín, MV, BW) ---------------------------------------
    var UTM32 = '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
    var DE_OBL = [   // [kód, jméno, jih, sever, západ, východ] — obdélník kolem spolkové země
        ['BE', 'Berlín', 52.33, 52.68, 13.08, 13.77],
        ['MV', 'Meklenbursko-Přední Pomořansko', 53.10, 54.69, 10.59, 14.42],
        ['BW', 'Bádensko-Württembersko', 47.53, 49.80, 7.51, 10.50]
    ];
    function deOblasti(lat, lng) { return DE_OBL.filter(function (o) { return lat >= o[2] && lat <= o[3] && lng >= o[4] && lng <= o[5]; }); }
    var DE = {
        kod: 'DE', zdroj: 'AFIS (Berlin, MV, BW)', R: 1500,
        BE: 'https://gdi.berlin.de/services/wfs/afis?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&COUNT=400&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&TYPENAMES=afis:',
        BE_V: ['a_afis_hfp1', 'b_afis_hfp2', 'c_afis_hfp3', 'd_afis_ggp1', 'e_afis_ggp2', 'f_afis_ggp3'],
        MV: 'https://www.geodaten-mv.de/dienste/afis_wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&COUNT=400&OUTPUTFORMAT=geojson&SRSNAME=EPSG:4326&TYPENAMES=afismv:',
        MV_V: ['adv_afis_lfp', 'adv_afis_hfp'],
        BW: 'https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_LGL-BW_AFIS_Hoehenfestpunkte?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&COUNT=400&OUTPUTFORMAT=application/json&TYPENAMES=nora:',
        BW_V: ['v_hoehenfestpunkt_ordnung_1', 'v_hoehenfestpunkt_ordnung_2', 'v_hoehenfestpunkt_ordnung_3'],
        urls: function (lat, lng) {
            var dlat = DE.R / 111320, dlng = DE.R / (111320 * Math.cos(lat * Math.PI / 180)), out = [];
            var b4326 = '&BBOX=' + (lat - dlat).toFixed(5) + ',' + (lng - dlng).toFixed(5) + ',' + (lat + dlat).toFixed(5) + ',' + (lng + dlng).toFixed(5) + ',urn:ogc:def:crs:EPSG::4326';
            deOblasti(lat, lng).forEach(function (o) {
                if (o[0] === 'BW') {
                    var c = zpet(UTM32, lat, lng); if (!c) { out.push(null); return; }
                    var b = '&BBOX=' + Math.round(c.x - DE.R) + ',' + Math.round(c.y - DE.R) + ',' + Math.round(c.x + DE.R) + ',' + Math.round(c.y + DE.R) + ',urn:ogc:def:crs:EPSG::25832';
                    DE.BW_V.forEach(function (v) { out.push(DE.BW + v + b); });
                } else DE[o[0] + '_V'].forEach(function (v) { out.push(DE[o[0]] + v + b4326); });
            });
            return out;
        },
        seznam: function (d) { return (d && d.features) || []; },
        bod: function (f, q) {
            var p = f.properties || {}, g = f.geometry && f.geometry.coordinates;
            if (!g || !isFinite(g[0]) || !isFinite(g[1])) return null;
            var zem = /lgl-bw/.test(q) ? 'BW' : (/geodaten-mv/.test(q) ? 'MV' : 'BE');
            var lat, lng;
            if (zem === 'BW') { var ll = proj(UTM32, g[0], g[1]); if (!ll) return null; lat = ll.lat; lng = ll.lng; }
            else { lat = g[1]; lng = g[0]; if (Math.abs(lat) > 90) { lat = g[0]; lng = g[1]; } }
            var raw = {}; Object.keys(p).forEach(function (k) { if (k !== 'bbox') raw[k] = p[k]; });
            var name = str(p.punktkennung) || str(p.pkn); if (!name) return null;
            var hfp = zem === 'BW' || /hfp/.test(q), vyska, druh, popis, znacka, ku;
            if (zem === 'BE') {
                vyska = num(p.hoh2); znacka = str(p.bezpvm); popis = str(p.nal);
                var rad = (/(hfp|ggp)(\d)/.exec(q) || [])[2] || '';
                druh = hfp ? 'Höhenfestpunkt ' + rad + '. Ordnung (DHHN2016)' : 'Geodätischer Grundnetzpunkt ' + rad + '. Stufe (GNSS)';
                if (num(p.rew) != null) { raw.E_UTM33 = num(p.rew); raw.N_UTM33 = num(p.how); }
            } else if (zem === 'MV') {
                vyska = num(p.hoehe); znacka = str(p.punktvermarkung); popis = str(p.lagebeschreibung);
                druh = (hfp ? 'Höhenfestpunkt' : 'Lagefestpunkt') + (str(p.ordnung_hoehe) || str(p.ordnung) ? ' ' + (str(p.ordnung_hoehe) || str(p.ordnung)) : '');
                if (num(p.east) != null) { raw.E_UTM33 = num(p.east); raw.N_UTM33 = num(p.north); }
                if (str(p.pdf_url)) raw.GEODETICKE_UDAJE = str(p.pdf_url);
            } else {
                vyska = num(p.hoehe); znacka = str(p.vermarkung_name); popis = str(p.lagebeschreibung); ku = str(p.gemeinde_name);
                druh = 'Höhenfestpunkt ' + (str(p.ordnung_name) || '') + ' (DHHN2016)';
                raw.E_UTM32 = Math.round(g[0] * 1000) / 1000; raw.N_UTM32 = Math.round(g[1] * 1000) / 1000;
            }
            if (vyska != null) raw.VYSKA = vyska;
            return { id: 'de_' + zem.toLowerCase() + '_' + name, name: name, lat: lat, lng: lng, cat: hfp ? 'NIVEL' : 'TB', type: hfp ? 'vyskovy' : 'polohovy',
                rawData: raw, hidden: false, currentDist: 0, bestAccuracy: null, vrstva: 'DE', druh: druh, zdroj: 'AFIS ' + zem, nazevBodu: null, ku: ku || null, vyska: vyska, znacka: znacka, popis: popis };
        }
    };

    // ---- AT: BEV trigonometrické body (dlaždice data/body-at z scripts/body_at.py) --------
    var _atIdx = null;
    var AT = {
        kod: 'AT', zdroj: 'BEV', R: 2000, DIR: 'data/body-at/',
        nacti: function (lat, lng) {
            var dlat = AT.R / 111320, dlng = AT.R / (111320 * Math.cos(lat * Math.PI / 180));
            var idx = _atIdx ? Promise.resolve(_atIdx) : fetch(AT.DIR + 'index.json').then(function (r) { if (!r.ok) throw new Error('BEV ' + r.status); return r.json(); }).then(function (d) { _atIdx = d; return d; });
            return idx.then(function (ix) {
                var k = ix.krok || 4, mam = {}, chci = [];
                (ix.dlazdice || []).forEach(function (t) { mam[t] = 1; });
                for (var a = Math.floor((lat - dlat) * k); a <= Math.floor((lat + dlat) * k); a++) {
                    for (var b = Math.floor((lng - dlng) * k); b <= Math.floor((lng + dlng) * k); b++) if (mam[a + '_' + b]) chci.push(a + '_' + b);
                }
                return Promise.all(chci.map(function (t) { return fetch(AT.DIR + t + '.json').then(function (r) { if (!r.ok) throw new Error('BEV ' + r.status); return r.json(); }); }));
            }).then(function (ds) {
                var out = [];
                ds.forEach(function (d) { d.forEach(function (z) { if (Math.abs(z[1] - lat) <= dlat && Math.abs(z[2] - lng) <= dlng) out.push(AT.bod(z)); }); });
                return out;
            });
        },
        bod: function (z) {
            // [jméno, šířka, délka, výška, řád, stabilizace, místní název, datum měření, střední chyba]
            var raw = { PUNKT: z[0], ORDNUNG: z[4], STABILISIERUNG: z[5], PUNKTNAME: z[6], MESSDATUM: z[7], M_XYZ: z[8], QUELLE: 'BEV, CC BY 4.0' };
            if (z[3] != null) raw.VYSKA = z[3];
            return { id: 'at_' + z[0], name: z[0], lat: z[1], lng: z[2], cat: 'TB', type: 'polohovy', rawData: raw, hidden: false, currentDist: 0, bestAccuracy: null,
                vrstva: 'AT', druh: 'Triangulierungspunkt' + (z[4] ? ' ' + z[4] + '. Ordnung' : ''), zdroj: 'BEV', nazevBodu: z[6] || null, vyska: z[3], znacka: z[5] || null, popis: null };
        }
    };
    var ZEME = { CH: CH, NL: NL, FR: FR, ES: ES, DE: DE, AT: AT };

    function stahni(z, lat, lng) {
        if (z.nacti) return z.nacti(lat, lng);
        var qs = z.urls ? z.urls(lat, lng) : [z.url(lat, lng)];
        if (qs && !qs.length) return Promise.resolve([]);   // DE mimo Berlín/MV/BW: spolková země body nezveřejňuje
        if (!qs || qs.some(function (q) { return !q; })) return Promise.reject(new Error('proj4'));
        var jeden = function (q) { return fetch(q, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error(z.zdroj + ' ' + r.status); return r.json(); }); };
        return Promise.all(qs.map(jeden)).then(function (ds) {
            var mapa = {};
            ds.forEach(function (d, i) { z.seznam(d).forEach(function (f) { var b = z.bod(f, qs[i]); if (b) mapa[b.id] = b; }); });
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
            else if (z.kod === 'DE' && !deOblasti(stred.lat, stred.lng).length && _deMimo !== true) {
                _deMimo = true;   // jednou za běh, ne při každém posunu o 800 m
                try { (window.quickToast || window.agInfo)(T('Tady spolková země úřední body jako data nezveřejňuje. V Německu je appka stáhne jen v Berlíně, Meklenbursku-Předním Pomořansku a Bádensku-Württembersku.')); } catch (e) { /* nic */ }
            }
            return n;
        }).catch(function (e) { _posl = stred; _kod = z.kod; try { (window.quickToast || window.agInfo)('Úřední body (' + z.zdroj + ') se nepodařilo stáhnout: ' + ((e && e.message) || e)); } catch (e2) { /* nic */ } return 0; }).finally(function () { _bezi = false; });
    }
    function hlaska(z, n) {
        if (z.kod === 'CH') return 'Švýcarsko: ' + n + ' bodů swisstopo v okolí (LFP1, LFP2, HFP). Výšky LN02.';
        if (z.kod === 'FR') return 'Francie: ' + n + ' bodů IGN v okolí (RBF, RDF, nivelační repéry). Výšky NGF-IGN69.';
        if (z.kod === 'ES') return 'Španělsko: ' + n + ' bodů IGN v okolí (ROI, REGENTE, REDNAP). Výšky ortometrické.';
        if (z.kod === 'DE') return 'Německo: ' + n + ' bodů AFIS v okolí (polohové a výškové body spolkové země). Výšky DHHN2016.';
        if (z.kod === 'AT') return 'Rakousko: ' + n + ' trigonometrických bodů BEV v okolí. Výšky nad mořem z elipsoidu a geoidu.';
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
