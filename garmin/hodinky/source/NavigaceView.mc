using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Attention;
using Toybox.System;
using Toybox.Timer;
using Toybox.Math;

//! Navigace k vybranému bodu: velká šipka, zbývající vzdálenost, číslo bodu.
//!
//! Tohle bude v terénu nejpoužívanější obrazovka, takže je na ní schválně
//! málo věcí a velkým písmem — čitelně za chůze a přes rukavici.
class NavigaceView extends WatchUi.View {

    //! Pod tuhle vzdálenost už šipka nemá co říct — GPS na hodinkách má
    //! chybu v jednotkách metrů, takže by ukazovala jen šum. Místo šipky
    //! se zobrazí kruh „jsi tam“.
    const DOSAH = 3.0;

    hidden var _bod;
    hidden var _casovac = null;
    hidden var _uzZavibrovalo = false;

    function initialize(bod) {
        View.initialize();
        _bod = bod;
    }

    function onShow() {
        _casovac = new Timer.Timer();
        _casovac.start(method(:tik), 1000, true);
    }

    function onHide() {
        if (_casovac != null) {
            _casovac.stop();
            _casovac = null;
        }
    }

    function tik() as Void {
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var cx = sirka / 2;
        var cy = vyska / 2;

        var s = $.sledovac;
        if (s == null || s.lat == null) {
            dc.drawText(cx, cy, Graphics.FONT_MEDIUM, "hledám GPS",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        var d  = Geo.vzdalenost(s.lat, s.lon, _bod["la"], _bod["lo"]);
        var az = Geo.azimut(s.lat, s.lon, _bod["la"], _bod["lo"]);

        // nahoře čas a k němu číslo a kód cílového bodu
        var nadpis = Displej.cas() + " · " + _bod["c"];
        if (_bod["k"] != null && !_bod["k"].equals("")) {
            nadpis += " " + _bod["k"];
        }
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        Displej.nahore(dc, nadpis, Graphics.FONT_XTINY);

        if (d <= DOSAH) {
            _dorazil(dc, cx, cy, d);
        } else {
            _uzZavibrovalo = false;
            _sipka(dc, cx, cy - 14, az, s);
        }

        // rozptyl, se kterým byl bod měřen — ať je pořád na očích, že tohle
        // není vytyčovací přesnost
        var pod = Geo.svetovaStrana(az);
        if (_bod["s"] != null) {
            pod += "   ±" + _bod["s"].format("%.1f") + " m";
        }
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        var vrsek = Displej.dole(dc, pod, Graphics.FONT_XTINY);

        // vzdálenost velkým písmem nad tím
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, vrsek - dc.getFontHeight(Graphics.FONT_NUMBER_MEDIUM) / 2 - 2,
                    Graphics.FONT_NUMBER_MEDIUM, Geo.popisVzdalenosti(d),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    //! Šipka ukazuje azimut mínus směr, kterým jsem natočený — tedy „doprava
    //! od tebe“, ne „na severovýchod“.
    hidden function _sipka(dc, cx, cy, az, s) {
        var sm = s.smer();
        var a = (sm == null) ? az : Geo.normUhel(az - sm);

        var delka = 46;
        var siro  = 26;
        var hrot = [cx + delka * Math.sin(a), cy - delka * Math.cos(a)];
        var lev  = [cx + siro * Math.sin(a + 2.4), cy - siro * Math.cos(a + 2.4)];
        var prav = [cx + siro * Math.sin(a - 2.4), cy - siro * Math.cos(a - 2.4)];
        var pata = [cx + 10 * Math.sin(a + Math.PI), cy - 10 * Math.cos(a + Math.PI)];

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([hrot, lev, pata, prav]);

        // Když se stojí a kompas mlčí, šipka ukazuje zeměpisný azimut a ne
        // směr od těla — to je potřeba přiznat, jinak by člověk šel špatně.
        if (sm == null) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + delka + 4, Graphics.FONT_XTINY, "azimut od severu",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    hidden function _dorazil(dc, cx, cy, d) {
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(4);
        dc.drawCircle(cx, cy - 14, 34);
        dc.drawText(cx, cy - 14, Graphics.FONT_SMALL, "jsi tam",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        if (!_uzZavibrovalo) {
            _uzZavibrovalo = true;
            _zavibruj();
        }
    }

    hidden function _zavibruj() {
        if (!(Attention has :vibrate)) { return; }
        var ds = System.getDeviceSettings();
        if (ds == null || !ds.vibrateOn) { return; }
        Attention.vibrate([new Attention.VibeProfile(75, 300)]);
    }
}


class NavigaceDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    //! BACK i START vedou zpátky na mapu, kde cíl zůstane zvýrazněný.
    //! Ze seznamu se vyskakuje rovnou přes obě obrazovky — po dojití
    //! k bodu chce člověk vidět mapu, ne zase seznam.
    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onSelect() {
        return onBack();
    }
}
