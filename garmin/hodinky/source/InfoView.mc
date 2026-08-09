using Toybox.WatchUi;
using Toybox.Graphics;

//! Úplné údaje o bodu — číslo, kód, souřadnice.
//!
//! Y a X jsou v S-JTSK, tedy v tom, s čím geodet doopravdy pracuje. ⚠ Nepočítá
//! je tahle aplikace: Křovák i posun datumu dělá mobil (GeoCore/proj4, jediný
//! autoritativní převod v projektu) a posílá je hotové. Druhá implementace
//! v Monkey C by se dřív nebo později rozešla s tou v mobilu a nikdo by
//! nepoznal, které číslo platí.
//!
//! Když bod přišel bez S-JTSK (naměřený tady, ještě neodeslaný), ukáže se
//! zeměpisná poloha — radši přiznat, že Y/X nejsou, než je vymýšlet.
class InfoView extends WatchUi.View {

    hidden var _b;

    function initialize(b) {
        View.initialize();
        _b = b;
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var cx = sirka / 2;
        var font = Graphics.FONT_XTINY;
        var krok = dc.getFontHeight(font) + 1;

        // číslo bodu velkým písmem nahoře — kvůli němu se sem chodí
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        var y = Displej.nahore(dc, _b["c"], Graphics.FONT_MEDIUM) + 2;

        var kod = _b["k"];
        if (kod != null && !kod.equals("")) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, y + krok / 2, font, kod,
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            y += krok;
        }

        y += 4;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);

        if (_b["y"] != null && _b["x"] != null) {
            y = _radek(dc, cx, y, krok, font, "Y  " + _b["y"].format("%.2f"));
            y = _radek(dc, cx, y, krok, font, "X  " + _b["x"].format("%.2f"));
        } else {
            // ⚠ Bez S-JTSK se nic nepředstírá — ukáže se, co skutečně je.
            y = _radek(dc, cx, y, krok, font, _b["la"].format("%.6f"));
            y = _radek(dc, cx, y, krok, font, _b["lo"].format("%.6f"));
        }
        if (_b["h"] != null) {
            y = _radek(dc, cx, y, krok, font, "Z  " + _b["h"].format("%.2f"));
        }

        // vzdálenost odsud a rozptyl, se kterým byl bod měřen
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        var s = $.sledovac;
        if (s != null && s.lat != null) {
            var d = Geo.vzdalenost(s.lat, s.lon, _b["la"], _b["lo"]);
            y = _radek(dc, cx, y + 3, krok, font,
                       Geo.popisVzdalenosti(d) + " " + Geo.svetovaStrana(
                           Geo.azimut(s.lat, s.lon, _b["la"], _b["lo"])));
        }
        if (_b["s"] != null) {
            y = _radek(dc, cx, y, krok, font, "±" + _b["s"].format("%.1f") + " m");
        }

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        Displej.dole(dc, "BACK = zpět", font);
    }

    hidden function _radek(dc, cx, y, krok, font, text) {
        dc.drawText(cx, y + krok / 2, font, text,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        return y + krok;
    }
}


class InfoDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onSelect() { return onBack(); }
}
