// ===== AR Geodet — KNIHA JÍZD / CESŤÁK (ODPOJITELNÁ vrstva) =====================
// Každodenní „kolik jsem najezdil", ale navázané na zakázky:
//   • „Odjíždím" uloží start (čas, poloha, název místa = aktivní zakázka nebo
//     nejbližší značka z js/kde-je.js), „Přijel jsem" uloží cíl a jízdu uzavře.
//   • Kilometry: buď ze stavu tachometru (přesné, pro účetnictví), nebo odhad
//     ze vzdušné vzdálenosti × koeficient klikatosti (1,3 — u nás realistický).
//     ODHAD JE VŽDY OZNAČENÝ, aby se nepletl s odečtem tachometru.
//   • Přehled po měsících: součet km, počet jízd, rozpad podle zakázek, CSV
//     export pro účetní (oddělovač „;", kódování UTF-8 s BOM kvůli Excelu).
//   • Volitelná sazba Kč/km jen dopočítá částku — appka ŽÁDNÉ zákonné sazby
//     nezná ani nehádá, protože se každý rok mění; zadává si je uživatel.
//
// Vozidlo (SPZ) a řidič se pamatují, u firemního režimu se řidič předplní z
// přihlášeného účtu (AGUcty), ale jde přepsat.
//
// LAYOUT (proč to tak vypadá): pomocné akce „Zapsat ručně / Export CSV / Vozidlo
// a sazba / Zavřít" byly čtyři .btn přes celou šířku — samotná tlačítka sežrala
// půl displeje a na seznam jízd, kvůli kterému se okno otevírá, nezbylo místo.
// Teď je z nich mřížka .ag-quad (čtverečky z css/style.css, stejné jako u nového
// bodu a exportu): ikona + krátký popisek, 4 v řadě, na úzkém displeji 2×2.
// Široké tlačítko zůstalo JEN hlavnímu úkonu (Odjíždím / Přijel jsem) — na to se
// ťuká v autě a s rukavicí. Přepínač měsíce sedí v pruhu souhrnu a dlouhé
// vysvětlení kilometrů je sbalené v <details>, ať je vidět víc jízd.
// POZOR: tlačítko „Zavřít" musí mít přesně tenhle popisek — js/modal-close.js
// podle něj hledá vlastní zavírání okna, když se táhne dolů nebo ťukne na křížek.
//
// Neinvazivní: NEEDITUJE logika.js/grafika.js. Data jsou GLOBÁLNÍ (napříč
// zakázkami) v localStorage 'agTripLog_v1' — cesťák je věc člověka, ne zakázky.
// Vstup: dlaždice „Kniha jízd" v Nástrojích (Pomůcky). API: window.agOpenKnihaJizd().
// Odstranění: smaž js/kniha-jizd.js + řádek <script> v index.html a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.__agKnihaJizdInit) return;
    window.__agKnihaJizdInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17V12l1.6-4a2 2 0 0 1 1.9-1.3h9a2 2 0 0 1 1.9 1.3L20 12v5"/><path d="M4 17h16M6.5 17v2M17.5 17v2M6 12.5h12"/><path d="M9 21h6"/></svg>';
    var STYLE_ID = 'ag-kz-style';
    var LS_TRIPS = 'agTripLog_v1';     // [{id, t0, t1, fromName, fromLat, fromLng, toName, toLat, toLng, km, kmSrc, odo0, odo1, purpose, driver, car, note}]
    var LS_OPEN = 'agTripOpen_v1';     // rozjetá jízda {t0, fromName, fromLat, fromLng, odo0, purpose}
    var LS_CFG = 'agTripCfg_v1';       // {car, driver, rate}
    var ROAD_K = 1.3;                  // vzdušná → silniční koeficient

    var _month = null;                 // 'YYYY-MM' zobrazený měsíc (null = aktuální)

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function toast(m) { try { if (typeof window.quickToast === 'function') return window.quickToast(m); } catch (e) {} }
    function info(m, t) { try { if (typeof window.agInfo === 'function') return window.agInfo(m, t); } catch (e) {} alert(String(m).replace(/<[^>]*>/g, '')); }
    function ask(m, cb) {
        try { if (typeof window.agAsk === 'function') { window.agAsk(m).then(function (ok) { if (ok) cb(); }); return; } } catch (e) {}
        if (confirm(String(m).replace(/<[^>]*>/g, ''))) cb();
    }
    function pad2(n) { return ('0' + n).slice(-2); }

    function lsGet(k, def) { try { var v = JSON.parse(localStorage.getItem(k)); return (v == null) ? def : v; } catch (e) { return def; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function trips() { var a = lsGet(LS_TRIPS, []); return Array.isArray(a) ? a : []; }
    function saveTrips(a) { lsSet(LS_TRIPS, a); }
    function cfg() { var c = lsGet(LS_CFG, {}); return (c && typeof c === 'object') ? c : {}; }
    function saveCfg(c) { lsSet(LS_CFG, c); }
    function openTrip() { var o = lsGet(LS_OPEN, null); return (o && o.t0) ? o : null; }
    function setOpenTrip(o) { if (o) lsSet(LS_OPEN, o); else { try { localStorage.removeItem(LS_OPEN); } catch (e) {} } }

    // ---- kontext: poloha, zakázka, řidič -----------------------------------------------
    function pos() {
        try { if (typeof userLat === 'number' && userLat != null && typeof userLng === 'number') return { lat: userLat, lng: userLng }; } catch (e) {}
        try { var p = JSON.parse(localStorage.getItem('arLastPos')); if (p && p.lat) return { lat: +p.lat, lng: +(p.lng != null ? p.lng : p.lon) }; } catch (e) {}
        return null;
    }
    function projName() {
        var id = 'default';
        try { id = localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) {}
        try {
            var l = JSON.parse(localStorage.getItem('arProjectsList') || '[]');
            if (Array.isArray(l)) { for (var i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i].name || id; }
        } catch (e) {}
        return id === 'default' ? '' : id;
    }
    function driverName() {
        var c = cfg();
        if (c.driver) return c.driver;
        try {
            if (window.AGUcty && typeof AGUcty.currentUser === 'function') {
                var u = AGUcty.currentUser();
                if (u && u.name) return u.name;
            }
        } catch (e) {}
        try { return localStorage.getItem('arSurveyor') || ''; } catch (e) {}
        return '';
    }
    function dist(a, b) {
        try { if (typeof getDistance === 'function') return getDistance(a.lat, a.lng, b.lat, b.lng); } catch (e) {}
        var R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
        var la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180;
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    // název místa: nejbližší značka z „Kde mám auto" do 300 m, jinak zakázka, jinak souřadnice
    function placeName(p) {
        if (!p) return '';
        try {
            var pk = JSON.parse(localStorage.getItem('agParked_v1'));
            if (Array.isArray(pk)) {
                var best = null;
                pk.forEach(function (r) {
                    if (r && r.lat != null) {
                        var d = dist(p, r);
                        if (d < 300 && (!best || d < best.d)) best = { d: d, label: r.label };
                    }
                });
                if (best) return best.label;
            }
        } catch (e) {}
        var pn = projName();
        if (pn) return pn;
        return p.lat.toFixed(4) + ', ' + p.lng.toFixed(4);
    }

    // ---- start / konec jízdy -------------------------------------------------------------
    function startTrip() {
        if (openTrip()) { info('Jedna jízda už běží. Nejdřív ji ukonči tlačítkem <b>Přijel jsem</b>.'); return; }
        var p = pos();
        askOdo('Stav tachometru při odjezdu (km)', function (odo) {
            var o = {
                t0: Date.now(),
                fromName: placeName(p),
                fromLat: p ? p.lat : null, fromLng: p ? p.lng : null,
                odo0: odo, purpose: projName()
            };
            setOpenTrip(o);
            render();
            toast('Jízda začala' + (odo != null ? ' (tachometr ' + odo + ' km)' : '') + '.');
        });
    }
    function endTrip() {
        var o = openTrip();
        if (!o) { info('Žádná jízda neběží. Začni tlačítkem <b>Odjíždím</b> — nebo použij čtvereček <b>Zapsat ručně</b>.'); return; }
        var p = pos();
        askOdo('Stav tachometru při příjezdu (km)', function (odo) {
            var km = null, kmSrc = 'odhad';
            if (odo != null && o.odo0 != null && odo >= o.odo0) { km = Math.round((odo - o.odo0) * 10) / 10; kmSrc = 'tachometr'; }
            else if (p && o.fromLat != null) { km = Math.round(dist({ lat: o.fromLat, lng: o.fromLng }, p) / 1000 * ROAD_K * 10) / 10; }
            var c = cfg();
            var rec = {
                id: 'tr_' + Date.now(),
                t0: o.t0, t1: Date.now(),
                fromName: o.fromName, fromLat: o.fromLat, fromLng: o.fromLng,
                toName: placeName(p), toLat: p ? p.lat : null, toLng: p ? p.lng : null,
                km: km, kmSrc: kmSrc, odo0: o.odo0, odo1: odo,
                purpose: o.purpose || projName(), driver: driverName(), car: c.car || '', note: ''
            };
            var a = trips(); a.push(rec); saveTrips(a);
            setOpenTrip(null);
            render();
            toast('Jízda uzavřena: ' + (km != null ? km + ' km' : 'bez km') + (kmSrc === 'odhad' ? ' (odhad)' : '') + '.');
        });
    }
    function cancelTrip() {
        ask('Zahodit rozjetou jízdu?', function () { setOpenTrip(null); render(); toast('Rozjetá jízda zahozena.'); });
    }
    function askOdo(title, cb) {
        try {
            if (typeof window.agPrompt === 'function') {
                window.agPrompt({ title: title, message: 'Necháš-li prázdné, kilometry se odhadnou ze vzdušné vzdálenosti (×' + ROAD_K + ').', value: '', okText: 'Potvrdit' })
                    .then(function (v) {
                        var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
                        cb(isFinite(n) && n >= 0 ? n : null);
                    }, function () { cb(null); });
                return;
            }
        } catch (e) {}
        var s = prompt(title + ' (prázdné = odhad):');
        var n2 = parseFloat(String(s == null ? '' : s).replace(',', '.'));
        cb(isFinite(n2) && n2 >= 0 ? n2 : null);
    }

    // ---- ruční zápis ---------------------------------------------------------------------
    function manualAdd() {
        var m = document.getElementById('ag-kz-man');
        if (!m) return;
        m.style.display = (m.style.display === 'none' || !m.style.display) ? 'block' : 'none';
        if (m.style.display === 'block') {
            var d = new Date();
            m.querySelector('#ag-kz-m-date').value = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
            m.querySelector('#ag-kz-m-purp').value = projName();
            // formulář je pod seznamem jízd — u delšího měsíce by se otevřel mimo obraz
            try { m.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
        }
    }
    function manualSave() {
        var m = document.getElementById('ag-kz-man');
        if (!m) return;
        var dv = m.querySelector('#ag-kz-m-date').value;
        var from = m.querySelector('#ag-kz-m-from').value.trim();
        var to = m.querySelector('#ag-kz-m-to').value.trim();
        var km = parseFloat(String(m.querySelector('#ag-kz-m-km').value).replace(',', '.'));
        var purp = m.querySelector('#ag-kz-m-purp').value.trim();
        if (!dv || !isFinite(km) || km <= 0) { info('Vyplň datum a kilometry.'); return; }
        var parts = dv.split('-');
        var t = new Date(+parts[0], +parts[1] - 1, +parts[2], 8, 0, 0).getTime();
        var c = cfg();
        var a = trips();
        a.push({
            id: 'tr_' + Date.now(), t0: t, t1: t,
            fromName: from || '—', toName: to || '—',
            fromLat: null, fromLng: null, toLat: null, toLng: null,
            km: Math.round(km * 10) / 10, kmSrc: 'ručně', odo0: null, odo1: null,
            purpose: purp, driver: driverName(), car: c.car || '', note: ''
        });
        saveTrips(a);
        m.style.display = 'none';
        render();
        toast('Jízda zapsána.');
    }

    // ---- měsíce a souhrny -----------------------------------------------------------------
    function monthKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
    function monthLabel(mk) {
        var p = mk.split('-');
        var names = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
        return names[+p[1] - 1] + ' ' + p[0];
    }
    function monthsAvailable() {
        var set = {}, a = trips();
        a.forEach(function (r) { set[monthKey(r.t0)] = 1; });
        var now = monthKey(Date.now());
        set[now] = 1;
        return Object.keys(set).sort().reverse();
    }
    function curMonth() { return _month || monthKey(Date.now()); }

    // ---- CSV -------------------------------------------------------------------------------
    function exportCsv() {
        var mk = curMonth();
        var rows = trips().filter(function (r) { return monthKey(r.t0) === mk; }).sort(function (x, y) { return x.t0 - y.t0; });
        if (!rows.length) { info('V tomto měsíci nejsou žádné jízdy.'); return; }
        var c = cfg();
        var out = 'Datum;Odjezd;Prijezd;Odkud;Kam;Ucel / zakazka;Kilometry;Zdroj km;Tachometr od;Tachometr do;Ridic;Vozidlo\r\n';
        var sum = 0;
        rows.forEach(function (r) {
            var d = new Date(r.t0);
            sum += (r.km || 0);
            out += [
                pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear(),
                pad2(d.getHours()) + ':' + pad2(d.getMinutes()),
                r.t1 ? pad2(new Date(r.t1).getHours()) + ':' + pad2(new Date(r.t1).getMinutes()) : '',
                csvCell(r.fromName), csvCell(r.toName), csvCell(r.purpose),
                (r.km != null ? String(r.km).replace('.', ',') : ''),
                r.kmSrc || '', (r.odo0 != null ? r.odo0 : ''), (r.odo1 != null ? r.odo1 : ''),
                csvCell(r.driver), csvCell(r.car || c.car || '')
            ].join(';') + '\r\n';
        });
        out += ';;;;;CELKEM;' + String(Math.round(sum * 10) / 10).replace('.', ',') + '\r\n';
        var blob = new Blob(['﻿' + out], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'kniha-jizd-' + mk + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast('CSV uloženo (' + rows.length + ' jízd).');
    }
    function csvCell(s) { return String(s == null ? '' : s).replace(/[;\r\n]/g, ' '); }

    // ---- UI ----------------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent =
            // HLAVNÍ ÚKON (Odjíždím / Přijel jsem) zůstává širokým tlačítkem — na to se
            // ťuká v autě a s rukavicí. Jen se odebral vnější odstup .btn (margin-top),
            // aby řádek nepadal doprostřed prázdna. „Zahodit" je vedle a užší.
            '#ag-kz-modal .ag-kz-act{display:flex;gap:8px;margin:2px 0 10px;}' +
            '#ag-kz-modal .ag-kz-act .btn{flex:1 1 auto;margin-top:0;padding:12px 14px;min-height:48px;}' +
            '#ag-kz-modal .ag-kz-act .btn.slim{flex:0 0 36%;font-size:14px;}' +
            // Pomocné akce = mřížka .ag-quad ze style.css (stejné čtverečky jako u
            // nového bodu a exportu). Tady jen odstup, vzhled je společný.
            '#ag-kz-modal .ag-quad{margin:10px 0 0;}' +
            '#ag-kz-modal .ag-kz-open{background:var(--accent-soft,rgba(52,211,153,.12));border:1px solid var(--accent-line,rgba(52,211,153,.4));border-radius:var(--r-md,12px);padding:8px 10px;margin:0 0 8px;font-size:.9em;line-height:1.45;}' +
            // Pruh souhrnu: první „buňka" je rovnou přepínač měsíce — ušetří celý řádek.
            '#ag-kz-modal .ag-kz-sum{display:flex;gap:7px;flex-wrap:wrap;align-items:stretch;margin:0 0 8px;}' +
            '#ag-kz-modal .ag-kz-cell{flex:1 1 80px;background:var(--surface-2,rgba(255,255,255,.06));border-radius:var(--r-md,12px);padding:6px 8px;text-align:center;}' +
            '#ag-kz-modal .ag-kz-cell b{display:block;font-size:1.15em;line-height:1.25;}' +
            '#ag-kz-modal .ag-kz-cell small{display:block;color:var(--text-muted,#9aa1ac);font-size:.78em;}' +
            '#ag-kz-modal .ag-kz-msel{flex:1 1 120px;min-height:44px;}' +
            '#ag-kz-modal .ag-kz-it{display:flex;gap:8px;align-items:center;padding:6px 4px 6px 10px;border-radius:var(--r-md,12px);background:var(--surface-1,rgba(255,255,255,.03));margin-bottom:5px;font-size:.88em;}' +
            '#ag-kz-modal .ag-kz-it .d{flex:1;min-width:0;} #ag-kz-modal .ag-kz-it small{display:block;color:var(--text-muted,#9aa1ac);font-size:.85em;}' +
            '#ag-kz-modal .ag-kz-it .km{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600;}' +
            '#ag-kz-modal .ag-kz-it .est{color:var(--warning,#fbbf24);font-weight:400;font-size:.82em;}' +
            // Křížek u jízdy je malý na pohled, ale 44px terč (záporný margin ho nechá
            // řádek nenafouknout) — mazání se nesmí trefovat nehtem.
            '#ag-kz-modal .ag-kz-x{flex:none;width:44px;height:44px;margin:-5px 0;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:var(--r-md,12px);color:var(--text-muted,#9aa1ac);font-size:1.25em;padding:0;}' +
            '#ag-kz-modal .ag-kz-x:active{background:var(--surface-2,rgba(255,255,255,.08));}' +
            '#ag-kz-modal .ag-kz-man{background:var(--surface-2,rgba(255,255,255,.06));border-radius:var(--r-md,12px);padding:9px;margin:10px 0 0;}' +
            '#ag-kz-modal .ag-kz-man .r2{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px;}' +
            '#ag-kz-modal .ag-kz-man label{display:block;margin:0 0 7px;font-size:.8em;color:var(--text-muted,#9aa1ac);}' +
            '#ag-kz-modal .ag-kz-man .r2 label{margin:0;}' +
            '#ag-kz-modal .ag-kz-man input{width:100%;margin-top:3px;}' +
            '#ag-kz-modal select,#ag-kz-modal input{background:var(--surface-2,rgba(255,255,255,.08));color:inherit;border:1px solid var(--glass-border,rgba(255,255,255,.15));border-radius:var(--r-sm,8px);padding:6px 8px;min-height:40px;box-sizing:border-box;}' +
            '#ag-kz-modal .ag-kz-note{color:var(--text-muted,#9aa1ac);font-size:.8em;line-height:1.4;margin-top:8px;}' +
            // Dlouhé vysvětlení „jak se to počítá" se schová — pod ním má být SEZNAM.
            '#ag-kz-modal .ag-kz-help{margin-top:8px;}' +
            '#ag-kz-modal .ag-kz-help>summary{list-style:none;cursor:pointer;color:var(--text-muted,#9aa1ac);font-size:.82em;padding:8px 0;}' +
            '#ag-kz-modal .ag-kz-help>summary::-webkit-details-marker{display:none;}' +
            // rukavice: terče nahoru, ať se pořád trefíš
            'body.ag-glove #ag-kz-modal .ag-kz-act .btn{min-height:54px;}' +
            'body.ag-glove #ag-kz-modal .ag-kz-x{width:48px;height:48px;margin:-3px 0;}' +
            'body.ag-glove #ag-kz-modal select,body.ag-glove #ag-kz-modal input{min-height:44px;font-size:16px;}';
        document.head.appendChild(s);
    }
    function ensureModal() {
        var m = document.getElementById('ag-kz-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'ag-kz-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Kniha jízd</h3>' +
            '  <div id="ag-kz-body"></div>' +
            // ruční zápis: dvojice polí vedle sebe (datum+km, odkud+kam) — pod sebou
            // to bylo pět řádků a formulář vytlačil seznam jízd mimo obrazovku
            '  <div class="ag-kz-man" id="ag-kz-man" style="display:none;">' +
            '    <div class="r2">' +
            '      <label>Datum<input type="date" id="ag-kz-m-date"></label>' +
            '      <label>Kilometry<input type="number" step="0.1" min="0" id="ag-kz-m-km" placeholder="42,5"></label>' +
            '      <label>Odkud<input type="text" id="ag-kz-m-from" placeholder="Kancelář"></label>' +
            '      <label>Kam<input type="text" id="ag-kz-m-to" placeholder="Stavba / obec"></label>' +
            '    </div>' +
            '    <label>Účel / zakázka<input type="text" id="ag-kz-m-purp"></label>' +
            '    <div class="ag-kz-act" style="margin:8px 0 0;">' +
            '      <button type="button" class="btn btn-primary" id="ag-kz-m-save">Zapsat jízdu</button>' +
            '      <button type="button" class="btn btn-secondary slim" id="ag-kz-m-cancel">Zrušit</button>' +
            '    </div>' +
            '  </div>' +
            // ČTVEREČKY místo čtyř tlačítek přes celou šířku: stejná mřížka .ag-quad
            // jako u nového bodu / exportu, takže to nepůsobí jako cizí okno.
            '  <div class="ag-quad" id="ag-kz-actions">' +
            '    <button type="button" id="ag-kz-manual"><svg class="icon"><use href="#i-edit"/></svg><span>Zapsat<br>ručně</span></button>' +
            '    <button type="button" id="ag-kz-csv"><svg class="icon"><use href="#i-download"/></svg><span>Export<br>CSV</span></button>' +
            '    <button type="button" id="ag-kz-cfg"><svg class="icon"><use href="#i-sliders"/></svg><span>Vozidlo<br>a sazba</span></button>' +
            '    <button type="button" id="ag-kz-close"><svg class="icon"><use href="#i-x"/></svg><span>Zavřít</span></button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-kz-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-kz-manual').addEventListener('click', manualAdd);
        m.querySelector('#ag-kz-m-save').addEventListener('click', manualSave);
        m.querySelector('#ag-kz-m-cancel').addEventListener('click', function () { var f = document.getElementById('ag-kz-man'); if (f) f.style.display = 'none'; });
        m.querySelector('#ag-kz-csv').addEventListener('click', exportCsv);
        m.querySelector('#ag-kz-cfg').addEventListener('click', editCfg);
        var body = m.querySelector('#ag-kz-body');
        // POZOR: tlačítka mají uvnitř <svg>/<span>, takže e.target nemusí být samo
        // tlačítko — hledá se přes closest(), jinak by klik na ikonu nic neudělal.
        body.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;
            var x = t.closest('.ag-kz-x');
            if (x) {
                var id = x.getAttribute('data-id');
                ask('Smazat tuto jízdu z knihy?', function () {
                    saveTrips(trips().filter(function (r) { return r.id !== id; }));
                    render();
                });
                return;
            }
            var b = t.closest('button');
            if (!b) return;
            if (b.id === 'ag-kz-start') startTrip();
            else if (b.id === 'ag-kz-end') endTrip();
            else if (b.id === 'ag-kz-cancel') cancelTrip();
        });
        body.addEventListener('change', function (e) {
            if (e.target && e.target.id === 'ag-kz-month') { _month = e.target.value; render(); }
        });
        return m;
    }
    function editCfg() {
        var c = cfg();
        try {
            if (typeof window.agPrompt === 'function') {
                window.agPrompt({ title: 'Vozidlo', message: 'SPZ / popis vozidla (píše se do CSV).', value: c.car || '', okText: 'Uložit' }).then(function (car) {
                    if (car != null) { c.car = String(car).trim(); saveCfg(c); }
                    return window.agPrompt({ title: 'Sazba', message: 'Kč za kilometr pro dopočet částky. Nech prázdné, pokud částku nechceš — appka žádné zákonné sazby nezná, zadáváš je ty.', value: c.rate != null ? String(c.rate) : '', okText: 'Uložit' });
                }).then(function (r) {
                    if (r != null) {
                        var n = parseFloat(String(r).replace(',', '.'));
                        c.rate = isFinite(n) && n > 0 ? n : null;
                        saveCfg(c);
                    }
                    render();
                });
                return;
            }
        } catch (e) {}
        var car = prompt('SPZ / vozidlo:', c.car || '');
        if (car != null) c.car = car.trim();
        var rr = prompt('Kč/km (prázdné = nepočítat):', c.rate != null ? String(c.rate) : '');
        var nn = parseFloat(String(rr == null ? '' : rr).replace(',', '.'));
        c.rate = isFinite(nn) && nn > 0 ? nn : null;
        saveCfg(c); render();
    }

    function render() {
        var body = document.getElementById('ag-kz-body');
        if (!body) return;
        var o = openTrip(), c = cfg();
        var h = '';

        // rozjetá jízda / akce
        if (o) {
            var mins = Math.round((Date.now() - o.t0) / 60000);
            h += '<div class="ag-kz-open">🚗 <b>Jízda běží</b> — start ' + pad2(new Date(o.t0).getHours()) + ':' + pad2(new Date(o.t0).getMinutes()) +
                ' z „' + esc(o.fromName || '—') + '"' + (o.odo0 != null ? ', tachometr ' + o.odo0 + ' km' : '') +
                ' (' + mins + ' min).</div>' +
                '<div class="ag-kz-act"><button type="button" class="btn btn-primary" id="ag-kz-end">Přijel jsem</button>' +
                '<button type="button" class="btn btn-secondary slim" id="ag-kz-cancel">Zahodit</button></div>';
        } else {
            h += '<div class="ag-kz-act"><button type="button" class="btn btn-primary" id="ag-kz-start">Odjíždím</button></div>';
        }

        // měsíc + souhrn V JEDNOM PRUHU — přepínač měsíce je první „buňka", takže
        // nezabírá vlastní řádek a na displej se vejde víc jízd
        var mk = curMonth();
        var ms = monthsAvailable();
        var msel = '<select id="ag-kz-month" class="ag-kz-msel" aria-label="Měsíc">' +
            ms.map(function (k) { return '<option value="' + k + '"' + (k === mk ? ' selected' : '') + '>' + esc(monthLabel(k)) + '</option>'; }).join('') +
            '</select>';

        var rows = trips().filter(function (r) { return monthKey(r.t0) === mk; }).sort(function (x, y) { return y.t0 - x.t0; });
        var sum = 0, est = 0, byProj = {};
        rows.forEach(function (r) {
            sum += (r.km || 0);
            if (r.kmSrc === 'odhad') est += (r.km || 0);
            var key = r.purpose || '(bez zakázky)';
            byProj[key] = (byProj[key] || 0) + (r.km || 0);
        });
        sum = Math.round(sum * 10) / 10;
        h += '<div class="ag-kz-sum">' + msel +
            '<div class="ag-kz-cell"><small>Jízd</small><b>' + rows.length + '</b></div>' +
            '<div class="ag-kz-cell"><small>Kilometrů</small><b>' + sum + '</b></div>' +
            (c.rate ? '<div class="ag-kz-cell"><small>Při ' + c.rate + ' Kč/km</small><b>' + Math.round(sum * c.rate) + ' Kč</b></div>' : '') +
            '</div>';
        if (est > 0) h += '<div class="ag-kz-note" style="margin-top:0;">Z toho ' + (Math.round(est * 10) / 10) + ' km je jen ODHAD ze vzdušné vzdálenosti — pro účetnictví dopiš skutečné km z tachometru.</div>';

        // rozpad podle zakázek
        var keys = Object.keys(byProj).sort(function (a, b) { return byProj[b] - byProj[a]; });
        if (keys.length > 1) {
            h += '<div class="ag-kz-note" style="margin-top:6px;"><b>Podle zakázek:</b> ' +
                keys.map(function (k) { return esc(k) + ' ' + (Math.round(byProj[k] * 10) / 10) + ' km'; }).join(' · ') + '</div>';
        }

        // seznam jízd
        if (!rows.length) {
            h += '<div style="padding:8px 2px;color:var(--text-muted,#9aa1ac);font-size:.88em;">V tomto měsíci žádné jízdy. Až vyrazíš, klepni na <b>Odjíždím</b>.</div>';
        } else {
            rows.forEach(function (r) {
                var d = new Date(r.t0);
                h += '<div class="ag-kz-it">' +
                    '<div class="d"><b>' + pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '. ' + esc(r.fromName || '—') + ' → ' + esc(r.toName || '—') + '</b>' +
                    '<small>' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) +
                    (r.t1 && r.t1 > r.t0 ? '–' + pad2(new Date(r.t1).getHours()) + ':' + pad2(new Date(r.t1).getMinutes()) : '') +
                    (r.purpose ? ' · ' + esc(r.purpose) : '') + (r.car ? ' · ' + esc(r.car) : '') + '</small></div>' +
                    '<div class="km">' + (r.km != null ? r.km + ' km' : '–') + (r.kmSrc === 'odhad' ? '<span class="est"> odhad</span>' : '') + '</div>' +
                    '<button type="button" class="ag-kz-x" data-id="' + esc(r.id) + '" aria-label="Smazat">×</button>' +
                    '</div>';
            });
        }

        h += '<details class="ag-kz-help"><summary>Jak se počítají kilometry a co appka nedělá</summary>' +
            '<div class="ag-kz-note" style="margin-top:0;">Kilometry z tachometru jsou průkazné, odhad ze vzdušné vzdálenosti (×' + ROAD_K + ') je jen pomůcka. ' +
            'Appka nepočítá zákonné náhrady ani spotřebu — Kč/km si nastavuješ sám v „Vozidlo a sazba". Data jsou jen v tomhle telefonu; do zálohy zakázky nepatří, exportuj si CSV.</div></details>';

        body.innerHTML = h;
    }

    function open() {
        var m = ensureModal();
        m.style.display = 'flex';
        _month = null;
        render();
    }

    // ---- registrace dlaždice ------------------------------------------------------------------
    var _regTries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'kniha-jizd', label: 'Kniha jízd', icon: ICON, cat: 'Pomůcky', onClick: open, order: 63 });
            return;
        }
        if (_regTries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.agOpenKnihaJizd = open;
})();
