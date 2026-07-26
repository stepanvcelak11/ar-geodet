// ===== AR Geodet — SEMAFOR DŮVĚRY POLOHY (ODPOJITELNÁ vrstva) ===================
// Zamrzlý GPS fix se dřív nedal poznat: watchPosition prostě přestane doručovat
// (tunel, budova, iOS suspend), userLat/currentGpsAccuracy drží poslední hodnotu
// a AR i měření tiše jedou ze STARÉ polohy. Tenhle modul čte window.AGFix
// (timestamp posledního fixu, plní logika.js) a:
//   • drží stav ČERSTVÁ (<6 s) / STARÁ (6–30 s) / ZTRACENÁ (>30 s nebo chyba GPS)
//     + zvlášť OFFLINE (navigator.onLine) — třídy na <body>
//   • ukazuje nenápadný pruh pod horním HUD, jen když něco není v pořádku
//   • při ZTRACENÉ ztlumí AR overlay do šeda (ať je vidět, že značky nejsou živé)
//   • window.agFixState() pro ostatní moduly (brány ukládání)
// Bránu ukládání bodu z GPS průměru drží přímo logika.js (fillAveragedGPS).
//
// NEPLETAT s podobně pojmenovanými vrstvami:
//   • js/gps-semafor.js  — skóre MÍSTA (multipath, geometrie družic) PŘED měřením, dlaždice
//   • js/gps-warn.js     — varování na slabou PŘESNOST (±m) z posledního fixu
//   • tenhle modul       — ČERSTVOST fixu (nechodí-li fixy, čísla i AR lžou beze zvuku)
// Odstranění: smaž js/gps-trust.js + řádek <script> v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agGpsTrustInit) return;
    window.__agGpsTrustInit = true;

    var FRESH_MS = 6000, LOST_MS = 30000;
    var STYLE_ID = 'ag-gpst-style', BAR_ID = 'ag-gpst-bar';
    var _lastState = null;
    var _dismissed = null;   // klic stavu ('off'/'stale'/'lost'), ktery uzivatel zavrel krizkem

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + BAR_ID + '{position:fixed;left:50%;transform:translateX(-50%);',
            '  top:calc(env(safe-area-inset-top,0px) + 44px);z-index:12000;display:none;',
            '  align-items:center;gap:7px;padding:6px 14px;border-radius:999px;',
            '  font:600 12.5px/1.2 var(--font-ui,system-ui),sans-serif;color:#fff;',
            '  border:1px solid rgba(255,255,255,0.22);box-shadow:0 4px 16px rgba(0,0,0,0.45);',
            '  pointer-events:none;max-width:88vw;text-align:center;}',
            '#' + BAR_ID + '.show{display:flex;}',
            '#' + BAR_ID + ' .dot{width:9px;height:9px;border-radius:50%;flex:0 0 9px;background:#fff;}',
            // krizek na zavreni: jediny klikaci prvek (rodic ma pointer-events:none, at pruh neblokuje AR)
            '#' + BAR_ID + ' .x{pointer-events:auto;appearance:none;-webkit-appearance:none;border:0;margin:-2px -6px -2px 0;',
            '  background:rgba(255,255,255,0.18);color:#fff;width:22px;height:22px;border-radius:50%;flex:0 0 22px;',
            '  font:700 14px/22px var(--font-ui,system-ui),sans-serif;padding:0;cursor:pointer;text-align:center;}',
            'body.ag-fix-stale #' + BAR_ID + '{background:rgba(146,94,7,0.92);}',
            'body.ag-fix-lost #' + BAR_ID + '{background:rgba(140,28,28,0.94);}',
            'body.ag-fix-lost #' + BAR_ID + ' .dot{animation:ag-gpst-pulse 1s infinite;}',
            'body.ag-net-off:not(.ag-fix-stale):not(.ag-fix-lost) #' + BAR_ID + '{background:rgba(50,58,70,0.92);}',
            '@keyframes ag-gpst-pulse{0%,100%{opacity:1;}50%{opacity:0.25;}}',
            // okraj panelu presnosti podle stavu (vidi ho i kdo si pruhu nevsimne)
            'body.ag-fix-stale #gps-avg{border-color:rgba(235,170,50,0.85)!important;}',
            'body.ag-fix-lost #gps-avg{border-color:rgba(239,68,68,0.95)!important;}',
            // ztracena poloha: AR znacky zsednou — jasny signal, ze NEJSOU zive
            'body.ag-fix-lost #ar-overlay{filter:grayscale(1) brightness(0.8);opacity:0.55;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function ensureBar() {
        var b = document.getElementById(BAR_ID);
        if (!b) {
            b = document.createElement('div');
            b.id = BAR_ID;
            b.innerHTML = '<span class="dot"></span><span class="txt"></span><button type="button" class="x" aria-label="Zavřít upozornění">×</button>';
            b.querySelector('.x').addEventListener('click', function () {
                _dismissed = b.getAttribute('data-key') || null;
                b.classList.remove('show');
            });
            document.body.appendChild(b);
        }
        return b;
    }

    function computeState() {
        var fx = window.AGFix;
        if (!fx || !fx.ts) return { state: (fx && fx.err) ? 'lost' : 'unknown', ageMs: null, acc: null };
        var age = Date.now() - fx.ts;
        // chyba GPS novejsi nez posledni fix = fixy prestaly chodit kvuli chybe
        if (fx.err && fx.errTs && fx.errTs > fx.ts && age > FRESH_MS) return { state: 'lost', ageMs: age, acc: fx.acc };
        if (age > LOST_MS) return { state: 'lost', ageMs: age, acc: fx.acc };
        if (age > FRESH_MS) return { state: 'stale', ageMs: age, acc: fx.acc };
        return { state: 'fresh', ageMs: age, acc: fx.acc };
    }
    window.agFixState = computeState;

    function fmtAge(ms) {
        if (ms == null) return '';
        var s = Math.round(ms / 1000);
        return s < 120 ? (s + ' s') : (Math.round(s / 60) + ' min');
    }

    function tick() {
        try {
            injectStyles();
            var started = document.body && document.body.classList.contains('app-started');
            var off = (typeof navigator.onLine === 'boolean') ? !navigator.onLine : false;
            var st = computeState();
            document.body.classList.toggle('ag-net-off', off);
            document.body.classList.toggle('ag-fix-stale', started && st.state === 'stale');
            document.body.classList.toggle('ag-fix-lost', started && st.state === 'lost');
            var bar = ensureBar();
            var txt = null, key = null;
            if (started && st.state === 'lost') { key = 'lost'; txt = 'GPS ztracena ' + (st.ageMs != null ? fmtAge(st.ageMs) : '') + ' — poloha i AR ukazují POSLEDNÍ známé místo'; }
            else if (started && st.state === 'stale') { key = 'stale'; txt = 'GPS bez čerstvého fixu ' + fmtAge(st.ageMs) + ' — poloha může být posunutá'; }
            else if (started && off) { key = 'off'; txt = 'Offline — mapa a katastr jen z uložených dat, měření GPS funguje'; }
            // krizek zavre pruh pro AKTUALNI stav; kdyz vse pomine, dismiss se resetuje,
            // aby se pristi problem zase ukazal (jina zavada nez zavrena se ukaze hned)
            if (!key) _dismissed = null;
            bar.setAttribute('data-key', key || '');
            if (txt && key !== _dismissed) { bar.querySelector('.txt').textContent = txt; bar.classList.add('show'); }
            else bar.classList.remove('show');
            // prechodova hlaska jen pri zhorseni (fresh->stale/lost), at to nepipa porad
            if (started && _lastState === 'fresh' && st.state === 'lost' && typeof window.quickToast === 'function') {
                try { quickToast('Ztracen signál GPS — měření pozastavte, než se vrátí čerstvý fix.'); } catch (e) {}
            }
            if (started) _lastState = st.state;
        } catch (e) {}
    }

    function init() {
        tick();
        if (!window.__agGpstTimer) window.__agGpstTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1000);
        window.addEventListener('online', tick);
        window.addEventListener('offline', tick);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
