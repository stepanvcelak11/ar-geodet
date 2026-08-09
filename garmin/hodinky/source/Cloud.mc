using Toybox.Communications;
using Toybox.PersistedContent;
using Toybox.Attention;
using Toybox.System;
using Toybox.Application;
using Toybox.Application.Storage;
using Toybox.Lang;
using Toybox.WatchUi;
using Toybox.Time;

//! Přenos bodů mezi hodinkami a mobilem.
//!
//! ⚠⚠ Hodinky NEMLUVÍ s telefonem přímo. Cesta „telefon ↔ hodinky“ přes
//! Bluetooth vyžaduje nativní doprovodnou aplikaci (Connect IQ Mobile SDK)
//! a AR Geodet je webová aplikace v prohlížeči — do té BLE linky se
//! nedostane, drží ji Garmin Connect a protokol je uzavřený.
//!
//! Jde to tedy oklikou přes internet, kterou Connect IQ nabízí:
//!
//!     hodinky ──makeWebRequest──▶ Cloudflare Worker ◀──HTTPS── mobil
//!
//! Hodinky si tunel k síti berou přes Garmin Connect na telefonu (nebo
//! přes Wi-Fi doma), takže v terénu to funguje, dokud je telefon poblíž.
//!
//! Přihlásit se hodinky nemůžou — nemají klávesnici. Proto párovací kód:
//! v mobilu se vygeneruje šest znaků, ty se opíšou v Garmin Connect do
//! nastavení aplikace a hodinky si za ně vymění dlouhodobý token.
//!
//! ⚠ Je to TŘÍDA, ne modul: `method(:jmeno)` pro odpověď na požadavek
//! potřebuje instanci a v modulu se přeloží chybou „Cannot find symbol
//! ':method' on type 'self'“. Jediná instance žije v $.cloud.
class Cloud {

    const K_TOKEN = "cl_token";
    const K_JOB   = "cl_job";
    const K_KOD   = "cl_kod";          // kód, na který už se párovalo
    const K_STAV  = "cl_stav";

    var stav = "";                     // co ukázat uživateli
    var bezi = false;

    //! Ve které fázi synchronizace jsme. Obrazovka podle toho kreslí
    //! postup — bez toho se nedá poznat, jestli se ještě stahuje, nebo
    //! je dávno hotovo a jen tam visí stará hláška.
    //!   0 nic  1 odesílám  2 body  3 mapa  4 hotovo  5 chyba
    var faze = 0;
    var zacatek = 0;                   // čas startu [s], na odpočítávání
    var pocetBodu = 0;                 // co přišlo, do souhrnu
    var mapaOk = false;

    //! Kolik vteřin synchronizace běží. Není to ukazatel postupu — ten
    //! Connect IQ u makeWebRequest nedává, odpověď přijde celá naráz —
    //! ale je z něj vidět, že se něco děje a jak dlouho.
    function sekund() {
        if (zacatek == 0) { return 0; }
        return Time.now().value() - zacatek;
    }

    //! Kód, který se právě ukazuje na displeji, a tajemství k němu.
    var parovaciKod = "";
    var _tajemstvi = null;
    var _parujeme = false;

    function initialize() {
    }

    // ---- párování z hodinek (kód se opisuje v mobilu) -----------------

    function zacniParovani() {
        _parujeme = true;
        parovaciKod = "";
        _tajemstvi = null;
        if (server().length() < 8) { _hlas("chybí adresa serveru"); return; }
        _hlas("beru kód…");
        Communications.makeWebRequest(
            server() + "/watch/hello",
            {},
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:_naKodu));
    }

    function prestanParovat() {
        _parujeme = false;
    }

    function _naKodu(kod as Lang.Number, data as Lang.Dictionary or Lang.String or PersistedContent.Iterator or Null) as Void {
        var d = (data instanceof Lang.Dictionary) ? data as Lang.Dictionary : null;
        if (kod != 200 || d == null || d["code"] == null) {
            _hlas(_chyba("kód", kod));
            return;
        }
        parovaciKod = d["code"];
        _tajemstvi = d["secret"];
        _hlas("čekám na mobil");
    }

    //! Ptá se, jestli už někdo kód v mobilu potvrdil.
    function zeptejSeNaParovani() {
        if (!_parujeme || _tajemstvi == null) { return; }
        Communications.makeWebRequest(
            server() + "/watch/hello",
            { "secret" => _tajemstvi },
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:_naCekani));
    }

    function _naCekani(kod as Lang.Number, data as Lang.Dictionary or Lang.String or PersistedContent.Iterator or Null) as Void {
        if (!_parujeme) { return; }
        var d = (data instanceof Lang.Dictionary) ? data as Lang.Dictionary : null;

        if (kod == 404) {
            // kód vypršel — rovnou si říct o nový, ať se nemusí nic mačkat
            zacniParovani();
            return;
        }
        if (kod != 200 || d == null) { return; }        // ticho, zkusí se za chvíli znovu
        if (d["waiting"] != null) { return; }
        if (d["token"] == null) { return; }

        _parujeme = false;
        Storage.setValue(K_TOKEN, d["token"]);
        Storage.setValue(K_JOB, d["job"]);
        parovaciKod = "";
        _tajemstvi = null;

        // Rezervovaný blok čísel: hodinky číslují z něj, takže i bez signálu
        // nemůžou vyrobit bod se stejným číslem jako mobil.
        if (d["from"] != null) {
            Body.nastavSerii({ "p" => "", "n" => d["from"], "z" => 0, "do" => _konecBloku(d) });
        }
        _hlas("spárováno: " + d["job"]);
        _zavibruj();
    }

    function _zavibruj() {
        if (!(Attention has :vibrate)) { return; }
        var ds = System.getDeviceSettings();
        if (ds == null || !ds.vibrateOn) { return; }
        Attention.vibrate([new Attention.VibeProfile(75, 250)]);
    }

    //! Konec rezervovaného bloku čísel z odpovědi serveru.
    //!
    //! Server posílá „from" a „to". Kdyby „to" chybělo (starší Worker),
    //! vrátí se 0 = „blok neznám" a čísluje se jako dřív, bez stropu.
    //! Vědomě se NEHÁDÁ velikost bloku: kdyby se tipla větší, než jaký
    //! server opravdu rezervoval, vznikly by přesně ty kolize, kterým
    //! má blok bránit.
    function _konecBloku(d) {
        if (d["to"] == null) { return 0; }
        return d["to"];
    }

    //! Přijme čerstvý blok čísel, ale JEN když ten dosavadní došel.
    //! Jinak by každá synchronizace posunula číslování dopředu a v číslech
    //! by zůstávaly díry po nevyužitých blocích.
    function _prevezmiBlok(d) {
        if (d["from"] == null || d["to"] == null) { return; }
        var s = Body.serie();
        if (s["do"] != null && s["do"] > 0 && s["n"] <= s["do"]) { return; }
        // Rovnost je v pořádku a je to ten OBVYKLÝ případ: došel blok 1–50,
        // hodinky stojí na 51 a server nabídne 51–100, takže se naváže beze
        // spáry. Odmítá se jedině nabídka SMĚREM ZPÁTKY, která by čísla
        // použila podruhé.
        if (d["from"] < s["n"]) { return; }
        Body.nastavSerii({ "p" => s["p"], "n" => d["from"], "z" => s["z"], "do" => d["to"] });
    }

    function token() { return Storage.getValue(K_TOKEN); }
    function zakazka() { return Storage.getValue(K_JOB); }
    function sparovano() { return token() != null; }

    function _vlastnost(klic) {
        try {
            var v = Application.Properties.getValue(klic);
            return (v == null) ? "" : v.toString();
        } catch (e) {
            return "";
        }
    }

    function server() {
        var s = _vlastnost("server");
        // koncové lomítko by udělalo z cesty „//watch/points“
        while (s.length() > 0 && s.substring(s.length() - 1, s.length()).equals("/")) {
            s = s.substring(0, s.length() - 1);
        }
        return s;
    }

    function _hlas(t) {
        stav = t;
        Storage.setValue(K_STAV, t);
        WatchUi.requestUpdate();
    }

    function _hlavicky() {
        return {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
            "Authorization" => "Bearer " + token()
        };
    }

    //! Jedno tlačítko pro všechno: v případě potřeby spáruje, pak nahraje,
    //! co je rozměřeného, a nakonec stáhne okolí. V terénu nikdo nechce
    //! řešit tři položky v nabídce.
    function synchronizuj() {
        if (bezi) { return; }
        if (server().length() < 8) { _hlas("chybí adresa serveru"); return; }

        bezi = true;
        faze = 1;
        zacatek = Time.now().value();
        pocetBodu = 0;
        mapaOk = false;
        var kod = _vlastnost("kod").toUpper();
        if (!sparovano() || !kod.equals("") && !kod.equals(_kodPosledni())) {
            _sparuj(kod);
        } else {
            _odesli();
        }
    }

    function _kodPosledni() {
        var k = Storage.getValue(K_KOD);
        return (k == null) ? "" : k;
    }

    // ---- párování ----------------------------------------------------

    function _sparuj(kod) {
        if (kod.length() != 6) {
            bezi = false;
            _hlas("zadej kód v Garmin Connect");
            return;
        }
        _hlas("páruji…");
        Communications.makeWebRequest(
            server() + "/watch/pair",
            { "code" => kod },
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:_naParovani));
    }

    function _naParovani(kod as Lang.Number, data as Lang.Dictionary or Lang.String or PersistedContent.Iterator or Null) as Void {
        // Podpis musí odpovídat PŘESNĚ tomu, co makeWebRequest očekává,
        // včetně typů odpovědi, které nikdy nepoužijeme — jinak volání
        // neprojde překladem. Na slovník se proto přetypuje až tady.
        var d = (data instanceof Lang.Dictionary) ? data as Lang.Dictionary : null;
        if (kod != 200 || d == null || d["token"] == null) {
            bezi = false;
            _hlas(kod == 404 ? "kód neplatí" : "párování selhalo (" + kod + ")");
            return;
        }
        Storage.setValue(K_TOKEN, d["token"]);
        Storage.setValue(K_JOB, d["job"]);
        Storage.setValue(K_KOD, _vlastnost("kod").toUpper());

        // Rezervovaný blok čísel: hodinky číslují z něj, takže i bez signálu
        // nemůžou vyrobit bod se stejným číslem jako mobil.
        if (d["from"] != null) {
            Body.nastavSerii({ "p" => "", "n" => d["from"], "z" => 0, "do" => _konecBloku(d) });
        }
        _hlas("spárováno: " + d["job"]);
        _odesli();
    }

    // ---- nahrání naměřeného -----------------------------------------

    function _odesli() {
        var vse = Body.nacti();
        var poslat = [];
        for (var i = 0; i < vse.size(); i++) {
            var b = vse[i];
            // src 0 = naměřeno tady, "up" 1 = už odesláno
            if (b["src"] == 0 && b["up"] != 1) {
                poslat.add({
                    "c" => b["c"], "la" => b["la"], "lo" => b["lo"],
                    "h" => b["h"], "s" => b["s"], "n" => b["n"],
                    "k" => b["k"], "t" => b["t"]
                });
            }
            if (poslat.size() >= 60) { break; }
        }

        if (poslat.size() == 0) {
            _stahni();
            return;
        }

        faze = 1;
        _hlas("odesílám " + poslat.size() + " bodů");
        Communications.makeWebRequest(
            server() + "/watch/points",
            { "points" => poslat },
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => _hlavicky(),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:_naOdeslani));
    }

    function _naOdeslani(kod as Lang.Number, data as Lang.Dictionary or Lang.String or PersistedContent.Iterator or Null) as Void {
        if (kod != 200) {
            bezi = false;
            faze = 5;
            _hlas(_chyba("odeslání", kod));
            return;
        }
        // Označí se až po potvrzení serverem. Kdyby se to označilo dopředu
        // a spojení spadlo, body by zmizely a nikdo by si toho nevšiml.
        var vse = Body.nacti();
        for (var i = 0; i < vse.size(); i++) {
            if (vse[i]["src"] == 0) { vse[i]["up"] = 1; }
        }
        Body.uloz(vse);
        _stahni();
    }

    // ---- stažení okolí ----------------------------------------------

    function _stahni() {
        var s = $.sledovac;
        if (s == null || s.lat == null) {
            bezi = false;
            _hlas("odesláno; na stažení chybí poloha");
            return;
        }
        faze = 2;
        _hlas("stahuji body");

        // O nový blok čísel se říká, jedině když ten dosavadní došel — server
        // ho totiž opravdu ukusuje a při každé synchronizaci by se spolklo
        // padesát čísel do prázdna. Viz /watch/points v cloud/worker.js.
        var params = { "lat" => s.lat, "lon" => s.lon, "n" => 20 };
        var zbyva = Body.zbyvaCisel();
        if (zbyva == null || zbyva <= 0) { params["blok"] = 1; }

        Communications.makeWebRequest(
            server() + "/watch/points",
            params,
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :headers => _hlavicky(),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:_naStazeni));
    }

    function _naStazeni(kod as Lang.Number, data as Lang.Dictionary or Lang.String or PersistedContent.Iterator or Null) as Void {
        var d = (data instanceof Lang.Dictionary) ? data as Lang.Dictionary : null;
        if (kod != 200 || d == null || d["points"] == null) {
            bezi = false;
            faze = 5;
            _hlas(_chyba("stažení", kod));
            return;
        }
        // Když server posílá i čísla, je tohle jediná chvíle, kdy si hodinky
        // můžou vyzvednout další blok — jinak by po vyčerpání toho z párování
        // číslovaly s „W“ až do dalšího spárování.
        _prevezmiBlok(d);

        var nove = Body.nahradZMobilu(d["points"]);
        pocetBodu = nove;
        faze = 3;
        _hlas("stahuji mapu");
        _stahniDlazdici();
    }

    // ---- podklad -----------------------------------------------------

    //! Stáhne dlaždici podkladu pro místo, kde stojím.
    //!
    //! Drží se jen jedna — celá zakázka by se do paměti hodinek nevešla
    //! a stejně se chodí pořád kolem jednoho místa. Když se přejde jinam,
    //! další synchronizace přinese sousední.
    function _stahniDlazdici() {
        var s = $.sledovac;
        if (s == null || s.lat == null) {
            bezi = false;
            faze = 4;
            _hlas("hotovo, na mapu chybí poloha");
            _zavibruj();
            return;
        }
        Communications.makeWebRequest(
            server() + "/watch/tile",
            { "lat" => s.lat, "lon" => s.lon },
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :headers => _hlavicky(),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:_naDlazdici));
    }

    function _naDlazdici(kod as Lang.Number, data as Lang.Dictionary or Lang.String or PersistedContent.Iterator or Null) as Void {
        bezi = false;
        var d = (data instanceof Lang.Dictionary) ? data as Lang.Dictionary : null;

        if (kod == 404) {
            // Pro tohle místo nikdo mapu nepřipravil — není to chyba,
            // jen se to musí říct, ať se nehledá závada jinde.
            faze = 4;
            _hlas("mapa pro tohle místo není");
            _zavibruj();
            return;
        }
        if (kod != 200 || d == null || d["t"] == null) {
            faze = 4;
            _hlas("mapa se nestáhla (" + kod + ")");
            _zavibruj();
            return;
        }
        mapaOk = Podklad.ulozStazenou(d["t"]);
        if (!mapaOk) {
            faze = 4;
            _hlas("mapa se nevešla do paměti");
            _zavibruj();
            return;
        }
        faze = 4;
        _hlas("hotovo");
        _zavibruj();
    }

    function _chyba(co, kod) {
        if (kod == 401) { return "spárování vypršelo"; }
        if (kod == -104 || kod == -300 || kod == -2) { return "telefon není po ruce"; }
        return co + " selhalo (" + kod + ")";
    }

    function zrusParovani() {
        Storage.deleteValue(K_TOKEN);
        Storage.deleteValue(K_JOB);
        Storage.deleteValue(K_KOD);
        _hlas("spárování zrušeno");
    }
}
