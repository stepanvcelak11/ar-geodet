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
    //! nulami, "do" konec rezervovaného bloku}. Ve výchozím stavu prosté
    //! 1, 2, 3, … jak si to přál uživatel.
    function serie() {
        var s = Storage.getValue(KLIC_SERIE);
        if (s == null || !(s instanceof Lang.Dictionary) || s["n"] == null) {
            return { "p" => "", "n" => 1, "z" => 0, "do" => 0 };
        }
        if (s["do"] == null) { s["do"] = 0; }
        return s;
    }

    //! Kolik čísel zbývá z rezervovaného bloku. Null, když žádný blok není
    //! (hodinky ještě nebyly spárované — pak se čísluje volně).
    function zbyvaCisel() {
        var s = serie();
        if (s["do"] == null || s["do"] <= 0) { return null; }
        var z = s["do"] - s["n"] + 1;
        return (z < 0) ? 0 : z;
    }

    function nastavSerii(s) {
        Storage.setValue(KLIC_SERIE, s);
    }

    //! Vrátí příští číslo bodu, ALE neposune sérii — ta se posune až
    //! uložením bodu. Kdyby se měření zrušilo, číslo se nesmí ztratit.
    //!
    //! ⚠ DOJDE-LI REZERVOVANÝ BLOK, čísla dostanou předponu „W“.
    //! Blok se přiděluje při párování (server pošle „from“ a „to“), aby
    //! hodinky bez signálu nevyrobily bod se stejným číslem jako mobil.
    //! Jenže blok je konečný — a když dojde, pokračovat prostými čísly by
    //! přesně tu kolizi způsobilo. „W51“ se s ničím z mobilu potkat nemůže,
    //! protože mobil čísluje samými číslicemi. Radši ošklivé číslo než dva
    //! různé body, které si v kanceláři přepíšou jeden druhého.
    function dalsiCislo() {
        var s = serie();
        var c = s["n"].toString();
        var z = s["z"];
        if (z != null && z > 0) {
            while (c.length() < z) { c = "0" + c; }
        }
        if (s["do"] != null && s["do"] > 0 && s["n"] > s["do"]) {
            return "W" + c;
        }
        return s["p"] + c;
    }

    //! Uloží bod a posune sérii. Vrací přidělené číslo.
    function pridej(la, lo, h, sigma, n, src, kod) {
        var cislo = dalsiCislo();
        pridejSCislem(cislo, la, lo, h, sigma, n, src, kod);

        var s = serie();
        s["n"] = s["n"] + 1;
        nastavSerii(s);

        return cislo;
    }

    //! Uloží bod s předem daným číslem a sérii NEHÝBE. Kvůli značkám
    //! („Označ tady“), které mají vlastní číslování a nesmí ukusovat
    //! z rezervovaného bloku měřených bodů.
    function pridejSCislem(cislo, la, lo, h, sigma, n, src, kod) {
        var pole = nacti();
        pole.add({
            "c"   => cislo,
            "la"  => la,
            "lo"  => lo,
            "h"   => h,
            "s"   => sigma,
            "n"   => n,
            "k"   => (kod == null) ? "" : kod,
            "t"   => Time.now().value(),
            "src" => src
        });
        uloz(pole);
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
                "k"  => b["k"],
                // src putuje ven kvůli korekci: za známý bod se smí vzít
                // jedině to, co přišlo z mobilu (src 1) — bod naměřený
                // hodinkami je sám nejistý na metry a korigovat podle něj
                // znamená jen přesypat šum z jedné hromádky na druhou.
                "src" => b["src"],
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

    //! Nahradí body stažené z mobilu (src 1) čerstvou dávkou.
    //!
    //! Vlastní naměřené body (src 0) zůstávají netknuté — ty jsou originál
    //! a mobil o nich nemusí ještě vědět. Body z mobilu se naopak celé
    //! zahodí a nasypou znovu: server posílá jen okolí, takže „co zmizelo“
    //! by se jinak nedalo poznat od „co je zrovna daleko“.
    function nahradZMobilu(prichozi) {
        var vse = nacti();
        var moje = [];
        for (var i = 0; i < vse.size(); i++) {
            if (vse[i]["src"] != 1) { moje.add(vse[i]); }
        }
        for (var i = 0; i < prichozi.size(); i++) {
            var p = prichozi[i];
            if (p["la"] == null || p["lo"] == null) { continue; }
            moje.add({
                "c"   => (p["c"] == null) ? "?" : p["c"].toString(),
                "la"  => p["la"],
                "lo"  => p["lo"],
                "h"   => p["h"],
                "s"   => p["s"],
                "n"   => 0,
                "k"   => (p["k"] == null) ? "" : p["k"],
                "t"   => Time.now().value(),
                "src" => 1
            });
        }
        uloz(moje);
        return prichozi.size();
    }

}
