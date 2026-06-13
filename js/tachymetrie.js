// ===== AR Geodet - TACHYMETRIE / NÁČRT V TERÉNU =====
// EXPERIMENTÁLNÍ a ZÁMĚRNĚ SAMOSTATNÉ: digitalni nahrada rucniho nacrtu. Body se vykresli
// ve spravne vzajemne poloze (lokalni rovinna projekce v metrech), pridavaji se s cislem,
// spojuji se do car. Export jako PNG. Sketch se uklada do localStorage ('arTachySketch1').
//
// ODPOJENÍ, kdyby to nefungovalo: smaž <script src="js/tachymetrie.js"> v index.html a
// tlacitko onclick="openTachymetrie()". Zbytek aplikace se modulu nikde nedotyka.

(function () {
    'use strict';
    const KEY = 'arTachySketch1';
    let sketch = { pts: [], lines: [] };          // pts: {n, name, lat, lng}; lines: [i, j]
    let canvas, ctx, tf = null;                    // tf: prevod svet->obrazovka
    let connectMode = false, selIdx = -1;
    let _resizeBound = false;

    function load() { try { const s = localStorage.getItem(KEY); if (s) sketch = JSON.parse(s); } catch (e) {} if (!sketch.pts) sketch = { pts: [], lines: [] }; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(sketch)); } catch (e) {} }

    // ---------- UI ----------
    function build() {
        if (document.getElementById('tachy-modal')) return;
        const m = document.createElement('div');
        m.id = 'tachy-modal';
        m.style.cssText = 'position:fixed; inset:0; z-index:1000000; background:#0e1116; display:none; flex-direction:column;';
        m.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px; padding:calc(env(safe-area-inset-top,0px) + 8px) 10px 8px; background:#161b22; flex-wrap:wrap;">
                <b style="color:#34d399; margin-right:auto;">Náčrt / Tachymetrie</b>
                <button class="btn btn-primary" style="padding:7px 10px; width:auto;" onclick="tachyAddCurrent()">+ Bod (GPS)</button>
                <button class="btn btn-secondary" style="padding:7px 10px; width:auto;" onclick="tachyAddFromPoints()">+ Z bodů</button>
                <button class="btn btn-secondary" id="tachy-connect" style="padding:7px 10px; width:auto;" onclick="tachyToggleConnect()">Spojit</button>
                <button class="btn btn-secondary" style="padding:7px 10px; width:auto;" onclick="tachyUndo()">Zpět</button>
                <button class="btn btn-secondary" style="padding:7px 10px; width:auto;" onclick="tachyExport()">Export PNG</button>
                <button class="btn btn-warning" style="padding:7px 10px; width:auto;" onclick="tachyClear()">Vymazat</button>
                <button class="btn btn-secondary" style="padding:7px 10px; width:auto;" onclick="closeTachymetrie()">Zavřít</button>
            </div>
            <div id="tachy-hint" style="color:#9aa4b2; font-size:12px; padding:4px 12px;"></div>
            <canvas id="tachy-canvas" style="flex:1; width:100%; touch-action:none; display:block;"></canvas>`;
        document.body.appendChild(m);
        canvas = document.getElementById('tachy-canvas');
        ctx = canvas.getContext('2d');
        canvas.addEventListener('click', onCanvasTap);
        if (!_resizeBound) { window.addEventListener('resize', () => { if (document.getElementById('tachy-modal').style.display === 'flex') { resize(); render(); } }); _resizeBound = true; }
    }

    function resize() { const r = canvas.getBoundingClientRect(); canvas.width = Math.round(r.width); canvas.height = Math.round(r.height); }
    function hint(t) { const h = document.getElementById('tachy-hint'); if (h) h.innerText = t; }

    window.openTachymetrie = function () {
        load(); build();
        document.getElementById('tachy-modal').style.display = 'flex';
        connectMode = false; selIdx = -1; updateConnectBtn();
        setTimeout(() => { resize(); render(); }, 30);
    };
    window.closeTachymetrie = function () { const m = document.getElementById('tachy-modal'); if (m) m.style.display = 'none'; };

    // ---------- Přidávání bodů ----------
    function nextName() { let n = 1; const used = new Set(sketch.pts.map(p => p.name)); while (used.has(String(n))) n++; return String(n); }
    function addPoint(lat, lng, name) {
        sketch.pts.push({ name: name || nextName(), lat: lat, lng: lng });
        save(); render();
    }

    window.tachyAddCurrent = function () {
        let lat = null, lng = null;
        if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && gpsAvgResult.lat) { lat = gpsAvgResult.lat; lng = gpsAvgResult.lng; }
        else if (typeof userLat !== 'undefined' && userLat) { lat = userLat; lng = userLng; }
        if (lat == null) { alert('Zatím nemám GPS polohu.'); return; }
        const nm = prompt('Číslo / označení bodu:', nextName());
        if (nm === null) return;
        addPoint(lat, lng, nm.trim() || nextName());
        hint('Přidán bod „' + sketch.pts[sketch.pts.length - 1].name + '". Stůjte na bodě a měřte přesně.');
    };

    window.tachyAddFromPoints = function () {
        if (typeof persistentCustomPoints === 'undefined' || !persistentCustomPoints.length) { alert('Nemáte žádné vlastní body.'); return; }
        // jednoduchy vyber: pridat vsechny vlastni body, ktere v nacrtu jeste nejsou
        let added = 0;
        persistentCustomPoints.forEach(p => {
            const exists = sketch.pts.some(s => Math.abs(s.lat - p.lat) < 1e-6 && Math.abs(s.lng - p.lng) < 1e-6);
            if (!exists) { sketch.pts.push({ name: String(p.name || nextName()), lat: p.lat, lng: p.lng }); added++; }
        });
        save(); render();
        hint(added ? ('Přidáno ' + added + ' bodů z „Mé body".') : 'Všechny vaše body už v náčrtu jsou.');
    };

    window.tachyToggleConnect = function () { connectMode = !connectMode; selIdx = -1; updateConnectBtn(); hint(connectMode ? 'Spojování: klepněte na první a pak druhý bod.' : ''); render(); };
    function updateConnectBtn() { const b = document.getElementById('tachy-connect'); if (b) { b.style.background = connectMode ? 'var(--accent)' : ''; b.style.color = connectMode ? '#000' : ''; } }

    window.tachyUndo = function () {
        if (sketch.lines.length) sketch.lines.pop();
        else if (sketch.pts.length) { const ri = sketch.pts.length - 1; sketch.pts.pop(); sketch.lines = sketch.lines.filter(l => l[0] !== ri && l[1] !== ri); }
        save(); render();
    };
    window.tachyClear = function () { if (!sketch.pts.length || confirm('Vymazat celý náčrt?')) { sketch = { pts: [], lines: [] }; selIdx = -1; save(); render(); } };

    // ---------- Interakce ----------
    function onCanvasTap(ev) {
        if (!tf) return;
        const r = canvas.getBoundingClientRect();
        const px = ev.clientX - r.left, py = ev.clientY - r.top;
        let best = -1, bestD = 22 * 22;
        sketch.pts.forEach((p, i) => { const s = worldToScreen(p); const d = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py); if (d < bestD) { bestD = d; best = i; } });
        if (best < 0) { selIdx = -1; render(); return; }
        if (connectMode) {
            if (selIdx < 0) { selIdx = best; }
            else if (selIdx !== best) {
                const exists = sketch.lines.some(l => (l[0] === selIdx && l[1] === best) || (l[0] === best && l[1] === selIdx));
                if (!exists) sketch.lines.push([selIdx, best]);
                selIdx = best; save();
            }
        } else { selIdx = (selIdx === best ? -1 : best); }
        render();
    }

    // ---------- Projekce a vykresleni ----------
    function buildTransform() {
        const pts = sketch.pts;
        if (!pts.length) { tf = null; return; }
        const lat0 = pts[0].lat, mLat = 111320, mLng = 111320 * Math.cos(lat0 * Math.PI / 180);
        const w = pts.map(p => ({ x: (p.lng - pts[0].lng) * mLng, y: (p.lat - lat0) * mLat }));
        let minX = Math.min(...w.map(p => p.x)), maxX = Math.max(...w.map(p => p.x));
        let minY = Math.min(...w.map(p => p.y)), maxY = Math.max(...w.map(p => p.y));
        const pad = 60, W = canvas.width, H = canvas.height;
        let dx = maxX - minX || 1, dy = maxY - minY || 1;
        let scale = Math.min((W - 2 * pad) / dx, (H - 2 * pad) / dy);
        if (!isFinite(scale) || scale <= 0) scale = 1;
        if (scale > 40) scale = 40;                // strop, at jediny/blizke body nejsou obri
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        tf = { lat0, lng0: pts[0].lng, mLat, mLng, scale, cx, cy, W, H };
    }
    function worldToScreen(p) {
        const x = (p.lng - tf.lng0) * tf.mLng, y = (p.lat - tf.lat0) * tf.mLat;
        return { x: tf.W / 2 + (x - tf.cx) * tf.scale, y: tf.H / 2 - (y - tf.cy) * tf.scale }; // sever nahoru
    }

    function render() {
        if (!ctx) return;
        buildTransform();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // mřížka + měřítko
        ctx.fillStyle = '#0e1116'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (!sketch.pts.length) { ctx.fillStyle = '#5b6675'; ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Přidejte první bod tlačítkem „+ Bod (GPS)".', canvas.width / 2, canvas.height / 2); return; }
        drawScaleBar();
        // čáry
        ctx.strokeStyle = '#34d399'; ctx.lineWidth = 2;
        sketch.lines.forEach(l => { const a = worldToScreen(sketch.pts[l[0]]), b = worldToScreen(sketch.pts[l[1]]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
        // body + popisky
        sketch.pts.forEach((p, i) => {
            const s = worldToScreen(p);
            ctx.beginPath(); ctx.arc(s.x, s.y, i === selIdx ? 8 : 5, 0, 2 * Math.PI);
            ctx.fillStyle = i === selIdx ? '#fbbf24' : '#3b82f6'; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = '#e6edf3'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText(p.name, s.x + 9, s.y - 7);
        });
        hint(`${sketch.pts.length} bodů, ${sketch.lines.length} spojnic` + (connectMode ? ' · režim spojování' : ''));
    }

    function drawScaleBar() {
        // delka 5 m v px; pokud moc dlouha/kratka, zvol jinou rozumnou hodnotu
        let meters = 5; let px = meters * tf.scale;
        const targets = [1, 2, 5, 10, 20, 50, 100];
        if (px < 40 || px > 160) { for (const t of targets) { if (t * tf.scale >= 40 && t * tf.scale <= 160) { meters = t; px = t * tf.scale; break; } } }
        const x0 = 16, y0 = canvas.height - 24;
        ctx.strokeStyle = '#9aa4b2'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0 + 5); ctx.moveTo(x0 + px, y0 - 5); ctx.lineTo(x0 + px, y0 + 5); ctx.stroke();
        ctx.fillStyle = '#9aa4b2'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(meters + ' m', x0 + px + 8, y0 + 4);
        // sever
        ctx.fillStyle = '#9aa4b2'; ctx.textAlign = 'center'; ctx.fillText('S ↑', canvas.width - 24, 24);
    }

    window.tachyExport = function () {
        if (!sketch.pts.length) { alert('Náčrt je prázdný.'); return; }
        try {
            const url = canvas.toDataURL('image/png');
            const a = document.createElement('a'); a.href = url;
            a.download = 'nacrt_' + (typeof activeProjectId !== 'undefined' ? activeProjectId : 'tachymetrie') + '.png';
            document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { alert('Export selhal: ' + (e && e.message ? e.message : e)); }
    };
})();
