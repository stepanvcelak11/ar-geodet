// ===== AR Geodet — VLASTNÍ GEOREFERENCOVANÝ PODKLAD (ODPOJITELNÁ vrstva) =======
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Umožní naimportovat
// vlastní rastr (plán / situaci / sken výkresu), GEOREFERENCOVAT ho na ≥2
// vlícovací body a položit ho jako WARPED (zkreslenou) vrstvu přes mapu —
// navigace pak jde podle vlastního podkladu, ne jen ČÚZK.
//
//   • 2 vlícovací body → podobnostní (Helmert) transformace (posun+rotace+měřítko)
//   • 3+ bodů        → afinní transformace metodou nejmenších čtverců + rezidua
//   Skutečné souřadnice vlícovacího bodu lze zadat ručně (S-JTSK Y/X), z aktuální
//   GPS, nebo výběrem existujícího bodu.
//
//   Rastr se kreslí do vlastního <canvas> v overlay-pane Leaflet mapy (jede i s
//   rotací mapy). Obrázek se ukládá per zakázka do IndexedDB, parametry do
//   localStorage (přes setStoredData → prefix zakázkou).
//
// Vstup: tlačítko „Vlastní podklad" v launcheru (js/field-tools.js); když launcher
//        chybí, modul si vyrobí vlastní plovoucí tlačítko.
// Odstranění: smaž js/geo-overlay.js + řádek <script> v index.html (a v sw.js).
// Data vlastního podkladu si vloží uživatel; appka je nikam neodesílá.
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18" opacity=".55"/><path d="M7 14l3-2 3 3 4-4" opacity=".8"/></svg>';
    var PKEY = 'agGeoOverlay';     // localStorage (per zakázka): parametry
    var DB = 'agGeoOverlay', STORE = 'kv';

    // stav
    var _img = null;               // Image
    var _cps = [];                 // [{px,py, wx,wy}]  (world = záporný Křovák, shodně s proj4)
    var _opacity = 0.7, _visible = true;
    var _imgToWorld = null;        // fn(px,py) -> {x:wx, y:wy}
    var _rms = null;               // RMS reziduí (m) pro 3+ bodů
    var _layer = null;             // Leaflet vrstva
    var _pendingPixel = null;      // při přidávání bodu

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function projId() { try { return (typeof activeProjectId !== 'undefined') ? activeProjectId : 'default'; } catch (e) { return 'default'; } }

    // ---- proj4 svět <-> WGS84 (svět = [záporné Y, záporné X] Křováka) -----------
    function worldToLatLng(w) { try { var ll = proj4('EPSG:5514', 'EPSG:4326', [w.x, w.y]); return { lat: ll[1], lng: ll[0] }; } catch (e) { return null; } }
    function latLngToWorld(lat, lng) { try { var s = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); return { x: s[0], y: s[1] }; } catch (e) { return null; } }
    function sjtskToWorld(Y, X) { return { x: -Math.abs(Y), y: -Math.abs(X) }; }   // kladné Y,X -> záporný Křovák

    // =====================================================================
    // IndexedDB (obrázek per zakázka)
    // =====================================================================
    function idb() { return new Promise(function (res, rej) { try { var r = indexedDB.open(DB, 1); r.onupgradeneeded = function () { try { r.result.createObjectStore(STORE); } catch (e) {} }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; } catch (e) { rej(e); } }); }
    function idbPut(k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }
    function idbGet(k) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(STORE, 'readonly'); var rq = t.objectStore(STORE).get(k); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; }); }); }
    function idbDel(k) { return idb().then(function (db) { return new Promise(function (res) { var t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(k); t.oncomplete = function () { res(); }; t.onerror = function () { res(); }; }); }).catch(function () {}); }
    // Uklid rastru pri smazani zakazky (ag:project-deleted z logika.js) — klic je img_<pid>.
    document.addEventListener('ag:project-deleted', function (ev) {
        var pid = ev && ev.detail && ev.detail.id; if (pid) idbDel('img_' + pid);
    });

    // =====================================================================
    // Transformace obrázek(px) -> svět(m)
    // =====================================================================
    function buildTransform() {
        _imgToWorld = null; _rms = null;
        if (_cps.length < 2) return false;
        if (_cps.length === 2) {
            // podobnostní (Helmert): W = [[a,-b],[b,a]]·px + t
            var p1 = _cps[0], p2 = _cps[1];
            var dpx = p2.px - p1.px, dpy = p2.py - p1.py;
            var dWx = p2.wx - p1.wx, dWy = p2.wy - p1.wy;
            var den = dpx * dpx + dpy * dpy;
            if (den < 1e-9) return false;
            var a = (dpx * dWx + dpy * dWy) / den;
            var b = (dpx * dWy - dpy * dWx) / den;
            var tx = p1.wx - (a * p1.px - b * p1.py);
            var ty = p1.wy - (b * p1.px + a * p1.py);
            _imgToWorld = function (px, py) { return { x: a * px - b * py + tx, y: b * px + a * py + ty }; };
            return true;
        }
        // afinní MNČ: Wx = m11*px + m12*py + tx (a totéž pro Wy), 2× nezávislý 3-param systém
        var Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0, n = _cps.length;
        var bX = [0, 0, 0], bY = [0, 0, 0];
        for (var i = 0; i < n; i++) {
            var c = _cps[i];
            Sxx += c.px * c.px; Sxy += c.px * c.py; Sx += c.px; Syy += c.py * c.py; Sy += c.py;
            bX[0] += c.px * c.wx; bX[1] += c.py * c.wx; bX[2] += c.wx;
            bY[0] += c.px * c.wy; bY[1] += c.py * c.wy; bY[2] += c.wy;
        }
        var N = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]];
        var mx = solve3(N, bX), my = solve3(N, bY);
        if (!mx || !my) return false;
        _imgToWorld = function (px, py) { return { x: mx[0] * px + mx[1] * py + mx[2], y: my[0] * px + my[1] * py + my[2] }; };
        // rezidua
        var sum = 0;
        for (var j = 0; j < n; j++) { var cc = _cps[j], w = _imgToWorld(cc.px, cc.py); var dx = w.x - cc.wx, dy = w.y - cc.wy; sum += dx * dx + dy * dy; }
        _rms = Math.sqrt(sum / n);
        return true;
    }
    // řešení 3x3 (Gaussova eliminace s pivotem)
    function solve3(A, b) {
        var M = [[A[0][0], A[0][1], A[0][2], b[0]], [A[1][0], A[1][1], A[1][2], b[1]], [A[2][0], A[2][1], A[2][2], b[2]]];
        for (var col = 0; col < 3; col++) {
            var piv = col; for (var r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
            if (Math.abs(M[piv][col]) < 1e-9) return null;
            var tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
            for (var r2 = 0; r2 < 3; r2++) { if (r2 === col) continue; var f = M[r2][col] / M[col][col]; for (var k = col; k < 4; k++) M[r2][k] -= f * M[col][k]; }
        }
        return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
    }

    // =====================================================================
    // Leaflet vrstva — warped rastr v overlay-pane (jede i s rotací mapy)
    // =====================================================================
    function makeLayer() {
        var L_ = (typeof L !== 'undefined') ? L : null; if (!L_) return null;
        var Cls = L_.Layer.extend({
            onAdd: function (m) {
                this._m = m; this._zooming = false;
                var c = this._c = document.createElement('canvas');
                c.style.position = 'absolute'; c.style.top = '0'; c.style.left = '0';
                c.style.pointerEvents = 'none'; c.style.transformOrigin = '0 0'; c.style.opacity = _opacity;
                m.getPanes().overlayPane.appendChild(c);
                m.on('move viewreset resize zoomend moveend', this._render, this);
                m.on('zoomstart', this._zs, this); m.on('zoomend', this._ze, this);
                this._render();
            },
            onRemove: function (m) {
                if (this._c && this._c.parentNode) this._c.parentNode.removeChild(this._c);
                m.off('move viewreset resize zoomend moveend', this._render, this);
                m.off('zoomstart', this._zs, this); m.off('zoomend', this._ze, this);
            },
            _zs: function () { this._zooming = true; },
            _ze: function () { this._zooming = false; this._render(); },
            setOpacity: function (o) { if (this._c) this._c.style.opacity = o; },
            _render: function () {
                var m = this._m; if (!m || !_img || !_imgToWorld || this._zooming) return;
                try {
                    var size = m.getSize();
                    var tl = m.containerPointToLayerPoint([0, 0]);
                    if (typeof L !== 'undefined') L.DomUtil.setPosition(this._c, tl);
                    if (this._c.width !== size.x) this._c.width = size.x;
                    if (this._c.height !== size.y) this._c.height = size.y;
                    var ctx = this._c.getContext('2d'); ctx.clearRect(0, 0, size.x, size.y);
                    var corners = [[0, 0], [_img.width, 0], [0, _img.height]], dst = [];
                    for (var i = 0; i < 3; i++) {
                        var w = _imgToWorld(corners[i][0], corners[i][1]); var ll = worldToLatLng(w); if (!ll) return;
                        var lp = m.latLngToLayerPoint([ll.lat, ll.lng]); dst.push([lp.x - tl.x, lp.y - tl.y]);
                    }
                    var iw = _img.width, ih = _img.height;
                    var a = (dst[1][0] - dst[0][0]) / iw, b = (dst[1][1] - dst[0][1]) / iw;
                    var cc = (dst[2][0] - dst[0][0]) / ih, d = (dst[2][1] - dst[0][1]) / ih;
                    ctx.save(); ctx.setTransform(a, b, cc, d, dst[0][0], dst[0][1]); ctx.drawImage(_img, 0, 0); ctx.restore();
                } catch (e) { /* fail-silent */ }
            }
        });
        return new Cls();
    }

    function ensureLayer() {
        var m = getMap(); if (!m) return;
        if (!_layer) { _layer = makeLayer(); if (_layer) _layer.addTo(m); }
        else if (!m.hasLayer(_layer)) _layer.addTo(m);
        if (_layer && _layer.setOpacity) _layer.setOpacity(_opacity);
        if (_layer && _layer._render) _layer._render();
    }
    function removeLayer() { var m = getMap(); if (_layer && m && m.hasLayer(_layer)) m.removeLayer(_layer); }
    function refreshLayer() { if (_visible) ensureLayer(); else removeLayer(); }

    // =====================================================================
    // Persistence
    // =====================================================================
    function saveParams() {
        try {
            if (typeof setStoredData !== 'function') return;
            setStoredData(PKEY, JSON.stringify({ cps: _cps, opacity: _opacity, visible: _visible, imgW: _img ? _img.width : 0, imgH: _img ? _img.height : 0 }));
        } catch (e) {}
    }
    function loadImageFromDataURL(url) {
        return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('img')); }; im.src = url; });
    }
    function loadAll() {
        var p = null;
        try { var s = (typeof getStoredData === 'function') ? getStoredData(PKEY) : null; if (s) p = JSON.parse(s); } catch (e) {}
        if (!p || !Array.isArray(p.cps) || p.cps.length < 2) return Promise.resolve(false);
        _cps = p.cps; _opacity = (typeof p.opacity === 'number') ? p.opacity : 0.7; _visible = (p.visible !== false);
        return idbGet('img_' + projId()).then(function (url) {
            if (!url) return false;
            return loadImageFromDataURL(url).then(function (im) { _img = im; buildTransform(); refreshLayer(); return true; });
        }).catch(function () { return false; });
    }
    function resetState() { removeLayer(); _layer = null; _img = null; _cps = []; _imgToWorld = null; _rms = null; _opacity = 0.7; _visible = true; }

    // =====================================================================
    // UI — výběr pixelu na obrázku (zoom + pan + ťuk)
    // =====================================================================
    function openPicker(cb) {
        if (!_img) { agAlert('Není obrázek', 'Nejdřív načti obrázek podkladu.'); return; }
        var ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.style.display = 'flex'; ov.style.zIndex = '100003';
        ov.innerHTML =
            '<div class="modal-content" style="overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">Označ vlícovací bod na obrázku</h3>'
            + '<p style="font-size:12px;opacity:.7;margin:2px 0 8px;">Táhni = posun, +/− = lupa, ťukni = umísti křížek na známé místo (roh, kříž sítě).</p>'
            + '<div id="agpk-wrap" style="position:relative;width:100%;height:54vh;background:#0a0e14;border-radius:10px;overflow:hidden;touch-action:none;">'
            + '<canvas id="agpk-cv" style="position:absolute;top:0;left:0;"></canvas></div>'
            + '<div style="display:flex;gap:8px;margin-top:8px;">'
            + '<button class="btn btn-secondary" id="agpk-zin" style="flex:1;margin:0;">＋</button>'
            + '<button class="btn btn-secondary" id="agpk-zout" style="flex:1;margin:0;">－</button></div>'
            + '<button class="btn" id="agpk-ok" style="margin-top:10px;" disabled>Použít tento bod</button>'
            + '<button class="btn btn-secondary" style="margin-top:10px;" id="agpk-cancel">Zrušit</button>'
            + '</div>';
        document.body.appendChild(ov);

        var wrap = ov.querySelector('#agpk-wrap'), cv = ov.querySelector('#agpk-cv'), ctx = cv.getContext('2d');
        var view = { scale: 1, ox: 0, oy: 0 }, mark = null, drag = null, moved = 0;
        function fit() {
            var r = wrap.getBoundingClientRect(); cv.width = r.width; cv.height = r.height;
            var s = Math.min(r.width / _img.width, r.height / _img.height); view.scale = s;
            view.ox = (r.width - _img.width * s) / 2; view.oy = (r.height - _img.height * s) / 2; draw();
        }
        function draw() {
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.drawImage(_img, view.ox, view.oy, _img.width * view.scale, _img.height * view.scale);
            if (mark) { var sx = view.ox + mark.px * view.scale, sy = view.oy + mark.py * view.scale;
                ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx - 12, sy); ctx.lineTo(sx + 12, sy); ctx.moveTo(sx, sy - 12); ctx.lineTo(sx, sy + 12); ctx.stroke();
                ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 7); ctx.stroke(); }
        }
        function zoom(f) { var cx = cv.width / 2, cy = cv.height / 2; view.ox = cx - (cx - view.ox) * f; view.oy = cy - (cy - view.oy) * f; view.scale *= f; draw(); }
        wrap.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy }; moved = 0; try { wrap.setPointerCapture(e.pointerId); } catch (er) {} });
        wrap.addEventListener('pointermove', function (e) { if (!drag) return; var dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy); view.ox = drag.ox + dx; view.oy = drag.oy + dy; draw(); });
        wrap.addEventListener('pointerup', function (e) {
            if (drag && moved < 6) {
                var r = cv.getBoundingClientRect(); var px = (e.clientX - r.left - view.ox) / view.scale, py = (e.clientY - r.top - view.oy) / view.scale;
                if (px >= 0 && py >= 0 && px <= _img.width && py <= _img.height) { mark = { px: px, py: py }; ov.querySelector('#agpk-ok').disabled = false; draw(); }
            }
            drag = null;
        });
        ov.querySelector('#agpk-zin').onclick = function () { zoom(1.4); };
        ov.querySelector('#agpk-zout').onclick = function () { zoom(1 / 1.4); };
        ov.querySelector('#agpk-cancel').onclick = function () { ov.remove(); };
        ov.querySelector('#agpk-ok').onclick = function () { if (mark) { var mm = mark; ov.remove(); cb(mm); } };
        setTimeout(fit, 60);
    }

    // =====================================================================
    // UI — hlavní modal
    // =====================================================================
    function renderCpList() {
        var box = document.getElementById('aggo-cps'); if (!box) return;
        if (!_cps.length) { box.innerHTML = '<div style="opacity:.6;font-size:12.5px;">Zatím žádné vlícovací body. Přidej aspoň 2.</div>'; }
        else {
            box.innerHTML = _cps.map(function (c, i) {
                return '<div class="cluster-list-item" style="display:flex;align-items:center;gap:8px;">'
                    + '<div style="flex:1;min-width:0;"><div class="cluster-item-title">Bod ' + (i + 1) + '</div>'
                    + '<div class="cluster-item-subtitle">px ' + c.px.toFixed(0) + ',' + c.py.toFixed(0) + ' → Y ' + Math.abs(c.wx).toFixed(2) + '  X ' + Math.abs(c.wy).toFixed(2) + '</div></div>'
                    + '<button class="w-proj-icon danger" data-del="' + i + '" aria-label="Smazat"><svg class="icon"><use href="#i-trash"/></svg></button></div>';
            }).join('');
            box.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { _cps.splice(parseInt(b.getAttribute('data-del'), 10), 1); afterCpsChanged(); }); });
        }
        var st = document.getElementById('aggo-status');
        if (st) {
            if (_cps.length < 2) st.innerHTML = 'Potřebuju ještě ' + (2 - _cps.length) + ' bod(y).';
            else if (_cps.length === 2) st.innerHTML = '<b>Podobnostní</b> transformace (2 body).';
            else st.innerHTML = '<b>Afinní</b> transformace (' + _cps.length + ' bodů)' + (_rms != null ? ' · RMS ±<b>' + _rms.toFixed(2) + ' m</b>' : '') + '.';
        }
    }
    function afterCpsChanged() { buildTransform(); refreshLayer(); renderCpList(); saveParams(); }

    function showWorldEditor() {
        var ed = document.getElementById('aggo-worlded'); if (!ed) return;
        ed.style.display = 'block';
        var ptOpts = '';
        try { if (typeof arPoints !== 'undefined') ptOpts = arPoints.filter(function (p) { return !p.hidden; }).map(function (p) { return '<option value="' + p.id + '">#' + p.name + '</option>'; }).join(''); } catch (e) {}
        ed.innerHTML =
            '<div style="margin:6px 0;padding:10px;border-radius:10px;background:rgba(255,255,255,0.06);">'
            + '<div style="font-size:12.5px;opacity:.8;margin-bottom:6px;">Skutečné souřadnice tohoto bodu:</div>'
            + '<div style="display:flex;gap:8px;"><input type="number" id="aggo-wy" placeholder="Y (S-JTSK)" step="0.01" style="flex:1;"><input type="number" id="aggo-wx" placeholder="X (S-JTSK)" step="0.01" style="flex:1;"></div>'
            + '<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">'
            + '<button class="btn btn-secondary" id="aggo-gps" style="flex:1;margin:0;">Z GPS</button>'
            + (ptOpts ? '<select id="aggo-pt" style="flex:1;"><option value="">— existující bod —</option>' + ptOpts + '</select>' : '')
            + '</div>'
            + '<button class="btn" id="aggo-addcp" style="margin-top:8px;">Přidat vlícovací bod</button>'
            + '<button class="btn btn-secondary" id="aggo-cancelcp" style="margin-top:8px;">Zrušit</button>'
            + '</div>';
        var gps = ed.querySelector('#aggo-gps');
        if (gps) gps.onclick = function () {
            var lat = null, lng = null;
            try { if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && gpsAvgResult.n >= 2) { lat = gpsAvgResult.lat; lng = gpsAvgResult.lng; } else if (typeof userLat !== 'undefined' && userLat != null) { lat = userLat; lng = userLng; } } catch (e) {}
            if (lat == null) { agAlert('Bez GPS', 'Zatím nemám polohu.'); return; }
            var w = latLngToWorld(lat, lng); if (w) { ed.querySelector('#aggo-wy').value = Math.abs(w.x).toFixed(2); ed.querySelector('#aggo-wx').value = Math.abs(w.y).toFixed(2); }
        };
        var sel = ed.querySelector('#aggo-pt');
        if (sel) sel.onchange = function () {
            var p = (typeof arPoints !== 'undefined') ? arPoints.find(function (q) { return q.id === sel.value; }) : null; if (!p) return;
            var w = latLngToWorld(p.lat, p.lng); if (w) { ed.querySelector('#aggo-wy').value = Math.abs(w.x).toFixed(2); ed.querySelector('#aggo-wx').value = Math.abs(w.y).toFixed(2); }
        };
        ed.querySelector('#aggo-cancelcp').onclick = function () { _pendingPixel = null; ed.style.display = 'none'; ed.innerHTML = ''; };
        ed.querySelector('#aggo-addcp').onclick = function () {
            var Y = parseFloat(String(ed.querySelector('#aggo-wy').value).replace(',', '.')), X = parseFloat(String(ed.querySelector('#aggo-wx').value).replace(',', '.'));
            if (!isFinite(Y) || !isFinite(X)) { agAlert('Chybí souřadnice', 'Vyplň Y i X (ručně, z GPS, nebo z bodu).'); return; }
            var w = sjtskToWorld(Y, X);
            _cps.push({ px: _pendingPixel.px, py: _pendingPixel.py, wx: w.x, wy: w.y });
            _pendingPixel = null; ed.style.display = 'none'; ed.innerHTML = '';
            afterCpsChanged();
        };
    }

    function loadImageFile(file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            loadImageFromDataURL(e.target.result).then(function (im) {
                _img = im;
                idbPut('img_' + projId(), e.target.result).catch(function () { agAlert('Pozor', 'Obrázek se nepodařilo uložit (možná je moc velký) — bude platit jen do reloadu.'); });
                buildTransform(); refreshLayer(); saveParams(); renderInfo();
            }).catch(function () { agAlert('Chyba', 'Soubor se nepodařilo načíst jako obrázek.'); });
        };
        reader.readAsDataURL(file);
    }
    function renderInfo() {
        var info = document.getElementById('aggo-imginfo'); if (!info) return;
        info.innerHTML = _img ? ('Obrázek ' + _img.width + '×' + _img.height + ' px') : '<span style="opacity:.6">Žádný obrázek</span>';
        var opv = document.getElementById('aggo-op'); if (opv) opv.value = Math.round(_opacity * 100);
        var vis = document.getElementById('aggo-vis'); if (vis) vis.checked = _visible;
    }

    function ensureModal() {
        if (document.getElementById('aggo-modal')) return;
        var el = document.createElement('div'); el.className = 'modal-overlay'; el.id = 'aggo-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Vlastní georeferencovaný podklad</h3>'
            + '<input type="file" id="aggo-file" accept="image/*" style="display:none;">'
            + '<button class="btn btn-secondary" id="aggo-load"><svg class="icon"><use href="#i-upload"/></svg> Načíst obrázek (plán / situace)</button>'
            + '<div id="aggo-imginfo" style="font-size:12.5px;margin:8px 0;color:var(--accent);"></div>'
            + '<label style="margin-top:4px;">Vlícovací body</label>'
            + '<div id="aggo-cps" style="margin:4px 0;"></div>'
            + '<div id="aggo-status" style="font-size:12.5px;opacity:.85;margin:4px 0;"></div>'
            + '<button class="btn btn-secondary" id="aggo-add"><svg class="icon"><use href="#i-plus"/></svg> Přidat vlícovací bod (z obrázku)</button>'
            + '<div id="aggo-worlded" style="display:none;"></div>'
            + '<div style="display:flex;align-items:center;gap:10px;margin-top:14px;"><span style="font-size:13px;">Průhlednost</span>'
            + '<input type="range" id="aggo-op" min="10" max="100" step="5" value="70" style="flex:1;"></div>'
            + '<label class="filter-row" style="margin-top:8px;"><input type="checkbox" id="aggo-vis" checked> Zobrazit podklad na mapě</label>'
            + '<div style="display:flex;gap:8px;margin-top:8px;">'
            + '<button class="btn btn-secondary" id="aggo-fit" style="flex:1;margin:0;">Přizpůsobit pohled</button>'
            + '<button class="btn btn-danger" id="aggo-del" style="flex:1;margin:0;">Odebrat</button></div>'
            + '<button class="btn btn-secondary" style="margin-top:10px;" onclick="document.getElementById(\'aggo-modal\').style.display=\'none\'">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);

        el.querySelector('#aggo-load').onclick = function () { el.querySelector('#aggo-file').click(); };
        el.querySelector('#aggo-file').onchange = function (e) { loadImageFile(e.target.files && e.target.files[0]); e.target.value = ''; };
        el.querySelector('#aggo-add').onclick = function () {
            if (!_img) { agAlert('Není obrázek', 'Nejdřív načti obrázek.'); return; }
            openPicker(function (px) { _pendingPixel = px; showWorldEditor(); });
        };
        el.querySelector('#aggo-op').oninput = function () { _opacity = parseInt(this.value, 10) / 100; if (_layer && _layer.setOpacity) _layer.setOpacity(_opacity); saveParams(); };
        el.querySelector('#aggo-vis').onchange = function () { _visible = this.checked; refreshLayer(); saveParams(); };
        el.querySelector('#aggo-fit').onclick = function () { fitToOverlay(); };
        el.querySelector('#aggo-del').onclick = function () {
            agGuard('Odebrat vlastní podklad z této zakázky?', function () {
                idbDel('img_' + projId()); try { if (typeof removeStoredData === 'function') removeStoredData(PKEY); else if (typeof setStoredData === 'function') setStoredData(PKEY, ''); } catch (e) {}
                resetState(); renderInfo(); renderCpList();
                var st = document.getElementById('aggo-status'); if (st) st.innerHTML = '';
            }, { danger: true });
        };
    }

    function fitToOverlay() {
        var m = getMap(); if (!m || !_img || !_imgToWorld || typeof L === 'undefined') { agAlert('Není co zaměřit', 'Nejdřív umísti podklad (≥2 body).'); return; }
        var corners = [[0, 0], [_img.width, 0], [_img.width, _img.height], [0, _img.height]], lls = [];
        for (var i = 0; i < 4; i++) { var w = _imgToWorld(corners[i][0], corners[i][1]); var ll = worldToLatLng(w); if (ll) lls.push([ll.lat, ll.lng]); }
        if (lls.length) try { m.fitBounds(lls, { padding: [30, 30] }); } catch (e) {}
    }

    function openTool() {
        ensureModal(); renderInfo(); renderCpList();
        document.getElementById('aggo-modal').style.display = 'flex';
    }
    window.agOpenGeoOverlay = openTool;

    // ---- přepnutí zakázky ------------------------------------------------------
    function hookProjectSwitch() {
        try {
            if (typeof loadProjectSettings === 'function' && !loadProjectSettings.__aggo) {
                var _orig = loadProjectSettings;
                loadProjectSettings = function () { var r = _orig.apply(this, arguments); resetState(); loadAll().then(renderInfoSafe); return r; };
                loadProjectSettings.__aggo = true;
            }
        } catch (e) {}
    }
    function renderInfoSafe() { try { renderInfo(); renderCpList(); } catch (e) {} }

    // ---- registrace + init -----------------------------------------------------
    function register() {
        var item = { id: 'geo-overlay', label: 'Vlastní podklad', icon: ICON, onClick: openTool, order: 50 };
        if (typeof window.agRegisterFieldTool === 'function') { window.agRegisterFieldTool(item); return; }
        // fallback: vlastní plovoucí tlačítko, když launcher chybí
        if (document.getElementById('aggo-fab')) return;
        var b = document.createElement('button'); b.id = 'aggo-fab'; b.type = 'button'; b.title = item.label;
        b.style.cssText = 'position:fixed;left:12px;bottom:104px;z-index:99980;width:auto;padding:9px 13px;border:none;border-radius:12px;background:var(--accent,#2f9e74);color:#04110b;font:600 13px sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4);';
        b.textContent = 'Podklad'; b.addEventListener('click', openTool); document.body.appendChild(b);
    }
    function init() {
        try { hookProjectSwitch(); register(); loadAll().then(renderInfoSafe); } catch (e) { console.warn('[geo-overlay] init', e); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });
})();

/* === DOPLNĚK: scroll + zavírací X v rohu pro VŠECHNY modály terénních nástrojů =
   Uživatel hlásil: scroll u některých nástrojů nejde a chybí rohový křížek.
   Dřív se to řešilo pevným seznamem ID (jen moje moduly + AR resekce), takže
   modály ostatních nástrojů (parcela, DMT/kubatury, oměrné, import, vektor
   katastr…) zůstaly bez scrollu a bez X. Teď OBECNĚ: každý .modal-overlay, jehož
   .modal-content NEMÁ .modal-body (tj. „plochý" nástrojový modál), dostane scroll
   (display:block + overflow) a přilepený zavírací křížek. Nativní okna appky
   (Nastavení, Export, Kalkulačka…) mají modal-body / jsou na denylistu -> nešahá.
   NEEDITUJE cizí moduly. Odpojitelné spolu s geo-overlay.js. */
(function () {
    'use strict';
    // nativní okna appky (vlastní struktura/zavírání) — nikdy nešahat
    var SKIP = { 'settings-modal': 1, 'manage-modal': 1, 'calc-modal': 1, 'about-modal': 1, 'dict-modal': 1, 'tools-modal': 1, 'compass-modal': 1, 'welcome-screen': 1, 'stakeout-modal': 1, 'stake-detail-modal': 1 };
    function injectCss() {
        if (document.getElementById('ag-modalx-css')) return;
        var st = document.createElement('style'); st.id = 'ag-modalx-css';
        st.textContent =
            // Terénní nástroje jedou (na přání) PŘES CELOU OBRAZOVKU — scroll je
            // uvnitř fullscreen plochy, ne v 88vh kartě (ta nechávala mezery nahoře/dole).
            '.modal-overlay .modal-content.ag-scrollable{display:block;width:100%;max-width:100%;height:100%;max-height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;}'
            + '.ag-modal-x{position:sticky;top:0;z-index:6;height:0;text-align:right;pointer-events:none;}'
            + '.ag-modal-x>button{pointer-events:auto;position:relative;top:-10px;right:-6px;width:34px;height:34px;border:none;border-radius:50%;background:rgba(0,0,0,0.5);color:#fff;font:300 23px/1 system-ui,sans-serif;cursor:pointer;}';
        (document.head || document.documentElement).appendChild(st);
    }
    function isToolModal(ov, c) {
        if (!c) return false;
        if (ov.id && SKIP[ov.id]) return false;
        if (c.querySelector('.modal-body')) return false;   // strukturované/nativní modály -> nešahat
        return true;
    }
    function enhance(ov, c) {
        if (!c.classList.contains('ag-scrollable')) c.classList.add('ag-scrollable');
        // Křížek si od 27.7. bere js/modal-close.js — a dává ho VŠEM modálům, nejen
        // nástrojovým. Bez tohohle návratu by na nástrojových oknech byly DVA křížky
        // vedle sebe. Rolování (.ag-scrollable) výš zůstává na téhle vrstvě.
        // Když modal-close.js odpojíš, křížek si tady zase začne dělat sám.
        if (window.AGModalClose) return;
        if (c.querySelector('.ag-modal-x')) return;
        var wrap = document.createElement('div'); wrap.className = 'ag-modal-x';
        var b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Zavřít'); b.textContent = '×';
        b.addEventListener('click', function () { try { ov.style.display = 'none'; } catch (e) {} });
        wrap.appendChild(b); c.insertBefore(wrap, c.firstChild);
    }
    function tick() {
        try {
            injectCss();
            var ovs = document.querySelectorAll('.modal-overlay');
            for (var i = 0; i < ovs.length; i++) {
                var ov = ovs[i], c = ov.querySelector('.modal-content');
                if (isToolModal(ov, c)) enhance(ov, c);
            }
        } catch (e) {}
    }
    // BATERIE: tohle býval nejrychlejší trvalý poll v appce — každých 400 ms se prohledávaly
    // všechny .modal-overlay, ačkoli nový modál vznikne jen občas. Doplnění křížku nezávisí
    // na tom, jestli je modál právě vidět (isToolModal řeší jen strukturu), takže stačí
    // zachytit VZNIK prvku: MutationObserver na childList přímo v <body>. Záměrně BEZ
    // subtree/attributes — to by při renderu AR (styly 100 značek každý snímek) střílelo
    // pořád. Pomalý časovač zůstává jako pojistka pro modály vkládané jinam (2 s místo 0,4 s).
    function init() {
        try {
            injectCss();
            if (!window.__agModalXObs && typeof MutationObserver === 'function' && document.body) {
                var pend = 0;
                var obs = new MutationObserver(function () {
                    if (pend) return;
                    pend = setTimeout(function () { pend = 0; tick(); }, 60);
                });
                obs.observe(document.body, { childList: true });
                window.__agModalXObs = obs;
            }
            if (!window.__agModalXTimer) window.__agModalXTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 2000);
            tick();
        } catch (e) {}
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    window.addEventListener('load', function () { setTimeout(init, 500); });
})();
