// ===== AR Geodet — PŘEPÍNAČ ZOBRAZENÍ NA JEDEN TAP (ODPOJITELNÁ) ================
// Malý plovoucí „KROUŽEK ZOBRAZENÍ" vpravo dole: každé klepnutí přepne zobrazení
// dokola AR → Split → Mapa → AR… Na rozdíl od segmentu v menu „Více" (2 tapy) je
// po ruce pořád — i v celoobrazovkovém AR nebo Mapě, kde dělicí příčka není.
// V režimu levé ruky (body.left-hand) se zrcadlí doleva jako ostatní ovládání.
// Kroužek ukazuje AKTUÁLNÍ režim; klepnutím se točí na další.
//
// ⚠ NÁZVOSLOVÍ (sjednoceno 8. 8. 2026 na přání): tenhle prvek je KROUŽEK.
// Slovo „kolečko" patří VÝHRADNĚ kolečku nástrojů (výběr nástroje tažením
// od tlačítka Nástroje). Dřív se obojí jmenovalo stejně a nedalo se v hovoru
// ani v commitech rozeznat, o čem je řeč.
// Odstranění: smaž js/view-cycle.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var STYLE_ID = 'ag-vc-style';
    var BTN_ID = 'ag-view-wheel';
    // BATERIE: poradi zacina Mapou — ta je nejlevnejsi (kamera uspana). Klepnutim se jde
    // Mapa -> Split -> AR -> Mapa, takze cesta k plne kamere je vedoma, ne vychozi stav.
    var ORDER = ['map', 'both', 'ar'];
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
            // ODSAZENÍ OD SPODNÍ HRANY: dřív 6 px, tedy kroužek nalepený na kraj. Tah DOLŮ
            // (= Mapa) tam neměl kam jít a na iOS spodní pruh patří systémovému gestu domů,
            // takže ho telefon sebral dřív, než se stihl vyhodnotit. Odsazení dává tahu
            // rozjezd na obě strany. Hodnota je v proměnné, protože ji musí znát i pravidlo
            // `#ag-view-wheel.ag-vc-lift` v css/style.css (má !important) — jinak by kroužek
            // při rozbalených vrstvách mapy skočil zpátky dolů.
            '#' + BTN_ID + '{position:fixed;right:max(16px,env(safe-area-inset-right,0px));',
            '  --ag-vc-bottom:calc(max(6px,env(safe-area-inset-bottom,0px)) + 28px);',
            '  bottom:var(--ag-vc-bottom);z-index:9000;',
            '  width:54px;height:54px;padding:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:2px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.10));border-radius:50%;',
            '  background:var(--glass-bg,rgba(24,28,33,0.84));backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);',
            '  opacity:var(--panel-opacity,0.85);',
            '  color:var(--text-color,#eceef2);font:600 8px/1.1 var(--font-ui,system-ui),sans-serif;letter-spacing:.02em;',
            // touch-action:none = tah po kroužku patří NÁM, prohlížeč z něj neudělá rolování
            // ani gesto zpět (bez toho iOS tah do strany sebere a přepnutí se nekoná)
            '  cursor:pointer;box-shadow:var(--shadow-1,0 1px 3px rgba(0,0,0,0.5));touch-action:none;}',
            // tah přešel práh → kroužek potvrdí, že po puštění přepne (barva + zvětšení)
            '#' + BTN_ID + '.ag-vc-armed{border-color:var(--accent-bright,#3eb487);',
            '  box-shadow:0 0 0 2px var(--accent-soft,rgba(47,158,116,0.4)),var(--shadow-2,0 4px 12px rgba(0,0,0,0.5));',
            '  transform:scale(1.08);opacity:1;}',
            '#' + BTN_ID + ' .icon{width:20px;height:20px;color:var(--accent-bright,#3eb487);}',
            '#' + BTN_ID + ' span{text-shadow:0 1px 3px rgba(0,0,0,0.9),0 0 2px rgba(0,0,0,0.7);}',
            'body.app-started #' + BTN_ID + '{display:flex;}',
            'body.left-hand #' + BTN_ID + '{right:auto;left:max(16px,env(safe-area-inset-left,0px));}',
            '#' + BTN_ID + ':active{transform:scale(0.93);}',
            'body.ag-glove #' + BTN_ID + '{width:64px;height:64px;font-size:calc(9.5px * var(--ag-font-scale, 1));}',
            'body.ag-glove #' + BTN_ID + ' .icon{width:24px;height:24px;}',
            // rozbalené nástroje mapy = vodorovná řada vystředěná na spodní hraně → kroužek uhne nahoru
            '#' + BTN_ID + '.ag-vc-lift{bottom:calc(var(--ag-vc-bottom) + 62px);}',
            // NÍZKÉ DISPLEJE (telefon na šířku): tady se kroužek NEZVEDÁ vůbec — zůstává
            // přesně tam, kde byl. Svislý dok sahá na 360px vysokém displeji až ~40 px nade
            // dno a v režimu rukavic (kroužek 64 px) se s ním potkává. To je stav, který tu
            // byl i předtím (ověřeno proti HEAD), ale zvednutí by ho jen prohloubilo — a na
            // takhle nízkém displeji stejně není kam táhnout. Plný rozjezd pro tah tedy
            // dostávají jen displeje na výšku, kde se appka reálně používá.
            '@media (max-height:560px){#' + BTN_ID + '{--ag-vc-bottom:max(6px,env(safe-area-inset-bottom,0px));}}',
            'body.outdoor-mode #' + BTN_ID + '{background:#0a0e1a;border-color:rgba(255,255,255,0.85);}',
            // Ve SVETLEM venkovnim rezimu musi byt kolecko bile, jinak je na nem
            // tmavy text (--text-color) na tmavem podkladu = necitelne (1,0:1).
            'body.light-mode.outdoor-mode #' + BTN_ID + '{background:#fff;border-color:rgba(10,14,26,0.7);color:var(--text-color,#0b0e14);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function cur() { return (typeof viewMode !== 'undefined' && LABEL[viewMode]) ? viewMode : 'map'; }

    // Srovná VŠECHNY ovladače zobrazení podle aktuálního viewMode: kroužek,
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
        // (Segment #view-seg byl z UI odstraněn — kroužek ho nahradil; zbyl jen sync radií v Nastavení.)
        try {
            var r = document.querySelector('input[name="s-view"][value="' + cur() + '"]');
            if (r && !r.checked) r.checked = true;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'view-cycle:sync'); }
    }
    window.agSyncViewControls = sync;

    function setMode(m) {
        if (typeof viewMode === 'undefined' || !LABEL[m]) return;
        if (m === cur()) { sync(); return; }
        viewMode = m;
        // BATERIE: zapamatovat volbu na priste (grafika.js). Rezim „Dělené" drzi zivou kameru
        // i mapu naraz, takze kdo si prepne do Mapy, nechce ji priste hledat znovu.
        try { if (typeof window.agRememberViewMode === 'function') window.agRememberViewMode(m); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'view-cycle:setMode'); }
        try { if (typeof applyViewMode === 'function') applyViewMode(); } catch (e) { console.warn('[view-cycle]', e); }
        sync();
        try { if (typeof visSettings !== 'undefined' && visSettings.vibrationEnabled && navigator.vibrate) navigator.vibrate(15); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'view-cycle:setMode'); }
    }

    function next() {
        if (typeof viewMode === 'undefined') return;
        setMode(ORDER[(ORDER.indexOf(cur()) + 1) % ORDER.length]);
    }

    // ---- TAŽENÍ PO KOLEČKU = přímá volba režimu ------------------------------------
    // Klepání dokola je fajn na jedno přepnutí, ale ze Split do Mapy to jsou dvě klepnutí
    // a mezitím naskočí režim, který uživatel nechtěl (a s ním na okamžik zapnutá kamera).
    // Tažením se jde rovnou: NAHORU = AR, DO STRANY = Split, DOLŮ = Mapa. Směr odpovídá
    // ceně režimu — dolů (k zemi, k mapě) je nejúspornější, nahoru (zvednout telefon
    // k očím) je plná kamera. Krátké ťuknutí bez tažení dál cykluje jako dřív.
    var SWIPE_MIN = 22;                       // px, pod tím je to ťuknutí, ne tah
    var DIR = { up: 'ar', side: 'both', down: 'map' };
    var _sx = 0, _sy = 0, _dragging = false, _swiped = false, _preview = null;

    function dirFor(dx, dy) {
        if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return null;
        if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? DIR.up : DIR.down;
        return DIR.side;
    }
    // Náhled cíle přímo na kroužku, dokud je prst dole — uživatel vidí, kam pustit,
    // a může tah ještě stáhnout zpátky pod práh a nic se nestane.
    function showPreview(m) {
        if (_preview === m) return;
        _preview = m;
        var b = document.getElementById(BTN_ID);
        if (!b) return;
        var u = b.querySelector('use'), s = b.querySelector('span');
        var t = m || cur();
        if (u) u.setAttribute('href', ICON[t]);
        if (s) s.textContent = LABEL[t];
        b.classList.toggle('ag-vc-armed', !!m);
    }
    function hint() {
        try {
            if (localStorage.getItem('agViewSwipeHint') === '1') return;
            localStorage.setItem('agViewSwipeHint', '1');
            if (typeof window.quickToast === 'function') {
                window.quickToast('Tip: tažením po kroužku přepneš rovnou — nahoru AR, do strany Split, dolů Mapa.');
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'view-cycle:hint'); }
    }

    function bindSwipe(b) {
        b.addEventListener('touchstart', function (e) {
            if (!e.touches || e.touches.length !== 1) return;
            _sx = e.touches[0].clientX; _sy = e.touches[0].clientY;
            _dragging = true; _swiped = false; _preview = null;
        }, { passive: true });

        b.addEventListener('touchmove', function (e) {
            if (!_dragging || !e.touches || !e.touches.length) return;
            // tah patří kroužku, ne stránce (jinak by pod prstem ujížděla mapa / celá appka)
            if (e.cancelable) e.preventDefault();
            showPreview(dirFor(e.touches[0].clientX - _sx, e.touches[0].clientY - _sy));
        }, { passive: false });

        b.addEventListener('touchend', function (e) {
            if (!_dragging) return;
            _dragging = false;
            var t = (e.changedTouches && e.changedTouches[0]) || null;
            var m = t ? dirFor(t.clientX - _sx, t.clientY - _sy) : null;
            _preview = null;
            b.classList.remove('ag-vc-armed');
            if (!m) { sync(); return; }           // ťuknutí → obslouží 'click' (cyklus)
            // Tah = hotovo. preventDefault potlačí syntetický 'click', ale ne na všech
            // WebKitech spolehlivě, proto k tomu ještě příznak _swiped.
            _swiped = true;
            if (e.cancelable) e.preventDefault();
            setMode(m);
            hint();
        }, { passive: false });

        b.addEventListener('touchcancel', function () {
            _dragging = false; _preview = null; _swiped = false;
            b.classList.remove('ag-vc-armed'); sync();
        }, { passive: true });

        b.addEventListener('click', function () {
            if (_swiped) { _swiped = false; return; }   // tah už režim nastavil
            next();
            hint();
        });
    }

    function ensureBtn() {
        if (document.getElementById(BTN_ID)) return;
        var b = document.createElement('button');
        b.id = BTN_ID; b.type = 'button';
        b.setAttribute('aria-label', 'Zobrazení: klepnutím dokola, tažením nahoru AR / do strany Split / dolů Mapa');
        b.title = 'Klepnutí = další zobrazení. Tažení: ↑ AR · ↔ Split · ↓ Mapa';
        b.innerHTML = '<svg class="icon"><use href="' + ICON.map + '"/></svg><span></span>';
        bindSwipe(b);
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
    document.addEventListener('click', function () { setTimeout(function () { try { sync(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'view-cycle:ensureBtn'); } }, 50); }, { passive: true });

    function tick() { try { injectStyles(); ensureBtn(); sync(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'view-cycle:tick'); } }
    function init() {
        tick();
        // viewMode mění i segment v „Více", radia v Nastavení a start appky — držet popisek aktuální
        if (!window.__agVcTimer) window.__agVcTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
