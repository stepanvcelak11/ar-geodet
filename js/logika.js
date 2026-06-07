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
        const map = L.map('map', { maxZoom: 22, minZoom: 15, zoomControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false });
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
            ['arFilters12', 'arRadiusMap', 'arRadiusAR', 'arOfflinePoints12', 'arCustomPoints12', 'arVisSettings12'].forEach(k => {
                let v = localStorage.getItem(k); if(v) localStorage.setItem('default_' + k, v);
            });
            localStorage.setItem('arProjects_migrated', 'true');
        }
        function getStoreKey(key) { return `${activeProjectId}_${key}`; }
        function getStoredData(key) { return localStorage.getItem(getStoreKey(key)); }
        let _quotaWarned = false;
        function setStoredData(key, val) {
            try { localStorage.setItem(getStoreKey(key), val); return true; }
            catch (e) {
                if (!_quotaWarned) { _quotaWarned = true; alert('Úložiště telefonu je plné — data se neuložila. Uvolněte místo (smažte starou zakázku nebo stáhnuté offline okolí v Nastavení).'); }
                return false;
            }
        }
        function removeStoredData(key) { localStorage.removeItem(getStoreKey(key)); }

        let appStarted = false, viewMode = 'both', searchQuery = '', cameraStarted = false, currentVideoStream = null;
        let mapRadius = 1000, arRadius = 150;
        let userLat = null, userLng = null, userAlt = null, userMarker = null, lastFetchLat = null, lastFetchLng = null, lastCenterLat = null, lastCenterLng = null;
        let currentHeading = 0, currentGpsAccuracy = 0, accuracyCircle = null, magneticDeclination = 0;
        let smoothedHeading = null, gpsCourse = null, gpsSpeed = 0, headingCorrection = 0;
        let gpsSamples = [], gpsAvgResult = null;
        let arPoints = [], persistentCustomPoints = [], hideBtnLogic = null, editingCustomPointId = null, highlightedPointId = null, activePointIdForModal = null;
        let compassUnit = 'deg'; let compassZeroOffset = 0; let lastVibeTime = 0;
        let measA = null, measB = null;
        let wakeLock = null;
        let filters = { tb: true, zhb: true, pbpp: true, nivel: true, custom: true };

        let visSettings = { maxARPoints: 100, arVerticalOffset: 0, markerScale: 1.0, markerOpacity: 100, colTb: '#8b5cf6', colZhb: '#0ea5e9', colPbpp: '#3b82f6', colNivel: '#ef4444', colCustom: '#34d399', arrowScale: 1.0, arrowOpacity: 90, arrowShape: '1', colArrow: '#34d399', panelOpacity: 85, menuScale: 1.0, hudTop: 55, hudSide: 15, wakeLockEnabled: true, vibrationEnabled: true, ringOnGround: true, outdoorMode: false, katastrSource: 'mapycz', baseLayer: 'osm', showKatastr: false, headingSmoothing: 75, autoCompassCorrection: true, tiltCompensation: true, fovH: 90, fovV: 75, eyeHeight: 1.6 };
        
        function changeProject() { activeProjectId = document.getElementById('w-project-select').value; localStorage.setItem('arActiveProjectId', activeProjectId); loadProjectSettings(); }
        function createNewProject() { let name = prompt("Název nové zakázky:"); if(name) { let id = 'proj_' + Date.now(); projects.push({id: id, name: name}); localStorage.setItem('arProjectsList', JSON.stringify(projects)); activeProjectId = id; localStorage.setItem('arActiveProjectId', activeProjectId); renderProjectSelect(); loadProjectSettings(); } }
        function deleteProject() { if(projects.length <= 1) return alert("Nelze smazat poslední zakázku."); if(!confirm("Opravdu smazat aktuální zakázku a všechny její uložené body?")) return; projects = projects.filter(p => p.id !== activeProjectId); localStorage.setItem('arProjectsList', JSON.stringify(projects)); activeProjectId = projects[0].id; localStorage.setItem('arActiveProjectId', activeProjectId); renderProjectSelect(); loadProjectSettings(); }

        function loadProjectSettings() {
            let f = getStoredData('arFilters12'); if(f) filters = JSON.parse(f); else filters = { tb: true, zhb: true, pbpp: true, nivel: true, custom: true };
            let m = getStoredData('arRadiusMap'); if(m) mapRadius = parseInt(m); else mapRadius = 1000;
            let a = getStoredData('arRadiusAR'); if(a) arRadius = parseInt(a); else arRadius = 150;
            let vs = getStoredData('arVisSettings12'); if(vs) visSettings = Object.assign(visSettings, JSON.parse(vs));
            
            arPoints.forEach(p => { if(p.element) p.element.remove(); }); arPoints = []; persistentCustomPoints = [];
            let off = getStoredData('arOfflinePoints12'); if(off) { try { JSON.parse(off).forEach(p => { p.element=null; p.distElement=null; p.ringElement=null; p.bestAccuracy=null; p.hidden=false; arPoints.push(p); }); }catch(e){} }
            let cust = getStoredData('arCustomPoints12'); if(cust) { persistentCustomPoints = JSON.parse(cust); }

            document.getElementById('w-map-radius-slider').value = mapRadius; document.getElementById('w-map-radius-val').innerText = mapRadius;
            document.getElementById('w-ar-radius-slider').value = arRadius; document.getElementById('w-ar-radius-val').innerText = arRadius;
            document.getElementById('w-f-tb').checked = filters.tb; document.getElementById('w-f-zhb').checked = filters.zhb; document.getElementById('w-f-pbpp').checked = filters.pbpp; document.getElementById('w-f-nivel').checked = filters.nivel; document.getElementById('w-f-custom').checked = filters.custom;
            
            applyVisualSettings();
            if(appStarted) { drawAllMarkersOnMap(); initARMarkers(); if(userLat && userLng) initFetch(userLat, userLng); }
        }

        window.addEventListener('DOMContentLoaded', () => { renderProjectSelect(); loadProjectSettings(); });

        async function requestWakeLock() { if ('wakeLock' in navigator && visSettings.wakeLockEnabled) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} } }
        document.addEventListener('visibilitychange', () => { if (wakeLock !== null && document.visibilityState === 'visible' && visSettings.wakeLockEnabled) { requestWakeLock(); } });

        function setMeasurePoint(type) { if (!userLat || !userLng) return alert("Hledám GPS pozici. Počkejte chvíli..."); const pt = { lat: userLat, lng: userLng, alt: userAlt }; let altStr = "Výška: nedostupná"; if (pt.alt !== null) { let bpv = pt.alt - getGeoidUndulation(pt.lat, pt.lng); altStr = `Výška (Bpv): ${bpv.toFixed(1)} m`; } let sjtsk = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]); let coordsStr = `Y: ${Math.abs(sjtsk[0]).toFixed(2)} | X: ${Math.abs(sjtsk[1]).toFixed(2)}<br><span style="opacity:0.7;">${altStr}</span>`; if (type === 'A') { measA = pt; document.getElementById('meas-a-coords').innerHTML = coordsStr; } else { measB = pt; document.getElementById('meas-b-coords').innerHTML = coordsStr; } calcMeasure(); }
        function calcMeasure() { if (!measA || !measB) return; const hDist = getDistance(measA.lat, measA.lng, measB.lat, measB.lng); document.getElementById('meas-horiz').innerText = `${hDist.toFixed(2)} m`; if (measA.alt !== null && measB.alt !== null) { const elev = measB.alt - measA.alt; const slant = Math.sqrt(hDist * hDist + elev * elev); document.getElementById('meas-elev').innerText = `${elev > 0 ? '+' : ''}${elev.toFixed(2)} m`; document.getElementById('meas-slant').innerText = `${slant.toFixed(2)} m`; } else { document.getElementById('meas-elev').innerText = "Nedostupné"; document.getElementById('meas-slant').innerText = "Nedostupné"; } }
        function resetMeasure() { measA = null; measB = null; document.getElementById('meas-a-coords').innerHTML = "Nenastaveno"; document.getElementById('meas-b-coords').innerHTML = "Nenastaveno"; document.getElementById('meas-horiz').innerText = "-- m"; document.getElementById('meas-elev').innerText = "-- m"; document.getElementById('meas-slant').innerText = "-- m"; }
        function updateFilters() { filters.tb = document.getElementById('f-tb').checked; filters.zhb = document.getElementById('f-zhb').checked; filters.pbpp = document.getElementById('f-pbpp').checked; filters.nivel = document.getElementById('f-nivel').checked; filters.custom = document.getElementById('f-custom').checked; setStoredData('arFilters12', JSON.stringify(filters)); drawAllMarkersOnMap(); }
        
        window.fetchDistantArea = async function(lat, lng, radius) {
            map.closePopup(); document.getElementById('info').innerHTML = `Stahuji vzdálenou oblast...`;
            let found = await fetchGeodata(lat, lng, radius || mapRadius, false);
            updateInfoPanel();
            if (lastFetchNetworkError && found === 0) { alert("ČÚZK je nedostupné nebo jste offline. Zkuste to prosím znovu."); return; }
            alert(`Staženo ${found} bodů ve vybrané oblasti.\n\nPokud si chcete tuto oblast zachovat i bez internetu, klikněte v Menu na 'Uložit pro Offline'.`);
        };

        
        async function saveForOffline() {
            if (!userLat || !userLng) { alert("Počkejte prosím na načtení GPS polohy."); return; }
            alert("Spouštím stahování bodů a mapy...\nProsím, nevyplínejte aplikaci.");
            const officialPoints = arPoints.filter(p => p.cat !== 'CUSTOM');
            if (!setStoredData('arOfflinePoints12', JSON.stringify(officialPoints))) { return; }
            const r = mapRadius; const latOffset = r / 111320; const lonOffset = r / (111320 * Math.cos(userLat * Math.PI / 180));
            const minLat = userLat - latOffset; const maxLat = userLat + latOffset; const minLon = userLng - lonOffset; const maxLon = userLng + lonOffset;
            let urlsToCache = [];
            [15, 16, 17].forEach(z => {
                let minX = Math.floor((minLon + 180) / 360 * Math.pow(2, z)); let maxX = Math.floor((maxLon + 180) / 360 * Math.pow(2, z));
                let minY = Math.floor((1 - Math.log(Math.tan(maxLat * Math.PI / 180) + 1 / Math.cos(maxLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z)); let maxY = Math.floor((1 - Math.log(Math.tan(minLat * Math.PI / 180) + 1 / Math.cos(minLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
                for (let x = minX; x <= maxX; x++) { for (let y = minY; y <= maxY; y++) { urlsToCache.push(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`); } }
            });
            if ('caches' in window) { try { const cache = await caches.open('argeodet-offline-v12'); let count = 0; const total = urlsToCache.length; for (let i = 0; i < total; i += 10) { const chunk = urlsToCache.slice(i, i + 10); await Promise.all(chunk.map(async url => { try { const response = await fetch(url, {mode: 'cors'}); if(response.ok) await cache.put(url, response); } catch(e) {} count++; })); } alert(`Úspěšně uloženo ${officialPoints.length} bodů a ${total} dílků mapy pro tuto zakázku.`); } catch(e) {} }
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
                let delim = line.indexOf(';') >= 0 ? ';' : (line.indexOf(',') >= 0 ? ',' : (line.indexOf('\t') >= 0 ? '\t' : /\s+/));
                let parts = line.split(delim).map(t => t.trim()).filter(t => t !== '');
                if (parts.length < 3) return;
                let nums = parts.slice(1).map(t => parseFloat(t.replace(',', '.'))).filter(v => !isNaN(v));
                if (nums.length < 2) return;
                let c = sjtskToLatLng(nums[0], nums[1]);
                out.push({ name: parts[0], lat: c.lat, lng: c.lng });
            });
            return out;
        }
        function importPoints(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                let txt = e.target.result, imported = null;
                try { let j = JSON.parse(txt); if (Array.isArray(j)) imported = j; } catch (err) {}
                if (!imported) imported = parseCoordsCSV(txt);
                if (!imported || imported.length === 0) { alert("V souboru se nenašly žádné body.\n\nPodporováno: JSON, nebo CSV/TXT s řádky 'číslo;Y;X' (oddělovač ; , tab nebo mezera)."); event.target.value = ''; return; }
                let added = 0;
                imported.forEach(p => {
                    if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || isNaN(p.lat) || isNaN(p.lng)) return;
                    if (!persistentCustomPoints.find(ex => ex.name === p.name && Math.abs(ex.lat - p.lat) < 0.0001)) {
                        persistentCustomPoints.push({ id: 'cp_' + Date.now() + '_' + Math.round(Math.random() * 1e6), name: p.name || 'Bod', lat: p.lat, lng: p.lng, cat: "CUSTOM", type: "custom" });
                        added++;
                    }
                });
                setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints));
                drawAllMarkersOnMap(); renderManageList();
                alert("Importováno " + added + " bodů do aktuální zakázky.");
                if (userLat && userLng) initFetch(userLat, userLng);
                event.target.value = '';
            };
            reader.readAsText(file);
        }
        function deleteCustomPoint(id) { if(!confirm("Smazat?")) return; persistentCustomPoints = persistentCustomPoints.filter(p => p.id !== id); setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints)); renderManageList(); drawAllMarkersOnMap(); const idx = arPoints.findIndex(p => p.id === id); if(idx !== -1) { if(arPoints[idx].element) arPoints[idx].element.remove(); arPoints.splice(idx, 1); } updateInfoPanel(); }
        function fillCurrentGPS() { if (userLat && userLng) { let sjtsk = proj4("EPSG:4326", "EPSG:5514", [userLng, userLat]); document.getElementById('custom-y').value = Math.abs(sjtsk[0]).toFixed(2); document.getElementById('custom-x').value = Math.abs(sjtsk[1]).toFixed(2); } else { alert("GPS zatím není načtená."); } }
        
        function saveCustomPoint() { 
            const name = document.getElementById('custom-name').value || "Bod"; let inputY = parseFloat(document.getElementById('custom-y').value); let inputX = parseFloat(document.getElementById('custom-x').value); if (isNaN(inputY) || isNaN(inputX)) return alert("Vyplňte souřadnice!"); let krovakY = inputY > 0 ? -inputY : inputY; let krovakX = inputX > 0 ? -inputX : inputX; let wgs84 = proj4("EPSG:5514", "EPSG:4326", [krovakY, krovakX]); let lng = wgs84[0]; let lat = wgs84[1]; 
            if (editingCustomPointId) { const idx = persistentCustomPoints.findIndex(p => p.id === editingCustomPointId); if(idx !== -1) { persistentCustomPoints[idx].name = name; persistentCustomPoints[idx].lat = lat; persistentCustomPoints[idx].lng = lng; } const arIdx = arPoints.findIndex(p => p.id === editingCustomPointId); if (arIdx !== -1) { arPoints[arIdx].name = name; arPoints[arIdx].lat = lat; arPoints[arIdx].lng = lng; if(arPoints[arIdx].element) { arPoints[arIdx].element.remove(); arPoints[arIdx].element = null; } } } else { const newPoint = { id: 'cp_' + Date.now(), name: name, lat: lat, lng: lng, cat: "CUSTOM", type: "custom" }; persistentCustomPoints.push(newPoint); arPoints.push({...newPoint, hidden: false}); } setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints)); drawAllMarkersOnMap(); closeCustomModal(); initARMarkers(); if (userLat && userLng) { updateInfoPanel(); } fixAppLayout(); 
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
        // PRUMEROVANI GPS: pri stani sbira fixy, prumeruje a odstranuje hrube chyby (>2 sigma)
        function updateGpsAveraging(lat, lng, acc, speed) {
            if (gpsSamples.length) {
                let ml = 0, mg = 0; gpsSamples.forEach(s => { ml += s.lat; mg += s.lng; }); ml /= gpsSamples.length; mg /= gpsSamples.length;
                let moved = getDistance(ml, mg, lat, lng);
                if ((speed && speed > 0.5) || moved > 15) gpsSamples = [];
            }
            gpsSamples.push({ lat: lat, lng: lng, acc: (acc || 0) });
            if (gpsSamples.length > 300) gpsSamples.shift();
            let total = gpsSamples.length;
            let used = gpsSamples;
            let mlat = used.reduce((a, s) => a + s.lat, 0) / used.length;
            let mlng = used.reduce((a, s) => a + s.lng, 0) / used.length;
            let dists = used.map(s => getDistance(mlat, mlng, s.lat, s.lng));
            let sigma = Math.sqrt(dists.reduce((a, d) => a + d * d, 0) / used.length);
            if (used.length >= 5 && sigma > 0) {
                let inl = gpsSamples.filter((s, i) => dists[i] <= 2 * sigma);
                if (inl.length >= 3) {
                    used = inl;
                    mlat = used.reduce((a, s) => a + s.lat, 0) / used.length;
                    mlng = used.reduce((a, s) => a + s.lng, 0) / used.length;
                    sigma = Math.sqrt(used.reduce((a, s) => a + Math.pow(getDistance(mlat, mlng, s.lat, s.lng), 2), 0) / used.length);
                }
            }
            let meanAcc = used.reduce((a, s) => a + (s.acc || 0), 0) / used.length;
            let sterr = used.length > 0 ? sigma / Math.sqrt(used.length) : 0;
            gpsAvgResult = { lat: mlat, lng: mlng, n: used.length, total: total, sigma: sigma, sterr: sterr, acc: meanAcc };
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

        async function fetchGeodata(lat, lng, radius, clearExisting = false) {
            lastFetchNetworkError = false;
            if (clearExisting) { arPoints.forEach(p => { if(p.element) p.element.remove(); }); arPoints = []; persistentCustomPoints.forEach(pt => arPoints.push({...pt})); }
            const fetchRadius = radius || mapRadius; const latOffset = fetchRadius / 111320; const lngOffset = fetchRadius / (111320 * Math.cos(lat * Math.PI / 180)); const bbox = `${lng - lngOffset},${lat - latOffset},${lng + lngOffset},${lat + latOffset}`; let newFoundCount = 0;
            for (let layerId of [1, 2, 4, 5, 6]) { 
                const url = `https://ags.cuzk.gov.cz/arcgis/rest/services/BodovaPole/MapServer/${layerId}/query?where=1%3D1&geometry=${bbox}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=json`;
                try { const response = await fetchWithTimeout(url); const data = await response.json(); if (data.features && data.features.length > 0) { data.features.forEach(feat => { const dist = getDistance(lat, lng, feat.geometry.y, feat.geometry.x); if (dist <= fetchRadius + 5) { const props = feat.attributes; const layerNum = parseInt(layerId, 10); const cisloBodu = extractPointNumber(props); const nameUpper = cisloBodu.toUpperCase(); let cat = "PBPP"; if (layerNum === 1) cat = "TB"; else if (layerNum === 2) cat = "ZHB"; else if (layerNum === 4 || layerNum === 5 || nameUpper.includes('-') || nameUpper.includes('NIVEL')) cat = "NIVEL"; const existing = arPoints.find(p => p.name === cisloBodu && Math.abs(p.lat - feat.geometry.y) < 0.00001); if (!existing) { arPoints.push({ id: stableId(feat.geometry.y, feat.geometry.x), name: cisloBodu, lat: feat.geometry.y, lng: feat.geometry.x, cat: cat, type: (cat==="NIVEL"?"vyskovy":"polohovy"), rawData: props, hidden: false, currentDist: dist, bestAccuracy: null }); newFoundCount++; } else if (existing.hidden) { existing.hidden = false; newFoundCount++; } } }); } } catch(e) {}
            }
            if (newFoundCount === 0 || !clearExisting) {
                const mapExtent = `${lng-0.005},${lat-0.005},${lng+0.005},${lat+0.005}`; const idUrl = `https://ags.cuzk.gov.cz/arcgis/rest/services/BodovaPole/MapServer/identify?geometry=${lng},${lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=${Math.max(fetchRadius, 40)}&mapExtent=${mapExtent}&imageDisplay=1000,1000,96&returnGeometry=true&f=json`;
                try { const idRes = await fetchWithTimeout(idUrl); const idData = await idRes.json(); if (idData.results && idData.results.length > 0) { idData.results.forEach(res => { const dist = getDistance(lat, lng, res.geometry.y, res.geometry.x); if (dist <= fetchRadius + 5) { const props = res.attributes; const layerNum = parseInt(res.layerId, 10); const cisloBodu = extractPointNumber(props); const nameUpper = cisloBodu.toUpperCase(); let cat = "PBPP"; if (layerNum === 1) cat = "TB"; else if (layerNum === 2) cat = "ZHB"; else if (layerNum === 4 || layerNum === 5 || nameUpper.includes('-') || nameUpper.includes('NIVEL')) cat = "NIVEL"; const existing = arPoints.find(p => p.name === cisloBodu && Math.abs(p.lat - res.geometry.y) < 0.00001); if (!existing) { arPoints.push({ id: stableId(res.geometry.y, res.geometry.x), name: cisloBodu, lat: res.geometry.y, lng: res.geometry.x, cat: cat, type: (cat==="NIVEL"?"vyskovy":"polohovy"), rawData: props, hidden: false, currentDist: dist, bestAccuracy: null }); newFoundCount++; } else if (existing.hidden) { existing.hidden = false; newFoundCount++; } } }); } } catch(e) {}
            }
            initARMarkers(); drawAllMarkersOnMap(); return newFoundCount;
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
                    
                    arPoints.forEach(p => p.currentDist = getDistance(userLat, userLng, p.lat, p.lng)); arPoints.sort((a, b) => a.currentDist - b.currentDist);
                    if (activePointIdForModal) { const activePt = arPoints.find(p => p.id === activePointIdForModal); if (activePt) { const newDist = getDistance(userLat, userLng, activePt.lat, activePt.lng); const distEl = document.getElementById('sheet-distance-val'); if (distEl) distEl.innerText = `${newDist.toFixed(1)} m`; const gpsEl = document.getElementById('sheet-gps-val'); if (gpsEl) gpsEl.innerText = currentGpsAccuracy.toFixed(1); } }
                    if (lastCenterLat === null) { map.setView([userLat, userLng], 19, { animate: false }); lastCenterLat = userLat; lastCenterLng = userLng; } else if (getDistance(lastCenterLat, lastCenterLng, userLat, userLng) > 1.5) { map.setView([userLat, userLng], map.getZoom(), { animate: false }); lastCenterLat = userLat; lastCenterLng = userLng; }
                    if (lastFetchLat === null || lastFetchLng === null) { lastFetchLat = userLat; lastFetchLng = userLng; if (appStarted) setTimeout(() => initFetch(userLat, userLng), 1000); } else { const moved = getDistance(lastFetchLat, lastFetchLng, userLat, userLng); if (moved > 25) { lastFetchLat = userLat; lastFetchLng = userLng; if (appStarted) initFetch(userLat, userLng); } }
                    const userIcon = L.divIcon({ className: 'custom-user-icon', html: `<div id="user-direction-container" style="transition: transform 0.1s linear; width: 44px; height: 44px; display: flex; justify-content: center; align-items: center;"><div style="position:absolute; width: 28px; height: 28px; background: rgba(52, 211, 153, 0.3); border-radius: 50%; filter: blur(3px);"></div><svg width="24" height="24" viewBox="0 0 24 24" style="z-index: 2; transform: translateY(-3px); filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.6));"><path d="M12,2 L22,20 L12,16 L2,20 Z" fill="#34d399" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div>`, iconSize: [44, 44], iconAnchor: [22, 22] });
                    if (userMarker) userMarker.setLatLng([userLat, userLng]); else userMarker = L.marker([userLat, userLng], {icon: userIcon, zIndexOffset: 1000}).addTo(map);
                },
                (error) => { if (appStarted) document.getElementById('info').innerHTML = `Chyba GPS: ${error.message}`; },
                { enableHighAccuracy: true, maximumAge: 0, timeout: 27000 }
            );
        }
