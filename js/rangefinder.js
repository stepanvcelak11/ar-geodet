// ===== AR Geodet — OPTICKÝ DÁLKOMĚR (ODPOJITELNÁ vrstva) =======================
// Rychlý orientační odhad vodorovné vzdálenosti k patě objektu BEZ totálky a bez
// LiDARu — jen z výšky telefonu nad zemí a sklonu kamery pod horizont:
//
//        vzdálenost  d = výška / tan(úhel pod horizont)
//
// Křížem na displeji (= optická osa kamery) zamíříš tam, kde objekt stojí na zemi.
// Sklon kamery bere z window._arProj.pitch (počítá ho AR projekce v grafika.js,
// včetně kompenzace náklonu do strany), výšku zadá uživatel.
//
// POCTIVĚ: předpokládá ROVNOU zem ve výšce tvých nohou. U cílů blízko horizontu
// (malý úhel) chyba prudce roste — proto se zobrazuje i odhad ± a barevné varování.
// Je to orientační pomůcka (pásmo/překážka), ne náhrada měření.
//
// Vstup: dlaždice „Optický dálkoměr" v Nástrojích (js/field-tools.js); když launcher
//        chybí, modul si vyrobí vlastní plovoucí tlačítko.
// Odstranění: smaž js/rangefinder.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M3 6l18 0M3 6l3-3M3 6l3 3M21 6l-3-3M21 6l-3 3"/>'
        + '<path d="M12 9v11M9 17l3 3 3-3" opacity="0.85"/></svg>';

    var LS_H = 'agRangeH';          // uložená výška telefonu nad zemí (m)
    var DELTA_DEG = 1.0;            // typický rozkmit držení telefonu (pro odhad ±)
    var _height = loadHeight();
    var _live = null;               // poslední živý odečet {pitch,d,...}
    var _frozen = null;             // zmrazený výsledek (po „Změřit")
    var _poll = null;

    function loadHeight() {
        var h = NaN;
        try { h = parseFloat(localStorage.getItem(LS_H)); } catch (e) {}
        if (!isFinite(h) || h <= 0) {
            try { if (typeof visSettings === 'object' && visSettings && isFinite(visSettings.eyeHeight)) h = visSettings.eyeHeight; } catch (e) {}
        }
        if (!isFinite(h) || h <= 0) h = 1.5;
        return Math.round(h * 100) / 100;
    }
    function saveHeight() { try { localStorage.setItem(LS_H, String(_height)); } catch (e) {} }

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function curViewMode() { try { return (typeof viewMode !== 'undefined') ? viewMode : 'both'; } catch (e) { return 'both'; } }
    function pitchNow() {
        try { var p = window._arProj && window._arProj.pitch; return (typeof p === 'number' && isFinite(p)) ? p : null; } catch (e) { return null; }
    }
    function distAt(h, pitchDeg) { return h / Math.tan(pitchDeg * Math.PI / 180); }

    // jádro: z aktuálního sklonu spočti vodorovnou vzdálenost + poctivý odhad ±
    function compute() {
        var p = pitchNow();
        if (p == null) return { ok: false, reason: 'nopitch' };
        if (p <= 0.5) return { ok: false, reason: 'horizon', pitch: p };
        var d = distAt(_height, p);
        // chyba z rozkmitu držení: spodní a horní mez pro p ± DELTA
        var pHi = p + DELTA_DEG, pLo = Math.max(0.3, p - DELTA_DEG);
        var dMin = distAt(_height, pHi), dMax = distAt(_height, pLo);
        var err = Math.max(d - dMin, dMax - d);
        var q = (p >= 12) ? 'good' : (p >= 6 ? 'ok' : 'bad');
        return { ok: true, pitch: p, d: d, dMin: dMin, dMax: dMax, err: err, q: q };
    }

    // ---- aiming overlay (přes kameru) -----------------------------------------
    function declutter(on) {
        document.body.classList.toggle('agrf-clean', !!on);
        if (!on) { try { if (typeof applyViewMode === 'function') applyViewMode(); } catch (e) {} }
    }
    function ensureAim() {
        if (document.getElementById('agrf-aim')) return;
        var a = document.createElement('div');
        a.id = 'agrf-aim';
        a.innerHTML =
            '<div id="agrf-readout"><div id="agrf-d">—</div><div id="agrf-sub"></div></div>'
            + '<div id="agrf-cross"><svg viewBox="0 0 100 100">'
            + '<line x1="50" y1="8" x2="50" y2="38" stroke="#34d399" stroke-width="2"/><line x1="50" y1="62" x2="50" y2="92" stroke="#34d399" stroke-width="2"/>'
            + '<line x1="8" y1="50" x2="38" y2="50" stroke="#34d399" stroke-width="2"/><line x1="62" y1="50" x2="92" y2="50" stroke="#34d399" stroke-width="2"/>'
            + '<circle cx="50" cy="50" r="3" fill="#34d399"/></svg></div>'
            + '<div id="agrf-hint">Zaměř kříž na <b>patu objektu</b> (kde stojí na zemi)</div>'
            + '<div id="agrf-btns">'
            + '  <button id="agrf-shot" class="btn">Změřit</button>'
            + '  <button id="agrf-redo" class="btn btn-secondary" style="display:none;">Znovu</button>'
            + '  <button id="agrf-cancel" class="btn btn-secondary">Hotovo</button>'
            + '</div>';
        document.body.appendChild(a);
        document.getElementById('agrf-shot').addEventListener('click', freeze);
        document.getElementById('agrf-redo').addEventListener('click', unfreeze);
        document.getElementById('agrf-cancel').addEventListener('click', closeAim);
    }
    function showAim(on) { ensureAim(); document.getElementById('agrf-aim').classList.toggle('on', !!on); }

    function renderLive() {
        var dEl = document.getElementById('agrf-d'), subEl = document.getElementById('agrf-sub');
        if (!dEl) return;
        if (_frozen) return; // při zmrazeném výsledku živě nepřepisujeme
        var r = compute(); _live = r;
        if (!r.ok) {
            dEl.style.color = '#cbd5e1';
            if (r.reason === 'horizon') { dEl.innerText = '—'; subEl.innerHTML = 'míříš na horizont — nakloň telefon víc k zemi'; }
            else { dEl.innerText = '…'; subEl.innerHTML = 'čekám na náklon telefonu (podrž ho a miř na zem)'; }
            return;
        }
        var col = r.q === 'good' ? '#34d399' : (r.q === 'ok' ? '#fbbf24' : '#f87171');
        dEl.style.color = col;
        dEl.innerText = fmtD(r.d);
        subEl.innerHTML = '± ' + fmtD(r.err) + ' &nbsp;·&nbsp; sklon ' + r.pitch.toFixed(0) + '°'
            + (r.q === 'bad' ? ' &nbsp;·&nbsp; <span style="color:#f87171">moc daleko / u horizontu</span>' : '');
    }

    function fmtD(d) {
        if (d == null || !isFinite(d)) return '—';
        if (d >= 100) return d.toFixed(0) + ' m';
        if (d >= 10) return d.toFixed(1) + ' m';
        return d.toFixed(2) + ' m';
    }

    function freeze() {
        var r = compute();
        if (!r.ok) { agAlert('Nelze změřit', r.reason === 'horizon' ? 'Míříš příliš k horizontu — nakloň telefon víc dolů, na patu objektu.' : 'Čekám na náklon telefonu. Podrž ho a zaměř kříž na zem.'); return; }
        _frozen = r;
        if (navigator.vibrate) { try { navigator.vibrate(25); } catch (e) {} }
        var dEl = document.getElementById('agrf-d'), subEl = document.getElementById('agrf-sub');
        var col = r.q === 'good' ? '#34d399' : (r.q === 'ok' ? '#fbbf24' : '#f87171');
        if (dEl) { dEl.style.color = col; dEl.innerText = fmtD(r.d); }
        if (subEl) subEl.innerHTML = '± ' + fmtD(r.err) + ' &nbsp;·&nbsp; rozsah ' + fmtD(r.dMin) + '–' + fmtD(r.dMax)
            + '<br><span style="opacity:.8">výška ' + _height.toFixed(2) + ' m · sklon ' + r.pitch.toFixed(1) + '° · ROVNÁ zem</span>';
        document.getElementById('agrf-shot').style.display = 'none';
        document.getElementById('agrf-redo').style.display = 'inline-flex';
    }
    function unfreeze() {
        _frozen = null;
        document.getElementById('agrf-shot').style.display = 'inline-flex';
        document.getElementById('agrf-redo').style.display = 'none';
        renderLive();
    }

    function startAim() {
        if (curViewMode() === 'map') { agAlert('Zapni kameru', 'Přepni zobrazení na AR nebo Split — měří se přes kameru.'); return; }
        var modal = document.getElementById('agrf-modal'); if (modal) modal.style.display = 'none';
        _frozen = null;
        declutter(true); showAim(true);
        unfreeze();
        if (!_poll) _poll = setInterval(renderLive, 120);
    }
    function closeAim() {
        if (_poll) { clearInterval(_poll); _poll = null; }
        _frozen = null;
        showAim(false); declutter(false);
    }

    // ---- nastavovací modal -----------------------------------------------------
    function ensureModal() {
        if (document.getElementById('agrf-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agrf-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Optický dálkoměr</h3>'
            + '<p style="font-size:12.5px;opacity:.82;margin:2px 0 12px;line-height:1.45;">Rychlý odhad vodorovné vzdálenosti k patě objektu z výšky telefonu a sklonu kamery. '
            + 'Zaměř kříž tam, kde objekt stojí na zemi. <b>Orientační</b> — předpokládá rovnou zem; u dálky/horizontu roste chyba.</p>'
            + '<label class="agrf-fld"><span>Výška telefonu nad zemí (m)</span>'
            + '<input type="number" id="agrf-h" step="0.05" min="0.3" max="3" inputmode="decimal"></label>'
            + '<div class="agrf-hrow">'
            + '  <button type="button" class="agrf-chip" data-h="1.5">1,5 (ruka)</button>'
            + '  <button type="button" class="agrf-chip" data-h="1.6">1,6 (oči)</button>'
            + '  <button type="button" class="agrf-chip" data-h="1.7">1,7</button>'
            + '</div>'
            + '<button class="btn" id="agrf-go"><svg class="icon"><use href="#i-crosshair"/></svg> Spustit zaměřování</button>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" onclick="window.agCloseRangefinder&&window.agCloseRangefinder()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        var hInp = document.getElementById('agrf-h');
        hInp.value = _height.toFixed(2);
        hInp.addEventListener('change', function () {
            var v = parseFloat(hInp.value);
            if (isFinite(v) && v >= 0.3 && v <= 3) { _height = Math.round(v * 100) / 100; saveHeight(); }
            else { hInp.value = _height.toFixed(2); }
        });
        Array.prototype.forEach.call(el.querySelectorAll('.agrf-chip'), function (c) {
            c.addEventListener('click', function () { _height = parseFloat(c.getAttribute('data-h')); saveHeight(); hInp.value = _height.toFixed(2); });
        });
        document.getElementById('agrf-go').addEventListener('click', startAim);
    }

    function openTool() { ensureModal(); injectStyles(); document.getElementById('agrf-h').value = _height.toFixed(2); document.getElementById('agrf-modal').style.display = 'flex'; }
    window.agCloseRangefinder = function () { var m = document.getElementById('agrf-modal'); if (m) m.style.display = 'none'; closeAim(); };
    window.agOpenRangefinder = openTool;

    // ---- styly -----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('agrf-style')) return;
        var st = document.createElement('style'); st.id = 'agrf-style';
        st.textContent = [
            '#agrf-modal .agrf-fld{display:block;margin:8px 0 4px;}',
            '#agrf-modal .agrf-fld>span{display:block;font-size:12px;opacity:.75;margin-bottom:3px;}',
            '#agrf-modal .agrf-fld input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:10px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.05);color:var(--text-color,#e8edf2);font:600 16px/1.1 var(--font,system-ui),sans-serif;}',
            '#agrf-modal .agrf-hrow{display:flex;gap:8px;margin:6px 0 14px;}',
            '#agrf-modal .agrf-chip{flex:1;padding:7px 4px;border-radius:9px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:rgba(255,255,255,0.04);color:var(--text-color,#e8edf2);font:600 12px/1 var(--font,system-ui),sans-serif;}',
            // vyčištěná obrazovka během zaměřování (stejný princip jako protínání)
            'body.agrf-clean #ar-overlay{opacity:0!important;pointer-events:none!important;}',
            'body.agrf-clean #ar-hud{display:none!important;}',
            'body.agrf-clean #camera-container{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;display:block!important;flex:1 1 auto!important;z-index:100040!important;}',
            'body.agrf-clean #map-container,body.agrf-clean #resizer{display:none!important;}',
            '#agrf-aim{position:fixed;inset:0;z-index:100050;display:none;pointer-events:none;}',
            '#agrf-aim.on{display:block;}',
            '#agrf-readout{position:absolute;top:max(18px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);min-width:160px;text-align:center;',
            '  background:rgba(8,12,16,0.82);padding:10px 18px;border-radius:14px;pointer-events:none;}',
            '#agrf-d{font:800 32px/1 var(--font-mono,monospace);color:#34d399;}',
            '#agrf-sub{margin-top:4px;font:600 12px/1.4 var(--font,system-ui),sans-serif;color:#cbd5e1;}',
            '#agrf-cross{position:absolute;top:50%;left:50%;width:108px;height:108px;margin:-54px 0 0 -54px;pointer-events:none;}',
            '#agrf-cross svg{width:100%;height:100%;filter:drop-shadow(0 0 4px rgba(0,0,0,0.7));}',
            '#agrf-hint{position:absolute;top:calc(50% + 64px);left:50%;transform:translateX(-50%);background:rgba(8,12,16,0.7);color:#e2e8f0;',
            '  padding:5px 12px;border-radius:8px;font:600 12.5px/1.2 var(--font,system-ui),sans-serif;white-space:nowrap;pointer-events:none;}',
            '#agrf-btns{position:absolute;left:0;right:0;bottom:max(24px,env(safe-area-inset-bottom));display:flex;gap:10px;justify-content:center;flex-wrap:wrap;pointer-events:auto;padding:0 16px;}',
            '#agrf-btns .btn{width:auto;flex:0 0 auto;min-width:120px;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- registrace do launcheru + fallback ------------------------------------
    function register() {
        injectStyles();
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'rangefinder', label: 'Optický dálkoměr', icon: ICON, onClick: openTool, order: 8 });
        } else {
            ensureFallbackFab();
        }
    }
    function ensureFallbackFab() {
        if (document.getElementById('agrf-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'agrf-fab'; b.type = 'button';
        b.title = 'Optický dálkoměr'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:268px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#34d399);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        b.querySelector('svg').style.cssText = 'width:24px;height:24px;';
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
