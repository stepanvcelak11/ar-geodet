// ===== AR Geodet — METR V KAMEŘE (ODPOJITELNÁ vrstva) ==========================
// Pravítko promítnuté do obrazu kamery. Telefon se drží PLOCHO, displejem nahoru,
// takže zadní kamera míří kolmo dolů na zem. Tím je rovina země rovnoběžná se
// senzorem — v obraze NENÍ perspektiva a měřítko je po celé ploše STEJNÉ. Celá
// matematika se pak scvrkne na jeden součin:
//
//      záběr [m] = 2 · h · tan(FOV/2)          h = výška držení nad zemí
//      mm na 1 px = 1000 · záběr / šířka_snímku_v_px
//
// PROČ TO NEJDE „NA ŠIKMO": kdyby telefon koukal dopředu, museli bychom rovinu
// země promítat homografií a chyba by rostla jako h/sin²(úhel pod obzor) — na
// třech metrech dělá 1° náklonu už ~15 cm. Proto se drží vodorovně a měří se jen
// to, co je přímo pod telefonem (typicky ~1,3 m záběru při výšce 1 m).
//
// DVĚ NEZNÁMÉ, DVA ZDROJE:
//   • FOV je vlastnost přístroje — kalibruje se JEDNOU proti známé délce a ukládá
//     se ZVLÁŠŤ PRO KAŽDÉ ROZLIŠENÍ kamery (jiný režim = jiný výřez = jiný úhel).
//   • Výšku držení píše uživatel RUČNĚ (pole nahoře + předvolby). Chyba výšky se
//     propisuje 1:1 do měřítka — 5 cm z metru = 5 % na všech hodnotách.
//   Kdo výšku neví, může to obrátit: zná délku předmětu → nástroj dopočítá výšku.
//
// LIBELA je z `devicemotion` (accelerationIncludingGravity), NE z beta/gamma
// deviceorientation: u vodorovně ležícího telefonu jsou Eulerovy úhly blízko
// singularity a poskakují, kdežto vektor tíže je stabilní na desetiny stupně.
// ⚠⚠ ZNAMÉNKO toho vektoru se ale napříč telefony LIŠÍ (iOS ho vrací obrácené než
// spec a Android), takže se z něj NESMÍ usuzovat, kterou stranou telefon leží —
// viz drawLevel(). Náklon se počítá z |gz| a směr bubliny ze znaménka gz.
//
// NEEDITUJE logika.js ani grafika.js. Čte jen přes typeof: userLat/userLng,
// persistentCustomPoints, projects, quickToast, agAlert, loadPointDoc/savePointDoc,
// GeoCore, window._agCamSettings. Kameru si buď půjčí z běžícího AR (#camera-feed),
// nebo si otevře vlastní stream (iOS neumí dva souběžné).
//
// Odstranění: smaž js/ar-metr.js + jeho řádek <script> v index.html, heslo
// 'ar-metr' v TOOL_HELP (js/tools-plus.js) a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGMetr) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="8" rx="1.6"/><path d="M6 8v3M10 8v4.5M14 8v3M18 8v4.5"/></svg>';
    var STYLE_ID = 'ag-mtr-style';

    var LS_CAL = 'agMetrCal1';        // {"1280x720": 66.4, ...} — FOV per režim kamery
    var LS_H = 'agMetrH1';            // poslední zadaná výška držení [cm]
    var LS_SLOPE = 'agMetrSlope1';    // sklon povrchu [%]
    var LOG_PREFIX = 'agMetrLog1_';   // + id zakázky

    var DEF_FOV = 66;                 // výchozí odhad vodorovného FOV [°] — NEZKALIBROVÁNO
    var MIN_FOV = 30, MAX_FOV = 140;
    var GOOD_TILT = 0.7;              // [°] zelená libela
    var WARN_TILT = 2.0;              // [°] nad tím jsou hodnoty nedůvěryhodné
    var EDGE_R = 0.80;                // za tímhle poměrem poloměru varujeme na zkreslení
    var NEAR_M = 25;                  // do kolika metrů se měření váže k bodu
    var MAX_LOG = 300;
    var G = 9.80665;

    var _stream = null;               // vlastní stream (null = půjčený z AR)
    var _usingAr = false;
    var _raf = 0;
    var _motionOn = false;
    var _gx = null, _gy = null, _gz = null;   // vyhlazený vektor tíže (osy telefonu)
    var _tilt = null;                 // [°] odklon osy kamery od svislice, null = bez čidla
    var _mode = 'scale';              // 'scale' | 'dist' | 'rect'
    var _pts = [];                    // body měření v CSS px overlaye
    var _drag = -1;
    var _view = { w: 0, h: 0, vw: 0, vh: 0, scale: 1, ox: 0, oy: 0 };

    // ---- pomocné -------------------------------------------------------------------
    function byId(id) { return document.getElementById(id); }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:toast'); } }
    function fail(t, m) {
        try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:fail'); }
        toast(m);
    }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function projName() {
        var id = pid();
        try {
            if (typeof projects !== 'undefined' && Array.isArray(projects)) {
                for (var i = 0; i < projects.length; i++) { if (projects[i] && projects[i].id === id) return projects[i].name || id; }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:projName'); }
        return (id === 'default') ? 'Výchozí zakázka' : id;
    }
    function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:lsSet'); } }
    function num(v, d) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : d; }
    // česká čísla: 1234.5 -> "1 234,5"
    function fmt(v, dec) {
        if (v == null || !isFinite(v)) return '—';
        var s = Math.abs(v).toFixed(dec == null ? 1 : dec).replace('.', ',');
        var p = s.split(',');
        p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        return (v < 0 ? '−' : '') + p.join(',');
    }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmtDT(ts) { var d = new Date(ts); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

    // ---- kalibrace (FOV per rozlišení kamery) ---------------------------------------
    function calAll() { try { return JSON.parse(lsGet(LS_CAL, '{}')) || {}; } catch (e) { return {}; } }
    function camKey() { return (_view.vw && _view.vh) ? (_view.vw + 'x' + _view.vh) : ''; }
    function calFov() {
        var k = camKey(); if (!k) return null;
        var v = calAll()[k];
        return (typeof v === 'number' && isFinite(v)) ? v : null;
    }
    function setCalFov(deg) {
        var k = camKey(); if (!k) return;
        deg = Math.max(MIN_FOV, Math.min(MAX_FOV, deg));
        var all = calAll(); all[k] = Math.round(deg * 100) / 100;
        lsSet(LS_CAL, JSON.stringify(all));
    }
    function fovNow() { var c = calFov(); return c != null ? c : DEF_FOV; }
    function isCalibrated() { return calFov() != null; }

    function heightM() { return Math.max(0.05, num(lsGet(LS_H, '100'), 100) / 100); }
    function slopePct() { return Math.max(0, num(lsGet(LS_SLOPE, '0'), 0)); }

    // ---- měřítko ---------------------------------------------------------------------
    // mm na 1 CSS pixel overlaye. Video je vykreslené přes `object-fit: contain`,
    // takže se nejdřív musí odstranit jeho zmenšení do plochy obrazovky.
    function mmPerPx() {
        if (!_view.vw || !_view.scale) return null;
        var span = 2 * heightM() * Math.tan(fovNow() * Math.PI / 360);   // šířka záběru [m]
        var perVideoPx = 1000 * span / _view.vw;
        return perVideoPx / _view.scale;
    }
    function measure() {
        var k = mmPerPx();
        if (k == null || _pts.length < 2) return null;
        var a = _pts[0], b = _pts[1];
        var dx = Math.abs(b.x - a.x) * k, dy = Math.abs(b.y - a.y) * k;
        if (_mode === 'rect') return { w: dx, h: dy, area: (dx / 1000) * (dy / 1000) };
        return { d: Math.sqrt(dx * dx + dy * dy) };
    }
    // nejvzdálenější bod od středu obrazu v poměru k polovině úhlopříčky
    function edgeRatio() {
        if (!_pts.length || !_view.w) return 0;
        // vztaženo k SNÍMKU, ne k obrazovce — jinak by letterboxing zředil poměr
        // a na zkreslení u kraje objektivu by nástroj přestal upozorňovat
        var r = vidRect();
        var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        var half = Math.sqrt((r.w / 2) * (r.w / 2) + (r.h / 2) * (r.h / 2)), worst = 0;
        if (!half) return 0;
        for (var i = 0; i < _pts.length; i++) {
            var dx = _pts[i].x - cx, dy = _pts[i].y - cy;
            worst = Math.max(worst, Math.sqrt(dx * dx + dy * dy) / half);
        }
        return worst;
    }

    // ---- styly -----------------------------------------------------------------------
    function injectStyles() {
        if (byId(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent =
            '#ag-mtr{position:fixed;inset:0;z-index:9400;display:none;background:#000;overflow:hidden}'
            + '#ag-mtr.on{display:block}'
            // POZOR: `contain`, NE `cover`. Cover by u snímku na šířku v telefonu na výšku
            // uřízl přes 70 % šířky záběru — a uříznout měřicímu nástroji zorné pole je
            // to nejhorší, co se dá udělat. Radši černé pruhy a celý metr.
            + '#ag-mtr-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}'
            + '#ag-mtr-cv{position:absolute;inset:0;width:100%;height:100%;touch-action:none}'
            + '#ag-mtr-top{position:absolute;top:0;left:0;right:0;padding:calc(env(safe-area-inset-top,0px) + 8px) 10px 8px;'
            + 'background:linear-gradient(180deg,rgba(8,10,14,0.86),rgba(8,10,14,0));pointer-events:none;display:flex;gap:10px;align-items:flex-start}'
            + '#ag-mtr-top>*{pointer-events:auto}'
            + '#ag-mtr-hbox{flex:1 1 auto;background:rgba(12,15,20,0.78);border:1px solid rgba(255,255,255,0.14);border-radius:12px;padding:7px 9px}'
            + '#ag-mtr-hrow{display:flex;align-items:center;gap:6px;flex-wrap:wrap}'
            + '#ag-mtr-hrow label{color:#cfd6e2;font-size:calc(12px * var(--ag-font-scale,1))}'
            + '#ag-mtr-h{width:64px;flex:0 0 auto;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.22);'
            + 'color:#fff;border-radius:8px;padding:4px 6px;font-size:calc(15px * var(--ag-font-scale,1));text-align:right}'
            + '#ag-mtr-hrow .ag-mtr-pre{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);color:#dfe6f2;'
            + 'border-radius:8px;padding:4px 7px;font-size:calc(12px * var(--ag-font-scale,1));cursor:pointer}'
            + '#ag-mtr-hrow .ag-mtr-pre.sel{background:var(--accent,#4da3ff);border-color:transparent;color:#04121f;font-weight:600}'
            + '#ag-mtr-scale{margin-top:5px;color:#9fb0c6;font-size:calc(11.5px * var(--ag-font-scale,1));line-height:1.35}'
            + '#ag-mtr-scale b{color:#ffd479}'
            + '#ag-mtr-lev{flex:0 0 auto;width:64px;height:64px;border-radius:50%;background:rgba(12,15,20,0.78);'
            + 'border:2px solid rgba(255,255,255,0.2);position:relative;display:flex;align-items:center;justify-content:center}'
            + '#ag-mtr-lev .ring{position:absolute;width:22px;height:22px;border-radius:50%;border:1px dashed rgba(255,255,255,0.35)}'
            + '#ag-mtr-lev .bub{position:absolute;width:16px;height:16px;border-radius:50%;background:#7ee081;box-shadow:0 0 8px rgba(0,0,0,0.6);transition:background .2s}'
            + '#ag-mtr-lev .bub.warn{background:#ffd479}#ag-mtr-lev .bub.bad{background:#ff6b6b}'
            + '#ag-mtr-levtxt{position:absolute;bottom:-17px;left:50%;transform:translateX(-50%);white-space:nowrap;'
            + 'color:#cfd6e2;font-size:calc(11px * var(--ag-font-scale,1));text-shadow:0 1px 3px #000}'
            + '#ag-mtr-read{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 74px);text-align:center;pointer-events:none;padding:0 12px}'
            + '#ag-mtr-read .big{display:inline-block;background:rgba(8,10,14,0.78);border:1px solid rgba(255,255,255,0.16);border-radius:14px;'
            + 'padding:8px 16px;color:#fff;font-size:calc(30px * var(--ag-font-scale,1));font-weight:700;letter-spacing:.5px;font-variant-numeric:tabular-nums}'
            + '#ag-mtr-read .big.stale{color:#ff9a9a}'
            + '#ag-mtr-read .sub{margin-top:5px;color:#cfd6e2;font-size:calc(12.5px * var(--ag-font-scale,1));text-shadow:0 1px 3px #000}'
            + '#ag-mtr-read .sub .warn{color:#ffd479}'
            + '#ag-mtr-bar{position:absolute;left:0;right:0;bottom:0;padding:8px 10px calc(env(safe-area-inset-bottom,0px) + 10px);'
            + 'background:linear-gradient(0deg,rgba(8,10,14,0.9),rgba(8,10,14,0));display:flex;gap:8px;align-items:center}'
            + '#ag-mtr-bar button{background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.18);color:#fff;'
            + 'border-radius:10px;padding:9px 10px;font-size:calc(13px * var(--ag-font-scale,1));cursor:pointer;min-height:42px}'
            + '#ag-mtr-modes{flex:1 1 auto;display:flex;gap:6px;justify-content:center}'
            + '#ag-mtr-modes button{flex:1 1 0;padding:9px 4px}'
            + '#ag-mtr-modes button.sel{background:var(--accent,#4da3ff);border-color:transparent;color:#04121f;font-weight:700}'
            + '#ag-mtr-note{position:absolute;left:10px;right:10px;top:50%;transform:translateY(-50%);text-align:center;color:#fff;'
            + 'background:rgba(8,10,14,0.8);border:1px solid rgba(255,255,255,0.16);border-radius:12px;padding:12px 14px;'
            + 'font-size:calc(13.5px * var(--ag-font-scale,1));line-height:1.5;display:none}'
            + '#ag-mtr-note.on{display:block}'
            + '#ag-mtr-note button{margin-top:10px;background:var(--accent,#4da3ff);border:0;color:#04121f;font-weight:700;'
            + 'border-radius:10px;padding:9px 14px;font-size:calc(13.5px * var(--ag-font-scale,1));cursor:pointer}'
            + '.ag-mtr-log{max-height:52vh;overflow:auto;-webkit-overflow-scrolling:touch;margin:8px 0}'
            + '.ag-mtr-log .row{display:flex;gap:8px;align-items:center;padding:8px 4px;border-bottom:1px solid var(--border,rgba(255,255,255,0.1))}'
            + '.ag-mtr-log .row .v{flex:1 1 auto;min-width:0}'
            + '.ag-mtr-log .row .v b{display:block;font-size:calc(14.5px * var(--ag-font-scale,1))}'
            + '.ag-mtr-log .row .v span{display:block;opacity:.7;font-size:calc(12px * var(--ag-font-scale,1))}'
            + '.ag-mtr-log .row button{flex:0 0 auto}'
            + '.ag-mtr-empty{opacity:.7;padding:14px 4px;font-size:calc(13px * var(--ag-font-scale,1))}';
        document.head.appendChild(s);
    }

    // ---- libela (vektor tíže z devicemotion) ----------------------------------------
    function onMotion(e) {
        var a = e.accelerationIncludingGravity;
        if (!a || a.x == null || a.z == null) return;
        var K = 0.16;                              // exponenciální filtr — čidlo šumí
        _gx = (_gx == null) ? a.x : _gx + K * (a.x - _gx);
        _gy = (_gy == null) ? a.y : _gy + K * (a.y - _gy);
        _gz = (_gz == null) ? a.z : _gz + K * (a.z - _gz);
        var horiz = Math.sqrt(_gx * _gx + _gy * _gy);
        // Náklon se počítá z |gz|, takže je na znaménku NEZÁVISLÝ — viz drawLevel().
        _tilt = Math.atan2(horiz, Math.abs(_gz)) * 180 / Math.PI;
    }
    function startMotion() {
        if (_motionOn || !window.DeviceMotionEvent) return;
        var go = function () {
            try { window.addEventListener('devicemotion', onMotion, { passive: true }); _motionOn = true; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:go'); }
        };
        // iOS 13+ chce výslovné svolení a jen z uživatelského gesta
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                DeviceMotionEvent.requestPermission().then(function (r) { if (r === 'granted') go(); })['catch'](function () {});
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:go'); }
            return;
        }
        go();
    }
    function stopMotion() {
        if (!_motionOn) return;
        try { window.removeEventListener('devicemotion', onMotion); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:stopMotion'); }
        _motionOn = false; _tilt = null; _gx = _gy = _gz = null;
    }
    function tiltClass() {
        if (_tilt == null) return '';
        if (_tilt <= GOOD_TILT) return '';
        return _tilt <= WARN_TILT ? 'warn' : 'bad';
    }
    function drawLevel() {
        var bub = byId('ag-mtr-bub'), txt = byId('ag-mtr-levtxt');
        if (!bub || !txt) return;
        if (_tilt == null) {
            bub.style.transform = 'translate(0,0)';
            bub.className = 'bub warn';
            txt.textContent = 'bez čidla';
            return;
        }
        // ⚠⚠ ZNAMÉNKO `accelerationIncludingGravity` NENÍ NAPŘÍČ TELEFONY STEJNÉ.
        // Spec (a Android) hlásí u telefonu ležícího DISPLEJEM VZHŮRU z ≈ +9,81;
        // iOS vrací celý vektor s opačným znaménkem, tedy z ≈ −9,81. Dřív se z toho
        // usuzovalo na polohu (`_faceUp = _gz > 0`) a při záporném z se místo libely
        // psalo „otoč displejem nahoru" — jenže přesně tak telefon při měření DRŽÍ
        // (kamera dolů na zem). Na takovém telefonu libela nefungovala vůbec a
        // „fungovala" jen obráceně, tedy kamerou vzhůru, kdy je nástroj k ničemu.
        // ŘEŠENÍ: nehádat polohu z absolutního znaménka. Náklon je z |gz| (neutrální)
        // a směr bubliny se ODVODÍ ze znaménka gz — tím se převrácená soustava sama
        // narovná a bublina jde na správnou stranu na obou platformách.
        // Která strana telefonu je nahoře, se řešit nemusí: kdo se dívá na displej,
        // má kameru dole. Zbývá jen hlídat, že telefon LEŽÍ NAPLOCHO (níž).
        var R = 22, FULL = Math.sin(5 * Math.PI / 180) * G;    // plná výchylka = 5°
        var s = (_gz != null && _gz < 0) ? -1 : 1;
        var dx = Math.max(-1, Math.min(1, s * (_gx || 0) / FULL)) * R;
        var dy = Math.max(-1, Math.min(1, -s * (_gy || 0) / FULL)) * R;
        bub.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
        bub.className = 'bub ' + tiltClass();
        // Nad 25° už to není „skoro vodorovně", ale telefon nastojato — tam je rada
        // užitečnější než číslo. (Dřív tuhle roli plnilo „otoč displejem nahoru".)
        txt.textContent = (_tilt > 25) ? 'polož naplocho' : (_tilt.toFixed(1) + '°');
    }

    // ---- kamera -----------------------------------------------------------------------
    function arStream() {
        try {
            var v = byId('camera-feed');
            if (v && v.srcObject && v.readyState >= 2 && v.videoWidth > 0) return v.srcObject;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:arStream'); }
        return null;
    }
    function stopStream() {
        if (_stream) {
            try { _stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:stopStream'); }
            _stream = null;
        }
        _usingAr = false;
        var v = byId('ag-mtr-vid');
        if (v) { try { v.pause(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:stopStream'); } v.srcObject = null; }
    }
    function note(html) {
        var n = byId('ag-mtr-note');
        if (!n) return;
        if (!html) { n.classList.remove('on'); n.innerHTML = ''; return; }
        n.innerHTML = html; n.classList.add('on');
    }

    // ---- geometrie zobrazení ---------------------------------------------------------
    function syncView() {
        var ov = byId('ag-mtr'), v = byId('ag-mtr-vid'), cv = byId('ag-mtr-cv');
        if (!ov || !v || !cv) return false;
        var w = ov.clientWidth, h = ov.clientHeight;
        var vw = v.videoWidth || 0, vh = v.videoHeight || 0;
        if (!w || !h || !vw || !vh) return false;
        // Otočení displeje posune všechno — položené body pak ukazují jinam a musí pryč.
        // Drobná změna výšky se ale IGNORUJE: na Androidu vyjede klávesnice při psaní
        // výšky držení a smazat kvůli tomu rozměřený obdélník by bylo k vzteku.
        if (_view.w && (Math.abs(w - _view.w) > _view.w * 0.25 || Math.abs(h - _view.h) > _view.h * 0.25)) _pts = [];
        _view.w = w; _view.h = h; _view.vw = vw; _view.vh = vh;
        _view.scale = Math.min(w / vw, h / vh);              // object-fit: contain
        _view.ox = (w - vw * _view.scale) / 2;
        _view.oy = (h - vh * _view.scale) / 2;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
            cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        }
        return true;
    }

    // plocha, kterou na obrazovce doopravdy zabírá snímek z kamery
    function vidRect() {
        return { x: _view.ox, y: _view.oy, w: _view.vw * _view.scale, h: _view.vh * _view.scale };
    }
    function clampToVid(p) {
        var r = vidRect();
        p.x = Math.max(r.x, Math.min(r.x + r.w, p.x));
        p.y = Math.max(r.y, Math.min(r.y + r.h, p.y));
        return p;
    }

    // ---- kreslení ---------------------------------------------------------------------
    // Strop 30 fps: pravítko je statická grafika, na 120Hz displeji by plná smyčka
    // jen topila baterii (stejný důvod jako strop v AR renderu).
    var _lastDraw = 0, _lastRead = 0;
    function drawFrame() {
        _raf = 0;
        var ov = byId('ag-mtr');
        if (!ov || !ov.classList.contains('on')) return;
        _raf = requestAnimationFrame(drawFrame);
        var now = Date.now();
        if (now - _lastDraw < 32) return;
        _lastDraw = now;
        drawLevel();
        if (!syncView()) return;

        var cv = byId('ag-mtr-cv'), ctx = cv.getContext('2d');
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, _view.w, _view.h);

        var k = mmPerPx();
        if (k == null) return;
        var bad = (_tilt != null && _tilt > WARN_TILT);
        var alpha = bad ? 0.35 : 1;

        // Kreslí se JEN do plochy snímku — vedle něj jsou po „contain" černé pruhy
        // a pravítko běžící přes ně by lákalo měřit tam, kde kamera nic nevidí.
        var vr = vidRect();
        ctx.save();
        ctx.beginPath(); ctx.rect(vr.x, vr.y, vr.w, vr.h); ctx.clip();
        drawGrid(ctx, k, alpha);
        if (_mode === 'scale') drawRulers(ctx, k, alpha);
        else drawPoints(ctx, k, alpha);
        ctx.restore();
        // Čísla se přepisují jen 8× za vteřinu. Grafika musí být plynulá (táhne se
        // za ni prstem), ale innerHTML tří prvků 30× za vteřinu je zbytečný layout.
        if (now - _lastRead >= 120) { _lastRead = now; updateReadout(k); }
    }

    // řídká mřížka 10 cm — dává obrazu měřítko i bez měření
    function drawGrid(ctx, k, alpha) {
        var step = 100 / k;                        // 10 cm v px
        if (step < 14) return;                     // moc husté → jen by to zašpinilo obraz
        ctx.save();
        ctx.globalAlpha = 0.20 * alpha;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        var cx = _view.w / 2, cy = _view.h / 2, i;
        ctx.beginPath();
        for (i = 0; cx + i * step < _view.w + step; i++) {
            var xr = cx + i * step, xl = cx - i * step;
            if (xr <= _view.w) { ctx.moveTo(xr, 0); ctx.lineTo(xr, _view.h); }
            if (i && xl >= 0) { ctx.moveTo(xl, 0); ctx.lineTo(xl, _view.h); }
        }
        for (i = 0; cy + i * step < _view.h + step; i++) {
            var yb = cy + i * step, yt = cy - i * step;
            if (yb <= _view.h) { ctx.moveTo(0, yb); ctx.lineTo(_view.w, yb); }
            if (i && yt >= 0) { ctx.moveTo(0, yt); ctx.lineTo(_view.w, yt); }
        }
        ctx.stroke();
        ctx.restore();
    }

    // hlavní kříž pravítek středem obrazu, dílky po 1 cm
    function drawRulers(ctx, k, alpha) {
        var cx = Math.round(_view.w / 2) + 0.5, cy = Math.round(_view.h / 2) + 0.5;
        var cm = 10 / k;                            // 1 cm v px
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.lineCap = 'butt';
        ctx.font = '600 ' + Math.round(11 * fontScale()) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';

        // podklad os, aby dílky byly čitelné i na světlém asfaltu
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(_view.w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, _view.h); ctx.stroke();
        ctx.strokeStyle = '#ffd479'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(_view.w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, _view.h); ctx.stroke();

        var showCm = cm >= 3.2;                     // pod tři pixely na cm už jsou dílky slepené
        var i, n, len, x, y;
        ctx.strokeStyle = '#ffd479'; ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 3;

        // vodorovné pravítko
        for (i = -Math.ceil(cx / cm); i * cm <= _view.w - cx; i++) {
            n = Math.abs(i);
            if (!showCm && n % 10 !== 0) continue;
            len = (n % 10 === 0) ? 16 : (n % 5 === 0 ? 10 : 5);
            x = Math.round(cx + i * cm) + 0.5;
            if (x < 0 || x > _view.w) continue;
            ctx.lineWidth = (n % 10 === 0) ? 1.8 : 1;
            ctx.beginPath(); ctx.moveTo(x, cy - len); ctx.lineTo(x, cy + len); ctx.stroke();
            if (n % 10 === 0 && n !== 0) ctx.fillText(n + '', x, cy + len + 2);
        }
        // svislé pravítko
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (i = -Math.ceil(cy / cm); i * cm <= _view.h - cy; i++) {
            n = Math.abs(i);
            if (!showCm && n % 10 !== 0) continue;
            len = (n % 10 === 0) ? 16 : (n % 5 === 0 ? 10 : 5);
            y = Math.round(cy + i * cm) + 0.5;
            if (y < 0 || y > _view.h) continue;
            ctx.lineWidth = (n % 10 === 0) ? 1.8 : 1;
            ctx.beginPath(); ctx.moveTo(cx - len, y); ctx.lineTo(cx + len, y); ctx.stroke();
            if (n % 10 === 0 && n !== 0) ctx.fillText(n + '', cx + len + 3, y);
        }
        ctx.restore();
    }

    function fontScale() {
        try {
            var v = getComputedStyle(document.documentElement).getPropertyValue('--ag-font-scale');
            var n = parseFloat(v); return isFinite(n) && n > 0 ? n : 1;
        } catch (e) { return 1; }
    }

    // body měření: nitkové kříže přes celý obraz, aby bod byl vidět i pod prstem
    function drawPoints(ctx, k, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;
        var i, p;
        for (i = 0; i < _pts.length; i++) {
            p = _pts[i];
            ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(_view.w, p.y); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, _view.h); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(_view.w, p.y); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, _view.h); ctx.stroke();
        }
        if (_pts.length === 2) {
            var a = _pts[0], b = _pts[1];
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.beginPath();
            if (_mode === 'rect') ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
            else { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
            ctx.stroke();
            ctx.lineWidth = 2; ctx.strokeStyle = '#4da3ff';
            ctx.stroke();
        }
        for (i = 0; i < _pts.length; i++) {
            p = _pts[i];
            ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, 6.284);
            ctx.fillStyle = 'rgba(77,163,255,0.22)'; ctx.fill();
            ctx.lineWidth = 2.5; ctx.strokeStyle = '#0a0c10'; ctx.stroke();
            ctx.lineWidth = 1.4; ctx.strokeStyle = '#fff'; ctx.stroke();
        }
        ctx.restore();
    }

    // ---- čtení výsledku ----------------------------------------------------------------
    function updateReadout(k) {
        var big = byId('ag-mtr-big'), sub = byId('ag-mtr-sub'), inf = byId('ag-mtr-scale');
        if (inf) {
            var span = _view.w * k / 10;                    // šířka obrazovky v cm
            inf.innerHTML = 'záběr ' + fmt(span, 0) + ' cm · 1 px ≈ ' + fmt(k, 2) + ' mm'
                + (isCalibrated() ? '' : ' · <b>nezkalibrováno</b> (odhad FOV ' + DEF_FOV + '°)');
        }
        if (!big || !sub) return;
        var bad = (_tilt != null && _tilt > WARN_TILT);
        var cls = 'big' + (bad ? ' stale' : '');
        if (big.className !== cls) big.className = cls;

        if (_mode === 'scale') {
            big.textContent = 'jeden čtverec = 10 cm';
            big.style.fontSize = 'calc(17px * var(--ag-font-scale,1))';
            sub.innerHTML = 'Mřížka je po 10 cm, dílky na kříži po 1 cm.'
                + (bad ? ' <span class="warn">Náklon ' + _tilt.toFixed(1) + '° — srovnej.</span>' : '');
            return;
        }
        big.style.fontSize = '';
        var m = measure();
        if (!m) {
            big.textContent = (_pts.length ? 'druhý bod…' : (_mode === 'rect' ? 'klepni na roh' : 'klepni na začátek'));
            big.style.fontSize = 'calc(19px * var(--ag-font-scale,1))';
            sub.innerHTML = 'Body jde po položení <b>posouvat tažením</b>.';
            return;
        }
        var warns = [];
        if (bad) warns.push('<span class="warn">náklon ' + _tilt.toFixed(1) + '° — hodnota je nespolehlivá</span>');
        if (edgeRatio() > EDGE_R) warns.push('<span class="warn">bod je u kraje obrazu — zkreslení objektivu, přisuň měřené blíž ke středu</span>');

        if (_mode === 'rect') {
            big.textContent = fmt(m.area, 3) + ' m²';
            sub.innerHTML = fmt(m.w / 10, 1) + ' × ' + fmt(m.h / 10, 1) + ' cm'
                + (warns.length ? '<br>' + warns.join('<br>') : '');
        } else {
            var cm = m.d / 10;
            big.textContent = (cm >= 100 ? fmt(cm / 100, 3) + ' m' : fmt(cm, 1) + ' cm');
            var extra = '';
            var sl = slopePct();
            if (sl > 0) {
                var alongSlope = m.d * Math.sqrt(1 + (sl / 100) * (sl / 100));
                extra = ' · po spádnici ' + sl + ' % až ' + fmt(alongSlope, 0) + ' mm';
            }
            sub.innerHTML = fmt(m.d, 0) + ' mm' + extra + (warns.length ? '<br>' + warns.join('<br>') : '');
        }
    }

    // ---- dotyk ---------------------------------------------------------------------------
    function localPt(ev) {
        var ov = byId('ag-mtr'), r = ov.getBoundingClientRect();
        return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }
    function nearestIdx(p) {
        var best = -1, bd = 34 * 34;
        for (var i = 0; i < _pts.length; i++) {
            var dx = _pts[i].x - p.x, dy = _pts[i].y - p.y, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = i; }
        }
        return best;
    }
    function onDown(ev) {
        if (_mode === 'scale') return;
        ev.preventDefault();
        var p = localPt(ev);
        var i = nearestIdx(p);
        if (i >= 0) { _drag = i; return; }
        if (_pts.length >= 2) _pts = [];
        _pts.push(clampToVid(p));
        _drag = _pts.length - 1;
        try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:onDown'); }
    }
    function onMove(ev) {
        if (_drag < 0 || !_pts[_drag]) return;
        ev.preventDefault();
        var p = clampToVid(localPt(ev));
        _pts[_drag].x = p.x;
        _pts[_drag].y = p.y;
    }
    function onUp() { _drag = -1; }

    // ---- záznamy ---------------------------------------------------------------------------
    function logKey() { return LOG_PREFIX + pid(); }
    function logAll() { try { return JSON.parse(lsGet(logKey(), '[]')) || []; } catch (e) { return []; } }
    function logSave(a) { lsSet(logKey(), JSON.stringify(a.slice(-MAX_LOG))); }
    function dist(la1, lo1, la2, lo2) {
        try { if (typeof getDistance === 'function') return getDistance(la1, lo1, la2, lo2); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:dist'); }
        var R = 6371000, r = Math.PI / 180;
        var a = Math.sin((la2 - la1) * r / 2), b = Math.sin((lo2 - lo1) * r / 2);
        var hh = a * a + Math.cos(la1 * r) * Math.cos(la2 * r) * b * b;
        return 2 * R * Math.atan2(Math.sqrt(hh), Math.sqrt(1 - hh));
    }
    function nearestPoint(lat, lng) {
        try {
            if (lat == null || typeof persistentCustomPoints === 'undefined' || !Array.isArray(persistentCustomPoints)) return null;
            var best = null;
            persistentCustomPoints.forEach(function (p) {
                if (!p || p.lat == null || p.lng == null) return;
                var d = dist(lat, lng, p.lat, p.lng);
                if (d <= NEAR_M && (!best || d < best.d)) best = { id: p.id, name: p.name || p.id, d: d };
            });
            return best;
        } catch (e) { return null; }
    }
    function recLabel(r) {
        if (r.mode === 'rect') return fmt(r.area, 3) + ' m²  (' + fmt(r.w / 10, 1) + ' × ' + fmt(r.h / 10, 1) + ' cm)';
        return (r.d >= 1000 ? fmt(r.d / 1000, 3) + ' m' : fmt(r.d / 10, 1) + ' cm') + '  (' + fmt(r.d, 0) + ' mm)';
    }
    function saveMeasure() {
        var m = measure();
        if (!m) { toast('Nejdřív polož dva body.'); return; }
        var lat = null, lng = null;
        try { if (typeof userLat !== 'undefined' && userLat != null) { lat = userLat; lng = userLng; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:saveMeasure'); }
        var near = (lat != null) ? nearestPoint(lat, lng) : null;
        var rec = {
            id: 'mt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            ts: Date.now(), mode: _mode, h: Math.round(heightM() * 1000) / 10, fov: fovNow(),
            cal: isCalibrated(), tilt: (_tilt == null ? null : Math.round(_tilt * 10) / 10),
            slope: slopePct(), lat: lat, lng: lng,
            ptId: near ? near.id : null, ptName: near ? near.name : null,
            // POZOR na dvě různé „výšky": `h` je výška DRŽENÍ telefonu [cm],
            // `hMM` je svislá strana změřeného obdélníku [mm].
            d: (m.d != null ? Math.round(m.d * 10) / 10 : null),
            w: (m.w != null ? Math.round(m.w * 10) / 10 : null),
            hMM: (m.h != null ? Math.round(m.h * 10) / 10 : null),
            area: (m.area != null ? Math.round(m.area * 10000) / 10000 : null)
        };
        var a = logAll(); a.push(rec); logSave(a);
        try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:saveMeasure'); }
        toast('Uloženo: ' + recLabelSafe(rec) + (near ? ' (u bodu ' + near.name + ')' : ''));
    }
    // rec z úložiště používá hMM místo h (h je výška držení) — sjednocení pro výpis
    function recLabelSafe(r) {
        return recLabel({ mode: r.mode, d: r.d, w: r.w, h: r.hMM, area: r.area });
    }

    // ---- kalibrace: dialog -------------------------------------------------------------------
    function calibrate() {
        if (_pts.length < 2 || _mode === 'scale') {
            note('<b>Kalibrace zorného úhlu</b><br>Přepni na <b>Délka</b>, polož na zem něco, čemu znáš přesnou délku '
                + '(svinovák, list A4 = 297 mm), a klepni na oba jeho konce. Pak sem klepni znovu.'
                + '<br><button type="button" id="ag-mtr-note-ok">Rozumím</button>');
            return;
        }
        var m = measure(); if (!m || !m.d) return;
        var cur = m.d;
        var html = '<b>Kalibrace</b><br>Změřená délka je teď <b>' + fmt(cur, 0) + ' mm</b>.<br>'
            + 'Napiš, kolik má být <b>doopravdy</b> (v mm):<br>'
            + '<input id="ag-mtr-cal-in" type="number" inputmode="decimal" step="1" min="10" '
            + 'style="width:120px;margin-top:8px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.25);'
            + 'background:rgba(255,255,255,.1);color:#fff;font-size:calc(16px * var(--ag-font-scale,1));text-align:right">'
            + '<br><button type="button" id="ag-mtr-cal-fov">Doladit zorný úhel</button> '
            + '<button type="button" id="ag-mtr-cal-h">Doladit výšku držení</button>'
            + '<br><button type="button" id="ag-mtr-note-ok" style="background:rgba(255,255,255,.14);color:#fff">Zavřít</button>';
        note(html);
        byId('ag-mtr-cal-in').value = Math.round(cur);
        byId('ag-mtr-cal-fov').addEventListener('click', function () { applyCal('fov'); });
        byId('ag-mtr-cal-h').addEventListener('click', function () { applyCal('h'); });
    }
    function applyCal(what) {
        var want = num((byId('ag-mtr-cal-in') || {}).value, 0);
        var m = measure();
        if (!(want > 0) || !m || !m.d) { toast('Zadej skutečnou délku v mm.'); return; }
        var ratio = want / m.d;                       // >1 = obraz je ve skutečnosti větší
        if (what === 'h') {
            var nh = heightM() * ratio * 100;
            if (!(nh > 5 && nh < 400)) { toast('Dopočtená výška ' + fmt(nh, 0) + ' cm je mimo rozsah — zkontroluj zadanou délku.'); return; }
            lsSet(LS_H, String(Math.round(nh * 10) / 10));
            var inp = byId('ag-mtr-h'); if (inp) inp.value = Math.round(nh * 10) / 10;
            markPreset();
            note('');
            toast('Výška držení dopočítána na ' + fmt(nh, 0) + ' cm.');
            return;
        }
        // FOV: mm/px se má změnit ratio-krát, tedy tan(F/2) taky
        var nf = 2 * Math.atan(Math.tan(fovNow() * Math.PI / 360) * ratio) * 180 / Math.PI;
        if (!(nf > MIN_FOV && nf < MAX_FOV)) { toast('Dopočtený zorný úhel ' + fmt(nf, 1) + '° je mimo rozsah — zkontroluj zadanou délku i výšku.'); return; }
        setCalFov(nf);
        note('');
        toast('Zorný úhel zkalibrován na ' + fmt(nf, 1) + '° (pro režim ' + camKey() + ').');
    }

    // ---- nabídka „⋯" ---------------------------------------------------------------------------
    function menu() {
        var c = calFov();
        note('<b>Metr v kameře</b><br>'
            + '<div style="text-align:left;margin:8px 0 4px;font-size:calc(12.5px * var(--ag-font-scale,1));opacity:.85">'
            + 'Režim kamery: ' + (camKey() || '—') + '<br>'
            + 'Zorný úhel: ' + (c != null ? fmt(c, 1) + '° (zkalibrováno)' : DEF_FOV + '° — <b>jen odhad</b>') + '<br>'
            + 'Výška držení: ' + fmt(heightM() * 100, 1) + ' cm<br>'
            + 'Sklon povrchu: ' + slopePct() + ' %'
            + '</div>'
            + '<button type="button" id="ag-mtr-m-cal">Zkalibrovat</button> '
            + '<button type="button" id="ag-mtr-m-slope" style="background:rgba(255,255,255,.14);color:#fff">Sklon povrchu</button> '
            + '<button type="button" id="ag-mtr-m-log" style="background:rgba(255,255,255,.14);color:#fff">Záznamy</button> '
            + '<button type="button" id="ag-mtr-note-ok" style="background:rgba(255,255,255,.14);color:#fff">Zavřít</button>');
        byId('ag-mtr-m-cal').addEventListener('click', function () { note(''); calibrate(); });
        byId('ag-mtr-m-slope').addEventListener('click', askSlope);
        byId('ag-mtr-m-log').addEventListener('click', function () { note(''); openLog(); });
    }
    function askSlope() {
        note('<b>Sklon povrchu</b><br>Nástroj měří <b>vodorovný průmět</b>. Když měříš po nakloněné ploše '
            + '(příčný sklon vozovky, svah), skutečná délka po povrchu je delší.<br>Zadej sklon v procentech:<br>'
            + '<input id="ag-mtr-sl-in" type="number" inputmode="decimal" step="0.1" min="0" max="100" '
            + 'style="width:100px;margin-top:8px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.25);'
            + 'background:rgba(255,255,255,.1);color:#fff;font-size:calc(16px * var(--ag-font-scale,1));text-align:right">'
            + '<br><button type="button" id="ag-mtr-sl-ok">Uložit</button> '
            + '<button type="button" id="ag-mtr-note-ok" style="background:rgba(255,255,255,.14);color:#fff">Zavřít</button>');
        byId('ag-mtr-sl-in').value = slopePct();
        byId('ag-mtr-sl-ok').addEventListener('click', function () {
            var v = Math.max(0, Math.min(100, num(byId('ag-mtr-sl-in').value, 0)));
            lsSet(LS_SLOPE, String(v)); note(''); toast('Sklon povrchu ' + v + ' %.');
        });
    }

    // ---- seznam záznamů (běžný modál) ------------------------------------------------------------
    function openLog() {
        injectStyles();
        var m = byId('ag-mtr-modal');
        if (!m) {
            m = document.createElement('div');
            m.className = 'modal-overlay'; m.id = 'ag-mtr-modal';
            m.innerHTML = '<div class="modal-content">'
                + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Naměřené hodnoty</h3>'
                + '<div id="ag-mtr-loglist" class="ag-mtr-log"></div>'
                + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'
                + '<button type="button" class="btn btn-secondary" id="ag-mtr-csv">Export CSV</button>'
                + '<button type="button" class="btn btn-secondary" id="ag-mtr-clear">Vymazat vše</button>'
                + '<button type="button" class="btn btn-secondary" id="ag-mtr-logclose">Zavřít</button>'
                + '</div></div>';
            document.body.appendChild(m);
            m.querySelector('#ag-mtr-logclose').addEventListener('click', function () { m.style.display = 'none'; });
            m.querySelector('#ag-mtr-csv').addEventListener('click', exportCsv);
            m.querySelector('#ag-mtr-clear').addEventListener('click', function () {
                if (!window.confirm('Opravdu smazat všechna uložená měření této zakázky?')) return;
                logSave([]); renderLog();
            });
        }
        m.style.display = 'flex';
        renderLog();
    }
    function renderLog() {
        var box = byId('ag-mtr-loglist'); if (!box) return;
        var rows = logAll().slice().sort(function (a, b) { return b.ts - a.ts; });
        if (!rows.length) { box.innerHTML = '<div class="ag-mtr-empty">Zatím žádné měření. Otevři hledáček, polož dva body a dej <b>Uložit</b>.</div>'; return; }
        var html = '';
        rows.forEach(function (r) {
            var flags = [];
            if (!r.cal) flags.push('nezkalibrováno');
            if (r.tilt != null && r.tilt > WARN_TILT) flags.push('náklon ' + r.tilt + '°');
            html += '<div class="row" data-id="' + esc(r.id) + '">'
                + '<div class="v"><b>' + esc(recLabelSafe(r)) + '</b>'
                + '<span>' + esc(fmtDT(r.ts)) + ' · výška ' + fmt(r.h, 0) + ' cm'
                + (r.ptName ? ' · u bodu ' + esc(r.ptName) : '')
                + (flags.length ? ' · ⚠ ' + esc(flags.join(', ')) : '') + '</span></div>'
                + (r.ptId ? '<button type="button" class="btn btn-secondary ag-mtr-att" data-id="' + esc(r.id) + '">K bodu</button>' : '')
                + '<button type="button" class="btn btn-secondary ag-mtr-del" data-id="' + esc(r.id) + '">Smazat</button>'
                + '</div>';
        });
        box.innerHTML = html;
        Array.prototype.forEach.call(box.querySelectorAll('.ag-mtr-del'), function (b) {
            b.addEventListener('click', function () {
                logSave(logAll().filter(function (x) { return x.id !== b.getAttribute('data-id'); }));
                renderLog();
            });
        });
        Array.prototype.forEach.call(box.querySelectorAll('.ag-mtr-att'), function (b) {
            b.addEventListener('click', function () {
                var r = null, all = logAll(), id = b.getAttribute('data-id');
                for (var i = 0; i < all.length; i++) { if (all[i].id === id) r = all[i]; }
                if (r) attachToPoint(r);
            });
        });
    }
    // Zápis jde do STEJNÉ poznámky, kterou zobrazuje karta bodu (savePointDoc
    // v kalkulacka.js) — hodnota je tím pádem i v záloze zakázky a v exportech.
    function attachToPoint(r) {
        if (typeof loadPointDoc !== 'function' || typeof savePointDoc !== 'function') { toast('Karta bodu není k dispozici.'); return; }
        var line = 'Metr v kameře ' + fmtDT(r.ts) + ': ' + recLabelSafe(r)
            + ' (výška ' + fmt(r.h, 0) + ' cm' + (r.cal ? '' : ', nezkalibrováno')
            + (r.tilt != null ? ', náklon ' + r.tilt + '°' : '') + ')';
        loadPointDoc(r.ptId).then(function (doc) {
            doc = doc || {};
            if (!Array.isArray(doc.photos)) doc.photos = [];
            doc.note = (doc.note ? doc.note + '\n' : '') + line;
            doc.t = Date.now();
            savePointDoc(r.ptId, doc).then(function () { toast('Zapsáno do poznámky bodu ' + (r.ptName || r.ptId) + '.'); });
        });
    }
    function exportCsv() {
        var rows = logAll().slice().sort(function (a, b) { return a.ts - b.ts; });
        if (!rows.length) { toast('Není co exportovat.'); return; }
        var out = ['cas;typ;delka_mm;sirka_mm;vyska_mm;plocha_m2;vyska_drzeni_cm;fov_deg;zkalibrovano;naklon_deg;sklon_pct;bod;lat;lng'];
        rows.forEach(function (r) {
            out.push([
                fmtDT(r.ts), (r.mode === 'rect' ? 'obdelnik' : 'delka'),
                r.d != null ? String(r.d).replace('.', ',') : '',
                r.w != null ? String(r.w).replace('.', ',') : '',
                r.hMM != null ? String(r.hMM).replace('.', ',') : '',
                r.area != null ? String(r.area).replace('.', ',') : '',
                String(r.h).replace('.', ','), String(Math.round(r.fov * 10) / 10).replace('.', ','),
                r.cal ? 'ano' : 'ne', r.tilt != null ? String(r.tilt).replace('.', ',') : '',
                String(r.slope || 0).replace('.', ','), r.ptName || '',
                r.lat != null ? r.lat.toFixed(7).replace('.', ',') : '',
                r.lng != null ? r.lng.toFixed(7).replace('.', ',') : ''
            ].join(';'));
        });
        var blob = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'metr-' + projName().replace(/[^\w\-]+/g, '_') + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:exportCsv'); } }, 4000);
    }

    // ---- hledáček ------------------------------------------------------------------------------
    function markPreset() {
        var v = Math.round(num((byId('ag-mtr-h') || {}).value, -1));
        Array.prototype.forEach.call(document.querySelectorAll('#ag-mtr-hrow .ag-mtr-pre'), function (b) {
            if (Math.round(num(b.getAttribute('data-h'), -2)) === v) b.classList.add('sel'); else b.classList.remove('sel');
        });
    }
    function setMode(m) {
        _mode = m; _pts = []; _drag = -1;
        Array.prototype.forEach.call(document.querySelectorAll('#ag-mtr-modes button'), function (b) {
            if (b.getAttribute('data-m') === m) b.classList.add('sel'); else b.classList.remove('sel');
        });
    }
    function ensureOverlay() {
        var ov = byId('ag-mtr');
        if (ov) return ov;
        injectStyles();
        ov = document.createElement('div');
        ov.id = 'ag-mtr';
        ov.innerHTML =
            '<video id="ag-mtr-vid" playsinline muted autoplay></video>'
            + '<canvas id="ag-mtr-cv"></canvas>'
            + '<div id="ag-mtr-top">'
            + '  <div id="ag-mtr-hbox">'
            + '    <div id="ag-mtr-hrow">'
            + '      <label for="ag-mtr-h">Držím ve výšce</label>'
            + '      <input id="ag-mtr-h" type="number" inputmode="decimal" min="10" max="300" step="1">'
            + '      <label>cm</label>'
            + '      <button type="button" class="ag-mtr-pre" data-h="80">80</button>'
            + '      <button type="button" class="ag-mtr-pre" data-h="100">100</button>'
            + '      <button type="button" class="ag-mtr-pre" data-h="120">120</button>'
            + '    </div>'
            + '    <div id="ag-mtr-scale"></div>'
            + '  </div>'
            + '  <div id="ag-mtr-lev"><span class="ring"></span><span class="bub" id="ag-mtr-bub"></span><span id="ag-mtr-levtxt"></span></div>'
            + '</div>'
            + '<div id="ag-mtr-read"><div class="big" id="ag-mtr-big"></div><div class="sub" id="ag-mtr-sub"></div></div>'
            + '<div id="ag-mtr-note"></div>'
            + '<div id="ag-mtr-bar">'
            + '  <button type="button" id="ag-mtr-close" aria-label="Zavřít">✕</button>'
            + '  <div id="ag-mtr-modes">'
            + '    <button type="button" data-m="scale">Stupnice</button>'
            + '    <button type="button" data-m="dist">Délka</button>'
            + '    <button type="button" data-m="rect">Obdélník</button>'
            + '  </div>'
            + '  <button type="button" id="ag-mtr-savebtn">Uložit</button>'
            + '  <button type="button" id="ag-mtr-menubtn" aria-label="Další">⋯</button>'
            + '</div>';
        document.body.appendChild(ov);

        var inp = ov.querySelector('#ag-mtr-h');
        inp.value = num(lsGet(LS_H, '100'), 100);
        inp.addEventListener('input', function () {
            var v = num(inp.value, null);
            if (v != null && v >= 10 && v <= 300) lsSet(LS_H, String(v));
            markPreset();
        });
        Array.prototype.forEach.call(ov.querySelectorAll('#ag-mtr-hrow .ag-mtr-pre'), function (b) {
            b.addEventListener('click', function () {
                inp.value = b.getAttribute('data-h');
                lsSet(LS_H, inp.value);
                markPreset();
            });
        });
        Array.prototype.forEach.call(ov.querySelectorAll('#ag-mtr-modes button'), function (b) {
            b.addEventListener('click', function () { setMode(b.getAttribute('data-m')); });
        });
        ov.querySelector('#ag-mtr-close').addEventListener('click', close);
        ov.querySelector('#ag-mtr-savebtn').addEventListener('click', saveMeasure);
        ov.querySelector('#ag-mtr-menubtn').addEventListener('click', menu);
        // „Rozumím / Zavřít" v plovoucí hlášce je pokaždé jiný prvek → delegace
        ov.querySelector('#ag-mtr-note').addEventListener('click', function (e) {
            if (e.target && e.target.id === 'ag-mtr-note-ok') note('');
        });

        var cv = ov.querySelector('#ag-mtr-cv');
        cv.addEventListener('pointerdown', function (e) { try { cv.setPointerCapture(e.pointerId); } catch (x) { window.AG && AG.swallow && AG.swallow(x, 'ar-metr:ensureOverlay'); } onDown(e); });
        cv.addEventListener('pointermove', onMove);
        cv.addEventListener('pointerup', onUp);
        cv.addEventListener('pointercancel', onUp);
        return ov;
    }

    function open() {
        var ov = ensureOverlay();
        ov.classList.add('on');
        markPreset();
        setMode(_mode);
        startMotion();
        if (!_raf) _raf = requestAnimationFrame(drawFrame);

        var v = byId('ag-mtr-vid');
        var s = arStream();
        if (s) {
            _usingAr = true; v.srcObject = s;
            v.play()['catch'](function () {});
            afterCam();
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            close();
            fail('Kamera není dostupná', 'Prohlížeč nepustil kameru. Metr v kameře bez ní nefunguje.');
            return;
        }
        note('Zapínám kameru…');
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        }).then(function (st) {
            if (!ov.classList.contains('on')) { try { st.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:open'); } return; }
            _stream = st; _usingAr = false;
            v.srcObject = st;
            v.play()['catch'](function () {});
            afterCam();
        })['catch'](function () {
            close();
            fail('Kamera se nespustila', 'Zkontroluj povolení kamery pro tuhle stránku.');
        });
    }
    // Kalibrace platí pro KONKRÉTNÍ režim kamery. Když se rozlišení liší od toho,
    // ve kterém se kalibrovalo, je to jiný výřez — a to se musí říct, ne zamlčet.
    function afterCam() {
        setTimeout(function () {
            syncView();
            if (isCalibrated()) { note(''); return; }
            note('<b>Nejdřív jednorázová kalibrace</b><br>Zorný úhel tvého telefonu appka nezná, takže teď měří '
                + 'jen podle odhadu (' + DEF_FOV + '°) a může být <b>o desítky procent vedle</b>.<br>'
                + 'Polož na zem svinovák nebo list A4 (dlouhá strana 297 mm), přepni na <b>Délka</b>, klepni na oba konce '
                + 'a v nabídce <b>⋯ → Zkalibrovat</b> zadej skutečnou délku.'
                + '<br><button type="button" id="ag-mtr-note-ok">Rozumím</button>');
        }, 500);
    }
    function close() {
        var ov = byId('ag-mtr');
        if (ov) ov.classList.remove('on');
        if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
        note('');
        stopStream();
        stopMotion();
    }

    try {
        window.addEventListener('pagehide', close);
        document.addEventListener('visibilitychange', function () { if (document.hidden) close(); });
    } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ar-metr:close'); }

    // ---- veřejné API + dlaždice ------------------------------------------------------------------
    window.AGMetr = { open: open, close: close, log: logAll };
    window.agOpenMetr = open;

    var _tries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'ar-metr', label: 'Metr v kameře', icon: ICON, cat: 'Měření', onClick: open, order: 13 });
            return;
        }
        if (_tries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
})();
