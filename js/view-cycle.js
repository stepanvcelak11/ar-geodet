// ===== AR Geodet — PŘEPÍNAČ ZOBRAZENÍ NA JEDEN TAP (ODPOJITELNÁ) ================
// Malé plovoucí „kolečko" vpravo dole: každé klepnutí přepne zobrazení dokola
// AR → Split → Mapa → AR… Na rozdíl od segmentu v menu „Více" (2 tapy) je po ruce
// pořád — i v celoobrazovkovém AR nebo Mapě, kde dělicí příčka není.
// V režimu levé ruky (body.left-hand) se zrcadlí doleva jako ostatní ovládání.
// Kolečko ukazuje AKTUÁLNÍ režim; klepnutím se točí na další.
// Odstranění: smaž js/view-cycle.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var STYLE_ID = 'ag-vc-style';
    var BTN_ID = 'ag-view-wheel';
    var ORDER = ['ar', 'both', 'map'];
    var LABEL = { ar: 'AR', both: 'Split', map: 'Mapa' };
    var ICON = { ar: '#i-camera', both: '#i-grid', map: '#i-map-pin' };

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // vzhled = chip z doku (.dock-btn): stejné sklo, rám i průhlednost (--panel-opacity,
            // bez ní působil tmavší než okolní tlačítka), jen KULATÝ; kousek od kraje, ne nalepený
            // z-index 9000 = stejná vrstva jako dok — menu „Více" (10000), bottom-sheet
            // i modály ho tak správně PŘEKRYJÍ (dřív 10500 plavalo nad menu Více)
            '#' + BTN_ID + '{position:fixed;right:max(16px,env(safe-area-inset-right,0px));',
            '  bottom:max(6px,env(safe-area-inset-bottom,0px));z-index:9000;',
            '  width:54px;height:54px;padding:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:2px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.10));border-radius:50%;',
            '  background:var(--glass-bg,rgba(24,28,33,0.84));backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);',
            '  opacity:var(--panel-opacity,0.85);',
            '  color:var(--text-color,#eceef2);font:600 8px/1.1 var(--font-ui,system-ui),sans-serif;letter-spacing:.02em;',
            '  cursor:pointer;box-shadow:var(--shadow-1,0 1px 3px rgba(0,0,0,0.5));}',
            '#' + BTN_ID + ' .icon{width:20px;height:20px;color:var(--accent-bright,#3eb487);}',
            '#' + BTN_ID + ' span{text-shadow:0 1px 3px rgba(0,0,0,0.9),0 0 2px rgba(0,0,0,0.7);}',
            'body.app-started #' + BTN_ID + '{display:flex;}',
            'body.left-hand #' + BTN_ID + '{right:auto;left:max(16px,env(safe-area-inset-left,0px));}',
            '#' + BTN_ID + ':active{transform:scale(0.93);}',
            'body.ag-glove #' + BTN_ID + '{width:64px;height:64px;font-size:9.5px;}',
            'body.ag-glove #' + BTN_ID + ' .icon{width:24px;height:24px;}',
            // rozbalené nástroje mapy = vodorovná řada vystředěná na spodní hraně → kolečko uhne nahoru
            '#' + BTN_ID + '.ag-vc-lift{bottom:calc(max(6px,env(safe-area-inset-bottom,0px)) + 62px);}',
            'body.outdoor-mode #' + BTN_ID + '{background:#0a0e1a;border-color:rgba(255,255,255,0.85);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function cur() { return (typeof viewMode !== 'undefined' && LABEL[viewMode]) ? viewMode : 'both'; }

    // Srovná VŠECHNY ovladače zobrazení podle aktuálního viewMode: kolečko,
    // segment v „Více" i radia v Nastavení. Volá se i z grafika.js (fallback kamery).
    function sync() {
        var b = document.getElementById(BTN_ID);
        if (b) {
            var u = b.querySelector('use'), s = b.querySelector('span');
            if (u) u.setAttribute('href', ICON[cur()]);
            if (s) s.textContent = LABEL[cur()];
            // vybledá s ostatním HUD po nečinnosti — zrcadlí .ui-faded z tlačítka Menu
            // (třídu řídí resetInactivityTimer v grafika.js, vzor js/compass-stability.js)
            var mt = document.getElementById('menu-toggle-btn');
            b.classList.toggle('ui-faded', !!(mt && mt.classList.contains('ui-faded')));
            // uhnout před rozbalenou řadou nástrojů mapy (bez .expanded je display:none)
            b.classList.toggle('ag-vc-lift', !!document.querySelector('#map-controls.expanded'));
        }
        // (Segment #view-seg byl z UI odstraněn — kolečko ho nahradilo; zbyl jen sync radií v Nastavení.)
        try {
            var r = document.querySelector('input[name="s-view"][value="' + cur() + '"]');
            if (r && !r.checked) r.checked = true;
        } catch (e) {}
    }
    window.agSyncViewControls = sync;

    function next() {
        if (typeof viewMode === 'undefined') return;
        var m = ORDER[(ORDER.indexOf(cur()) + 1) % ORDER.length];
        viewMode = m;
        try { if (typeof applyViewMode === 'function') applyViewMode(); } catch (e) { console.warn('[view-cycle]', e); }
        sync();
        try { if (typeof visSettings !== 'undefined' && visSettings.vibrationEnabled && navigator.vibrate) navigator.vibrate(15); } catch (e) {}
    }

    function ensureBtn() {
        if (document.getElementById(BTN_ID)) return;
        var b = document.createElement('button');
        b.id = BTN_ID; b.type = 'button';
        b.setAttribute('aria-label', 'Přepnout zobrazení (AR / Split / Mapa)');
        b.innerHTML = '<svg class="icon"><use href="' + ICON.both + '"/></svg><span></span>';
        b.addEventListener('click', next);
        document.body.appendChild(b);
        sync();
    }

    // probuzení hned při dotyku (stejné události jako resetInactivityTimer v grafika.js);
    // zpětné VYblednutí zajistí zrcadlení v tick() — drobné zpoždění tam nevadí
    ['touchstart', 'click', 'mousemove'].forEach(function (evt) {
        document.addEventListener(evt, function () {
            var b = document.getElementById(BTN_ID);
            if (b) b.classList.remove('ui-faded');
        }, { passive: true });
    });
    // po klepnutí hned přepočítat i uhýbání/popisek (zapnutí nástrojů mapy z „Více"
    // by jinak čekalo až na 1,5s tick)
    document.addEventListener('click', function () { setTimeout(function () { try { sync(); } catch (e) {} }, 50); }, { passive: true });

    function tick() { try { injectStyles(); ensureBtn(); sync(); } catch (e) {} }
    function init() {
        tick();
        // viewMode mění i segment v „Více", radia v Nastavení a start appky — držet popisek aktuální
        if (!window.__agVcTimer) window.__agVcTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
