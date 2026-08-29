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
            '.agmc-x{position:absolute;z-index:30;top:calc(env(safe-area-inset-top,0px) + 10px);',
            '  right:calc(env(safe-area-inset-right,0px) + 10px);width:40px;height:40px;border-radius:50%;',
            '  display:flex;align-items:center;justify-content:center;cursor:pointer;',
            '  background:var(--surface-2,rgba(255,255,255,0.09));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  color:var(--text-color,#eceef2);padding:0;line-height:0;',
            '  transition:transform .12s ease,background .15s ease;}',
            '.agmc-x:active{transform:scale(.92);background:var(--surface-3,rgba(255,255,255,0.13));}',
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
            '@media (prefers-reduced-motion:reduce){.agmc-back{transition:none;}}'
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

    // ---- křížek + úchyt --------------------------------------------------------
    function decorate(ov) {
        if (!swipeable(ov)) return;
        injectStyles();
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
