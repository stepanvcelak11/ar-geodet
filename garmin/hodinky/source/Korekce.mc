using Toybox.Application.Storage;
using Toybox.Math;
using Toybox.Lang;
using Toybox.Time;
using Toybox.Attention;
using Toybox.System;
using Toybox.WatchUi;

//! Lokální korekce na známém bodu — jednobodový posun.
//!
//! CO TO ŘEŠÍ. Rozptyl vzorků, který hodinky ukazují u každého bodu, říká
//! „jak klidně to leželo", ne „jak daleko jsem od pravdy" (viz Prumer).
//! Systematická složka chyby — ionosféra, dráhy družic, odrazy od domů —
//! posouvá všechny vzorky STEJNÝM směrem, takže se v rozptylu vůbec
//! neprojeví a hodinky o ní nemají jak vědět.
//!
//! Zjistit se ale dá: postavit se na bod, jehož souřadnice jsou známé
//! (přišel z mobilu, změřený pořádně), a porovnat je s tím, co v tu chvíli
//! hlásí GNSS. Rozdíl je právě ta systematická složka. Odečítá se pak od
//! všech dalších poloh — od měření nových bodů i od navigace.
//!
//! ⚠ CO TO NEDĚLÁ. Není to RTK ani DGPS. Vyruší se jen ta část chyby, která
//! je v okolí společná, a to jen na chvíli — družice se pohybují a odrazy se
//! mění s každým domem. Proto korekce po čase i po vzdálenosti sama vyprší:
//! stará korekce je horší než žádná, protože se tváří, že se něco zlepšilo.
//! Vytyčovací přesnost z toho nebude ani náhodou.
//!
//! ⚠ Je to modul, ne třída — nepotřebuje `method(:jméno)`. Stav se drží
//! v paměti a do Storage se sahá jen při nastavení a zrušení; `pouzij()`
//! běží při každém fixu, tedy jednou za sekundu, a číst při tom Storage
//! by byla zbytečná práce po celou dobu běhu aplikace.
module Korekce {

    const KLIC = "korekce";

    //! Jak dlouho korekce platí [s]. Patnáct minut je kompromis: za tu dobu
    //! se konstelace družic nestihne rozsypat, ale ani se nedá zapomenout
    //! na korekci pořízenou dopoledne.
    const PLATNOST = 900;

    //! Jak daleko od kalibračního bodu ještě platí [m]. Za kilometrem už je
    //! obloha jiná a odrazy taky.
    const DOSAH = 1000.0;

    var _dx  = 0.0;      // posun k východu [m], který se PŘIČÍTÁ k měřené poloze
    var _dy  = 0.0;      // posun k severu [m]
    var _t   = 0;        // kdy vznikla [s od epochy]
    var _la0 = null;     // kde vznikla
    var _lo0 = null;
    var _bod = "";       // podle kterého bodu
    var _nacteno = false;

    //! Ze Storage se čte jednou za běh aplikace. Korekce přežije vypnutí
    //! hodinek jen potud, pokud mezitím nevypršela.
    function _nacti() {
        if (_nacteno) { return; }
        _nacteno = true;
        var k = Storage.getValue(KLIC);
        if (k == null || !(k instanceof Lang.Dictionary) || k["t"] == null) { return; }
        _dx  = k["dx"];
        _dy  = k["dy"];
        _t   = k["t"];
        _la0 = k["la"];
        _lo0 = k["lo"];
        _bod = (k["b"] == null) ? "" : k["b"];
    }

    //! Je korekce v tuhle chvíli platná? Zároveň ji nechá vypršet, když už
    //! na ni je pozdě.
    function aktivni() {
        _nacti();
        if (_t == null || _t == 0) { return false; }
        var stari = Time.now().value() - _t;
        if (stari > PLATNOST) {
            zrus();
            return false;
        }
        return true;
    }

    //! Velikost korekce [m] — o kolik se poloha posouvá.
    function velikost() {
        _nacti();
        return Math.sqrt(_dx * _dx + _dy * _dy);
    }

    function bod() {
        _nacti();
        return _bod;
    }

    //! Opravená poloha. Vrací [lat, lon]; když korekce neplatí, vrací
    //! vstup beze změny, takže se volající nemusí na nic ptát.
    //!
    //! Vypršení podle VZDÁLENOSTI se testuje tady, protože tady je jediné
    //! místo, kde je čerstvá poloha po ruce.
    function pouzij(lat, lon) {
        if (!aktivni()) { return [lat, lon]; }
        if (_la0 != null && Geo.vzdalenost(_la0, _lo0, lat, lon) > DOSAH) {
            zrus();
            return [lat, lon];
        }
        return Geo.zMetru(lat, lon, _dx, _dy);
    }

    //! Nastaví korekci: známý bod mínus to, co teď ukazuje GNSS.
    //!
    //! `mereno` je NEOPRAVENÁ poloha (průměr z Prumer, který sbírá syrová
    //! data) — jinak by se korekce počítala z už jednou opravené polohy
    //! a druhá kalibrace na témž bodě by posunula polohu podruhé.
    function nastav(znamyLa, znamyLo, merenoLa, merenoLo, jmenoBodu) {
        var d = Geo.naMetry(merenoLa, merenoLo, znamyLa, znamyLo);
        _nacteno = true;
        _dx  = d[0];
        _dy  = d[1];
        _t   = Time.now().value();
        _la0 = znamyLa;
        _lo0 = znamyLo;
        _bod = (jmenoBodu == null) ? "" : jmenoBodu;
        Storage.setValue(KLIC, {
            "dx" => _dx, "dy" => _dy, "t" => _t,
            "la" => _la0, "lo" => _lo0, "b" => _bod
        });
        return velikost();
    }

    function zrus() {
        _nacteno = true;
        _dx = 0.0; _dy = 0.0; _t = 0; _la0 = null; _lo0 = null; _bod = "";
        Storage.deleteValue(KLIC);
    }

    //! Krátký popis pro displej, třeba „kor 1,2 m · 8 min". Null, když
    //! korekce neplatí — volající pak nemá co psát.
    function popis() {
        if (!aktivni()) { return null; }
        var min = (Time.now().value() - _t) / 60;
        return "kor " + velikost().format("%.1f") + " m · " + min.toString() + " min";
    }
}


//! Výběr známého bodu. Menu2 se seznamem toho, co je na dosah kroku
//! a přišlo z mobilu.
module KorekceMenu {

    //! Na známý bod se musí stoupnout. Padesát metrů je velkorysé i na to,
    //! aby se v seznamu ukázal bod, ke kterému se člověk teprve chystá.
    const BLIZKO = 50.0;

    //! Pod tolik vzorků se kalibrovat nedá — korekce by nesla vlastní šum
    //! měření a bylo by to horší než nic.
    const MIN_VZORKU = 10;

    var _vyber = [];

    function otevri() {
        var menu = new WatchUi.Menu2({ :title => "Korekce" });
        _vyber = [];

        if (Korekce.aktivni()) {
            menu.addItem(new WatchUi.MenuItem("Zrušit korekci",
                            Korekce.popis() + " · " + Korekce.bod(), -1, {}));
        }

        var s = $.sledovac;
        if (s == null || !s.maFix()) {
            menu.addItem(new WatchUi.MenuItem("Není poloha", "čekám na GPS", -2, {}));
        } else if (s.klid.pocet() < MIN_VZORKU) {
            menu.addItem(new WatchUi.MenuItem("Chvíli stůj",
                            s.klid.pocet().toString() + " z " + MIN_VZORKU.toString() + " vzorků",
                            -2, {}));
        } else {
            var okoli = Body.nejblizsi(s.lat, s.lon, 20);
            for (var i = 0; i < okoli.size(); i++) {
                var b = okoli[i];
                // Jedině body z mobilu: bod naměřený hodinkami je sám
                // nejistý na metry a korigovat podle něj nemá smysl.
                if (b["src"] != 1) { continue; }
                if (b["d"] > BLIZKO) { continue; }
                _vyber.add(b);
                menu.addItem(new WatchUi.MenuItem(b["c"],
                                Geo.popisVzdalenosti(b["d"]) + " · stoupni si na něj",
                                _vyber.size() - 1, {}));
            }
            if (_vyber.size() == 0) {
                menu.addItem(new WatchUi.MenuItem("Není na čem",
                                "žádný bod z mobilu do 50 m", -2, {}));
            }
        }

        WatchUi.pushView(menu, new KorekceDelegate(), WatchUi.SLIDE_UP);
    }

    function bod(index) {
        if (index == null || index < 0 || index >= _vyber.size()) { return null; }
        return _vyber[index];
    }
}


class KorekceDelegate extends WatchUi.Menu2InputDelegate {

    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item) {
        var id = item.getId();

        if (id == -1) {
            Korekce.zrus();
            WatchUi.popView(WatchUi.SLIDE_DOWN);
            return;
        }
        if (id == -2) { return; }       // jen hláška, není co vybírat

        var b = KorekceMenu.bod(id);
        var s = $.sledovac;
        if (b == null || s == null) { return; }

        // SYROVÝ průměr, ne s.lat/s.lon — ty už můžou být jednou opravené
        // a korekce by se sečetla dvakrát.
        var v = s.klid.vysledek();
        if (v == null) { return; }

        Korekce.nastav(b["la"], b["lo"], v["la"], v["lo"], b["c"]);
        _zavibruj();

        // Jediný pop = zpátky na mapu: nabídka se zavřela už při otevírání
        // téhle (viz Nabidka, větev :korekce), takže tohle menu leží rovnou
        // na mapě. Druhý pop by ukončil aplikaci.
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }

    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }

    hidden function _zavibruj() {
        if (!(Attention has :vibrate)) { return; }
        var ds = System.getDeviceSettings();
        if (ds == null || !ds.vibrateOn) { return; }
        Attention.vibrate([new Attention.VibeProfile(75, 250)]);
    }
}
