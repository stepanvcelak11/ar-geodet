// ===== AR Geodet - GRAFICKA CAST (vykreslovani) =====
// AR znacky a sipka, mapa, kompas, modaly, nastaveni vzhledu, ovladani displeje.
// Nacita se PO logika.js (pouziva jeji promenne a funkce).

function renderProjectSelect() {
            const sel = document.getElementById('w-project-select'); sel.innerHTML = '';
            projects.forEach(p => { const opt = document.createElement('option'); opt.value = p.id; opt.innerText = p.name; if(p.id === activeProjectId) opt.selected = true; sel.appendChild(opt); });
        }
        const arrowPaths = { '1': "M50 10 L90 50 L70 50 L70 95 L30 95 L30 50 L10 50 Z", '2': "M50 10 L70 30 L55 30 L55 95 L45 95 L45 30 L30 30 Z", '3': "M50 10 L90 50 L70 60 L50 40 L30 60 L10 50 Z", '4': "M50 10 L90 90 L50 70 L10 90 Z", '5': "M50 10 L90 50 L50 90 L10 50 Z" };

        function applyVisualSettings() {
            document.documentElement.style.setProperty('--hud-top', visSettings.hudTop + 'px'); document.documentElement.style.setProperty('--hud-side', visSettings.hudSide + 'px'); document.documentElement.style.setProperty('--marker-opacity', visSettings.markerOpacity / 100); document.documentElement.style.setProperty('--color-tb', visSettings.colTb); document.documentElement.style.setProperty('--color-zhb', visSettings.colZhb); document.documentElement.style.setProperty('--color-pbpp', visSettings.colPbpp); document.documentElement.style.setProperty('--color-nivel', visSettings.colNivel); document.documentElement.style.setProperty('--color-custom', visSettings.colCustom); document.documentElement.style.setProperty('--arrow-size', (100 * visSettings.arrowScale) + 'px'); document.documentElement.style.setProperty('--arrow-opacity', visSettings.arrowOpacity / 100); document.documentElement.style.setProperty('--color-arrow', visSettings.colArrow); document.documentElement.style.setProperty('--panel-opacity', visSettings.panelOpacity / 100); document.documentElement.style.setProperty('--menu-scale', visSettings.menuScale);
            document.documentElement.style.setProperty('--ring-top', visSettings.ringOnGround ? '160%' : '50%');
            const arrPath = document.getElementById('main-arrow-path'); if(arrPath) { arrPath.setAttribute('d', arrowPaths[visSettings.arrowShape]); arrPath.setAttribute('fill', visSettings.colArrow); document.getElementById('arrow-straight').style.filter = `drop-shadow(0 15px 15px ${visSettings.colArrow}80)`; document.getElementById('target-circle-out').setAttribute('stroke', visSettings.colArrow); document.getElementById('target-circle-in').setAttribute('fill', visSettings.colArrow); document.getElementById('arrow-target').style.filter = `drop-shadow(0 15px 15px ${visSettings.colArrow}90)`; }
            if (document.getElementById('s-max-ar-slider')) { document.getElementById('s-wakelock').checked = visSettings.wakeLockEnabled; document.getElementById('s-vibration').checked = visSettings.vibrationEnabled; document.getElementById('s-ring-ground').checked = visSettings.ringOnGround; document.getElementById('s-katastr-source').value = visSettings.katastrSource || 'mapycz'; document.getElementById('s-max-ar-slider').value = visSettings.maxARPoints; document.getElementById('s-max-ar-val').innerText = visSettings.maxARPoints; document.getElementById('v-ar-height-slider').value = visSettings.arVerticalOffset; document.getElementById('v-ar-height-val').innerText = visSettings.arVerticalOffset; document.getElementById('v-hud-top').value = visSettings.hudTop; document.getElementById('v-hud-top-val').innerText = visSettings.hudTop; document.getElementById('v-hud-side').value = visSettings.hudSide; document.getElementById('v-hud-side-val').innerText = visSettings.hudSide; document.getElementById('v-marker-scale').value = Math.round(visSettings.markerScale * 100); document.getElementById('v-marker-scale-val').innerText = Math.round(visSettings.markerScale * 100); document.getElementById('v-marker-opacity').value = visSettings.markerOpacity; document.getElementById('v-marker-opacity-val').innerText = visSettings.markerOpacity; document.getElementById('col-tb').value = visSettings.colTb; document.getElementById('col-zhb').value = visSettings.colZhb; document.getElementById('col-pbpp').value = visSettings.colPbpp; document.getElementById('col-nivel').value = visSettings.colNivel; document.getElementById('col-custom').value = visSettings.colCustom; document.getElementById('col-arrow').value = visSettings.colArrow; document.getElementById('v-arrow-shape').value = visSettings.arrowShape; document.getElementById('v-arrow-scale').value = Math.round(visSettings.arrowScale * 100); document.getElementById('v-arrow-scale-val').innerText = Math.round(visSettings.arrowScale * 100); document.getElementById('v-arrow-opacity').value = visSettings.arrowOpacity; document.getElementById('v-arrow-opacity-val').innerText = visSettings.arrowOpacity; document.getElementById('v-panel-opacity').value = visSettings.panelOpacity; document.getElementById('v-panel-opacity-val').innerText = visSettings.panelOpacity; document.getElementById('v-menu-scale').value = Math.round(visSettings.menuScale * 100); document.getElementById('v-menu-scale-val').innerText = Math.round(visSettings.menuScale * 100); document.getElementById('s-auto-compass').checked = visSettings.autoCompassCorrection; document.getElementById('s-heading-smooth').value = visSettings.headingSmoothing; document.getElementById('s-heading-smooth-val').innerText = visSettings.headingSmoothing; document.getElementById('s-fovh').value = visSettings.fovH; document.getElementById('s-fovh-val').innerText = visSettings.fovH; document.getElementById('s-fovv').value = visSettings.fovV; document.getElementById('s-fovv-val').innerText = visSettings.fovV; document.getElementById('s-eyeh').value = visSettings.eyeHeight; document.getElementById('s-eyeh-val').innerText = visSettings.eyeHeight; }
        }

        function switchTab(tabId, btnEl) { document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active')); document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); document.getElementById(tabId).classList.add('active'); btnEl.classList.add('active'); }
        function toggleMenu() { document.getElementById('side-menu').classList.toggle('open'); } function toggleHudElements() { document.getElementById('info').style.display = document.getElementById('tgl-info').checked ? 'block' : 'none'; document.getElementById('compass-debug').style.display = document.getElementById('tgl-compass').checked ? 'block' : 'none'; updateGpsAvgPanel(); }
        function fixAppLayout() { setTimeout(() => { window.scrollTo(0, 0); document.body.scrollTop = 0; }, 100); } document.querySelectorAll('input').forEach(input => { input.addEventListener('blur', fixAppLayout); });
        
        function openKatastr() { 
            if(!userLat || !userLng) return alert("Čekám na GPS pozici..."); 
            let src = visSettings.katastrSource || 'mapycz';
            let url = `https://mapy.cz/katastralni?x=${userLng}&y=${userLat}&z=19`;
            if (src === 'ikatastr') url = `https://www.ikatastr.cz/ikatastr.htm#zoom=19&lat=${userLat}&lon=${userLng}`;
            else if (src === 'cuzk') url = `https://geoportal.cuzk.cz/geoprohlizec/?lon=${userLng}&lat=${userLat}&zoom=14`;
            window.open(url, '_blank'); 
        }

        function openCompassModal() { document.getElementById('compass-modal').style.display = 'flex'; updateCompassButtons(); } function setCompassZero() { compassZeroOffset = currentHeading; alert("Nula nastavena na aktuální směr."); document.getElementById('compass-modal').style.display = 'none'; } function resetCompassZero() { compassZeroOffset = 0; alert("Nula zrušena."); document.getElementById('compass-modal').style.display = 'none'; } function setCompassUnit(u) { compassUnit = u; updateCompassButtons(); }
        function updateCompassButtons() { document.getElementById('btn-unit-deg').style.background = compassUnit === 'deg' ? 'var(--accent)' : '#555'; document.getElementById('btn-unit-deg').style.color = compassUnit === 'deg' ? '#000' : '#fff'; document.getElementById('btn-unit-gon').style.background = compassUnit === 'gon' ? 'var(--accent)' : '#555'; document.getElementById('btn-unit-gon').style.color = compassUnit === 'gon' ? '#000' : '#fff'; }

        function openMeasureModal() { document.getElementById('measure-modal').style.display = 'flex'; }

        async function loadCameras() { const btn = document.getElementById('camera-load-btn'); btn.innerText = "Načítám..."; try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); const devices = await navigator.mediaDevices.enumerateDevices(); const videoDevices = devices.filter(d => d.kind === 'videoinput'); const wSelect = document.getElementById('w-camera-select'); const sSelect = document.getElementById('s-camera-select'); wSelect.innerHTML = '<option value="">Výchozí zadní kamera</option>'; sSelect.innerHTML = '<option value="">Výchozí zadní kamera</option>'; videoDevices.forEach(cam => { if (!cam.label.toLowerCase().includes('front') && !cam.label.toLowerCase().includes('přední')) { const labelText = cam.label || `Kamera ${wSelect.options.length}`; const opt1 = document.createElement('option'); opt1.value = cam.deviceId; opt1.text = labelText; wSelect.appendChild(opt1); const opt2 = document.createElement('option'); opt2.value = cam.deviceId; opt2.text = labelText; sSelect.appendChild(opt2); } }); stream.getTracks().forEach(t => t.stop()); btn.style.display = 'none'; wSelect.style.display = 'block'; } catch(e) { alert("Nepodařilo se načíst seznam kamer."); btn.innerHTML = '<svg class="icon"><use href="#i-camera"/></svg> Zkusit znovu načíst kamery'; } }

        function updateInfoPanel() { const infoEl = document.getElementById('info'); if (!infoEl || !appStarted) return; if (!userLat) { infoEl.innerHTML = `<div class="rdt"><span class="rdt-l">GPS</span><span class="rdt-v" style="color:var(--warning);">hledám…</span></div>`; return; } let accColor = currentGpsAccuracy >= 7 ? 'var(--danger)' : 'var(--accent)'; infoEl.innerHTML = `<div class="rdt"><span class="rdt-l">Přesnost</span><span class="rdt-v" style="color:${accColor};">±${currentGpsAccuracy.toFixed(1)} m</span></div><div class="rdt"><span class="rdt-l">V&nbsp;AR</span><span class="rdt-v">${getVisiblePointsCount()} / ${visSettings.maxARPoints}</span></div>`; }

        function startAppFromWelcome() { mapRadius = parseInt(document.getElementById('w-map-radius-slider').value); arRadius = parseInt(document.getElementById('w-ar-radius-slider').value); filters.tb = document.getElementById('w-f-tb').checked; filters.zhb = document.getElementById('w-f-zhb').checked; filters.pbpp = document.getElementById('w-f-pbpp').checked; filters.nivel = document.getElementById('w-f-nivel').checked; filters.custom = document.getElementById('w-f-custom').checked; searchQuery = document.getElementById('w-search-name').value.trim(); const viewRadios = document.getElementsByName('w-view'); for(let r of viewRadios) { if(r.checked) viewMode = r.value; } document.getElementById('s-map-radius-slider').value = mapRadius; document.getElementById('s-map-radius-val').innerText = mapRadius; document.getElementById('s-ar-radius-slider').value = arRadius; document.getElementById('s-ar-radius-val').innerText = arRadius; document.getElementById('f-tb').checked = filters.tb; document.getElementById('f-zhb').checked = filters.zhb; document.getElementById('f-pbpp').checked = filters.pbpp; document.getElementById('f-nivel').checked = filters.nivel; document.getElementById('f-custom').checked = filters.custom; document.getElementById('s-search-name').value = searchQuery; document.getElementById('s-camera-select').value = document.getElementById('w-camera-select').value; const sViewRadios = document.getElementsByName('s-view'); for(let r of sViewRadios) { if(r.value === viewMode) r.checked = true; } document.getElementById('menu-toggle-btn').style.display = "block"; toggleHudElements(); document.getElementById('welcome-screen').style.opacity = '0'; setTimeout(() => { document.getElementById('welcome-screen').style.display = 'none'; }, 400); appStarted = true; applyViewMode(); drawAllMarkersOnMap(); if (userLat && userLng) { initFetch(userLat, userLng); } else { document.getElementById('info').innerHTML = "Hledám GPS signál..."; } requestWakeLock(); }

        function applyViewMode() { const camCont = document.getElementById('camera-container'); const mapCont = document.getElementById('map-container'); const resizer = document.getElementById('resizer'); if (viewMode === 'both') { camCont.style.display = 'block'; camCont.style.flex = '0 0 50%'; mapCont.style.display = 'block'; mapCont.style.flex = '1'; resizer.style.display = 'flex'; startCameraAndCompass(); } else if (viewMode === 'map') { camCont.style.display = 'none'; mapCont.style.display = 'block'; mapCont.style.flex = '1'; resizer.style.display = 'none'; } else if (viewMode === 'ar') { camCont.style.display = 'block'; camCont.style.flex = '1'; mapCont.style.display = 'none'; resizer.style.display = 'none'; startCameraAndCompass(); } setTimeout(() => { map.invalidateSize(); }, 300); }

        function startCameraAndCompass(forceRestart = false) { if (cameraStarted && !forceRestart) return; cameraStarted = true; if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') { DeviceOrientationEvent.requestPermission().then(permission => { if (permission === 'granted') window.addEventListener('deviceorientation', handleOrientation); }); } else { window.addEventListener('deviceorientationabsolute', handleOrientation); window.addEventListener('deviceorientation', handleOrientation); } if (currentVideoStream) { currentVideoStream.getTracks().forEach(track => track.stop()); } const camId = document.getElementById('s-camera-select') ? document.getElementById('s-camera-select').value : null; const videoConstraints = camId ? { deviceId: { exact: camId } } : { facingMode: "environment" }; navigator.mediaDevices.getUserMedia({ video: videoConstraints }).then(stream => { currentVideoStream = stream; const videoElement = document.getElementById('camera-feed'); videoElement.srcObject = stream; videoElement.style.display = "block"; }).catch(err => { alert("Chyba kamery: " + err.message); }); }

        const resizer = document.getElementById('resizer'); const camCont = document.getElementById('camera-container'); let lastTapTime = 0; let isCamMaximized = false;
        resizer.addEventListener('touchmove', (e) => { const h = (e.touches[0].clientY / window.innerHeight) * 100; camCont.style.flex = `0 0 ${h}%`; });
        resizer.addEventListener('touchend', (e) => { const currentTime = new Date().getTime(); const tapLength = currentTime - lastTapTime; if (tapLength < 300 && tapLength > 0) { if (isCamMaximized) { camCont.style.transition = 'flex 0.3s ease'; camCont.style.flex = `0 0 50%`; isCamMaximized = false; } else { camCont.style.transition = 'flex 0.3s ease'; camCont.style.flex = `0 0 85%`; isCamMaximized = true; } setTimeout(() => { camCont.style.transition = 'none'; map.invalidateSize(); }, 300); } lastTapTime = currentTime; });

        function getMapMarkerSVG(category, color) { if(category === 'TB') return `<svg viewBox="0 0 24 24"><polygon points="12,2 22,20 2,20" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; if(category === 'ZHB') return `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; if(category === 'PBPP') return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; if(category === 'NIVEL') return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="3"/><circle cx="12" cy="12" r="3" fill="${color}"/></svg>`; if(category === 'CUSTOM') return `<svg viewBox="0 0 24 24"><path d="M12,2 C7,2 3,6 3,11 C3,18 12,22 12,22 C12,22 21,18 21,11 C21,6 17,2 12,2 Z" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="${color}"/></svg>`; }

        function drawAllMarkersOnMap() {
            markersGroup.clearLayers();
            arPoints.forEach(pt => {
                if (pt.hidden) return; if (pt.cat === 'TB' && !filters.tb) return; if (pt.cat === 'ZHB' && !filters.zhb) return; if (pt.cat === 'PBPP' && !filters.pbpp) return; if (pt.cat === 'NIVEL' && !filters.nivel) return; if (pt.cat === 'CUSTOM' && !filters.custom) return; if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) return;
                let col = visSettings.colTb; if(pt.cat === 'ZHB') col = visSettings.colZhb; if(pt.cat === 'PBPP') col = visSettings.colPbpp; if(pt.cat === 'NIVEL') col = visSettings.colNivel; if(pt.cat === 'CUSTOM') col = visSettings.colCustom;
                const svgIcon = getMapMarkerSVG(pt.cat, col); const htmlContent = `<div style="position: relative; width: 24px; height: 24px; pointer-events:none;">${svgIcon}<div class="map-label-text" style="transform: rotate(${currentHeading}deg);">${pt.name}</div></div>`;
                const icon = L.divIcon({ className: 'custom-map-marker', html: htmlContent, iconSize: [24, 24], iconAnchor: [12, 12] });
                L.marker([pt.lat, pt.lng], { icon: icon }).addTo(markersGroup);
            });
        }

        function getMapClickLatLng(e) {
            const oe = e.originalEvent || {};
            const px = (oe.touches && oe.touches[0]) ? oe.touches[0].clientX : (oe.changedTouches && oe.changedTouches[0] ? oe.changedTouches[0].clientX : oe.clientX);
            const py = (oe.touches && oe.touches[0]) ? oe.touches[0].clientY : (oe.changedTouches && oe.changedTouches[0] ? oe.changedTouches[0].clientY : oe.clientY);
            if (px == null || py == null) return e.latlng;
            const userEl = document.getElementById('user-direction-container');
            let Px, Py, P;
            if (userEl && userLat != null) {
                const ur = userEl.getBoundingClientRect(); Px = ur.left + ur.width / 2; Py = ur.top + ur.height / 2;
                P = map.latLngToContainerPoint([userLat, userLng]);
            } else {
                const rect = document.getElementById('map').getBoundingClientRect(); Px = rect.left + rect.width / 2; Py = rect.top + rect.height / 2;
                const sz = map.getSize(); P = L.point(sz.x / 2, sz.y / 2);
            }
            const rad = currentHeading * Math.PI / 180; const dx = px - Px, dy = py - Py;
            const lx = dx * Math.cos(rad) - dy * Math.sin(rad); const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
            return map.containerPointToLatLng(L.point(P.x + lx, P.y + ly));
        }
        map.on('click', (e) => {
            if (!appStarted) return; const clickLatLng = getMapClickLatLng(e); const clickPoint = map.latLngToContainerPoint(clickLatLng); const nearbyPoints = [];
            arPoints.forEach(pt => {
                if (pt.hidden) return; if (pt.cat === 'TB' && !filters.tb) return; if (pt.cat === 'ZHB' && !filters.zhb) return; if (pt.cat === 'PBPP' && !filters.pbpp) return; if (pt.cat === 'NIVEL' && !filters.nivel) return; if (pt.cat === 'CUSTOM' && !filters.custom) return; if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) return;
                const ptLatLng = L.latLng(pt.lat, pt.lng); const ptPoint = map.latLngToContainerPoint(ptLatLng); const pixelDist = clickPoint.distanceTo(ptPoint);
                if (pixelDist <= 25) { nearbyPoints.push(pt); }
            });
            if (nearbyPoints.length === 1) { highlightPoint(nearbyPoints[0]); } 
            else if (nearbyPoints.length > 1) { showClusterList(nearbyPoints); }
            else {
                // KLIKNUTÍ DO PRÁZDNA - STAŽENÍ VZDÁLENÉ OBLASTI
                L.popup().setLatLng(clickLatLng).setContent(`<div style="text-align:center;"><div style="font-weight:bold; margin-bottom:6px; color:#000;">Vzdálená oblast</div><div style="color:#000; font-size:12px;">Poloměr: <span id="dl-radius-val">${mapRadius}</span> m</div><input type="range" id="dl-radius" min="200" max="5000" step="100" value="${mapRadius}" style="width:100%; margin:4px 0;" oninput="document.getElementById('dl-radius-val').innerText=this.value"><button class="btn btn-blue" style="padding:8px; width:100%; margin:6px 0 0 0;" onclick="fetchDistantArea(${clickLatLng.lat}, ${clickLatLng.lng}, parseInt(document.getElementById('dl-radius').value))"><svg class="icon"><use href="#i-download"/></svg> Stáhnout okolí</button></div>`).openOn(map);
            }
        });

        function showClusterList(points) {
            const listDiv = document.getElementById('cluster-list'); listDiv.innerHTML = '';
            points.forEach(pt => {
                let typBodu = "Podrobný polohový bod"; if(pt.cat === 'TB') typBodu = "Trigonometrický bod"; if(pt.cat === 'ZHB') typBodu = "Zhušťovací bod"; if(pt.cat === 'NIVEL') typBodu = "Nivelační / Výškový bod"; if(pt.cat === 'CUSTOM') typBodu = "Vlastní bod";
                const dist = getDistance(userLat, userLng, pt.lat, pt.lng); const item = document.createElement('div'); item.className = 'cluster-list-item';
                let col = visSettings.colTb; if(pt.cat === 'ZHB') col = visSettings.colZhb; if(pt.cat === 'PBPP') col = visSettings.colPbpp; if(pt.cat === 'NIVEL') col = visSettings.colNivel; if(pt.cat === 'CUSTOM') col = visSettings.colCustom;
                item.innerHTML = `<div><div class="cluster-item-title" style="color: ${col};">#${pt.name}</div><div class="cluster-item-subtitle">${typBodu}</div></div><div style="font-weight: 600; font-size: 14px;">${dist.toFixed(1)} m</div>`;
                item.addEventListener('click', () => { document.getElementById('cluster-modal').style.display = 'none'; highlightPoint(pt); }); listDiv.appendChild(item);
            });
            document.getElementById('cluster-modal').style.display = 'flex';
        }

        function openSettings() { document.getElementById('settings-modal').style.display = 'flex'; applyVisualSettings(); }
        
        function saveSettings() { 
            mapRadius = parseInt(document.getElementById('s-map-radius-slider').value); setStoredData('arRadiusMap', mapRadius); 
            arRadius = parseInt(document.getElementById('s-ar-radius-slider').value); setStoredData('arRadiusAR', arRadius); 
            searchQuery = document.getElementById('s-search-name').value.trim();
            const sViewRadios = document.getElementsByName('s-view'); for(let r of sViewRadios) { if(r.checked) viewMode = r.value; }
            const oldCam = document.getElementById('w-camera-select').value; const newCam = document.getElementById('s-camera-select').value; document.getElementById('w-camera-select').value = newCam; 
            visSettings.wakeLockEnabled = document.getElementById('s-wakelock').checked;
            visSettings.vibrationEnabled = document.getElementById('s-vibration').checked;
            visSettings.ringOnGround = document.getElementById('s-ring-ground').checked;
            visSettings.katastrSource = document.getElementById('s-katastr-source').value;
            visSettings.maxARPoints = parseInt(document.getElementById('s-max-ar-slider').value);
            visSettings.arVerticalOffset = parseInt(document.getElementById('v-ar-height-slider').value);
            visSettings.hudTop = parseInt(document.getElementById('v-hud-top').value); visSettings.hudSide = parseInt(document.getElementById('v-hud-side').value);
            visSettings.markerScale = parseInt(document.getElementById('v-marker-scale').value) / 100; visSettings.markerOpacity = parseInt(document.getElementById('v-marker-opacity').value);
            visSettings.colTb = document.getElementById('col-tb').value; visSettings.colZhb = document.getElementById('col-zhb').value; visSettings.colPbpp = document.getElementById('col-pbpp').value; visSettings.colNivel = document.getElementById('col-nivel').value; visSettings.colCustom = document.getElementById('col-custom').value;
            visSettings.arrowScale = parseInt(document.getElementById('v-arrow-scale').value) / 100; visSettings.arrowOpacity = parseInt(document.getElementById('v-arrow-opacity').value); visSettings.arrowShape = document.getElementById('v-arrow-shape').value; visSettings.colArrow = document.getElementById('col-arrow').value;
            visSettings.panelOpacity = parseInt(document.getElementById('v-panel-opacity').value); visSettings.menuScale = parseInt(document.getElementById('v-menu-scale').value) / 100;
            visSettings.autoCompassCorrection = document.getElementById('s-auto-compass').checked; visSettings.headingSmoothing = parseInt(document.getElementById('s-heading-smooth').value); visSettings.fovH = parseInt(document.getElementById('s-fovh').value); visSettings.fovV = parseInt(document.getElementById('s-fovv').value); visSettings.eyeHeight = parseFloat(document.getElementById('s-eyeh').value);
            setStoredData('arVisSettings12', JSON.stringify(visSettings)); applyVisualSettings(); drawAllMarkersOnMap();
            document.getElementById('settings-modal').style.display = 'none';
            if (oldCam !== newCam && viewMode !== 'map') { startCameraAndCompass(true); applyViewMode(); } else { applyViewMode(); }
            if(userLat && userLng) initFetch(userLat, userLng); fixAppLayout(); if(visSettings.wakeLockEnabled) requestWakeLock();
        }
        function openManageModal() { document.getElementById('settings-modal').style.display = 'none'; renderManageList(); document.getElementById('manage-modal').style.display = 'flex'; }
        function closeManageModal() { document.getElementById('manage-modal').style.display = 'none'; fixAppLayout(); }
        function renderManageList() { const listDiv = document.getElementById('manage-list'); listDiv.innerHTML = ''; if (persistentCustomPoints.length === 0) { listDiv.innerHTML = '<p style="text-align:center;">Žádné body v této zakázce.</p>'; return; } persistentCustomPoints.forEach(pt => { let sjtsk = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]); let dispY = Math.abs(sjtsk[0]).toFixed(2); let dispX = Math.abs(sjtsk[1]).toFixed(2); const item = document.createElement('div'); item.className = 'cp-item'; item.innerHTML = ` <div class="cp-title">${pt.name}</div> <div class="cp-coords">Y: ${dispY}<br>X: ${dispX}</div> <div class="cp-actions"> <button class="cp-btn cp-btn-edit" onclick="editCustomPoint('${pt.id}')"><svg class="icon"><use href="#i-edit"/></svg></button> <button class="cp-btn cp-btn-delete" onclick="deleteCustomPoint('${pt.id}')"><svg class="icon"><use href="#i-trash"/></svg></button></div>`; listDiv.appendChild(item); }); }
        function editCustomPoint(id) { const pt = persistentCustomPoints.find(p => p.id === id); if(!pt) return; editingCustomPointId = id; document.getElementById('custom-modal-title').innerText = "Upravit bod"; document.getElementById('custom-name').value = pt.name; let sjtsk = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]); document.getElementById('custom-y').value = Math.abs(sjtsk[0]).toFixed(2); document.getElementById('custom-x').value = Math.abs(sjtsk[1]).toFixed(2); document.getElementById('manage-modal').style.display = 'none'; document.getElementById('custom-modal-overlay').style.display = 'flex'; }
        function openNewPointModal() { editingCustomPointId = null; document.getElementById('custom-modal-title').innerText = "Vložit bod"; document.getElementById('custom-name').value = ''; document.getElementById('custom-y').value = ''; document.getElementById('custom-x').value = ''; document.getElementById('custom-modal-overlay').style.display = 'flex'; }
        function closeCustomModal() { document.getElementById('custom-modal-overlay').style.display = 'none'; fixAppLayout(); }
        function closeBottomSheet() { document.getElementById('bottom-sheet').classList.remove('open'); arPoints.forEach(p => { if (p.element) p.element.classList.remove('active-reading'); }); activePointIdForModal = null; }

        function toggleHighlight() { if (highlightedPointId === activePointIdForModal) { highlightedPointId = null; } else { highlightedPointId = activePointIdForModal; } closeBottomSheet(); arPoints.forEach(p => { if (p.element) { if (p.id === highlightedPointId) { p.element.classList.add('highlighted'); } else { p.element.classList.remove('highlighted'); } } }); if (!highlightedPointId) { document.getElementById('ar-hud').style.display = 'none'; } }

        // klik na bod v mape -> rovnou nastavit jako cil navigace v AR (zlata znacka + sipka)
        function highlightPoint(pt) {
            highlightedPointId = (highlightedPointId === pt.id) ? null : pt.id;
            initARMarkers();
            arPoints.forEach(p => { if (p.element) { if (p.id === highlightedPointId) p.element.classList.add('highlighted'); else p.element.classList.remove('highlighted'); } });
            if (!highlightedPointId) document.getElementById('ar-hud').style.display = 'none';
            drawAllMarkersOnMap();
            if (visSettings.vibrationEnabled && navigator.vibrate) navigator.vibrate(40);
        }
        // panel prumerovani GPS (vykresleni); data pocita updateGpsAveraging v logika.js
        function updateGpsAvgPanel() {
            const el = document.getElementById('gps-avg'); if (!el) return;
            const tgl = document.getElementById('tgl-gpsavg');
            if (!appStarted || !tgl || !tgl.checked) { el.style.display = 'none'; return; }
            el.style.display = 'block';
            const r = gpsAvgResult;
            document.getElementById('ga-n').innerText = (r && r.total) ? ((r.total > r.n) ? (r.n + ' (z ' + r.total + ')') : ('' + r.n)) : '0';
            document.getElementById('ga-pos').innerText = (r && r.acc) ? ('\u00b1' + r.acc.toFixed(1) + ' m') : '\u2026';
            document.getElementById('ga-se').innerText = (r && r.n >= 2) ? ('\u00b1' + r.sigma.toFixed(2) + ' m') : '\u2026';
        }

        const arOverlay = document.getElementById('ar-overlay');
        let arRing = null, arStem = null;
        function showGroundRing(xPct, groundY, markerY, acc, scale) {
            if (!arRing) { arRing = document.createElement('div'); arRing.className = 'ar-accuracy-ring'; arRing.style.zIndex = '2'; arOverlay.appendChild(arRing); }
            if (!arStem) { arStem = document.createElement('div'); arStem.className = 'ar-ground-stem'; arOverlay.appendChild(arStem); }
            let size = Math.max(24, acc * 70 * scale);
            arRing.style.left = xPct + '%'; arRing.style.top = groundY + '%';
            arRing.style.width = size + 'px'; arRing.style.height = size + 'px'; arRing.style.display = 'block';
            arStem.style.left = xPct + '%'; arStem.style.top = markerY + '%';
            arStem.style.height = Math.max(0, groundY - markerY) + '%'; arStem.style.display = 'block';
        }
        function hideGroundRing() { if (arRing) arRing.style.display = 'none'; if (arStem) arStem.style.display = 'none'; }
        function initARMarkers() {
            arPoints.forEach((pt) => {
                let matchesSearch = true; if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) { matchesSearch = false; }
                let outOfReach = (pt.currentDist > arRadius); let isSelectedForDetail = (pt.id === activePointIdForModal);
                if (pt.hidden || !matchesSearch || (outOfReach && pt.id !== highlightedPointId && !isSelectedForDetail)) { if (pt.element && pt.element.parentNode) pt.element.parentNode.removeChild(pt.element); return; }
                if (!pt.element) { const marker = document.createElement('div'); marker.className = `ar-marker cat-${pt.cat.toLowerCase()}`; if (pt.id === highlightedPointId) marker.classList.add('highlighted'); marker.style.opacity = '0'; const title = document.createElement('div'); title.className = 'ar-marker-title'; title.innerText = pt.name; const dist = document.createElement('div'); dist.className = 'ar-marker-dist'; marker.appendChild(title); marker.appendChild(dist); marker.addEventListener('click', () => { const currentDist = getDistance(userLat, userLng, pt.lat, pt.lng); showDetails(pt, currentDist); }); pt.element = marker; pt.distElement = dist; arOverlay.appendChild(marker); } else if (!pt.element.parentNode) { arOverlay.appendChild(pt.element); }
            });
        }
        let mapReturnTimer;
        function recenterOnUser() { if (userLat == null) return; clearTimeout(mapReturnTimer); map.setView([userLat, userLng], map.getZoom(), { animate: true }); lastCenterLat = userLat; lastCenterLng = userLng; }
        let isDraggingMap = false; let startTouchX = 0, startTouchY = 0; let lastTouchX = 0, lastTouchY = 0; const mapContainerEl = document.getElementById('map-container');
        mapContainerEl.addEventListener('touchstart', (e) => { if (e.touches.length === 1 && !e.target.closest('.glass-panel')) { isDraggingMap = true; clearTimeout(mapReturnTimer); startTouchX = e.touches[0].clientX; startTouchY = e.touches[0].clientY; lastTouchX = startTouchX; lastTouchY = startTouchY; } }, { passive: true });
        mapContainerEl.addEventListener('touchmove', (e) => { if (!isDraggingMap || e.touches.length !== 1) return; const dx = e.touches[0].clientX - lastTouchX; const dy = e.touches[0].clientY - lastTouchY; const rad = (viewMode === 'map' ? 0 : currentHeading) * Math.PI / 180; const mapDx = -(dx * Math.cos(rad) - dy * Math.sin(rad)); const mapDy = -(dx * Math.sin(rad) + dy * Math.cos(rad)); map.panBy([mapDx, mapDy], { animate: false });
            // OMEZENI: nedovol odjet od sebe dal nez stazena oblast (jinak se ztratis v prazdne mape)
            if (userLat != null) { const c = map.getSize().divideBy(2); const up = map.latLngToContainerPoint([userLat, userLng]); const offX = up.x - c.x, offY = up.y - c.y; const dist = Math.hypot(offX, offY); const maxOff = Math.min(mapContainerEl.clientWidth, mapContainerEl.clientHeight) * 0.4; if (dist > maxOff) { const k = dist - maxOff; map.panBy([offX / dist * k, offY / dist * k], { animate: false }); } }
            lastTouchX = e.touches[0].clientX; lastTouchY = e.touches[0].clientY; if(e.cancelable) e.preventDefault(); }, { passive: false });
        mapContainerEl.addEventListener('touchend', (e) => { if (isDraggingMap) { isDraggingMap = false; clearTimeout(mapReturnTimer); mapReturnTimer = setTimeout(recenterOnUser, 5000); } }); 

        function showDetails(pt, distance) {
            activePointIdForModal = pt.id; initARMarkers(); arPoints.forEach(p => { if (p.element) p.element.classList.remove('active-reading'); }); if (pt.element) pt.element.classList.add('active-reading');
            let typBodu = "Podrobný polohový bod"; if(pt.cat === 'TB') typBodu = "Trigonometrický bod"; if(pt.cat === 'ZHB') typBodu = "Zhušťovací bod"; if(pt.cat === 'NIVEL') typBodu = "Nivelační / Výškový bod"; if(pt.cat === 'CUSTOM') typBodu = "Vlastní zadaný bod";
            document.getElementById('det-title').innerHTML = `#${pt.name}`; document.getElementById('det-title').style.color = "var(--accent)"; document.getElementById('det-subtitle').innerHTML = typBodu; 
            const hlBtn = document.getElementById('highlight-btn'); if (highlightedPointId === pt.id) { hlBtn.innerHTML = '<svg class="icon"><use href="#i-star"/></svg> Zrušit zvýraznění'; hlBtn.style.background = "#fff"; } else { hlBtn.innerHTML = '<svg class="icon"><use href="#i-star"/></svg> Zvýraznit bod a navigovat'; hlBtn.style.background = "#fbbf24"; }
            hideBtnLogic = () => { pt.hidden = true; if(pt.element) { pt.element.style.opacity = '0'; setTimeout(() => { if(pt.element && pt.element.parentNode) pt.element.parentNode.removeChild(pt.element); }, 200); } if (highlightedPointId === pt.id) { highlightedPointId = null; document.getElementById('ar-hud').style.display = 'none'; } updateInfoPanel(); drawAllMarkersOnMap(); };
            let sjtskY = "Neznámé", sjtskX = "Neznámé"; if (pt.type === "custom") { let sjtsk = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]); sjtskY = Math.abs(sjtsk[0]).toFixed(2); sjtskX = Math.abs(sjtsk[1]).toFixed(2); } else if (pt.rawData) { const getVal = (keys) => { for (let k in pt.rawData) { if (keys.includes(k.toUpperCase()) && pt.rawData[k] !== "Null" && pt.rawData[k] !== null && String(pt.rawData[k]).trim() !== "") return pt.rawData[k]; } return null; }; let sY = parseFloat(getVal(['Y', 'SOURADNICE_Y'])); let sX = parseFloat(getVal(['X', 'SOURADNICE_X'])); if (!isNaN(sY) && !isNaN(sX)) { if (sY < sX) { sjtskY = sY; sjtskX = sX; } else { sjtskY = sX; sjtskX = sY; } } }
            let html = ` <div class="geo-data-row"><span class="geo-label">Vzdálenost</span><span class="geo-value" id="sheet-distance-val">${distance.toFixed(1)} m</span></div> <div class="geo-data-row"><span class="geo-label">S-JTSK Y</span><span class="geo-value">${sjtskY}</span></div> <div class="geo-data-row"><span class="geo-label">S-JTSK X</span><span class="geo-value">${sjtskX}</span></div> `;
            if (pt.type === "custom") { html += `<div style="text-align:center; padding: 25px 0; opacity:0.6; font-style:italic;">Ručně vytvořený bod. Můžete jej spravovat v Nastavení.</div>`; } else if (pt.rawData) { const props = pt.rawData; const getVal = (keys) => { for (let k in props) { if (keys.includes(k.toUpperCase()) && props[k] !== "Null" && props[k] !== null && String(props[k]).trim() !== "") return props[k]; } return null; }; const stabilizace = getVal(['STABILIZACE', 'TYP_ZNAK', 'TYP_ZNAKU', 'ZNAK', 'POPIS_ZNAKU']); const vyska = getVal(['VYSKA_NAD_TERENEM', 'VYSKA_ZNAKU', 'UMISTENI']); let geodataLink = null; for (let k in props) { if (typeof props[k] === 'string' && props[k].startsWith('http')) { geodataLink = props[k]; break; } } if (stabilizace || vyska !== null) { html += `<div class="geo-highlight" style="border-left-color: var(--accent);">`; if (stabilizace) html += `<div class="geo-data-row" style="border:none; padding: 4px 0;"><span class="geo-label" style="color:var(--text-color);">Stabilizace:</span><span class="geo-value">${stabilizace}</span></div>`; if (vyska !== null) html += `<div class="geo-data-row" style="border:none; padding: 4px 0;"><span class="geo-label" style="color:var(--text-color);">Výška n. terénem:</span><span class="geo-value">${vyska} m</span></div>`; html += `</div>`; } if (geodataLink) html += `<a href="${geodataLink}" target="_blank" class="btn-link"><svg class="icon"><use href="#i-file-text"/></svg> Otevřít nákres (Polohopis)</a>`; html += `<details><summary>Zobrazit všechny úřední záznamy</summary><div style="margin-top:10px;">`; for (let key in pt.rawData) { if (pt.rawData[key] && pt.rawData[key] !== "Null" && key !== "OBJECTID" && key !== "SHAPE") { let cleanKey = key.replace(/_/g, ' '); cleanKey = cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1); html += `<div class="geo-data-row"><span class="geo-label">${cleanKey}</span><span class="geo-value" style="font-weight:400;">${pt.rawData[key]}</span></div>`; } } html += `</div></details>`; }
            html += `<div style="margin-top:15px; padding:12px; background:rgba(251,191,36,0.1); border-left:4px solid #fbbf24; border-radius:8px; font-size:13px; line-height:1.4;"><strong><svg class="icon" style="vertical-align:-0.18em; color:#fbbf24;"><use href="#i-alert"/></svg> Rádius hledání (Vaše GPS: ±<span id="sheet-gps-val">${currentGpsAccuracy.toFixed(1)}</span> m)</strong><br>Bod nehledejte na centimetr přesně na AR značce. Může ležet kdekoliv v tomto kruhovém okruhu od značky.</div>`;
            document.getElementById('det-body').innerHTML = html; document.getElementById('bottom-sheet').classList.add('open');
        }
        const mapWrapper = document.getElementById('map-wrapper'); const compassDebug = document.getElementById('compass-debug');
        // VYKON: udalosti senzoru chodi i 60+x/s; prekreslujeme max 1x za snimek (requestAnimationFrame)
        let _orientPending = false, _lastOrientEvent = null;
        function handleOrientation(event) {
            _lastOrientEvent = event;
            if (_orientPending) return;
            _orientPending = true;
            requestAnimationFrame(() => { _orientPending = false; renderAR(_lastOrientEvent); });
        }
        function renderAR(event) {
            if (!userLat || !userLng || viewMode === 'map') return;
            let rawCompass = event.webkitCompassHeading || (event.alpha !== null ? 360 - event.alpha : null); if (rawCompass === null) return;
            // SMER: pri pohybu auto-koriguj magneticky kompas podle GPS kurzu (potlaci magneticke ruseni)
            if (visSettings.autoCompassCorrection && gpsCourse !== null && gpsSpeed > 0.7) {
                let want = angDiff(gpsCourse, rawCompass);
                headingCorrection += 0.05 * angDiff(want, headingCorrection);
                if (headingCorrection > 180) headingCorrection -= 360; else if (headingCorrection < -180) headingCorrection += 360;
            }
            let corrected = (rawCompass + headingCorrection + 360) % 360;
            // SMER: cyklicke vyhlazeni (mene roztreseny obraz); sila dle nastaveni
            let smoothAlpha = Math.max(0.05, 1 - (visSettings.headingSmoothing || 0) / 100);
            smoothedHeading = smoothAngle(smoothedHeading, corrected, smoothAlpha);
            let heading = smoothedHeading; currentHeading = heading;
            let relativeHeadingDeg = (heading - compassZeroOffset + 360) % 360; let displayAzimut = "";
            if (compassUnit === 'gon') { let gonTotal = relativeHeadingDeg * (400 / 360); let grad = Math.floor(gonTotal); let centigrad = Math.floor((gonTotal - grad) * 100); displayAzimut = `${grad}<sup>g</sup> ${centigrad.toString().padStart(2, '0')}<sup>c</sup>`; } else { displayAzimut = `${relativeHeadingDeg.toFixed(1)} °`; }
            compassDebug.innerHTML = `Azimut: ${displayAzimut}`;
            mapWrapper.style.transformOrigin = (function(){ const p = map.latLngToContainerPoint([userLat, userLng]); return p.x + 'px ' + p.y + 'px'; })(); mapWrapper.style.transform = `translate(-50%, -50%) rotate(${-heading}deg)`; const dirContainer = document.getElementById('user-direction-container'); if (dirContainer) dirContainer.style.transform = `rotate(${heading}deg)`;
            document.querySelectorAll('.map-label-text').forEach(el => { el.style.transform = `rotate(${heading}deg)`; });
            document.querySelectorAll('.leaflet-popup-content-wrapper').forEach(el => { el.style.transform = `rotate(${heading}deg)`; });
            
            // AR PROJEKCE: realny zorny uhel kamery + sklon telefonu (z beta)
            let beta = (event.beta !== null) ? event.beta : 90;
            let cameraPitchDown = 90 - beta;                 // o kolik stupnu pod horizont miri kamera
            let fovH = visSettings.fovH || 90, fovV = visSettings.fovV || 75, eyeH = visSettings.eyeHeight || 1.6;
            let halfH = fovH / 2, halfV = fovV / 2, cullH = halfH + 8;
            let highlightedPointData = null; let renderedCount = 0; let ringShown = false;

            let maxPts = visSettings.maxARPoints || 100; let vOffset = visSettings.arVerticalOffset || 0;

            arPoints.forEach(pt => {
                let isVisible = true; if (pt.hidden) isVisible = false; if (pt.cat === 'TB' && !filters.tb) isVisible = false; if (pt.cat === 'ZHB' && !filters.zhb) isVisible = false; if (pt.cat === 'PBPP' && !filters.pbpp) isVisible = false; if (pt.cat === 'NIVEL' && !filters.nivel) isVisible = false; if (pt.cat === 'CUSTOM' && !filters.custom) isVisible = false; if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) isVisible = false;
                const distance = pt.currentDist || getDistance(userLat, userLng, pt.lat, pt.lng);
                let isSelectedForDetail = (pt.id === activePointIdForModal);
                if (distance > arRadius && pt.id !== highlightedPointId && !isSelectedForDetail) isVisible = false;
                if (isVisible && pt.id !== highlightedPointId && !isSelectedForDetail) { if (renderedCount >= maxPts) { isVisible = false; } else { renderedCount++; } }
                if (!isVisible) { if (pt.element) pt.element.style.opacity = '0'; return; }

                const pointBearing = getBearing(userLat, userLng, pt.lat, pt.lng); let diff = ((pointBearing - heading + 540) % 360) - 180;
                if (pt.id === highlightedPointId) { highlightedPointData = { diff: diff, dist: distance, name: pt.name }; }
                if (Math.abs(diff) < cullH) {
                    const xPct = 50 + (diff / halfH) * 50;
                    // svisle: depresni uhel k bodu na zemi vs. kam miri kamera, promitnuty pres svisly FOV
                    let depression = Math.atan2(eyeH, Math.max(distance, 0.5)) * 180 / Math.PI;
                    let screenAng = depression - cameraPitchDown;
                    let groundY = 50 + (screenAng / halfV) * 50 - vOffset;
                    if (groundY < 3) groundY = 3; else if (groundY > 97) groundY = 97;
                    let markerY = groundY;
                    let normDist = distance / Math.max(arRadius, 100); if (normDist > 1) normDist = 1;
                    let scale = (0.9 - (normDist * 0.4)) * visSettings.markerScale;
                    
                    if (pt.id === highlightedPointId) { 
                        pt.element.style.zIndex = 99999; scale = scale * 1.25; 
                    } else { 
                        pt.element.style.zIndex = Math.round(1000 - distance); 
                    }
                    if (pt.element) { pt.element.style.left = `${xPct}%`; pt.element.style.top = `${markerY}%`; pt.element.style.transform = `translate(-50%, -50%) scale(${scale}) translateZ(0)`; pt.element.style.opacity = '1'; pt.element.style.pointerEvents = 'auto'; pt.distElement.innerText = `${distance.toFixed(1)} m`; }
                } else { if (pt.element) pt.element.style.opacity = '0'; }
            });
            
            if (!ringShown) hideGroundRing();
            if (highlightedPointData) {
                document.getElementById('ar-hud').style.display = 'flex'; const arrTarget = document.getElementById('arrow-target'); const arrStraight = document.getElementById('arrow-straight'); const arrLeft = document.getElementById('arrow-left'); const arrRight = document.getElementById('arrow-right'); const arrUturn = document.getElementById('arrow-uturn'); const arrBull = document.getElementById('arrow-bullseye'); const hudDistText = document.getElementById('ar-hud-dist'); const hudInfoBox = document.getElementById('ar-hud-info');
                arrTarget.style.display = 'none'; arrStraight.style.display = 'none'; arrLeft.style.display = 'none'; arrRight.style.display = 'none'; arrUturn.style.display = 'none'; arrBull.style.display = 'none';
                let diff = highlightedPointData.diff; const arrowContainer = document.getElementById('ar-hud-arrow-container');
                
                if (highlightedPointData.dist <= 2.0) {
                    arrBull.style.display = 'block'; arrowContainer.style.transform = `perspective(800px) rotateX(0deg)`;
                    hudDistText.innerText = `DOHLEDÁVÁNÍ (${highlightedPointData.dist.toFixed(1)} m)`; hudDistText.style.color = '#fbbf24'; hudInfoBox.style.borderColor = '#fbbf24';
                } else {
                    hudDistText.style.color = '#fff'; hudInfoBox.style.borderColor = 'rgba(255,255,255,0.4)';
                    if (Math.abs(diff) <= 35) { arrStraight.style.display = 'block'; arrowContainer.style.transform = `perspective(800px) rotateX(65deg) rotateZ(${diff}deg)`; } else if (diff < -35 && diff >= -110) { arrLeft.style.display = 'block'; arrowContainer.style.transform = `perspective(800px) rotateX(65deg)`; } else if (diff > 35 && diff <= 110) { arrRight.style.display = 'block'; arrowContainer.style.transform = `perspective(800px) rotateX(65deg)`; } else { arrUturn.style.display = 'block'; arrowContainer.style.transform = `perspective(800px) rotateX(65deg)`; }
                    hudDistText.innerText = `${highlightedPointData.dist.toFixed(1)} m`;
                }
                document.getElementById('ar-hud-name').innerText = `#${highlightedPointData.name}`;

                if (visSettings.vibrationEnabled && navigator.vibrate) {
                    let now = Date.now(); let interval = highlightedPointData.dist <= 1.0 ? 300 : (highlightedPointData.dist <= 5.0 ? 800 : 0);
                    if (interval > 0 && now - lastVibeTime > interval) { navigator.vibrate(50); lastVibeTime = now; }
                }
            } else { document.getElementById('ar-hud').style.display = 'none'; }
        }
        
        let inactivityTimer; const fadeElements = ['menu-toggle-btn', 'compass-debug', 'info', 'resizer', 'gps-avg'];
        function resetInactivityTimer() {
            fadeElements.forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('ui-faded'); }); clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => { fadeElements.forEach(id => { const el = document.getElementById(id); const bottomSheetOpen = document.getElementById('bottom-sheet').classList.contains('open'); const settingsOpen = document.getElementById('settings-modal').style.display === 'flex'; const customOpen = document.getElementById('custom-modal-overlay').style.display === 'flex'; const clusterOpen = document.getElementById('cluster-modal').style.display === 'flex'; const measureOpen = document.getElementById('measure-modal').style.display === 'flex'; const welcomeOpen = document.getElementById('welcome-screen').style.display !== 'none'; const menuOpen = document.getElementById('side-menu').classList.contains('open'); if (el && !bottomSheetOpen && !settingsOpen && !customOpen && !welcomeOpen && !menuOpen && !clusterOpen && !measureOpen) { el.classList.add('ui-faded'); } }); }, 4000);
        }
        ['touchstart', 'click', 'mousemove'].forEach(evt => { document.addEventListener(evt, resetInactivityTimer, { passive: true }); }); resetInactivityTimer();
