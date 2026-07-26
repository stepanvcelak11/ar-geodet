// ===== AR Geodet — RANNÍ BRÍFINK „DNEŠEK V TERÉNU" (ODPOJITELNÁ vrstva) =========
// Jedna karta při prvním spuštění dne: co geodeta ten den čeká, bez klikání po
// čtyřech nástrojích. Obsah (co v zařízení/na síti není, sekce prostě vynechá):
//   • POČASÍ DNES na aktuální poloze (vlastní lehké volání Open-Meteo: teploty,
//     srážky vč. hodin kdy pršet má, vítr/nárazy, východ–západ slunce a kolik
//     zbývá světla). Offline ukáže poslední stažený brífink se štítkem.
//   • GNSS DNES: z uložených drah družic (tleSats + computeSatPositions/computePDOP
//     z js/satelity.js) spočítá PDOP po hodinách 6–20 h → nejlepší 2h okno a
//     nejhorší hodina. K tomu Kp index (NOAA SWPC) — ionosférická aktivita;
//     Kp ≥ 5 = geomagnetická bouře, GNSS ten den může zlobit.
//   • MONITORING: body po termínu přeměření (čte klíče modulu epochy-pripominky
//     'agEpochyRemind::<pid>' + data 'agEpochy_v1') s tlačítkem Otevřít.
//   • ZPRAVODAJ: titulek dnešního vydání (data/zpravodaj.json, drží ho SW cache).
// Automaticky se otevře jen JEDNOU denně po startu appky (body.app-started,
// klíč 'agBrifinkLastShown'); vypnutí přepínačem dole v kartě ('agBrifinkAuto').
// Ručně kdykoli: dlaždice „Dnešek v terénu" (Nástroje → Pomůcky) nebo
// window.agOpenBrifink().
//
// NEEDITUJE logika.js ani grafika.js — čte jen globály (userLat/userLng,
// currentGpsAccuracy, tleSats…) přes typeof, vše fail-silent.
// Odstranění: smaž js/brifink.js + řádek <script> v index.html (a přegeneruj
// sw.js: scripts/gen_sw_assets.py --bump). Appka funguje beze změny.
// ================================================================================
(function () {
    'use strict';
    if (window.__agBrifinkInit) return;
    window.__agBrifinkInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    var STYLE_ID = 'ag-bf-style';
    var KEY_LAST = 'agBrifinkLastShown';   // 'RRRR-MM-DD' — kdy se naposledy ukázal sám
    var KEY_AUTO = 'agBrifinkAuto';        // '0' = automaticky neukazovat (default zapnuto)
    var KEY_WX = 'agBrifinkWx_v1';         // cache počasí { t, lat, lng, data }
    var KEY_KP = 'agBrifinkKp_v1';         // cache Kp { t, rows }
    var WX_MAX_AGE = 30 * 60000;           // počasí znovu stahovat po 30 min
    var KP_MAX_AGE = 3 * 3600000;          // Kp po 3 h

    // ---- pomocné -------------------------------------------------------------
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    var DAYS_CS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
    function fmtDay(d) { return DAYS_CS[d.getDay()] + ' ' + d.getDate() + '. ' + (d.getMonth() + 1) + '.'; }
    function fmtHM(iso) { var m = /T(\d{2}):(\d{2})/.exec(String(iso || '')); return m ? m[1] + ':' + m[2] : ''; }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function projName() {
        var id = pid();
        try {
            if (typeof projects !== 'undefined' && Array.isArray(projects)) {
                for (var i = 0; i < projects.length; i++) { if (projects[i] && projects[i].id === id) return projects[i].name || id; }
            }
        } catch (e) {}
        return (id === 'default') ? 'Výchozí zakázka' : id;
    }
    function pos() {
        try { if (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null) return { lat: userLat, lng: userLng, live: true }; } catch (e) {}
        try { var p = JSON.parse(localStorage.getItem('arLastPos')); if (p && p.lat != null) return { lat: p.lat, lng: p.lng, live: false }; } catch (e2) {}
        return null;
    }
    // fetch s časovým limitem (bez AbortController — starší Safari)
    function fetchT(url, ms) {
        return Promise.race([
            fetch(url, { cache: 'no-store' }),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })
        ]);
    }
    function wmoTxt(c) {
        if (c == null) return null;
        if (c === 0) return 'jasno';
        if (c <= 2) return 'polojasno';
        if (c === 3) return 'zataženo';
        if (c === 45 || c === 48) return 'mlha';
        if (c <= 57) return 'mrholení';
        if (c <= 67) return 'déšť';
        if (c <= 77) return 'sněžení';
        if (c <= 82) return 'přeháňky';
        if (c <= 86) return 'sněhové přeháňky';
        return 'bouřka';
    }

    // ---- POČASÍ ---------------------------------------------------------------
    function loadWxCache() { try { return JSON.parse(localStorage.getItem(KEY_WX)); } catch (e) { return null; } }
    function getWeather() {
        var p = pos();
        var c = loadWxCache();
        // cache platí, když je čerstvá, ze stejného dne a poloha se moc nehnula (~5 km)
        var cacheOk = c && c.data && (Date.now() - c.t < WX_MAX_AGE) && c.day === todayStr()
            && (!p || (Math.abs(c.lat - p.lat) < 0.05 && Math.abs(c.lng - p.lng) < 0.07));
        if (cacheOk) return Promise.resolve({ w: c.data, stale: false });
        if (!p) return Promise.resolve(c && c.data ? { w: c.data, stale: true, when: c.t } : null);
        var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.lat.toFixed(4) + '&longitude=' + p.lng.toFixed(4)
            + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset'
            + '&hourly=precipitation&forecast_days=1&timezone=auto&wind_speed_unit=ms';
        return fetchT(url, 8000).then(function (r) { return r.json(); }).then(function (j) {
            if (!j || !j.daily) throw new Error('bad');
            try { localStorage.setItem(KEY_WX, JSON.stringify({ t: Date.now(), day: todayStr(), lat: p.lat, lng: p.lng, data: j })); } catch (e) {}
            return { w: j, stale: false };
        })['catch'](function () {
            var c2 = loadWxCache();
            return c2 && c2.data ? { w: c2.data, stale: true, when: c2.t } : null;
        });
    }
    // souvislé úseky hodin se srážkami > 0,15 mm → "13–16 h"
    function rainSpans(hourly) {
        if (!hourly || !Array.isArray(hourly.precipitation)) return [];
        var v = hourly.precipitation, spans = [], from = null;
        for (var h = 0; h <= v.length && h < 25; h++) {
            var wet = h < v.length && v[h] != null && v[h] > 0.15;
            if (wet && from == null) from = h;
            if (!wet && from != null) { spans.push(from + '–' + h + ' h'); from = null; }
        }
        return spans;
    }
    function wxRows(res) {
        var w = res.w, d = w.daily, rows = [];
        var line1 = [];
        if (Array.isArray(d.weather_code)) { var t = wmoTxt(d.weather_code[0]); if (t) line1.push(t); }
        if (d.temperature_2m_min && d.temperature_2m_max) line1.push(Math.round(d.temperature_2m_min[0]) + ' až ' + Math.round(d.temperature_2m_max[0]) + ' °C');
        if (d.wind_speed_10m_max) line1.push('vítr do ' + Math.round(d.wind_speed_10m_max[0]) + (d.wind_gusts_10m_max ? ' (nárazy ' + Math.round(d.wind_gusts_10m_max[0]) + ')' : '') + ' m/s');
        if (line1.length) rows.push(line1.join(' · '));
        var sum = d.precipitation_sum ? d.precipitation_sum[0] : null;
        var prob = d.precipitation_probability_max ? d.precipitation_probability_max[0] : null;
        if (sum != null && sum > 0.1) {
            var sp = rainSpans(w.hourly);
            rows.push('Srážky ' + String(sum.toFixed(1)).replace('.', ',') + ' mm' + (prob != null ? ' (pravděpodobnost ' + Math.round(prob) + ' %)' : '') + (sp.length ? ' — déšť ' + sp.join(', ') : ''));
        } else {
            rows.push('Bez výraznějších srážek' + (prob != null && prob > 30 ? ' (pravděpodobnost do ' + Math.round(prob) + ' %)' : '') + '.');
        }
        if (d.sunrise && d.sunset) {
            var sr = fmtHM(d.sunrise[0]), ss = fmtHM(d.sunset[0]);
            var light = '';
            try {
                var mSet = /T(\d{2}):(\d{2})/.exec(d.sunset[0]);
                if (mSet) {
                    var now = new Date();
                    var mins = (parseInt(mSet[1], 10) * 60 + parseInt(mSet[2], 10)) - (now.getHours() * 60 + now.getMinutes());
                    if (mins > 0) light = ' — světla zbývá ' + Math.floor(mins / 60) + ':' + pad2(mins % 60) + ' h';
                }
            } catch (e) {}
            rows.push('Slunce ' + sr + '–' + ss + light);
        }
        if (res.stale) rows.push('(offline — poslední stažená předpověď' + (res.when ? ' z ' + new Date(res.when).toLocaleString('cs-CZ') : '') + ')');
        return rows;
    }

    // ---- GNSS: okna dne z PDOP + Kp --------------------------------------------
    function pdopByHour() {
        try {
            if (typeof computeSatPositions !== 'function' || typeof computePDOP !== 'function') return null;
            if (typeof tleSats === 'undefined' || !tleSats.length) {
                try { if (typeof loadTleFromCache === 'function') loadTleFromCache(); } catch (e0) {}
            }
            if (typeof tleSats === 'undefined' || !tleSats.length) return { noTle: true };
            if (typeof userLat === 'undefined' || userLat == null) return { noPos: true };
            var base = new Date(); base.setHours(0, 0, 0, 0);
            var out = [];
            for (var h = 6; h <= 20; h++) {
                var pd = computePDOP(computeSatPositions(new Date(base.getTime() + h * 3600000)));
                out.push({ h: h, pdop: pd });
            }
            return { hours: out };
        } catch (e) { return null; }
    }
    function gnssRows(done) {
        var rows = [];
        var r = pdopByHour();
        if (!r) { done(null); return; }
        if (r.noTle) rows.push('Bez uložených drah družic — otevři GNSS satelity a stáhni TLE, pak umím poradit okna dne.');
        else if (r.noPos) rows.push('Čekám na polohu GPS — okna dne spočítám po prvním fixu.');
        else {
            // nejlepší souvislé 2h okno (průměr) a nejhorší hodina
            var hs = r.hours.filter(function (x) { return x.pdop != null; });
            if (hs.length >= 3) {
                var best = null, worst = null;
                for (var i = 0; i + 1 < r.hours.length; i++) {
                    var a = r.hours[i], b = r.hours[i + 1];
                    if (a.pdop == null || b.pdop == null) continue;
                    var avg = (a.pdop + b.pdop) / 2;
                    if (!best || avg < best.v) best = { from: a.h, to: b.h + 1, v: avg };
                }
                hs.forEach(function (x) { if (!worst || x.pdop > worst.pdop) worst = x; });
                if (best) rows.push('Nejlepší okno pro GNSS: ' + best.from + '–' + best.to + ' h (PDOP ≈ ' + best.v.toFixed(1).replace('.', ',') + ')');
                if (worst && best && (worst.h < best.from || worst.h >= best.to)) rows.push('Nejslabší geometrie: kolem ' + worst.h + ' h (PDOP ≈ ' + worst.pdop.toFixed(1).replace('.', ',') + ')');
            } else rows.push('Geometrii družic se nepodařilo spočítat.');
        }
        // Kp index (ionosféra) — jen doplněk, offline se prostě vynechá
        getKp().then(function (kp) {
            if (kp != null) {
                var lbl = kp >= 5 ? '⚠ geomagnetická bouře — GNSS dnes může zlobit, přesné měření radši ověř dvakrát'
                    : (kp >= 4 ? 'zvýšená aktivita — na milimetry dnes nespoléhej' : 'ionosféra v klidu');
                rows.push('Kp index dnes do ' + String(kp).replace('.', ',') + ' — ' + lbl);
            }
            done(rows);
        });
    }
    function getKp() {
        var c = null;
        try { c = JSON.parse(localStorage.getItem(KEY_KP)); } catch (e) {}
        if (c && (Date.now() - c.t < KP_MAX_AGE)) return Promise.resolve(c.kp);
        return fetchT('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', 6000)
            .then(function (r) { return r.json(); })
            .then(function (j) {
                // řádky ["time_tag","kp","observed","noaa_scale"], časy UTC po 3 h
                if (!Array.isArray(j) || j.length < 2) throw new Error('bad');
                var today = todayStr(), max = null;
                for (var i = 1; i < j.length; i++) {
                    var row = j[i];
                    if (!row || String(row[0]).slice(0, 10) !== today) continue;
                    var v = parseFloat(row[1]);
                    if (!isNaN(v) && (max == null || v > max)) max = v;
                }
                if (max != null) { try { localStorage.setItem(KEY_KP, JSON.stringify({ t: Date.now(), kp: max })); } catch (e2) {} }
                return max;
            })['catch'](function () { return c ? c.kp : null; });
    }

    // ---- MONITORING (po termínu přeměření) --------------------------------------
    function monitoringRows() {
        try {
            if (typeof window.getStoredData !== 'function') return null;
            var raw = window.getStoredData('agEpochy_v1');
            var ep = raw ? JSON.parse(raw) : null;
            if (!ep || !Array.isArray(ep.items) || !ep.items.length) return null;
            var r = null;
            try { r = JSON.parse(localStorage.getItem('agEpochyRemind::' + pid())); } catch (e0) {}
            if (!r || !r.pts) return null;
            var od = [];
            ep.items.forEach(function (it) {
                var cfg = it && r.pts[it.id];
                if (!cfg || !(cfg.days > 0) || !it.epochs || !it.epochs.length) return;
                var due = it.epochs[it.epochs.length - 1].t + cfg.days * 86400000;
                if (Date.now() > due) od.push(it.name || it.id);
            });
            if (!od.length) return null;
            var names = od.slice(0, 3).join(', ') + (od.length > 3 ? ' +' + (od.length - 3) : '');
            return [od.length + ' ' + (od.length === 1 ? 'bod je' : (od.length <= 4 ? 'body jsou' : 'bodů je')) + ' po termínu přeměření: ' + names];
        } catch (e) { return null; }
    }

    // ---- ZPRAVODAJ ---------------------------------------------------------------
    function getZpravodaj() {
        return fetchT('data/zpravodaj.json', 5000).then(function (r) { return r.json(); }).then(function (j) {
            if (!j || !Array.isArray(j.polozky) || !j.polozky.length) return null;
            var top = null;
            for (var i = 0; i < j.polozky.length; i++) { if (j.polozky[i] && j.polozky[i].top) { top = j.polozky[i]; break; } }
            if (!top) top = j.polozky[0];
            return { vydani: j.vydani, rubrika: top.rubrika, nadpis: top.nadpis };
        })['catch'](function () { return null; });
    }

    // ---- styly ---------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-bf-modal .modal-content{display:flex;flex-direction:column;}',
            '#ag-bf-body{flex:1;overflow-y:auto;min-height:0;}',
            '#ag-bf-modal .ag-bf-hi{font:700 20px/1.3 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);margin:0 0 2px;}',
            '#ag-bf-modal .ag-bf-sub{font:500 13px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:0 0 12px;}',
            '#ag-bf-modal .ag-bf-sec{background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  border-radius:14px;padding:12px 14px;margin-bottom:10px;}',
            '#ag-bf-modal .ag-bf-sec h4{margin:0 0 6px;font:700 14px/1.3 var(--font-ui,system-ui);color:var(--accent,#2f9e74);display:flex;align-items:center;gap:8px;}',
            '#ag-bf-modal .ag-bf-sec h4 svg{width:16px;height:16px;flex:none;}',
            '#ag-bf-modal .ag-bf-sec .row{font:500 13.5px/1.55 var(--font-ui,system-ui);color:var(--text-muted,#c3c9d2);word-break:break-word;}',
            '#ag-bf-modal .ag-bf-sec .row b{color:var(--text-color,#e6e8eb);}',
            '#ag-bf-modal .ag-bf-sec .mini{padding:6px 12px;margin-top:8px;font:600 12.5px/1 var(--font-ui,system-ui);border-radius:99px;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.4));background:transparent;color:var(--accent,#2f9e74);cursor:pointer;}',
            '#ag-bf-modal .ag-bf-auto{display:flex;align-items:center;gap:8px;font:500 12.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:8px 0 0;}',
            '#ag-bf-modal .ag-bf-foot{display:flex;gap:8px;margin-top:12px;}',
            '#ag-bf-modal .ag-bf-foot .btn{flex:1;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- modal -----------------------------------------------------------------------
    function greet() {
        var h = new Date().getHours();
        var g = h < 4 ? 'Dobrou noc' : (h < 10 ? 'Dobré ráno' : (h < 18 ? 'Dobrý den' : 'Dobrý večer'));
        try {
            var u = window.AGUcty, cu = u && u.currentUser && u.currentUser();
            if (cu && cu.name) g += ', ' + cu.name.split(' ')[0];
        } catch (e) {}
        return g;
    }
    function secHtml(id, title, rows, btn) {
        var h = '<div class="ag-bf-sec" id="' + id + '"><h4>' + title + '</h4>';
        if (rows === 'wait') h += '<div class="row">Načítám…</div>';
        else if (rows && rows.length) rows.forEach(function (r) { h += '<div class="row">' + r + '</div>'; });
        if (btn) h += btn;
        h += '</div>';
        return h;
    }
    function fillSec(id, rows, btn) {
        var el = document.getElementById(id);
        if (!el) return;
        if (!rows || !rows.length) { el.style.display = 'none'; return; }
        var h4 = el.querySelector('h4') ? el.querySelector('h4').outerHTML : '';
        el.innerHTML = h4 + rows.map(function (r) { return '<div class="row">' + r + '</div>'; }).join('') + (btn || '');
        bindMini(el);
    }
    function bindMini(scope) {
        var btns = (scope || document).querySelectorAll('#ag-bf-modal .mini[data-open]');
        for (var i = 0; i < btns.length; i++) {
            btns[i].onclick = function () {
                var fn = this.getAttribute('data-open');
                try { if (typeof window[fn] === 'function') { closeModal(); window[fn](); } } catch (e) {}
            };
        }
    }
    function closeModal() { var m = document.getElementById('ag-bf-modal'); if (m) m.style.display = 'none'; }

    function open() {
        injectStyles();
        var m = document.getElementById('ag-bf-modal');
        if (!m) {
            m = document.createElement('div');
            m.className = 'modal-overlay';
            m.id = 'ag-bf-modal';
            document.body.appendChild(m);
        }
        var d = new Date();
        var auto = (function () { try { return localStorage.getItem(KEY_AUTO) !== '0'; } catch (e) { return true; } })();
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Dnešek v terénu</h3>' +
            '  <div id="ag-bf-body">' +
            '    <p class="ag-bf-hi">' + esc(greet()) + '</p>' +
            '    <p class="ag-bf-sub">' + esc(fmtDay(d)) + ' · zakázka <b>' + esc(projName()) + '</b></p>' +
            secHtml('ag-bf-wx', 'Počasí dnes', 'wait') +
            secHtml('ag-bf-gnss', 'GNSS dnes', 'wait') +
            secHtml('ag-bf-mon', 'Monitoring', 'wait') +
            secHtml('ag-bf-news', 'Zpravodaj', 'wait') +
            '    <label class="ag-bf-auto"><input type="checkbox" id="ag-bf-autochk"' + (auto ? ' checked' : '') + '> Ukazovat automaticky při prvním spuštění dne</label>' +
            '  </div>' +
            '  <div class="ag-bf-foot">' +
            '    <button type="button" class="btn btn-secondary" id="ag-bf-wxbtn">Počasí podrobně</button>' +
            '    <button type="button" class="btn btn-primary" id="ag-bf-close">Jdu na to</button>' +
            '  </div>' +
            '</div>';
        m.style.display = 'flex';
        m.querySelector('#ag-bf-close').addEventListener('click', closeModal);
        var wxb = m.querySelector('#ag-bf-wxbtn');
        if (typeof window.agOpenPocasi === 'function') wxb.addEventListener('click', function () { closeModal(); window.agOpenPocasi(); });
        else wxb.style.display = 'none';
        m.querySelector('#ag-bf-autochk').addEventListener('change', function () {
            try { localStorage.setItem(KEY_AUTO, this.checked ? '1' : '0'); } catch (e) {}
        });

        // sekce se plní nezávisle — co selže, zmizí
        getWeather().then(function (res) { fillSec('ag-bf-wx', res ? wxRows(res).map(esc) : null); });
        gnssRows(function (rows) { fillSec('ag-bf-gnss', rows ? rows.map(esc) : null); });
        var mon = monitoringRows();
        fillSec('ag-bf-mon', mon ? mon.map(esc) : null,
            mon && typeof window.agOpenEpochy === 'function' ? '<button type="button" class="mini" data-open="agOpenEpochy">Otevřít Epochy</button>' : '');
        getZpravodaj().then(function (z) {
            fillSec('ag-bf-news', z ? ['<b>' + esc(z.nadpis) + '</b>' + (z.rubrika ? ' <span style="opacity:.75">(' + esc(z.rubrika) + ')</span>' : '')] : null);
        });
    }

    // ---- auto-otevření 1× denně po startu appky ------------------------------------
    function maybeAutoOpen() {
        try {
            if (localStorage.getItem(KEY_AUTO) === '0') return;
            if (localStorage.getItem(KEY_LAST) === todayStr()) return;
            localStorage.setItem(KEY_LAST, todayStr());
        } catch (e) { return; }
        setTimeout(open, 2500);   // ať naskočí AR a GPS dřív, než se počítají okna
    }
    var _started = false;
    var _startPoll = setInterval(function () {
        if (_started) { clearInterval(_startPoll); return; }
        if (document.body && document.body.classList.contains('app-started')) {
            _started = true; clearInterval(_startPoll);
            maybeAutoOpen();
        }
    }, 500);

    // ---- dlaždice v Nástrojích --------------------------------------------------------
    var _regTries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'brifink', label: 'Dnešek v terénu', icon: ICON, cat: 'Pomůcky', onClick: open, order: 61 });
            return;
        }
        if (_regTries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.agOpenBrifink = open;
})();
