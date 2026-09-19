// ===== QTRIG — ZDROJE DAT PO ZEMÍCH: katastr a ortofoto mimo ČR (ODPOJITELNÁ, ag/lazy) =====
// (17. 9. 2026, fáze 4 — C3; viz paměť project-vlastni-mapa-svet-vyber-16-9)
//
// Ortofoto a katastr v mapě šly vždycky z ČÚZK, které za hranicí končí. Registr zemí
// (js/sour-zeme.js) už ví, kde stojím — tady se podle toho přepnou podkladové služby:
//   • KATASTR (WMS, průhledný přes mapu): SK (GKÚ ESKN), PL (GUGiK KIEG — parcely, čísla,
//     budovy), AT (BEV DKM), NL (Kadaster PDOK), FR (IGN Parcellaire Express), CH (kantony
//     přes geo.admin.ch), SI (GURS), BE (Vlámsko ADPF), HU (Lechner INSPIRE CP).
//   • ORTOFOTO: SK (ZBGIS), PL (GUGiK), NL (PDOK), FR (IGN), CH (swisstopo), BE (Vlámsko),
//     ES (PNOA), AT (basemap.at); jinde záložně světová vrstva Esri World Imagery.
//   Ověřeno 17. 9. 2026 (GetMap v EPSG:3857 vrací obrázek). Bodová pole cizích států jako
//   dotazovatelná data veřejně nejsou (SK/PL jen mapové služby s přihlášením) — appka mimo ČR
//   jede na vlastní body + katastr + mapu; ČÚZK body zůstávají česká věc.
//
// JAK: katastrLayer (WMS z logika.js) dostane setUrl + setParams; ortofoto se v baseLayers
// vymění za novou vrstvu (WMS nebo XYZ) — applyMapLayers() z grafika.js ji pak přidává jako
// dřív. V ČR se všechno vrátí na ČÚZK. Přepíná událost ag:zeme (auto i ruční volba).
// Odstranění: smaž js/zdroje-zemi.js + <script> v index.html; gen_sw_assets --bump.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGZdroje) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'zdroje-zemi:' + kde); } catch (e2) { /* nic */ } };

    var ESRI = { typ: 'xyz', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '© Esri, Maxar, Earthstar Geographics', nazev: 'Esri World Imagery (svět)', maxNativeZoom: 19 };
    function wms(url, layers, format, attribution, nazev) { return { typ: 'wms', url: url, layers: layers, format: format || 'image/png', attribution: attribution, nazev: nazev }; }
    var ZDROJE = {
        SK: { katastr: wms('https://kataster.skgeodesy.sk/eskn/services/NR/kn_wms_orto/MapServer/WMSServer', '1,2,3,4,5,6,7,8', 'image/png', '© ÚGKK SR', 'katastr SR (ESKN)'), orto: wms('https://zbgisws.skgeodesy.sk/zbgis_ortofoto_wms/service.svc/get', '1,2,3', 'image/jpeg', '© GKÚ Bratislava', 'ortofoto ZBGIS') },
        PL: { katastr: wms('https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow', 'dzialki,numery_dzialek,budynki', 'image/png', '© GUGiK', 'ewidencja gruntów (KIEG)'), orto: wms('https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution', 'Raster', 'image/jpeg', '© GUGiK', 'ortofotomapa GUGiK') },
        AT: { katastr: wms('https://data.bev.gv.at/geoserver/BEVdataKAT/wms', 'DKM_GST', 'image/png', '© BEV', 'DKM (BEV)'), orto: { typ: 'xyz', url: 'https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg', attribution: '© basemap.at', nazev: 'basemap.at ortofoto', maxNativeZoom: 19 } },
        NL: { katastr: wms('https://service.pdok.nl/kadaster/kadastralekaart/wms/v5_0', 'Kadastralekaart', 'image/png', '© Kadaster', 'Kadastrale kaart (PDOK)'), orto: wms('https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0', 'Actueel_orthoHR', 'image/jpeg', '© Beeldmateriaal Nederland', 'luchtfoto PDOK') },
        FR: { katastr: wms('https://data.geopf.fr/wms-r/wms', 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS', 'image/png', '© IGN', 'parcellaire express (IGN)'), orto: wms('https://data.geopf.fr/wms-r/wms', 'ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg', '© IGN', 'orthophotos IGN') },
        CH: { katastr: wms('https://wms.geo.admin.ch/', 'ch.kantone.cadastralwebmap-farbe', 'image/png', '© swisstopo, kantony', 'CadastralWebMap'), orto: wms('https://wms.geo.admin.ch/', 'ch.swisstopo.swissimage', 'image/jpeg', '© swisstopo', 'SWISSIMAGE') },
        LI: { katastr: wms('https://wms.geo.admin.ch/', 'ch.kantone.cadastralwebmap-farbe', 'image/png', '© swisstopo', 'CadastralWebMap'), orto: wms('https://wms.geo.admin.ch/', 'ch.swisstopo.swissimage', 'image/jpeg', '© swisstopo', 'SWISSIMAGE') },
        SI: { katastr: wms('https://ipi.eprostor.gov.si/wms-si-gurs-kn/wms', 'SI.GURS.KN:PARCELE', 'image/png', '© GURS', 'kataster GURS'), orto: ESRI },
        BE: { katastr: wms('https://geo.api.vlaanderen.be/Adpf/wms', 'Adpf', 'image/png', '© Vlaanderen', 'ADPF (Vlámsko)'), orto: wms('https://geo.api.vlaanderen.be/omw/wms', 'OMWRGB25VL', 'image/jpeg', '© Vlaanderen', 'orthofoto (Vlámsko)') },
        HU: { katastr: wms('https://inspire.lechnerkozpont.hu/geoserver/cp/wms', 'CP.CadastralParcel', 'image/png', '© Lechner', 'INSPIRE parcely (HU)'), orto: ESRI },
        ES: { orto: wms('https://www.ign.es/wms-inspire/pnoa-ma', 'OI.OrthoimageCoverage', 'image/jpeg', '© IGN España (PNOA)', 'PNOA') }
    };

    // ---- KATASTRÁLNÍ PORTÁLY (19. 9. 2026, E2) --------------------------------------------------
    // Nástroj „Katastr — kde právě stojím" otevíral v Paříži a Varšavě iKatastr.cz (český katastr
    // na cizích souřadnicích). Mimo ČR se místo toho otevře portál té země — s polohou, kde to
    // adresa umí (SK ZBGIS pos=, FR Géoportail c=, CH map.geo.admin.ch center= v LV95, NL
    // kadastralekaart lat/lng), jinde aspoň úvodní stránka. Bez portálu → jen hláška.
    var PORTALY = {
        SK: { n: 'ZBGIS kataster', u: function (la, lo) { return 'https://zbgis.skgeodesy.sk/mkzbgis/sk/kataster?pos=' + la.toFixed(6) + ',' + lo.toFixed(6) + ',18'; } },
        PL: { n: 'Geoportal.gov.pl', u: function () { return 'https://mapy.geoportal.gov.pl/imap/Imgp_2.html?gpmap=gp0'; } },
        AT: { n: 'BEV Kataster', u: function () { return 'https://kataster.bev.gv.at/'; } },
        DE: { n: 'Geoportal.de', u: function () { return 'https://www.geoportal.de/'; } },
        CH: { n: 'map.geo.admin.ch', u: function (la, lo) { var e = null; try { var m = window.AGSour && AGSour.doMistnich(la, lo); if (m) e = m; } catch (x) { e = null; } return 'https://map.geo.admin.ch/#/map?lang=de&layers=ch.kantone.cadastralwebmap-farbe' + (e ? '&center=' + Math.round(e.y) + ',' + Math.round(e.x) + '&z=12' : ''); } },
        LI: { n: 'map.geo.admin.ch', u: function () { return 'https://map.geo.admin.ch/#/map?lang=de&layers=ch.kantone.cadastralwebmap-farbe'; } },
        FR: { n: 'Géoportail (cadastre)', u: function (la, lo) { return 'https://www.geoportail.gouv.fr/carte?c=' + lo.toFixed(6) + ',' + la.toFixed(6) + '&z=18&l0=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes'; } },
        NL: { n: 'Kadastrale kaart', u: function (la, lo) { return 'https://kadastralekaart.com/kaart?lat=' + la.toFixed(6) + '&lng=' + lo.toFixed(6) + '&zoom=18'; } },
        BE: { n: 'CadGIS', u: function () { return 'https://eservices.minfin.fgov.be/ecad-web/'; } },
        LU: { n: 'Geoportail.lu', u: function (la, lo) { return 'https://map.geoportail.lu/theme/cadastre_hertzien?lang=fr'; } },
        ES: { n: 'Sede Catastro', u: function () { return 'https://www1.sedecatastro.gob.es/Cartografia/mapa.aspx'; } },
        IT: { n: 'Agenzia Entrate — cartografia', u: function () { return 'https://geoportale.cartografia.agenziaentrate.gov.it/'; } },
        HU: { n: 'Lechner — térképek', u: function () { return 'https://www.e-epites.hu/'; } },
        SI: { n: 'e-Prostor', u: function () { return 'https://ipi.eprostor.gov.si/jgp/'; } },
        HR: { n: 'Katastar.hr', u: function () { return 'https://oss.uredjenazemlja.hr/'; } },
        GB: { n: 'HM Land Registry map', u: function () { return 'https://search-property-information.service.gov.uk/'; } },
        IE: { n: 'Tailte Éireann', u: function () { return 'https://www.landdirect.ie/'; } },
        SE: { n: 'Lantmäteriet Min karta', u: function () { return 'https://minkarta.lantmateriet.se/'; } },
        NO: { n: 'Norgeskart', u: function (la, lo) { return 'https://norgeskart.no/#!?project=norgeskart&layers=1002,1015&zoom=16&lat=' + la.toFixed(5) + '&lon=' + lo.toFixed(5); } },
        FI: { n: 'Karttapaikka', u: function () { return 'https://asiointi.maanmittauslaitos.fi/karttapaikka/'; } },
        EE: { n: 'Maa-amet kaardirakendus', u: function () { return 'https://xgis.maaamet.ee/xgis2/page/app/kataster'; } },
        LV: { n: 'Kadastrs.lv', u: function () { return 'https://www.kadastrs.lv/'; } },
        LT: { n: 'Regia.lt', u: function () { return 'https://www.regia.lt/map/regia_public'; } },
        PT: { n: 'DGT — cadastro', u: function () { return 'https://bupi.gov.pt/'; } },
        BG: { n: 'КАИС — кадастър', u: function () { return 'https://kais.cadastre.bg/'; } },
        GR: { n: 'Ktimatologio', u: function () { return 'https://www.ktimatologio.gr/'; } },
    };
    function portal() {
        var kod = 'CZ'; try { kod = (window.AGSour && AGSour.kod()) || 'CZ'; } catch (e) { kod = 'CZ'; }
        if (kod === 'CZ') return false;
        var la = null, lo = null; try { la = window.userLat; lo = window.userLng; } catch (e) { la = null; }
        var p = PORTALY[kod];
        if (!p) { try { if (typeof quickToast === 'function') quickToast(T('Katastr tu stát online nenabízí — v mapě zůstává vrstva Katastr, pokud ji země má.')); } catch (e) { /* nic */ } return true; }
        var u = null; try { u = (la != null && lo != null) ? p.u(la, lo) : p.u(0, 0); } catch (e) { u = null; }
        if (!u) return true;
        try { window.open(u, '_blank', 'noopener'); } catch (e) { swallow(e, 'portal'); }
        try { if (typeof quickToast === 'function') quickToast(T('Katastr země') + ': ' + p.n + ' ↗'); } catch (e) { /* nic */ }
        return true;
    }

    // ---- PARCELA V BODĚ MIMO ČR (19. 9. 2026, E4) ------------------------------------------------
    // Klik do parcely (js/parcela-klik.js) uměl jen RÚIAN. Otevřené dotazy „parcela pod bodem", ověřené
    // naostro 19. 9. 2026 (CORS v pořádku):
    //   PL  ULDK GUGiK  GetParcelByXY&xy=lon,lat,4326 → „0\nid|vojvodství|powiat|gmina|obręb|číslo|SRID=4326;POLYGON(…)"
    //   FR  apicarto IGN /api/cadastre/parcelle?geom={Point} → GeoJSON (numero, section, nom_com, contenance m², idu)
    //   NL  PDOK WFS kadastralekaart Perceel — CQL_FILTER služba ignoruje, funguje malý bbox v CRS84;
    //       z výsledků se vezme parcela, která bod opravdu obsahuje (kadastraleGemeenteWaarde, sectie,
    //       perceelnummer, kadastraleGrootteWaarde m²).
    // Vrací {cislo, sekce, obec, ku, vymera, rings [[lat,lng]…], zdroj, odkaz} nebo null (bod mimo parcelu).
    function ringsZWkt(wkt) {
        var m = /POLYGON\s*\(\((.*?)\)\)/i.exec(wkt || ''); if (!m) return [];
        return [m[1].split(',').map(function (p) { var c = p.trim().split(/\s+/); return [parseFloat(c[1]), parseFloat(c[0])]; }).filter(function (c) { return isFinite(c[0]) && isFinite(c[1]); })];
    }
    function ringsZGeoJson(g) {
        if (!g) return [];
        var polys = g.type === 'MultiPolygon' ? g.coordinates : (g.type === 'Polygon' ? [g.coordinates] : []);
        var out = []; polys.forEach(function (poly) { (poly || []).forEach(function (ring) { out.push(ring.map(function (c) { return [c[1], c[0]]; })); }); });
        return out;
    }
    function vBodu(rings, lat, lng) {   // ray casting po vnějším prstenci
        if (!rings || !rings.length) return false; var r = rings[0], uvnitr = false;
        for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
            var yi = r[i][0], xi = r[i][1], yj = r[j][0], xj = r[j][1];
            if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) uvnitr = !uvnitr;
        }
        return uvnitr;
    }
    function fetchJson(u, ms) {
        var ctrl = (typeof AbortController === 'function') ? new AbortController() : null, t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 12000) : null;
        return fetch(u, { mode: 'cors', signal: ctrl ? ctrl.signal : undefined }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).finally(function () { if (t) clearTimeout(t); });
    }
    var PARCELY = {
        PL: function (lat, lng) {
            return fetchJson('https://uldk.gugik.gov.pl/?request=GetParcelByXY&xy=' + lng.toFixed(6) + ',' + lat.toFixed(6) + ',4326&result=id,voivodeship,county,commune,region,parcel,geom_wkt&srid=4326').then(function (t) {
                var l = String(t).split('\n'); if (l[0].trim() !== '0' || !l[1]) return null;
                var c = l[1].split('|');
                return { cislo: c[5] || c[0], id: c[0], obec: c[3] || '', ku: (c[4] ? 'obręb ' + c[4] : '') + (c[2] ? (c[4] ? ', ' : '') + c[2] : ''), kraj: c[1] || '', vymera: null, rings: ringsZWkt(c[6]), zdroj: 'ULDK (GUGiK)', odkaz: 'https://mapy.geoportal.gov.pl/imap/Imgp_2.html?gpmap=gp0' };
            });
        },
        FR: function (lat, lng) {
            return fetchJson('https://apicarto.ign.fr/api/cadastre/parcelle?geom=' + encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [+lng.toFixed(6), +lat.toFixed(6)] }))).then(function (t) {
                var d = JSON.parse(t), f = d && d.features && d.features[0]; if (!f) return null;
                var p = f.properties || {};
                return { cislo: (p.section || '') + ' ' + (p.numero || ''), id: p.idu || '', obec: p.nom_com || '', ku: p.code_insee ? 'INSEE ' + p.code_insee + (p.feuille ? ', feuille ' + p.feuille : '') : '', kraj: p.code_dep ? 'dép. ' + p.code_dep : '', vymera: (p.contenance != null && isFinite(p.contenance)) ? +p.contenance : null, rings: ringsZGeoJson(f.geometry), zdroj: 'IGN apicarto (Parcellaire Express)', odkaz: 'https://www.geoportail.gouv.fr/carte?c=' + lng.toFixed(6) + ',' + lat.toFixed(6) + '&z=18&l0=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes' };
            });
        },
        NL: function (lat, lng) {
            var d = 0.00012;
            return fetchJson('https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0?service=WFS&version=2.0.0&request=GetFeature&typeNames=kadastralekaart:Perceel&count=10&outputFormat=application/json&bbox=' + (lng - d).toFixed(6) + ',' + (lat - d).toFixed(6) + ',' + (lng + d).toFixed(6) + ',' + (lat + d).toFixed(6) + ',urn:ogc:def:crs:OGC:1.3:CRS84&srsName=EPSG:4326').then(function (t) {   // srsName: bez něj geometrie v RD (EPSG:28992)
                var dj = JSON.parse(t), fs = (dj && dj.features) || []; if (!fs.length) return null;
                var f = null; for (var i = 0; i < fs.length; i++) { if (vBodu(ringsZGeoJson(fs[i].geometry), lat, lng)) { f = fs[i]; break; } }
                if (!f) f = fs[0];
                var p = f.properties || {};
                return { cislo: (p.kadastraleGemeenteWaarde || '') + ' ' + (p.sectie || '') + ' ' + (p.perceelnummer != null ? p.perceelnummer : ''), id: p.identificatieLokaalID || '', obec: p.kadastraleGemeenteWaarde || '', ku: p.AKRKadastraleGemeenteCodeWaarde ? 'AKR ' + p.AKRKadastraleGemeenteCodeWaarde : '', kraj: '', vymera: (p.kadastraleGrootteWaarde != null && isFinite(p.kadastraleGrootteWaarde)) ? +p.kadastraleGrootteWaarde : null, rings: ringsZGeoJson(f.geometry), zdroj: 'Kadaster (PDOK)', odkaz: 'https://kadastralekaart.com/kaart?lat=' + lat.toFixed(6) + '&lng=' + lng.toFixed(6) + '&zoom=18' };
            });
        }
    };
    function parcela(lat, lng) {
        var kod = 'CZ'; try { kod = (window.AGSour && AGSour.kod()) || 'CZ'; } catch (e) { kod = 'CZ'; }
        var fn = PARCELY[kod]; if (!fn) return null;
        return fn(lat, lng).then(function (p) { if (p) { p.kod = kod; p.lat = lat; p.lng = lng; } return p; });
    }
    function maParcelu(kod) { return !!PARCELY[kod]; }

    var _origOrto = null, _origKat = null, _aktualni = 'CZ', _vrstvaOrto = null;
    function toast(m) { try { if (typeof window.agInfo === 'function') window.agInfo(m); } catch (e) { /* nic */ } }
    function T(t) { try { return (window.AGJazyk && AGJazyk.t) ? AGJazyk.t(t) : t; } catch (e) { return t; } }
    function vrstvaZ(z) {
        if (z.typ === 'xyz') return L.tileLayer(z.url, { maxZoom: 22, maxNativeZoom: z.maxNativeZoom || 18, zIndex: 1, attribution: z.attribution });
        return L.tileLayer.wms(z.url, { layers: z.layers, format: z.format, version: '1.3.0', transparent: z.format === 'image/png', maxZoom: 22, zIndex: 1, attribution: z.attribution });
    }
    function prepni(kod, tise) {
        if (typeof baseLayers === 'undefined' || typeof katastrLayer === 'undefined' || typeof map === 'undefined') return false;
        if (!_origOrto) { _origOrto = baseLayers.ortofoto; _origKat = { url: katastrLayer._url, params: { layers: katastrLayer.wmsParams.layers, format: katastrLayer.wmsParams.format, transparent: katastrLayer.wmsParams.transparent } }; }
        var z = (kod === 'CZ') ? null : (ZDROJE[kod] || {});
        var orto = z ? (z.orto || ESRI) : null;
        var kat = z ? (z.katastr || null) : null;
        // ORTOFOTO: výměna vrstvy v baseLayers (zůstane-li zobrazená, prohodit i v mapě)
        var byloOrto = map.hasLayer(baseLayers.ortofoto);
        if (byloOrto) map.removeLayer(baseLayers.ortofoto);
        baseLayers.ortofoto = orto ? vrstvaZ(orto) : _origOrto;
        if (byloOrto) baseLayers.ortofoto.addTo(map);
        // KATASTR: WMS zůstává tentýž objekt, mění se adresa a vrstvy
        try {
            var k = kat || _origKat;
            katastrLayer.setUrl(kat ? kat.url : _origKat.url, true);
            katastrLayer.setParams(kat ? { layers: kat.layers, format: kat.format, transparent: true } : _origKat.params, false);
        } catch (e) { swallow(e, 'katastr'); }
        _aktualni = kod;
        if (!tise) {
            if (kod === 'CZ') toast('Podklady zpět na ČÚZK (ortofoto, katastr).');
            else uvod(kod, true);   // karta „Měříš v zemi" místo dvou hlášek (18. 9. 2026 noc)
        }
        if (tise && kod !== 'CZ') naplanujUvod(kod);   // start appky rovnou v cizině: ukázat jednou na zemi
        try { document.dispatchEvent(new CustomEvent('ag:zdroje', { detail: { kod: kod, orto: orto, katastr: kat } })); } catch (e) { /* nic */ }
        return true;
    }
    // ---- KARTA „MĚŘÍŠ V ZEMI X" (18. 9. 2026 noc) ----------------------------------------------
    // Uživatel: „chci tu aplikaci mít po celé Evropě — když si ji stáhnou v cizině, ať o tom vědí,
    // aniž by museli jet přes hranice." Dřív se o zemi říkalo jen PO PŘEJEZDU hranice (dvě hlášky
    // za sebou); kdo appku spustil poprvé v Polsku, nedozvěděl se nic. Teď se po startu v cizí zemi
    // (jednou na zemi, klíč agZemeUvod_v1) i při každém přejezdu ukáže jedna karta: souřadnice a výšky
    // té země, jestli tu stát ZVEŘEJŇUJE ÚŘEDNÍ BODY (CZ ČÚZK, SK GKÚ, CH swisstopo, NL Kadaster —
    // jinde ne: v mapě jsou jen vlastní body), jestli mám katastr a jaké ortofoto. Čeká, až appka
    // běží (body.app-started) a není otevřený jiný dialog, ať nepřekryje bránu nebo průvodce.
    var UVOD_KLIC = 'agZemeUvod_v1', _uvodTik = null;
    function uvodVideno() { try { return JSON.parse(localStorage.getItem(UVOD_KLIC) || '{}') || {}; } catch (e) { return {}; } }
    function uvodZapis(kod) { try { var v = uvodVideno(); v[kod] = Date.now(); localStorage.setItem(UVOD_KLIC, JSON.stringify(v)); } catch (e) { /* nic */ } }
    function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function uvodHtml(kod) {
        var z = (window.AGSour && AGSour.ZEME[kod]) || null, jm = z ? z.nazev : kod;
        // souřadnice TÉ země (z registru), ne právě aktivní — karta se ukazuje i pro zemi, kam se teprve jede
        var c = (z && z.crs) || null; if (!c) { try { c = window.AGSour && AGSour.crs ? AGSour.crs() : null; } catch (e) { c = null; } }
        var zd = ZDROJE[kod] || {}, orto = zd.orto || ESRI, kat = zd.katastr || null;
        var uz = (kod === 'SK') ? 'GKÚ SR' : (window.AGBodySvet && AGBodySvet.zdrojPro(kod));
        var row = function (l, v, ok) { return '<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid rgba(128,128,128,.18);"><span style="opacity:.75;min-width:96px;">' + esc(l) + '</span><span' + (ok === false ? ' style="color:var(--warning,#e6a100);"' : (ok === true ? ' style="color:var(--accent);"' : '')) + '>' + v + '</span></div>'; };
        var h = '<div style="text-align:left;">';
        if (c) h += row(T('Souřadnice'), esc(c.nazev) + (c.osy ? ' <span style="opacity:.7;">(' + esc(c.osy.join(', ')) + ')</span>' : ''));
        if (z && z.vyska) h += row(T('Výšky'), esc(z.vyska.nazev));
        h += row(T('Úřední body'), uz ? esc(T('ano') + ' — ' + uz) + '<br><span style="opacity:.8;font-size:.92em;">' + esc(T('appka je stáhne kolem tebe.')) + '</span>'
            : esc(T('ne')) + '<br><span style="opacity:.8;font-size:.92em;">' + esc(T('Úřední body tu stát nezveřejňuje — v mapě jsou jen tvoje body (Nový bod, import, výkres).')) + '</span>', !!uz);
        h += row(T('Katastr'), kat ? esc(T('ano') + ' — ' + kat.nazev) + (PARCELY[kod] ? '<br><span style="opacity:.8;font-size:.92em;">' + esc(T('klepnutím do mapy zjistíš číslo a hranici parcely')) + '</span>' : '') : esc(T('ne — parcely tu nemám')), !!kat);
        h += row(T('Ortofoto'), esc(T(orto.nazev)));
        h += '</div><p style="margin:10px 0 0;font-size:.92em;opacity:.85;">' + esc(T('Úřední body zveřejňují jako data Česko, Slovensko, Švýcarsko, Nizozemsko, Francie a Španělsko. Jinde se dnes měří roverem ze státní sítě a body si geodet zakládá sám — appka tu pracuje s tvými body, výkresem a kalibracemi.')) + '</p>';
        h += '<p style="margin:8px 0 0;font-size:.85em;opacity:.65;">' + esc(T('Zemi změníš v Nastavení → Mapa a body → Země měření.')) + '</p>';
        return { title: T('Měříš v zemi') + ': ' + T(jm), html: h };
    }
    function uvod(kod, vzdy) {
        if (!kod || kod === 'CZ') return false;
        if (!vzdy && uvodVideno()[kod]) return false;
        var k = uvodHtml(kod);
        uvodZapis(kod);
        try {
            if (typeof window.agAlert === 'function') window.agAlert({ title: k.title, message: k.html, okText: T('Rozumím') });
            else toast(k.title + '. ' + k.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        } catch (e) { swallow(e, 'uvod'); }
        return true;
    }
    // po startu: počkat, až appka běží a nic jiného neleží přes obrazovku (brána, průvodce, dialog)
    function naplanujUvod(kod) {
        if (!kod || kod === 'CZ' || uvodVideno()[kod] || _uvodTik) return;
        var od = Date.now();
        _uvodTik = setInterval(function () {
            try {
                var k2 = window.AGSour ? AGSour.kod() : kod;
                if (k2 === 'CZ' || uvodVideno()[k2]) { clearInterval(_uvodTik); _uvodTik = null; return; }
                var bezi = document.body && document.body.classList.contains('app-started');
                var prekryv = document.querySelector('.ag-dlg-overlay.open, .modal-overlay.open, .modal.open, #ag-gate, #ag-login, #ag-pm, #agtp-block, #agtp-card');
                if (bezi && !prekryv) { clearInterval(_uvodTik); _uvodTik = null; uvod(k2, false); }
                else if (Date.now() - od > 180000) { clearInterval(_uvodTik); _uvodTik = null; }   // do 3 min, jinak příště
            } catch (e) { swallow(e, 'uvodTik'); }
        }, 2000);
    }
    function podleZeme(tise) { try { var k = window.AGSour ? AGSour.kod() : 'CZ'; if (k !== _aktualni) prepni(k, tise); } catch (e) { swallow(e, 'podleZeme'); } }
    document.addEventListener('ag:zeme', function () { podleZeme(false); });
    function start() { var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1200); }; idle(function () { podleZeme(true); }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.AGZdroje = { ZDROJE: ZDROJE, ESRI: ESRI, PORTALY: PORTALY, portal: portal, parcela: parcela, maParcelu: maParcelu, prepni: prepni, podleZeme: podleZeme, aktualni: function () { return _aktualni; }, ma: function (kod) { return !!ZDROJE[kod]; }, uvod: uvod, uvodHtml: uvodHtml, naplanujUvod: naplanujUvod, UVOD_KLIC: UVOD_KLIC };
})();
