// ===== AR Geodet — GEODETICKE TESTY (bezi v prohlizeci i bez nodu) =============
// Definice testu geodetickeho jadra (js/geo-core.js). Zadny framework — jen cista
// funkce, kterou zavola bud tests.html (prohlizec), nebo scripts/run_js_tests.py
// (Python + V8 pres py_mini_racer, protoze na vyvojarskem stroji neni node).
//
// Referencni hodnoty pochazi z autoritativniho PROJ (pyproj) na TOTOZNEM
// proj-stringu, jaky si appka nastavuje v js/logika.js — viz
// scripts/gen_geo_fixtures.py a tests/fixtures/geo-sjtsk.json.
//
// API: AGGeoTests.run({ GeoCore, proj4, fixtures }) -> [{ name, ok, detail }]
// ================================================================================
(function () {
    'use strict';

    function run(env) {
        var GeoCore = env.GeoCore, proj4 = env.proj4, fx = env.fixtures;
        var results = [];

        function t(name, fn) {
            try {
                var d = fn();
                results.push({ name: name, ok: true, detail: d || '' });
            } catch (e) {
                results.push({ name: name, ok: false, detail: (e && e.message) ? e.message : String(e) });
            }
        }
        function assert(cond, msg) { if (!cond) throw new Error(msg || 'neplatny predpoklad'); }
        function near(a, b, tol, what) {
            var d = Math.abs(a - b);
            if (!(d <= tol)) throw new Error((what || 'hodnota') + ': odchylka ' + d.toFixed(5) + ' > tolerance ' + tol);
            return d;
        }
        var TOL = fx.tolM;

        // ---- 1) POradi os a sebekontrola jadra ---------------------------------
        t('geo-core: selfTest() projde a osy jsou v poradi "ok"', function () {
            var st = GeoCore.selfTest();
            assert(st.axis === 'ok', 'osy hlaseny jako "' + st.axis + '" misto "ok" — proj4 zmenil chovani?');
            assert(st.ok === true, 'selfTest neprosel: ' + st.detail);
            return st.detail;
        });

        // Chrani samotnou DEFINICI projekce: kdyby nekdo v logika.js pridal +axis=
        // nebo bumpnul proj4 s jinym poradim, tohle padne driv, nez se to projevi
        // na souradnicich bodu v terenu.
        t('proj4: definice EPSG:5514 vraci [-Y, -X] presne jako PROJ', function () {
            var worst = 0, worstName = '';
            for (var i = 0; i < fx.points.length; i++) {
                var p = fx.points[i];
                var r = proj4('EPSG:4326', 'EPSG:5514', [p.lng, p.lat]);
                var d0 = Math.abs(r[0] - p.raw0), d1 = Math.abs(r[1] - p.raw1);
                var d = Math.max(d0, d1);
                if (d > worst) { worst = d; worstName = p.name; }
                if (!(d <= TOL)) {
                    throw new Error(p.name + ': proj4 vratil [' + r[0].toFixed(3) + ', ' + r[1].toFixed(3)
                        + '], PROJ ceka [' + p.raw0 + ', ' + p.raw1 + ']');
                }
            }
            return 'nejhorsi odchylka ' + worst.toFixed(4) + ' m (' + worstName + ')';
        });

        // ---- 2) toSJTSK proti referenci ----------------------------------------
        t('toSJTSK: 16 pojmenovanych bodu souhlasi s PROJ', function () {
            var worst = 0, worstName = '';
            for (var i = 0; i < fx.points.length; i++) {
                var p = fx.points[i];
                var s = GeoCore.toSJTSK(p.lat, p.lng);
                var d = Math.max(Math.abs(s.y - p.y), Math.abs(s.x - p.x));
                if (d > worst) { worst = d; worstName = p.name; }
                near(s.y, p.y, TOL, p.name + ' Y');
                near(s.x, p.x, TOL, p.name + ' X');
            }
            return 'nejhorsi odchylka ' + worst.toFixed(4) + ' m (' + worstName + ')';
        });

        t('toSJTSK: mrizka ' + fx.grid.length + ' bodu pres celou CR souhlasi s PROJ', function () {
            var worst = 0;
            for (var i = 0; i < fx.grid.length; i++) {
                var g = fx.grid[i];
                var s = GeoCore.toSJTSK(g.lat, g.lng);
                worst = Math.max(worst, Math.abs(s.y - g.y), Math.abs(s.x - g.x));
                near(s.y, g.y, TOL, 'mrizka lat=' + g.lat + ' lng=' + g.lng + ' Y');
                near(s.x, g.x, TOL, 'mrizka lat=' + g.lat + ' lng=' + g.lng + ' X');
            }
            return 'nejhorsi odchylka ' + worst.toFixed(4) + ' m';
        });

        // ---- 3) REGRESE na konkretni opravenou chybu ----------------------------
        // Drive: toSJTSK vracelo {y: min(|a|,|b|), x: max(|a|,|b|)}. Uvnitr CR to sedi
        // (Y < X vzdy), ale za hranicemi, kde |Y| > |X|, to osy TISE PROHODILO.
        t('REGRESE: body za hranicemi (|Y| > |X|) se NEPROHAZUJI', function () {
            var checked = 0, swapped = [];
            for (var i = 0; i < fx.points.length; i++) {
                var p = fx.points[i];
                if (!(p.y > p.x)) continue;          // jen body, kde stara heuristika selhavala
                checked++;
                var s = GeoCore.toSJTSK(p.lat, p.lng);
                // kdyby se osy prohodily, s.y by se rovnalo p.x
                if (Math.abs(s.y - p.x) < TOL && Math.abs(s.x - p.y) < TOL) swapped.push(p.name);
                near(s.y, p.y, TOL, p.name + ' Y (musi zustat vetsi nez X)');
                near(s.x, p.x, TOL, p.name + ' X');
                assert(s.y > s.x, p.name + ': ocekavano Y > X, doslo Y=' + s.y.toFixed(1) + ' X=' + s.x.toFixed(1));
            }
            assert(checked >= 2, 'fixtures musi obsahovat aspon 2 body s |Y| > |X| (regresni pojistka), je jich ' + checked);
            assert(swapped.length === 0, 'PROHOZENE osy u: ' + swapped.join(', '));
            return checked + ' bodu s Y > X, zadny prohozeny';
        });

        // Stejna trida chyby, jen z druhe strany: nekolik modulu (js/parcela.js,
        // js/csv-validate.js a zalohy v dalsich) melo VLASTNI prevod, ktery poradi os
        // urcoval podle VELIKOSTI — {Y: min(|a|,|b|), X: max(|a|,|b|)}, tedy „v CR je
        // Y < X". Uvnitr CR to sedi, mimo CR to osy TISE PROHODI. Tenhle test drzi duvod,
        // proc uz ta heuristika v appce neni a proc ji nikdo nesmi vratit zpatky.
        t('REGRESE: heuristika min/max prohazuje osy mimo CR (proto uz ji nikdo nepouziva)', function () {
            var selhava = [];
            for (var i = 0; i < fx.points.length; i++) {
                var p = fx.points[i];
                var a = Math.abs(p.raw0), b = Math.abs(p.raw1);
                var hY = Math.min(a, b), hX = Math.max(a, b);        // stara heuristika
                var s = GeoCore.toSJTSK(p.lat, p.lng);
                // GeoCore musi sedet s PROJ vzdycky, at heuristika rika cokoli
                near(s.y, p.y, TOL, p.name + ' Y');
                near(s.x, p.x, TOL, p.name + ' X');
                if (Math.abs(hY - s.y) > TOL || Math.abs(hX - s.x) > TOL) selhava.push(p.name);
            }
            assert(selhava.length >= 2, 'fixtures musi obsahovat aspon 2 body, kde stara heuristika '
                + 'selhava (regresni pojistka) — je jich ' + selhava.length);
            return 'min/max by prohodilo osy u: ' + selhava.join(', ');
        });

        // ---- 4) Zpetny prevod ---------------------------------------------------
        t('fromSJTSK: prevod tam a zpet je bezeztratovy (< 10 mm) na cele mrizce', function () {
            var worst = 0;
            for (var i = 0; i < fx.grid.length; i++) {
                var g = fx.grid[i];
                var s = GeoCore.toSJTSK(g.lat, g.lng);
                var b = GeoCore.fromSJTSK(s.y, s.x);
                var d = GeoCore.getDistance(g.lat, g.lng, b.lat, b.lng);
                worst = Math.max(worst, d);
                if (!(d < 0.01)) throw new Error('lat=' + g.lat + ' lng=' + g.lng + ': round-trip ' + d.toFixed(4) + ' m');
            }
            return 'nejhorsi round-trip ' + (worst * 1000).toFixed(2) + ' mm';
        });

        t('fromSJTSK: pozna prohozene zadani uzivatele (Y a X naopak)', function () {
            var lat = 49.8, lng = 15.5;
            var s = GeoCore.toSJTSK(lat, lng);
            var spravne = GeoCore.fromSJTSK(s.y, s.x);
            var naopak = GeoCore.fromSJTSK(s.x, s.y);      // uzivatel zamenil sloupce
            var d = GeoCore.getDistance(spravne.lat, spravne.lng, naopak.lat, naopak.lng);
            assert(d < 0.01, 'zamenene zadani nedalo stejny bod (rozdil ' + d.toFixed(3) + ' m)');
            return 'oba zapisy daly stejny bod';
        });

        // Appka drzi S-JTSK KLADNE, ale Krovak je nativne zaporny. Moduly, ktere si
        // prevod delaly samy (js/parcela.js), volaly proj4 rovnou se zapornymi cisly;
        // po prechodu na GeoCore posilaji kladna. Kdyby na znamenku zalezelo, parcela by
        // skocila na druhou stranu zemekoule a pri prohlidce by si toho nikdo nevsiml.
        t('fromSJTSK: kladne i zaporne zadani S-JTSK da tentyz bod', function () {
            var worst = 0;
            for (var i = 0; i < fx.grid.length; i++) {
                var g = fx.grid[i];
                var a = GeoCore.fromSJTSK(g.y, g.x);
                var b = GeoCore.fromSJTSK(-g.y, -g.x);
                worst = Math.max(worst, GeoCore.getDistance(a.lat, a.lng, b.lat, b.lng));
            }
            assert(worst < 0.001, 'znamenko zmenilo vysledek o ' + worst.toFixed(4) + ' m');
            return 'shoda na ' + fx.grid.length + ' bodech mrizky';
        });

        t('looksLikeSJTSK: pozna S-JTSK vs WGS84 vs nesmysl', function () {
            assert(GeoCore.looksLikeSJTSK(742805, 1043009) === true, 'platne S-JTSK oznaceno jako neplatne');
            assert(GeoCore.looksLikeSJTSK(1043009, 742805) === true, 'prohozene S-JTSK ma projit taky');
            assert(GeoCore.looksLikeSJTSK(50.08, 14.42) === false, 'WGS84 stupne oznaceny jako S-JTSK');
            assert(GeoCore.looksLikeSJTSK(0, 0) === false, 'nula oznacena jako S-JTSK');
            return 'ctyri pripady OK';
        });

        // ---- 5) Plocha a obvod --------------------------------------------------
        // Kvadrat o strane 100 m postaveny PRIMO v S-JTSK -> prevedeny na WGS84 ->
        // polygonAreaPerimeter ho musi vratit zpet jako 10 000 m2 a obvod 400 m.
        t('polygonAreaPerimeter: kvadrat 100x100 m da 10 000 m2 a obvod 400 m', function () {
            var Y0 = 742800, X0 = 1043000, S = 100;
            var corners = [[Y0, X0], [Y0 + S, X0], [Y0 + S, X0 + S], [Y0, X0 + S]];
            var verts = corners.map(function (c) { return GeoCore.fromSJTSK(c[0], c[1]); });
            var r = GeoCore.polygonAreaPerimeter(verts);
            near(r.area, S * S, 0.05, 'vymera');
            near(r.perim, 4 * S, 0.02, 'obvod');
            return 'vymera ' + r.area.toFixed(4) + ' m2, obvod ' + r.perim.toFixed(4) + ' m';
        });

        t('polygonAreaPerimeter: degenerovane vstupy nepadaji', function () {
            assert(GeoCore.polygonAreaPerimeter([]).area === 0, 'prazdne pole');
            assert(GeoCore.polygonAreaPerimeter(null).area === 0, 'null');
            var one = GeoCore.polygonAreaPerimeter([{ lat: 50, lng: 15 }]);
            assert(one.area === 0 && one.perim === 0, 'jediny vrchol');
            return 'tri pripady OK';
        });

        // ---- 6) Metry na stupen, ENU -------------------------------------------
        // Referencni hodnoty spocitane nezavisle ze vzorcu GRS80 (poloměry křivosti);
        // tolerance 1 cm/stupen je tesna schvalne — jde o uzavreny vzorec, ne o mereni.
        t('metersPerDeg: presne hodnoty pro 49 a 50 stupnu (GRS80)', function () {
            var m50 = GeoCore.metersPerDeg(50);
            near(m50.lat, 111229.064, 0.01, 'meridian 50 stupnu');
            near(m50.lng, 71695.754, 0.01, 'rovnobezka 50 stupnu');
            var m49 = GeoCore.metersPerDeg(49);
            near(m49.lat, 111209.738, 0.01, 'meridian 49 stupnu');
            near(m49.lng, 73171.793, 0.01, 'rovnobezka 49 stupnu');
            // Regrese na drivejsi konstantu 111320 m/stupen pouzitou pro OBE osy: delka
            // se od sirky v CR lisi o ~36 %, takze zamena je okamzite videt.
            assert(m50.lng < m50.lat * 0.7, 'delkovy prevod je podezrele blizko sirkovemu (stara konstanta 111320?)');
            return 'chyba stare konstanty byla ' + (111320 - m50.lat).toFixed(0) + ' m/stupen sirky';
        });

        t('ENU: vzdalenost se od haversine lisi < 0,1 % na 1,4 km', function () {
            var lat = 50.0755, lng = 14.4378;
            var e = GeoCore.enuForward(lat, lng, lat + 0.009, lng + 0.014);
            var dEnu = Math.hypot(e.e, e.n);
            var dHav = GeoCore.getDistance(lat, lng, lat + 0.009, lng + 0.014);
            var rel = Math.abs(dEnu - dHav) / dHav;
            assert(rel < 0.001, 'rozdil ' + (rel * 100).toFixed(4) + ' % (ENU ' + dEnu.toFixed(2)
                + ' m vs haversine ' + dHav.toFixed(2) + ' m)');
            return 'ENU ' + dEnu.toFixed(2) + ' m vs haversine ' + dHav.toFixed(2) + ' m ('
                + (rel * 100).toFixed(4) + ' %)';
        });

        t('ENU: enuForward a enuToLatLng jsou navzajem inverzni (< 1 mm)', function () {
            var oLat = 49.8, oLng = 15.5, worst = 0;
            var cases = [[0, 0], [100, 0], [0, 100], [-250, 380], [1500, -1500]];
            for (var i = 0; i < cases.length; i++) {
                var e = cases[i][0], n = cases[i][1];
                var p = GeoCore.enuToLatLng(oLat, oLng, e, n);
                var b = GeoCore.enuForward(oLat, oLng, p.lat, p.lng);
                worst = Math.max(worst, Math.abs(b.e - e), Math.abs(b.n - n));
            }
            assert(worst < 0.001, 'nejhorsi rozdil ' + worst.toFixed(6) + ' m');
            return 'nejhorsi rozdil ' + (worst * 1000).toFixed(4) + ' mm';
        });

        // ENU (tecna rovina, pouziva ji AR) a rovina S-JTSK (pouzivaji ji vystupy) NEJSOU
        // totozne: Krovak je kuzelova projekce s meritkem k=0.9999, takze delka na papire
        // neni delka na zemi. Zmereno pres CR (scripts/run_js_tests.py): typicky -110 az
        // +250 ppm, v severovychodnim rohu az +570 ppm. To je 1-57 cm na kilometr.
        //
        // Test tedy NEtvrdi, ze se to rovna — hlida, ze zkresleni zustava v ZNAMEM rozsahu.
        // Kdyby nekdo prepsal metersPerDeg nebo enuForward, cislo uteče a tohle to chytne.
        // Pro uzivatele: na obvyklou dosahovou vzdalenost AR (< 200 m) je to < 12 cm v tom
        // nejhorsim rohu a < 3 cm ve vetsine CR, tedy pod sumem GPS.
        t('ENU vs S-JTSK: meritkove zkresleni Krovaka zustava v znamem rozsahu (< 700 ppm)', function () {
            var LIMIT_PPM = 700;
            var spots = [[49.8, 15.5], [48.7, 12.5], [50.4, 18.5], [51.0, 14.0], [49.2, 17.0]];
            var worst = 0, worstAt = '';
            for (var i = 0; i < spots.length; i++) {
                var oLat = spots[i][0], oLng = spots[i][1];
                var p = GeoCore.enuToLatLng(oLat, oLng, 300, 400);        // 500 m sikmo
                var a = GeoCore.toSJTSK(oLat, oLng), b = GeoCore.toSJTSK(p.lat, p.lng);
                var jtskD = Math.hypot(b.y - a.y, b.x - a.x);
                var ppm = Math.abs(jtskD - 500) / 500 * 1e6;
                if (ppm > worst) { worst = ppm; worstAt = oLat + ',' + oLng; }
            }
            assert(worst < LIMIT_PPM, 'zkresleni ' + worst.toFixed(0) + ' ppm u ' + worstAt
                + ' presahlo ' + LIMIT_PPM + ' ppm — zmenil se prevod ENU nebo metersPerDeg?');
            return 'nejhorsi ' + worst.toFixed(0) + ' ppm (' + worstAt + ') = '
                + (worst / 1e6 * 1000 * 1000).toFixed(0) + ' mm/km';
        });

        // ---- 7) Uhly ------------------------------------------------------------
        t('angDiff: spravne prechazi pres 0/360', function () {
            near(GeoCore.angDiff(10, 350), 20, 1e-9, 'angDiff(10,350)');
            near(GeoCore.angDiff(350, 10), -20, 1e-9, 'angDiff(350,10)');
            near(GeoCore.angDiff(0, 0), 0, 1e-9, 'angDiff(0,0)');
            near(GeoCore.angDiff(90, 0), 90, 1e-9, 'angDiff(90,0)');
            // Presne 180 stupnu je oboustranne: +180 i -180 je spravne (nelze rozhodnout,
            // kterou stranou). Testuje se tedy VELIKOST, ne znamenko — jinak by test
            // zaviselo na implementacnim detailu modula, ne na spravnosti.
            near(Math.abs(GeoCore.angDiff(180, 0)), 180, 1e-9, '|angDiff(180,0)|');
            // Vysledek musi vzdy padnout do <-180, 180>
            var vals = [[0, 359], [359, 0], [1, 181], [181, 1], [270, 10]];
            for (var i = 0; i < vals.length; i++) {
                var r = GeoCore.angDiff(vals[i][0], vals[i][1]);
                assert(r >= -180 && r <= 180, 'angDiff(' + vals[i] + ') = ' + r + ' je mimo <-180,180>');
            }
            return 'pet pripadu + rozsah OK';
        });

        t('smoothAngle: nejde "dlouhou cestou" pres 359 -> 1', function () {
            var r = GeoCore.smoothAngle(359, 1, 0.5);
            assert(r >= 359.5 || r <= 0.5, 'vyhlazeni skocilo na ' + r.toFixed(2) + ' misto okoli 0');
            assert(GeoCore.smoothAngle(null, 123.5, 0.5) === 123.5, 'prvni vzorek se ma vzit tak, jak je');
            var s = GeoCore.smoothAngle(0, 90, 1);
            near(s, 90, 1e-9, 'alpha=1 ma prevzit novou hodnotu');
            return 'r(359->1)=' + r.toFixed(2);
        });

        // ---- 7b) VZDALENOST proti geodetice WGS84 -------------------------------
        // Reference je presne reseni na elipsoidu (pyproj Geod.inv), ne jina aproximace.
        // REGRESE na konkretni opravenou chybu: haversine s globalnim polomerem 6371 km
        // zkracoval v CR kazdou vzdalenost o ~1700 ppm (34 cm na 200 m) — vcetne cisla
        // na stitku AR znacky. Kdyby se polomer vratil na konstantu, tenhle test spadne.
        t('getDistance: souhlasi s geodetikou WGS84 do ' + fx.distances.tolPpm + ' ppm', function () {
            var pairs = fx.distances.pairs, lim = fx.distances.tolPpm;
            var worst = 0, worstAt = '';
            for (var i = 0; i < pairs.length; i++) {
                var p = pairs[i];
                var d = GeoCore.getDistance(p.lat1, p.lng1, p.lat2, p.lng2);
                var ppm = Math.abs(d - p.m) / p.m * 1e6;
                if (ppm > worst) { worst = ppm; worstAt = p.at; }
                if (!(ppm <= lim)) {
                    throw new Error(p.at + ': ' + d.toFixed(4) + ' m vs geodetika ' + p.m
                        + ' m = ' + ppm.toFixed(0) + ' ppm (limit ' + lim + ')');
                }
            }
            return 'nejhorsi ' + worst.toFixed(0) + ' ppm (' + worstAt + '), tj. '
                + (worst / 1e6 * 200 * 100).toFixed(2) + ' cm na 200 m';
        });

        t('REGRESE: getDistance uz nepouziva globalni polomer 6371 km', function () {
            // Kontrolni bod v CR: rozdil mezi spravnym a starym vypoctem je ~1700 ppm.
            // Test overuje, ze vysledek je BLIZ geodetice, ne stare hodnote.
            var p = fx.distances.pairs[0];
            var d = GeoCore.getDistance(p.lat1, p.lng1, p.lat2, p.lng2);
            var stary = p.m * (1 - 1705e-6);            // co by vratil polomer 6371 km
            var kSpravnemu = Math.abs(d - p.m), kStaremu = Math.abs(d - stary);
            assert(kSpravnemu < kStaremu, 'vysledek je bliz staremu (6371 km) vypoctu: '
                + d.toFixed(3) + ' m, geodetika ' + p.m + ' m, stary vzorec ' + stary.toFixed(3) + ' m');
            return 'odchylka od geodetiky ' + (kSpravnemu * 1000).toFixed(1)
                + ' mm, od stareho vzorce ' + (kStaremu * 1000).toFixed(0) + ' mm';
        });

        // Kvantifikuje chybu, kvuli ktere se z modulu vyhazely vlastni kopie haversinu
        // s konstantou R = 6371 km (globalni stredni polomer Zeme). V sirkach CR je
        // Gaussuv polomer ~6382 km, takze kulova verze KAZDOU vzdalenost zkracuje.
        // Test nemeri GeoCore, ale samotnou konstantu: drzi cislo, ktere se cituje
        // v poznamkach u opravenych modulu (~17 cm na 100 m), aby se nikdy nerozeslo
        // s realitou a aby bylo videt, oc presne slo, kdyby ji nekdo chtel vratit.
        t('REGRESE: konstanta R = 6371 km zkracuje vzdalenosti o ~1600 ppm (17 cm na 100 m)', function () {
            var R = 6371000, r = Math.PI / 180;
            var pairs = fx.distances.pairs, minPpm = 1e9, maxPpm = -1e9;
            for (var i = 0; i < pairs.length; i++) {
                var p = pairs[i];
                var f1 = p.lat1 * r, f2 = p.lat2 * r;
                var df = (p.lat2 - p.lat1) * r, dl = (p.lng2 - p.lng1) * r;
                var h = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
                var kulova = R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
                var spravne = GeoCore.getDistance(p.lat1, p.lng1, p.lat2, p.lng2);
                var ppm = (spravne - kulova) / spravne * 1e6;        // kladne = kulova je KRATSI
                minPpm = Math.min(minPpm, ppm); maxPpm = Math.max(maxPpm, ppm);
            }
            assert(minPpm > 1450 && maxPpm < 1900, 'ocekavano zkraceni 1450-1900 ppm, zmereno '
                + minPpm.toFixed(0) + '-' + maxPpm.toFixed(0) + ' ppm — zmenil se vypocet polomeru?');
            return 'kulova aproximace je kratsi o ' + minPpm.toFixed(0) + '-' + maxPpm.toFixed(0)
                + ' ppm, tj. az ' + (maxPpm / 1e6 * 100 * 100).toFixed(1) + ' cm na 100 m';
        });

        t('getBearing: hlavni smery', function () {
            near(GeoCore.getBearing(49.8, 15.5, 50.8, 15.5), 0, 0.01, 'na sever');
            near(GeoCore.getBearing(49.8, 15.5, 48.8, 15.5), 180, 0.01, 'na jih');
            var e = GeoCore.getBearing(49.8, 15.5, 49.8, 16.5);
            assert(Math.abs(e - 90) < 0.5, 'na vychod: ' + e.toFixed(3));
            return 'sever/jih/vychod OK';
        });

        // ---- 8) Deklinace, geoid ------------------------------------------------
        t('declination: Praha v pasmu 5-7 stupnu a clamp mimo CR', function () {
            var praha = GeoCore.declination(50.0755, 14.4378);
            assert(praha > 5 && praha < 7, 'deklinace Prahy mimo pasmo 5-7 stupnu: ' + praha.toFixed(2));
            var d = GeoCore.declination(49.8, 15.5);
            assert(d > 3 && d < 9, 'deklinace ve stredu CR mimo rozsah 3-9 stupnu: ' + d.toFixed(2));
            // Mimo bbox se vstup priskripne k okraji — zadna extrapolace do nesmyslu
            // (importovana zahranicni zakazka nesmi dat deklinaci 40 stupnu).
            near(GeoCore.declination(0, 0), GeoCore.declination(48.4, 11.9), 1e-9, 'clamp na jihozapadni okraj');
            near(GeoCore.declination(80, 60), GeoCore.declination(51.2, 19.0), 1e-9, 'clamp na severovychodni okraj');
            return 'Praha ' + praha.toFixed(2) + ' stupnu';
        });

        t('geoidUndulation: Praha ~44,81 m a v CR rozumny rozsah', function () {
            near(GeoCore.geoidUndulation(50.0755, 14.4378), 44.81, 0.05, 'undulace Praha');
            var u = GeoCore.geoidUndulation(49.8, 15.5);
            assert(u > 40 && u < 50, 'undulace ve stredu CR mimo rozsah: ' + u.toFixed(2));
            return 'Praha ' + GeoCore.geoidUndulation(50.0755, 14.4378).toFixed(2) + ' m';
        });

        // ---- 9) Statistika GPS --------------------------------------------------
        // Smysl effectiveN: po sobe jdouci GPS fixy nejsou nezavisle, takze prosty N
        // dramaticky nadhodnocuje presnost prumeru. Testuje se OBA konce: nezavisly sum
        // musi dat ~N, pomalu plovouci (korelovana) rada musi dat radove mensi cislo.
        t('effectiveN: nezavisly sum da ~N, korelovana rada radove mensi', function () {
            var N = 20, xs = [], ys = [], ts = [];
            for (var i = 0; i < N; i++) { xs.push(i % 2 ? 1 : -1); ys.push(i % 2 ? -1 : 1); ts.push(i * 30000); }
            var neIndep = GeoCore.effectiveN(xs, ys, ts, 30);
            assert(neIndep > N * 0.9, 'nezavisly sum dal jen neff=' + neIndep.toFixed(1) + ' z N=' + N);

            var xs2 = [], ys2 = [], ts2 = [];
            for (var j = 0; j < 120; j++) { xs2.push(Math.sin(j / 25)); ys2.push(Math.cos(j / 25)); ts2.push(j * 1000); }
            var neCorr = GeoCore.effectiveN(xs2, ys2, ts2, 30);
            assert(neCorr < 10, 'korelovana rada dala neff=' + neCorr.toFixed(1) + ' (drivejsi N/4 by dalo 30)');

            var n3 = 60, xs3 = [], ys3 = [], ts3 = [];
            for (var k = 0; k < n3; k++) { xs3.push(0.1); ys3.push(0.1); ts3.push(k * 1000); }
            var neFlat = GeoCore.effectiveN(xs3, ys3, ts3, 30);
            assert(neFlat >= 1 && neFlat <= n3, 'mimo rozsah <1,N>: ' + neFlat);
            assert(GeoCore.effectiveN([1], null, [0], 30) === 1, 'jediny vzorek musi dat 1');
            return 'nezavisle ' + neIndep.toFixed(1) + '/' + N + ', korelovane ' + neCorr.toFixed(1) + '/120';
        });

        return results;
    }

    var root = (typeof window !== 'undefined') ? window : this;
    root.AGGeoTests = { run: run };
})();
