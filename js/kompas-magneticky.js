// ===== AR Geodet — KOMPAS S MAGNETICKÝM SEVEREM (ODPOJITELNÁ vrstva) ===========
// PROČ: appka všude počítá azimuty k ZEMĚPISNÉMU (pravému) severu — tak jsou zadané
// souřadnice, tak to chce katastr, tak se orientuje mapa. Magnetometr telefonu ale
// měří MAGNETICKÝ sever a logika.js k němu automaticky přičítá deklinaci, takže
// magnetický azimut nikde nebylo vidět. V terénu ho člověk potřebuje pořád:
//   • porovnání s busolou / kompasem v ruce (ta ukazuje magnetický azimut),
//   • starší podklady a náčrty orientované podle magnetického severu,
//   • kontrola, jestli se telefonní kompas nezbláznil (u auta, plotu, vedení).
//
// CO TO DĚLÁ: do modálu „Kompas a sever" (#tab-kompas) přidá nahoru živou růžici —
// otáčí se podle telefonu, má zeměpisný sever (bílá špice N) i MAGNETICKÝ sever
// (červená střelka) a pod ní oba azimuty vedle sebe + deklinaci v místě.
// Deklinaci bere z globálu `magneticDeclination` (počítá ji logika.js z polohy,
// GeoCore.declination), směr z `currentHeading`. Jednotky respektují nastavení
// appky (° / gon).
//
// NEEDITUJE logika.js ani grafika.js, jen čte globály. Když modul chybí, kompas
// funguje jako dřív (jen bez magnetického severu).
//
// BATERIE: přepočítává se JEN když je modál kompasu otevřený (jinak se tick hned
// vrátí), a maximálně 8× za sekundu.
//
// Odstranění: smaž js/kompas-magneticky.js + jeho řádek <script> v index.html
// a v sw.js (scripts/gen_sw_assets.py).
// ================================================================================
(function () {
    'use strict';
    if (window.AGMagCompass) return;

    var BOX_ID = 'ag-mag';
    var TICK_MS = 125;

    function num(v, d) { return (+v).toFixed(d == null ? 1 : d).replace('.', ','); }
    function mod360(a) { return ((a % 360) + 360) % 360; }

    // živé globály appky (modul je jen čte)
    // POZOR na `currentHeading`: startuje na 0 a přepisuje ho až renderAR z událostí
    // kompasu. Na počítači (bez senzoru) i po odpojení senzorů (úsporný režim) by tedy
    // ukazoval poctivou nulu, jako by telefon mířil na sever. Živost proto poznáme
    // z `window._lastOriTs` — časové značky poslední zpracované orientační události.
    function headingFresh() {
        try {
            var t = window._lastOriTs;
            if (typeof t !== 'number') return false;
            return (performance.now() - t) < 3000;
        } catch (e) { return false; }
    }
    function heading() {
        try {
            if (!headingFresh()) return null;
            return (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null;
        } catch (e) { return null; }
    }
    function decl() {
        try { return (typeof magneticDeclination === 'number' && isFinite(magneticDeclination)) ? magneticDeclination : null; } catch (e) { return null; }
    }
    function unitGon() { try { return (typeof compassUnit !== 'undefined') && compassUnit === 'gon'; } catch (e) { return false; } }
    // formát azimutu ve zvolených jednotkách (gon = 400 dílků, geodetický zápis)
    function az(v) {
        v = mod360(v);
        if (!unitGon()) return num(v, 1) + ' °';
        var g = v * (400 / 360);
        var whole = Math.floor(g), cc = Math.round((g - whole) * 100);
        if (cc === 100) { whole += 1; cc = 0; }
        return whole + '<sup>g</sup> ' + (cc < 10 ? '0' + cc : cc) + '<sup>c</sup>';
    }

    // ---- růžice --------------------------------------------------------------------
    // Kreslí se JEDNOU; při každém ticku se jen otáčí (transform) a přepisují čísla.
    // Otáčí se vnitřní skupina, ne celé SVG — jinak by se točily i popisky azimutů.
    function roseSvg() {
        var t = '', i, a, len, x1, y1, x2, y2;
        for (i = 0; i < 72; i++) {                      // dílky po 5°
            a = i * 5 * Math.PI / 180;
            len = (i % 18 === 0) ? 13 : ((i % 6 === 0) ? 9 : 5);
            x1 = 60 + 52 * Math.sin(a); y1 = 60 - 52 * Math.cos(a);
            x2 = 60 + (52 - len) * Math.sin(a); y2 = 60 - (52 - len) * Math.cos(a);
            t += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"'
                + ' stroke="currentColor" stroke-width="' + (i % 18 === 0 ? 1.6 : 0.8) + '" opacity="' + (i % 18 === 0 ? 0.85 : 0.35) + '"/>';
        }
        ['S', 'V', 'J', 'Z'].forEach(function (lbl, k) {
            a = k * 90 * Math.PI / 180;
            var x = 60 + 33 * Math.sin(a), y = 60 - 33 * Math.cos(a);
            t += '<text x="' + x.toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="middle" class="agm-lbl' + (k === 0 ? ' agm-n' : '') + '">' + lbl + '</text>';
        });
        return '<svg viewBox="0 0 120 120" class="agm-rose" aria-hidden="true">'
            + '<circle cx="60" cy="60" r="56" class="agm-ring"/>'
            + '<g id="agm-dial">' + t
            // zeměpisný sever = bílá špice na okraji růžice
            + '<polygon points="60,2 55,14 65,14" class="agm-true"/>'
            // magnetický sever = červená střelka (leží v azimutu = deklinace)
            + '<g id="agm-needle"><polygon points="60,6 56,60 64,60" class="agm-mag"/>'
            + '<polygon points="60,114 56,60 64,60" class="agm-mag-s"/></g>'
            + '</g>'
            + '<circle cx="60" cy="60" r="3.4" class="agm-hub"/>'
            // PEVNÁ ryska „kam míří telefon" (nerotuje, proto je až za skupinou #agm-dial):
            // nahoře, špičkou dolů do růžice — čte se pod ní, jako na busole
            + '<polygon points="60,15 55,1 65,1" class="agm-fwd"/>'
            + '</svg>';
    }

    function styles() {
        if (document.getElementById('agm-style')) return;
        var st = document.createElement('style');
        st.id = 'agm-style';
        st.textContent = [
            '#' + BOX_ID + '{margin:2px 0 16px;padding:12px;border-radius:14px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--surface-1,rgba(255,255,255,0.05));}',
            '#' + BOX_ID + ' .agm-h{display:flex;align-items:center;gap:8px;font:700 13px/1.2 var(--font-ui,system-ui);margin:0 0 10px;}',
            '#' + BOX_ID + ' .agm-h svg{width:18px;height:18px;color:var(--accent,#2f9e74);flex:0 0 auto;}',
            '.agm-wrap{display:flex;align-items:center;gap:14px;}',
            // Od 9. 8. 2026 je růžice OBSAHEM NÁSTROJE, ne přílepkem v nastavení —
            // proto je větší. Na úzkém displeji se rozvržení stejně sloupí (viz níž)
            // a tam dostane skoro celou šířku, ať se dá číst na dálku i v rukavicích.
            '.agm-rose{width:150px;height:150px;flex:0 0 auto;color:var(--text-color,#eceef2);}',
            '.agm-ring{fill:rgba(0,0,0,0.18);stroke:var(--glass-border,rgba(255,255,255,0.14));stroke-width:1;}',
            '.agm-lbl{font:700 11px var(--font-ui,system-ui);fill:currentColor;opacity:0.75;}',
            '.agm-lbl.agm-n{opacity:1;}',
            '.agm-true{fill:var(--text-color,#eceef2);}',
            '.agm-mag{fill:#ef4444;}',
            '.agm-mag-s{fill:rgba(255,255,255,0.22);}',
            '.agm-hub{fill:var(--text-color,#eceef2);}',
            '.agm-fwd{fill:var(--accent,#2f9e74);}',
            '.agm-vals{flex:1;min-width:0;}',
            '.agm-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:4px 0;',
            '  border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.08));}',
            '.agm-row:last-child{border-bottom:none;}',
            '.agm-k{font:600 11.5px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.agm-v{font:700 15px/1.1 var(--font-mono,ui-monospace,monospace);color:var(--data,#e6bd76);',
            '  font-variant-numeric:tabular-nums;white-space:nowrap;}',
            '.agm-v.agm-v-mag{color:var(--danger,#f87171);}',
            '.agm-v sup{font-size:calc(9px * var(--ag-font-scale, 1));}',
            '.agm-note{font:400 11.5px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:10px 0 0;}',
            '.agm-note b{color:var(--text-color,#eceef2);font-weight:600;}',
            // LEGENDA: bez ní se u růžice nedá poznat, co je která špice — a přesně na
            // to se uživatel ptal („nevím, kde je magnetický sever"). Barevný čtvereček
            // má stejnou barvu jako značka v SVG.
            '.agm-leg{display:flex;flex-wrap:wrap;gap:4px 14px;margin:10px 0 0;',
            '  font:500 11.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.agm-leg span{display:flex;align-items:center;gap:6px;}',
            '.agm-leg i{width:9px;height:9px;border-radius:2px;flex:0 0 auto;display:block;}',
            '.agm-leg .agm-i-true{background:var(--text-color,#eceef2);}',
            '.agm-leg .agm-i-mag{background:#ef4444;}',
            '.agm-leg .agm-i-fwd{background:var(--accent,#2f9e74);}',
            'body.outdoor-mode #' + BOX_ID + '{background:#0a0e1a;border-color:rgba(255,255,255,0.6);}',
            'body.light-mode.outdoor-mode #' + BOX_ID + '{background:#fff;border-color:rgba(10,14,26,0.5);}',
            '@media (max-width:430px){.agm-wrap{flex-direction:column;align-items:stretch;}',
            '  .agm-rose{align-self:center;width:min(78vw,230px);height:min(78vw,230px);}}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 10.5 10.5 8.5 15.5 13.5 13.5"/></svg>';

    var _box = null;
    function build() {
        // hotový panel si pamatujeme — jinak tu byly dva až tři dotazy do DOM 8×/s
        if (_box && _box.isConnected) return true;
        _box = document.getElementById(BOX_ID);
        if (_box && _box.isConnected) return true;
        var host = document.getElementById('tab-kompas');
        if (!host) return false;
        styles();
        var box = document.createElement('div');
        box.id = BOX_ID;
        box.innerHTML =
            // Nadpis mluví o OBOU severech: panel je od 9. 8. 2026 hlavním obsahem
            // nástroje Kompas, ne přílepkem „a mimochodem tady je i magnetický sever".
            '<div class="agm-h">' + ICON + ' Kompas — zeměpisný i magnetický sever</div>'
            + '<div class="agm-wrap">' + roseSvg()
            + '<div class="agm-vals">'
            + '  <div class="agm-row"><span class="agm-k">Azimut zeměpisný<br><small>s tímhle appka počítá</small></span><span class="agm-v" id="agm-true">—</span></div>'
            + '  <div class="agm-row"><span class="agm-k">Azimut magnetický<br><small>tohle ukáže busola</small></span><span class="agm-v agm-v-mag" id="agm-mag">—</span></div>'
            + '  <div class="agm-row"><span class="agm-k">Deklinace v místě</span><span class="agm-v" id="agm-decl">—</span></div>'
            + '</div></div>'
            + '<div class="agm-leg">'
            + '<span><i class="agm-i-true"></i>zeměpisný sever</span>'
            + '<span><i class="agm-i-mag"></i>magnetický sever (busola)</span>'
            + '<span><i class="agm-i-fwd"></i>kam míří telefon</span>'
            + '</div>'
            + '<p class="agm-note" id="agm-note">Drž telefon <b>naplocho</b> a dál od kovu, auta a betonářské výztuže.</p>';
        // nahoru: kompas se má číst první, ne až pod tlačítky kalibrace
        host.insertBefore(box, host.firstChild);
        _box = box;
        return true;
    }

    // ---- živý přepočet ---------------------------------------------------------------
    var _last = { t: '', m: '', d: '', rot: null, note: '' };
    // BATERIE: tick() jede 8×/s celý den. Dokud tu byl dotaz na getClientRects() natvrdo,
    // vynucoval si prohlížeč osmkrát za sekundu přepočet rozvržení stránky kvůli panelu,
    // na který se nikdo nedívá — a to je dražší než celé překreslení hodnot. Záložní větev
    // (kdyby #tab-kompas někdo přesunul jinam) proto platíme jen tehdy, když je opravdu
    // otevřené okno, do kterého se dá přesunout.
    var _elc = {};
    function el(id) {
        var e = _elc[id];
        if (!e || !e.isConnected) e = _elc[id] = document.getElementById(id);
        return e;
    }
    function shown(id) {
        var e = el(id);
        return !!(e && e.style && e.style.display && e.style.display !== 'none');
    }
    function visible() {
        var m = el('compass-modal');
        if (m && m.style.display === 'flex') return true;
        if (!shown('settings-modal')) return false;      // není kde být vidět → žádný dotaz na rozvržení
        return !!(_box && _box.isConnected && _box.getClientRects().length);
    }
    function set(id, html, key) {
        if (_last[key] === html) return;
        _last[key] = html;
        var el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }
    function tick() {
        if (!build() || !visible()) return;
        var h = heading(), d = decl();
        if (h == null) {
            set('agm-true', 'čekám…', 't'); set('agm-mag', 'čekám…', 'm');
            set('agm-note', 'Kompas telefonu zatím nehlásí směr — v prohlížeči na počítači ho není odkud vzít, na telefonu povol přístup k senzorům pohybu.', 'note');
        } else {
            // Zeměpisný azimut je to, co appka drží v currentHeading (deklinace už je v něm).
            // Magnetický azimut je o deklinaci MENŠÍ: pravý = magnetický + deklinace(V+).
            set('agm-true', az(h), 't');
            set('agm-mag', (d == null) ? '—' : az(h - d), 'm');
            var dial = document.getElementById('agm-dial');
            // růžice se otáčí PROTI směru telefonu, ať sever ukazuje k severu
            var rot = -mod360(h);
            if (dial && _last.rot !== rot) { _last.rot = rot; dial.setAttribute('transform', 'rotate(' + rot.toFixed(1) + ' 60 60)'); }
            var nd = document.getElementById('agm-needle');
            // magnetický sever leží v zeměpisném azimutu = +deklinace (V kladně)
            if (nd && d != null) nd.setAttribute('transform', 'rotate(' + d.toFixed(2) + ' 60 60)');
            set('agm-note', d == null
                ? 'Deklinaci spočítám, až bude GPS poloha.'
                : ('Magnetický sever je zde <b>' + num(Math.abs(d), 1) + '° na ' + (d >= 0 ? 'východ' : 'západ')
                    + '</b> od zeměpisného. Na 100 m je to posun <b>' + num(Math.abs(d) * Math.PI / 180 * 100, 1)
                    + ' m</b> — busolu a azimuty z appky proto nikdy nemíchej v jednom výpočtu. '
                    + 'Drž telefon naplocho a dál od kovu, auta a betonářské výztuže.'), 'note');
        }
        if (d != null) set('agm-decl', (d >= 0 ? '+' : '−') + num(Math.abs(d), 2) + ' °' + (d >= 0 ? ' V' : ' Z'), 'd');
    }

    // ---- start -----------------------------------------------------------------------
    var _tries = 0;
    function init() {
        registerTile();
        if (!build() && _tries++ < 25) { setTimeout(init, 400); return; }
        if (!window.__agmTimer) window.__agmTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(tick, TICK_MS);
        tick();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 500); });

    // ---- dlaždice KOMPAS v Nástrojích ------------------------------------------------
    // Nahlášeno 9. 8. 2026: „někde v aplikaci je magnetický sever a já nevím kde."
    // Byla to pravda — růžice se ukazovala jen v okně „Kompas a sever", a tam se dalo
    // dostat výhradně z Nastavení → AR a přesnost. Kompas ale není nastavení, je to
    // nástroj, který člověk v terénu otevírá pořád. Dlaždice ho dává tam, kde ho
    // uživatel hledá; okno zůstává jedno a totéž (žádná druhá kopie růžice).
    //
    // Registruje se přes window.agRegisterFieldTool z js/field-tools.js — ten je
    // vlastníkem mřížky Nástrojů. Když ještě není načtený, chvíli se počká.
    var _reg = 0;
    function registerTile() {
        if (window.__agKompasTile) return;
        if (typeof window.agRegisterFieldTool !== 'function' || typeof window.openCompassModal !== 'function') {
            if (_reg++ < 40) setTimeout(registerTile, 400);
            return;
        }
        window.__agKompasTile = true;
        window.agRegisterFieldTool({
            id: 'kompas',
            label: 'Kompas a sever',
            icon: '<svg class="icon"><use href="#i-navigation"/></svg>',
            cat: 'Pomůcky', order: 12,
            onClick: function () {
                try { window.openCompassModal(); } catch (e) { console.warn('[kompas] otevreni', e); }
                tick();                       // ať je růžice živá hned, ne až za 125 ms
            }
        });
    }

    window.AGMagCompass = {
        refresh: tick,
        // magnetický azimut pro daný zeměpisný (nebo pro aktuální směr telefonu)
        magneticAz: function (trueAz) {
            var d = decl(); if (d == null) return null;
            var t = (trueAz == null) ? heading() : trueAz;
            return (t == null) ? null : mod360(t - d);
        },
        declination: decl
    };
})();
