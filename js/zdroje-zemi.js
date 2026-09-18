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
            var zeme = (window.AGSour && AGSour.ZEME[kod]) ? AGSour.ZEME[kod].nazev : kod;
            if (kod === 'CZ') toast('Podklady zpět na ČÚZK (ortofoto, katastr).');
            else {
                // úřední body: jen kde je stát zveřejňuje (SK body-sk.js, CH/NL body-svet.js) — ať to lidi
                // z ciziny vědí a nečekají, že body v mapě naskočí (18. 9. 2026 noc)
                var uz = (kod === 'SK') ? 'GKÚ SR' : (window.AGBodySvet && AGBodySvet.zdrojPro(kod));
                toast('Podklady pro ' + zeme + ': ortofoto ' + (orto.nazev) + (kat ? ', katastr ' + kat.nazev : ' — katastr pro tuhle zemi nemám (parcely ČÚZK tu nejsou)') + '. '
                    + (uz ? T('Úřední body tu stát zveřejňuje') + ' (' + uz + ') — ' + T('appka je stáhne kolem tebe.') : T('Úřední body tu stát nezveřejňuje — v mapě jsou jen tvoje body (Nový bod, import, výkres).')));
            }
        }
        try { document.dispatchEvent(new CustomEvent('ag:zdroje', { detail: { kod: kod, orto: orto, katastr: kat } })); } catch (e) { /* nic */ }
        return true;
    }
    function podleZeme(tise) { try { var k = window.AGSour ? AGSour.kod() : 'CZ'; if (k !== _aktualni) prepni(k, tise); } catch (e) { swallow(e, 'podleZeme'); } }
    document.addEventListener('ag:zeme', function () { podleZeme(false); });
    function start() { var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1200); }; idle(function () { podleZeme(true); }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.AGZdroje = { ZDROJE: ZDROJE, ESRI: ESRI, prepni: prepni, podleZeme: podleZeme, aktualni: function () { return _aktualni; }, ma: function (kod) { return !!ZDROJE[kod]; } };
})();
