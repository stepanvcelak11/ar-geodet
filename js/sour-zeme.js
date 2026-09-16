// ===== QTRIG — REGISTR ZEMÍ: souřadnice a výšky podle toho, kde stojím ==========
// (16. 9. 2026, fáze 1 „měření mimo ČR", viz paměť project-vlastni-mapa-svet-vyber-16-9)
//
// PROČ: appka měla Křovák (EPSG:5514) natvrdo v 65 voláních ve 27 souborech a výšky
// Bpv z lineární aproximace platné jen v ČR. Na Slovensku to ještě prošlo, v Polsku
// nebo Rakousku ukázala karta bodu nesmysl. Tenhle modul je JEDINÉ místo, které ví,
// jaký rovinný systém a jaký výškový systém platí v zemi, kde uživatel právě stojí.
//
// CO DĚLÁ
//   • ZEME: registr — pro každou zemi rovinný systém (proj4 definice, názvy os, pořadí,
//     znaménko), výškový systém (název + posun vůči EVRF2007) a hrubý bbox.
//   • urciZemi(lat,lng): z GPS pozná zemi. Napřed obrysy (data/zeme-hranice.json, tahá
//     js/zeme-svet.js), do té doby bbox — u hranic může ukázat souseda, proto se země dá
//     v Nastavení přepnout ručně a poslední zjištěná se pamatuje (agZeme_v1).
//   • doMistnich(lat,lng) → {y, x}: klíče jsou ZÁMĚRNĚ stejné jako u GeoCore.toSJTSK,
//     aby na to přešly desítky modulů beze změny čtení: y = PRVNÍ osa v národním
//     pořadí, x = DRUHÁ. V ČR/SK je to doslova Y a X (kladné), v Německu E a N,
//     v Polsku X (sever) a Y (východ). Názvy os dává popisky().
//   • zMistnich(y,x) → {lat,lng} — zpětný převod (vstup od uživatele, importy).
//   • vyska(hEl,lat,lng) → národní výška: elipsoid − undulace EGM2008 − posun systému.
//     Undulaci dodá js/zeme-svet.js (AGGeoid); dokud není, drží GeoCore lineární vzorec ČR.
//
// CO NEDĚLÁ: nesahá na GeoCore.toSJTSK — ten zůstává STRIKTNĚ Křovák pro datové zdroje
// (ČÚZK BodovaPole, RÚIAN, VFK, GML sítí, DATAZ), které Křovák chtějí ať stojím kdekoli.
//
// PŘESNOST: proj4 s +towgs84 dává 0,5–1 m (pod chybou telefonu). Národní mřížky NTv2
// (cm) by se tahaly zvlášť — až bude důvod (RTK).
//
// Načítat HNED ZA proj4 (definuje projekce) a PŘED geo-core.js. Odstranění: smaž soubor
// + <script> v index.html, spusť python scripts/gen_sw_assets.py --bump; moduly se
// vrátí k Křováku (GeoCore.toMistni padá na toSJTSK).
// =====================================================================================
(function () {
    'use strict';
    if (window.AGSour) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'sour-zeme:' + kde); } catch (e2) { /* nic */ } };

    var GRS = '+ellps=GRS80 +units=m +no_defs';
    var MGI = '+ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs';
    function tm(lon0, k, x0, y0, tail) { return '+proj=tmerc +lat_0=0 +lon_0=' + lon0 + ' +k=' + k + ' +x_0=' + x0 + ' +y_0=' + y0 + ' ' + (tail || GRS); }
    function utm(z, jih) { return '+proj=utm +zone=' + z + (jih ? ' +south' : '') + ' +datum=WGS84 +units=m +no_defs'; }
    function utmZona(lng) { return Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1)); }

    // CRS = { id, epsg, nazev, def, osy:[první,druhá], vychod:'y'|'x' (která z {y,x} je
    //         východní), kladne (Křovák: proj4 vrací záporné, appka drží kladné),
    //         zona(lat,lng) → jiný CRS (pásma) }
    // VÝŠKA = { nazev, posun } — H_národní = H_EVRF2007 − posun; posuny (cm→m) z tabulky
    //         EVRS/BKG (opendem.info), EGM2008 ≈ EVRF2007 v rámci ±0,3 m. `nejiste` = posun
    //         neznám, nechávám 0 a v UI se ukáže ±0,5 m.
    var KROVAK = { id: 'sjtsk', epsg: 5514, nazev: 'S-JTSK', osy: ['Y', 'X'], vychod: null, kladne: true, cad: 'krovak',
        def: '+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs' };
    var JTSK03 = { id: 'jtsk03', epsg: 8353, nazev: 'S-JTSK [JTSK03]', osy: ['Y', 'X'], vychod: null, kladne: true, cad: 'krovak',
        def: '+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=485.021,169.465,483.839,7.786342,4.397554,4.102655,0 +units=m +no_defs' };
    function utmCrs(lat, lng) {
        var z = utmZona(lng), jih = lat < 0;
        return { id: 'utm' + z + (jih ? 'S' : 'N'), epsg: (jih ? 32700 : 32600) + z, nazev: 'UTM ' + z + (jih ? 'S' : 'N') + ' (WGS84)', osy: ['E', 'N'], vychod: 'y', def: utm(z, jih) };
    }
    function etrsUtm(z) { return { id: 'etrs' + z, epsg: 25800 + z, nazev: 'ETRS89 / UTM ' + z + 'N', osy: ['E', 'N'], vychod: 'y', def: '+proj=utm +zone=' + z + ' ' + GRS }; }

    var ZEME = {
        CZ: { nazev: 'Česko', bbox: [48.55, 12.09, 51.06, 18.87], crs: KROVAK, vyska: { nazev: 'Bpv', posun: 0.13 } },
        SK: { nazev: 'Slovensko', bbox: [47.73, 16.83, 49.61, 22.57], crs: JTSK03, dalsi: [KROVAK], vyska: { nazev: 'Bpv', posun: 0.14 } },
        PL: { nazev: 'Polsko', bbox: [49.0, 14.12, 54.84, 24.15], vyska: { nazev: 'PL-EVRF2007-NH', posun: 0 },
            crs: { id: 'pl2000', nazev: 'PL-2000', osy: ['X', 'Y'], vychod: 'x',
                zona: function (lat, lng) { var p = lng < 16.5 ? 5 : lng < 19.5 ? 6 : lng < 22.5 ? 7 : 8; return { id: 'pl2000-' + p, epsg: 2171 + p, nazev: 'PL-2000 pásmo ' + p, osy: ['X', 'Y'], vychod: 'x', def: tm(p * 3, 0.999923, p * 1e6 + 500000, 0) }; } },
            dalsi: [{ id: 'pl1992', epsg: 2180, nazev: 'PL-1992', osy: ['X', 'Y'], vychod: 'x', def: tm(19, 0.9993, 500000, -5300000) }] },
        DE: { nazev: 'Německo', bbox: [47.27, 5.87, 55.06, 15.04], vyska: { nazev: 'DHHN2016 (NHN)', posun: 0.01 },
            crs: { id: 'de-utm', nazev: 'ETRS89 / UTM', osy: ['E', 'N'], vychod: 'y', zona: function (lat, lng) { return etrsUtm(lng < 12 ? 32 : 33); } } },
        AT: { nazev: 'Rakousko', bbox: [46.37, 9.53, 49.02, 17.16], vyska: { nazev: 'GHA (Jadran)', posun: -0.34 },
            crs: { id: 'mgi-gk', nazev: 'MGI / Austria GK', osy: ['Y', 'X'], vychod: 'y',
                zona: function (lat, lng) { var m = lng < 11.8333 ? 28 : lng < 14.8333 ? 31 : 34; return { id: 'mgi-m' + m, epsg: m === 28 ? 31254 : m === 31 ? 31255 : 31256, nazev: 'MGI / Austria GK M' + m, osy: ['Y', 'X'], vychod: 'y', def: '+proj=tmerc +lat_0=0 +lon_0=' + (m === 28 ? '10.33333333333333' : m === 31 ? '13.33333333333333' : '16.33333333333333') + ' +k=1 +x_0=0 +y_0=-5000000 ' + MGI }; } } },
        HU: { nazev: 'Maďarsko', bbox: [45.74, 16.11, 48.59, 22.9], vyska: { nazev: 'EOMA (Balt)', posun: 0.14 },
            crs: { id: 'eov', epsg: 23700, nazev: 'EOV', osy: ['Y', 'X'], vychod: 'y', def: '+proj=somerc +lat_0=47.14439372222222 +lon_0=19.04857177777778 +k_0=0.99993 +x_0=650000 +y_0=200000 +ellps=GRS67 +towgs84=52.17,-71.82,-14.9,0,0,0,0 +units=m +no_defs' } },
        CH: { nazev: 'Švýcarsko', bbox: [45.82, 5.96, 47.81, 10.49], vyska: { nazev: 'LN02', posun: -0.23 },
            crs: { id: 'lv95', epsg: 2056, nazev: 'CH1903+ / LV95', osy: ['E', 'N'], vychod: 'y', def: '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs' } },
        FR: { nazev: 'Francie', bbox: [41.33, -5.14, 51.09, 9.56], vyska: { nazev: 'NGF-IGN69', posun: -0.47 },
            crs: { id: 'l93', epsg: 2154, nazev: 'RGF93 / Lambert-93', osy: ['X', 'Y'], vychod: 'y', def: '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 ' + GRS } },
        NL: { nazev: 'Nizozemsko', bbox: [50.75, 3.36, 53.56, 7.23], vyska: { nazev: 'NAP', posun: 0.02 },
            crs: { id: 'rd', epsg: 28992, nazev: 'RD New (Amersfoort)', osy: ['X', 'Y'], vychod: 'y', def: '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs' } },
        BE: { nazev: 'Belgie', bbox: [49.5, 2.54, 51.51, 6.41], vyska: { nazev: 'TAW (DNG)', posun: -2.32 },
            crs: { id: 'l72', epsg: 31370, nazev: 'BD72 / Lambert 72', osy: ['X', 'Y'], vychod: 'y', def: '+proj=lcc +lat_1=51.16666723333333 +lat_2=49.8333339 +lat_0=90 +lon_0=4.367486666666666 +x_0=150000.013 +y_0=5400088.438 +ellps=intl +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs' },
            dalsi: [{ id: 'l08', epsg: 3812, nazev: 'ETRS89 / Lambert 2008', osy: ['X', 'Y'], vychod: 'y', def: '+proj=lcc +lat_1=49.83333333333334 +lat_2=51.16666666666666 +lat_0=50.797815 +lon_0=4.359215833333333 +x_0=649328 +y_0=665262 ' + GRS }] },
        LU: { nazev: 'Lucembursko', bbox: [49.45, 5.73, 50.18, 6.53], vyska: { nazev: 'NG95', posun: 0, nejiste: true },
            crs: { id: 'luref', epsg: 2169, nazev: 'LUREF / Gauss', osy: ['E', 'N'], vychod: 'y', def: '+proj=tmerc +lat_0=49.83333333333334 +lon_0=6.166666666666667 +k=1 +x_0=80000 +y_0=100000 +ellps=intl +towgs84=-189.681,18.3463,-42.7695,-0.33746,-3.09264,2.53861,0.4598 +units=m +no_defs' } },
        GB: { nazev: 'Británie', bbox: [49.86, -8.65, 60.86, 1.77], vyska: { nazev: 'ODN (Newlyn)', posun: 0.05 },
            crs: { id: 'osgb', epsg: 27700, nazev: 'OSGB36 / British National Grid', osy: ['E', 'N'], vychod: 'y', def: '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs' } },
        IE: { nazev: 'Irsko', bbox: [51.42, -10.48, 55.39, -5.99], vyska: { nazev: 'Malin Head', posun: 0, nejiste: true },
            crs: { id: 'itm', epsg: 2157, nazev: 'IRENET95 / ITM', osy: ['E', 'N'], vychod: 'y', def: '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 ' + GRS } },
        SI: { nazev: 'Slovinsko', bbox: [45.42, 13.38, 46.88, 16.61], vyska: { nazev: 'SVS2010 (Koper)', posun: -0.39, nejiste: true },
            crs: { id: 'd96tm', epsg: 3794, nazev: 'D96/TM', osy: ['e', 'n'], vychod: 'y', def: tm(15, 0.9999, 500000, -5000000) } },
        HR: { nazev: 'Chorvatsko', bbox: [42.39, 13.49, 46.55, 19.45], vyska: { nazev: 'HVRS71', posun: -0.31 },
            crs: { id: 'htrs96', epsg: 3765, nazev: 'HTRS96/TM', osy: ['E', 'N'], vychod: 'y', def: tm(16.5, 0.9999, 500000, 0) } },
        IT: { nazev: 'Itálie', bbox: [36.62, 6.63, 47.09, 18.52], vyska: { nazev: 'Genova 1942', posun: -0.28 },
            crs: { id: 'it-utm', nazev: 'ETRS89 / UTM', osy: ['E', 'N'], vychod: 'y', zona: function (lat, lng) { return etrsUtm(lng < 12 ? 32 : 33); } } },
        ES: { nazev: 'Španělsko', bbox: [27.63, -18.17, 43.79, 4.33], vyska: { nazev: 'Alicante', posun: -0.49 },
            crs: { id: 'es-utm', nazev: 'ETRS89 / UTM', osy: ['E', 'N'], vychod: 'y', zona: function (lat, lng) { return etrsUtm(lng < -12 ? 28 : lng < -6 ? 29 : lng < 0 ? 30 : 31); } } },
        PT: { nazev: 'Portugalsko', bbox: [36.96, -9.53, 42.15, -6.19], vyska: { nazev: 'Cascais', posun: -0.25 },
            crs: { id: 'pttm06', epsg: 3763, nazev: 'PT-TM06/ETRS89', osy: ['X', 'Y'], vychod: 'y', def: '+proj=tmerc +lat_0=39.66825833333333 +lon_0=-8.133108333333334 +k=1 +x_0=0 +y_0=0 ' + GRS } },
        DK: { nazev: 'Dánsko', bbox: [54.56, 8.07, 57.75, 15.2], vyska: { nazev: 'DVR90', posun: 0 },
            crs: { id: 'dk-utm', nazev: 'ETRS89 / UTM', osy: ['E', 'N'], vychod: 'y', zona: function (lat, lng) { return etrsUtm(lng < 14.5 ? 32 : 33); } } },
        NO: { nazev: 'Norsko', bbox: [57.96, 4.65, 71.19, 31.08], vyska: { nazev: 'NN2000', posun: -0.01 },
            crs: { id: 'no-utm', nazev: 'ETRS89 / UTM', osy: ['E', 'N'], vychod: 'y', zona: function (lat, lng) { return etrsUtm(utmZona(lng)); } } },
        SE: { nazev: 'Švédsko', bbox: [55.34, 11.11, 69.06, 24.17], vyska: { nazev: 'RH2000', posun: -0.01 },
            crs: { id: 'sweref', epsg: 3006, nazev: 'SWEREF99 TM', osy: ['N', 'E'], vychod: 'x', def: '+proj=utm +zone=33 ' + GRS } },
        FI: { nazev: 'Finsko', bbox: [59.81, 20.55, 70.09, 31.59], vyska: { nazev: 'N2000', posun: -0.01 },
            crs: { id: 'tm35fin', epsg: 3067, nazev: 'ETRS-TM35FIN', osy: ['N', 'E'], vychod: 'x', def: '+proj=utm +zone=35 ' + GRS } },
        EE: { nazev: 'Estonsko', bbox: [57.51, 21.76, 59.68, 28.21], vyska: { nazev: 'EH2000', posun: 0 },
            crs: { id: 'lest97', epsg: 3301, nazev: 'L-EST97', osy: ['X', 'Y'], vychod: 'x', def: '+proj=lcc +lat_1=59.33333333333334 +lat_2=58 +lat_0=57.51755393055556 +lon_0=24 +x_0=500000 +y_0=6375000 ' + GRS } },
        LV: { nazev: 'Lotyšsko', bbox: [55.67, 20.97, 58.09, 28.24], vyska: { nazev: 'LAS-2000,5', posun: 0 },
            crs: { id: 'lks92', epsg: 3059, nazev: 'LKS92 / TM', osy: ['X', 'Y'], vychod: 'x', def: tm(24, 0.9996, 500000, -6000000) } },
        LT: { nazev: 'Litva', bbox: [53.9, 20.93, 56.45, 26.84], vyska: { nazev: 'LAS07', posun: 0 },
            crs: { id: 'lks94', epsg: 3346, nazev: 'LKS94 / TM', osy: ['X', 'Y'], vychod: 'x', def: tm(24, 0.9998, 500000, 0) } },
        RO: { nazev: 'Rumunsko', bbox: [43.62, 20.26, 48.27, 29.72], vyska: { nazev: 'Marea Neagră 1975', posun: 0.06 },
            crs: { id: 'stereo70', epsg: 3844, nazev: 'Stereo 70', osy: ['X', 'Y'], vychod: 'x', def: '+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=krass +towgs84=2.329,-147.042,-92.08,0.309,-0.325,-0.497,5.69 +units=m +no_defs' } },
        BG: { nazev: 'Bulharsko', bbox: [41.24, 22.36, 44.22, 28.61], vyska: { nazev: 'Balt 1957', posun: 0.23 },
            crs: { id: 'bgs2005', epsg: 7801, nazev: 'BGS2005 / CCS2005', osy: ['X', 'Y'], vychod: 'x', def: '+proj=lcc +lat_1=42 +lat_2=43.33333333333334 +lat_0=42.66787857 +lon_0=25.5 +x_0=500000 +y_0=4725824.3591 ' + GRS } },
        GR: { nazev: 'Řecko', bbox: [34.8, 19.37, 41.75, 29.65], vyska: { nazev: 'Pireus', posun: 0, nejiste: true },
            crs: { id: 'ggrs87', epsg: 2100, nazev: 'GGRS87 / Greek Grid', osy: ['E', 'N'], vychod: 'y', def: '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs' } },
        IS: { nazev: 'Island', bbox: [63.39, -24.54, 66.54, -13.49], vyska: { nazev: 'ISH2004', posun: 0, nejiste: true },
            crs: { id: 'isn93', epsg: 3057, nazev: 'ISN93 / Lambert 1993', osy: ['E', 'N'], vychod: 'y', def: '+proj=lcc +lat_1=64.25 +lat_2=65.75 +lat_0=65 +lon_0=-19 +x_0=500000 +y_0=500000 ' + GRS } },
        LI: { nazev: 'Lichtenštejnsko', bbox: [47.05, 9.47, 47.27, 9.64], vyska: { nazev: 'LN02', posun: -0.23 }, crs: null },   // = Švýcarsko (doplní se níže)
        // Země bez ověřené národní definice: obecné UTM (WGS84) + Balt/EVRF podle tabulky.
        UA: { nazev: 'Ukrajina', bbox: [44.39, 22.14, 52.38, 40.23], vyska: { nazev: 'Balt 1977', posun: 0.15 } },
        BY: { nazev: 'Bělorusko', bbox: [51.26, 23.18, 56.17, 32.78], vyska: { nazev: 'Balt 1977', posun: 0.15 } },
        MD: { nazev: 'Moldavsko', bbox: [45.47, 26.62, 48.49, 30.16], vyska: { nazev: 'Balt 1977', posun: 0.15 } },
        RS: { nazev: 'Srbsko', bbox: [42.23, 18.82, 46.19, 23.0], vyska: { nazev: 'Terst', posun: -0.34, nejiste: true } },
        BA: { nazev: 'Bosna a Hercegovina', bbox: [42.56, 15.72, 45.28, 19.62], vyska: { nazev: 'Terst', posun: -0.34, nejiste: true } },
        ME: { nazev: 'Černá Hora', bbox: [41.85, 18.43, 43.56, 20.36], vyska: { nazev: 'Terst', posun: -0.34, nejiste: true } },
        MK: { nazev: 'Severní Makedonie', bbox: [40.85, 20.45, 42.37, 23.03], vyska: { nazev: 'Terst', posun: -0.34, nejiste: true } },
        AL: { nazev: 'Albánie', bbox: [39.64, 19.27, 42.66, 21.06], vyska: { nazev: 'Terst', posun: -0.34, nejiste: true } },
        XK: { nazev: 'Kosovo', bbox: [41.85, 20.01, 43.27, 21.79], vyska: { nazev: 'Terst', posun: -0.34, nejiste: true } },
        TR: { nazev: 'Turecko', bbox: [35.81, 25.66, 42.11, 44.82], vyska: { nazev: 'TUDKA (Antalya)', posun: 0, nejiste: true } },
        CY: { nazev: 'Kypr', bbox: [34.56, 32.27, 35.71, 34.6], vyska: { nazev: 'Famagusta', posun: 0, nejiste: true } },
        MT: { nazev: 'Malta', bbox: [35.8, 14.18, 36.08, 14.58], vyska: { nazev: 'Malta', posun: 0, nejiste: true } },
        AD: { nazev: 'Andorra', bbox: [42.43, 1.41, 42.66, 1.79], vyska: { nazev: 'Alicante', posun: -0.49, nejiste: true } },
        MC: { nazev: 'Monako', bbox: [43.72, 7.41, 43.75, 7.44], vyska: { nazev: 'NGF-IGN69', posun: -0.47 } },
        SM: { nazev: 'San Marino', bbox: [43.89, 12.4, 43.99, 12.52], vyska: { nazev: 'Genova 1942', posun: -0.28 } }
    };
    ZEME.LI.crs = ZEME.CH.crs;
    // Mimo registr (nebo bez známé polohy): obecné UTM a výška nad mořem z EGM2008.
    var SVET = { kod: 'XX', nazev: 'jinde na světě', vyska: { nazev: 'n. m. (EGM2008)', posun: 0 } };
    Object.keys(ZEME).forEach(function (k) { ZEME[k].kod = k; if (!ZEME[k].crs) ZEME[k].crs = { id: 'utm', nazev: 'UTM (WGS84)', osy: ['E', 'N'], vychod: 'y', zona: utmCrs }; });
    SVET.crs = { id: 'utm', nazev: 'UTM (WGS84)', osy: ['E', 'N'], vychod: 'y', zona: utmCrs };

    // ---- proj4 definice: registruje se líně, jen co je potřeba ---------------------
    var _def = {};
    function projId(crs) {
        var id = 'AG:' + crs.id;
        if (!_def[id]) {
            if (crs.epsg === 5514) { id = 'EPSG:5514'; }  // definuje logika.js — jedna pravda
            else { try { proj4.defs(id, crs.def); } catch (e) { swallow(e, 'defs'); } }
            _def['AG:' + crs.id] = id;
        }
        return _def['AG:' + crs.id];
    }
    // Konkrétní CRS pro dané místo (u pásmových systémů vybere pásmo).
    function crsPro(zeme, lat, lng) {
        var c = zeme.crs;
        if (c.zona && lat != null && lng != null && isFinite(lat) && isFinite(lng)) return c.zona(lat, lng);
        if (c.zona) { var b = zeme.bbox; return c.zona(b ? (b[0] + b[2]) / 2 : 50, b ? (b[1] + b[3]) / 2 : 15); }
        return c;
    }

    // ---- stav: která země platí ---------------------------------------------------
    var STORE = 'agZeme_v1';
    var _st = { rezim: 'auto', posledni: 'CZ' };
    try { var s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s && typeof s === 'object') { if (s.rezim) _st.rezim = s.rezim; if (s.posledni) _st.posledni = s.posledni; } } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(STORE, JSON.stringify(_st)); } catch (e) { swallow(e, 'save'); } }
    var _lat = null, _lng = null;      // poslední známá poloha (pro pásma a určení země)
    var _hranice = null;               // {kod: [[ [lng,lat],… ], …]} z data/zeme-hranice.json

    function vBoxu(z, lat, lng) { var b = z.bbox; return !!b && lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3]; }
    function vPolygonu(ring, lat, lng) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }
    // Z GPS → kód země. Obrysy (přesné na ~1 km) mají přednost; bbox je záloha do jejich
    // načtení A pro pobřeží (zjednodušený obrys mine přístav či souostroví — Stockholm) —
    // vybírá NEJMENŠÍ box, který bod obsahuje (Lichtenštejnsko před Švýcarskem).
    function urciZemi(lat, lng) {
        if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return null;
        if (_hranice) {
            var kandidati = [_st.posledni].concat(Object.keys(_hranice));
            for (var i = 0; i < kandidati.length; i++) {
                var rings = _hranice[kandidati[i]]; if (!rings) continue;
                for (var r = 0; r < rings.length; r++) if (vPolygonu(rings[r], lat, lng)) return kandidati[i];
            }
        }
        var best = null, bestA = Infinity;
        Object.keys(ZEME).forEach(function (k) {
            var z = ZEME[k]; if (!vBoxu(z, lat, lng)) return;
            var a = (z.bbox[2] - z.bbox[0]) * (z.bbox[3] - z.bbox[1]);
            if (a < bestA) { bestA = a; best = k; }
        });
        return best;
    }
    function aktivni() {
        var kod = _st.rezim === 'auto' ? _st.posledni : _st.rezim;
        return ZEME[kod] || SVET;
    }
    // Volá GPS handler (logika.js). Šetří: země se přepočítá nejvýš 1× za 3 s a jen po posunu.
    var _tsPoloha = 0, _lastLat = null, _lastLng = null;
    function poloha(lat, lng, hned) {
        if (lat == null || lng == null) return;
        _lat = lat; _lng = lng;
        var now = Date.now();
        if (!hned && now - _tsPoloha < 3000) return;
        if (!hned && _lastLat != null && Math.abs(lat - _lastLat) < 0.002 && Math.abs(lng - _lastLng) < 0.003) return;   // < ~200 m
        _tsPoloha = now; _lastLat = lat; _lastLng = lng;
        var k = urciZemi(lat, lng);
        if (k && k !== _st.posledni) { var pred = _st.posledni; _st.posledni = k; uloz(); if (_st.rezim === 'auto') zmena(pred, k); }
        else if (k) _st.posledni = k;
    }
    function nastav(kodNeboAuto) {
        var pred = aktivni().kod;
        _st.rezim = (kodNeboAuto && kodNeboAuto !== 'auto' && (ZEME[kodNeboAuto] || kodNeboAuto === 'XX')) ? kodNeboAuto : 'auto';
        uloz();
        var po = aktivni().kod;
        if (po !== pred) zmena(pred, po);
    }
    function zmena(pred, po) {
        _def = {};
        try { document.dispatchEvent(new CustomEvent('ag:zeme', { detail: { pred: pred, po: po, zeme: aktivni() } })); } catch (e) { swallow(e, 'event'); }
        try {
            var z = aktivni(), c = crsPro(z, _lat, _lng);
            if (typeof window.agInfo === 'function' && pred) window.agInfo('Jsi v zemi: ' + z.nazev + '. Souřadnice ' + c.nazev + ', výšky ' + z.vyska.nazev + '.');
        } catch (e) { swallow(e, 'toast'); }
    }
    function hranice(json) { if (json && typeof json === 'object') { _hranice = json; if (_lat != null) { _tsPoloha = 0; _lastLat = null; poloha(_lat, _lng); } } }

    // ---- převody ---------------------------------------------------------------------
    // {y, x}: y = PRVNÍ osa národního pořadí (Y v ČR, E v DE, X=sever v PL), x = DRUHÁ.
    // proj4 vrací [východ, sever] (Křovák [-Y, -X]); pořadí os říká crs.osy/vychod.
    function doMistnich(lat, lng) {
        var z = aktivni(), c = crsPro(z, lat, lng);
        var r = proj4('EPSG:4326', projId(c), [lng, lat]);
        var out;
        if (c.cad === 'krovak') out = { y: Math.abs(r[0]), x: Math.abs(r[1]) };
        else if (c.vychod === 'x') out = { y: r[1], x: r[0] };
        else out = { y: r[0], x: r[1] };
        out.crs = c; out.zeme = z.kod;
        return out;
    }
    function zMistnich(y, x) {
        var z = aktivni(), c = crsPro(z, _lat, _lng);
        var e, n;
        if (c.cad === 'krovak') { e = -Math.abs(y); n = -Math.abs(x); }
        else if (c.vychod === 'x') { e = x; n = y; }
        else { e = y; n = x; }
        var w = proj4(projId(c), 'EPSG:4326', [e, n]);
        // pásmový systém: pásmo se vybralo podle MÉ polohy; když vstup padne jinam, přepočítat podle výsledku
        if (c.zona) { var c2 = crsPro(z, w[1], w[0]); if (c2.id !== c.id) { w = proj4(projId(c2), 'EPSG:4326', [e, n]); } }
        return { lat: w[1], lng: w[0] };
    }
    // Souřadnice pro CAD/DXF: východ + sever v metrech (Křovák: x = −Y, y = −X jako doposud).
    function proCad(lat, lng) {
        var m = doMistnich(lat, lng), c = m.crs;
        if (c.cad === 'krovak') return { x: -m.y, y: -m.x };
        return c.vychod === 'x' ? { x: m.x, y: m.y } : { x: m.y, y: m.x };
    }
    // Inverze proCad: z CAD (východ, sever) zpět na WGS84.
    function zCad(x, y) {
        var c = crsPro(aktivni(), _lat, _lng);
        if (c.cad === 'krovak') return zMistnich(-x, -y);
        return c.vychod === 'x' ? zMistnich(y, x) : zMistnich(x, y);
    }
    function popisky(lat, lng) {
        var z = aktivni(), c = crsPro(z, lat != null ? lat : _lat, lng != null ? lng : _lng);
        return { zeme: z.kod, zemeNazev: z.nazev, osaA: c.osy[0], osaB: c.osy[1], system: c.nazev, epsg: c.epsg || null, vyska: z.vyska.nazev, vyskaNejista: !!z.vyska.nejiste, krovak: c.cad === 'krovak' };
    }
    // Stejný tvar textu jako dosud v kartě bodu: „Y: 742805.90 | X: 1043009.50" (v ČR beze změny).
    function text(lat, lng, des, odd) {
        var m = doMistnich(lat, lng), d = des == null ? 2 : des;
        return m.crs.osy[0] + ': ' + m.y.toFixed(d) + (odd || ' | ') + m.crs.osy[1] + ': ' + m.x.toFixed(d);
    }
    // Národní výška z elipsoidické: h − N(EGM2008) − posun. Undulaci dodá js/zeme-svet.js;
    // bez ní GeoCore (lineární vzorec ČR + oprava nejbližším bodem ČÚZK v logika.js).
    function undulace(lat, lng) {
        var N = null;
        try { if (window.AGGeoid && AGGeoid.N) N = AGGeoid.N(lat, lng); } catch (e) { swallow(e, 'geoid'); }
        if (N == null || !isFinite(N)) return null;
        return N + (aktivni().vyska.posun || 0);
    }
    function vyska(hEl, lat, lng) {
        if (hEl == null || !isFinite(hEl)) return null;
        var u = null;
        try { u = (typeof window.getGeoidUndulation === 'function') ? window.getGeoidUndulation(lat, lng) : (window.GeoCore ? GeoCore.geoidUndulation(lat, lng) : null); } catch (e) { swallow(e, 'vyska'); }
        if (u == null) return null;
        return { h: hEl - u, nazev: aktivni().vyska.nazev, nejiste: !!aktivni().vyska.nejiste };
    }

    // Popisky pro moduly: v ČR 'S-JTSK', 'Y', 'X', 'Bpv' (texty beze změny = klíče překladu drží).
    window.agOsy = function () { return popisky(); };
    window.agSys = function () { var p = popisky(); return p.krovak ? 'S-JTSK' : p.system; };

    window.AGSour = {
        ZEME: ZEME, SVET: SVET,
        aktivni: aktivni, kod: function () { return aktivni().kod; }, jeCZ: function () { return aktivni().kod === 'CZ'; },
        rezim: function () { return _st.rezim; }, nastav: nastav, urciZemi: urciZemi, poloha: poloha, hranice: hranice,
        maHranice: function () { return !!_hranice; }, poslPoloha: function () { return _lat == null ? null : { lat: _lat, lng: _lng }; },
        crs: function (lat, lng) { return crsPro(aktivni(), lat != null ? lat : _lat, lng != null ? lng : _lng); },
        doMistnich: doMistnich, zMistnich: zMistnich, proCad: proCad, zCad: zCad, popisky: popisky, text: text,
        undulace: undulace, vyska: vyska, utmZona: utmZona
    };
})();
