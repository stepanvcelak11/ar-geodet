// ===== AR Geodet — VAROVÁNÍ NA SLABOU GPS (odpojitelná vrstva) ===================
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu js/vylepseni.js a js/kompas-check.js:
// NEEDITUJE logika.js ani grafika.js, jen čte globály za běhu. Načítá se jako
// jeden z posledních skriptů.
//
// Co dělá:
//   Každou ~1 s zkontroluje přesnost GPS. Když appka běží (appStarted), je vidět AR
//   (ne samostatná mapa) a currentGpsAccuracy je horší než práh (>10 m), zobrazí
//   nenápadný blikající indikátor nad AR: "Slabá GPS (±X m) — teď neměř".
//   Jakmile se přesnost zlepší na ≤10 m, indikátor zmizí (s krátkou hysterezí,
//   ať neproblikává).
//
// Odstranění: smaž js/gps-warn.js + css/gps-warn.css a jejich řádky v index.html
// (a případně z ASSETS_TO_CACHE v sw.js). Appka pak jede přesně jako předtím.
// ================================================================================
(function () {
    'use strict';

    // Práh přesnosti (metry). Nad tuto hodnotu (ostře větší) považujeme GPS za slabou.
    var WEAK_GPS_THRESHOLD_M = 10;
    // Jak dlouho po zlepšení ještě nechat indikátor, ať neproblikává (ms).
    var HIDE_HYSTERESIS_MS = 1500;
    var POLL_MS = 1000;

    var _el = null;
    var _accEl = null;
    var _timer = null;
    var _hiddenSince = 0;
    // „Rozumím": uživatel varování odklikl — nepřekážet. Pamatujeme si přesnost při
    // odkliknutí; varování se znovu ukáže, až se signál VÝRAZNĚ zhorší (>1.5×),
    // nebo poté, co se mezitím zlepšil pod práh (nová situace = nové varování).
    var _dismissedAcc = null;

    // --- čtení globálů (vždy obezřetně) -----------------------------------------
    function isLive() {
        try { return (typeof appStarted !== 'undefined') && !!appStarted; }
        catch (e) { return false; }
    }
    // V samostatné mapě AR není vidět -> overlay nedává smysl.
    function arVisible() {
        try { return (typeof viewMode === 'undefined') || viewMode !== 'map'; }
        catch (e) { return true; }
    }
    function getAccuracy() {
        try {
            if (typeof currentGpsAccuracy !== 'undefined' && isFinite(currentGpsAccuracy) && currentGpsAccuracy > 0) {
                return currentGpsAccuracy;
            }
        } catch (e) {}
        return null;
    }

    // --- UI (idempotentní) ------------------------------------------------------
    function ensureEl() {
        if (_el && document.body.contains(_el)) return _el;
        var existing = document.getElementById('gps-warn');
        if (existing) { _el = existing; _accEl = existing.querySelector('#gps-warn-acc'); return _el; }
        if (!document.body) return null;
        _el = document.createElement('div');
        _el.id = 'gps-warn';
        _el.setAttribute('role', 'status');
        _el.setAttribute('aria-live', 'polite');
        // Pozn.: většina vzhledu je v css/gps-warn.css; tady jen obsah.
        _el.innerHTML =
            '<svg class="gps-warn-ico" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M12 2 1 21h22L12 2z" fill="currentColor"></path>' +
            '<rect x="11" y="9" width="2" height="6" rx="1" fill="#1a1205"></rect>' +
            '<rect x="11" y="17" width="2" height="2" rx="1" fill="#1a1205"></rect>' +
            '</svg>' +
            '<span class="gps-warn-txt">Slabá GPS (±<b id="gps-warn-acc">?</b> m) — teď neměř</span>';
        var ok = document.createElement('button');
        ok.type = 'button'; ok.id = 'gps-warn-ok';
        ok.setAttribute('aria-label', 'Rozumím, skrýt varování');
        ok.style.cssText = 'margin-left:8px; border:1px solid rgba(0,0,0,0.35); background:rgba(0,0,0,0.18); color:inherit; font-size:11px; font-weight:600; line-height:1; padding:5px 9px; border-radius:99px; cursor:pointer; pointer-events:auto;';
        ok.textContent = 'Rozumím ✕';
        ok.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var acc = getAccuracy();
            _dismissedAcc = (acc != null) ? acc : WEAK_GPS_THRESHOLD_M;
            if (_el) _el.classList.remove('on');
            _hiddenSince = 0;
        });
        _el.appendChild(ok);
        document.body.appendChild(_el);
        _accEl = _el.querySelector('#gps-warn-acc');
        return _el;
    }

    function showWarn(acc) {
        var el = ensureEl();
        if (!el) return;
        _hiddenSince = 0;
        if (_accEl) _accEl.textContent = String(Math.round(acc));
        if (!el.classList.contains('on')) el.classList.add('on');
    }

    function hideWarn() {
        if (!_el) return;
        if (!_el.classList.contains('on')) return;
        var now = Date.now();
        if (!_hiddenSince) { _hiddenSince = now; return; }   // hystereze
        if (now - _hiddenSince < HIDE_HYSTERESIS_MS) return;
        _el.classList.remove('on');
        _hiddenSince = 0;
    }

    function tick() {
        try {
            if (!isLive() || !arVisible()) { hideWarn(); return; }
            var acc = getAccuracy();
            if (acc != null && acc > WEAK_GPS_THRESHOLD_M) {
                // odklepnuto „Rozumím": mlčet, dokud se signál výrazně nezhorší
                if (_dismissedAcc != null && acc <= _dismissedAcc * 1.5) { hideWarn(); return; }
                _dismissedAcc = null;
                showWarn(acc);
            } else {
                _dismissedAcc = null;   // signál se spravil — příští zhoršení je nová situace
                hideWarn();
            }
        } catch (e) { /* fail-silent */ }
    }

    function start() {
        if (_timer) return;
        try { _timer = setInterval(tick, POLL_MS); } catch (e) {}
        try { tick(); } catch (e) {}
    }

    // --- Init (DOMContentLoaded + load, druhý průchod přes setTimeout) -----------
    function init() {
        try { start(); } catch (e) { console.warn('[gps-warn] init', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
