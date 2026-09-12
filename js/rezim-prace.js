// ===== QTRIG — REŽIM PRÁCE NA ÚVODNÍ OBRAZOVCE (ODPOJITELNÁ vrstva) ========
// Neinvazivní vrstva ve stylu js/pokracovat.js: NEEDITUJE logika.js, grafika.js
// ani tools-simple.js — jen si na úvodní obrazovku přidá kartu a přepisuje TÉŽ
// klíče v localStorage, které už čte js/tools-simple.js.
//
// PROČ: v Nástrojích je ~60 dlaždic. Filtr podle „typu práce" v appce už existuje
// (js/tools-simple.js), ale schovaný jako <select> UVNITŘ modálu Nástroje — tedy
// přesně tam, kam se člověk dostane až když se v té mřížce ztratí. Volba přitom
// patří na začátek dne, kdy uživatel ví, co jde dělat.
//
// CO DĚLÁ: na úvodní obrazovce (pod kartou aktivní zakázky) nabídne
// „Jak dnes budeš appku používat?" a volbu z režimů práce. Vybraný režim:
//   • uloží se jako typ práce AKTIVNÍ ZAKÁZKY (klíč agWorkProfile::<pid>, stejný
//     jako v tools-simple.js — obě místa se tedy vidí a nepřetahují se),
//   • zapne jednoduchý panel Nástrojů (agSimpleTools_v1), takže v mřížce zůstanou
//     dopředu vytažené dlaždice pro tuhle práci; zbytek je za „Zobrazit všechny
//     nástroje" a hledání prohledává vždy všechno.
// „Univerzální" filtr vypne a vrátí jednoduchý panel do stavu, v jakém ho
// uživatel měl před prvním použitím téhle karty (pamatuje si ho agRpPrevSimple).
//
// REŽIMY (27.7.2026 rozšířeno z 5 na 11): tabulka MODES níže. Režimy, které už
// zná tools-simple.js (univerzal, pokladka, vytycovani, katastr, kontrola), si
// tam nechávají svůj seznam nástrojů — tenhle modul jim jen dá lepší jméno, popis
// a ikonu a případně DOPLNÍ chybějící nástroje na konec (nikdy nemaže, viz
// mergeProfiles). Nové režimy (podrobne, vysky, zemni, site, dozor, priprava)
// se do tools-simple.js zaregistrují za běhu — proto se tenhle soubor v index.html
// načítá AŽ ZA ním. Bez tools-simple.js karta funguje jako popis (nic se nefiltruje).
//
// PÁS JE JEN PILULKY (11. 9. 2026, hlášení z iPhonu): „tlačítka jsou strašně
// velký, jdou vidět maximálně tak dva … texty okolo zahoďte". Dřív měla každá
// karta ikonu, název, popisek a počet nástrojů (168×123 px → na šířce 390 px se
// vešly DVĚ), pod pásem k tomu věta „co režim udělá" a poznámka o profilu.
// Teď: pilulka ikona + KRÁTKÉ jméno (pole `p`), DVA ŘÁDKY nad sebou v jednom
// vodorovně rolovacím pásu, žádný text pod ním — vybraný režim poznáš jen podle
// zvýrazněné pilulky. Jména nástrojů se ale dál čtou z dlaždic v mřížce Nástrojů
// (tileLabels) — potřebuje je editor vlastního profilu, takže seznam nezastará
// a nenabízí, co uživatel nesmí (data-agucty od ucty.js).
//
// VOLITELNÉ: karta jde odklidit odkazem „Nezobrazovat" (agRpHide) — profil pak
// zůstává, jak je, a vypnout se dá v Nastavení. Zapnout zpátky: Nastavení → Vzhled
// → „Volba profilu práce v Nástrojích". Nic se nikdy nemaže a žádná dlaždice
// nezmizí nevratně.
//
// ZÁMĚRNĚ NEMĚNÍ zobrazení (AR/Split/Mapa), dok ani HUD — o ty se stará
// js/view-cycle.js a stavová bublina; míchat jim do toho by znamenalo dvě místa,
// která si přepisují stejné nastavení.
//
// Odstranění: smaž js/rezim-prace.js + řádek <script> v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agRpInit) return;
    window.__agRpInit = true;

    var STYLE_ID = 'ag-rp-style';
    var PROF_PREFIX = 'agWorkProfile::';    // shodné s js/tools-simple.js
    var SIMPLE_KEY = 'agSimpleTools_v1';    // shodné s js/tools-simple.js
    var HIDE_KEY = 'agRpHide';              // '1' = kartu na úvodu nezobrazovat
    var PREV_KEY = 'agRpPrevSimple';        // stav jednoduchého panelu před 1. volbou

    // Režimy práce. Klíče (id) MUSÍ u prvních pěti zůstat shodné s tools-simple.js,
    // jinak by si obě místa uložila každé něco jiného a už uložená volba by se
    // ztratila. Pořadí pole = pořadí v pásu i v <select>u v Nástrojích.
    //   t  = plné jméno (v <select>u v Nástrojích, v Nastavení, v editoru)
    //   p  = KRÁTKÉ jméno na pilulku v pásu (11. 9. 2026: „Pokládka", ne „Pokládka
    //        za finišerem" — dlouhé jméno roztáhne pilulku a do dvou řádků na
    //        390 px se pak nevejde šest režimů). Chybí-li, vezme se t.
    //        Změřeno na 390 px (Inter 12 px): s „Bez profilu" a „Zemní práce" bylo
    //        vidět 5 celých pilulek, s „Vše" a „Kubatury" 7 — proto ta dvě zkrácení.
    //   s  = krátký popisek (dnes jen v editoru vlastního profilu; na pilulce NENÍ)
    //   d  = co se stane — věta se od 11. 9. 2026 v pásu nevypisuje, drží se pro
    //        veřejné API a případné použití v nápovědě
    //   ic = klíč do ICONS
    //   tools = nástroje, které režim vytáhne dopředu (klíč = data-tool id nebo
    //           název otevírací funkce statické dlaždice — stejné klíčování jako
    //           tools-simple.js / tools-plus.js / nastroje-ukony.js)
    var MODES = [
        // „Bez profilu" = VYPNUTO, ne další režim. Dřív se tahle dlaždice jmenovala
        // „Univerzální" a filtr sice vypnula, ale jednoduchý panel Nástrojů vrátila
        // do stavu PŘED první volbou (agRpPrevSimple) — takže mohl zůstat zapnutý
        // a uživatel neměl jak se dostat ke stavu „nechci žádný profil". Teď je to
        // jednoznačné: vybráním se uložená volba SMAŽE a nic se neschovává.
        {
            id: 'univerzal', ic: 'grid', t: 'Bez profilu', p: 'Vše',
            s: 'Nefiltrovat — všechny nástroje',
            d: 'Žádný profil. V Nástrojích zůstanou všechny dlaždice tak, jak je znáš, a nic se neschovává.',
            tools: []
        },
        {
            id: 'pokladka', ic: 'layers', t: 'Pokládka za finišerem', p: 'Pokládka',
            s: 'Výška a sklon vrstvy roverem',
            d: 'Celý řetěz za finišerem: vytyč, změř hotovou vrstvu, porovnej s projektem a odevzdej '
                + 'protokol. Skladba a odsazení „do tabletu“, přesná výška roverem, závada rovnou k bodu.',
            // ⚠⚠ SHODNÝ SEZNAM MUSÍ BÝT I v js/tools-registry.js (PROFILES, id 'pokladka').
            // mergeProfiles() níž u vestavěných profilů jen PŘIDÁVÁ — co se vyškrtne jen
            // tady, registr vrátí zpátky. Do 5. 9. 2026 tu nebyl ANI JEDEN vytyčovací
            // nástroj, ani „Kontrola vrstvy“, kterou má profil ve vlastním popisu.
            tools: ['openStakeoutModal', 'stakeout-line', 'vrstvy', 'brutal-gps',
                'protokol-vytyceni', 'zavady', 'openMeasureModal', 'ref-calibration', 'korekce',
                'project-import']
        },
        {
            id: 'vytycovani', ic: 'target', t: 'Vytyčování', p: 'Vytyčování',
            s: 'Body, přímky, offsety, AR',
            d: 'Body podle seznamu s odškrtáváním, přímka se staničením a kolmým odstupem, offsety '
                + 'a usazení AR, aby značky seděly na realitu.',
            tools: ['openStakeoutModal', 'stakeout-line', 'protokol-vytyceni', 'offset-point',
                'usadit-ar', 'agOpenCalibrate', 'rajon', 'project-import', 'openMeasureModal']
        },
        {
            id: 'podrobne', ic: 'sketch', t: 'Podrobné měření', p: 'Podrobné měření',
            s: 'Tachymetrie, náčrt, zápisník',
            d: 'Klasické podrobné měření: náčrt s čarami a popisky, zápisník vodorovných směrů '
                + 'a zenitů, nové body rajónem, offsetem nebo protínáním vpřed.',
            tools: ['openTachymetrie', 'zapisnik', 'rajon', 'offset-point', 'ar-intersection',
                'free-station', 'orient-point', 'openMeasureModal']
        },
        {
            id: 'vysky', ic: 'level', t: 'Výšky a nivelace', p: 'Výšky',
            s: 'Nivelace, převýšení, korekce',
            d: 'Výškové práce: nivelační zápisník s uzávěrem, převýšení mezi body, výška objektu '
                + 'a korekce měření (refrakce, teplota, tlak).',
            tools: ['zapisnik', 'openMeasureModal', 'vyska-objektu', 'korekce', 'openDmtVolume', 'epochy']
        },
        {
            id: 'zemni', ic: 'area', t: 'Zemní práce a kubatury', p: 'Kubatury',
            s: 'Kubatury, vrstevnice, plochy',
            d: 'Před hutněním i po něm: model terénu z bodů, vrstevnice a objem výkopu a násypu, '
                + 'plochy a obchůzka staveniště se stopou.',
            tools: ['openDmtVolume', 'startAreaMode', 'track-log', 'brutal-gps', 'vrstvy',
                'openMeasureModal', 'zavady']
        },
        {
            id: 'katastr', ic: 'pin', t: 'Katastr a mapování', p: 'Katastr',
            s: 'Parcely, výměry, mapování',
            d: 'Parcely z ČÚZK stažené do telefonu (fungují offline v mapě i v AR), výměry '
                + 'a dělení pozemku, náčrt a import podkladů.',
            tools: ['openKatastr', 'cadastre-vector', 'parcela', 'startAreaMode', 'openTachymetrie',
                'project-import', 'openMeasureModal', 'cadastre-area']
        },
        {
            id: 'site', ic: 'line', t: 'Podzemní sítě', p: 'Sítě',
            s: 'Vedení v mapě i v AR',
            d: '„Rentgen do země“: trasy vedení v mapě i v AR pod nohama, podklady od správců '
                + '(DXF, plán z vyjádření) a vytyčení trasy před výkopem.',
            tools: ['utility-networks', 'project-import', 'geo-overlay', 'cadastre-vector',
                'openStakeoutModal', 'offset-point', 'zavady']
        },
        {
            id: 'kontrola', ic: 'ruler', t: 'Kontrola a monitoring', p: 'Kontrola',
            s: 'Oměrné, epochy, posuny',
            d: 'Kontrola vlastního i cizího díla: oměrné míry proti souřadnicím, opakované epochy '
                + 'bodu a posuny v čase, kubatury pro ověření.',
            tools: ['openCheckDist', 'epochy', 'zavady', 'openDmtVolume', 'vyska-objektu',
                'track-log', 'zapisnik', 'openMeasureModal']
        },
        {
            id: 'dozor', ic: 'alert', t: 'Dozor a přejímka', p: 'Dozor',
            s: 'Závady, deník, papíry',
            d: 'Papíry z terénu: závada s fotkou vázaná na konkrétní bod, hlasová poznámka '
                + 's georazítkem, deník dne pro kancelář a docházka party.',
            tools: ['zavady', 'protokol-vytyceni', 'denik-dne', 'hlasovky', 'openCheckDist', 'epochy',
                'dochazka', 'zapisnik']
        },
        {
            id: 'priprava', ic: 'folder', t: 'Příprava a kancelář', p: 'Příprava',
            s: 'Brífink, počasí, přenos dat',
            d: 'Ráno v autě a večer po práci: brífink dne, počasí a nejlepší GNSS okno, natažení '
                + 'projektu a přenos zakázky mezi telefony.',
            tools: ['brifink', 'checklist', 'pocasi', 'gnss-forecast', 'project-import',
                'cadastre-area', 'job-transfer', 'denik-dne', 'kniha-jizd']
        }
    ];
    // Ikony beru z <symbol> sady v index.html; kdyby některá chyběla, prostě se nevykreslí.
    var ICONS = {
        grid: '#i-grid', layers: '#i-layers', target: '#i-crosshair', sketch: '#i-edit',
        level: '#i-sliders', area: '#i-area', pin: '#i-map-pin', line: '#i-line',
        ruler: '#i-ruler', alert: '#i-alert', folder: '#i-folder', star: '#i-star'
    };
    // Záložní jména nástrojů pro případ, že mřížka Nástrojů ještě není v DOM
    // (výčet se jinak čte přímo z dlaždic — viz tileLabels).
    var NAMES = {
        'openMeasureModal': 'Měření vzdálenosti', 'startAreaMode': 'Měření plochy',
        'openCheckDist': 'Oměrné / kontrola', 'openDmtVolume': 'Kubatury / vrstevnice',
        'openStakeoutModal': 'Vytyčovací checklist', 'openTachymetrie': 'Náčrt / tachymetrie',
        'openKatastr': 'Katastr (zde stojím)', 'agOpenCalibrate': 'Srovnat sever',
        'vrstvy': 'Vrstvy / pokládka', 'brutal-gps': 'Brutální GPS', 'gps-semafor': 'Skóre místa (GPS)',
        'ref-calibration': 'Posun GPS na známý bod', 'korekce': 'Korekce měření',
        'zavady': 'Závady / hlášení', 'track-log': 'Stopa trasy', 'epochy': 'Epochy / monitoring',
        'zapisnik': 'Zápisníky', 'stakeout-line': 'Vytyčení přímky', 'offset-point': 'Offset bod',
        'protokol-vytyceni': 'Protokol vytyčení',
        'usadit-ar': 'Usadit AR (průvodce)', 'rajon': 'Rajón', 'project-import': 'Import projektu (DXF)',
        'ar-intersection': 'Protínání vpřed', 'free-station': 'Volné stanovisko',
        'orient-point': 'Srovnat sever podle bodu', 'vyska-objektu': 'Výška objektu',
        'cadastre-vector': 'Katastr — parcely', 'cadastre-area': 'Body z výřezu mapy',
        'parcela': 'Parcela / dělení', 'utility-networks': 'Podzemní sítě',
        'geo-overlay': 'Vlastní podklad', 'denik-dne': 'Deník dne', 'hlasovky': 'Hlasové poznámky',
        'dochazka': 'Docházka', 'brifink': 'Dnešek v terénu', 'checklist': 'Co s sebou',
        'pocasi': 'Počasí', 'gnss-forecast': 'GNSS předpověď', 'job-transfer': 'Poslat/načíst zakázku',
        'kniha-jizd': 'Kniha jízd', 'pdr-offset': 'Krokový offset', 'dgps': 'Dvoutelefonní DGPS'
    };

    function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:lsSet'); } }
    // vypnutý profil = klíč NEEXISTUJE (ne uložená hodnota „univerzal"), ať se
    // stav „nechci profil" nedá splést s „vybral jsem si univerzální"
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:lsDel'); } }
    function pid() { return ls('arActiveProjectId') || 'default'; }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    // ---- VLASTNÍ PROFILY -----------------------------------------------------------
    // Uživatelovy vlastní profily žijí v localStorage vedle vestavěných a chovají se
    // úplně stejně (pás na úvodu, <select> v Nástrojích, filtr dlaždic). Ukládá se
    // jen {id,t,s,tools} — popis `d` a ikona se doplní, ať v úložišti neleží text,
    // který by se dal měnit jen ručně.
    var CUST_KEY = 'agRpCustom_v1';
    var CUST_PREFIX = 'vlastni_';
    function customs() {
        var a = null;
        try { a = JSON.parse(ls(CUST_KEY) || '[]'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:customs'); }
        if (Object.prototype.toString.call(a) !== '[object Array]') return [];
        return a.filter(function (c) { return c && c.id && c.t; }).map(function (c) {
            return {
                id: c.id, ic: 'star', t: c.t, s: c.s || 'Vlastní profil',
                d: 'Vlastní profil — vytáhne dopředu nástroje, které sis do něj vybral.',
                tools: Object.prototype.toString.call(c.tools) === '[object Array]' ? c.tools.slice() : [],
                custom: true
            };
        });
    }
    function saveCustoms(list) {
        lsSet(CUST_KEY, JSON.stringify(list.map(function (c) {
            return { id: c.id, t: c.t, s: c.s, tools: c.tools };
        })));
    }
    function isCustom(id) { return String(id || '').indexOf(CUST_PREFIX) === 0; }
    function allModes() { return MODES.concat(customs()); }
    function customSig() { return customs().map(function (c) { return c.id + ':' + c.t + ':' + c.tools.length; }).join(','); }

    function modeById(id) { var a = allModes(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
    function known(id) { return !!modeById(id) || !!(src() && src()[id]); }
    function curMode() { var v = ls(PROF_PREFIX + pid()); return known(v) ? v : 'univerzal'; }
    function hidden() { return ls(HIDE_KEY) === '1'; }
    function simpleOn() { return ls(SIMPLE_KEY) === '1'; }

    // ---- zdroj pravdy o tom, co režim filtruje -------------------------------------
    // Autorita je tools-simple.js (ten mřížku opravdu přerovnává). Tabulka MODES je
    // jen záloha pro případ, že by byl odpojený.
    function src() { try { return (window.AGToolsSimple && window.AGToolsSimple.profiles) || null; } catch (e) { return null; } }
    function toolsOf(id) {
        var p = src();
        if (p && p[id] && Object.prototype.toString.call(p[id].tools) === '[object Array]') return p[id].tools;
        var m = modeById(id);
        return m ? m.tools : [];
    }

    // Zaregistruj nové režimy do tools-simple.js (a doplň chybějící nástroje
    // u těch, které tam už jsou). NIKDY nic neubírá — kdyby někdo seznam
    // v tools-simple.js upravil, jeho pořadí i položky zůstanou platné.
    // mergedSig místo pouhého příznaku: po uložení/smazání vlastního profilu se
    // podpis změní a registrace proběhne znovu (bez toho by nový profil v <select>u
    // v Nástrojích chyběl až do restartu appky).
    var mergedSig = null;
    function mergeProfiles() {
        var sig = customSig();
        if (mergedSig === sig) return true;
        var S = null;
        try { S = window.AGToolsSimple; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:mergeProfiles'); }
        if (!S || !S.profiles || !S.order || !S.order.push) return false;
        // smazané vlastní profily z tools-simple odstranit, jinak by v <select>u
        // strašily napořád (vestavěných se to netýká — ty se nikdy nemažou)
        var live = {};
        customs().forEach(function (c) { live[c.id] = 1; });
        Object.keys(S.profiles).forEach(function (id) {
            if (isCustom(id) && !live[id]) delete S.profiles[id];
        });
        allModes().forEach(function (m) {
            var rec = S.profiles[m.id];
            if (!rec) {
                S.profiles[m.id] = { label: m.t, tools: m.tools.slice() };
            } else if (m.custom) {
                // U VLASTNÍHO profilu je autoritou uživatelův seznam — jinak by se
                // odebraný nástroj nikdy neodebral (dole se jen doplňuje).
                rec.label = m.t; rec.tools = m.tools.slice();
            } else {
                rec.label = m.t;                        // jednotné jméno na kartě i v <select>u
                if (!rec.tools) rec.tools = [];
                m.tools.forEach(function (k) { if (rec.tools.indexOf(k) === -1) rec.tools.push(k); });
            }
        });
        // pořadí v <select>u srovnej podle pásu; co by v MODES nebylo (cizí modul),
        // se přilepí na konec, ať nikdo o svůj profil nepřijde
        var order = allModes().map(function (m) { return m.id; });
        S.order.forEach(function (id) { if (order.indexOf(id) === -1 && S.profiles[id]) order.push(id); });
        S.order.length = 0;
        order.forEach(function (id) { S.order.push(id); });
        mergedSig = sig;
        return true;
    }

    // <select> v Nástrojích si tools-simple.js staví jen jednou. Když se sem
    // dostaneme až po něm (lazy load), doplň chybějící volby.
    function fixSelect() {
        var S = src(); if (!S) return;
        var sel = document.getElementById('ag-ts-profsel');
        if (!sel || document.activeElement === sel) return;
        var order = (window.AGToolsSimple && window.AGToolsSimple.order) || [];
        if (sel.options.length === order.length) return;
        var val = sel.value;
        sel.innerHTML = order.map(function (id) {
            return '<option value="' + esc(id) + '">' + esc((S[id] && S[id].label) || id) + '</option>';
        }).join('');
        sel.value = known(val) ? val : curMode();
    }

    // ---- jména nástrojů z mřížky Nástrojů -------------------------------------------
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool');
        if (dt) return dt;
        var ms = (tile.getAttribute('onclick') || '').match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function tileLabel(tile) {
        var s = tile.querySelector('span');
        var d = document.createElement('div');
        d.innerHTML = ((s ? s.innerHTML : tile.innerHTML) || '').replace(/<br\s*\/?>/gi, ' ');
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    var lblCache = { n: -1, map: null };
    function tileLabels() {
        var m = document.getElementById('tools-modal');
        var grid = m ? m.querySelector('.tool-grid') : null;
        var tiles = grid ? grid.querySelectorAll('.tool-tile') : [];
        if (!tiles.length) return null;                       // mřížka ještě není — jedeme z NAMES
        if (lblCache.map && lblCache.n === tiles.length) return lblCache.map;
        var map = {};
        for (var i = 0; i < tiles.length; i++) {
            var k = tileKey(tiles[i]); if (!k) continue;
            // Oprávnění rolí se v appce vymáhají SKRYTÍM dlaždice (ucty.js zapíše
            // data-agucty). Co uživatel nesmí, to mu tady nebudeme slibovat.
            map[k] = tiles[i].hasAttribute('data-agucty') ? null : tileLabel(tiles[i]);
        }
        lblCache = { n: tiles.length, map: map };
        return map;
    }
    // ---- styly -------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-rp-wrap{margin:0 0 10px;}',               // nad seznamem nástrojů, ne pod kartou zakázky
            '#ag-rp-wrap[hidden]{display:none;}',
            // hlavička co nejnižší: jeden řádek, bez rezervy pod ním
            '#ag-rp-head{display:flex;align-items:baseline;gap:8px;margin:0 0 5px;}',
            '#ag-rp-head .t{font:700 10.5px/1.2 var(--font-ui,system-ui),sans-serif;letter-spacing:.12em;',
            '  text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#ag-rp-head .hint{display:none;font:600 10.5px/1.2 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--accent,#2f9e74);opacity:.9;}',
            '#ag-rp-wrap.scrollable #ag-rp-head .hint{display:inline;}',
            // terč aspoň 28 px na výšku (12. 9. 2026: tlačítko mělo 15 px a prstem se netrefilo)
            '#ag-rp-head .x{margin-left:auto;background:none;border:none;padding:8px 0 8px 10px;margin-top:-8px;margin-bottom:-8px;cursor:pointer;',
            '  color:var(--text-muted,#9aa1ac);font:500 11px/1 var(--font-ui,system-ui),sans-serif;text-decoration:underline;}',
            // pás voleb — vodorovný scroll, ať karta neroste do výšky
            // POZOR (kontrola 27.7., přepsáno 31. 8. 2026 po přesunu do Nástrojů):
            // rolovací tělo modálu má v css/style.css touch-action:pan-y. Prohlížeč
            // PRŮNIKUJE touch-action prvku s předky, takže uvnitř by nešlo posunout
            // prstem VODOROVNĚ vůbec nic — pás režimů by se dal rolovat leda myší
            // a „posuň ›" by lhalo. Povolujeme oba směry na samotném pásu, ne na celém
            // modálu: svislé rolování dlouhého seznamu nástrojů tím zůstane nedotčené.
            '#ag-rp-list{touch-action:pan-x pan-y;}',
            '#ag-rp-strip{position:relative;}',
            // DVA ŘÁDKY PILULEK v jednom rolovacím pásu (11. 9. 2026). Ne CSS grid
            // s grid-auto-flow:column: tam má sloupec šířku své NEJŠIRŠÍ pilulky, takže
            // „Výšky" pod „Podrobné měření" zabírá stejně místa jako ono a na 390 px
            // se vešly jen čtyři režimy. Dva nezávislé flex řádky (.ag-rp-row, pilulky
            // se do nich sypou střídavě) se zhušťují každý zvlášť — vidět je jich šest
            // a víc. Rolují spolu, protože roluje jejich společný rodič.
            '#ag-rp-list{overflow-x:auto;padding:2px 2px 4px;-webkit-overflow-scrolling:touch;}',
            '#ag-rp-list::-webkit-scrollbar{height:0;}',
            '.ag-rp-row{display:flex;gap:5px;width:max-content;min-width:100%;}',
            '.ag-rp-row + .ag-rp-row{margin-top:5px;}',
            // náznak, že se dá rolovat: okraj pásu se vytrácí (maska funguje na
            // libovolném pozadí, gradient v barvě by se s motivem rozešel)
            '#ag-rp-strip.sr:not(.sl) #ag-rp-list{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 34px),transparent);',
            '  mask-image:linear-gradient(90deg,#000 calc(100% - 34px),transparent);}',
            '#ag-rp-strip.sl:not(.sr) #ag-rp-list{-webkit-mask-image:linear-gradient(90deg,transparent,#000 34px);',
            '  mask-image:linear-gradient(90deg,transparent,#000 34px);}',
            '#ag-rp-strip.sl.sr #ag-rp-list{-webkit-mask-image:linear-gradient(90deg,transparent,#000 34px,#000 calc(100% - 34px),transparent);',
            '  mask-image:linear-gradient(90deg,transparent,#000 34px,#000 calc(100% - 34px),transparent);}',
            // pilulka: ikona + krátké jméno na jednom řádku, nic víc; min-height 34 px
            // je spodní mez pro prst (dvě pilulky nad sebou = 74 px, míň než jedna
            // stará karta)
            '#ag-rp-list button{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;',
            '  min-height:34px;padding:5px 10px 5px 8px;white-space:nowrap;border-radius:999px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:rgba(255,255,255,0.04);color:var(--text-color,#eceef2);cursor:pointer;text-align:left;}',
            '#ag-rp-list button .icon{flex:0 0 auto;width:14px;height:14px;color:var(--accent-bright,#3eb487);}',
            '#ag-rp-list button b{font:600 12px/1.2 var(--font-ui,system-ui),sans-serif;}',
            '#ag-rp-list button.on{border-color:var(--accent,#2f9e74);',
            '  background:var(--accent-soft,rgba(47,158,116,0.16));box-shadow:0 0 0 1px var(--accent,#2f9e74) inset;}',
            '#ag-rp-list button.on b{color:var(--accent,#2f9e74);font-weight:700;}',
            '#ag-rp-list button:active{transform:scale(0.97);}',
            // režim levé ruky: odkládací odkaz pod palec vlevo (ovládání se zrcadlí)
            'body.left-hand #ag-rp-head .x{order:-1;margin-left:0;margin-right:auto;}',
            'body.ag-glove #ag-rp-list button{min-height:40px;padding:8px 13px 8px 11px;}',
            'body.ag-glove #ag-rp-list button b{font-size:calc(13.5px * var(--ag-font-scale, 1));}',

            // ---- pilulka „Vlastní profil" (založení) ----
            '#ag-rp-list button.add{border-style:dashed;}',
            '#ag-rp-list button.add b,#ag-rp-list button.add .icon{color:var(--accent,#2f9e74);}',
            // tužka uvnitř pilulky VLASTNÍHO profilu = „upravit" (dřív odkaz pod
            // výčtem, který je zrušený). <span role=button> místo <button>: tlačítko
            // v tlačítku HTML nedovolí. Klik na ni pilulku nepřepíná (viz posluchač).
            '#ag-rp-list button .ed{display:inline-flex;align-items:center;justify-content:center;',
            '  width:22px;height:22px;margin:-3px -5px -3px 0;border-radius:999px;color:var(--text-muted,#9aa1ac);}',
            '#ag-rp-list button .ed .icon{width:12px;height:12px;color:inherit;}',
            // terč pro prst: tužka je vidět 22 px, ale chytá celou výšku pilulky (34 px)
            // — na 22 px se trefí málokdo a místo úpravy jen přepne profil
            '#ag-rp-list button .ed{position:relative;}',
            '#ag-rp-list button .ed::before{content:"";position:absolute;left:50%;top:50%;width:34px;height:34px;transform:translate(-50%,-50%);}',
            '#ag-rp-list button.on .ed{color:var(--accent,#2f9e74);background:rgba(255,255,255,0.08);}',

            // ---- editor vlastního profilu ----
            // z-index nad úvodní obrazovkou (999999), ale POD dialogy (--z-dialog
            // 2000000), ať potvrzení smazání zůstane navrchu
            '#ag-rpx{position:fixed;inset:0;z-index:1000003;display:none;align-items:center;justify-content:center;',
            '  padding:16px;background:rgba(4,8,12,0.66);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);}',
            '#ag-rpx.on{display:flex;}',
            '#ag-rpx .ag-rpx-box{width:min(420px,100%);max-height:88vh;overflow-y:auto;box-sizing:border-box;padding:18px;',
            '  border-radius:18px;background:var(--bg-elev,#151a21);border:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  box-shadow:0 24px 60px rgba(0,0,0,0.55);color:var(--text-color,#eceef2);}',
            '#ag-rpx h3{margin:0 0 12px;font:700 17px/1.2 var(--font-ui,system-ui),sans-serif;color:var(--accent,#2f9e74);}',
            '#ag-rpx label{display:block;margin:10px 0 4px;font:600 12px/1.2 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '#ag-rpx input[type=text]{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.06);',
            '  color:var(--text-color,#eceef2);font:inherit;font-size:calc(15px * var(--ag-font-scale, 1));}',
            '.ag-rpx-lab{margin:14px 0 6px;font:600 12px/1.2 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '.ag-rpx-lab span{color:var(--accent,#2f9e74);}',
            '#ag-rpx-tools{display:flex;flex-wrap:wrap;gap:6px;max-height:38vh;overflow-y:auto;padding:2px;',
            '  -webkit-overflow-scrolling:touch;}',
            '#ag-rpx-tools button{padding:8px 11px;border-radius:999px;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.05);',
            '  color:var(--text-muted,#9aa1ac);font:600 12.5px/1.15 var(--font-ui,system-ui),sans-serif;}',
            '#ag-rpx-tools button.on{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.16));',
            '  color:var(--accent-bright,#4ccd99);}',
            '.ag-rpx-empty{color:var(--text-muted,#9aa1ac);font-size:calc(12.5px * var(--ag-font-scale, 1));}',
            '.ag-rpx-err{min-height:16px;margin-top:8px;color:var(--danger,#ef4444);',
            '  font:600 12px/1.3 var(--font-ui,system-ui),sans-serif;}',
            '.ag-rpx-btns{display:flex;gap:8px;margin-top:12px;}',
            '.ag-rpx-btns button{flex:1;padding:12px;border-radius:12px;cursor:pointer;font:700 13.5px/1 var(--font-ui,system-ui),sans-serif;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.06);color:var(--text-color,#eceef2);}',
            '.ag-rpx-btns button.prim{border-color:transparent;background:var(--accent-grad,#2f9e74);color:#fff;}',
            '.ag-rpx-btns button.del{flex:0 0 auto;padding:12px 14px;color:var(--danger,#ef4444);}',
            'body.ag-glove #ag-rpx-tools button{padding:11px 14px;font-size:calc(13.5px * var(--ag-font-scale, 1));}',
            // tlačítko „Nepoužívat žádný profil" v popisku řádku v Nastavení
            '#ag-rp-setoff{display:inline-block;margin-top:5px;background:none;border:none;padding:0;cursor:pointer;',
            '  color:var(--accent,#2f9e74);font:600 11.5px/1.2 var(--font-ui,system-ui),sans-serif;text-decoration:underline;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- EDITOR VLASTNÍHO PROFILU --------------------------------------------------
    // Seznam nástrojů se NEPÍŠE ručně: bere se z dlaždic v mřížce Nástrojů (stejně
    // jako výčet pod pásem), takže obsahuje i nástroje z modulů a nikdy nezastará.
    // Co uživatel nesmí (role, data-agucty) ani co je odpojené, se nenabízí.
    function pickableTools() {
        var map = tileLabels(), out = [], k;
        if (map) {
            for (k in map) if (map[k]) out.push({ k: k, t: map[k] });
        } else {
            for (k in NAMES) out.push({ k: k, t: NAMES[k] });
        }
        out.sort(function (a, b) { return a.t.localeCompare(b.t, 'cs'); });
        return out;
    }
    function editorEl() {
        var el = document.getElementById('ag-rpx');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'ag-rpx';
        el.innerHTML =
            '<div class="ag-rpx-box" role="dialog" aria-modal="true" aria-label="Vlastní profil">'
            + '<h3 id="ag-rpx-h">Vlastní profil</h3>'
            + '<label for="ag-rpx-name">Název</label>'
            + '<input type="text" id="ag-rpx-name" maxlength="28" placeholder="Např. Moje pokládka" autocomplete="off">'
            + '<label for="ag-rpx-sub">Krátký popisek — volitelné</label>'
            + '<input type="text" id="ag-rpx-sub" maxlength="40" placeholder="Např. co v něm mám" autocomplete="off">'
            + '<div class="ag-rpx-lab">Nástroje, které se vytáhnou dopředu <span id="ag-rpx-cnt"></span></div>'
            + '<div id="ag-rpx-tools"></div>'
            + '<div class="ag-rpx-err" id="ag-rpx-err"></div>'
            + '<div class="ag-rpx-btns">'
            + '  <button type="button" class="del" id="ag-rpx-del">Smazat</button>'
            + '  <button type="button" id="ag-rpx-cancel">Zrušit</button>'
            + '  <button type="button" class="prim" id="ag-rpx-save">Uložit</button>'
            + '</div></div>';
        document.body.appendChild(el);
        el.addEventListener('click', function (ev) { if (ev.target === el) closeEditor(); });
        el.querySelector('#ag-rpx-cancel').addEventListener('click', closeEditor);
        el.querySelector('#ag-rpx-tools').addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('button[data-k]') : null;
            if (!b) return;
            b.classList.toggle('on');
            b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false');
            countSel();
        });
        el.querySelector('#ag-rpx-save').addEventListener('click', saveEditor);
        el.querySelector('#ag-rpx-del').addEventListener('click', deleteEditor);
        return el;
    }
    function countSel() {
        var el = document.getElementById('ag-rpx'); if (!el) return 0;
        var n = el.querySelectorAll('#ag-rpx-tools button.on').length;
        var c = el.querySelector('#ag-rpx-cnt');
        if (c) c.textContent = n ? '· vybráno ' + n : '';
        return n;
    }
    var _editId = null;
    function openEditor(id) {
        injectStyles();
        var el = editorEl();
        var rec = id ? modeById(id) : null;
        _editId = (rec && rec.custom) ? id : null;
        el.querySelector('#ag-rpx-h').textContent = _editId ? 'Upravit profil' : 'Nový vlastní profil';
        el.querySelector('#ag-rpx-name').value = _editId ? rec.t : '';
        el.querySelector('#ag-rpx-sub').value = (_editId && rec.s !== 'Vlastní profil') ? rec.s : '';
        el.querySelector('#ag-rpx-err').textContent = '';
        el.querySelector('#ag-rpx-del').style.display = _editId ? '' : 'none';
        var sel = {};
        if (_editId) rec.tools.forEach(function (k) { sel[k] = 1; });
        el.querySelector('#ag-rpx-tools').innerHTML = pickableTools().map(function (t) {
            return '<button type="button" data-k="' + esc(t.k) + '"' + (sel[t.k] ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"')
                + '>' + esc(t.t) + '</button>';
        }).join('') || '<p class="ag-rpx-empty">Mřížka Nástrojů se ještě nenačetla. Otevři jednou Nástroje a zkus to znovu.</p>';
        countSel();
        el.classList.add('on');
        setTimeout(function () { try { el.querySelector('#ag-rpx-name').focus(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:openEditor'); } }, 60);
    }
    function closeEditor() {
        var el = document.getElementById('ag-rpx');
        if (el) el.classList.remove('on');
        _editId = null;
    }
    function saveEditor() {
        var el = document.getElementById('ag-rpx'); if (!el) return;
        var name = (el.querySelector('#ag-rpx-name').value || '').trim();
        var sub = (el.querySelector('#ag-rpx-sub').value || '').trim();
        var err = el.querySelector('#ag-rpx-err');
        if (!name) { err.textContent = 'Napiš název profilu.'; return; }
        var tools = [], on = el.querySelectorAll('#ag-rpx-tools button.on');
        for (var j = 0; j < on.length; j++) tools.push(on[j].getAttribute('data-k'));
        if (!tools.length) { err.textContent = 'Vyber aspoň jeden nástroj — jinak by profil nic nedělal.'; return; }
        var list = customs();
        var id = _editId;
        if (id) {
            for (var i = 0; i < list.length; i++) if (list[i].id === id) { list[i].t = name; list[i].s = sub || 'Vlastní profil'; list[i].tools = tools; }
        } else {
            id = CUST_PREFIX + Date.now();
            list.push({ id: id, t: name, s: sub || 'Vlastní profil', tools: tools });
        }
        saveCustoms(list);
        closeEditor();
        mergeProfiles();
        pick(id);                                  // nově uložený profil rovnou zapni
        try { if (typeof window.quickToast === 'function') window.quickToast('Profil „' + name + '" uložen a zapnut.'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:saveEditor'); }
    }
    function deleteEditor() {
        var id = _editId; if (!id) return;
        var rec = modeById(id);
        var go = function () {
            saveCustoms(customs().filter(function (c) { return c.id !== id; }));
            // smazaný profil nesmí zůstat zapnutý -> spadni na „bez profilu"
            if (curMode() === id) { lsDel(PROF_PREFIX + pid()); lsSet(SIMPLE_KEY, '0'); }
            closeEditor();
            mergeProfiles();
            render();
            syncSettingRow();
            try { if (window.AGToolsSimple && typeof window.AGToolsSimple.sync === 'function') window.AGToolsSimple.sync(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:go'); }
        };
        var q = 'Smazat profil „' + (rec ? rec.t : '') + '"? Nástroje ani body se nemažou, jen tenhle výběr.';
        // agGuard = „zeptej se a teprve pak to udělej" (in-app dialog je asynchronní,
        // takže `if (!confirm())` by tu nefungovalo); bez můstku spadne na confirm()
        try {
            if (typeof window.agGuard === 'function') { window.agGuard(q, go, { title: 'Smazat profil', danger: true }); return; }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:go'); }
        if (window.confirm(q)) go();
    }

    // ---- volba režimu ------------------------------------------------------------
    function pick(id) {
        if (!known(id)) return;
        // Stav jednoduchého panelu před prvním zásahem si pamatuj, ať se dá vrátit.
        if (ls(PREV_KEY) == null) lsSet(PREV_KEY, simpleOn() ? '1' : '0');
        if (id === 'univerzal') {
            // VYPNUTÍ PROFILU: uloženou volbu SMAZAT (ne uložit „univerzal") a
            // jednoduchý panel vypnout natvrdo. Dřív se panel vracel do stavu před
            // první volbou, takže „vypnout" nemuselo doopravdy vypnout nic.
            lsDel(PROF_PREFIX + pid());
            lsSet(SIMPLE_KEY, '0');
        } else {
            lsSet(PROF_PREFIX + pid(), id);
            lsSet(SIMPLE_KEY, '1');
        }
        render();
        syncSettingRow();
        // tools-simple.js se sám dorovná svým tickem; když je po ruce, ať to je hned
        try { if (window.AGToolsSimple && typeof window.AGToolsSimple.sync === 'function') window.AGToolsSimple.sync(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:pick'); }
    }

    // ---- vykreslení do úvodní obrazovky -------------------------------------------
    // ⚠⚠ 31. 8. 2026 — KARTA BYDLELA NA ÚVODNÍ OBRAZOVCE A TA JE ZRUŠENÁ.
    // Byla to JEDINÁ cesta, jak profil práce přepnout: select „Typ práce" nad mřížkou
    // Nástrojů byl dřív odstraněn PRÁVĚ PROTO, že tuhle kartu člověk viděl dřív
    // (viz komentář v js/tools-simple.js). Bez náhrady by se profil nedal změnit
    // vůbec — jen vypnout v Nastavení → Vzhled — a kdo měl zapnutou třeba
    // „Pokládku", zůstal by v zúžených Nástrojích natrvalo.
    // Karta se proto přestěhovala NA ZAČÁTEK SEZNAMU NÁSTROJŮ, tedy přesně tam,
    // kde se volba projeví. Zůstává odklizitelná („Nezobrazovat", agRpHide)
    // a Nastavení → Vzhled ji vrátí.
    function ensureWrap() {
        var w = document.getElementById('ag-rp-wrap');
        if (w) return w;
        var m = document.getElementById('tools-modal');
        var content = m ? m.querySelector('.modal-content') : null;
        if (!content) return null;
        // kotva = seznam sloves (js/nastroje-ukony.js), jinak původní mřížka dlaždic
        var row = content.querySelector('#ag-uk-list') || content.querySelector('.tool-grid');
        if (!row) return null;
        w = document.createElement('div');
        w.id = 'ag-rp-wrap';
        w.innerHTML =
            '<div id="ag-rp-head"><span class="t">Co dnes děláš</span>'
            + '<span class="hint">posuň ›</span>'
            + '<button type="button" class="x" id="ag-rp-hide">Nezobrazovat</button></div>'
            + '<div id="ag-rp-strip"><div id="ag-rp-list" role="group" aria-label="Režim práce"></div></div>';
        // ⚠ Pod pásem už NIC není (11. 9. 2026): #ag-rp-detail („co režim udělá",
        // „Vytáhne dopředu N nástrojů") i #ag-rp-note („Žádný profil se nepoužívá…")
        // uživatel označil za zbytečné — braly místo dlaždicím pod nimi.
        // NAD seznam nástrojů: volba se vztahuje k tomu, co je pod ní.
        // ⚠ VKLÁDÁ SE PŘES SKUTEČNÉHO RODIČE KOTVY, ne přes .modal-content: seznam
        // sloves si js/nastroje-ukony.js vkládá vedle mřížky, tedy o úroveň hlouběji.
        // `content.insertBefore(w, row)` by hodilo NotFoundError („node is not a child
        // of this node") — přesně na tomhle spadla 8. 8. tlačítka zpravodaje a předpisů
        // na úvodní obrazovce, viz js/zpravodaj.js.
        if (!row.parentNode) return null;
        row.parentNode.insertBefore(w, row);
        w.querySelector('#ag-rp-hide').addEventListener('click', function () {
            lsSet(HIDE_KEY, '1');
            render();
            try { if (typeof window.quickToast === 'function') window.quickToast('Volbu režimu vrátíš v Nastavení → Vzhled'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:ensureWrap'); }
        });
        var list = w.querySelector('#ag-rp-list');
        list.addEventListener('click', function (ev) {
            if (!ev.target.closest) return;
            // tužka uvnitř pilulky vlastního profilu: jen otevřít editor, NEpřepínat
            var e2 = ev.target.closest('[data-edit]');
            if (e2) { ev.preventDefault(); openEditor(e2.getAttribute('data-edit')); return; }
            if (ev.target.closest('button[data-add]')) { openEditor(null); return; }
            var b = ev.target.closest('button[data-mode]');
            if (b) pick(b.getAttribute('data-mode'));
        });
        // tužka je <span tabindex=0>, ne <button>: Enter/mezerník na ní klik nevyvolá,
        // kdo jde klávesnicí (čtečka, bluetooth klávesnice), by editor neotevřel
        list.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            var e2 = ev.target && ev.target.closest ? ev.target.closest('[data-edit]') : null;
            if (e2) { ev.preventDefault(); ev.stopPropagation(); openEditor(e2.getAttribute('data-edit')); }
        });
        list.addEventListener('scroll', edgeHints, { passive: true });
        return w;
    }

    // náznak rolování: podle toho, kolik pásu zbývá vlevo/vpravo
    function edgeHints() {
        var strip = document.getElementById('ag-rp-strip');
        var list = document.getElementById('ag-rp-list');
        var wrap = document.getElementById('ag-rp-wrap');
        if (!strip || !list || !wrap) return;
        var max = list.scrollWidth - list.clientWidth;
        strip.classList.toggle('sl', max > 6 && list.scrollLeft > 6);
        strip.classList.toggle('sr', max > 6 && list.scrollLeft < max - 6);
        wrap.classList.toggle('scrollable', max > 6);
    }
    // aktivní kartu ukaž — po přidání režimů může být daleko vpravo
    var needScroll = true;
    function scrollToActive(list) {
        if (!needScroll) return;
        var b = list.querySelector('button.on');
        if (!b || !list.clientWidth) return;                  // schovaná karta má šířku 0 — zkusíme příště
        var max = list.scrollWidth - list.clientWidth;
        var target = b.offsetLeft - (list.clientWidth - b.offsetWidth) / 2;
        if (target > max) target = max;
        if (target < 0) target = 0;
        needScroll = false;
        if (Math.abs(list.scrollLeft - target) < 4) { edgeHints(); return; }
        try { list.scrollTo({ left: target, behavior: 'smooth' }); }
        catch (e) { list.scrollLeft = target; }
        setTimeout(edgeHints, 260);
    }

    function render() {
        injectStyles();
        mergeProfiles();
        var w = ensureWrap();
        if (!w) return;
        if (hidden()) { w.hidden = true; return; }
        w.hidden = false;
        var cur = curMode();
        var list = w.querySelector('#ag-rp-list');
        // Překresluj jen při skutečné změně — tick běží každou 1,5 s a překreslování
        // pásu naprázdno by stálo baterii. Podpis = volba + vlastní profily
        // (po uložení/smazání vlastního profilu se musí pás přeskládat).
        var csig = customSig();
        if (list.getAttribute('data-cur') !== cur + '|' + csig) {
            list.setAttribute('data-cur', cur + '|' + csig);
            var pills = allModes().map(function (m) {
                // title = plné jméno; na pilulce je krátké (p), ať se jich vejde víc
                return '<button type="button" data-mode="' + m.id + '" title="' + esc(m.t) + '"'
                    + (m.id === cur ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>'
                    + '<svg class="icon"><use href="' + (ICONS[m.ic] || '#i-grid') + '"/></svg>'
                    + '<b>' + esc(m.p || m.t) + '</b>'
                    // vlastní profil jde doladit tužkou přímo v pilulce (vestavěné se needitují)
                    + (m.custom ? '<span class="ed" role="button" tabindex="0" data-edit="' + esc(m.id) + '" aria-label="Upravit profil ' + esc(m.t) + '">'
                        + '<svg class="icon"><use href="#i-edit"/></svg></span>' : '')
                    + '</button>';
            });
            // poslední pilulka: založení vlastního profilu
            pills.push('<button type="button" class="add" data-add="1" aria-label="Vytvořit vlastní profil">'
                + '<svg class="icon"><use href="#i-plus"/></svg><b>Vlastní</b></button>');
            // střídavě do dvou řádků (sudé nahoru, liché dolů) — pořadí čtení zleva
            // doprava po sloupcích zůstává pořadím MODES
            var rows = ['', ''];
            pills.forEach(function (h, i) { rows[i % 2] += h; });
            list.innerHTML = '<div class="ag-rp-row">' + rows[0] + '</div><div class="ag-rp-row">' + rows[1] + '</div>';
            needScroll = true;
        }
        scrollToActive(list);
        edgeHints();
    }

    // ---- přepínač v Nastavení → Vzhled (cesta zpět, když si kartu uklidí) ----------
    function injectSettingRow() {
        if (document.getElementById('ag-rp-setrow')) return;
        var d = document.createElement('div');
        d.className = 'st-row'; d.id = 'ag-rp-setrow';
        // NOVĚ (návrh C): patří do záložky „Profily" vedle profilu nastavení, ať jsou
        // obě podobně pojmenované věci na jednom místě a je vidět, čím se liší.
        // Starší index.html bez té záložky: spadneme na původní kotvu ve Vzhledu
        // (řádek jednoduchého panelu z tools-simple.js, jinak režim levé ruky).
        var host = document.getElementById('tab-profily'), after = null;
        if (!host) {
            var anchor = document.getElementById('ag-ts-setrow') || document.getElementById('s-lefthand');
            var row = (anchor && anchor.classList && anchor.classList.contains('st-row'))
                ? anchor : (anchor && anchor.closest ? anchor.closest('.st-row') : null);
            if (!row || !row.parentNode) return;
            host = row.parentNode; after = row.nextSibling;
        }
        d.innerHTML = '<span class="st-lab">Volba profilu práce v Nástrojích<small id="ag-rp-setnote">nahoře v Nástrojích vybereš, co dnes děláš, a seznam se podle toho zúží</small></span>'
            + '<label class="st-sw"><input type="checkbox" id="ag-rp-sw"><span class="st-sw-face"></span></label>';
        if (after) host.insertBefore(d, after); else host.appendChild(d);
        var cb = d.querySelector('#ag-rp-sw');
        cb.checked = !hidden();
        cb.addEventListener('change', function () { lsSet(HIDE_KEY, cb.checked ? '0' : '1'); render(); syncSettingRow(); });
        // PAST, KTEROU TO ZAVÍRÁ: kdo si kartu na úvodu odklidil („Nezobrazovat")
        // se zapnutým profilem, neměl kde ho vypnout — Nástroje mu zůstaly zúžené
        // a nebylo poznat proč. Proto se tady píše, který profil právě platí, a je
        // u toho tlačítko, kterým se vypne.
        d.addEventListener('click', function (ev) {
            if (!ev.target.closest || !ev.target.closest('#ag-rp-setoff')) return;
            pick('univerzal');
            try { if (typeof window.quickToast === 'function') window.quickToast('Profil vypnut — v Nástrojích jsou zase všechny dlaždice.'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:injectSettingRow'); }
        });
        syncSettingRow();
    }
    // popisek u přepínače v Nastavení: co teď platí + cesta, jak to vypnout
    function syncSettingRow() {
        var note = document.getElementById('ag-rp-setnote');
        if (!note) return;
        var cur = curMode();
        var m = modeById(cur);
        var html;
        if (cur === 'univerzal' || !m) {
            html = 'nahoře v Nástrojích vybereš, co dnes děláš, a seznam se podle toho zúží. '
                + 'Teď <b>žádný profil neběží</b> — v Nástrojích jsou všechny dlaždice.';
        } else {
            html = 'Právě běží profil <b>' + esc(m.t) + '</b>, takže Nástroje ukazují hlavně jeho dlaždice. '
                + '<button type="button" id="ag-rp-setoff">Nepoužívat žádný profil</button>';
        }
        if (note.innerHTML !== html) note.innerHTML = html;
    }

    // ---- init ---------------------------------------------------------------------
    function tick() {
        try {
            mergeProfiles();
            injectSettingRow();
            fixSelect();
            var cb = document.getElementById('ag-rp-sw');
            if (cb && cb.checked === hidden()) cb.checked = !hidden();
            syncSettingRow();
            // Když je modál Nástrojů zavřený, nemá smysl číst mřížku a přepočítávat
            // výčet — šetříme baterii (viz js/power-save.js).
            var w = document.getElementById('ag-rp-wrap');
            if (w && w.offsetParent === null && !w.hidden) return;
            render();
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'rezim-prace:tick'); }
    }
    function init() {
        tick();
        // Úvodní obrazovka se překresluje při změně zakázky (renderProjectSelect) —
        // sdílený UI časovač appky stačí, vlastní observer by byl navíc kvůli baterii.
        if (!window.__agRpTimer) {
            window.__agRpTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(tick, 1500);
        }
    }
    // Režimy zaregistruj hned při načtení skriptu — tools-simple.js si <select>
    // staví až na DOMContentLoaded, takže nové volby stihne pobrat sám.
    mergeProfiles();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });

    // veřejné API (hledání funkcí appky / jiné moduly)
    window.AGRezimPrace = { set: pick, get: curMode, render: render, modes: MODES, tools: toolsOf };
})();
