// ===== AR Geodet — DENÍK DNE (ODPOJITELNÁ vrstva) ===============================
// Jeden tap večer = souhrn dne za aktivní zakázku pro kancelář / stavební deník:
//   • nové / změněné / smazané body (žurnál bodů js/journal.js, fallback prov.ts),
//   • docházka party (lokální záznamy směn z js/dochazka.js přes AGUcty.usageQuery),
//   • závady vč. stavu (localStorage '<pid>_zavady' z js/zavady.js),
//   • počasí (poslední stažená data js/pocasi.js, klíč 'agWeatherCache_v1'),
//   • ušlá stopa (js/track-log.js, klíč '<pid>_agTrackLog'),
//   • zápisníky založené v den (js/zapisnik.js, klíč '<pid>_agZapisniky12'),
//   • hlasové poznámky (js/hlasovky.js přes window.AGHlasovky.listRange — bez blobů).
// Výstup: fullscreen modal s volbou dne (dnes / včera / datum) + „Sdílet"
// (navigator.share, fallback kopie do schránky) + „Uložit PDF" (tiskové okno
// s @media print — vzor printProtocol v js/zavady.js).
//
// Neinvazivní: NEEDITUJE logika.js ani grafika.js — čte jen existující úložiště
// a globály (getStoredData, projects, AGJournal, AGUcty). Co v zařízení není
// (firma, žurnál…), sekce prostě vynechá / ohlásí.
// Vstup: dlaždice „Deník dne" v Nástrojích (kategorie Pomůcky).
// Odstranění: smaž js/denik-dne.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agDenikDneInit) return;
    window.__agDenikDneInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 9.5h18"/><path d="m8.7 15.2 2.2 2.2 4.4-4.4"/></svg>';
    var STYLE_ID = 'ag-dd-style';

    // volba dne: 0 = dnes, 1 = včera, jinak _customDate ('RRRR-MM-DD')
    var _dayOff = 0;
    var _customDate = null;
    var _model = null;     // poslední sestavený souhrn (pro Sdílet / PDF)

    // ---- pomocné -----------------------------------------------------------------
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function projName() {
        var id = pid();
        try {
            if (typeof projects !== 'undefined' && Array.isArray(projects)) {
                for (var i = 0; i < projects.length; i++) { if (projects[i] && projects[i].id === id) return projects[i].name || id; }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:projName'); }
        return (id === 'default') ? 'Výchozí zakázka' : id;
    }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:toast'); } }
    function fmtT(ts) { try { return new Date(ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
    function fmtDur(ms) { var m = Math.round(ms / 60000); return Math.floor(m / 60) + ':' + pad2(m % 60) + ' h'; }
    function fmtLen(m) { return m < 995 ? Math.round(m) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }
    var DAYS_CS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
    function fmtDay(d) { return DAYS_CS[d.getDay()] + ' ' + d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear(); }
    // vzdálenost: globál getDistance z logika.js, jinak vlastní haversine
    function dist(la1, lo1, la2, lo2) {
        try { if (typeof getDistance === 'function') return getDistance(la1, lo1, la2, lo2); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:dist'); }
        var R = 6371000, r = Math.PI / 180;
        var a = Math.sin((la2 - la1) * r / 2), b = Math.sin((lo2 - lo1) * r / 2);
        var h = a * a + Math.cos(la1 * r) * Math.cos(la2 * r) * b * b;
        return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    // zvolený den -> {from, to, date}
    function dayRange() {
        var d;
        if (_customDate) {
            var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(_customDate);
            d = m ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) : new Date();
        } else {
            d = new Date();
            d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - _dayOff);
        }
        return { from: d.getTime(), to: d.getTime() + 86400000, date: d };
    }
    function inRange(ts, r) { return typeof ts === 'number' && ts >= r.from && ts < r.to; }
    // timestamp z id tvaru 'xx_<ts>_...' (cp_, zv_, zb_)
    function idTs(id) { var m = /^[a-z]+_(\d{10,})_/.exec(String(id || '')); return m ? parseInt(m[1], 10) : null; }

    // ---- popisky převzaté z okolních modulů ----------------------------------------
    var ZV_CATS = { vyska: 'Výška mimo toleranci', tloustka: 'Tloušťka vrstvy', sklon: 'Sklon / příčný spád', spara: 'Spára / napojení', hutneni: 'Hutnění / povrch', poklop: 'Poklop / vpusť', 'bod-zn': 'Bod zničen / chybí', 'bod-pos': 'Bod posunut', sit: 'Kolize se sítí', gp: 'Neshoda s dokumentací', jine: 'Jiné' };
    var ZV_SEV = { 1: 'drobná', 2: 'vážná', 3: 'kritická' };
    var ORIGINS = { 'gps-avg': 'měření GPS', 'import': 'import', 'transfer': 'přenos', 'resekce': 'resekce', 'vypocet': 'výpočet', 'foto': 'foto-totálka' };
    function originTxt(o) { return o ? (ORIGINS[o] || o) : null; }
    function wmoTxt(c) {
        if (c == null) return null;
        if (c === 0) return 'jasno';
        if (c <= 2) return 'polojasno';
        if (c === 3) return 'zataženo';
        if (c === 45 || c === 48) return 'mlha';
        if (c <= 57) return 'mrholení';
        if (c <= 67) return 'déšť';
        if (c <= 77) return 'sněžení';
        if (c <= 82) return 'přeháňky';
        if (c <= 86) return 'sněhové přeháňky';
        return 'bouřka';
    }

    // ---- sběr dat ------------------------------------------------------------------
    // BODY: žurnál (přesné + autor), fallback prov.ts z uložených bodů
    function collectBody(r) {
        var proj = pid();
        var fallback = function () {
            var out = { add: [], edit: [], del: [], noTs: 0, total: 0, src: 'body' };
            var raw = null;
            try { if (typeof getStoredData === 'function') raw = getStoredData('arCustomPoints12'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:fallback'); }
            if (raw == null) { try { raw = localStorage.getItem(proj + '_arCustomPoints12'); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'denik-dne:fallback'); } }
            var arr = null; try { arr = raw ? JSON.parse(raw) : null; } catch (e3) { window.AG && AG.swallow && AG.swallow(e3, 'denik-dne:fallback'); }
            if (!Array.isArray(arr)) return out;
            out.total = arr.length;
            for (var i = 0; i < arr.length; i++) {
                var p = arr[i]; if (!p) continue;
                var ts = (p.prov && p.prov.ts) || idTs(p.id);
                if (ts == null) { out.noTs++; continue; }
                if (inRange(ts, r)) out.add.push({ name: p.name || '?', ts: ts, origin: (p.prov && p.prov.origin) || null, author: null });
            }
            return out;
        };
        if (!(window.AGJournal && typeof AGJournal.all === 'function')) return Promise.resolve(fallback());
        return AGJournal.all(proj).then(function (recs) {
            if (!Array.isArray(recs) || !recs.length) return fallback();
            var out = { add: [], edit: [], del: [], noTs: 0, total: null, src: 'žurnál' };
            var seenEdit = {};
            for (var i = 0; i < recs.length; i++) {
                var q = recs[i]; if (!q || !inRange(q.ts, r)) continue;
                var nm = (q.after && q.after.name) || (q.before && q.before.name) || q.id || '?';
                var it = { name: nm, ts: q.ts, origin: q.origin || null, author: q.author || null };
                if (q.op === 'add') out.add.push(it);
                else if (q.op === 'delete') out.del.push(it);
                else if (q.op === 'edit') { if (!seenEdit[q.id || nm]) { seenEdit[q.id || nm] = 1; out.edit.push(it); } }
            }
            try { if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) out.total = persistentCustomPoints.length; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:fallback'); }
            return out;
        })['catch'](function () { return fallback(); });   // ['catch']: JScript parse check neskousne .catch (rezervovane slovo)
    }
    // DOCHÁZKA: lokální záznamy směn tohoto zařízení (jinde píchnuté tu nejsou)
    function collectDochazka(r) {
        var u = window.AGUcty;
        if (!u || typeof u.usageQuery !== 'function' || !u.getFirm || !u.getFirm()) return Promise.resolve(null);
        return u.usageQuery(r.from).then(function (evs) {
            var byUid = {}, order = [];
            (evs || []).forEach(function (ev) {
                if (!ev || ev.t !== 'shift' || !inRange(ev.ts, r)) return;
                var key = ev.uid || ev.u || '?';
                if (!byUid[key]) { byUid[key] = { name: ev.u || '?', evs: [] }; order.push(key); }
                byUid[key].evs.push(ev);
            });
            var people = [];
            order.forEach(function (key) {
                var seg = byUid[key], spans = [], open = null, meta = null;
                seg.evs.sort(function (a, b) { return a.ts - b.ts; });
                seg.evs.forEach(function (ev) {
                    var parts = String(ev.k || '').split('|');
                    var dir = parts[0];
                    if (parts[2] && !meta) { try { var mm = JSON.parse(decodeURIComponent(parts[2])); if (mm && typeof mm === 'object') meta = mm; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:collectDochazka'); } }
                    if (dir === 'in') { if (open) spans.push(open); open = { i: ev.ts, o: null }; }
                    else if (dir === 'out') { if (open) { open.o = ev.ts; spans.push(open); open = null; } else spans.push({ i: null, o: ev.ts }); }
                });
                if (open) spans.push(open);
                var ms = 0;
                spans.forEach(function (s) { if (s.i && s.o) ms += Math.max(0, s.o - s.i); });
                people.push({ name: seg.name, spans: spans, ms: ms, meta: meta });
            });
            return { people: people };
        })['catch'](function () { return null; });
    }
    // ZÁVADY: nové v den + vyřešené v den + kolik zbývá otevřených
    function collectZavady(r) {
        var arr = null;
        try { arr = JSON.parse(localStorage.getItem(pid() + '_zavady')); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:collectZavady'); }
        if (!Array.isArray(arr)) return null;
        var out = { newz: [], resolved: [], openTotal: 0 };
        arr.forEach(function (z) {
            if (!z) return;
            if (!z.resolved) out.openTotal++;
            if (inRange(z.ts, r)) out.newz.push(z);
            if (z.resolvedTs && inRange(z.resolvedTs, r)) out.resolved.push(z);
        });
        return out;
    }
    // POČASÍ: poslední stažený balík — jen když je ze zvoleného dne
    function collectPocasi(r) {
        var o = null;
        try { o = JSON.parse(localStorage.getItem('agWeatherCache_v1')); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:collectPocasi'); }
        if (!o || !o.data || !inRange(o.t, r)) return null;
        var c = o.data.current || {};
        return { when: o.t, place: o.placeName || null, temp: c.temp, wind: c.wind, gusts: c.gusts, precip: c.precip, hum: c.hum, codeTxt: wmoTxt(c.code) };
    }
    // STOPA: délka úseků, jejichž oba vzorky padnou do dne
    function collectTrack(r) {
        var raw = null;
        try { if (typeof getStoredData === 'function') raw = getStoredData('agTrackLog'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:collectTrack'); }
        if (raw == null) { try { raw = localStorage.getItem(pid() + '_agTrackLog'); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'denik-dne:collectTrack'); } }
        var tr = null; try { tr = raw ? JSON.parse(raw) : null; } catch (e3) { window.AG && AG.swallow && AG.swallow(e3, 'denik-dne:collectTrack'); }
        if (!Array.isArray(tr) || tr.length < 2) return null;
        var len = 0, first = null, last = null, n = 0;
        for (var i = 1; i < tr.length; i++) {
            var a = tr[i - 1], b = tr[i];
            if (!a || !b || !inRange(b.t, r)) continue;
            if (first == null && inRange(a.t, r)) first = a.t;
            if (first == null) first = b.t;
            last = b.t; n++;
            if (inRange(a.t, r)) len += dist(a.lat, a.lng, b.lat, b.lng);
        }
        if (!n || len < 1) return null;
        return { len: len, from: first, to: last };
    }
    // HLASOVKY: hlasové poznámky s georazítkem (js/hlasovky.js, IndexedDB — async)
    function collectHlasovky(r) {
        if (!(window.AGHlasovky && typeof AGHlasovky.listRange === 'function')) return Promise.resolve(null);
        return AGHlasovky.listRange(pid(), r.from, r.to).then(function (list) {
            return (Array.isArray(list) && list.length) ? { items: list } : null;
        })['catch'](function () { return null; });
    }
    // ZÁPISNÍKY: založené ve zvolený den (čas = razítko v id) + poznámky z řádků
    function collectZapisnik(r) {
        var raw = null;
        try { if (typeof getStoredData === 'function') raw = getStoredData('agZapisniky12'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:collectZapisnik'); }
        if (raw == null) { try { raw = localStorage.getItem(pid() + '_agZapisniky12'); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'denik-dne:collectZapisnik'); } }
        var d = null; try { d = raw ? JSON.parse(raw) : null; } catch (e3) { window.AG && AG.swallow && AG.swallow(e3, 'denik-dne:collectZapisnik'); }
        if (!d || typeof d !== 'object') return null;
        var items = [];
        (Array.isArray(d.niv) ? d.niv : []).forEach(function (nb) {
            var ts = idTs(nb && nb.id);
            if (ts == null || !inRange(ts, r)) return;
            var notes = [];
            (nb.rows || []).forEach(function (row) { if (row && row.note) notes.push((row.bod ? row.bod + ': ' : '') + row.note); });
            items.push({ name: nb.name || 'Nivelace', type: 'nivelace', ts: ts, rows: (nb.rows || []).length, notes: notes });
        });
        (Array.isArray(d.sm) ? d.sm : []).forEach(function (nb) {
            var ts = idTs(nb && nb.id);
            if (ts == null || !inRange(ts, r)) return;
            items.push({ name: nb.name || 'Směry', type: 'směry', ts: ts, rows: (nb.targets || []).length, notes: [] });
        });
        return items.length ? { items: items } : null;
    }

    // ---- sestavení souhrnu ----------------------------------------------------------
    // model = { header:{...}, sections:[{title, sub, rows:[řetězce], empty}] }
    function buildModel(done) {
        var r = dayRange();
        Promise.all([collectBody(r), collectDochazka(r), collectHlasovky(r)]).then(function (res) {
            var body = res[0], doch = res[1], hlas = res[2];
            var m = { header: { proj: projName(), day: fmtDay(r.date), gen: new Date() }, sections: [] };
            try {
                var u = window.AGUcty, f = u && u.getFirm && u.getFirm(), cu = u && u.currentUser && u.currentUser();
                if (f && f.firmName) m.header.firm = f.firmName;
                if (cu && cu.name) m.header.user = cu.name;
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:buildModel'); }

            // BODY
            var sb = { title: 'Body', sub: body.add.length + ' nových · ' + body.edit.length + ' změněných · ' + body.del.length + ' smazaných' + (body.total != null ? ' · celkem v zakázce ' + body.total : ''), rows: [], empty: 'Žádné změny bodů v tento den.' };
            var pushPts = function (list, sign) {
                list.forEach(function (p) {
                    var bits = [fmtT(p.ts)];
                    if (originTxt(p.origin)) bits.push(originTxt(p.origin));
                    if (p.author) bits.push(p.author);
                    sb.rows.push(sign + ' ' + p.name + ' (' + bits.join(', ') + ')');
                });
            };
            pushPts(body.add, '+'); pushPts(body.edit, '~'); pushPts(body.del, '−');
            if (body.noTs) sb.rows.push('(' + body.noTs + ' bodů bez časového razítka nelze zařadit ke dni)');
            m.sections.push(sb);

            // DOCHÁZKA
            if (doch) {
                var sd = { title: 'Docházka (toto zařízení)', sub: doch.people.length + ' osob', rows: [], empty: 'Žádné píchnutí v tento den.' };
                doch.people.forEach(function (p) {
                    var sp = p.spans.map(function (s) { return (s.i ? fmtT(s.i) : '?') + '–' + (s.o ? fmtT(s.o) : '…'); }).join(', ');
                    var extra = [];
                    if (p.ms) extra.push(fmtDur(p.ms));
                    if (p.meta && p.meta.s) extra.push('stavba: ' + p.meta.s);
                    if (p.meta && p.meta.w && p.meta.w.length) extra.push('s: ' + p.meta.w.join(', '));
                    sd.rows.push(p.name + ': ' + sp + (extra.length ? ' (' + extra.join(' · ') + ')' : ''));
                });
                m.sections.push(sd);
            }

            // ZÁVADY
            var zv = collectZavady(r);
            if (zv && (zv.newz.length || zv.resolved.length || zv.openTotal)) {
                var sz = { title: 'Závady', sub: zv.newz.length + ' nových · ' + zv.resolved.length + ' vyřešených · otevřených celkem ' + zv.openTotal, rows: [], empty: 'Žádné závady v tento den.' };
                zv.newz.forEach(function (z) {
                    sz.rows.push('! ' + (ZV_CATS[z.cat] || z.cat) + ' — ' + (ZV_SEV[z.sev] || z.sev) + (z.resolved ? ', vyřešeno' : ', otevřená') + ' (' + fmtT(z.ts) + ')' + (z.note ? ' — ' + z.note : '') + (z.foto ? ' [foto]' : ''));
                });
                zv.resolved.forEach(function (z) {
                    if (inRange(z.ts, r)) return;   // nová i vyřešená týž den — už je výš
                    sz.rows.push('✓ vyřešeno: ' + (ZV_CATS[z.cat] || z.cat) + ' (' + fmtT(z.resolvedTs) + ')');
                });
                m.sections.push(sz);
            }

            // POČASÍ
            var w = collectPocasi(r);
            if (w) {
                var bitsW = [];
                if (w.codeTxt) bitsW.push(w.codeTxt);
                if (w.temp != null) bitsW.push(Math.round(w.temp) + ' °C');
                if (w.wind != null) bitsW.push('vítr ' + Math.round(w.wind) + (w.gusts != null ? ' (nárazy ' + Math.round(w.gusts) + ')' : '') + ' m/s');
                if (w.precip != null) bitsW.push('srážky ' + w.precip.toFixed(1).replace('.', ',') + ' mm/h');
                if (w.hum != null) bitsW.push('vlhkost ' + Math.round(w.hum) + ' %');
                m.sections.push({ title: 'Počasí', sub: (w.place ? w.place + ' · ' : '') + 'staženo ' + fmtT(w.when), rows: [bitsW.join(', ')], empty: '' });
            }

            // STOPA
            var t = collectTrack(r);
            if (t) m.sections.push({ title: 'Ušlá stopa', sub: '', rows: ['Zaznamenáno ' + fmtLen(t.len) + ' (' + fmtT(t.from) + '–' + fmtT(t.to) + ')'], empty: '' });

            // HLASOVKY
            if (hlas) {
                var sh = { title: 'Hlasové poznámky', sub: hlas.items.length + ' hlasovek', rows: [], empty: '' };
                hlas.items.forEach(function (n) {
                    var mm = Math.floor(n.dur / 60) + ':' + pad2(Math.round(n.dur) % 60);
                    sh.rows.push(fmtT(n.ts) + ' — ' + mm + ' min' + (n.ptName ? ' — u bodu ' + n.ptName : '') + (n.note ? ' — ' + n.note : ''));
                });
                m.sections.push(sh);
            }

            // ZÁPISNÍKY
            var zb = collectZapisnik(r);
            if (zb) {
                var szb = { title: 'Zápisníky (založené v den)', sub: zb.items.length + ' zápisníků', rows: [], empty: '' };
                zb.items.forEach(function (nb) {
                    szb.rows.push(nb.name + ' (' + nb.type + ', ' + nb.rows + ' řádků, ' + fmtT(nb.ts) + ')');
                    nb.notes.forEach(function (n) { szb.rows.push('   pozn.: ' + n); });
                });
                m.sections.push(szb);
            }

            done(m);
        })['catch'](function () {
            done({ header: { proj: projName(), day: fmtDay(r.date), gen: new Date() }, sections: [{ title: 'Chyba', sub: '', rows: ['Souhrn se nepodařilo sestavit.'], empty: '' }] });
        });
    }

    // ---- textový report (Sdílet) ------------------------------------------------------
    function buildText(m) {
        var L = [];
        L.push('DENÍK DNE — ' + m.header.proj);
        L.push('Datum: ' + m.header.day);
        if (m.header.firm || m.header.user) L.push((m.header.firm ? 'Firma: ' + m.header.firm : '') + (m.header.firm && m.header.user ? ' · ' : '') + (m.header.user ? 'Zapsal: ' + m.header.user : ''));
        L.push('Vygenerováno: ' + m.header.gen.toLocaleString('cs-CZ') + ' · AR Geodet');
        m.sections.forEach(function (s) {
            L.push('');
            L.push(s.title.toUpperCase() + (s.sub ? ' — ' + s.sub : ''));
            if (s.rows.length) s.rows.forEach(function (row) { L.push('  ' + row); });
            else if (s.empty) L.push('  ' + s.empty);
        });
        return L.join('\n');
    }

    // ---- styly ------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-dd-modal .modal-content{display:flex;flex-direction:column;}',
            '#ag-dd-modal .ag-dd-days{display:flex;gap:8px;margin:6px 0 10px;flex-wrap:wrap;align-items:center;}',
            '#ag-dd-modal .ag-dd-chip{padding:8px 14px;border-radius:99px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:transparent;color:var(--text-muted,#9aa1ac);font:600 13px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '#ag-dd-modal .ag-dd-chip.on{background:var(--accent-soft,rgba(47,158,116,0.18));color:var(--accent,#2f9e74);border-color:var(--accent-line,rgba(47,158,116,0.4));}',
            '#ag-dd-modal input[type=date]{padding:6px 10px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:var(--glass-bg,rgba(255,255,255,0.05));color:var(--text-color,#e6e8eb);font:600 13px/1 var(--font-ui,system-ui);}',
            '#ag-dd-body{flex:1;overflow-y:auto;min-height:0;}',
            '#ag-dd-modal .ag-dd-sec{background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  border-radius:14px;padding:12px 14px;margin-bottom:10px;}',
            '#ag-dd-modal .ag-dd-sec h4{margin:0 0 2px;font:700 14px/1.3 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '#ag-dd-modal .ag-dd-sec .sub{font:500 12px/1.4 var(--font-ui,system-ui);color:var(--accent,#2f9e74);margin:0 0 6px;}',
            '#ag-dd-modal .ag-dd-sec .row{font:500 13px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#c3c9d2);white-space:pre-wrap;word-break:break-word;}',
            '#ag-dd-modal .ag-dd-sec .empty{font:500 12.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);font-style:italic;}',
            '#ag-dd-modal .ag-dd-hdr{font:500 12px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:0 0 8px;}',
            '#ag-dd-modal .ag-dd-foot{display:flex;gap:8px;margin-top:12px;}',
            '#ag-dd-modal .ag-dd-foot .btn{flex:1;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- modal --------------------------------------------------------------------------
    function ensureModal() {
        var m = document.getElementById('ag-dd-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'ag-dd-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Deník dne</h3>' +
            '  <div class="ag-dd-days">' +
            '    <button type="button" class="ag-dd-chip on" data-off="0">Dnes</button>' +
            '    <button type="button" class="ag-dd-chip" data-off="1">Včera</button>' +
            '    <input type="date" id="ag-dd-date" aria-label="Jiné datum">' +
            '  </div>' +
            '  <div id="ag-dd-body"></div>' +
            '  <div class="ag-dd-foot">' +
            '    <button type="button" class="btn btn-primary" id="ag-dd-share">Sdílet</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-dd-pdf">Uložit PDF</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-dd-close">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-dd-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-dd-share').addEventListener('click', share);
        m.querySelector('#ag-dd-pdf').addEventListener('click', printPdf);
        var chips = m.querySelectorAll('.ag-dd-chip');
        for (var i = 0; i < chips.length; i++) {
            chips[i].addEventListener('click', function () {
                _dayOff = parseInt(this.getAttribute('data-off'), 10) || 0;
                _customDate = null;
                var dEl = m.querySelector('#ag-dd-date'); if (dEl) dEl.value = '';
                syncChips(); refresh();
            });
        }
        m.querySelector('#ag-dd-date').addEventListener('change', function () {
            if (this.value) { _customDate = this.value; syncChips(); refresh(); }
        });
        return m;
    }
    function syncChips() {
        var m = document.getElementById('ag-dd-modal');
        if (!m) return;
        var chips = m.querySelectorAll('.ag-dd-chip');
        for (var i = 0; i < chips.length; i++) {
            var on = !_customDate && parseInt(chips[i].getAttribute('data-off'), 10) === _dayOff;
            chips[i].className = 'ag-dd-chip' + (on ? ' on' : '');
        }
    }
    function render(m) {
        var body = document.getElementById('ag-dd-body');
        if (!body) return;
        var h = '<p class="ag-dd-hdr"><b>' + esc(m.header.proj) + '</b> · ' + esc(m.header.day)
            + (m.header.firm ? ' · ' + esc(m.header.firm) : '')
            + (m.header.user ? ' · ' + esc(m.header.user) : '') + '</p>';
        m.sections.forEach(function (s) {
            h += '<div class="ag-dd-sec"><h4>' + esc(s.title) + '</h4>'
                + (s.sub ? '<p class="sub">' + esc(s.sub) + '</p>' : '');
            if (s.rows.length) s.rows.forEach(function (row) { h += '<div class="row">' + esc(row) + '</div>'; });
            else if (s.empty) h += '<div class="empty">' + esc(s.empty) + '</div>';
            h += '</div>';
        });
        body.innerHTML = h;
    }
    function refresh() {
        var body = document.getElementById('ag-dd-body');
        if (body) body.innerHTML = '<div class="empty" style="padding:14px;color:var(--text-muted,#9aa1ac);">Sestavuji souhrn…</div>';
        buildModel(function (m) { _model = m; render(m); });
    }
    function openDenik() {
        _dayOff = 0; _customDate = null;
        var m = ensureModal();
        syncChips();
        m.style.display = 'flex';
        refresh();
    }

    // ---- Sdílet ---------------------------------------------------------------------------
    function copyText(txt) {
        var doneMsg = 'Souhrn zkopírován do schránky.';
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(txt).then(function () { toast(doneMsg); }, function () { legacyCopy(txt) ? toast(doneMsg) : toast('Kopírování se nepovedlo.'); });
                return;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'denik-dne:copyText'); }
        legacyCopy(txt) ? toast(doneMsg) : toast('Kopírování se nepovedlo.');
    }
    function legacyCopy(txt) {
        try {
            var ta = document.createElement('textarea');
            ta.value = txt;
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (e) { return false; }
    }
    function share() {
        if (!_model) return;
        var txt = buildText(_model);
        if (navigator.share) {
            navigator.share({ title: 'Deník dne — ' + _model.header.proj, text: txt })
                .then(function () {}, function () { copyText(txt); });
        } else copyText(txt);
    }

    // ---- Uložit PDF (tiskové okno; pdf-protocol.js je specializovaný na body, nejde znovupoužít)
    function printPdf() {
        if (!_model) return;
        var m = _model;
        var h = '<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Deník dne</title><style>'
            + 'body{font:13px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px;}'
            + 'h1{font-size:calc(19px * var(--ag-font-scale, 1));margin:0 0 2px;} .sub{color:#555;margin:0 0 16px;font-size:calc(12px * var(--ag-font-scale, 1));}'
            + '.sec{border:1px solid #ccc;border-radius:8px;padding:10px 14px;margin-bottom:10px;page-break-inside:avoid;}'
            + '.sec h2{font-size:calc(14px * var(--ag-font-scale, 1));margin:0 0 2px;} .sec .cnt{color:#2c7a4b;font-size:calc(11.5px * var(--ag-font-scale, 1));margin:0 0 6px;}'
            + '.sec .row{font-size:calc(12.5px * var(--ag-font-scale, 1));color:#333;white-space:pre-wrap;} .sec .empty{color:#888;font-style:italic;font-size:calc(12px * var(--ag-font-scale, 1));}'
            + '@media print{button{display:none}}'
            + '</style></head><body>'
            + '<button onclick="window.print()" style="padding:8px 16px;margin-bottom:14px;">Tisk / Uložit PDF</button>'
            + '<h1>Deník dne — ' + esc(m.header.proj) + '</h1>'
            + '<p class="sub">' + esc(m.header.day)
            + (m.header.firm ? ' · ' + esc(m.header.firm) : '')
            + (m.header.user ? ' · zapsal ' + esc(m.header.user) : '')
            + ' · vygenerováno ' + esc(m.header.gen.toLocaleString('cs-CZ')) + ' · AR Geodet</p>';
        m.sections.forEach(function (s) {
            h += '<div class="sec"><h2>' + esc(s.title) + '</h2>'
                + (s.sub ? '<p class="cnt">' + esc(s.sub) + '</p>' : '');
            if (s.rows.length) s.rows.forEach(function (row) { h += '<div class="row">' + esc(row) + '</div>'; });
            else if (s.empty) h += '<div class="empty">' + esc(s.empty) + '</div>';
            h += '</div>';
        });
        h += '</body></html>';
        var w = window.open('', '_blank');
        if (!w) { toast('Prohlížeč zablokoval nové okno — povol vyskakovací okna.'); return; }
        w.document.write(h); w.document.close();
    }

    // ---- registrace dlaždice -------------------------------------------------------------
    var _regTries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'denik-dne', label: 'Deník dne', icon: ICON, cat: 'Pomůcky', onClick: openDenik, order: 62 });
            return;
        }
        if (_regTries++ < 20) setTimeout(register, 500);
    }
    function init() { register(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    // veřejné API (hledání / jiné moduly)
    window.agOpenDenikDne = openDenik;
})();
