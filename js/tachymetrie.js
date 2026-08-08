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
    const KEY = 'arTachySketch1', BG_KEY = 'arTachyBg', STYLE_KEY = 'arTachyStyle';
    // Stavebnice stylu — uzivatel si slozi vlastni caru (barva x tloustka x typ).
    const COLORS = ['#16a34a', '#22c55e', '#2563eb', '#06b6d4', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0f172a', '#f8fafc'];
    const WIDTHS = [{ name: 'Tenká', w: 2 }, { name: 'Střední', w: 3.5 }, { name: 'Silná', w: 6 }];
    const DASHES = [{ name: 'Plná', d: [] }, { name: 'Čárkovaná', d: [10, 7] }, { name: 'Tečkovaná', d: [2, 6] }, { name: 'Čerchovaná', d: [14, 6, 3, 6] }];
    // Zpetna kompatibilita: stare cary maji l[2] = index do LINE_TYPES (a stare tahy s.type).
    const LINE_TYPES = [
        { color: '#16a34a', dash: [] }, { color: '#d97706', dash: [] },
        { color: '#2563eb', dash: [9, 7] }, { color: '#dc2626', dash: [2, 5] }
    ];
    // pts:{name,lat,lng}; lines:[i,j,style]; labels:{lat,lng,text}; strokes:{style,pts:[{lat,lng}]}; log:[...]
    // style = {color,width,dash}. (Stary format: l[2]/s.type = cislo -> LINE_TYPES.)
    let sketch = { pts: [], lines: [], labels: [], strokes: [], log: [] };
    let tmap = null, osmL = null, ortoL = null, curBg = 'osm';
    let canvas, ctx;
    let mode = 'view', selIdx = -1;
    let drawing = false, curStroke = null, activePid = null;
    let curStyle = { color: '#16a34a', width: 3.5, dash: [] };   // aktualni styl pro caru i kresleni

    function load() { try { const s = localStorage.getItem(KEY); if (s) sketch = JSON.parse(s); } catch (e) {} normalize(); try { curBg = localStorage.getItem(BG_KEY) || 'osm'; } catch (e) { curBg = 'osm'; } try { const st = JSON.parse(localStorage.getItem(STYLE_KEY) || 'null'); if (st && st.color) curStyle = { color: st.color, width: st.width || 3.5, dash: Array.isArray(st.dash) ? st.dash : [] }; } catch (e) {} }
    function normalize() { if (!sketch || typeof sketch !== 'object') sketch = {}; sketch.pts = sketch.pts || []; sketch.lines = sketch.lines || []; sketch.labels = sketch.labels || []; sketch.strokes = sketch.strokes || []; sketch.log = sketch.log || []; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(sketch)); } catch (e) {} }
    function saveStyle() { try { localStorage.setItem(STYLE_KEY, JSON.stringify(curStyle)); } catch (e) {} }
    // Dekodovani stylu (novy objekt {color,width,dash}, nebo stary index do LINE_TYPES).
    function lineStyleOf(l) {
        const t = l[2];
        if (t && typeof t === 'object') return { color: t.color || '#16a34a', width: t.width || 3, dash: Array.isArray(t.dash) ? t.dash : [] };
        const p = LINE_TYPES[t || 0] || LINE_TYPES[0];
        return { color: p.color, width: 3, dash: p.dash || [] };
    }
    function strokeStyleOf(s) {
        if (s && s.style && typeof s.style === 'object') return { color: s.style.color || '#111827', width: s.style.width || 2.6, dash: Array.isArray(s.style.dash) ? s.style.dash : [] };
        const p = LINE_TYPES[(s && s.type) || 0] || LINE_TYPES[0];
        return { color: p.color, width: 2.6, dash: p.dash || [] };
    }

    // ---------- UI ----------
    function injectStyle() {
        if (document.getElementById('tachy-style')) return;
        const st = document.createElement('style'); st.id = 'tachy-style';
        st.textContent = `
            #tachy-modal{position:fixed;top:0;left:0;right:0;height:var(--app-vh,100dvh);z-index:1000000;background:#0b0f14;display:none;flex-direction:column;font-family:var(--font-ui,sans-serif);}
            #tachy-top{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px;background:#11161d;border-bottom:1px solid rgba(255,255,255,0.08);}
            #tachy-top .tt-title{display:flex;align-items:center;gap:8px;font-family:var(--font-display,sans-serif);font-weight:700;font-size:16px;color:#fff;margin-right:auto;}
            #tachy-top .tt-title .icon{width:20px;height:20px;color:var(--accent,#2f9e74);}
            #tachy-x{flex:none;width:36px;height:36px;border:none;border-radius:10px;background:rgba(255,255,255,0.08);color:#fff;font-size:20px;line-height:1;cursor:pointer;}
            #tachy-x:active{transform:scale(0.95);}
            #tachy-modes{display:flex;gap:4px;padding:8px 12px;background:#11161d;border-bottom:1px solid rgba(255,255,255,0.06);}
            .tm-btn{flex:1 1 0;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:38px;padding:0 4px;border-radius:10px;border:1px solid transparent;background:rgba(255,255,255,0.05);color:#cbd5e1;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;}
            .tm-btn .icon{width:16px;height:16px;}
            .tm-btn:active{transform:scale(0.97);}
            .tm-btn.active{background:var(--accent,#2f9e74);border-color:transparent;color:#06231a;box-shadow:0 2px 10px rgba(47,158,116,0.25);}
            #tachy-stylebar{display:none;flex-direction:column;gap:9px;padding:11px 12px;background:#0e1319;border-bottom:1px solid rgba(255,255,255,0.06);}
            #tachy-stylebar.on{display:flex;}
            .ts-row{display:flex;align-items:center;gap:9px;}
            .ts-lab{flex:0 0 56px;font-size:11px;font-weight:700;color:#9aa4b2;text-transform:uppercase;letter-spacing:0.04em;}
            .ts-items{display:flex;align-items:center;gap:7px;flex:1;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px;}
            .ts-items::-webkit-scrollbar{height:0;}
            .ts-sw{flex:0 0 auto;width:28px;height:28px;border-radius:50%;border:2px solid rgba(255,255,255,0.2);cursor:pointer;padding:0;}
            .ts-sw:active{transform:scale(0.92);}
            .ts-sw.active{border-color:#fff;box-shadow:0 0 0 2px var(--accent,#2f9e74);}
            .ts-custom{position:relative;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.1);font-size:14px;}
            .ts-custom input{position:absolute;inset:0;opacity:0;cursor:pointer;}
            .ts-chip{flex:0 0 auto;height:32px;padding:0 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#e6edf3;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:7px;}
            .ts-chip:active{transform:scale(0.97);}
            .ts-chip.active{background:var(--accent,#2f9e74);border-color:transparent;color:#06231a;}
            .ts-chip .pv{display:inline-block;width:26px;border-top:3px solid currentColor;}
            #tachy-actions{display:flex;align-items:center;gap:7px;padding:9px 12px;background:#0b0f14;border-bottom:1px solid rgba(255,255,255,0.06);overflow-x:auto;-webkit-overflow-scrolling:touch;}
            #tachy-actions::-webkit-scrollbar{height:0;}
            .tb-btn{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 13px;border-radius:11px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#e6edf3;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;}
            .tb-btn .icon{width:17px;height:17px;}
            .tb-btn:active{transform:scale(0.97);}
            .tb-btn.prim{background:var(--accent,#2f9e74);border-color:transparent;color:#06231a;}
            .tb-btn.warn{color:#fca5a5;border-color:rgba(248,113,113,0.4);}
            .tb-btn.tb-icon{width:38px;padding:0;justify-content:center;}
            .tb-sel{flex:0 0 auto;height:38px;padding:0 10px;border-radius:11px;background:rgba(255,255,255,0.06);color:#e6edf3;border:1px solid rgba(255,255,255,0.12);font-size:13px;}
            .tb-sep{flex:0 0 auto;width:1px;height:22px;background:rgba(255,255,255,0.12);margin:0 3px;}
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
        const colorSw = COLORS.map(c => `<button class="ts-sw" data-col="${c}" style="background:${c}" onclick="tachySetColor('${c}')" aria-label="barva ${c}"></button>`).join('');
        const widthCh = WIDTHS.map(x => `<button class="ts-chip" data-w="${x.w}" onclick="tachySetWidth(${x.w})"><span class="pv" style="border-top-width:${Math.round(x.w)}px"></span>${x.name}</button>`).join('');
        const dashCh = DASHES.map(x => `<button class="ts-chip" data-d="${x.d.join(',')}" onclick="tachySetDash('${x.d.join(',')}')">${x.name}</button>`).join('');
        const m = document.createElement('div');
        m.id = 'tachy-modal';
        m.innerHTML = `
            <div id="tachy-top">
                <span class="tt-title"><svg class="icon"><use href="#i-grid"/></svg> Náčrt / Tachymetrie</span>
                <button id="tachy-x" onclick="closeTachymetrie()" aria-label="Zavřít">×</button>
            </div>
            <div id="tachy-modes">
                <button class="tm-btn" id="tachy-view" onclick="tachySetMode('view')"><svg class="icon"><use href="#i-map-pin"/></svg> Zobrazit</button>
                <button class="tm-btn" id="tachy-connect" onclick="tachySetMode('connect')"><svg class="icon"><use href="#i-line"/></svg> Spojit</button>
                <button class="tm-btn" id="tachy-draw" onclick="tachySetMode('draw')"><svg class="icon"><use href="#i-edit"/></svg> Kreslit</button>
                <button class="tm-btn" id="tachy-label" onclick="tachySetMode('label')"><svg class="icon"><use href="#i-edit"/></svg> Popisek</button>
            </div>
            <div id="tachy-stylebar">
                <div class="ts-row"><span class="ts-lab">Barva</span><div class="ts-items" id="tachy-colors">${colorSw}<label class="ts-sw ts-custom" title="Vlastní barva">🎨<input type="color" id="tachy-color-pick" onchange="tachySetColor(this.value)"></label></div></div>
                <div class="ts-row"><span class="ts-lab">Tloušťka</span><div class="ts-items" id="tachy-widths">${widthCh}</div></div>
                <div class="ts-row"><span class="ts-lab">Styl</span><div class="ts-items" id="tachy-dashes">${dashCh}</div></div>
            </div>
            <div id="tachy-actions">
                <button class="tb-btn prim" onclick="tachyAddCurrent()"><svg class="icon"><use href="#i-plus"/></svg> Bod (GPS)</button>
                <button class="tb-btn" onclick="tachyAddFromPoints()"><svg class="icon"><use href="#i-map-pin"/></svg> Z bodů</button>
                <span class="tb-sep"></span>
                <button class="tb-btn tb-icon" onclick="tachyUndo()" title="Zpět"><svg class="icon"><use href="#i-rotate-ccw"/></svg></button>
                <select id="tachy-bg" class="tb-sel" title="Podklad" onchange="tachySetBg(this.value)">
                    <option value="osm">Mapa</option><option value="ortofoto">Ortofoto</option><option value="none">Bez podkladu</option>
                </select>
                <button class="tb-btn tb-icon" onclick="tachyExport()" title="Export do PNG"><svg class="icon"><use href="#i-download"/></svg></button>
                <button class="tb-btn tb-icon warn" onclick="tachyClear()" title="Vymazat náčrt"><svg class="icon"><use href="#i-trash"/></svg></button>
            </div>
            <div id="tachy-hint"></div>
            <div id="tachy-wrap">
                <div id="tachy-map"></div>
                <canvas id="tachy-canvas"></canvas>
            </div>`;
        document.body.appendChild(m);
        canvas = document.getElementById('tachy-canvas');
        ctx = canvas.getContext('2d');
        canvas.addEventListener('pointerdown', onDrawStart);
        canvas.addEventListener('pointermove', onDrawMove);
        canvas.addEventListener('pointerup', onDrawEnd);
        canvas.addEventListener('pointercancel', onDrawEnd);
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
        mode = 'view'; selIdx = -1; updateModeButtons(); updateStylePanel();
        setTimeout(() => { ensureMap(); tmap.invalidateSize(); fitView(); applyDrawInteraction(); redraw(); }, 60);
    };
    window.closeTachymetrie = function () {
        mode = 'view'; applyDrawInteraction(); updateModeButtons(); updateStylePanel();
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
        if (lat == null) { agInfo('Zatím nemám GPS polohu.'); return; }
        agAskText('', { title: 'Číslo / označení bodu', value: nextName(), okText: 'Přidat' }).then(function (nm) {
            if (nm === null) return;
            sketch.pts.push({ name: String(nm).trim() || nextName(), lat: lat, lng: lng }); sketch.log.push('pt');
            save();
            if (sketch.pts.length === 1 && tmap) tmap.setView([lat, lng], 20);
            redraw();
            // MUSI byt tady, ne za agAskText: bod se prida teprve v tomhle callbacku.
            // Venku by hint precetl jmeno PREDCHOZIHO bodu (a u prazdneho nacrtu spadl).
            hint('Přidán bod „' + sketch.pts[sketch.pts.length - 1].name + '". Stůjte na bodě a měřte přesně.');
        });
    };

    window.tachyAddFromPoints = function () {
        if (typeof persistentCustomPoints === 'undefined' || !persistentCustomPoints.length) { agInfo('Nemáte žádné vlastní body.'); return; }
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
        mode = mWanted; selIdx = -1; updateModeButtons(); updateStylePanel(); applyDrawInteraction(); redraw();
        hint(mode === 'connect' ? 'Spojování: klepněte na první a pak druhý bod. Styl čáry nastavíte nahoře.' : mode === 'label' ? 'Popisek: klepněte do prázdna pro nový text, na popisek pro úpravu/smazání.' : mode === 'draw' ? 'Kreslení: tahněte prstem nebo stylusem. Barvu, tloušťku a typ čáry nastavíte nahoře.' : 'Zobrazení: mapu lze posouvat a přibližovat.');
    };
    function updateModeButtons() {
        ['view', 'connect', 'draw', 'label'].forEach(function (mm) { const b = document.getElementById('tachy-' + mm); if (b) b.classList.toggle('active', mode === mm); });
    }

    // ---------- Styl čáry / kreslení (barva × tloušťka × typ) ----------
    function updateStylePanel() {
        const sb = document.getElementById('tachy-stylebar');
        if (sb) sb.classList.toggle('on', mode === 'connect' || mode === 'draw');
        updateStyleButtons();
    }
    function updateStyleButtons() {
        const cw = document.getElementById('tachy-colors');
        if (cw) cw.querySelectorAll('.ts-sw[data-col]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-col').toLowerCase() === curStyle.color.toLowerCase()); });
        const pick = document.getElementById('tachy-color-pick'); if (pick && /^#[0-9a-fA-F]{6}$/.test(curStyle.color)) pick.value = curStyle.color;
        const ww = document.getElementById('tachy-widths');
        if (ww) ww.querySelectorAll('.ts-chip').forEach(function (b) { b.classList.toggle('active', parseFloat(b.getAttribute('data-w')) === curStyle.width); });
        const dw = document.getElementById('tachy-dashes');
        if (dw) dw.querySelectorAll('.ts-chip').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-d') === curStyle.dash.join(',')); });
    }
    window.tachySetColor = function (c) { curStyle.color = c; saveStyle(); updateStyleButtons(); };
    window.tachySetWidth = function (w) { curStyle.width = w; saveStyle(); updateStyleButtons(); };
    window.tachySetDash = function (s) { curStyle.dash = (s && s.length) ? s.split(',').map(Number) : []; saveStyle(); updateStyleButtons(); };
    function styleSnapshot() { return { color: curStyle.color, width: curStyle.width, dash: curStyle.dash.slice() }; }

    window.tachyUndo = function () {
        const last = sketch.log.length ? sketch.log.pop() : (sketch.lines.length ? 'line' : (sketch.labels.length ? 'label' : (sketch.strokes.length ? 'stroke' : (sketch.pts.length ? 'pt' : null))));
        if (last === 'line') sketch.lines.pop();
        else if (last === 'label') sketch.labels.pop();
        else if (last === 'stroke') sketch.strokes.pop();
        else if (last === 'pt') { const ri = sketch.pts.length - 1; sketch.pts.pop(); sketch.lines = sketch.lines.filter(l => l[0] !== ri && l[1] !== ri); }
        save(); redraw();
    };
    window.tachyClear = function () {
        var vymaz = function () { sketch = { pts: [], lines: [], labels: [], strokes: [], log: [] }; selIdx = -1; save(); redraw(); };
        // prazdny nacrt se maze bez ptani - neni co ztratit
        if (!sketch.pts.length && !sketch.labels.length && !sketch.strokes.length) { vymaz(); return; }
        agGuard('Vymazat celý náčrt?', vymaz, { danger: true });
    };

    // ---------- Interakce (přes klik do mapy) ----------
    function onMapClick(e) {
        const px = e.containerPoint.x, py = e.containerPoint.y;
        if (mode === 'label') {
            let lbi = -1, lbD = 26 * 26;
            sketch.labels.forEach((lb, i) => { const s = scr(lb); const d = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py); if (d < lbD) { lbD = d; lbi = i; } });
            if (lbi >= 0) {
                agAskText('Prázdné pole popisek smaže.', { title: 'Upravit popisek', value: sketch.labels[lbi].text, okText: 'Uložit' }).then(function (nt) {
                    if (nt === null) return;
                    if (!String(nt).trim()) sketch.labels.splice(lbi, 1); else sketch.labels[lbi].text = String(nt).trim();
                    save(); redraw();
                });
                return;
            }
            agAskText('Např. kámen, šachta, strom.', { title: 'Text popisku', value: '', okText: 'Přidat' }).then(function (t) {
                if (t === null || !String(t).trim()) return;
                sketch.labels.push({ lat: e.latlng.lat, lng: e.latlng.lng, text: String(t).trim() }); sketch.log.push('label'); save(); redraw();
            });
            return;
        }
        let best = -1, bestD = 24 * 24;
        sketch.pts.forEach((p, i) => { const s = scr(p); const d = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py); if (d < bestD) { bestD = d; best = i; } });
        if (best < 0) { selIdx = -1; redraw(); return; }
        if (mode === 'connect') {
            if (selIdx < 0) selIdx = best;
            else if (selIdx !== best) { const ex = sketch.lines.some(l => (l[0] === selIdx && l[1] === best) || (l[0] === best && l[1] === selIdx)); if (!ex) { sketch.lines.push([selIdx, best, styleSnapshot()]); sketch.log.push('line'); } selIdx = best; save(); }
        } else selIdx = (selIdx === best ? -1 : best);
        redraw();
    }

    // projekce lat/lng -> pixel v canvasu (= container point mapy)
    function scr(p) { const pt = tmap.latLngToContainerPoint([p.lat, p.lng]); return { x: pt.x, y: pt.y }; }

    // ---------- Kreslení od ruky (prst / stylus) ----------
    // Tahy se ukladaji jako body lat/lng -> drzi na miste pri posunu/zoomu (stejne jako body a cary).
    function evXY(e) { const cp = tmap.mouseEventToContainerPoint(e); return { x: cp.x, y: cp.y }; }
    function applyDrawInteraction() {
        if (!tmap || !canvas) return;
        if (mode === 'draw') {
            canvas.style.pointerEvents = 'auto'; canvas.style.touchAction = 'none'; canvas.style.cursor = 'crosshair';
            if (tmap.dragging) tmap.dragging.disable();
            if (tmap.doubleClickZoom) tmap.doubleClickZoom.disable();
        } else {
            canvas.style.pointerEvents = 'none'; canvas.style.cursor = '';
            if (tmap.dragging) tmap.dragging.enable();
            if (tmap.doubleClickZoom) tmap.doubleClickZoom.enable();
            drawing = false; curStroke = null; activePid = null;
        }
    }
    function onDrawStart(e) {
        if (mode !== 'draw' || !tmap || drawing) return;   // jediny aktivni pointer => odmitnuti dlane / druheho prstu
        e.preventDefault();
        drawing = true; activePid = e.pointerId;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        const ll = tmap.containerPointToLatLng(tmap.mouseEventToContainerPoint(e));
        curStroke = { style: styleSnapshot(), pts: [{ lat: ll.lat, lng: ll.lng }], _last: evXY(e) };
        redraw();
    }
    function onDrawMove(e) {
        if (!drawing || e.pointerId !== activePid) return;
        e.preventDefault();
        const xy = evXY(e), last = curStroke._last;
        if (last && Math.abs(xy.x - last.x) + Math.abs(xy.y - last.y) < 2) return;   // zahodit drobne pohyby
        const ll = tmap.containerPointToLatLng(tmap.mouseEventToContainerPoint(e));
        curStroke.pts.push({ lat: ll.lat, lng: ll.lng }); curStroke._last = xy;
        redraw();
    }
    function onDrawEnd(e) {
        if (!drawing || (activePid != null && e.pointerId !== activePid)) return;
        e.preventDefault();
        drawing = false; activePid = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        if (curStroke && curStroke.pts.length >= 2) { delete curStroke._last; sketch.strokes.push(curStroke); sketch.log.push('stroke'); save(); }
        curStroke = null; redraw();
    }
    function drawStrokePath(c, s) {
        if (!s || !s.pts || s.pts.length < 2) return;
        const st = strokeStyleOf(s);
        c.save(); c.setLineDash(st.dash || []); c.strokeStyle = st.color; c.lineWidth = st.width; c.lineJoin = 'round'; c.lineCap = 'round';
        c.beginPath(); const p0 = scr(s.pts[0]); c.moveTo(p0.x, p0.y);
        for (let i = 1; i < s.pts.length; i++) { const p = scr(s.pts[i]); c.lineTo(p.x, p.y); }
        c.stroke(); c.restore();
    }

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
        // shoelace s redukci o prvni vrchol (S-JTSK ~10^6 -> souciny by ztracely presnost)
        const y0 = m[0][0], x0 = m[0][1];
        for (let k = 0; k < m.length; k++) {
            const a = m[k], b = m[(k + 1) % m.length];
            area += (a[0] - y0) * (b[1] - x0) - (b[0] - y0) * (a[1] - x0);
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
            c.fillStyle = onWhite ? 'rgba(37,99,235,0.08)' : 'rgba(47,158,116,0.16)'; c.fill();
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
            if (!sketch.pts[l[0]] || !sketch.pts[l[1]]) return;
            const st = lineStyleOf(l);
            const a = scr(sketch.pts[l[0]]), b = scr(sketch.pts[l[1]]);
            ctx.strokeStyle = st.color; ctx.lineWidth = st.width; ctx.setLineDash(st.dash || []); ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        });
        ctx.setLineDash([]); ctx.lineCap = 'butt';
        // tahy od ruky (prst / stylus)
        (sketch.strokes || []).forEach(s => drawStrokePath(ctx, s));
        if (curStroke) drawStrokePath(ctx, curStroke);
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
        hint(`${sketch.pts.length} bodů · ${sketch.lines.length} čar · ${sketch.labels.length} popisků` + (sketch.strokes.length ? ` · ${sketch.strokes.length} tahů` : '') + (_ring ? ` · plocha ${fmtArea(_ring.area)} · obvod ${fmtLen(_ring.perim)}` : '') + (mode === 'connect' ? ' · spojuji' : mode === 'label' ? ' · popisek' : mode === 'draw' ? ' · kreslím' : ''));
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
        if (!sketch.pts.length && !sketch.strokes.length && !sketch.labels.length) { agInfo('Náčrt je prázdný.'); return; }
        // vektorovy nacrt na bilem podkladu (mapove dlazdice se kvuli CORS do PNG spolehlive neprenesou)
        const exp = document.createElement('canvas'); exp.width = canvas.width; exp.height = canvas.height;
        const c = exp.getContext('2d');
        c.fillStyle = '#fff'; c.fillRect(0, 0, exp.width, exp.height);
        sketch.lines.forEach(l => { if (!sketch.pts[l[0]] || !sketch.pts[l[1]]) return; const st = lineStyleOf(l); const a = scr(sketch.pts[l[0]]), b = scr(sketch.pts[l[1]]); c.strokeStyle = st.color; c.lineWidth = st.width; c.setLineDash(st.dash || []); c.lineCap = 'round'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); });
        c.setLineDash([]); c.lineCap = 'butt';
        (sketch.strokes || []).forEach(s => drawStrokePath(c, s));
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
        } catch (e) { agInfo('Export selhal: ' + (e && e.message ? e.message : e)); }
    };
})();
