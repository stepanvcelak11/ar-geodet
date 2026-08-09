using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.System;
using Toybox.Timer;

//! Ruční nastavení čísla, které dostane příští založený bod.
//!
//! Šipkami nahoru/dolů. Krok se sám zrychluje: když se mačká svižně za
//! sebou, přeskočí na desítky a pak na stovky — jinak by se ze čtyřky na
//! čtyři sta klikalo do večera. Po chvíli klidu se vrátí na jedničku.
class CisloView extends WatchUi.View {

    hidden var _cislo = 1;
    hidden var _krok = 1;
    hidden var _odKliku = 0;        // tiků od posledního stisku
    hidden var _casovac = null;

    function initialize() {
        View.initialize();
        var s = Body.serie();
        _cislo = s["n"];
        if (_cislo == null || _cislo < 1) { _cislo = 1; }
    }

    function onShow() {
        _casovac = new Timer.Timer();
        _casovac.start(method(:tik), 500, true);
    }

    function onHide() {
        if (_casovac != null) {
            _casovac.stop();
            _casovac = null;
        }
    }

    function tik() as Void {
        _odKliku += 1;
        // dvě a půl vteřiny klidu = zpátky na krok po jedné
        if (_odKliku >= 5 && _krok != 1) {
            _krok = 1;
            WatchUi.requestUpdate();
        }
    }

    function zmen(o) {
        _cislo += _krok * o;
        if (_cislo < 1) { _cislo = 1; }
        if (_cislo > 999999) { _cislo = 999999; }

        // zrychlení: každé dva svižné stisky za sebou posunou krok o řád
        if (_odKliku <= 1) {
            if (_krok < 100) { _krok *= 10; }
        }
        _odKliku = 0;
        WatchUi.requestUpdate();
    }

    function uloz() {
        var s = Body.serie();
        s["n"] = _cislo;
        Body.nastavSerii(s);
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var cx = sirka / 2;
        var cy = vyska / 2;

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        Displej.nahore(dc, "příští bod dostane číslo", Graphics.FONT_XTINY);

        // Číslo je samá číslice, takže číselný font je tu v pořádku.
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy - 8, Graphics.FONT_NUMBER_MEDIUM, _cislo.toString(),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.setColor(_krok > 1 ? Graphics.COLOR_ORANGE : Graphics.COLOR_DK_GRAY,
                    Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy + 32, Graphics.FONT_XTINY, "po " + _krok.toString(),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        Displej.dole(dc, "↑↓ mění   START = ulož", Graphics.FONT_XTINY);
    }
}


class CisloDelegate extends WatchUi.BehaviorDelegate {

    hidden var _view;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onNextPage()     { _view.zmen(-1); return true; }
    function onPreviousPage() { _view.zmen(1);  return true; }

    function onSelect() {
        _view.uloz();
        return _zpet();
    }

    //! BACK zahodí — číslování je věc, kterou nikdo nechce změnit omylem.
    function onBack() {
        return _zpet();
    }

    hidden function _zpet() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}
