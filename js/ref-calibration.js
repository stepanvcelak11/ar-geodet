// ===== AR Geodet — LOKÁLNÍ KALIBRACE NA REFERENČNÍ BOD (offline P-DGPS) =========
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu js/vylepseni.js. NEEDITUJE logika.js
// ani grafika.js — jen obaluje globální funkci za běhu a injektuje UI.
//
// Princip (opt-in): uživatel stojí na ZNÁMÉM bodě, zadá jeho S-JTSK Y,X (nebo WGS84)
// nebo ho vybere z uložených bodů. Vezmeme aktuální PRŮMĚROVANOU GPS (gpsAvgResult,
// fallback userLat/userLng) a spočítáme konstantní posun (dlat,dlng) = reference − GPS.
// Posun se uloží do window.agRefShift = {dlat,dlng,t,acc,on:true} a od té chvíle se
// přičítá k NOVĚ ukládaným vlastním bodům (obalený saveCustomPoint), dokud je on=true.
// Je to lokální korekce systematického posunu GPS na malém území (pár stovek metrů) —
// NE plnohodnotné RTK. Existující body se NEPŘEPISUJÍ.
//
// Odstranění vrstvy: smaž js/ref-calibration.js + css/ref-calibration.css a oba řádky
// se značkou "KALIBRACE" v index.html (a cesty v sw.js). Aplikace pak funguje jako dřív.
// ================================================================================
(function () {
    'use strict';

    var LS_KEY = 'agRefShift';
    var EARTH_M_LAT = 111320; // zaloha, kdyz chybi geo-core.js (~0,15 % chyba)
    // Metru na stupen bere z GeoCore (skutecne polomery krivosti elipsoidu).
    // Stejny vzor uz pouziva js/localization-helmert.js.
    function mPerDeg(lat) {
        if (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) {
            try { var m = GeoCore.metersPerDeg(lat); if (m && m.lat) return m; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:mPerDeg'); }
        }
        return { lat: EARTH_M_LAT, lng: EARTH_M_LAT * Math.cos(lat * Math.PI / 180) };
    }
    // Platnost lokální kalibrace: konstantní posun GPS platí jen krátce a blízko ref. bodu
    // (systematika GPS se mění s časem i polohou). Mimo tyto meze posun varovně označíme.
    var MAX_AGE_MS = 20 * 60 * 1000;   // 20 min
    var MAX_DIST_M = 300;              // 300 m
    function planarDist(lat1, lng1, lat2, lng2) {
        var m = mPerDeg((lat1 + lat2) / 2);
        return Math.hypot((lng2 - lng1) * m.lng, (lat2 - lat1) * m.lat);
    }
    function toastSafe(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:toastSafe'); } }

    // --------------------------------------------------------------------------------
    // Stav: window.agRefShift {dlat,dlng,t,acc,on}
    // --------------------------------------------------------------------------------
    function loadShift() {
        try {
            if (window.agRefShift && typeof window.agRefShift === 'object') return window.agRefShift;
            var raw = localStorage.getItem(LS_KEY);
            if (raw) {
                var o = JSON.parse(raw);
                if (o && isFinite(o.dlat) && isFinite(o.dlng)) {
                    window.agRefShift = { dlat: +o.dlat, dlng: +o.dlng, t: o.t || 0, acc: o.acc, on: !!o.on, lat: (isFinite(o.lat) ? +o.lat : null), lng: (isFinite(o.lng) ? +o.lng : null) };
                    return window.agRefShift;
                }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:loadShift'); }
        window.agRefShift = window.agRefShift || null;
        return window.agRefShift;
    }
    function saveShift(s) {
        window.agRefShift = s;
        try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:saveShift'); }
    }

    // Velikost posunu v cm (pro popisky) — počítáno v rovinné aproximaci kolem dané šířky.
    function shiftCm(s, atLat) {
        try {
            var lat = (typeof atLat === 'number' && isFinite(atLat)) ? atLat : 49.8;
            var m = mPerDeg(lat);
            var dx = s.dlng * m.lng, dy = s.dlat * m.lat;
            return Math.round(Math.hypot(dx, dy) * 100);
        } catch (e) { return null; }
    }
    function fmtShift(s) {
        var cm = shiftCm(s);
        if (cm == null) return '';
        return cm < 100 ? (cm + ' cm') : ((cm / 100).toFixed(2) + ' m');
    }

    // --------------------------------------------------------------------------------
    // Dialogy: použij agAlert/agConfirm/agPrompt z vylepseni.js, jinak fallback
    // --------------------------------------------------------------------------------
    function alertBox(title, msg) {
        if (typeof window.agAlert === 'function') return window.agAlert({ title: title, message: msg });
        try { agInfo((title ? title + '\n\n' : '') + String(msg).replace(/<[^>]+>/g, '')); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:alertBox'); }
        return Promise.resolve(true);
    }
    function confirmBox(title, msg, okText, cancelText, danger) {
        if (typeof window.agConfirm === 'function') return window.agConfirm({ title: title, message: msg, okText: okText, cancelText: cancelText, danger: !!danger });
        try { return Promise.resolve(window.confirm((title ? title + '\n\n' : '') + String(msg).replace(/<[^>]+>/g, ''))); } catch (e) { return Promise.resolve(false); }
    }

    // --------------------------------------------------------------------------------
    // Čtení živých globálů (fail-silent, přesně jako vylepseni.js)
    // --------------------------------------------------------------------------------
    function avgGps() {
        try { if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && isFinite(gpsAvgResult.lat) && isFinite(gpsAvgResult.lng)) return { lat: gpsAvgResult.lat, lng: gpsAvgResult.lng, n: gpsAvgResult.n, sterr: gpsAvgResult.sterr, from: 'avg' }; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:avgGps'); }
        try { if (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null) return { lat: userLat, lng: userLng, n: 1, sterr: (typeof currentGpsAccuracy !== 'undefined' ? currentGpsAccuracy : null), from: 'fix' }; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:avgGps'); }
        return null;
    }
    function customPts() {
        try { if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) return persistentCustomPoints; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:customPts'); }
        return [];
    }
    function escapeHtml(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    // S-JTSK Y,X (kladné, v metrech) -> WGS84. Stejné chování jako sjtskToLatLng v logika.js;
    // pokud je v aplikaci, použij přímo ji (jeden zdroj pravdy), jinak fallback přes proj4.
    function sjtskToWgs(Y, X) {
        try {
            if (typeof sjtskToLatLng === 'function') { var r = sjtskToLatLng(Y, X); if (r && isFinite(r.lat) && isFinite(r.lng)) return r; }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:sjtskToWgs'); }
        try {
            if (typeof proj4 !== 'function') return null;
            var y = Math.min(Math.abs(Y), Math.abs(X)), x = Math.max(Math.abs(Y), Math.abs(X));
            var w = proj4('EPSG:5514', 'EPSG:4326', [-y, -x]);
            return { lat: w[1], lng: w[0] };
        } catch (e) { return null; }
    }

    // --------------------------------------------------------------------------------
    // OBALENÍ saveCustomPoint — na NOVĚ uložené body přičti posun, jen když je on=true.
    //   - editace stávajícího bodu se NEMĚNÍ (editingCustomPointId je tehdy nastavené)
    //   - posun aplikujeme až PO původní funkci, na poslední vložený bod (idempotentně)
    //   - existující body NEPŘEPISUJEME (děláme jen nový poslední prvek)
    // --------------------------------------------------------------------------------
    function wrapSave() {
        if (typeof window.saveCustomPoint !== 'function' || window.saveCustomPoint._agRefWrapped) return;
        var orig = window.saveCustomPoint;
        var wrapped = function () {
            // byla to editace? (rozhoduje stav PŘED voláním originálu)
            var wasEditing = false;
            try { wasEditing = (typeof editingCustomPointId !== 'undefined') && !!editingCustomPointId; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:wrapped'); }
            var before = customPts().length;

            var ret = orig.apply(this, arguments);

            try {
                var s = window.agRefShift;
                if (!s || !s.on || wasEditing) return ret;
                var arr = customPts();
                if (!arr.length || arr.length <= before) return ret; // nepřibyl nový bod
                var p = arr[arr.length - 1];
                if (!p || p._agRefShifted) return ret;             // idempotence
                if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return ret;

                p.lat += s.dlat;
                p.lng += s.dlng;
                p._agRefShifted = true;
                p.refShift = { dlat: s.dlat, dlng: s.dlng, t: s.t };

                // EXPIRACE: konstantní posun platí jen krátce a blízko ref. bodu. Mimo meze
                // varuj (posun neblokujeme — uživatel může vědět, co dělá).
                try {
                    var ageMin = s.t ? (Date.now() - s.t) / 60000 : null;
                    var farM = (isFinite(s.lat) && isFinite(s.lng)) ? planarDist(s.lat, s.lng, p.lat, p.lng) : null;
                    if ((ageMin != null && ageMin > MAX_AGE_MS / 60000) || (farM != null && farM > MAX_DIST_M)) {
                        var det = [];
                        if (ageMin != null) det.push(Math.round(ageMin) + ' min');
                        if (farM != null) det.push(Math.round(farM) + ' m od ref. bodu');
                        toastSafe('⚠ Ref-kalibrace zastaralá/daleko (' + det.join(', ') + ') — přesnost posunu klesá, změř referenční bod znovu.');
                    }
                } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:wrapped'); }

                // zrcadlo v arPoints (twin se stejným id), pokud existuje
                try {
                    if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                        var tw = arPoints.find(function (q) { return q.id === p.id; });
                        if (tw) { tw.lat = p.lat; tw.lng = p.lng; if (tw.element) { tw.element.remove(); tw.element = null; } }
                    }
                } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:wrapped'); }

                // znovu ulož + překresli (původní funkce už jednou uložila, my jen aktualizujeme)
                try { if (typeof setStoredData === 'function') setStoredData('arCustomPoints12', JSON.stringify(arr)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:wrapped'); }
                try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:wrapped'); }
                try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:wrapped'); }
            } catch (e) { console.warn('[ref-calibration] save wrap', e); }
            return ret;
        };
        wrapped._agRefWrapped = true;
        wrapped._agOrig = orig;
        window.saveCustomPoint = wrapped;
    }

    // --------------------------------------------------------------------------------
    // UI — modální průvodce kalibrací
    // --------------------------------------------------------------------------------
    var _ov = null;

    function build() {
        if (_ov && document.body.contains(_ov)) return _ov;
        _ov = document.createElement('div');
        _ov.className = 'modal-overlay agref-overlay';
        _ov.id = 'agref-modal';
        _ov.innerHTML =
            '<div class="modal-content agref-content" role="dialog" aria-modal="true">' +
            '  <h3 class="agref-title"><svg class="icon"><use href="#i-crosshair"/></svg> Posun GPS na známý bod</h3>' +
            '  <div class="modal-body agref-body">' +
            '    <div id="agref-state" class="agref-state"></div>' +
            '    <div class="agref-note">Stůj na <b>známém bodě</b> a chvíli počkej na ustálení průměru GPS. Zadej jeho souřadnice (nebo vyber z uložených). Posun se pak přičítá k <b>nově</b> ukládaným bodům — místní korekce systematické chyby GPS, ne RTK. Stávající body zůstanou beze změny.</div>' +
            '    <label class="agref-lbl">Vybrat z uložených bodů</label>' +
            '    <select id="agref-select"><option value="">— ruční zadání níže —</option></select>' +
            '    <label class="agref-lbl">Název / číslo bodu (jen popis)</label>' +
            '    <input type="text" id="agref-name" placeholder="Např. PBPP 241">' +
            '    <label class="agref-lbl">S-JTSK Y (m)</label>' +
            '    <input type="text" id="agref-y" step="any" inputmode="decimal" placeholder="Např. 596956.46">' +
            '    <label class="agref-lbl">S-JTSK X (m)</label>' +
            '    <input type="text" id="agref-x" step="any" inputmode="decimal" placeholder="Např. 1163343.34">' +
            '    <div id="agref-gps" class="agref-gps"></div>' +
            '  </div>' +
            '  <button type="button" class="btn btn-primary" id="agref-apply"><svg class="icon"><use href="#i-crosshair"/></svg> Spočítat a zapnout kalibraci</button>' +
            '  <div class="agref-row2">' +
            '    <button type="button" class="btn btn-secondary" id="agref-toggle">Vypnout</button>' +
            '    <button type="button" class="btn btn-secondary" id="agref-close">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(_ov);

        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov) close(); });
        _ov.querySelector('#agref-close').addEventListener('click', close);
        _ov.querySelector('#agref-apply').addEventListener('click', apply);
        _ov.querySelector('#agref-toggle').addEventListener('click', toggle);
        _ov.querySelector('#agref-select').addEventListener('change', onSelect);
        return _ov;
    }

    function fillSelect() {
        var sel = _ov && _ov.querySelector('#agref-select');
        if (!sel) return;
        var pts = customPts();
        sel.innerHTML = '<option value="">— ruční zadání níže —</option>';
        pts.forEach(function (p, i) {
            if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
            var o = document.createElement('option');
            o.value = String(i);
            o.textContent = (p.name || 'Bod') + ' (#' + (i + 1) + ')';
            sel.appendChild(o);
        });
    }

    function onSelect() {
        var sel = _ov.querySelector('#agref-select');
        var i = parseInt(sel.value, 10);
        if (isNaN(i)) return;
        var p = customPts()[i];
        if (!p) return;
        try {
            if (typeof proj4 === 'function') {
                var sj = proj4('EPSG:4326', 'EPSG:5514', [p.lng, p.lat]); // [Y, X] (záporné v Křováku)
                _ov.querySelector('#agref-y').value = Math.abs(sj[0]).toFixed(2);
                _ov.querySelector('#agref-x').value = Math.abs(sj[1]).toFixed(2);
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:onSelect'); }
        _ov.querySelector('#agref-name').value = p.name || '';
    }

    function renderState() {
        var st = _ov && _ov.querySelector('#agref-state');
        var tgl = _ov && _ov.querySelector('#agref-toggle');
        if (!st) return;
        var s = loadShift();
        if (s && isFinite(s.dlat) && isFinite(s.dlng)) {
            var when = s.t ? new Date(s.t).toLocaleString('cs-CZ') : '';
            if (s.on) {
                st.className = 'agref-state on';
                st.innerHTML = '<b>Kalibrace aktivní</b> · posun ~' + escapeHtml(fmtShift(s)) + (when ? '<br><span class="agref-dim">nastaveno ' + escapeHtml(when) + '</span>' : '');
            } else {
                st.className = 'agref-state off';
                st.innerHTML = 'Kalibrace <b>vypnutá</b> · uložený posun ~' + escapeHtml(fmtShift(s)) + (when ? '<br><span class="agref-dim">nastaveno ' + escapeHtml(when) + '</span>' : '');
            }
            if (tgl) tgl.textContent = s.on ? 'Vypnout' : 'Zapnout';
        } else {
            st.className = 'agref-state none';
            st.innerHTML = 'Kalibrace zatím <b>nenastavena</b>.';
            if (tgl) tgl.textContent = 'Vypnout';
        }
        renderGps();
    }

    function renderGps() {
        var g = _ov && _ov.querySelector('#agref-gps');
        if (!g) return;
        var a = avgGps();
        if (!a) { g.innerHTML = '<span class="agref-dim">Čekám na GPS polohu…</span>'; return; }
        var src = a.from === 'avg' ? ('průměr z ' + (a.n || '?') + ' měření' + (isFinite(a.sterr) ? ' · ±' + a.sterr.toFixed(2) + ' m' : '')) : ('jeden fix' + (isFinite(a.sterr) ? ' · ±' + a.sterr.toFixed(1) + ' m' : ''));
        g.innerHTML = 'Aktuální GPS: <b>' + a.lat.toFixed(6) + ', ' + a.lng.toFixed(6) + '</b><br><span class="agref-dim">' + escapeHtml(src) + '</span>';
    }

    function apply() {
        var a = avgGps();
        if (!a) { alertBox('Není GPS poloha', 'Počkej na zaměření GPS a zkus to znovu.'); return; }

        // reference: nejdřív Y/X (S-JTSK), pak prázdno
        var Yv = _ov.querySelector('#agref-y').value;
        var Xv = _ov.querySelector('#agref-x').value;
        var refLat = null, refLng = null;
        var Y = parseFloat(String(Yv).replace(',', '.'));
        var X = parseFloat(String(Xv).replace(',', '.'));
        if (isFinite(Y) && isFinite(X)) {
            var w = sjtskToWgs(Y, X);
            if (!w) { alertBox('Převod selhal', 'Souřadnice S-JTSK se nepodařilo převést. Zkontroluj hodnoty.'); return; }
            refLat = w.lat; refLng = w.lng;
        } else {
            alertBox('Chybí souřadnice', 'Zadej S-JTSK Y a X referenčního bodu (nebo ho vyber z uložených).');
            return;
        }

        var dlat = refLat - a.lat;
        var dlng = refLng - a.lng;
        var s = { dlat: dlat, dlng: dlng, t: Date.now(), acc: (isFinite(a.sterr) ? a.sterr : null), on: true, lat: a.lat, lng: a.lng };
        var dist = fmtShift(s);

        // bezpečnostní brzda na nesmyslně velký posun (špatně zadané souřadnice / jiný kat. systém)
        var cm = shiftCm(s, a.lat);
        var doSave = function () { saveShift(s); renderState(); alertBox('Kalibrace zapnuta', 'Posun GPS ~<b>' + escapeHtml(dist) + '</b> se teď přičítá k <b>nově</b> ukládaným bodům. Existující body zůstaly beze změny. Můžeš ji kdykoli vypnout.'); };
        if (cm != null && cm > 5000) {
            confirmBox('Velký posun (' + dist + ')', 'Spočítaný posun je <b>' + escapeHtml(dist) + '</b> — to je hodně. Bývá to známka špatně zadaných souřadnic nebo jiného souřadnicového systému. Opravdu zapnout?', 'Přesto zapnout', 'Zpět', true)
                .then(function (ok) { if (ok) doSave(); });
        } else {
            doSave();
        }
    }

    function toggle() {
        var s = loadShift();
        if (!s || !isFinite(s.dlat)) { alertBox('Není co přepnout', 'Nejdřív kalibraci nastav (zadej referenční bod a klepni na „Spočítat a zapnout").'); return; }
        s.on = !s.on;
        saveShift(s);
        renderState();
    }

    function open() {
        build();
        fillSelect();
        renderState();
        renderGps();
        _ov.style.display = 'flex';
        if (_gpsTimer) clearInterval(_gpsTimer);
        _gpsTimer = setInterval(renderGps, 1000);
    }
    function close() {
        if (_gpsTimer) { clearInterval(_gpsTimer); _gpsTimer = null; }
        if (_ov) _ov.style.display = 'none';
    }
    var _gpsTimer = null;
    window.openRefCalibration = open;

    // --------------------------------------------------------------------------------
    // Vstup: dlaždice v „Nástroje" (kategorie Pomůcky, vedle „Srovnat sever").
    // Boční menu „Více" je jen nouzový fallback, když field-tools.js chybí.
    // --------------------------------------------------------------------------------
    function injectMenuButton() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'ref-calibration', label: 'Posun GPS na známý bod', icon: '<svg class="icon"><use href="#i-crosshair"/></svg>', cat: 'AR a kalibrace', onClick: open, order: 70 });
            var stale = document.getElementById('agref-launch'); if (stale) stale.remove();
            return;
        }
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('agref-launch')) return;
        // Vkládáme do scrollovací části, ať položka scrolluje a dole zůstává pevné jen „Zavřít".
        var host = menu.querySelector('.menu-scroll') || menu;
        var btn = document.createElement('button');
        btn.id = 'agref-launch';
        btn.className = 'menu-btn';
        btn.type = 'button';
        btn.innerHTML = '<svg class="icon"><use href="#i-crosshair"/></svg> Kalibrace na ref. bod';
        btn.addEventListener('click', function () {
            try { if (typeof toggleMenu === 'function') toggleMenu(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:injectMenuButton'); }
            open();
        });
        // vlož před tlačítko "O aplikaci", ať destruktivní/informační akce zůstanou dole
        var about = host.querySelector('button[onclick*="openAbout"]');
        if (about) host.insertBefore(btn, about); else host.appendChild(btn);
    }

    // --------------------------------------------------------------------------------
    // Init — DOMContentLoaded i window load (prvky/funkce vznikají později)
    // --------------------------------------------------------------------------------
    function init() {
        try { loadShift(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:init'); }
        try { wrapSave(); } catch (e) { console.warn('[ref-calibration] wrapSave', e); }
        try { injectMenuButton(); } catch (e) { console.warn('[ref-calibration] menu', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    window.addEventListener('load', function () { setTimeout(init, 350); });
})();
