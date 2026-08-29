// ===== AR Geodet — GEO-CORE: sdílená geodetická knihovna ========================
// Jediný autoritativní zdroj geodetických výpočtů (haversine, azimuty, S-JTSK,
// lokální ENU rovina, plocha/obvod, statistika GPS průměrování). Slouží
// k odstranění duplicit roztroušených v logika.js / grafika.js / parcela.js /
// offset-point.js / stakeout-line.js / check-distance.js / cadastre-vector.js /
// ar-resection.js / ar-intersection.js.
//
// PŘESNOST (od auditu 2026-07): ENU používá skutečné poloměry křivosti elipsoidu
// (dřív konstanta 111320 m/° se systematickou chybou ~0,15 % = 15 cm na 100 m),
// shoelace redukuje souřadnice (žádná ztráta přesnosti na S-JTSK ~10^6),
// effectiveN() dává statisticky poctivý počet nezávislých GPS vzorků.
//
// DŮLEŽITÉ: tento modul NEPŘEDEFINOVÁVÁ existující globální funkce (getDistance,
// getBearing, sjtskToLatLng…). Moduly na něj přecházejí postupně voláním GeoCore.*.
//
// Závislost: globální proj4 s nadefinovanou projekcí "EPSG:5514" (Křovák) —
// definuje se v logika.js (proj4.defs(...)) HNED za načtením proj4 knihovny.
// geo-core.js se proto vkládá až ZA proj4 a PŘED logika.js (definice EPSG:5514
// se používá až za běhu metod, ne při načtení souboru).
//
// Odstranění: smaž js/geo-core.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.GeoCore) return;                 // idempotentní (dvojí načtení neuškodí)

    var D2R = Math.PI / 180;
    var R2D = 180 / Math.PI;
    // (Pevná konstanta 6371e3 tu bývala pro haversine — odebrána, viz getDistance:
    //  poloměr se teď počítá pro danou šířku, protože globální průměr dělal v ČR
    //  systematickou chybu ~1700 ppm.)

    // Platný rozsah aproximací kalibrovaných na ČR (deklinace, undulace geoidu).
    var CZ = { latMin: 48.4, latMax: 51.2, lngMin: 11.9, lngMax: 19.0 };
    function _clampCZ(lat, lng) {
        return {
            lat: Math.max(CZ.latMin, Math.min(CZ.latMax, lat)),
            lng: Math.max(CZ.lngMin, Math.min(CZ.lngMax, lng))
        };
    }

    // ---- VZDÁLENOST: haversine na MÍSTNÍM poloměru ------------------------------
    // CHYBA (opraveno): dřív se počítalo s R = 6371 km, což je GLOBÁLNÍ střední poloměr
    // Země. V šířkách ČR je ale skutečný (Gaussův) poloměr ~6382 km, takže vzdálenosti
    // vycházely systematicky KRÁTKÉ o ~1700 ppm. Ověřeno proti geodetice WGS84 (pyproj
    // Geod.inv) — a protože stejný vzorec pohání i vzdálenost na štítcích AR značek,
    // znamenalo to:
    //      100 m -> -17 cm       200 m -> -34 cm
    //      500 m -> -85 cm      1000 m -> -1,7 m
    // Není to zaokrouhlovací šum, je to systematické zkrácení KAŽDÉ vzdálenosti.
    //
    // Oprava: Gaussův střední poloměr sqrt(M*N) ve STŘEDNÍ šířce obou bodů. Stejná cena
    // (dvě odmocniny navíc, počítá se ~1x za GPS fix, ne za snímek), stejná signatura,
    // ale chyba klesne na < 32 ppm v celé ČR (0,65 cm na 200 m) — tedy hluboko pod šumem
    // GPS. Testováno v tests/cases-geo.js proti pyproj Geod.
    //
    // Pro výměry a přesnou geometrii se dál používá rovina S-JTSK, ne tenhle vzorec.
    function gaussRadius(latDeg) {
        var s = Math.sin(latDeg * D2R);
        var w2 = 1 - _E2 * s * s, w = Math.sqrt(w2);
        return Math.sqrt((_A * (1 - _E2) / (w2 * w)) * (_A / w));   // sqrt(M*N)
    }
    function getDistance(lat1, lng1, lat2, lng2) {
        var R = gaussRadius((lat1 + lat2) / 2);
        var f1 = lat1 * D2R, f2 = lat2 * D2R;
        var df = (lat2 - lat1) * D2R, dl = (lng2 - lng1) * D2R;
        var a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ---- AZIMUT: 0..360° k ZEMĚPISNÉMU severu -----------------------------------
    // Shodné s getBearing() v logika.js.
    function getBearing(lat1, lng1, lat2, lng2) {
        var dLon = (lng2 - lng1) * D2R;
        var y = Math.sin(dLon) * Math.cos(lat2 * D2R);
        var x = Math.cos(lat1 * D2R) * Math.sin(lat2 * D2R) - Math.sin(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos(dLon);
        return (Math.atan2(y, x) * R2D + 360) % 360;
    }

    // ---- ÚHLY -------------------------------------------------------------------
    // Rozdíl dvou azimutů normalizovaný do <-180, 180>. Shodné s angDiff() v logika.js.
    function angDiff(a, b) { return ((a - b + 540) % 360) - 180; }
    // Cyklické vyhlazení úhlu (řeší přechod 359 -> 0); alpha 0..1 (vyšší = rychlejší).
    function smoothAngle(prev, next, alpha) {
        if (prev === null) return ((next % 360) + 360) % 360;
        return ((prev + alpha * angDiff(next, prev)) % 360 + 360) % 360;
    }

    // ---- MAGNETICKÁ DEKLINACE (aproximace WMM2025 pro ČR) ----------------------
    // Lineární fit platný jen pro ČR — mimo bbox se souřadnice přiskřípnou k okraji
    // (lepší než extrapolovat nesmysl např. pro importovanou zahraniční zakázku).
    function declination(lat, lng) {
        var c = _clampCZ(lat, lng);
        var now = new Date();
        var year = now.getFullYear() + now.getMonth() / 12;
        return 5.65 + 0.25 * (c.lng - 15.5) - 0.05 * (c.lat - 49.8) + 0.13 * (year - 2025);
    }
    // ---- UNDULACE KVAZIGEOIDU (lineární aproximace CR-2005) --------------------
    // WGS84 elipsoidická výška -> Bpv. Přesnost ~1-2 m (pod svislou chybou telefonu).
    // Mimo ČR clamp k okraji (viz declination).
    function geoidUndulation(lat, lng) {
        var c = _clampCZ(lat, lng);
        return 45.5 + 0.55 * (c.lng - 15.5) - 0.4 * (c.lat - 49.8);
    }

    // ---- S-JTSK (EPSG:5514, Křovák) --------------------------------------------
    // KONTRAKT (jediný autoritativní v celé appce):
    //   toSJTSK(lat, lng) -> { y, x }   KLADNÉ metry
    //     y = Y_JTSK (západní osa, v ČR ~430-905 km)
    //     x = X_JTSK (jižní osa,   v ČR ~935-1230 km)
    // Kdo potřebuje jiná jména klíčů, přemapuje si to u sebe — jádro má jeden tvar.
    //
    // POŘADÍ OS: definice v logika.js (+proj=krovak, BEZ +axis=) vrací [-Y, -X].
    // Ověřeno proti PROJ 9.5.1 přes pyproj (scripts/gen_geo_fixtures.py) na stejném
    // proj-stringu. Pořadí je tedy POZIČNÍ, ne „podle velikosti".
    //
    // CHYBA (opraveno): dřív tu bylo {y: min(|a|,|b|), x: max(|a|,|b|)}. Uvnitř ČR to
    // sedí (Y < X vždycky), ale pro importovanou ZAHRANIČNÍ zakázku to osy TIŠE
    // PROHODILO — Frankfurt |Y|=1146766 > |X|=968881, Brusel |Y|=1425257 > |X|=814620.
    // A protože se to nikde nekontrolovalo, projevilo by se to jako bod o stovky km
    // jinde, ne jako chyba. Pořadí se teď jednou ověří proti zabudovanému referenčnímu
    // bodu; když se proj4 změní (bump verze, přidané +axis=), řekne to nahlas.
    var AXIS_REF = { lat: 50.0875, lng: 14.4213, y: 742805.9, x: 1043009.5 };
    var AXIS_TOL = 50000;      // jen k IDENTIFIKACI osy (Y a X se liší o ~300 km), ne k ověření přesnosti
    var _axisState = null;     // null = neověřeno | 'ok' | 'swapped' | 'unknown'

    function _resolveAxis() {
        if (_axisState) return _axisState;
        try {
            var r = proj4('EPSG:4326', 'EPSG:5514', [AXIS_REF.lng, AXIS_REF.lat]);
            var a = Math.abs(r[0]), b = Math.abs(r[1]);
            if (Math.abs(a - AXIS_REF.y) <= AXIS_TOL && Math.abs(b - AXIS_REF.x) <= AXIS_TOL) _axisState = 'ok';
            else if (Math.abs(b - AXIS_REF.y) <= AXIS_TOL && Math.abs(a - AXIS_REF.x) <= AXIS_TOL) _axisState = 'swapped';
            else _axisState = 'unknown';
        } catch (e) { _axisState = 'unknown'; }
        if (_axisState !== 'ok') {
            // Nahlas, ale bez pádu: appka pojede dál v poziční interpretaci.
            try {
                var msg = '[GeoCore] Křovák: pořadí os je „' + _axisState + '" (očekáváno „ok"). '
                    + 'Zkontroluj proj4 a definici EPSG:5514 v logika.js — souřadnice mohou být prohozené.';
                if (window.AGDiag && typeof AGDiag.error === 'function') AGDiag.error('geo-core', msg);
                console.error(msg);
            } catch (e2) {}
        }
        return _axisState;
    }

    function toSJTSK(lat, lng) {
        var r = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]);
        var a = Math.abs(r[0]), b = Math.abs(r[1]);
        if (_resolveAxis() === 'swapped') return { y: b, x: a };
        return { y: a, x: b };
    }
    // fromSJTSK: {y,x} -> {lat,lng}. Akceptuje kladné i záporné (Křovák je nativně
    // záporný, app drží kladné). Pořadí os se pozná podle ROZSAHŮ platných pro ČR
    // (Y 400-935k, X 935-1300k) — ne jen min/max, u kterého by se hodnoty mimo ČR
    // tiše prohodily. Při nejednoznačnosti padá zpět na min/max (chování jako dřív).
    function fromSJTSK(y, x) {
        var a = Math.abs(y), b = Math.abs(x);
        var Y, X;
        var aIsY = a >= 400000 && a < 935000, bIsY = b >= 400000 && b < 935000;
        var aIsX = a >= 935000 && a <= 1300000, bIsX = b >= 935000 && b <= 1300000;
        if (aIsY && bIsX) { Y = a; X = b; }
        else if (bIsY && aIsX) { Y = b; X = a; }
        else { Y = Math.min(a, b); X = Math.max(a, b); }   // mimo ČR / nejednoznačné
        // Zpětný převod respektuje zjištěné pořadí os (viz _resolveAxis u toSJTSK).
        // Rozsahová logika výše je jiná věc: ta hádá, co uživatel ZADAL, ne co vrací proj4.
        var w = (_resolveAxis() === 'swapped')
            ? proj4('EPSG:5514', 'EPSG:4326', [-X, -Y])
            : proj4('EPSG:5514', 'EPSG:4326', [-Y, -X]);
        return { lat: w[1], lng: w[0] };
    }
    // Je dvojice souřadnic v rozsahu S-JTSK pro ČR? (pro validaci vstupů/importů)
    function looksLikeSJTSK(y, x) {
        var a = Math.abs(y), b = Math.abs(x);
        var Y = Math.min(a, b), X = Math.max(a, b);
        return Y >= 400000 && Y < 935000 && X >= 935000 && X <= 1300000;
    }

    // ---- METRY NA STUPEŇ: poloměry křivosti elipsoidu (GRS80/WGS84) -------------
    // M = meridiánový poloměr, N = příčný poloměr v dané šířce. Nahrazuje konstantu
    // 111320 m/° (ta má v ČR systematickou chybu ~0,15 % = 15 cm/100 m, 1,5 m/km).
    var _A = 6378137.0, _E2 = 0.00669438002290;   // GRS80 (WGS84 se liší < 1 mm)
    function metersPerDeg(lat) {
        var s = Math.sin(lat * D2R), c = Math.cos(lat * D2R);
        var w2 = 1 - _E2 * s * s, w = Math.sqrt(w2);
        var M = _A * (1 - _E2) / (w2 * w);        // meridián
        var N = _A / w;                            // příčný
        return { lat: M * D2R, lng: N * c * D2R }; // metrů na 1° šířky / délky
    }

    // ---- LOKÁLNÍ ENU ROVINA ------------------------------------------------------
    // enuForward: bod (lat,lng) v lokálních rovinných metrech vůči originu.
    //   e = východ (+), n = sever (+). Pro AR vzdálenosti (stovky m) přesné na mm-cm.
    function enuForward(originLat, originLng, lat, lng) {
        var m = metersPerDeg(originLat);
        return { e: (lng - originLng) * m.lng, n: (lat - originLat) * m.lat };
    }
    // enuToLatLng: inverze enuForward.
    function enuToLatLng(originLat, originLng, e, n) {
        var m = metersPerDeg(originLat);
        return { lat: originLat + n / m.lat, lng: originLng + e / m.lng };
    }

    // ---- PLOCHA + OBVOD --------------------------------------------------------
    // verts = pole {lat,lng}. Gaussův (shoelace) vzorec + obvod v ROVINNÝCH
    // souřadnicích S-JTSK -> pro ČR legálně správný výpočet výměry (vyhl. 357/2013).
    // Souřadnice se před sumací redukují o první vrchol: S-JTSK je ~10^6 m, součiny
    // ~10^12 by v double ztrácely přesnost vzájemným rušením členů.
    function polygonAreaPerimeter(verts) {
        if (!verts || verts.length < 2) return { area: 0, perim: 0 };
        var pts = verts.map(function (v) { return proj4('EPSG:4326', 'EPSG:5514', [v.lng, v.lat]); });
        var perim = 0;
        for (var i = 1; i < pts.length; i++) perim += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        var area = 0;
        if (verts.length >= 3) {
            var y0 = pts[0][0], x0 = pts[0][1];
            for (var k = 0; k < pts.length; k++) {
                var j = (k + 1) % pts.length;
                area += (pts[k][0] - y0) * (pts[j][1] - x0) - (pts[j][0] - y0) * (pts[k][1] - x0);
            }
            area = Math.abs(area) / 2;
            perim += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]); // uzavření obvodu
        }
        return { area: area, perim: perim };
    }

    // ---- STATISTIKA GPS PRŮMĚROVÁNÍ ---------------------------------------------
    // Efektivní počet NEZÁVISLÝCH vzorků. Po sobě jdoucí GPS fixy (1 Hz) nejsou
    // nezávislé — chyba (multipath, troposféra, konstelace) se dekoreluje řádově
    // za desítky sekund. Prostý N (nebo N/4) proto sterr dramaticky nadhodnocuje.
    //
    // Odhad dvěma cestami a bere se MENŠÍ (konzervativní):
    //  a) lag-1 autokorelace reziduí: neff = N·(1-rho)/(1+rho)  (AR(1) model),
    //  b) délka měření / dekorelacní čas tau: neff = 1 + T/tau
    //     (tau ~30 s poloha, ~45-60 s výška — svislá chyba je korelovaná silněji).
    // xs/ys = rezidua vůči odhadu středu (u 1D řady dej ys = null), ts = časy [ms].
    function effectiveN(xs, ys, ts, tauSec) {
        var n = xs.length;
        if (n <= 1) return 1;
        var num = 0, den = 0;
        for (var i = 0; i < n; i++) {
            var vx = xs[i], vy = ys ? ys[i] : 0;
            den += vx * vx + vy * vy;
            if (i < n - 1) num += vx * xs[i + 1] + (ys ? vy * ys[i + 1] : 0);
        }
        var rho = den > 0 ? Math.max(0, Math.min(0.98, num / den)) : 0;
        var neffRho = n * (1 - rho) / (1 + rho);
        var neffTime = neffRho;
        if (ts && ts.length >= 2 && tauSec > 0) {
            var T = (ts[ts.length - 1] - ts[0]) / 1000;
            if (isFinite(T) && T >= 0) neffTime = 1 + T / tauSec;
        }
        return Math.max(1, Math.min(n, neffRho, neffTime));
    }

    // ---- SEBEKONTROLA -----------------------------------------------------------
    // Rychlá kontrola za běhu: pořadí os + zpětná převoditelnost na referenčním bodě.
    // Používá ji diagnostická obrazovka i testy (tests/cases-geo.js). Nic nevypisuje —
    // vrací { ok, axis, roundTripM, detail }, ať si volající rozhodne, co s tím.
    function selfTest() {
        var out = { ok: false, axis: 'unknown', roundTripM: null, detail: '' };
        try {
            out.axis = _resolveAxis();
            var s = toSJTSK(AXIS_REF.lat, AXIS_REF.lng);
            var dy = Math.abs(s.y - AXIS_REF.y), dx = Math.abs(s.x - AXIS_REF.x);
            var back = fromSJTSK(s.y, s.x);
            out.roundTripM = getDistance(AXIS_REF.lat, AXIS_REF.lng, back.lat, back.lng);
            // 2 m na referenci = tolerance pro rozdíl proj4js vs PROJ v towgs84 pipeline;
            // 0,01 m na round-trip = převod tam a zpět musí být prakticky bezeztrátový.
            out.ok = (out.axis === 'ok') && dy < 2 && dx < 2 && out.roundTripM < 0.01;
            out.detail = 'dY=' + dy.toFixed(3) + ' m, dX=' + dx.toFixed(3)
                + ' m, round-trip=' + out.roundTripM.toFixed(4) + ' m';
        } catch (e) { out.detail = 'výjimka: ' + (e && e.message ? e.message : e); }
        return out;
    }

    // ---- HTML escapovani (sdilene pro celou appku) ------------------------------
    // Tuhle funkci mela drive KAZDA vrstva svoji vlastni - a ve CTYRECH ruznych
    // variantach. Nektere escapovaly jen & < >, takze hodnota vlozena do ATRIBUTU
    // (title="...", href="...") z nej umela uvozovkou utect. Tady je jedina,
    // nejsilnejsi: pokryva i " a ', takze je bezpecna v textu i v atributu.
    // Moduly ji volaji pres AG.esc / AG.escAttr a maji u sebe stejny fallback,
    // aby zustaly odpojitelne i bez geo-core.js.
    var _ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function _escHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return _ESC_MAP[c]; });
    }
    window.AG = window.AG || {};
    window.AG.esc = _escHtml;
    window.AG.escAttr = _escHtml;   // tataz funkce — proto je bezpecna i v atributu

    // ---- veřejné API -----------------------------------------------------------
    window.GeoCore = {
        selfTest: selfTest,
        axisState: function () { return _resolveAxis(); },
        getDistance: getDistance,
        getBearing: getBearing,
        angDiff: angDiff,
        smoothAngle: smoothAngle,
        declination: declination,
        geoidUndulation: geoidUndulation,
        toSJTSK: toSJTSK,
        fromSJTSK: fromSJTSK,
        looksLikeSJTSK: looksLikeSJTSK,
        metersPerDeg: metersPerDeg,
        enuForward: enuForward,
        enuToLatLng: enuToLatLng,
        polygonAreaPerimeter: polygonAreaPerimeter,
        effectiveN: effectiveN
    };
})();
