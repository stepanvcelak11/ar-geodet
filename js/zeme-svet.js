// ===== QTRIG — SVĚT MIMO ČR: data k registru zemí (ODPOJITELNÁ, ag/lazy) ==========
// (16. 9. 2026, fáze 1 „měření mimo ČR"; jádro je js/sour-zeme.js, tohle jsou data a UI)
//
// TŘI VĚCI, KTERÉ V ČR NIKDO NEPOSTRÁDAL A V ZAHRANIČÍ BEZ NICH APPKA LŽE:
//   1. GEOID — data/egm2008.bin (Evropa 5' + svět 1°, int16 cm, ~740 kB, stahuje se
//      jednou a leží ve stabilní DICT_CACHE). AGGeoid.N(lat,lng) = undulace EGM2008
//      bilineárně. Dřívější lineární vzorec (geo-core.js) sedí v Praze na 0,1 m, ale
//      v Brně je 1,7 m vedle a v rozích ČR 3–8 m — takže je to oprava i doma.
//   2. DEKLINACE — World Magnetic Model 2025 (koeficienty js/wmm2025-koef.js, NOAA).
//      Kompas telefonu měří magnetický sever; appka azimuty počítá k zeměpisnému.
//      Lineární fit pro ČR (≈ 5–6°) je ve Španělsku 6° vedle, ve Finsku 5° na druhou
//      stranu — AR by značky kreslila mimo obraz.
//   3. HRANICE — data/zeme-hranice.json (Natural Earth 50 m zjednodušené na ~1 km):
//      bez signálu appka pozná, ve které zemi stojím, a přepne souřadnice i výšky.
//      U hranic je 1 km málo, proto Nastavení → Data → „Země měření" (ruční volba).
//
// GeoCore.declination / geoidUndulation se na AGWmm / AGGeoid ptají za běhu — dokud
// data nejsou, jede se jako dřív (vzorce pro ČR). Nic tu neblokuje start.
//
// Odstranění: smaž js/zeme-svet.js + js/wmm2025-koef.js + jejich <script> v index.html,
// data/egm2008.bin, data/zeme-hranice.json; python scripts/gen_sw_assets.py --bump.
// ==================================================================================
(function () {
    'use strict';
    if (window.AGGeoid) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'zeme-svet:' + kde); } catch (e2) { /* nic */ } };
    var D2R = Math.PI / 180;

    // ---- 1. GEOID EGM2008 -----------------------------------------------------------
    var G = { hdr: null, eu: null, svet: null, stav: 'ne' };   // stav: ne | tahne | ok | chyba
    function grid(b, lat, lng) {
        // bilineár v mřížce; řádek 0 = b.lat0 (sever), sloupec 0 = b.lon0; hodnoty v cm
        var fy = (b.lat0 - lat) / b.step, fx = (lng - b.lon0) / b.step;
        if (fy < 0 || fx < 0 || fy > b.rows - 1 || fx > b.cols - 1) return null;
        var y0 = Math.min(b.rows - 2, Math.floor(fy)), x0 = Math.min(b.cols - 2, Math.floor(fx));
        var dy = fy - y0, dx = fx - x0, a = b.data, W = b.cols;
        var v00 = a[y0 * W + x0], v01 = a[y0 * W + x0 + 1], v10 = a[(y0 + 1) * W + x0], v11 = a[(y0 + 1) * W + x0 + 1];
        return ((v00 * (1 - dx) + v01 * dx) * (1 - dy) + (v10 * (1 - dx) + v11 * dx) * dy) / 100;
    }
    function N(lat, lng) {
        if (G.stav !== 'ok' || lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return null;
        var v = grid(G.eu, lat, lng);
        if (v == null) { var l = ((lng % 360) + 360) % 360; v = grid(G.svet, lat, l); }
        return v;
    }
    function nactiZBufferu(ab) {
        var u8 = new Uint8Array(ab), nl = u8.indexOf(10);
        if (nl < 0) throw new Error('egm2008.bin: chybí hlavička');
        var hdr = JSON.parse(String.fromCharCode.apply(null, u8.subarray(0, nl)));
        var off = nl + 1;
        function blok(h) { var n = h.rows * h.cols; var d = new Int16Array(n); var dv = new DataView(ab, off, n * 2); for (var i = 0; i < n; i++) d[i] = dv.getInt16(i * 2, true); off += n * 2; return { lat0: h.lat0, lon0: h.lon0, step: h.step, rows: h.rows, cols: h.cols, data: d }; }
        G.eu = blok(hdr.eu); G.svet = blok(hdr.svet); G.hdr = hdr; G.stav = 'ok';
        try { document.dispatchEvent(new CustomEvent('ag:geoid')); } catch (e) { swallow(e, 'event'); }
    }
    function tahni() {
        if (G.stav !== 'ne' || typeof fetch !== 'function') return;
        G.stav = 'tahne';
        fetch('data/egm2008.bin').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
            .then(nactiZBufferu)
            .catch(function (e) { G.stav = 'chyba'; swallow(e, 'fetch'); setTimeout(function () { G.stav = 'ne'; }, 60000); });   // bez signálu: zkusit za minutu
    }
    window.AGGeoid = { N: N, nacteno: function () { return G.stav === 'ok'; }, stav: function () { return G.stav; }, nactiZBufferu: nactiZBufferu, tahni: tahni };

    // ---- 2. DEKLINACE — WMM2025 ---------------------------------------------------------
    // Sférická harmonická syntéza do stupně 12 (algoritmus z technické zprávy WMM, NOAA):
    // geodetická → sférická šířka, Schmidtovy kvazinormované Legendreovy funkce z
    // nenormovaných rekurencí + normovací faktor, X'/Y'/Z' a rotace zpět do geodetické.
    var W = null;   // připravené koeficienty
    function pripravWmm() {
        var K = window.AGWmmKoef; if (!K || !K.k) return null;
        var g = [], h = [], dg = [], dh = [], nmax = 0;
        K.k.forEach(function (r) { var n = r[0], m = r[1]; if (!g[n]) { g[n] = []; h[n] = []; dg[n] = []; dh[n] = []; } g[n][m] = r[2]; h[n][m] = r[3]; dg[n][m] = r[4]; dh[n][m] = r[5]; if (n > nmax) nmax = n; });
        // Schmidtův faktor sqrt((2−δ_m0)(n−m)!/(n+m)!)
        var fakt = [1]; for (var i = 1; i <= 2 * nmax; i++) fakt[i] = fakt[i - 1] * i;
        var S = [];
        for (var n = 0; n <= nmax; n++) { S[n] = []; for (var m = 0; m <= n; m++) S[n][m] = Math.sqrt((m === 0 ? 1 : 2) * fakt[n - m] / fakt[n + m]); }
        return { g: g, h: h, dg: dg, dh: dh, nmax: nmax, S: S, epocha: K.epocha };
    }
    function deklinace(lat, lng, vyskaM, datum) {
        if (!W) W = pripravWmm(); if (!W) return null;
        var d = datum || new Date();
        var rok = d.getFullYear() + (d.getMonth() + (d.getDate() - 1) / 31) / 12;
        var dt = rok - W.epocha;
        var fi = lat * D2R, la = lng * D2R, hKm = (vyskaM || 0) / 1000;
        var A = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f), RE = 6371.2;
        var sf = Math.sin(fi), cf = Math.cos(fi);
        var Rc = A / Math.sqrt(1 - e2 * sf * sf);
        var p = (Rc + hKm) * cf, z = (Rc * (1 - e2) + hKm) * sf;
        var r = Math.sqrt(p * p + z * z), fis = Math.asin(z / r);
        var x = Math.sin(fis), s = Math.cos(fis);
        if (Math.abs(s) < 1e-9) s = 1e-9;
        var nmax = W.nmax, P = [], dP = [];
        for (var n = 0; n <= nmax; n++) { P[n] = []; dP[n] = []; }
        P[0][0] = 1; dP[0][0] = 0;
        for (var m = 0; m <= nmax; m++) {
            if (m > 0) P[m][m] = (2 * m - 1) * s * P[m - 1][m - 1];
            if (m + 1 <= nmax) P[m + 1][m] = (2 * m + 1) * x * P[m][m];
            for (var nn = m + 2; nn <= nmax; nn++) P[nn][m] = ((2 * nn - 1) * x * P[nn - 1][m] - (nn + m - 1) * P[nn - 2][m]) / (nn - m);
        }
        // dP/dφ' = −(n x P_n^m − (n+m) P_{n−1}^m) / cosφ'   (z (x²−1) dP/dx = n x P − (n+m) P_{n−1})
        for (var n2 = 1; n2 <= nmax; n2++) for (var m2 = 0; m2 <= n2; m2++) { var pm = (n2 - 1 >= m2) ? P[n2 - 1][m2] : 0; dP[n2][m2] = -(n2 * x * P[n2][m2] - (n2 + m2) * pm) / s; }
        var X = 0, Y = 0, Z = 0, ar = RE / r, arn = ar * ar;
        var cm = [], sm = []; for (var mm = 0; mm <= nmax; mm++) { cm[mm] = Math.cos(mm * la); sm[mm] = Math.sin(mm * la); }
        for (var n3 = 1; n3 <= nmax; n3++) {
            arn *= ar;
            var sx = 0, sy = 0, sz = 0;
            for (var m3 = 0; m3 <= n3; m3++) {
                var gg = W.g[n3][m3] + dt * W.dg[n3][m3], hh = W.h[n3][m3] + dt * W.dh[n3][m3];
                var Sc = W.S[n3][m3], pp = Sc * P[n3][m3], dpp = Sc * dP[n3][m3];
                var gc = gg * cm[m3] + hh * sm[m3];
                sx += gc * dpp; sz += gc * pp; sy += m3 * (gg * sm[m3] - hh * cm[m3]) * pp;
            }
            X -= arn * sx; Y += arn * sy / s; Z -= (n3 + 1) * arn * sz;
        }
        var df = fis - fi, Xg = X * Math.cos(df) - Z * Math.sin(df);
        return Math.atan2(Y, Xg) / D2R;
    }
    window.AGWmm = { deklinace: deklinace, pripraveno: function () { return !!(window.AGWmmKoef && AGWmmKoef.k); } };

    // ---- 3. HRANICE ZEMÍ ----------------------------------------------------------------
    function tahniHranice() {
        if (!window.AGSour || AGSour.maHranice() || typeof fetch !== 'function') return;
        fetch('data/zeme-hranice.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (j) { AGSour.hranice(j); })
            .catch(function (e) { swallow(e, 'hranice'); });
    }

    // ---- 4. NASTAVENÍ → Data → „Země měření" -----------------------------------------
    function popisStavu() {
        try {
            var p = AGSour.popisky();
            var s = p.system + ' (' + p.osaA + ', ' + p.osaB + ') · výšky ' + p.vyska + (p.vyskaNejista ? ' (±0,5 m)' : '');
            if (AGSour.rezim() === 'auto') s = p.zemeNazev + ' · ' + s;
            var pp = AGSour.poslPoloha();
            if (pp && window.AGWmm) { var dk = deklinace(pp.lat, pp.lng, 0); if (dk != null) s += ' · deklinace ' + (dk >= 0 ? '+' : '') + dk.toFixed(1) + '°'; }
            return s;
        } catch (e) { swallow(e, 'popis'); return ''; }
    }
    function ui() {
        if (document.getElementById('s-zeme')) return;
        var tab = document.getElementById('tab-data'); if (!tab || !window.AGSour) return;
        var kotva = null; var hs = tab.querySelectorAll('.set-h');
        for (var i = 0; i < hs.length; i++) if (/Úřední body/.test(hs[i].textContent)) { kotva = hs[i]; break; }
        var h = document.createElement('div'); h.className = 'set-h'; h.textContent = 'Země a souřadnice';
        var row = document.createElement('div');
        row.innerHTML = '<label>Země měření<small id="s-zeme-info" style="display:block; font-weight:400; color:var(--text-muted);"></small></label><select id="s-zeme" class="st-sel"></select>';
        var sel = row.querySelector('select');
        var op = document.createElement('option'); op.value = 'auto'; op.textContent = 'Automaticky (podle GPS)'; sel.appendChild(op);
        var kody = Object.keys(AGSour.ZEME).sort(function (a, b) { return AGSour.ZEME[a].nazev.localeCompare(AGSour.ZEME[b].nazev, 'cs'); });
        kody.forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = AGSour.ZEME[k].nazev; sel.appendChild(o); });
        var ox = document.createElement('option'); ox.value = 'XX'; ox.textContent = 'Jinde (UTM)'; sel.appendChild(ox);
        sel.value = AGSour.rezim();
        sel.addEventListener('change', function () { AGSour.nastav(sel.value); obnov(); });
        var pozn = document.createElement('div'); pozn.className = 'st-note'; pozn.id = 's-zeme-pozn';
        pozn.style.cssText = 'font-size:calc(12px * var(--ag-font-scale,1));opacity:.7;margin:-4px 2px 8px;';
        pozn.textContent = 'U hranic přepni zemi ručně — obrysy jsou přesné na ~1 km. Souřadnice ČÚZK, RÚIAN a VFK zůstávají v S-JTSK vždy.';
        // (18. 9. 2026 noc) co appka v té zemi umí — úřední body jen CZ/SK/CH/NL, katastr a ortofoto po zemích;
        // stejná karta, jaká naskočí sama po startu v cizině (js/zdroje-zemi.js uvod)
        var co = document.createElement('div'); co.className = 'st-note'; co.id = 's-zeme-co';
        co.style.cssText = 'font-size:calc(12px * var(--ag-font-scale,1));opacity:.85;margin:-2px 2px 8px;';
        co.innerHTML = '<span></span> <button type="button" class="btn btn-secondary" style="display:inline-block;width:auto;margin:6px 0 0;padding:7px 12px;font-size:calc(12.5px * var(--ag-font-scale,1));"></button>';   // .ag-btn-mini neexistovala → tlačítko bez stylu (18. 9. 2026 noc)
        co.querySelector('span').textContent = 'Úřední body zveřejňují jako data jen Česko, Slovensko, Švýcarsko a Nizozemsko; jinde jsou v mapě jen tvoje body.';
        var coBtn = co.querySelector('button'); coBtn.textContent = 'Co tu appka umí';
        coBtn.addEventListener('click', function () {
            var k = sel.value === 'auto' ? AGSour.kod() : sel.value;
            if (k === 'CZ' || k === 'XX') { try { (window.quickToast || window.agInfo)(k === 'CZ' ? 'V Česku je všechno: body ČÚZK, katastr RÚIAN, ortofoto ČÚZK.' : 'Mimo evidované země: souřadnice UTM, ortofoto Esri, bez katastru a bez úředních bodů.'); } catch (e) { /* nic */ } return; }
            var go = function () { try { AGZdroje.uvod(k, true); } catch (e) { /* nic */ } };
            if (window.AGZdroje) go(); else if (window.AGLazy && AGLazy.need) AGLazy.need('js/zdroje-zemi.js', go);
        });
        // SIMULACE CIZÍ ZEMĚ (17. 9. 2026, přání: „abych mohl otestovat, jak to funguje u nich"):
        // vybranou zemi zapne ručně a postaví mě (ruční poloha z js/poloha-z-mapy.js) do jejího
        // hlavního města — souřadnice, výšky, katastr a mapa se přepnou jako v terénu. Zpět = GPS.
        var sim = document.createElement('div'); sim.className = 'st-row'; sim.id = 's-zeme-sim';
        sim.innerHTML = '<span class="st-lab">Simulace: postav mě do vybrané země<small>ruční poloha v hlavním městě země ze seznamu výš (Automaticky = Česko); zruší se sama po 25 m chůze, nebo tlačítkem</small></span><button type="button" class="btn btn-secondary" id="s-zeme-sim-btn">Vyzkoušet</button>';
        sim.querySelector('button').addEventListener('click', function () { simulace(sel.value); });
        if (kotva) { tab.insertBefore(h, kotva); tab.insertBefore(row, kotva); tab.insertBefore(pozn, kotva); tab.insertBefore(sim, kotva); }
        else { tab.appendChild(h); tab.appendChild(row); tab.appendChild(pozn); tab.appendChild(co); tab.appendChild(sim); }
        obnov();
    }
    var MESTA = { CZ: [50.0875, 14.4213, 'Praha'], SK: [48.1486, 17.1077, 'Bratislava'], PL: [52.2297, 21.0122, 'Varšava'], DE: [52.5200, 13.4050, 'Berlín'], AT: [48.2082, 16.3738, 'Vídeň'], HU: [47.4979, 19.0402, 'Budapešť'], SI: [46.0569, 14.5058, 'Lublaň'], HR: [45.8150, 15.9819, 'Záhřeb'], CH: [46.9480, 7.4474, 'Bern'], LI: [47.1410, 9.5209, 'Vaduz'], NL: [52.3676, 4.9041, 'Amsterdam'], BE: [50.8503, 4.3517, 'Brusel'], FR: [48.8566, 2.3522, 'Paříž'], IT: [41.9028, 12.4964, 'Řím'], ES: [40.4168, -3.7038, 'Madrid'], PT: [38.7223, -9.1393, 'Lisabon'], GB: [51.5074, -0.1278, 'Londýn'], IE: [53.3498, -6.2603, 'Dublin'], DK: [55.6761, 12.5683, 'Kodaň'], SE: [59.3293, 18.0686, 'Stockholm'], NO: [59.9139, 10.7522, 'Oslo'], FI: [60.1699, 24.9384, 'Helsinky'], EE: [59.4370, 24.7536, 'Tallinn'], LV: [56.9496, 24.1052, 'Riga'], LT: [54.6872, 25.2797, 'Vilnius'], RO: [44.4268, 26.1025, 'Bukurešť'], BG: [42.6977, 23.3219, 'Sofie'], RS: [44.7866, 20.4489, 'Bělehrad'], UA: [50.4501, 30.5234, 'Kyjev'], GR: [37.9838, 23.7275, 'Athény'], TR: [39.9334, 32.8597, 'Ankara'], US: [38.9072, -77.0369, 'Washington'], CA: [45.4215, -75.6972, 'Ottawa'], AU: [-35.2809, 149.1300, 'Canberra'] };
    function simulace(kod) {
        try {
            if (window.AGManualPos && AGManualPos.active && simulace._bezi) { AGManualPos.clear(false); simulace._bezi = false; AGSour.nastav('auto'); obnov();
                try { for (var i = (arPoints || []).length - 1; i >= 0; i--) if (arPoints[i] && arPoints[i].zkouska && /^zkouska-zeme-/.test(arPoints[i].id)) { if (arPoints[i].element) arPoints[i].element.remove(); arPoints.splice(i, 1); } if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { /* nic */ } try { window.agInfo && window.agInfo('Simulace ukončena — zpět na GPS a automatickou zemi.'); } catch (e) { /* nic */ } var b0 = document.getElementById('s-zeme-sim-btn'); if (b0) b0.textContent = 'Vyzkoušet'; return; }
            if (!kod || kod === 'auto') kod = 'CZ';
            var z = AGSour.ZEME[kod], m = MESTA[kod];
            var lat = m ? m[0] : (z ? (z.bbox[0] + z.bbox[2]) / 2 : 50.0875), lng = m ? m[1] : (z ? (z.bbox[1] + z.bbox[3]) / 2 : 14.4213);
            if (!window.AGManualPos || typeof AGManualPos.take !== 'function') { try { window.agInfo && window.agInfo('Ruční poloha není k dispozici (modul poloha-z-mapy).'); } catch (e) { /* nic */ } return; }
            AGSour.nastav(kod === 'XX' ? 'XX' : kod);
            AGManualPos.take(lat, lng, 19);
            simulace._bezi = true;
            // mimo ČR nejsou úřední body (ČÚZK) — ať je co zkoušet (navigace, 3D, náčrt), přidají se
            // 3 UKÁZKOVÉ vlastní body 25–60 m od místa (jen v paměti, po konci simulace zmizí)
            try {
                if (kod !== 'CZ' && typeof arPoints !== 'undefined') {
                    var m0 = 1 / 111320, ml0 = m0 / Math.cos(lat * Math.PI / 180);
                    [[25, 10, 'A'], [-40, 30, 'B'], [15, -55, 'C']].forEach(function (q) { arPoints.push({ id: 'zkouska-zeme-' + q[2], name: 'Ukázka ' + q[2], lat: lat + q[1] * m0, lng: lng + q[0] * ml0, type: 'custom', cat: 'CUSTOM', hidden: false, zkouska: true, vyska: null }); });
                    try { if (typeof initARMarkers === 'function') initARMarkers(); if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { /* nic */ }
                }
            } catch (e) { swallow(e, 'ukazky'); }
            try { if (typeof map !== 'undefined' && map) map.setView([lat, lng], 17); } catch (e) { /* nic */ }
            try { document.getElementById('settings-modal').style.display = 'none'; } catch (e) { /* nic */ }
            var b = document.getElementById('s-zeme-sim-btn'); if (b) b.textContent = 'Ukončit simulaci';
            // bublina, ne dialog: dialog by přebil kartu „Měříš v zemi" (zdroje-zemi.js), která o bodech a podkladech říká všechno (18. 9. 2026 noc)
            try { (window.quickToast || window.agInfo)('Simulace: stojíš v ' + ((m && m[2]) || (z && z.nazev) || kod) + '. Souřadnice ' + (AGSour.popisky().system || '') + '.' + (kod !== 'CZ' ? ' Přidal jsem 3 ukázkové body (A, B, C).' : '') + ' Zpět: Nastavení → Mapa a body → Ukončit simulaci.'); } catch (e) { /* nic */ }
            obnov();
        } catch (e) { swallow(e, 'simulace'); }
    }
    window.AGZemeSimulace = simulace;
    // Popisky formuláře vlastního bodu (index.html): v ČR se nesahá (text = klíč překladu).
    function popiskyFormulare() {
        try {
            var p = AGSour.popisky(), cz = p.krovak && p.zeme === 'CZ';
            var y = document.getElementById('custom-y-lab'), x = document.getElementById('custom-x-lab'), z = document.getElementById('custom-z-lab');
            if (y) y.textContent = cz ? 'S-JTSK Y (v metrech):' : p.system + ' ' + p.osaA + ' (v metrech):';
            if (x) x.textContent = cz ? 'S-JTSK X (v metrech):' : p.system + ' ' + p.osaB + ' (v metrech):';
            if (z) z.textContent = cz ? 'Výška Z / Bpv (v metrech) — volitelné:' : 'Výška Z / ' + p.vyska + ' (v metrech) — volitelné:';
        } catch (e) { swallow(e, 'popiskyFormulare'); }
    }
    function obnov() {
        popiskyFormulare();
        var i = document.getElementById('s-zeme-info'); if (i) i.textContent = popisStavu();
        var sel = document.getElementById('s-zeme'); if (sel && sel.value !== AGSour.rezim()) sel.value = AGSour.rezim();
    }
    document.addEventListener('ag:zeme', obnov);
    document.addEventListener('ag:geoid', obnov);

    // ---- start ---------------------------------------------------------------------------
    function start() {
        try { ui(); } catch (e) { swallow(e, 'ui'); }
        // data až v nečinnosti — po prvním obraze, ne před ním
        var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1500); };
        idle(function () { tahniHranice(); tahni(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    // Nastavení se může vykreslit později (lazy moduly) — dorovnat i při otevření.
    document.addEventListener('click', function (ev) { try { if (ev.target && ev.target.closest && ev.target.closest('#settings-btn, [data-open="settings"], #tabbtn-ar')) setTimeout(function () { ui(); obnov(); }, 50); } catch (e) { /* nic */ } }, true);
})();
