// ===== AR Geodet — FOTO-TOTÁLKA / ZAMĚŘENÍ BODU KAMEROU (ODPOJITELNÁ vrstva) ===
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. „Tap-to-measure na zem":
// zakotvíš stanovisko (ideálně AR resekcí), namíříš telefon k zemi a KLEPNEŠ v obraze
// na bod na zemi. Z pixelu klepnutí + AR projekce (window._arProj) + kompasu appka
// odvodí AZIMUT a DEPRESNÍ úhel paprsku a najde jeho průsečík se zemí:
//
//   • paprsek × terén: iterativní raymarching (odhad vzdálenosti -> terrainDZ ->
//     oprava depresního úhlu). Bez terénního výškopisu (dmr-terrain.js) degraduje
//     na rovinu ve výšce očí.
//   • výsledek -> S-JTSK (proj4 4326->5514) -> uloží přes window.addImportedPoints().
//
// Je to OBRÁCENÁ matematika k projekci značek v renderAR (azimut × svislý úhel +
// korekce náklonu obrazu), takže „kam se kreslí bod" a „kam ukazuje klepnutí" sedí.
//
// POCTIVĚ: přesnost telefonu je ±3–7 m (poloha) a pár ° (kompas/FOV) — jde o
// ORIENTAČNÍ zaměření, NE přejímací měření. Odhad ± roste s nejistotou FOV, pózy
// a s malým úhlem k zemi (paprsek skoro rovnoběžný se zemí = obrovská nejistota).
//
// Vstup: dlaždice „Zaměřit bod kamerou" v Nástrojích (kat. Měření). window.agOpenPhotoShot.
// Odstranění: smaž js/photo-shot.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M3 8.5A2 2 0 0 1 5 6.5h2l1.2-1.8A1 1 0 0 1 9 4.2h6a1 1 0 0 1 .8.5L17 6.5h2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
        + '<circle cx="12" cy="12.5" r="3.2"/><path d="M12 7.5v1M12 16.5v1M7.5 12.5h1M15.5 12.5h1"/></svg>';

    var D2R = Math.PI / 180, R2D = 180 / Math.PI;

    // stav
    var _fovConfirmed = false;      // uživatel potvrdil, že FOV sedí (menší nejistota v odhadu ±)
    var _buf = [];                  // posledních pár vzorků {pitch, roll, heading} (medián proti třesu)
    var _poll = null;
    var _result = null;             // poslední spočítaný bod
    var _tapX = null, _tapY = null; // poslední klepnutí (%)

    // ---- pomocné --------------------------------------------------------------
    function agAlertX(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }
    function curViewMode() { try { return (typeof viewMode !== 'undefined') ? viewMode : 'both'; } catch (e) { return 'both'; } }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function headingNow() {
        try { if (typeof currentHeading === 'number' && isFinite(currentHeading)) return currentHeading; } catch (e) {}
        try { if (typeof smoothedHeading === 'number' && isFinite(smoothedHeading)) return smoothedHeading; } catch (e) {}
        return null;
    }
    function projNow() { try { var p = window._arProj; return (p && isFinite(p.pitch) && isFinite(p.halfH) && isFinite(p.halfV)) ? p : null; } catch (e) { return null; } }
    function vOffsetNow() { try { return (window.visSettings && +visSettings.arVerticalOffset) || 0; } catch (e) { return 0; } }
    function metersPerDeg(lat) {
        if (typeof GeoCore !== 'undefined' && GeoCore && GeoCore.metersPerDeg) { try { return GeoCore.metersPerDeg(lat); } catch (e) {} }
        return { lat: 111320, lng: 111320 * Math.cos(lat * D2R) };
    }
    function fmtM(v, dec) { if (v == null || !isFinite(v)) return '—'; return v.toFixed(dec != null ? dec : (v >= 100 ? 0 : v >= 10 ? 1 : 2)) + ' m'; }
    function median(arr) { if (!arr.length) return null; var a = arr.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; }
    function circMeanDeg(arr) { if (!arr.length) return null; var s = 0, c = 0; arr.forEach(function (a) { s += Math.sin(a * D2R); c += Math.cos(a * D2R); }); return (Math.atan2(s, c) * R2D + 360) % 360; }

    // videostopa kamery — pokus o auto-FOV (KROK 1)
    function videoTrack() {
        try { if (typeof currentVideoStream !== 'undefined' && currentVideoStream && currentVideoStream.getVideoTracks) return currentVideoStream.getVideoTracks()[0] || null; } catch (e) {}
        try { var v = document.getElementById('camera-feed'); if (v && v.srcObject && v.srcObject.getVideoTracks) return v.srcObject.getVideoTracks()[0] || null; } catch (e) {}
        return null;
    }
    // Standardní WebRTC API bohužel NEdává přímé horizontální FOV (iOS vrací null i pro
    // capabilities). Vracíme co jde zjistit (zoom) a jinak necháme uživatele potvrdit fovH.
    function tryAutoFov() {
        var tr = videoTrack(); if (!tr) return { ok: false, note: 'Kamera zatím neběží — zapni AR/Split.' };
        var set = null, caps = null;
        try { set = tr.getSettings ? tr.getSettings() : null; } catch (e) {}
        try { caps = tr.getCapabilities ? tr.getCapabilities() : null; } catch (e) {}
        var zoom = set && set.zoom;
        if (zoom != null && zoom > 1.05) return { ok: false, note: 'Kamera je přiblížená (zoom ' + (+zoom).toFixed(1) + '×) — záběr je užší, odděl zoom nebo uprav FOV níže.' };
        // FOV telefon neposkytl → uživatel potvrdí posuvníkem (respektuje kalibraci ar-calib2)
        return { ok: false, note: 'Telefon FOV neposkytl (běžné na iOS). Potvrď/uprav šířku záběru níže — použije se kalibrace z „Srovnat obraz (2 body)", pokud jsi ji dělal.' };
    }
    function fovH() { try { return (window.visSettings && +visSettings.fovH) || 90; } catch (e) { return 90; } }
    function setFovH(v) {
        v = Math.max(50, Math.min(110, Math.round(v)));
        try { if (window.visSettings) visSettings.fovH = v; } catch (e) {}
        try { if (typeof setStoredData === 'function' && typeof visSettings !== 'undefined') setStoredData('arVisSettings12', JSON.stringify(visSettings)); } catch (e) {}
        return v;
    }

    // ---- stanovisko (origin) --------------------------------------------------
    function stationInfo() {
        var lat0, lng0, eyeH = 1.6, posErr = null, source = 'gps', z0 = null, anchored = false;
        var P = window.AGPose;
        if (P && P.valid && P.originLat != null) {
            var o = P.origin(haveUser() ? userLat : null, haveUser() ? userLng : null);
            lat0 = o[0]; lng0 = o[1]; source = P.source || 'resection'; anchored = (source === 'resection');
            if (P.posSigma != null) posErr = P.posSigma;
            if (P.eyeH != null && isFinite(P.eyeH)) eyeH = P.eyeH;
            if (P.originZ != null && isFinite(P.originZ)) z0 = P.originZ;
        } else if (haveUser()) {
            lat0 = userLat; lng0 = userLng; source = 'gps';
        } else { return null; }
        try { if (window.visSettings && isFinite(visSettings.eyeHeight) && P && !(P.valid && P.eyeH != null)) eyeH = visSettings.eyeHeight; } catch (e) {}
        if (!(eyeH > 0)) eyeH = 1.6;
        // výška terénu stanoviska (Bpv), když je dostupný výškopis
        try { if (typeof terrainElev === 'function') { var e0 = terrainElev(lat0, lng0); if (e0 != null && isFinite(e0)) z0 = e0; } } catch (e) {}
        if (z0 == null && typeof userAlt !== 'undefined' && userAlt != null && isFinite(userAlt)) z0 = userAlt - eyeH;
        if (posErr == null) { try { posErr = (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy != null) ? Math.max(2, +currentGpsAccuracy) : 5; } catch (e) { posErr = 5; } }
        return { lat0: lat0, lng0: lng0, eyeH: eyeH, posErr: posErr, source: source, z0: z0, anchored: anchored };
    }

    // ---- KROK 2: pixel klepnutí -> paprsek (obrácená projekce renderAR) --------
    // Forward v grafika.js:  uH=diff, vV=depression-pitch; roll-rotace; xPct=50+uH/halfH*50,
    //                        groundY=50+vV/halfV*50 - vOffset.  Tady to invertujeme.
    function tapToRay(xPct, yPct, proj, heading) {
        var halfH = proj.halfH, halfV = proj.halfV, pitch = proj.pitch, roll = proj.roll || 0;
        var vOff = vOffsetNow();
        var uHrot = (xPct - 50) / 50 * halfH;
        var vVrot = (yPct - 50 + vOff) / 50 * halfV;
        // zpětná rotace o -roll (forward rotoval o +roll)
        var cr = Math.cos(roll), sr = Math.sin(roll);
        var uH = uHrot * cr + vVrot * sr;
        var vV = -uHrot * sr + vVrot * cr;
        var diff = uH;                              // vodorovná odchylka od středu (°)
        var depression = vV + pitch;                // úhel POD horizont (°), kladně = k zemi
        var az = ((heading + diff) % 360 + 360) % 360;
        return { az: az, dep: depression, diff: diff, vV: vV };
    }

    // ---- KROK 3: průsečík paprsku se zemí (raymarching) -----------------------
    function solveGround(ray, st) {
        if (ray.dep <= 0.4) return { err: 'Klepni na ZEM POD horizont (obzor). Namiř telefon níž a klepni na místo na zemi.' };
        var depR = ray.dep * D2R, t = Math.tan(depR);
        var eyeH = st.eyeH;
        var m = metersPerDeg(st.lat0), mLat = m.lat, mLng = m.lng;
        var maxD; try { maxD = Math.min((typeof arRadius !== 'undefined' && arRadius) ? arRadius : 600, 800); } catch (e) { maxD = 600; }
        var sinAz = Math.sin(ray.az * D2R), cosAz = Math.cos(ray.az * D2R);
        var D = eyeH / t, tdz = 0, clamped = false, lat = st.lat0, lng = st.lng0;
        for (var k = 0; k < 8; k++) {
            if (D > maxD) { D = maxD; clamped = true; }
            if (D < 0.5) D = 0.5;
            lat = st.lat0 + (D * cosAz) / mLat;
            lng = st.lng0 + (D * sinAz) / mLng;
            var t2 = 0; try { if (typeof terrainDZ === 'function') { var v = terrainDZ(lat, lng); if (v != null && isFinite(v)) t2 = v; } } catch (e) {}
            var Dn = (eyeH - t2) / t;                 // nová vodorovná vzdálenost při této výšce terénu
            tdz = t2;
            if (!(Dn > 0)) break;                     // paprsek by prošel nad terén (svah nahoru) — drž poslední
            if (Math.abs(Dn - D) < 0.05) { D = Dn; break; }
            D = Dn;
        }
        if (D > maxD) { D = maxD; clamped = true; }
        lat = st.lat0 + (D * cosAz) / mLat;
        lng = st.lng0 + (D * sinAz) / mLng;

        // výška bodu (Bpv): přímý absolutní odečet terénu, jinak rovina ve výšce stanoviska
        var vyska = null;
        try { if (typeof terrainElev === 'function') { var te = terrainElev(lat, lng); if (te != null && isFinite(te)) vyska = te; } } catch (e) {}
        if (vyska == null && st.z0 != null && isFinite(st.z0)) vyska = st.z0 + tdz;

        // S-JTSK
        var Y = null, X = null;
        try { var sj = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); if (sj) { Y = Math.abs(sj[0]); X = Math.abs(sj[1]); } } catch (e) {}

        // ---- poctivý odhad ± (planimetrie) ----
        var fovFrac = _fovConfirmed ? 0.06 : 0.11;                 // nejistota škály FOV
        var pixV = 0.02 * (2 * proj.halfV);                        // ~2 % svislého záběru (trefa prstem)
        var pixH = 0.02 * (2 * proj.halfH);
        var poseV = 0.8;                                           // šum náklonu telefonu (°)
        var sigDep = Math.sqrt(pixV * pixV + Math.pow(fovFrac * Math.abs(ray.vV), 2) + poseV * poseV);   // ° na depresi
        var headErr = st.anchored ? 1.3 : 4.0;                     // nejistota severu (° — po resekci menší)
        var sigAz = Math.sqrt(headErr * headErr + Math.pow(fovFrac * Math.abs(ray.diff), 2) + pixH * pixH);
        var sinDep = Math.max(0.05, Math.sin(depR));
        var dR = (eyeH / (sinDep * sinDep)) * (sigDep * D2R);      // radiální chyba (m) — citlivá u malého úhlu
        var dL = D * (sigAz * D2R);                                // příčná chyba (m)
        var accPlan = Math.sqrt(dR * dR + dL * dL + (st.posErr || 0) * (st.posErr || 0));
        if (accPlan < 1.5) accPlan = 1.5;

        var q = 'good';
        if (clamped || ray.dep < 4 || accPlan > 8) q = 'bad';
        else if (accPlan > 3.5 || ray.dep < 8) q = 'ok';

        return {
            lat: lat, lng: lng, vyska: vyska, Y: Y, X: X,
            dist: D, az: ray.az, dep: ray.dep, tdz: tdz,
            accPlan: accPlan, q: q, clamped: clamped,
            hadTerrain: (typeof terrainDZ === 'function' && st.z0 != null)
        };
    }

    // ---- zaměřovací overlay (klepni do obrazu) --------------------------------
    function declutter(on) {
        document.body.classList.toggle('agps-clean', !!on);
        if (!on) { try { if (typeof applyViewMode === 'function') applyViewMode(); } catch (e) {} }
    }
    function ensureAim() {
        if (document.getElementById('agps-aim')) return;
        var a = document.createElement('div');
        a.id = 'agps-aim';
        a.innerHTML =
            '<div id="agps-bar"><span id="agps-bar-t"></span></div>'
            + '<div id="agps-tap"></div>'
            + '<div id="agps-mark" style="display:none;"><svg viewBox="0 0 100 100">'
            + '<circle cx="50" cy="50" r="30" fill="none" stroke="#34d399" stroke-width="5"/>'
            + '<line x1="50" y1="6" x2="50" y2="94" stroke="#34d399" stroke-width="4"/>'
            + '<line x1="6" y1="50" x2="94" y2="50" stroke="#34d399" stroke-width="4"/>'
            + '<circle cx="50" cy="50" r="4" fill="#34d399"/></svg></div>'
            + '<div id="agps-card" style="display:none;"></div>'
            + '<div id="agps-btns">'
            + '  <button id="agps-save" class="btn btn-blue" style="display:none;"><svg class="icon"><use href="#i-plus"/></svg> Uložit bod</button>'
            + '  <button id="agps-redo" class="btn btn-secondary" style="display:none;">Znovu</button>'
            + '  <button id="agps-cancel" class="btn btn-secondary">Zavřít</button>'
            + '</div>';
        document.body.appendChild(a);
        document.getElementById('agps-tap').addEventListener('click', onTap);
        document.getElementById('agps-save').addEventListener('click', saveResult);
        document.getElementById('agps-redo').addEventListener('click', function () { resetShot(); });
        document.getElementById('agps-cancel').addEventListener('click', closeAim);
    }
    function showAim(on) { ensureAim(); document.getElementById('agps-aim').classList.toggle('on', !!on); }

    function resetShot() {
        _result = null; _tapX = _tapY = null;
        var mk = document.getElementById('agps-mark'); if (mk) mk.style.display = 'none';
        var card = document.getElementById('agps-card'); if (card) card.style.display = 'none';
        var sv = document.getElementById('agps-save'); if (sv) sv.style.display = 'none';
        var rd = document.getElementById('agps-redo'); if (rd) rd.style.display = 'none';
        renderBar();
    }

    function renderBar() {
        var el = document.getElementById('agps-bar-t'); if (!el) return;
        if (_result) {
            el.innerHTML = 'Klepni jinam pro nové místo, nebo <b>Ulož bod</b>.';
            return;
        }
        var proj = projNow(), h = headingNow();
        if (!proj || h == null) { el.innerHTML = 'Čekám na senzory — musí běžet AR kamera a kompas. Podrž telefon svisle.'; return; }
        var dep = -proj.pitch; // pitch je kladně pod horizont; ukaž skutečný sklon
        el.innerHTML = 'Namiř telefon <b>k zemi</b> a klepni v obraze na místo na zemi.'
            + '<br><span style="opacity:.75;font-size:12px">sklon kamery ' + (proj.pitch >= 0 ? 'dolů ' : 'nahoru ') + Math.abs(proj.pitch).toFixed(0) + '° · azimut ' + h.toFixed(0) + '°</span>';
    }

    function onTap(e) {
        try { e.preventDefault(); } catch (x) {}
        var proj = projNow(), h0 = headingNow();
        if (!proj || h0 == null) { agAlertX('Čekám na senzory', 'Zapni AR/Split (kamera) a podrž telefon svisle — potřebuji sklon a azimut.'); return; }
        var st = stationInfo();
        if (!st) { agAlertX('Chybí poloha', 'Zatím nemám GPS ani zakotvené stanovisko. Počkej na GPS, ideálně nejdřív zakotvi AR resekcí.'); return; }
        var xPct = (e.clientX / Math.max(1, window.innerWidth)) * 100;
        var yPct = (e.clientY / Math.max(1, window.innerHeight)) * 100;
        _tapX = xPct; _tapY = yPct;

        // stabilizace pózy: medián náklonu a kruhový průměr azimutu z posledních vzorků
        var pitchB = _buf.map(function (s) { return s.pitch; });
        var rollB = _buf.map(function (s) { return s.roll; });
        var headB = _buf.map(function (s) { return s.heading; });
        var projS = { pitch: (pitchB.length ? median(pitchB) : proj.pitch), roll: (rollB.length ? median(rollB) : (proj.roll || 0)), halfH: proj.halfH, halfV: proj.halfV };
        var heading = headB.length ? circMeanDeg(headB) : h0;

        var ray = tapToRay(xPct, yPct, projS, heading);
        var r = solveGround(ray, st);
        // umísti značku na klepnuté místo
        var mk = document.getElementById('agps-mark');
        if (mk) { mk.style.left = xPct + '%'; mk.style.top = yPct + '%'; mk.style.display = 'block'; }
        if (navigator.vibrate) { try { navigator.vibrate(20); } catch (x) {} }

        if (r.err) { _result = null; renderCard(null, r.err, st); return; }
        _result = { r: r, st: st };
        renderCard(r, null, st);
    }

    function renderCard(r, err, st) {
        var card = document.getElementById('agps-card');
        var sv = document.getElementById('agps-save'), rd = document.getElementById('agps-redo');
        if (!card) return;
        if (err) {
            card.innerHTML = '<div style="color:#fbbf24;font:600 13px/1.4 var(--font-ui,system-ui),sans-serif;">' + err + '</div>';
            card.style.display = 'block';
            if (sv) sv.style.display = 'none';
            if (rd) rd.style.display = 'inline-flex';
            renderBar();
            return;
        }
        var col = r.q === 'good' ? '#34d399' : (r.q === 'ok' ? '#fbbf24' : '#f87171');
        var html = '<div style="font:700 13px/1 var(--font-ui,system-ui),sans-serif;color:' + col + ';margin-bottom:5px;">'
            + 'Bod na zemi · ± ' + fmtM(r.accPlan) + ' (orientačně)</div>'
            + '<div style="font-family:var(--font-mono,monospace);font-size:13px;">'
            + '<b>Y</b> ' + (r.Y != null ? r.Y.toFixed(2) : '—') + ' &nbsp; <b>X</b> ' + (r.X != null ? r.X.toFixed(2) : '—')
            + (r.vyska != null ? ' &nbsp; <b>Z</b> ' + r.vyska.toFixed(2) : '') + '</div>'
            + '<div style="font-size:12px;opacity:.85;margin-top:3px;">vzdálenost ' + fmtM(r.dist) + ' · azimut ' + r.az.toFixed(1) + '° · sklon ' + r.dep.toFixed(1) + '°'
            + (r.hadTerrain ? ' · výška z terénu' : ' · rovina (bez výškopisu)') + '</div>';
        var warn = '';
        if (st && !st.anchored) warn += '<div style="color:#fbbf24;font-size:11.5px;margin-top:5px;">⚠ Bez zakotveného stanoviska — poloha stojí jen na GPS (±' + (st.posErr ? st.posErr.toFixed(0) : '?') + ' m). Přesnější bude po AR resekci.</div>';
        if (r.clamped) warn += '<div style="color:#f87171;font-size:11.5px;margin-top:4px;">⚠ Paprsek skoro rovnoběžný se zemí — vzdálenost je nespolehlivá, oříznuto. Miř blíž k zemi.</div>';
        else if (r.q === 'bad') warn += '<div style="color:#f87171;font-size:11.5px;margin-top:4px;">⚠ Velká nejistota — malý úhel k zemi nebo neověřené FOV. Jde o orientační polohu.</div>';
        card.innerHTML = html + warn;
        card.style.display = 'block';
        if (sv) sv.style.display = 'inline-flex';
        if (rd) rd.style.display = 'inline-flex';
        renderBar();
    }

    function promptName(def) {
        if (typeof window.agPrompt === 'function') return window.agPrompt({ title: 'Název bodu', value: def, okText: 'Uložit' });
        try { return Promise.resolve(prompt('Název bodu:', def)); } catch (e) { return Promise.resolve(def); }
    }
    function saveResult() {
        if (!_result || !_result.r) return;
        if (typeof window.addImportedPoints !== 'function') { agAlertX('Nelze uložit', 'Vkládání bodů není dostupné.'); return; }
        var r = _result.r;
        promptName('F' + (new Date().getMinutes())).then(function (nm) {
            if (nm == null) return;
            var name = (String(nm).trim() || 'F_foto');
            var ts = Date.now();
            var obj = {
                name: name, lat: r.lat, lng: r.lng,
                vyska: (r.vyska != null ? r.vyska : undefined),
                acc: r.accPlan,
                origin: 'foto-shot',
                prov: { origin: 'foto-shot', ts: ts, acc: r.accPlan, qc: r.q }
            };
            var added = 0;
            try { added = window.addImportedPoints([obj]) || 0; } catch (e) { added = 0; }
            // volitelný žurnál (append-only) — když je k dispozici
            try { if (added > 0 && window.AGJournal && typeof window.AGJournal.commit === 'function') window.AGJournal.commit({ op: 'add', after: obj, origin: 'foto-shot' }); } catch (e) {}
            if (added > 0) agAlertX('Bod uložen', '#' + String(name).replace(/[<>&]/g, '') + ' uložen do zakázky (foto-totálka, ± ' + fmtM(r.accPlan) + ', orientačně).\nNajdeš ho v seznamu Body.');
            else agAlertX('Neuloženo', 'Bod se stejným názvem a polohou už v zakázce je.');
        });
    }

    function startAim() {
        if (curViewMode() === 'map') { agAlertX('Zapni kameru', 'Přepni zobrazení na AR nebo Split — zaměřuje se přes kameru.'); return; }
        var st = stationInfo();
        if (!st) { agAlertX('Chybí poloha', 'Zatím nemám GPS ani zakotvené stanovisko. Počkej na GPS (ideálně nejdřív AR resekce).'); return; }
        var modal = document.getElementById('agps-modal'); if (modal) modal.style.display = 'none';
        resetShot();
        declutter(true); showAim(true);
        if (!_poll) {
            var mk = (window.AG && AG.uiInterval) ? AG.uiInterval : setInterval;
            _poll = mk(function () {
                var p = projNow(), h = headingNow();
                if (p && h != null) { _buf.push({ pitch: p.pitch, roll: p.roll || 0, heading: h }); if (_buf.length > 8) _buf.shift(); }
                if (!_result) renderBar();
            }, 130);
        }
    }
    function closeAim() {
        if (_poll) { (window.AG && AG.clearUiInterval ? AG.clearUiInterval : clearInterval)(_poll); _poll = null; }
        _buf = [];
        showAim(false); declutter(false);
    }

    // ---- nastavovací modal (KROK 1: FOV + stav stanoviska) --------------------
    function ensureModal() {
        if (document.getElementById('agps-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agps-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Zaměřit bod kamerou</h3>'
            + '<p style="font-size:12.5px;opacity:.82;margin:2px 0 10px;line-height:1.45;">Namíříš telefon k zemi a <b>klepneš v obraze</b> na místo na zemi — appka z toho odvodí azimut a sklon paprsku a najde jeho průsečík se zemí (výškopis DMR 5G, pokud běží). '
            + '<b>Orientační</b> zaměření (± metry), NE přejímací měření.</p>'
            + '<div id="agps-station" class="agps-note"></div>'
            + '<div style="font-size:12px;opacity:.75;margin:10px 2px 2px;">Šířka záběru kamery (FOV, °)</div>'
            + '<div id="agps-fov-note" style="font-size:11.5px;color:#fbbf24;margin:2px 2px 6px;line-height:1.4;"></div>'
            + '<div class="agps-frow">'
            + '  <button type="button" class="agps-step" id="agps-fov-minus">−</button>'
            + '  <input type="range" id="agps-fov" min="50" max="110" step="1">'
            + '  <button type="button" class="agps-step" id="agps-fov-plus">+</button>'
            + '  <span id="agps-fov-val" style="min-width:46px;text-align:right;font:700 15px/1 var(--font-mono,monospace);">90°</span>'
            + '</div>'
            + '<label class="agps-chk"><input type="checkbox" id="agps-fov-ok"> FOV je ověřené (kalibrace „Srovnat obraz 2 body") — menší nejistota</label>'
            + '<button class="btn" id="agps-go"><svg class="icon"><use href="#i-crosshair"/></svg> Spustit zaměřování</button>'
            + '<div id="agps-more" style="margin-top:10px;"></div>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" onclick="window.agClosePhotoShot&&window.agClosePhotoShot()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        var sl = document.getElementById('agps-fov');
        sl.addEventListener('input', function () { var v = setFovH(+this.value); document.getElementById('agps-fov-val').textContent = v + '°'; });
        document.getElementById('agps-fov-minus').addEventListener('click', function () { var v = setFovH(fovH() - 1); sl.value = v; document.getElementById('agps-fov-val').textContent = v + '°'; });
        document.getElementById('agps-fov-plus').addEventListener('click', function () { var v = setFovH(fovH() + 1); sl.value = v; document.getElementById('agps-fov-val').textContent = v + '°'; });
        document.getElementById('agps-fov-ok').addEventListener('change', function () { _fovConfirmed = !!this.checked; });
        document.getElementById('agps-go').addEventListener('click', startAim);
    }

    function refreshModal() {
        // stav stanoviska
        var stEl = document.getElementById('agps-station');
        if (stEl) {
            var st = stationInfo();
            if (!st) { stEl.className = 'agps-note bad'; stEl.innerHTML = '⚠ Zatím nemám polohu (GPS ani zakotvené stanovisko). Počkej na GPS.'; }
            else if (st.anchored) { stEl.className = 'agps-note ok'; stEl.innerHTML = '📍 Stanovisko <b>zakotveno resekcí</b>' + (st.posErr != null ? ' (±' + st.posErr.toFixed(2) + ' m)' : '') + ' — nejlepší přesnost.'; }
            else { stEl.className = 'agps-note warn'; stEl.innerHTML = '⚠ Stanovisko jen z <b>GPS</b> (±' + (st.posErr ? st.posErr.toFixed(0) : '?') + ' m). Pro lepší přesnost nejdřív zakotvi <b>AR resekcí</b>.'; }
        }
        // auto-FOV pokus + posuvník
        var note = document.getElementById('agps-fov-note'); if (note) { var af = tryAutoFov(); note.innerHTML = af.note || ''; }
        var sl = document.getElementById('agps-fov'), val = document.getElementById('agps-fov-val');
        if (sl) sl.value = fovH();
        if (val) val.textContent = fovH() + '°';
        var chk = document.getElementById('agps-fov-ok'); if (chk) chk.checked = _fovConfirmed;
        // volitelný odkaz na protínání ze 2 stanovisek (deleguje, neimplementuje znovu)
        var more = document.getElementById('agps-more');
        if (more) {
            if (typeof window.agOpenIntersection === 'function') {
                more.innerHTML = '<button type="button" class="btn btn-secondary" id="agps-isect" style="width:100%;">Přeurčení: protínání ze 2 stanovisek…</button>';
                var b = document.getElementById('agps-isect');
                if (b) b.addEventListener('click', function () { window.agClosePhotoShot(); try { window.agOpenIntersection(); } catch (e) {} });
            } else { more.innerHTML = ''; }
        }
    }

    function openTool() { ensureModal(); injectStyles(); refreshModal(); document.getElementById('agps-modal').style.display = 'flex'; }
    window.agClosePhotoShot = function () { var m = document.getElementById('agps-modal'); if (m) m.style.display = 'none'; closeAim(); };
    window.agOpenPhotoShot = openTool;

    // ---- styly ----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('agps-style')) return;
        var st = document.createElement('style'); st.id = 'agps-style';
        st.textContent = [
            '#agps-modal .agps-note{font-size:12px;line-height:1.4;padding:8px 10px;border-radius:10px;margin:2px 0 6px;background:rgba(255,255,255,0.05);}',
            '#agps-modal .agps-note.ok{background:rgba(52,211,153,0.14);}',
            '#agps-modal .agps-note.warn{background:rgba(251,191,36,0.14);}',
            '#agps-modal .agps-note.bad{background:rgba(248,113,113,0.16);}',
            '#agps-modal .agps-frow{display:flex;align-items:center;gap:8px;margin:2px 0 6px;}',
            '#agps-modal .agps-frow input[type=range]{flex:1;accent-color:var(--accent,#2f9e74);}',
            '#agps-modal .agps-step{width:38px;height:38px;flex:0 0 38px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:rgba(255,255,255,0.05);color:var(--text-color,#e8edf2);font:700 18px/1 var(--font-ui,system-ui),sans-serif;}',
            '#agps-modal .agps-chk{display:flex;align-items:center;gap:8px;font-size:12px;opacity:.85;margin:4px 2px 12px;line-height:1.35;}',
            '#agps-modal .agps-chk input{width:18px;height:18px;flex:0 0 18px;accent-color:var(--accent,#2f9e74);}',
            // vyčištěná obrazovka během zaměřování (stejný princip jako dálkoměr / výška objektu)
            'body.agps-clean #ar-overlay{opacity:0!important;pointer-events:none!important;}',
            'body.agps-clean #ar-hud{display:none!important;}',
            'body.agps-clean #camera-container{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;display:block!important;flex:1 1 auto!important;z-index:100040!important;}',
            'body.agps-clean #map-container,body.agps-clean #resizer{display:none!important;}',
            '#agps-aim{position:fixed;inset:0;z-index:100050;display:none;}',
            '#agps-aim.on{display:block;}',
            '#agps-tap{position:absolute;inset:0;z-index:1;pointer-events:auto;cursor:crosshair;}',
            '#agps-bar{position:absolute;top:max(16px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);max-width:92vw;z-index:2;',
            '  background:rgba(8,12,16,0.82);color:#fff;padding:10px 16px;border-radius:12px;font:600 14px/1.35 var(--font-ui,system-ui),sans-serif;text-align:center;pointer-events:none;}',
            '#agps-mark{position:absolute;width:56px;height:56px;margin:-28px 0 0 -28px;z-index:2;pointer-events:none;}',
            '#agps-mark svg{width:100%;height:100%;filter:drop-shadow(0 0 4px rgba(0,0,0,0.8));}',
            '#agps-card{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(max(24px,env(safe-area-inset-bottom)) + 58px);z-index:3;',
            '  max-width:92vw;min-width:230px;background:rgba(8,12,16,0.88);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:10px 14px;color:#e8edf2;pointer-events:auto;}',
            '#agps-btns{position:absolute;left:0;right:0;bottom:max(24px,env(safe-area-inset-bottom));z-index:4;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;pointer-events:auto;padding:0 16px;}',
            '#agps-btns .btn{width:auto;flex:0 0 auto;min-width:110px;}',
            '#agps-cancel{min-width:92px!important;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- registrace do launcheru ----------------------------------------------
    function register() {
        injectStyles();
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'photo-shot', label: 'Zaměřit bod kamerou', icon: ICON, cat: 'Měření', onClick: openTool, order: 8 });
        } else {
            ensureFallbackFab();
        }
    }
    function ensureFallbackFab() {
        if (document.getElementById('agps-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'agps-fab'; b.type = 'button';
        b.title = 'Zaměřit bod kamerou'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:214px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#2f9e74);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        b.querySelector('svg').style.cssText = 'width:24px;height:24px;';
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
