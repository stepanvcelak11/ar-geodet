using Toybox.Graphics;
using Toybox.System;
using Toybox.Math;
using Toybox.Time;
using Toybox.Time.Gregorian;
using Toybox.Lang;

//! Umísťování textu na kulatý displej.
//!
//! Tohle je přesně ta věc, na kterou se u hodinek zapomene: u kraje kulatého
//! skla je použitelná šířka mnohem menší než uprostřed. Na 260px displeji má
//! řádek 12 px od horního kraje tětivu jen asi 109 px — tam se nevejde skoro
//! nic a text se po stranách ořízne. Modul spočítá, jak hluboko musí řádek
//! slézt, aby se vešel celý, a u hranatých displejů nechá prostý okraj.
module Displej {

    var _kulaty = null;

    function kulaty() {
        if (_kulaty == null) {
            var ds = System.getDeviceSettings();
            _kulaty = (ds != null) && (ds.screenShape == System.SCREEN_SHAPE_ROUND);
        }
        return _kulaty;
    }

    //! Odsazení od horního (nebo dolního) kraje, ve kterém se text dané
    //! šířky ještě vejde celý.
    function odsazeni(sirka, vyska, sirkaTextu) {
        if (!kulaty()) { return 6; }
        var r = ((sirka < vyska) ? sirka : vyska) / 2.0;
        var pul = sirkaTextu / 2.0 + 4;          // 4 px vzduchu po stranách
        if (pul >= r) { return r; }              // nevejde se nikde, aspoň ať je vidět
        return r - Math.sqrt(r * r - pul * pul) + 2;
    }

    //! Vykreslí řádek co nejblíž hornímu kraji tak, aby se celý vešel.
    //! Vrací spodní hranu textu, aby se pod ni dalo kreslit dál.
    function nahore(dc, text, font) {
        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var v = dc.getFontHeight(font);
        var y = odsazeni(sirka, vyska, dc.getTextWidthInPixels(text, font)) + v / 2;
        dc.drawText(sirka / 2, y, font, text,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        return y + v / 2;
    }

    //! Hodiny jako HH:MM.
    //!
    //! Hodinky se nosí kvůli času a aplikace ho zakrývá po celou dobu, co
    //! je otevřená. Proto je čas na každé obrazovce, kde se člověk zdrží —
    //! malý a tlumený, aby nepřebíjel to hlavní.
    function cas() {
        var d = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        return Lang.format("$1$:$2$", [d.hour.format("%d"), d.min.format("%02d")]);
    }

    //! Velké číslo s malou jednotkou vedle.
    //!
    //! ⚠ Existuje kvůli tomu, že `Graphics.FONT_NUMBER_*` obsahují POUZE
    //! ČÍSLICE. Vykreslit jimi „34 m" znamená, že se ukáže jen „34" —
    //! a takové ticho se hledá zatraceně blbě. Číslo se proto kreslí
    //! číselným fontem a jednotka vedle běžným.
    function cisloSJednotkou(dc, cx, cy, cislo, jednotka, fontCisla) {
        var fj = Graphics.FONT_XTINY;
        var w1 = dc.getTextWidthInPixels(cislo, fontCisla);
        var w2 = jednotka.equals("") ? 0 : dc.getTextWidthInPixels(" " + jednotka, fj);
        var x = cx - (w1 + w2) / 2;

        dc.drawText(x, cy, fontCisla, cislo,
                    Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        if (w2 > 0) {
            // jednotka sedí na účaří čísla, ne na jeho středu
            dc.drawText(x + w1, cy + dc.getFontHeight(fontCisla) / 2 - dc.getFontHeight(fj) / 2 - 2,
                        fj, " " + jednotka,
                        Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    //! Totéž u dolního kraje. Vrací horní hranu textu.
    function dole(dc, text, font) {
        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var v = dc.getFontHeight(font);
        var y = vyska - odsazeni(sirka, vyska, dc.getTextWidthInPixels(text, font)) - v / 2;
        dc.drawText(sirka / 2, y, font, text,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        return y - v / 2;
    }
}
