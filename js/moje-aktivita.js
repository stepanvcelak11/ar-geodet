// ===== AR Geodet — MOJE AKTIVITA (ODPOJITELNÁ vrstva) ==========================
// Vlastní statistika práce v terénu — pro zájem, pro pocit z odvedeného dne
// a hlavně jako PODKLAD PRO ÚKLID: appka má přes 60 nástrojů a nikdo nepoužívá
// všechny. Když člověk černé na bílém vidí, že do dvou z nich za měsíc nešáhl,
// může si je jedním ťuknutím schovat z Nástrojů.
//
// CO SE MĚŘÍ (vše jen v tomto telefonu, nikam se to neposílá):
//   • čas v appce (jen když je na obrazovce — na pozadí se čas nepočítá),
//   • ušlá vzdálenost a nastoupané/naklesané výškové metry z GPS fixů, které
//     appka STEJNĚ dostává (window.AGFix) — NEZAKLÁDÁ se druhý GPS watch,
//   • kroky: normálně odhad z ušlé vzdálenosti podle délky kroku z Krokového
//     offsetu (agPdrStepLen_v1), volitelně poctivý krokoměr z akcelerometru,
//   • nové/upravené/smazané body (událost 'agjournal:commit' ze js/journal.js),
//   • který nástroj kolikrát a jak dlouho — klepnutí na dlaždici v Nástrojích.
//
// PROČ TAK HRUBĚ: cílem není měřicí protokol, ale přehled. GPS z mobilu dává
// výšku s chybou v metrech, takže se výškové metry berou z vyhlazené výšky
// s prahem UP_MIN — bez toho by „nastoupáno" rostlo i vsedě v autě. Vzdálenost
// se nesčítá při rychlosti nad V_MAX (jízda autem není chůze).
//
// SKRÝVÁNÍ NÁSTROJŮ: klíče v agAktHidden_v1. Dlaždice se schová (display:none
// + data-ag-hidden), NIC se nemaže — při hledání v Nástrojích se ukáže dál
// a v seznamu úkonů ji vynechá js/nastroje-ukony.js (kontroluje data-ag-hidden).
// Vrátit se dá kdykoli v „Moje aktivita → Skryté nástroje".
//
// Odstranění: smaž js/moje-aktivita.js + řádek <script> v index.html (a přegeneruj
// sw.js: python scripts/gen_sw_assets.py --bump). Nasbíraná data zůstanou
// v localStorage (agAkt_v1) a nikomu nevadí.
// ================================================================================
(function () {
    'use strict';
    if (window.AGAkt) return;

    var LS = 'agAkt_v1';                 // { v:1, days:{ 'RRRR-MM-DD': DEN } }
    var LS_ON = 'agAktOn';               // '0' = neměřit vůbec
    var LS_SENS = 'agAktStepSensor';     // '1' = kroky z akcelerometru
    var LS_HIDDEN = 'agAktHidden_v1';    // ['brutal-gps', …] schované dlaždice
    var LS_LABELS = 'agAktLabels_v1';    // klíč -> popisek (ať umím pojmenovat i nenaložený nástroj)
    var LS_STEPLEN = 'agPdrStepLen_v1';  // délka kroku — sdílená s js/pdr-offset.js
    var LS_BF_AUTO = 'agBrifinkAuto';    // přepínač brífinku — sdílený s js/brifink.js

    var KEEP_DAYS = 120;                 // starší dny se tiše zahodí (localStorage není archiv)
    var TICK_MS = 1500;
    var SAVE_MS = 15000;                 // zápis do localStorage nejvýš takhle často
    var ACC_MAX = 25;                    // horší fix než tohle se do vzdálenosti nepočítá
    var D_MIN = 3;                       // menší posun = šum GPS, ne chůze (m)
    var V_MAX = 3.5;                     // nad tuhle rychlost to není chůze (m/s)
    var ALT_ACC_MAX = 20;                // výškové metry jen z rozumného fixu
    var UP_MIN = 3;                      // schod ve vyhlazené výšce, který se počítá (m)
    var TOOL_CAP_MS = 20 * 60000;        // strop jednoho „sezení" u nástroje
    var IDLE_END_MS = 3 * 60000;         // 3 min bez doteku = u nástroje už nejsem
    var STEP_THR = 1.15;                 // m/s² nad klouzavý průměr = krok (jako pdr-offset)
    var STEP_MIN_MS = 350;
    var STEP_DEF = 0.72;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><rect x="5" y="12" width="3.4" height="8" rx="1"/><rect x="10.3" y="7" width="3.4" height="13" rx="1"/><rect x="15.6" y="3.5" width="3.4" height="16.5" rx="1"/></svg>';
    var MODAL_ID = 'ag-akt-modal';
    var STYLE_ID = 'ag-akt-style';

    // ---- pomocné ---------------------------------------------------------------
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function dayKey(ts) { var d = new Date(ts == null ? Date.now() : ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    var DAYS_CS = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
    function fmtDayShort(key) {
        var p = String(key).split('-');
        var d = new Date(+p[0], +p[1] - 1, +p[2]);
        return DAYS_CS[d.getDay()] + ' ' + d.getDate() + '. ' + (+p[1]) + '.';
    }
    function num(v, dec) {
        var n = (typeof v === 'number' && isFinite(v)) ? v : 0;
        return n.toFixed(dec || 0).replace('.', ',');
    }
    function fmtMs(ms) {
        var m = Math.round((ms || 0) / 60000);
        if (m < 60) return m + ' min';
        return Math.floor(m / 60) + ' h ' + pad2(m % 60) + ' min';
    }
    // 1 bod / 2–4 body / 5+ bodů — bez toho by v přehledu svítilo „3 bodů"
    function plBod(n) { return n === 1 ? 'bod' : (n >= 2 && n <= 4 ? 'body' : 'bodů'); }
    function fmtDist(m) {
        if (!m || m < 950) return num(m, 0) + ' m';
        return num(m / 1000, 1) + ' km';
    }
    function on() { try { return localStorage.getItem(LS_ON) !== '0'; } catch (e) { return true; } }
    function sensorOn() { try { return localStorage.getItem(LS_SENS) === '1'; } catch (e) { return false; } }
    function stepLen() {
        try { var v = parseFloat(localStorage.getItem(LS_STEPLEN)); if (isFinite(v) && v >= 0.4 && v <= 1.2) return v; } catch (e) {}
        return STEP_DEF;
    }
    function visible() { return document.visibilityState !== 'hidden'; }
    function started() { return !!(document.body && document.body.classList.contains('app-started')); }

    // ---- úložiště -------------------------------------------------------------
    var _db = null, _dirty = false, _lastSave = 0;
    function db() {
        if (_db) return _db;
        var o = null;
        try { o = JSON.parse(localStorage.getItem(LS)); } catch (e) {}
        if (!o || typeof o !== 'object' || !o.days || typeof o.days !== 'object') o = { v: 1, days: {} };
        _db = o;
        return _db;
    }
    function newDay() { return { ms: 0, dist: 0, up: 0, down: 0, steps: 0, pts: { a: 0, e: 0, d: 0 }, tools: {}, f: Date.now(), l: Date.now() }; }
    function day(key) {
        var d = db().days;
        var k = key || dayKey();
        if (!d[k]) { d[k] = newDay(); _dirty = true; }
        // starší verze záznamu (kdyby se schéma měnilo) doplň o chybějící pole
        var r = d[k];
        if (!r.pts) r.pts = { a: 0, e: 0, d: 0 };
        if (!r.tools) r.tools = {};
        return r;
    }
    function prune() {
        var d = db().days, keys = Object.keys(d);
        if (keys.length <= KEEP_DAYS) return;
        keys.sort();
        while (keys.length > KEEP_DAYS) { delete d[keys.shift()]; _dirty = true; }
    }
    function save(force) {
        if (!_dirty) return;
        var now = Date.now();
        if (!force && now - _lastSave < SAVE_MS) return;
        _lastSave = now;
        // _dirty se shazuje AŽ po úspěšném setItem — když je úložiště plné, zápis
        // spadne, catch výjimku spolkne a nasbíraný den by se tvářil jako uložený
        try { prune(); localStorage.setItem(LS, JSON.stringify(db())); _dirty = false; } catch (e) {}
    }
    function sortedKeys() { return Object.keys(db().days).sort(); }
    function lastKeys(n) { var k = sortedKeys(); return k.slice(Math.max(0, k.length - n)); }

    // popisky nástrojů si pamatujeme, ať jde pojmenovat i nástroj, který zrovna
    // není v mřížce (odpojený modul, jiná role, lazy-load ještě nedoběhl)
    function labels() {
        try { var o = JSON.parse(localStorage.getItem(LS_LABELS)); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
    }
    function rememberLabel(key, label) {
        if (!key || !label) return;
        var l = labels();
        if (l[key] === label) return;
        l[key] = label;
        try { localStorage.setItem(LS_LABELS, JSON.stringify(l)); } catch (e) {}
    }

    // ---- sběr: body ze žurnálu -------------------------------------------------
    window.addEventListener('agjournal:commit', function (e) {
        if (!on()) return;
        try {
            var op = String((e.detail && e.detail.op) || '');
            var d = day();
            if (op.indexOf('add') === 0 || op === 'restore') d.pts.a++;
            else if (op === 'edit') d.pts.e++;
            else if (op === 'delete') d.pts.d++;
            else return;
            d.l = Date.now();
            _dirty = true;
        } catch (err) {}
    });

    // ---- sběr: nástroje --------------------------------------------------------
    // Klíč dlaždice — STEJNÁ logika jako field-tools.js / tools-hub.js / tools-plus.js,
    // jinak by se počítadla rozešla a „nepoužívaný nástroj" by ukazoval na jinou věc.
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool');
        if (dt) return dt;
        var ms = (tile.getAttribute('onclick') || '').match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function tileLabel(tile) {
        var s = tile.querySelector('span');
        var d = document.createElement('div');
        d.innerHTML = ((s ? s.innerHTML : tile.innerHTML) || '').replace(/<br\s*\/?>/gi, ' ');
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function grid() { var m = document.getElementById('tools-modal'); return m ? m.querySelector('.tool-grid') : null; }

    var _cur = null;          // právě otevřený nástroj {key, ts}
    var _lastTouch = Date.now();
    function toolEnd() {
        if (!_cur) return;
        var ms = Math.min(TOOL_CAP_MS, Date.now() - _cur.ts);
        var key = _cur.key;
        _cur = null;
        if (ms < 1500) return;      // proklik rozcestníkem není práce s nástrojem
        var t = day().tools;
        if (!t[key]) t[key] = { n: 0, ms: 0 };
        t[key].ms += ms;
        _dirty = true;
    }
    function toolStart(key) {
        toolEnd();
        var t = day().tools;
        if (!t[key]) t[key] = { n: 0, ms: 0 };
        t[key].n++;
        day().l = Date.now();
        _dirty = true;
        _cur = { key: key, ts: Date.now() };
    }
    document.addEventListener('click', function (e) {
        if (!on()) return;
        try {
            if (document.body.classList.contains('ag-tp-edit')) return;    // režim úprav oblíbených
            var tile = e.target.closest ? e.target.closest('#tools-modal .tool-tile') : null;
            if (!tile) return;
            if (e.target.closest('.ag-tp-star') || e.target.closest('.ag-tp-help')) return;
            var k = tileKey(tile);
            if (!k) return;
            rememberLabel(k, tileLabel(tile));
            toolStart(k);
        } catch (err) {}
    }, true);
    document.addEventListener('pointerdown', function () { _lastTouch = Date.now(); }, true);
    document.addEventListener('keydown', function () { _lastTouch = Date.now(); }, true);

    // ---- sběr: kroky z akcelerometru (volitelné) --------------------------------
    var _motionOn = false, _accAvg = 9.81, _lastStepTs = 0;
    function onMotion(e) {
        var a = e.accelerationIncludingGravity;
        if (!a) return;
        var mag = Math.sqrt((a.x || 0) * (a.x || 0) + (a.y || 0) * (a.y || 0) + (a.z || 0) * (a.z || 0));
        _accAvg = _accAvg * 0.95 + mag * 0.05;
        var now = Date.now();
        if (mag - _accAvg > STEP_THR && now - _lastStepTs > STEP_MIN_MS) {
            _lastStepTs = now;
            var d = day();
            d.steps++;
            _dirty = true;
        }
    }
    function startMotion() {
        if (_motionOn) return;
        try { window.addEventListener('devicemotion', onMotion); _motionOn = true; } catch (e) {}
    }
    function stopMotion() {
        if (!_motionOn) return;
        try { window.removeEventListener('devicemotion', onMotion); } catch (e) {}
        _motionOn = false;
    }
    // iOS 13+ chce povolení ze uživatelského gesta — proto se volá z přepínače
    function askMotion() {
        return new Promise(function (res) {
            try {
                if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
                    DeviceMotionEvent.requestPermission().then(function (p) { res(p === 'granted'); })['catch'](function () { res(false); });
                    return;
                }
            } catch (e) {}
            res(typeof DeviceMotionEvent !== 'undefined');
        });
    }

    // ---- sběr: čas, vzdálenost, výškové metry -----------------------------------
    var _prevFix = null, _lastFixTs = null, _altEma = null, _altRef = null, _lastTick = Date.now();
    function mPerDeg(lat) {
        try { if (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) return GeoCore.metersPerDeg(lat); } catch (e) {}
        return { lat: 111320, lng: 111320 * Math.cos(lat * Math.PI / 180) };
    }
    function planar(a, b) {
        var m = mPerDeg((a.lat + b.lat) / 2);
        var dx = (a.lng - b.lng) * m.lng, dy = (a.lat - b.lat) * m.lat;
        return Math.sqrt(dx * dx + dy * dy);
    }
    function sampleGps() {
        var f = window.AGFix;
        if (!f || f.lat == null || f.lng == null || f.err) return;
        var ts = f.ts || Date.now();
        if (_lastFixTs === ts) return;                            // stejný fix — nic nového
        _lastFixTs = ts;                                          // kotva se drží déle, proto vlastní razítko
        var cur = { ts: ts, lat: f.lat, lng: f.lng, acc: f.acc, alt: f.alt };
        var p = _prevFix;
        var d = day();
        // vzdálenost: jen z rozumného fixu, jen když se opravdu šlo.
        // Kotva _prevFix se posouvá JEN když se úsek započítal — fixy chodí po ~1 s,
        // takže při chůzi je posun mezi dvěma vzorky ~2 m, pod prahem D_MIN, a kdyby
        // se kotva posouvala pokaždé, celá ušlá vzdálenost by se rozdrobila a ztratila.
        // Posunout se ale MUSÍ i tehdy, když je vzorek nepoužitelný (špatný fix, dlouhá
        // mezera po ztrátě signálu / návratu z pozadí, rychlost mimo chůzi) — jinak by
        // z držené kotvy vznikl jeden falešný dlouhý úsek. Stejně to dělá _altRef níž.
        if (!p) {
            _prevFix = cur;
        } else if (cur.acc == null || cur.acc > ACC_MAX || p.acc == null || p.acc > ACC_MAX) {
            _prevFix = cur;
        } else {
            var dt = (cur.ts - p.ts) / 1000;
            var dist = planar(p, cur);
            if (dt <= 0 || dt >= 120) {
                _prevFix = cur;
            } else if (dist / dt > V_MAX) {
                _prevFix = cur;
            } else if (dt > 0.5 && dist >= D_MIN) {
                d.dist += dist;      // kroky se z dist odhadnou až při zobrazení
                _dirty = true;
                _prevFix = cur;
            }
            // jinak (dist < D_MIN) kotvu držíme dál a čekáme, až se z drobných
            // posunů nasčítá úsek, který má smysl započítat
        }
        // výškové metry: vyhlazená výška + schod UP_MIN (GPS výška skáče o metry)
        if (cur.alt != null && isFinite(cur.alt) && cur.acc != null && cur.acc <= ALT_ACC_MAX) {
            _altEma = (_altEma == null) ? cur.alt : (_altEma * 0.7 + cur.alt * 0.3);
            if (_altRef == null) _altRef = _altEma;
            var dz = _altEma - _altRef;
            if (dz > UP_MIN) { d.up += dz; _altRef = _altEma; _dirty = true; }
            else if (dz < -UP_MIN) { d.down += -dz; _altRef = _altEma; _dirty = true; }
        }
    }

    function tick() {
        var now = Date.now();
        var dt = now - _lastTick;
        _lastTick = now;
        if (!on()) { stopMotion(); return; }
        try {
            if (started() && visible()) {
                // čas v appce: přírůstek tiku (delší mezera = appka spala, nepočítá se)
                if (dt > 0 && dt < TICK_MS * 4) {
                    var d = day();
                    d.ms += dt;
                    d.l = now;
                    _dirty = true;
                }
                sampleGps();
                if (sensorOn()) startMotion(); else stopMotion();
            } else {
                stopMotion();
            }
            // sezení u nástroje: strop i „už u toho nejsem"
            if (_cur && (now - _cur.ts > TOOL_CAP_MS || now - _lastTouch > IDLE_END_MS)) toolEnd();
            enforceHidden();
            save(false);
        } catch (e) {}
    }
    document.addEventListener('visibilitychange', function () {
        if (!visible()) { toolEnd(); stopMotion(); save(true); }
        else { _lastTick = Date.now(); _prevFix = null; }
    });
    window.addEventListener('pagehide', function () { toolEnd(); save(true); });

    // ---- skrývání nepoužívaných nástrojů -----------------------------------------
    function hidden() {
        try { var a = JSON.parse(localStorage.getItem(LS_HIDDEN)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    function saveHidden(a) {
        try { localStorage.setItem(LS_HIDDEN, JSON.stringify(a)); } catch (e) {}
        enforceHidden();
        // seznam úkonů si skryté dlaždice ohlídá sám (data-ag-hidden), ale postavený
        // seznam se musí přestavět, jinak by tam položka zůstala až do dalšího tiku
        try { if (window.AGUkony && window.AGUkony.rebuild) window.AGUkony.rebuild(); } catch (e) {}
    }
    function setHidden(key, hide) {
        var a = hidden(), i = a.indexOf(key);
        if (hide && i === -1) a.push(key);
        else if (!hide && i !== -1) a.splice(i, 1);
        else return;
        saveHidden(a);
    }
    // Hromadný úklid — schovat/vrátit celý seznam NAJEDNOU. Přes setHidden ve smyčce
    // by se pro každý nástroj zvlášť přepsal localStorage, prošly všechny dlaždice
    // a přestavěl seznam úkonů; při osmdesáti položkách je to osmdesát průchodů.
    function setHiddenMany(keys, hide) {
        var a = hidden(), changed = false;
        for (var i = 0; i < keys.length; i++) {
            var j = a.indexOf(keys[i]);
            if (hide && j === -1) { a.push(keys[i]); changed = true; }
            else if (!hide && j !== -1) { a.splice(j, 1); changed = true; }
        }
        if (changed) saveHidden(a);
        return changed;
    }
    function searchActive() {
        var inp = document.getElementById('tools-search');
        return !!(inp && (inp.value || '').trim());
    }
    function enforceHidden() {
        var g = grid();
        if (!g) return;
        // Skrývání se vymáhá i při ZAVŘENÝCH Nástrojích (stejně jako tools-hub.js):
        // seznam úkonů se staví i bez otevřeného okna a čte právě data-ag-hidden.
        // Při HLEDÁNÍ se naopak nevymáhá — schovaný nástroj se nesmí „ztratit",
        // kdo ho napíše do hledání, musí ho najít.
        var q = searchActive();
        var h = q ? [] : hidden();
        var tiles = g.querySelectorAll('.tool-tile');
        var changed = false;
        for (var i = 0; i < tiles.length; i++) {
            var t = tiles[i];
            var k = tileKey(t);
            if (k && h.indexOf(k) !== -1) {
                if (!t.hasAttribute('data-ag-hidden')) { t.setAttribute('data-ag-hidden', '1'); changed = true; }
                if (t.style.display !== 'none') t.style.display = 'none';
            } else if (t.hasAttribute('data-ag-hidden')) {
                t.removeAttribute('data-ag-hidden');
                // při hledání display NEsaháme — nastavil ho agFilterTools (skryl i dlaždice,
                // které dotazu neodpovídají), takže bychom odkryli půlku mřížky
                if (!q && t.style.display === 'none') t.style.display = '';
                changed = true;
            }
        }
        // Seznam úkonů si otisk mřížky drží podle klíčů dlaždic — o změnu skrytí
        // se sám nedozví, takže mu ji musíme ohlásit (jinak by položka zmizela až
        // po jiné změně, nebo vůbec).
        if (changed) { try { if (window.AGUkony && window.AGUkony.rebuild) window.AGUkony.rebuild(); } catch (e) {} }
    }
    // field-tools.js přepisuje display všem dlaždicím při každém průchodu hledání —
    // po něm musíme skrytí prosadit znovu (stejný obal používá tools-hub.js)
    function wrapFilter() {
        if (window.__agAktWrapped || typeof window.agFilterTools !== 'function') return;
        var orig = window.agFilterTools;
        window.agFilterTools = function () {
            var r = orig.apply(this, arguments);
            try { enforceHidden(); } catch (e) {}
            return r;
        };
        window.__agAktWrapped = true;
    }

    // ---- agregace pro zobrazení ---------------------------------------------------
    function sumDays(keys) {
        var out = { ms: 0, dist: 0, up: 0, down: 0, steps: 0, pts: { a: 0, e: 0, d: 0 }, tools: {} };
        var d = db().days;
        keys.forEach(function (k) {
            var r = d[k];
            if (!r) return;
            out.ms += r.ms || 0; out.dist += r.dist || 0; out.up += r.up || 0; out.down += r.down || 0; out.steps += r.steps || 0;
            if (r.pts) { out.pts.a += r.pts.a || 0; out.pts.e += r.pts.e || 0; out.pts.d += r.pts.d || 0; }
            if (r.tools) {
                Object.keys(r.tools).forEach(function (tk) {
                    if (!out.tools[tk]) out.tools[tk] = { n: 0, ms: 0 };
                    out.tools[tk].n += r.tools[tk].n || 0;
                    out.tools[tk].ms += r.tools[tk].ms || 0;
                });
            }
        });
        return out;
    }
    function steps(rec) {
        if (rec.steps > 0) return { n: rec.steps, est: false };
        return { n: Math.round((rec.dist || 0) / stepLen()), est: true };
    }
    // starší počítadlo z field-tools.js (běží dávno před tímto modulem) — bere se
    // jako „za celou dobu", aby doporučení nesvítilo na nástroj, který člověk
    // používal ještě předtím, než tahle vrstva vůbec vznikla
    function legacyUsage() {
        try { var o = JSON.parse(localStorage.getItem('agToolUsage_v1')); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
    }
    // všechny známé nástroje: dlaždice v mřížce + co si pamatuju z popisků/počítadel
    function allTools() {
        var out = {}, g = grid(), i;
        if (g) {
            var tiles = g.querySelectorAll('.tool-tile');
            for (i = 0; i < tiles.length; i++) {
                var k = tileKey(tiles[i]);
                if (!k) continue;
                if (tiles[i].id === 'ag-sm-allbtn') continue;
                if (tiles[i].hasAttribute('data-agucty')) continue;      // na co uživatel nemá právo, o tom se nebavíme
                var lbl = tileLabel(tiles[i]);
                out[k] = lbl || k;
                rememberLabel(k, lbl);
            }
        }
        var l = labels();
        Object.keys(l).forEach(function (k) { if (!out[k]) out[k] = l[k]; });
        return out;
    }
    function labelOf(key, all) {
        return (all && all[key]) || labels()[key] || key;
    }
    function favs() {
        try { var a = JSON.parse(localStorage.getItem('agToolFavs_v1')); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    function toggleFav(key) {
        var a = favs(), i = a.indexOf(key);
        if (i === -1) a.push(key); else a.splice(i, 1);
        try { localStorage.setItem('agToolFavs_v1', JSON.stringify(a)); } catch (e) {}
    }

    // ---- styly ------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + MODAL_ID + ' .modal-content{display:flex;flex-direction:column;}',
            '#ag-akt-body{flex:1;overflow-y:auto;min-height:0;}',
            '#ag-akt-body h4{margin:16px 0 8px;font:700 11px/1 var(--font-display,system-ui),sans-serif;',
            '  letter-spacing:.09em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#ag-akt-body h4:first-child{margin-top:0;}',
            '.ag-akt-sub{margin:0 0 12px;font:500 12.5px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            // kachle „dnes"
            '.ag-akt-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}',
            '.ag-akt-k{padding:11px 10px;border-radius:12px;text-align:center;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.10));background:var(--surface-1,rgba(255,255,255,0.045));}',
            '.ag-akt-k .v{display:block;font:700 17px/1.15 var(--font-display,system-ui);color:var(--text-color,#e6e8eb);}',
            '.ag-akt-k .u{display:block;margin-top:3px;font:600 10.5px/1.2 var(--font-ui,system-ui);letter-spacing:.03em;',
            '  text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            // shrnutí dne
            '.ag-akt-sum{margin:10px 0 0;padding:12px 13px;border-radius:12px;font:500 13.5px/1.55 var(--font-ui,system-ui);',
            '  color:var(--text-color,#e6e8eb);border:1px solid var(--accent-line,rgba(47,158,116,0.38));',
            '  background:var(--accent-soft,rgba(47,158,116,0.12));}',
            // řádky (dny, nástroje)
            '.ag-akt-r{display:flex;align-items:center;gap:10px;padding:9px 11px;margin-bottom:6px;border-radius:11px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.09));background:var(--surface-1,rgba(255,255,255,0.04));',
            '  font:500 13px/1.35 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '.ag-akt-r .n{flex:0 0 62px;color:var(--text-muted,#9aa1ac);font-weight:600;}',
            '.ag-akt-r .g{flex:1 1 auto;min-width:0;}',
            '.ag-akt-r .g b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.ag-akt-r .g small{display:block;margin-top:2px;font-size:calc(11.5px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);}',
            '.ag-akt-bar{height:6px;border-radius:99px;background:var(--surface-3,rgba(255,255,255,0.10));overflow:hidden;margin-top:5px;}',
            '.ag-akt-bar i{display:block;height:100%;border-radius:99px;background:var(--accent,#2f9e74);}',
            '.ag-akt-r .b{flex:0 0 auto;padding:6px 11px;border-radius:99px;cursor:pointer;',
            '  font:600 12px/1 var(--font-ui,system-ui);background:transparent;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.16));color:var(--text-muted,#9aa1ac);}',
            '.ag-akt-r .b.on{border-color:var(--accent-line,rgba(47,158,116,0.45));color:var(--accent-bright,#34d399);}',
            '.ag-akt-r .b:active{background:var(--surface-3,rgba(255,255,255,0.10));}',
            // přepínače
            '.ag-akt-sw{display:flex;align-items:flex-start;gap:9px;padding:10px 2px;',
            '  font:500 13px/1.4 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '.ag-akt-sw input{flex:0 0 auto;margin:1px 0 0;width:18px;height:18px;}',
            '.ag-akt-sw small{display:block;margin-top:2px;font-size:calc(11.5px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);}',
            '.ag-akt-foot{display:flex;gap:8px;margin-top:12px;}',
            '.ag-akt-foot .btn{flex:1;}',
            '.ag-akt-empty{padding:10px 2px;font:500 12.5px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- vykreslení -------------------------------------------------------------------
    function kachle(list) {
        return '<div class="ag-akt-grid">' + list.map(function (k) {
            return '<div class="ag-akt-k"><span class="v">' + k[0] + '</span><span class="u">' + esc(k[1]) + '</span></div>';
        }).join('') + '</div>';
    }
    function summaryText(rec, all) {
        var s = steps(rec);
        var parts = [];
        if (rec.ms > 60000) parts.push('v appce <b>' + fmtMs(rec.ms) + '</b>');
        if (rec.dist > 50) parts.push('ušel jsi <b>' + fmtDist(rec.dist) + '</b>' + (s.n > 100 ? ' (≈ ' + s.n + ' kroků' + (s.est ? ', odhad' : '') + ')' : ''));
        if (rec.up > 5) parts.push('nastoupáno <b>' + num(rec.up, 0) + ' m</b>');
        if (rec.pts.a) parts.push('<b>' + rec.pts.a + '</b> ' + (rec.pts.a === 1 ? 'nový bod' : (rec.pts.a < 5 ? 'nové body' : 'nových bodů')));
        if (rec.pts.e) parts.push(rec.pts.e + '× úprava bodu');
        if (rec.pts.d) parts.push(rec.pts.d + '× smazání bodu');
        var tk = Object.keys(rec.tools).sort(function (a, b) { return (rec.tools[b].ms || 0) - (rec.tools[a].ms || 0); });
        if (tk.length && rec.tools[tk[0]].ms > 60000) {
            parts.push('nejvíc času u <b>' + esc(labelOf(tk[0], all)) + '</b> (' + fmtMs(rec.tools[tk[0]].ms) + ')');
        }
        if (!parts.length) return 'Dnes zatím nic — jak začneš měřit, naskočí to sem samo.';
        return parts.join(', ') + '.';
    }
    function dayRows() {
        var keys = lastKeys(7);
        if (!keys.length) return '<div class="ag-akt-empty">Zatím není co ukázat.</div>';
        var d = db().days, max = 1;
        keys.forEach(function (k) { if (d[k] && d[k].dist > max) max = d[k].dist; });
        var today = dayKey();
        var out = '';
        for (var i = keys.length - 1; i >= 0; i--) {
            var k = keys[i], r = d[k] || newDay();
            var pct = Math.max(2, Math.round((r.dist || 0) / max * 100));
            var line = [(r.ms >= 60000 ? fmtMs(r.ms) : ''), fmtDist(r.dist),
                (r.pts && r.pts.a ? r.pts.a + ' ' + plBod(r.pts.a) : ''), (r.up > 5 ? '↑ ' + num(r.up, 0) + ' m' : '')]
                .filter(function (x) { return !!x; }).join(' · ');
            out += '<div class="ag-akt-r"><span class="n">' + esc(k === today ? 'dnes' : fmtDayShort(k)) + '</span>'
                + '<span class="g"><b>' + (line || 'nic') + '</b><span class="ag-akt-bar"><i style="width:' + pct + '%"></i></span></span></div>';
        }
        return out;
    }
    function toolRows(agg, all) {
        var f = favs();
        var keys = Object.keys(agg.tools).sort(function (a, b) {
            var A = agg.tools[a], B = agg.tools[b];
            return (B.n - A.n) || (B.ms - A.ms);
        }).slice(0, 10);
        if (!keys.length) return '<div class="ag-akt-empty">Ještě jsem nezachytil žádné otevření nástroje.</div>';
        return keys.map(function (k) {
            var t = agg.tools[k];
            var isFav = f.indexOf(k) !== -1;
            return '<div class="ag-akt-r"><span class="g"><b>' + esc(labelOf(k, all)) + '</b>'
                + '<small>' + t.n + '× · ' + fmtMs(t.ms) + '</small></span>'
                + '<button type="button" class="b' + (isFav ? ' on' : '') + '" data-fav="' + esc(k) + '">'
                + (isFav ? '★ oblíbený' : '☆ oblíbit') + '</button></div>';
        }).join('');
    }
    var _unused = [];                    // co právě visí v „Do čeho jsem nešáhl" — pro hromadné schování
    function unusedRows(agg, all) {
        var leg = legacyUsage(), h = hidden();
        var days = sortedKeys().length;
        var keys = Object.keys(all).filter(function (k) {
            if (h.indexOf(k) !== -1) return false;                      // už schovaný
            if (agg.tools[k] && agg.tools[k].n) return false;
            if (leg[k]) return false;
            return true;
        }).sort(function (a, b) { return labelOf(a, all).localeCompare(labelOf(b, all), 'cs'); });
        _unused = keys;
        var note = '';
        if (days < 3) {
            note = '<div class="ag-akt-empty">Sbírám data ' + days + ' ' + (days === 1 ? 'den' : (days < 5 ? 'dny' : 'dnů')) + ' — '
                + 'doporučení bude mít smysl po týdnu práce. Schovat nástroj jde i tak.</div>';
        }
        if (!keys.length) return note + '<div class="ag-akt-empty">Nic takového — do všech nástrojů v mřížce jsi už šáhl.</div>';
        // Po jednom se osmdesát nástrojů uklízet nedá, proto jedno tlačítko na všechny.
        if (keys.length >= 3) {
            note += '<div class="ag-akt-r"><span class="g"><b>Uklidit najednou</b>'
                + '<small>schová všech ' + keys.length + ' — vrátit je můžeš níž</small></span>'
                + '<button type="button" class="b" id="ag-akt-hideall">skrýt vše</button></div>';
        }
        return note + keys.map(function (k) {
            return '<div class="ag-akt-r"><span class="g"><b>' + esc(labelOf(k, all)) + '</b>'
                + '<small>ani jednou</small></span>'
                + '<button type="button" class="b" data-hide="' + esc(k) + '">skrýt</button></div>';
        }).join('');
    }
    function hiddenRows(all) {
        var h = hidden();
        if (!h.length) return '';
        return '<h4>Skryté nástroje (' + h.length + ')</h4>'
            + '<p class="ag-akt-sub">Nezmizely — v Nástrojích je pořád najde hledání. Tady je vrátíš do mřížky i do seznamu úkonů.</p>'
            + (h.length >= 3
                ? '<div class="ag-akt-r"><span class="g"><b>Vrátit všechny</b>'
                  + '<small>zruší celý úklid — všech ' + h.length + ' zpátky do mřížky</small></span>'
                  + '<button type="button" class="b on" id="ag-akt-showall">vrátit vše</button></div>'
                : '')
            + h.map(function (k) {
                return '<div class="ag-akt-r"><span class="g"><b>' + esc(labelOf(k, all)) + '</b></span>'
                    + '<button type="button" class="b on" data-show="' + esc(k) + '">vrátit</button></div>';
            }).join('');
    }

    function render() {
        var m = document.getElementById(MODAL_ID);
        if (!m) return;
        var all = allTools();
        var today = day(dayKey());
        var week = sumDays(lastKeys(7));
        var month = sumDays(lastKeys(30));
        var s = steps(today);
        var tracking = on();

        var html = ''
            + '<h4>Dnes</h4>'
            + kachle([
                [fmtMs(today.ms), 'v appce'],
                [fmtDist(today.dist), 'ušel jsi'],
                [(s.n || 0) + (s.est ? '*' : ''), 'kroků'],
                [num(today.up, 0) + ' m', 'nastoupáno'],
                [String(today.pts.a || 0), 'nových bodů'],
                [String(Object.keys(today.tools).length), 'nástrojů']
            ])
            + '<div class="ag-akt-sum">' + summaryText(today, all) + '</div>'
            + (s.est ? '<p class="ag-akt-sub">* kroky jsou odhad z ušlé vzdálenosti (délka kroku ' + num(stepLen(), 2) + ' m). Poctivý krokoměr zapneš dole.</p>' : '')

            + '<h4>Posledních 7 dní</h4>'
            + dayRows()
            + '<div class="ag-akt-sum">Týden: ' + fmtMs(week.ms) + ' v appce · ' + fmtDist(week.dist)
            + ' · ' + (week.pts.a || 0) + ' nových ' + plBod(week.pts.a || 0) + ' · ↑ ' + num(week.up, 0) + ' m</div>'

            + '<h4>Co používám nejvíc (30 dní)</h4>'
            + toolRows(month, all)

            + '<h4>Do čeho jsem nešáhl</h4>'
            + '<p class="ag-akt-sub">Nástroje, které jsi za celou dobu neotevřel. Co ti nesedí, schovej — mřížka i seznam úkonů budou kratší.</p>'
            + unusedRows(month, all)
            + hiddenRows(all)

            + '<h4>Nastavení</h4>'
            + '<label class="ag-akt-sw"><input type="checkbox" id="ag-akt-on"' + (tracking ? ' checked' : '') + '>'
            + '<span>Měřit moji aktivitu<small>Data zůstávají v tomhle telefonu — nikam se neposílají. Vypnutím se přestane měřit, nasbírané dny zůstanou.</small></span></label>'
            + '<label class="ag-akt-sw"><input type="checkbox" id="ag-akt-sens"' + (sensorOn() ? ' checked' : '') + '>'
            + '<span>Kroky z akcelerometru<small>Přesnější než odhad z GPS (počítá i kroky na místě), ale senzor běží po celou dobu, co je appka na obrazovce — trochu ubere z baterie.</small></span></label>'
            + '<label class="ag-akt-sw"><input type="checkbox" id="ag-akt-bf"' + (bfAuto() ? ' checked' : '') + '>'
            + '<span>Ukazovat „Dnešek v terénu" po spuštění<small>Karta s počasím, GNSS okny dne, Kp indexem a body po termínu — jednou denně hned po přihlášení. Vypnuto ji kdykoli otevřeš dlaždicí.</small></span></label>'
            + '<div class="ag-akt-foot">'
            + '  <button type="button" class="btn btn-secondary" id="ag-akt-csv">Export CSV</button>'
            + '  <button type="button" class="btn btn-secondary" id="ag-akt-wipe">Smazat data</button>'
            + '</div>';

        var body = m.querySelector('#ag-akt-body');
        body.innerHTML = html;
        bind(m);
    }
    function bfAuto() { try { return localStorage.getItem(LS_BF_AUTO) !== '0'; } catch (e) { return true; } }

    function bind(m) {
        var i;
        var favBtns = m.querySelectorAll('[data-fav]');
        for (i = 0; i < favBtns.length; i++) {
            favBtns[i].onclick = function () { toggleFav(this.getAttribute('data-fav')); render(); };
        }
        var hideBtns = m.querySelectorAll('[data-hide]');
        for (i = 0; i < hideBtns.length; i++) {
            hideBtns[i].onclick = function () { setHidden(this.getAttribute('data-hide'), true); render(); };
        }
        var showBtns = m.querySelectorAll('[data-show]');
        for (i = 0; i < showBtns.length; i++) {
            showBtns[i].onclick = function () { setHidden(this.getAttribute('data-show'), false); render(); };
        }
        var hideAll = m.querySelector('#ag-akt-hideall');
        if (hideAll) hideAll.onclick = function () {
            var keys = _unused.slice();
            if (!keys.length) return;
            agAsk('Schovat všech ' + keys.length + ' nástrojů, do kterých jsi zatím nešáhl? Mřížka i seznam úkonů se o ně zkrátí. Nic se nemaže — hledání je najde dál a tady je vrátíš zpátky.',
                { title: 'Uklidit nástroje', okText: 'Schovat vše' }).then(function (ok) {
                if (!ok) return;
                setHiddenMany(keys, true);
                render();
            });
        };
        var showAll = m.querySelector('#ag-akt-showall');
        if (showAll) showAll.onclick = function () {
            setHiddenMany(hidden().slice(), false);
            render();
        };
        var cbOn = m.querySelector('#ag-akt-on');
        if (cbOn) cbOn.onchange = function () {
            try { localStorage.setItem(LS_ON, this.checked ? '1' : '0'); } catch (e) {}
            if (!this.checked) { toolEnd(); stopMotion(); save(true); }
            else { _lastTick = Date.now(); _prevFix = null; }
        };
        var cbS = m.querySelector('#ag-akt-sens');
        if (cbS) cbS.onchange = function () {
            var el = this;
            if (!el.checked) {
                try { localStorage.setItem(LS_SENS, '0'); } catch (e) {}
                stopMotion();
                return;
            }
            askMotion().then(function (ok) {
                if (!ok) {
                    el.checked = false;
                    try { if (window.agAlert) window.agAlert({ title: 'Krokoměr', message: 'Telefon nepustil přístup k senzoru pohybu, kroky zůstanou odhadem z ušlé vzdálenosti.' }); } catch (e) {}
                    return;
                }
                try { localStorage.setItem(LS_SENS, '1'); } catch (e) {}
                startMotion();
            });
        };
        var cbBf = m.querySelector('#ag-akt-bf');
        if (cbBf) cbBf.onchange = function () {
            try { localStorage.setItem(LS_BF_AUTO, this.checked ? '1' : '0'); } catch (e) {}
        };
        var csv = m.querySelector('#ag-akt-csv');
        if (csv) csv.onclick = exportCsv;
        var wipe = m.querySelector('#ag-akt-wipe');
        if (wipe) wipe.onclick = function () {
            agAsk('Smazat celou historii mé aktivity? Skryté nástroje zůstanou skryté.', { title: 'Smazat historii', okText: 'Smazat', danger: true }).then(function (ok) {
            if (!ok) return;
            _db = { v: 1, days: {} };
            _dirty = true;
            save(true);
            _cur = null;
            render();
            });
        };
    }

    function exportCsv() {
        var all = allTools();
        var d = db().days, keys = sortedKeys();
        var rows = ['datum;minuty v appce;usla vzdalenost m;nastoupano m;kroky;nove body;upravene body;smazane body;nejcasteji pouzity nastroj'];
        keys.forEach(function (k) {
            var r = d[k];
            var s = steps(r);
            var tk = Object.keys(r.tools || {}).sort(function (a, b) { return (r.tools[b].n || 0) - (r.tools[a].n || 0); });
            rows.push([k, Math.round((r.ms || 0) / 60000), Math.round(r.dist || 0), Math.round(r.up || 0), s.n,
                (r.pts && r.pts.a) || 0, (r.pts && r.pts.e) || 0, (r.pts && r.pts.d) || 0,
                tk.length ? labelOf(tk[0], all).replace(/;/g, ',') : ''].join(';'));
        });
        // BOM, ať to Excel v češtině otevře správně (stejně jako ostatní exporty v appce)
        var blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'moje-aktivita-' + dayKey() + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1000);
    }

    // ---- modal ---------------------------------------------------------------------------
    function close() { var m = document.getElementById(MODAL_ID); if (m) m.style.display = 'none'; }
    function open() {
        injectStyles();
        var m = document.getElementById(MODAL_ID);
        if (!m) {
            m = document.createElement('div');
            m.className = 'modal-overlay';
            m.id = MODAL_ID;
            m.innerHTML = '<div class="modal-content">'
                + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Moje aktivita</h3>'
                + '<div id="ag-akt-body"></div>'
                + '<div class="ag-akt-foot"><button type="button" class="btn btn-primary" id="ag-akt-close">Zavřít</button></div>'
                + '</div>';
            document.body.appendChild(m);
            m.querySelector('#ag-akt-close').addEventListener('click', close);
        }
        m.style.display = 'flex';
        render();
    }

    // ---- dlaždice v Nástrojích ---------------------------------------------------------------
    var _regTries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'moje-aktivita', label: 'Moje aktivita', icon: ICON, cat: 'Pomůcky', onClick: open, order: 64 });
            return;
        }
        if (_regTries++ < 20) setTimeout(register, 500);
    }

    function init() {
        register();
        wrapFilter();
        if (!window.__agAktTimer) {
            window.__agAktTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
                try { wrapFilter(); tick(); } catch (e) {}
            }, TICK_MS);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGAkt = {
        open: open,
        today: function () { return day(dayKey()); },
        hidden: hidden,
        setHidden: setHidden
    };
    window.agOpenMojeAktivita = open;
})();
