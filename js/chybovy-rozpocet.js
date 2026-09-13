// ===== QTRIG — „PROČ ±4 m?" / CHYBOVÝ ROZPOČET (ODPOJITELNÁ vrstva) ===========
// Neinvazivní. NEEDITUJE logika.js ani grafika.js — jen čte globály
// (currentGpsAccuracy, window.AGFix, window.AGCompassStability, arPoints,
// userLat/userLng, getDistance) a otevírá vlastní modal.
//
// PROČ (hodnocení pro studenty, 13. 9. 2026): appka celou dobu ZNÁ přesnost GPS,
// stabilitu kompasu i vzdálenost k bodu — a nikde neřekne, co to DOHROMADY dělá
// s bodem, který ukazuje v AR. Student vidí „±4,0 m" v pilulce a myslí si, že
// značka v kameře je ±4 m. Není: na 50 m k tomu kompas s ±3° přidá 2,6 m napříč
// a dohromady je to ±4,8 m. Tahle obrazovka to ukáže jako ROZPOČET: každý zdroj
// chyby zvlášť, sečtený podle zákona hromadění chyb, s obrázkem elipsy a s tím,
// co s tím jde udělat. Je to nejpoctivější věta, kterou appka o sobě umí říct,
// a zároveň lekce o šíření chyb, kterou student jinak dostane až u tabule.
//
// CO SE POČÍTÁ (všechno jako střední chyby, 68 %):
//   σ_GPS      = přesnost polohy z čipu (currentGpsAccuracy), případně stř. chyba
//                průměru z Přesné GPS (AGFix.sterr), když běží průměrování
//   σ_kompas   = ±1° po srovnání severu podle bodu (agCalibInfo), jinak z rozptylu
//                kompasu (AGCompassStability.spread), jinak výchozích ±5°
//   σ_napříč   = d · sin σ_kompas          (chyba směru se s dálkou roste lineárně)
//   σ_bod      = √(σ_GPS² + σ_napříč²)     (zákon hromadění chyb, nezávislé zdroje)
//   σ_výška    ≈ 1,5 · σ_GPS               (výška z GPS je vždy horší než poloha)
// Posuvníky vzdálenosti a chyby kompasu jsou ŽIVÉ: student si zkusí „co kdyby" —
// co udělá srovnání severu, co přiblížení na 10 m. Skutečné hodnoty ze senzorů
// se předvyplní a tlačítkem „Ze senzorů" se kdykoli vrátí.
//
// Vstupy: dlaždice „Proč ±4 m?" (Nástroje → Signál GNSS), tlačítko „Proč ±?"
// v rozbalené stavové bublině (js/stavovy-pruh.js). API: window.agOpenChybovyRozpocet().
// Odstranění: smaž js/chybovy-rozpocet.js + řádek <script> v index.html, záznam
// 'chybovy-rozpocet' v js/tools-registry.js, text v data/navody.json, tlačítko
// v js/stavovy-pruh.js (hledej „chybovy") a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGChybovyRozpocet) return;

    var ID = 'ag-cr-modal', STYLE_ID = 'ag-cr-style';
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>';
    var DEG = Math.PI / 180;

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'chybovy-rozpocet:' + kde); } catch (x) { } }
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function g(name) { try { return (0, eval)('typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined'); } catch (e) { return undefined; } }
    function num(v, d) { return (+v).toFixed(d == null ? 1 : d).replace('.', ','); }

    // ---- co říkají senzory ---------------------------------------------------------------
    function senzory() {
        var acc = g('currentGpsAccuracy');
        var fix = window.AGFix || null;
        var gps = (acc && acc > 0) ? +acc : null;
        var prumer = null;
        if (fix && fix.n >= 2 && fix.sterr > 0 && !fix.manual && !fix.coarse) prumer = +fix.sterr;
        var cal = null;
        try { cal = JSON.parse(localStorage.getItem('agCalibInfo')); } catch (e) { cal = null; }
        var spread = null;
        try { spread = window.AGCompassStability ? window.AGCompassStability.spread : null; } catch (e) { spread = null; }
        var kompas, kompasZdroj;
        if (cal && cal.ts && (Date.now() - cal.ts) < 30 * 60 * 1000) { kompas = 1; kompasZdroj = t('sever srovnaný podle bodu'); }
        else if (spread != null && spread > 0) { kompas = Math.max(1, Math.min(15, spread)); kompasZdroj = t('rozptyl kompasu za posledních pár sekund'); }
        else { kompas = 5; kompasZdroj = t('kompas telefonu bez srovnání (typicky ±5°)'); }
        // nejbližší viditelný bod = vzdálenost, se kterou student právě pracuje
        var d = null, dNazev = null;
        try {
            var lat = g('userLat'), lng = g('userLng'), pts = g('arPoints');
            if (lat != null && lng != null && pts && pts.length && typeof getDistance === 'function') {
                var best = null;
                for (var i = 0; i < pts.length; i++) {
                    var p = pts[i]; if (!p || p.hidden || p.lat == null) continue;
                    var dd = getDistance(lat, lng, p.lat, p.lng);
                    if (dd > 2 && (best == null || dd < best.d)) best = { d: dd, n: p.name };
                }
                if (best) { d = best.d; dNazev = best.n; }
            }
        } catch (e) { swallow(e, 'nejblizsi'); }
        return { gps: gps, prumer: prumer, kompas: kompas, kompasZdroj: kompasZdroj, d: d, dNazev: dNazev, cal: !!(cal && cal.ts) };
    }

    // ---- rozpočet ----------------------------------------------------------------------------
    function rozpocet(gps, kompasDeg, d) {
        var napric = d * Math.sin(kompasDeg * DEG);
        var bod = Math.sqrt(gps * gps + napric * napric);
        return { gps: gps, kompas: kompasDeg, d: d, napric: napric, bod: bod, vyska: 1.5 * gps };
    }

    // ---- kresba: elipsa nejistoty bodu v AR ---------------------------------------------------
    // Pohled shora: ty dole, bod nahoře ve vzdálenosti d. Kruh kolem tebe = σ_GPS
    // (poloha), klín od tebe k bodu = σ_kompas, elipsa u bodu = výsledek: podél
    // záměry σ_GPS, napříč √(σ_GPS² + σ_napříč²).
    function kresba(r) {
        var W = 300, H = 230, cx = 150, yTy = 200, yBod = 40;
        var px = (yTy - yBod) / Math.max(r.d, 1);          // px na metr podél záměry
        var scale = Math.min(px, 60, 120 / Math.max(r.bod, r.gps, 0.1));   // ať kruh ani elipsa nevylezou z obrázku
        var rg = Math.max(3, r.gps * scale);
        var ry = Math.max(3, r.gps * scale), rx = Math.max(3, r.bod * scale);
        var wedge = Math.tan(r.kompas * DEG) * (yTy - yBod);
        var col = 'var(--accent,#2f9e74)', warn = 'var(--warning,#fbbf24)', mut = 'var(--text-muted,#9aa1ac)';
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="cr-svg" role="img" aria-label="' + t('Elipsa nejistoty bodu') + '">'
            + '<line x1="' + cx + '" y1="' + yTy + '" x2="' + cx + '" y2="' + yBod + '" stroke="' + mut + '" stroke-dasharray="4 4"/>'
            + '<polygon points="' + cx + ',' + yTy + ' ' + (cx - wedge) + ',' + yBod + ' ' + (cx + wedge) + ',' + yBod + '" fill="' + warn + '" fill-opacity="0.13" stroke="' + warn + '" stroke-opacity="0.6"/>'
            + '<circle cx="' + cx + '" cy="' + yTy + '" r="' + rg + '" fill="' + col + '" fill-opacity="0.18" stroke="' + col + '"/>'
            + '<circle cx="' + cx + '" cy="' + yTy + '" r="3" fill="' + col + '"/>'
            + '<ellipse cx="' + cx + '" cy="' + yBod + '" rx="' + rx + '" ry="' + ry + '" fill="var(--danger,#fb7185)" fill-opacity="0.18" stroke="var(--danger,#fb7185)"/>'
            + '<circle cx="' + cx + '" cy="' + yBod + '" r="3" fill="var(--danger,#fb7185)"/>'
            + '<text x="' + (cx + rg + 6) + '" y="' + (yTy + 4) + '" class="cr-lbl">' + t('ty') + ' ±' + num(r.gps) + ' m</text>'
            + '<text x="' + (cx + rx + 6) + '" y="' + (yBod + 4) + '" class="cr-lbl">' + t('bod') + ' ±' + num(r.bod) + ' m</text>'
            + '<text x="' + (cx + 8) + '" y="' + ((yTy + yBod) / 2) + '" class="cr-lbl cr-warn">±' + num(r.kompas, 0) + '°</text>'
            + '<text x="' + (cx - 8) + '" y="' + ((yTy + yBod) / 2) + '" class="cr-lbl" text-anchor="end">' + num(r.d, 0) + ' m</text>'
            + '</svg>';
    }

    // ---- UI ----------------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style'); st.id = STYLE_ID;
        st.textContent = [
            '#' + ID + ' .cr-big{font-size:calc(30px * var(--ag-font-scale,1));font-weight:800;line-height:1;margin:2px 0 4px;font-variant-numeric:tabular-nums;}',
            '#' + ID + ' .cr-big small{font-size:calc(13px * var(--ag-font-scale,1));font-weight:500;color:var(--text-muted,#9aa1ac);}',
            '#' + ID + ' .cr-svg{width:100%;max-width:340px;display:block;margin:6px auto;}',
            '#' + ID + ' .cr-lbl{font-size:11px;fill:var(--text-color,#eceef2);}',
            '#' + ID + ' .cr-warn{fill:var(--warning,#fbbf24);}',
            '#' + ID + ' .cr-list{margin:8px 0 0;padding-left:20px;font-size:calc(13px * var(--ag-font-scale,1));}',
            '#' + ID + ' .cr-list li{margin:6px 0;line-height:1.4;}',
            '#' + ID + ' .cr-v{font-family:var(--font-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;display:block;color:var(--accent,#2f9e74);}',
            '#' + ID + ' .cr-src{font-size:calc(12px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);}',
            '#' + ID + ' .cr-sl{margin-top:10px;}',
            '#' + ID + ' .cr-sl label{display:flex;justify-content:space-between;font-size:calc(13px * var(--ag-font-scale,1));margin-bottom:2px;}',
            '#' + ID + ' .cr-sl input[type=range]{width:100%;}',
            '#' + ID + ' .cr-tip{margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(47,158,116,0.12);font-size:calc(13px * var(--ag-font-scale,1));line-height:1.45;}',
            '#' + ID + ' .cr-btns{display:flex;gap:8px;margin-top:14px;}',
            '#' + ID + ' .cr-btns .btn{flex:1;margin:0;}'
        ].join('\n');
        document.head.appendChild(st);
    }
    function build() {
        var m = document.getElementById(ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = ID;
        m.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;display:flex;align-items:center;gap:8px;"><span style="width:22px;height:22px;display:inline-block;">' + ICON + '</span> ' + t('Proč ±4 m?') + '</h3>'
            + '<div class="modal-body" id="ag-cr-body"></div>'
            + '<div class="cr-btns"><button type="button" class="btn btn-secondary" id="ag-cr-sens">' + t('Ze senzorů') + '</button><button type="button" class="btn btn-secondary" id="ag-cr-close">' + t('Zavřít') + '</button></div>'
            + '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-cr-close').addEventListener('click', close);
        m.querySelector('#ag-cr-sens').addEventListener('click', render);
        m.addEventListener('input', function (e) {
            if (!e.target || !e.target.matches('input[type=range]')) return;
            if (!_stav) return;
            if (e.target.id === 'ag-cr-d') _stav.d = +e.target.value;
            if (e.target.id === 'ag-cr-k') _stav.kompas = +e.target.value;
            if (e.target.id === 'ag-cr-g') _stav.gps = +e.target.value / 10;
            refresh();
        });
        return m;
    }

    var _stav = null;   // {gps, kompas, d, zdroj:{...}} — null = načíst ze senzorů
    // Posuvníky se vykreslí JEDNOU (render); tahání za ně přepisuje jen výstup
    // (refresh) — kdyby se přepisoval celý panel, prst by při tahu ztratil jezdec.
    function render() {
        var body = document.getElementById('ag-cr-body'); if (!body) return;
        var s = senzory();
        _stav = { gps: s.prumer || s.gps || 4, kompas: s.kompas, d: s.d ? Math.min(300, Math.max(5, s.d)) : 50, zdroj: s };
        body.innerHTML = '<div id="ag-cr-out"></div>'
            + '<div class="cr-sl"><label><span>' + t('Vzdálenost k bodu') + '</span><b id="ag-cr-d-v"></b></label><input type="range" id="ag-cr-d" min="5" max="300" step="5" value="' + Math.round(_stav.d) + '"></div>'
            + '<div class="cr-sl"><label><span>' + t('Chyba kompasu') + '</span><b id="ag-cr-k-v"></b></label><input type="range" id="ag-cr-k" min="1" max="15" step="1" value="' + Math.round(_stav.kompas) + '"></div>'
            + '<div class="cr-sl"><label><span>' + t('Přesnost GPS') + '</span><b id="ag-cr-g-v"></b></label><input type="range" id="ag-cr-g" min="3" max="150" step="1" value="' + Math.round(_stav.gps * 10) + '"></div>'
            + '<div class="cr-tip" id="ag-cr-tip"></div>';
        refresh();
    }
    function refresh() {
        var out = document.getElementById('ag-cr-out'); if (!out || !_stav) return;
        var r = rozpocet(_stav.gps, _stav.kompas, _stav.d);
        var z = _stav.zdroj;
        var gpsZdroj = z.prumer ? t('stř. chyba průměru z Přesné GPS') : (z.gps ? t('přesnost z GPS čipu (68 %)') : t('GPS zatím nemá fix — odhad'));
        var dZdroj = z.dNazev ? (t('nejbližší bod') + ' ' + z.dNazev) : t('žádný bod v okolí — zvol vzdálenost');
        var tip;
        if (r.napric > r.gps) tip = t('Největší kus chyby dělá kompas. Srovnej sever podle známého bodu (±1°) — na') + ' ' + num(r.d, 0) + ' m ' + t('to sníží chybu napříč na') + ' ±' + num(r.d * Math.sin(1 * DEG)) + ' m.';
        else if (r.gps > 2) tip = t('Největší kus chyby dělá GPS. Zapni Přesnou GPS (průměrování s otočením) a počkej na volnou oblohu — nebo se k bodu přibliž a najdi ho očima.');
        else tip = t('Rozpočet je slušný. Pamatuj, že je to ±1σ: v jednom případě ze tří je bod ještě dál.');
        out.innerHTML = '<div class="cr-big">±' + num(r.bod) + ' m <small>' + t('tak daleko od značky v AR může bod skutečně být (1σ)') + '</small></div>'
            + kresba(r)
            + '<ol class="cr-list">'
            + '<li>' + t('Poloha z GPS') + ' — σ<sub>GPS</sub><span class="cr-v">±' + num(r.gps) + ' m</span><span class="cr-src">' + gpsZdroj + '</span></li>'
            + '<li>' + t('Směr z kompasu') + ' — σ<sub>k</sub> = ±' + num(r.kompas, 0) + '°, ' + t('na vzdálenost') + ' d = ' + num(r.d, 0) + ' m ' + t('udělá napříč') + ' d · sin σ<sub>k</sub><span class="cr-v">' + num(r.d, 0) + ' · sin ' + num(r.kompas, 0) + '° = ±' + num(r.napric) + ' m</span><span class="cr-src">' + z.kompasZdroj + ' · ' + dZdroj + '</span></li>'
            + '<li>' + t('Zákon hromadění chyb (nezávislé zdroje se sčítají pod odmocninou)') + ': σ<sub>bod</sub> = √(σ<sub>GPS</sub>² + σ<sub>napříč</sub>²)<span class="cr-v">√(' + num(r.gps) + '² + ' + num(r.napric) + '²) = ±' + num(r.bod) + ' m</span></li>'
            + '<li>' + t('Výška z GPS bývá ~1,5× horší než poloha') + '<span class="cr-v">σ<sub>Z</sub> ≈ ±' + num(r.vyska) + ' m</span></li>'
            + '</ol>';
        var e;
        if ((e = document.getElementById('ag-cr-d-v'))) e.textContent = num(r.d, 0) + ' m';
        if ((e = document.getElementById('ag-cr-k-v'))) e.textContent = '±' + num(r.kompas, 0) + '°';
        if ((e = document.getElementById('ag-cr-g-v'))) e.textContent = '±' + num(r.gps) + ' m';
        if ((e = document.getElementById('ag-cr-tip'))) e.innerHTML = tip;
    }
    function open() { var m = build(); m.style.display = 'flex'; render(); }
    function close() { var m = document.getElementById(ID); if (m) m.style.display = 'none'; }

    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'chybovy-rozpocet', label: t('Proč ±4 m?'), icon: ICON, cat: 'Měření', onClick: open, order: 7 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });

    window.agOpenChybovyRozpocet = open;
    window.AGChybovyRozpocet = { open: open, close: close, rozpocet: rozpocet, senzory: senzory };
})();
