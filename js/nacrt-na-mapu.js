// ===== QTRIG — NÁČRT NA MAPĚ: oficiální náčrt ČÚZK položený na katastr (ODPOJITELNÁ) ====
// VÝBĚR UŽIVATELE 17. 9. 2026 (ze stránky „Jak ještě usnadnit dohledávání bodů": „pouze N2"):
//   „Náčrt z ČÚZK je obrázek. Dvěma klepnutími (roh budovy v náčrtu → týž roh v mapě)
//    se obrázek natáhne a otočí na katastr, poloprůhledně. Vidíš, na které straně sloupu
//    a jak daleko od plotu bod leží, a v AR se to promítne na zem."
//
// PROČ: telefon dovede na ±3–5 m a tam GPS končí. Posledních pár metrů řekne okolí bodu —
// a to je nakreslené v místopisném náčrtu (karta bodu ho už ukazuje). Položený na katastr
// (DKM = centimetry) náčrt ukáže, na KTERÉ STRANĚ plotu / sloupu / rohu bod leží.
//
// JAK SE NÁČRT POKLÁDÁ (dva vlícovací body, podobnostní transformace = posun+otočení+měřítko):
//   1. klepnutí V NÁČRTU na značku samotného bodu — jeho souřadnice známe přesně,
//      takže první vlícovací bod nepotřebuje klepnutí do mapy;
//   2. klepnutí V NÁČRTU na roh budovy / lomový bod hranice, který je i v mapě;
//   3. klepnutí V MAPĚ na týž roh — přichytí se k lomovému bodu katastru do 3 m
//      (stažené parcely v zakázce, jinak živě RÚIAN vrstva 5, stejný host jako bodová pole).
//   Volitelně třetí a další dvojice → afinní transformace metodou nejmenších čtverců
//   a údaj, o kolik se vlícovací body pobíjejí (RMS) — když náčrt „nesedí", je to vidět.
//
// POCTIVĚ: náčrty bývají schematické, ne v měřítku → ±0,5–1 m. Dobré na „která strana",
// ne na „kde kopnout". Bod sám je v obrázku vždy PŘESNĚ na svých souřadnicích (1. vlícovací
// bod), rozteče okolí jsou tak dobré, jak dobře kreslil místopisec.
//
// KDE JE VIDĚT: v mapě (warped <canvas> v overlayPane Leafletu, jede i s otáčením mapy,
// průhlednost posuvníkem) a v AR (mřížka 8×N buněk, každá buňka dva trojúhelníky
// s afinním mapováním textury na zem — projekce shodná s grafika.js renderAR). Pruh dole
// drží průhlednost, AR přepínač, „Zpřesnit" (další dvojice) a „Sundat".
// Jeden náčrt najednou; položení přežije restart (localStorage, obrázek drží service
// worker v TILE_CACHE).
//
// VSTUPY: tlačítko „Položit náčrt na mapu" pod náčrtem v kartě bodu (js/karta-bodu-plus.js,
// dotáhne modul přes AGLazy.need), dlaždice v Nástrojích → Katastr a podklady
// (agOpenNacrtNaMapu), větev `AGNacrtMapa.armed` v klik-dispatcheru mapy (js/grafika.js,
// stejný vzor jako AGManualPos).
// Odstranění: smaž js/nacrt-na-mapu.js, řádek <script type="ag/lazy"> v index.html, záznam
// 'nacrt-na-mapu' v js/tools-registry.js + data/navody.json a tlačítko v karta-bodu-plus.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGNacrtMapa) return;

    var KEY = 'agNacrtNaMape_v1';      // {id,name,url,role,cps:[{px,py,e,n}],op,ar,w,h,ts}
    var SNAP_M = 3;                    // přichycení klepnutí k lomovému bodu katastru
    var TTL = 30 * 864e5;              // položení se pamatuje měsíc
    var MESH = 8;                      // sloupců mřížky v AR
    var RUIAN_PARC = 'https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/5/query';
    var BAR = 'ag-nm-bar', PICK = 'ag-nm-pick';

    // ---- stav ---------------------------------------------------------------------
    var S = {
        pt: null,            // {id,name,lat,lng}
        img: null,           // Image (originál, může být cross-origin → canvas „tainted", jen se kreslí)
        url: '', role: '',
        cps: [],             // [{px,py,e,n}] e/n = metry východně/severně od bodu
        T: null,             // {fwd(px,py)->{e,n}, inv(e,n)->{px,py}, scale (m/px), rms|null}
        op: 0.55, ar: true,
        armed: false,        // čekáme na klepnutí do mapy
        _pending: null,      // {px,py} vybrané v náčrtu, čeká na mapu
        layer: null,         // Leaflet vrstva
        small: null,         // zmenšený obrázek pro AR (≤ 512 px)
        zdroj: ''            // 'katastr' | 'ukm' | '' — k čemu se přichytilo
    };

    // ---- pomocníci ------------------------------------------------------------------
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, 'nacrt-na-mapu:' + kde); } catch (e2) { /* nic */ } }
    function byId(id) { return document.getElementById(id); }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : (typeof agInfo === 'function' ? agInfo(m) : null)); } catch (e) { swallow(e, 'toast'); } }
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { swallow(e, 'agAlert'); } try { agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e) { swallow(e, 'agInfo'); } }
    function theMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function leaflet() { try { return (typeof L !== 'undefined') ? L : null; } catch (e) { return null; } }
    function fmt(v, d) { return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d).replace('.', ','); }
    function mPerDeg(lat) { var f = lat * Math.PI / 180; return { lat: 111132.954 - 559.822 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f), lng: 111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f) }; }
    // metry od bodu ↔ zeměpisné souřadnice (místní rovina kolem bodu; náčrt má desítky metrů)
    function toEN(lat, lng) { var m = mPerDeg(S.pt.lat); return { e: (lng - S.pt.lng) * m.lng, n: (lat - S.pt.lat) * m.lat }; }
    function toLL(e, n) { var m = mPerDeg(S.pt.lat); return { lat: S.pt.lat + n / m.lat, lng: S.pt.lng + e / m.lng }; }
    function online() { return navigator.onLine !== false; }

    // ---- transformace obrázek (px, py dolů) → metry (e východ, n sever) --------------------
    // Vstup se bere jako (u = px, v = −py), aby otočení+měřítko nemuselo zrcadlit.
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
    function buildTransform(cps) {
        if (!cps || cps.length < 2) return null;
        var m11, m12, m21, m22, tx, ty, rms = null;
        if (cps.length === 2) {
            // podobnostní (Helmert): e = a·u − b·v + tx, n = b·u + a·v + ty
            var p1 = cps[0], p2 = cps[1];
            var du = p2.px - p1.px, dv = -(p2.py - p1.py);
            var de = p2.e - p1.e, dn = p2.n - p1.n;
            var den = du * du + dv * dv; if (den < 1e-9) return null;
            var a = (du * de + dv * dn) / den, b = (du * dn - dv * de) / den;
            m11 = a; m12 = -b; m21 = b; m22 = a;
            tx = p1.e - (a * p1.px - b * (-p1.py)); ty = p1.n - (b * p1.px + a * (-p1.py));
        } else {
            // afinní MNČ, 2× nezávislý 3-parametrový systém
            var Suu = 0, Suv = 0, Su = 0, Svv = 0, Sv = 0, n = cps.length, bE = [0, 0, 0], bN = [0, 0, 0];
            for (var i = 0; i < n; i++) {
                var c = cps[i], u = c.px, v = -c.py;
                Suu += u * u; Suv += u * v; Su += u; Svv += v * v; Sv += v;
                bE[0] += u * c.e; bE[1] += v * c.e; bE[2] += c.e;
                bN[0] += u * c.n; bN[1] += v * c.n; bN[2] += c.n;
            }
            var N = [[Suu, Suv, Su], [Suv, Svv, Sv], [Su, Sv, n]];
            var me = solve3(N, bE), mn = solve3(N, bN); if (!me || !mn) return null;
            m11 = me[0]; m12 = me[1]; tx = me[2]; m21 = mn[0]; m22 = mn[1]; ty = mn[2];
        }
        var det = m11 * m22 - m12 * m21; if (Math.abs(det) < 1e-12) return null;
        var fwd = function (px, py) { var u = px, v = -py; return { e: m11 * u + m12 * v + tx, n: m21 * u + m22 * v + ty }; };
        var inv = function (e, n) { var x = e - tx, y = n - ty; var u = (m22 * x - m12 * y) / det, v = (-m21 * x + m11 * y) / det; return { px: u, py: -v }; };
        if (cps.length > 2) {
            var sum = 0;
            for (var j = 0; j < cps.length; j++) { var w = fwd(cps[j].px, cps[j].py); sum += (w.e - cps[j].e) * (w.e - cps[j].e) + (w.n - cps[j].n) * (w.n - cps[j].n); }
            rms = Math.sqrt(sum / cps.length);
        }
        return { fwd: fwd, inv: inv, scale: Math.sqrt(Math.abs(det)), rms: rms, mirror: det < 0 };
    }

    // ---- přichycení k lomovým bodům katastru ------------------------------------------------
    var _katLive = [];
    function katVertices() {
        var out = [];
        try {
            if (typeof getStoredData === 'function') {
                var raw = getStoredData('agCadastreParcels');
                var arr = raw ? (JSON.parse(raw) || []) : [];
                arr.forEach(function (pc) { (pc.rings || []).forEach(function (r) { r.forEach(function (v) { if (v && isFinite(v.lat) && isFinite(v.lng)) out.push({ lat: v.lat, lng: v.lng, zdroj: pc.zdroj || 1 }); }); }); });
            }
        } catch (e) { swallow(e, 'katVertices'); }
        _katLive.forEach(function (pc) { pc.rings.forEach(function (r) { r.forEach(function (v) { out.push({ lat: v.lat, lng: v.lng, zdroj: pc.zdroj }); }); }); });
        return out;
    }
    function snapTo(ll, verts) {
        var m = mPerDeg(ll.lat), best = null;
        for (var i = 0; i < verts.length; i++) {
            var d = Math.hypot((verts[i].lng - ll.lng) * m.lng, (verts[i].lat - ll.lat) * m.lat);
            if (d <= SNAP_M && (!best || d < best.d)) best = { d: d, lat: verts[i].lat, lng: verts[i].lng, zdroj: verts[i].zdroj || 1 };
        }
        return best;
    }
    function fetchParcela(ll) {
        var p = { geometry: JSON.stringify({ x: ll.lng, y: ll.lat, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPoint', inSR: '4326', outSR: '4326',
            spatialRel: 'esriSpatialRelIntersects', outFields: 'id,zdroj', returnGeometry: 'true', f: 'json' };
        var url = RUIAN_PARC + '?' + Object.keys(p).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
        return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (r) { return r.json(); }).then(function (j) {
            clearTimeout(t);
            var f = j && j.features && j.features[0]; if (!f || !f.geometry || !f.geometry.rings) return null;
            var o = { zdroj: (f.attributes && f.attributes.zdroj) || 1, rings: f.geometry.rings.map(function (r) { return r.map(function (c) { return { lat: c[1], lng: c[0] }; }); }) };
            _katLive.push(o);
            return o;
        }).catch(function () { clearTimeout(t); return null; });
    }
    // vrátí Promise<{lat,lng,zdroj|null}> — přichycený, nebo původní klepnutí
    function snapKatastr(ll) {
        var sn = snapTo(ll, katVertices());
        if (sn) return Promise.resolve(sn);
        if (!online()) return Promise.resolve({ lat: ll.lat, lng: ll.lng, zdroj: null });
        return fetchParcela(ll).then(function (pc) {
            var s2 = pc ? snapTo(ll, katVertices()) : null;
            return s2 || { lat: ll.lat, lng: ll.lng, zdroj: null };
        });
    }

    // ---- obrázek --------------------------------------------------------------------------
    function loadImage(url) {
        return new Promise(function (res, rej) {
            var im = new Image();
            im.referrerPolicy = 'no-referrer';
            im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('img')); };
            im.src = url;
        });
    }
    function smallImage(img) {
        try {
            var k = Math.min(1, 512 / Math.max(img.width, img.height));
            if (k >= 1) return img;
            var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            return c;
        } catch (e) { swallow(e, 'smallImage'); return img; }
    }

    // ---- výběr místa v náčrtu (lupa + posun + ťuknutí; vzor js/geo-overlay.js) --------------
    function css() {
        if (byId('ag-nm-css')) return;
        var st = document.createElement('style'); st.id = 'ag-nm-css';
        st.textContent = [
            '#' + PICK + ' .ag-nm-wrap{position:relative;width:100%;height:56vh;background:#fff;border-radius:10px;overflow:hidden;touch-action:none;}',
            '#' + PICK + ' canvas{position:absolute;top:0;left:0;}',
            '#' + PICK + ' .ag-nm-step{font-size:calc(13px * var(--ag-font-scale,1));margin:0 0 8px;line-height:1.4;}',
            '#' + PICK + ' .ag-nm-step b{color:var(--accent);}',
            '#' + PICK + ' .ag-nm-zoom{display:flex;gap:8px;margin-top:8px;}#' + PICK + ' .ag-nm-zoom .btn{flex:1;margin:0;}',
            '#' + BAR + '{position:fixed;left:50%;transform:translateX(-50%);z-index:100001;bottom:max(18px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;background:rgba(8,11,15,.9);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:10px 14px;color:#fff;font-size:calc(13px * var(--ag-font-scale,1));box-shadow:0 6px 24px rgba(0,0,0,.4);max-width:calc(100vw - 24px);min-width:260px;}',
            '#' + BAR + ' .ag-nm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
            '#' + BAR + ' button{border:none;border-radius:999px;padding:8px 12px;background:rgba(255,255,255,.14);color:#fff;font-size:calc(13px * var(--ag-font-scale,1));cursor:pointer;}',
            '#' + BAR + ' button.on{background:var(--accent,#3b82f6);font-weight:600;}',
            '#' + BAR + ' button.x{background:rgba(239,68,68,.35);}',
            '#' + BAR + ' input[type=range]{flex:1;min-width:90px;accent-color:var(--accent,#3b82f6);}',
            '#' + BAR + ' small{opacity:.75;display:block;}',
            '.ag-kb-nm{display:block;width:100%;margin:6px 0 0;padding:9px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;font-size:calc(13px * var(--ag-font-scale,1));cursor:pointer;text-align:left;}',
            '.ag-kb-nm.on{border-color:var(--accent,#3b82f6);}',
            '.ag-kb-nm .icon{width:16px;height:16px;vertical-align:-3px;margin-right:6px;}'
        ].join('\n');
        document.head.appendChild(st);
    }
    // krok: {title, text, ok} → cb({px,py}) | null (zrušeno)
    function openPicker(step, cb) {
        css();
        var old = byId(PICK); if (old) old.remove();
        var ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = PICK; ov.style.display = 'flex'; ov.style.zIndex = '100003';
        ov.innerHTML = '<div class="modal-content" style="overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + esc(step.title) + '</h3>'
            + '<p class="ag-nm-step">' + step.text + '</p>'
            + '<div class="ag-nm-wrap" id="ag-nm-wrap"><canvas id="ag-nm-cv"></canvas></div>'
            + '<div class="ag-nm-zoom"><button type="button" class="btn btn-secondary" id="ag-nm-zin">＋</button><button type="button" class="btn btn-secondary" id="ag-nm-zout">－</button></div>'
            + '<button type="button" class="btn" id="ag-nm-ok" style="margin-top:10px;" disabled>' + esc(step.ok) + '</button>'
            + '<button type="button" class="btn btn-secondary" id="ag-nm-cancel" style="margin-top:8px;">Zrušit</button>'
            + '</div>';
        document.body.appendChild(ov);
        var img = S.img, wrap = ov.querySelector('#ag-nm-wrap'), cv = ov.querySelector('#ag-nm-cv'), ctx = cv.getContext('2d');
        var view = { scale: 1, ox: 0, oy: 0 }, mark = null, drag = null, moved = 0, pinch = null;
        function fit() {
            // clientWidth/Height, NE getBoundingClientRect: modal se při otevření animuje (scale),
            // takže rect po 60 ms je zmenšený a plátno by zůstalo menší než rámeček
            var r = { width: wrap.clientWidth || 300, height: wrap.clientHeight || 300 }; cv.width = r.width; cv.height = r.height;
            // celý list geodetických údajů (TB/ZhB): začít výřezem pravého horního rohu, kde je náčrt
            var rx = 0, ry = 0, rw = img.width, rh = img.height;
            if (S.role === 'list') { rx = img.width * 0.62; ry = img.height * 0.12; rw = img.width * 0.38; rh = img.height * 0.30; }
            var s = Math.min(r.width / rw, r.height / rh); view.scale = s;
            view.ox = (r.width - rw * s) / 2 - rx * s; view.oy = (r.height - rh * s) / 2 - ry * s; draw();
        }
        function draw() {
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.drawImage(img, view.ox, view.oy, img.width * view.scale, img.height * view.scale);
            // už vybrané vlícovací body (šedě), aktuální (červeně)
            S.cps.forEach(function (c) { cross(view.ox + c.px * view.scale, view.oy + c.py * view.scale, '#2563eb'); });
            if (S._pending) cross(view.ox + S._pending.px * view.scale, view.oy + S._pending.py * view.scale, '#2563eb');
            if (mark) cross(view.ox + mark.px * view.scale, view.oy + mark.py * view.scale, '#ff3b30');
        }
        function cross(sx, sy, col) {
            ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx - 14, sy); ctx.lineTo(sx + 14, sy); ctx.moveTo(sx, sy - 14); ctx.lineTo(sx, sy + 14); ctx.stroke();
            ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 2 * Math.PI); ctx.stroke();
        }
        function zoomAt(f, cx, cy) { view.ox = cx - (cx - view.ox) * f; view.oy = cy - (cy - view.oy) * f; view.scale *= f; draw(); }
        var ptrs = {};
        wrap.addEventListener('pointerdown', function (e) {
            ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
            var ids = Object.keys(ptrs);
            if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.scale, ox: view.ox, oy: view.oy, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; drag = null; return; }
            drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy }; moved = 0;
            try { wrap.setPointerCapture(e.pointerId); } catch (er) { swallow(er, 'capture'); }
        });
        wrap.addEventListener('pointermove', function (e) {
            if (ptrs[e.pointerId]) { ptrs[e.pointerId].x = e.clientX; ptrs[e.pointerId].y = e.clientY; }
            if (pinch) {
                var ids = Object.keys(ptrs); if (ids.length < 2) return;
                var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), f = d / (pinch.d || 1);
                var r = cv.getBoundingClientRect(), cx = pinch.cx - r.left, cy = pinch.cy - r.top;
                view.scale = pinch.s * f; view.ox = cx - (cx - pinch.ox) * f; view.oy = cy - (cy - pinch.oy) * f; draw(); return;
            }
            if (!drag) return;
            var dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
            view.ox = drag.ox + dx; view.oy = drag.oy + dy; draw();
        });
        function up(e) {
            delete ptrs[e.pointerId];
            if (pinch) { if (!Object.keys(ptrs).length) pinch = null; drag = null; return; }
            if (drag && moved < 6) {
                // offsetX/Y = souřadnice v prvku bez vlivu transformací předků (animace modalu)
                var ex = (typeof e.offsetX === 'number' && e.target === cv) ? e.offsetX : (e.clientX - cv.getBoundingClientRect().left);
                var ey = (typeof e.offsetY === 'number' && e.target === cv) ? e.offsetY : (e.clientY - cv.getBoundingClientRect().top);
                var px = (ex - view.ox) / view.scale, py = (ey - view.oy) / view.scale;
                if (px >= 0 && py >= 0 && px <= img.width && py <= img.height) { mark = { px: px, py: py }; ov.querySelector('#ag-nm-ok').disabled = false; draw(); }
            }
            drag = null;
        }
        wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
        ov.querySelector('#ag-nm-zin').addEventListener('click', function () { zoomAt(1.4, cv.width / 2, cv.height / 2); });
        ov.querySelector('#ag-nm-zout').addEventListener('click', function () { zoomAt(1 / 1.4, cv.width / 2, cv.height / 2); });
        ov.querySelector('#ag-nm-cancel').addEventListener('click', function () { ov.remove(); cb(null); });
        ov.querySelector('#ag-nm-ok').addEventListener('click', function () { if (mark) { var mm = mark; ov.remove(); cb(mm); } });
        setTimeout(fit, 60);
        setTimeout(function () { if (document.body.contains(ov) && !mark && (cv.width !== wrap.clientWidth || cv.height !== wrap.clientHeight)) fit(); }, 450);
    }

    // ---- vrstva v mapě (warped canvas v overlayPane, vzor js/geo-overlay.js) ----------------
    function makeLayer() {
        var Lf = leaflet(); if (!Lf) return null;
        var Cls = Lf.Layer.extend({
            onAdd: function (m) {
                this._m = m; this._zooming = false;
                var c = this._c = document.createElement('canvas');
                c.className = 'ag-nm-canvas';
                c.style.position = 'absolute'; c.style.top = '0'; c.style.left = '0'; c.style.pointerEvents = 'none'; c.style.opacity = S.op;
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
                var m = this._m; if (!m || !S.img || !S.T || this._zooming) return;
                try {
                    var size = m.getSize(), tl = m.containerPointToLayerPoint([0, 0]), Lf = leaflet();
                    Lf.DomUtil.setPosition(this._c, tl);
                    if (this._c.width !== size.x) this._c.width = size.x;
                    if (this._c.height !== size.y) this._c.height = size.y;
                    var ctx = this._c.getContext('2d'); ctx.clearRect(0, 0, size.x, size.y);
                    var corners = [[0, 0], [S.img.width, 0], [0, S.img.height]], dst = [];
                    for (var i = 0; i < 3; i++) {
                        var w = S.T.fwd(corners[i][0], corners[i][1]), ll = toLL(w.e, w.n);
                        var lp = m.latLngToLayerPoint([ll.lat, ll.lng]); dst.push([lp.x - tl.x, lp.y - tl.y]);
                    }
                    var iw = S.img.width, ih = S.img.height;
                    var a = (dst[1][0] - dst[0][0]) / iw, b = (dst[1][1] - dst[0][1]) / iw, c2 = (dst[2][0] - dst[0][0]) / ih, d = (dst[2][1] - dst[0][1]) / ih;
                    ctx.save(); ctx.setTransform(a, b, c2, d, dst[0][0], dst[0][1]); ctx.drawImage(S.img, 0, 0); ctx.restore();
                    // vlícovací body — malý modrý kroužek
                    ctx.save(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2;
                    S.cps.forEach(function (cp) { var q = toLL(cp.e, cp.n), lp2 = m.latLngToLayerPoint([q.lat, q.lng]); ctx.beginPath(); ctx.arc(lp2.x - tl.x, lp2.y - tl.y, 5, 0, 2 * Math.PI); ctx.stroke(); });
                    ctx.restore();
                } catch (e) { swallow(e, 'render'); }
            }
        });
        return new Cls();
    }
    function showLayer() {
        var m = theMap(); if (!m || !S.T) return;
        if (!S.layer) S.layer = makeLayer();
        if (!S.layer) return;
        if (!m.hasLayer(S.layer)) S.layer.addTo(m);
        S.layer.setOpacity(S.op); S.layer._render();
    }
    function hideLayer() { var m = theMap(); try { if (S.layer && m && m.hasLayer(S.layer)) m.removeLayer(S.layer); } catch (e) { swallow(e, 'hideLayer'); } }

    // ---- AR: náčrt promítnutý na zem -------------------------------------------------------
    var _arCv = null, _arRAF = null, _arIdleT = 0, _last = null;
    function haveUser() { try { return typeof userLat === 'number' && isFinite(userLat) && typeof userLng === 'number' && isFinite(userLng); } catch (e) { return false; } }
    function projAR(lat, lng, heading, pj, eyeH, vOff) {
        var dist = getDistance(userLat, userLng, lat, lng), bearing = getBearing(userLat, userLng, lat, lng);
        var diff = ((bearing - heading + 540) % 360) - 180;
        var dz = 0; try { if (typeof terrainDZ === 'function') dz = terrainDZ(lat, lng) || 0; } catch (e) { swallow(e, 'projAR'); }
        var uH = diff, vV = Math.atan2(eyeH - dz, Math.max(dist, 0.3)) * 180 / Math.PI - pj.pitch;
        if (pj.roll) { var cr = Math.cos(pj.roll), sr = Math.sin(pj.roll); var tt = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = tt; }
        return { x: 50 + (uH / pj.halfH) * 50, y: 50 + (vV / pj.halfV) * 50 - vOff, diff: diff, dist: dist };
    }
    function ensureArCanvas() {
        var ov = byId('ar-overlay'); if (!ov) return null;
        if (!_arCv) {
            _arCv = document.createElement('canvas'); _arCv.className = 'ag-nm-ar';
            _arCv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
            ov.insertBefore(_arCv, ov.firstChild);
        }
        return _arCv;
    }
    // trojúhelník textury (s0..s2 v px zmenšeného obrázku) → trojúhelník na plátně (d0..d2)
    function drawTri(ctx, img, s0, s1, s2, d0, d1, d2) {
        var den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y); if (Math.abs(den) < 1e-9) return;
        var a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / den;
        var b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / den;
        var c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / den;
        var d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / den;
        var e = d0.x - a * s0.x - c * s0.y, f = d0.y - b * s0.x - d * s0.y;
        ctx.save(); ctx.beginPath(); ctx.moveTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y); ctx.closePath(); ctx.clip();
        ctx.transform(a, b, c, d, e, f); ctx.drawImage(img, 0, 0); ctx.restore();
    }
    function arApplicable() {
        var vm = 'both'; try { vm = viewMode; } catch (e) { swallow(e, 'vm'); }
        return !!(S.T && S.ar && S.small && haveUser() && window._arProj && vm !== 'map' && document.visibilityState === 'visible'
            && getDistance(userLat, userLng, S.pt.lat, S.pt.lng) < 300);
    }
    function arLoop() {
        var cv = _arCv;
        if (!cv || !arApplicable()) {
            if (cv && cv.width) { try { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); } catch (e) { swallow(e, 'clear'); } }
            _last = null; _arRAF = null;
            _arIdleT = setTimeout(function () { _arIdleT = 0; if (!_arRAF && S.T) _arRAF = requestAnimationFrame(arLoop); }, 300);
            return;
        }
        _arRAF = requestAnimationFrame(arLoop);
        var pj = window._arProj, heading = null;
        try { heading = (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; } catch (e) { swallow(e, 'hdg'); }
        if (heading == null) return;
        var pitch = pj.pitch || 0;
        if (_last && Math.abs(heading - _last.h) < 0.3 && Math.abs(pitch - _last.p) < 0.3 && _last.lat === userLat && _last.lng === userLng && _last.w === cv.clientWidth) return;
        _last = { h: heading, p: pitch, lat: userLat, lng: userLng, w: cv.clientWidth };
        var eyeH = 1.6, vOff = 0; try { eyeH = visSettings.eyeHeight || 1.6; vOff = visSettings.arVerticalOffset || 0; } catch (e) { swallow(e, 'vis'); }
        var dpr = Math.min(1.5, window.devicePixelRatio || 1), W = cv.clientWidth || 1, H = cv.clientHeight || 1;
        if (cv.width !== Math.round(W * dpr)) cv.width = Math.round(W * dpr);
        if (cv.height !== Math.round(H * dpr)) cv.height = Math.round(H * dpr);
        var ctx = cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.scale(dpr, dpr);
        ctx.globalAlpha = Math.min(0.85, S.op + 0.15);
        var img = S.small, iw = S.img.width, ih = S.img.height, k = (img.width || iw) / iw;
        var cols = MESH, rows = Math.max(2, Math.min(12, Math.round(MESH * ih / iw)));
        // rohy mřížky: obrázek → metry → zeměpisné → obrazovka
        var grid = [];
        for (var r = 0; r <= rows; r++) {
            grid[r] = [];
            for (var c = 0; c <= cols; c++) {
                var px = iw * c / cols, py = ih * r / rows, w = S.T.fwd(px, py), ll = toLL(w.e, w.n);
                var q = projAR(ll.lat, ll.lng, heading, pj, eyeH, vOff);
                grid[r][c] = { sx: px * k, sy: py * k, x: q.x * W / 100, y: q.y * H / 100, diff: q.diff, dist: q.dist };
            }
        }
        for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
            var p00 = grid[r2][c2], p10 = grid[r2][c2 + 1], p01 = grid[r2 + 1][c2], p11 = grid[r2 + 1][c2 + 1];
            var ps = [p00, p10, p01, p11], bad = false;
            for (var i = 0; i < 4; i++) { if (Math.abs(ps[i].diff) > 100 || ps[i].dist < 0.3 || !isFinite(ps[i].x) || !isFinite(ps[i].y)) { bad = true; break; } }
            if (bad) continue;
            drawTri(ctx, img, { x: p00.sx, y: p00.sy }, { x: p10.sx, y: p10.sy }, { x: p01.sx, y: p01.sy }, p00, p10, p01);
            drawTri(ctx, img, { x: p10.sx, y: p10.sy }, { x: p11.sx, y: p11.sy }, { x: p01.sx, y: p01.sy }, p10, p11, p01);
        }
        ctx.globalAlpha = 1;
    }
    function startAr() { if (ensureArCanvas() && !_arRAF && !_arIdleT) _arRAF = requestAnimationFrame(arLoop); }
    function stopAr() {
        if (_arRAF) { cancelAnimationFrame(_arRAF); _arRAF = null; }
        if (_arIdleT) { clearTimeout(_arIdleT); _arIdleT = 0; }
        if (_arCv && _arCv.width) { try { _arCv.getContext('2d').clearRect(0, 0, _arCv.width, _arCv.height); } catch (e) { swallow(e, 'stopAr'); } }
        _last = null;
    }

    // ---- perzistence ------------------------------------------------------------------------
    function save() {
        try {
            if (!S.pt || !S.T) { localStorage.removeItem(KEY); return; }
            localStorage.setItem(KEY, JSON.stringify({ id: S.pt.id, name: S.pt.name, lat: S.pt.lat, lng: S.pt.lng, url: S.url, role: S.role, cps: S.cps, op: S.op, ar: S.ar, zdroj: S.zdroj, ts: Date.now() }));
        } catch (e) { swallow(e, 'save'); }
    }
    function restore() {
        var p = null;
        try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { p = null; }
        if (!p || !p.url || !Array.isArray(p.cps) || p.cps.length < 2 || !(Date.now() - (p.ts || 0) < TTL)) return;
        S.pt = { id: p.id, name: p.name, lat: p.lat, lng: p.lng }; S.url = p.url; S.role = p.role || ''; S.cps = p.cps;
        S.op = (typeof p.op === 'number') ? p.op : 0.55; S.ar = p.ar !== false; S.zdroj = p.zdroj || '';
        loadImage(p.url).then(function (im) {
            S.img = im; S.small = smallImage(im); S.T = buildTransform(S.cps);
            if (!S.T) { S.pt = null; return; }
            showLayer(); if (S.ar) startAr();
        }).catch(function () { /* bez obrázku (offline, cache prázdná) — položení zůstane uložené na příště */ });
    }

    // ---- pruh dole (průhlednost, AR, zpřesnit, sundat) ---------------------------------------
    function bar(mode) {
        css();
        var old = byId(BAR); if (old) old.remove();
        if (!mode) return;
        var b = document.createElement('div'); b.id = BAR;
        if (mode === 'map') {
            b.innerHTML = '<div class="ag-nm-row"><span id="ag-nm-txt">Teď klepni <b>v mapě</b> na týž roh<small>Do 3 m se přichytí k lomovému bodu katastru. Přibliž si mapu.</small></span>'
                + '<button type="button" id="ag-nm-cancel2">Zrušit</button></div>';
            document.body.appendChild(b);
            b.querySelector('#ag-nm-cancel2').addEventListener('click', function () { disarm(); bar(S.T ? 'ctl' : null); });
            return;
        }
        var zd = S.zdroj === 'katastr' ? 'roh z DKM (cm)' : (S.zdroj === 'ukm' ? 'roh z UKM (±1 m)' : 'roh podle klepnutí (±' + fmt(pxAcc(), 1) + ' m)');
        var rms = (S.T && S.T.rms != null) ? ' · body se pobíjejí o ' + fmt(S.T.rms, 1) + ' m' : '';
        b.innerHTML = '<div class="ag-nm-row"><span style="flex:1;min-width:0;">Náčrt bodu <b>' + esc(S.pt.name || '') + '</b> leží na mapě<small>1 px = ' + fmt(S.T.scale, 2) + ' m · ' + zd + rms + '</small></span>'
            + '<button type="button" id="ag-nm-hide" title="Schovat tento pruh (náčrt zůstane)">✕</button></div>'
            + '<div class="ag-nm-row"><span>Průhlednost</span><input type="range" id="ag-nm-op" min="10" max="100" value="' + Math.round(S.op * 100) + '">'
            + '<button type="button" id="ag-nm-ar" class="' + (S.ar ? 'on' : '') + '">V AR</button></div>'
            + '<div class="ag-nm-row"><button type="button" id="ag-nm-more">Zpřesnit dalším rohem</button><button type="button" id="ag-nm-off" class="x">Sundat</button></div>';
        document.body.appendChild(b);
        b.querySelector('#ag-nm-op').addEventListener('input', function () { S.op = parseInt(this.value, 10) / 100; if (S.layer) S.layer.setOpacity(S.op); _last = null; save(); });
        b.querySelector('#ag-nm-ar').addEventListener('click', function () { S.ar = !S.ar; this.classList.toggle('on', S.ar); if (S.ar) startAr(); else stopAr(); save(); });
        b.querySelector('#ag-nm-more').addEventListener('click', function () { pickPair(false); });
        b.querySelector('#ag-nm-off').addEventListener('click', function () { sundat(); toast('Náčrt sundán z mapy'); });
        b.querySelector('#ag-nm-hide').addEventListener('click', function () { bar(null); });
    }
    // přesnost klepnutí prstem podle měřítka mapy (jako Poloha z mapy: ~8 px)
    function pxAcc() { try { var m = theMap(); var z = m ? m.getZoom() : 18; return Math.max(0.3, 8 * 156543 * Math.cos(S.pt.lat * Math.PI / 180) / Math.pow(2, z)); } catch (e) { return 1; } }

    // ---- průběh: náčrt → mapa -----------------------------------------------------------------
    function ensureMapVisible() {
        try {
            if (typeof viewMode !== 'undefined' && viewMode === 'ar') {
                viewMode = 'both';
                if (typeof applyViewMode === 'function') applyViewMode();
                if (typeof window.agSyncViewControls === 'function') window.agSyncViewControls();
            }
        } catch (e) { swallow(e, 'ensureMapVisible'); }
        try {
            var m = theMap(); if (m && S.pt) { window._mapHold = true; m.setView([S.pt.lat, S.pt.lng], Math.max(m.getZoom(), 18), { animate: false }); }
        } catch (e) { swallow(e, 'setView'); }
    }
    function disarm() { S.armed = false; S._pending = null; }
    // dvojice: místo v náčrtu + místo v mapě. first = true → napřed ještě značka bodu (1. vlícovací bod)
    function pickPair(first) {
        var stepBod = { title: 'Kde je v náčrtu bod?', text: 'Ťukni na <b>značku bodu ' + esc(S.pt.name || '') + '</b> v náčrtu (zpravidla uprostřed, trojúhelník / kolečko s číslem). Táhni = posun, dva prsty nebo ＋／− = lupa.', ok: 'Tady je bod' };
        var stepRoh = { title: 'Roh, který najdeš i v mapě', text: 'Ťukni v náčrtu na <b>roh budovy</b> nebo <b>lomový bod hranice</b>, který je i v katastrální mapě. Čím dál od bodu, tím přesnější otočení a měřítko.', ok: 'Tento roh' };
        var pak = function () {
            openPicker(stepRoh, function (m2) {
                if (!m2) { if (S.cps.length >= 2 && S.T) bar('ctl'); return; }
                S._pending = m2; S.armed = true;
                try { if (typeof closeBottomSheet === 'function') closeBottomSheet(); } catch (e) { swallow(e, 'closeBottomSheet'); }
                ensureMapVisible(); bar('map');
            });
        };
        if (first) {
            openPicker(stepBod, function (m1) {
                if (!m1) return;
                S.cps = [{ px: m1.px, py: m1.py, e: 0, n: 0 }]; S.T = null; S.zdroj = '';
                pak();
            });
        } else pak();
    }
    // klepnutí do mapy (volá dispatcher v grafika.js)
    function take(lat, lng) {
        if (!S.armed || !S._pending) return false;
        var pend = S._pending; disarm();
        var t = byId('ag-nm-txt'); if (t) t.innerHTML = 'Hledám hranici katastru…';
        snapKatastr({ lat: lat, lng: lng }).then(function (sn) {
            var en = toEN(sn.lat, sn.lng);
            S.cps.push({ px: pend.px, py: pend.py, e: en.e, n: en.n });
            if (sn.zdroj) { if (!S.zdroj || S.zdroj === 'katastr') S.zdroj = (sn.zdroj === 2) ? 'ukm' : 'katastr'; }
            var T = buildTransform(S.cps);
            if (!T) { S.cps.pop(); bar(S.T ? 'ctl' : null); agAlert('Nejde položit', 'Ty dva body jsou v náčrtu na stejném místě. Zkus jiný roh dál od bodu.'); return; }
            if (T.mirror) { S.cps.pop(); bar(S.T ? 'ctl' : null); agAlert('Něco nesedí', 'Podle těchhle bodů by byl náčrt zrcadlově. Zkontroluj, že jsi v mapě klepl na stejný roh jako v náčrtu, a zkus to znovu.'); return; }
            var wm = T.scale * S.img.width;
            S.T = T; S.small = S.small || smallImage(S.img);
            showLayer(); if (S.ar) startAr(); save(); bar('ctl');
            try { if (window.AGNotify && typeof AGNotify.set === 'function') AGNotify.set('nacrt-mapa', 'Náčrt na mapě'); } catch (e) { swallow(e, 'notify'); }
            var jak = sn.zdroj ? 'Roh přichycen k lomovému bodu katastru' + (sn.zdroj === 2 ? ' (UKM, ±1 m)' : ' (DKM)') : 'Roh vzat z klepnutí (bez hranice katastru v okolí)';
            if (wm < 5 || wm > 2000) toast('Náčrt by měřil ' + Math.round(wm) + ' m — to nevypadá. Zkontroluj rohy, případně „Zpřesnit".');
            else toast(jak + '. Náčrt leží na mapě; posuvníkem nastav průhlednost.');
        });
        return true;
    }

    // ---- veřejné vstupy ---------------------------------------------------------------------
    // z karty bodu: pt = záznam bodu (arPoints), url = adresa náčrtu, role = 'nacrt' | 'list'
    function start(pt, url, role) {
        if (!pt || !url) return;
        css();
        var m = theMap(); if (!m || !leaflet()) { agAlert('Mapa', 'Mapa zatím neběží — otevři mapu a zkus to znovu.'); return; }
        if (S.pt && S.pt.id !== pt.id) sundat();
        S.pt = { id: pt.id, name: pt.name, lat: pt.lat, lng: pt.lng }; S.url = url; S.role = role || '';
        toast('Načítám náčrt…');
        loadImage(url).then(function (im) {
            S.img = im; S.small = smallImage(im);
            pickPair(true);
        }).catch(function () { agAlert('Náčrt se nenačetl', 'Bez signálu a bez zásoby v telefonu náčrt položit nejde. Zkus to se signálem.'); });
    }
    function sundat() {
        disarm(); stopAr(); hideLayer(); bar(null);
        S.pt = null; S.img = null; S.small = null; S.cps = []; S.T = null; S.zdroj = ''; _katLive = [];
        try { localStorage.removeItem(KEY); } catch (e) { swallow(e, 'rm'); }
        try { if (window.AGNotify && typeof AGNotify.clear === 'function') AGNotify.clear('nacrt-mapa'); } catch (e) { swallow(e, 'notify'); }
    }
    function active() { return (S.pt && S.T) ? S.pt.id : null; }
    // dlaždice v Nástrojích: buď pruh k položenému náčrtu, nebo návod, kde začít
    function open() {
        if (active()) { ensureMapVisible(); bar('ctl'); return; }
        agAlert('Náčrt na mapě', 'Otevři v mapě kartu <b>úředního bodu</b> (TB, ZhB, PPBP, nivelační) a pod oficiálním náčrtem ČÚZK klepni <b>Položit náčrt na mapu</b>. Pak dvěma klepnutími (roh v náčrtu → týž roh v mapě) náčrt sedne na katastr.');
    }
    // tlačítko do karty bodu (volá js/karta-bodu-plus.js po vykreslení náčrtu)
    function cardButton(pt, url, role) {
        css();
        var b = document.createElement('button'); b.type = 'button'; b.id = 'ag-kb-nm'; b.className = 'ag-kb-nm';
        var on = active() === pt.id;
        b.classList.toggle('on', on);
        b.innerHTML = '<svg class="icon"><use href="#i-map"/></svg>' + (on ? 'Náčrt leží na mapě — nastavit / sundat' : 'Položit náčrt na mapu (dvě klepnutí)');
        b.addEventListener('click', function () {
            if (active() === pt.id) { try { if (typeof closeBottomSheet === 'function') closeBottomSheet(); } catch (e) { swallow(e, 'close'); } ensureMapVisible(); bar('ctl'); }
            else start(pt, url, role);
        });
        return b;
    }

    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.T && S.ar) startAr(); });
    restore();

    window.AGNacrtMapa = {
        start: start, take: take, sundat: sundat, active: active, open: open, cardButton: cardButton, bar: function () { if (active()) bar('ctl'); },
        get armed() { return S.armed; },
        _test: { buildTransform: buildTransform, snapTo: snapTo, S: S, drawTri: drawTri }
    };
    window.agOpenNacrtNaMapu = open;
    // dlaždice v Nástrojích (seznam úkonů: Katastr a podklady; mřížka: Vytyčování a náčrt) — registr ji zná od začátku, ale modul ji nikdy
    // nevyrobil, takže hledání i seznam úkonů vedly do prázdna (18. 9. 2026 noc)
    function register() {
        try { if (typeof window.agRegisterFieldTool === 'function') window.agRegisterFieldTool({ id: 'nacrt-na-mapu', label: 'Náčrt bodu na mapě', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/><path d="M11 11l2-2 2 2"/></svg>', cat: 'Vytyčování a náčrt', onClick: open, order: 11 }); } catch (e) { swallow(e, 'register'); }   // mřížka Katastr má 14 dlaždic (strop), náčrt patří i k vytyčování
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register); else register();
})();
