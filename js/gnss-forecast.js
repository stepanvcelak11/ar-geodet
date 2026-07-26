// ===== AR Geodet — GNSS PŘEDPOVĚĎ „počasí pro GPS" (ODPOJITELNÁ vrstva) ========
// Hodinová předpověď podmínek pro GNSS měření na dnešek/zítřek — jako předpověď
// počasí, ale pro družice:
//   • GEOMETRIE: PDOP + počet družic po hodinách z drah TLE (SGP4, satellite.js).
//     Dráhy se berou ze stejné cache jako nástroj „Družice" (arTleCache1) a když
//     jsou starší než 3 dny, stáhnou se z CelesTrak (offline stačí cache).
//   • IONOSFÉRA: planetární Kp index z NOAA SWPC (pozorovaný + předpověď, po 3 h,
//     bez API klíče). Kp ≥ 5 = geomagnetická bouře → RTK/GPS degradováno.
//   • POČASÍ: z poslední cache js/pocasi.js (agWeatherCache_v1) se k hodinám
//     přidá poznámka déšť/bouřka (bouřka = nebezpečí s výtyčkou, ne kvalita GNSS).
// Výstup: semafor po hodinách (výborné/dobré/slabé) + doporučené „nejlepší okno".
// Doplňuje „Skóre místa (GPS)" (teď a tady) a „Kdy se vrátit" v Brutálním GPS
// (jen minuty dopředu) — tohle je plán na celý den.
//
// Neinvazivní: NEEDITUJE logika.js/grafika.js. Používá globály satelity.js
// (tleSats, computePDOP…), jen když existují — jinak si TLE načte/spočítá sám.
// Vstup: dlaždice „GNSS předpověď" v Nástrojích (Měření). API: window.agOpenGnssForecast().
// Odstranění: smaž js/gnss-forecast.js + řádek <script> v index.html a přegeneruj
// sw.js (scripts/gen_sw_assets.py).
// ================================================================================
(function () {
    'use strict';
    if (window.__agGnssForecastInit) return;
    window.__agGnssForecastInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2M4.6 5.6l1.4 1.4M19.4 5.6 18 7"/><circle cx="12" cy="11" r="4"/><path d="M3 19h18M6 22h12"/></svg>';
    var STYLE_ID = 'ag-gf-style';
    var TLE_URL_FALLBACK = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=tle';
    var TLE_KEY = 'arTleCache1';               // sdílená cache se satelity.js ({t, txt})
    var KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
    var KP_KEY = 'agKpCache_v1';               // {t, rows:[{t,kp,src}]}
    var KP_MAX_AGE_MS = 3 * 3600 * 1000;
    var EL_MASK = 10;                          // elevační maska (stejně jako satelity.js)
    var HOURS = 24;

    var _sats = null;      // [{satrec}] lokálně naparsované TLE (fallback)
    var _kp = null;        // [{t(ms UTC), kp, src}]
    var _kpStale = false;

    function toast(m) { try { if (typeof window.quickToast === 'function') return window.quickToast(m); } catch (e) {} }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function pad2(n) { return ('0' + n).slice(-2); }

    // ---- poloha (GPS appky, fallback poslední známá) -------------------------------
    function pos() {
        try { if (typeof userLat === 'number' && userLat && typeof userLng === 'number') return { lat: userLat, lng: userLng, alt: (typeof userAlt === 'number' && isFinite(userAlt)) ? userAlt : 300 }; } catch (e) {}
        try { var p = JSON.parse(localStorage.getItem('arLastPos')); if (p && p.lat) return { lat: +p.lat, lng: +(p.lng != null ? p.lng : p.lon), alt: 300 }; } catch (e) {}
        return null;
    }

    // ---- TLE: preferuj data satelity.js, jinak vlastní parse téže cache ------------
    function parseTleText(txt) {
        var out = [], lines = String(txt || '').split(/\r?\n/), i;
        if (typeof satellite === 'undefined') return out;
        for (i = 0; i + 2 < lines.length; i++) {
            var l1 = lines[i + 1], l2 = lines[i + 2];
            if (lines[i] && l1 && l2 && l1.charAt(0) === '1' && l2.charAt(0) === '2') {
                try { out.push({ satrec: satellite.twoline2satrec(l1, l2) }); } catch (e) {}
                i += 2;
            }
        }
        return out;
    }
    function getSats() {
        try { if (typeof tleSats !== 'undefined' && tleSats && tleSats.length) return tleSats; } catch (e) {}
        if (_sats && _sats.length) return _sats;
        try {
            var c = JSON.parse(localStorage.getItem(TLE_KEY));
            if (c && c.txt) _sats = parseTleText(c.txt);
        } catch (e) {}
        return _sats || [];
    }
    function tleAgeH() {
        try { if (typeof tleFetchedAt !== 'undefined' && tleFetchedAt) return (Date.now() - tleFetchedAt) / 36e5; } catch (e) {}
        try { var c = JSON.parse(localStorage.getItem(TLE_KEY)); if (c && c.t) return (Date.now() - c.t) / 36e5; } catch (e) {}
        return null;
    }
    function ensureTle(cb) {
        var age = tleAgeH();
        if (getSats().length && age != null && age < 72) { cb(); return; }
        // stáhnout (satelity.js refreshTLE když existuje, jinak vlastní fetch do téže cache)
        try {
            if (typeof refreshTLE === 'function') { Promise.resolve(refreshTLE(true)).then(cb, cb); return; }
        } catch (e) {}
        var ctrl = ('AbortController' in window) ? new AbortController() : null;
        var tm = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (e) {} }, 20000);
        fetch(TLE_URL_FALLBACK, ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.text(); }).then(function (txt) {
            clearTimeout(tm);
            var parsed = parseTleText(txt);
            if (parsed.length >= 10) {
                _sats = parsed;
                try { localStorage.setItem(TLE_KEY, JSON.stringify({ t: Date.now(), txt: txt })); } catch (e) {}
            }
            cb();
        }).catch(function () { clearTimeout(tm); cb(); });
    }

    // ---- Kp index (NOAA SWPC) -------------------------------------------------------
    function parseKpRows(json) {
        var out = [], i;
        if (!json || !json.length) return out;
        for (i = 1; i < json.length; i++) {   // [0] = hlavička
            var r = json[i];
            if (!r || !r[0]) continue;
            var m = String(r[0]).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
            if (!m) continue;
            var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
            var kp = parseFloat(r[1]);
            if (isFinite(kp)) out.push({ t: t, kp: kp, src: r[2] || '' });
        }
        return out;
    }
    function ensureKp(cb) {
        try {
            var c = JSON.parse(localStorage.getItem(KP_KEY));
            if (c && c.rows && c.rows.length && Date.now() - c.t < KP_MAX_AGE_MS) { _kp = c.rows; _kpStale = false; cb(); return; }
        } catch (e) {}
        var ctrl = ('AbortController' in window) ? new AbortController() : null;
        var tm = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (e) {} }, 9000);
        fetch(KP_URL, ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.json(); }).then(function (j) {
            clearTimeout(tm);
            var rows = parseKpRows(j);
            if (rows.length) {
                _kp = rows; _kpStale = false;
                try { localStorage.setItem(KP_KEY, JSON.stringify({ t: Date.now(), rows: rows })); } catch (e) {}
            }
            cb();
        }).catch(function () {
            clearTimeout(tm);
            try { var c2 = JSON.parse(localStorage.getItem(KP_KEY)); if (c2 && c2.rows) { _kp = c2.rows; _kpStale = true; } } catch (e) {}
            cb();
        });
    }
    function kpAt(tMs) {
        if (!_kp || !_kp.length) return null;
        var best = null, i;
        for (i = 0; i < _kp.length; i++) {   // Kp platí pro 3h blok od času záznamu
            if (_kp[i].t <= tMs && tMs < _kp[i].t + 3 * 3600 * 1000) return _kp[i].kp;
            if (_kp[i].t <= tMs) best = _kp[i].kp;
        }
        return best;
    }

    // ---- SGP4 geometrie: PDOP + počet družic v čase t --------------------------------
    function satObsAt(date, p) {
        var out = [], sats = getSats(), i;
        if (typeof satellite === 'undefined' || !sats.length || !p) return out;
        var gmst = satellite.gstime(date);
        var gd = { latitude: p.lat * Math.PI / 180, longitude: p.lng * Math.PI / 180, height: (p.alt || 300) / 1000 };
        for (i = 0; i < sats.length; i++) {
            try {
                var pv = satellite.propagate(sats[i].satrec, date);
                if (!pv || !pv.position) continue;
                var la = satellite.ecfToLookAngles(gd, satellite.eciToEcf(pv.position, gmst));
                var el = la.elevation * 180 / Math.PI;
                if (el >= EL_MASK) out.push({ az: (la.azimuth * 180 / Math.PI + 360) % 360, el: el });
            } catch (e) {}
        }
        return out;
    }
    // PDOP (kopie geometrie ze satelity.js, ať modul stojí sám i bez něj)
    function pdopOf(obs) {
        try { if (typeof computePDOP === 'function') { var v = computePDOP(obs); return (v != null && isFinite(v)) ? v : null; } } catch (e) {}
        if (obs.length < 4) return null;
        var N = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], i, j, r;
        for (i = 0; i < obs.length; i++) {
            var a = obs[i].az * Math.PI / 180, e = obs[i].el * Math.PI / 180;
            var row = [-Math.cos(e) * Math.sin(a), -Math.cos(e) * Math.cos(a), -Math.sin(e), 1];
            for (j = 0; j < 4; j++) for (r = 0; r < 4; r++) N[j][r] += row[j] * row[r];
        }
        var M = N.map(function (rw, ix) { return rw.concat([0, 1, 2, 3].map(function (jx) { return ix === jx ? 1 : 0; })); });
        for (var c = 0; c < 4; c++) {
            var piv = c;
            for (r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
            if (Math.abs(M[piv][c]) < 1e-12) return null;
            var t = M[c]; M[c] = M[piv]; M[piv] = t;
            var d = M[c][c]; for (j = 0; j < 8; j++) M[c][j] /= d;
            for (r = 0; r < 4; r++) { if (r === c) continue; var f = M[r][c]; for (j = 0; j < 8; j++) M[r][j] -= f * M[c][j]; }
        }
        var q = M[0][4] + M[1][5] + M[2][6];
        return q > 0 ? Math.sqrt(q) : null;
    }

    // ---- počasí k hodině (jen poznámka, z cache js/pocasi.js) -------------------------
    function weatherNotes() {
        var map = {};
        try {
            var c = JSON.parse(localStorage.getItem('agWeatherCache_v1'));
            if (!c || !c.data || !c.data.hourly || Date.now() - c.t > 12 * 3600 * 1000) return map;
            var p = pos();
            if (p && c.lat != null) {
                var dd = Math.hypot((c.lat - p.lat) * 111, (c.lon - p.lng) * 71);
                if (dd > 50) return map;   // předpověď pro jiné místo
            }
            c.data.hourly.forEach(function (h) {
                if (h.t == null) return;
                var note = null;
                if (h.code != null && h.code >= 95) note = '⛈ bouřka — s výtyčkou pryč z terénu';
                else if ((h.prob != null && h.prob >= 60) || (h.precip != null && h.precip >= 1)) note = '🌧 déšť';
                if (note) map[Math.floor(h.t / 3600) * 3600] = note;
            });
        } catch (e) {}
        return map;
    }

    // ---- hodnocení hodiny --------------------------------------------------------------
    function rate(pdop, nsat, kp) {
        if (pdop == null || nsat < 4) return { cls: 'bad', label: 'nelze určit' };
        if (kp != null && kp >= 6) return { cls: 'bad', label: 'geomag. bouře' };
        if (kp != null && kp >= 5) return { cls: 'mid', label: 'zvýšená ionosféra' };
        if (pdop <= 1.8 && nsat >= 8) return { cls: 'good', label: 'výborné' };
        if (pdop <= 2.8) return { cls: 'mid', label: 'dobré' };
        return { cls: 'bad', label: 'slabá geometrie' };
    }

    function buildModel() {
        var p = pos();
        if (!p) return { err: 'Bez polohy to nejde — počkej na GPS fix (nebo otevři mapu, ať se poloha načte).' };
        if (typeof satellite === 'undefined') return { err: 'Knihovna satellite.js není načtená.' };
        if (!getSats().length) return { err: 'Nemám dráhy družic (TLE). Připoj se na chvíli k internetu a zkus to znovu.' };
        var now = new Date();
        var start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
        var wn = weatherNotes();
        var rows = [], i;
        for (i = 0; i < HOURS; i++) {
            var t = new Date(start.getTime() + i * 3600 * 1000);
            // vzorek na začátku a v půlce hodiny — bere se horší (geometrie se mění rychle)
            var o1 = satObsAt(t, p), o2 = satObsAt(new Date(t.getTime() + 30 * 60000), p);
            var p1 = pdopOf(o1), p2 = pdopOf(o2);
            var pdop = (p1 == null) ? p2 : (p2 == null ? p1 : Math.max(p1, p2));
            var nsat = Math.min(o1.length || 0, o2.length || 0) || Math.max(o1.length, o2.length);
            var kp = kpAt(t.getTime());
            var r = rate(pdop, nsat, kp);
            rows.push({ t: t, pdop: pdop, nsat: nsat, kp: kp, cls: r.cls, label: r.label, note: wn[Math.floor(t.getTime() / 1000 / 3600) * 3600] || null });
        }
        // nejlepší souvislé okno (good, případně mid) dlouhé aspoň 2 h
        function findWin(cls) {
            var best = null, s = -1;
            for (var j = 0; j <= rows.length; j++) {
                var ok = j < rows.length && (rows[j].cls === 'good' || (cls === 'mid' && rows[j].cls !== 'bad'));
                if (ok && s < 0) s = j;
                if ((!ok || j === rows.length) && s >= 0) {
                    if (j - s >= 2 && (!best || j - s > best.n)) best = { s: s, n: j - s };
                    s = -1;
                }
            }
            return best;
        }
        var win = findWin('good') || findWin('mid');
        var kpNow = kpAt(Date.now());
        return { rows: rows, win: win, kpNow: kpNow, tleAge: tleAgeH(), pos: p };
    }

    // ---- UI -----------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent =
            '#ag-gf-modal .ag-gf-now{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 12px;}' +
            '#ag-gf-modal .ag-gf-stat{flex:1 1 90px;background:var(--bg-input,rgba(255,255,255,.06));border-radius:10px;padding:8px 10px;text-align:center;}' +
            '#ag-gf-modal .ag-gf-stat b{display:block;font-size:1.25em;}' +
            '#ag-gf-modal .ag-gf-stat small{color:var(--text-muted,#9aa1ac);}' +
            '#ag-gf-modal .ag-gf-win{background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.4);border-radius:10px;padding:9px 12px;margin:0 0 12px;font-size:.95em;}' +
            '#ag-gf-modal .ag-gf-row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:8px;font-size:.92em;}' +
            '#ag-gf-modal .ag-gf-row:nth-child(odd){background:rgba(255,255,255,.03);}' +
            '#ag-gf-modal .ag-gf-h{width:52px;font-variant-numeric:tabular-nums;color:var(--text-muted,#9aa1ac);}' +
            '#ag-gf-modal .ag-gf-dot{width:12px;height:12px;border-radius:50%;flex:0 0 12px;}' +
            '#ag-gf-modal .good .ag-gf-dot{background:#34d399;} #ag-gf-modal .mid .ag-gf-dot{background:#fbbf24;} #ag-gf-modal .bad .ag-gf-dot{background:#f87171;}' +
            '#ag-gf-modal .ag-gf-v{width:88px;font-variant-numeric:tabular-nums;}' +
            '#ag-gf-modal .ag-gf-lb{flex:1;} #ag-gf-modal .ag-gf-note{color:#fbbf24;font-size:.88em;}' +
            '#ag-gf-modal .ag-gf-foot{color:var(--text-muted,#9aa1ac);font-size:.82em;margin-top:10px;line-height:1.45;}';
        document.head.appendChild(s);
    }
    function ensureModal() {
        var m = document.getElementById('ag-gf-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'ag-gf-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' GNSS předpověď</h3>' +
            '  <div id="ag-gf-body"><div style="padding:14px;color:var(--text-muted,#9aa1ac);">Počítám dráhy družic…</div></div>' +
            '  <div style="display:flex;gap:8px;margin-top:12px;">' +
            '    <button type="button" class="btn btn-secondary" id="ag-gf-refresh">Aktualizovat</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-gf-close" style="margin-left:auto;">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-gf-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-gf-refresh').addEventListener('click', function () {
            try { localStorage.removeItem(KP_KEY); } catch (e) {}
            refresh(true);
        });
        return m;
    }
    function kpTxt(kp) {
        if (kp == null) return '–';
        var s = kp.toFixed(1);
        if (kp >= 6) return s + ' bouře';
        if (kp >= 5) return s + ' aktivní';
        if (kp >= 4) return s + ' neklidno';
        return s + ' klid';
    }
    function render(model) {
        var body = document.getElementById('ag-gf-body');
        if (!body) return;
        if (model.err) { body.innerHTML = '<div style="padding:14px;color:var(--text-muted,#9aa1ac);">' + esc(model.err) + '</div>'; return; }
        var r0 = model.rows[0];
        var h = '<div class="ag-gf-now">' +
            '<div class="ag-gf-stat"><small>PDOP teď</small><b>' + (r0.pdop != null ? r0.pdop.toFixed(1) : '–') + '</b></div>' +
            '<div class="ag-gf-stat"><small>Družic ≥' + EL_MASK + '°</small><b>' + (r0.nsat || '–') + '</b></div>' +
            '<div class="ag-gf-stat"><small>Kp index' + (_kpStale ? ' (offline)' : '') + '</small><b>' + esc(kpTxt(model.kpNow)) + '</b></div>' +
            '</div>';
        if (model.win) {
            var a = model.rows[model.win.s].t, b = new Date(model.rows[model.win.s + model.win.n - 1].t.getTime() + 3600 * 1000);
            h += '<div class="ag-gf-win">✅ <b>Nejlepší okno: ' + pad2(a.getHours()) + ':00–' + pad2(b.getHours()) + ':00</b>' +
                (a.getDate() !== new Date().getDate() ? ' (zítra)' : '') +
                ' — naplánuj si na něj nejpřesnější body (vytyčení, kontrolu, Brutální GPS).</div>';
        } else {
            h += '<div class="ag-gf-win" style="background:rgba(251,191,36,.1);border-color:rgba(251,191,36,.4);">Souvislé výborné okno se v příštích 24 h nenašlo — měř v hodinách se zeleným/žlutým puntíkem.</div>';
        }
        model.rows.forEach(function (r) {
            var newDay = r.t.getHours() === 0;
            if (newDay) h += '<div style="margin:8px 0 2px;color:var(--text-muted,#9aa1ac);font-size:.85em;">— ' + r.t.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric' }) + ' —</div>';
            h += '<div class="ag-gf-row ' + r.cls + '">' +
                '<span class="ag-gf-h">' + pad2(r.t.getHours()) + ':00</span>' +
                '<span class="ag-gf-dot"></span>' +
                '<span class="ag-gf-v">PDOP ' + (r.pdop != null ? r.pdop.toFixed(1) : '–') + '</span>' +
                '<span class="ag-gf-v">' + r.nsat + ' druž.' + (r.kp != null && r.kp >= 5 ? ' · Kp' + Math.round(r.kp) : '') + '</span>' +
                '<span class="ag-gf-lb">' + esc(r.label) + (r.note ? ' <span class="ag-gf-note">' + esc(r.note) + '</span>' : '') + '</span>' +
                '</div>';
        });
        h += '<div class="ag-gf-foot">Geometrie z drah TLE' + (model.tleAge != null ? ' (stáří ' + Math.round(model.tleAge) + ' h)' : '') +
            ', ionosféra z Kp indexu NOAA SWPC. Předpověď platí pro otevřený obzor — stínění stromy/budovami posoudí nástroj „Predikce signálu". ' +
            'Bouřková poznámka je bezpečnostní (výtyčka = hromosvod), s přesností GNSS nesouvisí.</div>';
        body.innerHTML = h;
    }
    function refresh(force) {
        var body = document.getElementById('ag-gf-body');
        if (body) body.innerHTML = '<div style="padding:14px;color:var(--text-muted,#9aa1ac);">Počítám dráhy družic…</div>';
        ensureTle(function () { ensureKp(function () { render(buildModel()); }); });
        if (force) toast('Aktualizuji TLE a Kp…');
    }
    function open() {
        var m = ensureModal();
        m.style.display = 'flex';
        refresh(false);
    }

    // ---- registrace dlaždice --------------------------------------------------------------
    var _regTries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'gnss-forecast', label: 'GNSS předpověď', icon: ICON, cat: 'Měření', onClick: open, order: 9 });
            return;
        }
        if (_regTries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.agOpenGnssForecast = open;
})();
