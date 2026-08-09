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
//  • „ZPĚT" je položka v kruhu KOLMO DOLŮ. Aby vyšla přesně na 180°, musí být
//    počet směrů sudý → u sudého počtu nástrojů zbude jeden směr prázdný.
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
    var RESERVE = 0.6;      // plná výchylka má padnout na 60 % dostupného místa, ne na 100 %
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
            '  width:var(--knd,300px);height:var(--knd,300px);border-radius:50%;}',
            '#' + WRAP_ID + ' .kn-plate{position:absolute;inset:0;border-radius:50%;',
            '  background:radial-gradient(circle at 50% 50%,rgba(23,27,32,0.92) 44%,rgba(16,20,25,0.86) 74%,rgba(16,20,25,0) 76%);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));}',
            '#' + WRAP_ID + ' .kn-track{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
            '  border-radius:50%;border:1px dashed rgba(255,255,255,0.10);}',
            '#' + WRAP_ID + ' .kn-seg{position:absolute;left:50%;top:50%;width:var(--knw,72px);',
            '  margin-left:calc(var(--knw,72px) / -2);margin-top:-17px;text-align:center;',
            '  font:600 calc(10.5px * var(--knfs,1))/1.16 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-muted,#9aa1ac);padding:4px 3px;border-radius:9px;pointer-events:none;',
            '  text-shadow:0 1px 3px rgba(6,9,12,0.95);}',
            '#' + WRAP_ID + ' .kn-seg.hot{color:#06120d;z-index:3;text-shadow:none;box-shadow:0 3px 12px rgba(0,0,0,0.5);',
            '  background:linear-gradient(90deg,var(--accent-bright,#3fbc8c) calc(var(--p,0) * 100%),rgba(63,188,140,0.30) 0);}',
            '#' + WRAP_ID + '.lvl2 .kn-seg.hot{color:#231603;',
            '  background:linear-gradient(90deg,var(--data,#e6bd76) calc(var(--p,0) * 100%),rgba(230,189,118,0.30) 0);}',
            '#' + WRAP_ID + ' .kn-seg.back{font-style:italic;}',
            '#' + WRAP_ID + ' .kn-seg.back.hot{color:#0d1117;font-style:normal;',
            '  background:linear-gradient(90deg,#8b98a3 calc(var(--p,0) * 100%),rgba(139,152,163,0.28) 0);}',
            // záměrný kříž + prstenec odpočtu kolem něj
            '#' + WRAP_ID + ' .kn-ret{position:absolute;left:50%;top:50%;margin:-28px 0 0 -28px;width:56px;height:56px;',
            '  pointer-events:none;z-index:4;opacity:0;transition:opacity .12s;}',
            '#' + WRAP_ID + ' .kn-ret.on{opacity:1;}',
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
            // střed
            // Střed je posunutý DOLŮ o 30 px: kříž v klidu stojí přesně na středu kruhu
            // a text „zamiř prstem" by ležel pod ním. Jakmile se míří, hub stejně mizí.
            '#' + WRAP_ID + ' .kn-hub{position:absolute;left:50%;top:50%;transform:translate(-50%,calc(-50% + 30px));',
            '  width:var(--knh,92px);text-align:center;pointer-events:none;z-index:2;transition:opacity .13s ease;}',
            '#' + WRAP_ID + '.aiming .kn-hub{opacity:0;}',
            '#' + WRAP_ID + ' .kn-hub .c{font:700 9.5px/1 var(--font-mono,ui-monospace,monospace);',
            '  letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#' + WRAP_ID + ' .kn-hub .n{font:650 calc(12.5px * var(--knfs,1))/1.25 var(--font-display,system-ui),sans-serif;',
            '  margin-top:6px;color:var(--text-color,#e6e8eb);}',
            '#' + WRAP_ID + ' .kn-hub.idle .n{color:var(--text-muted,#9aa1ac);font-weight:500;font-size:11px;}',
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
            '  <div class="kn-plate"></div>' +
            '  <div class="kn-track"></div>' +
            '  <div class="kn-hub idle"><div class="c">Vyber</div><div class="n">zamiř prstem</div></div>' +
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

    // Rozvržení směrů. „Zpět" musí vyjít KOLMO DOLŮ, což jde jen při sudém počtu
    // směrů — u sudého počtu nástrojů proto zůstane jeden směr prázdný a udělá
    // kolem „Zpět" mezeru (a hůř se do něj trefí omylem).
    function layout(items, withBack) {
        if (!withBack) return items.slice();
        var n = items.length;
        var total = (n % 2 === 1) ? n + 1 : n + 2;
        var back = total / 2;
        var arr = new Array(total);
        for (var i = 0; i < total; i++) arr[i] = null;
        arr[back] = BACK;
        var k = 0;
        for (var s = 0; s < total; s++) {
            if (s === back) continue;
            if (k < n) arr[s] = items[k++];
        }
        return arr;
    }

    function build(items, lvl) {
        ring.querySelectorAll('.kn-seg').forEach(function (e) { e.remove(); });
        segs = [];
        slots = layout(items, lvl === 2);
        var n = slots.length;
        var w = Math.min(window.innerWidth, window.innerHeight * 0.72);
        var d = Math.max(220, Math.min(300, window.innerWidth - 62));
        var R = d / 2 - 66;
        var tight = (window.innerWidth < 400);
        ring.style.setProperty('--knd', d + 'px');
        // Šířka štítků MUSÍ růst s velikostí písma a s režimem rukavic — písmo je
        // `calc(10.5px * var(--ag-font-scale))`, takže při zvětšeném textu by se do
        // pevných 64 px nevešlo a sousedi by se překryli. Odsazení druhého kruhu
        // roste se štítky, jinak by se potkaly řady mezi sebou.
        var fs = 1;
        try {
            fs = parseFloat(getComputedStyle(document.documentElement)
                .getPropertyValue('--ag-font-scale')) || 1;
        } catch (e) {}
        if (document.body.classList.contains('ag-glove')) fs = Math.max(fs, 1.15);
        fs = Math.max(1, Math.min(1.6, fs));
        // ⚠ Kruh se ale ZVĚTŠIT NEMŮŽE — jeho průměr je daný šířkou displeje. Kdyby
        // štítky rostly 1:1 s globálním písmem, na 140 % by se do stejného kruhu
        // nevešly a překryly by se (naměřeno). Kolečko má proto VLASTNÍ měřítko
        // se stropem: text povyroste, ale rozvržení drží. Kdo chce velké písmo,
        // má ho v celé appce; tady jde o hustou překryvnou vrstvu na chvíli.
        var kfs = Math.min(fs, 1.15);
        wrap.style.setProperty('--knfs', kfs);
        var base = tight ? (lvl === 1 ? 52 : 54) : (lvl === 1 ? 64 : 68);
        // Čím víc směrů, tím kratší oblouk mezi nimi. Při devíti nástrojích a
        // zvětšeném písmu se sousedi dotýkali o 3–6 px (naměřeno), tak se štítky
        // v téhle kombinaci ještě zúží.
        if (n >= 9 && kfs > 1) base -= 10;
        ring.style.setProperty('--knw', Math.round(base * kfs) + 'px');
        hub.style.setProperty('--knh', Math.round((tight ? 76 : 92) * kfs) + 'px');
        var stag = Math.round((tight ? 42 : 38) * kfs);
        step = Math.PI * 2 / n;
        Rret = R + stag + 24;
        ring.querySelector('.kn-track').style.width = ring.querySelector('.kn-track').style.height = (Rret * 2) + 'px';
        for (var i = 0; i < n; i++) {
            if (!slots[i]) { segs.push(null); continue; }
            var a = i * step;
            // U LICHÉHO počtu se na švu potkají poslední a první položka a obě by
            // podle i%2 seděly na vnitřním kruhu — poslední se proto vysune ven vždy.
            var outer = (n > 5) && (i % 2 === 1 || (n % 2 === 1 && i === n - 1));
            var rr = R + (outer ? stag : 0);
            var el = document.createElement('div');
            el.className = 'kn-seg' + (slots[i].back ? ' back' : '');
            el.style.transform = 'translate(' + (Math.sin(a) * rr).toFixed(1) + 'px,'
                + (-Math.cos(a) * rr).toFixed(1) + 'px)';
            el.textContent = slots[i].back ? slots[i].l : (slots[i].t || SHORT[slots[i].k] || slots[i].l);
            ring.appendChild(el);
            segs.push(el);
        }
        wrap.classList.toggle('lvl2', lvl === 2);
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

    function setProgress(p) {
        arc.style.strokeDasharray = arcLen;
        arc.style.strokeDashoffset = arcLen * (1 - p);
        arc.style.opacity = p > 0 ? '' : '0';
        if (dwellIdx >= 0 && segs[dwellIdx]) segs[dwellIdx].style.setProperty('--p', p.toFixed(3));
    }
    function resetDwell(i) {
        if (dwellIdx >= 0 && segs[dwellIdx]) segs[dwellIdx].style.removeProperty('--p');
        dwellIdx = i;
        // Po přepnutí kruhu (reanchor) se odpočet rozjede až po GRACE ms — viz reanchor().
        dwellFrom = (i >= 0) ? Math.max(Date.now(), (st && st.graceTo) || 0) : 0;
        setProgress(0);
    }
    function tick() {
        raf = 0;
        if (!st) return;
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
        st = null; lastHot = -1;
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
