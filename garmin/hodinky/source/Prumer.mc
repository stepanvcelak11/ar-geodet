using Toybox.Math;

//! Průměrování polohy při zakládání bodu.
//!
//! POZOR na to, co číslo, které z toho padá, doopravdy znamená.
//! Connect IQ nedává číselnou střední chybu ani DOP — Position.Info.accuracy
//! je jen hrubý stupeň (POOR / USABLE / GOOD). Spočítat se tedy dá jedině
//! rozptyl vlastních vzorků: nabere se N poloh po sekundě, vyhodí se odlehlé
//! a vezme se průměr.
//!
//! Výsledné číslo říká „jak klidně to leželo“, NE „jak daleko jsem od
//! pravdy“. Systematickou chybu z odrazů (multipath) neodhalí — ta se
//! v rozptylu neprojeví, protože posouvá všechny vzorky stejným směrem.
//! Proto se schválně nedělí odmocninou z počtu vzorků (což by dalo střední
//! chybu průměru): u GPS jsou vzorky po sekundě silně závislé, takový
//! výsledek by lhal směrem k optimismu. Držíme se rozptylu jednoho vzorku,
//! který je poctivě konzervativní.
class Prumer {

    //! Strop vzorků. Drží se klouzavé okno posledních dvou minut — starší
    //! vzorky už o tom, kde stojím teď, nic neříkají, a paměť hodinek není
    //! nafukovací.
    const OKNO = 120;

    hidden var _vzorky = [];      // [dx, dy, h] v metrech od prvního vzorku
    hidden var _lat0 = null;
    hidden var _lon0 = null;

    function initialize() {
        _vzorky = [];
    }

    function reset() {
        _vzorky = [];
        _lat0 = null;
        _lon0 = null;
    }

    function pridej(lat, lon, h) {
        if (_lat0 == null) {
            _lat0 = lat;
            _lon0 = lon;
        }
        var d = Geo.naMetry(_lat0, _lon0, lat, lon);
        _vzorky.add([d[0], d[1], (h == null) ? 0.0 : h]);
        if (_vzorky.size() > OKNO) {
            _vzorky = _vzorky.slice(_vzorky.size() - OKNO, _vzorky.size());
        }
    }

    function pocet() {
        return _vzorky.size();
    }

    //! Prostý průměr bez ořezu odlehlých — pro rychlé porovnání, jestli
    //! jsem se hnul. Na plnohodnotný výsledek je vysledek().
    function stred() {
        if (_vzorky.size() == 0) { return null; }
        var p = _prumer(_vzorky);
        return Geo.zMetru(_lat0, _lon0, p[0], p[1]);
    }

    //! Průběžný rozptyl pro zobrazení během sběru (null, dokud nejsou 3 vzorky).
    function prubeznaSigma() {
        if (_vzorky.size() < 3) { return null; }
        return _sigma(_vzorky, _prumer(_vzorky));
    }

    //! Hotový bod: {"la", "lo", "h", "s" rozptyl [m], "n" použitých vzorků,
    //! "out" vyhozených vzorků} nebo null, když se nenabralo nic.
    function vysledek() {
        if (_vzorky.size() < 1) { return null; }

        var p = _prumer(_vzorky);
        var s = _sigma(_vzorky, p);
        var pouzite = _vzorky;
        var vyhozeno = 0;

        // Druhý průchod: ven letí vzorky dál než 2,5 rozptylu od průměru.
        // Má smysl teprve od osmi vzorků — z pěti se odlehlá hodnota
        // nepozná, jen by se ořízlo něco platného.
        if (_vzorky.size() >= 8 && s > 0.0) {
            var ciste = [];
            var mez = 2.5 * s;
            for (var i = 0; i < _vzorky.size(); i++) {
                var ex = _vzorky[i][0] - p[0];
                var ey = _vzorky[i][1] - p[1];
                if (Math.sqrt(ex * ex + ey * ey) <= mez) {
                    ciste.add(_vzorky[i]);
                }
            }
            // Kdyby ořez sebral skoro všechno, je něco špatně se vzorky
            // samotnými — pak je poctivější nechat je všechny a přiznat
            // velký rozptyl, než vyrobit hezké číslo ze tří poloh.
            if (ciste.size() >= 4) {
                vyhozeno = _vzorky.size() - ciste.size();
                pouzite = ciste;
                p = _prumer(pouzite);
                s = _sigma(pouzite, p);
            }
        }

        var g = Geo.zMetru(_lat0, _lon0, p[0], p[1]);
        return {
            "la"  => g[0],
            "lo"  => g[1],
            "h"   => p[2],
            "s"   => s,
            "n"   => pouzite.size(),
            "out" => vyhozeno
        };
    }

    hidden function _prumer(v) {
        var sx = 0.0;
        var sy = 0.0;
        var sh = 0.0;
        for (var i = 0; i < v.size(); i++) {
            sx += v[i][0];
            sy += v[i][1];
            sh += v[i][2];
        }
        var n = v.size();
        return [sx / n, sy / n, sh / n];
    }

    //! Plošný rozptyl: odmocnina ze součtu čtverců odchylek v obou osách
    //! dělená (n-1). Pro jeden vzorek vrací 0.
    hidden function _sigma(v, p) {
        if (v.size() < 2) { return 0.0; }
        var suma = 0.0;
        for (var i = 0; i < v.size(); i++) {
            var ex = v[i][0] - p[0];
            var ey = v[i][1] - p[1];
            suma += ex * ex + ey * ey;
        }
        return Math.sqrt(suma / (v.size() - 1));
    }
}
