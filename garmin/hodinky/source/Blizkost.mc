using Toybox.Attention;
using Toybox.System;
using Toybox.Application.Storage;

//! Bzučák: hodinky zavibrují, když se přijde k uloženému bodu.
//!
//! Na dohledávání znaků v terénu — jen se chodí a nemusí se na nic koukat
//! ani nic zapínat. Kontroluje se jednou za sekundu z mapy, protože ta si
//! okolní body stejně už spočítala.
//!
//! ⚠ Funguje jen když je aplikace otevřená. Connect IQ nedovolí, aby si
//! watch app běžela na pozadí a hlídala polohu; na to je zvláštní typ
//! aplikace (background service) s vlastními omezeními a bez displeje.
module Blizkost {

    //! Pod touhle vzdáleností se bzučí. Níž to nemá smysl — GPS na
    //! hodinkách má chybu v jednotkách metrů, takže na dvou metrech by
    //! bzučák buď mlčel, nebo houkal náhodně.
    const PRAH = 5.0;

    //! Až za touhle vzdáleností se bod „uvolní“ pro další zabzučení.
    //! Bez toho by hodinky u jednoho bodu drnčely pořád dokola, jak se
    //! poloha kolem prahu chvěje.
    const ODCHOD = 12.0;

    const KLIC = "bzucak";

    var _zapnuto = null;
    var _posledni = null;        // číslo bodu, u kterého se naposled bzučelo

    function zapnuto() {
        if (_zapnuto == null) {
            var v = Storage.getValue(KLIC);
            _zapnuto = (v == null) ? true : v;      // ve výchozím stavu zapnuto
        }
        return _zapnuto;
    }

    function prepni() {
        _zapnuto = !zapnuto();
        Storage.setValue(KLIC, _zapnuto);
        return _zapnuto;
    }

    //! Dostane okolí spočítané mapou (seřazené od nejbližšího).
    //! Vrací bod, u kterého se právě zabzučelo, jinak null.
    function zkontroluj(okoli) {
        if (okoli == null || okoli.size() == 0) { return null; }

        var b = okoli[0];
        var d = b["d"];

        if (d > PRAH) {
            if (_posledni != null && d > ODCHOD) { _posledni = null; }
            return null;
        }

        // jsem u bodu — ale u tohohle už se bzučelo?
        if (_posledni != null && _posledni.equals(b["c"])) { return null; }

        _posledni = b["c"];
        if (zapnuto()) { _zabzuc(); }
        return b;
    }

    //! Je nejbližší bod na dosah ruky? Mapa podle toho kolem něj kreslí
    //! kroužek, aby bylo vidět i bez vibrace, který to je.
    function uBodu(okoli) {
        return (okoli != null) && (okoli.size() > 0) && (okoli[0]["d"] <= PRAH);
    }

    function _zabzuc() {
        if (!(Attention has :vibrate)) { return; }
        var ds = System.getDeviceSettings();
        if (ds == null || !ds.vibrateOn) { return; }
        // dvě krátká — jasně odlišitelné od upozornění hodinek samotných
        Attention.vibrate([
            new Attention.VibeProfile(75, 150),
            new Attention.VibeProfile(0, 100),
            new Attention.VibeProfile(75, 150)
        ]);
    }
}
