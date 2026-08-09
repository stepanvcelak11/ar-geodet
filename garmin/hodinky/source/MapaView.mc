using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.System;
using Toybox.Timer;
using Toybox.Math;
using Toybox.Application.Storage;

//! Mapka okolí — vlastní plátno, žádný podklad.
//!
//! Do vestavěné mapy hodinek se aplikace Connect IQ nedostane (a Forerunner
//! 255 stejně žádnou nemá, jen breadcrumb), takže se kreslí od nuly: já
//! uprostřed, okolní body jako tečky. Vektorový podklad — čáry cest, vody
//! a srázů z OpenStreetMap — je připravený jako další krok; přibude sem
//! jako další vrstva pod body, nic z tohohle se kvůli tomu nepředělá.
class MapaView extends WatchUi.View {

    //! Kolik bodů se vůbec vytáhne z paměti. Víc jich na displej velikosti
    //! pětikoruny stejně nepatří a hodinky by se s tím zbytečně dřely.
    const MAX_BODU = 20;

    //! Poloměr zobrazeného okolí v metrech. Není to `const`, protože
    //! Monkey C bere jako konstanty jen prosté hodnoty, ne pole.
    var ZOOMY;

    var zoom = 2;
    var podleSmeru = true;      // false = sever nahoře
    var podklad = true;         // vektorové čáry cest pod body
    var cil = null;             // bod, ke kterému se právě naviguje
    var autoZoom = true;        // při navigaci si mapa dosah řídí sama

    hidden var _casovac = null;
    hidden var _okoli = [];
    hidden var _okoliLat = 0.0;
    hidden var _okoliLon = 0.0;
    hidden var _okoliPocet = -1;
    hidden var _nevyneseno = 0;

    function initialize() {
        View.initialize();
        ZOOMY = [25, 50, 100, 200, 400, 800];
        // Zvolené přiblížení přežije vypnutí — v terénu člověk pracuje
        // pořád na stejném a nechce ho po každém spuštění nastavovat.
        var z = Storage.getValue("zoom");
        if (z != null && z >= 0 && z < ZOOMY.size()) { zoom = z; }
    }

    function onShow() {
        _casovac = new Timer.Timer();
        _casovac.start(method(:tik), 1000, true);
    }

    function onHide() {
        if (_casovac != null) {
            _casovac.stop();
            _casovac = null;
        }
    }

    //! `as Void` tu být musí — Timer.start chce metodu, o které je jisté,
    //! že nic nevrací, a bez anotace ji překladač bere jako Any.
    function tik() as Void {
        // Dokud není použitelný fix, ptáme se na polohu sami — viz
        // Sledovac.osvez. Test je schválně na maFix(), ne na lat==null:
        // se zastaralou polohou (QUALITY_LAST_KNOWN) se sice mapa nakreslí,
        // ale bod založit nejde, a bez tohohle dotazu by kvalita zůstala
        // navždy „stará poloha“ a nešlo by měřit vůbec.
        var s = $.sledovac;
        if (s != null && !s.maFix()) { s.osvez(); }
        // jakmile je poloha, jednou za spuštění se samo sesynchronizuje
        if ($.cloud != null) { $.cloud.zkusSamo(); }
        WatchUi.requestUpdate();
    }

    function zoomBliz() {
        autoZoom = false;
        if (zoom > 0) { zoom -= 1; Storage.setValue("zoom", zoom); }
        WatchUi.requestUpdate();
    }

    function zoomDal() {
        autoZoom = false;
        if (zoom < ZOOMY.size() - 1) { zoom += 1; Storage.setValue("zoom", zoom); }
        WatchUi.requestUpdate();
    }

    function otoceni() {
        podleSmeru = !podleSmeru;
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var s = $.sledovac;
        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var cx = sirka / 2;
        var cy = vyska / 2;

        if (s == null || s.lat == null) {
            // Bez polohy nejde nakreslit vůbec nic, tak ať je aspoň vidět,
            // že aplikace žije a kudy vede cesta dál — jinak to působí,
            // jako by tlačítka nefungovala.
            _hlaska(dc, cx, cy, vyska, Displej.cas(),
                    (s == null) ? "hledám GPS" : s.popisKvality(),
                    "dlouze ↑ = nabídka");
            return;
        }

        _obnovOkoli(s);
        Blizkost.zkontroluj(_okoli);

        var dosah = ZOOMY[zoom];
        // Když se někam naviguje, mapa se sama oddálí tak, aby byl cíl vidět.
        // Holá šipka řekne směr, ale ne co je mezi tebou a bodem — a právě
        // kvůli tomu ta mapa je.
        if (cil != null && autoZoom) {
            var dc2 = Geo.vzdalenost(s.lat, s.lon, cil["la"], cil["lo"]);
            for (var z = 0; z < ZOOMY.size(); z++) {
                if (ZOOMY[z] >= dc2 * 1.25) { dosah = ZOOMY[z]; break; }
                if (z == ZOOMY.size() - 1) { dosah = ZOOMY[z]; }
            }
        }

        // Popisky se kreslí první — teprve ony řeknou, kolik místa zbylo
        // na mapu. Dřív tu byl pevný odstup 26 px, jenže ten na kulatém
        // skle nesedí: u kraje je řádek užší a text se ořezával.
        var polomer = _popisky(dc, sirka, vyska, dosah, s);
        var mkl = polomer.toFloat() / dosah;      // pixelů na metr

        // O kolik je plátno pootočené proti severu. Při „podle směru“ se
        // mapa točí tak, aby to, co je přede mnou, bylo nahoře.
        var otoc = 0.0;
        if (podleSmeru) {
            var sm = s.smer();
            if (sm != null) { otoc = sm; }
        }

        _kruznice(dc, cx, cy, polomer);
        if (podklad) {
            if (Podklad.mamPro(s.lat, s.lon)) {
                Podklad.kresli(dc, s.lat, s.lon, cx, cy, polomer, mkl, otoc);
            } else {
                // Prázdná mapa bez vysvětlení je k vzteku — tohle rovnou
                // říká, že se pro tohle místo nic nepřipravilo.
                dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, cy + polomer / 2, Graphics.FONT_XTINY, "mapa není",
                            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }
        }
        _sever(dc, cx, cy, polomer, otoc);
        _kCili(dc, cx, cy, polomer, mkl, otoc, s);
        _body(dc, cx, cy, polomer, mkl, otoc, s);
        _ja(dc, cx, cy, otoc, s);
    }

    //! Čárkovaná spojnice ke zvolenému bodu — „tudy se jde“.
    //! Schválně bez jakéhokoli hlášení o překážkách: co je červené, vidí
    //! člověk sám a rozhodne se líp než aplikace.
    hidden function _kCili(dc, cx, cy, polomer, mkl, otoc, s) {
        if (cil == null) { return; }

        var d = Geo.vzdalenost(s.lat, s.lon, cil["la"], cil["lo"]);
        var a = Geo.azimut(s.lat, s.lon, cil["la"], cil["lo"]) - otoc;
        var r = d * mkl;
        if (r > polomer) { r = polomer; }

        var x = cx + r * Math.sin(a);
        var y = cy - r * Math.cos(a);

        var kroku = (r / 9).toNumber();
        if (kroku < 2) { return; }

        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);
        for (var i = 0; i < kroku; i += 2) {
            var t1 = i.toFloat() / kroku;
            var t2 = (i + 1).toFloat() / kroku;
            dc.drawLine(cx + (x - cx) * t1, cy + (y - cy) * t1,
                        cx + (x - cx) * t2, cy + (y - cy) * t2);
        }
        dc.setPenWidth(1);
    }

    //! Přepočítá okolí, jen když se poloha znatelně posunula nebo bodů
    //! přibylo/ubylo.
    //!
    //! ⚠ Dřív se to počítalo při KAŽDÉM překreslení, tedy jednou za vteřinu
    //! celý den — a to znamená projít až dvě stě bodů a spočítat u každého
    //! vzdálenost i azimut. Když člověk stojí, není co počítat; tři metry
    //! jsou hluboko pod přesností GPS, takže se tím nic neztratí.
    hidden function _obnovOkoli(s) {
        var pocet = Body.pocet();
        var skok = Geo.vzdalenost(_okoliLat, _okoliLon, s.lat, s.lon);
        if (_okoliPocet == pocet && skok < 3.0) { return; }
        _okoliLat = s.lat;
        _okoliLon = s.lon;
        _okoliPocet = pocet;
        _okoli = Body.nejblizsi(s.lat, s.lon, MAX_BODU);
        // počítá se tady, ne při kreslení — jinak by se úložiště
        // pročítalo znovu každou vteřinu a úspora výš by byla k ničemu
        _nevyneseno = Body.nevyneseno();
    }

    // ---- jednotlivé vrstvy -------------------------------------------

    //! Kroužek dosahu a poloviční dosah slabě — funguje jako měřítko,
    //! aniž by se muselo cokoli číst.
    hidden function _kruznice(dc, cx, cy, polomer) {
        dc.setPenWidth(1);
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawCircle(cx, cy, polomer);
        dc.drawCircle(cx, cy, polomer / 2);
    }

    //! Písmeno S na okraji tam, kde je sever.
    hidden function _sever(dc, cx, cy, polomer, otoc) {
        var a = -otoc;
        var x = cx + polomer * Math.sin(a);
        var y = cy - polomer * Math.cos(a);
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, Graphics.FONT_XTINY, "S",
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    hidden function _body(dc, cx, cy, polomer, mkl, otoc, s) {
        for (var i = 0; i < _okoli.size(); i++) {
            var b = _okoli[i];
            var a = b["az"] - otoc;
            var r = b["d"] * mkl;

            var venku = false;
            if (r > polomer) {
                // Bod je mimo dosah — přisadí se na okraj jako prázdné
                // kolečko, ať je aspoň vidět, kterým směrem leží.
                r = polomer;
                venku = true;
            }

            var x = cx + r * Math.sin(a);
            var y = cy - r * Math.cos(a);

            var jeCil = (cil != null) && (cil["c"].equals(b["c"]));
            var barva = jeCil ? Graphics.COLOR_ORANGE : Graphics.COLOR_BLUE;

            dc.setColor(barva, Graphics.COLOR_TRANSPARENT);
            if (venku) {
                dc.setPenWidth(2);
                dc.drawCircle(x, y, 4);
            } else {
                dc.fillCircle(x, y, jeCil ? 6 : 4);
            }

            // Bod na dosah ruky dostane kroužek — vibrace řekne „jsi u něj“,
            // kroužek řekne „u kterého“.
            if (i == 0 && !venku && b["d"] <= Blizkost.PRAH) {
                dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
                dc.setPenWidth(2);
                dc.drawCircle(x, y, 11);
            }

            // Čísla jen u nejbližších pěti a jen u bodů uvnitř dosahu —
            // jinak se popisky přes sebe slepí a mapa je k nepřečtení.
            if (i < 5 && !venku) {
                dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(x, y - 16, Graphics.FONT_XTINY, b["c"],
                            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }
        }
    }

    //! Já uprostřed — kolečko plus klín ukazující, kam koukám.
    hidden function _ja(dc, cx, cy, otoc, s) {
        var sm = s.smer();
        if (sm != null) {
            var a = sm - otoc;
            var body = [
                [cx + 13 * Math.sin(a),                cy - 13 * Math.cos(a)],
                [cx +  6 * Math.sin(a + 2.5),          cy -  6 * Math.cos(a + 2.5)],
                [cx +  6 * Math.sin(a - 2.5),          cy -  6 * Math.cos(a - 2.5)]
            ];
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.fillPolygon(body);
        }
        dc.setColor(s.barvaKvality(), Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, cy, 4);
    }

    //! Horní a dolní řádek. Umístění řeší Displej — u kulatého skla je
    //! nutné text posunout dovnitř, jinak ho okraj ořízne. Vrací, kolik
    //! místa zbylo na mapu (poloměr v pixelech).
    hidden function _popisky(dc, sirka, vyska, dosah, s) {
        var cy = vyska / 2;

        // Nahoře čas — hodinky se nosí kvůli němu a aplikace ho jinak
        // zakrývá celou dobu, co je otevřená. Když je s GPS něco v
        // nepořádku, připojí se to za něj.
        // Aktivní korekce MUSÍ být vidět: dokud běží, ukazuje mapa i navigace
        // posunutou polohu, a to se nesmí dít potichu. Vejde se za čas, jen
        // její velikost — podrobnosti jsou v nabídce.
        var nahore = Displej.cas();
        if (!s.maFix()) { nahore += " · " + s.popisKvality(); }
        else if (Korekce.aktivni()) { nahore += " · kor " + Korekce.velikost().format("%.1f"); }
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        var spodekHorniho = Displej.nahore(dc, nahore, Graphics.FONT_XTINY);

        // Dole to, co je zrovna k rozhodování nejdůležitější: cíl, jinak
        // průběžná přesnost, jinak aspoň dosah mapy.
        var dole = dosah.toString() + " m";
        var klid = s.popisKlidu();
        if (klid != null) { dole = klid; }
        // Kolik měření ještě nedorazilo do mobilu — to je jediné číslo,
        // které chce člověk vidět, než hodinky odloží.
        if (_nevyneseno > 0) { dole = _nevyneseno.toString() + " nevyneseno · " + dole; }
        if (cil != null) {
            // Vzdálenost se počítá znovu z právě platné polohy — ta uložená
            // u cíle je z okamžiku výběru a za chvíli chůze už neplatí.
            var d = Geo.vzdalenost(s.lat, s.lon, cil["la"], cil["lo"]);
            dole = cil["c"] + " · " + Geo.popisVzdalenosti(d);
            dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        } else {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        }
        var vrsekDolniho = Displej.dole(dc, dole, Graphics.FONT_XTINY);

        var shora = cy - spodekHorniho - 3;
        var zdola = vrsekDolniho - cy - 3;
        return (shora < zdola) ? shora : zdola;
    }

    hidden function _hlaska(dc, cx, cy, vyska, hlavni, vedlejsi, napoveda) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy - 12, Graphics.FONT_MEDIUM, hlavni,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy + 18, Graphics.FONT_XTINY, vedlejsi,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        Displej.dole(dc, napoveda, Graphics.FONT_XTINY);
    }
}


//! Tlačítka na mapě:
//!   START      → seznam okolí
//!   nahoru     → přiblížit          dolů → oddálit
//!   dlouze UP  → nabídka (nový bod, otočení mapy, ukázková data, mazání)
//!   BACK       → konec aplikace (nebo zrušení navigace, když někam vede)
class MapaDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    hidden function _mapa() {
        // Mapa je vždycky nejspodnější obrazovka; sáhne se na ni přes
        // instanci, kterou drží aplikace.
        return $.mapaView;
    }

    //! Seznam se otevře i bez polohy — tam se aspoň dozvíte proč. Dřív se
    //! tady tiše nic nedělo a vypadalo to, že tlačítko nefunguje.
    function onSelect() {
        Seznam.otevri();
        return true;
    }

    function onPreviousPage() {
        _mapa().zoomBliz();
        return true;
    }

    function onNextPage() {
        _mapa().zoomDal();
        return true;
    }

    function onMenu() {
        Nabidka.otevri(_mapa());
        return true;
    }

    function onBack() {
        var m = _mapa();
        if (m.cil != null) {
            m.cil = null;
            WatchUi.requestUpdate();
            return true;    // první BACK jen zruší navigaci
        }
        return false;       // druhý ukončí aplikaci
    }
}
