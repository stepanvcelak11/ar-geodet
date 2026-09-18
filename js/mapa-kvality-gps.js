// ===== QTRIG — MAPA KVALITY GPS: „kde se dá měřit" (ODPOJITELNÁ, lazy nástroj) ============
// (16. 9. 2026, fáze 2 „vlastní mapa" — P3; viz paměť project-vlastni-mapa-svet-vyber-16-9)
//
// Z výšek budov (OSM `height`, jinak 8 m) a lesa (15 m) z vektorové mapy spočítá pro každé
// políčko 4 × 4 m kolem mě, KOLIK OBLOHY JE VIDĚT: 16 azimutů, po každém paprsku do 60 m
// nejvyšší úhel zakrytí, pod 10° nad obzorem stejně nic (masku má i přijímač). Průměr
// otevřené oblohy 0–1 → barva: zelená (≥ 0,85, volné nebe), oranžová (0,6–0,85, půl nebe —
// měř déle), červená (< 0,6 — u zdi / mezi domy: použij offset nebo bod jinde).
//
// Je to ODHAD ze stínění, ne měření: neví o stromech mimo les, o autech ani o odrazech.
// Ale ukáže dopředu, že na severní straně dvora nemá cenu stát, a to je celé.
// Vykreslí se jako poloprůhledná vrstva v mapě (L.imageOverlay z plátna); řádek „Kvalita GPS"
// v panelu Vrstvy ji schová/ukáže, dlaždice „Kde se dá měřit" ji spočítá znovu kolem mě.
// Potřebuje zapnutou vektorovou mapu (budovy); bez ní poradí, kde ji zapnout.
// Odstranění: smaž js/mapa-kvality-gps.js, řádek v MANIFESTu js/lazy-tools.js, klíč
// 'kvalita-gps-mapa' v js/tools-registry.js a data/navody.json; gen_sw_assets --bump.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGKvalitaGpsMapa) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'mapa-kvality-gps:' + kde); } catch (e2) { /* nic */ } };
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5l2.5 2.5L21 15"/></svg>';
    var R = 110, BUNKA = 4, PX = 2, AZ = 16, DOSAH = 60, KROK = 2, MASKA = 10, LES_V = 15;
    var _overlay = null, _posledni = null, _viditelna = true;

    function poloha() { try { return (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng } : null; } catch (e) { return null; } }
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }

    // ---- překážky → rastr výšek (metry/px) ---------------------------------------------------
    function rastrVysek(stred) {
        var m = AGHrany.mPerDeg(stred.lat), n = Math.round(2 * R / PX);
        var cv = document.createElement('canvas'); cv.width = n; cv.height = n;
        var ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, n, n);
        function px(p) { return { x: (R + (p.lng - stred.lng) * m.lng) / PX, y: (R - (p.lat - stred.lat) * m.lat) / PX }; }
        function kresli(rings, h) {
            ctx.fillStyle = 'rgb(' + Math.min(255, Math.round(h)) + ',0,0)';
            ctx.beginPath();
            rings.forEach(function (ring) { ring.forEach(function (q, i) { var p = px(q); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); });
            ctx.fill('evenodd');
        }
        var nB = 0, nL = 0;
        try { (window.AGMapaVektor ? AGMapaVektor.plochy(['landcover', 'landuse'], ['forest', 'wood']) : []).forEach(function (rings) { kresli(rings, LES_V); nL++; }); } catch (e) { swallow(e, 'les'); }
        AGHrany.budovyPolygony(stred.lat, stred.lng, R + 40).forEach(function (b) { kresli(b.rings, b.vyska); nB++; });
        try { if (window.AGOkoli) AGOkoli.prekazky().forEach(function (p) { kresli(AGOkoli.prekazkaRings(p), 3); }); } catch (e) { swallow(e, 'prekazky'); }
        var data = ctx.getImageData(0, 0, n, n).data, v = new Float32Array(n * n);
        for (var i = 0; i < n * n; i++) v[i] = data[i * 4];
        return { v: v, n: n, budov: nB, lesu: nL };
    }
    // ---- viditelnost oblohy v bodě (px souřadnice) -------------------------------------------
    function obloha(r, x, y) {
        var soucet = 0;
        for (var a = 0; a < AZ; a++) {
            var ang = a * 2 * Math.PI / AZ, dx = Math.sin(ang), dy = -Math.cos(ang), maxEl = MASKA;
            for (var d = KROK; d <= DOSAH; d += KROK) {
                var xi = Math.round(x + dx * d / PX), yi = Math.round(y + dy * d / PX);
                if (xi < 0 || yi < 0 || xi >= r.n || yi >= r.n) break;
                var h = r.v[yi * r.n + xi] - 1.5; if (h <= 0) continue;
                var el = Math.atan2(h, d) * 180 / Math.PI; if (el > maxEl) maxEl = el;
            }
            soucet += (90 - maxEl) / (90 - MASKA);
        }
        return soucet / AZ;
    }
    function barva(s) { return s >= 0.85 ? 'rgba(34,197,94,0.45)' : s >= 0.6 ? 'rgba(245,158,11,0.5)' : 'rgba(239,68,68,0.55)'; }

    function spocitej(stred) {
        var t0 = Date.now(), r = rastrVysek(stred), cells = Math.round(2 * R / BUNKA);
        var cv = document.createElement('canvas'); cv.width = cells; cv.height = cells;
        var ctx = cv.getContext('2d'); var stat = { z: 0, o: 0, c: 0 };
        var mrizka = new Float32Array(cells * cells);
        for (var j = 0; j < cells; j++) for (var i = 0; i < cells; i++) {
            var x = (i + 0.5) * BUNKA / PX, y = (j + 0.5) * BUNKA / PX;
            // uvnitř budovy = neměřitelné (červená)
            var uvnitr = r.v[Math.round(y) * r.n + Math.round(x)] > 0;
            var s = uvnitr ? 0 : obloha(r, x, y);
            mrizka[j * cells + i] = s;
            if (s >= 0.85) stat.z++; else if (s >= 0.6) stat.o++; else stat.c++;
            ctx.fillStyle = barva(s); ctx.fillRect(i, j, 1, 1);
        }
        var m = AGHrany.mPerDeg(stred.lat);
        var bounds = [[stred.lat - R / m.lat, stred.lng - R / m.lng], [stred.lat + R / m.lat, stred.lng + R / m.lng]];
        _posledni = { stred: stred, bounds: bounds, url: cv.toDataURL(), mrizka: mrizka, cells: cells, stat: stat, budov: r.budov, lesu: r.lesu, ms: Date.now() - t0, ts: Date.now() };
        return _posledni;
    }
    function skoreV(lat, lng) {
        if (!_posledni) return null;
        var m = AGHrany.mPerDeg(_posledni.stred.lat);
        var i = Math.floor((R + (lng - _posledni.stred.lng) * m.lng) / BUNKA), j = Math.floor((R - (lat - _posledni.stred.lat) * m.lat) / BUNKA);
        if (i < 0 || j < 0 || i >= _posledni.cells || j >= _posledni.cells) return null;
        return _posledni.mrizka[j * _posledni.cells + i];
    }
    function vykresli() {
        var mp = getMap(); if (!mp || !_posledni) return;
        if (_overlay) { try { mp.removeLayer(_overlay); } catch (e) { /* nic */ } _overlay = null; }
        if (!_viditelna) { radek(); return; }
        _overlay = L.imageOverlay(_posledni.url, _posledni.bounds, { opacity: 1, interactive: false, className: 'ag-kvgps-overlay' }).addTo(mp);
        try { _overlay.getElement().style.imageRendering = 'pixelated'; } catch (e) { /* nic */ }
        radek();
    }
    function radek() {
        try { var row = document.getElementById('ms-kvgps'); if (row) { row.hidden = !_posledni; row.classList.toggle('ctrl-active', !!_posledni && _viditelna); } } catch (e) { /* nic */ }
        pilulka();
    }
    // PILULKA „SKRÝT" PŘÍMO V MAPĚ (17. 9. 2026, hlášení: „vrstva Kde se dá měřit ať jde i skrýt,
    // ať se mi to tam stále nezobrazuje") — řádek v panelu Vrstvy uživatel nenašel; tohle je
    // na jedno klepnutí a vidí to jen, dokud vrstva svítí. Klepnutí = schovat (znovu: dlaždice).
    function pilulka() {
        var id = 'ag-kvgps-pill', p = document.getElementById(id);
        if (!_posledni || !_viditelna) { if (p) p.remove(); return; }
        if (p) return;
        try { AG.style('ag-kvgps-pill-style', ['#' + id + '{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 14px);z-index:1200;display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;border-radius:999px;font:600 12px/1.2 var(--font-ui,system-ui),sans-serif;color:#fff;background:rgba(20,24,28,.86);border:1px solid rgba(255,255,255,.18);box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:pointer;white-space:nowrap;}',
            '#' + id + ' b{display:inline-block;width:10px;height:10px;border-radius:3px;background:linear-gradient(90deg,#22c55e,#f59e0b,#ef4444);}',
            '#' + id + ' span{padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.14);}',
            'body.ag-simple #' + id + '{display:none!important;}'].join('\n')); } catch (e) { swallow(e, 'css'); }
        p = document.createElement('button'); p.type = 'button'; p.id = id; p.setAttribute('aria-label', 'Skrýt vrstvu Kde se dá měřit');
        p.innerHTML = '<b></b>Kde se dá měřit<span>Skrýt</span>';
        p.addEventListener('click', function (ev) { ev.stopPropagation(); prepni(false); try { (window.quickToast || window.agInfo)('Vrstva schovaná. Znovu: Nástroje → Kde se dá měřit, nebo panel Vrstvy.'); } catch (e) { /* nic */ } });
        var host = document.getElementById('map-container') || document.body;
        host.appendChild(p);
    }
    function prepni(stav) { _viditelna = (stav == null) ? !_viditelna : !!stav; vykresli(); return _viditelna; }

    function otevri() {
        if (!window.AGMapaVektor || !window.AGHrany) {
            return agAlert({ title: 'Kde se dá měřit', message: 'Mapa kvality GPS potřebuje vektorovou mapu, která se v této verzi nenačetla — zkus appku znovu otevřít.' });
        }
        // Mapa vypnutá → nabídnout zapnutí rovnou tady, ne posílat do Nastavení (18. 9. 2026, N2)
        if (AGMapaVektor.stav() !== 'zapnuto') {
            if (typeof window.agConfirm !== 'function') { return agAlert({ title: 'Kde se dá měřit', message: 'Mapa kvality GPS počítá stínění z budov ve vektorové mapě. Zapni ji: Vrstvy → Podklad → Vektor.' }); }
            return agConfirm({ title: 'Kde se dá měřit', message: 'Mapa kvality GPS počítá stínění z budov ve vektorové mapě. Zapnout ji a pokračovat?', okText: 'Zapnout a pokračovat', cancelText: 'Zrušit' })
                .then(function (ano) { if (!ano) return; return AGMapaVektor.zapni().then(function (ok) { if (ok) { otevri._pokus = 0; otevri(); } else agAlert({ title: 'Kde se dá měřit', message: 'Mapa se nezapnula: ' + (AGMapaVektor.chyba() || 'neznámá chyba') + '.' }); }); });
        }
        var p = poloha() || (function () { var c = getMap().getCenter(); return { lat: c.lat, lng: c.lng }; })();
        // dlaždice s budovami mohou být ještě na cestě (po posunu mapy) — pár vteřin počkat, než počítat z prázdna
        var pokus = otevri._pokus || 0;
        if (!AGHrany.budovyPolygony(p.lat, p.lng, R).length && pokus < 8) { otevri._pokus = pokus + 1; setTimeout(otevri, 600); return; }
        otevri._pokus = 0;
        var v = spocitej(p); _viditelna = true; vykresli();
        var celkem = v.stat.z + v.stat.o + v.stat.c || 1;
        var tady = skoreV(p.lat, p.lng);
        var msg = 'Okolí ' + (2 * R) + ' × ' + (2 * R) + ' m, ' + v.budov + ' budov' + (v.lesu ? ', les' : '') + ' (' + v.ms + ' ms).<br>'
            + '<span style="color:#22c55e">■</span> volné nebe ' + Math.round(100 * v.stat.z / celkem) + ' % · <span style="color:#f59e0b">■</span> půl nebe ' + Math.round(100 * v.stat.o / celkem) + ' % · <span style="color:#ef4444">■</span> stíněno ' + Math.round(100 * v.stat.c / celkem) + ' %'
            + (tady != null ? '<br><b>Tady, kde stojíš: ' + (tady >= 0.85 ? 'volné nebe — dobré' : tady >= 0.6 ? 'půl nebe — měř déle (průměrování)' : 'stíněno — posuň se nebo použij offset') + '</b> (' + Math.round(tady * 100) + ' % oblohy)' : '')
            + '<br><small>Odhad ze stínění budov a lesa, ne měření: stromy mimo les, auta a odrazy nevidí. Schovat jde pilulkou „Skrýt" dole v mapě, nebo v panelu Vrstvy.</small>';
        if (typeof window.agConfirm === 'function') window.agConfirm({ title: 'Kde se dá měřit', message: msg, okText: 'Nechat v mapě', cancelText: 'Skrýt' }).then(function (nechat) { if (nechat === false) prepni(false); });
        else agAlert({ title: 'Kde se dá měřit', message: msg });
    }
    function agAlert(o) { try { if (typeof window.agAlert === 'function') return window.agAlert(o); } catch (e) { swallow(e, 'alert'); } try { alert(o.message.replace(/<[^>]+>/g, '')); } catch (e) { /* nic */ } }

    window.agOpenKvalitaGpsMapa = otevri;
    window.AGKvalitaGpsMapa = { otevri: otevri, spocitej: spocitej, skoreV: skoreV, prepni: prepni, posledni: function () { return _posledni; }, obloha: obloha, rastrVysek: rastrVysek };
    function register() {
        try { if (typeof window.agRegisterFieldTool === 'function') window.agRegisterFieldTool({ id: 'kvalita-gps-mapa', label: 'Kde se dá měřit', icon: ICON, cat: 'Přesné měření', onClick: otevri, order: 8 }); } catch (e) { swallow(e, 'register'); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register); else register();
})();
