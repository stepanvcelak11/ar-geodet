// ===== AR Geodet — SLUNCE A SVĚTLO (ODPOJITELNÁ vrstva) =========================
// Každodenní „kdy zapadá slunce", ale v geodetické verzi. Vše 100% OFFLINE
// (výpočet NOAA, žádné API):
//   • Východ / západ / pravé polodne + občanský soumrak (do kdy je vidět na náčrt).
//   • ZBÝVÁ SVĚTLA: kolik minut do západu a do soumraku; podle tempa dneška
//     (kolik bodů/h se dnes zaměřilo — žurnál js/journal.js, fallback prov.ts)
//     dopočítá, kolik bodů se do západu ještě reálně stihne.
//   • AZIMUT + VÝŠKA slunce teď a po hodinách; DÉLKA STÍNU zadané svislice
//     (výtyčka/sloup) → stín se dá použít i jako kontrola směru na severník.
//   • PROTISVĚTLO: zadáš azimut záměry (nebo si ho vezme z kompasu) a appka řekne,
//     kdy během dne bude slunce v ose ±25° a nízko — tedy kdy AR/kamera a hranol
//     nebudou nic vidět (a kdy je naopak ideál).
//   • Odkaz na existující „Kontrolu kompasu podle Slunce" (js/kompas-check.js),
//     ta se tu ZÁMĚRNĚ neduplikuje.
//
// Neinvazivní: NEEDITUJE logika.js/grafika.js — jen čte globály (userLat/userLng,
// currentHeading, getStoredData, AGJournal) a otevírá vlastní modal.
// Vstup: dlaždice „Slunce a světlo" v Nástrojích (Pomůcky). API: window.agOpenSlunce().
// Odstranění: smaž js/slunce.js + řádek <script> v index.html a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.__agSlunceInit) return;
    window.__agSlunceInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
    var STYLE_ID = 'ag-su-style';
    var LS_POLE = 'agSunPoleH_v1';    // výška svislice pro stín (m)
    var LS_AZ = 'agSunSightAz_v1';    // azimut záměry (°)

    var _timer = null;

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function pad2(n) { return ('0' + n).slice(-2); }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function pos() {
        try { if (typeof userLat === 'number' && userLat && typeof userLng === 'number') return { lat: userLat, lng: userLng }; } catch (e) {}
        try { var p = JSON.parse(localStorage.getItem('arLastPos')); if (p && p.lat) return { lat: +p.lat, lng: +(p.lng != null ? p.lng : p.lon) }; } catch (e) {}
        return null;
    }
    function heading() {
        try { if (typeof smoothedHeading !== 'undefined' && smoothedHeading != null) return smoothedHeading; } catch (e) {}
        try { if (typeof currentHeading !== 'undefined' && currentHeading != null) return currentHeading; } catch (e) {}
        return null;
    }

    // ---- astronomie (NOAA; přesnost ~1 min / desetiny stupně — pro terén dost) -------
    var RAD = Math.PI / 180;
    function solarParams(date) {
        var tz = -date.getTimezoneOffset() / 60;
        var start = new Date(date.getFullYear(), 0, 0);
        var doy = Math.floor((date - start) / 86400000);
        var hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
        var g = 2 * Math.PI / 365 * (doy - 1 + (hour - 12) / 24);
        var eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
        var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
            + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
        return { tz: tz, eqtime: eqtime, decl: decl, hour: hour };
    }
    function sunPos(date, lat, lng) {
        var sp = solarParams(date);
        var tst = sp.hour * 60 + sp.eqtime + 4 * lng - 60 * sp.tz;   // pravý slunečný čas (min)
        var ha = tst / 4 - 180;
        var latr = lat * RAD;
        var cz = Math.sin(latr) * Math.sin(sp.decl) + Math.cos(latr) * Math.cos(sp.decl) * Math.cos(ha * RAD);
        cz = Math.max(-1, Math.min(1, cz));
        var zen = Math.acos(cz), el = 90 - zen / RAD, az = 0, sz = Math.sin(zen);
        if (Math.abs(sz) > 1e-6) {
            var ca = (Math.sin(sp.decl) - Math.sin(latr) * cz) / (Math.cos(latr) * sz);
            ca = Math.max(-1, Math.min(1, ca));
            var a = Math.acos(ca) / RAD;
            az = (ha > 0) ? (360 - a) : a;
        }
        return { az: ((az % 360) + 360) % 360, el: el };
    }
    // časy pro daný zenit (90.833 = východ/západ s refrakcí, 96 = občanský soumrak)
    function sunTimes(date, lat, lng, zenithDeg) {
        var noonDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
        var sp = solarParams(noonDate);
        var latr = lat * RAD;
        var cosHa = Math.cos(zenithDeg * RAD) / (Math.cos(latr) * Math.cos(sp.decl)) - Math.tan(latr) * Math.tan(sp.decl);
        var noonMin = 720 - sp.eqtime - 4 * lng + 60 * sp.tz;
        var out = { noon: minToDate(date, noonMin), rise: null, set: null, polar: null };
        if (cosHa > 1) { out.polar = 'noc';  return out; }    // slunce dnes nevyjde
        if (cosHa < -1) { out.polar = 'den'; return out; }    // slunce dnes nezapadne
        var ha0 = Math.acos(cosHa) / RAD;
        out.rise = minToDate(date, noonMin - 4 * ha0);
        out.set = minToDate(date, noonMin + 4 * ha0);
        return out;
    }
    function minToDate(day, min) {
        var d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
        return new Date(d.getTime() + Math.round(min * 60000));
    }
    function hhmm(d) { return d ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '–'; }
    function durTxt(ms) {
        if (ms == null || ms < 0) return '–';
        var m = Math.round(ms / 60000);
        return (m >= 60 ? Math.floor(m / 60) + ' h ' : '') + (m % 60) + ' min';
    }
    function adiff(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }

    // ---- tempo dneška: kolik bodů/h se dnes zaměřilo -----------------------------------
    function idTs(id) {
        var m = String(id || '').match(/(\d{13})/);
        return m ? parseInt(m[1], 10) : null;
    }
    function todayPoints(cb) {
        var d0 = new Date(); d0.setHours(0, 0, 0, 0);
        var from = d0.getTime();
        function fromPoints() {
            var raw = null, arr = null, ts = [];
            try { if (typeof getStoredData === 'function') raw = getStoredData('arCustomPoints12'); } catch (e) {}
            if (raw == null) { try { raw = localStorage.getItem(pid() + '_arCustomPoints12'); } catch (e2) {} }
            try { arr = raw ? JSON.parse(raw) : null; } catch (e3) {}
            if (Array.isArray(arr)) {
                arr.forEach(function (p) {
                    if (!p) return;
                    var t = (p.prov && p.prov.ts) || idTs(p.id);
                    if (t != null && t >= from) ts.push(t);
                });
            }
            return ts;
        }
        if (window.AGJournal && typeof AGJournal.all === 'function') {
            AGJournal.all(pid()).then(function (recs) {
                var ts = [];
                if (Array.isArray(recs)) {
                    recs.forEach(function (q) { if (q && q.op === 'add' && q.ts >= from) ts.push(q.ts); });
                }
                cb(ts.length ? ts : fromPoints());
            }, function () { cb(fromPoints()); });
        } else cb(fromPoints());
    }
    // tempo = body / hodiny mezi prvním a posledním dnešním bodem (min. 0,5 h)
    function tempo(ts) {
        if (!ts || ts.length < 2) return null;
        var mn = Math.min.apply(null, ts), mx = Math.max.apply(null, ts);
        var h = (mx - mn) / 3600000;
        if (h < 0.5) h = 0.5;
        return { perH: ts.length / h, n: ts.length, spanH: h };
    }

    // ---- UI ---------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent =
            '#ag-su-modal .ag-su-big{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 12px;}' +
            '#ag-su-modal .ag-su-cell{flex:1 1 92px;background:var(--bg-input,rgba(255,255,255,.06));border-radius:10px;padding:8px 10px;text-align:center;}' +
            '#ag-su-modal .ag-su-cell b{display:block;font-size:1.2em;} #ag-su-modal .ag-su-cell small{color:var(--text-muted,#9aa1ac);}' +
            '#ag-su-modal .ag-su-hi{background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.4);border-radius:10px;padding:9px 12px;margin:0 0 12px;font-size:.95em;line-height:1.5;}' +
            '#ag-su-modal .ag-su-warn{background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.4);}' +
            '#ag-su-modal h4{margin:14px 0 6px;font-size:1em;}' +
            '#ag-su-modal .ag-su-row{display:flex;gap:8px;align-items:center;padding:4px 6px;border-radius:7px;font-size:.9em;font-variant-numeric:tabular-nums;}' +
            '#ag-su-modal .ag-su-row:nth-child(odd){background:rgba(255,255,255,.03);}' +
            '#ag-su-modal .ag-su-row.now{background:rgba(96,165,250,.18);}' +
            '#ag-su-modal .ag-su-row span:first-child{width:50px;color:var(--text-muted,#9aa1ac);}' +
            '#ag-su-modal .ag-su-row .w{width:74px;} #ag-su-modal .ag-su-row .g{flex:1;color:#fbbf24;font-size:.92em;}' +
            '#ag-su-modal .ag-su-in{display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap;}' +
            '#ag-su-modal .ag-su-in input{width:88px;}' +
            '#ag-su-modal .ag-su-note{color:var(--text-muted,#9aa1ac);font-size:.82em;line-height:1.45;margin-top:10px;}' +
            // Tělo musí scrollovat SAMO: .modal-content má v css/style.css overflow:hidden,
            // takže bez tohohle se spodní polovina tabulky „Chod slunce dnes" (24 řádků)
            // oříznula a nedalo se k ní doscrollovat. Stejný vzor má brifink.js a denik-dne.js.
            '#ag-su-modal .modal-content{display:flex;flex-direction:column;}' +
            '#ag-su-modal h3{flex:none;}' +
            '#ag-su-modal #ag-su-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;padding-right:6px;}' +
            // Patička: .btn má width:100% + margin-top:10px, takže „řádek" tlačítek se
            // ve skutečnosti vykreslil jako pruhy pod sebou. Přebijeme to (vzor zavady.js).
            '#ag-su-modal .ag-su-foot{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;flex:none;}' +
            '#ag-su-modal .ag-su-foot .btn{flex:1 1 0;min-width:118px;margin:0;min-height:44px;}' +
            'body.ag-glove #ag-su-modal .ag-su-foot .btn{min-height:52px;}';
        document.head.appendChild(s);
    }
    function ensureModal() {
        var m = document.getElementById('ag-su-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'ag-su-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Slunce a světlo</h3>' +
            '  <div id="ag-su-body"></div>' +
            '  <div class="ag-su-foot">' +
            '    <button type="button" class="btn btn-secondary" id="ag-su-comp">Kontrola kompasu podle Slunce</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-su-close">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-su-close').addEventListener('click', close);
        m.querySelector('#ag-su-comp').addEventListener('click', function () {
            if (typeof window.openSunCheck === 'function') { close(); window.openSunCheck(); }
            else if (typeof window.agInfo === 'function') window.agInfo('Kontrola kompasu podle Slunce není v této verzi k dispozici.');
        });
        return m;
    }

    function poleH() { var v = parseFloat(localStorage.getItem(LS_POLE)); return (isFinite(v) && v > 0) ? v : 2.0; }
    function sightAz() { var v = parseFloat(localStorage.getItem(LS_AZ)); return isFinite(v) ? ((v % 360) + 360) % 360 : null; }

    function render() {
        var body = document.getElementById('ag-su-body');
        if (!body) return;
        var p = pos();
        if (!p) { body.innerHTML = '<div style="padding:14px;color:var(--text-muted,#9aa1ac);">Bez polohy neumím spočítat východ ani západ — počkej na GPS fix.</div>'; return; }
        var now = new Date();
        var t = sunTimes(now, p.lat, p.lng, 90.833);
        var tw = sunTimes(now, p.lat, p.lng, 96);
        var s = sunPos(now, p.lat, p.lng);
        var h = poleH(), az = sightAz();

        var toSet = t.set ? t.set - now : null;
        var toTwi = tw.set ? tw.set - now : null;

        var html = '<div class="ag-su-big">' +
            '<div class="ag-su-cell"><small>Východ</small><b>' + hhmm(t.rise) + '</b></div>' +
            '<div class="ag-su-cell"><small>Polodne</small><b>' + hhmm(t.noon) + '</b></div>' +
            '<div class="ag-su-cell"><small>Západ</small><b>' + hhmm(t.set) + '</b></div>' +
            '<div class="ag-su-cell"><small>Soumrak</small><b>' + hhmm(tw.set) + '</b></div>' +
            '</div>';

        // zbývá světla + odhad bodů (tempo se doplní asynchronně)
        var lightCls = (toSet != null && toSet < 45 * 60000) ? ' ag-su-warn' : '';
        html += '<div class="ag-su-hi' + lightCls + '" id="ag-su-light">';
        if (t.polar === 'den') html += 'Slunce dnes nezapadá.';
        else if (t.polar === 'noc') html += 'Slunce dnes nevychází.';
        else if (toSet != null && toSet > 0) {
            html += '☀️ <b>Do západu zbývá ' + durTxt(toSet) + '</b>, na náčrt a úklid pak ještě ' + durTxt(toTwi - toSet) + ' soumraku.';
            html += '<div id="ag-su-tempo" style="margin-top:4px;color:var(--text-muted,#9aa1ac);">Počítám dnešní tempo…</div>';
        } else if (toTwi != null && toTwi > 0) {
            html += '🌆 <b>Slunce zapadlo</b> — do konce občanského soumraku ' + durTxt(toTwi) + '. Přesné cílení v AR už bude problém.';
        } else {
            html += '🌙 <b>Je tma.</b> Zaměřování v AR (kamera potřebuje světlo) odlož na ' + hhmm(sunTimes(new Date(now.getTime() + 86400000), p.lat, p.lng, 96).rise) + '.';
        }
        html += '</div>';

        // slunce teď + stín
        var shadow = (s.el > 0.5) ? (h / Math.tan(s.el * RAD)) : null;
        html += '<h4>Slunce teď</h4><div class="ag-su-big">' +
            '<div class="ag-su-cell"><small>Azimut</small><b>' + s.az.toFixed(0) + '°</b></div>' +
            '<div class="ag-su-cell"><small>Výška</small><b>' + s.el.toFixed(0) + '°</b></div>' +
            '<div class="ag-su-cell"><small>Stín ' + h.toFixed(1) + ' m</small><b>' + (shadow != null ? (shadow < 100 ? shadow.toFixed(1) : Math.round(shadow)) + ' m' : '–') + '</b></div>' +
            '</div>' +
            '<div class="ag-su-in"><label>Výška svislice <input type="text" inputmode="decimal" autocomplete="off" id="ag-su-pole" value="' + h.toFixed(1) + '"> m</label>' +
            '<span style="color:var(--text-muted,#9aa1ac);font-size:.85em;">stín míří k azimutu ' + (((s.az + 180) % 360)).toFixed(0) + '°</span></div>';

        // protisvětlo na záměře
        html += '<h4>Protisvětlo na záměře</h4>' +
            '<div class="ag-su-in"><label>Azimut záměry <input type="number" inputmode="numeric" step="1" min="0" max="359" id="ag-su-az" value="' + (az != null ? az.toFixed(0) : '') + '">°</label>' +
            '<button type="button" class="btn btn-secondary" id="ag-su-fromcomp" style="padding:5px 10px;font-size:.85em;">Vzít z kompasu</button></div>';
        if (az != null) {
            var bad = [], i;
            for (i = 0; i < 24; i++) {
                var tt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), i, 30, 0, 0);
                var ss = sunPos(tt, p.lat, p.lng);
                if (ss.el > 0 && ss.el < 35 && adiff(ss.az, az) < 25) bad.push(i);
            }
            if (bad.length) {
                var seg = [], st = bad[0], prev = bad[0];
                for (i = 1; i <= bad.length; i++) {
                    if (i < bad.length && bad[i] === prev + 1) { prev = bad[i]; continue; }
                    seg.push(pad2(st) + ':00–' + pad2((prev + 1) % 24) + ':00');
                    if (i < bad.length) { st = bad[i]; prev = bad[i]; }
                }
                html += '<div class="ag-su-hi ag-su-warn">🕶 Slunce bude nízko v ose záměry (±25°) v ' + esc(seg.join(', ')) +
                    '. V tu dobu neuvidíš do displeje, kamera AR bude přeexponovaná a na hranol se nezaměříš — měř tuto záměru mimo tyto hodiny, nebo z protisměru.</div>';
            } else {
                html += '<div class="ag-su-hi">✅ Na tuhle záměru dnes slunce nízko v ose nepůjde — protisvětlo neřeš.</div>';
            }
        }

        // hodinový chod
        html += '<h4>Chod slunce dnes</h4>';
        for (var k = 0; k < 24; k++) {
            var d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), k, 0, 0, 0);
            var sp2 = sunPos(d2, p.lat, p.lng);
            if (sp2.el < -6) continue;
            var sh = (sp2.el > 0.5) ? (h / Math.tan(sp2.el * RAD)) : null;
            var tag = '';
            if (sp2.el > 0 && sp2.el < 10) tag = 'nízké slunce — dlouhé stíny, oslnění';
            else if (sp2.el >= 45) tag = 'vysoké slunce — nejkratší stíny, čitelný displej ve stínu těla';
            html += '<div class="ag-su-row' + (k === now.getHours() ? ' now' : '') + '">' +
                '<span>' + pad2(k) + ':00</span>' +
                '<span class="w">az ' + sp2.az.toFixed(0) + '°</span>' +
                '<span class="w">' + sp2.el.toFixed(0) + '° nad</span>' +
                '<span class="w">stín ' + (sh != null ? (sh < 100 ? sh.toFixed(1) : Math.round(sh)) + ' m' : '–') + '</span>' +
                '<span class="g">' + tag + '</span></div>';
        }

        html += '<div class="ag-su-note">Výpočet je lokální (NOAA, bez internetu), časy ±1 min, azimut ±0,2°. Stín platí pro vodorovný terén — ve sklonu bude jiný. ' +
            'Azimuty jsou vztažené k zeměpisnému (nikoli magnetickému) severu, stejně jako azimuty bodů v appce.</div>';

        body.innerHTML = html;

        // vstupy
        var pl = body.querySelector('#ag-su-pole');
        if (pl) pl.addEventListener('change', function () {
            // pole je type="text" inputmode="decimal" (Safari zahodi carku v type=number)
            var v = (typeof window.agNum === 'function') ? window.agNum(this) : parseFloat(String(this.value).replace(',', '.'));
            if (isFinite(v) && v > 0) { try { localStorage.setItem(LS_POLE, String(v)); } catch (e) {} render(); }
        });
        var azi = body.querySelector('#ag-su-az');
        if (azi) azi.addEventListener('change', function () {
            var v = agNum(this.value);
            try { if (isFinite(v)) localStorage.setItem(LS_AZ, String(((v % 360) + 360) % 360)); else localStorage.removeItem(LS_AZ); } catch (e) {}
            render();
        });
        var fc = body.querySelector('#ag-su-fromcomp');
        if (fc) fc.addEventListener('click', function () {
            var hd = heading();
            if (hd == null) { if (typeof window.agInfo === 'function') window.agInfo('Kompas teď nedává data — otoč se s telefonem, nebo azimut zadej ručně.'); return; }
            try { localStorage.setItem(LS_AZ, String(((hd % 360) + 360) % 360)); } catch (e) {}
            render();
        });

        // odhad stihnutelných bodů (async, ať se modal neblokuje)
        if (toSet != null && toSet > 0) {
            todayPoints(function (ts) {
                var el = document.getElementById('ag-su-tempo');
                if (!el) return;
                var tp = tempo(ts);
                if (!tp) {
                    el.textContent = ts && ts.length === 1
                        ? 'Dnes máš 1 bod — na odhad tempa potřebuju aspoň dva.'
                        : 'Dnes ještě žádné body — tempo neumím odhadnout.';
                    return;
                }
                var hrs = toSet / 3600000;
                var n = Math.floor(tp.perH * hrs);
                el.innerHTML = 'Dnešní tempo <b>' + tp.perH.toFixed(1) + ' bodu/h</b> (' + tp.n + ' bodů za ' + tp.spanH.toFixed(1) + ' h) → do západu stihneš ještě přibližně <b>' + n + '</b> ' +
                    (n === 1 ? 'bod' : (n >= 2 && n <= 4 ? 'body' : 'bodů')) + '.';
            });
        }
    }

    function open() {
        var m = ensureModal();
        m.style.display = 'flex';
        render();
        if (_timer) clearInterval(_timer);
        _timer = setInterval(function () {
            var mm = document.getElementById('ag-su-modal');
            if (!mm || mm.style.display === 'none') { clearInterval(_timer); _timer = null; return; }
            render();
        }, 60000);
    }
    function close() {
        var m = document.getElementById('ag-su-modal');
        if (m) m.style.display = 'none';
        if (_timer) { clearInterval(_timer); _timer = null; }
    }

    // ---- registrace dlaždice ----------------------------------------------------------
    var _regTries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'slunce', label: 'Slunce a světlo', icon: ICON, cat: 'Pomůcky', onClick: open, order: 8 });
            return;
        }
        if (_regTries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.agOpenSlunce = open;
    // pro jiné moduly (bezpečnost v terénu si bere časy soumraku odsud)
    window.AGSun = { pos: sunPos, times: sunTimes };
})();
