// ===== AR Geodet — VYPÍNAČ MODULŮ NA DÁLKU (ODPOJITELNÁ vrstva) ===============
// Když se v aplikaci něco rozbije, vlastník to zhasne z Konzole vlastníka a všem
// to zhasne samo — bez vydávání nové verze a bez čekání, až si ji lidi stáhnou.
//
// JAK TO CHODÍ: server drží seznam vypnutých ID (meta `flags`, zapisuje se jen
//   klíčem OWNER_KEY přes PUT /owner/flags) a posílá ho každému klientovi v
//   odpovědi /config — tedy kanálem, který appka obnovuje tak jako tak. Tenhle
//   modul si seznam ULOŽÍ DO TELEFONU (`agPriznaky_v1`) a používá ho HNED PŘI
//   STARTU, ještě než se stihne kdokoli přihlásit. To je podstatné: kdyby se
//   čekalo na odpověď serveru, rozbitý modul by se stihl načíst a spadnout dřív,
//   než by přišel pokyn ho nepouštět. A v terénu bez signálu by nedorazil vůbec.
//
// CO SE DÁ VYPNOUT:
//   • nástroj podle id z registru (např. `brutal-gps`) — nezaregistruje se,
//     takže nemá dlaždici a nejde ho otevřít;
//   • celý lazy modul podle souboru (např. `js/trenazer.js`) — vůbec se nestáhne.
//
// ⚠ CO VYPNOUT NEJDE: modul, který už je načtený (eager `<script defer>`).
//   Skript z prohlížeče zpátky nevyndáš. U takového se vypnutí projeví až po
//   restartu aplikace — a modul o tom poctivě řekne hláškou, místo aby dělal,
//   že se něco stalo.
//
// ⚠ MUSÍ SE NAČÍTAT PŘED js/lazy-load.js, jinak by lazy fronta odstartovala dřív,
//   než je koho se ptát. V index.html je proto hned za js/ag-guard.js.
//
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + './js/priznaky.js'
// v sw.js + dva řádky v js/lazy-load.js označené „vypínač modulů".
// ================================================================================
(function () {
    'use strict';
    if (window.AGFlags) return;

    var LS = 'agPriznaky_v1';
    var _off = [];          // seznam vypnutých ID
    var _ts = 0;            // razítko seznamu ze serveru
    var _hlaseno = {};      // co už appka oznámila (ať toast nechodí každou minutu)

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'priznaky:' + kde); } catch (x) { } }

    function nacti() {
        try {
            var g = JSON.parse(localStorage.getItem(LS) || 'null');
            if (g && Array.isArray(g.off)) { _off = g.off; _ts = g.ts || 0; }
        } catch (e) { _off = []; }
    }
    function uloz() {
        try { localStorage.setItem(LS, JSON.stringify({ off: _off, ts: _ts })); } catch (e) { swallow(e, 'uloz'); }
    }
    nacti();

    // Porovnání je schválně přísné. Volné „obsahuje" by u `js/kos.js` vyplo i
    // `js/kolecko-nastroju.js`… ne, ale u krátkých id (`ar`, `kos`) by se to stát
    // mohlo a vypnout omylem půlku aplikace je horší než nevypnout nic.
    function off(co) {
        if (!co || !_off.length) return false;
        var s = String(co);
        for (var i = 0; i < _off.length; i++) {
            var f = _off[i];
            if (!f) continue;
            if (f === s) return true;
            // zápis souborem: `js/trenazer.js` musí sednout i na `./js/trenazer.js`
            if (f.length > 3 && f.slice(-3) === '.js' && s.length >= f.length && s.slice(-f.length) === f) return true;
        }
        return false;
    }

    // Nový seznam ze serveru. Vrací true, když se něco změnilo.
    function set(list, ts) {
        var nove = [];
        (list || []).forEach(function (x) {
            var v = String(x == null ? '' : x).trim();
            if (v && nove.indexOf(v) === -1) nove.push(v);
        });
        if (nove.join('') === _off.join('')) return false;
        var pribylo = nove.filter(function (x) { return _off.indexOf(x) === -1; });
        _off = nove; _ts = ts || Date.now();
        uloz();
        // Co se vypnulo AŽ TEĎ a už to v paměti běží, se z prohlížeče vyndat nedá.
        // Říct to nahlas je poctivější než tiše nedělat nic — člověk aspoň ví, proč
        // se nástroj pořád tváří živý.
        pribylo.forEach(function (x) {
            if (_hlaseno[x]) return;
            _hlaseno[x] = 1;
            try {
                if (typeof window.quickToast === 'function')
                    quickToast('Správce aplikace vypnul „' + x + '". Projeví se po restartu aplikace.');
            } catch (e) { swallow(e, 'toast'); }
        });
        try { uklidDlazdice(); } catch (e) { swallow(e, 'set:uklid'); }
        return true;
    }

    // ---- kde se seznam vymáhá ---------------------------------------------------
    // 1) NÁSTROJE: vypnutý se vůbec nezaregistruje → nemá dlaždici, není v hledání
    //    ani v kolečku nástrojů.
    //
    // ⚠⚠ OBALIT `window.agRegisterFieldTool` AŽ ZA BĚHU JE POZDĚ, a stálo to jedno
    //    celé kolo ladění. Tenhle modul je `defer` na začátku dokumentu, takže se
    //    spustí, KDYŽ TA FUNKCE JEŠTĚ NEEXISTUJE (definuje ji js/field-tools.js
    //    o pár skriptů dál). Než se stihne první tick, mají moduly jako
    //    js/brutal-gps.js dávno zaregistrováno a dlaždice stojí na obrazovce.
    //    Proto se místo obalení hlídá SAMO PŘIŘAZENÍ: getter/setter na window,
    //    který každou přiřazenou funkci propustí přes filtr.
    //
    // ⚠ SETTER MUSÍ OBALOVAT PŘI ZÁPISU, NE GETTER PŘI ČTENÍ. js/ucty.js si
    //   funkci přečte, obalí ji vlastním záznamem kategorií a přiřadí zpátky —
    //   kdyby getter vracel pořád tentýž obal, volal by nakonec sám sebe a appka
    //   by se zacyklila. Takhle každý zapisovatel přidá jednu vrstvu a řetěz
    //   vede poctivě až k původní funkci.
    var _raw = null;
    function filtrObal(fn) {
        return function (item) {
            try { if (item && item.id && off(item.id)) return; } catch (e) { swallow(e, 'register'); }
            return fn.apply(this, arguments);
        };
    }
    var _hlidano = false;
    try {
        _raw = (typeof window.agRegisterFieldTool === 'function') ? filtrObal(window.agRegisterFieldTool) : window.agRegisterFieldTool;
        Object.defineProperty(window, 'agRegisterFieldTool', {
            configurable: true,
            get: function () { return _raw; },
            set: function (v) { _raw = (typeof v === 'function') ? filtrObal(v) : v; }
        });
        _hlidano = true;
    } catch (e) { swallow(e, 'defineProperty'); }

    // Nouzová varianta pro prohlížeč, kde by defineProperty na window neprošlo:
    // obalit dodatečně a při každé změně identity znovu (viz komentář výš).
    var _wrappedFn = null;
    function wrapRegister() {
        if (_hlidano) return;
        var cur = window.agRegisterFieldTool;
        if (typeof cur !== 'function' || cur === _wrappedFn) return;
        var obal = filtrObal(cur);
        window.agRegisterFieldTool = obal;
        _wrappedFn = obal;
    }
    wrapRegister();

    // 2) DLAŽDICE, KTERÉ UŽ VZNIKLY. Filtr chytí jen to, co jde přes registraci —
    //    jenže dlaždici umí vyrobit i modul, který registrací neprochází, a při
    //    zapnutí vypínače za běhu už jsou dávno na obrazovce. Proto se mřížka
    //    ještě protírá podle `data-tool`. Schovává se, nemaže: mřížku překresluje
    //    několik modulů a smazaný uzel by se stejně vrátil.
    function uklidDlazdice() {
        if (!_off.length) return;
        for (var i = 0; i < _off.length; i++) {
            var id = _off[i];
            if (!id || id.slice(-3) === '.js') continue;
            var sel;
            try { sel = document.querySelectorAll('[data-tool="' + id + '"],[data-k="' + id + '"]'); }
            catch (e) { continue; }                       // id s uvozovkami → přeskočit
            for (var j = 0; j < sel.length; j++) {
                if (sel[j].getAttribute('data-agoff') === '1') continue;
                sel[j].setAttribute('data-agoff', '1');
                sel[j].style.display = 'none';
            }
        }
    }

    // 3) LAZY MODULY: js/lazy-load.js se ptá sám (viz „vypínač modulů" v inject()).

    // ---- odkud se seznam bere ---------------------------------------------------
    // Serverová strana chodí s konfigurací firmy (AGUcty.getFirm().flags). Čte se
    // v ticku, ne z události: konfigurace se obnovuje na několika místech
    // (přihlášení, refreshConfig, přepnutí firmy) a nemá jedinou událost.
    function tick() {
        wrapRegister();
        uklidDlazdice();
        try {
            var f = window.AGUcty && AGUcty.getFirm ? AGUcty.getFirm() : null;
            if (!f) return;
            var g = f.flags;
            if (g && Array.isArray(g.off)) set(g.off, g.ts);
            else if (_off.length && f.cloud) set([], Date.now());   // vlastník vypínač zrušil
        } catch (e) { swallow(e, 'tick'); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
    else tick();
    (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
        try { tick(); } catch (e) { swallow(e, 'interval'); }
    }, 2000);

    window.AGFlags = {
        off: off,
        list: function () { return _off.slice(); },
        ts: function () { return _ts; },
        set: set
    };
})();
