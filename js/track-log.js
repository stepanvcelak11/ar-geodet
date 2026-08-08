// ===== AR Geodet — STOPA TRASY / BREADCRUMB (ODPOJITELNÁ vrstva) ===============
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js — čte userLat/userLng,
// kreslí čáru na existující mapu (L/map) a ukládá stopu per zakázka pod klíčem
// 'agTrackLog' (přes setStoredData → prefix zakázkou). Záznam kudy jsem šel:
// pro dohledání, jako doklad o pochůzce a aby se člověk v terénu neztratil.
//
// Vstup: tlačítko „Stopa trasy" v launcheru (js/field-tools.js).
// Odstranění: smaž js/track-log.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20s4-9 8-9 8 9 8 9"/><circle cx="4" cy="20" r="1.5" fill="currentColor"/><circle cx="20" cy="20" r="1.5" fill="currentColor"/><path d="M12 11V4M9 7l3-3 3 3"/></svg>';
    var KEY = 'agTrackLog';
    var POLL_MS = 2000;
    var MIN_MOVE_M = 1.5;      // menší pohyb považujeme za GPS šum
    var MAX_PTS = 3000;        // strop, ať nepřeteče úložiště

    var _track = [];           // [{lat,lng,t,a}]
    var _recording = false;
    var _poll = null;
    var _line = null;
    var _persistTimer = null, _dirty = false;
    var PERSIST_MS = 10000;    // localStorage zápis je SYNCHRONNÍ a blokuje hlavní vlákno (a tím
                               // i obraz kamery) — proto stopu neukládáme každý vzorek, ale dávkově.

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }

    function load() {
        _track = [];
        try { var s = (typeof getStoredData === 'function') ? getStoredData(KEY) : null; if (s) _track = JSON.parse(s) || []; } catch (e) { _track = []; }
    }
    function persist() { try { if (typeof setStoredData === 'function') setStoredData(KEY, JSON.stringify(_track)); } catch (e) {} }
    // DÁVKOVÉ UKLÁDÁNÍ: stringify celé stopy + zápis do localStorage je synchronní a při delší
    // stopě blokuje hlavní vlákno (a tím i obraz kamery). Ukládáme max 1×/PERSIST_MS a vždy
    // naplno při zastavení / odchodu z appky, ať se o data nepřijde.
    function schedulePersist() {
        _dirty = true;
        if (_persistTimer) return;
        _persistTimer = setTimeout(function () { _persistTimer = null; if (_dirty) { _dirty = false; persist(); } }, PERSIST_MS);
    }
    function flushPersist() { if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; } if (_dirty) { _dirty = false; } persist(); }

    function totalLength() {
        var L = 0; for (var i = 1; i < _track.length; i++) { try { L += getDistance(_track[i - 1].lat, _track[i - 1].lng, _track[i].lat, _track[i].lng); } catch (e) {} } return L;
    }
    function durationMs() { return _track.length >= 2 ? (_track[_track.length - 1].t - _track[0].t) : 0; }

    function redraw() {
        var m = getMap();
        if (!m || typeof L === 'undefined') return;
        var latlngs = _track.map(function (p) { return [p.lat, p.lng]; });
        if (_line) { _line.setLatLngs(latlngs); }
        else {
            _line = L.polyline(latlngs, { color: '#f59e0b', weight: 4, opacity: 0.85, dashArray: '1 7', lineCap: 'round' });
            _line.addTo(m);
        }
    }
    function clearLine() { var m = getMap(); if (_line && m) { try { m.removeLayer(_line); } catch (e) {} } _line = null; }
    // Přírůstkové přidání jednoho bodu na čáru — O(1) místo přestavby celé polyline (O(n))
    // při každém vzorku, což u dlouhé stopy taky zatěžovalo hlavní vlákno.
    function appendPoint(lat, lng) {
        var m = getMap();
        if (!m || typeof L === 'undefined') return;
        if (_line) { try { _line.addLatLng([lat, lng]); } catch (e) {} }
        else { redraw(); }
    }

    function sample() {
        if (!_recording) return;
        try {
            if (typeof userLat === 'undefined' || userLat == null || userLng == null) return;
            var last = _track[_track.length - 1];
            if (last) { var moved = getDistance(last.lat, last.lng, userLat, userLng); if (moved < MIN_MOVE_M) return; }
            _track.push({ lat: userLat, lng: userLng, t: Date.now(), a: (typeof currentGpsAccuracy !== 'undefined' ? Math.round(currentGpsAccuracy * 10) / 10 : null) });
            if (_track.length > MAX_PTS) { _track.shift(); redraw(); }   // po oříznutí nutný plný překres
            else { appendPoint(userLat, userLng); }                      // jinak jen připoj nový bod
            schedulePersist(); refreshPanel();
        } catch (e) {}
    }

    function setRecording(on) {
        _recording = on;
        if (on && !_poll) _poll = setInterval(sample, POLL_MS);
        if (!on && _poll) { clearInterval(_poll); _poll = null; }
        if (on) sample();
        else flushPersist();   // při zastavení ulož hned, ať nezůstane viset v dávce
        refreshPanel();
    }

    function clearTrack() {
        agAsk('Smazat zaznamenanou stopu v této zakázce?', { title: 'Smazat stopu', okText: 'Smazat', danger: true }).then(function (ok) {
            if (!ok) return;
            _track = []; if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; } _dirty = false; persist(); clearLine(); refreshPanel();
        });
    }

    // ---- GPX export ------------------------------------------------------------
    function exportGPX() {
        if (_track.length < 2) { agAlert('Krátká stopa', 'Zatím není co exportovat — stopa má méně než 2 body.'); return; }
        var proj = (typeof activeProjectId !== 'undefined') ? activeProjectId : 'trasa';
        var pts = _track.map(function (p) {
            return '   <trkpt lat="' + p.lat.toFixed(7) + '" lon="' + p.lng.toFixed(7) + '">' +
                (p.t ? '<time>' + new Date(p.t).toISOString() + '</time>' : '') + '</trkpt>';
        }).join('\n');
        var gpx = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<gpx version="1.1" creator="AR Geodet" xmlns="http://www.topografix.com/GPX/1/1">\n' +
            ' <trk><name>Stopa ' + proj + '</name><trkseg>\n' + pts + '\n </trkseg></trk>\n</gpx>\n';
        try {
            var blob = new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = 'stopa_' + proj + '.gpx';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (e) { agAlert('Export selhal', 'Nepodařilo se stáhnout GPX.'); }
    }

    // ---- UI --------------------------------------------------------------------
    function fmtDur(ms) { var s = Math.round(ms / 1000); var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); var sec = s % 60; return (h ? h + ' h ' : '') + (m || h ? m + ' min ' : '') + sec + ' s'; }
    function refreshPanel() {
        var modal = document.getElementById('agtr-modal'); if (!modal || modal.style.display !== 'flex') return;
        var L = totalLength();
        var st = document.getElementById('agtr-stats');
        if (st) st.innerHTML = '<b>' + (L >= 1000 ? (L / 1000).toFixed(2) + ' km' : L.toFixed(0) + ' m') + '</b> · ' + _track.length + ' bodů · ' + fmtDur(durationMs());
        var btn = document.getElementById('agtr-toggle');
        if (btn) {
            if (_recording) { btn.innerHTML = '<svg class="icon"><use href="#i-check"/></svg> Nahrávání běží — zastavit'; btn.style.background = 'rgba(239,68,68,0.22)'; btn.style.color = '#f87171'; btn.style.border = '1px solid #ef4444'; }
            else { btn.innerHTML = '<svg class="icon"><use href="#i-star"/></svg> Spustit nahrávání stopy'; btn.style.background = '#f59e0b'; btn.style.color = '#1a1205'; btn.style.border = 'none'; }
        }
    }

    function ensureModal() {
        if (document.getElementById('agtr-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agtr-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:#f59e0b;margin-top:0;">' + ICON + ' Stopa trasy</h3>'
            + '<p style="font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.7;margin:2px 0 10px;">Zaznamenává, kudy jdeš (oranžová čára na mapě). Šetří GPS šum — bere bod po posunu ≥ ' + MIN_MOVE_M + ' m.</p>'
            + '<div id="agtr-stats" style="font-family:var(--font-mono,monospace);margin:6px 0 12px;color:#fbbf24;"></div>'
            + '<button class="btn" id="agtr-toggle"></button>'
            + '<label class="filter-row" style="margin-top:10px;"><input type="checkbox" id="agtr-ar"> Zobrazit stopu i v AR pohledu</label>'
            + '<button class="btn btn-secondary" id="agtr-gpx" style="margin-top:10px;"><svg class="icon"><use href="#i-upload"/></svg> Export GPX</button>'
            + '<button class="btn btn-danger" id="agtr-clear" style="margin-top:10px;"><svg class="icon"><use href="#i-trash"/></svg> Smazat stopu</button>'
            + '<button class="btn btn-secondary" style="margin-top:10px;" onclick="document.getElementById(\'agtr-modal\').style.display=\'none\'">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('agtr-toggle').addEventListener('click', function () { setRecording(!_recording); });
        var arCb = document.getElementById('agtr-ar');
        arCb.checked = !!(window.AGTrackAR && window.AGTrackAR.isOn());
        arCb.addEventListener('change', function () { if (window.AGTrackAR) window.AGTrackAR.set(this.checked); });
        document.getElementById('agtr-gpx').addEventListener('click', exportGPX);
        document.getElementById('agtr-clear').addEventListener('click', clearTrack);
    }

    function openTool() { ensureModal(); redraw(); refreshPanel(); document.getElementById('agtr-modal').style.display = 'flex'; }

    // ---- přepnutí zakázky: znovu načíst + překreslit ---------------------------
    function hookProjectSwitch() {
        try {
            if (typeof loadProjectSettings === 'function' && !loadProjectSettings.__agtr) {
                var _orig = loadProjectSettings;
                loadProjectSettings = function () { setRecording(false); clearLine(); load(); redraw(); refreshPanel(); return _orig.apply(this, arguments); };
                loadProjectSettings.__agtr = true;
            }
        } catch (e) {}
    }

    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'track-log', label: 'Stopa trasy', icon: ICON, onClick: openTool, order: 30 });
        }
    }
    function init() {
        try { load(); hookProjectSwitch(); register(); setTimeout(redraw, 800); } catch (e) { console.warn('[track-log] init', e); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 350); });
    // ulož dávku, když appka jde na pozadí nebo se zavírá (jinak by se ztratilo až PERSIST_MS dat)
    window.addEventListener('pagehide', function () { try { flushPersist(); } catch (e) {} });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { try { flushPersist(); } catch (e) {} } });
    window.agOpenTrackLog = openTool;
    // stopa pro AR vrstvu (js/track-ar.js) — kopie, ať do pole nikdo zvenčí nesahá
    window.agTrackPoints = function () { return _track.slice(); };
})();
