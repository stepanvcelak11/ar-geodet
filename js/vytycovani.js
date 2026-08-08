// ===== AR Geodet - VYTYCOVACI CHECKLIST =====
// Odskrtavani vytycenych bodu v terenu: dojdu k bodu, zatlucu kolik, odkliknu hotovo.
// Stav je per zakazka (getStoreKey) v 'arStakeout12' jako mapa { idBodu: {t: cas, acc: presnost} }.
// Uredni body maji stabilni id z polohy (stableId), vlastni body cp_..., takze stav prezije refetch.
// Nacita se PO logika.js a grafika.js; modal a styly si vytvari sama (nezasahuje do HTML/CSS).

let stakeoutData = {};
let stakeoutOnlyCustom = true;

function loadStakeout() {
    stakeoutData = {};
    try { const s = getStoredData('arStakeout12'); if (s) stakeoutData = JSON.parse(s) || {}; } catch (e) {}
}
function saveStakeout() { setStoredData('arStakeout12', JSON.stringify(stakeoutData)); }
function isStaked(id) { return !!stakeoutData[id]; }

function toggleStaked(pt) {
    if (stakeoutData[pt.id]) { delete stakeoutData[pt.id]; }
    else {
        // pri odkliknuti ulozime i dosazenou presnost (mini-protokol o vytyceni)
        let acc = null;
        if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && gpsAvgResult.n >= 3) acc = Math.round(gpsAvgResult.sterr * 100) / 100;
        else if (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy) acc = Math.round(currentGpsAccuracy * 10) / 10;
        stakeoutData[pt.id] = { t: Date.now(), acc: acc };
    }
    saveStakeout();
    if (pt.element) pt.element.classList.toggle('staked', isStaked(pt.id));
    drawAllMarkersOnMap();
    const m = document.getElementById('stakeout-modal');
    if (m && m.style.display === 'flex') renderStakeoutList();
}

// pocet kandidatu / hotovych pro progres (kandidat = vlastni bod nebo cokoli uz odskrtnuteho)
function stakeoutCandidates() {
    return arPoints.filter(p => !p.hidden && ((stakeoutOnlyCustom ? p.cat === 'CUSTOM' : true) || stakeoutData[p.id]));
}

// ---------- tlacitko "Vytyceno" v karte bodu: ZAMERNE ODSTRANENO ----------
// Na přání uživatele (7/2026): vytyčování má vlastní nástroj (Vytyčovací checklist),
// tlačítko v kartě bodu bylo zbytečné a zabíralo místo. Odškrtávání zůstává
// v modálu checklistu (renderStakeoutList / toggleStaked). NEVRACET bez pokynu.

// ---------- nacitani stavu pri startu a pri prepnuti zakazky ----------
(function () {
    if (typeof loadProjectSettings !== 'function' || loadProjectSettings._stakeWrapped) return;  // idempotence
    const _orig = loadProjectSettings;
    loadProjectSettings = function () { loadStakeout(); _orig(); };
    loadProjectSettings._stakeWrapped = true;
})();
loadStakeout();

// ---------- checklist modal ----------
function ensureStakeoutModal() {
    if (document.getElementById('stakeout-modal')) return;
    const el = document.createElement('div');
    el.className = 'modal-overlay'; el.id = 'stakeout-modal';
    el.innerHTML = `
        <div class="modal-content">
            <h3 style="color:var(--accent); margin-top:0; margin-bottom:5px;"><svg class="icon"><use href="#i-check"/></svg> Vytyčovací checklist</h3>
            <div id="stk-progress-row" style="display:flex; align-items:center; gap:10px; margin:8px 0 4px;">
                <div style="flex:1; height:9px; background:rgba(255,255,255,0.12); border-radius:99px; overflow:hidden;"><div id="stk-progress-bar" style="height:100%; width:0%; background:#10b981; border-radius:99px; transition:width 0.2s;"></div></div>
                <b id="stk-progress-txt" style="font-family:var(--font-mono,monospace); font-size:calc(13px * var(--ag-font-scale, 1)); color:var(--accent); white-space:nowrap;">0 / 0</b>
            </div>
            <label class="filter-row" style="margin:6px 0 2px; font-size:calc(13px * var(--ag-font-scale, 1));"><input type="checkbox" id="stk-only-custom" checked onchange="stakeoutOnlyCustom = this.checked; renderStakeoutList();"> Jen vlastní body (vytyčované)</label>
            <div class="modal-body" id="stakeout-list" style="margin-top:8px;"></div>
            <button class="btn btn-secondary" style="margin-top:10px;" onclick="exportStakeoutCSV()"><svg class="icon"><use href="#i-upload"/></svg> Export protokolu vytyčení (CSV)</button>
            <div class="row-buttons">
                <button class="btn btn-danger" onclick="resetStakeout()">Vymazat odškrtnutí</button>
                <button class="btn btn-secondary" onclick="document.getElementById('stakeout-modal').style.display='none'">Zavřít</button>
            </div>
        </div>`;
    document.body.appendChild(el);
}

function openStakeoutModal() {
    ensureStakeoutModal();
    document.getElementById('stk-only-custom').checked = stakeoutOnlyCustom;
    renderStakeoutList();
    document.getElementById('stakeout-modal').style.display = 'flex';
}

function resetStakeout() {
    agAsk('Zrušit odškrtnutí všech bodů v této zakázce?', { title: 'Zrušit odškrtnutí', okText: 'Zrušit odškrtnutí', danger: true }).then(function (ok) {
        if (!ok) return;
        stakeoutData = {}; saveStakeout();
        arPoints.forEach(p => { if (p.element) p.element.classList.remove('staked'); });
        drawAllMarkersOnMap(); renderStakeoutList();
    });
}

function renderStakeoutList() {
    const listDiv = document.getElementById('stakeout-list'); if (!listDiv) return;
    listDiv.innerHTML = '';
    const cands = stakeoutCandidates()
        .map(pt => ({ pt: pt, d: (userLat != null) ? getDistance(userLat, userLng, pt.lat, pt.lng) : null }))
        .sort((a, b) => {
            const sa = isStaked(a.pt.id) ? 1 : 0, sb = isStaked(b.pt.id) ? 1 : 0;
            if (sa !== sb) return sa - sb; // nevytycene nahore
            return (a.d == null || b.d == null) ? 0 : a.d - b.d;
        });
    const doneCount = cands.filter(c => isStaked(c.pt.id)).length;
    const bar = document.getElementById('stk-progress-bar'); if (bar) bar.style.width = (cands.length ? Math.round(doneCount / cands.length * 100) : 0) + '%';
    const txt = document.getElementById('stk-progress-txt'); if (txt) txt.innerText = doneCount + ' / ' + cands.length;
    if (!cands.length) {
        listDiv.innerHTML = '<p style="text-align:center; opacity:0.7; font-size:calc(13px * var(--ag-font-scale, 1));">Žádné body k vytyčení.<br>Naimportujte nebo vložte vlastní body, případně vypněte filtr „Jen vlastní body".</p>';
        return;
    }
    cands.forEach(({ pt, d }) => {
        const done = isStaked(pt.id);
        const rec = stakeoutData[pt.id];
        const item = document.createElement('div');
        item.className = 'cluster-list-item';
        if (done) item.style.opacity = '0.55';
        let sub = d != null ? d.toFixed(1) + ' m' : '';
        let detail = '';
        if (done && rec) {
            const when = rec.t ? new Date(rec.t).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            detail = `<div class="cluster-item-subtitle" style="color:#34d399;">✓ ${when}${rec.acc != null ? ' · ±' + rec.acc + ' m' : ''} · klepni = detail</div>`;
        } else {
            detail = `<div class="cluster-item-subtitle">klepni na název = navigovat</div>`;
        }
        item.innerHTML = `
            <div class="stk-check ${done ? 'done' : ''}" role="button" aria-label="Odškrtnout">${done ? '✓' : ''}</div>
            <div style="flex:1; min-width:0; padding:0 10px;"><div class="cluster-item-title" style="${done ? 'text-decoration:line-through;' : ''}">#${_escHtml(pt.name)}</div>${detail}</div>
            <div style="font-weight:600; font-size:calc(13px * var(--ag-font-scale, 1)); white-space:nowrap;">${sub}</div>`;
        item.style.display = 'flex'; item.style.alignItems = 'center';
        item.querySelector('.stk-check').addEventListener('click', (e) => { e.stopPropagation(); toggleStaked(pt); });
        if (done) item.addEventListener('click', () => openStakeRecord(pt));
        else item.addEventListener('click', () => { document.getElementById('stakeout-modal').style.display = 'none'; highlightPoint(pt); });
        listDiv.appendChild(item);
    });
}

// ---------- detail vytyceneho bodu (mini-protokol) ----------
let _stakeDetailPt = null;
function _stakeTypeLabel(cat) {
    if (cat === 'TB') return 'Trigonometrický bod';
    if (cat === 'ZHB') return 'Zhušťovací bod';
    if (cat === 'NIVEL') return 'Nivelační / Výškový bod';
    if (cat === 'CUSTOM') return 'Vlastní bod';
    return 'Podrobný polohový bod';
}
function openStakeRecord(pt) {
    const rec = stakeoutData[pt.id]; if (!rec) return;
    _stakeDetailPt = pt;
    let el = document.getElementById('stake-detail-modal');
    if (!el) {
        el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'stake-detail-modal'; el.style.zIndex = '100002';
        el.innerHTML = `<div class="modal-content">
            <h3 style="color:#34d399; margin-top:0; margin-bottom:5px;"><svg class="icon"><use href="#i-check"/></svg> <span id="stkd-title">Bod</span></h3>
            <div id="stkd-sub" style="font-size:calc(13px * var(--ag-font-scale, 1)); opacity:0.75; margin-bottom:8px;"></div>
            <div class="modal-body" id="stkd-body"></div>
            <button class="btn btn-warning" style="margin-top:12px;" onclick="document.getElementById('stake-detail-modal').style.display='none'; document.getElementById('stakeout-modal').style.display='none'; highlightPoint(_stakeDetailPt);"><svg class="icon"><use href="#i-star"/></svg> Navigovat k bodu (kontrola)</button>
            <button class="btn btn-danger" onclick="toggleStaked(_stakeDetailPt); document.getElementById('stake-detail-modal').style.display='none';">Zrušit odškrtnutí</button>
            <button class="btn btn-secondary" style="margin-top:10px;" onclick="document.getElementById('stake-detail-modal').style.display='none'">Zavřít</button>
        </div>`;
        document.body.appendChild(el);
    }
    const sj = proj4('EPSG:4326', 'EPSG:5514', [pt.lng, pt.lat]);
    const when = rec.t ? new Date(rec.t).toLocaleString('cs-CZ') : '—';
    const d = (userLat != null) ? getDistance(userLat, userLng, pt.lat, pt.lng) : null;
    const row = (l, v) => `<div class="geo-data-row"><span class="geo-label">${l}</span><span class="geo-value">${v}</span></div>`;
    document.getElementById('stkd-title').innerText = '#' + pt.name;
    document.getElementById('stkd-sub').innerText = _stakeTypeLabel(pt.cat);
    document.getElementById('stkd-body').innerHTML =
        row('S-JTSK Y', Math.abs(sj[0]).toFixed(2))
        + row('S-JTSK X', Math.abs(sj[1]).toFixed(2))
        + row('Vytyčeno', when)
        + row('Přesnost při vytyčení', rec.acc != null ? '±' + rec.acc + ' m' : 'nezaznamenána')
        + (d != null ? row('Aktuální vzdálenost', d.toFixed(1) + ' m') : '');
    el.style.display = 'flex';
}

// export protokolu: nazev;Y;X;vytyceno;presnost_m (BOM kvuli diakritice v Excelu)
function exportStakeoutCSV() {
    const done = arPoints.filter(p => stakeoutData[p.id]);
    if (!done.length) return agInfo('Zatím není vytyčen žádný bod.');
    const lines = ['název;Y;X;vytyčeno;přesnost_m'].concat(done.map(pt => {
        const rec = stakeoutData[pt.id];
        const sj = proj4('EPSG:4326', 'EPSG:5514', [pt.lng, pt.lat]);
        const when = rec.t ? new Date(rec.t).toLocaleString('cs-CZ') : '';
        const nm = String(pt.name == null ? 'Bod' : pt.name).replace(/[;\r\n]/g, ' ');
        return nm + ';' + Math.abs(sj[0]).toFixed(2) + ';' + Math.abs(sj[1]).toFixed(2) + ';' + when + ';' + (rec.acc != null ? rec.acc : '');
    }));
    const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
    const a = document.createElement('a');
    a.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv));
    a.setAttribute('download', `vytyceni_${activeProjectId}.csv`);
    document.body.appendChild(a); a.click(); a.remove();
}

// ---------- styly (injektovane, at se nesaha do style.css) ----------
(function () {
    const st = document.createElement('style');
    st.textContent = `
        .ar-marker.staked { opacity: 0.55 !important; filter: grayscale(0.5); }
        .ar-marker.staked .ar-marker-title::before { content: '✓ '; color: #34d399; }
        .stk-check { flex: 0 0 30px; width: 30px; height: 30px; border-radius: 9px; border: 2px solid rgba(255,255,255,0.35); display: flex; align-items: center; justify-content: center; font-size: calc(18px * var(--ag-font-scale, 1)); font-weight: 800; color: #04110b; cursor: pointer; }
        .stk-check.done { background: #10b981; border-color: #10b981; }
    `;
    document.head.appendChild(st);
})();
