using Toybox.Graphics;
using Toybox.System;
using Toybox.Math;

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
