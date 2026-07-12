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
    var LABEL = { ar: 'AR', both: 'SPLIT', map: 'MAPA' };

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + BTN_ID + '{position:fixed;right:max(10px,env(safe-area-inset-right,0px));',
            // nad atribucí mapy (© ČÚZK/OSM v rohu) a mimo ovládání mapy (right:74px)
            '  bottom:calc(env(safe-area-inset-bottom,0px) + 64px);z-index:10500;',
            '  width:50px;height:50px;border-radius:50%;border:1px solid var(--glass-border-strong,rgba(255,255,255,0.2));',
            '  background:var(--glass-bg,rgba(24,28,33,0.84));backdrop-filter:blur(12px) saturate(140%);-webkit-backdrop-filter:blur(12px) saturate(140%);',
            '  color:var(--text-color,#eceef2);font:700 10.5px/1 var(--font-display,system-ui),sans-serif;letter-spacing:.04em;',
            '  display:none;align-items:center;justify-content:center;cursor:pointer;box-shadow:var(--shadow-1,0 1px 3px rgba(0,0,0,0.5));}',
            'body.app-started #' + BTN_ID + '{display:flex;}',
            'body.left-hand #' + BTN_ID + '{right:auto;left:max(10px,env(safe-area-inset-left,0px));}',
            '#' + BTN_ID + ':active{transform:scale(0.93);}',
            'body.ag-glove #' + BTN_ID + '{width:60px;height:60px;font-size:12px;}',
            'body.outdoor-mode #' + BTN_ID + '{background:#0a0e1a;border-color:rgba(255,255,255,0.85);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function cur() { return (typeof viewMode !== 'undefined' && LABEL[viewMode]) ? viewMode : 'both'; }

    // Srovná VŠECHNY ovladače zobrazení podle aktuálního viewMode: kolečko,
    // segment v „Více" i radia v Nastavení. Volá se i z grafika.js (fallback kamery).
    function sync() {
        var b = document.getElementById(BTN_ID);
        if (b) b.textContent = LABEL[cur()];
        try {
            document.querySelectorAll('#view-seg .seg-btn').forEach(function (x) {
                x.classList.toggle('active', x.getAttribute('data-view') === cur());
            });
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
        b.addEventListener('click', next);
        document.body.appendChild(b);
        sync();
    }

    function tick() { try { injectStyles(); ensureBtn(); sync(); } catch (e) {} }
    function init() {
        tick();
        // viewMode mění i segment v „Více", radia v Nastavení a start appky — držet popisek aktuální
        if (!window.__agVcTimer) window.__agVcTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
