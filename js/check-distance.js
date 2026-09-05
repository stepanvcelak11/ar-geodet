// ===== AR Geodet — OMĚRNÉ KONTROLNÍ MÍRY (odpojitelná vrstva) ==================
// Kontrola geometrie zaměření: porovná pásmem měřené délky mezi body s délkami
// vypočtenými ze S-JTSK souřadnic. Spočte odchylku (mm i ppm), označí překročení
// tolerance a ukáže systematiku (průměrná odchylka = náznak měřítka/jednotek).
// Neinvazivní vrstva — čte globály (arPoints, persistentCustomPoints, proj4,
// userLat/userLng, getStoredData/setStoredData). Spouští se: window.openCheckDist().
//
// Odstranění: smaž js/check-distance.js + css/check-distance.css a jejich řádky
// v index.html a sw.js.
// ================================================================================
(function () {
    'use strict';

    var LS = 'agOmerneChecks';
    var overlay = null;
    var checks = [];                         // [{a, b, meas}]
    var cfg = { baseMm: 20, ppm: 50 };       // tolerance: baseMm + ppm·D

    // cteni cisel pres sdilene agNum() (js/vstupy.js) — desetinna carka, mezery v tisicich
    function num(v) { var n = (typeof window.agNum === 'function') ? window.agNum(v) : parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
    function quickToastSafe(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'check-distance:quickToastSafe'); } try { agInfo(m); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'check-distance:quickToastSafe'); } }

    // S-JTSK: pocita VYHRADNE GeoCore (jediny autoritativni prevod v appce, testovany
    // proti PROJ v tests/cases-geo.js). Tady se jen premapuje na lokalni tvar {Y,X}.
    // Vlastni proj4 zaloha tu byla kvuli odpojitelnosti, jenze mela poradi os zadratovane
    // natvrdo — a poradi os je prave to jedine, co GeoCore hlida (_resolveAxis). Pri
    // zmene proj4 by zaloha Y a X TISE prohodila, takze radsi nic nez cislo vedle.
    function toSJTSK(lat, lng) {
        try { if (window.GeoCore && GeoCore.toSJTSK) { var s = GeoCore.toSJTSK(lat, lng); return { Y: s.y, X: s.x }; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'check-distance:toSJTSK'); }
        try { if (window.agErrLog) agErrLog.record('check-distance: chybi GeoCore — S-JTSK se nepocita'); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'check-distance:toSJTSK'); }
        return null;
    }

    // ---- seznam dostupných bodů (jméno -> souřadnice) -------------------------
    function pointMap() {
        var m = {};
        function add(p) {
            if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number' || !p.name) return;
            if (!(p.name in m)) m[p.name] = { lat: p.lat, lng: p.lng };
        }
        try { if (typeof persistentCustomPoints !== 'undefined') persistentCustomPoints.forEach(add); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'check-distance:add'); }
        try { if (typeof arPoints !== 'undefined') arPoints.forEach(add); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'check-distance:add'); }
        return m;
    }
    function resolve(name) {
        if (name === '@me') {
            try { if (typeof userLat === 'number' && userLat) return { lat: userLat, lng: userLng }; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'check-distance:resolve'); }
            return null;
        }
        var m = pointMap(); return m[name] || null;
    }
    // TERÉNNÍ délka mezi dvěma body (z lokálních poloměrů křivosti WGS84).
    // POZOR: pásmo měří TERÉNNÍ (vodorovnou) délku, kdežto rovinná S-JTSK délka je
    // redukovaná do Křovákova zobrazení (zkreslení −10..+14 cm/km, u dlouhých oměrných
    // i přes toleranci). Proto pro porovnání s pásmem vracíme terénní délku — bez té
    // systematiky a přesněji než haversine.
    function groundDist(pa, pb) {
        var aE = 6378137, e2 = 0.00669437999014;          // WGS84
        var latm = (pa.lat + pb.lat) / 2 * Math.PI / 180;
        var sn = Math.sin(latm), W = Math.sqrt(1 - e2 * sn * sn);
        var M = aE * (1 - e2) / (W * W * W);              // meridionální poloměr křivosti
        var N = aE / W;                                   // příčný poloměr křivosti
        var dN = (pb.lat - pa.lat) * Math.PI / 180 * M;
        var dE = (pb.lng - pa.lng) * Math.PI / 180 * N * Math.cos(latm);
        return Math.hypot(dN, dE);
    }
    function coordDist(a, b) {
        var pa = resolve(a), pb = resolve(b);
        if (!pa || !pb) return null;
        return groundDist(pa, pb);
    }
    function tolFor(d) { return cfg.baseMm / 1000 + cfg.ppm * d / 1e6; }

    // ---- perzistence ---------------------------------------------------------
    function save() {
        try {
            var data = { checks: checks, cfg: cfg };
            if (typeof setStoredData === 'function') setStoredData(LS, JSON.stringify(data));
            else localStorage.setItem(LS, JSON.stringify(data));
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'check-distance:save'); }
    }
    function load() {
        try {
            var s = (typeof getStoredData === 'function') ? getStoredData(LS) : localStorage.getItem(LS);
            if (!s) return;
            var d = JSON.parse(s);
            if (d) {
                if (Array.isArray(d.checks)) checks = d.checks;
                if (d.cfg && typeof d.cfg.baseMm === 'number') cfg.baseMm = d.cfg.baseMm;
                if (d.cfg && typeof d.cfg.ppm === 'number') cfg.ppm = d.cfg.ppm;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'check-distance:load'); }
    }

    // ---- UI ------------------------------------------------------------------
    function build() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'omr-overlay';
        overlay.className = 'omr-overlay';
        overlay.innerHTML =
            '<div class="omr-sheet">' +
            '  <div class="omr-head">' +
            '    <div class="omr-title">Oměrné kontrolní míry</div>' +
            '    <button class="omr-x" id="omr-close" aria-label="Zavřít">✕</button>' +
            '  </div>' +
            '  <div class="omr-sub">Porovná pásmem měřené délky s délkami ze souřadnic (redukováno na terén, bez zkreslení Křováka). Δ = měřeno − ze souřadnic.</div>' +
            '  <div class="omr-add">' +
            '    <select id="omr-a" class="omr-sel"></select>' +
            '    <span class="omr-dash">—</span>' +
            '    <select id="omr-b" class="omr-sel"></select>' +
            '    <input type="text" inputmode="decimal" autocomplete="off" id="omr-meas" class="omr-meas" placeholder="měřeno [m]">' +
            '    <button class="omr-btn omr-btn-acc" id="omr-addbtn">Přidat</button>' +
            '  </div>' +
            '  <div class="omr-tol">Tolerance: <input type="text" inputmode="decimal" autocomplete="off" id="omr-base" class="omr-num"> mm + <input type="text" inputmode="decimal" autocomplete="off" id="omr-ppm" class="omr-num"> ppm·D</div>' +
            '  <div class="omr-table-wrap"><table class="omr-table"><thead><tr><th>Body</th><th>Ze souř.</th><th>Měřeno</th><th>Δ [mm]</th><th>ppm</th><th></th></tr></thead><tbody id="omr-tbody"></tbody></table></div>' +
            '  <div class="omr-summary" id="omr-summary"></div>' +
            '  <div class="omr-foot">' +
            '    <button class="omr-btn" id="omr-csv">Export CSV</button>' +
            '    <button class="omr-btn" id="omr-clear">Vymazat vše</button>' +
            '    <button class="omr-btn omr-btn-sec" id="omr-close2">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(overlay);
        wire();
        return overlay;
    }

    function fillSelects() {
        var m = pointMap();
        var names = Object.keys(m).sort(function (x, y) { return x.localeCompare(y, 'cs', { numeric: true }); });
        var optHtml = '';
        try { if (typeof userLat === 'number' && userLat) optHtml += '<option value="@me">(moje poloha)</option>'; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'check-distance:fillSelects'); }
        names.forEach(function (n) { optHtml += '<option value="' + escAttr(n) + '">' + escHtml(n) + '</option>'; });
        var a = overlay.querySelector('#omr-a'), b = overlay.querySelector('#omr-b');
        var av = a.value, bv = b.value;
        a.innerHTML = optHtml; b.innerHTML = optHtml;
        if (av) a.value = av; if (bv) b.value = bv;
    }
    function escHtml(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

    function wire() {
        function close() { overlay.classList.remove('open'); }
        overlay.querySelector('#omr-close').addEventListener('click', close);
        overlay.querySelector('#omr-close2').addEventListener('click', close);
        overlay.querySelector('#omr-addbtn').addEventListener('click', function () {
            var a = overlay.querySelector('#omr-a').value, b = overlay.querySelector('#omr-b').value;
            var meas = num(overlay.querySelector('#omr-meas').value);
            if (!a || !b || a === b) { quickToastSafe('Vyber dva různé body.'); return; }
            if (meas == null || meas <= 0) { quickToastSafe('Zadej měřenou délku.'); return; }
            checks.push({ a: a, b: b, meas: meas });
            overlay.querySelector('#omr-meas').value = '';
            save(); renderTable();
        });
        overlay.querySelector('#omr-base').addEventListener('change', function () { var v = num(this.value); if (v != null) cfg.baseMm = v; save(); renderTable(); });
        overlay.querySelector('#omr-ppm').addEventListener('change', function () { var v = num(this.value); if (v != null) cfg.ppm = v; save(); renderTable(); });
        overlay.querySelector('#omr-csv').addEventListener('click', exportCSV);
        overlay.querySelector('#omr-clear').addEventListener('click', function () {
            agAsk('Vymazat všechny kontrolní míry?', { title: 'Vymazat míry', okText: 'Vymazat', danger: true }).then(function (ok) {
                if (!ok) return; checks = []; save(); renderTable();
            });
        });
        overlay.querySelector('#omr-tbody').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-del]'); if (!btn) return;
            var i = parseInt(btn.getAttribute('data-del'), 10);
            if (i >= 0) { checks.splice(i, 1); save(); renderTable(); }
        });
    }

    function computeRows() {
        return checks.map(function (c) {
            var d = coordDist(c.a, c.b);
            var row = { a: c.a, b: c.b, meas: c.meas, coord: d };
            if (d == null) { row.bad = true; return row; }
            row.delta = c.meas - d;             // m
            row.dmm = row.delta * 1000;
            row.ppm = d > 0 ? (row.delta / d * 1e6) : 0;
            row.tol = tolFor(d);
            row.fail = Math.abs(row.delta) > row.tol;
            return row;
        });
    }

    function renderTable() {
        if (!overlay) return;
        overlay.querySelector('#omr-base').value = cfg.baseMm;
        overlay.querySelector('#omr-ppm').value = cfg.ppm;
        var rows = computeRows();
        var tb = overlay.querySelector('#omr-tbody');
        if (!rows.length) { tb.innerHTML = '<tr><td colspan="6" class="omr-empty">Zatím žádné kontrolní míry.</td></tr>'; renderSummary([]); return; }
        var html = '';
        rows.forEach(function (r, i) {
            var name = '<span class="omr-pn">' + labelOf(r.a) + '–' + labelOf(r.b) + '</span>';
            if (r.bad) {
                html += '<tr><td>' + name + '</td><td colspan="4" class="omr-bad">bod nenalezen</td><td><button class="omr-del" data-del="' + i + '">✕</button></td></tr>';
                return;
            }
            var cls = r.fail ? 'omr-fail' : 'omr-ok';
            html += '<tr>' +
                '<td>' + name + '</td>' +
                '<td class="omr-mono">' + r.coord.toFixed(3) + '</td>' +
                '<td class="omr-mono">' + r.meas.toFixed(3) + '</td>' +
                '<td class="omr-mono ' + cls + '">' + (r.dmm >= 0 ? '+' : '') + r.dmm.toFixed(0) + '</td>' +
                '<td class="omr-mono">' + (r.ppm >= 0 ? '+' : '') + r.ppm.toFixed(0) + '</td>' +
                '<td><button class="omr-del" data-del="' + i + '">✕</button></td>' +
                '</tr>';
        });
        tb.innerHTML = html;
        renderSummary(rows.filter(function (r) { return !r.bad; }));
    }
    function labelOf(n) { return n === '@me' ? 'já' : escHtml(n); }

    function renderSummary(rows) {
        var el = overlay.querySelector('#omr-summary');
        if (!rows.length) { el.innerHTML = ''; return; }
        var n = rows.length, fails = 0, sum = 0, sq = 0, max = 0;
        rows.forEach(function (r) { if (r.fail) fails++; sum += r.dmm; sq += r.dmm * r.dmm; if (Math.abs(r.dmm) > Math.abs(max)) max = r.dmm; });
        var mean = sum / n, rms = Math.sqrt(sq / n);
        function chip(l, v, c) { return '<span class="omr-chip"><i>' + l + '</i><b' + (c ? ' style="color:' + c + '"' : '') + '>' + v + '</b></span>'; }
        el.innerHTML =
            chip('měr', n, '') +
            chip('mimo tol.', fails, fails ? '#f87171' : '#34d399') +
            chip('průměr (systematika)', (mean >= 0 ? '+' : '') + mean.toFixed(0) + ' mm', '') +
            chip('RMS', rms.toFixed(0) + ' mm', '') +
            chip('max', (max >= 0 ? '+' : '') + max.toFixed(0) + ' mm', '');
    }

    function exportCSV() {
        var rows = computeRows();
        if (!rows.length) { quickToastSafe('Není co exportovat.'); return; }
        var lines = ['bodA;bodB;ze_souradnic_m;mereno_m;delta_mm;ppm;stav'];
        rows.forEach(function (r) {
            if (r.bad) { lines.push(r.a + ';' + r.b + ';;;;;bod nenalezen'); return; }
            lines.push([r.a, r.b, r.coord.toFixed(3), r.meas.toFixed(3), r.dmm.toFixed(0), r.ppm.toFixed(0), r.fail ? 'MIMO' : 'OK'].join(';'));
        });
        try {
            var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
            var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            var proj = ''; try { proj = (typeof activeProjectId !== 'undefined') ? ('_' + activeProjectId) : ''; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'check-distance:exportCSV'); }
            a.download = 'omerne' + proj + '.csv'; document.body.appendChild(a); a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        } catch (e) { quickToastSafe('Export selhal.'); }
    }

    window.openCheckDist = function () {
        build();
        if (!checks.length) load();
        overlay.classList.add('open');
        fillSelects();
        renderTable();
    };
})();
