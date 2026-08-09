using Toybox.WatchUi;
using Toybox.System;

//! Nabídka pod dlouhým stiskem UP. Všechno, co se nevejde na tři tlačítka.
module Nabidka {

    var _mapa = null;

    function otevri(mapa) {
        _mapa = mapa;

        var menu = new WatchUi.Menu2({ :title => "Nabídka" });
        menu.addItem(new WatchUi.MenuItem("Nový bod", "změřit průměrováním", :novy, {}));
        menu.addItem(new WatchUi.MenuItem("Otočení mapy",
                        mapa.podleSmeru ? "podle směru" : "sever nahoře", :otoceni, {}));
        menu.addItem(new WatchUi.MenuItem("Body v paměti",
                        Body.pocet().toString() + " · další číslo " + Body.dalsiCislo(), :info, {}));
        menu.addItem(new WatchUi.MenuItem("Ukázkové body", "pro zkoušení v simulátoru", :ukazka, {}));
        menu.addItem(new WatchUi.MenuItem("Smazat všechny body", "nelze vzít zpět", :smazat, {}));

        WatchUi.pushView(menu, new NabidkaDelegate(), WatchUi.SLIDE_UP);
    }

    function mapa() {
        return _mapa;
    }
}


class NabidkaDelegate extends WatchUi.Menu2InputDelegate {

    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item) {
        var id = item.getId();

        if (id == :novy) {
            WatchUi.popView(WatchUi.SLIDE_DOWN);
            var v = new NovyBodView();
            WatchUi.pushView(v, new NovyBodDelegate(v), WatchUi.SLIDE_UP);

        } else if (id == :otoceni) {
            Nabidka.mapa().otoceni();
            item.setSubLabel(Nabidka.mapa().podleSmeru ? "podle směru" : "sever nahoře");

        } else if (id == :ukazka) {
            var s = $.sledovac;
            if (s != null && s.lat != null) {
                Body.ukazkove(s.lat, s.lon);
                item.setSubLabel("založeno · " + Body.pocet().toString() + " bodů");
            } else {
                item.setSubLabel("nejde bez polohy");
            }

        } else if (id == :smazat) {
            // Druhý stisk potvrzuje — plnohodnotný dialog by tu byl přes
            // ruku a jde o data, která se dají znovu naměřit.
            if (item.getLabel().equals("Smazat všechny body")) {
                item.setLabel("Opravdu smazat?");
                item.setSubLabel("ještě jednou START");
            } else {
                Body.smazVse();
                item.setLabel("Smazat všechny body");
                item.setSubLabel("smazáno");
            }
        }
    }

    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}
