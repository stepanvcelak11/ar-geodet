// ===== AR Geodet - TACHYMETRIE / NÁČRT V TERÉNU =====
// EXPERIMENTÁLNÍ a ZÁMĚRNĚ SAMOSTATNÉ: digitalni nahrada rucniho nacrtu. Body se vykresli
// ve spravne vzajemne poloze (lokalni rovinna projekce v metrech), pridavaji se s cislem,
// spojuji se carami ruznych typu, lze vkladat textove popisky (napr. "kamen" uvnitr plochy).
// Export jako PNG. Sketch se uklada do localStorage ('arTachySketch1').
//
// ODPOJENÍ, kdyby to nefungovalo: smaž <script src="js/tachymetrie.js"> v index.html a
// tlacitko onclick="openTachymetrie()". Zbytek aplikace se modulu nikde nedotyka.

(function () {
    'use strict';
    const KEY = 'arTachySketch1';
    // Typy car (druhy car) — kazda spojnice si pamatuje index typu.
    const LINE_TYPES = [
        { name: 'Plná', color: '#34d399', dash: [] },
        { name: 'Hranice', color: '#fbbf24', dash: [] },
        { name: 'Čárkovaná', color: '#60a5fa', dash: [9, 7] },
        { name: 'Plot', color: '#ef4444', dash: [2, 5] }
    ];
    // pts: {name, lat, lng}; lines: [i, j, typeIdx]; labels: {lat, lng, text}; log: ['pt'|'line'|'label']
    let sketch = { pts: [], lines: [], labels: [], log: [] };
    let canvas, ctx, tf = null;
    let mode = 'view';            // 'view' | 'connect' | 'label'
    let selIdx = -1;
    let _resizeBound = false;

    function load() { try { const s = localStorage.getItem(KEY); if (s) sketch = JSON.parse(s); } catch (e) {} normalize(); }
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
        if (!_resizeBound) { window.addEventListener('resize', () => { const el = document.getElementById('tachy-modal'); if (el && el.style.display === 'flex') { resize(); render(); } }); _resizeBound = true; }
    }

    function resize() { const r = canvas.getBoundingClientRect(); canvas.width = Math.round(r.width); canvas.height = Math.round(r.height); }
    function hint(t) { const h = document.getElementById('tachy-hint'); if (h) h.innerText = t; }
    function curLineType() { const s = document.getElementById('tachy-linetype'); return s ? (parseInt(s.value) || 0) : 0; }

    window.openTachymetrie = function () {
        load(); build();
        document.getElementById('tachy-modal').style.display = 'flex';
        mode = 'view'; selIdx = -1; updateModeButtons();
        setTimeout(() => { resize(); render(); }, 30);
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
        save(); render();
        hint('Přidán bod „' + sketch.pts[sketch.pts.length - 1].name + '". Stůjte na bodě a měřte přesně.');
    };

    window.tachyAddFromPoints = function () {
        if (typeof persistentCustomPoints === 'undefined' || !persistentCustomPoints.length) { alert('Nemáte žádné vlastní body.'); return; }
        let added = 0;
        persistentCustomPoints.forEach(p => {
            const exists = sketch.pts.some(s => Math.abs(s.lat - p.lat) < 1e-6 && Math.abs(s.lng - p.lng) < 1e-6);
            if (!exists) { sketch.pts.push({ name: String(p.name || nextName()), lat: p.lat, lng: p.lng }); sketch.log.push('pt'); added++; }
        });
        save(); render();
        hint(added ? ('Přidáno ' + added + ' bodů z „Mé body".') : 'Všechny vaše body už v náčrtu jsou.');
    };

    // ---------- Režimy ----------
    window.tachySetMode = function (mWanted) { mode = (mode === mWanted) ? 'view' : mWanted; selIdx = -1; updateModeButtons(); render(); hint(mode === 'connect' ? 'Spojování: klepněte na první a pak druhý bod. Typ čáry vyberte vlevo.' : mode === 'label' ? 'Popisek: klepněte do prázdna pro nový text, na popisek pro úpravu/smazání.' : ''); };
    function updateModeButtons() {
        const c = document.getElementById('tachy-connect'), l = document.getElementById('tachy-label');
        if (c) { c.style.background = mode === 'connect' ? 'var(--accent)' : ''; c.style.color = mode === 'connect' ? '#000' : ''; }
        if (l) { l.style.background = mode === 'label' ? 'var(--accent)' : ''; l.style.color = mode === 'label' ? '#000' : ''; }
    }

    window.tachyUndo = function () {
        const last = sketch.log.length ? sketch.log.pop() : (sketch.lines.length ? 'line' : (sketch.labels.length ? 'label' : (sketch.pts.length ? 'pt' : null)));
        if (last === 'line') sketch.lines.pop();
        else if (last === 'label') sketch.labels.pop();
        else if (last === 'pt') { const ri = sketch.pts.length - 1; sketch.pts.pop(); sketch.lines = sketch.lines.filter(l => l[0] !== ri && l[1] !== ri); }
        save(); render();
    };
    window.tachyClear = function () { if ((!sketch.pts.length && !sketch.labels.length) || confirm('Vymazat celý náčrt?')) { sketch = { pts: [], lines: [], labels: [], log: [] }; selIdx = -1; save(); render(); } };

    // ---------- Interakce ----------
    function onCanvasTap(ev) {
        if (!tf) { return; }
        const r = canvas.getBoundingClientRect();
        const px = ev.clientX - r.left, py = ev.clientY - r.top;

        if (mode === 'label') {
            // nejdriv zkus zasah do existujiciho popisku
            let lbi = -1, lbD = 26 * 26;
            sketch.labels.forEach((lb, i) => { const s = worldToScreen(lb); const d = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py); if (d < lbD) { lbD = d; lbi = i; } });
            if (lbi >= 0) {
                const nt = prompt('Upravit popisek (prázdné = smazat):', sketch.labels[lbi].text);
                if (nt === null) return;
                if (!nt.trim()) sketch.labels.splice(lbi, 1); else sketch.labels[lbi].text = nt.trim();
                save(); render(); return;
            }
            const t = prompt('Text popisku (např. kámen, šachta, strom):', '');
            if (t === null || !t.trim()) return;
            const w = screenToWorldLatLng(px, py);
            sketch.labels.push({ lat: w.lat, lng: w.lng, text: t.trim() }); sketch.log.push('label');
            save(); render(); return;
        }

        // jinak hledame nejblizsi bod
        let best = -1, bestD = 24 * 24;
        sketch.pts.forEach((p, i) => { const s = worldToScreen(p); const d = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py); if (d < bestD) { bestD = d; best = i; } });
        if (best < 0) { selIdx = -1; render(); return; }
        if (mode === 'connect') {
            if (selIdx < 0) { selIdx = best; }
            else if (selIdx !== best) {
                const exists = sketch.lines.some(l => (l[0] === selIdx && l[1] === best) || (l[0] === best && l[1] === selIdx));
                if (!exists) { sketch.lines.push([selIdx, best, curLineType()]); sketch.log.push('line'); }
                selIdx = best; save();
            }
        } else { selIdx = (selIdx === best ? -1 : best); }
        render();
    }

    // ---------- Projekce ----------
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
        if (scale > 40) scale = 40;
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        tf = { lat0, lng0: pts[0].lng, mLat, mLng, scale, cx, cy, W, H };
    }
    function worldToScreen(p) {
        const x = (p.lng - tf.lng0) * tf.mLng, y = (p.lat - tf.lat0) * tf.mLat;
        return { x: tf.W / 2 + (x - tf.cx) * tf.scale, y: tf.H / 2 - (y - tf.cy) * tf.scale };
    }
    function screenToWorldLatLng(sx, sy) {
        const x = (sx - tf.W / 2) / tf.scale + tf.cx, y = (tf.H / 2 - sy) / tf.scale + tf.cy;
        return { lat: tf.lat0 + y / tf.mLat, lng: tf.lng0 + x / tf.mLng };
    }

    // ---------- Vykresleni ----------
    function render() {
        if (!ctx) return;
        buildTransform();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#0e1116'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (!sketch.pts.length) { ctx.fillStyle = '#5b6675'; ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Přidejte první bod tlačítkem „+ Bod (GPS)".', canvas.width / 2, canvas.height / 2); return; }
        drawScaleBar();
        // čáry dle typu
        sketch.lines.forEach(l => {
            const t = LINE_TYPES[l[2] || 0] || LINE_TYPES[0];
            const a = worldToScreen(sketch.pts[l[0]]), b = worldToScreen(sketch.pts[l[1]]);
            ctx.strokeStyle = t.color; ctx.lineWidth = 2.5; ctx.setLineDash(t.dash || []);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        });
        ctx.setLineDash([]);
        // popisky
        sketch.labels.forEach(lb => {
            const s = worldToScreen(lb);
            ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const w = ctx.measureText(lb.text).width + 12;
            ctx.fillStyle = 'rgba(14,17,22,0.78)'; ctx.fillRect(s.x - w / 2, s.y - 12, w, 22);
            ctx.fillStyle = '#fde68a'; ctx.fillText(lb.text, s.x, s.y);
        });
        ctx.textBaseline = 'alphabetic';
        // body + cisla
        sketch.pts.forEach((p, i) => {
            const s = worldToScreen(p);
            ctx.beginPath(); ctx.arc(s.x, s.y, i === selIdx ? 8 : 5, 0, 2 * Math.PI);
            ctx.fillStyle = i === selIdx ? '#fbbf24' : '#3b82f6'; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = '#e6edf3'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText(p.name, s.x + 9, s.y - 7);
        });
        hint(`${sketch.pts.length} bodů · ${sketch.lines.length} čar · ${sketch.labels.length} popisků` + (mode === 'connect' ? ' · spojuji' : mode === 'label' ? ' · popisek' : ''));
    }

    function drawScaleBar() {
        let meters = 5, px = meters * tf.scale;
        const targets = [1, 2, 5, 10, 20, 50, 100];
        if (px < 40 || px > 160) { for (const t of targets) { if (t * tf.scale >= 40 && t * tf.scale <= 160) { meters = t; px = t * tf.scale; break; } } }
        const x0 = 16, y0 = canvas.height - 24;
        ctx.strokeStyle = '#9aa4b2'; ctx.lineWidth = 2; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0 + 5); ctx.moveTo(x0 + px, y0 - 5); ctx.lineTo(x0 + px, y0 + 5); ctx.stroke();
        ctx.fillStyle = '#9aa4b2'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(meters + ' m', x0 + px + 8, y0 + 4);
        ctx.textAlign = 'center'; ctx.fillText('S ↑', canvas.width - 24, 24);
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
