// ===== AR Geodet — VYTYČOVANÁ PŘÍMKA V AR (ODPOJITELNÁ vrstva) =================
// Přímku A→B z nástroje „Vytyčení přímky" (js/stakeout-line.js) položí do KAMERY:
// v obraze vidíš, kudy osa vede, kde je tvoje patka na ní a jak daleko od ní stojíš.
// Uživatel to chtěl přesně takhle: „vybral bych si dva body, mezi kterýma chci
// vytyčit přímku, a v realitě by se mi tam zobrazovala kolmice — i když to bude
// plus mínus metr, tak to je v pohodě."
//
// CO SE KRESLÍ:
//   • OSA A→B — plná čára po zemi, navzorkovaná po kouscích (rovná čára se v
//     perspektivě láme, takže úsečka mezi dvěma promítnutými konci by ležela jinde
//     než skutečná osa; proto se vzorkuje a spojuje po segmentech),
//   • KOLMICE — čárkovaně od tvé polohy k patce na ose (to, oč tady jde),
//   • PATKA + KONCE A/B — kroužky s popiskem (staničení, odstup).
//
// Do grafika.js ani logika.js nesahá — stejný vzor jako js/track-ar.js: bere si
// window._arProj (sklon, náklon, poloviční zorné úhly; publikuje renderAR),
// currentHeading, userLat/userLng a kreslí do vlastního <svg> v #ar-overlay.
//
// Zapíná se zaškrtávátkem v nástroji „Vytyčení přímky", volba se pamatuje.
// Ve výchozím stavu VYPNUTO — v AR má být klid, dokud si čáru nevyžádáš.
//
// Odstranění: smaž js/stakeout-line-ar.js + řádek <script> v index.html
// (a přegeneruj sw.js), plus zaškrtávátko v js/stakeout-line.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGLineAR) return;

    var LS = 'agLineAr_v1';
    var COL_AXIS = '#38bdf8';      // osa — modrá, ať se nepere s oranžovou stopou trasy
    var COL_PERP = '#fbbf24';      // kolmice — žlutá jako „pozor, tady jsi mimo"
    var COL_OK = '#34d399';
    var STEP_M = 2;                // vzorkování osy po 2 m
    var MAX_SEG = 200;             // strop segmentů na snímek
    var CULL_DEG = 110;            // dál od osy pohledu = za zády, nekreslit

    var _on = false, _raf = null, _idleT = 0, _svg = null;
    var _lastH = null, _lastP = null, _lastLat = null, _lastLng = null;

    function haveUser() {
        try { return typeof userLat === 'number' && typeof userLng === 'number' && userLat != null && userLng != null; }
        catch (e) { return false; }
    }
    function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    function ensureSvg() {
        var ov = document.getElementById('ar-overlay'); if (!ov) return null;
        if (!_svg || !_svg.parentNode) {
            _svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            _svg.setAttribute('viewBox', '0 0 100 100');
            _svg.setAttribute('preserveAspectRatio', 'none');
            _svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
            ov.insertBefore(_svg, ov.firstChild);
        }
        return _svg;
    }

    // stejná projekce jako u AR značek a stopy trasy (js/track-ar.js)
    function proj(lat, lng, heading, pj, eyeH, vOff) {
        var dist = getDistance(userLat, userLng, lat, lng);
        var bearing = getBearing(userLat, userLng, lat, lng);
        var diff = ((bearing - heading + 540) % 360) - 180;
        var dz = 0;
        try { if (typeof terrainDZ === 'function') dz = terrainDZ(lat, lng) || 0; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line-ar:proj'); }
        var uH = diff, vV = Math.atan2(eyeH - dz, Math.max(dist, 0.5)) * 180 / Math.PI - pj.pitch;
        if (pj.roll) {
            var cr = Math.cos(pj.roll), sr = Math.sin(pj.roll);
            var tt = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = tt;
        }
        return { x: 50 + (uH / pj.halfH) * 50, y: 50 + (vV / pj.halfV) * 50 - vOff, diff: diff, dist: dist };
    }

    // geometrii si bere nástroj sám (sdílí ji přes AGStakeLine), ať se nemůžou
    // rozejít — kdyby se tu počítala podruhé, byla by to druhá pravda
    function geom() {
        try { return (window.AGStakeLine && window.AGStakeLine.geometry) ? window.AGStakeLine.geometry() : null; }
        catch (e) { return null; }
    }

    function line(a, b, color, width, dash, op) {
        return '<line x1="' + a.x.toFixed(2) + '" y1="' + a.y.toFixed(2)
            + '" x2="' + b.x.toFixed(2) + '" y2="' + b.y.toFixed(2)
            + '" stroke="' + color + '" stroke-width="' + width + '" stroke-linecap="round"'
            + (dash ? ' stroke-dasharray="' + dash + '"' : '')
            + ' opacity="' + op + '" vector-effect="non-scaling-stroke"/>';
    }
    function dot(p, color, r) {
        return '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="' + r + '" fill="' + color
            + '" opacity="0.95" vector-effect="non-scaling-stroke"/>';
    }
    function label(p, text, color, dy) {
        // text v SVG s viewBoxem 0..100 by se nerovnoměrně roztáhl (preserveAspectRatio
        // none), proto se sází na pevnou velikost přes non-scaling a zarovnává na střed
        return '<text x="' + p.x.toFixed(2) + '" y="' + (p.y + dy).toFixed(2) + '" fill="' + color + '"'
            + ' font-size="3.2" font-weight="700" text-anchor="middle"'
            + ' style="paint-order:stroke;stroke:rgba(6,9,12,0.85);stroke-width:1.1px;font-family:var(--font-ui,system-ui);">'
            + esc(text) + '</text>';
    }

    function loop() {
        var svg = _svg;
        var vm = null; try { vm = viewMode; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line-ar:loop'); }
        // BATERIE: mimo AR (Mapa, appka na pozadí, vypnutá volba) nedrž 60Hz řetěz
        if (!svg || !_on || !haveUser() || vm === 'map' || !window._arProj
            || document.visibilityState !== 'visible') {
            if (svg && svg.innerHTML) svg.innerHTML = '';
            _lastH = null; _raf = 0;
            _idleT = setTimeout(function () { _idleT = 0; if (!_raf) _raf = requestAnimationFrame(loop); }, 300);
            return;
        }
        _raf = requestAnimationFrame(loop);

        var pj = window._arProj, heading = null;
        try { heading = (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line-ar:loop'); }
        if (heading == null) { if (svg.innerHTML) svg.innerHTML = ''; return; }

        var g = geom();
        if (!g) { if (svg.innerHTML) svg.innerHTML = ''; return; }

        var pitch = num(pj.pitch, 0);
        if (_lastH != null && Math.abs(heading - _lastH) < 0.3 && Math.abs(pitch - _lastP) < 0.3
            && _lastLat === userLat && _lastLng === userLng) return;
        _lastH = heading; _lastP = pitch; _lastLat = userLat; _lastLng = userLng;

        var eyeH = 1.6, vOff = 0, rad = 150;
        try { eyeH = visSettings.eyeHeight || 1.6; vOff = visSettings.arVerticalOffset || 0; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line-ar:loop'); }
        try { if (typeof arRadius !== 'undefined' && arRadius) rad = arRadius; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line-ar:loop'); }

        var S = window.AGStakeLine;
        var html = '';

        // ---- osa A→B navzorkovaná po STEP_M ------------------------------------
        var n = Math.min(MAX_SEG, Math.max(1, Math.ceil(g.len / STEP_M)));
        var prev = null, i, t, p, cur;
        for (i = 0; i <= n; i++) {
            t = (g.len * i) / n;
            p = S.pointAt(g, t, 0);
            cur = proj(p.lat, p.lng, heading, pj, eyeH, vOff);
            if (prev && Math.min(prev.dist, cur.dist) <= rad
                && Math.abs(prev.diff) <= CULL_DEG && Math.abs(cur.diff) <= CULL_DEG) {
                html += line(prev, cur, COL_AXIS, 3, '', 0.9);
            }
            prev = cur;
        }

        // ---- kolmice z mojí polohy na osu --------------------------------------
        var me = S.stationOf(g, userLat, userLng);          // {station, offset}
        // patka se ořezává na úsek A..B: za koncem přímky už kolmice nedává smysl
        var st = Math.max(0, Math.min(g.len, me.station));
        var foot = S.pointAt(g, st, 0);
        var pFoot = proj(foot.lat, foot.lng, heading, pj, eyeH, vOff);
        var absOff = Math.abs(me.offset);
        var okCol = absOff <= 0.30 ? COL_OK : COL_PERP;

        if (Math.abs(pFoot.diff) <= CULL_DEG && pFoot.dist <= rad) {
            // spodek obrazu = místo pod nohama; kolmici vedeme odtud k patce
            var pMe = { x: 50, y: 100 - vOff, diff: 0, dist: 0 };
            html += line(pMe, pFoot, okCol, 2.5, '2 3', 0.85);
            html += dot(pFoot, okCol, 1.6);
            html += label(pFoot, absOff.toFixed(2) + ' m ' + (me.offset >= 0 ? 'vlevo' : 'vpravo'), okCol, -2.4);
            html += label(pFoot, 'st. ' + st.toFixed(1), COL_AXIS, 4.2);
        }

        // ---- konce A a B --------------------------------------------------------
        [[g.A, 'A'], [g.B, 'B']].forEach(function (pair) {
            var q = proj(pair[0].lat, pair[0].lng, heading, pj, eyeH, vOff);
            if (Math.abs(q.diff) > CULL_DEG || q.dist > rad) return;
            html += dot(q, COL_AXIS, 1.9);
            html += label(q, pair[1] + ' #' + pair[0].name, COL_AXIS, -2.6);
        });

        svg.innerHTML = html;
    }

    function start() { if (ensureSvg() && !_raf && !_idleT) _raf = requestAnimationFrame(loop); }
    function stop() {
        if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
        if (_idleT) { clearTimeout(_idleT); _idleT = 0; }
        if (_svg) _svg.innerHTML = '';
    }

    window.AGLineAR = {
        isOn: function () { return _on; },
        set: function (v) {
            _on = !!v;
            try { localStorage.setItem(LS, _on ? '1' : '0'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line-ar:set'); }
            if (_on) start(); else stop();
        },
        refresh: function () { _lastH = null; }
    };

    function init() {
        try { _on = localStorage.getItem(LS) === '1'; } catch (e) { _on = false; }
        if (_on) start();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 600); });
    else setTimeout(init, 600);
})();
