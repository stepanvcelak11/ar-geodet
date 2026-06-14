// ===== AR Geodet — STABILITA KOMPASU (UI/UX vrstva) ============================
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu js/vylepseni.js: čte globál currentHeading
// za běhu, NEEDITUJE logika.js ani grafika.js. Načítá se jako jeden z POSLEDNÍCH skriptů.
//
// Co dělá:
//   Z currentHeading vzorkuje v klouzavém okně ~5 s kruhový rozkmit (správně přes
//   přechod 359°→0°) a počítá z něj skóre stability 0–100 % (malý rozkmit = vysoké).
//   Zobrazuje malý "semafor" poblíž azimutu (HUD #compass-debug):
//     zelená ≥ 70 · oranžová 40–70 · červená < 40.
//   Indikátor je vidět jen když appStarted (běží AR/kompas).
//
// Odstranění: smaž js/compass-stability.js + css/compass-stability.css a řádky se
// značkou v index.html / sw.js. Aplikace pak funguje přesně jako předtím.
// ================================================================================
(function () {
    'use strict';

    var WIN_MS = 5000;       // délka klouzavého okna
    var SAMPLE_MS = 200;     // perioda vzorkování (~25 vzorků v okně)
    var EL_ID = 'ag-cstab';

    var samples = [];        // { t: ms, h: deg }
    var el = null, timer = null, lastScore = null;

    // ---- pomocné --------------------------------------------------------------
    function now() {
        try { return (performance && performance.now) ? performance.now() : Date.now(); }
        catch (e) { return Date.now(); }
    }
    function isLive() {
        try { return (typeof appStarted !== 'undefined') && !!appStarted; } catch (e) { return false; }
    }
    function readHeading() {
        try {
            if (typeof currentHeading === 'undefined') return null;
            var h = currentHeading;
            if (h == null || !isFinite(h)) return null;
            return ((h % 360) + 360) % 360;
        } catch (e) { return null; }
    }

    // Kruhový rozptyl vzorků headingu (zvládá zlom 359°→0°): vrací { spread, R }.
    // R = délka výsledného vektoru (1 = naprosto stabilní), spread = kruhová
    // směrodatná odchylka ve stupních (sqrt(-2 ln R) v rad).
    function circStats(arr) {
        var n = arr.length;
        if (n < 2) return null;
        var sx = 0, sy = 0, rad = Math.PI / 180;
        for (var i = 0; i < n; i++) {
            var a = arr[i].h * rad;
            sx += Math.cos(a);
            sy += Math.sin(a);
        }
        sx /= n; sy /= n;
        var R = Math.sqrt(sx * sx + sy * sy);
        R = Math.max(1e-9, Math.min(1, R));
        var spread = Math.sqrt(-2 * Math.log(R)) / rad; // ve stupních
        return { R: R, spread: spread, n: n };
    }

    // Skóre 0–100 z kruhové směr. odchylky ve stupních.
    // Kalibrace: ~1° rozkmit ≈ 100 %, ~15° ≈ 0 %. Hladký, monotónní přechod.
    function scoreFromSpread(spread) {
        var s = 100 * (1 - (spread - 1) / 14);
        if (s > 100) s = 100;
        if (s < 0) s = 0;
        return Math.round(s);
    }

    function colorFor(score) {
        if (score >= 70) return 'good';
        if (score >= 40) return 'warn';
        return 'bad';
    }
    function labelFor(score) {
        if (score >= 70) return 'Kompas klidný';
        if (score >= 40) return 'Kompas kolísá';
        return 'Kompas neklidný';
    }

    // ---- UI -------------------------------------------------------------------
    function build() {
        if (el) return el;
        if (document.getElementById(EL_ID)) { el = document.getElementById(EL_ID); return el; }
        el = document.createElement('div');
        el.id = EL_ID;
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'off');
        el.title = 'Stabilita kompasu — malý rozkmit = vyšší %';
        el.innerHTML =
            '<span class="ag-cstab-dot"></span>' +
            '<span class="ag-cstab-val">—</span>';
        // umísti vedle azimutu (HUD); CSS to ukotví vpravo nahoře pod #compass-debug
        document.body.appendChild(el);
        return el;
    }

    function render() {
        try {
            var live = isLive();
            if (!el) {
                if (!live) return;        // dokud appka neběží, nic nestaví
                build();
            }
            if (!el) return;

            if (!live) { el.classList.remove('show'); return; }

            // ořež okno
            var t = now();
            while (samples.length && (t - samples[0].t) > WIN_MS) samples.shift();

            var st = circStats(samples);
            if (!st || st.n < 4) {
                // málo dat (kompas se právě rozjíždí) — ukaž neutrálně, bez čísla
                el.classList.add('show');
                el.classList.remove('good', 'warn', 'bad');
                el.classList.add('init');
                var v0 = el.querySelector('.ag-cstab-val');
                if (v0) v0.textContent = '…';
                el.title = 'Stabilita kompasu — sbírám data';
                return;
            }

            var score = scoreFromSpread(st.spread);
            // jemné vyhlazení, ať číslo neposkakuje o jednotky
            if (lastScore != null) score = Math.round(lastScore * 0.6 + score * 0.4);
            lastScore = score;

            var cls = colorFor(score);
            el.classList.add('show');
            el.classList.remove('init', 'good', 'warn', 'bad');
            el.classList.add(cls);
            var v = el.querySelector('.ag-cstab-val');
            if (v) v.textContent = score + '%';
            el.title = labelFor(score) + ' · stabilita ' + score + '% (rozkmit ±' + st.spread.toFixed(1) + '°)';
        } catch (e) { /* fail-silent */ }
    }

    function sample() {
        try {
            if (!isLive()) { samples.length = 0; lastScore = null; render(); return; }
            var h = readHeading();
            if (h != null) samples.push({ t: now(), h: h });
            render();
        } catch (e) { /* fail-silent */ }
    }

    function start() {
        try {
            if (timer) return;
            timer = setInterval(sample, SAMPLE_MS);
        } catch (e) { /* fail-silent */ }
    }

    function init() {
        try {
            // idempotentní: pokud už indikátor existuje, jen se ujisti, že běží smyčka
            if (!document.getElementById(EL_ID)) build();
            else el = document.getElementById(EL_ID);
            start();
            render();
        } catch (e) { /* fail-silent */ }
    }

    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
        // Druhý průchod po plném loadu — HUD prvky/globály vznikají později.
        window.addEventListener('load', function () { setTimeout(init, 300); });
    } catch (e) { /* fail-silent */ }
})();
