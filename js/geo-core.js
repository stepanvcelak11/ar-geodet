// ===== AR Geodet — GEO-CORE: sdílená geodetická knihovna ========================
// Jediný autoritativní zdroj geodetických výpočtů (haversine, azimuty, S-JTSK,
// lokální ENU rovina, plocha/obvod). Vznikla jako základ pro postupné odstranění
// duplicit roztroušených v logika.js / grafika.js / parcela.js / offset-point.js /
// stakeout-line.js / check-distance.js / cadastre-vector.js / ar-resection.js /
// ar-intersection.js (každý z nich má vlastní kopii getDistance / toSJTSK / ENU…).
//
// CHOVÁNÍ metod je 1:1 shodné s existujícími globály, aby šlo později bezpečně
// migrovat (volání nahradit za GeoCore.* bez změny výsledků).
//
// DŮLEŽITÉ: tento modul NEPŘEDEFINOVÁVÁ existující globální funkce (getDistance,
// getBearing, sjtskToLatLng, polygonAreaPerimeter…). Je to NOVÁ vrstva, kterou
// používají jen NOVÉ moduly. Stávající kód zůstává beze změny.
//
// Závislost: globální proj4 s nadefinovanou projekcí "EPSG:5514" (Křovák) —
// definuje se v logika.js (proj4.defs(...)) HNED za načtením proj4 knihovny.
// geo-core.js se proto vkládá až ZA proj4 a PŘED logika.js (definice EPSG:5514
// se používá až za běhu metod, ne při načtení souboru — pořadí je tedy bezpečné,
// ale držíme ho hned za proj4 pro přehlednost).
//
// Odstranění: smaž js/geo-core.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.GeoCore) return;                 // idempotentní (dvojí načtení neuškodí)

    var D2R = Math.PI / 180;
    var R2D = 180 / Math.PI;
    var R_EARTH = 6371e3;                        // poloměr Země pro haversine (shodně s logika.js)
    var M_PER_DEG_LAT = 111320;                  // metrů na 1° (lokální rovinná aproximace, shodně s moduly)

    // ---- VZDÁLENOST: haversine (R = 6371e3 m) ----------------------------------
    // Shodné s getDistance() v logika.js (řádek ~377).
    function getDistance(lat1, lng1, lat2, lng2) {
        var R = R_EARTH;
        var f1 = lat1 * D2R, f2 = lat2 * D2R;
        var df = (lat2 - lat1) * D2R, dl = (lng2 - lng1) * D2R;
        var a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ---- AZIMUT: 0..360° k ZEMĚPISNÉMU severu -----------------------------------
    // Shodné s getBearing() v logika.js (řádek ~378).
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
    // prev === null -> vrací next normalizovaný do <0,360). Shodné se smoothAngle() v logika.js.
    function smoothAngle(prev, next, alpha) {
        if (prev === null) return ((next % 360) + 360) % 360;
        return ((prev + alpha * angDiff(next, prev)) % 360 + 360) % 360;
    }

    // ---- MAGNETICKÁ DEKLINACE (aproximace WMM2025 pro ČR) ----------------------
    // Shodné s getDeclination() v logika.js (řádek ~386). Drift +0.13°/rok.
    function declination(lat, lng) {
        var now = new Date();
        var year = now.getFullYear() + now.getMonth() / 12;
        return 5.65 + 0.25 * (lng - 15.5) - 0.05 * (lat - 49.8) + 0.13 * (year - 2025);
    }
    // ---- UNDULACE KVAZIGEOIDU (lineární aproximace CR-2005) --------------------
    // Shodné s getGeoidUndulation() v logika.js (řádek ~393). WGS84 elipsoid -> Bpv.
    function geoidUndulation(lat, lng) {
        return 45.5 + 0.55 * (lng - 15.5) - 0.4 * (lat - 49.8);
    }

    // ---- S-JTSK (EPSG:5514, Křovák) --------------------------------------------
    // toSJTSK: lat/lng -> {y,x} KLADNÉ metry; v ČR platí Y < X (Y~400-900k, X~900-1280k).
    // Shodné s llToYX() v parcela.js a se způsobem výpočtu v logika.js/grafika.js.
    function toSJTSK(lat, lng) {
        var r = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]);
        var a = Math.abs(r[0]), b = Math.abs(r[1]);
        return { y: Math.min(a, b), x: Math.max(a, b) };
    }
    // fromSJTSK: {y,x} -> {lat,lng}. Akceptuje kladné i záporné (Křovák je nativně
    // záporný, app drží kladné) — bere |y|,|x| a převádí na záporné jako proj4 čeká.
    // Menší hodnota = Y, větší = X (shodné s sjtskToLatLng() v logika.js, řádek ~306).
    function fromSJTSK(y, x) {
        var Y = Math.min(Math.abs(y), Math.abs(x));
        var X = Math.max(Math.abs(y), Math.abs(x));
        var w = proj4('EPSG:5514', 'EPSG:4326', [-Y, -X]);
        return { lat: w[1], lng: w[0] };
    }

    // ---- LOKÁLNÍ ENU ROVINA (rovinná aproximace, přesná na metry–km v ČR) -------
    // enuForward: bod (lat,lng) v lokálních rovinných metrech vůči originu.
    //   e = východ (+), n = sever (+). Shodné s enu()/forward() v offset-point.js,
    //   stakeout-line.js, cadastre-vector.js, ar-resection.js, ar-intersection.js.
    function enuForward(originLat, originLng, lat, lng) {
        var mLat = M_PER_DEG_LAT, mLng = M_PER_DEG_LAT * Math.cos(originLat * D2R);
        return { e: (lng - originLng) * mLng, n: (lat - originLat) * mLat };
    }
    // enuToLatLng: inverze enuForward. Shodné s fromEnu() ve stakeout-line.js.
    function enuToLatLng(originLat, originLng, e, n) {
        var mLat = M_PER_DEG_LAT, mLng = M_PER_DEG_LAT * Math.cos(originLat * D2R);
        return { lat: originLat + n / mLat, lng: originLng + e / mLng };
    }

    // ---- PLOCHA + OBVOD --------------------------------------------------------
    // verts = pole {lat,lng}. Gaussův (shoelace) vzorec + obvod v ROVINNÝCH
    // souřadnicích S-JTSK -> pro ČR legálně správný a přesný výpočet výměry.
    // Vrací {area (m²), perim (m)}. Shodné s polygonAreaPerimeter() v logika.js (~519).
    function polygonAreaPerimeter(verts) {
        if (!verts || verts.length < 2) return { area: 0, perim: 0 };
        var pts = verts.map(function (v) { return proj4('EPSG:4326', 'EPSG:5514', [v.lng, v.lat]); });
        var perim = 0;
        for (var i = 1; i < pts.length; i++) perim += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        var area = 0;
        if (verts.length >= 3) {
            for (var k = 0; k < pts.length; k++) {
                var j = (k + 1) % pts.length;
                area += pts[k][0] * pts[j][1] - pts[j][0] * pts[k][1];
            }
            area = Math.abs(area) / 2;
            perim += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]); // uzavření obvodu
        }
        return { area: area, perim: perim };
    }

    // ---- veřejné API -----------------------------------------------------------
    window.GeoCore = {
        getDistance: getDistance,
        getBearing: getBearing,
        angDiff: angDiff,
        smoothAngle: smoothAngle,
        declination: declination,
        geoidUndulation: geoidUndulation,
        toSJTSK: toSJTSK,
        fromSJTSK: fromSJTSK,
        enuForward: enuForward,
        enuToLatLng: enuToLatLng,
        polygonAreaPerimeter: polygonAreaPerimeter
    };
})();
