// ===== QTRIG — HLÍDAČ OKOLÍ: „stojíš u budovy / pod stromy / u kolejí" (ODPOJITELNÁ, ag/lazy) ===
// (16. 9. 2026, fáze 3 „chytrý terén" — B2; viz paměť project-vlastni-mapa-svet-vyber-16-9)
//
// Telefonní GPS má jinou chybu na volném poli a jinou 2 m od zdi (odrazy, půl nebe zakryté).
// Tenhle modul to říká NAHLAS, dokud je čas něco udělat — ne až po špatném zápisu:
//   • u budovy do 4 m → „GPS bude mít odrazy, počítej s ±6 m; odstup 10 m, nebo krokový offset"
//   • uvnitř budovy podle mapy → „poloha uvnitř budovy — GPS tu neplatí"
//   • pod stromy (les z mapy) → „příjem slabší, měř déle (průměrování)"
//   • u kolejí do 6 m → bezpečnost + odrazy od drátů
//   • u ručně označené PŘEKÁŽKY (hromada materiálu, výkop, bagr — to v žádné mapě není;
//     označíš ji dvěma klepnutími v mapě: tlačítko „Překážka" v panelu Vrstvy → Nástroje mapy)
// Data: js/hrany.js (budovy z vektorové mapy), AGMapaVektor.plochy (les) a cary (koleje).
//
// CO DĚLÁ: pilulka pod stavovým řádkem (#ag-okoli-pill) se stavem; hláška při ZMĚNĚ situace
// (jednou za 60 s na druh), a k novému bodu zapíše prov.okoli („2,1 m od budovy"), takže
// QC inspektor a karta bodu vědí, za jakých podmínek bod vznikl. Překážky používá i trasa
// terénem (B1, obchází je) a mapa kvality GPS (P3, stíní jako 3 m).
// Nastavení → AR & přesnost → „Hlídač okolí". Odstranění: smaž js/hlidac-okoli.js + <script>
// v index.html + řádek v grafika.js map.on('click') (AGOkoli.armed); gen_sw_assets --bump.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGOkoli) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'hlidac-okoli:' + kde); } catch (e2) { /* nic */ } };
    var KEY = 'agOkoli_v1', KEY_PREK = 'agPrekazky', PILL = 'ag-okoli-pill';
    var LIMIT = { budova: 4, koleje: 6, prekazka: 3 };
    var st = { zap: true };
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.zap != null) st.zap = !!s.zap; } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }

    var _stav = null, _tik = null, _hlasky = {}, _grp = null;
    var prekazky = [];             // [{a:{lat,lng}, b:{lat,lng}, nazev, ts}] — obdélníky, per zakázka
    function poloha() { try { return (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng } : null; } catch (e) { return null; } }
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function fmt(x) { return x.toFixed(1).replace('.', ','); }

    // ---- překážky (ruční) ------------------------------------------------------------------
    function nactiPrekazky() { try { var s = (typeof getStoredData === 'function') ? getStoredData(KEY_PREK) : null; prekazky = s ? JSON.parse(s) : []; if (!Array.isArray(prekazky)) prekazky = []; } catch (e) { prekazky = []; } }
    function ulozPrekazky() { try { if (typeof setStoredData === 'function') setStoredData(KEY_PREK, JSON.stringify(prekazky)); } catch (e) { swallow(e, 'prekazky'); } }
    function prekazkaRings(p) { var s = Math.min(p.a.lat, p.b.lat), n = Math.max(p.a.lat, p.b.lat), w = Math.min(p.a.lng, p.b.lng), e = Math.max(p.a.lng, p.b.lng); return [[{ lat: s, lng: w }, { lat: s, lng: e }, { lat: n, lng: e }, { lat: n, lng: w }, { lat: s, lng: w }]]; }
    function vPrekazce(lat, lng) { for (var i = 0; i < prekazky.length; i++) { var p = prekazky[i]; if (lat >= Math.min(p.a.lat, p.b.lat) && lat <= Math.max(p.a.lat, p.b.lat) && lng >= Math.min(p.a.lng, p.b.lng) && lng <= Math.max(p.a.lng, p.b.lng)) return p; } return null; }
    function kPrekazce(lat, lng) {
        var best = null;
        prekazky.forEach(function (p) { var ring = prekazkaRings(p)[0]; for (var i = 0; i + 1 < ring.length; i++) { var q = AGHrany.prumet(ring[i], ring[i + 1], { lat: lat, lng: lng }); if (q && (!best || q.d < best.d)) best = { d: q.d, p: p }; } });
        return best;
    }
    function kresliPrekazky() {
        var m = getMap(); if (!m) return;
        if (!_grp) _grp = L.layerGroup().addTo(m);
        _grp.clearLayers();
        try { AG.style('ag-prekazka-style', ['.ag-prek-tip{background:rgba(255,255,255,.95);border:1.5px solid #333;border-radius:999px;padding:2px 8px 2px 3px;color:#111;font:700 11px/1.2 var(--font-ui,system-ui),sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.35);white-space:nowrap;}',
            '.ag-prek-tip::before{display:none;}', '.ag-prek-tip i{display:inline-flex;width:16px;height:16px;border-radius:50%;align-items:center;justify-content:center;font:800 10px/1 sans-serif;font-style:normal;color:#111;margin-right:4px;vertical-align:-3px;}'].join('\n')); } catch (e) { swallow(e, 'css'); }
        var esc = function (s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s); };
        prekazky.forEach(function (p, i) {
            var d = druh(p), sir = AGHrany ? AGHrany.dist({ lat: p.a.lat, lng: p.a.lng }, { lat: p.a.lat, lng: p.b.lng }) : 0, vys = AGHrany ? AGHrany.dist({ lat: p.a.lat, lng: p.a.lng }, { lat: p.b.lat, lng: p.a.lng }) : 0;
            // rámeček + šrafování (dvě vrstvy: plná výplň slabě, čárkovaný rám sytě) + popisek uprostřed
            var r = L.rectangle([[p.a.lat, p.a.lng], [p.b.lat, p.b.lng]], { color: d.col, weight: 3, dashArray: '8,5', fillColor: d.col, fillOpacity: 0.28, interactive: true, bubblingMouseEvents: false });
            r.bindTooltip('<i style="background:' + d.col + '">' + d.zn + '</i>' + esc(p.nazev), { permanent: true, direction: 'center', className: 'ag-prek-tip' });
            r.bindPopup('<b>' + esc(p.nazev) + '</b><br><small>' + d.n + ' · ' + sir.toFixed(0) + ' × ' + vys.toFixed(0) + ' m · ruční překážka: trasa terénem ji obchází, hlídač před ní varuje, stíní GPS jako 3 m</small><br>'
                + '<button type="button" class="btn btn-secondary" style="margin-top:6px" onclick="AGOkoli.prejmenuj(' + i + ')">Přejmenovat</button> '
                + '<button type="button" class="btn btn-secondary" style="margin-top:6px" onclick="AGOkoli.smazPrekazku(' + i + ')">Smazat</button>');
            r.addTo(_grp);
        });
    }
    // DRUHY PŘEKÁŽEK (17. 9. 2026, hlášení „překážku v mapě lépe zpracuj, ať je jasnější, o co
    // jde"): každá má barvu, značku a popisek přímo v mapě; vybírá se PŘED kreslením.
    var DRUHY = {
        hromada: { n: 'Hromada materiálu', col: '#f97316', zn: 'H' },
        vykop: { n: 'Výkop / jáma', col: '#dc2626', zn: 'V' },
        stroj: { n: 'Stroj / bagr', col: '#eab308', zn: 'S' },
        plot: { n: 'Plot / ohrada', col: '#7c3aed', zn: 'P' },
        voda: { n: 'Voda / bláto', col: '#2563eb', zn: '~' },
        sklad: { n: 'Sklad / kontejner', col: '#78716c', zn: 'K' },
        jine: { n: 'Jiná překážka', col: '#f97316', zn: '!' }
    };
    function druh(p) { return DRUHY[p && p.druh] || (p && /výkop|vykop|jáma/i.test(p.nazev) ? DRUHY.vykop : p && /stroj|bagr/i.test(p.nazev) ? DRUHY.stroj : DRUHY.hromada); }
    // dvě klepnutí do mapy = obdélník
    var _sber = null;
    function kresliNovou(nazev, druhKlic) {
        if (!druhKlic && !nazev) return vyberDruh();
        var d = DRUHY[druhKlic] || DRUHY[nazev] || druh({ nazev: nazev });
        _sber = { nazev: (nazev && !DRUHY[nazev]) ? nazev : d.n, druh: druhKlic || (DRUHY[nazev] ? nazev : Object.keys(DRUHY).filter(function (k) { return DRUHY[k] === d; })[0] || 'jine'), body: [] };
        AGOkoli.armed = true;
        try { window.agInfo && window.agInfo(d.n + ': klepni do mapy na dva protější rohy.'); } catch (e) { /* nic */ }
    }
    function vyberDruh(nazev) {
        var id = 'ag-prekazka-vyber', old = document.getElementById(id); if (old) old.remove();
        try { AG.style('ag-prekazka-vyber-style', ['#' + id + '{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 90px);z-index:12000;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:94vw;padding:10px;border-radius:14px;background:rgba(20,24,28,.94);border:1px solid rgba(255,255,255,.18);box-shadow:0 6px 20px rgba(0,0,0,.5);}',
            '#' + id + ' b{flex:1 0 100%;text-align:center;color:#fff;font:600 13px/1.3 var(--font-ui,system-ui),sans-serif;margin-bottom:2px;}',
            '#' + id + ' button{border:0;border-radius:999px;padding:8px 12px;color:#fff;font:600 12px/1.2 var(--font-ui,system-ui),sans-serif;display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.1);}',
            '#' + id + ' button i{display:inline-flex;width:18px;height:18px;border-radius:50%;align-items:center;justify-content:center;font:800 11px/1 sans-serif;font-style:normal;color:#111;}',
            '#' + id + ' button.z{background:transparent;color:#aaa;}'].join('\n')); } catch (e) { swallow(e, 'css'); }
        var box = document.createElement('div'); box.id = id; box.setAttribute('role', 'dialog');
        var h = '<b>Co je to za překážku?</b>';
        Object.keys(DRUHY).forEach(function (k) { h += '<button type="button" data-d="' + k + '"><i style="background:' + DRUHY[k].col + '">' + DRUHY[k].zn + '</i>' + DRUHY[k].n + '</button>'; });
        h += '<button type="button" class="z" data-d="">Zrušit</button>';
        box.innerHTML = h;
        box.addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; box.remove(); var k = b.getAttribute('data-d'); if (k) kresliNovou(nazev && nazev !== 'Překážka' && !DRUHY[nazev] ? nazev : null, k); });
        document.body.appendChild(box);
    }
    function take(lat, lng) {
        if (!_sber) { AGOkoli.armed = false; return; }
        _sber.body.push({ lat: lat, lng: lng });
        if (_sber.body.length < 2) { try { window.agInfo && window.agInfo('První roh mám. Teď protější.'); } catch (e) { /* nic */ } return; }
        prekazky.push({ a: _sber.body[0], b: _sber.body[1], nazev: _sber.nazev, druh: _sber.druh, ts: Date.now() });
        _sber = null; AGOkoli.armed = false;
        ulozPrekazky(); kresliPrekazky();
        try { window.agInfo && window.agInfo('Překážka uložena. Trasa terénem ji obejde, hlídač před ní varuje.'); } catch (e) { /* nic */ }
        try { document.dispatchEvent(new CustomEvent('ag:prekazky')); } catch (e) { /* nic */ }
    }
    function prejmenuj(i) {
        var p = prekazky[i]; if (!p) return;
        var pr = (typeof window.agPrompt === 'function') ? window.agPrompt({ title: 'Název překážky', value: p.nazev, okText: 'Uložit' }) : Promise.resolve(prompt('Název překážky:', p.nazev));
        pr.then(function (v) { if (v) { p.nazev = v; ulozPrekazky(); kresliPrekazky(); try { getMap().closePopup(); } catch (e) { /* nic */ } } });
    }
    function smazPrekazku(i) { prekazky.splice(i, 1); ulozPrekazky(); kresliPrekazky(); try { getMap().closePopup(); } catch (e) { /* nic */ } try { document.dispatchEvent(new CustomEvent('ag:prekazky')); } catch (e) { /* nic */ } }

    // ---- vyhodnocení okolí -------------------------------------------------------------------
    function bodVPolygonu(ring, lat, lng) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var yi = ring[i].lat, xi = ring[i].lng, yj = ring[j].lat, xj = ring[j].lng;
            if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }
    function vyhodnot(lat, lng) {
        var out = { budova: null, uvnitr: null, les: false, koleje: null, prekazka: null, prekazkaUvnitr: null };
        if (!window.AGHrany) return out;
        try {
            var bud = AGHrany.budovyPolygony(lat, lng, 25);
            for (var i = 0; i < bud.length; i++) { if (bodVPolygonu(bud[i].rings[0], lat, lng)) { out.uvnitr = bud[i].popis; break; } }
            var h = AGHrany.nejblizsiHrana(lat, lng, LIMIT.budova, AGHrany.sber(lat, lng, 30).hrany.filter(function (x) { return x.zdroj === 'budova'; }));
            if (h) out.budova = { d: h.d, popis: h.popis };
        } catch (e) { swallow(e, 'budovy'); }
        try {
            if (window.AGMapaVektor && AGMapaVektor.plochy) { var les = AGMapaVektor.plochy(['landcover', 'landuse'], ['forest', 'wood']); for (var k = 0; k < les.length && !out.les; k++) if (les[k][0] && bodVPolygonu(les[k][0], lat, lng)) out.les = true; }
        } catch (e) { swallow(e, 'les'); }
        try {
            if (window.AGMapaVektor && AGMapaVektor.cary) {
                var kol = AGMapaVektor.cary('roads', ['rail']), best = null, p = { lat: lat, lng: lng };
                kol.forEach(function (line) { for (var i = 0; i + 1 < line.length; i++) { var q = AGHrany.prumet(line[i], line[i + 1], p); if (q && q.d <= LIMIT.koleje && (!best || q.d < best)) best = q.d; } });
                if (best != null) out.koleje = best;
            }
        } catch (e) { swallow(e, 'koleje'); }
        try { var pu = vPrekazce(lat, lng); if (pu) out.prekazkaUvnitr = pu.nazev; else { var kp = kPrekazce(lat, lng); if (kp && kp.d <= LIMIT.prekazka) out.prekazka = { d: kp.d, nazev: kp.p.nazev }; } } catch (e) { swallow(e, 'prekazka'); }
        return out;
    }
    // shrnutí do jednoho stavu: { kod, text, trida, rada }
    function shrn(o) {
        if (o.uvnitr) return { kod: 'uvnitr', trida: 'bad', text: 'Podle mapy stojíš uvnitř budovy (' + o.uvnitr + ') — GPS tu neplatí', rada: 'Bod ulož až venku, nebo použij krokový offset od rohu.' };
        if (o.prekazkaUvnitr) return { kod: 'prekazka-in', trida: 'bad', text: 'Stojíš v označené překážce: ' + o.prekazkaUvnitr, rada: 'Bod měř mimo ni, nebo offsetem.' };
        if (o.budova && o.budova.d < 2) return { kod: 'budova2', trida: 'bad', text: fmt(o.budova.d) + ' m od budovy (' + o.budova.popis + ') — GPS má odrazy, počítej s ±6 m', rada: 'Odstup 10 m od zdi, nebo krokový offset od rohu.' };
        if (o.budova) return { kod: 'budova4', trida: 'warn', text: fmt(o.budova.d) + ' m od budovy — půl nebe zakryté, GPS horší', rada: 'Měř déle (průměrování), nebo se posuň dál od zdi.' };
        if (o.prekazka) return { kod: 'prekazka', trida: 'warn', text: fmt(o.prekazka.d) + ' m od překážky: ' + o.prekazka.nazev, rada: 'Trasa ji obchází; bod raději z odstupu.' };
        if (o.koleje != null) return { kod: 'koleje', trida: 'warn', text: fmt(o.koleje) + ' m od kolejí — pozor na provoz, dráty zhoršují příjem', rada: 'Neměř v profilu trati bez zajištění.' };
        if (o.les) return { kod: 'les', trida: 'warn', text: 'Pod stromy — příjem GPS slabší', rada: 'Měř déle (průměrování 60 s a víc), nebo z okraje lesa offsetem.' };
        return null;
    }

    // ---- pilulka + hlášky ----------------------------------------------------------------------
    function pill() {
        var p = document.getElementById(PILL); if (p) return p;
        try { AG.style('ag-okoli-pill-style', ['#' + PILL + '{position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 76px);z-index:11980;display:none;align-items:center;gap:7px;padding:5px 12px;border-radius:999px;font:600 12px/1.2 var(--font-ui,system-ui),sans-serif;color:#fff;border:1px solid rgba(255,255,255,.22);box-shadow:0 4px 16px rgba(0,0,0,.45);max-width:88vw;background:rgba(146,94,7,.92);cursor:pointer;}', '#' + PILL + '.show{display:flex;}', '#' + PILL + '.bad{background:rgba(140,28,28,.94);}', 'body.ag-simple #' + PILL + '{display:none!important;}'].join('\n')); } catch (e) { swallow(e, 'css'); }
        p = document.createElement('div'); p.id = PILL; p.setAttribute('role', 'status');
        p.addEventListener('click', function () { if (_stav) try { window.agAlert && window.agAlert({ title: 'Hlídač okolí', message: _stav.text + '<br><br><b>Co s tím:</b> ' + _stav.rada + '<br><small>Vypnout: Nastavení → AR & přesnost → Hlídač okolí.</small>' }); } catch (e) { /* nic */ } });
        document.body.appendChild(p); return p;
    }
    function ukaz(stav) {
        var p = pill();
        if (!stav) { p.classList.remove('show'); return; }
        p.textContent = stav.text; p.classList.toggle('bad', stav.trida === 'bad'); p.classList.add('show');
    }
    var _proj = null;
    function tik() {
        try {
            // překážky jsou per zakázka — po přepnutí zakázky (děje se bez reloadu) je načíst znovu
            try { var pid = (typeof activeProjectId !== 'undefined') ? activeProjectId : null; if (pid !== _proj) { _proj = pid; nactiPrekazky(); kresliPrekazky(); } } catch (e) { /* nic */ }
            if (!st.zap) { if (_stav) { _stav = null; ukaz(null); } return; }
            var q = poloha(); if (!q) return;
            var o = vyhodnot(q.lat, q.lng), s = shrn(o);
            var kod = s ? s.kod : null, pred = _stav ? _stav.kod : null;
            _stav = s ? Object.assign({}, s, { okoli: o, ts: Date.now() }) : null;
            ukaz(s);
            if (s && kod !== pred) {
                var now = Date.now();
                if (!_hlasky[kod] || now - _hlasky[kod] > 60000) { _hlasky[kod] = now; try { window.agInfo && window.agInfo(s.text + '. ' + s.rada); } catch (e) { /* nic */ } }
            }
        } catch (e) { swallow(e, 'tik'); }
    }
    // text do provenience bodu
    function popisProBod() {
        if (!_stav || !_stav.okoli) return null;
        var o = _stav.okoli, casti = [];
        if (o.uvnitr) casti.push('uvnitř budovy podle mapy');
        if (o.budova) casti.push(fmt(o.budova.d) + ' m od budovy');
        if (o.les) casti.push('pod stromy');
        if (o.koleje != null) casti.push(fmt(o.koleje) + ' m od kolejí');
        if (o.prekazkaUvnitr) casti.push('v překážce ' + o.prekazkaUvnitr);
        if (o.prekazka) casti.push(fmt(o.prekazka.d) + ' m od překážky ' + o.prekazka.nazev);
        return casti.length ? casti.join(', ') : null;
    }
    var _obaleno = false;
    function obal() {
        var orig = window.saveCustomPoint; if (typeof orig !== 'function' || _obaleno) return; _obaleno = true;
        var w = function () {
            var pred = (typeof persistentCustomPoints !== 'undefined') ? persistentCustomPoints.length : -1;
            var ret = orig.apply(this, arguments);
            try {
                if (pred >= 0 && persistentCustomPoints.length === pred + 1) {
                    var p = persistentCustomPoints[persistentCustomPoints.length - 1], t = popisProBod();
                    if (p && p.prov && t && (p.prov.origin === 'gps' || p.prov.origin === 'gps-avg')) { p.prov.okoli = t; try { setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints)); } catch (e) { swallow(e, 'persist'); } }
                }
            } catch (e) { swallow(e, 'obal'); }
            return ret;
        };
        w._agOkoli = true; window.saveCustomPoint = w;
    }

    // ---- UI: nastavení + tlačítko Překážka v panelu Vrstvy ---------------------------------
    function ui() {
        if (!document.getElementById('s-okoli')) {
            var tab = document.getElementById('tab-ar');
            if (tab) {
                var hs = tab.querySelectorAll('.set-h'), kotva = null;
                for (var i = 0; i < hs.length; i++) if (/Kompas/.test(hs[i].textContent)) { kotva = hs[i]; break; }
                var r = document.createElement('div'); r.className = 'st-row';
                r.innerHTML = '<span class="st-lab">Hlídač okolí<small>u budovy, pod stromy, u kolejí a u označené překážky řekne, co to dělá s GPS; zapíše to k bodu</small></span><label class="st-sw"><input type="checkbox" id="s-okoli"' + (st.zap ? ' checked' : '') + '><span class="st-sw-face"></span></label>';
                if (kotva) tab.insertBefore(r, kotva); else tab.appendChild(r);
                r.querySelector('input').addEventListener('change', function (ev) { st.zap = !!ev.target.checked; uloz(); tik(); });
            }
        }
        if (!document.getElementById('btn-prekazka')) {
            var stack = document.getElementById('map-ctrl-stack');
            if (stack) {
                var b = document.createElement('button'); b.type = 'button'; b.id = 'btn-prekazka'; b.className = 'ms-tile'; b.setAttribute('aria-label', 'Překážka');
                b.innerHTML = '<svg class="icon"><use href="#i-area"/></svg><span>Překážka</span>';
                b.addEventListener('click', function () { vyberDruh(); try { document.getElementById('map-controls').classList.remove('expanded'); } catch (e) { /* nic */ } });
                stack.appendChild(b);
            }
        }
    }
    function start() {
        nactiPrekazky(); kresliPrekazky(); obal();
        try { ui(); } catch (e) { swallow(e, 'ui'); }
        document.addEventListener('click', function (ev) { try { if (ev.target && ev.target.closest && ev.target.closest('#settings-btn, [data-open="settings"], #map-fab, #btn-layers')) setTimeout(ui, 50); } catch (e) { /* nic */ } }, true);
        if (!_tik) _tik = setInterval(tik, 3000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.AGOkoli = {
        armed: false, take: take, kresliNovou: kresliNovou, smazPrekazku: smazPrekazku, prejmenuj: prejmenuj, DRUHY: DRUHY, vyberDruh: vyberDruh, prekazky: function () { return prekazky; }, prekazkaRings: prekazkaRings,
        pridejPrekazku: function (a, b, nazev, druhKlic) { prekazky.push({ a: a, b: b, nazev: nazev || 'Překážka', druh: druhKlic || null, ts: Date.now() }); ulozPrekazky(); kresliPrekazky(); try { document.dispatchEvent(new CustomEvent('ag:prekazky')); } catch (e) { /* nic */ } },
        vyhodnot: vyhodnot, shrn: shrn, stav: function () { return _stav; }, tik: tik, popisProBod: popisProBod, nastav: function (o) { if (o && o.zap != null) st.zap = !!o.zap; uloz(); }, zapnuto: function () { return st.zap; }, LIMIT: LIMIT
    };
})();
