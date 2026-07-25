// ===== AR Geodet - GNSS SATELITY (AR predikce) =====
// Kde na obloze jsou (a za chvili budou) druzice GPS/GLONASS/Galileo/BeiDou.
// Polohy se pocitaji lokalne ze SGP4 (knihovna satellite.js) z TLE elementu CelesTrak;
// TLE se cachuji v localStorage (globalne, nezavisle na zakazce) a vydrzi dny offline.
// AR vykresleni se veze na projekci z grafika.js (window._arProj + wrap renderAR).
// Nacita se PO logika.js a grafika.js; modal a styly si vytvari sama.

const TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=tle';
const TLE_CACHE_KEY = 'arTleCache1';
const TLE_MAX_AGE_H = 72;          // po 3 dnech nabidnout obnovu (pro azimut/elevaci stale ok)
const SAT_EL_MASK = 10;            // elevacni maska pro "viditelne" a DOP (stupne)

const SAT_SYS = [
    { key: 'GPS', col: '#34d399', label: 'GPS', test: n => n.indexOf('GPS') === 0 || n.indexOf('NAVSTAR') >= 0 },
    { key: 'GLO', col: '#f87171', label: 'GLONASS', test: n => n.indexOf('COSMOS') === 0 || n.indexOf('GLONASS') >= 0 },
    { key: 'GAL', col: '#60a5fa', label: 'Galileo', test: n => n.indexOf('GSAT') === 0 || n.indexOf('GALILEO') >= 0 },
    { key: 'BDS', col: '#fbbf24', label: 'BeiDou', test: n => n.indexOf('BEIDOU') >= 0 }
];

let tleSats = [];            // { name, short, sys, col, satrec }
let tleFetchedAt = null;     // ms epoch
let satObs = [];             // posledni spocitane { name, short, sys, col, az, el, rising }
let satARenabled = false;
let satTimeOffsetMin = 0;
let _satTimer = null;
let _satElems = {};          // name -> DOM element v AR overlayi

function _satSysOf(name) { for (const s of SAT_SYS) { if (s.test(name)) return s; } return { key: 'GNSS', col: '#a3a3a3', label: 'Jiné' }; }
function _satShortName(name, sys) {
    let m = name.match(/PRN\s+(\d+)/i); if (m) return 'G' + m[1].padStart(2, '0');
    m = name.match(/GALILEO\s+(\d+)/i); if (m) return 'E' + m[1].padStart(2, '0');
    m = name.match(/BEIDOU-?\d?\s+([A-Z]+\d+)/i); if (m) return 'B' + m[1];
    m = name.match(/\((\d{3})\)/); if (m && sys.key === 'GLO') return 'R' + m[1];
    m = name.match(/COSMOS\s+(\d+)/i); if (m) return 'R' + m[1].slice(-3);
    return name.replace(/\s.*$/, '').slice(0, 7);
}

function parseTLE(txt) {
    const out = [];
    if (typeof satellite === 'undefined') return out;
    const lines = txt.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim() !== '');
    for (let i = 0; i + 2 < lines.length + 1; i++) {
        if (lines[i][0] !== '1' && lines[i + 1] && lines[i + 1][0] === '1' && lines[i + 2] && lines[i + 2][0] === '2') {
            const name = lines[i].replace(/^0\s+/, '').trim().toUpperCase();
            try {
                const satrec = satellite.twoline2satrec(lines[i + 1], lines[i + 2]);
                const sys = _satSysOf(name);
                out.push({ name: name, short: _satShortName(name, sys), sys: sys.key, col: sys.col, satrec: satrec });
            } catch (e) {}
            i += 2;
        }
    }
    return out;
}

function loadTleFromCache() {
    try {
        const c = JSON.parse(localStorage.getItem(TLE_CACHE_KEY));
        if (c && c.txt) { tleSats = parseTLE(c.txt); tleFetchedAt = c.t || null; }
    } catch (e) {}
}

async function refreshTLE(silent) {
    const btn = document.getElementById('sat-refresh-btn');
    if (btn) { btn.disabled = true; btn.innerText = 'Stahuji TLE…'; }
    try {
        const res = await fetchWithTimeout(TLE_URL, 20000);
        const txt = await res.text();
        const parsed = parseTLE(txt);
        if (parsed.length < 10) throw new Error('TLE se nepodařilo přečíst');
        tleSats = parsed; tleFetchedAt = Date.now();
        try { localStorage.setItem(TLE_CACHE_KEY, JSON.stringify({ t: tleFetchedAt, txt: txt })); } catch (e) {}
        updateSatObs(); renderSatModalStats();
    } catch (e) {
        if (!silent) agInfo('Dráhy družic (TLE) se nepodařilo stáhnout — jste offline nebo je CelesTrak nedostupný.\nPredikce funguje z dříve stažených dat, pokud existují.');
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="icon"><use href="#i-download"/></svg> Aktualizovat dráhy (TLE)'; }
    renderSatModalStats();
}

// az/el vsech druzic v case date z aktualni GPS pozice
function computeSatPositions(date) {
    const out = [];
    if (typeof satellite === 'undefined' || !tleSats.length || userLat == null) return out;
    const gmst = satellite.gstime(date);
    const obs = { latitude: userLat * Math.PI / 180, longitude: userLng * Math.PI / 180, height: ((userAlt == null ? 300 : userAlt) / 1000) };
    tleSats.forEach(s => {
        try {
            const pv = satellite.propagate(s.satrec, date);
            if (!pv || !pv.position) return;
            const ecf = satellite.eciToEcf(pv.position, gmst);
            const la = satellite.ecfToLookAngles(obs, ecf);
            out.push({ name: s.name, short: s.short, sys: s.sys, col: s.col, az: la.azimuth * 180 / Math.PI, el: la.elevation * 180 / Math.PI });
        } catch (e) {}
    });
    return out;
}

// PDOP z geometrie viditelnych druzic (radky A = [-cos e sin a, -cos e cos a, -sin e, 1])
function computePDOP(obsList) {
    const sats = obsList.filter(o => o.el >= SAT_EL_MASK);
    if (sats.length < 4) return null;
    const N = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    sats.forEach(o => {
        const a = o.az * Math.PI / 180, e = o.el * Math.PI / 180;
        const row = [-Math.cos(e) * Math.sin(a), -Math.cos(e) * Math.cos(a), -Math.sin(e), 1];
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) N[i][j] += row[i] * row[j];
    });
    // inverze 4x4 Gaussovou eliminaci s jednotkovou matici
    const M = N.map((r, i) => r.concat([0, 0, 0, 0].map((_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < 4; c++) {
        let piv = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        if (Math.abs(M[piv][c]) < 1e-12) return null;
        const t = M[c]; M[c] = M[piv]; M[piv] = t;
        const d = M[c][c]; for (let j = 0; j < 8; j++) M[c][j] /= d;
        for (let r = 0; r < 4; r++) { if (r === c) continue; const f = M[r][c]; for (let j = 0; j < 8; j++) M[r][j] -= f * M[c][j]; }
    }
    const q = M[0][4] + M[1][5] + M[2][6];
    return q > 0 ? Math.sqrt(q) : null;
}

// prepocet poloh pro AR + statistiky (vola se kazde ~2 s, kdyz je potreba)
function updateSatObs() {
    if (userLat == null || !tleSats.length) { satObs = []; return; }
    const t0 = new Date(Date.now() + satTimeOffsetMin * 60000);
    const now = computeSatPositions(t0);
    const future = computeSatPositions(new Date(t0.getTime() + 5 * 60000));
    const futEl = {}; future.forEach(o => { futEl[o.name] = o.el; });
    now.forEach(o => { o.rising = (futEl[o.name] != null) ? (futEl[o.name] > o.el + 0.05) : null; });
    satObs = now;
}

function _satTick() {
    const modalOpen = (function () { const m = document.getElementById('sat-modal'); return m && m.style.display === 'flex'; })();
    if (!satARenabled && !modalOpen) { clearInterval(_satTimer); _satTimer = null; return; }
    updateSatObs();
    if (modalOpen) renderSatModalStats();
    if (!satARenabled) hideSatAR();
}
function _ensureSatTimer() { if (!_satTimer) { _satTick(); _satTimer = setInterval(_satTick, 2000); } }

// ---------- AR vykresleni (veze se na renderAR z grafika.js) ----------
function hideSatAR() { for (const k in _satElems) _satElems[k].style.display = 'none'; }
function renderSatellitesAR() {
    if (!satARenabled || viewMode === 'map' || !window._arProj || userLat == null) { hideSatAR(); return; }
    const pr = window._arProj;
    const DEG = Math.PI / 180;
    // Plné 3D promítání. Původní plochý model (u = azimut−heading, v = elevace) selhával nad
    // hlavou: družice vysoko/za zády se kvůli rozdílu azimutů kully nebo skákaly. Tady postavíme
    // skutečný směr kamery (forward z headingu + sklonu, vpravo/nahoru s rollem) a promítneme.
    const azF = (typeof currentHeading === 'number' ? currentHeading : 0) * DEG;
    const elF = (-pr.pitch) * DEG;                         // pr.pitch = stupně POD horizont
    const cf = Math.cos(elF), sf = Math.sin(elF);
    const f = [cf * Math.sin(azF), cf * Math.cos(azF), sf]; // forward v ENU (East,North,Up)
    let r = [f[1], -f[0], 0];                               // cross(forward, nahoru) = "vpravo"
    let rn = Math.hypot(r[0], r[1], r[2]);
    if (rn < 1e-4) { r = [Math.cos(azF), -Math.sin(azF), 0]; rn = 1; } // pohled (skoro) svisle
    r = [r[0] / rn, r[1] / rn, r[2] / rn];
    let cu = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]; // up
    if (pr.roll) {
        const cr = Math.cos(pr.roll), sr = Math.sin(pr.roll);
        const r2 = [r[0] * cr + cu[0] * sr, r[1] * cr + cu[1] * sr, r[2] * cr + cu[2] * sr];
        cu = [cu[0] * cr - r[0] * sr, cu[1] * cr - r[1] * sr, cu[2] * cr - r[2] * sr];
        r = r2;
    }
    const seen = {};
    satObs.forEach(o => {
        if (o.el < -2) return;
        const ce = Math.cos(o.el * DEG), se = Math.sin(o.el * DEG), ca = o.az * DEG;
        const d = [ce * Math.sin(ca), ce * Math.cos(ca), se];   // směr k družici (ENU)
        const fc = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];     // složka dopředu
        if (fc <= 0.06) return;                                 // za kamerou / mimo záběr
        const angX = Math.atan2(d[0] * r[0] + d[1] * r[1] + d[2] * r[2], fc) * 180 / Math.PI;
        const angY = Math.atan2(d[0] * cu[0] + d[1] * cu[1] + d[2] * cu[2], fc) * 180 / Math.PI;
        if (Math.abs(angX) > pr.halfH + 6 || Math.abs(angY) > pr.halfV + 6) return;
        const x = 50 + (angX / pr.halfH) * 50;
        const y = 50 - (angY / pr.halfV) * 50;                  // nahoru = menší top %
        let el = _satElems[o.name];
        if (!el) {
            el = document.createElement('div'); el.className = 'sat-marker';
            el.innerHTML = '<span class="sat-dot"></span><span class="sat-lbl"></span>';
            arOverlay.appendChild(el); _satElems[o.name] = el;
        }
        el.querySelector('.sat-dot').style.background = o.col;
        el.querySelector('.sat-dot').style.boxShadow = '0 0 8px ' + o.col;
        const trend = o.rising === true ? ' ↗' : (o.rising === false ? ' ↘' : '');
        el.querySelector('.sat-lbl').innerText = o.short + ' ' + Math.round(o.el) + '°' + trend;
        el.querySelector('.sat-lbl').style.color = o.col;
        el.style.left = Math.max(1, Math.min(99, x)) + '%'; el.style.top = Math.max(1, Math.min(99, y)) + '%';
        el.style.opacity = o.el < SAT_EL_MASK ? '0.45' : '1';
        el.style.display = 'block';
        seen[o.name] = true;
    });
    for (const k in _satElems) { if (!seen[k]) _satElems[k].style.display = 'none'; }
}
(function () {
    if (typeof renderAR !== 'function' || renderAR._satWrapped) return;   // idempotence (dvojí načtení)
    const _orig = renderAR;
    renderAR = function (event) { _orig(event); try { renderSatellitesAR(); } catch (e) {} };
    renderAR._satWrapped = true;
})();

// ---------- modal ----------
function ensureSatModal() {
    if (document.getElementById('sat-modal')) return;
    const el = document.createElement('div');
    el.className = 'modal-overlay'; el.id = 'sat-modal';
    el.innerHTML = `
        <div class="modal-content">
            <h3 style="color:var(--accent); margin-top:0; margin-bottom:5px;"><svg class="icon"><use href="#i-satellite"/></svg> GNSS satelity — predikce</h3>
            <p style="margin:0 0 10px; font-size:12.5px; opacity:0.8;">Namiřte telefon na volný kus oblohy (mezi domy, korunami stromů) a uvidíte, které družice tam jsou — a které tam za chvíli doletí (↗ stoupá, ↘ zapadá).</p>
            <div class="modal-body">
                <label class="filter-row" style="font-size:14px;"><input type="checkbox" id="sat-ar-toggle" onchange="satARenabled = this.checked; if(satARenabled) _ensureSatTimer(); else hideSatAR();"> Zobrazit satelity v AR kameře</label>
                <label style="margin-top:12px;">Předpověď: <span id="sat-time-val" style="color:var(--accent);">nyní</span></label>
                <input type="range" id="sat-time" min="0" max="180" step="5" value="0" oninput="satTimeOffsetMin = parseInt(this.value); document.getElementById('sat-time-val').innerText = satTimeOffsetMin ? ('za ' + satTimeOffsetMin + ' min') : 'nyní'; updateSatObs(); renderSatModalStats();">
                <div id="sat-stats" style="margin-top:10px;"></div>
                <button class="btn btn-blue" style="margin-top:12px;" onclick="findBestSatTime()"><svg class="icon"><use href="#i-crosshair"/></svg> Najít nejlepší konstelaci (3 h)</button>
                <div id="sat-best" style="font-size:13px; margin-top:8px;"></div>
                <div id="sat-tle-info" style="font-size:12px; opacity:0.7; margin-top:12px;"></div>
                <button class="btn btn-secondary" id="sat-refresh-btn" style="margin-top:8px;" onclick="refreshTLE(false)"><svg class="icon"><use href="#i-download"/></svg> Aktualizovat dráhy (TLE)</button>
                <p style="font-size:11px; opacity:0.55; margin:10px 0 0;">Výpočet probíhá v telefonu (SGP4). Dráhy družic: CelesTrak. Maska elevace ${SAT_EL_MASK}°.</p>
            </div>
            <button class="btn btn-secondary" style="margin-top:15px;" onclick="document.getElementById('sat-modal').style.display='none'">Zavřít</button>
        </div>`;
    document.body.appendChild(el);
}

function openSatModal() {
    ensureSatModal();
    document.getElementById('sat-ar-toggle').checked = satARenabled;
    document.getElementById('sat-modal').style.display = 'flex';
    if (typeof satellite === 'undefined') {
        document.getElementById('sat-stats').innerHTML = '<p style="color:var(--danger); font-size:13px;">Knihovna pro výpočet drah (satellite.js) se nenačetla — připojte se k internetu a obnovte aplikaci.</p>';
        return;
    }
    if (!tleSats.length) loadTleFromCache();
    const stale = !tleFetchedAt || (Date.now() - tleFetchedAt) > TLE_MAX_AGE_H * 3600 * 1000;
    if (!tleSats.length || stale) refreshTLE(!!tleSats.length); // bez dat: hlasit chybu; jen stara data: obnovit potichu
    _ensureSatTimer();
    renderSatModalStats();
}

function renderSatModalStats() {
    const div = document.getElementById('sat-stats'); if (!div) return;
    const m = document.getElementById('sat-modal'); if (!m || m.style.display !== 'flex') return;
    if (userLat == null) { div.innerHTML = '<p style="font-size:13px; opacity:0.7;">Čekám na GPS pozici…</p>'; return; }
    if (!tleSats.length) { div.innerHTML = '<p style="font-size:13px; opacity:0.7;">Zatím nejsou stažené dráhy družic (TLE) — klepněte na Aktualizovat.</p>'; return; }
    const vis = satObs.filter(o => o.el >= SAT_EL_MASK);
    const counts = {}; SAT_SYS.forEach(s => counts[s.key] = 0);
    vis.forEach(o => { if (counts[o.sys] != null) counts[o.sys]++; });
    div.innerHTML = `
        <div class="geo-highlight" style="border-left-color:var(--accent); margin:0;">
            <div class="geo-data-row" style="border:none; padding:3px 0;"><span class="geo-label">Viditelné družice (nad ${SAT_EL_MASK}°)</span><span class="geo-value">${vis.length}</span></div>
            <div style="display:flex; gap:10px; flex-wrap:wrap; padding:4px 0; font-size:12.5px;">
                ${SAT_SYS.map(s => `<span style="color:${s.col}; font-weight:600;">● ${s.label}: ${counts[s.key]}</span>`).join('')}
            </div>
        </div>`;
}

function findBestSatTime() {
    const out = document.getElementById('sat-best'); if (!out) return;
    if (userLat == null || !tleSats.length) { out.innerText = 'Chybí GPS pozice nebo data drah.'; return; }
    out.innerText = 'Počítám…';
    setTimeout(() => {
        let best = null;
        const t0 = Date.now();
        for (let min = 0; min <= 180; min += 5) {
            const obs = computeSatPositions(new Date(t0 + min * 60000));
            const pdop = computePDOP(obs);
            if (pdop != null && (best === null || pdop < best.pdop)) best = { min: min, pdop: pdop, n: obs.filter(o => o.el >= SAT_EL_MASK).length };
        }
        if (!best) { out.innerText = 'V příštích 3 hodinách není dost viditelných družic.'; return; }
        const when = new Date(t0 + best.min * 60000).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
        out.innerHTML = `Nejlepší rozmístění družic: <b style="color:var(--accent);">${best.min === 0 ? 'právě teď' : 'v ' + when + ' (za ' + best.min + ' min)'}</b> — ${best.n} družic nad ${SAT_EL_MASK}°.`;
    }, 30);
}

// ---------- styly ----------
(function () {
    const st = document.createElement('style');
    st.textContent = `
        .sat-marker { position: absolute; transform: translate(-50%, -50%); z-index: 1; pointer-events: none; display: none; text-align: center; }
        .sat-marker .sat-dot { display: block; width: 10px; height: 10px; border-radius: 50%; margin: 0 auto 2px; border: 1.5px solid rgba(255,255,255,0.85); }
        .sat-marker .sat-lbl { font-family: var(--font-mono, monospace); font-size: 10.5px; font-weight: 700; text-shadow: 0 1px 3px rgba(0,0,0,0.9); white-space: nowrap; }
    `;
    document.head.appendChild(st);
    loadTleFromCache();
})();


// ---------- (ODEBRÁNO na přání) řádek „Družice N" v hlavním info panelu ----------
// Počet viditelných družic + stáří drah se na hlavní obrazovce NEZOBRAZUJE —
// uživatel to nevnímal jako užitečné. Detail zůstává v nástroji „GNSS satelity"
// (openSatModal). Na hlavní obrazovce zůstává azimut (#compass-debug) a přesnost
// GPS (#gps-avg). NEVRACET bez pokynu.
