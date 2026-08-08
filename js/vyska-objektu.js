// ===== AR Geodet — VÝŠKA OBJEKTU (trigonometricky) (ODPOJITELNÁ vrstva) ========
// Určení výšky stožáru, komína, stromu, budovy… BEZ totálky: telefonem se zaměří
// PATA a VRCHOL objektu (svislé úhly ze senzorů), vodorovná vzdálenost se buď
// spočte ze záměru na patu (rovná zem, jako optický dálkoměr), nebo zadá ručně:
//
//        H = d · (tan α_vrchol − tan α_pata)
//
// Sklon kamery bere z window._arProj.pitch (AR projekce v grafika.js, kladně POD
// horizont, včetně kompenzace náklonu do strany). Pro potlačení třesu ruky se při
// „Zaměřit" bere MEDIÁN posledních vzorků.
//
// POCTIVĚ: orientační pomůcka (±, roste s dálkou a u paty blízko horizontu) —
// typicky decimetry až ~1 m. Ne náhrada měření.
//
// Vstup: dlaždice „Výška objektu" v Nástrojích (js/field-tools.js).
// Odstranění: smaž js/vyska-objektu.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M4 21h16"/><path d="M7 21V8l5-4 5 4v13" opacity="0.85"/>'
        + '<path d="M20 4v13M20 4l-2 2M20 4l2 2M20 17l-2-2M20 17l2-2" transform="translate(-1 0)"/></svg>';

    var LS_H = 'agRangeH';          // sdílené s optickým dálkoměrem: výška telefonu nad zemí (m)
    var DELTA_DEG = 1.0;            // typický rozkmit držení telefonu (pro odhad ±)
    var _height = loadHeight();
    var _dManual = null;            // ručně zadaná vodorovná vzdálenost (m), null = z paty
    var _step = 1;                  // 1 = pata, 2 = vrchol, 3 = výsledek
    var _pBase = null;              // zaměřený pitch paty (kladně pod horizont)
    var _pTop = null;
    var _buf = [];                  // posledních pár vzorků pitche (medián proti třesu)
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

    function agAlertX(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }
    function curViewMode() { try { return (typeof viewMode !== 'undefined') ? viewMode : 'both'; } catch (e) { return 'both'; } }
    function rad(d) { return d * Math.PI / 180; }
    function pitchNow() {
        try { var p = window._arProj && window._arProj.pitch; return (typeof p === 'number' && isFinite(p)) ? p : null; } catch (e) { return null; }
    }
    // medián posledních vzorků — robustní proti třesu ruky při klepnutí
    function pitchStable() {
        if (!_buf.length) return pitchNow();
        var a = _buf.slice().sort(function (x, y) { return x - y; });
        return a[Math.floor(a.length / 2)];
    }

    // jádro: výška z pitche paty a vrcholu (kladně POD horizont); d ručně, nebo z paty
    function heightAt(pB, pT, dManual) {
        var d = dManual;
        if (d == null) {
            if (pB <= 0.5) return null;                       // pata u horizontu → d nespočteme
            d = _height / Math.tan(rad(pB));
        }
        return { H: d * (Math.tan(rad(-pT)) - Math.tan(rad(-pB))), d: d };
    }
    function computeResult() {
        var r = heightAt(_pBase, _pTop, _dManual);
        if (!r) return { err: 'Pata je moc blízko horizontu — zadej vzdálenost ručně, nebo jdi blíž.' };
        if (r.H <= 0) return { err: 'Vrchol vyšel níž než pata — zaměř znovu (1. pata dole, 2. vrchol nahoře).' };
        // poctivý odhad ±: oba úhly rozkmitané o DELTA proti sobě (u auto-d se promítne i do d)
        var lo = r.H, hi = r.H;
        [[+1, -1], [-1, +1]].forEach(function (s) {
            var pB = _pBase + s[0] * DELTA_DEG, pT = _pTop + s[1] * DELTA_DEG;
            if (_dManual == null) pB = Math.max(0.3, pB);
            var v = heightAt(pB, pT, _dManual);
            if (v && isFinite(v.H)) { lo = Math.min(lo, v.H); hi = Math.max(hi, v.H); }
        });
        var err = Math.max(r.H - lo, hi - r.H);
        var q = 'good';
        if (_dManual == null && _pBase < 6) q = 'bad';        // malý úhel na patu → d velmi nejisté
        else if (err > 1.5) q = 'bad';
        else if (err > 0.6) q = 'ok';
        return { H: r.H, d: r.d, err: err, q: q };
    }

    function fmtM(v, dec) {
        if (v == null || !isFinite(v)) return '—';
        return v.toFixed(dec != null ? dec : (v >= 100 ? 0 : v >= 10 ? 1 : 2)) + ' m';
    }

    // ---- aiming overlay (přes kameru, vzor rangefinder) ---------------------------
    function declutter(on) {
        document.body.classList.toggle('agvo-clean', !!on);
        if (!on) { try { if (typeof applyViewMode === 'function') applyViewMode(); } catch (e) {} }
    }
    function ensureAim() {
        if (document.getElementById('agvo-aim')) return;
        var a = document.createElement('div');
        a.id = 'agvo-aim';
        a.innerHTML =
            '<div id="agvo-readout"><div id="agvo-step"></div><div id="agvo-v">—</div><div id="agvo-sub"></div></div>'
            + '<div id="agvo-cross"><svg viewBox="0 0 100 100">'
            + '<line x1="50" y1="8" x2="50" y2="38" stroke="#4da3ff" stroke-width="2"/><line x1="50" y1="62" x2="50" y2="92" stroke="#4da3ff" stroke-width="2"/>'
            + '<line x1="8" y1="50" x2="38" y2="50" stroke="#4da3ff" stroke-width="2"/><line x1="62" y1="50" x2="92" y2="50" stroke="#4da3ff" stroke-width="2"/>'
            + '<circle cx="50" cy="50" r="3" fill="#4da3ff"/></svg></div>'
            + '<div id="agvo-hint"></div>'
            + '<div id="agvo-btns">'
            + '  <button id="agvo-shot" class="btn">Zaměřit patu</button>'
            + '  <button id="agvo-redo" class="btn btn-secondary" style="display:none;">Znovu</button>'
            + '  <button id="agvo-copy" class="btn btn-secondary" style="display:none;">Kopírovat</button>'
            + '  <button id="agvo-cancel" class="btn btn-secondary">Zavřít</button>'
            + '</div>';
        document.body.appendChild(a);
        document.getElementById('agvo-shot').addEventListener('click', capture);
        document.getElementById('agvo-redo').addEventListener('click', restart);
        document.getElementById('agvo-copy').addEventListener('click', copyResult);
        document.getElementById('agvo-cancel').addEventListener('click', closeAim);
    }
    function showAim(on) { ensureAim(); document.getElementById('agvo-aim').classList.toggle('on', !!on); }

    function setStepUI() {
        var st = document.getElementById('agvo-step'), hint = document.getElementById('agvo-hint');
        var shot = document.getElementById('agvo-shot'), redo = document.getElementById('agvo-redo'), copy = document.getElementById('agvo-copy');
        if (!st) return;
        copy.style.display = 'none';
        if (_step === 1) {
            st.innerText = 'KROK 1 / 2 — PATA';
            hint.innerHTML = _dManual != null
                ? 'Zaměř kříž na <b>patu objektu</b> (vzdálenost ' + fmtM(_dManual) + ' zadána ručně)'
                : 'Zaměř kříž na <b>patu objektu</b> (kde stojí na zemi)';
            shot.innerText = 'Zaměřit patu'; shot.style.display = 'inline-flex'; redo.style.display = 'none';
        } else if (_step === 2) {
            st.innerText = 'KROK 2 / 2 — VRCHOL';
            hint.innerHTML = 'Teď zaměř kříž na <b>vrchol objektu</b>';
            shot.innerText = 'Zaměřit vrchol'; shot.style.display = 'inline-flex'; redo.style.display = 'inline-flex';
        } else {
            st.innerText = 'VÝSLEDEK';
            hint.innerHTML = 'Hotovo — „Znovu" pro další objekt';
            shot.style.display = 'none'; redo.style.display = 'inline-flex'; copy.style.display = 'inline-flex';
        }
    }

    function renderLive() {
        var vEl = document.getElementById('agvo-v'), subEl = document.getElementById('agvo-sub');
        if (!vEl || _step === 3) return;
        var p = pitchNow();
        if (p != null) { _buf.push(p); if (_buf.length > 6) _buf.shift(); }
        if (p == null) {
            vEl.style.color = '#cbd5e1'; vEl.innerText = '…';
            subEl.innerHTML = 'čekám na senzory — musí běžet AR kamera';
            return;
        }
        if (_step === 1) {
            vEl.style.color = '#cbd5e1';
            vEl.innerText = (-p).toFixed(1) + '°';
            var dPrev = (_dManual == null && p > 0.5) ? ' · vzdálenost ~' + fmtM(_height / Math.tan(rad(p))) : '';
            subEl.innerHTML = 'svislý úhel' + dPrev;
        } else {
            // živý náhled výšky, dokud vrchol nezaměříš
            var r = heightAt(_pBase, p, _dManual);
            if (r && r.H > 0) { vEl.style.color = '#4da3ff'; vEl.innerText = fmtM(r.H); subEl.innerHTML = 'náhled výšky · úhel ' + (-p).toFixed(1) + '°'; }
            else { vEl.style.color = '#cbd5e1'; vEl.innerText = (-p).toFixed(1) + '°'; subEl.innerHTML = 'miř NAD zaměřenou patu'; }
        }
    }

    function capture() {
        var p = pitchStable();
        if (p == null) { agAlertX('Čekám na senzory', 'Zapni AR/Split režim (kamera) a podrž telefon — potřebuji náklon.'); return; }
        if (navigator.vibrate) { try { navigator.vibrate(25); } catch (e) {} }
        if (_step === 1) {
            if (_dManual == null && p <= 0.5) { agAlertX('Pata u horizontu', 'Z tohohle úhlu vzdálenost nespočtu. Jdi blíž, nebo v nastavení zadej vzdálenost ručně.'); return; }
            _pBase = p; _step = 2; setStepUI();
            return;
        }
        if (_step === 2) {
            _pTop = p;
            var r = computeResult();
            if (r.err) { agAlertX('Nelze spočítat', r.err); return; }
            _step = 3; setStepUI();
            var vEl = document.getElementById('agvo-v'), subEl = document.getElementById('agvo-sub');
            var col = r.q === 'good' ? '#34d399' : (r.q === 'ok' ? '#fbbf24' : '#f87171');
            vEl.style.color = col;
            vEl.innerText = fmtM(r.H);
            subEl.innerHTML = '± ' + fmtM(r.err) + ' &nbsp;·&nbsp; vzdálenost ' + fmtM(r.d) + (_dManual != null ? ' (ručně)' : '')
                + '<br><span style="opacity:.8">pata ' + (-_pBase).toFixed(1) + '° · vrchol ' + (-_pTop).toFixed(1) + '° · výška telefonu ' + _height.toFixed(2) + ' m</span>'
                + (r.q === 'bad' ? '<br><span style="color:#f87171">velká nejistota — jdi blíž, nebo zadej vzdálenost ručně</span>' : '');
        }
    }
    function restart() { _step = 1; _pBase = null; _pTop = null; _buf = []; setStepUI(); renderLive(); }
    function copyResult() {
        var r = computeResult();
        if (r.err) return;
        var txt = 'Výška objektu: ' + fmtM(r.H) + ' ± ' + fmtM(r.err) + ' (vzdálenost ' + fmtM(r.d) + ', trigonometricky z mobilu)';
        try { navigator.clipboard.writeText(txt).then(function () { toast('Zkopírováno.'); }, function () { toast('Kopírování se nepovedlo.'); }); }
        catch (e) { toast('Kopírování se nepovedlo.'); }
    }

    function startAim() {
        if (curViewMode() === 'map') { agAlertX('Zapni kameru', 'Přepni zobrazení na AR nebo Split — měří se přes kameru.'); return; }
        var modal = document.getElementById('agvo-modal'); if (modal) modal.style.display = 'none';
        // ruční vzdálenost z formuláře
        var dEl = document.getElementById('agvo-dist');
        var dv = dEl ? parseFloat(String(dEl.value).replace(',', '.')) : NaN;
        _dManual = (isFinite(dv) && dv > 0) ? dv : null;
        restart();
        declutter(true); showAim(true); setStepUI();
        if (!_poll) _poll = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(renderLive, 120);
    }
    function closeAim() {
        if (_poll) { (window.AG && AG.clearUiInterval ? AG.clearUiInterval : clearInterval)(_poll); _poll = null; }
        showAim(false); declutter(false);
    }

    // ---- nastavovací modal -----------------------------------------------------
    function ensureModal() {
        if (document.getElementById('agvo-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agvo-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Výška objektu</h3>'
            + '<p style="font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.82;margin:2px 0 12px;line-height:1.45;">Trigonometrické určení výšky stožáru, komína, stromu… '
            + 'Zaměříš křížem <b>patu</b> a pak <b>vrchol</b>; vzdálenost se spočte ze záměru na patu (rovná zem), nebo ji zadej ručně (krokování, pásmo, dálkoměr). <b>Orientační</b> — typicky ± decimetry až metr.</p>'
            + '<label class="agvo-fld"><span>Výška telefonu nad zemí (m)</span>'
            + '<input type="number" id="agvo-h" step="0.05" min="0.3" max="3" inputmode="decimal"></label>'
            + '<div class="agvo-hrow">'
            + '  <button type="button" class="agvo-chip" data-h="1.5">1,5 (ruka)</button>'
            + '  <button type="button" class="agvo-chip" data-h="1.6">1,6 (oči)</button>'
            + '  <button type="button" class="agvo-chip" data-h="1.7">1,7</button>'
            + '</div>'
            + '<label class="agvo-fld"><span>Vodorovná vzdálenost k objektu (m) — nech prázdné pro výpočet ze záměru na patu</span>'
            + '<input type="number" id="agvo-dist" step="0.1" min="1" inputmode="decimal" placeholder="auto z paty"></label>'
            + '<button class="btn" id="agvo-go"><svg class="icon"><use href="#i-crosshair"/></svg> Spustit zaměřování</button>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" onclick="window.agCloseVyskaObjektu&&window.agCloseVyskaObjektu()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        var hInp = document.getElementById('agvo-h');
        hInp.value = _height.toFixed(2);
        hInp.addEventListener('change', function () {
            var v = parseFloat(hInp.value);
            if (isFinite(v) && v >= 0.3 && v <= 3) { _height = Math.round(v * 100) / 100; saveHeight(); }
            else { hInp.value = _height.toFixed(2); }
        });
        Array.prototype.forEach.call(el.querySelectorAll('.agvo-chip'), function (c) {
            c.addEventListener('click', function () { _height = parseFloat(c.getAttribute('data-h')); saveHeight(); hInp.value = _height.toFixed(2); });
        });
        document.getElementById('agvo-go').addEventListener('click', startAim);
    }

    function openTool() { ensureModal(); injectStyles(); document.getElementById('agvo-h').value = _height.toFixed(2); document.getElementById('agvo-modal').style.display = 'flex'; }
    window.agCloseVyskaObjektu = function () { var m = document.getElementById('agvo-modal'); if (m) m.style.display = 'none'; closeAim(); };
    window.agOpenVyskaObjektu = openTool;

    // ---- styly -----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('agvo-style')) return;
        var st = document.createElement('style'); st.id = 'agvo-style';
        st.textContent = [
            '#agvo-modal .agvo-fld{display:block;margin:8px 0 4px;}',
            '#agvo-modal .agvo-fld>span{display:block;font-size:calc(12px * var(--ag-font-scale, 1));opacity:.75;margin-bottom:3px;line-height:1.35;}',
            '#agvo-modal .agvo-fld input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:10px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.05);color:var(--text-color,#e8edf2);font:600 16px/1.1 var(--font-ui,system-ui),sans-serif;}',
            '#agvo-modal .agvo-hrow{display:flex;gap:8px;margin:6px 0 8px;}',
            '#agvo-modal .agvo-chip{flex:1;padding:7px 4px;border-radius:9px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:rgba(255,255,255,0.04);color:var(--text-color,#e8edf2);font:600 12px/1 var(--font-ui,system-ui),sans-serif;}',
            // vyčištěná obrazovka během zaměřování (stejný princip jako dálkoměr)
            'body.agvo-clean #ar-overlay{opacity:0!important;pointer-events:none!important;}',
            'body.agvo-clean #ar-hud{display:none!important;}',
            'body.agvo-clean #camera-container{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;display:block!important;flex:1 1 auto!important;z-index:100040!important;}',
            'body.agvo-clean #map-container,body.agvo-clean #resizer{display:none!important;}',
            '#agvo-aim{position:fixed;inset:0;z-index:100050;display:none;pointer-events:none;}',
            '#agvo-aim.on{display:block;}',
            '#agvo-readout{position:absolute;top:max(18px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);min-width:180px;text-align:center;',
            '  background:rgba(8,12,16,0.82);padding:10px 18px;border-radius:14px;pointer-events:none;}',
            '#agvo-step{font:700 11px/1 var(--font-ui,system-ui),sans-serif;color:#94a3b8;letter-spacing:0.08em;margin-bottom:5px;}',
            '#agvo-v{font:800 32px/1 var(--font-mono,monospace);color:#4da3ff;}',
            '#agvo-sub{margin-top:4px;font:600 12px/1.4 var(--font-ui,system-ui),sans-serif;color:#cbd5e1;}',
            '#agvo-cross{position:absolute;top:50%;left:50%;width:108px;height:108px;margin:-54px 0 0 -54px;pointer-events:none;}',
            '#agvo-cross svg{width:100%;height:100%;filter:drop-shadow(0 0 4px rgba(0,0,0,0.7));}',
            '#agvo-hint{position:absolute;top:calc(50% + 64px);left:50%;transform:translateX(-50%);background:rgba(8,12,16,0.7);color:#e2e8f0;',
            '  padding:5px 12px;border-radius:8px;font:600 12.5px/1.2 var(--font-ui,system-ui),sans-serif;white-space:nowrap;pointer-events:none;}',
            '#agvo-btns{position:absolute;left:0;right:0;bottom:max(24px,env(safe-area-inset-bottom));display:flex;gap:10px;justify-content:center;flex-wrap:wrap;pointer-events:auto;padding:0 16px;}',
            '#agvo-btns .btn{width:auto;flex:0 0 auto;min-width:110px;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- registrace do launcheru -------------------------------------------------
    function register() {
        injectStyles();
        if (typeof window.agRegisterFieldTool !== 'function') return;
        window.agRegisterFieldTool({ id: 'vyska-objektu', label: 'Výška objektu', icon: ICON, onClick: openTool, order: 9 });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
