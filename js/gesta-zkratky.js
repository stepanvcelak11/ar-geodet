// ===== AR Geodet — GESTA JAKO ZKRATKY NA NÁSTROJE (ODPOJITELNÁ vrstva) ===========
// Nástroj, který používáš pořád, si přiřadíš ke gestu a pak ho spouštíš ZPAMĚTI —
// jedním tahem prstu kdekoli po displeji, bez hledání v Nástrojích. Tah má dvě
// části a kreslí se BEZ ZVEDNUTÍ PRSTU:
//
//      AKTIVAČNÍ GESTO (výchozí ↓→)  +  ZKRATKA NÁSTROJE (např. ↑↓ = Počasí)
//
// Appka do toho NEMLUVÍ: neukazuje nabídku, co jde nakreslit dál, ani seznam
// zkratek. To je záměr — smyslem je svalová paměť, ne čtení z obrazovky. Jediná
// zpětná vazba je krátké cuknutí vibrací u každého tahu a drobný ukazatel
// uprostřed s tím, co už máš nakreslené; nic neztmavuje a nebere dotyky.
// Soupis přiřazení je v Nastavení, kde se také mění.
//
// PROČ AKTIVAČNÍ GESTO A NE ROVNOU ZKRATKA: celá plocha appky je živá — mapa se
// posouvá prstem, v AR se chodí po značkách. Kdyby zkratkou byl JEDEN tah, spustí
// se nástroj při každém posunutí mapy. Dvoutahový úvod s lomem („L") při běžném
// posouvání nevznikne, a i kdyby, musí být hotový do PREFIX_MS a přesně od začátku
// tahu — jinak se rozpoznávání hned vzdá.
//
// MAPA SE VRÁTÍ, KAM PATŘILA. Než je aktivační gesto rozpoznané, mapa se pod prstem
// posouvá (nedá se dopředu vědět, že jde o gesto). Ve chvíli rozpoznání se proto
// vrátí střed i zoom zapamatovaný při položení prstu a další pohyb už se k mapě
// vůbec nedostane (stopPropagation v CAPTURE fázi — obsluha mapy visí na
// #map-container v bublání, takže ji tím spolehlivě přeskočíme).
//
// ⚠⚠ ZKRATKA NESMÍ ZAČÍNAT TÍMŽ SMĚREM, JAKÝM KONČÍ AKTIVAČNÍ GESTO. Dvě stejné
// šipky za sebou se jedním tahem nedají nakreslit — je to jeden rovný tah. Nastavení
// takové přiřazení ODMÍTNE (dřív jen varovalo, což při kreslení bez zvedání prstu
// nestačí). Ze stejného důvodu nejsou mezi směry diagonály: na displeji v rukavicích
// se „šikmo" od „doprava" nerozezná spolehlivě (proto RATIO).
//
// ZVEDNUTÍ PRSTU gesto uzavírá: co sedí, spustí se; co nesedí, jen krátce zčervená
// a zmizí. Jakmile je jasno (nakreslený kód sedí a žádná delší zkratka jím
// nezačíná), nástroj naskočí ještě pod rukou, bez čekání na zvednutí.
//
// KDE SE GESTO NEZAKLÁDÁ: nad tlačítky, poli, dlaždicemi, otevřeným modálem,
// v panelu vrstev, na popupu mapy, nad přihlašovací obrazovkou a v kolečku nástrojů
// (body.ag-kn-open). Tam tah znamená něco jiného a sebrat mu ho by bylo horší než
// chybějící zkratka.
//
// SPOUŠTÍ SE STEJNOU CESTOU JAKO KOLEČKO: AGUkony.run(klíč) klikne na původní
// dlaždici v Nástrojích. Nic se tu nevede vlastní — takže platí oprávnění rolí
// (skrytá dlaždice = nespustitelná zkratka), počítadlo použití i návody.
//
// CO JE JEŠTĚ V TÉHLE VRSTVĚ (a proč to tak je):
//
//  ① TAHÁK JEN NA VYŽÁDÁNÍ. Rychlé gesto je tiché. Když se ale prst uprostřed
//     gesta ZASTAVÍ (HOLD_MS), rozbalí se pod ukazatelem soupis zkratek, které na
//     rozkreslený tah sedí. Je to týž pohyb jako naslepo, takže se čtení samo mění
//     ve svalovou paměť („marking menu"). Vypínatelné.
//  ② PODRŽENÍ V NÁSTROJÍCH dá nástroji gesto rovnou tam, kde ho používáš. Poslouchá
//     se na dlaždici i na řádku seznamu úkonů (ten kvůli tomu nese `data-k`).
//     ⚠⚠ VE VÝCHOZÍM STAVU VYPNUTÉ (přepínač „Přiřazovat gesto podržením dlaždice").
//     Nahlášeno 29. 8. 2026: „po vyvolání nástroje mi vždycky vyskakuje nakreslit
//     gesto, ale to bych dal jako možnost, pokud chci." Práh 620 ms byl kratší než
//     běžné klepnutí v rukavicích — místo nástroje naskočila kreslicí plocha.
//  ③ NABÍDKA PODLE POUŽITÍ: u nástroje, který jsi otevřel aspoň OFFER_MIN×, se
//     appka JEDNOU zeptá, jestli na něj chceš gesto. Bere se počítadlo
//     `agToolUsage_v1`, které vede js/field-tools.js — nic se nového neměří.
//     ⚠⚠ VE VÝCHOZÍM STAVU VYPNUTO (přepínač „Nabízet gesta podle použití").
//     Nahlášeno 30. 8. 2026: „pokud nástroj použiji víckrát, ať mi to nenabízí
//     vytvořit gesto." Kdo nástroj používá často, chce ho používat — ne odpovídat
//     na otázku. Stejným směrem už šlo ② (podržení dlaždice). NEVRACET.
//  ④ CÍLEM ZKRATKY NENÍ JEN NÁSTROJ, ale i AKCE appky (uložit bod, přepnout
//     zobrazení, mapa na mou polohu, katastr…). Akce se spouští KLIKNUTÍM na
//     příslušné tlačítko, takže platí oprávnění rolí stejně jako u nástrojů.
//  ⑤ TRENAŽÉR v Nastavení: appka řekne název nástroje, ty nakreslíš gesto a ona
//     řekne, jestli sedí. Nic se přitom nespouští.
//  ⑥ DÉLKA TAHU se dá nastavit (krátké/střední/dlouhé) a v rukavicích
//     (body.ag-glove) se práh sám zvětší o GLOVE_MUL.
//  ⑦ SAMOTNÉ AKTIVAČNÍ GESTO (zvednu prst hned za ním) zopakuje POSLEDNÍ
//     spuštěnou zkratku. Dokud žádná neproběhla, nedělá nic. Vypínatelné.
//
// Odstranění: smaž js/gesta-zkratky.js + řádek <script> v index.html (a řádek
// v sw.js + zápis 'ag-gz-setrow' v js/nastaveni-poradek.js). Nic jiného na tom
// nestojí.
// ================================================================================
(function () {
    'use strict';
    if (window.AGGesta) return;

    var KEY = 'agGesta_v1';
    var STYLE_ID = 'ag-gz-style', WRAP_ID = 'ag-gz', SET_ID = 'ag-gz-set', PAD_ID = 'ag-gz-pad', TR_ID = 'ag-gz-tr';

    var SEG_STEP = { kratke: 40, stredni: 54, dlouhe: 72 };   // ⑥ délka tahu z Nastavení
    var GLOVE_MUL = 1.25;  // v rukavicích jsou tahy hrubší (body.ag-glove)
    var HOLD_MS = 900;     // ① po téhle době BEZ POHYBU se teprve ukáže tahák
    // ② Podržení dlaždice v Nástrojích = přiřadit gesto.
    // ⚠⚠ VE VÝCHOZÍM STAVU VYPNUTO (`lp:0`) a práh zvednutý z 620 na 900 ms.
    // Nahlášeno 29. 8. 2026: „po vyvolání nástroje mi vždycky vyskakuje nakreslit
    // gesto, ale to bych dal jako možnost, pokud chci." 620 ms je totiž míň, než
    // trvá běžné klepnutí v rukavicích nebo za chůze — takže se místo nástroje
    // otevřela kreslicí plocha. Zapíná se v okně Gesta („Přiřazovat gesto podržením
    // dlaždice"). NEVRACET zpátky na zapnuto bez vyžádání.
    var LP_MS = 900;
    var LP_TOL = 12;       // o kolik smí u podržení ujet prst
    var OFFER_MIN = 8;     // ③ od kolika použití má cenu nabízet gesto (když si ji uživatel zapne)
    var OFFER_V = 2;       // ③ verze výchozího stavu nabídky — zvedni, až se bude měnit znovu
    var RATIO = 1.5;       // o kolik musí převládnout jedna osa (jinak je to šikmo → čeká se dál)
    var PREFIX_MS = 1600;  // do kdy musí být aktivační gesto hotové (pomalý tah = posun mapy)
    // ⚠ NÁSTROJ SE SPOUŠTÍ HNED, ukazatel dobíhá po něm. Do 31. 8. 2026 se mezi
    //   rozpoznáním a spuštěním čekalo 200 ms „ať je vidět, co se spouští" — jenže
    //   to je přesně ta prodleva, kterou uživatel cítil („pořád to není dost
    //   rychlé"). Co se spustilo, je vidět na samotném nástroji; ukazatel se ještě
    //   CHIP_MS mihne se jménem nástroje, ale nikoho už nezdržuje.
    var CHIP_MS = 260;     // jak dlouho po spuštění ještě dobíhá ukazatel
    var MAXSEG = 3;        // nejvýš tři šipky na zkratku (delší si nikdo nezapamatuje)

    var ARROW = { U: '↑', D: '↓', L: '←', R: '→' };
    var DIRNAME = { U: 'nahoru', D: 'dolů', L: 'doleva', R: 'doprava' };

    // Kde se tah NEZAKLÁDÁ (viz hlavička). `.btn` je i „Zavřít" v modálech,
    // `.glass-panel` panel vrstev, `#ag-kn` kolečko nástrojů.
    // ⚠ #ag-login/#ag-gate/#welcome-screen tu MUSÍ být: `body.app-started` je
    // nastavené i pod přihlašovací obrazovkou (ověřeno v prohlížeči), takže bez
    // nich by šlo kreslit zkratky ještě před přihlášením.
    var NOGO = 'input,textarea,select,button,a,[role="button"],canvas,video,' +
        '.tool-tile,.dock-btn,.btn,.leaflet-popup,.leaflet-marker-icon,#map-controls,' +
        '.glass-panel,.modal-overlay,.bottom-sheet,[data-no-swipe],' +
        '#ag-login,#ag-gate,#welcome-screen,#' + WRAP_ID;

    // ---- nastavení -----------------------------------------------------------------
    // Výchozí zkratky ZÁMĚRNĚ nezačínají šipkou → (aktivační gesto končí doprava),
    // aby šly nakreslit i jedním tahem. Viz poznámka v hlavičce.
    function defaults() {
        return {
            off: 0,
            fingers: 1,
            prefix: 'DR',
            seg: 'stredni',   // ⑥ délka tahu
            hold: 1,          // ① tahák po podržení prstu
            lp: 0,            // ② přiřazovat gesto podržením dlaždice (výchozí VYPNUTO, viz LP_MS)
            solo: 1,          // ⑦ samotné aktivační gesto = poslední zkratka
            // ③ nabízet gesta podle použití — ⚠⚠ VÝCHOZÍ STAV VYPNUTO (30. 8. 2026).
            // Nahlášeno z terénu: „pokud nástroj použiji víckrát, ať mi to nenabízí
            // vytvořit gesto." Kdo nabídku chce, zapne si ji v okně Gesta.
            // NEVRACET zpátky na zapnuto bez vyžádání.
            offer: 0,
            offerV: OFFER_V,  // ③ verze výchozího stavu — kvůli jednorázové migraci, viz load()
            last: '',         // ⑦ naposledy spuštěná zkratka
            offered: [],      // ③ co už appka jednou nabídla (víckrát neotravuje)
            tip: 0,           // ② jestli už padl tip o podržení dlaždice
            map: { UD: 'pocasi', UR: 'kompas', UL: 'openMeasureModal', DU: 'brutal-gps' }
        };
    }
    var cfg = null;
    function isCode(s) { return typeof s === 'string' && /^[UDLR]{1,4}$/.test(s) && !/(.)\1/.test(s); }
    function load() {
        if (cfg) return cfg;
        cfg = defaults();
        try {
            var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (raw && typeof raw === 'object') {
                cfg.off = raw.off ? 1 : 0;
                cfg.fingers = (raw.fingers === 2) ? 2 : 1;
                if (isCode(raw.prefix) && raw.prefix.length >= 2) cfg.prefix = raw.prefix;
                if (SEG_STEP[raw.seg]) cfg.seg = raw.seg;
                cfg.hold = raw.hold ? 1 : 0;
                cfg.lp = raw.lp ? 1 : 0;
                cfg.solo = raw.solo ? 1 : 0;
                // ⚠ MIGRACE VÝCHOZÍHO STAVU. Nabídka gest podle použití se 30. 8. 2026
                // na přání vypnula, jenže ve stávajících instalacích už leží v localStorage
                // staré `offer:1` — bez tohohle by nabídka dál vyskakovala právě tomu, kdo
                // si na ni stěžoval. Migrace proběhne JEDNOU (podle offerV), takže když si
                // ji někdo v okně Gesta zase zapne, už mu ji nikdo nesundá.
                cfg.offerV = (+raw.offerV || 0);
                cfg.offer = (cfg.offerV >= OFFER_V) ? (raw.offer ? 1 : 0) : 0;
                cfg.offerV = OFFER_V;
                cfg.tip = raw.tip ? 1 : 0;
                if (isCode(raw.last)) cfg.last = raw.last;
                if (Array.isArray(raw.offered)) cfg.offered = raw.offered.slice(0, 200);
                if (raw.map && typeof raw.map === 'object') {
                    cfg.map = {};
                    for (var c in raw.map) {
                        if (isCode(c) && typeof raw.map[c] === 'string' && raw.map[c]) cfg.map[c] = raw.map[c];
                    }
                }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:load'); }
        return cfg;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(load())); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:save'); } }

    function arrows(code) {
        var s = '';
        for (var i = 0; i < (code || '').length; i++) s += (ARROW[code.charAt(i)] || '');
        return s;
    }

    // ---- STOPA GESTA: tah nakreslený tak, jak se dělá prstem ------------------------
    // Na přání z 29. 8. 2026 („zobrazení gesta, co jsem už udělal, bych udělal
    // hravěji — takhle mi to přijde nudné"). Řada znaků ↓→↑↓ se musí přečíst a
    // v hlavě přeložit zpátky na pohyb; nakreslená čára je ten pohyb rovnou.
    //   • aktivační gesto tence a šedě, zkratka silně v barvě → je vidět, kde jedno
    //     končí a druhé začíná (dělá se to jedním tahem, takže jinak by splynuly),
    //   • kroužek = kde prst začíná, puntík = kde ho zvedneš.
    //
    // ⚠ ÚKROK U VRACEJÍCÍCH SE RAMEN. Zkratka ↑↓ jde nahoru a hned zpátky dolů po
    // TÉŽE čáře — nakreslené doslova by z toho byla jedna úsečka a nešlo by poznat,
    // že jsou ramena dvě. Vracející se rameno se proto posune o OFF kolmo. Je to
    // tedy schéma tahu, ne jeho doslovná stopa; pořadí a směry sedí.
    var TR_STEP = 15;   // délka jednoho ramene v souřadnicích viewBoxu
    var TR_OFF = 5;     // úkrok u vracejícího se ramene
    var TR_VEC = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };

    // Projde kód a vrátí body lomené čáry + index bodu, kterým končí každé rameno.
    function trWalk(seq) {
        var x = 0, y = 0, prev = null, pts = [[0, 0]], ends = [], i;
        for (i = 0; i < seq.length; i++) {
            var d = TR_VEC[seq.charAt(i)];
            if (!d) continue;
            if (prev && d[0] === -prev[0] && d[1] === -prev[1]) {
                var px = prev[1], py = -prev[0];        // kolmice na předchozí směr
                x += px * TR_OFF; y += py * TR_OFF;
                pts.push([x, y]);
            }
            x += d[0] * TR_STEP; y += d[1] * TR_STEP;
            pts.push([x, y]);
            ends.push(pts.length - 1);
            prev = d;
        }
        // ⚠ TAH, KTERÝ SE UZAVŘE (↓→ ↑← je obdélník), by skončil PŘESNĚ na svém
        // začátku — puntík „tady zvedneš prst" by splynul s kroužkem „tady začínáš"
        // a z okénka by byl jen čtvereček. Poslední rameno se proto o kousek zkrátí:
        // zůstane viditelná mezera přesně tam, kde tah končí.
        if (prev && pts.length > 2 && Math.abs(x - pts[0][0]) < 0.5 && Math.abs(y - pts[0][1]) < 0.5) {
            x -= prev[0] * TR_OFF; y -= prev[1] * TR_OFF;
            pts[pts.length - 1] = [x, y];
        }
        return { pts: pts, ends: ends };
    }
    // Hotové <svg> jako řetězec (seznam se skládá do innerHTML).
    function strokeSvg(pre, code) {
        var w = trWalk(String(pre || '') + String(code || ''));
        var pts = w.pts;
        if (pts.length < 2 || !w.ends.length) return '';
        var cut = w.ends[Math.max(0, String(pre || '').length - 1)];
        var i, minX = pts[0][0], maxX = pts[0][0], minY = pts[0][1], maxY = pts[0][1];
        for (i = 1; i < pts.length; i++) {
            if (pts[i][0] < minX) minX = pts[i][0];
            if (pts[i][0] > maxX) maxX = pts[i][0];
            if (pts[i][1] < minY) minY = pts[i][1];
            if (pts[i][1] > maxY) maxY = pts[i][1];
        }
        // čtvercový viewBox: kresba se do něj vystředí, ať je zkratka jakkoli široká
        var pad = 9, bw = (maxX - minX) + pad * 2, bh = (maxY - minY) + pad * 2;
        var side = Math.max(bw, bh);
        var dx = pad - minX + (side - bw) / 2, dy = pad - minY + (side - bh) / 2;
        function path(a) {
            var s = '';
            for (var j = 0; j < a.length; j++) {
                s += (j ? 'L' : 'M') + (a[j][0] + dx).toFixed(1) + ' ' + (a[j][1] + dy).toFixed(1) + ' ';
            }
            return s.trim();
        }
        var last = pts[pts.length - 1];
        return '<svg class="ag-gz-tr" viewBox="0 0 ' + side.toFixed(1) + ' ' + side.toFixed(1) + '" aria-hidden="true" focusable="false">' +
            '<circle class="ag-gz-tr-s" cx="' + (pts[0][0] + dx).toFixed(1) + '" cy="' + (pts[0][1] + dy).toFixed(1) + '" r="3.1"/>' +
            '<path class="ag-gz-tr-p" d="' + path(pts.slice(0, cut + 1)) + '"/>' +
            '<path class="ag-gz-tr-c" d="' + path(pts.slice(cut)) + '"/>' +
            '<circle class="ag-gz-tr-d" cx="' + (last[0] + dx).toFixed(1) + '" cy="' + (last[1] + dy).toFixed(1) + '" r="2.9"/>' +
            '</svg>';
    }
    function words(code) {
        var a = [];
        for (var i = 0; i < (code || '').length; i++) a.push(DIRNAME[code.charAt(i)] || '?');
        return a.join(', ');
    }
    // Totéž, ale KAŽDÉ SLOVO VE VLASTNÍM <span>. Překladač (js/jazyky.js) pracuje
    // s celými textovými uzly, takže slepenec „dolů, doprava" by musel být ve
    // slovníku pro každou kombinaci šipek zvlášť (4² až 4⁴ položek). Po slovech
    // stačí čtyři klíče a hlášku pod „Aktivační gesto" je vidět i anglicky.
    function wordsHtml(code) {
        var a = [];
        for (var i = 0; i < (code || '').length; i++) a.push('<span>' + esc(DIRNAME[code.charAt(i)] || '?') + '</span>');
        return a.join(', ');
    }
    function buzz(ms) {
        try {
            if (typeof visSettings !== 'undefined' && visSettings.vibrationEnabled === false) return;
            if (navigator.vibrate) navigator.vibrate(ms);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:buzz'); }
    }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:toast'); } }

    // ---- ④ AKCE APPKY jako cíl zkratky ----------------------------------------------
    // V terénu je „ulož bod tady" nebo „přepni na mapu" častější než otevření okna.
    // Akce se NEVOLAJÍ přímo funkcí, ale KLIKNUTÍM na příslušné tlačítko — stejná
    // úvaha jako u nástrojů: co appka schová oprávněním role, to zkratka nespustí,
    // a nemusíme tu držet druhou kopii logiky, která se rozejde.
    var ACTIONS = [
        { k: 'act:bod', l: 'Uložit nový bod', sel: '[onclick*="openNewPointModal"]' },
        { k: 'act:body', l: 'Mé body', sel: '[onclick*="openManageModal"]' },
        { k: 'act:nastroje', l: 'Otevřít Nástroje', sel: '#dock-nastroje-btn' },
        { k: 'act:zobrazeni', l: 'Přepnout AR / Split / Mapa', sel: '#ag-view-wheel' },
        { k: 'act:namne', l: 'Mapu zpátky na mou polohu', sel: '#map-recenter' },
        { k: 'act:katastr', l: 'Katastr zapnout / vypnout', sel: '#btn-katastr' },
        { k: 'act:nastaveni', l: 'Nastavení', sel: '[onclick*="openSettings"]' },
        // ⚠⚠ VENKOVNÍ REŽIM je výjimka z pravidla „stačí kliknout na tlačítko":
        // #s-outdoor je sice v DOM i při zavřených Nastaveních, ale je to jen políčko
        // v panelu — Nastavení se aplikují až tlačítkem „Uložit vše" (saveSettings
        // v grafika.js). Samotný .click() by tedy jen přehodil zaškrtnutí a nic by se
        // nestalo. Proto `po`: po kliknutí se hodnota rovnou promítne a uloží stejnou
        // cestou, jakou to dělá js/ar-calib2.js (setStoredData + applyVisualSettings).
        // Zkratka na to musí být: ruční cesta je dok → Nastavení → Vzhled → rolovat,
        // tedy čtyři klepnutí na displej, na který zrovna kvůli slunci není vidět.
        { k: 'act:slunce', l: 'Vysoký kontrast na slunci', sel: '#s-outdoor', po: outdoorApply }
    ];

    // Přepnutí venkovního režimu podle stavu políčka. Vrací text do bubliny, ať je
    // i bez pohledu na displej jasné, co se stalo.
    function outdoorApply(el) {
        try {
            if (typeof visSettings === 'undefined' || !visSettings) return null;
            visSettings.outdoorMode = !!(el && el.checked);
            if (typeof setStoredData === 'function') setStoredData('arVisSettings12', JSON.stringify(visSettings));
            if (typeof applyVisualSettings === 'function') applyVisualSettings();
            return visSettings.outdoorMode ? 'Vysoký kontrast zapnut' : 'Vysoký kontrast vypnut';
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:outdoorApply'); }
        return null;
    }
    function isAct(k) { return String(k || '').indexOf('act:') === 0; }
    function actionOf(k) {
        for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].k === k) return ACTIONS[i];
        return null;
    }
    function actionEl(a) { try { return a ? document.querySelector(a.sel) : null; } catch (e) { return null; } }

    // ---- nástroje (bereme z registru, vlastní seznam se nevede) ----------------------
    function groups() {
        try {
            if (window.AGReg && typeof AGReg.groups === 'function') return AGReg.groups();
            if (window.AGUkony && AGUkony.groups) return AGUkony.groups;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:groups'); }
        return [];
    }
    var LBL = null;
    function toolLabel(k) {
        if (isAct(k)) { var a = actionOf(k); return a ? a.l : k; }
        if (!LBL) {
            LBL = {};
            var g = groups();
            for (var i = 0; i < g.length; i++) {
                for (var j = 0; j < g[i].items.length; j++) LBL[g[i].items[j].k] = g[i].items[j].l;
            }
        }
        return LBL[k] || k;
    }
    // Dlaždice nemusí existovat: nástroj může být schovaný oprávněním role nebo
    // v „Moje aktivita". Zkratku na něj pak ukazujeme zašedle a nespustíme.
    function toolReady(k) {
        if (isAct(k)) {
            var el = actionEl(actionOf(k));
            // `style.display === 'none'` je přesně to, co dělá ucty.js applyPerms
            // u tlačítek, na která uživatel nemá právo. Zabalení do sbaleného panelu
            // se ZÁMĚRNĚ neřeší — klik na skryté tlačítko funguje a je to v pořádku.
            return !!(el && el.style.display !== 'none');
        }
        try { return !!(window.AGUkony && AGUkony.has(k)); } catch (e) { return false; }
    }
    function runTool(k) {
        if (isAct(k)) {
            var a = actionOf(k), el = actionEl(a);
            if (!el) return false;
            el.click();
            // Akce, které klikem teprve začínají (viz `po` u act:slunce) — hláška
            // z nich má přednost před obecnou „Spuštěno".
            if (a && a.po) { var m = a.po(el); if (m) toast(m); }
            return true;
        }
        try { return !!(window.AGUkony && AGUkony.run(k)); } catch (e) { return false; }
    }

    // ---- mapa (stejný přístup jako js/cadastre-area.js: globální `map` z logika.js) ---
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function mapSnap() {
        var m = getMap();
        try { return m ? { c: m.getCenter(), z: m.getZoom() } : null; } catch (e) { return null; }
    }
    function mapBack(s) {
        var m = getMap();
        if (!m || !s) return;
        try { m.setView(s.c, s.z, { animate: false }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:mapBack'); }
        // grafika.js si při posunu zvedne _mapHold (mapa se pak přestane točit podle
        // kompasu) a jeho touchend už k ní kvůli stopPropagation nedorazí — spustíme
        // příznak sami, jinak by mapa zůstala „zamrzlá" natrvalo.
        try { window._mapHold = false; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:mapBack'); }
    }

    // ---- rozklad tahu na šipky --------------------------------------------------------
    // Vrací novou šipku, nebo '' (pokračování téhož směru / ještě málo pohybu / šikmo).
    // Práh se bere JEDNOU při založení tahu, ne při každém pohybu: uprostřed gesta
    // se stejně nemění a čtení `classList` v každém touchmove je zbytečné.
    function segPx() {
        var v = SEG_STEP[load().seg] || SEG_STEP.stredni;
        try { if (document.body.classList.contains('ag-glove')) v = Math.round(v * GLOVE_MUL); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:segPx'); }
        return v;
    }
    function Stroke(x, y) { this.ax = x; this.ay = y; this.lx = x; this.ly = y; this.dir = ''; this.lenient = 0; this.seg = segPx(); }
    // jeden krok z jednoho bodu na druhý (původní logika)
    // ⚠⚠ PO AKTIVAČNÍM GESTU JE PRÁH MĚKČÍ (31. 8. 2026: „gesta reagují rychleji, ale
    //   stále to není dostatečně rychle"). Do té doby chtěla KAŽDÁ šipka celý práh
    //   (54 px) a převahu osy 1,5×, takže zkratka ↓→ + ↑↓ znamenala urazit přes
    //   200 px — a spěšný tah bývá šikmý, takže se navíc čekalo, než jedna osa
    //   dost převládne.
    //   Po `lenient` (nastavuje arm(), tj. tah UŽ PATŘÍ NÁM) stačí 0,62× práh a
    //   převaha 1,25×. Přehmat tam nic nestojí: nesedící kód jen zčervená a zmizí.
    //   PŘED rozpoznáním zůstává plný práh — tam by měkčí práh znamenal, že se
    //   nástroj spustí při obyčejném posunutí mapy.
    Stroke.prototype.one = function (x, y) {
        var dx = x - this.ax, dy = y - this.ay, adx = Math.abs(dx), ady = Math.abs(dy), d = '';
        var SEG = this.lenient ? Math.max(14, this.seg * 0.62) : this.seg;
        var R = this.lenient ? 1.25 : RATIO;
        if (adx >= SEG && adx >= ady * R) d = dx > 0 ? 'R' : 'L';
        else if (ady >= SEG && ady >= adx * R) d = dy > 0 ? 'D' : 'U';
        if (!d) return '';
        // kotva jde za prstem i u pokračování téhož směru — lom se pak měří od
        // MÍSTA ZLOMU, ne od začátku tahu (jinak by dlouhý tah lom „přejel")
        this.ax = x; this.ay = y;
        if (d === this.dir) return '';
        this.dir = d;
        return d;
    };
    // ⚠⚠ RYCHLÝ TAH: JEDNA UDÁLOST MŮŽE SPOLKNOUT CELÝ LOM
    // (nahlášeno 29. 8. 2026: „když udělám gesto moc rychle, tak ho to nedokáže vybrat").
    //
    // PŘÍČINA: prohlížeč pošle touchmove jen jednou za snímek. Při švihu tak jediná událost
    // přeskočí konec prvního ramene i začátek druhého — prst je najednou hluboko za lomem.
    // Rozdíl od kotvy má pak velké dx I velké dy, takže neproleze ani jednou větví v one()
    // (RATIO chce, aby jedna osa převažovala 1,5×), vrátí se '' — a co je nejhorší, KOTVA SE
    // ANI NEPOSUNE. Další události pak měří pořád od téhož starého bodu, první rameno se už
    // nikdy nezaznamená a tah se zahodí jako „není to gesto".
    //
    // ŘEŠENÍ, dvě věci:
    //   ① Když má skok výrazný pohyb v OBOU osách, nemohl být rovný — uvnitř něj leží lom.
    //     Rozloží se proto na dvě kolmá ramena. Pořadí dá směr, kterým se právě jelo
    //     (this.dir); na úplném začátku tahu, kdy ještě žádný není, se vezme delší osa.
    //   ② Každé rameno se pak prochází po půl prahu, tedy stejně, jako by šlo o pomalý tah.
    //     Rychlé gesto se tím chová přesně jako pomalé.
    //
    // ⚠ CENA, KTEROU TO MÁ: hodně rychlý ŠIKMÝ švih po mapě (≥ práh v obou osách v jediném
    // snímku, tj. přes 3000 px/s) se teď dá přečíst jako lom a může spustit aktivační gesto.
    // Uvnitř jedné události to od sebe rozeznat nejde. Proto se před rozpoznáním aktivačního
    // gesta žádá PLNÝ práh v obou osách; po něm (lenient) stačí 0,6×, protože tam už tah patří
    // nám a přehmat nic nestojí — nesedící kód jen zčervená a zmizí.
    //
    // (Vrací proto 0..N šipek najednou — volající musí umět víc znaků, viz onMove.)
    Stroke.prototype.step = function (x, y) {
        var jx = x - this.lx, jy = y - this.ly;
        var half = Math.max(6, this.seg * 0.5);
        var need = this.lenient ? this.seg * 0.6 : this.seg;
        var legs = [];
        if (Math.abs(jx) >= need && Math.abs(jy) >= need) {
            var vodorovne = (this.dir === 'L' || this.dir === 'R')
                || (!this.dir && Math.abs(jx) > Math.abs(jy));
            if (vodorovne) legs.push([this.lx + jx, this.ly]);
            else legs.push([this.lx, this.ly + jy]);
        }
        legs.push([x, y]);
        var out = '', px = this.lx, py = this.ly, L, i;
        for (L = 0; L < legs.length; L++) {
            var tx = legs[L][0], ty = legs[L][1];
            var dx = tx - px, dy = ty - py;
            var jump = Math.max(Math.abs(dx), Math.abs(dy));
            var n = (jump > half) ? Math.min(16, Math.ceil(jump / half)) : 1;   // strop 16 = pojistka proti smyčce
            for (i = 1; i <= n; i++) {
                var d = this.one(px + dx * i / n, py + dy * i / n);
                if (d) out += d;
            }
            px = tx; py = ty;
        }
        this.lx = x; this.ly = y;
        return out;
    };

    function touchMid(t) {
        var n = Math.min(t.length, 2), x = 0, y = 0;
        for (var i = 0; i < n; i++) { x += t[i].clientX; y += t[i].clientY; }
        return { x: x / n, y: y / n };
    }

    // ================================================================================
    // ŽIVÉ GESTO — CELÉ JEDNÍM TAHEM, BEZ NABÍDKY
    // ================================================================================
    // Zkratka se dělá ZPAMĚTI: aktivační gesto a hned za ním, BEZ ZVEDNUTÍ PRSTU,
    // tahy vybraného nástroje. Appka do toho nemluví — žádný seznam možností,
    // žádné „co můžeš nakreslit dál". Jediná zpětná vazba je drobný ukazatel
    // uprostřed (co máš zatím nakresleno) a krátké cuknutí vibrací u každého tahu,
    // ať poznáš, že se tah opravdu započítal. Zvednutí prstu gesto UZAVÍRÁ:
    // co sedí, spustí se, co nesedí, tiše zmizí.
    var strk = null;     // právě kreslený tah: { s, t0, snap, armed, pre, code, fired, drew, over }

    // ① TAHÁK JEN NA VYŽÁDÁNÍ. Rychlé gesto je úplně tiché. Když se ale prst po
    // aktivačním gestu ZASTAVÍ na HOLD_MS, teprve pak se pod ukazatelem rozbalí
    // soupis zkratek, které na rozkreslený tah sedí. Při normálním rychlém tahu
    // nevyskočí nikdy — a protože je to tentýž pohyb, čtení se samo přelije do
    // svalové paměti (stejný princip jako „marking menu" v profi softwaru).
    // Jakmile je jednou vidět, ZŮSTANE po zbytek tahu a jen se filtruje: uživatel
    // si ho vyžádal, blikat mu pod rukou by bylo horší než ho nechat.
    var holdT = null, sheetOn = false, holdAt = null;
    function holdRestart(x, y) {
        clearTimeout(holdT);
        holdAt = { x: x, y: y };
        if (!load().hold || sheetOn) return;
        holdT = setTimeout(function () {
            if (!strk || !strk.armed || strk.fired) return;
            sheetOn = true;
            buzz(8);
            paintChip(strk.code, '', '');
        }, HOLD_MS);
    }
    function holdStop() { clearTimeout(holdT); holdT = null; sheetOn = false; holdAt = null; }

    function overlay() { return document.getElementById(WRAP_ID); }

    // OTEVŘENÉ OKNO se nehledá procházením overlayů — čtyři domácí modály
    // (Nastavení, Body, Nástroje, Nový bod) jsou v CSS TRVALE `display:flex`
    // a viditelnost jim řídí třída .ag-open (viz skript na konci index.html),
    // takže „computed display" o otevření nevypovídá vůbec nic. Rozhoduje proto
    // JEN to, na čem tah začal: nad zavřeným oknem dotek dopadne na mapu, nad
    // otevřeným na okno samotné — a to je v NOGO. Jedna podmínka navíc je kolečko
    // nástrojů, které kreslí do vlastní vrstvy přes celou obrazovku.
    function canStart(target) {
        if (load().off) return false;
        if (!document.body.classList.contains('app-started')) return false;
        if (document.body.classList.contains('ag-kn-open')) return false;   // kolečko nástrojů
        try { if (target && target.closest && target.closest(NOGO)) return false; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:canStart'); }
        return true;
    }

    function onStart(e) {
        var t = e.touches;
        if (!t) return;
        lpStart(e);
        if (t.length !== load().fingers) { strk = null; return; }
        if (!canStart(e.target)) { strk = null; return; }
        var p = touchMid(t);
        strk = { s: new Stroke(p.x, p.y), t0: Date.now(), snap: mapSnap(), armed: false, pre: '', code: '', fired: false, drew: false, over: false };
    }

    function onMove(e) {
        lpMove(e);
        if (!strk) return;
        var t = e.touches;
        if (!t || !t.length) return;
        if (t.length !== load().fingers) { if (!strk.armed) strk = null; return; }
        // moc pomalé = posun mapy (platí jen do rozpoznání aktivačního gesta)
        if (!strk.armed && Date.now() - strk.t0 > PREFIX_MS) { strk = null; return; }
        var p = touchMid(t);
        // Prst se hnul → odpočet taháku začíná znovu (drobné chvění se nepočítá).
        if (strk.armed && holdAt && !sheetOn && (Math.abs(p.x - holdAt.x) > 10 || Math.abs(p.y - holdAt.y) > 10)) holdRestart(p.x, p.y);

        // ⚠ step() vrací 0..N šipek: rychlý tah jich stihne v jedné události víc
        // (viz komentář u Stroke.step). Zpracovávají se PO JEDNÉ, aby se aktivační
        // gesto mohlo rozpoznat uprostřed dávky a zbytek už padl do zkratky —
        // přesně jak by to dopadlo při pomalém tahu.
        var ds = strk.s.step(p.x, p.y);
        var pre = load().prefix;
        for (var i = 0; i < ds.length; i++) {
            if (!strk) return;
            var d = ds.charAt(i);
            if (strk.armed) { strk.drew = true; addArrow(d); continue; }
            strk.pre += d;
            if (strk.pre === pre) { arm(p); continue; }
            if (pre.indexOf(strk.pre) !== 0) { strk = null; return; }   // odbočil jinam → nejde o gesto
        }
        if (strk && strk.armed) {
            // Od rozpoznání patří pohyb NÁM: mapa se nesmí posouvat ani škubnout.
            // ⚠ Platí to UŽ PRO TENHLE pohyb. Bez toho by obsluha mapy (bublání,
            // běží až po nás) zpracovala poslední kousek tahu: mapa by o kus
            // poskočila hned po tom, co jsme ji vrátili, a hlavně by si znovu
            // zvedla `_mapHold` — a ten by pak zůstal navěky (její touchend už
            // kvůli stopPropagation nedorazí), takže by se mapa přestala točit
            // podle kompasu. Odhaleno zkouškou v prohlížeči.
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
        }
    }

    function onEnd(e) {
        if (!strk) return;
        if (e.touches && e.touches.length) return;      // druhý prst ještě drží
        var st = strk;
        strk = null;
        lpCancel();
        holdStop();
        if (!st.armed) return;
        e.stopPropagation();
        if (st.drew) swallowClick();
        if (st.fired) return;                           // spuštěno už za pohybu prstu
        decide(st, false);
    }
    function onCancel() {
        if (!strk) return;
        if (strk.armed) { holdStop(); hideChip(160); }
        strk = null;
        lpCancel();
    }

    // ---- ② PODRŽENÍ V NÁSTROJÍCH = DÁT NÁSTROJI GESTO ------------------------------
    // Zkratka vzniká tam, kde nástroj používáš, ne až v Nastavení. Krátké klepnutí
    // funguje dál; po podržení se následný klik spolkne, aby se nástroj neotevřel.
    //
    // ⚠ NEJDE JEN O DLAŽDICE. Nástroje ukazují SEZNAM ÚKONŮ (js/nastroje-ukony.js) a
    // mřížka `.tool-tile` je při něm SCHOVANÁ — vyjede až při hledání. Kdyby se
    // poslouchalo jen na dlaždicích, podržení by v běžném pohledu nedělalo nic
    // (ověřeno v prohlížeči: skrytá dlaždice má nulový rozměr, dotek na ni vůbec
    // nedopadne). Proto se bere i řádek seznamu `.ag-uk-i`, který kvůli tomu nese
    // `data-k` s klíčem nástroje.
    var lp = null;
    function tileKeyOf(t) {
        var dt = t.getAttribute('data-tool');
        if (dt) return dt;
        var ms = (t.getAttribute('onclick') || '').match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function lpStart(e) {
        lpCancel();
        if (load().off || !load().lp) return;
        var t = e.touches;
        if (!t || t.length !== 1) return;
        var tile = null;
        try { tile = e.target && e.target.closest ? e.target.closest('.tool-tile, .ag-uk-i[data-k]') : null; } catch (er) { window.AG && AG.swallow && AG.swallow(er, 'gesta-zkratky:lpStart'); }
        if (!tile || tile.id === 'ag-sm-allbtn') return;
        var k = tile.getAttribute('data-k') || tileKeyOf(tile);
        if (!k) return;
        lp = { k: k, x: t[0].clientX, y: t[0].clientY, t: null };
        lp.t = setTimeout(function () { lpFire(); }, LP_MS);
    }
    function lpMove(e) {
        if (!lp) return;
        var t = e.touches;
        if (!t || !t.length) { lpCancel(); return; }
        if (Math.abs(t[0].clientX - lp.x) > LP_TOL || Math.abs(t[0].clientY - lp.y) > LP_TOL) lpCancel();
    }
    function lpCancel() { if (lp) { clearTimeout(lp.t); lp = null; } }
    function lpFire() {
        var k = lp ? lp.k : null;
        lpCancel();
        if (!k) return;
        buzz(30);
        swallowClick();          // ať se nástroj neotevře
        assignFor(k);
    }
    // Otevře kreslicí plochu pro jeden nástroj. Když už gesto má, nabídne ho
    // PŘEPSAT (dvě gesta na týž nástroj by si nikdo nepamatoval).
    function assignFor(k) {
        var m = load().map, old = null, c;
        for (c in m) if (m[c] === k) { old = c; break; }
        var title = old
            ? ('Nové gesto pro „' + toolLabel(k) + '"'
                + ' — teď má ' + arrows(load().prefix) + ' ' + arrows(old))
            : ('Nakresli gesto pro „' + toolLabel(k) + '"');
        openPad(title, 1, function (nc) {
            if (old && nc === old) return true;
            if (old) delete load().map[old];
            if (assign(nc, k)) return true;
            if (old) { load().map[old] = k; renderSettings(); }
            return false;
        }, lastPrefixDir());
    }

    // Po tažení, které začalo nad tlačítkem, umí prohlížeč doručit ještě klik —
    // spolkneme ho, ať se nespustí něco, od čeho jsi jen odjížděl (vzor modal-close.js).
    function swallowClick() {
        var f = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
        document.addEventListener('click', f, true);
        setTimeout(function () { document.removeEventListener('click', f, true); }, 400);
    }

    // ---- rozpoznané aktivační gesto ------------------------------------------------------
    function arm(p) {
        strk.armed = true;
        strk.s.lenient = 1;      // od téhle chvíle patří tah nám → měkčí práh pro rozklad lomu

        mapBack(strk.snap);              // vrať mapu tam, kde byla před gestem
        buzz(25);
        showChip();
        paintChip('', '', '');
        holdRestart(p.x, p.y);
    }
    function addArrow(d) {
        if (strk.fired) return;
        if (strk.code.length >= MAXSEG) {
            // Delší zkratka existovat nemůže, další tahy tedy nemá cenu sbírat.
            // Ukazatel jen zčervená — křičet na uživatele uprostřed tahu nemá smysl.
            if (!strk.over) { strk.over = true; paintChip(strk.code, 'bad', ''); }
            return;
        }
        strk.code += d;
        buzz(10);
        paintChip(strk.code, '', '');
        decide(strk, true);
    }

    // drawing = true → rozhoduje se ještě za pohybu prstu
    function decide(st, drawing) {
        if (st.fired) return;
        var code = st.code, k = load().map[code];
        // ⑦ Samotné aktivační gesto (zvednu prst hned za ním) zopakuje POSLEDNÍ
        // spuštěnou zkratku. Nejlevnější „ještě jednou to samé" v terénu — a dokud
        // se nespustí první zkratka, nedělá to nic, takže to nikoho nepřekvapí.
        if (!code) {
            if (drawing) return;
            var c = load();
            if (c.solo && c.last && c.map[c.last]) { st.code = c.last; fire(st, c.last, c.map[c.last]); return; }
            miss('');
            return;
        }
        // Spustit HNED, jakmile je jasno: kód sedí a žádná delší zkratka jím
        // nezačíná. Nečeká se na zvednutí prstu a nástroj naskočí pod rukou.
        if (k && !extended(code)) { fire(st, code, k); return; }
        if (drawing) return;
        if (k) { fire(st, code, k); return; }
        miss(code);
    }
    function extended(code) {
        var m = load().map;
        for (var c in m) if (c !== code && c.indexOf(code) === 0) return true;
        return false;
    }

    function fire(st, code, k) {
        st.fired = true;
        holdStop();
        if (load().last !== code) { load().last = code; save(); }
        buzz(30);
        paintChip(code, 'hit', toolLabel(k));   // jediná zpráva: co se spouští
        setTimeout(function () { hideChip(0); }, CHIP_MS);
        if (!toolReady(k)) { toast('Nástroj „' + toolLabel(k) + '" teď není dostupný.'); return; }
        if (!runTool(k)) toast('Nástroj „' + toolLabel(k) + '" se nepodařilo otevřít.');
    }
    // Nesedící gesto se NEKOMENTUJE oknem ani nabídkou — jen krátce zčervená a zmizí.
    // Kdo si nevzpomene, najde soupis v Nastavení; smysl téhle vrstvy je dělat
    // zkratky zpaměti, ne se u nich zdržovat.
    function miss(code) {
        holdStop();
        paintChip(code, 'bad', code ? 'nepřiřazeno' : '');
        hideChip(code ? 620 : 220);
    }

    // ================================================================================
    // UKAZATEL NAKRESLENÉHO (drobný, nic neblokuje)
    // ================================================================================
    // Není to nabídka ani okno: leží uprostřed, NEBERE dotyky (pointer-events:none)
    // a nic pod sebou neztmavuje. Ukazuje jen aktivační gesto (zesláble) a k němu
    // tahy, které už máš nakreslené — aby bylo poznat, že se tah započítal.
    var chipTimer = null;
    function showChip() {
        injectStyles();
        var w = overlay();
        if (!w) {
            w = document.createElement('div');
            w.id = WRAP_ID;
            w.innerHTML = '<div class="gz-chip"><div class="gz-code"><span class="gz-pre"></span><b class="gz-now"></b></div>' +
                '<div class="gz-lb"></div><div class="gz-sheet"></div></div>';
            document.body.appendChild(w);
        }
        clearTimeout(chipTimer);
        w.style.display = 'flex';
        w.classList.remove('gz-out');
    }
    function paintChip(code, cls, label) {
        var w = overlay();
        if (!w) return;
        w.querySelector('.gz-pre').textContent = arrows(load().prefix);
        var now = w.querySelector('.gz-now');
        now.textContent = arrows(code);
        now.className = 'gz-now' + (cls ? ' ' + cls : '');
        var lb = w.querySelector('.gz-lb');
        lb.textContent = label || '';
        lb.className = 'gz-lb' + (cls ? ' ' + cls : '');

        // ① tahák — jen když si ho uživatel vyžádal zastavením prstu
        var sh = w.querySelector('.gz-sheet');
        if (!sh) return;
        if (!sheetOn || cls === 'hit') { sh.style.display = 'none'; sh.innerHTML = ''; return; }
        var m = load().map, keys = [], c;
        for (c in m) if (!code || c.indexOf(code) === 0) keys.push(c);
        keys.sort();
        var h = '';
        for (var i = 0; i < keys.length; i++) {
            var k = m[keys[i]];
            h += '<div class="gz-line' + (toolReady(k) ? '' : ' off') + '">' +
                '<span class="gz-a">' + arrows(keys[i]) + '</span>' +
                '<span class="gz-t">' + esc(toolLabel(k)) + '</span></div>';
        }
        sh.innerHTML = h || '<div class="gz-line off"><span class="gz-t">Tudy nevede žádná zkratka.</span></div>';
        // ⚠ ne `= ''`: v injectStyles má `.gz-sheet` display:none, takže vyprázdnění
        // inline stylu by ho zase schovalo. Musí se nastavit natvrdo.
        sh.style.display = 'block';
    }
    function hideChip(delay) {
        var w = overlay();
        if (!w) return;
        clearTimeout(chipTimer);
        chipTimer = setTimeout(function () {
            var el = overlay();
            if (!el) return;
            el.classList.add('gz-out');
            chipTimer = setTimeout(function () {
                var e2 = overlay();
                if (e2) { e2.style.display = 'none'; e2.classList.remove('gz-out'); }
            }, 200);
        }, delay || 0);
    }

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    // ================================================================================
    // NASTAVENÍ: řádek ve Vzhledu → Ovládání + vlastní okno se zkratkami
    // ================================================================================
    function injectSettingRow() {
        if (document.getElementById('ag-gz-setrow')) return;
        var anchor = document.getElementById('s-lefthand');
        var row = anchor && anchor.closest ? anchor.closest('.st-row') : null;
        if (!row || !row.parentNode) return;
        var div = document.createElement('div');
        div.className = 'st-row'; div.id = 'ag-gz-setrow';
        div.innerHTML = '<span class="st-lab">Gesta – zkratky nástrojů' +
            '<small>jedním tahem: <b>' + arrows(load().prefix) + '</b> a rovnou zkratka nástroje</small></span>' +
            '<span class="ag-gz-cell"><button type="button" class="btn btn-secondary ag-gz-open">Nastavit…</button>' +
            '<label class="st-sw"><input type="checkbox" id="ag-gz-on"><span class="st-sw-face"></span></label></span>';
        row.parentNode.insertBefore(div, row.nextSibling);
        var cb = div.querySelector('#ag-gz-on');
        cb.checked = !load().off;
        cb.addEventListener('change', function () { load().off = cb.checked ? 0 : 1; save(); });
        div.querySelector('.ag-gz-open').addEventListener('click', function () { openSettings(); });
    }

    // ================================================================================
    // ③ NABÍDKA GESTA PODLE SKUTEČNÉHO POUŽITÍ
    // ================================================================================
    // Počítadlo `agToolUsage_v1` (klíč -> počet) vede js/field-tools.js odjakživa,
    // takže se nic nového neměří. Když nějaký nástroj otevřeš aspoň OFFER_MIN×
    // a gesto nemá, appka se JEDNOU zeptá, jestli mu ho dát.
    //
    // KDY se ptá: ve chvíli, kdy OTEVŘEŠ Nástroje — tam ten nástroj stejně jdeš
    // hledat, takže je to přesně ta chvíle, kdy dává smysl říct „tohle už hledat
    // nemusíš". Ptát se po spuštění nástroje by skočilo doprostřed práce.
    // Nabídka padne nejvýš JEDNOU za běh appky a na každý nástroj nejvýš jednou
    // za život (seznam `offered`), takže z toho nemůže být otravné klikátko.
    var offerDone = false, toolsWasOpen = false;
    function toolsOpen() {
        var m = document.getElementById('tools-modal');
        return !!(m && m.style.display === 'flex');
    }
    function usage() {
        try { var o = JSON.parse(localStorage.getItem('agToolUsage_v1')); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
    }
    function hasGesture(k) {
        var m = load().map, c;
        for (c in m) if (m[c] === k) return true;
        return false;
    }
    function pickOffer() {
        var u = usage(), c = load(), best = null, bestN = OFFER_MIN - 1, k;
        for (k in u) {
            var n = +u[k] || 0;
            if (n <= bestN) continue;
            if (hasGesture(k)) continue;
            if (c.offered.indexOf(k) !== -1) continue;
            if (!toolReady(k)) continue;
            best = k; bestN = n;
        }
        return best ? { k: best, n: bestN } : null;
    }
    function offerTick() {
        var open = toolsOpen();
        if (!open) { toolsWasOpen = false; return; }
        if (toolsWasOpen) return;          // hlídá se JEN okamžik otevření
        toolsWasOpen = true;
        var c = load();
        if (c.off) return;
        // ② jednorázový tip, ať se o podržení dlaždice vůbec ví
        if (c.lp && !c.tip) { c.tip = 1; save(); toast('Tip: podržením dlaždice jí dáš gesto.'); return; }
        if (offerDone || !c.offer) return;
        var hit = pickOffer();
        if (!hit) return;
        offerDone = true;
        c.offered.push(hit.k); save();
        var lbl = toolLabel(hit.k);
        setTimeout(function () {
            try {
                window.agAsk('„' + lbl + '" jsi otevřel už ' + hit.n + '×. Chceš na něj gesto? Pak ho spustíš jedním tahem, bez hledání tady.',
                    { title: 'Zkratka gestem', okText: 'Dát mu gesto', cancelText: 'Teď ne' })
                    .then(function (yes) { if (yes) assignFor(hit.k); });
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:offerTick'); }
        }, 450);
    }

    // ---- okno se zkratkami -------------------------------------------------------------
    var pendingCode = null;    // kód, který se právě přiřazuje (z „Přiřadit…" nebo z padu)

    function settingsEl() {
        var el = document.getElementById(SET_ID);
        if (el) return el;
        injectStyles();
        el = document.createElement('div');
        el.className = 'modal-overlay';
        el.id = SET_ID;
        el.innerHTML = '<div class="modal-content">' +
            '<h2 style="color:var(--accent);margin-top:0;">Gesta – zkratky nástrojů</h2>' +
            '<p class="ag-gz-p">Nástroj spustíš <b>jedním tahem</b> kdekoli po displeji (mimo tlačítka a otevřená okna), ' +
            'a to <b>bez zvednutí prstu</b>: nejdřív aktivační gesto <b class="ag-gz-prefix"></b>, rovnou za ním zkratka nástroje. ' +
            'Appka při tom nic nenabízí — jen krátce cukne a ukáže, co máš nakreslené. Zkratky se dělají zpaměti, ' +
            'tenhle seznam je na jejich nastavení, ne na hledání v terénu.</p>' +
            '<div class="st-row"><span class="st-lab">Zapnuto</span>' +
            '<label class="st-sw"><input type="checkbox" id="ag-gz-on2"><span class="st-sw-face"></span></label></div>' +
            '<div class="st-row"><span class="st-lab">Aktivační gesto<small class="ag-gz-prewords"></small></span>' +
            '<button type="button" class="btn btn-secondary" id="ag-gz-prefix-btn"></button></div>' +
            '<div class="st-row"><span class="st-lab">Kreslit<small>dvěma prsty se gesto nikdy nesplete s posunem mapy, ale hůř se dělá v rukavicích</small></span>' +
            '<select id="ag-gz-fingers"><option value="1">jedním prstem</option><option value="2">dvěma prsty</option></select></div>' +
            '<div class="st-row"><span class="st-lab">Délka tahu<small>kolik musí prst ujet, aby se tah počítal; v rukavicích se práh sám zvětší</small></span>' +
            '<select id="ag-gz-seg"><option value="kratke">krátké</option><option value="stredni">střední</option><option value="dlouhe">dlouhé</option></select></div>' +
            '<div class="st-row"><span class="st-lab">Tahák po podržení prstu<small>zastav prst uprostřed gesta a ukáže se soupis; při rychlém tahu nevyskočí</small></span>' +
            '<label class="st-sw"><input type="checkbox" id="ag-gz-hold"><span class="st-sw-face"></span></label></div>' +
            '<div class="st-row"><span class="st-lab">Přiřazovat gesto podržením dlaždice<small>podržíš dlaždici v Nástrojích a rovnou jí nakreslíš gesto. Výchozí je vypnuto — delší klepnutí (v rukavicích, za chůze) jinak místo nástroje otevře kreslicí plochu.</small></span>' +
            '<label class="st-sw"><input type="checkbox" id="ag-gz-lp"><span class="st-sw-face"></span></label></div>' +
            '<div class="st-row"><span class="st-lab">Samotné aktivační gesto<small>co udělá, když prst zvedneš hned za ním</small></span>' +
            '<select id="ag-gz-solo"><option value="1">poslední zkratka</option><option value="0">nic</option></select></div>' +
            '<div class="st-row"><span class="st-lab">Nabízet gesta podle použití<small>výchozí je vypnuto — zapnuté se appka u často otvíraného nástroje jednou zeptá, jestli mu dát gesto</small></span>' +
            '<label class="st-sw"><input type="checkbox" id="ag-gz-offer"><span class="st-sw-face"></span></label></div>' +
            '<h3 class="set-h" style="margin-top:18px;">Zkratky</h3>' +
            '<div id="ag-gz-rows"></div>' +
            '<button class="btn" id="ag-gz-add" style="margin-top:10px;">+ Přidat zkratku</button>' +
            '<button class="btn btn-secondary" id="ag-gz-train" style="margin-top:8px;">Zkus si to — trenažér</button>' +
            '<button class="btn btn-secondary" id="ag-gz-def" style="margin-top:8px;">Obnovit výchozí zkratky</button>' +
            '<button class="btn btn-secondary" id="ag-gz-close" style="margin-top:8px;">Zavřít</button>' +
            '</div>';
        document.body.appendChild(el);

        el.querySelector('#ag-gz-on2').addEventListener('change', function () {
            load().off = this.checked ? 0 : 1; save();
            var c = document.getElementById('ag-gz-on'); if (c) c.checked = this.checked;
        });
        el.querySelector('#ag-gz-fingers').addEventListener('change', function () {
            load().fingers = (this.value === '2') ? 2 : 1; save();
        });
        el.querySelector('#ag-gz-seg').addEventListener('change', function () {
            load().seg = SEG_STEP[this.value] ? this.value : 'stredni'; save();
        });
        el.querySelector('#ag-gz-hold').addEventListener('change', function () { load().hold = this.checked ? 1 : 0; save(); });
        el.querySelector('#ag-gz-lp').addEventListener('change', function () { load().lp = this.checked ? 1 : 0; save(); });
        el.querySelector('#ag-gz-offer').addEventListener('change', function () { load().offer = this.checked ? 1 : 0; save(); });
        el.querySelector('#ag-gz-solo').addEventListener('change', function () { load().solo = (this.value === '1') ? 1 : 0; save(); });
        el.querySelector('#ag-gz-train').addEventListener('click', function () { openTrainer(); });
        el.querySelector('#ag-gz-prefix-btn').addEventListener('click', function () {
            openPad('Nakresli aktivační gesto', 2, function (code) {
                if (code.length < 2) { toast('Aktivační gesto musí mít aspoň dva tahy — jeden by se pletl s posunem mapy.'); return false; }
                // Nové gesto může znepřístupnit už přiřazené zkratky (viz pravidlo
                // o dvou stejných šipkách za sebou) — radši to řekneme rovnou, než
                // aby uživatel v terénu marně kreslil zkratku, která nejde nakreslit.
                var last = code.charAt(code.length - 1), m = load().map, kolize = [];
                for (var c in m) if (c.charAt(0) === last) kolize.push(arrows(c));
                if (kolize.length) {
                    toast('Nešlo by nakreslit: ' + kolize.join(' ') + ' — začínají stejným směrem, jakým nové gesto končí. Změň napřed je.');
                    return false;
                }
                load().prefix = code; save(); renderSettings(); refreshRowHint();
                return true;
            });
        });
        el.querySelector('#ag-gz-add').addEventListener('click', function () { openPicker(); });
        el.querySelector('#ag-gz-def').addEventListener('click', function () {
            var d = defaults();
            var c = load();
            c.map = d.map; c.prefix = d.prefix; c.last = ''; save(); renderSettings(); refreshRowHint();
            toast('Zkratky vrácené na výchozí.');
        });
        el.querySelector('#ag-gz-close').addEventListener('click', function () { el.style.display = 'none'; });
        el.addEventListener('click', function (ev) {
            var b = ev.target && ev.target.closest ? ev.target.closest('button[data-act]') : null;
            if (!b) return;
            var act = b.getAttribute('data-act'), code = b.getAttribute('data-code');
            if (act === 'del') {
                delete load().map[code]; save(); renderSettings();
            } else if (act === 'edit') {
                var k = load().map[code];
                openPad('Nové gesto pro „' + toolLabel(k) + '"', 1, function (nc) {
                    if (nc === code) return true;
                    var back = load().map[code];
                    delete load().map[code];
                    if (assign(nc, k)) return true;
                    load().map[code] = back;   // neprošlo → vrátit původní přiřazení
                    renderSettings();
                    return false;
                }, lastPrefixDir());
            }
        });
        return el;
    }

    function renderSettings() {
        var el = document.getElementById(SET_ID);
        if (!el) return;
        var c = load();
        el.querySelector('#ag-gz-on2').checked = !c.off;
        el.querySelector('#ag-gz-fingers').value = String(c.fingers);
        el.querySelector('#ag-gz-seg').value = c.seg;
        el.querySelector('#ag-gz-hold').checked = !!c.hold;
        el.querySelector('#ag-gz-lp').checked = !!c.lp;
        el.querySelector('#ag-gz-offer').checked = !!c.offer;
        el.querySelector('#ag-gz-solo').value = c.solo ? '1' : '0';
        el.querySelector('.ag-gz-prefix').textContent = arrows(c.prefix);
        el.querySelector('#ag-gz-prefix-btn').textContent = arrows(c.prefix) + '  Změnit';
        el.querySelector('.ag-gz-prewords').innerHTML = wordsHtml(c.prefix);

        var codes = [], k;
        for (k in c.map) codes.push(k);
        codes.sort();
        var h = '';
        for (var i = 0; i < codes.length; i++) {
            var key = c.map[codes[i]], ready = toolReady(key);
            h += '<div class="ag-gz-row"><span class="ag-gz-box" title="' + esc(arrows(c.prefix) + ' ' + arrows(codes[i])) + '">'
                + strokeSvg(c.prefix, codes[i]) + '</span>' +
                '<span class="ag-gz-lb' + (ready ? '' : ' off') + '">' + esc(toolLabel(key)) +
                '<i>' + arrows(c.prefix) + ' ' + arrows(codes[i]) + '</i>' +
                (ready ? '' : '<small>teď není v Nástrojích dostupný</small>') + '</span>' +
                '<button type="button" data-act="edit" data-code="' + codes[i] + '" title="Změnit gesto">✎</button>' +
                '<button type="button" data-act="del" data-code="' + codes[i] + '" title="Odebrat">✕</button></div>';
        }
        if (!codes.length) h = '<div class="ag-gz-empty">Zatím žádná zkratka. Přidej první tlačítkem níž.</div>';
        el.querySelector('#ag-gz-rows').innerHTML = h;
    }
    function refreshRowHint() {
        var r = document.getElementById('ag-gz-setrow');
        var s = r && r.querySelector('small');
        if (s) s.innerHTML = 'jedním tahem: <b>' + arrows(load().prefix) + '</b> a rovnou zkratka nástroje';
    }

    function openSettings(code) {
        var el = settingsEl();
        renderSettings();
        el.style.display = 'flex';
        if (code) { pendingCode = code; openPicker(code); }
    }

    // ---- výběr nástroje ------------------------------------------------------------------
    function openPicker(code) {
        var el = settingsEl();
        var box = document.getElementById('ag-gz-pick');
        if (!box) {
            box = document.createElement('div');
            box.className = 'modal-overlay'; box.id = 'ag-gz-pick';
            box.innerHTML = '<div class="modal-content">' +
                '<h2 style="color:var(--accent);margin-top:0;">Na který nástroj?</h2>' +
                '<div id="ag-gz-pick-ges"></div>' +
                '<input type="search" id="ag-gz-q" placeholder="Hledat nástroj…" autocomplete="off">' +
                '<div class="modal-body" id="ag-gz-tools"></div>' +
                '<button class="btn btn-secondary" id="ag-gz-pick-close">Zpět</button></div>';
            document.body.appendChild(box);
            box.querySelector('#ag-gz-pick-close').addEventListener('click', function () { box.style.display = 'none'; });
            box.querySelector('#ag-gz-q').addEventListener('input', function () { fillTools(this.value); });
            // Enter = první výsledek. Když člověk ví, co hledá, dopíše dvě písmena
            // a potvrdí — bez hledání toho jednoho řádku očima.
            box.querySelector('#ag-gz-q').addEventListener('keydown', function (ev) {
                if (ev.key !== 'Enter') return;
                var first = box.querySelector('#ag-gz-tools button[data-tool]');
                if (first) { ev.preventDefault(); first.click(); }
            });
            box.addEventListener('click', function (ev) {
                var b = ev.target && ev.target.closest ? ev.target.closest('button[data-tool]') : null;
                if (!b) return;
                var k = b.getAttribute('data-tool');
                box.style.display = 'none';
                if (pendingCode) {
                    var c = pendingCode; pendingCode = null;
                    assign(c, k);
                } else {
                    openPad('Nakresli gesto pro „' + toolLabel(k) + '"', 1, function (nc) { return assign(nc, k); }, lastPrefixDir());
                }
            });
        }
        if (code) pendingCode = code;
        // Dlazdice si moduly registruji prubezne - ikony proto sbirame pri kazdem
        // otevreni znovu, ne jednou za beh appky.
        ICO = null;
        // Nahore je videt gesto, ktere se prave prirazuje: aktivacni tah sede,
        // zkratka barevne. Bez toho je "Na ktery nastroj?" otazka bez kontextu.
        var ges = box.querySelector('#ag-gz-pick-ges');
        if (ges) {
            var pre = load().prefix;
            ges.innerHTML = code
                ? ('<div class="ag-gz-pges">' + strokeSvg(pre, code)
                    + '<div class="ag-gz-pges-t"><b>' + esc(arrows(pre)) + ' ' + esc(arrows(code)) + '</b>'
                    + '<small>' + (load().map[code]
                        ? 'gesto už má \u201e' + esc(toolLabel(load().map[code])) + '\u201c'
                        : 'tohle gesto zatím nikam nevede') + '</small></div></div>')
                : '<div class="ag-gz-pges ag-gz-pges-later"><div class="ag-gz-pges-t"><b>Nejdřív nástroj, pak gesto</b>'
                    + '<small>vyber nástroj a hned si k němu tah nakreslíš</small></div></div>';
        }
        fillTools('');
        box.querySelector('#ag-gz-q').value = '';
        box.style.display = 'flex';
        el.style.display = 'flex';
    }
    // ---- ikona nastroje: pujcena z jeho VLASTNI dlazdice v Nastrojich -------------
    // Registr (js/tools-registry.js) ikony nevede - kresli si je moduly samy pri
    // agRegisterFieldTool(). Druha tabulka ikon by se driv nebo pozdeji rozesla se
    // skutecnosti, tak si ikonu bereme rovnou z dlazdice. Kdyz dlazdice neni
    // (nenacteny modul, skryto roli), zustane obecna ikona a nic se nedeje.
    var ICO = null;
    var ICO_GEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>';
    var ICO_ACT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>';
    function toolIcon(k) {
        if (isAct(k)) return ICO_ACT;
        if (!ICO) {
            ICO = {};
            try {
                var tiles = document.querySelectorAll('#tools-modal .tool-tile');
                for (var ti = 0; ti < tiles.length; ti++) {
                    var key = tiles[ti].getAttribute('data-tool');
                    if (!key) {
                        // stejne cteni klice, jake dela js/nastroje-ukony.js (tileKey)
                        var ms = (tiles[ti].getAttribute('onclick') || '').match(/([A-Za-z_$][\w$]*)\s*\(/g);
                        key = ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
                    }
                    var svg = key ? tiles[ti].querySelector('svg') : null;
                    if (key && svg && !ICO[key]) ICO[key] = svg.outerHTML;
                }
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:toolIcon'); }
        }
        return ICO[k] || ICO_GEN;
    }
    // Kategorie z registru -> barva ramecku ikony. Orientace bez cteni.
    var CAT_CLS = {
        '\u004d\u011b\u0159en\u00ed': 'c-m',
        'Katastr a data': 'c-k',
        'Pom\u016fcky': 'c-p',
        'Vyty\u010dov\u00e1n\u00ed a n\u00e1\u010drt': 'c-v',
        'AR a kalibrace': 'c-a'
    };
    function catCls(k) {
        if (isAct(k)) return 'c-act';
        try { return CAT_CLS[(window.AGReg && AGReg.cat) ? AGReg.cat(k) : ''] || ''; } catch (e) { return ''; }
    }
    function gzFold(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:gzFold'); }
        return s;
    }
    // Zvyrazni v textu to, co uzivatel napsal - i kdyz se to trefilo do popisku.
    // Odstraneni diakritickych znamenek z NFD zachovava pocet znaku proti predloze,
    // takze index z "ocisteneho" retezce sedi i do puvodniho textu s hacky.
    function gzMark(text, q) {
        if (!q) return esc(text);
        var i = gzFold(text).indexOf(q);
        if (i < 0) return esc(text);
        return esc(text.slice(0, i)) + '<em>' + esc(text.slice(i, i + q.length)) + '</em>' + esc(text.slice(i + q.length));
    }
    function gzRow(k, lab, hint, q, first) {
        return '<button type="button" class="ag-gz-t' + (first ? ' ag-gz-t-hot' : '') + '" data-tool="' + esc(k) + '">'
            + '<span class="ag-gz-ic ' + catCls(k) + '">' + toolIcon(k) + '</span>'
            + '<span class="ag-gz-tx"><b>' + gzMark(lab, q) + '</b>'
            + (hint ? '<small>' + gzMark(hint, q) + '</small>' : '') + '</span>'
            + (first ? '<span class="ag-gz-kb">\u21b5</span>' : '')
            + '</button>';
    }
    function fillTools(q) {
        var host = document.getElementById('ag-gz-tools');
        if (!host) return;
        q = gzFold(q);
        var g = groups(), h = '', a, hay2, n = 0;
        // (4) akce appky jdou prvni: v terenu se saha spis po nich nez po oknech
        var arows = '';
        for (var ai = 0; ai < ACTIONS.length; ai++) {
            a = ACTIONS[ai];
            hay2 = gzFold('akce ' + a.l);
            if (q && hay2.indexOf(q) < 0) continue;
            arows += gzRow(a.k, a.l, '', q, n++ === 0);
        }
        if (arows) h += '<div class="ag-gz-grp">Akce appky</div>' + arows;
        for (var i = 0; i < g.length; i++) {
            var rows = '';
            for (var j = 0; j < g[i].items.length; j++) {
                var it = g[i].items[j];
                var lab = it.l || it.k;
                // Do hledaneho textu patri i SYNONYMA z registru ("pasmo", "distance").
                // Bez nich se nenajde nastroj, jehoz nazev clovek nezna - a to je
                // presne ten pripad, kdy se hleda.
                var syn = '';
                try { syn = (window.AGReg && AGReg.aliases) ? AGReg.aliases(it.k) : ''; } catch (e) { syn = ''; }
                var hay = gzFold(lab + ' ' + (it.h || '') + ' ' + g[i].t + ' ' + syn);
                if (q && hay.indexOf(q) < 0) continue;
                rows += gzRow(it.k, lab, it.h || '', q, n++ === 0);
            }
            if (rows) h += '<div class="ag-gz-grp">' + esc(g[i].t) + '</div>' + rows;
        }
        host.innerHTML = h || '<div class="ag-gz-empty">Nic takov\u00e9ho tu nen\u00ed.</div>';
    }
    // Vrací false = neuloženo (volající pak nechá kreslicí plochu otevřenou).
    function assign(code, k) {
        // ⚠⚠ Celá zkratka se kreslí JEDNÍM TAHEM, takže dvě stejné šipky za sebou
        // nakreslit nejde — je to jeden rovný tah. Zkratka začínající směrem, kterým
        // končí aktivační gesto, by tedy byla NEDOSAŽITELNÁ. Dřív to bylo jen
        // varování (tehdy se dalo došvihnout po zvednutí prstu); teď se odmítá.
        if (code.charAt(0) === lastPrefixDir()) {
            toast('Zkratka nemůže začínat ' + DIRNAME[lastPrefixDir()] + ' — tím končí aktivační gesto a dva stejné tahy za sebou jedním tahem nenakreslíš.');
            return false;
        }
        if (load().map[code] && load().map[code] !== k) {
            toast('Gesto ' + arrows(code) + ' už má „' + toolLabel(load().map[code]) + '".');
            return false;
        }
        load().map[code] = k; save(); renderSettings();
        toast('Zkratka ' + arrows(load().prefix) + ' ' + arrows(code) + ' → ' + toolLabel(k));
        return true;
    }
    function lastPrefixDir() { var p = load().prefix; return p.charAt(p.length - 1); }

    // ---- kreslicí plocha („nauč se gesto") -------------------------------------------------
    var padState = null;
    // forbid = směr, kterým NESMÍ zkratka začínat (viz assign) — '' u aktivačního gesta
    function openPad(title, minLen, onSave, forbid) {
        injectStyles();
        var el = document.getElementById(PAD_ID);
        if (!el) {
            el = document.createElement('div');
            el.className = 'modal-overlay'; el.id = PAD_ID;
            // ⚠⚠ data-no-swipe je tu ŽIVOTNĚ DŮLEŽITÉ: js/modal-close.js zavírá modály
            // VODOROVNÝM TAHEM a po tahu delším než ARM_PX ještě spolkne následující
            // klik. Kreslení gesta je z jeho pohledu přesně takový tah — okno se při
            // učení gesta zavíralo a tlačítko „Uložit" pak nešlo zmáčknout (klik se
            // spolkl). Ověřeno v prohlížeči; bez tohohle atributu se zkratka NEULOŽÍ.
            el.setAttribute('data-no-swipe', '');
            el.innerHTML = '<div class="modal-content">' +
                '<h2 style="color:var(--accent);margin-top:0;" class="gzp-title"></h2>' +
                '<div class="gzp-area" id="ag-gz-area"><span class="gzp-hint">Táhni prstem sem</span><span class="gzp-code"></span></div>' +
                '<div class="gzp-note"></div>' +
                '<button class="btn" id="ag-gz-padsave">Uložit</button>' +
                '<button class="btn btn-secondary" id="ag-gz-padagain" style="margin-top:8px;">Nakreslit znovu</button>' +
                '<button class="btn btn-secondary" id="ag-gz-padcancel" style="margin-top:8px;">Zrušit</button>' +
                '</div>';
            document.body.appendChild(el);
            var area = el.querySelector('#ag-gz-area');
            var start = function (x, y) { padState.s = new Stroke(x, y); };
            var move = function (x, y) {
                if (!padState || !padState.s) return;
                var d = padState.s.step(x, y);
                if (!d) return;
                if (padState.code.length >= MAXSEG) return;
                padState.code += d;
                buzz(10);
                paintPad();
            };
            area.addEventListener('touchstart', function (e) { if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
            area.addEventListener('touchmove', function (e) {
                if (e.touches.length !== 1) return;
                if (e.cancelable) e.preventDefault();
                move(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: false });
            // myš jen kvůli zkoušení v prohlížeči — v terénu se kreslí prstem
            area.addEventListener('pointerdown', function (e) { if (padState && e.pointerType !== 'touch') { padState.md = true; start(e.clientX, e.clientY); } });
            area.addEventListener('pointermove', function (e) { if (padState && padState.md && e.pointerType !== 'touch') move(e.clientX, e.clientY); });
            window.addEventListener('pointerup', function () { if (padState) padState.md = false; });
            el.querySelector('#ag-gz-padagain').addEventListener('click', function () { padState.code = ''; padState.s = null; paintPad(); });
            el.querySelector('#ag-gz-padcancel').addEventListener('click', function () { el.style.display = 'none'; pendingCode = null; });
            el.querySelector('#ag-gz-padsave').addEventListener('click', function () {
                if (!padState || padState.code.length < padState.min) { toast('Nakresli aspoň ' + padState.min + ' tah' + (padState.min > 1 ? 'y' : '') + '.'); return; }
                if (padState.onSave(padState.code) !== false) el.style.display = 'none';
            });
        }
        padState = { code: '', s: null, min: minLen || 1, onSave: onSave, md: false, forbid: forbid || '' };
        el.querySelector('.gzp-title').textContent = title;
        el.style.display = 'flex';
        paintPad();
    }
    function paintPad() {
        var el = document.getElementById(PAD_ID);
        if (!el || !padState) return;
        el.querySelector('.gzp-code').textContent = arrows(padState.code);
        el.querySelector('.gzp-hint').style.display = padState.code ? 'none' : '';
        var note = el.querySelector('.gzp-note');
        var bad = padState.forbid && padState.code.charAt(0) === padState.forbid;
        note.className = 'gzp-note' + (bad ? ' bad' : '');
        if (bad) {
            note.textContent = 'Takhle to nepůjde: aktivační gesto končí ' + DIRNAME[padState.forbid] +
                ' a dva stejné tahy za sebou jedním tahem nenakreslíš. Začni jiným směrem.';
        } else {
            note.textContent = padState.code
                ? (words(padState.code) + (padState.code.length >= MAXSEG ? ' — víc tahů zkratka mít nemůže' : ''))
                : 'Nejvýš ' + MAXSEG + ' tahy. Směry: nahoru, dolů, doleva, doprava.';
        }
    }

    // ================================================================================
    // ⑤ TRENAŽÉR („zkus si to")
    // ================================================================================
    // Appka řekne NÁZEV nástroje a ty máš nakreslit celé gesto — aktivační i zkratku,
    // tedy přesně ten pohyb, který pak uděláš v terénu. Šipky se přitom NEUKAZUJÍ
    // (to by bylo obkreslování, ne učení); ukážou se až po vyhodnocení. Nic se
    // nespouští, takže se nedá nic rozbít.
    var trState = null;
    function openTrainer() {
        injectStyles();
        var m = load().map, codes = [], c;
        for (c in m) codes.push(c);
        if (!codes.length) { toast('Nejdřív si přiřaď aspoň jednu zkratku.'); return; }

        var el = document.getElementById(TR_ID);
        if (!el) {
            el = document.createElement('div');
            el.className = 'modal-overlay'; el.id = TR_ID;
            el.setAttribute('data-no-swipe', '');   // ⚠ viz komentář u kreslicí plochy
            el.innerHTML = '<div class="modal-content">' +
                '<h2 style="color:var(--accent);margin-top:0;">Nakresli zkratku pro:</h2>' +
                '<div class="tr-want"></div>' +
                '<div class="gzp-area" id="ag-gz-trarea"><span class="gzp-hint">Celé gesto, jedním tahem</span><span class="gzp-code"></span></div>' +
                '<div class="gzp-note tr-note"></div>' +
                '<div class="tr-score"></div>' +
                '<button class="btn" id="ag-gz-trnext">Další</button>' +
                '<button class="btn btn-secondary" id="ag-gz-trclose" style="margin-top:8px;">Konec</button>' +
                '</div>';
            document.body.appendChild(el);
            var area = el.querySelector('#ag-gz-trarea');
            var start = function (x, y) {
                if (!trState || trState.done) return;
                trState.s = new Stroke(x, y); trState.drawn = ''; paintTr();
            };
            var move = function (x, y) {
                if (!trState || trState.done || !trState.s) return;
                var d = trState.s.step(x, y);
                if (!d || trState.drawn.length >= 8) return;
                trState.drawn += d; buzz(10); paintTr();
            };
            var end = function () { if (trState && !trState.done && trState.drawn) trCheck(); };
            area.addEventListener('touchstart', function (e) { if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
            area.addEventListener('touchmove', function (e) {
                if (e.touches.length !== 1) return;
                if (e.cancelable) e.preventDefault();
                move(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: false });
            area.addEventListener('touchend', end);
            area.addEventListener('pointerdown', function (e) { if (trState && e.pointerType !== 'touch') { trState.md = true; start(e.clientX, e.clientY); } });
            area.addEventListener('pointermove', function (e) { if (trState && trState.md && e.pointerType !== 'touch') move(e.clientX, e.clientY); });
            window.addEventListener('pointerup', function () { if (trState && trState.md) { trState.md = false; end(); } });
            el.querySelector('#ag-gz-trnext').addEventListener('click', function () { trNext(); });
            el.querySelector('#ag-gz-trclose').addEventListener('click', function () { el.style.display = 'none'; trState = null; });
        }
        trState = { ok: 0, n: 0, want: null, drawn: '', s: null, md: false, done: false };
        trNext();
        el.style.display = 'flex';
    }
    function trNext() {
        if (!trState) return;
        var m = load().map, codes = [], c;
        for (c in m) codes.push(c);
        if (!codes.length) return;
        var pick = codes[Math.floor(Math.random() * codes.length)];
        // dvakrát po sobě totéž je k ničemu, pokud je z čeho vybírat
        if (codes.length > 1 && trState.want && pick === trState.want.code) {
            pick = codes[(codes.indexOf(pick) + 1) % codes.length];
        }
        trState.want = { code: pick, k: m[pick] };
        trState.drawn = ''; trState.s = null; trState.done = false;
        paintTr();
    }
    function trCheck() {
        var want = load().prefix + trState.want.code;
        trState.done = true;
        trState.n++;
        if (trState.drawn === want) { trState.ok++; buzz(30); } else buzz(60);
        paintTr();
    }
    function paintTr() {
        var el = document.getElementById(TR_ID);
        if (!el || !trState) return;
        el.querySelector('.tr-want').textContent = toolLabel(trState.want.k);
        el.querySelector('.gzp-code').textContent = arrows(trState.drawn);
        el.querySelector('.gzp-hint').style.display = trState.drawn ? 'none' : '';
        var note = el.querySelector('.tr-note'), want = load().prefix + trState.want.code;
        if (!trState.done) {
            note.className = 'gzp-note tr-note';
            note.textContent = 'Celé gesto: aktivační i zkratka, bez zvednutí prstu.';
        } else if (trState.drawn === want) {
            note.className = 'gzp-note tr-note good';
            note.textContent = 'Přesně tak: ' + arrows(want);
        } else {
            note.className = 'gzp-note tr-note bad';
            note.textContent = 'Správně je ' + arrows(want) + ', nakreslil jsi ' + arrows(trState.drawn) + '.';
        }
        el.querySelector('.tr-score').textContent = trState.n ? (trState.ok + ' z ' + trState.n + ' správně') : '';
    }

    // ================================================================================
    // STYLY
    // ================================================================================
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // ---- UKAZATEL NAKRESLENÉHO ----
            // z-index 10050 = stejná vrstva jako kolečko nástrojů: nad HUD i dokem,
            // POD modály (ty jedou výš). `pointer-events:none` je tu podstatné —
            // ukazatel se objevuje UPROSTŘED TAHU, takže nesmí sebrat ani jeden dotek.
            '#' + WRAP_ID + '{position:fixed;inset:0;z-index:10050;display:none;align-items:center;justify-content:center;',
            '  pointer-events:none;opacity:1;transition:opacity .18s;}',
            '#' + WRAP_ID + '.gz-out{opacity:0;}',
            '#' + WRAP_ID + ' .gz-chip{padding:14px 20px;border-radius:18px;text-align:center;',
            '  background:var(--glass-bg,rgba(18,22,28,0.86));border:1px solid var(--glass-border,rgba(255,255,255,0.10));',
            '  backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%);',
            '  box-shadow:0 12px 34px rgba(0,0,0,0.45);color:var(--text-color,#eceef2);}',
            '#' + WRAP_ID + ' .gz-code{font-size:calc(34px * var(--ag-font-scale,1));line-height:1.05;letter-spacing:.08em;',
            '  text-shadow:0 2px 8px rgba(0,0,0,0.6);}',
            '#' + WRAP_ID + ' .gz-pre{opacity:.32;}',
            '#' + WRAP_ID + ' .gz-now{color:var(--accent-bright,#3eb487);}',
            '#' + WRAP_ID + ' .gz-now.bad{color:#ef4444;}',
            '#' + WRAP_ID + ' .gz-now.hit{color:var(--accent-bright,#3eb487);}',
            '#' + WRAP_ID + ' .gz-lb{margin-top:4px;font-size:calc(13px * var(--ag-font-scale,1));font-weight:600;',
            '  color:var(--accent-bright,#3eb487);}',
            '#' + WRAP_ID + ' .gz-lb:empty{display:none;}',
            '#' + WRAP_ID + ' .gz-lb.bad{color:#ef4444;font-weight:400;opacity:.85;}',
            // ① tahák: rozbalí se POD ukazatelem, až když prst chvíli stojí
            '#' + WRAP_ID + ' .gz-sheet{display:none;margin:10px -6px -4px;padding-top:9px;max-height:46vh;overflow:hidden;',
            '  border-top:1px solid var(--glass-border,rgba(255,255,255,0.10));text-align:left;}',
            '#' + WRAP_ID + ' .gz-line{display:flex;align-items:center;gap:10px;padding:4px 6px;',
            '  font-size:calc(12.5px * var(--ag-font-scale,1));white-space:nowrap;}',
            '#' + WRAP_ID + ' .gz-line.off{opacity:.45;}',
            '#' + WRAP_ID + ' .gz-line .gz-a{color:var(--accent-bright,#3eb487);letter-spacing:.05em;min-width:2.6em;}',
            // ---- řádek v Nastavení ----
            '.ag-gz-cell{display:flex;align-items:center;gap:10px;}',
            '.ag-gz-cell .btn{width:auto;margin:0;padding:7px 12px;font-size:calc(12.5px * var(--ag-font-scale,1));}',
            // ---- okno se zkratkami ----
            // ⚠ Řádky `.st-row`, popisky a přepínače má appka nastylované jen POD
            // `#settings-modal` (css/style.css). Ve vlastním okně by tedy vypadaly
            // jako holý formulář — popisek slepený s hodnotou a systémový čtvereček
            // místo přepínače. Tady je proto tentýž vzhled zopakovaný pro #ag-gz-set;
            // hodnoty se drží proměnných, takže motiv i velikost písma platí dál.
            '#' + SET_ID + ' .st-row{display:flex;align-items:center;justify-content:space-between;gap:12px;',
            '  padding:13px 0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.10));}',
            '#' + SET_ID + ' .st-row:last-of-type{border-bottom:none;}',
            '#' + SET_ID + ' .st-lab{font-size:calc(14.5px * var(--ag-font-scale,1));font-weight:600;color:var(--text-color,#eceef2);margin:0;}',
            '#' + SET_ID + ' .st-lab small{display:block;color:var(--text-muted,#9aa6b4);font-weight:400;margin-top:2px;',
            '  font-size:calc(11.5px * var(--ag-font-scale,1));}',
            '#' + SET_ID + ' .st-sw{position:relative;display:inline-block;width:46px;height:27px;flex:none;cursor:pointer;margin:0;}',
            '#' + SET_ID + ' .st-sw input{position:absolute;opacity:0;width:0;height:0;}',
            '#' + SET_ID + ' .st-sw .st-sw-face{position:absolute;inset:0;border-radius:99px;background:var(--surface-3,rgba(255,255,255,0.16));transition:background .2s ease;}',
            '#' + SET_ID + ' .st-sw .st-sw-face::after{content:"";position:absolute;top:3px;left:3px;width:21px;height:21px;border-radius:50%;',
            '  background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s ease;}',
            '#' + SET_ID + ' .st-sw input:checked + .st-sw-face{background:var(--accent,#2f9e74);}',
            '#' + SET_ID + ' .st-sw input:checked + .st-sw-face::after{transform:translateX(19px);}',
            '#' + SET_ID + ' select{width:auto;min-width:150px;margin:0;}',
            '#' + SET_ID + ' #ag-gz-prefix-btn{width:auto;margin:0;padding:8px 14px;white-space:nowrap;}',
            '#' + SET_ID + ' .ag-gz-p{font-size:calc(12.5px * var(--ag-font-scale,1));opacity:.8;line-height:1.5;margin:0 0 12px;}',
            '.ag-gz-row{display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;border-radius:12px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.10));background:rgba(255,255,255,0.04);}',
            // Okénko s nakresleným tahem místo řady šipek (viz strokeSvg vyš).
            '.ag-gz-row .ag-gz-box{flex:0 0 auto;width:46px;height:46px;border-radius:11px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--surface-2,rgba(255,255,255,0.06));',
            '  display:flex;align-items:center;justify-content:center;}',
            'body.ag-glove .ag-gz-row .ag-gz-box{width:54px;height:54px;}',
            '.ag-gz-tr{display:block;width:100%;height:100%;}',
            // aktivační gesto: tence a šedě — je stejné u všech zkratek, nemá poutat
            '.ag-gz-tr-p{fill:none;stroke:var(--text-muted,#9aa1ac);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;opacity:.55;}',
            // vlastní zkratka: silně a v barvě — tohle si má člověk zapamatovat
            '.ag-gz-tr-c{fill:none;stroke:var(--accent-bright,#3eb487);stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;}',
            '.ag-gz-tr-s{fill:none;stroke:var(--text-muted,#9aa1ac);stroke-width:1.6;opacity:.55;}',   /* kde prst začíná */
            '.ag-gz-tr-d{fill:var(--accent-bright,#3eb487);}',                                        /* kde ho zvedneš */
            '.ag-gz-row .ag-gz-lb{flex:1;min-width:0;font-size:calc(13px * var(--ag-font-scale,1));}',
            '.ag-gz-row .ag-gz-lb i{display:block;font-style:normal;letter-spacing:.08em;opacity:.5;',
            '  font-size:calc(11px * var(--ag-font-scale,1));}',
            '.ag-gz-row .ag-gz-lb small{display:block;opacity:.55;font-size:calc(11px * var(--ag-font-scale,1));}',
            '.ag-gz-row .ag-gz-lb.off{opacity:.5;}',
            '.ag-gz-row button{width:38px;height:38px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.10));',
            '  background:transparent;color:inherit;font-size:15px;}',
            '.ag-gz-empty{opacity:.6;font-size:calc(12.5px * var(--ag-font-scale,1));padding:10px 2px;}',
            '#ag-gz-tools{max-height:52vh;overflow:auto;}',
            // ---- vyber nastroje (navrh B1: rychla paleta) ----
            // Driv to byl sloupec stejnych sedych obdelniku: bez ikon, bez barev,
            // bez poradi. Nedalo se ocima preskocit na skupinu ani poznat nastroj
            // podle ikony. Ted ma kazdy radek SVOU ikonu (pujcenou z dlazdice),
            // ramecek v barve kategorie, druhy radek s upresnenim z registru
            // a to, co uzivatel napsal, je v radku zvyraznene.
            '#ag-gz-tools button.ag-gz-t{display:flex;align-items:center;gap:11px;width:100%;text-align:left;',
            '  margin-bottom:6px;padding:9px 11px;border-radius:12px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.10));background:rgba(255,255,255,0.04);color:inherit;',
            '  font:inherit;font-size:calc(13px * var(--ag-font-scale,1));}',
            // prvni vysledek = ten, ktery potvrdi Enter -> musi byt videt, ze je jiny
            '#ag-gz-tools button.ag-gz-t-hot{border-color:var(--accent-line,rgba(47,158,116,0.42));',
            '  background:var(--accent-soft,rgba(47,158,116,0.14));}',
            '.ag-gz-t .ag-gz-ic{flex:0 0 auto;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.42));background:var(--accent-soft,rgba(47,158,116,0.14));',
            '  color:var(--accent-bright,#3eb487);}',
            '.ag-gz-t .ag-gz-ic svg{width:18px;height:18px;display:block;}',
            // barva ramecku podle kategorie z registru (AGReg.cat)
            '.ag-gz-t .ag-gz-ic.c-m{border-color:rgba(230,189,118,0.42);background:rgba(230,189,118,0.13);color:var(--data,#e6bd76);}',
            '.ag-gz-t .ag-gz-ic.c-k{border-color:rgba(59,130,246,0.42);background:rgba(59,130,246,0.13);color:var(--accent-blue,#3b82f6);}',
            '.ag-gz-t .ag-gz-ic.c-v{border-color:rgba(139,92,246,0.44);background:rgba(139,92,246,0.14);color:#a78bfa;}',
            '.ag-gz-t .ag-gz-ic.c-a{border-color:rgba(244,114,182,0.42);background:rgba(244,114,182,0.13);color:var(--color-watch,#f472b6);}',
            '.ag-gz-t .ag-gz-tx{flex:1;min-width:0;}',
            '.ag-gz-t .ag-gz-tx b{display:block;font-weight:600;}',
            '.ag-gz-t .ag-gz-tx em{font-style:normal;border-radius:3px;padding:0 2px;',
            '  background:var(--accent-soft,rgba(47,158,116,0.28));color:var(--accent-bright,#3eb487);}',
            '#ag-gz-tools button small{display:block;opacity:.55;font-size:calc(11px * var(--ag-font-scale,1));}',
            '.ag-gz-t .ag-gz-kb{flex:0 0 auto;font-weight:700;font-size:calc(11px * var(--ag-font-scale,1));',
            '  color:var(--accent-bright,#3eb487);border:1px solid var(--accent-line,rgba(47,158,116,0.42));',
            '  border-radius:6px;padding:4px 6px;}',
            'body.ag-glove .ag-gz-t{padding:13px 12px;}',
            'body.ag-glove .ag-gz-t .ag-gz-ic{width:40px;height:40px;}',
            '.ag-gz-grp{margin:12px 0 6px;font-weight:700;font-size:calc(12px * var(--ag-font-scale,1));',
            '  text-transform:uppercase;letter-spacing:.06em;opacity:.6;display:flex;align-items:center;gap:8px;}',
            // linka za nazvem skupiny: oko najde predel bez cteni
            '.ag-gz-grp:after{content:"";flex:1;height:1px;background:var(--glass-border,rgba(255,255,255,0.10));}',
            // prouzek s gestem, ktere se prave prirazuje
            '.ag-gz-pges{display:flex;align-items:center;gap:11px;margin:0 0 12px;padding:10px 12px;border-radius:12px;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.42));background:var(--accent-soft,rgba(47,158,116,0.14));}',
            '.ag-gz-pges .ag-gz-tr{flex:0 0 auto;width:52px;height:52px;border-radius:12px;background:rgba(0,0,0,0.22);}',
            '.ag-gz-pges-t b{display:block;font-size:calc(14px * var(--ag-font-scale,1));}',
            '.ag-gz-pges-t small{display:block;opacity:.7;font-size:calc(11.5px * var(--ag-font-scale,1));}',
            // ---- kreslicí plocha ----
            '#' + PAD_ID + ' .gzp-area{position:relative;height:min(46vh,300px);margin:6px 0 10px;border-radius:16px;',
            '  border:2px dashed var(--glass-border,rgba(255,255,255,0.18));background:rgba(255,255,255,0.03);',
            '  display:flex;align-items:center;justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none;}',
            '#' + PAD_ID + ' .gzp-hint{opacity:.5;font-size:calc(13px * var(--ag-font-scale,1));}',
            '#' + PAD_ID + ' .gzp-code{position:absolute;font-size:calc(46px * var(--ag-font-scale,1));letter-spacing:.08em;',
            '  color:var(--accent-bright,#3eb487);}',
            '#' + PAD_ID + ' .gzp-note{font-size:calc(12px * var(--ag-font-scale,1));opacity:.7;margin-bottom:10px;min-height:1.4em;}',
            '#' + PAD_ID + ' .gzp-note.bad{color:#ef4444;opacity:1;}',
            // ⑤ trenažér sdílí vzhled kreslicí plochy
            '#' + TR_ID + ' .gzp-area{position:relative;height:min(40vh,260px);margin:6px 0 10px;border-radius:16px;',
            '  border:2px dashed var(--glass-border,rgba(255,255,255,0.18));background:rgba(255,255,255,0.03);',
            '  display:flex;align-items:center;justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none;}',
            '#' + TR_ID + ' .gzp-hint{opacity:.5;font-size:calc(13px * var(--ag-font-scale,1));}',
            '#' + TR_ID + ' .gzp-code{position:absolute;font-size:calc(40px * var(--ag-font-scale,1));letter-spacing:.08em;',
            '  color:var(--accent-bright,#3eb487);}',
            '#' + TR_ID + ' .gzp-note{font-size:calc(12.5px * var(--ag-font-scale,1));opacity:.75;margin-bottom:8px;min-height:1.4em;}',
            '#' + TR_ID + ' .gzp-note.good{color:var(--accent-bright,#3eb487);opacity:1;}',
            '#' + TR_ID + ' .gzp-note.bad{color:#ef4444;opacity:1;}',
            '#' + TR_ID + ' .tr-want{font-size:calc(20px * var(--ag-font-scale,1));font-weight:700;margin:2px 0 10px;}',
            '#' + TR_ID + ' .tr-score{font-size:calc(12px * var(--ag-font-scale,1));opacity:.6;margin-bottom:10px;}',
            // rukavice: větší cíle
            'body.ag-glove #' + WRAP_ID + ' .gz-row{padding:12px;}',
            'body.ag-glove .ag-gz-row button{width:44px;height:44px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ================================================================================
    // START
    // ================================================================================
    function init() {
        load();
        // CAPTURE fáze = jsme na řadě dřív než obsluha mapy v grafika.js (ta visí na
        // #map-container v bublání). Jen díky tomu jde posun mapy po rozpoznání gesta
        // utnout jediným stopPropagation.
        document.addEventListener('touchstart', onStart, { passive: true, capture: true });
        document.addEventListener('touchmove', onMove, { passive: false, capture: true });
        document.addEventListener('touchend', onEnd, { passive: false, capture: true });
        document.addEventListener('touchcancel', onCancel, { passive: true, capture: true });
        try { injectStyles(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:init'); }
        var tries = 0;
        var t = setInterval(function () {
            try { injectSettingRow(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:init'); }
            if (document.getElementById('ag-gz-setrow') || ++tries > 40) clearInterval(t);
        }, 400);
        // ③ sledování, kdy se otevřou Nástroje — přes SDÍLENÝ časovač appky, aby
        // kvůli tomu nevznikala další smyčka (viz úspora baterie v js/power-save.js)
        if (!window.__agGzTimer) {
            window.__agGzTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
                try { offerTick(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gesta-zkratky:init'); }
            }, 1200);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    // ---- dlaždice v Nástrojích ------------------------------------------------------
    // ⚠ NAHLÁŠENO 29. 8. 2026: „nemohu najít místo, kde si mohu vytvářet gesta —
    // přidej to jako další nástroj nebo to dej do nastavení." Řádek v Nastavení →
    // Vzhled tu byl odjakživa, ale nikdo ho tam nehledal. Gesta jsou teď i normální
    // dlaždice v Nástrojích (kategorie Pomůcky), takže se dají najít i hledáním.
    var TOOL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5v9a6 6 0 0 0 6 6h4a6 6 0 0 0 6-6v-3"/><path d="M20 11l-3 3M20 11l3 3" transform="translate(-3 0)"/><circle cx="4" cy="4" r="1.6"/></svg>';
    function registerTile() {
        if (typeof window.agRegisterFieldTool !== 'function') return;
        window.agRegisterFieldTool({
            id: 'gesta-zkratky', label: 'Gesta (zkratky)', icon: TOOL_ICON,
            cat: 'Pomůcky', order: 14, onClick: function () { openSettings(); }
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerTile);
    else registerTile();
    window.addEventListener('load', function () { setTimeout(registerTile, 350); });

    window.AGGesta = {
        open: openSettings,                       // otevře okno se zkratkami
        get: function () { return JSON.parse(JSON.stringify(load())); },
        // pro zkoušení v prohlížeči: „jako by uživatel dokreslil tenhle kód"
        simulate: function (code) {
            var st = { code: String(code || ''), fired: false, armed: true, drew: true };
            showChip();
            paintChip(st.code, '', '');
            decide(st, false);
        }
    };
})();
