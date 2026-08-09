using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Attention;
using Toybox.System;
using Toybox.Timer;

//! Založení nového bodu průměrováním polohy.
//!
//! Průběh: sbírá se poloha po sekundě, na displeji běží počet vzorků
//! a průběžný rozptyl. Po uplynutí doby (nebo dřív, když se zmáčkne START)
//! se ukáže výsledek s přiděleným číslem a čeká se na potvrzení.
//!
//! Vzorky se berou podle počítadla ve sledovači, ne prostým odečtem každou
//! sekundu — kdyby přijímač na chvíli vypadl, jinak by se tentýž fix
//! započítal několikrát a rozptyl by vyšel lživě malý.
class NovyBodView extends WatchUi.View {

    //! Výchozí doba měření. Delší už moc nepřidá — chyba z odrazů se
    //! průměrováním nevytratí, ta zůstane, ať se stojí jakkoli dlouho.
    const SEKUND = 30;

    hidden var _prumer;
    hidden var _zbyva;
    hidden var _faze = 0;          // 0 = sbírá se, 1 = hotovo
    hidden var _vysledek = null;
    hidden var _cislo = null;
    hidden var _casovac = null;
    hidden var _poslPocitadlo = -1;

    function initialize() {
        View.initialize();
        _prumer = new Prumer();
        _zbyva = SEKUND;
        var s = $.sledovac;
        if (s != null) { _poslPocitadlo = s.pocitadlo; }
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

    function tik() {
        if (_faze != 0) { return; }

        var s = $.sledovac;
        if (s != null && s.maFix() && s.pocitadlo != _poslPocitadlo) {
            _poslPocitadlo = s.pocitadlo;
            _prumer.pridej(s.lat, s.lon, s.vyska);
        }

        _zbyva -= 1;
        if (_zbyva <= 0) {
            ukoncit();
        }
        WatchUi.requestUpdate();
    }

    //! Ukončí sběr a spočítá výsledek. Číslo se přidělí až při uložení,
    //! aby se zrušeným měřením neprokousávala číselná řada.
    function ukoncit() {
        if (_faze != 0) { return; }
        _vysledek = _prumer.vysledek();
        _cislo = Body.dalsiCislo();
        _faze = 1;
        if (_casovac != null) {
            _casovac.stop();
            _casovac = null;
        }
        _zavibruj();
        WatchUi.requestUpdate();
    }

    function jeHotovo() {
        return _faze == 1;
    }

    function maVysledek() {
        return _vysledek != null;
    }

    //! Uloží bod. Vrací přidělené číslo, nebo null, když není co ukládat.
    function uloz() {
        if (_vysledek == null) { return null; }
        return Body.pridej(
            _vysledek["la"], _vysledek["lo"], _vysledek["h"],
            _vysledek["s"], _vysledek["n"], 0);
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var cx = sirka / 2;

        if (_faze == 0) {
            _sber(dc, cx, vyska);
        } else {
            _hotovo(dc, cx, vyska);
        }
    }

    hidden function _sber(dc, cx, vyska) {
        var s = $.sledovac;

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 22, Graphics.FONT_XTINY, "měřím bod " + Body.dalsiCislo(),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, vyska / 2 - 18, Graphics.FONT_NUMBER_HOT, _zbyva.toString(),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        var radek = _prumer.pocet().toString() + " vzorků";
        var sig = _prumer.prubeznaSigma();
        if (sig != null) {
            radek += " · ±" + sig.format("%.1f") + " m";
        }
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, vyska / 2 + 34, Graphics.FONT_XTINY, radek,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Když je fix mizerný, není to vidět na počtu vzorků — musí se to říct.
        if (s != null && !s.maFix()) {
            dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, vyska - 34, Graphics.FONT_XTINY, s.popisKvality(),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, vyska - 14, Graphics.FONT_XTINY, "START = hotovo   BACK = zrušit",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    hidden function _hotovo(dc, cx, vyska) {
        if (_vysledek == null) {
            dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, vyska / 2, Graphics.FONT_MEDIUM, "žádný fix",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, vyska - 14, Graphics.FONT_XTINY, "BACK = zpět",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 22, Graphics.FONT_XTINY, "nový bod",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, vyska / 2 - 26, Graphics.FONT_NUMBER_MEDIUM, _cislo,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, vyska / 2 + 14, Graphics.FONT_SMALL,
                    "±" + _vysledek["s"].format("%.1f") + " m",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        var podrobnosti = _vysledek["n"].toString() + " vzorků";
        if (_vysledek["out"] > 0) {
            podrobnosti += " · " + _vysledek["out"].toString() + " vyhozeno";
        }
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, vyska / 2 + 44, Graphics.FONT_XTINY, podrobnosti,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(cx, vyska - 14, Graphics.FONT_XTINY, "START = uložit   BACK = zahodit",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    hidden function _zavibruj() {
        if (!(Attention has :vibrate)) { return; }
        var ds = System.getDeviceSettings();
        if (ds == null || !ds.vibrateOn) { return; }
        Attention.vibrate([new Attention.VibeProfile(50, 200)]);
    }
}


class NovyBodDelegate extends WatchUi.BehaviorDelegate {

    hidden var _view;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onSelect() {
        if (!_view.jeHotovo()) {
            _view.ukoncit();          // dost bylo měření, spočítej to
            return true;
        }
        if (_view.maVysledek()) {
            _view.uloz();
        }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onBack() {
        // Ve fázi sběru i nad hotovým výsledkem znamená BACK „zahodit“ —
        // uloží se jedině přes START, ať se bod nezaloží omylem.
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}
