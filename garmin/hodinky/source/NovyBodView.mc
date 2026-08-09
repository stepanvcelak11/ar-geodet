using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Attention;
using Toybox.System;
using Toybox.Timer;

//! Založení nového bodu.
//!
//! Žádný odpočet. Aplikace průměruje pořád, kdykoli se stojí na místě (viz
//! Sledovac.klid), takže když se sem přijde, je zpřesněná poloha už hotová
//! a START ji rovnou uloží. Kdo chce přesněji, prostě chvíli počká a dívá
//! se, jak rozptyl klesá — čekání je dobrovolné, ne povinné.
//!
//! Když se člověk pohne, sběr se sám zahodí a začne znovu; obrazovka to
//! přizná, aby nikdo neuložil bod naměřený za chůze.
class NovyBodView extends WatchUi.View {

    //! Kolik vzorků se považuje za slušný základ. Pod tím obrazovka radí
    //! ještě chvíli počkat — neblokuje to, jen upozorní.
    const DOST = 20;

    hidden var _casovac = null;
    hidden var _ulozeno = null;      // číslo uloženého bodu

    function initialize() {
        View.initialize();
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
        // Totéž co na mapě: bez tohohle dotazu zůstane zastaralá poloha
        // zastaralá a měření se nikdy nerozjede.
        var s = $.sledovac;
        if (s != null && !s.maFix()) { s.osvez(); }
        WatchUi.requestUpdate();
    }

    //! Uloží bod z právě nasbíraného průměru. Vrací číslo, nebo null.
    function uloz() {
        var s = $.sledovac;
        if (s == null) { return null; }

        var v = s.klid.vysledek();
        if (v == null) { return null; }

        _ulozeno = Body.pridej(v["la"], v["lo"], v["h"], v["s"], v["n"], 0, Kody.proUlozeni());
        _zavibruj();
        return _ulozeno;
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var cx = sirka / 2;
        var cy = vyska / 2;

        var s = $.sledovac;
        if (s == null || !s.maFix()) {
            dc.drawText(cx, cy, Graphics.FONT_MEDIUM, "hledám GPS",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            Displej.dole(dc, "BACK = zpět", Graphics.FONT_XTINY);
            return;
        }

        var n = s.klid.pocet();
        var sig = s.klid.prubeznaSigma();
        var sek = s.klidSekund();

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        Displej.nahore(dc, "nový bod " + Body.dalsiCislo(), Graphics.FONT_XTINY);

        // Rozptyl velkým písmem — to je jediné číslo, podle kterého se
        // člověk rozhoduje, jestli už uložit, nebo ještě počkat.
        // FONT_LARGE, ne FONT_NUMBER_*: v číselném fontu chybí „±" i „m“
        // a zbylo by holé číslo bez toho, co znamená.
        var hlavni = (sig == null) ? "—" : ("±" + sig.format("%.1f") + " m");
        dc.setColor(_barva(n, sig), Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy - 16, Graphics.FONT_LARGE, hlavni,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        var podrobne = n.toString() + " vzorků";
        if (sek != null) { podrobne += " · " + sek.toString() + " s"; }
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy + 26, Graphics.FONT_XTINY, podrobne,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        if (n < DOST) {
            dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 48, Graphics.FONT_XTINY, "chvíli stůj, klesá to",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        // Kód bodu se přepíná šipkami rovnou tady — žádná další obrazovka,
        // žádný stisk navíc. Šipky na téhle obrazovce stejně nic nedělaly.
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        var spodek = Displej.dole(dc, "↑↓ kód   START = ulož", Graphics.FONT_XTINY);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, spodek - dc.getFontHeight(Graphics.FONT_SMALL) / 2 - 1,
                    Graphics.FONT_SMALL, Kody.nazev(),
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    //! Barva podle toho, jak moc se dá výsledku věřit. Zelená až když je
    //! rozptyl malý A vzorků dost — samotný malý rozptyl z pěti vzorků
    //! nic neznamená.
    hidden function _barva(n, sig) {
        if (sig == null || n < 5)          { return Graphics.COLOR_DK_GRAY; }
        if (n >= DOST && sig <= 1.5)       { return Graphics.COLOR_GREEN; }
        if (sig <= 3.0)                    { return Graphics.COLOR_YELLOW; }
        return Graphics.COLOR_ORANGE;
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
        _view.uloz();
        _zpetNaMapu();
        return true;
    }

    function onBack() {
        _zpetNaMapu();
        return true;
    }

    function onNextPage() {
        Kody.dalsi();
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() {
        Kody.predchozi();
        WatchUi.requestUpdate();
        return true;
    }

    //! Pod měřením zůstala otevřená nabídka, ze které se sem vstoupilo —
    //! zavřít se musí obě, jinak se člověk vrátí do nabídky místo na mapu.
    hidden function _zpetNaMapu() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}
