// ===== AR Geodet — PROTÍNÁNÍ VPŘED Z ÚHLŮ (ODPOJITELNÁ vrstva) ================
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Doplněk k „AR resekci"
// (js/ar-resection.js) — řeší OPAČNOU úlohu: z DVOU známých bodů určí souřadnice
// jednoho NEZNÁMÉHO bodu, na který se nedá dojít (přes potok, na střeše, v poli…).
//
//   Klasické protínání vpřed (jako totálkou, jen telefonem):
//     1) Postav se na známý bod A. Křížem kamery zaměř druhý známý bod B
//        (orientace), pak zaměř NEZNÁMÝ cíl P.
//     2) Přejdi na známý bod B. Zaměř zpět na A (orientace), pak zaměř cíl P.
//   Z VODOROVNÝCH ÚHLŮ na každém stanovisku (rozdíl dvou zaměření) a ze známých
//   souřadnic A,B se protnou dva paprsky → poloha P. Protože se počítá ROZDÍL
//   dvou azimutů ze stejného stanoviska, KONSTANTNÍ CHYBA KOMPASU se vyruší
//   (stejný princip jako u resekce) — funguje i tam, kde magnetometr blbne, a
//   bez ohledu na přesnost GPS (stanoviska jsou dané body, ne GPS).
//
//   Během zaměřování se obrazovka „vyčistí": zůstane jen kamera, zaměřovač a
//   štítek bodu, na který právě míříš — ať se cíl pohodlně srovná s realitou.
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
    var _selA = null, _selB = null;     // id stanoviska A a B (známé body)
    var _targetName = '';               // název neznámého cíle
    var _steps = [];                    // [{st,role,aimId,key}]
    var _shots = {};                    // key -> azimut zařízení (stupně)
    var _capIdx = -1;                   // index právě zaměřovaného kroku (>=0 = běží)
    var _gateDone = false;              // potvrzen přesun na stanovisko B
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

    // body vhodné jako stanovisko: úřední (autoritativní souřadnice) napřed
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

    // ---- jádro: protínání vpřed -----------------------------------------------
    // A,B = {lat,lng} známé. Zaměření zařízení (stupně): devAB,devAP na stanovisku A,
    // devBA,devBP na stanovisku B. Vrací polohu P + ukazatele kvality.
    function solveIntersection(A, B, devAB, devAP, devBA, devBP) {
        var lat0 = A.lat, lng0 = A.lng;
        var mLat = 111320, mLng = 111320 * Math.cos(lat0 * D2R);
        var EA = 0, NA = 0;
        var EB = (B.lng - lng0) * mLng, NB = (B.lat - lat0) * mLat;
        var base = Math.hypot(EB, NB);
        if (base < 0.5) return null;

        var beta_AB = (Math.atan2(EB - EA, NB - NA) * R2D + 360) % 360;   // směrník A→B
        var beta_BA = (Math.atan2(EA - EB, NA - NB) * R2D + 360) % 360;   // směrník B→A
        var inclA = angNormDeg(devAP - devAB);   // vodorovný úhel na A (B→P), ruší bias kompasu
        var inclB = angNormDeg(devBP - devBA);   // vodorovný úhel na B (A→P)
        var thA = (beta_AB + inclA) % 360;        // směrník A→P
        var thB = (beta_BA + inclB) % 360;        // směrník B→P

        var sA = Math.sin(thA * D2R), cA = Math.cos(thA * D2R);
        var sB = Math.sin(thB * D2R), cB = Math.cos(thB * D2R);
        var det = sA * (-cB) - (-sB) * cA;        // = sin(thB - thA)
        if (Math.abs(det) < 1e-6) return null;    // paprsky rovnoběžné
        var tA = ((EB - EA) * (-cB) - (-sB) * (NB - NA)) / det;   // délka A→P (m)
        var tB = ((EB - EA) * (-cA) - (-sA) * (NB - NA)) / det;   // délka B→P (m)

        var EP = EA + tA * sA, NP = NA + tA * cA;
        var latP = lat0 + NP / mLat, lngP = lng0 + EP / mLng;

        // úhel protnutí u P (kvalita geometrie): ideál ~90°, špatně blízko 0/180°
        var angP = Math.abs(angNormDeg(thB - thA)); if (angP > 90) angP = 180 - angP;
        // jak dobře se shodne poloha P spočtená z paprsku A a z paprsku B (u 2 paprsků 0)
        var EP2 = EB + tB * sB, NP2 = NB + tB * cB;
        var closure = Math.hypot(EP - EP2, NP - NP2);

        var sj = null; try { sj = proj4('EPSG:4326', 'EPSG:5514', [lngP, latP]); } catch (e) {}
        return {
            lat: latP, lng: lngP,
            Y: sj ? Math.abs(sj[0]) : null, X: sj ? Math.abs(sj[1]) : null,
            base: base, distA: tA, distB: tB, angleP: angP, closure: closure,
            inclA: inclA, inclB: inclB, thA: thA, thB: thB,
            behind: (tA <= 0 || tB <= 0)
        };
    }

    // ---- UI: hlavní (nastavovací) modal ---------------------------------------
    function ensureModal() {
        if (document.getElementById('agix-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agix-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Protínání vpřed — neznámý bod</h3>'
            + '<p style="font-size:12.5px;opacity:.82;margin:2px 0 10px;line-height:1.45;">Urči bod, na který se nedá dojít, ze <b>dvou známých bodů</b>. '
            + 'Postav se na <b>A</b>, zaměř <b>B</b> i cíl; pak na <b>B</b>, zaměř <b>A</b> i cíl. '
            + 'Z vodorovných úhlů se protnou dva paprsky. Rozdíl úhlů ruší chybu kompasu — funguje i bez přesné GPS.</p>'
            + '<label class="agix-fld"><span>Stanovisko A (1. známý bod)</span><select id="agix-selA"></select></label>'
            + '<label class="agix-fld"><span>Stanovisko B (2. známý bod)</span><select id="agix-selB"></select></label>'
            + '<label class="agix-fld"><span>Název neznámého cíle</span><input type="text" id="agix-name" placeholder="např. P1" maxlength="24"></label>'
            + '<div id="agix-base" class="agix-base"></div>'
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
        document.getElementById('agix-selA').addEventListener('change', onSelChange);
        document.getElementById('agix-selB').addEventListener('change', onSelChange);
        document.getElementById('agix-name').addEventListener('input', function (e) { _targetName = e.target.value; });
        document.getElementById('agix-start').addEventListener('click', startCapture);
        document.getElementById('agix-save').addEventListener('click', saveTarget);
        document.getElementById('agix-redo').addEventListener('click', function () { _shots = {}; _result = null; renderResult(); });
    }

    function fillSelects() {
        var list = candidatePoints();
        var selA = document.getElementById('agix-selA'), selB = document.getElementById('agix-selB');
        if (!selA || !selB) return;
        function opts(selId) {
            var h = '<option value="">— vyber bod —</option>';
            list.slice(0, 80).forEach(function (x) {
                var tag = (x.p.cat && x.p.cat !== 'CUSTOM') ? ' [' + x.p.cat + ']' : '';
                var dd = (x.d != null ? ' · ' + x.d.toFixed(0) + ' m' : '');
                h += '<option value="' + x.p.id + '"' + (selId === x.p.id ? ' selected' : '') + '>#' + x.p.name + tag + dd + '</option>';
            });
            return h;
        }
        selA.innerHTML = opts(_selA); selB.innerHTML = opts(_selB);
    }
    function onSelChange() {
        _selA = document.getElementById('agix-selA').value || null;
        _selB = document.getElementById('agix-selB').value || null;
        _shots = {}; _result = null; renderResult();
        updateWarn();
    }

    function updateWarn() {
        var w = document.getElementById('agix-warn'), btn = document.getElementById('agix-start'), baseEl = document.getElementById('agix-base');
        if (!w) return;
        var A = ptById(_selA), B = ptById(_selB), msg = '', ok = true;
        if (baseEl) baseEl.innerHTML = '';
        if (heading() == null) { msg = 'Kompas zatím nedává směr — podrž telefon svisle a chvíli počkej.'; ok = false; }
        else if (curViewMode() === 'map') { msg = 'Zapni zobrazení s kamerou (AR nebo Split) — zaměřuje se přes kameru.'; ok = false; }
        if (!A || !B) { if (!msg) msg = 'Vyber dvě stanoviska (známé body A a B).'; ok = false; }
        else if (_selA === _selB) { msg = 'A a B musí být různé body.'; ok = false; }
        else {
            var base = dist2(A, B);
            if (baseEl) baseEl.innerHTML = 'Základna A–B: <b>' + base.toFixed(1) + ' m</b>';
            if (base < 2) { msg = msg || 'Body A a B jsou příliš blízko (krátká základna = nejistý výsledek).'; }
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
            + '  <button id="agix-gate" class="btn" style="display:none;">Jsem na bodu B → pokračovat</button>'
            + '  <button id="agix-shot" class="btn">Zaměřit</button>'
            + '  <button id="agix-back" class="btn btn-secondary">← Zpět</button>'
            + '  <button id="agix-aim-cancel" class="btn btn-secondary">Zrušit</button>'
            + '</div>';
        document.body.appendChild(a);
        document.getElementById('agix-shot').addEventListener('click', takeShot);
        document.getElementById('agix-gate').addEventListener('click', function () { _gateDone = true; promptStep(); });
        document.getElementById('agix-back').addEventListener('click', stepBack);
        document.getElementById('agix-aim-cancel').addEventListener('click', cancelCapture);
    }
    function showAim(on) { ensureAim(); document.getElementById('agix-aim').classList.toggle('on', !!on); }

    function buildSteps() {
        _steps = [
            { st: 'A', role: 'orient', aimId: _selB, key: 'AB' },
            { st: 'A', role: 'target', aimId: null, key: 'AP' },
            { st: 'B', role: 'orient', aimId: _selA, key: 'BA' },
            { st: 'B', role: 'target', aimId: null, key: 'BP' }
        ];
    }

    function startCapture() {
        var A = ptById(_selA), B = ptById(_selB);
        if (!A || !B || _selA === _selB || heading() == null) { updateWarn(); return; }
        if (curViewMode() === 'map') { agAlert('Zapni kameru', 'Přepni zobrazení na AR nebo Split — zaměřuje se přes kameru.'); return; }
        _shots = {}; _result = null; _gateDone = false; _capIdx = 0;
        buildSteps();
        document.getElementById('agix-modal').style.display = 'none';
        declutter(true);
        showAim(true);
        promptStep();
    }

    function promptStep() {
        if (_capIdx >= _steps.length) { finishCapture(); return; }
        var step = _steps[_capIdx];
        var bar = document.getElementById('agix-aim-txt'), stepEl = document.getElementById('agix-step');
        var gate = document.getElementById('agix-gate'), shot = document.getElementById('agix-shot'), back = document.getElementById('agix-back');
        var ring = document.getElementById('agix-ring');
        var stPt = ptById(step.st === 'A' ? _selA : _selB);
        var aimPt = step.aimId ? ptById(step.aimId) : null;

        // brána přesunu A→B (před prvním krokem na stanovisku B)
        if (step.st === 'B' && !_gateDone) {
            if (bar) bar.innerHTML = 'Hotovo na <b>#' + (ptById(_selA) ? ptById(_selA).name : 'A') + '</b>.<br>Přejdi a postav se přesně na <b>#' + (stPt ? stPt.name : 'B') + '</b>.';
            if (stepEl) stepEl.innerHTML = 'přesun na 2. stanovisko';
            if (gate) gate.style.display = 'block';
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

        var dTxt = '';
        if (!isTarget && aimPt && stPt) dTxt = ' · ' + dist2(stPt, aimPt).toFixed(0) + ' m';
        if (isTarget) {
            if (bar) bar.innerHTML = 'Stoj na <b>#' + (stPt ? stPt.name : '?') + '</b> · zaměř <b style="color:#fbbf24">NEZNÁMÝ CÍL</b>'
                + (_targetName ? ' (' + _targetName + ')' : '') + (step.key === 'BP' ? '<br><span style="opacity:.75;font-size:12px">stejný bod jako z prvního stanoviska!</span>' : '');
        } else {
            if (bar) bar.innerHTML = 'Stoj na <b>#' + (stPt ? stPt.name : '?') + '</b> · zaměř známý <b>#' + (aimPt ? aimPt.name : '?') + '</b>' + dTxt
                + '<br><span style="opacity:.75;font-size:12px">orientace — srovná stanovisko</span>';
        }
        if (stepEl) stepEl.innerHTML = 'krok ' + (_capIdx + 1) + ' z 4 · stanovisko ' + step.st;
        if (shot) { shot.disabled = false; shot.innerText = isTarget ? 'Zaměřit cíl' : 'Zaměřit #' + (aimPt ? aimPt.name : ''); }
    }

    function stepBack() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        if (_capIdx <= 0) { cancelCapture(); return; }
        // pokud jsme na začátku stanoviska B (brána splněna), krok zpět vrátí na konec A
        if (_steps[_capIdx] && _steps[_capIdx].st === 'B' && _gateDone && (_capIdx === 0 || _steps[_capIdx - 1].st === 'A')) {
            // jsme za bránou na prvním kroku B → zruš bránu a vrať na poslední krok A
            _gateDone = false;
        }
        _capIdx--;
        delete _shots[_steps[_capIdx].key];
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
                _shots[_steps[_capIdx].key] = az;
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
        fillSelects(); updateWarn(); renderResult();
    }
    function finishCapture() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        _capIdx = -1; showAim(false); declutter(false);
        var m = document.getElementById('agix-modal'); if (m) m.style.display = 'flex';
        compute();
        fillSelects(); updateWarn(); renderResult();
    }

    function compute() {
        var A = ptById(_selA), B = ptById(_selB);
        if (!A || !B || ['AB', 'AP', 'BA', 'BP'].some(function (k) { return _shots[k] == null; })) { _result = null; return; }
        _result = solveIntersection(A, B, _shots.AB, _shots.AP, _shots.BA, _shots.BP);
        if (_result) { _result.Aname = A.name; _result.Bname = B.name; }
    }

    function renderResult() {
        var box = document.getElementById('agix-result'), acts = document.getElementById('agix-actions');
        if (!box) return;
        if (!_result) { box.style.display = 'none'; if (acts) acts.style.display = 'none'; return; }
        var r = _result;
        var qCol = r.angleP < 20 ? '#f87171' : (r.angleP < 35 ? '#fbbf24' : '#34d399');
        var html = '<div class="agix-big">Neznámý cíl ' + (_targetName ? '<b>' + _targetName + '</b> ' : '') + 'určen</div>'
            + '<div style="margin:6px 0;font-family:var(--font-mono,monospace);font-size:13px;">'
            + 'S-JTSK:&nbsp; <b>Y</b> ' + (r.Y != null ? r.Y.toFixed(2) : '—') + ' &nbsp; <b>X</b> ' + (r.X != null ? r.X.toFixed(2) : '—') + '</div>'
            + '<div style="font-size:12.5px;opacity:.9;line-height:1.5;">'
            + 'Základna #' + r.Aname + '–#' + r.Bname + ': <b>' + r.base.toFixed(1) + ' m</b><br>'
            + 'Délka #' + r.Aname + '→cíl: <b>' + r.distA.toFixed(1) + ' m</b> · #' + r.Bname + '→cíl: <b>' + r.distB.toFixed(1) + ' m</b><br>'
            + 'Úhel protnutí: <b style="color:' + qCol + '">' + r.angleP.toFixed(0) + '°</b> <span style="opacity:.7">(ideál ~90°)</span>'
            + '</div>';
        var warn = '';
        if (r.behind) warn += '<div style="color:#f87171;font-size:12px;margin-top:6px;">⚠ Cíl vyšel „za zády" jednoho stanoviska — nejspíš zaměněné body nebo špatné zaměření. Zkontroluj a zaměř znovu.</div>';
        if (r.angleP < 20) warn += '<div style="color:#f87171;font-size:12px;margin-top:4px;">⚠ Velmi ostrý úhel protnutí — poloha je nejistá. Zvol stanoviska tak, ať svírají s cílem úhel blíž 90°.</div>';
        else if (r.angleP < 35) warn += '<div style="color:#fbbf24;font-size:12px;margin-top:4px;">Úhel protnutí je malý — výsledek je citlivý na přesnost zaměření.</div>';
        box.innerHTML = html + warn;
        box.style.display = 'block';
        if (acts) acts.style.display = 'block';
    }

    function saveTarget() {
        if (!_result) return;
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Vkládání bodů není dostupné.'); return; }
        var name = _targetName;
        try { name = prompt('Název bodu:', _targetName || 'P_protnuti') || _targetName || 'P_protnuti'; } catch (e) { name = _targetName || 'P_protnuti'; }
        var added = window.addImportedPoints([{ name: name, lat: _result.lat, lng: _result.lng }]);
        if (added > 0) agAlert('Bod uložen', '#' + name + ' uložen do zakázky (protínání vpřed, úhel ' + _result.angleP.toFixed(0) + '°).\nNajdeš ho v seznamu Body.');
        else agAlert('Neuloženo', 'Bod se stejným názvem a polohou už v zakázce je.');
    }

    // ---- otevření/zavření + živá obnova ---------------------------------------
    var _liveTimer = null;
    function openTool() {
        ensureModal(); injectStyles(); fillSelects(); updateWarn(); renderResult();
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
            '#agix-modal .agix-base{font-size:12.5px;opacity:.85;margin:6px 2px;font-family:var(--font-mono,monospace);}',
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
