using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Attention;
using Toybox.System;
using Toybox.Timer;

//! Vynesení bodů z hodinek do mobilu QR kódem.
//!
//! K čemu to je: tam, kde není signál, se body přes server přenést nedají.
//! Kód se ukáže na displeji, appka ho přečte svým skenerem a body si přidá.
//! Formát je `AG1` — tentýž, který už umí js/sdileni.js, takže na straně
//! mobilu není potřeba měnit vůbec nic.
//!
//! ⚠ VÍC NEŽ SEDM BODŮ NA KÓD NEJDE. Kruhový displej 260 px má vepsaný
//! čtverec 184 px a QR potřebuje ještě klidovou zónu čtyř modulů z každé
//! strany, takže `(modulů + 8) × px_na_modul ≤ 184`. Při třech pixelech na
//! modul (což je hranice čitelnosti z matného MIP displeje — ověřeno
//! v terénu) vychází verze 9, tedy 232 bajtů. Víc bodů se do jednoho kódu
//! vejde jen za cenu, že to telefon nepřečte. Proto se to dělí do dávek
//! a listuje se šipkami.
//!
//! ⚠ POČÍTÁ SE PO DÁVKÁCH — jedno volání by hodinky odstřelilo watchdogem.
//! Dokud se počítá, běží časovač; jakmile je hotovo, zastaví se a obrazovka
//! se překreslí jen jednou. Kreslit tisíce obdélníků každou vteřinu by byl
//! další způsob, jak si watchdog zavolat.
class QrExportView extends WatchUi.View {

    //! Strop na jednu dávku. Sedm je ověřený strop čitelnosti, ale rozhoduje
    //! i délka v bajtech — u dlouhých čísel bodů se dávka zmenší sama.
    const MAX_BODU = 7;
    const MAX_BAJTU = 200;

    hidden var _davky = [];
    hidden var _cislaDavek = [];
    hidden var _kde = 0;
    hidden var _casovac = null;
    hidden var _pocita = false;

    function initialize() {
        View.initialize();
        _davky = _pripravDavky();
    }

    function onShow() {
        if (Attention has :backlight) {
            try { Attention.backlight(true); } catch (e) {}
        }
        _spustVypocet();
    }

    function onHide() {
        _zastav();
    }

    hidden function _zastav() {
        if (_casovac != null) {
            _casovac.stop();
            _casovac = null;
        }
        _pocita = false;
    }

    //! Rozdělí body na dávky, které se ještě vejdou do jednoho kódu.
    hidden function _pripravDavky() {
        var vse = Body.nacti();
        var ven = [];
        var text = "AG1W";
        var cisla = [];
        var kusu = 0;
        _cislaDavek = [];

        for (var i = 0; i < vse.size(); i++) {
            var b = vse[i];
            // Ven jdou body naměřené TADY. Ty z mobilu tam už jsou.
            if (b["src"] != 0) { continue; }
            if (b["la"] == null || b["lo"] == null) { continue; }

            var radek = "\n" + b["c"] + "\t" + b["la"].format("%.6f") + "\t" + b["lo"].format("%.6f");
            if (b["h"] != null) { radek += "\t" + b["h"].format("%.2f"); }

            if (kusu >= MAX_BODU || (text.length() + radek.length()) > MAX_BAJTU) {
                if (kusu > 0) { ven.add(text); _cislaDavek.add(cisla); }
                text = "AG1W";
                cisla = [];
                kusu = 0;
            }
            text += radek;
            cisla.add(b["c"]);
            kusu += 1;
        }
        if (kusu > 0) { ven.add(text); _cislaDavek.add(cisla); }
        return ven;
    }

    hidden function _spustVypocet() {
        _zastav();
        if (_davky.size() == 0) { return; }
        if (!Qr.zacni(_davky[_kde])) { return; }
        _pocita = true;
        _casovac = new Timer.Timer();
        // Kroků je při verzi 9 kolem sedmdesáti, tak ať to netrvá věčnost.
        _casovac.start(method(:tik), 30, true);
    }

    function tik() as Void {
        if (!_pocita) { return; }
        if (Qr.krok()) {
            _zastav();
            WatchUi.requestUpdate();      // hotovo → jedno jediné překreslení
        }
    }

    //! Označí právě zobrazenou dávku za vynesenou a posune se na další.
    function oznacVynesenou() {
        if (_kde < _cislaDavek.size()) { Body.oznacVyneseno(_cislaDavek[_kde]); }
        if (_davky.size() > 1) { dalsi(1); } else { WatchUi.requestUpdate(); }
    }

    function dalsi(o) {
        if (_davky.size() < 2) { return; }
        _kde = (_kde + o) % _davky.size();
        if (_kde < 0) { _kde += _davky.size(); }
        _spustVypocet();
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        var sirka = dc.getWidth();
        var vyska = dc.getHeight();
        var cx = sirka / 2;

        // Bílé pozadí po celé ploše — klidová zóna kolem kódu musí být
        // světlá a kolem kulatého okraje se stejně nic jiného nevejde.
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_WHITE);
        dc.clear();

        if (_davky.size() == 0) {
            dc.drawText(cx, vyska / 2, Graphics.FONT_SMALL, "žádné vlastní body",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }
        if (_pocita || !Qr.hotovo) {
            dc.drawText(cx, vyska / 2, Graphics.FONT_SMALL, "počítám kód…",
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        _kresliKod(dc, sirka, vyska);

        // ⚠ Dřív to bylo šedě na `vyska - 9`, tedy u samotného kraje kulatého
        // skla, kde je tětiva nejužší — text se ořízl a nedal se přečíst.
        // Teď černě a přes Displej, který ho posune tam, kde se vejde.
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
        var popis = (_kde + 1).toString() + "/" + _davky.size().toString() + "  START = mám";
        Displej.dole(dc, popis, Graphics.FONT_XTINY);
    }

    //! Kreslí se po VODOROVNÝCH BĚZÍCH, ne po jednotlivých modulech: u verze 9
    //! je modulů přes dva a půl tisíce a tolik obdélníků na jeden snímek
    //! hodinky neustojí. Běhů bývá kolem šesti set.
    hidden function _kresliKod(dc, sirka, vyska) {
        var n = Qr.modulu();
        var strana = (sirka < vyska) ? sirka : vyska;
        // vepsaný čtverec do kruhu + klidová zóna 4 moduly z každé strany
        var uzitne = (strana * 70) / 100;
        var px = uzitne / (n + 8);
        if (px < 2) { px = 2; }
        var celkem = (n + 8) * px;
        var x0 = (sirka - celkem) / 2 + 4 * px;
        var y0 = (vyska - celkem) / 2 + 4 * px;

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_WHITE);
        for (var r = 0; r < n; r++) {
            var c = 0;
            while (c < n) {
                if (!Qr.tmavy(r, c)) { c += 1; continue; }
                var od = c;
                while (c < n && Qr.tmavy(r, c)) { c += 1; }
                dc.fillRectangle(x0 + od * px, y0 + r * px, (c - od) * px, px);
            }
        }
    }
}


class QrExportDelegate extends WatchUi.BehaviorDelegate {

    hidden var _view;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onNextPage()     { _view.dalsi(1);  return true; }
    function onPreviousPage() { _view.dalsi(-1); return true; }

    //! Zpátky přes export i nabídku, ze které se sem vstoupilo.
    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    //! START = „tuhle dávku mám v mobilu". Body se označí za vynesené,
    //! takže na mapě zmizí z počítadla „nevyneseno" a v seznamu jim zmizí
    //! hvězdička. Bez toho by se po dni v terénu nedalo poznat, co už je
    //! v bezpečí — a to je u QR, kde nic nepotvrzuje server, dvojnásob.
    function onSelect() {
        _view.oznacVynesenou();
        return true;
    }
}
