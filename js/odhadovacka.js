// ===== AR Geodet — ODHADNI TO / cvičiště odhadu (ODPOJITELNÁ vrstva) ===========
// Neinvazivní. NEEDITUJE logika.js ani grafika.js — jen čte globály
// (userLat/userLng, currentHeading, currentGpsAccuracy, arPoints, getDistance)
// a otevírá vlastní modal.
//
// CO TO JE
// Tři krátké disciplíny, ve kterých člověk NEJDŘÍV odhadne a AŽ POTOM se dozví
// pravdu ze skutečných senzorů:
//   ① UJDI VZDÁLENOST — appka řekne „ujdi 38 m", ty jdeš a klepneš „jsem tam".
//      Pravda = ušlá vzdálenost z GPS.
//   ② OTOČ SE NA AZIMUT — appka řekne „otoč se na 210°", ty se otočíš a klepneš.
//      Pravda = kompas.
//   ③ JAK JE TO DALEKO — appka vybere bod ze zakázky, ty odhadneš vzdálenost
//      okem. Pravda = výpočet z GPS.
//
// PROČ TO NENÍ JEN HRA
// Odhad vzdálenosti a směru je pracovní nástroj: kdo ví, jak vypadá 30 metrů a
// kde je jihozápad, ten pozná hloupou chybu v datech dřív, než ji uloží —
// špatně přečtený metr, přehozené souřadnice, bod v sousední ulici. Trénuje se
// to jedině zpětnou vazbou, a tu appka umí dát okamžitě, protože ta měřidla
// stejně nosí v kapse. Vedle toho jde o jediný nástroj v appce, který se dá
// zapnout jen tak — na procházce, bez zakázky a bez práce.
//
// ⚠ ROZDÍL PROTI js/trenazer.js (jiná vrstva, jiný autor): trenažér si polohu
// PODVRHUJE a nechá člověka vytyčovat cvičnou zakázku. Tahle vrstva stojí přesně
// naopak na tom, že senzory jsou skutečné — jinak by neměla čím odhad opravit.
// Proto samostatný soubor, klíč `odhadovacka` a dlaždice „Odhadni to".
//
// POCTIVĚ: mobilní GPS má metrovou chybu, takže u „ujdi 38 m" nejde o centimetry
// a hra to nepředstírá — disciplína se odmítne pustit, když je přesnost horší
// než 10 m, a hodnotí se v procentech, ne v milimetrech.
//
// Vstup: dlaždice „Odhadni to" v Nástrojích (Pomůcky). API: window.agOpenOdhad().
// Odstranění: smaž js/odhadovacka.js + jeho řádek v index.html a spusť
//             python scripts/gen_sw_assets.py --bump.
// ==============================================================================
(function () {
    'use strict';
    if (window.agOpenOdhad) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>';

    var LS = 'agOdhad_v1';
    var ACC_MAX = 10;        // horší přesnost GPS než tohle → chůzi neměříme
    var HIST_MAX = 60;

    var modal = null, tick = null;
    var disc = 'walk';       // 'walk' | 'azimut' | 'dist'
    var task = null;         // aktivní zadání
    var phase = 'idle';      // 'idle' | 'run' | 'done'

    function swallow(e, w) { try { window.AG && AG.swallow && AG.swallow(e, 'odhadovacka:' + w); } catch (e2) { /* fail-silent */ } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function info(m) { try { if (typeof window.agInfo === 'function') window.agInfo(m); } catch (e) { swallow(e, 'info'); } }
    function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { swallow(e, 'buzz'); } }

    function here() {
        try { if (typeof userLat === 'number' && typeof userLng === 'number' && isFinite(userLat) && isFinite(userLng)) return { lat: userLat, lng: userLng }; } catch (e) { swallow(e, 'here'); }
        return null;
    }
    function acc() {
        try { if (typeof currentGpsAccuracy === 'number' && isFinite(currentGpsAccuracy) && currentGpsAccuracy > 0) return currentGpsAccuracy; } catch (e) { swallow(e, 'acc'); }
        return null;
    }
    function head() {
        try { if (typeof currentHeading === 'number' && isFinite(currentHeading)) return currentHeading; } catch (e) { swallow(e, 'head'); }
        return null;
    }
    function dist(a, b) {
        try { if (typeof getDistance === 'function') return getDistance(a.lat, a.lng, b.lat, b.lng); } catch (e) { swallow(e, 'dist'); }
        return null;
    }
    function adiff(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }

    // body zakázky v rozumném dosahu pro odhad okem
    function nearPoints() {
        var me = here(); if (!me) return [];
        var out = [];
        try {
            if (typeof arPoints === 'undefined' || !arPoints) return [];
            arPoints.forEach(function (p) {
                if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
                if (p.hidden) return;
                var d = dist(me, p);
                if (d != null && d >= 5 && d <= 500) out.push({ p: p, d: d });
            });
        } catch (e) { swallow(e, 'nearPoints'); }
        return out;
    }

    // ---- skóre -----------------------------------------------------------------
    function load() {
        try { var s = JSON.parse(localStorage.getItem(LS) || 'null'); if (s && typeof s === 'object') return s; } catch (e) { swallow(e, 'load'); }
        return { hist: [], streak: 0, bestStreak: 0 };
    }
    function save(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { swallow(e, 'save'); } }

    function record(d, score, errTxt) {
        var s = load();
        s.hist.push({ d: d, s: Math.round(score), e: errTxt, t: Date.now() });
        if (s.hist.length > HIST_MAX) s.hist = s.hist.slice(-HIST_MAX);
        // série = kolik pokusů po sobě vyšlo na 80 bodů a víc
        if (score >= 80) { s.streak = (s.streak || 0) + 1; if (s.streak > (s.bestStreak || 0)) s.bestStreak = s.streak; }
        else s.streak = 0;
        save(s);
        return s;
    }

    function avgLast(n, d) {
        var s = load(), h = s.hist.filter(function (x) { return !d || x.d === d; }).slice(-n);
        if (!h.length) return null;
        return h.reduce(function (a, x) { return a + x.s; }, 0) / h.length;
    }

    function grade(score) {
        if (score >= 90) return { t: 'Přesnost geodeta', c: 'var(--accent,#2f9e74)' };
        if (score >= 70) return { t: 'Dobré oko', c: 'var(--accent,#2f9e74)' };
        if (score >= 40) return { t: 'Ujde to', c: 'var(--warning,#fbbf24)' };
        return { t: 'Vedle', c: 'var(--danger,#fb7185)' };
    }

    // ---- zadání ----------------------------------------------------------------
    function newTask() {
        phase = 'idle'; task = null;
        if (disc === 'walk') {
            var me = here(), a = acc();
            if (!me) return { err: 'Nemám polohu — bez GPS se ušlá vzdálenost nezměří.' };
            if (a != null && a > ACC_MAX) return { err: 'GPS je teď nepřesná (±' + a.toFixed(0) + ' m). Tahle disciplína potřebuje aspoň ±' + ACC_MAX + ' m, jinak by hodnotila šum, ne tvůj odhad.' };
            var target = 15 + Math.round(Math.random() * 45);   // 15–60 m
            return { kind: 'walk', target: target, unit: 'm', ask: 'Ujdi přesně <b>' + target + ' m</b> a klepni „Jsem tam".' };
        }
        if (disc === 'azimut') {
            if (head() == null) return { err: 'Kompas zatím nedává data — pohni telefonem (osmička).' };
            var az = Math.round(Math.random() * 359);
            return { kind: 'azimut', target: az, unit: '°', ask: 'Otoč se tak, aby telefon mířil na azimut <b>' + az + '°</b>, a klepni „Jsem otočený". <span style="opacity:.75;">(0° sever, 90° východ, 180° jih, 270° západ.)</span>' };
        }
        var list = nearPoints();
        if (!list.length) return { err: 'V okolí není žádný bod zakázky mezi 5 a 500 m — tuhle disciplínu můžeš hrát až v terénu u zakázky. Zkus zatím „Ujdi vzdálenost" nebo „Otoč se na azimut".' };
        var pick = list[Math.floor(Math.random() * list.length)];
        return { kind: 'dist', target: pick.d, unit: 'm', name: (pick.p.name || 'bod'), ask: 'Podívej se na bod <b>' + esc(pick.p.name || 'bod') + '</b> v mapě a odhadni, <b>jak je odsud daleko</b>. Nejdřív odhad, teprve pak se dozvíš pravdu.' };
    }

    // ---- vyhodnocení -----------------------------------------------------------
    function evalWalk() {
        var me = here();
        if (!me || !task.from) return null;
        var walked = dist(task.from, me);
        if (walked == null) return null;
        var err = Math.abs(walked - task.target);
        var errPct = err / task.target * 100;
        return {
            score: Math.max(0, 100 - errPct * 2.5),
            line: 'Ušel jsi <b>' + walked.toFixed(1).replace('.', ',') + ' m</b> místo ' + task.target + ' m — vedle o ' + err.toFixed(1).replace('.', ',') + ' m (' + errPct.toFixed(0) + ' %).',
            errTxt: err.toFixed(1) + ' m'
        };
    }
    function evalAzimut() {
        var h = head(); if (h == null) return null;
        var err = adiff(h, task.target);
        return {
            score: Math.max(0, 100 - err * 4),
            line: 'Míříš na <b>' + h.toFixed(0) + '°</b> místo ' + task.target + '° — vedle o ' + err.toFixed(0) + '°.',
            errTxt: err.toFixed(0) + '°'
        };
    }
    function evalDist(guess) {
        var err = Math.abs(guess - task.target);
        var errPct = err / task.target * 100;
        return {
            score: Math.max(0, 100 - errPct * 2.5),
            line: 'Skutečnost je <b>' + task.target.toFixed(1).replace('.', ',') + ' m</b>, tys odhadl ' + guess.toFixed(1).replace('.', ',') + ' m — vedle o ' + err.toFixed(1).replace('.', ',') + ' m (' + errPct.toFixed(0) + ' %).',
            errTxt: err.toFixed(1) + ' m'
        };
    }

    // ---- UI --------------------------------------------------------------------
    function styles() {
        var css =
            '#odhad-modal .od-seg{display:flex;gap:6px;margin-bottom:12px;}'
            + '#odhad-modal .od-seg-b{flex:1;padding:8px 4px;min-height:var(--tap-min,44px);border-radius:var(--r-sm,9px);'
            + 'border:1px solid var(--glass-border,rgba(255,255,255,.1));background:var(--surface-1,rgba(255,255,255,.06));'
            + 'color:var(--text-muted,#9aa1ac);font-size:calc(12px * var(--ag-font-scale,1));font-family:inherit;cursor:pointer;line-height:1.25;}'
            + '#odhad-modal .od-seg-b.od-on{background:var(--accent-soft,rgba(47,158,116,.14));border-color:var(--accent-line,rgba(47,158,116,.42));color:var(--accent,#2f9e74);font-weight:600;}'
            + '#odhad-modal .od-ask{padding:12px;border-radius:var(--r-sm,9px);background:var(--surface-1,rgba(255,255,255,.06));'
            + 'border:1px solid var(--glass-border,rgba(255,255,255,.1));font-size:calc(14px * var(--ag-font-scale,1));line-height:1.5;}'
            + '#odhad-modal .od-big{font-family:var(--font-mono,monospace);font-size:calc(30px * var(--ag-font-scale,1));font-weight:700;'
            + 'color:var(--data,#e6bd76);text-align:center;margin:14px 0 6px;}'
            + '#odhad-modal .od-live{text-align:center;color:var(--text-muted,#9aa1ac);font-size:calc(12.5px * var(--ag-font-scale,1));margin-bottom:10px;}'
            + '#odhad-modal .od-res{margin-top:12px;padding:12px;border-radius:var(--r-sm,9px);'
            + 'background:var(--surface-1,rgba(255,255,255,.06));border:1px solid var(--glass-border,rgba(255,255,255,.1));'
            + 'font-size:calc(13px * var(--ag-font-scale,1));line-height:1.5;}'
            + '#odhad-modal .od-grade{font-size:calc(17px * var(--ag-font-scale,1));font-weight:700;margin-bottom:4px;}'
            + '#odhad-modal .od-stat{margin-top:14px;padding-top:10px;border-top:1px solid var(--glass-border,rgba(255,255,255,.1));'
            + 'display:flex;gap:10px;text-align:center;}'
            + '#odhad-modal .od-stat div{flex:1;min-width:0;}'
            + '#odhad-modal .od-stat b{display:block;font-family:var(--font-mono,monospace);font-size:calc(17px * var(--ag-font-scale,1));color:var(--text-color,#eceef2);}'
            + '#odhad-modal .od-stat span{color:var(--text-faint,#6b727d);font-size:calc(11px * var(--ag-font-scale,1));}'
            + '#odhad-modal .od-warn{padding:11px;border-radius:var(--r-sm,9px);background:rgba(251,191,36,.12);'
            + 'border:1px solid var(--warning,#fbbf24);font-size:calc(12.5px * var(--ag-font-scale,1));line-height:1.45;}'
            + '#odhad-modal input.od-in{width:100%;padding:11px;border-radius:var(--r-sm,9px);'
            + 'border:1px solid var(--border,rgba(255,255,255,.1));background:var(--bg-input,rgba(255,255,255,.06));'
            + 'color:var(--text-color,#eceef2);font-family:var(--font-mono,monospace);'
            + 'font-size:calc(17px * var(--ag-font-scale,1));text-align:center;}';
        try {
            if (window.AG && typeof AG.style === 'function') AG.style('ag-odhad-css', css);
            else { var st = document.createElement('style'); st.id = 'ag-odhad-css'; st.textContent = css; document.head.appendChild(st); }
        } catch (e) { swallow(e, 'styles'); }
    }

    function build() {
        modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'odhad-modal';
        modal.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Odhadni to</h3>'
            + '<div class="modal-body">'
            + '  <div class="od-seg" id="od-seg">'
            + '    <button type="button" class="od-seg-b od-on" data-d="walk">Ujdi<br>vzdálenost</button>'
            + '    <button type="button" class="od-seg-b" data-d="azimut">Otoč se<br>na azimut</button>'
            + '    <button type="button" class="od-seg-b" data-d="dist">Jak je to<br>daleko</button>'
            + '  </div>'
            + '  <div id="od-body"></div>'
            + '  <div class="od-stat" id="od-stat"></div>'
            + '</div>'
            + '<button class="btn btn-secondary" style="margin-top:15px;" id="od-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(modal);

        modal.querySelector('#od-close').addEventListener('click', close);
        modal.querySelector('#od-seg').addEventListener('click', function (ev) {
            var b = ev.target.closest('.od-seg-b'); if (!b) return;
            disc = b.getAttribute('data-d');
            Array.prototype.forEach.call(modal.querySelectorAll('.od-seg-b'), function (x) { x.classList.toggle('od-on', x === b); });
            start();
        });
    }

    function start() {
        var t = newTask();
        var body = modal.querySelector('#od-body');
        if (t.err) { task = null; phase = 'idle'; body.innerHTML = '<div class="od-warn">' + esc(t.err) + '</div>'; renderStat(); return; }
        task = t; phase = 'run';
        if (t.kind === 'walk') task.from = here();

        var html = '<div class="od-ask">' + t.ask + '</div>';
        if (t.kind === 'dist') {
            html += '<div style="margin-top:12px;"><input class="od-in" id="od-in" type="number" inputmode="decimal" placeholder="odhad v metrech"></div>'
                + '<button class="btn btn-primary" id="od-go" style="margin-top:10px;">Potvrdit odhad</button>';
        } else {
            html += '<div class="od-big" id="od-big">–</div><div class="od-live" id="od-live"></div>'
                + '<button class="btn btn-primary" id="od-go">' + (t.kind === 'walk' ? 'Jsem tam' : 'Jsem otočený') + '</button>';
        }
        html += '<div id="od-out"></div>';
        body.innerHTML = html;
        modal.querySelector('#od-go').addEventListener('click', submit);
        renderLive();
        renderStat();
    }

    // Živý údaj během disciplíny. ZÁMĚRNĚ NEUKAZUJE to, co se má odhadnout:
    // u chůze běží jen čas (ne ušlé metry) a u azimutu se neukazuje nic —
    // jinak by to nebyl odhad, ale odečet z displeje.
    function renderLive() {
        if (!modal || phase !== 'run' || !task) return;
        var big = modal.querySelector('#od-big'), live = modal.querySelector('#od-live');
        if (!big) return;
        if (task.kind === 'walk') {
            big.textContent = task.target + ' m';
            var s = Math.round((Date.now() - (task.t0 || (task.t0 = Date.now()))) / 1000);
            live.innerHTML = 'jdeš ' + s + ' s · <span style="opacity:.7;">metry schválně neukazuju</span>';
        } else if (task.kind === 'azimut') {
            big.textContent = task.target + '°';
            live.innerHTML = '<span style="opacity:.7;">kompas schválně neukazuju</span>';
        }
    }

    function submit() {
        if (!task || phase !== 'run') return;
        var r = null;
        if (task.kind === 'walk') r = evalWalk();
        else if (task.kind === 'azimut') r = evalAzimut();
        else {
            var el = modal.querySelector('#od-in');
            var v = (typeof window.agNum === 'function') ? window.agNum(el) : parseFloat(String(el.value).replace(',', '.'));
            if (!isFinite(v) || v <= 0) { info('Zadej odhad v metrech.'); return; }
            r = evalDist(v);
        }
        if (!r) { info('Nepodařilo se změřit — zkus to znovu.'); return; }

        phase = 'done';
        var g = grade(r.score);
        var s = record(task.kind, r.score, r.errTxt);
        buzz(r.score >= 80 ? [25, 40, 25] : 30);

        var out = modal.querySelector('#od-out');
        out.innerHTML =
            '<div class="od-res">'
            + '<div class="od-grade" style="color:' + g.c + ';">' + esc(g.t) + ' · ' + Math.round(r.score) + ' bodů</div>'
            + '<div>' + r.line + '</div>'
            + (s.streak >= 2 ? '<div style="margin-top:6px;color:var(--accent,#2f9e74);">Série ' + s.streak + '× po sobě nad 80 bodů.</div>' : '')
            + '<button class="btn btn-primary" id="od-again" style="margin-top:10px;">Další pokus</button>'
            + '</div>';
        modal.querySelector('#od-again').addEventListener('click', start);
        var go = modal.querySelector('#od-go'); if (go) go.disabled = true;
        renderStat();
    }

    function renderStat() {
        var el = modal && modal.querySelector('#od-stat'); if (!el) return;
        var s = load();
        var a10 = avgLast(10);
        var aD = avgLast(10, disc);
        el.innerHTML =
            '<div><b>' + (a10 == null ? '–' : Math.round(a10)) + '</b><span>průměr (10 pokusů)</span></div>'
            + '<div><b>' + (aD == null ? '–' : Math.round(aD)) + '</b><span>v této disciplíně</span></div>'
            + '<div><b>' + (s.bestStreak || 0) + '</b><span>nejlepší série</span></div>';
    }

    function open() {
        styles();
        if (!modal) build();
        modal.style.display = 'flex';
        modal.classList.add('ag-open');
        start();
        if (!tick) tick = setInterval(renderLive, 500);
    }

    function close() {
        if (tick) { clearInterval(tick); tick = null; }
        phase = 'idle'; task = null;
        if (modal) { modal.style.display = 'none'; modal.classList.remove('ag-open'); }
    }

    window.agOpenOdhad = open;
    window.agCloseOdhad = close;

    try {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'odhadovacka', label: 'Odhadni to', icon: ICON, cat: 'Pomůcky', onClick: open });
        }
    } catch (e) { swallow(e, 'register'); }
})();
