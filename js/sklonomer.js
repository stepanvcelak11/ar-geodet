// ===== AR Geodet — SKLONOMĚR VRSTVY (%) — ODPOJITELNÁ vrstva ====================
// Pro kontrolu příčného/podélného sklonu položené vrstvy za finisherem:
// telefon se položí na vrstvu nebo na 2m lať PODÉLNOU osou po spádu a appka
// ukazuje sklon v % (tan úhlu × 100) živě z akcelerometru.
//
//   • CÍL + TOLERANCE: zadáš projektovaný sklon (např. 2,5 %) a toleranci —
//     hodnota svítí zeleně/červeně podle toho, jestli vrstva drží.
//   • KALIBRACE OTOČENÍM 180°: vyruší bias senzoru/obalu (reading = sklon +
//     bias; po otočení se sklon znegativní, bias ne → bias = (r1+r2)/2).
//   • HOLD: zmrazí čtení, ať se dá opsat do zápisníku.
//
// Senzory: devicemotion (accelerationIncludingGravity), fallback
// deviceorientation — stejný postup jako js/urovnani.js. EMA filtr proti šumu.
// Senzory běží JEN při otevřeném modálu. iOS permission přes requestPermission.
//
// NEEDITUJE logika.js ani grafika.js. Odstranění: smaž js/sklonomer.js
// + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var KEY = 'agSklonomer_v1';
    var MODAL_ID = 'sklonomer-modal';
    var STYLE_ID = 'ag-sm-style';
    var EMA = 0.15;
    var G = 9.80665;
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19L21 8"/><path d="M3 19h18"/><path d="M8.5 19v-2.2M13 19v-3.8M17.5 19v-5.5"/></svg>';

    function num(v, def) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : def; }
    function fmt(n, dec) { return n.toFixed(dec == null ? 1 : dec).replace('.', ','); }

    // ---- nastavení (cíl, tolerance, bias) --------------------------------------
    var S = { target: 2.5, tol: 0.3, bias: 0 };
    function loadS() { try { var v = JSON.parse(localStorage.getItem(KEY)); if (v) { S.target = num(v.target, 2.5); S.tol = num(v.tol, 0.3); S.bias = num(v.bias, 0); } } catch (e) {} }
    function saveS() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

    // ---- senzory (vzor urovnani.js) ---------------------------------------------
    var _ax = 0, _ay = 0, _az = G, _have = false, _sensor = null;
    function deg2rad(d) { return d * Math.PI / 180; }
    function onMotion(e) {
        var a = e.accelerationIncludingGravity;
        if (!a || (a.x == null && a.y == null && a.z == null)) return;
        _ax = _ax + EMA * ((a.x || 0) - _ax);
        _ay = _ay + EMA * ((a.y || 0) - _ay);
        _az = _az + EMA * ((a.z || 0) - _az);
        _have = true; _sensor = 'motion';
    }
    function onOrient(e) {
        if (_sensor === 'motion') return;
        if (e.beta == null && e.gamma == null) return;
        var b = deg2rad(e.beta || 0), g = deg2rad(e.gamma || 0);
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
        _have = false; _sensor = null;
    }

    // Sklon PODÉL dlouhé osy telefonu v % (+ = klesá ke spodnímu okraji telefonu)
    // a napříč (+ = klesá doprava). tan = vodorovná složka gravitace / svislá.
    function slopes() {
        var az = Math.abs(_az) < 0.5 ? (_az < 0 ? -0.5 : 0.5) : _az; // telefon nastojato nedává smysl
        return {
            along: (-_ay / az) * 100 - S.bias,
            across: (-_ax / az) * 100
        };
    }

    // ---- kalibrace otočením 180° -------------------------------------------------
    var _calStep = 0, _calR1 = null;

    // ---- UI ----------------------------------------------------------------------
    var _open = false, _tick = null, _hold = false, _heldVal = null;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + MODAL_ID + ' .sm-big{margin:6px 0 2px;text-align:center;font:800 54px/1.1 var(--font-mono,monospace);color:var(--accent,#34d399);}',
            '#' + MODAL_ID + ' .sm-big.bad{color:var(--danger,#ef4444);}',
            '#' + MODAL_ID + ' .sm-big.hold{opacity:0.75;text-decoration:underline dotted;}',
            '#' + MODAL_ID + ' .sm-sub{text-align:center;font-size:12.5px;color:var(--text-muted,#9aa1ac);margin-bottom:10px;}',
            '#' + MODAL_ID + ' .sm-verdict{margin:8px 0 12px;padding:10px 12px;border-radius:var(--r-md,12px);text-align:center;font-weight:700;font-size:14px;}',
            '#' + MODAL_ID + ' .sm-verdict.ok{background:rgba(47,158,116,0.14);border:1px solid var(--accent,#34d399);color:var(--accent,#34d399);}',
            '#' + MODAL_ID + ' .sm-verdict.bad{background:rgba(239,68,68,0.10);border:1px solid var(--danger,#ef4444);color:var(--danger,#ef4444);}',
            '#' + MODAL_ID + ' .sm-row{display:flex;gap:10px;align-items:center;margin-top:8px;font-size:13px;color:var(--text-color,#e8edf2);}',
            '#' + MODAL_ID + ' .sm-row label{flex:1;margin:0;}',
            '#' + MODAL_ID + ' .sm-row input{width:76px;margin:0;padding:8px;text-align:center;}',
            '#' + MODAL_ID + ' .sm-btns{display:flex;gap:8px;margin-top:14px;}',
            '#' + MODAL_ID + ' .sm-btns .btn{flex:1;margin:0;padding:11px;}',
            '#' + MODAL_ID + ' .sm-cal{margin-top:8px;font-size:12px;color:var(--text-muted,#9aa1ac);text-align:center;}',
            '#' + MODAL_ID + ' .sm-hint{margin-top:12px;font-size:12px;line-height:1.45;color:var(--text-muted,#9aa1ac);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function ensureModal() {
        if (document.getElementById(MODAL_ID)) return;
        injectStyles();
        var ov = document.createElement('div');
        ov.className = 'modal-overlay';
        ov.id = MODAL_ID;
        ov.innerHTML =
            '<div class="modal-content">' +
            '<h3 style="color: var(--accent); margin-top:0;">' + ICON + ' Sklonoměr vrstvy</h3>' +
            '<p style="font-size:13px; margin-top:0; opacity:0.8;">Polož telefon (ideálně na 2m lati) <b>podélnou osou po spádu</b> — obrazovkou nahoru, spodkem telefonu z kopce.</p>' +
            '<div class="modal-body">' +
            '<div class="sm-big" id="sm-val">—</div>' +
            '<div class="sm-sub" id="sm-sub">čekám na senzory…</div>' +
            '<div class="sm-verdict" id="sm-verdict" style="display:none;"></div>' +
            '<div class="sm-row"><label>Cílový sklon</label><input type="number" id="sm-target" step="0.1" inputmode="decimal"><span>%</span></div>' +
            '<div class="sm-row"><label>Tolerance ±</label><input type="number" id="sm-tol" step="0.1" inputmode="decimal"><span>%</span></div>' +
            '<div class="sm-btns">' +
            '<button type="button" class="btn btn-blue" id="sm-hold">HOLD</button>' +
            '<button type="button" class="btn btn-secondary" id="sm-cal-btn">Kalibrace otočením</button>' +
            '</div>' +
            '<div class="sm-cal" id="sm-cal"></div>' +
            '<div class="sm-hint">Sklon = tangenta úhlu × 100 (2,5 % = 1,43°). Kalibrace otočením o 180° vyruší křivost telefonu/obalu — dělej ji na klidném, rovném místě. Porovnává se |měřený| sklon s cílem; směr spádu hlídej podle šipky pod číslem.</div>' +
            '</div>' +
            '<button class="btn btn-secondary" style="margin-top:12px;" id="sm-close">Zavřít</button>' +
            '</div>';
        document.body.appendChild(ov);

        document.getElementById('sm-close').addEventListener('click', closeModal);
        document.getElementById('sm-target').addEventListener('input', function () { S.target = num(this.value, 2.5); saveS(); });
        document.getElementById('sm-tol').addEventListener('input', function () { S.tol = num(this.value, 0.3); saveS(); });
        document.getElementById('sm-hold').addEventListener('click', function () {
            _hold = !_hold;
            _heldVal = _hold ? slopes() : null;
            this.textContent = _hold ? 'HOLD ✓ (klepni pro živě)' : 'HOLD';
        });
        document.getElementById('sm-cal-btn').addEventListener('click', function () {
            var info = document.getElementById('sm-cal');
            if (_calStep === 0) {
                // 1. odečet — bias počítáme ze SUROVÉHO čtení (bez odečteného biasu)
                _calR1 = slopes().along + S.bias;
                _calStep = 1;
                this.textContent = 'Otočeno — dokonči kalibraci';
                info.textContent = 'Krok 2: otoč telefon (i s latí) o 180° na STEJNÉM místě a klepni znovu.';
            } else {
                var r2 = slopes().along + S.bias;
                S.bias = (_calR1 + r2) / 2;
                saveS();
                _calStep = 0; _calR1 = null;
                this.textContent = 'Kalibrace otočením';
                info.textContent = 'Hotovo — bias ' + fmt(S.bias, 2) + ' % se odečítá. (Vynuluješ další kalibrací na rovině.)';
            }
        });
    }

    function render() {
        if (!_open) return;
        var vEl = document.getElementById('sm-val');
        var sEl = document.getElementById('sm-sub');
        var verd = document.getElementById('sm-verdict');
        if (!vEl) return;
        if (!_have) { vEl.textContent = '—'; sEl.textContent = 'čekám na senzory… (povol pohybová data)'; if (verd) verd.style.display = 'none'; return; }
        var sl = _hold && _heldVal ? _heldVal : slopes();
        var a = sl.along;
        var deg = Math.atan(Math.abs(a) / 100) * 180 / Math.PI;
        vEl.textContent = fmt(Math.abs(a)) + ' %';
        vEl.classList.toggle('hold', _hold);
        var dir = a > 0.05 ? '▼ klesá ke spodnímu okraji telefonu' : (a < -0.05 ? '▲ klesá k hornímu okraji telefonu' : '— vodorovně');
        sEl.textContent = dir + ' · ' + fmt(deg, 2) + '° · napříč ' + fmt(Math.abs(sl.across)) + ' %';
        var diff = Math.abs(a) - S.target;
        var ok = Math.abs(diff) <= S.tol;
        vEl.classList.toggle('bad', !ok);
        if (verd) {
            verd.style.display = '';
            verd.className = 'sm-verdict ' + (ok ? 'ok' : 'bad');
            verd.textContent = ok
                ? 'V TOLERANCI (odchylka ' + (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff)) + ' % od cíle ' + fmt(S.target) + ' %)'
                : (diff > 0 ? 'MOC STRMÉ o ' + fmt(diff - S.tol) + ' % (cíl ' + fmt(S.target) + ' ± ' + fmt(S.tol) + ' %)'
                            : 'MOC PLOCHÉ o ' + fmt(-diff - S.tol) + ' % (cíl ' + fmt(S.target) + ' ± ' + fmt(S.tol) + ' %)');
        }
    }

    function openModal() {
        loadS();
        ensureModal();
        document.getElementById('sm-target').value = S.target;
        document.getElementById('sm-tol').value = S.tol;
        document.getElementById('sm-cal').textContent = S.bias ? ('Aktivní kalibrace: bias ' + fmt(S.bias, 2) + ' % se odečítá.') : '';
        _hold = false; _heldVal = null; _calStep = 0;
        document.getElementById('sm-hold').textContent = 'HOLD';
        document.getElementById(MODAL_ID).style.display = 'flex';
        _open = true;
        startSensors();
        if (!_tick) _tick = setInterval(render, 200);
    }
    function closeModal() {
        _open = false;
        if (_tick) { clearInterval(_tick); _tick = null; }
        stopSensors();
        var ov = document.getElementById(MODAL_ID);
        if (ov) ov.style.display = 'none';
        try { if (typeof fixAppLayout === 'function') fixAppLayout(); } catch (e) {}
    }

    window.agOpenSklonomer = openModal;

    // ---- vstup: dlaždice v Nástrojích ------------------------------------------
    function register() {
        if (typeof window.agRegisterFieldTool !== 'function') return;
        window.agRegisterFieldTool({ id: 'sklonomer', label: 'Sklonoměr (%)', icon: ICON, onClick: openModal, order: 7 });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
