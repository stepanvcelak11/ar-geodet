// ===== QTRIG — KALIBRACE GPS CHŮZÍ PO HRANĚ (ODPOJITELNÁ vrstva) ===============
// GPS neví, kde je obrubník, hrana chodníku, svodidlo nebo osa pokládky — ty to víš.
// Když ujdeš 30–50 m PODÉL známé čáry, appka má desítky fixů, o nichž ví, že leží
// na té čáře. Z jejich příčné odchylky vyjde AKTUÁLNÍ chybový vektor GPS na tomhle
// místě a v tuhle chvíli — a ten platí dalších ~15 minut v okruhu stovek metrů,
// protože chyba ionosféry a drah družic je pomalá a plošná.
//
// Je to jako „Posun GPS na známý bod", ale BEZ ZASTAVOVÁNÍ: kalibruješ cestou.
// Výsledek jde do téhož window.agRefShift (js/ref-calibration.js), takže se
// přičítá k nově ukládaným bodům a Brutální GPS ho zná.
//
// MATEMATIKA: fix p_i, nejbližší úsek čáry se směrem u_i a normálou n_i (vpravo
// od směru chůze), příčná odchylka e_i = n_i·(p_i − čára) − boční odstup. Chyba GPS
// v (konstantní přes chůzi): e_i ≈ n_i·v  →  nejmenší čtverce  [Σ n nᵀ] v = Σ n e.
//   • ROVNÁ čára: podél čáry chybu vidět NEJDE — řeší se jen kolmá složka
//     (v = ē·n̄). U silnice je to přesně ta, o kterou jde.
//   • LOMENÁ čára (úseky se liší směrem ≥ 30°): plný 2D vektor.
// Robustnost: 2× ořez |r| > 3·MAD (kolem budov GPS uskočí). Fixy se berou jen
// v chůzi (rychlost ≥ 0,3 m/s nebo posun ≥ 0,5 m), s accuracy ≤ 20 m, v rozsahu čáry.
//
// ČÁRA: klepnutím do mapy (od–kam, klidně víc lomových bodů) nebo ze dvou uložených
// bodů. Boční odstup = kolik metrů od klepnuté čáry doopravdy jdeš (+ vpravo ve
// směru chůze, − vlevo). Pozor: čára odečtená z podkladové mapy je přesná jen jako
// ten podklad (ortofoto ČÚZK ~0,2–0,5 m); z DXF/uložených bodů je přesná úplně.
//
// Vstup: dlaždice „Kalibrace chůzí po hraně" v Nástrojích (AR a kalibrace),
// načítá se až na klepnutí. Odstranění: smaž js/kalibrace-hranou.js + záznam v
// js/lazy-tools.js a js/tools-registry.js (+ data/navody.json), přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGHrana) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20 21 4"/><path d="M6 21v-2a3 3 0 0 1 3-3h0a3 3 0 0 0 3-3v-2"/><circle cx="14" cy="6" r="2"/><path d="M17 21l2-4-3-2"/></svg>';
    var DLG_ID = 'ag-hr-modal';
    var BAR_ID = 'ag-hr-bar';
    var LS_LAST = 'agHranaLast_v1';
    var ACC_MAX = 20;          // m — horší fix se nepočítá
    var SPEED_MIN = 0.3;       // m/s — pod tím stojím (fix se hromadí na jednom místě)
    var MOVE_MIN = 0.5;        // m — náhrada rychlosti, když ji telefon nehlásí
    var CROSS_MAX = 15;        // m — dál od čáry než tohle = nejdu po ní
    var MARGIN_M = 3;          // m — tolerance před začátkem / za koncem čáry
    var MIN_FIX = 12;          // minimum použitelných fixů
    var MIN_LEN = 15;          // m — minimální projitá délka
    var ANGLE_2D = 30;         // ° — od tohohle rozdílu směrů úseků jde řešit i podélnou složku

    // ---- pomocné ---------------------------------------------------------------------
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'hrana:' + kde); } catch (e2) { /* nic */ } }
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { swallow(e, 'agAlert'); } try { agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e) { swallow(e, 'agInfo'); } }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { swallow(e, 'toast'); } }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function byId(id) { return document.getElementById(id); }
    function fmt(v, d) { return (isFinite(v) ? v.toFixed(d == null ? 2 : d) : '–').replace('.', ','); }
    function mPerDeg(lat) {
        if (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) { try { var m = GeoCore.metersPerDeg(lat); if (m && m.lat) return m; } catch (e) { swallow(e, 'mPerDeg'); } }
        return { lat: 111320, lng: 111320 * Math.cos(lat * Math.PI / 180) };
    }
    function median(a) { var s = a.slice().sort(function (p, q) { return p - q; }); var n = s.length; if (!n) return NaN; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
    function points() { try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; } catch (e) { return []; } }
    function theMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function leaflet() { try { return (typeof L !== 'undefined') ? L : null; } catch (e) { return null; } }

    // ---- geometrie čáry --------------------------------------------------------------
    // Čára = lomená, v rovině (metry od prvního vrcholu). Vrací pro bod: nejbližší
    // úsek, staničení s (m od začátku), příčnou odchylku e (m, + vpravo od směru).
    function Line(verts) {
        this.lat0 = verts[0].lat; this.lng0 = verts[0].lng; this.m = mPerDeg(this.lat0);
        var self = this;
        this.v = verts.map(function (p) { return self.xy(p.lat, p.lng); });
        this.seg = []; this.len = 0;
        var i;
        for (i = 0; i + 1 < this.v.length; i++) {
            var a = this.v[i], b = this.v[i + 1], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
            if (L < 0.2) continue;
            this.seg.push({ a: a, b: b, ux: dx / L, uy: dy / L, L: L, s0: this.len, brg: Math.atan2(dx, dy) * 180 / Math.PI });
            this.len += L;
        }
    }
    Line.prototype.xy = function (lat, lng) { return { x: (lng - this.lng0) * this.m.lng, y: (lat - this.lat0) * this.m.lat }; };
    Line.prototype.project = function (lat, lng) {
        var p = this.xy(lat, lng), best = null, i;
        for (i = 0; i < this.seg.length; i++) {
            var s = this.seg[i], rx = p.x - s.a.x, ry = p.y - s.a.y;
            var t = rx * s.ux + ry * s.uy;                       // podél
            var tc = Math.max(0, Math.min(s.L, t));
            var cx = s.a.x + tc * s.ux, cy = s.a.y + tc * s.uy;
            var d = Math.hypot(p.x - cx, p.y - cy);
            if (!best || d < best.d) {
                // normála vpravo od směru chůze: (uy, -ux)
                best = { d: d, seg: s, s: s.s0 + t, e: rx * s.uy - ry * s.ux, nx: s.uy, ny: -s.ux, inside: t >= -MARGIN_M && t <= s.L + MARGIN_M };
            }
        }
        return best;
    };
    // Liší se směry úseků natolik, že jde řešit i podélnou složku?
    Line.prototype.spread = function () {
        var mx = 0, i, j;
        for (i = 0; i < this.seg.length; i++) for (j = i + 1; j < this.seg.length; j++) {
            var d = Math.abs(this.seg[i].brg - this.seg[j].brg) % 180; d = Math.min(d, 180 - d);
            if (d > mx) mx = d;
        }
        return mx;
    };

    // ---- odhad chybového vektoru ------------------------------------------------------
    // fixes: [{nx, ny, e}] (e už bez bočního odstupu). Vrací {vE, vN, sigma, n, mode}
    // vE/vN = chyba GPS (kolik GPS přičítá) → korekce je −v.
    function solve(fixes, twoD) {
        var use = fixes.slice(), it, res = null;
        for (it = 0; it < 3; it++) {
            var Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, i, vE, vN;
            for (i = 0; i < use.length; i++) { var f = use[i]; Sxx += f.nx * f.nx; Sxy += f.nx * f.ny; Syy += f.ny * f.ny; Sx += f.nx * f.e; Sy += f.ny * f.e; }
            // podélná složka je určená jen tehdy, když normály míří dost různými
            // směry: poměr vlastních čísel matice Σ n nᵀ aspoň 0,1 (jinak by malý
            // šum na pár fixech v zatáčce vyrobil metrový podélný posun)
            var det = Sxx * Syy - Sxy * Sxy, tr = Sxx + Syy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
            var lmin = tr / 2 - disc, lmax = tr / 2 + disc, mode;
            if (twoD && lmax > 0 && lmin / lmax >= 0.1) {
                vE = (Syy * Sx - Sxy * Sy) / det; vN = (Sxx * Sy - Sxy * Sx) / det; mode = '2d';
            } else {
                // jen kolmá složka: v = ē · n̄
                var nEx = 0, nEy = 0, se = 0;
                for (i = 0; i < use.length; i++) { nEx += use[i].nx; nEy += use[i].ny; se += use[i].e; }
                var nl = Math.hypot(nEx, nEy) || 1; nEx /= nl; nEy /= nl;
                var eb = se / use.length;
                vE = eb * nEx; vN = eb * nEy; mode = '1d';
            }
            var r = use.map(function (f) { return f.e - (f.nx * vE + f.ny * vN); });
            var mad = median(r.map(function (x) { return Math.abs(x - median(r)); })) * 1.4826;
            var thr = Math.max(3 * mad, 0.8);
            var keep = use.filter(function (f, k) { return Math.abs(r[k]) <= thr; });
            var s2 = 0; r.forEach(function (x) { s2 += x * x; });
            var sigma = Math.sqrt(s2 / Math.max(1, r.length - (mode === '2d' ? 2 : 1)));
            res = { vE: vE, vN: vN, sigma: sigma, n: use.length, mode: mode, dropped: fixes.length - use.length, nEff: Math.max(1, Math.round(use.length / 5)) };
            if (keep.length === use.length || keep.length < MIN_FIX / 2) break;
            use = keep;
        }
        if (res) res.sterr = res.sigma / Math.sqrt(res.nEff);   // fixy po sekundě jsou korelované → ~1 nezávislý na 5 s
        return res;
    }

    // ---- stav ------------------------------------------------------------------------
    var _verts = [];            // vrcholy čáry [{lat,lng}]
    var _line = null;
    var _offset = 0;            // boční odstup (m, + vpravo)
    var _walk = null;           // { fixes:[], raw:0, lastPos, start, wake, watch }
    var _result = null;
    var _layer = null;          // Leaflet vrstvy čáry
    var _pickOn = false;

    // ---- kreslení do mapy ---------------------------------------------------------------
    function drawLine() {
        var m = theMap(), Lf = leaflet(); if (!m || !Lf) return;
        clearLine();
        try {
            _layer = Lf.layerGroup().addTo(m);
            if (_verts.length >= 2) Lf.polyline(_verts.map(function (p) { return [p.lat, p.lng]; }), { color: '#fbbf24', weight: 4, opacity: 0.9, dashArray: '8 6' }).addTo(_layer);
            _verts.forEach(function (p, i) { Lf.circleMarker([p.lat, p.lng], { radius: 6, color: '#fbbf24', fillColor: i === 0 ? '#22c55e' : (i === _verts.length - 1 ? '#ef4444' : '#fbbf24'), fillOpacity: 1, weight: 2 }).addTo(_layer); });
        } catch (e) { swallow(e, 'drawLine'); }
    }
    function clearLine() { try { if (_layer) { _layer.remove(); _layer = null; } } catch (e) { swallow(e, 'clearLine'); } }

    // ---- výběr čáry klepnutím do mapy (vzor js/pocasi.js pickOnMap) -----------------------
    function pickOnMap() {
        var m = theMap();
        var vm = null; try { vm = viewMode; } catch (e) { swallow(e, 'vm'); }
        if (!m) { agAlert('Mapa', 'Mapa zatím neběží — přepni na mapu.'); return; }
        if (vm === 'ar') { agAlert('Mapa', 'Přepni na mapu nebo dělené zobrazení, pak klepni do mapy.'); return; }
        _verts = []; drawLine();
        var dlg = byId(DLG_ID); if (dlg) dlg.style.display = 'none';
        _pickOn = true;
        var bar = document.createElement('div');
        bar.id = BAR_ID;
        bar.innerHTML = '<span id="ag-hr-bar-txt">Klepni na <b>začátek</b> čáry, po které půjdeš</span>'
            + '<button type="button" id="ag-hr-bar-ok" style="display:none">Hotovo</button>'
            + '<button type="button" id="ag-hr-bar-x">Zrušit</button>';
        document.body.appendChild(bar);
        function txt() {
            var t = byId('ag-hr-bar-txt'), ok = byId('ag-hr-bar-ok'); if (!t) return;
            if (_verts.length === 0) t.innerHTML = 'Klepni na <b>začátek</b> čáry, po které půjdeš';
            else if (_verts.length === 1) t.innerHTML = 'Teď <b>konec</b> (nebo další lomový bod)';
            else { t.innerHTML = '<b>' + _verts.length + ' body</b> · ' + fmt(new Line(_verts).len, 0) + ' m · další lom, nebo Hotovo'; }
            if (ok) ok.style.display = _verts.length >= 2 ? '' : 'none';
        }
        function end(cancel) {
            try { m.off('click', onClick); } catch (e) { swallow(e, 'off'); }
            bar.remove(); _pickOn = false;
            if (cancel) { _verts = []; clearLine(); }
            if (dlg) dlg.style.display = 'flex';
            render();
        }
        function onClick(e) {
            var ll = null;
            try { if (e.originalEvent && typeof window.agScreenToLatLng === 'function') ll = window.agScreenToLatLng(e.originalEvent.clientX, e.originalEvent.clientY); } catch (err) { swallow(err, 'onClick'); }
            if (!ll && e.latlng) ll = e.latlng;
            if (!ll || !isFinite(ll.lat) || !isFinite(ll.lng)) return;
            _verts.push({ lat: ll.lat, lng: ll.lng });
            drawLine(); txt();
        }
        bar.querySelector('#ag-hr-bar-x').addEventListener('click', function () { end(true); });
        bar.querySelector('#ag-hr-bar-ok').addEventListener('click', function () { end(false); });
        m.on('click', onClick);
        txt();
    }

    // ---- chůze ---------------------------------------------------------------------------
    function startWalk() {
        if (_verts.length < 2) { agAlert('Čára', 'Nejdřív vyber čáru — aspoň začátek a konec.'); return; }
        _line = new Line(_verts);
        if (_line.len < MIN_LEN) { agAlert('Čára', 'Čára má jen ' + fmt(_line.len, 0) + ' m — pro kalibraci potřebuji aspoň ' + MIN_LEN + ' m.'); return; }
        if (!navigator.geolocation) { agAlert('GPS', 'Telefon nehlásí polohu.'); return; }
        _walk = { fixes: [], raw: 0, bad: 0, lastPos: null, start: Date.now(), watch: null, wake: null, sumLat: 0, sumLng: 0 };
        _result = null;
        try { _walk.watch = navigator.geolocation.watchPosition(onFix, function () {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 27000 }); } catch (e) { swallow(e, 'watch'); }
        try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { _walk.wake = w; }).catch(function () {}); } catch (e) { swallow(e, 'wake'); }
        var dlg = byId(DLG_ID); if (dlg) dlg.style.display = 'none';
        drawLine();
        var bar = document.createElement('div');
        bar.id = BAR_ID; bar.className = 'walk';
        bar.innerHTML = '<div id="ag-hr-live"><span class="ag-hr-pulse"></span>Jdi podél čáry od zeleného k červenému…</div>'
            + '<button type="button" id="ag-hr-bar-stop">⏹ Zastavit a spočítat</button>';
        document.body.appendChild(bar);
        bar.querySelector('#ag-hr-bar-stop').addEventListener('click', function () { stopWalk(); finish(); });
    }
    function onFix(pos) {
        var w = _walk; if (!w || !_line) return;
        var c = pos.coords; w.raw++;
        if (c.accuracy == null || c.accuracy > ACC_MAX) { w.bad++; live(); return; }
        // v chůzi? rychlost od telefonu, jinak posun od minulého použitého fixu
        var moving = (typeof c.speed === 'number' && isFinite(c.speed)) ? c.speed >= SPEED_MIN : null;
        if (moving === null) {
            if (w.lastPos) { var mm = mPerDeg(c.latitude); moving = Math.hypot((c.longitude - w.lastPos.lng) * mm.lng, (c.latitude - w.lastPos.lat) * mm.lat) >= MOVE_MIN; }
            else moving = true;
        }
        w.lastPos = { lat: c.latitude, lng: c.longitude };
        if (!moving) { live(); return; }
        var pr = _line.project(c.latitude, c.longitude);
        if (!pr || !pr.inside || pr.d > CROSS_MAX) { w.bad++; live(); return; }
        w.fixes.push({ nx: pr.nx, ny: pr.ny, e: pr.e - _offset, s: pr.s, acc: c.accuracy, t: pos.timestamp || Date.now(), lat: c.latitude, lng: c.longitude });
        w.sumLat += c.latitude; w.sumLng += c.longitude;
        live();
    }
    function live() {
        var el = byId('ag-hr-live'), w = _walk; if (!el || !w) return;
        var n = w.fixes.length;
        var s = '<span class="ag-hr-pulse"></span><b>' + n + '</b> fixů';
        if (n) {
            var last = w.fixes[n - 1];
            var smin = Infinity, smax = -Infinity; w.fixes.forEach(function (f) { if (f.s < smin) smin = f.s; if (f.s > smax) smax = f.s; });
            s += ' · projito ' + fmt(Math.max(0, smax - smin), 0) + ' z ' + fmt(_line.len, 0) + ' m · teď ' + (last.e >= 0 ? '+' : '−') + fmt(Math.abs(last.e), 1) + ' m ' + (last.e >= 0 ? 'vpravo' : 'vlevo') + ' · ±' + Math.round(last.acc) + ' m';
            if (n >= 5) { var q = solve(w.fixes, _line.spread() >= ANGLE_2D); if (q) s += '<br>zatím: GPS lže o <b>' + fmt(Math.hypot(q.vE, q.vN), 1) + ' m</b>'; }
        } else if (w.raw) s += ' · ' + (w.bad ? 'fixy mimo čáru / nepřesné (' + w.bad + ')' : 'stojím? jdi dál');
        el.innerHTML = s;
    }
    function stopWalk() {
        var w = _walk; if (!w) return;
        try { if (w.watch != null) navigator.geolocation.clearWatch(w.watch); } catch (e) { swallow(e, 'clearWatch'); }
        try { if (w.wake) w.wake.release(); } catch (e) { swallow(e, 'unwake'); }
        var bar = byId(BAR_ID); if (bar) bar.remove();
        var dlg = byId(DLG_ID); if (dlg) dlg.style.display = 'flex';
    }
    function finish() {
        var w = _walk; _walk = null;
        if (!w || !_line) { render(); return; }
        var n = w.fixes.length;
        var smin = Infinity, smax = -Infinity; w.fixes.forEach(function (f) { if (f.s < smin) smin = f.s; if (f.s > smax) smax = f.s; });
        var walked = n ? Math.max(0, smax - smin) : 0;
        if (n < MIN_FIX || walked < MIN_LEN) {
            _result = { err: 'Málo dat: ' + n + ' použitelných fixů, projito ' + fmt(walked, 0) + ' m (potřebuji ≥ ' + MIN_FIX + ' fixů a ≥ ' + MIN_LEN + ' m). ' + (w.bad ? w.bad + ' fixů bylo mimo čáru nebo nepřesných.' : '') };
            render(); return;
        }
        var q = solve(w.fixes, _line.spread() >= ANGLE_2D);
        q.walked = walked; q.lat = w.sumLat / n; q.lng = w.sumLng / n; q.t = Date.now(); q.spread = _line.spread();
        _result = q;
        try { localStorage.setItem(LS_LAST, JSON.stringify({ t: q.t, vE: q.vE, vN: q.vN, sterr: q.sterr, mode: q.mode, n: q.n, walked: walked })); } catch (e) { swallow(e, 'lsLast'); }
        render();
    }

    // ---- zapnutí korekce (sdílený mechanismus js/ref-calibration.js) ---------------------
    function applyShift(q) {
        var m = mPerDeg(q.lat);
        // GPS přičítá v → k novým bodům se přičte −v
        var s = { dlat: -q.vN / m.lat, dlng: -q.vE / m.lng, t: Date.now(), acc: Math.round(q.sterr * 100) / 100, on: true, lat: q.lat, lng: q.lng, src: 'hrana', mode: q.mode };
        window.agRefShift = s;
        try { localStorage.setItem('agRefShift', JSON.stringify(s)); } catch (e) { swallow(e, 'saveShift'); }
        toast('Korekce GPS zapnuta: ' + fmt(Math.hypot(q.vE, q.vN)) + ' m' + (q.mode === '1d' ? ' (kolmo k čáře)' : '') + ' — přičítá se k novým bodům ~15 min.');
    }
    function shiftOff() {
        var s = window.agRefShift; if (s) { s.on = false; try { localStorage.setItem('agRefShift', JSON.stringify(s)); } catch (e) { swallow(e, 'off'); } }
        toast('Korekce GPS vypnuta.');
    }

    // ---- UI --------------------------------------------------------------------------------
    function css() {
        if (!window.AG || !AG.style) return;
        AG.style('ag-hr-style', [
            '#ag-hr-modal .modal-content{max-width:520px;}',
            '.hr-p{font-size:calc(12.5px * var(--ag-font-scale,1));opacity:.85;margin:0 0 10px;line-height:1.45;}',
            '.hr-card{border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px 12px;margin:8px 0;background:rgba(255,255,255,.04);font-size:calc(13px * var(--ag-font-scale,1));line-height:1.45;}',
            '.hr-card.amber{border-color:rgba(251,191,36,.45);background:rgba(251,191,36,.08);}',
            '.hr-card.green{border-color:rgba(74,222,128,.45);background:rgba(74,222,128,.08);}',
            '.hr-row{display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap;}',
            '.hr-row label{font-size:calc(12px * var(--ag-font-scale,1));opacity:.8;min-width:120px;}',
            '.hr-row input,.hr-row select{flex:1;min-width:90px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:inherit;font-size:calc(14px * var(--ag-font-scale,1));}',
            '.hr-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}',
            '.hr-btns .btn{flex:1;min-width:140px;margin:0;}',
            '#ag-hr-modal .btn:disabled{opacity:.45;}',
            '.hr-how{margin:0 0 10px;font-size:calc(12.5px * var(--ag-font-scale,1));}',
            '.hr-how summary{cursor:pointer;color:var(--accent);font-weight:600;padding:6px 0;}',
            '.hr-how ol{padding-left:18px;margin:6px 0;}',
            '.hr-how li{margin:4px 0;line-height:1.4;}',
            '.hr-big{font-size:calc(30px * var(--ag-font-scale,1));font-weight:700;text-align:center;font-variant-numeric:tabular-nums;margin:6px 0;}',
            '#' + BAR_ID + '{position:fixed;left:50%;transform:translateX(-50%);z-index:100001;bottom:max(18px,env(safe-area-inset-bottom));display:flex;gap:10px;align-items:center;background:rgba(8,11,15,.9);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:10px 14px;color:#fff;font-size:calc(13px * var(--ag-font-scale,1));box-shadow:0 6px 24px rgba(0,0,0,.4);max-width:calc(100vw - 24px);flex-wrap:wrap;justify-content:center;}',
            '#' + BAR_ID + ' button{border:none;border-radius:999px;padding:8px 14px;background:rgba(255,255,255,.14);color:#fff;font-size:calc(13px * var(--ag-font-scale,1));cursor:pointer;}',
            '#' + BAR_ID + ' #ag-hr-bar-ok,#' + BAR_ID + ' #ag-hr-bar-stop{background:var(--accent,#3b82f6);font-weight:600;}',
            '#' + BAR_ID + '.walk{flex-direction:column;min-width:260px;}',
            '.ag-hr-pulse{display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;margin-right:6px;animation:hrPulse 1.2s infinite;}',
            '@keyframes hrPulse{0%{opacity:.3}50%{opacity:1}100%{opacity:.3}}'
        ].join('\n'));
    }
    function ensureModal() {
        if (byId(DLG_ID)) return;
        css();
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = DLG_ID; el.setAttribute('data-ag-needs', 'gps');
        el.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent); margin-top:0; margin-bottom:5px;">' + ICON + ' Kalibrace chůzí po hraně</h3>'
            + '<div class="modal-body" id="ag-hr-body"></div>'
            + '<button class="btn btn-secondary" style="margin-top:15px;" id="ag-hr-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        function close() { if (_walk) stopWalk(); _walk = null; clearLine(); el.style.display = 'none'; }
        el.querySelector('#ag-hr-close').addEventListener('click', close);
        el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
        window.addEventListener('pagehide', function () { if (_walk) stopWalk(); _walk = null; });
    }
    function open() { ensureModal(); byId(DLG_ID).style.display = 'flex'; if (_verts.length) drawLine(); render(); }

    function howTo() {
        return '<details class="hr-how"><summary>Jak to funguje</summary>'
            + '<p class="hr-p">GPS v telefonu se v tuhle chvíli a na tomhle místě mýlí o nějaký <b>vektor</b> (třeba 2 m na severovýchod) — a ten se mění pomalu, v řádu čtvrthodin, a v okruhu stovek metrů je skoro stejný. Když jdeš podél čáry, o níž appka ví, kde přesně je, vidí, o kolik od ní GPS uhýbá, a ten vektor spočítá. Na rovné čáře jde vidět jen složka <b>kolmo k čáře</b> (podél ní by se stejně dobře hodil kterýkoli bod); na lomené (zatáčka, roh) vyjde vektor celý.</p>'
            + '<ol>'
            + '<li><b>Vyber čáru</b>: klepni v mapě na začátek a konec (klidně i lomy) hrany, po které opravdu půjdeš — obrubník, hrana chodníku, plot, čára z DXF. Nebo dva uložené body.</li>'
            + '<li>Zadej <b>boční odstup</b>: jdeš-li 0,4 m vpravo od klepnuté hrany, zadej +0,4 (vlevo záporně).</li>'
            + '<li><b>Spusť chůzi</b> a jdi rovnoměrně od zeleného konce k červenému, telefon volně v ruce. Stačí 30–50 m.</li>'
            + '<li><b>Zastav a spočítat</b> → zapni korekci. Přičítá se k nově ukládaným bodům (jako „Posun GPS na známý bod"), s upozorněním po 20 min / 300 m.</li>'
            + '</ol>'
            + '<p class="hr-p">Čára klepnutá z mapy je jen tak přesná jako podklad (ortofoto ~0,2–0,5 m) — nejlepší je hrana z DXF nebo z bodů, které znáš. Korekce se týká <b>ukládaných bodů</b>, ne živé polohy v navigaci.</p>'
            + '</details>';
    }
    function render() {
        var body = byId('ag-hr-body'); if (!body) return;
        var pts = points();
        var opts = '<option value="">—</option>' + pts.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
        var lineTxt = _verts.length >= 2 ? '<b>' + _verts.length + ' body</b>, ' + fmt(new Line(_verts).len, 0) + ' m' + (new Line(_verts).spread() >= ANGLE_2D ? ' · lomená → celý vektor' : ' · rovná → jen kolmá složka') : '<i>zatím žádná</i>';
        var cur = window.agRefShift, curTxt = '';
        if (cur && cur.on) { var mm = mPerDeg(cur.lat || 49.8); curTxt = '<div class="hr-card">Teď zapnutá korekce: <b>' + fmt(Math.hypot(cur.dlng * mm.lng, cur.dlat * mm.lat)) + ' m</b>' + (cur.src === 'hrana' ? ' (z chůze po hraně)' : ' (z „Posun GPS na známý bod")') + (cur.t ? ', před ' + Math.round((Date.now() - cur.t) / 60000) + ' min' : '') + ' <button class="btn btn-secondary" id="ag-hr-off" style="width:auto;padding:4px 10px;margin:0 0 0 8px;">Vypnout</button></div>'; }
        var resTxt = '';
        if (_result) {
            if (_result.err) resTxt = '<div class="hr-card amber">' + esc(_result.err) + '</div>';
            else {
                var q = _result, mag = Math.hypot(q.vE, q.vN), brg = ((Math.atan2(q.vE, q.vN) * 180 / Math.PI) + 360) % 360;
                resTxt = '<div class="hr-card green"><b>Výsledek:</b> GPS tu lže o <span class="hr-big" style="display:block">' + fmt(mag) + ' m</span>'
                    + 'směrem ' + Math.round(brg) + '° (' + fmt(q.vE) + ' m V / ' + fmt(q.vN) + ' m S)' + (q.mode === '1d' ? ' — <b>jen kolmo k čáře</b>, podélná složka zůstává neznámá' : ' — celý vektor (lomená čára)') + '<br>'
                    + q.n + ' fixů' + (q.dropped ? ' (' + q.dropped + ' vyřazeno)' : '') + ' na ' + fmt(q.walked, 0) + ' m · rozptyl ±' + fmt(q.sigma, 1) + ' m · odhad chyby korekce <b>±' + fmt(q.sterr) + ' m</b></div>'
                    + '<div class="hr-btns"><button class="btn btn-primary" id="ag-hr-apply">✓ Zapnout korekci</button><button class="btn btn-secondary" id="ag-hr-again">↻ Jít znovu</button></div>';
            }
        }
        body.innerHTML = howTo()
            + '<p class="hr-p">Ujdi kus podél <b>hrany, kterou znáš</b> (obrubník, chodník, plot, osa z DXF), a appka z toho zjistí, o kolik tady a teď GPS lže. Bez zastavování.</p>'
            + curTxt + resTxt
            + '<div class="hr-card"><div>Čára: ' + lineTxt + '</div>'
            + '<div class="hr-btns"><button class="btn btn-primary" id="ag-hr-pick">🗺 Vybrat v mapě (od–kam)</button></div>'
            + (pts.length >= 2 ? '<div class="hr-row" style="margin-top:8px;"><label>Nebo z bodů: od</label><select id="ag-hr-pa">' + opts + '</select></div><div class="hr-row"><label>do</label><select id="ag-hr-pb">' + opts + '</select></div>' : '')
            + '<div class="hr-row" style="margin-top:8px;"><label>Boční odstup (m)</label><input id="ag-hr-off-in" type="text" inputmode="decimal" value="' + fmt(_offset, 1) + '"><span style="opacity:.7;font-size:.9em">+ vpravo / − vlevo ve směru chůze</span></div>'
            + '</div>'
            + '<button class="btn btn-primary" id="ag-hr-go" style="margin-top:10px;"' + (_verts.length >= 2 ? '' : ' disabled') + '>🚶 Spustit chůzi po čáře</button>';
        byId('ag-hr-pick').addEventListener('click', pickOnMap);
        var pa = byId('ag-hr-pa'), pb = byId('ag-hr-pb');
        function fromPts() {
            var a = null, b = null; pts.forEach(function (p) { if (p.id === pa.value) a = p; if (p.id === pb.value) b = p; });
            if (a && b && a !== b) { _verts = [{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }]; drawLine(); render(); }
        }
        if (pa && pb) { pa.addEventListener('change', fromPts); pb.addEventListener('change', fromPts); }
        byId('ag-hr-off-in').addEventListener('change', function () { var v = parseFloat(String(byId('ag-hr-off-in').value).replace(',', '.')); _offset = isFinite(v) ? Math.max(-10, Math.min(10, v)) : 0; });
        byId('ag-hr-go').addEventListener('click', function () { var v = parseFloat(String(byId('ag-hr-off-in').value).replace(',', '.')); _offset = isFinite(v) ? Math.max(-10, Math.min(10, v)) : 0; startWalk(); });
        var ap = byId('ag-hr-apply'); if (ap) ap.addEventListener('click', function () { applyShift(_result); _result = null; render(); });
        var ag = byId('ag-hr-again'); if (ag) ag.addEventListener('click', function () { _result = null; startWalk(); });
        var off = byId('ag-hr-off'); if (off) off.addEventListener('click', function () { shiftOff(); render(); });
    }

    // ---- registrace ----------------------------------------------------------------------
    window.AGHrana = { open: open, _test: { Line: Line, solve: solve, ANGLE_2D: ANGLE_2D } };
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'kalibrace-hranou', label: 'Kalibrace chůzí po hraně', icon: ICON, cat: 'AR a kalibrace', onClick: open, order: 71 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
