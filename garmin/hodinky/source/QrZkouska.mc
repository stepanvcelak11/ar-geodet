using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Attention;
using Toybox.System;

//! ZKOUŠKA ČITELNOSTI QR — dočasná obrazovka, ne hotová funkce.
//!
//! Otázka, na které celý nápad „body z hodinek do mobilu přes QR" stojí:
//! přečte telefon QR z transflektivního MIP displeje? Ten je matný, má nízký
//! kontrast a viditelně oddělené pixely — není to telefonní OLED. Než psát
//! generátor QR v Monkey C (Reed–Solomon, maskování, a to všechno pod
//! watchdogem), vyplatí se ověřit tohle.
//!
//! Ukazuje dva hotové kódy vyrobené na počítači, oba ve formátu AG1, který
//! umí načíst skener v aplikaci (js/sdileni.js):
//!
//!   řídký  — 3 px na modul, 7 bodů  (bezpečná varianta)
//!   hustý  — 2 px na modul, 19 bodů (ambiciózní varianta)
//!
//! Když se přečte jen řídký, je strop kolem sedmi bodů na kód. Když ani ten,
//! nemá smysl v tom pokračovat.
//!
//! ODSTRANĚNÍ: smaž tento soubor, obě položky v resources/drawables.xml,
//! oba PNG a položku „Zkouška QR" v Nabidka.mc.
class QrZkouskaView extends WatchUi.View {

    hidden var _husty = false;
    hidden var _bitmapa = null;

    function initialize() {
        View.initialize();
    }

    function onShow() {
        // Podsvícení pomáhá zásadně — MIP displej sám o sobě nesvítí a bez
        // světla je kontrast pro kameru mizerný.
        if (Attention has :backlight) {
            try { Attention.backlight(true); } catch (e) {}
        }
        _nacti();
    }

    function prepni() {
        _husty = !_husty;
        _nacti();
        WatchUi.requestUpdate();
    }

    hidden function _nacti() {
        _bitmapa = WatchUi.loadResource(_husty ? Rez.Drawables.QrHusty : Rez.Drawables.QrRidky);
    }

    function onUpdate(dc) {
        // Bílé pozadí po celé ploše: klidová zóna kolem kódu musí být světlá
        // a kolem kulatého okraje se stejně nic jiného nevejde.
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_WHITE);
        dc.clear();

        var sirka = dc.getWidth();
        var vyska = dc.getHeight();

        if (_bitmapa != null) {
            dc.drawBitmap((sirka - _bitmapa.getWidth()) / 2,
                          (vyska - _bitmapa.getHeight()) / 2, _bitmapa);
        }

        // Popisek co nejmenší a u kraje, ať nezasahuje do klidové zóny.
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(sirka / 2, vyska - 9, Graphics.FONT_XTINY,
                    _husty ? "hustý · 19 bodů · ↑↓" : "řídký · 7 bodů · ↑↓",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}


class QrZkouskaDelegate extends WatchUi.BehaviorDelegate {

    hidden var _view;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onNextPage()     { _view.prepni(); return true; }
    function onPreviousPage() { _view.prepni(); return true; }

    //! Zpátky přes zkoušku i nabídku, ze které se sem vstoupilo.
    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onSelect() { return onBack(); }
}
