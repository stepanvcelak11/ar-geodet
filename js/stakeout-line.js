// ===== AR Geodet — VYTYČENÍ OSY + STANIČENÍ (ODPOJITELNÁ vrstva) ==============
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Pro liniové stavby:
// zadáš OSU (dva body = přímka, víc bodů = lomená osa) a appka ti za chůze
// ukazuje:
//   • STANIČENÍ — jak daleko jsi od začátku osy PODÉL ní (i přes lomy),
//   • KOLMÝ ODSTUP — jak jsi vlevo/vpravo od osy,
//   • ZBÝVÁ do konce + do nejbližšího lomu.
// Umí i obráceně VYTYČIT bod na zadaném staničení (+ kolmý posun) a uložit ho,
// nebo NASYPAT KOLÍKY po pravidelném kroku (po 10 m, po 25 m…) na celou osu.
//
// 5. 9. 2026 — do téhle verze uměl nástroj JEN přímku A→B. U pokládky silnice je
// ale denní chleba lomená osa se staničením od začátku úseku (a se staničením
// počátku, ať čísla sedí s projektem: osa začíná třeba na km 1,200). Proto:
//   • vrcholů je libovolně (2..30), přidávají se tlačítkem,
//   • staničení běží PŘES LOMY (kumulativně od prvního vrcholu),
//   • „staničení počátku" posune čísla na projektovou kilometráž,
//   • odečet si sám najde ÚSEK, na kterém právě stojíš (nejbližší bod osy).
//
// Výpočet je v lokální rovině v metrech kolem PRVNÍHO vrcholu (přesné na osy
// v km). Vstup: tlačítko „Vytyčení osy" v launcheru (js/field-tools.js).
// Odstranění: smaž js/stakeout-line.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20 10 9l5 6 6-11"/><circle cx="3" cy="20" r="2.2" fill="currentColor"/><circle cx="10" cy="9" r="1.8" fill="currentColor"/><circle cx="15" cy="15" r="1.8" fill="currentColor"/><circle cx="21" cy="4" r="2.2" fill="currentColor"/></svg>';
    var MAX_V = 30;             // strop vrcholů — víc je náčrt, ne osa
    var MAX_BATCH = 400;        // strop kolíků z jednoho nasypání
    var _ids = [];              // id vrcholů osy v pořadí (min. 2)
    var _timer = null;

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line:agAlert'); } alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    // cteni cisel pres sdilene agNum() (js/vstupy.js) — desetinna carka, mezery v tisicich
    function num(id) { var el = document.getElementById(id); if (!el) return NaN; var v = (typeof window.agNum === 'function') ? window.agNum(el) : parseFloat(String(el.value).replace(',', '.')); return isFinite(v) ? v : NaN; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    // staničení počátku — čísla mají sedět s projektem (osa začíná na km 1,200)
    function startStation() { var v = num('agsl-s0'); return isFinite(v) ? v : 0; }
    // 25 -> "25", 25.5 -> "25.5" (do názvu bodu, ať nevznikne "ST25.00")
    function shortNum(v) { return (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, ''); }

    // ---- draft (AGDraft je odpojitelný, vše fail-silent) -----------------------
    // Volá se JEN z uživatelských handlerů (change/input) → každý zápis = reálný
    // krok uživatele; auto-předvyplněné vrcholy z renderVerts() se samo nedraftuje.
    var DRAFT_KEY = 'vytyc-primka';
    function _val(id) { var el = document.getElementById(id); return el ? String(el.value) : ''; }
    function draftSave() {
        if (!window.AGDraft) return;
        try {
            var g = geometry();
            window.AGDraft.save(DRAFT_KEY,
                { ids: _ids.slice(), aId: _ids[0], bId: _ids[_ids.length - 1], s0: _val('agsl-s0'), stat: _val('agsl-stat'), off: _val('agsl-off'), name: _val('agsl-name') },
                'Vytyčení osy' + (g ? ' #' + g.A.name + '→#' + g.B.name + (g.bent ? ' (' + g.segs.length + ' úseky)' : '') : ''));
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line:draftSave'); }
    }
    function draftClear() { if (window.AGDraft) try { window.AGDraft.clear(DRAFT_KEY); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line:draftClear'); } }
    function ptById(id) { if (typeof arPoints === 'undefined') return null; return arPoints.find(function (q) { return q.id === id; }) || (typeof persistentCustomPoints !== 'undefined' ? persistentCustomPoints.find(function (q) { return q.id === id; }) : null) || null; }

    // lokální rovinné metry kolem referenčního bodu (lat0,lng0);
    // poloměry křivosti elipsoidu (GeoCore) místo konstanty 111320 (~0,15 % chyba)
    function _mpd(lat0) {
        return (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) ? GeoCore.metersPerDeg(lat0) : { lat: 111320, lng: 111320 * Math.cos(lat0 * Math.PI / 180) };
    }
    function enu(lat0, lng0, lat, lng) {
        var m = _mpd(lat0);
        return { e: (lng - lng0) * m.lng, n: (lat - lat0) * m.lat };
    }
    function fromEnu(lat0, lng0, e, n) {
        var m = _mpd(lat0);
        return { lat: lat0 + n / m.lat, lng: lng0 + e / m.lng };
    }

    // ---- geometrie osy ---------------------------------------------------------
    // Vrací superset toho, co vracela verze s jedinou přímkou (A, B, len, uE, uN),
    // aby vykreslení v AR (js/stakeout-line-ar.js) jelo dál beze změny smlouvy.
    //   segs[i] = { s0, len, e0, n0, uE, uN, a, b }   — s0 = staničení začátku úseku
    //   verts[i] = { p, e, n, s }                     — s = staničení vrcholu
    // Souřadnice jsou v rovině kolem PRVNÍHO vrcholu (g.o), ne kolem g.A — u lomené
    // osy by „kolem A" nedávalo smysl u dalších úseků.
    function geometry() {
        if (_ids.length < 2) return null;
        var raw = [], i;
        for (i = 0; i < _ids.length; i++) { var p = ptById(_ids[i]); if (p) raw.push(p); }
        if (raw.length < 2) return null;
        var o = raw[0];
        var verts = [], segs = [], acc = 0;
        for (i = 0; i < raw.length; i++) {
            var u = enu(o.lat, o.lng, raw[i].lat, raw[i].lng);
            // dva vrcholy na sobě (omylem vybraný týž bod dvakrát) úsek netvoří
            if (verts.length) {
                var pv = verts[verts.length - 1];
                if (Math.hypot(u.e - pv.e, u.n - pv.n) < 0.001) continue;
            }
            verts.push({ p: raw[i], e: u.e, n: u.n, s: 0 });
        }
        if (verts.length < 2) return null;
        for (i = 0; i + 1 < verts.length; i++) {
            var dE = verts[i + 1].e - verts[i].e, dN = verts[i + 1].n - verts[i].n;
            var L = Math.hypot(dE, dN);
            segs.push({ s0: acc, len: L, e0: verts[i].e, n0: verts[i].n, uE: dE / L, uN: dN / L, a: verts[i].p, b: verts[i + 1].p });
            acc += L;
            verts[i + 1].s = acc;
        }
        return {
            o: o, A: verts[0].p, B: verts[verts.length - 1].p,
            verts: verts, segs: segs, len: acc, bent: segs.length > 1,
            // zpětná kompatibilita s jedinou přímkou (první úsek)
            uE: segs[0].uE, uN: segs[0].uN
        };
    }

    // Bod na ose ve staničení `station` (od začátku osy, BEZ staničení počátku),
    // kolmo odsazený o `offset` (+ vlevo, − vpravo ve směru daného úseku).
    // Mimo osu se pokračuje po krajním úseku (přesah před začátkem i za koncem).
    // U lomu je odsazený bod na kolmici toho úseku, na kterém staničení leží —
    // v ostrém lomu proto odsazená čára „přeskočí", stejně jako u totálky.
    function pointAt(g, station, offset) {
        var o = offset || 0, i, sg = g.segs[0];
        for (i = 0; i < g.segs.length; i++) {
            sg = g.segs[i];
            if (station <= sg.s0 + sg.len || i === g.segs.length - 1) break;
        }
        var t = station - sg.s0;
        var e = sg.e0 + t * sg.uE + o * (-sg.uN);
        var n = sg.n0 + t * sg.uN + o * (sg.uE);
        return fromEnu(g.o.lat, g.o.lng, e, n);
    }

    // Kde na ose leží zadaná poloha: staničení od začátku a kolmý odstup (+ vlevo).
    // U lomené osy rozhoduje NEJBLIŽŠÍ bod osy — projekce se počítá na každý úsek
    // (uvnitř osy oříznutá na jeho délku, na krajních úsecích s přesahem, ať jde
    // číst i „ještě před osou" / „už za koncem"), vyhraje ta s nejmenší vzdáleností.
    function stationOf(g, lat, lng) {
        var u = enu(g.o.lat, g.o.lng, lat, lng), best = null, i;
        for (i = 0; i < g.segs.length; i++) {
            var s = g.segs[i], dE = u.e - s.e0, dN = u.n - s.n0;
            var t = dE * s.uE + dN * s.uN;
            var off = s.uE * dN - s.uN * dE;
            var tc = t;
            if (i > 0) tc = Math.max(0, tc);
            if (i < g.segs.length - 1) tc = Math.min(s.len, tc);
            var d = Math.hypot(t - tc, off);
            if (!best || d < best.d) best = { d: d, station: s.s0 + tc, offset: off, seg: i };
        }
        return { station: best.station, offset: best.offset, seg: best.seg, d: best.d };
    }

    // ---- výběr vrcholů ---------------------------------------------------------
    function pointOptions() {
        if (typeof arPoints === 'undefined') return [];
        return arPoints.filter(function (p) { return !p.hidden; })
            .map(function (p) { return { p: p, d: (typeof userLat !== 'undefined' && userLat != null) ? getDistance(userLat, userLng, p.lat, p.lng) : null }; })
            .sort(function (a, b) { return (a.d == null || b.d == null) ? 0 : a.d - b.d; });
    }
    function renderVerts() {
        var box = document.getElementById('agsl-verts'); if (!box) return;
        var list = pointOptions();
        // první otevření (nebo body, které mezitím zmizely) → dva nejbližší
        if (list.length) {
            _ids = _ids.filter(function (id) { return list.some(function (x) { return x.p.id === id; }); });
            while (_ids.length < 2) _ids.push((list[_ids.length] || list[list.length - 1]).p.id);
        }
        var opts = list.map(function (x) { return '<option value="' + esc(x.p.id) + '">#' + esc(x.p.name) + (x.d != null ? ' · ' + x.d.toFixed(0) + ' m' : '') + '</option>'; }).join('');
        var html = _ids.map(function (id, i) {
            var role = i === 0 ? 'začátek' : (i === _ids.length - 1 ? 'konec' : 'lom');
            return '<div class="agsl-row">'
                + '<span class="agsl-n" aria-hidden="true">' + (i + 1) + '</span>'
                + '<select data-i="' + i + '" aria-label="Vrchol ' + (i + 1) + ' (' + role + ')">' + opts + '</select>'
                + (_ids.length > 2 ? '<button type="button" class="agsl-x" data-i="' + i + '" aria-label="Odebrat vrchol ' + (i + 1) + '">&times;</button>' : '<span class="agsl-x agsl-x-off" aria-hidden="true"></span>')
                + '</div>';
        }).join('');
        box.innerHTML = html;
        // hodnoty až po vložení do DOM — <select>.value chce mít existující <option>
        Array.prototype.forEach.call(box.querySelectorAll('select'), function (sel, i) { sel.value = _ids[i]; });
        var add = document.getElementById('agsl-add');
        if (add) add.style.display = (_ids.length >= MAX_V || list.length < 2) ? 'none' : '';
    }

    function refresh() {
        var g = geometry();
        var live = document.getElementById('agsl-live');
        var head = document.getElementById('agsl-lineinfo');
        if (!g) { if (live) live.innerHTML = '<span style="opacity:.6">Vyber aspoň dva různé body osy.</span>'; if (head) head.innerHTML = ''; return; }
        var s0 = startStation();
        if (head) head.innerHTML = (g.bent ? 'Lomená osa #' : 'Přímka #') + esc(g.A.name) + ' → #' + esc(g.B.name)
            + (g.bent ? ' · ' + g.segs.length + ' úseky' : '')
            + ' · délka <b>' + g.len.toFixed(2) + ' m</b>'
            + (s0 ? ' · staničení ' + shortNum(s0) + '–' + shortNum(s0 + g.len) : '');
        if (typeof userLat === 'undefined' || userLat == null) { if (live) live.innerHTML = '<span style="opacity:.6">Čekám na GPS polohu…</span>'; return; }
        var me = stationOf(g, userLat, userLng);
        var station = me.station;                          // podél osy od začátku
        var offset = me.offset;                            // + = vlevo ve směru osy
        var remain = g.len - station;
        var side = offset >= 0 ? 'vlevo' : 'vpravo';
        var offCol = Math.abs(offset) <= 0.30 ? '#34d399' : (Math.abs(offset) <= 1 ? '#fbbf24' : '#f87171');
        function row(l, v, col) {
            return '<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;"><span>' + l + '</span><b' + (col ? ' style="color:' + col + '"' : '') + '>' + v + '</b></div>';
        }
        // Pořadí řádků drží i sbalený proužek (js/mini-panel.js čte #agsl-live a bere
        // první dva) — staničení a odstup proto musí zůstat nahoře.
        var html = row('Staničení', (station + s0).toFixed(2) + ' m')
            + row('Kolmý odstup', Math.abs(offset).toFixed(2) + ' m ' + side, offCol);
        if (g.bent) {
            var sg = g.segs[me.seg];
            var doLomu = (sg.s0 + sg.len) - station;
            html += row('Úsek ' + (me.seg + 1) + '/' + g.segs.length, '#' + esc(sg.a.name) + ' → #' + esc(sg.b.name));
            if (me.seg < g.segs.length - 1 && doLomu > 0) html += row('Do lomu #' + esc(sg.b.name), doLomu.toFixed(2) + ' m');
        }
        html += '<div style="display:flex;justify-content:space-between;gap:10px;"><span>Zbývá do #' + esc(g.B.name) + '</span><b>' + remain.toFixed(2) + ' m</b></div>';
        if (live) live.innerHTML = html;
    }

    // Y/X v S-JTSK k vytyčovanému bodu. Bez proj4 se bod pořád dá uložit, jen se
    // souřadnice neukážou — dřív by tady celý výpočet spadl.
    function sjtsk(lat, lng) {
        try {
            if (typeof GeoCore !== 'undefined' && GeoCore.toSJTSK) {
                var r = GeoCore.toSJTSK(lat, lng);
                if (r && isFinite(r.y) && isFinite(r.x)) return { Y: r.y.toFixed(2), X: r.x.toFixed(2) };
            }
            if (typeof proj4 === 'function') {
                var sj = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]);
                return { Y: Math.abs(sj[0]).toFixed(2), X: Math.abs(sj[1]).toFixed(2) };
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line:sjtsk'); }
        return null;
    }

    // silent = jen náhled (otevření nástroje, psaní do políčka) → nehlásit prázdná pole;
    // hláška patří až k pokusu o uložení, jinak vyskočí dřív, než uživatel stihne cokoli zadat.
    function computeStakePoint(silent) {
        var g = geometry(); if (!g) { if (!silent) agAlert('Chybí osa', 'Vyber aspoň dva různé body.'); return null; }
        var sAbs = num('agsl-stat'); if (isNaN(sAbs)) { if (!silent) agAlert('Chybí staničení', 'Zadej staničení v metrech.'); return null; }
        var o = num('agsl-off'); if (isNaN(o)) o = 0;   // + = VLEVO, − = vpravo (SHODNĚ se živým odečtem)
        var s = sAbs - startStation();                  // vnitřně se počítá od začátku osy
        var ll = pointAt(g, s, o);
        var yx = sjtsk(ll.lat, ll.lng);
        return { lat: ll.lat, lng: ll.lng, Y: yx ? yx.Y : null, X: yx ? yx.X : null, s: s, sAbs: sAbs, o: o, g: g };
    }
    function previewStake() {
        var r = computeStakePoint(true); var out = document.getElementById('agsl-stake-out'); if (!out) return;
        if (!r) { out.innerHTML = ''; return; }
        var mimo = (r.s < -0.005 || r.s > r.g.len + 0.005)
            ? '<br><span style="color:#fbbf24;font-size:calc(12px * var(--ag-font-scale, 1))">mimo osu — bod leží v prodloužení krajního úseku</span>' : '';
        out.innerHTML = (r.Y ? '<b>Y</b> ' + r.Y + ' &nbsp; <b>X</b> ' + r.X : '<span style="opacity:.65">S-JTSK není k dispozici</span>')
            + '<br><span style="opacity:.65;font-size:calc(12px * var(--ag-font-scale, 1))">staničení ' + r.sAbs.toFixed(2) + ' m'
            + (r.o ? ', odstup ' + Math.abs(r.o).toFixed(2) + ' m ' + (r.o > 0 ? 'vlevo' : 'vpravo') : ' na ose') + '</span>' + mimo;
    }
    function saveStake() {
        var r = computeStakePoint(); if (!r) return;
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Vkládání bodů není dostupné.'); return; }
        var name = (document.getElementById('agsl-name').value || '').trim() || ('ST' + shortNum(r.sAbs));
        var added = window.addImportedPoints([{ name: name, lat: r.lat, lng: r.lng }]);
        if (added > 0) { draftClear(); agAlert('Bod uložen', '#' + name + ' (staničení ' + r.sAbs.toFixed(2) + ' m) uložen do zakázky.\nNavigovat můžeš přes seznam Body.'); }
        else agAlert('Neuloženo', 'Bod se stejným názvem a polohou už v zakázce je.');
    }

    // ---- kolíky po kroku -------------------------------------------------------
    // Vytyčovací body po celé ose najednou: krok 10 m, 25 m… První kolík padne na
    // nejbližší CELÝ násobek kroku (staničení 1200 při kroku 25 → 1200, 1225, …),
    // ať čísla sedí s projektem, ne s tím, kde zrovna začíná osa.
    function batchStations() {
        var g = geometry(); if (!g) return null;
        var step = num('agsl-step');
        if (!isFinite(step) || step <= 0) return null;
        var s0 = startStation();
        var first = Math.ceil((s0 - 1e-6) / step) * step;     // první násobek kroku uvnitř osy
        var out = [], sAbs;
        for (sAbs = first; sAbs <= s0 + g.len + 1e-6; sAbs += step) {
            out.push(Math.round(sAbs * 1000) / 1000);
            if (out.length > MAX_BATCH) break;
        }
        // konec osy se vytyčuje vždycky — poslední kolík u finišeru nesmí chybět
        var end = Math.round((s0 + g.len) * 1000) / 1000;
        if (!out.length || Math.abs(out[out.length - 1] - end) > 0.01) out.push(end);
        return { g: g, step: step, list: out };
    }
    function previewBatch() {
        var out = document.getElementById('agsl-batch-out'); if (!out) return;
        var b = batchStations();
        if (!b) { out.innerHTML = '<span style="opacity:.6">Zadej krok v metrech (např. 25).</span>'; return; }
        var o = num('agsl-boff'); if (!isFinite(o)) o = 0;
        var over = b.list.length > MAX_BATCH;
        out.innerHTML = '<b>' + b.list.length + '</b> kolíků · staničení ' + shortNum(b.list[0]) + ' … ' + shortNum(b.list[b.list.length - 1])
            + (o ? '<br><span style="opacity:.65;font-size:calc(12px * var(--ag-font-scale, 1))">odsazené ' + Math.abs(o).toFixed(2) + ' m ' + (o > 0 ? 'vlevo' : 'vpravo') + ' od osy</span>' : '')
            + (over ? '<br><span style="color:#fbbf24;font-size:calc(12px * var(--ag-font-scale, 1))">strop je ' + MAX_BATCH + ' bodů — zvětši krok</span>' : '');
    }
    function saveBatch() {
        var b = batchStations();
        if (!b) { agAlert('Chybí krok', 'Zadej, po kolika metrech se má osa vytyčit (např. 25).'); return; }
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Vkládání bodů není dostupné.'); return; }
        if (b.list.length > MAX_BATCH) { agAlert('Příliš mnoho bodů', 'Krok ' + shortNum(b.step) + ' m by na téhle ose udělal ' + b.list.length + ' bodů. Strop je ' + MAX_BATCH + ' — zvol větší krok.'); return; }
        var o = num('agsl-boff'); if (!isFinite(o)) o = 0;
        var pre = (document.getElementById('agsl-bpre').value || '').trim() || 'ST';
        var s0 = startStation(), pts = [];
        for (var i = 0; i < b.list.length; i++) {
            var ll = pointAt(b.g, b.list[i] - s0, o);
            pts.push({ name: pre + shortNum(b.list[i]), lat: ll.lat, lng: ll.lng });
        }
        var added = window.addImportedPoints(pts);
        agAlert(added > 0 ? 'Osa vytyčena' : 'Nic nepřibylo',
            added > 0
                ? added + ' z ' + pts.length + ' bodů uloženo do zakázky (' + pre + shortNum(b.list[0]) + ' … ' + pre + shortNum(b.list[b.list.length - 1]) + ').'
                    + (added < pts.length ? '\nZbytek už v zakázce byl se stejným názvem i polohou.' : '')
                    + '\nNajdeš je v seznamu Body — a vytyčovací checklist je umí odškrtávat.'
                : 'Všechny tyhle body už v zakázce jsou.');
        if (added > 0) draftClear();
    }

    var CSS = ''
        + '#agsl-modal .agsl-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;}'
        + '#agsl-modal .agsl-row select{flex:1;min-width:0;margin:0;}'
        + '#agsl-modal .agsl-n{flex:none;width:22px;text-align:center;font-weight:700;opacity:.6;'
        + 'font-size:calc(13px * var(--ag-font-scale, 1));}'
        + '#agsl-modal .agsl-x{flex:none;width:34px;height:34px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,.18));'
        + 'background:transparent;color:inherit;opacity:.7;font-size:20px;line-height:1;cursor:pointer;}'
        + '#agsl-modal .agsl-x-off{border-color:transparent;}';

    function ensureModal() {
        if (document.getElementById('agsl-modal')) return;
        var st = document.createElement('style'); st.id = 'agsl-css'; st.textContent = CSS;
        document.head.appendChild(st);
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agsl-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Vytyčení osy + staničení</h3>'
            + '<label style="display:block;">Body osy <small style="opacity:.65;font-weight:400;">v pořadí od začátku; dva = přímka, víc = lomená osa</small></label>'
            + '<div id="agsl-verts"></div>'
            + '<button type="button" class="btn btn-secondary" id="agsl-add" style="margin:2px 0 10px;"><svg class="icon"><use href="#i-plus"/></svg> Přidat lom</button>'
            + '<label style="display:block;margin-top:2px;">Staničení počátku (m) <small style="opacity:.65;font-weight:400;">0 = od začátku osy; km 1,200 zadej jako 1200</small></label>'
            + '<input type="text" id="agsl-s0" inputmode="decimal" placeholder="0">'
            + '<div id="agsl-lineinfo" style="font-size:calc(13px * var(--ag-font-scale, 1));margin:8px 0;color:var(--accent);"></div>'
            + '<div id="agsl-live" style="margin:6px 0 12px;padding:12px 14px;border-radius:10px;background:rgba(47,158,116,0.12);font-family:var(--font-mono,monospace);font-size:calc(14px * var(--ag-font-scale, 1));"></div>'
            + '<label id="agsl-arwrap" style="display:flex;align-items:center;gap:10px;margin:0 0 12px;font-size:calc(13px * var(--ag-font-scale, 1));">'
            + '  <input type="checkbox" id="agsl-ar" style="width:20px;height:20px;flex:none;">'
            + '  <span>Ukázat osu v kameře<small style="display:block;opacity:.65;font-size:calc(11.5px * var(--ag-font-scale, 1));">osa po zemi, kolmice od tebe k ose a staničení patky</small></span>'
            + '</label>'
            + '<details class="adv"><summary><svg class="icon"><use href="#i-crosshair"/></svg> Vytyčit bod na staničení</summary><div class="adv-body">'
            + '  <label>Staničení bodu (m)</label><input type="text" id="agsl-stat" step="0.01" inputmode="decimal" placeholder="např. 25.00">'
            + '  <label style="margin-top:6px;">Kolmý odstup (m, + vlevo / − vpravo)</label><input type="text" id="agsl-off" step="0.01" inputmode="decimal" placeholder="0">'
            + '  <label style="margin-top:6px;">Název bodu</label><input type="text" id="agsl-name" placeholder="ST25">'
            + '  <div id="agsl-stake-out" style="margin:10px 0;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);font-family:var(--font-mono,monospace);"></div>'
            + '  <button class="btn" id="agsl-save"><svg class="icon"><use href="#i-plus"/></svg> Uložit vytyčovaný bod</button>'
            + '</div></details>'
            + '<details class="adv"><summary><svg class="icon"><use href="#i-grid"/></svg> Vytyčit celou osu po metrech</summary><div class="adv-body">'
            + '  <p style="margin:0 0 8px;opacity:.75;font-size:calc(12.5px * var(--ag-font-scale, 1));">Nasype do zakázky kolíky po pravidelném kroku — od prvního celého násobku uvnitř osy až po její konec. Staničení počátku se bere z políčka nahoře u osy.</p>'
            + '  <label>Krok (m)</label><input type="text" id="agsl-step" inputmode="decimal" placeholder="25">'
            + '  <label style="margin-top:6px;">Kolmý odstup (m, + vlevo / − vpravo)</label><input type="text" id="agsl-boff" inputmode="decimal" placeholder="0">'
            + '  <label style="margin-top:6px;">Předpona názvu</label><input type="text" id="agsl-bpre" placeholder="ST">'
            + '  <div id="agsl-batch-out" style="margin:10px 0;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);font-family:var(--font-mono,monospace);"></div>'
            + '  <button class="btn" id="agsl-batch"><svg class="icon"><use href="#i-plus"/></svg> Nasypat kolíky do zakázky</button>'
            + '</div></details>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" onclick="window.agCloseStakeLine&&window.agCloseStakeLine()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);

        // vrcholy se překreslují (přibývají/ubývají) → posluchač na kontejneru
        var box = document.getElementById('agsl-verts');
        box.addEventListener('change', function (e) {
            var sel = e.target.closest('select'); if (!sel) return;
            _ids[+sel.getAttribute('data-i')] = sel.value;
            refresh(); previewStake(); previewBatch(); draftSave();
        });
        box.addEventListener('click', function (e) {
            var b = e.target.closest('.agsl-x'); if (!b || !b.hasAttribute('data-i')) return;
            if (_ids.length <= 2) return;         // osa pod dva vrcholy neexistuje
            _ids.splice(+b.getAttribute('data-i'), 1);
            renderVerts(); refresh(); previewStake(); previewBatch(); draftSave();
        });
        document.getElementById('agsl-add').addEventListener('click', function () {
            if (_ids.length >= MAX_V) return;
            // nový lom se vkládá PŘED konec — konec osy zůstává koncem
            _ids.splice(_ids.length - 1, 0, _ids[_ids.length - 1]);
            renderVerts(); refresh(); previewStake(); previewBatch(); draftSave();
        });
        document.getElementById('agsl-s0').addEventListener('input', function () { refresh(); previewStake(); previewBatch(); draftSave(); });
        document.getElementById('agsl-stat').addEventListener('input', function () { previewStake(); draftSave(); });
        document.getElementById('agsl-off').addEventListener('input', function () { previewStake(); draftSave(); });
        document.getElementById('agsl-name').addEventListener('input', draftSave);
        document.getElementById('agsl-save').addEventListener('click', saveStake);
        document.getElementById('agsl-step').addEventListener('input', previewBatch);
        document.getElementById('agsl-boff').addEventListener('input', previewBatch);
        document.getElementById('agsl-batch').addEventListener('click', saveBatch);
        // Vykreslení v AR je vlastní odpojitelný modul (js/stakeout-line-ar.js).
        // Když chybí, zaškrtávátko se ani neukáže — ať nenabízí něco, co nepůjde.
        var arw = document.getElementById('agsl-arwrap'), arc = document.getElementById('agsl-ar');
        if (!window.AGLineAR) { if (arw) arw.style.display = 'none'; }
        else if (arc) {
            arc.checked = window.AGLineAR.isOn();
            arc.addEventListener('change', function () { window.AGLineAR.set(this.checked); });
        }
    }

    function openTool() {
        ensureModal(); renderVerts(); refresh(); previewStake(); previewBatch();
        document.getElementById('agsl-modal').style.display = 'flex';
        if (!_timer) _timer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () { var m = document.getElementById('agsl-modal'); if (m && m.style.display === 'flex') refresh(); }, 300);
    }
    window.agCloseStakeLine = function () {
        var m = document.getElementById('agsl-modal'); if (m) m.style.display = 'none';
        if (_timer) { (window.AG && AG.clearUiInterval ? AG.clearUiInterval : clearInterval)(_timer); _timer = null; }
    };

    function register() {
        // obnova rozdělaného vytyčení přes lištu „Pokračovat" (AGDraft je odpojitelný)
        if (window.AGDraft) try {
            window.AGDraft.register(DRAFT_KEY, {
                label: 'Vytyčení osy',
                open: function (st) {
                    // starší draft zná jen aId/bId — ať se rozdělaná práce neztratí
                    if (st) _ids = (st.ids && st.ids.length >= 2) ? st.ids.slice() : [st.aId, st.bId].filter(Boolean);
                    openTool();   // renderVerts podrží obnovené vrcholy, pokud body existují
                    try {
                        if (st) {
                            var z = document.getElementById('agsl-s0'); if (z) z.value = st.s0 || '';
                            var s = document.getElementById('agsl-stat'); if (s) s.value = st.stat || '';
                            var o = document.getElementById('agsl-off'); if (o) o.value = st.off || '';
                            var nm = document.getElementById('agsl-name'); if (nm) nm.value = st.name || '';
                            refresh(); previewStake(); previewBatch();
                        }
                    } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line:open'); }
                }
            });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'stakeout-line:open'); }
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'stakeout-line', label: 'Vytyčení osy', icon: ICON, onClick: openTool, order: 40 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
    window.agOpenStakeLine = openTool;
    // Geometrii sdílíme s vykreslením v AR, ať se výpočet nedělá dvakrát a nemůže
    // se rozejít (staničení v okně × patka kolmice v obraze).
    window.AGStakeLine = { geometry: geometry, pointAt: pointAt, stationOf: stationOf, startStation: startStation };
})();
