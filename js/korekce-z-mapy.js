// ===== QTRIG — OPRAVA GPS Z MAPY ZA CHŮZE (ODPOJITELNÁ vrstva, Přesné měření) =====
// NÁPAD UŽIVATELE (16. 9. 2026): „Poloha z mapy je jen pro statické stání. Klepnu, kde
// stojím, a pak se hýbu — klik do ortofota je ±0,5–1 m, to je pořád přesnější než
// GPS v mobilu (±4 m). Rychlé malé zpřesnění, platí třeba 100 m / 10 minut."
//
// CO TO DĚLÁ: totéž co „Posun GPS na známý bod", jen známý bod = TVOJE KLEPNUTÍ do
// mapy. Appka spočítá vektor (klepnutí − GPS) a přičítá ho:
//   • k ŽIVÉ POLOZE (AR, navigace, vzdálenosti, průměr GPS) — to je novinka; ostatní
//     korekce (hrana, známý bod, DGPS) posouvají jen ukládané body,
//   • tím pádem i k nově ukládaným bodům (průměr se počítá už z posunutých fixů;
//     js/ref-calibration.js bod podruhé NEPOSOUVÁ, jen mu zapíše původ).
// Platí 10 min / 100 m (limity v ref-calibration.js `limity`, src 'mapa'), pilulka
// nahoře hlídá stárnutí; po vypršení se živý posun přestane přičítat sám.
//
// POCTIVĚ K PŘESNOSTI: jeden fix GPS má šum ±2–4 m — z jednoho klepnutí bez postání
// by korekce byla spíš náhodná (4 m → 3 m). Když postojíš 30–60 s (průměr ±0,5–1 m)
// a pak klepneš, vyjde ±0,8–1,4 m a pár minut drží: z ±3–5 m na ±1,5–2 m. Pod
// stromy a mezi domy se chyba mění každých pár metrů — tam to nepomůže.
//
// Statická „Poloha z mapy" (js/poloha-z-mapy.js) zůstává, jak je: stojím na místě,
// GPS se nepoužívá vůbec. Tohle je pro chůzi.
//
// Napojení: js/logika.js ve watchPosition volá window.agZivyPosun() (vrací {dlat,dlng}
// nebo null) a přičte ho k userLat/userLng; surový fix nechává v window.AGFixRaw.
// js/ref-calibration.js: src 'mapa' v limity/loadShift, wrapper saveCustomPoint u live
// posunu jen značkuje. Odstranění: smaž soubor + záznam v MANIFESTu (js/lazy-tools.js)
// + registr (js/tools-registry.js) + návod (data/navody.json); háky mají typeof-guard.
// ================================================================================
(function () {
    'use strict';
    if (window.AGKorekceMapa) return;

    var MODAL_ID = 'agkm-modal', STYLE_ID = 'agkm-style', BAR_ID = 'agkm-bar';
    var FINGER_PX = 8, ACC_FLOOR_M = 0.6, ACC_CEIL_M = 30;
    var PLATI_MIN = 10, PLATI_M = 100;
    var _ov = null, _pick = false, _vysledek = null, _tick = null;

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'korekce-z-mapy:' + kde); } catch (e2) { /* nic */ } }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function fmt(v, d) { return (isFinite(v) ? v.toFixed(d == null ? 2 : d) : '–').replace('.', ','); }
    function byId(id) { return document.getElementById(id); }
    function theMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function mPerDeg(lat) { return { lat: 111320, lng: 111320 * Math.cos((lat || 50) * Math.PI / 180) }; }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { swallow(e, 'toast'); } }
    function alertBox(t, m) { try { if (typeof agAlert === 'function') return agAlert({ title: t, message: m }); } catch (e) { swallow(e, 'alert'); } try { alert(t + '\n\n' + String(m).replace(/<[^>]+>/g, '')); } catch (e) { /* nic */ } }
    function accFromZoom(lat, zoom) {
        var mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
        var a = mpp * FINGER_PX;
        if (!isFinite(a)) return 5;
        return Math.max(ACC_FLOOR_M, Math.min(ACC_CEIL_M, a));
    }

    // ---- surová GPS (bez už zapnutého živého posunu a bez statické polohy z mapy) --------
    function shift() { try { return (window.agRefShift && typeof window.agRefShift === 'object') ? window.agRefShift : null; } catch (e) { return null; } }
    function zivyAktivni() { var s = shift(); return !!(s && s.on && s.live && isFinite(s.dlat) && isFinite(s.dlng)); }
    function rawGps() {
        try { var mp = window.AGManualPos; if (mp && mp.active) return null; } catch (e0) { /* nic */ }   // statická poloha z mapy = žádná GPS
        // 1) průměr GPS (gpsAvgResult z logika.js) — když běží živý posun, je už posunutý → odečíst
        try {
            if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && !gpsAvgResult.manual && isFinite(gpsAvgResult.lat) && (gpsAvgResult.n || 0) >= 3
                && (!gpsAvgResult.ts || Date.now() - gpsAvgResult.ts < 20000)) {
                var a = { lat: gpsAvgResult.lat, lng: gpsAvgResult.lng, n: gpsAvgResult.n || 0, sterr: (isFinite(gpsAvgResult.sterr) ? gpsAvgResult.sterr : null), acc: gpsAvgResult.acc, from: 'avg' };
                var s = shift(); if (zivyAktivni()) { a.lat -= s.dlat; a.lng -= s.dlng; }
                return a;
            }
        } catch (e) { swallow(e, 'rawGps'); }
        // 2) poslední surový fix (window.AGFixRaw plní logika.js před přičtením posunu)
        try {
            var f = window.AGFixRaw || window.AGFix;
            if (f && !f.manual && isFinite(f.lat) && isFinite(f.lng) && f.ts && Date.now() - f.ts < 15000) return { lat: f.lat, lng: f.lng, n: 1, sterr: (isFinite(f.acc) ? f.acc : null), acc: f.acc, from: 'fix' };
        } catch (e) { swallow(e, 'rawGps2'); }
        return null;
    }

    // ---- výpočet a zapnutí ---------------------------------------------------------------
    function spocitej(lat, lng, zoom) {
        var g = rawGps();
        if (!g) { alertBox('Není GPS', 'Nemám čerstvou polohu z GPS. Vypni statickou „Polohu z mapy" (je-li zapnutá), počkej na fix a zkus to znovu.'); return null; }
        var m = mPerDeg(lat);
        var dlat = lat - g.lat, dlng = lng - g.lng;
        var dE = dlng * m.lng, dN = dlat * m.lat, mag = Math.hypot(dE, dN);
        var klik = accFromZoom(lat, (zoom != null && isFinite(zoom)) ? zoom : 19);
        var gpsAcc = g.from === 'avg' ? (g.sterr != null ? g.sterr : 1) : (g.sterr != null ? Math.max(1.5, g.sterr / 2) : 3);   // jeden fix: hlášená přesnost je ~2σ
        var acc = Math.sqrt(klik * klik + gpsAcc * gpsAcc);
        return { lat: lat, lng: lng, gps: g, dlat: dlat, dlng: dlng, dE: dE, dN: dN, mag: mag, klik: klik, gpsAcc: gpsAcc, acc: acc, zoom: zoom };
    }
    function zapni(v, live) {
        var s = { dlat: v.dlat, dlng: v.dlng, t: Date.now(), acc: Math.round(v.acc * 100) / 100, on: true, lat: v.lat, lng: v.lng, src: 'mapa', live: !!live, ref: 'klepnutí do mapy', n: v.gps.n };
        window.agRefShift = s;
        try { localStorage.setItem('agRefShift', JSON.stringify(s)); } catch (e) { swallow(e, 'save'); }
        try { if (window.agRefShiftWatch) window.agRefShiftWatch(); } catch (e) { swallow(e, 'watch'); }
        try { if (typeof updateInfoPanel === 'function') updateInfoPanel(); } catch (e) { /* nic */ }
    }
    function vypni() {
        var s = shift(); if (!s) return;
        s.on = false;
        try { localStorage.setItem('agRefShift', JSON.stringify(s)); } catch (e) { swallow(e, 'save2'); }
        try { if (window.agRefShiftWatch) window.agRefShiftWatch(); } catch (e) { swallow(e, 'watch2'); }
    }
    // Živý posun pro logika.js: platí jen do limitu (10 min / 100 m od místa klepnutí),
    // pak se přestane přičítat sám (pilulka to ohlásí). Vzdálenost bere ze surového fixu.
    function zivyPosun(rawLat, rawLng) {
        var s = shift();
        if (!s || !s.on || !s.live || !isFinite(s.dlat) || !isFinite(s.dlng)) return null;
        if (s.t && Date.now() - s.t > PLATI_MIN * 60000) return null;
        try {
            if (isFinite(s.lat) && isFinite(rawLat)) {
                var m = mPerDeg(s.lat);
                var d = Math.hypot((rawLng + s.dlng - s.lng) * m.lng, (rawLat + s.dlat - s.lat) * m.lat);
                if (d > PLATI_M * 1.5) return null;   // 150 m = tvrdý strop (100 m hlásí pilulka)
            }
        } catch (e) { /* nic */ }
        return { dlat: s.dlat, dlng: s.dlng };
    }
    // (window.agZivyPosun pro logika.js definuje js/ref-calibration.js — ten je načtený vždy, tenhle nástroj ne)

    // ---- klepnutí do mapy ------------------------------------------------------------------
    function pickOnMap() {
        var m = theMap();
        var vm = null; try { vm = viewMode; } catch (e) { /* nic */ }
        if (!m) { alertBox('Mapa', 'Mapa zatím neběží — přepni na mapu.'); return; }
        if (vm === 'ar') { alertBox('Mapa', 'Přepni na mapu nebo dělené zobrazení, pak klepni, kde stojíš.'); return; }
        if (!rawGps()) { alertBox('Není GPS', 'Nemám čerstvou polohu z GPS — bez ní není co opravovat. Je-li zapnutá statická „Poloha z mapy", vypni ji.'); return; }
        _ov.style.display = 'none';
        _pick = true;
        var bar = document.createElement('div');
        bar.id = BAR_ID;
        bar.innerHTML = '<span><b>Klepni do mapy přesně tam, kde stojíš</b><br><small>nejlíp na ortofotu: roh budovy, obruba, kanál…</small></span>'
            + '<button type="button" id="agkm-bar-x">Zrušit</button>';
        document.body.appendChild(bar);
        function end() {
            try { m.off('click', onClick); } catch (e) { swallow(e, 'off'); }
            bar.remove(); _pick = false;
            _ov.style.display = 'flex';
            render();
        }
        function onClick(e) {
            var ll = null;
            try { if (e.originalEvent && typeof window.agScreenToLatLng === 'function') ll = window.agScreenToLatLng(e.originalEvent.clientX, e.originalEvent.clientY); } catch (err) { swallow(err, 'onClick'); }
            if (!ll && e.latlng) ll = e.latlng;
            if (!ll || !isFinite(ll.lat) || !isFinite(ll.lng)) return;
            var zoom = null; try { zoom = m.getZoom(); } catch (er) { zoom = null; }
            _vysledek = spocitej(ll.lat, ll.lng, zoom);
            end();
        }
        bar.querySelector('#agkm-bar-x').addEventListener('click', end);
        setTimeout(function () { try { m.on('click', onClick); } catch (e) { swallow(e, 'on'); } }, 60);
    }

    // ---- okno ----------------------------------------------------------------------------
    function styly() {
        if (byId(STYLE_ID)) return;
        var st = document.createElement('style'); st.id = STYLE_ID;
        st.textContent = [
            '#' + MODAL_ID + ' .modal-content{max-width:560px;}',
            '.km-simple{border:1px solid rgba(74,222,128,.35);background:rgba(74,222,128,.06);border-radius:12px;padding:4px 12px;margin:0 0 12px;font-size:calc(12.5px * var(--ag-font-scale,1));line-height:1.45;}',
            '.km-simple summary{cursor:pointer;color:var(--accent,#2f9e74);font-weight:600;padding:6px 0;}',
            '.km-simple ol{padding-left:18px;margin:6px 0;} .km-simple li{margin:4px 0;} .km-simple p{margin:6px 0;opacity:.9;}',
            '.km-stav{border:1px solid var(--glass-border,rgba(255,255,255,.12));border-radius:12px;padding:10px 12px;margin:0 0 10px;font-size:calc(13px * var(--ag-font-scale,1));line-height:1.45;}',
            '.km-stav.ok{border-color:rgba(74,222,128,.45);background:rgba(74,222,128,.08);}',
            '.km-stav.warn{border-color:rgba(251,191,36,.5);background:rgba(251,191,36,.08);}',
            '.km-stav b.big{font-size:calc(22px * var(--ag-font-scale,1));font-variant-numeric:tabular-nums;}',
            '.km-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,.08));font-size:calc(13px * var(--ag-font-scale,1));}',
            '.km-row span:first-child{color:var(--text-muted,#9aa1ac);} .km-row b{font-variant-numeric:tabular-nums;}',
            '.km-opt{display:flex;align-items:center;gap:10px;padding:8px 0;font-size:calc(13px * var(--ag-font-scale,1));cursor:pointer;}',
            '.km-opt input{width:20px;height:20px;}',
            '#' + MODAL_ID + ' .btn{margin-top:8px;}',
            '#' + BAR_ID + '{position:fixed;left:50%;transform:translateX(-50%);z-index:100001;bottom:max(18px,env(safe-area-inset-bottom));display:flex;gap:10px;align-items:center;background:rgba(8,11,15,.92);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:10px 14px;color:#fff;font-size:calc(13px * var(--ag-font-scale,1));max-width:calc(100vw - 24px);box-shadow:0 10px 30px rgba(0,0,0,.45);}',
            '#' + BAR_ID + ' small{color:#9aa1ac;}',
            '#' + BAR_ID + ' button{border:none;border-radius:999px;padding:8px 14px;background:rgba(255,255,255,.14);color:#fff;font-size:calc(13px * var(--ag-font-scale,1));cursor:pointer;flex:0 0 auto;}'
        ].join('\n');
        document.head.appendChild(st);
    }
    function build() {
        if (_ov && document.body.contains(_ov)) return _ov;
        styly();
        _ov = document.createElement('div');
        _ov.className = 'modal-overlay'; _ov.id = MODAL_ID; _ov.setAttribute('data-ag-needs', 'gps');
        _ov.innerHTML = '<div class="modal-content" role="dialog" aria-modal="true">'
            + '<h3 style="color:var(--accent);margin-top:0;"><svg class="icon"><use href="#i-map-pin"/></svg> Oprava GPS z mapy za chůze</h3>'
            + '<div class="modal-body" id="agkm-body"></div>'
            + '<button type="button" class="btn btn-secondary" id="agkm-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(_ov);
        _ov.querySelector('#agkm-close').addEventListener('click', close);
        _ov.querySelector('#agkm-body').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-a]') : null; if (!b) return;
            var a = b.getAttribute('data-a');
            if (a === 'pick') pickOnMap();
            else if (a === 'on' && _vysledek) { var live = !!(byId('agkm-live') && byId('agkm-live').checked); zapni(_vysledek, live); _vysledek = null; render(); toast(live ? 'Oprava GPS z mapy zapnuta — posouvá i živou polohu, platí ' + PLATI_MIN + ' min / ' + PLATI_M + ' m.' : 'Oprava GPS z mapy zapnuta pro nově ukládané body.'); }
            else if (a === 'off') { vypni(); render(); toast('Oprava GPS z mapy vypnuta.'); }
            else if (a === 'zahodit') { _vysledek = null; render(); }
        });
        return _ov;
    }
    function smer(dE, dN) {
        var az = ((Math.atan2(dE, dN) * 180 / Math.PI) + 360) % 360;
        var S = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];
        return S[Math.round(az / 45) % 8] + ' (' + Math.round(az) + '°)';
    }
    function gpsStavHtml() {
        var g = rawGps();
        if (!g) return '<div class="km-stav warn"><b>Bez GPS.</b> Čekám na fix' + ((window.AGManualPos && AGManualPos.active) ? ' — je zapnutá statická „Poloha z mapy", tu napřed vypni' : '') + '.</div>';
        var ok = g.from === 'avg' && (g.n || 0) >= 10;
        return '<div class="km-stav ' + (ok ? 'ok' : 'warn') + '">'
            + (g.from === 'avg' ? '<b>Průměr GPS:</b> ' + g.n + ' měření' + (g.sterr != null ? ', ±' + fmt(g.sterr) + ' m' : '') : '<b>Jen jeden fix</b> (±' + fmt(g.sterr || 0, 0) + ' m)')
            + (ok ? ' — dobré, klepni.' : ' — <b>postůj ještě chvíli</b> (30–60 s), z jednoho fixu by korekce byla náhodná.')
            + '</div>';
    }
    function render() {
        var body = byId('agkm-body'); if (!body) return;
        var s = shift(), zap = s && s.on && s.src === 'mapa';
        var h = '<details class="km-simple" open><summary>Jednoduše: co to dělá a jak na to</summary>'
            + '<p>GPS v telefonu se plete o pár metrů, ale chvíli <b>pořád stejným směrem</b>. Ty ale na ortofotu vidíš, kde přesně stojíš (roh budovy, obruba, kanál) — na půl metru. Klepneš tam a appka si spočítá, o kolik se GPS právě plete, a <b>ten kus odečítá i za chůze</b>: v AR, v navigaci, ve vzdálenostech i u bodů, které uložíš.</p>'
            + '<ol><li>Postůj <b>30–60 s</b> na volném místě (ne pod stromem, ne u zdi), ať se GPS zprůměruje.</li>'
            + '<li>Přepni mapu na <b>ortofoto</b>, přibliž a klepni <b>Klepnout, kde stojím</b> → klepni přesně na své místo.</li>'
            + '<li>Zkontroluj, o kolik se GPS plete, a dej <b>Zapnout</b>. Platí <b>' + PLATI_MIN + ' min / ' + PLATI_M + ' m</b> od místa — pilulka nahoře hlídá, kdy klepnout znovu.</li></ol>'
            + '<p><b>Co čekat:</b> z ±3–5 m na ±1,5–2 m po dobu pár minut. Pod stromy a mezi domy se chyba mění každých pár metrů — tam to nepomůže. Statická „Poloha z mapy" (stojím na místě, GPS se nepoužije) zůstává zvlášť.</p>'
            + '</details>';
        if (zap) {
            var st = null; try { st = window.agRefShiftStav ? window.agRefShiftStav() : null; } catch (e) { st = null; }
            var m = mPerDeg(s.lat || 50), mag = Math.hypot(s.dlng * m.lng, s.dlat * m.lat);
            h += '<div class="km-stav ' + (st && st.stav === 'bad' ? 'warn' : 'ok') + '"><b>Teď zapnutá oprava z mapy:</b> GPS se tu plete o <b class="big">' + fmt(mag, 1) + ' m</b> ' + smer(s.dlng * m.lng, s.dlat * m.lat)
                + (s.live ? ' · posouvá i <b>živou polohu</b>' : ' · jen ukládané body') + (s.acc != null ? ' · ±' + fmt(s.acc) + ' m' : '')
                + (st ? '<br><small>' + esc(st.text) + '</small>' : '') + '</div>'
                + '<button type="button" class="btn btn-secondary" data-a="off">Vypnout opravu</button>';
        }
        if (_vysledek) {
            var v = _vysledek;
            h += '<div class="km-stav ok"><b>Výsledek:</b> GPS se tu plete o <b class="big">' + fmt(v.mag, 1) + ' m</b> směrem ' + smer(v.dE, v.dN) + '</div>'
                + '<div class="km-row"><span>Klepnutí do mapy</span><b>±' + fmt(v.klik, 1) + ' m' + (v.zoom != null ? ' (zoom ' + Math.round(v.zoom) + ')' : '') + '</b></div>'
                + '<div class="km-row"><span>GPS</span><b>' + (v.gps.from === 'avg' ? 'průměr ' + v.gps.n + ' měření, ±' + fmt(v.gpsAcc) + ' m' : 'jeden fix, ±' + fmt(v.gpsAcc) + ' m') + '</b></div>'
                + '<div class="km-row"><span>Přesnost korekce</span><b>±' + fmt(v.acc) + ' m</b></div>'
                + (v.mag > 25 ? '<div class="km-stav warn"><b>Posun přes 25 m</b> — to GPS obvykle nedělá. Klepl jsi opravdu na své místo?</div>' : '')
                + (v.gps.from !== 'avg' ? '<div class="km-stav warn">Z <b>jednoho fixu</b> je korekce spíš náhodná — lepší se vrátit, postát 30–60 s a klepnout znovu.</div>' : '')
                + '<label class="km-opt"><input type="checkbox" id="agkm-live" checked> Posouvat i živou polohu (AR, navigace, vzdálenosti) — ne jen ukládané body</label>'
                + '<button type="button" class="btn btn-blue" data-a="on">Zapnout na ' + PLATI_MIN + ' min / ' + PLATI_M + ' m</button>'
                + '<button type="button" class="btn btn-secondary" data-a="zahodit">Zahodit</button>';
        } else {
            h += gpsStavHtml()
                + '<button type="button" class="btn btn-blue" data-a="pick"><svg class="icon"><use href="#i-map-pin"/></svg> Klepnout, kde stojím' + (zap ? ' (znovu)' : '') + '</button>';
        }
        body.innerHTML = h;
    }
    function open() {
        build();
        _vysledek = null;
        _ov.style.display = 'flex';
        render();
        if (_tick) clearInterval(_tick);
        _tick = setInterval(function () { if (!_ov || _ov.style.display !== 'flex' || _vysledek || _pick) return; render(); }, 3000);
    }
    function close() { if (_ov) _ov.style.display = 'none'; if (_tick) { clearInterval(_tick); _tick = null; } }

    window.AGKorekceMapa = { open: open, close: close, _test: { spocitej: spocitej, zapni: zapni, vypni: vypni, zivyPosun: zivyPosun, rawGps: rawGps, accFromZoom: accFromZoom } };
})();
