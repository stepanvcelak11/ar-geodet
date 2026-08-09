// ===== AR Geodet — KOLEČKO NÁSTROJŮ (návrh N4, ODPOJITELNÁ vrstva) ==============
// Výběr nástroje TAŽENÍM, aniž by se zvedl prst z lišty. Prst leží na tlačítku
// Nástroje, hlavní obrazovka zhasne a uprostřed se objeví kruh se slovesy; vybírá
// se ÚHLEM tažení a potvrzuje NAČÍTÁNÍM (0,8 s). Druhé kolečko nabídne nástroje
// vybraného slovesa. Tvar prošel pěti koly zkoušení na telefonu, tohle jsou body,
// na kterých stojí a které se nesmí „zjednodušit":
//
//  • PLNÝ KRUH, ne výseč. (Výseč vypadala rozumně kvůli dosahu, ale uživatel ji
//    odmítl a s načítáním není potřeba — stačí popojet o dva centimetry.)
//  • NAČÍTÁNÍ 0,8 s. Prstenec odpočtu se kreslí KOLEM ZÁMĚRNÉHO KŘÍŽE, ne kolem
//    středu — plní se přesně tam, kam se člověk dívá.
//  • ZÁMĚRNÝ KŘÍŽ je UVNITŘ kruhu (ne u prstu, ten by ho zakryl) a jede PLYNULE
//    od středu ven úměrně posunu prstu, takže je vidět i pomalý pohyb. Je to
//    opravdu jen kříž — čtyři rysky a bod, žádný kroužek.
//  • ZVEDNUTÍ PRSTU na nástroji ho otevře HNED, čekat na načtení není povinné.
//  • „ZPĚT" je položka v kruhu DOLE. Vyjde přesně na 180° při sudém počtu položek;
//    u lichého je o půl výseče vedle. PRÁZDNÉ SMĚRY SE UŽ NENECHÁVAJÍ — dělaly
//    v květu díru („ať je to furt kytka, kolem dokola").
//  • KVĚT (9. 8. 2026): kruh je kytka. Každá položka je lístek, nápis leží natočený
//    v něm, uprostřed je malý květ s názvem toho, na co se míří. Po otevření se
//    poupě rozvine lístek po lístku (~0,8 s) a vybraný lístek se rozevře.
//  • RUŠENÍ POSUNEM PRSTU NEEXISTUJE (uživatel: „překáží"). Ruší jen zvednutí
//    prstu mimo položku.
//  • ČTECÍ ZÓNA za PARK px: přestane se vybírat, kříž zešedne a odjede dál,
//    nápověda zůstane v klidu — místo, kam se dá odjet a přečíst si ji.
//  • NÍZKÁ CITLIVOST: mrtvá zóna DEAD + úhlová hystereze HYST, jinak výběr na
//    rozhraní dvou směrů poskakuje.
//  • ZESÍLENÍ U OKRAJE (9. 8. 2026): tlačítko stojí u pravého okraje, takže palci
//    zbývá doprava jen pár desítek pixelů. V těsných směrech se posun násobí podle
//    toho, kolik místa kotva reálně má — viz measureGain() / reanchor() níž.
//
// ⚠⚠ POHYB SE POSLOUCHÁ NA `window`, NE NA TLAČÍTKU. Na myši drží
// setPointerCapture, na DOTYKU ne — jakmile prst z tlačítka sjede, žádná další
// událost nedorazí a druhé kolečko se nikdy neotevře. Testovat DOTYKEM a
// PLYNULÝM tahem po malých krocích; skok z A do B mezistavy přeskočí.
//
// Nic si nevede vlastní: slovesa i spouštění bere z js/nastroje-ukony.js
// (AGUkony.groups/has/run), takže se nemůže rozejít se seznamem úkonů a
// oprávnění rolí i schované nástroje platí i tady. Nápovědy jdou z TOOL_HELP
// přes window.agToolHelpText (js/tools-plus.js).
//
// Krátké klepnutí bez tažení otevře KLASICKÝ seznam Nástrojů — záložní cesta
// zůstává, takže o nic nejde přijít.
//
// Odstranění: smaž js/kolecko-nastroju.js + řádek <script> v index.html
// (a přegeneruj sw.js). Tlačítko Nástroje pak zase jen otevírá modál.
// ================================================================================
(function () {
    'use strict';

    var KEY_OFF = 'agKoleckoOff';   // '1' = vypnuto (výchozí zapnuto)
    var STYLE_ID = 'ag-kn-style';
    var WRAP_ID = 'ag-kn';

    var DEAD = 34;          // mrtvá zóna kolem prstu
    // HYSTEREZE: 9. 8. 2026 snížena z 0,30 na 0,16. Při devíti nástrojích je výseč 40°,
    // takže s 0,30 bylo potřeba přejet 32° — uživatel hlásil „odjel jsem z položky a
    // ona se stejně načetla". Nižší hodnota pořád brání poskakování na rozhraní.
    var HYST = 0.16;
    var ENGAGE = 92;        // na téhle vzdálenosti je kříž na dráze položek
    var PARK = 132;         // za tímhle je čtecí zóna
    var DWELL = 800;        // načítání výběru
    var GMAX = 5;           // strop zesílení u okraje (viz measureGain)
    // RESERVE: na kolika procentech dostupného místa už je plná výchylka. Menší číslo
    // = citlivější. Doladěno ve třech krocích podle terénu: 1,0 (žádná rezerva) bylo
    // doprava MÁLO, 0,6 „fakt jako obrovská", 0,78 pořád o kus moc. 0,88 dává doprava
    // zesílení 2,4× a mrtvou zónu prst opustí po ~14 px (bez zesílení by to bylo 34).
    var RESERVE = 0.88;
    var GRACE = 260;        // po přepnutí kruhu se chvíli nenačítá (viz openLevel2)

    var BACK = { back: true, l: 'Zpět' };

    // Krátké popisky do kolečka. Plné názvy ze seznamu úkonů se do výseče
    // nevejdou („Vzdálenost a převýšení mezi body" je na 31 znaků). Klíčováno
    // podle `k`, ne podle pořadí — když se mapa sloves přeskládá, nic se nerozjede.
    // Co tu není, použije svůj plný název.
    var SHORT_G = {
        'Určit nový bod': 'Nový bod',
        'Zjistit podmínky': 'Podmínky',
        'Katastr a podklady': 'Katastr',
        'Firma a papíry': 'Firma',
        'Příručka a výpočty': 'Příručka'
    };
    var SHORT = {
        'openMeasureModal': 'Vzdálenost a převýšení',
        'startAreaMode': 'Plocha a obvod',
        'openCheckDist': 'Oměrné',
        'openDmtVolume': 'Kubatura a vrstevnice',
        'vyska-objektu': 'Výška objektu',
        'korekce': 'S korekcí',
        'obchuzka': 'Kubatura obejitím',
        'ar-resection': 'Resekcí',
        'hlas-kod': 'Hlasem',
        'indoor': 'Bod uvnitř budovy',
        'epochy': 'Epochy',
        'usadit-ar': 'Nevím čím začít',
        'orient-point': 'Podle známého bodu',
        'ref-calibration': 'Kalibrace na ref. bod',
        'fov-kalib': 'Změřit zorný úhel',
        'sky-obstruction': 'Predikce signálu',
        'gnss-forecast': 'Kdy bude nejlíp',
        'openKatastr': 'Kde právě stojím',
        'cadastre-vector': 'Parcely do mapy a AR',
        'cadastre-area': 'Body z výřezu mapy',
        'parcela': 'Parcela',
        'job-transfer': 'Poslat / načíst zakázku'
    };

    function on() { try { return localStorage.getItem(KEY_OFF) !== '1'; } catch (e) { return true; } }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    function buzz(ms) {
        try {
            if (typeof visSettings !== 'undefined' && visSettings.vibrationEnabled === false) return;
            if (navigator.vibrate) navigator.vibrate(ms);
        } catch (e) {}
    }
    function ukony() { return window.AGUkony && window.AGUkony.groups ? window.AGUkony : null; }

    // Slovesa i nástroje se čtou ŽIVĚ při každém otevření: dlaždice přibývají
    // (lazy moduly) a ubývají (oprávnění, „Moje aktivita"), takže seznam
    // uložený dopředu by lhal.
    function liveGroups() {
        var u = ukony(); if (!u) return [];
        var out = [];
        u.groups.forEach(function (g) {
            var items = g.items.filter(function (it) { return u.has(it.k); });
            if (items.length) out.push({ t: SHORT_G[g.t] || g.t, full: g.t, items: items });
        });
        return out;
    }

    var st = null, slots = [], segs = [], step = 0, Rret = 0;
    var dwellFrom = 0, dwellIdx = -1, raf = 0, lastHot = -1, arcLen = 0;
    var wrap, ring, hub, ret, arc, crumb, tip, info, veil;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st2 = document.createElement('style');
        st2.id = STYLE_ID;
        st2.textContent = [
            '#' + WRAP_ID + '{position:fixed;inset:0;z-index:10050;display:none;}',
            '#' + WRAP_ID + '.on{display:block;}',
            // Závoj je hodně krytý schválně: přání znělo „ať z hlavní obrazovky zmizí
            // všechno". Dok a HUD se schovají opacitou níž, ale MAPA je pod nimi a přes
            // slabší závoj prosvítala tak, že se do ní kolečko ztrácelo.
            '#' + WRAP_ID + ' .kn-veil{position:absolute;inset:0;background:rgba(7,10,13,0.94);}',
            // hlavní obrazovka zmizí, ať je vidět jen kolečko (na přání)
            'body.ag-kn-open #dock,body.ag-kn-open #ag-sp,body.ag-kn-open #ag-view-wheel,',
            'body.ag-kn-open #info,body.ag-kn-open #compass-debug,body.ag-kn-open #map-controls,',
            'body.ag-kn-open #ag-stack{opacity:0 !important;transition:opacity .16s ease;}',
            '#' + WRAP_ID + ' .kn-ring{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);',
            '  width:var(--knd,300px);height:var(--knd,300px);}',
            // KVĚT: lístky se kreslí v SVG, popisky jsou HTML nad ním (kvůli písmu appky)
            '#' + WRAP_ID + ' .kn-gfx{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
            '  overflow:visible;pointer-events:none;}',
            '#' + WRAP_ID + ' .kn-gfx path{transition:none;}',
            // ⚠ POPISEK JE ÚZKÝ A NATOČENÝ. Vodorovný text v šikmém lístku vyčnívá rohy,
            // ať je jakkoli úzký — proto se otáčí do osy lístku (rotaci dopočítá build()).
            // Šířka drží pod šířkou lístku v jeho nejširším místě, viz PETAL_W níž.
            '#' + WRAP_ID + ' .kn-seg{position:absolute;left:50%;top:50%;width:var(--knw,48px);',
            '  margin-left:calc(var(--knw,48px) / -2);margin-top:-14px;text-align:center;',
            '  font:600 calc(8.5px * var(--knfs,1))/1.12 var(--font-ui,system-ui),sans-serif;',
            '  letter-spacing:-0.01em;color:#cdd5e0;pointer-events:none;overflow-wrap:anywhere;',
            '  text-shadow:0 1px 3px rgba(6,9,12,0.95);transition:color .12s ease;}',
            '#' + WRAP_ID + ' .kn-seg.hot{color:#fff;font-weight:700;text-shadow:none;z-index:3;}',
            '#' + WRAP_ID + ' .kn-seg.back{font-style:italic;}',
            // záměrný kříž + prstenec odpočtu kolem něj
            // ⚠ KŘÍŽ JE VIDĚT POŘÁD (na přání). Ve středu ale leží přes nápis, tak je
            // tam ztlumený na polovinu — pořád je vidět a text pod ním se dá přečíst.
            // Jakmile se začne mířit, dostane plnou sílu.
            '#' + WRAP_ID + ' .kn-ret{position:absolute;left:50%;top:50%;margin:-28px 0 0 -28px;width:56px;height:56px;',
            '  pointer-events:none;z-index:4;opacity:0;transition:opacity .12s;}',
            '#' + WRAP_ID + ' .kn-ret.on{opacity:0.5;}',
            '#' + WRAP_ID + '.aiming .kn-ret.on{opacity:1;}',
            '#' + WRAP_ID + ' .kn-ret svg{width:100%;height:100%;overflow:visible;}',
            '#' + WRAP_ID + ' .kn-ret .l{fill:none;stroke:var(--accent-bright,#3fbc8c);stroke-width:1.8;stroke-linecap:round;',
            '  filter:drop-shadow(0 0 5px rgba(63,188,140,0.9));}',
            '#' + WRAP_ID + ' .kn-ret .m{fill:var(--accent-bright,#3fbc8c);stroke:none;}',
            '#' + WRAP_ID + ' .kn-ret .p{fill:none;stroke:var(--accent-bright,#3fbc8c);stroke-width:3.4;stroke-linecap:round;',
            '  transform:rotate(-90deg);transform-origin:28px 28px;}',
            '#' + WRAP_ID + '.lvl2 .kn-ret .l{stroke:var(--data,#e6bd76);filter:drop-shadow(0 0 5px rgba(230,189,118,0.9));}',
            '#' + WRAP_ID + '.lvl2 .kn-ret .m{fill:var(--data,#e6bd76);}',
            '#' + WRAP_ID + '.lvl2 .kn-ret .p{stroke:var(--data,#e6bd76);}',
            '#' + WRAP_ID + ' .kn-ret.read .l{stroke:var(--text-muted,#9aa1ac);filter:none;}',
            '#' + WRAP_ID + ' .kn-ret.read .m{fill:var(--text-muted,#9aa1ac);}',
            // STŘED: malý květ a nápis UVNITŘ něj, přesně na středu kytky.
            // ⚠ text-indent dorovnává letter-spacing — to přidá mezeru i ZA poslední
            // písmeno a centrovaný nápis se opticky sesune doleva.
            '#' + WRAP_ID + ' .kn-hub{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
            '  width:var(--knh,104px);text-align:center;pointer-events:none;z-index:2;}',
            '#' + WRAP_ID + ' .kn-bud{position:absolute;left:50%;top:50%;width:104px;height:104px;',
            '  margin:-52px 0 0 -52px;z-index:-1;overflow:visible;}',
            '#' + WRAP_ID + ' .kn-hub .c{font:700 8px/1 var(--font-mono,ui-monospace,monospace);',
            '  letter-spacing:.1em;text-indent:.1em;text-transform:uppercase;color:#8a94a1;}',
            '#' + WRAP_ID + ' .kn-hub .n{font:650 calc(12px * var(--knfs,1))/1.2 var(--font-display,system-ui),sans-serif;',
            '  margin-top:4px;color:var(--text-color,#e6e8eb);}',
            '#' + WRAP_ID + ' .kn-hub.idle .n{color:var(--text-muted,#9aa1ac);font-weight:500;',
            '  font-size:calc(10.5px * var(--knfs,1));}',
            '#' + WRAP_ID + ' .kn-crumb{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 26px);',
            '  text-align:center;font:600 11px/1 var(--font-mono,ui-monospace,monospace);letter-spacing:.1em;',
            '  text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#' + WRAP_ID + ' .kn-crumb b{color:var(--accent-bright,#3fbc8c);}',
            // nápověda dole — drží poslední, na co se najelo
            '#' + WRAP_ID + ' .kn-info{position:absolute;left:16px;right:16px;',
            '  bottom:calc(env(safe-area-inset-bottom,0px) + 24px);text-align:center;opacity:0;',
            '  transition:opacity .16s ease;border-top:1px solid var(--glass-border,rgba(255,255,255,0.12));padding-top:12px;}',
            '#' + WRAP_ID + ' .kn-info.on{opacity:1;}',
            '#' + WRAP_ID + ' .kn-info .k{font:700 9px/1 var(--font-mono,ui-monospace,monospace);letter-spacing:.15em;',
            '  text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#' + WRAP_ID + ' .kn-info .n{font:650 calc(16px * var(--ag-font-scale,1))/1.25 var(--font-display,system-ui),sans-serif;',
            '  margin-top:7px;color:var(--data,#e6bd76);}',
            '#' + WRAP_ID + ' .kn-info .h{font:400 calc(12.5px * var(--ag-font-scale,1))/1.4 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-muted,#9aa1ac);margin-top:4px;max-height:5.6em;overflow:hidden;}',
            '#' + WRAP_ID + ' .kn-tip{position:absolute;left:16px;right:16px;',
            '  bottom:calc(env(safe-area-inset-bottom,0px) + 24px);text-align:center;',
            '  font:500 11.5px/1.45 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '@media (prefers-reduced-motion:reduce){#' + WRAP_ID + ' *{transition:none !important;}}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st2);
    }

    function ensure() {
        if (wrap && document.body.contains(wrap)) return wrap;
        injectStyles();
        wrap = document.createElement('div');
        wrap.id = WRAP_ID;
        wrap.setAttribute('aria-hidden', 'true');
        wrap.innerHTML =
            '<div class="kn-veil"></div>' +
            '<p class="kn-crumb"></p>' +
            '<div class="kn-ring">' +
            '  <svg class="kn-gfx" aria-hidden="true"></svg>' +
            '  <div class="kn-hub idle">' +
            '    <svg class="kn-bud" viewBox="-54 -54 108 108" aria-hidden="true"></svg>' +
            '    <div class="c">Vyber</div><div class="n">zamiř prstem</div></div>' +
            '  <div class="kn-ret"><svg viewBox="0 0 56 56">' +
            '    <circle class="p" cx="28" cy="28" r="20"/>' +
            '    <path class="l" d="M28 21V10M28 35V46M21 28H10M35 28H46"/>' +
            '    <circle class="m" cx="28" cy="28" r="2.4"/>' +
            '  </svg></div>' +
            '</div>' +
            '<p class="kn-tip"></p>' +
            '<div class="kn-info"><div class="k"></div><div class="n"></div><div class="h"></div></div>';
        document.body.appendChild(wrap);
        ring = wrap.querySelector('.kn-ring');
        hub = wrap.querySelector('.kn-hub');
        ret = wrap.querySelector('.kn-ret');
        arc = wrap.querySelector('.kn-ret .p');
        crumb = wrap.querySelector('.kn-crumb');
        tip = wrap.querySelector('.kn-tip');
        info = wrap.querySelector('.kn-info');
        veil = wrap.querySelector('.kn-veil');
        arcLen = 2 * Math.PI * 20;
        return wrap;
    }

    // Rozvržení směrů. „Zpět" má vyjít KOLMO DOLŮ, což platí, když je celkový počet
    // sudý (pak leží přesně na indexu total/2).
    // ⚠ ŽÁDNÉ PRÁZDNÉ SMĚRY. Dřív se u sudého počtu nástrojů nechával jeden směr
    // prázdný, aby „Zpět" vyšlo přesně dolů. S květem to ale znamenalo díru v kytce
    // („ať je to furt kytka, kolem dokola") — teď se položky rozprostřou rovnoměrně
    // a při lichém celkovém počtu je „Zpět" o půl výseče vedle svislice. To je menší
    // zlo než chybějící lístek.
    function layout(items, withBack) {
        if (!withBack) return items.slice();
        var arr = items.slice();
        arr.splice(Math.round(arr.length / 2), 0, BACK);
        return arr;
    }

    // ---- TVAR LÍSTKU ----------------------------------------------------------
    // ⚠ BÉZIER NIKDY NEDOSÁHNE SVÝCH ŘÍDICÍCH BODŮ: lístek je v nejširším místě jen
    // ~1,3 × `w`, ne 2 ×. Když se to plete, nápis z lístku čouhá — přesně tak to
    // vypadalo v prvním nasazení návrhu. Šířku popisku proto počítáme z 1,3 × w.
    var PETAL_W = 46;          // parametr šířky (skutečná šířka ≈ 1,3 × tolik)
    var BLOOM = 480, STAGGER = 34;   // rozvíjení poupěte: každý lístek 480 ms, po sobě
    function petal(rin, rout, w) {
        var L = rout - rin;
        return 'M0 ' + (-rin).toFixed(1)
            + ' C' + (-w).toFixed(1) + ' ' + (-rin - L * 0.34).toFixed(1)
            + ' ' + (-w * 0.72).toFixed(1) + ' ' + (-rin - L * 0.84).toFixed(1)
            + ' 0 ' + (-rout).toFixed(1)
            + ' C' + (w * 0.72).toFixed(1) + ' ' + (-rin - L * 0.84).toFixed(1)
            + ' ' + w.toFixed(1) + ' ' + (-rin - L * 0.34).toFixed(1)
            + ' 0 ' + (-rin).toFixed(1) + ' Z';
    }
    function svgEl(name, attrs) {
        var e = document.createElementNS('http://www.w3.org/2000/svg', name);
        for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
        return e;
    }

    var petals = [], grow = [], IN = 0, OUT = 0, bloomFrom = 0;

    function build(items, lvl) {
        ring.querySelectorAll('.kn-seg').forEach(function (e) { e.remove(); });
        segs = []; petals = []; grow = [];
        slots = layout(items, lvl === 2);
        var n = slots.length;
        var d = Math.max(220, Math.min(300, window.innerWidth - 62));
        var R = d / 2 - 66;
        var tight = (window.innerWidth < 400);
        ring.style.setProperty('--knd', d + 'px');
        // Popisky rostou s velikostí písma a s rukavicemi, ale kruh se zvětšit NEMŮŽE
        // (průměr je daný šířkou displeje). Kolečko má proto vlastní měřítko se stropem.
        var fs = 1;
        try {
            fs = parseFloat(getComputedStyle(document.documentElement)
                .getPropertyValue('--ag-font-scale')) || 1;
        } catch (e) {}
        if (document.body.classList.contains('ag-glove')) fs = Math.max(fs, 1.15);
        fs = Math.max(1, Math.min(1.6, fs));
        var kfs = Math.min(fs, 1.15);
        wrap.style.setProperty('--knfs', kfs);
        hub.style.setProperty('--knh', Math.round(104 * kfs) + 'px');

        var stag = Math.round((tight ? 42 : 38) * kfs);
        step = Math.PI * 2 / n;
        Rret = R + stag + 24;
        IN = Math.round(52 * kfs);
        OUT = R + stag + 26;
        // Popisek musí zůstat pod skutečnou šířkou lístku (1,3 × w) i po odečtu vzduchu.
        var pw = PETAL_W * Math.min(1, (2 * Math.PI * (IN + (OUT - IN) * 0.47) / n) / 68);
        ring.style.setProperty('--knw', Math.round(Math.min(48 * kfs, pw * 1.3 - 12)) + 'px');

        var gfx = ring.querySelector('.kn-gfx');
        while (gfx.firstChild) gfx.removeChild(gfx.firstChild);
        gfx.setAttribute('width', d); gfx.setAttribute('height', d);
        gfx.setAttribute('viewBox', (-d / 2) + ' ' + (-d / 2) + ' ' + d + ' ' + d);

        for (var i = 0; i < n; i++) {
            grow.push(0);
            var p = svgEl('path', { d: '', fill: 'rgba(255,255,255,0.085)',
                stroke: 'rgba(255,255,255,0.22)', 'stroke-width': 1,
                transform: 'rotate(' + (i * step * 180 / Math.PI).toFixed(2) + ')' });
            gfx.appendChild(p);
            petals.push(p);

            var el = document.createElement('div');
            el.className = 'kn-seg' + (slots[i].back ? ' back' : '');
            var txt = slots[i].back ? slots[i].l : (slots[i].t || SHORT[slots[i].k] || slots[i].l);
            el.textContent = txt;
            // ⚠ Dlouhé JEDNO slovo („Zaznamenat") se jinak zlomí uprostřed — radši mu
            // ubereme na velikosti, než aby se rozseklo.
            var nej = 0;
            txt.split(/\s+/).forEach(function (wd) { if (wd.length > nej) nej = wd.length; });
            if (nej > 9) el.style.fontSize = 'calc(6.8px * var(--knfs,1))';
            else if (nej > 8) el.style.fontSize = 'calc(8px * var(--knfs,1))';
            // natočení do osy lístku; v dolní polovině překlopit, ať se to nečte vzhůru nohama
            var deg = i * step * 180 / Math.PI;
            if (deg > 90 && deg < 270) deg -= 180;
            var rr = IN + (OUT - IN) * 0.47;
            el.style.transform = 'translate(' + (Math.sin(i * step) * rr).toFixed(1) + 'px,'
                + (-Math.cos(i * step) * rr).toFixed(1) + 'px) rotate(' + deg.toFixed(1) + 'deg)';
            ring.appendChild(el);
            segs.push(el);
        }
        buildBud();
        wrap.classList.toggle('lvl2', lvl === 2);
        paintPetals();
    }

    // Malý květ ve středu — kreslí se jednou, je to jen podklad nápisu.
    function buildBud() {
        var bud = wrap.querySelector('.kn-bud');
        if (!bud || bud.firstChild) return;
        for (var i = 0; i < 6; i++) {
            bud.appendChild(svgEl('path', { d: petal(9, 47, 17), fill: 'rgba(255,255,255,0.055)',
                stroke: 'rgba(255,255,255,0.17)', 'stroke-width': 1,
                transform: 'rotate(' + (i * 60 + 30) + ')' }));
        }
        bud.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 8, fill: 'rgba(255,255,255,0.055)',
            stroke: 'rgba(255,255,255,0.20)', 'stroke-width': 1 }));
    }

    // Překreslení lístků: rozvíjení poupěte (po lístcích) + roztažení vybraného.
    // ⚠ Roztažení se LERPUJE k cíli, ne přepíná skokem — jinak by lístek cukal.
    function paintPetals() {
        if (!petals.length) return;
        var t = Date.now();
        var lvl2 = wrap.classList.contains('lvl2');
        var A = lvl2 ? '#e6bd76' : '#3fbc8c';
        var soft = lvl2 ? 'rgba(230,189,118,0.22)' : 'rgba(63,188,140,0.20)';
        for (var j = 0; j < petals.length; j++) {
            var bl = 1;
            if (bloomFrom) bl = Math.max(0, Math.min(1, (t - bloomFrom - j * STAGGER) / BLOOM));
            bl = bl * bl * (3 - 2 * bl);
            var want = (j === lastHot) ? 1 : 0;
            grow[j] += (want - grow[j]) * 0.28;
            if (Math.abs(grow[j] - want) < 0.004) grow[j] = want;
            var g = grow[j], act = (j === lastHot);
            var rin = IN - g * 8;
            var ro = IN + (OUT - IN) * (0.34 + 0.66 * bl) + g * 12;
            var w = (PETAL_W + g * 12) * (0.42 + 0.58 * bl);
            petals[j].setAttribute('d', petal(rin, ro, w));
            petals[j].setAttribute('fill', act ? soft : 'rgba(255,255,255,0.085)');
            petals[j].setAttribute('stroke', act ? A : 'rgba(255,255,255,0.22)');
            petals[j].setAttribute('stroke-width', act ? 1.5 : 1);
            if (segs[j]) segs[j].style.opacity = bl.toFixed(2);
        }
    }

    // ---- ZESÍLENÍ U OKRAJE (návrh N2, vybráno 9. 8. 2026) ---------------------
    // PROBLÉM: tlačítko Nástroje stojí ve svislé liště u pravého okraje, takže palci
    // zbývá doprava jen ~43 px (změřeno na displeji 412 px; před prohozením s „Body"
    // dokonce 36). Mrtvá zóna je 34 px a na plnou výchylku je potřeba 92 — doprava
    // tedy nešlo vybrat prakticky nic.
    // ŘEŠENÍ: při otevření se změří, kolik má kotva místa ke každé hraně, a v těsných
    // směrech se posun PRSTU násobí. Kde je místa dost, se nemění nic (zesílení 1).
    // Strop GMAX drží citlivost v rozumných mezích — bez něj by u kraje stačily dva
    // pixely a kolečko by poletovalo.
    // RESERVE: kdyby plná výchylka padla přesně na hranu displeje, musel by člověk
    // dojet palcem úplně na kraj skla — a tam už prst často nic nehlásí. Cílíme proto
    // na 60 % dostupného místa, takže doprava (43 px) je plná výchylka po 26 px tahu
    // a zbytek je rezerva. Na přání 9. 8. 2026: „ještě bych tam zvýšil citlivost."
    function gainFor(roomPx) {
        return Math.max(1, Math.min(GMAX, ENGAGE / Math.max(1, roomPx * RESERVE)));
    }
    function measureGain() {
        var w = window.innerWidth, h = window.innerHeight;
        st.gr = gainFor(w - st.ox);
        st.gl = gainFor(st.ox);
        st.gd = gainFor(h - st.oy);
        st.gu = gainFor(st.oy);
    }
    // ⚠⚠ KOTVA SE PO CELÉ GESTO NEHÝBE. Za jediný den se to tady vystřídalo třikrát
    // a tohle je jediná varianta, která nepřinesla novou stížnost:
    //   1) PŮVODNĚ se kotva při přepnutí kruhu přesunula na prst (`st.ox = st.px`),
    //      aby druhý kruh začínal v neutrálu. Jenže po výběru KRAJNÍ položky prst na
    //      okraji leží a nová kotva nemá kam růst → „i když ten první nástroj vpravo
    //      vyberu, tak podruhý už doprava se nedostanu".
    //   2) Pak se kotva u okraje nechávala stát a čekalo se, až se prst vrátí do mrtvé
    //      zóny → „nefunguje vybírání nástrojů, musím se vrátit na střed".
    //   3) Pak se kotva přesouvala jen tam, kde bylo místo → jenže PŘESUN KOTVY JE
    //      SKOK KŘÍŽE. Kříž byl vychýlený na kraji kruhu a rázem stál uprostřed:
    //      „ten kříž tam furt poskakuje mezi první a druhou vrstvou."
    // Kotva = místo, kde se prst dotkl, a tam zůstane. Vztah „kam táhnu = kam míří
    // kříž" pak platí celou dobu a nic nikam neposkočí. Cenou je, že druhý kruh
    // začíná ZAMÍŘENÝ tam, odkud člověk přišel — to jistí GRACE (odpočet se
    // rozjede až za chvilku, takže je čas odjet jinam).
    // NEVRACET přesouvání kotvy v žádné podobě.
    function reanchor() {
        st.graceTo = Date.now() + GRACE;
    }

    function aimAt(dx, dy) {
        // Zesílený vektor řídí ÚHEL i výchylku, ale ČTECÍ ZÓNA se měří SKUTEČNOU
        // vzdáleností prstu: se zesílením 2,6× by ležela už 50 px od tlačítka a
        // člověk by z výběru vypadl dřív, než by stihl vybrat. „Odjet si přečíst
        // nápovědu" má stát pořád stejný kus tahu.
        var raw = Math.hypot(dx, dy);
        var wx = dx * (dx >= 0 ? st.gr : st.gl);
        var wy = dy * (dy >= 0 ? st.gd : st.gu);
        var dist = Math.hypot(wx, wy);
        if (!slots.length) return { i: -1, dist: dist, ang: null, read: false };
        var a = (dist < 1.5) ? 0 : Math.atan2(wx, -wy);
        if (a < 0) a += Math.PI * 2;
        if (dist < DEAD) return { i: -1, dist: dist, ang: a, read: false };
        if (raw > PARK) return { i: -1, dist: dist, ang: a, read: true };
        var i = Math.round(a / step) % slots.length;
        // Hystereze: dokud prst nepřejede o HYST výseče ZA hranici, drží se to,
        // co svítí teď. Bez toho výběr na rozhraní dvou směrů poskakoval.
        if (lastHot >= 0 && i !== lastHot && slots[lastHot]) {
            var t = a - lastHot * step;
            while (t > Math.PI) t -= Math.PI * 2;
            while (t < -Math.PI) t += Math.PI * 2;
            if (Math.abs(t) < step * (0.5 + HYST)) i = lastHot;
        }
        return { i: slots[i] ? i : -1, dist: dist, ang: a, read: false };
    }

    function paintRet(ang, dist, read) {
        if (ang == null) { ret.classList.remove('on'); return; }
        ret.classList.add('on');
        ret.classList.toggle('read', !!read);
        // Poloměr kříže je ÚMĚRNÝ posunu prstu (0 → Rret na vzdálenosti ENGAGE),
        // takže je vidět i pomalý pohyb, ne až doraz.
        var r = read ? Rret + 30 : Rret * Math.min(1, (dist || 0) / ENGAGE);
        ret.style.transform = 'translate(' + (Math.sin(ang) * r).toFixed(1) + 'px,'
            + (-Math.cos(ang) * r).toFixed(1) + 'px)';
        wrap.classList.toggle('aiming', !read && (dist || 0) > 10);
    }

    function setHub(cap, nm, idle) {
        hub.className = 'kn-hub' + (idle ? ' idle' : '');
        hub.querySelector('.c').textContent = cap;
        hub.querySelector('.n').textContent = nm;
    }
    function setInfo(kind, name, hint) {
        info.querySelector('.k').textContent = kind;
        info.querySelector('.n').textContent = name;
        info.querySelector('.h').textContent = hint || '';
        info.classList.add('on');
        tip.style.display = 'none';
    }

    // Odpočet kreslí PRSTENEC KOLEM KŘÍŽE. Do lístku se už nekreslí nic (dřív jím
    // zleva doprava natékal gradient) — lístek na výběr reaguje roztažením.
    function setProgress(p) {
        arc.style.strokeDasharray = arcLen;
        arc.style.strokeDashoffset = arcLen * (1 - p);
        arc.style.opacity = p > 0 ? '' : '0';
    }
    function resetDwell(i) {
        dwellIdx = i;
        // Po přepnutí kruhu (reanchor) se odpočet rozjede až po GRACE ms — viz reanchor().
        dwellFrom = (i >= 0) ? Math.max(Date.now(), (st && st.graceTo) || 0) : 0;
        setProgress(0);
    }
    function tick() {
        raf = 0;
        if (!st) return;
        // ⚠ Lístky se překreslují KAŽDÝ SNÍMEK, i když není nic vybráno — jinak by
        //   roztažený lístek zůstal viset ve chvíli, kdy z něj prst sjede pryč,
        //   a poupě by se nedorozvinulo, když člověk drží prst na místě.
        paintPetals();
        if (dwellIdx >= 0) {
            var p = Math.max(0, Math.min(1, (Date.now() - dwellFrom) / DWELL));
            setProgress(p);
            if (p >= 1) { commit(); return; }
        }
        raf = requestAnimationFrame(tick);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(tick); }

    function hi(i) {
        if (i === lastHot) return;
        lastHot = i;
        for (var k = 0; k < segs.length; k++) if (segs[k]) segs[k].classList.toggle('hot', k === i);
        resetDwell(i);
        if (i >= 0) { buzz(6); kick(); }
    }

    function openLevel2(gi) {
        st.level = 2; st.group = gi;
        reanchor();
        bloomFrom = Date.now();      // druhý kruh se rozvine stejně jako první
        build(st.groups[gi].items, 2);
        crumb.innerHTML = 'Nástroje <b>› ' + esc(st.groups[gi].full || st.groups[gi].t) + '</b>';
        setHub('Vyber nástroj', 'zamiř prstem', true);
        lastHot = -1; resetDwell(-1);
        wrap.classList.remove('aiming');
        buzz(14);
        resume();
    }
    function backToLevel1() {
        st.level = 1; st.group = -1;
        reanchor();
        bloomFrom = Date.now();
        build(st.groups, 1);
        crumb.textContent = 'Nástroje';
        setHub('Vyber skupinu', 'zamiř prstem', true);
        lastHot = -1; resetDwell(-1);
        wrap.classList.remove('aiming');
        buzz(10);
        resume();
    }
    // Překreslení podle SKUTEČNÉ polohy prstu po přepnutí kruhu.
    // ⚠ Dřív tu bylo `paintRet(0, 0, false)` — kříž skočil na střed a zůstal tam, dokud
    // nepřišla další událost pohybu. Kdo držel prst u okraje (a nehýbal jím, protože
    // právě dokončil výběr), viděl přesně tohle: „kříž se hodí do prostředka a po
    // chvilce problikne a zase se vrátí trochu doprava, není to vůbec plynulý."
    function resume() {
        kick();
        if (st) move(st.px, st.py);
    }
    function commit() {
        if (!st) return;
        var it = slots[dwellIdx];
        if (!it) { lastHot = -1; resetDwell(-1); kick(); return; }
        if (it.back) { backToLevel1(); return; }
        if (st.level === 1) openLevel2(dwellIdx);
        else finish(it);
    }

    function open(x, y) {
        var g = liveGroups();
        if (!g.length) return false;      // host / bez oprávnění — ať se otevře modál
        ensure();
        st = { ox: x, oy: y, px: x, py: y, level: 1, group: -1, moved: false, groups: g,
               graceTo: 0, gr: 1, gl: 1, gu: 1, gd: 1 };
        measureGain();
        bloomFrom = Date.now();
        build(g, 1);
        crumb.textContent = 'Nástroje';
        tip.style.display = '';
        tip.textContent = 'Zamiř na skupinu a chvíli ji podrž.';
        info.classList.remove('on');
        setHub('Vyber skupinu', 'zamiř prstem', true);
        lastHot = -1; resetDwell(-1);
        wrap.classList.remove('aiming');
        wrap.classList.add('on');
        document.body.classList.add('ag-kn-open');
        paintRet(0, 0, false);
        // ⚠ SMYČKA MUSÍ BĚŽET HNED PO OTEVŘENÍ. Dřív se rozjela až při prvním výběru
        // (hi() s i >= 0), což stačilo, dokud se v ní jen počítal odpočet. Květ se v ní
        // ale i ROZVÍJÍ — bez tohohle zůstalo poupě zavřené a popisky neviditelné,
        // dokud člověk něco nevybral.
        kick();
        return true;
    }

    function move(x, y) {
        if (!st) return;
        st.px = x; st.py = y;
        var dx = x - st.ox, dy = y - st.oy;
        if (Math.hypot(dx, dy) > 6) st.moved = true;
        var a = aimAt(dx, dy);
        paintRet(a.ang, a.dist, a.read);
        hi(a.i);
        // POJISTKA PROTI ZASEKNUTÉMU NAČÍTÁNÍ. Smyčka odpočtu se restartuje jen v hi(),
        // a to jen když se vybraná položka ZMĚNÍ. Kdyby ji cokoli jednou shodilo
        // (výjimka uvnitř snímku, commit na prázdný slot), zůstal by prstenec stát
        // v půlce a jediná cesta ven by bylo přejet na jinou položku — přesně jak to
        // uživatel popisoval. kick() je no-op, když smyčka běží, takže to nic nestojí.
        kick();
        if (a.read) { setHub('Čtení', 'nápověda drží', true); return; }
        if (a.i < 0) {
            setHub(st.level === 1 ? 'Vyber skupinu' : 'Vyber nástroj', 'zamiř prstem', true);
            return;
        }
        var it = slots[a.i];
        if (it.back) { setHub('Zpět', 'o krok zpátky'); return; }
        if (st.level === 1) {
            setHub('Skupina', it.t);
            setInfo('Skupina', it.full || it.t, it.items.length + ' nástrojů');
        } else {
            var nm = SHORT[it.k] || it.l;
            setHub('Nástroj', nm);
            var h = '';
            try { if (typeof window.agToolHelpText === 'function') h = window.agToolHelpText(it.k, 190); } catch (e) {}
            setInfo('Nástroj', it.l, h || it.h || 'pusť pro otevření');
        }
    }

    function finish(it) {
        var u = ukony();
        close();
        // Spouští se klikem na původní dlaždici (AGUkony.run) — tím se započítá
        // použití, zafunguje návrat do Nástrojů i oprávnění.
        setTimeout(function () {
            var ok = false;
            try { ok = !!(u && u.run(it.k)); } catch (e) {}
            if (!ok) { try { document.getElementById('tools-modal').style.display = 'flex'; } catch (e2) {} }
        }, 20);
        buzz(24);
    }

    function close() {
        st = null; lastHot = -1; bloomFrom = 0;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        if (wrap) {
            resetDwell(-1);
            ret.classList.remove('on');
            ret.classList.remove('read');
            wrap.classList.remove('aiming');
            wrap.classList.remove('on');
        }
        document.body.classList.remove('ag-kn-open');
    }

    // ZRUŠENÍ = JEN ZVEDNUTÍ PRSTU. Zvednutí na nástroji ho otevře hned.
    function up() {
        if (!st) return;
        if (st.level === 2 && lastHot >= 0 && slots[lastHot] && !slots[lastHot].back) {
            finish(slots[lastHot]); return;
        }
        var tapped = !st.moved;
        close();
        // krátké klepnutí bez tažení = klasický seznam Nástrojů (záložní cesta)
        if (tapped) { try { document.getElementById('tools-modal').style.display = 'flex'; } catch (e) {} }
    }

    // ---- vstupy ---------------------------------------------------------------
    // ⚠ pohyb a zvednutí NA WINDOW (viz hlavička souboru)
    function btn() { return document.getElementById('dock-nastroje-btn'); }

    // ⚠⚠ SLEDUJE SE JEDEN KONKRÉTNÍ DOTEK (Touch.identifier), ne `e.touches[0]`.
    // Bez toho (nalezeno revizí 9. 8. 2026, mým testům to uniklo — testoval jsem
    // jedním prstem) dělal vícedotyk dvě ošklivé věci:
    //   • `touchend` na window se pálí pro KAŽDÝ zvednutý prst. Když si geodet
    //     opře o sklo malíček nebo dlaň a zvedne ji, spustilo to up() → ve 2. stupni
    //     se OTEVŘEL nástroj, na který zrovna mířil, i když palec ležel dál.
    //   • `e.touches[0]` je nejstarší kontakt na displeji, ne ten na tlačítku.
    //     Když už jeden prst na skle ležel, kolečko sledovalo JEHO — kříž se
    //     nehnul a nešlo vybrat vůbec nic.
    // Proto: identifier se ukládá z changedTouches při touchstartu a všechny další
    // události se podle něj filtrují. Cizí prsty se ignorují úplně.
    function pick(list, id) {
        if (!list) return null;
        for (var i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
        return null;
    }

    function bind() {
        var b = btn(); if (!b || b._agKn) return;
        b._agKn = true;
        b.addEventListener('touchstart', function (e) {
            if (!on() || st) return;                 // druhý prst na tlačítko gesto nepřepisuje
            var t = e.changedTouches[0]; if (!t) return;
            if (!open(t.clientX, t.clientY)) return;
            st.touchId = t.identifier;
            e.preventDefault();     // ať se nespustí i inline onclick tlačítka
        }, { passive: false });
        b.addEventListener('pointerdown', function (e) {
            if (!on() || e.pointerType === 'touch') return;
            if (!open(e.clientX, e.clientY)) return;
            e.preventDefault();
        });
        b.addEventListener('contextmenu', function (e) { if (st) e.preventDefault(); });

        window.addEventListener('touchmove', function (e) {
            if (!st) return;
            var t = pick(e.touches, st.touchId);
            if (!t) return;                          // hýbe se cizí prst — nezajímá nás
            e.preventDefault();
            move(t.clientX, t.clientY);
        }, { passive: false });
        window.addEventListener('touchend', function (e) {
            if (!st) return;
            if (!pick(e.changedTouches, st.touchId)) return;   // zvedl se cizí prst
            e.preventDefault();
            up();
        }, { passive: false });
        window.addEventListener('touchcancel', function (e) {
            if (!st) return;
            if (!pick(e.changedTouches, st.touchId)) return;
            close();
        });
        window.addEventListener('pointermove', function (e) {
            if (!st || e.pointerType === 'touch') return;
            e.preventDefault(); move(e.clientX, e.clientY);
        }, { passive: false });
        window.addEventListener('pointerup', function (e) { if (st && e.pointerType !== 'touch') up(); });
    }

    // Přepínač v Nastavení → Vzhled (řádek si umístí js/nastaveni-poradek.js)
    function settingRow() {
        var host = document.getElementById('tab-vzhled');
        if (!host || document.getElementById('ag-kn-setrow')) return;
        var row = document.createElement('label');
        row.className = 'filter-row';
        row.id = 'ag-kn-setrow';
        row.innerHTML = '<input type="checkbox" id="ag-kn-cb"><span>Kolečko nástrojů'
            + '<small style="display:block;color:var(--text-muted);font-weight:400;">'
            + 'podržením tlačítka Nástroje vybereš nástroj tažením, bez zvedání prstu</small></span>';
        host.appendChild(row);
        var cb = row.querySelector('#ag-kn-cb');
        cb.checked = on();
        cb.addEventListener('change', function () {
            try { localStorage.setItem(KEY_OFF, cb.checked ? '0' : '1'); } catch (e) {}
        });
    }

    function init() {
        bind();
        settingRow();
        if (!window.__agKnTimer) {
            // lišta i panel Nastavení vznikají později; sdílený UI časovač appky
            window.__agKnTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
                bind(); settingRow();
            }, 1500);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    window.AGKolecko = { open: open, close: close, enabled: on };
})();
