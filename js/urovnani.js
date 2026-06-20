// ===== AR Geodet — UROVNÁNÍ STATIVU / PŘÍSTROJE (ODPOJITELNÁ vrstva) ===========
// Samostatný celoobrazovkový režim (jako brutal-gps.js): vypne kameru/mapu a
// ukáže elektronickou LIBELU, která NAVÁDÍ — kterou nohou stativu (nebo kterým
// stavěcím šroubem přístroje) a kam má uživatel pohnout, aby srovnal do roviny.
// Klasická vodováha v mobilu řekne jen úhel; tohle řekne i KONKRÉTNÍ akci.
//
// Princip:
//   • Náklon čteme z akcelerometru (devicemotion → accelerationIncludingGravity),
//     fallback deviceorientation (beta/gamma). EMA filtr proti šumu.
//   • Vodorovná složka gravitace = směr „z kopce" → nízká strana hlavy.
//   • Tři opěry (nohy / šrouby) jsou nakreslené na PEVNÝCH pozicích po 120°
//     (jedna od tebe nahoře, dvě k tobě dolů-vlevo/vpravo). Uživatel se postaví
//     tak, aby diagram seděl s realitou. Pro každou opěru spočítáme, zda je její
//     roh nízko (→ prodloužit/zvednout) nebo vysoko (→ zkrátit/spustit) a o kolik.
//   • Volitelná kalibrace otočením o 180°: vyruší konstantní bias senzoru
//     (reading = pravýNáklon + bias; po 180° yaw se pravýNáklon znegativní, bias ne;
//      bias = (r1+r2)/2). Uživatel si ji může, ale nemusí zapnout.
//
// NEEDITUJE logika.js ani grafika.js. Odstranění: smaž js/urovnani.js +
// css/urovnani.css a jejich řádky v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>';

    // ---- konfigurace ----------------------------------------------------------
    var EMA          = 0.18;     // vyhlazení akcelerometru (0..1, méně = klidnější)
    var FOOT_R_M     = 0.70;     // vodorovná vzdálenost patky stativu od osy (odhad, jen pro cm)
    var TOL = {                  // meze „zelená/oranžová" ve stupních dle režimu
        tripod: { ok: 0.30, warn: 1.20 },
        instrument: { ok: 0.08, warn: 0.40 }
    };
    var G = 9.80665;

    // tři opěry po 120° (matematický úhel, y nahoru). Jedna od uživatele (nahoře),
    // dvě k uživateli (dolů vlevo/vpravo) — uživatel stojí v mezeře dole.
    var SUPPORTS = [
        { key: 'front', ang: 90,  label: 'Vpředu', pos: 'vpředu' },   // od tebe (nahoře)
        { key: 'left',  ang: 210, label: 'Vlevo',  pos: 'vlevo' },    // dolů vlevo
        { key: 'right', ang: 330, label: 'Vpravo', pos: 'vpravo' }    // dolů vpravo
    ];

    // ---- stav -----------------------------------------------------------------
    var _open = false, _mode = 'tripod';          // 'tripod' | 'instrument'
    var _ui = null, _tick = null, _wakeLock = null;
    var _ax = 0, _ay = 0, _az = G, _have = false;  // vyhlazená gravitace (m/s²)
    var _bias = { x: 0, y: 0 }, _calOn = false;     // kalibrační offset + zda je zapnutá
    var _calStep = 0, _calR1 = null;                // 0=neběží, 1=čekám na 1. odečet, 2=po otočení
    var _sensor = null;                             // 'motion' | 'orient' | null
    var _prevView = null, _camWasLive = false;
    var _wasLevel = false;                          // pro pípnutí při dosažení roviny
    var _screwInvert = false;                       // přístroj s opačným závitem šroubů (otáčí naopak)
    try { _screwInvert = localStorage.getItem('agLvlScrewInvert') === '1'; } catch (e) {}

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function deg2rad(d) { return d * Math.PI / 180; }

    // ====== senzory ============================================================
    function onMotion(e) {
        var a = e.accelerationIncludingGravity;
        if (!a || (a.x == null && a.y == null && a.z == null)) return;
        _ax = _ax + EMA * ((a.x || 0) - _ax);
        _ay = _ay + EMA * ((a.y || 0) - _ay);
        _az = _az + EMA * ((a.z || 0) - _az);
        _have = true; _sensor = 'motion';
    }
    // fallback: z náklonových úhlů poskládáme gravitační vektor
    function onOrient(e) {
        if (_sensor === 'motion') return;            // motion má přednost
        if (e.beta == null && e.gamma == null) return;
        var b = deg2rad(e.beta || 0), g = deg2rad(e.gamma || 0);
        // přibližná gravitace v ose zařízení (telefon blízko vodorovně)
        var gx = G * Math.sin(g);
        var gy = -G * Math.sin(b);
        var gz = G * Math.cos(b) * Math.cos(g);
        _ax = _ax + EMA * (gx - _ax);
        _ay = _ay + EMA * (gy - _ay);
        _az = _az + EMA * (gz - _az);
        _have = true; _sensor = _sensor || 'orient';
    }

    function startSensors() {
        var attach = function () {
            window.addEventListener('devicemotion', onMotion);
            window.addEventListener('deviceorientation', onOrient);
        };
        try {
            var needM = (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function');
            var needO = (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function');
            if (needM || needO) {
                var p = needM ? DeviceMotionEvent.requestPermission() : DeviceOrientationEvent.requestPermission();
                p.then(function () {
                    if (needO && needM) { DeviceOrientationEvent.requestPermission().catch(function () {}); }
                    attach();
                }).catch(function () { attach(); });
            } else { attach(); }
        } catch (e) { attach(); }
    }
    function stopSensors() {
        try { window.removeEventListener('devicemotion', onMotion); } catch (e) {}
        try { window.removeEventListener('deviceorientation', onOrient); } catch (e) {}
    }

    function lockScreen() { try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { _wakeLock = w; }).catch(function () {}); } catch (e) {} }
    function unlockScreen() { try { if (_wakeLock) { _wakeLock.release(); _wakeLock = null; } } catch (e) {} }
    function onVis() { if (_open && document.visibilityState === 'visible' && !_wakeLock) lockScreen(); }

    function pauseCamera() {
        try {
            _camWasLive = !!(typeof currentVideoStream !== 'undefined' && currentVideoStream);
            _prevView = (typeof viewMode !== 'undefined') ? viewMode : null;
            if (typeof stopCameraStream === 'function') stopCameraStream();
        } catch (e) {}
    }
    function resumeCamera() {
        try {
            if (_camWasLive && (_prevView === 'ar' || _prevView === 'split') && typeof startCameraAndCompass === 'function'
                && typeof appStarted !== 'undefined' && appStarted) startCameraAndCompass(true);
        } catch (e) {}
    }

    // ====== výpočet náklonu ====================================================
    // vrátí vodorovnou složku gravitace (po kalibraci) a celkový úhel
    function tilt() {
        var gx = _ax - (_calOn ? _bias.x : 0);
        var gy = _ay - (_calOn ? _bias.y : 0);
        var gh = Math.hypot(gx, gy);
        var ang = Math.atan2(gh, Math.abs(_az)) * 180 / Math.PI;
        return { gx: gx, gy: gy, gh: gh, ang: ang };
    }

    // pro každou opěru: c>0 = roh je nízko (prodloužit/zvednout), c<0 = vysoko
    function corrections(t) {
        return SUPPORTS.map(function (s) {
            var a = deg2rad(s.ang);
            var dx = Math.cos(a), dy = Math.sin(a);          // směr opěry (y nahoru)
            var c = t.gx * dx + t.gy * dy;                   // projekce „z kopce" na opěru
            var dMeters = FOOT_R_M * c / G;                  // ≈ změna délky nohy [m]
            return { s: s, dx: dx, dy: dy, c: c, mm: dMeters * 1000 };
        });
    }

    // ====== UI =================================================================
    var VB = 320, CN = 160, R_VIAL = 92, R_SUP = 116, R_LAB = 148, R_ARROW = 84;

    function supScreen(ang, r) {
        var a = deg2rad(ang);
        return { x: CN + r * Math.cos(a), y: CN - r * Math.sin(a) };   // SVG y dolů
    }

    function vialSvg() {
        // viewBox s okrajem, ať se popisky opěr u kraje neořezávají
        var parts = ['<svg viewBox="-8 -12 ' + (VB + 16) + ' ' + (VB + 28) + '" id="lvl-svg">'];
        // vial
        parts.push('<circle cx="' + CN + '" cy="' + CN + '" r="' + R_VIAL + '" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>');
        // tolerance kruh (cíl)
        parts.push('<circle id="lvl-tol" cx="' + CN + '" cy="' + CN + '" r="18" fill="none" stroke="rgba(255,255,255,0.30)" stroke-width="1.5" stroke-dasharray="3 4"/>');
        // nitkový kříž
        parts.push('<line x1="' + (CN - 12) + '" y1="' + CN + '" x2="' + (CN + 12) + '" y2="' + CN + '" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>');
        parts.push('<line x1="' + CN + '" y1="' + (CN - 12) + '" x2="' + CN + '" y2="' + (CN + 12) + '" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>');
        // opěry: kolečko (poloha nohy/šroubu) + radiální šipka + ↻/↺ glyf + popisek mimo kolečko
        SUPPORTS.forEach(function (s) {
            var p = supScreen(s.ang, R_SUP), pl = supScreen(s.ang, R_LAB), pa = supScreen(s.ang, R_ARROW);
            parts.push('<g id="lvl-sup-' + s.key + '" class="lvl-sup">');
            parts.push('<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="14" class="lvl-foot"/>');
            // radiální šipka (stativ): míří K patě = vysunout / OD paty = zasunout; transform nastaví render
            parts.push('<polygon class="lvl-rad" points="-7,-7 9,0 -7,7 -1,0" transform="translate(' + pa.x.toFixed(1) + ',' + pa.y.toFixed(1) + ')" />');
            // glyf uvnitř kolečka (přístroj ↻/↺, nebo ✓ v rovině)
            parts.push('<text class="lvl-glyph" x="' + p.x.toFixed(1) + '" y="' + (p.y + 0.5).toFixed(1) + '"></text>');
            parts.push('<text class="lvl-lab" x="' + pl.x.toFixed(1) + '" y="' + (pl.y + 4).toFixed(1) + '">' + s.label + '</text>');
            parts.push('</g>');
        });
        // bublina
        parts.push('<circle id="lvl-bubble" cx="' + CN + '" cy="' + CN + '" r="15" fill="rgba(52,211,153,0.85)" stroke="#fff" stroke-width="1.5"/>');
        parts.push('</svg>');
        return parts.join('');
    }

    function build() {
        if (_ui) return _ui;
        var el = document.createElement('div');
        el.id = 'ag-lvl-overlay';
        el.innerHTML =
            '<div class="lvl-top"><h2>' + ICON + ' Urovnání</h2><button class="lvl-x" type="button" aria-label="Zavřít" id="lvl-close">×</button></div>'
            + '<div class="lvl-seg" id="lvl-seg">'
            + '<button type="button" class="lvl-segbtn on" data-mode="tripod">Stativ (nohy)</button>'
            + '<button type="button" class="lvl-segbtn" data-mode="instrument">Přístroj (šrouby)</button>'
            + '</div>'
            + '<p class="lvl-sub" id="lvl-sub"></p>'
            + '<div class="lvl-vial-wrap"><div class="lvl-vial">' + vialSvg() + '</div></div>'
            + '<div class="lvl-angle"><span id="lvl-ang">–</span><small>°</small></div>'
            + '<div class="lvl-instr" id="lvl-instr"></div>'
            + '<label class="lvl-switch lvl-screw-opt lvl-hidden" id="lvl-screw-opt"><input type="checkbox" id="lvl-screw-inv"><span></span>Můj přístroj má opačné šrouby (otáčí se naopak)</label>'
            + '<div class="lvl-status" id="lvl-status">Polož telefon na hlavu stativu, displejem nahoru.</div>'
            + '<div class="lvl-cal">'
            + '<label class="lvl-switch"><input type="checkbox" id="lvl-cal-on"><span></span>Kalibrace otočením o 180° — srovná i vystouplou kameru</label>'
            + '<div class="lvl-cal-body lvl-hidden" id="lvl-cal-body">'
            + '<p class="lvl-cal-info">Telefon kvůli vystouplé zadní kameře neleží na hlavě úplně rovně. Tahle kalibrace ten náklon odečte: změříš, otočíš telefon o 180° na stejné místo, změříš znovu — appka rozdíl vyruší. Dělej to na hlavě stativu (ne jinde).</p>'
            + '<button class="lvl-btn ghost" type="button" id="lvl-cal-start">Spustit kalibraci</button>'
            + '<div class="lvl-cal-state" id="lvl-cal-state"></div>'
            + '</div>'
            + '</div>'
            + '<button class="lvl-btn ghost" type="button" id="lvl-recenter">Vynulovat na aktuální polohu (jen na ověřené rovině!)</button>';
        document.body.appendChild(el);

        el.querySelector('#lvl-close').addEventListener('click', close);
        el.querySelectorAll('.lvl-segbtn').forEach(function (b) {
            b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
        });
        el.querySelector('#lvl-cal-on').addEventListener('change', function () {
            _calOn = this.checked;
            $('lvl-cal-body').classList.toggle('lvl-hidden', !_calOn);
            if (!_calOn) { _calStep = 0; setCalState(''); }
            else setCalState('Spusť kalibraci a postupuj podle pokynů.');
        });
        el.querySelector('#lvl-cal-start').addEventListener('click', calStart);
        el.querySelector('#lvl-recenter').addEventListener('click', recenter);
        var inv = el.querySelector('#lvl-screw-inv');
        inv.checked = _screwInvert;
        inv.addEventListener('change', function () {
            _screwInvert = this.checked;
            try { localStorage.setItem('agLvlScrewInvert', _screwInvert ? '1' : '0'); } catch (e) {}
        });
        _ui = el;
        return el;
    }

    function $(id) { return _ui ? _ui.querySelector('#' + id) : null; }
    function setStatus(txt, kind) { var e = $('lvl-status'); if (e) { e.textContent = txt; e.className = 'lvl-status' + (kind ? ' ' + kind : ''); } }
    function setCalState(txt) { var e = $('lvl-cal-state'); if (e) e.textContent = txt; }

    function setMode(m) {
        _mode = m;
        if (!_ui) return;
        _ui.querySelectorAll('.lvl-segbtn').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === m); });
        var sub = $('lvl-sub');
        var sopt = $('lvl-screw-opt'); if (sopt) sopt.classList.toggle('lvl-hidden', m !== 'instrument');
        if (m === 'tripod') {
            sub.innerHTML = 'Postav se ke stativu tak, aby <b>přední noha mířila od tebe</b>, zbylé dvě vlevo/vpravo. Telefon polož na hlavu <b>delší stranou k sobě</b>. Šipka <b>k patě = vysunout</b>, <b>od paty = zasunout</b>.';
        } else {
            sub.innerHTML = 'Telefon polož na tribrach nad šrouby (jeden od tebe, dva k tobě). Appka řekne, <b>kterým šroubem a kam otočit</b>. Závěr dolaď krabicovou libelou přístroje.';
        }
    }

    // ====== kalibrace 180° =====================================================
    function calStart() {
        if (!_have) { setCalState('Čekám na senzor náklonu…'); return; }
        _calStep = 1; _calR1 = null;
        setCalState('1/2 — nech telefon ležet a stiskni „Spustit kalibraci" znovu pro odečet.');
        $('lvl-cal-start').textContent = 'Odečíst 1. polohu';
        $('lvl-cal-start').onclick = calCapture1;
    }
    function calCapture1() {
        _calR1 = { x: _ax, y: _ay };
        _calStep = 2;
        setCalState('2/2 — OTOČ telefon na hlavě o 180° (na stejné místo) a stiskni „Odečíst 2. polohu".');
        $('lvl-cal-start').textContent = 'Odečíst 2. polohu';
        $('lvl-cal-start').onclick = calCapture2;
    }
    function calCapture2() {
        // bias = (r1 + r2) / 2 (pravý náklon se po 180° yaw znegativní, bias zůstává)
        _bias = { x: (_calR1.x + _ax) / 2, y: (_calR1.y + _ay) / 2 };
        _calStep = 0;
        var mag = Math.hypot(_bias.x, _bias.y) / G * 180 / Math.PI;
        setCalState('Hotovo — odečten náklon ' + mag.toFixed(2) + '° (kamera + bias senzoru). Náklon teď ukazuje reálnou rovinu hlavy.');
        $('lvl-cal-start').textContent = 'Kalibrovat znovu';
        $('lvl-cal-start').onclick = calStart;
    }
    function recenter() {
        // jednoduchá tára: vezmi aktuální vodorovnou složku jako nulu (i bez 180° kalibrace)
        _bias = { x: _ax, y: _ay }; _calOn = true;
        var cb = $('lvl-cal-on'); if (cb) cb.checked = true;
        $('lvl-cal-body').classList.remove('lvl-hidden');
        setStatus('Vynulováno na aktuální polohu (považuji ji za rovinu).', 'good');
    }

    // ====== render =============================================================
    function render() {
        if (!_open || !_ui) return;
        if (!_have) { setStatus('Čekám na senzor náklonu… (povol pohyb/orientaci)', 'warn'); return; }

        var t = tilt();
        var tol = TOL[_mode] || TOL.tripod;
        var col = t.ang <= tol.ok ? 'ok' : (t.ang <= tol.warn ? 'warn' : 'bad');

        // úhel
        var aEl = $('lvl-ang'); if (aEl) aEl.textContent = t.ang.toFixed(t.ang < 1 ? 2 : 1);
        var angWrap = _ui.querySelector('.lvl-angle'); if (angWrap) angWrap.className = 'lvl-angle ' + col;

        // bublina — jde na VYSOKOU stranu = -(gx,gy); ořež na vial
        var S = (R_VIAL - 20) / (G * Math.sin(deg2rad(3)));   // 3° náklonu = u okraje
        var bx = -t.gx * S, byUp = -t.gy * S;
        var bd = Math.hypot(bx, byUp), maxd = R_VIAL - 20;
        if (bd > maxd) { bx *= maxd / bd; byUp *= maxd / bd; }
        var bub = $('lvl-bubble');
        if (bub) {
            bub.setAttribute('cx', (CN + bx).toFixed(1));
            bub.setAttribute('cy', (CN - byUp).toFixed(1));      // SVG y dolů
            var fill = col === 'ok' ? 'rgba(52,211,153,0.9)' : (col === 'warn' ? 'rgba(251,191,36,0.9)' : 'rgba(239,68,68,0.9)');
            bub.setAttribute('fill', fill);
        }

        // opěry: šipky a zvýraznění dominantní
        var corr = corrections(t);
        var dom = corr.slice().sort(function (a, b) { return Math.abs(b.c) - Math.abs(a.c); })[0];
        // pro přístroj s opačným závitem otočíme směr (doprava↔doleva)
        function shown(c) { var low = c > 0; return (_mode === 'instrument' && _screwInvert) ? !low : low; }
        var level = t.ang <= tol.ok;

        corr.forEach(function (c) {
            var g = _ui.querySelector('#lvl-sup-' + c.s.key);
            if (!g) return;
            var poly = g.querySelector('.lvl-rad');
            var glyph = g.querySelector('.lvl-glyph');
            var isDom = (c === dom) && !level;
            var s = shown(c.c);   // true = vysunout / doprava
            if (level) {
                if (glyph) glyph.textContent = '✓';
                if (poly) poly.style.display = 'none';
            } else if (_mode === 'instrument') {
                if (glyph) glyph.textContent = s ? '↻' : '↺';   // směr otáčení šroubu
                if (poly) poly.style.display = 'none';
            } else {
                if (glyph) glyph.textContent = '';
                if (poly) {
                    var pa = supScreen(c.s.ang, R_ARROW);
                    var rot = -c.s.ang + (s ? 0 : 180);          // s=vysunout → šipka K patě (ven); jinak OD paty (dovnitř)
                    poly.style.display = '';
                    poly.setAttribute('transform', 'translate(' + pa.x.toFixed(1) + ',' + pa.y.toFixed(1) + ') rotate(' + rot.toFixed(1) + ')');
                }
            }
            var faded = !isDom && !level ? ' faded' : '';        // jen dominantní opěra výrazná
            g.setAttribute('class', 'lvl-sup' + (isDom ? ' dom' : '') + faded + ' ' + (level ? 'level' : (s ? 'up' : 'down')));
        });

        // hlavní pokyn — jedna jasná akce slovy (gramaticky: poloha místo „levá šroubem")
        var instr = $('lvl-instr');
        if (instr) {
            var ds = shown(dom.c);
            if (level) {
                instr.innerHTML = '<div class="lvl-ok">✓ V rovině</div>';
            } else if (_mode === 'tripod') {
                var verb = ds ? 'vysuň' : 'zasuň';
                var cm = Math.abs(dom.mm) / 10;
                instr.innerHTML = '<div class="lvl-do ' + (ds ? 'up' : 'down') + '">'
                    + 'Noha <b>' + dom.s.pos + '</b>: ' + verb + ' o ~<b>' + cm.toFixed(cm < 5 ? 1 : 0) + ' cm</b></div>';
            } else {
                instr.innerHTML = '<div class="lvl-do ' + (ds ? 'up' : 'down') + '">'
                    + 'Šroub <b>' + dom.s.pos + '</b>: otoč <b>' + (ds ? 'doprava ↻' : 'doleva ↺') + '</b></div>'
                    + '<div class="lvl-hint">Kdyby bublina šla od středu, zapni „opačné šrouby" níže.</div>';
            }
        }

        // status + haptika při dosažení roviny
        if (t.ang <= tol.ok) {
            setStatus(_mode === 'tripod' ? 'Stativ je v rovině. Dotáhni a zkontroluj krabicovou libelou.' : 'V rovině. Dolaď krabicovou/elektronickou libelou přístroje.', 'good');
            if (!_wasLevel) { try { if (navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch (e) {} }
            _wasLevel = true;
        } else {
            setStatus('Náklon ' + t.ang.toFixed(2) + '° — uprav podle pokynu níže.', col === 'bad' ? 'bad' : 'warn');
            _wasLevel = false;
        }
    }

    // ====== otevření / zavření =================================================
    function open(mode) {
        build();
        _open = true; _wasLevel = false; _have = false; _sensor = null;
        _ax = 0; _ay = 0; _az = G;
        setMode(mode === 'instrument' ? 'instrument' : 'tripod');
        // kalibrace start vždy „čistá" (nepřenášet bias z minula bez vědomí)
        var cb = $('lvl-cal-on'); if (cb) { cb.checked = false; } _calOn = false;
        $('lvl-cal-body').classList.add('lvl-hidden');
        $('lvl-cal-start').textContent = 'Spustit kalibraci'; $('lvl-cal-start').onclick = calStart; _calStep = 0; setCalState('');
        pauseCamera(); startSensors(); lockScreen();
        document.addEventListener('visibilitychange', onVis);
        _ui.classList.add('on');
        render();
        if (!_tick) _tick = setInterval(render, 120);
    }
    function close() {
        _open = false;
        if (_tick) { clearInterval(_tick); _tick = null; }
        stopSensors(); unlockScreen();
        document.removeEventListener('visibilitychange', onVis);
        if (_ui) _ui.classList.remove('on');
        resumeCamera();
    }

    // ====== registrace =========================================================
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'urovnani', label: 'Urovnání stativu', icon: ICON, onClick: function () { open('tripod'); }, order: 6 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
    window.agOpenLevel = open;   // ať jde otevřít i ručně (open('tripod'|'instrument'))
})();
