// ===== AR Geodet — JEDNODOTYKOVÁ KALIBRACE SEVERU (ODPOJITELNÁ vrstva) =========
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Povyšuje „srovnání
// severu podle známého bodu" (dnes schované v Nastavení kompasu / mezi nástroji)
// na PROMINENTNÍ jednodotykovou akci přímo v AR:
//
//   • Plovoucí tlačítko s kompasem „Srovnat sever" se ukazuje jen v AR režimu,
//     u kompasového panelu. ROZSVÍTÍ SE (puls), když appka hlásí nespolehlivý
//     kompas (čte ⚠ v #compass-debug).
//   • Po klepnutí nabídne 3–5 NEJBLIŽŠÍCH známých bodů (trig./ZhB přednostně).
//     Uživatel vybere bod → „zamiř křížem na bod a podrž" → appka ~1 s sbírá
//     currentHeading, spočítá správný azimut getBearing(stanovisko → bod) a
//     nastaví korekci přes existující nudgeHeadingOffset() (resp. userHeadingOffset
//     + setStoredData('arHeadingOffset', …)). Ukáže, o kolik stupňů se sever posunul.
//
// Sdílí stejnou „páku" jako Nastavení kompasu „Srovnání severu", takže korekce
// přežije i uložení. NEDUPLIKUJE výpočet — když je k dispozici plný nástroj
// (window.agOpenOrientTool z orient-point.js), nabídne na něj odkaz „Více možností".
//
// Vstup: vlastní plovoucí tlačítko (injektuje si ho modul sám) + window.agOpenCalibrate().
// Odstranění: smaž js/ar-calibrate.js + css/ar-calibrate.css + řádky <script>/<link>
//             v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var FAB_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="12,7 15,15 12,13 9,15" fill="currentColor" stroke="none"/><path d="M12 2v1.5M12 20.5V22M2 12h1.5M20.5 12H22"/></svg>';

    var D2R = Math.PI / 180, R2D = 180 / Math.PI;

    var _selId = null;          // id vybraného cíle
    var _capTimer = null;       // timer sběru vzorků při zaměřování
    var _capSamples = [];       // vzorky currentHeading během zaměřování
    var _lastDelta = null;      // poslední aplikovaná korekce (pro „vrátit")
    var _liveTimer = null;      // živá obnova seznamu/info v modalu

    // ---- pomocné: opatrné mosty na globály appky ------------------------------
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} try { alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e2) {} }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function heading() { return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; }
    function inMap() { return (typeof viewMode !== 'undefined' && viewMode === 'map'); }
    function started() { return (typeof appStarted === 'undefined') || !!appStarted; }
    // rozdíl úhlů -> (-180,180]; využij angDiff appky, jinak vlastní
    function adiff(a, b) { try { if (typeof angDiff === 'function') return angDiff(a, b); } catch (e) {} return ((a - b + 540) % 360) - 180; }
    function circMeanDeg(arr) { var s = 0, c = 0; arr.forEach(function (a) { s += Math.sin(a * D2R); c += Math.cos(a * D2R); }); return Math.atan2(s, c) * R2D; }

    // ---- výběr bodů: úřední (autoritativní souřadnice) napřed, pak dle vzdálenosti
    function nearestPoints(limit) {
        if (typeof arPoints === 'undefined' || !Array.isArray(arPoints)) return [];
        return arPoints.filter(function (p) { return p && !p.hidden && typeof p.lat === 'number' && typeof p.lng === 'number'; })
            .map(function (p) { return { p: p, d: haveUser() ? getDistance(userLat, userLng, p.lat, p.lng) : null }; })
            .sort(function (a, b) {
                var oa = (a.p.cat && a.p.cat !== 'CUSTOM') ? 0 : 1, ob = (b.p.cat && b.p.cat !== 'CUSTOM') ? 0 : 1;
                if (oa !== ob) return oa - ob;
                return (a.d == null || b.d == null) ? 0 : a.d - b.d;
            })
            .slice(0, limit || 5);
    }
    function ptById(id) { if (typeof arPoints === 'undefined') return null; return arPoints.find(function (q) { return q.id === id; }) || null; }

    // ---- detekce nespolehlivého kompasu --------------------------------------
    // Primárně: appka přidává ⚠ do #compass-debug (kalibrace / chybí absolutní azimut).
    // Záloha: vlastní heuristika — neklid (rozptyl) v currentHeading za poslední ~1,5 s.
    var _hsamples = [];
    function compassWarnDom() {
        try {
            var el = document.getElementById('compass-debug');
            if (el && (/⚠/.test(el.textContent || '') || /⚠/.test(el.innerHTML || ''))) return true;
        } catch (e) {}
        return false;
    }
    function compassJittery() {
        var h = heading(); if (h == null) return false;
        _hsamples.push(h); if (_hsamples.length > 15) _hsamples.shift();
        if (_hsamples.length < 8) return false;
        // kruhový rozptyl: 1 - R (R = délka výslednice jednotkových vektorů)
        var s = 0, c = 0; _hsamples.forEach(function (a) { s += Math.sin(a * D2R); c += Math.cos(a * D2R); });
        var R = Math.sqrt(s * s + c * c) / _hsamples.length;
        return (1 - R) > 0.06; // citelný neklid
    }
    function compassUnreliable() { return compassWarnDom() || compassJittery(); }

    // ===========================================================================
    //  BEZ PLOVOUCÍHO TLAČÍTKA — nástroj se otevírá z doku „Nástroje" (dlaždice
    //  „Srovnat sever" → window.agOpenCalibrate). Na přání: plovoucí tlačítko
    //  překrývalo modály a na obrazovce není třeba (appka sama hlásí stav kompasu).
    // ===========================================================================

    // ===========================================================================
    //  MODAL VÝBĚRU BODU + ŽIVÉ INFO
    // ===========================================================================
    function ensureModal() {
        if (document.getElementById('agcal-modal')) return;
        var more = (typeof window.agOpenOrientTool === 'function')
            ? '<button class="btn btn-secondary" id="agcal-more" style="margin-top:10px;">Více možností (resekce / nastavení)</button>'
            : '';
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agcal-modal'; el.style.zIndex = '100040';
        el.innerHTML =
            '<div class="modal-content agcal-card">'
            + '<h3 class="agcal-h3">' + FAB_ICON + ' Srovnat sever podle bodu</h3>'
            + '<p class="agcal-lead">Vyber <b>viditelný</b> známý bod (ideálně trig./ZhB nebo roh). Pak na něj namíříš křížem kamery a chvíli podržíš — appka srovná sever podle skutečného směru k němu. Funguje i tam, kde magnetometr blbne.</p>'
            + '<div id="agcal-list" class="agcal-list"></div>'
            + '<div id="agcal-live" class="agcal-live"></div>'
            + '<button class="btn btn-secondary" id="agcal-clear" style="margin-bottom:10px;display:none;">✕ Zrušit výběr (nenavádět)</button>'
            + '<button class="btn" id="agcal-start"><svg class="icon"><use href="#i-crosshair"/></svg> Zamířit a srovnat</button>'
            + '<button class="btn btn-warning" id="agcal-undo" style="margin-top:10px;display:none;"><svg class="icon"><use href="#i-rotate-ccw"/></svg> Vrátit poslední srovnání</button>'
            + more
            + '<button class="btn btn-secondary" style="margin-top:10px;" onclick="window.agCloseCalibrate&&window.agCloseCalibrate()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('agcal-start').addEventListener('click', startAim);
        document.getElementById('agcal-clear').addEventListener('click', clearSelection);
        document.getElementById('agcal-undo').addEventListener('click', undo);
        var mo = document.getElementById('agcal-more');
        if (mo) mo.addEventListener('click', function () { window.agCloseCalibrate(); try { window.agOpenOrientTool(); } catch (e) {} });
    }

    function renderList() {
        var box = document.getElementById('agcal-list'); if (!box) return;
        var list = nearestPoints(5);
        if (!list.length) {
            box.innerHTML = '<div class="agcal-empty">Žádné body v okolí — stáhni okolí (ČÚZK) nebo přidej vlastní bod se souřadnicemi.</div>';
            _selId = null; updateClearBtn(); return;
        }
        // BEZ automatického výběru — bod si zvolí uživatel sám (na přání); nejbližší se jen nenavrhuje.
        box.innerHTML = list.map(function (x) {
            var on = x.p.id === _selId;
            var bear = haveUser() ? getBearing(userLat, userLng, x.p.lat, x.p.lng) : null;
            return '<button type="button" class="agcal-row' + (on ? ' on' : '') + '" data-id="' + x.p.id + '">'
                + '<span class="agcal-name">#' + esc(x.p.name) + (x.p.cat && x.p.cat !== 'CUSTOM' ? ' <span class="agcal-cat">' + esc(x.p.cat) + '</span>' : '') + '</span>'
                + '<span class="agcal-meta">' + (x.d != null ? x.d.toFixed(0) + ' m' : '') + (bear != null ? ' · ' + bear.toFixed(0) + '°' : '') + '</span>'
                + '</button>';
        }).join('');
        box.querySelectorAll('.agcal-row').forEach(function (r) {
            r.addEventListener('click', function () {
                _selId = this.getAttribute('data-id');
                // navádění: zvýrazni vybraný bod i v AR/mapě (zlatá značka + šipka)
                try { var p = ptById(_selId); if (p && typeof highlightPoint === 'function' && (typeof highlightedPointId === 'undefined' || highlightedPointId !== p.id)) highlightPoint(p); } catch (e) {}
                renderList(); renderLive();
            });
        });
        updateClearBtn();
    }

    // má appka teď aktivní cíl navádění (z modalu nebo z klepnutí na bod v AR/mapě)?
    function hasTarget() {
        if (_selId != null) return true;
        try { return (typeof highlightedPointId !== 'undefined' && highlightedPointId != null); } catch (e) { return false; }
    }
    function updateClearBtn() {
        var c = document.getElementById('agcal-clear'); if (c) c.style.display = hasTarget() ? 'block' : 'none';
    }
    // zruš výběr + zastav navádění (zlatá značka + AR šipka) — pro omylem vybraný bod
    function clearSelection() {
        _selId = null;
        try {
            if (typeof highlightedPointId !== 'undefined' && highlightedPointId != null) {
                var hp = ptById(highlightedPointId);
                if (hp && typeof highlightPoint === 'function') highlightPoint(hp); // toggle → vypne navádění
            }
        } catch (e) {}
        renderList(); renderLive(); updateClearBtn();
        toast('Výběr zrušen — nenaviguje se');
    }

    function renderLive() {
        var info = document.getElementById('agcal-live'), btn = document.getElementById('agcal-start');
        if (!info) return;
        var pt = ptById(_selId);
        if (!pt || !haveUser()) { info.innerHTML = '<span class="agcal-dim">Čekám na GPS polohu a výběr bodu…</span>'; if (btn) btn.disabled = true; return; }
        var bearing = getBearing(userLat, userLng, pt.lat, pt.lng);
        var dist = getDistance(userLat, userLng, pt.lat, pt.lng);
        var h = heading();
        if (h == null) {
            info.innerHTML = 'Azimut k bodu: <b>' + bearing.toFixed(1) + '°</b> · ' + dist.toFixed(0) + ' m<br><span class="agcal-dim">Kompas zatím nedává směr — podrž telefon svisle.</span>';
            if (btn) btn.disabled = true; return;
        }
        var delta = adiff(bearing, h);
        info.innerHTML =
            'Azimut k bodu: <b>' + bearing.toFixed(1) + '°</b> · ' + dist.toFixed(0) + ' m<br>'
            + 'Kompas teď: <b>' + h.toFixed(1) + '°</b> · rozdíl '
            + '<b style="color:' + (Math.abs(delta) > 8 ? '#fbbf24' : '#34d399') + '">' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + '°</b>';
        if (btn) btn.disabled = false;
    }

    // ===========================================================================
    //  ZAMĚŘOVACÍ REŽIM (přes kameru) — kříž uprostřed, ~1 s podržení
    // ===========================================================================
    function ensureAim() {
        if (document.getElementById('agcal-aim')) return;
        var a = document.createElement('div');
        a.id = 'agcal-aim';
        a.innerHTML =
            '<div id="agcal-aim-bar"><span id="agcal-aim-txt"></span></div>'
            + '<div id="agcal-cross"><svg viewBox="0 0 100 100">'
            + '<circle cx="50" cy="50" r="30" fill="none" stroke="#34d399" stroke-width="2"/>'
            + '<line x1="50" y1="6" x2="50" y2="30" stroke="#34d399" stroke-width="2"/><line x1="50" y1="70" x2="50" y2="94" stroke="#34d399" stroke-width="2"/>'
            + '<line x1="6" y1="50" x2="30" y2="50" stroke="#34d399" stroke-width="2"/><line x1="70" y1="50" x2="94" y2="50" stroke="#34d399" stroke-width="2"/>'
            + '<circle cx="50" cy="50" r="2.5" fill="#34d399"/></svg><div id="agcal-cross-prog"></div></div>'
            + '<div id="agcal-aim-btns"><button id="agcal-shot" class="btn">Podrž a srovnej</button>'
            + '<button id="agcal-aim-cancel" class="btn btn-secondary">Zrušit</button></div>';
        document.body.appendChild(a);
        document.getElementById('agcal-shot').addEventListener('click', captureAndApply);
        document.getElementById('agcal-aim-cancel').addEventListener('click', cancelAim);
    }
    function showAim(on) { ensureAim(); document.getElementById('agcal-aim').classList.toggle('on', !!on); }

    function startAim() {
        var pt = ptById(_selId);
        if (!pt || !haveUser()) { renderLive(); return; }
        if (heading() == null) { agAlert('Bez směru', 'Kompas zatím nedává směr. Podrž telefon svisle a zkus to znovu.'); return; }
        var m = document.getElementById('agcal-modal'); if (m) m.style.display = 'none';
        showAim(true);
        var txt = document.getElementById('agcal-aim-txt');
        var d = getDistance(userLat, userLng, pt.lat, pt.lng);
        if (txt) txt.innerHTML = 'Namiř střed kříže přesně na <b>#' + esc(pt.name) + '</b>'
            + (d != null ? ' · ' + d.toFixed(0) + ' m' : '')
            + '<br><span class="agcal-dim">drž telefon svisle a klepni „Podrž a srovnej"</span>';
        var shot = document.getElementById('agcal-shot'); if (shot) { shot.disabled = false; shot.innerText = 'Podrž a srovnej'; }
    }

    function captureAndApply() {
        if (heading() == null) { toast('Kompas nedává směr'); return; }
        var shot = document.getElementById('agcal-shot'); if (shot) shot.disabled = true;
        _capSamples = [];
        var dur = 1100, step = 90, t0 = 0;
        var prog = document.getElementById('agcal-cross-prog');
        if (_capTimer) clearInterval(_capTimer);
        _capTimer = setInterval(function () {
            var h = heading(); if (h != null) _capSamples.push(h);
            t0 += step; if (prog) prog.style.width = Math.min(100, (t0 / dur) * 100) + '%';
            if (t0 >= dur) {
                clearInterval(_capTimer); _capTimer = null; if (prog) prog.style.width = '0%';
                if (!_capSamples.length) { if (shot) shot.disabled = false; toast('Nezachyceno — zkus znovu'); return; }
                finalize();
            }
        }, step);
    }

    function finalize() {
        var pt = ptById(_selId);
        if (!pt || !haveUser()) { cancelAim(); return; }
        var az = (circMeanDeg(_capSamples) + 360) % 360;       // průměrný směr telefonu při zaměření
        var bearing = getBearing(userLat, userLng, pt.lat, pt.lng);
        var delta = adiff(bearing, az);
        if (!applyDelta(delta)) { agAlert('Nelze srovnat', 'Korekce kompasu není v této verzi appky dostupná.'); cancelAim(); return; }
        _lastDelta = delta;
        if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }
        showAim(false);
        var m = document.getElementById('agcal-modal'); if (m) m.style.display = 'flex';
        var undoBtn = document.getElementById('agcal-undo'); if (undoBtn) undoBtn.style.display = 'block';
        renderList(); renderLive();
        agAlert('Sever srovnán',
            'Sever srovnán podle #' + esc(pt.name) + '.\nPosun severu: <b>' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + '°</b>'
            + ' (z ' + _capSamples.length + ' vzorků).\n\nPři pomalé chůzi to drží. Pokud máš zapnutou auto-korekci podle GPS, za rychlé chůze se může dolaďovat sama.');
    }

    // aplikace korekce přes existující „páku" appky (sdílená s Nastavením kompasu)
    function applyDelta(delta) {
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

    function undo() {
        if (_lastDelta == null) return;
        if (applyDelta(-_lastDelta)) {
            _lastDelta = null;
            var u = document.getElementById('agcal-undo'); if (u) u.style.display = 'none';
            renderLive(); toast('Poslední srovnání vráceno');
        }
    }

    function cancelAim() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        showAim(false);
        var m = document.getElementById('agcal-modal'); if (m) m.style.display = 'flex';
        renderList(); renderLive();
    }

    // ===========================================================================
    //  OTEVŘENÍ / ZAVŘENÍ
    // ===========================================================================
    function openTool() {
        ensureModal();
        // BEZ auto-výběru: zrcadlíme jen už aktivní cíl (pokud nějaký je), jinak nic nevybráno.
        try { _selId = (typeof highlightedPointId !== 'undefined' && highlightedPointId != null) ? highlightedPointId : null; } catch (e) { _selId = null; }
        renderList(); renderLive(); updateClearBtn();
        document.getElementById('agcal-modal').style.display = 'flex';
        if (!_liveTimer) _liveTimer = setInterval(function () {
            var m = document.getElementById('agcal-modal');
            if (m && m.style.display === 'flex') { renderLive(); updateClearBtn(); }
        }, 280);
    }
    window.agCloseCalibrate = function () {
        var m = document.getElementById('agcal-modal'); if (m) m.style.display = 'none';
        if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        showAim(false);
    };
    window.agOpenCalibrate = openTool;

    // ---- drobné: escapování do HTML ------------------------------------------
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

    // Nástroj se otevírá z doku „Nástroje" přes window.agOpenCalibrate (žádná init
    // vrstva ani plovoucí tlačítko netřeba — modal se vytvoří líně při otevření).
})();
