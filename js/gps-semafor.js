// ===== AR Geodet — SKÓRE MÍSTA / MULTIPATH SEMAFOR (A3, ODPOJITELNÁ vrstva) ====
// Nejhorší mobilní měření nevznikají špatnou konstelací, ale odrazy signálu od
// fasád a aut (multipath) — chyby v metrech, které průměrování NEodstraní.
// Tenhle modul PŘED měřením spojí, co appka už má, do jednoduchého semaforu:
//   • geometrie družic teď (computeSatPositions/computePDOP ze satelity.js),
//   • elevační maska uživatele z Predikce signálu (sky-obstruction, LS skyObsMask1),
//   • aktuální hlášená přesnost GPS (currentGpsAccuracy z logika.js),
//   • dotaz na okolí (volné nebe / stromy či jedna zeď / mezi budovami),
//   • sken nejbližších 2 h — kdy bude geometrie nejlepší.
// Výstup: 🟢/🟠/🔴 + konkrétní tipy („posuň se 3 m od zdi", „za 40 min lepší
// konstelace"). Vše fail-silent: bez TLE dá verdikt jen z přesnosti a okolí.
//
// Vstupy: dlaždice „Skóre místa (GPS)" v Nástrojích + řádek v Brutální GPS
// (hook AGSemafor.onBrutalOpen, volaný guarded z brutal-gps.js).
// Odstranění: smaž js/gps-semafor.js + řádky v index.html a sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGSemafor) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="20" rx="3"/><circle cx="12" cy="7" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="17" r="1.6"/></svg>';
    var DLG_ID = 'ag-semafor-modal';
    var ENV_KEY = 'agSemaforEnv_v1';   // poslední volba okolí (jen pohodlí, ne pravda)
    var _env = 'volne';                // 'volne' | 'stromy' | 'budovy'
    var _brutalUi = null;

    function mask() {
        var m = 15;
        try { var v = parseInt(localStorage.getItem('skyObsMask1'), 10); if (isFinite(v)) m = v; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-semafor:mask'); }
        return Math.max(0, Math.min(45, m));
    }
    function hasSat() { try { return typeof computeSatPositions === 'function' && typeof computePDOP === 'function'; } catch (e) { return false; } }
    function gpsAcc() { try { return (typeof currentGpsAccuracy === 'number' && currentGpsAccuracy > 0) ? currentGpsAccuracy : null; } catch (e) { return null; } }
    function loadEnv() { try { var v = localStorage.getItem(ENV_KEY); if (v === 'volne' || v === 'stromy' || v === 'budovy') _env = v; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-semafor:loadEnv'); } }
    function saveEnv() { try { localStorage.setItem(ENV_KEY, _env); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-semafor:saveEnv'); } }

    // ---- vyhodnocení ---------------------------------------------------------------
    // vrací {code:'g'|'a'|'r', title, tips:[], detail:{n,pdop,mask,acc,best}}
    function evaluate() {
        var mk = mask(), n = null, pdop = null, best = null;
        if (hasSat()) {
            try {
                if ((typeof tleSats === 'undefined' || !tleSats || !tleSats.length) && typeof loadTleFromCache === 'function') loadTleFromCache();
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-semafor:evaluate'); }
            try {
                var obs = computeSatPositions(new Date()) || [];
                if (obs.length) {
                    var vis = obs.filter(function (o) { return o.el >= mk; });
                    n = vis.length;
                    // DOP počítej jen z družic nad UŽIVATELOVOU maskou (computePDOP si
                    // ještě sám ořízne pod 10°, což vadí jen při masce <10 — zanedbatelné)
                    pdop = computePDOP(vis);
                    // nejlepší geometrie v příštích 2 h (krok 10 min)
                    var now = Date.now();
                    for (var m = 10; m <= 120; m += 10) {
                        var o2 = computeSatPositions(new Date(now + m * 60000)) || [];
                        var v2 = o2.filter(function (o) { return o.el >= mk; });
                        var p2 = computePDOP(v2);
                        if (p2 != null && isFinite(p2) && (best === null || p2 < best.pdop)) best = { min: m, pdop: p2, n: v2.length };
                    }
                }
            } catch (e) { n = null; pdop = null; }
        }
        var acc = gpsAcc();
        var tips = [];

        // základ z geometrie (0 = zelená, 1 = oranžová, 2 = červená)
        var lvl;
        if (n == null) { lvl = 1; tips.push('Bez stažených drah družic hodnotím jen z hlášené přesnosti a okolí — otevři jednou „GNSS satelity" pro plný výpočet.'); }
        else if (n >= 7 && pdop != null && pdop <= 3) lvl = 0;
        else if (n >= 5 && (pdop == null || pdop <= 6)) { lvl = 1; tips.push('Geometrie družic je jen průměrná' + (best && best.pdop != null && pdop != null && best.pdop < pdop - 0.8 ? ' — za ' + best.min + ' min bude výrazně lepší (PDOP ' + best.pdop.toFixed(1) + ').' : '.')); }
        else { lvl = 2; tips.push('Málo družic nad tvou maskou ' + mk + '° (' + (n == null ? '?' : n) + ') — najdi otevřenější místo' + (best ? ' nebo počkej ' + best.min + ' min (PDOP ' + best.pdop.toFixed(1) + ')' : '') + '.'); }

        // okolí (multipath) — fasády jsou metry chyby, průměrování je neodstraní
        if (_env === 'budovy') {
            lvl = 2;
            tips.push('Stojíš u fasády/mezi budovami: odrazy dělají chyby v METRECH. Posuň se aspoň 3–5 m od zdi, ideálně 15 m, nebo bod urči Offsetem/krokovým vektorem z volnějšího místa.');
        } else if (_env === 'stromy') {
            if (lvl < 1) lvl = 1;
            tips.push('Koruny stromů / jedna zeď: signál je tlumený a část odražená — měř déle (10–20 min) a zvaž kampaň „3 návštěvy".');
        }

        // ---- REALITA ZE ZAŘÍZENÍ MÁ POSLEDNÍ SLOVO -----------------------------------
        // ⚠⚠ NAHLÁŠENO 29. 8. 2026: „s přesností ±54 m mi to píše, že je to OK."
        // A byla to pravda: hlášená přesnost uměla skóre zhoršit nejvýš na oranžovou
        // (`if (lvl < 1) lvl = 1`), takže při ±54 m svítilo „Použitelné, ale ne
        // ideální". Jenže družice nad obzorem a hezký PDOP jsou jen PŘEDPOKLAD, kdežto
        // ±54 m je MĚŘENÍ — přijímač už započítal odrazy, rušení i to, že nemá fix ze
        // satelitů. Když se obojí neshoduje, platí měření. Prahy jsou schválně tytéž
        // jako u stavové bubliny (≤5 dobré, ≤15 hraniční), navíc od 30 m je
        // to červená bez debaty: to už není měření polohy, to je odhad z okolních sítí.
        if (acc != null) {
            if (acc > 30) {
                lvl = 2;
                tips.unshift('Telefon hlásí ±' + Math.round(acc) + ' m. To NENÍ satelitní fix — takhle vypadá poloha odhadnutá z wifi a vysílačů. '
                    + 'Ať je geometrie družic jakákoli, tohle je na měření nepoužitelné: jdi pod volné nebe a počkej, až číslo spadne pod 10 m.');
            } else if (acc > 15) {
                if (lvl < 1) lvl = 1;
                tips.unshift('Telefon hlásí ±' + Math.round(acc) + ' m — počkej v klidu na ustálení fixu pod volným nebem, než začneš měřit.');
            } else if (acc > 5 && lvl === 0) {
                lvl = 1;
                tips.unshift('Geometrie družic je dobrá, ale telefon zatím hlásí ±' + Math.round(acc) + ' m. Dej mu ještě půl minuty.');
            }
        } else {
            if (lvl < 1) lvl = 1;
            tips.unshift('Telefon zatím nehlásí žádnou přesnost (není fix) — skóre je jen z předpokladu, ne z měření.');
        }
        if (lvl === 0) tips.push('Dobré podmínky — spusť měření teď. Pro nejlepší výsledek nech telefon ležet aspoň 5–10 min.');

        var code = ['g', 'a', 'r'][lvl];
        // Titulek nese i to ČÍSLO, podle kterého se rozhodlo — bez něj vypadá verdikt
        // jako věštba a uživatel ho nemá s čím porovnat.
        var title = lvl === 0 ? 'Dobré místo i čas na měření'
            : (lvl === 1 ? 'Použitelné, ale ne ideální' : 'Špatné podmínky — takhle neměř');
        if (acc != null) title += ' (±' + Math.round(acc) + ' m)';
        return { code: code, title: title, tips: tips, detail: { n: n, pdop: pdop, mask: mk, acc: acc, best: best }, ts: Date.now() };
    }

    function dot(code, size) {
        var col = code === 'g' ? 'var(--accent,#2f9e74)' : (code === 'a' ? 'var(--warning,#fbbf24)' : 'var(--danger,#fb7185)');
        return '<span style="display:inline-block; width:' + size + 'px; height:' + size + 'px; border-radius:50%; background:' + col + '; box-shadow:0 0 ' + Math.round(size * 0.8) + 'px ' + col + '; vertical-align:middle;"></span>';
    }

    // ---- modal ----------------------------------------------------------------------
    function ensureModal() {
        if (document.getElementById(DLG_ID)) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = DLG_ID;
        el.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent); margin-top:0; margin-bottom:5px;">' + ICON + ' Skóre místa (GPS)</h3>'
            + '<p style="margin:0 0 10px; font-size:calc(12.5px * var(--ag-font-scale, 1)); opacity:0.8;">Odpovídá na jedinou otázku: <b>vyplatí se tady a teď měřit?</b> Skládá se ze čtyř věcí — kolik družic je nad tvým obzorem, jak jsou po obloze rozházené (PDOP), co máš kolem sebe (chipy níž) a hlavně <b>jakou přesnost telefon právě hlásí</b>. Ta poslední rozhoduje: je to jediné skutečné měření, zbytek je předpoklad.</p>'
            + '<div class="modal-body" id="ag-semafor-body"></div>'
            + '<button class="btn btn-secondary" style="margin-top:15px;" id="ag-semafor-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        el.querySelector('#ag-semafor-close').addEventListener('click', function () { el.style.display = 'none'; });
        el.addEventListener('mousedown', function (e) { if (e.target === el) el.style.display = 'none'; });
    }
    function envChip(id, label) {
        var on = _env === id;
        return '<button type="button" class="btn btn-secondary ag-sem-env" data-env="' + id + '" style="flex:1; font-size:calc(12px * var(--ag-font-scale, 1)); padding:8px 4px;'
            + (on ? ' outline:2px solid var(--accent,#2f9e74); font-weight:700;' : ' opacity:.75;') + '">' + label + '</button>';
    }
    function renderModal() {
        var body = document.getElementById('ag-semafor-body');
        if (!body) return;
        var r = evaluate();
        window.AGSemafor.last = r;
        var d = r.detail;
        var html = '<div style="display:flex; align-items:center; gap:12px; margin:4px 0 10px;">' + dot(r.code, 22)
            + '<b style="font-size:calc(15px * var(--ag-font-scale, 1));">' + r.title + '</b></div>';
        html += '<div style="display:flex; gap:6px; margin:0 0 10px;">'
            + envChip('volne', 'Volné nebe') + envChip('stromy', 'Stromy / 1 zeď') + envChip('budovy', 'Mezi budovami')
            + '</div>';
        html += '<div class="geo-data-row" style="padding:4px 0;"><span class="geo-label">Družice nad maskou ' + d.mask + '°</span><span class="geo-value">' + (d.n == null ? '–' : d.n) + '</span></div>';
        html += '<div class="geo-data-row" style="padding:4px 0;"><span class="geo-label">Geometrie (PDOP)</span><span class="geo-value">' + (d.pdop == null ? '–' : d.pdop.toFixed(1)) + '</span></div>';
        html += '<div class="geo-data-row" style="padding:4px 0;"><span class="geo-label">Telefon hlásí</span><span class="geo-value">' + (d.acc == null ? '–' : '±' + Math.round(d.acc) + ' m') + '</span></div>';
        if (d.best) html += '<div class="geo-data-row" style="padding:4px 0;"><span class="geo-label">Nejlepší geometrie do 2 h</span><span class="geo-value">za ' + d.best.min + ' min (PDOP ' + d.best.pdop.toFixed(1) + ')</span></div>';
        html += r.tips.map(function (t) { return '<p style="font-size:calc(12.5px * var(--ag-font-scale, 1)); margin:8px 0 0;">• ' + t + '</p>'; }).join('');
        html += '<p style="font-size:calc(11px * var(--ag-font-scale, 1)); opacity:.55; margin:10px 0 0;">'
            + '<b>Jak se to čte:</b> zelená = přesnost do 5 m a slušná geometrie, oranžová = do 15 m nebo stíněné okolí, '
            + 'červená = nad 15 m, málo družic, nebo stojíš mezi fasádami. Nad 30 m je to vždycky červená — tak vypadá '
            + 'poloha odhadnutá z wifi, ne ze satelitů. Prahy jsou stejné jako u stavové bubliny, '
            + 'ať si ukazatele neodporují. Elevační masku (kolik zaclání horizont) nastavíš v nástroji „Predikce signálu".</p>';
        body.innerHTML = html;
        var chips = body.querySelectorAll('.ag-sem-env');
        for (var i = 0; i < chips.length; i++) {
            chips[i].addEventListener('click', function () { _env = this.getAttribute('data-env'); saveEnv(); renderModal(); refreshRow(); });
        }
        refreshRow();
    }
    function openModal() {
        loadEnv(); ensureModal();
        document.getElementById(DLG_ID).style.display = 'flex';
        renderModal();
    }

    // ---- řádek v Brutální GPS ----------------------------------------------------------
    function refreshRow() {
        if (!_brutalUi) return;
        var row = _brutalUi.querySelector('#bgps-semafor');
        if (!row) {
            row = document.createElement('div');
            row.id = 'bgps-semafor';
            row.className = 'bgps-card amber';
            row.style.cursor = 'pointer';
            row.addEventListener('click', openModal);
            var anchor = _brutalUi.querySelector('.bgps-sub');
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(row, anchor.nextSibling);
            else _brutalUi.appendChild(row);
        }
        var r = window.AGSemafor.last;
        if (r && Date.now() - r.ts < 10 * 60000) {
            row.innerHTML = dot(r.code, 12) + ' <b>Skóre místa:</b> ' + r.title + ' <span style="opacity:.7;">(detail klepnutím)</span>';
        } else {
            row.innerHTML = dot('a', 12) + ' <b>Skóre místa:</b> vyhodnotit před startem <span style="opacity:.7;">(klepni)</span>';
        }
    }
    function onBrutalOpen(ui) { _brutalUi = ui; loadEnv(); refreshRow(); }

    // ---- registrace ----------------------------------------------------------------------
    window.AGSemafor = { open: openModal, onBrutalOpen: onBrutalOpen, last: null };
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'gps-semafor', label: 'Skóre místa (GPS)', icon: ICON, cat: 'Měření', onClick: openModal, order: 6 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
