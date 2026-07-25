// ===== AR Geodet — STAVOVÝ PRUH „MŮŽU TOMU VĚŘIT?" (ODPOJITELNÁ vrstva) =========
// Neinvazivní vrstva: NEEDITUJE logika.js ani grafika.js, jen čte globály.
// Odpovídá na jedinou otázku terénu: „můžu teď uložit bod, nebo je to k ničemu?"
//
//   • Tenký pruh nahoře uprostřed se 3–4 kontrolkami: GPS · AR/sever · Data ·
//     Baterie (baterie jen kde ji prohlížeč umí — na iOS se schová).
//   • Každá kontrolka je zelená/žlutá/červená. Klepnutí na pruh otevře detail,
//     který NEříká „PDOP 4.2", ale „počkej 30 s / běž 5 m od zdi / srovnej sever".
//   • Kalibrace severu má EXPIRACI: po 30 minutách nebo 200 m od místa srovnání
//     zežloutne („srovnej znovu"). Zdroj: obalený nudgeHeadingOffset + AGPose.
//   • Nic z obrazovky NEODEBÍRÁ — existující panely zůstávají (mají své přepínače).
//     Pruh má vlastní přepínač v Nastavení → Vzhled; výchozí ZAPNUTO.
//
// Odstranění: smaž js/stavovy-pruh.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var BAR_KEY = 'agStatusBar';           // '0' = vypnuto (výchozí zapnuto)
    var CAL_KEY = 'agCalibInfo';           // {ts,lat,lng} posledního srovnání severu
    var TILE_CACHE = 'argeodet-offline-v12';   // shodné se sw.js / logika.js
    var CAL_MAX_AGE = 30 * 60 * 1000;      // 30 min
    var CAL_MAX_DIST = 200;                // m od místa srovnání

    var _bat = null;                        // {level,charging} nebo null (nepodporováno)
    var _tilesCached = null;                // null = nezjištěno, jinak boolean
    var _lastFixTs = null, _lastLat = null, _lastLng = null;

    function on() { try { return localStorage.getItem(BAR_KEY) !== '0'; } catch (e) { return true; } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function calInfo() { try { return JSON.parse(localStorage.getItem(CAL_KEY)); } catch (e) { return null; } }

    // ---- sběr stavů -----------------------------------------------------------------
    // GPS: přesnost + čerstvost fixu (změna souřadnic = fix; watchPosition v logice
    // hlásí průběžně, takže stárnutí = signál se ztratil)
    function gpsState() {
        var acc = (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy) ? currentGpsAccuracy : null;
        if (!haveUser() || acc == null) return { c: 'red', t: 'GPS —', d: 'Bez GPS fixu.', a: 'Jdi pod otevřené nebe a počkej. V budově GPS nechytneš.' };
        var age = _lastFixTs ? (Date.now() - _lastFixTs) : null;
        if (age != null && age > 30000) return { c: 'red', t: 'GPS ztracena', d: 'Poslední fix před ' + Math.round(age / 1000) + ' s.', a: 'Signál se ztratil — vyjdi zpod střechy/stromů a počkej na nový fix.' };
        if (acc <= 5 && (age == null || age <= 12000)) return { c: 'green', t: 'GPS ±' + acc.toFixed(0) + ' m', d: 'Přesnost ±' + acc.toFixed(1) + ' m, fix čerstvý.', a: 'Dobré podmínky. Pro bod nech doběhnout průměrování.' };
        if (acc <= 15) return { c: 'yellow', t: 'GPS ±' + acc.toFixed(0) + ' m', d: 'Přesnost ±' + acc.toFixed(1) + ' m.', a: 'Počkej 30–60 s v klidu, nebo poodejdi 5 m od zdí a aut. Pomůže i „Predikce signálu" v Nástrojích.' };
        return { c: 'red', t: 'GPS ±' + acc.toFixed(0) + ' m', d: 'Přesnost ±' + acc.toFixed(1) + ' m — na ukládání bodů to nestačí.', a: 'Přesuň se na volné prostranství. Pro co nejlepší bod z telefonu použij „Brutální GPS".' };
    }
    // AR / sever: resekce (AGPose) > ruční srovnání (calInfo) > nic
    function arState() {
        if (window.AGPose && window.AGPose.valid && window.AGPose.source === 'resection') {
            var age = Math.round((Date.now() - (window.AGPose.ts || 0)) / 60000);
            return { c: 'green', t: 'AR ✓ resekce', d: 'Stanovisko zakotveno resekcí' + (age ? ' před ' + age + ' min' : '') + (window.AGPose.posSigma != null ? ' (±' + window.AGPose.posSigma.toFixed(2) + ' m)' : '') + '.', a: 'Nejlepší možný stav. Když poodejdeš, kotva se sama zruší.' };
        }
        var ci = calInfo();
        var hoff = (typeof userHeadingOffset !== 'undefined') ? userHeadingOffset : 0;
        if (ci && ci.ts) {
            var ageMs = Date.now() - ci.ts;
            var dist = null;
            if (haveUser() && ci.lat != null && typeof getDistance === 'function') { try { dist = getDistance(userLat, userLng, ci.lat, ci.lng); } catch (e) {} }
            var stale = ageMs > CAL_MAX_AGE || (dist != null && dist > CAL_MAX_DIST);
            if (!stale) return { c: 'green', t: 'AR ✓', d: 'Sever srovnán před ' + Math.round(ageMs / 60000) + ' min' + (dist != null ? ' (' + Math.round(dist) + ' m odsud)' : '') + '.', a: 'Platí. Po přesunu jinam nebo za ~30 min srovnej znovu.' };
            return { c: 'yellow', t: 'AR ?', d: 'Sever byl srovnán před ' + Math.round(ageMs / 60000) + ' min' + (dist != null ? ' a ' + Math.round(dist) + ' m odsud' : '') + ' — už nemusí platit.', a: 'Otevři Nástroje → „Usadit AR" a srovnej znovu podle bodu.' };
        }
        if (hoff) return { c: 'yellow', t: 'AR ~', d: 'Sever má ruční korekci, ale nevím odkdy.', a: 'Když značky nesedí, srovnej znovu: Nástroje → „Usadit AR".' };
        return { c: 'yellow', t: 'AR kompas', d: 'Sever jede jen z kompasu telefonu (typicky ±5–15°).', a: 'Pro přesné cílení srovnej sever podle známého bodu: Nástroje → „Usadit AR".' };
    }
    function dataState() {
        var onl = (typeof navigator !== 'undefined') ? navigator.onLine : true;
        if (onl) return { c: 'green', t: 'Online', d: 'Internet je. Katastr i mapy se donačtou.', a: _tilesCached ? 'Offline mapa je uložená — výpadek nevadí.' : 'Tip: před cestou do terénu ulož mapu — menu Více → „Uložit pro offline".' };
        if (_tilesCached) return { c: 'yellow', t: 'Offline ✓', d: 'Bez internetu, ale offline mapa je uložená.', a: 'Vše důležité funguje. Katastr online se nedotáhne.' };
        return { c: 'red', t: 'Offline!', d: 'Bez internetu a bez uložené offline mapy.', a: 'Body a měření fungují dál, ale mapa bude prázdná. Příště: Více → „Uložit pro offline".' };
    }
    function batState() {
        if (!_bat) return null;
        var p = Math.round(_bat.level * 100);
        if (_bat.charging) return { c: 'green', t: '⚡' + p + '%', d: 'Baterie ' + p + ' %, nabíjí se.', a: '' };
        if (p >= 35) return { c: 'green', t: p + '%', d: 'Baterie ' + p + ' %.', a: '' };
        if (p >= 15) return { c: 'yellow', t: p + '%', d: 'Baterie ' + p + ' % — AR s kamerou žere hodně.', a: 'Přepni na „Pouze mapa" (kolečko vpravo dole), displej ztlum. Úsporný režim appka řeší sama mimo AR.' };
        return { c: 'red', t: p + '%', d: 'Baterie ' + p + ' % — dojede ti během měření.', a: 'Zapni úsporný režim telefonu, používej jen mapu a zavři AR. Data máš uložená průběžně.' };
    }

    // ---- QC do detailu (existující brána z qc-engine, jen ji ukazujeme) --------------
    function qcHtml() {
        try {
            if (!window.AGQc || !AGQc.target) return '';
            var t = AGQc.target();
            if (!t) return '';
            return '<div class="ag-sp-qc">Cílová třída zakázky: <b>' + esc(String(t)) + '</b> — appka při ukládání hlídá, jestli na ni přesnost stačí.</div>';
        } catch (e) { return ''; }
    }

    // ---- styly -----------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('ag-sp-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-sp-style';
        st.textContent = [
            '#ag-sp{position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 4px);z-index:645;',
            '  display:none;align-items:center;gap:2px;padding:4px 7px;border-radius:999px;',
            '  background:var(--glass-bg,rgba(18,22,28,0.88));border:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 2px 10px rgba(0,0,0,0.35);cursor:pointer;',
            '  font:600 11px/1 var(--font-ui,system-ui);color:var(--text-color,#eceef2);white-space:nowrap;max-width:96vw;}',
            'body.app-started #ag-sp.ag-sp-on{display:flex;}',
            '.ag-sp-seg{display:inline-flex;align-items:center;gap:4px;padding:3px 6px;border-radius:999px;}',
            '.ag-sp-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;}',
            '.ag-sp-dot.green{background:#34d399;box-shadow:0 0 5px rgba(52,211,153,0.8);}',
            '.ag-sp-dot.yellow{background:#fbbf24;box-shadow:0 0 5px rgba(251,191,36,0.8);}',
            '.ag-sp-dot.red{background:#fb7185;box-shadow:0 0 5px rgba(251,113,133,0.9);animation:agSpBlink 1.2s ease-in-out infinite;}',
            '@keyframes agSpBlink{0%,100%{opacity:1}50%{opacity:0.35}}',
            'body.outdoor-mode #ag-sp{background:#0a0e1a;border-color:rgba(255,255,255,0.85);font-size:12px;}',
            'body.light-mode.outdoor-mode #ag-sp{background:#fff;border-color:rgba(10,14,26,0.7);}',
            'body.ag-glove #ag-sp{padding:6px 9px;font-size:12.5px;}',
            // detail
            '#ag-sp-ov{position:fixed;inset:0;z-index:1000058;display:none;align-items:center;justify-content:center;background:rgba(4,8,12,0.6);}',
            '#ag-sp-ov.open{display:flex;}',
            '#ag-sp-card{width:min(94vw,440px);max-height:84vh;overflow:auto;padding:20px;border-radius:18px;',
            '  background:var(--glass-bg,rgba(14,18,24,0.97));border:1px solid var(--glass-border-strong,rgba(255,255,255,0.16));color:var(--text-color,#eceef2);}',
            '#ag-sp-card h3{margin:0 0 12px;color:var(--accent,#2f9e74);font-size:17px;}',
            '.ag-sp-row{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.07));}',
            '.ag-sp-row:last-of-type{border-bottom:none;}',
            '.ag-sp-row .ag-sp-dot{width:11px;height:11px;margin-top:3px;}',
            '.ag-sp-row b{display:block;font-size:14px;margin-bottom:2px;}',
            '.ag-sp-row p{margin:0;font-size:13px;line-height:1.45;color:var(--text-muted,#9aa1ac);}',
            '.ag-sp-row p.ag-sp-a{color:var(--text-color,#eceef2);margin-top:3px;}',
            '.ag-sp-a::before{content:"→ ";color:var(--accent,#2f9e74);font-weight:700;}',
            '.ag-sp-qc{margin-top:10px;padding:9px 12px;border-radius:10px;background:var(--surface-1,rgba(255,255,255,0.05));font-size:12.5px;color:var(--text-muted,#9aa1ac);}',
            '#ag-sp-card .ag-sp-close{width:100%;margin-top:14px;padding:12px;border:none;border-radius:12px;background:var(--surface-2,rgba(255,255,255,0.1));color:inherit;font-weight:600;cursor:pointer;}',
            'body.outdoor-mode #ag-sp-card{background:#0a0e1a;}',
            'body.light-mode.outdoor-mode #ag-sp-card{background:#fff;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- UI --------------------------------------------------------------------------
    function ensureBar() {
        var el = document.getElementById('ag-sp');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'ag-sp';
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', 'Stav měření — klepni pro rady');
        el.addEventListener('click', openDetail);
        (document.body || document.documentElement).appendChild(el);
        return el;
    }
    function seg(s, label) {
        return '<span class="ag-sp-seg"><span class="ag-sp-dot ' + s.c + '"></span>' + esc(label || s.t) + '</span>';
    }
    function renderBar() {
        var el = ensureBar();
        el.classList.toggle('ag-sp-on', on());
        if (!on()) return;
        var g = gpsState(), a = arState(), d = dataState(), b = batState();
        el.innerHTML = seg(g) + seg(a) + seg(d, d.t) + (b ? seg(b) : '');
    }
    function ensureDetail() {
        var m = document.getElementById('ag-sp-ov');
        if (!m) {
            m = document.createElement('div'); m.id = 'ag-sp-ov';
            m.innerHTML = '<div id="ag-sp-card"><h3>Můžu teď měřit?</h3><div id="ag-sp-rows"></div><button type="button" class="ag-sp-close">Zavřít</button></div>';
            m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('open'); });
            m.querySelector('.ag-sp-close').addEventListener('click', function () { m.classList.remove('open'); });
            document.body.appendChild(m);
        }
        return m;
    }
    function row(name, s) {
        if (!s) return '';
        return '<div class="ag-sp-row"><span class="ag-sp-dot ' + s.c + '"></span><span style="flex:1;min-width:0;"><b>' + esc(name) + '</b><p>' + esc(s.d) + '</p>' + (s.a ? '<p class="ag-sp-a">' + esc(s.a) + '</p>' : '') + '</span></div>';
    }
    function openDetail() {
        var m = ensureDetail();
        var rows = m.querySelector('#ag-sp-rows');
        rows.innerHTML = row('GPS', gpsState()) + row('AR / sever', arState()) + row('Data a mapa', dataState()) + row('Baterie', batState()) + qcHtml();
        m.classList.add('open');
    }

    // ---- přepínač v Nastavení → Vzhled --------------------------------------------------
    function injectSettingsToggle() {
        if (document.getElementById('ag-sp-row-set')) return;
        var tab = document.getElementById('tab-vzhled'); if (!tab) return;
        var row = document.createElement('div');
        row.className = 'st-row'; row.id = 'ag-sp-row-set';
        var lab = document.createElement('span');
        lab.className = 'st-lab';
        lab.innerHTML = 'Stavový pruh „Můžu měřit?"<small>GPS · sever · data · baterie nahoře, klepnutí poradí co dál</small>';
        var sw = document.createElement('label'); sw.className = 'st-sw';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on();
        cb.addEventListener('change', function () {
            try { localStorage.setItem(BAR_KEY, cb.checked ? '1' : '0'); } catch (e) {}
            renderBar();
        });
        var face = document.createElement('span'); face.className = 'st-sw-face';
        sw.appendChild(cb); sw.appendChild(face);
        row.appendChild(lab); row.appendChild(sw);
        tab.appendChild(row);
    }

    // ---- zdroje dat --------------------------------------------------------------------
    // časová značka srovnání severu: obal nudgeHeadingOffset (volá ho ar-calibrate,
    // ar-calib2, orient-point…) — uloží ts + polohu, od kterých se počítá expirace
    function wrapCalib() {
        if (window.__agSpCalWrapped || typeof window.nudgeHeadingOffset !== 'function') return;
        var orig = window.nudgeHeadingOffset;
        window.nudgeHeadingOffset = function () {
            var r = orig.apply(this, arguments);
            try { localStorage.setItem(CAL_KEY, JSON.stringify({ ts: Date.now(), lat: (haveUser() ? userLat : null), lng: (haveUser() ? userLng : null) })); } catch (e) {}
            return r;
        };
        window.__agSpCalWrapped = true;
    }
    function watchBattery() {
        if (!navigator.getBattery) return;
        navigator.getBattery().then(function (b) {
            function upd() { _bat = { level: b.level, charging: b.charging }; renderBar(); }
            b.addEventListener('levelchange', upd);
            b.addEventListener('chargingchange', upd);
            upd();
        }).catch(function () {});
    }
    function checkTiles() {
        if (typeof caches === 'undefined') { _tilesCached = false; return; }
        caches.open(TILE_CACHE).then(function (c) { return c.keys(); })
            .then(function (keys) { _tilesCached = keys.length > 10; })
            .catch(function () { _tilesCached = false; });
    }
    function trackFix() {
        if (!haveUser()) return;
        if (userLat !== _lastLat || userLng !== _lastLng) { _lastLat = userLat; _lastLng = userLng; _lastFixTs = Date.now(); }
    }

    // ---- život modulu --------------------------------------------------------------------
    var _n = 0;
    function tick() {
        try {
            injectStyles();
            wrapCalib();
            injectSettingsToggle();
            trackFix();
            renderBar();
            if ((_n++ % 15) === 0) checkTiles();   // ~1× za 30 s
        } catch (e) {}
    }
    function init() {
        injectStyles();
        watchBattery();
        checkTiles();
        window.addEventListener('online', renderBar);
        window.addEventListener('offline', renderBar);
        if (!window.__agSpTimer) window.__agSpTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 2000);
        tick();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    window.AGStatusBar = { open: openDetail, refresh: renderBar };
})();
