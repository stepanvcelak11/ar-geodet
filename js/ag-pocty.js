// ===== AR Geodet — POČÍTÁNÍ VEDLE (Web Worker) (ODPOJITELNÁ vrstva) ==========
// PROBLÉM, KTERÝ TENHLE SOUBOR ŘEŠÍ: appka nemá ANI JEDEN Web Worker, takže
// každý delší výpočet běží na tomtéž vlákně, které kreslí obrazovku. Když
// uživatel v terénu spustí kubaturu, appka na několik vteřin ZTUHNE — nereaguje
// dotyk, nepřekreslí se mapa, AR zamrzne. Vypadá to jako pád.
//
// Nejhorší místo je triangulace v js/dmt-volume.js: Bowyer–Watson prochází pro
// KAŽDÝ bod VŠECHNY dosud vzniklé trojúhelníky, tedy O(n²). U dvou set bodů to
// nikdo nepozná, u tří tisíc (mračno z dronu, hustý polygon) to jsou vteřiny.
// Za ní hned vrstevnice: až 200 hladin × všechny trojúhelníky.
//
// ŘEŠENÍ: výpočet se přestěhuje do Web Workeru, hlavní vlákno zůstane plynulé.
//
// PROČ SE ALGORITMUS NEPÍŠE DVAKRÁT (a to je na tomhle souboru to podstatné):
// Obvyklý způsob je nakopírovat matematiku do zvláštního souboru pro worker.
// V tomhle repu se přesně tím už jednou vyrobila tichá regrese — dvě kopie
// téhož se rozešly a nikdo si toho nevšiml, protože obě parsovaly. Proto tady
// worker ŽÁDNOU vlastní matematiku nemá. Volající mu své funkce PŘEDÁ:
//
//     AGPocty.uloha('dmt', [orient, inCircumcircle, triangulate], function (d) {
//         return triangulate(d.points);
//     });
//     AGPocty.spust('dmt', { points: pole }).then(function (tris) { ... });
//
// Funkce se do workeru dostanou přes Function.prototype.toString() — je to
// tentýž kód, jaký běží na hlavním vlákně, jen se spustí jinde. Jediný zdroj
// pravdy zůstává v modulu, kterému matematika patří.
//
// ⚠ CO SE TAKHLE PŘEDAT NESMÍ: funkce, která sahá ven ze sebe — na proměnnou
// z modulu, na `window`, `document`, `localStorage` nebo na jinou funkci, která
// není v seznamu. Worker žádné DOM nemá a uzávěr se přes toString() nepřenáší,
// takže by spadl na „x is not defined". Předávej JEN čistou matematiku:
// vstup argumenty, výstup návratová hodnota.
//
// KDYŽ WORKER NEJDE (starý prohlížeč, zakázané blob: přes CSP, selhání při
// startu), `spust()` NESPADNE — spočítá TOTÉŽ na hlavním vlákně a jen o tom
// tiše řekne do protokolu chyb. Appka tedy nikdy nepřijde o funkci, jen
// o plynulost. Proto se taky do modulů dá zapojit bez podmínek.
//
// PROČ BLOB A NE SAMOSTATNÝ .js SOUBOR: worker z vlastního souboru by musel do
// ASSETS_TO_CACHE a offline by se na něj zapomnělo (v tomhle repu se to už
// stalo u stylopisů). Blob se sestaví z kódu, který v appce stejně je.
//
// ODSTRANĚNÍ VRSTVY: smaž js/ag-pocty.js a jeho řádek v index.html. Moduly,
// které ho používají, mají volání pojištěné (`window.AGPocty ? ... : ...`),
// takže se jen vrátí k počítání na hlavním vlákně.
// ==============================================================================
(function () {
    'use strict';
    if (window.AGPocty) return;

    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'ag-pocty'); } catch (e2) { /* i hlášení chyby smí selhat */ } }

    var ulohy = {};       // jmeno -> { pomocne: [fn], telo: fn }
    var worker = null;    // jeden sdílený worker pro všechny úlohy
    var workerMrtvy = false;
    var seq = 0;
    var cekajici = {};    // id -> {res, rej, jmeno}

    // ---- sestavení workeru ---------------------------------------------------
    // Zdroj se skládá až v okamžiku, kdy je první úloha opravdu potřeba — dokud
    // nikdo nepočítá, neplatí se za to nic.
    function zdroj() {
        var casti = ['"use strict";\nvar __U = {};\n'];
        for (var jm in ulohy) {
            if (!Object.prototype.hasOwnProperty.call(ulohy, jm)) continue;
            var u = ulohy[jm];
            var pom = '';
            for (var i = 0; i < u.pomocne.length; i++) {
                var f = u.pomocne[i];
                var jmeno = f.name;
                if (!jmeno) continue;   // anonymní pomocná funkce by se nedala zavolat
                // `var jmeno = <kod>;` funguje i pro deklaraci i pro výraz.
                pom += 'var ' + jmeno + ' = ' + f.toString() + ';\n';
            }
            casti.push('__U[' + JSON.stringify(jm) + '] = (function () {\n' + pom +
                'return (' + u.telo.toString() + ');\n})();\n');
        }
        casti.push([
            'self.onmessage = function (ev) {',
            '    var d = ev.data || {};',
            '    var f = __U[d.jmeno];',
            '    if (!f) { self.postMessage({ id: d.id, chyba: "neznama uloha: " + d.jmeno }); return; }',
            '    try { self.postMessage({ id: d.id, vysledek: f(d.data) }); }',
            '    catch (e) { self.postMessage({ id: d.id, chyba: (e && e.message) || String(e) }); }',
            '};'
        ].join('\n'));
        return casti.join('\n');
    }

    function ziskejWorker() {
        if (worker || workerMrtvy) return worker;
        try {
            if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !window.URL || !URL.createObjectURL) { workerMrtvy = true; return null; }
            var url = URL.createObjectURL(new Blob([zdroj()], { type: 'text/javascript' }));
            worker = new Worker(url);
            // Adresu blobu lze uvolnit hned po vytvoření workeru — ten už si kód drží.
            try { URL.revokeObjectURL(url); } catch (e) { swallow(e, 'ag-pocty:revoke'); }
            worker.onmessage = function (ev) {
                var d = ev.data || {}, c = cekajici[d.id];
                if (!c) return;
                delete cekajici[d.id];
                if (d.chyba) c.rej(new Error(d.chyba)); else c.res(d.vysledek);
            };
            worker.onerror = function (ev) {
                // Worker umřel: rozpracované úlohy dopočítat na hlavním vlákně,
                // ať uživatel nepřijde o výsledek kvůli technické chybě.
                swallow(new Error('worker: ' + ((ev && ev.message) || 'chyba')), 'ag-pocty:onerror');
                var zbytek = cekajici; cekajici = {};
                try { worker.terminate(); } catch (e) { swallow(e, 'ag-pocty:terminate'); }
                worker = null; workerMrtvy = true;
                for (var id in zbytek) {
                    if (!Object.prototype.hasOwnProperty.call(zbytek, id)) continue;
                    (function (c) { setTimeout(function () { doma(c.jmeno, c.data).then(c.res, c.rej); }, 0); })(zbytek[id]);
                }
            };
        } catch (e) {
            swallow(e, 'ag-pocty:start');
            worker = null; workerMrtvy = true;
        }
        return worker;
    }

    // Spuštění TÉHOŽ kódu na hlavním vlákně — záloha, když worker není.
    function doma(jmeno, data) {
        return new Promise(function (res, rej) {
            var u = ulohy[jmeno];
            if (!u) return rej(new Error('neznama uloha: ' + jmeno));
            try { res(u.telo(data)); } catch (e) { rej(e); }
        });
    }

    var AGPocty = {};

    // Registrace úlohy. `pomocne` jsou funkce, které tělo volá — musí být
    // POJMENOVANÉ a čisté (viz varování v hlavičce).
    AGPocty.uloha = function (jmeno, pomocne, telo) {
        if (!jmeno || typeof telo !== 'function') return;
        if (ulohy[jmeno]) return;   // přeregistrování by neplatilo — worker už běží se starým kódem
        ulohy[jmeno] = { pomocne: pomocne || [], telo: telo };
        // Nová úloha po startu workeru by v něm nebyla. Zahodíme ho, ať se
        // příště sestaví se všemi. (Děje se jen při načtení modulů, ne za běhu.)
        if (worker) { try { worker.terminate(); } catch (e) { swallow(e, 'ag-pocty:terminate'); } worker = null; }
    };

    AGPocty.umi = function (jmeno) { return !!ulohy[jmeno]; };

    // Spočítá úlohu. Vrací Promise s výsledkem. Nikdy nespadne kvůli workeru —
    // když ten není k dispozici, spočítá se totéž doma.
    AGPocty.spust = function (jmeno, data) {
        if (!ulohy[jmeno]) return Promise.reject(new Error('neznama uloha: ' + jmeno));
        var w = ziskejWorker();
        if (!w) return doma(jmeno, data);
        var id = ++seq;
        return new Promise(function (res, rej) {
            cekajici[id] = { res: res, rej: rej, jmeno: jmeno, data: data };
            try { w.postMessage({ id: id, jmeno: jmeno, data: data }); }
            catch (e) {
                // Nepřenositelná data (funkce, DOM uzel) — postMessage je neumí naklonovat.
                delete cekajici[id];
                swallow(e, 'ag-pocty:postMessage');
                doma(jmeno, data).then(res, rej);
            }
        });
    };

    // Pro protokol chyb a diagnostiku: běží to vedle, nebo doma?
    AGPocty.stav = function () {
        return { workerBezi: !!worker, workerMrtvy: workerMrtvy, uloh: Object.keys(ulohy).length, cekaSe: Object.keys(cekajici).length };
    };

    window.AGPocty = AGPocty;
})();
