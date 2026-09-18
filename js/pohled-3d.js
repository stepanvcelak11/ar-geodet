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
    window.AGPohled3d = { otevri: otevri, zavri: zavri, mapa: function () { return m3; }, styl: styl, nastaveni: function () { return st; }, karta: karta, naviguj: naviguj, chodnikyGeo: chodnikyGeo, sloupkyGeo: sloupkyGeo, trasaGeo: trasaGeo, dmr: function () { return _dmr; } };

    function register() {
        try { if (typeof window.agRegisterFieldTool === 'function') window.agRegisterFieldTool({ id: 'pohled-3d', label: '3D pohled', icon: ICON, cat: 'Katastr a data', onClick: function () { otevri(); }, order: 9 }); } catch (e) { swallow(e, 'register'); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register); else register();
})();
