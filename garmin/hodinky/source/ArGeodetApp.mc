using Toybox.Application;
using Toybox.WatchUi;

//! AR Geodet — hodinky.
//!
//! Zjednodušený pomocník k mobilní aplikaci. Umí čtyři věci a nic víc:
//!   • mapku okolních bodů kolem sebe
//!   • seznam okolí seřazený od nejbližšího bodu
//!   • navigaci k vybranému bodu (šipka + vzdálenost)
//!   • založení nového bodu průměrováním polohy
//!
//! Zatím pracuje offline. Synchronizace s mobilem přes Cloudflare Worker
//! je další krok — bod má proto už teď položku "src", aby se poznalo,
//! co přišlo odkud.

//! Jediný sledovač polohy pro celou aplikaci.
var sledovac = null;

//! Mapa je nejspodnější obrazovka a ostatní se na ni potřebují dostat
//! (nastavit cíl navigace, přepnout otočení), tak je po ruce i tady.
var mapaView = null;

class ArGeodetApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state) {
        $.sledovac = new Sledovac();
        $.sledovac.spustit();
    }

    function onStop(state) {
        if ($.sledovac != null) {
            $.sledovac.zastavit();
            $.sledovac = null;
        }
    }

    function getInitialView() {
        $.mapaView = new MapaView();
        return [$.mapaView, new MapaDelegate()];
    }
}
