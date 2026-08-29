// ===== AR Geodet — PLAKÁT DNE: den jako obrázek (ODPOJITELNÁ vrstva) ===========
// Neinvazivní vrstva ve stylu js/denik-dne.js: NEEDITUJE logika.js ani grafika.js,
// jen čte data, která už appka stejně sbírá, a vykresluje je na <canvas>.
//
// PROČ: „Deník dne" (js/denik-dne.js) shrne den do TEXTU pro kancelář — je to
// doklad, ne obrázek. Jenže po dvanácti hodinách v terénu si člověk nechce číst
// odrážky; chce VIDĚT, co odvedl. Stejná data vykreslená jako jedna obrázková
// karta (stopa dne jako kresba, body jako tečky, čtyři velká čísla) dají
// z konce dne něco, co se dá jedním tapem poslat do skupiny nebo přiložit do
// stavebního deníku — a hlavně na to je vidět.
//
// TOHLE NENÍ DUPLICITA DENÍKU: deník je seznam vět a umí PDF pro kancelář,
// plakát je jeden PNG a nic nevypisuje. Proto se taky nabízí PŘÍMO V DENÍKU
// (tlačítko „Plakát") — jsou to dvě podoby téhož dne, ne dva nástroje.
//
// ODKUD SE BEROU ČÍSLA (nic nového se neměří, žádný další GPS watch):
//   • stopa dne — js/track-log.js, klíč '<pid>_agTrackLog' ({lat,lng,t,a})
//   • body přidané/změněné/smazané — žurnál js/journal.js (AGJournal.all),
//     fallback prov.ts z uložených bodů, když žurnál ještě není
//   • ušlé km, výškové metry, kroky, čas v appce, nejpoužívanější nástroj —
//     js/moje-aktivita.js, klíč 'agAkt_v1' (days['RRRR-MM-DD'])
//   • počasí — poslední balík js/pocasi.js, klíč 'agWeatherCache_v1'
//   • zakázka / firma / uživatel — arActiveProjectId, AGUcty
//
// POCTIVĚ O ČÍSLECH: délka stopy i výškové metry jsou z mobilní GPS, tedy
// ORIENTAČNÍ (proto je plakát uvádí zaokrouhleně a bez desetin, ať nebudí zdání
// měření). Kdo chce doložitelná čísla, má na to protokoly — ne plakát.
//
// KRESLENÍ: čistě 2D canvas API, žádná knihovna, žádné CDN. Plátno je pevných
// 1080×1620 px (2:3, sedne na příspěvek i na A-formát) a kreslí se do něj
// v jeho vlastních souřadnicích — velikost na displeji řeší CSS, takže na
// retina i na starém telefonu vypadne TÝŽ soubor.
//
// SDÍLENÍ NA iOS: `<a download>` Safari dlouho ignorovalo, proto se nejdřív
// zkouší navigator.share({files}) (iOS 15+) a teprve pak stažení; když neprojde
// ani jedno, obrázek se otevře na nové kartě a appka řekne „podrž prstem
// a ulož". Bez toho by na iPhonu tlačítko nedělalo nic.
//
// Odstranění: smaž js/plakat-dne.js + řádek <script> v index.html, záznam
// 'plakat-dne' v js/tools-registry.js a jeho text v data/navody.json
// (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGPlakat) return;

    var MODAL_ID = 'ag-pl-modal';
    var STYLE_ID = 'ag-pl-style';
    var W = 1080, H = 1620;             // pevná velikost plátna (2:3)

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-4 4 3 3-2 6 4"/><circle cx="8.5" cy="8" r="1.5"/></svg>';

    // Paleta plakátu. ZÁMĚRNĚ NEBERE tokeny ze světlého/tmavého režimu appky:
    // plakát je obrázek, který půjde ven z telefonu, a má vypadat vždycky stejně
    // (ve světlém režimu by bílá kresba na bílé skončila jako prázdný obdélník).
    var C = {
        bg: '#0b1220', bg2: '#111c30', line: '#1e2c46',
        ink: '#e8edf5', dim: '#8fa0bb', accent: '#34d399', accent2: '#22d3ee',
        gold: '#fbbf24', track: '#34d399', point: '#fbbf24'
    };

    var _dayOff = 0;        // 0 = dnes, 1 = včera
    var _customDate = null; // 'RRRR-MM-DD'
    var _busy = false;
    var _lastBlob = null;

    // ---- pomocné -------------------------------------------------------------
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'plakat-dne'); } catch (err) { /* nic */ } }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : void 0); } catch (e) { swallow(e, 'plakat:toast'); } }
    function esc(s) {
        return (window.AG && AG.esc) ? AG.esc(s)
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function projName() {
        var id = pid();
        try {
            var raw = localStorage.getItem('arProjects12');
            var arr = raw ? JSON.parse(raw) : null;
            if (Array.isArray(arr)) {
                for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i].name || id;
            }
        } catch (e) { swallow(e, 'plakat:projName'); }
        return id === 'default' ? 'Bez zakázky' : id;
    }
    function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function jsonLs(k) { try { var v = JSON.parse(localStorage.getItem(k)); return v; } catch (e) { return null; } }

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
    function dayKey(d) {
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }
    function inRange(ts, r) { return typeof ts === 'number' && ts >= r.from && ts < r.to; }
    function idTs(id) { var m = /^[a-z]+_(\d{10,})_/.exec(String(id || '')); return m ? parseInt(m[1], 10) : null; }

    var DNY = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
    var MES = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
    function fmtDay(d) { return DNY[d.getDay()] + ' ' + d.getDate() + '. ' + MES[d.getMonth()] + ' ' + d.getFullYear(); }
    function fmtHm(ms) {
        var min = Math.round(ms / 60000);
        if (min < 60) return min + ' min';
        return Math.floor(min / 60) + ' h ' + (min % 60 ? (min % 60) + ' min' : '');
    }
    // Čas na kartu se rozdělí na ČÍSLO a JEDNOTKU zvlášť — karta je sází jinou
    // velikostí písma. Nad hodinu se ukazuje 7:25, ne 7,4 (na plakátu se to čte
    // jako čas, ne jako desetinné číslo).
    function casKarta(ms) {
        var min = Math.round(ms / 60000);
        if (min < 60) return { v: String(min), u: 'min' };
        var h = Math.floor(min / 60), r = min % 60;
        return { v: h + ':' + (r < 10 ? '0' : '') + r, u: 'h' };
    }
    function fmtTime(ts) {
        var d = new Date(ts);
        return d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    }
    function dist(la1, lo1, la2, lo2) {
        if (typeof getDistance === 'function') { try { return getDistance(la1, lo1, la2, lo2); } catch (e) { swallow(e, 'plakat:dist'); } }
        var R = 6371000, t1 = la1 * Math.PI / 180, t2 = la2 * Math.PI / 180;
        var dt = (la2 - la1) * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
        var a = Math.sin(dt / 2) * Math.sin(dt / 2) + Math.cos(t1) * Math.cos(t2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ================================================================
    //  SBĚR DAT
    // ================================================================
    // STOPA: vzorky ze zvoleného dne + jejich délka
    function collectTrack(r) {
        var raw = null;
        try { if (typeof getStoredData === 'function') raw = getStoredData('agTrackLog'); } catch (e) { swallow(e, 'plakat:track'); }
        if (raw == null) raw = ls(pid() + '_agTrackLog');
        var tr = null; try { tr = raw ? JSON.parse(raw) : null; } catch (e2) { swallow(e2, 'plakat:track'); }
        if (!Array.isArray(tr) || tr.length < 2) return null;
        var pts = [], len = 0, prev = null;
        for (var i = 0; i < tr.length; i++) {
            var s = tr[i];
            if (!s || !inRange(s.t, r) || typeof s.lat !== 'number' || typeof s.lng !== 'number') { prev = null; continue; }
            if (prev) len += dist(prev.lat, prev.lng, s.lat, s.lng);
            pts.push(s); prev = s;
        }
        if (pts.length < 2) return null;
        return { pts: pts, len: len, from: pts[0].t, to: pts[pts.length - 1].t };
    }

    // BODY: co dne přibylo / se změnilo / zmizelo — nejdřív žurnál, pak fallback
    function collectPoints(r) {
        var proj = pid();
        function fallback() {
            var out = { add: [], edit: 0, del: 0, coords: [], total: 0, src: 'body' };
            var raw = null;
            try { if (typeof getStoredData === 'function') raw = getStoredData('arCustomPoints12'); } catch (e) { swallow(e, 'plakat:pts'); }
            if (raw == null) raw = ls(proj + '_arCustomPoints12');
            var arr = null; try { arr = raw ? JSON.parse(raw) : null; } catch (e2) { swallow(e2, 'plakat:pts'); }
            if (!Array.isArray(arr)) return out;
            out.total = arr.length;
            for (var i = 0; i < arr.length; i++) {
                var p = arr[i]; if (!p) continue;
                var ts = (p.prov && p.prov.ts) || idTs(p.id);
                if (ts == null || !inRange(ts, r)) continue;
                out.add.push({ name: p.name || '?', ts: ts });
                if (typeof p.lat === 'number' && typeof p.lng === 'number') out.coords.push({ lat: p.lat, lng: p.lng, name: p.name || '' });
            }
            return out;
        }
        // souřadnice bodů z aktuálního seznamu (žurnál je nemusí nést celé)
        function coordsFor(names) {
            var out = [], seen = {};
            var arr = null;
            try { if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) arr = persistentCustomPoints; } catch (e) { swallow(e, 'plakat:coordsFor'); }
            if (!arr) {
                var raw = null;
                try { if (typeof getStoredData === 'function') raw = getStoredData('arCustomPoints12'); } catch (e2) { swallow(e2, 'plakat:coordsFor'); }
                if (raw == null) raw = ls(proj + '_arCustomPoints12');
                try { arr = raw ? JSON.parse(raw) : null; } catch (e3) { arr = null; }
            }
            if (!Array.isArray(arr)) return out;
            for (var i = 0; i < arr.length; i++) {
                var p = arr[i]; if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
                if (names[p.name] && !seen[p.name]) { seen[p.name] = 1; out.push({ lat: p.lat, lng: p.lng, name: p.name }); }
            }
            return out;
        }
        if (!(window.AGJournal && typeof AGJournal.all === 'function')) return Promise.resolve(fallback());
        return AGJournal.all(proj).then(function (recs) {
            if (!Array.isArray(recs) || !recs.length) return fallback();
            var out = { add: [], edit: 0, del: 0, coords: [], total: 0, src: 'žurnál' };
            var names = {}, seenEdit = {};
            for (var i = 0; i < recs.length; i++) {
                var q = recs[i]; if (!q || !inRange(q.ts, r)) continue;
                var nm = (q.after && q.after.name) || (q.before && q.before.name) || q.id || '?';
                if (q.op === 'add') { out.add.push({ name: nm, ts: q.ts }); names[nm] = 1; }
                else if (q.op === 'delete') out.del++;
                else if (q.op === 'edit' && !seenEdit[q.id || nm]) { seenEdit[q.id || nm] = 1; out.edit++; names[nm] = 1; }
            }
            try { if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) out.total = persistentCustomPoints.length; } catch (e) { swallow(e, 'plakat:pts'); }
            out.coords = coordsFor(names);
            if (!out.add.length && !out.edit && !out.del) return fallback();
            return out;
        })['catch'](function () { return fallback(); });   // ['catch']: kontrola JS neskousne .catch (rezervovane slovo)
    }

    // AKTIVITA: km, výškové metry, kroky, čas, nejpoužívanější nástroj
    function collectAkt(r) {
        var o = jsonLs('agAkt_v1');
        if (!o || !o.days) return null;
        var d = o.days[dayKey(r.date)];
        if (!d) return null;
        var topTool = null, topN = 0;
        if (d.tools) {
            for (var k in d.tools) {
                if (!Object.prototype.hasOwnProperty.call(d.tools, k)) continue;
                var t = d.tools[k];
                var n = (t && typeof t === 'object') ? (t.n || 0) : (t || 0);
                if (n > topN) { topN = n; topTool = k; }
            }
        }
        var label = topTool;
        try {
            var labs = jsonLs('agAktLabels_v1');
            if (labs && labs[topTool]) label = labs[topTool];
            else if (window.AGReg && AGReg.help && AGReg.help(topTool) && AGReg.help(topTool).t) label = AGReg.help(topTool).t;
        } catch (e) { swallow(e, 'plakat:akt'); }
        return { ms: d.ms || 0, dist: d.dist || 0, up: d.up || 0, down: d.down || 0, steps: d.steps || 0, topTool: label, topN: topN };
    }

    // POČASÍ: jen když je balík ze zvoleného dne
    function collectPocasi(r) {
        var o = jsonLs('agWeatherCache_v1');
        if (!o || !o.data || !inRange(o.t, r)) return null;
        var c = o.data.current || {};
        return { place: o.placeName || null, temp: c.temp, wind: c.wind, code: c.code };
    }
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

    function build(done) {
        var r = dayRange();
        collectPoints(r).then(function (pts) {
            var m = {
                r: r, day: fmtDay(r.date), proj: projName(),
                track: collectTrack(r), pts: pts, akt: collectAkt(r), poc: collectPocasi(r),
                firm: null, user: null
            };
            try {
                var u = window.AGUcty, f = u && u.getFirm && u.getFirm(), cu = u && u.currentUser && u.currentUser();
                if (f && f.firmName) m.firm = f.firmName;
                if (cu && cu.name) m.user = cu.name;
            } catch (e) { swallow(e, 'plakat:build'); }
            done(m);
        })['catch'](function () { done({ r: r, day: fmtDay(r.date), proj: projName(), track: null, pts: { add: [], edit: 0, del: 0, coords: [], total: 0 }, akt: null, poc: null }); });
    }

    // ================================================================
    //  KRESLENÍ
    // ================================================================
    function roundRect(g, x, y, w, h, rad) {
        // vlastní implementace: ctx.roundRect() nemá starší iOS Safari
        var rr = Math.min(rad, w / 2, h / 2);
        g.beginPath();
        g.moveTo(x + rr, y);
        g.lineTo(x + w - rr, y); g.quadraticCurveTo(x + w, y, x + w, y + rr);
        g.lineTo(x + w, y + h - rr); g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        g.lineTo(x + rr, y + h); g.quadraticCurveTo(x, y + h, x, y + h - rr);
        g.lineTo(x, y + rr); g.quadraticCurveTo(x, y, x + rr, y);
        g.closePath();
    }
    function fitText(g, txt, maxW) {
        // useknutí s výpustkou — na plakát se nevejde celý název zakázky
        var s = String(txt == null ? '' : txt);
        if (g.measureText(s).width <= maxW) return s;
        while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
        return s + '…';
    }

    // Mapová kresba: stopa + body v jednom měřítku.
    // Projekce je LOKÁLNÍ rovinná (lng × cos(lat)), což na ploše jednoho dne
    // stačí — plakát není mapový výstup, jde o tvar trasy.
    function drawMapArea(g, m, x, y, w, h) {
        var pts = (m.track && m.track.pts) ? m.track.pts : [];
        var cps = (m.pts && m.pts.coords) ? m.pts.coords : [];
        roundRect(g, x, y, w, h, 28);
        g.fillStyle = C.bg2; g.fill();
        g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();

        if (!pts.length && !cps.length) {
            g.fillStyle = C.dim;
            g.font = '600 34px system-ui, -apple-system, "Segoe UI", sans-serif';
            g.textAlign = 'center';
            g.fillText('Ten den appka stopu ani body nezaznamenala', x + w / 2, y + h / 2 + 10);
            g.textAlign = 'left';
            return;
        }

        var all = pts.concat(cps);
        var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (var i = 0; i < all.length; i++) {
            var p = all[i];
            if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
            if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng;
        }
        var lat0 = (minLat + maxLat) / 2;
        var kx = Math.cos(lat0 * Math.PI / 180);
        var spanX = Math.max((maxLng - minLng) * kx, 1e-7);
        var spanY = Math.max(maxLat - minLat, 1e-7);
        var pad = 56;
        var s = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
        var cx = x + w / 2, cy = y + h / 2;
        function X(lng) { return cx + (lng - (minLng + maxLng) / 2) * kx * s; }
        function Y(lat) { return cy - (lat - lat0) * s; }

        g.save();
        roundRect(g, x, y, w, h, 28); g.clip();

        // jemná síť na pozadí, ať kresba nevisí v prázdnu
        g.strokeStyle = 'rgba(255,255,255,0.04)'; g.lineWidth = 1;
        for (var gx = x + 40; gx < x + w; gx += 60) { g.beginPath(); g.moveTo(gx, y); g.lineTo(gx, y + h); g.stroke(); }
        for (var gy = y + 40; gy < y + h; gy += 60) { g.beginPath(); g.moveTo(x, gy); g.lineTo(x + w, gy); g.stroke(); }

        // stopa: široká průsvitná „záře" + tenká ostrá čára navrch
        if (pts.length > 1) {
            g.lineJoin = 'round'; g.lineCap = 'round';
            g.strokeStyle = 'rgba(52,211,153,0.18)'; g.lineWidth = 18;
            g.beginPath(); g.moveTo(X(pts[0].lng), Y(pts[0].lat));
            for (var j = 1; j < pts.length; j++) g.lineTo(X(pts[j].lng), Y(pts[j].lat));
            g.stroke();
            g.strokeStyle = C.track; g.lineWidth = 5;
            g.beginPath(); g.moveTo(X(pts[0].lng), Y(pts[0].lat));
            for (var j2 = 1; j2 < pts.length; j2++) g.lineTo(X(pts[j2].lng), Y(pts[j2].lat));
            g.stroke();

            // začátek a konec dne
            var a = pts[0], b = pts[pts.length - 1];
            g.fillStyle = C.bg; g.strokeStyle = C.track; g.lineWidth = 4;
            g.beginPath(); g.arc(X(a.lng), Y(a.lat), 11, 0, 6.2832); g.fill(); g.stroke();
            g.fillStyle = C.track;
            g.beginPath(); g.arc(X(b.lng), Y(b.lat), 9, 0, 6.2832); g.fill();
            g.font = '600 22px system-ui, -apple-system, "Segoe UI", sans-serif';
            g.fillStyle = C.dim;
            g.fillText(fmtTime(a.t), X(a.lng) + 16, Y(a.lat) - 12);
            g.fillText(fmtTime(b.t), X(b.lng) + 16, Y(b.lat) + 28);
        }

        // body zaměřené ten den
        for (var k = 0; k < cps.length; k++) {
            var q = cps[k], qx = X(q.lng), qy = Y(q.lat);
            g.fillStyle = 'rgba(251,191,36,0.22)';
            g.beginPath(); g.arc(qx, qy, 16, 0, 6.2832); g.fill();
            g.fillStyle = C.point;
            g.beginPath(); g.arc(qx, qy, 7, 0, 6.2832); g.fill();
        }
        g.restore();

        // měřítko — bez něj je tvar trasy jen ozdoba a nejde odhadnout velikost
        // s je PIXELŮ NA STUPEŇ zeměpisné šířky; jeden stupeň je ~111 320 m,
        // takže metrů na pixel = 111320 / s (ne 1/(s·111320) — ten překlep dělal
        // měřítko o dva řády delší, než je plátno).
        var mPerPx = 111320 / s;
        var target = (w - 2 * pad) * 0.28 * mPerPx;
        var nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
        var pick = nice[0];
        for (var n = 0; n < nice.length; n++) if (nice[n] <= target) pick = nice[n];
        var barPx = pick / mPerPx;
        var bx = x + 34, by = y + h - 34;
        g.strokeStyle = C.ink; g.lineWidth = 3;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + barPx, by); g.stroke();
        g.beginPath(); g.moveTo(bx, by - 8); g.lineTo(bx, by + 8); g.moveTo(bx + barPx, by - 8); g.lineTo(bx + barPx, by + 8); g.stroke();
        g.fillStyle = C.ink; g.font = '600 24px system-ui, -apple-system, "Segoe UI", sans-serif';
        g.fillText(pick >= 1000 ? (pick / 1000) + ' km' : pick + ' m', bx + barPx + 14, by + 9);

        // sever
        var nx = x + w - 52, ny = y + 52;
        g.strokeStyle = C.ink; g.lineWidth = 3;
        g.beginPath(); g.moveTo(nx, ny + 20); g.lineTo(nx, ny - 18); g.stroke();
        g.beginPath(); g.moveTo(nx - 8, ny - 8); g.lineTo(nx, ny - 20); g.lineTo(nx + 8, ny - 8); g.closePath();
        g.fillStyle = C.ink; g.fill();
        g.font = '700 22px system-ui, -apple-system, "Segoe UI", sans-serif';
        g.textAlign = 'center'; g.fillText('S', nx, ny + 42); g.textAlign = 'left';
    }

    function statCard(g, x, y, w, h, value, unit, label, col) {
        roundRect(g, x, y, w, h, 22);
        g.fillStyle = C.bg2; g.fill();
        g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
        g.fillStyle = col || C.ink;
        // Písmo se ZMENŠÍ, aby se číslo i s jednotkou vešlo do karty. Bez toho
        // přeteklo „7:25 h" do sousední karty (karty jsou jen čtvrtina šířky).
        var avail = w - 28, size = 62, vw, uw;
        for (var s2 = 0; s2 < 12; s2++) {
            g.font = '800 ' + size + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
            vw = g.measureText(value).width;
            uw = 0;
            if (unit) { g.font = '600 ' + Math.round(size * 0.45) + 'px system-ui, -apple-system, "Segoe UI", sans-serif'; uw = g.measureText(' ' + unit).width; }
            if (vw + uw <= avail || size <= 30) break;
            size -= 4;
        }
        var startX = x + w / 2 - (vw + uw) / 2;
        g.textAlign = 'left';
        g.font = '800 ' + size + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
        g.fillText(value, startX, y + h / 2 + 8);
        if (unit) {
            g.font = '600 ' + Math.round(size * 0.45) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
            g.fillStyle = C.dim;
            g.fillText(' ' + unit, startX + vw, y + h / 2 + 8);
        }
        g.textAlign = 'center';
        g.fillStyle = C.dim;
        g.font = '600 24px system-ui, -apple-system, "Segoe UI", sans-serif';
        g.fillText(label, x + w / 2, y + h - 26);
        g.textAlign = 'left';
    }

    function render(cv, m) {
        var g = cv.getContext('2d');
        g.clearRect(0, 0, W, H);

        // pozadí s jemným přechodem
        var grd = g.createLinearGradient(0, 0, 0, H);
        grd.addColorStop(0, '#0d1526'); grd.addColorStop(1, C.bg);
        g.fillStyle = grd; g.fillRect(0, 0, W, H);

        var M = 60;                       // okraj

        // ---- hlavička ----
        g.fillStyle = C.accent;
        g.font = '700 30px system-ui, -apple-system, "Segoe UI", sans-serif';
        g.fillText('DENÍK DNE', M, 96);
        g.fillStyle = C.ink;
        g.font = '800 60px system-ui, -apple-system, "Segoe UI", sans-serif';
        g.fillText(fitText(g, m.day, W - 2 * M), M, 168);
        g.fillStyle = C.dim;
        g.font = '500 30px system-ui, -apple-system, "Segoe UI", sans-serif';
        var sub = m.proj;
        if (m.user) sub += '  ·  ' + m.user;
        if (m.firm) sub += '  ·  ' + m.firm;
        g.fillText(fitText(g, sub, W - 2 * M), M, 214);

        // dělicí linka
        g.strokeStyle = C.line; g.lineWidth = 2;
        g.beginPath(); g.moveTo(M, 246); g.lineTo(W - M, 246); g.stroke();

        // ---- mapa dne ----
        drawMapArea(g, m, M, 278, W - 2 * M, 700);

        // ---- čtyři čísla ----
        var akt = m.akt || {};
        var nAdd = (m.pts && m.pts.add) ? m.pts.add.length : 0;
        var km = akt.dist ? akt.dist / 1000 : (m.track ? m.track.len / 1000 : 0);
        var casMs = akt.ms || (m.track ? Math.max(0, m.track.to - m.track.from) : 0);
        var up = akt.up || 0;

        var gap = 20, cw = (W - 2 * M - 3 * gap) / 4, ch = 172, cy0 = 1010;
        statCard(g, M, cy0, cw, ch, String(nAdd), 'ks', 'nové body', C.gold);
        statCard(g, M + (cw + gap), cy0, cw, ch, (km >= 10 ? km.toFixed(0) : km.toFixed(1)), 'km', 'ušlá stopa', C.accent);
        var ck = casKarta(casMs);
        statCard(g, M + 2 * (cw + gap), cy0, cw, ch, ck.v, ck.u, 'v terénu', C.accent2);
        statCard(g, M + 3 * (cw + gap), cy0, cw, ch, String(Math.round(up)), 'm', 'nastoupáno', C.ink);

        // ---- řádky s doplňky ----
        var ly = cy0 + ch + 56;
        g.font = '500 30px system-ui, -apple-system, "Segoe UI", sans-serif';
        var rows = [];
        if (m.pts && (m.pts.edit || m.pts.del)) {
            var t = [];
            if (m.pts.edit) t.push(m.pts.edit + '× upraveno');
            if (m.pts.del) t.push(m.pts.del + '× smazáno');
            rows.push(['Body', t.join(' · ') + (m.pts.total ? '  (v zakázce celkem ' + m.pts.total + ')' : '')]);
        } else if (m.pts && m.pts.total) {
            rows.push(['Body', 'v zakázce celkem ' + m.pts.total]);
        }
        if (m.track) rows.push(['Terén', fmtTime(m.track.from) + ' – ' + fmtTime(m.track.to)]);
        if (akt.steps) rows.push(['Kroky', Math.round(akt.steps).toLocaleString('cs-CZ')]);
        if (akt.topTool) rows.push(['Nejčastěji', akt.topTool + ' (' + akt.topN + '×)']);
        if (m.poc) {
            var w = [];
            if (m.poc.temp != null) w.push(Math.round(m.poc.temp) + ' °C');
            var wt = wmoTxt(m.poc.code); if (wt) w.push(wt);
            if (m.poc.wind != null) w.push('vítr ' + Math.round(m.poc.wind) + ' km/h');
            if (m.poc.place) w.push(m.poc.place);
            if (w.length) rows.push(['Počasí', w.join(' · ')]);
        }
        for (var i = 0; i < rows.length && i < 5; i++) {
            var label = rows[i][0];
            g.fillStyle = C.dim;
            g.font = '600 28px system-ui, -apple-system, "Segoe UI", sans-serif';
            g.fillText(label, M, ly);
            g.fillStyle = C.ink;
            g.font = '500 28px system-ui, -apple-system, "Segoe UI", sans-serif';
            g.fillText(fitText(g, rows[i][1], W - 2 * M - 220), M + 220, ly);
            ly += 46;
        }

        // ---- patička ----
        g.strokeStyle = C.line; g.lineWidth = 2;
        g.beginPath(); g.moveTo(M, H - 96); g.lineTo(W - M, H - 96); g.stroke();
        g.fillStyle = C.dim;
        g.font = '500 24px system-ui, -apple-system, "Segoe UI", sans-serif';
        g.fillText('AR Geodet · stopa a výškové metry jsou z mobilní GPS, orientačně', M, H - 52);
        g.textAlign = 'right';
        g.fillStyle = C.accent;
        g.font = '700 24px system-ui, -apple-system, "Segoe UI", sans-serif';
        g.fillText(new Date().toLocaleDateString('cs-CZ'), W - M, H - 52);
        g.textAlign = 'left';
    }

    // ================================================================
    //  UI
    // ================================================================
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + MODAL_ID + ' .modal-content{max-width:560px;}',
            '.ag-pl-wrap{background:#0b1220;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);}',
            '.ag-pl-wrap canvas{display:block;width:100%;height:auto;}',
            '.ag-pl-days{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px;}',
            '.ag-pl-chip{background:var(--surface-2,#1b2330);color:var(--text-color,#e6e8eb);border:1px solid rgba(255,255,255,0.10);',
            '  border-radius:999px;padding:7px 14px;font-size:calc(14px * var(--ag-font-scale, 1));}',
            '.ag-pl-chip.on{background:var(--accent,#2f9e74);color:#04110b;border-color:transparent;font-weight:700;}',
            '.ag-pl-days input[type=date]{background:var(--surface-2,#1b2330);color:var(--text-color,#e6e8eb);',
            '  border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:6px 10px;font-size:calc(13px * var(--ag-font-scale, 1));}',
            '.ag-pl-foot{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;}',
            '.ag-pl-foot .btn{flex:1 1 30%;}',
            '.ag-pl-note{color:var(--text-muted,#9aa1ac);font-size:calc(12px * var(--ag-font-scale, 1));margin:10px 0 0;line-height:1.45;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    function ensureModal() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = MODAL_ID;
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Plakát dne</h3>' +
            '  <div class="ag-pl-days">' +
            '    <button type="button" class="ag-pl-chip on" data-off="0">Dnes</button>' +
            '    <button type="button" class="ag-pl-chip" data-off="1">Včera</button>' +
            '    <input type="date" id="ag-pl-date" aria-label="Jiné datum">' +
            '  </div>' +
            '  <div class="ag-pl-wrap"><canvas id="ag-pl-cv" width="' + W + '" height="' + H + '"></canvas></div>' +
            '  <div class="ag-pl-foot">' +
            '    <button type="button" class="btn btn-primary" id="ag-pl-share">Sdílet</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-pl-save">Uložit obrázek</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-pl-close">Zavřít</button>' +
            '  </div>' +
            '  <p class="ag-pl-note">Obrázek 1080×1620 px. Ušlá vzdálenost a výškové metry pocházejí z mobilní GPS — jsou orientační, ne měřené.</p>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-pl-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-pl-share').addEventListener('click', function () { exportPng(true); });
        m.querySelector('#ag-pl-save').addEventListener('click', function () { exportPng(false); });
        var chips = m.querySelectorAll('.ag-pl-chip');
        for (var i = 0; i < chips.length; i++) {
            chips[i].addEventListener('click', function () {
                _dayOff = parseInt(this.getAttribute('data-off'), 10) || 0;
                _customDate = null;
                var dEl = m.querySelector('#ag-pl-date'); if (dEl) dEl.value = '';
                syncChips(); refresh();
            });
        }
        m.querySelector('#ag-pl-date').addEventListener('change', function () {
            if (this.value) { _customDate = this.value; syncChips(); refresh(); }
        });
        return m;
    }
    function syncChips() {
        var m = document.getElementById(MODAL_ID); if (!m) return;
        var chips = m.querySelectorAll('.ag-pl-chip');
        for (var i = 0; i < chips.length; i++) {
            var off = parseInt(chips[i].getAttribute('data-off'), 10);
            chips[i].classList.toggle('on', !_customDate && off === _dayOff);
        }
    }
    function refresh() {
        var cv = document.getElementById('ag-pl-cv');
        if (!cv) return;
        _lastBlob = null;
        if (_busy) return;
        _busy = true;
        build(function (m) {
            _busy = false;
            try { render(cv, m); } catch (e) { swallow(e, 'plakat:render'); toast('Plakát se nepodařilo vykreslit.'); }
        });
    }

    function fileName() {
        var r = dayRange();
        return 'denik-' + dayKey(r.date) + '.png';
    }
    function withBlob(cb) {
        var cv = document.getElementById('ag-pl-cv');
        if (!cv) return;
        if (_lastBlob) return cb(_lastBlob);
        try {
            cv.toBlob(function (b) { _lastBlob = b; cb(b); }, 'image/png');
        } catch (e) { swallow(e, 'plakat:toBlob'); cb(null); }
    }
    function exportPng(share) {
        withBlob(function (b) {
            if (!b) { toast('Obrázek se nepodařilo vyrobit.'); return; }
            var name = fileName();
            var file = null;
            try { file = new File([b], name, { type: 'image/png' }); } catch (e) { file = null; }
            if (share && file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
                navigator.share({ files: [file], title: 'Deník dne — AR Geodet' })['catch'](function () { /* uživatel zrušil */ });
                return;
            }
            // Bez sdílení souborů: stažení. Na starším iOS `download` nefunguje,
            // proto se obrázek nakonec otevře na kartě a řekne se, co s ním.
            var url = URL.createObjectURL(b);
            var a = document.createElement('a');
            if ('download' in a) {
                a.href = url; a.download = name;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
                toast('Uloženo jako ' + name);
            } else {
                var w2 = window.open(url, '_blank');
                if (!w2) { toast('Prohlížeč zablokoval nové okno.'); URL.revokeObjectURL(url); return; }
                toast('Podrž prstem na obrázku a ulož do Fotek.');
            }
        });
    }

    function open(opts) {
        if (opts && opts.date) { _customDate = opts.date; _dayOff = 0; }
        else if (!opts || !opts.keep) { _dayOff = 0; _customDate = null; }
        var m = ensureModal();
        var dEl = m.querySelector('#ag-pl-date');
        if (dEl) dEl.value = _customDate || '';
        syncChips();
        m.style.display = 'flex';
        refresh();
    }

    // ---- tlačítko „Plakát" přímo v Deníku dne --------------------------------
    // Deník si patičku staví sám a může vzniknout kdykoli (je lazy), proto se
    // vkládá při tiku a je to idempotentní (podle id).
    function hookDenik() {
        var foot = document.querySelector('#ag-dd-modal .ag-dd-foot');
        if (!foot || document.getElementById('ag-pl-fromdd')) return;
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn-secondary'; b.id = 'ag-pl-fromdd';
        b.textContent = 'Plakát';
        b.addEventListener('click', function () {
            // převzít den zvolený v deníku, ať se dvě okna neliší
            var dd = document.querySelector('#ag-dd-modal #ag-dd-date');
            var chip = document.querySelector('#ag-dd-modal .ag-dd-chip.on');
            if (dd && dd.value) { _customDate = dd.value; }
            else { _customDate = null; _dayOff = chip ? (parseInt(chip.getAttribute('data-off'), 10) || 0) : 0; }
            open({ keep: true });
        });
        var pdf = foot.querySelector('#ag-dd-pdf');
        if (pdf && pdf.nextSibling) foot.insertBefore(b, pdf.nextSibling); else foot.appendChild(b);
    }

    // ================================================================
    //  init
    // ================================================================
    var _tries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'plakat-dne', label: 'Plakát dne', icon: ICON, cat: 'Pomůcky', onClick: function () { open(); }, order: 63 });
            return true;
        }
        return false;
    }
    function init() {
        if (!register() && _tries++ < 20) setTimeout(init, 500);
        if (!window.__agPlTimer) {
            window.__agPlTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
                try { hookDenik(); } catch (e) { swallow(e, 'plakat:tik'); }
            }, 1500);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGPlakat = { open: open };
    window.agOpenPlakatDne = function () { open(); };
})();
