// ===== AR Geodet — DLAŽDICE PODKLADU PRO HODINKY (ODPOJITELNÁ VRSTVA) ========
// Stáhne z OpenStreetMap okolí, zjednoduší ho na pár set čar a nahraje jako
// dlaždice na server. Hodinky si je pak při synchronizaci vyzvednou a kreslí
// pod body — cesty, vodu, zeleň a hlavně srázy, kudy se neprojde.
//
// PROČ TO POČÍTÁ MOBIL A NE SERVER: Cloudflare Worker má na free plánu 10 ms
// procesoru na požadavek. Rozebrat skoro dvoumegovou odpověď z Overpassu
// a prohnat ji Douglas–Peuckerem by ten strop rozmetalo. Mobil výkon má
// a hodí se to i časově — mapa se připraví doma před výjezdem, ne v poli.
// Server je proto POUZE SKLAD.
//
// PROČ SE TO NEPOČÍTÁ AŽ V HODINKÁCH: Monkey C je tak pomalý, že tam shodilo
// aplikaci ("Watchdog Tripped") i pouhé seskupení pěti set čar podle třídy.
// Hodinky dostávají data hotová — včetně obálek a pořadí podle důležitosti.
//
// FORMÁT DLAŽDICE (musí sedět s garmin/hodinky/source/Podklad.mc):
//   {a:[lat,lon], r:700,
//    p:[[třída, minx,miny,maxx,maxy, x,y, …], …]   plochy
//    l:[[třída, minx,miny,maxx,maxy, x,y, …], …]}  čáry
// Souřadnice jsou CELÁ ČÍSLA v DECIMETRECH od kotvy. Na displeji, kde 700 m
// odpovídá stovce pixelů, je decimetr hluboko pod rozlišením a celá čísla se
// v paměti hodinek drží mnohem líp než desetinná.
//
// Zdroj dat: OpenStreetMap, licence ODbL.
//
// ODPOJENÍ: smaž tento soubor a jeho <script> v index.html.
(function () {
    'use strict';

    var OVERPASS = 'https://overpass-api.de/api/interpreter';
    var KROK = 0.005;          // mřížka dlaždic ve stupních (v ČR ~560 × 360 m)
    // Poloměr, co dlaždice pokrývá kolem SVÉ KOTVY — ne kolem člověka.
    // Kotva je nejbližší bod mřížky, od které člověk může stát až ~330 m,
    // takže při dřívějších 450 m zbývalo v nejhorším směru jen ~120 m mapy.
    // Se 700 m je zaručeno přes 350 m na všechny strany a obvykle mnohem víc.
    var DOSAH = 700;
    var TOL = 5.0;             // Douglas–Peucker [m]

    // třídy — musí sedět s Podklad.mc
    var SILNICE = 1, CESTA = 2, PESINA = 3, VODNI_TOK = 4, PREKAZKA = 6;
    var ZELEN = 10, POLE = 11, VODA = 12, BUDOVA = 13;
    var PLOCHY = [ZELEN, POLE, VODA, BUDOVA];
    var PORADI_CAR = [PREKAZKA, SILNICE, VODNI_TOK, CESTA, PESINA];
    var PORADI_PLOCH = [VODA, ZELEN, POLE, BUDOVA];

    // Stropy na dlaždici. Sníženy na polovinu: hodinky stejně nakreslí
    // nejvýš 90 úseků na snímek, takže zbytek se nikdy neukáže — jen se
    // přenáší po bluetooth a zabírá paměť, kterou watch app nemá nazbyt.
    var STROP_CAR = 350, STROP_PLOCH = 200, STROP_BUDOV = 40;

    var A = 6378137.0, E2 = 0.00669437999014;

    function polomery(latRad) {
        var s = Math.sin(latRad), w = 1 - E2 * s * s;
        return [A * (1 - E2) / (w * Math.sqrt(w)), A / Math.sqrt(w)];
    }

    function klic(lat, lon) {
        return Math.round(lat / KROK) + '_' + Math.round(lon / KROK);
    }

    // ---- klasifikace ---------------------------------------------------

    function trida(t) {
        if (!t) return null;
        // Chodníky a přechody jsou ve městech mapované jako samostatné čáry
        // a je jich násobně víc než všeho ostatního. Pro otázku „kudy se tam
        // dostanu" neříkají nic a displej by z toho byl šedý.
        if (t.footway === 'sidewalk' || t.footway === 'crossing' || t.path === 'sidewalk') return null;
        if (t.highway === 'service' && (t.service === 'parking_aisle' || t.service === 'driveway')) return null;

        if (t.building) return BUDOVA;
        if (t.natural === 'cliff' || t.natural === 'earth_bank' || t.man_made === 'embankment'
            || t.barrier === 'wall' || t.barrier === 'fence' || t.barrier === 'hedge'
            || t.barrier === 'retaining_wall' || t.barrier === 'guard_rail' || t.barrier === 'city_wall') return PREKAZKA;

        if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin') return VODA;
        if (t.waterway) return VODNI_TOK;

        var lu = t.landuse, nat = t.natural, lei = t.leisure;
        if (lu === 'forest' || lu === 'grass' || lu === 'village_green' || lu === 'flowerbed'
            || lu === 'cemetery' || lu === 'recreation_ground'
            || nat === 'wood' || nat === 'scrub' || nat === 'heath'
            || lei === 'park' || lei === 'garden' || lei === 'pitch' || lei === 'golf_course') return ZELEN;
        if (lu === 'meadow' || lu === 'farmland' || lu === 'orchard' || lu === 'vineyard'
            || lu === 'allotments' || lu === 'greenfield' || nat === 'grassland') return POLE;

        var h = t.highway;
        if (h) {
            if (h === 'footway' || h === 'path' || h === 'cycleway' || h === 'steps' || h === 'pedestrian') return PESINA;
            if (h === 'track' || h === 'bridleway') return CESTA;
            return SILNICE;
        }
        return null;
    }

    // ---- zjednodušení --------------------------------------------------

    function dp(b, tol) {
        if (b.length < 3) return b;
        var x1 = b[0][0], y1 = b[0][1], x2 = b[b.length - 1][0], y2 = b[b.length - 1][1];
        var dx = x2 - x1, dy = y2 - y1, norm = Math.sqrt(dx * dx + dy * dy);
        var dmax = 0, idx = 0;
        for (var i = 1; i < b.length - 1; i++) {
            var px = b[i][0], py = b[i][1], d;
            if (norm === 0) d = Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
            else d = Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm;
            if (d > dmax) { dmax = d; idx = i; }
        }
        if (dmax <= tol) return [b[0], b[b.length - 1]];
        return dp(b.slice(0, idx + 1), tol).slice(0, -1).concat(dp(b.slice(idx), tol));
    }

    function vrcholu(z) { return Math.max(0, (z.length - 5) >> 1); }

    // Seřadí podle důležitosti a usekne na strop. Co se nevešlo, se vrátí
    // jako počet — ať to jde uživateli říct, ne zamlčet.
    function orez(sez, strop, poradi) {
        sez.sort(function (a, b) {
            var pa = poradi.indexOf(a[0]), pb = poradi.indexOf(b[0]);
            if (pa < 0) pa = 99; if (pb < 0) pb = 99;
            return (pa - pb) || (vrcholu(b) - vrcholu(a));
        });
        var ven = [], v = 0, budov = 0;
        for (var i = 0; i < sez.length; i++) {
            var z = sez[i];
            if (z[0] === BUDOVA) {
                if (budov >= STROP_BUDOV) continue;
                budov++; ven.push(z); continue;
            }
            if (v + vrcholu(z) > strop) continue;
            ven.push(z); v += vrcholu(z);
        }
        return ven;
    }

    // ---- jedna dlaždice ------------------------------------------------

    function dlazdice(prvky, lat0, lon0) {
        var pr = polomery(lat0 * Math.PI / 180);
        var M = pr[0], N = pr[1], kos = Math.cos(lat0 * Math.PI / 180);
        var cary = [], plochy = [];

        for (var e = 0; e < prvky.length; e++) {
            var p = prvky[e];
            if (p.type !== 'way' || !p.geometry) continue;
            var t = trida(p.tags);
            if (t === null) continue;

            var body = [], uvnitr = false;
            for (var i = 0; i < p.geometry.length; i++) {
                var g = p.geometry[i];
                var x = N * ((g.lon - lon0) * Math.PI / 180) * kos;
                var y = M * ((g.lat - lat0) * Math.PI / 180);
                body.push([x, y]);
                if (!uvnitr && Math.sqrt(x * x + y * y) <= DOSAH) uvnitr = true;
            }
            if (!uvnitr || body.length < 2) continue;

            var zj = dp(body, TOL);
            if (zj.length < 2) continue;

            var xs = [], ys = [], j;
            for (j = 0; j < zj.length; j++) { xs.push(zj[j][0]); ys.push(zj[j][1]); }
            var z = [t,
                Math.round(Math.min.apply(null, xs) * 10), Math.round(Math.min.apply(null, ys) * 10),
                Math.round(Math.max.apply(null, xs) * 10), Math.round(Math.max.apply(null, ys) * 10)];

            // Budova nese JEN obálku — kreslí se jako šrafovaný obdélník,
            // skutečný půdorys by na 260px displeji nikdo nepoznal.
            if (t !== BUDOVA) {
                for (j = 0; j < zj.length; j++) {
                    z.push(Math.round(zj[j][0] * 10));
                    z.push(Math.round(zj[j][1] * 10));
                }
            }
            (PLOCHY.indexOf(t) >= 0 ? plochy : cary).push(z);
        }

        return {
            a: [Math.round(lat0 * 1e6) / 1e6, Math.round(lon0 * 1e6) / 1e6],
            r: DOSAH,
            l: orez(cary, STROP_CAR, PORADI_CAR),
            p: orez(plochy, STROP_PLOCH, PORADI_PLOCH)
        };
    }

    // ---- stažení a odeslání --------------------------------------------

    function dotaz(lat, lon, r) {
        return '[out:json][timeout:60];('
            + ['highway', 'waterway', 'barrier', 'natural', 'landuse', 'leisure', 'building']
                .map(function (k) { return 'way(around:' + r + ',' + lat + ',' + lon + ')["' + k + '"];'; }).join('')
            + 'way(around:' + r + ',' + lat + ',' + lon + ')["man_made"="embankment"];'
            + ');out geom;';
    }

    //! Připraví 3×3 dlaždice kolem polohy z JEDNOHO dotazu na Overpass.
    //! Devět samostatných dotazů by bylo neslušné vůči veřejné službě
    //! i pomalé; jeden širší se rozkrájí lokálně.
    function pripravOkoli(lat, lon, hlas) {
        hlas('stahuji OpenStreetMap…');
        return fetch(OVERPASS, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: dotaz(lat, lon, 1500)
        }).then(function (r) {
            if (!r.ok) throw new Error('overpass ' + r.status);
            return r.json();
        }).then(function (d) {
            var prvky = (d && d.elements) || [];
            hlas('počítám dlaždice (' + prvky.length + ' prvků)…');

            var i0 = Math.round(lat / KROK), j0 = Math.round(lon / KROK);
            var out = [];
            for (var di = -1; di <= 1; di++) {
                for (var dj = -1; dj <= 1; dj++) {
                    var la = (i0 + di) * KROK, lo = (j0 + dj) * KROK;
                    var t = dlazdice(prvky, la, lo);
                    if (!t.l.length && !t.p.length) continue;      // prázdné neposílat
                    t.k = klic(la, lo);
                    out.push(t);
                }
            }
            return out;
        });
    }

    window.AGHodinkyDlazdice = {
        pripravOkoli: pripravOkoli,
        klic: klic
    };
})();
