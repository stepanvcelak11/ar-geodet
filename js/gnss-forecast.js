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
// Výstup: GRAF průběhu kvality na 24 h dopředu + jedna věta se závěrem.
// Doplňuje „Skóre místa (GPS)" (teď a tady) a „Kdy se vrátit" v Brutálním GPS
// (jen minuty dopředu) — tohle je plán na celý den.
//
// PROČ GRAF (a ne emoji/semafor): geodet potřebuje z jednoho pohledu vidět, KDY
// se křivka zvedá a kdy padá, ne luštit 24 řádků. Graf je inline SVG kreslené
// JEDNOU při otevření — žádná knihovna (offline-first, CSP, service worker),
// žádná animační smyčka (baterie). Podrobná tabulka po hodinách zůstala, jen se
// schovala do rozbalovací sekce (je to zároveň „tabulková" varianta grafu pro
// případ, že by graf byl na displeji nečitelný).
//
// BARVY: pásma kvality jsou STAVOVÉ (dobré/hraniční/špatné), ne značkové — proto
// nejdou z var(--accent) (ten se v motivech mění na oranžovou/modrou a semafor by
// se rozsypal). Bereme --warning/--danger a jednu pevnou zelenou. Klasická trojice
// zelená/žlutá/červená ale NENÍ bezpečná pro barvoslepé (ΔE deutan 4,6 mezi
// #34d399 a #fb7185 — měřeno validátorem palety), takže:
//   1) hlavní nositel informace je POLOHA křivky na svislé ose, ne barva,
//   2) pás pod grafem kóduje verdikt i VÝŠKOU sloupku (vysoký = dobré),
//   3) špatné hodiny mají navíc ŠRAFU (45°) a červená je ztmavená na #c0405a,
//      aby dvojice prošla kontrolou odlišitelnosti,
//   4) u každého pásma je textový popisek (legenda) — barva nikdy nestojí sama.
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
    var PD_GOOD = 1.8, PD_MID = 2.8;           // prahy PDOP (stejné jako v rate())

    var _sats = null;      // [{satrec}] lokálně naparsované TLE (fallback)
    var _kp = null;        // [{t(ms UTC), kp, src}]
    var _kpStale = false;
    var _geo = null;       // geometrie posledního grafu (sdílí ji odečítací dotyk)
    var _model = null;     // poslední spočítaný model (pro odečítání v grafu)

    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:toast'); } }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function pad2(n) { return ('0' + n).slice(-2); }
    function num1(v) { return (v == null || !isFinite(v)) ? '–' : v.toFixed(1).replace('.', ','); }
    function r1(v) { return Math.round(v * 10) / 10; }

    // ---- poloha (GPS appky, fallback poslední známá) -------------------------------
    function pos() {
        try { if (typeof userLat === 'number' && userLat && typeof userLng === 'number') return { lat: userLat, lng: userLng, alt: (typeof userAlt === 'number' && isFinite(userAlt)) ? userAlt : 300 }; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:pos'); }
        try { var p = JSON.parse(localStorage.getItem('arLastPos')); if (p && p.lat) return { lat: +p.lat, lng: +(p.lng != null ? p.lng : p.lon), alt: 300 }; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:pos'); }
        return null;
    }

    // ---- TLE: preferuj data satelity.js, jinak vlastní parse téže cache ------------
    function parseTleText(txt) {
        var out = [], lines = String(txt || '').split(/\r?\n/), i;
        if (typeof satellite === 'undefined') return out;
        for (i = 0; i + 2 < lines.length; i++) {
            var l1 = lines[i + 1], l2 = lines[i + 2];
            if (lines[i] && l1 && l2 && l1.charAt(0) === '1' && l2.charAt(0) === '2') {
                try { out.push({ satrec: satellite.twoline2satrec(l1, l2) }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:parseTleText'); }
                i += 2;
            }
        }
        return out;
    }
    function getSats() {
        try { if (typeof tleSats !== 'undefined' && tleSats && tleSats.length) return tleSats; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:getSats'); }
        if (_sats && _sats.length) return _sats;
        try {
            var c = JSON.parse(localStorage.getItem(TLE_KEY));
            if (c && c.txt) _sats = parseTleText(c.txt);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:getSats'); }
        return _sats || [];
    }
    function tleAgeH() {
        try { if (typeof tleFetchedAt !== 'undefined' && tleFetchedAt) return (Date.now() - tleFetchedAt) / 36e5; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:tleAgeH'); }
        try { var c = JSON.parse(localStorage.getItem(TLE_KEY)); if (c && c.t) return (Date.now() - c.t) / 36e5; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:tleAgeH'); }
        return null;
    }
    function ensureTle(cb) {
        var age = tleAgeH();
        if (getSats().length && age != null && age < 72) { cb(); return; }
        // stáhnout (satelity.js refreshTLE když existuje, jinak vlastní fetch do téže cache)
        try {
            if (typeof refreshTLE === 'function') { Promise.resolve(refreshTLE(true)).then(cb, cb); return; }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:ensureTle'); }
        var ctrl = ('AbortController' in window) ? new AbortController() : null;
        var tm = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:ensureTle'); } }, 20000);
        fetch(TLE_URL_FALLBACK, ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.text(); }).then(function (txt) {
            clearTimeout(tm);
            var parsed = parseTleText(txt);
            if (parsed.length >= 10) {
                _sats = parsed;
                try { localStorage.setItem(TLE_KEY, JSON.stringify({ t: Date.now(), txt: txt })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:ensureTle'); }
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
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:ensureKp'); }
        var ctrl = ('AbortController' in window) ? new AbortController() : null;
        var tm = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:ensureKp'); } }, 9000);
        fetch(KP_URL, ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.json(); }).then(function (j) {
            clearTimeout(tm);
            var rows = parseKpRows(j);
            if (rows.length) {
                _kp = rows; _kpStale = false;
                try { localStorage.setItem(KP_KEY, JSON.stringify({ t: Date.now(), rows: rows })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:ensureKp'); }
            }
            cb();
        }).catch(function () {
            clearTimeout(tm);
            try { var c2 = JSON.parse(localStorage.getItem(KP_KEY)); if (c2 && c2.rows) { _kp = c2.rows; _kpStale = true; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:ensureKp'); }
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
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:satObsAt'); }
        }
        return out;
    }
    // PDOP (kopie geometrie ze satelity.js, ať modul stojí sám i bez něj)
    function pdopOf(obs) {
        try { if (typeof computePDOP === 'function') { var v = computePDOP(obs); return (v != null && isFinite(v)) ? v : null; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:pdopOf'); }
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
    // Bez emoji — bouřka se v grafu značí výstražným trojúhelníkem (tvar, ne obrázek).
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
                if (h.code != null && h.code >= 95) note = { kind: 'storm', txt: 'bouřka — s výtyčkou pryč z terénu' };
                else if ((h.prob != null && h.prob >= 60) || (h.precip != null && h.precip >= 1)) note = { kind: 'rain', txt: 'déšť' };
                if (note) map[Math.floor(h.t / 3600) * 3600] = note;
            });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:weatherNotes'); }
        return map;
    }

    // ---- hodnocení hodiny --------------------------------------------------------------
    function rate(pdop, nsat, kp) {
        if (pdop == null || nsat < 4) return { cls: 'na', label: 'nelze určit' };
        if (kp != null && kp >= 6) return { cls: 'bad', label: 'geomag. bouře' };
        if (kp != null && kp >= 5) return { cls: 'mid', label: 'zvýšená ionosféra' };
        if (pdop <= PD_GOOD && nsat >= 8) return { cls: 'good', label: 'výborné' };
        if (pdop <= PD_MID) return { cls: 'mid', label: 'dobré' };
        return { cls: 'bad', label: 'slabá geometrie' };
    }

    // nejdelší souvislý úsek, kde platí pred() — vrací {s, n} nebo null
    function longestRun(rows, pred) {
        var best = null, s = -1, j;
        for (j = 0; j <= rows.length; j++) {
            var ok = j < rows.length && pred(rows[j]);
            if (ok && s < 0) s = j;
            if ((!ok || j === rows.length) && s >= 0) {
                if (!best || j - s > best.n) best = { s: s, n: j - s };
                s = -1;
            }
        }
        return best;
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
        // nejlepší souvislé okno (good, případně good+mid) dlouhé aspoň 2 h
        function findWin(cls) {
            var b = longestRun(rows, function (r) { return r.cls === 'good' || (cls === 'mid' && r.cls === 'mid'); });
            return (b && b.n >= 2) ? b : null;
        }
        var win = findWin('good') || findWin('mid');
        var worst = longestRun(rows, function (r) { return r.cls === 'bad'; });
        if (worst && worst.n < 2) worst = null;
        return { rows: rows, win: win, worst: worst, kpNow: kpAt(Date.now()), tleAge: tleAgeH(), pos: p };
    }

    // ---- UI -----------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent =
            // stavové barvy (viz hlavička): NE z --accent, ten se v motivech mění
            '#ag-gf-modal{--gf-good:#34d399;--gf-mid:var(--warning,#fbbf24);--gf-bad:#c0405a;}' +
            '#ag-gf-modal .ag-gf-now{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 10px;}' +
            '#ag-gf-modal .ag-gf-stat{flex:1 1 90px;background:var(--surface-1,rgba(255,255,255,.06));border-radius:var(--r-sm,10px);padding:7px 10px;text-align:center;}' +
            '#ag-gf-modal .ag-gf-stat b{display:block;font-size:1.25em;}' +
            '#ag-gf-modal .ag-gf-stat small{color:var(--text-muted,#9aa1ac);}' +
            // graf
            '#ag-gf-modal .ag-gf-chart{background:var(--surface-1,rgba(255,255,255,.06));border:1px solid var(--glass-border,rgba(255,255,255,.10));border-radius:var(--r-md,12px);padding:8px 6px 4px;}' +
            '#ag-gf-modal .ag-gf-cap{color:var(--text-muted,#9aa1ac);font-size:.78em;margin:0 4px 4px;}' +
            '#ag-gf-modal .ag-gf-svg{display:block;width:100%;height:auto;touch-action:pan-y;}' +
            '#ag-gf-modal .ag-gf-svg text{font-family:var(--font-ui,sans-serif);}' +
            '#ag-gf-modal .gf-band-good{fill:var(--gf-good);opacity:.11;}' +
            '#ag-gf-modal .gf-band-mid{fill:var(--gf-mid);opacity:.09;}' +
            '#ag-gf-modal .gf-band-bad{fill:var(--gf-bad);opacity:.15;}' +
            '#ag-gf-modal .gf-grid{stroke:var(--glass-border,rgba(255,255,255,.14));stroke-width:1;}' +
            '#ag-gf-modal .gf-tick{fill:var(--text-muted,#9aa1ac);font-size:calc(10px * var(--ag-font-scale, 1));font-variant-numeric:tabular-nums;}' +
            '#ag-gf-modal .gf-line{fill:none;stroke:var(--text-color,#eceef2);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;}' +
            '#ag-gf-modal .gf-win{fill:var(--accent-bright,#3eb487);opacity:.12;}' +
            '#ag-gf-modal .gf-winrule{stroke:var(--accent-bright,#3eb487);stroke-width:3;stroke-linecap:round;}' +
            '#ag-gf-modal .gf-nowline{stroke:var(--accent-bright,#3eb487);stroke-width:1.5;}' +
            '#ag-gf-modal .gf-nowlb{fill:var(--accent-bright,#3eb487);font-size:calc(10px * var(--ag-font-scale, 1));font-weight:600;}' +
            '#ag-gf-modal .gf-lab{fill:var(--text-color,#eceef2);font-size:calc(10px * var(--ag-font-scale, 1));font-variant-numeric:tabular-nums;}' +
            '#ag-gf-modal .gf-c-good{fill:var(--gf-good);}' +
            '#ag-gf-modal .gf-c-mid{fill:var(--gf-mid);}' +
            '#ag-gf-modal .gf-c-bad{fill:url(#agGfHatch);}' +
            '#ag-gf-modal .gf-c-na{fill:none;stroke:var(--text-faint,#6b727d);stroke-width:1;}' +
            '#ag-gf-modal .gf-badbase{fill:var(--gf-bad);}' +
            '#ag-gf-modal .gf-hatchl{stroke:rgba(255,255,255,.55);stroke-width:2;}' +
            '#ag-gf-modal .gf-warn{fill:none;stroke:var(--gf-mid);stroke-width:1.4;stroke-linejoin:round;}' +
            '#ag-gf-modal .gf-cut{fill:var(--text-color,#eceef2);}' +
            '#ag-gf-modal .gf-probe{stroke:var(--text-color,#eceef2);stroke-width:1;opacity:.55;}' +
            '#ag-gf-modal .gf-probedot{fill:var(--text-color,#eceef2);stroke:var(--bg-elev,#171b20);stroke-width:2;}' +
            // legenda + odečet + závěr
            '#ag-gf-modal .ag-gf-leg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:.8em;color:var(--text-muted,#9aa1ac);margin:6px 4px 0;}' +
            '#ag-gf-modal .ag-gf-leg i{width:13px;height:13px;border-radius:3px;display:inline-block;vertical-align:-2px;margin-right:5px;}' +
            '#ag-gf-modal .ag-gf-leg .l-good{background:var(--gf-good);}' +
            '#ag-gf-modal .ag-gf-leg .l-mid{background:var(--gf-mid);}' +
            '#ag-gf-modal .ag-gf-leg .l-bad{background:repeating-linear-gradient(45deg,var(--gf-bad) 0 3px,rgba(255,255,255,.55) 3px 5px);}' +
            '#ag-gf-modal .ag-gf-leg .l-win{background:var(--accent-bright,#3eb487);height:4px;border-radius:2px;vertical-align:2px;}' +
            '#ag-gf-modal .ag-gf-read{margin:6px 4px 0;padding:6px 8px;background:var(--surface-2,rgba(255,255,255,.09));border-radius:var(--r-sm,9px);font-size:.9em;font-variant-numeric:tabular-nums;min-height:1.4em;}' +
            '#ag-gf-modal .ag-gf-win{display:flex;gap:8px;align-items:flex-start;background:var(--accent-soft,rgba(52,211,153,.12));border:1px solid var(--accent-line,rgba(52,211,153,.4));border-radius:var(--r-md,12px);padding:10px 12px;margin:10px 0 4px;font-size:.98em;line-height:1.35;}' +
            '#ag-gf-modal .ag-gf-win svg{width:20px;height:20px;flex:0 0 20px;margin-top:1px;color:var(--accent-bright,#3eb487);}' +
            '#ag-gf-modal .ag-gf-win.warn{background:rgba(251,191,36,.10);border-color:rgba(251,191,36,.40);}' +
            '#ag-gf-modal .ag-gf-win.warn svg{color:var(--warning,#fbbf24);}' +
            // podrobná tabulka (rozbalovací)
            '#ag-gf-modal .ag-gf-det{margin-top:10px;border-top:1px solid var(--glass-border,rgba(255,255,255,.10));}' +
            '#ag-gf-modal .ag-gf-det>summary{list-style:none;cursor:pointer;padding:12px 4px;color:var(--text-muted,#9aa1ac);font-size:.9em;}' +
            '#ag-gf-modal .ag-gf-det>summary::-webkit-details-marker{display:none;}' +
            '#ag-gf-modal .ag-gf-det>summary::after{content:" ▾";}' +
            '#ag-gf-modal .ag-gf-det[open]>summary::after{content:" ▴";}' +
            '#ag-gf-modal .ag-gf-row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:8px;font-size:.92em;}' +
            '#ag-gf-modal .ag-gf-row:nth-child(odd){background:rgba(255,255,255,.03);}' +
            '#ag-gf-modal .ag-gf-h{width:52px;font-variant-numeric:tabular-nums;color:var(--text-muted,#9aa1ac);}' +
            '#ag-gf-modal .ag-gf-dot{width:12px;height:12px;border-radius:50%;flex:0 0 12px;background:var(--text-faint,#6b727d);}' +
            '#ag-gf-modal .good .ag-gf-dot{background:var(--gf-good);} #ag-gf-modal .mid .ag-gf-dot{background:var(--gf-mid);} #ag-gf-modal .bad .ag-gf-dot{background:var(--gf-bad);}' +
            '#ag-gf-modal .ag-gf-v{width:88px;font-variant-numeric:tabular-nums;}' +
            '#ag-gf-modal .ag-gf-lb{flex:1;} #ag-gf-modal .ag-gf-note{color:var(--warning,#fbbf24);font-size:.88em;}' +
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
            try { localStorage.removeItem(KP_KEY); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-forecast:ensureModal'); }
            refresh(true);
        });
        return m;
    }
    function kpTxt(kp) {
        if (kp == null) return '–';
        var s = num1(kp);
        if (kp >= 6) return s + ' bouře';
        if (kp >= 5) return s + ' aktivní';
        if (kp >= 4) return s + ' neklidno';
        return s + ' klid';
    }

    // ---- GRAF (inline SVG, kreslí se jednou) ---------------------------------------
    // Svisle: PDOP obráceně (nahoře 1,0 = nejlepší geometrie) — „nahoru = líp".
    // Vodorovně: 24 hodin dopředu. Pás dole = konečný verdikt hodiny (výška sloupku
    // nese kvalitu i bez barvy). Prázdná hodina se NEDOKRESLUJE — čára se přeruší.
    function chartSvg(model) {
        var rows = model.rows, n = rows.length, i, x, y;
        var W = 340, H = 158, L = 34, R = 8, T = 20, PB = 104;   // plocha grafu
        var ST = 112, SB = 134, AX = 147;                        // pás verdiktů, popisky osy
        var iw = (W - L - R) / n;
        var vmaxData = 0, any = false;
        for (i = 0; i < n; i++) if (rows[i].pdop != null) { any = true; if (rows[i].pdop > vmaxData) vmaxData = rows[i].pdop; }
        if (!any) return null;
        // Strop osy je zaříznutý na 4,5: jedna špička PDOP 9 by jinak zmáčkla celé
        // pásmo 1–3 (kde se rozhoduje) do pár pixelů. Nad 4,5 je stejně všechno
        // nepoužitelné — uříznuté hodiny dostanou značku a přesné číslo v tabulce.
        var vmax = Math.min(4.5, Math.max(3.2, Math.ceil(vmaxData * 2) / 2));
        var clipped = vmaxData > vmax + 0.01;
        function xc(k) { return r1(L + iw * (k + 0.5)); }
        function xe(k) { return r1(L + iw * k); }
        function yv(v) { var c = Math.min(Math.max(v, 1), vmax); return r1(T + (PB - T) * (c - 1) / (vmax - 1)); }
        _geo = { W: W, L: L, R: R, T: T, PB: PB, ST: ST, SB: SB, iw: iw, n: n, vmax: vmax };

        var s = '<svg class="ag-gf-svg" id="ag-gf-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
            'aria-label="Graf předpovědi kvality GNSS na 24 hodin dopředu">' +
            '<title>Předpověď kvality GNSS na 24 hodin</title>' +
            '<defs><pattern id="agGfHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
            '<rect width="6" height="6" class="gf-badbase"/><line x1="0" y1="0" x2="0" y2="6" class="gf-hatchl"/></pattern></defs>';

        // pásma kvality (vodorovné pruhy) — pozadí, ne data
        var yG = yv(PD_GOOD), yM = yv(PD_MID), PW = r1(W - L - R);
        s += '<rect x="' + L + '" y="' + T + '" width="' + PW + '" height="' + r1(yG - T) + '" class="gf-band-good"/>';
        s += '<rect x="' + L + '" y="' + yG + '" width="' + PW + '" height="' + r1(yM - yG) + '" class="gf-band-mid"/>';
        s += '<rect x="' + L + '" y="' + yM + '" width="' + PW + '" height="' + r1(PB - yM) + '" class="gf-band-bad"/>';

        // nejlepší okno — svislý pruh přes celý graf + silná linka nahoře
        if (model.win) {
            var wx = xe(model.win.s), ww = r1(iw * model.win.n);
            s += '<rect x="' + wx + '" y="' + T + '" width="' + ww + '" height="' + r1(PB - T) + '" class="gf-win"/>';
            s += '<line x1="' + r1(wx + 1.5) + '" y1="5" x2="' + r1(wx + ww - 1.5) + '" y2="5" class="gf-winrule"/>';   // 5 = nad popiskem „teď" (baseline 15)
        }

        // vodorovné hairline u prahů + popisky svislé osy
        s += '<line x1="' + L + '" y1="' + yG + '" x2="' + r1(W - R) + '" y2="' + yG + '" class="gf-grid"/>';
        s += '<line x1="' + L + '" y1="' + yM + '" x2="' + r1(W - R) + '" y2="' + yM + '" class="gf-grid"/>';
        s += '<line x1="' + L + '" y1="' + PB + '" x2="' + r1(W - R) + '" y2="' + PB + '" class="gf-grid"/>';
        var ticks = [[T + 4, '1,0'], [yG + 3.5, num1(PD_GOOD)], [yM + 3.5, num1(PD_MID)]];
        if (PB - yM > 16) ticks.push([PB, num1(vmax)]);
        for (i = 0; i < ticks.length; i++) s += '<text class="gf-tick" x="' + (L - 5) + '" y="' + r1(ticks[i][0]) + '" text-anchor="end">' + ticks[i][1] + '</text>';

        // předěl dne + popisky hodin
        for (i = 0; i < n; i++) {
            var hh = rows[i].t.getHours();
            if (hh === 0 && i > 0) {
                s += '<line x1="' + xe(i) + '" y1="' + T + '" x2="' + xe(i) + '" y2="' + SB + '" class="gf-grid"/>';
                s += '<text class="gf-tick" x="' + r1(xe(i) + 3) + '" y="' + (T + 9) + '">zítra</text>';
            }
            if (hh % 3 === 0) s += '<text class="gf-tick" x="' + xc(i) + '" y="' + AX + '" text-anchor="middle">' + pad2(hh) + '</text>';
        }

        // křivka PDOP — přerušená tam, kde data nejsou
        var d = '', open = false, minI = -1, cut = '';
        for (i = 0; i < n; i++) {
            if (rows[i].pdop == null) { open = false; continue; }
            x = xc(i); y = yv(rows[i].pdop);
            d += (open ? 'L' : 'M') + x + ' ' + y + ' ';
            open = true;
            if (minI < 0 || rows[i].pdop < rows[minI].pdop) minI = i;
            // hodina mimo stupnici — trojúhelníček dolů, ať se křivka u dna nečte jako naměřená hodnota
            if (rows[i].pdop > vmax + 0.01) cut += '<path class="gf-cut" d="M' + r1(x - 3) + ' ' + (PB - 7) + 'L' + r1(x + 3) + ' ' + (PB - 7) + 'L' + x + ' ' + (PB - 2) + 'Z"/>';
        }
        if (d) s += '<path class="gf-line" d="' + d.trim() + '"/>';
        s += cut;

        // jediný přímý popisek: nejlepší (nejnižší) PDOP dne
        if (minI >= 0) {
            var lx = Math.min(Math.max(xc(minI), L + 12), W - R - 12), ly = Math.max(yv(rows[minI].pdop) - 6, T + 4);   // T+4 = pod popiskem „teď", ne přes něj
            s += '<text class="gf-lab" x="' + r1(lx) + '" y="' + r1(ly) + '" text-anchor="middle">' + num1(rows[minI].pdop) + '</text>';
        }

        // pás verdiktů: výška sloupku = kvalita (dobré vysoké, špatné nízké + šrafa)
        var bw = Math.max(4, iw - 2.6);
        for (i = 0; i < n; i++) {
            var cls = rows[i].cls, hgt = cls === 'good' ? 22 : (cls === 'mid' ? 14 : (cls === 'bad' ? 7 : 4));
            var bx = r1(xe(i) + (iw - bw) / 2), by = r1(SB - hgt);
            var cc = cls === 'good' ? 'gf-c-good' : (cls === 'mid' ? 'gf-c-mid' : (cls === 'bad' ? 'gf-c-bad' : 'gf-c-na'));
            s += '<rect x="' + bx + '" y="' + by + '" width="' + r1(bw) + '" height="' + hgt + '" rx="2.5" class="' + cc + '"/>';
            if (rows[i].note && rows[i].note.kind === 'storm') {
                var tx = xc(i);
                s += '<path class="gf-warn" d="M' + r1(tx - 3.5) + ' ' + (ST - 1) + 'L' + r1(tx) + ' ' + (ST - 7) + 'L' + r1(tx + 3.5) + ' ' + (ST - 1) + 'Z"/>';
            }
        }

        // „teď" (uvnitř první hodiny) + odečítací kurzor
        var frac = Math.min(Math.max((Date.now() - rows[0].t.getTime()) / 3600000, 0), 1);
        var nx = r1(L + iw * frac);
        s += '<line x1="' + nx + '" y1="' + (T - 3) + '" x2="' + nx + '" y2="' + SB + '" class="gf-nowline"/>';
        s += '<text class="gf-nowlb" x="' + r1(nx + 3) + '" y="' + (T - 5) + '">teď</text>';
        s += '<line id="ag-gf-probe" x1="' + nx + '" y1="' + T + '" x2="' + nx + '" y2="' + PB + '" class="gf-probe"/>';
        s += '<circle id="ag-gf-probedot" cx="' + nx + '" cy="' + (rows[0].pdop != null ? yv(rows[0].pdop) : -20) + '" r="4" class="gf-probedot"/>';
        s += '</svg>';
        return { svg: s, clipped: clipped, vmax: vmax };
    }

    // odečítání hodnot prstem — jen dotykové posluchače, žádná smyčka
    function attachProbe() {
        var svg = document.getElementById('ag-gf-svg');
        if (!svg || !_geo || !_model) return;
        var line = document.getElementById('ag-gf-probe'), dot = document.getElementById('ag-gf-probedot');
        var out = document.getElementById('ag-gf-read');
        function yv(v) { var c = Math.min(Math.max(v, 1), _geo.vmax); return _geo.T + (_geo.PB - _geo.T) * (c - 1) / (_geo.vmax - 1); }
        function show(k) {
            var r = _model.rows[k];
            if (!r) return;
            var x = _geo.L + _geo.iw * (k + 0.5);
            if (line) { line.setAttribute('x1', x); line.setAttribute('x2', x); }
            if (dot) { dot.setAttribute('cx', x); dot.setAttribute('cy', r.pdop != null ? yv(r.pdop) : -20); }
            if (out) out.innerHTML = '<b>' + pad2(r.t.getHours()) + ':00</b> · PDOP ' + num1(r.pdop) +
                ' · ' + (r.nsat || 0) + ' družic · ' + esc(r.label) +
                (r.kp != null && r.kp >= 5 ? ' · Kp ' + num1(r.kp) : '') +
                (r.note ? ' · ' + esc(r.note.txt) : '');
        }
        function fromEvt(e) {
            var b = svg.getBoundingClientRect();
            if (!b.width) return;
            var px = (e.clientX - b.left) * (_geo.W / b.width);
            var k = Math.floor((px - _geo.L) / _geo.iw);
            show(Math.min(_geo.n - 1, Math.max(0, k)));
        }
        svg.addEventListener('pointerdown', function (e) { try { svg.setPointerCapture(e.pointerId); } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'gnss-forecast:fromEvt'); } fromEvt(e); });
        svg.addEventListener('pointermove', function (e) { if (e.buttons || e.pressure > 0) fromEvt(e); });
        show(0);
    }

    // ---- závěr jednou větou ---------------------------------------------------------
    function rangeTxt(rows, w) {
        var a = rows[w.s].t, b = new Date(rows[w.s + w.n - 1].t.getTime() + 3600 * 1000);
        var zitra = a.getDate() !== new Date().getDate();
        return pad2(a.getHours()) + ':00–' + pad2(b.getHours()) + ':00' + (zitra ? ' (zítra)' : '');
    }
    function conclusion(model) {
        var rows = model.rows, win = model.win, bad = model.worst, i, storm = false, reason = 'slabá geometrie';
        if (bad) {
            for (i = bad.s; i < bad.s + bad.n; i++) if (rows[i].kp != null && rows[i].kp >= 6) storm = true;
            reason = storm ? 'geomagnetická bouře' : 'PDOP nad ' + num1(PD_MID);
        }
        if (win && bad) return { ok: true, txt: 'Měř ' + rangeTxt(rows, win) + ', mezi ' + rangeTxt(rows, bad) + ' to nemá cenu (' + reason + ').' };
        if (win) return { ok: true, txt: 'Měř ' + rangeTxt(rows, win) + '; vyloženě špatná hodina v příštích 24 h není.' };
        if (bad) return { ok: false, txt: 'Souvislé dobré okno se v příštích 24 h nenašlo, nejhorší je ' + rangeTxt(rows, bad) + ' (' + reason + ') — jinde měř s rezervou.' };
        return { ok: false, txt: 'Podmínky jsou v příštích 24 h vyrovnané — žádné výrazně lepší ani horší okno.' };
    }

    var IC_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    var IC_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17.5v.01"/></svg>';

    function render(model) {
        var body = document.getElementById('ag-gf-body');
        if (!body) return;
        _model = null; _geo = null;
        if (model.err) { body.innerHTML = '<div style="padding:14px;color:var(--text-muted,#9aa1ac);">' + esc(model.err) + '</div>'; return; }
        _model = model;
        var r0 = model.rows[0];
        var h = '<div class="ag-gf-now">' +
            '<div class="ag-gf-stat"><small>PDOP teď</small><b>' + num1(r0.pdop) + '</b></div>' +
            '<div class="ag-gf-stat"><small>Družic ≥' + EL_MASK + '°</small><b>' + (r0.nsat || '–') + '</b></div>' +
            '<div class="ag-gf-stat"><small>Kp index' + (_kpStale ? ' (offline)' : '') + '</small><b>' + esc(kpTxt(model.kpNow)) + '</b></div>' +
            '</div>';

        var ch = chartSvg(model);
        if (ch) {
            h += '<div class="ag-gf-chart">' +
                '<div class="ag-gf-cap">Kvalita geometrie po hodinách — nahoře lepší (čísla vlevo = PDOP). Ťukni do grafu pro hodnoty.</div>' +
                ch.svg +
                '<div class="ag-gf-leg">' +
                '<span><i class="l-good"></i>výborné (PDOP ≤ ' + num1(PD_GOOD) + ')</span>' +
                '<span><i class="l-mid"></i>dobré (≤ ' + num1(PD_MID) + ')</span>' +
                '<span><i class="l-bad"></i>slabé (šrafa)</span>' +
                '<span><i class="l-win"></i>nejlepší okno</span>' +
                '</div>' +
                '<div class="ag-gf-read" id="ag-gf-read"></div>' +
                '</div>';
        } else {
            h += '<div class="ag-gf-chart" style="padding:16px;color:var(--text-muted,#9aa1ac);">' +
                'Pro graf nemám ani jednu spočítanou hodinu (málo družic nad maskou ' + EL_MASK + '°). ' +
                'Křivku si nevymýšlím — zkus to znovu po aktualizaci drah.</div>';
        }

        var c = conclusion(model);
        h += '<div class="ag-gf-win' + (c.ok ? '' : ' warn') + '">' + (c.ok ? IC_OK : IC_WARN) + '<div>' + esc(c.txt) + '</div></div>';

        // podrobnosti = tabulková varianta grafu (schované, ať panel nezabírá půl dne)
        h += '<details class="ag-gf-det"><summary>Podrobně po hodinách (' + model.rows.length + ' h)</summary>';
        model.rows.forEach(function (r) {
            if (r.t.getHours() === 0) h += '<div style="margin:8px 0 2px;color:var(--text-muted,#9aa1ac);font-size:.85em;">— ' + r.t.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric' }) + ' —</div>';
            h += '<div class="ag-gf-row ' + r.cls + '">' +
                '<span class="ag-gf-h">' + pad2(r.t.getHours()) + ':00</span>' +
                '<span class="ag-gf-dot"></span>' +
                '<span class="ag-gf-v">PDOP ' + num1(r.pdop) + '</span>' +
                '<span class="ag-gf-v">' + r.nsat + ' druž.' + (r.kp != null && r.kp >= 5 ? ' · Kp' + Math.round(r.kp) : '') + '</span>' +
                '<span class="ag-gf-lb">' + esc(r.label) + (r.note ? ' <span class="ag-gf-note">' + esc(r.note.txt) + '</span>' : '') + '</span>' +
                '</div>';
        });
        h += '</details>';

        h += '<div class="ag-gf-foot">Geometrie z drah TLE' + (model.tleAge != null ? ' (stáří ' + Math.round(model.tleAge) + ' h)' : '') +
            ', ionosféra z Kp indexu NOAA SWPC. ' + (ch && ch.clipped ? 'Špičky nad PDOP ' + num1(ch.vmax) + ' jsou v grafu uříznuté (přesná čísla v podrobnostech). ' : '') +
            'Předpověď platí pro otevřený obzor — stínění stromy/budovami posoudí nástroj „Predikce signálu". ' +
            'Bouřková značka je bezpečnostní (výtyčka = hromosvod), s přesností GNSS nesouvisí.</div>';
        body.innerHTML = h;
        attachProbe();
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
