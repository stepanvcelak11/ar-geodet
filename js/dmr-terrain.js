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

    function cellKey(lat, lng) { return Math.round(lat / CELL) + '_' + Math.round(lng / CELL); }

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

    function identifyElev(lat, lng) {
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
