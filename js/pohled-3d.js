// ===== QTRIG — 3D POHLED: budovy a terén ve výšce (ODPOJITELNÁ, lazy nástroj) ==========
// (16. 9. 2026, fáze 2 „vlastní mapa" — M2; viz paměť project-vlastni-mapa-svet-vyber-16-9)
//
// K ČEMU: u vytyčování rohů a u profilů je nejrychlejší způsob, jak si ověřit, že stojím
// u SPRÁVNÉ hrany, podívat se na místo šikmo shora: budovy vytažené do výšky (z OSM
// `height`, jinak odhad 3,2 m na podlaží / 8 m), terén z výškových dlaždic (AWS Terrain
// Tiles, celý svět, zdarma) a nad tím body zakázky, výkres DXF (osa tlustě) a moje poloha.
//
// SAMOSTATNÁ MAPA MAPLIBRE PŘES CELOU OBRAZOVKU — ne hlavní mapa: Leaflet naklopení
// neumí a hlavní mapu s 10 moduly bych rozbil. Stejná data a stejný styl (js/mapa-styl.js,
// varianta podle motivu) jako podklad (A1), takže pohled sedí s tím, co je v mapě.
// Ovládání: dva prsty = otočit/naklopit, tlačítka Na mě · Sever · 2D/3D · Terén · Zavřít.
//
// PRÁCE V 3D (17. 9. 2026, přání uživatele):
//   • klepnutí na bod = karta dole (jméno, výška, vzdálenost) + tlačítka KARTA BODU (otevře
//     kartu appky) a NAVIGOVAT (= stejná navigace jako v mapě/AR: highlightedPointId, takže
//     po zavření 3D běží dál ve splitu); trasa terénem (js/trasa-terenem.js) se kreslí i tady;
//   • CHODNÍKY VE 3D: chodníky, stezky, přechody a schody z dat mapy jako pásy v METRECH (šířka
//     1,8 / 2,5 / 3,5 m) s tmavou obrubou po obou stranách, položené na terén (line vrstvy se na
//     terén přimknou a v zatáčkách se spojí kulatě — extruze 12 cm z v348 problikávala, lámala se
//     po úsecích a na svahu stála nakřivo, uživatel 17. 9. 2026);
//   • BODY VE VÝŠCE: bod s výškou (Bpv) dostane sloupek od terénu ČÚZK DMR 5G (přesnost
//     0,2 m) — nivelační značka ve zdi, bod na mostě; pod 0,4 m se nic nekreslí (šum);
//   • ZELEŇ: les a křoví z mapy jako poloprůhledné objemy (12 m / 2,5 m) — tlačítko Zeleň;
//   • GLÓBUS: při oddálení se mapa stočí do koule — přechod glóbus↔plocha je posunutý na z12–14
//     (výchozí MapLibre 11–12), takže při pohledu na celé Česko už je koule vidět; větší zakřivení
//     („tiny planet" jako Insta360) MapLibre neumí, kreslí skutečnou Zemi.
//   • KARTA BODU: klepnutí na bod otevře KLASICKOU kartu appky (bottom sheet) NAD 3D pohledem
//     (body.ag-3d-open zvedá z-index karty) — 3D zůstává otevřené, nic nepřepíná do 2D.
//
// Vyžaduje zapnutou vektorovou mapu (knihovny + data): bez ní nástroj poradí, kde ji zapnout.
// V režimu slabší telefon se nenabízí (WebGL). Terén jde vypnout (data navíc ~40 kB/dlaždice).
//
// Odstranění: smaž js/pohled-3d.js + css/pohled-3d.css, řádek v MANIFESTu js/lazy-tools.js,
// klíč 'pohled-3d' v js/tools-registry.js a data/navody.json; gen_sw_assets --bump.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGPohled3d) return;   // (agOpenPohled3d může být placeholder z lazy-tools.js)
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'pohled-3d:' + kde); } catch (e2) { /* nic */ } };
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>';
    var TEREN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
    var KEY = 'agPohled3d_v1';
    var st = { teren: true, pitch: 60, zelen: true, chodniky: true, globus: true };
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { ['teren', 'zelen', 'chodniky', 'globus'].forEach(function (k) { if (s[k] != null) st[k] = !!s[k]; }); if (s.pitch != null) st.pitch = +s.pitch; } } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }
    var CHODNIK = { sidewalk: 1.8, footway: 1.8, pedestrian: 3.5, crossing: 2.5, steps: 1.8, path: 1.2, cycleway: 2.0 };
    // šířka v METRECH → pixely podle zoomu (exponenciálně, přesně pro 50° s. š.; jinde ±15 %)
    function metry(vyrazM) { return ['interpolate', ['exponential', 2], ['zoom'], 14, ['*', vyrazM, 0.163], 20, ['*', vyrazM, 10.4]]; }
    var SIRKA_CHODNIKU = ['match', ['get', 'kind_detail'], 'pedestrian', CHODNIK.pedestrian, 'crossing', CHODNIK.crossing, 'cycleway', CHODNIK.cycleway, 'path', CHODNIK.path, 1.8];

    var el = null, m3 = null, _sleduj = null, _vybrany = null, _dmr = {};

    function poloha() { try { return (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng } : null; } catch (e) { return null; } }
    function heading() { try { return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : 0; } catch (e) { return 0; } }
    function barvaBodu(pt) { try { return agBarvaBodu(pt); } catch (e) { return pt.cat === 'CUSTOM' ? '#22c55e' : '#f59e0b'; } }
    function mPerDeg(lat) { return { lat: 111320, lng: 111320 * Math.cos(lat * Math.PI / 180) }; }
    function cilId() { try { return (typeof highlightedPointId !== 'undefined') ? highlightedPointId : null; } catch (e) { return null; } }

    // ---- data pro mapu: body, výkres, poloha, trasa, sloupky výšek ----------------------------
    function bodyGeo() {
        var f = [], cil = cilId();
        try {
            (typeof arPoints !== 'undefined' ? arPoints : []).forEach(function (p) {
                if (!p || p.hidden || typeof p.lat !== 'number') return;
                f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { name: String(p.name || ''), barva: barvaBodu(p), cat: p.cat || '', vyska: p.vyska != null ? +p.vyska : null, id: p.id, cil: p.id === cil ? 1 : 0, vybrany: _vybrany && p.id === _vybrany.id ? 1 : 0 } });
            });
        } catch (e) { swallow(e, 'body'); }
        return { type: 'FeatureCollection', features: f };
    }
    // sloupek = čtvereček 0,6 m kolem bodu vytažený o (výška bodu − terén DMR)
    function sloupkyGeo() {
        var f = [];
        try {
            (typeof arPoints !== 'undefined' ? arPoints : []).forEach(function (p) {
                if (!p || p.hidden || typeof p.lat !== 'number' || p.vyska == null) return;
                var t = _dmr[p.id]; if (t == null || !isFinite(t)) return;
                var dz = +p.vyska - t; if (dz < 0.4) return;
                var m = mPerDeg(p.lat), r = 0.3 / m.lat, rl = 0.3 / m.lng;
                f.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[p.lng - rl, p.lat - r], [p.lng + rl, p.lat - r], [p.lng + rl, p.lat + r], [p.lng - rl, p.lat + r], [p.lng - rl, p.lat - r]]] }, properties: { h: Math.min(dz, 80), barva: barvaBodu(p), name: String(p.name || ''), id: p.id, popis: '+' + dz.toFixed(1).replace('.', ',') + ' m' } });
            });
        } catch (e) { swallow(e, 'sloupky'); }
        return { type: 'FeatureCollection', features: f };
    }
    // výšky terénu ČÚZK DMR 5G pro body v dosahu (jednou, cache po id; mimo ČR nic)
    function dotahniDmr() {
        if (typeof window.terrainElevAsync !== 'function') return;
        try {
            var me = poloha() || (m3 && { lat: m3.getCenter().lat, lng: m3.getCenter().lng }); if (!me) return;
            var kand = (typeof arPoints !== 'undefined' ? arPoints : []).filter(function (p) { return p && !p.hidden && typeof p.lat === 'number' && p.vyska != null && !(p.id in _dmr) && GeoCore.getDistance(me.lat, me.lng, p.lat, p.lng) < 400; }).slice(0, 40);
            if (!kand.length) return;
            kand.forEach(function (p) { _dmr[p.id] = null; });
            Promise.all(kand.map(function (p) { return window.terrainElevAsync(p.lat, p.lng).then(function (v) { _dmr[p.id] = (v != null && isFinite(v)) ? v : NaN; }).catch(function () { _dmr[p.id] = NaN; }); }))
                .then(function () { try { if (m3 && m3.getSource('sloupky')) m3.getSource('sloupky').setData(sloupkyGeo()); } catch (e) { swallow(e, 'dmr-set'); } });
        } catch (e) { swallow(e, 'dmr'); }
    }
    function vykresGeo() {
        var f = [];
        try {
            var d = window.AGProjektDxf && AGProjektDxf.design();
            if (d && d.polys) d.polys.forEach(function (p) {
                if (d.layers[p.layer] && d.layers[p.layer].on === false) return;
                f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: p.pts.map(function (q) { return [q.lng, q.lat]; }) }, properties: { vrstva: p.layer, barva: AGProjektDxf.barvaVrstvy(p.layer, p.aci), osa: d.osa === p.layer ? 1 : 0 } });
            });
            if (d && d.points) d.points.forEach(function (q) { if (d.layers[q.layer] && d.layers[q.layer].on === false) return; f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [q.lng, q.lat] }, properties: { vrstva: q.layer, barva: AGProjektDxf.barvaVrstvy(q.layer, null), jmeno: q.name } }); });
        } catch (e) { swallow(e, 'vykres'); }
        return { type: 'FeatureCollection', features: f };
    }
    function polohaGeo() { var p = poloha(); return { type: 'FeatureCollection', features: p ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { h: heading() } }] : [] }; }
    function trasaGeo() {
        var f = [];
        try {
            var t = window.AGTrasa && AGTrasa.aktivni() && AGTrasa.trasa();
            if (t && t.body && t.body.length > 1) {
                f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.body.map(function (q) { return [q.lng, q.lat]; }) }, properties: { druh: 'trasa' } });
                t.body.slice(1, -1).forEach(function (q) { f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [q.lng, q.lat] }, properties: { druh: 'lom' } }); });
            } else {
                var me = poloha(), id = cilId(), c = id && (arPoints || []).find(function (p) { return p.id === id; });
                if (me && c) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[me.lng, me.lat], [c.lng, c.lat]] }, properties: { druh: 'primka' } });
            }
        } catch (e) { swallow(e, 'trasa'); }
        return { type: 'FeatureCollection', features: f };
    }
    // (chodníky se od v349 kreslí přímo ze zdroje 'pm' jako čáry v metrech — viz styl(); tohle zůstává
    // jen kvůli starému API)
    function chodnikyGeo() { return { type: 'FeatureCollection', features: [] }; }

    // ---- styl: podklad + 3D budovy + terén + naše vrstvy -----------------------------------
    function styl() {
        // 3D jde podle MOTIVU APPKY (tmavý = noc, světlý = den), ne podle ručně zvoleného stylu 2D mapy —
        // uživatel 18. 9. 2026: „i když mám motiv tmavý, 3D se zobrazuje světlé" (měl u mapy styl Den).
        // Výjimka: modrotisk a tisk jsou záměrné „papírové" pohledy, ty se drží i ve 3D.
        var v = (window.AGMapaVektor && AGMapaVektor.varianta()) || 'den';
        try { if (v !== 'modrotisk' && v !== 'tisk') { var b = document.body.classList; v = b.contains('theme-blueprint') ? 'modrotisk' : (b.contains('light-mode') && !b.contains('theme-night')) ? 'den' : 'noc'; } } catch (e) { /* nechat */ }
        var S = AGMapaStyl.vytvor(v, AGMapaVektor.url());
        var P = AGMapaStyl.PALETY[v] || AGMapaStyl.PALETY.den;
        var svetly = v === 'den' || v === 'tisk';
        S.sources.body = { type: 'geojson', data: bodyGeo() };
        S.sources.sloupky = { type: 'geojson', data: sloupkyGeo() };
        S.sources.vykres = { type: 'geojson', data: vykresGeo() };
        S.sources.ja = { type: 'geojson', data: polohaGeo() };
        S.sources.trasa = { type: 'geojson', data: trasaGeo() };
        if (st.globus) S.projection = { type: ['interpolate', ['linear'], ['zoom'], 12, 'vertical-perspective', 14, 'mercator'] };
        // Obloha: kolem koule modravý lem atmosféry (MapLibre `sky.atmosphere-blend`, drží do z12, kde
        // koule přechází v placku), v naklopené placce nad obzorem nebe v barvě motivu (dřív tam byla
        // jen holá barva pozadí). Vesmír za koulí kreslí vlastní canvas — viz vesmir() níž.
        S.sky = { 'sky-color': svetly ? '#8fc4f4' : '#0b1220', 'horizon-color': svetly ? '#e6f0fa' : '#233150', 'fog-color': svetly ? '#e6f0fa' : '#233150',
            'fog-ground-blend': 0.92, 'horizon-fog-blend': 0.85, 'sky-horizon-blend': 0.7,
            'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0] };
        if (st.teren) {
            S.sources.teren = { type: 'raster-dem', tiles: [TEREN_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terén: Mapzen/AWS' };
            S.terrain = { source: 'teren', exaggeration: 1.0 };
            S.layers.push({ id: 'stin', type: 'hillshade', source: 'teren', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': v === 'noc' ? '#000' : '#5a5245' } });
        }
        // 2D výplň budov nahradí extruze (výška z OSM, jinak odhad); hrana zůstává
        var iBud = S.layers.findIndex(function (l) { return l.id === 'budovy'; });
        var extruze = { id: 'budovy-3d', type: 'fill-extrusion', source: 'pm', 'source-layer': 'buildings', minzoom: 13,
            paint: { 'fill-extrusion-color': v === 'modrotisk' ? '#1d4a8f' : (v === 'tisk' ? '#cfcfcf' : P.budova), 'fill-extrusion-opacity': 0.9,
                'fill-extrusion-height': ['coalesce', ['get', 'height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0], 'fill-extrusion-vertical-gradient': true } };
        if (iBud >= 0) S.layers.splice(iBud, 1, extruze); else S.layers.push(extruze);
        // zeleň: les 12 m, křoví 2,5 m — poloprůhledně, ať pod tím zůstane vidět terén i body
        // zeleň je v datech ve DVOU vrstvách: landcover (les, křoví) i landuse (les, sad, park se stromy);
        // v348 se brala jen landcover → „stromy nikde nevidím" (uživatel 17. 9. 2026)
        if (st.zelen) {
            var lesK = ['forest', 'wood', 'orchard', 'nature_reserve'], kroviK = ['scrub', 'heath', 'allotments', 'vineyard'];
            S.layers.splice(iBud >= 0 ? iBud : S.layers.length, 0,
                { id: 'zelen-les', type: 'fill-extrusion', source: 'pm', 'source-layer': 'landcover', minzoom: 11, filter: ['in', ['get', 'kind'], ['literal', lesK]], paint: { 'fill-extrusion-color': svetly ? '#4f8a3e' : '#2f5a2c', 'fill-extrusion-opacity': 0.5, 'fill-extrusion-height': 12, 'fill-extrusion-vertical-gradient': true } },
                { id: 'zelen-les-uziti', type: 'fill-extrusion', source: 'pm', 'source-layer': 'landuse', minzoom: 11, filter: ['in', ['get', 'kind'], ['literal', lesK]], paint: { 'fill-extrusion-color': svetly ? '#4f8a3e' : '#2f5a2c', 'fill-extrusion-opacity': 0.5, 'fill-extrusion-height': 12, 'fill-extrusion-vertical-gradient': true } },
                { id: 'zelen-krovi', type: 'fill-extrusion', source: 'pm', 'source-layer': 'landcover', minzoom: 11, filter: ['in', ['get', 'kind'], ['literal', kroviK]], paint: { 'fill-extrusion-color': svetly ? '#7fa85a' : '#42633a', 'fill-extrusion-opacity': 0.5, 'fill-extrusion-height': 2.5 } },
                { id: 'zelen-krovi-uziti', type: 'fill-extrusion', source: 'pm', 'source-layer': 'landuse', minzoom: 11, filter: ['in', ['get', 'kind'], ['literal', kroviK]], paint: { 'fill-extrusion-color': svetly ? '#7fa85a' : '#42633a', 'fill-extrusion-opacity': 0.5, 'fill-extrusion-height': 2.5 } });
        }
        S.layers.push(
            // chodníky: tmavá obruba (širší čára) + světlá deska (užší) v metrech, na terénu, kulaté spoje
            { id: 'chodniky-obruba', type: 'line', source: 'pm', 'source-layer': 'roads', minzoom: 15, filter: ['all', ['==', ['get', 'kind'], 'path'], ['in', ['get', 'kind_detail'], ['literal', Object.keys(CHODNIK)]]], layout: { 'line-cap': 'round', 'line-join': 'round', 'visibility': st.chodniky ? 'visible' : 'none' }, paint: { 'line-color': svetly ? '#8a8378' : '#2b3230', 'line-width': metry(['+', SIRKA_CHODNIKU, 0.6]) } },
            { id: 'chodniky', type: 'line', source: 'pm', 'source-layer': 'roads', minzoom: 15, filter: ['all', ['==', ['get', 'kind'], 'path'], ['in', ['get', 'kind_detail'], ['literal', Object.keys(CHODNIK)]]], layout: { 'line-cap': 'round', 'line-join': 'round', 'visibility': st.chodniky ? 'visible' : 'none' }, paint: { 'line-color': svetly ? '#f4efe2' : '#6a726e', 'line-width': metry(SIRKA_CHODNIKU), 'line-opacity': 0.95 } },
            { id: 'trasa-cara', type: 'line', source: 'trasa', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fbbf24', 'line-width': 5, 'line-opacity': 0.95 } },
            { id: 'trasa-lomy', type: 'circle', source: 'trasa', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#1b2420', 'circle-stroke-color': '#fbbf24', 'circle-stroke-width': 2 } },
            { id: 'vykres-cary', type: 'line', source: 'vykres', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'barva'], 'line-width': ['case', ['==', ['get', 'osa'], 1], 5, 3] } },
            { id: 'vykres-body', type: 'circle', source: 'vykres', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': ['get', 'barva'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
            { id: 'sloupky-3d', type: 'fill-extrusion', source: 'sloupky', paint: { 'fill-extrusion-color': ['get', 'barva'], 'fill-extrusion-opacity': 0.9, 'fill-extrusion-height': ['get', 'h'] } },
            { id: 'sloupky-popis', type: 'symbol', source: 'sloupky', minzoom: 16, layout: { 'text-field': ['get', 'popis'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, -1.2], 'text-anchor': 'bottom', 'text-allow-overlap': true }, paint: { 'text-color': P.text, 'text-halo-color': P.textHalo, 'text-halo-width': 1.5 } },
            { id: 'body-kruh', type: 'circle', source: 'body', paint: { 'circle-radius': ['case', ['==', ['get', 'cil'], 1], 9, ['==', ['get', 'vybrany'], 1], 8, 6], 'circle-color': ['get', 'barva'], 'circle-stroke-color': ['case', ['==', ['get', 'cil'], 1], '#fbbf24', ['==', ['get', 'vybrany'], 1], '#22d3ee', '#ffffff'], 'circle-stroke-width': ['case', ['==', ['get', 'cil'], 1], 4, ['==', ['get', 'vybrany'], 1], 3, 2] } },
            { id: 'body-jmena', type: 'symbol', source: 'body', minzoom: 15, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-allow-overlap': false }, paint: { 'text-color': P.text, 'text-halo-color': P.textHalo, 'text-halo-width': 1.5 } },
            { id: 'ja-kruh', type: 'circle', source: 'ja', paint: { 'circle-radius': 9, 'circle-color': '#22d3ee', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } }
        );
        return S;
    }

    // ---- VESMÍR ZA GLÓBEM (19. 9. 2026, přání uživatele: „při oddálení globu vesmír, měsíc atd.") ----
    // MapLibre kreslí mimo kouli průhledně, takže POD mapou leží vlastní canvas: hvězdy a SOUHVĚZDÍ na skutečné
    // nebeské sféře (pevný seed drobných hvězd — žádné blikání), pás Mléčné dráhy po galaktické rovině a od 19. 9. 2026
    // odpoledne i SLUNCE, MĚSÍC (skutečná fáze, osvětlená strana ke Slunci) A PĚT PLANET na skutečných místech
    // (efemeridy()) — tak, jak by je viděl pozorovatel z vesmíru za Zemí. Slunce za zády pozorovatele (na denní
    // straně) je jen záře od kraje ve směru, kde je. Canvas je čtverec přes úhlopříčku obrazovky a otáčí se
    // s bearingem mapy (jen CSS transform). Překresluje se jen při pohybu glóbu (1× za snímek, předpočítaný
    // katalog) a 1× za 5 min, jinak nic neanimuje — baterie. Od z≈12 nahoru se schová (tam je stejně placka
    // přes celou obrazovku); v mercatoru se o nebe nad obzorem stará MapLibre (S.sky ve styl()).
    var VESMIR_SEED = 20260919;
    function faze(d) {   // fáze Měsíce 0 = nov, 0,25 = první čtvrt, 0,5 = úplněk (nov 6. 1. 2000 18:14 UTC, synodický měsíc 29,530589 d)
        var dny = ((d || new Date()).getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5;
        return ((dny / 29.530588853) % 1 + 1) % 1;
    }
    function nahoda(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    // Měsíc: c = cos(elongace) (+1 nov … 0 čtvrt … −1 úplněk); osvětlená strana míří ke Slunci (uhel = směr ke Slunci na obrazovce)
    function mesic(ctx, x, y, R, c, uhel) {
        var g = ctx.createRadialGradient(x, y, R * 0.9, x, y, R * 2.4); g.addColorStop(0, 'rgba(214,224,255,.16)'); g.addColorStop(1, 'rgba(214,224,255,0)');
        ctx.fillStyle = g; ctx.fillRect(x - R * 2.4, y - R * 2.4, R * 4.8, R * 4.8);
        ctx.save(); ctx.translate(x, y); ctx.rotate(uhel || 0);
        ctx.beginPath(); ctx.arc(0, 0, R, 0, 2 * Math.PI); ctx.fillStyle = '#1a1d29'; ctx.fill();   // neosvětlená část (popelavý svit)
        ctx.beginPath(); ctx.arc(0, 0, R, 0, 2 * Math.PI); ctx.clip();
        ctx.beginPath();   // osvětlená část = půlkruh na svítící straně (+x) + elipsa terminátoru (srpek: vyboulená ke svítící straně, vypouklý: od ní)
        ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false); ctx.ellipse(0, 0, R * Math.abs(c), R, 0, Math.PI / 2, -Math.PI / 2, c > 0);
        ctx.closePath();
        var lg = ctx.createLinearGradient(-R, -R, R, R); lg.addColorStop(0, '#f2f3f6'); lg.addColorStop(1, '#c9ccd6');
        ctx.fillStyle = lg; ctx.fill();
        ctx.clip();   // krátery jen na osvětlené části
        var r = nahoda(VESMIR_SEED + 7);
        for (var i = 0; i < 9; i++) { var a = r() * 2 * Math.PI, d = r() * R * 0.8, kr = R * (0.06 + r() * 0.13); ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, kr, 0, 2 * Math.PI); ctx.fillStyle = 'rgba(120,126,145,' + (0.18 + r() * 0.2).toFixed(2) + ')'; ctx.fill(); }
        ctx.restore();
    }
    // SOUHVĚZDÍ (19. 9. 2026, přání uživatele: „souhvězdí za glóbem, jen design, nikoliv využití"). Leží na
    // SKUTEČNÉ nebeské sféře: střed pohledu = bod oblohy „za Zemí" (deklinace −lat, rektascenze = hvězdný čas
    // antipodu), promítnutý stereograficky; při posunu glóbu se obloha posune, při otočení se otočí. Sever
    // nahoře = nebeský sever nahoře. Z Evropy jsou tedy kolem koule vidět JIŽNÍ souhvězdí (Crux, Scorpius,
    // Canis Major…) — tak by to viděl někdo, kdo se dívá na Zemi z vesmíru. Jména latinsky (mezinárodní,
    // bez překladu). Jasné hvězdy J2000 [RA°, Dec°]; čáry = dvojice indexů.
    var SOUHVEZDI = [
        ['Ursa Major', [[165.93, 61.75], [165.46, 56.38], [178.46, 53.69], [183.86, 57.03], [193.51, 55.96], [200.98, 54.93], [206.89, 49.31]], [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]]],
        ['Ursa Minor', [[37.95, 89.26], [263.05, 86.59], [251.49, 82.04], [236.01, 77.79], [222.68, 74.16], [230.18, 71.83], [244.37, 75.76]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]]],
        ['Cassiopeia', [[2.29, 59.15], [10.13, 56.54], [14.18, 60.72], [21.45, 60.24], [28.60, 63.67]], [[0, 1], [1, 2], [2, 3], [3, 4]]],
        ['Cepheus', [[319.64, 62.59], [322.16, 70.56], [354.84, 77.63], [342.42, 66.20], [332.71, 58.20]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]],
        ['Orion', [[88.79, 7.41], [81.28, 6.35], [83.00, -0.30], [84.05, -1.20], [85.19, -1.94], [86.94, -9.67], [78.63, -8.20]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [4, 5], [5, 6], [6, 2]]],
        ['Cygnus', [[310.36, 45.28], [305.56, 40.26], [311.55, 33.97], [296.24, 45.13], [292.68, 27.96]], [[0, 1], [1, 4], [3, 1], [1, 2]]],
        ['Lyra', [[279.23, 38.78], [281.19, 37.61], [282.52, 33.36], [284.74, 32.69], [283.63, 36.90]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]]],
        ['Aquila', [[297.70, 8.87], [296.56, 10.61], [298.83, 6.41], [291.37, 3.11], [286.35, 13.86], [286.56, -4.88], [302.83, -0.82]], [[1, 0], [0, 2], [0, 3], [3, 4], [3, 5], [2, 6]]],
        ['Leo', [[152.09, 11.97], [151.83, 16.76], [154.99, 19.84], [154.17, 23.42], [146.46, 23.77], [168.53, 20.52], [177.26, 14.57], [168.56, 15.43]], [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [5, 6], [6, 7], [7, 0], [5, 7]]],
        ['Boötes', [[213.92, 19.18], [221.25, 27.07], [228.88, 33.31], [225.49, 40.39], [218.02, 38.31], [217.96, 30.37], [208.67, 18.40]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6]]],
        ['Gemini', [[113.65, 31.89], [116.33, 28.03], [110.03, 21.98], [99.43, 16.40], [100.98, 25.13], [95.74, 22.51]], [[1, 2], [2, 3], [0, 4], [4, 5]]],
        ['Taurus', [[68.98, 16.51], [81.57, 28.61], [84.41, 21.14], [64.95, 15.63], [65.73, 17.54], [67.15, 19.18], [67.17, 15.87], [60.17, 12.49]], [[1, 5], [5, 4], [4, 3], [3, 6], [6, 0], [0, 2], [3, 7]]],
        ['Canis Major', [[101.29, -16.72], [95.67, -17.96], [104.66, -28.97], [107.10, -26.39], [111.02, -29.30]], [[0, 1], [0, 3], [3, 2], [3, 4]]],
        ['Scorpius', [[247.35, -26.43], [240.08, -22.62], [241.36, -19.81], [239.71, -26.11], [245.30, -25.59], [248.97, -28.22], [252.54, -34.29], [252.97, -38.05], [253.65, -42.36], [258.04, -43.24], [264.33, -43.00], [265.62, -39.03], [263.40, -37.10]], [[2, 1], [1, 3], [1, 4], [4, 0], [0, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12]]],
        ['Crux', [[186.65, -63.10], [191.93, -59.69], [187.79, -57.11], [183.79, -58.75]], [[0, 2], [1, 3]]],
        ['Pegasus', [[346.19, 15.21], [345.94, 28.08], [3.31, 15.18], [2.10, 29.09], [326.05, 9.88]], [[0, 1], [1, 3], [3, 2], [2, 0], [0, 4]]],
        ['Andromeda', [[2.10, 29.09], [17.43, 35.62], [30.97, 42.33]], [[0, 1], [1, 2]]]
    ];
    function gmst(d) { var dny = (d.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5; return ((280.46061837 + 360.98564736629 * dny) % 360 + 360) % 360; }
    // promítání: [RA, Dec] → {x, y (jednotková rovina obrazovky: x = východ, y = sever), z (>0 = za Zemí)}
    function obloha(lat0, lng0, d) {
        var R = Math.PI / 180, th = (lng0 + gmst(d)) * R, la = lat0 * R;
        var r = [Math.cos(la) * Math.cos(th), Math.cos(la) * Math.sin(th), Math.sin(la)];
        var e = [-Math.sin(th), Math.cos(th), 0];
        var n = [-Math.sin(la) * Math.cos(th), -Math.sin(la) * Math.sin(th), Math.cos(la)];
        var f = function (ra, dec) {
            var a = ra * R, dl = dec * R, s = [Math.cos(dl) * Math.cos(a), Math.cos(dl) * Math.sin(a), Math.sin(dl)];
            return f.v(s);
        };
        f.v = function (s) { return { x: s[0] * e[0] + s[1] * e[1] + s[2] * e[2], y: s[0] * n[0] + s[1] * n[1] + s[2] * n[2], z: -(s[0] * r[0] + s[1] * r[1] + s[2] * r[2]) }; };
        return f;
    }
    // galaktická rovina (Mléčná dráha): pól J2000 RA 192,86° Dec 27,13°, střed RA 266,40° Dec −28,94°
    function galakticky(l, b) {
        var R = Math.PI / 180, p = [Math.cos(27.13 * R) * Math.cos(192.86 * R), Math.cos(27.13 * R) * Math.sin(192.86 * R), Math.sin(27.13 * R)];
        var c = [Math.cos(-28.94 * R) * Math.cos(266.40 * R), Math.cos(-28.94 * R) * Math.sin(266.40 * R), Math.sin(-28.94 * R)];
        var cp = c[0] * p[0] + c[1] * p[1] + c[2] * p[2]; c = [c[0] - cp * p[0], c[1] - cp * p[1], c[2] - cp * p[2]];
        var cl = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]); c = [c[0] / cl, c[1] / cl, c[2] / cl];
        var q = [p[1] * c[2] - p[2] * c[1], p[2] * c[0] - p[0] * c[2], p[0] * c[1] - p[1] * c[0]];
        var L = l * R, B = b * R, v = [], i;
        for (i = 0; i < 3; i++) v[i] = Math.cos(B) * (Math.cos(L) * c[i] + Math.sin(L) * q[i]) + Math.sin(B) * p[i];
        return [Math.atan2(v[1], v[0]) / R, Math.asin(Math.max(-1, Math.min(1, v[2]))) / R];
    }
    function vektor(ra, dec) { var R = Math.PI / 180, a = ra * R, dl = dec * R; return [Math.cos(dl) * Math.cos(a), Math.cos(dl) * Math.sin(a), Math.sin(dl)]; }
    // SLUNCE, MĚSÍC A PLANETY (19. 9. 2026, přání: „nejsou tam vidět planety a měsíc a slunce") — nízkopřesné
    // efemeridy (Schlyter: Keplerovy prvky k epoše 31. 12. 1999 0:00 UTC + hlavní poruchy Měsíce), chyba
    // do ~1°, což je na dekoraci za koulí přesně dost. Geocentrické = přesně to, co vidí pozorovatel z vesmíru
    // za Zemí. Vrací {slunce, mesic (c = cos elongace), planety[]} jako [RA°, Dec°].
    var PLANETY = [
        ['Mercurius', [48.3313, 3.24587e-5], [7.0047, 5.00e-8], [29.1241, 1.01444e-5], 0.387098, [0.205635, 5.59e-10], [168.6562, 4.0923344368], '#d9d2c5', 1.4],
        ['Venus', [76.6799, 2.46590e-5], [3.3946, 2.75e-8], [54.8910, 1.38374e-5], 0.723330, [0.006773, -1.302e-9], [48.0052, 1.6021302244], '#fff3d6', 2.6],
        ['Mars', [49.5574, 2.11081e-5], [1.8497, -1.78e-8], [286.5016, 2.92961e-5], 1.523688, [0.093405, 2.516e-9], [18.6021, 0.5240207766], '#ff9a6b', 1.8],
        ['Jupiter', [100.4542, 2.76854e-5], [1.3030, -1.557e-7], [273.8777, 1.64505e-5], 5.20256, [0.048498, 4.469e-9], [19.8950, 0.0830853001], '#f3e6c8', 2.3],
        ['Saturnus', [113.6634, 2.38980e-5], [2.4886, -1.081e-7], [339.3939, 2.97661e-5], 9.55475, [0.055546, -9.499e-9], [316.9670, 0.0334442282], '#f0dfb0', 1.9]
    ];
    function efemeridy(date) {
        var R = Math.PI / 180, d = ((date || new Date()).getTime() - Date.UTC(1999, 11, 31)) / 864e5, ecl = (23.4393 - 3.563e-7 * d) * R;
        function drah(N, i, w, a, e, M) {   // Keplerova dráha → heliocentrické ekliptikální [x, y, z] (a = 1 pro Slunce → jednotkový)
            N *= R; i *= R; w *= R; M = ((M % 360) + 360) % 360 * R;
            var E = M + e * Math.sin(M) * (1 + e * Math.cos(M)), k;
            for (k = 0; k < 5; k++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
            var xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E), v = Math.atan2(yv, xv), r = Math.sqrt(xv * xv + yv * yv), vw = v + w;
            return [r * (Math.cos(N) * Math.cos(vw) - Math.sin(N) * Math.sin(vw) * Math.cos(i)), r * (Math.sin(N) * Math.cos(vw) + Math.cos(N) * Math.sin(vw) * Math.cos(i)), r * Math.sin(vw) * Math.sin(i), v / R, r];
        }
        function rovnik(x, y, z) {   // ekliptikální → rovníkové [RA°, Dec°]
            var ye = y * Math.cos(ecl) - z * Math.sin(ecl), ze = y * Math.sin(ecl) + z * Math.cos(ecl);
            return [((Math.atan2(ye, x) / R) + 360) % 360, Math.atan2(ze, Math.sqrt(x * x + ye * ye)) / R];
        }
        // Slunce (geocentricky = dráha Země obráceně)
        var ws = 282.9404 + 4.70935e-5 * d, es = 0.016709 - 1.151e-9 * d, Ms = 356.0470 + 0.9856002585 * d;
        var S = drah(0, 0, ws, 1, es, Ms), sl = rovnik(S[0], S[1], 0);
        // Měsíc (geocentricky, hlavní poruchy)
        var Nm = 125.1228 - 0.0529538083 * d, wm = 318.0634 + 0.1643573223 * d, Mm = 115.3654 + 13.0649929509 * d;
        var Mo = drah(Nm, 5.1454, wm, 60.2666, 0.054900, Mm);
        var lon = Math.atan2(Mo[1], Mo[0]) / R, lat = Math.atan2(Mo[2], Math.sqrt(Mo[0] * Mo[0] + Mo[1] * Mo[1])) / R;
        var Lm = Nm + wm + Mm, Ls = ws + Ms, D = (Lm - Ls) * R, F = (Lm - Nm) * R, mm = Mm * R, ms = Ms * R;
        lon += -1.274 * Math.sin(mm - 2 * D) + 0.658 * Math.sin(2 * D) - 0.186 * Math.sin(ms) - 0.059 * Math.sin(2 * mm - 2 * D) - 0.057 * Math.sin(mm - 2 * D + ms)
            + 0.053 * Math.sin(mm + 2 * D) + 0.046 * Math.sin(2 * D - ms) + 0.041 * Math.sin(mm - ms) - 0.035 * Math.sin(D) - 0.031 * Math.sin(mm + ms) - 0.015 * Math.sin(2 * F - 2 * D) + 0.011 * Math.sin(mm - 4 * D);
        lat += -0.173 * Math.sin(F - 2 * D) - 0.055 * Math.sin(mm - F - 2 * D) - 0.046 * Math.sin(mm + F - 2 * D) + 0.033 * Math.sin(F + 2 * D) + 0.017 * Math.sin(2 * mm + F);
        var me = rovnik(Math.cos(lat * R) * Math.cos(lon * R), Math.cos(lat * R) * Math.sin(lon * R), Math.sin(lat * R));
        var vs = vektor(sl[0], sl[1]), vm = vektor(me[0], me[1]), c = vs[0] * vm[0] + vs[1] * vm[1] + vs[2] * vm[2];
        // planety: heliocentrická dráha + Slunce → geocentrická
        var pl = PLANETY.map(function (p) {
            var h = drah(p[1][0] + p[1][1] * d, p[2][0] + p[2][1] * d, p[3][0] + p[3][1] * d, p[4], p[5][0] + p[5][1] * d, p[6][0] + p[6][1] * d);
            var g = rovnik(h[0] + S[0], h[1] + S[1], h[2]);
            return { jm: p[0], ra: g[0], dec: g[1], barva: p[7], vel: p[8] };
        });
        return { slunce: { ra: sl[0], dec: sl[1] }, mesic: { ra: me[0], dec: me[1], c: c, osvetleno: (1 - c) / 2 }, planety: pl };
    }
    // katalog drobných hvězd se počítá JEDNOU (jednotkové vektory, velikost, barva) — při kreslení už se jen promítá
    var _hvezdy = null;
    function katalog() {
        if (_hvezdy) return _hvezdy;
        var r = nahoda(VESMIR_SEED), i, g, v = [];
        for (i = 0; i < 1400; i++) { g = galakticky(r() * 360, (r() + r() + r() - 1.5) * 9); v.push({ v: vektor(g[0], g[1]), vel: 0, barva: 'rgba(210,220,255,' + (0.15 + r() * 0.35).toFixed(2) + ')' }); }
        for (i = 0; i < 1800; i++) {
            var vel = 0.4 + Math.pow(r(), 3) * 1.6, jas = 0.35 + r() * 0.65, tn = r();
            v.push({ v: vektor(r() * 360, Math.asin(2 * r() - 1) * 180 / Math.PI), vel: vel, barva: tn < 0.12 ? 'rgba(170,200,255,' + jas.toFixed(2) + ')' : tn < 0.2 ? 'rgba(255,230,190,' + jas.toFixed(2) + ')' : 'rgba(255,255,255,' + jas.toFixed(2) + ')' });
        }
        var md = [];
        for (i = 0; i < 360; i += 5) { g = galakticky(i, 0); md.push(vektor(g[0], g[1])); }
        _hvezdy = { hv: v, md: md };
        return _hvezdy;
    }
    var _bg = null;   // pozadí (gradient) + skvrna Mléčné dráhy, předkreslené pro danou velikost
    function pozadi(side, dpr) {
        if (_bg && _bg.side === side && _bg.dpr === dpr) return _bg;
        var cv = document.createElement('canvas'); cv.width = cv.height = Math.round(side * dpr);
        var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var bg = ctx.createRadialGradient(side / 2, side / 2, 0, side / 2, side / 2, side * 0.7); bg.addColorStop(0, '#0a0e1c'); bg.addColorStop(1, '#03040a');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, side, side);
        var sk = document.createElement('canvas'), n = 128; sk.width = sk.height = n;
        var c2 = sk.getContext('2d'), mg = c2.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); mg.addColorStop(0, 'rgba(160,175,220,.07)'); mg.addColorStop(1, 'rgba(160,175,220,0)');
        c2.fillStyle = mg; c2.fillRect(0, 0, n, n);
        _bg = { side: side, dpr: dpr, cv: cv, skvrna: sk };
        return _bg;
    }
    function kresliVesmir(cv, w, h, stred, bearing) {
        var side = Math.ceil(Math.sqrt(w * w + h * h)), dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (cv.width !== Math.round(side * dpr)) { cv.width = Math.round(side * dpr); cv.height = cv.width; cv.style.width = cv.style.height = side + 'px'; }
        var ctx = cv.getContext('2d'); if (!ctx) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var cx = side / 2, cy = side / 2, K = side * 0.28, ted = new Date();   // K: šířka záběru (0,28 → na telefonu na výšku je vidět ±74° od protilehlého bodu)
        var P = obloha(stred ? stred.lat : 50, stred ? stred.lng : 15, ted), kat = katalog(), bg = pozadi(side, dpr);
        function bodV(s) { var q = P.v(s); if (q.z < -0.55) return null; var k = K / (1 + q.z); return { x: cx + q.x * k, y: cy - q.y * k, z: q.z }; }
        function bod(ra, dec) { return bodV(vektor(ra, dec)); }
        ctx.drawImage(bg.cv, 0, 0, side, side);
        // Mléčná dráha: měkká záře podél galaktické roviny (předkreslená skvrna) + hustší drobné hvězdy v pásu ±10°
        var i, q, sz = side * 0.18;
        for (i = 0; i < kat.md.length; i++) { q = bodV(kat.md[i]); if (q) ctx.drawImage(bg.skvrna, q.x - sz / 2, q.y - sz / 2, sz, sz); }
        // hvězdy: drobné jako pixel, větší jako kolečko, nejjasnější s křížkem paprsků
        for (i = 0; i < kat.hv.length; i++) {
            var hv = kat.hv[i]; q = bodV(hv.v); if (!q) continue;
            ctx.fillStyle = hv.barva;
            if (hv.vel < 0.9) { ctx.fillRect(q.x, q.y, hv.vel ? 1.5 : 1, hv.vel ? 1.5 : 1); continue; }
            ctx.beginPath(); ctx.arc(q.x, q.y, hv.vel, 0, 2 * Math.PI); ctx.fill();
            if (hv.vel > 1.7) { ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(q.x - hv.vel * 3, q.y - 0.5, hv.vel * 6, 1); ctx.fillRect(q.x - 0.5, q.y - hv.vel * 3, 1, hv.vel * 6); }
        }
        // souhvězdí: tenké spojnice, jasnější hvězdy, latinské jméno u těžiště (jen když je většina vidět)
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(150,170,230,.38)'; ctx.font = '500 10px system-ui, sans-serif'; ctx.textAlign = 'center';
        SOUHVEZDI.forEach(function (s) {
            var pts = s[1].map(function (hv) { return bod(hv[0], hv[1]); }), vid = pts.filter(Boolean), sx = 0, sy = 0;
            if (vid.length < Math.ceil(s[1].length / 2)) return;
            ctx.beginPath(); s[2].forEach(function (ln) { var a = pts[ln[0]], b = pts[ln[1]]; if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } }); ctx.stroke();
            ctx.fillStyle = 'rgba(235,240,255,.95)';
            vid.forEach(function (p) { sx += p.x; sy += p.y; ctx.beginPath(); ctx.arc(p.x, p.y, 1.9, 0, 2 * Math.PI); ctx.fill(); });
            ctx.fillStyle = 'rgba(175,190,225,.6)'; ctx.fillText(s[0], sx / vid.length, sy / vid.length + 16);
        });
        // TĚLESA: Slunce, Měsíc a planety. Na telefonu na výšku je vidět jen úzký pás oblohy, takže těleso, které by
        // padlo mimo obrazovku (i za záda pozorovatele), se přitáhne ke KRAJI obrazovky ve směru, kde skutečně je —
        // stejný vzor jako „cíl mimo pásku" v AR. Popisky se píší vodorovně vůči OBRAZOVCE (canvas je otočený o −bearing).
        var ef = efemeridy(ted), rot = (bearing || 0) * Math.PI / 180, R0 = Math.max(14, Math.min(w, h) * 0.05), okraj = R0 + 22;
        function popis(txt, x, y, dy, barva) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = barva; ctx.font = '600 11px system-ui, sans-serif'; ctx.fillText(txt, 0, dy); ctx.restore(); }
        function teleso(s) {   // → {x, y, mimo} vždy (mimo = přitažené ke kraji)
            var q = P.v(s), dx, dy;
            if (q.z >= -0.55) { var k = K / (1 + q.z); dx = q.x * k; dy = -q.y * k; }
            else { var l = Math.sqrt(q.x * q.x + q.y * q.y) || 1; dx = q.x / l * side; dy = -q.y / l * side; if (l < 1e-6) { dx = 0; dy = -side; } }
            var ca = Math.cos(-rot), sa = Math.sin(-rot), sx = dx * ca - dy * sa, sy = dx * sa + dy * ca;   // do souřadnic obrazovky
            var W = w / 2 - okraj, H = h / 2 - okraj, f = Math.min(W / (Math.abs(sx) || 1e-9), H / (Math.abs(sy) || 1e-9)), mimo = f < 1;
            if (mimo) { sx *= f; sy *= f; dx = sx * ca + sy * sa; dy = -sx * sa + sy * ca; }
            return { x: cx + dx, y: cy + dy, mimo: mimo };
        }
        // planety: kolečko v barvě planety se slabou září + jméno (latinsky jako souhvězdí); u kraje = přitažené, poloprůhledné
        ef.planety.forEach(function (p) {
            var t = teleso(vektor(p.ra, p.dec)); ctx.globalAlpha = t.mimo ? 0.6 : 1;
            var g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, p.vel * 5); g.addColorStop(0, p.barva); g.addColorStop(0.35, p.barva); g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.globalAlpha *= 0.55; ctx.fillStyle = g; ctx.fillRect(t.x - p.vel * 5, t.y - p.vel * 5, p.vel * 10, p.vel * 10); ctx.globalAlpha = t.mimo ? 0.6 : 1;
            ctx.fillStyle = p.barva; ctx.beginPath(); ctx.arc(t.x, t.y, p.vel, 0, 2 * Math.PI); ctx.fill();
            if (p.jm === 'Saturnus') { ctx.strokeStyle = 'rgba(240,223,176,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(t.x, t.y, p.vel * 2.3, p.vel * 0.7, -0.45, 0, 2 * Math.PI); ctx.stroke(); }
            popis(p.jm, t.x, t.y, 16, 'rgba(235,225,200,.75)'); ctx.globalAlpha = 1;
        });
        // Měsíc: skutečná poloha a fáze podle elongace, osvětlená strana míří ke Slunci
        var sv = vektor(ef.slunce.ra, ef.slunce.dec), sq = P.v(sv), mv = vektor(ef.mesic.ra, ef.mesic.dec), mq = P.v(mv), mt = teleso(mv);
        var uhel = Math.atan2(-(sq.y - mq.y), sq.x - mq.x);
        ctx.globalAlpha = mt.mimo ? 0.75 : 1;
        mesic(ctx, mt.x, mt.y, R0 * 0.9, ef.mesic.c, uhel);
        popis('Luna', mt.x, mt.y, R0 * 0.9 + 15, 'rgba(214,224,255,.7)'); ctx.globalAlpha = 1;
        // Slunce: kotouč s korónou (u kraje = přitažené: „je tamhle, za tebou")
        var st2 = teleso(sv);
        var kr = ctx.createRadialGradient(st2.x, st2.y, R0 * 0.8, st2.x, st2.y, side * 0.42); kr.addColorStop(0, 'rgba(255,240,200,.55)'); kr.addColorStop(0.12, 'rgba(255,236,190,.16)'); kr.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.fillStyle = kr; ctx.fillRect(0, 0, side, side);
        var sg = ctx.createRadialGradient(st2.x, st2.y, 0, st2.x, st2.y, R0); sg.addColorStop(0, '#fffdf5'); sg.addColorStop(0.7, '#fff1c4'); sg.addColorStop(1, '#ffd479');
        ctx.globalAlpha = st2.mimo ? 0.85 : 1; ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(st2.x, st2.y, R0, 0, 2 * Math.PI); ctx.fill();
        popis('Sol', st2.x, st2.y, R0 + 15, 'rgba(255,240,200,.8)'); ctx.globalAlpha = 1;
    }
    function vesmir(m, el3) {
        if (!st.globus) return;
        var cv = document.createElement('canvas'); cv.id = 'ag3d-vesmir'; cv.setAttribute('aria-hidden', 'true');
        el3.insertBefore(cv, el3.firstChild);
        var _raf = 0, _tik = null;
        function kresli() { _raf = 0; try { var c = m.getCenter(); kresliVesmir(cv, el3.clientWidth || window.innerWidth, el3.clientHeight || window.innerHeight, { lat: c.lat, lng: c.lng }, m.getBearing()); } catch (e) { swallow(e, 'vesmir'); } }
        function stav() {
            try {
                var z = m.getZoom(), o = Math.max(0, Math.min(1, (13.5 - z) / 2));   // plně do z11,5, pryč od z13,5
                cv.style.opacity = o; cv.style.visibility = o > 0 ? 'visible' : 'hidden';
                cv.style.transform = 'translate(-50%,-50%) rotate(' + (-m.getBearing()).toFixed(1) + 'deg)';
            } catch (e) { /* nic */ }
        }
        // obloha se překresluje PŘI POHYBU (1× za snímek, jen když je vidět) — katalog hvězd je předpočítaný a pozadí
        // předkreslené, takže snímek stojí pár ms a hvězdy jedou s glóbem plynule (dřív poskočily až 300 ms po konci posunu)
        function naplanuj() { if (cv.style.visibility === 'hidden' || _raf) return; _raf = requestAnimationFrame(kresli); }
        kresli(); stav();
        m.on('zoom', stav); m.on('rotate', function () { stav(); naplanuj(); }); m.on('resize', function () { kresli(); stav(); });
        m.on('move', naplanuj); m.on('moveend', naplanuj);
        // hvězdný čas ujde za minutu 0,25° — jednou za 5 min tichý překres, ať Slunce a Měsíc nezamrznou
        _tik = setInterval(function () { if (!document.body.contains(cv)) { clearInterval(_tik); return; } naplanuj(); }, 300000);
        return cv;
    }

    // ---- okno ---------------------------------------------------------------------------------
    function html() {
        return '<div class="ag3d-top"><b>3D pohled</b><span id="ag3d-info"></span><button type="button" class="ag3d-x" id="ag3d-zavrit" aria-label="Zavřít">✕</button></div>'
            + '<div id="ag3d-mapa"></div>'
            + '<div class="ag3d-karta" id="ag3d-karta" hidden><div class="ag3d-karta-txt"><b id="ag3d-k-jmeno"></b><span id="ag3d-k-info"></span></div><div class="ag3d-karta-btns"><button type="button" id="ag3d-k-karta">Karta bodu</button><button type="button" id="ag3d-k-nav">Navigovat</button><button type="button" id="ag3d-k-x" aria-label="Zavřít">✕</button></div></div>'
            + '<div class="ag3d-bar">'
            + '<button type="button" id="ag3d-name"><svg class="icon"><use href="#i-crosshair"/></svg> Na mě</button>'
            + '<button type="button" id="ag3d-sever">Sever</button>'
            + '<button type="button" id="ag3d-pitch">2D / 3D</button>'
            + '<button type="button" id="ag3d-teren" class="' + (st.teren ? 'on' : '') + '">Terén</button>'
            + '<button type="button" id="ag3d-zelen" class="' + (st.zelen ? 'on' : '') + '">Zeleň</button>'
            + '<button type="button" id="ag3d-chodniky" class="' + (st.chodniky ? 'on' : '') + '">Chodníky</button>'
            + '</div><div class="ag3d-pozn">Dva prsty = otočit a naklopit. Klepni na bod, budovu nebo trasu. Oddálení = glóbus.</div>';
    }
    function info(t) { var i = document.getElementById('ag3d-info'); if (i) i.textContent = t || ''; }
    function karta(p) {
        var k = document.getElementById('ag3d-karta'); if (!k) return;
        _vybrany = p || null;
        if (!p) { k.hidden = true; obnovBody(); return; }
        var me = poloha(), d = me ? GeoCore.getDistance(me.lat, me.lng, p.lat, p.lng) : null, t = _dmr[p.id];
        document.getElementById('ag3d-k-jmeno').textContent = p.name;
        document.getElementById('ag3d-k-info').textContent = [p.druh || (p.cat === 'CUSTOM' ? 'vlastní bod' : p.cat), p.vyska != null ? 'H ' + (+p.vyska).toFixed(2) + ' m' + (t != null && isFinite(t) && (+p.vyska - t) >= 0.4 ? ' (' + (+p.vyska - t).toFixed(1).replace('.', ',') + ' m nad terénem)' : '') : null, d != null ? (d >= 1000 ? (d / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(d) + ' m') + ' ode mě' : null].filter(Boolean).join(' · ');
        var nav = document.getElementById('ag3d-k-nav'); nav.textContent = cilId() === p.id ? 'Zrušit navigaci' : 'Navigovat';
        k.hidden = false; obnovBody();
    }
    function obnovBody() { try { if (m3 && m3.getSource('body')) m3.getSource('body').setData(bodyGeo()); } catch (e) { swallow(e, 'body-set'); } }
    function naviguj(p) {
        try {
            if (cilId() === p.id) { highlightedPointId = null; }
            else {
                highlightedPointId = p.id;
                // stejná cesta jako z karty bodu: mapa a AR to vezmou samy (renderAR/cil-navigace)
                try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) { /* nic */ }
                try { if (window.AGTrasa) AGTrasa.prepocitej('3D'); } catch (e) { /* nic */ }
            }
            try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { /* nic */ }
        } catch (e) { swallow(e, 'naviguj'); }
        karta(p); obnovTrasu();
        info(cilId() === p.id ? 'Navigace na ' + p.name + ' — běží i po zavření (mapa, AR).' : 'Navigace zrušena.');
    }
    // klasická karta bodu (bottom sheet) vyjede NAD 3D — 3D zůstává (uživatel: „místo toho, aby se to
    // vysunulo jako klasicky v mapě, přepne to do 2D a problikne")
    function otevriKartu(b) {
        try { if (typeof showDetails === 'function') { var me = poloha(); showDetails(b, me ? GeoCore.getDistance(me.lat, me.lng, b.lat, b.lng) : 0); } } catch (e) { swallow(e, 'karta'); }
    }
    function obnovTrasu() { try { if (m3 && m3.getSource('trasa')) m3.getSource('trasa').setData(trasaGeo()); } catch (e) { swallow(e, 'trasa-set'); } }
    function obnovChodniky() { /* čáry ze zdroje pm — nic k obnově */ }
    function zavri() {
        try { if (_sleduj) { clearInterval(_sleduj); _sleduj = null; } } catch (e) { /* nic */ }
        try { if (m3) { m3.remove(); m3 = null; } } catch (e) { swallow(e, 'remove'); }
        _vybrany = null;
        try { document.body.classList.remove('ag-3d-open'); } catch (e) { /* nic */ }
        if (el) { el.style.display = 'none'; el.innerHTML = ''; }
    }
    function otevri(bod) {
        // Hlášky NEposílají uživatele do Nastavení — nabídnou rovnou akci (18. 9. 2026, N2).
        if (window.AGLite && AGLite.lite) {
            if (typeof window.agConfirm !== 'function' || !AGLite.nastav) { return alert('3D pohled není v režimu slabší telefon.'); }
            return agConfirm({ title: '3D pohled', message: 'V režimu slabší telefon není 3D pohled (potřebuje WebGL). Vypnout úsporný režim a otevřít 3D?', okText: 'Vypnout a otevřít', cancelText: 'Nechat' })
                .then(function (ano) { if (!ano) return; AGLite.nastav('off'); setTimeout(function () { if (!AGLite.lite) otevri(bod); }, 300); });
        }
        if (!window.AGMapaVektor || !window.AGMapaStyl) { return agAlert({ title: '3D pohled', message: 'Vektorová mapa se v této verzi nenačetla — zkus appku znovu otevřít (Nástroje → Funguje mi všechno?).' }); }
        var zap = AGMapaVektor.stav() === 'zapnuto' ? Promise.resolve(true) : AGMapaVektor.zapni();
        zap.then(function (ok) {
            if (!ok) { agAlert({ title: '3D pohled', message: 'Vektorová mapa se nezapnula: ' + (AGMapaVektor.chyba() || 'neznámá chyba') + '. Až bude signál, klepni na 3D znovu — mapa se zapne sama (ručně: Vrstvy → Podklad → Mapa).' }); return; }
            // stylopis si připojí sám (lazy-tools ho dává jen při otevření z dlaždice)
            if (!document.querySelector('link[href$="css/pohled-3d.css"]')) { var lk = document.createElement('link'); lk.rel = 'stylesheet'; lk.href = 'css/pohled-3d.css'; document.head.appendChild(lk); }
            if (!el) { el = document.createElement('div'); el.id = 'ag3d'; document.body.appendChild(el); }
            el.innerHTML = html(); el.style.display = 'block';
            try { document.body.classList.add('ag-3d-open'); } catch (e) { /* nic */ }
            var p = (bod && typeof bod.lat === 'number') ? bod : (poloha() || (function () { try { var c = map.getCenter(); return { lat: c.lat, lng: c.lng }; } catch (e) { return { lat: 49.8, lng: 15.5 }; } })());
            m3 = new maplibregl.Map({ container: 'ag3d-mapa', style: styl(), center: [p.lng, p.lat], zoom: 17.5, pitch: st.pitch, bearing: heading(), attributionControl: false, maxPitch: 75, antialias: false });
            m3.touchZoomRotate.enableRotation(); m3.dragRotate.enable();
            vesmir(m3, el);   // hvezdy + Mesic pod koulí (schované, dokud je mapa přiblížená)
            m3.on('error', function (ev) { swallow(ev && ev.error, 'maplibre'); });
            m3.on('click', function (ev) {
                try {
                    // prst není kurzor: hledat v okolí ±14 px (v348 se bod „skoro nedal trefit", světlý motiv jakbysmet)
                    var T14 = 14, bb = [[ev.point.x - T14, ev.point.y - T14], [ev.point.x + T14, ev.point.y + T14]];
                    var f = m3.queryRenderedFeatures(bb, { layers: ['body-kruh', 'sloupky-3d'] });
                    if (!f.length) f = m3.queryRenderedFeatures(bb, { layers: ['trasa-cara', 'vykres-body', 'vykres-cary'] });
                    if (!f.length) f = m3.queryRenderedFeatures(ev.point, { layers: ['chodniky', 'budovy-3d'] });
                    if (!f.length) { info(''); karta(null); return; }
                    var q = f[0], pr = q.properties || {};
                    if (q.layer.id === 'body-kruh' || q.layer.id === 'sloupky-3d') {
                        var bod2 = (arPoints || []).find(function (x) { return x.id === pr.id; });
                        if (bod2) { karta(bod2); info(''); otevriKartu(bod2); } else info('Bod ' + pr.name);
                    }
                    else if (q.layer.id === 'trasa-cara') { var t = AGTrasa && AGTrasa.trasa(); info(t ? 'Trasa ' + Math.round(t.delka) + ' m po terénu' + (t.profil ? ' · ↑' + Math.round(t.profil.up) + ' ↓' + Math.round(t.profil.down) + ' m' : '') : 'Přímka k cíli'); }
                    else if (q.layer.id === 'vykres-cary') { var stn = window.AGProjektDxf && AGProjektDxf.stanicteni({ lat: ev.lngLat.lat, lng: ev.lngLat.lng }); info('Výkres · ' + pr.vrstva + (stn ? ' · ' + stn.text : '')); }
                    else if (q.layer.id === 'vykres-body') info('Výkres · ' + pr.vrstva + ' · ' + (pr.jmeno || ''));
                    else if (q.layer.id === 'chodniky') info('Chodník / stezka (' + (pr.kind_detail || 'cesta') + ') · šířka ' + (CHODNIK[pr.kind_detail] || 1.8) + ' m (odhad z mapy)');
                    else info('Budova' + (pr.addr_housenumber ? ' č. ' + pr.addr_housenumber : '') + (pr.height ? ' · výška ' + (+pr.height).toFixed(0) + ' m' : ' · výška odhad 8 m'));
                } catch (e) { swallow(e, 'click'); }
            });
            document.getElementById('ag3d-zavrit').onclick = zavri;
            document.getElementById('ag3d-name').onclick = function () { var q = poloha(); if (q) m3.easeTo({ center: [q.lng, q.lat], bearing: heading(), zoom: Math.max(m3.getZoom(), 16), duration: 500 }); };
            document.getElementById('ag3d-sever').onclick = function () { m3.easeTo({ bearing: 0, duration: 400 }); };
            document.getElementById('ag3d-pitch').onclick = function () { st.pitch = m3.getPitch() > 10 ? 0 : 60; uloz(); m3.easeTo({ pitch: st.pitch, duration: 500 }); };
            function prepinac(id, klic) { document.getElementById(id).onclick = function () { st[klic] = !st[klic]; uloz(); this.classList.toggle('on', st[klic]); m3.setStyle(styl()); obnovChodniky(); }; }
            prepinac('ag3d-teren', 'teren'); prepinac('ag3d-zelen', 'zelen'); prepinac('ag3d-chodniky', 'chodniky');
            document.getElementById('ag3d-k-x').onclick = function () { karta(null); };
            document.getElementById('ag3d-k-karta').onclick = function () { if (_vybrany) otevriKartu(_vybrany); };
            document.getElementById('ag3d-k-nav').onclick = function () { if (_vybrany) naviguj(_vybrany); };
            if (bod && bod.id) karta(bod);
            dotahniDmr();
            // moje poloha, body a trasa se obnovují průběžně (1×/2 s) — ne přes události mapy, ať je to levné
            _sleduj = setInterval(function () { try { if (!m3 || !m3.getSource('ja')) return; m3.getSource('ja').setData(polohaGeo()); m3.getSource('body').setData(bodyGeo()); m3.getSource('trasa').setData(trasaGeo()); } catch (e) { swallow(e, 'tik'); } }, 2000);
        });
    }
    window.agOpenPohled3d = otevri;
    window.AGPohled3d = { otevri: otevri, zavri: zavri, mapa: function () { return m3; }, styl: styl, nastaveni: function () { return st; }, karta: karta, naviguj: naviguj, chodnikyGeo: chodnikyGeo, sloupkyGeo: sloupkyGeo, trasaGeo: trasaGeo, dmr: function () { return _dmr; }, faze: faze, souhvezdi: function () { return SOUHVEZDI; }, obloha: obloha, efemeridy: efemeridy };

    function register() {
        try { if (typeof window.agRegisterFieldTool === 'function') window.agRegisterFieldTool({ id: 'pohled-3d', label: '3D pohled', icon: ICON, cat: 'Katastr a data', onClick: function () { otevri(); }, order: 9 }); } catch (e) { swallow(e, 'register'); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register); else register();
})();
