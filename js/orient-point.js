// ===== AR Geodet — SROVNÁNÍ SEVERU PODLE ZNÁMÉHO BODU (ODPOJITELNÁ vrstva) =====
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Řeší nejslabší článek
// AR — magnetický kompas: místo spoléhání na magnetometr namíříš telefon na
// VIDITELNÝ známý bod (trig./BP/roh) a appka srovná sever podle skutečného
// azimutu k němu. Korekci aplikuje přes existující nudgeHeadingOffset() (stejná
// páka jako „Srovnání severu" v nastavení kompasu), takže přežije i uložení.
//
// Vstup: tlačítko „Srovnat podle bodu" v launcheru (js/field-tools.js).
// Odstranění: smaž js/orient-point.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="12,7 14.5,14.5 12,13 9.5,14.5" fill="currentColor" stroke="none"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>';
    var _selId = null;
    var _timer = null;
    var _lastDelta = null;

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function adiff(a, b) { try { if (typeof angDiff === 'function') return angDiff(a, b); } catch (e) {} return ((a - b + 540) % 360) - 180; }

    function points() {
        if (typeof arPoints === 'undefined') return [];
        return arPoints.filter(function (p) { return !p.hidden; })
            .map(function (p) { return { p: p, d: (typeof userLat !== 'undefined' && userLat != null) ? getDistance(userLat, userLng, p.lat, p.lng) : null }; })
            .sort(function (a, b) {
                // úřední body (s autoritativními souřadnicemi) napřed, pak dle vzdálenosti
                var oa = (a.p.cat && a.p.cat !== 'CUSTOM') ? 0 : 1, ob = (b.p.cat && b.p.cat !== 'CUSTOM') ? 0 : 1;
                if (oa !== ob) return oa - ob;
                return (a.d == null || b.d == null) ? 0 : a.d - b.d;
            });
    }

    function selectedPoint() {
        if (typeof arPoints === 'undefined') return null;
        return arPoints.find(function (q) { return q.id === _selId; }) || null;
    }

    function fillSelect() {
        var sel = document.getElementById('agor-point'); if (!sel) return;
        var list = points();
        sel.innerHTML = list.map(function (x) {
            return '<option value="' + x.p.id + '">#' + x.p.name + (x.d != null ? ' · ' + x.d.toFixed(0) + ' m' : '') + (x.p.cat && x.p.cat !== 'CUSTOM' ? ' · ' + x.p.cat : '') + '</option>';
        }).join('');
        if (list.length) { if (_selId == null || !list.some(function (x) { return x.p.id === _selId; })) _selId = list[0].p.id; sel.value = _selId; }
        else sel.innerHTML = '<option value="">Žádné body — stáhni okolí / přidej bod</option>';
    }

    function refresh() {
        var pt = selectedPoint();
        var info = document.getElementById('agor-live');
        var btn = document.getElementById('agor-apply');
        if (!pt || typeof userLat === 'undefined' || userLat == null) {
            if (info) info.innerHTML = '<span style="opacity:.6">Čekám na polohu a výběr bodu…</span>';
            if (btn) btn.disabled = true;
            return;
        }
        var _o = (window.AGPose && window.AGPose.origin) ? window.AGPose.origin(userLat, userLng) : [userLat, userLng];   // #5: azimut z kotveného stanoviska, ne syrové GPS
        var bearing = getBearing(_o[0], _o[1], pt.lat, pt.lng);
        var head = (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null;
        var dist = getDistance(_o[0], _o[1], pt.lat, pt.lng);
        if (head == null) {
            if (info) info.innerHTML = 'Azimut k bodu <b>' + bearing.toFixed(1) + '°</b><br><span style="opacity:.6">Kompas zatím nedává směr — podrž telefon svisle.</span>';
            if (btn) btn.disabled = true;
            return;
        }
        var delta = adiff(bearing, head);
        if (info) info.innerHTML =
            'Azimut k bodu: <b>' + bearing.toFixed(1) + '°</b> · vzdálenost ' + dist.toFixed(0) + ' m<br>'
            + 'Kompas teď: <b>' + head.toFixed(1) + '°</b><br>'
            + 'Rozdíl k srovnání: <b style="color:' + (Math.abs(delta) > 8 ? '#fbbf24' : '#34d399') + '">' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + '°</b>';
        if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="icon"><use href="#i-check"/></svg> Srovnat sever (' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + '°)'; }
    }

    function apply() {
        var pt = selectedPoint();
        if (!pt || typeof userLat === 'undefined' || userLat == null) return;
        if (typeof currentHeading !== 'number' || !isFinite(currentHeading)) { agAlert('Bez směru', 'Kompas zatím nedává směr.'); return; }
        var _o = (window.AGPose && window.AGPose.origin) ? window.AGPose.origin(userLat, userLng) : [userLat, userLng];   // #5
        var bearing = getBearing(_o[0], _o[1], pt.lat, pt.lng);
        var delta = adiff(bearing, currentHeading);
        if (typeof nudgeHeadingOffset === 'function') { nudgeHeadingOffset(delta); }
        else if (typeof userHeadingOffset !== 'undefined') {
            try { userHeadingOffset = ((userHeadingOffset + delta) % 360 + 360) % 360; if (typeof setStoredData === 'function') setStoredData('arHeadingOffset', String(userHeadingOffset)); } catch (e) {}
            if (typeof updateHeadingOffsetVal === 'function') updateHeadingOffsetVal();
        } else { agAlert('Nelze srovnat', 'Korekce kompasu není dostupná.'); return; }
        _lastDelta = delta;
        var undo = document.getElementById('agor-undo'); if (undo) undo.style.display = 'block';
        var _nm = String(pt.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        agAlert('Sever srovnán', 'Sever srovnán podle #' + _nm + ' (' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + '°).\nPři pomalé chůzi to drží; pokud máš zapnutou auto-korekci podle GPS, za rychlé chůze se může dolaďovat sama.');
        refresh();
    }

    function undo() {
        if (_lastDelta == null) return;
        if (typeof nudgeHeadingOffset === 'function') nudgeHeadingOffset(-_lastDelta);
        else if (typeof userHeadingOffset !== 'undefined') { try { userHeadingOffset = ((userHeadingOffset - _lastDelta) % 360 + 360) % 360; if (typeof setStoredData === 'function') setStoredData('arHeadingOffset', String(userHeadingOffset)); if (typeof updateHeadingOffsetVal === 'function') updateHeadingOffsetVal(); } catch (e) {} }
        _lastDelta = null;
        var u = document.getElementById('agor-undo'); if (u) u.style.display = 'none';
        refresh();
    }

    function ensureModal() {
        if (document.getElementById('agor-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agor-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Srovnat sever podle bodu</h3>'
            + '<ol style="font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.8;margin:2px 0 10px;padding-left:18px;line-height:1.45;">'
            + '<li>Vyber <b>viditelný</b> známý bod (ideálně trig./BP nebo roh).</li>'
            + '<li>Namiř <b>střed obrazu</b> přesně na něj a chvíli podrž.</li>'
            + '<li>Klepni <b>Srovnat sever</b>.</li></ol>'
            + '<label>Známý bod</label>'
            + '<select id="agor-point"></select>'
            + '<div id="agor-live" style="margin:12px 0;padding:10px 12px;border-radius:10px;background:rgba(47,158,116,0.12);font-family:var(--font-mono,monospace);font-size:calc(13px * var(--ag-font-scale, 1));"></div>'
            + '<button class="btn" id="agor-apply"></button>'
            + '<button class="btn btn-warning" id="agor-undo" style="margin-top:10px;display:none;"><svg class="icon"><use href="#i-rotate-ccw"/></svg> Vrátit poslední srovnání</button>'
            + '<button class="btn btn-secondary" style="margin-top:10px;" onclick="window.agCloseOrientTool&&window.agCloseOrientTool()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('agor-point').addEventListener('change', function () { _selId = this.value; refresh(); });
        document.getElementById('agor-apply').addEventListener('click', apply);
        document.getElementById('agor-undo').addEventListener('click', undo);
    }

    function openTool() {
        ensureModal(); fillSelect(); refresh();
        document.getElementById('agor-modal').style.display = 'flex';
        if (!_timer) _timer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () { var m = document.getElementById('agor-modal'); if (m && m.style.display === 'flex') refresh(); }, 250);
    }
    window.agCloseOrientTool = function () {
        var m = document.getElementById('agor-modal'); if (m) m.style.display = 'none';
        if (_timer) { (window.AG && AG.clearUiInterval ? AG.clearUiInterval : clearInterval)(_timer); _timer = null; }
    };

    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'orient-point', label: 'Srovnat podle bodu', icon: ICON, onClick: openTool, order: 10 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
    window.agOpenOrientTool = openTool;
})();
