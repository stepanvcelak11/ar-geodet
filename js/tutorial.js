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
            center: true, icon: '👋',
            title: 'Vítej v AR&nbsp;Geodet',
            body: 'Krátká prohlídka ti ukáže, kde co najdeš a co která tlačítka dělají. Zabere necelou minutu a kdykoli ji můžeš přeskočit. Vrátit se k ní jde v <b>Nastavení</b>.'
        },
        {
            sel: '#view-seg',
            title: 'Přepínání zobrazení',
            body: 'Přepínej mezi <b>AR kamerou</b>, <b>děleným</b> pohledem a <b>mapou</b>. AR ukazuje body skrz kameru telefonu, mapa je klasická 2D mapa s katastrem a ortofotem.'
        },
        {
            sel: '#dock .dock-btn:nth-child(1)',
            title: 'Katastr',
            body: 'Otevře katastrální mapu přesně tam, kde právě stojíš. Zdroj (Mapy.cz / iKatastr / ČÚZK) si zvolíš v Nastavení.'
        },
        {
            sel: '#dock .dock-btn:nth-child(2)',
            title: 'Měření a nástroje',
            body: 'Měření vzdálenosti a plochy, geodetická kalkulačka, GNSS satelity v AR, vytyčovací checklist a geodetický slovník — vše pohromadě.'
        },
        {
            sel: '#dock .dock-primary',
            title: 'Nový bod',
            body: 'Přidá vlastní bod — z <b>průměrované GPS</b>, klepnutím do mapy, ručním zadáním S‑JTSK, nebo <b>přečtením z fotky (OCR)</b>. K bodu připojíš fotku a poznámku.'
        },
        {
            sel: '#dock .dock-btn:nth-child(4)',
            title: 'Moje body',
            body: 'Seznam tvých bodů. Tady je upravíš, skryješ, smažeš a <b>exportuješ či importuješ</b> (CSV, TXT, GPX, GeoJSON, JSON).'
        },
        {
            sel: '#dock .dock-btn:nth-child(5)',
            title: 'Nastavení',
            body: 'Přesnost a kalibrace AR, vzhled a barvy, přepínání zakázek a záloha všech dat. Tady taky kdykoli znovu spustíš tento návod.'
        },
        {
            sel: '#menu-toggle-btn',
            title: 'Menu',
            body: 'Plné menu se všemi funkcemi a rychlými přepínači — info panel, kompas a průměrování GPS.'
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
            center: true, icon: '🎯',
            title: 'A to je vše!',
            body: 'Můžeš začít. <b>Tip:</b> panely přesnosti a kompasu lze podržením posouvat a dvěma prsty zvětšit. Tenhle návod najdeš kdykoli v <b>Nastavení → Spustit návod</b>.'
        }
    ];

    var els = null;      // nactene DOM prvky overlaye
    var order = [];      // indexy kroku, ktere se realne ukazi
    var pos = 0;         // pozice v `order`
    var active = false;

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
            skip: root.querySelector('.tut-skip')
        };
        els.next.addEventListener('click', function () { go(1); });
        els.back.addEventListener('click', function () { go(-1); });
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
        var step = STEPS[order[pos]];
        els.title.innerHTML = step.title;
        els.body.innerHTML = step.body;
        if (step.icon) { els.icon.textContent = step.icon; els.icon.hidden = false; }
        else els.icon.hidden = true;

        els.back.style.visibility = pos === 0 ? 'hidden' : 'visible';
        els.next.textContent = pos === order.length - 1 ? 'Hotovo' : 'Další';

        // tecky prubehu
        var dots = '';
        for (var i = 0; i < order.length; i++) dots += '<span class="tut-dot' + (i === pos ? ' on' : '') + '"></span>';
        els.dots.innerHTML = dots;

        var target = step.sel ? document.querySelector(step.sel) : null;
        if (target && isVisible(target)) placeAtTarget(target);
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

    function start() {
        buildOverlay();
        // urci viditelne kroky (center kroky jsou vzdy)
        order = [];
        for (var i = 0; i < STEPS.length; i++) {
            var s = STEPS[i];
            if (s.center) { order.push(i); continue; }
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

    function finish() {
        active = false;
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
        window.removeEventListener('resize', reposition);
        window.removeEventListener('orientationchange', reposition);
        if (els) els.root.classList.remove('on');
        document.body.classList.remove('tut-active');
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
