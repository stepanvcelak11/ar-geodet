using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Timer;
using Toybox.Attention;
using Toybox.System;

//! Párování hodinek s mobilem — kód se ukáže TADY a opíše se v mobilu.
//!
//! ⚠ Původně to bylo obráceně: kód vyrobil mobil a psal se do nastavení
//! aplikace v Garmin Connect. Jenže **nahraná aplikace se v Garmin Connect
//! neobjeví**, takže do jejího nastavení se nedá napsat vůbec nic a kód se
//! do hodinek jinak nedostane.
//!
//! Otočení má i tak lepší ovládání: píše se na zařízení, které má
//! klávesnici. Hodinky jen ukazují šest znaků a čekají, až je někdo
//! v mobilu potvrdí.
//!
//! Kód na displeji je veřejný — kdokoli ho může přečíst přes rameno —
//! takže sám o sobě k ničemu nestačí. Token si hodinky vyzvednou proti
//! tajemství, které dostaly zvlášť a nikde se neukazuje.
class ParovaniView extends WatchUi.View {

    hidden var _casovac = null;
    hidden var _tik = 0;

    function initialize() {
        View.initialize();
    }

    function onShow() {
        // Podsvícení: kód se opisuje z displeje, ať je vidět.
        if (Attention has :backlight) {
            try { Attention.backlight(true); } catch (e) {}
        }
        $.cloud.zacniParovani();
        _casovac = new Timer.Timer();
        _casovac.start(method(:tik), 1000, true);
    }

    function onHide() {
        if (_casovac != null) {
            _casovac.stop();
            _casovac = null;
        }
        $.cloud.prestanParovat();
    }

    //! Na server se ťuká po třech sekundách, ne každou — přes telefon to
    //! jde rádiem a častější dotazy by jen ujídaly baterii.
    function tik() as Void {
        _tik += 1;
        if (_tik % 3 == 0) { $.cloud.zeptejSeNaParovani(); }
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var cx = sirka / 2;
        var cy = vyska / 2;

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        Displej.nahore(dc, "opiš v mobilu", Graphics.FONT_XTINY);

        var kod = $.cloud.parovaciKod;
        if (kod == null || kod.equals("")) {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy, Graphics.FONT_MEDIUM, "…",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            // ⚠ NIKDY NE Graphics.FONT_NUMBER_* — ty obsahují POUZE ČÍSLICE.
            // Kód má i písmena a ta se v číselném fontu prostě nevykreslila;
            // na displeji zbyly jen dvě číslice a vypadalo to jako chyba
            // párování. Bere se největší běžný font, který se ještě vejde.
            var text = kod.substring(0, 3) + " " + kod.substring(3, 6);
            var font = Graphics.FONT_LARGE;
            if (dc.getTextWidthInPixels(text, font) > sirka - 24) {
                font = Graphics.FONT_MEDIUM;
            }
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 6, font, text,
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy + 34, Graphics.FONT_XTINY, $.cloud.stav,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        Displej.dole(dc, "Nástroje → Hodinky Garmin", Graphics.FONT_XTINY);
    }
}


class ParovaniDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    //! Zpátky přes párování i nabídku, ze které se sem vstoupilo.
    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onSelect() { return onBack(); }
}
