// ===== AR Geodet - TACHYMETRIE / NÁČRT V TERÉNU =====
// EXPERIMENTÁLNÍ a ZÁMĚRNĚ SAMOSTATNÉ: digitalni nahrada rucniho nacrtu. Body se kresli ve
// spravne poloze nad volitelnym podkladem (klasicka mapa OSM / ortofoto CUZK / bez podkladu),
// spojuji se carami ruznych typu a lze vkladat textove popisky (napr. "kamen" uvnitr plochy).
// Podklad = vlastni Leaflet mapa (lze posouvat/zoomovat); nacrt = canvas-overlay nad ni.
// Export jako PNG (vektorovy nacrt na bilem podkladu). Sketch v localStorage ('arTachySketch1').
//
// ODPOJENÍ: smaž <script src="js/tachymetrie.js"> v index.html a tlacitka openTachymetrie().
// Zbytek aplikace se modulu nikde nedotyka.

(function () {
    'use strict';
    const KEY = 'arTachySketch1', BG_KEY = 'arTachyBg';
    const LINE_TYPES = [
        { name: 'Plná', color: '#16a34a', dash: [] },
        { name: 'Hranice', color: '#d97706', dash: [] },
        { name: 'Čárkovaná', color: '#2563eb', dash: [9, 7] },
        { name: 'Plot', color: '#dc2626', dash: [2, 5] }
    ];
    // pts: {name, lat, lng}; lines: [i, j, typeIdx]; labels: {lat, lng, text}; log: ['pt'|'line'|'label']
    let sketch = { pts: [], lines: [], labels: [], log: [] };
    let tmap = null, osmL = null, ortoL = null, curBg = 'osm';
    let canvas, ctx;
    let mode = 'view', selIdx = -1;

    function load() { try { const s = localStorage.getItem(KEY); if (s) sketch = JSON.parse(s); } catch (e) {} normalize(); try { curBg = localStorage.getItem(BG_KEY) || 'osm'; } catch (e) { curBg = 'osm'; } }
    function normalize() { if (!sketch || typeof sketch !== 'object') sketch = {}; sketch.pts = sketch.pts || []; sketch.lines = sketch.lines || []; sketch.labels = sketch.labels || []; sketch.log = sketch.log || []; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(sketch)); } catch (e) {} }

    // ---------- UI ----------
    function build() {
        if (document.getElementById('tachy-modal')) return;
        const opts = LINE_TYPES.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
        const m = document.createElement('div');
        m.id = 'tachy-modal';
        m.style.cssText = 'position:fixed; inset:0; z-index:1000000; background:#0e1116; display:none; flex-direction:column;';
        m.innerHTML = `
            <div style="display:flex; align-items:center; gap:6px; padding:calc(env(safe-area-inset-top,0px) + 8px) 10px 8px; background:#161b22; flex-wrap:wrap;">
                <b style="color:#34d399; margin-right:auto;">Náčrt / Tachymetrie</b>
                <button class="btn btn-primary" style="padding:7px 10px; width:auto;" onclick="tachyAddCurrent()">+ Bod (GPS)</button>
                <button class="btn btn-secondary" style="padding:7px 10px; width:auto;" onclick="tachyAddFromPoints()">+ Z bodů</button>
                <button class="btn btn-secondary" id="tachy-connect" style="padding:7px 10px; width:auto;" onclick="tachySetMode('connect')">Spojit</button>
                <select id="tachy-linetype" title="Typ čáry" style="padding:7px; border-radius:8px; background:#21262d; color:#e6edf3; border:1px solid var(--glass-border,#333);">${opts}</select>
                <button class="btn btn-secondary" id="tachy-label" style="padding:7px 10px; width:auto;" onclick="tachySetMode('label')">Popisek</button>
                <select id="tachy-bg" title="Podklad" style="padding:7px; border-radius:8px; background:#21262d; color:#e6edf3; border:1px solid var(--glass-border,#333);" onchange="tachySetBg(this.value)">
                    <option value="osm">Mapa</option><option value="ortofoto">Ortofoto</option><option value="none">Bez podkladu</option>
                </select>
                <button class="btn btn-secondary" style="padding:7px 10px; width:auto;" onclick="tachyUndo()">Zpět</button>
                <button class="btn btn-secondary" style="padding:7px 10px; width:auto;" onclick="tachyExport()">Export PNG</button>
                <button class="btn btn-warning" style="padding:7px 10px; width:auto;" onclick="tachyClear()">Vymazat</button>
                <button class="btn btn-secondary" style="padding:7px 10px; width:auto;" onclick="closeTachymetrie()">Zavřít</button>
            </div>
            <div id="tachy-hint" style="color:#9aa4b2; font-size:12px; padding:4px 12px;"></div>
            <div id="tachy-wrap" style="position:relative; flex:1; min-height:0;">
                <div id="tachy-map" style="position:absolute; inset:0; background:#0e1116;"></div>
                <canvas id="tachy-canvas" style="position:absolute; inset:0; pointer-events:none; z-index:500;"></canvas>
            </div>`;
        document.body.appendChild(m);
        canvas = document.getElementById('tachy-canvas');
        ctx = canvas.getContext('2d');
    }

    function ensureMap() {
        if (tmap) return;
        tmap = L.map('tachy-map', { maxZoom: 22, minZoom: 10, zoomControl: true, attributionControl: true });
        osmL = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22, maxNativeZoom: 18 });
        ortoL = L.tileLayer.wms('https://ags.cuzk.gov.cz/arcgis1/services/ORTOFOTO/MapServer/WMSServer', { layers: '0', format: 'image/jpeg', version: '1.3.0', maxZoom: 22, attribution: '© ČÚZK' });
        applyBg();
        tmap.on('move zoom zoomend moveend viewreset resize', redraw);
        tmap.on('click', onMapClick);
    }
    function applyBg() {
        if (!tmap) return;
        if (osmL && tmap.hasLayer(osmL)) tmap.removeLayer(osmL);
        if (ortoL && tmap.hasLayer(ortoL)) tmap.removeLayer(ortoL);
        if (curBg === 'osm') osmL.addTo(tmap);
        else if (curBg === 'ortofoto') ortoL.addTo(tmap);
        // 'none' -> zadna dlazdicova vrstva (tmava plocha)
    }
    window.tachySetBg = function (v) { curBg = v; try { localStorage.setItem(BG_KEY, v); } catch (e) {} applyBg(); redraw(); };

    function fitView() {
        if (sketch.pts.length >= 2) { tmap.fitBounds(L.latLngBounds(sketch.pts.map(p => [p.lat, p.lng])).pad(0.35), { maxZoom: 21 }); }
        else if (sketch.pts.length === 1) { tmap.setView([sketch.pts[0].lat, sketch.pts[0].lng], 20); }
        else if (typeof userLat !== 'undefined' && userLat) { tmap.setView([userLat, userLng], 19); }
        else { tmap.setView([49.8, 15.5], 8); }
    }

    window.openTachymetrie = function () {
        load(); build();
        document.getElementById('tachy-modal').style.display = 'flex';
        document.getElementById('tachy-bg').value = curBg;
        mode = 'view'; selIdx = -1; updateModeButtons();
        setTimeout(() => { ensureMap(); tmap.invalidateSize(); fitView(); redraw(); }, 60);
    };
    window.closeTachymetrie = function () { const m = document.getElementById('tachy-modal'); if (m) m.style.display = 'none'; };

    // ---------- Přidávání ----------
    function nextName() { let n = 1; const used = new Set(sketch.pts.map(p => p.name)); while (used.has(String(n))) n++; return String(n); }

    window.tachyAddCurrent = function () {
        let lat = null, lng = null;
        if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && gpsAvgResult.lat) { lat = gpsAvgResult.lat; lng = gpsAvgResult.lng; }
        else if (typeof userLat !== 'undefined' && userLat) { lat = userLat; lng = userLng; }
        if (lat == null) { alert('Zatím nemám GPS polohu.'); return; }
        const nm = prompt('Číslo / označení bodu:', nextName());
        if (nm === null) return;
        sketch.pts.push({ name: nm.trim() || nextName(), lat: lat, lng: lng }); sketch.log.push('pt');
        save();
        if (sketch.pts.length === 1 && tmap) tmap.setView([lat, lng], 20);
        redraw();
        hint('Přidán bod „' + sketch.pts[sketch.pts.length - 1].name + '". Stůjte na bodě a měřte přesně.');
    };

    window.tachyAddFromPoints = function () {
        if (typeof persistentCustomPoints === 'undefined' || !persistentCustomPoints.length) { alert('Nemáte žádné vlastní body.'); return; }
        let added = 0;
        persistentCustomPoints.forEach(p => {
            const exists = sketch.pts.some(s => Math.abs(s.lat - p.lat) < 1e-6 && Math.abs(s.lng - p.lng) < 1e-6);
            if (!exists) { sketch.pts.push({ name: String(p.name || nextName()), lat: p.lat, lng: p.lng }); sketch.log.push('pt'); added++; }
        });
        save(); if (added && tmap) fitView(); redraw();
        hint(added ? ('Přidáno ' + added + ' bodů z „Mé body".') : 'Všechny vaše body už v náčrtu jsou.');
    };

    // ---------- Režimy ----------
    window.tachySetMode = function (mWanted) {
        mode = (mode === mWanted) ? 'view' : mWanted; selIdx = -1; updateModeButtons(); redraw();
        hint(mode === 'connect' ? 'Spojování: klepněte na první a pak druhý bod. Typ čáry vyberte vlevo.' : mode === 'label' ? 'Popisek: klepněte do prázdna pro nový text, na popisek pro úpravu/smazání.' : 'Mapu lze posouvat a zoomovat.');
    };
    function updateModeButtons() {
        const c = document.getElementById('tachy-connect'), l = document.getElementById('tachy-label');
        if (c) { c.style.background = mode === 'connect' ? 'var(--accent)' : ''; c.style.color = mode === 'connect' ? '#000' : ''; }
        if (l) { l.style.background = mode === 'label' ? 'var(--accent)' : ''; l.style.color = mode === 'label' ? '#000' : ''; }
    }
    function curLineType() { const s = document.getElementById('tachy-linetype'); return s ? (parseInt(s.value) || 0) : 0; }

    window.tachyUndo = function () {
        const last = sketch.log.length ? sketch.log.pop() : (sketch.lines.length ? 'line' : (sketch.labels.length ? 'label' : (sketch.pts.length ? 'pt' : null)));
        if (last === 'line') sketch.lines.pop();
        else if (last === 'label') sketch.labels.pop();
        else if (last === 'pt') { const ri = sketch.pts.length - 1; sketch.pts.pop(); sketch.lines = sketch.lines.filter(l => l[0] !== ri && l[1] !== ri); }
        save(); redraw();
    };
    window.tachyClear = function () { if ((!sketch.pts.length && !sketch.labels.length) || confirm('Vymazat celý náčrt?')) { sketch = { pts: [], lines: [], labels: [], log: [] }; selIdx = -1; save(); redraw(); } };

    // ---------- Interakce (přes klik do mapy) ----------
    function onMapClick(e) {
        const px = e.containerPoint.x, py = e.containerPoint.y;
        if (mode === 'label') {
            let lbi = -1, lbD = 26 * 26;
            sketch.labels.forEach((lb, i) => { const s = scr(lb); const d = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py); if (d < lbD) { lbD = d; lbi = i; } });
            if (lbi >= 0) { const nt = prompt('Upravit popisek (prázdné = smazat):', sketch.labels[lbi].text); if (nt === null) return; if (!nt.trim()) sketch.labels.splice(lbi, 1); else sketch.labels[lbi].text = nt.trim(); save(); redraw(); return; }
            const t = prompt('Text popisku (např. kámen, šachta, strom):', ''); if (t === null || !t.trim()) return;
            sketch.labels.push({ lat: e.latlng.lat, lng: e.latlng.lng, text: t.trim() }); sketch.log.push('label'); save(); redraw(); return;
        }
        let best = -1, bestD = 24 * 24;
        sketch.pts.forEach((p, i) => { const s = scr(p); const d = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py); if (d < bestD) { bestD = d; best = i; } });
        if (best < 0) { selIdx = -1; redraw(); return; }
        if (mode === 'connect') {
            if (selIdx < 0) selIdx = best;
            else if (selIdx !== best) { const ex = sketch.lines.some(l => (l[0] === selIdx && l[1] === best) || (l[0] === best && l[1] === selIdx)); if (!ex) { sketch.lines.push([selIdx, best, curLineType()]); sketch.log.push('line'); } selIdx = best; save(); }
        } else selIdx = (selIdx === best ? -1 : best);
        redraw();
    }

    // projekce lat/lng -> pixel v canvasu (= container point mapy)
    function scr(p) { const pt = tmap.latLngToContainerPoint([p.lat, p.lng]); return { x: pt.x, y: pt.y }; }

    // ---------- Vykreslení ----------
    function syncSize() { if (!tmap) return; const s = tmap.getSize(); if (canvas.width !== s.x || canvas.height !== s.y) { canvas.width = s.x; canvas.height = s.y; } }
    function hint(t) { const h = document.getElementById('tachy-hint'); if (h) h.innerText = t; }

    function redraw() {
        if (!ctx || !tmap) return;
        syncSize();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawScaleBar();
        // čáry
        sketch.lines.forEach(l => {
            const t = LINE_TYPES[l[2] || 0] || LINE_TYPES[0];
            const a = scr(sketch.pts[l[0]]), b = scr(sketch.pts[l[1]]);
            ctx.strokeStyle = t.color; ctx.lineWidth = 3; ctx.setLineDash(t.dash || []);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        });
        ctx.setLineDash([]);
        // popisky
        sketch.labels.forEach(lb => {
            const s = scr(lb);
            ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const w = ctx.measureText(lb.text).width + 14;
            ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.strokeStyle = '#92400e'; ctx.lineWidth = 1;
            roundRect(ctx, s.x - w / 2, s.y - 12, w, 24, 6); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#7c2d12'; ctx.fillText(lb.text, s.x, s.y);
        });
        ctx.textBaseline = 'alphabetic';
        // body + čísla
        sketch.pts.forEach((p, i) => {
            const s = scr(p);
            ctx.beginPath(); ctx.arc(s.x, s.y, i === selIdx ? 8 : 5.5, 0, 2 * Math.PI);
            ctx.fillStyle = i === selIdx ? '#fbbf24' : '#2563eb'; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(p.name, s.x + 9, s.y - 7); ctx.fillText(p.name, s.x + 9, s.y - 7);
        });
        hint(`${sketch.pts.length} bodů · ${sketch.lines.length} čar · ${sketch.labels.length} popisků` + (mode === 'connect' ? ' · spojuji' : mode === 'label' ? ' · popisek' : ''));
    }

    function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

    function drawScaleBar() {
        if (!tmap) return;
        const h = canvas.height, y = Math.round(h / 2);
        const mPer100 = tmap.distance(tmap.containerPointToLatLng([0, y]), tmap.containerPointToLatLng([100, y])); // metru na 100 px
        if (!mPer100 || !isFinite(mPer100)) return;
        const mpp = mPer100 / 100;
        const targets = [1, 2, 5, 10, 20, 50, 100, 200, 500];
        let meters = 10, px = meters / mpp;
        for (const t of targets) { const p = t / mpp; if (p >= 50 && p <= 170) { meters = t; px = p; break; } }
        const x0 = 16, y0 = h - 22;
        ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0 + 5); ctx.moveTo(x0 + px, y0 - 5); ctx.lineTo(x0 + px, y0 + 5); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(meters + ' m', x0 + px + 8, y0 + 4); ctx.fillText(meters + ' m', x0 + px + 8, y0 + 4);
        ctx.textAlign = 'center'; ctx.strokeText('S ↑', canvas.width - 24, 24); ctx.fillText('S ↑', canvas.width - 24, 24);
    }

    window.tachyExport = function () {
        if (!sketch.pts.length) { alert('Náčrt je prázdný.'); return; }
        // vektorovy nacrt na bilem podkladu (mapove dlazdice se kvuli CORS do PNG spolehlive neprenesou)
        const exp = document.createElement('canvas'); exp.width = canvas.width; exp.height = canvas.height;
        const c = exp.getContext('2d');
        c.fillStyle = '#fff'; c.fillRect(0, 0, exp.width, exp.height);
        sketch.lines.forEach(l => { const t = LINE_TYPES[l[2] || 0] || LINE_TYPES[0]; const a = scr(sketch.pts[l[0]]), b = scr(sketch.pts[l[1]]); c.strokeStyle = t.color; c.lineWidth = 2.5; c.setLineDash(t.dash || []); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); });
        c.setLineDash([]);
        c.textBaseline = 'middle'; c.textAlign = 'center';
        sketch.labels.forEach(lb => { const s = scr(lb); c.font = 'bold 14px sans-serif'; c.fillStyle = '#7c2d12'; c.fillText(lb.text, s.x, s.y); });
        c.textBaseline = 'alphabetic'; c.textAlign = 'left';
        sketch.pts.forEach(p => { const s = scr(p); c.beginPath(); c.arc(s.x, s.y, 4.5, 0, 2 * Math.PI); c.fillStyle = '#2563eb'; c.fill(); c.fillStyle = '#111'; c.font = 'bold 13px sans-serif'; c.fillText(p.name, s.x + 8, s.y - 6); });
        try {
            const url = exp.toDataURL('image/png');
            const a = document.createElement('a'); a.href = url;
            a.download = 'nacrt_' + (typeof activeProjectId !== 'undefined' ? activeProjectId : 'tachymetrie') + '.png';
            document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { alert('Export selhal: ' + (e && e.message ? e.message : e)); }
    };
})();
