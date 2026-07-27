// ===== AR Geodet — ZAVÍRÁNÍ MODÁLŮ: křížek + potáhnutí dolů (ODPOJITELNÁ vrstva) =====
// Modály jedou přes celou obrazovku (na přání) a zavírají se tlačítkem „Zavřít"
// AŽ NA KONCI obsahu — u dlouhých oken (O aplikaci, Předpisy, Slovník) se k němu
// musíš prorolovat. Tahle vrstva přidává dvě běžné cesty ven:
//
//   • KŘÍŽEK vpravo nahoře — vždy na očích, nikam se neroluje.
//   • POTÁHNUTÍ DOLŮ — gesto, které lidi znají z mobilních „sheetů".
//
// Původní tlačítka „Zavřít" zůstávají a nic se jim nemění.
//
// Jak se zavírá: NEVYPÍNÁ modál natvrdo. Nejdřív hledá jeho VLASTNÍ zavírací
// tlačítko a klikne na něj, aby proběhl úklid, který k němu patří (closeManageModal
// volá fixAppLayout, closeCustomModal maže rozdělaný bod…). Teprve když žádné
// nenajde, schová overlay sám.
//
// Na co si dát pozor (a proč to tak je):
//   - Gesto se „natáhne" jen tehdy, když je obsah nascrollovaný úplně nahoře.
//     Jinak by potáhnutí dolů uprostřed textu zavíralo okno místo rolování.
//   - Vodorovný pohyb gesto zruší (posuvníky, mapa, přejetí v seznamu).
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
//   data-no-close  — žádný křížek ani gesto (okno se zavírá jen po svém). Má ho
//                    #settings-modal: Nastavení se ukládá TEPRVE v saveSettings(),
//                    takže zavření mimo jeho vlastní tlačítko by tiše zahodilo
//                    všechno, co uživatel zrovna přenastavil.
//   data-no-swipe  — křížek ano, gesto ne. Má ho formulář nového bodu: ťuknout na
//                    ✕ je rozhodnutí, ale nechtěné cuknutí prstem by zahodilo
//                    rozepsaný bod.
// Odstranění celé vrstvy: smaž js/modal-close.js + řádek v index.html a v sw.js.
// ==============================================================================
(function () {
    'use strict';
    if (window.AGModalClose) return;

    var STYLE_ID = 'ag-modalclose-style';
    var CLOSE_PX = 110;        // o kolik se musí stáhnout, aby se zavřelo
    var FLICK_PX = 55;         // rychlé cuknutí stačí kratší
    var FLICK_SPEED = 0.45;    // px/ms
    var ARM_PX = 10;           // od kdy je to tažení, ne ťuknutí
    var MAX_PULL = 260;        // dál už se panel nehne (gumový doraz)

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
            // úchyt nahoře uprostřed — tichá nápověda, že se dá táhnout
            '.agmc-grab{position:absolute;z-index:29;top:calc(env(safe-area-inset-top,0px) + 7px);left:50%;',
            '  transform:translateX(-50%);width:38px;height:4px;border-radius:99px;pointer-events:none;',
            '  background:var(--surface-3,rgba(255,255,255,0.16));}',
            // tažení: panel jde dolů, pozadí se prosvětluje
            '.agmc-drag{transition:none !important;}',
            '.agmc-back{transition:transform .22s cubic-bezier(.22,.61,.36,1);}',
            '@media (prefers-reduced-motion:reduce){.agmc-back{transition:none;}}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    var X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

    function eligible(ov) {
        return ov && ov.classList && ov.classList.contains('modal-overlay') &&
            ov.getAttribute('data-no-close') === null && !!ov.querySelector('.modal-content');
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
            if (t === 'zavřít' || t === 'zavrit') score = 100;
            else if (ONLY_HIDE.test(oc) || ONLY_CLOSE_CALL.test(oc)) score = 80;
            // >= : při stejném skóre vyhrává POZDĚJŠÍ tlačítko — zavírací bývá dole
            if (score && score >= bestScore) { best = b; bestScore = score; }
        }
        return best;
    }

    function closeOverlay(ov) {
        var mc = ov.querySelector('.modal-content');
        resetPull(mc);
        var btn = mc ? ownCloseButton(mc) : null;
        if (btn) { try { btn.click(); return; } catch (e) {} }
        ov.style.display = 'none';
        // úklid, který dělají zavírací funkce v logika.js/grafika.js
        try { if (typeof window.fixAppLayout === 'function') window.fixAppLayout(); } catch (e) {}
    }

    // ---- křížek + úchyt --------------------------------------------------------
    function decorate(ov) {
        if (!eligible(ov) || ov.querySelector(':scope > .agmc-x')) return;
        injectStyles();
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
        var g = document.createElement('div');
        g.className = 'agmc-grab';
        ov.appendChild(g);
    }

    function scanAll(root) {
        var list = (root || document).querySelectorAll('.modal-overlay');
        for (var i = 0; i < list.length; i++) decorate(list[i]);
    }

    // ---- tažení dolů -----------------------------------------------------------
    var drag = null;

    // nejbližší předek, který se dá rolovat (od cíle po .modal-content)
    function scrolledAncestor(el, stop) {
        while (el && el !== stop && el.nodeType === 1) {
            var st = window.getComputedStyle(el), oy = st.overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) return el;
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
        var ov = t.closest('.modal-overlay');
        if (!eligible(ov) || ov.style.display === 'none') return;
        var mc = ov.querySelector('.modal-content');
        if (!mc || !mc.contains(t)) return;
        // prvky, u kterých svislý tah znamená něco jiného
        if (t.closest('input[type="range"],select,textarea,canvas,video,[contenteditable],' +
                      '.leaflet-container,[data-no-swipe]')) return;
        // rolovat > zavírat: dokud není obsah úplně nahoře, gesto nepatří nám
        var sc = scrolledAncestor(t, mc);
        if (sc && sc.scrollTop > 0) return;
        drag = {
            ov: ov, mc: mc, sc: sc,
            x0: e.touches[0].clientX, y0: e.touches[0].clientY,
            t0: (e.timeStamp || 0), dy: 0, armed: false, dead: false
        };
    }

    function onMove(e) {
        if (!drag || drag.dead || !e.touches || e.touches.length !== 1) return;
        var dx = e.touches[0].clientX - drag.x0;
        var dy = e.touches[0].clientY - drag.y0;
        if (!drag.armed) {
            if (Math.abs(dx) > Math.abs(dy)) { drag.dead = true; return; }   // vodorovné gesto není naše
            if (dy < -2) { drag.dead = true; return; }                       // rolování nahoru
            // mezitím se mohlo začít rolovat (setrvačnost) → nechat být
            if (drag.sc && drag.sc.scrollTop > 0) { drag.dead = true; return; }
            if (dy < ARM_PX) return;
            drag.armed = true;
            drag.mc.classList.add('agmc-drag');
            drag.mc.style.animation = 'none';   // animace otevření by inline transform přebila
        }
        e.preventDefault();                     // od téhle chvíle táhneme my
        drag.dy = dy;
        // gumový doraz: čím dál, tím menší přírůstek
        var shown = dy > MAX_PULL ? MAX_PULL + (dy - MAX_PULL) * 0.15 : dy;
        drag.mc.style.transform = 'translateY(' + shown + 'px)';
        drag.mc.style.opacity = String(Math.max(0.55, 1 - dy / 900));
    }

    function onEnd(e) {
        var d = drag; drag = null;
        if (!d || !d.armed) return;
        d.mc.classList.remove('agmc-drag');
        var dt = Math.max(1, (e.timeStamp || 0) - d.t0);
        var fast = (d.dy / dt) > FLICK_SPEED;
        if (d.dy > CLOSE_PX || (d.dy > FLICK_PX && fast)) {
            closeOverlay(d.ov);
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
        if (Math.abs(d.dy) > ARM_PX) swallowNextClick();
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
        } catch (e) {}

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
