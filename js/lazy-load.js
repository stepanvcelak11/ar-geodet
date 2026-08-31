// ===== AR Geodet — POZDĚJŠÍ NAČTENÍ NÁSTROJŮ (ODPOJITELNÁ vrstva) ==============
// Appka má přes 110 samostatných <script defer>. Prohlížeč MUSÍ všechny stáhnout,
// naparsovat a spustit JEŠTĚ PŘED prvním vykreslením — na starším telefonu to jsou
// vteřiny čekání na obrazovku, kde uživatel akorát chce vidět mapu. Přitom většina
// těch souborů jsou nástroje, které se otevírají až z dlaždice.
//
// Tahle vrstva je z cesty uklidí: v index.html mají takové skripty
//     <script type="ag/lazy" data-src="js/neco.js"></script>
// (neznámý `type` = prohlížeč soubor ani nestáhne, ani nespustí) a tenhle modul je
// doloaduje TEPRVE až je appka na obrazovce.
//
// PROČ ZŮSTÁVAJÍ V index.html a nejsou v nějakém seznamu tady: pořadí i komentáře
// „co modul dělá / jak ho odpojit" zůstávají na jednom místě a nemůže se rozejít
// seznam s realitou. Pořadí spouštění se bere přímo z dokumentu.
//
// KLÍČOVÉ DETAILY
//   • script.async = false u dynamicky vloženého skriptu zaručuje, že se skripty
//     spustí V POŘADÍ VLOŽENÍ (ne v pořadí, jak se stáhnou). Bez toho by moduly,
//     které staví na globálech z dřívějších souborů, tekly náhodně.
//   • Načítá se po dávkách v nečinnosti (requestIdleCallback), ať 1,3 MB parsování
//     nesekne první interakci.
//   • FLUSH: jakmile uživatel ťukne na dok / Nástroje / menu, zbytek se dotáhne
//     OKAMŽITĚ. Takže i když někdo otevře Nástroje hned po startu, dlaždice tam
//     jsou — nečeká se na nečinnost.
//   • Dlaždice registrované pozdě nejsou problém: field-tools.js má syncTiles()
//     při každé registraci a tools-plus/tools-simple/usadit-ar mají vlastní tik
//     (1,2–1,6 s) i MutationObserver, takže si mřížku samy přerovnají.
//   • Offline: soubory zůstávají v ASSETS_TO_CACHE (gen_sw_assets.py čte i
//     data-src), takže je service worker cachuje jako dřív a doložení funguje
//     bez signálu.
//
// CO SEM NEPATŘÍ (a proč): moduly, na které někdo sahá hned při startu nebo
// v renderovací smyčce (slunce.js kvůli přihlašovací obrazovce, ar-visual-track.js
// a localization-helmert.js kvůli grafika.js, gps-semafor.js kvůli stavovému pruhu,
// dmr-terrain.js kvůli AR), moduly, které vkládají tlačítko do mapy nebo
// zaškrtávátko do cizího modálu (geo-overlay, cadastre-vector, track-log), a cokoli,
// co obaluje cizí funkci (zakazka-sablony, tutorial-pro, vylepseni). Ty musí zůstat
// s obyčejným `defer`.
//
// Odstranění vrstvy: smaž js/lazy-load.js + jeho řádek v index.html a všem
// `type="ag/lazy" data-src="…"` vrať `defer src="…"`. Appka pak jede jako dřív.
// ==============================================================================
(function () {
    'use strict';
    if (window.AGLazy) return;

    var BATCH = 4;          // kolik skriptů vložit v jedné dávce
    var IDLE_MS = 90;       // rozestup dávek, když prohlížeč requestIdleCallback nemá
    var START_MS = 700;     // odklad po načtení stránky, ať se appka stihne vykreslit

    var queue = [];          // [{src, el}] v pořadí z dokumentu
    var loaded = {};         // src -> true (i při chybě, ať se nezacyklíme)
    var pending = {};        // src -> [callbacky]
    var outstanding = 0;     // kolik skriptů je vloženo a ještě neohlásilo konec
    var started = false, finished = false;

    function collect() {
        var tags = document.querySelectorAll('script[type="ag/lazy"][data-src]');
        for (var i = 0; i < tags.length; i++) {
            var src = tags[i].getAttribute('data-src');
            if (!src || loaded[src]) continue;
            queue.push({ src: src, el: tags[i] });
        }
    }

    function inject(item) {
        if (loaded[item.src]) return;
        // VYPINAC MODULU (js/priznaky.js): vypnuty modul se ani nestahuje.
        // Znaci se jako nacteny a projde se pres done(), aby se spustily
        // callbacky z need() — jinak by na nem volajici visel navzdy. Dvojice
        // outstanding++ / done() je zamerna: vysledek je nula, ale probehne
        // i kontrola "uz je hotovo" na konci done().
        try {
            if (window.AGFlags && window.AGFlags.off(item.src)) {
                loaded[item.src] = true;
                outstanding++;
                done(item.src);
                return;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'lazy-load:flags'); }
        loaded[item.src] = true;
        outstanding++;
        var s = document.createElement('script');
        s.src = item.src;
        // POZOR: u dynamicky vlozeneho skriptu je async ve vychozim stavu true =
        // spusti se, jak dobehne stahovani (tedy v nahodnem poradi). false vraci
        // poradi vlozeni, tj. presne to, co delalo defer.
        s.async = false;
        s.setAttribute('data-ag-lazy', '1');
        s.onload = function () { done(item.src); };
        s.onerror = function () {
            // Nepadat: appka bez jednoho nástroje pořád měří. Ale nahlásit — tichá
            // chybějící dlaždice je horší než záznam v protokolu chyb.
            try {
                if (window.agErrLog && typeof window.agErrLog.record === 'function') {
                    window.agErrLog.record('lazy-load: nepodařilo se načíst ' + item.src);
                } else if (window.console) {
                    console.warn('[lazy-load] nenačteno: ' + item.src);
                }
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'lazy-load:onerror'); }
            done(item.src);
        };
        (document.body || document.documentElement).appendChild(s);
    }

    function done(src) {
        if (src) outstanding--;
        var cbs = pending[src];
        delete pending[src];
        if (cbs) for (var i = 0; i < cbs.length; i++) { try { cbs[i](); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'lazy-load:done'); } }
        // hotovo = nic ve frontě A nic rozjetého (jinak by se mřížka pobízela dřív,
        // než poslední moduly zaregistrují dlaždice)
        if (!queue.length && outstanding <= 0 && !finished) {
            finished = true;
            // pobídka pro mřížku Nástrojů (pozdě registrované dlaždice)
            try { if (typeof window.agFtSyncTiles === 'function') window.agFtSyncTiles(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'lazy-load:done'); }
            try { window.dispatchEvent(new CustomEvent('ag:lazy-done')); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'lazy-load:done'); }
        }
    }

    function idle(fn) {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(fn, { timeout: 1200 });
        } else {
            setTimeout(fn, IDLE_MS);
        }
    }

    function step() {
        if (!queue.length) { done(''); return; }
        for (var i = 0; i < BATCH && queue.length; i++) inject(queue.shift());
        if (queue.length) idle(step);
    }

    // vše zbývající hned (uživatel jde do Nástrojů / doku)
    function flush() {
        started = true;
        while (queue.length) inject(queue.shift());
    }

    // načti konkrétní modul teď a zavolej callback, až je venku
    function need(src, cb) {
        var i;
        for (i = 0; i < queue.length; i++) {
            if (queue[i].src === src || queue[i].src.indexOf(src) >= 0) {
                var item = queue.splice(i, 1)[0];
                if (cb) (pending[item.src] = pending[item.src] || []).push(cb);
                inject(item);
                return true;
            }
        }
        if (cb) cb();       // už načtený (nebo tu vůbec není) → nečekat
        return false;
    }

    function start() {
        if (started) return;
        started = true;
        step();
    }

    function init() {
        collect();
        if (!queue.length) return;

        // Flush na první dotek ovládání, které nástroje potřebuje. Capture, ať to
        // stihneme dřív než inline onclick dlaždice.
        var flushOn = function (e) {
            var t = e.target;
            if (!t || !t.closest) { flush(); return; }
            // #ag-login/#ag-gate: hned po přihlášení jde appka rovnou do práce
            // (firemní režim, docházka, chat) — nečekat na nečinnost
            if (t.closest('#dock,#tools-modal,#side-menu,#menu-toggle-btn,#welcome-screen,#ag-login,#ag-gate')) flush();
        };
        document.addEventListener('click', flushOn, true);
        document.addEventListener('touchstart', flushOn, true);

        // ---- POJISTKA: dlaždice klepnutá dřív, než dorazil její modul --------------
        // Dlaždice v Nástrojích volají svou funkci PŘÍMO z inline onclick
        // (`… ; openCalcModal();`). Když modul ještě stojí ve frontě, skončí tap
        // hláškou „openCalcModal is not defined" v konzoli a navenek se NIC NESTANE.
        // Člověk ťukne podruhé, potřetí a má za to, že nástroj je rozbitý — přesně
        // takhle to bylo nahlášeno z terénu.
        //
        // Flush výš sice pustí stahování hned při doteku doku, jenže stažení a
        // spuštění skriptu trvá; na pomalém telefonu je to okno klidně vteřina a do
        // něj se pohodlně vejde „ťuknu na Nástroje a hned na nástroj".
        //
        // Tahle pojistka klepnutí ZADRŽÍ (zjistí, že funkce z onclick zatím není),
        // dotáhne zbytek fronty a klepnutí zopakuje. Uživatel vidí jen to, že se
        // nástroj otevřel o chviličku později. Jakmile je fronta prázdná, celá
        // pojistka je mimo hru (`finished`).
        var RETRY_ATTR = 'data-ag-lazy-retry';
        var KEYWORDS = { 'if': 1, 'for': 1, 'while': 1, 'switch': 1, 'catch': 1, 'return': 1, 'typeof': 1, 'function': 1, 'new': 1, 'void': 1, 'delete': 1, 'else': 1, 'do': 1 };
        // jména volaná v onclick, ale NE jako metoda (tj. bez tečky před sebou)
        var CALL_RE = /(^|[^\w.$])([A-Za-z_$][\w$]*)\s*\(/g;
        function missingFn(el) {
            var oc = el.getAttribute('onclick');
            if (!oc) return null;
            CALL_RE.lastIndex = 0;
            var m;
            while ((m = CALL_RE.exec(oc))) {
                var n = m[2];
                if (KEYWORDS[n]) continue;
                if (typeof window[n] === 'undefined') return n;
            }
            return null;
        }
        document.addEventListener('click', function (e) {
            if (finished) return;
            var t = e.target && e.target.closest ? e.target.closest('#tools-modal .tool-tile') : null;
            if (!t || t.hasAttribute(RETRY_ATTR)) return;
            if (!missingFn(t)) return;
            e.preventDefault();
            e.stopPropagation();
            flush();
            // ČEKÁ SE NA FUNKCI, NE NA HODINY. Pevný odklad („zkus to za 3 s") vypadá
            // v pohodě na rychlém spoji, ale na slabém signálu se trefí přesně doprostřed
            // stahování: klepnutí se zopakuje, funkce pořád není a uživatel dostane
            // tutéž nefunkční dlaždici, jen o tři vteřiny později. Proto se každých
            // 150 ms kouká, jestli už modul dorazil, a klepne se HNED jak je venku.
            //
            // ⚠ NA KONCI ČEKÁNÍ SE UŽ NEKLEPE. Dřív tu bylo „po WAIT_MAX_MS klepnutí
            // pustit dál, ať je chyba vidět v protokolu" — jenže to je přesně ta
            // původní vada: inline onclick spadne na `… is not defined`, okno se
            // neotevře a navenek se zase NESTANE NIC. Ověřeno v prohlížeči na
            // zdrženém js/kalkulacka.js: fronta 98 modulů se do osmi vteřin
            // nevyprázdnila, pojistka to vzdala, znovu klepla do prázdna a
            // kalkulačka se neotevřela. Když modul do té doby nedorazí, řekne se to
            // tedy člověku nahlas a chyba jde do protokolu přes AG.swallow.
            var WAIT_MAX_MS = 8000;      // po osmi vteřinách už držet klepnutí nemá smysl
            var fired = false, waited = 0;
            var again = function (vzdano) {
                if (fired) return;
                fired = true;
                clearInterval(iv);
                if (!t.isConnected) return;
                if (vzdano) {
                    if (typeof window.quickToast === 'function')
                        quickToast('Nástroj se ještě stahuje. Zkuste to prosím za chvíli.');
                    window.AG && AG.swallow && AG.swallow(
                        new Error('modul dlazdice nedorazil do ' + WAIT_MAX_MS + ' ms'), 'lazy-load:retry');
                    return;
                }
                t.setAttribute(RETRY_ATTR, '1');
                try { t.click(); } catch (er) { window.AG && AG.swallow && AG.swallow(er, 'lazy-load:retry'); }
                t.removeAttribute(RETRY_ATTR);
            };
            var iv = setInterval(function () {
                waited += 150;
                if (!missingFn(t)) again(false);
                else if (waited >= WAIT_MAX_MS) again(true);
            }, 150);
        }, true);

        // jinak: po načtení stránky v nečinnosti
        if (document.readyState === 'complete') setTimeout(start, START_MS);
        else window.addEventListener('load', function () { setTimeout(start, START_MS); });
        // pojistka, kdyby 'load' nepřišel (přerušené stahování dlaždic mapy apod.)
        setTimeout(start, 6000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGLazy = {
        flush: flush,
        need: need,
        pending: function () { return queue.map(function (q) { return q.src; }); }
    };
})();
