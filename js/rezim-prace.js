// ===== AR Geodet — REŽIM PRÁCE NA ÚVODNÍ OBRAZOVCE (ODPOJITELNÁ vrstva) ========
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
// VÝČET NÁSTROJŮ pod pásem se NEPÍŠE ručně: bere se z toho, co režim opravdu
// filtruje (window.AGToolsSimple.profiles), a jména se čtou z dlaždic v mřížce
// Nástrojů. Když nástroj někdo odpojí (smaže <script>), zmizí i z výčtu — text
// tedy nemůže zastarat. Dlaždice schované oprávněním role (ucty.js dává
// data-agucty) se do výčtu záměrně nepočítají, ať se nenabízí, co uživatel nesmí.
//
// VOLITELNÉ: karta jde odklidit odkazem „Nezobrazovat" (agRpHide) — pak se volba
// dělá dál jen v Nástrojích. Zapnout zpátky: Nastavení → Vzhled → „Volba režimu
// práce na úvodu". Nic se nikdy nemaže a žádná dlaždice nezmizí nevratně.
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
    //   t  = jméno na kartě (a v <select>u v Nástrojích)
    //   s  = krátký popisek na kartu (jeden řádek, ať pás zůstane nízký)
    //   d  = co se stane — věta pod pásem u zvoleného režimu
    //   ic = klíč do ICONS
    //   tools = nástroje, které režim vytáhne dopředu (klíč = data-tool id nebo
    //           název otevírací funkce statické dlaždice — stejné klíčování jako
    //           tools-simple.js / tools-plus.js / nastroje-ukony.js)
    var MODES = [
        {
            id: 'univerzal', ic: 'grid', t: 'Univerzální',
            s: 'Bez filtru — všechny dlaždice',
            d: 'Žádný filtr. V Nástrojích zůstanou všechny dlaždice tak, jak je znáš.',
            tools: []
        },
        {
            id: 'pokladka', ic: 'layers', t: 'Pokládka za finišerem',
            s: 'Výška a sklon vrstvy roverem',
            d: 'Kontrola vrstvy za finišerem: skladba a odsazení „do tabletu“, přesná výška roverem, '
                + 'kontrolní míry proti projektu a závada zapsaná rovnou k bodu.',
            tools: ['vrstvy', 'brutal-gps', 'gps-semafor', 'openCheckDist', 'track-log', 'zavady',
                'epochy', 'openMeasureModal', 'ref-calibration', 'korekce']
        },
        {
            id: 'vytycovani', ic: 'target', t: 'Vytyčování',
            s: 'Body, přímky, offsety, AR',
            d: 'Body podle seznamu s odškrtáváním, přímka se staničením a kolmým odstupem, offsety '
                + 'a usazení AR, aby značky seděly na realitu.',
            tools: ['openStakeoutModal', 'stakeout-line', 'offset-point', 'usadit-ar', 'agOpenCalibrate',
                'rajon', 'project-import', 'openMeasureModal']
        },
        {
            id: 'podrobne', ic: 'sketch', t: 'Podrobné měření',
            s: 'Tachymetrie, náčrt, zápisník',
            d: 'Klasické podrobné měření: náčrt s čarami a popisky, zápisník vodorovných směrů '
                + 'a zenitů, nové body rajónem, offsetem nebo protínáním vpřed.',
            tools: ['openTachymetrie', 'zapisnik', 'rajon', 'offset-point', 'ar-intersection',
                'free-station', 'orient-point', 'openMeasureModal']
        },
        {
            id: 'vysky', ic: 'level', t: 'Výšky a nivelace',
            s: 'Nivelace, převýšení, korekce',
            d: 'Výškové práce: nivelační zápisník s uzávěrem, převýšení mezi body, výška objektu '
                + 'a korekce měření (refrakce, teplota, tlak).',
            tools: ['zapisnik', 'openMeasureModal', 'vyska-objektu', 'korekce', 'openDmtVolume', 'epochy']
        },
        {
            id: 'zemni', ic: 'area', t: 'Zemní práce a kubatury',
            s: 'Kubatury, vrstevnice, plochy',
            d: 'Před hutněním i po něm: model terénu z bodů, vrstevnice a objem výkopu a násypu, '
                + 'plochy a obchůzka staveniště se stopou.',
            tools: ['openDmtVolume', 'startAreaMode', 'track-log', 'brutal-gps', 'vrstvy',
                'openMeasureModal', 'zavady']
        },
        {
            id: 'katastr', ic: 'pin', t: 'Katastr a mapování',
            s: 'Parcely, výměry, mapování',
            d: 'Parcely z ČÚZK stažené do telefonu (fungují offline v mapě i v AR), výměry '
                + 'a dělení pozemku, náčrt a import podkladů.',
            tools: ['openKatastr', 'cadastre-vector', 'parcela', 'startAreaMode', 'openTachymetrie',
                'project-import', 'openMeasureModal', 'cadastre-area']
        },
        {
            id: 'site', ic: 'line', t: 'Podzemní sítě',
            s: 'Vedení v mapě i v AR',
            d: '„Rentgen do země“: trasy vedení v mapě i v AR pod nohama, podklady od správců '
                + '(DXF, plán z vyjádření) a vytyčení trasy před výkopem.',
            tools: ['utility-networks', 'project-import', 'geo-overlay', 'cadastre-vector',
                'openStakeoutModal', 'offset-point', 'zavady']
        },
        {
            id: 'kontrola', ic: 'ruler', t: 'Kontrola a monitoring',
            s: 'Oměrné, epochy, posuny',
            d: 'Kontrola vlastního i cizího díla: oměrné míry proti souřadnicím, opakované epochy '
                + 'bodu a posuny v čase, kubatury pro ověření.',
            tools: ['openCheckDist', 'epochy', 'zavady', 'openDmtVolume', 'vyska-objektu',
                'track-log', 'zapisnik', 'openMeasureModal']
        },
        {
            id: 'dozor', ic: 'alert', t: 'Dozor a přejímka',
            s: 'Závady, deník, papíry',
            d: 'Papíry z terénu: závada s fotkou vázaná na konkrétní bod, hlasová poznámka '
                + 's georazítkem, deník dne pro kancelář a docházka party.',
            tools: ['zavady', 'denik-dne', 'hlasovky', 'openCheckDist', 'epochy', 'dochazka', 'zapisnik']
        },
        {
            id: 'priprava', ic: 'folder', t: 'Příprava a kancelář',
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
        ruler: '#i-ruler', alert: '#i-alert', folder: '#i-folder'
    };
    // Záložní jména nástrojů pro případ, že mřížka Nástrojů ještě není v DOM
    // (výčet se jinak čte přímo z dlaždic — viz tileLabels).
    var NAMES = {
        'openMeasureModal': 'Měření vzdálenosti', 'startAreaMode': 'Měření plochy',
        'openCheckDist': 'Oměrné / kontrola', 'openDmtVolume': 'Kubatury / vrstevnice',
        'openStakeoutModal': 'Vytyčovací checklist', 'openTachymetrie': 'Náčrt / tachymetrie',
        'openKatastr': 'Katastr (zde stojím)', 'agOpenCalibrate': 'Srovnat sever',
        'vrstvy': 'Vrstvy / pokládka', 'brutal-gps': 'Brutální GPS', 'gps-semafor': 'Skóre místa (GPS)',
        'ref-calibration': 'Kalibrace na ref. bod', 'korekce': 'Korekce měření',
        'zavady': 'Závady / hlášení', 'track-log': 'Stopa trasy', 'epochy': 'Epochy / monitoring',
        'zapisnik': 'Zápisníky', 'stakeout-line': 'Vytyčení přímky', 'offset-point': 'Offset bod',
        'usadit-ar': 'Usadit AR (průvodce)', 'rajon': 'Rajón', 'project-import': 'Import projektu (DXF)',
        'ar-intersection': 'Protínání vpřed', 'free-station': 'Volné stanovisko',
        'orient-point': 'Srovnat podle bodu', 'vyska-objektu': 'Výška objektu',
        'cadastre-vector': 'Katastr — parcely', 'cadastre-area': 'Body z výřezu mapy',
        'parcela': 'Parcela / dělení', 'utility-networks': 'Podzemní sítě',
        'geo-overlay': 'Vlastní podklad', 'denik-dne': 'Deník dne', 'hlasovky': 'Hlasové poznámky',
        'dochazka': 'Docházka', 'brifink': 'Dnešek v terénu', 'checklist': 'Co s sebou',
        'pocasi': 'Počasí', 'gnss-forecast': 'GNSS předpověď', 'job-transfer': 'Poslat/načíst zakázku',
        'kniha-jizd': 'Kniha jízd', 'pdr-offset': 'Krokový offset', 'dgps': 'Dvoutelefonní DGPS'
    };

    function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function pid() { return ls('arActiveProjectId') || 'default'; }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    function modeById(id) { for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i]; return null; }
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
    var merged = false;
    function mergeProfiles() {
        if (merged) return true;
        var S = null;
        try { S = window.AGToolsSimple; } catch (e) {}
        if (!S || !S.profiles || !S.order || !S.order.push) return false;
        MODES.forEach(function (m) {
            var rec = S.profiles[m.id];
            if (!rec) {
                S.profiles[m.id] = { label: m.t, tools: m.tools.slice() };
            } else {
                rec.label = m.t;                        // jednotné jméno na kartě i v <select>u
                if (!rec.tools) rec.tools = [];
                m.tools.forEach(function (k) { if (rec.tools.indexOf(k) === -1) rec.tools.push(k); });
            }
        });
        // pořadí v <select>u srovnej podle pásu; co by v MODES nebylo (cizí modul),
        // se přilepí na konec, ať nikdo o svůj profil nepřijde
        var order = MODES.map(function (m) { return m.id; });
        S.order.forEach(function (id) { if (order.indexOf(id) === -1) order.push(id); });
        S.order.length = 0;
        order.forEach(function (id) { S.order.push(id); });
        merged = true;
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
    // Výčet nástrojů režimu: jména z mřížky, a co v mřížce není, se vynechá
    // (nástroj byl odpojen nebo ho role nemá) — text tak nemůže zastarat.
    function toolNames(id) {
        var keys = toolsOf(id), map = tileLabels(), out = [];
        keys.forEach(function (k) {
            var l;
            if (map) { if (!(k in map)) return; l = map[k]; if (l === null) return; }
            else { l = NAMES[k]; if (!l) return; }
            if (!l) l = NAMES[k] || k;
            if (out.indexOf(l) === -1) out.push(l);
        });
        return out;
    }

    // ---- styly -------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-rp-wrap{margin:-18px 0 26px;}',           // karta zakázky má pod sebou 30px
            '#ag-rp-wrap[hidden]{display:none;}',
            '#ag-rp-head{display:flex;align-items:baseline;gap:8px;margin:0 0 8px;}',
            '#ag-rp-head .t{font:700 11px/1.2 var(--font-ui,system-ui),sans-serif;letter-spacing:.12em;',
            '  text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#ag-rp-head .hint{display:none;font:600 10.5px/1.2 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--accent,#2f9e74);opacity:.9;}',
            '#ag-rp-wrap.scrollable #ag-rp-head .hint{display:inline;}',
            '#ag-rp-head .x{margin-left:auto;background:none;border:none;padding:2px 0;cursor:pointer;',
            '  color:var(--text-muted,#9aa1ac);font:500 11px/1 var(--font-ui,system-ui),sans-serif;text-decoration:underline;}',
            // pás voleb — vodorovný scroll, ať karta neroste do výšky
            // POZOR (kontrola 27.7.): #welcome-screen .modal-content má v css/style.css
            // touch-action:pan-y. Prohlížeč PRŮNIKUJE touch-action prvku s předky, takže
            // uvnitř by nešlo posunout prstem VODOROVNĚ vůbec nic — pás režimů by se dal
            // rolovat leda myší a „posuň ›" by lhalo. Povolujeme oba směry; kontejner sám
            // vodorovně nepřetéká, takže se pro zbytek úvodní obrazovky nic nemění.
            '#welcome-screen .modal-content{touch-action:pan-x pan-y;}',
            '#ag-rp-strip{position:relative;}',
            '#ag-rp-list{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 4px;scroll-snap-type:x proximity;',
            '  -webkit-overflow-scrolling:touch;}',
            '#ag-rp-list::-webkit-scrollbar{height:0;}',
            // náznak, že se dá rolovat: okraj pásu se vytrácí (maska funguje na
            // libovolném pozadí, gradient v barvě by se s motivem rozešel)
            '#ag-rp-strip.sr:not(.sl) #ag-rp-list{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 34px),transparent);',
            '  mask-image:linear-gradient(90deg,#000 calc(100% - 34px),transparent);}',
            '#ag-rp-strip.sl:not(.sr) #ag-rp-list{-webkit-mask-image:linear-gradient(90deg,transparent,#000 34px);',
            '  mask-image:linear-gradient(90deg,transparent,#000 34px);}',
            '#ag-rp-strip.sl.sr #ag-rp-list{-webkit-mask-image:linear-gradient(90deg,transparent,#000 34px,#000 calc(100% - 34px),transparent);',
            '  mask-image:linear-gradient(90deg,transparent,#000 34px,#000 calc(100% - 34px),transparent);}',
            '#ag-rp-list button{flex:0 0 auto;scroll-snap-align:start;min-width:132px;max-width:168px;',
            '  display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:10px 12px;',
            '  border-radius:14px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:rgba(255,255,255,0.04);color:var(--text-color,#eceef2);cursor:pointer;text-align:left;}',
            '#ag-rp-list button .icon{width:19px;height:19px;color:var(--accent-bright,#3eb487);}',
            '#ag-rp-list button b{font:700 13px/1.2 var(--font-ui,system-ui),sans-serif;}',
            '#ag-rp-list button span{font:500 10.5px/1.3 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-muted,#9aa1ac);white-space:normal;}',
            '#ag-rp-list button i{font-style:normal;font:700 9.5px/1.2 var(--font-ui,system-ui),sans-serif;',
            '  letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);opacity:.75;}',
            '#ag-rp-list button.on{border-color:var(--accent-line,rgba(47,158,116,0.42));',
            '  background:var(--accent-soft,rgba(47,158,116,0.14));}',
            '#ag-rp-list button.on b{color:var(--accent,#2f9e74);}',
            '#ag-rp-list button.on i{color:var(--accent,#2f9e74);opacity:1;}',
            '#ag-rp-list button:active{transform:scale(0.98);}',
            // co režim udělá + výčet nástrojů, které vytáhne dopředu
            '#ag-rp-detail{margin:8px 2px 0;}',
            '#ag-rp-detail .d{margin:0;font:500 12px/1.5 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-color,#eceef2);opacity:.92;}',
            '#ag-rp-detail .lab{display:block;margin:8px 0 5px;font:700 10px/1.2 var(--font-ui,system-ui),sans-serif;',
            '  letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#ag-rp-chips{display:flex;flex-wrap:wrap;gap:5px;margin:0;padding:0;list-style:none;}',
            '#ag-rp-chips li{padding:4px 9px;border-radius:999px;font:600 11px/1.25 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-color,#eceef2);background:var(--surface-2,rgba(255,255,255,0.06));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));}',
            '#ag-rp-note{margin:8px 2px 0;font:500 11.5px/1.45 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-muted,#9aa1ac);}',
            '#ag-rp-note b{color:var(--accent,#2f9e74);font-weight:700;}',
            // režim levé ruky: odkládací odkaz pod palec vlevo (ovládání se zrcadlí)
            'body.left-hand #ag-rp-head .x{order:-1;margin-left:0;margin-right:auto;}',
            'body.ag-glove #ag-rp-list button{min-width:146px;padding:13px 14px;}',
            'body.ag-glove #ag-rp-list button b{font-size:calc(14px * var(--ag-font-scale, 1));}',
            'body.ag-glove #ag-rp-chips li{padding:6px 11px;font-size:calc(12px * var(--ag-font-scale, 1));}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- volba režimu ------------------------------------------------------------
    function pick(id) {
        if (!known(id)) return;
        // Stav jednoduchého panelu před prvním zásahem si pamatuj, ať se dá vrátit.
        if (ls(PREV_KEY) == null) lsSet(PREV_KEY, simpleOn() ? '1' : '0');
        lsSet(PROF_PREFIX + pid(), id);
        if (id === 'univerzal') lsSet(SIMPLE_KEY, ls(PREV_KEY) === '1' ? '1' : '0');
        else lsSet(SIMPLE_KEY, '1');
        render();
        // tools-simple.js se sám dorovná svým tickem; když je po ruce, ať to je hned
        try { if (window.AGToolsSimple && typeof window.AGToolsSimple.sync === 'function') window.AGToolsSimple.sync(); } catch (e) {}
    }

    function noteFor(id) {
        if (id === 'univerzal') {
            return 'V Nástrojích uvidíš <b>všechny dlaždice</b>. Režim si můžeš vybrat i později v Nástrojích.';
        }
        return 'V Nástrojích se tyhle dlaždice vytáhnou <b>dopředu</b>; ostatní zůstávají pod '
            + '„Zobrazit všechny nástroje“ a hledání najde vždy vše. Platí pro aktivní zakázku.';
    }

    // ---- vykreslení do úvodní obrazovky -------------------------------------------
    function ensureWrap() {
        var w = document.getElementById('ag-rp-wrap');
        if (w) return w;
        var ws = document.getElementById('welcome-screen');
        if (!ws) return null;
        var content = ws.querySelector('.modal-content');
        var row = ws.querySelector('.w-proj-row');
        if (!content || !row) return null;
        w = document.createElement('div');
        w.id = 'ag-rp-wrap';
        w.innerHTML =
            '<div id="ag-rp-head"><span class="t">Jak dnes budeš appku používat</span>'
            + '<span class="hint">posuň ›</span>'
            + '<button type="button" class="x" id="ag-rp-hide">Nezobrazovat</button></div>'
            + '<div id="ag-rp-strip"><div id="ag-rp-list" role="group" aria-label="Režim práce"></div></div>'
            + '<div id="ag-rp-detail"></div>'
            + '<p id="ag-rp-note"></p>';
        // pod kartu zakázky (režim se vztahuje k zakázce), nad tlačítka Spustit
        if (row.nextSibling) content.insertBefore(w, row.nextSibling);
        else content.appendChild(w);
        w.querySelector('#ag-rp-hide').addEventListener('click', function () {
            lsSet(HIDE_KEY, '1');
            render();
            try { if (typeof window.quickToast === 'function') window.quickToast('Volbu režimu vrátíš v Nastavení → Vzhled'); } catch (e) {}
        });
        var list = w.querySelector('#ag-rp-list');
        list.addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('button[data-mode]') : null;
            if (b) pick(b.getAttribute('data-mode'));
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
        var names = toolNames(cur);
        // Překresluj jen při skutečné změně — úvodní obrazovka se refreshuje i po
        // přepnutí zakázky a překreslování každou vteřinu by stálo baterii.
        var sig = cur + '|' + names.join('~');
        if (list.getAttribute('data-cur') !== cur) {
            list.setAttribute('data-cur', cur);
            list.innerHTML = MODES.map(function (m) {
                var n = toolsOf(m.id).length;
                return '<button type="button" data-mode="' + m.id + '"'
                    + (m.id === cur ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>'
                    + '<svg class="icon"><use href="' + (ICONS[m.ic] || '#i-grid') + '"/></svg>'
                    + '<b>' + esc(m.t) + '</b><span>' + esc(m.s) + '</span>'
                    + '<i>' + (m.id === 'univerzal' ? 'vše' : n + ' ' + (n < 5 ? 'nástroje' : 'nástrojů')) + '</i>'
                    + '</button>';
            }).join('');
            needScroll = true;
        }
        if (w.getAttribute('data-sig') !== sig) {
            w.setAttribute('data-sig', sig);
            var m = modeById(cur);
            var d = m ? m.d : '';
            var html = '<p class="d">' + esc(d) + '</p>';
            if (names.length) {
                html += '<span class="lab">Vytáhne dopředu</span><ul id="ag-rp-chips">'
                    + names.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
            }
            w.querySelector('#ag-rp-detail').innerHTML = html;
            var note = w.querySelector('#ag-rp-note');
            var nh = noteFor(cur);
            if (note.innerHTML !== nh) note.innerHTML = nh;
        }
        scrollToActive(list);
        edgeHints();
    }

    // ---- přepínač v Nastavení → Vzhled (cesta zpět, když si kartu uklidí) ----------
    function injectSettingRow() {
        if (document.getElementById('ag-rp-setrow')) return;
        // kotvíme na řádek jednoduchého panelu z tools-simple.js, ať jsou volby spolu;
        // kdyby ten modul chyběl, spadneme na režim levé ruky jako ostatní moduly
        var anchor = document.getElementById('ag-ts-setrow') || document.getElementById('s-lefthand');
        var row = (anchor && anchor.classList && anchor.classList.contains('st-row'))
            ? anchor : (anchor && anchor.closest ? anchor.closest('.st-row') : null);
        if (!row || !row.parentNode) return;
        var d = document.createElement('div');
        d.className = 'st-row'; d.id = 'ag-rp-setrow';
        d.innerHTML = '<span class="st-lab">Volba režimu práce na úvodu<small>na úvodní obrazovce vybereš, co dnes děláš, a Nástroje se podle toho zúží</small></span>'
            + '<label class="st-sw"><input type="checkbox" id="ag-rp-sw"><span class="st-sw-face"></span></label>';
        row.parentNode.insertBefore(d, row.nextSibling);
        var cb = d.querySelector('#ag-rp-sw');
        cb.checked = !hidden();
        cb.addEventListener('change', function () { lsSet(HIDE_KEY, cb.checked ? '0' : '1'); render(); });
    }

    // ---- init ---------------------------------------------------------------------
    function tick() {
        try {
            mergeProfiles();
            injectSettingRow();
            fixSelect();
            var cb = document.getElementById('ag-rp-sw');
            if (cb && cb.checked === hidden()) cb.checked = !hidden();
            // Když je úvodní obrazovka schovaná, nemá smysl číst mřížku Nástrojů
            // a přepočítávat výčet — šetříme baterii (viz js/power-save.js).
            var w = document.getElementById('ag-rp-wrap');
            if (w && w.offsetParent === null && !w.hidden) return;
            render();
        } catch (e) {}
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
