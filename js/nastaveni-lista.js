// ===== AR Geodet — BOČNÍ VYJÍŽDĚCÍ REJSTŘÍK NASTAVENÍ (návrh L1, ODPOJITELNÁ) =====
// PROBLÉM (nahlášeno 8. 8. 2026): „nastavení nevypadá moc dobře… jednotlivé sekce
// jak jsou rolovací, tak se mi ztrácí." Nastavení má pět záložek a pod nimi dlouhé
// rolující sekce. Jakmile se začne rolovat, nadpis sekce uteče nahoru a zůstane jen
// řada přepínačů, u kterých člověk neví, kam patří.
//
// ŘEŠENÍ (uživatel vybral návrh L1): tažením od pravého okraje vyjede lišta se
// ZÁLOŽKAMI I SEKCEMI UVNITŘ NICH. Ťuknutí = skok rovnou na daný blok. U okraje
// zůstává úzký proužek s názvem právě otevřené sekce, takže i uprostřed rolování
// je vidět, kde člověk je.
//
// ROZBALOVÁNÍ (9. 8. 2026, na přání): ťuknutí na ZÁLOŽKU nikam neskáče — rozbalí
// pod ní její sekce a teprve z nich se vybírá. Dřív se sekce ukazovaly jen u té
// záložky, která už byla otevřená, takže do cizí se muselo skočit naslepo a
// případně se vracet. Rozbalená je vždycky nejvýš jedna; první položka „Otevřít
// záložku" nechává původní cestu (přepnout a nic víc). Záložka BEZ sekcí se
// nerozbaluje, ta skočí rovnou.
//
// HORNÍ PRUH ZÁLOŽEK SE SKRÝVÁ — na výslovné přání („odstranil bych tam ten vrchní
// řádek s výběrem, protože to bude v postranní liště"). V DOM ale ZŮSTÁVÁ:
//   • switchTab() v grafika.js přepíná třídu .active na .tab-btn,
//   • js/app-search.js skáče na záložky přes index .tab-btn,
//   • js/ucty.js vymáhá oprávnění schováním konkrétních .tab-btn,
//   • js/nastaveni-poradek.js si z něj bere seznam záložek.
// Kdyby se pruh smazal, tiše by přestalo fungovat všechno tohle. Proto jen
// display:none a veškeré klikání jde přes .tab-btn.click().
//
// CO TU ZÁMĚRNĚ NENÍ: tečka „tohle máš přenastavené proti výchozímu". V návrhu
// zmíněná byla, ale spolehlivě by to znamenalo znát výchozí hodnotu u víc než sta
// ovladačů roztroušených v deseti modulech — na to tu není jediný zdroj pravdy.
// Radši nic než tečka, která lže.
//
// Odstranění: smaž js/nastaveni-lista.js + řádek <script> v index.html (a přegeneruj
// sw.js). Nastavení pak vypadá přesně jako dřív, i s horním pruhem záložek.
// ================================================================================
(function () {
    'use strict';

    var STYLE_ID = 'ag-nl-style';
    var WRAP_ID = 'ag-nl';
    var EDGE = 26;          // šířka chytací zóny u okraje (px)
    var OPEN_AT = 40;       // o kolik se musí táhnout, aby lišta zůstala otevřená

    function modal() { return document.getElementById('settings-modal'); }
    function isOpen() { var m = modal(); return !!(m && m.style.display === 'flex'); }
    function scroller() { var m = modal(); return m ? m.querySelector('.modal-content') : null; }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // horní pruh záložek pryč z očí, ale ne z DOM (viz hlavička souboru)
            '#settings-modal .tab-buttons{display:none !important;}',
            // Proužek leží PŘES obsah, tak mu obsah musí uhnout — jinak se pod ním
            // schovávají přepínače a číselné hodnoty u pravého okraje.
            '#settings-modal .modal-content{padding-right:calc(' + EDGE + 'px + 14px);}',
            'body.left-hand #settings-modal .modal-content{padding-right:14px;padding-left:calc(' + EDGE + 'px + 14px);}',
            // proužek u okraje: pořád vidět, kde jsem
            '#' + WRAP_ID + '-edge{position:absolute;top:0;bottom:0;right:0;width:' + EDGE + 'px;z-index:6;',
            '  display:flex;align-items:center;justify-content:center;cursor:pointer;',
            '  background:linear-gradient(90deg,transparent,rgba(255,255,255,0.05));',
            '  border-left:1px solid var(--glass-border,rgba(255,255,255,0.12));touch-action:none;}',
            '#' + WRAP_ID + '-edge b{writing-mode:vertical-rl;font:700 10px/1 var(--font-mono,ui-monospace,monospace);',
            '  letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);',
            '  max-height:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#' + WRAP_ID + '-edge:active b{color:var(--accent,#2f9e74);}',
            // samotná lišta
            '#' + WRAP_ID + '{position:absolute;top:0;bottom:0;right:0;width:min(232px,74vw);z-index:7;',
            '  background:var(--bg-elev,#171b20);border-left:1px solid var(--glass-border-strong,rgba(255,255,255,0.2));',
            '  box-shadow:-14px 0 34px rgba(0,0,0,0.55);display:flex;flex-direction:column;',
            '  transform:translateX(100%);transition:transform .18s ease;touch-action:pan-y;}',
            '#' + WRAP_ID + '.on{transform:translateX(0);}',
            '#' + WRAP_ID + ' .nl-head{padding:14px 14px 8px;font:700 10px/1 var(--font-mono,ui-monospace,monospace);',
            '  letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);flex:0 0 auto;}',
            '#' + WRAP_ID + ' .nl-scroll{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:0 10px 12px;',
            '  -webkit-overflow-scrolling:touch;}',
            '#' + WRAP_ID + ' button{display:block;width:100%;text-align:left;border:0;background:transparent;',
            '  color:var(--text-color,#e6e8eb);cursor:pointer;border-radius:10px;}',
            '#' + WRAP_ID + ' .nl-tab{display:flex;align-items:center;gap:8px;padding:9px 10px;margin-top:3px;',
            '  font:650 13px/1.25 var(--font-ui,system-ui),sans-serif;}',
            '#' + WRAP_ID + ' .nl-tab .nl-t{flex:1;min-width:0;}',
            '#' + WRAP_ID + ' .nl-tab .nl-ch{flex:0 0 auto;font-size:11px;opacity:.55;',
            '  transition:transform .15s ease;}',
            '#' + WRAP_ID + ' .nl-tab.open .nl-ch{transform:rotate(180deg);opacity:.9;}',
            // Rozbalená záložka drží podnázvy pohromadě svislou linkou — ať je vidět,
            // ke které z nich patří (v seznamu jsou hned pod sebou i cizí záložky).
            '#' + WRAP_ID + ' .nl-sec{padding:7px 10px 7px 20px;margin-left:10px;',
            '  border-left:1px solid var(--glass-border,rgba(255,255,255,0.14));border-radius:0 10px 10px 0;',
            '  font:500 12px/1.3 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '#' + WRAP_ID + ' .nl-sec.nl-top{font-style:italic;opacity:.8;}',
            '#' + WRAP_ID + ' .nl-tab.on{background:var(--accent-soft,rgba(47,158,116,0.15));color:var(--accent,#2f9e74);}',
            '#' + WRAP_ID + ' .nl-tab.open{background:rgba(255,255,255,0.05);}',
            '#' + WRAP_ID + ' .nl-tab.on.open{background:var(--accent-soft,rgba(47,158,116,0.15));}',
            '#' + WRAP_ID + ' .nl-sec.on{color:var(--accent,#2f9e74);}',
            '#' + WRAP_ID + ' button:active{background:rgba(255,255,255,0.07);}',
            '#' + WRAP_ID + ' button:focus-visible{outline:2px solid var(--accent,#2f9e74);outline-offset:-2px;}',
            '#' + WRAP_ID + ' .nl-hint{padding:10px 12px 4px;font:400 10.5px/1.4 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-muted,#9aa1ac);flex:0 0 auto;border-top:1px solid var(--glass-border,rgba(255,255,255,0.1));}',
            // závoj přes obsah, aby bylo poznat, že lišta je vepředu
            '#' + WRAP_ID + '-veil{position:absolute;inset:0;z-index:5;background:rgba(6,9,12,0.5);display:none;}',
            '#' + WRAP_ID + '-veil.on{display:block;}',
            // v REŽIMU LEVÉ RUKY se lišta i proužek zrcadlí, jako ostatní ovládání appky
            'body.left-hand #' + WRAP_ID + '{right:auto;left:0;border-left:0;',
            '  border-right:1px solid var(--glass-border-strong,rgba(255,255,255,0.2));',
            '  box-shadow:14px 0 34px rgba(0,0,0,0.55);transform:translateX(-100%);}',
            'body.left-hand #' + WRAP_ID + '.on{transform:translateX(0);}',
            'body.left-hand #' + WRAP_ID + '-edge{right:auto;left:0;border-left:0;',
            '  border-right:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  background:linear-gradient(270deg,transparent,rgba(255,255,255,0.05));}',
            '@media (prefers-reduced-motion:reduce){#' + WRAP_ID + '{transition:none;}}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- stavba rejstříku -------------------------------------------------------
    // Záložky se berou ze živých .tab-btn (ne z natvrdo psaného seznamu) — když
    // některou schová oprávnění nebo přibude nová, rejstřík se srovná sám.
    function tabs() {
        var m = modal(); if (!m) return [];
        var out = [];
        m.querySelectorAll('.tab-buttons .tab-btn').forEach(function (b) {
            if (b.style.display === 'none') return;              // schované oprávněním
            var oc = b.getAttribute('onclick') || '';
            var mm = /switchTab\(\s*'([^']+)'/.exec(oc);
            if (!mm) return;
            var nm = b.querySelector('.tb-tx b');
            out.push({ id: mm[1], name: nm ? nm.textContent.trim() : mm[1], btn: b });
        });
        return out;
    }
    // Sekce = nadpisy .set-h uvnitř panelu. Část z nich vyrábí až
    // js/nastaveni-poradek.js, proto se čtou VŽDY ZNOVU při otevření lišty.
    //
    // ⚠ VIDITELNOST SE MĚŘÍ COMPUTED `display`, NE getClientRects(). Od zavedení
    // rozbalování (9. 8. 2026) se sekce čtou i u ZAVŘENÝCH záložek — ty mají
    // display:none, takže by getClientRects() vrátilo prázdno úplně u všech a
    // rozbalila by se prázdná záložka. getComputedStyle naproti tomu hlásí VLASTNÍ
    // display prvku i uvnitř skrytého předka, takže pořád spolehlivě pozná řádky
    // schované „krátkým pohledem" (body.ag-ns-short z js/nastaveni-hledani.js),
    // na které by skok nikam nevedl.
    function sections(tabId) {
        var t = document.getElementById(tabId);
        if (!t) return [];
        var out = [];
        t.querySelectorAll('.set-h').forEach(function (h) {
            var tx = (h.textContent || '').replace(/\s+/g, ' ').trim();
            if (!tx) return;
            var vis = true;
            try { vis = getComputedStyle(h).display !== 'none'; } catch (e) {}
            if (vis) out.push({ el: h, name: tx });
        });
        return out;
    }

    function activeTabId() {
        var t = document.querySelector('#settings-modal .settings-tab.active');
        return t ? t.id : null;
    }

    // Která záložka má v rejstříku rozbalené podnázvy. Přání z 9. 8. 2026:
    // „když kliknu na nějaký z těch hlavních nadpisů, tak aby se mi otevřely ty
    // podnázvy a z nich jsem si pak vybíral." Dřív ťuknutí na záložku rovnou
    // přeplo a lištu zavřelo, takže se sekce cizí záložky nedaly ani prohlédnout —
    // člověk musel skočit naslepo a případně se vracet.
    var _openId = null;

    function build() {
        var wrap = document.getElementById(WRAP_ID);
        if (!wrap) return;
        var scroll = wrap.querySelector('.nl-scroll');
        scroll.innerHTML = '';
        var act = activeTabId();
        var list = tabs();
        // Zavřená lišta si nic nepamatuje: po otevření je rozbalená ta záložka,
        // ve které člověk právě je.
        if (_openId === null) _openId = act;
        var known = false;
        for (var i = 0; i < list.length; i++) if (list[i].id === _openId) known = true;
        if (!known) _openId = act;

        list.forEach(function (t) {
            var secs = sections(t.id);
            var open = (t.id === _openId) && secs.length > 0;
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'nl-tab' + (t.id === act ? ' on' : '') + (open ? ' open' : '');
            b.innerHTML = '<span class="nl-t"></span>'
                + (secs.length ? '<span class="nl-ch" aria-hidden="true">▾</span>' : '');
            b.querySelector('.nl-t').textContent = t.name;
            if (secs.length) {
                b.setAttribute('aria-expanded', open ? 'true' : 'false');
                // Záložka BEZ sekcí se rozbalovat nemá co — ta skočí rovnou.
                b.addEventListener('click', function () {
                    _openId = open ? null : t.id;
                    build();
                });
            } else {
                b.addEventListener('click', function () { goTab(t, null); });
            }
            scroll.appendChild(b);
            if (!open) return;

            // První položka vede na začátek záložky — jinak by u záložky se sekcemi
            // nebyla žádná cesta „prostě mě tam přepni".
            var top = document.createElement('button');
            top.type = 'button';
            top.className = 'nl-sec nl-top';
            top.textContent = 'Otevřít záložku';
            top.addEventListener('click', function () { goTab(t, null); });
            scroll.appendChild(top);

            secs.forEach(function (s) {
                var sb = document.createElement('button');
                sb.type = 'button';
                sb.className = 'nl-sec';
                sb.textContent = s.name;
                sb.addEventListener('click', function () { goTab(t, s.el); });
                scroll.appendChild(sb);
            });
        });
    }

    function goTab(t, secEl) {
        // Na cizí záložku se přepíná jejím vlastním tlačítkem (switchTab + srovnání
        // pruhu). Když už je otevřená, tlačítko se ZÁMĚRNĚ nemačká: jeho onclick
        // obsahuje `scrollTop = 0`, což by skok na sekci ve stejné záložce zrušil.
        if (t.id !== activeTabId()) { try { t.btn.click(); } catch (e) {} }
        close();
        if (secEl) {
            // rolovat AŽ po přepnutí panelu, jinak se měří výška skrytého bloku
            setTimeout(function () {
                // ⚠ scrollIntoView, NE ruční scrollTop. Měřením v prohlížeči se ukázalo,
                // že `#settings-modal .modal-content` sice hlásí scrollHeight 1711 při
                // clientHeight 915, ale zápis do jeho scrollTop NIC NEUDĚLÁ (zůstane 0) —
                // rolovací vrstva je jinde. scrollIntoView si správný kontejner najde sám,
                // ať už se rozvržení modálu kdykoli změní.
                try { secEl.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (e) {
                    try { secEl.scrollIntoView(true); } catch (e2) {}
                }
                markEdge();
            }, 70);
        } else {
            setTimeout(markEdge, 70);
        }
    }

    // Proužek u okraje ukazuje sekci, ve které právě jsem (nebo název záložky).
    function markEdge() {
        var e = document.getElementById(WRAP_ID + '-edge');
        if (!e) return;
        var lbl = '';
        var act = activeTabId();
        var sc = scroller();
        if (act) {
            // Která sekce je právě „nahoře": poslední, jejíž nadpis už vyjel nad
            // horní třetinu modálu. Měří se pozice na obrazovce, protože rolovací
            // vrstva modálu není jednoznačná (viz poznámka u skoku).
            var m2 = modal();
            var top = (m2 ? m2.getBoundingClientRect().top : 0) + 120;
            var secs = sections(act);
            for (var i = 0; i < secs.length; i++) {
                if (secs[i].el.getBoundingClientRect().top <= top) lbl = secs[i].name; else break;
            }
        }
        if (!lbl) {
            var tt = tabs();
            for (var j = 0; j < tt.length; j++) if (tt[j].id === act) lbl = tt[j].name;
        }
        var b = e.querySelector('b');
        if (b && b.textContent !== lbl) b.textContent = lbl;
    }

    function ensure() {
        var m = modal(); if (!m) return null;
        var host = m.querySelector('.modal-content'); if (!host) return null;
        // Kotva pro absolutně umístěnou lištu: .modal-content roluje, takže by lišta
        // odjížděla s obsahem. Kotvíme proto na .modal-overlay, který stojí.
        if (!document.getElementById(WRAP_ID)) {
            injectStyles();
            var veil = document.createElement('div');
            veil.id = WRAP_ID + '-veil';
            veil.addEventListener('click', close);

            var edge = document.createElement('div');
            edge.id = WRAP_ID + '-edge';
            edge.setAttribute('role', 'button');
            edge.setAttribute('aria-label', 'Rejstřík nastavení');
            edge.innerHTML = '<b></b>';
            edge.addEventListener('click', function () { open(); });

            var wrap = document.createElement('div');
            wrap.id = WRAP_ID;
            wrap.innerHTML = '<div class="nl-head">Nastavení</div>'
                + '<div class="nl-scroll"></div>'
                + '<div class="nl-hint">Ťukni na záložku — rozbalí se její sekce. Ťuknutí na sekci na ni skočí.</div>';
            m.appendChild(veil);
            m.appendChild(edge);
            m.appendChild(wrap);

            if (host.addEventListener) host.addEventListener('scroll', markEdge, { passive: true });
        }
        return document.getElementById(WRAP_ID);
    }

    function open() {
        var w = ensure(); if (!w) return;
        _openId = null;              // po otevření je rozbalená ta záložka, kde právě jsem
        build();
        w.classList.add('on');
        document.getElementById(WRAP_ID + '-veil').classList.add('on');
    }
    function close() {
        var w = document.getElementById(WRAP_ID); if (!w) return;
        w.classList.remove('on');
        var v = document.getElementById(WRAP_ID + '-veil');
        if (v) v.classList.remove('on');
    }

    // ---- tažení od okraje -------------------------------------------------------
    // Chytá se JEN u okraje (proužek má touch-action:none), aby si to nevjelo do
    // vlasů s rolováním obsahu. U leváka se okraj překlopí doleva.
    function bindDrag() {
        var e = document.getElementById(WRAP_ID + '-edge'); if (!e || e._agBound) return;
        e._agBound = true;
        var x0 = null;
        function left() { return document.body.classList.contains('left-hand'); }
        e.addEventListener('touchstart', function (ev) {
            x0 = ev.touches[0].clientX;
        }, { passive: true });
        e.addEventListener('touchmove', function (ev) {
            if (x0 == null) return;
            var dx = ev.touches[0].clientX - x0;
            if (left() ? (dx > OPEN_AT) : (dx < -OPEN_AT)) { x0 = null; open(); }
        }, { passive: true });
        e.addEventListener('touchend', function () { x0 = null; }, { passive: true });
    }

    // ---- napojení na otevření Nastavení ----------------------------------------
    function tick() {
        if (!isOpen()) { close(); return; }
        if (ensure()) { bindDrag(); markEdge(); }
    }
    function init() {
        // Sdílený UI časovač appky (js/power-save.js) — vlastní observer by kvůli
        // baterii nedával smysl, Nastavení se otevírá zřídka.
        if (!window.__agNlTimer) {
            window.__agNlTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(tick, 900);
        }
        tick();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGNastaveniLista = { open: open, close: close, refresh: build };
})();
