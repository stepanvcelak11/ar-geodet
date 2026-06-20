// ===== AR Geodet — PROTÍNÁNÍ VPŘED Z ÚHLŮ (ODPOJITELNÁ vrstva) ================
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Doplněk k „AR resekci"
// (js/ar-resection.js) — řeší OPAČNOU úlohu: ze ZNÁMÝCH bodů určí souřadnice
// jednoho NEZNÁMÉHO bodu, na který se nedá dojít (přes potok, na střeše, v poli…).
//
//   Klasické protínání vpřed (jako totálkou, jen telefonem):
//     Na KAŽDÉM známém stanovisku zaměříš křížem kamery nejdřív jiný známý bod
//     (orientace), pak NEZNÁMÝ cíl P. Stačí 2 stanoviska; lze přidat DALŠÍ
//     (3, 4, …) → úloha je PŘEURČENÁ a vyrovná se metodou nejmenších čtverců.
//   Z VODOROVNÝCH ÚHLŮ na každém stanovisku (rozdíl dvou zaměření) a ze známých
//   souřadnic se protnou paprsky → poloha P. Protože se počítá ROZDÍL dvou azimutů
//   ze stejného stanoviska, KONSTANTNÍ CHYBA KOMPASU se vyruší (jako u resekce) —
//   funguje i tam, kde magnetometr blbne, a bez ohledu na přesnost GPS.
//
//   Víc stanovisek = kontrola (vidíš, jak dobře paprsky souhlasí: „shoda paprsků")
//   a robustnější poloha. Při 2 stanoviscích je výsledek čistý průsečík (shoda 0).
//
//   Během zaměřování se obrazovka „vyčistí": zůstane jen kamera, zaměřovač a
//   štítek bodu, na který právě míříš.
//
// Vstup: dlaždice „Protínání vpřed (neznámý bod)" v Nástrojích (js/field-tools.js);
//        když launcher chybí, modul si vyrobí vlastní plovoucí tlačítko.
// Odstranění: smaž js/ar-intersection.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="4" cy="19" r="2"/><circle cx="20" cy="19" r="2"/><circle cx="12" cy="4.5" r="2"/>'
        + '<path d="M5.6 17.6 11 6.3M18.4 17.6 13 6.3M6 19h12"/></svg>';

    var D2R = Math.PI / 180, R2D = 180 / Math.PI;

    // stav nástroje
    var _stations = [];   // [{stId, orientId, devOrient, devTarget}]  — stanoviska (≥2)
    var _targetName = '';
    var _steps = [];      // [{sIdx, role:'orient'|'target'}]  — rozvinuté kroky zaměřování
    var _arrived = {};    // sIdx -> true (potvrzen přesun na stanovisko); první je automaticky
    var _capIdx = -1;     // index právě zaměřovaného kroku (>=0 = běží)
    var _capSamples = [], _capTimer = null;
    var _result = null;

    // ---- pomocné --------------------------------------------------------------
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function heading() { return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; }
    function curViewMode() { try { return (typeof viewMode !== 'undefined') ? viewMode : 'both'; } catch (e) { return 'both'; } }
    function angNormDeg(a) { return ((a % 360) + 540) % 360 - 180; }      // -> (-180,180]
    function circMeanDeg(arr) {
        var s = 0, c = 0;
        arr.forEach(function (a) { s += Math.sin(a * D2R); c += Math.cos(a * D2R); });
        return Math.atan2(s, c) * R2D;
    }
    function ptById(id) { if (typeof arPoints === 'undefined') return null; return arPoints.find(function (q) { return q.id === id; }) || null; }
    function dist2(a, b) { return getDistance(a.lat, a.lng, b.lat, b.lng); }

    function candidatePoints() {
        if (typeof arPoints === 'undefined') return [];
        return arPoints.filter(function (p) { return !p.hidden; })
            .map(function (p) { return { p: p, d: haveUser() ? getDistance(userLat, userLng, p.lat, p.lng) : null }; })
            .sort(function (a, b) {
                var oa = (a.p.cat && a.p.cat !== 'CUSTOM') ? 0 : 1, ob = (b.p.cat && b.p.cat !== 'CUSTOM') ? 0 : 1;
                if (oa !== ob) return oa - ob;
                return (a.d == null || b.d == null) ? 0 : a.d - b.d;
            });
    }

    // ---- jádro: protínání vpřed z N stanovisek (vyrovnání MNČ) -----------------
    // stations = [{stId,orientId,devOrient,devTarget}], musí mít ≥2 vyplněná.
    // Každé stanovisko dá paprsek (počátek = stanovisko, směr = směrník na cíl).
    // Hledáme bod P nejblíž VŠEM paprskům: (Σ(I-uuᵀ))·P = Σ(I-uuᵀ)·s  (2×2 soustava).
    function solveMulti(stations) {
        var S0 = ptById(stations[0].stId); if (!S0) return null;
        var lat0 = S0.lat, lng0 = S0.lng;
        var mLat = 111320, mLng = 111320 * Math.cos(lat0 * D2R);

        var rays = [];
        for (var i = 0; i < stations.length; i++) {
            var st = stations[i];
            var S = ptById(st.stId), O = ptById(st.orientId);
            if (!S || !O) return null;
            var Se = (S.lng - lng0) * mLng, Sn = (S.lat - lat0) * mLat;
            var Oe = (O.lng - lng0) * mLng, On = (O.lat - lat0) * mLat;
            if (Math.hypot(Oe - Se, On - Sn) < 0.5) return null;     // orientace moc blízko stanoviska
            var betaSO = (Math.atan2(Oe - Se, On - Sn) * R2D + 360) % 360;  // směrník stanovisko→orientace
            var ang = angNormDeg(st.devTarget - st.devOrient);              // vodorovný úhel (ruší bias kompasu)
            var theta = ((betaSO + ang) % 360 + 360) % 360;                 // směrník stanovisko→cíl
            rays.push({ e: Se, n: Sn, ue: Math.sin(theta * D2R), un: Math.cos(theta * D2R), theta: theta, name: S.name });
        }

        // normální rovnice
        var Axx = 0, Axy = 0, Ayy = 0, bx = 0, by = 0;
        rays.forEach(function (r) {
            var ee = 1 - r.ue * r.ue, en = -r.ue * r.un, nn = 1 - r.un * r.un;
            Axx += ee; Axy += en; Ayy += nn;
            bx += ee * r.e + en * r.n;
            by += en * r.e + nn * r.n;
        });
        var det = Axx * Ayy - Axy * Axy;
        if (Math.abs(det) < 1e-9) return null;                  // všechny paprsky ~rovnoběžné
        var Pe = (bx * Ayy - Axy * by) / det;
        var Pn = (Axx * by - Axy * bx) / det;

        // rezidua: kolmá vzdálenost P od každého paprsku + délka podél paprsku
        var miss = [], dists = [], behind = false, sse = 0;
        rays.forEach(function (r) {
            var dx = Pe - r.e, dy = Pn - r.n;
            var t = dx * r.ue + dy * r.un; dists.push(t); if (t <= 0) behind = true;
            var px = dx - t * r.ue, py = dy - t * r.un;
            var d = Math.hypot(px, py); miss.push(d); sse += d * d;
        });
        var rms = Math.sqrt(sse / rays.length);
        var maxMiss = miss.reduce(function (a, b2) { return Math.max(a, b2); }, 0);

        // kvalita geometrie: nejlepší (největší) úhel protnutí mezi dvojicí paprsků
        var bestAngle = 0;
        for (var a = 0; a < rays.length; a++) for (var b = a + 1; b < rays.length; b++) {
            var ang2 = Math.abs(angNormDeg(rays[b].theta - rays[a].theta)); if (ang2 > 90) ang2 = 180 - ang2;
            if (ang2 > bestAngle) bestAngle = ang2;
        }

        var latP = lat0 + Pn / mLat, lngP = lng0 + Pe / mLng;
        var sj = null; try { sj = proj4('EPSG:4326', 'EPSG:5514', [lngP, latP]); } catch (e) {}
        return {
            lat: latP, lng: lngP,
            Y: sj ? Math.abs(sj[0]) : null, X: sj ? Math.abs(sj[1]) : null,
            n: rays.length, rms: rms, maxMiss: maxMiss, angleP: bestAngle,
            behind: behind, dists: dists, rays: rays
        };
    }

    // ---- UI: hlavní (nastavovací) modal ---------------------------------------
    function ensureModal() {
        if (document.getElementById('agix-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agix-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;max-height:88vh;max-height:88dvh;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Protínání vpřed — neznámý bod</h3>'
            + '<p style="font-size:12.5px;opacity:.82;margin:2px 0 10px;line-height:1.45;">Urči bod, na který se nedá dojít, ze <b>známých bodů</b>. '
            + 'Na každém stanovisku zaměříš orientační bod a cíl. Stačí <b>2 stanoviska</b>; přidej další pro <b>kontrolu a zpřesnění</b> (vyrovná se MNČ). '
            + 'Rozdíl úhlů ruší chybu kompasu — funguje i bez přesné GPS.</p>'
            + '<div id="agix-stations"></div>'
            + '<button class="btn btn-secondary" id="agix-add" style="margin:2px 0 8px;"><svg class="icon"><use href="#i-plus"/></svg> Přidat stanovisko</button>'
            + '<label class="agix-fld"><span>Název neznámého cíle</span><input type="text" id="agix-name" placeholder="např. P1" maxlength="24"></label>'
            + '<div id="agix-warn" style="font-size:12px;color:#fbbf24;margin:4px 2px;"></div>'
            + '<button class="btn" id="agix-start"><svg class="icon"><use href="#i-crosshair"/></svg> Spustit zaměřování</button>'
            + '<div id="agix-result" class="agix-result" style="display:none;"></div>'
            + '<div id="agix-actions" style="display:none;">'
            + '  <button class="btn btn-blue" id="agix-save"><svg class="icon"><use href="#i-plus"/></svg> Uložit cíl jako bod</button>'
            + '  <button class="btn btn-secondary" id="agix-redo" style="margin-top:10px;"><svg class="icon"><use href="#i-rotate-ccw"/></svg> Zaměřit znovu</button>'
            + '</div>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" onclick="window.agCloseIntersection&&window.agCloseIntersection()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('agix-name').addEventListener('input', function (e) { _targetName = e.target.value; });
        document.getElementById('agix-add').addEventListener('click', function () { _stations.push({ stId: null, orientId: null, devOrient: null, devTarget: null }); fillStations(); onModelChange(); });
        document.getElementById('agix-start').addEventListener('click', startCapture);
        document.getElementById('agix-save').addEventListener('click', saveTarget);
        document.getElementById('agix-redo').addEventListener('click', function () { clearShots(); _result = null; renderResult(); updateWarn(); });
    }

    function ensureMinStations() { while (_stations.length < 2) _stations.push({ stId: null, orientId: null, devOrient: null, devTarget: null }); }
    function clearShots() { _stations.forEach(function (s) { s.devOrient = null; s.devTarget = null; }); _arrived = {}; }
    function onModelChange() { _result = null; clearShots(); renderResult(); updateWarn(); }

    function stationOptions(selId) {
        var list = candidatePoints();
        var h = '<option value="">— vyber bod —</option>';
        list.slice(0, 80).forEach(function (x) {
            var tag = (x.p.cat && x.p.cat !== 'CUSTOM') ? ' [' + x.p.cat + ']' : '';
            var dd = (x.d != null ? ' · ' + x.d.toFixed(0) + ' m' : '');
            h += '<option value="' + x.p.id + '"' + (selId === x.p.id ? ' selected' : '') + '>#' + x.p.name + tag + dd + '</option>';
        });
        return h;
    }
    function fillStations() {
        var host = document.getElementById('agix-stations'); if (!host) return;
        ensureMinStations();
        var html = '';
        _stations.forEach(function (s, k) {
            html += '<div class="agix-st">'
                + '<div class="agix-st-h">Stanovisko ' + (k + 1) + (k >= 2 ? '<button type="button" class="agix-st-rm" data-k="' + k + '" title="Odebrat">✕</button>' : '') + '</div>'
                + '<label class="agix-fld"><span>stojím na</span><select class="agix-st-id" data-k="' + k + '">' + stationOptions(s.stId) + '</select></label>'
                + '<label class="agix-fld"><span>orientace — zaměřím známý bod</span><select class="agix-or-id" data-k="' + k + '">' + stationOptions(s.orientId) + '</select></label>'
                + '</div>';
        });
        host.innerHTML = html;
        Array.prototype.forEach.call(host.querySelectorAll('.agix-st-id'), function (sel) {
            sel.addEventListener('change', function () { _stations[+sel.getAttribute('data-k')].stId = sel.value || null; onModelChange(); });
        });
        Array.prototype.forEach.call(host.querySelectorAll('.agix-or-id'), function (sel) {
            sel.addEventListener('change', function () { _stations[+sel.getAttribute('data-k')].orientId = sel.value || null; onModelChange(); });
        });
        Array.prototype.forEach.call(host.querySelectorAll('.agix-st-rm'), function (b) {
            b.addEventListener('click', function () { _stations.splice(+b.getAttribute('data-k'), 1); fillStations(); onModelChange(); });
        });
    }

    function filledStations() { return _stations.filter(function (s) { return s.stId && s.orientId; }); }

    function updateWarn() {
        var w = document.getElementById('agix-warn'), btn = document.getElementById('agix-start');
        if (!w) return;
        var msg = '', ok = true;
        var filled = filledStations();
        if (heading() == null) { msg = 'Kompas zatím nedává směr — podrž telefon svisle a chvíli počkej.'; ok = false; }
        else if (curViewMode() === 'map') { msg = 'Zapni zobrazení s kamerou (AR nebo Split) — zaměřuje se přes kameru.'; ok = false; }
        if (filled.length < 2) { if (!msg) msg = 'Vyplň aspoň 2 stanoviska (kde stojíš + na co se orientuješ).'; ok = false; }
        else {
            var sids = {}; filled.forEach(function (s) { sids[s.stId] = 1; });
            if (Object.keys(sids).length < 2) { msg = 'Stanoviska musí být aspoň dvě různá místa.'; ok = false; }
            filled.forEach(function (s) { if (s.stId === s.orientId) { msg = 'Na stanovisku se orientuj na JINÝ bod, než na kterém stojíš.'; ok = false; } });
        }
        w.innerHTML = msg;
        if (btn) btn.disabled = !ok;
    }

    // ---- zaměřovací režim (přes kameru) — VYČIŠTĚNÁ obrazovka ------------------
    function declutter(on) {
        document.body.classList.toggle('agix-clean', !!on);
        if (!on) { try { if (typeof applyViewMode === 'function') applyViewMode(); } catch (e) {} }
    }
    function ensureAim() {
        if (document.getElementById('agix-aim')) return;
        var a = document.createElement('div');
        a.id = 'agix-aim';
        a.innerHTML =
            '<div id="agix-aim-bar"><span id="agix-aim-txt"></span></div>'
            + '<div id="agix-cross"><svg viewBox="0 0 100 100">'
            + '<circle id="agix-ring" cx="50" cy="50" r="30" fill="none" stroke="#34d399" stroke-width="2"/>'
            + '<line x1="50" y1="6" x2="50" y2="30" stroke="#34d399" stroke-width="2"/><line x1="50" y1="70" x2="50" y2="94" stroke="#34d399" stroke-width="2"/>'
            + '<line x1="6" y1="50" x2="30" y2="50" stroke="#34d399" stroke-width="2"/><line x1="70" y1="50" x2="94" y2="50" stroke="#34d399" stroke-width="2"/>'
            + '<circle cx="50" cy="50" r="2.5" fill="#34d399"/></svg><div id="agix-cross-prog"></div></div>'
            + '<div id="agix-step"></div>'
            + '<div id="agix-aim-btns">'
            + '  <button id="agix-gate" class="btn" style="display:none;">Jsem na stanovisku → pokračovat</button>'
            + '  <button id="agix-shot" class="btn">Zaměřit</button>'
            + '  <button id="agix-back" class="btn btn-secondary">← Zpět</button>'
            + '  <button id="agix-aim-cancel" class="btn btn-secondary">Zrušit</button>'
            + '</div>';
        document.body.appendChild(a);
        document.getElementById('agix-shot').addEventListener('click', takeShot);
        document.getElementById('agix-gate').addEventListener('click', function () { var s = _steps[_capIdx]; if (s) _arrived[s.sIdx] = true; promptStep(); });
        document.getElementById('agix-back').addEventListener('click', stepBack);
        document.getElementById('agix-aim-cancel').addEventListener('click', cancelCapture);
    }
    function showAim(on) { ensureAim(); document.getElementById('agix-aim').classList.toggle('on', !!on); }

    function buildSteps() {
        _steps = [];
        _stations.forEach(function (s, k) {
            if (!s.stId || !s.orientId) return;
            _steps.push({ sIdx: k, role: 'orient' });
            _steps.push({ sIdx: k, role: 'target' });
        });
    }

    function startCapture() {
        updateWarn();
        var startBtn = document.getElementById('agix-start'); if (startBtn && startBtn.disabled) return;
        if (curViewMode() === 'map') { agAlert('Zapni kameru', 'Přepni zobrazení na AR nebo Split — zaměřuje se přes kameru.'); return; }
        buildSteps();
        if (_steps.length < 4) { updateWarn(); return; }
        clearShots(); _result = null; _capIdx = 0;
        _arrived[_steps[0].sIdx] = true;   // na prvním stanovisku už stojím
        document.getElementById('agix-modal').style.display = 'none';
        declutter(true);
        showAim(true);
        promptStep();
    }

    function promptStep() {
        if (_capIdx >= _steps.length) { finishCapture(); return; }
        var step = _steps[_capIdx];
        var st = _stations[step.sIdx];
        var stPt = ptById(st.stId), orPt = ptById(st.orientId);
        var bar = document.getElementById('agix-aim-txt'), stepEl = document.getElementById('agix-step');
        var gate = document.getElementById('agix-gate'), shot = document.getElementById('agix-shot'), back = document.getElementById('agix-back');
        var ring = document.getElementById('agix-ring');

        // brána přesunu na stanovisko (před prvním krokem stanoviska, kam jsme ještě nepřišli)
        if (step.role === 'orient' && !_arrived[step.sIdx]) {
            if (bar) bar.innerHTML = 'Přejdi a postav se přesně na <b>#' + (stPt ? stPt.name : '?') + '</b> (stanovisko ' + (step.sIdx + 1) + ').';
            if (stepEl) stepEl.innerHTML = 'přesun na stanovisko ' + (step.sIdx + 1);
            if (gate) { gate.style.display = 'block'; gate.innerText = 'Jsem na #' + (stPt ? stPt.name : '') + ' → pokračovat'; }
            if (shot) shot.style.display = 'none';
            if (back) back.style.display = 'inline-flex';
            return;
        }
        if (gate) gate.style.display = 'none';
        if (shot) shot.style.display = 'inline-flex';
        if (back) back.style.display = (_capIdx > 0) ? 'inline-flex' : 'none';

        var isTarget = (step.role === 'target');
        if (ring) ring.setAttribute('stroke', isTarget ? '#fbbf24' : '#34d399');
        var crossSvg = document.querySelectorAll('#agix-cross svg line, #agix-cross svg circle');
        crossSvg.forEach(function (n) { if (n.getAttribute('fill') === '#34d399' || n.getAttribute('fill') === '#fbbf24') n.setAttribute('fill', isTarget ? '#fbbf24' : '#34d399'); if (n.getAttribute('stroke')) n.setAttribute('stroke', isTarget ? '#fbbf24' : '#34d399'); });

        if (isTarget) {
            if (bar) bar.innerHTML = 'Stoj na <b>#' + (stPt ? stPt.name : '?') + '</b> · zaměř <b style="color:#fbbf24">NEZNÁMÝ CÍL</b>'
                + (_targetName ? ' (' + _targetName + ')' : '') + (step.sIdx > 0 ? '<br><span style="opacity:.75;font-size:12px">stejný bod jako z ostatních stanovisek!</span>' : '');
        } else {
            var dTxt = (orPt && stPt) ? ' · ' + dist2(stPt, orPt).toFixed(0) + ' m' : '';
            if (bar) bar.innerHTML = 'Stoj na <b>#' + (stPt ? stPt.name : '?') + '</b> · zaměř známý <b>#' + (orPt ? orPt.name : '?') + '</b>' + dTxt
                + '<br><span style="opacity:.75;font-size:12px">orientace — srovná stanovisko</span>';
        }
        if (stepEl) stepEl.innerHTML = 'krok ' + (_capIdx + 1) + ' z ' + _steps.length + ' · stanovisko ' + (step.sIdx + 1);
        if (shot) { shot.disabled = false; shot.innerText = isTarget ? 'Zaměřit cíl' : 'Zaměřit #' + (orPt ? orPt.name : ''); }
    }

    function stepBack() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        if (_capIdx <= 0) { cancelCapture(); return; }
        var cur = _steps[_capIdx];
        // jsme-li na začátku nového stanoviska, krok zpět zruší jeho „příchod" (vrátí bránu)
        if (cur && cur.role === 'orient' && _steps[_capIdx - 1] && _steps[_capIdx - 1].sIdx !== cur.sIdx) { _arrived[cur.sIdx] = false; }
        _capIdx--;
        var prev = _steps[_capIdx];
        if (prev.role === 'orient') _stations[prev.sIdx].devOrient = null; else _stations[prev.sIdx].devTarget = null;
        promptStep();
    }

    function takeShot() {
        if (heading() == null) { toast('Kompas nedává směr'); return; }
        var shotBtn = document.getElementById('agix-shot'); if (shotBtn) shotBtn.disabled = true;
        _capSamples = []; var dur = 1100, stepMs = 90, prog = document.getElementById('agix-cross-prog'); var t0 = 0;
        if (_capTimer) clearInterval(_capTimer);
        _capTimer = setInterval(function () {
            var h = heading(); if (h != null) _capSamples.push(h);
            t0 += stepMs; if (prog) prog.style.width = Math.min(100, (t0 / dur) * 100) + '%';
            if (t0 >= dur) {
                clearInterval(_capTimer); _capTimer = null; if (prog) prog.style.width = '0%';
                if (!_capSamples.length) { if (shotBtn) shotBtn.disabled = false; toast('Nezachyceno'); return; }
                var az = (circMeanDeg(_capSamples) + 360) % 360;
                var step = _steps[_capIdx];
                if (step.role === 'orient') _stations[step.sIdx].devOrient = az; else _stations[step.sIdx].devTarget = az;
                if (navigator.vibrate) try { navigator.vibrate(25); } catch (e) {}
                _capIdx++;
                promptStep();
            }
        }, stepMs);
    }

    function cancelCapture() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        _capIdx = -1; showAim(false); declutter(false);
        var m = document.getElementById('agix-modal'); if (m) m.style.display = 'flex';
        fillStations(); updateWarn(); renderResult();
    }
    function finishCapture() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        _capIdx = -1; showAim(false); declutter(false);
        var m = document.getElementById('agix-modal'); if (m) m.style.display = 'flex';
        compute();
        fillStations(); updateWarn(); renderResult();
    }

    function compute() {
        var filled = _stations.filter(function (s) { return s.stId && s.orientId && s.devOrient != null && s.devTarget != null; });
        if (filled.length < 2) { _result = null; return; }
        _result = solveMulti(filled);
        if (_result) _result.names = filled.map(function (s) { var p = ptById(s.stId); return p ? p.name : '?'; });
    }

    function renderResult() {
        var box = document.getElementById('agix-result'), acts = document.getElementById('agix-actions');
        if (!box) return;
        if (!_result) { box.style.display = 'none'; if (acts) acts.style.display = 'none'; return; }
        var r = _result;
        var qCol = r.angleP < 20 ? '#f87171' : (r.angleP < 35 ? '#fbbf24' : '#34d399');
        var html = '<div class="agix-big">Neznámý cíl ' + (_targetName ? '<b>' + _targetName + '</b> ' : '') + 'určen <span style="opacity:.7;font-size:12px">(' + r.n + ' stanoviska)</span></div>'
            + '<div style="margin:6px 0;font-family:var(--font-mono,monospace);font-size:13px;">'
            + 'S-JTSK:&nbsp; <b>Y</b> ' + (r.Y != null ? r.Y.toFixed(2) : '—') + ' &nbsp; <b>X</b> ' + (r.X != null ? r.X.toFixed(2) : '—') + '</div>'
            + '<div style="font-size:12.5px;opacity:.9;line-height:1.5;">'
            + 'Stanoviska: <b>#' + r.names.join('</b>, #') + '</b><br>'
            + 'Úhel protnutí: <b style="color:' + qCol + '">' + r.angleP.toFixed(0) + '°</b> <span style="opacity:.7">(ideál ~90°)</span>'
            + (r.n > 2 ? '<br>Shoda paprsků: <b>' + fmtMiss(r.rms) + '</b> <span style="opacity:.7">(rms odchylka, ⌀ jak dobře paprsky souhlasí)</span>' : '')
            + '</div>';
        var warn = '';
        if (r.behind) warn += '<div style="color:#f87171;font-size:12px;margin-top:6px;">⚠ Cíl vyšel „za zády" některého stanoviska — nejspíš zaměněné body nebo špatné zaměření. Zkontroluj a zaměř znovu.</div>';
        if (r.angleP < 20) warn += '<div style="color:#f87171;font-size:12px;margin-top:4px;">⚠ Velmi ostrý úhel protnutí — poloha je nejistá. Zvol stanoviska tak, ať svírají s cílem úhel blíž 90°.</div>';
        else if (r.angleP < 35) warn += '<div style="color:#fbbf24;font-size:12px;margin-top:4px;">Úhel protnutí je malý — výsledek je citlivý na přesnost zaměření.</div>';
        if (r.n > 2 && r.maxMiss > 1.0) warn += '<div style="color:#fbbf24;font-size:12px;margin-top:4px;">Paprsky se rozcházejí až o ' + fmtMiss(r.maxMiss) + ' — některé stanovisko může být zaměřené nepřesně.</div>';
        box.innerHTML = html + warn;
        box.style.display = 'block';
        if (acts) acts.style.display = 'block';
    }
    function fmtMiss(d) { return d < 1 ? (d * 100).toFixed(0) + ' cm' : d.toFixed(2) + ' m'; }

    function saveTarget() {
        if (!_result) return;
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Vkládání bodů není dostupné.'); return; }
        var name = _targetName;
        try { name = prompt('Název bodu:', _targetName || 'P_protnuti') || _targetName || 'P_protnuti'; } catch (e) { name = _targetName || 'P_protnuti'; }
        var added = window.addImportedPoints([{ name: name, lat: _result.lat, lng: _result.lng }]);
        if (added > 0) agAlert('Bod uložen', '#' + name + ' uložen do zakázky (protínání vpřed z ' + _result.n + ' stanovisek, úhel ' + _result.angleP.toFixed(0) + '°).\nNajdeš ho v seznamu Body.');
        else agAlert('Neuloženo', 'Bod se stejným názvem a polohou už v zakázce je.');
    }

    // ---- otevření/zavření + živá obnova ---------------------------------------
    var _liveTimer = null;
    function openTool() {
        ensureModal(); injectStyles(); fillStations(); updateWarn(); renderResult();
        document.getElementById('agix-modal').style.display = 'flex';
        if (!_liveTimer) _liveTimer = setInterval(function () {
            var m = document.getElementById('agix-modal');
            if (m && m.style.display === 'flex' && _capIdx < 0) updateWarn();
        }, 600);
    }
    window.agCloseIntersection = function () {
        var m = document.getElementById('agix-modal'); if (m) m.style.display = 'none';
        if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
        if (_capIdx >= 0) cancelCapture();
    };
    window.agOpenIntersection = openTool;

    // ---- styly (injektované) ---------------------------------------------------
    function injectStyles() {
        if (document.getElementById('agix-style')) return;
        var st = document.createElement('style'); st.id = 'agix-style';
        st.textContent = [
            '#agix-modal .agix-fld{display:block;margin:8px 0;}',
            '#agix-modal .agix-fld>span{display:block;font-size:12px;opacity:.75;margin-bottom:3px;}',
            '#agix-modal .agix-fld select,#agix-modal .agix-fld input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:10px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.05);color:var(--text-color,#e8edf2);font:600 14px/1.1 var(--font,system-ui),sans-serif;}',
            '#agix-modal .agix-st{border:1px solid var(--glass-border,rgba(255,255,255,0.12));border-radius:12px;padding:6px 12px 10px;margin:8px 0;background:rgba(255,255,255,0.025);}',
            '#agix-modal .agix-st-h{display:flex;align-items:center;justify-content:space-between;font-size:12.5px;font-weight:700;color:var(--accent);margin-top:6px;}',
            '#agix-modal .agix-st-rm{background:rgba(239,68,68,0.18);color:#f87171;border:none;border-radius:8px;width:26px;height:26px;font-size:13px;line-height:1;cursor:pointer;}',
            '#agix-modal .agix-result{margin:12px 0;padding:12px 14px;border-radius:10px;background:rgba(52,211,153,0.12);}',
            '#agix-modal .agix-big{font-size:15px;margin-bottom:2px;}',
            // VYČIŠTĚNÁ obrazovka během zaměřování: jen kamera + zaměřovač + štítek
            'body.agix-clean #ar-overlay{opacity:0!important;pointer-events:none!important;}',
            'body.agix-clean #ar-hud{display:none!important;}',
            'body.agix-clean #camera-container{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;',
            '  display:block!important;flex:1 1 auto!important;z-index:100040!important;}',
            'body.agix-clean #map-container,body.agix-clean #resizer{display:none!important;}',
            // zaměřovací vrstva
            '#agix-aim{position:fixed;inset:0;z-index:100050;display:none;pointer-events:none;}',
            '#agix-aim.on{display:block;}',
            '#agix-aim-bar{position:absolute;top:max(16px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);max-width:92vw;',
            '  background:rgba(8,12,16,0.82);color:#fff;padding:10px 16px;border-radius:12px;font:600 14px/1.35 var(--font,system-ui),sans-serif;text-align:center;pointer-events:none;}',
            '#agix-cross{position:absolute;top:50%;left:50%;width:120px;height:120px;margin:-60px 0 0 -60px;pointer-events:none;}',
            '#agix-cross svg{width:100%;height:100%;filter:drop-shadow(0 0 4px rgba(0,0,0,0.7));}',
            '#agix-cross-prog{position:absolute;left:10%;bottom:-10px;height:4px;width:0;background:var(--accent,#34d399);border-radius:2px;transition:width .05s linear;}',
            '#agix-step{position:absolute;top:calc(50% + 70px);left:50%;transform:translateX(-50%);background:rgba(8,12,16,0.7);color:#cbd5e1;',
            '  padding:4px 10px;border-radius:8px;font:600 11.5px/1 var(--font-mono,monospace);pointer-events:none;}',
            '#agix-aim-btns{position:absolute;left:0;right:0;bottom:max(24px,env(safe-area-inset-bottom));display:flex;gap:10px;justify-content:center;flex-wrap:wrap;pointer-events:auto;padding:0 16px;}',
            '#agix-aim-btns .btn{width:auto;flex:0 0 auto;min-width:120px;}',
            '#agix-back,#agix-aim-cancel{min-width:92px!important;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- registrace do launcheru + fallback tlačítko --------------------------
    function register() {
        injectStyles();
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'ar-intersection', label: 'Protínání vpřed (neznámý bod)', icon: ICON, onClick: openTool, order: 6 });
        } else {
            ensureFallbackFab();
        }
    }
    function ensureFallbackFab() {
        if (document.getElementById('agix-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'agix-fab'; b.type = 'button';
        b.title = 'Protínání vpřed'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:212px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#34d399);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        b.querySelector('svg').style.cssText = 'width:24px;height:24px;';
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
