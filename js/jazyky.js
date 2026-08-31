// ===== AR Geodet — JAZYKY (odpojitelná vrstva) ==================================
// Appka je napsaná česky — texty jsou přímo ve zdrojích (index.html + ~150 modulů),
// ne za klíči typu t('save'). Přepsat to na klíče by znamenalo sáhnout do každého
// souboru a rozbít každou rozdělanou větev; navíc by se to při každém novém
// nástroji muselo hlídat. Proto tenhle modul překládá NAPROTI TOMU, CO JE V DOM:
//
//   • slovník má klíč = PŘESNÝ ČESKÝ TEXT (data/jazyky.json), hodnota = překlady,
//   • po startu se projde strom, textové uzly a vybrané atributy se nahradí,
//   • MutationObserver dělá totéž pro cokoli, co se doplní později (modály,
//     dlaždice, panely) — na způsobu, jakým to modul vyrobil, vůbec nezáleží.
//
// ⚠ SHODA JE ZÁMĚRNĚ CELÝM TEXTEM, ne po slovech ani přes obsahuje(). Kdyby se
//   překládaly fragmenty, roztrhalo by to uživatelská data: bod pojmenovaný
//   „Body" nebo poznámka „Plocha u šachty" by se přeložily taky. Celý text uzlu
//   se musí trefit do slovníku, jinak se nesahá. Cena: skládané věty s číslem
//   („12 bodů") se netrefí — pro pár nejčastějších jsou v JSONu vzory `re`.
//
// ⚠ ORIGINÁL SI DRŽÍME. U každého uzlu, do kterého se sáhlo, je uložený český
//   zdroj (_seen) — přepnutí jazyka i návrat na češtinu proto nepotřebuje reload.
//   Když text přepíše sama appka (živá hodnota), pozná se to podle toho, že se
//   současný obsah liší od toho, co jsme tam napsali, a bere se jako nový zdroj.
//
// ⚠ #map a #ar-overlay se PŘESKAKUJÍ CELÉ. Leaflet i AR vrstva tam přestavují DOM
//   desetkrát za sekundu a je v nich výhradně uživatelský obsah (čísla bodů,
//   dlaždice) — procházet to by stálo baterii a nic by to nepřineslo.
//
// ČEŠTINA NIC NESTOJÍ: bez uloženého jiného jazyka appka slovník nenačte ani
// nerozparsuje a MutationObserver se vůbec nespustí (ověřeno v prohlížeči:
// nula požadavků na slovník). Nabídka jazyků je proto v tomhle souboru, ne
// ve slovníku — jinak by se kvůli naplnění přepínače musel stáhnout vždycky.
// Service worker si soubor do předcache uloží (93 kB, ~37 kB po kompresi),
// aby šlo jazyk přepnout i bez signálu; to je JEDINÁ cena, kterou platí i ten,
// kdo appku používá česky.
//
// ⚠ SLOVNÍKY JSOU DVA A JE TO ZÁMĚR.
//   • data/jazyky.json — JÁDRO (~700 nejčastějších textů + vzory `re`). Je malé,
//     service worker si ho ukládá do předcache, takže jazyk jde přepnout i bez
//     signálu hned napoprvé.
//   • data/jazyky-en|de|pl.json — ROZŠÍŘENÍ (~5 700 klíčů, ~480 kB na jazyk).
//     Stahuje se AŽ po volbě jazyka a JEN ten jeden zvolený. V předcache není:
//     kdo appku používá česky, nestáhne z něj ani bajt, a i cizinec platí za
//     svůj jazyk, ne za tři. Po prvním stažení ho service worker uloží (běžná
//     cache-first cesta pro vlastní soubory), takže offline funguje dál.
//   Když se rozšíření nestáhne (offline při prvním přepnutí), appka se prostě
//   přeloží jen z jádra — nic nespadne, jen zůstane víc textů česky.
//   ⚠ JÁDRO MÁ PŘEDNOST: klíč, který je v obou, se bere z jádra (je ručně
//   protříděné a ověřené v appce).
//
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + './js/jazyky.js'
// a './data/jazyky.json' v sw.js (EXTRA_ASSETS v scripts/gen_sw_assets.py);
// data/jazyky-*.json se nikde neregistrují, stačí je smazat.
// ================================================================================
(function () {
    'use strict';
    if (window.AGJazyk) return;

    var LS = 'agJazyk_v1';
    var URL_DICT = './data/jazyky.json';
    // ⚠ NABÍDKA JE TADY, NE VE SLOVNÍKU. Kdyby se četla ze staženého JSONu, musel
    //   by se slovník (~150 kB) stáhnout a rozparsovat i tomu, kdo appku používá
    //   česky a jazyk nikdy nepřepne — jen aby se měl přepínač čím naplnit.
    //   Naměřeno: přesně to se dělo, než tenhle seznam vznikl. Slovník se teď
    //   sahá až ve chvíli, kdy si někdo vybere jiný jazyk než češtinu.
    //   Musí sedět s `poradi` v data/jazyky.json; kdyby tam přibyl jazyk navíc,
    //   po načtení se do nabídky doplní sám (viz mergeLangs).
    var CS = { c: 'cs', n: 'Čeština' };
    var LANGS = [CS, { c: 'en', n: 'English' }, { c: 'de', n: 'Deutsch' }, { c: 'pl', n: 'Polski' }];

    var _lang = 'cs';         // aktuální kód
    var _langs = LANGS.slice();
    var _map = null;          // { český text: přeložený text } pro _lang
    var _re = [];             // [{ p: RegExp, r: 'náhrada' }]
    var _raw = null;          // celý JSON (aby šlo přepínat bez dalšího stahování)
    var _loading = null;
    // rozšiřující slovníky: kód jazyka -> { český text: překlad } | null (nedostupné)
    var _extra = {};
    var _extraLoading = {};

    // uzly, do kterých se sáhlo — kvůli přepnutí jazyka i návratu na češtinu
    var _seen = typeof WeakMap === 'function' ? new WeakMap() : null;
    var _touched = [];        // [{ n: uzel, a: název atributu | null }]
    var _obs = null, _busy = false, _queue = [], _tmr = null;

    var SKIP_TAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, CANVAS: 1, VIDEO: 1, IFRAME: 1 };
    var SKIP_ID = { map: 1, 'ar-overlay': 1 };
    var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
    var MAX_LEN = 900;        // delší uzel (odstavce o soukromí) se ještě překládá, delší už ne
    var MAX_TOUCHED = 6000;   // nad tím se seznam profoukne od odpojených uzlů

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'jazyky:' + kde); } catch (x) { } }

    // ---- uložená volba ---------------------------------------------------------
    function stored() { try { return localStorage.getItem(LS) || ''; } catch (e) { return ''; } }
    function store(c) { try { localStorage.setItem(LS, c); } catch (e) { swallow(e, 'store'); } }

    // Bez uložené volby se jazyk odhadne z telefonu. Čeština a slovenština zůstávají
    // česky (Slovák češtině rozumí a geodetické názvosloví je skoro shodné), ostatní
    // dostanou svůj jazyk, a když ho neumíme, angličtinu. Odhad se ULOŽÍ, aby se
    // volba nepřehazovala, kdyby si někdo přehodil jazyk systému.
    function detect() {
        var l = [];
        try {
            l = (navigator.languages && navigator.languages.length) ? navigator.languages.slice()
                : [navigator.language || navigator.userLanguage || ''];
        } catch (e) { swallow(e, 'detect'); }
        for (var i = 0; i < l.length; i++) {
            var c = String(l[i] || '').toLowerCase().slice(0, 2);
            if (c === 'cs' || c === 'sk') return 'cs';
            if (c === 'en' || c === 'de' || c === 'pl') return c;
        }
        return l.length ? 'en' : 'cs';
    }

    // ---- slovník ---------------------------------------------------------------
    function load() {
        if (_raw) return Promise.resolve(_raw);
        if (_loading) return _loading;
        _loading = fetch(URL_DICT)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                _raw = j || null;
                mergeLangs();
                return _raw;
            })
            .catch(function (e) { swallow(e, 'load'); _loading = null; return null; });
        return _loading;
    }

    // Rozšiřující slovník JEDNOHO jazyka. Nikdy nekončí chybou: když se nestáhne
    // (offline, 404), překládá se dál jen z jádra.
    // ⚠ NEÚSPĚCH SE NEPAMATUJE. Nejčastější důvod, proč se rozšíření nestáhne, je
    //   výpadek signálu v terénu — kdyby se zapsalo `null` natrvalo, zůstala by
    //   appka do konce běhu přeložená jen z jádra i poté, co se signál vrátí a
    //   uživatel jazyk přepne znovu. Stahuje se jen při výslovné volbě jazyka
    //   (set/init), takže opakovaný pokus nehrozí, že by se to tahalo dokola.
    function loadExtra(code) {
        if (!code || code === 'cs') return Promise.resolve(null);
        if (Object.prototype.hasOwnProperty.call(_extra, code)) return Promise.resolve(_extra[code]);
        if (_extraLoading[code]) return _extraLoading[code];
        _extraLoading[code] = fetch('./data/jazyky-' + code + '.json')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                _extraLoading[code] = null;
                if (j && j.t && typeof j.t === 'object') { _extra[code] = j.t; return _extra[code]; }
                delete _extra[code];          // prázdná/pokažená odpověď = zkusit příště znovu
                return null;
            })
            .catch(function (e) {
                swallow(e, 'loadExtra');
                delete _extra[code];
                _extraLoading[code] = null;
                return null;
            });
        return _extraLoading[code];
    }

    // Jazyk, který je ve slovníku navíc oproti seznamu výš, se do nabídky doplní —
    // přidat další překlad tak znamená sáhnout jen do data/jazyky.json.
    function mergeLangs() {
        if (!_raw || !_raw.jazyky) return;
        for (var i = 0; i < _raw.jazyky.length; i++) {
            var c = _raw.jazyky[i][0], znam = false;
            for (var k = 0; k < _langs.length; k++) if (_langs[k].c === c) znam = true;
            if (!znam) _langs.push({ c: c, n: _raw.jazyky[i][1] || c });
        }
    }

    // Ze slovníku (klíč → pole překladů) vyrobí plochou tabulku pro JEDEN jazyk.
    // Prázdný nebo chybějící překlad = položka ve slovníku není, text zůstane česky.
    function build(code) {
        _map = null; _re = [];
        if (code === 'cs' || !_raw || !_raw.t) return;
        var order = _raw.poradi || [];
        var ix = order.indexOf(code);
        if (ix < 0) return;
        var m = {}, k;
        for (k in _raw.t) {
            if (!Object.prototype.hasOwnProperty.call(_raw.t, k)) continue;
            var v = _raw.t[k] && _raw.t[k][ix];
            if (v) m[k] = v;
        }
        // Rozšíření se přimíchá až POD jádro: klíč, který už z jádra je, se
        // nepřepisuje (jádro je ručně protříděné, rozšíření vzniklo hromadně).
        var ex = _extra[code];
        if (ex) {
            for (k in ex) {
                if (!Object.prototype.hasOwnProperty.call(ex, k)) continue;
                if (m[k] == null && ex[k]) m[k] = ex[k];
            }
        }
        _map = m;
        var rr = _raw.re || [];
        for (var i = 0; i < rr.length; i++) {
            var rep = rr[i][ix + 1];
            if (!rep) continue;
            try { _re.push({ p: new RegExp(rr[i][0]), r: rep }); } catch (e) { swallow(e, 'build:re'); }
        }
    }

    // Klíč pro hledání: víc bílých znaků za sebou (včetně zalomení a nbsp) na jednu
    // mezeru, okraje pryč. Slovník je psaný v téhle podobě.
    function keyOf(s) { return String(s).replace(/\s+/g, ' ').replace(/^ | $/g, ''); }

    function lookup(src) {
        if (!_map) return null;
        var k = keyOf(src);
        if (!k) return null;
        var v = _map[k];
        if (v != null) return v;
        for (var i = 0; i < _re.length; i++) {
            if (_re[i].p.test(k)) return k.replace(_re[i].p, _re[i].r);
        }
        return null;
    }

    // ---- zápis do DOM ----------------------------------------------------------
    function remember(n, a) {
        if (_touched.length >= MAX_TOUCHED) prune();
        _touched.push({ n: n, a: a || null });
    }
    function prune() {
        var out = [], i, it, el;
        for (i = 0; i < _touched.length; i++) {
            it = _touched[i];
            el = it.n.nodeType === 1 ? it.n : it.n.parentNode;
            if (el && (el.isConnected === undefined || el.isConnected)) out.push(it);
        }
        _touched = out;
    }

    function doText(n) {
        var cur = n.nodeValue;
        if (!cur || cur.length > MAX_LEN || !/\S/.test(cur)) return;
        var box = _seen && _seen.get(n);
        var last = box && box[':t'];
        // Když se obsah liší od toho, co jsme tam napsali, přepsala ho appka —
        // aktuální text je nový zdroj (jinak bychom překládali svůj vlastní překlad).
        var src = (last && cur === last.o) ? last.s : cur;
        var tr = lookup(src);
        var out;
        if (tr == null) {
            if (!last) return;
            out = src;                       // návrat na češtinu / jazyk bez překladu
        } else {
            var head = src.length - src.replace(/^\s+/, '').length;
            var tail = src.replace(/\s+$/, '').length;
            out = src.slice(0, head) + tr + src.slice(tail);
        }
        if (out !== cur) n.nodeValue = out;
        stampCs(n, tr == null ? null : src);
        if (_seen) {
            if (tr == null) { if (box) delete box[':t']; }
            else {
                if (!box) { box = {}; _seen.set(n, box); }
                if (!last) remember(n, null);
                box[':t'] = { s: src, o: out };
            }
        }
    }

    // ⚠ ČESKÝ ORIGINÁL MUSÍ ZŮSTAT ČITELNÝ Z DOM. Některé moduly se řídí VLASTNÍM
    //   vykresleným textem jako identifikátorem — js/nastaveni-poradek.js páruje
    //   sekce Nastavení podle nadpisu (.set-h) a js/field-tools.js podle nadpisu
    //   kategorie v mřížce Nástrojů. Po překladu se přestaly poznávat: pořadač
    //   svou sekci nenašel a při KAŽDÉM srovnání vyrobil další — po minutě jich
    //   v záložce byly desítky. (Naměřeno v prohlížeči, ne odhad.)
    //   Proto se na prvek, jehož celý text je přeložený, zapíše `data-ag-cs`
    //   s původním českým zněním a moduly čtou přednostně jeho.
    //   Atribut se ZÁMĚRNĚ nesleduje observerem (attributeFilter ho nemá), takže
    //   jeho zápis nespustí další kolo překladu.
    function stampCs(n, src) {
        var el = n.parentElement;
        if (!el) return;
        try {
            if (src == null) { if (el.hasAttribute('data-ag-cs')) el.removeAttribute('data-ag-cs'); return; }
            // jen u prvků, jejichž CELÝ obsah je tenhle jeden text — u složeného
            // obsahu by atribut lhal (byl by v něm jen kousek)
            if (el.childNodes.length !== 1) return;
            el.setAttribute('data-ag-cs', keyOf(src));
        } catch (e) { swallow(e, 'stampCs'); }
    }

    function doEl(el) {
        if (!el.getAttribute) return;
        for (var i = 0; i < ATTRS.length; i++) {
            var a = ATTRS[i];
            if (!el.hasAttribute(a)) continue;
            var cur = el.getAttribute(a);
            if (!cur || cur.length > MAX_LEN || !/\S/.test(cur)) continue;
            var box = _seen && _seen.get(el);
            var last = box && box[a];
            var src = (last && cur === last.o) ? last.s : cur;
            var tr = lookup(src);
            var out;
            if (tr == null) { if (!last) continue; out = src; }
            else out = tr;
            if (out !== cur) el.setAttribute(a, out);
            if (_seen) {
                if (tr == null) { if (box) delete box[a]; }
                else {
                    if (!box) { box = {}; _seen.set(el, box); }
                    if (!last) remember(el, a);
                    box[a] = { s: src, o: out };
                }
            }
        }
    }

    function skipEl(el) {
        if (!el || el.nodeType !== 1) return false;
        var t = el.tagName ? String(el.tagName).toUpperCase() : '';
        if (SKIP_TAG[t]) return true;
        if (el.id && SKIP_ID[el.id]) return true;
        if (el.hasAttribute && el.hasAttribute('data-no-i18n')) return true;
        if (el.isContentEditable) return true;
        return false;
    }

    // Projde podstrom. FILTER_REJECT u TreeWalkeru přeskočí i potomky — proto se
    // mapa a AR vrstva neprocházejí vůbec, ne jen jejich kořen.
    function sweep(root) {
        if (!_map || !root) return;
        if (root.nodeType === 3) { _busy = true; try { doText(root); } catch (e) { swallow(e, 'sweep:text'); } _busy = false; return; }
        if (root.nodeType !== 1) return;
        if (skipEl(root)) return;
        _busy = true;
        try {
            doEl(root);
            var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                acceptNode: function (n) {
                    if (n.nodeType === 1) return skipEl(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            var n;
            while ((n = w.nextNode())) {
                if (n.nodeType === 1) doEl(n); else doText(n);
            }
        } catch (e) { swallow(e, 'sweep'); }
        // Vlastní zápisy observeru zahodíme JEŠTĚ PŘED odjištěním — jinak by se
        // překlad vrátil zpátky do fronty a modul by kolem sebe točil donekonečna.
        if (_obs) { try { _obs.takeRecords(); } catch (e) { swallow(e, 'sweep:take'); } }
        _busy = false;
    }

    function flush() {
        _tmr = null;
        var q = _queue; _queue = [];
        if (!_map) return;
        for (var i = 0; i < q.length; i++) {
            var n = q[i];
            var el = n.nodeType === 1 ? n : n.parentNode;
            if (!el || (el.isConnected !== undefined && !el.isConnected)) continue;
            sweep(n);
        }
    }
    function schedule() {
        if (_tmr) return;
        _tmr = setTimeout(flush, 80);
    }

    function startObserver() {
        if (_obs || typeof MutationObserver !== 'function') return;
        _obs = new MutationObserver(function (recs) {
            if (_busy || !_map) return;
            for (var i = 0; i < recs.length; i++) {
                var r = recs[i];
                if (r.type === 'childList') {
                    for (var j = 0; j < r.addedNodes.length; j++) _queue.push(r.addedNodes[j]);
                } else {
                    _queue.push(r.target);
                }
            }
            // Když se toho sype moc (dlouhý seznam bodů), je levnější jeden průchod
            // celým tělem než tisíc malých.
            if (_queue.length > 300) { _queue = [document.body]; }
            schedule();
        });
        try {
            _obs.observe(document.documentElement, {
                childList: true, subtree: true, characterData: true,
                attributes: true, attributeFilter: ATTRS
            });
        } catch (e) { swallow(e, 'observe'); }
    }
    function stopObserver() {
        if (!_obs) return;
        try { _obs.disconnect(); } catch (e) { swallow(e, 'disconnect'); }
        _obs = null;
    }

    // ---- přepnutí --------------------------------------------------------------
    function applyAll() {
        // Nejdřív uzly, do kterých se už sáhlo (překládají se z uloženého ČESKÉHO
        // originálu, ne z předchozího překladu), pak zbytek stromu.
        _busy = true;
        try {
            prune();
            // ⚠ SEZNAM SE TU NESMÍ VYPRÁZDNIT. doText/doEl zapisují do _touched jen
            //   při PRVNÍM doteku uzlu (pozná se podle uloženého originálu) — kdyby
            //   se seznam napřed smazal, po přepnutí jazyka by v něm nic nezůstalo
            //   a další přepnutí (ani návrat na češtinu) by už tyhle uzly nenašlo.
            //   Záznam, který se do slovníku přestal trefovat, tu zůstane jako
            //   prázdný běh navíc; zmizí, až uzel odejde z dokumentu (prune).
            for (var i = 0; i < _touched.length; i++) {
                var it = _touched[i];
                if (it.a) doEl(it.n); else doText(it.n);
            }
        } catch (e) { swallow(e, 'applyAll'); }
        if (_obs) { try { _obs.takeRecords(); } catch (e) { swallow(e, 'applyAll:take'); } }
        _busy = false;
        if (document.body) sweep(document.body);
    }

    function set(code, opts) {
        code = String(code || 'cs');
        var same = (code === _lang);
        _lang = code;
        if (!opts || opts.save !== false) store(code);
        try { document.documentElement.setAttribute('lang', code); } catch (e) { swallow(e, 'set:lang'); }

        if (code === 'cs') {
            build('cs');            // _map = null → dál se nic nepřekládá
            // Návrat originálů se dělá RUČNĚ, ne přes doText/doEl: ty by musely mít
            // slovník, aby se rozhodly, a ten je teď prázdný. Zapisuje se jen tam,
            // kde text pořád sedí na to, co jsme tam napsali — co si mezitím appka
            // přepsala živou hodnotou, se nechá být.
            _busy = true;
            try {
                prune();
                var list = _touched.slice(); _touched = [];
                for (var i = 0; i < list.length; i++) {
                    var it = list[i], box = _seen && _seen.get(it.n);
                    var rec = box && box[it.a || ':t'];
                    if (!rec) continue;
                    if (it.a) { if (it.n.getAttribute(it.a) === rec.o) it.n.setAttribute(it.a, rec.s); }
                    else { if (it.n.nodeValue === rec.o) { it.n.nodeValue = rec.s; stampCs(it.n, null); } }
                    if (box) delete box[it.a || ':t'];
                }
            } catch (e) { swallow(e, 'set:cs'); }
            if (_obs) { try { _obs.takeRecords(); } catch (e) { swallow(e, 'set:take'); } }
            _busy = false;
            stopObserver();
            fire();
            return Promise.resolve(true);
        }

        // Nejdřív jádro, pak rozšíření pro TENHLE jazyk. Rozšíření se čeká
        // schválně: kdyby se překládalo dvakrát (nejdřív z jádra, pak znovu),
        // uživatel by viděl, jak se mu texty pod rukama mění.
        return load().then(function () { return loadExtra(code); }).then(function () {
            // ⚠ ZÁVOD DVOU PŘEPNUTÍ. Rozšíření má každý jazyk vlastní (~490 kB), takže
            //   se stahují nezávisle a rozhoduje, KTERÉ DOBĚHNE POZDĚJI, ne na co se
            //   klikalo naposled. Kroužek na bráně jazyky cykluje jedním ťuknutím —
            //   dvě rychlá ťuknutí rozjedou dvě stahování. Bez téhle pojistky pomalejší
            //   starší volání přepsalo novější: v nastavení i v localStorage byla
            //   němčina, appka byla anglicky. (Než se slovník rozdělil, visela obě
            //   volání na jednom sdíleném `_loading`, takže se to stát nemohlo.)
            if (code !== _lang) return false;
            build(code);
            if (!_map) { fire(); return false; }
            applyAll();
            startObserver();
            fire();
            return true;
        });
        function fire() {
            if (same) return;
            try { window.dispatchEvent(new CustomEvent('ag:jazyk', { detail: { lang: _lang } })); } catch (e) { swallow(e, 'fire'); }
        }
    }

    // ---- volba v Nastavení → Vzhled --------------------------------------------
    // Řádek je ZÁMĚRNĚ první v záložce, nad motivem: kdo appce nerozumí, musí ho
    // najít dřív než cokoli jiného. Skladba prvků (.st-row/.st-lab/.st-sel) je
    // shodná s ostatními řádky Nastavení, aby nevyčníval.
    function injectSettings() {
        var tab = document.getElementById('tab-vzhled');
        if (!tab || document.getElementById('ag-lang-row')) return;
        var row = document.createElement('div');
        row.className = 'st-row';
        row.id = 'ag-lang-row';
        row.setAttribute('data-no-i18n', '');   // názvy jazyků se nepřekládají
        // ⚠ NESMÍ SPADNOUT POD „Zobrazit vše". Krátký pohled v Nastavení
        //   (js/nastaveni-hledani.js) schovává řádky, které nezná — a tenhle
        //   schoval taky. Pro člověka, co neumí česky, je to slepá ulička:
        //   tlačítko, kterým se zbytek odkrývá, je totiž taky česky.
        row.setAttribute('data-ns-keep', '');
        var lab = document.createElement('span');
        lab.className = 'st-lab';
        lab.textContent = 'Jazyk / Language';
        var sel = document.createElement('select');
        sel.className = 'st-sel';
        sel.id = 'ag-lang-sel';
        sel.style.maxWidth = '55%';
        sel.setAttribute('aria-label', 'Jazyk aplikace / App language');
        row.appendChild(lab); row.appendChild(sel);
        // nad první nadpis sekce („Motiv a barvy"), aby byl řádek úplně nahoře
        if (tab.firstChild) tab.insertBefore(row, tab.firstChild); else tab.appendChild(row);
        fillSelect(sel);
        sel.addEventListener('change', function () { set(sel.value); });
    }

    function fillSelect(sel) {
        if (!sel) return;
        var want = _lang, html = '';
        for (var i = 0; i < _langs.length; i++) {
            html += '<option value="' + _langs[i].c + '">' + _langs[i].n + '</option>';
        }
        if (sel.innerHTML !== html) sel.innerHTML = html;
        sel.value = want;
        if (sel.value !== want) sel.value = 'cs';
    }

    // ---- volba na přihlašovací obrazovce ---------------------------------------
    // Kdo neumí česky, nemá jak se do Nastavení dostat — brána i přihlášení jsou
    // první, co uvidí. Proto tam sedí kroužek s kódem jazyka; klepnutí cykluje.
    function injectGate() {
        var host = document.getElementById('ag-gate') || document.getElementById('ag-login');
        if (!host || host.querySelector('.ag-lang-chip')) return;
        injectChipStyles();
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ag-lang-chip';
        b.setAttribute('data-no-i18n', '');
        b.setAttribute('aria-label', 'Jazyk / Language');
        b.textContent = _lang.toUpperCase();
        b.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            var i = 0;
            for (var k = 0; k < _langs.length; k++) if (_langs[k].c === _lang) i = k;
            var next = _langs[(i + 1) % _langs.length].c;
            set(next).then(function () {
                b.textContent = next.toUpperCase();
                fillSelect(document.getElementById('ag-lang-sel'));
            });
        });
        host.appendChild(b);
    }

    function injectChipStyles() {
        if (document.getElementById('ag-lang-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-lang-style';
        st.textContent = [
            '.ag-lang-chip{position:absolute;top:calc(12px + env(safe-area-inset-top,0px));right:14px;z-index:30;',
            '  min-width:42px;padding:7px 10px;border-radius:999px;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.18));background:var(--glass-bg,rgba(255,255,255,0.08));',
            '  color:var(--text-color,#e6e8eb);font:700 12px/1 var(--font-ui,system-ui);letter-spacing:.08em;}',
            '.ag-lang-chip:active{transform:scale(.96);}'
        ].join('');
        document.head.appendChild(st);
    }

    // ---- start -----------------------------------------------------------------
    function init() {
        var c = stored();
        if (!c) { c = detect(); store(c); }
        _lang = c;
        try { document.documentElement.setAttribute('lang', c); } catch (e) { swallow(e, 'init:lang'); }
        if (c !== 'cs') {
            // ⚠ I TADY SE MUSÍ POČKAT NA ROZŠÍŘENÍ (loadExtra), ne jen na jádro.
            // Bez toho se při startu appky přeložilo jen ~700 textů z jádra a
            // zbytek zůstal česky — rozšíření se dotáhlo až při ručním přepnutí
            // jazyka v Nastavení, což nikdo nedělá, když už jazyk uložený má.
            load().then(function () { return loadExtra(c); }).then(function () {
                if (c !== _lang) return;   // uživatel stihl přepnout dřív, než se rozšíření stáhlo (viz set)
                build(c);
                if (!_map) return;
                applyAll();
                startObserver();
                fillSelect(document.getElementById('ag-lang-sel'));
            });
        }
        injectSettings();
        injectGate();
        // Nastavení i přihlašovací obrazovka se za běhu přestavují (oprávnění
        // schovávají části Nastavení, brána se vyrábí až při odhlášení), takže se
        // přítomnost levně překontroluje — stejný postup jako v jiných vrstvách.
        (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
            try { injectSettings(); injectGate(); } catch (e) { swallow(e, 'tick'); }
        }, 4000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGJazyk = {
        get: function () { return _lang; },
        set: set,
        list: function () { return _langs.slice(); },
        // překlad jednoho českého řetězce (pro moduly, které si text staví samy)
        t: function (cs) { var v = lookup(cs); return v == null ? cs : v; },
        // znovu projít strom (po velké přestavbě, kdyby na ni observer nestačil)
        refresh: function () { if (_map && document.body) sweep(document.body); }
    };
})();
