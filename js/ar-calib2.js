// ===== AR Geodet — SROVNAT AR NA 2 BODY: sever + šířka záběru (ODPOJITELNÁ) =====
// Neinvazivní vrstva ve stylu js/ar-calibrate.js: NEEDITUJE logika.js ani grafika.js,
// jen za běhu čte globály a sahá na existující „páky" appky:
//   • SEVER  → nudgeHeadingOffset() / userHeadingOffset (+ setStoredData('arHeadingOffset'))
//   • FOV    → visSettings.fovH (+ setStoredData('arVisSettings12')); AR render čte fovH
//              každý snímek, takže posuvník ladí obraz živě.
//
// PROČ: původní účel appky je najít bod v terénu, jenže AR má dvě systematické slabiny —
// (1) na Androidu bývá kompas relativní (sever o desítky ° vedle) a (2) zorný úhel kamery
// (FOV) je zadaný ručně jako konstanta → body čím dál od středu ujíždějí do stran.
// Tento nástroj je srovná NA DVOU ZNÁMÝCH BODECH v jednom průchodu:
//   Krok 1+2: zacíl kříž na bod A, pak na bod B → z obou se spočítá a zprůměruje korekce
//             SEVERU (robustnější než z jednoho bodu) + diagnostika nelinearity kompasu.
//   Krok 3:   posuvníkem „šířka záběru" srovnáš značky A i B na skutečné body → FOV.
//
// Míření a matiku přebírá ze stejných globálů jako ar-calibrate.js (currentHeading,
// getBearing, getDistance, angDiff). Vlastní modal + styly (žádná závislost na CSS).
//
// Odstranění: smaž js/ar-calib2.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var D2R = Math.PI / 180, R2D = 180 / Math.PI;
    var STYLE_ID = 'ag-c2-style';
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        // DVA body a spojnice — usadit-ar.js (průvodce) měl skoro totožný terč,
        // takže se v seznamu úkonů nedaly odlišit očima.
        + '<circle cx="5" cy="18" r="2.3"/><circle cx="19" cy="6" r="2.3"/><path d="M6.7 16.3 17.3 7.7"/></svg>';

    // ---- stav ------------------------------------------------------------------
    var _aId = null, _bId = null;
    var _shot = { A: null, B: null };   // {h: prům. heading telefonu, b: azimut na bod}
    var _appliedNorth = null;           // aplikovaná korekce severu (pro Undo)
    var _fovBefore = null;              // původní fovH (pro Zpět v kroku FOV)
    var _capTimer = null, _capSamples = [];

    // ---- helpery (čtou globály obezřetně) --------------------------------------
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function heading() { return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; }
    function brg(lat, lng) { try { return getBearing(userLat, userLng, lat, lng); } catch (e) { return null; } }
    function dist(lat, lng) { try { return getDistance(userLat, userLng, lat, lng); } catch (e) { return null; } }
    function adiff(a, b) { try { if (typeof angDiff === 'function') return angDiff(a, b); } catch (e) {} return ((a - b + 540) % 360) - 180; }
    function circMean(arr) { var s = 0, c = 0; arr.forEach(function (a) { s += Math.sin(a * D2R); c += Math.cos(a * D2R); }); return (Math.atan2(s, c) * R2D + 360) % 360; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

    function allPoints() {
        var out = [];
        try { if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) out = arPoints.filter(function (p) { return p && !p.hidden && typeof p.lat === 'number' && typeof p.lng === 'number'; }); } catch (e) {}
        return out;
    }
    function ptById(id) { return allPoints().find(function (q) { return q.id === id; }) || null; }
    function nearby() {
        if (!haveUser()) return [];
        return allPoints().map(function (p) { return { p: p, d: dist(p.lat, p.lng) }; })
            .filter(function (x) { return x.d != null && isFinite(x.d); })
            .sort(function (a, b) { return a.d - b.d; }).slice(0, 40);
    }

    // ---- styly -----------------------------------------------------------------
    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style'); st.id = STYLE_ID;
        st.textContent =
            '#agc2-modal{position:fixed;inset:0;z-index:9200;display:none;align-items:center;justify-content:center;background:rgba(6,8,12,0.72);padding:16px;box-sizing:border-box}'
            + '#agc2-modal.on{display:flex}'
            + '#agc2-card{width:100%;max-width:440px;max-height:calc(var(--app-vh, 100dvh) * 0.88);overflow:auto;background:#12151c;color:#eef2f7;border:1px solid rgba(255,255,255,0.12);border-radius:18px;padding:18px;box-sizing:border-box;box-shadow:0 18px 50px rgba(0,0,0,0.5)}'
            + '#agc2-card h3{margin:0 0 6px;font-size:calc(18px * var(--ag-font-scale, 1))}'
            + '.agc2-dim{opacity:0.7;font-size:calc(12.5px * var(--ag-font-scale, 1));line-height:1.45}'
            + '.agc2-row{display:flex;gap:8px;margin-top:10px}'
            + '.agc2-sel{flex:1;min-width:0}'
            + '.agc2-sel label{display:block;font-size:calc(11px * var(--ag-font-scale, 1));opacity:0.65;margin:0 0 3px 2px}'
            + '.agc2-sel select{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;background:#1c212b;color:#fff;border:1px solid rgba(255,255,255,0.15);font-size:calc(14px * var(--ag-font-scale, 1))}'
            + '.agc2-btns{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}'
            + '.agc2-btns .btn{flex:1;min-width:120px}'
            + '#agc2-aim{position:fixed;inset:0;z-index:9300;display:none;flex-direction:column;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top,0px) + 16px) 16px calc(env(safe-area-inset-bottom,0px) + 18px);pointer-events:none}'
            + '#agc2-aim.on{display:flex}'
            + '#agc2-aim .agc2-top,#agc2-aim .agc2-bot{pointer-events:auto;width:100%;max-width:460px}'
            + '#agc2-aim .agc2-top{background:rgba(10,12,16,0.82);border:1px solid rgba(255,255,255,0.14);border-radius:12px;padding:11px 13px;text-align:center;font-size:calc(14px * var(--ag-font-scale, 1))}'
            + '#agc2-cross{position:absolute;top:50%;left:50%;width:96px;height:96px;transform:translate(-50%,-50%);pointer-events:none}'
            + '#agc2-cross svg{width:100%;height:100%}'
            + '#agc2-prog{height:4px;background:#22c55e;width:0;border-radius:3px;margin-top:8px;transition:width .06s linear}'
            + '.agc2-bot{display:flex;gap:8px}'
            + '.agc2-bot .btn{flex:1}'
            + '#agc2-fov{position:fixed;inset:0;z-index:9300;display:none;flex-direction:column;justify-content:space-between;padding:calc(env(safe-area-inset-top,0px) + 14px) 14px calc(env(safe-area-inset-bottom,0px) + 16px);pointer-events:none}'
            + '#agc2-fov.on{display:flex}'
            + '#agc2-fov .agc2-top,#agc2-fov .agc2-fbar{pointer-events:auto;width:100%;max-width:480px;margin:0 auto}'
            + '#agc2-fov .agc2-top{background:rgba(10,12,16,0.82);border:1px solid rgba(255,255,255,0.14);border-radius:12px;padding:10px 13px;text-align:center;font-size:calc(13.5px * var(--ag-font-scale, 1))}'
            + '.agc2-fbar{background:rgba(10,12,16,0.9);border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:12px 14px}'
            + '.agc2-fbar .agc2-fval{text-align:center;font-size:calc(15px * var(--ag-font-scale, 1));font-weight:700;margin-bottom:8px}'
            + '.agc2-fbar .agc2-fctl{display:flex;align-items:center;gap:10px}'
            + '.agc2-fbar input[type=range]{flex:1;min-width:0}'
            + '.agc2-fbar .agc2-step{flex:0 0 auto;width:44px;height:44px;border-radius:11px;border:1px solid rgba(255,255,255,0.2);background:#1c212b;color:#fff;font-size:calc(22px * var(--ag-font-scale, 1));line-height:1;cursor:pointer}'
            + '.agc2-fbar .agc2-fbtns{display:flex;gap:8px;margin-top:10px}'
            + '.agc2-fbar .agc2-fbtns .btn{flex:1}';
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- hlavní modal (výběr A/B) ----------------------------------------------
    function ensureModal() {
        injectStyle();
        var m = document.getElementById('agc2-modal');
        if (m) return m;
        m = document.createElement('div'); m.id = 'agc2-modal';
        m.innerHTML =
            '<div id="agc2-card">'
            + '<h3>Srovnat AR na 2 body</h3>'
            + '<p class="agc2-dim">Vyber dva body, které v terénu bezpečně vidíš (ideálně dál od sebe). Zacílíš na ně kříž — appka srovná <b>sever</b>, pak posuvníkem srovnáš <b>šířku záběru</b>, aby značky seděly.</p>'
            + '<div class="agc2-row">'
            + '<div class="agc2-sel"><label>Bod A</label><select id="agc2-a"></select></div>'
            + '<div class="agc2-sel"><label>Bod B</label><select id="agc2-b"></select></div>'
            + '</div>'
            + '<p class="agc2-dim" id="agc2-hint" style="margin-top:8px"></p>'
            + '<div class="agc2-btns">'
            + '<button class="btn" id="agc2-start">Začít srovnání</button>'
            + '<button class="btn btn-secondary" id="agc2-close">Zavřít</button>'
            + '</div>'
            + '<div class="agc2-btns" style="margin-top:8px">'
            + '<button class="btn btn-secondary" id="agc2-undo" style="display:none">Vrátit poslední srovnání severu</button>'
            + '</div>'
            + '</div>';
        document.body.appendChild(m);
        m.addEventListener('click', function (e) { if (e.target === m) hideModal(); });
        document.getElementById('agc2-close').addEventListener('click', hideModal);
        document.getElementById('agc2-start').addEventListener('click', startFlow);
        document.getElementById('agc2-undo').addEventListener('click', undoNorth);
        document.getElementById('agc2-a').addEventListener('change', function () { _aId = this.value; updateHint(); });
        document.getElementById('agc2-b').addEventListener('change', function () { _bId = this.value; updateHint(); });
        return m;
    }

    function fillSelects() {
        var list = nearby();
        var selA = document.getElementById('agc2-a'), selB = document.getElementById('agc2-b');
        if (!selA || !selB) return;
        var opts = list.map(function (x) { return '<option value="' + esc(x.p.id) + '">#' + esc(x.p.name || 'Bod') + ' · ' + x.d.toFixed(0) + ' m</option>'; }).join('');
        selA.innerHTML = opts; selB.innerHTML = opts;
        // předvyplň: A = zvýrazněný bod, B = nejvzdálenější z prvních (lepší základna)
        var preA = null;
        try { if (typeof highlightedPointId !== 'undefined' && highlightedPointId != null && list.some(function (x) { return x.p.id === highlightedPointId; })) preA = highlightedPointId; } catch (e) {}
        if (!preA && list.length) preA = list[0].p.id;
        _aId = preA;
        // B = nejvzdálenější viditelný, jiný než A
        var far = list.slice().reverse().find(function (x) { return x.p.id !== _aId; });
        _bId = far ? far.p.id : (list[1] ? list[1].p.id : null);
        if (_aId) selA.value = _aId;
        if (_bId) selB.value = _bId;
        updateHint();
    }

    function updateHint() {
        var h = document.getElementById('agc2-hint'); if (!h) return;
        if (!haveUser()) { h.innerHTML = '⚠ Zatím nemám GPS polohu — počkej na fix.'; return; }
        if (heading() == null) { h.innerHTML = '⚠ Kompas zatím nedává směr — podrž telefon svisle.'; return; }
        if (!_aId || !_bId) { h.innerHTML = 'Vyber body A a B.'; return; }
        if (_aId === _bId) { h.innerHTML = '⚠ A a B musí být různé body.'; return; }
        var a = ptById(_aId), b = ptById(_bId);
        if (!a || !b) { h.innerHTML = ''; return; }
        var sep = Math.abs(adiff(brg(a.lat, a.lng), brg(b.lat, b.lng)));
        h.innerHTML = 'Úhlová základna A–B: <b>' + sep.toFixed(0) + '°</b>. '
            + (sep < 15 ? 'Body jsou skoro v jednom směru — vyber vzdálenější dvojici, srovnání FOV pak bude přesnější.' : 'Dobrá základna.');
    }

    function showModal() {
        if (!haveUser()) { agAlert('Chybí poloha', 'Počkej, až appka najde GPS polohu, a zkus to znovu.'); return; }
        if (allPoints().length < 2) { agAlert('Málo bodů', 'Potřebuješ v zakázce aspoň dva viditelné body, na které je vidět v terénu.'); return; }
        ensureModal(); fillSelects();
        document.getElementById('agc2-undo').style.display = (_appliedNorth != null) ? 'block' : 'none';
        document.getElementById('agc2-modal').classList.add('on');
    }
    function hideModal() { var m = document.getElementById('agc2-modal'); if (m) m.classList.remove('on'); }

    // ---- zaměřovací overlay (krok 1 a 2) ---------------------------------------
    function ensureAim() {
        if (document.getElementById('agc2-aim')) return;
        var a = document.createElement('div'); a.id = 'agc2-aim';
        a.innerHTML =
            '<div class="agc2-top" id="agc2-aim-txt"></div>'
            + '<div id="agc2-cross"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="none" stroke="#34d399" stroke-width="2"/>'
            + '<path d="M50 8v26M50 66v26M8 50h26M66 50h26" stroke="#34d399" stroke-width="2"/><circle cx="50" cy="50" r="2.5" fill="#34d399"/></svg></div>'
            + '<div class="agc2-bot"><button class="btn" id="agc2-hold">Podrž a srovnej</button>'
            + '<button class="btn btn-secondary" id="agc2-aim-cancel">Zrušit</button>'
            + '<div id="agc2-prog"></div></div>';
        // progress bar chceme pod tlačítka → přesuň
        document.body.appendChild(a);
        var bot = a.querySelector('.agc2-bot'); var prog = a.querySelector('#agc2-prog');
        bot.parentNode.insertBefore(prog, bot.nextSibling);
        document.getElementById('agc2-hold').addEventListener('click', capture);
        document.getElementById('agc2-aim-cancel').addEventListener('click', cancelAim);
    }
    function showAim(on) { ensureAim(); document.getElementById('agc2-aim').classList.toggle('on', !!on); }

    var _aimTarget = 'A';
    function startFlow() {
        if (!_aId || !_bId || _aId === _bId) { agAlert('Vyber body', 'Zvol dva různé body A a B.'); return; }
        if (heading() == null) { agAlert('Bez směru', 'Kompas zatím nedává směr. Podrž telefon svisle a zkus to znovu.'); return; }
        _shot.A = _shot.B = null;
        hideModal(); aimStep('A');
    }
    function aimStep(which) {
        _aimTarget = which;
        var pt = ptById(which === 'A' ? _aId : _bId);
        if (!pt) { agAlert('Chyba', 'Bod zmizel ze seznamu.'); return; }
        showAim(true);
        var d = dist(pt.lat, pt.lng);
        var txt = document.getElementById('agc2-aim-txt');
        if (txt) txt.innerHTML = 'Krok ' + (which === 'A' ? '1' : '2') + '/2 — namiř střed kříže přesně na <b>#' + esc(pt.name || 'Bod') + '</b>'
            + (d != null ? ' · ' + d.toFixed(0) + ' m' : '') + '<br><span class="agc2-dim">drž telefon svisle a klepni „Podrž a srovnej"</span>';
        var hb = document.getElementById('agc2-hold'); if (hb) { hb.disabled = false; hb.innerText = 'Podrž a srovnej'; }
        var pr = document.getElementById('agc2-prog'); if (pr) pr.style.width = '0%';
    }

    function capture() {
        if (heading() == null) { toast('Kompas nedává směr'); return; }
        var hb = document.getElementById('agc2-hold'); if (hb) hb.disabled = true;
        _capSamples = [];
        var dur = 1100, step = 90, t0 = 0;
        var pr = document.getElementById('agc2-prog');
        if (_capTimer) clearInterval(_capTimer);
        _capTimer = setInterval(function () {
            var h = heading(); if (h != null) _capSamples.push(h);
            t0 += step; if (pr) pr.style.width = Math.min(100, (t0 / dur) * 100) + '%';
            if (t0 >= dur) {
                clearInterval(_capTimer); _capTimer = null; if (pr) pr.style.width = '0%';
                if (!_capSamples.length) { if (hb) hb.disabled = false; toast('Nezachyceno — zkus znovu'); return; }
                finalizeShot();
            }
        }, step);
    }

    function finalizeShot() {
        var pt = ptById(_aimTarget === 'A' ? _aId : _bId);
        if (!pt || !haveUser()) { cancelAim(); return; }
        var hMean = circMean(_capSamples);
        var b = brg(pt.lat, pt.lng);
        if (b == null) { cancelAim(); return; }
        _shot[_aimTarget] = { h: hMean, b: b, n: _capSamples.length };
        if (navigator.vibrate) { try { navigator.vibrate(25); } catch (e) {} }
        if (_aimTarget === 'A') { aimStep('B'); }
        else { showAim(false); applyNorth(); }
    }

    function cancelAim() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        showAim(false);
        document.getElementById('agc2-modal').classList.add('on');
    }

    // ---- výpočet a aplikace SEVERU ---------------------------------------------
    function applyNorth() {
        var A = _shot.A, B = _shot.B;
        if (!A || !B) { toast('Chybí zaměření'); document.getElementById('agc2-modal').classList.add('on'); return; }
        var dA = adiff(A.b, A.h);   // potřebná korekce ze zaměření na A
        var dB = adiff(B.b, B.h);
        var meanDelta = circMeanDeltaDeg([dA, dB]);
        // diagnostika nelinearity kompasu: kolik se telefon otočil A→B vs. skutečná změna azimutu
        var rotDev = adiff(B.h, A.h), rotTrue = adiff(B.b, A.b);
        var gainMsg = '';
        if (Math.abs(rotTrue) > 20 && Math.abs(rotDev) > 5) {
            var gain = rotDev / rotTrue;
            if (isFinite(gain) && Math.abs(gain - 1) > 0.08) {
                gainMsg = '\n\n⚠ Kompas má nelinearitu (~' + Math.round((gain - 1) * 100) + ' %). Sever je srovnaný v průměru; nejlépe drží u bodů blízko směru, na který zrovna míříš.';
            }
        }
        var spread = Math.abs(adiff(dA, dB));
        if (applyDelta(meanDelta)) {
            _appliedNorth = (_appliedNorth || 0) + meanDelta;
            document.getElementById('agc2-modal').classList.add('on');
            var undo = document.getElementById('agc2-undo'); if (undo) undo.style.display = 'block';
            agAlert('Sever srovnán',
                'Sever srovnán podle #' + esc((ptById(_aId) || {}).name || 'A') + ' a #' + esc((ptById(_bId) || {}).name || 'B') + '.'
                + '\nPosun severu: <b>' + (meanDelta >= 0 ? '+' : '') + meanDelta.toFixed(1) + '°</b>'
                + '\nRozdíl mezi body: ' + spread.toFixed(1) + '° (menší = důvěryhodnější).'
                + gainMsg
                + '\n\nTeď můžeš doladit ŠÍŘKU ZÁBĚRU, ať značky sednou i dál od středu.');
            // nabídni krok FOV
            offerFov();
        } else {
            agAlert('Nelze srovnat', 'Korekce kompasu není v této verzi appky dostupná.');
            document.getElementById('agc2-modal').classList.add('on');
        }
    }

    // průměr malých úhlových korekcí (stupně, ~±180) přes sinus/kosinus
    function circMeanDeltaDeg(arr) {
        var s = 0, c = 0; arr.forEach(function (a) { s += Math.sin(a * D2R); c += Math.cos(a * D2R); });
        return Math.atan2(s, c) * R2D;
    }

    function applyDelta(delta) {
        if (!isFinite(delta)) return false;
        if (typeof nudgeHeadingOffset === 'function') { nudgeHeadingOffset(delta); return true; }
        if (typeof userHeadingOffset !== 'undefined') {
            try {
                userHeadingOffset = ((userHeadingOffset + delta) % 360 + 360) % 360;
                if (typeof setStoredData === 'function') setStoredData('arHeadingOffset', String(userHeadingOffset));
                if (typeof updateHeadingOffsetVal === 'function') updateHeadingOffsetVal();
                return true;
            } catch (e) {}
        }
        return false;
    }

    function undoNorth() {
        if (_appliedNorth == null) return;
        if (applyDelta(-_appliedNorth)) {
            _appliedNorth = null;
            var u = document.getElementById('agc2-undo'); if (u) u.style.display = 'none';
            toast('Srovnání severu vráceno');
        }
    }

    // ---- krok 3: FOV (živé ladění) ---------------------------------------------
    function offerFov() {
        // po zavření alertu (agAlert je nemodální nebo modální) otevři FOV overlay
        setTimeout(startFov, 50);
    }
    function fovVal() { try { return (typeof visSettings !== 'undefined' && visSettings && +visSettings.fovH) || 90; } catch (e) { return 90; } }
    function setFov(v) {
        v = Math.max(50, Math.min(110, Math.round(v)));
        try { if (typeof visSettings !== 'undefined' && visSettings) visSettings.fovH = v; } catch (e) {}
        var fv = document.getElementById('agc2-fov-val'); if (fv) fv.textContent = v + '°';
        var sl = document.getElementById('agc2-fov-slider'); if (sl && +sl.value !== v) sl.value = v;
        return v;
    }
    function ensureFov() {
        if (document.getElementById('agc2-fov')) return;
        var f = document.createElement('div'); f.id = 'agc2-fov';
        f.innerHTML =
            '<div class="agc2-top">Posuvníkem <b>šířka záběru</b> srovnej, aby značky <b>A</b> i <b>B</b> seděly na skutečných bodech. Nejlíp jde vidět na bodě dál od středu.</div>'
            + '<div class="agc2-fbar">'
            + '<div class="agc2-fval" id="agc2-fov-val">90°</div>'
            + '<div class="agc2-fctl">'
            + '<button class="agc2-step" id="agc2-fov-minus" aria-label="užší">−</button>'
            + '<input type="range" id="agc2-fov-slider" min="50" max="110" step="1">'
            + '<button class="agc2-step" id="agc2-fov-plus" aria-label="širší">+</button>'
            + '</div>'
            + '<div class="agc2-fbtns"><button class="btn" id="agc2-fov-save">Uložit</button>'
            + '<button class="btn btn-secondary" id="agc2-fov-cancel">Zpět (beze změny)</button></div>'
            + '</div>';
        document.body.appendChild(f);
        document.getElementById('agc2-fov-slider').addEventListener('input', function () { setFov(+this.value); });
        document.getElementById('agc2-fov-minus').addEventListener('click', function () { setFov(fovVal() - 1); });
        document.getElementById('agc2-fov-plus').addEventListener('click', function () { setFov(fovVal() + 1); });
        document.getElementById('agc2-fov-save').addEventListener('click', saveFov);
        document.getElementById('agc2-fov-cancel').addEventListener('click', cancelFov);
    }
    function startFov() {
        ensureFov();
        _fovBefore = fovVal();
        var sl = document.getElementById('agc2-fov-slider'); if (sl) sl.value = _fovBefore;
        setFov(_fovBefore);
        hideModal();
        document.getElementById('agc2-fov').classList.add('on');
    }
    function persistVis() {
        try {
            if (typeof setStoredData === 'function' && typeof visSettings !== 'undefined')
                setStoredData('arVisSettings12', JSON.stringify(visSettings));
        } catch (e) {}
        try { if (typeof applyVisualSettings === 'function') applyVisualSettings(); } catch (e) {}
    }
    function saveFov() {
        persistVis();
        document.getElementById('agc2-fov').classList.remove('on');
        toast('Šířka záběru uložena (' + fovVal() + '°)');
    }
    function cancelFov() {
        if (_fovBefore != null) setFov(_fovBefore);   // vrať původní (live render se srovná)
        document.getElementById('agc2-fov').classList.remove('on');
    }

    // ---- registrace do launcheru „Nástroje" ------------------------------------
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'ar-calib2', label: 'Srovnat AR na 2 body', icon: ICON, onClick: showModal, order: 1, cat: 'AR a kalibrace' });
        }
    }
    // veřejný vstup (pro app-search / jiné moduly)
    window.agOpenCalib2 = showModal;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 400); });
})();
