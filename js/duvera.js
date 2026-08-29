// ===== AR Geodet — JAK MOC VĚŘIT ČÍSLU: jeden zdroj pravdy (ODPOJITELNÁ vrstva) ===
// PROBLÉM, KTERÝ TENHLE SOUBOR ŘEŠÍ: appka o TÉMŽE BODU umí tvrdit dvě různé
// věci, protože si každý modul zavedl vlastní stupnici. Dnešní stav v repu:
//     js/dvoji-mereni.js   0,50 / 1,50 / 3,00 m   (na rozdílu dvou určení)
//     js/kvalita-bodu.js   1,50 / 3,00 m         (na témž rozdílu — kopie)
//     js/kvalita-bodu.js   0,50 / 2,00 m         (na hlášené přesnosti — TŘETÍ stupnice)
// Takže bod s ±1,8 m je v protokolu kvality „špatný", zatímco kontrolní měření
// s Δ 1,8 m je „znatelný rozdíl, ale ber průměr". Uživatel v terénu se pak
// rozhoduje podle toho, které okno má zrovna otevřené.
//
// ŘEŠENÍ: jedna stupnice a jedno rozhodnutí, ODKUD se číslo vzalo. Moduly se
// ptají tady a jen vykreslují, co dostanou.
//
// ⚠ NA ČEM TO STOJÍ A PROČ PRÁVĚ NA TOM: appka má o přesnosti bodu až čtyři
// údaje a NEJSOU ROVNOCENNÉ. Seřazeno od nejpoctivějšího:
//   1. prov.trueAcc — přesnost odvozená z DRUHÉHO URČENÍ téhož bodu s odstupem
//      (js/dvoji-mereni.js). Jediné číslo, které vzniklo měřením a zahrnuje
//      i systematickou chybu (odraz od fasády se ve dvou různých časech projeví
//      různě). Tohle je pravda.
//   2. prov.recheck.d — samotný rozdíl obou určení, když z něj trueAcc není.
//   3. σ z epoch (prov.sigma / prov.n) — rozptyl mnoha odečtů z JEDNOHO stání.
//      Popisuje, jak klidné bylo měření, NE jak blízko pravdě leží. Telefon
//      zaparkovaný u zdi hlásí krásné σ a je metr a půl vedle.
//   4. prov.acc / p.acc — co hlásí sám telefon. Nejslabší: je to odhad výrobce
//      čipu, ne měření.
// Kdyby se tyhle čtyři míchaly do jednoho čísla, appka by lhala. Proto se vždy
// vrací i `zdroj` a `zdrojText` — uživatel má vidět ROZDÍL mezi „±0,4 m změřeno"
// a „±0,4 m tvrdí telefon".
//
// STUPNICE. Meze jsou na PŘESNOSTI (ne na rozdílu dvou určení, ten se na
// přesnost nejdřív převede — dva nezávislé odečty se stejnou chybou dávají
// σ ≈ Δ/√2, což appka už počítá v sigmaFromDelta()).
//
// ⚠ ODKUD SE ČÍSLA VZALA A PROČ NEJSOU KULATÁ: sjednocení tří stupnic do jedné
// nutně znamená, že aspoň jedna se posune. Kdyby se vzaly kulaté meze
// 0,50/1,50/3,00 m rovnou na PŘESNOST, hodnocení kontrolních měření by se
// ROZVOLNILO: bod s rozdílem 4 m (σ ≈ 2,83 m) by ze „velký rozdíl, neber
// průměr" spadl na pouhé „slabé". To je zhoršení, o které nikdo nežádal.
// Proto se meze berou tak, aby ODPOVÍDALY dnešním mezím na rozdílu dvou
// určení (0,50 / 1,50 / 3,00 m v js/dvoji-mereni.js) po převodu σ = Δ/√2:
//     do 0,35 m   dobré         (= rozdíl do 0,50 m)  na telefon výborný výsledek
//     do 1,05 m   použitelné    (= rozdíl do 1,50 m)  běžný mobilní výsledek
//     do 2,10 m   slabé         (= rozdíl do 3,00 m)  něco měření rušilo
//     nad         nepoužitelné                        to není šum, to je chyba
// Hodnocení kontrolních měření tím zůstává PŘESNĚ takové, jaké bylo. Posune se
// jen hodnocení podle hlášené přesnosti (dřív 0,50/2,00 m v kvalita-bodu.js),
// a to směrem k PŘÍSNĚJŠÍMU — což je správně, protože číslo z čipu telefonu je
// ze všech čtyř zdrojů ten nejméně spolehlivý.
//
// Meze se dají přenastavit (AGDuvera.meze), ale JEN na jednom místě, takže se
// nemůže stát, že se dvě okna rozejdou.
//
// CO TENHLE SOUBOR NEDĚLÁ: neměří, nepočítá GPS, nesahá na body. Jen třídí,
// co už appka o bodu ví, a půjčuje k tomu jednotný vzhled.
//
// ODSTRANĚNÍ VRSTVY: smaž js/duvera.js a jeho řádek v index.html. Moduly, které
// se ho ptají, mají volání pojištěné (`window.AGDuvera ? ... : ...`) a vrátí se
// ke svým vlastním mezím.
// ==============================================================================
(function () {
    'use strict';
    if (window.AGDuvera) return;

    // Meze v METRECH, na přesnosti. Odvozené z mezí na rozdílu dvou určení
    // (0,50 / 1,50 / 3,00 m) přes σ = Δ/√2 — viz rozbor v hlavičce. NEZAOKROUHLOVAT
    // na kulatá čísla: tím by se hodnocení kontrolních měření rozvolnilo.
    var MEZE = { dobre: 0.50 / Math.SQRT2, pouzitelne: 1.50 / Math.SQRT2, slabe: 3.00 / Math.SQRT2 };

    // Rozdíl dvou nezávislých určení téhož bodu → přesnost jednoho z nich.
    // Když obě určení nesou stejnou (nezávislou) chybu σ, jejich rozdíl má
    // rozptyl 2σ², takže σ = Δ/√2. Je to odhad, ne důkaz — ale poctivější než
    // brát Δ rovnou za přesnost (to by bod trestalo dvakrát).
    var SQRT2 = Math.sqrt(2);
    function zRozdilu(d) { return d / SQRT2; }

    function cislo(v) { return (v != null && isFinite(v)) ? v : null; }

    var STUPNE = {
        dobre: { c: 'ok', t: 'Dobré', poradi: 3 },
        pouzitelne: { c: 'ok', t: 'Použitelné', poradi: 2 },
        slabe: { c: 'warn', t: 'Slabé', poradi: 1 },
        spatne: { c: 'bad', t: 'Nepoužitelné', poradi: 0 },
        nezname: { c: 'none', t: 'Neurčeno', poradi: -1 }
    };

    function stupenProPresnost(a) {
        if (a == null) return 'nezname';
        if (a <= MEZE.dobre) return 'dobre';
        if (a <= MEZE.pouzitelne) return 'pouzitelne';
        if (a <= MEZE.slabe) return 'slabe';
        return 'spatne';
    }

    // ---- odkud se přesnost vzala (pořadí důvěryhodnosti, viz hlavička) --------
    // Vrací i `mereno: true/false` — to je ta informace, kterou dnes appka
    // nikde neukazuje, a přitom je nejdůležitější ze všech.
    function zdrojPresnosti(p) {
        var prov = (p && p.prov) || {};
        var t = cislo(prov.trueAcc);
        if (t != null) {
            return { a: t, zdroj: 'kontrola', mereno: true,
                zdrojText: 'změřeno druhým určením',
                proc: 'Bod byl změřen podruhé s odstupem a tohle číslo vyšlo z rozdílu obou určení. Je to jediná přesnost, která vznikla měřením — zahrnuje i chybu, kterou telefon o sobě neví.' };
        }
        var rc = prov.recheck;
        if (rc && cislo(rc.d) != null) {
            return { a: zRozdilu(rc.d), zdroj: 'rozdil', mereno: true,
                zdrojText: 'odvozeno z rozdílu dvou určení',
                proc: 'Dvě určení téhož bodu se liší o ' + fmt(rc.d) + ' m. Z toho vychází přesnost jednoho určení.' };
        }
        var s = cislo(prov.sigma);
        if (s != null) {
            return { a: s, zdroj: 'sigma', mereno: false,
                zdrojText: 'rozptyl z jednoho stání (σ)',
                proc: 'Tohle je jen rozptyl mnoha odečtů z JEDNOHO stání. Říká, jak klidné bylo měření — ne jak blízko pravdě bod leží. Telefon u zdi hlásí krásné σ a je přitom metr vedle. Změř bod podruhé s odstupem.' };
        }
        var a = cislo(prov.acc);
        if (a == null) a = cislo(p && p.acc);
        if (a != null) {
            return { a: a, zdroj: 'telefon', mereno: false,
                zdrojText: 'jen co hlásí telefon',
                proc: 'Tohle číslo appka nezměřila — hlásí ho GPS čip telefonu jako svůj vlastní odhad. Bývá optimistické, hlavně mezi domy a pod stromy.' };
        }
        return { a: null, zdroj: 'nic', mereno: false,
            zdrojText: 'neznámá přesnost',
            proc: 'U tohohle bodu se nedochovalo, jak přesně vznikl.' };
    }

    function fmt(v) {
        if (v == null || !isFinite(v)) return '—';
        return (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');
    }

    var AGDuvera = {};

    AGDuvera.meze = function (nove) {
        if (nove && typeof nove === 'object') {
            if (cislo(nove.dobre) != null) MEZE.dobre = nove.dobre;
            if (cislo(nove.pouzitelne) != null) MEZE.pouzitelne = nove.pouzitelne;
            if (cislo(nove.slabe) != null) MEZE.slabe = nove.slabe;
        }
        return { dobre: MEZE.dobre, pouzitelne: MEZE.pouzitelne, slabe: MEZE.slabe };
    };

    // HLAVNÍ DOTAZ: co si o tomhle bodu myslet.
    // Vrací { a, stupen, trida, nadpis, zdroj, zdrojText, mereno, proc, text }
    //   trida  — 'ok' | 'warn' | 'bad' | 'none', shodné s data-q v existujících modulech
    //   text   — hotový krátký popisek („±0,42 m — změřeno druhým určením")
    AGDuvera.bod = function (p) {
        var z = zdrojPresnosti(p);
        var stupen = stupenProPresnost(z.a);
        var s = STUPNE[stupen];
        // Bod, jehož přesnost NIKDO nezměřil, nesmí dostat zelenou jen proto, že
        // telefon hlásí malé číslo. Nejvýš „použitelné" — zelená patří měření.
        if (!z.mereno && (stupen === 'dobre')) { stupen = 'pouzitelne'; s = STUPNE[stupen]; }
        return {
            a: z.a,
            stupen: stupen,
            trida: s.c,
            poradi: s.poradi,
            nadpis: s.t,
            zdroj: z.zdroj,
            zdrojText: z.zdrojText,
            mereno: z.mereno,
            proc: z.proc,
            text: (z.a == null) ? 'přesnost neznámá' : ('±' + fmt(z.a) + ' m — ' + z.zdrojText)
        };
    };

    // Holé číslo přesnosti → tatáž stupnice. Pro místa, kde se hodnotí jeden
    // konkrétní údaj (sloupec „± chyba" v protokolu), ne celý bod.
    AGDuvera.presnost = function (a) {
        var stupen = stupenProPresnost(cislo(a));
        var s = STUPNE[stupen];
        return { a: cislo(a), stupen: stupen, trida: s.c, poradi: s.poradi, nadpis: s.t };
    };

    // Rozdíl dvou určení → totéž hodnocení. Používá js/dvoji-mereni.js, aby
    // kontrolní měření a protokol kvality mluvily jednou řečí.
    AGDuvera.rozdil = function (d) {
        var a = (cislo(d) == null) ? null : zRozdilu(d);
        var stupen = stupenProPresnost(a);
        var s = STUPNE[stupen];
        return { a: a, d: cislo(d), stupen: stupen, trida: s.c, poradi: s.poradi, nadpis: s.t };
    };

    // ---- jednotný vzhled -----------------------------------------------------
    // Jeden odznak pro celou appku. `data-q` je záměrně tentýž atribut, jaký už
    // používají js/dvoji-mereni.js a js/kvalita-bodu.js, takže se dá nasadit
    // do existujícího vzhledu bez přebarvování.
    AGDuvera.odznak = function (p, volby) {
        var v = (p && p.stupen) ? p : AGDuvera.bod(p);
        var o = volby || {};
        var t = (v.a == null) ? '?' : '±' + fmt(v.a);
        // Nezměřenou přesnost pozná uživatel na první pohled podle vlnovky.
        var znak = v.mereno ? '' : '~';
        return '<span class="ag-duv" data-q="' + v.trida + '"' +
            (o.bezTitulku ? '' : ' title="' + esc(v.nadpis + ' — ' + v.zdrojText) + '"') +
            '>' + znak + t + (o.jednotka === false ? '' : ' m') + '</span>';
    };

    // Delší vysvětlení do karty bodu / protokolu.
    AGDuvera.vysvetli = function (p) {
        var v = AGDuvera.bod(p);
        return '<div class="ag-duv-box" data-q="' + v.trida + '">' +
            '<div class="ag-duv-hl"><b>' + esc(v.nadpis) + '</b> ' + AGDuvera.odznak(v, { bezTitulku: true }) + '</div>' +
            '<div class="ag-duv-proc">' + v.proc + '</div>' +
            (v.mereno ? '' : '<div class="ag-duv-rada">Chceš tomuhle bodu věřit? Změř ho podruhé s odstupem — v Nástrojích „Kontrolní měření".</div>') +
            '</div>';
    };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    AGDuvera.fmt = fmt;

    // Styl si vrstva připojí sama — do <link> v index.html nepatří, počítá se
    // do rozpočtu startu (scripts/check_start_budget.py).
    // ⚠ css/duvera.css MUSÍ být v EXTRA_ASSETS v scripts/gen_sw_assets.py,
    // jinak zůstane appka offline bez těchhle stylů.
    try { if (window.AG && AG.cssFile) AG.cssFile('ag-duvera-css', 'css/duvera.css'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'duvera:css'); }

    window.AGDuvera = AGDuvera;
})();
