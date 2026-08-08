// ===== AR Geodet - TECHNICKA CAST (logika) =====
// Vypocty, prevody souradnic, stahovani dat z CUZK, GPS, ukladani, zakazky.
// Nacita se PRED grafika.js a sdili s ni globalni promenne.

if ('serviceWorker' in navigator) {
            // UPDATE: novou verzi NEaktivujeme automaticky (rusivy reload uprostred prace);
            // nabidneme listu 'nova verze - klepni pro obnoveni' (showUpdateBanner -> applyUpdate -> SKIP_WAITING).
            let _swReloaded = false;
            // POZOR (nalezeno 8.8. v prohlizeci): sw.js pri 'activate' vola clients.claim().
            // Na PRVNIM nacteni (jeste bez controlleru) tim controllerchange vystreli hned po
            // instalaci — a tenhle handler appku ~2 s po klepnuti na „Spustit vyhledavani"
            // natvrdo reloadnul zpatky na uvodni obrazovku. Reload smi nastat JEN kdyz novy
            // SW prebira uz drive ovladanou stranku (= skutecna aktualizace po applyUpdate).
            const _hadController = !!navigator.serviceWorker.controller;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                // prvni zabrani (bez controlleru na startu) NENI aktualizace — nereloaduj.
                // Vyjimka: uzivatel klepnul na listu "nova verze" (applyUpdate v grafika.js).
                if (!_hadController && !window.__agUpdateRequested) return;
                if (_swReloaded) return; _swReloaded = true; window.location.reload();
            });
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js').then(reg => {
                    // Nová verze už čeká z minulého běhu (banner tehdy nikdo neklepl)
                    // → bez tohohle by se lišta při dalším startu už NEUKÁZALA.
                    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();
                    reg.addEventListener('updatefound', () => {
                        const nw = reg.installing; if (!nw) return;
                        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(); });
                    });
                    // PWA se na mobilu většinou jen PROBUDÍ z pozadí (žádná navigace),
                    // takže prohlížeč sám novou verzi sw.js nezkontroluje třeba celý den.
                    // Kontrolujeme při každém návratu do popředí + každých 15 minut.
                    // BATERIE: reg.update() je sitovy dotaz, ktery obchazi HTTP cache. Driv se
                    // poustel pri KAZDEM navratu do popredi (a to hned 2x — visibilitychange
                    // i pageshow) a jeste kazdych 15 minut, takze v terenu delal desitky
                    // radiovych probuzeni denne. Staci nejvys 1x za 10 minut a jen kdyz je sit.
                    // (10 min je kompromis: uspora + nova verze se pri testovani na mobilu
                    // pozna dost rychle; studeny start appky kontroluje vzdy, mimo tento limit.)
                    let _lastChk = 0;
                    const chk = () => {
                        if (navigator.onLine === false) return;
                        const now = Date.now();
                        if (now - _lastChk < 10 * 60 * 1000) return;
                        _lastChk = now;
                        try { reg.update(); } catch (e) {}
                    };
                    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') chk(); });
                    window.addEventListener('pageshow', chk);
                    setInterval(chk, 15 * 60 * 1000);
                    chk();
                }).catch(() => {});
            });
        }
        // ČÍSLA Z FORMULÁŘŮ: jedno místo pro celou appku. js/vstupy.js je odpojitelná
        // vrstva, takže když chybí, spadne se na parseFloat s ručním převodem čárky.
        function agNumIn(idOrEl) {
            if (typeof window.agNum === 'function') return window.agNum(idOrEl);
            const el = (typeof idOrEl === 'string') ? document.getElementById(idOrEl) : idOrEl;
            const raw = el && 'value' in el ? el.value : idOrEl;
            const v = parseFloat(String(raw == null ? '' : raw).replace(/\s/g, '').replace(',', '.'));
            return isFinite(v) ? v : NaN;
        }
        window.agNumIn = agNumIn;
        proj4.defs("EPSG:5514","+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs");
        const map = L.map('map', { maxZoom: 22, minZoom: 10, zoomSnap: 0, zoomDelta: 1, zoomControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false });
        const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22, maxNativeZoom: 18, zIndex: 1 });
        // Podklady CUZK (overeno: WMS 1.3.0, EPSG:3857). Ortofoto = base, katastr KN = pruhledny overlay nad base.
        const ortofotoLayer = L.tileLayer.wms('https://ags.cuzk.gov.cz/arcgis1/services/ORTOFOTO/MapServer/WMSServer', { layers: '0', format: 'image/jpeg', version: '1.3.0', maxZoom: 22, zIndex: 1, attribution: '© ČÚZK' });
        const katastrLayer = L.tileLayer.wms('https://services.cuzk.cz/wms/wms.asp', { layers: 'KN', format: 'image/png', transparent: true, version: '1.3.0', maxZoom: 22, zIndex: 2, attribution: '© ČÚZK' });
        const baseLayers = { osm: osmLayer, ortofoto: ortofotoLayer };
        osmLayer.addTo(map);
        // VYCHOZI POHLED HNED PRI STARTU (oprava „bod vytvořený offline není vidět"):
        // bez setView nemá Leaflet střed/zoom a přidání značky do mapy VYHODÍ výjimku —
        // offline bez GPS fixu (uvnitř budovy) se pak body nevykreslily vůbec, dokud
        // nepřišla síťová poloha (data/wifi). Použijeme poslední známou polohu, jinak ČR.
        (function () {
            let p = null; try { p = JSON.parse(localStorage.getItem('arLastPos')); } catch (e) {}
            if (p && isFinite(p.lat) && isFinite(p.lng)) map.setView([p.lat, p.lng], 17, { animate: false });
            else map.setView([49.8, 15.5], 7, { animate: false });
        })();
        const markersGroup = L.layerGroup().addTo(map);
        
        let projects;
        try { projects = JSON.parse(localStorage.getItem('arProjectsList')); } catch (e) { projects = null; } // poskozeny zapis nesmi shodit start
        if (!Array.isArray(projects) || !projects.length) projects = [{id:'default', name:'Výchozí zakázka'}];
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
        // Smazani vsech klicu s danym prefixem (napr. "<zakazka>_doc_") — pro uklid pri mazani zakazky.
        function _idbDelByPrefix(prefix) {
            return _idbOp('readwrite', s => {
                try {
                    const kr = s.getAllKeys();
                    kr.onsuccess = () => { (kr.result || []).forEach(k => { if (typeof k === 'string' && k.indexOf(prefix) === 0) { try { s.delete(k); } catch (e) {} } }); };
                } catch (e) {
                    try { const cur = s.openCursor(); cur.onsuccess = (ev) => { const c = ev.target.result; if (c) { if (typeof c.key === 'string' && c.key.indexOf(prefix) === 0) c.delete(); c.continue(); } }; } catch (e2) {}
                }
                return null;
            });
        }
        // Nacteni VSECH klicu s danym prefixem jednim pruchodem kurzorem.
        // Seznam bodu drive pro kazdy radek pustil vlastni _idbGet('doc_<id>') —
        // u 500 bodu to bylo 500 transakci pri kazdem prekresleni seznamu.
        function idbGetByPrefix(prefix) {
            return new Promise((resolve) => {
                _openIdb().then((db) => {
                    if (!db) return resolve({});
                    try {
                        const out = {};
                        const tx = db.transaction('kv', 'readonly');
                        const req = tx.objectStore('kv').openCursor();
                        req.onsuccess = (e) => {
                            const c = e.target.result; if (!c) return;
                            if (typeof c.key === 'string' && c.key.indexOf(prefix) === 0) out[c.key.slice(prefix.length)] = c.value;
                            c.continue();
                        };
                        tx.oncomplete = () => resolve(out);
                        tx.onerror = () => resolve(out);
                    } catch (e) { resolve({}); }
                });
            });
        }
        window.idbGetByPrefix = idbGetByPrefix;

        // Jednorazove varovani, kdyz zapis bodu do IndexedDB tise selze (kvota / iOS eviction / poskozena tx).
        // Bez tohohle vypadaly body ulozene (drzi je _idbMem cache), ale po reloadu byly PRYC.
        let _idbWriteWarned = false;
        function _warnStorageWriteFail(savedToFallback) {
            if (_idbWriteWarned) return; _idbWriteWarned = true;
            const msg = savedToFallback
                ? 'POZOR: databáze telefonu odmítla zápis bodů. Data jsou dočasně zachráněna v záložním úložišti a po restartu se vrátí, ale udělejte co nejdřív zálohu (Nastavení → Údržba → Stáhnout zálohu) a uvolněte místo v telefonu.'
                : 'POZOR: bod se nepodařilo trvale uložit (databáze telefonu odmítla zápis — nejspíš plné úložiště). Data se mohou po zavření aplikace ztratit.\n\nUvolněte místo a udělejte zálohu (Nastavení → Údržba → Stáhnout zálohu).';
            try { agInfo(msg); } catch (e) {}
        }
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
                        // OPRAVA: napred vycistit cely store, jinak stare klice (z puvodniho stavu)
                        // prezijou a smichaji se s obnovenymi daty. Clear+put v JEDNE tx = atomicke.
                        try { store.clear(); } catch (e) {}
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
                // POTVRZENY ZAPIS: drive fire-and-forget (selhani = ticha ztrata bodu po reloadu).
                // Ted: 1 opakovani po 500 ms, pri trvalem selhani ZACHRANA do localStorage
                // (hydrateActiveProject ji po startu umi nacist a vratit do IndexedDB).
                // localStorage kopie se maze AZ po potvrzeni transakce, ne predem.
                if (_idbOk) {
                    const tryWrite = (attempt) => _idbSet(fk, val).then(res => {
                        if (res != null) { try { localStorage.removeItem(fk); } catch (e) {} return; }
                        if (attempt < 1) { setTimeout(() => tryWrite(attempt + 1), 500); return; }
                        let saved = false; try { localStorage.setItem(fk, val); saved = true; } catch (e) {}
                        _warnStorageWriteFail(saved);
                    });
                    tryWrite(0);
                    return true;
                }
            }
            try { localStorage.setItem(fk, val); return true; }
            catch (e) {
                if (!_quotaWarned) { _quotaWarned = true; agInfo('Úložiště telefonu je plné — data se neuložila. Uvolněte místo (smažte starou zakázku nebo stáhnuté offline okolí v Nastavení).'); }
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
        let _lastAutoFetchTs = 0;   // kdy naposled dosahlo automatickeho (pri chuzi) stahovani z CUZK
        let currentHeading = 0, currentGpsAccuracy = 0, accuracyCircle = null, magneticDeclination = 0;
        let smoothedHeading = null, gpsCourse = null, gpsSpeed = 0, headingCorrection = 0, userHeadingOffset = 0;
        function quickToast(msg) {
            let t = document.getElementById('quick-toast');
            if (!t) { t = document.createElement('div'); t.id = 'quick-toast'; t.style.cssText = 'position:fixed; left:50%; top:calc(env(safe-area-inset-top,0px) + 70px); transform:translateX(-50%); z-index:1000002; background:rgba(20,24,30,0.92); color:#fff; padding:10px 16px; border-radius:10px; font-size:calc(14px * var(--ag-font-scale, 1)); border:1px solid rgba(255,255,255,0.15); pointer-events:none; transition:opacity 0.3s; max-width:80vw; text-align:center;'; document.body.appendChild(t); }
            t.innerText = msg; t.style.opacity = '1'; clearTimeout(t._timer);
            t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2600);
        }
        // Kratka haptika (ulozeni bodu, potvrzeni akce). Jediny spolecny vstup pro vibrace,
        // respektuje visSettings.vibrationEnabled (default zapnuto; iOS Safari vibrace neumi — tise nic).
        // ---- CISLA Z FORMULARU: desetinna CARKA -----------------------------------
        // Ceska klavesnice pise "596956,46". <input type="number"> ale podle specifikace
        // drzi jen tecku: Chrome/Firefox carku samy prepisou, Safari (a tedy iPhone v PWA)
        // NE — pole je "badInput" a .value vrati PRAZDNY retezec. Uzivatel videl v poli
        // "596956,46" a appka mu napsala "Vyplnte souradnice!". Proto jsou pole, do kterych
        // se pisou merene hodnoty, prepnute na type="text" inputmode="decimal" (ciselna
        // klavesnice vyjede stejne, obsah nikdo nezahazuje) a VSECHNA cisla chodi tudy.
        //
        // SAMO agNum() ZDE UZ NENI: bydli v js/vstupy.js a je JEDNO pro celou appku.
        // Krátce tu byly definice dve (kazda z jedne souzezne vetve) a protoze logika.js
        // se nacita POZDEJI, prepsala tu spravnou svou vlastni — ta ale neumela cist pole
        // podle ID a pri chybe vracela null misto NaN. `isNaN(null)` je FALSE, takze
        // necitelna souradnice prosla kontrolou v saveCustomPoint az do proj4.
        // Cte se tedy VZDY pres agNumIn() vyse; kdyz je vstupy.js odpojeny, ma vlastni
        // fallback (taky s NaN).

        // ---- HLEDANI BODU: jeden filtr pro mapu, AR i seznamy --------------------
        // Driv byl `pt.name.toLowerCase().includes(q)` zkopirovany na 8 mistech:
        // nehledal v KODU bodu (pozdejsi funkce) a "sachta" nenaslo "sachta" s hackem.
        // agFold = male pismeno bez diakritiky. Vysledek se cachuje ve WeakMap, aby se
        // normalize() nevolal 60x za sekundu na kazdy bod v renderAR — a hlavne aby se
        // do bodu nezapisovaly pomocne vlastnosti (body se ukladaji pres JSON.stringify).
        // Pojistka pro pripad, ze normalize('NFD') neni k dispozici (starsi WebView,
        // engine bez ICU) — tam by se diakritika tise NEsundala a hledani by prestalo
        // byt slepe k hackum, aniz by to cokoli ohlasilo. Tabulka je levna a jista.
        var _AG_DIA = { '\u00e1': 'a', '\u010d': 'c', '\u010f': 'd', '\u00e9': 'e', '\u011b': 'e',
                        '\u00ed': 'i', '\u0148': 'n', '\u00f3': 'o', '\u0159': 'r', '\u0161': 's',
                        '\u0165': 't', '\u00fa': 'u', '\u016f': 'u', '\u00fd': 'y', '\u017e': 'z' };
        function agFold(s) {
            s = String(s == null ? '' : s).toLowerCase();
            try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
            return s.replace(/[\u00e1\u010d\u010f\u00e9\u011b\u00ed\u0148\u00f3\u0159\u0161\u0165\u00fa\u016f\u00fd\u017e]/g,
                             function (c) { return _AG_DIA[c] || c; });
        }
        window.agFold = agFold;
        var _agFoldCache = (typeof WeakMap === 'function') ? new WeakMap() : null;
        var _agQRaw = null, _agQFold = '';
        function agMatchQuery(pt, q) {
            if (!q) return true;
            if (q !== _agQRaw) { _agQRaw = q; _agQFold = agFold(q); }
            if (!_agQFold) return true;
            if (!pt) return false;
            var src = (pt.name || '') + '\u0000' + (pt.kod || '');
            var c = _agFoldCache && _agFoldCache.get(pt);
            if (!c || c.src !== src) {
                c = { src: src, idx: agFold(pt.name || '') + ' ' + agFold(pt.kod || '') };
                if (_agFoldCache) _agFoldCache.set(pt, c);
            }
            return c.idx.indexOf(_agQFold) >= 0;
        }
        window.agMatchQuery = agMatchQuery;

        function agVibe(pattern) { try { if (visSettings.vibrationEnabled !== false && navigator.vibrate) navigator.vibrate(pattern || 30); } catch (e) {} }
        window.agVibe = agVibe;
        // ---- SERIE CISLOVANI BODU (per zakazka): z posledniho ulozeneho nazvu "PREFIX123"
        // si zapamatujeme prefix+cislo a pri dalsim novem bodu predvyplnime nasledujici.
        // Zadne UI navic: kdo cisluje, dostane dalsi cislo; kdo pojmenovava slovy, tomu se nic nevnucuje.
        function _serieLoad() { try { const s = JSON.parse(getStoredData('agPointSerie') || 'null'); return (s && typeof s.prefix === 'string' && isFinite(s.next)) ? s : null; } catch (e) { return null; } }
        function _serieSaveFromName(name) {
            const m = /^(.*?)(\d{1,9})$/.exec(String(name || '').trim());
            if (!m) { removeStoredData('agPointSerie'); return; }
            // delku cisla drzime kvuli nulam na zacatku ("001" -> "002")
            try { setStoredData('agPointSerie', JSON.stringify({ prefix: m[1], next: parseInt(m[2], 10) + 1, pad: m[2].length })); } catch (e) {}
        }
        // Dalsi volny nazev v serii — preskakuje uz existujici (import mohl cislo obsadit)
        function agNextSerieName() {
            const s = _serieLoad(); if (!s) return '';
            let n = s.next;
            for (let i = 0; i < 500; i++) {
                const cand = s.prefix + String(n).padStart(s.pad || 0, '0');
                if (!persistentCustomPoints.some(p => p.name === cand)) return cand;
                n++;
            }
            return '';
        }
        window.agNextSerieName = agNextSerieName;
        // ---- KODY BODU: historie naposledy pouzitych kodu (spolecna pres zakazky) + vychozi nabidka
        const AG_KOD_DEFAULTS = ['obruba', 'hrana asfaltu', 'šachta', 'vpusť', 'sloup', 'plot', 'roh budovy', 'strom'];
        function agKodHistory() {
            let h = [];
            try { h = JSON.parse(localStorage.getItem('agKodHistory') || '[]'); } catch (e) {}
            if (!Array.isArray(h)) h = [];
            AG_KOD_DEFAULTS.forEach(k => { if (h.indexOf(k) < 0) h.push(k); });
            return h.slice(0, 12);
        }
        function agKodRemember(kod) {
            try {
                let h = []; try { h = JSON.parse(localStorage.getItem('agKodHistory') || '[]'); } catch (e) {}
                if (!Array.isArray(h)) h = [];
                h = [kod].concat(h.filter(k => k !== kod)).slice(0, 12);
                localStorage.setItem('agKodHistory', JSON.stringify(h));
            } catch (e) {}
        }
        window.agKodHistory = agKodHistory; window.agKodRemember = agKodRemember;
        // priprava formulare na DALSI bod serie („Uložit a další"): nove cislo, prazdne souradnice
        function agPrepNextPoint() {
            const nm = document.getElementById('custom-name');
            if (nm) { nm.value = agNextSerieName(); if (nm.value) { nm.dataset.agAutofill = '1'; nm.addEventListener('input', function () { delete nm.dataset.agAutofill; }, { once: true }); } }
            ['custom-y', 'custom-x', 'custom-z'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            const _n = document.getElementById('custom-acc-note'); if (_n) _n.style.display = 'none';
            pendingPointAccuracy = null; window._agPointOrigin = null;
            try { if (typeof resetNewPointExtras === 'function') resetNewPointExtras(null); } catch (e) {}
        }
        let gpsSamples = [], gpsAvgResult = null, _gpsJump = 0;
        let arPoints = [], persistentCustomPoints = [], hideBtnLogic = null, editingCustomPointId = null, highlightedPointId = null, activePointIdForModal = null;
        let compassUnit = 'deg'; let compassZeroOffset = 0;
        let measA = null, measB = null, pendingPointAccuracy = null, mapAddMode = false;
        let wakeLock = null;
        let pointLines = []; let connectFirstPt = null; let areaVertices = [];
        let connectMode = false, areaMode = false;
        let filters = { tb: true, zhb: true, pbpp: true, nivel: true, custom: true };

        let visSettings = { maxARPoints: 60, arVerticalOffset: 0, markerScale: 1.0, markerOpacity: 100, colTb: '#8b5cf6', colZhb: '#0ea5e9', colPbpp: '#3b82f6', colNivel: '#ef4444', colCustom: '#34d399', arrowScale: 1.0, arrowOpacity: 90, arrowShape: '1', colArrow: '#34d399', panelOpacity: 85, menuScale: 1.0, hudTop: 55, hudSide: 15, wakeLockEnabled: true, vibrationEnabled: true, outdoorMode: false, leftHand: false, anim: 'auto', dockArc: 13, katastrSource: 'mapycz', baseLayer: 'osm', showKatastr: false, headingSmoothing: 75, autoCompassCorrection: false, tiltCompensation: true, fovH: 90, fovV: 75, eyeHeight: 1.6 };
        
        // Stazene uredni body ziji jen v pameti (initFetch je pridava, neubira) -> pred prepnutim
        // zakazky je ulozime, at se neztrati. Jen kdyz nejake jsou (neprepiseme ulozena data prazdnem).
        function _persistOfficialPoints() { try { if (arPoints.some(p => p.cat !== 'CUSTOM')) setStoredData('arOfflinePoints12', JSON.stringify(arPoints.filter(p => p.cat !== 'CUSTOM'))); } catch (e) {} }
        function changeProject() { _persistOfficialPoints(); activeProjectId = document.getElementById('w-project-select').value; localStorage.setItem('arActiveProjectId', activeProjectId); hydrateActiveProject().then(loadProjectSettings); }
        function createNewProject() {
            const create = (name) => { if(!name) return; _persistOfficialPoints(); let id = 'proj_' + Date.now(); projects.push({id: id, name: name}); localStorage.setItem('arProjectsList', JSON.stringify(projects)); activeProjectId = id; localStorage.setItem('arActiveProjectId', activeProjectId); renderProjectSelect(); hydrateActiveProject().then(loadProjectSettings); };
            // in-app dialog místo nativního prompt() (vzhledem i chováním ladí se zbytkem appky)
            if (window.agPrompt) window.agPrompt({ title: 'Nová zakázka', message: 'Pojmenuj zakázku (lokalita / parcela / zakázkové číslo).', placeholder: 'Např. Pole u lesa 123/4', okText: 'Vytvořit' }).then(create);
            else create(prompt("Název nové zakázky:"));
        }
        function deleteProject() {
            if(projects.length <= 1) return agInfo("Nelze smazat poslední zakázku.");
            if(!confirm("Opravdu smazat aktuální zakázku a všechny její uložené body?")) return;
            const pid = activeProjectId;
            // UKLID PODLE PREFIXU, ne rucnim vyctem: VSECHNA per-zakazkova data zacinaji
            // `${pid}_` (getStoreKey). Rucni seznam klicu tu zastaraval — ~13 klicu modulu
            // (vytycovaci checklist, Helmert, epochy, zapisniky, vrstvy...) zustavalo po
            // smazani zakazky navzdy jako sirotci. Prefix smete i vsechny budouci klice.
            _idbDelByPrefix(pid + "_");
            try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.indexOf(pid + "_") === 0) localStorage.removeItem(k); } } catch (e) {}
            // Moduly s VLASTNI IndexedDB (fotky vytyceni, rastr podkladu...) si uklidi samy.
            // Zurnal (argeodet-journal) se ZAMERNE nemaze — auditni stopa prezije i zakazku.
            try { document.dispatchEvent(new CustomEvent('ag:project-deleted', { detail: { id: pid } })); } catch (e) {}
            projects = projects.filter(p => p.id !== pid);
            localStorage.setItem('arProjectsList', JSON.stringify(projects));
            activeProjectId = projects[0].id; localStorage.setItem('arActiveProjectId', activeProjectId);
            renderProjectSelect(); hydrateActiveProject().then(loadProjectSettings);
        }

        function loadProjectSettings() {
            let f = getStoredData('arFilters12'); try { filters = f ? JSON.parse(f) : null; } catch (e) { filters = null; } if (!filters || typeof filters !== 'object') filters = { tb: true, zhb: true, pbpp: true, nivel: true, custom: true };
            let m = getStoredData('arRadiusMap'); if(m) mapRadius = parseInt(m); else mapRadius = 1000;
            let a = getStoredData('arRadiusAR'); if(a) arRadius = parseInt(a); else arRadius = 150;
            let vs = getStoredData('arVisSettings12'); if(vs) { try { var _vs = JSON.parse(vs); if (_vs && typeof _vs === 'object') visSettings = Object.assign(visSettings, _vs); } catch (e) {} }
            let ho = getStoredData('arHeadingOffset'); userHeadingOffset = ho ? (parseFloat(ho) || 0) : 0;

            arPoints.forEach(p => { if(p.element) p.element.remove(); }); arPoints = []; persistentCustomPoints = [];
            let off = getStoredData('arOfflinePoints12'); if(off) { try { var _off = JSON.parse(off); if (Array.isArray(_off)) _off.forEach(p => { if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number' || !isFinite(p.lat) || !isFinite(p.lng)) return; p.element=null; p.distElement=null; p.ringElement=null; p.bestAccuracy=null; p.hidden=false; arPoints.push(p); }); }catch(e){} }
            let cust = getStoredData('arCustomPoints12'); if(cust) { try { var _cust = JSON.parse(cust); if (Array.isArray(_cust)) persistentCustomPoints = _cust.filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number' && isFinite(p.lat) && isFinite(p.lng)); } catch(e) {} }
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
        // BATERIE: displej je největší spotřebič a wake lock se dřív NIKDY neuvolnil —
        // zapomenutý telefon v kapse svítil, dokud nedošla baterie. Politiku (kdy pustit,
        // kdy zase vzít) drží js/power-save.js; tady je jen bezpečné uvolnění/obnova.
        // Měřicí moduly (brutální GPS, DGPS…) si drží VLASTNÍ wake lock, takže uvolnění
        // tohoto jim měření nepřeruší — displej zůstane rozsvícený po dobu měření.
        function releaseWakeLock() { try { if (wakeLock) { wakeLock.release(); } } catch (e) {} wakeLock = null; }
        window.agRequestWakeLock = requestWakeLock;
        window.agReleaseWakeLock = releaseWakeLock;
        window.agWakeLockHeld = function () { return wakeLock !== null; };

        function setMeasurePoint(type) { if (!userLat || !userLng) return agInfo("Hledám GPS pozici. Počkejte chvíli..."); const pt = { lat: userLat, lng: userLng, alt: userAlt }; let altStr = "Výška: nedostupná"; if (pt.alt !== null) { let bpv = pt.alt - getGeoidUndulation(pt.lat, pt.lng); altStr = `Výška (Bpv): ${bpv.toFixed(1)} m`; } let sjtsk = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]); let coordsStr = `Y: ${Math.abs(sjtsk[0]).toFixed(2)} | X: ${Math.abs(sjtsk[1]).toFixed(2)}<br><span style="opacity:0.7;">${altStr}</span>`; if (type === 'A') { measA = pt; document.getElementById('meas-a-coords').innerHTML = coordsStr; } else { measB = pt; document.getElementById('meas-b-coords').innerHTML = coordsStr; } calcMeasure(); }
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
            if ((lastFetchNetworkError || lastFetchServerError) && found === 0) { agInfo((lastFetchNetworkError ? "ČÚZK je nedostupné nebo jste offline." : "ČÚZK právě neodpovídá (možná dočasný limit).") + " Zkuste to prosím znovu.\n\nDříve uložené offline body zůstaly zachované."); return; }
            // Body i mapu rovnou ulozime pro offline -> kliknuti do mapy = oblast funguje i bez internetu.
            // POJISTKA: neprepisujeme ulozena data prazdnem (kdyz fetch vratil 0 kvuli chybe, ktera nebyla sit).
            if (arPoints.some(p => p.cat !== 'CUSTOM')) setStoredData('arOfflinePoints12', JSON.stringify(arPoints.filter(p => p.cat !== 'CUSTOM')));
            let tileMsg = '';
            if ('caches' in window) { try { const res = await cacheTilesForArea(lat, lng, rad, true); tileMsg = '\n' + offlineResultMsg(res); } catch (e) { tileMsg = '\nMapu se nepodařilo uložit offline: ' + ((e && e.message) ? e.message : e); } }
            agInfo(`Staženo ${found} bodů ve vybrané oblasti — uloženo pro offline.` + tileMsg);
        };

        
        // Stazeni mapovych dlazdic (OSM, zoom 15-17) pro oblast do TILE_CACHE, aby mapa fungovala offline.
        // Vraci podrobny vysledek vc. duvodu selhani — at nezustava nejasne "ulozeno X z Y".
        // Offline ulozeni WMS dlazdic (katastr KN / ortofoto) pro oblast. URL generujeme PRES Leaflet
        // getTileUrl teze vrstvy, kterou appka pouziva -> adresy se PRESNE shoduji s tim, co appka
        // pozdeji zada, takze je SW offline najde (jinak by cache-miss = prazdna mapa). Setrime CUZK:
        // jen pracovni zoomy a strop poctu dlazdic (jinak celou vrstvu preskocime).
        async function _cacheWmsForArea(cache, layer, minLat, maxLat, minLon, maxLon, zooms, cap) {
            const out = { ok: 0, total: 0, net: 0, http: 0, quota: 0, skipped: false };
            if (!layer || typeof layer.getTileUrl !== 'function' || typeof L === 'undefined') return out;
            const wasOnMap = map.hasLayer(layer);
            if (!wasOnMap) { try { layer.addTo(map); } catch (e) { return out; } }   // onAdd nastavi _crs/_wmsVersion/_map
            let urls = [];
            try {
                zooms.forEach(z => {
                    let minX = Math.floor((minLon + 180) / 360 * Math.pow(2, z)), maxX = Math.floor((maxLon + 180) / 360 * Math.pow(2, z));
                    let minY = Math.floor((1 - Math.log(Math.tan(maxLat * Math.PI / 180) + 1 / Math.cos(maxLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
                    let maxY = Math.floor((1 - Math.log(Math.tan(minLat * Math.PI / 180) + 1 / Math.cos(minLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
                    for (let x = minX; x <= maxX; x++) { for (let y = minY; y <= maxY; y++) { const c = L.point(x, y); c.z = z; try { urls.push(layer.getTileUrl(c)); } catch (e) {} } }
                });
            } catch (e) {}
            if (!wasOnMap) { try { map.removeLayer(layer); } catch (e) {} }
            out.total = urls.length;
            if (urls.length === 0) return out;
            if (urls.length > cap) { out.skipped = true; return out; }
            for (let i = 0; i < urls.length; i += 8) {
                const chunk = urls.slice(i, i + 8);
                await Promise.all(chunk.map(async u => {
                    // WMS dlazdice jsou cross-origin bez CORS -> no-cors (opaque), cachovat lze.
                    try { const r = await fetch(u, { mode: 'no-cors' }); try { await cache.put(u, r); out.ok++; } catch (e) { out.quota++; } }
                    catch (e) { out.net++; }
                }));
            }
            return out;
        }
        async function cacheTilesForArea(centerLat, centerLng, radius, includeCuzk = false) {
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
            let wms = null;
            if (includeCuzk) {
                // Katastralni mapa KN je pro geodeta v terenu nejdulezitejsi -> pracovni zoomy 17-18.
                // Ortofoto jen z17 (jinak stovky dlazdic a zbytecna zatez CUZK). Strop na vrstvu.
                wms = {};
                try { wms.katastr = await _cacheWmsForArea(cache, (typeof katastrLayer !== 'undefined' ? katastrLayer : null), minLat, maxLat, minLon, maxLon, [17, 18], 1500); } catch (e) {}
                try { wms.ortofoto = await _cacheWmsForArea(cache, (typeof ortofotoLayer !== 'undefined' ? ortofotoLayer : null), minLat, maxLat, minLon, maxLon, [17], 900); } catch (e) {}
            }
            hideOfflineProgress();
            return { ok, total, net, http, quota, wms };
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
            if (res.wms) {
                const w = res.wms;
                const line = (name, r) => { if (!r) return ''; if (r.skipped) return `\n${name}: oblast moc velká pro offline (${r.total} dílků) — zmenšete poloměr.`; if (r.total === 0) return ''; return `\n${name}: uloženo ${r.ok} z ${r.total} dílků` + (r.ok < r.total ? ' ⚠' : ''); };
                msg += line('Katastr KN', w.katastr) + line('Ortofoto', w.ortofoto);
            }
            return msg;
        }
        async function saveForOffline() {
            if (!userLat || !userLng) { agInfo("Počkejte prosím na načtení GPS polohy."); return; }
            const officialPoints = arPoints.filter(p => p.cat !== 'CUSTOM');
            if (!setStoredData('arOfflinePoints12', JSON.stringify(officialPoints))) { return; }
            if (!('caches' in window)) { agInfo("Tento prohlížeč nepodporuje offline ukládání mapy."); return; }
            try {
                const res = await cacheTilesForArea(userLat, userLng, mapRadius, true);
                agInfo(`Uloženo ${officialPoints.length} bodů pro tuto zakázku.\n` + offlineResultMsg(res));
            } catch (e) { hideOfflineProgress(); agInfo("Stahování mapy se nezdařilo: " + ((e && e.message) ? e.message : e)); }
        }

        function hideCurrentPoint() { if (hideBtnLogic) hideBtnLogic(); closeBottomSheet(); quickToast('Bod skryt. Obnovíš ho v Nastavení → Údržba → Skryté body.'); } function restoreHiddenPoints() { const n = arPoints.filter(p => p.hidden).length; arPoints.forEach(p => p.hidden = false); initARMarkers(); drawAllMarkersOnMap(); document.getElementById('settings-modal').style.display = 'none'; updateInfoPanel(); if (typeof renderManageList === 'function' && document.getElementById('manage-modal').style.display === 'flex') renderManageList(); quickToast(n ? ('Obnoveno ' + n + ' skrytých bodů.') : 'Žádné body nebyly skryté.'); } function clearAllPoints() {
            // Destruktivní akce bez záchrany v koši/undo → vždy potvrdit (s počtem bodů).
            const n = arPoints.filter(p => p.cat !== 'CUSTOM').length;
            const msg = 'Opravdu vymazat stažené úřední body této zakázky' + (n ? ' (' + n + ')' : '') + '?\nVlastní body zůstanou. Znovu stáhnout je půjde jen s internetem.';
            const doIt = () => { arPoints.forEach(p => { if(p.element) p.element.remove(); }); arPoints = []; removeStoredData('arOfflinePoints12'); document.getElementById('settings-modal').style.display = 'none'; if (userLat && userLng) initFetch(userLat, userLng); };
            if (window.agConfirm) { window.agConfirm({ title: 'Vymazat stáhnuté okolí', message: msg.replace(/\n/g, '<br>'), okText: 'Vymazat', danger: true }).then(ok => { if (ok) doIt(); }); }
            else if (confirm(msg)) doIt();
        } function getVisiblePointsCount() { return arPoints.filter(p => !p.hidden && p.currentDist <= arRadius && agMatchQuery(p, searchQuery)).length; }
        function exportPoints() { if (persistentCustomPoints.length === 0) return agInfo("Nemáte žádné body."); const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(persistentCustomPoints)); const downloadAnchorNode = document.createElement('a'); downloadAnchorNode.setAttribute("href", dataStr); downloadAnchorNode.setAttribute("download", `moje_body_${activeProjectId}.json`); document.body.appendChild(downloadAnchorNode); downloadAnchorNode.click(); downloadAnchorNode.remove(); }
        // Export do CSV (seznam souradnic): radky "nazev;Y;X" v S-JTSK. BOM kvuli diakritice v Excelu.
        function exportPointsCSV() {
            if (persistentCustomPoints.length === 0) return agInfo("Nemáte žádné body.");
            let lines = persistentCustomPoints.map(pt => {
                let sj = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]);
                let y = Math.abs(sj[0]).toFixed(2), x = Math.abs(sj[1]).toFixed(2);
                let nm = String(pt.name == null ? 'Bod' : pt.name).replace(/[;\r\n]/g, ' ');
                // kod bodu jako 5. sloupec (kdyz je); bez vysky drzime prazdny sloupec Z, at sedi poradi
                let kd = pt.kod ? String(pt.kod).replace(/[;\r\n]/g, ' ') : '';
                return nm + ';' + y + ';' + x + (pt.vyska != null ? ';' + Number(pt.vyska).toFixed(2) : (kd ? ';' : '')) + (kd ? ';' + kd : '');
            });
            const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
            const a = document.createElement('a');
            a.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csv));
            a.setAttribute("download", `body_${activeProjectId}.csv`);
            document.body.appendChild(a); a.click(); a.remove();
        }
        // Export do TXT: stejne radky "nazev;Y;X" jako CSV (jdou rovnou zpet naimportovat), jen bez BOM
        function exportPointsTXT() {
            if (persistentCustomPoints.length === 0) return agInfo("Nem\u00e1te \u017e\u00e1dn\u00e9 body.");
            let lines = persistentCustomPoints.map(pt => {
                let sj = proj4("EPSG:4326", "EPSG:5514", [pt.lng, pt.lat]);
                let nm = String(pt.name == null ? 'Bod' : pt.name).replace(/[;\r\n]/g, ' ');
                let kd = pt.kod ? String(pt.kod).replace(/[;\r\n]/g, ' ') : '';
                return nm + ';' + Math.abs(sj[0]).toFixed(2) + ';' + Math.abs(sj[1]).toFixed(2) + (pt.vyska != null ? ';' + Number(pt.vyska).toFixed(2) : (kd ? ';' : '')) + (kd ? ';' + kd : '');
            });
            const a = document.createElement('a');
            a.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(lines.join("\r\n") + "\r\n"));
            a.setAttribute("download", `body_${activeProjectId}.txt`);
            document.body.appendChild(a); a.click(); a.remove();
        }
        // S-JTSK Y,X (kladne) -> WGS84. Pořadí os podle ROZSAHŮ pro ČR (Y 400-935k,
        // X 935-1300k) — sdílená logika v GeoCore.fromSJTSK; mimo rozsah padá na min/max.
        function sjtskToLatLng(a, b) {
            if (typeof GeoCore !== 'undefined' && GeoCore.fromSJTSK) return GeoCore.fromSJTSK(a, b);
            let Y = Math.min(Math.abs(a), Math.abs(b)), X = Math.max(Math.abs(a), Math.abs(b));
            let wgs = proj4("EPSG:5514", "EPSG:4326", [-Y, -X]); return { lat: wgs[1], lng: wgs[0] };
        }
        // Parser seznamu souradnic: radky "cislo Y X [Z]" oddelene ; , tab nebo mezerou.
        function parseCoordsCSV(text) {
            // Sloupec je CISLO jen tehdy, kdyz je cislem CELY. Driv se pouzival
            // parseFloat, ktery bere jen zacatek retezce: parseFloat('3B') === 3.
            // Geodeticky kod bodu zacinajici cislici (3B, 2A, 1K — bezne v seznamech
            // z Kokese/Gromy) se proto tise ulozil jako VYSKA 3 m a kod se zahodil.
            // Vyska 3 m v Bpv v CR neexistuje (nejniz ~115 m), takze to nikdy nebylo
            // spravne — jen to nebylo videt.
            const _num = (t) => {
                const s = String(t).replace(',', '.').trim();
                return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? parseFloat(s) : NaN;
            };
            let out = [];
            text.split(/\r?\n/).forEach(line => {
                line = line.trim(); if (!line || line.startsWith('#') || line.startsWith('//')) return;
                let delim = line.indexOf(';') >= 0 ? ';' : (line.indexOf('\t') >= 0 ? '\t' : (/\s/.test(line) ? /\s+/ : ','));
                let parts = line.split(delim).map(t => t.trim()).filter(t => t !== '');
                if (parts.length < 3) return;
                let nums = parts.slice(1).map(_num).filter(v => !isNaN(v));
                if (nums.length < 2) return;
                let c = sjtskToLatLng(nums[0], nums[1]);
                // volitelny 4. sloupec = vyska Z (Bpv); posledni NEcislený sloupec = kod bodu (obruba, šachta...)
                const _last = parts[parts.length - 1];
                const kod = (parts.length >= 4 && isNaN(_num(_last))) ? _last : null;
                out.push({ name: parts[0], lat: c.lat, lng: c.lng, vyska: (nums.length >= 3 && isFinite(nums[2]) ? nums[2] : null), kod: kod });
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
                // #3 Helmertova lokalizace: srovnej systematiku GPS JEN u nově měřených GPS bodů
                // (origin 'gps-avg'). Importované přesné S-JTSK, resekční a foto body se NEtransformují.
                try {
                    var _po = p.origin || (p.prov && p.prov.origin);
                    if (window.AGLocalize && window.AGLocalize.active && _po === 'gps-avg' && !p._localized) {
                        var _c = window.AGLocalize.apply(p.lat, p.lng);
                        if (_c && isFinite(_c[0]) && isFinite(_c[1])) { p.lat = _c[0]; p.lng = _c[1]; if (p.vyska != null && window.AGLocalize.applyZ) p.vyska = window.AGLocalize.applyZ(_c[0], _c[1], p.vyska); p._localized = true; }
                    }
                } catch (e) {}
                if (persistentCustomPoints.find(ex => ex.name === p.name && Math.abs(ex.lat - p.lat) < 0.0001 && Math.abs(ex.lng - p.lng) < 0.0001)) return;
                const id = 'cp_' + Date.now() + '_' + Math.round(Math.random() * 1e6);
                const np = { id: id, name: p.name || 'Bod', lat: p.lat, lng: p.lng, cat: 'CUSTOM', type: 'custom' };
                if (p.kod) np.kod = String(p.kod).slice(0, 60);
                if (p.vyska != null && isFinite(p.vyska)) np.vyska = Math.round(p.vyska * 100) / 100;
                if (p.acc != null && isFinite(p.acc)) np.acc = Math.round(p.acc * 100) / 100;
                // #5 provenience: trvale u bodu drž, odkud vznikl (import/přenos/měření) + kdy + přesnost
                np.prov = (p.prov && typeof p.prov === 'object') ? p.prov : { origin: p.origin || 'import', ts: Date.now(), acc: (np.acc != null ? np.acc : null) };
                persistentCustomPoints.push(np);
                arPoints.push({ ...np, hidden: false });   // OPRAVA: hned i do pameti (AR+mapa), jinak videt az po restartu
                if (p.doc && typeof savePointDoc === 'function') { try { savePointDoc(id, (typeof _normalizeDoc === 'function' ? _normalizeDoc(p.doc) : p.doc)); } catch (e) {} }
                try { if (window.AGJournal) window.AGJournal.commit({ op: 'add', id: id, after: np, origin: np.prov.origin }); } catch (e) {}
                added++;
            });
            setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints));
            if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap();
            if (typeof initARMarkers === 'function') initARMarkers();
            if (typeof renderManageList === 'function') renderManageList();
            if (typeof updateInfoPanel === 'function') updateInfoPanel();
            if (userLat && userLng && typeof initFetch === 'function') initFetch(userLat, userLng);
            return added;
        };
        // Detekce kódování: české seznamy souřadnic (Kokeš/Groma/VKM/GP) bývají Windows-1250,
        // ne UTF-8. Zkusíme UTF-8; když vzniknou náhradní znaky (�), spadneme na Windows-1250.
        function _agDecodeText(buf) {
            try {
                var utf = new TextDecoder('utf-8', { fatal: false }).decode(buf);
                if (utf.indexOf('�') >= 0) { try { return new TextDecoder('windows-1250').decode(buf); } catch (e) {} }
                return utf;
            } catch (e) { try { return new TextDecoder('windows-1250').decode(buf); } catch (e2) { return ''; } }
        }
        window._agDecodeBuf = _agDecodeText;
        function importPoints(event) {
            const file = event.target.files[0]; if (!file) return;
            const fname = (file.name || '').toLowerCase();
            const reader = new FileReader();
            reader.onload = function(e) {
                // čteme binárně a detekujeme kódování (kvůli diakritice v číslech/názvech bodů)
                let txt = (typeof e.target.result === 'string') ? e.target.result : _agDecodeText(e.target.result);
                // VFK (výměnný formát ČÚZK): detekce podle přípony nebo obsahu (&B/&D bloky)
                const looksVfk = fname.endsWith('.vfk') || (/^&[HBD]/m.test(txt) && txt.indexOf('&D') >= 0);
                if (looksVfk && typeof window.importVFKText === 'function') {
                    const addedV = window.importVFKText(txt);
                    if (addedV > 0) agInfo("Importováno " + addedV + " bodů z VFK do aktuální zakázky.");
                    else agInfo("Ve VFK se nepodařilo najít body se souřadnicemi (S-JTSK).");
                    event.target.value = ''; return;
                }
                let imported = null;
                try { let j = JSON.parse(txt); if (Array.isArray(j)) imported = j; } catch (err) {}
                if (!imported) imported = parseCoordsCSV(txt);
                if (!imported || imported.length === 0) { agInfo("V souboru se nenašly žádné body.\n\nPodporováno: JSON, CSV/TXT s řádky 'číslo;Y;X' (oddělovač ; , tab nebo mezera), nebo VFK."); event.target.value = ''; return; }
                const added = window.addImportedPoints(imported);
                agInfo("Importováno " + added + " bodů do aktuální zakázky.");
                event.target.value = '';
            };
            reader.readAsArrayBuffer(file);
        }
        // Pozn.: potvrzení musí zůstat synchronní (confirm) — undo.js tuto funkci obaluje
        // snapshotem před/po a async dialog by mu rozbil detekci změny (žádný toast Vrátit zpět).
        // skipConfirm: hromadne mazani z panelu Body uz ma JEDNO spolecne potvrzeni — bez nej
        // by 30 vybranych bodu znamenalo 30 confirm dialogu. Kos/undo obaluji tuto funkci dal.
        // batch (3. argument): pri hromadnem mazani se persist ani prekresleni NEDELA
        // po kazdem bodu — volajici to udela JEDNOU na konci pres flushPointsAfterBulk().
        // Driv kazde jedno smazani znovu serializovalo cele pole bodu i spojnic a
        // zapisovalo je do IndexedDB, takze 500 vybranych bodu = 500 zapisu po ~100 kB.
        function persistCustomPoints() { setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints)); }
        function flushPointsAfterBulk() { persistCustomPoints(); saveLines(); updateInfoPanel(); }
        function deleteCustomPoint(id, skipConfirm, batch) {
            const _pt = persistentCustomPoints.find(p => p.id === id);
            // POTVRZENI: in-app dialog misto nativniho confirm() (ten na iOS mrazi kamerovy
            // stream v AR a na Androidu vyhodi stranku z fullscreenu). Dialog je
            // ASYNCHRONNI, takze po potvrzeni volame funkci ZNOVU pres
            // window.deleteCustomPoint — a ne primo. Je totiz obalena v js/undo.js,
            // js/kos.js i js/journal.js, ktere kolem volani porovnavaji stav (undo toast,
            // kos, zurnal). Prime volani by mazalo mimo ne a "Vratit zpet" by se
            // nikdy neukazalo.
            // Hromadne mazani chodi vzdy se skipConfirm=true (panel Body ma jedno
            // spolecne potvrzeni), takze se tady u davky nikdy neptame.
            if (!skipConfirm) {
                agAsk('Smazat bod „' + ((_pt && _pt.name) || 'bez názvu') + '"?\nVrátit ho půjde 30 dní z koše (Více → Koš).', { title: 'Smazat bod', okText: 'Smazat', danger: true })
                    .then(ok => { if (ok) window.deleteCustomPoint(id, true, batch); });
                return;
            }
            persistentCustomPoints = persistentCustomPoints.filter(p => p.id !== id);
            pointLines = pointLines.filter(l => l.aId !== id && l.bId !== id);
            // arPoints uklidit JESTE PRED prekreslenim mapy: driv se drawAllMarkersOnMap()
            // volalo, kdyz byl mazany bod v arPoints porad — jeho znacka se tedy znovu
            // vykreslila a z mapy zmizela az pri nejakem dalsim prekresleni.
            const idx = arPoints.findIndex(p => p.id === id);
            if (idx !== -1) { if (arPoints[idx].element) arPoints[idx].element.remove(); arPoints.splice(idx, 1); }
            if (batch) return;
            persistCustomPoints(); saveLines(); renderManageList(); drawAllMarkersOnMap(); updateInfoPanel();
        }
        // Vyplnit Y/X z PRUMEROVANE GPS polohy (presnejsi nez jeden odecet) + ulozit dosazenou presnost
        function fillAveragedGPS() {
            // BRANA CERSTVOSTI: kdyz GPS prestala dodavat fixy (tunel, suspend), prumer je
            // ze STARE polohy — bod by se tise ulozil jinam, nez clovek stoji.
            const _fx = window.AGFix;
            if (_fx && _fx.ts && (Date.now() - _fx.ts) > 10000) { agInfo('Poloha je stará ' + Math.round((Date.now() - _fx.ts) / 1000) + ' s — GPS teď nedodává čerstvé fixy.\n\nPočkejte pod volným nebem na obnovení signálu a zkuste to znovu.'); return; }
            if (gpsAvgResult && gpsAvgResult.coarse) { agInfo("Slabý GNSS signál — telefon hlásí síťovou polohu ±" + Math.round(gpsAvgResult.acc) + " m, ne satelitní fix.\n\nVyjdi pod volné nebe a počkej, až se přesnost zlepší pod 20 m."); return; }
            if (!gpsAvgResult || gpsAvgResult.n < 2) { agInfo("Počkejte na ustálení průměrování GPS (stůjte chvíli na místě)."); return; }
            const r = gpsAvgResult; let sjtsk = proj4("EPSG:4326", "EPSG:5514", [r.lng, r.lat]);
            document.getElementById('custom-y').value = Math.abs(sjtsk[0]).toFixed(2);
            document.getElementById('custom-x').value = Math.abs(sjtsk[1]).toFixed(2);
            pendingPointAccuracy = r.sterr;
            window._agPointOrigin = 'gps-avg';   // #2/#5: tenhle bod vzniká z GPS průměru → správná provenience + brána pro Helmert (#3)
            // VYSKA: prumerovana elipsoidicka vyska -> Bpv (odecet undulace geoidu). Chybi-li (desktop), Z necham.
            let bpv = null;
            const _z = document.getElementById('custom-z');
            if (r.alt != null) { bpv = r.alt - getGeoidUndulation(r.lat, r.lng); if (_z) _z.value = bpv.toFixed(2); }
            else if (_z) _z.value = '';
            const note = document.getElementById('custom-acc-note');
            if (note) {
                note.style.display = 'block';
                let h = `Zprůměrováno z <b>${r.n}</b> měření · ⌀ přesnost <b>±${r.sterr.toFixed(2)} m</b> · σ ±${r.sigma.toFixed(2)} m`;
                h += bpv != null ? ` · výška Bpv <b>${bpv.toFixed(2)} m</b>${r.altSterr != null ? ` (±${r.altSterr.toFixed(2)} m, ${r.altN}×)` : ''}` : ` · <span style="opacity:.7">výšku telefon nehlásí</span>`;
                note.innerHTML = h;
            }
        }
        
        // Nový bod musí být v AR i mapě vidět HNED (terénní bug: aktivní „Hledat konkrétní
        // bod" nebo vypnutý filtr „Vlastní" ho tiše schovaly — vypadalo to, že se bod
        // nevytvořil, a pomohl až restart appky, který hledání resetoval).
        let _saveToastShown = false;   // hlidac, at obecne „Bod ulozen“ neprebije durazneji hlaseni nize
        function ensureFreshPointVisible(pt) {
            // vzdálenost/azimut spočti hned — jinak se dopočítají až s dalším GPS fixem
            try {
                const _anch = !!(window.AGPose && window.AGPose.valid && window.AGPose.originLat != null);
                const _oLat = _anch ? window.AGPose.originLat : userLat, _oLng = _anch ? window.AGPose.originLng : userLng;
                if (_oLat != null && _oLng != null) { pt.currentDist = getDistance(_oLat, _oLng, pt.lat, pt.lng); pt.currentBearing = getBearing(_oLat, _oLng, pt.lat, pt.lng); arPoints.sort((a, b) => (a.currentDist || 0) - (b.currentDist || 0)); }
            } catch (e) {}
            // aktivní hledání jména by nový bod schovalo → zrušit a říct to na rovinu
            if (!agMatchQuery(pt, searchQuery)) {
                const _q = searchQuery; searchQuery = '';
                const _inp = document.getElementById('s-search-name'); if (_inp) _inp.value = '';
                quickToast('Zrušeno hledání „' + _q + '", aby byl nový bod vidět.'); _saveToastShown = true;
            }
            // vypnutý filtr „Vlastní" → bod by nebyl vidět v AR ani v mapě
            if (!filters.custom) {
                filters.custom = true; setStoredData('arFilters12', JSON.stringify(filters));
                const _c1 = document.getElementById('f-custom'); if (_c1) _c1.checked = true;
                const _c2 = document.getElementById('w-f-custom'); if (_c2) _c2.checked = true;
                quickToast('Zapnut druh bodů „Vlastní" — nový bod by jinak nebyl vidět.'); _saveToastShown = true;
            }
            // bod dál, než kam AR ukazuje → vysvětlit (v mapě bod je)
            if (pt.currentDist != null && pt.currentDist > arRadius) {
                quickToast('Bod uložen — je ' + Math.round(pt.currentDist) + ' m daleko, v AR se ukáže do ' + Math.round(arRadius) + ' m. Přibliž se, zvětši viditelnost v Nastavení → AR, nebo bod zvýrazni pro navigaci.'); _saveToastShown = true;
            }
        }
        // ===== HLIDANI DUPLICIT PRI UKLADANI NOVEHO BODU ==========================
        // QC inspektor resi PRESNOST, ne preklepy. Bod ulozeny 3 cm od uz existujiciho
        // (dvojity tap na Ulozit, druhe zamereni tehoz rohu) i druhy bod se stejnym
        // cislem dosud prosly uplne tise a nasly se az v kancelari nad exportem.
        const _DUP_DIST = 0.15;   // m — pod tim uz clovek stoji na tomtez miste
        function _dupWarning(name, lat, lng) {
            let near = null, nd = Infinity;
            const nameKey = String(name).trim().toLowerCase();
            let sameName = null;
            for (let i = 0; i < persistentCustomPoints.length; i++) {
                const p = persistentCustomPoints[i];
                if (p.lat != null && p.lng != null) {
                    const d = getDistance(lat, lng, p.lat, p.lng);
                    if (d < nd) { nd = d; near = p; }
                }
                if (!sameName && String(p.name).trim().toLowerCase() === nameKey) sameName = p;
            }
            const tooClose = (near && nd < _DUP_DIST) ? near : null;
            if (!tooClose && !sameName) return null;
            const dTxt = nd < 1 ? (Math.round(nd * 100) + ' cm') : (nd.toFixed(2) + ' m');
            let msg = '';
            if (tooClose) {
                msg += 'Jen <b>' + dTxt + '</b> odsud už leží bod <b>„' + _escHtml(tooClose.name) + '"</b>.';
                if (sameName && sameName.id === tooClose.id) msg += ' Vypadá to, že se ukládá dvakrát totéž.';
                else msg += ' Nechceš spíš upravit ten stávající?';
            }
            if (sameName && (!tooClose || sameName.id !== tooClose.id)) {
                if (msg) msg += '<br><br>';
                msg += 'Bod s názvem <b>„' + _escHtml(name) + '"</b> v zakázce už je. Dva body se stejným číslem se v exportu ani v CAD nerozliší.';
            }
            return { title: tooClose ? 'Bod skoro na stejném místě' : 'Název už je použitý', message: msg };
        }
        let _dupAckOnce = false;   // po potvrzeni "Uložit i tak" se saveCustomPoint zavola znovu

        function saveCustomPoint(keepOpen) {
            let name = String(document.getElementById('custom-name').value || '').trim();
            if (!name) name = agNextSerieName() || "Bod";   // prazdne pole: dalsi cislo serie misto kolidujiciho "Bod"
            const kod = String((document.getElementById('custom-kod') || { value: '' }).value || '').trim();
            // ČÍSLA Z FORMULÁŘE: přes agNum() (js/vstupy.js) — česká klávesnice píše
            // desetinnou ČÁRKU a Safari/iOS takové <input type="number"> vrátí jako
            // prázdné. Pole jsou proto type="text" inputmode="decimal" a parsuje se tady.
            let inputY = agNumIn('custom-y'); let inputX = agNumIn('custom-x');
            if (isNaN(inputY) || isNaN(inputX)) {
                // říct KTERÉ pole je špatně — „Vyplňte souřadnice!" u viditelně
                // vyplněného pole byla nejčastější záhada v terénu
                const _bad = [isNaN(inputY) ? 'Y' : null, isNaN(inputX) ? 'X' : null].filter(Boolean).join(' a ');
                const _prazdne = !String((document.getElementById('custom-y') || {}).value || '').trim() && !String((document.getElementById('custom-x') || {}).value || '').trim();
                return agInfo(_prazdne ? 'Vyplňte souřadnice Y a X.' : ('Souřadnici ' + _bad + ' se nepodařilo přečíst — zkontroluj, jestli tam není písmeno navíc. Čárka i tečka jsou v pořádku.'));
            }
            let krovakY = inputY > 0 ? -inputY : inputY; let krovakX = inputX > 0 ? -inputX : inputX; let wgs84 = proj4("EPSG:5514", "EPSG:4326", [krovakY, krovakX]); let lng = wgs84[0]; let lat = wgs84[1]; var _zin = agNumIn('custom-z'); var vyska = isFinite(_zin) ? Math.round(_zin * 100) / 100 : null;
            // #2/#3: nový bod z GPS průměru srovnej Helmertovou lokalizací staveniště (když je aktivní).
            // Jen pro nově měřený GPS bod — ne při editaci ani u ručně zadaných S-JTSK.
            try {
                if (!editingCustomPointId && window._agPointOrigin === 'gps-avg' && window.AGLocalize && window.AGLocalize.active) {
                    var _lc = window.AGLocalize.apply(lat, lng);
                    if (_lc && isFinite(_lc[0]) && isFinite(_lc[1])) { lat = _lc[0]; lng = _lc[1]; if (vyska != null && window.AGLocalize.applyZ) vyska = window.AGLocalize.applyZ(lat, lng, vyska); }
                }
            } catch (e) {}
            // Kontrola az TEDY: souradnice uz jsou po pripadne Helmertove lokalizaci,
            // takze merime vzdalenost k tomu, co se opravdu ulozi. Formular zustava
            // otevreny, takze po potvrzeni staci zavolat funkci znovu — vsechny vstupy
            // se precmou stejne (prevod je deterministicky).
            if (!editingCustomPointId && !_dupAckOnce) {
                const _w = _dupWarning(name, lat, lng);
                if (_w) {
                    // agConfirm bere HTML; agAsk by <b> vyeskapoval na doslovny text
                    const _q = window.agConfirm
                        ? agConfirm({ title: _w.title, message: _w.message, okText: 'Uložit i tak' })
                        : agAsk(_w.message.replace(/<[^>]*>/g, ''), { title: _w.title, okText: 'Uložit i tak' });
                    _q.then(ok => {
                        if (!ok) return;
                        _dupAckOnce = true;
                        try { saveCustomPoint(keepOpen); } finally { _dupAckOnce = false; }
                    });
                    return;
                }
            }
            let savedId = editingCustomPointId;
            _saveToastShown = false;
            if (editingCustomPointId) { const idx = persistentCustomPoints.findIndex(p => p.id === editingCustomPointId); if(idx !== -1) { persistentCustomPoints[idx].name = name; persistentCustomPoints[idx].lat = lat; persistentCustomPoints[idx].lng = lng; persistentCustomPoints[idx].vyska = vyska; persistentCustomPoints[idx].kod = kod || undefined; } const arIdx = arPoints.findIndex(p => p.id === editingCustomPointId); if (arIdx !== -1) { arPoints[arIdx].name = name; arPoints[arIdx].lat = lat; arPoints[arIdx].lng = lng; arPoints[arIdx].vyska = vyska; arPoints[arIdx].kod = kod || undefined; if(arPoints[arIdx].element) { arPoints[arIdx].element.remove(); arPoints[arIdx].element = null; } } } else { const newPoint = { id: 'cp_' + Date.now() + '_' + Math.round(Math.random() * 1e6), name: name, lat: lat, lng: lng, cat: "CUSTOM", type: "custom" }; if (vyska != null) newPoint.vyska = vyska; if (kod) newPoint.kod = kod; if (pendingPointAccuracy != null) newPoint.acc = Math.round(pendingPointAccuracy * 100) / 100; newPoint.prov = { origin: (window._agPointOrigin || 'ruc'), ts: Date.now(), acc: (newPoint.acc != null ? newPoint.acc : null), qc: ((window.AGQc && AGQc.lastCode) || null) }; persistentCustomPoints.push(newPoint); const _arNew = {...newPoint, hidden: false}; arPoints.push(_arNew); savedId = newPoint.id; try { ensureFreshPointVisible(_arNew); } catch (e) {} try { if (window.AGJournal) window.AGJournal.commit({ op: 'add', id: newPoint.id, after: newPoint, origin: newPoint.prov.origin }); } catch (e) {} } pendingPointAccuracy = null; window._agPointOrigin = null; setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints));
            saveNewPointDoc(savedId);
            try { if (window.AGDraft) AGDraft.clear('novy-bod'); } catch (e) {}   // rozepsany bod je ulozeny -> draft pryc
            const _wasEdit = !!editingCustomPointId;
            // serii posouva jen NOVY bod — prejmenovani stareho bodu na "500" by jinak
            // preskocilo cislovani rozdelane rady
            if (!_wasEdit) _serieSaveFromName(name);
            if (kod) agKodRemember(kod);
            agVibe(30);                                     // hmatove potvrzeni ulozeni (v rukavicich/na slunci)
            const _next = (keepOpen && !_wasEdit);
            drawAllMarkersOnMap(); if (!_next) closeCustomModal(); initARMarkers(); if (userLat && userLng) { updateInfoPanel(); } fixAppLayout();
            if (_next) { agPrepNextPoint(); quickToast('Bod „' + name + '" uložen — formulář je připravený na další číslo.'); }
            else if (!_wasEdit && !_saveToastShown && userLat && userLng) quickToast('Bod „' + name + '" uložen.');
            // BEZ GPS FIXU (offline/uvnitř): mapa by mohla mířit úplně jinam a v AR se bez
            // polohy nic nevykreslí — vycentrujeme mapu na nový bod a řekneme to na rovinu.
            if (!userLat || !userLng) { try { map.setView([lat, lng], Math.max(map.getZoom(), 17), { animate: false }); } catch (e) {} quickToast('Bod uložen a je v mapě. V AR se ukáže, až telefon určí polohu (GPS).'); }
        }
        // Popis + fotka zadané při TVORBĚ bodu (formulář Vložit bod) -> foto-dokumentace bodu
        // (stejné úložiště jako na kartě bodu: savePointDoc v kalkulacka.js).
        function saveNewPointDoc(id) {
            try {
                const ta = document.getElementById('custom-note');
                const note = ta ? ta.value.trim() : '';
                const photo = window._agNewPtPhoto || null;
                if (!id || (!note && !photo) || typeof savePointDoc !== 'function' || typeof loadPointDoc !== 'function') { window._agNewPtPhoto = null; return; }
                loadPointDoc(id).then(doc => {
                    doc = (typeof _normalizeDoc === 'function' ? _normalizeDoc(doc || {}) : (doc || { photos: [] }));
                    if (!Array.isArray(doc.photos)) doc.photos = [];
                    if (note) doc.note = note;
                    if (photo && doc.photos.length < 3) doc.photos.push(photo);
                    doc.t = Date.now();
                    savePointDoc(id, doc);
                });
                window._agNewPtPhoto = null;
            } catch (e) { window._agNewPtPhoto = null; }
        }
        // náhled + zmenšení fotky přiložené ve formuláři nového bodu
        function agNewPointPhoto(event) {
            const file = event.target.files && event.target.files[0]; event.target.value = '';
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let dataUrl = null;
                    try { dataUrl = (typeof _photoToDataUrl === 'function') ? _photoToDataUrl(img) : null; } catch (err) {}
                    if (!dataUrl) { agInfo('Fotku se nepodařilo zpracovat.'); return; }
                    window._agNewPtPhoto = dataUrl;
                    const pv = document.getElementById('custom-photo-note');
                    if (pv) { pv.style.display = 'block'; pv.innerHTML = 'Fotka přiložena ✓ <button type="button" onclick="window._agNewPtPhoto=null; this.parentNode.style.display=\'none\';" style="border:none; background:rgba(255,255,255,0.12); color:inherit; border-radius:99px; padding:3px 10px; margin-left:6px; cursor:pointer;">Odebrat</button>'; }
                };
                img.onerror = () => agInfo('Soubor není platný obrázek.');
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }


        function extractPointNumber(props) { if (!props) return "Bod"; const upperProps = {}; for (let key in props) upperProps[key.toUpperCase()] = props[key]; let name = upperProps['CISLO'] || upperProps['CISLO_BODU'] || upperProps['VLASTNI_CISLO'] || upperProps['OZNACENI'] || upperProps['UPLNE_CISLO'] || upperProps['NAZEV']; if (name && String(name).trim() !== "" && String(name).trim() !== "Null") return String(name).trim(); return "Bod"; }
        // VZDALENOST — pocita GeoCore (jediny autoritativni prevod, testovany proti
        // geodetice WGS84 v tests/cases-geo.js). Fallback nize je pro pripad bez geo-core.js.
        //
        // CHYBA (opraveno): drive tady bylo pevne R = 6371e3, tedy GLOBALNI stredni polomer
        // Zeme. V sirkach CR je skutecny (Gaussuv) polomer ~6382 km, takze KAZDA vzdalenost
        // v appce vychazela systematicky KRATKA o ~1700 ppm — vcetne cisla na stitku AR
        // znacky, podle ktereho se v terenu dohledava bod:
        //      100 m -> -17 cm      200 m -> -34 cm      500 m -> -85 cm      1 km -> -1,7 m
        // Nove Gaussuv polomer ve stredni sirce obou bodu -> chyba < 32 ppm (0,65 cm na 200 m).
        function getDistance(lat1, lon1, lat2, lon2) {
            if (typeof GeoCore !== 'undefined' && GeoCore.getDistance) return GeoCore.getDistance(lat1, lon1, lat2, lon2);
            const _A = 6378137.0, _E2 = 0.00669438002290;          // GRS80
            const sm = Math.sin(((lat1 + lat2) / 2) * Math.PI / 180);
            const w2 = 1 - _E2 * sm * sm, w = Math.sqrt(w2);
            const R = Math.sqrt((_A * (1 - _E2) / (w2 * w)) * (_A / w));   // sqrt(M*N) ve stredni sirce
            const f1 = lat1 * Math.PI/180, f2 = lat2 * Math.PI/180;
            const df = (lat2-lat1) * Math.PI/180, dl = (lon2-lon1) * Math.PI/180;
            const a = Math.sin(df/2) * Math.sin(df/2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl/2) * Math.sin(dl/2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }
        function getBearing(lat1, lon1, lat2, lon2) { const toRad = deg => deg * Math.PI / 180; const toDeg = rad => rad * 180 / Math.PI; const dLon = toRad(lon2 - lon1); const y = Math.sin(dLon) * Math.cos(toRad(lat2)); const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon); return (toDeg(Math.atan2(y, x)) + 360) % 360; }
        // rozdil dvou azimutu normalizovany do <-180, 180>
        function angDiff(a, b) { return ((a - b + 540) % 360) - 180; }
        // cyklicke vyhlazeni uhlu (resi prechod 359 -> 0); alpha 0..1 (vyssi = rychlejsi)
        function smoothAngle(prev, next, alpha) { if (prev === null) return ((next % 360) + 360) % 360; return ((prev + alpha * angDiff(next, prev)) % 360 + 360) % 360; }
        // MAGNETICKA DEKLINACE: kompas (senzor) meri magneticky sever, ale azimuty (getBearing)
        // pocitame k zemepisnemu severu. V CR je deklinace ~+5-6 vychodne a roste -> bez korekce
        // systematicka chyba smeru. Aproximace WMM2025 (linearni fit pro CR), driftuje +0.13 /rok.
        function getDeclination(lat, lng) {
            if (typeof GeoCore !== 'undefined' && GeoCore.declination) return GeoCore.declination(lat, lng); // + clamp na bbox CR
            const now = new Date(); const year = now.getFullYear() + now.getMonth() / 12;
            return 5.65 + 0.25 * (lng - 15.5) - 0.05 * (lat - 49.8) + 0.13 * (year - 2025);
        }
        // VYSKA: coords.altitude je elipsoidicka (WGS84). Pro Bpv (vyska nad morem v CR) odecist
        // undulaci kvazigeoidu CR-2005 (~44-47 m). Linearni aproximace, presnost ~1-2 m
        // (hluboko pod svislou chybou telefonni GPS), odstranuje systematicky posun ~45 m.
        function getGeoidUndulation(lat, lng) { if (typeof GeoCore !== 'undefined' && GeoCore.geoidUndulation) return GeoCore.geoidUndulation(lat, lng); return 45.5 + 0.55 * (lng - 15.5) - 0.4 * (lat - 49.8); }
        // ============================================================================
        // AGPose — JEDINÝ zdroj pravdy o poloze/orientaci "stanoviska" pro AR i měřické
        // moduly. Dřív se přesná póza z resekce (solveResection) spočítala a ZAHODILA;
        // AR dál kotvilo na syrový GPS fix a značky tančily ±3–7 m. Teď: resekce nastaví
        // origin, renderAR z něj čte a syrová GPS slouží jen jako "drift detektor".
        // Priorita zdrojů: resection > (gps s ref-shiftem) > raw. Vše 100% offline.
        // ============================================================================
        window.AGPose = window.AGPose || (function () {
            var P = {
                originLat: null, originLng: null, originZ: null,
                headingOffset: 0, posSigma: null, eyeH: null,
                source: 'gps', ts: 0, valid: false, note: ''
            };
            function _ensureBadge() {
                var el = document.getElementById('agpose-badge');
                if (el) return el;
                if (!document.getElementById('agpose-badge-css')) {
                    var st = document.createElement('style'); st.id = 'agpose-badge-css';
                    st.textContent = '#agpose-badge{position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 54px);z-index:640;display:none;align-items:center;gap:7px;'
                        + 'background:rgba(16,32,22,.82);color:#d7ffe6;border:1px solid rgba(52,211,153,.5);border-radius:99px;padding:5px 6px 5px 12px;font-size:calc(12.5px * var(--ag-font-scale, 1));font-weight:600;'
                        + 'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:auto;}'
                        + '#agpose-badge .dot{width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 8px #34d399;animation:agposePulse 1.8s ease-in-out infinite;}'
                        + '#agpose-badge button{border:none;background:rgba(255,255,255,.14);color:#fff;border-radius:99px;padding:3px 9px;font-size:calc(11.5px * var(--ag-font-scale, 1));cursor:pointer;font-weight:600;}'
                        + '@keyframes agposePulse{0%,100%{opacity:1}50%{opacity:.35}}'
                        + 'body.left-hand #agpose-badge{}';
                    (document.head || document.documentElement).appendChild(st);
                }
                el = document.createElement('div'); el.id = 'agpose-badge';
                (document.body || document.documentElement).appendChild(el);
                return el;
            }
            function _badge() {
                var el = _ensureBadge();
                if (!el) return;
                if (P.valid && P.source === 'resection') {
                    el.style.display = 'flex';
                    el.innerHTML = '<span class="dot"></span>Zakotveno · resekce'
                        + (P.posSigma != null ? ' ±' + P.posSigma.toFixed(2) + ' m' : '')
                        + '<button type="button" onclick="window.AGPose.clear(true)">zrušit</button>';
                } else { el.style.display = 'none'; }
            }
            P.set = function (pose) {
                if (!pose || pose.originLat == null || pose.originLng == null) return;
                P.originLat = pose.originLat; P.originLng = pose.originLng;
                P.originZ = (pose.originZ != null) ? pose.originZ : null;
                P.posSigma = (pose.posSigma != null) ? pose.posSigma : null;
                P.eyeH = (pose.eyeH != null) ? pose.eyeH : null;
                P.headingOffset = (pose.headingOffset != null) ? pose.headingOffset : 0;
                P.source = pose.source || 'resection';
                P.note = pose.note || '';
                P.ts = Date.now(); P.valid = true;
                // #3 drift baseline: ulož GPS polohu V OKAMŽIKU zakotvení. Drift pak měříme jako
                // posun GPS_teď vs GPS_baseline (skutečná chůze), NE vzdálenost origin↔GPS (to je jen
                // velikost GPS biasu, kterou resekce právě opravila → jinak by se dobrá resekce hned smazala).
                P.gpsBaseLat = (typeof userLat === 'number' && isFinite(userLat)) ? userLat : null;
                P.gpsBaseLng = (typeof userLng === 'number' && isFinite(userLng)) ? userLng : null;
                P._driftFixes = 0;
                // #10: přepočítej AR vzdálenosti/azimuty HNED z nového originu, ať značky neskáčou až po dalším GPS fixu
                try { if (typeof arPoints !== 'undefined' && arPoints && arPoints.length && typeof getBearing === 'function') { arPoints.forEach(function (p) { p.currentDist = getDistance(P.originLat, P.originLng, p.lat, p.lng); p.currentBearing = getBearing(P.originLat, P.originLng, p.lat, p.lng); }); window._lastCalcAnchored = true; } } catch (e) {}
                try { window.dispatchEvent(new CustomEvent('agpose:change', { detail: { valid: true, source: P.source } })); } catch (e) {}
                _badge();
            };
            // vrací [lat,lng] originu když platný, jinak fallback (typicky syrová GPS)
            P.origin = function (fallLat, fallLng) {
                return (P.valid && P.originLat != null) ? [P.originLat, P.originLng] : [fallLat, fallLng];
            };
            P.clear = function (userInitiated) {
                var was = P.valid;
                P.valid = false; P.source = 'gps'; P.originLat = P.originLng = P.originZ = P.posSigma = null;
                P.gpsBaseLat = P.gpsBaseLng = null; P._driftFixes = 0;
                // #10: zpět na syrovou GPS — přepočítej hned
                try { if (typeof arPoints !== 'undefined' && arPoints && arPoints.length && typeof getBearing === 'function' && typeof userLat === 'number' && userLat != null) { arPoints.forEach(function (p) { p.currentDist = getDistance(userLat, userLng, p.lat, p.lng); p.currentBearing = getBearing(userLat, userLng, p.lat, p.lng); }); window._lastCalcAnchored = false; } } catch (e) {}
                if (was) { try { window.dispatchEvent(new CustomEvent('agpose:change', { detail: { valid: false } })); } catch (e) {} }
                _badge();
                if (userInitiated && typeof quickToast === 'function') quickToast('Kotvení zrušeno — AR jede zpět z GPS.');
            };
            // drift detektor: volá se s každým GPS fixem. Měří posun GPS_teď vs GPS_baseline
            // (z okamžiku zakotvení) = skutečná chůze. Práh 8 m je nad běžným šumem telefonní
            // GPS (posSigma resekce sem NEpatří — to je bias, ne pohyb). Když baseline chybí,
            // doplní se z prvního fixu (žádné falešné smazání).
            P._driftFixes = 0;
            P.checkDrift = function (lat, lng) {
                if (!P.valid || P.source !== 'resection' || lat == null) return;
                if (typeof getDistance !== 'function') return;
                if (P.gpsBaseLat == null || P.gpsBaseLng == null) { P.gpsBaseLat = lat; P.gpsBaseLng = lng; return; }
                var d = getDistance(P.gpsBaseLat, P.gpsBaseLng, lat, lng);
                var thr = 8;
                if (d > thr) {
                    // hystereze: 3 fixy za sebou mimo práh, ať nás nerozhodí jeden výstřel GPS
                    if (++P._driftFixes >= 3) {
                        P._driftFixes = 0;
                        P.clear(false);
                        if (typeof quickToast === 'function') quickToast('Odešel jsi ze stanoviska — AR zpět na GPS. Znovu zakotvi resekcí.');
                    }
                } else { P._driftFixes = 0; }
            };
            return P;
        })();
        // ROBUSTNI PRUMEROVANI GPS: median + MAD filtr hrubych chyb (prumer i 2-sigma prah
        // si outlier nafoukne sam, median ne), pak vazeny prumer podle hlasene presnosti fixu.
        // sterr pocitame z efektivniho n (po sobe jdouci fixy jsou korelovane, nejsou nezavisle).
        function _median(arr) { const a = arr.slice().sort((p, q) => p - q); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
        function updateGpsAveraging(lat, lng, acc, speed, alt, altAcc) {
            // HRUBY FIX: presnost horsi nez GPS_COARSE_ACC = sitova/fused poloha (Wi-Fi/cell), ne
            // realny satelitni GNSS. Takove vzorky do presneho prumeru NEpoustime — jinak vyleze
            // klidne +-17 m i na otevrenem poli (garbage in). Misto toho oznacime stav "coarse"
            // a appka rekne "cekam na satelitni fix". Mame-li uz dobre vzorky, hruby fix ignorujeme.
            const GPS_COARSE_ACC = 20;
            if (acc && acc > GPS_COARSE_ACC) {
                if (!gpsSamples.length) { gpsAvgResult = { coarse: true, acc: acc, n: 0, total: 0 }; updateGpsAvgPanel(); }
                return;
            }
            if (gpsSamples.length) {
                const ref = gpsAvgResult || gpsSamples[gpsSamples.length - 1];
                const moved = getDistance(ref.lat, ref.lng, lat, lng);
                // Reset prumeru jen na SKUTECNY pohyb (chuze dle rychlosti), NE na ojedinely
                // skok GPS sumu pri slabem signalu — jinak se prumer nikdy nenaakumuluje prave
                // tam, kde je signal nejhorsi (u zastavby/lesa). Prah skoku skalujeme hlasenou
                // presnosti a vyzadujeme 2 po sobe jdouci skoky, nez zahodime nasbirane vzorky
                // (ojedinely spike stejne odfiltruje MAD orez nize).
                const walking = (speed != null && isFinite(speed) && speed > 0.5);
                const jumpThr = Math.max(15, 3 * (acc || 5));
                if (walking) { gpsSamples = []; _gpsJump = 0; }
                else if (moved > jumpThr) { if (++_gpsJump >= 2) { gpsSamples = []; _gpsJump = 0; } }
                else { _gpsJump = 0; }
            }
            gpsSamples.push({ t: Date.now(), lat: lat, lng: lng, acc: (acc || 0), alt: (alt != null && isFinite(alt) ? alt : null), altAcc: (altAcc != null && isFinite(altAcc) ? altAcc : null) });
            if (gpsSamples.length > 300) gpsSamples.shift();
            const total = gpsSamples.length;
            // lokalni rovinne souradnice v metrech (kolem prvniho vzorku); poloměry
            // křivosti elipsoidu místo konstanty 111320 (ta má ~0,15 % systematickou chybu)
            const lat0 = gpsSamples[0].lat, lng0 = gpsSamples[0].lng;
            const _mpd = GeoCore.metersPerDeg(lat0);
            const mLat = _mpd.lat, mLng = _mpd.lng;
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
            // VAHA VZORKU = 1/acc² (hlasena presnost)  ×  vaha USTALENI (delka mereni).
            // Prvni sekundy po zacatku serie jsou nejhorsi: telefonem se jeste hybe,
            // prijimac dopocitava ionosfericky model a multipath filtr, drzi se v ruce.
            // Cim dele lezi na miste, tim vic vzorku dava a tim je kazdy z nich vic
            // "usazeny" -> vaha roste linearne z SETTLE_MIN na 1 za SETTLE_FULL sekund.
            // Vazi se CAS OD ZACATKU SERIE (ne poradi vzorku): pri prerusovanem signalu
            // se pocet fixu a doba mereni rozchazeji, a rozhoduje doba.
            const SETTLE_MIN = 0.25, SETTLE_FULL = 60;
            const _t0s = used.reduce((mn, p) => Math.min(mn, p.s.t || 0), Infinity);
            const _settle = (s) => {
                const age = ((s.t || 0) - _t0s) / 1000;
                if (!isFinite(age) || age <= 0) return SETTLE_MIN;
                return SETTLE_MIN + (1 - SETTLE_MIN) * Math.min(1, age / SETTLE_FULL);
            };
            let sw = 0, swx = 0, swy = 0;
            used.forEach(p => { const w = _settle(p.s) / Math.pow(Math.max(p.s.acc || 5, 1), 2); sw += w; swx += w * p.x; swy += w * p.y; });
            const wx = swx / sw, wy = swy / sw;
            // sigma kolem TEHOZ stredu, ktery hlasime (vazeny prumer), s N-2 stupni
            // volnosti (2D stred). Drive se pocitalo kolem prumeru, ale delilo plnym N.
            const _resX = used.map(p => p.x - wx), _resY = used.map(p => p.y - wy);
            const sigma = Math.sqrt(_resX.reduce((a, v, i) => a + v * v + _resY[i] * _resY[i], 0) / Math.max(1, used.length - 2));
            // Efektivni pocet NEZAVISLYCH vzorku: fixy 1 Hz jsou silne korelovane
            // (multipath se dekoreluje az za desitky sekund). Lag-1 autokorelace
            // rezidui + cap podle delky mereni (tau ~30 s). Drive N/4 — ~10x optimisticke.
            const neff = GeoCore.effectiveN(_resX, _resY, used.map(p => p.s.t || 0), 30);
            // POZOR na falesnou presnost: sterr je jen VNITRNI rozptyl prumeru. Mobilni GNSS bez
            // RTK ma ale dominantni SYSTEMATICKOU slozku (multipath/troposfera/konstelace), kterou
            // prumerovani NEodstrani. Proto sterr zdola omezime realnou mezi ~0.3x nejlepsi hlasena
            // presnost (min 0.2 m), at panel nehlasi centimetry tam, kde je realna chyba metr.
            const bestAcc = used.reduce((m, p) => Math.min(m, (p.s.acc || 99)), 99);
            const sterrFloor = Math.max(0.3 * bestAcc, 0.2);
            const sterr = Math.max(sigma / Math.sqrt(neff), sterrFloor);
            const meanAcc = used.reduce((a, p) => a + (p.s.acc || 0), 0) / used.length;
            // --- VYSKA (Z): robustni prumer ELIPSOIDICKE vysky z dobrych (polohove inlier) fixu.
            // Svisla GPS chyba je 1.5-3x horsi nez vodorovna -> stejne jako polohu ji prumerujeme
            // (median + MAD orez svislych outlieru, vazeny prumer podle altitudeAccuracy). Prevod na
            // Bpv (odecet undulace geoidu) az pri vyplneni do bodu. alt==null (desktop) -> neurci se.
            let altMean = null, altSterr = null, altN = 0;
            {
                let aS = used.map(p => p.s).filter(s => s.alt != null && isFinite(s.alt));
                if (aS.length >= 2) {
                    const amed = _median(aS.map(s => s.alt));
                    if (aS.length >= 5) {
                        const athr = Math.max(3 * 1.4826 * _median(aS.map(s => Math.abs(s.alt - amed))), 1.0); // min 1 m svisle
                        const inl = aS.filter(s => Math.abs(s.alt - amed) <= athr);
                        if (inl.length >= 3) aS = inl;
                    }
                    let asw = 0, asum = 0;
                    // stejne vazeni ustalenim jako u polohy (svisla slozka se usazuje jeste dele)
                    aS.forEach(s => { const w = _settle(s) / Math.pow(Math.max(s.altAcc || 10, 1), 2); asw += w; asum += w * s.alt; });
                    altMean = asum / asw;
                    const _resZ = aS.map(s => s.alt - altMean);
                    const asig = Math.sqrt(_resZ.reduce((a, v) => a + v * v, 0) / Math.max(1, aS.length - 1));
                    // svisla chyba je korelovana jeste silneji nez poloha (ionosfera) -> tau 45 s
                    const neffV = GeoCore.effectiveN(_resZ, null, aS.map(s => s.t || 0), 45);
                    const bestAltAcc = aS.reduce((mn, s) => Math.min(mn, (s.altAcc || 99)), 99);
                    altSterr = Math.max(asig / Math.sqrt(neffV), Math.max(0.5 * bestAltAcc, 0.4));
                    altN = aS.length;
                }
            }
            gpsAvgResult = { lat: lat0 + wy / mLat, lng: lng0 + wx / mLng, n: used.length, total: total, sigma: sigma, sterr: sterr, acc: meanAcc, coarse: false, alt: altMean, altSterr: altSterr, altN: altN };
            updateGpsAvgPanel();
        }

        // FETCH s timeoutem: aby se stahovani nezaseklo navzdy, kdyz CUZK neodpovida.
        // Pri chybe site/timeoutu nastavi lastFetchNetworkError a chybu znovu vyhodi (puvodni try/catch ji spolkne).
        let lastFetchNetworkError = false;
        let lastFetchServerError = false;   // HTTP 4xx/5xx/429 nebo ArcGIS {error} — ODLISENO od "prazdna oblast"
        function fetchWithTimeout(url, ms = 12000) {
            const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
            return fetch(url, { signal: ctrl.signal })
                .catch(err => { lastFetchNetworkError = true; throw err; })
                .finally(() => clearTimeout(t));
        }
        function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
        // Robustni nacteni JSON z CUZK: kontroluje response.ok i ArcGIS chybu (HTTP 200 s {error}),
        // s retry+backoffem na docasne chyby (429/5xx/timeout). Vraci data nebo null (a nastavi flag).
        // DRIVE: response.json() se volalo na cokoliv -> 429/HTML chyba spadla do prazdneho catch a
        // vypadala jako "zadne body", takze limit/vypadek byl k nerozeznani od prazdne oblasti.
        async function _cuzkFetchJson(url, tries = 3) {
            let delay = 600;
            for (let attempt = 1; attempt <= tries; attempt++) {
                try {
                    const res = await fetchWithTimeout(url);
                    if (!res.ok) {
                        if ((res.status === 429 || res.status >= 500) && attempt < tries) { await _sleep(delay); delay *= 2; continue; }
                        lastFetchServerError = true; return null;
                    }
                    let data;
                    try { data = await res.json(); }
                    catch (e) { if (attempt < tries) { await _sleep(delay); delay *= 2; continue; } lastFetchServerError = true; return null; }
                    if (data && data.error) { if (attempt < tries) { await _sleep(delay); delay *= 2; continue; } lastFetchServerError = true; return null; }
                    return data;
                } catch (e) {
                    // sit/timeout: fetchWithTimeout uz nastavil lastFetchNetworkError
                    if (attempt < tries) { await _sleep(delay); delay *= 2; continue; }
                    return null;
                }
            }
            return null;
        }
        // stabilni ID z polohy bodu -> pri opakovanem fetchi si bod udrzi stejne id (zvyrazneni, detail)
        function stableId(lat, lng) { return 'p_' + lat.toFixed(6) + '_' + lng.toFixed(6); }

        async function fetchGeodata(lat, lng, radius, clearExisting = false, onProgress = null) {
            lastFetchNetworkError = false; lastFetchServerError = false;
            if (clearExisting) { arPoints.forEach(p => { if(p.element) p.element.remove(); }); arPoints = []; persistentCustomPoints.forEach(pt => arPoints.push({...pt})); }
            const fetchRadius = radius || mapRadius; const latOffset = fetchRadius / 111320; const lngOffset = fetchRadius / (111320 * Math.cos(lat * Math.PI / 180)); const bbox = `${lng - lngOffset},${lat - latOffset},${lng + lngOffset},${lat + latOffset}`; let newFoundCount = 0;
            let _gstep = 0; for (let layerId of [1, 2, 4, 5, 6]) { if (onProgress) onProgress(_gstep++, 6); 
                const url = `https://ags.cuzk.gov.cz/arcgis/rest/services/BodovaPole/MapServer/${layerId}/query?where=1%3D1&geometry=${bbox}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=json`;
                try { const data = await _cuzkFetchJson(url); if (data && data.features && data.features.length > 0) { data.features.forEach(feat => { const dist = getDistance(lat, lng, feat.geometry.y, feat.geometry.x); if (dist <= fetchRadius + 5) { const props = feat.attributes; const layerNum = parseInt(layerId, 10); const cisloBodu = extractPointNumber(props); const nameUpper = cisloBodu.toUpperCase(); let cat = "PBPP"; if (layerNum === 1) cat = "TB"; else if (layerNum === 2) cat = "ZHB"; else if (layerNum === 4 || layerNum === 5 || nameUpper.includes('-') || nameUpper.includes('NIVEL')) cat = "NIVEL"; const existing = arPoints.find(p => p.name === cisloBodu && Math.abs(p.lat - feat.geometry.y) < 0.00001); if (!existing) { arPoints.push({ id: stableId(feat.geometry.y, feat.geometry.x), name: cisloBodu, lat: feat.geometry.y, lng: feat.geometry.x, cat: cat, type: (cat==="NIVEL"?"vyskovy":"polohovy"), rawData: props, hidden: false, currentDist: dist, bestAccuracy: null }); newFoundCount++; } else if (existing.hidden) { existing.hidden = false; newFoundCount++; } } }); } } catch(e) {}
            }
            if (newFoundCount === 0 || !clearExisting) {
                const mapExtent = `${lng-0.005},${lat-0.005},${lng+0.005},${lat+0.005}`; const idUrl = `https://ags.cuzk.gov.cz/arcgis/rest/services/BodovaPole/MapServer/identify?geometry=${lng},${lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=${Math.max(fetchRadius, 40)}&mapExtent=${mapExtent}&imageDisplay=1000,1000,96&returnGeometry=true&f=json`;
                try { const idData = await _cuzkFetchJson(idUrl); if (idData && idData.results && idData.results.length > 0) { idData.results.forEach(res => { const dist = getDistance(lat, lng, res.geometry.y, res.geometry.x); if (dist <= fetchRadius + 5) { const props = res.attributes; const layerNum = parseInt(res.layerId, 10); const cisloBodu = extractPointNumber(props); const nameUpper = cisloBodu.toUpperCase(); let cat = "PBPP"; if (layerNum === 1) cat = "TB"; else if (layerNum === 2) cat = "ZHB"; else if (layerNum === 4 || layerNum === 5 || nameUpper.includes('-') || nameUpper.includes('NIVEL')) cat = "NIVEL"; const existing = arPoints.find(p => p.name === cisloBodu && Math.abs(p.lat - res.geometry.y) < 0.00001); if (!existing) { arPoints.push({ id: stableId(res.geometry.y, res.geometry.x), name: cisloBodu, lat: res.geometry.y, lng: res.geometry.x, cat: cat, type: (cat==="NIVEL"?"vyskovy":"polohovy"), rawData: props, hidden: false, currentDist: dist, bestAccuracy: null }); newFoundCount++; } else if (existing.hidden) { existing.hidden = false; newFoundCount++; } } }); } } catch(e) {}
            }
            // Kazde zvlast: kdyz spadne initARMarkers (AR), MUSI se stejne prekreslit
            // mapa — jinak jedna chyba v AR schova body i v mape.
            if (onProgress) onProgress(6, 6);
            try { initARMarkers(); } catch (e) {}
            try { drawAllMarkersOnMap(); } catch (e) {}
            return newFoundCount;
        }

        async function initFetch(lat, lng) {
            document.getElementById('info').innerHTML = `Stahuji data…`;
            await fetchGeodata(lat, lng, mapRadius, false);
            const officialCount = arPoints.filter(p => p.cat !== 'CUSTOM').length;
            if ((lastFetchNetworkError || lastFetchServerError) && officialCount === 0) {
                const why = lastFetchNetworkError ? 'nedostupné / offline' : 'neodpovídá (limit?)';
                document.getElementById('info').innerHTML = `<div class="rdt"><span class="rdt-l">ČÚZK</span><span class="rdt-v" style="color:var(--danger);">${why}</span></div>`;
            } else { updateInfoPanel(); }
        }


        // TRVALÉ ÚLOŽIŠTĚ: na iOS hrozí smazání dat (localStorage i IndexedDB) po ~7 dnech
        // nečinnosti. Požádáme o trvalé úložiště — pomáhá na Androidu/desktopu, na iOS neuškodí.
        // Vysledek si pamatujeme (window._agPersisted) -> ukazatel uloziste v Nastavenich pak muze
        // uzivatele varovat, kdyz je trvale uloziste ODMITNUTE (typicky iOS) a data hrozi smazanim.
        window._agPersisted = null;
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(function (g) { window._agPersisted = !!g; }).catch(function () {}); } catch (e) {}

        // Ukazatel obsazeni uloziste + stavu trvaleho uloziste + posledni zalohy (Nastaveni -> Udrzba).
        // Dava uzivateli VIDITELNOST driv, nez narazi do kvoty a body se prestanou ukladat.
        window.agRenderStorageUsage = async function () {
            const el = document.getElementById('storage-usage'); if (!el) return;
            let parts = [];
            try {
                if (navigator.storage && navigator.storage.estimate) {
                    const est = await navigator.storage.estimate();
                    const used = est.usage || 0, quota = est.quota || 0;
                    const mb = n => (n / 1048576).toFixed(1);
                    const pct = quota ? Math.round(used / quota * 100) : 0;
                    let line = `Využito <b>${mb(used)} MB</b>` + (quota ? ` z ~${mb(quota)} MB (${pct} %)` : '');
                    if (quota && pct >= 85) line += ' <span style="color:var(--danger);">⚠ skoro plné</span>';
                    parts.push(line);
                } else parts.push('Prohlížeč nehlásí obsazení úložiště.');
            } catch (e) { parts.push('Obsazení úložiště se nepodařilo zjistit.'); }
            if (window._agPersisted === true) parts.push('trvalé úložiště: <b>ano</b>');
            else if (window._agPersisted === false) parts.push('trvalé: <b>ne</b> — na iOS hrozí smazání dat po ~7 dnech nečinnosti, dělejte zálohy');
            try {
                const last = parseInt(localStorage.getItem('arLastBackupAt') || '0', 10);
                if (last) { const d = Math.round((Date.now() - last) / 86400000); parts.push('poslední záloha: <b>' + (d <= 0 ? 'dnes' : d + ' dní zpět') + '</b>'); }
                else parts.push('<span style="color:var(--warning);">záloha zatím nebyla stažena</span>');
            } catch (e) {}
            el.innerHTML = parts.join(' · ');
        };

        // Stav pro preskok prepoctu vzdalenosti/azimutu, kdyz uzivatel stoji (setri CPU pri stovkach bodu).
        let _lastCalcLat = null, _lastCalcLng = null, _lastCalcCount = 0;
        // SLEDOVANI POLOHY: driv se watchPosition registroval JEDNOU pri startu. Kdyz
        // uzivatel omylem ukl "Nepovolit" (nebo byl v tunelu pri startu), nesla poloha
        // uz nijak nahodit — museloval zabit appku a spustit ji znovu. Ted je to funkce,
        // kterou umi znovu zavolat tlacitko "Zkusit znovu" v chybove hlasce.
        let _gpsWatchId = null;
        function agStartGpsWatch() {
            if (!("geolocation" in navigator)) return false;
            // stary watch zrusit, jinak by po opakovanem spusteni bezely dva naráz (a zral baterii)
            if (_gpsWatchId != null) { try { navigator.geolocation.clearWatch(_gpsWatchId); } catch (e) {} _gpsWatchId = null; }
            _gpsWatchId = navigator.geolocation.watchPosition(
                (position) => {
                    userLat = position.coords.latitude; userLng = position.coords.longitude; magneticDeclination = getDeclination(userLat, userLng);
                    try { if (window.AGPose) window.AGPose.checkDrift(userLat, userLng); } catch (e) {}   // #1: kotvení se zneplatní, když reálně odejdu ze stanoviska
                    userAlt = (position.coords.altitude != null && isFinite(position.coords.altitude)) ? position.coords.altitude : null;
                    currentGpsAccuracy = position.coords.accuracy; updateInfoPanel();
                    // SEMAFOR DUVERY POLOHY: timestamp posledniho fixu pro js/gps-trust.js.
                    // Bez nej se zamrzla GPS (tunel, iOS suspend) nepozna — userLat/acc drzi
                    // posledni hodnotu a AR/mereni tise jede ze stare polohy.
                    window.AGFix = { ts: Date.now(), lat: userLat, lng: userLng, acc: currentGpsAccuracy, alt: userAlt, err: null };
                    // posledni znama poloha pro vychozi pohled mapy pri pristim startu (i offline); max 1x/30 s
                    if (!window._agLastPosTs || Date.now() - window._agLastPosTs > 30000) { window._agLastPosTs = Date.now(); try { localStorage.setItem('arLastPos', JSON.stringify({ lat: userLat, lng: userLng })); } catch (e) {} }
                    gpsSpeed = (position.coords.speed != null && !isNaN(position.coords.speed)) ? position.coords.speed : 0;
                    if (position.coords.heading != null && !isNaN(position.coords.heading) && gpsSpeed > 0.5) gpsCourse = position.coords.heading;
                    updateGpsAveraging(userLat, userLng, currentGpsAccuracy, gpsSpeed, position.coords.altitude, position.coords.altitudeAccuracy);
                    if (accuracyCircle) { accuracyCircle.setLatLng([userLat, userLng]); accuracyCircle.setRadius(currentGpsAccuracy); accuracyCircle.setStyle({ color: currentGpsAccuracy >= 7 ? '#ef4444' : '#34d399', fillColor: currentGpsAccuracy >= 7 ? '#ef4444' : '#34d399' }); } else { accuracyCircle = L.circle([userLat, userLng], { radius: currentGpsAccuracy, color: currentGpsAccuracy >= 7 ? '#ef4444' : '#34d399', fillColor: currentGpsAccuracy >= 7 ? '#ef4444' : '#34d399', fillOpacity: 0.15, weight: 2 }).addTo(map); }
                    
                    if (highlightedPointId) { let hlPt = arPoints.find(p => p.id === highlightedPointId); if (hlPt) { if (hlPt.bestAccuracy === null || currentGpsAccuracy < hlPt.bestAccuracy) { hlPt.bestAccuracy = currentGpsAccuracy; } } }

                    var _movedCalc = (_lastCalcLat === null) ? 999 : getDistance(_lastCalcLat, _lastCalcLng, userLat, userLng);
                    // #1 AGPose: když je stanovisko zakotvené (resekce), počítej AR vzdálenosti/azimuty
                    // z originu, ne ze syrového GPS fixu — konec ±m tančení. Bez kotvení = GPS jako dřív.
                    var _anch = !!(window.AGPose && window.AGPose.valid && window.AGPose.originLat != null);
                    var _oc = _anch ? [window.AGPose.originLat, window.AGPose.originLng] : [userLat, userLng];
                    if (_movedCalc > 0.25 || arPoints.length !== _lastCalcCount || _anch !== window._lastCalcAnchored) { window._lastCalcAnchored = _anch; var _brgLim = (arRadius || 150) * 1.25;
                        // VYKON: currentBearing potrebuje jen AR projekce, a ta stejne vsechno
                        // za arRadius zahodi. Prepocet bezi po kazdych 0,25 m chuze, takze u
                        // zakazky s tisicem bodu to usetri polovinu goniometrie za sekundu.
                        // Kdo azimut potrebuje i dal (cil navigace), ma u sebe fallback
                        // `pt.currentBearing != null ? ... : getBearing(...)`.
                        arPoints.forEach(p => { p.currentDist = getDistance(_oc[0], _oc[1], p.lat, p.lng); p.currentBearing = (p.currentDist <= _brgLim) ? getBearing(_oc[0], _oc[1], p.lat, p.lng) : null; }); arPoints.sort((a, b) => a.currentDist - b.currentDist); _lastCalcLat = userLat; _lastCalcLng = userLng; _lastCalcCount = arPoints.length; }
                    if (activePointIdForModal) { const activePt = arPoints.find(p => p.id === activePointIdForModal); if (activePt) { const newDist = getDistance(userLat, userLng, activePt.lat, activePt.lng); const distEl = document.getElementById('sheet-distance-val'); if (distEl) distEl.innerText = `${newDist.toFixed(1)} m`; const gpsEl = document.getElementById('sheet-gps-val'); if (gpsEl) gpsEl.innerText = currentGpsAccuracy.toFixed(1); } }
                    if (lastCenterLat === null) { map.setView([userLat, userLng], 19, { animate: false }); lastCenterLat = userLat; lastCenterLng = userLng; } else if (!window._mapHold && getDistance(lastCenterLat, lastCenterLng, userLat, userLng) > 1.5) { map.setView([userLat, userLng], map.getZoom(), { animate: false }); lastCenterLat = userLat; lastCenterLng = userLng; }
                    // BATERIE/RADIO: dotazovat CUZK po kazdych 25 m chuze bylo silne redundantni —
                    // stahuje se okruh o polomeru mapRadius, takze dve sousedni davky se
                    // prekryvaji z >90 %, a jedna davka = 6 URL (pri chybe az 3 pokusy kazda).
                    // Nove: krok podle polomeru (ctvrtina, 40-150 m), nejvys 1 davka za 45 s
                    // a nic pri offline. Rucni akce (ulozeni nastaveni, import, zmena zakazky)
                    // dal fetchuji okamzite — omezeni plati jen na automatiku pri chuzi.
                    if (lastFetchLat === null || lastFetchLng === null) { lastFetchLat = userLat; lastFetchLng = userLng; if (appStarted) setTimeout(() => initFetch(userLat, userLng), 1000); }
                    else {
                        const moved = getDistance(lastFetchLat, lastFetchLng, userLat, userLng);
                        const step = Math.max(40, Math.min(150, (mapRadius || 500) / 4));
                        if (moved > step && appStarted && navigator.onLine !== false && (Date.now() - _lastAutoFetchTs) > 45000) {
                            lastFetchLat = userLat; lastFetchLng = userLng; _lastAutoFetchTs = Date.now();
                            initFetch(userLat, userLng);
                        }
                    }
                    // VYKON: ikonu stavime JEN pri prvnim fixu. Driv se pri kazdem fixu (~1x/s)
                    // vytvarel novy L.divIcon vcetne parsovani HTML, i kdyz se pak jen presunul
                    // uz existujici marker pres setLatLng.
                    if (userMarker) userMarker.setLatLng([userLat, userLng]);
                    else {
                        const userIcon = L.divIcon({ className: 'custom-user-icon', html: `<div id="user-direction-container" style="transition: transform 0.1s linear; width: 44px; height: 44px; display: flex; justify-content: center; align-items: center;"><div style="position:absolute; width: 28px; height: 28px; background: rgba(47,158,116, 0.3); border-radius: 50%; filter: blur(3px);"></div><svg width="24" height="24" viewBox="0 0 24 24" style="z-index: 2; transform: translateY(-3px); filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.6));"><path d="M12,2 L22,20 L12,16 L2,20 Z" fill="#34d399" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div>`, iconSize: [44, 44], iconAnchor: [22, 22] });
                        userMarker = L.marker([userLat, userLng], {icon: userIcon, zIndexOffset: 1000}).addTo(map);
                    }
                },
                (error) => {
                    // cesky a s akci (drive syrova anglicka hlaska prohlizece), + zaznam pro gps-trust
                    const code = (error && error.code) || 0;
                    window.AGFix = Object.assign(window.AGFix || {}, { err: code, errTs: Date.now() });
                    if (appStarted) {
                        const czech = { 1: 'přístup k poloze je zakázán — povolte ho telefonu v nastavení', 2: 'poloha není dostupná (žádný signál GNSS)', 3: 'čekání na polohu vypršelo (slabý signál)' };
                        // U ZAMITNUTE POLOHY (kód 1) je samotna hlaska slepa ulicka: povolit
                        // se to da jen v nastaveni telefonu a appka pak potrebuje NOVY watch.
                        // Proto tlacitko primo v hlasce misto restartu cele appky.
                        const rada = (code === 1)
                            ? ' Povol polohu v nastavení telefonu a pak klepni na Zkusit znovu.'
                            : ' Vyjdi pod otevřené nebe a klepni na Zkusit znovu.';
                        document.getElementById('info').innerHTML =
                            'Chyba GPS: ' + (czech[code] || (error && error.message) || 'neznámá chyba') + rada
                            + ' <button type="button" class="info-retry" onclick="agRetryGps()">Zkusit znovu</button>';
                    }
                },
                { enableHighAccuracy: true, maximumAge: 0, timeout: 27000 }
            );
            return true;
        }
        // Nove zaregistrovani sledovani polohy z chybove hlasky (tlacitko "Zkusit znovu").
        window.agRetryGps = function () {
            const el = document.getElementById('info');
            if (el) el.innerHTML = 'Zkouším znovu najít polohu…';
            if (!agStartGpsWatch() && el) el.innerHTML = 'Tento prohlížeč neumí určovat polohu.';
        };
        agStartGpsWatch();

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
            if (!agMatchQuery(pt, searchQuery)) return false;
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
                // redukce o prvni vrchol: souciny surovych S-JTSK souradnic (~10^12) by
                // v double ztracely presnost vzajemnym rusenim clenu
                const y0 = pts[0][0], x0 = pts[0][1];
                for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; area += (pts[i][0] - y0) * (pts[j][1] - x0) - (pts[j][0] - y0) * (pts[i][1] - x0); }
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
        // PREDZPRACOVANI PRO OCR: zmenseni + prevod do seda + roztazeni kontrastu (2.-98. percentil).
        // Fotky z terenu byvaji stitky/papir v ruznem svetle - bez normalizace kontrastu
        // Tesseract casto necte nic. Volitelne binarizace (2. pruchod pri neuspechu).
        function _prepForOcr(img, maxDim, binarize) {
            const k = Math.min(1, maxDim / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, c.width, c.height);
            try {
                const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data;
                const n = d.length / 4, gray = new Uint8Array(n);
                const hist = new Uint32Array(256);
                for (let i = 0, j = 0; j < n; i += 4, j++) { const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0; gray[j] = g; hist[g]++; }
                // 2. a 98. percentil pro roztazeni kontrastu
                let lo = 0, hi = 255, acc = 0;
                for (let g = 0; g < 256; g++) { acc += hist[g]; if (acc >= n * 0.02) { lo = g; break; } }
                acc = 0;
                for (let g = 255; g >= 0; g--) { acc += hist[g]; if (acc >= n * 0.02) { hi = g; break; } }
                const span = Math.max(1, hi - lo);
                // prah pro binarizaci = prumer roztazeneho jasu (jednoducha globalni varianta)
                let thr = 0;
                if (binarize) { let sum = 0; for (let j = 0; j < n; j++) sum += Math.max(0, Math.min(255, (gray[j] - lo) * 255 / span)); thr = sum / n; }
                for (let i = 0, j = 0; j < n; i += 4, j++) {
                    let v = Math.max(0, Math.min(255, (gray[j] - lo) * 255 / span));
                    if (binarize) v = v > thr ? 255 : 0;
                    d[i] = d[i + 1] = d[i + 2] = v;
                }
                ctx.putImageData(id, 0, 0);
            } catch (e) { /* i bez predzpracovani ma OCR smysl */ }
            return c;
        }
        // Z prectenych cisel vybere Y (400-910 km) a X (930-1230 km) dle rozsahu S-JTSK v CR;
        // rozsahy se neprekryvaji -> prirazeni je jednoznacne. Navic:
        //  - stitky "Y: 596956.46" maji prednost pred hadanim podle rozsahu,
        //  - cisla psana s mezerami po tisicich ("596 956,46") se slepi dohromady,
        //  - desetinne cislo 100-1700 = vyska Z (Bpv), cislo bodu = prvni male cele cislo.
        function parseOcrCoords(text) {
            let y = null, x = null, z = null, name = null;
            const inY = v => v >= 400000 && v <= 910000, inX = v => v >= 930000 && v <= 1230000;
            // varianta textu se slepenymi tisicovymi skupinami: "596 956,46" -> "596956,46"
            const merged = text.replace(/(\d)[ \t]+(?=\d{3}(?:\D|$))/g, '$1');
            // 1) oznacene souradnice Y:/X:/Z: (nejspolehlivejsi)
            [text, merged].forEach(t => {
                const my = t.match(/(?:^|[^A-Za-z])[Yy]\s*[:=\-]?\s*(\d{6}(?:[.,]\d+)?)/);
                const mx = t.match(/(?:^|[^A-Za-z])[Xx]\s*[:=\-]?\s*(\d{6,7}(?:[.,]\d+)?)/);
                const mz = t.match(/(?:^|[^A-Za-z])[Zz]\s*[:=\-]?\s*(\d{2,4}(?:[.,]\d+)?)/);
                if (y === null && my) { const v = parseFloat(my[1].replace(',', '.')); if (inY(v)) y = v; }
                if (x === null && mx) { const v = parseFloat(mx[1].replace(',', '.')); if (inX(v)) x = v; }
                if (z === null && mz) { const v = parseFloat(mz[1].replace(',', '.')); if (v >= 100 && v <= 1700) z = v; }
            });
            // 2) podle rozsahu S-JTSK (z obou variant textu)
            const cands = [];
            [text, merged].forEach(t => (t.match(/\d+(?:[.,]\d+)?/g) || []).forEach(tok => cands.push(tok)));
            cands.forEach(tok => {
                const v = parseFloat(tok.replace(',', '.'));
                if (!isFinite(v)) return;
                if (y === null && inY(v)) y = v;
                else if (x === null && inX(v)) x = v;
                else if (z === null && tok.search(/[.,]/) >= 0 && v >= 100 && v <= 1700 && v !== y && v !== x) z = v;
                else if (name === null && v >= 1 && v < 100000 && tok.search(/[.,]/) < 0 && v !== y && v !== x) name = tok;
            });
            return { y: y, x: x, z: z, name: name };
        }
        async function ocrFromPhoto(event) {
            const file = event.target.files[0]; event.target.value = ''; if (!file) return;
            showOfflineProgress(0, 100, 'Čtu souřadnice z fotky…', '%');
            let worker = null;
            try {
                await ensureTesseract();
                const img = await _loadImageFromFile(file);
                worker = await Tesseract.createWorker('eng', 1, { logger: m => { if (m.status === 'recognizing text') updateOfflineProgress(Math.round((m.progress || 0) * 100), 100); } });
                await worker.setParameters({
                    tessedit_char_whitelist: '0123456789.,;:=-/YXZyxz ',
                    preserve_interword_spaces: '1',
                    tessedit_pageseg_mode: '6'   // souvisly blok textu (stitek/tabulka souradnic)
                });
                // 1. pruchod: sedotonova fotka s roztazenym kontrastem
                const res1 = await worker.recognize(_prepForOcr(img, 2000, false));
                let best = parseOcrCoords((res1 && res1.data && res1.data.text) ? res1.data.text : '');
                // 2. pruchod jen kdyz chybi Y nebo X: tvrda binarizace (pomaha u slabeho tisku / rytych cisel)
                if (best.y === null || best.x === null) {
                    showOfflineProgress(0, 100, 'Čtu souřadnice z fotky (2. pokus)…', '%');
                    const res2 = await worker.recognize(_prepForOcr(img, 2000, true));
                    const alt = parseOcrCoords((res2 && res2.data && res2.data.text) ? res2.data.text : '');
                    best = { y: best.y !== null ? best.y : alt.y, x: best.x !== null ? best.x : alt.x, z: best.z !== null ? best.z : alt.z, name: best.name !== null ? best.name : alt.name };
                }
                hideOfflineProgress();
                applyOcrParsed(best);
            } catch (e) {
                hideOfflineProgress();
                agInfo('Čtení z fotky se nezdařilo: ' + ((e && e.message) ? e.message : e));
            } finally { if (worker) { try { await worker.terminate(); } catch (e) {} } }
        }
        // Vysledek OCR jen PREDVYPLNI formular - ulozeni az po kontrole uzivatelem
        // (nepozorovany preklep od OCR je horsi nez rucni prepis).
        function applyOcrParsed(r) {
            const note = document.getElementById('ocr-note');
            if (r.y === null && r.x === null && r.z === null && r.name === null) {
                if (note) { note.style.display = 'block'; note.innerHTML = 'Z fotky se nepodařilo nic přečíst. Zkuste ostrější záběr zblízka, kolmo na text, bez stínů.'; }
                return;
            }
            if (r.name !== null && !document.getElementById('custom-name').value) document.getElementById('custom-name').value = r.name;
            if (r.y !== null) document.getElementById('custom-y').value = r.y.toFixed(2);
            if (r.x !== null) document.getElementById('custom-x').value = r.x.toFixed(2);
            if (r.z !== null) { const _z = document.getElementById('custom-z'); if (_z && !_z.value) _z.value = r.z.toFixed(2); }
            if (note) {
                note.style.display = 'block';
                note.innerHTML = 'Přečteno z fotky: ' + (r.name !== null ? 'bod <b>' + r.name + '</b> · ' : '')
                    + (r.y !== null ? 'Y <b>' + r.y.toFixed(2) + '</b>' : 'Y se nenašlo') + ' · '
                    + (r.x !== null ? 'X <b>' + r.x.toFixed(2) + '</b>' : 'X se nenašlo')
                    + (r.z !== null ? ' · Z <b>' + r.z.toFixed(2) + '</b>' : '')
                    + '<br><b>Zkontrolujte hodnoty proti originálu</b> — OCR se může splést.';
            }
        }
        // zpetna kompatibilita: puvodni vstup s textem (napr. z jinych modulu)
        function applyOcrResult(text) { applyOcrParsed(parseOcrCoords(text)); }
