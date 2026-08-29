// ===== AR Geodet — GNSS KVALITA (odpojitelná vrstva) ============================
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu js/vylepseni.js: obaluje za běhu globál
// openSatModal() z js/satelity.js a doplní do satelitního modálu řádek s aktuálním
// PDOP + slovním hodnocením geometrie a s "nejlepším oknem pro měření dnes".
// NEEDITUJE satelity.js ani jiné soubory. Načítá se jako jeden z posledních skriptů.
//
// Odstranění celé vrstvy: smaž js/gnss-quality.js + css/gnss-quality.css a řádky se
// značkou "GNSS KVALITA" v index.html (+ záznam v sw.js). Aplikace pak funguje stejně.
//
// Zdroje (vše už existuje v satelity.js): computeSatPositions(date), computePDOP(obs),
// satObs (aktuálně spočítané pozice), SAT_EL_MASK, userLat/userLng, tleSats.
// Když data nejsou spočítaná (chybí GPS, dráhy TLE nebo PDOP nelze určit) -> tiše skryj.
// ================================================================================
(function () {
    'use strict';

    var ROW_ID = 'gq-row';
    var SCAN_MIN = 180;   // okno predikce: 3 h dopředu
    var SCAN_STEP = 5;    // krok skenu PDOP (min) — stejně jako findBestSatTime
    var _scanCache = null; // { at:ms, best:{min,pdop,n} | null }
    var _timer = null;

    function elMask() {
        try { return (typeof SAT_EL_MASK !== 'undefined' && isFinite(SAT_EL_MASK)) ? SAT_EL_MASK : 10; }
        catch (e) { return 10; }
    }

    function hasGps() {
        try { return typeof userLat !== 'undefined' && userLat != null; } catch (e) { return false; }
    }
    function hasTle() {
        try { return typeof tleSats !== 'undefined' && tleSats && tleSats.length > 0; } catch (e) { return false; }
    }
    function canCompute() {
        return hasGps() && hasTle()
            && typeof computeSatPositions === 'function'
            && typeof computePDOP === 'function';
    }

    // Slovní hodnocení PDOP (běžné geodetické prahy).
    function ratePdop(p) {
        if (p == null || !isFinite(p)) return null;
        if (p <= 2) return { txt: 'výborná', cls: 'gq-great' };
        if (p <= 4) return { txt: 'dobrá', cls: 'gq-good' };
        if (p <= 6) return { txt: 'použitelná', cls: 'gq-ok' };
        return { txt: 'slabá', cls: 'gq-weak' };
    }

    // Aktuální PDOP. Nejdřív zkusí čerstvé satObs (spočítané satelity.js každé ~2 s),
    // jinak dopočítá z computeSatPositions(now). Vrací číslo nebo null.
    function currentPdop() {
        try {
            var obs = (typeof satObs !== 'undefined' && satObs && satObs.length) ? satObs : computeSatPositions(new Date());
            if (!obs || !obs.length) return null;
            var p = computePDOP(obs);
            return (p != null && isFinite(p)) ? p : null;
        } catch (e) { return null; }
    }

    // Nejlepší okno pro měření v příštích 3 h (nejnižší PDOP). Sken je cachovaný 60 s,
    // ať se při každém tiku modálu nepočítá 36× SGP4 zbytečně.
    function bestWindow() {
        try {
            var now = Date.now();
            if (_scanCache && (now - _scanCache.at) < 60000) return _scanCache.best;
            if (!canCompute()) { _scanCache = { at: now, best: null }; return null; }
            var mask = elMask();
            var best = null;
            for (var min = 0; min <= SCAN_MIN; min += SCAN_STEP) {
                var obs = computeSatPositions(new Date(now + min * 60000));
                if (!obs || !obs.length) continue;
                var p = computePDOP(obs);
                if (p == null || !isFinite(p)) continue;
                var n = 0;
                for (var i = 0; i < obs.length; i++) { if (obs[i].el >= mask) n++; }
                if (best === null || p < best.pdop) best = { min: min, pdop: p, n: n };
            }
            _scanCache = { at: now, best: best };
            return best;
        } catch (e) { _scanCache = null; return null; }
    }

    function fmtPdop(p) { return (Math.round(p * 10) / 10).toFixed(1); }

    function whenLabel(min) {
        if (min === 0) return 'právě teď';
        var t = new Date(Date.now() + min * 60000);
        var hhmm;
        try { hhmm = t.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); }
        catch (e) { hhmm = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2); }
        return 'v ' + hhmm + ' (za ' + min + ' min)';
    }

    // Postaví / přepíše řádek. Vrací false, pokud se má řádek skrýt (data nejsou).
    function renderRow(row) {
        var mask = elMask();
        var p = currentPdop();
        var rate = ratePdop(p);
        if (p == null || !rate) { row.style.display = 'none'; return false; }

        var best = bestWindow();
        var bestHtml = '';
        if (best && best.pdop != null) {
            var same = (best.min === 0);
            bestHtml =
                '<div class="gq-best">' +
                '<span class="gq-best-lbl">Nejlepší okno pro měření dnes</span>' +
                '<span class="gq-best-val">' + whenLabel(best.min) +
                '<span class="gq-best-sub"> · PDOP ' + fmtPdop(best.pdop) + ' · ' + best.n + ' družic nad ' + mask + '°' +
                (same ? '' : '') + '</span></span>' +
                '</div>';
        }

        row.innerHTML =
            '<div class="gq-head">' +
            '<span class="gq-label">Geometrie GNSS (teoretická, všechny družice)</span>' +
            '<span class="gq-pdop ' + rate.cls + '">PDOP ' + fmtPdop(p) + ' · ' + rate.txt + '</span>' +
            '</div>' +
            bestHtml;
        row.style.display = 'block';
        return true;
    }

    function injectRow() {
        // modál vytváří satelity.js (ensureSatModal). Bez něj tiše nic neděláme.
        var modal = document.getElementById('sat-modal');
        if (!modal) return;
        var stats = document.getElementById('sat-stats');
        if (!stats) return;

        var row = document.getElementById(ROW_ID);
        if (!row) {
            row = document.createElement('div');
            row.id = ROW_ID;
            row.className = 'gq-row';
            row.style.display = 'none';
            // hned za blok se statistikami viditelných družic
            if (stats.nextSibling) stats.parentNode.insertBefore(row, stats.nextSibling);
            else stats.parentNode.appendChild(row);
        }
        renderRow(row);
    }

    function modalOpen() {
        try { var m = document.getElementById('sat-modal'); return !!(m && m.style.display === 'flex'); }
        catch (e) { return false; }
    }

    // Lehká aktualizace, dokud je modál otevřený (PDOP se mění s časem/pohybem oblohy).
    function ensureTimer() {
        if (_timer) return;
        _timer = setInterval(function () {
            if (!modalOpen()) { clearInterval(_timer); _timer = null; return; }
            var row = document.getElementById(ROW_ID);
            if (row) { try { renderRow(row); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-quality:ensureTimer'); } }
        }, 2500);
    }

    // Obalí globální openSatModal() — po otevření modálu doplní/aktualizuje řádek.
    function hookSatModal() {
        if (typeof window.openSatModal !== 'function' || window.openSatModal._gqWrapped) return;
        var orig = window.openSatModal;
        var wrapped = function () {
            var r = orig.apply(this, arguments);
            // modál i statistiky vznikají uvnitř orig; necháme doběhnout a pak vložíme.
            setTimeout(function () { try { injectRow(); ensureTimer(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-quality:wrapped'); } }, 0);
            setTimeout(function () { try { injectRow(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-quality:wrapped'); } }, 350);
            return r;
        };
        wrapped._gqWrapped = true;
        wrapped._gqOrig = orig;
        window.openSatModal = wrapped;
    }

    function init() {
        try { hookSatModal(); } catch (e) { console.warn('[gnss-quality] hook', e); }
        // Kdyby byl modál už otevřený (ojediněle), zkus rovnou doplnit.
        try { if (modalOpen()) { injectRow(); ensureTimer(); } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gnss-quality:init'); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // Druhý průchod — openSatModal vzniká až po načtení satelity.js.
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
