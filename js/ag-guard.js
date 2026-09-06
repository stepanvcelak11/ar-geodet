// ===== AR Geodet — SPOLEČNÉ JÁDRO: POLKNUTÉ CHYBY, POSLUCHAČI, STYLY ==========
// Tři drobnosti, které v appce chyběly a každá stála čas při hledání závady.
//
// 1) AG.swallow(e, 'kde')  — MÍSTO PRÁZDNÉHO catch (e) {}
//    V kódu bylo přes 1500 prázdných catchů. Jsou tam správně: appka v terénu
//    nesmí spadnout kvůli tomu, že telefon odmítl localStorage nebo že chybí
//    jeden modul. Jenže tím se ztratila i informace, ŽE se něco stalo — když
//    přijde z terénu reklamace, není se čeho chytit. AG.swallow chybu pořád
//    spolkne (nic nevyhodí, nic neukáže), ale zapíše ji do Protokolu chyb
//    (Nástroje → Protokol chyb), takže je dohledatelná.
//    Zápis je OMEZENÝ: každé místo se zapíše nejvýš 3x za sezení a pak už se
//    jen počítá. Bez toho by chyba ve smyčce 60x za sekundu zaplnila úložiště.
//
// 2) AG.on / AG.scope()  — POSLUCHAČI, KTEŘÍ SE DAJÍ ZRUŠIT NAJEDNOU
//    V appce bylo 1139 addEventListener proti 27 removeEventListener. Modál,
//    který se otevře a zavře padesátkrát za den, si tak padesátkrát přidá
//    posluchače na window/document a všechny zůstanou viset. Projeví se to
//    až po hodinách v terénu — sekáním a žraním baterie, ne chybou.
//    AG.scope() vrátí sadu; scope.off() odhlásí všechno, co si přes ni modul
//    zapsal. Jedna řádka při zavření okna místo dvaceti removeEventListener.
//
// 3) AG.style(id, css)  — INJEKCE <style> JEN JEDNOU
//    86 modulů si vyrábí vlastní `document.createElement('style')` s ručním
//    testem na duplicitu. Tohle je tentýž postup na jednom místě.
//
// MUSÍ se načítat hned za js/err-log.js (dřív než moduly, které to volají).
// Odstranění: smaž js/ag-guard.js + jeho řádek v index.html a v sw.js. Moduly
// mají u volání fallback, takže pojedou dál — jen zase potichu.
// ================================================================================
(function () {
    'use strict';
    window.AG = window.AG || {};
    if (AG.swallow) return;   // dvojí načtení — nepřepisovat

    // ================================================================
    //  1) polknuté chyby
    // ================================================================
    var MAX_PER_SITE = 3;      // kolikrát se stejné místo zapíše, než se jen počítá
    var _sites = {};           // 'kde' -> počet výskytů za sezení
    var _total = 0;
    var MAX_TOTAL = 400;       // pojistka pro případ, že se rozjede něco nečekaného

    function popis(e) {
        if (e == null) return '(bez chyby)';
        if (typeof e === 'string') return e;
        try {
            var m = e.message || e.name || String(e);
            return m.length > 200 ? m.slice(0, 200) + '…' : m;
        } catch (err) { return '(nečitelná chyba)'; }
    }

    // Vrací vždy undefined, aby se dala psát jako `catch (e) { AG.swallow(e, 'x'); }`
    // i jako `catch (e) { return AG.swallow(e, 'x'); }` bez rozdílu chování.
    AG.swallow = function (e, kde) {
        try {
            kde = kde || 'neznámé místo';
            var n = (_sites[kde] || 0) + 1;
            _sites[kde] = n;
            if (n > MAX_PER_SITE || _total >= MAX_TOTAL) return;
            _total++;
            var txt = kde + ': ' + popis(e);
            if (n === MAX_PER_SITE) txt += '  (další výskyty se už nezapisují)';
            if (window.agErrLog && typeof window.agErrLog.record === 'function') {
                window.agErrLog.record(txt);
            }
        } catch (err) { /* ani hlášení chyby nesmí shodit appku */ }
    };

    // Přehled pro Protokol chyb: co se za sezení spolklo a kolikrát.
    AG.swallowed = function () {
        var out = [];
        for (var k in _sites) if (Object.prototype.hasOwnProperty.call(_sites, k)) {
            out.push({ kde: k, n: _sites[k] });
        }
        out.sort(function (a, b) { return b.n - a.n; });
        return out;
    };

    // ================================================================
    //  2) posluchači se zrušením najednou
    // ================================================================
    function _add(cil, typ, fn, opts) {
        try { cil.addEventListener(typ, fn, opts); } catch (e) { return null; }
        var zruseno = false;
        return function () {
            if (zruseno) return;
            zruseno = true;
            try { cil.removeEventListener(typ, fn, opts); } catch (e) {}
        };
    }

    // Jednorázový posluchač — vrací funkci, která ho odhlásí.
    AG.on = function (cil, typ, fn, opts) {
        if (!cil || !typ || typeof fn !== 'function') return function () {};
        return _add(cil, typ, fn, opts) || function () {};
    };

    // ================================================================
    //  2b) AG.poPrvnimDoteku(fn) — PRÁCE, KTEROU NIKDO NEVIDÍ, AŽ ZA START
    // ================================================================
    // ⚠ PROČ: měřeno 5. 9. 2026 v prohlížeči (CPU 4×, produkční balíček):
    // opakovaný start trvá do použitelné appky ~1,8 s a z toho je přes vteřinu
    // ZABLOKOVANÉ hlavní vlákno. Půlku té vteřiny spotřebují dva moduly, které
    // při startu vykreslují obsah okna Nástroje — tedy DOM, na který se nikdo
    // nedívá, dokud to okno neotevře (js/nastroje-ukony.js 311 ms,
    // js/field-tools.js 195 ms).
    //
    // Tenhle pomocník takovou práci odsune za PRVNÍ DOTEK uživatele a i pak ji
    // pustí až v nečinnosti. Do okna Nástrojů vede vždycky aspoň jedno další
    // klepnutí, takže se stihne vykreslit dřív, než tam někdo dojde.
    //
    // ⚠ POJISTKA JE POVINNÁ. Kdo se appky ani nedotkne (nechá ji ležet, kouká na
    // mapu), musí mít po chvíli všechno na svém místě — jinak by se „odložení"
    // změnilo v „nikdy". Proto `zaloha` ms: co se nespustí dotekem, spustí se samo.
    AG.poPrvnimDoteku = function (fn, zaloha) {
        if (typeof fn !== 'function') return;
        var hotovo = false, odhlas = [];
        function spust() {
            if (hotovo) return;
            hotovo = true;
            for (var i = 0; i < odhlas.length; i++) { try { odhlas[i](); } catch (e) {} }
            odhlas.length = 0;
            var b = function () { try { fn(); } catch (e) { AG.swallow && AG.swallow(e, 'poPrvnimDoteku'); } };
            if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(b, { timeout: 200 });
            else setTimeout(b, 0);
        }
        odhlas.push(AG.on(document, 'pointerdown', spust, true));
        odhlas.push(AG.on(document, 'keydown', spust, true));
        setTimeout(spust, zaloha || 4000);
    };

    // Sada posluchačů. Typické použití v modálu:
    //     var s = AG.scope();
    //     s.on(window, 'resize', prekresli);
    //     s.on(document, 'keydown', naEsc);
    //     … při zavření:  s.off();
    AG.scope = function (jmeno) {
        var odhlasky = [];
        var zavreno = false;
        return {
            name: jmeno || '',
            on: function (cil, typ, fn, opts) {
                if (zavreno) return function () {};
                var un = AG.on(cil, typ, fn, opts);
                odhlasky.push(un);
                return un;
            },
            // časovače do stejné sady, ať se s oknem uklidí i ony
            interval: function (fn, ms) {
                if (zavreno) return null;
                var t = null;
                if (AG.uiInterval) {
                    t = AG.uiInterval(fn, ms);
                    odhlasky.push(function () { try { AG.clearUiInterval(t); } catch (e) {} });
                } else {
                    t = setInterval(fn, ms);
                    odhlasky.push(function () { try { clearInterval(t); } catch (e) {} });
                }
                return t;
            },
            count: function () { return odhlasky.length; },
            off: function () {
                zavreno = true;
                for (var i = 0; i < odhlasky.length; i++) {
                    try { odhlasky[i](); } catch (e) {}
                }
                odhlasky.length = 0;
            }
        };
    };

    // ================================================================
    //  3) injekce stylu jen jednou
    // ================================================================
    // 3b) AG.cssFile(id, href) — PRIPOJI EXTERNI STYLOPIS JEN JEDNOU.
    //     Pro nastroje nacitane az po vykresleni (type="ag/lazy"): jejich
    //     <link> nema co blokovat prvni vykresleni, tak si ho modul pripoji
    //     sam pri svem spusteni. Soubor pak MUSI byt v EXTRA_ASSETS
    //     (scripts/gen_sw_assets.py), protoze uz na nej index.html neodkazuje
    //     a bez toho by nastroj offline zustal bez stylu.
    AG.cssFile = function (id, href) {
        try {
            if (!id || document.getElementById(id)) return false;
            var l = document.createElement('link');
            l.id = id; l.rel = 'stylesheet'; l.href = href;
            document.head.appendChild(l);
            return true;
        } catch (e) { return false; }
    };

    AG.style = function (id, css) {
        try {
            if (!id || document.getElementById(id)) return false;
            var st = document.createElement('style');
            st.id = id;
            st.textContent = css;
            (document.head || document.documentElement).appendChild(st);
            return true;
        } catch (e) {
            AG.swallow(e, 'AG.style:' + id);
            return false;
        }
    };
})();
