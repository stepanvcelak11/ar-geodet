using Toybox.WatchUi;
using Toybox.System;

//! Nabídka pod dlouhým stiskem UP. Všechno, co se nevejde na tři tlačítka.
module Nabidka {

    var _mapa = null;

    function otevri(mapa) {
        _mapa = mapa;

        var menu = new WatchUi.Menu2({ :title => "Nabídka" });
        menu.addItem(new WatchUi.MenuItem("Nový bod", "změřit průměrováním", :novy, {}));
        // Navigace je i pod tlačítkem START, ale kdo to neví, nenajde ji —
        // v nabídce po ní člověk sáhne sám.
        menu.addItem(new WatchUi.MenuItem("Navigovat k bodu",
                        Body.pocet().toString() + " bodů v okolí", :navigace, {}));
        menu.addItem(new WatchUi.MenuItem("Otočení mapy",
                        (mapa != null && mapa.podleSmeru) ? "podle směru" : "sever nahoře",
                        :otoceni, {}));
        menu.addItem(new WatchUi.MenuItem("Podklad",
                        (mapa != null && mapa.podklad) ? "čáry cest zapnuté" : "vypnutý",
                        :podklad, {}));
        menu.addItem(new WatchUi.MenuItem("Bzučák u bodu",
                        Blizkost.zapnuto() ? "vibruje do 5 m" : "vypnutý", :bzucak, {}));
        menu.addItem(new WatchUi.MenuItem("Synchronizovat s mobilem",
                        $.cloud.sparovano()
                            ? ($.cloud.stav.equals("") ? ("zakázka " + $.cloud.zakazka()) : $.cloud.stav)
                            : "nespárováno — kód v Garmin Connect",
                        :sync, {}));
        menu.addItem(new WatchUi.MenuItem("Legenda", "co která barva znamená", :legenda, {}));
        menu.addItem(new WatchUi.MenuItem("Body v paměti",
                        Body.pocet().toString() + " · další číslo " + Body.dalsiCislo(), :info, {}));
        menu.addItem(new WatchUi.MenuItem("Zkouška QR", "přečte to mobil z displeje?", :qr, {}));
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
            // Měření se položí NA nabídku, nabídka se nezavírá. Zavřít ji
            // zevnitř vlastního onSelect a hned nato něco otevřít se na
            // některých firmwarech nesnáší; návrat se pak řeší dvojím pop.
            var v = new NovyBodView();
            WatchUi.pushView(v, new NovyBodDelegate(v), WatchUi.SLIDE_UP);

        } else if (id == :otoceni) {
            var m = Nabidka.mapa();
            if (m != null) {
                m.otoceni();
                item.setSubLabel(m.podleSmeru ? "podle směru" : "sever nahoře");
            }

        } else if (id == :podklad) {
            var mp = Nabidka.mapa();
            if (mp != null) {
                mp.podklad = !mp.podklad;
                if (!mp.podklad) { Podklad.zapomen(); }
                item.setSubLabel(mp.podklad ? "čáry cest zapnuté" : "vypnutý");
            }

        } else if (id == :navigace) {
            WatchUi.popView(WatchUi.SLIDE_DOWN);
            Seznam.otevri();

        } else if (id == :bzucak) {
            item.setSubLabel(Blizkost.prepni() ? "vibruje do 5 m" : "vypnutý");

        } else if (id == :sync) {
            $.cloud.synchronizuj();
            item.setSubLabel($.cloud.stav);

        } else if (id == :legenda) {
            WatchUi.pushView(new LegendaView(), new LegendaDelegate(), WatchUi.SLIDE_UP);

        } else if (id == :qr) {
            var qv = new QrZkouskaView();
            WatchUi.pushView(qv, new QrZkouskaDelegate(qv), WatchUi.SLIDE_UP);

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
