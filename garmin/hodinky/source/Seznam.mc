using Toybox.WatchUi;
using Toybox.Lang;

//! Seznam bodů v okolí, seřazený od nejbližšího.
//!
//! Staví se na systémovém Menu2 — scrollování tlačítky nahoru/dolů a výběr
//! START je pak nativní, což je na nedotykovém Forerunneru přesně to, co
//! chceme. Vlastní scrollovaná obrazovka by se ovládala hůř a nic by
//! nepřidala.
module Seznam {

    //! Kolik bodů se do seznamu vůbec dostane. Přes seznam se pracuje
    //! s tím, co je na dohled, ne s celou zakázkou.
    const KOLIK = 20;

    var _okoli = [];

    function otevri() {
        var s = $.sledovac;
        var menu = new WatchUi.Menu2({ :title => "Okolí" });

        if (s == null || s.lat == null) {
            _okoli = [];
            menu.addItem(new WatchUi.MenuItem("Není poloha", "čekám na GPS", -1, {}));
            WatchUi.pushView(menu, new SeznamDelegate(), WatchUi.SLIDE_UP);
            return;
        }

        _okoli = Body.nejblizsi(s.lat, s.lon, KOLIK);

        if (_okoli.size() == 0) {
            // I prázdná položka dostane číselný identifikátor — kdyby tu byl
            // symbol, muselo by se při výběru rozlišovat, čím to vlastně je.
            menu.addItem(new WatchUi.MenuItem("Žádné body", "založ nový dlouhým UP", -1, {}));
        } else {
            for (var i = 0; i < _okoli.size(); i++) {
                var b = _okoli[i];
                var podtitulek = Geo.popisVzdalenosti(b["d"]) + " · " + Geo.svetovaStrana(b["az"]);
                if (b["k"] != null && !b["k"].equals("")) {
                    podtitulek += " · " + b["k"];
                }
                // hvězdička = naměřeno tady a ještě to neodešlo do mobilu
                if (b["src"] == 0 && b["up"] != 1) { podtitulek += " ✱"; }
                // Identifikátor je pořadí v _okoli, ne číslo bodu — z čísla
                // by se zpátky hledalo a Menu2 stejně vrací jen ten symbol.
                menu.addItem(new WatchUi.MenuItem(b["c"], podtitulek, i, {}));
            }
        }

        WatchUi.pushView(menu, new SeznamDelegate(), WatchUi.SLIDE_UP);
    }

    function bod(index) {
        if (index == null || index < 0 || index >= _okoli.size()) { return null; }
        return _okoli[index];
    }
}


class SeznamDelegate extends WatchUi.Menu2InputDelegate {

    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item) {
        var b = Seznam.bod(item.getId());
        if (b == null) { return; }

        // Zpátky na MAPU, ne na obrazovku se šipkou. Šipka řekne směr, ale
        // ne co je mezi tebou a bodem; mapa se sama oddálí, aby byl cíl
        // v záběru, a vede k němu čárkovaná čára.
        $.mapaView.cil = b;
        $.mapaView.autoZoom = true;
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }

    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}
