// ===== AR Geodet — PREDIKCE GNSS SIGNÁLU (skyplot + elevační maska) ==============
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu vylepseni.js: NEEDITUJE logika.js ani
// grafika.js ani satelity.js. Načítá se jako jeden z posledních skriptů.
//
// Co dělá: z dat js/satelity.js (pozice družic az/el, výpočet PDOP) postaví
// jednoduchý skyplot pro AKTUÁLNÍ polohu a čas. Uživatel posuvníkem nastaví
// elevační masku (default 15°) — kolik oblohy mu zaclání domy/stromy/svah — a
// modul ukáže, kolik družic zbude nad maskou a orientační hodnocení signálu.
//
// Odstranění: smaž js/sky-obstruction.js + css/sky-obstruction.css a oba řádky
// v index.html / sw.js. Aplikace pak funguje přesně jako předtím.
//
// Závislosti (vše OVĚŘENO čtením, používá se fail-silent přes typeof):
//   computeSatPositions(date) -> [{name,short,sys,col,az,el}]  (satelity.js)
//   computePDOP(obsList) -> number|null                        (satelity.js)
//   tleSats[], loadTleFromCache(), SAT_SYS[]                    (satelity.js)
//   userLat / userLng                                          (logika.js, GPS)
//   agAlert / agConfirm (volitelně, vylepseni.js)
// ================================================================================
(function () {
    'use strict';

    var DLG_ID = 'sky-obs-modal';
    var BTN_ID = 'sky-obs-launch';     // tlačítko v bočním menu
    var SATBTN_ID = 'sky-obs-satbtn';  // tlačítko v sat modálu
    var MASK_KEY = 'skyObsMask1';      // uložená elevační maska
    var _refreshTimer = null;

    // --------------------------------------------------------------------------------
    // Drobné pomůcky (vlastní, ať nezávisíme na pořadí načtení vylepseni.js)
    // --------------------------------------------------------------------------------
    function alertBox(title, msg) {
        try { if (typeof window.agAlert === 'function') { window.agAlert({ title: title, message: msg }); return; } } catch (e) {}
        try { agInfo(title + '\n\n' + String(msg).replace(/<[^>]+>/g, '')); } catch (e) {}
    }
    function getMask() {
        var m = 15;
        try { var v = parseInt(localStorage.getItem(MASK_KEY), 10); if (isFinite(v)) m = v; } catch (e) {}
        return Math.max(0, Math.min(45, m));
    }
    function setMask(v) {
        try { localStorage.setItem(MASK_KEY, String(v)); } catch (e) {}
    }
    function hasGps() {
        try { return typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null; } catch (e) { return false; }
    }
    function hasSatApi() {
        try { return typeof computeSatPositions === 'function'; } catch (e) { return false; }
    }
    function hasTle() {
        try { return typeof tleSats !== 'undefined' && tleSats && tleSats.length > 0; } catch (e) { return false; }
    }
    function sysList() {
        try { if (typeof SAT_SYS !== 'undefined' && Array.isArray(SAT_SYS)) return SAT_SYS; } catch (e) {}
        return [];
    }

    // --------------------------------------------------------------------------------
    // SKYPLOT — polární projekce: střed = zenit (el 90°), okraj = horizont (el 0°)
    // sever nahoru, východ vpravo (azimut po směru hodin). Kreslíme do SVG.
    // --------------------------------------------------------------------------------
    function projXY(az, el, R) {
        // r = poloměr na plátně; el 90 -> 0 (střed), el 0 -> R (okraj)
        var r = (90 - el) / 90 * R;
        var a = (az - 90) * Math.PI / 180; // -90 aby sever (az 0) byl nahoře (-Y)
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
    }

    function buildSkyplotSvg(obs, mask) {
        var R = 100;                  // logický poloměr ve viewBoxu
        var cx = 110, cy = 110;       // střed + okraj na popisky
        var maskR = mask / 90 * R;    // poloměr maskovaného horizontu (od okraje dovnitř)
        var maskInner = R - maskR;    // poloměr KRUHU, pod kterým (vně) jsou družice zacloněné

        var s = '<svg viewBox="0 0 220 220" class="sky-svg" role="img" aria-label="Skyplot oblohy s družicemi">';
        // zacloněný prstenec (vnější mezikruží od horizontu k masce)
        s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" class="sky-horizon"/>';
        s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + maskInner + '" class="sky-clear"/>';
        // elevační kružnice 30° a 60°
        [30, 60].forEach(function (e) {
            var rr = (90 - e) / 90 * R;
            s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + rr + '" class="sky-grid"/>';
        });
        // hranice masky (zvýrazněná)
        s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + maskInner + '" class="sky-mask-line"/>';
        // osy N/S/E/W
        s += '<line x1="' + cx + '" y1="' + (cy - R) + '" x2="' + cx + '" y2="' + (cy + R) + '" class="sky-grid"/>';
        s += '<line x1="' + (cx - R) + '" y1="' + cy + '" x2="' + (cx + R) + '" y2="' + cy + '" class="sky-grid"/>';
        // popisky světových stran
        s += '<text x="' + cx + '" y="' + (cy - R - 2) + '" class="sky-card">S</text>';
        s += '<text x="' + cx + '" y="' + (cy + R + 9) + '" class="sky-card">J</text>';
        s += '<text x="' + (cx + R + 3) + '" y="' + (cy + 3) + '" class="sky-card" text-anchor="start">V</text>';
        s += '<text x="' + (cx - R - 3) + '" y="' + (cy + 3) + '" class="sky-card" text-anchor="end">Z</text>';

        // družice
        obs.forEach(function (o) {
            if (o.el < 0) return; // pod horizontem nekreslíme
            var p = projXY(o.az, o.el, R);
            var x = cx + p.x, y = cy + p.y;
            var above = o.el >= mask;
            var col = o.col || '#a3a3a3';
            s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (above ? 4 : 3) + '" '
                + 'fill="' + col + '" class="sky-sat' + (above ? '' : ' blocked') + '"/>';
        });
        s += '</svg>';
        return s;
    }

    // --------------------------------------------------------------------------------
    // Statistiky + hodnocení
    // --------------------------------------------------------------------------------
    function ratingFor(nVisible, pdop) {
        // Hrubé orientační hodnocení pro telefonní GNSS.
        // Počet družic nad maskou je hlavní; PDOP (je-li) doladí.
        if (nVisible >= 7 && (pdop == null || pdop <= 3)) return { cls: 'good', txt: 'Dobrá viditelnost oblohy' };
        if (nVisible >= 5 && (pdop == null || pdop <= 6)) return { cls: 'ok', txt: 'Použitelná, ale ne ideální' };
        if (nVisible >= 4) return { cls: 'weak', txt: 'Slabá — geometrie nejistá' };
        return { cls: 'bad', txt: 'Nedostatek družic pro fix' };
    }

    function render() {
        var body = document.getElementById('sky-obs-body');
        if (!body) return;

        if (!hasSatApi()) {
            body.innerHTML = '<p class="sky-note sky-warn">Modul družic (satelity.js) se nenačetl — připojte se k internetu a obnovte aplikaci.</p>';
            return;
        }
        if (!hasTle()) {
            try { if (typeof loadTleFromCache === 'function') loadTleFromCache(); } catch (e) {}
        }
        if (!hasGps()) {
            body.innerHTML = '<p class="sky-note">Čekám na GPS pozici… Skyplot se vykreslí, jakmile telefon zná polohu.</p>';
            return;
        }
        if (!hasTle()) {
            body.innerHTML = '<p class="sky-note sky-warn">Nejsou stažené dráhy družic (TLE). Otevřete „GNSS satelity (AR)" a klepněte na Aktualizovat dráhy — pak se sem vraťte.</p>';
            return;
        }

        var obs = [];
        try { obs = computeSatPositions(new Date()) || []; } catch (e) { obs = []; }
        if (!obs.length) {
            body.innerHTML = '<p class="sky-note sky-warn">Družice se nepodařilo spočítat (chybí data nebo pozice).</p>';
            return;
        }

        var mask = getMask();
        var visible = obs.filter(function (o) { return o.el >= mask; });

        // počty po systémech
        var counts = {};
        sysList().forEach(function (sy) { counts[sy.key] = 0; });
        visible.forEach(function (o) { if (counts[o.sys] != null) counts[o.sys]++; });

        // PDOP — satelity.js počítá s pevnou maskou 10°; ukazujeme jen jako orientaci
        var pdop = null;
        try { if (typeof computePDOP === 'function') pdop = computePDOP(obs); } catch (e) { pdop = null; }

        var rate = ratingFor(visible.length, pdop);

        var html = '';
        html += '<div class="sky-plot-wrap">' + buildSkyplotSvg(obs, mask) + '</div>';

        // posuvník masky
        html += '<div class="sky-mask-row">'
            + '<label for="sky-obs-mask">Elevační maska (zaclonění horizontu)</label>'
            + '<div class="sky-mask-ctl">'
            + '<input type="range" id="sky-obs-mask" min="0" max="45" step="1" value="' + mask + '">'
            + '<span class="sky-mask-val" id="sky-obs-mask-val">' + mask + '°</span>'
            + '</div>'
            + '<div class="sky-hint">Posuňte podle toho, jak vysoko kolem vás zaclání domy, stromy nebo svah. Volné nebe ≈ 5–10°, mezi domy/v lese i 25°+.</div>'
            + '</div>';

        // hodnocení
        html += '<div class="sky-verdict ' + rate.cls + '">'
            + '<div class="sky-verdict-big">' + visible.length + ' <span>družic nad ' + mask + '°</span></div>'
            + '<div class="sky-verdict-txt">' + rate.txt + '</div>'
            + '</div>';

        // rozpad po systémech
        var chips = sysList().map(function (sy) {
            return '<span class="sky-chip" style="color:' + sy.col + ';">● ' + sy.label + ': ' + (counts[sy.key] || 0) + '</span>';
        }).join('');
        if (chips) html += '<div class="sky-chips">' + chips + '</div>';

        // PDOP (orientačně)
        if (pdop != null && isFinite(pdop)) {
            var pq = pdop <= 2 ? 'výborná' : (pdop <= 4 ? 'dobrá' : (pdop <= 6 ? 'průměrná' : 'slabá'));
            html += '<div class="sky-pdop">Geometrie družic (PDOP): <b>' + pdop.toFixed(1) + '</b> · ' + pq
                + ' <span class="sky-pdop-note">(počítáno nad 10° — vlastní horizont nemusí sedět)</span></div>';
        }

        html += '<p class="sky-note">Orientační pomůcka. Telefonní GNSS má systematickou chybu ~5–15 m a maska je odhad — skutečné zaclonění (zeď, mokré listí) může být horší. Pro nejlepší fix hledejte volný výhled na jih.</p>';

        body.innerHTML = html;

        // napojit posuvník
        var sl = document.getElementById('sky-obs-mask');
        var lbl = document.getElementById('sky-obs-mask-val');
        if (sl) {
            sl.addEventListener('input', function () {
                var v = parseInt(sl.value, 10);
                if (lbl) lbl.textContent = v + '°';
                setMask(v);
                render(); // překreslit skyplot + statistiky
            });
        }
    }

    // --------------------------------------------------------------------------------
    // Modal
    // --------------------------------------------------------------------------------
    function ensureModal() {
        if (document.getElementById(DLG_ID)) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay';
        el.id = DLG_ID;
        el.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent); margin-top:0; margin-bottom:5px;"><svg class="icon"><use href="#i-satellite"/></svg> Predikce signálu (skyplot)</h3>' +
            '  <p style="margin:0 0 10px; font-size:calc(12.5px * var(--ag-font-scale, 1)); opacity:0.8;">Kde jsou družice nad vámi a kolik jich zbude, když si nastavíte, jak vysoko kolem vás zaclání okolí.</p>' +
            '  <div class="modal-body" id="sky-obs-body"></div>' +
            '  <button class="btn btn-secondary" style="margin-top:15px;" id="sky-obs-close">Zavřít</button>' +
            '</div>';
        document.body.appendChild(el);

        // zavírání
        var close = function () {
            el.style.display = 'none';
            if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
        };
        var btn = el.querySelector('#sky-obs-close');
        if (btn) btn.addEventListener('click', close);
        el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
    }

    function openModal() {
        ensureModal();
        var el = document.getElementById(DLG_ID);
        if (!el) return;
        el.style.display = 'flex';
        render();
        // živá aktualizace (družice se hýbou) — jen když je modal otevřený
        if (_refreshTimer) clearInterval(_refreshTimer);
        _refreshTimer = setInterval(function () {
            var m = document.getElementById(DLG_ID);
            if (!m || m.style.display !== 'flex') { clearInterval(_refreshTimer); _refreshTimer = null; return; }
            // nepřekreslovat, když uživatel zrovna tahá posuvníkem (drží focus)
            var sl = document.getElementById('sky-obs-mask');
            if (sl && document.activeElement === sl) return;
            render();
        }, 5000);
    }
    window.openSkyObstruction = openModal;

    // --------------------------------------------------------------------------------
    // Injekce tlačítek (idempotentní)
    // --------------------------------------------------------------------------------
    function injectMenuButton() {
        // Primárně dlaždice v „Nástroje" (kategorie Katastr a data, u GNSS satelitů);
        // boční menu „Více" je jen nouzový fallback, když field-tools.js chybí.
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'sky-obstruction', label: 'Predikce signálu', icon: '<svg class="icon"><use href="#i-satellite"/></svg>', cat: 'Katastr a data', onClick: openModal, order: 30 });
            var stale = document.getElementById(BTN_ID); if (stale) stale.remove();
            return;
        }
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById(BTN_ID)) return;
        // Vkládáme do scrollovací části, ať položka scrolluje a dole zůstává pevné jen „Zavřít".
        var host = menu.querySelector('.menu-scroll') || menu;
        var btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.className = 'menu-btn';
        btn.type = 'button';
        btn.innerHTML = '<svg class="icon"><use href="#i-satellite"/></svg> Predikce signálu';
        btn.addEventListener('click', function () {
            try { if (typeof toggleMenu === 'function') toggleMenu(); } catch (e) {}
            openModal();
        });
        // vlož hned za tlačítko "GNSS satelity (AR)", ať jsou družicové funkce u sebe
        var satBtn = null;
        var btns = host.querySelectorAll('button.menu-btn');
        for (var i = 0; i < btns.length; i++) {
            var oc = btns[i].getAttribute('onclick') || '';
            if (oc.indexOf('openSatModal') >= 0) { satBtn = btns[i]; break; }
        }
        if (satBtn && satBtn.nextSibling) host.insertBefore(btn, satBtn.nextSibling);
        else if (satBtn) host.appendChild(btn);
        else host.appendChild(btn);
    }

    function injectSatModalButton() {
        // doplňkové tlačítko přímo v modálu GNSS satelitů (pokud už existuje)
        var modal = document.getElementById('sat-modal');
        if (!modal || document.getElementById(SATBTN_ID)) return;
        var body = modal.querySelector('.modal-body');
        if (!body) return;
        var btn = document.createElement('button');
        btn.id = SATBTN_ID;
        btn.className = 'btn btn-secondary';
        btn.type = 'button';
        btn.style.marginTop = '8px';
        btn.innerHTML = '<svg class="icon"><use href="#i-satellite"/></svg> Predikce signálu (skyplot + maska)';
        btn.addEventListener('click', function () {
            var sm = document.getElementById('sat-modal'); if (sm) sm.style.display = 'none';
            openModal();
        });
        body.appendChild(btn);
    }

    // --------------------------------------------------------------------------------
    // Init
    // --------------------------------------------------------------------------------
    function init() {
        try { injectMenuButton(); } catch (e) { console.warn('[sky-obstruction] menuBtn', e); }
        try { injectSatModalButton(); } catch (e) { console.warn('[sky-obstruction] satBtn', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // Druhý průchod — sat-modal i menu mohou vzniknout/dorenderovat později.
    window.addEventListener('load', function () { setTimeout(init, 400); });
})();
