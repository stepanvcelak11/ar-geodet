// ===== AR Geodet — SJEDNOCENÉ DVOJICE NÁSTROJŮ (ODPOJITELNÁ vrstva) ============
// Uživatel při průchodu seznamem úkonů 9. 8. 2026 našel dvě dvojice, které dělají
// TOTÉŽ, jen jinou cestou, a chtěl je sjednotit:
//   • „Kubaturu a vrstevnice" (z bodů zakázky) × „Kubaturu obejitím výkopu"
//     — stejný výstup (objem), jiný vstup: hotový model bodů × obejitá hrana.
//   • „Resekcí ze známých bodů" × „Volným stanoviskem"
//     — volné stanovisko je PRŮVODCE nad resekcí; zaměření i výpočet dělá týž
//       engine (js/ar-resection.js), průvodce navíc jen provede založením bodů.
//
// JAK SE TO SJEDNOTILO (a proč zrovna takhle): v seznamu úkonů zůstane JEDEN
// vstup a druhá cesta je odkazem UVNITŘ okna. Slučovat je do jednoho nástroje by
// znamenalo přepsat čtyři funkční moduly a riskovat, že se cestou něco ztratí;
// takhle se nic nemaže, obě cesty zůstávají a odkaz je vidět přesně ve chvíli,
// kdy člověk zjistí, že otevřel tu druhou.
//
// 5. 9. 2026 PŘIBYLA TŘETÍ RODINA: KALKULAČKA × TERÉNNÍ NÁSTROJ.
// js/kalkulacka.js nabízí Rajón, Ortogonální metodu, Protínání vpřed, Volné
// stanovisko, Tachymetrii a Nivelační zápisník — tedy šest úloh, které appka umí
// i „naostro" vlastním modulem, a ani u jedné to neřekla. Kdo v terénu ťukne
// Kalkulačku a zadá rajón z papíru, nezjistí, že týž rajón umí zaměřit křížem
// kamery (a ušetřit si chybu kompasu); kdo zná terénní nástroj, netuší, že má po
// ruce i variantu na počítání, když se nedá mířit.
//
// ⚠⚠ PROČ TO NEJDE JAKO OBYČEJNÁ DVOJICE: kalkulačka je JEDNO okno (#calc-modal)
// s dvanácti podstránkami v #calc-body, kdežto place() klíčuje podle id okna a drží
// jeden proužek na okno. Šest položek se stejným `modal` by se tedy poprala o jedno
// místo a odkaz by navíc nesouvisel s metodou, kterou má člověk zrovna otevřenou.
// Proto přibyla dvě VOLITELNÁ pole:
//   probe = selektor políčka, které existuje JEN na té podstránce (kalkulačka
//           žádný příznak metody v DOM nenechává a tahle vrstva její soubor needituje),
//   host  = kam proužek vložit (#calc-body). Podstránka se při přepnutí metody
//           přepisuje celá, takže proužek zmizí sám a tick() vloží ten správný.
//
// Zbylé dvě „duplicity", na které se uživatel ptal, duplicity NEJSOU a schválně
// se tu neřeší:
//   • Rajón × Protínání vpřed — rajón je JEDNO stanovisko + změřená délka,
//     protínání DVĚ stanoviska a jen úhly (na cíl se nedá dojít).
//   • Srovnat podle bodu × Kalibrace na ref. bod — první opravuje SEVER,
//     druhá POLOHU. Řeší se přejmenováním, ne slučováním.
//
// Neinvazivní: nesahá do těch modulů, jen si hlídá, kdy se jejich okno objeví,
// a vloží mu nahoru proužek s odkazem. Když modul chybí, odkaz se neukáže.
//
// Odstranění: smaž js/nastroje-parky.js + řádek <script> v index.html.
// ================================================================================
(function () {
    'use strict';
    if (window.AGParky) return;

    var STYLE_ID = 'ag-parky-style';

    // modal = id okna, fn = co otevřít, t = text odkazu, need = co musí existovat
    // probe = (volitelně) selektor, podle kterého se pozná otevřená PODSTRÁNKA okna
    // host  = (volitelně) kam proužek vložit; bez něj se vloží pod nadpis karty
    var PAIRS = [
        {
            modal: 'dmt-overlay', need: 'agOpenObchuzka', fn: 'agOpenObchuzka',
            t: 'Nemáš body s výškou? <b>Obejdi hranu výkopu</b> a objem se spočítá na místě →'
        },
        {
            modal: 'ag-ob-modal', need: 'openDmtVolume', fn: 'openDmtVolume',
            t: 'Máš už body s výškou v zakázce? <b>Spočítej kubaturu a vrstevnice z nich</b> →'
        },
        {
            modal: 'agfs-modal', need: 'agOpenResection', fn: 'agOpenResection',
            t: 'Známé body už kolem sebe máš? <b>Jdi rovnou zaměřovat (resekce)</b> →'
        },
        {
            modal: 'agrx-modal', need: 'agOpenFreeStation', fn: 'agOpenFreeStation',
            t: 'Nemáš kolem sebe známé body? <b>Průvodce volným stanoviskem</b> je nejdřív založí →'
        },
        // ---- KALKULAČKA → terénní dvojník (podstránky #calc-body) -------------------
        // Věta vždycky začíná OTÁZKOU NA SITUACI, ne názvem nástroje: v kalkulačce
        // sedí člověk proto, že čísla už má. Odkaz má smysl jen tehdy, když je ještě
        // nemá — a to pozná podle otázky rychleji než podle jména modulu.
        {
            modal: 'calc-modal', probe: '#rj-cteni-or', host: '#calc-body',
            need: 'agOpenRajon', fn: 'agOpenRajon',
            t: 'Stojíš na tom stanovisku a na bod vidíš? <b>Zaměř rajón křížem kamery</b> — odpadne čtení i chyba kompasu →'
        },
        {
            modal: 'calc-modal', probe: '#or-s', host: '#calc-body',
            need: 'agOpenStakeLine', fn: 'agOpenStakeLine',
            t: 'Jsi u té měřické přímky? <b>Vytyčení přímky</b> ukazuje staničení a kolmici živě podle GPS →'
        },
        {
            modal: 'calc-modal', probe: '#pu-ua', host: '#calc-body',
            need: 'agOpenIntersection', fn: 'agOpenIntersection',
            t: 'Můžeš z obou stanovisek na cíl zamířit? <b>Protínání vpřed v AR</b> si úhly změří samo →'
        },
        {
            modal: 'calc-modal', probe: '#vs-rows', host: '#calc-body',
            need: 'agOpenFreeStation', fn: 'agOpenFreeStation',
            t: 'Stojíš na tom neznámém stanovisku? <b>Průvodce volným stanoviskem</b> tě provede zaměřením i výpočtem →'
        },
        {
            modal: 'calc-modal', probe: '#tc-rows', host: '#calc-body',
            need: 'openTachymetrie', fn: 'openTachymetrie',
            t: 'Měříš tu dávku právě teď? <b>Náčrt / tachymetrie</b> zapisuje body rovnou do zakázky a kreslí náčrt →'
        },
        {
            modal: 'calc-modal', probe: '#nv-rows', host: '#calc-body',
            need: 'agOpenZapisnik', fn: 'agOpenZapisnik',
            t: 'Niveluješ celý pořad? <b>Zápisník</b> v Nástrojích drží sestavy u zakázky a spočítá uzávěr →'
        }
    ];

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style'); st.id = STYLE_ID;
        st.textContent = [
            '.ag-parky{display:block;width:100%;text-align:left;margin:0 0 12px;padding:10px 12px;cursor:pointer;',
            '  border:1px dashed var(--accent-line,rgba(47,158,116,0.45));border-radius:10px;',
            '  background:var(--accent-soft,rgba(47,158,116,0.12));color:var(--text-color,#e6eaf0);',
            '  font:400 calc(12.5px * var(--ag-font-scale, 1))/1.45 var(--font-ui,system-ui),sans-serif;}',
            '.ag-parky b{color:var(--accent,#2f9e74);}',
            '.ag-parky:active{filter:brightness(1.15);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function place(p) {
        var m = document.getElementById(p.modal);
        if (!m) return;
        if (typeof window[p.need] !== 'function') return;     // druhá cesta tu není
        // Okno s podstránkami: proužek patří jen k té metodě, která je otevřená.
        if (p.probe && !m.querySelector(p.probe)) return;
        if (m.querySelector('.ag-parky')) return;             // už vloženo
        // Proužek patří dovnitř karty, ne na overlay — na overlay by ležel přes
        // ztmavené pozadí mimo okno. S `host` jde rovnou do podstránky (ta se při
        // přepnutí metody přepíše celá, takže se proužek zahodí s ní).
        var host = p.host ? m.querySelector(p.host) : null;
        var card = host || m.querySelector('.modal-content') || m.firstElementChild || m;
        var h = host ? null : card.querySelector('h3');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ag-parky';
        b.innerHTML = p.t;
        b.addEventListener('click', function () {
            close(m);
            try { window[p.fn](); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'nastroje-parky:place'); }
        });
        if (h && h.nextSibling) card.insertBefore(b, h.nextSibling);
        else card.insertBefore(b, card.firstChild);
    }

    // ⚠ Okna se v appce otevírají DVĚMA způsoby: většina přes style.display='flex'
    // (.modal-overlay), ale Kubatura přes overlay.classList.add('open'). Test na
    // style.display proto u Kubatury nikdy neplatil a odkaz se tam nevložil —
    // viditelnost se musí číst z getComputedStyle.
    function visible(el) {
        try { return getComputedStyle(el).display !== 'none'; } catch (e) { return false; }
    }
    function close(el) {
        el.classList.remove('open');
        try { if (getComputedStyle(el).display !== 'none') el.style.display = 'none'; } catch (e) { el.style.display = 'none'; }
    }

    // Okna si moduly staví až při prvním otevření, takže se nedá navěsit napevno.
    // Kontrola 2×/s je levná (čtyři getElementById) a běží jen dokud appka kouká
    // na obrazovku — stejný přístup jako ostatní vrstvy nad cizími okny.
    function tick() {
        if (document.visibilityState !== 'visible') return;
        // Cache na okno: PAIRS má deset položek, ale šest z nich míří do TÉHOŽ okna —
        // bez toho by tick 2×/s dělal deset getElementById místo pěti.
        var okna = {};
        for (var i = 0; i < PAIRS.length; i++) {
            var id = PAIRS[i].modal;
            if (!(id in okna)) okna[id] = document.getElementById(id);
            var m = okna[id];
            if (m && visible(m)) place(PAIRS[i]);
        }
    }

    function init() {
        injectStyles();
        if (!window.__agParkyTimer) {
            window.__agParkyTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
                try { tick(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'nastroje-parky:init'); }
            }, 500);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 800); });
    else setTimeout(init, 800);

    window.AGParky = { pairs: PAIRS };
})();
