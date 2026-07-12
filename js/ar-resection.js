// ===== AR Geodet — AR RESEKCE / PROTÍNÁNÍ ZPĚT (ODPOJITELNÁ vrstva) ============
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Řeší nejtěžší slabinu
// celé appky — nepřesný telefonní kompas A GPS — tím, že z telefonu udělá
// jednoduchou „totálku":
//
//   Namíříš křížem AR kamery postupně na 2–4 VIDITELNÉ známé body (trig./ZhB/
//   PBPP — appka jejich přesné S-JTSK souřadnice už stahuje z ČÚZK) a u každého
//   klepneš „Zaměřit". Z ROZDÍLŮ azimutů (klasické protínání zpět / Snellius–
//   Pothenot, vyrovnání MNČ) appka dopočítá:
//     • SKUTEČNÝ SEVER (orientační oprava Δ — rozdíly azimutů ruší bias kompasu),
//     • při 3+ bodech i PŘESNÉ STANOVISKO (poloha nezávislá na GPS).
//
//   Sever se aplikuje přes existující nudgeHeadingOffset() (stejná páka jako
//   „Srovnání severu"), takže přežije i uložení. Stanovisko lze uložit jako bod.
//
// Vstup: tlačítko „AR resekce (poloha + sever)" v launcheru (js/field-tools.js);
//        když launcher chybí, modul si vyrobí vlastní plovoucí tlačítko.
// Odstranění: smaž js/ar-resection.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.4"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/></svg>';

    var D2R = Math.PI / 180, R2D = 180 / Math.PI;

    // stav nástroje
    var _selIds = [];          // id vybraných cílů (pořadí = pořadí zaměřování)
    var _shots = {};           // id -> {az, n, name, lat, lng, dist} zachycený azimut
    var _capIdx = -1;          // index právě zaměřovaného cíle (>=0 = běží zaměřování)
    var _capSamples = [];      // průběžné vzorky azimutu během zaměřování
    var _capTimer = null;
    var _result = null;        // poslední výsledek resekce

    // ---- pomocné --------------------------------------------------------------
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function heading() { return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; }
    function angNormDeg(a) { return ((a % 360) + 540) % 360 - 180; }      // -> (-180,180]
    function angNormRad(a) { return ((a % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; }

    // kruhový průměr úhlů (stupně)
    function circMeanDeg(arr) {
        var s = 0, c = 0;
        arr.forEach(function (a) { s += Math.sin(a * D2R); c += Math.cos(a * D2R); });
        return Math.atan2(s, c) * R2D;
    }

    // body vhodné jako cíl resekce: úřední (autoritativní souřadnice) napřed
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
    function ptById(id) { if (typeof arPoints === 'undefined') return null; return arPoints.find(function (q) { return q.id === id; }) || null; }

    // ---- jádro: protínání zpět z azimutů (MNČ) --------------------------------
    // shots: [{name, lat, lng, az}]  (az = azimut zařízení při zaměření, stupně)
    // Neznámé: poloha stanoviska (e,n v lokální rovině) + orientační posun Δ.
    //   pozorování:  bearing_grid(stanovisko -> cíl) = az + Δ
    //   (rozdíly azimutů ruší konstantní chybu kompasu Δ)
    function solveResection(shots, origin) {
        var n = shots.length;
        if (n < 2) return null;
        var lat0 = origin.lat, lng0 = origin.lng;
        var _m = (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) ? GeoCore.metersPerDeg(lat0) : { lat: 111320, lng: 111320 * Math.cos(lat0 * D2R) };
        var mLat = _m.lat, mLng = _m.lng;
        var T = shots.map(function (s) {
            return { E: (s.lng - lng0) * mLng, N: (s.lat - lat0) * mLat, az: s.az * D2R, name: s.name };
        });

        // --- jen orientace (2 body): poloha = GPS (origin), dopočítej Δ ---------
        if (n === 2) {
            var deltas = T.map(function (t) { return angNormRad(Math.atan2(t.E, t.N) - t.az); });
            var dMean = Math.atan2(deltas.reduce(function (a, d) { return a + Math.sin(d); }, 0),
                                   deltas.reduce(function (a, d) { return a + Math.cos(d); }, 0));
            var res2 = T.map(function (t) { return angNormRad(Math.atan2(t.E, t.N) - t.az - dMean) * R2D; });
            return {
                mode: 'orient', e: 0, n: 0, delta: dMean * R2D,
                lat: lat0, lng: lng0, posSigma: null, redundancy: 0,
                residuals: T.map(function (t, i) { return { name: t.name, r: res2[i] }; }),
                spread: angNormDeg((res2[0] - res2[1]))
            };
        }

        // --- plná resekce (3+ bodů): Gauss-Newton pro (e,n,Δ) ------------------
        // počáteční odhad: stanovisko v originu (GPS), Δ z kruhového průměru
        var e = 0, nn = 0;
        var dInit = circMeanDeg(T.map(function (t) { return angNormDeg(Math.atan2(t.E, t.N) * R2D - t.az * R2D); })) * D2R;
        var delta = dInit;
        var lastSig = null;
        for (var it = 0; it < 25; it++) {
            // normální rovnice: J^T J x = J^T r ; neznámé [de, dn, dDelta]
            var AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Atr = [0, 0, 0], sumr2 = 0;
            for (var i = 0; i < n; i++) {
                var dE = T[i].E - e, dN = T[i].N - nn, D2 = dE * dE + dN * dN;
                if (D2 < 1e-6) D2 = 1e-6;
                var alpha = Math.atan2(dE, dN);
                var r = angNormRad(alpha - T[i].az - delta);     // reziduum (rad)
                // parc. derivace alpha podle (e,n): d alpha/de = -dN/D2 ; d alpha/dn = dE/D2
                var je = -dN / D2, jn = dE / D2, jd = -1;
                // r = alpha - az - delta  -> dr/de=je, dr/dn=jn, dr/ddelta=-1
                var row = [je, jn, jd];
                for (var a = 0; a < 3; a++) { Atr[a] += row[a] * r; for (var b = 0; b < 3; b++) AtA[a][b] += row[a] * row[b]; }
                sumr2 += r * r;
            }
            var dx = solve3(AtA, [-Atr[0], -Atr[1], -Atr[2]]);
            if (!dx) break;
            e += dx[0]; nn += dx[1]; delta += dx[2];
            lastSig = sumr2;
            if (Math.abs(dx[0]) < 1e-4 && Math.abs(dx[1]) < 1e-4 && Math.abs(dx[2]) < 1e-6) break;
        }

        // kovariance polohy + jednotková střední chyba
        var redun = n - 3;
        var sumr2f = 0, residuals = [];
        for (var k = 0; k < n; k++) {
            var dE2 = T[k].E - e, dN2 = T[k].N - nn;
            var rk = angNormRad(Math.atan2(dE2, dN2) - T[k].az - delta);
            sumr2f += rk * rk; residuals.push({ name: T[k].name, r: rk * R2D });
        }
        var posSigma = null, sigma0 = null;
        if (redun > 0) {
            sigma0 = Math.sqrt(sumr2f / redun);            // rad (jednotková sm. chyba směru)
            // znovu sestav AtA v řešení pro inverzi (kovariance neznámých = sigma0^2 * (AtA)^-1)
            var AtA2 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
            for (var j = 0; j < n; j++) {
                var dE3 = T[j].E - e, dN3 = T[j].N - nn, D3 = dE3 * dE3 + dN3 * dN3; if (D3 < 1e-6) D3 = 1e-6;
                var row2 = [-dN3 / D3, dE3 / D3, -1];
                for (var aa = 0; aa < 3; aa++) for (var bb = 0; bb < 3; bb++) AtA2[aa][bb] += row2[aa] * row2[bb];
            }
            var inv = inv3(AtA2);
            if (inv) {
                var s2 = sigma0 * sigma0;
                var cee = s2 * inv[0][0], cnn = s2 * inv[1][1];
                posSigma = Math.sqrt(Math.max(0, cee + cnn));   // ~ sm. chyba polohy (m), směr*vzdálenost
            }
        }
        return {
            mode: 'full', e: e, n: nn, delta: delta * R2D,
            lat: lat0 + nn / mLat, lng: lng0 + e / mLng,
            posSigma: posSigma, dirSigma: sigma0 != null ? sigma0 * R2D : null, redundancy: redun,
            residuals: residuals
        };
    }

    // 3x3 řešič (Gaussova eliminace) – vrací x nebo null
    function solve3(A, b) {
        var M = [[A[0][0], A[0][1], A[0][2], b[0]], [A[1][0], A[1][1], A[1][2], b[1]], [A[2][0], A[2][1], A[2][2], b[2]]];
        for (var c = 0; c < 3; c++) {
            var piv = c; for (var rr = c + 1; rr < 3; rr++) if (Math.abs(M[rr][c]) > Math.abs(M[piv][c])) piv = rr;
            if (Math.abs(M[piv][c]) < 1e-12) return null;
            var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
            for (var r2 = 0; r2 < 3; r2++) { if (r2 === c) continue; var f = M[r2][c] / M[c][c]; for (var cc = c; cc < 4; cc++) M[r2][cc] -= f * M[c][cc]; }
        }
        return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
    }
    function inv3(A) {
        var a = A[0][0], b = A[0][1], c = A[0][2], d = A[1][0], e = A[1][1], f = A[1][2], g = A[2][0], h = A[2][1], i = A[2][2];
        var det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
        if (Math.abs(det) < 1e-15) return null;
        var id = 1 / det;
        return [
            [(e * i - f * h) * id, (c * h - b * i) * id, (b * f - c * e) * id],
            [(f * g - d * i) * id, (a * i - c * g) * id, (c * d - a * f) * id],
            [(d * h - e * g) * id, (b * g - a * h) * id, (a * e - b * d) * id]
        ];
    }

    // ---- UI: hlavní modal -----------------------------------------------------
    function ensureModal() {
        if (document.getElementById('agrx-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agrx-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' AR resekce — poloha a sever z bodů</h3>'
            + '<p style="font-size:12.5px;opacity:.82;margin:2px 0 8px;line-height:1.45;">Z telefonu „totálka": zaměř křížem kamery <b>2–4 viditelné známé body</b>. '
            + 'Z rozdílů azimutů appka srovná sever (a při <b>3+</b> bodech i dopočítá tvoji přesnou polohu). '
            + 'Rozdíly azimutů ruší chybu kompasu, takže to funguje i tam, kde magnetometr blbne.</p>'
            + '<div id="agrx-list" class="agrx-list"></div>'
            + '<div id="agrx-warn" style="font-size:12px;color:#fbbf24;margin:6px 2px;"></div>'
            + '<button class="btn" id="agrx-start"><svg class="icon"><use href="#i-crosshair"/></svg> Spustit zaměřování</button>'
            + '<div id="agrx-result" class="agrx-result" style="display:none;"></div>'
            + '<div id="agrx-actions" style="display:none;">'
            + '  <button class="btn" id="agrx-apply"><svg class="icon"><use href="#i-check"/></svg> Srovnat sever</button>'
            + '  <button class="btn btn-blue" id="agrx-save" style="margin-top:10px;"><svg class="icon"><use href="#i-plus"/></svg> Uložit stanovisko jako bod</button>'
            + '  <button class="btn btn-secondary" id="agrx-redo" style="margin-top:10px;"><svg class="icon"><use href="#i-rotate-ccw"/></svg> Zaměřit znovu</button>'
            + '</div>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" onclick="window.agCloseResection&&window.agCloseResection()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('agrx-start').addEventListener('click', startCapture);
        document.getElementById('agrx-apply').addEventListener('click', applyNorth);
        document.getElementById('agrx-save').addEventListener('click', saveStandpoint);
        document.getElementById('agrx-redo').addEventListener('click', function () { _shots = {}; _result = null; renderResult(); renderList(); });
    }

    function renderList() {
        var box = document.getElementById('agrx-list'); if (!box) return;
        var list = candidatePoints();
        if (!list.length) { box.innerHTML = '<div style="opacity:.6;font-size:13px;padding:8px 2px;">Žádné body — stáhni okolí (ČÚZK) nebo přidej vlastní body se souřadnicemi.</div>'; return; }
        var html = '';
        list.slice(0, 40).forEach(function (x) {
            var id = x.p.id, on = _selIds.indexOf(id) >= 0, ord = _selIds.indexOf(id) + 1;
            var shot = _shots[id];
            html += '<label class="agrx-row' + (on ? ' on' : '') + '">'
                + '<input type="checkbox" data-id="' + id + '"' + (on ? ' checked' : '') + '>'
                + '<span class="agrx-name">#' + x.p.name + (x.p.cat && x.p.cat !== 'CUSTOM' ? ' <span class="agrx-cat">' + x.p.cat + '</span>' : '') + '</span>'
                + '<span class="agrx-meta">' + (x.d != null ? x.d.toFixed(0) + ' m' : '') + (on ? ' · #' + ord : '') + (shot ? ' · ✓ ' + shot.az.toFixed(1) + '°' : '') + '</span>'
                + '</label>';
        });
        box.innerHTML = html;
        box.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var id = cb.getAttribute('data-id');
                if (cb.checked) { if (_selIds.indexOf(id) < 0) _selIds.push(id); }
                else { _selIds = _selIds.filter(function (x) { return x !== id; }); delete _shots[id]; }
                renderList(); updateWarn();
            });
        });
        updateWarn();
    }

    function updateWarn() {
        var w = document.getElementById('agrx-warn'), btn = document.getElementById('agrx-start'); if (!w) return;
        var msg = '';
        if (!haveUser()) msg = 'Čekám na GPS polohu…';
        else if (heading() == null) msg = 'Kompas zatím nedává směr — podrž telefon svisle.';
        else if (_selIds.length < 2) msg = 'Vyber aspoň 2 body (3+ určí i polohu).';
        else if (_selIds.length === 2) msg = '2 body = srovná jen sever. Pro výpočet polohy vyber 3.';
        // varování na ostrý úhel mezi cíli (špatná geometrie) až po zaměření
        w.innerHTML = msg;
        if (btn) btn.disabled = (_selIds.length < 2 || !haveUser() || heading() == null);
    }

    // ---- zaměřovací režim (přes kameru) ---------------------------------------
    function ensureAim() {
        if (document.getElementById('agrx-aim')) return;
        var a = document.createElement('div');
        a.id = 'agrx-aim';
        a.innerHTML =
            '<div id="agrx-aim-bar"><span id="agrx-aim-txt"></span></div>'
            + '<div id="agrx-cross"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="none" stroke="#34d399" stroke-width="2"/>'
            + '<line x1="50" y1="6" x2="50" y2="30" stroke="#34d399" stroke-width="2"/><line x1="50" y1="70" x2="50" y2="94" stroke="#34d399" stroke-width="2"/>'
            + '<line x1="6" y1="50" x2="30" y2="50" stroke="#34d399" stroke-width="2"/><line x1="70" y1="50" x2="94" y2="50" stroke="#34d399" stroke-width="2"/>'
            + '<circle cx="50" cy="50" r="2.5" fill="#34d399"/></svg><div id="agrx-cross-prog"></div></div>'
            + '<div id="agrx-aim-btns"><button id="agrx-shot" class="btn">Zaměřit</button>'
            + '<button id="agrx-aim-cancel" class="btn btn-secondary">Zrušit</button></div>';
        document.body.appendChild(a);
        document.getElementById('agrx-shot').addEventListener('click', takeShot);
        document.getElementById('agrx-aim-cancel').addEventListener('click', cancelCapture);
    }
    function showAim(on) { ensureAim(); document.getElementById('agrx-aim').classList.toggle('on', !!on); }

    function startCapture() {
        if (_selIds.length < 2 || !haveUser() || heading() == null) { updateWarn(); return; }
        _shots = {}; _result = null;
        _capIdx = 0;
        document.getElementById('agrx-modal').style.display = 'none';
        showAim(true);
        promptNext();
    }
    function promptNext() {
        if (_capIdx >= _selIds.length) { finishCapture(); return; }
        var pt = ptById(_selIds[_capIdx]);
        var txt = document.getElementById('agrx-aim-txt');
        var d = (pt && haveUser()) ? getDistance(userLat, userLng, pt.lat, pt.lng) : null;
        if (txt) txt.innerHTML = 'Namiř střed na <b>#' + (pt ? pt.name : '?') + '</b>' + (d != null ? ' · ' + d.toFixed(0) + ' m' : '')
            + '<br><span style="opacity:.7;font-size:12px">cíl ' + (_capIdx + 1) + ' z ' + _selIds.length + ' — drž svisle a klepni Zaměřit</span>';
        var shot = document.getElementById('agrx-shot'); if (shot) { shot.disabled = false; shot.innerText = 'Zaměřit #' + (pt ? pt.name : ''); }
    }
    function takeShot() {
        if (heading() == null) { toast('Kompas nedává směr'); return; }
        var shotBtn = document.getElementById('agrx-shot'); if (shotBtn) shotBtn.disabled = true;
        _capSamples = []; var dur = 1100, step = 90, prog = document.getElementById('agrx-cross-prog');
        var t0 = 0;
        if (_capTimer) clearInterval(_capTimer);
        _capTimer = setInterval(function () {
            var h = heading(); if (h != null) _capSamples.push(h);
            t0 += step; if (prog) prog.style.width = Math.min(100, (t0 / dur) * 100) + '%';
            if (t0 >= dur) {
                clearInterval(_capTimer); _capTimer = null; if (prog) prog.style.width = '0%';
                if (!_capSamples.length) { if (shotBtn) shotBtn.disabled = false; toast('Nezachyceno'); return; }
                var az = (circMeanDeg(_capSamples) + 360) % 360;
                var pt = ptById(_selIds[_capIdx]);
                if (pt) _shots[pt.id] = { az: az, n: _capSamples.length, name: pt.name, lat: pt.lat, lng: pt.lng };
                if (navigator.vibrate) try { navigator.vibrate(25); } catch (e) {}
                _capIdx++;
                promptNext();
            }
        }, step);
    }
    function cancelCapture() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        _capIdx = -1; showAim(false);
        var m = document.getElementById('agrx-modal'); if (m) m.style.display = 'flex';
        renderList(); renderResult();
    }
    function finishCapture() {
        if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
        _capIdx = -1; showAim(false);
        var m = document.getElementById('agrx-modal'); if (m) m.style.display = 'flex';
        compute();
        renderList(); renderResult();
    }

    function compute() {
        var shots = _selIds.map(function (id) { return _shots[id]; }).filter(Boolean);
        if (shots.length < 2 || !haveUser()) { _result = null; return; }
        _result = solveResection(shots, { lat: userLat, lng: userLng });
        if (_result) {
            _result.shiftFromGps = getDistance(userLat, userLng, _result.lat, _result.lng);
            var sj = null; try { sj = proj4('EPSG:4326', 'EPSG:5514', [_result.lng, _result.lat]); } catch (e) {}
            if (sj) { _result.Y = Math.abs(sj[0]); _result.X = Math.abs(sj[1]); }
        }
    }

    function renderResult() {
        var box = document.getElementById('agrx-result'), acts = document.getElementById('agrx-actions');
        if (!box) return;
        if (!_result) { box.style.display = 'none'; if (acts) acts.style.display = 'none'; return; }
        var r = _result;
        var maxRes = 0; r.residuals.forEach(function (x) { if (Math.abs(x.r) > maxRes) maxRes = Math.abs(x.r); });
        var resHtml = r.residuals.map(function (x) {
            var col = Math.abs(x.r) > 2 ? '#f87171' : (Math.abs(x.r) > 0.8 ? '#fbbf24' : '#34d399');
            return '<div style="display:flex;justify-content:space-between"><span>#' + x.name + '</span><b style="color:' + col + '">' + (x.r >= 0 ? '+' : '') + x.r.toFixed(2) + '°</b></div>';
        }).join('');

        var head = '';
        if (r.mode === 'full') {
            head = '<div class="agrx-big">Sever: <b>' + (r.delta >= 0 ? '+' : '') + r.delta.toFixed(1) + '°</b></div>'
                + '<div style="margin:6px 0;font-family:var(--font-mono,monospace);font-size:13px;">'
                + 'Stanovisko (S-JTSK):<br><b>Y</b> ' + (r.Y != null ? r.Y.toFixed(2) : '—') + ' &nbsp; <b>X</b> ' + (r.X != null ? r.X.toFixed(2) : '—') + '</div>'
                + '<div style="font-size:12.5px;opacity:.85;">Posun od GPS: <b>' + r.shiftFromGps.toFixed(1) + ' m</b>'
                + (r.posSigma != null ? ' · odhad přesnosti ±' + r.posSigma.toFixed(2) + ' m' : ' · 3 body = bez kontroly')
                + '</div>';
        } else {
            head = '<div class="agrx-big">Sever: <b>' + (r.delta >= 0 ? '+' : '') + r.delta.toFixed(1) + '°</b></div>'
                + '<div style="font-size:12.5px;opacity:.85;">2 body — spočítán jen sever (poloha = GPS). Rozdíl mezi body: ' + Math.abs(r.spread).toFixed(2) + '°. Pro výpočet polohy vyber 3 body.</div>';
        }
        var warn = '';
        if (maxRes > 2) warn = '<div style="color:#f87171;font-size:12px;margin-top:6px;">⚠ Velké reziduum (' + maxRes.toFixed(1) + '°) — možná špatně zaměřený nebo zaměněný bod. Zkontroluj, případně zaměř znovu.</div>';
        if (r.mode === 'full' && r.shiftFromGps > 60) warn += '<div style="color:#f87171;font-size:12px;margin-top:4px;">⚠ Velký posun od GPS — ověř, že jsi mířil na správné body.</div>';

        box.innerHTML = head + '<div style="margin-top:8px;font-size:12px;opacity:.7;">Reziduály směrů:</div><div style="font-family:var(--font-mono,monospace);font-size:12.5px;margin-top:2px;">' + resHtml + '</div>' + warn;
        box.style.display = 'block';
        if (acts) acts.style.display = 'block';
        var apply = document.getElementById('agrx-apply'); if (apply) apply.innerHTML = '<svg class="icon"><use href="#i-check"/></svg> Srovnat sever (' + (r.delta >= 0 ? '+' : '') + r.delta.toFixed(1) + '°)';
        var save = document.getElementById('agrx-save'); if (save) save.style.display = (r.mode === 'full') ? 'block' : 'none';
        try { if (window.AGQc) window.AGQc.onResection(box, r); } catch (e) {}   // QC: kód kvality z posSigma (odpojitelné)
    }

    function applyNorth() {
        if (!_result) return;
        var d = _result.delta;
        if (typeof nudgeHeadingOffset === 'function') nudgeHeadingOffset(d);
        else if (typeof userHeadingOffset !== 'undefined') {
            try { userHeadingOffset = ((userHeadingOffset + d) % 360 + 360) % 360; if (typeof setStoredData === 'function') setStoredData('arHeadingOffset', String(userHeadingOffset)); if (typeof updateHeadingOffsetVal === 'function') updateHeadingOffsetVal(); } catch (e) {}
        } else { agAlert('Nelze srovnat', 'Korekce kompasu není dostupná.'); return; }
        agAlert('Sever srovnán', 'Sever srovnán resekcí z ' + _result.residuals.length + ' bodů (' + (d >= 0 ? '+' : '') + d.toFixed(1) + '°).'
            + (_result.mode === 'full' ? '\n\nStanovisko můžeš uložit jako bod (tlačítko níže).' : ''));
    }

    function saveStandpoint() {
        if (!_result || _result.mode !== 'full') return;
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Vkládání bodů není dostupné.'); return; }
        var name = 'Stanovisko' ;
        try { name = prompt('Název stanoviska:', 'ST_' + (_result.residuals.length) + 'b') || name; } catch (e) {}
        var added = window.addImportedPoints([{ name: name, lat: _result.lat, lng: _result.lng }]);
        if (added > 0) agAlert('Stanovisko uloženo', '#' + name + ' uloženo do zakázky'
            + (_result.posSigma != null ? ' (odhad ±' + _result.posSigma.toFixed(2) + ' m).' : '.')
            + '\nNajdeš ho v seznamu Body.');
        else agAlert('Neuloženo', 'Bod se stejným názvem a polohou už v zakázce je.');
    }

    // ---- otevření/zavření + živá obnova seznamu -------------------------------
    var _liveTimer = null;
    function openTool() {
        ensureModal(); renderList(); renderResult();
        document.getElementById('agrx-modal').style.display = 'flex';
        if (!_liveTimer) _liveTimer = setInterval(function () {
            var m = document.getElementById('agrx-modal');
            if (m && m.style.display === 'flex' && _capIdx < 0) { updateWarn(); }
            // během zaměřování průběžně aktualizuj text vzdálenosti
            if (_capIdx >= 0) { /* drženo promptNext */ }
        }, 500);
    }
    window.agCloseResection = function () {
        var m = document.getElementById('agrx-modal'); if (m) m.style.display = 'none';
        if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
        if (_capIdx >= 0) cancelCapture();
    };
    window.agOpenResection = openTool;

    // ---- styly (injektované) ---------------------------------------------------
    function injectStyles() {
        if (document.getElementById('agrx-style')) return;
        var st = document.createElement('style'); st.id = 'agrx-style';
        st.textContent = [
            '#agrx-modal .agrx-list{max-height:34vh;overflow:auto;margin:4px 0 8px;}',
            '.agrx-row{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:10px;background:rgba(255,255,255,0.05);margin-bottom:6px;cursor:pointer;}',
            '.agrx-row.on{background:rgba(52,211,153,0.16);outline:1px solid rgba(52,211,153,0.5);}',
            '.agrx-row input{width:18px;height:18px;flex:0 0 18px;accent-color:var(--accent,#34d399);}',
            '.agrx-name{font-weight:600;flex:1;}',
            '.agrx-cat{font-size:10px;opacity:.7;border:1px solid currentColor;border-radius:5px;padding:0 4px;margin-left:4px;}',
            '.agrx-meta{font-family:var(--font-mono,monospace);font-size:12px;opacity:.75;white-space:nowrap;}',
            '.agrx-result{margin:12px 0;padding:12px 14px;border-radius:10px;background:rgba(52,211,153,0.12);}',
            '.agrx-big{font-size:15px;margin-bottom:2px;}',
            '#agrx-aim{position:fixed;inset:0;z-index:100050;display:none;pointer-events:none;}',
            '#agrx-aim.on{display:block;}',
            '#agrx-aim-bar{position:absolute;top:max(16px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);max-width:90vw;',
            '  background:rgba(8,12,16,0.82);color:#fff;padding:10px 16px;border-radius:12px;font:600 14px/1.3 var(--font,system-ui),sans-serif;text-align:center;pointer-events:none;}',
            '#agrx-cross{position:absolute;top:50%;left:50%;width:120px;height:120px;margin:-60px 0 0 -60px;pointer-events:none;}',
            '#agrx-cross svg{width:100%;height:100%;filter:drop-shadow(0 0 4px rgba(0,0,0,0.6));}',
            '#agrx-cross-prog{position:absolute;left:10%;bottom:-10px;height:4px;width:0;background:var(--accent,#34d399);border-radius:2px;transition:width .05s linear;}',
            '#agrx-aim-btns{position:absolute;left:0;right:0;bottom:max(24px,env(safe-area-inset-bottom));display:flex;gap:10px;justify-content:center;pointer-events:auto;padding:0 16px;}',
            '#agrx-aim-btns .btn{width:auto;flex:0 0 auto;min-width:140px;}',
            '#agrx-aim-cancel{min-width:96px!important;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- registrace do launcheru + fallback tlačítko --------------------------
    function register() {
        injectStyles();
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'ar-resection', label: 'AR resekce (poloha + sever)', icon: ICON, onClick: openTool, order: 5 });
        } else {
            ensureFallbackFab();
        }
    }
    function ensureFallbackFab() {
        if (document.getElementById('agrx-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'agrx-fab'; b.type = 'button';
        b.title = 'AR resekce'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:160px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#34d399);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        b.querySelector('svg').style.cssText = 'width:24px;height:24px;';
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
