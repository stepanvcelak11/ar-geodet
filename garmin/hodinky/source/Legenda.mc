using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Math;

//! Legenda podkladu.
//!
//! Barvu si člověk zapamatuje, ale ne napoprvé — a v terénu si nemá kde
//! přečíst, co která znamená. Proto je legenda pár stisky daleko a ne
//! v návodu na počítači.
//!
//! Řádky se odsazují podle tětivy: na kulatém displeji je nahoře a dole
//! míň místa, takže se krajní řádky posunou dovnitř místo aby se ořízly.
class LegendaView extends WatchUi.View {

    hidden var _radky;

    function initialize() {
        View.initialize();
        _radky = [
            [Podklad.B_SILNICE,  "silnice, cesta"],
            [Podklad.B_PESINA,   "pěšina"],
            [Podklad.B_TOK,      "voda"],
            [Podklad.B_ZELEN,    "les, park"],
            [Podklad.B_POLE,     "pole, louka"],
            [Podklad.B_PREKAZKA, "NEPROJDEŠ"],
            [Podklad.B_BUDOVA,   "budova (šrafa)"]
        ];
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var cx = sirka / 2;
        var cy = vyska / 2;
        var r = ((sirka < vyska) ? sirka : vyska) / 2.0;

        var font = Graphics.FONT_XTINY;
        var vf = dc.getFontHeight(font);
        var krok = vf + 3;
        var y = cy - (_radky.size() - 1) * krok / 2;

        for (var i = 0; i < _radky.size(); i++) {
            var dy = y - cy;
            // Poloviční šířka tětivy v téhle výšce — dál od středu je jí míň.
            var pul = r * r - dy * dy;
            pul = (pul <= 0) ? 0 : Math.sqrt(pul);
            var x = cx - pul + 6;

            dc.setColor(_radky[i][0], Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(x, y - 4, 16, 8);

            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(x + 22, y, font, _radky[i][1],
                        Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            y += krok;
        }
    }
}


class LegendaDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    //! Zpátky se jde přes legendu i nabídku, ze které se sem vstoupilo.
    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onSelect() {
        return onBack();
    }
}
