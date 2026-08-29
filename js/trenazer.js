// ===== AR Geodet — TERÉNNÍ TRENAŽÉR (ODPOJITELNÁ vrstva) =======================
// Neinvazivní vrstva ve stylu js/prohlidka.js: NEEDITUJE logika.js ani grafika.js,
// kreslí do vlastní <svg> v #ar-overlay a do vlastní vrstvy v mapě.
//
// PROČ: appka umí spoustu věcí, které se člověk naučí jedině tím, že je udělá —
// jenže poprvé je dělá na OSTRÉ ZAKÁZCE, kde ho tlačí čas a chyba něco stojí.
// Trenažér dává totéž nanečisto: vygeneruje cvičné body, pošle tě je vytyčit
// a řekne, na kolik centimetrů jsi byl. Nováček se zaučí, aniž by někomu
// rozházel data — a mimo práci je to hra, kterou si člověk pustí sám od sebe.
//
// DVA REŽIMY, A LIŠÍ SE JEN ZDROJEM POLOHY:
//   • VENKU (1:1) — poloha je SKUTEČNÁ z GPS. Body se vygenerují 10–60 m kolem
//     tebe a fakt se k nim jde. Nic se nesimuluje; přesnost, se kterou se
//     trefíš, je přesnost, kterou v terénu opravdu máš.
//   • DOMA (1:20) — venku být nemusíš. Poloha je smyšlená a POHYB SE DRŽÍ
//     TLAČÍTKEM: držíš „Jdi" a jdeš tam, kam míří telefon. Směr je přitom
//     SKUTEČNÝ z kompasu, takže se člověk v pokoji otáčí a hledá — a naučí se
//     přesně to, co venku: číst šipku, nepřestřelit, dojít dorovnat.
//
// ⚠⚠ PODVRŽENÁ POLOHA SE NIKAM NEPOUŠTÍ. Simulovaná poloha existuje JEN uvnitř
// tohoto modulu a používá ji jen jeho vlastní kresba a jeho vlastní bodování.
// NEPŘEPISUJE userLat/userLng, NEPOUŠTÍ se do window.AGFix, do průměrování ani
// do watchPosition. Byla to první úvaha („ať na to reaguje celá appka") a je
// ZÁMĚRNĚ ZAHOZENÁ: falešný fix, který se dostane do měření, je přesně ta chyba,
// kterou by uživatel v terénu nepoznal, dokud by mu nesedělo zaměření.
// Ze stejného důvodu trenažér NEUKLÁDÁ ANI JEDEN BOD — cvičné body žijí v paměti,
// zmizí se zavřením a do zakázky, exportů ani protokolů se nedostanou.
//
// SIMULOVANÝ ŠUM: na výběr je „jak přesná je tvoje GPS". Trenažér k odečtené
// poloze přimíchá chybu (0 / ±1 / ±3 m), takže cvičení vypadá jako realita —
// bod, který sedí na displeji, ještě nemusí sedět na zemi. Bez toho by trenažér
// učil důvěřovat šipce víc, než si zaslouží.
//
// CO SE UKLÁDÁ: jen nejlepší výsledek na disciplínu (agTrenazerBest_v1) a
// poslední volby. Žádná data zakázky, žádné body, nic o poloze.
//
// Odstranění: smaž js/trenazer.js + řádek <script> v index.html, záznam
// 'trenazer' v js/tools-registry.js a jeho text v data/navody.json
// (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGTrenazer) return;

    var STYLE_ID = 'ag-tr-style';
    var MODAL_ID = 'ag-tr-modal';
    var HUD_ID = 'ag-tr-hud';
    var LS_BEST = 'agTrenazerBest_v1';
    var LS_OPT = 'agTrenazerOpt_v1';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

    var TARGET = '#f472b6', DONE_COL = '#34d399';
    var KROK_MS = 90;              // jak často se v režimu doma udělá krok
    var RYCHLOST = 1.35;           // m/s — normální chůze geodeta s výtyčkou

    var DISC = {
        vytyceni: {
            t: 'Vytyčení bodů',
            d: 'Appka rozhodí body a ty je jdeš vytyčit. Boduje se odchylka a čas.',
            n: 5, minD: 12, maxD: 55
        },
        dohledani: {
            t: 'Dohledání bodu',
            d: 'Jeden bod, žádná čísla — jen šipka. Trénink na hledání mezníku v terénu.',
            n: 3, minD: 25, maxD: 90, slepy: true
        }
    };

    var _on = false;
    var _opt = { disc: 'vytyceni', rezim: 'venku', sum: 1, tol: 0.30 };
    var _body = [];            // [{lat,lng,name,done,odch,ms}]
    var _idx = 0;
    var _t0 = 0, _tBod = 0;
    var _sim = null;           // {lat,lng} — POUZE pro tento modul
    var _walk = null;          // interval chůze v režimu doma
    var _svg = null, _raf = null, _idleT = 0;
    var _mapLayer = null;
    var _tick = null;
    var _hotovo = false;

    // ---- pomocné -------------------------------------------------------------
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'trenazer'); } catch (err) { /* nic */ } }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : void 0); } catch (e) { swallow(e, 'trenazer:toast'); } }
    function esc(s) {
        return (window.AG && AG.esc) ? AG.esc(s)
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }
    function haveGps() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function dist(la1, lo1, la2, lo2) {
        if (typeof getDistance === 'function') { try { return getDistance(la1, lo1, la2, lo2); } catch (e) { swallow(e, 'trenazer:dist'); } }
        var R = 6371000, t1 = la1 * Math.PI / 180, t2 = la2 * Math.PI / 180;
        var dt = (la2 - la1) * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
        var a = Math.sin(dt / 2) * Math.sin(dt / 2) + Math.cos(t1) * Math.cos(t2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    function brg(la1, lo1, la2, lo2) {
        if (typeof getBearing === 'function') { try { return getBearing(la1, lo1, la2, lo2); } catch (e) { swallow(e, 'trenazer:brg'); } }
        var t1 = la1 * Math.PI / 180, t2 = la2 * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
        var y = Math.sin(dl) * Math.cos(t2);
        var x = Math.cos(t1) * Math.sin(t2) - Math.sin(t1) * Math.cos(t2) * Math.cos(dl);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }
    // posun o (dN, dE) metrů
    function posun(lat, lng, dN, dE) {
        return { lat: lat + dN / 111320, lng: lng + dE / (111320 * Math.cos(lat * Math.PI / 180)) };
    }
    function heading() {
        try { if (typeof currentHeading === 'number' && isFinite(currentHeading)) return currentHeading; } catch (e) { swallow(e, 'trenazer:heading'); }
        return null;
    }

    // POLOHA, se kterou trenažér počítá. Venku skutečná, doma smyšlená.
    // Tahle funkce je jediné místo, kde se ty dva světy potkávají — a nic
    // z ní neodchází ven z modulu.
    function pos() {
        if (_opt.rezim === 'doma') return _sim;
        return haveGps() ? { lat: userLat, lng: userLng } : null;
    }
    // Poloha, JAK JI VIDÍ CVIČÍCÍ — tedy se simulovaným šumem. Bodování počítá
    // z pravdy (pos()), kresba a čísla z tohohle. V tom je celý trénink.
    var _sumN = 0, _sumE = 0, _sumT = 0;
    function posSum() {
        var p = pos(); if (!p) return null;
        if (!_opt.sum) return p;
        // šum se mění pomalu (jako multipath), ne každý snímek jinak
        var now = Date.now();
        if (now - _sumT > 2500) {
            _sumT = now;
            var s = _opt.sum;
            _sumN = (Math.random() * 2 - 1) * s;
            _sumE = (Math.random() * 2 - 1) * s;
        }
        return posun(p.lat, p.lng, _sumN, _sumE);
    }

    function fmtD(m) {
        if (m == null) return '—';
        if (m < 10) return (Math.round(m * 100) / 100).toFixed(2).replace('.', ',') + ' m';
        return (Math.round(m * 10) / 10).toFixed(1).replace('.', ',') + ' m';
    }
    function fmtCm(m) { return Math.round(m * 100) + ' cm'; }
    function fmtCas(ms) {
        var s = Math.round(ms / 1000);
        return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
    }
    function loadOpt() {
        try { var o = JSON.parse(localStorage.getItem(LS_OPT)); if (o && typeof o === 'object') { for (var k in o) if (k in _opt) _opt[k] = o[k]; } }
        catch (e) { swallow(e, 'trenazer:loadOpt'); }
    }
    function saveOpt() { try { localStorage.setItem(LS_OPT, JSON.stringify(_opt)); } catch (e) { swallow(e, 'trenazer:saveOpt'); } }
    function best() { try { var o = JSON.parse(localStorage.getItem(LS_BEST)); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    function saveBest(o) { try { localStorage.setItem(LS_BEST, JSON.stringify(o)); } catch (e) { swallow(e, 'trenazer:saveBest'); } }

    // ---- generování cvičných bodů -------------------------------------------
    function generuj(od) {
        var d = DISC[_opt.disc];
        var out = [];
        // Body se rozhodí do RŮZNÝCH SMĚRŮ (rovnoměrně po azimutu s náhodným
        // rozptylem), ať se necvičí pořád stejná chůze jedním směrem.
        var base = Math.random() * 360;
        for (var i = 0; i < d.n; i++) {
            var az = (base + i * (360 / d.n) + (Math.random() * 40 - 20)) * Math.PI / 180;
            var r = d.minD + Math.random() * (d.maxD - d.minD);
            var p = posun(od.lat, od.lng, Math.cos(az) * r, Math.sin(az) * r);
            out.push({ lat: p.lat, lng: p.lng, name: 'C' + (i + 1), done: false, odch: null, ms: 0 });
        }
        return out;
    }

    // ---- AR vrstva -----------------------------------------------------------
    function ensureSvg() {
        var ov = document.getElementById('ar-overlay'); if (!ov) return null;
        if (!_svg) {
            _svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            _svg.setAttribute('viewBox', '0 0 100 100');
            _svg.setAttribute('preserveAspectRatio', 'none');
            _svg.id = 'ag-tr-svg';
            _svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
            ov.appendChild(_svg);
        }
        return _svg;
    }
    function projAR(lat, lng, from, hd, pj, eyeH, vOff) {
        var d = dist(from.lat, from.lng, lat, lng);
        var b = brg(from.lat, from.lng, lat, lng);
        var diff = ((b - hd + 540) % 360) - 180;
        var uH = diff, vV = Math.atan2(eyeH, Math.max(d, 0.5)) * 180 / Math.PI - pj.pitch;
        if (pj.roll) { var cr = Math.cos(pj.roll), sr = Math.sin(pj.roll); var tt = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = tt; }
        return { x: 50 + (uH / pj.halfH) * 50, y: 50 + (vV / pj.halfV) * 50 - vOff, diff: diff, dist: d };
    }
    function arLoop() {
        var svg = _svg;
        if (!svg || !_on || _hotovo || !window._arProj
            || (typeof viewMode !== 'undefined' && viewMode === 'map')
            || document.visibilityState !== 'visible') {
            if (svg && svg.childNodes.length) svg.innerHTML = '';
            _raf = null;
            _idleT = setTimeout(function () { _idleT = 0; if (!_raf && _on) _raf = requestAnimationFrame(arLoop); }, 300);
            return;
        }
        _raf = requestAnimationFrame(arLoop);
        var me = posSum(); var hd = heading(); var pj = window._arProj;
        if (!me || hd == null) { if (svg.childNodes.length) svg.innerHTML = ''; return; }
        var eyeH = 1.6, vOff = 0;
        try { eyeH = visSettings.eyeHeight || 1.6; vOff = visSettings.arVerticalOffset || 0; } catch (e) { swallow(e, 'trenazer:arLoop'); }

        var d = DISC[_opt.disc];
        var html = '';
        for (var i = 0; i < _body.length; i++) {
            var b = _body[i];
            // U dohledání se ukazuje jen AKTUÁLNÍ cíl a bez čísla — o to jde.
            if (d.slepy && i !== _idx) continue;
            var p = projAR(b.lat, b.lng, me, hd, pj, eyeH, vOff);
            if (Math.abs(p.diff) > 70) continue;
            var akt = (i === _idx && !b.done);
            var col = b.done ? DONE_COL : TARGET;
            var r = Math.max(1.6, Math.min(9, 60 / Math.max(p.dist, 1)));
            html += '<g opacity="' + (akt ? '1' : '0.55') + '">'
                + '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="' + (r * 1.9).toFixed(2) + '" fill="none" stroke="' + col + '" stroke-width="' + (akt ? '1.6' : '0.9') + '" opacity="0.45" vector-effect="non-scaling-stroke"/>'
                + '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="' + r.toFixed(2) + '" fill="' + col + '" opacity="0.85"/>';
            if (!d.slepy) {
                html += '<text x="' + p.x.toFixed(2) + '" y="' + (p.y - r * 2.4).toFixed(2) + '" fill="' + col + '" font-size="3.4" font-weight="800" text-anchor="middle">'
                    + esc(b.name) + (b.done ? '' : '  ' + fmtD(p.dist)) + '</text>';
            }
            html += '</g>';
        }
        svg.innerHTML = html;
    }
    function startAr() { if (ensureSvg() && !_raf && !_idleT) _raf = requestAnimationFrame(arLoop); }
    function stopAr() {
        if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
        if (_idleT) { clearTimeout(_idleT); _idleT = 0; }
        if (_svg && _svg.parentNode) _svg.parentNode.removeChild(_svg);
        _svg = null;
    }

    // ---- mapová vrstva (jen když je Leaflet a mapa) ---------------------------
    function mapa() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function drawMap() {
        var m = mapa();
        if (!m || typeof L === 'undefined') return;
        if (_mapLayer) { try { m.removeLayer(_mapLayer); } catch (e) { swallow(e, 'trenazer:drawMap'); } _mapLayer = null; }
        var d = DISC[_opt.disc];
        var g = L.layerGroup();
        for (var i = 0; i < _body.length; i++) {
            var b = _body[i];
            if (d.slepy && i !== _idx && !b.done) continue;
            L.circleMarker([b.lat, b.lng], {
                radius: (i === _idx && !b.done) ? 10 : 7,
                color: b.done ? DONE_COL : TARGET, weight: 3,
                fillColor: b.done ? DONE_COL : TARGET, fillOpacity: b.done ? 0.5 : 0.25
            }).addTo(g);
        }
        // v režimu doma i moje smyšlená poloha, jinak by nebylo vidět, kde jsem
        if (_opt.rezim === 'doma' && _sim) {
            L.circleMarker([_sim.lat, _sim.lng], { radius: 8, color: '#fbbf24', weight: 3, fillColor: '#fbbf24', fillOpacity: 0.6 }).addTo(g);
        }
        g.addTo(m);
        _mapLayer = g;
    }
    function clearMap() {
        var m = mapa();
        if (m && _mapLayer) { try { m.removeLayer(_mapLayer); } catch (e) { swallow(e, 'trenazer:clearMap'); } }
        _mapLayer = null;
    }

    // ---- HUD (živý panel při běhu) -------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // pruh „tohle není doopravdy" — nejde zavřít, dokud trenažér běží
            '#ag-tr-band{position:fixed;left:0;right:0;top:0;z-index:99995;background:repeating-linear-gradient(135deg,#7c2d12 0 14px,#9a3412 14px 28px);',
            '  color:#ffedd5;font-weight:800;letter-spacing:0.06em;text-align:center;padding:calc(4px + env(safe-area-inset-top, 0px)) 8px 4px;',
            '  font-size:calc(11px * var(--ag-font-scale, 1));text-transform:uppercase;pointer-events:none;}',
            '#' + HUD_ID + '{position:fixed;left:0;right:0;bottom:0;z-index:99993;color:#f7eefc;',
            '  background:linear-gradient(180deg, rgba(10,8,20,0.66) 0%, rgba(10,8,20,0.95) 46%);',
            '  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:1px solid rgba(244,114,182,0.32);',
            '  border-radius:20px 20px 0 0;padding:12px 16px calc(12px + env(safe-area-inset-bottom, 0px));',
            '  font-size:calc(14px * var(--ag-font-scale, 1));box-shadow:0 -10px 34px rgba(0,0,0,0.5);}',
            '.ag-tr-top{display:flex;align-items:baseline;gap:10px;}',
            '.ag-tr-cil{color:#f472b6;font-weight:800;letter-spacing:0.06em;font-size:calc(11px * var(--ag-font-scale, 1));text-transform:uppercase;}',
            '.ag-tr-x{margin-left:auto;background:transparent;border:none;color:#a9a3b8;font-size:calc(22px * var(--ag-font-scale, 1));line-height:1;padding:2px 6px;}',
            '.ag-tr-big{font-size:calc(46px * var(--ag-font-scale, 1));font-weight:800;line-height:1.05;margin:2px 0 0;font-variant-numeric:tabular-nums;}',
            '.ag-tr-sub{color:#a9a3b8;font-size:calc(13px * var(--ag-font-scale, 1));margin-bottom:9px;}',
            '.ag-tr-row{display:flex;gap:8px;margin-top:9px;}',
            '.ag-tr-row button{flex:1;border-radius:12px;padding:12px 8px;font-size:calc(14px * var(--ag-font-scale, 1));font-weight:700;border:1px solid rgba(255,255,255,0.14);',
            '  background:rgba(255,255,255,0.07);color:#f7eefc;}',
            '.ag-tr-row button.go{background:rgba(244,114,182,0.2);border-color:rgba(244,114,182,0.45);}',
            '.ag-tr-row button.go:active,.ag-tr-row button.go.held{background:rgba(244,114,182,0.42);}',
            '.ag-tr-row button:disabled{opacity:0.42;}',
            '.ag-tr-row button.hit{background:rgba(52,211,153,0.24);border-color:rgba(52,211,153,0.5);color:#d1fae5;}',
            '.ag-tr-prog{display:flex;gap:5px;margin-top:9px;}',
            '.ag-tr-prog i{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,0.14);}',
            '.ag-tr-prog i.ok{background:#34d399;}',
            '.ag-tr-prog i.now{background:#f472b6;}',
            // volby a výsledek v modálu
            '#' + MODAL_ID + ' .modal-content{max-width:520px;}',
            '.ag-tr-opt{margin:0 0 14px;}',
            '.ag-tr-opt h4{margin:0 0 6px;font-size:calc(13px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);font-weight:700;}',
            '.ag-tr-seg{display:flex;gap:6px;flex-wrap:wrap;}',
            '.ag-tr-seg button{flex:1 1 44%;background:var(--surface-2,#1b2330);color:var(--text-color,#e6e8eb);border:1px solid rgba(255,255,255,0.10);',
            '  border-radius:11px;padding:9px 10px;font-size:calc(13px * var(--ag-font-scale, 1));text-align:left;line-height:1.3;}',
            '.ag-tr-seg button.on{border-color:var(--accent,#2f9e74);background:rgba(47,158,116,0.18);font-weight:700;}',
            '.ag-tr-seg button small{display:block;color:var(--text-muted,#9aa1ac);font-weight:400;font-size:calc(11px * var(--ag-font-scale, 1));}',
            '.ag-tr-vys{text-align:center;padding:6px 0 2px;}',
            '.ag-tr-vys .zn{font-size:calc(54px * var(--ag-font-scale, 1));font-weight:800;line-height:1;color:var(--accent,#2f9e74);}',
            '.ag-tr-vys .zntxt{color:var(--text-muted,#9aa1ac);margin-bottom:12px;}',
            '.ag-tr-tab{width:100%;border-collapse:collapse;font-size:calc(13px * var(--ag-font-scale, 1));}',
            '.ag-tr-tab th,.ag-tr-tab td{padding:6px 4px;border-bottom:1px solid rgba(255,255,255,0.07);text-align:right;}',
            '.ag-tr-tab th:first-child,.ag-tr-tab td:first-child{text-align:left;}',
            '.ag-tr-tab th{color:var(--text-muted,#9aa1ac);font-weight:600;}',
            '.ag-tr-note{color:var(--text-muted,#9aa1ac);font-size:calc(12px * var(--ag-font-scale, 1));line-height:1.45;margin:12px 0 0;}'
        ].join('\n');
        document.head.appendChild(st);
    }


    // Panel se usadí NAD OVLÁDÁNÍ PŘILEPENÉ KE SPODNÍ HRANĚ, ne přes něj.
    // POZOR NA LAYOUT TÉHLE APPKY: #dock NENÍ spodní lišta — je to svislý sloupec
    // vpravo (Body / Nový bod / Nastavení), který spodní hrany vůbec nedosáhne.
    // U spodní hrany naopak sedí tlačítka z #map-controls (Vrstvy vlevo, Mapa
    // vpravo), a ta se objevují jen v mapě. Proto se NEMĚŘÍ celý #dock (podle
    // jeho vysokého rámečku by panel vyskočil do půlky obrazovky a pod ním
    // zůstala díra), ale jen ty prvky, které jsou VIDĚT a KONČÍ u dolního okraje.
    function nadDokem(el) {
        if (!el) return;
        var H = window.innerHeight;
        var top = null;
        try {
            ['dock', 'map-controls'].forEach(function (id) {
                var host = document.getElementById(id);
                if (!host) return;
                var ch = host.children;
                for (var i = 0; i < ch.length; i++) {
                    var c = ch[i];
                    if (!c.getClientRects().length) continue;
                    var r = c.getBoundingClientRect();
                    if (!r.width || !r.height) continue;
                    if (r.bottom < H - 40 || r.top > H) continue;   // nesedí u spodní hrany
                    if (top == null || r.top < top) top = r.top;
                }
            });
        } catch (e) { swallow(e, 'nadDokem'); }
        // strop: i kdyby se něco změřilo špatně, panel nikdy nevyskočí přes
        // třetinu obrazovky — radši ať trochu překrývá, než aby visel uprostřed
        var b = (top == null) ? 0 : Math.min(Math.max(0, Math.round(H - top + 8)), Math.round(H * 0.34));
        el.style.bottom = b ? (b + 'px') : '';
    }

    function ensureBand() {
        if (document.getElementById('ag-tr-band')) return;
        var b = document.createElement('div');
        b.id = 'ag-tr-band';
        b.textContent = _opt.rezim === 'doma'
            ? 'Trenažér — poloha je smyšlená, nic se neukládá'
            : 'Trenažér — cvičné body, nic se neukládá';
        document.body.appendChild(b);
    }
    function removeBand() {
        var b = document.getElementById('ag-tr-band');
        if (b && b.parentNode) b.parentNode.removeChild(b);
    }

    function ensureHud() {
        var el = document.getElementById(HUD_ID);
        if (el) return el;
        injectStyles();
        el = document.createElement('div');
        el.id = HUD_ID;
        el.innerHTML =
            '<div class="ag-tr-top"><span class="ag-tr-cil" id="ag-tr-cil">Cíl</span>'
            + '<span class="ag-tr-cil" id="ag-tr-cas" style="color:#a9a3b8;"></span>'
            + '<button type="button" class="ag-tr-x" id="ag-tr-quit" aria-label="Ukončit trenažér">×</button></div>'
            + '<div class="ag-tr-big" id="ag-tr-dist">—</div>'
            + '<div class="ag-tr-sub" id="ag-tr-hint"></div>'
            + '<div class="ag-tr-prog" id="ag-tr-prog"></div>'
            + '<div class="ag-tr-row" id="ag-tr-row"></div>';
        document.body.appendChild(el);
        el.querySelector('#ag-tr-quit').addEventListener('click', function () { konec(true); });
        nadDokem(el);
        return el;
    }
    function removeHud() {
        var el = document.getElementById(HUD_ID);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    // ---- chůze v režimu doma -------------------------------------------------
    function krok() {
        if (!_sim) return;
        var hd = heading();
        // Bez kompasu (prohlížeč na stole, zamítnuté oprávnění) by se nedalo hnout
        // z místa — pak se jde k aktuálnímu cíli, ať trenažér funguje i tak.
        if (hd == null) {
            var b = _body[_idx];
            hd = b ? brg(_sim.lat, _sim.lng, b.lat, b.lng) : 0;
        }
        var s = RYCHLOST * (KROK_MS / 1000);
        var r = hd * Math.PI / 180;
        _sim = posun(_sim.lat, _sim.lng, Math.cos(r) * s, Math.sin(r) * s);
    }
    function startWalk() {
        if (_walk || _opt.rezim !== 'doma') return;
        _walk = setInterval(function () { try { krok(); } catch (e) { swallow(e, 'trenazer:krok'); } }, KROK_MS);
        var b = document.getElementById('ag-tr-go'); if (b) b.classList.add('held');
    }
    function stopWalk() {
        if (_walk) { clearInterval(_walk); _walk = null; }
        var b = document.getElementById('ag-tr-go'); if (b) b.classList.remove('held');
    }

    // ---- běh -----------------------------------------------------------------
    function aktualni() { return _body[_idx] || null; }
    function odchylka() {
        // ODCHYLKA SE POČÍTÁ Z PRAVDY, ne z toho, co je vidět na displeji.
        // Kdyby se počítala ze zašuměné polohy, trenažér by odměňoval to, že
        // člověk věří šipce — a přesně to nemá učit.
        var me = pos(), b = aktualni();
        if (!me || !b) return null;
        return dist(me.lat, me.lng, b.lat, b.lng);
    }
    function videnaVzdalenost() {
        var me = posSum(), b = aktualni();
        if (!me || !b) return null;
        return dist(me.lat, me.lng, b.lat, b.lng);
    }
    function zatluc() {
        var b = aktualni(); if (!b || b.done) return;
        var o = odchylka(); if (o == null) return;
        b.done = true; b.odch = o; b.ms = Date.now() - _tBod;
        var hodnoceni = o <= _opt.tol ? 'Sedí' : (o <= _opt.tol * 3 ? 'Ujde' : 'Mimo');
        toast(hodnoceni + ' — ' + fmtCm(o) + ' od bodu ' + b.name);
        try { if (navigator.vibrate) navigator.vibrate(o <= _opt.tol ? [30, 40, 30] : 60); } catch (e) { swallow(e, 'trenazer:vibrate'); }
        _idx++;
        _tBod = Date.now();
        if (_idx >= _body.length) { dokonceno(); return; }
        drawMap(); renderHud();
    }
    function preskoc() {
        var b = aktualni(); if (!b) return;
        b.done = true; b.odch = null; b.ms = Date.now() - _tBod;
        _idx++; _tBod = Date.now();
        if (_idx >= _body.length) { dokonceno(); return; }
        drawMap(); renderHud();
    }

    function renderHud() {
        var el = document.getElementById(HUD_ID); if (!el) return;
        nadDokem(el);
        var d = DISC[_opt.disc];
        var b = aktualni();
        var vid = videnaVzdalenost();
        var cil = el.querySelector('#ag-tr-cil');
        var cas = el.querySelector('#ag-tr-cas');
        var big = el.querySelector('#ag-tr-dist');
        var hint = el.querySelector('#ag-tr-hint');
        var prog = el.querySelector('#ag-tr-prog');
        var row = el.querySelector('#ag-tr-row');

        if (cil) cil.textContent = b ? ('Cíl ' + (_idx + 1) + ' / ' + _body.length + (d.slepy ? '' : ' · ' + b.name)) : 'Hotovo';
        if (cas) cas.textContent = _t0 ? fmtCas(Date.now() - _t0) : '';

        if (big) {
            if (d.slepy) {
                // slepá disciplína: místo čísla jen „teplo/zima"
                big.textContent = vid == null ? '—' : (vid < 1 ? 'TADY' : vid < 3 ? 'horko' : vid < 8 ? 'blízko' : vid < 20 ? 'vlažno' : 'daleko');
            } else {
                big.textContent = vid == null ? '—' : fmtD(vid);
            }
        }
        if (hint) {
            var hd = heading();
            var az = (b && posSum()) ? brg(posSum().lat, posSum().lng, b.lat, b.lng) : null;
            var txt = [];
            if (az != null) txt.push('azimut ' + Math.round(az) + '°');
            if (az != null && hd != null) {
                var df = ((az - hd + 540) % 360) - 180;
                txt.push(Math.abs(df) < 10 ? 'míříš na něj' : (df > 0 ? 'otoč se o ' + Math.round(df) + '° doprava' : 'otoč se o ' + Math.round(-df) + '° doleva'));
            }
            if (_opt.sum) txt.push('GPS ±' + _opt.sum + ' m');
            hint.textContent = txt.join(' · ');
        }
        if (prog) {
            var ph = '';
            for (var i = 0; i < _body.length; i++) ph += '<i class="' + (_body[i].done ? 'ok' : (i === _idx ? 'now' : '')) + '"></i>';
            prog.innerHTML = ph;
        }
        if (row && !row.getAttribute('data-built')) {
            row.setAttribute('data-built', '1');
            var h = '';
            if (_opt.rezim === 'doma') h += '<button type="button" class="go" id="ag-tr-go">Držet = jdi</button>';
            h += '<button type="button" class="hit" id="ag-tr-hit">Zatluč kolík</button>';
            h += '<button type="button" id="ag-tr-skip">Vzdát bod</button>';
            row.innerHTML = h;
            var go = row.querySelector('#ag-tr-go');
            if (go) {
                // Chůze musí jet i při držení prstu — proto pointer/touch, ne click.
                go.addEventListener('pointerdown', function (e) { e.preventDefault(); startWalk(); });
                ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { go.addEventListener(ev, stopWalk); });
                go.addEventListener('touchstart', function (e) { e.preventDefault(); startWalk(); }, { passive: false });
                ['touchend', 'touchcancel'].forEach(function (ev) { go.addEventListener(ev, stopWalk); });
            }
            row.querySelector('#ag-tr-hit').addEventListener('click', zatluc);
            row.querySelector('#ag-tr-skip').addEventListener('click', preskoc);
        }
        var hit = el.querySelector('#ag-tr-hit');
        // Kolík se dá zatlouct jen v rozumné blízkosti — jinak by šlo „vytyčit"
        // bod z druhé strany louky a skóre by nic neznamenalo.
        // Práh se rozšiřuje o simulovaný šum: při ±3 m může displej ukazovat
        // 3 m i ve chvíli, kdy stojíš přesně na bodě — a tlačítko by bylo
        // zamčené právě tehdy, kdy ho člověk potřebuje.
        if (hit) hit.disabled = !(vid != null && vid < Math.max(3, _opt.tol * 10) + _opt.sum * 1.5);
    }

    // ---- výsledek ------------------------------------------------------------
    function znamka(prum) {
        if (prum == null) return { z: '—', t: 'nic nedokončeno' };
        if (prum <= 0.15) return { z: 'A', t: 'geodetická přesnost — takhle se to dělá' };
        if (prum <= 0.35) return { z: 'B', t: 'v mezích, co mobil umí' };
        if (prum <= 0.80) return { z: 'C', t: 'trefíš, ale kolík by se hledal' };
        if (prum <= 2.00) return { z: 'D', t: 'zatím spíš odhad než vytyčení' };
        return { z: 'E', t: 'zkus jít pomaleji a dorovnávat na místě' };
    }
    function dokonceno() {
        _hotovo = true;
        stopWalk();
        var celkem = Date.now() - _t0;
        var sum = 0, n = 0;
        _body.forEach(function (b) { if (b.odch != null) { sum += b.odch; n++; } });
        var prum = n ? sum / n : null;
        var zn = znamka(prum);

        // nejlepší výsledek na disciplínu + režim
        var key = _opt.disc + '_' + _opt.rezim;
        var bs = best();
        var rec = { prum: prum, ms: celkem, n: n, ts: Date.now() };
        var lepsi = !bs[key] || (prum != null && (bs[key].prum == null || prum < bs[key].prum));
        if (lepsi && prum != null) { bs[key] = rec; saveBest(bs); }

        removeHud(); stopAr(); clearMap();

        var m = ensureModal();
        var body = m.querySelector('#ag-tr-body');
        var h = '<div class="ag-tr-vys"><div class="zn">' + zn.z + '</div><div class="zntxt">' + esc(zn.t) + '</div></div>';
        h += '<table class="ag-tr-tab"><tr><th>Bod</th><th>Odchylka</th><th>Čas</th></tr>';
        _body.forEach(function (b) {
            h += '<tr><td>' + esc(b.name) + '</td><td>' + (b.odch == null ? 'vzdáno' : fmtCm(b.odch)) + '</td><td>' + fmtCas(b.ms) + '</td></tr>';
        });
        h += '<tr><td><b>Celkem</b></td><td><b>' + (prum == null ? '—' : 'ø ' + fmtCm(prum)) + '</b></td><td><b>' + fmtCas(celkem) + '</b></td></tr></table>';
        if (bs[key] && !lepsi) h += '<p class="ag-tr-note">Tvůj nejlepší pokus zůstává ø ' + fmtCm(bs[key].prum) + ' za ' + fmtCas(bs[key].ms) + '.</p>';
        else if (lepsi && prum != null) h += '<p class="ag-tr-note">Nový nejlepší výsledek. Předchozí: ' + (bs[key] && bs[key] !== rec ? fmtCm(bs[key].prum) : 'žádný') + '</p>';
        h += '<p class="ag-tr-note">Cvičné body nikam neputovaly — v zakázce po nich nic nezůstalo.</p>';
        body.innerHTML = h;
        var foot = m.querySelector('#ag-tr-foot');
        foot.innerHTML = '<button type="button" class="btn btn-primary" id="ag-tr-again">Znovu</button>'
            + '<button type="button" class="btn btn-secondary" id="ag-tr-back">Změnit nastavení</button>'
            + '<button type="button" class="btn btn-secondary" id="ag-tr-close">Zavřít</button>';
        foot.querySelector('#ag-tr-again').addEventListener('click', function () { m.style.display = 'none'; start(); });
        foot.querySelector('#ag-tr-back').addEventListener('click', function () { renderVolby(); });
        foot.querySelector('#ag-tr-close').addEventListener('click', function () { m.style.display = 'none'; konec(false); });
        m.style.display = 'flex';
    }

    // ---- start / konec -------------------------------------------------------
    function start() {
        var od;
        if (_opt.rezim === 'venku') {
            if (!haveGps()) { toast('Venkovní režim potřebuje GPS. Zkus režim Doma.'); return; }
            od = { lat: userLat, lng: userLng };
            _sim = null;
        } else {
            // Doma: začne se tam, kde appka naposled byla — ať sedí mapa i katastr.
            // Když ani to ne, vezme se střed republiky; na cvičení je to jedno.
            od = haveGps() ? { lat: userLat, lng: userLng } : null;
            if (!od) {
                try { var lp = JSON.parse(localStorage.getItem('arLastPos')); if (lp && lp.lat) od = { lat: lp.lat, lng: lp.lng }; } catch (e) { swallow(e, 'trenazer:start'); }
            }
            if (!od) od = { lat: 49.8175, lng: 15.4730 };
            _sim = { lat: od.lat, lng: od.lng };
        }
        _body = generuj(od);
        _idx = 0; _hotovo = false;
        _t0 = Date.now(); _tBod = Date.now();
        _on = true;
        injectStyles(); ensureBand(); ensureHud();
        var row = document.getElementById('ag-tr-row'); if (row) row.removeAttribute('data-built');
        renderHud(); drawMap(); startAr();
        if (!_tick) {
            _tick = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
                if (!_on || _hotovo) return;
                try { renderHud(); if (_opt.rezim === 'doma' && _walk) drawMap(); } catch (e) { swallow(e, 'trenazer:tik'); }
            }, 400);
        }
        toast(_opt.rezim === 'doma' ? 'Otáčej se telefonem a drž „Jdi".' : 'Jdi na první bod.');
    }
    function konec(ptatSe) {
        if (ptatSe && _on && !_hotovo && _idx < _body.length) {
            var jdemNaTo = true;
            try { if (typeof window.confirm === 'function') jdemNaTo = window.confirm('Ukončit trenažér? Rozdělaný pokus se nezapočítá.'); } catch (e) { swallow(e, 'trenazer:konec'); }
            if (!jdemNaTo) return;
        }
        _on = false; _hotovo = false;
        stopWalk(); stopAr(); clearMap(); removeHud(); removeBand();
        if (_tick) { try { clearInterval(_tick); } catch (e) { swallow(e, 'trenazer:konec'); } _tick = null; }
        _body = []; _sim = null; _idx = 0;
    }

    // ---- modál s volbami -----------------------------------------------------
    function ensureModal() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = MODAL_ID;
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Terénní trenažér</h3>' +
            '  <div id="ag-tr-body"></div>' +
            '  <div class="ag-dd-foot" id="ag-tr-foot" style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;"></div>' +
            '</div>';
        document.body.appendChild(m);
        return m;
    }
    function seg(nazev, klic, volby) {
        var h = '<div class="ag-tr-opt"><h4>' + esc(nazev) + '</h4><div class="ag-tr-seg">';
        volby.forEach(function (v) {
            h += '<button type="button" data-k="' + esc(klic) + '" data-v="' + esc(String(v.v)) + '" class="' + (String(_opt[klic]) === String(v.v) ? 'on' : '') + '">'
                + esc(v.t) + (v.s ? '<small>' + esc(v.s) + '</small>' : '') + '</button>';
        });
        return h + '</div></div>';
    }
    function renderVolby() {
        var m = ensureModal();
        var body = m.querySelector('#ag-tr-body');
        var bs = best();
        var h = '';
        h += seg('Co si zacvičit', 'disc', [
            { v: 'vytyceni', t: DISC.vytyceni.t, s: DISC.vytyceni.d },
            { v: 'dohledani', t: DISC.dohledani.t, s: DISC.dohledani.d }
        ]);
        h += seg('Kde jsi', 'rezim', [
            { v: 'venku', t: 'Venku (1 : 1)', s: 'skutečná GPS, fakt se chodí' },
            { v: 'doma', t: 'Doma', s: 'poloha smyšlená, chůze na tlačítko' }
        ]);
        h += seg('Jak přesná je GPS', 'sum', [
            { v: 0, t: 'Bez chyby', s: 'učí se ovládání' },
            { v: 1, t: '± 1 m', s: 'dobré podmínky' },
            { v: 3, t: '± 3 m', s: 'mezi domy, pod stromy' }
        ]);
        var key = _opt.disc + '_' + _opt.rezim;
        if (bs[key]) h += '<p class="ag-tr-note">Nejlepší dosud: ø ' + fmtCm(bs[key].prum) + ' za ' + fmtCas(bs[key].ms) + '.</p>';
        h += '<p class="ag-tr-note">Trenažér neuloží ani jeden bod a nesáhne na zakázku. V režimu Doma je smyšlená jen poloha — kompas i kamera jsou skutečné, proto se tam trénuje otáčení a čtení šipky.</p>';
        body.innerHTML = h;

        var btns = body.querySelectorAll('.ag-tr-seg button');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function () {
                var k = this.getAttribute('data-k'), v = this.getAttribute('data-v');
                _opt[k] = (k === 'sum') ? parseFloat(v) : v;
                saveOpt();
                renderVolby();
            });
        }
        var foot = m.querySelector('#ag-tr-foot');
        foot.innerHTML = '<button type="button" class="btn btn-primary" id="ag-tr-start">Spustit</button>'
            + '<button type="button" class="btn btn-secondary" id="ag-tr-close2">Zavřít</button>';
        foot.querySelector('#ag-tr-start').addEventListener('click', function () { m.style.display = 'none'; start(); });
        foot.querySelector('#ag-tr-close2').addEventListener('click', function () { m.style.display = 'none'; });
        m.style.display = 'flex';
    }

    function open() {
        loadOpt();
        if (_on) { toast('Trenažér už běží.'); return; }
        renderVolby();
    }

    // ================================================================
    //  init
    // ================================================================
    var _tries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'trenazer', label: 'Terénní trenažér', icon: ICON, cat: 'Pomůcky', onClick: open, order: 64 });
            return true;
        }
        return false;
    }
    function init() { if (!register() && _tries++ < 20) setTimeout(init, 500); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGTrenazer = { open: open, konec: function () { konec(false); }, bezi: function () { return _on; } };
})();
