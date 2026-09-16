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
// Klepnutí na budovu = výška a číslo popisné; na bod = jméno, výška, vzdálenost.
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
    var st = { teren: true, pitch: 60 };
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { if (s.teren != null) st.teren = !!s.teren; if (s.pitch != null) st.pitch = +s.pitch; } } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }

    var el = null, m3 = null, _sleduj = null;

    function poloha() { try { return (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng } : null; } catch (e) { return null; } }
    function heading() { try { return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : 0; } catch (e) { return 0; } }
    function barvaBodu(pt) { try { return agBarvaBodu(pt); } catch (e) { return pt.cat === 'CUSTOM' ? '#22c55e' : '#f59e0b'; } }

    // ---- data pro mapu: body, výkres, poloha -----------------------------------------------
    function bodyGeo() {
        var f = [];
        try {
            (typeof arPoints !== 'undefined' ? arPoints : []).forEach(function (p) {
                if (!p || p.hidden || typeof p.lat !== 'number') return;
                f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { name: String(p.name || ''), barva: barvaBodu(p), cat: p.cat || '', vyska: p.vyska != null ? +p.vyska : null, id: p.id } });
            });
        } catch (e) { swallow(e, 'body'); }
        return { type: 'FeatureCollection', features: f };
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

    // ---- styl: podklad + 3D budovy + terén + naše vrstvy -----------------------------------
    function styl() {
        var v = (window.AGMapaVektor && AGMapaVektor.varianta()) || 'den';
        var S = AGMapaStyl.vytvor(v, AGMapaVektor.url());
        var P = AGMapaStyl.PALETY[v] || AGMapaStyl.PALETY.den;
        S.sources.body = { type: 'geojson', data: bodyGeo() };
        S.sources.vykres = { type: 'geojson', data: vykresGeo() };
        S.sources.ja = { type: 'geojson', data: polohaGeo() };
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
        S.layers.push(
            { id: 'vykres-cary', type: 'line', source: 'vykres', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'barva'], 'line-width': ['case', ['==', ['get', 'osa'], 1], 5, 3] } },
            { id: 'vykres-body', type: 'circle', source: 'vykres', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': ['get', 'barva'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
            { id: 'body-kruh', type: 'circle', source: 'body', paint: { 'circle-radius': 6, 'circle-color': ['get', 'barva'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } },
            { id: 'body-jmena', type: 'symbol', source: 'body', minzoom: 15, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-allow-overlap': false }, paint: { 'text-color': P.text, 'text-halo-color': P.textHalo, 'text-halo-width': 1.5 } },
            { id: 'ja-kruh', type: 'circle', source: 'ja', paint: { 'circle-radius': 9, 'circle-color': '#22d3ee', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } }
        );
        return S;
    }

    // ---- okno ---------------------------------------------------------------------------------
    function html() {
        return '<div class="ag3d-top"><b>3D pohled</b><span id="ag3d-info"></span><button type="button" class="ag3d-x" id="ag3d-zavrit" aria-label="Zavřít">✕</button></div>'
            + '<div id="ag3d-mapa"></div>'
            + '<div class="ag3d-bar">'
            + '<button type="button" id="ag3d-name"><svg class="icon"><use href="#i-crosshair"/></svg> Na mě</button>'
            + '<button type="button" id="ag3d-sever">Sever</button>'
            + '<button type="button" id="ag3d-pitch">2D / 3D</button>'
            + '<button type="button" id="ag3d-teren" class="' + (st.teren ? 'on' : '') + '">Terén</button>'
            + '</div><div class="ag3d-pozn">Dva prsty = otočit a naklopit. Klepni na budovu nebo bod.</div>';
    }
    function info(t) { var i = document.getElementById('ag3d-info'); if (i) i.textContent = t || ''; }
    function zavri() {
        try { if (_sleduj) { clearInterval(_sleduj); _sleduj = null; } } catch (e) { /* nic */ }
        try { if (m3) { m3.remove(); m3 = null; } } catch (e) { swallow(e, 'remove'); }
        if (el) { el.style.display = 'none'; el.innerHTML = ''; }
    }
    function otevri() {
        if (window.AGLite && AGLite.lite) { return window.agAlert ? agAlert({ title: '3D pohled', message: 'V režimu slabší telefon není 3D pohled k dispozici (potřebuje WebGL). Vypni ho v Nastavení → Vzhled.' }) : alert('3D pohled není v režimu slabší telefon.'); }
        if (!window.AGMapaVektor || !window.AGMapaStyl) { return agAlert({ title: '3D pohled', message: 'Nejdřív zapni vektorovou mapu: Nastavení → Vzhled → Nová mapa (vektor, beta).' }); }
        var zap = AGMapaVektor.stav() === 'zapnuto' ? Promise.resolve(true) : AGMapaVektor.zapni();
        zap.then(function (ok) {
            if (!ok) { agAlert({ title: '3D pohled', message: 'Vektorová mapa se nezapnula: ' + (AGMapaVektor.chyba() || 'neznámá chyba') + '. Zapni ji v Nastavení → Vzhled.' }); return; }
            // stylopis si připojí sám (lazy-tools ho dává jen při otevření z dlaždice)
            if (!document.querySelector('link[href$="css/pohled-3d.css"]')) { var lk = document.createElement('link'); lk.rel = 'stylesheet'; lk.href = 'css/pohled-3d.css'; document.head.appendChild(lk); }
            if (!el) { el = document.createElement('div'); el.id = 'ag3d'; document.body.appendChild(el); }
            el.innerHTML = html(); el.style.display = 'block';
            var p = poloha() || (function () { try { var c = map.getCenter(); return { lat: c.lat, lng: c.lng }; } catch (e) { return { lat: 49.8, lng: 15.5 }; } })();
            m3 = new maplibregl.Map({ container: 'ag3d-mapa', style: styl(), center: [p.lng, p.lat], zoom: 17.5, pitch: st.pitch, bearing: heading(), attributionControl: false, maxPitch: 75, antialias: false });
            m3.touchZoomRotate.enableRotation(); m3.dragRotate.enable();
            m3.on('error', function (ev) { swallow(ev && ev.error, 'maplibre'); });
            m3.on('click', function (ev) {
                try {
                    var f = m3.queryRenderedFeatures(ev.point, { layers: ['body-kruh', 'vykres-cary', 'vykres-body', 'budovy-3d'] });
                    if (!f.length) { info(''); return; }
                    var q = f[0], pr = q.properties || {};
                    if (q.layer.id === 'body-kruh') { var me = poloha(); var d = me ? GeoCore.getDistance(me.lat, me.lng, ev.lngLat.lat, ev.lngLat.lng) : null; info('Bod ' + pr.name + (pr.vyska != null ? ' · ' + (+pr.vyska).toFixed(2) + ' m' : '') + (d != null ? ' · ' + d.toFixed(1) + ' m ode mě' : '')); }
                    else if (q.layer.id === 'vykres-cary') { var stn = window.AGProjektDxf && AGProjektDxf.stanicteni({ lat: ev.lngLat.lat, lng: ev.lngLat.lng }); info('Výkres · ' + pr.vrstva + (stn ? ' · ' + stn.text : '')); }
                    else if (q.layer.id === 'vykres-body') info('Výkres · ' + pr.vrstva + ' · ' + (pr.jmeno || ''));
                    else info('Budova' + (pr.addr_housenumber ? ' č. ' + pr.addr_housenumber : '') + (pr.height ? ' · výška ' + (+pr.height).toFixed(0) + ' m' : ' · výška odhad 8 m'));
                } catch (e) { swallow(e, 'click'); }
            });
            document.getElementById('ag3d-zavrit').onclick = zavri;
            document.getElementById('ag3d-name').onclick = function () { var q = poloha(); if (q) m3.easeTo({ center: [q.lng, q.lat], bearing: heading(), duration: 500 }); };
            document.getElementById('ag3d-sever').onclick = function () { m3.easeTo({ bearing: 0, duration: 400 }); };
            document.getElementById('ag3d-pitch').onclick = function () { st.pitch = m3.getPitch() > 10 ? 0 : 60; uloz(); m3.easeTo({ pitch: st.pitch, duration: 500 }); };
            document.getElementById('ag3d-teren').onclick = function () { st.teren = !st.teren; uloz(); this.classList.toggle('on', st.teren); m3.setStyle(styl()); };
            // moje poloha + body se obnovují průběžně (1×/2 s) — ne přes události mapy, ať je to levné
            _sleduj = setInterval(function () { try { if (!m3 || !m3.getSource('ja')) return; m3.getSource('ja').setData(polohaGeo()); m3.getSource('body').setData(bodyGeo()); } catch (e) { swallow(e, 'tik'); } }, 2000);
        });
    }
    window.agOpenPohled3d = otevri;
    window.AGPohled3d = { otevri: otevri, zavri: zavri, mapa: function () { return m3; }, styl: styl, nastaveni: function () { return st; } };

    function register() {
        try { if (typeof window.agRegisterFieldTool === 'function') window.agRegisterFieldTool({ id: 'pohled-3d', label: '3D pohled', icon: ICON, cat: 'Katastr a data', onClick: otevri, order: 9 }); } catch (e) { swallow(e, 'register'); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register); else register();
})();
