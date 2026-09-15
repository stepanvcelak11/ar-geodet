// ===== QTRIG — DVOUTELEFONNÍ DGPS (A2, ODPOJITELNÁ vrstva) =================
// Diferenční korekce bez referenční stanice a bez serveru: ionosféra, troposféra
// a chyby drah družic jsou na vzdálenost do ~2 km pro dva telefony prakticky
// STEJNÉ. Telefon A („Základna") leží na PŘESNĚ ZNÁMÉM bodě a průběžně loguje,
// o kolik a kterým směrem GPS právě „lže" (dE/dN[/dV] proti známé poloze,
// průměrováno po minutových blocích). Telefon B („Rover") normálně měří body
// (Brutální GPS / průměrovaná GPS). Po měření se korekční log přenese QR kódem
// z displeje základny (nebo souborem) a tady se ZPĚTNĚ odečte od bodů roveru —
// společná chyba zmizí.
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

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:agAlert'); } agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
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
    function saveDraft() { try { localStorage.setItem(LS_LOG, JSON.stringify({ base: _base, t0: _t0, buckets: _buckets, liveCode: (_live ? _live.code : null) })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:saveDraft'); } }
    function clearDraft() { try { localStorage.removeItem(LS_LOG); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:clearDraft'); } }

    // ---- DGPS ŽIVĚ PŘES INTERNET (15. 9. 2026, uživatel: „tu dgps klidně udělej") ------
    // Základna nemusí čekat na konec měření a ukazovat QR: každou minutu pošle svůj
    // log pod ŠESTIZNAKOVÝM KÓDEM na server (cloud/worker.js /dgps/push), rover si ho
    // stejným kódem každých 30 s stáhne (/dgps/pull) a z posledních 3 minut bloků
    // udělá KOREKCI PRO PRÁVĚ UKLÁDANÉ BODY — stejným mechanismem jako „Posun GPS na
    // známý bod" (window.agRefShift, src 'dgps-live'), takže ji hlídá i pilulka
    // v js/ref-calibration.js (tam platí 6 min bez dat / 3 km od základny).
    // Dosah je stejný jako u QR verze: do ~2–3 km od základny (dál se atmosférická
    // chyba rozchází). Body uložené PŘED připojením jde opravit zpětně jako dřív.
    // Kód je jediné tajemství (36^6 kombinací, žádné přihlášení) — jako u hodinek.
    var LIVE_POLL_MS = 30000;          // rover: jak často se ptá serveru
    var LIVE_WIN_MS = 3 * 60000;       // rover: korekce = vážený průměr bloků za poslední 3 min
    var LIVE_STALE_MS = 6 * 60000;     // rover: starší data než 6 min = základna stojí/nemá signál
    var LS_LIVE = 'agDgpsLiveRover_v1';
    var _live = null;                  // základna: {code, lastTs, pulls, err, timer}
    var _lr = null;                    // rover: {code, timer, log, lastPull, err, off}

    function apiBase() {
        var b = '';
        try { if (window.AGUcty) b = (typeof AGUcty.apiUrl === 'function' ? AGUcty.apiUrl() : '') || AGUcty.DEFAULT_API || ''; } catch (e) { b = ''; }
        if (!b) b = 'https://ar-geodet-api.ar-geodet.workers.dev';
        return b.replace(/\/+$/, '');
    }
    function makeCode() {
        var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '', i;   // bez 0/O/1/I — čte se z displeje a diktuje
        for (i = 0; i < 6; i++) out += A[Math.floor(Math.random() * A.length)];
        return out;
    }
    function normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }

    // ZÁKLADNA: odeslání logu (volá se po každém hotovém bloku + hned při zapnutí)
    function livePush() {
        if (!_live || !_base) return;
        var bk = _buckets.slice(-90).map(function (b) { return { t: b.t, dE: b.dE, dN: b.dN, dU: b.dU, n: b.n }; });
        fetch(apiBase() + '/dgps/push', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: _live.code, base: { name: _base.name, lat: _base.lat, lng: _base.lng, vyska: _base.vyska }, buckets: bk }) })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (x) {
                if (!_live) return;
                if (x.ok) { _live.lastTs = Date.now(); _live.pulls = x.d.pulls || 0; _live.err = null; }
                else _live.err = (x.d && x.d.error) || ('HTTP ' + (x.status || ''));
                renderBaseLive();
            })
            .catch(function (e) { if (_live) { _live.err = 'bez spojení'; renderBaseLive(); } window.AG && AG.swallow && AG.swallow(e, 'dgps:livePush'); });
    }
    function liveStart() {
        if (_live) return;
        var d = loadDraft();
        _live = { code: (d && d.liveCode) || makeCode(), lastTs: 0, pulls: 0, err: null, timer: null };
        saveDraft();
        livePush();
        // pojistka: i když nepřijde žádný fix (blok se neuzavře), pošli aspoň jednou za 2 min
        _live.timer = setInterval(function () { if (_live && Date.now() - _live.lastTs > 110000) livePush(); }, 60000);
    }
    function liveStop() {
        if (!_live) return;
        try { clearInterval(_live.timer); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:liveStop'); }
        _live = null; saveDraft();
    }

    // ROVER: připojení kódem, pravidelné stahování, korekce pro nové body
    function liveOffset(log) {
        // vážený průměr bloků za posledních LIVE_WIN_MS (podle času základny), jinak null
        var last = log.buckets.length ? log.buckets[log.buckets.length - 1].t : 0;
        var from = last - LIVE_WIN_MS, sw = 0, sE = 0, sN = 0, sU = 0, nU = 0, n = 0;
        var xs = [], ys = [];
        log.buckets.forEach(function (b) {
            if (b.t < from) return;
            var w = b.n || 1; sw += w; sE += w * b.dE; sN += w * b.dN; n++; xs.push(b.dE); ys.push(b.dN);
            if (b.dU != null) { sU += w * b.dU; nU += w; }
        });
        if (!n) return null;
        var mE = sE / sw, mN = sN / sw, s2 = 0, i;
        for (i = 0; i < n; i++) s2 += Math.pow(xs[i] - mE, 2) + Math.pow(ys[i] - mN, 2);
        var sig = n > 1 ? Math.sqrt(s2 / (n - 1)) : 0.5;
        return { dE: mE, dN: mN, dU: nU ? sU / nU : null, n: n, t: last, sterr: Math.max(0.1, sig / Math.sqrt(n)) };
    }
    function liveApplyShift(log, off) {
        var m = mPerDeg(log.base.lat);
        var s = { dlat: -off.dN / m.lat, dlng: -off.dE / m.lng, t: off.t, acc: Math.round(off.sterr * 100) / 100, on: true,
            lat: log.base.lat, lng: log.base.lng, src: 'dgps-live', base: log.base.name, code: _lr ? _lr.code : null };
        window.agRefShift = s;
        try { localStorage.setItem('agRefShift', JSON.stringify(s)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:liveApplyShift'); }
        try { if (window.agRefShiftWatch) window.agRefShiftWatch(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:watch'); }
    }
    function livePull() {
        if (!_lr) return;
        var code = _lr.code;
        fetch(apiBase() + '/dgps/pull?code=' + encodeURIComponent(code) + '&t=' + Date.now(), { cache: 'no-store' })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
            .then(function (x) {
                if (!_lr || _lr.code !== code) return;
                _lr.lastPull = Date.now();
                if (!x.ok) { _lr.err = (x.d && x.d.error) || ('HTTP ' + x.status); _lr.log = _lr.log || null; renderLiveRover(); return; }
                var bk = (x.d.buckets || []).filter(function (b) { return b && isFinite(b.t) && isFinite(b.dE) && isFinite(b.dN); });
                if (!bk.length) { _lr.err = 'základna zatím nemá žádný hotový blok (čekej ~1 min)'; renderLiveRover(); return; }
                _lr.err = null;
                _lr.log = { v: 1, app: 'ar-geodet', kind: 'dgps-log', base: x.d.base, t0: bk[0].t, t1: bk[bk.length - 1].t, bucketS: BUCKET_S, buckets: bk, serverTs: x.d.ts, stale: x.d.stale };
                var off = liveOffset(_lr.log);
                _lr.off = off;
                if (off) liveApplyShift(_lr.log, off);
                renderLiveRover();
            })
            .catch(function (e) { if (_lr && _lr.code === code) { _lr.err = 'bez spojení'; renderLiveRover(); } window.AG && AG.swallow && AG.swallow(e, 'dgps:livePull'); });
    }
    function liveConnect(code) {
        code = normCode(code);
        if (code.length !== 6) { agAlert('DGPS živě', 'Kód základny má 6 znaků (vidíš ho na displeji základny).'); return; }
        liveDisconnect(true);
        _lr = { code: code, timer: null, log: null, lastPull: 0, err: null, off: null, since: Date.now() };
        try { localStorage.setItem(LS_LIVE, JSON.stringify({ code: code, since: _lr.since })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:liveConnect'); }
        livePull();
        _lr.timer = setInterval(livePull, LIVE_POLL_MS);
        renderModal();
    }
    function liveDisconnect(quiet) {
        if (!_lr) return;
        try { clearInterval(_lr.timer); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:liveDisconnect'); }
        var log = _lr.log;
        _lr = null;
        try { localStorage.removeItem(LS_LIVE); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:liveDisconnect2'); }
        // korekci pro nové body vypni — bez živých dat by za chvíli stejně nešla věřit
        try {
            var s = window.agRefShift;
            if (s && s.src === 'dgps-live') { s.on = false; localStorage.setItem('agRefShift', JSON.stringify(s)); if (window.agRefShiftWatch) window.agRefShiftWatch(); }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:liveDisconnect3'); }
        if (!quiet && log) { _roverLog = log; _roverRows = candidates(log).map(function (c) { c.checked = c.state === 'ok'; return c; }); }
    }
    window.addEventListener('pagehide', function () { try { if (_live) clearInterval(_live.timer); if (_lr) clearInterval(_lr.timer); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:pagehide'); } });

    function renderLiveRover() {
        var el = document.getElementById('ag-dgps-lr'); if (!el || !_lr) return;
        var l = _lr.log, off = _lr.off, html = '';
        if (_lr.err) html += '<div class="agdg-live" style="border-color:rgba(251,113,133,.5);background:rgba(251,113,133,.1);"><span>⚠ ' + esc(_lr.err) + '</span></div>';
        if (l && off) {
            var stale = Date.now() - off.t, staleMin = Math.round(stale / 60000);
            var far = null; try { if (typeof userLat === 'number' && isFinite(userLat)) far = planarDist(l.base.lat, l.base.lng, userLat, userLng); } catch (e) { far = null; }
            var bad = stale > LIVE_STALE_MS || (far != null && far > MAX_DIST_M);
            html += '<div class="agdg-live"' + (bad ? ' style="border-color:rgba(251,113,133,.5);background:rgba(251,113,133,.1);"' : '') + '><span class="agdg-dot"' + (bad ? ' style="background:#fb7185"' : '') + '></span><span><b>Připojeno k základně ' + esc(l.base.name) + '</b> (kód ' + esc(_lr.code) + ')<br>'
                + 'GPS tam lže o <b>' + Math.hypot(off.dE, off.dN).toFixed(2).replace('.', ',') + ' m</b> (' + off.n + ' bl., ±' + Math.round(off.sterr * 100) + ' cm) · data ' + (staleMin < 1 ? 'čerstvá' : 'stará ' + staleMin + ' min') + (far != null ? ' · základna ' + (far < 1000 ? Math.round(far) + ' m' : (far / 1000).toFixed(1) + ' km') + ' odsud' : '')
                + (bad ? '<br><b>' + (stale > LIVE_STALE_MS ? 'Základna neposílá — stojí, nebo nemá signál.' : 'Jsi dál než ' + (MAX_DIST_M / 1000) + ' km, korekce tu neplatí.') + '</b>' : '<br>Korekce se přičítá k bodům, které teď uložíš (i v Brutální GPS).') + '</span></div>';
        } else if (!_lr.err) html += '<div class="agdg-live"><span class="agdg-dot"></span><span>Připojuji se k základně ' + esc(_lr.code) + '…</span></div>';
        el.innerHTML = html;
    }

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
        if (_live) livePush();
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
        try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { _wakeLock = w; }).catch(function () {}); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:startBase'); }
        saveDraft();
        if (!_tick) _tick = setInterval(renderBaseLive, 1000);
        renderModal();
    }
    // Rover: připojení přežije zavření okna (interval běží dál) i restart appky — kód je
    // v localStorage a modul se po startu sám nenačte, proto se připojení obnoví až
    // z pilulky / otevřením nástroje; do té doby hlídá stáří dat js/ref-calibration.js.
    (function resumeLive() {
        try {
            var s = JSON.parse(localStorage.getItem(LS_LIVE));
            if (s && s.code && Date.now() - (s.since || 0) < 12 * 3600e3) setTimeout(function () { if (!_lr) liveConnect(s.code); }, 800);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:resumeLive'); }
    })();
    function stopBase(keep) {
        if (_watchId != null) { try { navigator.geolocation.clearWatch(_watchId); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:stopBase'); } _watchId = null; }
        if (_tick) { clearInterval(_tick); _tick = null; }
        try { if (_wakeLock) { _wakeLock.release(); _wakeLock = null; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:stopBase'); }
        flushBucket();
        if (_live) { livePush(); liveStop(); }   // poslední blok ještě odejde, pak konec
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

    // ---- QR přenos korekcí (bez souboru, bez internetu) ---------------------------
    // Log základny je pár desítek čísel, takže se do QR vejde: rover ho jen naskenuje
    // z displeje základny. Formát je textový a kompaktní:
    //   AGD1
    //   <t0 v sekundách>\t<délka bloku s>\t<lat>\t<lng>\t<název bodu>
    //   <Δt s>\t<dE cm>\t<dN cm>\t<dU cm nebo ->\t<počet fixů>
    // Když je log delší, než co ještě mobil z displeje přečte, bloky se po dvojicích
    // slučují (z minutových udělá dvouminutové atd.) — přesnost korekce to prakticky
    // nemění, jen zhrubne časové rozlišení.
    var QR_PREFIX = 'AGD1';
    var QR_MAX = 1100;

    function mergePairs(bk) {
        var out = [];
        for (var i = 0; i < bk.length; i += 2) {
            var a = bk[i], b = bk[i + 1];
            if (!b) { out.push(a); break; }
            var wa = a.n || 1, wb = b.n || 1, w = wa + wb;
            var dU = null, nU = 0, sU = 0;
            if (a.dU != null) { sU += wa * a.dU; nU += wa; }
            if (b.dU != null) { sU += wb * b.dU; nU += wb; }
            if (nU) dU = sU / nU;
            out.push({ t: Math.round((a.t * wa + b.t * wb) / w), dE: (a.dE * wa + b.dE * wb) / w, dN: (a.dN * wa + b.dN * wb) / w, dU: dU, n: w });
        }
        return out;
    }
    function encodeLogQR(base, buckets) {
        var bk = buckets.slice(), merged = 0, txt = '';
        for (;;) {
            var t0 = Math.round(bk[0].t / 1000);
            var rows = bk.map(function (b) {
                return [Math.round(b.t / 1000) - t0, Math.round(b.dE * 100), Math.round(b.dN * 100),
                    (b.dU == null ? '-' : Math.round(b.dU * 100)), (b.n || 1)].join('\t');
            });
            txt = QR_PREFIX + '\n'
                + [t0, BUCKET_S * Math.pow(2, merged), (+base.lat).toFixed(7), (+base.lng).toFixed(7),
                    String(base.name || 'Základna').replace(/[\t\n\r]/g, ' ').slice(0, 24)].join('\t')
                + '\n' + rows.join('\n');
            if (txt.length <= QR_MAX || bk.length < 4) break;
            bk = mergePairs(bk); merged++;
        }
        return { txt: txt, count: bk.length, merged: merged };
    }
    function decodeLogQR(txt) {
        if (!txt) return null;
        var rows = String(txt).replace(/\r/g, '').split('\n');
        if (rows[0] !== QR_PREFIX || rows.length < 3) return null;
        var h = rows[1].split('\t');
        var t0 = parseInt(h[0], 10), bs = parseInt(h[1], 10) || BUCKET_S;
        var lat = parseFloat(h[2]), lng = parseFloat(h[3]);
        if (!isFinite(t0) || !isFinite(lat) || !isFinite(lng)) return null;
        var buckets = [];
        for (var i = 2; i < rows.length; i++) {
            if (!rows[i]) continue;
            var c = rows[i].split('\t');
            if (c.length < 5) continue;
            var dt = parseInt(c[0], 10), dE = parseInt(c[1], 10), dN = parseInt(c[2], 10);
            if (!isFinite(dt) || !isFinite(dE) || !isFinite(dN)) continue;
            var dU = (c[3] === '-' ? null : parseInt(c[3], 10));
            buckets.push({ t: (t0 + dt) * 1000, dE: dE / 100, dN: dN / 100, dU: (dU == null || !isFinite(dU)) ? null : dU / 100, n: parseInt(c[4], 10) || 1 });
        }
        if (!buckets.length) return null;
        return {
            v: 1, app: 'ar-geodet', kind: 'dgps-log',
            base: { name: h[4] || 'Základna', lat: lat, lng: lng },
            t0: buckets[0].t, t1: buckets[buckets.length - 1].t, bucketS: bs, buckets: buckets
        };
    }
    function showLogQR(base, buckets) {
        if (!buckets || !buckets.length) { agAlert('DGPS', 'Log je prázdný — základna zatím nenasbírala žádný použitelný blok.'); return; }
        var enc = encodeLogQR(base, buckets);
        var body = document.getElementById('ag-dgps-body'); if (!body) return;
        function draw() {
            var url = (window.AGQR && window.AGQR.dataURL) ? window.AGQR.dataURL(enc.txt, 5) : null;
            body.innerHTML = url
                ? '<p style="font-size:calc(12.5px * var(--ag-font-scale, 1)); margin:0 0 8px;">Ukaž tenhle kód druhému telefonu: <b>DGPS → Korekce → Naskenovat QR</b>. Displej dej na maximální jas.</p>'
                    + '<img src="' + url + '" alt="QR s korekcemi" style="width:100%; max-width:340px; display:block; margin:0 auto; image-rendering:pixelated; background:#fff; border-radius:8px;">'
                    + '<p style="font-size:calc(12px * var(--ag-font-scale, 1)); opacity:.75; text-align:center; margin:8px 0 0;">Základna ' + esc(base.name) + ' · ' + enc.count + ' bloků'
                    + (enc.merged ? ' · sloučeno po ' + (BUCKET_S * Math.pow(2, enc.merged) / 60) + ' min, ať se vejde do kódu' : '') + '</p>'
                    + '<button class="btn btn-secondary" id="ag-dgps-qr-back" style="margin-top:12px;">← Zpět</button>'
                : '<p style="font-size:calc(13px * var(--ag-font-scale, 1)); color:var(--danger,#fb7185);">QR se nepodařilo vytvořit. Použij export do souboru.</p>'
                    + '<button class="btn btn-secondary" id="ag-dgps-qr-back" style="margin-top:12px;">← Zpět</button>';
            var b = document.getElementById('ag-dgps-qr-back');
            if (b) b.addEventListener('click', function () { _mode = 'menu'; renderModal(); });
        }
        if (typeof qrcode === 'undefined' && window.AGQR && window.AGQR.ensureGen) {
            body.innerHTML = '<p style="font-size:calc(13px * var(--ag-font-scale, 1)); opacity:.75;">Připravuji QR…</p>';
            window.AGQR.ensureGen().then(draw).catch(function () { agAlert('DGPS', 'Knihovnu QR se nepodařilo načíst.'); });
        } else draw();
    }
    function scanLogQR() {
        if (!window.AGQR || typeof window.AGQR.scan !== 'function') { agAlert('DGPS', 'Čtečka QR není dostupná.'); return; }
        window.AGQR.scan({
            title: 'Korekce ze základny',
            hint: 'Namiř kameru na QR kód, který ukazuje telefon-základna.',
            badMsg: 'Tohle nejsou korekce DGPS.',
            onData: function (txt) {
                var log = decodeLogQR(txt);
                if (!log) return false;
                window.AGQR.closeScan();
                _roverLog = log;
                _roverRows = candidates(log).map(function (c) { c.checked = c.state === 'ok'; return c; });
                renderModal();
                return true;
            }
        });
    }

    // ---- ROVER: aplikace korekcí --------------------------------------------------
    // ts = kdy byl bod uložen, t0 = kdy měření na bodě ZAČALO (prov.t0 z Brutální GPS).
    // Korekce se musí průměrovat přes STEJNÉ okno, jaké průměroval rover — u 20minutové
    // okupace vzít jen posledních 6 minut znamená opravovat průměr z celé doby korekcí
    // z její poslední třetiny (atmosféra se za tu dobu posune). Bez t0 (ruční GPS průměr)
    // zůstává původní 6minutové okno.
    function offsetAt(log, ts, t0) {
        var from = (t0 != null && isFinite(t0) && t0 < ts) ? Math.min(t0, ts - APPLY_WIN_MS) : (ts - APPLY_WIN_MS);
        var inWin = log.buckets.filter(function (b) { return b.t >= from && b.t <= ts + 60000; });
        if (inWin.length) {
            var sw = 0, sE = 0, sN = 0, sU = 0, nU = 0;
            inWin.forEach(function (b) { var w = b.n || 1; sw += w; sE += w * b.dE; sN += w * b.dN; if (b.dU != null) { sU += w * b.dU; nU += w; } });
            var mins = Math.round((ts - from) / 60000);
            return { dE: sE / sw, dN: sN / sw, dU: nU ? sU / nU : null, kind: 'okno ' + inWin.length + ' bl. / ' + mins + ' min' };
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
            if (p.prov.dgps || p.refShift) { out.push({ p: p, state: 'done' }); return; }   // refShift = už posunut živou korekcí
            var ts = p.prov.ts;
            if (!ts || ts < log.t0 - NEAR_MS || ts > log.t1 + NEAR_MS) return;
            var off = offsetAt(log, ts, p.prov.t0);
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
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:applyCorrections'); }
            try { if (window.AGJournal) window.AGJournal.commit({ op: 'edit', id: p.id, before: before, after: p, origin: 'dgps' }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:applyCorrections'); }
            applied++; sumMag += mag;
        });
        if (applied) {
            try { if (typeof setStoredData === 'function') setStoredData('arCustomPoints12', JSON.stringify(points())); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:applyCorrections'); }
            try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:applyCorrections'); }
            try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:applyCorrections'); }
            try { if (typeof updateInfoPanel === 'function') updateInfoPanel(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:applyCorrections'); }
            try { if (typeof renderManageList === 'function') renderManageList(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:applyCorrections'); }
        }
        return { applied: applied, avg: applied ? sumMag / applied : 0 };
    }

    // ---- UI ------------------------------------------------------------------------
    var _mode = 'menu';   // 'menu' | 'base' | 'rover'
    var _roverLog = null, _roverRows = null;

    // Ikony volby režimu (SVG místo emoji — jednotné s ostatními nástroji)
    var ICON_BASE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M12 10v11"/><circle cx="12" cy="7.5" r="2.5"/>'
        + '<path d="M7.4 3.6a7 7 0 0 0 0 7.8M16.6 3.6a7 7 0 0 1 0 7.8"/><path d="M8 21h8"/></svg>';
    var ICON_QRIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>'
        + '<path d="M14 14h3v3h-3z"/><path d="M21 14v3M14 21h3M21 20v1"/></svg>';

    var ICON_LIVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M5 12.5a7 7 0 0 1 14 0"/><path d="M8.5 12.5a3.5 3.5 0 0 1 7 0"/><circle cx="12" cy="12.5" r="1"/><path d="M12 13.5V21"/></svg>';

    // ---- UI: živě (rover) ---------------------------------------------------------------
    function renderLive(body) {
        var saved = null; try { saved = JSON.parse(localStorage.getItem(LS_LIVE)); } catch (e) { saved = null; }
        body.innerHTML =
            '<p class="agdg-intro"><b>Jak to funguje:</b> základna (telefon na známém bodě) posílá každou minutu na server, o kolik GPS zrovna lže; tenhle telefon si to každých 30 s stáhne a <b>přičte k bodům, které uložíš</b> — stejně jako „Posun GPS na známý bod", jen se korekce sama obnovuje. Platí do ~' + (MAX_DIST_M / 1000) + ' km od základny; hlídá to pilulka nahoře. Potřebuje internet na obou telefonech.</p>'
            + '<div id="ag-dgps-lr"></div>'
            + (_lr
                ? '<button class="btn btn-secondary" id="ag-dgps-lr-off" style="color:var(--danger,#fb7185);">⏹ Odpojit (a nabídnout opravu starších bodů)</button>'
                : '<label style="font-size:calc(12px * var(--ag-font-scale, 1)); opacity:.8;">Kód základny (6 znaků z jejího displeje)</label>'
                  + '<input id="ag-dgps-code" class="bgps-name" type="text" autocapitalize="characters" autocomplete="off" maxlength="6" placeholder="např. K7QM3X" value="' + esc(saved && saved.code ? saved.code : '') + '" style="width:100%; margin:4px 0 10px; font-size:calc(22px * var(--ag-font-scale, 1)); letter-spacing:.2em; text-align:center; text-transform:uppercase;">'
                  + '<button class="btn btn-primary" id="ag-dgps-lr-go">📡 Připojit se k základně</button>')
            + '<button class="btn btn-secondary" id="ag-dgps-back" style="margin-top:8px;">← Zpět</button>';
        var go = document.getElementById('ag-dgps-lr-go');
        if (go) go.addEventListener('click', function () { liveConnect(document.getElementById('ag-dgps-code').value); });
        var off = document.getElementById('ag-dgps-lr-off');
        if (off) off.addEventListener('click', function () { liveDisconnect(false); _mode = _roverLog ? 'rover' : 'menu'; renderModal(); });
        document.getElementById('ag-dgps-back').addEventListener('click', function () { _mode = 'menu'; renderModal(); });
        renderLiveRover();
    }

    function injectDgStyles() {
        if (document.getElementById('ag-dg-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-dg-style';
        st.textContent = [
            '.agdg-intro{font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.85;margin:0 0 12px;line-height:1.5;}',
            '.agdg-opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:14px;margin:0 0 10px;border-radius:14px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,.12));background:var(--surface-1,rgba(255,255,255,.05));color:inherit;cursor:pointer;font:inherit;}',
            '.agdg-opt-ic{flex:0 0 auto;width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;',
            '  background:var(--accent-soft,rgba(47,158,116,.15));color:var(--accent,#2f9e74);}',
            '.agdg-opt-ic svg{width:24px;height:24px;}',
            '.agdg-opt-tx{flex:1;min-width:0;font:600 14px/1.25 var(--font-ui,system-ui),sans-serif;}',
            '.agdg-opt-tx small{display:block;font-weight:500;font-size:calc(12px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);margin-top:3px;line-height:1.4;}',
            '.agdg-opt-arr{flex:0 0 auto;color:var(--text-muted,#9aa1ac);font-size:calc(20px * var(--ag-font-scale, 1));line-height:1;}',
            '.agdg-live{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:14px;margin:0 0 10px;',
            '  border:1px solid rgba(251,191,36,.4);background:rgba(251,191,36,.10);font-size:calc(13px * var(--ag-font-scale, 1));line-height:1.45;}',
            '.agdg-dot{flex:0 0 auto;width:10px;height:10px;border-radius:50%;background:#fbbf24;margin-top:4px;animation:agdgPulse 1.6s ease-in-out infinite;}',
            '@keyframes agdgPulse{0%,100%{opacity:1}50%{opacity:.3}}',
            '.agdg-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 10px;}',
            '.agdg-stat{padding:10px 6px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,.1));',
            '  background:var(--surface-1,rgba(255,255,255,.05));text-align:center;}',
            '.agdg-stat .k{font:600 10.5px/1.2 var(--font-ui,system-ui),sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);margin-bottom:4px;}',
            '.agdg-stat .v{font:700 17px/1.1 var(--font-mono,monospace);color:var(--data,#e6bd76);}',
            '.agdg-draft{padding:12px 14px;border-radius:14px;margin:2px 0 10px;border:1px dashed var(--glass-border,rgba(255,255,255,.2));',
            '  background:var(--surface-1,rgba(255,255,255,.04));font-size:calc(13px * var(--ag-font-scale, 1));line-height:1.4;}',
            '.agdg-draft small{display:block;color:var(--text-muted,#9aa1ac);font-size:calc(12px * var(--ag-font-scale, 1));margin:2px 0 8px;}',
            '.agdg-draft-b{display:flex;gap:8px;flex-wrap:wrap;}',
            '.agdg-draft-b .btn{flex:1;margin:0;min-width:90px;}',
            '.agdg-note{font-size:calc(11.5px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);margin:10px 0 0;line-height:1.5;}',
            'body.ag-glove .agdg-opt{padding:17px 14px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function ensureModal() {
        injectDgStyles();
        if (document.getElementById(DLG_ID)) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = DLG_ID; el.setAttribute('data-ag-needs', 'gps'); /* js/power-save.js: senzory neuspávat, dokud je okno vidět */
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
        if (_mode === 'live') { renderLive(body); return; }
        // menu
        var draft = loadDraft();
        body.innerHTML =
            '<p class="agdg-intro">Atmosférická chyba GPS je pro dva telefony do ~2 km stejná. Jeden telefon polož na <b>přesně známý bod</b> jako základnu, druhým měř. Korekce buď chodí <b>živě přes internet</b> (kód základny, body jsou opravené hned při uložení), nebo je přeneseš <b>naskenováním QR</b> z displeje základny (nebo souborem) a body se opraví zpětně.</p>'
            + (_lr ? '<div id="ag-dgps-lr"></div>' : '')
            + '<button type="button" class="agdg-opt" id="ag-dgps-mode-base">'
            + '  <span class="agdg-opt-ic">' + ICON_BASE + '</span>'
            + '  <span class="agdg-opt-tx">Základna<small>tento telefon leží na známém bodě a měří, o kolik GPS lže</small></span>'
            + '  <span class="agdg-opt-arr">›</span></button>'
            + '<button type="button" class="agdg-opt" id="ag-dgps-mode-live">'
            + '  <span class="agdg-opt-ic">' + ICON_LIVE + '</span>'
            + '  <span class="agdg-opt-tx">' + (_lr ? 'Živě: připojeno<small>stav, odpojení a zpětná oprava starších bodů</small>' : 'Živě z internetu<small>zadej kód základny; nové body se opravují hned, dosah ~2 km</small>') + '</span>'
            + '  <span class="agdg-opt-arr">›</span></button>'
            + '<button type="button" class="agdg-opt" id="ag-dgps-mode-rover">'
            + '  <span class="agdg-opt-ic">' + ICON_QRIN + '</span>'
            + '  <span class="agdg-opt-tx">Korekce z QR<small>naskenovat QR (nebo nahrát soubor) ze základny a opravit body zpětně</small></span>'
            + '  <span class="agdg-opt-arr">›</span></button>'
            + (draft && draft.buckets.length
                ? '<div class="agdg-draft"><b>Rozpracovaný log základny</b>'
                  + '<small>' + draft.buckets.length + ' bloků · bod ' + esc(draft.base.name) + '</small>'
                  + '<div class="agdg-draft-b">'
                  + '<button class="btn btn-secondary" id="ag-dgps-draft-qr">Ukázat QR</button>'
                  + '<button class="btn btn-secondary" id="ag-dgps-draft-exp">Exportovat</button>'
                  + '<button class="btn btn-secondary" id="ag-dgps-draft-del" style="color:var(--danger,#fb7185);">Zahodit</button>'
                  + '</div></div>'
                : '')
            + '<p class="agdg-note">Zisk: na krátkou vzdálenost typicky poloviční až třetinová chyba. Oba telefony musí mít satelitní fix (venku, ne Wi-Fi polohu).</p>';
        document.getElementById('ag-dgps-mode-base').addEventListener('click', function () { _mode = 'base'; renderModal(); });
        document.getElementById('ag-dgps-mode-rover').addEventListener('click', function () { _mode = 'rover'; _roverLog = null; _roverRows = null; renderModal(); });
        document.getElementById('ag-dgps-mode-live').addEventListener('click', function () { _mode = 'live'; renderModal(); });
        renderLiveRover();
        var dq = document.getElementById('ag-dgps-draft-qr');
        if (dq) dq.addEventListener('click', function () { var d = loadDraft(); if (d) showLogQR(d.base, d.buckets); });
        var de = document.getElementById('ag-dgps-draft-exp');
        if (de) de.addEventListener('click', function () { var d = loadDraft(); if (d) exportLog(d.base, d.t0, d.buckets); });
        var dd = document.getElementById('ag-dgps-draft-del');
        if (dd) dd.addEventListener('click', function () { clearDraft(); renderModal(); });
    }

    // ---- UI základny -----------------------------------------------------------------
    function renderBase(body) {
        if (_watchId != null) {
            body.innerHTML =
                '<div class="agdg-live"><span class="agdg-dot"></span><span><b>Základna běží</b> na bodě <b>' + esc(_base.name) + '</b> — telefon nech ležet, displej nezhasne.</span></div>'
                + '<div class="agdg-stats">'
                + '<div class="agdg-stat"><div class="k">Čas</div><div class="v" id="ag-dgps-time">0:00</div></div>'
                + '<div class="agdg-stat"><div class="k">Bloků (1 min)</div><div class="v" id="ag-dgps-nb">0</div></div>'
                + '<div class="agdg-stat"><div class="k">GPS lže o</div><div class="v" id="ag-dgps-off">–</div></div>'
                + '</div>'
                + '<div id="ag-dgps-livebox"></div>'
                + '<p class="agdg-note" style="margin:0 0 12px;">Nech běžet po CELOU dobu, kdy druhý telefon měří. Čím déle, tím víc bodů půjde opravit.</p>'
                + '<button class="btn" id="ag-dgps-stop-qr">Zastavit a ukázat QR s korekcemi</button>'
                + '<button class="btn btn-secondary" id="ag-dgps-stop-exp" style="margin-top:8px;">Zastavit a uložit do souboru</button>'
                + '<button class="btn btn-secondary" id="ag-dgps-stop" style="margin-top:8px; color:var(--danger,#fb7185);">Zastavit bez exportu</button>';
            document.getElementById('ag-dgps-stop-qr').addEventListener('click', function () {
                flushBucket();
                var b = _base, bk = _buckets.slice();
                stopBase(true);            // log necháváme, dokud si ho rover nenačte
                _mode = 'menu'; renderModal();
                showLogQR(b, bk);
            });
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
            body.innerHTML = '<p class="agdg-intro">V zakázce nejsou žádné body. Základna musí ležet na bodě s <b>přesně známými souřadnicemi</b> (import ze seznamu, S-JTSK) — naimportuj ho nejdřív.</p>'
                + '<button class="btn btn-secondary" id="ag-dgps-back">← Zpět</button>';
            document.getElementById('ag-dgps-back').addEventListener('click', function () { _mode = 'menu'; renderModal(); });
            return;
        }
        try {
            if (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null) {
                pts.sort(function (a, b) { return planarDist(a.lat, a.lng, userLat, userLng) - planarDist(b.lat, b.lng, userLat, userLng); });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dgps:renderBase'); }
        var opts = pts.map(function (p) {
            var org = p.prov && p.prov.origin ? p.prov.origin : '?';
            return '<option value="' + esc(p.id) + '">' + esc(p.name) + (org === 'gps-avg' ? ' (měřen GPS — NEvhodný!)' : '') + '</option>';
        }).join('');
        body.innerHTML =
            '<p class="agdg-intro">Na kterém bodě telefon leží? Musí to být bod se <b>spolehlivě známou polohou</b> (import S-JTSK, vytyčovací bod) — NE bod měřený tímhle mobilem.</p>'
            + '<select id="ag-dgps-pt" class="bgps-name" style="width:100%; margin:4px 0 12px;">' + opts + '</select>'
            + '<button class="btn" id="ag-dgps-start">Spustit základnu</button>'
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
        var lb = document.getElementById('ag-dgps-livebox');
        if (lb) {
            var want = _live ? ('on:' + _live.code + ':' + (_live.err || '') + ':' + _live.pulls + ':' + Math.floor((Date.now() - _live.lastTs) / 15000)) : 'off';
            if (lb.getAttribute('data-k') !== want) {
                lb.setAttribute('data-k', want);
                lb.innerHTML = _live
                    ? '<div class="agdg-live" style="border-color:rgba(74,222,128,.45);background:rgba(74,222,128,.08);"><span class="agdg-dot" style="background:#4ade80"></span><span><b>Sdílím živě</b> — kód základny pro druhý telefon:<br>'
                      + '<span style="display:block;font:700 30px/1.2 var(--font-mono,monospace);letter-spacing:.2em;text-align:center;margin:6px 0;">' + esc(_live.code) + '</span>'
                      + (_live.err ? '<span style="color:var(--danger,#fb7185)">⚠ odeslání selhalo: ' + esc(_live.err) + '</span>' : (_live.lastTs ? 'poslední odeslání před ' + Math.round((Date.now() - _live.lastTs) / 1000) + ' s · ' + _live.pulls + '× staženo' : 'odesílám…'))
                      + '</span></div>'
                      + '<button class="btn btn-secondary" id="ag-dgps-live-off" style="margin:0 0 10px;">Přestat sdílet živě</button>'
                    : '<button class="btn btn-secondary" id="ag-dgps-live-on" style="margin:0 0 10px;">📡 Sdílet korekce živě (kód pro druhý telefon)</button>';
                var on = document.getElementById('ag-dgps-live-on'); if (on) on.addEventListener('click', function () { liveStart(); renderBaseLive(); });
                var of = document.getElementById('ag-dgps-live-off'); if (of) of.addEventListener('click', function () { liveStop(); renderBaseLive(); });
            }
        }
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
                '<p class="agdg-intro">Nejrychleji přes <b>QR</b>: základna si nechá korekce zobrazit a ty je tímhle telefonem naskenuješ. Bez sítě, bez posílání souborů.</p>'
                + '<button type="button" class="agdg-opt" id="ag-dgps-scan">'
                + '  <span class="agdg-opt-ic">' + ICON_QRIN + '</span>'
                + '  <span class="agdg-opt-tx">Naskenovat QR ze základny<small>namiř kameru na displej druhého telefonu</small></span>'
                + '  <span class="agdg-opt-arr">›</span></button>'
                + '<p class="agdg-intro" style="margin:4px 0 8px;">Nebo nahraj soubor <b>dgps-korekce-*.json</b> ze základny (zprávou, přes sdílení souborů).</p>'
                + '<input type="file" id="ag-dgps-file" accept=".json,application/json" style="width:100%; margin:0 0 12px;">'
                + '<button class="btn btn-secondary" id="ag-dgps-back">← Zpět</button>';
            document.getElementById('ag-dgps-scan').addEventListener('click', scanLogQR);
            document.getElementById('ag-dgps-file').addEventListener('change', function (ev) {
                var f = ev.target.files && ev.target.files[0]; if (!f) return;
                var r = new FileReader();
                r.onload = function (e) {
                    var log = null;
                    try { log = JSON.parse(e.target.result); } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'dgps:onload'); }
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
        var head = '<p style="font-size:calc(12.5px * var(--ag-font-scale, 1)); margin:0 0 8px;">Základna <b>' + esc(log.base.name) + '</b> · ' + log.buckets.length + ' bloků · ' + fmtHm(log.t0) + '–' + fmtHm(log.t1) + '</p>';
        var okRows = _roverRows.filter(function (r) { return r.state === 'ok'; });
        if (!okRows.length) {
            body.innerHTML = head + '<p style="font-size:calc(13px * var(--ag-font-scale, 1));">Nenašel jsem žádné body měřené GPS průměrem (origin „gps-avg") v době běhu základny, které by šly opravit.'
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
            + '<p style="font-size:calc(11px * var(--ag-font-scale, 1)); opacity:.55; margin:8px 0 0;">Posun bodu se zapíše do žurnálu (jde dohledat i vrátit ruční editací). Každý bod lze korigovat jen jednou.</p>'
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
    window.AGDgps = { open: openModal, _test: { liveOffset: liveOffset, normCode: normCode, makeCode: makeCode, liveConnect: liveConnect, liveDisconnect: liveDisconnect, stav: function () { return { lr: _lr ? { code: _lr.code, off: _lr.off, err: _lr.err } : null, live: _live ? { code: _live.code, pulls: _live.pulls, err: _live.err } : null }; } } };
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'dgps', label: 'Dvoutelefonní DGPS', icon: ICON, cat: 'Měření', onClick: openModal, order: 7 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
