using Toybox.Communications;
using Toybox.PersistedContent;
using Toybox.Application;
using Toybox.Application.Storage;
using Toybox.Lang;
using Toybox.WatchUi;

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

    function initialize() {
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
            Body.nastavSerii({ "p" => "", "n" => d["from"], "z" => 0 });
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

        _hlas("odesílám " + poslat.size() + "…");
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
        _hlas("stahuji okolí…");
        Communications.makeWebRequest(
            server() + "/watch/points",
            { "lat" => s.lat, "lon" => s.lon, "n" => 20 },
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :headers => _hlavicky(),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:_naStazeni));
    }

    function _naStazeni(kod as Lang.Number, data as Lang.Dictionary or Lang.String or PersistedContent.Iterator or Null) as Void {
        var d = (data instanceof Lang.Dictionary) ? data as Lang.Dictionary : null;
        bezi = false;
        if (kod != 200 || d == null || d["points"] == null) {
            _hlas(_chyba("stažení", kod));
            return;
        }
        var nove = Body.nahradZMobilu(d["points"]);
        _hlas("hotovo: " + nove + " bodů z mobilu");
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
