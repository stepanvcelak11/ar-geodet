// ===== QTRIG — POŘÁDEK V NASTAVENÍ (ODPOJITELNÁ VRSTVA) ======================
// PROBLÉM: stránky Nastavení jsou v index.html poskládané do sekcí (.set-h), jenže
// PŮLKA voleb do nich přiletí až za běhu z modulů — a ty skoro všechny končí
// `tab.appendChild(...)`. Výsledek: přepínače spadnou AŽ POD sbalené „Pokročilé",
// bez nadpisu, a jejich pořadí se řídí tím, který skript se zrovna načetl dřív.
//
// ŘEŠENÍ: jedno místo, které po každém otevření (a po každé změně DOM v okně)
// srovná obsah do PEVNÉHO pořadí:
//   • každý známý přisypaný řádek má svoji stránku a sekci (MOVE + LAYOUT.put),
//   • celé přisypané sekce i s nadpisem se stěhují mezi stránkami (MOVE_SEC),
//   • sekce jdou v daném pořadí (LAYOUT.order), nezávisle na pořadí načtení skriptů,
//   • „Pokročilé" je VŽDY úplně dole,
//   • co sem přisype modul, o kterém tenhle soubor neví, se nenechá pod „Pokročilé",
//     ale sesbírá se nad něj do sekce „Další volby" (viz strays),
//   • řádky, které z Nastavení ODEŠLY (HIDE), dostanou třídu .ag-set-drop — modul si
//     je věší dál (často v časovači), tady je nikdo nevidí.
//
// NASTAVENÍ NANOVO (18. 9. 2026 večer, na přání: „složitý, nepřehledný … to důležité
// vepředu, méně používané stranou"): záložky → první obrazovka (karta Časté + seznam
// kategorií) a osm stránek. Moduly věší řádky dál do PŮVODNÍCH záložek (tab-vzhled,
// tab-ar, tab-data, tab-udrzba) — tenhle soubor je jediné místo, které ví, kam patří
// ve struktuře nové: AR kamera · Mapa a body · Vzhled · Ovládání · Výkon a baterie ·
// Zakázka a data · Záloha a údržba · Účet a aplikace. Zrušené vrstvy schovávání
// (skládací sekce z 30. 8., Krátké nastavení, boční rejstřík) tu už nejsou.
//
// Nic se nepřejmenovává ani nemaže, jen stěhuje: saveSettings() v grafika.js i
// moduly čtou prvky podle id, takže přesun mezi sekcemi je pro ně neviditelný.
//
// Odstranění: smaž js/nastaveni-poradek.js + řádek <script> v index.html
// (a přegeneruj sw.js). Nastavení pak bude zase v pořadí načtení skriptů —
// a přisypané řádky zůstanou ve starých záložkách.
// ================================================================================
(function () {
    'use strict';
    if (window.AGSettingsOrder) return;

    // ---- co kam patří ------------------------------------------------------------------
    // order = pořadí sekcí na stránce (podle nadpisu .set-h; sekce, která v HTML není,
    //         se vytvoří teprve když do ní něco spadne)
    // put   = kam patří prvek přisypaný modulem. Klíč je id prvku NEBO id ovládacího
    //         prvku uvnitř řádku (moduly někdy id na řádek nedají, jen na checkbox).
    //         s = nadpis sekce ('' = bez sekce, jen pořadí), after = hned za řádek s tímhle id,
    //         i < 0 = na začátek sekce, i >= 0 = na konec (menší číslo vždy dřív)
    var LAYOUT = {
        'tab-ar': {
            order: ['Body v kameře', 'Kompas'],
            put: {
                'ag-arfusion-row': { s: 'Kompas', i: -2 },     // plynulý směr (fúze gyro) nad tlačítko Kompas
                'agvt-settings-row': { s: 'Kompas', i: -1 }    // vizuální stabilizace (beta)
            }
        },
        // MAPA A BODY (nová stránka): řádky z modulů, které pracují s mapou. Sekce
        // „Přesnost z mapy" (prichyceni, hrana-auto, hlidac-okoli, trasa-terenem vkládají
        // do tab-ar), „Země a souřadnice" (zeme-svet) a „Data mapy (vektor)" (mapa-vektor)
        // sem přijdou CELÉ i s nadpisem přes MOVE_SEC.
        'tab-mapa': {
            order: ['Body v mapě', 'Přesnost z mapy', 'Země a souřadnice', 'Data mapy (vektor)'],
            put: {
                's-mapfab': { s: 'Body v mapě', i: 5 }         // tlačítko vrstev v mapě (map-tools.js ho věší k levé ruce)
            }
        },
        'tab-vzhled': {
            order: ['Displej a čitelnost'],
            put: {
                'ag-lang-sel': { s: 'Displej a čitelnost', i: 1 }      // jazyk (js/jazyky.js ho věší na začátek Vzhledu)
                // noční režim (js/motivy-teren.js) leží za odstínem UVNITŘ „Pokročilé" — nestěhovat:
                // rowOf by vrátil celé <details> a to by se zaseklo doprostřed sekce
            }
        },
        'tab-ovladani': {
            order: ['Telefon v ruce', 'Zkratky', 'Zjednodušení'],
            put: {
                'ag-glove-row': { s: 'Telefon v ruce', after: 's-lefthand' },   // rukavice hned k levé ruce
                'ag-gz-setrow': { s: 'Zkratky', i: 1 },                         // gesta = zkratky na nástroje
                'ag-kn-setrow': { s: 'Zkratky', i: 2 },                         // kolečko nástrojů (podržení tlačítka Nástroje)
                'ag-jr-setrow': { s: 'Zjednodušení', i: 1 }                     // jednoduchý režim
            }
        },
        // VÝKON A BATERIE (nová stránka): karty Slabší telefon a Úspora baterie mají
        // vlastní nadpisy (.set-h uvnitř karty), takže tu žádná sekce nevzniká — jen pořadí.
        'tab-vykon': {
            order: [],
            put: {
                'agl-card': { s: '', i: 1 },     // slabší telefon (js/slabsi-telefon.js)
                'agp-card': { s: '', i: 2 }      // úspora baterie (js/power-save.js)
            }
        },
        'tab-data': {
            order: ['Zakázka', 'Firemní cloud', 'Offline'],
            put: {
                'ag-dup-project-btn': { s: 'Zakázka', i: 1 },
                'ag-quota': { s: 'Offline', i: 9 }            // zaplnění úložiště (vylepseni.js)
            }
        },
        'tab-udrzba': {
            order: ['Záloha', 'Body', 'Místo v telefonu'],
            put: {
                'ag-backup-row': { s: 'Záloha', i: -1 },      // stav automatické zálohy (js/auto-zaloha.js)
                'ag-uvolnit': { s: 'Místo v telefonu', i: 2 }, // Uvolnit místo (js/uvolnit-misto.js) — karta s vlastním nadpisem, až za Vymazat
                'ag-dev-box': { s: 'Místo v telefonu', i: 9 }  // Profil zařízení (js/profily.js) — karta s vlastním nadpisem, úplně dole
            }
        },
        // ÚČET A APLIKACE (nová stránka): tlačítka modulů z bývalé Aplikace + zrcadlo bočního
        // panelu (viz mirrorMenu níž).
        'tab-ucet': {
            order: ['Účet', 'Aplikace'],
            put: {
                'set-about-btn': { s: 'Aplikace', i: 1 },
                'hist-set-btn': { s: 'Aplikace', i: 2 },      // Co je nového / historie (js/historie-aktualizaci.js)
                'set-navod-btn': { s: 'Aplikace', i: 3 },
                'set-sdilet-app': { s: 'Aplikace', i: 4 },
                'ag-fb-inbox-btn': { s: 'Aplikace', i: 8 },   // schránka vzkazů — jen vlastník (js/zpetna-vazba.js)
                'ag-sa-set-btn': { s: 'Aplikace', i: 9 },     // Správa aplikace — jen vlastník (js/sprava-appky.js)
                'agv-set-btn': { s: 'Aplikace', i: 10 }       // konzole vlastníka (js/vlastnik.js)
            }
        }
    };
    var STRAY_H = 'Další volby';     // sběrná sekce pro neznámé přírůstky
    // STĚHOVÁNÍ ŘÁDKŮ MEZI STRÁNKAMI: prvek s tímhle id patří na danou stránku, ať ho modul
    // vložil kamkoli. Řeší se PŘED srovnáním sekcí: přesun je jen appendChild, o pořadí
    // uvnitř cílové stránky se postará arrangeTab podle LAYOUT.put.
    var MOVE = {
        'tab-ovladani': ['ag-glove-row', 'ag-jr-setrow', 'ag-gz-setrow', 'ag-kn-setrow'],
        'tab-vykon': ['agl-card', 'agp-card'],
        'tab-mapa': ['s-mapfab'],
        'tab-ucet': ['hist-set-btn', 'ag-fb-inbox-btn', 'ag-sa-set-btn', 'agv-set-btn']
    };
    // STĚHOVÁNÍ CELÝCH SEKCÍ (nadpis .set-h + řádky až po další nadpis / ocas):
    var MOVE_SEC = {
        'tab-mapa': ['Přesnost z mapy', 'Země a souřadnice', 'Data mapy (vektor)'],
        'tab-data': ['Firemní cloud']
    };
    // ODEŠLO Z NASTAVENÍ (volba uživatele 18. 9. 2026): moduly si řádek věší dál (často
    // v časovači, takže smazat ho nejde), tady dostane .ag-set-drop a zmizí.
    //   ag-ts-setrow / ag-ua-simple-row — Jednoduchý panel Nástrojů, Zjednodušené Nástroje
    //                                     (Nástroje mají „Zobrazit všechny nástroje")
    //   ag-fb-set-btn / ag-zdravi-set-btn — Napsat autorovi, Funguje mi všechno? (jsou v Nástrojích)
    //   ag-ns-setrow — přepínač Krátké nastavení ze starší verze nastaveni-hledani.js
    var HIDE = ['ag-ts-setrow', 'ag-ua-simple-row', 'ag-fb-set-btn', 'ag-zdravi-set-btn', 'ag-ns-setrow', 'ag-fb-foot-set'];

    function relocate() {
        var tabId, tab, ids, i, el, src, row;
        for (tabId in MOVE) {
            if (!Object.prototype.hasOwnProperty.call(MOVE, tabId)) continue;
            tab = document.getElementById(tabId);
            if (!tab) continue;                                   // starší index.html bez stránky — nic se nestěhuje
            ids = MOVE[tabId];
            for (i = 0; i < ids.length; i++) {
                el = document.getElementById(ids[i]);
                if (!el) continue;
                src = el.closest ? el.closest('.settings-tab') : null;
                if (!src || src === tab) continue;
                row = rowOf(el, src);
                if (row) tab.appendChild(row);
            }
        }
        for (tabId in MOVE_SEC) {
            if (!Object.prototype.hasOwnProperty.call(MOVE_SEC, tabId)) continue;
            tab = document.getElementById(tabId);
            if (!tab) continue;
            MOVE_SEC[tabId].forEach(function (title) { moveSection(title, tab); });
        }
        for (i = 0; i < HIDE.length; i++) {
            el = document.getElementById(HIDE[i]);
            if (!el) continue;
            src = el.closest ? el.closest('.settings-tab') : null;
            row = src ? rowOf(el, src) : el;
            if (row && !row.classList.contains('ag-set-drop')) row.classList.add('ag-set-drop');
        }
    }
    // Najde sekci podle nadpisu na KTERÉKOLI jiné stránce a přenese ji i s řádky.
    // Nadpis uvnitř karty (např. #ag-uvolnit má .set-h jako své dítě) se nehledá —
    // karta se stěhuje celá jako řádek přes MOVE.
    function moveSection(title, tab) {
        var n = norm(title);
        var pages = document.querySelectorAll('#settings-modal .settings-tab');
        for (var p = 0; p < pages.length; p++) {
            var src = pages[p];
            if (src === tab) continue;
            var kids = src.children;
            for (var i = 0; i < kids.length; i++) {
                if (!isHead(kids[i]) || norm(headText(kids[i])) !== n) continue;
                var take = [kids[i]];
                for (var j = i + 1; j < kids.length; j++) {
                    if (isHead(kids[j]) || isTail(kids[j])) break;
                    take.push(kids[j]);
                }
                take.forEach(function (e) { tab.appendChild(e); });
                return true;
            }
        }
        return false;
    }

    // ---- ÚČET: zrcadlo bočního panelu -------------------------------------------------
    // Vstupy k účtu (Kde pracuju, Přepnout uživatele / zamknout, Administrace firmy, Verze
    // Pro, Co je v Pro, klíč Pro) si moduly věší do #side-menu — panel je od 18. 9. skrytý.
    // Tady se pro každé existující tlačítko udělá stejnojmenné tlačítko na stránce Účet
    // a aplikace; klepnutí předá klik originálu (jeho handler je jediný zdroj pravdy) a
    // zavře panel, kdyby ho handler otevřel (ucty-admin volá toggleMenu naslepo).
    var MIRROR = ['ag-prostory-btn', 'agfa-switch-btn', 'agfa-admin-btn', 'ag-pro-menu-btn', 'ag-prehled-menu-btn', 'ag-pk-menu-btn'];
    function mirrorMenu() {
        var host = document.getElementById('set-ucet-proxy'); if (!host) return;
        var want = [];
        MIRROR.forEach(function (id) {
            var src = document.getElementById(id);
            if (!src || (src.style && src.style.display === 'none') || src.hidden) return;
            var pid = 'set-mirror-' + id;
            var b = document.getElementById(pid);
            if (!b) {
                b = document.createElement('button');
                b.type = 'button'; b.id = pid; b.className = 'btn btn-secondary';
                b.setAttribute('data-mirror', id);
                b.addEventListener('click', function () {
                    var o = document.getElementById(id); if (!o) return;
                    var m = document.getElementById('settings-modal'); if (m) m.style.display = 'none';
                    try { o.click(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'nastaveni-poradek:mirror'); }
                    try { var sm = document.getElementById('side-menu'); if (sm) sm.classList.remove('open'); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'nastaveni-poradek:mirror'); }
                });
            }
            var html = src.innerHTML;
            if (b.innerHTML !== html) b.innerHTML = html;
            want.push(b);
        });
        if (!sameOrder(host, want)) {
            while (host.firstChild) host.removeChild(host.firstChild);
            want.forEach(function (b) { host.appendChild(b); });
        }
        // bez jediného vstupu nadpis „Účet" nedává smysl
        var h = host.previousElementSibling;
        if (h && isHead(h)) h.style.display = want.length ? '' : 'none';
        host.style.display = want.length ? '' : 'none';
    }

    function norm(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'nastaveni-poradek:norm'); }
        return s.replace(/\s+/g, ' ').trim();
    }
    function isHead(el) { return !!(el.classList && el.classList.contains('set-h')); }
    // ⚠ NADPIS SEKCE JE KLÍČ — a při přepnutém jazyce už není česky.
    //   js/jazyky.js překladá texty přímo v DOM a na přeložený prvek zapisuje
    //   `data-ag-cs` s původním zněním. Bez tohohle čtení by findSec() svou sekci
    //   nenašel a makeSec() by při KAŽDÉM srovnání vyrobil další — naměřeno:
    //   po minutě desítky duplicitních nadpisů v záložce. Bez překladů atribut
    //   neexistuje a čte se textContent jako dřív.
    function headText(el) {
        var cs = el && el.getAttribute && el.getAttribute('data-ag-cs');
        return cs || (el ? el.textContent : '');
    }
    // „ocas" záložky — musí zůstat úplně dole
    function isTail(el) {
        return el.tagName === 'DETAILS'
            || !!(el.classList && el.classList.contains('ag-ns-more'));
    }
    // z id (klidně id checkboxu uvnitř) udělá PŘÍMÉHO potomka záložky, nebo null
    function rowOf(el, tab) {
        while (el && el.parentNode !== tab) el = el.parentNode;
        return (el && el.parentNode === tab) ? el : null;
    }
    function sameOrder(parent, want) {
        var k = parent.children;
        if (k.length !== want.length) return false;
        for (var i = 0; i < want.length; i++) if (k[i] !== want[i]) return false;
        return true;
    }

    // ---- rozbor záložky na sekce ---------------------------------------------------------
    function parse(tab) {
        var lead = [], secs = [], tail = [], strays = [], cur = null, seenTail = false;
        var kids = Array.prototype.slice.call(tab.children);
        for (var i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (isTail(el)) { tail.push(el); seenTail = true; continue; }
            if (el.classList && el.classList.contains('ag-set-drop')) { tail.push(el); continue; }   // schovaný řádek — nikam nepatří
            // cokoli, co skončilo POD „Pokročilé", je přírůstek modulu — vytáhneme ho nahoru
            if (seenTail && !isHead(el)) { strays.push(el); continue; }
            if (isHead(el)) { cur = { h: el, t: norm(headText(el)), items: [] }; secs.push(cur); seenTail = false; continue; }
            if (cur) cur.items.push(el); else lead.push(el);
        }
        return { lead: lead, secs: secs, tail: tail, strays: strays };
    }
    function findSec(model, title) {
        var n = norm(title);
        for (var i = 0; i < model.secs.length; i++) if (model.secs[i].t === n) return model.secs[i];
        return null;
    }
    function makeSec(model, title) {
        var h = document.createElement('div');
        h.className = 'set-h';
        h.textContent = title;
        // Český klíč rovnou při vzniku — jazyky.js ho po překladu doplní sám,
        // ale mezitím (než doběhne jeho další kolo) by sekce neměla podle čeho párovat.
        try { h.setAttribute('data-ag-cs', String(title)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'nastaveni-poradek:makeSec'); }
        var sec = { h: h, t: norm(title), items: [], made: true };
        model.secs.push(sec);
        return sec;
    }
    // vytáhne prvek odkudkoli z modelu (vrací true, když ho našel)
    function detach(model, el) {
        var hit = false;
        function fromArr(a) { var i = a.indexOf(el); if (i !== -1) { a.splice(i, 1); hit = true; } }
        fromArr(model.lead); fromArr(model.strays); fromArr(model.tail);
        for (var i = 0; i < model.secs.length; i++) fromArr(model.secs[i].items);
        return hit;
    }

    // ---- srovnání jedné záložky ------------------------------------------------------------
    function arrangeTab(tabId) {
        var tab = document.getElementById(tabId);
        var spec = LAYOUT[tabId];
        if (!tab || !spec) return;
        var model = parse(tab);

        // 1) přisypané prvky do svých sekcí
        var planned = [];
        for (var id in spec.put) {
            if (!Object.prototype.hasOwnProperty.call(spec.put, id)) continue;
            var el = rowOf(document.getElementById(id), tab);
            if (!el || isTail(el)) continue;                 // modul odpojený, vkládá jinam, nebo je to prvek uvnitř „Pokročilé"
            detach(model, el);
            planned.push({ el: el, r: spec.put[id] });
        }
        planned.sort(function (a, b) { return (a.r.i || 0) - (b.r.i || 0); });
        var front = {};                                      // kolik už je nahoře v které sekci
        planned.forEach(function (p) {
            if (!p.r.s) { model.lead.push(p.el); return; }      // stránka bez sekcí (Výkon a baterie)
            var sec = findSec(model, p.r.s) || makeSec(model, p.r.s);
            if (p.r.after) {                                  // hned za konkrétní řádek
                for (var i = 0; i < sec.items.length; i++) {
                    var it = sec.items[i];
                    if (it.id === p.r.after || (it.querySelector && it.querySelector('#' + p.r.after))) {
                        sec.items.splice(i + 1, 0, p.el); return;
                    }
                }
            }
            if ((p.r.i || 0) < 0) {                           // nahoru, ale v pořadí podle i
                var n = front[sec.t] = (front[sec.t] || 0);
                sec.items.splice(n, 0, p.el);
                front[sec.t] = n + 1;
            } else sec.items.push(p.el);
        });

        // 2) přírůstky neznámých modulů (spadly pod „Pokročilé") → sběrná sekce
        // (řádky s .ag-set-drop jsou schované — ty nadpis „Další volby" nezaslouží, jdou do ocasu)
        model.strays = model.strays.filter(function (e) {
            if (e.classList && e.classList.contains('ag-set-drop')) { model.tail.push(e); return false; }
            return true;
        });
        if (model.strays.length) {
            var sc = findSec(model, STRAY_H) || makeSec(model, STRAY_H);
            model.strays.forEach(function (e) { sc.items.push(e); });
            model.strays = [];
        }

        // 3) pořadí sekcí: nejdřív podle LAYOUT.order, pak ty ostatní ve stávajícím pořadí
        var wantSecs = [], used = [];
        (spec.order || []).forEach(function (t) {
            var s = findSec(model, t);
            if (s && used.indexOf(s) === -1) { wantSecs.push(s); used.push(s); }
        });
        model.secs.forEach(function (s) {
            if (used.indexOf(s) !== -1) return;
            if (s.made && !s.items.length) return;          // prázdnou sekci nevyrábět
            wantSecs.push(s); used.push(s);
        });

        // 4) poskládat DOM (jen když se pořadí opravdu liší — jinak zbytečné přesuny)
        var want = model.lead.slice();
        wantSecs.forEach(function (s) {
            if (!s.items.length && s.made) return;
            want.push(s.h);
            s.items.forEach(function (e) { want.push(e); });
        });
        model.tail.forEach(function (e) { want.push(e); });
        if (sameOrder(tab, want)) return;
        want.forEach(function (e) { tab.appendChild(e); });
    }

    // ---- hlavička okna: hlavička → hledání → první obrazovka -------------------------
    // Pole hledání (js/nastaveni-hledani.js) patří mezi .set-head a #set-home. Referenční
    // prvek se počítá JEDNOU a použije se na porovnání i vložení — jinak přesun sebere
    // fokus a klávesnice spadne (naměřeno 9. 8. 2026: 14 přesunů za 3 s).
    function arrangeHead() {
        var m = document.getElementById('settings-modal'); if (!m) return;
        var c = m.querySelector('.modal-content'); if (!c) return;
        var home = document.getElementById('set-home'); if (!home || home.parentNode !== c) return;
        var search = document.getElementById('ag-ns-search');
        if (search && search.parentNode === c && search.nextElementSibling !== home) c.insertBefore(search, home);
    }

    // ---- život modulu ------------------------------------------------------------------------
    // BATERIE: MutationObserver níž hlídá CELÝ obsah Nastavení včetně podstromu, a do
    // Nastavení píší živé náhledy (stav GPS, kompas, profily…) i když je okno ZAVŘENÉ.
    // Přerovnání se tak spouštělo ~5×/s pořád dokola — naměřeno přes 2000 dotazů do DOM
    // za 20 s pro panel, na který se nikdo nedívá. Zavřené okno teď jen zvedne příznak
    // `_dirty` a skutečné srovnání proběhne až při otevření (viz níž wrapper openSettings
    // a hlídač zobrazení), takže uživatel dostane stejné pořadí, jen se pro to nedře celý den.
    var _busy = false, _timer = null, _dirty = false;
    function settingsVisible() {
        var m = document.getElementById('settings-modal');
        return !!(m && m.style && m.style.display && m.style.display !== 'none');
    }
    // POJISTKA k opravě arrangeHead() výše: přesun prvku v DOM sebere fokus všemu, co
    // je v něm — na mobilu se to projeví spadlou klávesnicí uprostřed psaní. Dokud
    // uživatel do Nastavení píše, srovnání se odloží; pořadí sekcí za rozepsaný text
    // nestojí. Retry si drží vlastní časovač, aby se srovnání po dopsání dohnalo i
    // bez další změny v DOM.
    function typingInSettings() {
        var a = document.activeElement;
        if (!a || a === document.body || !a.tagName) return false;
        if (a.tagName !== 'INPUT' && a.tagName !== 'TEXTAREA' && a.tagName !== 'SELECT') return false;
        var m = document.getElementById('settings-modal');
        return !!(m && m.contains(a));
    }
    // ⚠ PO STARTU SE SROVNÁVÁ I ZAVŘENÉ OKNO. Moduly se dosypávají do Nastavení ještě
    // dlouho po načtení (lazy-load) a dřív se na ně čekalo až do otevření — jenže to
    // znamená přeskládat obsah ve chvíli, kdy okno UŽ NAJÍŽDÍ (fade 0,28 s). Na rychlém
    // prohlížeči to nikdo nevidí, na telefonu se to projeví jako probliknutí starého
    // rozvržení. Po WARMUP ms od načtení se proto srovnává i naprázdno; pak už se šetří
    // baterie jako dřív (zavřené okno se nesrovnává, viz audit výkonu 9427482).
    var WARMUP = 25000, _load = Date.now();
    function warmingUp() { return (Date.now() - _load) < WARMUP; }
    function arrange() {
        if (_busy) return;
        if (!settingsVisible() && !warmingUp()) { _dirty = true; return; }
        // s prstem na displeji nepřeskládávat — přesun prvku pod prstem sebere klepnutí (AG.dotyk)
        if (typingInSettings() || (window.AG && AG.dotyk && AG.dotyk())) {
            _dirty = true;
            if (!_timer) _timer = setTimeout(function () { _timer = null; arrange(); }, typingInSettings() ? 900 : 200);
            return;
        }
        _dirty = false;
        _busy = true;
        try {
            arrangeHead();
            relocate();
            // Seznam záložek se bere z LAYOUT, ne natvrdo. Dřív tu byly vypsané čtyři
            // ids — nová záložka „Profily" se pak sice do LAYOUT zapsala, ale nikdy
            // se nesrovnala, takže její sekce vůbec nevznikly (8.8.2026).
            var ids = Object.keys(LAYOUT);
            for (var i = 0; i < ids.length; i++) arrangeTab(ids[i]);
            mirrorMenu();
        } catch (e) { console.warn('[nastaveni-poradek]', e); }
        _busy = false;
    }
    function schedule() {
        if (_busy || _timer) return;
        // zavřené okno nespěchá — delší prodleva svede víc dosypaných řádků do jednoho srovnání
        _timer = setTimeout(function () { _timer = null; arrange(); }, settingsVisible() ? 220 : 700);
    }
    function watch() {
        var m = document.getElementById('settings-modal'); if (!m) return false;
        var c = m.querySelector('.modal-content') || m;
        try {
            new MutationObserver(schedule).observe(c, { childList: true, subtree: true });
        } catch (e) { return false; }
        // ZÁCHYTNÁ SÍŤ k odloženému srovnání výše: okno se otevírá i jinudy než přes
        // openSettings() (dlaždice, zkratky, obnova stavu). Tenhle pozorovatel sleduje
        // jen atribut style samotného okna, takže tiká jen při skutečném otevření/zavření.
        try {
            new MutationObserver(function () {
                if (_dirty && settingsVisible()) arrange();
            }).observe(m, { attributes: true, attributeFilter: ['style', 'class'] });
        } catch (e3) { window.AG && AG.swallow && AG.swallow(e3, 'nastaveni-poradek:watch'); }
        // srovnat i při každém otevření (moduly dosypávají obsah až tam). Srovnáváme
        // SYNCHRONNĚ hned po otevření — okno už v tu chvíli je vidět a odložené srovnání
        // by se uživateli projevilo jako přeskládání obsahu pod rukama.
        try {
            var open = window.openSettings;
            if (typeof open === 'function' && !open.__agOrder) {
                var wrapped = function () {
                    var r = open.apply(this, arguments);
                    try { arrange(); } catch (e4) { window.AG && AG.swallow && AG.swallow(e4, 'nastaveni-poradek:wrapped'); }
                    // ještě jednou HNED v příštím snímku: otevření samo probouzí moduly,
                    // které si do Nastavení dosypou řádek — takhle se srovná dřív, než
                    // okno dojede do plné viditelnosti, ne až za 220 ms uprostřed fade.
                    try { requestAnimationFrame(function () { try { arrange(); } catch (e6) { window.AG && AG.swallow && AG.swallow(e6, 'nastaveni-poradek:wrapped'); } }); } catch (e5) { window.AG && AG.swallow && AG.swallow(e5, 'nastaveni-poradek:wrapped'); }
                    schedule();          // a naposled, až doběhne zbytek
                    return r;
                };
                wrapped.__agOrder = 1;
                window.openSettings = wrapped;
            }
        } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'nastaveni-poradek:wrapped'); }
        arrange();
        return true;
    }
    function init() {
        if (!watch()) setTimeout(init, 600);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(arrange, 800); setTimeout(arrange, 2500); });

    window.AGSettingsOrder = { arrange: arrange, layout: LAYOUT, unfold: function () {}, applyFold: function () {} };
})();
