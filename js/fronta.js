// ===== AR Geodet — FRONTA NA SIGNÁL: co appka dluží serveru (ODPOJITELNÁ vrstva) =
// PROBLÉM, KTERÝ TENHLE SOUBOR ŘEŠÍ: geodet je půl dne ve sklepě, v lese nebo
// v zástavbě bez signálu. Co v té době odešle do cloudu, se podle modulu buď
// podrží, nebo TIŠE ZTRATÍ:
//   • js/zpetna-vazba.js  — má vlastní frontu (agFbQ_v1), retry na 'online',
//                           poctivá pravidla, co se smí zahodit. Funguje.
//   • js/firma-chat.js    — NEMÁ NIC. Napsaná zpráva skončí hláškou „Bez
//                           internetu zprávu nejde odeslat." a je pryč. Kolega
//                           na druhé straně se nikdy nedozví, že jsi psal.
//   • js/cloud-sync.js    — synchronizuje na vyžádání a při 'online', frontu
//                           nepotřebuje (posílá vždy celý aktuální stav bodů).
// A hlavně: uživatel NIKDE nevidí, kolik toho appka dluží. Zavře ji s pocitem,
// že je odesláno.
//
// ŘEŠENÍ: jedna fronta, do které se dá zařadit odchozí požadavek jakéhokoli
// druhu, a jedno místo, kde se počítá, kolik jich čeká.
//
//     AGFronta.registruj('chat', {
//         popis: 'zpráva do firemního chatu',
//         odeslat: function (telo) { return u.cloudFetch('/chat', { method:'POST', body: telo }); }
//     });
//     AGFronta.posli('chat', { txt: 'jsem u bodu 12' });
//
// `odeslat` musí vrátit Promise s objektem, který má `ok` a `status` — přesně
// to, co vrací u.cloudFetch(). Nic jiného fronta o přenosu vědět nepotřebuje.
//
// ⚠ CO SE SMÍ ZAHODIT A CO NE (tohle je nejdůležitější část souboru a je
// draze zaplacená — v repu je komentář o tom, jak se kvůli tomu ztrácely
// zprávy). Z fronty se vyhazuje JEN to, co opakováním nikdy neprojde:
//     400 (server obsah odmítl), 413 (je moc velký), 422 (nedává smysl)
// NEZAHAZUJE SE:
//     0        — vůbec není spojení, to je přesně důvod, proč fronta existuje
//     404, 405 — tohle vrací worker, na kterém JEŠTĚ NENÍ nasazená daná routa.
//                Zahodit to znamená ztratit data kvůli tomu, že se zapomnělo
//                nasadit server. V tomhle repu se to STALO.
//     408, 429 — „teď ne, zkus později"
//     5xx      — server má problém, ne my
//     401, 403 — vypršelo přihlášení; fronta se PŘERUŠÍ a čeká, až se uživatel
//                přihlásí, ale nic nezahazuje
//
// POŘADÍ A ZASTAVENÍ NA PRVNÍ CHYBĚ: fronta se odesílá po jednom a při prvním
// neúspěchu KONČÍ. Kdyby se pokračovalo, při vypnutém serveru by každý start
// appky vystřelil celou frontu do prázdna a spálil baterii i data.
//
// KDE SE TO ZOBRAZUJE: přes window.AGNotify (js/upozorneni.js) — tedy v TÉŽE
// pilulce nahoře jako všechna ostatní upozornění. ZÁMĚRNĚ se nezakládá další
// vlastní pruh: appka si jich kdysi vypěstovala sedm a přes sebe se překrývaly.
//
// ÚLOŽIŠTĚ: js/ag-store.js (IndexedDB), se zálohou do localStorage, když vrstva
// není. Fronta musí přežít zavření appky — jinak nemá smysl.
//
// ODSTRANĚNÍ VRSTVY: smaž js/fronta.js a jeho řádek v index.html. Moduly mají
// volání pojištěné (`window.AGFronta ? ... : přímé odeslání`), takže se vrátí
// k dnešnímu chování „bez signálu to nejde".
// ==============================================================================
(function () {
    'use strict';
    if (window.AGFronta) return;

    var LS_ZALOHA = 'agFronta_v1';
    var MAX = 200;                  // strop, ať fronta nenaroste do nekonečna
    var POKUS_MS = 60000;           // jak často to zkusit samo od sebe
    var BACKOFF_MAX = 8;            // 2^8 × 60 s ≈ 4 h mezi pokusy při trvalém výpadku

    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'fronta'); } catch (e2) { /* i hlášení chyby smí selhat */ } }

    var druhy = {};                 // druh -> { popis, odeslat }
    var fronta = [];                // [{ id, druh, telo, kdy, pokusu }]
    var nacteno = false;
    var bezi = false;
    var neuspechu = 0;
    var pauza = false;              // 401/403 — čeká se na přihlášení
    var _tik = null;

    // ---- trvalé uložení ------------------------------------------------------
    function police() {
        try { if (window.AGStore) return AGStore.shelf('fronta'); } catch (e) { swallow(e, 'fronta:police'); }
        return null;
    }
    function nacti() {
        if (nacteno) return Promise.resolve();
        var p = police();
        if (!p) {
            try {
                var s = localStorage.getItem(LS_ZALOHA);
                fronta = s ? (JSON.parse(s) || []) : [];
            } catch (e) { fronta = []; swallow(e, 'fronta:nacti'); }
            nacteno = true;
            return Promise.resolve();
        }
        return p.get('vse').then(function (v) {
            fronta = Array.isArray(v) ? v : [];
            nacteno = true;
        }).catch(function (e) { swallow(e, 'fronta:nacti'); fronta = []; nacteno = true; });
    }
    function uloz() {
        while (fronta.length > MAX) fronta.shift();
        var p = police();
        if (p) {
            return p.put('vse', fronta).then(function (ok) {
                // Když IndexedDB odmítne, ať to aspoň někde je — fronta bez
                // uložení je jen pole v paměti, které zavřením appky zmizí.
                if (!ok) zalohuj();
                hlas();
                return ok;
            });
        }
        zalohuj(); hlas();
        return Promise.resolve(true);
    }
    function zalohuj() {
        try { localStorage.setItem(LS_ZALOHA, JSON.stringify(fronta)); }
        catch (e) { swallow(e, 'fronta:zalohuj'); }
    }

    // ---- hlášení uživateli (jednou větou, v existující pilulce) ---------------
    function hlas() {
        try {
            if (!window.AGNotify) return;
            var n = fronta.length;
            if (!n) { AGNotify.clear('fronta'); return; }
            var co = {};
            fronta.forEach(function (z) { co[z.druh] = (co[z.druh] || 0) + 1; });
            var casti = [];
            for (var d in co) {
                if (!Object.prototype.hasOwnProperty.call(co, d)) continue;
                var popis = (druhy[d] && druhy[d].popis) || d;
                casti.push(co[d] + '× ' + popis);
            }
            var text = pauza
                ? 'Čeká na přihlášení: ' + casti.join(', ')
                : (navigator.onLine === false
                    ? 'Čeká na signál: ' + casti.join(', ')
                    : 'Odesílám: ' + casti.join(', '));
            // ⚠ AGNotify.set zná jen id/level/text/order/action/onAction/onDismiss —
            // pole `detail` NEEXISTUJE a tiše by se zahodilo. Vysvětlení proto
            // patří rovnou do textu.
            AGNotify.set('fronta', {
                level: pauza ? 'warn' : 'info',
                text: text + ' — odešle se samo, zavřením appky se to neztratí.',
                order: 5
            });
        } catch (e) { swallow(e, 'fronta:hlas'); }
    }

    // ---- odesílání -----------------------------------------------------------
    function smiZahodit(status) {
        return status === 400 || status === 413 || status === 422;
    }
    function jePauza(status) {
        return status === 401 || status === 403;
    }

    function odesli() {
        if (bezi) return Promise.resolve(0);
        bezi = true;
        return nacti().then(function () {
            var poslano = 0;
            function krok() {
                if (!fronta.length) return Promise.resolve(poslano);
                if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(poslano);
                var z = fronta[0];
                var d = druhy[z.druh];
                // Druh, který v téhle relaci nikdo nezaregistroval (modul je
                // lazy a ještě se nenačetl) — nechat ležet, ne zahodit.
                if (!d || typeof d.odeslat !== 'function') return Promise.resolve(poslano);
                z.pokusu = (z.pokusu || 0) + 1;
                return Promise.resolve()
                    .then(function () { return d.odeslat(z.telo, z); })
                    .then(function (r) {
                        var status = (r && r.status != null) ? r.status : 0;
                        if (r && r.ok) {
                            fronta.shift(); poslano++; neuspechu = 0; pauza = false;
                            return krok();
                        }
                        if (smiZahodit(status)) {
                            // Server řekl „tohle nikdy nevezmu" — držet to navěky
                            // by ucpalo frontu všemu ostatnímu.
                            fronta.shift();
                            swallow(new Error('fronta: zahozeno ' + z.druh + ' (' + status + ')'), 'fronta:zahozeno');
                            return krok();
                        }
                        if (jePauza(status)) { pauza = true; return poslano; }
                        neuspechu = Math.min(neuspechu + 1, BACKOFF_MAX);
                        return poslano;   // zastavit na první chybě, viz hlavička
                    })
                    .catch(function (e) {
                        swallow(e, 'fronta:odesli');
                        neuspechu = Math.min(neuspechu + 1, BACKOFF_MAX);
                        return poslano;
                    });
            }
            return krok();
        }).then(function (n) {
            bezi = false;
            return uloz().then(function () { return n; });
        }, function (e) {
            bezi = false; swallow(e, 'fronta:odesli');
            return 0;
        });
    }

    function naplanuj() {
        if (_tik) clearTimeout(_tik);
        var za = POKUS_MS * Math.pow(2, neuspechu);
        _tik = setTimeout(function () {
            _tik = null;
            if (fronta.length && !pauza) odesli().then(naplanuj); else naplanuj();
        }, za);
        // ⚠ ZÁMĚRNĚ obyčejný setTimeout, ne AG.uiInterval z js/idle-timers.js:
        // ten se na pozadí uspává, což je správně pro kosmetiku, ale ne pro
        // odesílání dat — fronta má dojet i při zhasnutém displeji.
    }

    var AGFronta = {};

    AGFronta.registruj = function (druh, spec) {
        if (!druh || !spec || typeof spec.odeslat !== 'function') return;
        druhy[druh] = { popis: spec.popis || druh, odeslat: spec.odeslat };
        // Modul se načetl pozdě (lazy) a v frontě už na něj něco čeká.
        nacti().then(function () { if (fronta.length) odesli(); });
    };

    // Zkusí odeslat hned; když to nejde, zařadí. Vrací Promise se stavem:
    //   { stav: 'odeslano' }               povedlo se hned
    //   { stav: 'ceka', pocet: n }         leží ve frontě, odešle se samo
    //   { stav: 'zahozeno', status }       server to odmítl natrvalo
    AGFronta.posli = function (druh, telo) {
        var d = druhy[druh];
        if (!d) return Promise.resolve({ stav: 'zahozeno', status: 0 });
        return nacti().then(function () {
            // Když už něco čeká, NEPŘEDBÍHAT — jinak by zprávy dorazily
            // přeházené a v chatu by odpověď byla nad dotazem.
            if (fronta.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
                return zarad(druh, telo).then(function () { return { stav: 'ceka', pocet: fronta.length }; });
            }
            return Promise.resolve()
                .then(function () { return d.odeslat(telo, null); })
                .then(function (r) {
                    var status = (r && r.status != null) ? r.status : 0;
                    if (r && r.ok) { return { stav: 'odeslano' }; }
                    if (smiZahodit(status)) return { stav: 'zahozeno', status: status };
                    if (jePauza(status)) pauza = true;
                    return zarad(druh, telo).then(function () { return { stav: 'ceka', pocet: fronta.length, status: status }; });
                })
                .catch(function () {
                    return zarad(druh, telo).then(function () { return { stav: 'ceka', pocet: fronta.length }; });
                });
        });
    };

    function zarad(druh, telo) {
        fronta.push({ id: 'q' + Date.now() + '_' + Math.round(Math.random() * 1e6), druh: druh, telo: telo, kdy: Date.now(), pokusu: 0 });
        return uloz();
    }

    AGFronta.stav = function () {
        var co = {};
        fronta.forEach(function (z) { co[z.druh] = (co[z.druh] || 0) + 1; });
        return { ceka: fronta.length, pauza: pauza, neuspechu: neuspechu, podle: co };
    };

    // Ruční „zkus to teď" (tlačítko v nastavení, návrat z offline).
    AGFronta.ted = function () { pauza = false; neuspechu = 0; return odesli(); };

    // Vyhodit, co uživatel poslat nechce (např. po odhlášení z firmy).
    AGFronta.zahod = function (druh) {
        return nacti().then(function () {
            fronta = fronta.filter(function (z) { return druh ? z.druh !== druh : false; });
            return uloz();
        });
    };

    // ---- život ---------------------------------------------------------------
    try {
        window.addEventListener('online', function () {
            // Chvíli počkat: 'online' přijde dřív, než je spojení použitelné.
            setTimeout(function () { neuspechu = 0; odesli(); }, 1500);
        });
        window.addEventListener('offline', function () { hlas(); });
        // Poslední šance uložit, když uživatel appku zavírá.
        window.addEventListener('pagehide', function () { zalohuj(); });
    } catch (e) { swallow(e, 'fronta:listen'); }

    // Po startu: načíst, ohlásit, zkusit. Ne hned — start appky má svůj rozpočet.
    setTimeout(function () {
        nacti().then(function () { hlas(); if (fronta.length) odesli(); naplanuj(); });
    }, 4000);

    window.AGFronta = AGFronta;
})();
