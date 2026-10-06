// ===== QTRIG — KRUH NEJISTOTY U NAVIGOVANÉHO BODU (ODPOJITELNÁ vrstva) ========
// (6. 10. 2026, hodnocení — návrh 4, vybraný uživatelem)
//
// PROČ: značka v AR i na mapě ukazuje bod jako PŘESNÉ místo, jenže telefon ho zná
// jen na ±několik metrů: poloha z GPS (±3–7 m) a v AR navíc chyba kompasu, která
// s dálkou roste (±5° na 30 m = 2,6 m napříč). Kdo kouká na jednu tečku, hledá
// mezník na jednom místě a po dvou metrech to vzdá. Tahle vrstva kolem bodu,
// ke kterému se právě naviguje, nakreslí OBLAST, kde bod nejspíš je:
//   • AR — elipsa na zemi kolem bodu (kružnice σ_bod promítnutá do kamery),
//   • mapa — přerušovaný kruh σ_GPS kolem bodu (v mapě kompas nehraje roli),
//   • HUD — pod vzdáleností řádek „hledej v okruhu ±3,8 m“; když už stojíš
//     uvnitř oblasti, řekne „jsi v oblasti — hledej kolem sebe“.
//
// VÝPOČET je TENTÝŽ jako na obrazovce „Proč ±4 m?“ (js/chybovy-rozpocet.js) —
// střední chyby (68 %), zákon hromadění chyb:
//   σ_GPS    = stř. chyba průměru z Přesné GPS (AGFix.sterr), jinak přesnost čipu
//   σ_kompas = ±1° do 30 min po srovnání severu podle bodu, jinak rozptyl kompasu
//              (AGCompassStability.spread, 1–15°), jinak ±5°
//   σ_napříč = d · sin σ_kompas,  σ_bod = √(σ_GPS² + σ_napříč²)
// Samotné vzorce jsou v ES modulu js/esm/presnost.mjs (window.AGEsm.presnost, testy
// v Node: scripts/test_esm.mjs); tady se jen sbírají vstupy ze senzorů. Obrazovka
// „Proč ±4 m?" čte senzory() odsud, je-li tenhle modul načtený.
//
// NAPOJENÍ: grafika.js volá AGNejistota.ar(...) jednou za snímek AR (za spojnicemi),
// mapu si modul obsluhuje sám (tik 1 s, jen když je mapa vidět). Vypínač je na
// obrazovce „Proč ±4 m?“ (localStorage agNejistota_v1 = {vyp: true}).
// Odstranění: smaž js/nejistota.js + řádek <script type="ag/lazy"> v index.html
// a přegeneruj sw.js; volání v grafika.js je obalené `if (window.AGNejistota)`.
// ================================================================================
(function () {
    'use strict';
    if (window.AGNejistota) return;

    var LS = 'agNejistota_v1';
    function P() { return (window.AGEsm && window.AGEsm.presnost) || null; }   // js/esm/presnost.mjs
    var BARVA = '#fbbf24';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'nejistota:' + kde); } catch (x) { /* nic */ } }
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function g(name) { try { return (0, eval)('typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined'); } catch (e) { return undefined; } }
    function num(v) { return (+v).toFixed(1).replace('.', ','); }

    function zapnuto() { try { var s = JSON.parse(localStorage.getItem(LS) || 'null'); return !(s && s.vyp); } catch (e) { return true; } }
    function zapni(v) {
        try { localStorage.setItem(LS, JSON.stringify({ vyp: !v })); } catch (e) { swallow(e, 'ls'); }
        if (!v) { uklidAR(); uklidMapu(); }
        else mapaTik();
    }

    // ---- senzory (stejné jako „Proč ±4 m?“) --------------------------------------------
    function senzory() {
        var acc = g('currentGpsAccuracy');
        var fix = window.AGFix || null;
        var gps = (acc && acc > 0) ? +acc : null;
        var prumer = null;
        if (fix && fix.n >= 2 && fix.sterr > 0 && !fix.manual && !fix.coarse) prumer = +fix.sterr;
        var cal = null;
        try { cal = JSON.parse(localStorage.getItem('agCalibInfo')); } catch (e) { cal = null; }
        var spread = null;
        try { spread = window.AGCompassStability ? window.AGCompassStability.spread : null; } catch (e) { spread = null; }
        var k = P() ? P().sigmaKompasu({ kalibraceTs: cal && cal.ts, rozptyl: spread, ted: Date.now() }) : { kompas: 5, zdroj: 'vychozi' };
        var ZDROJ = { kalibrace: 'sever srovnaný podle bodu', rozptyl: 'rozptyl kompasu za posledních pár sekund', vychozi: 'kompas telefonu bez srovnání (typicky ±5°)' };
        return { gps: gps, prumer: prumer, kompas: k.kompas, kompasZdroj: t(ZDROJ[k.zdroj]), cal: !!(cal && cal.ts) };
    }
    // σ bodu ve vzdálenosti d (m); sAR = false → jen poloha (mapa)
    function sigma(d, sAR) {
        var s = senzory();
        var gps = s.prumer != null ? s.prumer : s.gps;
        if (gps == null || !P()) return null;
        return P().sigmaBodu({ gps: gps, kompas: s.kompas, d: d || 0, sKompasem: sAR !== false });
    }
    function posun(lat, lng, r, a) { return P().posunOMetry(lat, lng, r, a); }

    // ---- AR ------------------------------------------------------------------------------
    var _svg = null, _hud = null, _last = '';
    function uklidAR() { if (_svg) _svg.innerHTML = ''; if (_hud) _hud.style.display = 'none'; _last = ''; }
    function hudRadek() {
        if (_hud && _hud.isConnected) return _hud;
        var info = document.getElementById('ar-hud-info'); if (!info) return null;
        _hud = document.createElement('div'); _hud.id = 'ag-nej-hud';
        // barva textu zůstává po HUD (na slunci má světlé pozadí, žlutá by nebyla čitelná) — žlutá je jen proužek
        _hud.style.cssText = 'font-size:calc(11.5px * var(--ag-font-scale,1));line-height:1.3;opacity:.9;margin-top:3px;padding-left:6px;border-left:3px solid ' + BARVA + ';font-weight:600;';
        info.appendChild(_hud);
        return _hud;
    }
    // o = { lat, lng, host: #ar-overlay, proj: function (lat, lng) → { x, y (%), diff, dist } } nebo null
    function ar(o) {
        if (!o || !zapnuto()) { uklidAR(); return; }
        var p0 = o.proj(o.lat, o.lng);
        var s = sigma(p0.dist, true); if (!s) { uklidAR(); return; }
        var r = s.bod;
        var uvnitr = p0.dist <= r;
        // HUD: text se mění jen s polohou / přesností, ne se snímkem kompasu
        var h = hudRadek();
        if (h) {
            var txt = uvnitr ? t('Jsi v oblasti nejistoty — hledej kolem sebe') : t('hledej v okruhu') + ' ±' + num(r) + ' m';
            if (h._t !== txt) { h.textContent = txt; h._t = txt; }
            if (h.style.display !== '') h.style.display = '';
        }
        if (!_svg || !_svg.isConnected) {
            _svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            _svg.setAttribute('viewBox', '0 0 100 100'); _svg.setAttribute('preserveAspectRatio', 'none');
            _svg.id = 'ag-nej-ar';
            _svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
            o.host.insertBefore(_svg, o.host.firstChild);
        }
        // stojí-li člověk uvnitř, elipsa by se promítla „za záda“ přes celou obrazovku
        if (uvnitr || Math.abs(p0.diff) > 70) { if (_last !== 'x') { _svg.innerHTML = ''; _last = 'x'; } return; }
        var body = [], i, a, q, pp;
        for (i = 0; i < 32; i++) {
            a = i * 360 / 32; q = posun(o.lat, o.lng, r, a); pp = o.proj(q.lat, q.lng);
            if (Math.abs(pp.diff) > 85) { if (_last !== 'x') { _svg.innerHTML = ''; _last = 'x'; } return; }
            body.push(pp.x.toFixed(2) + ',' + pp.y.toFixed(2));
        }
        var klic = body.join(' ');
        if (klic === _last) return;
        _last = klic;
        _svg.innerHTML = '<polygon points="' + klic + '" fill="' + BARVA + '" fill-opacity="0.13" stroke="' + BARVA + '" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>';
    }

    // ---- mapa ----------------------------------------------------------------------------
    var _kruh = null;
    function uklidMapu() { try { if (_kruh) _kruh.remove(); } catch (e) { swallow(e, 'mapa:remove'); } _kruh = null; }
    function mapaTik() {
        try {
            var map = g('map'), id = g('highlightedPointId'), pts = g('arPoints');
            if (!zapnuto() || !map || !window.L || id == null || !pts) { uklidMapu(); return; }
            var pt = null;
            for (var i = 0; i < pts.length; i++) if (pts[i] && pts[i].id === id) { pt = pts[i]; break; }
            if (!pt || pt.lat == null) { uklidMapu(); return; }
            var s = sigma(0, false); if (!s) { uklidMapu(); return; }
            if (!_kruh) {
                _kruh = L.circle([pt.lat, pt.lng], { radius: s.gps, color: BARVA, weight: 2, dashArray: '6 5', fillColor: BARVA, fillOpacity: 0.1, interactive: false }).addTo(map);
            } else {
                var ll = _kruh.getLatLng();
                if (ll.lat !== pt.lat || ll.lng !== pt.lng) _kruh.setLatLng([pt.lat, pt.lng]);
                if (Math.abs(_kruh.getRadius() - s.gps) > 0.05) _kruh.setRadius(s.gps);
            }
        } catch (e) { swallow(e, 'mapa'); }
    }
    setInterval(function () { if (document.visibilityState === 'visible') mapaTik(); }, 1000);

    window.AGNejistota = { ar: ar, sigma: sigma, senzory: senzory, zapnuto: zapnuto, zapni: zapni, _test: { posun: posun, mapaTik: mapaTik } };
})();
