using Toybox.Position;
using Toybox.Graphics;
using Toybox.Sensor;
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

    var lat      = null;      // WGS84 [°]
    var lon      = null;
    var vyska    = null;      // [m n.m.]
    var kvalita  = null;      // Position.QUALITY_*
    var kurz     = null;      // směr pohybu [rad], jen když se jde
    var rychlost = 0.0;       // [m/s]

    //! Roste s každým novým fixem. Obrazovka pro zakládání bodu podle něj
    //! pozná, že přišel čerstvý údaj, a nezapočítá tentýž fix dvakrát.
    var pocitadlo = 0;

    function initialize() {
    }

    function spustit() {
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPozice));
        // Poslední známá poloha, ať mapa hned po startu není prázdná.
        // Bude zastaralá, ale kvalita to přizná (QUALITY_LAST_KNOWN).
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

        lat = d[0];
        lon = d[1];
        kvalita = info.accuracy;

        if (info.altitude != null) { vyska = info.altitude; }
        if (info.speed != null)    { rychlost = info.speed; }

        // Kurz z GNSS má smysl teprve když se člověk hýbe — vestoje je to
        // jen šum. Práh je schválně nízko (0,8 m/s ≈ pomalá chůze).
        if (info.heading != null && rychlost > 0.8) { kurz = info.heading; }

        pocitadlo += 1;
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
