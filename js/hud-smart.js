// ===== AR Geodet — CHYTRÝ HUD (Design D, ODPOJITELNÁ vrstva) ===================
// Konsoliduje přeplácaný HUD do JEDNÉ kontextové karty + 3 stavových teček
// (GPS / kompas / kalibrace). NEEDITUJE logika.js ani grafika.js — jen čte
// globály a za běhu potlačuje původní roztroušené indikátory.
//
// Co dělá:
//   • Kontextová karta (nahoře uprostřed): když navádíš na zvýrazněný bod
//     (highlightedPointId), ukáže VZDÁLENOST + směrový šíp + azimut k němu;
//     jinak ukáže ±přesnost + počet družic + azimut.
//   • 3 tečky: GPS (dle accuracy), kompas (headingReliable), kalibrace
//     (window.agRefShift.on). Ťuk na tečku otevře příslušný modál.
//   • Vyblednutí po 3 s nečinnosti (ťuknutím se probudí).
//   • Podržení karty → režim úprav: tažení (posun) + −/＋ (velikost) + ✓.
//     Poloha a velikost se pamatují v localStorage 'agHudSmart'.
//   • Potlačí původní #info, #compass-debug, #gps-warn, #agcal-fab, #ag-cstab.
//
// Vypnout za běhu: window.agHudSmartOff().  Trvalé odstranění: smaž tento soubor
// + css/hud-smart.css a jejich řádky v index.html (a sw.js) — vše se vrátí.
// ================================================================================
(function () {
    'use strict';

    var LS = 'agHudSmart';
    var SUPPRESS = ['info', 'compass-debug', 'gps-warn', 'agcal-fab', 'ag-cstab'];
    var FADE_MS = 3000;
    var ACC_OK = 7, ACC_WARN = 12;          // prahy kvality (shodné s appkou)

    var card = null, bigEl, subEl, chevEl, dotG, dotC, dotK, ctrlsEl;
    var st = { x: null, y: null, s: 1 };     // uložená poloha/velikost
    var custom = false, editing = false, off = false;
    var fadeTimer = null, loop = null, suppressedSaved = {};
    // drag/long-press stav
    var lpTimer = null, downX = 0, downY = 0, dragging = false, origX = 0, origY = 0, moved = false;

    function $(id) { return document.getElementById(id); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function angDiff(a, b) { return ((a - b + 540) % 360) - 180; }
    // bezpečné čtení globálu z jiného skriptu: thunk v try/catch (nepoužívá eval kvůli CSP).
    // Odkaz na nedeklarovaný identifikátor vyhodí ReferenceError → vrátíme undefined.
    function gv(f) { try { return f(); } catch (e) { return undefined; } }

    // ---- perzistence ----------------------------------------------------------
    function load() {
        try { var o = JSON.parse(localStorage.getItem(LS)); if (o) { st.x = o.x; st.y = o.y; st.s = o.s || 1; custom = (o.x != null && o.y != null); } } catch (e) {}
    }
    function save() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} }

    // ---- DOM ------------------------------------------------------------------
    var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l0 16M12 4l-6 7M12 4l6 7"/></svg>';
    function build() {
        if (card) return;
        card = document.createElement('div');
        card.id = 'aghs-card';
        card.innerHTML =
            '<div class="aghs-main"><span class="aghs-chev">' + CHEV + '</span><span class="aghs-big">—</span></div>'
            + '<div class="aghs-sub">Hledám GPS…</div>'
            + '<div class="aghs-dots">'
            + '<button class="aghs-dot off" data-k="gps" data-lbl="GPS"><i></i></button>'
            + '<button class="aghs-dot off" data-k="comp" data-lbl="Sever"><i></i></button>'
            + '<button class="aghs-dot off" data-k="cal" data-lbl="Kalib"><i></i></button>'
            + '</div>'
            + '<div class="aghs-ctrls"><button data-a="minus">−</button><button data-a="plus">＋</button><button class="done" data-a="done">✓</button></div>'
            + '<div class="aghs-edit-hint">Táhni pro posun · −/＋ velikost · ✓ hotovo</div>';
        document.body.appendChild(card);
        bigEl = card.querySelector('.aghs-big');
        subEl = card.querySelector('.aghs-sub');
        chevEl = card.querySelector('.aghs-chev');
        dotG = card.querySelector('[data-k="gps"]');
        dotC = card.querySelector('[data-k="comp"]');
        dotK = card.querySelector('[data-k="cal"]');
        ctrlsEl = card.querySelector('.aghs-ctrls');

        // ťuk na tečky → otevři modál (nesmí spustit drag)
        card.querySelectorAll('.aghs-dot').forEach(function (d) {
            d.addEventListener('click', function (e) {
                e.stopPropagation();
                if (editing) return;
                var k = d.getAttribute('data-k');
                try {
                    if (k === 'gps' && typeof openSatModal === 'function') openSatModal();
                    else if (k === 'comp' && typeof openCompassModal === 'function') openCompassModal();
                    else if (k === 'cal' && typeof window.agOpenCalibrate === 'function') window.agOpenCalibrate();
                } catch (err) {}
            });
            d.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        });
        // ovládání úprav
        ctrlsEl.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        ctrlsEl.querySelectorAll('button').forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                var a = b.getAttribute('data-a');
                if (a === 'minus') { st.s = clamp((st.s || 1) - 0.1, 0.6, 2.2); applyTransform(); save(); }
                else if (a === 'plus') { st.s = clamp((st.s || 1) + 0.1, 0.6, 2.2); applyTransform(); save(); }
                else if (a === 'done') endEdit();
            });
        });
        // long-press → úpravy; v úpravách tažení
        card.addEventListener('pointerdown', onDown);
        applyTransform();
    }

    function applyTransform() {
        if (!card) return;
        var s = st.s || 1;
        if (custom && st.x != null && st.y != null) {
            // udrž v rozsahu obrazovky
            var w = card.offsetWidth || 160, h = card.offsetHeight || 80;
            st.x = clamp(st.x, 4, Math.max(4, window.innerWidth - w - 4));
            st.y = clamp(st.y, 4, Math.max(4, window.innerHeight - h - 4));
            card.style.left = st.x + 'px'; card.style.top = st.y + 'px';
            card.style.transformOrigin = 'top left';
            card.style.transform = 'scale(' + s + ')';
        } else {
            card.style.left = '50%';
            card.style.top = 'max(12px, calc(env(safe-area-inset-top, 0px) + 8px))';
            card.style.transformOrigin = 'top center';
            card.style.transform = 'translateX(-50%) scale(' + s + ')';
        }
    }

    // ---- režim úprav + tažení -------------------------------------------------
    function onDown(e) {
        if (off) return;
        downX = e.clientX; downY = e.clientY; moved = false;
        if (editing) {
            dragging = true;
            var r = card.getBoundingClientRect();
            origX = r.left; origY = r.top;
            try { card.setPointerCapture(e.pointerId); } catch (err) {}
        } else {
            clearTimeout(lpTimer);
            lpTimer = setTimeout(startEdit, 480);
        }
        wake();
    }
    function onMove(e) {
        if (Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8) moved = true;
        if (moved && !editing) clearTimeout(lpTimer);   // pohyb před long-pressem = zrušit
        if (editing && dragging) {
            custom = true;
            st.x = origX + (e.clientX - downX);
            st.y = origY + (e.clientY - downY);
            applyTransform();
        }
    }
    function onUp(e) {
        clearTimeout(lpTimer);
        if (editing && dragging) { dragging = false; save(); }
    }
    function startEdit() {
        if (moved) return;
        editing = true; card.classList.add('aghs-edit');
        wake();
    }
    function endEdit() {
        editing = false; dragging = false;
        card.classList.remove('aghs-edit');
        save(); wake();
    }

    // ---- vyblednutí -----------------------------------------------------------
    function blocked() {
        function shown(id) { var e = $(id); return e && (e.classList.contains('open') || e.style.display === 'flex'); }
        if ($('welcome-screen') && $('welcome-screen').style.display !== 'none') return true;
        if ($('side-menu') && $('side-menu').classList.contains('open')) return true;
        if ($('bottom-sheet') && $('bottom-sheet').classList.contains('open')) return true;
        return shown('settings-modal') || shown('custom-modal-overlay') || shown('cluster-modal') || shown('measure-modal');
    }
    function wake() {
        if (!card) return;
        card.classList.remove('aghs-faded');
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(function () {
            if (!editing && !blocked()) card.classList.add('aghs-faded');
        }, FADE_MS);
    }

    // ---- potlačení původních indikátorů ---------------------------------------
    function suppress() {
        for (var i = 0; i < SUPPRESS.length; i++) {
            var el = $(SUPPRESS[i]);
            if (el && el.style.display !== 'none') {
                if (!(SUPPRESS[i] in suppressedSaved)) suppressedSaved[SUPPRESS[i]] = el.style.display || '';
                el.style.display = 'none';
            }
        }
    }
    function unsuppress() {
        for (var id in suppressedSaved) { var el = $(id); if (el) el.style.display = suppressedSaved[id]; }
        suppressedSaved = {};
    }

    function setDot(d, cls) { d.className = 'aghs-dot ' + cls; }
    // přepne JEN stavové třídy karty (nav/kvalita), ZACHOVÁ aghs-faded a aghs-edit
    function setState(cls) {
        card.classList.remove('nav', 'q-ok', 'q-warn', 'q-bad');
        if (cls) card.classList.add(cls);
    }

    // ---- aktualizace obsahu ---------------------------------------------------
    function update() {
        if (off || !card) return;
        var appStartedV = gv(function () { return appStarted; });
        if (!appStartedV) { card.style.display = 'none'; return; }
        card.style.display = 'block';
        suppress();

        var lat = gv(function () { return userLat; }), lng = gv(function () { return userLng; });
        var heading = gv(function () { return currentHeading; }); if (typeof heading !== 'number') heading = 0;
        var acc = gv(function () { return currentGpsAccuracy; });
        var avg = gv(function () { return gpsAvgResult; });
        if (avg && !avg.coarse && avg.n >= 2 && isFinite(avg.sterr)) acc = avg.sterr;

        // ---- kontext: navigace ke zvýrazněnému bodu? ----
        var hl = gv(function () { return highlightedPointId; }), pts = gv(function () { return arPoints; }), pt = null;
        if (hl && pts && pts.length) { for (var i = 0; i < pts.length; i++) if (pts[i].id === hl) { pt = pts[i]; break; } }

        if (lat == null) {
            setState(''); bigEl.textContent = '—'; subEl.textContent = 'Hledám GPS…';
        } else if (pt) {
            var d = (pt.currentDist != null) ? pt.currentDist : (typeof getDistance === 'function' ? getDistance(lat, lng, pt.lat, pt.lng) : 0);
            var b = (pt.currentBearing != null) ? pt.currentBearing : (typeof getBearing === 'function' ? getBearing(lat, lng, pt.lat, pt.lng) : 0);
            setState('nav');
            chevEl.style.transform = 'rotate(' + angDiff(b, heading).toFixed(0) + 'deg)';
            bigEl.innerHTML = (d < 10 ? d.toFixed(1) : Math.round(d)) + '<small> m</small>';
            subEl.textContent = '#' + (pt.name || 'bod') + ' · směr ' + Math.round(b) + '°';
        } else {
            var q = (acc == null) ? '' : (acc < ACC_OK ? 'q-ok' : (acc < ACC_WARN ? 'q-warn' : 'q-bad'));
            setState(q);
            bigEl.innerHTML = (acc == null ? '—' : '±' + acc.toFixed(acc < 10 ? 1 : 0)) + '<small> m</small>';
            var so = gv(function () { return satObs; }), mask = gv(function () { return SAT_EL_MASK; });
            var nsat = (so && so.length && typeof mask === 'number') ? so.filter(function (o) { return o.el >= mask; }).length : null;
            subEl.textContent = (nsat != null ? nsat + ' 🛰 · ' : '') + Math.round(((heading % 360) + 360) % 360) + '°';
        }

        // ---- tečky ----
        if (acc == null) setDot(dotG, 'off'); else setDot(dotG, acc < ACC_OK ? 'ok' : (acc < ACC_WARN ? 'warn' : 'bad'));
        var hr = gv(function () { return headingReliable; });
        setDot(dotC, (hr === false) ? 'warn' : (lat == null ? 'off' : 'ok'));
        var sh = (typeof window !== 'undefined') ? window.agRefShift : null;
        setDot(dotK, (sh && sh.on) ? 'ok' : 'off');
    }

    // ---- spuštění / vypnutí ---------------------------------------------------
    function tick() {
        if (off) return;
        if (!card && gv(function () { return appStarted; })) { build(); load(); applyTransform(); wake(); }
        if (card) update();
    }
    function init() {
        if (loop) return;
        document.addEventListener('pointerdown', wake, true);
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
        window.addEventListener('resize', applyTransform);
        loop = setInterval(tick, 500);
        tick();
    }

    window.agHudSmartOff = function () {
        off = true; if (loop) { clearInterval(loop); loop = null; }
        clearTimeout(fadeTimer); clearTimeout(lpTimer);
        if (card) { card.remove(); card = null; }
        unsuppress();
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });
})();
