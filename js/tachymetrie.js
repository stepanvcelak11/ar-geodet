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
    function injectStyle() {
        if (document.getElementById('tachy-style')) return;
        const st = document.createElement('style'); st.id = 'tachy-style';
        st.textContent = `
            #tachy-modal{position:fixed;inset:0;z-index:1000000;background:#0b0f14;display:none;flex-direction:column;font-family:var(--font-ui,sans-serif);}
            #tachy-top{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px;background:#11161d;border-bottom:1px solid rgba(255,255,255,0.08);}
            #tachy-top .tt-title{display:flex;align-items:center;gap:8px;font-family:var(--font-display,sans-serif);font-weight:700;font-size:16px;color:#fff;margin-right:auto;}
            #tachy-top .tt-title .icon{width:20px;height:20px;color:var(--accent,#34d399);}
            #tachy-x{flex:none;width:36px;height:36px;border:none;border-radius:10px;background:rgba(255,255,255,0.08);color:#fff;font-size:20px;line-height:1;cursor:pointer;}
            #tachy-x:active{transform:scale(0.95);}
            #tachy-bar{display:flex;align-items:center;gap:7px;padding:9px 12px;background:#0e1319;border-bottom:1px solid rgba(255,255,255,0.06);overflow-x:auto;-webkit-overflow-scrolling:touch;}
            #tachy-bar::-webkit-scrollbar{height:0;}
            .tb-btn{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 13px;border-radius:11px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#e6edf3;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap;}
            .tb-btn .icon{width:17px;height:17px;}
            .tb-btn:active{transform:scale(0.97);}
            .tb-btn.prim{background:var(--accent,#34d399);border-color:transparent;color:#06231a;}
            .tb-btn.warn{color:#fca5a5;border-color:rgba(248,113,113,0.4);}
            .tb-btn.active{background:var(--accent,#34d399);border-color:transparent;color:#06231a;}
            .tb-sel{flex:0 0 auto;height:40px;padding:0 10px;border-radius:11px;background:rgba(255,255,255,0.06);color:#e6edf3;border:1px solid rgba(255,255,255,0.12);font-size:13px;}
            .tb-sep{flex:0 0 auto;width:1px;height:24px;background:rgba(255,255,255,0.12);margin:0 3px;}
            #tachy-hint{color:#9aa4b2;font-size:12px;padding:7px 14px;background:#0b0f14;border-bottom:1px solid rgba(255,255,255,0.05);min-height:16px;}
            #tachy-wrap{position:relative;flex:1;min-height:0;}
            #tachy-map{position:absolute;inset:0;background:#0b0f14;}
            #tachy-canvas{position:absolute;inset:0;pointer-events:none;z-index:500;}
        `;
        document.head.appendChild(st);
    }
    function build() {
        if (document.getElementById('tachy-modal')) return;
        injectStyle();
        const opts = LINE_TYPES.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
        const m = document.createElement('div');
        m.id = 'tachy-modal';
        m.innerHTML = `
            <div id="tachy-top">
                <span class="tt-title"><svg class="icon"><use href="#i-grid"/></svg> Náčrt / Tachymetrie</span>
                <button id="tachy-x" onclick="closeTachymetrie()" aria-label="Zavřít">×</button>
            </div>
            <div id="tachy-bar">
                <button class="tb-btn prim" onclick="tachyAddCurrent()"><svg class="icon"><use href="#i-plus"/></svg> Bod (GPS)</button>
                <button class="tb-btn" onclick="tachyAddFromPoints()"><svg class="icon"><use href="#i-map-pin"/></svg> Z bodů</button>
                <span class="tb-sep"></span>
                <button class="tb-btn" id="tachy-connect" onclick="tachySetMode('connect')"><svg class="icon"><use href="#i-line"/></svg> Spojit</button>
                <select id="tachy-linetype" class="tb-sel" title="Typ čáry">${opts}</select>
                <button class="tb-btn" id="tachy-label" onclick="tachySetMode('label')"><svg class="icon"><use href="#i-edit"/></svg> Popisek</button>
                <span class="tb-sep"></span>
                <select id="tachy-bg" class="tb-sel" title="Podklad" onchange="tachySetBg(this.value)">
                    <option value="osm">Mapa</option><option value="ortofoto">Ortofoto</option><option value="none">Bez podkladu</option>
                </select>
                <span class="tb-sep"></span>
                <button class="tb-btn" onclick="tachyUndo()"><svg class="icon"><use href="#i-rotate-ccw"/></svg> Zpět</button>
                <button class="tb-btn" onclick="tachyExport()"><svg class="icon"><use href="#i-download"/></svg> PNG</button>
                <button class="tb-btn warn" onclick="tachyClear()"><svg class="icon"><use href="#i-trash"/></svg> Vymazat</button>
            </div>
            <div id="tachy-hint"></div>
            <div id="tachy-wrap">
                <div id="tachy-map"></div>
                <canvas id="tachy-canvas"></canvas>
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
    window.closeTachymetrie = function () {
        const m = document.getElementById('tachy-modal'); if (m) m.style.display = 'none';
        // Těžký full-screen modal s vlastní Leaflet mapou umí "zamrznout" hlavní kameru -> oživit ji
        // (stejně jako po undo v undo.js). Bez toho zůstane po zavření černá/zaseklá kamera.
        try { if (typeof ensureCameraAlive === 'function') setTimeout(function () { ensureCameraAlive(true); }, 150); } catch (e) {}
    };

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
        if (c) c.classList.toggle('active', mode === 'connect');
        if (l) l.classList.toggle('active', mode === 'label');
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

    // ---------- Měření: délky čar + plocha uzavřeného polygonu ----------
    function lineMeters(l) {
        const a = sketch.pts[l[0]], b = sketch.pts[l[1]];
        if (!a || !b || !tmap) return null;
        try { return tmap.distance([a.lat, a.lng], [b.lat, b.lng]); } catch (e) { return null; }
    }
    // metrické souřadnice pro výpočet plochy — proj4 do S-JTSK (EPSG:5514) jako jinde v appce
    function metric(p) {
        try { if (typeof proj4 === 'function') { const s = proj4('EPSG:4326', 'EPSG:5514', [p.lng, p.lat]); return [s[0], s[1]]; } } catch (e) {}
        const R = 6378137, la = p.lat * Math.PI / 180; return [p.lng * Math.PI / 180 * R * Math.cos(la), p.lat * Math.PI / 180 * R];
    }
    function fmtLen(m) { return m >= 1000 ? (m / 1000).toFixed(3) + ' km' : m.toFixed(m < 10 ? 2 : 1) + ' m'; }
    function fmtArea(a) { return a >= 10000 ? (a / 10000).toFixed(3) + ' ha' : a.toFixed(a < 100 ? 2 : 1) + ' m²'; }
    // Detekuje JEDINÝ uzavřený polygon z čar (každý vrchol stupně 2, jeden cyklus). Jinak null
    // -> nepočítáme plochu u nejednoznačných náčrtů (lepší nic než špatné číslo).
    function ringInfo() {
        if (!sketch.lines || sketch.lines.length < 3) return null;
        const adj = new Map();
        for (const l of sketch.lines) {
            if (!sketch.pts[l[0]] || !sketch.pts[l[1]]) return null;
            if (!adj.has(l[0])) adj.set(l[0], new Set());
            if (!adj.has(l[1])) adj.set(l[1], new Set());
            adj.get(l[0]).add(l[1]); adj.get(l[1]).add(l[0]);
        }
        for (const nb of adj.values()) if (nb.size !== 2) return null;
        const start = adj.keys().next().value;
        const order = []; let cur = start, prev = -1;
        do {
            order.push(cur);
            const nbs = [...adj.get(cur)];
            const next = (nbs[0] !== prev) ? nbs[0] : nbs[1];
            prev = cur; cur = next;
        } while (cur !== start && order.length <= adj.size + 1);
        if (cur !== start || order.length !== adj.size) return null;
        const m = order.map(i => metric(sketch.pts[i]));
        let area = 0, perim = 0;
        for (let k = 0; k < m.length; k++) {
            const a = m[k], b = m[(k + 1) % m.length];
            area += a[0] * b[1] - b[0] * a[1];
            perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
        return { order: order, area: Math.abs(area) / 2, perim: perim };
    }
    // Vykreslí délky čar a (je-li) plochu polygonu do daného kontextu. onWhite = pro PNG export.
    function drawMeasure(c, onWhite) {
        const txt = onWhite ? '#111' : '#fff';
        const halo = onWhite ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';
        const ring = ringInfo();
        if (ring) {
            const sp = ring.order.map(i => scr(sketch.pts[i]));
            c.save();
            c.beginPath(); c.moveTo(sp[0].x, sp[0].y);
            for (let k = 1; k < sp.length; k++) c.lineTo(sp[k].x, sp[k].y);
            c.closePath();
            c.fillStyle = onWhite ? 'rgba(37,99,235,0.08)' : 'rgba(52,211,153,0.16)'; c.fill();
            c.restore();
            const cx = sp.reduce((s, p) => s + p.x, 0) / sp.length, cy = sp.reduce((s, p) => s + p.y, 0) / sp.length;
            c.font = 'bold 15px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
            const label = fmtArea(ring.area);
            c.lineWidth = 4; c.strokeStyle = halo; c.strokeText(label, cx, cy);
            c.fillStyle = txt; c.fillText(label, cx, cy);
            c.textBaseline = 'alphabetic';
        }
        c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        sketch.lines.forEach(l => {
            const d = lineMeters(l); if (d == null) return;
            const a = scr(sketch.pts[l[0]]), b = scr(sketch.pts[l[1]]);
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, s = fmtLen(d);
            c.lineWidth = 4; c.strokeStyle = halo; c.strokeText(s, mx, my);
            c.fillStyle = txt; c.fillText(s, mx, my);
        });
        c.textBaseline = 'alphabetic'; c.textAlign = 'left';
        return ring;
    }

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
        const _ring = drawMeasure(ctx, false);
        hint(`${sketch.pts.length} bodů · ${sketch.lines.length} čar · ${sketch.labels.length} popisků` + (_ring ? ` · plocha ${fmtArea(_ring.area)} · obvod ${fmtLen(_ring.perim)}` : '') + (mode === 'connect' ? ' · spojuji' : mode === 'label' ? ' · popisek' : ''));
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
        drawMeasure(c, true); // délky čar + plocha do exportu
        try {
            const url = exp.toDataURL('image/png');
            const a = document.createElement('a'); a.href = url;
            a.download = 'nacrt_' + (typeof activeProjectId !== 'undefined' ? activeProjectId : 'tachymetrie') + '.png';
            document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { alert('Export selhal: ' + (e && e.message ? e.message : e)); }
    };
})();
