// ===== AR Geodet - GEODETICKA KALKULACKA =====
// Offline vypocty v rovine S-JTSK (zadava se kladne Y, X jako vsude v appce; uhly v gonech).
// Naradi: smernik+delka, rajon, ortogonalni metoda, protinani vpred z uhlu, protinani z delek,
// volne stanovisko (vyrovnani), polygonovy porad (oboustranne pripojeny a orientovany),
// tachymetrie (polarni davka s vyskami), nivelacni zapisnik.
// Vysledky lze rovnou ulozit jako vlastni body (objevi se v mape, AR i checklistu).
// POZN: pocita se v rovine S-JTSK bez redukce delkoveho zkresleni (-10 az +14 cm/km);
// na bezne kratke ulohy zanedbatelne, u dlouhych poradu merene delky predem zredukujte.
// Nacita se PO logika.js a grafika.js; modal a styly si vytvari sama.

const GON = Math.PI / 200;
function gonNorm(a) { return ((a % 400) + 400) % 400; }
// rozdil uhlu v gonech normalizovany do <-200, 200>
function gonDiff(a, b) { return ((a - b + 600) % 400) - 200; }
function smernik(y1, x1, y2, x2) { return gonNorm(Math.atan2(y2 - y1, x2 - x1) / GON); }
function vzdalYX(y1, x1, y2, x2) { return Math.hypot(y2 - y1, x2 - x1); }
function polarYX(y, x, sm, d) { return { y: y + d * Math.sin(sm * GON), x: x + d * Math.cos(sm * GON) }; }

let _calcSaveSeq = 0;
function calcSavePoint(name, Y, X) {
    const c = sjtskToLatLng(Y, X);
    const newPoint = { id: 'cp_' + Date.now() + '_' + (_calcSaveSeq++) + '_' + Math.round(Math.random() * 1e4), name: name || 'Bod', lat: c.lat, lng: c.lng, cat: 'CUSTOM', type: 'custom' };
    persistentCustomPoints.push(newPoint);
    arPoints.push({ ...newPoint, hidden: false, currentDist: (userLat != null) ? getDistance(userLat, userLng, c.lat, c.lng) : 0 });
    setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints));
    drawAllMarkersOnMap(); initARMarkers(); if (typeof updateInfoPanel === 'function') updateInfoPanel();
}

// ---------- pomocnici pro formulare ----------
function _cv(id) { const el = document.getElementById(id); if (!el) return null; const f = parseFloat(String(el.value).trim().replace(',', '.')); return isNaN(f) ? null : f; }
function _cs(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function _fld(id, label, ph) { return `<label style="margin-top:8px;">${label}</label><input type="text" inputmode="decimal" autocomplete="off" id="${id}" placeholder="${ph || ''}">`; }
function _ptFld(idp, label) {
    return `<label style="margin-top:8px;">${label} <a href="#" onclick="openCalcPicker('${idp}'); return false;" style="color:var(--accent); font-size:12px; font-weight:600; float:right;">vybrat z bodů ▾</a></label>
    <div style="display:flex; gap:8px;"><input type="text" inputmode="decimal" autocomplete="off" id="${idp}-y" placeholder="Y" style="flex:1;"><input type="text" inputmode="decimal" autocomplete="off" id="${idp}-x" placeholder="X" style="flex:1;"></div>`;
}
function _getPt(idp, label) {
    const y = _cv(idp + '-y'), x = _cv(idp + '-x');
    if (y == null || x == null) throw 'Vyplňte souřadnice: ' + label;
    return { y: Math.abs(y), x: Math.abs(x) };
}
function _req(id, label) { const v = _cv(id); if (v == null) throw 'Vyplňte: ' + label; return v; }
function _resBox(html, col) { return `<div class="geo-highlight" style="border-left-color:${col || 'var(--accent)'}; margin-top:14px;">${html}</div>`; }
function _row(l, v) { return `<div class="geo-data-row" style="border:none; padding:3px 0;"><span class="geo-label">${l}</span><span class="geo-value">${v}</span></div>`; }
function _calcErr(e) { const out = document.getElementById('calc-result'); if (out) out.innerHTML = _resBox(`<span style="color:var(--danger);">${e}</span>`, 'var(--danger)'); }
function _saveBtnHtml(call) { return `<button class="btn btn-primary" style="margin-top:10px;" onclick="${call}"><svg class="icon"><use href="#i-plus"/></svg> Uložit jako vlastní bod</button>`; }
function fmtGon(g) { return gonNorm(g).toFixed(4); }

// vyber existujiciho bodu do formulare (Y/X se doplni v S-JTSK)
let _pickerTarget = null;
function openCalcPicker(idp) {
    _pickerTarget = idp;
    let el = document.getElementById('calc-picker-modal');
    if (!el) {
        el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'calc-picker-modal'; el.style.zIndex = '100002';
        el.innerHTML = `<div class="modal-content"><h3 style="color:var(--accent); margin-top:0;">Vybrat bod</h3><div class="modal-body" id="calc-picker-list"></div><button class="btn btn-secondary" style="margin-top:12px;" onclick="document.getElementById('calc-picker-modal').style.display='none'">Zrušit</button></div>`;
        document.body.appendChild(el);
    }
    const list = document.getElementById('calc-picker-list'); list.innerHTML = '';
    let pts = arPoints.filter(p => !p.hidden);
    if (userLat != null) pts = pts.map(p => ({ p: p, d: getDistance(userLat, userLng, p.lat, p.lng) })).sort((a, b) => a.d - b.d).map(o => o.p);
    pts = pts.slice(0, 80);
    if (!pts.length) list.innerHTML = '<p style="text-align:center; opacity:0.7;">Žádné body. Stáhněte okolí nebo vložte vlastní.</p>';
    pts.forEach(p => {
        const sj = proj4('EPSG:4326', 'EPSG:5514', [p.lng, p.lat]);
        const Y = Math.abs(sj[0]), X = Math.abs(sj[1]);
        const item = document.createElement('div'); item.className = 'cluster-list-item';
        item.innerHTML = `<div><div class="cluster-item-title">#${p.name}</div><div class="cluster-item-subtitle">Y ${Y.toFixed(2)} · X ${X.toFixed(2)}</div></div><div style="font-size:12px; opacity:0.7;">${p.cat}</div>`;
        item.addEventListener('click', () => {
            const fy = document.getElementById(_pickerTarget + '-y'), fx = document.getElementById(_pickerTarget + '-x');
            if (fy) fy.value = Y.toFixed(2); if (fx) fx.value = X.toFixed(2);
            el.style.display = 'none';
        });
        list.appendChild(item);
    });
    el.style.display = 'flex';
}

// ---------- kostra modalu ----------
const CALC_GROUPS = [
    { g: 'poloha', name: 'Polohové úlohy' },
    { g: 'vyrovnani', name: 'Vyrovnání a pořady' },
    { g: 'vysky', name: 'Výšky a tachymetrie' },
    { g: 'pomucky', name: 'Pomůcky' }
];
const CALC_TOOLS = [
    { id: 'smer', g: 'poloha', name: 'Směrník a délka', desc: 'ze souřadnic dvou bodů' },
    { id: 'rajon', g: 'poloha', name: 'Rajón', desc: 'polární metoda — bod ze směru a délky' },
    { id: 'orto', g: 'poloha', name: 'Ortogonální metoda', desc: 'staničení a kolmice od přímky' },
    { id: 'protuhel', g: 'poloha', name: 'Protínání vpřed z úhlů', desc: 'ze dvou stanovisek' },
    { id: 'protdelka', g: 'poloha', name: 'Protínání z délek', desc: 'ze dvou délek' },
    { id: 'volne', g: 'vyrovnani', name: 'Volné stanovisko', desc: 'vyrovnání ze 2+ bodů' },
    { id: 'polygon', g: 'vyrovnani', name: 'Polygonový pořad', desc: 'oboustranně připojený a orientovaný' },
    { id: 'tachy', g: 'vysky', name: 'Tachymetrie', desc: 'polární dávka, volitelně s výškami' },
    { id: 'nivel', g: 'vysky', name: 'Nivelační zápisník', desc: 'výšky z čtení zpět/vpřed' },
    { id: 'sci', g: 'pomucky', name: 'Vědecká kalkulačka', desc: 'běžné výpočty a funkce, ° / gon / rad' }
];

function ensureCalcModal() {
    if (document.getElementById('calc-modal')) return;
    const el = document.createElement('div');
    el.className = 'modal-overlay'; el.id = 'calc-modal';
    el.innerHTML = `<div class="modal-content">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
            <button id="calc-back" class="btn btn-secondary" style="display:none; margin:0; padding:8px 14px; width:auto; flex:0 0 auto;" onclick="showCalcHome()">‹ Zpět</button>
            <h3 id="calc-title" style="color:var(--accent); margin:0; flex:1;"><svg class="icon"><use href="#i-calc"/></svg> Kalkulačka</h3>
        </div>
        <div class="modal-body" id="calc-body" style="margin-top:6px;"></div>
        <button class="btn btn-secondary" style="margin-top:14px;" onclick="document.getElementById('calc-modal').style.display='none'">Zavřít</button>
    </div>`;
    document.body.appendChild(el);
}
function openCalcModal() { ensureCalcModal(); showCalcHome(); document.getElementById('calc-modal').style.display = 'flex'; }
function showCalcHome() {
    document.getElementById('calc-back').style.display = 'none';
    document.getElementById('calc-title').innerHTML = '<svg class="icon"><use href="#i-calc"/></svg> Geodetická kalkulačka';
    const body = document.getElementById('calc-body');
    const tile = t => `<div class="cluster-list-item" onclick="showCalcTool('${t.id}')"><div><div class="cluster-item-title">${t.name}</div><div class="cluster-item-subtitle">${t.desc}</div></div><div style="opacity:0.5;">›</div></div>`;
    let html = '<p style="margin:0 0 10px; font-size:12.5px; opacity:0.75;">Výpočty v rovině S-JTSK, úhly v gonech, plně offline. Výsledky lze uložit jako vlastní body.</p>';
    CALC_GROUPS.forEach(gr => {
        const tools = CALC_TOOLS.filter(t => t.g === gr.g);
        if (!tools.length) return;
        html += `<div style="font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; opacity:0.5; margin:14px 0 6px;">${gr.name}</div>` + tools.map(tile).join('');
    });
    body.innerHTML = html;
}
function showCalcTool(id) {
    const t = CALC_TOOLS.find(x => x.id === id); if (!t) return;
    document.getElementById('calc-back').style.display = 'block';
    document.getElementById('calc-title').innerText = t.name;
    const body = document.getElementById('calc-body');
    body.innerHTML = '';
    window['renderCalc_' + id](body);
}

// ============================================================
// 1) SMERNIK A DELKA
function renderCalc_smer(body) {
    body.innerHTML = _ptFld('sm-a', 'Bod A (stanovisko)') + _ptFld('sm-b', 'Bod B (cíl)')
        + `<button class="btn btn-blue" style="margin-top:14px;" onclick="calcSmer()">Spočítat</button><div id="calc-result"></div>`;
}
function calcSmer() {
    try {
        const A = _getPt('sm-a', 'bod A'), B = _getPt('sm-b', 'bod B');
        const sm = smernik(A.y, A.x, B.y, B.x), d = vzdalYX(A.y, A.x, B.y, B.x);
        document.getElementById('calc-result').innerHTML = _resBox(
            _row('Směrník σ<sub>AB</sub>', fmtGon(sm) + ' gon') + _row('(ve stupních)', (sm * 0.9).toFixed(4) + ' °')
            + _row('Vodorovná délka', d.toFixed(3) + ' m') + _row('ΔY / ΔX', (B.y - A.y).toFixed(3) + ' / ' + (B.x - A.x).toFixed(3) + ' m'));
    } catch (e) { _calcErr(e); }
}

// ============================================================
// 2) RAJON
function renderCalc_rajon(body) {
    body.innerHTML = _ptFld('rj-st', 'Stanovisko') + _ptFld('rj-or', 'Orientační bod')
        + _fld('rj-cteni-or', 'Čtení na orientaci [gon]', 'např. 0.0000')
        + _fld('rj-cteni', 'Čtení na určovaný bod [gon]', '')
        + _fld('rj-d', 'Vodorovná délka na bod [m]', '')
        + _fld('rj-dor', 'Kontrolní délka na orient. [m]', 'nepovinné')
        + _fld('rj-name', 'Název nového bodu', 'např. 4001')
        + `<button class="btn btn-blue" style="margin-top:14px;" onclick="calcRajon()">Spočítat</button><div id="calc-result"></div>`;
}
let _rajonRes = null;
function calcRajon() {
    try {
        const ST = _getPt('rj-st', 'stanovisko'), OR = _getPt('rj-or', 'orientace');
        const ctO = _req('rj-cteni-or', 'čtení na orientaci'), ct = _req('rj-cteni', 'čtení na bod'), d = _req('rj-d', 'délku');
        const smOr = smernik(ST.y, ST.x, OR.y, OR.x);
        const oposun = gonNorm(smOr - ctO);
        const sm = gonNorm(oposun + ct);
        const P = polarYX(ST.y, ST.x, sm, d);
        _rajonRes = { name: _cs('rj-name') || 'Rajón', y: P.y, x: P.x };
        let ctrl = '';
        const dor = _cv('rj-dor');
        if (dor != null) {
            const dOrPocet = vzdalYX(ST.y, ST.x, OR.y, OR.x);
            ctrl = _row('Kontrola délky na orientaci', `měřeno ${dor.toFixed(3)} / ze souřadnic ${dOrPocet.toFixed(3)} m (rozdíl ${((dor - dOrPocet) * 1000).toFixed(0)} mm)`);
        }
        document.getElementById('calc-result').innerHTML = _resBox(
            _row('Orientační posun', fmtGon(oposun) + ' gon') + _row('Směrník na bod', fmtGon(sm) + ' gon')
            + _row('<b>Y</b>', '<b>' + P.y.toFixed(2) + '</b>') + _row('<b>X</b>', '<b>' + P.x.toFixed(2) + '</b>') + ctrl)
            + _saveBtnHtml("calcSavePoint(_rajonRes.name, _rajonRes.y, _rajonRes.x); this.innerText='Uloženo ✓'; this.disabled=true;");
    } catch (e) { _calcErr(e); }
}

// ============================================================
// 3) ORTOGONALNI METODA
function renderCalc_orto(body) {
    body.innerHTML = _ptFld('or-a', 'Počátek měřické přímky A') + _ptFld('or-b', 'Konec měřické přímky B')
        + _fld('or-s', 'Staničení od A [m]', '')
        + _fld('or-k', 'Kolmice [m]', 'vpravo +, vlevo −')
        + _fld('or-name', 'Název nového bodu', '')
        + `<button class="btn btn-blue" style="margin-top:14px;" onclick="calcOrto()">Spočítat</button><div id="calc-result"></div>`;
}
let _ortoRes = null;
function calcOrto() {
    try {
        const A = _getPt('or-a', 'bod A'), B = _getPt('or-b', 'bod B');
        const s = _req('or-s', 'staničení'), k = _req('or-k', 'kolmici');
        const sm = smernik(A.y, A.x, B.y, B.x);
        const P1 = polarYX(A.y, A.x, sm, s);
        const P = polarYX(P1.y, P1.x, gonNorm(sm + 100), k);
        _ortoRes = { name: _cs('or-name') || 'Orto', y: P.y, x: P.x };
        document.getElementById('calc-result').innerHTML = _resBox(
            _row('Délka přímky AB (ze souřadnic)', vzdalYX(A.y, A.x, B.y, B.x).toFixed(3) + ' m')
            + _row('<b>Y</b>', '<b>' + P.y.toFixed(2) + '</b>') + _row('<b>X</b>', '<b>' + P.x.toFixed(2) + '</b>'))
            + _saveBtnHtml("calcSavePoint(_ortoRes.name, _ortoRes.y, _ortoRes.x); this.innerText='Uloženo ✓'; this.disabled=true;");
    } catch (e) { _calcErr(e); }
}

// ============================================================
// 4) PROTINANI VPRED Z UHLU
function renderCalc_protuhel(body) {
    body.innerHTML = `<p style="font-size:12px; opacity:0.75; margin:0 0 4px;">Úhly se zadávají tak, jak vyjdou z přístroje: úhel = čtení na určovaný bod − čtení na druhé stanovisko (po směru hodinových ručiček, 0–400 gon).</p>`
        + _ptFld('pu-a', 'Stanovisko A') + _ptFld('pu-b', 'Stanovisko B')
        + _fld('pu-ua', 'Úhel na A: od směru A→B k cíli [gon]', '')
        + _fld('pu-ub', 'Úhel na B: od směru B→A k cíli [gon]', '')
        + _fld('pu-name', 'Název nového bodu', '')
        + `<button class="btn btn-blue" style="margin-top:14px;" onclick="calcProtUhel()">Spočítat</button><div id="calc-result"></div>`;
}
let _puRes = null;
function calcProtUhel() {
    try {
        const A = _getPt('pu-a', 'stanovisko A'), B = _getPt('pu-b', 'stanovisko B');
        const ua = _req('pu-ua', 'úhel na A'), ub = _req('pu-ub', 'úhel na B');
        const smAB = smernik(A.y, A.x, B.y, B.x);
        const sm1 = gonNorm(smAB + ua), sm2 = gonNorm(smAB + 200 + ub);
        const den = Math.sin((sm1 - sm2) * GON);
        if (Math.abs(den) < 1e-9) throw 'Záměry jsou rovnoběžné — bod nelze protnout.';
        const t = ((B.y - A.y) * Math.cos(sm2 * GON) - (B.x - A.x) * Math.sin(sm2 * GON)) / den;
        const P = polarYX(A.y, A.x, sm1, t);
        if (t < 0) throw 'Záměry se protínají za zády stanoviska A — zkontrolujte úhly.';
        _puRes = { name: _cs('pu-name') || 'Protínání', y: P.y, x: P.x };
        const gamma = Math.abs(gonDiff(sm1, sm2));
        const warn = (gamma < 33 || gamma > 367 || (gamma > 167 && gamma < 233)) ? `<div style="color:#fbbf24; font-size:12px; padding-top:4px;">⚠ Úhel protnutí ${fmtGon(gamma)} gon je nepříznivý (ideál kolem 100 gon) — výsledek bude málo přesný.</div>` : '';
        document.getElementById('calc-result').innerHTML = _resBox(
            _row('Směrník A→P', fmtGon(sm1) + ' gon') + _row('Směrník B→P', fmtGon(sm2) + ' gon')
            + _row('<b>Y</b>', '<b>' + P.y.toFixed(2) + '</b>') + _row('<b>X</b>', '<b>' + P.x.toFixed(2) + '</b>') + warn)
            + _saveBtnHtml("calcSavePoint(_puRes.name, _puRes.y, _puRes.x); this.innerText='Uloženo ✓'; this.disabled=true;");
    } catch (e) { _calcErr(e); }
}

// ============================================================
// 5) PROTINANI Z DELEK
function renderCalc_protdelka(body) {
    body.innerHTML = _ptFld('pd-a', 'Bod A') + _ptFld('pd-b', 'Bod B')
        + _fld('pd-da', 'Délka A → bod [m]', '') + _fld('pd-db', 'Délka B → bod [m]', '')
        + `<label style="margin-top:8px;">Poloha bodu vůči směru A→B</label>
        <div class="filter-group" style="display:flex; gap:14px;">
            <label class="filter-row" style="margin:0;"><input type="radio" name="pd-side" value="L" checked> vlevo</label>
            <label class="filter-row" style="margin:0;"><input type="radio" name="pd-side" value="R"> vpravo</label>
        </div>`
        + _fld('pd-name', 'Název nového bodu', '')
        + `<button class="btn btn-blue" style="margin-top:14px;" onclick="calcProtDelka()">Spočítat</button><div id="calc-result"></div>`;
}
let _pdRes = null;
function calcProtDelka() {
    try {
        const A = _getPt('pd-a', 'bod A'), B = _getPt('pd-b', 'bod B');
        const da = _req('pd-da', 'délku z A'), db = _req('pd-db', 'délku z B');
        const c = vzdalYX(A.y, A.x, B.y, B.x);
        if (c < 0.01) throw 'Body A a B jsou totožné.';
        if (da + db < c || Math.abs(da - db) > c) throw `Délky netvoří trojúhelník (vzdálenost AB = ${c.toFixed(3)} m).`;
        const a = (da * da - db * db + c * c) / (2 * c);
        const h2 = da * da - a * a;
        const h = Math.sqrt(Math.max(0, h2));
        const side = document.querySelector('input[name="pd-side"]:checked').value;
        const smAB = smernik(A.y, A.x, B.y, B.x);
        const pata = polarYX(A.y, A.x, smAB, a);
        const P = polarYX(pata.y, pata.x, gonNorm(smAB + (side === 'R' ? 100 : -100)), h);
        _pdRes = { name: _cs('pd-name') || 'Protínání', y: P.y, x: P.x };
        document.getElementById('calc-result').innerHTML = _resBox(
            _row('Vzdálenost AB', c.toFixed(3) + ' m') + _row('Pata kolmice od A', a.toFixed(3) + ' m') + _row('Kolmice', h.toFixed(3) + ' m')
            + _row('<b>Y</b>', '<b>' + P.y.toFixed(2) + '</b>') + _row('<b>X</b>', '<b>' + P.x.toFixed(2) + '</b>'))
            + _saveBtnHtml("calcSavePoint(_pdRes.name, _pdRes.y, _pdRes.x); this.innerText='Uloženo ✓'; this.disabled=true;");
    } catch (e) { _calcErr(e); }
}

// ============================================================
// 6) VOLNE STANOVISKO (vyrovnani rotace+posun, merictko = 1)
let _vsRows = 0;
function renderCalc_volne(body) {
    _vsRows = 0;
    body.innerHTML = `<p style="font-size:12px; opacity:0.75; margin:0 0 4px;">Na neznámém stanovisku změřte směry a vodorovné délky na 2+ známé body. Vyrovná se poloha stanoviska i orientace (měřítko pevně 1).</p>
        <div id="vs-rows"></div>
        <button class="btn btn-secondary" style="margin-top:8px;" onclick="addVsRow()"><svg class="icon"><use href="#i-plus"/></svg> Přidat záměru</button>
        ${_fld('vs-name', 'Název stanoviska', 'např. 5001')}
        <button class="btn btn-blue" style="margin-top:14px;" onclick="calcVolne()">Vyrovnat</button><div id="calc-result"></div>`;
    addVsRow(); addVsRow();
}
function addVsRow() {
    const i = _vsRows++;
    const div = document.createElement('div');
    div.className = 'geo-highlight'; div.style.cssText = 'margin:8px 0; padding:10px;'; div.id = 'vs-row-' + i;
    div.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><b style="font-size:13px;">Záměra ${i + 1}</b><button class="cp-btn cp-btn-delete" onclick="document.getElementById('vs-row-${i}').remove()"><svg class="icon"><use href="#i-trash"/></svg></button></div>`
        + _ptFld('vs-p' + i, 'Známý bod')
        + `<div style="display:flex; gap:8px;"><div style="flex:1;">${_fld('vs-psi' + i, 'Směr [gon]', '')}</div><div style="flex:1;">${_fld('vs-d' + i, 'Vod. délka [m]', '')}</div></div>`;
    document.getElementById('vs-rows').appendChild(div);
}
let _vsRes = null;
function calcVolne() {
    try {
        const obs = [];
        for (let i = 0; i < _vsRows; i++) {
            if (!document.getElementById('vs-row-' + i)) continue;
            const y = _cv('vs-p' + i + '-y'), x = _cv('vs-p' + i + '-x'), psi = _cv('vs-psi' + i), d = _cv('vs-d' + i);
            if (y == null && x == null && psi == null && d == null) continue;
            if (y == null || x == null || psi == null || d == null) throw 'Záměra ' + (i + 1) + ' není kompletní.';
            obs.push({ gy: Math.abs(y), gx: Math.abs(x), ly: d * Math.sin(psi * GON), lx: d * Math.cos(psi * GON), psi: psi, d: d });
        }
        if (obs.length < 2) throw 'Zadejte alespoň 2 kompletní záměry.';
        const n = obs.length;
        const lcy = obs.reduce((a, o) => a + o.ly, 0) / n, lcx = obs.reduce((a, o) => a + o.lx, 0) / n;
        const gcy = obs.reduce((a, o) => a + o.gy, 0) / n, gcx = obs.reduce((a, o) => a + o.gx, 0) / n;
        // LS rotace local->global: maximalizace c*SUM(g.l) + s*SUM(cross)
        let sA = 0, sB = 0;
        obs.forEach(o => { const ly = o.ly - lcy, lx = o.lx - lcx, gy = o.gy - gcy, gx = o.gx - gcx; sA += gy * ly + gx * lx; sB += gx * ly - gy * lx; });
        const th = Math.atan2(sB, sA), cT = Math.cos(th), sT = Math.sin(th);
        const rot = (ly, lx) => ({ y: cT * ly - sT * lx, x: sT * ly + cT * lx });
        const rl = rot(lcy, lcx);
        const S = { y: gcy - rl.y, x: gcx - rl.x };
        let vv = 0; const resRows = obs.map((o, i) => {
            const r = rot(o.ly, o.lx); const py = S.y + r.y, px = S.x + r.x;
            const vy = py - o.gy, vx = px - o.gx; vv += vy * vy + vx * vx;
            return _row('Záměra ' + (i + 1) + ' — odchylka', 'ΔY ' + (vy * 100).toFixed(1) + ' cm · ΔX ' + (vx * 100).toFixed(1) + ' cm');
        }).join('');
        const m0 = (2 * n - 4) > 0 ? Math.sqrt(vv / (2 * n - 4)) : null;
        const oposun = gonNorm(-th / GON);
        _vsRes = { name: _cs('vs-name') || 'Stanovisko', y: S.y, x: S.x };
        document.getElementById('calc-result').innerHTML = _resBox(
            _row('<b>Stanovisko Y</b>', '<b>' + S.y.toFixed(2) + '</b>') + _row('<b>Stanovisko X</b>', '<b>' + S.x.toFixed(2) + '</b>')
            + _row('Orientační posun', fmtGon(oposun) + ' gon (směrník = posun + čtení)')
            + (m0 != null ? _row('Stř. chyba vyrovnání m₀', '±' + (m0 * 100).toFixed(1) + ' cm') : _row('Nadbytečná měření', 'žádná (2 záměry = bez kontroly)'))
            + resRows)
            + _saveBtnHtml("calcSavePoint(_vsRes.name, _vsRes.y, _vsRes.x); this.innerText='Uloženo ✓'; this.disabled=true;");
    } catch (e) { _calcErr(e); }
}

// ============================================================
// 7) POLYGONOVY PORAD (oboustranne pripojeny a orientovany, levostranne uhly)
let _pgRows = 0;
function renderCalc_polygon(body) {
    _pgRows = 0;
    body.innerHTML = `<p style="font-size:12px; opacity:0.75; margin:0 0 4px;">Vrcholové úhly levostranné (po směru hodinových ručiček od záměry zpět k záměře vpřed). Úhlový i polohový uzávěr se rozdělí automaticky.</p>`
        + _ptFld('pg-o1', 'Orientace na počátku (bod „zpět")') + _ptFld('pg-p1', 'Počáteční bod pořadu')
        + _fld('pg-w1', 'Vrcholový úhel na počátečním bodě [gon]', '')
        + `<div id="pg-rows"></div>
        <button class="btn btn-secondary" style="margin-top:8px;" onclick="addPgRow()"><svg class="icon"><use href="#i-plus"/></svg> Přidat mezilehlý bod</button>`
        + _fld('pg-dlast', 'Délka poslední strany (na koncový bod) [m]', '')
        + _ptFld('pg-pk', 'Koncový bod pořadu') + _fld('pg-wk', 'Vrcholový úhel na koncovém bodě [gon]', '')
        + _ptFld('pg-o2', 'Orientace na konci (bod „vpřed")')
        + `<button class="btn btn-blue" style="margin-top:14px;" onclick="calcPolygon()">Vyrovnat pořad</button><div id="calc-result"></div>`;
    addPgRow();
}
function addPgRow() {
    const i = _pgRows++;
    const div = document.createElement('div');
    div.className = 'geo-highlight'; div.style.cssText = 'margin:8px 0; padding:10px;'; div.id = 'pg-row-' + i;
    div.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><b style="font-size:13px;">Mezilehlý bod ${i + 1}</b><button class="cp-btn cp-btn-delete" onclick="document.getElementById('pg-row-${i}').remove()"><svg class="icon"><use href="#i-trash"/></svg></button></div>
        <div style="display:flex; gap:8px;"><div style="flex:1;">${_fld('pg-d' + i, 'Délka předchozí strany [m]', '')}</div><div style="flex:1;">${_fld('pg-w' + i, 'Vrcholový úhel [gon]', '')}</div></div>`
        + _fld('pg-n' + i, 'Název bodu', 'PB' + (i + 1));
    document.getElementById('pg-rows').appendChild(div);
}
let _pgRes = null;
function calcPolygon() {
    try {
        const O1 = _getPt('pg-o1', 'orientaci na počátku'), P1 = _getPt('pg-p1', 'počáteční bod');
        const PK = _getPt('pg-pk', 'koncový bod'), O2 = _getPt('pg-o2', 'orientaci na konci');
        const w1 = _req('pg-w1', 'úhel na počátku'), wk = _req('pg-wk', 'úhel na konci'), dLast = _req('pg-dlast', 'délku poslední strany');
        const mids = [];
        for (let i = 0; i < _pgRows; i++) {
            if (!document.getElementById('pg-row-' + i)) continue;
            const d = _cv('pg-d' + i), w = _cv('pg-w' + i);
            if (d == null && w == null) continue;
            if (d == null || w == null) throw 'Mezilehlý bod ' + (i + 1) + ' není kompletní.';
            mids.push({ d: d, w: w, name: _cs('pg-n' + i) || ('PB' + (i + 1)) });
        }
        const angles = [w1].concat(mids.map(m => m.w)).concat([wk]);   // K uhlu
        const lengths = mids.map(m => m.d).concat([dLast]);            // K-1 delek
        const K = angles.length;
        // uhlovy uzaver: smerniky postupne, porovnat s pripojovacim smernikem na konci.
        // sm drzime jako "prichozi smer" (na vrcholu se otoci +200 a pricte levostranny uhel);
        // pro pocatek je prichozi smer = smernik orientace->pocatek
        const smStart = gonNorm(smernik(P1.y, P1.x, O1.y, O1.x) + 200);
        let sm = smStart;
        angles.forEach(w => { sm = gonNorm(sm + w + 200); });
        const smEndKnown = smernik(PK.y, PK.x, O2.y, O2.x);
        const Ow = gonDiff(smEndKnown, sm);
        const dw = Ow / K;
        // souradnice s opravenymi uhly
        sm = smStart;
        const pts = []; let cy = P1.y, cx = P1.x;
        for (let i = 0; i < K - 1; i++) {
            sm = gonNorm(sm + angles[i] + dw + 200);
            const p = polarYX(cy, cx, sm, lengths[i]);
            pts.push({ y: p.y, x: p.x, sm: sm, d: lengths[i] });
            cy = p.y; cx = p.x;
        }
        const sumD = lengths.reduce((a, b) => a + b, 0);
        const oY = PK.y - cy, oX = PK.x - cx;
        const op = Math.hypot(oY, oX);
        // rozdeleni polohoveho uzaveru umerne delkam
        let accD = 0;
        const fixed = pts.map((p, i) => { accD += p.d; return { y: p.y + oY * accD / sumD, x: p.x + oX * accD / sumD }; });
        _pgRes = mids.map((m, i) => ({ name: m.name, y: fixed[i].y, x: fixed[i].x }));
        let rows = _pgRes.map(p => _row('<b>' + p.name + '</b>', 'Y ' + p.y.toFixed(2) + ' · X ' + p.x.toFixed(2))).join('');
        const relTxt = op > 0.0005 ? '1 : ' + Math.round(sumD / op) : '—';
        const kontrola = _row('Kontrola dopočtu na koncový bod', 'ΔY ' + (oY * 100).toFixed(1) + ' cm · ΔX ' + (oX * 100).toFixed(1) + ' cm');
        document.getElementById('calc-result').innerHTML = _resBox(
            _row('Úhlový uzávěr O<sub>ω</sub>', (Ow * 10000).toFixed(0) + ' cc (' + fmtGon(Math.abs(Ow)) + ' gon)')
            + _row('Polohový uzávěr', (op * 100).toFixed(1) + ' cm (relativně ' + relTxt + ')')
            + _row('Délka pořadu Σd', sumD.toFixed(2) + ' m') + kontrola
            + '<hr style="border-color:rgba(255,255,255,0.12); margin:8px 0;">' + (rows || _row('Mezilehlé body', 'žádné'))
        ) + (_pgRes.length ? `<button class="btn btn-primary" style="margin-top:10px;" onclick="_pgRes.forEach(p => calcSavePoint(p.name, p.y, p.x)); this.innerText='Uloženo ✓ (' + _pgRes.length + ')'; this.disabled=true;"><svg class="icon"><use href="#i-plus"/></svg> Uložit mezilehlé body (${_pgRes.length})</button>` : '');
    } catch (e) { _calcErr(e); }
}

// ============================================================
// 8) TACHYMETRIE (polarni davka, volitelne sikme delky + zenitove uhly a vysky)
let _tcRows = 0;
function renderCalc_tachy(body) {
    _tcRows = 0;
    body.innerHTML = _ptFld('tc-st', 'Stanovisko')
        + `<div style="display:flex; gap:8px;"><div style="flex:1;">${_fld('tc-z', 'Výška stanoviska Z [m]', 'nepovinné')}</div><div style="flex:1;">${_fld('tc-vp', 'Výška přístroje [m]', '')}</div></div>`
        + _ptFld('tc-or', 'Orientační bod') + _fld('tc-cteni-or', 'Čtení na orientaci [gon]', 'např. 0.0000')
        + `<label class="filter-row" style="margin-top:10px;"><input type="checkbox" id="tc-sikme" checked> Šikmé délky + zenitové úhly (jinak vodorovné)</label>
        <div id="tc-rows"></div>
        <button class="btn btn-secondary" style="margin-top:8px;" onclick="addTcRow()"><svg class="icon"><use href="#i-plus"/></svg> Přidat bod</button>
        <button class="btn btn-blue" style="margin-top:14px;" onclick="calcTachy()">Spočítat dávku</button><div id="calc-result"></div>`;
    addTcRow();
}
function addTcRow() {
    const i = _tcRows++;
    const div = document.createElement('div');
    div.className = 'geo-highlight'; div.style.cssText = 'margin:8px 0; padding:10px;'; div.id = 'tc-row-' + i;
    div.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><b style="font-size:13px;">Bod ${i + 1}</b><button class="cp-btn cp-btn-delete" onclick="document.getElementById('tc-row-${i}').remove()"><svg class="icon"><use href="#i-trash"/></svg></button></div>`
        + _fld('tc-n' + i, 'Název', 'b' + (i + 1))
        + `<div style="display:flex; gap:8px;"><div style="flex:1;">${_fld('tc-psi' + i, 'Směr [gon]', '')}</div><div style="flex:1;">${_fld('tc-dd' + i, 'Délka [m]', '')}</div></div>
        <div style="display:flex; gap:8px;"><div style="flex:1;">${_fld('tc-zen' + i, 'Zenitový úhel [gon]', '100')}</div><div style="flex:1;">${_fld('tc-vc' + i, 'Výška cíle [m]', '')}</div></div>`;
    document.getElementById('tc-rows').appendChild(div);
}
let _tcRes = null;
function calcTachy() {
    try {
        const ST = _getPt('tc-st', 'stanovisko'), OR = _getPt('tc-or', 'orientaci');
        const ctO = _req('tc-cteni-or', 'čtení na orientaci');
        const Zst = _cv('tc-z'), vp = _cv('tc-vp') || 0;
        const sikme = document.getElementById('tc-sikme').checked;
        const oposun = gonNorm(smernik(ST.y, ST.x, OR.y, OR.x) - ctO);
        _tcRes = [];
        let rows = '';
        for (let i = 0; i < _tcRows; i++) {
            if (!document.getElementById('tc-row-' + i)) continue;
            const psi = _cv('tc-psi' + i), dd = _cv('tc-dd' + i);
            if (psi == null && dd == null) continue;
            if (psi == null || dd == null) throw 'Bod ' + (i + 1) + ': chybí směr nebo délka.';
            const name = _cs('tc-n' + i) || ('b' + (i + 1));
            const zen = _cv('tc-zen' + i), vc = _cv('tc-vc' + i) || 0;
            let dh = dd, dz = null;
            if (sikme) {
                if (zen == null) throw 'Bod ' + (i + 1) + ': chybí zenitový úhel.';
                dh = dd * Math.sin(zen * GON);
                dz = dd * Math.cos(zen * GON);
            }
            const sm = gonNorm(oposun + psi);
            const P = polarYX(ST.y, ST.x, sm, dh);
            let Z = null;
            if (Zst != null && dz != null) Z = Zst + vp + dz - vc;
            _tcRes.push({ name: name, y: P.y, x: P.x, z: Z });
            rows += _row('<b>' + name + '</b>', 'Y ' + P.y.toFixed(2) + ' · X ' + P.x.toFixed(2) + (Z != null ? ' · Z ' + Z.toFixed(2) : ''));
        }
        if (!_tcRes.length) throw 'Zadejte alespoň jeden bod.';
        document.getElementById('calc-result').innerHTML = _resBox(_row('Orientační posun', fmtGon(oposun) + ' gon') + rows)
            + `<button class="btn btn-primary" style="margin-top:10px;" onclick="_tcRes.forEach(p => calcSavePoint(p.name, p.y, p.x)); this.innerText='Uloženo ✓ (' + _tcRes.length + ')'; this.disabled=true;"><svg class="icon"><use href="#i-plus"/></svg> Uložit vše jako body (${_tcRes.length})</button>`;
    } catch (e) { _calcErr(e); }
}

// ============================================================
// 9) NIVELACNI ZAPISNIK (technicka nivelace mezi znamymi body)
let _nvRows = 0;
function renderCalc_nivel(body) {
    _nvRows = 0;
    body.innerHTML = _fld('nv-ha', 'Výška výchozího bodu A [m]', '')
        + `<div id="nv-rows"></div>
        <button class="btn btn-secondary" style="margin-top:8px;" onclick="addNvRow()"><svg class="icon"><use href="#i-plus"/></svg> Přidat sestavu</button>`
        + _fld('nv-hb', 'Výška koncového bodu B [m]', 'nepovinné — pro uzávěr')
        + `<button class="btn btn-blue" style="margin-top:14px;" onclick="calcNivel()">Spočítat</button><div id="calc-result"></div>`;
    addNvRow(); addNvRow();
}
function addNvRow() {
    const i = _nvRows++;
    const div = document.createElement('div');
    div.className = 'geo-highlight'; div.style.cssText = 'margin:8px 0; padding:10px;'; div.id = 'nv-row-' + i;
    div.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><b style="font-size:13px;">Sestava ${i + 1}</b><button class="cp-btn cp-btn-delete" onclick="document.getElementById('nv-row-${i}').remove()"><svg class="icon"><use href="#i-trash"/></svg></button></div>
        <div style="display:flex; gap:8px;"><div style="flex:1;">${_fld('nv-b' + i, 'Čtení zpět [m]', '')}</div><div style="flex:1;">${_fld('nv-f' + i, 'Čtení vpřed [m]', '')}</div></div>`;
    document.getElementById('nv-rows').appendChild(div);
}
function calcNivel() {
    try {
        const HA = _req('nv-ha', 'výšku výchozího bodu');
        const HBknown = _cv('nv-hb');
        const rows = [];
        for (let i = 0; i < _nvRows; i++) {
            if (!document.getElementById('nv-row-' + i)) continue;
            const b = _cv('nv-b' + i), f = _cv('nv-f' + i);
            if (b == null && f == null) continue;
            if (b == null || f == null) throw 'Sestava ' + (i + 1) + ' není kompletní.';
            rows.push({ b: b, f: f });
        }
        if (!rows.length) throw 'Zadejte alespoň jednu sestavu.';
        const n = rows.length;
        const sumB = rows.reduce((a, r) => a + r.b, 0), sumF = rows.reduce((a, r) => a + r.f, 0);
        const dH = sumB - sumF;
        let uz = null, opr = 0;
        if (HBknown != null) { uz = HBknown - (HA + dH); opr = uz / n; }
        let H = HA, out = '';
        rows.forEach((r, i) => {
            H += (r.b - r.f) + opr;
            const lbl = (i === n - 1) ? '<b>Koncový bod B</b>' : 'Přestavový bod ' + (i + 1);
            out += _row(lbl, (i === n - 1 ? '<b>' : '') + H.toFixed(3) + ' m' + (i === n - 1 ? '</b>' : ''));
        });
        document.getElementById('calc-result').innerHTML = _resBox(
            _row('Σ zpět − Σ vpřed', dH.toFixed(3) + ' m (převýšení A→B)')
            + (uz != null ? _row('Výškový uzávěr', (uz * 1000).toFixed(1) + ' mm (oprava ' + (opr * 1000).toFixed(2) + ' mm/sestavu)') : _row('Uzávěr', 'nelze — neznámá výška B'))
            + '<hr style="border-color:rgba(255,255,255,0.12); margin:8px 0;">' + out);
    } catch (e) { _calcErr(e); }
}

// ============================================================
// VEDECKA KALKULACKA (bezne vypocty + funkce; uhly v ° / gon / rad)
// Vstup je ciste tlacitkovy (pole tokenu), takze vyraz nikdy neobsahuje volny text uzivatele.
let _sciTokens = [];
let _sciAngle = 'gon';        // 'deg' | 'gon' | 'rad'
let _sciJustEval = false;
let _sciError = false;

function renderCalc_sci(body) {
    _sciTokens = []; _sciJustEval = false; _sciError = false;
    const k = (call, label, cls) => `<button class="sci-key${cls ? ' ' + cls : ''}" onclick="${call}">${label}</button>`;
    body.innerHTML = `
        <div class="sci-angle" id="sci-angle">
            <button data-m="deg" onclick="sciSetAngle('deg')">stupně °</button>
            <button data-m="gon" onclick="sciSetAngle('gon')">gony</button>
            <button data-m="rad" onclick="sciSetAngle('rad')">rad</button>
        </div>
        <div class="sci-display"><div class="sci-expr" id="sci-expr">0</div><div class="sci-res" id="sci-res">&nbsp;</div></div>
        <div class="sci-pad sci-fn">
            ${k("sciFunc('sin(')", 'sin')}${k("sciFunc('cos(')", 'cos')}${k("sciFunc('tan(')", 'tan')}${k("sciDel()", '⌫', 'sci-warn')}
            ${k("sciFunc('asin(')", 'asin')}${k("sciFunc('acos(')", 'acos')}${k("sciFunc('atan(')", 'atan')}${k("sciClear()", 'C', 'sci-warn')}
            ${k("sciFunc('√(')", '√')}${k("sciFunc('ⁿ√(')", 'ⁿ√')}${k("sciPost('^2')", 'x²')}${k("sciPost('^(−1)')", 'x⁻¹')}
            ${k("sciFunc('ln(')", 'ln')}${k("sciFunc('log(')", 'log')}${k("sciTok('^')", 'xⁿ')}${k("sciTok(',')", ',')}
            ${k("sciTok('π')", 'π')}${k("sciTok('e')", 'e')}${k("sciTok('(')", '(')}${k("sciTok(')')", ')')}
        </div>
        <div class="sci-pad sci-num">
            ${k("sciTok('7')", '7')}${k("sciTok('8')", '8')}${k("sciTok('9')", '9')}${k("sciTok('÷')", '÷', 'sci-op')}
            ${k("sciTok('4')", '4')}${k("sciTok('5')", '5')}${k("sciTok('6')", '6')}${k("sciTok('×')", '×', 'sci-op')}
            ${k("sciTok('1')", '1')}${k("sciTok('2')", '2')}${k("sciTok('3')", '3')}${k("sciTok('−')", '−', 'sci-op')}
            ${k("sciTok('0')", '0')}${k("sciTok('.')", '.')}${k("sciTok('^')", '^')}${k("sciTok('+')", '+', 'sci-op')}
        </div>
        <button class="btn btn-blue sci-eq" onclick="sciEquals()">=</button>`;
    sciSetAngle(_sciAngle);
    _sciRender();
}

function sciSetAngle(m) {
    _sciAngle = m;
    const wrap = document.getElementById('sci-angle');
    if (wrap) wrap.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.getAttribute('data-m') === m));
}

// po '=' dalsi cislice/funkce zacne novy vyraz; operator pokracuje z vysledku
function _sciAfterEval(isOperator) {
    if (!_sciJustEval) return;
    if (_sciError || !isOperator) _sciTokens = [];
    _sciJustEval = false; _sciError = false;
    const res = document.getElementById('sci-res'); if (res) res.innerHTML = '&nbsp;';
}

function _sciIsDigit(t) { return t.length === 1 && t >= '0' && t <= '9'; }
function _sciValueEnd(t) {
    if (!t) return false;
    if (t === ')' || t === 'π' || t === 'e' || t === '^2') return true;
    return /^-?\d*\.?\d+$/.test(t);   // cislice nebo cele cislo z vysledku
}
function _sciValueStart(t) {
    return t === '(' || t === 'π' || t === 'e' || t === '√(' || (t.length > 1 && t.charAt(t.length - 1) === '(');
}
// vlozi nasobeni jen kde je implicitni (2π, 3sin(, )(, )2) — ne mezi cislice jednoho cisla
function _sciMaybeMult(t) {
    if (!_sciTokens.length) return;
    const L = _sciTokens[_sciTokens.length - 1];
    const tDigit = _sciIsDigit(t) || t === '.';
    let mult = false;
    if (_sciValueStart(t) && _sciValueEnd(L)) mult = true;
    else if (tDigit && (L === ')' || L === 'π' || L === 'e' || L === '^2')) mult = true;
    if (mult) _sciTokens.push('×');
}
function sciTok(t) { _sciAfterEval('+−×÷^'.indexOf(t) >= 0); _sciMaybeMult(t); _sciTokens.push(t); _sciRender(); }
function sciFunc(t) { _sciAfterEval(false); _sciMaybeMult(t); _sciTokens.push(t); _sciRender(); }
function sciPost(t) { _sciAfterEval(true); _sciTokens.push(t); _sciRender(); }
function sciDel() { _sciJustEval = false; _sciTokens.pop(); _sciRender(); }
function sciClear() {
    _sciTokens = []; _sciJustEval = false; _sciError = false;
    const res = document.getElementById('sci-res'); if (res) res.innerHTML = '&nbsp;';
    _sciRender();
}
function _sciRender() {
    const ex = document.getElementById('sci-expr');
    if (ex) ex.innerText = _sciTokens.length ? _sciTokens.join('') : '0';
}

function _sciFmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return 'Error';
    let r = Math.round(n * 1e10) / 1e10;
    if (Object.is(r, -0)) r = 0;
    let s = String(r);
    if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) s = r.toFixed(10).replace(/\.?0+$/, '');
    return s;
}

// prevede tokenovy vyraz na JS a vyhodnoti; trig respektuje zvolenou jednotku uhlu
function _sciEval(expr) {
    const f = _sciAngle === 'gon' ? (Math.PI / 200) : (_sciAngle === 'rad' ? 1 : (Math.PI / 180)); // jednotka -> rad
    const g = _sciAngle === 'gon' ? (200 / Math.PI) : (_sciAngle === 'rad' ? 1 : (180 / Math.PI));  // rad -> jednotka
    const js = expr
        .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
        .replace(/π/g, '(PI)').replace(/e/g, '(E)')
        .replace(/ⁿ√/g, 'nroot').replace(/√/g, 'sqrt').replace(/\^/g, '**').replace(/%/g, '/100');
    const ctx = {
        PI: Math.PI, E: Math.E,
        sin: x => Math.sin(x * f), cos: x => Math.cos(x * f), tan: x => Math.tan(x * f),
        asin: x => Math.asin(x) * g, acos: x => Math.acos(x) * g, atan: x => Math.atan(x) * g,
        sqrt: Math.sqrt, ln: Math.log, log: x => Math.log(x) / Math.LN10, abs: Math.abs,
        nroot: (n, x) => (x < 0 && Math.abs(n % 2) === 1) ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n)
    };
    const names = Object.keys(ctx);
    const fn = new Function(...names, 'return (' + js + ');');
    return fn(...names.map(n => ctx[n]));
}

function sciEquals() {
    if (!_sciTokens.length) return;
    const res = document.getElementById('sci-res');
    let val;
    try { val = _sciEval(_sciTokens.join('')); } catch (e) { val = NaN; }
    const out = _sciFmt(val);
    if (out === 'Error') {
        if (res) res.innerText = 'Chyba výrazu';
        _sciError = true; _sciJustEval = true;
        return;
    }
    if (res) res.innerText = '= ' + out;
    _sciTokens = [out];
    _sciJustEval = true; _sciError = false;
    _sciRender();
}

// styly vedecke kalkulacky (injektovane, at se nesaha do style.css)
(function () {
    const st = document.createElement('style');
    st.textContent = `
        .sci-angle { display:flex; gap:5px; margin-bottom:6px; }
        .sci-angle button { flex:1; padding:5px 4px; border-radius:8px; border:1px solid var(--glass-border); background:rgba(255,255,255,0.05); color:var(--text-color); font-size:11.5px; font-weight:600; cursor:pointer; }
        .sci-angle button.active { background:var(--accent); color:#04211c; border-color:var(--accent); }
        .sci-display { background:rgba(0,0,0,0.28); border:1px solid var(--glass-border); border-radius:10px; padding:6px 10px; margin-bottom:6px; }
        .sci-expr { font-family:var(--font-mono,monospace); font-size:17px; font-weight:600; text-align:right; overflow-x:auto; white-space:nowrap; }
        .sci-res { font-family:var(--font-mono,monospace); font-size:12.5px; text-align:right; color:var(--accent); margin-top:2px; overflow-x:auto; white-space:nowrap; min-height:14px; }
        .sci-pad { display:grid; grid-template-columns:repeat(4,1fr); gap:5px; margin-bottom:5px; }
        .sci-key { padding:7px 4px; border-radius:9px; border:1px solid var(--glass-border); background:rgba(255,255,255,0.06); color:var(--text-color); font-size:14px; font-weight:600; cursor:pointer; transition:filter 0.12s ease, transform 0.06s ease; }
        .sci-key:active { transform:scale(0.95); }
        .sci-fn .sci-key { font-size:11.5px; padding:6px 3px; background:rgba(255,255,255,0.03); }
        .sci-key.sci-op { background:rgba(59,130,246,0.18); color:#bcd7ff; }
        .sci-key.sci-warn { background:rgba(239,68,68,0.16); color:#ff9d9d; }
        .sci-eq { margin-top:0; padding:8px; font-size:15px; }
    `;
    document.head.appendChild(st);
})();
