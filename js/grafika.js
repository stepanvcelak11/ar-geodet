// ===== AR Geodet - GRAFICKA CAST (vykreslovani) =====
// AR znacky a sipka, mapa, kompas, modaly, nastaveni vzhledu, ovladani displeje.
// Nacita se PO logika.js (pouziva jeji promenne a funkce).

// PWA: nova verze ceka -> nabidnout obnovu (resi matouci starou cache)
        // `__agUpdateWaiting` je JEDINY zdroj pravdy o tom, ze nova verze ceka. Cte ho
        // js/historie-aktualizaci.js (trvale tlacitko „Aktualizovat teď") — lista sama
        // uz na to nestaci, protoze se od 31. 8. 2026 ukazuje NEJVYS JEDNOU ZA DEN
        // (viz dayGate v js/co-je-noveho.js), takze vetsinu casu videt neni.
        function showUpdateBanner() { window.__agUpdateWaiting = true; const b = document.getElementById('update-banner'); if (b) b.style.display = 'flex'; }
        window.agUpdateWaiting = function () { return !!window.__agUpdateWaiting; };
        // Priznak "uzivatel si obnovu vyzadal" cte handler controllerchange v logika.js:
        // ten se po opravce reloadu drzi jen skutecnych aktualizaci, a tohle pokryva i
        // pripad, kdy se stranka nactla BEZ controlleru (tvrdy reload) a uzivatel pak
        // na listu klepnul — jinak by se nova verze nasadila az pri dalsim spusteni.
        function applyUpdate() { window.__agUpdateRequested = true; navigator.serviceWorker.getRegistration().then(reg => { if (reg && reg.waiting) reg.waiting.postMessage('SKIP_WAITING'); }); const b = document.getElementById('update-banner'); if (b) b.style.display = 'none'; }

        function renderProjectSelect() {
            const sel = document.getElementById('w-project-select'); sel.innerHTML = '';
            projects.forEach(p => { const opt = document.createElement('option'); opt.value = p.id; opt.innerText = p.name; if(p.id === activeProjectId) opt.selected = true; sel.appendChild(opt); });
        }
        const arrowPaths = { '1': "M50 10 L90 50 L70 50 L70 95 L30 95 L30 50 L10 50 Z", '2': "M50 10 L70 30 L55 30 L55 95 L45 95 L45 30 L30 30 Z", '3': "M50 10 L90 50 L70 60 L50 40 L30 60 L10 50 Z", '4': "M50 10 L90 90 L50 70 L10 90 Z", '5': "M50 10 L90 50 L50 90 L10 50 Z" };

        // ===== BEZPECNE CTENI A PLNENI FORMULARU ===================================
        // Nastaveni pracuje s ~90 policky a delalo to retezem `getElementById('x').value`
        // bez jedine kontroly na null. Jedno chybejici id (odpojeny modul, zalozka, ktera
        // se jeste nestihla dosypat, budouci uprava HTML) proto neshodilo jen ten jeden
        // radek, ale CELOU funkci: v saveSettings() se pak nic neulozilo, okno Nastaveni
        // se nezavrelo a appka pusobila zaseknute; v applyVisualSettings() se neaplikoval
        // zbytek vzhledu. Dnes vsechna ta id v index.html jsou — tohle je pojistka proti
        // regresi, ne oprava zive chyby.
        //
        // Pravidlo: PSANI do chybejiciho prvku se tise preskoci, CTENI z nej vrati zalozni
        // hodnotu (typicky dosavadni nastaveni), takze se do visSettings nikdy nedostane
        // NaN nebo undefined.
        function _agSet(id, prop, val) { const e = document.getElementById(id); if (e) e[prop] = val; return !!e; }
        function _agChk(id, fallback) { const e = document.getElementById(id); return e ? !!e.checked : !!fallback; }
        function _agStr(id, fallback) { const e = document.getElementById(id); const v = e ? e.value : null; return (v == null || v === '') ? fallback : v; }
        function _agInt(id, fallback) { const e = document.getElementById(id); const v = e ? parseInt(e.value, 10) : NaN; return isFinite(v) ? v : fallback; }
        function _agFloat(id, fallback) { const e = document.getElementById(id); const v = e ? parseFloat(e.value) : NaN; return isFinite(v) ? v : fallback; }

        function applyVisualSettings() {
            applyMapLayers();
            document.body.classList.toggle('outdoor-mode', !!visSettings.outdoorMode);
            document.body.classList.toggle('left-hand', !!visSettings.leftHand);
            { const _an = visSettings.anim || 'auto'; const _r = document.documentElement; _r.classList.toggle('ag-anim-on', _an === 'on'); _r.classList.toggle('ag-anim-off', _an === 'off'); }
            document.documentElement.style.setProperty('--dock-arc', (visSettings.dockArc == null ? 13 : visSettings.dockArc) + 'px');
            document.documentElement.style.setProperty('--hud-top', visSettings.hudTop + 'px'); document.documentElement.style.setProperty('--hud-side', visSettings.hudSide + 'px'); document.documentElement.style.setProperty('--marker-opacity', visSettings.markerOpacity / 100); document.documentElement.style.setProperty('--color-tb', visSettings.colTb); document.documentElement.style.setProperty('--color-zhb', visSettings.colZhb); document.documentElement.style.setProperty('--color-pbpp', visSettings.colPbpp); document.documentElement.style.setProperty('--color-nivel', visSettings.colNivel); document.documentElement.style.setProperty('--color-custom', visSettings.colCustom); document.documentElement.style.setProperty('--arrow-size', (100 * visSettings.arrowScale) + 'px'); document.documentElement.style.setProperty('--arrow-opacity', visSettings.arrowOpacity / 100); document.documentElement.style.setProperty('--color-arrow', visSettings.colArrow); document.documentElement.style.setProperty('--panel-opacity', visSettings.panelOpacity / 100); /* --menu-scale: jezdec odstraněn (mrtvá volba), zůstává default 1 z :root */
            document.documentElement.style.setProperty('--hud-scale', visSettings.hudScale || 1);
            // VELIKOST PISMA: nasobi kazdy pevny font-size (viz --ag-font-scale v tokens.css).
            // Jezdec "Velikost textu a menu" tu uz jednou byl a byl ODSTRANEN, protoze menil
            // jen --menu-scale (transform par HUD prvku) a textu se nedotkl -> pusobil rozbite.
            // Tenhle uz text opravdu meni; pri pripadnem odebirani nechat token na 1.
            document.documentElement.style.setProperty('--ag-font-scale', visSettings.fontScale || 1);
            previewTheme(visSettings.theme); previewMode(visSettings.mode);
            const arrPath = document.getElementById('main-arrow-path'); if(arrPath) { arrPath.setAttribute('d', arrowPaths[visSettings.arrowShape]); arrPath.setAttribute('fill', visSettings.colArrow); document.getElementById('arrow-straight').style.filter = `drop-shadow(0 15px 15px ${visSettings.colArrow}80)`; document.getElementById('target-circle-out').setAttribute('stroke', visSettings.colArrow); document.getElementById('target-circle-in').setAttribute('fill', visSettings.colArrow); document.getElementById('arrow-target').style.filter = `drop-shadow(0 15px 15px ${visSettings.colArrow}90)`; }
            // PLNENI POLICEK V NASTAVENI — pres _agSet (chybejici prvek se preskoci).
            // Drive to byl retez nechranenych pristupu: jedno chybejici id vyhodilo
            // vyjimku, ta propadla do volajiciho (saveSettings, start appky, prepnuti
            // motivu) a zbytek te funkce se uz neprovedl. Vzhled sam (radky vyse) se
            // aplikuje JESTE PRED timhle blokem, takze i pripadny prusvih tady uz
            // nemuze rozbit to, jak appka vypada.
            if (document.getElementById('s-max-ar-slider')) {
                _agSet('s-wakelock', 'checked', visSettings.wakeLockEnabled);
                _agSet('s-outdoor', 'checked', !!visSettings.outdoorMode);
                _agSet('s-auto-outdoor', 'checked', visSettings.autoOutdoor !== false);
                _agSet('s-lefthand', 'checked', !!visSettings.leftHand);
                _agSet('s-vibration', 'checked', visSettings.vibrationEnabled !== false);
                _agSet('s-anim', 'value', visSettings.anim || 'auto');
                { var _av = (visSettings.dockArc == null ? 13 : visSettings.dockArc); _agSet('v-dock-arc', 'value', _av); _agSet('v-dock-arc-val', 'innerText', _av); }
                _agSet('s-katastr-source', 'value', visSettings.katastrSource || 'mapycz');
                _agSet('s-max-ar-slider', 'value', visSettings.maxARPoints); _agSet('s-max-ar-val', 'innerText', visSettings.maxARPoints);
                _agSet('v-ar-height-slider', 'value', visSettings.arVerticalOffset); _agSet('v-ar-height-val', 'innerText', visSettings.arVerticalOffset);
                { var _ms = Math.round(visSettings.markerScale * 100); _agSet('v-marker-scale', 'value', _ms); _agSet('v-marker-scale-val', 'innerText', _ms); }
                _agSet('v-marker-opacity', 'value', visSettings.markerOpacity); _agSet('v-marker-opacity-val', 'innerText', visSettings.markerOpacity);
                _agSet('col-tb', 'value', visSettings.colTb); _agSet('col-zhb', 'value', visSettings.colZhb); _agSet('col-pbpp', 'value', visSettings.colPbpp); _agSet('col-nivel', 'value', visSettings.colNivel); _agSet('col-custom', 'value', visSettings.colCustom); _agSet('col-arrow', 'value', visSettings.colArrow);
                _agSet('v-arrow-shape', 'value', visSettings.arrowShape);
                { var _as = Math.round(visSettings.arrowScale * 100); _agSet('v-arrow-scale', 'value', _as); _agSet('v-arrow-scale-val', 'innerText', _as); }
                _agSet('v-arrow-opacity', 'value', visSettings.arrowOpacity); _agSet('v-arrow-opacity-val', 'innerText', visSettings.arrowOpacity);
                _agSet('v-panel-opacity', 'value', visSettings.panelOpacity); _agSet('v-panel-opacity-val', 'innerText', visSettings.panelOpacity);
                _agSet('s-auto-compass', 'checked', visSettings.autoCompassCorrection);
                _agSet('s-tilt-comp', 'checked', visSettings.tiltCompensation !== false);
                _agSet('s-heading-smooth', 'value', visSettings.headingSmoothing); _agSet('s-heading-smooth-val', 'innerText', visSettings.headingSmoothing);
                _agSet('s-fovh', 'value', visSettings.fovH); _agSet('s-fovh-val', 'innerText', visSettings.fovH);
                _agSet('s-fovv', 'value', visSettings.fovV); _agSet('s-fovv-val', 'innerText', visSettings.fovV);
                _agSet('s-eyeh', 'value', visSettings.eyeHeight); _agSet('s-eyeh-val', 'innerText', visSettings.eyeHeight);
                _agSet('v-adaptive-glass', 'checked', visSettings.adaptiveGlass !== false);
                _agSet('v-theme', 'value', visSettings.theme || 'smaragd');
                _agSet('v-mode', 'value', visSettings.mode || 'dark');
                { var _fv = Math.round((visSettings.fontScale || 1) * 100); _agSet('v-font-scale', 'value', _fv); _agSet('v-font-scale-val', 'innerText', _fv); }
                { var _hs = Math.round((visSettings.hudScale || 1) * 100); _agSet('v-hud-scale', 'value', _hs); _agSet('v-hud-scale-val', 'innerText', _hs); }
            }
        }

        // Prepinac vibraci v Nastaveni: ulozi se hned a rovnou to zavibruje (aby bylo
        // poznat, jestli to telefon vubec umi — iPhone v prohlizeci vibrace nepodporuje).
        function toggleVibration() {
            const el = document.getElementById('s-vibration'); if (!el) return;
            visSettings.vibrationEnabled = el.checked;
            setStoredData('arVisSettings12', JSON.stringify(visSettings));
            if (el.checked) {
                if (navigator.vibrate) { agVibe(40); quickToast('Vibrace zapnuty.'); }
                else quickToast('Tenhle telefon/prohlížeč vibrace neumožňuje (iPhone).');
            } else quickToast('Vibrace vypnuty.');
        }
        function switchTab(tabId, btnEl) {
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            btnEl.classList.add('active');
            // Pruh zalozek se od navrhu C roluje do stran (5 zalozek se na telefon
            // nevejde). Bez tohohle zustala vybrana zalozka za okrajem a nebylo poznat,
            // ktera plati - zvlast u posledni "Profily", na kterou se prepina z hledani
            // nebo z odkazu. scrollIntoView jen VODOROVNE, at neposkoci cely modal.
            try {
                const strip = btnEl.parentNode;
                if (strip && strip.scrollWidth > strip.clientWidth) {
                    const s = strip.getBoundingClientRect(), b = btnEl.getBoundingClientRect();
                    if (b.left < s.left || b.right > s.right) {
                        strip.scrollTo({ left: strip.scrollLeft + (b.left - s.left) - 12, behavior: 'smooth' });
                    }
                }
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:switchTab'); }
        }
        function toggleMenu() { document.getElementById('side-menu').classList.toggle('open'); } function toggleHudElements() { document.getElementById('info').style.display = document.getElementById('tgl-info').checked ? 'block' : 'none'; document.getElementById('compass-debug').style.display = document.getElementById('tgl-compass').checked ? 'block' : 'none'; updateGpsAvgPanel(); }
        function fixAppLayout() { setTimeout(() => { window.scrollTo(0, 0); document.body.scrollTop = 0; }, 100); } document.querySelectorAll('input').forEach(input => { input.addEventListener('blur', fixAppLayout); });
        
        // DRONOVÉ ZÓNY: oficiální mapa omezení letového provozu ŘLP ČR (DronView).
        // Info pro létání s dronem na zakázce — otevírá se v prohlížeči (data ŘLP nejde vkládat do mapy).
        function openDronView() { window.open('https://dronview.rlp.cz/', '_blank'); }
        function openKatastr() {
            if(!userLat || !userLng) return agInfo("Čekám na GPS pozici..."); 
            let src = visSettings.katastrSource || 'mapycz';
            let url = `https://mapy.cz/katastralni?x=${userLng}&y=${userLat}&z=19`;
            if (src === 'ikatastr') url = `https://www.ikatastr.cz/ikatastr.htm#zoom=19&lat=${userLat}&lon=${userLng}`;
            else if (src === 'cuzk') url = `https://geoportal.cuzk.cz/geoprohlizec/?lon=${userLng}&lat=${userLat}&zoom=14`;
            window.open(url, '_blank'); 
        }

        // Kompas je SAMOSTATNÝ modál (#compass-modal) — klik na Azimut v HUD ani dlaždice
        // v Nastavení už neskáčou do záložek Nastavení (na přání uživatele).
        function openCompassModal() {
            const m = document.getElementById('compass-modal'); if (!m) return;
            m.style.display = 'flex';
            updateCompassButtons(); updateHeadingOffsetVal();
        }
        // zpětná kompatibilita pro starší volání
        function showCompassTab() { openCompassModal(); }
        function openGpsAvgModal() { const m = document.getElementById('gpsavg-modal'); if (!m) return; m.style.display = 'flex'; updateGpsAvgPanel(); }
        // Korekce severu pro AR i mapu (na rozdil od "uzivatelske nuly", ktera meni jen zobrazene cislo azimutu).
        function updateHeadingOffsetVal() { const el = document.getElementById('heading-offset-val'); if (el) { let v = ((userHeadingOffset + 180) % 360 + 360) % 360 - 180; el.innerText = Math.round(v); } }
        function nudgeHeadingOffset(d) { userHeadingOffset = ((userHeadingOffset + d) % 360 + 360) % 360; setStoredData('arHeadingOffset', String(userHeadingOffset)); updateHeadingOffsetVal(); }
        function resetHeadingOffset() { userHeadingOffset = 0; headingCorrection = 0; setStoredData('arHeadingOffset', '0'); updateHeadingOffsetVal(); }
        function setCompassZero() { compassZeroOffset = currentHeading; agInfo("Nula nastavena na aktuální směr."); } function resetCompassZero() { compassZeroOffset = 0; agInfo("Nula zrušena."); } function setCompassUnit(u) { compassUnit = u; updateCompassButtons(); }
        function updateCompassButtons() { document.getElementById('btn-unit-deg').style.background = compassUnit === 'deg' ? 'var(--accent)' : '#555'; document.getElementById('btn-unit-deg').style.color = compassUnit === 'deg' ? '#000' : '#fff'; document.getElementById('btn-unit-gon').style.background = compassUnit === 'gon' ? 'var(--accent)' : '#555'; document.getElementById('btn-unit-gon').style.color = compassUnit === 'gon' ? '#000' : '#fff'; }

        const APP_VERSION = '1.9';
        function openAbout() { const v = document.getElementById('about-version'); if (v) v.innerText = APP_VERSION; document.getElementById('about-modal').style.display = 'flex'; }
        let _calibActive = false, _calibSeen = null, _calibBeta = null, _calibGamma = null;
        function dismissCompassCalib() { _calibActive = false; try { localStorage.setItem('arCompassCalibShown', '1'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:dismissCompassCalib'); } const m = document.getElementById('compass-calib-modal'); if (m) m.style.display = 'none'; }
        // Onboarding kalibrace kompasu: jednorazove pri prvnim startu AR; force=true znovu z nastaveni kompasu.
        function showCompassCalibHint(force) { try { if (!force && localStorage.getItem('arCompassCalibShown')) return; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:showCompassCalibHint'); } try { if (!force && localStorage.getItem('arTutorialSeen_v1') !== '1') return; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:showCompassCalibHint'); } /* na 1. startu nejdriv tutorial; kalibraci spusti tutorial-pro.js po dokonceni */ const m = document.getElementById('compass-calib-modal'); if (m) { m.style.display = 'flex'; _calibActive = true; _calibSeen = new Set(); _calibBeta = { min: Infinity, max: -Infinity }; _calibGamma = { min: Infinity, max: -Infinity }; const _b = document.getElementById('calib-progress'); if (_b) _b.style.width = '0%'; const _t = document.getElementById('calib-progress-txt'); if (_t) _t.innerText = '0 %'; } }
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

        async function loadCameras() { const btn = document.getElementById('camera-load-btn'); btn.innerText = "Načítám..."; try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); const devices = await navigator.mediaDevices.enumerateDevices(); const videoDevices = devices.filter(d => d.kind === 'videoinput'); const wSelect = document.getElementById('w-camera-select'); const sSelect = document.getElementById('s-camera-select'); wSelect.innerHTML = '<option value="">Výchozí zadní kamera</option>'; sSelect.innerHTML = '<option value="">Výchozí zadní kamera</option>'; videoDevices.forEach(cam => { if (!cam.label.toLowerCase().includes('front') && !cam.label.toLowerCase().includes('přední')) { const labelText = cam.label || `Kamera ${wSelect.options.length}`; const opt1 = document.createElement('option'); opt1.value = cam.deviceId; opt1.text = labelText; wSelect.appendChild(opt1); const opt2 = document.createElement('option'); opt2.value = cam.deviceId; opt2.text = labelText; sSelect.appendChild(opt2); } }); stream.getTracks().forEach(t => t.stop()); btn.style.display = 'none'; wSelect.style.display = 'block'; } catch(e) { agInfo("Nepodařilo se načíst seznam kamer."); btn.innerHTML = '<svg class="icon"><use href="#i-camera"/></svg> Zkusit znovu načíst kamery'; } }

        function updateInfoPanel() { const infoEl = document.getElementById('info'); if (!infoEl || !appStarted) return; if (!userLat) { infoEl.innerHTML = `<div class="rdt"><span class="rdt-l">GPS</span><span class="rdt-v" style="color:var(--warning);">hledám…</span></div>`; return; } infoEl.innerHTML = ''; }

        // BATERIE: zapamatovat posledni rezim zobrazeni. Vychozi „Dělené" znamena zivou kameru
        // A mapu naraz — nejdrazsi kombinaci, jakou appka umi. Kdo pracuje celý den v mapě, ten
        // si ji drive musel prepinat po KAZDEM startu, protoze se stav resetoval zpatky na
        // „Dělené". Uklada se mimo zakazky (jako agPowerCfg) — je to volba zarizeni, ne projektu.
        const VIEW_LS = 'agViewMode';
        function rememberViewMode(v) { try { if (v === 'both' || v === 'map' || v === 'ar') localStorage.setItem(VIEW_LS, v); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:rememberViewMode'); } }
        window.agRememberViewMode = rememberViewMode;
        // VSTUP DO APPKY. Nejcitlivejsi funkce v celem projektu: kdyz spadne, uzivatel
        // zustane koukat na uvodni obrazovku a nema jak dal — v terenu je to konec prace.
        // Drive to byl retez 24 nechranenych pristupu do DOM. Ted je cteni formulare
        // (ktere si vzdy vystaci se zaloznimi hodnotami) oddelene od vlastniho SPUSTENI:
        // spusteni je ve `finally`, takze appka nabehne, i kdyby cteni formulare selhalo.
        function startAppFromWelcome() {
            try {
                mapRadius = _agInt('w-map-radius-slider', mapRadius);
                arRadius = _agInt('w-ar-radius-slider', arRadius);
                filters.tb = _agChk('w-f-tb', filters.tb); filters.zhb = _agChk('w-f-zhb', filters.zhb); filters.pbpp = _agChk('w-f-pbpp', filters.pbpp); filters.nivel = _agChk('w-f-nivel', filters.nivel); filters.custom = _agChk('w-f-custom', filters.custom);
                searchQuery = String(_agStr('w-search-name', searchQuery) || '').trim();
                const viewRadios = document.getElementsByName('w-view'); for (let r of viewRadios) { if (r.checked) viewMode = r.value; } rememberViewMode(viewMode);
                _agSet('s-map-radius-slider', 'value', mapRadius); _agSet('s-map-radius-val', 'innerText', mapRadius);
                _agSet('s-ar-radius-slider', 'value', arRadius); _agSet('s-ar-radius-val', 'innerText', arRadius);
                _agSet('f-tb', 'checked', filters.tb); _agSet('f-zhb', 'checked', filters.zhb); _agSet('f-pbpp', 'checked', filters.pbpp); _agSet('f-nivel', 'checked', filters.nivel); _agSet('f-custom', 'checked', filters.custom);
                _agSet('s-search-name', 'value', searchQuery);
                _agSet('s-camera-select', 'value', _agStr('w-camera-select', ''));
                const sViewRadios = document.getElementsByName('s-view'); for (let r of sViewRadios) { if (r.value === viewMode) r.checked = true; }
            } catch (e) {
                console.warn('[start] formular uvodni obrazovky:', e);
                try { if (window.agErrLog) agErrLog.record('startAppFromWelcome: ' + (e && e.message || e)); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'grafika:startAppFromWelcome'); }
            } finally {
                // OD TETO CHVILE MUSI APPKA NABEHNOUT — at se nahore stalo cokoli
                { const _mb = document.getElementById('menu-toggle-btn'); if (_mb) _mb.style.display = 'block'; }
                appStarted = true;
                document.body.classList.add('app-started');
                // Moduly, ktere na start appky cekaly pollem 2x/s (brifink, draft-store,
                // epochy-pripominky), si ted rikaji o tuhle udalost. Kdo se nacte az po
                // startu, pozna to z tridy vyse - proto obojí.
                try { window.dispatchEvent(new CustomEvent('ag:app-started')); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:startAppFromWelcome'); }
                try { toggleHudElements(); } catch (e) { console.warn('[start] HUD:', e); }
                { const _ws = document.getElementById('welcome-screen'); if (_ws) { _ws.style.opacity = '0'; setTimeout(() => { _ws.style.display = 'none'; }, 400); } }
                try { applyViewMode(); } catch (e) { console.warn('[start] rezim zobrazeni:', e); }
                try { drawAllMarkersOnMap(); } catch (e) { console.warn('[start] markery:', e); }
                try {
                    if (userLat && userLng) initFetch(userLat, userLng);
                    else { const _i = document.getElementById('info'); if (_i) _i.innerHTML = "Hledám GPS signál..."; }
                } catch (e) { console.warn('[start] data:', e); }
                try { requestWakeLock(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:startAppFromWelcome'); }
            }
        }

        function applyViewMode() { // BATERIE: trida rika CSS, ze pod prekryvy tece ZIVY obraz z kamery
            // (30 snimku/s). Skleneny efekt (backdrop-filter) nad statickou mapou se prepocita
            // jen pri posunu mapy, ale nad videem pri KAZDEM snimku — a takovych prvku je nad
            // kamerou ~10 (#info, #compass-debug, #menu-toggle-btn, #gps-avg, 5x .dock-btn,
            // #ar-hud-info). Viz pravidlo `body.cam-live:not(.ag-cam-glass)` v css/style.css.
            try { document.body.classList.toggle('cam-live', viewMode !== 'map'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:applyViewMode'); }
            const camCont = document.getElementById('camera-container'); const mapCont = document.getElementById('map-container'); const resizer = document.getElementById('resizer'); if (viewMode === 'both') { camCont.style.display = 'block'; applySplit(splitStored(), false); mapCont.style.display = 'block'; mapCont.style.flex = '1'; resizer.style.display = 'flex'; startCameraAndCompass(); } else if (viewMode === 'map') { camCont.style.display = 'none'; mapCont.style.display = 'block'; mapCont.style.flex = '1'; resizer.style.display = 'none'; stopCameraStream(); startCompass(); } else if (viewMode === 'ar') { camCont.style.display = 'block'; camCont.style.flex = '1'; mapCont.style.display = 'none'; resizer.style.display = 'none'; startCameraAndCompass(); } setTimeout(() => { map.invalidateSize(); }, 300); }

        let compassStarted = false;
        // BATERIE: přišla použitelná ABSOLUTNÍ událost kompasu? Nastavuje handleOrientation.
        // Nezávisle na GPS fixu (renderAR se bez fixu vrací dřív, než by se to dalo poznat).
        let _absSeen = false;
        // iOS dovolí requestPermission() jen uvnitř gesta uživatele. Mimo gesto (auto-start
        // přes „Pokračovat", obnova kamery po návratu) promise spadne — pak počkáme na
        // příští ťuknutí kamkoliv a zkusíme to znovu, ať kompas nezůstane mrtvý.
        function startCompass() {
            if (compassStarted) return; compassStarted = true; showCompassCalibHint();
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission().then(permission => {
                    if (permission === 'granted') window.addEventListener('deviceorientation', handleOrientation);
                }).catch(() => {
                    compassStarted = false;
                    const retry = () => { document.removeEventListener('click', retry, true); startCompass(); };
                    document.addEventListener('click', retry, true);
                });
            } else {
                // BATERIE: Chrome na Androidu doručuje 'deviceorientationabsolute' I
                // 'deviceorientation', obě ~60x/s — se stejným handlerem tedy handleOrientation
                // běžel 2x na snímek (renderAR sice druhý zahodí přes _orientPending, ale
                // doručení události, handler i trackCalibMotion se odbydou dvakrát).
                // Navěsíme proto JEN absolutní — pro sever je to ta správná — a relativní
                // doregistrujeme teprve když do 1,2 s nepřijde POUŽITELNÁ absolutní událost
                // (prohlížeč ji nezná, nebo chodí bez alpha). Chování na takových zařízeních
                // je pak úplně stejné jako dřív, jen o 1,2 s později.
                window.addEventListener('deviceorientationabsolute', handleOrientation);
                setTimeout(function () {
                    if (!_absSeen) window.addEventListener('deviceorientation', handleOrientation);
                }, 1200);
            }
        }
        // BATERIE: bez techhle mezi si prohlizec vezme NATIVNI rozliseni kamery — na dnesnich
        // telefonech bezne 1920x1080, na nekterych i 4K, a to 30x za sekundu. Obraz z kamery je
        // v AR jen podklad pod znackami a zobrazuje se do poloviny displeje (~390 CSS px na
        // sirku), takze se stejne zmensuje. Senzor, ISP i GPU kompozice tak celou dobu delaji
        // nekolikanasobek prace, kterou je videt. 720p @ 24-30 fps je na telefonu k nerozeznani.
        // `ideal` (ne `exact`) = kdyz kamera takovy rezim nema, vybere nejblizsi a NEselze.
        // Kdyby nekdo chtel puvodni chovani, staci CAM_VIDEO vyprazdnit na {}.
        const CAM_VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } };
        function startCameraAndCompass(forceRestart = false) { startCompass(); if (cameraStarted && !forceRestart) return; cameraStarted = true; if (currentVideoStream) { currentVideoStream.getTracks().forEach(track => track.stop()); } const camId = document.getElementById('s-camera-select') ? document.getElementById('s-camera-select').value : null; const videoConstraints = Object.assign({}, CAM_VIDEO, camId ? { deviceId: { exact: camId } } : { facingMode: "environment" }); navigator.mediaDevices.getUserMedia({ video: videoConstraints }).then(stream => { currentVideoStream = stream; const videoElement = document.getElementById('camera-feed'); videoElement.srcObject = stream; videoElement.style.display = "block"; }).catch(err => { handleCameraError(err); }); }
        // Kamera selhala (typicky omylem zamítnuté oprávnění): místo surového alertu s technickou
        // hláškou řekni co dělat a přepni do Mapy, ať se dá pracovat dál (AR bez kamery = černá obrazovka).
        function handleCameraError(err) {
            cameraStarted = false;
            const name = (err && err.name) || '';
            const denied = name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError';
            const busy = name === 'NotReadableError' || name === 'AbortError';
            let msg;
            if (denied) msg = 'Aplikace nemá povolený přístup ke kameře, takže AR nejde spustit.<br><br><b>Jak kameru povolit:</b><br>• iPhone: Nastavení → aplikace <b>AR Geodet</b> (příp. Safari) → Kamera → Povolit.<br>• Android / Chrome: ikona zámku v adresním řádku → Oprávnění → Kamera.<br><br>Zatím je zapnutý režim <b>Mapa</b> — vše kromě AR funguje dál.';
            else if (busy) msg = 'Kameru právě drží jiná aplikace nebo ji systém nedokázal spustit. Zavři ostatní aplikace s kamerou a zkus to znovu.<br><br>Zatím je zapnutý režim <b>Mapa</b>.';
            else msg = 'Kameru se nepodařilo spustit (' + ((err && (err.message || err.name)) || 'neznámá chyba') + ').<br><br>Zatím je zapnutý režim <b>Mapa</b> — AR zkusíš znovu přepnutím zobrazení.';
            if (typeof viewMode !== 'undefined' && viewMode !== 'map') { viewMode = 'map'; applyViewMode(); try { if (typeof window.agSyncViewControls === 'function') window.agSyncViewControls(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:handleCameraError'); } }
            if (window.agAlert) window.agAlert({ title: 'Kamera nejde spustit', message: msg });
            else agInfo(msg.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
        }
        // Uspani kamery (uspora baterie / rezim mapy): zastavi stopu a vynuluje stav, aby sla znovu nahodit.
        function stopCameraStream() { try { if (currentVideoStream) { currentVideoStream.getTracks().forEach(t => { try { t.stop(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:stopCameraStream'); } }); } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:stopCameraStream'); } currentVideoStream = null; cameraStarted = false; const v = document.getElementById('camera-feed'); if (v) { try { v.srcObject = null; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:stopCameraStream'); } } }

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

        // HLÍDAČ KAMERY: na iOS celoobrazovkový (neprůhledný) překryv nástroje občas
        // „zamrazí" dekodér kamery a po zavření zůstane AR zaseklé (play() to nespraví).
        // Když je AR aktivní a žádný překryv nepřekrývá, ale obraz se ~3 s nehýbe,
        // restartujeme stream. Bezpečné vůči power-save (pauza/null/ended → přeskočíme).
        // Překryv přes AR — SDÍLENÝ test (hlídač kamery i watchdog renderu níže). Výsledek
        // se na 200 ms cachuje a místo getComputedStyle (vynucený style flush) se ptáme
        // getClientRects(), což je levnější a na display:none vrací prázdno.
        let _ovLastT = 0, _ovVal = false;
        function anyOverlayOpen() {
            const t = performance.now();
            if (t - _ovLastT < 200) return _ovVal;
            _ovLastT = t; _ovVal = false;
            const mods = document.querySelectorAll('.dmt-overlay, .omr-overlay, #ag-bgps-overlay, #ag-lvl-overlay, .qc-gate-ov, #cad-sel-overlay');
            for (let i = 0; i < mods.length; i++) { if (mods[i].getClientRects().length) { _ovVal = true; return true; } }
            const mo = document.querySelectorAll('.modal-overlay');
            for (let j = 0; j < mo.length; j++) { if (mo[j].style.display === 'flex') { _ovVal = true; return true; } }
            return _ovVal;
        }
        (function () {
            let lastT = -1, stall = 0;
            setInterval(function () {
                try {
                    if (!appStarted || viewMode === 'map' || document.visibilityState !== 'visible') { stall = 0; lastT = -1; return; }
                    if (anyOverlayOpen()) { stall = 0; lastT = -1; return; }
                    const v = document.getElementById('camera-feed');
                    if (!v || v.paused || v.readyState < 2 || !currentVideoStream) { stall = 0; return; }
                    const tr = currentVideoStream.getVideoTracks ? currentVideoStream.getVideoTracks()[0] : null;
                    if (!tr || tr.readyState !== 'live') return; // mrtvou stopu řeší jiné cesty
                    const t = v.currentTime;
                    if (t === lastT) { if (++stall >= 3) { ensureCameraAlive(true); stall = 0; lastT = -1; } }
                    else { stall = 0; lastT = t; }
                } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:anyOverlayOpen'); }
            }, 1000);
        })();

        // =====================================================================
        // DELIC KAMERA / MAPA — "chytry delic" (navrh S1, vybran 8. 8. 2026)
        //
        // Co bylo spatne na puvodni verzi (ctyri veci, vsechny overene ctenim kodu):
        //   1) POMER SE NEPAMATOVAL — kazde spusteni zase 50/50. Ted se uklada
        //      per ZAKAZKU (pokladka chce jiny pomer nez katastr).
        //   2) NEBYL STROP ANI DNO — slo pretahnout tak, ze mapa nebo kamera
        //      uplne zmizela a nebylo poznat, jak zpatky. Ted 15–85 %.
        //   3) SKOK PRI CHYCENI — puvodni touchmove bral clientY jako novou
        //      hranici, takze delic pri dotyku poskocil pod prst. Ted se pocita
        //      ODCHYLKA od mista chyceni (pct0 + dy), takze zustane pod prstem.
        //   4) MAPA SE BEHEM TAZENI NEPREPOCITAVALA — invalidateSize() se volal
        //      jen po dvojklepu, takze dlazdice byly cely tah roztazene. Ted se
        //      prepocitava v RAF behem tazeni.
        // Navic: zarazky na 25/50/75 % s kratkym cuknutim, zive procento jen po
        // dobu tazeni a obsluha MYSI (CSS uz row-resize kurzor slibovalo, ale
        // zadny mouse/pointer handler neexistoval — na pocitaci to neslo vubec).
        //
        // Dvojklep zustava jako zkratka: prehodi mezi ulozenym pomerem a 85 %.
        // =====================================================================
        const resizer = document.getElementById('resizer');
        const camCont = document.getElementById('camera-container');
        const SPLIT_KEY = 'arSplitRatio';      // % vysky KAMERY; per zakazka (getStoreKey)
        const SPLIT_MIN = 15, SPLIT_MAX = 85;  // ani jeden pruh nesmi zmizet uplne
        const SPLIT_SNAPS = [25, 50, 75];      // zarazky
        const SPLIT_TOL = 2.2;                 // jak blizko k zarazce uz chytne (v %)
        let splitPct = 50;
        let _splitDrag = null, _splitRaf = 0, _splitPre = null;

        function splitClamp(p) { return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, p)); }
        // Ulozeny pomer zakazky. Nesmyslne/chybejici hodnoty spadnou na 50 %.
        function splitStored() {
            try {
                const v = parseFloat(getStoredData(SPLIT_KEY));
                if (isFinite(v)) return splitClamp(v);
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:splitStored'); }
            return 50;
        }
        function applySplit(p, save) {
            splitPct = splitClamp(p);
            camCont.style.flex = `0 0 ${splitPct}%`;
            if (save) { try { setStoredData(SPLIT_KEY, String(Math.round(splitPct))); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:applySplit'); } }
        }
        // Leaflet musi o zmene vysky vedet, jinak zustanou dlazdice roztazene.
        // Skrceno na jedno volani za snimek — pri tazeni by to jinak bezelo
        // desitkykrat za sekundu a topilo baterii.
        function splitLiveSize() {
            if (_splitRaf) return;
            _splitRaf = requestAnimationFrame(() => {
                _splitRaf = 0;
                try { if (typeof map !== 'undefined' && map && map.invalidateSize) map.invalidateSize({ pan: false }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:splitLiveSize'); }
            });
        }
        // Zive procento + zarazky se ukazuji JEN pri tazeni (jinak by to byl
        // dalsi trvale svitici udaj na obrazovce, kterych uz je dost).
        let splitPctEl = null, splitSnapEl = null;
        function splitChrome() {
            if (splitPctEl) return;
            splitSnapEl = document.createElement('span');
            splitSnapEl.className = 'rz-snap';
            splitSnapEl.setAttribute('aria-hidden', 'true');
            splitSnapEl.innerHTML = SPLIT_SNAPS.map(() => '<s></s>').join('');
            splitPctEl = document.createElement('span');
            splitPctEl.className = 'rz-pct';
            splitPctEl.setAttribute('aria-hidden', 'true');
            resizer.appendChild(splitSnapEl);
            resizer.appendChild(splitPctEl);
        }
        function splitShowPct(snapped) {
            splitChrome();
            // Na zarazce se to rekne SLOVEM, ne jen rozsvicenou ryskou vlevo: na uzke
            // svetelne hrane (navrh D4) je prouzek s ryskami u jednoho kraje a cislo u druheho,
            // takze spojit si je pohledem behem tazeni nejde.
            splitPctEl.textContent = `AR ${Math.round(splitPct)} % · MAPA ${100 - Math.round(splitPct)} %`
                + (snapped !== null ? ' · ZARÁŽKA' : '');
            splitPctEl.classList.toggle('snapped', snapped !== null);
            const ss = splitSnapEl.children;
            for (let i = 0; i < ss.length; i++) ss[i].classList.toggle('on', SPLIT_SNAPS[i] === snapped);
        }

        resizer.addEventListener('pointerdown', (e) => {
            _splitDrag = { id: e.pointerId, y0: e.clientY, pct0: splitPct, moved: false, snap: null };
            try { resizer.setPointerCapture(e.pointerId); } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'grafika:splitShowPct'); }
            camCont.style.transition = 'none';
            resizer.classList.add('rz-drag');
            splitShowPct(null);
            e.preventDefault();
        });
        resizer.addEventListener('pointermove', (e) => {
            if (!_splitDrag || e.pointerId !== _splitDrag.id) return;
            const dy = e.clientY - _splitDrag.y0;
            if (Math.abs(dy) > 3) _splitDrag.moved = true;
            let p = splitClamp(_splitDrag.pct0 + (dy / window.innerHeight) * 100);
            let snap = null;
            for (let i = 0; i < SPLIT_SNAPS.length; i++) {
                if (Math.abs(p - SPLIT_SNAPS[i]) <= SPLIT_TOL) { p = SPLIT_SNAPS[i]; snap = SPLIT_SNAPS[i]; break; }
            }
            // cuknuti jen pri VSTUPU do zarazky, ne po celou dobu, co v ni stojim
            if (snap !== _splitDrag.snap) { _splitDrag.snap = snap; if (snap !== null) { try { agVibe(10); } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'grafika:splitShowPct'); } } }
            applySplit(p, false);
            splitShowPct(snap);
            splitLiveSize();
        });
        function splitEnd(e) {
            if (!_splitDrag || (e && e.pointerId !== _splitDrag.id)) return;
            const moved = _splitDrag.moved;
            _splitDrag = null;
            resizer.classList.remove('rz-drag');
            if (moved) {
                applySplit(splitPct, true);
                _splitPre = null;               // rucni tah rusi rozdelanou "zvetsenou kameru"
            } else {
                // DVOJKLEP: prepnuti mezi ulozenym pomerem a 85 % kamery
                const now = Date.now();
                if (now - splitEnd._t < 300) {
                    camCont.style.transition = 'flex 0.28s ease';
                    if (_splitPre != null) { applySplit(_splitPre, true); _splitPre = null; }
                    else { _splitPre = splitPct; applySplit(85, false); }
                    setTimeout(() => { camCont.style.transition = 'none'; splitLiveSize(); }, 300);
                }
                splitEnd._t = now;
            }
            splitLiveSize();
        }
        splitEnd._t = 0;
        resizer.addEventListener('pointerup', splitEnd);
        resizer.addEventListener('pointercancel', splitEnd);
        // Klavesnice (a cteni obrazovky): sipky posouvaji po 2 %, Home/End na kraje.
        resizer.setAttribute('tabindex', '0');
        resizer.setAttribute('role', 'separator');
        resizer.setAttribute('aria-label', 'Poměr kamery a mapy');
        resizer.addEventListener('keydown', (e) => {
            let p = null;
            if (e.key === 'ArrowUp') p = splitPct - 2;
            else if (e.key === 'ArrowDown') p = splitPct + 2;
            else if (e.key === 'Home') p = SPLIT_MIN;
            else if (e.key === 'End') p = SPLIT_MAX;
            if (p == null) return;
            e.preventDefault();
            applySplit(p, true); splitShowPct(null); splitLiveSize();
        });

        // ===== BODY Z HODINEK GARMIN ==============================================
        // Hodinky posilaji naměřené body přes Worker do TÉŽE tabulky sync_points jako
        // mobil, takže do aplikace dorazí jako obyčejné vlastní body. Razítko dává
        // cloud/worker.js (`prov.src = 'garmin'`) a je jediné, podle čeho se poznají.
        //
        // PROC JE ODLISUJEME: hodinky nedávají střední chybu, jen rozptyl vlastních
        // vzorků — reálně jednotky metrů (viz garmin/hodinky/README.md). Na nalezení
        // bodu to stačí, na vytyčení ne, a smíchat je s pořádně změřenými by znamenalo
        // ztratit tu informaci. Kreslí se proto RUZOVE (vlastní jsou zelené) a v seznamu
        // bodů je na ně vlastní přepínač.
        const AG_WATCH_COL = '#f472b6';
        function agZHodinek(pt) { return !!(pt && pt.prov && pt.prov.src === 'garmin'); }
        window.agZHodinek = agZHodinek;
        // Barva znacky bodu. Kategorie si barvu bere z Nastavení (visSettings), body
        // z hodinek maji pevnou — je to původ, ne kategorie, a nemá se s čím prát.
        function agBarvaBodu(pt) {
            if (agZHodinek(pt)) return AG_WATCH_COL;
            if (pt.cat === 'ZHB') return visSettings.colZhb;
            if (pt.cat === 'PBPP') return visSettings.colPbpp;
            if (pt.cat === 'NIVEL') return visSettings.colNivel;
            if (pt.cat === 'CUSTOM') return visSettings.colCustom;
            return visSettings.colTb;
        }

        function getMapMarkerSVG(category, color) { if(category === 'TB') return `<svg viewBox="0 0 24 24"><polygon points="12,2 22,20 2,20" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; if(category === 'ZHB') return `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; if(category === 'PBPP') return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; if(category === 'NIVEL') return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="3"/><circle cx="12" cy="12" r="3" fill="${color}"/></svg>`; if(category === 'CUSTOM') return `<svg viewBox="0 0 24 24"><path d="M12,2 C7,2 3,6 3,11 C3,18 12,22 12,22 C12,22 21,18 21,11 C21,6 17,2 12,2 Z" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`; return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="${color}"/></svg>`; }

        // ===== OREZ MARKERU NA VYREZ MAPY =========================================
        // Po stazeni bodoveho pole z CUZK jsou v mape stovky bodu a KAZDY je jeden
        // divIcon (DOM uzel). drawAllMarkersOnMap() se pritom vola pri kazdem ulozeni
        // bodu, zmene filtru, importu… — stavet pokazde i bod kilometr za obzorem je
        // zbytecne. Kreslime tedy jen to, co muze byt videt.
        //
        // PROC JE TO BEZPECNE I PRI OTOCENE MAPE: rotaci resi predimenzovany
        // #map-wrapper (150vmax x 150vmax, viz css/style.css) — Leaflet pocita s
        // plochou vyrazne vetsi nez viditelna vysec, takze map.getBounds() uz je
        // "vsechno, co jde pri libovolnem otoceni videt".
        //
        // Kreslime s velkou rezervou (+100 % na kazdou stranu) a prekreslujeme, teprve
        // az se uzivatel priblizi k jejimu okraji (+25 %) — bezna chuze ani posun po
        // mape tedy prekresleni nespousti.
        const _MAP_DRAW_PAD = 1.0;
        const _MAP_KEEP_PAD = 0.25;
        let _mapDrawnBounds = null;
        function _mapPadBounds(pad) {
            try { const b = map.getBounds(); return (b && b.isValid()) ? b.pad(pad) : null; } catch (e) { return null; }
        }

        function drawAllMarkersOnMap() {
            if (_mngSuspendRedraw) return;   // hromadna davka prekresli mapu az na konci
            markersGroup.clearLayers();
            _mapDrawnBounds = _mapPadBounds(_MAP_DRAW_PAD);
            arPoints.forEach(pt => {
                if (_mapDrawnBounds && !_mapDrawnBounds.contains([pt.lat, pt.lng])) return;
                if (pt.hidden) return; if (pt.cat === 'TB' && !filters.tb) return; if (pt.cat === 'ZHB' && !filters.zhb) return; if (pt.cat === 'PBPP' && !filters.pbpp) return; if (pt.cat === 'NIVEL' && !filters.nivel) return; if (pt.cat === 'CUSTOM' && !filters.custom) return; if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) return;
                let col = agBarvaBodu(pt);
                const stakedBadge = (window.isStaked && isStaked(pt.id)) ? `<div style="position:absolute; top:-7px; right:-7px; width:13px; height:13px; border-radius:50%; background:#10b981; border:1.5px solid #fff; display:flex; align-items:center; justify-content:center;"><svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>` : '';
                const svgIcon = getMapMarkerSVG(pt.cat, col); const htmlContent = `<div style="position: relative; width: 24px; height: 24px; pointer-events:none;${stakedBadge ? ' opacity:0.65;' : ''}">${svgIcon}${stakedBadge}<div class="map-label-text" style="transform: rotate(${mapRotation}deg);">${_escHtml(pt.name)}</div></div>`;
                const icon = L.divIcon({ className: 'custom-map-marker', html: htmlContent, iconSize: [24, 24], iconAnchor: [12, 12] });
                L.marker([pt.lat, pt.lng], { icon: icon }).addTo(markersGroup);
            });
            drawAllLinesOnMap();
        }

        // Odjel uzivatel mimo vykreslenou plochu? Dokreslit zbytek.
        // (Bez teto pojistky by orez vyse znamenal "body za okrajem uz se neukazou" —
        // presne ta trida chyby, kterou nikdo v terenu nechce hledat.)
        let _mapCullTimer = null;
        function _mapCullCheck() {
            if (!appStarted) return;
            const need = _mapPadBounds(_MAP_KEEP_PAD);
            if (!need) return;
            if (_mapDrawnBounds && _mapDrawnBounds.contains(need)) return;
            drawAllMarkersOnMap();
        }
        map.on('moveend zoomend', () => { clearTimeout(_mapCullTimer); _mapCullTimer = setTimeout(_mapCullCheck, 200); });

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
        // Sdílený převod BOD NA OBRAZOVCE (clientX/Y) -> LatLng, se zohledněním otočení
        // mapy kolem polohy uživatele. Stejná matematika jako getMapClickLatLng, ale z
        // holých px/py — používá ji „Import oblasti z katastru" (cadastre-area.js), aby
        // měl PŘESNĚ stejný (ověřený) převod jako kliknutí do mapy.
        window.agScreenToLatLng = function (px, py) {
            try {
                if (px == null || py == null || typeof map === 'undefined' || !map) return null;
                const userEl = document.getElementById('user-direction-container');
                let Px, Py, P;
                if (userEl && userLat != null) { const ur = userEl.getBoundingClientRect(); Px = ur.left + ur.width / 2; Py = ur.top + ur.height / 2; P = map.latLngToContainerPoint([userLat, userLng]); }
                else { const rect = document.getElementById('map').getBoundingClientRect(); Px = rect.left + rect.width / 2; Py = rect.top + rect.height / 2; const sz = map.getSize(); P = L.point(sz.x / 2, sz.y / 2); }
                const rad = mapRotation * Math.PI / 180; const dx = px - Px, dy = py - Py;
                const lx = dx * Math.cos(rad) - dy * Math.sin(rad); const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
                return map.containerPointToLatLng(L.point(P.x + lx, P.y + ly));
            } catch (e) { return null; }
        };
        map.on('click', (e) => {
            if (!appStarted) return; const clickLatLng = getMapClickLatLng(e);
            if (mapAddMode) { mapAddMode = false; const _h = document.getElementById('map-pick-hint'); if (_h) _h.style.display = 'none'; openNewPointFromMap(clickLatLng.lat, clickLatLng.lng); return; }
            // POLOHA Z MAPY (js/poloha-z-mapy.js): sber MOJE polohy. Zoom se predava,
            // protoze z nej modul pocita poctivy odhad presnosti odectu — a `map` je
            // lexikalni globala logika.js, ke ktere se modul sam nedostane.
            // Bez modulu je podminka nepravdiva a vetev je nema.
            if (window.AGManualPos && window.AGManualPos.armed) { window.AGManualPos.take(clickLatLng.lat, clickLatLng.lng, map.getZoom()); return; }
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
            // Nabídka „Stáhnout okolí" na klik do prázdné mapy byla SCHOVÁNA (na přání uživatele).
            // Kód + návod na obnovu: _archiv/map-click-stahnout-oblast.md . Klik do prázdna teď nic nedělá.
        });

        function showClusterList(points) {
            const listDiv = document.getElementById('cluster-list'); listDiv.innerHTML = '';
            points.forEach(pt => {
                let typBodu = "Podrobný polohový bod"; if(pt.cat === 'TB') typBodu = "Trigonometrický bod"; if(pt.cat === 'ZHB') typBodu = "Zhušťovací bod"; if(pt.cat === 'NIVEL') typBodu = "Nivelační / Výškový bod"; if(pt.cat === 'CUSTOM') typBodu = "Vlastní bod";
                if (agZHodinek(pt)) typBodu = "Bod z hodinek";
                const dist = getDistance(userLat, userLng, pt.lat, pt.lng); const item = document.createElement('div'); item.className = 'cluster-list-item';
                let col = agBarvaBodu(pt);
                item.innerHTML = `<div><div class="cluster-item-title" style="color: ${col};">#${_escHtml(pt.name)}</div><div class="cluster-item-subtitle">${typBodu}</div></div><div style="font-weight: 600; font-size: calc(14px * var(--ag-font-scale, 1));">${dist.toFixed(1)} m</div>`;
                item.addEventListener('click', () => { document.getElementById('cluster-modal').style.display = 'none'; highlightPoint(pt); }); listDiv.appendChild(item);
            });
            document.getElementById('cluster-modal').style.display = 'flex';
        }

        // Seznam bodu v okoli serazeny podle vzdalenosti; klepnuti = navigace (highlightPoint)
        function openNearbyModal() { if (userLat == null) { agInfo("Čekám na GPS pozici..."); return; } renderNearbyList(); document.getElementById('nearby-modal').style.display = 'flex'; }
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
                if (agZHodinek(pt)) typBodu = "Bod z hodinek";
                let col = agBarvaBodu(pt);
                const item = document.createElement('div'); item.className = 'cluster-list-item';
                item.innerHTML = `<div><div class="cluster-item-title" style="color:${col};">#${_escHtml(pt.name)}</div><div class="cluster-item-subtitle">${typBodu}</div></div><div style="font-weight:600; font-size:calc(14px * var(--ag-font-scale, 1));">${d.toFixed(1)} m</div>`;
                item.addEventListener('click', () => { document.getElementById('nearby-modal').style.display = 'none'; highlightPoint(pt); });
                listDiv.appendChild(item);
            });
        }

        function openSettings() { document.getElementById('settings-modal').style.display = 'flex'; applyVisualSettings(); syncSettingsControls(); }

        // ===== Moderni ovladaci prvky Nastaveni (switch/segment/chips/slider) =====
        // Funkcni ID zustavaji; tyto funkce jen drzi vizual v souladu se stavem.
        function fillRange(el) {
            if (!el || el.type !== 'range') return;
            var min = parseFloat(el.min) || 0, max = parseFloat(el.max); if (!isFinite(max)) max = 100;
            var v = parseFloat(el.value); if (!isFinite(v)) v = min;
            var pct = max > min ? Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)) : 0;
            el.style.background = 'linear-gradient(90deg, var(--accent) ' + pct + '%, var(--surface-3) ' + pct + '%)';
        }
        function setModeSeg(m) {
            var sel = document.getElementById('v-mode'); if (sel) sel.value = m;
            if (typeof previewMode === 'function') previewMode(m);
            var seg = document.getElementById('seg-mode');
            if (seg) seg.querySelectorAll('.st-seg-b').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); });
        }
        function syncSettingsControls() {
            var sm = document.getElementById('settings-modal'); if (!sm) return;
            var sel = document.getElementById('v-mode'); var m = (sel && sel.value) ? sel.value : 'dark';
            var seg = document.getElementById('seg-mode');
            if (seg) seg.querySelectorAll('.st-seg-b').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); });
            if (typeof viewMode !== 'undefined') { var r = sm.querySelector('input[name="s-view"][value="' + viewMode + '"]'); if (r) r.checked = true; }
            sm.querySelectorAll('input[type="range"]').forEach(fillRange);
        }
        // Zive plneni jezdcu pri tazeni
        document.addEventListener('input', function (e) {
            if (e.target && e.target.matches && e.target.matches('#settings-modal input[type="range"]')) fillRange(e.target);
        });
        
        // Cte se pres _ag* pomocnky (viz nahore): chybejici policko si podrzi dosavadni
        // hodnotu misto toho, aby shodilo ulozeni vsech ostatnich. Zaverecna cast
        // (ulozeni + zavreni okna) je ve `finally`, takze se okno zavre i kdyby neco
        // v mezicase presto prasklo — uzivatel nikdy nezustane v panelu, ktery nereaguje.
        function saveSettings() {
            const oldCam = _agStr('w-camera-select', ''), newCam = _agStr('s-camera-select', '');
            try {
                mapRadius = _agInt('s-map-radius-slider', mapRadius); setStoredData('arRadiusMap', mapRadius);
                arRadius = _agInt('s-ar-radius-slider', arRadius); setStoredData('arRadiusAR', arRadius);
                searchQuery = String(_agStr('s-search-name', searchQuery) || '').trim();
                const sViewRadios = document.getElementsByName('s-view'); for (let r of sViewRadios) { if (r.checked) viewMode = r.value; } rememberViewMode(viewMode);
                _agSet('w-camera-select', 'value', newCam);
                visSettings.wakeLockEnabled = _agChk('s-wakelock', visSettings.wakeLockEnabled);
                { const _wasOut = visSettings.outdoorMode; visSettings.outdoorMode = _agChk('s-outdoor', visSettings.outdoorMode);
                  // rucni vypnuti = automatika ted mlci (znovu se nabije az po seru)
                  if (_wasOut && !visSettings.outdoorMode) { _aoAuto = false; _aoArmed = false; } }
                { var _ao = document.getElementById('s-auto-outdoor'); if (_ao) visSettings.autoOutdoor = _ao.checked; }
                { var _fs2 = document.getElementById('v-font-scale'); if (_fs2) visSettings.fontScale = _agInt('v-font-scale', 100) / 100; }
                { var _lh = document.getElementById('s-lefthand'); if (_lh) visSettings.leftHand = _lh.checked; }
                { var _vb = document.getElementById('s-vibration'); if (_vb) visSettings.vibrationEnabled = _vb.checked; }
                { var _an3 = document.getElementById('s-anim'); if (_an3) visSettings.anim = _an3.value; }
                { var _da = document.getElementById('v-dock-arc'); if (_da) visSettings.dockArc = _agInt('v-dock-arc', visSettings.dockArc); }
                visSettings.katastrSource = _agStr('s-katastr-source', visSettings.katastrSource);
                visSettings.maxARPoints = _agInt('s-max-ar-slider', visSettings.maxARPoints);
                visSettings.arVerticalOffset = _agInt('v-ar-height-slider', visSettings.arVerticalOffset);
                visSettings.markerScale = _agInt('v-marker-scale', Math.round(visSettings.markerScale * 100)) / 100; visSettings.markerOpacity = _agInt('v-marker-opacity', visSettings.markerOpacity);
                visSettings.colTb = _agStr('col-tb', visSettings.colTb); visSettings.colZhb = _agStr('col-zhb', visSettings.colZhb); visSettings.colPbpp = _agStr('col-pbpp', visSettings.colPbpp); visSettings.colNivel = _agStr('col-nivel', visSettings.colNivel); visSettings.colCustom = _agStr('col-custom', visSettings.colCustom);
                visSettings.arrowScale = _agInt('v-arrow-scale', Math.round(visSettings.arrowScale * 100)) / 100; visSettings.arrowOpacity = _agInt('v-arrow-opacity', visSettings.arrowOpacity); visSettings.arrowShape = _agStr('v-arrow-shape', visSettings.arrowShape); visSettings.colArrow = _agStr('col-arrow', visSettings.colArrow);
                visSettings.panelOpacity = _agInt('v-panel-opacity', visSettings.panelOpacity); /* menuScale: jezdec odstraněn (mrtvá volba) */
                visSettings.autoCompassCorrection = _agChk('s-auto-compass', visSettings.autoCompassCorrection); visSettings.tiltCompensation = _agChk('s-tilt-comp', visSettings.tiltCompensation !== false); visSettings.headingSmoothing = _agInt('s-heading-smooth', visSettings.headingSmoothing); visSettings.fovH = _agInt('s-fovh', visSettings.fovH); visSettings.fovV = _agInt('s-fovv', visSettings.fovV); visSettings.eyeHeight = _agFloat('s-eyeh', visSettings.eyeHeight);
                visSettings.theme = _agStr('v-theme', visSettings.theme); visSettings.mode = _agStr('v-mode', visSettings.mode); visSettings.adaptiveGlass = _agChk('v-adaptive-glass', visSettings.adaptiveGlass !== false); visSettings.hudScale = _agInt('v-hud-scale', Math.round((visSettings.hudScale || 1) * 100)) / 100;
            } catch (e) {
                // co se stihlo precist, to se o radek niz stejne ulozi
                console.warn('[nastaveni] cast hodnot se nepodarilo precist:', e);
                try { if (window.agErrLog) agErrLog.record('saveSettings: ' + (e && e.message || e)); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'grafika'); }
            } finally {
                try { setStoredData('arVisSettings12', JSON.stringify(visSettings)); applyVisualSettings(); drawAllMarkersOnMap(); } catch (e) { console.warn('[nastaveni] ulozeni:', e); }
                { const _sm = document.getElementById('settings-modal'); if (_sm) _sm.style.display = 'none'; }
                try {
                    if (oldCam !== newCam && viewMode !== 'map') { startCameraAndCompass(true); applyViewMode(); } else { applyViewMode(); }
                    if (userLat && userLng) initFetch(userLat, userLng);
                    fixAppLayout();
                    if (visSettings.wakeLockEnabled) requestWakeLock();
                } catch (e) { console.warn('[nastaveni] pouziti:', e); }
            }
        }
        // Kazde otevreni zacina s cistym stitem — jinak by po navratu do panelu tise
        // platilo stare hledani nebo zustal zapnuty rezim vyberu a chybely by body.
        let _mngDocs = null;   // poznamky/fotky vsech bodu, nactene jednim pruchodem IndexedDB
        function openManageModal() {
            document.getElementById('settings-modal').style.display = 'none';
            _mngQuery = ''; _mngSelMode = false; _mngWatchOnly = false; _mngSel.clear(); _mngOpenId = null;
            // panel se zobrazi DRIV nez se stavi obsah — renderManageList() jinak vidi
            // zavreny modal a prekresleni by jen odlozil (viz _mngVisible)
            document.getElementById('manage-modal').style.display = 'flex';
            _renderManageListNow();
            // Dokumentace bodu (poznamka/fotka) lezi v IndexedDB. Driv se na kazdy radek
            // posilal vlastni dotaz, tedy u zakazky s tisici body tisic dotazu. Ted se
            // nacte JEDNIM pruchodem a seznam se dokresli, jak dorazi.
            if (typeof loadAllPointDocs === 'function') {
                loadAllPointDocs().then(docs => {
                    _mngDocs = docs || {};
                    if (_mngVisible()) renderManageList();
                }).catch(() => {});
            }
        }
        function closeManageModal() { document.getElementById('manage-modal').style.display = 'none'; fixAppLayout(); }
        // ===== SPRAVA BODU (panel Body): hledani, razeni a hromadne operace =====
        let _mngQuery = '', _mngSort = 'default', _mngSelMode = false; const _mngSel = new Set();
        // Ctvrty prvek listovaciho panelu: ukazat JEN body, ktere prisly z hodinek.
        // Filtruje se uz v _mngAllSorted (ne skryvanim radku jako hledani), aby
        // hromadne akce nad vyberem pracovaly s tim, co je opravdu videt.
        let _mngWatchOnly = false;
        function _mngWatchCount() { let n = 0; for (const p of persistentCustomPoints) { if (agZHodinek(p)) n++; } return n; }
        function _mngMatch(p) {
            const q = _mngQuery.trim().toLowerCase();
            if (!q) return true;
            return String(p.name).toLowerCase().includes(q) || (p.kod && String(p.kod).toLowerCase().includes(q));
        }
        // radky se pri hledani jen skryvaji (viz posluchac vyse) — tohle je prepocet viditelnosti
        function _mngApplyFilter() {
            const listDiv = document.getElementById('manage-list'); if (!listDiv) return;
            let shown = 0;
            listDiv.querySelectorAll('.cp-item[data-mng-text]').forEach(el => {
                const ok = !_mngQuery.trim() || el.dataset.mngText.includes(_mngQuery.trim().toLowerCase());
                el.style.display = ok ? '' : 'none'; if (ok) shown++;
            });
            const em = document.getElementById('mng-empty'); if (em) em.style.display = shown ? 'none' : 'block';
        }
        function _mngAllSorted() {
            let pts = persistentCustomPoints.slice();
            if (_mngWatchOnly) pts = pts.filter(agZHodinek);
            if (_mngSort === 'name') pts.sort((a, b) => String(a.name).localeCompare(String(b.name), 'cs', { numeric: true }));
            else if (_mngSort === 'dist' && userLat != null) pts.sort((a, b) => getDistance(userLat, userLng, a.lat, a.lng) - getDistance(userLat, userLng, b.lat, b.lng));
            else if (_mngSort === 'new') pts.sort((a, b) => (((b.prov && b.prov.ts) || 0) - ((a.prov && a.prov.ts) || 0)));
            return pts;
        }
        // pro hromadne akce: jen body, ktere jsou pri aktivnim hledani opravdu videt
        function _mngSortedPoints() { return _mngAllSorted().filter(_mngMatch); }
        // Behem hromadne davky se NEprekresluje po kazdem bodu: deleteCustomPoint vola
        // renderManageList i drawAllMarkersOnMap, coz je u stovek bodu kvadraticka prace
        // (proj4 prevod na kazdy radek) a appka by na nekolik sekund zamrzla.
        let _mngSuspendRedraw = false;

        // S-JTSK PRO SEZNAM: proj4 prevod je nejdrazsi vec na radku a delal se ZNOVU
        // pri kazdem prekresleni pro kazdy bod. Cachujeme ho ve WeakMap podle OBJEKTU
        // bodu (ne jako jeho vlastnost — ta by se pribalila do
        // JSON.stringify(persistentCustomPoints), tedy do uloziste i do exportu)
        // a zahazujeme, jakmile se bod posune. WeakMap nepotrebuje zadny strop:
        // zaznam zmizi spolu s bodem.
        const _mngYXCache = new WeakMap();
        function _mngYX(pt) {
            const k = pt.lat + ',' + pt.lng;
            let c = _mngYXCache.get(pt);
            if (!c || c.k !== k) {
                const s = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]);
                c = { k: k, y: Math.abs(s[0]).toFixed(2), x: Math.abs(s[1]).toFixed(2) };
                _mngYXCache.set(pt, c);
            }
            return c;
        }
        function _mngVisible() {
            const m = document.getElementById('manage-modal');
            return !!m && m.style.display === 'flex';
        }

        // ===== TERENNI RADEK SEZNAMU (navrh A1) + DETAIL NA TUKNUTI (navrh A2) =====
        // Driv byla kazda polozka VYSOKA KARTA: pet radku souradnic pod sebou, tuzka
        // a kos ve vlastnim radku — na displej se vesly tri body. Souradnice pritom
        // v terenu nepotrebujes; potrebujes vedet, KTERY bod to je, JAK DALEKO je
        // a KTERYM SMEREM. Radek proto nese cislo, kod, stari, presnost, vzdalenost
        // a azimut; Y/X/Z se odkryje az tuknutim, na miste, spolu s akcemi.
        // Rozbaleny detail je POTOMEK radku (ne sourozenec) — diky tomu ho hledani
        // schova spolu s radkem (_mngApplyFilter prepina display na .cp-item).
        let _mngOpenId = null;    // ktery bod ma rozbaleny detail (prezije prekresleni)

        function _mngAge(ts) {
            if (!ts || !isFinite(ts)) return '';
            const s = Math.round((Date.now() - ts) / 1000);
            if (s < 90) return 'před chvílí';
            const m = Math.round(s / 60);
            if (m < 60) return 'před ' + m + ' min';
            const h = Math.round(m / 60);
            if (h < 24) return 'před ' + h + ' h';
            const d = Math.round(h / 24);
            if (d < 7) return 'před ' + d + ' dny';
            try { return new Date(ts).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }); } catch (e) { return ''; }
        }
        // Vzdalenost se v terenu cte na jeden pohled — proto tri pasma misto jednoho
        // formatu: pod deset metru na decimetry, do kilometru na cele metry, dal v km.
        function _mngDist(m) {
            if (m == null || !isFinite(m)) return '';
            if (m < 10) return m.toFixed(1).replace('.', ',') + ' m';
            if (m < 1000) return Math.round(m) + ' m';
            return (m / 1000).toFixed(2).replace('.', ',') + ' km';
        }
        // Presnost jednou stupnici pro celou appku (js/duvera.js). Modul je odpojitelny
        // a nacita se lazy, takze zaloha musi umet totez aspon priblizne.
        function _mngQual(pt) {
            try {
                if (window.AGDuvera && AGDuvera.bod) {
                    const v = AGDuvera.bod(pt);
                    return { a: v.a, trida: v.trida, nadpis: v.nadpis, mereno: v.mereno };
                }
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:_mngQual'); }
            const a = (pt && pt.acc != null && isFinite(pt.acc)) ? Number(pt.acc) : null;
            const t = (a == null) ? 'none' : (a <= 1.06 ? 'ok' : (a <= 2.12 ? 'warn' : 'bad'));
            return { a: a, trida: t, nadpis: '', mereno: false };
        }
        function _mngAcc(pt) {
            const q = _mngQual(pt);
            if (q.a == null) return '<span class="mngr-acc" data-q="none">bez přesnosti</span>';
            return '<span class="mngr-acc" data-q="' + q.trida + '">' + (q.mereno ? '' : '~')
                + '±' + q.a.toFixed(2).replace('.', ',') + ' m</span>';
        }
        // Odkud bod je — barva prouzku vlevo. Hodinky uz svou barvu maji (cp-watch).
        function _mngOrigin(pt) {
            const o = (pt && pt.prov && pt.prov.origin) || '';
            if (o === 'import' || o === 'prenos') return 'import';
            if (o === 'gps-avg' || o === 'gps') return 'gps';
            return '';
        }

        // Rozbaleny detail bodu — to, co bylo driv natvrdo v kazde karte, plus akce.
        function _mngBuildDetail(pt) {
            const yx = _mngYX(pt);
            const q = _mngQual(pt);
            const ts = (pt.prov && pt.prov.ts) || null;
            let cas = '—';
            if (ts) { try { cas = new Date(ts).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { cas = ''; } }
            const det = document.createElement('div');
            det.className = 'mngr-det';
            det.innerHTML = '<div class="mngr-grid">'
                + '<div><i>Y</i><b>' + yx.y + '</b></div>'
                + '<div><i>X</i><b>' + yx.x + '</b></div>'
                + '<div><i>Z</i><b>' + (pt.vyska != null ? Number(pt.vyska).toFixed(2) + ' m' : '—') + '</b></div>'
                + '<div><i>Měřeno</i><b>' + _escHtml(cas) + '</b></div>'
                + '</div>'
                + '<div class="mngr-q" data-q="' + q.trida + '"><span class="mngr-q-track"><i></i></span>'
                + '<span class="mngr-q-txt">' + (q.a == null ? 'přesnost neznámá' : ('±' + q.a.toFixed(2).replace('.', ',') + ' m' + (q.nadpis ? ' · ' + _escHtml(q.nadpis.toLowerCase()) : ''))) + '</span></div>'
                + '<div class="mngr-acts">'
                + '<button type="button" class="mngr-act mngr-act-go" data-a="go">Navést</button>'
                + '<button type="button" class="mngr-act" data-a="edit">Upravit</button>'
                + '<button type="button" class="mngr-act" data-a="copy">Kopírovat</button>'
                + '<button type="button" class="mngr-act mngr-act-del" data-a="del">Smazat</button>'
                + '</div>';
            // Prouzek kvality: cim presnejsi bod, tim kratsi. 3 m a horsi = plny.
            try {
                const fill = det.querySelector('.mngr-q-track i');
                const pct = (q.a == null) ? 100 : Math.max(6, Math.min(100, Math.round(q.a / 3 * 100)));
                fill.style.width = pct + '%';
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:_mngBuildDetail'); }
            // Klik uvnitr detailu se NESMI vratit na radek — ten by detail hned zase zavrel.
            det.addEventListener('click', (ev) => {
                const b = ev.target && ev.target.closest ? ev.target.closest('.mngr-act') : null;
                ev.stopPropagation();
                if (!b) return;
                const a = b.getAttribute('data-a');
                if (a === 'go') focusPointFromList(pt.id);
                else if (a === 'edit') editCustomPoint(pt.id);
                else if (a === 'del') deleteCustomPoint(pt.id);
                else if (a === 'copy') _mngCopy(pt);
            });
            return det;
        }
        function _mngCopy(pt) {
            const yx = _mngYX(pt);
            const txt = pt.name + ';' + yx.y + ';' + yx.x + (pt.vyska != null ? ';' + Number(pt.vyska).toFixed(2) : '');
            const done = () => { try { quickToast('Zkopírováno: ' + txt); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:_mngCopy'); } };
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done, () => agInfo(txt)); return; }
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:_mngCopy'); }
            agInfo(txt);
        }
        // Prepnuti detailu. Otevreny je vzdy nejvys jeden — dva rozbalene body vedle
        // sebe uz nejsou seznam, ale dve karty, a jsme zpatky tam, odkud jdeme pryc.
        function _mngToggleDetail(item, pt) {
            const open = item.classList.contains('mngr-open');
            const list = document.getElementById('manage-list');
            if (list) list.querySelectorAll('.cp-item.mngr-open').forEach(el => {
                el.classList.remove('mngr-open');
                const d = el.querySelector(':scope > .mngr-det'); if (d) d.remove();
            });
            if (open) { _mngOpenId = null; return; }
            item.classList.add('mngr-open');
            item.appendChild(_mngBuildDetail(pt));
            _mngOpenId = pt.id;
        }
        // PREKRESLENI SEZNAMU BODU — dve nezavisla zrychleni naraz:
        //  1) Driv kazde ulozeni/smazani bodu postavilo cely seznam znovu, i kdyz panel
        //     Body vubec nebyl otevreny. U zakazky o tisicich bodu to bylo nekolik set
        //     milisekund prace do neviditelna, po kazdem bodu. Ted se jen poznamena, ze
        //     je seznam zastaraly, a postavi se az pri otevreni; volani v jedne davce
        //     se slucuji do jednoho prekresleni v nejblizsim snimku.
        //  2) Radky se stavi po DAVKACH (_MNG_CHUNK), at se modal neotevira az za par
        //     sekund. Rozdelane dokreslovani se pozna podle tokenu — kdyz se seznam
        //     mezitim prekresli znovu (razeni, smazani, rezim vyberu), stara davka se
        //     zahodi.
        let _mngRafId = 0;
        let _mngRenderToken = 0;
        const _MNG_CHUNK = 60;
        function renderManageList() {
            if (_mngSuspendRedraw) return;
            if (!_mngVisible()) return;   // panel neni videt — stavet ho je prace do neviditelna
            if (_mngRafId) return;                       // uz je naplanovano na tento snimek
            _mngRafId = requestAnimationFrame(() => { _mngRafId = 0; _renderManageListNow(); });
        }
        function _renderManageListNow() {
            const listDiv = document.getElementById('manage-list');
            if (!listDiv) return;
            listDiv.innerHTML = '';
            if (persistentCustomPoints.length === 0) { listDiv.innerHTML = '<p style="text-align:center;">Žádné body v této zakázce.</p>'; renderHiddenPointsRow(listDiv); renderLinesList(listDiv); return; }
            // SOUHRN ZAKAZKY: tri cisla, ktera appka uz zna a nikde nerikala —
            // kolik bodu, jak presne se meri a kolik bodu jde ven bez kodu.
            // Pocita se pres VSECHNY body zakazky, ne pres filtr: je to stav zakazky,
            // ne stav seznamu.
            const sumBox = document.createElement('div'); sumBox.className = 'mng-sum';
            let accSum = 0, accN = 0, noKod = 0;
            for (const p of persistentCustomPoints) {
                const q = _mngQual(p);
                if (q.a != null) { accSum += q.a; accN++; }
                if (!p.kod) noKod++;
            }
            const accAvg = accN ? (accSum / accN) : null;
            const _nP = persistentCustomPoints.length;
            const _slovoBod = (_nP === 1) ? 'bod' : ((_nP >= 2 && _nP <= 4) ? 'body' : 'bodů');
            sumBox.innerHTML = '<div class="mng-kpi"><b>' + _nP + '</b><span>' + _slovoBod + '</span></div>'
                + '<div class="mng-kpi"><b>' + (accAvg == null ? '—' : '±' + accAvg.toFixed(2).replace('.', ',')) + '</b><span>průměr m</span></div>'
                + '<div class="mng-kpi' + (noKod ? ' mng-kpi-warn' : '') + '"><b>' + noKod + '</b><span>bez kódu</span></div>';
            listDiv.appendChild(sumBox);

            // listovaci panel: hledani + razeni + rezim vyberu (hromadne operace)
            const bar = document.createElement('div'); bar.className = 'mng-bar';
            bar.innerHTML = '<input type="search" id="mng-search" placeholder="Hledat bod / kód…" autocomplete="off">';
            listDiv.appendChild(bar);
            const si = bar.querySelector('#mng-search'); si.value = _mngQuery;
            // hledani jen SKRYVA radky, seznam se neprekresluje — jinak by kazde pismeno
            // znovu postavilo DOM, prislo o fokus a na mobilu poskakovala klavesnice
            si.addEventListener('input', () => { _mngQuery = si.value; _mngApplyFilter(); });

            // RAZENI JAKO CHIPY, ne rozbalovatko. Rozbalovatko schovavalo, podle ceho
            // je seznam serazeny, za jeden dotyk navic — a prave to je v terenu ta
            // nejcastejsi zmena ("ukaz nejblizsi"). Ted je stav videt bez otevirani
            // a prepnuti stoji jedno tuknuti. Hodnoty jsou tytez jako driv v <select>.
            const SORTS = [
                { v: 'default', l: 'Pořadí' },
                { v: 'name', l: 'Podle čísla' },
                { v: 'dist', l: 'Nejbližší', gps: 1 },
                { v: 'new', l: 'Nejnovější' }
            ];
            const chips = document.createElement('div'); chips.className = 'mng-chips';
            let ch = '';
            SORTS.forEach(s => {
                // "Nejblizsi" bez polohy nic neseradi — nabizet ho by byl slepy dotyk
                if (s.gps && userLat == null) return;
                ch += '<button type="button" class="mng-chip' + (_mngSort === s.v ? ' on' : '') + '" data-sort="' + s.v + '"'
                    + ' aria-pressed="' + (_mngSort === s.v ? 'true' : 'false') + '">' + s.l + '</button>';
            });
            // Chip se ukaze, teprve kdyz je co ukazovat — v zakazce bez hodinek
            // by to bylo tlacitko, ktere umi jedine vyprazdnit seznam.
            if (_mngWatchCount()) {
                ch += '<button type="button" class="mng-chip mng-chip-watch' + (_mngWatchOnly ? ' on' : '') + '" id="mng-watchbtn"'
                    + ' aria-pressed="' + (_mngWatchOnly ? 'true' : 'false') + '" aria-label="Jen body z hodinek">⌚ ' + _mngWatchCount() + '</button>';
            }
            ch += '<button type="button" class="mng-chip mng-chip-sel' + (_mngSelMode ? ' on' : '') + '" id="mng-selbtn"'
                + ' aria-pressed="' + (_mngSelMode ? 'true' : 'false') + '">' + (_mngSelMode ? 'Hotovo' : 'Vybrat') + '</button>';
            chips.innerHTML = ch;
            listDiv.appendChild(chips);
            chips.querySelectorAll('[data-sort]').forEach(b => {
                b.addEventListener('click', () => { _mngSort = b.getAttribute('data-sort'); renderManageList(); });
            });
            const sb = chips.querySelector('#mng-selbtn');
            sb.addEventListener('click', () => { _mngSelMode = !_mngSelMode; if (!_mngSelMode) _mngSel.clear(); _mngOpenId = null; renderManageList(); });
            const wb = chips.querySelector('#mng-watchbtn');
            if (wb) {
                // Vyber se pri prepnuti zahazuje: jinak by v nem zustaly body, ktere uz
                // nejsou v seznamu videt, a hromadna akce by sahla i na ne.
                wb.addEventListener('click', () => { _mngWatchOnly = !_mngWatchOnly; _mngSel.clear(); renderManageList(); });
            }
            if (_mngSelMode) renderMngActions(listDiv);
            const pts = _mngAllSorted();
            const empty = document.createElement('p'); empty.id = 'mng-empty';
            empty.style.cssText = 'text-align:center; opacity:.7; display:none;';
            empty.innerText = (_mngWatchOnly && !pts.length) ? 'Žádné body z hodinek.' : 'Hledání nic nenašlo.';
            listDiv.appendChild(empty);
            // Radek seznamu. Vyrobit vsech 1000 naraz znamena, ze se modal otevre
            // az za par sekund — proto se stavi po davkach (viz nize).
            const buildRow = (pt) => {
                const zHodinek = agZHodinek(pt);
                const item = document.createElement('div');
                item.className = 'cp-item mngr' + (zHodinek ? ' cp-watch' : '');
                const orig = _mngOrigin(pt);
                if (orig) item.dataset.orig = orig;
                // "hodinky" v hledanem textu: da se je vypsat i psanim, nejen prepinacem
                item.dataset.mngText = (String(pt.name) + ' ' + (pt.kod || '') + (zHodinek ? ' hodinky garmin' : '')).toLowerCase();
                // Vzdalenost a azimut jdou dopredu — podle nich se v terenu rozhodujes.
                // Souradnice jsou o jedno tuknuti dal, v detailu (viz _mngBuildDetail).
                let far = '';
                if (userLat != null) {
                    const d = getDistance(userLat, userLng, pt.lat, pt.lng);
                    const az = (typeof getBearing === 'function') ? Math.round(getBearing(userLat, userLng, pt.lat, pt.lng)) : null;
                    far = '<b>' + _mngDist(d) + '</b><small>' + (d < 1.5 ? 'stojíš na něm' : (az == null ? '' : az + '°')) + '</small>';
                }
                const age = _mngAge(pt.prov && pt.prov.ts);
                item.innerHTML = '<div class="mngr-id"><b>' + _escHtml(pt.name)
                    + (pt.kod ? ' <span class="cp-kod">' + _escHtml(pt.kod) + '</span>' : '')
                    + (zHodinek ? ' <span class="cp-watch-tag" title="Změřeno hodinkami — přesnost jednotky metrů">⌚</span>' : '')
                    + '</b><small>' + (age ? _escHtml(age) + ' · ' : '') + _mngAcc(pt) + '</small></div>'
                    + '<div class="mngr-far">' + far + '</div>'
                    + '<span class="mngr-arw" aria-hidden="true">›</span>';
                if (_mngSelMode) {
                    item.classList.add('mng-selectable'); item.classList.toggle('mng-selected', _mngSel.has(pt.id));
                    const chk = document.createElement('div'); chk.className = 'mng-check'; chk.textContent = _mngSel.has(pt.id) ? '✓' : ''; item.appendChild(chk);
                    item.addEventListener('click', () => {
                        if (_mngSel.has(pt.id)) _mngSel.delete(pt.id); else _mngSel.add(pt.id);
                        item.classList.toggle('mng-selected', _mngSel.has(pt.id)); chk.textContent = _mngSel.has(pt.id) ? '✓' : '';
                        const c = document.getElementById('mng-count'); if (c) c.innerText = _mngSel.size;
                    });
                } else {
                    // TUKNUTI NA RADEK = ROZBALIT DETAIL (souradnice, cas, kvalita, akce).
                    // Driv tuknuti rovnou zamerilo bod a zavrelo seznam; tuzka a kos byly
                    // dve male ikonky ve vlastnim radku u kazde polozky. Ted je v radku
                    // jen to podstatne a vsechny ctyri akce (vcetne "Navést", coz je
                    // puvodni zamereni) jsou v rozbalenem detailu.
                    item.classList.add('cp-focusable');
                    item.setAttribute('role', 'button');
                    item.setAttribute('tabindex', '0');
                    item.addEventListener('click', () => _mngToggleDetail(item, pt));
                    item.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); _mngToggleDetail(item, pt); } });
                    // Rozbaleny bod prezije prekresleni seznamu (smazani, razeni, dobehnuti
                    // fotek) — jinak by se pri kazde zmene sam zavrel.
                    if (_mngOpenId === pt.id) { item.classList.add('mngr-open'); item.appendChild(_mngBuildDetail(pt)); }
                    if (typeof decoratePointItem === 'function') {
                        try {
                            if (_mngDocs) decoratePointItem(item, pt, _mngDocs[pt.id] || null);
                            else decoratePointItem(item, pt);
                        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:buildRow'); }
                    }
                }
                return item;
            };

            // Konec seznamu (skryté body + spojnice) připojíme HNED a řádky vkládáme
            // před tuhle kotvu — jinak by při dokreslování poskakoval dolů.
            // Kotva je komentář, aby se nezměnila struktura pro CSS.
            const anchor = document.createComment('mng-rows-end');
            listDiv.appendChild(anchor);
            renderHiddenPointsRow(listDiv); renderLinesList(listDiv);

            const myToken = ++_mngRenderToken;
            let i = 0;
            const step = () => {
                if (myToken !== _mngRenderToken) return;          // mezitím se překreslilo znovu
                if (!anchor.parentNode) return;                    // seznam mezitím zmizel
                const frag = document.createDocumentFragment();
                const end = Math.min(i + _MNG_CHUNK, pts.length);
                for (; i < end; i++) frag.appendChild(buildRow(pts[i]));
                listDiv.insertBefore(frag, anchor);
                const more = i < pts.length;
                // Během dokreslování filtrujeme jen když se opravdu hledá; na konci vždy,
                // aby aktivní hledání platilo i po překreslení (mazání, řazení, výběr).
                if (!more || _mngQuery.trim()) _mngApplyFilter();
                if (more) requestAnimationFrame(step);
            };
            step();   // první dávka synchronně — modal se nikdy neukáže prázdný
        }
        // Zamereni bodu ze seznamu: zavrit seznam, uklidit vse, co by bod schovalo,
        // a nastavit ho jako zvyrazneny cil (mapa + ukazatel na hrane displeje).
        function focusPointFromList(id) {
            const pt = arPoints.find(p => p.id === id) || persistentCustomPoints.find(p => p.id === id);
            if (!pt) return;
            if (pt.hidden) pt.hidden = false;
            if (!filters.custom && pt.cat === 'CUSTOM') {
                filters.custom = true; setStoredData('arFilters12', JSON.stringify(filters));
                const c = document.getElementById('f-custom'); if (c) c.checked = true;
            }
            if (!agMatchQuery(pt, searchQuery)) {
                searchQuery = '';
                const inp = document.getElementById('s-search-name'); if (inp) inp.value = '';
            }
            closeManageModal();
            if (highlightedPointId !== pt.id) highlightPoint(pt);
            else { initARMarkers(); drawAllMarkersOnMap(); updateNavGlow(); }
            try { if (window.AGCilNav && AGCilNav.fit) AGCilNav.fit(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:focusPointFromList'); }
            const d = (userLat != null) ? getDistance(userLat, userLng, pt.lat, pt.lng) : null;
            quickToast('Cíl: ' + pt.name + (d != null ? ' — ' + d.toFixed(1) + ' m' : ''));
            agVibe(20);
        }
        window.focusPointFromList = focusPointFromList;
        // panel hromadnych akci nad vyberem
        function renderMngActions(listDiv) {
            const box = document.createElement('div'); box.className = 'mng-actions';
            const canHelmert = !!(window.AGLocalize && AGLocalize.active);
            box.innerHTML = '<div class="mng-actions-head">Vybráno: <b id="mng-count">' + _mngSel.size + '</b>&nbsp;<button type="button" class="mng-lnk" id="mng-all">Vybrat vše</button></div>'
                + '<p class="mng-hint">Ťukni na body v seznamu a použij akci. Smazané drží koš 30 dní (Více → Koš).</p>'
                + '<div class="mng-actions-btns">'
                + '<button type="button" class="btn btn-danger" id="mng-del"><svg class="icon"><use href="#i-trash"/></svg> Smazat</button>'
                + '<button type="button" class="btn btn-secondary" id="mng-renum">Přečíslovat</button>'
                + '<button type="button" class="btn btn-secondary" id="mng-shift">Posun ΔY/ΔX/ΔZ</button>'
                + '<button type="button" class="btn btn-secondary" id="mng-kod">Přiřadit kód</button>'
                + (canHelmert ? '<button type="button" class="btn btn-secondary" id="mng-helm">Srovnat lokalizací</button>' : '')
                + '</div>';
            listDiv.appendChild(box);
            box.querySelector('#mng-all').addEventListener('click', () => { const pts = _mngSortedPoints(); if (_mngSel.size >= pts.length) _mngSel.clear(); else pts.forEach(p => _mngSel.add(p.id)); renderManageList(); });
            box.querySelector('#mng-del').addEventListener('click', mngBulkDelete);
            box.querySelector('#mng-renum').addEventListener('click', mngBulkRenumber);
            box.querySelector('#mng-shift').addEventListener('click', mngBulkShift);
            box.querySelector('#mng-kod').addEventListener('click', mngBulkKod);
            const hb = box.querySelector('#mng-helm'); if (hb) hb.addEventListener('click', mngBulkHelmert);
        }
        function _mngSelectedPts() { return _mngSortedPoints().filter(p => _mngSel.has(p.id)); }
        function _mngNeedSel() { if (!_mngSel.size) { agInfo('Nejdřív vyber body — ťukni na ně v seznamu.'); return true; } return false; }
        // spolecny konec hromadne editace: persist + prekresleni AR/mapy/seznamu
        function _mngAfterEdit(ids) {
            setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints));
            arPoints.forEach(p => { if (ids.has(p.id) && p.element) { p.element.remove(); p.element = null; _resetPtRenderCache(p); } });
            initARMarkers(); drawAllMarkersOnMap(); renderManageList();
            if (typeof updateInfoPanel === 'function') updateInfoPanel();
            if (typeof window.agVibe === 'function') agVibe(30);
        }

        // ===== VRACENI HROMADNYCH OPERACI ==========================================
        // Hromadny posun / precislovani / kod / Helmert menily klidne 200 bodu naraz
        // a nesly vratit NIJAK. Zurnal (js/journal.js) si sice pro kazdy bod ukladal
        // before i after, ale nikdo z nej neumel nic obnovit — pri preklepu v posunu
        // ("0 0 -5" misto "0 0 -0.05") tak byla zakazka rozbita natrvalo.
        // Ted si operace drzi before-snimky a nabidne "Vrátit zpět" (stejny toast jako
        // mazani, js/undo.js). Do zurnalu se navic zapisuje batch = id davky, takze
        // v historii bodu je videt, ze slo o jednu spolecnou operaci.
        // Pole, ktera patri vykreslovani, ne datum bodu — ty se z before NEobnovuji.
        const _PT_RENDER_KEYS = { element: 1, distElement: 1, moreElement: 1, _arCluster: 1, currentDist: 1, currentBearing: 1, _tfLast: 1, _opLast: 1, _dLast: 1, _zLast: 1 };
        function _ptRestore(p, before) {
            if (!p || !before) return;
            // klice, ktere operace PRIDALA (napr. kod), musi zmizet
            Object.keys(p).forEach(k => { if (!_PT_RENDER_KEYS[k] && !(k in before)) delete p[k]; });
            Object.keys(before).forEach(k => { if (!_PT_RENDER_KEYS[k]) p[k] = before[k]; });
        }
        let _agLastBulk = null;
        function _mngBulkDone(msg, items, batchId) {
            if (!items || !items.length) { quickToast(msg); return; }
            _agLastBulk = { items: items, batch: batchId, ts: Date.now() };
            if (window.AGUndo && typeof AGUndo.toast === 'function') AGUndo.toast(msg, agUndoLastBulk);
            else quickToast(msg);
        }
        function agUndoLastBulk() {
            const b = _agLastBulk;
            if (!b || !b.items || !b.items.length) return;
            const ids = new Set();
            b.items.forEach(it => {
                const p = persistentCustomPoints.find(q => q.id === it.id);
                if (p) { _ptRestore(p, it.before); ids.add(p.id); }
                const ar = arPoints.find(q => q.id === it.id);
                if (ar) _ptRestore(ar, it.before);
                // do zurnalu i samotne vraceni — historie bodu musi sedet na data
                try { if (window.AGJournal) AGJournal.commit({ op: 'edit', id: it.id, before: null, after: { ...it.before }, origin: 'vraceni-hromadne', batch: b.batch }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:agUndoLastBulk'); }
            });
            _agLastBulk = null;
            _mngAfterEdit(ids);
            quickToast('Vráceno zpět: ' + ids.size + ' bodů.');
        }
        function _bulkId() { return 'b' + Date.now().toString(36) + Math.round(Math.random() * 1e4).toString(36); }
        // ===========================================================================

        function mngBulkDelete() {
            if (_mngNeedSel()) return;
            // jen body, ktere jsou pri aktivnim hledani opravdu videt (stejne jako ostatni akce)
            const ids = _mngSelectedPts().map(p => p.id);
            if (!ids.length) return agInfo('Vybrané body nejsou v aktivním hledání vidět — zruš hledání nebo vyber jiné.');
            const doIt = () => {
                _mngSuspendRedraw = true;
                // batch = true: zadny zapis do uloziste ani prekresleni po KAZDEM bode,
                // vsechno se udela jednou na konci davky (flushPointsAfterBulk).
                try { ids.forEach(id => { try { deleteCustomPoint(id, true, true); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:doIt'); } }); }
                finally { _mngSuspendRedraw = false; }
                flushPointsAfterBulk();
                ids.forEach(id => _mngSel.delete(id));
                drawAllMarkersOnMap(); initARMarkers();
                // undo toast umi vratit jen POSLEDNI smazany bod — u hromadneho mazani by mátl; koš má všechny
                if (ids.length > 1) { const ut = document.getElementById('undo-toast'); if (ut) ut.style.display = 'none'; }
                renderManageList();
                quickToast('Smazáno ' + ids.length + ' bodů — obnova: menu Více → Koš (30 dní).');
                if (typeof window.agVibe === 'function') agVibe(30);
            };
            const msg = 'Opravdu smazat ' + ids.length + ' vybraných bodů?<br>Obnovit je půjde 30 dní z koše (Více → Koš).';
            if (window.agConfirm) agConfirm({ title: 'Smazat vybrané body', message: msg, okText: 'Smazat', danger: true }).then(ok => { if (ok) doIt(); });
            else if (confirm('Opravdu smazat ' + ids.length + ' vybraných bodů?')) doIt();
        }
        function mngBulkRenumber() {
            if (_mngNeedSel()) return;
            const ask = (v) => {
                if (!v) return;
                const m = /^(.*?)(\d{1,9})$/.exec(String(v).trim());
                if (!m) return agInfo('Zadej název končící číslem — např. „101" nebo „OB01".');
                const prefix = m[1], pad = m[2].length; let n = parseInt(m[2], 10);
                const sel = _mngSelectedPts(); const ids = new Set(sel.map(p => p.id));
                const undoItems = [], batch = _bulkId();
                sel.forEach(p => {
                    let cand;
                    do { cand = prefix + String(n).padStart(pad, '0'); n++; } while (persistentCustomPoints.some(q => q.id !== p.id && q.name === cand));
                    const before = { ...p }; undoItems.push({ id: p.id, before: before }); p.name = cand;
                    const ar = arPoints.find(a => a.id === p.id); if (ar) ar.name = cand;
                    try { if (window.AGJournal) AGJournal.commit({ op: 'edit', id: p.id, before: before, after: { ...p }, origin: 'hromadne-precislovani', batch: batch }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:ask'); }
                });
                _mngAfterEdit(ids);
                _mngBulkDone('Přečíslováno ' + sel.length + ' bodů.', undoItems, batch);
            };
            if (window.agPrompt) agPrompt({ title: 'Přečíslovat vybrané body', message: 'Zadej PRVNÍ název série (musí končit číslem). Vybrané body dostanou čísla po sobě v pořadí seznamu; už obsazená čísla se přeskočí.', placeholder: 'Např. 101 nebo OB01', okText: 'Přečíslovat' }).then(ask);
            else ask(prompt('První název série (např. 101):'));
        }
        function mngBulkShift() {
            if (_mngNeedSel()) return;
            const ask = (v) => {
                if (!v) return;
                const parts = String(v).trim().split(/[;\s]+/).map(t => parseFloat(t.replace(',', '.')));
                if (!parts.length || parts.some(x => !isFinite(x))) return agInfo('Zadej posun jako „ΔY ΔX" nebo „ΔY ΔX ΔZ" v metrech, oddělené mezerou — např. „0 0 -0.05".');
                const dY = parts[0] || 0, dX = parts[1] || 0, dZ = parts[2] || 0;
                const sel = _mngSelectedPts(); const ids = new Set(sel.map(p => p.id));
                const undoItems = [], batch = _bulkId();
                sel.forEach(p => {
                    const before = { ...p }; undoItems.push({ id: p.id, before: before });
                    const sj = proj4("EPSG:4326", "EPSG:5514", [p.lng, p.lat]);
                    const c = sjtskToLatLng(Math.abs(sj[0]) + dY, Math.abs(sj[1]) + dX);
                    p.lat = c.lat; p.lng = c.lng;
                    if (dZ && p.vyska != null) p.vyska = Math.round((p.vyska + dZ) * 1000) / 1000;
                    const ar = arPoints.find(a => a.id === p.id); if (ar) { ar.lat = p.lat; ar.lng = p.lng; ar.vyska = p.vyska; }
                    try { if (window.AGJournal) AGJournal.commit({ op: 'edit', id: p.id, before: before, after: { ...p }, origin: 'hromadny-posun', batch: batch }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:ask'); }
                });
                _mngAfterEdit(ids);
                _mngBulkDone('Posunuto ' + sel.length + ' bodů (ΔY ' + dY + ' m, ΔX ' + dX + ' m' + (dZ ? ', ΔZ ' + dZ + ' m' : '') + ').', undoItems, batch);
            };
            if (window.agPrompt) agPrompt({ title: 'Posunout vybrané body', message: 'Posun v metrech S-JTSK: „ΔY ΔX" nebo „ΔY ΔX ΔZ" (mezerou). Např. snížit výšku o 5 cm: „0 0 -0.05".', placeholder: '0 0 -0.05', okText: 'Posunout' }).then(ask);
            else ask(prompt('Posun ΔY ΔX ΔZ (m):'));
        }
        function mngBulkKod() {
            if (_mngNeedSel()) return;
            const ask = (v) => {
                if (v == null || String(v).trim() === '') return;
                const kod = (String(v).trim() === '-') ? null : String(v).trim().slice(0, 60);
                const sel = _mngSelectedPts(); const ids = new Set(sel.map(p => p.id));
                const undoItems = [], batch = _bulkId();
                sel.forEach(p => {
                    const before = { ...p }; undoItems.push({ id: p.id, before: before });
                    if (kod) p.kod = kod; else delete p.kod;
                    const ar = arPoints.find(a => a.id === p.id); if (ar) { if (kod) ar.kod = kod; else delete ar.kod; }
                    try { if (window.AGJournal) AGJournal.commit({ op: 'edit', id: p.id, before: before, after: { ...p }, origin: 'hromadny-kod', batch: batch }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:ask'); }
                });
                if (kod && typeof window.agKodRemember === 'function') agKodRemember(kod);
                _mngAfterEdit(ids);
                _mngBulkDone(kod ? ('Kód „' + kod + '" přiřazen ' + sel.length + ' bodům.') : ('Kód odebrán u ' + sel.length + ' bodů.'), undoItems, batch);
            };
            if (window.agPrompt) agPrompt({ title: 'Kód pro vybrané body', message: 'Kód se propíše do CSV/TXT/DXF exportu (v DXF jako vrstva výkresu). Pomlčka „-" kód odebere.', placeholder: 'Např. obruba', okText: 'Přiřadit' }).then(ask);
            else ask(prompt('Kód bodu (- = odebrat):'));
        }
        function mngBulkHelmert() {
            if (_mngNeedSel()) return;
            if (!window.AGLocalize || !AGLocalize.active) return agInfo('Helmertova lokalizace není aktivní — nejdřív ji zapni v Nástrojích.');
            const sel = _mngSelectedPts().filter(p => !p._localized);
            const skipped = _mngSel.size - sel.length;
            if (!sel.length) return agInfo('Vybrané body už byly lokalizací srovnány (každý bod se přepočítává jen jednou).');
            const doIt = () => {
                const ids = new Set(sel.map(p => p.id)); let done = 0;
                const undoItems = [], batch = _bulkId();
                sel.forEach(p => {
                    const c = AGLocalize.apply(p.lat, p.lng); if (!c || !isFinite(c[0]) || !isFinite(c[1])) return;
                    const before = { ...p }; undoItems.push({ id: p.id, before: before });
                    p.lat = c[0]; p.lng = c[1];
                    if (p.vyska != null && AGLocalize.applyZ) p.vyska = AGLocalize.applyZ(c[0], c[1], p.vyska);
                    p._localized = true; done++;
                    const ar = arPoints.find(a => a.id === p.id); if (ar) { ar.lat = p.lat; ar.lng = p.lng; ar.vyska = p.vyska; ar._localized = true; }
                    try { if (window.AGJournal) AGJournal.commit({ op: 'edit', id: p.id, before: before, after: { ...p }, origin: 'helmert-hromadne', batch: batch }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:doIt'); }
                });
                _mngAfterEdit(ids);
                _mngBulkDone('Lokalizací srovnáno ' + done + ' bodů' + (skipped ? ' (' + skipped + ' přeskočeno — už srovnané)' : '') + '.', undoItems, batch);
            };
            const msg = 'Přepočítat ' + sel.length + ' bodů aktivní Helmertovou lokalizací?' + (skipped ? '<br>(' + skipped + ' vybraných se přeskočí — už jsou srovnané.)' : '');
            if (window.agConfirm) agConfirm({ title: 'Srovnat body lokalizací', message: msg, okText: 'Přepočítat' }).then(ok => { if (ok) doIt(); });
            else if (confirm('Přepočítat ' + sel.length + ' bodů Helmertem?')) doIt();
        }
        // Skryte body: dohledatelne primo v sekci Body (drive jen hluboko v Nastaveni -> Udrzba)
        function renderHiddenPointsRow(listDiv) {
            const n = arPoints.filter(p => p.hidden).length;
            if (!n) return;
            const row = document.createElement('div');
            row.className = 'cp-item hidden-pts-row';
            row.innerHTML = `<div class="cp-title" style="color:var(--text-muted);"><svg class="icon" style="vertical-align:-0.2em;"><use href="#i-eye-off"/></svg> Skryté body: ${n}</div><div class="cp-coords">Body skryté z AR a mapy tlačítkem „Skrýt tento bod".</div>`;
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary';
            btn.style.cssText = 'margin-top:8px; padding:10px;';
            // s modulem hidden-points.js otevře seznam (obnova i jednotlivě), jinak obnoví vše
            if (window.agOpenHiddenPoints) {
                btn.innerHTML = '<svg class="icon"><use href="#i-eye-off"/></svg> Zobrazit a obnovit skryté body';
                btn.onclick = function () { closeManageModal(); window.agOpenHiddenPoints(); };
            } else {
                btn.innerHTML = '<svg class="icon"><use href="#i-rotate-ccw"/></svg> Obnovit skryté body';
                btn.onclick = function () { restoreHiddenPoints(); };
            }
            row.appendChild(btn);
            listDiv.appendChild(row);
        }
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
            hint.style.cssText = 'font-size:calc(11.5px * var(--ag-font-scale, 1)); opacity:0.7; margin:8px 2px 4px; line-height:1.4;';
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
        function deleteLineFromList(id) { agAsk('Smazat tuto spojnici?', { title: 'Smazat spojnici', okText: 'Smazat', danger: true }).then(function (ok) { if (!ok) return; _linesBoxOpen = true; deleteLine(id); renderManageList(); }); }
        // reset polí „popis + fotka" ve formuláři bodu; u editace předvyplní uloženou poznámku
        function resetNewPointExtras(loadNoteForId) {
            window._agNewPtPhoto = null;
            const pv = document.getElementById('custom-photo-note'); if (pv) { pv.style.display = 'none'; pv.innerHTML = ''; }
            const ta = document.getElementById('custom-note');
            if (ta) {
                ta.value = '';
                if (loadNoteForId && typeof loadPointDoc === 'function') {
                    loadPointDoc(loadNoteForId).then(doc => { if (doc && doc.note && editingCustomPointId === loadNoteForId) ta.value = doc.note; });
                }
            }
        }
        // Rychle chipy naposledy pouzitych kodu bodu + datalist naseptavace (historie v logika.js)
        function agRenderKodChips() {
            const dl = document.getElementById('kod-datalist'), box = document.getElementById('kod-chips'), inp = document.getElementById('custom-kod');
            if (!dl || !box || !inp || typeof window.agKodHistory !== 'function') return;
            const h = window.agKodHistory();
            dl.innerHTML = h.map(k => '<option value="' + _escHtml(k) + '">').join('');
            box.innerHTML = ''; box.style.display = h.length ? 'flex' : 'none';
            h.slice(0, 6).forEach(k => {
                const b = document.createElement('button'); b.type = 'button'; b.className = 'kod-chip'; b.textContent = k;
                b.onclick = () => { inp.value = (inp.value.trim() === k) ? '' : k; };
                box.appendChild(b);
            });
        }
        // Spolecna priprava formulare bodu: kod, chipy, tlacitko „Uložit a další", predvyplneni serie
        function agSetupPointForm(editPt, allowNext) {
            const kodInp = document.getElementById('custom-kod');
            if (kodInp) kodInp.value = (editPt && editPt.kod) ? editPt.kod : '';
            agRenderKodChips();
            const nx = document.getElementById('btn-save-next'); if (nx) nx.style.display = allowNext ? '' : 'none';
            // novy bod: predvypln dalsi cislo serie (kdo cisluje, nepise nic; kdo pojmenovava, prepise to)
            const nm = document.getElementById('custom-name');
            if (nm) {
                delete nm.dataset.agAutofill;
                if (!editPt && !nm.value && typeof window.agNextSerieName === 'function') {
                    const s = agNextSerieName();
                    // priznak „vyplnila appka“ — draft-store.js to pak nepovazuje za rozdelanou praci
                    if (s) { nm.value = s; nm.dataset.agAutofill = '1'; nm.addEventListener('input', function () { delete nm.dataset.agAutofill; }, { once: true }); }
                }
            }
        }
        function editCustomPoint(id) { const pt = persistentCustomPoints.find(p => p.id === id); if(!pt) return; editingCustomPointId = id; pendingPointAccuracy = null; { const _n = document.getElementById('custom-acc-note'); if (_n) _n.style.display = 'none'; } { const _h = document.getElementById('custom-create-helpers'); if (_h) _h.style.display = 'none'; } agSetupPointForm(pt, false); document.getElementById('custom-modal-title').innerText = "Upravit bod"; document.getElementById('custom-name').value = pt.name; let sjtsk = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]); document.getElementById('custom-y').value = Math.abs(sjtsk[0]).toFixed(2); document.getElementById('custom-x').value = Math.abs(sjtsk[1]).toFixed(2); { const _z = document.getElementById('custom-z'); if (_z) _z.value = (pt.vyska != null ? pt.vyska : ''); } resetNewPointExtras(id); document.getElementById('manage-modal').style.display = 'none'; document.getElementById('custom-modal-overlay').style.display = 'flex'; }
        // BOD Z MAPY: tlacitko v modalu spusti rezim, dalsi TAP do mapy umisti bod (tah dal posouva mapu)
        function startMapPick() {
            if (viewMode === 'ar') { agInfo("Přepni na zobrazení s mapou (Split nebo Mapa)."); return; }
            closeCustomModal(); mapAddMode = true;
            const h = document.getElementById('map-pick-hint'); if (h) h.style.display = 'flex';
            document.getElementById('map-controls').classList.remove('expanded');
        }
        function cancelMapPick() { mapAddMode = false; const h = document.getElementById('map-pick-hint'); if (h) h.style.display = 'none'; }
        function openNewPointFromMap(lat, lng) {
            editingCustomPointId = null; pendingPointAccuracy = null;
            const _n = document.getElementById('custom-acc-note'); if (_n) _n.style.display = 'none';
            { const _h = document.getElementById('custom-create-helpers'); if (_h) _h.style.display = ''; }
            document.getElementById('custom-modal-title').innerText = "Bod z mapy";
            document.getElementById('custom-name').value = '';
            let sjtsk = proj4("EPSG:4326", "EPSG:5514", [lng, lat]);
            document.getElementById('custom-y').value = Math.abs(sjtsk[0]).toFixed(2);
            document.getElementById('custom-x').value = Math.abs(sjtsk[1]).toFixed(2);
            // Výška: bod z mapy ji nezná z GPS — zkusíme ji doplnit z terénu ČÚZK DMR 5G
            // (asynchronně; když uživatel mezitím vyplní vlastní Z nebo zavře modál, nesaháme na to).
            {
                const _z = document.getElementById('custom-z');
                if (_z) {
                    _z.value = '';
                    if (typeof window.terrainElevAsync === 'function') {
                        const _ph = _z.placeholder;
                        _z.placeholder = 'zjišťuji výšku terénu…';
                        window.terrainElevAsync(lat, lng).then((elev) => {
                            _z.placeholder = _ph;
                            const ov = document.getElementById('custom-modal-overlay');
                            if (elev == null || !ov || ov.style.display === 'none' || _z.value !== '') return;
                            _z.value = elev.toFixed(2);
                            const note = document.getElementById('custom-acc-note');
                            if (note) { note.style.display = 'block'; note.innerHTML = 'Výška <b>' + elev.toFixed(2) + ' m</b> doplněna z terénu (ČÚZK DMR 5G) — orientační, uprav dle potřeby.'; }
                        }).catch(() => { try { _z.placeholder = _ph; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:openNewPointFromMap'); } });
                    }
                }
            }
            resetNewPointExtras(null);
            agSetupPointForm(null, false);   // z mapy: bez „Uložit a další" (dalsi bod = dalsi tap do mapy)
            document.getElementById('custom-modal-overlay').style.display = 'flex';
        }
        function openNewPointModal() { editingCustomPointId = null; pendingPointAccuracy = null; { const _n = document.getElementById('custom-acc-note'); if (_n) _n.style.display = 'none'; } { const _h = document.getElementById('custom-create-helpers'); if (_h) _h.style.display = ''; } document.getElementById('custom-modal-title').innerText = "Vložit bod"; document.getElementById('custom-name').value = ''; document.getElementById('custom-y').value = ''; document.getElementById('custom-x').value = ''; { const _z = document.getElementById('custom-z'); if (_z) _z.value = ''; } resetNewPointExtras(null); agSetupPointForm(null, true); document.getElementById('custom-modal-overlay').style.display = 'flex'; }
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
            const setTxt = (id, v) => { const n = document.getElementById(id); if (n) n.innerText = v; };
            const line = document.getElementById('ga-line');   // kompaktn\u00ed \u0159\u00e1dek panelu
            const warn = document.getElementById('ga-warn');   // detail je v mod\u00e1lu #gpsavg-modal
            // Ziva presnost fixu \u2014 TOTEZ cislo, co ukazuje sbalena stavova bublina.
            // Bez nej modal hlasil jen stredni chybu prumeru (mensi cislo) a vypadalo to,
            // ze appka na dvou mistech tvrdi dve jine presnosti.
            const _accNow = (typeof currentGpsAccuracy === 'number' && currentGpsAccuracy) ? currentGpsAccuracy : null;
            setTxt('ga-now', _accNow ? ('\u00b1' + (_accNow >= 10 ? _accNow.toFixed(0) : _accNow.toFixed(1)).replace('.', ',') + ' m') : '\u2014');
            if (r && r.coarse) {
                if (line) line.innerText = 's\u00ed\u0165 \u00b1' + Math.round(r.acc) + ' m';
                if (warn) { warn.style.display = 'block'; warn.innerText = 'Slab\u00fd GNSS (s\u00ed\u0165ov\u00e1 poloha \u00b1' + Math.round(r.acc) + ' m) \u2014 po\u010dkej na satelitn\u00ed fix'; }
                setTxt('ga-n', '0'); setTxt('ga-pos', '\u2026'); setTxt('ga-se', '\u2026');
                return;
            }
            if (warn) warn.style.display = 'none';
            // znacka \u2300 = stredni chyba PRUMERU (ne okamzita presnost fixu); stejne se to
            // pise v bubline i v radku \u201eStr. chyba \u2300" niz, at je to jedna vec
            if (line) line.innerText = (r && r.n >= 2) ? ('\u2300 \u00b1' + r.sterr.toFixed(2).replace('.', ',') + ' m') : 'pr\u016fm\u011bruji\u2026';
            setTxt('ga-n', (r && r.total) ? ((r.total > r.n) ? (r.n + ' (z ' + r.total + ')') : ('' + r.n)) : '0');
            setTxt('ga-pos', (r && r.n >= 2) ? ('\u00b1' + r.sterr.toFixed(2) + ' m') : '\u2026');
            setTxt('ga-se', (r && r.n >= 2) ? ('\u00b1' + r.sigma.toFixed(2) + ' m') : '\u2026');
        }

                // PODKLADY MAPY: prepinani OSM/ortofoto + pruhledny katastr (CUZK WMS). Stav v visSettings, persistuje se hned.
        function applyMapLayers() {
            const key = (visSettings.baseLayer === 'ortofoto') ? 'ortofoto' : 'osm';
            Object.keys(baseLayers).forEach(k => { if (k !== key && map.hasLayer(baseLayers[k])) map.removeLayer(baseLayers[k]); });
            if (!map.hasLayer(baseLayers[key])) baseLayers[key].addTo(map);
            if (visSettings.showKatastr) { if (!map.hasLayer(katastrLayer)) katastrLayer.addTo(map); } else if (map.hasLayer(katastrLayer)) map.removeLayer(katastrLayer);
            // TMAVA MAPA: trida na #map rika CSS, ze podklad je OSM — v tmavem motivu se
            // dlazdice invertuji (bily podklad by v noci/Split rezimu oslnoval). Ortofoto se nefiltruje.
            const _mapEl = document.getElementById('map'); if (_mapEl) _mapEl.classList.toggle('base-osm', key === 'osm');
            const bb = document.getElementById('btn-baselayer'), kb = document.getElementById('btn-katastr');
            if (bb) bb.classList.toggle('ctrl-active', visSettings.baseLayer === 'ortofoto');
            if (kb) kb.classList.toggle('ctrl-active', !!visSettings.showKatastr);
        }
        function cycleBaseLayer() { visSettings.baseLayer = (visSettings.baseLayer === 'ortofoto') ? 'osm' : 'ortofoto'; setStoredData('arVisSettings12', JSON.stringify(visSettings)); applyMapLayers(); }
        function toggleKatastr() { visSettings.showKatastr = !visSettings.showKatastr; setStoredData('arVisSettings12', JSON.stringify(visSettings)); applyMapLayers(); }
        // Vyjizdejici panel ovladani mapy: sbaleno = jen prepinaci tlacitko
        function toggleMapControls() { document.getElementById('map-controls').classList.toggle('expanded'); }

        const arOverlay = document.getElementById('ar-overlay');
        // Badge „+N" u sbalených shluků AR značek. Zapisuje do DOM jen při ZMĚNĚ počtu
        // a prochází jen značky umístěné v tomto snímku + hostitele z minulého snímku
        // (arPoints jich může být tisíce — celý průchod každý snímek by byl drahý).
        let _prevHosts = [];
        function _setMore(pt, n) {
            if (!pt || !pt.moreElement || pt._moreN === n) return;
            pt._moreN = n;
            pt.moreElement.textContent = n ? ('+' + n) : '';
            pt.moreElement.style.display = n ? 'block' : 'none';
        }
        function _updateMoreBadges(placed) {
            const hosts = [];
            placed.forEach(q => { const n = (q.pt._arCluster && q.pt._arCluster.length) || 0; _setMore(q.pt, n); if (n) hosts.push(q.pt); });
            _prevHosts.forEach(pt => { if (hosts.indexOf(pt) < 0) _setMore(pt, 0); });
            _prevHosts = hosts;
        }
        // CHYBA (opraveno): renderAR si kvuli vykonu pamatuje posledni zapsanou opacity /
        // zIndex / text vzdalenosti / transform v pt._opLast, _zLast, _dLast, _tfLast a
        // prepisuje je jen pri zmene. Kdyz se ale element znicil a postavil znovu
        // (hromadne operace nad body -> _mngAfterEdit), cache si drzela stare hodnoty,
        // zatimco novy element startuje s opacity:0 -> podminka `_opLast !== '1'`
        // neprosla a znacka upravenych bodu zustala v AR NEVIDITELNA az do restartu.
        // Cache proto pri zniceni/vytvoreni elementu vzdy vynulujeme.
        function _resetPtRenderCache(pt) {
            pt._opLast = null; pt._zLast = null; pt._dLast = null; pt._tfLast = null;
        }
        let _arInitRetryAt = 0;   // skrceni dohanenu chybejicich AR elementu (viz renderAR)
        function initARMarkers() {
            arPoints.forEach((pt) => {
              try {
                if (!pt || pt.lat == null || pt.lng == null) return;   // rozbity zaznam preskocit
                if (typeof pt.cat !== 'string' || !pt.cat) pt.cat = 'CUSTOM';
                let matchesSearch = true; if (searchQuery && !pt.name.toLowerCase().includes(searchQuery.toLowerCase())) { matchesSearch = false; }
                let outOfReach = (pt.currentDist > arRadius); let isSelectedForDetail = (pt.id === activePointIdForModal);
                if (pt.hidden || !matchesSearch || (outOfReach && pt.id !== highlightedPointId && !isSelectedForDetail)) { if (pt.element && pt.element.parentNode) pt.element.parentNode.removeChild(pt.element); return; }
                if (!pt.element) { _resetPtRenderCache(pt); const marker = document.createElement('div'); marker.className = `ar-marker cat-${String(pt.cat).toLowerCase()}${agZHodinek(pt) ? ' src-watch' : ''}`; if (pt.id === highlightedPointId) marker.classList.add('highlighted'); if (window.isStaked && isStaked(pt.id)) marker.classList.add('staked'); marker.style.opacity = '0'; const title = document.createElement('div'); title.className = 'ar-marker-title'; title.innerText = pt.name; const dist = document.createElement('div'); dist.className = 'ar-marker-dist'; const more = document.createElement('div'); more.className = 'ar-marker-more'; marker.appendChild(title); marker.appendChild(dist); marker.appendChild(more); marker.addEventListener('click', () => { if (pt._arCluster && pt._arCluster.length) { showClusterList([pt].concat(pt._arCluster)); return; } const currentDist = getDistance(userLat, userLng, pt.lat, pt.lng); showDetails(pt, currentDist); }); pt.element = marker; pt.distElement = dist; pt.moreElement = more; arOverlay.appendChild(marker); } else if (!pt.element.parentNode) { arOverlay.appendChild(pt.element); }
              } catch (e) { /* jeden rozbity bod nesmi zabit smycku ani drawAllMarkersOnMap() volane za ni */ }
            });
        }
        let mapReturnTimer;
        // SLEDOVANI POLOHY V MAPE
        // Driv: jakykoli posun mapy se po 5 s sam vratil na uzivatele. Kdyz si clovek
        // prohlizel vzdalenejsi cast zakazky a na chvili sundal prst, mapa mu uskocila
        // zpatky — bez varovani a bez moznosti to vypnout. Ted posun sledovani VYPNE
        // a mapa zustane, kde je; zpatky ji vrati tlacitko "Na me" (#map-recenter),
        // ktere se prave kvuli tomu objevi. Stav drzi window._mapHold (true = mapa
        // nesleduje). Je to accessor, takze tlacitko reaguje i na moduly, ktere si
        // _mapHold nastavuji samy (napr. "Ukazat cil" v js/cil-navigace.js).
        let _mapHoldVal = false;
        try {
            Object.defineProperty(window, '_mapHold', {
                configurable: true,
                get: function () { return _mapHoldVal; },
                set: function (v) { v = !!v; if (v === _mapHoldVal) return; _mapHoldVal = v; agUpdateRecenterBtn(); }
            });
        } catch (e) { /* kdyby uz vlastnost nesla predefinovat, jede se jako driv */ }
        function agUpdateRecenterBtn() {
            const b = document.getElementById('map-recenter');
            // ZAMERNE bez podminky na GPS fix: kdyz uzivatel posune mapu jeste pred
            // prvnim fixem, tlacitko musi byt vidma — jinak by uz sledovani nezapnul.
            // recenterOnUser() bez fixu jen obnovi sledovani a mapa doskoci na prvni poloze.
            if (b) b.classList.toggle('on', !!_mapHoldVal);
        }
        function recenterOnUser() { clearTimeout(mapReturnTimer); window._mapHold = false; agUpdateRecenterBtn(); if (userLat == null) return; map.setView([userLat, userLng], map.getZoom(), { animate: true }); lastCenterLat = userLat; lastCenterLng = userLng; }
        // OVLADANI MAPY: jeden prst = posun (obsah sleduje prst i pri otocene mape), dva prsty = plynuly zoom (pinch).
        map.options.zoomSnap = 0;  // plynuly pinch zoom (zlomkove stupne); kdyby logika.js byla stara, vynutime to i tady
        // mapRotation = uhel SKUTECNE aplikovany na mapu. Behem rucniho posunu (window._mapHold)
        // se rotace zmrazi -- otaceni kolem uzivatele mimo stred by mapou smykalo po obrazovce.
        // Klikani i posun prepocitavaji souradnice pres mapRotation, ne pres zivy currentHeading.
        let mapRotation = 0;
        // poloha, pro kterou je nastaveny transform-origin rotace mapy (viz renderAR)
        let _mrLat = null, _mrLng = null;
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
        // ===== MĚŘENÍ DVĚMA PRSTY (styl mapy.cz) ==================================
        // Podrž dva prsty na mapě ~0,5 s BEZ roztahování → mezi prsty se natáhne čára
        // se vzdáleností a sleduje prsty. Pinch zoom funguje beze změny — měření se
        // aktivuje jen, když prsty zůstanou v klidu. Po zvednutí prstů výsledek chvíli
        // svítí (jde přečíst) a sám zmizí.
        const TFM_HOLD_MS = 500, TFM_PINCH_TOL = 26, TFM_MOVE_TOL = 22, TFM_FADE_MS = 4000;
        let _tfm = null, _tfmLine = null, _tfmLabel = null, _tfmFade = null;
        function _tfmFmt(m) { if (m >= 1000) return (m / 1000).toFixed(2).replace('.', ',') + ' km'; if (m >= 100) return Math.round(m) + ' m'; return m.toFixed(1).replace('.', ',') + ' m'; }
        function _tfmClear() { clearTimeout(_tfmFade); _tfmFade = null; if (_tfmLine) { try { map.removeLayer(_tfmLine); } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'grafika:_tfmClear'); } _tfmLine = null; } if (_tfmLabel) { try { map.removeLayer(_tfmLabel); } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'grafika:_tfmClear'); } _tfmLabel = null; } }
        function _tfmSnap(t) { return [{ clientX: t[0].clientX, clientY: t[0].clientY }, { clientX: t[1].clientX, clientY: t[1].clientY }]; }
        function _tfmUpdate(t) {
            if (!t) return;
            const a = window.agScreenToLatLng(t[0].clientX, t[0].clientY), b = window.agScreenToLatLng(t[1].clientX, t[1].clientY);
            if (!a || !b) return;
            const dist = getDistance(a.lat, a.lng, b.lat, b.lng);
            if (!_tfmLine) _tfmLine = L.polyline([a, b], { color: '#fbbf24', weight: 3, dashArray: '7,7', interactive: false }).addTo(map);
            else _tfmLine.setLatLngs([a, b]);
            const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
            // štítek se srovnává proti otočení mapy (stejný trik jako popupy), ať je text vodorovně
            const icon = L.divIcon({ className: 'tfm-label-wrap', html: '<div class="tfm-label" style="transform:translate(-50%,-50%) rotate(' + mapRotation + 'deg);">' + _tfmFmt(dist) + '</div>', iconSize: [0, 0] });
            if (!_tfmLabel) _tfmLabel = L.marker(mid, { icon: icon, interactive: false, zIndexOffset: 2000 }).addTo(map);
            else { _tfmLabel.setLatLng(mid); _tfmLabel.setIcon(icon); }
        }
        function _tfmStart(touches) {
            clearTimeout(_tfm && _tfm.timer); _tfmClear();
            const s = _tfmSnap(touches);
            _tfm = { d0: _touchDist(touches), start: s, last: s, active: false, zoomed: false, timer: null };
            _tfm.timer = setTimeout(() => { if (_tfm && !_tfm.zoomed) { _tfm.active = true; _tfmUpdate(_tfm.last); } }, TFM_HOLD_MS);
        }
        function _tfmEnd() {
            if (!_tfm) return;
            clearTimeout(_tfm.timer);
            if (_tfm.active) { clearTimeout(_tfmFade); _tfmFade = setTimeout(_tfmClear, TFM_FADE_MS); } // výsledek nech chvíli svítit
            _tfm = null;
        }
        // ==========================================================================
        mapContainerEl.addEventListener('touchstart', (e) => {
            // #map-controls = panel Mapa a vrstvy; jeho vlastní scroll nesmí hýbat mapou
            if (e.target.closest('.glass-panel, .leaflet-popup, #map-controls')) return;
            clearTimeout(mapReturnTimer);
            // (Dříve se tu mapová tlačítka hned sbalila při každém doteku mapy — bylo to
            //  matoucí „všechno zmizí". Sbalení teď řídí jen přepínač, ne dotek mapy.)
            if (e.touches.length >= 2) { isPinchingMap = true; isDraggingMap = false; pinchStartDist = _touchDist(e.touches); pinchStartZoom = map.getZoom(); _tfmStart(e.touches); }
            else if (e.touches.length === 1) { isDraggingMap = true; isPinchingMap = false; lastTouchX = e.touches[0].clientX; lastTouchY = e.touches[0].clientY; }
        }, { passive: true });
        mapContainerEl.addEventListener('touchmove', (e) => {
            // dotyk zacinajici na popupu (napr. 'Vzdalena oblast') nebo v panelu vrstev
            // patri jim, ne mape -- jinak tah po nich hybe mapou a preventDefault
            // rusi klik na tlacitka i scrollovani seznamu
            if (e.target.closest('.glass-panel, .leaflet-popup, #map-controls')) return;
            if (e.touches.length >= 2) {
                if (!isPinchingMap) { isPinchingMap = true; isDraggingMap = false; pinchStartDist = _touchDist(e.touches); pinchStartZoom = map.getZoom(); _tfmStart(e.touches); }
                window._mapHold = true;
                const d = _touchDist(e.touches);
                if (_tfm) {
                    _tfm.last = _tfmSnap(e.touches);
                    if (_tfm.active) { _tfmUpdate(_tfm.last); if (e.cancelable) e.preventDefault(); return; } // měřím → žádný zoom
                    if (!_tfm.zoomed) {
                        const m0 = Math.hypot(_tfm.last[0].clientX - _tfm.start[0].clientX, _tfm.last[0].clientY - _tfm.start[0].clientY);
                        const m1 = Math.hypot(_tfm.last[1].clientX - _tfm.start[1].clientX, _tfm.last[1].clientY - _tfm.start[1].clientY);
                        if (Math.abs(d - _tfm.d0) > TFM_PINCH_TOL || m0 > TFM_MOVE_TOL || m1 > TFM_MOVE_TOL) { _tfm.zoomed = true; clearTimeout(_tfm.timer); } // uživatel zoomuje → měření nebude
                    }
                }
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
            if (e.touches.length < 2) _tfmEnd();   // konec gesta dvou prstů (výsledek měření dosvítí sám)
            // ZADNY automaticky navrat po 5 s — mapa zustane tam, kam ji uzivatel dal.
            // Misto toho se ukaze tlacitko "Na me" (viz recenterOnUser vyse).
            if (e.touches.length === 0) { if (isDraggingMap || isPinchingMap || window._mapHold) { clearTimeout(mapReturnTimer); agUpdateRecenterBtn(); } isDraggingMap = false; isPinchingMap = false; }
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
                el.innerHTML = '<div style="width:min(82vw,320px); padding:22px; border-radius:18px; background:rgba(14,18,24,0.96); border:1px solid rgba(255,255,255,0.12); box-shadow:0 20px 50px rgba(0,0,0,0.5); text-align:center; color:#fff;"><div id="offline-progress-title" style="font-size:calc(14.5px * var(--ag-font-scale, 1)); font-weight:700; margin-bottom:14px;">Stahuji\u2026</div><div style="width:100%; height:10px; background:rgba(255,255,255,0.12); border-radius:99px; overflow:hidden;"><div id="offline-progress-bar" style="height:100%; width:0%; background:var(--accent-grad,#34d399); border-radius:99px; transition:width 0.15s linear;"></div></div><div id="offline-progress-txt" style="margin-top:10px; font-size:calc(12px * var(--ag-font-scale, 1)); color:var(--accent-bright,#3eb487); font-family:var(--font-mono,monospace);">0 %</div></div>';
                document.body.appendChild(el);
            }
            return el;
        }
        let _offlineProgUnit = 'd\u00edlk\u016f';
        function showOfflineProgress(done, total, label, unit) { const el = _ensureOfflineProgress(); el.style.display = 'flex'; _offlineProgUnit = unit || 'd\u00edlk\u016f'; const ti = document.getElementById('offline-progress-title'); if (ti) ti.innerText = label || 'Stahuji mapu pro offline\u2026'; updateOfflineProgress(done, total); }
        function updateOfflineProgress(done, total) { const pct = total > 0 ? Math.round(done / total * 100) : 0; const bar = document.getElementById('offline-progress-bar'); if (bar) bar.style.width = pct + '%'; const txt = document.getElementById('offline-progress-txt'); if (txt) txt.innerText = pct + ' % \u00b7 ' + done + ' / ' + total + ' ' + _offlineProgUnit; }
        function hideOfflineProgress() { const el = document.getElementById('offline-progress'); if (el) el.style.display = 'none'; } 

        function showDetails(pt, distance) {
            // GUARD: přes otevřené menu „Více" nebo jakýkoli modál (Nastavení, Nástroje…)
            // se karta bodu NEOTEVÍRÁ. Řeší „potáhnu prstem v Nastavení a zespodu vyjede
            // tabulka bodu" — dotyk propadl na AR značku pod modálem.
            try {
                var _sm = document.getElementById('side-menu');
                if (_sm && _sm.classList.contains('open')) return;
                var _ovs = document.querySelectorAll('.modal-overlay');
                for (var _i = 0; _i < _ovs.length; _i++) { if (_ovs[_i].style.display === 'flex') return; }
                if (document.getElementById('welcome-screen') && document.getElementById('welcome-screen').style.display !== 'none' && !document.body.classList.contains('app-started')) return;
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:showDetails'); }
            activePointIdForModal = pt.id; initARMarkers(); arPoints.forEach(p => { if (p.element) p.element.classList.remove('active-reading'); }); if (pt.element) pt.element.classList.add('active-reading');
            let typBodu = "Podrobný polohový bod"; if(pt.cat === 'TB') typBodu = "Trigonometrický bod"; if(pt.cat === 'ZHB') typBodu = "Zhušťovací bod"; if(pt.cat === 'NIVEL') typBodu = "Nivelační / Výškový bod"; if(pt.cat === 'CUSTOM') typBodu = "Vlastní zadaný bod";
            document.getElementById('det-title').innerHTML = `#${_escHtml(pt.name)}`; document.getElementById('det-title').style.color = "var(--accent)"; document.getElementById('det-subtitle').innerHTML = typBodu; 
            const hlBtn = document.getElementById('highlight-btn'); if (highlightedPointId === pt.id) { hlBtn.innerHTML = '<svg class="icon"><use href="#i-star"/></svg><span>Nezvýraznit</span>'; hlBtn.style.background = "#fff"; } else { hlBtn.innerHTML = '<svg class="icon"><use href="#i-star"/></svg><span>Zvýraznit</span>'; hlBtn.style.background = "#fbbf24"; }
            hideBtnLogic = () => { pt.hidden = true; if(pt.element) { pt.element.style.opacity = '0'; setTimeout(() => { if(pt.element && pt.element.parentNode) pt.element.parentNode.removeChild(pt.element); }, 200); } if (highlightedPointId === pt.id) { highlightedPointId = null; document.getElementById('ar-hud').style.display = 'none'; } updateInfoPanel(); drawAllMarkersOnMap(); };
            let sjtskY = "Neznámé", sjtskX = "Neznámé"; if (pt.type === "custom") { let sjtsk = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]); sjtskY = Math.abs(sjtsk[0]).toFixed(2); sjtskX = Math.abs(sjtsk[1]).toFixed(2); } else if (pt.rawData) { const getVal = (keys) => { for (let k in pt.rawData) { if (keys.includes(k.toUpperCase()) && pt.rawData[k] !== "Null" && pt.rawData[k] !== null && String(pt.rawData[k]).trim() !== "") return pt.rawData[k]; } return null; }; let sY = parseFloat(getVal(['Y', 'SOURADNICE_Y'])); let sX = parseFloat(getVal(['X', 'SOURADNICE_X'])); if (!isNaN(sY) && !isNaN(sX)) { if (sY < sX) { sjtskY = sY; sjtskX = sX; } else { sjtskY = sX; sjtskX = sY; } } }
            let html = ` <div class="geo-data-row"><span class="geo-label">Vzdálenost</span><span class="geo-value" id="sheet-distance-val">${distance.toFixed(1)} m</span></div> <div class="geo-data-row"><span class="geo-label">S-JTSK Y</span><span class="geo-value">${sjtskY}</span></div> <div class="geo-data-row"><span class="geo-label">S-JTSK X</span><span class="geo-value">${sjtskX}</span></div> ${pt.vyska != null ? '<div class="geo-data-row"><span class="geo-label">Výška Bpv</span><span class="geo-value">' + Number(pt.vyska).toFixed(2) + ' m</span></div>' : ''} ${pt.kod ? '<div class="geo-data-row"><span class="geo-label">Kód bodu</span><span class="geo-value">' + _escHtml(pt.kod) + '</span></div>' : ''} <div style="margin-top:15px; padding:12px; background:rgba(251,191,36,0.1); border-left:4px solid #fbbf24; border-radius:8px; font-size:calc(13px * var(--ag-font-scale, 1)); line-height:1.4;"><strong><svg class="icon" style="vertical-align:-0.18em; color:#fbbf24;"><use href="#i-alert"/></svg> Rádius hledání (Vaše GPS: ±<span id="sheet-gps-val">${currentGpsAccuracy.toFixed(1)}</span> m)</strong><br>Bod nehledejte na centimetr přesně na AR značce. Může ležet kdekoliv v tomto kruhovém okruhu od značky.</div> `;
            if (pt.type === "custom") { html += `<div style="text-align:center; padding: 25px 0; opacity:0.6; font-style:italic;">Ručně vytvořený bod. Můžete jej spravovat v Nastavení.</div>`; } else if (pt.rawData) { const props = pt.rawData; const getVal = (keys) => { for (let k in props) { if (keys.includes(k.toUpperCase()) && props[k] !== "Null" && props[k] !== null && String(props[k]).trim() !== "") return props[k]; } return null; }; const stabilizace = getVal(['STABILIZACE', 'TYP_ZNAK', 'TYP_ZNAKU', 'ZNAK', 'POPIS_ZNAKU']); const vyska = getVal(['VYSKA_NAD_TERENEM', 'VYSKA_ZNAKU', 'UMISTENI']); let nadmRaw = getVal(['VYSKA_BPV','NADMORSKA_VYSKA','VYSKA_BODU','VYSKA_H','H_BPV','VYSKA','H','Z']); let nadmNum = parseFloat(String(nadmRaw).replace(',', '.')); let nadmVyska = (!isNaN(nadmNum) && nadmNum > 50 && nadmNum < 3000) ? nadmNum : null; let geodataLink = null; for (let k in props) { if (typeof props[k] === 'string' && props[k].startsWith('http')) { geodataLink = props[k]; break; } } if (stabilizace || vyska !== null || nadmVyska !== null) { html += `<div class="geo-highlight" style="border-left-color: var(--accent);">`; if (nadmVyska !== null) html += `<div class="geo-data-row" style="border:none; padding: 4px 0;"><span class="geo-label" style="color:var(--text-color);">Nadmořská výška (Bpv):</span><span class="geo-value">${nadmVyska.toFixed(2)} m</span></div>`; if (stabilizace) html += `<div class="geo-data-row" style="border:none; padding: 4px 0;"><span class="geo-label" style="color:var(--text-color);">Stabilizace:</span><span class="geo-value">${_escHtml(stabilizace)}</span></div>`; if (vyska !== null) html += `<div class="geo-data-row" style="border:none; padding: 4px 0;"><span class="geo-label" style="color:var(--text-color);">Výška n. terénem:</span><span class="geo-value">${_escHtml(vyska)} m</span></div>`; html += `</div>`; } if (geodataLink) html += `<a href="${_escHtml(geodataLink)}" target="_blank" class="btn-link"><svg class="icon"><use href="#i-file-text"/></svg> Otevřít nákres (Polohopis)</a>`; html += `<details><summary>Zobrazit všechny úřední záznamy</summary><div style="margin-top:10px;">`; for (let key in pt.rawData) { if (pt.rawData[key] && pt.rawData[key] !== "Null" && key !== "OBJECTID" && key !== "SHAPE") { let cleanKey = key.replace(/_/g, ' '); cleanKey = cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1); html += `<div class="geo-data-row"><span class="geo-label">${_escHtml(cleanKey)}</span><span class="geo-value" style="font-weight:400;">${_escHtml(pt.rawData[key])}</span></div>`; } } html += `</div></details>`; }
            document.getElementById('det-body').innerHTML = html; document.getElementById('bottom-sheet').classList.add('open');
        }
        const mapWrapper = document.getElementById('map-wrapper'); const compassDebug = document.getElementById('compass-debug');
        // VYKON: HUD prvky ziskame JEN JEDNOU (drive se hledaly pres getElementById kazdy snimek -> ~1000 lookupu/s)
        // POZOR: znacka uzivatele (#user-direction-container) vznika az s prvnim GPS fixem
        // (userMarker ve watchPosition) — pri nacteni skriptu jeste NEEXISTUJE. Musi se tedy
        // dohledat lize (jinak by se sipka uzivatele na mape nikdy neotacela podle kompasu).
        let userDirContainer = null;
        function getUserDirContainer() {
            if (!userDirContainer || !userDirContainer.isConnected) userDirContainer = document.getElementById('user-direction-container');
            return userDirContainer;
        }
        const arHud = document.getElementById('ar-hud'), arHudName = document.getElementById('ar-hud-name'), arHudDist = document.getElementById('ar-hud-dist'), arHudInfo = document.getElementById('ar-hud-info'), arHudArrowContainer = document.getElementById('ar-hud-arrow-container');
        const arrTarget = document.getElementById('arrow-target'), arrStraight = document.getElementById('arrow-straight'), arrLeft = document.getElementById('arrow-left'), arrRight = document.getElementById('arrow-right'), arrUturn = document.getElementById('arrow-uturn'), arrBull = document.getElementById('arrow-bullseye');
        let _lastCdHtml = '', _lastCdTitle = '';   // posledni text azimutu — prekreslit jen pri zmene
        // VYKON: udalosti senzoru chodi i 60+x/s; prekreslujeme max 1x za snimek (requestAnimationFrame)
        // BATERIE: k tomu STROP ~30 snimku/s. Kazdy pruchod renderAR projde vsechny arPoints,
        // spocita declutter stitku a prepise transformy — pri 60 Hz kompasu to bylo 2x tolik
        // prace, nez ma smysl: obraz z kamery pod znackami bezi na 30 fps (viz CAM_VIDEO), takze
        // rychlejsi prekreslovani stitku uz neni na cem videt. Filtr smeru je dt-normalizovany
        // (smoothAlpha nize), takze se zmenou frekvence se chovani kompasu NEmeni.
        // Razitkuje se cas PRIJETI udalosti, ne cas vykresleni — kdyby se merilo az po rAF,
        // odectel by se i cas cekani na vsync a stropem by proslo jen ~20 snimku/s.
        const AR_MIN_FRAME_MS = 30;
        let _orientPending = false, _lastOrientEvent = null, _lastArFrameTs = 0;
        function handleOrientation(event) {
            // absolutní zdroj funguje? (viz _absSeen u startCompass — rozhoduje o tom,
            // jestli se vůbec musí navěsit i relativní 'deviceorientation')
            if (!_absSeen && event && event.absolute === true && event.alpha != null) _absSeen = true;
            _lastOrientEvent = event; if (_calibActive) trackCalibMotion(event);
            if (_orientPending) return;
            // Zahozeny snimek nic neztrati: _lastOrientEvent je uz prepsany, takze dalsi
            // propusteny snimek kresli z NEJCERSTVEJSI udalosti. Kdyby udalosti prestaly
            // chodit uplne, dorovna to watchdog nize (250 ms).
            const _nowFr = performance.now();
            if (_nowFr - _lastArFrameTs < AR_MIN_FRAME_MS) return;
            _lastArFrameTs = _nowFr;
            _orientPending = true;
            requestAnimationFrame(() => { _orientPending = false; renderAR(_lastOrientEvent); });
        }
        let _haveAbsoluteHeading = false;
        // STABILITA: watchdog render smycky - casy posledniho vykresleni a posledni platne udalosti
        let _lastRenderTs = 0, _lastGoodEvent = null, _lastAbsoluteTs = 0;
        function renderAR(event) {
            if (!userLat || !userLng) return;
            // #1 AGPose: origin AR = zakotvené stanovisko (resekce) když platné, jinak syrová GPS.
            const _oLat = (window.AGPose && window.AGPose.valid && window.AGPose.originLat != null) ? window.AGPose.originLat : userLat;
            const _oLng = (window.AGPose && window.AGPose.valid && window.AGPose.originLng != null) ? window.AGPose.originLng : userLng;
            // ZDROJ AZIMUTU:
            // iOS: webkitCompassHeading je uz vztazeny k PRAVEMU severu (deklinaci resi OS) -> NEpridavat deklinaci.
            // Android: event.alpha je magneticky, spolehlivy jen kdyz event.absolute (deviceorientationabsolute);
            //          plain deviceorientation je relativni k orientaci pri startu -> mohlo by hodit sever o desitky stupnu.
            let rawCompass = null, headingIsTrueNorth = false, headingReliable = true;
            if (typeof event.webkitCompassHeading === 'number' && !isNaN(event.webkitCompassHeading)) {
                rawCompass = event.webkitCompassHeading; headingIsTrueNorth = true; headingReliable = true;
            } else if (event.alpha != null) {
                if (event.absolute === true) { _haveAbsoluteHeading = true; _lastAbsoluteTs = performance.now(); }
                // kdyz uz mame absolutni zdroj, ignoruj relativni udalosti (jinak by se sever rozhazel);
                // ALE kdyz absolutni zdroj prestal chodit (>2 s), radeji degraduj na relativni nez zamrznout
                if (_haveAbsoluteHeading && event.absolute !== true) {
                    if (performance.now() - _lastAbsoluteTs < 2000) return;
                    headingReliable = false;
                }
                // TILT-KOMPENZACE (Android): azimut směru ZADNÍ KAMERY z plné rotační
                // matice (α,β,γ). Vzorec 360−alpha platí jen pro telefon naplocho —
                // ve svislé AR poloze (beta~90°) je alpha v gimbal locku a heading
                // ujíždí se sklonem. Kamera je pevná v telefonu, takže tahle cesta
                // nepotřebuje ani kompenzaci orientace displeje (landscape).
                let _dr = Math.PI / 180;
                let _cZ = Math.cos(event.alpha * _dr), _sZ = Math.sin(event.alpha * _dr);
                let _cX = Math.cos((event.beta || 0) * _dr), _sX = Math.sin((event.beta || 0) * _dr);
                let _cY = Math.cos((event.gamma || 0) * _dr), _sY = Math.sin((event.gamma || 0) * _dr);
                let _Vx = -_cZ * _sY - _sZ * _sX * _cY;   // East složka směru kamery
                let _Vy = -_sZ * _sY + _cZ * _sX * _cY;   // North složka
                if (event.beta != null && event.gamma != null && Math.hypot(_Vx, _Vy) > 0.35) {
                    rawCompass = (Math.atan2(_Vx, _Vy) / _dr + 360) % 360;
                } else {
                    // telefon naplocho (mapa v ruce): kamera míří k zemi -> starý vzorec z alpha
                    let so = 0;
                    if (window.screen && screen.orientation && typeof screen.orientation.angle === 'number') so = screen.orientation.angle;
                    else if (typeof window.orientation === 'number') so = window.orientation;
                    rawCompass = ((360 - event.alpha) + so + 360) % 360; // kompenzace orientace displeje (landscape ±90°)
                }
                headingReliable = (event.absolute === true);
            }
            if (rawCompass === null) return;
            _lastRenderTs = performance.now(); _lastGoodEvent = event;   // pro watchdog: posledni udalost s platnym smerem
            // SMER: volitelna auto-korekce magnetickeho kompasu podle GPS kurzu (jen pri jednoznacnem pohybu).
            // GPS kurz je za chuze nespolehlivy, proto vysoky prah rychlosti a strop korekce ±25°.
            if (visSettings.autoCompassCorrection && !headingIsTrueNorth && gpsCourse !== null && gpsSpeed > 1.4) {
                let want = angDiff(gpsCourse, rawCompass + magneticDeclination);
                headingCorrection += 0.03 * angDiff(want, headingCorrection);
                if (headingCorrection > 25) headingCorrection = 25; else if (headingCorrection < -25) headingCorrection = -25;
            }
            let corrected = (rawCompass + (headingIsTrueNorth ? 0 : magneticDeclination) + headingCorrection + userHeadingOffset + 360) % 360;
            // SMER: cyklicke vyhlazeni (mene roztreseny obraz); sila dle nastaveni.
            // dt-NORMALIZACE: udalosti nechodi vzdy v 60 Hz — konstantni zisk per-event by
            // menil casovou konstantu filtru s frekvenci. alphaEff = 1 - exp(-dt/tau),
            // tau zvoleno tak, aby pri 60 Hz odpovidalo puvodnimu chovani.
            let _alpha0 = Math.max(0.05, 1 - (visSettings.headingSmoothing || 0) / 100);
            let _nowOri = performance.now();
            let _dtOri = Math.min(0.25, Math.max(0.004, (window._lastOriTs ? (_nowOri - window._lastOriTs) : 16.7) / 1000));
            window._lastOriTs = _nowOri;
            let _tau = -(1 / 60) / Math.log(1 - Math.min(0.95, _alpha0));
            let smoothAlpha = 1 - Math.exp(-_dtOri / _tau);
            if (window.ARFusion && window.ARFusion.enabled) { smoothedHeading = window.ARFusion.fuse(corrected, smoothedHeading, event); } else { smoothedHeading = smoothAngle(smoothedHeading, corrected, smoothAlpha); }
            let heading = smoothedHeading; currentHeading = heading;
            // #2 vizuální stabilizace: krátkodobá drift-free korekce směru z optického toku/WebXR (default vypnuto, decayuje k senzoru)
            window._sensorHeadingRaw = smoothedHeading;   // #4: SYROVÝ senzorový směr PŘED korekcí — modul ho čte jako referenci, ne vlastní výstup (jinak nestabilní filtr)
            if (window.AGVisualTrack && window.AGVisualTrack.enabled) { var _vc = window.AGVisualTrack.getCorrection(); if (_vc && _vc.dyaw != null) { heading = ((heading + _vc.dyaw) % 360 + 360) % 360; currentHeading = heading; } }
            let relativeHeadingDeg = (heading - compassZeroOffset + 360) % 360; let displayAzimut = "";
            if (compassUnit === 'gon') { let gonTotal = relativeHeadingDeg * (400 / 360); let grad = Math.floor(gonTotal); let centigrad = Math.floor((gonTotal - grad) * 100); displayAzimut = `${grad}<sup>g</sup> ${centigrad.toString().padStart(2, '0')}<sup>c</sup>`; } else { displayAzimut = `${relativeHeadingDeg.toFixed(1)} °`; }
            let cAcc = event.webkitCompassAccuracy; let calWarn = (cAcc != null && (cAcc < 0 || cAcc > 20)) || !headingReliable;
            // VYKON: innerHTML/title prepisujeme jen kdyz se text opravdu zmenil (ne 60/s)
            const _cdHtml = `<span class="hud-k">AZ</span> ${displayAzimut}` + (calWarn ? ' <span style="color:var(--warning);">⚠</span>' : '');
            if (_cdHtml !== _lastCdHtml) { compassDebug.innerHTML = _cdHtml; _lastCdHtml = _cdHtml; }
            const _cdTitle = !headingReliable ? 'Zařízení neposkytuje absolutní azimut – sever může být nepřesný. Dolaďte v Nastavení kompasu „Srovnání severu".' : (calWarn ? 'Kompas vyzaduje kalibraci – proveďte telefonem osmicku' : '');
            if (_cdTitle !== _lastCdTitle) { compassDebug.title = _cdTitle; _lastCdTitle = _cdTitle; }
            // BATERIE: v rezimu "AR" ma #map-container display:none a #map-wrapper je uvnitr nej,
            // takze cela rotace mapy (latLngToContainerPoint + transform vrstvy 150vmax + zapis
            // transformu na KAZDY popisek) se 60x/s pocitala pro neco, co neni videt. Pri navratu
            // do Split/Mapy se dorovna hned na dalsim snimku kompasu: mapRotation zustava rovna
            // uhlu, ktery je na wrapperu skutecne aplikovany, a _labelsDirty se nezahazuje —
            // podminka nize ho vezme v potaz.
            const _mapVisible = (typeof viewMode === 'undefined' || viewMode !== 'ar');
            if (_mapVisible && !window._mapHold && !window._popupOpen) {
                // VYKON: #map-wrapper je vrstva 150vmax x 150vmax (nekolikanasobek displeje) —
                // rotace prekomponuje celou vrstvu vcetne dlazdic a k tomu se prepisuje
                // transform na KAZDEM popisku bodu. Zmena pod 0.15 deg je na displeji
                // nerozeznatelna, takze takovy snimek preskocime. Origin prepocitavame i pri
                // posunu uzivatele, aby se mapa dal otacela kolem spravneho bodu.
                // OTACENI MAPY: js/map-rotate.js muze rotaci zamknout (sever nahore / zmrazeny
                // smer). Bez toho modulu se pouzije zivy heading = puvodni chovani.
                const _mapHdg = (window.AGMapRot && window.AGMapRot.mapHeading) ? window.AGMapRot.mapHeading(heading) : heading;
                const _rotD = Math.abs(((_mapHdg - mapRotation + 540) % 360) - 180);
                if (_rotD >= 0.15 || _mrLat !== userLat || _mrLng !== userLng || window._labelsDirty) {
                    mapWrapper.style.transformOrigin = (function(){ const p = map.latLngToContainerPoint([userLat, userLng]); return p.x + 'px ' + p.y + 'px'; })(); mapWrapper.style.transform = `translate(-50%, -50%) rotate(${-_mapHdg}deg)`; mapRotation = _mapHdg;
                    _mrLat = userLat; _mrLng = userLng;
                    if (window._labelsDirty) { window._mapLabelEls = document.querySelectorAll('.map-label-text'); window._labelsDirty = false; }
                    if (window._mapLabelEls) window._mapLabelEls.forEach(el => { el.style.transform = `rotate(${_mapHdg}deg)`; });
                }
            }
            // sipka smeru uzivatele je taky jen v mape (Leaflet divIcon) — v AR ji nikdo nevidi
            if (_mapVisible) { const _udc = getUserDirContainer(); if (_udc) _udc.style.transform = `rotate(${heading}deg)`; }
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
            // #2 vizuální stabilizace: korekce sklonu ze stejného zdroje
            window._sensorPitchRaw = cameraPitchDown;   // #4: SYROVÝ sklon PŘED korekcí (viz výše)
            if (window.AGVisualTrack && window.AGVisualTrack.enabled) { var _vc2 = window.AGVisualTrack.getCorrection(); if (_vc2 && _vc2.dpitch != null) cameraPitchDown += _vc2.dpitch; }
            window._arProj = { pitch: cameraPitchDown, roll: imgRoll, halfH: halfH, halfV: halfV };
            let highlightedPointData = null; let renderedCount = 0;
            // Kolik bodů spolklo POUZE omezení „max značek v AR" (ne filtry, ne dosah).
            // Bez tohohle čísla uživatel nemá jak poznat, že na hustém staveništi kouká
            // na neúplný obraz — a strop je přitom skrytý na posuvníku v Nastavení.
            let _cappedCount = 0;
            let _arMissingEl = false;   // narazili jsme na bod bez DOM elementu?

            let maxPts = visSettings.maxARPoints || 100; let vOffset = visSettings.arVerticalOffset || 0;
            const _sqLC = searchQuery ? searchQuery.toLowerCase() : '';
            // DECLUTTER AR štítků: co by se překrývalo, sbalí se pod nejbližší bod (+N, tap = seznam bodů).
            const _placed = []; const _ovW = arOverlay.clientWidth || 1, _ovH = arOverlay.clientHeight || 1;

            // BATERIE: arPoints jsou serazene VZESTUPNE podle currentDist (logika.js je prepocitava
            // a razuje pri kazdem posunu > 0.25 m i pri zmene poctu bodu). Za prvnim bodem mimo AR
            // dosah uz tedy zadny dalsi videt nebude — po stazeni bodoveho pole z CUZK jich pritom
            // v poli byvaji stovky a cely ten ocas se prochazel s kazdym snimkem kompasu.
            // Za rezem uz se nic nepocita, jen se dorovna znacka, kdyby jeste svitila z drivejska
            // (proto NEni `break`: jinak by pri zmenseni dosahu / zapnuti filtru zustaly stare
            // znacky viset na obrazovce). Zvyrazneny a prave otevreny bod se kresli i mimo dosah,
            // takze se rezu netykaji.
            let _beyond = false;
            for (let _pi = 0; _pi < arPoints.length; _pi++) {
                const pt = arPoints[_pi];
                const _keepFar = (pt.id === highlightedPointId || pt.id === activePointIdForModal);
                // NAVIGOVANY BOD: sipku a vzdalenost pocitej VZDY, jeste PRED vsemi
                // podminkami viditelnosti nize. Driv se highlightedPointData plnilo az
                // uprostred smycky, takze staci vypnuty filtr kategorie, aktivni hledani,
                // "skryty bod" nebo bod, ktery jeste nedostal DOM element (import, sync,
                // rajon), a `continue` to preskocil -> #ar-hud se schoval CELY: v mape
                // navigace bezela dal, v AR nebyla ani sipka, ani vzdalenost.
                if (pt.id === highlightedPointId) {
                    const _hDist = pt.currentDist || getDistance(_oLat, _oLng, pt.lat, pt.lng);
                    const _hBear = (pt.currentBearing != null) ? pt.currentBearing : getBearing(_oLat, _oLng, pt.lat, pt.lng);
                    highlightedPointData = { diff: ((_hBear - heading + 540) % 360) - 180, dist: _hDist, name: pt.name };
                }
                if (_beyond && !_keepFar) {
                    pt._arCluster = null;
                    if (pt.element && pt._opLast !== '0') { pt.element.style.opacity = '0'; pt.element.style.pointerEvents = 'none'; pt._opLast = '0'; }
                    continue;
                }
                pt._arCluster = null;   // shluk plati vzdy jen pro AKTUALNI snimek
                let isVisible = true; if (pt.hidden) isVisible = false; if (pt.cat === 'TB' && !filters.tb) isVisible = false; if (pt.cat === 'ZHB' && !filters.zhb) isVisible = false; if (pt.cat === 'PBPP' && !filters.pbpp) isVisible = false; if (pt.cat === 'NIVEL' && !filters.nivel) isVisible = false; if (pt.cat === 'CUSTOM' && !filters.custom) isVisible = false; if (_sqLC && !pt.name.toLowerCase().includes(_sqLC)) isVisible = false;
                const distance = pt.currentDist || getDistance(_oLat, _oLng, pt.lat, pt.lng);
                let isSelectedForDetail = (pt.id === activePointIdForModal);
                if (distance > arRadius && pt.id !== highlightedPointId && !isSelectedForDetail) { isVisible = false; _beyond = true; }
                if (isVisible && pt.id !== highlightedPointId && !isSelectedForDetail) { if (renderedCount >= maxPts) { isVisible = false; _cappedCount++; } else { renderedCount++; } }
                if (!isVisible) { if (pt.element && pt._opLast !== '0') { pt.element.style.opacity = '0'; pt.element.style.pointerEvents = 'none'; pt._opLast = '0'; } continue; }
                // Bod bez DOM elementu (pridany do arPoints az po poslednim initARMarkers —
                // import, cloud sync, rajon...): preskocit a na konci snimku si element nechat
                // dodelat. Driv se tady spadlo na pt.element.style, vyjimka vyletela z forEach
                // a shodila vykresleni VSECH dalsich bodu — dokola kazdy snimek.
                if (!pt.element) { _arMissingEl = true; continue; }

                const pointBearing = (pt.currentBearing != null) ? pt.currentBearing : getBearing(_oLat, _oLng, pt.lat, pt.lng); let diff = ((pointBearing - heading + 540) % 360) - 180;
                // (highlightedPointData se plni uz na zacatku smycky — viz komentar vyse)
                if (Math.abs(diff) < cullH) {
                    // svisle: depresni uhel k bodu na zemi vs. kam miri kamera, promitnuty pres svisly FOV
                    let _tdz = (typeof terrainDZ === 'function') ? terrainDZ(pt.lat, pt.lng) : 0;
                    let depression = Math.atan2(eyeH - _tdz, Math.max(distance, 0.5)) * 180 / Math.PI;
                    let screenAng = depression - cameraPitchDown;
                    // tilt: rotace odsazeni (azimut x svisly uhel) o naklon obrazu, aby znacky drzely horizont
                    let uH = diff, vV = screenAng;
                    if (imgRoll) { let cr = Math.cos(imgRoll), sr = Math.sin(imgRoll); let t = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = t; }
                    const xPct = 50 + (uH / halfH) * 50;
                    let groundY = 50 + (vV / halfV) * 50 - vOffset;
                    if (groundY < 3) groundY = 3; else if (groundY > 97) groundY = 97;
                    let markerY = groundY;
                    let normDist = distance / Math.max(arRadius, 100); if (normDist > 1) normDist = 1;
                    // CITELNOST: vzdalenost uz stitek nezmensuje pod citelne minimum (driv scale az 0.5
                    // -> 7px pismo, na slunci necitelne); hloubku naznaci jemny rozsah ~1.0-0.78,
                    // presnou dalku stejne rika text na stitku.
                    let scale = (1.0 - (normDist * 0.22)) * visSettings.markerScale;

                    // VYKON: zIndex i text vzdalenosti se meni jen s GPS fixem (~1x/s), ne s
                    // kazdym snimkem kompasu. Prepis zIndexu navic preskladava stacking context
                    // a innerText vynucuje prekresleni -> zapisujeme jen pri skutecne zmene.
                    const _isHi = (pt.id === highlightedPointId);
                    if (_isHi) scale = scale * 1.25;
                    const _z = _isHi ? 99999 : Math.round(1000 - distance);
                    if (pt._zLast !== _z) { pt.element.style.zIndex = _z; pt._zLast = _z; }
                    // Pozice v PIXELECH prekryvu — pouziva ji declutter i vlastni umisteni znacky
                    // (viz komentar o transformu nize). #ar-overlay ma inset:0 bez padding/borderu,
                    // takze _ovW/_ovH je presne to, proti cemu by se pocitala procenta v left/top.
                    const _px = xPct * _ovW / 100, _py = markerY * _ovH / 100;
                    if (pt.element && !_isHi && !isSelectedForDetail) {
                        // DECLUTTER: kolize stitku v pixelech obrazovky (stitek ~110x44 px pri scale 1);
                        // arPoints jsou razene podle vzdalenosti -> hostitelem shluku je nejblizsi bod
                        const _hw = 55 * scale, _hh = 22 * scale;
                        let _host = null;
                        for (let _i = 0; _i < _placed.length; _i++) { const q = _placed[_i]; if (Math.abs(_px - q.x) < (_hw + q.hw) && Math.abs(_py - q.y) < (_hh + q.hh)) { _host = q; break; } }
                        // sbaleny stitek schovej — a drz _opLast v souladu, jinak by ho cache uz nikdy nevratila
                        if (_host) { _host.pt._arCluster.push(pt); if (pt._opLast !== '0') { pt.element.style.opacity = '0'; pt.element.style.pointerEvents = 'none'; pt._opLast = '0'; } continue; }
                        _placed.push({ x: _px, y: _py, hw: _hw, hh: _hh, pt: pt });
                        pt._arCluster = [];
                    }
                    if (pt.element) {
                        // VYKON: pozice JEN pres transform, uz NE left/top. left/top v procentech
                        // vynuti LAYOUT (reflow) pro kazdou znacku pri kazdem snimku kompasu — pri
                        // az 100 znackach a 60 Hz to byl nejvetsi zdroj prace na hlavnim vlakne,
                        // a to nad zivym obrazem z kamery. translate3d drzi znacku na kompozitoru:
                        // zadny layout, zadny paint, jen prekompozice vrstvy.
                        // Vysledna pozice je totozna: .ar-marker ma v CSS left:0/top:0 a origin
                        // zustava ve stredu prvku, takze translate(-50%,-50%) posadi stred znacky
                        // presne na (_px,_py) — stejne jako driv left/top + translate(-50%,-50%).
                        // Perspective na #ar-overlay tim netrpi, z je porad 0 (jako driv translateZ(0)).
                        const _tf = `translate3d(${_px}px, ${_py}px, 0) translate(-50%, -50%) scale(${scale})`;
                        if (pt._tfLast !== _tf) { pt.element.style.transform = _tf; pt._tfLast = _tf; }
                        if (pt._opLast !== '1') { pt.element.style.opacity = '1'; pt.element.style.pointerEvents = 'auto'; pt._opLast = '1'; }
                        const _dTxt = `${distance.toFixed(1)} m`;
                        if (pt._dLast !== _dTxt) { pt.distElement.innerText = _dTxt; pt._dLast = _dTxt; }
                    }
                } else if (pt.element && pt._opLast !== '0') {
                    pt.element.style.opacity = '0'; pt.element.style.pointerEvents = 'none'; pt._opLast = '0';
                }
            }
            // badge „+N" na hostitelích shluků (jen umístěné značky, ne celé arPoints)
            // chybejici elementy dozenat hned (nejvys 1x za snimek), at se bod objevi
            // v nasledujicim snimku a nezustane neviditelny do dalsiho initARMarkers
            // BATERIE: nejvys 1x za sekundu. Kdyby bod z nejakeho duvodu element nikdy
            // nedostal (podminky viditelnosti v renderAR a initARMarkers nejsou uplne
            // totozne), bez skrceni by se initARMarkers volalo 60x za sekundu.
            if (_arMissingEl && (Date.now() - _arInitRetryAt) > 1000) { _arInitRetryAt = Date.now(); try { initARMarkers(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika'); } }
            // stav stropu ven pro js/filtr-info.js (upozorní, až když strop opravdu ubírá)
            window._arCapped = { capped: _cappedCount, shown: renderedCount, max: maxPts };
            _updateMoreBadges(_placed);
            drawARLines(heading, cameraPitchDown, imgRoll, halfH, halfV, vOffset, eyeH);
            
            if (highlightedPointData) {
                arHud.style.display = 'flex';
                arrTarget.style.display = 'none'; arrStraight.style.display = 'none'; arrLeft.style.display = 'none'; arrRight.style.display = 'none'; arrUturn.style.display = 'none'; arrBull.style.display = 'none';
                let diff = highlightedPointData.diff;
                // barvu NEnastavovat inline na bilou — na slunci (body.cam-light) ma stitek svetle
                // pozadi a bily text by nesel precist; barvu ridi CSS (#ar-hud-info + cam-light)
                arHudDist.style.color = ''; arHudInfo.style.borderColor = 'rgba(255,255,255,0.4)';
                if (Math.abs(diff) <= 35) { arrStraight.style.display = 'block'; arHudArrowContainer.style.transform = `perspective(800px) rotateX(65deg) rotateZ(${diff}deg)`; } else if (diff < -35 && diff >= -110) { arrLeft.style.display = 'block'; arHudArrowContainer.style.transform = `perspective(800px) rotateX(65deg)`; } else if (diff > 35 && diff <= 110) { arrRight.style.display = 'block'; arHudArrowContainer.style.transform = `perspective(800px) rotateX(65deg)`; } else { arrUturn.style.display = 'block'; arHudArrowContainer.style.transform = `perspective(800px) rotateX(65deg)`; }
                arHudDist.innerText = `${highlightedPointData.dist.toFixed(1)} m`;
                arHudName.innerText = `#${highlightedPointData.name}`;

            } else { arHud.style.display = 'none'; }
        }
        
        // BLEDNUTI HUD PO NECINNOSTI
        // Driv: 4 s bez doteku -> vsechny prvky na opacity 0.3 a pointer-events:none.
        // Jenze prave kdyz jdu k bodu a na displej NESAHAM, potrebuju azimut a presnost
        // GPS cist nejvic — a 30 % kryti je na slunci prakticky neviditelne. Ted se HUD
        // nevybledne, dokud se deje neco, u ceho ho clovek sleduje, a prodleva je delsi.
        // Kdyz duvod pomine, timer se prodluzuje dal (nekontroluje se jen jednou).
        let inactivityTimer; const fadeElements = ['menu-toggle-btn', 'compass-debug', 'info', 'resizer', 'gps-avg'];
        const FADE_DELAY = 12000;   // driv 4000 — za 4 s se v terenu nestihne ani dojit k bodu
        // Duvody, proc HUD NEsmi vyblednout, i kdyz se displeje nikdo nedotyka:
        function hudMustStayVisible() {
            try {
                // 1) navigace na zvyrazneny bod — sipka, azimut a vzdalenost jsou to jedine, co ridi chuzi
                if (highlightedPointId) return true;
                // 2) uzivatel jde (GPS rychlost nad ~2 km/h) — HUD cte za chuze, ne prsty
                if (typeof gpsSpeed === 'number' && gpsSpeed > 0.6) return true;
                // 3) v #info je chyba GPS s tlacitkem "Zkusit znovu" — vyblednout jedinou cestu ven nejde
                const inf = document.getElementById('info');
                if (inf && inf.querySelector('.info-retry')) return true;
                // 4) bezi prumerovani GPS a uzivatel ceka, az se ustali
                if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && !gpsAvgResult.coarse && gpsAvgResult.n > 0 && gpsAvgResult.n < 30) return true;
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:hudMustStayVisible'); }
            return false;
        }
        function resetInactivityTimer() {
            fadeElements.forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('ui-faded'); });
            clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(function tick() {
                // duvod k zobrazeni muze vzniknout az BEHEM cekani (rozejdu se, vyberu si cil)
                if (hudMustStayVisible()) { inactivityTimer = setTimeout(tick, 5000); return; }
                const bottomSheetOpen = document.getElementById('bottom-sheet').classList.contains('open');
                const settingsOpen = document.getElementById('settings-modal').style.display === 'flex';
                const customOpen = document.getElementById('custom-modal-overlay').style.display === 'flex';
                const clusterOpen = document.getElementById('cluster-modal').style.display === 'flex';
                const measureOpen = document.getElementById('measure-modal').style.display === 'flex';
                const welcomeOpen = document.getElementById('welcome-screen').style.display !== 'none';
                const menuOpen = document.getElementById('side-menu').classList.contains('open');
                if (bottomSheetOpen || settingsOpen || customOpen || welcomeOpen || menuOpen || clusterOpen || measureOpen) return;
                fadeElements.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('ui-faded'); });
            }, FADE_DELAY);
        }
        ['touchstart', 'click', 'mousemove'].forEach(evt => { document.addEventListener(evt, resetInactivityTimer, { passive: true }); }); resetInactivityTimer();

        // STABILITA: watchdog AR render smycky. Jediny "motor" AR jsou udalosti kompasu; kdyz prestanou
        // chodit (navrat z pozadi, uspani senzoru, iOS), AR by zamrzlo / "zmizely body". Kdyz se >0.4 s nic
        // nevykreslilo, prekreslime z posledni platne udalosti (drzi posledni znamy smer, AR zustane naziva).
        setInterval(function () {
            if (!appStarted || !_lastGoodEvent) return;
            // BATERIE: watchdog je pojistka proti ZAMRZLEMU AR, takze ma smysl jen kdyz je
            // AR opravdu videt. Driv tikal i na pozadi, v rezimu Mapa a pod celoobrazovkovym
            // panelem, kde 4x/s vynucoval plne prekresleni scény — a tim maril uspani kompasu.
            if (document.visibilityState !== 'visible') return;
            if (viewMode === 'map') return;
            if (anyOverlayOpen()) return;
            if (performance.now() - _lastRenderTs < 400) return;   // udalosti chodi, watchdog netreba
            if (_orientPending) return;
            _orientPending = true;
            requestAnimationFrame(function () { _orientPending = false; renderAR(_lastGoodEvent); });
        }, 250);

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
                    agAsk('Smazat tuto spojnici (' + lineEndName(ln.aId, ln.aName) + ' \u2194 ' + lineEndName(ln.bId, ln.bName) + ')?', { title: 'Smazat spojnici', okText: 'Smazat', danger: true }).then(function (ok) { if (ok) deleteLine(ln.id); });
                });
                hit.addTo(linesGroup);
                const d = getDistance(A.lat, A.lng, B.lat, B.lng);
                const mid = L.divIcon({ className: 'custom-map-marker', html: `<div style="position:relative; width:0; height:0;"><div class="map-label-text line-len-label" style="left:-16px; top:-18px; transform: rotate(${mapRotation}deg);">${d.toFixed(1)} m</div></div>`, iconSize: [0, 0] });
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
            let _tdz = (typeof terrainDZ === 'function') ? terrainDZ(lat, lng) : 0;
            let uH = diff, vV = Math.atan2(eyeH - _tdz, Math.max(dist, 0.5)) * 180 / Math.PI - cameraPitchDown;
            if (imgRoll) { const cr = Math.cos(imgRoll), sr = Math.sin(imgRoll); const tt = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = tt; }
            return { x: 50 + (uH / halfH) * 50, y: 50 + (vV / halfV) * 50 - vOffset, diff: diff, dist: dist };
        }
        let _arLinesSvg = null;
        // posledni stav, pro ktery jsou spojnice vykreslene (dirty-check nize)
        let _alH = null, _alP = 0, _alR = 0, _alLat = null, _alLng = null, _alN = -1;
        function drawARLines(heading, cameraPitchDown, imgRoll, halfH, halfV, vOffset, eyeH) {
            if (!pointLines || !pointLines.length) { if (_arLinesSvg) _arLinesSvg.innerHTML = ''; return; }
            if (!_arLinesSvg) {
                _arLinesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                _arLinesSvg.setAttribute('viewBox', '0 0 100 100'); _arLinesSvg.setAttribute('preserveAspectRatio', 'none');
                _arLinesSvg.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:1;';
                arOverlay.insertBefore(_arLinesSvg, arOverlay.firstChild);
            }
            // VYKON: spojnice se prekreslovaly kazdy snimek vcetne parsovani celeho SVG
            // (innerHTML) — i kdyz uzivatel stal a mobil se pohnul o setiny stupne. Stejny
            // dirty-check uz maji sesterske vrstvy (cadastre-vector, zavady, track-ar).
            if (_alH != null && Math.abs(heading - _alH) < 0.3 && Math.abs(cameraPitchDown - _alP) < 0.3
                && Math.abs((imgRoll || 0) - _alR) < 0.01 && _alLat === userLat && _alLng === userLng
                && _alN === pointLines.length) return;
            _alH = heading; _alP = cameraPitchDown; _alR = (imgRoll || 0);
            _alLat = userLat; _alLng = userLng; _alN = pointLines.length;
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
            if (viewMode === 'ar') { agInfo('Měření plochy funguje v mapě — přepni na Split nebo Mapu.'); return; }
            document.getElementById('measure-modal').style.display = 'none';
            areaMode = true; areaVertices = [];
            const p = document.getElementById('area-panel'); if (p) p.style.display = 'flex';
            document.getElementById('map-controls').classList.remove('expanded');
            redrawAreaPolygon(); updateAreaPanel();
        }
        // „Ukončit" leží hned vedle „Vrátit" — omylné klepnutí dřív zahodilo celý obejitý
        // polygon bez záchrany. Teď se vrcholy zálohují a toast 8 s nabídne „Vrátit zpět".
        function stopAreaMode() {
            const backup = (areaMode && areaVertices.length >= 2) ? areaVertices.slice() : null;
            areaMode = false; areaVertices = []; areaGroup.clearLayers();
            const p = document.getElementById('area-panel'); if (p) p.style.display = 'none';
            fixAppLayout();
            try { if (window.AGDraft) AGDraft.clear('plocha'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:stopAreaMode'); }   // ukonceno zamerne -> neni co obnovovat (zachranu drzi toast nize)
            if (backup) showAreaUndoToast(backup);
        }
        let _areaToast = null, _areaToastTimer = null;
        function hideAreaUndoToast() { if (_areaToastTimer) { clearTimeout(_areaToastTimer); _areaToastTimer = null; } if (_areaToast) _areaToast.style.display = 'none'; }
        function showAreaUndoToast(verts) {
            if (!_areaToast) {
                _areaToast = document.createElement('div');
                _areaToast.id = 'ag-area-toast';
                _areaToast.style.cssText = 'position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom, 0px) + 88px); transform:translateX(-50%); z-index:var(--z-dialog,2000000); '
                    + 'display:flex; align-items:center; gap:10px; max-width:90%; padding:8px 8px 8px 16px; '
                    + 'border-radius:12px; background:rgba(17,22,33,0.96); color:#fff; font-family:var(--font-display,sans-serif); '
                    + 'box-shadow:0 8px 26px rgba(0,0,0,0.55); border:1px solid var(--glass-border,rgba(255,255,255,0.12));';
                const label = document.createElement('span'); label.id = 'ag-area-toast-label';
                label.style.cssText = 'font-size:calc(14px * var(--ag-font-scale, 1)); line-height:1.2; white-space:nowrap;';
                const btn = document.createElement('button'); btn.id = 'ag-area-toast-btn';
                btn.textContent = 'Vrátit zpět';
                btn.style.cssText = 'flex:none; padding:8px 16px; border:none; border-radius:9px; cursor:pointer; '
                    + 'background:var(--accent,#2f9e74); color:#0b1020; font-weight:700; font-size:calc(13px * var(--ag-font-scale, 1)); line-height:1; white-space:nowrap;';
                _areaToast.appendChild(label); _areaToast.appendChild(btn);
                document.body.appendChild(_areaToast);
            }
            document.getElementById('ag-area-toast-label').textContent = 'Měření plochy ukončeno (' + verts.length + ' vrcholů)';
            document.getElementById('ag-area-toast-btn').onclick = function () {
                hideAreaUndoToast();
                areaMode = true; areaVertices = verts.slice();
                const p = document.getElementById('area-panel'); if (p) p.style.display = 'flex';
                afterAreaChange();   // prekresli + vrati i draft (ukonceni ho smazalo)
            };
            _areaToast.style.display = 'flex';
            if (_areaToastTimer) clearTimeout(_areaToastTimer);
            _areaToastTimer = setTimeout(hideAreaUndoToast, 8000);
        }
        function areaAddGps() {
            if (gpsAvgResult && gpsAvgResult.n >= 2) areaVertices.push({ lat: gpsAvgResult.lat, lng: gpsAvgResult.lng });
            else if (userLat != null) areaVertices.push({ lat: userLat, lng: userLng });
            else { agInfo('Čekám na GPS pozici...'); return; }
            afterAreaChange();
        }
        function areaUndo() { areaVertices.pop(); afterAreaChange(); }
        function afterAreaChange() {
            redrawAreaPolygon(); updateAreaPanel(); if (visSettings.vibrationEnabled && navigator.vibrate) navigator.vibrate(20);
            // DRAFT: obchazeny polygon zil jen v pameti — zabiti appky (iOS pri prepnuti
            // na fotak) zahodilo cely obchod. Ukladame jen cista data vrcholu.
            try {
                if (window.AGDraft) {
                    if (areaVertices.length) AGDraft.save('plocha', { verts: areaVertices.map(v => ({ lat: v.lat, lng: v.lng })) }, 'Měření plochy – ' + areaVertices.length + (areaVertices.length === 1 ? ' vrchol' : (areaVertices.length < 5 ? ' vrcholy' : ' vrcholů')));
                    else AGDraft.clear('plocha');
                }
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:afterAreaChange'); }
        }
        // Obnova rozdelane plochy po restartu appky (lista "Pokracovat" z draft-store.js).
        try {
            if (window.AGDraft) AGDraft.register('plocha', {
                label: 'Měření plochy',
                open: function (st) {
                    if (!st || !Array.isArray(st.verts) || !st.verts.length) return;
                    if (viewMode === 'ar') { viewMode = 'both'; try { applyViewMode(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:open'); } }
                    document.getElementById('measure-modal').style.display = 'none';
                    areaMode = true; areaVertices = st.verts.slice();
                    const p = document.getElementById('area-panel'); if (p) p.style.display = 'flex';
                    redrawAreaPolygon(); updateAreaPanel();
                    try { map.fitBounds(areaVertices.map(v => [v.lat, v.lng]), { padding: [40, 40], maxZoom: 19 }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:open'); }
                }
            });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:open'); }
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
        function saveCustomDict(list) { try { localStorage.setItem('arDictCustom', JSON.stringify(list)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:saveCustomDict'); } }
        function openDictModal() { renderDictList(); document.getElementById('dict-modal').style.display = 'flex'; }
        function addDictEntry() {
            const t = document.getElementById('dict-new-term').value.trim();
            const d = document.getElementById('dict-new-def').value.trim();
            if (!t || !d) { agInfo('Vyplňte pojem i vysvětlení.'); return; }
            const list = getCustomDict(); list.push({ t: t, d: d }); saveCustomDict(list);
            document.getElementById('dict-new-term').value = ''; document.getElementById('dict-new-def').value = '';
            renderDictList();
        }
        function deleteDictEntry(idx) { agAsk('Smazat tento vlastní pojem?', { title: 'Smazat pojem', okText: 'Smazat', danger: true }).then(function (ok) { if (!ok) return; const list = getCustomDict(); list.splice(idx, 1); saveCustomDict(list); renderDictList(); }); }
        function _escHtml(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
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
            if (e.target.closest('#side-menu') || e.target.closest('#menu-toggle-btn') || e.target.closest('#dock-vice-btn')) return;
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
        // POZOR na <html>: css/style.css mu dava natvrdo tmave #0e1216 a zadny prepis
        // pro svetly rezim neexistuje (`body.light-mode html` ani napsat nejde — html je
        // RODIC body). Ve svetlem rezimu se to ukazovalo vsude, kde neni videt body:
        // pri odtazeni obsahu (overscroll) a v bezpecnych zonach gest = tmavy pruh nahore
        // i dole. Prepiname ho proto tady, stejne jako theme-color.
        function previewMode(m) { var light = m === 'light'; document.body.classList.toggle('light-mode', light); try { document.documentElement.style.backgroundColor = light ? '#f4f5f7' : '#0e1216'; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:previewMode'); } // color-scheme dela dve veci najednou: rekne prohlizeci, jak malovat formularove prvky
        // a rolovatka, A ZAROVEN vynuti prekresleni korene. To druhe je oprava hlaseni
        // z 29. 8. 2026 („po prepnuti do tmava zustane pod Dynamic Islandem bily pruh
        // a musim appku restartovat") — WebKit si nektere pevne vrstvy nahore po zmene
        // tridy na <body> sam neprekresli. Viz i #settings-modal .modal-content::before.
        try { document.documentElement.style.colorScheme = light ? 'light' : 'dark'; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'grafika:previewMode'); }
        var mc = document.querySelector('meta[name="theme-color"]'); if (mc) mc.setAttribute('content', light ? '#f4f5f7' : '#0f1216'); }

        // ===== DUHOVY OKRAJ: zari po celou navigaci na bod, zesili a zrychli pri dohledavani (< 2 m) =====
        let _egEl = null;
        function updateNavGlow() {
            // VYKON: bezi kazdy snimek AR -> uzel si drz, neshanej ho 25x za sekundu znovu
            if (!_egEl || !_egEl.isConnected) _egEl = document.getElementById('edge-glow');
            const eg = _egEl; if (!eg) return;
            const pt = highlightedPointId ? arPoints.find(p => p.id === highlightedPointId) : null;
            const active = !!(pt && appStarted && userLat != null);
            eg.classList.toggle('on', active);
            // VYKON: bezi kazdy snimek -> pouzij uz spoctenou vzdalenost (pt.currentDist) misto Haversine
            const _nd = active ? ((pt.currentDist != null) ? pt.currentDist : getDistance(userLat, userLng, pt.lat, pt.lng)) : Infinity;
            eg.classList.toggle('near', active && _nd <= 2.0);
        }

        // ===== ADAPTIVNI SKLO: vzorkuje jas obrazu kamery (~1x za 0.7 s) a prepina svetly rezim AR panelu =====
        const _lumaCanvas = document.createElement('canvas'); _lumaCanvas.width = 24; _lumaCanvas.height = 16;
        const _lumaCtx = _lumaCanvas.getContext('2d', { willReadFrequently: true });
        // ===== VENKOVNI REZIM SAM =================================================
        // Jas uz meritko zna (viz nize), jen se dosud pouzival vyhradne na `cam-light`.
        // Kdyz clovek vyjde na prime slunce, na displej nevidi — a prepnout se rucne
        // do Nastaveni v tu chvili nikdo nejde. Po SOUVISLE vysokem jasu se venkovni
        // rezim zapne sam a rekne to toastem; kdyz zase dlouho zesera, vypne se.
        // Vypina se JEN to, co zapnul sam (rucne zapnuty venkovni rezim nechavame byt).
        const _AO_ON = 190, _AO_OFF = 120;     // prah jasu pro zapnuti / vypnuti
        const _AO_TICKS = 12;                  // ~18 s souvisle (tik je 1,5 s)
        // _aoArmed: aby automatika po RUCNIM vypnuti hned nezapinala znovu dokola —
        // znovu se nabije az po delsim seru (uzivatel prosel do stinu / je vecer).
        let _aoHi = 0, _aoLo = 0, _aoAuto = false, _aoArmed = true;
        function _autoOutdoor(luma) {
            if (visSettings.autoOutdoor === false) return;
            if (luma > _AO_ON) _aoHi++; else _aoHi = 0;
            if (luma < _AO_OFF) _aoLo++; else _aoLo = 0;
            if (_aoLo >= _AO_TICKS) _aoArmed = true;
            if (!visSettings.outdoorMode && _aoArmed && _aoHi >= _AO_TICKS) {
                _aoHi = 0; _aoAuto = true; _aoArmed = false;
                visSettings.outdoorMode = true;
                setStoredData('arVisSettings12', JSON.stringify(visSettings));
                applyVisualSettings();
                quickToast('Silné světlo — zapnul jsem venkovní režim (vyšší kontrast). Vypnout: Nastavení → Displej a čitelnost.');
            } else if (visSettings.outdoorMode && _aoAuto && _aoLo >= _AO_TICKS) {
                _aoLo = 0; _aoAuto = false;
                visSettings.outdoorMode = false;
                setStoredData('arVisSettings12', JSON.stringify(visSettings));
                applyVisualSettings();
                quickToast('Zase šero — venkovní režim vypnut.');
            }
        }

        (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(() => {
            // Kdyz venkovni rezim zapnula automatika, vzorkujeme DAL — jinak by se
            // uz nedalo poznat, ze slunce zaslo, a rezim by zustal viset do rana.
            // Rucne zapnuty venkovni rezim vzorkovani preskakuje jako driv (baterie).
            const _keepSampling = visSettings.outdoorMode && _aoAuto && visSettings.autoOutdoor !== false;
            if (visSettings.adaptiveGlass === false || (visSettings.outdoorMode && !_keepSampling) || !appStarted || viewMode === 'map' || document.visibilityState !== 'visible') { document.body.classList.remove('cam-light'); return; }
            // BATERIE: getImageData je synchronni readback GPU -> CPU, ktery stopne pipeline.
            // Pod otevrenym panelem nikdo AR stitky nevidi, takze jas obrazu nema co ovlivnit
            // (a `cam-light` zustane na posledni znane hodnote — po zavreni panelu se dorovna
            // na dalsim tiku). anyOverlayOpen() je sdileny test s 200ms cache.
            if (anyOverlayOpen()) return;
            const v = document.getElementById('camera-feed');
            if (!v || v.readyState < 2 || !v.videoWidth) return;
            try {
                _lumaCtx.drawImage(v, 0, 0, 24, 16);
                const d = _lumaCtx.getImageData(0, 0, 24, 16).data;
                let sum = 0; for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                const luma = sum / (d.length / 4);
                // hystereze, aby panely na hranici svetla/tmy neblikaly
                if (!visSettings.outdoorMode) {
                    if (luma > 150) document.body.classList.add('cam-light');
                    else if (luma < 115) document.body.classList.remove('cam-light');
                }
                _autoOutdoor(luma);
            } catch (e) { /* video jeste neni pripravene */ }
            // BATERIE: 1500 ms misto 700. Jas okoli se v terenu nemeni 1,4x za sekundu
            // (mrak, vstup do stinu) a hystereze 115/150 stejne tlumi prepinani, takze
            // uzivatel rozdil nepozna — ale readbacku je polovina.
        }, 1500);
