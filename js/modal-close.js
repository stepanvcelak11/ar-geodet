// ===== AR Geodet — ZAVÍRÁNÍ MODÁLŮ: křížek + potáhnutí do strany (ODPOJITELNÁ vrstva) =====
// Modály jedou přes celou obrazovku (na přání) a zavírají se tlačítkem „Zavřít"
// AŽ NA KONCI obsahu — u dlouhých oken (O aplikaci, Předpisy, Slovník) se k němu
// musíš prorolovat. Tahle vrstva přidává dvě běžné cesty ven:
//
//   • KŘÍŽEK vpravo nahoře — vždy na očích, nikam se neroluje.
//   • POTÁHNUTÍ DO STRANY — gesto „zpět", které lidi znají z mobilů.
//
// SMĚR GESTA: normálně ZLEVA DOPRAVA (palec pravé ruky odsune okno pryč).
// V režimu levé ruky (body.left-hand) se otáčí na ZPRAVA DOLEVA, stejně jako se
// zrcadlí ostatní ovládání. Směr se čte při každém začátku tahu, takže přepnutí
// režimu za běhu funguje okamžitě.
//
// PROČ do strany a ne dolů: dřív se táhlo dolů, jenže dolů/nahoru je v každém
// okně ROLOVÁNÍ obsahu. Gesto se proto smělo natáhnout jen s obsahem úplně
// nahoře a v dlouhých oknech bylo prakticky nedostupné. Vodorovný tah s
// rolováním nekoliduje a čte se jako tlačítko „zpět".
//
// Původní tlačítka „Zavřít" zůstávají a nic se jim nemění.
//
// Jak se zavírá: NEVYPÍNÁ modál natvrdo. Nejdřív hledá jeho VLASTNÍ zavírací
// tlačítko a klikne na něj, aby proběhl úklid, který k němu patří (closeManageModal
// volá fixAppLayout, closeCustomModal maže rozdělaný bod…). Teprve když žádné
// nenajde, schová overlay sám.
//
// Na co si dát pozor (a proč to tak je):
//   - Převládne-li SVISLÝ pohyb, gesto se zruší — uživatel roluje obsah a jen mu
//     u toho cukla ruka do strany.
//   - Tah, který začal v prvku s VODOROVNÝM rolováním, se vůbec nezaloží.
//     Takové v appce jsou: #ag-rp-list (výběr režimu práce), segmentované
//     přepínače v Nástrojích, pásy dlaždic, široké tabulky (.ag-zb-tblwrap,
//     .ag-ep-tblwrap, .prd-tablewrap). Kdyby gesto vzniklo i tam, nešlo by se
//     v takovém pásu posunout — každé přejetí by zavřelo okno. Hledá se nejbližší
//     předek s overflow-x auto/scroll, který má opravdu co posouvat
//     (scrollWidth > clientWidth); pouhé overflow-x v CSS nestačí.
//   - Prvky, kde vodorovný tah znamená něco jiného, jsou vyjmuté: posuvníky,
//     select, textarea, canvas, video, contenteditable, mapa Leaflet a cokoli
//     s [data-no-swipe].
//   - iOS má u kraje displeje vlastní „swipe back". Gesto se proto natahuje až
//     poté, co prst ujede ARM_PX — do té doby se nic nepřekresluje a systémové
//     gesto si může vzít přednost.
//   - Když tažení začne na tlačítku, po pohybu se následný klik spolkne, ať se
//     omylem nespustí akce, od které jen odjíždíš.
//   - .modal-content má v CSS animaci otevření s fill-mode both. Animace přebíjí
//     inline style, takže při tažení se musí vypnout (mc.style.animation='none'),
//     jinak by se prvek ani nehnul.
//
// Záběr: overlaye .modal-overlay, které mají uvnitř .modal-content (domácí styl —
// 13 modálů z index.html + moduly, které ho dodržují). Moduly s vlastním obalem
// (např. .ag-zv-ov u Závad) se ZÁMĚRNĚ nechávají být — hádat, co je v cizím okně
// panel a co scrollovací oblast, by rozbíjelo víc, než by to spravilo.
//
// Vypnutí pro konkrétní okno:
//   data-no-close  — žádný křížek (okno se zavírá jen po svém). Má ho #settings-modal:
//                    Nastavení se ukládá TEPRVE v saveSettings(), takže zavření mimo
//                    jeho vlastní tlačítko by tiše zahodilo přenastavené hodnoty.
//                    POZOR: od 9. 8. 2026 to už NEVYPÍNÁ GESTO — okna vypsaná v
//                    SAVE_CLOSE se tahem zavřou skrz své ukládací tlačítko. Kdo chce
//                    vypnout obojí, přidá i data-no-swipe. Esc zůstává jen u oken,
//                    která se smí zavřít bez uložení (Esc = „zruš to").
//   data-no-swipe  — křížek ano, gesto ne. Má ho formulář nového bodu: ťuknout na
//                    ✕ je rozhodnutí, ale nechtěné cuknutí prstem by zahodilo
//                    rozepsaný bod.
// Odstranění celé vrstvy: smaž js/modal-close.js + řádek v index.html a v sw.js.
// ==============================================================================
(function () {
    'use strict';
    if (window.AGModalClose) return;

    var STYLE_ID = 'ag-modalclose-style';
    var CLOSE_PX = 110;        // o kolik se musí panel odtáhnout do strany, aby se zavřelo
    var FLICK_PX = 55;         // rychlé šviháknutí do strany stačí kratší
    var FLICK_SPEED = 0.45;    // px/ms
    var ARM_PX = 10;           // od kdy je to tažení, ne ťuknutí (a nechá prostor iOS swipe-back)
    var MAX_PULL = 260;        // dál už se panel do strany nehne (gumový doraz)

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // křížek visí na OVERLAYI, ne v .modal-content — kdyby dostal
            // position:relative, změnil by se pod ním souřadný systém pro
            // absolutně umístěné prvky uvnitř modulů.
            // ⚠ POZADÍ KŘÍŽKU MUSÍ BÝT NEPRŮHLEDNÉ (nahlášeno 29. 8. 2026: „v bílém
            // režimu nejsou vidět křížky na vyvolání nástroje"). Dřív tu bylo
            // `--surface-2`, tedy 6% černá — barvu si tedy brala od toho, co leželo
            // pod ní. Okna modulů si ale podklad kreslí každé po svém a spousta jich
            // zůstává tmavá i ve světlém režimu, takže tmavý glyf (--text-color je ve
            // světlém #141821) sedl na tmavý panel a křížek prostě zmizel. Pevná
            // deska + obrys + stín drží tvar čitelný na jakémkoli podkladu.
            '.agmc-x{position:absolute;z-index:30;top:calc(env(safe-area-inset-top,0px) + 10px);',
            '  right:calc(env(safe-area-inset-right,0px) + 10px);width:40px;height:40px;border-radius:50%;',
            '  display:flex;align-items:center;justify-content:center;cursor:pointer;',
            '  background:#1b2028;border:1px solid rgba(255,255,255,0.22);color:#f2f4f7;',
            '  box-shadow:0 2px 10px rgba(0,0,0,0.45);padding:0;line-height:0;',
            '  transition:transform .12s ease,background .15s ease;}',
            'body.light-mode .agmc-x{background:#ffffff;border-color:rgba(15,23,42,0.28);color:#141821;',
            '  box-shadow:0 2px 10px rgba(15,23,42,0.28);}',
            '.agmc-x:active{transform:scale(.92);}',
            'body.light-mode .agmc-x:active{background:#eceef1;}',
            '.agmc-x svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;}',
            // levá ruka: křížek přejde na druhou stranu jako ostatní ovládání
            'body.left-hand .agmc-x{right:auto;left:calc(env(safe-area-inset-left,0px) + 10px);}',
            // nadpis se musí křížku vyhnout (jinak by ho dlouhý název podlezl)
            '.modal-overlay .modal-content > h2:first-child,',
            '.modal-overlay .modal-content > h3:first-child{padding-right:46px;}',
            'body.left-hand .modal-overlay .modal-content > h2:first-child,',
            'body.left-hand .modal-overlay .modal-content > h3:first-child{padding-right:0;padding-left:46px;}',
            // úchyt: SVISLÁ čárka u té hrany, ze které se táhne — tichá nápověda
            // na směr gesta. Vlevo (pravá ruka), v levorukém režimu vpravo.
            '.agmc-grab{position:absolute;z-index:29;top:50%;',
            '  left:calc(env(safe-area-inset-left,0px) + 5px);right:auto;',
            '  transform:translateY(-50%);width:4px;height:48px;border-radius:99px;pointer-events:none;',
            '  background:var(--surface-3,rgba(255,255,255,0.16));}',
            'body.left-hand .agmc-grab{left:auto;right:calc(env(safe-area-inset-right,0px) + 5px);}',
            // tažení: panel jde do strany, pozadí se prosvětluje
            '.agmc-drag{transition:none !important;}',
            '.agmc-back{transition:transform .22s cubic-bezier(.22,.61,.36,1);}',
            '@media (prefers-reduced-motion:reduce){.agmc-back{transition:none;}}',
            // ---- USAZENÍ OKNA (viz oddíl v JS níž) ---------------------------------
            // Vnitřek okna se drží neviditelný, ale NA SVÉM MÍSTĚ: opacity, ne
            // display/visibility. Rozměry i rolování tak zůstávají spočítané a prvek,
            // na který si modul při otevření sáhl fokusem (hledáček v chatu), o fokus
            // nepřijde — visibility:hidden by mu ho sebrala.
            '.modal-overlay[data-agmc-usazeni] > .modal-content > *{opacity:0 !important;}',
            // Nápis dostane jen DLOUHÉ čekání (hodnotu atributu přepne JS po NAPIS_MS) —
            // krátké usazení tak nemá jak ho ukázat. Text je v CSS schválně: do cizího
            // okna se nevkládá žádný prvek, který by tam po odpojení vrstvy zůstal.
            '.modal-overlay[data-agmc-usazeni="napis"]::after{content:"Načítám…";position:absolute;z-index:28;',
            '  left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;pointer-events:none;',
            '  color:var(--text-muted,#9aa1ac);font:500 15px/1.4 var(--font-ui,system-ui),sans-serif;',
            '  animation:agmc-usaz-in .18s both;}',
            '@keyframes agmc-usaz-in{from{opacity:0;}to{opacity:1;}}',
            // Opozdilec (proužek, který do OTEVŘENÉHO okna vloží jiná vrstva) se
            // nerozsvítí skokem, ale rozvine se. ⚠ ROZMĚR JDE INLINE STYLEM, NE var()
            // V @keyframes — var() uvnitř @keyframes starší WebKity celý blok zahodí
            // (vypsáno v css/style.css u @keyframes pulse-target). Proto přechod.
            '.agmc-pozde{overflow:hidden;transition:max-height .24s var(--ease-out,ease),opacity .24s ease;}',
            '.agmc-pozde-0{max-height:0 !important;opacity:0 !important;}',
            '@media (prefers-reduced-motion:reduce){.agmc-pozde{transition:none;}',
            '  .modal-overlay[data-agmc-usazeni="napis"]::after{animation:none;}}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    var X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

    // ---- OKNA MODULŮ (vlastní obal, ne .modal-overlay) --------------------------
    // Na přání 9. 8. 2026: „ať jdou všechny nástroje vypnout posunutím zleva doprava,
    // ať to nemusím zavírat křížkem." Domácí modály to uměly už dřív, ale zhruba
    // dvacet nástrojů si kreslí okno po svém (#ag-zb-ov, #ag-pm-ov, .ag-zv-ov…) a ta
    // se tu ZÁMĚRNĚ nechávala být, protože hádat v cizím okně, co je panel, rozbíjelo
    // víc, než spravilo. Teď se tedy nehádá NIC, co by mohlo ublížit:
    //   • okno musí být přes celý displej, viditelné a klikatelné (pointer-events),
    //     takže zaměřovací vrstvy AR (pointer-events:none) vypadnou samy,
    //   • ZAVÍRÁ SE VÝHRADNĚ JEHO VLASTNÍM TLAČÍTKEM. Nikdy se nesahá na display —
    //     nástroj s kamerou nebo wake lockem by po takovém „zavření" běžel dál.
    //     Když se tlačítko nenajde, gesto se prostě nechytne.
    //   • ⚠ Okna s vlastním gestem nebo kreslicí plochou jsou vyjmutá jmenovitě
    //     (kolečko nástrojů, brána, úvodní obrazovka, blokátor tutoriálu); plátna,
    //     jezdce, mapu a [data-no-swipe] vyřazuje už onStart níž.
    var MOD_SKIP = { 'ag-kn': 1, 'ag-gate': 1, 'ag-login': 1, 'welcome-screen': 1, 'agtp-block': 1 };
    function modOverlay(el) {
        if (!el || el.nodeType !== 1 || !el.id && !el.className) return false;
        if (el.id && MOD_SKIP[el.id]) return false;
        if (el.hasAttribute && el.hasAttribute('data-no-swipe')) return false;
        if (el.classList && el.classList.contains('modal-overlay')) return false;
        var st;
        try { st = window.getComputedStyle(el); } catch (e) { return false; }
        if (!st || st.position !== 'fixed' || st.display === 'none') return false;
        if (st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false;
        if (st.pointerEvents === 'none') return false;
        // ⚠⚠ BEZ TOHOHLE by prošlo i POZADÍ APPKY. Mapa i AR jsou taky celoobrazovkové
        // fixed vrstvy s tlačítky uvnitř — tah po mapě by pak hledal „Zavřít" a mohl
        // spustit něco úplně jiného. Okna nástrojů mají všechna z-index 9200 a výš
        // (dok má 9000, mapa a AR o mnoho níž), takže tohle je čára mezi „okno" a
        // „obsah appky". Mapu sice vyřazuje i .leaflet-container v onStart, ale na
        // takovou jednu pojistku spoléhat nechci.
        var z = parseInt(st.zIndex, 10);
        if (!(z >= 1000)) return false;
        var r = el.getBoundingClientRect();
        return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.6;
    }
    // Panel k odtažení: když má okno JEDINÉ dítě užší než displej, je to karta a táhne
    // se ona; jinak je celé okno plachta přes displej a táhne se celé.
    function modPanel(ov) {
        var kids = ov.children, card = null, n = 0;
        for (var i = 0; i < kids.length; i++) {
            var k = kids[i];
            if (k.nodeType !== 1) continue;
            var st = window.getComputedStyle(k);
            if (st.display === 'none' || st.position === 'absolute' || st.position === 'fixed') continue;
            n++;
            if (k.getBoundingClientRect().width < window.innerWidth * 0.92) card = k;
        }
        return (n === 1 && card) ? card : ov;
    }

    function eligible(ov) {
        return ov && ov.classList && ov.classList.contains('modal-overlay') &&
            ov.getAttribute('data-no-close') === null && !!ov.querySelector('.modal-content');
    }

    // ---- okna, která se zavírají ULOŽENÍM --------------------------------------
    // #settings-modal má data-no-close, protože Nastavení se ukládá TEPRVE tlačítkem
    // „Uložit vše a Zavřít" (saveSettings()) — zavřít ho gestem by tiše zahodilo vše
    // přenastavené. Na přání z 9. 8. 2026 („musím vždycky scrollovat dolů na uložit
    // vše a zavřít, tak bych dal i swajpování, že by fungovalo stejně") gesto FUNGUJE,
    // ale ne jako „zavřít": tah spustí přesně to tlačítko, takže se uloží.
    //
    // KŘÍŽEK tu ZŮSTÁVÁ VYPNUTÝ ZÁMĚRNĚ. ✕ se všude čte jako „zruš to" a mlčky uložit
    // něco, co člověk chtěl zahodit, by bylo horší než dojet dolů na tlačítko. Tah do
    // strany je naopak gesto „hotovo, jdu pryč" — a to se ukládáním nebije.
    // Úchyt u hrany (.agmc-grab) se ukáže, aby bylo gesto vůbec k nalezení.
    var SAVE_CLOSE = { 'settings-modal': 'saveSettings' };
    function saveCloses(ov) { return !!(ov && ov.id && SAVE_CLOSE[ov.id]); }

    // Gestem se zavírají běžná okna I ta, která se zavírají uložením.
    function swipeable(ov) {
        if (!ov || !ov.classList || !ov.classList.contains('modal-overlay')) return false;
        if (!ov.querySelector('.modal-content')) return false;
        return eligible(ov) || saveCloses(ov);
    }
    // Tlačítko, jehož obsluha volá danou funkci — klikáme na NĚJ, ne na funkci samu,
    // aby proběhlo i to, co si k němu případně přivěsil jiný modul.
    function fnButton(mc, fn) {
        var btns = mc.querySelectorAll('button');
        var re = new RegExp('(^|[^\\w.$])' + fn + '\\s*\\(');
        for (var i = 0; i < btns.length; i++) {
            if (re.test(btns[i].getAttribute('onclick') || '')) return btns[i];
        }
        return null;
    }

    // +1 = zavírá se tahem zleva doprava, -1 = zprava doleva (režim levé ruky)
    function closeDir() {
        return (document.body && document.body.classList &&
                document.body.classList.contains('left-hand')) ? -1 : 1;
    }

    // ---- zavření: nejdřív vlastní tlačítko okna, teprve pak natvrdo ------------
    // POZOR na past: v Nástrojích má KAŽDÁ dlaždice v onclicku „…display='none';
    // openNeco()" — tedy taky zavírá. Kdyby se bralo první tlačítko, jehož obsluha
    // obsahuje zavření, křížek by místo zavření OTEVŘEL nástroj. Proto se bere jen
    // tlačítko, jehož obsluha nedělá NIC JINÉHO než zavření (jediný příkaz).
    var ONLY_HIDE = /^\s*(?:window\.)?document\s*\.\s*getElementById\(\s*['"][\w-]+['"]\s*\)\s*\.\s*style\s*\.\s*display\s*=\s*['"]none['"]\s*;?\s*$/i;
    // jediné volání funkce, která zavírá — vč. „dismiss/hide/cancel" (např.
    // dismissCompassCalib(), která si navíc pamatuje, že jsi to přeskočil)
    var ONLY_CLOSE_CALL = /^\s*(?:window\.)?(?:close|dismiss|hide|cancel)[\w]*\(\s*\)\s*;?\s*$/i;

    function ownCloseButton(mc) {
        var btns = mc.querySelectorAll('button');
        var best = null, bestScore = 0;
        for (var i = 0; i < btns.length; i++) {
            var b = btns[i];
            var t = (b.textContent || '').trim().toLowerCase();
            var oc = (b.getAttribute('onclick') || '').trim();
            var score = 0;
            var al = (b.getAttribute('aria-label') || '').trim().toLowerCase();
            if (t === 'zavřít' || t === 'zavrit') score = 100;
            else if (al === 'zavřít' || al === 'zavrit') score = 90;
            // samotný křížek jako popisek tlačítka (moduly ho mají místo slova)
            else if (t === '✕' || t === '×' || t === '✖' || t === 'x') score = 85;
            else if (ONLY_HIDE.test(oc) || ONLY_CLOSE_CALL.test(oc)) score = 80;
            // >= : při stejném skóre vyhrává POZDĚJŠÍ tlačítko — zavírací bývá dole
            if (score && score >= bestScore) { best = b; bestScore = score; }
        }
        return best;
    }

    function closeOverlay(ov, panel) {
        var mc = ov.querySelector('.modal-content');
        resetPull(panel || mc);
        // okno modulu: jen a pouze jeho vlastním tlačítkem (viz modOverlay výš)
        if (!mc) {
            var ob = ownCloseButton(ov);
            if (ob) { try { ob.click(); } catch (e0) { window.AG && AG.swallow && AG.swallow(e0, 'modal-close:closeOverlay'); } }
            return;
        }
        // okno, které se zavírá uložením (Nastavení) → jeho vlastní cestou
        var sfn = ov.id ? SAVE_CLOSE[ov.id] : null;
        if (sfn) {
            var sb = mc ? fnButton(mc, sfn) : null;
            if (sb) { try { sb.click(); return; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'modal-close:closeOverlay'); } }
            // tlačítko se nenašlo (přeskládané okno) — volej funkci přímo, ta si
            // okno zavírá sama; kdyby nebyla, propadne se to na obecnou cestu níž
            try { if (typeof window[sfn] === 'function') { window[sfn](); return; } } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'modal-close:closeOverlay'); }
        }
        var btn = mc ? ownCloseButton(mc) : null;
        if (btn) { try { btn.click(); return; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'modal-close:closeOverlay'); } }
        ov.style.display = 'none';
        // úklid, který dělají zavírací funkce v logika.js/grafika.js
        try { if (typeof window.fixAppLayout === 'function') window.fixAppLayout(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'modal-close:closeOverlay'); }
    }

    // ---- USAZENÍ OKNA: obsah se ukáže, až je co ukazovat -------------------------
    // NAHLÁŠENO 31. 8. 2026: „když něco otevřu, něco mi tam problikne, něco jiného
    // než jak má. Zvláštně se to načítá."
    //
    // CO SE DĚJE (naměřeno v Chromiu snímek po snímku, ne odhadnuto): okno se ukáže
    // hotové, ale pak do NĚJ JEŠTĚ NĚKDO SÁHNE a obsah poskočí. Nejde o jeden nástroj:
    //   • Obchůzka výkopu — 64 ms okno, 332 ms se nahoru vsune proužek s odkazem na
    //     druhou cestu (js/nastroje-parky.js hlídá okna tikem 2×/s) a všechno pod ním
    //     spadne o dva řádky níž. Totéž Kubatury (474 ms), Volné stanovisko (287 ms).
    //   • Ročenka — 46 ms „Počítám…", 85 ms hotová tabulka. Čtyřicet milisekund
    //     nápisu, který nemá kdo přečíst; navenek to je přesně to „probliknutí".
    // Společný jmenovatel: okno se vykreslí DŘÍV, než je hotové.
    //
    // JAK SE TO ŘEŠÍ: okno, které se právě ukázalo, má vnitřek neviditelný a odhalí
    // se teprve ve chvíli, kdy se do něj přestalo sypat. Klidné okno je venku po
    // DVOU SNÍMCÍCH (~32 ms), takže se nikde nic nezdrží.
    //
    // ⚠ ŽÁDNÉ PEVNÉ ČEKÁNÍ NA OTEVÍRACÍ ANIMACI. Nejdřív se tu drželo okno vždycky
    // až do konce modal-in (0,32 s) s úvahou „dokud okno naskakuje, obsah se stejně
    // nedá číst". V prohlížeči to dopadlo přesně naopak: KAŽDÉ okno se rozjelo
    // prázdné, na 100 ms v něm probliklo „Načítám…" a teprve pak přišel obsah —
    // tedy nové probliknutí místo opraveného. Podlaha je proto nula a čeká se JEN
    // na klid.
    //
    // ⚠ USAZOVÁNÍ SLEDUJE JEN PŘIBÝVÁNÍ A UBÝVÁNÍ PRVKŮ, ne textu. Okna se živou
    // hodnotou (azimut v Kompasu, čas v Odhadni to) přepisují textové uzly každou
    // chvíli; kdyby se to počítalo jako „ještě se sype", visela by nad nimi plachta
    // až do stropu a člověk by místo okna koukal na „Načítám…".
    //
    // ⚠ OKNO, KTERÉ SE DOSYPÁVÁ POZDĚ, SI TO PAMATUJE. Proužek z nastroje-parky.js
    // přiletí kdykoli během jeho půlvteřinového tiku — čekat na něj plošně u všech
    // nástrojů by zdrželo devadesát oken kvůli čtyřem. Když se ale u konkrétního okna
    // JEDNOU stane, že mu do hotového obsahu ještě přibyl prvek, počká se u něj příště
    // rovnou celý tik (DOSYP_MS). Ostatních se to nedotkne.
    //
    // Odpojení: smaž tenhle oddíl i jeho pravidla z injectStyles(). Bez CSS je
    // atribut jen značka a okna se chovají jako dřív — nic se nezasekne.
    var USAZ_ATTR = 'data-agmc-usazeni';
    var USAZ_MAX = 600;      // strop pro okno, které se nikdy neuklidní
    var DOSYP_MS = 560;      // okno, které už jednou dosypávalo (tik parků je 500 ms)
    var POZDE_MS = 1200;     // do kdy po odhalení se přírůstek počítá za „opozdilce"
    var NAPIS_MS = 380;      // od kdy má čekání nápis (kratší se nesmí ani mihnout)
    // Nástroje se plní postupně, jak doléhají líně načtené moduly (js/lazy-load.js);
    // držet je pod plachtou by znamenalo čekat na seznam, který stejně roste dál.
    var USAZ_SKIP = { 'tools-modal': 1, 'welcome-screen': 1, 'ag-gate': 1, 'ag-login': 1 };

    function raf(fn) {
        if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(fn);
        return setTimeout(fn, 16);
    }
    function ted() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
    // ⚠ ČTYŘI HLAVNÍ OKNA NEMAJÍ display:none. Nastavení, Body, Nástroje a Nový bod
    // mají v css/style.css natvrdo `display:flex !important` (aby transition naběhla
    // i při prvním otevření) a otevřenost jim řídí JEN třída .ag-open — tu podle
    // inline display přepíná skript na konci index.html. Kdyby se videt() ptala jen
    // na display, byla by tahle okna „viditelná" už od startu appky: sleduj() by si
    // hned uložilo bylo=true, plachta by proběhla naprázdno nad zavřeným oknem a při
    // skutečném otevření by se nenasadila. Stejnou výjimku má coreWin() v js/mini-panel.js.
    var CORE_ANIM = { 'settings-modal': 1, 'manage-modal': 1, 'tools-modal': 1, 'custom-modal-overlay': 1 };
    function videt(el) {
        try {
            var st = window.getComputedStyle(el);
            if (st.display === 'none' || st.visibility === 'hidden') return false;
            if (el.id && CORE_ANIM[el.id] && !el.classList.contains('ag-open')) return false;
            return true;
        } catch (e) { return false; }
    }
    function prvekMezi(list) {
        for (var i = 0; i < list.length; i++) if (list[i].nodeType === 1) return true;
        return false;
    }
    // Opozdilec: prvek, který přibyl do UŽ ODHALENÉHO okna. Skokem by shodil obsah
    // pod sebou; takhle se rozvine. Rozměr se měří až po vložení, aby se dlouhý
    // proužek na konci neusekl.
    function rozvin(el) {
        var h;
        try { h = el.offsetHeight; } catch (e) { return; }
        // Rozvíjí se jen PROUŽEK. Velký panel by se musel na 240 ms osekat výškou a
        // scrollovací oblast (.modal-body) by u toho na okamžik přišla o rolování —
        // to je horší než to, co se tím spravuje.
        if (!h || h > window.innerHeight * 0.5) return;
        try {
            var st = window.getComputedStyle(el);
            if (st.overflowY === 'auto' || st.overflowY === 'scroll') return;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'modal-close:rozvin'); }
        el.classList.add('agmc-pozde', 'agmc-pozde-0');
        raf(function () {
            raf(function () {
                el.style.maxHeight = h + 'px';
                el.classList.remove('agmc-pozde-0');
                setTimeout(function () {
                    el.classList.remove('agmc-pozde');
                    el.style.maxHeight = '';
                }, 320);
            });
        });
    }

    function usadit(ov) {
        if (ov.__agmcUsaz) return;                     // usazení už běží
        if (ov.id && USAZ_SKIP[ov.id]) return;
        var mc = ov.querySelector('.modal-content');
        if (!mc) return;                               // okno modulu s vlastním obalem
        ov.__agmcUsaz = true;
        ov.setAttribute(USAZ_ATTR, '1');

        var neklid = true;                             // první snímek je vždycky „ještě se sype"
        var mo = null;
        try {
            mo = new MutationObserver(function (recs) {
                for (var i = 0; i < recs.length; i++) {
                    if (prvekMezi(recs[i].addedNodes) || prvekMezi(recs[i].removedNodes)) { neklid = true; return; }
                }
            });
            mo.observe(mc, { childList: true, subtree: true });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'modal-close:usadit'); }

        var start = ted();
        var podlaha = ov.__agmcDosypava ? DOSYP_MS : 0;
        var strop = Math.max(USAZ_MAX, podlaha);
        // Nápis se zapíná AŽ TEĎ, ne v CSS s prodlevou: krátké usazení (drtivá
        // většina oken) tak nemá jak ho ukázat ani na jeden snímek.
        var napis = setTimeout(function () {
            if (ov.__agmcUsaz) ov.setAttribute(USAZ_ATTR, 'napis');
        }, NAPIS_MS);

        // ⚠ POJISTKA PROTI PRÁZDNÉMU OKNU: requestAnimationFrame se v zavřeném/skrytém
        // prohlížeči ZASTAVÍ. Kdyby se okno otevřelo těsně předtím, než člověk odejde
        // z appky, zůstalo by po návratu viset pod plachtou, dokud se snímky nerozjedou.
        // Prázdné okno v terénu je horší než probliknutí, takže tohle plachtu sundá
        // i bez snímků.
        var pojistka = setTimeout(function () { if (ov.__agmcUsaz) konec(); }, strop + 1500);

        function konec() {
            clearTimeout(napis);
            clearTimeout(pojistka);
            if (mo) { try { mo.disconnect(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'modal-close:usadit'); } }
            ov.removeAttribute(USAZ_ATTR);
            ov.__agmcUsaz = false;
            hlidejOpozdilce(ov, mc);
        }
        function tik() {
            var uply = ted() - start;
            // zavřeno pod plachtou (Esc, gesto) → plachtu pryč, ať se okno příště
            // neotevře rovnou zakryté
            if (!videt(ov)) { konec(); return; }
            if (uply >= strop || (!neklid && uply >= podlaha)) { konec(); return; }
            neklid = false;
            raf(tik);
        }
        raf(tik);
    }

    // Po odhalení se ještě chvíli kouká, jestli do okna někdo nesáhne. Bere se JEN
    // přímý potomek .modal-content — to je stavební zásah (proužek, panel), kdežto
    // překreslení vnitřku seznamu je normální život okna a rozvíjet se nemá.
    function hlidejOpozdilce(ov, mc) {
        var mo;
        try {
            mo = new MutationObserver(function (recs) {
                for (var i = 0; i < recs.length; i++) {
                    if (recs[i].target !== mc) continue;
                    var add = recs[i].addedNodes;
                    for (var j = 0; j < add.length; j++) {
                        if (add[j].nodeType !== 1) continue;
                        ov.__agmcDosypava = true;      // příště se na něj počká rovnou
                        rozvin(add[j]);
                    }
                }
            });
            mo.observe(mc, { childList: true });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'modal-close:hlidejOpozdilce'); return; }
        setTimeout(function () { try { mo.disconnect(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'modal-close:hlidejOpozdilce'); } }, POZDE_MS);
    }

    // Okno se otevírá dvěma způsoby (style.display i classList), takže se hlídají
    // oba atributy. Změna atributu dorazí jako mikroúkol JEŠTĚ PŘED VYKRESLENÍM
    // snímku, takže se plachta stihne nasadit dřív, než se okno poprvé ukáže.
    function sleduj(ov) {
        if (ov.__agmcSled) return;
        ov.__agmcSled = true;
        var bylo = videt(ov);
        if (bylo) usadit(ov);                          // okno vzniklo rovnou otevřené
        try {
            new MutationObserver(function () {
                var je = videt(ov);
                if (je && !bylo) usadit(ov);
                bylo = je;
            }).observe(ov, { attributes: true, attributeFilter: ['style', 'class'] });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'modal-close:sleduj'); }
    }

    // ---- křížek + úchyt --------------------------------------------------------
    function decorate(ov) {
        injectStyles();
        sleduj(ov);              // usazení platí i pro okna bez křížku a bez gesta
        if (!swipeable(ov)) return;
        // KŘÍŽEK jen tam, kde se smí zavřít bez uložení (viz SAVE_CLOSE výš)
        if (eligible(ov) && !ov.querySelector(':scope > .agmc-x')) {
            var x = document.createElement('button');
            x.type = 'button';
            x.className = 'agmc-x';
            x.setAttribute('aria-label', 'Zavřít');
            x.innerHTML = X_SVG;
            x.addEventListener('click', function (e) {
                e.stopPropagation();
                closeOverlay(ov);
            });
            ov.appendChild(x);
        }
        // ÚCHYT má i okno bez křížku — jinak by o gestu nikdo nevěděl
        if (!ov.querySelector(':scope > .agmc-grab')) {
            var g = document.createElement('div');
            g.className = 'agmc-grab';
            ov.appendChild(g);
        }
    }

    function scanAll(root) {
        var list = (root || document).querySelectorAll('.modal-overlay');
        for (var i = 0; i < list.length; i++) decorate(list[i]);
    }

    // ---- tažení do strany ------------------------------------------------------
    var drag = null;

    // Nejbližší předek (od cíle po .modal-content), který se dá rolovat VODOROVNĚ
    // a opravdu má co posouvat. Když takový existuje, gesto nevzniká — jinak by
    // se v pásu dlaždic / segmentovaném přepínači nedalo posunout, protože každé
    // přejetí prstem by zavřelo okno.
    function hScrollAncestor(el, stop) {
        while (el && el !== stop && el.nodeType === 1) {
            var st = window.getComputedStyle(el), ox = st.overflowX;
            if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2) return el;
            el = el.parentNode;
        }
        return null;
    }

    function resetPull(mc) {
        if (!mc) return;
        mc.classList.remove('agmc-drag');
        mc.style.transform = '';
        mc.style.animation = '';
        mc.style.opacity = '';
    }

    function onStart(e) {
        drag = null;
        if (!e.touches || e.touches.length !== 1) return;
        var t = e.target;
        if (!t || !t.closest) return;
        var ov = t.closest('.modal-overlay'), mc = null;
        if (ov) {
            if (!swipeable(ov) || ov.style.display === 'none') return;
            mc = ov.querySelector('.modal-content');
            if (!mc || !mc.contains(t)) return;
        } else {
            // okno, které si kreslí modul sám — najít nejbližší celoobrazovkový obal
            var el = t;
            while (el && el !== document.body && el.nodeType === 1) {
                if (modOverlay(el)) break;
                el = el.parentNode;
            }
            if (!el || el === document.body || el.nodeType !== 1) return;
            if (!ownCloseButton(el)) return;      // není čím zavřít → gesto nevzniká
            ov = el; mc = modPanel(el);
        }
        // prvky, u kterých vodorovný tah znamená něco jiného
        if (t.closest('input[type="range"],select,textarea,canvas,video,[contenteditable],' +
                      '.leaflet-container,[data-no-swipe]')) return;
        // posouvat obsah do stran > zavírat: v takovém prvku gesto vůbec nezakládáme
        if (hScrollAncestor(t, mc)) return;
        drag = {
            ov: ov, mc: mc, dir: closeDir(),
            x0: e.touches[0].clientX, y0: e.touches[0].clientY,
            t0: (e.timeStamp || 0), p: 0, armed: false, dead: false
        };
    }

    function onMove(e) {
        if (!drag || drag.dead || !e.touches || e.touches.length !== 1) return;
        var dx = e.touches[0].clientX - drag.x0;
        var dy = e.touches[0].clientY - drag.y0;
        var p = dx * drag.dir;               // posun ve „zavíracím" směru, vždy kladný
        if (!drag.armed) {
            if (Math.abs(dy) > Math.abs(dx)) { drag.dead = true; return; }  // svisle = rolování obsahu
            if (p < -2) { drag.dead = true; return; }                       // tah na opačnou stranu
            if (p < ARM_PX) return;
            drag.armed = true;
            drag.mc.classList.add('agmc-drag');
            drag.mc.style.animation = 'none';   // animace otevření by inline transform přebila
        }
        e.preventDefault();                     // od téhle chvíle táhneme my
        drag.p = p;
        // gumový doraz: čím dál, tím menší přírůstek
        var shown = p > MAX_PULL ? MAX_PULL + (p - MAX_PULL) * 0.15 : p;
        drag.mc.style.transform = 'translateX(' + (shown * drag.dir) + 'px)';
        drag.mc.style.opacity = String(Math.max(0.55, 1 - p / 900));
    }

    function onEnd(e) {
        var d = drag; drag = null;
        if (!d || !d.armed) return;
        d.mc.classList.remove('agmc-drag');
        var dt = Math.max(1, (e.timeStamp || 0) - d.t0);
        var fast = (d.p / dt) > FLICK_SPEED;
        if (d.p > CLOSE_PX || (d.p > FLICK_PX && fast)) {
            closeOverlay(d.ov, d.mc);
            // POŘADÍ: až PO zavření. closeOverlay klikne na vlastní tlačítko okna
            // a polykač klikům (capture + stopPropagation) by ten klik zabil dřív,
            // než by se k tlačítku dostal — okno by se nezavřelo.
            swallowNextClick();
            return;
        }
        d.mc.classList.add('agmc-back');
        d.mc.style.transform = '';
        d.mc.style.opacity = '';
        setTimeout(function () {
            d.mc.classList.remove('agmc-back');
            d.mc.style.animation = '';
        }, 240);
        // po tažení spolknout klik, ať se nespustí tlačítko, ze kterého se odjíždělo
        if (Math.abs(d.p) > ARM_PX) swallowNextClick();
    }

    function onCancel() {
        var d = drag; drag = null;
        if (d && d.armed) { d.mc.classList.remove('agmc-drag'); resetPull(d.mc); }
    }

    function swallowNextClick() {
        var kill = function (ev) {
            ev.stopPropagation();
            ev.preventDefault();
        };
        document.addEventListener('click', kill, true);
        setTimeout(function () { document.removeEventListener('click', kill, true); }, 350);
    }

    // ---- start -----------------------------------------------------------------
    function init() {
        injectStyles();
        scanAll(document);
        // modály si vyrábějí i moduly za běhu → hlídat přírůstky v DOM
        try {
            new MutationObserver(function (recs) {
                for (var i = 0; i < recs.length; i++) {
                    var added = recs[i].addedNodes;
                    for (var j = 0; j < added.length; j++) {
                        var n = added[j];
                        if (n.nodeType !== 1) continue;
                        if (n.classList && n.classList.contains('modal-overlay')) decorate(n);
                        else if (n.querySelector) scanAll(n);
                    }
                    // Modul, který si přepíše innerHTML svého okna, by křížek smazal —
                    // a taky sem patří okna, jejichž .modal-content vzniká až teď
                    // (do té doby decorate() nemá co ozdobit). Opakované volání nic
                    // nestojí, decorate() se při existujícím křížku hned vrátí.
                    var tgt = recs[i].target;
                    if (tgt && tgt.closest) {
                        var host = tgt.closest('.modal-overlay');
                        if (host) decorate(host);
                    }
                }
            }).observe(document.body, { childList: true, subtree: true });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'modal-close:init'); }

        document.addEventListener('touchstart', onStart, { passive: true });
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd, { passive: true });
        document.addEventListener('touchcancel', onCancel, { passive: true });

        // klávesnice (desktop / připojená klávesnice): Esc zavře nejvyšší otevřený modál
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            var list = document.querySelectorAll('.modal-overlay');
            for (var i = list.length - 1; i >= 0; i--) {
                var ov = list[i];
                if (eligible(ov) && window.getComputedStyle(ov).display !== 'none') {
                    closeOverlay(ov);
                    return;
                }
            }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGModalClose = { close: closeOverlay, scan: scanAll };
})();
