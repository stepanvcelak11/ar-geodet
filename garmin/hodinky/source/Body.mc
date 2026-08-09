using Toybox.Application.Storage;
using Toybox.Lang;
using Toybox.Time;
using Toybox.Math;

//! Body v paměti hodinek.
//!
//! Application.Storage umí ukládat jen základní typy, takže bod je slovník
//! s krátkými klíči (na hodinkách se počítá každý bajt):
//!   c    číslo bodu jako řetězec — může mít předponu, třeba „W12“
//!   la   zeměpisná šířka WGS84 [°]
//!   lo   zeměpisná délka WGS84 [°]
//!   h    výška [m]
//!   s    rozptyl vzorků při měření [m] — viz Prumer, není to střední chyba
//!   n    počet zprůměrovaných vzorků
//!   t    čas vzniku [s od epochy]
//!   src  0 = založeno na hodinkách, 1 = přišlo z mobilu
module Body {

    const KLIC       = "body";
    const KLIC_SERIE = "serie";

    //! Strop počtu bodů. Watch app má paměť v řádu stovek kB včetně dat,
    //! takže se raději drží krátká šňůra — přes seznam okolí stejně nikdo
    //! nepracuje se stovkami bodů najednou.
    const MAX = 200;

    function nacti() {
        var b = Storage.getValue(KLIC);
        if (b == null || !(b instanceof Lang.Array)) { return []; }
        return b;
    }

    function uloz(pole) {
        // Kdyby se strop přesáhl, jdou pryč nejstarší body. Pole je řazené
        // podle vzniku, takže stačí uříznout začátek.
        if (pole.size() > MAX) {
            pole = pole.slice(pole.size() - MAX, pole.size());
        }
        Storage.setValue(KLIC, pole);
    }

    function pocet() {
        return nacti().size();
    }

    function smazVse() {
        Storage.setValue(KLIC, []);
    }

    // ---- číslování ---------------------------------------------------

    //! Série čísel: {"p" předpona, "n" další číslo, "z" počet číslic zleva
    //! nulami}. Ve výchozím stavu prosté 1, 2, 3, … jak si to přál uživatel.
    function serie() {
        var s = Storage.getValue(KLIC_SERIE);
        if (s == null || !(s instanceof Lang.Dictionary) || s["n"] == null) {
            return { "p" => "", "n" => 1, "z" => 0 };
        }
        return s;
    }

    function nastavSerii(s) {
        Storage.setValue(KLIC_SERIE, s);
    }

    //! Vrátí příští číslo bodu, ALE neposune sérii — ta se posune až
    //! uložením bodu. Kdyby se měření zrušilo, číslo se nesmí ztratit.
    function dalsiCislo() {
        var s = serie();
        var c = s["n"].toString();
        var z = s["z"];
        if (z != null && z > 0) {
            while (c.length() < z) { c = "0" + c; }
        }
        return s["p"] + c;
    }

    //! Uloží bod a posune sérii. Vrací přidělené číslo.
    function pridej(la, lo, h, sigma, n, src) {
        var cislo = dalsiCislo();
        var pole = nacti();
        pole.add({
            "c"   => cislo,
            "la"  => la,
            "lo"  => lo,
            "h"   => h,
            "s"   => sigma,
            "n"   => n,
            "t"   => Time.now().value(),
            "src" => src
        });
        uloz(pole);

        var s = serie();
        s["n"] = s["n"] + 1;
        nastavSerii(s);

        return cislo;
    }

    // ---- vyhledání okolí ---------------------------------------------

    //! Nejbližších `kolik` bodů od zadané polohy, seřazených od nejbližšího.
    //! Ke každému bodu přibude "d" (vzdálenost v metrech) a "az" (azimut).
    //!
    //! Schválně se nic netřídí — vkládá se rovnou do krátkého seznamu délky
    //! `kolik`. Při dvou stech bodech a dvaceti místech je to pár tisíc
    //! porovnání, což hodinky nepocítí, a odpadá potřeba třídicí funkce.
    function nejblizsi(lat, lon, kolik) {
        var vse = nacti();
        var ven = [];

        for (var i = 0; i < vse.size(); i++) {
            var b = vse[i];
            if (b["la"] == null || b["lo"] == null) { continue; }
            var d = Geo.vzdalenost(lat, lon, b["la"], b["lo"]);

            // Když je seznam plný a tenhle bod je dál než ten poslední,
            // nemá cenu se s ním dál zdržovat.
            if (ven.size() >= kolik && d >= ven[ven.size() - 1]["d"]) { continue; }

            var zaznam = {
                "c"  => b["c"],
                "la" => b["la"],
                "lo" => b["lo"],
                "h"  => b["h"],
                "s"  => b["s"],
                "d"  => d,
                "az" => Geo.azimut(lat, lon, b["la"], b["lo"])
            };

            // přidat na konec a probublat na své místo
            ven.add(zaznam);
            for (var j = ven.size() - 1; j > 0; j--) {
                if (ven[j]["d"] < ven[j - 1]["d"]) {
                    var t = ven[j];
                    ven[j] = ven[j - 1];
                    ven[j - 1] = t;
                } else {
                    break;
                }
            }
            if (ven.size() > kolik) {
                ven = ven.slice(0, kolik);
            }
        }
        return ven;
    }

    // ---- ukázková data pro simulátor ---------------------------------

    //! Rozsype pár bodů kolem zadané polohy, aby bylo co zkoušet
    //! v simulátoru, kde se žádné body nezaloží. Ostrý provoz to nepotřebuje.
    function ukazkove(lat, lon) {
        var rozmisteni = [
            [  12.0,   8.0], [ -35.0,  20.0], [  60.0, -45.0],
            [-110.0, -30.0], [  90.0, 130.0], [ 210.0,  40.0],
            [ -70.0, 190.0], [ 330.0, -80.0], [-260.0, 150.0],
            [ 150.0, 320.0]
        ];
        for (var i = 0; i < rozmisteni.size(); i++) {
            var g = Geo.zMetru(lat, lon, rozmisteni[i][0], rozmisteni[i][1]);
            pridej(g[0], g[1], 300.0, 1.5, 30, 1);
        }
    }
}
