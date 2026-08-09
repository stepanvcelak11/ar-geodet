using Toybox.Position;
using Toybox.Graphics;
using Toybox.Sensor;
using Toybox.Time;
using Toybox.System;
using Toybox.Math;

//! Drží poslední polohu z GNSS. Jediná instance žije po celou dobu běhu
//! aplikace v $.sledovac, obrazovky si z ní jen čtou.
//!
//! Nastavení družicových systémů se schválně nešahá — bere se to, co má
//! uživatel v hodinkách (Nastavení → Systém → GPS). Když je tam „Vše +
//! vícepásmové“, dostane aplikace ten nejlepší fix, který Forerunner 255
//! umí (L1 + L5), a nemusí se tady hádat s konstantami, které se mezi
//! verzemi Connect IQ liší.
class Sledovac {

    //! ⚠ `lat`/`lon` jsou poloha PO korekci (viz Korekce) — tak je čte celá
    //! aplikace, mapa i navigace. Syrová data z přijímače drží `latRaw`/`lonRaw`
    //! a sbírá je průměrování; korekce se totiž počítá právě z rozdílu mezi
    //! syrovou polohou a známým bodem, takže by se z opravené polohy počítala
    //! podruhé a sečetla se sama se sebou.
    var lat      = null;      // WGS84 [°], po korekci
    var lon      = null;
    var latRaw   = null;      // WGS84 [°], jak to přišlo z GNSS
    var lonRaw   = null;
    var vyska    = null;      // [m n.m.]
    var kvalita  = null;      // Position.QUALITY_*
    var kurz     = null;      // směr pohybu [rad], jen když se jde
    var rychlost = 0.0;       // [m/s]

    //! Roste s každým novým fixem. Obrazovka pro zakládání bodu podle něj
    //! pozná, že přišel čerstvý údaj, a nezapočítá tentýž fix dvakrát.
    var pocitadlo = 0;

    //! Průběžné průměrování „zadarmo“.
    //!
    //! Appka průměruje pořád, kdykoli se stojí na místě — takže když se
    //! bod zakládá, je zpřesněná poloha už hotová a nemusí se na nic čekat.
    //! Jakmile se člověk pohne, sběr se zahodí a začne se znovu.
    var klid;
    var klidOd = null;            // čas prvního vzorku [s od epochy]

    //! O kolik metrů se smí fix odchýlit od dosavadního průměru, než to
    //! vezmeme jako pohyb. Schválně velkoryse: samotný šum GPS umí uskočit
    //! o pár metrů a bylo by k ničemu, kdyby to sběr shazovalo pořád dokola.
    const PRAH_POHYBU = 8.0;

    function initialize() {
        klid = new Prumer();
    }

    function spustit() {
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPozice));
        osvez();
    }

    //! Aktivní dotaz na polohu místo čekání na oznámení.
    //!
    //! ⚠ V simulátoru se po „Settings → Set Position" callback NEOZVE —
    //! nová poloha se objeví teprve při dalším startu aplikace, takže to
    //! vypadá, že appka zamrzla na „hledám GPS". Na hodinkách to zas
    //! pomůže hned po spuštění, než přijde první fix. Stojí to nic:
    //! getInfo jen přečte poslední známý stav, nic nezapíná.
    function osvez() {
        var i = Position.getInfo();
        if (i != null) { onPozice(i); }
    }

    function zastavit() {
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPozice));
    }

    //! Typ parametru i `as Void` jsou povinné — enableLocationEvents přijímá
    //! jedině metodu s přesně tímhle podpisem.
    function onPozice(info as Position.Info) as Void {
        if (info == null || info.position == null) { return; }

        var d = info.position.toDegrees();
        if (d == null || d.size() < 2) { return; }

        latRaw = d[0];
        lonRaw = d[1];
        var k = Korekce.pouzij(latRaw, lonRaw);
        lat = k[0];
        lon = k[1];
        kvalita = info.accuracy;

        if (info.altitude != null) { vyska = info.altitude; }
        if (info.speed != null)    { rychlost = info.speed; }

        // Kurz z GNSS má smysl teprve když se člověk hýbe — vestoje je to
        // jen šum. Práh je schválně nízko (0,8 m/s ≈ pomalá chůze).
        if (info.heading != null && rychlost > 0.8) { kurz = info.heading; }

        pocitadlo += 1;
        _zpracujKlid();
    }

    //! Rozhodne, jestli tenhle fix ještě patří k tomu, kde stojím, nebo
    //! jestli jsem se přesunul jinam a sběr se musí zahodit.
    hidden function _zpracujKlid() {
        // Bez použitelného fixu se nesbírá — jinak by se do průměru
        // připletly polohy, o kterých přijímač sám říká, že za nic nestojí.
        if (!maFix()) {
            klid.reset();
            klidOd = null;
            return;
        }

        // SYROVÁ poloha, ne opravená: kdyby se korekce zapnula nebo vypršela
        // uprostřed sběru, opravená poloha by uskočila o její velikost a sběr
        // by se zahodil, jako by se člověk hnul. Na samotný průměr to vliv
        // nemá — korekce je konstantní posun a přičte se až při ukládání bodu.
        var s = klid.stred();
        var skok = (s == null) ? 0.0 : Geo.vzdalenost(s[0], s[1], latRaw, lonRaw);

        if (rychlost > 1.0 || skok > PRAH_POHYBU) {
            klid.reset();
            klidOd = null;
        }

        klid.pridej(latRaw, lonRaw, vyska);
        if (klidOd == null) { klidOd = Time.now().value(); }
    }

    //! Jak dlouho stojím na místě [s]. Null, když se zrovna sbírat nedá.
    function klidSekund() {
        if (klidOd == null) { return null; }
        return Time.now().value() - klidOd;
    }

    //! Krátký popis stavu průběžného průměrování pro displej,
    //! třeba „±0,8 m · 24 s“. Null, dokud není co ukázat.
    function popisKlidu() {
        if (klid.pocet() < 3) { return null; }
        var sig = klid.prubeznaSigma();
        var sek = klidSekund();
        if (sig == null || sek == null) { return null; }
        return "±" + sig.format("%.1f") + " m · " + sek.toString() + " s";
    }

    //! Máme použitelný fix? LAST_KNOWN je zastaralá poloha, ta se za fix
    //! nepočítá — jinak by aplikace tvrdila, že ví, kde je, a přitom by
    //! ukazovala včerejšek.
    function maFix() {
        return (lat != null)
            && (kvalita != null)
            && (kvalita != Position.QUALITY_NOT_AVAILABLE)
            && (kvalita != Position.QUALITY_LAST_KNOWN);
    }

    function popisKvality() {
        if (kvalita == Position.QUALITY_GOOD)       { return "GPS dobrá"; }
        if (kvalita == Position.QUALITY_USABLE)     { return "GPS slabší"; }
        if (kvalita == Position.QUALITY_POOR)       { return "GPS špatná"; }
        if (kvalita == Position.QUALITY_LAST_KNOWN) { return "stará poloha"; }
        return "hledám GPS";
    }

    //! Barva pro stavovou tečku na mapě.
    function barvaKvality() {
        if (kvalita == Position.QUALITY_GOOD)   { return Graphics.COLOR_GREEN; }
        if (kvalita == Position.QUALITY_USABLE) { return Graphics.COLOR_YELLOW; }
        if (kvalita == Position.QUALITY_POOR)   { return Graphics.COLOR_ORANGE; }
        return Graphics.COLOR_DK_GRAY;
    }

    //! Kam je natočený displej [rad od severu], nebo null.
    //!
    //! Při chůzi je spolehlivější kurz z GNSS (kompas na zápěstí se
    //! natáčí s každým máchnutím ruky), vestoje naopak jedině kompas.
    function smer() {
        if (rychlost != null && rychlost > 1.2 && kurz != null) {
            return kurz;
        }
        var si = Sensor.getInfo();
        if (si != null && si has :heading && si.heading != null) {
            return si.heading;
        }
        return kurz;
    }
}
