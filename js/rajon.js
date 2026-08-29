// ===== AR Geodet — RAJÓN / POLÁRNÍ METODA (ODPOJITELNÁ vrstva) ================
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Doplněk k AR resekci a
// protínání vpřed. Řeší úlohu „znám svou polohu, stačí směr":
//
//   Stojím na ZNÁMÉM bodě (stanovisko) a mám druhý ZNÁMÝ bod na orientaci. Křížem
//   kamery zaměřím orientaci, pak cíl, a zadám (nebo změřím) VODOROVNOU vzdálenost
//   na cíl → appka spočítá souřadnice nového bodu.
//
//   Rozdíl dvou zaměření ze stejného stanoviska (orientace vs. cíl) ruší konstantní
//   chybu kompasu — nepřesná GPS ani zkreslený magnetometr do výsledku nevstupují.
//   Směrník na cíl = směrník(stanovisko→orientace, ze souřadnic) + vodorovný úhel.
//
//   Na rozdíl od protínání vpřed (2 stanoviska) stačí JEDNO místo — polohu cíle
//   uzavře zadaná délka (pásmo / dálkoměr / laser).
//
// Vstup: dlaždice „Rajón (nový bod ze směru + délky)" v Nástrojích; když launcher
//        chybí, modul si vyrobí vlastní plovoucí tlačítko.
// Odstranění: smaž js/rajon.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="5" cy="19" r="2"/><path d="M6.4 17.6 18 6"/><path d="M5 19h9"/>'
        + '<circle cx="19" cy="5" r="2"/><path d="M12.5 5.5 15 8"/></svg>';

    var D2R = Math.PI / 180, R2D = 180 / Math.PI;

    // stav
    var _stId = null;       // stanovisko: id bodu, nebo '__gps__' = moje aktuální poloha
    var _orientId = null;   // orientace: id známého bodu
    var _dist = null;       // vodorovná vzdálenost na cíl (m)
    var _targetName = '';
    var _devOrient = null, _devTarget = null;   // azimuty zařízení při zaměření
    var _steps = [];        // ['orient','target']
    var _capIdx = -1, _capSamples = [], _capTimer = null, _capSpread = null;
    var _result = null;

    // ---- draft (AGDraft je odpojitelný, vše fail-silent) -----------------------
    // Ukládá se jen serializovatelné jádro: id bodů, délka, azimuty, výsledek.
    var DRAFT_KEY = 'rajon';
    function draftSave() {
        if (!window.AGDraft) return;
        try {
            // bez jediného uživatelského kroku se nedraftuje — naopak úklid
            if (!_stId && !_orientId && !(_dist > 0) && !(_targetName && _targetName.trim())) { window.AGDraft.clear(DRAFT_KEY); return; }
            var shots = (_devOrient != null ? 1 : 0) + (_devTarget != null ? 1 : 0);
            window.AGDraft.save(DRAFT_KEY,
                { stId: _stId, orientId: _orientId, dist: _dist, targetName: _targetName, devOrient: _devOrient, devTarget: _devTarget, capSpread: _capSpread, result: _result },
                'Rajón – zaměřeno ' + shots + '/2');
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rajon:draftSave'); }
    }
    function draftClear() { if (window.AGDraft) try { window.AGDraft.clear(DRAFT_KEY); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rajon:draftClear'); } }

    // ---- pomocné --------------------------------------------------------------
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rajon:agAlert'); } agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rajon:toast'); } }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function heading() { return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; }
    function curViewMode() { try { return (typeof viewMode !== 'undefined') ? viewMode : 'both'; } catch (e) { return 'both'; } }
    function angNormDeg(a) { return ((a % 360) + 540) % 360 - 180; }
    function circMeanDeg(arr) {
        var s = 0, c = 0;
        arr.forEach(function (a) { s += Math.sin(a * D2R); c += Math.cos(a * D2R); });
        return Math.atan2(s, c) * R2D;
    }
    function circStdDeg(arr) {
        if (arr.length < 2) return 0;
        var s = 0, c = 0;
        arr.forEach(function (a) { s += Math.sin(a * D2R); c += Math.cos(a * D2R); });
        var R = Math.hypot(s, c) / arr.length;
        return Math.sqrt(Math.max(0, -2 * Math.log(Math.max(R, 1e-9)))) * R2D;
    }
    function ptById(id) { if (typeof arPoints === 'undefined') return null; return arPoints.find(function (q) { return q.id === id; }) || null; }
    function dist2(a, b) { return getDistance(a.lat, a.lng, b.lat, b.lng); }

    // souřadnice stanoviska: buď vybraný bod, nebo moje aktuální GPS poloha
    function stationLL() {
        if (_stId === '__gps__') { return haveUser() ? { lat: userLat, lng: userLng, name: 'moje poloha' } : null; }
        var p = ptById(_stId); return p ? { lat: p.lat, lng: p.lng, name: p.name } : null;
    }

    function candidatePoints() {
        if (typeof arPoints === 'undefined') return [];
        return arPoints.filter(function (p) { return !p.hidden; })
            .map(function (p) { return { p: p, d: haveUser() ? getDistance(userLat, userLng, p.lat, p.lng) : null }; })
            .sort(function (a, b) {
                if (a.d == null && b.d == null) return 0;
                if (a.d == null) return 1;
                if (b.d == null) return -1;
                return a.d - b.d;
            });
    }

    // ---- jádro: výpočet cíle polární metodou -----------------------------------
    // S = stanovisko, O = orientace (známé), d = délka na cíl, ang = vodorovný úhel
    //   směrník S→cíl = směrník(S→O) + (devTarget - devOrient)
    function solve() {
        var S = stationLL(); var O = ptById(_orientId);
        if (!S || !O) return null;
        if (!(_dist > 0)) return null;
        if (_devOrient == null || _devTarget == null) return null;
        var lat0 = S.lat, lng0 = S.lng;
        var _m = (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) ? GeoCore.metersPerDeg(lat0) : { lat: 111320, lng: 111320 * Math.cos(lat0 * D2R) };
        var mLat = _m.lat, mLng = _m.lng;
        var Oe = (O.lng - lng0) * mLng, On = (O.lat - lat0) * mLat;
        var distSO = Math.hypot(Oe, On);
        if (distSO < 0.5) return null;                          // orientace splývá se stanoviskem
        var betaSO = (Math.atan2(Oe, On) * R2D + 360) % 360;    // směrník stanovisko→orientace
        var ang = angNormDeg(_devTarget - _devOrient);          // vodorovný úhel O→cíl
        var theta = ((betaSO + ang) % 360 + 360) % 360;         // směrník stanovisko→cíl
        var Te = _dist * Math.sin(theta * D2R), Tn = _dist * Math.cos(theta * D2R);
        var latP = lat0 + Tn / mLat, lngP = lng0 + Te / mLng;
        var sj = null; try { sj = proj4('EPSG:4326', 'EPSG:5514', [lngP, latP]); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rajon:solve'); }
        return {
            lat: latP, lng: lngP,
            Y: sj ? Math.abs(sj[0]) : null, X: sj ? Math.abs(sj[1]) : null,
            theta: theta, ang: ang, distSO: distSO, dist: _dist,
            sName: S.name, oName: O.name,
            gpsStation: _stId === '__gps__'
        };
    }

    // ---- UI: hlavní modal -----------------------------------------------------
    function ensureModal() {
        if (document.getElementById('agrj-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agrj-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Rajón — nový bod ze směru a délky</h3>'
            + '<p style="font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.82;margin:2px 0 10px;line-height:1.45;">Stoj na <b>známém bodě</b>, měj druhý známý bod na <b>orientaci</b>. '
            + 'Zaměříš křížem kamery orientaci, pak cíl, a zadáš <b>vodorovnou délku</b> na cíl → appka spočítá jeho souřadnice. '
            + 'Rozdíl směrů ruší chybu kompasu, GPS do výpočtu nevstupuje.</p>'
            + '<label class="agrj-fld"><span>stojím na (stanovisko)</span><select id="agrj-st"></select></label>'
            + '<label class="agrj-fld"><span>orientace — zaměřím známý bod</span><select id="agrj-or"></select></label>'
            + '<label class="agrj-fld"><span>vodorovná délka na cíl (m) — pásmo / dálkoměr</span><input type="text" id="agrj-dist" inputmode="decimal" step="0.01" min="0" placeholder="např. 24.35"></label>'
            + '<label class="agrj-fld"><span>název nového bodu</span><input type="text" id="agrj-name" placeholder="např. R1" maxlength="24"></label>'
            + '<div id="agrj-warn" style="font-size:calc(12px * var(--ag-font-scale, 1));color:#fbbf24;margin:4px 2px;"></div>'
            + '<button class="btn" id="agrj-start"><svg class="icon"><use href="#i-crosshair"/></svg> Spustit zaměřování</button>'
            + '<div id="agrj-result" class="agrj-result" style="display:none;"></div>'
            + '<div id="agrj-actions" style="display:none;">'
            + '  <button class="btn btn-blue" id="agrj-save"><svg class="icon"><use href="#i-plus"/></svg> Uložit nový bod</button>'
            + '  <button class="btn btn-secondary" id="agrj-redo" style="margin-top:10px;"><svg class="icon"><use href="#i-rotate-ccw"/></svg> Zaměřit znovu</button>'
            + '</div>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" onclick="window.agCloseRajon&&window.agCloseRajon()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('agrj-st').addEventListener('change', function (e) { _stId = e.target.value || null; onModelChange(); });
        document.getElementById('agrj-or').addEventListener('change', function (e) { _orientId = e.target.value || null; onModelChange(); });
        document.getElementById('agrj-dist').addEventListener('input', function (e) { var v = agNum(e.target.value); _dist = (v != null && v > 0) ? v : null; _result = null; renderResult(); updateWarn(); draftSave(); });
        document.getElementById('agrj-name').addEventListener('input', function (e) { _targetName = e.target.value; draftSave(); });
        document.getElementById('agrj-start').addEventListener('click', startCapture);
        document.getElementById('agrj-save').addEventListener('click', saveTarget);
        document.getElementById('agrj-redo').addEventListener('click', function () { _devOrient = null; _devTarget = null; _capSpread = null; _result = null; renderResult(); updateWarn(); draftSave(); });
    }

    function onModelChange() { _result = null; _devOrient = null; _devTarget = null; renderResult(); updateWarn(); draftSave(); }

    function fillSelects() {
        var list = candidatePoints();
        var optsPts = '';
        list.slice(0, 80).forEach(function (x) {
            var tag = (x.p.cat && x.p.cat !== 'CUSTOM') ? ' [' + x.p.cat + ']' : '';
            var dd = (x.d != null ? ' · ' + x.d.toFixed(0) + ' m' : '');
            optsPts += '<option value="' + x.p.id + '">#' + x.p.name + tag + dd + '</option>';
        });
        var st = document.getElementById('agrj-st'), or = document.getElementById('agrj-or');
        if (st) {
            st.innerHTML = '<option value="">— vyber bod —</option>'
                + (haveUser() ? '<option value="__gps__">📍 moje aktuální poloha (GPS)</option>' : '')
                + optsPts;
            st.value = _stId || '';
        }
        if (or) { or.innerHTML = '<option value="">— vyber bod —</option>' + optsPts; or.value = _orientId || ''; }
    }

    function updateWarn() {
        var w = document.getElementById('agrj-warn'), btn = document.getElementById('agrj-start');
        if (!w) return;
        var msg = '', ok = true;
        if (heading() == null) { msg = 'Kompas zatím nedává směr — podrž telefon svisle a chvíli počkej.'; ok = false; }
        else if (curViewMode() === 'map') { msg = 'Zapni zobrazení s kamerou (AR nebo Split) — zaměřuje se přes kameru.'; ok = false; }
        if (!_stId) { if (!msg) msg = 'Vyber, na kterém bodě stojíš (stanovisko).'; ok = false; }
        else if (_stId === '__gps__' && !haveUser()) { msg = 'Čekám na GPS polohu…'; ok = false; }
        if (!_orientId) { if (!msg) msg = 'Vyber orientaci — druhý známý bod, na který zaměříš.'; ok = false; }
        if (_stId && _orientId && _stId !== '__gps__' && _stId === _orientId) { msg = 'Orientace musí být JINÝ bod než stanovisko.'; ok = false; }
        if (!(_dist > 0)) { if (!msg) msg = 'Zadej vodorovnou délku na cíl (pásmo/dálkoměr).'; ok = false; }
        w.innerHTML = msg;
        if (btn) btn.disabled = !ok;
    }

    // ---- zaměřovací režim (přes kameru) — VYČIŠTĚNÁ obrazovka ------------------
    function declutter(on) {
        document.body.classList.toggle('agrj-clean', !!on);
        if (!on) { try { if (typeof applyViewMode === 'function') applyViewMode(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rajon:declutter'); } }
    }
    function ensureAim() {
        if (document.getElementById('agrj-aim')) return;
        var a = document.createElement('div');
        a.id = 'agrj-aim';
        a.innerHTML =
            '<div id="agrj-aim-bar"><span id="agrj-aim-txt"></span></div>'
            + '<div id="agrj-cross"><svg viewBox="0 0 100 100">'
            + '<circle id="agrj-ring" cx="50" cy="50" r="30" fill="none" stroke="#34d399" stroke-width="2"/>'
            + '<line x1="50" y1="6" x2="50" y2="30" stroke="#34d399" stroke-width="2"/><line x1="50" y1="70" x2="50" y2="94" stroke="#34d399" stroke-width="2"/>'
            + '<line x1="6" y1="50" x2="30" y2="50" stroke="#34d399" stroke-width="2"/><line x1="70" y1="50" x2="94" y2="50" stroke="#34d399" stroke-width="2"/>'
            + '<circle cx="50" cy="50" r="2.5" fill="#34d399"/></svg><div id="agrj-cross-prog"></div></div>'
            + '<div id="agrj-step"></div>'
            + '<div id="agrj-aim-btns">'
            + '  <button id="agrj-shot" class="btn">Zaměřit</button>'
            + '  <button id="agrj-back" class="btn btn-secondary">← Zpět</button>'
            + '  <button id="agrj-aim-cancel" class="btn btn-secondary">Zrušit</button>'
            + '</div>';
        document.body.appendChild(a);
        document.getElementById('agrj-shot').addEventListener('click', takeShot);
        document.getElementById('agrj-back').addEventListener('click', stepBack);
        document.getElementById('agrj-aim-cancel').addEventListener('click', cancelCapture);
    }
    function showAim(on) { ensureAim(); document.getElementById('agrj-aim').classList.toggle('on', !!on); }

    function startCapture() {
        updateWarn();
        var startBtn = document.getElementById('agrj-start'); if (startBtn && startBtn.disabled) return;
        if (curViewMode() === 'map') { agAlert('Zapni kameru', 'Přepni zobrazení na AR nebo Split — zaměřuje se přes kameru.'); return; }
        _steps = ['orient', 'target']; _devOrient = null; _devTarget = null; _capSpread = null; _result = null; _capIdx = 0;
        document.getElementById('agrj-modal').style.display = 'none';
        declutter(true); showAim(true); promptStep();
    }

    function promptStep() {
        if (_capIdx >= _steps.length) { finishCapture(); return; }
        var role = _steps[_capIdx];
        var S = stationLL(), O = ptById(_orientId);
        var bar = document.getElementById('agrj-aim-txt'), stepEl = document.getElementById('agrj-step');
        var shot = document.getElementById('agrj-shot'), back = document.getElementById('agrj-back');
        var ring = document.getElementById('agrj-ring');
        var isTarget = (role === 'target');
        if (ring) ring.setAttribute('stroke', isTarget ? '#fbbf24' : '#34d399');
        var crossSvg = document.querySelectorAll('#agrj-cross svg line, #agrj-cross svg circle');
        crossSvg.forEach(function (n) { if (n.getAttribute('fill') === '#34d399' || n.getAttribute('fill') === '#fbbf24') n.setAttribute('fill', isTarget ? '#fbbf24' : '#34d399'); if (n.getAttribute('stroke')) n.setAttribute('stroke', isTarget ? '#fbbf24' : '#34d399'); });
        if (isTarget) {
            if (bar) bar.innerHTML = 'Stoj na <b>#' + (S ? S.name : '?') + '</b> · zaměř <b style="color:#fbbf24">CÍL</b>'
                + (_targetName ? ' (' + _targetName + ')' : '') + '<br><span style="opacity:.75;font-size:calc(12px * var(--ag-font-scale, 1))">délka na cíl: ' + (_dist > 0 ? _dist.toFixed(2) + ' m' : '—') + '</span>';
        } else {
            var dTxt = (O && S) ? ' · ' + dist2(S, O).toFixed(0) + ' m' : '';
            if (bar) bar.innerHTML = 'Stoj na <b>#' + (S ? S.name : '?') + '</b> · zaměř známý <b>#' + (O ? O.name : '?') + '</b>' + dTxt
                + '<br><span style="opacity:.75;font-size:calc(12px * var(--ag-font-scale, 1))">orientace — srovná směr</span>';
        }
        if (stepEl) stepEl.innerHTML = 'krok ' + (_capIdx + 1) + ' z 2';
        if (shot) { shot.disabled = false; shot.innerText = isTarget ? 'Zaměřit cíl' : 'Zaměřit #' + (O ? O.name : ''); }
        if (back) back.style.display = (_capIdx > 0) ? 'inline-flex' : 'none';
    }

    function stepBack() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        if (_capIdx <= 0) { cancelCapture(); return; }
        _capIdx--;
        if (_steps[_capIdx] === 'orient') _devOrient = null; else _devTarget = null;
        promptStep();
    }

    function takeShot() {
        if (heading() == null) { toast('Kompas nedává směr'); return; }
        var shotBtn = document.getElementById('agrj-shot'); if (shotBtn) shotBtn.disabled = true;
        _capSamples = []; var dur = 1100, stepMs = 90, prog = document.getElementById('agrj-cross-prog'); var t0 = 0;
        if (_capTimer) clearInterval(_capTimer);
        _capTimer = setInterval(function () {
            var h = heading(); if (h != null) _capSamples.push(h);
            t0 += stepMs; if (prog) prog.style.width = Math.min(100, (t0 / dur) * 100) + '%';
            if (t0 >= dur) {
                clearInterval(_capTimer); _capTimer = null; if (prog) prog.style.width = '0%';
                if (!_capSamples.length) { if (shotBtn) shotBtn.disabled = false; toast('Nezachyceno'); return; }
                var az = (circMeanDeg(_capSamples) + 360) % 360;
                var sd = circStdDeg(_capSamples);
                if (_steps[_capIdx] === 'orient') { _devOrient = az; } else { _devTarget = az; _capSpread = sd; }
                draftSave();   // každá hotová záměra se hned draftuje
                if (navigator.vibrate) try { navigator.vibrate(25); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rajon:takeShot'); }
                _capIdx++;
                promptStep();
            }
        }, stepMs);
    }

    function cancelCapture() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        _capIdx = -1; showAim(false); declutter(false);
        var m = document.getElementById('agrj-modal'); if (m) m.style.display = 'flex';
        fillSelects(); updateWarn(); renderResult();
    }
    function finishCapture() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        _capIdx = -1; showAim(false); declutter(false);
        var m = document.getElementById('agrj-modal'); if (m) m.style.display = 'flex';
        _result = solve();
        draftSave();   // draft i s výsledkem (obnova ukáže hotový výpočet)
        fillSelects(); updateWarn(); renderResult();
    }

    function renderResult() {
        var box = document.getElementById('agrj-result'), acts = document.getElementById('agrj-actions');
        if (!box) return;
        if (!_result) { box.style.display = 'none'; if (acts) acts.style.display = 'none'; return; }
        var r = _result;
        // orientace blízko stanoviska = citlivé na zaměření (krátká orientační základna)
        var oCol = r.distSO < 5 ? '#f87171' : (r.distSO < 15 ? '#fbbf24' : '#34d399');
        var html = '<div class="agrj-big">Nový bod ' + (_targetName ? '<b>' + _targetName + '</b> ' : '') + 'spočítán</div>'
            + '<div style="margin:6px 0;font-family:var(--font-mono,monospace);font-size:calc(13px * var(--ag-font-scale, 1));">'
            + 'S-JTSK:&nbsp; <b>Y</b> ' + (r.Y != null ? r.Y.toFixed(2) : '—') + ' &nbsp; <b>X</b> ' + (r.X != null ? r.X.toFixed(2) : '—') + '</div>'
            + '<div style="font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.9;line-height:1.5;">'
            + 'Stanovisko: <b>#' + r.sName + '</b>' + (r.gpsStation ? ' <span style="color:#fbbf24">(GPS — poloha bodu jen tak přesná jako GPS)</span>' : '') + '<br>'
            + 'Orientace: <b>#' + r.oName + '</b> <span style="opacity:.7">(vzdálenost ' + '<b style="color:' + oCol + '">' + r.distSO.toFixed(1) + ' m</b>)</span><br>'
            + 'Směrník na cíl: <b>' + r.theta.toFixed(2) + '°</b> · délka <b>' + r.dist.toFixed(2) + ' m</b>'
            + (_capSpread != null ? '<br>Rozptyl zaměření cíle: <b>±' + _capSpread.toFixed(1) + '°</b>' : '')
            + '</div>';
        var warn = '';
        if (r.distSO < 5) warn += '<div style="color:#f87171;font-size:calc(12px * var(--ag-font-scale, 1));margin-top:6px;">⚠ Orientace je velmi blízko stanoviska (' + r.distSO.toFixed(1) + ' m) — malá nepřesnost zaměření orientace se výrazně promítne do směru. Zvol vzdálenější orientační bod.</div>';
        else if (r.distSO < 15) warn += '<div style="color:#fbbf24;font-size:calc(12px * var(--ag-font-scale, 1));margin-top:6px;">Orientace je blízko — pro přesnější směr použij vzdálenější orientační bod.</div>';
        box.innerHTML = html + warn;
        box.style.display = 'block';
        if (acts) acts.style.display = 'block';
    }

    function promptName(def) {
        if (typeof window.agPrompt === 'function') return window.agPrompt({ title: 'Název bodu', value: def, okText: 'Uložit' });
        try { return Promise.resolve(prompt('Název bodu:', def)); } catch (e) { return Promise.resolve(def); }
    }
    function saveTarget() {
        if (!_result) return;
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Vkládání bodů není dostupné.'); return; }
        var r = _result;
        promptName(_targetName || 'R_rajon').then(function (nm) {
            if (nm == null) return;
            var name = (String(nm).trim() || _targetName || 'R_rajon');
            var added = window.addImportedPoints([{ name: name, lat: r.lat, lng: r.lng, origin: 'rajon' }]);
            if (added > 0) { draftClear(); agAlert('Bod uložen', '#' + name + ' uložen do zakázky (rajón: směrník ' + r.theta.toFixed(1) + '°, délka ' + r.dist.toFixed(2) + ' m).\nNajdeš ho v seznamu Body.'); }
            else agAlert('Neuloženo', 'Bod se stejným názvem a polohou už v zakázce je.');
        });
    }

    // ---- otevření/zavření + živá obnova ---------------------------------------
    var _liveTimer = null;
    function openTool() {
        ensureModal(); injectStyles(); fillSelects(); updateWarn(); renderResult();
        document.getElementById('agrj-modal').style.display = 'flex';
        if (!_liveTimer) _liveTimer = setInterval(function () {
            var m = document.getElementById('agrj-modal');
            if (m && m.style.display === 'flex' && _capIdx < 0) updateWarn();
        }, 600);
    }
    window.agCloseRajon = function () {
        var m = document.getElementById('agrj-modal'); if (m) m.style.display = 'none';
        if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
        if (_capIdx >= 0) cancelCapture();
    };
    window.agOpenRajon = openTool;

    // ---- styly (injektované) — sdílí konvence s agix/agrx ----------------------
    function injectStyles() {
        if (document.getElementById('agrj-style')) return;
        var st = document.createElement('style'); st.id = 'agrj-style';
        st.textContent = [
            '#agrj-modal .agrj-fld{display:block;margin:8px 0;}',
            '#agrj-modal .agrj-fld>span{display:block;font-size:calc(12px * var(--ag-font-scale, 1));opacity:.75;margin-bottom:3px;}',
            '#agrj-modal .agrj-fld select,#agrj-modal .agrj-fld input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:10px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.05);color:var(--text-color,#e8edf2);font:600 14px/1.1 var(--font-ui,system-ui),sans-serif;}',
            '#agrj-modal .agrj-result{margin:12px 0;padding:12px 14px;border-radius:10px;background:rgba(47,158,116,0.12);}',
            '#agrj-modal .agrj-big{font-size:calc(15px * var(--ag-font-scale, 1));margin-bottom:2px;}',
            'body.agrj-clean #ar-overlay{opacity:0!important;pointer-events:none!important;}',
            'body.agrj-clean #ar-hud{display:none!important;}',
            'body.agrj-clean #camera-container{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;',
            '  display:block!important;flex:1 1 auto!important;z-index:100040!important;}',
            'body.agrj-clean #map-container,body.agrj-clean #resizer{display:none!important;}',
            '#agrj-aim{position:fixed;inset:0;z-index:100050;display:none;pointer-events:none;}',
            '#agrj-aim.on{display:block;}',
            '#agrj-aim-bar{position:absolute;top:max(16px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);max-width:92vw;',
            '  background:rgba(8,12,16,0.82);color:#fff;padding:10px 16px;border-radius:12px;font:600 14px/1.35 var(--font-ui,system-ui),sans-serif;text-align:center;pointer-events:none;}',
            '#agrj-cross{position:absolute;top:50%;left:50%;width:120px;height:120px;margin:-60px 0 0 -60px;pointer-events:none;}',
            '#agrj-cross svg{width:100%;height:100%;filter:drop-shadow(0 0 4px rgba(0,0,0,0.7));}',
            '#agrj-cross-prog{position:absolute;left:10%;bottom:-10px;height:4px;width:0;background:var(--accent,#2f9e74);border-radius:2px;transition:width .05s linear;}',
            '#agrj-step{position:absolute;top:calc(50% + 70px);left:50%;transform:translateX(-50%);background:rgba(8,12,16,0.7);color:#cbd5e1;',
            '  padding:4px 10px;border-radius:8px;font:600 11.5px/1 var(--font-mono,monospace);pointer-events:none;}',
            '#agrj-aim-btns{position:absolute;left:0;right:0;bottom:max(24px,env(safe-area-inset-bottom));display:flex;gap:10px;justify-content:center;flex-wrap:wrap;pointer-events:auto;padding:0 16px;}',
            '#agrj-aim-btns .btn{width:auto;flex:0 0 auto;min-width:120px;}',
            '#agrj-back,#agrj-aim-cancel{min-width:92px!important;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- registrace do launcheru + fallback tlačítko --------------------------
    function register() {
        injectStyles();
        // obnova rozdělaného rajónu přes lištu „Pokračovat" (AGDraft je odpojitelný)
        if (window.AGDraft) try {
            window.AGDraft.register(DRAFT_KEY, {
                label: 'Rajón',
                open: function (st) {
                    if (st) {
                        _stId = st.stId || null; _orientId = st.orientId || null;
                        _dist = (st.dist > 0) ? st.dist : null;
                        _targetName = st.targetName || '';
                        _devOrient = (st.devOrient != null) ? st.devOrient : null;
                        _devTarget = (st.devTarget != null) ? st.devTarget : null;
                        _capSpread = (st.capSpread != null) ? st.capSpread : null;
                        _result = st.result || null;
                    }
                    openTool();   // fillSelects/renderResult uvnitř překreslí obnovený stav
                    var d = document.getElementById('agrj-dist'); if (d) d.value = (_dist != null ? _dist : '');
                    var nm = document.getElementById('agrj-name'); if (nm) nm.value = _targetName;
                }
            });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rajon:open'); }
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'rajon', label: 'Rajón (nový bod ze směru + délky)', icon: ICON, cat: 'Měření', onClick: openTool, order: 7 });
        } else {
            ensureFallbackFab();
        }
    }
    function ensureFallbackFab() {
        if (document.getElementById('agrj-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'agrj-fab'; b.type = 'button';
        b.title = 'Rajón'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:268px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#2f9e74);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        b.querySelector('svg').style.cssText = 'width:24px;height:24px;';
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
