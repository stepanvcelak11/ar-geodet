// ===== QTRIG — LOKÁLNÍ KALIBRACE NA REFERENČNÍ BOD (offline P-DGPS) =========
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu js/vylepseni.js. NEEDITUJE logika.js
// ani grafika.js — jen obaluje globální funkci za běhu a injektuje UI.
//
// VÝŠKA (15. 9. 2026 večer, přání: „udělej tu opravu výšky na nivelačním bodě taky a
// zakompletuj ji do nástroje, kde se už opravuje poloha; niveláky mají Y a X s přesností
// na metr, což je pořád přesnější než GPS v mobilu; polohové či trigonometrické můžou
// mít výšku — pokud ji mají, opravuje se i výška"): má-li referenční bod výšku Bpv,
// spočítá se i svislý posun dh = H(bod) − (výška GPS − N + výška telefonu nad značkou)
// a přičítá se k výšce nově ukládaných bodů z GPS průměru. Nivelační body jsou v
// nabídce (poloha ±1 m je lepší než telefon) a dávají hlavně výšku. Odchylku geoidu N
// bere getGeoidUndulation z logika.js (zpřesněná nejbližším bodem ČÚZK v ETRS89).
// Kartu bodu: window.agRefCalibrateFromPoint(pt) = totéž jedním klepnutím.
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
    // DGPS ŽIVĚ (js/dgps.js, src 'dgps-live') má jiné meze: korekce se obnovuje každou
    // minutu, takže stáří = „základna neposílá" (6 min), a platí do ~3 km od základny.
    function limity(s) {
        if (s && s.src === 'dgps-live') return { warnAge: 3 * 60000, maxAge: 6 * 60000, warnDist: 2000, maxDist: 3000 };
        return { warnAge: WARN_AGE_MS, maxAge: MAX_AGE_MS, warnDist: WARN_DIST_M, maxDist: MAX_DIST_M };   // WARN_* níž u hlídače (volá se až za běhu)
    }
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
                    window.agRefShift = { dlat: +o.dlat, dlng: +o.dlng, t: o.t || 0, acc: o.acc, on: !!o.on, lat: (isFinite(o.lat) ? +o.lat : null), lng: (isFinite(o.lng) ? +o.lng : null), src: (o.src === 'hrana' || o.src === 'dgps-live' ? o.src : undefined), mode: o.mode, base: o.base, code: o.code };   // src: kdo korekci vyrobil (js/kalibrace-hranou.js) — pilulka podle toho otevírá správný nástroj
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
        try { if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && isFinite(gpsAvgResult.lat) && isFinite(gpsAvgResult.lng)) return { lat: gpsAvgResult.lat, lng: gpsAvgResult.lng, n: gpsAvgResult.n, sterr: gpsAvgResult.sterr, from: 'avg', alt: (isFinite(gpsAvgResult.alt) ? gpsAvgResult.alt : null), altSterr: (isFinite(gpsAvgResult.altSterr) ? gpsAvgResult.altSterr : null), altN: gpsAvgResult.altN || 0 }; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:avgGps'); }
        try { if (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null) return { lat: userLat, lng: userLng, n: 1, sterr: (typeof currentGpsAccuracy !== 'undefined' ? currentGpsAccuracy : null), alt: ((typeof userAlt !== 'undefined' && isFinite(userAlt)) ? userAlt : null), altSterr: null, altN: 1, from: 'fix' }; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:avgGps'); }
        return null;
    }
    // Výška Bpv z GPS: elipsoidická výška − odchylka geoidu (getGeoidUndulation z logika.js
    // je zpřesněná bodem ČÚZK v ETRS89; bez ní vzorec ±1–2 m — tady je to jedno, protože
    // stejné N se použije i při ukládání bodu a v rozdílu se vykrátí).
    function gpsBpv(a) {
        if (!a || a.alt == null || !isFinite(a.alt)) return null;
        try { if (typeof getGeoidUndulation === 'function') return a.alt - getGeoidUndulation(a.lat, a.lng); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:gpsBpv'); }
        try { if (window.GeoCore && GeoCore.geoidUndulation) return a.alt - GeoCore.geoidUndulation(a.lat, a.lng); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:gpsBpv2'); }
        return null;
    }
    // Výška bodu (Bpv): vlastní bod pt.vyska, úřední bod pole VYSKA z ČÚZK (0.00 = bez výšky).
    function ptH(p) {
        if (!p) return null;
        if (p.vyska != null && isFinite(p.vyska) && p.vyska > 50 && p.vyska < 3000) return Number(p.vyska);
        try {
            var r = p.rawData; if (!r) return null;
            for (var k in r) {
                if (['VYSKA', 'VYSKA_BPV', 'H_BPV', 'NADMORSKA_VYSKA'].indexOf(String(k).toUpperCase()) < 0) continue;
                var v = parseFloat(String(r[k]).replace(',', '.'));
                if (isFinite(v) && v > 50 && v < 3000) return v;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:ptH'); }
        return null;
    }
    function fmtH(dh) { return (dh >= 0 ? '+' : '−') + (Math.abs(dh) < 1 ? Math.round(Math.abs(dh) * 100) + ' cm' : Math.abs(dh).toFixed(2).replace('.', ',') + ' m'); }
    function customPts() {
        try { if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) return persistentCustomPoints; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:customPts'); }
        return [];
    }
    // ÚŘEDNÍ body bodového pole (TB/ZhB/PBPP) — přesně to, na co si člověk stoupne.
    // Dřív tu nabídka byla jen z VLASTNÍCH bodů a souřadnice úředního bodu se musely
    // přepisovat ručně z karty bodu, což je osm číslic a překlep se pozná až podle
    // divného posunu. Bere je js/bodove-pole.js (i z offline cache); když ta vrstva
    // v sestavě není, sáhne se rovnou do arPoints. Nivelační body jsou v nabídce
    // od 15. 9. 2026: jejich Y/X (±1 m, souřadnice se v ČÚZK udávají na metr) je pořád
    // lepší než telefon, a hlavně nesou výšku Bpv na milimetry — posun výšky.
    function officialPts() {
        try {
            if (window.AGBodovePole && typeof AGBodovePole.points === 'function') {
                return AGBodovePole.points().filter(function (p) { return !!p; });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:officialPts'); }
        try {
            if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                return arPoints.filter(function (p) { return p && p.cat && p.cat !== 'CUSTOM' && isFinite(p.lat) && isFinite(p.lng); });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:officialPts'); }
        return [];
    }
    // Nejbližší napřed — v nabídce mají být body, na kterých člověk zrovna stojí,
    // ne prvních čtyřicet v pořadí stažení. Vrací VŽDY [{p, d}] (d smí být null),
    // ať se volající nemusí ptát, jestli zrovna byla GPS.
    var PICK_MAX = 40;
    function byDistance(arr) {
        var la = null, ln = null;
        try {
            la = (typeof userLat !== 'undefined') ? userLat : null;
            ln = (typeof userLng !== 'undefined') ? userLng : null;
        } catch (e) { la = null; ln = null; }
        var withD = arr.map(function (p) {
            var d = null;
            if (la != null && ln != null && typeof getDistance === 'function') {
                try { var v = getDistance(la, ln, p.lat, p.lng); if (v != null && isFinite(v)) d = v; } catch (e) { d = null; }
            }
            return { p: p, d: d };
        });
        if (la != null && ln != null) {
            withD.sort(function (a, b) { return (a.d == null ? Infinity : a.d) - (b.d == null ? Infinity : b.d); });
        }
        return withD.slice(0, PICK_MAX);
    }
    function fmtDist(d) {
        if (d == null || !isFinite(d)) return '';
        return d < 1000 ? (' · ' + Math.round(d) + ' m') : (' · ' + (d / 1000).toFixed(1) + ' km');
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
                p.refShift = { dlat: s.dlat, dlng: s.dlng, t: s.t, src: s.src || 'ref' };   // src: kdo korekci vyrobil (karta důvěry bodu, js/duvera.js)
                // VÝŠKA: jen bod z GPS průměru (origin gps-avg) s výškou z GPS — ne výška
                // přepsaná z DMR 5G (js/vyska-gps.js hlásí window._agZSrc = 'dmr') ani
                // ručně zadaná / z papíru (origin ruc).
                try {
                    var _o = p.prov && p.prov.origin;
                    if (s.dh != null && isFinite(s.dh) && typeof p.vyska === 'number' && isFinite(p.vyska) && _o === 'gps-avg' && window._agZSrc !== 'dmr') {
                        p.vyska = Math.round((p.vyska + s.dh) * 100) / 100;
                        p.refShift.dh = s.dh;
                    }
                } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:wrapped:dh'); }

                // EXPIRACE: konstantní posun platí jen krátce a blízko ref. bodu. Mimo meze
                // varuj (posun neblokujeme — uživatel může vědět, co dělá).
                try {
                    var ageMin = s.t ? (Date.now() - s.t) / 60000 : null;
                    var farM = (isFinite(s.lat) && isFinite(s.lng)) ? planarDist(s.lat, s.lng, p.lat, p.lng) : null;
                    var lim = limity(s);
                    if ((ageMin != null && ageMin > lim.maxAge / 60000) || (farM != null && farM > lim.maxDist)) {
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
                        if (tw) { tw.lat = p.lat; tw.lng = p.lng; if (p.refShift && p.refShift.dh != null) tw.vyska = p.vyska; if (tw.element) { tw.element.remove(); tw.element = null; } }
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
        _ov.id = 'agref-modal'; _ov.setAttribute('data-ag-needs', 'gps'); /* js/power-save.js: senzory neuspávat, dokud je okno vidět */
        _ov.innerHTML =
            '<div class="modal-content agref-content" role="dialog" aria-modal="true">' +
            '  <h3 class="agref-title"><svg class="icon"><use href="#i-crosshair"/></svg> Posun GPS na známý bod</h3>' +
            '  <div class="modal-body agref-body">' +
            '    <div id="agref-state" class="agref-state"></div>' +
            '    <div class="agref-note">Stůj na <b>známém bodě</b> a chvíli počkej na ustálení průměru GPS. Zadej jeho souřadnice (nebo vyber z uložených). Má-li bod <b>výšku Bpv</b> (nivelační, řada TB/ZhB), opraví se i <b>výška</b> — telefon polož na značku, nebo napiš, o kolik ho držíš výš. Posun se pak přičítá k <b>nově</b> ukládaným bodům — místní korekce systematické chyby GPS, ne RTK. Stávající body zůstanou beze změny.</div>' +
            '    <label class="agref-lbl">Vybrat z uložených bodů</label>' +
            '    <select id="agref-select"><option value="">— ruční zadání níže —</option></select>' +
            '    <label class="agref-lbl">Název / číslo bodu (jen popis)</label>' +
            '    <input type="text" id="agref-name" placeholder="Např. PBPP 241">' +
            '    <label class="agref-lbl">S-JTSK Y (m)</label>' +
            '    <input type="text" id="agref-y" step="any" inputmode="decimal" placeholder="Např. 596956.46">' +
            '    <label class="agref-lbl">S-JTSK X (m)</label>' +
            '    <input type="text" id="agref-x" step="any" inputmode="decimal" placeholder="Např. 1163343.34">' +
            '    <div class="agref-row2 agref-hrow">' +
            '      <div><label class="agref-lbl">Výška Bpv bodu (m) — nepovinné</label>' +
            '      <input type="text" id="agref-h" step="any" inputmode="decimal" placeholder="Např. 348.412"></div>' +
            '      <div><label class="agref-lbl">Telefon nad značkou (m)</label>' +
            '      <input type="text" id="agref-hp" step="any" inputmode="decimal" value="0" placeholder="0 = leží na značce"></div>' +
            '    </div>' +
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

    // Nabídka bodů. DVĚ skupiny: úřední body bodového pole (na ty se v terénu
    // stoupá) a vlastní uložené body. `_pick` je plochý seznam, do kterého <option>
    // ukazuje indexem — díky tomu je jedno, ze které skupiny bod je.
    var _pick = [];
    function fillSelect() {
        var sel = _ov && _ov.querySelector('#agref-select');
        if (!sel) return;
        _pick = [];
        sel.innerHTML = '';
        var o0 = document.createElement('option');
        o0.value = ''; o0.textContent = '— ruční zadání níže —';
        sel.appendChild(o0);

        function addGroup(label, rows, tag) {
            if (!rows.length) return;
            var g = document.createElement('optgroup');
            g.label = label;
            rows.forEach(function (r) {
                var p = r.p;
                if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
                var o = document.createElement('option');
                o.value = String(_pick.length);
                o.textContent = (p.name || 'Bod') + (tag ? ' · ' + tag(p) : '') + fmtDist(r.d);
                _pick.push(p);
                g.appendChild(o);
            });
            if (g.children.length) sel.appendChild(g);
        }

        addGroup('Body bodového pole (ČÚZK)', byDistance(officialPts()), function (p) {
            return (p.cat === 'TB' ? 'TB' : (p.cat === 'ZHB' ? 'ZhB' : (p.cat === 'NIVEL' ? 'nivelační' : 'PBPP'))) + (ptH(p) != null ? ' · H' : '');
        });
        addGroup('Moje body', byDistance(customPts().filter(function (p) {
            return p && typeof p.lat === 'number' && typeof p.lng === 'number';
        })), null);
    }

    function onSelect() {
        var sel = _ov.querySelector('#agref-select');
        var i = parseInt(sel.value, 10);
        if (isNaN(i)) return;
        var p = _pick[i];
        if (!p) return;
        // Převod přes GeoCore (jeden zdroj pravdy o pořadí os Y/X), proj4 je záloha.
        var Y = null, X = null;
        try {
            if (window.GeoCore && GeoCore.toSJTSK) {
                var r = GeoCore.toSJTSK(p.lat, p.lng);
                if (r && isFinite(r.y) && isFinite(r.x)) { Y = Math.abs(r.y); X = Math.abs(r.x); }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:onSelect'); }
        try {
            if (Y == null && typeof proj4 === 'function') {
                var sj = proj4('EPSG:4326', 'EPSG:5514', [p.lng, p.lat]); // [Y, X] (záporné v Křováku)
                Y = Math.abs(sj[0]); X = Math.abs(sj[1]);
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:onSelect'); }
        if (Y != null && X != null) {
            _ov.querySelector('#agref-y').value = Y.toFixed(2);
            _ov.querySelector('#agref-x').value = X.toFixed(2);
        }
        _ov.querySelector('#agref-name').value = p.name || '';
        var H = ptH(p);
        _ov.querySelector('#agref-h').value = (H != null) ? H.toFixed(3) : '';
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
                st.innerHTML = '<b>Kalibrace aktivní</b> · posun ~' + escapeHtml(fmtShift(s)) + (s.dh != null && isFinite(s.dh) ? ' · výška ' + escapeHtml(fmtH(s.dh)) : '') + (when ? '<br><span class="agref-dim">nastaveno ' + escapeHtml(when) + '</span>' : '');
            } else {
                st.className = 'agref-state off';
                st.innerHTML = 'Kalibrace <b>vypnutá</b> · uložený posun ~' + escapeHtml(fmtShift(s)) + (s.dh != null && isFinite(s.dh) ? ' · výška ' + escapeHtml(fmtH(s.dh)) : '') + (when ? '<br><span class="agref-dim">nastaveno ' + escapeHtml(when) + '</span>' : '');
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
        var hb = gpsBpv(a);
        g.innerHTML = 'Aktuální GPS: <b>' + a.lat.toFixed(6) + ', ' + a.lng.toFixed(6) + '</b><br><span class="agref-dim">' + escapeHtml(src) + '</span>'
            + '<br>Výška Bpv z GPS: <b>' + (hb != null ? hb.toFixed(2).replace('.', ',') + ' m' : '—') + '</b>'
            + (hb != null && isFinite(a.altSterr) ? ' <span class="agref-dim">±' + a.altSterr.toFixed(2) + ' m' + (a.altN ? ', ' + a.altN + '×' : '') + '</span>' : (hb == null ? ' <span class="agref-dim">telefon výšku nehlásí</span>' : ''));
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

        var refH = parseFloat(String(_ov.querySelector('#agref-h').value).replace(',', '.'));
        var hp = parseFloat(String(_ov.querySelector('#agref-hp').value).replace(',', '.'));
        zapni(a, refLat, refLng, (isFinite(refH) ? refH : null), (isFinite(hp) ? hp : 0), _ov.querySelector('#agref-name').value, 'ref', function () { renderState(); });
    }

    // Společné jádro pro dialog i pro tlačítko v kartě bodu: spočítá posun polohy
    // (a výšky, když bod výšku má a telefon ji hlásí), zkontroluje nesmysly, uloží.
    function zapni(a, refLat, refLng, refH, hp, name, src, po) {
        var dlat = refLat - a.lat;
        var dlng = refLng - a.lng;
        var s = { dlat: dlat, dlng: dlng, t: Date.now(), acc: (isFinite(a.sterr) ? a.sterr : null), on: true, lat: a.lat, lng: a.lng, src: src || 'ref', ref: name || null };
        var hb = gpsBpv(a), dh = null;
        if (refH != null && isFinite(refH) && hb != null) {
            // telefon je hp nad značkou → výška značky podle GPS = hb − hp
            dh = refH - (hb - (isFinite(hp) ? hp : 0));
            s.dh = Math.round(dh * 1000) / 1000; s.refH = refH; s.hp = (isFinite(hp) ? hp : 0); s.altAcc = (isFinite(a.altSterr) ? a.altSterr : null);
        }
        var dist = fmtShift(s);
        var vTxt = (s.dh != null) ? ' Výška: <b>' + escapeHtml(fmtH(s.dh)) + '</b> (bod ' + refH.toFixed(2).replace('.', ',') + ' m, GPS ' + hb.toFixed(2).replace('.', ',') + ' m' + (s.hp ? ', telefon ' + s.hp.toFixed(2).replace('.', ',') + ' m nad značkou' : '') + ').'
            : (refH != null && hb == null ? ' <b>Výška se neopravuje</b> — telefon výšku z GPS nehlásí (síťová poloha?).' : (refH == null ? ' Bod nemá výšku, opravuje se jen poloha.' : ''));

        // bezpečnostní brzda na nesmyslně velký posun (špatně zadané souřadnice / jiný kat. systém)
        var cm = shiftCm(s, a.lat);
        var doSave = function () { saveShift(s); if (po) po(); window.agRefShiftWatch && window.agRefShiftWatch(); alertBox('Kalibrace zapnuta', 'Posun GPS ~<b>' + escapeHtml(dist) + '</b> se teď přičítá k <b>nově</b> ukládaným bodům.' + vTxt + ' Existující body zůstaly beze změny. Můžeš ji kdykoli vypnout.'); };
        if (s.dh != null && Math.abs(s.dh) > 30) {
            confirmBox('Velký posun výšky (' + fmtH(s.dh) + ')', 'Výška z GPS se od výšky bodu liší o <b>' + escapeHtml(fmtH(s.dh)) + '</b>. Tolik telefon obvykle nelže — spíš je výška bodu v jiném systému, nebo GPS hlásí nesmysl. Opravdu zapnout i s výškou?', 'Zapnout i s výškou', 'Bez výšky')
                .then(function (ok) { if (!ok) { delete s.dh; delete s.refH; delete s.hp; delete s.altAcc; vTxt = ' Výška se neopravuje (zamítnuto).'; } if (cm != null && cm > 5000) velky(); else doSave(); });
            return;
        }
        function velky() {
            confirmBox('Velký posun (' + dist + ')', 'Spočítaný posun je <b>' + escapeHtml(dist) + '</b> — to je hodně. Bývá to známka špatně zadaných souřadnic nebo jiného souřadnicového systému. Opravdu zapnout?', 'Přesto zapnout', 'Zpět', true)
                .then(function (ok) { if (ok) doSave(); });
        }
        if (cm != null && cm > 5000) velky(); else doSave();
    }

    // KARTA BODU (15. 9. 2026 večer, přání: „v kartě bodu tlačítko opravit GPS o souřadnice
    // bodu, abych to nemusel hledat v nástrojích — čtvereček, upozornění, že musím být
    // na tom bodě"). Jedno potvrzení s tím, co se spočítá, pak totéž, co dialog.
    function fromPoint(pt) {
        if (!pt || !isFinite(pt.lat) || !isFinite(pt.lng)) { alertBox('Bod nemá polohu', 'Tenhle bod nemá souřadnice, podle kterých by se GPS dala opravit.'); return; }
        var a = avgGps();
        if (!a) { alertBox('Není GPS poloha', 'Počkej na zaměření GPS a zkus to znovu.'); return; }
        var H = ptH(pt), hb = gpsBpv(a);
        var d = null;
        try { d = planarDist(a.lat, a.lng, pt.lat, pt.lng); } catch (e) { d = null; }
        var nm = pt.name || 'bod';
        var msg = '<b>Musíš stát přímo na bodě ' + escapeHtml(nm) + '.</b> Appka vezme svou GPS polohu' + (a.from === 'avg' ? ' (průměr z ' + (a.n || '?') + ' měření' + (isFinite(a.sterr) ? ', ±' + a.sterr.toFixed(2) + ' m' : '') + ')' : ' (jeden fix — lepší chvíli postát, ať se zprůměruje)')
            + ' a rozdíl proti souřadnicím bodu bude od teď přičítat k nově ukládaným bodům.'
            + (d != null ? '<br><br>Teď jsi podle GPS <b>' + (d < 100 ? d.toFixed(1).replace('.', ',') + ' m' : Math.round(d) + ' m') + '</b> od bodu' + (d > 30 ? ' — <b>to je moc</b>, buď na něm nestojíš, nebo GPS teď hodně lže.' : '.') : '')
            + (H != null ? '<br><br>Bod má výšku <b>' + H.toFixed(2).replace('.', ',') + ' m</b> Bpv' + (hb != null ? ' — opraví se i <b>výška</b>. <b>Polož telefon na značku</b> (nebo ho drž u ní); GPS teď hlásí ' + hb.toFixed(2).replace('.', ',') + ' m.' : ', ale telefon výšku z GPS nehlásí — opraví se jen poloha.') : '<br><br>Bod nemá výšku — opraví se jen poloha.')
            + (pt.cat === 'NIVEL' ? '<br><br><span style="opacity:.8">Nivelační bod: poloha je v ČÚZK jen na metr, výška na milimetry.</span>' : '');
        confirmBox('Opravit GPS podle bodu ' + nm, msg, 'Stojím na něm, opravit', 'Zpět').then(function (ok) {
            if (!ok) return;
            zapni(avgGps() || a, pt.lat, pt.lng, H, 0, nm, 'ref', function () { if (_ov && _ov.style.display === 'flex') renderState(); });
        });
    }
    window.agRefCalibrateFromPoint = fromPoint;

    function toggle() {
        var s = loadShift();
        if (!s || !isFinite(s.dlat)) { alertBox('Není co přepnout', 'Nejdřív kalibraci nastav (zadej referenční bod a klepni na „Spočítat a zapnout").'); return; }
        s.on = !s.on;
        window.agRefShiftWatch && setTimeout(window.agRefShiftWatch, 50); saveShift(s);
        renderState();
    }

    // open(prefill?) — `prefill` {name, Y, X} posílá js/bodove-pole.js, když si
    // uživatel vybral konkrétní bod bodového pole. Ušetří přepisování osmi číslic,
    // při kterém stačí jeden překlep a posun vyjde o kilometry vedle.
    function open(prefill) {
        build();
        fillSelect();
        renderState();
        renderGps();
        if (prefill && isFinite(prefill.Y) && isFinite(prefill.X)) {
            _ov.querySelector('#agref-y').value = Number(prefill.Y).toFixed(2);
            _ov.querySelector('#agref-x').value = Number(prefill.X).toFixed(2);
            _ov.querySelector('#agref-name').value = prefill.name || '';
            _ov.querySelector('#agref-h').value = (prefill.H != null && isFinite(prefill.H)) ? Number(prefill.H).toFixed(3) : '';
            var sel = _ov.querySelector('#agref-select'); if (sel) sel.value = '';
        }
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
    // HLÍDAČ PLATNOSTI KOREKCE (15. 9. 2026, uživatel: „upozornění, že za chvilku vyprší
    // čas nebo se blíží hranice vzdálenosti, ať o tom člověk víc ví").
    // Dřív se člověk o vypršení dozvěděl až toastem PŘI UKLÁDÁNÍ bodu — tedy až když
    // bylo pozdě. Teď se korekce hlídá průběžně (každých 15 s) a stav je pořád vidět:
    //   • pilulka pod horním HUD: „Korekce GPS 1,8 m · ještě 12 min · 80 m od místa"
    //     zelená = platí, oranžová = blíží se hranice (≥ 15 min nebo ≥ 200 m),
    //     červená = za hranicí (≥ 20 min nebo ≥ 300 m); klepnutí otevře nástroj,
    //     který korekci vyrobil (chůze po hraně / posun na známý bod), × pilulku schová
    //   • toast při KAŽDÉM přechodu stavu (jen jednou na jednu korekci): „vyprší za
    //     5 min", „vypršela", „jsi 200 m od místa", „jsi za hranicí 300 m"
    // Proč se korekce sama NEVYPÍNÁ: geodet může vědět, že chyba GPS je dnes stabilní
    // (klidná ionosféra) — rozhodnutí je jeho, appka jen říká, že už za to neručí.
    // Korekci sdílí js/kalibrace-hranou.js (src:'hrana') i tenhle modul.
    // --------------------------------------------------------------------------------
    var PILL_ID = 'agref-pill';
    var WARN_AGE_MS = 15 * 60 * 1000;   // „vyprší za 5 min"
    var WARN_DIST_M = 200;              // „blížíš se k hranici 300 m"
    var _watchTimer = null, _fired = {}, _pillHidden = null;
    function pillCss() {
        if (!window.AG || !AG.style) return;
        AG.style('agref-pill-style', [
            '#' + PILL_ID + '{position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 44px);z-index:11990;display:none;',
            '  align-items:center;gap:7px;padding:5px 8px 5px 12px;border-radius:999px;font:600 12px/1.2 var(--font-ui,system-ui),sans-serif;color:#fff;',
            '  border:1px solid rgba(255,255,255,.22);box-shadow:0 4px 16px rgba(0,0,0,.45);max-width:88vw;background:rgba(20,83,45,.92);cursor:pointer;}',
            '#' + PILL_ID + '.show{display:flex;}',
            '#' + PILL_ID + '.warn{background:rgba(146,94,7,.92);}',
            '#' + PILL_ID + '.bad{background:rgba(140,28,28,.94);}',
            '#' + PILL_ID + ' .x{appearance:none;-webkit-appearance:none;border:0;background:rgba(255,255,255,.18);color:#fff;width:22px;height:22px;border-radius:50%;flex:0 0 22px;font:700 14px/22px var(--font-ui,system-ui),sans-serif;padding:0;cursor:pointer;text-align:center;}',
            // pruh js/gps-trust.js sedí na stejném místě — když svítí, uhni pod něj
            'body.ag-fix-stale #' + PILL_ID + ',body.ag-fix-lost #' + PILL_ID + ',body.ag-net-off #' + PILL_ID + '{top:calc(env(safe-area-inset-top,0px) + 84px);}',
            // AR na celou obrazovku / jednoduchý režim: pilulka nesmí překážet hledáčku
            'body.ag-simple #' + PILL_ID + '{display:none!important;}'
        ].join('\n'));
    }
    function ensurePill() {
        var p = document.getElementById(PILL_ID);
        if (p) return p;
        pillCss();
        p = document.createElement('div');
        p.id = PILL_ID; p.setAttribute('role', 'status');
        p.innerHTML = '<span class="txt"></span><button type="button" class="x" aria-label="Schovat">×</button>';
        p.addEventListener('click', function (e) {
            if (e.target && e.target.classList.contains('x')) { var s = loadShift(); _pillHidden = s ? s.t : true; p.classList.remove('show'); return; }
            var s2 = loadShift();
            if (s2 && s2.src === 'hrana' && window.AGLazyTools && typeof AGLazyTools.open === 'function') AGLazyTools.open('kalibrace-hranou');
            else if (s2 && s2.src === 'dgps-live' && window.AGLazyTools && typeof AGLazyTools.open === 'function') AGLazyTools.open('dgps');
            else open();
        });
        document.body.appendChild(p);
        return p;
    }
    // Vrátí stav korekce pro pilulku i pro okna nástrojů: {age (min), dist (m|null),
    // zbyva (min), stav 'ok'|'warn'|'bad', text}. window.agRefShiftStav() pro ostatní moduly.
    function shiftStatus() {
        var s = loadShift();
        if (!s || !s.on || !isFinite(s.dlat) || !isFinite(s.dlng)) return null;
        var now = Date.now(), age = s.t ? (now - s.t) / 60000 : null;
        var dist = null;
        try {
            if (isFinite(s.lat) && isFinite(s.lng) && typeof userLat === 'number' && typeof userLng === 'number' && isFinite(userLat)) dist = planarDist(s.lat, s.lng, userLat, userLng);
        } catch (e) { dist = null; }
        var lim = limity(s), live = s.src === 'dgps-live', stav = 'ok';
        if ((age != null && age >= lim.warnAge / 60000) || (dist != null && dist >= lim.warnDist)) stav = 'warn';
        if ((age != null && age >= lim.maxAge / 60000) || (dist != null && dist >= lim.maxDist)) stav = 'bad';
        var zbyva = age != null ? Math.max(0, Math.round(lim.maxAge / 60000 - age)) : null;
        var parts = [(live ? 'DGPS živě' + (s.base ? ' (' + s.base + ')' : '') + ' ' : 'Korekce GPS ') + fmtShift(s) + (s.dh != null && isFinite(s.dh) ? ' / výška ' + fmtH(s.dh) : '')];
        if (live) { if (age != null) parts.push(age < 1.5 ? 'data čerstvá' : 'data stará ' + Math.round(age) + ' min'); }
        else if (age != null) parts.push(zbyva > 0 ? 'ještě ' + zbyva + ' min' : 'starší než ' + Math.round(lim.maxAge / 60000) + ' min');
        if (dist != null) parts.push((dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km') + (live ? ' od základny' : ' od místa') + (dist >= lim.maxDist ? ' (za hranicí ' + (lim.maxDist < 1000 ? lim.maxDist + ' m' : (lim.maxDist / 1000) + ' km') + ')' : ''));
        return { s: s, age: age, dist: dist, zbyva: zbyva, stav: stav, live: live, text: parts.join(' · '), maxMin: lim.maxAge / 60000, maxM: lim.maxDist, warnMin: lim.warnAge / 60000, warnM: lim.warnDist };
    }
    window.agRefShiftStav = shiftStatus;
    function watchTick() {
        var st = shiftStatus();
        var p = document.getElementById(PILL_ID);
        if (!st) { if (p) p.classList.remove('show'); _fired = {}; _pillHidden = null; return; }
        var key = String(st.s.t || 0);
        if (!_fired[key]) { _fired = {}; _fired[key] = {}; }
        var f = _fired[key];
        // toasty — každý stupeň jen jednou na jednu korekci
        function once(k, msg) { if (f[k]) return; f[k] = true; toastSafe(msg); }
        if (st.live) {
            if (st.age != null && st.age >= st.maxMin) once('age2', 'Základna DGPS neposlala nic už ' + Math.round(st.age) + ' min — stojí, nebo nemá signál. Korekce pro nové body už není spolehlivá.');
            else if (st.age != null && st.age >= st.warnMin) once('age1', 'Základna DGPS neposílá ' + Math.round(st.age) + ' min — zkontroluj ji (displej, signál).');
            if (st.dist != null && st.dist >= st.maxM) once('dist2', 'Jsi ' + (st.dist / 1000).toFixed(1) + ' km od základny DGPS — dál než ' + (st.maxM / 1000) + ' km korekce neplatí.');
            else if (st.dist != null && st.dist >= st.warnM) once('dist1', 'Jsi ' + (st.dist / 1000).toFixed(1) + ' km od základny DGPS — na ' + (st.maxM / 1000) + ' km korekce přestane platit.');
        } else {
            if (st.age != null && st.age >= st.maxMin) once('age2', 'Korekce GPS je starší než ' + st.maxMin + ' min — chyba GPS se mezitím mohla změnit, za posun už appka neručí. Projdi hranu / změř známý bod znovu, nebo korekci vypni.');
            else if (st.age != null && st.age >= st.warnMin) once('age1', 'Korekce GPS vyprší za ' + Math.max(1, st.zbyva) + ' min. Budeš-li ještě měřit, obnov ji včas (chůze po hraně / známý bod).');
            if (st.dist != null && st.dist >= st.maxM) once('dist2', 'Jsi ' + Math.round(st.dist) + ' m od místa kalibrace — za hranicí ' + st.maxM + ' m posun nemusí platit. Zkalibruj znovu tady.');
            else if (st.dist != null && st.dist >= st.warnM) once('dist1', 'Jsi ' + Math.round(st.dist) + ' m od místa kalibrace — na ' + st.maxM + ' m korekce přestane platit.');
        }
        // pilulka
        if (_pillHidden === st.s.t) return;
        p = ensurePill();
        p.className = 'show ' + (st.stav === 'ok' ? '' : st.stav);
        p.querySelector('.txt').textContent = st.text;
    }
    function startWatch() {
        if (_watchTimer) return;
        _watchTimer = setInterval(function () { try { watchTick(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:watch'); } }, 15000);
        setTimeout(function () { try { watchTick(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:watch0'); } }, 2500);
    }
    window.agRefShiftWatch = function () { try { watchTick(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ref-calibration:watchNow'); } };

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
        try { startWatch(); } catch (e) { console.warn('[ref-calibration] watch', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    window.addEventListener('load', function () { setTimeout(init, 350); });
})();
