using Toybox.Application;
using Toybox.Graphics;
using Toybox.Math;
using Toybox.WatchUi;

//! Vektorový podklad pod body — čáry cest, vody a překážek.
//!
//! Do vestavěné mapy hodinek se aplikace Connect IQ nedostane, takže se
//! kreslí vlastní čáry. Dlaždice je schválně hloupá a plochá:
//!
//!   {"a":[lat,lon], "r":dosah_m,
//!    "l":[[třída, minx,miny,maxx,maxy, x,y, x,y, …], …]}
//!
//! Obálka každé čáry i pořadí čar podle důležitosti se počítají PŘEDEM,
//! ve skriptu, který dlaždici vyrábí. Hodinky na to nemají: pouhé
//! seskupení pěti set čar podle třídy tady shodilo aplikaci hláškou
//! „Watchdog Tripped — Code Executed Too Long“.
//!
//! Souřadnice jsou CELÁ ČÍSLA v DECIMETRECH od kotvy (x k východu,
//! y k severu). Na displeji, kde 450 m odpovídá zhruba stovce pixelů, je
//! decimetr hluboko pod rozlišením, a celá čísla se v paměti hodinek drží
//! mnohem líp než desetinná. Žádné vnořené objekty, žádné klíče u vrcholů.
//!
//! Zatím je dlaždice přibalená jako zdroj (okolí Prahy, na zkoušení
//! v simulátoru). Ostrý provoz ji dostane z Cloudflare Workeru po
//! dlaždicích 500 × 500 m a uloží do Application.Storage, aby podklad
//! fungoval i bez signálu.
//!
//! Zdroj dat: OpenStreetMap, licence ODbL.
module Podklad {

    // třídy čar — musí sedět se skriptem, který dlaždici vyrábí
    const SILNICE  = 1;
    const CESTA    = 2;
    const PESINA   = 3;
    const VODA     = 4;
    const BUDOVA   = 5;
    const PREKAZKA = 6;

    //! Kolik úseků se smí vykreslit na jeden snímek.
    //!
    //! ⚠ Tohle není šetrnost, ale nutnost: celá dlaždice má přes tisíc
    //! vrcholů a hodinky za to shodí aplikaci hláškou „Watchdog Tripped —
    //! Code Executed Too Long“. Kresba proto jde po důležitosti (překážky
    //! a silnice napřed, pěšiny a budovy naposled) a když dojde rozpočet,
    //! zbytek se prostě nenakreslí. Při přiblížení se stejně skoro všechno
    //! ořeže výřezem, takže strop dolehne jen na největší oddálení.
    const ROZPOCET = 260;

    var _dlazdice = null;
    var _zkusenoNacist = false;

    //! Načte se až při prvním použití — kdo podklad nechce, nezaplatí za
    //! něj ani bajt paměti.
    function dlazdice() {
        if (!_zkusenoNacist) {
            _zkusenoNacist = true;
            try {
                _dlazdice = Application.loadResource(Rez.JsonData.Podklad);
            } catch (e) {
                _dlazdice = null;
            }
        }
        return _dlazdice;
    }

    //! Uvolní podklad z paměti (přepnutí vypnuto v nabídce).
    function zapomen() {
        _dlazdice = null;
        _zkusenoNacist = false;
    }

    //! Vykreslí podklad kolem zadané polohy.
    //!   cx, cy   střed displeje
    //!   polomer  poloměr kresby v pixelech
    //!   mkl      pixelů na metr
    //!   otoc     o kolik je mapa pootočená proti severu [rad]
    function kresli(dc, lat, lon, cx, cy, polomer, mkl, otoc) {
        var d = dlazdice();
        if (d == null) { return; }

        var kotva = d["a"];
        var cary = d["l"];
        if (kotva == null || cary == null) { return; }

        // Posun mezi kotvou dlaždice a mou polohou. Počítá se jednou pro
        // celou dlaždici, ne pro každý vrchol — proto je to levné.
        var p = Geo.naMetry(kotva[0], kotva[1], lat, lon);
        var mojeXdm = p[0] * 10.0;
        var mojeYdm = p[1] * 10.0;

        // Výřez v decimetrech: co se sem nevejde, ani se nepočítá.
        var dosahDm = (polomer / mkl) * 10.0 + 50.0;
        var minX = mojeXdm - dosahDm;
        var maxX = mojeXdm + dosahDm;
        var minY = mojeYdm - dosahDm;
        var maxY = mojeYdm + dosahDm;

        var sinO = Math.sin(otoc);
        var cosO = Math.cos(otoc);
        var mklDm = mkl / 10.0;              // z decimetrů rovnou na pixely
        var polomer2 = polomer * polomer;
        var zbyva = ROZPOCET;
        var poslTrida = -1;

        // Čáry jsou v dlaždici už seřazené podle důležitosti a nesou svou
        // obálku — obojí spočítal skript, který dlaždici vyrábí. Kdyby se
        // to mělo dělat tady, hodinky to neustojí (zkoušeno: watchdog).
        for (var k = 0; k < cary.size() && zbyva > 0; k++) {
            var c = cary[k];
            if (c.size() < 9) { continue; }      // třída + obálka + dva vrcholy

            if (c[3] < minX || c[1] > maxX || c[4] < minY || c[2] > maxY) { continue; }

            if (c[0] != poslTrida) {
                _styl(dc, c[0]);
                poslTrida = c[0];
            }

            var predX = null;
            var predY = null;
            var predUvnitr = false;

            for (var j = 5; j < c.size() - 1 && zbyva > 0; j += 2) {
                // decimetry od kotvy → pixely ode mě → otočení mapy
                var px = (c[j] - mojeXdm) * mklDm;
                var py = (c[j + 1] - mojeYdm) * mklDm;
                var x = cx + (px * cosO - py * sinO);
                var y = cy - (px * sinO + py * cosO);

                var dx = x - cx;
                var dy = y - cy;
                var uvnitr = (dx * dx + dy * dy) <= polomer2;

                // Kreslí se i úsek, kterému leží uvnitř jen jeden konec —
                // jinak by čáry mizely kus před okrajem. Co přeteče, ořeže
                // si displej sám.
                if (predX != null && (uvnitr || predUvnitr)) {
                    dc.drawLine(predX, predY, x, y);
                    zbyva -= 1;
                }
                predX = x;
                predY = y;
                predUvnitr = uvnitr;
            }
        }
        dc.setPenWidth(1);
    }

    //! Rozlišuje se tloušťkou a barvou. Na MIP displeji je na slunci barva
    //! skoro k ničemu, takže hlavní nositel významu je tloušťka; barva jen
    //! pomáhá v místnosti a na obrázcích.
    function _styl(dc, trida) {
        if (trida == SILNICE) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(3);
        } else if (trida == CESTA) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
        } else if (trida == PESINA) {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(1);
        } else if (trida == VODA) {
            dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
        } else if (trida == BUDOVA) {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(1);
        } else if (trida == PREKAZKA) {
            // Sráz, zeď, plot — to je to, kvůli čemu podklad hlavně je:
            // aby bylo vidět, že napřímo to nepůjde. Proto červeně.
            dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
        } else {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(1);
        }
    }
}
