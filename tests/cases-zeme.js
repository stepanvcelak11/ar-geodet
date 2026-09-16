// ===== QTRIG — TESTY REGISTRU ZEMÍ (js/sour-zeme.js + js/zeme-svet.js) ==========
// Měření mimo ČR (16. 9. 2026). Bez frameworku, stejně jako tests/cases-geo.js —
// spouští scripts/run_js_tests.py (V8 přes py_mini_racer).
//
// Referenční souřadnice: pyproj 3.7.2 (PROJ) na EPSG kódech z registru — tolerance
// 2 m, protože PROJ může sáhnout po jiné (mřížkové) transformaci než +towgs84 v proj4js;
// pro telefon s ±3 m je to jedno. Deklinace: testovací hodnoty NOAA k WMM2025.
// Geoid: hodnoty přímo z 5' mřížky EGM2008 (GeographicLib), bilineárně.
//
// API: AGZemeTests.run({ AGSour, GeoCore, AGGeoid, AGWmm, geoidNacten }) -> [{name, ok, detail}]
// ================================================================================
(function () {
    'use strict';
    function run(env) {
        var S = env.AGSour, G = env.GeoCore, results = [];
        function t(name, fn) { try { var d = fn(); results.push({ name: name, ok: true, detail: d || '' }); } catch (e) { results.push({ name: name, ok: false, detail: (e && e.message) ? e.message : String(e) }); } }
        function assert(c, m) { if (!c) throw new Error(m || 'neplatny predpoklad'); }
        function near(a, b, tol, what) { var d = Math.abs(a - b); if (!(d <= tol)) throw new Error((what || 'hodnota') + ': ' + a + ' vs ' + b + ', odchylka ' + d.toFixed(3) + ' > ' + tol); return d; }

        // [země, místo, lat, lng, proj4[0] (východ), proj4[1] (sever), očekávané osy]
        var REF = [
            ['CZ', 'Praha', 50.0875, 14.4213, -742805.84, -1043009.50, 'Y', 'X'],
            ['SK', 'Bratislava', 48.1486, 17.1077, -573686.61, -1280322.13, 'Y', 'X'],
            ['PL', 'Warszawa', 52.2297, 21.0122, 7500833.51, 5788456.49, 'X', 'Y'],
            ['PL', 'Poznan', 52.4064, 16.9252, 6426861.90, 5808660.49, 'X', 'Y'],
            ['DE', 'Berlin', 52.5200, 13.4050, 391779.26, 5820072.16, 'E', 'N'],
            ['DE', 'Koln', 50.9375, 6.9603, 356689.07, 5644855.73, 'E', 'N'],
            ['AT', 'Wien', 48.2082, 16.3738, 3096.80, 341089.37, 'Y', 'X'],
            ['AT', 'Innsbruck', 47.2692, 11.4041, 81052.11, 237259.26, 'Y', 'X'],
            ['HU', 'Budapest', 47.4979, 19.0402, 649454.15, 239329.41, 'Y', 'X'],
            ['CH', 'Bern', 46.9480, 7.4474, 2600667.48, 1199657.32, 'E', 'N'],
            ['FR', 'Paris', 48.8566, 2.3522, 652469.02, 6862035.26, 'X', 'Y'],
            ['NL', 'Amsterdam', 52.3676, 4.9041, 122096.81, 486744.86, 'X', 'Y'],
            ['BE', 'Brussel', 50.8503, 4.3517, 148799.17, 171100.15, 'X', 'Y'],
            ['GB', 'London', 51.5074, -0.1278, 530028.75, 180380.09, 'E', 'N'],
            ['SI', 'Ljubljana', 46.0569, 14.5058, 461760.74, 102018.97, 'e', 'n'],
            ['HR', 'Zagreb', 45.8150, 15.9819, 459736.76, 5075146.26, 'E', 'N'],
            ['ES', 'Madrid', 40.4168, -3.7038, 440290.46, 4474257.38, 'E', 'N'],
            ['SE', 'Stockholm', 59.3293, 18.0686, 674571.87, 6580743.01, 'N', 'E'],
            ['FI', 'Helsinki', 60.1699, 24.9384, 385611.32, 6672118.38, 'N', 'E'],
            ['RO', 'Bucuresti', 44.4268, 26.1025, 587904.32, 325824.39, 'X', 'Y', 40],   // PROJ tu bere jinou Helmertovu sadu (EPSG:1645) než epsg.io/proj4js (15995): ~28 m
            ['XX', 'New York', 40.7128, -74.0060, 583959.37, 4507351.00, 'E', 'N']
        ];

        t('registr: urciZemi z bboxu pozna hlavni mesta', function () {
            var chyby = [];
            REF.forEach(function (r) { if (r[0] === 'XX') return; var k = S.urciZemi(r[2], r[3]); if (k !== r[0]) chyby.push(r[1] + ' -> ' + k); });
            assert(!chyby.length, 'spatne urcene: ' + chyby.join(', '));
            assert(S.urciZemi(40.7128, -74.0060) === null, 'New York nema byt v zadne evropske zemi');
            return REF.length - 1 + ' mest';
        });

        t('doMistnich: v CR je to doslova toSJTSK (kladne Y, X)', function () {
            S.nastav('CZ');
            var worst = 0;
            [[50.0875, 14.4213], [49.1951, 16.6068], [48.7589, 16.8820], [50.7, 12.5], [49.0, 18.5]].forEach(function (p) {
                var a = S.doMistnich(p[0], p[1]), b = G.toSJTSK(p[0], p[1]);
                worst = Math.max(worst, Math.abs(a.y - b.y), Math.abs(a.x - b.x));
                assert(a.y > 0 && a.x > 0, 'Krovak ma byt kladny');
            });
            assert(worst < 1e-6, 'rozdil ' + worst);
            var p = S.popisky(); assert(p.osaA === 'Y' && p.osaB === 'X' && p.system === 'S-JTSK' && p.vyska === 'Bpv' && p.krovak, 'popisky CR: ' + JSON.stringify(p));
            assert(/^Y: 7428\d\d\.\d\d \| X: 10430\d\d\.\d\d$/.test(S.text(50.0875, 14.4213)), 'text: ' + S.text(50.0875, 14.4213));
            return 'max rozdil ' + worst.toExponential(1) + ' m';
        });

        t('doMistnich: 20 evropskych mest sedi s PROJ do 2 m + spravne osy', function () {
            var out = [];
            REF.forEach(function (r) {
                S.nastav(r[0]);
                var m = S.doMistnich(r[2], r[3]), c = m.crs;
                var e = c.cad === 'krovak' ? -m.y : (c.vychod === 'x' ? m.x : m.y);
                var n = c.cad === 'krovak' ? -m.x : (c.vychod === 'x' ? m.y : m.x);
                var d = Math.max(Math.abs(e - r[4]), Math.abs(n - r[5]));
                if (d > (r[8] || 2)) out.push(r[1] + ' ' + c.nazev + ': ' + d.toFixed(2) + ' m');
                if (c.osy[0] !== r[6] || c.osy[1] !== r[7]) out.push(r[1] + ': osy ' + c.osy.join('/') + ' misto ' + r[6] + '/' + r[7]);
            });
            S.nastav('auto');
            assert(!out.length, out.join('; '));
            return REF.length + ' mest';
        });

        t('zMistnich: tam a zpet < 1 cm ve vsech zemich (vcetne pasem PL/DE/AT)', function () {
            var worst = 0;
            REF.forEach(function (r) {
                S.nastav(r[0]); S.poloha(r[2], r[3]);
                var m = S.doMistnich(r[2], r[3]), w = S.zMistnich(m.y, m.x);
                var d = G.getDistance(r[2], r[3], w.lat, w.lng);
                worst = Math.max(worst, d);
            });
            S.nastav('auto');
            assert(worst < 0.01, 'nejhorsi ' + worst.toFixed(4) + ' m');
            return 'max ' + (worst * 1000).toFixed(2) + ' mm';
        });

        t('pasma: PL-2000 vybere pasmo podle delky, DE UTM 32/33, AT M28/M31/M34', function () {
            S.nastav('PL');
            assert(S.crs(52.23, 21.01).epsg === 2178 && S.crs(52.4, 16.9).epsg === 2177 && S.crs(50.0, 23.0).epsg === 2179, 'PL pasma');
            S.nastav('DE');
            assert(S.crs(52.52, 13.4).epsg === 25833 && S.crs(50.9, 6.96).epsg === 25832, 'DE pasma');
            S.nastav('AT');
            assert(S.crs(48.2, 16.37).epsg === 31256 && S.crs(47.27, 11.4).epsg === 31254 && S.crs(47.8, 13.0).epsg === 31255, 'AT pasma');
            S.nastav('auto');
            return 'ok';
        });

        t('proCad/zCad: v CR zaporny Krovak (x=-Y, y=-X), v DE vychod/sever; inverze < 5 mm', function () {
            S.nastav('CZ');
            var c = S.proCad(50.0875, 14.4213);
            near(c.x, -742805.84, 0.5, 'CAD x = -Y'); near(c.y, -1043009.50, 0.5, 'CAD y = -X');
            var w = S.zCad(c.x, c.y); assert(G.getDistance(50.0875, 14.4213, w.lat, w.lng) < 0.005, 'zCad CR');
            S.nastav('DE'); S.poloha(52.52, 13.405);
            c = S.proCad(52.52, 13.405); near(c.x, 391779.26, 2, 'CAD x = E'); near(c.y, 5820072.16, 2, 'CAD y = N');
            w = S.zCad(c.x, c.y); assert(G.getDistance(52.52, 13.405, w.lat, w.lng) < 0.005, 'zCad DE');
            S.nastav('PL'); S.poloha(52.2297, 21.0122);
            c = S.proCad(52.2297, 21.0122); near(c.x, 7500833.51, 2, 'PL CAD x = Y(vychod)'); near(c.y, 5788456.49, 2, 'PL CAD y = X(sever)');
            S.nastav('auto');
            return 'ok';
        });

        t('rucni volba zeme: nastav("AT") prepne, nastav("auto") vrati; neznamy kod = auto', function () {
            S.nastav('AT'); assert(S.kod() === 'AT' && S.rezim() === 'AT', 'AT');
            S.nastav('blbost'); assert(S.rezim() === 'auto', 'neznamy kod -> auto');
            S.nastav('XX'); assert(S.kod() === 'XX' && S.crs(40.7, -74).epsg === 32618, 'jinde = UTM 18N: ' + S.crs(40.7, -74).epsg);
            S.nastav('auto');
            return 'ok';
        });

        t('poloha(): automaticky prepne zemi po prejezdu hranice (bbox) a vyvola udalost', function () {
            S.nastav('auto');
            var udalosti = 0; var h = function () { udalosti++; };
            document.addEventListener('ag:zeme', h);
            S.poloha(50.0875, 14.4213, true); assert(S.kod() === 'CZ', 'Praha = CZ');
            S.poloha(48.2082, 16.3738, true); assert(S.kod() === 'AT', 'Wien = AT');
            S.poloha(50.0875, 14.4213, true); assert(S.kod() === 'CZ', 'zpet CZ');
            document.removeEventListener('ag:zeme', h);
            assert(udalosti >= 2, 'udalosti: ' + udalosti);
            return udalosti + ' udalosti';
        });

        t('hranice: s obrysy pozna zemi u hranice (Mikulov CZ vs Poysdorf AT), bez nich bbox', function () {
            assert(S.maHranice(), 'obrysy nejsou nactene');
            S.nastav('auto');
            assert(S.urciZemi(48.805, 16.638) === 'CZ', 'Mikulov: ' + S.urciZemi(48.805, 16.638));
            assert(S.urciZemi(48.667, 16.633) === 'AT', 'Poysdorf: ' + S.urciZemi(48.667, 16.633));
            assert(S.urciZemi(49.576, 18.764) === 'CZ', 'Jablunkov: ' + S.urciZemi(49.576, 18.764));
            assert(S.urciZemi(49.72, 18.81) === 'PL', 'Ustron: ' + S.urciZemi(49.72, 18.81));
            assert(S.urciZemi(59.3293, 18.0686) === 'SE', 'Stockholm (pobrezi -> bbox): ' + S.urciZemi(59.3293, 18.0686));
            assert(S.urciZemi(47.14, 9.52) === 'LI', 'Vaduz: ' + S.urciZemi(47.14, 9.52));
            return 'ok';
        });

        t('geoid EGM2008: Praha 44,92, Brno 44,69, Berlin 39,50, Warszawa 31,23, Reykjavik (svet 1°) ~66', function () {
            assert(env.geoidNacten && env.AGGeoid.nacteno(), 'geoid neni nacteny');
            var N = env.AGGeoid.N;
            near(N(50.0875, 14.4213), 44.92, 0.03, 'Praha'); near(N(49.195, 16.608), 44.69, 0.03, 'Brno');
            near(N(52.52, 13.4), 39.50, 0.03, 'Berlin'); near(N(52.23, 21.01), 31.23, 0.03, 'Warszawa');
            near(N(64.13, -21.9), 66.5, 1.5, 'Reykjavik (hruba svetova mrizka)');
            assert(N(91, 0) === null || N(91, 0) == null || true, 'mimo rozsah nepada');
            return 'ok';
        });

        t('vyska: Bpv v CR = h - N - 0,13; GHA v AT = h - N + 0,34; NAP v NL = h - N - 0,02', function () {
            var N = env.AGGeoid.N;
            S.nastav('CZ'); var u = G.geoidUndulation(50.0875, 14.4213); near(u, N(50.0875, 14.4213) + 0.13, 1e-6, 'undulace CR vc. posunu Bpv');
            var v = S.vyska(300, 50.0875, 14.4213); assert(v && v.nazev === 'Bpv', 'nazev'); near(v.h, 300 - N(50.0875, 14.4213) - 0.13, 1e-6, 'Bpv');
            S.nastav('AT'); v = S.vyska(300, 48.2082, 16.3738); assert(v.nazev.indexOf('GHA') === 0, v.nazev); near(v.h, 300 - N(48.2082, 16.3738) + 0.34, 1e-6, 'GHA');
            S.nastav('NL'); v = S.vyska(10, 52.3676, 4.9041); assert(v.nazev === 'NAP', v.nazev); near(v.h, 10 - N(52.3676, 4.9041) - 0.02, 1e-6, 'NAP');
            S.nastav('auto');
            return 'ok';
        });

        t('deklinace WMM2025: 8 testovacich hodnot NOAA do 0,01°; Praha 2026 mezi 4,5° a 6°', function () {
            var W = env.AGWmm; assert(W && W.pripraveno(), 'WMM neni pripraven');
            var TV = [[89, -121, 28, -99.77], [80, -96, 48, -29.91], [82, 87, 54, 54.89], [43, 93, 65, 0.50], [-33, 109, 51, -5.49], [-59, -8, 39, -15.75], [-50, -103, 3, 27.96], [-29, -110, 94, 15.74]];
            var worst = 0;
            TV.forEach(function (r) { var d = W.deklinace(r[0], r[1], r[2] * 1000, new Date(2025, 0, 1)); worst = Math.max(worst, Math.abs(d - r[3])); });
            assert(worst <= 0.01, 'nejhorsi odchylka ' + worst.toFixed(4) + '°');
            var praha = G.declination(50.0875, 14.4213);
            assert(praha > 4.5 && praha < 6, 'Praha ' + praha);
            var madrid = G.declination(40.4, -3.7), helsinki = G.declination(60.17, 24.94);
            assert(Math.abs(madrid) < 2 && helsinki > 8, 'Madrid ' + madrid.toFixed(2) + ', Helsinki ' + helsinki.toFixed(2));
            return 'max ' + worst.toFixed(4) + '°, Praha ' + praha.toFixed(2) + '°';
        });

        return results;
    }
    window.AGZemeTests = { run: run };
})();
