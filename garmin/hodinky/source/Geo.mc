using Toybox.Math;

//! Geodetické výpočty na elipsoidu WGS84.
//!
//! Pro vzdálenosti do několika kilometrů stačí lokální tečná rovina, ale
//! musí se počítat se správnými poloměry křivosti — v poledníku (M) a
//! v prvním vertikálu (N). Chyba je pak pod milimetr a stojí to zlomek
//! toho, co plná Vincentyho úloha; na hodinkách se to vyplatí.
module Geo {

    const A  = 6378137.0d;             // hlavní poloosa WGS84 [m]
    const E2 = 0.00669437999014d;      // druhá mocnina první excentricity

    //! Poloměry křivosti v dané zeměpisné šířce (radiány).
    //! Vrací [M v poledníku, N v prvním vertikálu] v metrech.
    function polomery(latRad) {
        var s = Math.sin(latRad);
        var w = 1.0d - E2 * s * s;
        var n = A / Math.sqrt(w);
        var m = A * (1.0d - E2) / (w * Math.sqrt(w));
        return [m, n];
    }

    //! Rozdíl dvou zeměpisných poloh v metrech lokální roviny.
    //! Vrací [dx k východu, dy k severu].
    function naMetry(lat0, lon0, lat, lon) {
        var lm = Math.toRadians((lat0 + lat) / 2.0d);
        var p = polomery(lm);
        var dy = p[0] * Math.toRadians(lat - lat0);
        var dx = p[1] * Math.cos(lm) * Math.toRadians(lon - lon0);
        return [dx, dy];
    }

    //! Opačný pochod — posun v metrech přičtený k zeměpisné poloze.
    function zMetru(lat0, lon0, dx, dy) {
        var lm = Math.toRadians(lat0);
        var p = polomery(lm);
        var lat = lat0 + Math.toDegrees(dy / p[0]);
        var lon = lon0 + Math.toDegrees(dx / (p[1] * Math.cos(lm)));
        return [lat, lon];
    }

    function vzdalenost(lat0, lon0, lat, lon) {
        var d = naMetry(lat0, lon0, lat, lon);
        return Math.sqrt(d[0] * d[0] + d[1] * d[1]);
    }

    //! Azimut z první polohy na druhou. Radiány, 0 = sever, roste k východu.
    function azimut(lat0, lon0, lat, lon) {
        var d = naMetry(lat0, lon0, lat, lon);
        var a = Math.atan2(d[0], d[1]);
        if (a < 0) { a += 2 * Math.PI; }
        return a;
    }

    //! Úhel svedený do rozsahu -PI až +PI (kvůli otáčení šipky a mapy).
    function normUhel(a) {
        while (a > Math.PI)  { a -= 2 * Math.PI; }
        while (a < -Math.PI) { a += 2 * Math.PI; }
        return a;
    }

    //! Světová strana pro azimut v radiánech: "S", "SV", "V", …
    function svetovaStrana(azRad) {
        var s = ["S", "SV", "V", "JV", "J", "JZ", "Z", "SZ"];
        var i = ((azRad / (Math.PI / 4.0)) + 0.5).toNumber() % 8;
        if (i < 0) { i += 8; }
        return s[i];
    }

    //! Vzdálenost pro displej — pod 10 m na decimetry, pak na metry, od
    //! kilometru na kilometry. Na malém displeji nemá smysl víc číslic.
    function popisVzdalenosti(m) {
        var d = vzdalenostDil(m);
        return (d[1].equals("")) ? d[0] : (d[0] + " " + d[1]);
    }

    //! Totéž rozdělené na [číslo, jednotku].
    //!
    //! ⚠ Kvůli číselným fontům: Graphics.FONT_NUMBER_* obsahují POUZE
    //! číslice, takže se do nich jednotka nedá vykreslit — musí se napsat
    //! zvlášť běžným fontem. Viz Displej.cisloSJednotkou.
    function vzdalenostDil(m) {
        if (m == null)  { return ["—", ""]; }
        if (m < 10)     { return [m.format("%.1f"), "m"]; }
        if (m < 1000)   { return [m.format("%.0f"), "m"]; }
        return [(m / 1000.0).format("%.2f"), "km"];
    }
}
