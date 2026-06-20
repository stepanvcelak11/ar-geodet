// ===== AR Geodet — PŘESUN + VELIKOST HUD PANELŮ (ODPOJITELNÁ vrstva) =========
// Neinvazivní. NEEDITUJE logika.js ani grafika.js. Dává panelům „Průměrování GPS"
// (#gps-avg) a „Azimut" (#compass-debug) stejnou možnost jako tlačítku Srovnat sever:
//   • TÁHNUTÍM prstem se panel přesune (poloha se pamatuje),
//   • PODRŽENÍM se otevře posuvník VELIKOSTI 50–150 % (pamatuje se),
//   • krátký TAP funguje jako dřív (azimut otevře nastavení kompasu).
// Poloha/velikost se ukládají do localStorage GLOBÁLNĚ (napříč zakázkami).
// Ztlumení po nečinnosti řeší appka sama (panely jsou v jejím fade seznamu).
//
// Odstranění: smaž js/hud-arrange.js + řádek <script> v index.html (a v sw.js).
// ============================================================================
(function () {
    'use strict';

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

    var NAMES = { 'gps-avg': 'Přesnost GPS (panel)', 'compass-debug': 'Azimut (panel)' };

    // ---- styl (skleněný HUD, stejný jazyk jako zbytek) ------------------------
    function injectStyle() {
        if (document.getElementById('aghud-style')) return;
        var s = document.createElement('style');
        s.id = 'aghud-style';
        s.textContent =
            '.agarr-dragging{transition:none !important;cursor:grabbing;opacity:1 !important;}'
            + '#aghud-size{position:fixed;left:50%;bottom:max(24px,calc(env(safe-area-inset-bottom,0px) + 16px));'
            + 'transform:translateX(-50%);z-index:100046;display:none;width:min(340px,90vw);padding:14px 16px 16px;'
            + 'border-radius:var(--r-lg,18px);border:1px solid var(--glass-border,rgba(255,255,255,.18));'
            + 'background:var(--glass-bg,rgba(16,20,26,.82));-webkit-backdrop-filter:blur(14px) saturate(140%);'
            + 'backdrop-filter:blur(14px) saturate(140%);box-shadow:var(--shadow-2,0 10px 30px rgba(0,0,0,.55)),inset 0 1px 0 rgba(255,255,255,.05);'
            + 'color:var(--text,#eef2f6);}'
            + '#aghud-size.on{display:block;}'
            + '#aghud-size .aghud-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:10px;}'
            + '#aghud-size .aghud-row span{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--accent,#34d399);}'
            + '#aghud-size .aghud-row b{color:var(--text,#eef2f6);font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;font-size:14px;font-weight:700;}'
            + '#aghud-size input[type="range"]{width:100%;accent-color:var(--accent,#34d399);}'
            + '#aghud-size .aghud-hint{font-size:11.5px;opacity:.72;margin:8px 0 12px;line-height:1.4;}'
            + '#aghud-size .btn{width:100%;}';
        document.head.appendChild(s);
    }

    // ---- sdílený editor velikosti --------------------------------------------
    var _curEl = null, _curKey = null;
    function ensureEditor() {
        if (document.getElementById('aghud-size')) return;
        injectStyle();
        var el = document.createElement('div');
        el.id = 'aghud-size';
        el.innerHTML =
            '<div class="aghud-row"><span id="aghud-name">Velikost</span><b id="aghud-val"></b></div>'
            + '<input type="range" id="aghud-range" min="50" max="150" step="5">'
            + '<div class="aghud-hint">Táhni panel prstem = přesun. Tady měň velikost.</div>'
            + '<button class="btn" id="aghud-done">Hotovo</button>';
        document.body.appendChild(el);
        var rng = el.querySelector('#aghud-range');
        rng.addEventListener('input', function () {
            if (!_curEl) return;
            var s = parseInt(rng.value, 10) / 100;
            setScale(_curEl, _curKey, s);
            var v = document.getElementById('aghud-val'); if (v) v.textContent = rng.value + ' %';
        });
        el.querySelector('#aghud-done').addEventListener('click', closeEditor);
    }
    function openEditor(target, key, min, max) {
        ensureEditor();
        _curEl = target; _curKey = key;
        var el = document.getElementById('aghud-size');
        var rng = el.querySelector('#aghud-range');
        rng.min = min || 50; rng.max = max || 150;
        var cur = Math.round(getScale(key) * 100);
        rng.value = Math.max(rng.min, Math.min(rng.max, cur));
        var nm = document.getElementById('aghud-name'); if (nm) nm.textContent = 'Velikost — ' + (NAMES[key] || key);
        var v = document.getElementById('aghud-val'); if (v) v.textContent = rng.value + ' %';
        el.classList.add('on');
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
    }
    function closeEditor() {
        var el = document.getElementById('aghud-size'); if (el) el.classList.remove('on');
        _curEl = null; _curKey = null;
    }

    // ---- poloha / velikost ----------------------------------------------------
    function clampInto(el, x, y) {
        var r = el.getBoundingClientRect();
        var w = r.width || 140, h = r.height || 40, m = 6;
        var maxX = Math.max(m, window.innerWidth - w - m), maxY = Math.max(m, window.innerHeight - h - m);
        x = Math.max(m, Math.min(maxX, x));
        y = Math.max(m, Math.min(maxY, y));
        el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
    }
    function savePos(el, key) {
        var x = parseFloat(el.style.left), y = parseFloat(el.style.top);
        if (isFinite(x) && isFinite(y)) lsSet('agHud_' + key + '_pos', JSON.stringify({ x: x, y: y }));
    }
    function applyPos(el, key) {
        var raw = lsGet('agHud_' + key + '_pos'); if (!raw) return;
        try { var p = JSON.parse(raw); if (p && isFinite(p.x) && isFinite(p.y)) clampInto(el, p.x, p.y); } catch (e) {}
    }
    function getScale(key) {
        var s = parseFloat(lsGet('agHud_' + key + '_scale'));
        if (!isFinite(s)) s = 1;
        return Math.max(0.5, Math.min(1.5, s));
    }
    function setScale(el, key, s) {
        s = Math.max(0.5, Math.min(1.5, s));
        el.style.transform = 'scale(' + s + ')';      // přebije CSS scale(var(--menu-scale))
        lsSet('agHud_' + key + '_scale', String(s));
        clampInto(el, parseFloat(el.style.left) || el.getBoundingClientRect().left, parseFloat(el.style.top) || el.getBoundingClientRect().top);
    }
    function applyScale(el, key) {
        if (lsGet('agHud_' + key + '_scale') == null) return; // bez uloženého necháme globální --menu-scale
        el.style.transform = 'scale(' + getScale(key) + ')';
    }

    // ---- aktivace na konkrétním panelu ---------------------------------------
    function enable(el, opts) {
        if (!el || el._agArr) return; el._agArr = true;
        opts = opts || {};
        var key = opts.key || el.id, min = opts.min || 50, max = opts.max || 150;
        if (el.id === 'gps-avg') el.style.pointerEvents = 'auto'; // jinak ho nejde chytit (má none)
        applyPos(el, key);
        applyScale(el, key);
        var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0, lp = null, pid = null, suppress = false;
        el.style.touchAction = 'none';
        el.addEventListener('pointerdown', function (e) {
            if (e.button != null && e.button !== 0) return;
            dragging = true; moved = false; suppress = false; pid = e.pointerId;
            sx = e.clientX; sy = e.clientY;
            var r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
            try { el.setPointerCapture(e.pointerId); } catch (err) {}
            if (lp) clearTimeout(lp);
            lp = setTimeout(function () { if (!moved && dragging) { suppress = true; openEditor(el, key, min, max); } }, 550);
        });
        el.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            var dx = e.clientX - sx, dy = e.clientY - sy;
            if (!moved && (dx * dx + dy * dy) > 49) { moved = true; suppress = true; if (lp) { clearTimeout(lp); lp = null; } el.classList.add('agarr-dragging'); }
            if (moved) { e.preventDefault(); clampInto(el, ox + dx, oy + dy); }
        }, { passive: false });
        function up() {
            if (!dragging) return; dragging = false;
            if (lp) { clearTimeout(lp); lp = null; }
            try { el.releasePointerCapture(pid); } catch (err) {}
            if (moved) { moved = false; el.classList.remove('agarr-dragging'); savePos(el, key); }
        }
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        // po přesunu/podržení potlač následný klik (ať se omylem neotevře nastavení kompasu)
        el.addEventListener('click', function (e) { if (suppress) { e.stopPropagation(); e.preventDefault(); suppress = false; } }, true);
    }
    window.AGArrange = { enable: enable, openEditor: openEditor };

    // ---- init — idempotentní; panely vznikají v index.html, jen je zapojíme ---
    function init() {
        try {
            injectStyle();
            ['gps-avg', 'compass-debug'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) enable(el, { key: id, min: 50, max: 150 });
            });
        } catch (e) { try { console.warn('[hud-arrange] init', e); } catch (e2) {} }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 350); });
})();
