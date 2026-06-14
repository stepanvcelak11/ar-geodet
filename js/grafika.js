// ===== AR Geodet - GRAFICKA CAST (vykreslovani) =====
// AR znacky a sipka, mapa, kompas, modaly, nastaveni vzhledu, ovladani displeje.
// Nacita se PO logika.js (pouziva jeji promenne a funkce).

// PWA: nova verze ceka -> nabidnout obnovu (resi matouci starou cache)
        function showUpdateBanner() { const b = document.getElementById('update-banner'); if (b) b.style.display = 'flex'; }
        function applyUpdate() { navigator.serviceWorker.getRegistration().then(reg => { if (reg && reg.waiting) reg.waiting.postMessage('SKIP_WAITING'); }); const b = document.getElementById('update-banner'); if (b) b.style.display = 'none'; }

        function renderProjectSelect() {
            const sel = document.getElementById('w-project-select'); sel.innerHTML = '';
            projects.forEach(p => { const opt = document.createElement('option'); opt.value = p.id; opt.innerText = p.name; if(p.id === activeProjectId) opt.selected = true; sel.appendChild(opt); });
        }
        const arrowPaths = { '1': "M50 10 L90 50 L70 50 L70 95 L30 95 L30 50 L10 50 Z", '2': "M50 10 L70 30 L55 30 L55 95 L45 95 L45 30 L30 30 Z", '3': "M50 10 L90 50 L70 60 L50 40 L30 60 L10 50 Z", '4': "M50 10 L90 90 L50 70 L10 90 Z", '5': "M50 10 L90 50 L50 90 L10 50 Z" };

        function applyVisualSettings() {
            applyMapLayers();
            document.body.classList.toggle('outdoor-mode', !!visSettings.outdoorMode);
            document.documentElement.style.setProperty('--hud-top', visSettings.hudTop + 'px'); document.documentElement.style.setProperty('--hud-side', visSettings.hudSide + 'px'); document.documentElement.style.setProperty('--marker-opacity', visSettings.markerOpacity / 100); document.documentElement.style.setProperty('--color-tb', visSettings.colTb); document.documentElement.style.setProperty('--color-zhb', visSettings.colZhb); document.documentElement.style.setProperty('--color-pbpp', visSettings.colPbpp); document.documentElement.style.setProperty('--color-nivel', visSettings.colNivel); document.documentElement.style.setProperty('--color-custom', visSettings.colCustom); document.documentElement.style.setProperty('--arrow-size', (100 * visSettings.arrowScale) + 'px'); document.documentElement.style.setProperty('--arrow-opacity', visSettings.arrowOpacity / 100); document.documentElement.style.setProperty('--color-arrow', visSettings.colArrow); document.documentElement.style.setProperty('--panel-opacity', visSettings.panelOpacity / 100); document.documentElement.style.setProperty('--menu-scale', visSettings.menuScale);
            document.documentElement.style.setProperty('--hud-scale', visSettings.hudScale || 1);
            previewTheme(visSettings.theme); previewMode(visSettings.mode);
            const arrPath = document.getElementById('main-arrow-path'); if(arrPath) { arrPath.setAttribute('d', arrowPaths[visSettings.arrowShape]); arrPath.setAttribute('fill', visSettings.colArrow); document.getElementById('arrow-straight').style.filter = `drop-shadow(0 15px 15px ${visSettings.colArrow}80)`; document.getElementById('target-circle-out').setAttribute('stroke', visSettings.colArrow); document.getElementById('target-circle-in').setAttribute('fill', visSettings.colArrow); document.getElementById('arrow-target').style.filter = `drop-shadow(0 15px 15px ${visSettings.colArrow}90)`; }
            if (document.getElementById('s-max-ar-slider')) { document.getElementById('s-wakelock').checked = visSettings.wakeLockEnabled; document.getElementById('s-outdoor').checked = !!visSettings.outdoorMode; document.getElementById('s-katastr-source').value = visSettings.katastrSource || 'mapycz'; document.getElementById('s-max-ar-slider').value = visSettings.maxARPoints; document.getElementById('s-max-ar-val').innerText = visSettings.maxARPoints; document.getElementById('v-ar-height-slider').value = visSettings.arVerticalOffset; document.getElementById('v-ar-height-val').innerText = visSettings.arVerticalOffset; document.getElementById('v-marker-scale').value = Math.round(visSettings.markerScale * 100); document.getElementById('v-marker-scale-val').innerText = Math.round(visSettings.markerScale * 100); document.getElementById('v-marker-opacity').value = visSettings.markerOpacity; document.getElementById('v-marker-opacity-val').innerText = visSettings.markerOpacity; document.getElementById('col-tb').value = visSettings.colTb; document.getElementById('col-zhb').value = visSettings.colZhb; document.getElementById('col-pbpp').value = visSettings.colPbpp; document.getElementById('col-nivel').value = visSettings.colNivel; document.getElementById('col-custom').value = visSettings.colCustom; document.getElementById('col-arrow').value = visSettings.colArrow; document.getElementById('v-arrow-shape').value = visSettings.arrowShape; document.getElementById('v-arrow-scale').value = Math.round(visSettings.arrowScale * 100); document.getElementById('v-arrow-scale-val').innerText = Math.round(visSettings.arrowScale * 100); document.getElementById('v-arrow-opacity').value = visSettings.arrowOpacity; document.getElementById('v-arrow-opacity-val').innerText = visSettings.arrowOpacity; document.getElementById('v-panel-opacity').value = visSettings.panelOpacity; document.getElementById('v-panel-opacity-val').innerText = visSettings.panelOpacity; document.getElementById('v-menu-scale').value = Math.round(visSettings.menuScale * 100); document.getElementById('v-menu-scale-val').innerText = Math.round(visSettings.menuScale * 100); document.getElementById('s-auto-compass').checked = visSettings.autoCompassCorrection; document.getElementById('s-tilt-comp').checked = visSettings.tiltCompensation !== false; document.getElementById('s-heading-smooth').value = visSettings.headingSmoothing; document.getElementById('s-heading-smooth-val').innerText = visSettings.headingSmoothing; document.getElementById('s-fovh').value = visSettings.fovH; document.getElementById('s-fovh-val').innerText = visSettings.fovH; document.getElementById('s-fovv').value = visSettings.fovV; document.getElementById('s-fovv-val').innerText = visSettings.fovV; document.getElementById('s-eyeh').value = visSettings.eyeHeight; document.getElementById('s-eyeh-val').innerText = visSettings.eyeHeight; document.getElementById('v-adaptive-glass').checked = visSettings.adaptiveGlass !== false; document.getElementById('v-theme').value = visSettings.theme || 'smaragd'; document.getElementById('v-mode').value = visSettings.mode || 'dark'; document.getElementById('v-hud-scale').value = Math.round((visSettings.hudScale || 1) * 100); document.getElementById('v-hud-scale-val').innerText = Math.round((visSettings.hudScale || 1) * 100); }
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

        function openCompassModal() { document.getElementById('compass-modal').style.display = 'flex'; updateCompassButtons(); updateHeadingOffsetVal(); }
        // Korekce severu pro AR i mapu (na rozdil od "uzivatelske nuly", ktera meni jen zobrazene cislo azimutu).
        function updateHeadingOffsetVal() { const el = document.getElementById('heading-offset-val'); if (el) { let v = ((userHeadingOffset + 180) % 360 + 360) % 360 - 180; el.innerText = Math.round(v); } }
        function nudgeHeadingOffset(d) { userHeadingOffset = ((userHeadingOffset + d) % 360 + 360) % 360; setStoredData('arHeadingOffset', String(userHeadingOffset)); updateHeadingOffsetVal(); }
        function resetHeadingOffset() { userHeadingOffset = 0; headingCorrection = 0; setStoredData('arHeadingOffset', '0'); updateHeadingOffsetVal(); }
        function setCompassZero() { compassZeroOffset = currentHeading; alert("Nula nastavena na aktuální směr."); document.getElementById('compass-modal').style.display = 'none'; } function resetCompassZero() { compassZeroOffset = 0; alert("Nula zrušena."); document.getElementById('compass-modal').style.display = 'none'; } function setCompassUnit(u) { compassUnit = u; updateCompassButtons(); }
        function updateCompassButtons() { document.getElementById('btn-unit-deg').style.background = compassUnit === 'deg' ? 'var(--accent)' : '#555'; document.getElementById('btn-unit-deg').style.color = compassUnit === 'deg' ? '#000' : '#fff'; document.getElementById('btn-unit-gon').style.background = compassUnit === 'gon' ? 'var(--accent)' : '#555'; document.getElementById('btn-unit-gon').style.color = compassUnit === 'gon' ? '#000' : '#fff'; }

        const APP_VERSION = '1.6';
        function openAbout() { const v = document.getElementById('about-version'); if (v) v.innerText = APP_VERSION; document.getElementById('about-modal').style.display = 'flex'; }
        let _calibActive = false, _calibSeen = null, _calibBeta = null, _calibGamma = null;
        function dismissCompassCalib() { _calibActive = false; try { localStorage.setItem('arCompassCalibShown', '1'); } catch (e) {} const m = document.getElementById('compass-calib-modal'); if (m) m.style.display = 'none'; }
        // Onboarding kalibrace kompasu: jednorazove pri prvnim startu AR; force=true znovu z nastaveni kompasu.
        function showCompassCalibHint(force) { try { if (!force && localStorage.getItem('arCompassCalibShown')) return; } catch (e) {} try { if (!force && localStorage.getItem('arTutorialSeen_v1') !== '1') return; } catch (e) {} /* na 1. startu nejdriv tutorial; kalibraci spusti tutorial.js po dokonceni */ const m = document.getElementById('compass-calib-modal'); if (m) { m.style.display = 'flex'; _calibActive = true; _calibSeen = new Set(); _calibBeta = { min: Infinity, max: -Infinity }; _calibGamma = { min: Infinity, max: -Infinity }; const _b = document.getElementById('calib-progress'); if (_b) _b.style.width = '0%'; const _t = document.getElementById('calib-progress-txt'); if (_t) _t.innerText = '0 %'; } }
        // Po "osmicce" (telefon projde vice smery) se napoveda sama zavre. Bezi i pred zamerenim GPS.
        function trackCalibMotion(event) {
            if (!_calibActive || !_calibSeen) return;
            let h = (event.webkitCompassHeading != null) ? event.webkitCompassHeading : (event.alpha != null ? 360 - event.alpha : null);
            if (h != null) _calibSeen.add(((Math.floor(h / 45) % 8) + 8) % 8);
            if (event.beta != null) { _calibBeta.min = Math.min(_calibBeta.min, event.beta); _calibBeta.max = Math.max(_calibBeta.max, event.beta); }
            if (event.gamma != null) { _calibGamma.min = Math.min(_calibGamma.min, event.gamma); _calibGamma.max = Math.max(_calibGamma.max, event.gamma); }
            let bSpan = (_calibBeta.max - _calibBeta.min); if (!isFinite(bSpan)) bSpan = 0;
            let gSpan = (_calibGamma.max - _calibGamma.min); if (!isFinite(gSpan)) gSpan = 0;
            // skutecna osmicka = naklon v OBOU osach (beta x gamma); alternativne plne otoceni dokola (azimut)
            let tiltProg = Math.min(bSpan / 90, 1) * Math.min(gSpan / 90, 1);
            let headProg = _calibSeen.size / 6;
            let prog = Math.min(1, Math.max(tiltProg, headProg));
            const bar = document.getElementById('calib-progress'); if (bar) bar.style.width = Math.round(prog * 100) + '%';
            const txt = document.getElementById('calib-progress-txt'); if (txt) txt.innerText = Math.round(prog * 100) + ' %';
            if (prog >= 1) dismissCompassCalib();
        }

        function openMeasureModal() { document.getElementById('measure-modal').style.display = 'flex'; }

        async function loadCameras() { const btn = document.getElementById('camera-load-btn'); btn.innerText = "Načítám..."; try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); const devices = await navigator.mediaDevices.enumerateDevices(); const videoDevices = devices.filter(d => d.kind === 'videoinput'); const wSelect = document.getElementById('w-camera-select'); const sSelect = document.getElementById('s-camera-select'); wSelect.innerHTML = '<option value="">Výchozí zadní kamera</option>'; sSelect.innerHTML = '<option value="">Výchozí zadní kamera</option>'; videoDevices.forEach(cam => { if (!cam.label.toLowerCase().includes('front') && !cam.label.toLowerCase().includes('přední')) { const labelText = cam.label || `Kamera ${wSelect.options.length}`; const opt1 = document.createElement('option'); opt1.value = cam.deviceId; opt1.text = labelText; wSelect.appendChild(opt1); const opt2 = document.createElement('option'); opt2.value = cam.deviceId; opt2.text = labelText; sSelect.appendChild(opt2); } }); stream.getTracks().forEach(t => t.stop()); btn.style.display = 'none'; wSelect.style.display = 'block'; } catch(e) { alert("Nepodařilo se načíst seznam kamer."); btn.innerHTML = '<svg class="icon"><use href="#i-camera"/></svg> Zkusit znovu načíst kamery'; } }

        function updateInfoPanel() { const infoEl = document.getElementById('info'); if (!infoEl || !appStarted) return; if (!userLat) { infoEl.innerHTML = `<div class="rdt"><span class="rdt-l">GPS</span><span class="rdt-v" style="color:var(--warning);">hledám…</span></div>`; return; } let accColor = currentGpsAccuracy >= 7 ? 'var(--danger)' : 'var(--accent)'; infoEl.innerHTML = `<div class="rdt"><span class="rdt-l">Přesnost</span><span class="rdt-v" style="color:${accColor};">±${currentGpsAccuracy.toFixed(1)} m</span></div><div class="rdt"><span class="rdt-l">V&nbsp;AR</span><span class="rdt-v">${getVisiblePointsCount()} / ${visSettings.maxARPoints}</span></div>`; }

        function startAppFromWelcome() { mapRadius = parseInt(document.getElementById('w-map-radius-slider').value); arRadius = parseInt(document.getElementById('w-ar-radius-slider').value); filters.tb = document.getElementById('w-f-tb').checked; filters.zhb = document.getElementById('w-f-zhb').checked; filters.pbpp = document.getElementById('w-f-pbpp').checked; filters.nivel = document.getElementById('w-f-nivel').checked; filters.custom = document.getElementById('w-f-custom').checked; searchQuery = document.getElementById('w-search-name').value.trim(); const viewRadios = document.getElementsByName('w-view'); for(let r of viewRadios) { if(r.checked) viewMode = r.value; } document.getElementById('s-map-radius-slider').value = mapRadius; document.getElementById('s-map-radius-val').innerText = mapRadius; document.getElementById('s-ar-radius-slider').value = arRadius; document.getElementById('s-ar-radius-val').innerText = arRadius; document.getElementById('f-tb').checked = filters.tb; document.getElementById('f-zhb').checked = filters.zhb; document.getElementById('f-pbpp').checked = filters.pbpp; document.getElementById('f-nivel').checked = filters.nivel; document.getElementById('f-custom').checked = filters.custom; document.getElementById('s-search-name').value = searchQuery; document.getElementById('s-camera-select').value = document.getElementById('w-camera-select').value; const sViewRadios = document.getElementsByName('s-view'); for(let r of sViewRadios) { if(r.value === viewMode) r.checked = true; } document.getElementById('menu-toggle-btn').style.display = "block"; appStarted = true; toggleHudElements(); document.getElementById('welcome-screen').style.opacity = '0'; setTimeout(() => { document.getElementById('welcome-screen').style.display = 'none'; }, 400); applyViewMode(); drawAllMarkersOnMap(); if (userLat && userLng) { initFetch(userLat, userLng); } else { document.getElementById('info').innerHTML = "Hledám GPS signál..."; } requestWakeLock(); }

        function applyViewMode() { const camCont = document.getElementById('camera-container'); const mapCont = document.getElementById('map-container'); const resizer = document.getElementById('resizer'); if (viewMode === 'both') { camCont.style.display = 'block'; camCont.style.flex = '0 0 50%'; mapCont.style.display = 'block'; mapCont.style.flex = '1'; resizer.style.display = 'flex'; startCameraAndCompass(); } else if (viewMode === 'map') { camCont.style.display = 'none'; mapCont.style.display = 'block'; mapCont.style.flex = '1'; resizer.style.display = 'none'; startCompass(); } else if (viewMode === 'ar') { camCont.style.display = 'block'; camCont.style.flex = '1'; mapCont.style.display = 'none'; resizer.style.display = 'none'; startCameraAndCompass(); } setTimeout(() => { map.invalidateSize(); }, 300); }

        let compassStarted = false;
        function startCompass() { if (compassStarted) return; compassStarted = true; showCompassCalibHint(); if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') { DeviceOrientationEvent.requestPermission().then(permission => { if (permission === 'granted') window.addEventListener('deviceorientation', handleOrientation); }); } else { window.addEventListener('deviceorientationabsolute', handleOrientation); window.addEventListener('deviceorientation', handleOrientation); } }
        function startCameraAndCompass(forceRestart = false) { startCompass(); if (cameraStarted && !forceRestart) return; cameraStarted = true; if (currentVideoStream) { currentVideoStream.getTracks().forEach(track => track.stop()); } const camId = document.getElementById('s-camera-select') ? document.getElementById('s-camera-select').value : null; const videoConstraints = camId ? { deviceId: { exact: camId } } : { facingMode: "environment" }; navigator.mediaDevices.getUserMedia({ video: videoConstraints }).then(stream => { currentVideoStream = stream; const videoElement = document.getElementById('camera-feed'); videoElement.srcObject = stream; videoElement.style.display = "block"; }).catch(err => { alert("Chyba kamery: " + err.message); }); }

        // Po navratu do appky (napr. z otevreneho Katastru) prohlizec casto ukonci kamerovy
        // stream -> cerna obrazovka. Pokud je track mrtvy, kameru automaticky restartujeme.
        // Obnova kamery: pri force=true vzdy restartujeme (po tezkem prekresleni, napr. undo, video casto "zamrzne"
        // i kdyz track zije a neni paused — pouhe play() to nespravi). Jinak restart jen kdyz je track mrtvy.
        function ensureCameraAlive(force) {
            if (!appStarted || viewMode === 'map') return;
            const track = (currentVideoStream && currentVideoStream.getVideoTracks) ? currentVideoStream.getVideoTracks()[0] : null;
            if (force || !currentVideoStream || !track || track.readyState === 'ended') { startCameraAndCompass(true); }
            else { const v = document.getElementById('camera-feed'); if (v && v.paused) v.play().catch(() => {}); }
        }
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            ensureCameraAlive(false);
        });

        const resizer = document.getElementById('resizer'); const camCont = document.getElementById('camera-container'); let lastTapTime = 0; let isCamMaximized = false;
        resizer.addEventListener('touchmove', (e) => { const h = (e.touches[0].clientY / window.innerHeight) * 100; camCont.style.flex = `0 0 ${h}%`; });
        resizer.addEventListener('touchend', (e) => { const currentTime = new Date().getTime(); const tapLength = currentTime - lastTapTime; if (tapLength < 300 && tapLength > 0) { if (isCamMaximized) { camCont.style.transition = 'flex 0.3s ease'; camCont.style.flex = `0 0 50%`; isCamMaximized = false; } else { camCont.style.transition = 'flex 0.3s ease'; camCont.style.flex = `0 0 85%`; isCamMaximized = true; } setTimeout(() => { camCont.style.transition = 'none'; map.invalidateSize(); }, 300); } lastTapTime = currentTime; });

        function getMapMarkerSVG(category, color) { if(category === 'TB') return `<svg viewBox="0 0 24 24"><polygon points="12,2 22,20 2,20" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; if(category === 'ZHB') return `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; if(category === 'PBPP') return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; if(category === 'NIVEL') return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="3"/><circle cx="12" cy="12" r="3" fill="${color}"/></svg>`; if(category === 'CUSTOM') return `<svg viewBox="0 0 24 24"><path d="M12,2 C7,2 3,6 3,11 C3,18 12,22 12,22 C12,22 21,18 21,11 C21,6 17,2 12,2 Z" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="${color}"/></svg>`; }

        function drawAllMarkersOnMap() {
            markersGroup.clearLayers();
            arPoints.forEach(pt => {
                if (pt.hidden) return; if (pt.cat === 'TB' && !filters.tb) return; if (pt.cat === 'ZHB' && !filters.zhb) return; if (pt.cat === 'PBPP' && !filters.pbpp) return; if (pt.cat === 'NIVEL' && !filters.nivel) return; if (pt.cat === 'CUSTOM' && !filters.custom) return; if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) return;
                let col = visSettings.colTb; if(pt.cat === 'ZHB') col = visSettings.colZhb; if(pt.cat === 'PBPP') col = visSettings.colPbpp; if(pt.cat === 'NIVEL') col = visSettings.colNivel; if(pt.cat === 'CUSTOM') col = visSettings.colCustom;
                const stakedBadge = (window.isStaked && isStaked(pt.id)) ? `<div style="position:absolute; top:-7px; right:-7px; width:13px; height:13px; border-radius:50%; background:#10b981; border:1.5px solid #fff; display:flex; align-items:center; justify-content:center;"><svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>` : '';
                const svgIcon = getMapMarkerSVG(pt.cat, col); const htmlContent = `<div style="position: relative; width: 24px; height: 24px; pointer-events:none;${stakedBadge ? ' opacity:0.65;' : ''}">${svgIcon}${stakedBadge}<div class="map-label-text" style="transform: rotate(${mapRotation}deg);">${pt.name}</div></div>`;
                const icon = L.divIcon({ className: 'custom-map-marker', html: htmlContent, iconSize: [24, 24], iconAnchor: [12, 12] });
                L.marker([pt.lat, pt.lng], { icon: icon }).addTo(markersGroup);
            });
            drawAllLinesOnMap();
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
            const rad = mapRotation * Math.PI / 180; const dx = px - Px, dy = py - Py;
            const lx = dx * Math.cos(rad) - dy * Math.sin(rad); const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
            return map.containerPointToLatLng(L.point(P.x + lx, P.y + ly));
        }
        map.on('click', (e) => {
            if (!appStarted) return; const clickLatLng = getMapClickLatLng(e);
            if (mapAddMode) { mapAddMode = false; const _h = document.getElementById('map-pick-hint'); if (_h) _h.style.display = 'none'; openNewPointFromMap(clickLatLng.lat, clickLatLng.lng); return; }
            if (areaMode) { areaVertices.push({ lat: clickLatLng.lat, lng: clickLatLng.lng }); afterAreaChange(); return; }
            if (connectMode) { handleConnectTap(clickLatLng); return; }
            const clickPoint = map.latLngToContainerPoint(clickLatLng); const nearbyPoints = [];
            arPoints.forEach(pt => {
                if (pt.hidden) return; if (pt.cat === 'TB' && !filters.tb) return; if (pt.cat === 'ZHB' && !filters.zhb) return; if (pt.cat === 'PBPP' && !filters.pbpp) return; if (pt.cat === 'NIVEL' && !filters.nivel) return; if (pt.cat === 'CUSTOM' && !filters.custom) return; if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) return;
                const ptLatLng = L.latLng(pt.lat, pt.lng); const ptPoint = map.latLngToContainerPoint(ptLatLng); const pixelDist = clickPoint.distanceTo(ptPoint);
                if (pixelDist <= 25) { nearbyPoints.push(pt); }
            });
            if (nearbyPoints.length === 1) { highlightPoint(nearbyPoints[0]); } 
            else if (nearbyPoints.length > 1) { showClusterList(nearbyPoints); }
            else {
                // KLIKNUTÍ DO PRÁZDNA - STAŽENÍ VZDÁLENÉ OBLASTI
                L.popup().setLatLng(clickLatLng).setContent(`<div style="text-align:center;"><div style="font-weight:bold; margin-bottom:6px; color:#000;">Vzdálená oblast</div><div style="color:#000; font-size:12px;">Poloměr: <span id="dl-radius-val">${mapRadius}</span> m</div><input type="range" id="dl-radius" min="200" max="5000" step="100" value="${mapRadius}" style="width:100%; margin:4px 0;" oninput="document.getElementById('dl-radius-val').innerText=this.value"><button class="btn btn-blue" style="padding:8px; width:100%; margin:6px 0 0 0;" onclick="fetchDistantArea(${clickLatLng.lat}, ${clickLatLng.lng}, parseInt(document.getElementById('dl-radius').value))"><svg class="icon"><use href="#i-download"/></svg> Stáhnout okolí</button><button class="btn" style="padding:8px; width:100%; margin:6px 0 0 0; background:#e5e7eb; color:#000;" onclick="map.closePopup()">Zrušit</button></div>`).openOn(map);
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

        // Seznam bodu v okoli serazeny podle vzdalenosti; klepnuti = navigace (highlightPoint)
        function openNearbyModal() { if (userLat == null) { alert("Čekám na GPS pozici..."); return; } renderNearbyList(); document.getElementById('nearby-modal').style.display = 'flex'; }
        function renderNearbyList() {
            const listDiv = document.getElementById('nearby-list'); listDiv.innerHTML = '';
            const pts = arPoints.filter(pt => {
                if (pt.hidden) return false;
                if (pt.cat === 'TB' && !filters.tb) return false; if (pt.cat === 'ZHB' && !filters.zhb) return false;
                if (pt.cat === 'PBPP' && !filters.pbpp) return false; if (pt.cat === 'NIVEL' && !filters.nivel) return false;
                if (pt.cat === 'CUSTOM' && !filters.custom) return false;
                if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                return true;
            }).map(pt => ({ pt, d: getDistance(userLat, userLng, pt.lat, pt.lng) })).sort((a, b) => a.d - b.d).slice(0, 50);
            if (!pts.length) { listDiv.innerHTML = '<p style="text-align:center; opacity:0.7;">Žádné body v dosahu.</p>'; return; }
            pts.forEach(({ pt, d }) => {
                let typBodu = "Podrobný polohový bod"; if (pt.cat === 'TB') typBodu = "Trigonometrický bod"; if (pt.cat === 'ZHB') typBodu = "Zhušťovací bod"; if (pt.cat === 'NIVEL') typBodu = "Nivelační / Výškový bod"; if (pt.cat === 'CUSTOM') typBodu = "Vlastní bod";
                let col = visSettings.colTb; if (pt.cat === 'ZHB') col = visSettings.colZhb; if (pt.cat === 'PBPP') col = visSettings.colPbpp; if (pt.cat === 'NIVEL') col = visSettings.colNivel; if (pt.cat === 'CUSTOM') col = visSettings.colCustom;
                const item = document.createElement('div'); item.className = 'cluster-list-item';
                item.innerHTML = `<div><div class="cluster-item-title" style="color:${col};">#${pt.name}</div><div class="cluster-item-subtitle">${typBodu}</div></div><div style="font-weight:600; font-size:14px;">${d.toFixed(1)} m</div>`;
                item.addEventListener('click', () => { document.getElementById('nearby-modal').style.display = 'none'; highlightPoint(pt); });
                listDiv.appendChild(item);
            });
        }

        function openSettings() { document.getElementById('settings-modal').style.display = 'flex'; applyVisualSettings(); }
        
        function saveSettings() { 
            mapRadius = parseInt(document.getElementById('s-map-radius-slider').value); setStoredData('arRadiusMap', mapRadius); 
            arRadius = parseInt(document.getElementById('s-ar-radius-slider').value); setStoredData('arRadiusAR', arRadius); 
            searchQuery = document.getElementById('s-search-name').value.trim();
            const sViewRadios = document.getElementsByName('s-view'); for(let r of sViewRadios) { if(r.checked) viewMode = r.value; }
            const oldCam = document.getElementById('w-camera-select').value; const newCam = document.getElementById('s-camera-select').value; document.getElementById('w-camera-select').value = newCam; 
            visSettings.wakeLockEnabled = document.getElementById('s-wakelock').checked;
            visSettings.outdoorMode = document.getElementById('s-outdoor').checked;
            visSettings.katastrSource = document.getElementById('s-katastr-source').value;
            visSettings.maxARPoints = parseInt(document.getElementById('s-max-ar-slider').value);
            visSettings.arVerticalOffset = parseInt(document.getElementById('v-ar-height-slider').value);
            visSettings.markerScale = parseInt(document.getElementById('v-marker-scale').value) / 100; visSettings.markerOpacity = parseInt(document.getElementById('v-marker-opacity').value);
            visSettings.colTb = document.getElementById('col-tb').value; visSettings.colZhb = document.getElementById('col-zhb').value; visSettings.colPbpp = document.getElementById('col-pbpp').value; visSettings.colNivel = document.getElementById('col-nivel').value; visSettings.colCustom = document.getElementById('col-custom').value;
            visSettings.arrowScale = parseInt(document.getElementById('v-arrow-scale').value) / 100; visSettings.arrowOpacity = parseInt(document.getElementById('v-arrow-opacity').value); visSettings.arrowShape = document.getElementById('v-arrow-shape').value; visSettings.colArrow = document.getElementById('col-arrow').value;
            visSettings.panelOpacity = parseInt(document.getElementById('v-panel-opacity').value); visSettings.menuScale = parseInt(document.getElementById('v-menu-scale').value) / 100;
            visSettings.autoCompassCorrection = document.getElementById('s-auto-compass').checked; visSettings.tiltCompensation = document.getElementById('s-tilt-comp').checked; visSettings.headingSmoothing = parseInt(document.getElementById('s-heading-smooth').value); visSettings.fovH = parseInt(document.getElementById('s-fovh').value); visSettings.fovV = parseInt(document.getElementById('s-fovv').value); visSettings.eyeHeight = parseFloat(document.getElementById('s-eyeh').value);
            visSettings.theme = document.getElementById('v-theme').value; visSettings.mode = document.getElementById('v-mode').value; visSettings.adaptiveGlass = document.getElementById('v-adaptive-glass').checked; visSettings.hudScale = parseInt(document.getElementById('v-hud-scale').value) / 100;
            setStoredData('arVisSettings12', JSON.stringify(visSettings)); applyVisualSettings(); drawAllMarkersOnMap();
            document.getElementById('settings-modal').style.display = 'none';
            if (oldCam !== newCam && viewMode !== 'map') { startCameraAndCompass(true); applyViewMode(); } else { applyViewMode(); }
            if(userLat && userLng) initFetch(userLat, userLng); fixAppLayout(); if(visSettings.wakeLockEnabled) requestWakeLock();
        }
        function openManageModal() { document.getElementById('settings-modal').style.display = 'none'; renderManageList(); document.getElementById('manage-modal').style.display = 'flex'; }
        function closeManageModal() { document.getElementById('manage-modal').style.display = 'none'; fixAppLayout(); }
        function renderManageList() { const listDiv = document.getElementById('manage-list'); listDiv.innerHTML = ''; if (persistentCustomPoints.length === 0) { listDiv.innerHTML = '<p style="text-align:center;">Žádné body v této zakázce.</p>'; } else persistentCustomPoints.forEach(pt => { let sjtsk = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]); let dispY = Math.abs(sjtsk[0]).toFixed(2); let dispX = Math.abs(sjtsk[1]).toFixed(2); const item = document.createElement('div'); item.className = 'cp-item'; item.innerHTML = ` <div class="cp-title">${pt.name}</div> <div class="cp-coords">Y: ${dispY}<br>X: ${dispX}${pt.acc != null ? '<br>⌀ ±'+pt.acc+' m' : ''}</div> <div class="cp-actions"> <button class="cp-btn cp-btn-edit" onclick="editCustomPoint('${pt.id}')"><svg class="icon"><use href="#i-edit"/></svg></button> <button class="cp-btn cp-btn-delete" onclick="deleteCustomPoint('${pt.id}')"><svg class="icon"><use href="#i-trash"/></svg></button></div>`; listDiv.appendChild(item); }); renderLinesList(listDiv); }
        // Spojnice ve sprave bodu: vlastni sbalena kolonka — NEJSOU to ulozene body, jen cary mezi nimi
        let _linesBoxOpen = false;
        function renderLinesList(listDiv) {
            if (!pointLines || !pointLines.length) return;
            const det = document.createElement('details');
            det.className = 'exp-menu lines-menu';
            det.open = _linesBoxOpen;
            det.addEventListener('toggle', () => { _linesBoxOpen = det.open; });
            const sum = document.createElement('summary');
            sum.innerHTML = '<svg class="icon"><use href="#i-line"/></svg> Spojnice bodů (' + pointLines.length + ')';
            det.appendChild(sum);
            const box = document.createElement('div');
            const hint = document.createElement('p');
            hint.style.cssText = 'font-size:11.5px; opacity:0.7; margin:8px 2px 4px; line-height:1.4;';
            hint.innerText = 'Čáry mezi body v mapě a AR — nejsou to uložené body. Smazáním spojnice se body nemažou.';
            box.appendChild(hint);
            pointLines.forEach(ln => {
                const A = resolveLineEnd(ln.aId, ln.aLat, ln.aLng), B = resolveLineEnd(ln.bId, ln.bLat, ln.bLng);
                const d = getDistance(A.lat, A.lng, B.lat, B.lng);
                const an = _escHtml(lineEndName(ln.aId, ln.aName)), bn = _escHtml(lineEndName(ln.bId, ln.bName));
                const item = document.createElement('div'); item.className = 'cp-item';
                item.innerHTML = `<div class="cp-title" style="color:#fbbf24;">#${an} \u2194 #${bn}</div><div class="cp-coords">Délka: ${d.toFixed(1)} m</div><div class="cp-actions"><button class="cp-btn cp-btn-delete" onclick="deleteLineFromList('${ln.id}')"><svg class="icon"><use href="#i-trash"/></svg></button></div>`;
                box.appendChild(item);
            });
            det.appendChild(box);
            listDiv.appendChild(det);
        }
        function deleteLineFromList(id) { if (!confirm('Smazat tuto spojnici?')) return; _linesBoxOpen = true; deleteLine(id); renderManageList(); }
        function editCustomPoint(id) { const pt = persistentCustomPoints.find(p => p.id === id); if(!pt) return; editingCustomPointId = id; pendingPointAccuracy = null; { const _n = document.getElementById('custom-acc-note'); if (_n) _n.style.display = 'none'; } document.getElementById('custom-modal-title').innerText = "Upravit bod"; document.getElementById('custom-name').value = pt.name; let sjtsk = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]); document.getElementById('custom-y').value = Math.abs(sjtsk[0]).toFixed(2); document.getElementById('custom-x').value = Math.abs(sjtsk[1]).toFixed(2); document.getElementById('manage-modal').style.display = 'none'; document.getElementById('custom-modal-overlay').style.display = 'flex'; }
        // BOD Z MAPY: tlacitko v modalu spusti rezim, dalsi TAP do mapy umisti bod (tah dal posouva mapu)
        function startMapPick() {
            if (viewMode === 'ar') { alert("Přepni na zobrazení s mapou (Split nebo Mapa)."); return; }
            closeCustomModal(); mapAddMode = true;
            const h = document.getElementById('map-pick-hint'); if (h) h.style.display = 'flex';
            document.getElementById('map-controls').classList.remove('expanded');
        }
        function cancelMapPick() { mapAddMode = false; const h = document.getElementById('map-pick-hint'); if (h) h.style.display = 'none'; }
        function openNewPointFromMap(lat, lng) {
            editingCustomPointId = null; pendingPointAccuracy = null;
            const _n = document.getElementById('custom-acc-note'); if (_n) _n.style.display = 'none';
            document.getElementById('custom-modal-title').innerText = "Bod z mapy";
            document.getElementById('custom-name').value = '';
            let sjtsk = proj4("EPSG:4326", "EPSG:5514", [lng, lat]);
            document.getElementById('custom-y').value = Math.abs(sjtsk[0]).toFixed(2);
            document.getElementById('custom-x').value = Math.abs(sjtsk[1]).toFixed(2);
            document.getElementById('custom-modal-overlay').style.display = 'flex';
        }
        function openNewPointModal() { editingCustomPointId = null; pendingPointAccuracy = null; { const _n = document.getElementById('custom-acc-note'); if (_n) _n.style.display = 'none'; } document.getElementById('custom-modal-title').innerText = "Vložit bod"; document.getElementById('custom-name').value = ''; document.getElementById('custom-y').value = ''; document.getElementById('custom-x').value = ''; document.getElementById('custom-modal-overlay').style.display = 'flex'; }
        function closeCustomModal() { document.getElementById('custom-modal-overlay').style.display = 'none'; fixAppLayout(); }
        function closeBottomSheet() { document.getElementById('bottom-sheet').classList.remove('open'); arPoints.forEach(p => { if (p.element) p.element.classList.remove('active-reading'); }); activePointIdForModal = null; }

        function toggleHighlight() { if (highlightedPointId === activePointIdForModal) { highlightedPointId = null; } else { highlightedPointId = activePointIdForModal; } closeBottomSheet(); arPoints.forEach(p => { if (p.element) { if (p.id === highlightedPointId) { p.element.classList.add('highlighted'); } else { p.element.classList.remove('highlighted'); } } }); if (!highlightedPointId) { document.getElementById('ar-hud').style.display = 'none'; } updateNavGlow(); }

        // klik na bod v mape -> rovnou nastavit jako cil navigace v AR (zlata znacka + sipka)
        function highlightPoint(pt) {
            highlightedPointId = (highlightedPointId === pt.id) ? null : pt.id;
            initARMarkers();
            arPoints.forEach(p => { if (p.element) { if (p.id === highlightedPointId) p.element.classList.add('highlighted'); else p.element.classList.remove('highlighted'); } });
            if (!highlightedPointId) document.getElementById('ar-hud').style.display = 'none';
            drawAllMarkersOnMap();
            updateNavGlow();
        }
        // panel prumerovani GPS (vykresleni); data pocita updateGpsAveraging v logika.js
        function updateGpsAvgPanel() {
            const el = document.getElementById('gps-avg'); if (!el) return;
            const tgl = document.getElementById('tgl-gpsavg');
            if (!appStarted || !tgl || !tgl.checked) { el.style.display = 'none'; return; }
            el.style.display = 'block';
            const r = gpsAvgResult;
            document.getElementById('ga-n').innerText = (r && r.total) ? ((r.total > r.n) ? (r.n + ' (z ' + r.total + ')') : ('' + r.n)) : '0';
            document.getElementById('ga-pos').innerText = (r && r.n >= 2) ? ('\u00b1' + r.sterr.toFixed(2) + ' m') : '\u2026';
            document.getElementById('ga-se').innerText = (r && r.n >= 2) ? ('\u00b1' + r.sigma.toFixed(2) + ' m') : '\u2026';
        }

                // PODKLADY MAPY: prepinani OSM/ortofoto + pruhledny katastr (CUZK WMS). Stav v visSettings, persistuje se hned.
        function applyMapLayers() {
            const key = (visSettings.baseLayer === 'ortofoto') ? 'ortofoto' : 'osm';
            Object.keys(baseLayers).forEach(k => { if (k !== key && map.hasLayer(baseLayers[k])) map.removeLayer(baseLayers[k]); });
            if (!map.hasLayer(baseLayers[key])) baseLayers[key].addTo(map);
            if (visSettings.showKatastr) { if (!map.hasLayer(katastrLayer)) katastrLayer.addTo(map); } else if (map.hasLayer(katastrLayer)) map.removeLayer(katastrLayer);
            const bb = document.getElementById('btn-baselayer'), kb = document.getElementById('btn-katastr');
            if (bb) bb.classList.toggle('ctrl-active', visSettings.baseLayer === 'ortofoto');
            if (kb) kb.classList.toggle('ctrl-active', !!visSettings.showKatastr);
        }
        function cycleBaseLayer() { visSettings.baseLayer = (visSettings.baseLayer === 'ortofoto') ? 'osm' : 'ortofoto'; setStoredData('arVisSettings12', JSON.stringify(visSettings)); applyMapLayers(); }
        function toggleKatastr() { visSettings.showKatastr = !visSettings.showKatastr; setStoredData('arVisSettings12', JSON.stringify(visSettings)); applyMapLayers(); }
        // Vyjizdejici panel ovladani mapy: sbaleno = jen prepinaci tlacitko
        function toggleMapControls() { document.getElementById('map-controls').classList.toggle('expanded'); }

        const arOverlay = document.getElementById('ar-overlay');
        function initARMarkers() {
            arPoints.forEach((pt) => {
                let matchesSearch = true; if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) { matchesSearch = false; }
                let outOfReach = (pt.currentDist > arRadius); let isSelectedForDetail = (pt.id === activePointIdForModal);
                if (pt.hidden || !matchesSearch || (outOfReach && pt.id !== highlightedPointId && !isSelectedForDetail)) { if (pt.element && pt.element.parentNode) pt.element.parentNode.removeChild(pt.element); return; }
                if (!pt.element) { const marker = document.createElement('div'); marker.className = `ar-marker cat-${pt.cat.toLowerCase()}`; if (pt.id === highlightedPointId) marker.classList.add('highlighted'); if (window.isStaked && isStaked(pt.id)) marker.classList.add('staked'); marker.style.opacity = '0'; const title = document.createElement('div'); title.className = 'ar-marker-title'; title.innerText = pt.name; const dist = document.createElement('div'); dist.className = 'ar-marker-dist'; marker.appendChild(title); marker.appendChild(dist); marker.addEventListener('click', () => { const currentDist = getDistance(userLat, userLng, pt.lat, pt.lng); showDetails(pt, currentDist); }); pt.element = marker; pt.distElement = dist; arOverlay.appendChild(marker); } else if (!pt.element.parentNode) { arOverlay.appendChild(pt.element); }
            });
        }
        let mapReturnTimer;
        function recenterOnUser() { clearTimeout(mapReturnTimer); window._mapHold = false; if (userLat == null) return; map.setView([userLat, userLng], map.getZoom(), { animate: true }); lastCenterLat = userLat; lastCenterLng = userLng; }
        // OVLADANI MAPY: jeden prst = posun (obsah sleduje prst i pri otocene mape), dva prsty = plynuly zoom (pinch).
        map.options.zoomSnap = 0;  // plynuly pinch zoom (zlomkove stupne); kdyby logika.js byla stara, vynutime to i tady
        // mapRotation = uhel SKUTECNE aplikovany na mapu. Behem rucniho posunu (window._mapHold)
        // se rotace zmrazi -- otaceni kolem uzivatele mimo stred by mapou smykalo po obrazovce.
        // Klikani i posun prepocitavaji souradnice pres mapRotation, ne pres zivy currentHeading.
        let mapRotation = 0;
        let isDraggingMap = false, isPinchingMap = false; let lastTouchX = 0, lastTouchY = 0; let pinchStartDist = 0, pinchStartZoom = 0; const mapContainerEl = document.getElementById('map-container');
        function _touchDist(t) { const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.hypot(dx, dy); }
        function _zoomAnchor() { return (userLat != null) ? L.latLng(userLat, userLng) : map.getCenter(); }
        // prevede bod na obrazovce (stred mezi prsty) na bod v mape se zohlednenim otoceni mapy -> zoom drzi stred stistnuti na miste
        function _screenToContainerPoint(px, py) {
            const userEl = document.getElementById('user-direction-container');
            let Px, Py, P;
            if (userEl && userLat != null) { const ur = userEl.getBoundingClientRect(); Px = ur.left + ur.width / 2; Py = ur.top + ur.height / 2; P = map.latLngToContainerPoint([userLat, userLng]); }
            else { const rect = document.getElementById('map').getBoundingClientRect(); Px = rect.left + rect.width / 2; Py = rect.top + rect.height / 2; const sz = map.getSize(); P = L.point(sz.x / 2, sz.y / 2); }
            const rad = mapRotation * Math.PI / 180; const dx = px - Px, dy = py - Py;
            const lx = dx * Math.cos(rad) - dy * Math.sin(rad); const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
            return L.point(P.x + lx, P.y + ly);
        }
        mapContainerEl.addEventListener('touchstart', (e) => {
            if (e.target.closest('.glass-panel, .leaflet-popup')) return;
            clearTimeout(mapReturnTimer); document.getElementById('map-controls').classList.remove('expanded');
            if (e.touches.length >= 2) { isPinchingMap = true; isDraggingMap = false; pinchStartDist = _touchDist(e.touches); pinchStartZoom = map.getZoom(); }
            else if (e.touches.length === 1) { isDraggingMap = true; isPinchingMap = false; lastTouchX = e.touches[0].clientX; lastTouchY = e.touches[0].clientY; }
        }, { passive: true });
        mapContainerEl.addEventListener('touchmove', (e) => {
            // dotyk zacinajici na popupu (napr. 'Vzdalena oblast') patri popupu, ne mape -- jinak tah po popupu hybe mapou a preventDefault rusi klik na tlacitka
            if (e.target.closest('.glass-panel, .leaflet-popup')) return;
            if (e.touches.length >= 2) {
                if (!isPinchingMap) { isPinchingMap = true; isDraggingMap = false; pinchStartDist = _touchDist(e.touches); pinchStartZoom = map.getZoom(); }
                window._mapHold = true;
                const d = _touchDist(e.touches);
                if (pinchStartDist > 0 && d > 0) { let nz = pinchStartZoom + Math.log2(d / pinchStartDist); nz = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), nz)); const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2; map.setZoomAround(_screenToContainerPoint(mx, my), nz, { animate: false }); }
                if (e.cancelable) e.preventDefault(); return;
            }
            if (!isDraggingMap || e.touches.length !== 1) return;
            window._mapHold = true;
            const dx = e.touches[0].clientX - lastTouchX; const dy = e.touches[0].clientY - lastTouchY;
            // SMER: posun prstu prepocteme do souradnic mapy otocenim, ktere je na mape SKUTECNE aplikovane (mapRotation; behem posunu zmrazene) -- obsah tak sleduje prst pri jakemkoliv natoceni
            const rad = mapRotation * Math.PI / 180;
            const lx = dx * Math.cos(rad) - dy * Math.sin(rad); const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
            map.panBy([-lx, -ly], { animate: false });
            lastTouchX = e.touches[0].clientX; lastTouchY = e.touches[0].clientY; if (e.cancelable) e.preventDefault();
        }, { passive: false });
        // KONEC DOTYKU: timer navratu je navazany na _mapHold (ne jen na lokalni flagy) a bezi
        // i pri 'touchcancel' (gesto prevezme system/prohlizec) -- jinak by _mapHold zustal true
        // navzdy a mapa by se uz nikdy neotocila podle kompasu.
        function onMapTouchEnd(e) {
            if (e.touches.length === 0) { if (isDraggingMap || isPinchingMap || window._mapHold) { clearTimeout(mapReturnTimer); mapReturnTimer = setTimeout(recenterOnUser, 5000); } isDraggingMap = false; isPinchingMap = false; }
            else if (e.touches.length === 1) { isPinchingMap = false; isDraggingMap = true; lastTouchX = e.touches[0].clientX; lastTouchY = e.touches[0].clientY; }
        }
        mapContainerEl.addEventListener('touchend', onMapTouchEnd);
        mapContainerEl.addEventListener('touchcancel', onMapTouchEnd);
        // POPUP: srovnat vodorovne hned pri otevreni -- renderAR ho behem _mapHold neaktualizuje,
        // takze by po rucnim posunu mapy zustal natoceny spolu s mapou.
        map.on('popupopen', (e) => { window._popupOpen = true; const el = e.popup.getElement(); const w = el && el.querySelector('.leaflet-popup-content-wrapper'); if (w) w.style.transform = `rotate(${mapRotation}deg)`; });
        map.on('popupclose', () => { window._popupOpen = false; });

        // STAHOVANI: celoobrazovkovy ukazatel postupu (sdileny pro offline mapu i stahovani oblasti; vytvari se za behu, nezasahuje do HTML/CSS)
        function _ensureOfflineProgress() {
            let el = document.getElementById('offline-progress');
            if (!el) {
                el = document.createElement('div'); el.id = 'offline-progress';
                el.style.cssText = 'position:fixed; top:0; right:0; bottom:0; left:0; z-index:999999; display:none; align-items:center; justify-content:center; background:rgba(4,8,12,0.55); backdrop-filter:blur(2px);';
                el.innerHTML = '<div style="width:min(82vw,320px); padding:22px; border-radius:18px; background:rgba(14,18,24,0.96); border:1px solid rgba(255,255,255,0.12); box-shadow:0 20px 50px rgba(0,0,0,0.5); text-align:center; color:#fff;"><div id="offline-progress-title" style="font-size:14.5px; font-weight:700; margin-bottom:14px;">Stahuji\u2026</div><div style="width:100%; height:10px; background:rgba(255,255,255,0.12); border-radius:99px; overflow:hidden;"><div id="offline-progress-bar" style="height:100%; width:0%; background:var(--accent-grad,#34d399); border-radius:99px; transition:width 0.15s linear;"></div></div><div id="offline-progress-txt" style="margin-top:10px; font-size:12px; color:var(--accent-bright,#34d399); font-family:var(--font-mono,monospace);">0 %</div></div>';
                document.body.appendChild(el);
            }
            return el;
        }
        let _offlineProgUnit = 'd\u00edlk\u016f';
        function showOfflineProgress(done, total, label, unit) { const el = _ensureOfflineProgress(); el.style.display = 'flex'; _offlineProgUnit = unit || 'd\u00edlk\u016f'; const ti = document.getElementById('offline-progress-title'); if (ti) ti.innerText = label || 'Stahuji mapu pro offline\u2026'; updateOfflineProgress(done, total); }
        function updateOfflineProgress(done, total) { const pct = total > 0 ? Math.round(done / total * 100) : 0; const bar = document.getElementById('offline-progress-bar'); if (bar) bar.style.width = pct + '%'; const txt = document.getElementById('offline-progress-txt'); if (txt) txt.innerText = pct + ' % \u00b7 ' + done + ' / ' + total + ' ' + _offlineProgUnit; }
        function hideOfflineProgress() { const el = document.getElementById('offline-progress'); if (el) el.style.display = 'none'; } 

        function showDetails(pt, distance) {
            activePointIdForModal = pt.id; initARMarkers(); arPoints.forEach(p => { if (p.element) p.element.classList.remove('active-reading'); }); if (pt.element) pt.element.classList.add('active-reading');
            let typBodu = "Podrobný polohový bod"; if(pt.cat === 'TB') typBodu = "Trigonometrický bod"; if(pt.cat === 'ZHB') typBodu = "Zhušťovací bod"; if(pt.cat === 'NIVEL') typBodu = "Nivelační / Výškový bod"; if(pt.cat === 'CUSTOM') typBodu = "Vlastní zadaný bod";
            document.getElementById('det-title').innerHTML = `#${pt.name}`; document.getElementById('det-title').style.color = "var(--accent)"; document.getElementById('det-subtitle').innerHTML = typBodu; 
            const hlBtn = document.getElementById('highlight-btn'); if (highlightedPointId === pt.id) { hlBtn.innerHTML = '<svg class="icon"><use href="#i-star"/></svg> Zrušit zvýraznění'; hlBtn.style.background = "#fff"; } else { hlBtn.innerHTML = '<svg class="icon"><use href="#i-star"/></svg> Zvýraznit bod a navigovat'; hlBtn.style.background = "#fbbf24"; }
            hideBtnLogic = () => { pt.hidden = true; if(pt.element) { pt.element.style.opacity = '0'; setTimeout(() => { if(pt.element && pt.element.parentNode) pt.element.parentNode.removeChild(pt.element); }, 200); } if (highlightedPointId === pt.id) { highlightedPointId = null; document.getElementById('ar-hud').style.display = 'none'; } updateInfoPanel(); drawAllMarkersOnMap(); };
            let sjtskY = "Neznámé", sjtskX = "Neznámé"; if (pt.type === "custom") { let sjtsk = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]); sjtskY = Math.abs(sjtsk[0]).toFixed(2); sjtskX = Math.abs(sjtsk[1]).toFixed(2); } else if (pt.rawData) { const getVal = (keys) => { for (let k in pt.rawData) { if (keys.includes(k.toUpperCase()) && pt.rawData[k] !== "Null" && pt.rawData[k] !== null && String(pt.rawData[k]).trim() !== "") return pt.rawData[k]; } return null; }; let sY = parseFloat(getVal(['Y', 'SOURADNICE_Y'])); let sX = parseFloat(getVal(['X', 'SOURADNICE_X'])); if (!isNaN(sY) && !isNaN(sX)) { if (sY < sX) { sjtskY = sY; sjtskX = sX; } else { sjtskY = sX; sjtskX = sY; } } }
            let html = ` <div class="geo-data-row"><span class="geo-label">Vzdálenost</span><span class="geo-value" id="sheet-distance-val">${distance.toFixed(1)} m</span></div> <div class="geo-data-row"><span class="geo-label">S-JTSK Y</span><span class="geo-value">${sjtskY}</span></div> <div class="geo-data-row"><span class="geo-label">S-JTSK X</span><span class="geo-value">${sjtskX}</span></div> <div style="margin-top:15px; padding:12px; background:rgba(251,191,36,0.1); border-left:4px solid #fbbf24; border-radius:8px; font-size:13px; line-height:1.4;"><strong><svg class="icon" style="vertical-align:-0.18em; color:#fbbf24;"><use href="#i-alert"/></svg> Rádius hledání (Vaše GPS: ±<span id="sheet-gps-val">${currentGpsAccuracy.toFixed(1)}</span> m)</strong><br>Bod nehledejte na centimetr přesně na AR značce. Může ležet kdekoliv v tomto kruhovém okruhu od značky.</div> `;
            if (pt.type === "custom") { html += `<div style="text-align:center; padding: 25px 0; opacity:0.6; font-style:italic;">Ručně vytvořený bod. Můžete jej spravovat v Nastavení.</div>`; } else if (pt.rawData) { const props = pt.rawData; const getVal = (keys) => { for (let k in props) { if (keys.includes(k.toUpperCase()) && props[k] !== "Null" && props[k] !== null && String(props[k]).trim() !== "") return props[k]; } return null; }; const stabilizace = getVal(['STABILIZACE', 'TYP_ZNAK', 'TYP_ZNAKU', 'ZNAK', 'POPIS_ZNAKU']); const vyska = getVal(['VYSKA_NAD_TERENEM', 'VYSKA_ZNAKU', 'UMISTENI']); let nadmRaw = getVal(['VYSKA_BPV','NADMORSKA_VYSKA','VYSKA_BODU','VYSKA_H','H_BPV','VYSKA','H','Z']); let nadmNum = parseFloat(String(nadmRaw).replace(',', '.')); let nadmVyska = (!isNaN(nadmNum) && nadmNum > 50 && nadmNum < 3000) ? nadmNum : null; let geodataLink = null; for (let k in props) { if (typeof props[k] === 'string' && props[k].startsWith('http')) { geodataLink = props[k]; break; } } if (stabilizace || vyska !== null || nadmVyska !== null) { html += `<div class="geo-highlight" style="border-left-color: var(--accent);">`; if (nadmVyska !== null) html += `<div class="geo-data-row" style="border:none; padding: 4px 0;"><span class="geo-label" style="color:var(--text-color);">Nadmořská výška (Bpv):</span><span class="geo-value">${nadmVyska.toFixed(2)} m</span></div>`; if (stabilizace) html += `<div class="geo-data-row" style="border:none; padding: 4px 0;"><span class="geo-label" style="color:var(--text-color);">Stabilizace:</span><span class="geo-value">${stabilizace}</span></div>`; if (vyska !== null) html += `<div class="geo-data-row" style="border:none; padding: 4px 0;"><span class="geo-label" style="color:var(--text-color);">Výška n. terénem:</span><span class="geo-value">${vyska} m</span></div>`; html += `</div>`; } if (geodataLink) html += `<a href="${geodataLink}" target="_blank" class="btn-link"><svg class="icon"><use href="#i-file-text"/></svg> Otevřít nákres (Polohopis)</a>`; html += `<details><summary>Zobrazit všechny úřední záznamy</summary><div style="margin-top:10px;">`; for (let key in pt.rawData) { if (pt.rawData[key] && pt.rawData[key] !== "Null" && key !== "OBJECTID" && key !== "SHAPE") { let cleanKey = key.replace(/_/g, ' '); cleanKey = cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1); html += `<div class="geo-data-row"><span class="geo-label">${cleanKey}</span><span class="geo-value" style="font-weight:400;">${pt.rawData[key]}</span></div>`; } } html += `</div></details>`; }
            document.getElementById('det-body').innerHTML = html; document.getElementById('bottom-sheet').classList.add('open');
        }
        const mapWrapper = document.getElementById('map-wrapper'); const compassDebug = document.getElementById('compass-debug');
        // VYKON: udalosti senzoru chodi i 60+x/s; prekreslujeme max 1x za snimek (requestAnimationFrame)
        let _orientPending = false, _lastOrientEvent = null;
        function handleOrientation(event) {
            _lastOrientEvent = event; if (_calibActive) trackCalibMotion(event);
            if (_orientPending) return;
            _orientPending = true;
            requestAnimationFrame(() => { _orientPending = false; renderAR(_lastOrientEvent); });
        }
        let _haveAbsoluteHeading = false;
        function renderAR(event) {
            if (!userLat || !userLng) return;
            // ZDROJ AZIMUTU:
            // iOS: webkitCompassHeading je uz vztazeny k PRAVEMU severu (deklinaci resi OS) -> NEpridavat deklinaci.
            // Android: event.alpha je magneticky, spolehlivy jen kdyz event.absolute (deviceorientationabsolute);
            //          plain deviceorientation je relativni k orientaci pri startu -> mohlo by hodit sever o desitky stupnu.
            let rawCompass = null, headingIsTrueNorth = false, headingReliable = true;
            if (typeof event.webkitCompassHeading === 'number' && !isNaN(event.webkitCompassHeading)) {
                rawCompass = event.webkitCompassHeading; headingIsTrueNorth = true; headingReliable = true;
            } else if (event.alpha != null) {
                if (event.absolute === true) _haveAbsoluteHeading = true;
                // kdyz uz mame absolutni zdroj, ignoruj relativni udalosti (jinak by se sever rozhazel)
                if (_haveAbsoluteHeading && event.absolute !== true) return;
                let so = 0;
                if (window.screen && screen.orientation && typeof screen.orientation.angle === 'number') so = screen.orientation.angle;
                else if (typeof window.orientation === 'number') so = window.orientation;
                rawCompass = ((360 - event.alpha) + so + 360) % 360; // kompenzace orientace displeje (landscape ±90°)
                headingReliable = (event.absolute === true);
            }
            if (rawCompass === null) return;
            // SMER: volitelna auto-korekce magnetickeho kompasu podle GPS kurzu (jen pri jednoznacnem pohybu).
            // GPS kurz je za chuze nespolehlivy, proto vysoky prah rychlosti a strop korekce ±25°.
            if (visSettings.autoCompassCorrection && !headingIsTrueNorth && gpsCourse !== null && gpsSpeed > 1.4) {
                let want = angDiff(gpsCourse, rawCompass + magneticDeclination);
                headingCorrection += 0.03 * angDiff(want, headingCorrection);
                if (headingCorrection > 25) headingCorrection = 25; else if (headingCorrection < -25) headingCorrection = -25;
            }
            let corrected = (rawCompass + (headingIsTrueNorth ? 0 : magneticDeclination) + headingCorrection + userHeadingOffset + 360) % 360;
            // SMER: cyklicke vyhlazeni (mene roztreseny obraz); sila dle nastaveni
            let smoothAlpha = Math.max(0.05, 1 - (visSettings.headingSmoothing || 0) / 100);
            smoothedHeading = smoothAngle(smoothedHeading, corrected, smoothAlpha);
            let heading = smoothedHeading; currentHeading = heading;
            let relativeHeadingDeg = (heading - compassZeroOffset + 360) % 360; let displayAzimut = "";
            if (compassUnit === 'gon') { let gonTotal = relativeHeadingDeg * (400 / 360); let grad = Math.floor(gonTotal); let centigrad = Math.floor((gonTotal - grad) * 100); displayAzimut = `${grad}<sup>g</sup> ${centigrad.toString().padStart(2, '0')}<sup>c</sup>`; } else { displayAzimut = `${relativeHeadingDeg.toFixed(1)} °`; }
            let cAcc = event.webkitCompassAccuracy; let calWarn = (cAcc != null && (cAcc < 0 || cAcc > 20)) || !headingReliable;
            compassDebug.innerHTML = `Azimut: ${displayAzimut}` + (calWarn ? ' <span style="color:var(--warning);">⚠</span>' : '');
            compassDebug.title = !headingReliable ? 'Zařízení neposkytuje absolutní azimut – sever může být nepřesný. Dolaďte v Nastavení kompasu „Srovnání severu".' : (calWarn ? 'Kompas vyzaduje kalibraci – proveďte telefonem osmicku' : '');
            if (!window._mapHold && !window._popupOpen) {
                mapWrapper.style.transformOrigin = (function(){ const p = map.latLngToContainerPoint([userLat, userLng]); return p.x + 'px ' + p.y + 'px'; })(); mapWrapper.style.transform = `translate(-50%, -50%) rotate(${-heading}deg)`; mapRotation = heading;
                if (window._labelsDirty) { window._mapLabelEls = document.querySelectorAll('.map-label-text'); window._labelsDirty = false; }
                if (window._mapLabelEls) window._mapLabelEls.forEach(el => { el.style.transform = `rotate(${heading}deg)`; });
            }
            const dirContainer = document.getElementById('user-direction-container'); if (dirContainer) dirContainer.style.transform = `rotate(${heading}deg)`;
            updateNavGlow();
            if (viewMode === 'map') return; // v samostatne mape jen otacime mapu, AR projekci (kamera) preskakujeme

            // AR PROJEKCE: realny zorny uhel kamery + sklon telefonu (z beta)
            let beta = (event.beta !== null) ? event.beta : 90;
            let cameraPitchDown, imgRoll = 0;
            if (visSettings.tiltCompensation !== false && event.gamma !== null && event.beta !== null) {
                let br = beta * Math.PI / 180, gr = event.gamma * Math.PI / 180;
                let vUp = -Math.cos(br) * Math.cos(gr); // svisla slozka osy zadni kamery (jednotkovy vektor)
                cameraPitchDown = Math.atan2(-vUp, Math.sqrt(Math.max(0, 1 - vUp * vUp))) * 180 / Math.PI;
                // VODOROVNE: naklon obrazu kamery (roll kolem opticke osy) -> srovnat znacky s horizontem;
                // 0 pri svislem telefonu (beta~90), roste pri pohledu dolu se sklonem do strany.
                imgRoll = Math.atan2(Math.cos(br) * Math.sin(gr), Math.sin(br));
            } else cameraPitchDown = 90 - beta;                 // o kolik stupnu pod horizont miri kamera
            let fovH = visSettings.fovH || 90, fovV = visSettings.fovV || 75, eyeH = visSettings.eyeHeight || 1.6;
            let halfH = fovH / 2, halfV = fovV / 2, cullH = halfH + 8;
            // export projekce pro dalsi AR vrstvy (satelity.js) — at nemusi duplikovat vypocet naklonu
            window._arProj = { pitch: cameraPitchDown, roll: imgRoll, halfH: halfH, halfV: halfV };
            let highlightedPointData = null; let renderedCount = 0;

            let maxPts = visSettings.maxARPoints || 100; let vOffset = visSettings.arVerticalOffset || 0;

            arPoints.forEach(pt => {
                let isVisible = true; if (pt.hidden) isVisible = false; if (pt.cat === 'TB' && !filters.tb) isVisible = false; if (pt.cat === 'ZHB' && !filters.zhb) isVisible = false; if (pt.cat === 'PBPP' && !filters.pbpp) isVisible = false; if (pt.cat === 'NIVEL' && !filters.nivel) isVisible = false; if (pt.cat === 'CUSTOM' && !filters.custom) isVisible = false; if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) isVisible = false;
                const distance = pt.currentDist || getDistance(userLat, userLng, pt.lat, pt.lng);
                let isSelectedForDetail = (pt.id === activePointIdForModal);
                if (distance > arRadius && pt.id !== highlightedPointId && !isSelectedForDetail) isVisible = false;
                if (isVisible && pt.id !== highlightedPointId && !isSelectedForDetail) { if (renderedCount >= maxPts) { isVisible = false; } else { renderedCount++; } }
                if (!isVisible) { if (pt.element) pt.element.style.opacity = '0'; return; }

                const pointBearing = (pt.currentBearing != null) ? pt.currentBearing : getBearing(userLat, userLng, pt.lat, pt.lng); let diff = ((pointBearing - heading + 540) % 360) - 180;
                if (pt.id === highlightedPointId) { highlightedPointData = { diff: diff, dist: distance, name: pt.name }; }
                if (Math.abs(diff) < cullH) {
                    // svisle: depresni uhel k bodu na zemi vs. kam miri kamera, promitnuty pres svisly FOV
                    let depression = Math.atan2(eyeH, Math.max(distance, 0.5)) * 180 / Math.PI;
                    let screenAng = depression - cameraPitchDown;
                    // tilt: rotace odsazeni (azimut x svisly uhel) o naklon obrazu, aby znacky drzely horizont
                    let uH = diff, vV = screenAng;
                    if (imgRoll) { let cr = Math.cos(imgRoll), sr = Math.sin(imgRoll); let t = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = t; }
                    const xPct = 50 + (uH / halfH) * 50;
                    let groundY = 50 + (vV / halfV) * 50 - vOffset;
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
            drawARLines(heading, cameraPitchDown, imgRoll, halfH, halfV, vOffset, eyeH);
            
            if (highlightedPointData) {
                document.getElementById('ar-hud').style.display = 'flex'; const arrTarget = document.getElementById('arrow-target'); const arrStraight = document.getElementById('arrow-straight'); const arrLeft = document.getElementById('arrow-left'); const arrRight = document.getElementById('arrow-right'); const arrUturn = document.getElementById('arrow-uturn'); const arrBull = document.getElementById('arrow-bullseye'); const hudDistText = document.getElementById('ar-hud-dist'); const hudInfoBox = document.getElementById('ar-hud-info');
                arrTarget.style.display = 'none'; arrStraight.style.display = 'none'; arrLeft.style.display = 'none'; arrRight.style.display = 'none'; arrUturn.style.display = 'none'; arrBull.style.display = 'none';
                let diff = highlightedPointData.diff; const arrowContainer = document.getElementById('ar-hud-arrow-container');
                
                hudDistText.style.color = '#fff'; hudInfoBox.style.borderColor = 'rgba(255,255,255,0.4)';
                if (Math.abs(diff) <= 35) { arrStraight.style.display = 'block'; arrowContainer.style.transform = `perspective(800px) rotateX(65deg) rotateZ(${diff}deg)`; } else if (diff < -35 && diff >= -110) { arrLeft.style.display = 'block'; arrowContainer.style.transform = `perspective(800px) rotateX(65deg)`; } else if (diff > 35 && diff <= 110) { arrRight.style.display = 'block'; arrowContainer.style.transform = `perspective(800px) rotateX(65deg)`; } else { arrUturn.style.display = 'block'; arrowContainer.style.transform = `perspective(800px) rotateX(65deg)`; }
                hudDistText.innerText = `${highlightedPointData.dist.toFixed(1)} m`;
                document.getElementById('ar-hud-name').innerText = `#${highlightedPointData.name}`;

            } else { document.getElementById('ar-hud').style.display = 'none'; }
        }
        
        let inactivityTimer; const fadeElements = ['menu-toggle-btn', 'compass-debug', 'info', 'resizer', 'gps-avg'];
        function resetInactivityTimer() {
            fadeElements.forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('ui-faded'); }); clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => { fadeElements.forEach(id => { const el = document.getElementById(id); const bottomSheetOpen = document.getElementById('bottom-sheet').classList.contains('open'); const settingsOpen = document.getElementById('settings-modal').style.display === 'flex'; const customOpen = document.getElementById('custom-modal-overlay').style.display === 'flex'; const clusterOpen = document.getElementById('cluster-modal').style.display === 'flex'; const measureOpen = document.getElementById('measure-modal').style.display === 'flex'; const welcomeOpen = document.getElementById('welcome-screen').style.display !== 'none'; const menuOpen = document.getElementById('side-menu').classList.contains('open'); if (el && !bottomSheetOpen && !settingsOpen && !customOpen && !welcomeOpen && !menuOpen && !clusterOpen && !measureOpen) { el.classList.add('ui-faded'); } }); }, 4000);
        }
        ['touchstart', 'click', 'mousemove'].forEach(evt => { document.addEventListener(evt, resetInactivityTimer, { passive: true }); }); resetInactivityTimer();

        // ===== SPOJNICE BODU — vykresleni v mape a AR + rezim spojovani =====
        const linesGroup = L.layerGroup().addTo(map);
        function drawAllLinesOnMap() {
            window._labelsDirty = true;
            linesGroup.clearLayers();
            (pointLines || []).forEach(ln => {
                const A = resolveLineEnd(ln.aId, ln.aLat, ln.aLng), B = resolveLineEnd(ln.bId, ln.bLat, ln.bLng);
                L.polyline([[A.lat, A.lng], [B.lat, B.lng]], { color: '#fbbf24', weight: 3, opacity: 0.85, interactive: false }).addTo(linesGroup);
                // neviditelna siroka cara = dotykova plocha (tenkou caru je tezke trefit prstem)
                const hit = L.polyline([[A.lat, A.lng], [B.lat, B.lng]], { color: '#000', weight: 24, opacity: 0 });
                hit.on('click', (ev) => {
                    if (connectMode || areaMode || mapAddMode) return; // v rezimech kresleni tap patri mapovemu handleru
                    const cp = map.latLngToContainerPoint(getMapClickLatLng(ev));
                    let nearPoint = false;
                    arPoints.forEach(pt => { if (nearPoint || !passesFilters(pt)) return; if (cp.distanceTo(map.latLngToContainerPoint(L.latLng(pt.lat, pt.lng))) <= 25) nearPoint = true; });
                    if (nearPoint) return; // tap u bodu patri bodu (detail/zvyrazneni), ne mazani cary
                    L.DomEvent.stopPropagation(ev);
                    if (confirm('Smazat tuto spojnici (' + lineEndName(ln.aId, ln.aName) + ' \u2194 ' + lineEndName(ln.bId, ln.bName) + ')?')) { deleteLine(ln.id); }
                });
                hit.addTo(linesGroup);
                const d = getDistance(A.lat, A.lng, B.lat, B.lng);
                const mid = L.divIcon({ className: 'custom-map-marker', html: `<div style="position:relative; width:0; height:0;"><div class="map-label-text line-len-label" style="left:-16px; top:-18px; transform: rotate(${currentHeading}deg);">${d.toFixed(1)} m</div></div>`, iconSize: [0, 0] });
                L.marker([(A.lat + B.lat) / 2, (A.lng + B.lng) / 2], { icon: mid, interactive: false }).addTo(linesGroup);
            });
        }
        function toggleConnectMode() {
            connectMode = !connectMode; connectFirstPt = null;
            const b = document.getElementById('btn-connect'); if (b) b.classList.toggle('ctrl-active', connectMode);
            const h = document.getElementById('connect-hint'); if (h) h.style.display = connectMode ? 'flex' : 'none';
            const t = document.getElementById('connect-hint-txt'); if (t) t.innerText = 'Klepni na první bod spojnice';
            if (connectMode) { cancelMapPick(); document.getElementById('map-controls').classList.remove('expanded'); }
        }
        function handleConnectTap(clickLatLng) {
            const cp = map.latLngToContainerPoint(clickLatLng); let nearest = null, nd = 30;
            arPoints.forEach(pt => { if (!passesFilters(pt)) return; const pp = map.latLngToContainerPoint(L.latLng(pt.lat, pt.lng)); const dd = cp.distanceTo(pp); if (dd < nd) { nd = dd; nearest = pt; } });
            const t = document.getElementById('connect-hint-txt');
            if (!nearest) { if (t) t.innerText = 'Klepni přímo na bod v mapě' + (connectFirstPt ? ' (první: #' + connectFirstPt.name + ')' : ''); return; }
            if (!connectFirstPt) {
                connectFirstPt = nearest; if (t) t.innerText = 'První: #' + nearest.name + ' — klepni na další bod';
            } else if (nearest.id !== connectFirstPt.id) {
                addLine(connectFirstPt, nearest); connectFirstPt = nearest; drawAllLinesOnMap();
                if (t) t.innerText = 'Spojeno — pokračuj od #' + nearest.name + ', nebo Hotovo';
                if (visSettings.vibrationEnabled && navigator.vibrate) navigator.vibrate(30);
            }
        }
        // AR: stejna projekce jako u znacek v renderAR (azimut x svisly uhel + korekce naklonu obrazu)
        function _projectARPoint(lat, lng, heading, cameraPitchDown, imgRoll, halfH, halfV, vOffset, eyeH) {
            const dist = getDistance(userLat, userLng, lat, lng);
            const bearing = getBearing(userLat, userLng, lat, lng);
            const diff = ((bearing - heading + 540) % 360) - 180;
            let uH = diff, vV = Math.atan2(eyeH, Math.max(dist, 0.5)) * 180 / Math.PI - cameraPitchDown;
            if (imgRoll) { const cr = Math.cos(imgRoll), sr = Math.sin(imgRoll); const tt = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = tt; }
            return { x: 50 + (uH / halfH) * 50, y: 50 + (vV / halfV) * 50 - vOffset, diff: diff, dist: dist };
        }
        let _arLinesSvg = null;
        function drawARLines(heading, cameraPitchDown, imgRoll, halfH, halfV, vOffset, eyeH) {
            if (!pointLines || !pointLines.length) { if (_arLinesSvg) _arLinesSvg.innerHTML = ''; return; }
            if (!_arLinesSvg) {
                _arLinesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                _arLinesSvg.setAttribute('viewBox', '0 0 100 100'); _arLinesSvg.setAttribute('preserveAspectRatio', 'none');
                _arLinesSvg.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:1;';
                arOverlay.insertBefore(_arLinesSvg, arOverlay.firstChild);
            }
            let html = '';
            pointLines.forEach(ln => {
                const A = resolveLineEnd(ln.aId, ln.aLat, ln.aLng), B = resolveLineEnd(ln.bId, ln.bLat, ln.bLng);
                const pa = _projectARPoint(A.lat, A.lng, heading, cameraPitchDown, imgRoll, halfH, halfV, vOffset, eyeH);
                const pb = _projectARPoint(B.lat, B.lng, heading, cameraPitchDown, imgRoll, halfH, halfV, vOffset, eyeH);
                if (Math.min(pa.dist, pb.dist) > arRadius) return;              // aspon jeden konec v AR dosahu
                if (Math.abs(pa.diff) > 120 || Math.abs(pb.diff) > 120) return; // konec za zady -> nekreslit (artefakty pres obrazovku)
                html += '<line x1="' + pa.x.toFixed(2) + '" y1="' + pa.y.toFixed(2) + '" x2="' + pb.x.toFixed(2) + '" y2="' + pb.y.toFixed(2) + '" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" opacity="0.85" vector-effect="non-scaling-stroke"/>';
            });
            _arLinesSvg.innerHTML = html;
        }

        // ===== MERENI PLOCHY (rezim v mape) =====
        const areaGroup = L.layerGroup().addTo(map);
        function startAreaMode() {
            if (viewMode === 'ar') { alert('Měření plochy funguje v mapě — přepni na Split nebo Mapu.'); return; }
            document.getElementById('measure-modal').style.display = 'none';
            areaMode = true; areaVertices = [];
            const p = document.getElementById('area-panel'); if (p) p.style.display = 'flex';
            document.getElementById('map-controls').classList.remove('expanded');
            redrawAreaPolygon(); updateAreaPanel();
        }
        function stopAreaMode() { areaMode = false; areaVertices = []; areaGroup.clearLayers(); const p = document.getElementById('area-panel'); if (p) p.style.display = 'none'; fixAppLayout(); }
        function areaAddGps() {
            if (gpsAvgResult && gpsAvgResult.n >= 2) areaVertices.push({ lat: gpsAvgResult.lat, lng: gpsAvgResult.lng });
            else if (userLat != null) areaVertices.push({ lat: userLat, lng: userLng });
            else { alert('Čekám na GPS pozici...'); return; }
            afterAreaChange();
        }
        function areaUndo() { areaVertices.pop(); afterAreaChange(); }
        function afterAreaChange() { redrawAreaPolygon(); updateAreaPanel(); if (visSettings.vibrationEnabled && navigator.vibrate) navigator.vibrate(20); }
        function redrawAreaPolygon() {
            areaGroup.clearLayers();
            if (!areaVertices.length) return;
            const latlngs = areaVertices.map(v => [v.lat, v.lng]);
            if (areaVertices.length >= 3) L.polygon(latlngs, { color: '#34d399', weight: 3, fillColor: '#34d399', fillOpacity: 0.18 }).addTo(areaGroup);
            else if (areaVertices.length === 2) L.polyline(latlngs, { color: '#34d399', weight: 3 }).addTo(areaGroup);
            areaVertices.forEach(v => L.circleMarker([v.lat, v.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#34d399', fillOpacity: 1 }).addTo(areaGroup));
        }
        function updateAreaPanel() {
            const r = polygonAreaPerimeter(areaVertices);
            const av = document.getElementById('area-val'), ap = document.getElementById('area-perim'), ac = document.getElementById('area-count');
            if (av) av.innerText = areaVertices.length >= 3 ? (r.area >= 50000 ? (r.area / 10000).toFixed(3) + ' ha' : r.area.toFixed(1) + ' m\u00b2') : '\u2014';
            if (ap) ap.innerText = areaVertices.length >= 2 ? r.perim.toFixed(1) + ' m' : '\u2014';
            if (ac) ac.innerText = areaVertices.length;
        }

        // ===== GEODETICKY SLOVNIK (vestavene pojmy + vlastni v localStorage, spolecne pro vsechny zakazky) =====
        const GEO_DICT = [
            { t: 'TB — trigonometrický bod', d: 'Bod základního polohového bodového pole s přesně určenými souřadnicemi. V terénu zpravidla žulový hranol s křížkem, často chráněný betonovou skruží. V aplikaci fialový trojúhelník.' },
            { t: 'ZhB — zhušťovací bod', d: 'Bod doplňující (zhušťující) síť trigonometrických bodů polohového pole. V aplikaci modrý čtverec.' },
            { t: 'PBPP — podrobný bod polohového pole', d: 'Pomocný měřický bod pro připojení podrobného měření. V aplikaci kruhová značka.' },
            { t: 'Nivelační bod', d: 'Bod výškového bodového pole se známou nadmořskou výškou (Bpv). Stabilizace čepovou nebo hřebovou značkou, např. na budovách a mostech. V aplikaci červené mezikruží.' },
            { t: 'Bodové pole', d: 'Souhrn geodetických bodů na území státu: polohové (TB, ZhB, PBPP), výškové (nivelační) a tíhové.' },
            { t: 'S-JTSK', d: 'Systém Jednotné trigonometrické sítě katastrální — závazný souřadnicový systém ČR (Křovákovo zobrazení). Souřadnice Y a X v metrech; matematicky jsou záporné, v praxi se píší kladné (Y ~ 430–905 km, X ~ 935–1230 km).' },
            { t: 'Křovákovo zobrazení', d: 'Dvojité kuželové konformní zobrazení v obecné poloze, základ S-JTSK. Navrhl Josef Křovák (1922).' },
            { t: 'Bpv — Balt po vyrovnání', d: 'Závazný výškový systém ČR; nadmořské výšky vztažené k hladině Baltského moře (vyrovnání 1957).' },
            { t: 'WGS84', d: 'Světový geodetický systém používaný GPS — zeměpisná šířka a délka na elipsoidu. Telefonní GPS vrací polohu právě v něm; aplikace ji převádí do S-JTSK.' },
            { t: 'ETRS89', d: 'Evropský terestrický referenční systém — realizace souřadnicového systému pro přesná GNSS měření v Evropě.' },
            { t: 'GNSS', d: 'Souhrnné označení globálních družicových navigačních systémů: GPS, Galileo, GLONASS, BeiDou.' },
            { t: 'RTK — Real Time Kinematic', d: 'Metoda GNSS měření s korekcemi v reálném čase (z referenční stanice nebo sítě). Přesnost v řádu centimetrů.' },
            { t: 'CZEPOS', d: 'Síť permanentních GNSS stanic spravovaná Zeměměřickým úřadem; poskytuje korekce pro RTK měření v ČR.' },
            { t: 'Totální stanice', d: 'Elektronický přístroj měřící vodorovné i svislé úhly a délky (dálkoměr); základní nástroj podrobného měření.' },
            { t: 'Teodolit', d: 'Přístroj na přesné měření vodorovných a svislých úhlů (bez dálkoměru).' },
            { t: 'Nivelace', d: 'Měření převýšení mezi body pomocí nivelačního přístroje a latí. Geometrická nivelace ze středu je nejpřesnější běžná metoda určování výšek.' },
            { t: 'Polygonový pořad', d: 'Řada navazujících bodů, mezi nimiž se měří délky a vrcholové úhly; slouží k určení souřadnic nových bodů.' },
            { t: 'Polární metoda', d: 'Určení polohy bodu měřením směru (úhlu) a vzdálenosti od stanoviska. Dnes nejběžnější metoda podrobného měření.' },
            { t: 'Ortogonální metoda', d: 'Určení polohy bodu staničením (podél měřické přímky) a kolmicí; historicky častá metoda, dodnes v náčrtech.' },
            { t: 'Měřická přímka', d: 'Spojnice dvou bodů, od níž se ortogonálně (staničení + kolmice) určují podrobné body.' },
            { t: 'Vytyčení', d: 'Přenesení polohy bodů (např. hranice pozemku nebo stavby) z dokumentace do terénu — opak zaměření.' },
            { t: 'Vytyčovací náčrt', d: 'Grafický doklad o vytyčení hranice pozemku; spolu s protokolem se předává vlastníkům a dokumentuje vytyčení.' },
            { t: 'ZPMZ — záznam podrobného měření změn', d: 'Technický podklad a dokumentace měření pro změny v katastru (podklad geometrického plánu).' },
            { t: 'GP — geometrický plán', d: 'Technický podklad pro zápis změny do katastru nemovitostí (dělení pozemku, vyznačení budovy, věcné břemeno…). Ověřuje ÚOZI, potvrzuje katastrální pracoviště.' },
            { t: 'ÚOZI', d: 'Úředně oprávněný zeměměřický inženýr — osoba s oprávněním ověřovat výsledky zeměměřických činností (GP, vytyčení…).' },
            { t: 'KN — katastr nemovitostí', d: 'Veřejný seznam obsahující soupis, popis a geometrické a polohové určení nemovitostí, včetně práv k nim.' },
            { t: 'LV — list vlastnictví', d: 'Výpis z katastru prokazující vlastnictví; obsahuje vlastníky, nemovitosti, omezení a poznámky v daném k.ú.' },
            { t: 'k.ú. — katastrální území', d: 'Technická jednotka, kterou tvoří místopisně uzavřený a v katastru společně evidovaný soubor nemovitostí.' },
            { t: 'Parcela', d: 'Pozemek, který je geometricky a polohově určen, zobrazen v katastrální mapě a označen parcelním číslem.' },
            { t: 'BPEJ', d: 'Bonitovaná půdně ekologická jednotka — pětimístný kód vyjadřující kvalitu zemědělské půdy (ovlivňuje cenu).' },
            { t: 'Věcné břemeno', d: 'Právo k cizí nemovitosti zapsané v KN (např. vedení inženýrské sítě, právo cesty, služebnost).' },
            { t: 'Mezník', d: 'Kámen nebo plastový znak trvale stabilizující lomový bod hranice pozemku. Hlavička bývá označena křížkem nebo důlkem.' },
            { t: 'Stabilizace', d: 'Trvalé osazení bodu v terénu: kámen (mezník), hřeb, trubka, čep, vytesaný křížek. Údaj „stabilizace" u bodu říká, co v terénu hledat.' },
            { t: 'Signalizace', d: 'Dočasné zviditelnění bodu pro měření — výtyčka, terč, reflexní štítek.' },
            { t: 'Hřebová značka', d: 'Stabilizace bodu ocelovým hřebem, typicky v obrubníku, skále nebo zpevněné ploše.' },
            { t: 'Azimut', d: 'Vodorovný úhel měřený od severu po směru hodinových ručiček: 0–360° nebo 0–400 gon. Aplikace jej ukazuje v HUD (klepnutím lze přepnout jednotky).' },
            { t: 'Gon (grad)', d: 'Úhlová jednotka běžná v geodézii: pravý úhel = 100 gon, plný kruh = 400 gon. 1 gon = 0,9°.' },
            { t: 'Převýšení', d: 'Výškový rozdíl mezi dvěma body. V aplikaci jej spočítá nástroj Měření vzdálenosti (z GPS výšek — jen orientačně).' },
            { t: 'Magnetická deklinace', d: 'Úhel mezi magnetickým a zeměpisným severem. V ČR aktuálně zhruba +5° až +6° východně a roste; aplikace ji automaticky koriguje.' },
            { t: 'Undulace geoidu', d: 'Rozdíl mezi elipsoidickou výškou (GPS) a nadmořskou výškou (Bpv). V ČR přibližně 44–47 m; aplikace ji při výpočtu výšek odečítá.' },
            { t: 'ČÚZK', d: 'Český úřad zeměměřický a katastrální — správce katastru, bodových polí, ortofota a dalších dat, která aplikace používá.' },
            { t: 'RÚIAN', d: 'Registr územní identifikace, adres a nemovitostí — jeden ze základních registrů státu (adresy, ulice, parcely, budovy).' },
            { t: 'ZABAGED', d: 'Základní báze geografických dat ČR — digitální topografický model území spravovaný Zeměměřickým úřadem.' }
        ];
        function getCustomDict() { try { return JSON.parse(localStorage.getItem('arDictCustom')) || []; } catch (e) { return []; } }
        function saveCustomDict(list) { try { localStorage.setItem('arDictCustom', JSON.stringify(list)); } catch (e) {} }
        function openDictModal() { renderDictList(); document.getElementById('dict-modal').style.display = 'flex'; }
        function addDictEntry() {
            const t = document.getElementById('dict-new-term').value.trim();
            const d = document.getElementById('dict-new-def').value.trim();
            if (!t || !d) { alert('Vyplňte pojem i vysvětlení.'); return; }
            const list = getCustomDict(); list.push({ t: t, d: d }); saveCustomDict(list);
            document.getElementById('dict-new-term').value = ''; document.getElementById('dict-new-def').value = '';
            renderDictList();
        }
        function deleteDictEntry(idx) { if (!confirm('Smazat tento vlastní pojem?')) return; const list = getCustomDict(); list.splice(idx, 1); saveCustomDict(list); renderDictList(); }
        function _escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
        function renderDictList() {
            const listDiv = document.getElementById('dict-list'); if (!listDiv) return;
            const q = (document.getElementById('dict-search').value || '').trim().toLowerCase();
            const match = (e) => !q || e.t.toLowerCase().includes(q) || e.d.toLowerCase().includes(q);
            let html = '';
            getCustomDict().forEach((e, i) => { if (!match(e)) return; html += '<div class="dict-item custom"><div><div class="dict-term">' + _escHtml(e.t) + '</div><div class="dict-def">' + _escHtml(e.d) + '</div></div><button class="dict-del" onclick="deleteDictEntry(' + i + ')" aria-label="Smazat pojem"><svg class="icon"><use href="#i-trash"/></svg></button></div>'; });
            GEO_DICT.forEach(e => { if (!match(e)) return; html += '<div class="dict-item"><div class="dict-term">' + _escHtml(e.t) + '</div><div class="dict-def">' + _escHtml(e.d) + '</div></div>'; });
            listDiv.innerHTML = html || '<p style="text-align:center; opacity:0.7;">Nic nenalezeno.</p>';
        }

        // ===== ZAVRENI KLEPNUTIM MIMO OBSAH =====
        // Klepnuti na ztmavle pozadi zavre dialog stejne jako tlacitko Zavrit; kde existuje
        // specialni zaviraci funkce (uklid stavu), pouzije se ona.
        const _overlayCloseFns = { 'manage-modal': closeManageModal, 'custom-modal-overlay': closeCustomModal, 'compass-calib-modal': dismissCompassCalib };
        document.querySelectorAll('.modal-overlay').forEach(ov => {
            ov.addEventListener('click', (e) => {
                if (e.target !== ov) return;
                const fn = _overlayCloseFns[ov.id];
                if (fn) fn(); else { ov.style.display = 'none'; fixAppLayout(); }
            });
        });
        // postranni menu: klepnuti kamkoliv mimo nej ho zavre
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('side-menu');
            if (!menu || !menu.classList.contains('open')) return;
            if (e.target.closest('#side-menu') || e.target.closest('#menu-toggle-btn')) return;
            menu.classList.remove('open');
        }, true);
        // karta bodu (bottom sheet): klepnuti mimo ni kartu zavre; tuknuti se spolkne,
        // aby nepropadlo do mapy/AR (nahodne stahovani oblasti apod.)
        document.addEventListener('click', (e) => {
            const sheet = document.getElementById('bottom-sheet');
            if (!sheet || !sheet.classList.contains('open')) return;
            if (sheet.contains(e.target)) return;
            if (e.target.closest('.ar-marker')) return; // tuknuti na jiny bod = rovnou prepnout detail
            e.preventDefault(); e.stopPropagation();
            closeBottomSheet();
        }, true);
        // ===== PROSTOROVE OTEVIRANI: modaly a karta bodu vyrustaji z mista posledniho tuknuti =====
        let _lastTapX = null, _lastTapY = null, _lastTapTime = 0;
        document.addEventListener('pointerdown', (e) => { _lastTapX = e.clientX; _lastTapY = e.clientY; _lastTapTime = Date.now(); }, true);
        function _setSpawnOrigin(el, onlyX) {
            if (!el) return;
            const fresh = _lastTapX != null && (Date.now() - _lastTapTime) < 1500;
            if (!fresh) { el.style.removeProperty('--spawn-ox'); el.style.removeProperty('--spawn-oy'); return; }
            if (onlyX) { el.style.setProperty('--spawn-ox', Math.round(_lastTapX) + 'px'); return; }
            // getBoundingClientRect by behem startujici animace vracel zkreslene hodnoty ->
            // pozici vycentrovaneho modalu spocitame z layoutu (offsetWidth/Height transform nemeni)
            const w = el.offsetWidth, h = el.offsetHeight;
            const left = (window.innerWidth - w) / 2, top = (window.innerHeight - h) / 2;
            const clampv = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
            el.style.setProperty('--spawn-ox', Math.round(clampv(_lastTapX - left, -0.3 * w, 1.3 * w)) + 'px');
            el.style.setProperty('--spawn-oy', Math.round(clampv(_lastTapY - top, -0.3 * h, 1.3 * h)) + 'px');
        }
        (function () {
            document.querySelectorAll('.modal-overlay').forEach(ov => {
                let wasOpen = ov.style.display === 'flex';
                new MutationObserver(() => {
                    const open = ov.style.display === 'flex';
                    if (open && !wasOpen) _setSpawnOrigin(ov.querySelector('.modal-content'));
                    wasOpen = open;
                }).observe(ov, { attributes: true, attributeFilter: ['style'] });
            });
            const sheet = document.getElementById('bottom-sheet');
            if (sheet) {
                let wasOpen = false;
                new MutationObserver(() => {
                    const open = sheet.classList.contains('open');
                    if (open && !wasOpen) { _setSpawnOrigin(sheet, true); }
                    wasOpen = open;
                }).observe(sheet, { attributes: true, attributeFilter: ['class'] });
            }
        })();

        // ===== BAREVNE MOTIVY: trida na <body>; 'aurora' = vychozi bez tridy =====
        function previewTheme(t) {
            ['theme-aurora', 'theme-sunset', 'theme-ocean', 'theme-forest', 'theme-graphite'].forEach(c => document.body.classList.remove(c));
            if (t && t !== 'smaragd') document.body.classList.add('theme-' + t);
        }
        function previewMode(m) { var light = m === 'light'; document.body.classList.toggle('light-mode', light); var mc = document.querySelector('meta[name="theme-color"]'); if (mc) mc.setAttribute('content', light ? '#f4f5f7' : '#0f1216'); }

        // ===== DUHOVY OKRAJ: zari po celou navigaci na bod, zesili a zrychli pri dohledavani (< 2 m) =====
        function updateNavGlow() {
            const eg = document.getElementById('edge-glow'); if (!eg) return;
            const pt = highlightedPointId ? arPoints.find(p => p.id === highlightedPointId) : null;
            const active = !!(pt && appStarted && userLat != null);
            eg.classList.toggle('on', active);
            eg.classList.toggle('near', active && getDistance(userLat, userLng, pt.lat, pt.lng) <= 2.0);
        }

        // ===== ADAPTIVNI SKLO: vzorkuje jas obrazu kamery (~1x za 0.7 s) a prepina svetly rezim AR panelu =====
        const _lumaCanvas = document.createElement('canvas'); _lumaCanvas.width = 24; _lumaCanvas.height = 16;
        const _lumaCtx = _lumaCanvas.getContext('2d', { willReadFrequently: true });
        setInterval(() => {
            if (visSettings.adaptiveGlass === false || visSettings.outdoorMode || !appStarted || viewMode === 'map' || document.visibilityState !== 'visible') { document.body.classList.remove('cam-light'); return; }
            const v = document.getElementById('camera-feed');
            if (!v || v.readyState < 2 || !v.videoWidth) return;
            try {
                _lumaCtx.drawImage(v, 0, 0, 24, 16);
                const d = _lumaCtx.getImageData(0, 0, 24, 16).data;
                let sum = 0; for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                const luma = sum / (d.length / 4);
                // hystereze, aby panely na hranici svetla/tmy neblikaly
                if (luma > 150) document.body.classList.add('cam-light');
                else if (luma < 115) document.body.classList.remove('cam-light');
            } catch (e) { /* video jeste neni pripravene */ }
        }, 700);
