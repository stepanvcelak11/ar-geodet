// ===== AR Geodet — STABILITA KOMPASU (UI/UX vrstva) ============================
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu js/vylepseni.js: čte globál currentHeading
// za běhu, NEEDITUJE logika.js ani grafika.js.
//
// Co dělá:
//   Z currentHeading vzorkuje v klouzavém okně ~5 s kruhový rozkmit (zvládá 359°→0°)
//   a počítá z něj skóre stability 0–100 % (malý rozkmit = vysoké). Zobrazuje malý
//   "semafor" (zelená ≥70 · oranžová 40–70 · červená <40), jen když appStarted.
//   - VYBLEDÁVÁ s ostatním HUD (zrcadlí třídu .ui-faded z #compass-debug).
//   - Polohu i VELIKOST si uživatel nastaví: DLOUHÝ STISK → režim úprav (táhni
//     pro přesun, −/+ pro velikost, ✓ hotovo). Uloží se do localStorage 'agCstabUI'.
//
// Odstranění: smaž js/compass-stability.js + css/compass-stability.css a řádky v
// index.html / sw.js. Aplikace pak funguje přesně jako předtím.
// ================================================================================
(function () {
    'use strict';

    var WIN_MS = 5000;       // délka klouzavého okna
    var SAMPLE_MS = 200;     // perioda vzorkování
    var EL_ID = 'ag-cstab';
    var LS_UI = 'agCstabUI';

    var samples = [];
    var el = null, timer = null, lastScore = null;

    // stav úprav polohy/velikosti
    var ui = { scale: 1, left: null, top: null };
    var editing = false, dragging = false, moved = false;
    var lpTimer = null, dragDX = 0, dragDY = 0, downX = 0, downY = 0;

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
    function circStats(arr) {
        var n = arr.length;
        if (n < 2) return null;
        var sx = 0, sy = 0, rad = Math.PI / 180;
        for (var i = 0; i < n; i++) { var a = arr[i].h * rad; sx += Math.cos(a); sy += Math.sin(a); }
        sx /= n; sy /= n;
        var R = Math.sqrt(sx * sx + sy * sy);
        R = Math.max(1e-9, Math.min(1, R));
        return { R: R, spread: Math.sqrt(-2 * Math.log(R)) / rad, n: n };
    }
    function scoreFromSpread(spread) {
        var s = 100 * (1 - (spread - 1) / 14);
        return Math.round(Math.max(0, Math.min(100, s)));
    }
    function colorFor(score) { return score >= 70 ? 'good' : (score >= 40 ? 'warn' : 'bad'); }
    function labelFor(score) { return score >= 70 ? 'Kompas klidný' : (score >= 40 ? 'Kompas kolísá' : 'Kompas neklidný'); }

    // ---- uložení/aplikace polohy a velikosti ----------------------------------
    function loadUI() {
        try {
            var s = localStorage.getItem(LS_UI);
            if (!s) return;
            var o = JSON.parse(s);
            if (o && typeof o === 'object') {
                if (typeof o.scale === 'number' && isFinite(o.scale)) ui.scale = Math.max(0.6, Math.min(2.4, o.scale));
                if (typeof o.left === 'number' && typeof o.top === 'number') { ui.left = o.left; ui.top = o.top; }
            }
        } catch (e) {}
    }
    function saveUI() {
        try { localStorage.setItem(LS_UI, JSON.stringify(ui)); } catch (e) {}
    }
    function applyUI() {
        if (!el) return;
        el.style.transform = 'scale(' + ui.scale + ')';
        if (ui.left != null && ui.top != null) {
            el.style.left = ui.left + 'px'; el.style.top = ui.top + 'px';
            el.style.right = 'auto'; el.style.bottom = 'auto';
            el.style.transformOrigin = 'top left';
        } else {
            el.style.transformOrigin = 'top right';
        }
    }
    function clampToScreen() {
        try {
            var r = el.getBoundingClientRect();
            var maxL = window.innerWidth - r.width - 4, maxT = window.innerHeight - r.height - 4;
            if (ui.left != null) ui.left = Math.max(4, Math.min(maxL, ui.left));
            if (ui.top != null) ui.top = Math.max(4, Math.min(maxT, ui.top));
        } catch (e) {}
    }

    // ---- UI -------------------------------------------------------------------
    function build() {
        if (el) return el;
        if (document.getElementById(EL_ID)) { el = document.getElementById(EL_ID); return el; }
        el = document.createElement('div');
        el.id = EL_ID;
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'off');
        el.title = 'Stabilita kompasu — dlouhý stisk pro přesun/velikost';
        el.innerHTML =
            '<span class="ag-cstab-dot"></span>' +
            '<span class="ag-cstab-val">—</span>' +
            '<span class="ag-cstab-edit">' +
            '  <button type="button" data-act="dec" aria-label="Zmenšit">−</button>' +
            '  <button type="button" data-act="inc" aria-label="Zvětšit">+</button>' +
            '  <button type="button" data-act="done" aria-label="Hotovo">✓</button>' +
            '</span>';
        document.body.appendChild(el);
        loadUI(); applyUI();
        wireEdit();
        mirrorFade();
        return el;
    }

    // ---- vyblednutí: zrcadli .ui-faded z #compass-debug -----------------------
    function syncFade() {
        if (!el) return;
        if (editing) { el.classList.remove('ui-faded'); return; }
        try {
            var src = document.getElementById('compass-debug');
            el.classList.toggle('ui-faded', !!(src && src.classList.contains('ui-faded')));
        } catch (e) {}
    }
    function mirrorFade() {
        try {
            var src = document.getElementById('compass-debug');
            if (!src || typeof MutationObserver === 'undefined') return;
            var mo = new MutationObserver(syncFade);
            mo.observe(src, { attributes: true, attributeFilter: ['class'] });
            syncFade();
        } catch (e) {}
    }

    // ---- režim úprav (přesun + velikost) --------------------------------------
    function enterEdit() {
        editing = true;
        if (el) { el.classList.add('editing'); el.classList.remove('ui-faded'); }
        try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) {}
    }
    function exitEdit() {
        editing = false;
        if (el) el.classList.remove('editing');
        clampToScreen(); applyUI(); saveUI(); syncFade();
    }
    function setScale(d) {
        ui.scale = Math.max(0.6, Math.min(2.4, Math.round((ui.scale + d) * 100) / 100));
        applyUI(); clampToScreen(); applyUI(); saveUI();
    }

    function wireEdit() {
        if (!el) return;
        // tlačítka v editoru
        el.addEventListener('click', function (e) {
            var b = e.target.closest('[data-act]'); if (!b) return;
            e.preventDefault(); e.stopPropagation();
            var a = b.getAttribute('data-act');
            if (a === 'dec') setScale(-0.15);
            else if (a === 'inc') setScale(0.15);
            else if (a === 'done') exitEdit();
        });

        el.addEventListener('pointerdown', function (e) {
            if (e.target.closest('[data-act]')) return; // klik na tlačítko řeší click
            downX = e.clientX; downY = e.clientY; moved = false;
            if (editing) {
                // začni táhnout
                dragging = true;
                var r = el.getBoundingClientRect();
                dragDX = e.clientX - r.left; dragDY = e.clientY - r.top;
                try { el.setPointerCapture(e.pointerId); } catch (er) {}
                e.preventDefault();
            } else {
                // dlouhý stisk → režim úprav
                if (lpTimer) clearTimeout(lpTimer);
                lpTimer = setTimeout(function () { lpTimer = null; enterEdit(); }, 450);
            }
        });

        el.addEventListener('pointermove', function (e) {
            if (Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8) {
                moved = true;
                if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } // pohyb ruší dlouhý stisk
            }
            if (dragging) {
                ui.left = e.clientX - dragDX; ui.top = e.clientY - dragDY;
                el.style.left = ui.left + 'px'; el.style.top = ui.top + 'px';
                el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.transformOrigin = 'top left';
                e.preventDefault();
            }
        });

        function up(e) {
            if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
            if (dragging) {
                dragging = false;
                try { el.releasePointerCapture(e.pointerId); } catch (er) {}
                clampToScreen(); applyUI(); saveUI();
            }
        }
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);

        // klepnutí mimo editor → ukončit úpravy
        document.addEventListener('pointerdown', function (e) {
            if (editing && el && !el.contains(e.target)) exitEdit();
        }, true);
    }

    // ---- render ---------------------------------------------------------------
    function render() {
        try {
            var live = isLive();
            if (!el) { if (!live) return; build(); }
            if (!el) return;
            if (!live && !editing) { el.classList.remove('show'); return; }

            var t = now();
            while (samples.length && (t - samples[0].t) > WIN_MS) samples.shift();

            var st = circStats(samples);
            if (!st || st.n < 4) {
                el.classList.add('show');
                el.classList.remove('good', 'warn', 'bad');
                el.classList.add('init');
                var v0 = el.querySelector('.ag-cstab-val'); if (v0) v0.textContent = '…';
                return;
            }
            var score = scoreFromSpread(st.spread);
            if (lastScore != null) score = Math.round(lastScore * 0.6 + score * 0.4);
            lastScore = score;

            el.classList.add('show');
            el.classList.remove('init', 'good', 'warn', 'bad');
            el.classList.add(colorFor(score));
            var v = el.querySelector('.ag-cstab-val'); if (v) v.textContent = score + '%';
            el.title = labelFor(score) + ' · ' + score + '% (rozkmit ±' + st.spread.toFixed(1) + '°) · dlouhý stisk = úpravy';
        } catch (e) { /* fail-silent */ }
    }

    function sample() {
        try {
            if (!isLive()) { samples.length = 0; lastScore = null; render(); return; }
            var h = readHeading();
            if (h != null) samples.push({ t: now(), h: h });
            render();
        } catch (e) {}
    }
    function start() { try { if (!timer) timer = setInterval(sample, SAMPLE_MS); } catch (e) {} }

    function init() {
        try {
            if (!document.getElementById(EL_ID)) build();
            else { el = document.getElementById(EL_ID); }
            start(); render();
        } catch (e) {}
    }

    try {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
        window.addEventListener('load', function () { setTimeout(init, 300); });
        window.addEventListener('resize', function () { try { clampToScreen(); applyUI(); } catch (e) {} });
    } catch (e) {}
})();
