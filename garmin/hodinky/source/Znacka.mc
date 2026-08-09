using Toybox.Application.Storage;
using Toybox.Attention;
using Toybox.System;
using Toybox.Lang;

//! „Označ tady" — rychlá značka, ne měřený bod.
//!
//! Auto, stanovisko, kde jsem nechal lať, odkud jsem odbočil z cesty. Věci,
//! ke kterým se člověk potřebuje vrátit a které nemají co dělat v protokolu.
//!
//! Proto má značka VLASTNÍ číslování Z1, Z2, … a nesahá na sérii měřených
//! bodů: kdyby ukusovala z rezervovaného bloku (viz Body.dalsiCislo), došla
//! by čísla rychleji a hlavně by v číslování vznikaly díry, které by nikdo
//! neuměl vysvětlit.
//!
//! Nečeká se ani vteřinu. Průměrování běží pořád, když se stojí (Sledovac),
//! takže se rovnou vezme, co je nasbírané; a když ještě není nic, vezme se
//! poslední poloha. U značky je „hned a přibližně" správně — kdo chce
//! přesnost, založí normální bod.
module Znacka {

    const KLIC = "znacka_n";

    function dalsiCislo() {
        var n = Storage.getValue(KLIC);
        if (n == null || !(n instanceof Lang.Number) || n < 1) { n = 1; }
        return "Z" + n.toString();
    }

    //! Položí značku na aktuální polohu. Vrací její jméno, nebo null,
    //! když ještě není poloha.
    function polozZde() {
        var s = $.sledovac;
        if (s == null || s.lat == null) { return null; }

        var la = s.lat;
        var lo = s.lon;
        var h  = s.vyska;
        var sig = null;
        var poc = 0;

        // Když je průměr po ruce, je lepší než jediný fix — stojí to nic.
        var v = s.klid.vysledek();
        if (v != null) {
            var k = Korekce.pouzij(v["la"], v["lo"]);
            la  = k[0];
            lo  = k[1];
            h   = v["h"];
            sig = v["s"];
            poc = v["n"];
        }

        var jmeno = dalsiCislo();
        Body.pridejSCislem(jmeno, la, lo, h, sig, poc, 0, "značka");

        var n = Storage.getValue(KLIC);
        if (n == null || !(n instanceof Lang.Number) || n < 1) { n = 1; }
        Storage.setValue(KLIC, n + 1);

        _zavibruj();
        return jmeno;
    }

    function _zavibruj() {
        if (!(Attention has :vibrate)) { return; }
        var ds = System.getDeviceSettings();
        if (ds == null || !ds.vibrateOn) { return; }
        Attention.vibrate([new Attention.VibeProfile(50, 150)]);
    }
}
