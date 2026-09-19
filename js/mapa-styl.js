// ===== QTRIG — STYL „STAVBA" PRO VLASTNÍ VEKTOROVOU MAPU (ODPOJITELNÁ, ag/lazy) ===
// (16. 9. 2026, fáze 2 „vlastní mapa" — A1 + M1, viz paměť project-vlastni-mapa-svet-vyber-16-9)
//
// Data: Protomaps Basemap v4 (vrstvy earth, landcover, landuse, water, roads, buildings,
// boundaries, places, pois) v jednom souboru PMTiles, který si appka tahá po kouskách
// (js/mapa-vektor.js). Styl je náš: jen to, co geodet u stavby potřebuje — budovy s čísly
// popisnými, silnice s hranou, koleje, vodstvo, les, pole, hranice; ŽÁDNÉ obchody,
// restaurace, zastávky, reklamy. Jedna funkce, tři varianty z jedněch dat:
//   den · noc (opravdu tmavá, ne invertovaný obrázek) · tisk (černobílá do PDF)
//   (modrotisk byl čtvrtý do 19. 9. 2026 — uživatel: „modrotisk dej pryč“; motiv Modrotisk
//   appky dostane u mapy variantu noc)
//
// HRANY, PO KTERÝCH SE DÁ JÍT (19. 9. 2026, uživatel: „abych tam mohl vidět hranice pozemků …
// chodník nebo hrany podél silnice, které se dají kalibrovat za chůze"):
//   • CHODNÍKY a PŘECHODY (OSM footway=sidewalk/crossing, v dlaždicích kind=path +
//     kind_detail sidewalk/crossing) jako tenká plná čára podél silnice — dřív byly v „cesty"
//     jako tlustá čárkovaná (bez šířky v SIRKY = výchozích 7 px) a splývaly s pěšinami.
//   • PARCELY z katastru jako VEKTOR (zdroj 'parcely', GeoJSON): hranice + parcelní čísla v barvě
//     stylu (na tmavé mapě čitelné, bez šraf a značek WMS). Data plní js/mapa-parcely.js z RÚIAN
//     ČÚZK podle výřezu; tady je jen prázdný zdroj a vrstvy, ať přežijí setStyle().
//
// AGMapaStyl.vytvor(varianta, zdrojUrl) → style JSON pro MapLibre.
// Písma: glyfy z veřejného CDN Protomaps (sw.js je drží v LIB_CACHE, ať jdou i bez signálu).
// Odstranění: smaž js/mapa-styl.js + <script> v index.html (mapa-vektor.js bez něj nenastartuje).
// ==================================================================================
(function () {
    'use strict';
    if (window.AGMapaStyl) return;

    var GLYFY = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
    var FONT = ['Noto Sans Regular'], FONT_B = ['Noto Sans Medium'];

    // Palety. Klíče: zem, voda, vodaCara, les, pole, trava, zastavba, prumysl, kolej, budova,
    // budovaHrana, silnice, silniceHrana, dalnice, cesta, hranice, text, textHalo, cislo,
    // chodnik (hrana chodníku podél silnice), parcela (hranice parcel z katastru + jejich čísla)
    var PALETY = {
        den: { zem: '#f1f2ee', voda: '#a8c8dc', vodaCara: '#7fb0cc', les: '#c6d9b3', pole: '#efeedb', trava: '#d9e6c4', zastavba: '#e9e8e2', prumysl: '#e2e0e0', kolej: '#8a8a8a',
            budova: '#d8d3c6', budovaHrana: '#a89f8c', silnice: '#ffffff', silniceHrana: '#b9b4a8', dalnice: '#f6d58a', cesta: '#c9b99a', hranice: '#9a7ab8', text: '#2f3530', textHalo: '#f1f2ee', cislo: '#5b4e3a', chodnik: '#8f8a7c', parcela: '#a0522d', leteckaPruhled: 1 },
        noc: { zem: '#151a19', voda: '#173040', vodaCara: '#2a5570', les: '#1a2820', pole: '#1b1f1a', trava: '#1c2a1e', zastavba: '#1c2120', prumysl: '#212524', kolej: '#6a6f6d',
            budova: '#2a312f', budovaHrana: '#4c5754', silnice: '#39423f', silniceHrana: '#1a1f1e', dalnice: '#6b5a2a', cesta: '#4a4335', hranice: '#6f5a8a', text: '#d5ddd8', textHalo: '#151a19', cislo: '#c9b98f', chodnik: '#6e7672', parcela: '#e0a870', leteckaPruhled: 1 },
        tisk: { zem: '#ffffff', voda: '#e6e6e6', vodaCara: '#8c8c8c', les: '#eeeeee', pole: '#ffffff', trava: '#f4f4f4', zastavba: '#fafafa', prumysl: '#f2f2f2', kolej: '#333333',
            budova: '#dddddd', budovaHrana: '#555555', silnice: '#ffffff', silniceHrana: '#444444', dalnice: '#cccccc', cesta: '#777777', hranice: '#222222', text: '#000000', textHalo: '#ffffff', cislo: '#000000', chodnik: '#6a6a6a', parcela: '#222222', leteckaPruhled: 1 }
    };

    // Šířky silnic podle kind_detail (metry na z18 ≈ px): exponenciální interpolace přes zoom.
    function sirka(z12, z18) { return ['interpolate', ['exponential', 1.6], ['zoom'], 12, z12, 18, z18]; }
    var SIRKY = {
        motorway: [3, 22], trunk: [2.5, 18], primary: [2, 16], secondary: [1.6, 13], tertiary: [1.3, 11],
        residential: [0.9, 9], unclassified: [0.9, 8], service: [0.5, 5], living_street: [0.8, 7], pedestrian: [0.6, 6],
        track: [0.4, 3], path: [0.3, 2], footway: [0.3, 2], cycleway: [0.3, 2.5], steps: [0.3, 2], bridleway: [0.3, 2],
        sidewalk: [0.2, 1.6], crossing: [0.2, 1.6], corridor: [0.2, 1.4], pier: [0.3, 2], driveway: [0.3, 2.5]
    };
    var CHODNIKY = ['sidewalk', 'crossing'];   // hrany podél silnice: plná tenká čára, ne čárkovaná pěšina
    // MapLibre dovolí v jednom výrazu jen JEDNU interpolaci přes zoom → zoom je vně, match uvnitř.
    function sirkaSilnic(nasob) {
        function m(i) { var x = ['match', ['get', 'kind_detail']]; Object.keys(SIRKY).forEach(function (k) { x.push(k, SIRKY[k][i] * nasob); }); x.push((i ? 7 : 0.8) * nasob); return x; }
        return ['interpolate', ['exponential', 1.6], ['zoom'], 12, m(0), 18, m(1)];
    }

    function vytvor(varianta, zdrojUrl) {
        var P = PALETY[varianta] || PALETY.den;
        var vrstvy = [
            { id: 'pozadi', type: 'background', paint: { 'background-color': P.zem } },
            { id: 'zem', type: 'fill', source: 'pm', 'source-layer': 'earth', paint: { 'fill-color': P.zem } },
            // krajinný pokryv (les, pole, louky) — jen plochy, bez ikon
            { id: 'pokryv-les', type: 'fill', source: 'pm', 'source-layer': 'landcover', filter: ['in', ['get', 'kind'], ['literal', ['forest', 'wood', 'scrub']]], paint: { 'fill-color': P.les } },
            { id: 'pokryv-pole', type: 'fill', source: 'pm', 'source-layer': 'landcover', filter: ['in', ['get', 'kind'], ['literal', ['farmland', 'grassland', 'barren']]], paint: { 'fill-color': ['match', ['get', 'kind'], 'farmland', P.pole, 'grassland', P.trava, P.zem] } },
            { id: 'uziti-zastavba', type: 'fill', source: 'pm', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['residential', 'commercial', 'neighbourhood', 'university', 'college', 'school', 'hospital']]], paint: { 'fill-color': P.zastavba } },
            { id: 'uziti-prumysl', type: 'fill', source: 'pm', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['industrial', 'railway', 'quarry', 'military', 'aerodrome', 'landfill']]], paint: { 'fill-color': P.prumysl } },
            { id: 'uziti-zelen', type: 'fill', source: 'pm', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['park', 'garden', 'grass', 'cemetery', 'golf_course', 'pitch', 'playground', 'allotments', 'forest', 'wood', 'orchard', 'farmland', 'meadow', 'village_green', 'recreation_ground', 'nature_reserve', 'protected_area']]], paint: { 'fill-color': ['match', ['get', 'kind'], 'forest', P.les, 'wood', P.les, 'farmland', P.pole, 'orchard', P.les, P.trava] } },
            { id: 'voda', type: 'fill', source: 'pm', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': P.voda } },
            { id: 'voda-cary', type: 'line', source: 'pm', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': P.vodaCara, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, ['match', ['get', 'kind'], 'river', 1.2, 0.6], 18, ['match', ['get', 'kind'], 'river', 6, 2.5]] } },
            // silnice: podklad (hrana) + výplň; koleje zvlášť
            { id: 'silnice-hrana', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['all', ['!=', ['get', 'kind'], 'rail'], ['!=', ['get', 'kind'], 'ferry'], ['!=', ['get', 'kind'], 'aerialway']], minzoom: 11,
                layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': P.silniceHrana, 'line-width': sirkaSilnic(1.35) } },
            { id: 'silnice', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['all', ['!=', ['get', 'kind'], 'rail'], ['!=', ['get', 'kind'], 'ferry'], ['!=', ['get', 'kind'], 'aerialway'], ['!=', ['get', 'kind'], 'path']], minzoom: 11,
                layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'kind'], 'highway', P.dalnice, P.silnice], 'line-width': sirkaSilnic(1) } },
            { id: 'cesty', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['all', ['==', ['get', 'kind'], 'path'], ['!', ['in', ['get', 'kind_detail'], ['literal', CHODNIKY]]]], minzoom: 13,
                paint: { 'line-color': P.cesta, 'line-width': sirkaSilnic(1), 'line-dasharray': [3, 2] } },
            // chodníky a přechody: hrana, po které se dá jít (a kalibrovat GPS chůzí) — plná tenká čára vedle silnice
            { id: 'chodniky', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['all', ['==', ['get', 'kind'], 'path'], ['in', ['get', 'kind_detail'], ['literal', CHODNIKY]]], minzoom: 15,
                layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': P.chodnik, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 15, 0.6, 19, 2.4] } },
            { id: 'prechody', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['all', ['==', ['get', 'kind'], 'path'], ['==', ['get', 'kind_detail'], 'crossing']], minzoom: 16,
                paint: { 'line-color': P.zem, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 16, 0.4, 19, 1.4], 'line-dasharray': [1.5, 1.5] } },
            { id: 'koleje', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'rail'], minzoom: 11,
                paint: { 'line-color': P.kolej, 'line-width': sirka(0.8, 3) } },
            { id: 'koleje-prazce', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'rail'], minzoom: 14,
                paint: { 'line-color': P.zem, 'line-width': sirka(0.5, 2), 'line-dasharray': [4, 4] } },
            // budovy: výplň + hrana
            { id: 'budovy', type: 'fill', source: 'pm', 'source-layer': 'buildings', minzoom: 13, paint: { 'fill-color': P.budova, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.55, 16, 0.95] } },
            { id: 'budovy-hrana', type: 'line', source: 'pm', 'source-layer': 'buildings', minzoom: 14, paint: { 'line-color': P.budovaHrana, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.4, 18, 1.4] } },
            { id: 'hranice', type: 'line', source: 'pm', 'source-layer': 'boundaries', filter: ['<=', ['get', 'kind_detail'], 4], paint: { 'line-color': P.hranice, 'line-width': ['match', ['get', 'kind_detail'], 2, 2, 1], 'line-dasharray': [4, 2] } },
            // parcely z katastru (vektor, plní js/mapa-parcely.js; prázdný zdroj = nic se nekreslí)
            { id: 'parcely-hranice', type: 'line', source: 'parcely', minzoom: 15, layout: { 'line-join': 'round' },
                paint: { 'line-color': P.parcela, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 17, 1, 20, 2.2], 'line-opacity': 0.85 } },
            { id: 'parcely-cisla', type: 'symbol', source: 'parcely', minzoom: 16.5, filter: ['has', 'cislo'],   // zoom MapLibre = Leaflet − 1
                layout: { 'text-field': ['get', 'cislo'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 17, 9, 20, 12], 'text-padding': 4, 'symbol-placement': 'point' },
                paint: { 'text-color': P.parcela, 'text-halo-color': P.textHalo, 'text-halo-width': 1.2 } },
            // popisky: čísla popisná (z17+), názvy ulic podél čar, sídla
            { id: 'cisla-popisna', type: 'symbol', source: 'pm', 'source-layer': 'buildings', minzoom: 17, filter: ['has', 'addr_housenumber'],
                layout: { 'text-field': ['get', 'addr_housenumber'], 'text-font': FONT, 'text-size': 10, 'text-padding': 2 }, paint: { 'text-color': P.cislo, 'text-halo-color': P.textHalo, 'text-halo-width': 1 } },
            { id: 'ulice-nazvy', type: 'symbol', source: 'pm', 'source-layer': 'roads', minzoom: 15, filter: ['all', ['has', 'name'], ['!=', ['get', 'kind'], 'rail']],
                layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:cs'], ['get', 'name']], 'text-font': FONT, 'text-size': 11, 'symbol-spacing': 350 }, paint: { 'text-color': P.text, 'text-halo-color': P.textHalo, 'text-halo-width': 1.2 } },
            { id: 'voda-nazvy', type: 'symbol', source: 'pm', 'source-layer': 'water', minzoom: 13, filter: ['has', 'name'],
                layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:cs'], ['get', 'name']], 'text-font': FONT, 'text-size': 10 }, paint: { 'text-color': P.vodaCara, 'text-halo-color': P.textHalo, 'text-halo-width': 1 } },
            { id: 'sidla', type: 'symbol', source: 'pm', 'source-layer': 'places', maxzoom: 16, filter: ['in', ['get', 'kind'], ['literal', ['locality', 'neighbourhood', 'region', 'country']]],
                layout: { 'text-field': ['coalesce', ['get', 'name:cs'], ['get', 'name']], 'text-font': FONT_B, 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 14, 15], 'text-max-width': 8 }, paint: { 'text-color': P.text, 'text-halo-color': P.textHalo, 'text-halo-width': 1.5 } },
            // pár POI, které geodeta zajímají: vrcholy s výškou, nádraží
            { id: 'poi-vrcholy', type: 'symbol', source: 'pm', 'source-layer': 'pois', minzoom: 13, filter: ['in', ['get', 'kind'], ['literal', ['peak', 'station']]],
                layout: { 'text-field': ['case', ['has', 'elevation'], ['concat', ['coalesce', ['get', 'name:cs'], ['get', 'name'], ''], ' ', ['to-string', ['get', 'elevation']], ' m'], ['coalesce', ['get', 'name:cs'], ['get', 'name']]], 'text-font': FONT, 'text-size': 10, 'text-anchor': 'top', 'text-offset': [0, 0.4] }, paint: { 'text-color': P.text, 'text-halo-color': P.textHalo, 'text-halo-width': 1 } }
        ];
        return {
            version: 8,
            name: 'QTRIG stavba · ' + varianta,
            glyphs: GLYFY,
            sources: { pm: { type: 'vector', url: 'pmtiles://' + zdrojUrl, attribution: '© OpenStreetMap · Protomaps' },
                parcely: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: '© ČÚZK' } },
            layers: vrstvy
        };
    }

    window.AGMapaStyl = { vytvor: vytvor, PALETY: PALETY, VARIANTY: ['den', 'noc', 'tisk'], CHODNIKY: CHODNIKY };
})();
