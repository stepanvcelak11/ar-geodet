// ===== AR Geodet — DVOUTELEFONNÍ DGPS (A2, ODPOJITELNÁ vrstva) =================
// Diferenční korekce bez referenční stanice a bez serveru: ionosféra, troposféra
// a chyby drah družic jsou na vzdálenost do ~2 km pro dva telefony prakticky
// STEJNÉ. Telefon A („Základna") leží na PŘESNĚ ZNÁMÉM bodě a průběžně loguje,
// o kolik a kterým směrem GPS právě „lže" (dE/dN[/dV] proti známé poloze,
// průměrováno po minutových blocích). Telefon B („Rover") normálně měří body
// (Brutální GPS / průměrovaná GPS). Po měření se korekční log přenese souborem
// a tady se ZPĚTNĚ odečte od bodů roveru — společná chyba zmizí.
//
// Podmínky (řekne je i UI): oba telefony satelitní fix (ne Wi-Fi polohu),
// vzdálenost do ~2–3 km, čas mají oba z GPS → synchronizace zadarmo. Funguje
// 100% offline. Zisk na krátkou vzdálenost typicky poloviční až třetinová chyba.
//
// Jak modul sahá na body: korekce se aplikuje JEN na body s prov.origin
// 'gps-avg' (měřené GPS průměrem), jejichž prov.ts padne do doby logu, a které
// ještě korigované nebyly (prov.dgps). Úprava jde stejnou cestou jako editace
// bodu v logika.js (persistentCustomPoints + arPoints + setStoredData) a každý
// posun se zapíše do žurnálu (AGJournal, origin 'dgps').
//
// Vstup: dlaždice „Dvoutelefonní DGPS" v Nástrojích (kategorie Měření).
// Odstranění: smaž js/dgps.js + řádky v index.html a sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGDgps) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="7" height="14" rx="2"/><rect x="14" y="5" width="7" height="14" rx="2"/><path d="M10 12h4"/></svg>';
    var DLG_ID = 'ag-dgps-modal';
    var LS_LOG = 'agDgpsBaseLog_v1';   // rozpracovaný log základny (odolnost proti pádu)
    var BUCKET_S = 60;                 // délka bloku průměrování (s)
    var ACC_MAX = 25;                  // hrubší fixy do logu nebrat
    var APPLY_WIN_MS = 6 * 60000;      // korekce bodu = průměr bloků za posledních 6 min před uložením
    var NEAR_MS = 15 * 60000;          // fallback: nejbližší blok do 15 min
    var MAX_DIST_M = 3000;             // nad to korekci nenabízet (dekoreluje se)

    // ---- stav základny ---------------------------------------------------------
    var _watchId = null, _wakeLock = null, _t0 = 0, _tick = null;
    var _base = null;                  // {id,name,lat,lng,vyska}
    var _buckets = [];                 // hotové bloky {t,dE,dN,dU,n}
    var _cur = null;                   // rozpracovaný blok {t0,sE,sN,sU,nU,n}
    var _lastOff = null;               // poslední okamžitá odchylka (na displej)
    var _rejected = 0;

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }
    function mPerDeg(lat) {
        if (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) return GeoCore.metersPerDeg(lat);
        return { lat: 111320, lng: 111320 * Math.cos(lat * Math.PI / 180) };
    }
    function planarDist(aLat, aLng, bLat, bLng) {
        var m = mPerDeg((aLat + bLat) / 2);
        return Math.hypot((aLng - bLng) * m.lng, (aLat - bLat) * m.lat);
    }
    function points() { try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; } catch (e) { return []; } }
    function fmtHm(ts) { var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
    function fmtTime(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

    function loadDraft() { try { var o = JSON.parse(localStorage.getItem(LS_LOG)); return (o && o.base && Array.isArray(o.buckets)) ? o : null; } catch (e) { return null; } }
    function saveDraft() { try { localStorage.setItem(LS_LOG, JSON.stringify({ base: _base, t0: _t0, buckets: _buckets })); } catch (e) {} }
    function clearDraft() { try { localStorage.removeItem(LS_LOG); } catch (e) {} }

    // ---- ZÁKLADNA: sběr --------------------------------------------------------
    function flushBucket() {
        if (!_cur || !_cur.n) { _cur = null; return; }
        _buckets.push({
            t: _cur.t0 + BUCKET_S * 500,   // střed bloku (ms)
            dE: _cur.sE / _cur.n, dN: _cur.sN / _cur.n,
            dU: _cur.nU ? _cur.sU / _cur.nU : null, n: _cur.n
        });
        _cur = null;
        saveDraft();
    }
    function onFix(pos) {
        if (!_base) return;
        var c = pos.coords, now = Date.now();
        var acc = c.accuracy, alt = (c.altitude != null && isFinite(c.altitude)) ? c.altitude : null;
        // anti-Fused / hrubé fixy: bez výšky a s velkou kruhovou přesností nebrat
        if (acc == null || acc > ACC_MAX || (alt == null && acc >= 14)) { _rejected++; return; }
        var m = mPerDeg(_base.lat);
        var dE = (c.longitude - _base.lng) * m.lng;
        var dN = (c.latitude - _base.lat) * m.lat;
        var dU = null;
        if (alt != null && _base.vyska != null && isFinite(_base.vyska)) {
            var und = 0;
            try { if (typeof getGeoidUndulation === 'function') und = getGeoidUndulation(_base.lat, _base.lng) || 0; } catch (e) { und = 0; }
            dU = (alt - und) - _base.vyska;
        }
        if (!_cur || now - _cur.t0 >= BUCKET_S * 1000) { flushBucket(); _cur = { t0: now, sE: 0, sN: 0, sU: 0, nU: 0, n: 0 }; }
        _cur.sE += dE; _cur.sN += dN; _cur.n++;
        if (dU != null) { _cur.sU += dU; _cur.nU++; }
        _lastOff = { dE: dE, dN: dN, t: now };
    }
    function startBase(pt) {
        if (!navigator.geolocation) { agAlert('DGPS', 'Geolokace není dostupná.'); return; }
        _base = { id: pt.id, name: pt.name, lat: pt.lat, lng: pt.lng, vyska: (pt.vyska != null ? pt.vyska : null) };
        _buckets = []; _cur = null; _lastOff = null; _rejected = 0; _t0 = Date.now();
        try { _watchId = navigator.geolocation.watchPosition(onFix, function () {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 27000 }); }
        catch (e) { agAlert('DGPS', 'Nepodařilo se spustit GPS.'); _base = null; return; }
        try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { _wakeLock = w; }).catch(function () {}); } catch (e) {}
        saveDraft();
        if (!_tick) _tick = setInterval(renderBaseLive, 1000);
        renderModal();
    }
    function stopBase(keep) {
        if (_watchId != null) { try { navigator.geolocation.clearWatch(_watchId); } catch (e) {} _watchId = null; }
        if (_tick) { clearInterval(_tick); _tick = null; }
        try { if (_wakeLock) { _wakeLock.release(); _wakeLock = null; } } catch (e) {}
        flushBucket();
        if (!keep) { _base = null; _buckets = []; clearDraft(); }
        renderModal();
    }
    function exportLog(base, t0, buckets) {
        if (!buckets.length) { agAlert('DGPS', 'Log je prázdný — základna zatím nenasbírala žádný použitelný blok.'); return; }
        var out = {
            v: 1, app: 'ar-geodet', kind: 'dgps-log',
            base: { name: base.name, lat: base.lat, lng: base.lng, vyska: base.vyska },
            t0: buckets[0].t, t1: buckets[buckets.length - 1].t,
            bucketS: BUCKET_S,
            buckets: buckets.map(function (b) {
                return { t: b.t, dE: Math.round(b.dE * 1000) / 1000, dN: Math.round(b.dN * 1000) / 1000, dU: (b.dU == null ? null : Math.round(b.dU * 1000) / 1000), n: b.n };
            })
        };
        var d = new Date();
        var name = 'dgps-korekce-' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '-' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2) + '.json';
        var a = document.createElement('a');
        a.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(out)));
        a.setAttribute('download', name);
        document.body.appendChild(a); a.click(); a.remove();
    }

    // ---- ROVER: aplikace korekcí --------------------------------------------------
    function offsetAt(log, ts) {
        // vážený průměr bloků v okně [ts-6 min, ts]; fallback nejbližší blok do 15 min
        var inWin = log.buckets.filter(function (b) { return b.t >= ts - APPLY_WIN_MS && b.t <= ts + 60000; });
        if (inWin.length) {
            var sw = 0, sE = 0, sN = 0, sU = 0, nU = 0;
            inWin.forEach(function (b) { var w = b.n || 1; sw += w; sE += w * b.dE; sN += w * b.dN; if (b.dU != null) { sU += w * b.dU; nU += w; } });
            return { dE: sE / sw, dN: sN / sw, dU: nU ? sU / nU : null, kind: 'okno ' + inWin.length + ' bl.' };
        }
        var best = null;
        log.buckets.forEach(function (b) { var d = Math.abs(b.t - ts); if (d <= NEAR_MS && (!best || d < best.d)) best = { d: d, b: b }; });
        if (best) return { dE: best.b.dE, dN: best.b.dN, dU: best.b.dU, kind: 'nejbl. blok ' + Math.round(best.d / 60000) + ' min' };
        return null;
    }
    function candidates(log) {
        var out = [];
        points().forEach(function (p) {
            if (!p.prov || p.prov.origin !== 'gps-avg') return;
            if (p.prov.dgps) { out.push({ p: p, state: 'done' }); return; }
            var ts = p.prov.ts;
            if (!ts || ts < log.t0 - NEAR_MS || ts > log.t1 + NEAR_MS) return;
            var off = offsetAt(log, ts);
            if (!off) return;
            var dist = planarDist(p.lat, p.lng, log.base.lat, log.base.lng);
            out.push({ p: p, off: off, dist: dist, state: dist > MAX_DIST_M ? 'far' : 'ok' });
        });
        return out;
    }
    function applyCorrections(log, rows) {
        var applied = 0, sumMag = 0;
        rows.forEach(function (r) {
            if (r.state !== 'ok' || !r.checked) return;
            var p = r.p, off = r.off;
            // kopie (vč. prov) — jinak by „before" v žurnálu ukazovalo už zmutovaný objekt
            var before = { name: p.name, lat: p.lat, lng: p.lng, vyska: (p.vyska != null ? p.vyska : null), acc: (p.acc != null ? p.acc : null), cat: p.cat, prov: (p.prov ? JSON.parse(JSON.stringify(p.prov)) : null) };
            var m = mPerDeg(p.lat);
            p.lat = p.lat - off.dN / m.lat;
            p.lng = p.lng - off.dE / m.lng;
            if (off.dU != null && p.vyska != null && isFinite(p.vyska)) p.vyska = Math.round((p.vyska - off.dU) * 100) / 100;
            var mag = Math.hypot(off.dE, off.dN);
            p.prov = p.prov || {};
            p.prov.dgps = { t: Date.now(), base: log.base.name, mag: Math.round(mag * 1000) / 1000 };
            // synchronizuj i běžící AR/mapu (stejně jako editace bodu v logika.js)
            try {
                if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                    var ai = -1, k;
                    for (k = 0; k < arPoints.length; k++) if (arPoints[k].id === p.id) { ai = k; break; }
                    if (ai !== -1) {
                        arPoints[ai].lat = p.lat; arPoints[ai].lng = p.lng; arPoints[ai].vyska = p.vyska;
                        if (arPoints[ai].element) { arPoints[ai].element.remove(); arPoints[ai].element = null; }
                    }
                }
            } catch (e) {}
            try { if (window.AGJournal) window.AGJournal.commit({ op: 'edit', id: p.id, before: before, after: p, origin: 'dgps' }); } catch (e) {}
            applied++; sumMag += mag;
        });
        if (applied) {
            try { if (typeof setStoredData === 'function') setStoredData('arCustomPoints12', JSON.stringify(points())); } catch (e) {}
            try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) {}
            try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) {}
            try { if (typeof updateInfoPanel === 'function') updateInfoPanel(); } catch (e) {}
            try { if (typeof renderManageList === 'function') renderManageList(); } catch (e) {}
        }
        return { applied: applied, avg: applied ? sumMag / applied : 0 };
    }

    // ---- UI ------------------------------------------------------------------------
    var _mode = 'menu';   // 'menu' | 'base' | 'rover'
    var _roverLog = null, _roverRows = null;

    function ensureModal() {
        if (document.getElementById(DLG_ID)) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = DLG_ID;
        el.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent); margin-top:0; margin-bottom:5px;">' + ICON + ' Dvoutelefonní DGPS</h3>'
            + '<div class="modal-body" id="ag-dgps-body"></div>'
            + '<button class="btn btn-secondary" style="margin-top:15px;" id="ag-dgps-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        el.querySelector('#ag-dgps-close').addEventListener('click', closeModal);
        el.addEventListener('mousedown', function (e) { if (e.target === el) closeModal(); });
    }
    function closeModal() {
        var el = document.getElementById(DLG_ID);
        if (el) el.style.display = 'none';
        // základnu neschovávej potichu — když běží, běží dál (wake lock drží displej)
    }
    function openModal() {
        ensureModal();
        document.getElementById(DLG_ID).style.display = 'flex';
        if (_watchId != null) _mode = 'base';
        renderModal();
    }

    function renderModal() {
        var body = document.getElementById('ag-dgps-body');
        if (!body) return;
        if (_mode === 'base') { renderBase(body); return; }
        if (_mode === 'rover') { renderRover(body); return; }
        // menu
        var draft = loadDraft();
        body.innerHTML =
            '<p style="font-size:12.5px; opacity:0.85; margin:0 0 10px;">Atmosférická chyba GPS je pro dva telefony do ~2 km stejná. Jeden telefon polož na <b>přesně známý bod</b> jako základnu, druhým měř. Pak korekce přeneseš souborem a body se zpětně opraví.</p>'
            + '<button class="btn" id="ag-dgps-mode-base" style="margin:4px 0;">📡 Základna — tento telefon leží na známém bodě</button>'
            + '<button class="btn" id="ag-dgps-mode-rover" style="margin:4px 0;">📥 Korekce — nahrát log základny a opravit body</button>'
            + (draft && draft.buckets.length ? '<div class="bgps-card amber" style="margin-top:10px;"><b>Rozpracovaný log základny</b> (' + draft.buckets.length + ' bloků, ' + esc(draft.base.name) + ') — <button class="btn btn-secondary" id="ag-dgps-draft-exp" style="margin-top:6px;">Exportovat</button> <button class="btn btn-secondary" id="ag-dgps-draft-del" style="margin-top:6px; color:var(--danger,#fb7185);">Zahodit</button></div>' : '')
            + '<p style="font-size:11px; opacity:.55; margin:10px 0 0;">Zisk: na krátkou vzdálenost typicky poloviční až třetinová chyba. Oba telefony musí mít satelitní fix (venku, ne Wi-Fi polohu).</p>';
        document.getElementById('ag-dgps-mode-base').addEventListener('click', function () { _mode = 'base'; renderModal(); });
        document.getElementById('ag-dgps-mode-rover').addEventListener('click', function () { _mode = 'rover'; _roverLog = null; _roverRows = null; renderModal(); });
        var de = document.getElementById('ag-dgps-draft-exp');
        if (de) de.addEventListener('click', function () { var d = loadDraft(); if (d) exportLog(d.base, d.t0, d.buckets); });
        var dd = document.getElementById('ag-dgps-draft-del');
        if (dd) dd.addEventListener('click', function () { clearDraft(); renderModal(); });
    }

    // ---- UI základny -----------------------------------------------------------------
    function renderBase(body) {
        if (_watchId != null) {
            body.innerHTML =
                '<div class="bgps-card amber"><b>📡 Základna běží</b> na bodě <b>' + esc(_base.name) + '</b> — telefon nech LEŽET, displej nezhasne.</div>'
                + '<div class="bgps-stats" style="margin-top:10px;">'
                + '<div class="bgps-stat"><div class="k">Čas</div><div class="v" id="ag-dgps-time">0:00</div></div>'
                + '<div class="bgps-stat"><div class="k">Bloků (1 min)</div><div class="v" id="ag-dgps-nb">0</div></div>'
                + '<div class="bgps-stat"><div class="k">GPS teď lže o</div><div class="v" id="ag-dgps-off">–</div></div>'
                + '</div>'
                + '<p style="font-size:12px; opacity:.75; margin:10px 0;">Nech běžet po CELOU dobu, kdy druhý telefon měří. Čím déle, tím víc bodů půjde opravit.</p>'
                + '<button class="btn" id="ag-dgps-stop-exp">⏹ Zastavit a exportovat korekce</button>'
                + '<button class="btn btn-secondary" id="ag-dgps-stop" style="margin-top:8px; color:var(--danger,#fb7185);">Zastavit bez exportu</button>';
            document.getElementById('ag-dgps-stop-exp').addEventListener('click', function () {
                flushBucket();
                var b = _base, bk = _buckets.slice(), t0 = _t0;
                stopBase(false); _mode = 'menu';
                exportLog(b, t0, bk);
                renderModal();
            });
            document.getElementById('ag-dgps-stop').addEventListener('click', function () { stopBase(false); _mode = 'menu'; renderModal(); });
            renderBaseLive();
            return;
        }
        // výběr známého bodu
        var pts = points().slice();
        if (!pts.length) {
            body.innerHTML = '<p style="font-size:13px;">V zakázce nejsou žádné body. Základna musí ležet na bodě s <b>přesně známými souřadnicemi</b> (import ze seznamu, S-JTSK) — naimportuj ho nejdřív.</p>'
                + '<button class="btn btn-secondary" id="ag-dgps-back">← Zpět</button>';
            document.getElementById('ag-dgps-back').addEventListener('click', function () { _mode = 'menu'; renderModal(); });
            return;
        }
        try {
            if (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null) {
                pts.sort(function (a, b) { return planarDist(a.lat, a.lng, userLat, userLng) - planarDist(b.lat, b.lng, userLat, userLng); });
            }
        } catch (e) {}
        var opts = pts.map(function (p) {
            var org = p.prov && p.prov.origin ? p.prov.origin : '?';
            return '<option value="' + esc(p.id) + '">' + esc(p.name) + (org === 'gps-avg' ? ' (měřen GPS — NEvhodný!)' : '') + '</option>';
        }).join('');
        body.innerHTML =
            '<p style="font-size:12.5px; margin:0 0 8px;">Na kterém bodě telefon leží? Musí to být bod se <b>spolehlivě známou polohou</b> (import S-JTSK, vytyčovací bod) — NE bod měřený tímhle mobilem.</p>'
            + '<select id="ag-dgps-pt" class="bgps-name" style="width:100%; margin:4px 0 10px;">' + opts + '</select>'
            + '<button class="btn" id="ag-dgps-start">▶ Spustit základnu</button>'
            + '<button class="btn btn-secondary" id="ag-dgps-back" style="margin-top:8px;">← Zpět</button>';
        document.getElementById('ag-dgps-start').addEventListener('click', function () {
            var id = document.getElementById('ag-dgps-pt').value;
            var pt = null, i;
            var ps = points();
            for (i = 0; i < ps.length; i++) if (ps[i].id === id) { pt = ps[i]; break; }
            if (!pt) return;
            var go = function () { startBase(pt); };
            if (pt.prov && pt.prov.origin === 'gps-avg' && window.agConfirm) {
                window.agConfirm({ title: 'Nevhodná základna', message: 'Bod „' + esc(pt.name) + '" byl sám měřen GPS tohoto typu — korekce z něj zdědí jeho chybu. Opravdu použít?', okText: 'Použít i tak', danger: true }).then(function (ok) { if (ok) go(); });
            } else go();
        });
        document.getElementById('ag-dgps-back').addEventListener('click', function () { _mode = 'menu'; renderModal(); });
    }
    function renderBaseLive() {
        var t = document.getElementById('ag-dgps-time');
        if (t) t.textContent = fmtTime((Date.now() - _t0) / 1000);
        var nb = document.getElementById('ag-dgps-nb');
        if (nb) nb.textContent = String(_buckets.length + (_cur && _cur.n ? 1 : 0));
        var off = document.getElementById('ag-dgps-off');
        if (off) off.textContent = _lastOff ? (Math.hypot(_lastOff.dE, _lastOff.dN).toFixed(2) + ' m') : '–';
    }

    // ---- UI roveru --------------------------------------------------------------------
    function renderRover(body) {
        if (!_roverLog) {
            body.innerHTML =
                '<p style="font-size:12.5px; margin:0 0 8px;">Nahraj soubor <b>dgps-korekce-*.json</b> ze základny (pošli si ho třeba zprávou nebo přes sdílení souborů).</p>'
                + '<input type="file" id="ag-dgps-file" accept=".json,application/json" style="width:100%; margin:6px 0 10px;">'
                + '<button class="btn btn-secondary" id="ag-dgps-back">← Zpět</button>';
            document.getElementById('ag-dgps-file').addEventListener('change', function (ev) {
                var f = ev.target.files && ev.target.files[0]; if (!f) return;
                var r = new FileReader();
                r.onload = function (e) {
                    var log = null;
                    try { log = JSON.parse(e.target.result); } catch (err) {}
                    if (!log || log.kind !== 'dgps-log' || !Array.isArray(log.buckets) || !log.buckets.length || !log.base) {
                        agAlert('DGPS', 'Tohle není platný korekční log základny.'); return;
                    }
                    _roverLog = log;
                    _roverRows = candidates(log).map(function (c) { c.checked = c.state === 'ok'; return c; });
                    renderModal();
                };
                r.readAsText(f);
            });
            document.getElementById('ag-dgps-back').addEventListener('click', function () { _mode = 'menu'; renderModal(); });
            return;
        }
        var log = _roverLog;
        var head = '<p style="font-size:12.5px; margin:0 0 8px;">Základna <b>' + esc(log.base.name) + '</b> · ' + log.buckets.length + ' bloků · ' + fmtHm(log.t0) + '–' + fmtHm(log.t1) + '</p>';
        var okRows = _roverRows.filter(function (r) { return r.state === 'ok'; });
        if (!okRows.length) {
            body.innerHTML = head + '<p style="font-size:13px;">Nenašel jsem žádné body měřené GPS průměrem (origin „gps-avg") v době běhu základny, které by šly opravit.'
                + (_roverRows.some(function (r) { return r.state === 'done'; }) ? '<br><br>Některé body už korigované jsou (dvojí korekce se neaplikuje).' : '')
                + (_roverRows.some(function (r) { return r.state === 'far'; }) ? '<br><br>Některé body jsou od základny dál než ' + (MAX_DIST_M / 1000) + ' km — tam korekce neplatí.' : '') + '</p>'
                + '<button class="btn btn-secondary" id="ag-dgps-back">← Zpět</button>';
            document.getElementById('ag-dgps-back').addEventListener('click', function () { _mode = 'menu'; _roverLog = null; renderModal(); });
            return;
        }
        var rowsHtml = _roverRows.map(function (r, i) {
            if (r.state === 'done') return '<div class="geo-data-row" style="padding:5px 0; opacity:.55;"><span class="geo-label">' + esc(r.p.name) + '</span><span class="geo-value">už korigován (' + esc(r.p.prov.dgps.base || '') + ')</span></div>';
            if (r.state === 'far') return '<div class="geo-data-row" style="padding:5px 0; opacity:.55;"><span class="geo-label">' + esc(r.p.name) + '</span><span class="geo-value">moc daleko (' + (r.dist / 1000).toFixed(1) + ' km)</span></div>';
            var mag = Math.hypot(r.off.dE, r.off.dN);
            return '<div class="geo-data-row" style="padding:5px 0;"><span class="geo-label"><label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" data-i="' + i + '" class="ag-dgps-chk"' + (r.checked ? ' checked' : '') + '> ' + esc(r.p.name) + '</label></span>'
                + '<span class="geo-value">posun ' + (mag * 100).toFixed(0) + ' cm <span style="opacity:.6;">(' + r.off.kind + ')</span></span></div>';
        }).join('');
        body.innerHTML = head + rowsHtml
            + '<button class="btn" id="ag-dgps-apply" style="margin-top:12px;">✓ Aplikovat korekce na vybrané body</button>'
            + '<p style="font-size:11px; opacity:.55; margin:8px 0 0;">Posun bodu se zapíše do žurnálu (jde dohledat i vrátit ruční editací). Každý bod lze korigovat jen jednou.</p>'
            + '<button class="btn btn-secondary" id="ag-dgps-back" style="margin-top:8px;">← Zpět</button>';
        var chks = body.querySelectorAll('.ag-dgps-chk');
        for (var i = 0; i < chks.length; i++) {
            chks[i].addEventListener('change', function () { _roverRows[+this.getAttribute('data-i')].checked = this.checked; });
        }
        document.getElementById('ag-dgps-apply').addEventListener('click', function () {
            var res = applyCorrections(log, _roverRows);
            if (!res.applied) { agAlert('DGPS', 'Nic nevybráno.'); return; }
            agAlert('DGPS hotovo', 'Korigováno <b>' + res.applied + '</b> bodů, průměrný posun <b>' + (res.avg * 100).toFixed(0) + ' cm</b>.<br><br>Provenience bodů doplněna, změny jsou v žurnálu.');
            _roverLog = null; _roverRows = null; _mode = 'menu'; renderModal();
        });
        document.getElementById('ag-dgps-back').addEventListener('click', function () { _mode = 'menu'; _roverLog = null; renderModal(); });
    }

    // ---- registrace ----------------------------------------------------------------------
    window.AGDgps = { open: openModal };
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'dgps', label: 'Dvoutelefonní DGPS', icon: ICON, cat: 'Měření', onClick: openModal, order: 7 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
