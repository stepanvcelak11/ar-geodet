// ===== AR Geodet — HROMADNÝ IMPORT BODŮ Z KATASTRU TAHEM PO MAPĚ ================
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu js/vylepseni.js: NEEDITUJE logika.js
// ani grafika.js, vše čte přes globály s typeof-guardy a obaluje try/catch.
// Načítá se jako jeden z POSLEDNÍCH skriptů.
//
// Co dělá:
//   Přidá do bočního menu (#side-menu) tlačítko „Import oblasti z katastru".
//   Po klepnutí uživatel TAHEM po Leaflet mapě "map" vybere obdélník (bbox).
//   Modul stáhne z ČÚZK ArcGIS REST (BodovaPole/MapServer, query, envelope) body
//   bodových polí v daném obdélníku a nabídne je hromadně přidat do zakázky
//   přes window.addImportedPoints().
//
// RISK: HIGH — závisí na dostupnosti ČÚZK ArcGIS API a na CORS. Při jakékoliv chybě
//   (síť, CORS, prázdná odpověď) ukáže jasnou hlášku a NEPOLOŽÍ aplikaci.
//
// Odstranění: smaž js/cadastre-area.js + css/cadastre-area.css, řádek v index.html
//   a oba řádky v sw.js. Aplikace pak funguje přesně jako předtím.
//
// Pozn.: endpoint i parsování odpovědi přesně kopírují fetchGeodata() z logika.js
//   (https://ags.cuzk.gov.cz/arcgis/rest/services/BodovaPole/MapServer/{id}/query),
//   aby kategorie/čísla bodů seděly se zbytkem appky. Data © ČÚZK.
// ================================================================================
(function () {
    'use strict';

    var ENDPOINT = 'https://ags.cuzk.gov.cz/arcgis/rest/services/BodovaPole/MapServer';
    var LAYERS = [1, 2, 4, 5, 6];          // shodné s fetchGeodata() v logika.js
    var FETCH_MS = 15000;                   // timeout jednoho dotazu
    var MAX_BBOX_M = 1500;                  // pojistka: moc velká oblast = zahltí ČÚZK i appku

    // --------------------------------------------------------------------------------
    // Dialogy: použij in-app dialogy z vylepseni.js, jinak nativní fallback
    // --------------------------------------------------------------------------------
    function alertMsg(title, message) {
        try {
            if (typeof window.agAlert === 'function') { window.agAlert({ title: title, message: message }); return; }
        } catch (e) {}
        try { window.alert(String(title) + '\n\n' + String(message).replace(/<[^>]+>/g, '')); } catch (e) {}
    }
    function confirmMsg(opts) {
        try {
            if (typeof window.agConfirm === 'function') return window.agConfirm(opts);
        } catch (e) {}
        return new Promise(function (res) {
            try { res(window.confirm((opts.title ? opts.title + '\n\n' : '') + String(opts.message || '').replace(/<[^>]+>/g, ''))); }
            catch (e) { res(false); }
        });
    }

    // --------------------------------------------------------------------------------
    // Pomocné
    // --------------------------------------------------------------------------------
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function getRotation() { try { return (typeof mapRotation !== 'undefined' && isFinite(mapRotation)) ? mapRotation : 0; } catch (e) { return 0; } }

    // jméno bodu — stejná logika jako extractPointNumber() v logika.js (s fallbackem)
    function pointName(props) {
        try { if (typeof extractPointNumber === 'function') return extractPointNumber(props); } catch (e) {}
        if (!props) return 'Bod';
        var up = {}; for (var k in props) up[k.toUpperCase()] = props[k];
        var n = up['CISLO'] || up['CISLO_BODU'] || up['VLASTNI_CISLO'] || up['OZNACENI'] || up['UPLNE_CISLO'] || up['NAZEV'];
        if (n && String(n).trim() !== '' && String(n).trim() !== 'Null') return String(n).trim();
        return 'Bod';
    }

    function metersBetween(lat1, lng1, lat2, lng2) {
        var R = 6371000, toR = Math.PI / 180;
        var dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // fetch s timeoutem (nezasekne se navždy, když ČÚZK neodpovídá)
    function fetchJson(url) {
        return new Promise(function (resolve, reject) {
            var done = false;
            var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var t = setTimeout(function () { done = true; if (ctrl) { try { ctrl.abort(); } catch (e) {} } reject(new Error('timeout')); }, FETCH_MS);
            fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
                .then(function (r) { return r.json(); })
                .then(function (j) { if (done) return; clearTimeout(t); resolve(j); })
                .catch(function (e) { if (done) return; clearTimeout(t); reject(e); });
        });
    }

    // Stáhne body ze všech vrstev pro daný bbox. bbox = {w,s,e,n} v WGS84.
    // Vrací pole {name, lat, lng}. Dedup podle name+poloha.
    function fetchPointsInBbox(bbox, onProgress) {
        var geom = bbox.w + ',' + bbox.s + ',' + bbox.e + ',' + bbox.n;
        var out = [], seen = {};
        var idx = 0, errCount = 0;
        function next() {
            if (idx >= LAYERS.length) return Promise.resolve({ points: out, errCount: errCount, total: LAYERS.length });
            var layerId = LAYERS[idx++];
            if (typeof onProgress === 'function') { try { onProgress(idx - 1, LAYERS.length); } catch (e) {} }
            var url = ENDPOINT + '/' + layerId + '/query' +
                '?where=1%3D1' +
                '&geometry=' + encodeURIComponent(geom) +
                '&geometryType=esriGeometryEnvelope' +
                '&inSR=4326&spatialRel=esriSpatialRelIntersects' +
                '&outFields=*&returnGeometry=true&outSR=4326&f=json';
            return fetchJson(url).then(function (data) {
                if (data && data.features && data.features.length) {
                    data.features.forEach(function (feat) {
                        if (!feat.geometry || typeof feat.geometry.x !== 'number' || typeof feat.geometry.y !== 'number') return;
                        var lat = feat.geometry.y, lng = feat.geometry.x;
                        var nm = pointName(feat.attributes);
                        var key = nm + '@' + lat.toFixed(6) + ',' + lng.toFixed(6);
                        if (seen[key]) return;
                        seen[key] = 1;
                        out.push({ name: nm, lat: lat, lng: lng });
                    });
                }
                return next();
            }).catch(function (e) {
                // jednu vrstvu necháme spadnout tiše (jako fetchGeodata), pokračujeme dál;
                // počet selhání si pamatujeme, ať umíme odlišit „prázdná oblast" od
                // „dotazy vůbec neprošly" (CORS/síť/timeout) — viz doFetch().
                errCount++;
                return next();
            });
        }
        return next();
    }

    // --------------------------------------------------------------------------------
    // Výběr obdélníku po mapě — vlastní fullscreen overlay (mapa má dragging:false a
    // vlastní touch handlery v grafika.js; nesaháme do nich, jen překryjeme).
    // Body 4 rohů převedeme přes map.containerPointToLatLng + zohledníme CSS rotaci
    // mapy (mapRotation), pak spočteme geografický bounding box (min/max lat/lng).
    // --------------------------------------------------------------------------------
    var _selOverlay = null, _selBox = null, _selHint = null;
    var _selActive = false, _selStart = null, _selResolve = null;

    function mapContainerEl() {
        var m = getMap();
        if (m && typeof m.getContainer === 'function') { try { return m.getContainer(); } catch (e) {} }
        return document.getElementById('map');
    }

    // screen (clientX/Y) -> container point mapy se zohledněním aplikované CSS rotace
    // POZOR: musí přesně kopírovat _screenToContainerPoint() z grafika.js. Mapa se
    // otáčí kolem polohy UŽIVATELE (transform-origin = jeho container point), NE kolem
    // středu obrazovky. Když koukáš na vzdálené místo, je uživatel mimo střed → otáčení
    // kolem středu dávalo úplně jiné souřadnice → prázdný výřez → „žádné body".
    function screenToContainerPoint(px, py) {
        var m = getMap(); if (!m) return null;
        try {
            var Px, Py, P;
            var userEl = document.getElementById('user-direction-container');
            var hasUser = userEl && typeof userLat !== 'undefined' && userLat != null && isFinite(userLat);
            if (hasUser) {
                var ur = userEl.getBoundingClientRect();
                Px = ur.left + ur.width / 2; Py = ur.top + ur.height / 2;
                P = m.latLngToContainerPoint([userLat, userLng]);
            } else {
                var el = mapContainerEl(); if (!el) return null;
                var rect = el.getBoundingClientRect();
                Px = rect.left + rect.width / 2; Py = rect.top + rect.height / 2;
                var sz = m.getSize(); P = L.point(sz.x / 2, sz.y / 2);
            }
            var rad = getRotation() * Math.PI / 180;
            var dx = px - Px, dy = py - Py;
            var lx = dx * Math.cos(rad) - dy * Math.sin(rad);
            var ly = dx * Math.sin(rad) + dy * Math.cos(rad);
            return L.point(P.x + lx, P.y + ly);
        } catch (e) { return null; }
    }

    function screenToLatLng(px, py) {
        // Nejdřív zkus SDÍLENOU funkci z grafika.js (běží v jejím scope → správné
        // mapRotation/userLat/userLng; přesně stejný převod jako kliknutí do mapy).
        try {
            if (typeof window.agScreenToLatLng === 'function') {
                var ll = window.agScreenToLatLng(px, py);
                if (ll && isFinite(ll.lat) && isFinite(ll.lng)) return ll;
            }
        } catch (e) {}
        // Fallback (kdyby grafika.js chyběla): vlastní převod.
        var m = getMap(); if (!m) return null;
        var cp = screenToContainerPoint(px, py); if (!cp) return null;
        try { return m.containerPointToLatLng(cp); } catch (e) { return null; }
    }

    function buildSelOverlay() {
        if (_selOverlay) return;
        _selOverlay = document.createElement('div');
        _selOverlay.id = 'cad-sel-overlay';
        _selBox = document.createElement('div');
        _selBox.id = 'cad-sel-box';
        _selBox.style.display = 'none';
        _selHint = document.createElement('div');
        _selHint.id = 'cad-sel-hint';
        _selHint.innerHTML =
            '<span><svg class="icon"><use href="#i-grid"/></svg> Tahem označ obdélník — stáhnu body katastru uvnitř</span>' +
            '<button type="button" id="cad-sel-cancel">Zrušit</button>';
        _selOverlay.appendChild(_selBox);
        _selOverlay.appendChild(_selHint);
        document.body.appendChild(_selOverlay);

        var cancel = _selHint.querySelector('#cad-sel-cancel');
        if (cancel) cancel.addEventListener('click', function (e) { e.stopPropagation(); finishSelection(null); });

        _selOverlay.addEventListener('pointerdown', onSelDown);
        _selOverlay.addEventListener('pointermove', onSelMove);
        _selOverlay.addEventListener('pointerup', onSelUp);
        _selOverlay.addEventListener('pointercancel', function () { _selActive = false; if (_selBox) _selBox.style.display = 'none'; });
    }

    function onSelDown(e) {
        if (e.target && e.target.id === 'cad-sel-cancel') return;
        _selActive = true;
        _selStart = { x: e.clientX, y: e.clientY };
        if (_selBox) {
            _selBox.style.display = 'block';
            _selBox.style.left = e.clientX + 'px';
            _selBox.style.top = e.clientY + 'px';
            _selBox.style.width = '0px';
            _selBox.style.height = '0px';
        }
        try { _selOverlay.setPointerCapture(e.pointerId); } catch (err) {}
        if (e.cancelable) e.preventDefault();
    }
    function onSelMove(e) {
        if (!_selActive || !_selStart || !_selBox) return;
        var x = Math.min(_selStart.x, e.clientX), y = Math.min(_selStart.y, e.clientY);
        var w = Math.abs(e.clientX - _selStart.x), h = Math.abs(e.clientY - _selStart.y);
        _selBox.style.left = x + 'px'; _selBox.style.top = y + 'px';
        _selBox.style.width = w + 'px'; _selBox.style.height = h + 'px';
        if (e.cancelable) e.preventDefault();
    }
    function onSelUp(e) {
        if (!_selActive || !_selStart) { _selActive = false; return; }
        _selActive = false;
        var a = _selStart, b = { x: e.clientX, y: e.clientY };
        var w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        if (w < 12 || h < 12) { if (_selBox) _selBox.style.display = 'none'; return; } // moc malý tah = ignoruj
        // 4 rohy obdélníku (v clientX/Y) -> latLng -> bounding box
        var corners = [
            screenToLatLng(a.x, a.y), screenToLatLng(b.x, a.y),
            screenToLatLng(b.x, b.y), screenToLatLng(a.x, b.y)
        ].filter(function (c) { return c && isFinite(c.lat) && isFinite(c.lng); });
        if (corners.length < 4) { finishSelection(null); alertMsg('Výběr selhal', 'Polohu obdélníku se nepodařilo přepočítat na mapě. Zkus to znovu.'); return; }
        var lats = corners.map(function (c) { return c.lat; }), lngs = corners.map(function (c) { return c.lng; });
        var bbox = { s: Math.min.apply(null, lats), n: Math.max.apply(null, lats), w: Math.min.apply(null, lngs), e: Math.max.apply(null, lngs) };
        finishSelection(bbox);
    }

    function startSelection() {
        return new Promise(function (resolve) {
            buildSelOverlay();
            _selResolve = resolve;
            _selStart = null; _selActive = false;
            if (_selBox) _selBox.style.display = 'none';
            _selOverlay.classList.add('open');
        });
    }
    function finishSelection(bbox) {
        if (_selOverlay) _selOverlay.classList.remove('open');
        _selActive = false; _selStart = null;
        var r = _selResolve; _selResolve = null;
        if (r) r(bbox);
    }

    // --------------------------------------------------------------------------------
    // Hlavní tok: vyber obdélník -> stáhni -> potvrzení -> přidej body
    // --------------------------------------------------------------------------------
    var _busy = false;

    function runImport() {
        if (_busy) return;
        var m = getMap();
        if (!m) { alertMsg('Mapa není připravená', 'Počkej, až se načte mapa, a zkus to znovu.'); return; }
        if (typeof fetch === 'undefined') { alertMsg('Nelze stahovat', 'Tento prohlížeč neumí stahovat data (chybí fetch).'); return; }
        // Výběr obdélníku se přepočítává přes viditelnou mapu. V AR (kamera) je mapa
        // skrytá → tah by se přepočítal podle staré polohy mapy a stáhlo by se špatné
        // (často prázdné) místo. Proto vyžadujeme zobrazení s mapou (jako Měření plochy).
        try {
            if (typeof viewMode !== 'undefined' && viewMode === 'ar') {
                alertMsg('Přepni na mapu',
                    'Import oblasti z katastru pracuje s mapou. Přepni zobrazení na <b>Mapa</b> nebo <b>Split</b> ' +
                    '(přes tlačítko „Více"), najdi a přibliž místo na mapě a pak vyber oblast tahem.');
                return;
            }
        } catch (e) {}

        startSelection().then(function (bbox) {
            if (!bbox) return; // zrušeno / příliš malý výběr
            // pojistka na velikost oblasti
            var widthM = metersBetween((bbox.s + bbox.n) / 2, bbox.w, (bbox.s + bbox.n) / 2, bbox.e);
            var heightM = metersBetween(bbox.s, (bbox.w + bbox.e) / 2, bbox.n, (bbox.w + bbox.e) / 2);
            if (widthM > MAX_BBOX_M || heightM > MAX_BBOX_M) {
                alertMsg('Příliš velká oblast',
                    'Vybraná oblast je ~' + Math.round(widthM) + ' × ' + Math.round(heightM) + ' m. ' +
                    'Max. strana je ' + MAX_BBOX_M + ' m — přibliž mapu a vyber menší výřez (šetří ČÚZK i baterii).');
                return;
            }
            doFetch(bbox);
        });
    }

    function doFetch(bbox) {
        _busy = true;
        showProgress(0, LAYERS.length);
        fetchPointsInBbox(bbox, function (i, total) { showProgress(i, total); }).then(function (res) {
            hideProgress();
            _busy = false;
            var pts = (res && res.points) || [];
            var errCount = (res && res.errCount) || 0;
            var total = (res && res.total) || LAYERS.length;
            // KLÍČOVÉ: když dotazy vůbec neprošly (CORS/síť/timeout — selhaly všechny
            // vrstvy) a nic se nestáhlo, NEHLÁSIT „žádné body" (to mate — uživatel pak
            // na místě body normálně vidí). Je to selhání spojení, ne prázdná oblast.
            if (!pts.length && errCount >= total) {
                alertMsg('Stažení selhalo',
                    'Nepodařilo se spojit s katastrem (ČÚZK) — neprošel žádný z dotazů ' +
                    '(server neodpovídá, jsi offline, nebo prohlížeč dotaz blokuje / CORS).<br><br>' +
                    '<b>Neznamená to, že tam body nejsou.</b> Zkus to prosím znovu za chvíli.');
                return;
            }
            if (!pts.length) {
                alertMsg('Žádné body',
                    'V označené oblasti ČÚZK nevrátil žádné body bodových polí' +
                    (errCount ? ' (část vrstev se ale nestáhla, výsledek může být neúplný)' : '') + '. ' +
                    'Buď tam žádné nejsou, nebo je server právě nedostupný (zkus to za chvíli).');
                return;
            }
            // odfiltruj body, které už v zakázce jsou (addImportedPoints dedupuje taky, ale ukážeme reálný počet)
            var fresh = pts.filter(function (p) { return !alreadyHave(p); });
            if (!fresh.length) {
                alertMsg('Nic nového', 'Všech ' + pts.length + ' nalezených bodů už v této zakázce máš.');
                return;
            }
            confirmMsg({
                title: 'Přidat body z katastru?',
                message: 'V oblasti jsem našel <b>' + pts.length + '</b> ' + plural(pts.length, 'bod', 'body', 'bodů') +
                    (fresh.length !== pts.length ? (' (z toho <b>' + fresh.length + '</b> ' + plural(fresh.length, 'nový', 'nové', 'nových') + ')') : '') +
                    '.<br>Přidat je do aktuální zakázky jako vlastní body?' +
                    (errCount ? '<br><span style="font-size:12px;color:var(--warning,#fbbf24);">Pozor: ' + errCount + ' z ' + total + ' vrstev se nestáhlo — výsledek může být neúplný.</span>' : '') +
                    '<br><span style="font-size:12px;opacity:.7;">Data © ČÚZK</span>',
                okText: 'Přidat (' + fresh.length + ')', cancelText: 'Zrušit'
            }).then(function (ok) {
                if (!ok) return;
                addPoints(fresh);
            });
        }).catch(function (e) {
            hideProgress();
            _busy = false;
            alertMsg('Stažení selhalo',
                'Nepodařilo se spojit s katastrem (ČÚZK). Možné příčiny: nejsi online, server neodpovídá, ' +
                'nebo prohlížeč blokuje dotaz (CORS). Zkus to později.');
        });
    }

    function alreadyHave(p) {
        try {
            if (typeof persistentCustomPoints === 'undefined' || !Array.isArray(persistentCustomPoints)) return false;
            return !!persistentCustomPoints.find(function (ex) {
                return ex.name === p.name && Math.abs(ex.lat - p.lat) < 0.0001 && Math.abs(ex.lng - p.lng) < 0.0001;
            });
        } catch (e) { return false; }
    }

    function addPoints(pts) {
        try {
            if (typeof window.addImportedPoints !== 'function') {
                alertMsg('Nelze přidat', 'Funkce pro vkládání bodů není dostupná (addImportedPoints).');
                return;
            }
            var added = window.addImportedPoints(pts) || 0;
            alertMsg('Hotovo', 'Přidáno <b>' + added + '</b> ' + plural(added, 'bod', 'body', 'bodů') +
                ' do zakázky. Najdeš je mezi vlastními body (kategorie CUSTOM).');
        } catch (e) {
            alertMsg('Přidání selhalo', 'Body se nepodařilo uložit. Zkus to znovu.');
        }
    }

    function plural(n, one, few, many) {
        n = Math.abs(n);
        if (n === 1) return one;
        if (n >= 2 && n <= 4) return few;
        return many;
    }

    // --------------------------------------------------------------------------------
    // Indikátor průběhu (lehký toast nad mapou)
    // --------------------------------------------------------------------------------
    var _prog = null;
    function showProgress(i, total) {
        if (!_prog) {
            _prog = document.createElement('div');
            _prog.id = 'cad-progress';
            document.body.appendChild(_prog);
        }
        var pct = total ? Math.round((i / total) * 100) : 0;
        _prog.innerHTML = '<div class="cad-prog-txt">Stahuji body z katastru…</div>' +
            '<div class="cad-prog-bar"><div class="cad-prog-fill" style="width:' + pct + '%"></div></div>';
        _prog.classList.add('open');
    }
    function hideProgress() { if (_prog) _prog.classList.remove('open'); }

    // --------------------------------------------------------------------------------
    // Tlačítko v bočním menu
    // --------------------------------------------------------------------------------
    function injectMenuButton() {
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('cad-area-btn')) return;
        // Vkládáme do scrollovací části, ať položka scrolluje a dole zůstává pevné jen „Zavřít".
        var host = menu.querySelector('.menu-scroll') || menu;
        var btn = document.createElement('button');
        btn.id = 'cad-area-btn';
        btn.className = 'menu-btn';
        btn.type = 'button';
        btn.innerHTML = '<svg class="icon"><use href="#i-grid"/></svg> Import oblasti z katastru';
        btn.addEventListener('click', function () {
            try { if (typeof toggleMenu === 'function') toggleMenu(); } catch (e) {}
            // menu se zavírá animací; spustíme výběr až po něm
            setTimeout(function () { try { runImport(); } catch (err) { console.warn('[cadastre-area]', err); } }, 250);
        });
        // vlož za „Spravovat vlastní body", ať to logicky sedí k práci s body
        var ref = host.querySelector('button[onclick*="openManageModal"]');
        if (ref && ref.nextSibling) host.insertBefore(btn, ref.nextSibling);
        else host.appendChild(btn);
    }

    // --------------------------------------------------------------------------------
    // Init
    // --------------------------------------------------------------------------------
    function init() {
        try { injectMenuButton(); } catch (e) { console.warn('[cadastre-area] init', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // Druhý průchod po plném loadu — #side-menu může vznikat později.
    window.addEventListener('load', function () { setTimeout(init, 400); });
})();
