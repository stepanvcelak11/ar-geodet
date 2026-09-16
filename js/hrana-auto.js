// ===== QTRIG — SAMOČINNÁ KOREKCE GPS PODLE HRANY, PO KTERÉ JDU (ODPOJITELNÁ, ag/lazy) ====
// (16. 9. 2026, fáze 2 „vlastní mapa" — P1, přání uživatele: „jakmile bych šel nějakou
//  vzdálenost po hraně, samo by to začalo dělat korekci"; viz paměť project-vlastni-mapa-…)
//
// PRINCIP: geodet u silnice stejně chodí podél něčeho — obrubník, hranice parcely, zeď.
// Když stopa GPS jde ≥ 20 m SOUBĚŽNĚ (do 6 m) s hranou z mapy a leží od ní pořád stejně
// daleko (rozptyl < 0,9 m), není to náhoda — to je chyba GPS. Posun kolmo na hranu se pak
// nabídne (nebo ve „samo" rovnou zapne) jako korekce GPS: stejný mechanismus jako
// „Posun GPS na známý bod" a „Kalibrace chůzí po hraně" (window.agRefShift), takže pilulka,
// hlídání 20 min / 300 m a přepočet bodů „před a po" fungují dál.
//
// REFERENCE (js/hrany.js): hranice parcel z RÚIAN a lomy výkresu (cm), obrysy budov z
// vektorové mapy (v ČR z importu RÚIAN, ±0,5 m). OSY SILNIC Z OSM SE NEPOUŽÍVAJÍ — ±1–3 m.
// Korekce je JEN KOLMO NA HRANU (1D, jako u kalibrace chůzí „podél"): podél hrany nic nevím.
//
// Režimy (Nastavení → AR & přesnost → „Korekce podle hrany při chůzi"): vypnuto · zeptat se ·
// samo. Nejvýš jeden návrh za 3 min na jednu hranu; „Ne" ji na 10 min umlčí.
// Odstranění: smaž js/hrana-auto.js + <script> v index.html; gen_sw_assets --bump.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGHranaAuto) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'hrana-auto:' + kde); } catch (e2) { /* nic */ } };
    var KEY = 'agHranaAuto_v1';
    var st = { rezim: 'ptat' };   // vyp | ptat | auto
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.rezim) st.rezim = s.rezim; } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }

    var P = { okno: 90000, minDelka: 20, maxOdstup: 6, minFixu: 8, podil: 0.7, maxUhel: 15, maxRozptyl: 0.9, minPosun: 0.4, maxPosun: 5, cooldown: 180000, ticho: 600000 };
    var stopa = [];               // [{lat,lng,t,acc}]
    var hrany = null, hranyTs = 0, hranyStred = null;
    var navrhy = {};              // klic hrany → čas posledního návrhu / umlčení
    var _tik = null, _posledniNavrh = null, _posledniVyhodnoceni = null;

    function polohaRaw() { try { return (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng, acc: (typeof currentGpsAccuracy === 'number' ? currentGpsAccuracy : null) } : null; } catch (e) { return null; } }
    function mPerDeg(lat) { return AGHrany.mPerDeg(lat); }

    function sbirej() {
        var p = polohaRaw(); if (!p) return;
        var now = Date.now(), last = stopa[stopa.length - 1];
        if (last && Math.abs(last.lat - p.lat) < 1e-7 && Math.abs(last.lng - p.lng) < 1e-7) return;   // stejný fix
        stopa.push({ lat: p.lat, lng: p.lng, t: now, acc: p.acc });
        while (stopa.length && now - stopa[0].t > P.okno) stopa.shift();
    }
    function hranyOkolo(p) {
        var now = Date.now();
        if (hrany && hranyStred && now - hranyTs < 15000 && AGHrany.dist(hranyStred, p) < 40) return hrany;
        hrany = AGHrany.sber(p.lat, p.lng, 120).hrany; hranyTs = now; hranyStred = p;
        return hrany;
    }
    function delkaStopy(s) { var d = 0; for (var i = 1; i < s.length; i++) d += AGHrany.dist(s[i - 1], s[i]); return d; }
    function smerStopy(s) {
        // hlavní směr stopy = regrese v místní rovině (azimut 0–180, protože orientace nevadí)
        var m = mPerDeg(s[0].lat), n = s.length, sx = 0, sy = 0;
        var pts = s.map(function (q) { return { x: (q.lng - s[0].lng) * m.lng, y: (q.lat - s[0].lat) * m.lat }; });
        pts.forEach(function (q) { sx += q.x; sy += q.y; }); var mx = sx / n, my = sy / n;
        var sxx = 0, syy = 0, sxy = 0; pts.forEach(function (q) { sxx += (q.x - mx) * (q.x - mx); syy += (q.y - my) * (q.y - my); sxy += (q.x - mx) * (q.y - my); });
        var ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);   // úhel hlavní osy od osy x (východ)
        return ((90 - ang * 180 / Math.PI) % 180 + 180) % 180;   // azimut 0–180
    }
    function rozdilSmeru(a, b) { var d = Math.abs(((a - b) % 180 + 180) % 180); return Math.min(d, 180 - d); }

    // Vyhodnocení stopy: vrací návrh { klic, popis, zdroj, posun (m), dlat, dlng, n, delka, rozptyl } nebo null
    function vyhodnot() {
        if (stopa.length < P.minFixu) return null;
        var s = stopa.filter(function (q) { return q.acc == null || q.acc <= 8; });
        if (s.length < P.minFixu) return null;
        var L = delkaStopy(s); if (L < P.minDelka) return null;
        var hr = hranyOkolo(s[s.length - 1]); if (!hr || !hr.length) return null;
        // každý fix → nejbližší hrana do maxOdstup; sdružit podle hrany
        var sk = {};
        s.forEach(function (q) {
            var h = AGHrany.nejblizsiHrana(q.lat, q.lng, P.maxOdstup, hr); if (!h) return;
            var g = sk[h.klic] || (sk[h.klic] = { h: h, fixy: [], dz: [] });
            g.fixy.push(q); g.dz.push(h.dz);
        });
        var best = null;
        Object.keys(sk).forEach(function (k) { var g = sk[k]; if (!best || g.fixy.length > best.fixy.length) best = g; });
        if (!best || best.fixy.length < P.minFixu || best.fixy.length / s.length < P.podil) return null;
        if (delkaStopy(best.fixy) < P.minDelka * 0.75) return null;
        var uhel = rozdilSmeru(smerStopy(best.fixy), ((best.h.smer % 180) + 180) % 180);
        if (uhel > P.maxUhel) return null;
        var n = best.dz.length, mean = best.dz.reduce(function (a, b) { return a + b; }, 0) / n;
        var v = best.dz.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / n, sd = Math.sqrt(v);
        if (sd > P.maxRozptyl) return null;
        if (Math.abs(mean) < P.minPosun || Math.abs(mean) > P.maxPosun) return null;
        // posun: fixy leží o `mean` vlevo od hrany (dz>0 = vlevo od směru a→b) → posunout o −mean doleva
        var h = best.h, m = mPerDeg(h.a.lat);
        var bx = (h.b.lng - h.a.lng) * m.lng, by = (h.b.lat - h.a.lat) * m.lat, len = Math.hypot(bx, by) || 1;
        var nx = -by / len, ny = bx / len;                 // jednotková normála vlevo
        var dE = -mean * nx, dN = -mean * ny;              // metry, přičíst k GPS
        return { klic: h.klic, popis: h.popis, zdroj: h.zdroj, presnost: h.presnost, posun: Math.abs(mean), dE: dE, dN: dN, dlat: dN / m.lat, dlng: dE / m.lng, n: n, delka: Math.round(delkaStopy(best.fixy)), rozptyl: sd, uhel: uhel, lat: best.fixy[best.fixy.length - 1].lat, lng: best.fixy[best.fixy.length - 1].lng };
    }
    function fmt(x) { return x.toFixed(2).replace('.', ','); }
    function aplikuj(nav) {
        var sh = { dlat: nav.dlat, dlng: nav.dlng, t: Date.now(), acc: Math.round(Math.max(nav.presnost, nav.rozptyl / Math.sqrt(nav.n)) * 100) / 100, on: true, lat: nav.lat, lng: nav.lng, src: 'hrana-auto', mode: '1d', ref: nav.popis };
        window.agRefShift = sh;
        try { localStorage.setItem('agRefShift', JSON.stringify(sh)); } catch (e) { swallow(e, 'saveShift'); }
        try { if (window.agRefShiftWatch) window.agRefShiftWatch(); } catch (e) { swallow(e, 'watch'); }
        try { if (typeof window.agInfo === 'function') window.agInfo('Korekce GPS podle hrany: ' + fmt(nav.posun) + ' m kolmo (' + nav.popis + ', ' + nav.delka + ' m souběžně). Přičítá se k novým bodům; pilulka nahoře.'); } catch (e) { /* nic */ }
        stopa = [];
    }
    function tik() {
        try {
            sbirej();
            if (st.rezim === 'vyp' || !window.AGHrany) return;
            if (Date.now() - (tik._posl || 0) < 3000) return; tik._posl = Date.now();
            // už běží čerstvá korekce z jiného zdroje (známý bod, DGPS, kalibrace chůzí)? nesahat
            var cur = window.agRefShift;
            if (cur && cur.on && cur.src && cur.src !== 'hrana-auto' && Date.now() - (cur.t || 0) < 20 * 60000) return;
            var nav = vyhodnot(); _posledniVyhodnoceni = nav;
            if (!nav) return;
            var z = navrhy[nav.klic] || 0; if (Date.now() < z) return;
            navrhy[nav.klic] = Date.now() + P.cooldown;
            _posledniNavrh = nav;
            if (st.rezim === 'auto') { aplikuj(nav); return; }
            var msg = 'Jdeš <b>' + fmt(nav.posun) + ' m</b> vedle: <b>' + (window.AG && AG.esc ? AG.esc(nav.popis) : nav.popis) + '</b> — ' + nav.delka + ' m souběžně, rozptyl ±' + fmt(nav.rozptyl) + ' m. Vypadá to na chybu GPS, ne na tvoji trasu.<br><br>Srovnat GPS podle hrany (posun kolmo ' + fmt(nav.posun) + ' m)?<br><small>Referenci má ' + (nav.zdroj === 'parcela' ? 'katastr (±0,1 m)' : nav.zdroj === 'dxf' ? 'tvůj výkres' : 'obrys budovy z mapy (±0,5 m)') + '. Podél hrany se nic neposouvá.</small>';
            if (typeof window.agConfirm === 'function') window.agConfirm({ title: 'Srovnat GPS podle hrany?', message: msg, okText: 'Srovnat', cancelText: 'Ne, jdu jinak' }).then(function (ok) { if (ok) aplikuj(nav); else navrhy[nav.klic] = Date.now() + P.ticho; });
        } catch (e) { swallow(e, 'tik'); }
    }

    // ---- Nastavení → AR & přesnost -------------------------------------------------------------
    function ui() {
        if (document.getElementById('s-hrana-auto')) return;
        var tab = document.getElementById('tab-ar'); if (!tab) return;
        var hs = tab.querySelectorAll('.set-h'), kotva = null;
        for (var i = 0; i < hs.length; i++) if (/Kompas/.test(hs[i].textContent)) { kotva = hs[i]; break; }
        var r = document.createElement('div');
        r.innerHTML = '<label>Korekce podle hrany při chůzi<small style="display:block; font-weight:400; color:var(--text-muted);">jdeš-li ≥ 20 m souběžně s hranicí parcely, zdí nebo výkresem a GPS je pořád stejně vedle, nabídne posun kolmo k hraně</small></label>'
            + '<select id="s-hrana-auto" class="st-sel"><option value="vyp">Vypnuto</option><option value="ptat">Zeptat se</option><option value="auto">Samo (bez ptaní)</option></select>';
        if (kotva) tab.insertBefore(r, kotva); else tab.appendChild(r);
        var sel = r.querySelector('select'); sel.value = st.rezim;
        sel.addEventListener('change', function () { st.rezim = sel.value; uloz(); });
    }
    function start() {
        try { ui(); } catch (e) { swallow(e, 'ui'); }
        document.addEventListener('click', function (ev) { try { if (ev.target && ev.target.closest && ev.target.closest('#settings-btn, [data-open="settings"]')) setTimeout(ui, 50); } catch (e) { /* nic */ } }, true);
        if (!_tik) _tik = setInterval(tik, 1000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.AGHranaAuto = {
        vyhodnot: vyhodnot, aplikuj: aplikuj, stopa: function () { return stopa; }, vlozFix: function (lat, lng, t, acc) { stopa.push({ lat: lat, lng: lng, t: t || Date.now(), acc: acc }); },
        vymaz: function () { stopa = []; hrany = null; navrhy = {}; }, nastav: function (o) { if (o && o.rezim) st.rezim = o.rezim; uloz(); }, rezim: function () { return st.rezim; },
        posledniNavrh: function () { return _posledniNavrh; }, P: P, tik: tik
    };
})();
