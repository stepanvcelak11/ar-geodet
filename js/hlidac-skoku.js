// ===== QTRIG — HLÍDAČ SKOKŮ GPS PODLE KROKŮ (ODPOJITELNÁ, ag/lazy) ==========================
// (4. 11. 2026, výběr uživatele z návrhů „chytrých funkcí", bod 4)
//
// PROBLÉM: u budov, pod stromy a v úzkých ulicích GPS telefonu občas SKOČÍ o 8–20 m —
// a to i ve chvíli, kdy člověk udělal jediný krok nebo stojí. Šipka v mapě odskočí,
// navigace k bodu ukáže nesmysl a vzdálenosti v AR se rozjedou.
//
// ŘEŠENÍ: telefon ví, kolik kroků jsem od posledního dobrého fixu udělal (akcelerometr)
// a kam jsem šel (kompas). Z toho je jasné, kam jsem se MOHL dostat. Fix, který leží
// mnohem dál, než dovolují kroky, je skok — místo něj appka posune polohu o dopočet
// z kroků (krok × délka kroku ve směru kompasu) a přesnost poctivě zhorší.
//
// POJISTKY (ať se poloha nikdy „nezasekne" vedle):
//   • nejvýš MAX_ODMITNUTI fixů po sobě nebo MAX_MS, pak se nový fix přijme (GPS má pravdu);
//   • fix s výrazně lepší přesností se přijme vždycky;
//   • v autě / na kole (rychlost z GPS > 2,5 m/s) se nehlídá;
//   • bez pohybového čidla (žádný devicemotion) se nehlídá vůbec — appka jede jako dřív;
//   • ruční poloha z mapy a Brutální GPS (vlastní watch) se netýkají.
// Odmítnutý fix nejde ani do průměrování GPS (logika.js: `_dr`), je to odlehlá hodnota.
//
// NAPOJENÍ: js/logika.js ve watchPosition volá window.agHlidacSkoku(lat, lng, acc, speed)
// a dostane buď null (fix v pořádku), nebo {lat, lng, acc} (dopočet z kroků).
// Délka kroku se bere z nástroje „Krokový offset" / „Uvnitř budovy" (stejný klíč).
// Nastavení → AR & přesnost → „Hlídat skoky GPS podle kroků".
// Odstranění: smaž js/hlidac-skoku.js + <script> v index.html; gen_sw_assets --bump.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGHlidacSkoku) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'hlidac-skoku:' + kde); } catch (e2) { /* nic */ } };

    var KEY = 'agHlidacSkoku_v1';
    var LS_STEP = 'agPdrStepLen_v1';       // společné s js/pdr-offset.js a js/indoor.js
    var STEP_DEF = 0.75;
    var STEP_THR = 1.15, STEP_MIN_MS = 350; // detekce kroku (stejné jako krokový offset)
    var MAX_ODMITNUTI = 4, MAX_MS = 9000;
    var st = { zap: true };
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s.zap === 'boolean') st.zap = s.zap; } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }

    var _accAvg = 9.81, _lastStepTs = 0, _motionTs = 0, _motionOn = false;
    var _kroky = 0, _dE = 0, _dN = 0;      // kroky a dopočtený posun od posledního přijatého fixu
    var _posl = null;                      // poslední přijatá poloha {lat,lng,acc,ts}
    var _odm = 0, _odmOd = 0;              // počet odmítnutých fixů po sobě, čas prvního
    var _stat = { prijato: 0, odmitnuto: 0, posledniSkok: null };

    function stepLen() { try { var v = parseFloat(localStorage.getItem(LS_STEP)); if (isFinite(v) && v >= 0.4 && v <= 1.2) return v; } catch (e) { swallow(e, 'stepLen'); } return STEP_DEF; }
    function mPerDeg(lat) {
        if (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) return GeoCore.metersPerDeg(lat);
        return { lat: 111320, lng: 111320 * Math.cos(lat * Math.PI / 180) };
    }
    function smer() {
        // currentHeading = zeměpisný azimut displeje z logika.js (po fúzi gyro + kompas)
        try { if (typeof currentHeading === 'number' && isFinite(currentHeading)) return currentHeading; } catch (e) { self.AG && AG.swallow(e, 'hlidac-skoku:54'); }
        return null;
    }

    function onMotion(e) {
        var a = e.accelerationIncludingGravity; if (!a) return;
        var now = Date.now();
        _motionTs = now;
        var mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
        _accAvg = _accAvg * 0.95 + mag * 0.05;
        if (mag - _accAvg > STEP_THR && now - _lastStepTs > STEP_MIN_MS) {
            _lastStepTs = now;
            krok();
        }
    }
    function krok() {
        var L = stepLen(), h = smer();
        _kroky++;
        if (h != null) { var r = h * Math.PI / 180; _dE += L * Math.sin(r); _dN += L * Math.cos(r); }
    }
    function zapniCidlo() {
        if (_motionOn || typeof window.DeviceMotionEvent === 'undefined') return;
        try { window.addEventListener('devicemotion', onMotion); _motionOn = true; } catch (e) { swallow(e, 'motion'); }
    }
    function vypniCidlo() {
        try { window.removeEventListener('devicemotion', onMotion); } catch (e) { swallow(e, 'motionOff'); }
        _motionOn = false;
    }
    function cidloZije() { return _motionOn && _motionTs && (Date.now() - _motionTs) < 5000; }

    function prijmi(lat, lng, acc) {
        _posl = { lat: lat, lng: lng, acc: acc, ts: Date.now() };
        _kroky = 0; _dE = 0; _dN = 0; _odm = 0; _odmOd = 0;
        _stat.prijato++;
        return null;
    }

    // Hlavní filtr. Vrací null = fix je v pořádku, jinak {lat,lng,acc} = dopočet z kroků.
    function hlidej(lat, lng, acc, speed) {
        try {
            if (!st.zap || !isFinite(lat) || !isFinite(lng)) return null;
            acc = (isFinite(acc) && acc > 0) ? acc : 10;
            if (!cidloZije() || !_posl) return prijmi(lat, lng, acc);
            // auto / kolo: Dopplerova rychlost nad chůzí — otřesy v autě by se počítaly jako kroky
            if (speed != null && isFinite(speed) && speed > 2.5) return prijmi(lat, lng, acc);
            var m = mPerDeg(_posl.lat);
            var dx = (lng - _posl.lng) * m.lng, dy = (lat - _posl.lat) * m.lat;
            var skok = Math.hypot(dx, dy);
            var chuze = _kroky * stepLen();
            // kam jsem se mohl dostat: kroky (s rezervou na délku kroku) + šum fixu
            var smi = 3 + 1.4 * chuze + 0.8 * Math.min(acc, 25);
            if (skok <= smi) return prijmi(lat, lng, acc);
            // výrazně lepší fix se přijímá vždycky (GPS se chytila po výpadku)
            if (acc < 6 && acc < 0.5 * (_posl.acc || 99)) return prijmi(lat, lng, acc);
            var now = Date.now();
            if (!_odm) _odmOd = now;
            _odm++;
            if (_odm > MAX_ODMITNUTI || (now - _odmOd) > MAX_MS) {
                _stat.posledniSkok = { ts: now, m: skok, prijat: true };
                return prijmi(lat, lng, acc);   // drží se to — GPS má pravdu, já ne
            }
            _stat.odmitnuto++;
            _stat.posledniSkok = { ts: now, m: Math.round(skok * 10) / 10, kroky: _kroky, prijat: false };
            // dopočet z kroků; bez kompasu jen držet poslední polohu
            var mm = mPerDeg(_posl.lat);
            var nLat = _posl.lat + _dN / mm.lat, nLng = _posl.lng + _dE / mm.lng;
            var nAcc = Math.max(_posl.acc || acc, 2) + 0.1 * chuze;
            _posl = { lat: nLat, lng: nLng, acc: nAcc, ts: now };
            _kroky = 0; _dE = 0; _dN = 0;
            try { document.dispatchEvent(new CustomEvent('ag:skok-gps', { detail: { m: skok, acc: acc } })); } catch (e) { swallow(e, 'event'); }
            return { lat: nLat, lng: nLng, acc: nAcc, dr: true };
        } catch (e) { swallow(e, 'hlidej'); return null; }
    }

    // ---- Nastavení → AR & přesnost -------------------------------------------------------------
    function ui() {
        if (document.getElementById('s-hlidac-skoku')) return;
        var tab = document.getElementById('tab-ar'); if (!tab) return;
        var hs = tab.querySelectorAll('.set-h'), kotva = null;
        for (var i = 0; i < hs.length; i++) if (/Kompas/.test(hs[i].textContent)) { kotva = hs[i]; break; }
        var r = document.createElement('div');
        r.className = 'st-row';
        r.innerHTML = '<span class="st-lab">Hlídat skoky GPS podle kroků<small>když GPS u budovy odskočí dál, než jsi stihl dojít, poloha jde dál podle kroků a kompasu</small></span>'
            + '<label class="st-sw"><input type="checkbox" id="s-hlidac-skoku"><span class="st-sw-face"></span></label>';
        if (kotva) tab.insertBefore(r, kotva); else tab.appendChild(r);
        var cb = r.querySelector('input'); cb.checked = st.zap;
        cb.addEventListener('change', function () { nastav(cb.checked); });
    }
    function nastav(zap) {
        st.zap = !!zap; uloz();
        if (st.zap) zapniCidlo(); else { vypniCidlo(); _posl = null; }
    }
    function start() {
        try { ui(); } catch (e) { swallow(e, 'ui'); }
        document.addEventListener('click', function (ev) { try { if (ev.target && ev.target.closest && ev.target.closest('#settings-btn, [data-open="settings"]')) setTimeout(ui, 50); } catch (e) { self.AG && AG.swallow(e, 'hlidac-skoku:148'); } }, true);
        if (st.zap) zapniCidlo();
        // aplikace na pozadí: čidlo nechat spát (baterie), po návratu začít od nového fixu
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) { vypniCidlo(); _posl = null; }
            else if (st.zap) zapniCidlo();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.agHlidacSkoku = hlidej;
    window.AGHlidacSkoku = {
        hlidej: hlidej, nastav: nastav, zap: function () { return st.zap; },
        stav: function () { return { kroky: _kroky, odm: _odm, posl: _posl, cidlo: cidloZije(), stat: _stat }; },
        // pro testy: simulace kroku a čidla bez akcelerometru
        _krok: function (n) { _motionOn = true; _motionTs = Date.now(); for (var i = 0; i < (n || 1); i++) krok(); _lastStepTs = Date.now(); },
        _cidlo: function () { _motionOn = true; _motionTs = Date.now(); },
        _reset: function () { _posl = null; _kroky = 0; _dE = 0; _dN = 0; _odm = 0; _stat = { prijato: 0, odmitnuto: 0, posledniSkok: null }; }
    };
})();
