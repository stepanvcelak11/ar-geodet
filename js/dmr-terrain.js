// ===== AR Geodet — TERÉNNÍ AR: výškopis ČÚZK DMR 5G (ODPOJITELNÁ vrstva) =======
// Neinvazivní vrstva. NEEDITUJE projekci v grafika.js přímo — jen vystaví globální
// hook window.terrainDZ(lat,lng), který grafika.js VOLITELNĚ použije ve svislém
// úhlu AR (přes typeof-guard). Bez tohoto modulu hook neexistuje → projekce počítá
// přesně jako dřív (rovná zem ve výšce očí).
//
// Co řeší:
//   AR doteď předpokládá, že KAŽDÝ bod leží na ROVINĚ ve výšce očí. Na svahu se tak
//   bod o 30 m výš kreslí špatně (moc nízko). Tento modul stáhne z ČÚZK DMR 5G
//   skutečnou výšku terénu (Bpv) pro stanovisko i pro body/hrany a posune je svisle
//   na SKUTEČNÝ terén. Profituje z toho i vektorový katastr (hranice po terénu).
//
//   terrainDZ(lat,lng) = výška_terénu(lat,lng) − výška_terénu(stanoviska).
//   grafika.js počítá depresní úhel jako atan2(eyeH − terrainDZ, vzdálenost).
//
// Zdroj: ČÚZK DMR 5G ImageServer (identify), host ags.cuzk.gov.cz (stejný jako
//   bodová pole → CORS OK). Přesnost DMR 5G: ~0,18 m (otevřený terén) / 0,3 m (les).
//   Výšky v systému Bpv. Data © ČÚZK. (getSamples je na službě zakázán → identify.)
//
// Vzorkuje se ON-DEMAND jen to, co je v AR vidět (buňky ~10 m), výsledky se cachují
//   (localStorage) a sdílí napříč zakázkami. Vypnuto = žádné dotazy, hook vrací 0.
//
// Odstranění: smaž js/dmr-terrain.js + css/dmr-terrain.css, řádky v index.html a sw.js.
//   Volání window.terrainDZ v grafika.js pak vrací 0 (rovná zem) — appka jede dál.
// ================================================================================
(function () {
    'use strict';

    var SVC = 'https://ags.cuzk.gov.cz/arcgis/rest/services/3D/dmr5g/ImageServer/identify';
    var FETCH_MS = 12000;          // timeout jednoho odečtu
    var CELL = 1e-4;               // velikost buňky cache (~7–11 m) — DMR má 2 m, tohle stačí pro AR
    var MAX_CONCURRENT = 3;        // šetrné k ČÚZK (žádné zahlcení)
    var OBS_REFRESH_M = 12;        // posun stanoviska pro nový odečet jeho výšky
    var CACHE_KEY = 'agDmrElev_v1';
    var CACHE_MAX = 6000;          // strop položek v cache (localStorage)

    // BATERIE: odečty si vyžaduje AR render smyčka (60×/s). Když dotaz selže, NESMÍ se
    // buňka zařadit hned v příštím snímku znovu — jinak se při slabém signálu drží
    // trvale 3 padající requesty a rádio se nikdy nevrátí do klidu (= největší žrout).
    // Proto per-buňka exponenciální odklad + globální pauza po sérii selhání.
    var CELL_RETRY_MS = 5000;      // 1. odklad buňky; dál ×3 (5 s, 15 s, 45 s…)
    var CELL_RETRY_MAX = 300000;   // strop odkladu jedné buňky
    var CELL_TRIES = 4;            // po tolika selháních buňku vzdáme (do obnovy sítě)
    var NET_FAIL_LIMIT = 6;        // tolik selhání za sebou = síť je mimo
    var NET_PAUSE_MS = 60000;      // …pak na minutu vůbec nic nezkoušet

    var _on = false;
    var _elev = {};                // cellKey -> výška (m Bpv) | null (NoData)
    var _requested = {};           // cellKey -> true (právě se stahuje / staženo)
    var _failCount = {};           // cellKey -> počet selhání za sebou
    var _failUntil = {};           // cellKey -> do kdy ji nezkoušet (ms epoch)
    var _netFails = 0, _netPauseUntil = 0;
    var _queue = [];
    var _active = 0;
    var _obsElev = null, _obsLat = null, _obsLng = null;
    var _statusEl = null;
    var _persistT = 0;

    // --------------------------------------------------------------------------------
    // Pomocné
    // --------------------------------------------------------------------------------
    function alertMsg(title, message) {
        try { if (typeof window.agAlert === 'function') { window.agAlert({ title: title, message: message }); return; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dmr-terrain:alertMsg'); }
        try { window.alert(String(title) + '\n\n' + String(message).replace(/<[^>]+>/g, '')); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dmr-terrain:alertMsg'); }
    }
    function distM(lat1, lng1, lat2, lng2) {
        if (typeof getDistance === 'function') { try { return getDistance(lat1, lng1, lat2, lng2); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dmr-terrain:distM'); } }
        var R = 6371000, toR = Math.PI / 180;
        var dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    function cellKey(lat, lng) { return Math.round(lat / CELL) + '_' + Math.round(lng / CELL); }
    function cellCenter(key) { var p = key.split('_'); return { lat: parseFloat(p[0]) * CELL, lng: parseFloat(p[1]) * CELL }; }

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

    // --------------------------------------------------------------------------------
    // Veřejné API (grafika.js volá přes typeof-guard; ostatní moduly můžou číst taky)
    // --------------------------------------------------------------------------------
    // Absolutní výška terénu (m Bpv) v daném místě, nebo null když není (zatím) známa.
    window.terrainElev = function (lat, lng) {
        if (typeof lat !== 'number' || typeof lng !== 'number') return null;
        var k = cellKey(lat, lng);
        if (Object.prototype.hasOwnProperty.call(_elev, k)) return _elev[k];  // může být i null (NoData)
        if (_on) enqueue(k);
        return null;
    };
    // Svislý posun bodu vůči stanovisku (kladně = výš než stanoviště). 0 = neznámo/vypnuto.
    window.terrainDZ = function (lat, lng) {
        if (!_on || _obsElev == null) return 0;
        var e = window.terrainElev(lat, lng);
        if (e == null) return 0;
        return e - _obsElev;
    };
    // Jednorázový asynchronní odečet výšky terénu (m Bpv) — funguje i při vypnuté
    // AR vrstvě terénu (_on=false). Používá cache buněk; výsledek do ní ukládá.
    // Vrací Promise<number|null>. (Použití: předvyplnění výšky u bodu z mapy.)
    window.terrainElevAsync = function (lat, lng) {
        if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return Promise.resolve(null);
        var k = cellKey(lat, lng);
        if (Object.prototype.hasOwnProperty.call(_elev, k)) return Promise.resolve(_elev[k]);
        return identifyElev(lat, lng).then(function (v) {
            _elev[k] = v; schedulePersist();
            return v;
        }).catch(function () { return null; });
    };

    // --------------------------------------------------------------------------------
    // Fronta odečtů (identify) s limitem souběhu
    // --------------------------------------------------------------------------------
    // Síť je mimo? (offline, nebo běží pauza po sérii selhání) — pak nemá smysl budit rádio.
    function netDown() {
        if (navigator.onLine === false) return true;
        if (_netPauseUntil && Date.now() < _netPauseUntil) return true;
        return false;
    }
    function enqueue(key) {
        if (_requested[key]) return;
        if (netDown()) return;
        if ((_failCount[key] || 0) >= CELL_TRIES) return;               // vzdáno do obnovy sítě
        if (_failUntil[key] && Date.now() < _failUntil[key]) return;    // ještě běží odklad
        _requested[key] = true;
        _queue.push(key);
        pump();
    }
    // Vrátil se signál → zapomeň odklady, ať je terén hned k dispozici.
    window.addEventListener('online', function () {
        _netFails = 0; _netPauseUntil = 0; _failCount = {}; _failUntil = {};
    });
    function pump() {
        while (_active < MAX_CONCURRENT && _queue.length) {
            _active++;
            fetchCell(_queue.shift());
        }
    }
    function fetchCell(key) {
        var c = cellCenter(key);
        identifyElev(c.lat, c.lng).then(function (v) {
            _elev[key] = v;
            _netFails = 0; delete _failCount[key]; delete _failUntil[key];
            _active--; schedulePersist(); updateStatus(); pump();
        }).catch(function () {
            // Opakování POVOLIT, ale až po odkladu (jinak by ji render smyčka zařadila
            // hned v příštím snímku a rádio by jelo nepřerušovaně — viz komentář výše).
            var n = (_failCount[key] || 0) + 1;
            _failCount[key] = n;
            _failUntil[key] = Date.now() + Math.min(CELL_RETRY_MS * Math.pow(3, n - 1), CELL_RETRY_MAX);
            _requested[key] = false;
            if (++_netFails >= NET_FAIL_LIMIT) { _netPauseUntil = Date.now() + NET_PAUSE_MS; _netFails = 0; }
            _active--; pump();
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

    // Výška stanoviska — bez ní nemá terrainDZ smysl (vrací 0). Obnova při posunu.
    function updateObserver() {
        if (!_on) return;
        if (netDown()) return;      // offline / pauza po serii selhani — nebudit radio
        if (typeof userLat === 'undefined' || userLat == null) return;
        if (_obsElev != null && _obsLat != null && distM(_obsLat, _obsLng, userLat, userLng) < OBS_REFRESH_M) return;
        var lat = userLat, lng = userLng;
        identifyElev(lat, lng).then(function (v) {
            if (v != null) { _obsElev = v; _obsLat = lat; _obsLng = lng; updateStatus(); }
        }).catch(function () {});
    }

    // Po zapnutí přednahraj buňky aktuálně stažených bodů (ať AR rychle sedne)
    function primeVisible() {
        try {
            if (typeof arPoints === 'undefined' || !Array.isArray(arPoints)) return;
            for (var i = 0; i < arPoints.length && i < 250; i++) {
                var p = arPoints[i];
                if (p && typeof p.lat === 'number') enqueue(cellKey(p.lat, p.lng));
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dmr-terrain:primeVisible'); }
    }

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

    // --------------------------------------------------------------------------------
    // UI: přepínač v ovládání mapy + stavový proužek
    // --------------------------------------------------------------------------------
    function setStatus(show) {
        if (!_statusEl) {
            _statusEl = document.createElement('div');
            _statusEl.id = 'dmr-status';
            _statusEl.addEventListener('click', function () {
                alertMsg('Terénní AR (DMR 5G)',
                    'AR značky a hranice sedí na <b>skutečném terénu</b> z národního výškopisu ČÚZK ' +
                    '(DMR 5G), místo aby ležely na ploché rovině ve výšce očí.<br><br>' +
                    'Výšky jsou v systému <b>Bpv</b>, přesnost DMR 5G ~0,18 m (otevřený terén) / 0,3 m (les). ' +
                    'Svislé umístění v AR navíc závisí na přesnosti GPS a kompasu — jde o orientační pomůcku.<br><br>' +
                    'Výšky se stahují jen pro to, co je v AR vidět, a ukládají se offline. Data © ČÚZK.');
            });
            document.body.appendChild(_statusEl);
        }
        updateStatus();
        _statusEl.classList.toggle('open', !!show);
    }
    function updateStatus() {
        if (!_statusEl) return;
        var n = 0; for (var k in _elev) { if (Object.prototype.hasOwnProperty.call(_elev, k)) n++; }
        var txt = _obsElev != null ? ('Terén: ' + _obsElev.toFixed(1) + ' m Bpv') : 'Terén: hledám výšku…';
        txt += ' · ' + n + ' odečtů · © ČÚZK';
        _statusEl.innerHTML = '<svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px;vertical-align:-2px;margin-right:5px;"><path d="M3 20l6-11 4 6 2.5-4L21 20z"/></svg>' + txt;
    }
    function hideStatus() { if (_statusEl) _statusEl.classList.remove('open'); }

    function setOn(on) {
        _on = on;
        var btn = document.getElementById('btn-terrain');
        // ⚠⚠ NAHLÁŠENO 30. 8. 2026: „když kliknu na Terén (DMR 5G), tak se nic nestane."
        // Vrstva se přitom zapínala správně — jen o tom nikdo nevěděl. Appka totiž
        // značí zapnuté vrstvy mapy třídou `ctrl-active` (tak to čte js/map-tools.js:
        // syncTerrain() = přepínač v panelu Vrstvy, activeLayers() = počítadlo v bublině
        // u tlačítka), kdežto tenhle modul si od začátku psal vlastní `on`. Přepínač se
        // tedy nikdy nepřeklopil a v panelu to vypadalo na mrtvé tlačítko.
        // Držíme OBĚ třídy: `ctrl-active` kvůli appce, `on` kvůli css/dmr-terrain.css.
        if (btn) { btn.classList.toggle('on', on); btn.classList.toggle('ctrl-active', on); }
        if (!on) { hideStatus(); return; }
        setStatus(true);
        updateObserver();
        primeVisible();
    }
    function toggle() { setOn(!_on); }

    function injectButton() {
        var stack = document.getElementById('map-ctrl-stack');
        if (!stack || document.getElementById('btn-terrain')) return;
        var btn = document.createElement('button');
        btn.id = 'btn-terrain';
        btn.className = 'map-ctrl-btn glass-panel';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Terénní AR (výškopis DMR 5G)');
        btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 20l6-11 4 6 2.5-4L21 20z"/></svg>';
        btn.addEventListener('click', function () { try { toggle(); } catch (e) { console.warn('[dmr-terrain]', e); } });
        // POZOR (nalezeno 8.8. v prohlížeči): #btn-katastr se při redesignu panelu
        // Vrstvy přesunul do .ms-rows, takže UŽ NENÍ dítkem #map-ctrl-stack.
        // stack.insertBefore(btn, ref.nextSibling) proto padalo na NotFoundError a
        // tlačítko terénního AR se nepřidalo VŮBEC. Podle kotvy se řadíme jen když je
        // opravdu ve stejném rodiči, jinak patří na konec stacku (kde má i styl).
        var ref = document.getElementById('btn-katastr');
        if (ref && ref.parentNode === stack && ref.nextSibling) stack.insertBefore(btn, ref.nextSibling);
        else stack.appendChild(btn);
    }

    // --------------------------------------------------------------------------------
    // Init
    // --------------------------------------------------------------------------------
    function init() {
        try { loadCache(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dmr-terrain:init'); }
        try { injectButton(); } catch (e) { console.warn('[dmr-terrain] init', e); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    // hlídá posun stanoviska (jen když je vrstva zapnutá); přes AG.uiInterval, ať to
    // netiká s appkou na pozadí — tam se stanovisko nehýbe a jen by to budilo procesor
    (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(updateObserver, 4000);
})();
