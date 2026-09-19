// ===== QTRIG — VÝŠKOPIS ČÚZK DMR 5G: jen DATOVÁ služba (ODPOJITELNÁ vrstva) ====
// ⚠ OD 11. 9. 2026 BEZ UI. Modul dřív nabízel i režim „terénní AR": řádek Terén
//   (DMR 5G) v panelu Vrstvy, tlačítko #btn-terrain v #map-ctrl-stack, stavový
//   proužek #dmr-status a hook window.terrainDZ(lat,lng), kterým grafika.js
//   posouvala AR značky na skutečný terén. Uživatel: „Terén DMR 5G — nevím, co to
//   dělá, nikdy jsem si toho nevšiml, v klidu zahoď." Vrstva si navíc z AR render
//   smyčky dotahovala buňky výškopisu (60×/s → fronta, odklady, pauzy sítě) —
//   celá ta mašinérie šla pryč s ní. Volající terrainDZ (grafika.js, prohlidka.js,
//   stakeout-line-ar.js, track-ar.js) mají typeof-guard a bez hooku počítají
//   rovnou zem ve výšce očí — přesně jako když byla vrstva vypnutá.
//
// CO ZŮSTÁVÁ A PROČ: jednorázový odečet výšky terénu (m Bpv) — na něm stojí
//   • grafika.js: nový bod z mapy si doplní výšku (openNewPointFromMap),
//   • js/balicek-zakazky.js: sbalení zakázky stáhne výšky bodů pro offline,
//   • js/pocasi.js: srovnání výšky stanice s místem měření,
//   • js/vyska-gps.js: kontrola výšky z GPS proti terénu,
//   • js/prohlidka.js, js/utility-networks.js: čtou už stažené hodnoty z cache
//     (window.terrainElev) — bez odečtu vrací null a poradí si.
//
// Zdroj: ČÚZK DMR 5G ImageServer (identify), host ags.cuzk.gov.cz (stejný jako
//   bodová pole → CORS OK). Přesnost DMR 5G: ~0,18 m (otevřený terén) / 0,3 m (les).
//   Výšky v systému Bpv. Data © ČÚZK. (getSamples je na službě zakázán → identify.)
//
// VÝŠKA TERÉNU V CELÉ EVROPĚ (19. 9. 2026, E5): DMR 5G končí na hranici — v 10 z 11
//   zkoušených zemí hlásil Nový bod „výšku terénu nelze zjistit". Zdroj se teď vybírá
//   podle země měření (js/sour-zeme.js), všechno ověřeno naostro 19. 9. 2026 (CORS *):
//     CZ  ČÚZK DMR 5G                 σ 0,3 m   Bpv
//     CH  swisstopo REST height       σ 0,5 m   LN02 (swissALTI3D; vstup LV95 E/N)
//     FR  IGN Géoplateforme altimétrie σ 0,5 m   NGF-IGN69 (RGE ALTI 1 m)
//     *   dlaždice Terrarium (AWS, z14) σ 5 m     ~EGM96 — SRTM/EU-DEM ~30 m, jen orientačně;
//         tytéž dlaždice už appka stahuje pro profil trasy (js/trasa-terenem.js) a 3D pohled.
//   window.terrainElevInfo(lat, lng) říká, odkud výška je (zdroj, sigma, výškový systém),
//   aby UI (vyska-gps.js, parcela-klik.js) psalo pravdu a nepsalo „DMR 5G" v Paříži.
//
// Cache buněk ~10 m v localStorage — výšky jsou absolutní, sdílí se napříč
//   zakázkami i oblastmi (balíček zakázky ji naplní, prohlídka z ní čte).
//
// Odstranění: smaž js/dmr-terrain.js + řádek <script> v index.html (a přegeneruj
//   sw.js). Všichni volající mají typeof-guard — appka jede dál, jen bez výšek.
// ================================================================================
(function () {
    'use strict';

    var SVC = 'https://ags.cuzk.gov.cz/arcgis/rest/services/3D/dmr5g/ImageServer/identify';
    var FETCH_MS = 12000;          // timeout jednoho odečtu
    var CELL = 1e-4;               // velikost buňky cache (~7–11 m) — DMR má 2 m, pro výšku bodu stačí
    var CACHE_KEY = 'agDmrElev_v1';
    var CACHE_MAX = 6000;          // strop položek v cache (localStorage)

    var _elev = {};                // cellKey -> výška (m Bpv) | null (NoData)
    var _pending = {};             // cellKey -> Promise (stejná buňka dvakrát naráz = jeden dotaz)
    var _persistT = 0;

    function cellKey(lat, lng) { var k = Math.round(lat / CELL) + '_' + Math.round(lng / CELL); var z = zemeKod(); return z === 'CZ' ? k : z + ':' + k; }   // mimo CZ i země (jiný systém výšek)

    function fetchJson(url) {
        return new Promise(function (resolve, reject) {
            var done = false;
            var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var t = setTimeout(function () { done = true; if (ctrl) { try { ctrl.abort(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dmr-terrain:fetchJson'); } } reject(new Error('timeout')); }, FETCH_MS);
            fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
                .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                .then(function (j) { if (done) return; clearTimeout(t); resolve(j); })
                .catch(function (e) { if (done) return; clearTimeout(t); reject(e); });
        });
    }

    function identifyCuzk(lat, lng) {
        var geom = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
        var url = SVC + '?geometry=' + encodeURIComponent(geom)
            + '&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json';
        return fetchJson(url).then(function (j) {
            var v = j && j.value;
            if (v == null || v === 'NoData') return null;
            var n = parseFloat(v);
            return isFinite(n) ? n : null;
        });
    }
    // --- zdroje po zemích (E5) ---------------------------------------------------------------
    var LV95 = '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs';
    function identifyCh(lat, lng) {
        var en; try { en = proj4('WGS84', LV95, [lng, lat]); } catch (e) { return Promise.resolve(null); }
        return fetchJson('https://api3.geo.admin.ch/rest/services/height?easting=' + en[0].toFixed(1) + '&northing=' + en[1].toFixed(1) + '&sr=2056').then(function (j) {
            var n = j && parseFloat(j.height); return isFinite(n) ? n : null;
        });
    }
    function identifyFr(lat, lng) {
        return fetchJson('https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=' + lng.toFixed(6) + '&lat=' + lat.toFixed(6) + '&resource=ign_rge_alti_wld&zonly=true').then(function (j) {
            var n = j && j.elevations && parseFloat(j.elevations[0]); return (isFinite(n) && n > -9000) ? n : null;   // -99999 = mimo pokrytí
        });
    }
    var TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', TZ = 14, _tiles = {};
    function tile(z, x, y) {
        var k = z + '/' + x + '/' + y; if (_tiles[k]) return _tiles[k];
        _tiles[k] = new Promise(function (res, rej) {
            var img = new Image(); img.crossOrigin = 'anonymous';
            img.onload = function () { try { var cv = document.createElement('canvas'); cv.width = cv.height = 256; var c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0); res(c.getImageData(0, 0, 256, 256).data); } catch (e) { rej(e); } };
            img.onerror = function () { rej(new Error('teren ' + k)); };
            img.src = TERRARIUM.replace('{z}', z).replace('{x}', x).replace('{y}', y);
        }).catch(function (e) { delete _tiles[k]; throw e; });
        return _tiles[k];
    }
    function identifyTerrarium(lat, lng) {
        var n = Math.pow(2, TZ), xf = (lng + 180) / 360 * n, latR = lat * Math.PI / 180, yf = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
        var x = Math.floor(xf), y = Math.floor(yf), px = Math.floor((xf - x) * 256), py = Math.floor((yf - y) * 256);
        return tile(TZ, x, y).then(function (d) { var i = (py * 256 + px) * 4; var h = (d[i] * 256 + d[i + 1] + d[i + 2] / 256) - 32768; return (isFinite(h) && h > -1000) ? Math.round(h * 10) / 10 : null; });
    }
    var ZDROJE = {
        CZ: { zdroj: 'DMR 5G', sigma: 0.3, system: 'Bpv', fn: identifyCuzk, presne: true },
        CH: { zdroj: 'swissALTI3D', sigma: 0.5, system: 'LN02', fn: identifyCh, presne: true },
        FR: { zdroj: 'RGE ALTI', sigma: 0.5, system: 'NGF-IGN69', fn: identifyFr, presne: true },
        '*': { zdroj: 'EU-DEM/SRTM', sigma: 5, system: 'EGM96', fn: identifyTerrarium, presne: false }
    };
    function zemeKod() { try { return (window.AGSour && AGSour.kod && AGSour.kod()) || 'CZ'; } catch (e) { return 'CZ'; } }
    function zdrojPro(kod) { return ZDROJE[kod] || ZDROJE['*']; }
    function identifyElev(lat, lng) {
        var kod = zemeKod(), z = zdrojPro(kod);
        return z.fn(lat, lng).then(function (v) {
            if (v == null && z !== ZDROJE['*']) return ZDROJE['*'].fn(lat, lng);   // národní služba bez dat (mimo pokrytí) → hrubý terén
            return v;
        });
    }
    // Odkud výška je: { zdroj, sigma, system, presne, kod } — pro popisky v UI (E5).
    window.terrainElevInfo = function () {
        var kod = zemeKod(), z = zdrojPro(kod);
        return { kod: kod, zdroj: z.zdroj, sigma: z.sigma, system: z.system, presne: z.presne, narodni: !!ZDROJE[kod] };
    };

    // --------------------------------------------------------------------------------
    // Veřejné API (všichni volají přes typeof-guard)
    // --------------------------------------------------------------------------------
    // Absolutní výška terénu (m Bpv) z CACHE, nebo null když (zatím) není stažená.
    // Nic nestahuje — o to si musí říct terrainElevAsync. (Dřív při zapnutém terénním
    // AR zařazovala buňku do fronty; ta s režimem zmizela.)
    window.terrainElev = function (lat, lng) {
        if (typeof lat !== 'number' || typeof lng !== 'number') return null;
        var k = cellKey(lat, lng);
        return Object.prototype.hasOwnProperty.call(_elev, k) ? _elev[k] : null;   // může být i null (NoData)
    };
    // Jednorázový asynchronní odečet výšky terénu (m Bpv). Používá cache buněk;
    // výsledek do ní ukládá. Vrací Promise<number|null>; selhání sítě = null.
    // Offline nic nezkouší — nemá smysl budit rádio kvůli jistému neúspěchu.
    window.terrainElevAsync = function (lat, lng) {
        if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return Promise.resolve(null);
        var k = cellKey(lat, lng);
        if (Object.prototype.hasOwnProperty.call(_elev, k)) return Promise.resolve(_elev[k]);
        if (navigator.onLine === false) return Promise.resolve(null);
        if (_pending[k]) return _pending[k];
        _pending[k] = identifyElev(lat, lng).then(function (v) {
            _elev[k] = v; schedulePersist();
            delete _pending[k];
            return v;
        }).catch(function () { delete _pending[k]; return null; });
        return _pending[k];
    };

    // --------------------------------------------------------------------------------
    // Cache do localStorage (výšky jsou absolutní → sdílené napříč zakázkami i oblastmi)
    // --------------------------------------------------------------------------------
    function schedulePersist() {
        var now = Date.now();
        if (now - _persistT < 4000) return;
        _persistT = now;
        try {
            var keys = Object.keys(_elev);
            if (keys.length > CACHE_MAX) {                 // jednoduché ořezání nejstarších (vkládací pořadí)
                for (var i = 0; i < keys.length - CACHE_MAX; i++) delete _elev[keys[i]];
            }
            localStorage.setItem(CACHE_KEY, JSON.stringify(_elev));
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dmr-terrain:schedulePersist'); }
    }
    function loadCache() {
        try { var c = JSON.parse(localStorage.getItem(CACHE_KEY)); if (c && typeof c === 'object') _elev = c; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dmr-terrain:loadCache'); }
    }
    loadCache();
})();
