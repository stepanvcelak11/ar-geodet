using Toybox.Application.Storage;

//! Kódy bodů — co to vlastně je za bod.
//!
//! Bez kódu jsou všechny body jen čísla a v kanceláři se nepozná, co je
//! co. Vybírá se šipkami rovnou na obrazovce zakládání, aby to nestálo
//! ani jeden stisk navíc.
//!
//! Naposledy použitý kód se pamatuje: při měření se obvykle jede jeden
//! druh po druhém (nejdřív všechny sloupy, pak všechny šachty), takže
//! výchozí „stejný jako minule“ trefí většinu případů.
module Kody {

    var _seznam = null;
    var _vybrany = null;

    const KLIC = "kod";

    function seznam() {
        if (_seznam == null) {
            // Krátký a hrubý schválně — na výběr šipkami se dlouhý číselník
            // neovládá. Jemnější dělení patří do mobilu.
            _seznam = [
                "—",
                "roh",
                "hranice",
                "sloup",
                "šachta",
                "vpusť",
                "hydrant",
                "obrubník",
                "strom",
                "plot",
                "roh budovy",
                "výška"
            ];
        }
        return _seznam;
    }

    function index() {
        if (_vybrany == null) {
            var v = Storage.getValue(KLIC);
            _vybrany = (v == null || v < 0 || v >= seznam().size()) ? 0 : v;
        }
        return _vybrany;
    }

    function nazev() {
        return seznam()[index()];
    }

    //! Kód pro uložení do bodu. Prázdný řetězec, když není vybraný —
    //! ať se v datech nepletou pomlčky s obsahem.
    function proUlozeni() {
        var i = index();
        return (i == 0) ? "" : seznam()[i];
    }

    function dalsi() {
        _vybrany = (index() + 1) % seznam().size();
        Storage.setValue(KLIC, _vybrany);
    }

    function predchozi() {
        _vybrany = index() - 1;
        if (_vybrany < 0) { _vybrany = seznam().size() - 1; }
        Storage.setValue(KLIC, _vybrany);
    }
}
