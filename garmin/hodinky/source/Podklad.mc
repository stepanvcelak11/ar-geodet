using Toybox.Application;
using Toybox.Graphics;
using Toybox.Math;
using Toybox.WatchUi;

//! Vektorový podklad pod body — plochy, čáry cest a překážky.
//!
//! Do vestavěné mapy hodinek se aplikace Connect IQ nedostane, takže se
//! kreslí vlastní obraz. Dlaždice je schválně hloupá a plochá:
//!
//!   {"a":[lat,lon], "r":dosah_m,
//!    "p":[[třída, minx,miny,maxx,maxy, x,y, …], …]   plochy
//!    "l":[[třída, minx,miny,maxx,maxy, x,y, …], …]}  čáry
//!
//! Souřadnice jsou CELÁ ČÍSLA v DECIMETRECH od kotvy (x k východu, y k
//! severu). Na displeji, kde 450 m odpovídá zhruba stovce pixelů, je
//! decimetr hluboko pod rozlišením, a celá čísla se v paměti hodinek drží
//! mnohem líp než desetinná.
//!
//! Obálka každého prvku i pořadí podle důležitosti se počítají PŘEDEM, ve
//! skriptu garmin/nastroje/dlazdice.py. Hodinky na to nemají: pouhé
//! seskupení pěti set čar podle třídy tady shodilo aplikaci hláškou
//! „Watchdog Tripped — Code Executed Too Long“.
//!
//! Význam nese BARVA, ne tloušťka. Tloušťku si nikdo nezapamatuje;
//! „zelená je les, žlutá pole, červená se neprojde“ ano.
//!
//! Zdroj dat: OpenStreetMap, licence ODbL.
module Podklad {

    // čáry
    const SILNICE   = 1;
    const CESTA     = 2;
    const PESINA    = 3;
    const VODNI_TOK = 4;
    const PREKAZKA  = 6;
    // plochy
    const ZELEN  = 10;
    const POLE   = 11;
    const VODA   = 12;
    const BUDOVA = 13;

    //! Barvy se zadávají přímo v RGB, ne přes Graphics.COLOR_* — hotové
    //! konstanty nemají tmavé odstíny a jasná zeleň přes celou plochu by
    //! na černém podkladu přebila body, kvůli kterým to celé je.
    const B_ZELEN    = 0x005500;
    const B_POLE     = 0x555500;
    const B_VODA     = 0x003366;
    const B_BUDOVA   = 0x666666;
    const B_SRAFA    = 0x444444;
    const B_PREKAZKA = 0xFF0000;
    const B_SILNICE  = 0xAAAAAA;
    const B_CESTA    = 0x888888;
    const B_PESINA   = 0x666666;
    const B_TOK      = 0x3399CC;

    //! Rozpočty na jeden snímek.
    //!
    //! ⚠ Tohle není šetrnost, ale nutnost: celá dlaždice má stovky prvků
    //! a hodinky za to shodí aplikaci na watchdog. Kreslí se po
    //! důležitosti a když dojde rozpočet, zbytek se nenakreslí. Při
    //! přiblížení skoro všechno odpadne už výřezem, takže strop dolehne
    //! jen na největší oddálení.
    //! Čísla jsou nízká schválně. Napoprvé jsem je měl třikrát vyšší
    //! a při oddálení, kdy je v záběru celá dlaždice, to aplikaci shodilo.
    const ROZPOCET_PLOCH  = 8;
    const ROZPOCET_BUDOV  = 10;
    const ROZPOCET_USEKU  = 90;

    //! Od jakého dosahu se přestávají kreslit drobnosti. Při pohledu na
    //! 400 m stejně splynou v šum a stojí většinu rozpočtu.
    const BEZ_DROBNOSTI = 250.0;      // pěšiny a budovy
    const JEN_HLAVNI    = 500.0;      // navíc i polní cesty

    //! Kotvy přibalených ukázkových dlaždic. V ostrém provozu tuhle roli
    //! převezme rejstřík dlaždic stažených z Workeru; princip zůstane —
    //! v paměti je vždycky jen ta jedna, ve které zrovna stojím.
    const A1_LAT = 50.08;    const A1_LON = 14.42;      // Praha, město
    const A2_LAT = 50.0365;  const A2_LON = 14.3760;    // Prokopské údolí
    const DOSAH  = 450.0;

    var _dlazdice = null;
    var _ktera = 0;             // 0 = žádná, jinak číslo dlaždice

    //! Vrátí dlaždici pro danou polohu, případně přehodí na jinou.
    //! Načítá se až při prvním použití — kdo podklad nechce, nezaplatí
    //! za něj ani bajt paměti.
    function dlazdice(lat, lon) {
        var chci = 0;
        if (Geo.vzdalenost(lat, lon, A1_LAT, A1_LON) < DOSAH) {
            chci = 1;
        } else if (Geo.vzdalenost(lat, lon, A2_LAT, A2_LON) < DOSAH) {
            chci = 2;
        }

        if (chci != _ktera) {
            _ktera = chci;
            _dlazdice = null;
            try {
                if (chci == 1) {
                    _dlazdice = Application.loadResource(Rez.JsonData.Podklad);
                } else if (chci == 2) {
                    _dlazdice = Application.loadResource(Rez.JsonData.Podklad2);
                }
            } catch (e) {
                _dlazdice = null;
            }
        }
        return _dlazdice;
    }

    //! Uvolní podklad z paměti (přepnutí vypnuto v nabídce).
    function zapomen() {
        _dlazdice = null;
        _ktera = 0;
    }

    //! Vykreslí podklad kolem zadané polohy.
    //!   cx, cy   střed displeje
    //!   polomer  poloměr kresby v pixelech
    //!   mkl      pixelů na metr
    //!   otoc     o kolik je mapa pootočená proti severu [rad]
    function kresli(dc, lat, lon, cx, cy, polomer, mkl, otoc) {
        var d = dlazdice(lat, lon);
        if (d == null) { return; }

        var kotva = d["a"];
        if (kotva == null) { return; }

        // Posun mezi kotvou dlaždice a mou polohou. Počítá se jednou pro
        // celou dlaždici, ne pro každý vrchol — proto je to levné.
        var p = Geo.naMetry(kotva[0], kotva[1], lat, lon);

        var v = {
            "mx"  => p[0] * 10.0,             // moje poloha v dm od kotvy
            "my"  => p[1] * 10.0,
            "cx"  => cx,
            "cy"  => cy,
            "sin" => Math.sin(otoc),
            "cos" => Math.cos(otoc),
            "mkl" => mkl / 10.0,              // z decimetrů rovnou na pixely
            "r2"  => polomer * polomer
        };

        var dosahM = polomer / mkl;
        var dosahDm = dosahM * 10.0 + 50.0;
        v.put("minX", v["mx"] - dosahDm);
        v.put("maxX", v["mx"] + dosahDm);
        v.put("minY", v["my"] - dosahDm);
        v.put("maxY", v["my"] + dosahDm);
        v.put("dosah", dosahM);

        _plochy(dc, d["p"], v);
        _cary(dc, d["l"], v);
        dc.setPenWidth(1);
    }

    //! Má se tahle třída při daném oddálení vůbec kreslit?
    function _stoji(trida, dosah) {
        if (dosah > BEZ_DROBNOSTI && (trida == PESINA || trida == BUDOVA)) { return false; }
        if (dosah > JEN_HLAVNI && trida == CESTA) { return false; }
        return true;
    }

    //! Převod jednoho vrcholu z decimetrů dlaždice na pixely displeje.
    function _bod(c, j, v) {
        var px = (c[j] - v["mx"]) * v["mkl"];
        var py = (c[j + 1] - v["my"]) * v["mkl"];
        return [v["cx"] + (px * v["cos"] - py * v["sin"]),
                v["cy"] - (px * v["sin"] + py * v["cos"])];
    }

    function _mimo(z, v) {
        return z[3] < v["minX"] || z[1] > v["maxX"] || z[4] < v["minY"] || z[2] > v["maxY"];
    }

    // ---- plochy ------------------------------------------------------

    function _plochy(dc, plochy, v) {
        if (plochy == null) { return; }

        var zbyvaPloch = ROZPOCET_PLOCH;
        var zbyvaBudov = ROZPOCET_BUDOV;

        for (var k = 0; k < plochy.size(); k++) {
            if (zbyvaPloch <= 0 && zbyvaBudov <= 0) { break; }

            var z = plochy[k];
            if (_mimo(z, v)) { continue; }

            if (!_stoji(z[0], v["dosah"])) { continue; }

            if (z[0] == BUDOVA) {
                if (zbyvaBudov <= 0) { continue; }
                zbyvaBudov -= 1;
                _budova(dc, z, v);
                continue;
            }

            if (zbyvaPloch <= 0) { continue; }
            zbyvaPloch -= 1;

            var barva = B_ZELEN;
            if (z[0] == POLE) { barva = B_POLE; }
            else if (z[0] == VODA) { barva = B_VODA; }

            var rohy = [];
            for (var j = 5; j < z.size() - 1; j += 2) {
                rohy.add(_bod(z, j, v));
            }
            if (rohy.size() < 3) { continue; }

            dc.setColor(barva, Graphics.COLOR_TRANSPARENT);
            dc.fillPolygon(rohy);
        }
    }

    //! Budova jako šrafovaný obdélník.
    //!
    //! Skutečný půdorys se schválně nekreslí — na 260px displeji ho nikdo
    //! nepozná a stál by desetkrát víc. V dlaždici proto budova nese jen
    //! svou obálku, pět čísel.
    function _budova(dc, z, v) {
        var a = _bod(z, 1, v);                       // minx, miny
        var b = [z[3], z[2]];                        // maxx, miny
        var c = [z[3], z[4]];                        // maxx, maxy
        var e = [z[1], z[4]];                        // minx, maxy
        var pb = _bodXY(b[0], b[1], v);
        var pc = _bodXY(c[0], c[1], v);
        var pe = _bodXY(e[0], e[1], v);

        dc.setPenWidth(1);
        dc.setColor(B_BUDOVA, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(a[0], a[1], pb[0], pb[1]);
        dc.drawLine(pb[0], pb[1], pc[0], pc[1]);
        dc.drawLine(pc[0], pc[1], pe[0], pe[1]);
        dc.drawLine(pe[0], pe[1], a[0], a[1]);

        // dvě úhlopříčné šrafy — dost na to, aby se to četlo jako „dům“,
        // a levné i při dvaceti budovách na obrazovce
        dc.setColor(B_SRAFA, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(a[0], a[1], pc[0], pc[1]);
        dc.drawLine((a[0] + pb[0]) / 2, (a[1] + pb[1]) / 2,
                    (pc[0] + pe[0]) / 2, (pc[1] + pe[1]) / 2);
    }

    function _bodXY(xdm, ydm, v) {
        var px = (xdm - v["mx"]) * v["mkl"];
        var py = (ydm - v["my"]) * v["mkl"];
        return [v["cx"] + (px * v["cos"] - py * v["sin"]),
                v["cy"] - (px * v["sin"] + py * v["cos"])];
    }

    // ---- čáry --------------------------------------------------------

    function _cary(dc, cary, v) {
        if (cary == null) { return; }

        var zbyva = ROZPOCET_USEKU;
        var poslTrida = -1;
        var dosah = v["dosah"];

        // Hodnoty ze slovníku se vytáhnou jednou dopředu. Čtení z Dictionary
        // uvnitř smyčky přes stovky vrcholů je znát — a watchdog nepromíjí.
        var mx = v["mx"];       var my = v["my"];
        var scx = v["cx"];      var scy = v["cy"];
        var sin = v["sin"];     var cos = v["cos"];
        var mkl = v["mkl"];     var r2 = v["r2"];
        var minX = v["minX"];   var maxX = v["maxX"];
        var minY = v["minY"];   var maxY = v["maxY"];

        for (var k = 0; k < cary.size() && zbyva > 0; k++) {
            var c = cary[k];
            if (c.size() < 9) { continue; }          // třída + obálka + dva vrcholy
            if (c[3] < minX || c[1] > maxX || c[4] < minY || c[2] > maxY) { continue; }
            if (!_stoji(c[0], dosah)) { continue; }

            if (c[0] != poslTrida) {
                _styl(dc, c[0]);
                poslTrida = c[0];
            }

            // Předchozí vrchol se drží ve dvou číslech, ne v poli: přes
            // pole to překladač neprojde („container access on null“),
            // protože si neumí odvodit, že za podmínkou už null není.
            var predX = 0.0;
            var predY = 0.0;
            var maPred = false;
            var predUvnitr = false;

            // Převod vrcholu je tu rozepsaný a ne přes _bod() schválně:
            // volání by na každý vrchol vyrobilo nové pole a úklid po nich
            // stál víc než samotné kreslení.
            for (var j = 5; j < c.size() - 1 && zbyva > 0; j += 2) {
                var px = (c[j] - mx) * mkl;
                var py = (c[j + 1] - my) * mkl;
                var x = scx + (px * cos - py * sin);
                var y = scy - (px * sin + py * cos);

                var dx = x - scx;
                var dy = y - scy;
                var uvnitr = (dx * dx + dy * dy) <= r2;

                // Kreslí se i úsek, kterému leží uvnitř jen jeden konec —
                // jinak by čáry mizely kus před okrajem. Co přeteče, ořeže
                // si displej sám.
                if (maPred && (uvnitr || predUvnitr)) {
                    dc.drawLine(predX, predY, x, y);
                    zbyva -= 1;
                }
                predX = x;
                predY = y;
                maPred = true;
                predUvnitr = uvnitr;
            }
        }
    }

    function _styl(dc, trida) {
        if (trida == PREKAZKA) {
            // Sráz, násep, zeď, plot — to, kudy se neprojde. Kvůli tomu
            // podklad hlavně je, tak ať je vidět na první pohled.
            dc.setColor(B_PREKAZKA, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(3);
        } else if (trida == SILNICE) {
            dc.setColor(B_SILNICE, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(3);
        } else if (trida == CESTA) {
            dc.setColor(B_CESTA, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
        } else if (trida == PESINA) {
            dc.setColor(B_PESINA, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(1);
        } else if (trida == VODNI_TOK) {
            dc.setColor(B_TOK, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
        } else {
            dc.setColor(B_PESINA, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(1);
        }
    }
}
