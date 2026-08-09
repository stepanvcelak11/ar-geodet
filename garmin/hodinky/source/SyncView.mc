using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Timer;

//! Průběh synchronizace s mobilem.
//!
//! ⚠ Vzniklo z chyby: stav se dřív psal jen do podtitulku položky v nabídce,
//! jenže ten se nastaví JEDNOU při stisku a už se neobnoví. Zůstalo tam viset
//! „stahuji okolí" i dlouho poté, co bylo hotovo, a nedalo se poznat, jestli
//! se ještě něco děje. Proto vlastní obrazovka, která se překresluje.
//!
//! ⚠ Skutečný ukazatel postupu (kolik z kolika kilobajtů) udělat NEJDE —
//! `makeWebRequest` průběh nehlásí, odpověď přijde celá naráz. Ukazuje se
//! tedy, KTERÝ ze tří kroků běží, jak dlouho už to trvá, a hlavně je jasně
//! poznat konec: zelené „Hotovo", souhrn a vibrace.
class SyncView extends WatchUi.View {

    hidden var _casovac = null;
    hidden var _tik = 0;

    function initialize() {
        View.initialize();
    }

    function onShow() {
        $.cloud.synchronizuj();
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
        _tik += 1;
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var cx = sirka / 2;
        var cy = vyska / 2;

        var f = $.cloud.faze;
        var hotovo = (f >= 4);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        Displej.nahore(dc, "synchronizace", Graphics.FONT_XTINY);

        // Tři tečky = tři kroky. Hotové zelené, běžící bliká, zbylé šedé.
        // Na jeden pohled je vidět, kde to je — i bez čtení.
        _kroky(dc, cx, cy - 44, f);

        if (hotovo) {
            dc.setColor((f == 5) ? Graphics.COLOR_ORANGE : Graphics.COLOR_GREEN,
                        Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 4, Graphics.FONT_MEDIUM, (f == 5) ? "Chyba" : "Hotovo",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 4, Graphics.FONT_SMALL, _popisFaze(f),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        // podrobnost: souhrn, nebo hláška ze sítě
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy + 24, Graphics.FONT_XTINY, hotovo ? _souhrn() : $.cloud.stav,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        if (hotovo) {
            Displej.dole(dc, "BACK = zpět", Graphics.FONT_XTINY);
        } else {
            // Vteřiny místo procent — postup se zjistit nedá, ale že to
            // běží a jak dlouho, ano.
            Displej.dole(dc, $.cloud.sekund().toString() + " s", Graphics.FONT_XTINY);
        }
    }

    hidden function _popisFaze(f) {
        if (f == 1) { return "odesílám"; }
        if (f == 2) { return "beru body"; }
        if (f == 3) { return "beru mapu"; }
        return "…";
    }

    hidden function _souhrn() {
        var s = $.cloud.pocetBodu.toString() + " bodů";
        s += $.cloud.mapaOk ? " · mapa" : " · bez mapy";
        return s;
    }

    hidden function _kroky(dc, cx, y, f) {
        var r = 6;
        var rozestup = 26;
        for (var i = 1; i <= 3; i++) {
            var x = cx + (i - 2) * rozestup;
            if (f > i || f >= 4) {
                dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(x, y, r);
            } else if (f == i) {
                // bliká, ať je poznat, který krok zrovna běží
                dc.setColor((_tik % 2 == 0) ? Graphics.COLOR_WHITE : Graphics.COLOR_DK_GRAY,
                            Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(x, y, r);
            } else {
                dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.setPenWidth(2);
                dc.drawCircle(x, y, r);
            }
        }
        dc.setPenWidth(1);
    }
}


class SyncDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    //! Zpátky přes průběh i nabídku, ze které se sem vstoupilo.
    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onSelect() { return onBack(); }
}
