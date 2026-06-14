// ===== AR Geodet - TECHNICKA CAST (logika) =====
// Vypocty, prevody souradnic, stahovani dat z CUZK, GPS, ukladani, zakazky.
// Nacita se PRED grafika.js a sdili s ni globalni promenne.

if ('serviceWorker' in navigator) {
            // UPDATE: novou verzi NEaktivujeme automaticky (rusivy reload uprostred prace);
            // nabidneme listu 'nova verze - klepni pro obnoveni' (showUpdateBanner -> applyUpdate -> SKIP_WAITING).
            let _swReloaded = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => { if (_swReloaded) return; _swReloaded = true; window.location.reload(); });
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js').then(reg => {
                    reg.addEventListener('updatefound', () => {
                        const nw = reg.installing; if (!nw) return;
                        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(); });
                    });
                }).catch(() => {});
            });
        }
        proj4.defs("EPSG:5514","+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs");
        const map = L.map('map', { maxZoom: 22, minZoom: 10, zoomSnap: 0, zoomDelta: 1, zoomControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false });
        const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22, maxNativeZoom: 18, zIndex: 1 });
        // Podklady CUZK (overeno: WMS 1.3.0, EPSG:3857). Ortofoto = base, katastr KN = pruhledny overlay nad base.
        const ortofotoLayer = L.tileLayer.wms('https://ags.cuzk.gov.cz/arcgis1/services/ORTOFOTO/MapServer/WMSServer', { layers: '0', format: 'image/jpeg', version: '1.3.0', maxZoom: 22, zIndex: 1, attribution: '© ČÚZK' });
        const katastrLayer = L.tileLayer.wms('https://services.cuzk.cz/wms/wms.asp', { layers: 'KN', format: 'image/png', transparent: true, version: '1.3.0', maxZoom: 22, zIndex: 2, attribution: '© ČÚZK' });
        const baseLayers = { osm: osmLayer, ortofoto: ortofotoLayer };
        osmLayer.addTo(map);
        const markersGroup = L.layerGroup().addTo(map);
        
        let projects = JSON.parse(localStorage.getItem('arProjectsList')) || [{id:'default', name:'Výchozí zakázka'}];
        let activeProjectId = localStorage.getItem('arActiveProjectId') || 'default';
        if (!localStorage.getItem('arProjects_migrated')) {
            ['arFilters12', 'arRadiusMap', 'arRadiusAR', 'arOfflinePoints12', 'arCustomPoints12', 'arVisSettings12', 'arLines12', 'arHeadingOffset'].forEach(k => {
                let v = localStorage.getItem(k); if(v) localStorage.setItem('default_' + k, v);
            });
            localStorage.setItem('arProjects_migrated', 'true');
        }
        function getStoreKey(key) { return `${activeProjectId}_${key}`; }

        // ---- IndexedDB pro velka data (body): bez ~5MB limitu localStorage ----
        // Velka pole bodu drzime v IndexedDB; v pameti je synchronni cache (_idbMem),
        // aby getStoredData/setStoredData zustaly synchronni jako dosud.
        const IDB_KEYS = ['arOfflinePoints12', 'arCustomPoints12'];
        let _idb = null, _idbOk = false, _idbMem = {};
        function _openIdb() {
            return new Promise((resolve) => {
                if (_idb) return resolve(_idb);
                let req; try { req = indexedDB.open('argeodet', 1); } catch (e) { return resolve(null); }
                req.onupgradeneeded = () => { try { req.result.createObjectStore('kv'); } catch (e) {} };
                req.onsuccess = () => { _idb = req.result; _idbOk = true; resolve(_idb); };
                req.onerror = () => resolve(null);
            });
        }
        function _idbOp(mode, fn) {
            return new Promise((resolve) => {
                _openIdb().then((db) => {
                    if (!db) return resolve(null);
                    try {
                        const tx = db.transaction('kv', mode), store = tx.objectStore('kv');
                        const r = fn(store);
                        tx.oncomplete = () => resolve(r ? r.result : null);
                        tx.onerror = () => resolve(null);
                    } catch (e) { resolve(null); }
                });
            });
        }
        function _idbGet(fk) { return _idbOp('readonly', s => s.get(fk)); }
        function _idbSet(fk, v) { return _idbOp('readwrite', s => s.put(v, fk)); }
        function _idbDel(fk) { return _idbOp('readwrite', s => s.delete(fk)); }
        // dump/restore celeho kv storu — pro zalohu vsech dat (zaloha.js)
        function idbDumpAll() {
            return new Promise((resolve) => {
                _openIdb().then((db) => {
                    if (!db) return resolve({});
                    try {
                        const out = {};
                        const tx = db.transaction('kv', 'readonly');
                        const req = tx.objectStore('kv').openCursor();
                        req.onsuccess = (e) => { const c = e.target.result; if (c) { out[c.key] = c.value; c.continue(); } };
                        tx.oncomplete = () => resolve(out);
                        tx.onerror = () => resolve(out);
                    } catch (e) { resolve({}); }
                });
            });
        }
        function idbRestoreAll(obj) {
            return new Promise((resolve) => {
                if (!obj || typeof obj !== 'object') return resolve();
                _openIdb().then((db) => {
                    if (!db) return resolve();
                    try {
                        const tx = db.transaction('kv', 'readwrite');
                        const store = tx.objectStore('kv');
                        Object.keys(obj).forEach(k => store.put(obj[k], k));
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => resolve();
                    } catch (e) { resolve(); }
                });
            });
        }
        // nahydruje velka data aktivni zakazky do synchronni cache (+ jednorazova migrace z localStorage)
        async function hydrateActiveProject() {
            for (const key of IDB_KEYS) {
                const fk = `${activeProjectId}_${key}`;
                let val = await _idbGet(fk);
                if (val == null) {
                    const ls = localStorage.getItem(fk);
                    if (ls != null) { await _idbSet(fk, ls); val = ls; if (_idbOk) { try { localStorage.removeItem(fk); } catch (e) {} } }
                }
                if (val != null) _idbMem[fk] = val; else delete _idbMem[fk];
            }
        }
        function getStoredData(key) {
            const fk = getStoreKey(key);
            if (IDB_KEYS.indexOf(key) >= 0) return (fk in _idbMem) ? _idbMem[fk] : localStorage.getItem(fk);
            return localStorage.getItem(fk);
        }
        let _quotaWarned = false;
        function setStoredData(key, val) {
            const fk = getStoreKey(key);
            if (IDB_KEYS.indexOf(key) >= 0) {
                _idbMem[fk] = val;
                if (_idbOk) { _idbSet(fk, val); try { localStorage.removeItem(fk); } catch (e) {} return true; }
            }
            try { localStorage.setItem(fk, val); return true; }
            catch (e) {
                if (!_quotaWarned) { _quotaWarned = true; alert('Úložiště telefonu je plné — data se neuložila. Uvolněte místo (smažte starou zakázku nebo stáhnuté offline okolí v Nastavení).'); }
                return false;
            }
        }
        function removeStoredData(key) {
            const fk = getStoreKey(key);
            if (IDB_KEYS.indexOf(key) >= 0) { delete _idbMem[fk]; if (_idbOk) _idbDel(fk); }
            localStorage.removeItem(fk);
        }

        let appStarted = false, viewMode = 'both', searchQuery = '', cameraStarted = false, currentVideoStream = null;
        let mapRadius = 1000, arRadius = 150;
        let userLat = null, userLng = null, userAlt = null, userMarker = null, lastFetchLat = null, lastFetchLng = null, lastCenterLat = null, lastCenterLng = null;
        let currentHeading = 0, currentGpsAccuracy = 0, accuracyCircle = null, magneticDeclination = 0;
        let smoothedHeading = null, gpsCourse = null, gpsSpeed = 0, headingCorrection = 0, userHeadingOffset = 0;
        function quickToast(msg) {
            let t = document.getElementById('quick-toast');
            if (!t) { t = document.createElement('div'); t.id = 'quick-toast'; t.style.cssText = 'position:fixed; left:50%; top:calc(env(safe-area-inset-top,0px) + 70px); transform:translateX(-50%); z-index:1000002; background:rgba(20,24,30,0.92); color:#fff; padding:10px 16px; border-radius:10px; font-size:14px; border:1px solid rgba(255,255,255,0.15); pointer-events:none; transition:opacity 0.3s; max-width:80vw; text-align:center;'; document.body.appendChild(t); }
            t.innerText = msg; t.style.opacity = '1'; clearTimeout(t._timer);
            t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2600);
        }
        let gpsSamples = [], gpsAvgResult = null;
        let arPoints = [], persistentCustomPoints = [], hideBtnLogic = null, editingCustomPointId = null, highlightedPointId = null, activePointIdForModal = null;
        let compassUnit = 'deg'; let compassZeroOffset = 0;
        let measA = null, measB = null, pendingPointAccuracy = null, mapAddMode = false;
        let wakeLock = null;
        let pointLines = []; let connectFirstPt = null; let areaVertices = [];
        let connectMode = false, areaMode = false;
        let filters = { tb: true, zhb: true, pbpp: true, nivel: true, custom: true };

        let visSettings = { maxARPoints: 20, arVerticalOffset: 0, markerScale: 1.0, markerOpacity: 100, colTb: '#8b5cf6', colZhb: '#0ea5e9', colPbpp: '#3b82f6', colNivel: '#ef4444', colCustom: '#34d399', arrowScale: 1.0, arrowOpacity: 90, arrowShape: '1', colArrow: '#34d399', panelOpacity: 85, menuScale: 1.0, hudTop: 55, hudSide: 15, wakeLockEnabled: true, outdoorMode: false, katastrSource: 'mapycz', baseLayer: 'osm', showKatastr: false, headingSmoothing: 75, autoCompassCorrection: false, tiltCompensation: true, fovH: 90, fovV: 75, eyeHeight: 1.6 };
        
        // Stazene uredni body ziji jen v pameti (initFetch je pridava, neubira) -> pred prepnutim
        // zakazky je ulozime, at se neztrati. Jen kdyz nejake jsou (neprepiseme ulozena data prazdnem).
        function _persistOfficialPoints() { try { if (arPoints.some(p => p.cat !== 'CUSTOM')) setStoredData('arOfflinePoints12', JSON.stringify(arPoints.filter(p => p.cat !== 'CUSTOM'))); } catch (e) {} }
        function changeProject() { _persistOfficialPoints(); activeProjectId = document.getElementById('w-project-select').value; localStorage.setItem('arActiveProjectId', activeProjectId); hydrateActiveProject().then(loadProjectSettings); }
        function createNewProject() { let name = prompt("Název nové zakázky:"); if(name) { _persistOfficialPoints(); let id = 'proj_' + Date.now(); projects.push({id: id, name: name}); localStorage.setItem('arProjectsList', JSON.stringify(projects)); activeProjectId = id; localStorage.setItem('arActiveProjectId', activeProjectId); renderProjectSelect(); hydrateActiveProject().then(loadProjectSettings); } }
        function deleteProject() { if(projects.length <= 1) return alert("Nelze smazat poslední zakázku."); if(!confirm("Opravdu smazat aktuální zakázku a všechny její uložené body?")) return; IDB_KEYS.forEach(k => { _idbDel(activeProjectId + "_" + k); try { localStorage.removeItem(activeProjectId + "_" + k); } catch(e){} }); projects = projects.filter(p => p.id !== activeProjectId); localStorage.setItem('arProjectsList', JSON.stringify(projects)); activeProjectId = projects[0].id; localStorage.setItem('arActiveProjectId', activeProjectId); renderProjectSelect(); hydrateActiveProject().then(loadProjectSettings); }

        function loadProjectSettings() {
            let f = getStoredData('arFilters12'); if(f) filters = JSON.parse(f); else filters = { tb: true, zhb: true, pbpp: true, nivel: true, custom: true };
            let m = getStoredData('arRadiusMap'); if(m) mapRadius = parseInt(m); else mapRadius = 1000;
            let a = getStoredData('arRadiusAR'); if(a) arRadius = parseInt(a); else arRadius = 150;
            let vs = getStoredData('arVisSettings12'); if(vs) visSettings = Object.assign(visSettings, JSON.parse(vs));
            let ho = getStoredData('arHeadingOffset'); userHeadingOffset = ho ? (parseFloat(ho) || 0) : 0;

            arPoints.forEach(p => { if(p.element) p.element.remove(); }); arPoints = []; persistentCustomPoints = [];
            let off = getStoredData('arOfflinePoints12'); if(off) { try { JSON.parse(off).forEach(p => { p.element=null; p.distElement=null; p.ringElement=null; p.bestAccuracy=null; p.hidden=false; arPoints.push(p); }); }catch(e){} }
            let cust = getStoredData('arCustomPoints12'); if(cust) { try { persistentCustomPoints = JSON.parse(cust); } catch(e) {} }
            loadLines();
            // OPRAVA: vlastni body musi po startu i do arPoints (AR + mapa), ne jen do seznamu spravy
            persistentCustomPoints.forEach(pt => arPoints.push({...pt, hidden: false}));

            document.getElementById('w-map-radius-slider').value = mapRadius; document.getElementById('w-map-radius-val').innerText = mapRadius;
            document.getElementById('w-ar-radius-slider').value = arRadius; document.getElementById('w-ar-radius-val').innerText = arRadius;
            document.getElementById('w-f-tb').checked = filters.tb; document.getElementById('w-f-zhb').checked = filters.zhb; document.getElementById('w-f-pbpp').checked = filters.pbpp; document.getElementById('w-f-nivel').checked = filters.nivel; document.getElementById('w-f-custom').checked = filters.custom;
            
            applyVisualSettings();
            if(appStarted) { drawAllMarkersOnMap(); initARMarkers(); if(userLat && userLng) initFetch(userLat, userLng); }
        }

        window.addEventListener('DOMContentLoaded', () => { renderProjectSelect(); hydrateActiveProject().then(loadProjectSettings); });

        async function requestWakeLock() { if ('wakeLock' in navigator && visSettings.wakeLockEnabled) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} } }
        document.addEventListener('visibilitychange', () => { if (wakeLock !== null && document.visibilityState === 'visible' && visSettings.wakeLockEnabled) { requestWakeLock(); } });

        function setMeasurePoint(type) { if (!userLat || !userLng) return alert("Hledám GPS pozici. Počkejte chvíli..."); const pt = { lat: userLat, lng: userLng, alt: userAlt }; let altStr = "Výška: nedostupná"; if (pt.alt !== null) { let bpv = pt.alt - getGeoidUndulation(pt.lat, pt.lng); altStr = `Výška (Bpv): ${bpv.toFixed(1)} m`; } let sjtsk = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]); let coordsStr = `Y: ${Math.abs(sjtsk[0]).toFixed(2)} | X: ${Math.abs(sjtsk[1]).toFixed(2)}<br><span style="opacity:0.7;">${altStr}</span>`; if (type === 'A') { measA = pt; document.getElementById('meas-a-coords').innerHTML = coordsStr; } else { measB = pt; document.getElementById('meas-b-coords').innerHTML = coordsStr; } calcMeasure(); }
        function calcMeasure() { if (!measA || !measB) return; const hDist = getDistance(measA.lat, measA.lng, measB.lat, measB.lng); document.getElementById('meas-horiz').innerText = `${hDist.toFixed(2)} m`; if (measA.alt !== null && measB.alt !== null) { const elev = measB.alt - measA.alt; const slant = Math.sqrt(hDist * hDist + elev * elev); document.getElementById('meas-elev').innerText = `${elev > 0 ? '+' : ''}${elev.toFixed(2)} m`; document.getElementById('meas-slant').innerText = `${slant.toFixed(2)} m`; } else { document.getElementById('meas-elev').innerText = "Nedostupné"; document.getElementById('meas-slant').innerText = "Nedostupné"; } }
        function resetMeasure() { measA = null; measB = null; document.getElementById('meas-a-coords').innerHTML = "Nenastaveno"; document.getElementById('meas-b-coords').innerHTML = "Nenastaveno"; document.getElementById('meas-horiz').innerText = "-- m"; document.getElementById('meas-elev').innerText = "-- m"; document.getElementById('meas-slant').innerText = "-- m"; }
        function updateFilters() { filters.tb = document.getElementById('f-tb').checked; filters.zhb = document.getElementById('f-zhb').checked; filters.pbpp = document.getElementById('f-pbpp').checked; filters.nivel = document.getElementById('f-nivel').checked; filters.custom = document.getElementById('f-custom').checked; setStoredData('arFilters12', JSON.stringify(filters)); drawAllMarkersOnMap(); }
        
        window.fetchDistantArea = async function(lat, lng, radius) {
            map.closePopup(); document.getElementById('info').innerHTML = `Stahuji vzdálenou oblast...`;
            showOfflineProgress(0, 6, 'Stahuji body v oblasti\u2026', 'krok\u016f');
            const rad = radius || mapRadius;
            let found = await fetchGeodata(lat, lng, rad, false, function(dn, tt) { updateOfflineProgress(dn, tt); });
            hideOfflineProgress();
            updateInfoPanel();
            if (lastFetchNetworkError && found === 0) { alert("ČÚZK je nedostupné nebo jste offline. Zkuste to prosím znovu."); return; }
            // Body i mapu rovnou ulozime pro offline -> kliknuti do mapy = oblast funguje i bez internetu.
            setStoredData('arOfflinePoints12', JSON.stringify(arPoints.filter(p => p.cat !== 'CUSTOM')));
            let tileMsg = '';
            if ('caches' in window) { try { const res = await cacheTilesForArea(lat, lng, rad); tileMsg = '\n' + offlineResultMsg(res); } catch (e) { tileMsg = '\nMapu se nepodařilo uložit offline: ' + ((e && e.message) ? e.message : e); } }
            alert(`Staženo ${found} bodů ve vybrané oblasti — uloženo pro offline.` + tileMsg);
        };

        
        // Stazeni mapovych dlazdic (OSM, zoom 15-17) pro oblast do TILE_CACHE, aby mapa fungovala offline.
        // Vraci podrobny vysledek vc. duvodu selhani — at nezustava nejasne "ulozeno X z Y".
        async function cacheTilesForArea(centerLat, centerLng, radius) {
            if (!('caches' in window)) return { unsupported: true, ok: 0, total: 0, net: 0, http: 0, quota: 0 };
            const latOffset = radius / 111320; const lonOffset = radius / (111320 * Math.cos(centerLat * Math.PI / 180));
            const minLat = centerLat - latOffset, maxLat = centerLat + latOffset, minLon = centerLng - lonOffset, maxLon = centerLng + lonOffset;
            let urls = [];
            // Mapa se otevira na zoomu 19, ale OSM vrstva ma maxNativeZoom 18 -> Leaflet stahuje dlazdice z18.
            // Proto MUSI byt z18 v cache, jinak je offline v zakladnim pohledu prazdno. 14-15 = kontext pri odzoomovani.
            [14, 15, 16, 17, 18].forEach(z => {
                let minX = Math.floor((minLon + 180) / 360 * Math.pow(2, z)); let maxX = Math.floor((maxLon + 180) / 360 * Math.pow(2, z));
                let minY = Math.floor((1 - Math.log(Math.tan(maxLat * Math.PI / 180) + 1 / Math.cos(maxLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
                let maxY = Math.floor((1 - Math.log(Math.tan(minLat * Math.PI / 180) + 1 / Math.cos(minLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
                for (let x = minX; x <= maxX; x++) { for (let y = minY; y <= maxY; y++) { urls.push(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`); } }
            });
            // Pojistka: pri velkem polomeru by z18 znamenal tisice dlazdic (zatez serveru i uloziste, proti pravidlum OSM).
            if (urls.length > 3000) return { tooMany: true, ok: 0, total: urls.length, net: 0, http: 0, quota: 0 };
            const total = urls.length; let done = 0, ok = 0, net = 0, http = 0, quota = 0;
            showOfflineProgress(0, total);
            const cache = await caches.open('argeodet-offline-v12');
            for (let i = 0; i < total; i += 10) {
                const chunk = urls.slice(i, i + 10);
                await Promise.all(chunk.map(async url => {
                    try {
                        const response = await fetch(url, { mode: 'cors' });
                        if (response.ok) { try { await cache.put(url, response); ok++; } catch (e) { quota++; } }
                        else http++;
                    } catch (e) { net++; }
                    done++;
                }));
                updateOfflineProgress(done, total);
            }
            hideOfflineProgress();
            return { ok, total, net, http, quota };
        }
        // Srozumitelna hlaska z vysledku cacheTilesForArea (misto tiche castecne chyby).
        function offlineResultMsg(res) {
            if (res.unsupported) return "Tento prohlížeč nepodporuje offline ukládání mapy.";
            if (res.tooMany) return `Oblast je příliš velká (${res.total} dílků mapy). Zmenšete poloměr stahování a zkuste to znovu.`;
            if (res.total === 0) return "V oblasti nejsou žádné mapové dlaždice ke stažení.";
            let msg = `Uloženo ${res.ok} z ${res.total} dílků mapy.`;
            const failed = res.total - res.ok;
            if (failed > 0) {
                let why = [];
                if (res.net) why.push(`${res.net}× výpadek sítě / offline`);
                if (res.http) why.push(`${res.http}× server odmítl`);
                if (res.quota) why.push(`${res.quota}× plné úložiště`);
                msg += `\n⚠ ${failed} dílků se NEULOŽILO` + (why.length ? ` (${why.join(', ')})` : '') + `.\nMísto se může offline zobrazit prázdné. Zkuste to znovu s lepším signálem nebo menším poloměrem.`;
            }
            return msg;
        }
        async function saveForOffline() {
            if (!userLat || !userLng) { alert("Počkejte prosím na načtení GPS polohy."); return; }
            const officialPoints = arPoints.filter(p => p.cat !== 'CUSTOM');
            if (!setStoredData('arOfflinePoints12', JSON.stringify(officialPoints))) { return; }
            if (!('caches' in window)) { alert("Tento prohlížeč nepodporuje offline ukládání mapy."); return; }
            try {
                const res = await cacheTilesForArea(userLat, userLng, mapRadius);
                alert(`Uloženo ${officialPoints.length} bodů pro tuto zakázku.\n` + offlineResultMsg(res));
            } catch (e) { hideOfflineProgress(); alert("Stahování mapy se nezdařilo: " + ((e && e.message) ? e.message : e)); }
        }

        function hideCurrentPoint() { if (hideBtnLogic) hideBtnLogic(); closeBottomSheet(); } function restoreHiddenPoints() { arPoints.forEach(p => p.hidden = false); initARMarkers(); drawAllMarkersOnMap(); document.getElementById('settings-modal').style.display = 'none'; updateInfoPanel(); } function clearAllPoints() { arPoints.forEach(p => { if(p.element) p.element.remove(); }); arPoints = []; removeStoredData('arOfflinePoints12'); document.getElementById('settings-modal').style.display = 'none'; if (userLat && userLng) initFetch(userLat, userLng); } function getVisiblePointsCount() { return arPoints.filter(p => !p.hidden && p.currentDist <= arRadius && (!searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()))).length; }
        function exportPoints() { if (persistentCustomPoints.length === 0) return alert("Nemáte žádné body."); const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(persistentCustomPoints)); const downloadAnchorNode = document.createElement('a'); downloadAnchorNode.setAttribute("href", dataStr); downloadAnchorNode.setAttribute("download", `moje_body_${activeProjectId}.json`); document.body.appendChild(downloadAnchorNode); downloadAnchorNode.click(); downloadAnchorNode.remove(); }
        // Export do CSV (seznam souradnic): radky "nazev;Y;X" v S-JTSK. BOM kvuli diakritice v Excelu.
        function exportPointsCSV() {
            if (persistentCustomPoints.length === 0) return alert("Nemáte žádné body.");
            let lines = persistentCustomPoints.map(pt => {
                let sj = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]);
                let y = Math.abs(sj[0]).toFixed(2), x = Math.abs(sj[1]).toFixed(2);
                let nm = String(pt.name == null ? 'Bod' : pt.name).replace(/[;\r\n]/g, ' ');
                return nm + ';' + y + ';' + x;
            });
            const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
            const a = document.createElement('a');
            a.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csv));
            a.setAttribute("download", `body_${activeProjectId}.csv`);
            document.body.appendChild(a); a.click(); a.remove();
        }
        // Export do TXT: stejne radky "nazev;Y;X" jako CSV (jdou rovnou zpet naimportovat), jen bez BOM
        function exportPointsTXT() {
            if (persistentCustomPoints.length === 0) return alert("Nem\u00e1te \u017e\u00e1dn\u00e9 body.");
            let lines = persistentCustomPoints.map(pt => {
                let sj = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]);
                let nm = String(pt.name == null ? 'Bod' : pt.name).replace(/[;\r\n]/g, ' ');
                return nm + ';' + Math.abs(sj[0]).toFixed(2) + ';' + Math.abs(sj[1]).toFixed(2);
            });
            const a = document.createElement('a');
            a.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(lines.join("\r\n") + "\r\n"));
            a.setAttribute("download", `body_${activeProjectId}.txt`);
            document.body.appendChild(a); a.click(); a.remove();
        }
        // S-JTSK Y,X (kladne) -> WGS84; mensi hodnota = Y, vetsi = X (Krovak: Y~400-900k, X~900-1280k)
        function sjtskToLatLng(a, b) {
            let Y = Math.min(Math.abs(a), Math.abs(b)), X = Math.max(Math.abs(a), Math.abs(b));
            let wgs = proj4("EPSG:5514", "EPSG:4326", [-Y, -X]); return { lat: wgs[1], lng: wgs[0] };
        }
        // Parser seznamu souradnic: radky "cislo Y X [Z]" oddelene ; , tab nebo mezerou.
        function parseCoordsCSV(text) {
            let out = [];
            text.split(/\r?\n/).forEach(line => {
                line = line.trim(); if (!line || line.startsWith('#') || line.startsWith('//')) return;
                let delim = line.indexOf(';') >= 0 ? ';' : (line.indexOf('\t') >= 0 ? '\t' : (/\s/.test(line) ? /\s+/ : ','));
                let parts = line.split(delim).map(t => t.trim()).filter(t => t !== '');
                if (parts.length < 3) return;
                let nums = parts.slice(1).map(t => parseFloat(t.replace(',', '.'))).filter(v => !isNaN(v));
                if (nums.length < 2) return;
                let c = sjtskToLatLng(nums[0], nums[1]);
                out.push({ name: parts[0], lat: c.lat, lng: c.lng });
            });
            return out;
        }
        // Jediny zdroj vkladani vlastnich bodu do zakazky: dedup podle cisla+lat+lng (vc. lng!),
        // obnova foto-dokumentace (p.doc). Pouziva import ze souboru i vlozeni v pruvodci.
        window.addImportedPoints = function (arr) {
            if (typeof persistentCustomPoints === 'undefined' || !Array.isArray(arr)) return 0;
            let added = 0;
            arr.forEach(p => {
                if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || isNaN(p.lat) || isNaN(p.lng)) return;
                if (persistentCustomPoints.find(ex => ex.name === p.name && Math.abs(ex.lat - p.lat) < 0.0001 && Math.abs(ex.lng - p.lng) < 0.0001)) return;
                const id = 'cp_' + Date.now() + '_' + Math.round(Math.random() * 1e6);
                persistentCustomPoints.push({ id: id, name: p.name || 'Bod', lat: p.lat, lng: p.lng, cat: 'CUSTOM', type: 'custom' });
                if (p.doc && typeof savePointDoc === 'function') { try { savePointDoc(id, (typeof _normalizeDoc === 'function' ? _normalizeDoc(p.doc) : p.doc)); } catch (e) {} }
                added++;
            });
            setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints));
            if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap();
            if (typeof renderManageList === 'function') renderManageList();
            if (userLat && userLng && typeof initFetch === 'function') initFetch(userLat, userLng);
            return added;
        };
        function importPoints(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                let txt = e.target.result, imported = null;
                try { let j = JSON.parse(txt); if (Array.isArray(j)) imported = j; } catch (err) {}
                if (!imported) imported = parseCoordsCSV(txt);
                if (!imported || imported.length === 0) { alert("V souboru se nenašly žádné body.\n\nPodporováno: JSON, nebo CSV/TXT s řádky 'číslo;Y;X' (oddělovač ; , tab nebo mezera)."); event.target.value = ''; return; }
                const added = window.addImportedPoints(imported);
                alert("Importováno " + added + " bodů do aktuální zakázky.");
                event.target.value = '';
            };
            reader.readAsText(file);
        }
        function deleteCustomPoint(id) { if(!confirm("Smazat?")) return; persistentCustomPoints = persistentCustomPoints.filter(p => p.id !== id); setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints)); pointLines = pointLines.filter(l => l.aId !== id && l.bId !== id); saveLines(); renderManageList(); drawAllMarkersOnMap(); const idx = arPoints.findIndex(p => p.id === id); if(idx !== -1) { if(arPoints[idx].element) arPoints[idx].element.remove(); arPoints.splice(idx, 1); } updateInfoPanel(); }
        // Vyplnit Y/X z PRUMEROVANE GPS polohy (presnejsi nez jeden odecet) + ulozit dosazenou presnost
        function fillAveragedGPS() {
            if (!gpsAvgResult || gpsAvgResult.n < 2) { alert("Počkejte na ustálení průměrování GPS (stůjte chvíli na místě)."); return; }
            const r = gpsAvgResult; let sjtsk = proj4("EPSG:4326", "EPSG:5514", [r.lng, r.lat]);
            document.getElementById('custom-y').value = Math.abs(sjtsk[0]).toFixed(2);
            document.getElementById('custom-x').value = Math.abs(sjtsk[1]).toFixed(2);
            pendingPointAccuracy = r.sterr;
            const note = document.getElementById('custom-acc-note');
            if (note) { note.style.display = 'block'; note.innerHTML = `Zprůměrováno z <b>${r.n}</b> měření · ⌀ přesnost <b>±${r.sterr.toFixed(2)} m</b> · σ ±${r.sigma.toFixed(2)} m`; }
        }
        
        function saveCustomPoint() { 
            const name = document.getElementById('custom-name').value || "Bod"; let inputY = parseFloat(document.getElementById('custom-y').value); let inputX = parseFloat(document.getElementById('custom-x').value); if (isNaN(inputY) || isNaN(inputX)) return alert("Vyplňte souřadnice!"); let krovakY = inputY > 0 ? -inputY : inputY; let krovakX = inputX > 0 ? -inputX : inputX; let wgs84 = proj4("EPSG:5514", "EPSG:4326", [krovakY, krovakX]); let lng = wgs84[0]; let lat = wgs84[1]; 
            if (editingCustomPointId) { const idx = persistentCustomPoints.findIndex(p => p.id === editingCustomPointId); if(idx !== -1) { persistentCustomPoints[idx].name = name; persistentCustomPoints[idx].lat = lat; persistentCustomPoints[idx].lng = lng; } const arIdx = arPoints.findIndex(p => p.id === editingCustomPointId); if (arIdx !== -1) { arPoints[arIdx].name = name; arPoints[arIdx].lat = lat; arPoints[arIdx].lng = lng; if(arPoints[arIdx].element) { arPoints[arIdx].element.remove(); arPoints[arIdx].element = null; } } } else { const newPoint = { id: 'cp_' + Date.now(), name: name, lat: lat, lng: lng, cat: "CUSTOM", type: "custom" }; if (pendingPointAccuracy != null) newPoint.acc = Math.round(pendingPointAccuracy * 100) / 100; persistentCustomPoints.push(newPoint); arPoints.push({...newPoint, hidden: false}); } pendingPointAccuracy = null; setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints)); drawAllMarkersOnMap(); closeCustomModal(); initARMarkers(); if (userLat && userLng) { updateInfoPanel(); } fixAppLayout(); 
        }


        function extractPointNumber(props) { if (!props) return "Bod"; const upperProps = {}; for (let key in props) upperProps[key.toUpperCase()] = props[key]; let name = upperProps['CISLO'] || upperProps['CISLO_BODU'] || upperProps['VLASTNI_CISLO'] || upperProps['OZNACENI'] || upperProps['UPLNE_CISLO'] || upperProps['NAZEV']; if (name && String(name).trim() !== "" && String(name).trim() !== "Null") return String(name).trim(); return "Bod"; }
        function getDistance(lat1, lon1, lat2, lon2) { const R = 6371e3, f1 = lat1 * Math.PI/180, f2 = lat2 * Math.PI/180; const df = (lat2-lat1) * Math.PI/180, dl = (lon2-lon1) * Math.PI/180; const a = Math.sin(df/2) * Math.sin(df/2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl/2) * Math.sin(dl/2); return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); }
        function getBearing(lat1, lon1, lat2, lon2) { const toRad = deg => deg * Math.PI / 180; const toDeg = rad => rad * 180 / Math.PI; const dLon = toRad(lon2 - lon1); const y = Math.sin(dLon) * Math.cos(toRad(lat2)); const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon); return (toDeg(Math.atan2(y, x)) + 360) % 360; }
        // rozdil dvou azimutu normalizovany do <-180, 180>
        function angDiff(a, b) { return ((a - b + 540) % 360) - 180; }
        // cyklicke vyhlazeni uhlu (resi prechod 359 -> 0); alpha 0..1 (vyssi = rychlejsi)
        function smoothAngle(prev, next, alpha) { if (prev === null) return ((next % 360) + 360) % 360; return ((prev + alpha * angDiff(next, prev)) % 360 + 360) % 360; }
        // MAGNETICKA DEKLINACE: kompas (senzor) meri magneticky sever, ale azimuty (getBearing)
        // pocitame k zemepisnemu severu. V CR je deklinace ~+5-6 vychodne a roste -> bez korekce
        // systematicka chyba smeru. Aproximace WMM2025 (linearni fit pro CR), driftuje +0.13 /rok.
        function getDeclination(lat, lng) {
            const now = new Date(); const year = now.getFullYear() + now.getMonth() / 12;
            return 5.65 + 0.25 * (lng - 15.5) - 0.05 * (lat - 49.8) + 0.13 * (year - 2025);
        }
        // VYSKA: coords.altitude je elipsoidicka (WGS84). Pro Bpv (vyska nad morem v CR) odecist
        // undulaci kvazigeoidu CR-2005 (~44-47 m). Linearni aproximace, presnost ~1-2 m
        // (hluboko pod svislou chybou telefonni GPS), odstranuje systematicky posun ~45 m.
        function getGeoidUndulation(lat, lng) { return 45.5 + 0.55 * (lng - 15.5) - 0.4 * (lat - 49.8); }
        // ROBUSTNI PRUMEROVANI GPS: median + MAD filtr hrubych chyb (prumer i 2-sigma prah
        // si outlier nafoukne sam, median ne), pak vazeny prumer podle hlasene presnosti fixu.
        // sterr pocitame z efektivniho n (po sobe jdouci fixy jsou korelovane, nejsou nezavisle).
        function _median(arr) { const a = arr.slice().sort((p, q) => p - q); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
        function updateGpsAveraging(lat, lng, acc, speed) {
            if (gpsSamples.length) {
                const ref = gpsAvgResult || gpsSamples[gpsSamples.length - 1];
                const moved = getDistance(ref.lat, ref.lng, lat, lng);
                if ((speed && speed > 0.5) || moved > 15) gpsSamples = [];
            }
            gpsSamples.push({ lat: lat, lng: lng, acc: (acc || 0) });
            if (gpsSamples.length > 300) gpsSamples.shift();
            const total = gpsSamples.length;
            // lokalni rovinne souradnice v metrech (kolem prvniho vzorku)
            const lat0 = gpsSamples[0].lat, lng0 = gpsSamples[0].lng;
            const mLat = 111320, mLng = 111320 * Math.cos(lat0 * Math.PI / 180);
            let used = gpsSamples.map(s => ({ s: s, x: (s.lng - lng0) * mLng, y: (s.lat - lat0) * mLat }));
            let cx = _median(used.map(p => p.x)), cy = _median(used.map(p => p.y));
            for (let it = 0; it < 3 && used.length >= 5; it++) {
                const r = used.map(p => Math.hypot(p.x - cx, p.y - cy));
                const thr = Math.max(3 * 1.4826 * _median(r), 1.5); // prah min 1.5 m, at nezahazujeme bezny sum
                const inl = used.filter((p, i) => r[i] <= thr);
                if (inl.length < 3 || inl.length === used.length) { if (inl.length >= 3) used = inl; break; }
                used = inl;
                cx = _median(used.map(p => p.x)); cy = _median(used.map(p => p.y));
            }
            let sw = 0, swx = 0, swy = 0;
            used.forEach(p => { const w = 1 / Math.pow(Math.max(p.s.acc || 5, 1), 2); sw += w; swx += w * p.x; swy += w * p.y; });
            const wx = swx / sw, wy = swy / sw;
            const sigma = Math.sqrt(used.reduce((a, p) => a + Math.pow(p.x - wx, 2) + Math.pow(p.y - wy, 2), 0) / used.length);
            const neff = Math.max(1, used.length / 4); // fixy ~1/s jsou korelovane v radu sekund
            const sterr = sigma / Math.sqrt(neff);
            const meanAcc = used.reduce((a, p) => a + (p.s.acc || 0), 0) / used.length;
            gpsAvgResult = { lat: lat0 + wy / mLat, lng: lng0 + wx / mLng, n: used.length, total: total, sigma: sigma, sterr: sterr, acc: meanAcc };
            updateGpsAvgPanel();
        }

        // FETCH s timeoutem: aby se stahovani nezaseklo navzdy, kdyz CUZK neodpovida.
        // Pri chybe site/timeoutu nastavi lastFetchNetworkError a chybu znovu vyhodi (puvodni try/catch ji spolkne).
        let lastFetchNetworkError = false;
        function fetchWithTimeout(url, ms = 12000) {
            const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
            return fetch(url, { signal: ctrl.signal })
                .catch(err => { lastFetchNetworkError = true; throw err; })
                .finally(() => clearTimeout(t));
        }
        // stabilni ID z polohy bodu -> pri opakovanem fetchi si bod udrzi stejne id (zvyrazneni, detail)
        function stableId(lat, lng) { return 'p_' + lat.toFixed(6) + '_' + lng.toFixed(6); }

        async function fetchGeodata(lat, lng, radius, clearExisting = false, onProgress = null) {
            lastFetchNetworkError = false;
            if (clearExisting) { arPoints.forEach(p => { if(p.element) p.element.remove(); }); arPoints = []; persistentCustomPoints.forEach(pt => arPoints.push({...pt})); }
            const fetchRadius = radius || mapRadius; const latOffset = fetchRadius / 111320; const lngOffset = fetchRadius / (111320 * Math.cos(lat * Math.PI / 180)); const bbox = `${lng - lngOffset},${lat - latOffset},${lng + lngOffset},${lat + latOffset}`; let newFoundCount = 0;
            let _gstep = 0; for (let layerId of [1, 2, 4, 5, 6]) { if (onProgress) onProgress(_gstep++, 6); 
                const url = `https://ags.cuzk.gov.cz/arcgis/rest/services/BodovaPole/MapServer/${layerId}/query?where=1%3D1&geometry=${bbox}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=json`;
                try { const response = await fetchWithTimeout(url); const data = await response.json(); if (data.features && data.features.length > 0) { data.features.forEach(feat => { const dist = getDistance(lat, lng, feat.geometry.y, feat.geometry.x); if (dist <= fetchRadius + 5) { const props = feat.attributes; const layerNum = parseInt(layerId, 10); const cisloBodu = extractPointNumber(props); const nameUpper = cisloBodu.toUpperCase(); let cat = "PBPP"; if (layerNum === 1) cat = "TB"; else if (layerNum === 2) cat = "ZHB"; else if (layerNum === 4 || layerNum === 5 || nameUpper.includes('-') || nameUpper.includes('NIVEL')) cat = "NIVEL"; const existing = arPoints.find(p => p.name === cisloBodu && Math.abs(p.lat - feat.geometry.y) < 0.00001); if (!existing) { arPoints.push({ id: stableId(feat.geometry.y, feat.geometry.x), name: cisloBodu, lat: feat.geometry.y, lng: feat.geometry.x, cat: cat, type: (cat==="NIVEL"?"vyskovy":"polohovy"), rawData: props, hidden: false, currentDist: dist, bestAccuracy: null }); newFoundCount++; } else if (existing.hidden) { existing.hidden = false; newFoundCount++; } } }); } } catch(e) {}
            }
            if (newFoundCount === 0 || !clearExisting) {
                const mapExtent = `${lng-0.005},${lat-0.005},${lng+0.005},${lat+0.005}`; const idUrl = `https://ags.cuzk.gov.cz/arcgis/rest/services/BodovaPole/MapServer/identify?geometry=${lng},${lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=${Math.max(fetchRadius, 40)}&mapExtent=${mapExtent}&imageDisplay=1000,1000,96&returnGeometry=true&f=json`;
                try { const idRes = await fetchWithTimeout(idUrl); const idData = await idRes.json(); if (idData.results && idData.results.length > 0) { idData.results.forEach(res => { const dist = getDistance(lat, lng, res.geometry.y, res.geometry.x); if (dist <= fetchRadius + 5) { const props = res.attributes; const layerNum = parseInt(res.layerId, 10); const cisloBodu = extractPointNumber(props); const nameUpper = cisloBodu.toUpperCase(); let cat = "PBPP"; if (layerNum === 1) cat = "TB"; else if (layerNum === 2) cat = "ZHB"; else if (layerNum === 4 || layerNum === 5 || nameUpper.includes('-') || nameUpper.includes('NIVEL')) cat = "NIVEL"; const existing = arPoints.find(p => p.name === cisloBodu && Math.abs(p.lat - res.geometry.y) < 0.00001); if (!existing) { arPoints.push({ id: stableId(res.geometry.y, res.geometry.x), name: cisloBodu, lat: res.geometry.y, lng: res.geometry.x, cat: cat, type: (cat==="NIVEL"?"vyskovy":"polohovy"), rawData: props, hidden: false, currentDist: dist, bestAccuracy: null }); newFoundCount++; } else if (existing.hidden) { existing.hidden = false; newFoundCount++; } } }); } } catch(e) {}
            }
            if (onProgress) onProgress(6, 6); initARMarkers(); drawAllMarkersOnMap(); return newFoundCount;
        }

        async function initFetch(lat, lng) {
            document.getElementById('info').innerHTML = `Stahuji data…`;
            await fetchGeodata(lat, lng, mapRadius, false);
            const officialCount = arPoints.filter(p => p.cat !== 'CUSTOM').length;
            if (lastFetchNetworkError && officialCount === 0) {
                document.getElementById('info').innerHTML = `<div class="rdt"><span class="rdt-l">ČÚZK</span><span class="rdt-v" style="color:var(--danger);">nedostupné / offline</span></div>`;
            } else { updateInfoPanel(); }
        }


        if ("geolocation" in navigator) {
            navigator.geolocation.watchPosition(
                (position) => {
                    userLat = position.coords.latitude; userLng = position.coords.longitude; magneticDeclination = getDeclination(userLat, userLng); 
                    userAlt = position.coords.altitude || null; 
                    currentGpsAccuracy = position.coords.accuracy; updateInfoPanel();
                    gpsSpeed = (position.coords.speed != null && !isNaN(position.coords.speed)) ? position.coords.speed : 0;
                    if (position.coords.heading != null && !isNaN(position.coords.heading) && gpsSpeed > 0.5) gpsCourse = position.coords.heading;
                    updateGpsAveraging(userLat, userLng, currentGpsAccuracy, gpsSpeed);
                    if (accuracyCircle) { accuracyCircle.setLatLng([userLat, userLng]); accuracyCircle.setRadius(currentGpsAccuracy); accuracyCircle.setStyle({ color: currentGpsAccuracy >= 7 ? '#ef4444' : '#34d399', fillColor: currentGpsAccuracy >= 7 ? '#ef4444' : '#34d399' }); } else { accuracyCircle = L.circle([userLat, userLng], { radius: currentGpsAccuracy, color: currentGpsAccuracy >= 7 ? '#ef4444' : '#34d399', fillColor: currentGpsAccuracy >= 7 ? '#ef4444' : '#34d399', fillOpacity: 0.15, weight: 2 }).addTo(map); }
                    
                    if (highlightedPointId) { let hlPt = arPoints.find(p => p.id === highlightedPointId); if (hlPt) { if (hlPt.bestAccuracy === null || currentGpsAccuracy < hlPt.bestAccuracy) { hlPt.bestAccuracy = currentGpsAccuracy; } } }

                    arPoints.forEach(p => { p.currentDist = getDistance(userLat, userLng, p.lat, p.lng); p.currentBearing = getBearing(userLat, userLng, p.lat, p.lng); }); arPoints.sort((a, b) => a.currentDist - b.currentDist);
                    if (activePointIdForModal) { const activePt = arPoints.find(p => p.id === activePointIdForModal); if (activePt) { const newDist = getDistance(userLat, userLng, activePt.lat, activePt.lng); const distEl = document.getElementById('sheet-distance-val'); if (distEl) distEl.innerText = `${newDist.toFixed(1)} m`; const gpsEl = document.getElementById('sheet-gps-val'); if (gpsEl) gpsEl.innerText = currentGpsAccuracy.toFixed(1); } }
                    if (lastCenterLat === null) { map.setView([userLat, userLng], 19, { animate: false }); lastCenterLat = userLat; lastCenterLng = userLng; } else if (!window._mapHold && getDistance(lastCenterLat, lastCenterLng, userLat, userLng) > 1.5) { map.setView([userLat, userLng], map.getZoom(), { animate: false }); lastCenterLat = userLat; lastCenterLng = userLng; }
                    if (lastFetchLat === null || lastFetchLng === null) { lastFetchLat = userLat; lastFetchLng = userLng; if (appStarted) setTimeout(() => initFetch(userLat, userLng), 1000); } else { const moved = getDistance(lastFetchLat, lastFetchLng, userLat, userLng); if (moved > 25) { lastFetchLat = userLat; lastFetchLng = userLng; if (appStarted) initFetch(userLat, userLng); } }
                    const userIcon = L.divIcon({ className: 'custom-user-icon', html: `<div id="user-direction-container" style="transition: transform 0.1s linear; width: 44px; height: 44px; display: flex; justify-content: center; align-items: center;"><div style="position:absolute; width: 28px; height: 28px; background: rgba(52, 211, 153, 0.3); border-radius: 50%; filter: blur(3px);"></div><svg width="24" height="24" viewBox="0 0 24 24" style="z-index: 2; transform: translateY(-3px); filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.6));"><path d="M12,2 L22,20 L12,16 L2,20 Z" fill="#34d399" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div>`, iconSize: [44, 44], iconAnchor: [22, 22] });
                    if (userMarker) userMarker.setLatLng([userLat, userLng]); else userMarker = L.marker([userLat, userLng], {icon: userIcon, zIndexOffset: 1000}).addTo(map);
                },
                (error) => { if (appStarted) document.getElementById('info').innerHTML = `Chyba GPS: ${error.message}`; },
                { enableHighAccuracy: true, maximumAge: 0, timeout: 27000 }
            );
        }

        // ===== SPOJNICE BODU (datova cast) =====
        // Ulozene cary mezi body: {id, aId, bId, aLat, aLng, bLat, bLng}. Per zakazka (klic arLines12).
        // Souradnice se ukladaji i primo do spojnice -> cara drzi, i kdyz bod zrovna neni stazeny.
        function loadLines() { pointLines = []; const l = getStoredData('arLines12'); if (l) { try { pointLines = JSON.parse(l); } catch (e) {} } }
        function saveLines() { setStoredData('arLines12', JSON.stringify(pointLines)); }
        function resolveLineEnd(id, fLat, fLng) { const p = arPoints.find(q => q.id === id) || persistentCustomPoints.find(q => q.id === id); return p ? { lat: p.lat, lng: p.lng } : { lat: fLat, lng: fLng }; }
        function addLine(a, b) {
            if (!a || !b || a.id === b.id) return false;
            if (pointLines.find(l => (l.aId === a.id && l.bId === b.id) || (l.aId === b.id && l.bId === a.id))) return false;
            pointLines.push({ id: 'ln_' + Date.now() + '_' + Math.round(Math.random() * 1e6), aId: a.id, bId: b.id, aName: a.name, bName: b.name, aLat: a.lat, aLng: a.lng, bLat: b.lat, bLng: b.lng });
            saveLines(); return true;
        }
        function deleteLine(id) { pointLines = pointLines.filter(l => l.id !== id); saveLines(); drawAllLinesOnMap(); }
        function lineEndName(id, stored) { const p = arPoints.find(q => q.id === id) || persistentCustomPoints.find(q => q.id === id); return (p && p.name) || stored || '?'; }
        // spolecny test filtru a vyhledavani (stejna logika jako pri kresleni mapy/AR)
        function passesFilters(pt) {
            if (pt.hidden) return false;
            if (pt.cat === 'TB' && !filters.tb) return false; if (pt.cat === 'ZHB' && !filters.zhb) return false;
            if (pt.cat === 'PBPP' && !filters.pbpp) return false; if (pt.cat === 'NIVEL' && !filters.nivel) return false;
            if (pt.cat === 'CUSTOM' && !filters.custom) return false;
            if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            return true;
        }

        // ===== MERENI PLOCHY =====
        // Plocha Gaussovou (shoelace) formuli a obvod v ROVINNYCH souradnicich S-JTSK -> pro CR presne.
        function polygonAreaPerimeter(verts) {
            if (!verts || verts.length < 2) return { area: 0, perim: 0 };
            const pts = verts.map(v => proj4("EPSG:4326", "EPSG:5514", [v.lng, v.lat]));
            let perim = 0;
            for (let i = 1; i < pts.length; i++) perim += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
            let area = 0;
            if (verts.length >= 3) {
                for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
                area = Math.abs(area) / 2;
                perim += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]); // uzavreni obvodu
            }
            return { area: area, perim: perim };
        }

        // ===== OCR: precteni cisla bodu a souradnic S-JTSK z fotky =====
        // Tesseract.js se nacita az pri prvnim pouziti (velka knihovna + jazykova data) -> prvni
        // pouziti vyzaduje internet, pak uz drzi v cache (SW caching CDN).
        let _tessLoadPromise = null;
        function ensureTesseract() {
            if (window.Tesseract) return Promise.resolve();
            if (!_tessLoadPromise) {
                _tessLoadPromise = new Promise((resolve, reject) => {
                    const sc = document.createElement('script');
                    sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
                    sc.onload = () => resolve();
                    sc.onerror = () => { _tessLoadPromise = null; reject(new Error('Nepodařilo se stáhnout OCR knihovnu — první použití vyžaduje internet.')); };
                    document.head.appendChild(sc);
                });
            }
            return _tessLoadPromise;
        }
        function _loadImageFromFile(file) { return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('Fotku se nepodařilo načíst.')); im.src = URL.createObjectURL(file); }); }
        // zmenseni fotky na rozumnou velikost (rychlost OCR)
        function _downscaleForOcr(img, maxDim) { const k = Math.min(1, maxDim / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c; }
        // Z prectenych cisel vybere Y (400-910 km) a X (930-1230 km) dle rozsahu S-JTSK v CR;
        // rozsahy se neprekryvaji -> prirazeni je jednoznacne. Cislo bodu = prvni male cele cislo.
        function parseOcrCoords(text) {
            const raw = text.match(/\d+(?:[.,]\d+)?/g) || [];
            let y = null, x = null, name = null;
            raw.forEach(t => {
                const v = parseFloat(t.replace(',', '.'));
                if (y === null && v >= 400000 && v <= 910000) y = v;
                else if (x === null && v >= 930000 && v <= 1230000) x = v;
                else if (name === null && v >= 1 && v < 100000 && t.indexOf('.') < 0 && t.indexOf(',') < 0) name = t;
            });
            return { y: y, x: x, name: name };
        }
        async function ocrFromPhoto(event) {
            const file = event.target.files[0]; event.target.value = ''; if (!file) return;
            showOfflineProgress(0, 100, 'Čtu souřadnice z fotky\u2026', '%');
            let worker = null;
            try {
                await ensureTesseract();
                const img = await _loadImageFromFile(file);
                const canvas = _downscaleForOcr(img, 1600);
                worker = await Tesseract.createWorker('eng', 1, { logger: m => { if (m.status === 'recognizing text') updateOfflineProgress(Math.round((m.progress || 0) * 100), 100); } });
                await worker.setParameters({ tessedit_char_whitelist: '0123456789.,;:-/YXZyxz ' });
                const res = await worker.recognize(canvas);
                hideOfflineProgress();
                applyOcrResult((res && res.data && res.data.text) ? res.data.text : '');
            } catch (e) {
                hideOfflineProgress();
                alert('Čtení z fotky se nezdařilo: ' + ((e && e.message) ? e.message : e));
            } finally { if (worker) { try { await worker.terminate(); } catch (e) {} } }
        }
        // Vysledek OCR jen PREDVYPLNI formular — ulozeni az po kontrole uzivatelem
        // (nepozorovany preklep od OCR je horsi nez rucni prepis).
        function applyOcrResult(text) {
            const r = parseOcrCoords(text);
            const note = document.getElementById('ocr-note');
            if (r.y === null && r.x === null && r.name === null) {
                if (note) { note.style.display = 'block'; note.innerHTML = 'Z fotky se nepodařilo nic přečíst. Zkuste ostřejší záběr zblízka, kolmo na text.'; }
                return;
            }
            if (r.name !== null && !document.getElementById('custom-name').value) document.getElementById('custom-name').value = r.name;
            if (r.y !== null) document.getElementById('custom-y').value = r.y.toFixed(2);
            if (r.x !== null) document.getElementById('custom-x').value = r.x.toFixed(2);
            if (note) {
                note.style.display = 'block';
                note.innerHTML = 'Přečteno z fotky: ' + (r.name !== null ? 'bod <b>' + r.name + '</b> · ' : '') + (r.y !== null ? 'Y <b>' + r.y.toFixed(2) + '</b>' : 'Y se nenašlo') + ' · ' + (r.x !== null ? 'X <b>' + r.x.toFixed(2) + '</b>' : 'X se nenašlo') + '<br><b>Zkontrolujte hodnoty proti originálu</b> — OCR se může splést.';
            }
        }
