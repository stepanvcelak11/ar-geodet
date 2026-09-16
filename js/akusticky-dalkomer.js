// ===== QTRIG — AKUSTICKÝ DÁLKOMĚR MEZI TELEFONY (ODPOJITELNÁ vrstva) ==========
// Délka mezi dvěma telefony ze ZVUKU, centimetry místo metrů. Zvuk letí ~343 m/s;
// při vzorkování 48 kHz je jeden vzorek ≈ 7 mm, takže ostrý „cvrlik" (lineární
// chirp) se korelací s jeho předlohou najde v nahrávce na jeden vzorek přesně.
//
// PROTOKOL (obousměrný, žádná synchronizace hodin — BeepBeep, MSR 2007, upravený):
//   telefon A (zahajuje)             telefon B (odpovídá, stojí na známém bodě)
//   1. zahraje chirp ↑ (nahoru)  →   slyší ho v čase a₀ (svých vzorcích)
//      slyší SÁM SEBE v čase t₀       2. naplánuje odpověď ↓ na čas o₁, slyší sám
//   3. slyší odpověď ↓ v čase t₁      sebe v čase b₁ → ΔB = b₁ − a₀
//                                     4. zahraje DRUHÝ chirp ↓ přesně v o₁ + G0 + ΔB
//   5. slyší ho v t₂ → ΔB = (t₂ − t₁) − G0 (obě cesty jsou stejné, mezera se
//      cestou nemění) — B tak A „řekne" své číslo mezerou mezi dvěma pípnutími,
//      bez internetu, bez QR, bez opisování.
//   6. D = c/2 · (ΔA − ΔB) + oprava,  ΔA = t₁ − t₀,  c = 331,3 + 0,606·T (°C).
//   Každý telefon si měří jen SVÉ vlastní intervaly, takže rozdíl hodin, zpoždění
//   Bluetooth, výstupní latence prohlížeče ani rychlost reakce roli nehrají.
//   Oprava = ½ (vzdálenost reproduktor↔mikrofon obou telefonů), výchozí 0,12 m,
//   dá se dokalibrovat na pásmem odměřených 2,00 m.
//
// PŘESNOST: ±2–5 cm na 5–40 m venku. Zhoršuje ji vítr (1 m/s = 0,3 % délky),
// špatná teplota (1 °C = 0,18 %), hluk stroje v pásmu chirpu a odrazy (bere se
// první, ne nejsilnější špička — přímá cesta je vždycky nejkratší).
//
// K ČEMU: délka k ZNÁMÉMU bodu = klasická geodezie, jen dálkoměr je zvuk.
// Dvě délky ke dvěma známým bodům → protínání z délek → nový bod bez GPS.
//
// TECHNIKA: getUserMedia bez echoCancellation (jinak by prohlížeč vlastní chirp
// z nahrávky vymazal — to je přesně to, co potlačení ozvěny dělá), ScriptProcessor
// (běží i v Safari na iPhonu), přímá korelace s předlohou blok po bloku (~8 M
// násobení na 85 ms bloku), práh 7σ nad šumem výstupu filtru, čelo špičky proti
// odrazům, parabolická interpolace na zlomek vzorku. A a B mají chirp opačného
// směru (↑ / ↓), aby si nikdo nespletl cizí pípnutí s vlastním.
//
// Vstup: dlaždice „Akustický dálkoměr" v Nástrojích (Měření), načítá se až na klepnutí.
// Odstranění: smaž js/akusticky-dalkomer.js + záznam v js/lazy-tools.js a
// js/tools-registry.js (+ data/navody.json), přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGAkustika) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="5" height="10" rx="1.5"/><rect x="17" y="7" width="5" height="10" rx="1.5"/><path d="M9.5 9.5a4 4 0 0 1 0 5M12 7.5a7 7 0 0 1 0 9"/></svg>';
    var DLG_ID = 'ag-aku-modal';
    var LS_OFF = 'agAkuOffset_v1';      // oprava nuly (m)
    var LS_SET = 'agAkuSet_v1';         // { pasmo, kola, teplota }
    var LS_LEN = 'agAkuDelky_v1';       // změřené délky ke známým bodům

    var CHIRP_S = 0.03;        // délka chirpu (s)
    var G0 = 1.2;              // s — pevná mezera mezi 1. a 2. pípnutím odpovědi; k ní B přičte ΔB
    var REPLY_DELAY = 0.18;    // s — o kolik dopředu se plánuje pípnutí (musí být v budoucnu, jinak hraje hned a čas neplatí)
    var THR_SIGMA = 7;         // práh detekce = násobek šumu na výstupu korelátoru
    var REFRACT_S = 0.06;      // s — po detekci se další nehlásí (dozvuk, odrazy)
    var EDGE_MS = 3;           // ms — jak daleko před nejsilnější špičkou hledat čelo (přímá cesta před odrazem)
    var OFFSET_DEF = 0.12;     // m — ½ (repro↔mikrofon A + repro↔mikrofon B)
    // Pásma: A (zahajuje) cvrliká NAHORU ve spodní polovině, B (odpovídá) DOLŮ v horní.
    // Různý směr NESTAČÍ — křížová korelace chirpů opačného sklonu je jen ~−14 dB a
    // rozmazaná přes celou délku chirpu (±30 ms), takže hlasité vlastní pípnutí
    // vyrábělo falešné „cizí" detekce. Oddělená pásma to srazí pod −30 dB.
    var BANDS = { std: { a: [5000, 8800], b: [9200, 13000], txt: '5–13 kHz' }, tichy: { a: [14500, 17000], b: [17300, 20000], txt: '14–20 kHz' } };
    var CAL_DIST = 2.0;        // m — kalibrace nuly na pásmem odměřenou délku

    // ---- pomocné ---------------------------------------------------------------------
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'akustika:' + kde); } catch (e2) { /* nic */ } }
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { swallow(e, 'agAlert'); } try { agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e) { swallow(e, 'agInfo'); } }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { swallow(e, 'toast'); } }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function byId(id) { return document.getElementById(id); }
    function fmt(v, d) { return (isFinite(v) ? v.toFixed(d == null ? 2 : d) : '–').replace('.', ','); }
    function lsGet(k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { swallow(e, 'lsSet'); } }
    function median(a) { var s = a.slice().sort(function (p, q) { return p - q; }); var n = s.length; if (!n) return NaN; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
    function mPerDeg(lat) {
        if (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) { try { var m = GeoCore.metersPerDeg(lat); if (m && m.lat) return m; } catch (e) { swallow(e, 'mPerDeg'); } }
        return { lat: 111320, lng: 111320 * Math.cos(lat * Math.PI / 180) };
    }
    function planarDist(aLat, aLng, bLat, bLng) { var m = mPerDeg((aLat + bLat) / 2); return Math.hypot((aLng - bLng) * m.lng, (aLat - bLat) * m.lat); }
    function points() { try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; } catch (e) { return []; } }
    function officialPts() {
        try { if (window.AGBodovePole && typeof AGBodovePole.points === 'function') return AGBodovePole.points().filter(function (p) { return p && p.cat !== 'NIVEL'; }); } catch (e) { swallow(e, 'officialPts'); }
        return [];
    }
    function allKnown() {
        var out = [];
        points().forEach(function (p) { if (isFinite(p.lat) && isFinite(p.lng)) out.push({ id: p.id, name: p.name, lat: p.lat, lng: p.lng }); });
        officialPts().forEach(function (p) { if (isFinite(p.lat) && isFinite(p.lng)) out.push({ id: 'of_' + (p.id || p.name), name: (p.name || '') + ' (úřední)', lat: p.lat, lng: p.lng }); });
        try {
            if (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null) {
                out.sort(function (a, b) { return planarDist(a.lat, a.lng, userLat, userLng) - planarDist(b.lat, b.lng, userLat, userLng); });
            }
        } catch (e) { swallow(e, 'allKnown'); }
        return out;
    }
    function settings() {
        var s = lsGet(LS_SET, {}) || {};
        return { pasmo: (s.pasmo === 'tichy' ? 'tichy' : 'std'), kola: ([1, 3, 5].indexOf(+s.kola) >= 0 ? +s.kola : 3), teplota: (isFinite(+s.teplota) ? +s.teplota : 15) };
    }
    function offset() { var v = lsGet(LS_OFF, null); return (isFinite(v) && v > -1 && v < 1) ? +v : OFFSET_DEF; }
    function speedOfSound(T) { return 331.3 * Math.sqrt(1 + T / 273.15); }
    // Teplota z Počasí, když ji modul zrovna zná (jinak poslední ručně zadaná).
    function teplotaZPocasi() {
        try {
            var w = window.AGPocasi;
            if (w && typeof w.aktualni === 'function') { var a = w.aktualni(); if (a && isFinite(a.temp)) return +a.temp; }
            if (w && isFinite(w.temp)) return +w.temp;
        } catch (e) { swallow(e, 'teplota'); }
        return null;
    }

    // ---- chirp + korelátor -------------------------------------------------------------
    // Lineární chirp f0→f1 s Tukeyho oknem (25 %), aby neměl ostré hrany (ty by
    // reproduktor rozmazal a korelace by dostala postranní laloky).
    function makeChirp(fs, f0, f1, dur) {
        var n = Math.round(fs * dur), out = new Float32Array(n), i, t, ph, w;
        var k = (f1 - f0) / dur, edge = Math.max(1, Math.floor(n * 0.125));
        for (i = 0; i < n; i++) {
            t = i / fs;
            ph = 2 * Math.PI * (f0 * t + 0.5 * k * t * t);
            w = 1;
            if (i < edge) w = 0.5 * (1 - Math.cos(Math.PI * i / edge));
            else if (i >= n - edge) w = 0.5 * (1 - Math.cos(Math.PI * (n - 1 - i) / edge));
            out[i] = Math.sin(ph) * w;
        }
        return out;
    }
    function normalize(a) { var e = 0, i; for (i = 0; i < a.length; i++) e += a[i] * a[i]; e = Math.sqrt(e) || 1; var o = new Float32Array(a.length); for (i = 0; i < a.length; i++) o[i] = a[i] / e; return o; }

    // Detektor: blok po bloku koreluje vstup se dvěma předlohami (↑ a ↓) a hlásí
    // {kind, idx, snr} — idx je GLOBÁLNÍ index vzorku, kde chirp ZAČÍNÁ (i se zlomkem).
    function Detector(fs, tplUp, tplDown) {
        this.fs = fs; this.up = normalize(tplUp); this.down = normalize(tplDown);
        this.N = this.up.length;
        this.tail = new Float32Array(this.N - 1);       // konec minulého bloku (chirp přes hranici)
        this.total = 0;                                 // vzorků přijato celkem
        this.sig = [0, 0];                              // odhad šumu na výstupu korelátoru (↑, ↓)
        this.prev = [null, null];                       // korelace minulého bloku (na čelo přes hranici)
        this.last = [-1e9, -1e9];                       // index poslední detekce (refrakterní doba)
        this.blocks = 0;
        this.pending = [];                              // kandidáti minulého bloku (rozhoduje se s odstupem jednoho bloku)
    }
    Detector.prototype.process = function (block) {
        var N = this.N, L = block.length, buf = new Float32Array(N - 1 + L), i, k, s, cu, cd;
        buf.set(this.tail, 0); buf.set(block, N - 1);
        var up = this.up, dn = this.down;
        var corrU = new Float32Array(L), corrD = new Float32Array(L);
        for (i = 0; i < L; i++) {
            cu = 0; cd = 0;
            for (k = 0; k < N; k++) { s = buf[i + k]; cu += s * up[k]; cd += s * dn[k]; }
            corrU[i] = cu; corrD[i] = cd;
        }
        var start = this.total - (N - 1);               // globální index odpovídající corr[0]
        var res = [], cand = [null, null], corrs = [corrU, corrD], t;
        for (t = 0; t < 2; t++) {
            var c = corrs[t], mx = -Infinity, mi = -1, mabs = 0;
            for (i = 0; i < L; i++) { var v = c[i]; if (v > mx) { mx = v; mi = i; } mabs += (v < 0 ? -v : v); }
            mabs /= L;
            var sigNow = mabs * 1.2533;                  // E|x| → σ pro gaussovský šum
            if (this.blocks < 3 || !this.sig[t]) this.sig[t] = this.sig[t] ? Math.min(this.sig[t], sigNow) : sigNow;
            var thr = THR_SIGMA * Math.max(this.sig[t], 1e-7);
            // první ~1 s (12 bloků) se jen učí šum — bez toho by první hlasitější
            // zvuk po zapnutí mikrofonu vypadal jako chirp
            if (this.blocks >= 12 && mx > thr && (start + mi - this.last[t]) > REFRACT_S * this.fs) cand[t] = { kind: t ? 'down' : 'up', i: mi, peak: mx, snr: mx / Math.max(this.sig[t], 1e-7), c: c };
            else this.sig[t] = this.sig[t] * 0.85 + sigNow * 0.15;   // jen bloky bez detekce učí šum
        }
        var cur = [];
        for (t = 0; t < 2; t++) {
            var d = cand[t]; if (!d) continue;
            // ČELO: přímá cesta je nejkratší, odraz může být silnější — vezmi nejdřívější
            // lokální maximum ≥ 50 % špičky do EDGE_MS před ní (i přes hranici bloku).
            var c2 = d.c, pv = this.prev[t], back = Math.round(EDGE_MS / 1000 * this.fs), half = d.peak * 0.5;
            var at = function (j) { return j >= 0 ? c2[j] : (pv ? pv[pv.length + j] : 0); };
            var best = d.i, j;
            for (j = d.i - 1; j >= d.i - back; j--) {
                if (at(j) >= half && at(j) >= at(j - 1) && at(j) >= at(j + 1)) best = j;
            }
            // parabola přes tři vzorky → zlomek vzorku
            var y0 = at(best - 1), y1 = at(best), y2 = at(best + 1), den = (y0 - 2 * y1 + y2), frac = den ? 0.5 * (y0 - y2) / den : 0;
            if (!(frac > -1 && frac < 1)) frac = 0;
            this.last[t] = start + best;
            cur.push({ kind: d.kind, t: t, idx: start + best + frac, snr: d.snr, peak: d.peak });
        }
        // ODSTUP JEDNOHO BLOKU: silný chirp jednoho druhu prosákne i do korelátoru
        // druhého (zbytková křížová korelace), a to až ±30 ms od skutečné špičky —
        // klidně v sousedním bloku. Kandidát se proto vydá až po zpracování dalšího
        // bloku, a jen když do ±(chirp + 12 ms) není ≥2× silnější kandidát druhého druhu.
        var all = this.pending.concat(cur), win = (CHIRP_S + 0.012) * this.fs;
        function slaby(d) { var j; for (j = 0; j < all.length; j++) { var o = all[j]; if (o !== d && o.t !== d.t && Math.abs(o.idx - d.idx) < win && o.peak >= 2 * d.peak) return true; } return false; }
        this.pending.forEach(function (d) { if (!slaby(d)) res.push({ kind: d.kind, idx: d.idx, snr: d.snr, peak: d.peak }); });
        this.pending = cur.filter(function (d) { return !slaby(d); });
        this.prev = [corrU, corrD];
        this.tail.set(buf.subarray(L));
        this.total += L;
        this.blocks++;
        return res;
    };

    // ---- audio -----------------------------------------------------------------------
    var _au = null;        // { ctx, stream, src, proc, gain, det, fs, bufUp, bufDown }
    var _onDetect = null;  // kam posílat detekce
    function makeBuffer(ctx, arr) { var b = ctx.createBuffer(1, arr.length, ctx.sampleRate), ch = b.getChannelData(0), i; for (i = 0; i < arr.length; i++) ch[i] = arr[i] * 0.95; return b; }
    function startAudio() {
        if (_au) return Promise.resolve(_au);
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('Prohlížeč neumí zvukový vstup (Web Audio / getUserMedia).'));
        var ctx;
        try { ctx = new AC({ sampleRate: 48000 }); } catch (e) { ctx = new AC(); }
        var resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
        return resume.then(function () {
            // BEZ potlačení ozvěny a šumu — jinak prohlížeč vlastní chirp z nahrávky
            // vymaže (to je přesně jeho práce) a bez vlastního pípnutí není co měřit.
            return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false });
        }).then(function (stream) {
            var fs = ctx.sampleRate, band = BANDS[settings().pasmo] || BANDS.std;
            var bf1 = Math.min(band.b[1], fs / 2 - 1500), bf0 = Math.min(band.b[0], bf1 - 2500);
            var up = makeChirp(fs, band.a[0], band.a[1], CHIRP_S), down = makeChirp(fs, bf1, bf0, CHIRP_S);
            var src = ctx.createMediaStreamSource(stream);
            var proc = ctx.createScriptProcessor(4096, 1, 1);
            var gain = ctx.createGain(); gain.gain.value = 0;   // procesor musí být zapojený do výstupu, ale mikrofon se nesmí ozývat
            var det = new Detector(fs, up, down);
            proc.onaudioprocess = function (e) {
                try {
                    var inp = e.inputBuffer.getChannelData(0);
                    var ev = det.process(inp);
                    if (ev.length && _onDetect) ev.forEach(_onDetect);
                } catch (err) { swallow(err, 'process'); }
            };
            src.connect(proc); proc.connect(gain); gain.connect(ctx.destination);
            _au = { ctx: ctx, stream: stream, src: src, proc: proc, gain: gain, det: det, fs: fs, bufUp: makeBuffer(ctx, up), bufDown: makeBuffer(ctx, down), band: band.txt };
            return _au;
        });
    }
    function stopAudio() {
        if (!_au) return;
        try { _au.proc.onaudioprocess = null; _au.src.disconnect(); _au.proc.disconnect(); _au.gain.disconnect(); } catch (e) { swallow(e, 'stopAudio'); }
        try { _au.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { swallow(e, 'stopAudio2'); }
        try { _au.ctx.close(); } catch (e) { swallow(e, 'stopAudio3'); }
        _au = null; _onDetect = null;
    }
    // Zahraj chirp v čase `when` (sekundy hodin AudioContextu). Vrací skutečně použitý čas.
    function play(kind, when) {
        var a = _au; if (!a) return null;
        var s = a.ctx.createBufferSource(); s.buffer = kind === 'up' ? a.bufUp : a.bufDown; s.connect(a.ctx.destination);
        var t = Math.max(when || 0, a.ctx.currentTime + 0.02);
        s.start(t);
        return t;
    }

    // ---- role: ODPOVÍDÁM (B) -------------------------------------------------------------
    var _role = null;           // 'A' | 'B' | null
    var _b = null;              // stav odpovídače
    var _wake = null;
    function lockScreen() { try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { _wake = w; }).catch(function () {}); } catch (e) { swallow(e, 'wake'); } }
    function unlockScreen() { try { if (_wake) { _wake.release(); _wake = null; } } catch (e) { swallow(e, 'unwake'); } }

    function startResponder() {
        _role = 'B';
        _b = { st: 'listen', n: 0, lastDb: null, guard: null, log: [] };
        _onDetect = function (d) {
            var a = _au, b = _b; if (!a || !b) return;
            if (b.st === 'listen') {
                if (d.kind !== 'up') return;
                b.idxA = d.idx; b.o1 = play('down', a.ctx.currentTime + REPLY_DELAY); b.st = 'r1';
                clearTimeout(b.guard); b.guard = setTimeout(function () { if (_b && _b.st !== 'listen') { _b.st = 'listen'; renderLive(); } }, 3500);
            } else if (b.st === 'r1') {
                if (d.kind !== 'down') return;
                var dB = (d.idx - b.idxA) / a.fs;
                if (dB < 0.02 || dB > 2.5) { b.st = 'listen'; return; }
                var o2 = b.o1 + G0 + dB;
                if (o2 - a.ctx.currentTime < 0.05) { b.st = 'listen'; b.log.push('pozdě'); return; }
                play('down', o2); b.o2 = o2; b.lastDb = dB; b.st = 'r2';
            } else if (b.st === 'r2') {
                if (d.kind !== 'down') return;
                b.n++; b.st = 'listen'; clearTimeout(b.guard);
                renderLive();
            }
        };
        lockScreen();
    }

    // ---- role: MĚŘÍM (A) -----------------------------------------------------------------
    var _a = null;              // stav měřiče
    var _results = [];          // kola aktuálního měření [{d, snr, dA, dB}]
    function startInitiator() { _role = 'A'; _a = { st: 'idle', round: 0, total: 0, guard: null }; lockScreen(); }
    function beginMeasure(rounds, onDone) {
        var a = _au; if (!a || !_a) return;
        _results = []; _a.round = 0; _a.total = rounds; _a.onDone = onDone; _a.fail = 0;
        nextRound();
    }
    function nextRound() {
        var a = _au, st = _a; if (!a || !st) return;
        if (st.round >= st.total) { st.st = 'idle'; if (st.onDone) st.onDone(_results); return; }
        st.round++; st.st = 'wait0'; st.idx0 = null; st.idx1 = null;
        renderLive();
        _onDetect = function (d) {
            var s = _a, au = _au; if (!s || !au) return;
            if (s.st === 'wait0') { if (d.kind !== 'up') return; s.idx0 = d.idx; s.st = 'wait1'; }
            else if (s.st === 'wait1') {
                if (d.kind !== 'down') return;
                var dA = (d.idx - s.idx0) / au.fs;
                if (dA < 0.03 || dA > 2.6) return;
                s.idx1 = d.idx; s.dA = dA; s.st = 'wait2';
            } else if (s.st === 'wait2') {
                if (d.kind !== 'down') return;
                var gap = (d.idx - s.idx1) / au.fs, dB = gap - G0;
                if (dB < 0.0 || dB > 2.6) return;
                clearTimeout(s.guard);
                var T = settings().teplota, c = speedOfSound(T);
                var D = c / 2 * (s.dA - dB) + offset();
                _results.push({ d: D, dA: s.dA, dB: dB, snr: d.snr, c: c });
                s.st = 'gap'; renderLive();
                setTimeout(nextRound, 700);
            }
        };
        clearTimeout(st.guard);
        st.guard = setTimeout(function () {
            var s = _a; if (!s || s.st === 'idle' || s.st === 'gap') return;
            s.fail++;
            _results.push({ d: NaN, chyba: (s.st === 'wait0' ? 'neslyším vlastní pípnutí (potlačení ozvěny?)' : s.st === 'wait1' ? 'bez odpovědi druhého telefonu' : 'chybí druhé pípnutí odpovědi') });
            renderLive();
            setTimeout(nextRound, 400);
        }, 4500);
        play('up', a.ctx.currentTime + 0.15);
    }

    function stopAll() {
        try { if (_a) clearTimeout(_a.guard); if (_b) clearTimeout(_b.guard); } catch (e) { swallow(e, 'stopAll'); }
        _a = null; _b = null; _role = null;
        stopAudio(); unlockScreen();
    }

    // ---- výsledky měření → délky ke známým bodům ----------------------------------------
    function delky() { var d = lsGet(LS_LEN, []); return Array.isArray(d) ? d : []; }
    function addDelka(rec) { var d = delky(); d.unshift(rec); lsSet(LS_LEN, d.slice(0, 30)); }
    function summary(res) {
        var ok = res.filter(function (r) { return isFinite(r.d); }).map(function (r) { return r.d; });
        if (!ok.length) return null;
        var med = median(ok), spread = Math.max.apply(null, ok) - Math.min.apply(null, ok);
        // nejistota: rozptyl kol (aspoň 2 cm) ⊕ 0,3 % délky (vítr, teplota)
        var u = Math.sqrt(Math.pow(Math.max(0.02, spread / 2), 2) + Math.pow(0.003 * med, 2));
        return { d: med, n: ok.length, spread: spread, u: u };
    }
    // Protínání z délek: dva známé body P1, P2 a délky d1, d2 → dva průsečíky kružnic.
    function protinani(p1, d1, p2, d2) {
        var m = mPerDeg((p1.lat + p2.lat) / 2);
        var x1 = 0, y1 = 0, x2 = (p2.lng - p1.lng) * m.lng, y2 = (p2.lat - p1.lat) * m.lat;
        var L = Math.hypot(x2, y2);
        if (L < 0.5) return { err: 'Body jsou příliš blízko u sebe.' };
        if (d1 + d2 < L) return { err: 'Délky se nesejdou: součet ' + fmt(d1 + d2) + ' m je kratší než vzdálenost bodů ' + fmt(L) + ' m.' };
        if (Math.abs(d1 - d2) > L) return { err: 'Délky se nesejdou: jedna kružnice leží celá uvnitř druhé.' };
        var a = (d1 * d1 - d2 * d2 + L * L) / (2 * L), h2 = d1 * d1 - a * a, h = Math.sqrt(Math.max(0, h2));
        var ux = x2 / L, uy = y2 / L, px = x1 + a * ux, py = y1 + a * uy;
        var s1 = { x: px - h * uy, y: py + h * ux }, s2 = { x: px + h * uy, y: py - h * ux };
        function toLL(s) { return { lat: p1.lat + s.y / m.lat, lng: p1.lng + s.x / m.lng }; }
        // úhel protnutí — u ostrého/tupého úhlu se chyba délek zvětšuje
        var cosg = (d1 * d1 + d2 * d2 - L * L) / (2 * d1 * d2), gamma = Math.acos(Math.max(-1, Math.min(1, cosg))) * 180 / Math.PI;
        return { a: toLL(s1), b: toLL(s2), h: h, gamma: gamma };
    }

    // ---- UI ----------------------------------------------------------------------------
    var _view = 'home';   // home | A | B | delky | kal
    var _calMode = false;
    function css() {
        if (!window.AG || !AG.style) return;
        AG.style('ag-aku-style', [
            '#ag-aku-modal .modal-content{max-width:520px;}',
            '.aku-p{font-size:calc(12.5px * var(--ag-font-scale,1));opacity:.85;margin:0 0 10px;line-height:1.45;}',
            '.aku-card{border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px 12px;margin:8px 0;background:rgba(255,255,255,.04);font-size:calc(13px * var(--ag-font-scale,1));}',
            '.aku-card.amber{border-color:rgba(251,191,36,.45);background:rgba(251,191,36,.08);}',
            '.aku-card.green{border-color:rgba(74,222,128,.45);background:rgba(74,222,128,.08);}',
            '.aku-big{font-size:calc(34px * var(--ag-font-scale,1));font-weight:700;text-align:center;font-variant-numeric:tabular-nums;margin:6px 0;}',
            '.aku-sub{font-size:calc(12px * var(--ag-font-scale,1));opacity:.7;text-align:center;}',
            '.aku-row{display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap;}',
            '.aku-row label{font-size:calc(12px * var(--ag-font-scale,1));opacity:.8;min-width:110px;}',
            '.aku-row input,.aku-row select{flex:1;min-width:90px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:inherit;font-size:calc(14px * var(--ag-font-scale,1));}',
            '.aku-list{list-style:none;margin:6px 0;padding:0;font-size:calc(13px * var(--ag-font-scale,1));}',
            '.aku-list li{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08);align-items:center;}',
            '.aku-list li .bad{color:var(--danger,#fb7185);}',
            '.aku-how{margin:0 0 10px;font-size:calc(12.5px * var(--ag-font-scale,1));}',
            '.aku-how summary{cursor:pointer;color:var(--accent);font-weight:600;padding:6px 0;}',
            '.aku-how ol{padding-left:18px;margin:6px 0;}',
            '.aku-how li{margin:4px 0;line-height:1.4;}',
            '.aku-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}',
            '.aku-btns .btn{flex:1;min-width:140px;margin:0;}',
            '.aku-btns.col{flex-direction:column;}',
            '#ag-aku-modal .btn:disabled{opacity:.45;}',
            '.aku-btns.col .btn{min-width:100%;}',
            '.aku-pulse{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent);margin-right:6px;animation:akuPulse 1.2s infinite;}',
            '@keyframes akuPulse{0%{opacity:.3}50%{opacity:1}100%{opacity:.3}}'
        ].join('\n'));
    }
    function ensureModal() {
        if (byId(DLG_ID)) return;
        css();
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = DLG_ID; el.setAttribute('data-ag-needs', 'gps');
        el.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent); margin-top:0; margin-bottom:5px;">' + ICON + ' Akustický dálkoměr</h3>'
            + '<div class="modal-body" id="ag-aku-body"></div>'
            + '<button class="btn btn-secondary" style="margin-top:15px;" id="ag-aku-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        function close() { stopAll(); _view = 'home'; el.style.display = 'none'; }
        el.querySelector('#ag-aku-close').addEventListener('click', close);
        el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
        window.addEventListener('pagehide', stopAll);
    }
    function open() { ensureModal(); byId(DLG_ID).style.display = 'flex'; _view = 'home'; render(); }

    function howTo() {
        return '<details class="aku-how"><summary>Jak to funguje a proč to měří na centimetry</summary>'
            + '<p class="aku-p">Zvuk letí 343 m/s. Telefon nahrává 48 000 vzorků za sekundu, jeden vzorek je tedy <b>7 mm</b> cesty zvuku. Oba telefony si vymění krátké „cvrliknutí" a každý si ve <b>vlastní nahrávce</b> najde, kdy cvrlikl on a kdy druhý — na jeden vzorek přesně. Rozdíl hodin telefonů se odečte sám, protože každý měří jen své vlastní intervaly. Druhý telefon svůj naměřený interval „řekne" tomu prvnímu mezerou mezi dvěma pípnutími, takže není potřeba internet ani nic opisovat.</p>'
            + '<ol>'
            + '<li><b>Telefon B</b> polož <b>spodní hranou na známý bod</b> (kolík, hřeb, mezník) a zapni <b>Stojím na známém bodě</b>. Jen poslouchá a odpovídá.</li>'
            + '<li><b>Telefon A</b> drž spodní hranou nad měřeným místem, zapni <b>Měřím</b> a klepni <b>Změřit</b>. Uslyšíš pípnutí a dvě odpovědi, za pár vteřin je délka.</li>'
            + '<li>Délku ulož <b>ke známému bodu</b>. Přenes B na druhý známý bod, změř znovu → <b>Bod ze dvou délek</b> spočítá polohu bez GPS.</li>'
            + '</ol>'
            + '<p class="aku-p">Mikrofony a reproduktory mají oba telefony u <b>spodní hrany</b> — ta je „měřicí značka". Poprvé udělej <b>kalibraci nuly</b>: telefony přesně 2,00 m od sebe podle pásma. Nejlíp funguje do ~40 m na volném prostranství; vítr proti měření ubírá a hluk stroje v pásmu chirpu ho zkrátí. Zadej teplotu vzduchu — 10 °C rozdílu je 2 % délky.</p>'
            + '</details>';
    }

    function render() {
        var body = byId('ag-aku-body'); if (!body) return;
        if (_view === 'A') return renderA(body);
        if (_view === 'B') return renderB(body);
        if (_view === 'delky') return renderDelky(body);
        var s = settings();
        var tp = teplotaZPocasi();
        body.innerHTML = howTo()
            + '<p class="aku-p">Dva telefony, žádný další hardware. Ten na <b>známém bodě</b> odpovídá, ten druhý měří. Přesnost ±2–5 cm do ~40 m.</p>'
            + '<div class="aku-btns col">'
            + '<button class="btn btn-primary" id="ag-aku-go-a"><svg class="icon"><use href="#i-crosshair"/></svg> Měřím (tento telefon)</button>'
            + '<button class="btn btn-secondary" id="ag-aku-go-b"><svg class="icon"><use href="#i-map-pin"/></svg> Stojím na známém bodě</button>'
            + '</div>'
            + '<div class="aku-card" style="margin-top:12px;">'
            + '<div class="aku-row"><label>Teplota vzduchu</label><input id="ag-aku-t" type="text" inputmode="decimal" value="' + fmt(tp != null ? tp : s.teplota, 0) + '"><span style="opacity:.7">°C' + (tp != null ? ' · z Počasí' : '') + '</span></div>'
            + '<div class="aku-row"><label>Zvuk</label><select id="ag-aku-band"><option value="std"' + (s.pasmo === 'std' ? ' selected' : '') + '>slyšitelný cvrlik 5–13 kHz (spolehlivější)</option><option value="tichy"' + (s.pasmo === 'tichy' ? ' selected' : '') + '>skoro neslyšný 14–20 kHz</option></select></div>'
            + '<div class="aku-row"><label>Kol na měření</label><select id="ag-aku-rounds"><option' + (s.kola === 1 ? ' selected' : '') + '>1</option><option' + (s.kola === 3 ? ' selected' : '') + '>3</option><option' + (s.kola === 5 ? ' selected' : '') + '>5</option></select></div>'
            + '<div class="aku-row"><label>Oprava nuly</label><span>' + fmt(offset()) + ' m' + (lsGet(LS_OFF, null) == null ? ' (výchozí, nekalibrováno)' : ' (kalibrováno)') + '</span></div>'
            + '</div>'
            + '<div class="aku-btns">'
            + '<button class="btn btn-secondary" id="ag-aku-delky"><svg class="icon"><use href="#i-ruler"/></svg> Délky ke známým bodům (' + delky().length + ')</button>'
            + '<button class="btn btn-secondary" id="ag-aku-kal"><svg class="icon"><use href="#i-sliders"/></svg> Kalibrace nuly (2,00 m)</button>'
            + '</div>';
        function saveSet() {
            var t = parseFloat(String(byId('ag-aku-t').value).replace(',', '.'));
            lsSet(LS_SET, { pasmo: byId('ag-aku-band').value, kola: +byId('ag-aku-rounds').value, teplota: isFinite(t) ? Math.max(-30, Math.min(45, t)) : s.teplota });
        }
        ['ag-aku-t', 'ag-aku-band', 'ag-aku-rounds'].forEach(function (id) { byId(id).addEventListener('change', saveSet); });
        byId('ag-aku-go-a').addEventListener('click', function () { saveSet(); _calMode = false; enterRole('A'); });
        byId('ag-aku-go-b').addEventListener('click', function () { saveSet(); enterRole('B'); });
        byId('ag-aku-delky').addEventListener('click', function () { _view = 'delky'; render(); });
        byId('ag-aku-kal').addEventListener('click', function () {
            saveSet(); _calMode = true; enterRole('A');
        });
    }
    function enterRole(role) {
        var body = byId('ag-aku-body');
        body.innerHTML = '<p class="aku-p"><span class="aku-pulse"></span>Zapínám mikrofon…</p>';
        startAudio().then(function () {
            if (role === 'B') startResponder(); else startInitiator();
            _view = role; render();
        }).catch(function (e) {
            _view = 'home'; render();
            agAlert('Mikrofon', 'Nepodařilo se zapnout zvuk: ' + esc(e && e.message || e) + '<br><br>Povol aplikaci mikrofon (Nastavení telefonu → Safari/Chrome → Mikrofon).');
        });
    }
    function renderB(body) {
        body.innerHTML = '<div class="aku-card green"><span class="aku-pulse"></span><b>Poslouchám a odpovídám.</b> Polož telefon spodní hranou na známý bod a nech ho být. Druhý telefon měří.</div>'
            + '<div class="aku-big" id="ag-aku-bn">0</div><div class="aku-sub" id="ag-aku-bsub">odpovědí</div>'
            + '<p class="aku-p" style="margin-top:12px;">Zvuk: ' + (_au ? _au.band + ' · ' + _au.fs + ' Hz' : '') + '. Nezakrývej spodní hranu telefonu (mikrofon i reproduktor).</p>'
            + '<button class="btn" id="ag-aku-bstop"><svg class="icon"><use href="#i-stop"/></svg> Přestat odpovídat</button>';
        byId('ag-aku-bstop').addEventListener('click', function () { stopAll(); _view = 'home'; render(); });
        renderLive();
    }
    function renderA(body) {
        var s = settings();
        body.innerHTML = (_calMode
            ? '<div class="aku-card amber"><b>Kalibrace nuly:</b> polož oba telefony spodními hranami proti sobě přesně <b>' + fmt(CAL_DIST) + ' m</b> od sebe podle pásma. Druhý telefon musí mít zapnuté <b>Stojím na známém bodě</b>.</div>'
            : '<div class="aku-card"><span class="aku-pulse"></span>Mikrofon běží. Druhý telefon musí mít zapnuté <b>Stojím na známém bodě</b>. Spodní hranu drž nad měřeným místem, telefony ať na sebe „vidí".</div>')
            + '<div class="aku-big" id="ag-aku-d">–</div><div class="aku-sub" id="ag-aku-dsub">klepni Změřit</div>'
            + '<ul class="aku-list" id="ag-aku-rounds-list"></ul>'
            + '<div class="aku-btns">'
            + '<button class="btn btn-primary" id="ag-aku-measure"><svg class="icon"><use href="#i-sound"/></svg> Změřit (' + s.kola + '×)</button>'
            + (_calMode ? '<button class="btn btn-secondary" id="ag-aku-cal-save" disabled><svg class="icon"><use href="#i-check"/></svg> Uložit opravu nuly</button>' : '<button class="btn btn-secondary" id="ag-aku-save" disabled>✓ Uložit délku ke známému bodu</button>')
            + '</div>'
            + '<button class="btn btn-secondary" id="ag-aku-astop" style="margin-top:8px;">← Zpět (vypnout mikrofon)</button>';
        byId('ag-aku-astop').addEventListener('click', function () { stopAll(); _view = 'home'; render(); });
        byId('ag-aku-measure').addEventListener('click', function () {
            var btn = byId('ag-aku-measure'); btn.disabled = true;
            beginMeasure(s.kola, function () {
                btn.disabled = false;
                var sm = summary(_results);
                var sv = byId(_calMode ? 'ag-aku-cal-save' : 'ag-aku-save'); if (sv) sv.disabled = !sm;
                renderLive();
            });
        });
        var sv = byId('ag-aku-save');
        if (sv) sv.addEventListener('click', saveLength);
        var cs = byId('ag-aku-cal-save');
        if (cs) cs.addEventListener('click', function () {
            var sm = summary(_results); if (!sm) return;
            var newOff = offset() + (CAL_DIST - sm.d);
            if (Math.abs(newOff) > 0.6) { agAlert('Kalibrace', 'Vyšla nesmyslná oprava ' + fmt(newOff) + ' m — telefony nejsou 2,00 m od sebe, nebo měření nesedí. Zkus znovu.'); return; }
            lsSet(LS_OFF, Math.round(newOff * 1000) / 1000);
            agAlert('Kalibrace hotová', 'Oprava nuly: <b>' + fmt(newOff) + ' m</b> (naměřeno ' + fmt(sm.d) + ' m, má být ' + fmt(CAL_DIST) + ' m). Platí pro tuhle dvojici telefonů v tomhle držení.');
            stopAll(); _calMode = false; _view = 'home'; render();
        });
        renderLive();
    }
    function renderLive() {
        if (_role === 'B' && _b) { var n = byId('ag-aku-bn'); if (n) n.textContent = String(_b.n); var bs = byId('ag-aku-bsub'); if (bs) bs.textContent = (_b.st === 'listen' ? 'odpovědí · poslouchám' : 'odpovědí · odpovídám…') + (_b.lastDb != null ? ' · reakce ' + Math.round(_b.lastDb * 1000) + ' ms' : ''); return; }
        if (_role !== 'A' || !_a) return;
        var big = byId('ag-aku-d'), sub = byId('ag-aku-dsub'), list = byId('ag-aku-rounds-list');
        if (!big) return;
        var sm = summary(_results);
        if (sm) { big.textContent = fmt(sm.d) + ' m'; sub.textContent = sm.n + ' z ' + _results.length + ' kol · rozptyl ' + Math.round(sm.spread * 100) + ' cm · odhad ±' + Math.round(sm.u * 100) + ' cm'; }
        else if (_a.st !== 'idle') { big.textContent = '…'; sub.innerHTML = '<span class="aku-pulse"></span>kolo ' + _a.round + '/' + _a.total + ' · ' + ({ wait0: 'pípám', wait1: 'čekám na odpověď', wait2: 'čekám na druhé pípnutí', gap: 'mezera' }[_a.st] || ''); }
        else if (_results.length) { big.textContent = '–'; sub.textContent = 'žádné kolo se nepovedlo'; }
        if (list) list.innerHTML = _results.map(function (r, i) {
            return '<li><span>kolo ' + (i + 1) + '</span>' + (isFinite(r.d)
                ? '<span><b>' + fmt(r.d) + ' m</b> <span style="opacity:.6">· S/N ' + Math.round(r.snr) + ' · reakce B ' + Math.round(r.dB * 1000) + ' ms</span></span>'
                : '<span class="bad">' + esc(r.chyba || 'chyba') + '</span>') + '</li>';
        }).join('');
    }
    function saveLength() {
        var sm = summary(_results); if (!sm) return;
        var kn = allKnown();
        var opts = kn.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
        var body = byId('ag-aku-body');
        body.innerHTML = '<p class="aku-p"><b>' + fmt(sm.d) + ' m</b> (±' + Math.round(sm.u * 100) + ' cm). Na kterém <b>známém bodě</b> stojí druhý telefon?</p>'
            + (kn.length ? '<div class="aku-row"><label>Známý bod</label><select id="ag-aku-kp">' + opts + '</select></div>' : '<p class="aku-p" style="color:var(--warning,#fbbf24)">V zakázce nejsou žádné body — délka se uloží jen s popisem.</p>')
            + '<div class="aku-row"><label>Poznámka</label><input id="ag-aku-note" type="text" placeholder="např. roh garáže, měřený bod 12"></div>'
            + '<div class="aku-btns"><button class="btn btn-primary" id="ag-aku-len-ok"><svg class="icon"><use href="#i-check"/></svg> Uložit délku</button><button class="btn btn-secondary" id="ag-aku-len-back">← Zpět</button></div>';
        byId('ag-aku-len-back').addEventListener('click', function () { render(); });
        byId('ag-aku-len-ok').addEventListener('click', function () {
            var sel = byId('ag-aku-kp'), p = null;
            if (sel) { var id = sel.value; kn.forEach(function (q) { if (q.id === id) p = q; }); }
            addDelka({ t: Date.now(), d: Math.round(sm.d * 1000) / 1000, u: Math.round(sm.u * 1000) / 1000, n: sm.n, pt: p ? { id: p.id, name: p.name, lat: p.lat, lng: p.lng } : null, note: (byId('ag-aku-note').value || '').trim() });
            toast('Délka ' + fmt(sm.d) + ' m uložena' + (p ? ' k bodu ' + p.name : '') + '.');
            _results = []; render();
        });
    }
    function renderDelky(body) {
        var d = delky();
        body.innerHTML = '<p class="aku-p">Uložené délky ke známým bodům. Vyber <b>dvě</b> k různým bodům a spočítej z nich nový bod (protínání z délek).</p>'
            + (d.length ? '<ul class="aku-list">' + d.map(function (r, i) {
                var when = new Date(r.t); var hh = ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2);
                return '<li><label style="display:flex;gap:8px;align-items:center;flex:1;cursor:pointer;"><input type="checkbox" class="ag-aku-ck" data-i="' + i + '"' + (r.pt ? '' : ' disabled') + '><span><b>' + fmt(r.d) + ' m</b> → ' + (r.pt ? esc(r.pt.name) : '<i>bez bodu</i>') + (r.note ? ' · ' + esc(r.note) : '') + '<br><span style="opacity:.6;font-size:.9em">' + when.getDate() + '. ' + (when.getMonth() + 1) + '. ' + hh + ' · ±' + Math.round((r.u || 0) * 100) + ' cm · ' + r.n + ' kol</span></span></label><button class="btn btn-secondary ag-aku-del" data-i="' + i + '" style="padding:4px 8px;margin:0;width:auto;">✕</button></li>';
            }).join('') + '</ul>' : '<p class="aku-p"><i>Zatím žádná.</i></p>')
            + '<div class="aku-btns"><button class="btn btn-primary" id="ag-aku-prot" disabled><svg class="icon"><use href="#i-line"/></svg> Bod ze dvou délek</button><button class="btn btn-secondary" id="ag-aku-back">← Zpět</button></div>'
            + '<div id="ag-aku-prot-out"></div>';
        byId('ag-aku-back').addEventListener('click', function () { _view = 'home'; render(); });
        var cks = Array.prototype.slice.call(body.querySelectorAll('.ag-aku-ck'));
        function sel() { return cks.filter(function (c) { return c.checked; }).map(function (c) { return d[+c.getAttribute('data-i')]; }); }
        cks.forEach(function (c) { c.addEventListener('change', function () { var s = sel(); byId('ag-aku-prot').disabled = !(s.length === 2 && s[0].pt && s[1].pt && s[0].pt.id !== s[1].pt.id); }); });
        Array.prototype.forEach.call(body.querySelectorAll('.ag-aku-del'), function (b) { b.addEventListener('click', function () { var i = +b.getAttribute('data-i'); var arr = delky(); arr.splice(i, 1); lsSet(LS_LEN, arr); render(); }); });
        byId('ag-aku-prot').addEventListener('click', function () {
            var s = sel(); if (s.length !== 2) return;
            var r = protinani(s[0].pt, s[0].d, s[1].pt, s[1].d), out = byId('ag-aku-prot-out');
            if (r.err) { out.innerHTML = '<div class="aku-card amber">' + esc(r.err) + '</div>'; return; }
            // který ze dvou průsečíků? napřed podle GPS (stojím u něj), jinak nabídni oba
            var near = null;
            try { if (typeof userLat !== 'undefined' && userLat != null) { var da = planarDist(r.a.lat, r.a.lng, userLat, userLng), db = planarDist(r.b.lat, r.b.lng, userLat, userLng); near = da <= db ? 'a' : 'b'; } } catch (e) { swallow(e, 'near'); }
            var u = Math.sqrt(Math.pow(s[0].u || 0.03, 2) + Math.pow(s[1].u || 0.03, 2)) / Math.max(0.2, Math.sin(r.gamma * Math.PI / 180));
            function sj(ll) { try { if (window.GeoCore && GeoCore.toMistni) { var q = GeoCore.toMistni(ll.lat, ll.lng); return 'Y ' + q.y.toFixed(2) + '  X ' + q.x.toFixed(2); } } catch (e) { swallow(e, 'sj'); } return ll.lat.toFixed(6) + ', ' + ll.lng.toFixed(6); }
            // Známé body z Přesné GPS (ne úřední/importované): tvar a délky vyjdou na cm,
            // ale poloha CELKU zdědí jejich chybu — řetězec „chůze po hraně → Přesná GPS →
            // akustika" (uživatel 15. 9. 2026) to má říkat nahlas, ne schovat do ±3 cm.
            var zded = 0;
            [s[0].pt, s[1].pt].forEach(function (pt) { var o = pt && pt.prov && pt.prov.origin; var a = (pt && pt.acc != null && isFinite(pt.acc)) ? pt.acc : ((o === 'gps-avg' || o === 'ruc') ? 1.0 : 0); if (o === 'gps-avg' || o === 'ruc') zded = Math.max(zded, a); });
            out.innerHTML = '<div class="aku-card green"><b>Protínání z délek</b> · úhel protnutí ' + Math.round(r.gamma) + '° · odhad ±' + Math.round(u * 100) + ' cm'
                + (r.gamma < 30 || r.gamma > 150 ? '<br><span style="color:var(--warning,#fbbf24)">Úhel je moc ostrý/tupý — přesnost klesá. Druhý známý bod vyber víc stranou.</span>' : '')
                + (zded ? '<br><span style="opacity:.85">Známé body jsou z GPS (±' + fmt(zded) + ' m): <b>tvar a délky</b> vůči nim jsou na centimetry, <b>poloha celku</b> zdědí jejich ±' + fmt(zded) + ' m.</span>' : '') + '</div>'
                + '<p class="aku-p">Dva možné průsečíky — vyber ten, u kterého stojíš' + (near ? ' (podle GPS spíš ' + (near === 'a' ? 'první' : 'druhý') + ')' : '') + ':</p>'
                + '<div class="aku-row"><input id="ag-aku-pname" type="text" placeholder="Název nového bodu"></div>'
                + '<div class="aku-btns"><button class="btn' + (near === 'b' ? ' btn-secondary' : '') + '" data-s="a">1: ' + sj(r.a) + '</button><button class="btn' + (near === 'a' ? ' btn-secondary' : '') + '" data-s="b">2: ' + sj(r.b) + '</button></div>';
            Array.prototype.forEach.call(out.querySelectorAll('button[data-s]'), function (b) {
                b.addEventListener('click', function () {
                    var ll = r[b.getAttribute('data-s')];
                    if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Funkce pro vkládání bodů není dostupná.'); return; }
                    var name = (byId('ag-aku-pname').value || '').trim() || ('AKU' + Date.now().toString().slice(-4));
                    var added = window.addImportedPoints([{ name: name, lat: ll.lat, lng: ll.lng, origin: 'akustika', acc: Math.round(u * 100) / 100,
                        prov: { origin: 'akustika', ts: Date.now(), acc: Math.round(u * 100) / 100, delky: [{ pt: s[0].pt.name, d: s[0].d }, { pt: s[1].pt.name, d: s[1].d }], gamma: Math.round(r.gamma) } }]);
                    if (added > 0) { agAlert('Bod uložen', '#' + esc(name) + ' z délek ' + fmt(s[0].d) + ' m (' + esc(s[0].pt.name) + ') a ' + fmt(s[1].d) + ' m (' + esc(s[1].pt.name) + '), ±' + Math.round(u * 100) + ' cm.'); byId(DLG_ID).style.display = 'none'; }
                    else agAlert('Neuloženo', 'Bod se stejným názvem a polohou už v zakázce je.');
                });
            });
        });
    }

    // ---- registrace ----------------------------------------------------------------------
    window.AGAkustika = { open: open, _test: { makeChirp: makeChirp, Detector: Detector, protinani: protinani, speedOfSound: speedOfSound, summary: summary, G0: G0, CHIRP_S: CHIRP_S, BANDS: BANDS } };
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'akusticky-dalkomer', label: 'Akustický dálkoměr', icon: ICON, cat: 'Měření', onClick: open, order: 6 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
