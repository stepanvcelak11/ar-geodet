// ===== QTRIG — LOVCI BODŮ: sbírka objevených bodů, ocenění, lov (ODPOJITELNÁ) ==
// PŘÁNÍ (15. 9. 2026, vybráno A + B + C ze čtyř variant): „Pokémon Go — koho nebaví
// appku jen používat na hledání bodů, ať z toho má zároveň sbírání bodů, které
// objevil, a nějaké ocenění. Spíš hledání než souboje."
//
// CO DĚLÁ
//   A · SBÍRKA — úřední bod (TB, ZhB, PPBP, nivelační, tíhový) se zapíše, když u
//       něj člověk FYZICKY STOJÍ: fix do 8 m, blíž než 5 m aspoň 15 s a klepne
//       „Našel jsem ho" v kartě bodu. Průjezd kolem se nepočítá. Objevený bod má
//       v mapě zelený puntík (grafika.js, stejně jako „Vytyčeno").
//   B · OCENĚNÍ — vyplývají z geodetické struktury dat, ne z náhodných met:
//       První kámen (TB), Tucet, Stovka, Celý pořad (všechny body jednoho
//       nivelačního pořadu), Trojúhelník (3 TB z jednoho triangulačního listu),
//       Okres (všechny TB v okrese), Vrchol (nejvýš položený TB okresu), Kámen
//       z budovy (tíhový bod). Ukazuje se postup k nejbližšímu.
//   C · LOV — nejbližší NEOBJEVENÉ body, přednostně vzácnější; hodnota podle
//       skutečné vzácnosti v ČR (počty ČÚZK 15. 9. 2026: PPBP 409 k, nivelace
//       126 k, TB 50 k, ZhB 49 k, tíhové 451): TB 50 · ZhB 30 · nivelace 10 ·
//       PPBP 3 · tíhový 200. „Kámen dne" = jeden TB/ZhB do 3 km za dvojnásobek,
//       stejný pro všechny (hash data + okresu). Skóre za okres.
//
// ⚠ VĚDOMĚ JINÁ PRAVIDLA NEŽ js/odznaky.js. Odznaky v Ročence jsou tiché pozorování
//   práce (žádné úkoly, žádný postup k nesplněnému). Tohle je HRA na přání
//   uživatele a ukazatele postupu k ní patří. Zůstává ale: nic nevyskakuje samo
//   (jen toast po klepnutí „Našel jsem ho") a NIC SE NEPOSÍLÁ — sbírka leží
//   v telefonu (AGStore police 'lovci', klíč 'nalezy'). Varianta D (parta,
//   server) nebyla vybrána.
//
// KDE BERE ÚPLNOST OKRESU („41 z 11 651", „všechny TB v okrese", „celý pořad"):
//   ze staženého balíčku okresu (js/oblasti-offline.js, AGOblasti). Bez balíčku
//   se ukazuje jen to, co se dá spočítat z nálezů, a modul řekne, kde balíček
//   stáhnout. Sken balíčku okresu (~50 buněk) se dělá jednou a drží v paměti.
//
// Vstupy do cizích modulů (obojí hlídané `window.AGLovci &&`):
//   • js/karta-bodu-plus.js — tlačítko „Našel jsem ho" v liště akcí karty,
//   • js/grafika.js _drawOneMarker — puntík u objeveného bodu v mapě.
// Odstranění: smaž js/lovci-bodu.js + css/lovci-bodu.css, řádek v index.html,
// záznam 'lovci-bodu' v js/tools-registry.js a jeho text v data/navody.json.
// ================================================================================
(function () {
    'use strict';
    if (window.AGLovci) return;
    try { window.AG && AG.cssFile && AG.cssFile('agl-css', 'css/lovci-bodu.css'); } catch (e) { }

    var SHELF = 'lovci', KEY = 'nalezy';
    var BLIZKO_M = 5, PRESNOST_M = 8, POSTOJ_S = 15;
    var HODNOTA = { TB: 50, ZHB: 30, NIVEL: 10, PBPP: 3, TIHA: 200 };
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6 6 1-4.5 4.4 1 6.6-5.5-3-5.5 3 1-6.6L3 9l6-1z"/></svg>';

    var _nalezy = [];          // [{id, name, cat, druh, lat, lng, ku, okres, porad, list, vyska, kdy, kdo, acc, hod}]
    var _ix = {};              // id -> nález
    var _loaded = false;
    var _dwell = {};           // id -> { od: ts }
    var _ov = null, _seg = 'sbirka';
    var _statCache = {};       // okres -> statistika z balíčku

    // --------------------------------------------------------------------------------
    // Pomůcky
    // --------------------------------------------------------------------------------
    function esc(s) {
        return (window.AG && AG.esc) ? AG.esc(s)
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde); } catch (x) { } }
    function toast(m) {
        try { if (window.AG && AG.toast) return AG.toast(m); } catch (e) { swallow(e, 'lovci:toast'); }
        try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { swallow(e, 'lovci:toast'); }
    }
    function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    // ⚠ arPoints je v logika.js `let` na nejvyšší úrovni — na window NENÍ, ale jako
    //   globální lexikální vazba je vidět z každého klasického skriptu (typeof-guard).
    function pts() { try { return (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) ? arPoints : null; } catch (e) { return null; } }
    function dist(a, b, c, d) {
        try { if (typeof getDistance === 'function') return getDistance(a, b, c, d); } catch (e) { }
        try { if (window.GeoCore && GeoCore.getDistance) return GeoCore.getDistance(a, b, c, d); } catch (e) { }
        var R = 6382000, dl = (d - b) * Math.PI / 180, dp = (c - a) * Math.PI / 180, x = dl * Math.cos((a + c) / 2 * Math.PI / 180);
        return Math.sqrt(x * x + dp * dp) * R;
    }
    function shelf() { return (window.AGStore && AGStore.shelf) ? AGStore.shelf(SHELF) : null; }
    function jeTihovy(pt) { return !!(pt && (pt.vrstva === 48 || /tíhov/i.test(pt.druh || ''))); }
    function hodnota(pt) { if (!pt) return 0; if (jeTihovy(pt)) return HODNOTA.TIHA; return HODNOTA[pt.cat] || 0; }
    function idBodu(pt) { return pt.cislo12 || (String(pt.name) + '@' + (+pt.lat).toFixed(5) + ',' + (+pt.lng).toFixed(5)); }
    function jeUredni(pt) { return !!(pt && pt.cat && pt.cat !== 'CUSTOM' && pt.rawData); }
    function katLabel(c) { return { TB: 'TB', ZHB: 'ZhB', NIVEL: 'nivelační', PBPP: 'PPBP' }[c] || c; }
    function fix() {
        var f = window.AGFix;
        if (f && f.lat != null && Date.now() - (f.ts || 0) <= 30000) return f;
        // bez čerstvého AGFix (starší appka, klidně stojící telefon bez nového fixu): poslední známá poloha
        try { if (typeof userLat !== 'undefined' && userLat != null) return { lat: userLat, lng: userLng, acc: (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy != null) ? currentGpsAccuracy : 99, ts: 0 }; } catch (e) { }
        return null;
    }
    function kdo() { try { return localStorage.getItem('arSurveyor') || ''; } catch (e) { return ''; } }
    function dnes() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
    function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

    // --------------------------------------------------------------------------------
    // Úložiště
    // --------------------------------------------------------------------------------
    function load() {
        var s = shelf();
        if (!s) { _loaded = true; return Promise.resolve(); }
        return s.get(KEY).then(function (v) {
            _nalezy = Array.isArray(v) ? v : [];
            _ix = {}; _nalezy.forEach(function (n) { _ix[n.id] = n; });
            _loaded = true;
        }).catch(function () { _loaded = true; });
    }
    function save() { var s = shelf(); return s ? s.put(KEY, _nalezy) : Promise.resolve(false); }
    function nalezen(pt) { if (!pt) return false; var id = pt.cislo12 || idBodu(pt); return !!(_ix[id] || (pt.cislo12 && _ix[idBodu({ name: pt.name, lat: pt.lat, lng: pt.lng })])); }
    function skore(nalezy) { var s = 0; (nalezy || _nalezy).forEach(function (n) { s += n.hod || 0; }); return s; }

    // --------------------------------------------------------------------------------
    // Postoj u bodu: 2 s tik přes body do 20 m; 5 m + přesnost = načítá se čas
    // --------------------------------------------------------------------------------
    function tik() {
        var f = fix(); if (!f) { _dwell = {}; return; }
        var P = pts(); if (!P) return;
        var ted = Date.now(), vid = {};
        for (var i = 0; i < P.length; i++) {
            var p = P[i]; if (!jeUredni(p)) continue;
            var d = (p.currentDist != null && isFinite(p.currentDist)) ? p.currentDist : dist(f.lat, f.lng, p.lat, p.lng);
            if (d > 20) continue;
            var id = idBodu(p);
            if (d <= BLIZKO_M && f.acc <= PRESNOST_M) { if (!_dwell[id]) _dwell[id] = { od: ted }; vid[id] = 1; }
        }
        for (var k in _dwell) if (!vid[k]) delete _dwell[k];
        // živé tlačítko v otevřené kartě
        var b = document.querySelector('#ag-kb-acts button[data-a="nalez"]');
        if (b && b.getAttribute('data-id')) { var st = stav(b.getAttribute('data-id')); b.querySelector('span').innerHTML = st.label; b.classList.toggle('ready', st.ok); }
    }
    // stav pro tlačítko v kartě: co ještě chybí
    function stav(id) {
        if (_ix[id]) return { ok: false, done: true, label: 'Nalezen ✓' };
        var f = fix();
        if (!f) return { ok: false, label: 'Našel jsem ho<br><small>čekám na GPS</small>' };
        var pt = najdiBod(id); if (!pt) return { ok: false, label: 'Našel jsem ho' };
        var d = dist(f.lat, f.lng, pt.lat, pt.lng);
        if (d > BLIZKO_M) return { ok: false, label: 'Našel jsem ho<br><small>ještě ' + (d < 100 ? d.toFixed(0) : num(d)) + ' m</small>' };
        if (f.acc > PRESNOST_M) return { ok: false, label: 'Našel jsem ho<br><small>GPS ±' + Math.round(f.acc) + ' m, počkej</small>' };
        var dw = _dwell[id]; var s = dw ? (Date.now() - dw.od) / 1000 : 0;
        if (s < POSTOJ_S) return { ok: false, label: 'Našel jsem ho<br><small>postůj ještě ' + Math.ceil(POSTOJ_S - s) + ' s</small>' };
        return { ok: true, label: 'Našel jsem ho!<br><small>+' + hodnota(pt) + '</small>' };
    }
    function najdiBod(id) {
        var P = pts(); if (!P) return null;
        for (var i = 0; i < P.length; i++) if (jeUredni(P[i]) && idBodu(P[i]) === id) return P[i];
        return null;
    }

    // Klepnutí „Našel jsem ho" v kartě. Vrací true, když se bod zapsal.
    function klik(pt) {
        if (!jeUredni(pt)) return false;
        var id = idBodu(pt);
        if (_ix[id]) {
            toast('Tenhle bod už máš ve sbírce (' + new Date(_ix[id].kdy).toLocaleDateString('cs-CZ') + ').');
            return false;
        }
        var st = stav(id);
        if (!st.ok) { toast(st.label.replace(/<br>/g, ' — ').replace(/<[^>]+>/g, '')); return false; }
        var f = fix();
        var kd = kamenDne();
        var hod = hodnota(pt) * (kd && kd.id === id ? 2 : 1);
        var n = { id: id, name: pt.name, cat: pt.cat, druh: pt.druh || null, lat: pt.lat, lng: pt.lng, ku: pt.ku || null, okres: pt.okres || null, porad: pt.porad || null, list: pt.list || null, vyska: pt.vyska != null ? pt.vyska : null, tiha: jeTihovy(pt), kdy: Date.now(), kdo: kdo(), acc: f ? Math.round(f.acc * 10) / 10 : null, hod: hod };
        _nalezy.push(n); _ix[id] = n;
        var pred = oceneni().filter(function (o) { return o.ma; }).length;
        save().then(function (ok) { if (!ok) toast('Nález se nepodařilo uložit — zkus to znovu.'); });
        var po = oceneni().filter(function (o) { return o.ma; });
        var nove = po.length > pred ? po[po.length - 1] : null;
        toast('Objeveno: ' + katLabel(pt.cat) + ' ' + pt.name + ' · +' + hod + (kd && kd.id === id ? ' (kámen dne ×2)' : '') + (nove ? ' · ocenění „' + nove.nazev + '"' : ''));
        try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { swallow(e, 'lovci:klik'); }
        return true;
    }
    function odebrat(id) {
        _nalezy = _nalezy.filter(function (n) { return n.id !== id; }); delete _ix[id];
        return save();
    }

    // --------------------------------------------------------------------------------
    // Kde jsem (okres) + statistika okresu z balíčku
    // --------------------------------------------------------------------------------
    function mujOkres() {
        try {
            var P = pts(); if (P) for (var i = 0; i < P.length; i++) if (P[i].okres && P[i].currentDist != null && P[i].currentDist < 2000) return P[i].okres;
        } catch (e) { }
        if (_nalezy.length) return _nalezy[_nalezy.length - 1].okres || null;
        return null;
    }
    // Statistika okresu ze staženého balíčku: počty podle kategorie, body per pořad,
    // TB per triangulační list, nejvyšší TB. Promise<stat|null>.
    function statOkresu(okres) {
        if (!okres) return Promise.resolve(null);
        if (_statCache[okres]) return Promise.resolve(_statCache[okres]);
        var O = window.AGOblasti; if (!O || !O.meta) return Promise.resolve(null);
        var m = O.meta(); var bal = (m && m.balicky || []).filter(function (b) { return b.body && b.body.stav === 'hotovo'; });
        if (!bal.length) return Promise.resolve(null);
        // obálka: balíček, který okres obsahuje (okres/kraj/ČR) — vezme se nejmenší
        bal.sort(function (a, b) { return (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]); });
        var hr = O.hranice ? O.hranice() : Promise.resolve(null);
        return hr.then(function (h) {
            var bb = null;
            if (h) h.okresy.forEach(function (o) { if (o.nazev === okres) bb = o.bbox; });
            if (!bb) bb = bal[0].bbox;
            var lat = (bb[1] + bb[3]) / 2, lng = (bb[0] + bb[2]) / 2;
            var r = Math.max(dist(lat, lng, bb[1], bb[0]), dist(lat, lng, bb[3], bb[2])) + 500;
            if (r > 60000) return null;                   // kraj/ČR bez hranic okresu — moc buněk
            return O.body(lat, lng, r).then(function (items) {
                var st = { okres: okres, cat: { TB: 0, ZHB: 0, NIVEL: 0, PBPP: 0 }, tiha: 0, porady: {}, listy: {}, vrchol: null, celkem: 0, tb: {} };
                items.forEach(function (it) {
                    var a = it.attributes || {};
                    if (String(a.NAZEV_OKRES || '').trim() !== okres) return;
                    var pt = window.agCuzkBod ? window.agCuzkBod(it.layerId, a, it.geometry.x, it.geometry.y, 0) : null;
                    if (!pt) return;
                    st.celkem++;
                    if (jeTihovy(pt)) st.tiha++; else st.cat[pt.cat] = (st.cat[pt.cat] || 0) + 1;
                    if (pt.porad) st.porady[pt.porad] = (st.porady[pt.porad] || 0) + 1;
                    if (pt.cat === 'TB' && !jeTihovy(pt)) {
                        if (pt.list) st.listy[pt.list] = (st.listy[pt.list] || 0) + 1;
                        st.tb[idBodu(pt)] = 1;
                        if (pt.vyska != null && (!st.vrchol || pt.vyska > st.vrchol.vyska)) st.vrchol = { id: idBodu(pt), name: pt.name, vyska: pt.vyska, ku: pt.ku };
                    }
                });
                _statCache[okres] = st;
                return st;
            });
        }).catch(function (e) { swallow(e, 'lovci:statOkresu'); return null; });
    }

    // --------------------------------------------------------------------------------
    // Ocenění (B)
    // --------------------------------------------------------------------------------
    function oceneni(st) {
        var n = _nalezy, tb = n.filter(function (x) { return x.cat === 'TB' && !x.tiha; });
        var listy = {}; tb.forEach(function (x) { if (x.list) listy[x.list] = (listy[x.list] || 0) + 1; });
        var maxList = 0; for (var k in listy) if (listy[k] > maxList) maxList = listy[k];
        var porady = {}; n.forEach(function (x) { if (x.porad) porady[x.porad] = (porady[x.porad] || 0) + 1; });
        var out = [
            { id: 'prvni-kamen', znak: 'TB', nazev: 'První kámen', jak: 'najdi první trigonometrický bod', ma: tb.length >= 1, p: Math.min(1, tb.length), txt: tb.length + ' z 1' },
            { id: 'tucet', znak: '12', nazev: 'Tucet', jak: '12 objevených bodů', ma: n.length >= 12, p: Math.min(1, n.length / 12), txt: n.length + ' z 12' },
            { id: 'stovka', znak: '100', nazev: 'Stovka', jak: '100 objevených bodů', ma: n.length >= 100, p: Math.min(1, n.length / 100), txt: n.length + ' z 100' },
            { id: 'trojuhelnik', znak: '▲', nazev: 'Trojúhelník', jak: 'tři TB z jednoho triangulačního listu', ma: maxList >= 3, p: Math.min(1, maxList / 3), txt: maxList + ' z 3' },
            { id: 'kamen-z-budovy', znak: 'g', nazev: 'Kámen z budovy', jak: 'tíhový bod (bývá v budově — jen se svolením)', ma: n.some(function (x) { return x.tiha; }), p: n.some(function (x) { return x.tiha; }) ? 1 : 0, txt: n.some(function (x) { return x.tiha; }) ? '1 z 1' : '0 z 1' }
        ];
        // ocenění, která potřebují úplnost okresu (balíček)
        var nejPorad = null, nejP = 0;
        if (st) {
            for (var pr in st.porady) { var m = (porady[pr] || 0) / st.porady[pr]; if (m > nejP || !nejPorad) { nejP = m; nejPorad = pr; } }
            var hotovyPorad = null; for (var pr2 in st.porady) if ((porady[pr2] || 0) >= st.porady[pr2]) hotovyPorad = pr2;
            out.push({ id: 'cely-porad', znak: 'KP', nazev: 'Celý pořad', jak: 'všechny body jednoho nivelačního pořadu (' + esc(nejPorad || '?') + ')', ma: !!hotovyPorad, p: Math.min(1, nejP), txt: nejPorad ? (porady[nejPorad] || 0) + ' z ' + st.porady[nejPorad] + ' · ' + nejPorad : '—' });
            var tbOk = tb.filter(function (x) { return x.okres === st.okres; }).length;
            out.push({ id: 'okres', znak: 'OK', nazev: 'Okres ' + st.okres, jak: 'všechny TB v okrese', ma: st.cat.TB > 0 && tbOk >= st.cat.TB, p: st.cat.TB ? Math.min(1, tbOk / st.cat.TB) : 0, txt: tbOk + ' z ' + st.cat.TB });
            if (st.vrchol) out.push({ id: 'vrchol', znak: '⛰', nazev: 'Vrchol okresu', jak: 'nejvýš položený TB okresu: ' + esc(st.vrchol.name) + ' (' + esc(st.vrchol.ku || '') + ', ' + Math.round(st.vrchol.vyska) + ' m)', ma: !!_ix[st.vrchol.id], p: _ix[st.vrchol.id] ? 1 : 0, txt: _ix[st.vrchol.id] ? 'máš' : Math.round(st.vrchol.vyska) + ' m' });
        } else {
            out.push({ id: 'cely-porad', znak: 'KP', nazev: 'Celý pořad', jak: 'všechny body jednoho nivelačního pořadu — potřebuje stažený okres', ma: false, p: 0, txt: 'stáhni okres' });
            out.push({ id: 'okres', znak: 'OK', nazev: 'Okres', jak: 'všechny TB v okrese — potřebuje stažený okres', ma: false, p: 0, txt: 'stáhni okres' });
        }
        return out;
    }

    // --------------------------------------------------------------------------------
    // Lov (C): neobjevené body v okolí, kámen dne
    // --------------------------------------------------------------------------------
    function normalizuj(items) {
        var out = [];
        items.forEach(function (it) {
            var pt = window.agCuzkBod ? window.agCuzkBod(it.layerId, it.attributes, it.geometry.x, it.geometry.y, 0) : null;
            if (pt) out.push(pt);
        });
        return out;
    }
    // body do r metrů: z balíčku (když je), jinak z arPoints
    function okoli(lat, lng, r) {
        var O = window.AGOblasti;
        if (O && O.pokryto && O.pokryto(lat, lng)) return O.body(lat, lng, r).then(normalizuj).catch(function () { return []; });
        return Promise.resolve((pts() || []).filter(jeUredni));
    }
    var _kdCache = { k: '', v: null };
    function kamenDne() { return _kdCache.v; }
    function spocitejKamenDne(lat, lng, body) {
        var okres = mujOkres() || '';
        var k = dnes() + '|' + okres;
        if (_kdCache.k === k && _kdCache.v) return _kdCache.v;
        var kand = body.filter(function (p) { return (p.cat === 'TB' || p.cat === 'ZHB') && !jeTihovy(p) && dist(lat, lng, p.lat, p.lng) <= 3000; });
        kand.sort(function (a, b) { return idBodu(a) < idBodu(b) ? -1 : 1; });
        var v = kand.length ? kand[hash(k) % kand.length] : null;
        _kdCache = { k: k, v: v ? { id: idBodu(v), pt: v } : null };
        return _kdCache.v;
    }
    function lov(lat, lng) {
        return okoli(lat, lng, 2000).then(function (body) {
            var kd = spocitejKamenDne(lat, lng, body);
            var list = body.filter(function (p) { return !nalezen(p); }).map(function (p) {
                var d = dist(lat, lng, p.lat, p.lng), h = hodnota(p);
                return { pt: p, d: d, hod: h, kd: !!(kd && kd.id === idBodu(p)), tiha: jeTihovy(p), w: (h * (kd && kd.id === idBodu(p) ? 2 : 1)) / (1 + d / 500) };
            });
            list.sort(function (a, b) { return b.w - a.w; });
            return { list: list.slice(0, 12), kd: kd, celkem: body.length, neobj: list.length };
        });
    }
    // navigace na bod z lovu: bod musí být v arPoints (z balíčku být nemusí)
    function doved(pt) {
        var P = pts(); if (!P) return;
        var id = idBodu(pt), cil = null;
        for (var i = 0; i < P.length; i++) if (jeUredni(P[i]) && idBodu(P[i]) === id) { cil = P[i]; break; }
        if (!cil) { cil = pt; P.push(cil); }
        try { if (typeof highlightPoint === 'function') highlightPoint(cil); } catch (e) { swallow(e, 'lovci:doved'); }
        try { if (window.AGDosah && AGDosah.vzdy) AGDosah.vzdy(cil.id); } catch (e) { }
        try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { }
        close();
        toast('Navádím na ' + katLabel(cil.cat) + ' ' + cil.name + ' — ' + Math.round(dist(fix() ? fix().lat : cil.lat, fix() ? fix().lng : cil.lng, cil.lat, cil.lng)) + ' m.');
    }

    // --------------------------------------------------------------------------------
    // UI
    // --------------------------------------------------------------------------------
    function build() {
        if (_ov && document.body.contains(_ov)) return _ov;
        _ov = document.createElement('div');
        _ov.className = 'modal-overlay agl-overlay'; _ov.id = 'agl-modal';
        _ov.innerHTML =
            '<div class="modal-content agl-content" role="dialog" aria-modal="true" aria-labelledby="agl-title">' +
            '  <h3 class="agl-title" id="agl-title">Lovci bodů</h3>' +
            '  <div class="agl-seg" role="tablist"><button type="button" data-seg="sbirka" role="tab">Sbírka</button><button type="button" data-seg="oceneni" role="tab">Ocenění</button><button type="button" data-seg="lov" role="tab">Lovit</button></div>' +
            '  <div class="modal-body agl-body" id="agl-body"></div>' +
            '  <button type="button" class="btn btn-secondary" id="agl-close">Zavřít</button>' +
            '</div>';
        document.body.appendChild(_ov);
        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov) close(); });
        _ov.querySelector('#agl-close').addEventListener('click', close);
        _ov.querySelector('.agl-seg').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-seg]') : null; if (!b) return;
            _seg = b.getAttribute('data-seg'); render();
        });
        _ov.querySelector('#agl-body').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-act]') : null; if (!b) return;
            var act = b.getAttribute('data-act');
            if (act === 'doved') { var p = _lovList[parseInt(b.getAttribute('data-i'), 10)]; if (p) doved(p.pt); }
            else if (act === 'oblasti') { close(); if (window.AGOblasti && AGOblasti.open) AGOblasti.open(); else toast('Nástroj Stáhnout oblast je ve verzi Pro.'); }
            else if (act === 'odebrat') { var id = b.getAttribute('data-id'); odebrat(id).then(function () { render(); try { drawAllMarkersOnMap(); } catch (e) { } }); }
        });
        return _ov;
    }
    var _lovList = [];
    function render() {
        _ov.querySelectorAll('.agl-seg button').forEach(function (b) { var on = b.getAttribute('data-seg') === _seg; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
        var host = _ov.querySelector('#agl-body');
        var okres = mujOkres();
        if (_seg === 'sbirka') {
            host.innerHTML = '<div class="agl-dim">Počítám…</div>';
            statOkresu(okres).then(function (st) {
                var cats = ['TB', 'ZHB', 'NIVEL', 'PBPP'], m = { TB: 0, ZHB: 0, NIVEL: 0, PBPP: 0 }, tiha = 0, vOkrese = 0;
                _nalezy.forEach(function (n) { if (n.tiha) tiha++; else m[n.cat] = (m[n.cat] || 0) + 1; if (st && n.okres === st.okres) vOkrese++; });
                var h = '<div class="agl-sum"><div><b class="agl-big">' + num(_nalezy.length) + '</b><small>objevených bodů</small></div><div><b class="agl-big">' + num(skore()) + '</b><small>skóre</small></div></div>';
                if (st) {
                    h += '<div class="agl-lbl">' + esc(st.okres) + '</div><div class="agl-row"><span>Objeveno v okrese</span><b class="agl-mono">' + num(vOkrese) + ' z ' + num(st.celkem) + '</b></div><div class="agl-bar"><i style="width:' + Math.min(100, vOkrese / Math.max(1, st.celkem) * 100).toFixed(1) + '%"></i></div>';
                    cats.forEach(function (c) { var v = _nalezy.filter(function (n) { return n.cat === c && !n.tiha && n.okres === st.okres; }).length; h += '<div class="agl-row"><span><span class="agl-pill p-' + c.toLowerCase() + '">' + katLabel(c) + '</span></span><b class="agl-mono">' + num(v) + ' z ' + num(st.cat[c] || 0) + '</b></div>'; });
                    if (st.tiha) h += '<div class="agl-row"><span><span class="agl-pill p-tiha">tíhový</span></span><b class="agl-mono">' + tiha + ' z ' + st.tiha + '</b></div>';
                } else {
                    h += '<div class="agl-lbl">Podle druhu</div>';
                    cats.forEach(function (c) { h += '<div class="agl-row"><span><span class="agl-pill p-' + c.toLowerCase() + '">' + katLabel(c) + '</span></span><b class="agl-mono">' + num(m[c]) + '</b></div>'; });
                    if (tiha) h += '<div class="agl-row"><span><span class="agl-pill p-tiha">tíhový</span></span><b class="agl-mono">' + tiha + '</b></div>';
                    h += '<div class="agl-note">Kolik bodů má okres a kolik ti chybí, ukážu, až bude okres v telefonu: <button type="button" class="agl-link" data-act="oblasti">Stáhnout oblast</button>' + (okres ? '' : ' (a až budu vědět, kde stojíš)') + '.</div>';
                }
                h += '<div class="agl-lbl">Poslední nálezy</div>';
                if (!_nalezy.length) h += '<div class="agl-note">Zatím nic. Otevři kartu úředního bodu, dojdi k němu (do 5 m, ' + POSTOJ_S + ' s) a klepni <b>Našel jsem ho</b>.</div>';
                _nalezy.slice().reverse().slice(0, 40).forEach(function (n) {
                    h += '<div class="agl-item"><div><span class="agl-pill p-' + (n.tiha ? 'tiha' : n.cat.toLowerCase()) + '">' + (n.tiha ? 'tíhový' : katLabel(n.cat)) + '</span> <b>' + esc(n.name) + '</b><small>' + esc([n.ku, n.okres].filter(Boolean).join(' · ')) + ' · ' + new Date(n.kdy).toLocaleDateString('cs-CZ') + (n.kdo ? ' · ' + esc(n.kdo) : '') + '</small></div><div class="agl-mono">+' + n.hod + '</div><button type="button" class="agl-x" data-act="odebrat" data-id="' + esc(n.id) + '" aria-label="Odebrat">✕</button></div>';
                });
                host.innerHTML = h;
            });
        } else if (_seg === 'oceneni') {
            host.innerHTML = '<div class="agl-dim">Počítám…</div>';
            statOkresu(okres).then(function (st) {
                var o = oceneni(st), ma = o.filter(function (x) { return x.ma; }), ne = o.filter(function (x) { return !x.ma; });
                ne.sort(function (a, b) { return b.p - a.p; });
                var h = '<div class="agl-sum"><div><b class="agl-big">' + ma.length + ' z ' + o.length + '</b><small>ocenění</small></div></div>';
                if (ne.length && ne[0].p > 0) h += '<div class="agl-lbl">Nejblíž máš</div>' + karta(ne[0], true);
                h += '<div class="agl-lbl">Získaná</div>' + (ma.length ? ma.map(function (x) { return karta(x, false); }).join('') : '<div class="agl-note">Zatím žádné — první přijde s prvním trigonometrickým bodem.</div>');
                h += '<div class="agl-lbl">Zbývají</div>' + ne.map(function (x) { return karta(x, true); }).join('');
                if (!st) h += '<div class="agl-note">Celý pořad, Okres a Vrchol umím spočítat, až bude okres v telefonu: <button type="button" class="agl-link" data-act="oblasti">Stáhnout oblast</button>.</div>';
                host.innerHTML = h;
            });
        } else {
            var f = fix();
            if (!f) { host.innerHTML = '<div class="agl-note">Lov potřebuje polohu — počkej na GPS.</div>'; return; }
            host.innerHTML = '<div class="agl-dim">Hledám neobjevené body do 2 km…</div>';
            lov(f.lat, f.lng).then(function (r) {
                _lovList = r.list;
                var h = '<div class="agl-sum"><div><b class="agl-big">' + num(r.neobj) + '</b><small>neobjevených do 2 km</small></div><div><b class="agl-big">' + num(skore()) + '</b><small>skóre</small></div></div>';
                if (r.kd) h += '<div class="agl-kd">★ Kámen dne: <b>' + katLabel(r.kd.pt.cat) + ' ' + esc(r.kd.pt.name) + '</b>' + (r.kd.pt.ku ? ' · ' + esc(r.kd.pt.ku) : '') + ' — dnes za dvojnásobek' + (nalezen(r.kd.pt) ? ' (máš!)' : '') + '</div>';
                h += '<div class="agl-note agl-small">Hodnota podle vzácnosti v ČR: TB 50 · ZhB 30 · nivelační 10 · PPBP 3 · tíhový 200. Řazeno podle výnosu na ušlý metr. Na cizí pozemek jen se svolením; body v ohradách a na střechách přeskoč.</div>';
                if (!r.list.length) h += '<div class="agl-note">V okolí není nic neobjeveného' + (r.celkem ? '' : ' — nebo tu nejsou načtené body (zkus Stáhnout oblast)') + '.</div>';
                r.list.forEach(function (x, i) {
                    h += '<div class="agl-item' + (x.kd ? ' kd' : '') + '"><div><span class="agl-pill p-' + (x.tiha ? 'tiha' : x.pt.cat.toLowerCase()) + '">' + (x.tiha ? 'tíhový' : katLabel(x.pt.cat)) + '</span> <b>' + esc(x.pt.name) + '</b>' + (x.kd ? ' ★' : '') + (x.tiha ? ' <i>nedostupný?</i>' : '') + '<small>' + esc(x.pt.ku || '') + (x.pt.druh ? ' · ' + esc(x.pt.druh) : '') + '</small></div><div class="agl-mono">+' + (x.hod * (x.kd ? 2 : 1)) + '<small>' + (x.d < 1000 ? Math.round(x.d) + ' m' : (x.d / 1000).toFixed(1).replace('.', ',') + ' km') + '</small></div><button type="button" class="btn btn-secondary agl-mini" data-act="doved" data-i="' + i + '">Doveď mě</button></div>';
                });
                host.innerHTML = h;
            });
        }
    }
    function karta(o, sPostupem) {
        return '<div class="agl-oc' + (o.ma ? ' ma' : '') + '"><span class="agl-stone">' + esc(o.znak) + '</span><div><b>' + esc(o.nazev) + '</b><small>' + o.jak + '</small>' + (sPostupem ? '<div class="agl-bar"><i style="width:' + (o.p * 100).toFixed(0) + '%"></i></div>' : '') + '</div><span class="agl-mono">' + esc(o.txt) + '</span></div>';
    }
    function open() { build(); _ov.style.display = 'flex'; (_loaded ? Promise.resolve() : load()).then(render); }
    function close() { if (_ov) _ov.style.display = 'none'; }

    // --------------------------------------------------------------------------------
    // Vstup + tik
    // --------------------------------------------------------------------------------
    window.AGLovci = { open: open, klik: klik, nalezen: nalezen, stav: stav, idBodu: idBodu, hodnota: hodnota, nalezy: function () { return _nalezy.slice(); }, oceneni: oceneni, kamenDne: kamenDne, lov: lov, _load: load };
    window.agOpenLovci = open;

    function injectTile() {
        if (typeof window.agRegisterFieldTool !== 'function') return false;
        window.agRegisterFieldTool({ id: 'lovci-bodu', label: 'Lovci bodů', icon: ICON, cat: 'Pomůcky', onClick: open, order: 9 });
        return true;
    }
    function init() {
        load();
        if (!injectTile()) { var n = 0, t = setInterval(function () { if (injectTile() || ++n > 40) clearInterval(t); }, 500); }
        (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () { try { tik(); } catch (e) { swallow(e, 'lovci:tik'); } }, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
