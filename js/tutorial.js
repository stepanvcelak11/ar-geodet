// AR Geodet — Uvitaci tutorial / interaktivni prohlidka.
// Spotlight na realna tlacitka + bublina s popisem. Krokovani Dalsi/Zpet/Preskocit.
// Auto-start pri prvnim spusteni (localStorage flag), znovu spustitelny z Nastaveni a Menu.
(function () {
    'use strict';

    var SEEN_KEY = 'arTutorialSeen_v1';

    // Kroky prohlidky. `sel` = cil pro spotlight; bez `sel` (center:true) = bublina uprostred.
    // Kroky, jejichz cil neni viditelny (skryty panel, jine rozvrzeni), se za behu preskoci.
    var STEPS = [
        {
            center: true, icon: '\uD83D\uDC4B',
            title: 'Vítej v AR&nbsp;Geodet',
            body: 'Krátká prohlídka ti ukáže, kde co najdeš. Zabere necelou minutu a kdykoli ji přeskočíš. Znovu ji spustíš ve <b>Více → Návod</b>.'
        },
        {
            sel: '#view-seg',
            title: 'Přepínání zobrazení',
            body: 'Přepínej mezi <b>AR kamerou</b>, <b>děleným</b> pohledem a <b>mapou</b>. AR ukazuje body skrz kameru, mapa je 2D s katastrem a ortofotem.'
        },
        {
            sel: '#dock .dock-btn:nth-child(1)',
            title: 'Nástroje',
            body: 'Všechny nástroje na jednom místě: <b>měření vzdálenosti a plochy</b>, <b>kalkulačka</b>, <b>GNSS satelity</b>, <b>vytyčovací checklist</b>, <b>náčrt / tachymetrie</b>, <b>slovník</b> i rychlé otevření <b>katastru</b>.'
        },
        {
            sel: '#dock .dock-primary',
            title: 'Nový bod',
            body: 'Přidá vlastní bod — z <b>průměrované GPS</b>, klepnutím do mapy, ručním zadáním S‑JTSK, nebo <b>přečtením z fotky (OCR)</b>. K bodu připojíš fotku a poznámku.'
        },
        {
            sel: '#dock .dock-btn:nth-child(2)',
            title: 'Body',
            body: 'Seznam tvých bodů — úprava, skrytí, mazání (jde <b>vrátit zpět</b>), <b>export/import</b> (CSV, TXT, GPX, GeoJSON, JSON) a <b>sdílení přes QR</b>.'
        },
        {
            sel: '#dock-vice-btn',
            title: 'Více',
            body: 'Vše ostatní: <b>Průvodce úkolem</b>, <b>Zpravodaj</b>, uložení pro <b>offline</b>, tento <b>návod</b> a <b>o aplikaci</b> — plus rychlé přepínače info panelu, kompasu a průměrování GPS.'
        },
        {
            sel: '#dock .dock-btn:nth-child(5)',
            title: 'Nastavení',
            body: 'Tři přehledné záložky — <b>Vzhled</b>, <b>AR&nbsp;&amp; přesnost</b> a <b>Data</b>. Jemné doladění je schované pod „Pokročilé", ať se v tom neztratíš.'
        },
        {
            sel: '#info',
            title: 'Přesnost GPS',
            body: 'Ukazuje aktuální přesnost GPS a počet bodů v dohledu. Appka je <b>orientační pomůcka</b>, ne měřicí přístroj — poloha závisí na GPS a kompasu telefonu.'
        },
        {
            sel: '#compass-debug',
            title: 'Azimut a kompas',
            body: 'Aktuální azimut. Klepnutím nastavíš nulu kompasu, zobrazíš kalibraci nebo zkontroluješ směr podle Slunce.'
        },
        {
            sel: '#map-ctrl-toggle',
            title: 'Nástroje mapy',
            body: 'Rozbalí ovládání mapy — podklad (OSM/ortofoto), katastr, přiblížení, vycentrování na mě, body v okolí a spojování bodů čarou.'
        },
        {
            center: true, icon: '\uD83C\uDFAF',
            title: 'A to je vše!',
            body: 'Základ máš za sebou. <b>Tip:</b> panely přesnosti a kompasu lze podržením posouvat a dvěma prsty zvětšit. Chceš projít funkce podrobněji? Pokračuj na podrobný návod, nebo prohlídku ukonči.'
        }
    ];

    // Podrobny navod — otevre realne obrazovky a u kazde vysvetli, co umi.
    // Karta je dole, obrazovka zustava videt nad ni. `before` otevre prislusny modal.
    var DETAIL_STEPS = [
        {
            center: true, icon: '\uD83D\uDCD6',
            before: function () { closeTourModals(); },
            title: 'Podrobný návod',
            body: 'Teď si projdeme hlavní obrazovky důkladněji — postupně je otevřu a u každé popíšu, k čemu slouží.'
        },
        {
            bottom: true,
            before: function () { closeTourModals(); if (typeof openNewPointModal === 'function') openNewPointModal(); },
            title: 'Založení vlastního bodu',
            body: '<b>Z průměru GPS</b> — nejpřesnější, chvíli stůj na místě. <b>Z mapy</b> — klepneš do mapy. <b>Z fotky (OCR)</b> — přečte souřadnice z fotky. Nebo ručně zadáš <b>S‑JTSK Y/X</b>. Po uložení připojíš <b>fotku a poznámku</b>.'
        },
        {
            bottom: true,
            before: function () { closeTourModals(); var m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; },
            title: 'Nástroje',
            body: 'Mřížka všech nástrojů: <b>měření vzdálenosti</b> a <b>plochy</b>, <b>kalkulačka</b>, <b>GNSS satelity</b>, <b>vytyčovací checklist</b>, <b>náčrt / tachymetrie</b>, <b>slovník</b> a rychlý <b>katastr</b>.'
        },
        {
            center: true, icon: '\uD83D\uDCD0',
            before: function () { closeTourModals(); },
            title: 'Náčrt / Tachymetrie',
            body: 'V <b>Nástrojích</b> je digitální <b>tachymetrický náčrt</b>. Body přidáš z GPS nebo ze svých bodů, <b>spojíš je čarami</b> a vložíš <b>popisky</b>. Nově lze <b>kreslit prstem nebo stylusem</b> (barva, tloušťka, typ čáry). Délky a plochu dopočítá sám a vše <b>vyexportuješ do PNG</b>.'
        },
        {
            bottom: true,
            before: function () { closeTourModals(); if (typeof openManageModal === 'function') openManageModal(); },
            title: 'Body — správa a sdílení',
            body: 'Seznam tvých bodů — úprava, skrytí z AR i mazání (jde <b>vrátit zpět</b>). Nahoře v <b>Export / Import</b> data přeneseš ven i dovnitř (<b>CSV, TXT, GPX, GeoJSON, JSON</b>) a body <b>nasdílíš kolegovi přes QR</b> nebo z QR <b>načteš</b>.'
        },
        {
            center: true, icon: '\uD83E\uDDED',
            before: function () { closeTourModals(); var m = document.getElementById('side-menu'); if (m) m.classList.add('open'); },
            title: 'Více',
            body: 'Pod „Více" je <b>Průvodce úkolem</b> (provede tě krok za krokem), <b>Zpravodaj</b> (denní geodetické zprávy), uložení pro <b>offline</b>, tento <b>návod</b> a <b>o aplikaci</b>.'
        },
        {
            bottom: true,
            before: function () { closeTourModals(); if (typeof openSettings === 'function') openSettings(); },
            title: 'Nastavení',
            body: 'Tři záložky: <b>Vzhled</b> (světlý/tmavý, odstín, velikost UI), <b>AR&nbsp;&amp; přesnost</b> (viditelnost, kalibrace, jemné doladění) a <b>Data</b> (zakázky, filtry, offline, záloha). Detaily jsou schované pod <b>„Pokročilé"</b>.'
        },
        {
            center: true, icon: '\u2705',
            before: function () { closeTourModals(); },
            title: 'Hotovo!',
            body: 'Teď znáš celou aplikaci. Návod i podrobnou prohlídku kdykoli znovu spustíš ve <b>Více → Návod</b>. Hodně zdaru v terénu!'
        }
    ];

    function closeTourModals() {
        ['tools-modal', 'measure-modal', 'custom-modal-overlay', 'manage-modal', 'settings-modal', 'dict-modal'].forEach(function (id) {
            var m = document.getElementById(id); if (m) m.style.display = 'none';
        });
        var menu = document.getElementById('side-menu'); if (menu) menu.classList.remove('open');
    }

    var els = null;          // nactene DOM prvky overlaye
    var order = [];          // indexy kroku, ktere se realne ukazi
    var pos = 0;             // pozice v `order`
    var active = false;
    var mode = 'basic';      // 'basic' | 'detail'
    var currentSteps = STEPS;

    function isVisible(el) {
        if (!el) return false;
        var r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;          // skryte (display:none) maji 0x0
        if (r.bottom < 0 || r.top > window.innerHeight) return false; // mimo obrazovku
        var cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
        return true;
    }

    function buildOverlay() {
        if (els) return els;
        var root = document.createElement('div');
        root.id = 'tut-root';
        root.innerHTML =
            '<div class="tut-blocker"></div>' +
            '<div class="tut-hole" hidden></div>' +
            '<div class="tut-card" role="dialog" aria-modal="true" aria-labelledby="tut-title">' +
                '<button class="tut-skip" type="button" aria-label="Přeskočit návod">Přeskočit&nbsp;✕</button>' +
                '<div class="tut-icon" hidden></div>' +
                '<h3 class="tut-title" id="tut-title"></h3>' +
                '<p class="tut-body"></p>' +
                '<div class="tut-dots"></div>' +
                '<button class="tut-btn tut-more" type="button" hidden>Pokračovat na podrobný návod →</button>' +
                '<div class="tut-nav">' +
                    '<button class="tut-btn tut-back" type="button">Zpět</button>' +
                    '<button class="tut-btn tut-next" type="button">Další</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(root);
        els = {
            root: root,
            blocker: root.querySelector('.tut-blocker'),
            hole: root.querySelector('.tut-hole'),
            card: root.querySelector('.tut-card'),
            icon: root.querySelector('.tut-icon'),
            title: root.querySelector('.tut-title'),
            body: root.querySelector('.tut-body'),
            dots: root.querySelector('.tut-dots'),
            back: root.querySelector('.tut-back'),
            next: root.querySelector('.tut-next'),
            more: root.querySelector('.tut-more'),
            skip: root.querySelector('.tut-skip')
        };
        els.next.addEventListener('click', function () { go(1); });
        els.back.addEventListener('click', function () { go(-1); });
        els.more.addEventListener('click', startDetail);
        els.skip.addEventListener('click', finish);
        els.blocker.addEventListener('click', function (e) { e.stopPropagation(); });
        return els;
    }

    function go(dir) {
        pos += dir;
        if (pos < 0) pos = 0;
        if (pos >= order.length) { finish(); return; }
        render();
    }

    function render() {
        var step = currentSteps[order[pos]];
        if (typeof step.before === 'function') { try { step.before(); } catch (e) {} }

        els.title.innerHTML = step.title;
        els.body.innerHTML = step.body;
        if (step.icon) { els.icon.textContent = step.icon; els.icon.hidden = false; }
        else els.icon.hidden = true;

        var isLast = pos === order.length - 1;
        els.back.style.visibility = pos === 0 ? 'hidden' : 'visible';
        els.next.textContent = isLast ? 'Hotovo' : 'Další';
        // nabidka pokracovat na podrobny navod jen na konci zakladni prohlidky
        els.more.hidden = !(isLast && mode === 'basic' && DETAIL_STEPS.length);

        // tecky prubehu
        var dots = '';
        for (var i = 0; i < order.length; i++) dots += '<span class="tut-dot' + (i === pos ? ' on' : '') + '"></span>';
        els.dots.innerHTML = dots;

        var target = step.sel ? document.querySelector(step.sel) : null;
        if (target && isVisible(target)) placeAtTarget(target);
        else if (step.bottom) placeBottom();
        else placeCentered();
    }

    function placeCentered() {
        els.hole.hidden = true;
        var c = els.card;
        c.classList.add('tut-centered');
        c.style.left = '50%';
        c.style.top = '50%';
        c.style.transform = 'translate(-50%, -50%)';
    }

    // Karta u spodního okraje — obrazovka (modal) nad ní zůstává vidět.
    function placeBottom() {
        els.hole.hidden = true;
        var c = els.card;
        c.classList.remove('tut-centered');
        c.style.transform = 'translateX(-50%)';
        c.style.left = '50%';
        c.style.top = Math.max(10, window.innerHeight - c.offsetHeight - 16) + 'px';
    }

    function placeAtTarget(target) {
        var pad = 8;
        var r = target.getBoundingClientRect();
        var hole = els.hole;
        hole.hidden = false;
        hole.style.left = (r.left - pad) + 'px';
        hole.style.top = (r.top - pad) + 'px';
        hole.style.width = (r.width + pad * 2) + 'px';
        hole.style.height = (r.height + pad * 2) + 'px';

        var c = els.card;
        c.classList.remove('tut-centered');
        c.style.transform = 'none';

        // zmer kartu, abychom ji umistili nad/pod cil podle volneho mista
        var cw = c.offsetWidth, ch = c.offsetHeight;
        var vw = window.innerWidth, vh = window.innerHeight;
        var gap = 14;
        var spaceBelow = vh - (r.bottom + pad);
        var spaceAbove = (r.top - pad);

        var top;
        if (spaceBelow >= ch + gap || spaceBelow >= spaceAbove) {
            top = Math.min(r.bottom + pad + gap, vh - ch - 10);
        } else {
            top = Math.max(r.top - pad - gap - ch, 10);
        }
        top = Math.max(10, Math.min(top, vh - ch - 10));

        var left = r.left + r.width / 2 - cw / 2;
        left = Math.max(10, Math.min(left, vw - cw - 10));

        c.style.left = left + 'px';
        c.style.top = top + 'px';
    }

    function reposition() {
        if (active) render();
    }

    function runSequence(steps, m) {
        buildOverlay();
        currentSteps = steps;
        mode = m;
        // urci kroky, ktere se ukazi: center/bottom vzdy, spotlight jen kdyz je cil videt
        order = [];
        for (var i = 0; i < steps.length; i++) {
            var s = steps[i];
            if (s.center || s.bottom) { order.push(i); continue; }
            var t = document.querySelector(s.sel);
            if (t && isVisible(t)) order.push(i);
        }
        if (!order.length) return;
        pos = 0;
        active = true;
        els.root.classList.add('on');
        document.body.classList.add('tut-active');
        window.addEventListener('resize', reposition);
        window.addEventListener('orientationchange', reposition);
        render();
    }

    function start() { runSequence(STEPS, 'basic'); }

    function startDetail() { runSequence(DETAIL_STEPS, 'detail'); }

    function finish() {
        active = false;
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
        window.removeEventListener('resize', reposition);
        window.removeEventListener('orientationchange', reposition);
        closeTourModals();
        if (els) els.root.classList.remove('on');
        document.body.classList.remove('tut-active');
        // Po dokonceni/preskoceni tutorialu spustime jednorazovou kalibraci kompasu (na 1. startu odlozenou).
        try { if (typeof window.showCompassCalibHint === 'function') setTimeout(function () { window.showCompassCalibHint(); }, 400); } catch (e) {}
    }

    // Verejne API
    window.startTutorial = function () {
        // pokud je otevrene Nastaveni nebo menu, zavri je, at spotlight neni prekryty
        var sm = document.getElementById('settings-modal'); if (sm) sm.style.display = 'none';
        var menu = document.getElementById('side-menu'); if (menu) menu.classList.remove('open');
        setTimeout(start, 60);
    };

    window.maybeStartTutorial = function () {
        var seen = false;
        try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) {}
        if (seen) return;
        setTimeout(start, 700); // necht se rozvrzeni po startu usadi
    };

    // Auto-start po prvnim spusteni z uvitaci obrazovky — obalime startAppFromWelcome,
    // abychom nemuseli sahat do te dlouhe funkce v grafika.js.
    window.addEventListener('load', function () {
        var orig = window.startAppFromWelcome;
        if (typeof orig === 'function') {
            window.startAppFromWelcome = function () {
                var res = orig.apply(this, arguments);
                try { window.maybeStartTutorial(); } catch (e) {}
                return res;
            };
        }
    });
})();
