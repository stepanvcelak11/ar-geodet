// ===== AR Geodet — STOPA TRASY V AR (ODPOJITELNÁ vrstva) =======================
// Zaznamenanou stopu (js/track-log.js) vykreslí i v AR pohledu — jako oranžovou
// čárkovanou čáru položenou po zemi, stejnou barvou jako v mapě. Hodí se, když se
// vracíš po vlastní stopě nebo kontroluješ, kudy jsi projel.
//
// Zapíná se zaškrtávátkem v nástroji „Stopa trasy" (volba se pamatuje). Ve výchozím
// stavu je VYPNUTÁ — v AR má být klid, dokud si čáru nevyžádáš.
//
// Do grafika.js nesahá: bere si jen window._arProj (sklon/náklon/FOV, publikuje
// renderAR), globály currentHeading, userLat/userLng a vlastní SVG v #ar-overlay.
// Stejný vzor jako js/cadastre-vector.js.
//
// Odstranění: smaž js/track-ar.js + řádek v index.html a v sw.js (a zaškrtávátko
// v track-log.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGTrackAR) return;

    var LS = 'agTrackAr_v1';
    var COLOR = '#f59e0b';       // shodné s čárou v mapě
    var MAX_SEG = 220;           // víc segmentů na snímek nemá smysl kreslit
    var CULL_DEG = 110;          // konec dál od osy pohledu než tohle = za zády

    var _on = false, _raf = null, _svg = null;
    var _cache = [], _cacheTs = 0;
    var _lastH = null, _lastP = null, _lastLat = null, _lastLng = null;

    try { _on = localStorage.getItem(LS) === '1'; } catch (e) {}

    function haveUser() { try { return typeof userLat === 'number' && typeof userLng === 'number' && userLat != null && userLng != null; } catch (e) { return false; } }
    function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

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

    // stejná projekce jako u AR značek (azimut × svislý úhel + korekce náklonu obrazu)
    function proj(lat, lng, heading, pj, eyeH, vOff) {
        var dist = getDistance(userLat, userLng, lat, lng);
        var bearing = getBearing(userLat, userLng, lat, lng);
        var diff = ((bearing - heading + 540) % 360) - 180;
        var dz = 0;
        try { if (typeof terrainDZ === 'function') dz = terrainDZ(lat, lng) || 0; } catch (e) {}
        var uH = diff, vV = Math.atan2(eyeH - dz, Math.max(dist, 0.5)) * 180 / Math.PI - pj.pitch;
        if (pj.roll) {
            var cr = Math.cos(pj.roll), sr = Math.sin(pj.roll);
            var tt = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = tt;
        }
        return { x: 50 + (uH / pj.halfH) * 50, y: 50 + (vV / pj.halfV) * 50 - vOff, diff: diff, dist: dist };
    }

    // Stopa má až 3000 bodů — projektovat všechny každý snímek by mobil uvařilo.
    // Držíme si proto předfiltrovaný výřez a přepočítáváme ho, jen když se pohneš.
    function trackNear(rad) {
        var now = Date.now();
        if (_cache.length && now - _cacheTs < 3000) return _cache;
        var all = [];
        try { all = (typeof window.agTrackPoints === 'function') ? window.agTrackPoints() : []; } catch (e) { all = []; }
        var out = [];
        // hrubý bbox místo Haversine na 3000 bodů
        var dLat = rad / 111320, dLng = rad / (111320 * Math.max(0.2, Math.cos(userLat * Math.PI / 180)));
        for (var i = 0; i < all.length; i++) {
            var p = all[i];
            if (!p || Math.abs(p.lat - userLat) > dLat || Math.abs(p.lng - userLng) > dLng) { out.push(null); continue; }
            out.push(p);
        }
        // z posledních MAX_SEG+1 použitelných bodů udělej souvislé úseky
        var segs = [], run = [];
        for (var j = 0; j < out.length; j++) {
            if (out[j]) run.push(out[j]);
            else if (run.length > 1) { segs.push(run); run = []; }
            else run = [];
        }
        if (run.length > 1) segs.push(run);
        _cache = segs; _cacheTs = now;
        return segs;
    }

    function loop() {
        _raf = requestAnimationFrame(loop);
        var svg = _svg; if (!svg) return;
        var vm = null; try { vm = viewMode; } catch (e) {}
        if (!_on || !haveUser() || vm === 'map' || !window._arProj) {
            if (svg.innerHTML) svg.innerHTML = '';
            _lastH = null; return;
        }
        var pj = window._arProj;
        var heading = null;
        try { heading = (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null; } catch (e) {}
        if (heading == null) { if (svg.innerHTML) svg.innerHTML = ''; return; }

        var pitch = num(pj.pitch, 0);
        if (_lastH != null && Math.abs(heading - _lastH) < 0.3 && Math.abs(pitch - _lastP) < 0.3
            && _lastLat === userLat && _lastLng === userLng) return;      // nic se nezměnilo
        _lastH = heading; _lastP = pitch; _lastLat = userLat; _lastLng = userLng;

        var eyeH = 1.6, vOff = 0, rad = 150;
        try { eyeH = visSettings.eyeHeight || 1.6; vOff = visSettings.arVerticalOffset || 0; } catch (e) {}
        try { if (typeof arRadius !== 'undefined' && arRadius) rad = arRadius; } catch (e) {}

        var segs = trackNear(rad), html = '', drawn = 0;
        for (var s = 0; s < segs.length && drawn < MAX_SEG; s++) {
            var run = segs[s], prev = null;
            for (var i = 0; i < run.length && drawn < MAX_SEG; i++) {
                var cur = proj(run[i].lat, run[i].lng, heading, pj, eyeH, vOff);
                if (prev) {
                    if (Math.min(prev.dist, cur.dist) <= rad
                        && Math.abs(prev.diff) <= CULL_DEG && Math.abs(cur.diff) <= CULL_DEG) {
                        html += '<line x1="' + prev.x.toFixed(2) + '" y1="' + prev.y.toFixed(2)
                            + '" x2="' + cur.x.toFixed(2) + '" y2="' + cur.y.toFixed(2)
                            + '" stroke="' + COLOR + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7"'
                            + ' opacity="0.9" vector-effect="non-scaling-stroke"/>';
                        drawn++;
                    }
                }
                prev = cur;
            }
        }
        svg.innerHTML = html;
    }

    function start() { if (ensureSvg() && !_raf) _raf = requestAnimationFrame(loop); }
    function stop() {
        if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
        if (_svg) _svg.innerHTML = '';
        _lastH = null;
    }

    window.AGTrackAR = {
        isOn: function () { return _on; },
        set: function (v) {
            _on = !!v;
            try { localStorage.setItem(LS, _on ? '1' : '0'); } catch (e) {}
            _cache = []; _cacheTs = 0;
            if (_on) { start(); if (typeof quickToast === 'function') quickToast('Stopa se zobrazí v AR pohledu.'); }
            else { stop(); }
        },
        refresh: function () { _cache = []; _cacheTs = 0; _lastH = null; }
    };

    function init() { if (_on) start(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 600); });
    else setTimeout(init, 600);
})();
