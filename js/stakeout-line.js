// ===== AR Geodet — VYTYČENÍ PŘÍMKY + STANIČENÍ (ODPOJITELNÁ vrstva) ============
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Pro liniové stavby:
// zadáš přímku dvěma body (A→B) a appka ti za chůze ukazuje:
//   • STANIČENÍ — jak daleko jsi od A podél přímky,
//   • KOLMÝ ODSTUP — jak jsi vlevo/vpravo od osy,
//   • ZBÝVÁ do B.
// Umí i obráceně VYTYČIT bod na zadaném staničení (+ kolmý posun) a uložit ho.
//
// Výpočet je v lokální rovině v metrech kolem A (přesné na délky přímky v km).
// Vstup: tlačítko „Vytyčení přímky" v launcheru (js/field-tools.js).
// Odstranění: smaž js/stakeout-line.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 20 4"/><circle cx="4" cy="20" r="2.2" fill="currentColor"/><circle cx="20" cy="4" r="2.2" fill="currentColor"/><path d="M12 12l3 3" opacity=".6"/></svg>';
    var _aId = null, _bId = null, _timer = null;

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function num(id) { var el = document.getElementById(id); var v = el ? parseFloat(String(el.value).replace(',', '.')) : NaN; return isFinite(v) ? v : NaN; }
    function ptById(id) { if (typeof arPoints === 'undefined') return null; return arPoints.find(function (q) { return q.id === id; }) || (typeof persistentCustomPoints !== 'undefined' ? persistentCustomPoints.find(function (q) { return q.id === id; }) : null) || null; }

    // lokální rovinné metry kolem referenčního bodu (lat0,lng0);
    // poloměry křivosti elipsoidu (GeoCore) místo konstanty 111320 (~0,15 % chyba)
    function _mpd(lat0) {
        return (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) ? GeoCore.metersPerDeg(lat0) : { lat: 111320, lng: 111320 * Math.cos(lat0 * Math.PI / 180) };
    }
    function enu(lat0, lng0, lat, lng) {
        var m = _mpd(lat0);
        return { e: (lng - lng0) * m.lng, n: (lat - lat0) * m.lat };
    }
    function fromEnu(lat0, lng0, e, n) {
        var m = _mpd(lat0);
        return { lat: lat0 + n / m.lat, lng: lng0 + e / m.lng };
    }

    function geometry() {
        var A = ptById(_aId), B = ptById(_bId);
        if (!A || !B) return null;
        var b = enu(A.lat, A.lng, B.lat, B.lng);
        var len = Math.hypot(b.e, b.n);
        if (len < 0.001) return null;
        return { A: A, B: B, bE: b.e, bN: b.n, len: len, uE: b.e / len, uN: b.n / len };
    }

    function fillSelects() {
        if (typeof arPoints === 'undefined') return;
        var list = arPoints.filter(function (p) { return !p.hidden; })
            .map(function (p) { return { p: p, d: (typeof userLat !== 'undefined' && userLat != null) ? getDistance(userLat, userLng, p.lat, p.lng) : null }; })
            .sort(function (a, b) { return (a.d == null || b.d == null) ? 0 : a.d - b.d; });
        var opts = list.map(function (x) { return '<option value="' + x.p.id + '">#' + x.p.name + (x.d != null ? ' · ' + x.d.toFixed(0) + ' m' : '') + '</option>'; }).join('');
        var sa = document.getElementById('agsl-a'), sb = document.getElementById('agsl-b');
        if (sa) sa.innerHTML = opts; if (sb) sb.innerHTML = opts;
        if (list.length) {
            if (_aId == null || !list.some(function (x) { return x.p.id === _aId; })) _aId = list[0].p.id;
            if (_bId == null || !list.some(function (x) { return x.p.id === _bId; })) _bId = (list[1] || list[0]).p.id;
            if (sa) sa.value = _aId; if (sb) sb.value = _bId;
        }
    }

    function refresh() {
        var g = geometry();
        var live = document.getElementById('agsl-live');
        var head = document.getElementById('agsl-lineinfo');
        if (!g) { if (live) live.innerHTML = '<span style="opacity:.6">Vyber dva různé body (A → B).</span>'; if (head) head.innerHTML = ''; return; }
        if (head) head.innerHTML = 'Přímka #' + g.A.name + ' → #' + g.B.name + ' · délka <b>' + g.len.toFixed(2) + ' m</b>';
        if (typeof userLat === 'undefined' || userLat == null) { if (live) live.innerHTML = '<span style="opacity:.6">Čekám na GPS polohu…</span>'; return; }
        var u = enu(g.A.lat, g.A.lng, userLat, userLng);
        var station = u.e * g.uE + u.n * g.uN;             // podél přímky od A
        var offset = g.uE * u.n - g.uN * u.e;              // + = vlevo od směru A→B
        var remain = g.len - station;
        var side = offset >= 0 ? 'vlevo' : 'vpravo';
        var offCol = Math.abs(offset) <= 0.30 ? '#34d399' : (Math.abs(offset) <= 1 ? '#fbbf24' : '#f87171');
        if (live) live.innerHTML =
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>Staničení</span><b>' + station.toFixed(2) + ' m</b></div>'
            + '<div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>Kolmý odstup</span><b style="color:' + offCol + '">' + Math.abs(offset).toFixed(2) + ' m ' + side + '</b></div>'
            + '<div style="display:flex;justify-content:space-between;"><span>Zbývá do #' + g.B.name + '</span><b>' + remain.toFixed(2) + ' m</b></div>';
    }

    // silent = jen náhled (otevření nástroje, psaní do políčka) → nehlásit prázdná pole;
    // hláška patří až k pokusu o uložení, jinak vyskočí dřív, než uživatel stihne cokoli zadat.
    function computeStakePoint(silent) {
        var g = geometry(); if (!g) { if (!silent) agAlert('Chybí přímka', 'Vyber dva různé body.'); return null; }
        var s = num('agsl-stat'); if (isNaN(s)) { if (!silent) agAlert('Chybí staničení', 'Zadej staničení v metrech.'); return null; }
        var o = num('agsl-off'); if (isNaN(o)) o = 0;   // + = VLEVO, − = vpravo (SHODNĚ se živým odečtem)
        // bod na ose: A + s*u ; kolmice vlevo = (-uN, uE) [+], vpravo = (uN, -uE) [−]
        var e = s * g.uE + o * (-g.uN);
        var n = s * g.uN + o * (g.uE);
        var ll = fromEnu(g.A.lat, g.A.lng, e, n);
        var sj = proj4('EPSG:4326', 'EPSG:5514', [ll.lng, ll.lat]);
        return { lat: ll.lat, lng: ll.lng, Y: Math.abs(sj[0]).toFixed(2), X: Math.abs(sj[1]).toFixed(2), s: s, o: o, g: g };
    }
    function previewStake() {
        var r = computeStakePoint(true); var out = document.getElementById('agsl-stake-out'); if (!out) return;
        if (!r) { out.innerHTML = ''; return; }
        out.innerHTML = '<b>Y</b> ' + r.Y + ' &nbsp; <b>X</b> ' + r.X + '<br><span style="opacity:.65;font-size:12px">staničení ' + r.s.toFixed(2) + ' m' + (r.o ? ', odstup ' + Math.abs(r.o).toFixed(2) + ' m ' + (r.o > 0 ? 'vlevo' : 'vpravo') : ' na ose') + '</span>';
    }
    function saveStake() {
        var r = computeStakePoint(); if (!r) return;
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Vkládání bodů není dostupné.'); return; }
        var name = (document.getElementById('agsl-name').value || '').trim() || ('ST' + Math.round(r.s));
        var added = window.addImportedPoints([{ name: name, lat: r.lat, lng: r.lng }]);
        if (added > 0) agAlert('Bod uložen', '#' + name + ' (staničení ' + r.s.toFixed(2) + ' m) uložen do zakázky.\nNavigovat můžeš přes seznam Body.');
        else agAlert('Neuloženo', 'Bod se stejným názvem a polohou už v zakázce je.');
    }

    function ensureModal() {
        if (document.getElementById('agsl-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agsl-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Vytyčení přímky + staničení</h3>'
            + '<div style="display:flex;gap:8px;">'
            + '  <div style="flex:1;"><label>Bod A (počátek)</label><select id="agsl-a"></select></div>'
            + '  <div style="flex:1;"><label>Bod B (konec)</label><select id="agsl-b"></select></div>'
            + '</div>'
            + '<div id="agsl-lineinfo" style="font-size:13px;margin:8px 0;color:var(--accent);"></div>'
            + '<div id="agsl-live" style="margin:6px 0 12px;padding:12px 14px;border-radius:10px;background:rgba(47,158,116,0.12);font-family:var(--font-mono,monospace);font-size:14px;"></div>'
            + '<details class="adv"><summary><svg class="icon"><use href="#i-crosshair"/></svg> Vytyčit bod na staničení</summary><div class="adv-body">'
            + '  <label>Staničení od A (m)</label><input type="number" id="agsl-stat" step="0.01" inputmode="decimal" placeholder="např. 25.00">'
            + '  <label style="margin-top:6px;">Kolmý odstup (m, + vlevo / − vpravo)</label><input type="number" id="agsl-off" step="0.01" inputmode="decimal" placeholder="0">'
            + '  <label style="margin-top:6px;">Název bodu</label><input type="text" id="agsl-name" placeholder="ST25">'
            + '  <div id="agsl-stake-out" style="margin:10px 0;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);font-family:var(--font-mono,monospace);"></div>'
            + '  <button class="btn" id="agsl-save"><svg class="icon"><use href="#i-plus"/></svg> Uložit vytyčovaný bod</button>'
            + '</div></details>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" onclick="window.agCloseStakeLine&&window.agCloseStakeLine()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('agsl-a').addEventListener('change', function () { _aId = this.value; refresh(); });
        document.getElementById('agsl-b').addEventListener('change', function () { _bId = this.value; refresh(); });
        document.getElementById('agsl-stat').addEventListener('input', previewStake);
        document.getElementById('agsl-off').addEventListener('input', previewStake);
        document.getElementById('agsl-save').addEventListener('click', saveStake);
    }

    function openTool() {
        ensureModal(); fillSelects(); refresh(); previewStake();
        document.getElementById('agsl-modal').style.display = 'flex';
        if (!_timer) _timer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () { var m = document.getElementById('agsl-modal'); if (m && m.style.display === 'flex') refresh(); }, 300);
    }
    window.agCloseStakeLine = function () {
        var m = document.getElementById('agsl-modal'); if (m) m.style.display = 'none';
        if (_timer) { (window.AG && AG.clearUiInterval ? AG.clearUiInterval : clearInterval)(_timer); _timer = null; }
    };

    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'stakeout-line', label: 'Vytyčení přímky', icon: ICON, onClick: openTool, order: 40 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
    window.agOpenStakeLine = openTool;
})();
