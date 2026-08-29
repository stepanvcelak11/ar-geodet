// ===== AR Geodet — OBCHŮZKA VÝKOPU: kubatura z obejití hrany (ODPOJITELNÁ) ======
// K čemu: „kolik se z toho vykopalo" se dneska počítá tak, že se výkop zaměří,
// data se odvezou do kanceláře a tam se z nich udělá model. Tenhle nástroj to
// zvládne na místě: obejdeš hranu výkopu, zaměříš dno a hned víš objem — i s
// poctivým ± a s podklady, ze kterých se to dá v kanceláři přepočítat.
//
// JAK SE TO POČÍTÁ (a proč zrovna takhle):
//   • PLOCHA z obejité hrany se počítá Gaussovým vzorcem v rovinných S-JTSK
//     souřadnicích — v ČR je to správný způsob výpočtu výměr, ne kulová plocha.
//   • TERÉN (horní plocha) se prokládá rovinou metodou nejmenších čtverců přes
//     výšky bodů hrany. Rovina proto respektuje spád pozemku; průměr výšek by u
//     nakloněného terénu dělal chybu.
//   • DNO: podle toho, co se dá změřit —
//       ≥ 3 body dna  → dno se taky proloží rovinou a objem se počítá jako
//                       KOMOLÝ JEHLAN (prismatoidní vzorec V = h/3·(A₁+A₂+√(A₁A₂))).
//                       Tohle je jediná varianta, která umí svahované stěny.
//       1–2 body dna  → dno je vodorovná rovina v jejich průměrné výšce a stěny
//                       se berou jako SVISLÉ: V = A · h.
//       0 bodů dna    → zadáš hloubku ručně (pásmo, lať); zase svislé stěny.
//   • SVISLÉ STĚNY JSOU HORNÍ ODHAD. U svahovaného výkopu je skutečný objem menší;
//     appka to u výsledku napíše a doporučí obejít i hranu dna. Nemlčet o tom je
//     důležitější než hezčí číslo — z kubatury se fakturuje.
//
// PŘESNOST: všechno stojí na GPS mobilu. Výška z GPS je typicky 2–3× horší než
// poloha, takže hlavní chyba objemu jde z hloubky. Appka proto počítá ± z
// dosažené přesnosti fixů (svisle i vodorovně) a ukazuje ho vedle objemu. Když
// máš rover nebo nivelák, zadej hloubku ručně — bude to řádově lepší.
//
// CO TENHLE NÁSTROJ ZÁMĚRNĚ NENÍ: fotogrammetrie ani 3D sken. Model výkopu z
// videa (Gaussian splatting, NeRF) se v prohlížeči na telefonu spočítat nedá a
// slibovat ho nebudeme. Tady se měří to, co jde obhájit — obvod a výšky.
//
// NAVAZUJE: body hrany i dna jde jedním tlačítkem přenést do bodů zakázky a
// v nástroji Kubatury/vrstevnice (js/dmt-volume.js) z nich udělat TIN.
// NEEDITUJE logika.js ani grafika.js. Odstranění: smaž js/obchuzka.js + řádek
// <script> v index.html a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGObchuzka) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 8 5l8 3 5-2.5"/><path d="M3 8.5V18l5 3 8-3 5 2.5V6.5"/><path d="M8 5v16M16 8v10"/></svg>';
    var STYLE_ID = 'ag-ob-style';
    var LS = 'agObchuzka_v1';         // { pid: [ {id, ts, name, top:[], bot:[], depth, note} ] }
    var AUTO_MIN_M = 1.5;             // auto-záznam: minimální posun mezi vrcholy
    var AUTO_MAX_ACC = 15;            // horší fix než tohle se do obchůzky nebere
    var AVG_MS = 3000;                // průměrování při ručním vrcholu

    // ---- stav -------------------------------------------------------------------------
    var _job = null;                  // rozpracovaná obchůzka {name, top:[], bot:[], depth, note}
    var _rec = 'off';                 // 'off' | 'top' | 'bot'  — co se právě obchází
    var _tick = null, _avg = null, _avgSamples = [], _avgUntil = 0, _avgTo = 'top';
    var _wake = null;

    // ---- pomocné ----------------------------------------------------------------------
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:toast'); } }
    function info(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert(t, m); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:info'); } toast(m); }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmtDT(ts) { var d = new Date(ts); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    function fmtNum(v, dec) { return Number(v).toFixed(dec == null ? 2 : dec).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function toSJTSK(lat, lng) {
        try { if (window.GeoCore && GeoCore.toSJTSK) return GeoCore.toSJTSK(lat, lng); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:toSJTSK'); }
        try { if (typeof proj4 === 'function') { var c = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); return { y: Math.abs(c[0]), x: Math.abs(c[1]) }; } } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'obchuzka:toSJTSK'); }
        return null;
    }
    function fix() {
        try {
            if (typeof userLat === 'undefined' || userLat == null) return null;
            var acc = (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy != null) ? currentGpsAccuracy : null;
            var z = null;
            if (typeof userAlt !== 'undefined' && userAlt != null && isFinite(userAlt)) {
                var und = 0;
                try { if (typeof getGeoidUndulation === 'function') und = getGeoidUndulation(userLat, userLng) || 0; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:fix'); }
                z = userAlt - und;                       // elipsoidická výška -> Bpv
            }
            return { lat: userLat, lng: userLng, z: z, acc: acc, ts: Date.now() };
        } catch (e2) { return null; }
    }
    function distM(a, b) {
        try { if (typeof getDistance === 'function') return getDistance(a.lat, a.lng, b.lat, b.lng); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:distM'); }
        var R = 6371000, r = Math.PI / 180;
        var s = Math.sin((b.lat - a.lat) * r / 2), t = Math.sin((b.lng - a.lng) * r / 2);
        var h = s * s + Math.cos(a.lat * r) * Math.cos(b.lat * r) * t * t;
        return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    function lockScreen() {
        try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { _wake = w; })['catch'](function () {}); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:lockScreen'); }
    }
    function unlockScreen() { try { if (_wake) { _wake.release(); _wake = null; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:unlockScreen'); } }

    // ---- geometrie ----------------------------------------------------------------------
    // Gaussův vzorec nad rovinnými S-JTSK souřadnicemi (v ČR správný způsob výpočtu výměr).
    function areaOf(list) {
        var p = [];
        for (var i = 0; i < list.length; i++) {
            var s = toSJTSK(list[i].lat, list[i].lng);
            if (!s) return null;
            p.push(s);
        }
        if (p.length < 3) return 0;
        var a = 0;
        for (var j = 0; j < p.length; j++) {
            var q = p[(j + 1) % p.length];
            a += p[j].y * q.x - q.y * p[j].x;
        }
        return Math.abs(a) / 2;
    }
    function perimeterOf(list) {
        if (list.length < 2) return 0;
        var d = 0;
        for (var i = 0; i < list.length; i++) d += distM(list[i], list[(i + 1) % list.length]);
        return d;
    }
    function centroidOf(list) {
        var p = [];
        for (var i = 0; i < list.length; i++) { var s = toSJTSK(list[i].lat, list[i].lng); if (s) p.push(s); }
        if (!p.length) return null;
        if (p.length < 3) {
            var sy = 0, sx = 0;
            p.forEach(function (q) { sy += q.y; sx += q.x; });
            return { y: sy / p.length, x: sx / p.length };
        }
        var a = 0, cy = 0, cx = 0;
        for (var j = 0; j < p.length; j++) {
            var q2 = p[(j + 1) % p.length];
            var f = p[j].y * q2.x - q2.y * p[j].x;
            a += f; cy += (p[j].y + q2.y) * f; cx += (p[j].x + q2.x) * f;
        }
        if (Math.abs(a) < 1e-9) return { y: p[0].y, x: p[0].x };
        return { y: cy / (3 * a), x: cx / (3 * a) };
    }
    // Rovina z = a·y + b·x + c metodou nejmenších čtverců přes body s výškou.
    // Proč rovina a ne průměr: u výkopu ve spádu (a to je skoro každý) by průměr
    // výšek hrany posunul celý objem o polovinu převýšení plochy.
    function fitPlane(list) {
        var pts = [];
        list.forEach(function (r) {
            if (r.z == null || !isFinite(r.z)) return;
            var s = toSJTSK(r.lat, r.lng);
            if (s) pts.push({ y: s.y, x: s.x, z: r.z });
        });
        if (!pts.length) return null;
        if (pts.length < 3) {
            var sz = 0;
            pts.forEach(function (p) { sz += p.z; });
            return { a: 0, b: 0, c: sz / pts.length, n: pts.length, flat: true };
        }
        // posun k těžišti kvůli podmíněnosti soustavy (souřadnice S-JTSK mají 6 míst)
        var my = 0, mx = 0, mz = 0;
        pts.forEach(function (p) { my += p.y; mx += p.x; mz += p.z; });
        my /= pts.length; mx /= pts.length; mz /= pts.length;
        var Syy = 0, Sxx = 0, Syx = 0, Syz = 0, Sxz = 0;
        pts.forEach(function (p) {
            var dy = p.y - my, dx = p.x - mx, dz = p.z - mz;
            Syy += dy * dy; Sxx += dx * dx; Syx += dy * dx; Syz += dy * dz; Sxz += dx * dz;
        });
        var det = Syy * Sxx - Syx * Syx;
        if (Math.abs(det) < 1e-6) return { a: 0, b: 0, c: mz, n: pts.length, flat: true };   // body v jedné přímce
        var a = (Syz * Sxx - Sxz * Syx) / det;
        var b = (Sxz * Syy - Syz * Syx) / det;
        var c = mz - a * my - b * mx;
        // zbytkové odchylky = jak dobře rovina sedí (u hrany výkopu bývá terén zvlněný)
        var rms = 0;
        pts.forEach(function (p) { var d = p.z - (a * p.y + b * p.x + c); rms += d * d; });
        rms = Math.sqrt(rms / pts.length);
        return { a: a, b: b, c: c, n: pts.length, rms: rms, flat: false };
    }
    function planeZ(pl, s) { return pl ? (pl.a * s.y + pl.b * s.x + pl.c) : null; }

    // Hlavní výpočet. Vrací null, dokud není co počítat.
    function compute(job) {
        if (!job || job.top.length < 3) return null;
        var A1 = areaOf(job.top);
        if (A1 == null) return null;
        var ctr = centroidOf(job.top);
        var topPl = fitPlane(job.top);
        var out = {
            A1: A1, per: perimeterOf(job.top), ctr: ctr, topPl: topPl,
            nTop: job.top.length, nBot: job.bot.length
        };
        var zTop = (topPl && ctr) ? planeZ(topPl, ctr) : null;

        var h = null, mode = '';
        if (job.bot.length >= 3) {
            var A2 = areaOf(job.bot);
            var botPl = fitPlane(job.bot);
            var ctr2 = centroidOf(job.bot);
            var zBot = (botPl && ctr2) ? planeZ(botPl, ctr2) : null;
            if (zTop != null && zBot != null && A2 != null) {
                h = zTop - zBot;
                out.A2 = A2; out.botPl = botPl; out.zBot = zBot;
                // komolý jehlan: jediná varianta, která umí svahované stěny
                out.V = Math.abs(h) / 3 * (A1 + A2 + Math.sqrt(Math.max(0, A1 * A2)));
                mode = 'frustum';
            }
        }
        if (out.V == null && job.bot.length) {
            var botPl2 = fitPlane(job.bot);
            var zB = botPl2 ? botPl2.c : null;
            if (job.bot.length >= 3 && botPl2 && ctr) zB = planeZ(botPl2, ctr);
            if (zTop != null && zB != null) { h = zTop - zB; out.V = A1 * Math.abs(h); mode = 'vertical'; out.zBot = zB; }
        }
        if (out.V == null && job.depth != null && isFinite(job.depth) && job.depth > 0) {
            h = job.depth; out.V = A1 * job.depth; mode = 'depth';
        }
        out.h = (h != null) ? Math.abs(h) : null;
        out.mode = mode;
        out.zTop = zTop;

        // ---- poctivé ± ------------------------------------------------------------------
        // Objem chybuje ze dvou stran: z hloubky (svislá složka GPS, typicky 1,5–2×
        // horší než vodorovná) a z plochy (vodorovná chyba obvodu). Sčítá se kvadraticky.
        var accH = medAcc(job.top.concat(job.bot));
        if (accH != null && out.V != null) {
            var sZ = accH * 1.7 / Math.sqrt(Math.max(1, out.nTop));   // chyba střední výšky roviny
            var sZb = (job.bot.length ? accH * 1.7 / Math.sqrt(job.bot.length) : (job.depth != null ? 0.05 : accH * 1.7));
            var sHh = Math.sqrt(sZ * sZ + sZb * sZb);
            var sA = out.per * accH / 2;                              // posun hrany o ±acc
            var sV = Math.sqrt(Math.pow(A1 * sHh, 2) + Math.pow((out.h || 0) * sA, 2));
            out.sV = sV; out.sH = sHh; out.acc = accH;
        }
        return out;
    }
    function medAcc(list) {
        var a = list.filter(function (r) { return r && r.acc != null && isFinite(r.acc); }).map(function (r) { return r.acc; });
        if (!a.length) return null;
        a.sort(function (x, y) { return x - y; });
        return a[Math.floor(a.length / 2)];
    }

    // ---- záznam ------------------------------------------------------------------------------
    function addVertex(to, f, manual) {
        if (!_job) return;
        var arr = (to === 'bot') ? _job.bot : _job.top;
        arr.push({ lat: f.lat, lng: f.lng, z: f.z, acc: f.acc, ts: f.ts, man: !!manual });
        persist();
        refresh();
    }
    function startRec(what) {
        if (!_job) newJob();
        _rec = what;
        lockScreen();
        if (_tick) clearInterval(_tick);
        _tick = setInterval(function () {
            if (_rec === 'off') return;
            var f = fix();
            if (!f) return;
            if (f.acc != null && f.acc > AUTO_MAX_ACC) { refresh(); return; }  // špatný fix do obvodu nepatří
            var arr = (_rec === 'bot') ? _job.bot : _job.top;
            var last = arr[arr.length - 1];
            if (!last || distM(last, f) >= AUTO_MIN_M) addVertex(_rec, f, false);
            else refresh();
        }, 1000);
        refresh();
    }
    function stopRec() {
        _rec = 'off';
        if (_tick) { clearInterval(_tick); _tick = null; }
        unlockScreen();
        refresh();
    }
    // Ruční vrchol (roh výkopu): stojíš, průměruje se pár sekund — roh je to
    // nejdůležitější místo obvodu a jeden fix za chůze ho neurčí.
    function addManual(to) {
        if (_avg) return;
        if (!_job) newJob();
        if (!fix()) { toast('GPS nemá fix.'); return; }
        _avgTo = to; _avgSamples = []; _avgUntil = Date.now() + AVG_MS;
        _avg = setInterval(function () {
            var f = fix();
            if (f) {
                var last = _avgSamples[_avgSamples.length - 1];
                if (!last || last.lat !== f.lat || last.lng !== f.lng) _avgSamples.push(f);
            }
            if (Date.now() >= _avgUntil) finishManual();
            else refresh();
        }, 300);
        refresh();
    }
    function finishManual() {
        if (_avg) { clearInterval(_avg); _avg = null; }
        var n = _avgSamples.length;
        if (!n) { toast('Nepřišla ani jedna poloha.'); refresh(); return; }
        var sLat = 0, sLng = 0, sZ = 0, nZ = 0, sAcc = 0, nAcc = 0;
        _avgSamples.forEach(function (f) {
            sLat += f.lat; sLng += f.lng;
            if (f.z != null) { sZ += f.z; nZ++; }
            if (f.acc != null) { sAcc += f.acc; nAcc++; }
        });
        addVertex(_avgTo, {
            lat: sLat / n, lng: sLng / n,
            z: nZ ? sZ / nZ : null,
            acc: nAcc ? (sAcc / nAcc) / Math.sqrt(n) : null,   // průměrování zlepší i deklarovanou přesnost
            ts: Date.now()
        }, true);
        try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:finishManual'); }
        toast('Vrchol přidán (' + n + ' vzorků).');
    }
    function undo(which) {
        if (!_job) return;
        var arr = (which === 'bot') ? _job.bot : _job.top;
        if (!arr.length) return;
        arr.pop();
        persist(); refresh();
    }

    // ---- ukládání ------------------------------------------------------------------------------
    function all() {
        var o = {};
        try { o = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:all'); }
        if (!o[pid()]) o[pid()] = [];
        return o;
    }
    function saveAll(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { toast('Uložení se nepovedlo — plná paměť?'); } }
    function newJob() {
        _job = { id: 'ob_' + Date.now(), ts: Date.now(), name: 'Výkop ' + fmtDT(Date.now()), top: [], bot: [], depth: null, note: '' };
    }
    function persist() {
        if (!_job) return;
        var o = all(), list = o[pid()];
        var i = -1;
        for (var k = 0; k < list.length; k++) if (list[k].id === _job.id) { i = k; break; }
        if (i >= 0) list[i] = _job; else list.unshift(_job);
        saveAll(o);
    }
    function loadJob(id) {
        var list = all()[pid()];
        for (var i = 0; i < list.length; i++) if (list[i].id === id) { _job = list[i]; if (!_job.bot) _job.bot = []; render(); return; }
    }
    function delJob(id) {
        var o = all();
        o[pid()] = o[pid()].filter(function (r) { return r.id !== id; });
        saveAll(o);
        if (_job && _job.id === id) _job = null;
        render();
    }

    // ---- předání dál ------------------------------------------------------------------------------
    function toPoints() {
        if (!_job || (!_job.top.length && !_job.bot.length)) { toast('Není co přenášet.'); return; }
        if (typeof window.addImportedPoints !== 'function') { toast('Vkládání bodů není dostupné.'); return; }
        var base = String(_job.name || 'VYKOP').replace(/\s+/g, '_').slice(0, 12);
        var arr = [];
        _job.top.forEach(function (r, i) {
            arr.push({ name: base + '_H' + (i + 1), lat: r.lat, lng: r.lng, vyska: r.z, kod: 'hrana výkopu', acc: r.acc, origin: 'gps-avg' });
        });
        _job.bot.forEach(function (r, i) {
            arr.push({ name: base + '_D' + (i + 1), lat: r.lat, lng: r.lng, vyska: r.z, kod: 'dno výkopu', acc: r.acc, origin: 'gps-avg' });
        });
        var n = window.addImportedPoints(arr);
        toast(n ? ('Přeneseno ' + n + ' bodů do zakázky.') : 'Body už v zakázce jsou.');
    }
    function exportCsv() {
        if (!_job) return;
        var rows = ['typ;poradi;Y;X;Z_Bpv;presnost_m;cas'];
        function add(list, t) {
            list.forEach(function (r, i) {
                var s = toSJTSK(r.lat, r.lng);
                rows.push([t, i + 1, s ? s.y.toFixed(2) : '', s ? s.x.toFixed(2) : '',
                    (r.z != null ? r.z.toFixed(2) : ''), (r.acc != null ? r.acc.toFixed(1) : ''),
                    new Date(r.ts).toISOString()].join(';'));
            });
        }
        add(_job.top, 'hrana'); add(_job.bot, 'dno');
        var c = compute(_job);
        if (c) {
            rows.push('');
            rows.push('plocha_m2;' + c.A1.toFixed(2));
            rows.push('obvod_m;' + c.per.toFixed(2));
            if (c.h != null) rows.push('hloubka_m;' + c.h.toFixed(2));
            if (c.V != null) rows.push('objem_m3;' + c.V.toFixed(1));
            if (c.sV != null) rows.push('objem_nejistota_m3;' + c.sV.toFixed(1));
        }
        var blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'obchuzka_' + (_job.name || 'vykop').replace(/\W+/g, '_') + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:add'); } }, 4000);
    }

    // ---- náhled ------------------------------------------------------------------------------------
    function drawPlan() {
        var cv = document.getElementById('ag-ob-plan');
        if (!cv || !_job) return;
        var w = cv.clientWidth || 300, h = 200;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px'; }
        var ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        var pts = [];
        function conv(list, t) {
            return list.map(function (r) { var s = toSJTSK(r.lat, r.lng); if (s) { s.t = t; pts.push(s); } return s; }).filter(Boolean);
        }
        var T = conv(_job.top, 'top'), B = conv(_job.bot, 'bot');
        if (!pts.length) return;
        var minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
        pts.forEach(function (p) {
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        });
        var pad = 2;
        minY -= pad; maxY += pad; minX -= pad; maxX += pad;
        var s = Math.min((w - 16) / Math.max(1, maxY - minY), (h - 16) / Math.max(1, maxX - minX));
        function PX(p) { return 8 + (p.y - minY) * s; }
        function PY(p) { return h - 8 - (p.x - minX) * s; }
        function poly(list, col, fill) {
            if (list.length < 2) return;
            ctx.strokeStyle = col; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(PX(list[0]), PY(list[0]));
            for (var i = 1; i < list.length; i++) ctx.lineTo(PX(list[i]), PY(list[i]));
            if (list.length >= 3) ctx.closePath();
            if (fill && list.length >= 3) { ctx.fillStyle = fill; ctx.fill(); }
            ctx.stroke();
            ctx.fillStyle = col;
            list.forEach(function (p) { ctx.beginPath(); ctx.arc(PX(p), PY(p), 2.6, 0, 6.283); ctx.fill(); });
        }
        poly(T, '#2f9e74', 'rgba(47,158,116,0.14)');
        poly(B, '#fbbf24', 'rgba(251,191,36,0.12)');
        // měřítko
        ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
        var bar = (s > 6) ? 5 : (s > 1.5 ? 10 : 50);
        ctx.beginPath(); ctx.moveTo(10, h - 10); ctx.lineTo(10 + bar * s, h - 10); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '10px system-ui,sans-serif';
        ctx.fillText(bar + ' m', 10, h - 14);
    }

    // ---- styly --------------------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-ob-modal .modal-content{display:flex;flex-direction:column;}',
            '#ag-ob-body{flex:1;overflow-y:auto;min-height:0;}',
            '.ag-ob-h{font:700 11px/1 var(--font-display,system-ui);letter-spacing:.09em;text-transform:uppercase;',
            '  color:var(--text-muted,#9aa1ac);margin:14px 0 7px;}',
            '.ag-ob-h:first-child{margin-top:0;}',
            '#ag-ob-plan{width:100%;display:block;border-radius:12px;background:rgba(0,0,0,0.28);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));margin-bottom:10px;}',
            '.ag-ob-row{display:flex;gap:8px;margin-bottom:8px;}',
            '.ag-ob-row button,.ag-ob-row input,.ag-ob-row select{flex:1;min-width:0;padding:11px 10px;border-radius:12px;box-sizing:border-box;',
            '  cursor:pointer;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:var(--glass-bg,rgba(255,255,255,0.05));color:var(--text-color,#e6e8eb);',
            '  font:600 13px/1.2 var(--font-ui,system-ui);}',
            '.ag-ob-row button.prim{border-color:var(--accent-line,rgba(47,158,116,0.5));background:var(--accent-soft,rgba(47,158,116,0.16));color:var(--accent,#2f9e74);}',
            '.ag-ob-row button.rec{border-color:rgba(220,68,68,0.5);background:rgba(220,68,68,0.14);color:#f87171;}',
            '.ag-ob-row button.warn{border-color:rgba(220,68,68,0.4);color:#f87171;}',
            '.ag-ob-big{display:flex;gap:8px;margin-bottom:10px;}',
            '.ag-ob-cell{flex:1;padding:10px 8px;border-radius:12px;text-align:center;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '.ag-ob-cell b{display:block;font:800 20px/1.15 var(--font-display,system-ui);color:var(--text-color,#e6e8eb);}',
            '.ag-ob-cell small{display:block;margin-top:3px;font:600 10px/1.3 var(--font-ui,system-ui);',
            '  letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.ag-ob-vol{padding:14px;border-radius:14px;margin-bottom:10px;text-align:center;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.45));background:var(--accent-soft,rgba(47,158,116,0.12));}',
            '.ag-ob-vol b{display:block;font:800 34px/1.1 var(--font-display,system-ui);color:var(--accent,#2f9e74);}',
            '.ag-ob-vol small{display:block;margin-top:5px;font:600 12px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#c3c9d2);}',
            '.ag-ob-note{padding:9px 11px;border-radius:11px;margin-bottom:8px;font:500 12px/1.5 var(--font-ui,system-ui);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--glass-bg,rgba(255,255,255,0.04));color:var(--text-muted,#9aa1ac);}',
            '.ag-ob-note.warn{border-color:rgba(251,191,36,0.42);background:rgba(251,191,36,0.09);color:#fbbf24;}',
            '.ag-ob-it{display:flex;align-items:center;gap:10px;padding:9px 11px;margin-bottom:6px;border-radius:11px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));background:var(--glass-bg,rgba(255,255,255,0.04));',
            '  font:500 12px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.ag-ob-it b{color:var(--text-color,#e6e8eb);font-size:13.5px;}',
            '.ag-ob-it button{flex:none;padding:6px 10px;border-radius:9px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:transparent;color:var(--text-muted,#c3c9d2);font:600 11.5px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '#ag-ob-modal .ag-ob-foot{display:flex;gap:8px;margin-top:12px;}',
            '#ag-ob-modal .ag-ob-foot .btn{flex:1;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- vykreslení ------------------------------------------------------------------------------------
    // Vykreslení má DVĚ úrovně, stejně jako v js/indoor.js:
    //   render()  — postaví okno (seznam ↔ rozpracovaná obchůzka)
    //   refresh() — přepíše jen čísla, hlášky, popisky tlačítek a náhled
    // Při záznamu se osvěžuje každou sekundu. Kdyby se přestavoval celý obsah,
    // vypadlo by uživateli políčko „hloubka ručně" pokaždé, když do něj píše.
    var _built = '';       // 'list' | 'job'

    function render() {
        var body = document.getElementById('ag-ob-body');
        if (!body) return;
        if (!_job) {
            _built = 'list';
            body.innerHTML = listHtml();
            bindList();
            return;
        }
        _built = 'job';
        body.innerHTML = jobHtml();
        bindJob();
        refresh();
    }
    function listHtml() {
        var h = '<div class="ag-ob-row"><button type="button" id="ag-ob-new" class="prim">Nová obchůzka výkopu</button></div>'
            + '<div class="ag-ob-note">Obejdeš hranu výkopu, zaměříš dno a hned víš objem. Počítá se z GPS telefonu — '
            + 'na hrubou kubaturu a kontrolu faktury to stačí, na přejímku patří rover nebo totálka.</div>';
        var list = all()[pid()];
        if (list.length) {
            h += '<div class="ag-ob-h">Uložené obchůzky</div>';
            list.forEach(function (r) {
                if (!r.bot) r.bot = [];
                var c = compute(r);
                h += '<div class="ag-ob-it" data-id="' + esc(r.id) + '">'
                    + '<div style="flex:1;min-width:0;"><b>' + esc(r.name) + '</b><br>'
                    + esc(fmtDT(r.ts)) + ' · ' + r.top.length + ' bodů hrany'
                    + (c && c.V != null ? ' · ' + fmtNum(c.V, 1) + ' m³' : ' · nedopočítáno')
                    + '</div>'
                    + '<button type="button" class="ag-ob-open">Otevřít</button>'
                    + '<button type="button" class="ag-ob-del">Smazat</button>'
                    + '</div>';
            });
        }
        return h;
    }
    function jobHtml() {
        return '<canvas id="ag-ob-plan"></canvas>'
            + '<div id="ag-ob-volbox"></div>'
            + '<div class="ag-ob-big" id="ag-ob-cells"></div>'
            + '<div id="ag-ob-notes"></div>'
            + '<div class="ag-ob-h" id="ag-ob-htop">Hrana výkopu</div>'
            + '<div class="ag-ob-row">'
            + '<button type="button" id="ag-ob-walk" class="prim">Obejít hranu</button>'
            + '<button type="button" id="ag-ob-manual">Roh ručně</button>'
            + '<button type="button" id="ag-ob-undo">Zpět</button>'
            + '</div>'
            + '<div class="ag-ob-h" id="ag-ob-hbot">Dno</div>'
            + '<div class="ag-ob-row">'
            + '<button type="button" id="ag-ob-walkb">Obejít dno</button>'
            + '<button type="button" id="ag-ob-manualb">Bod dna</button>'
            + '<button type="button" id="ag-ob-undob">Zpět</button>'
            + '</div>'
            + '<div class="ag-ob-row">'
            + '<input type="number" id="ag-ob-depth" placeholder="Hloubka ručně (m)" step="0.01" min="0" value="'
            + (_job.depth != null ? _job.depth : '') + '">'
            + '</div>'
            + '<div class="ag-ob-note">Když se do výkopu nedá vlézt, změř hloubku pásmem nebo latí a zapiš ji sem — '
            + 'ručně zadaná hloubka je <b>přesnější než výška z GPS</b> a použije se přednostně před jedním bodem dna.</div>'
            + '<div class="ag-ob-h">Zakázka</div>'
            + '<div class="ag-ob-row">'
            + '<button type="button" id="ag-ob-topts">Přenést body do zakázky</button>'
            + '<button type="button" id="ag-ob-tin">Do kubatur (TIN)</button>'
            + '</div>'
            + '<div class="ag-ob-row">'
            + '<button type="button" id="ag-ob-csv">Export CSV</button>'
            + '<button type="button" id="ag-ob-back">Zpět na seznam</button>'
            + '</div>';
    }
    function setTxt(id, t) { var e = document.getElementById(id); if (e && e.textContent !== t) e.textContent = t; }
    function refresh() {
        if (_built !== 'job' || !_job) return;
        var c = compute(_job);

        var vol = document.getElementById('ag-ob-volbox');
        if (vol) {
            var vh = (c && c.V != null)
                ? ('<div class="ag-ob-vol"><b>' + fmtNum(c.V, 1) + ' m³</b><small>objem výkopu'
                    + (c.sV != null ? ' · ± ' + fmtNum(c.sV, 1) + ' m³' : '') + '</small></div>')
                : '';
            if (vol.innerHTML !== vh) vol.innerHTML = vh;
        }
        var cells = document.getElementById('ag-ob-cells');
        if (cells) {
            cells.innerHTML = '<div class="ag-ob-cell"><b>' + (c ? fmtNum(c.A1, 1) : '—') + '</b><small>plocha m²</small></div>'
                + '<div class="ag-ob-cell"><b>' + (c ? fmtNum(c.per, 1) : '—') + '</b><small>obvod m</small></div>'
                + '<div class="ag-ob-cell"><b>' + (c && c.h != null ? fmtNum(c.h, 2) : '—') + '</b><small>hloubka m</small></div>';
        }
        var notes = document.getElementById('ag-ob-notes');
        if (notes) {
            var nh = '';
            if (c) {
                if (c.mode === 'frustum') {
                    nh += '<div class="ag-ob-note">Objem počítán jako <b>komolý jehlan</b> mezi hranou (' + fmtNum(c.A1, 1) + ' m²) '
                        + 'a dnem (' + fmtNum(c.A2, 1) + ' m²) — svahované stěny jsou v tom zahrnuté.</div>';
                } else if (c.mode) {
                    nh += '<div class="ag-ob-note warn">Stěny se berou jako <b>svislé</b>, což je <b>horní odhad</b>. '
                        + 'U svahovaného výkopu obejdi i <b>hranu dna</b> (aspoň 3 body) — objem se pak spočítá jako komolý jehlan a bude menší.</div>';
                }
                if (c.topPl && c.topPl.rms != null && c.topPl.rms > 0.25) {
                    nh += '<div class="ag-ob-note warn">Terén kolem výkopu není rovina (odchylky od proložené roviny ± '
                        + fmtNum(c.topPl.rms, 2) + ' m). Objem je pak jen orientační — na zvlněném terénu použij '
                        + '<b>Kubatury / vrstevnice</b> (TIN) z přenesených bodů.</div>';
                }
                if (c.acc != null) {
                    nh += '<div class="ag-ob-note">Přesnost fixů při měření: ± ' + fmtNum(c.acc, 1) + ' m (medián). '
                        + 'Z toho plyne uvedené ± u objemu — největší podíl má vždycky <b>hloubka</b>.</div>';
                }
            } else {
                nh = '<div class="ag-ob-note">Obejdi hranu výkopu — objem se spočítá od <b>tří</b> bodů obvodu.</div>';
            }
            if (notes.innerHTML !== nh) notes.innerHTML = nh;
        }

        setTxt('ag-ob-htop', 'Hrana výkopu (' + _job.top.length + ' bodů)');
        setTxt('ag-ob-hbot', 'Dno (' + _job.bot.length + ' bodů)');
        var w = document.getElementById('ag-ob-walk');
        if (w) { w.className = (_rec === 'top' ? 'rec' : 'prim'); w.textContent = (_rec === 'top' ? 'Obcházím… STOP' : 'Obejít hranu'); }
        var wb = document.getElementById('ag-ob-walkb');
        if (wb) { wb.className = (_rec === 'bot' ? 'rec' : ''); wb.textContent = (_rec === 'bot' ? 'Obcházím dno… STOP' : 'Obejít dno'); }
        setTxt('ag-ob-manual', (_avg && _avgTo === 'top') ? ('Měřím… ' + _avgSamples.length) : 'Roh ručně');
        setTxt('ag-ob-manualb', (_avg && _avgTo === 'bot') ? ('Měřím… ' + _avgSamples.length) : 'Bod dna');
        drawPlan();
    }
    function bindList() {
        var n = document.getElementById('ag-ob-new');
        if (n) n.addEventListener('click', function () { newJob(); persist(); render(); });
        var items = document.querySelectorAll('#ag-ob-body .ag-ob-it');
        for (var i = 0; i < items.length; i++) {
            (function (it) {
                var id = it.getAttribute('data-id');
                it.querySelector('.ag-ob-open').addEventListener('click', function () { loadJob(id); });
                var d = it.querySelector('.ag-ob-del'), armed = null;
                d.addEventListener('click', function () {
                    if (armed) { clearTimeout(armed); delJob(id); return; }
                    d.textContent = 'Opravdu?';
                    armed = setTimeout(function () { armed = null; d.textContent = 'Smazat'; }, 3000);
                });
            })(items[i]);
        }
    }
    function bindJob() {
        function on(id, fn) { var e = document.getElementById(id); if (e) e.addEventListener('click', fn); }
        on('ag-ob-walk', function () { _rec === 'top' ? stopRec() : startRec('top'); });
        on('ag-ob-walkb', function () { _rec === 'bot' ? stopRec() : startRec('bot'); });
        on('ag-ob-manual', function () { addManual('top'); });
        on('ag-ob-manualb', function () { addManual('bot'); });
        on('ag-ob-undo', function () { undo('top'); });
        on('ag-ob-undob', function () { undo('bot'); });
        on('ag-ob-topts', toPoints);
        on('ag-ob-csv', exportCsv);
        on('ag-ob-back', function () { stopRec(); _job = null; render(); });
        on('ag-ob-tin', function () {
            toPoints();
            if (typeof window.openDmtVolume === 'function') { window.openDmtVolume(); }
            else toast('Nástroj Kubatury není k dispozici.');
        });
        var d = document.getElementById('ag-ob-depth');
        if (d) d.addEventListener('change', function () {
            var v = parseFloat(String(this.value).replace(',', '.'));
            _job.depth = (isFinite(v) && v > 0) ? v : null;
            persist(); refresh();
        });
    }

    // ---- modal ------------------------------------------------------------------------------------------
    function open() {
        injectStyles();
        var m = document.getElementById('ag-ob-modal');
        if (!m) {
            m = document.createElement('div');
            m.className = 'modal-overlay';
            m.id = 'ag-ob-modal';
            m.innerHTML =
                '<div class="modal-content">' +
                '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Obchůzka výkopu</h3>' +
                '  <div id="ag-ob-body"></div>' +
                '  <div class="ag-ob-foot">' +
                '    <button type="button" class="btn btn-secondary" id="ag-ob-close">Zavřít</button>' +
                '  </div>' +
                '</div>';
            document.body.appendChild(m);
            m.querySelector('#ag-ob-close').addEventListener('click', function () { m.style.display = 'none'; });
            // Zavření křížkem/gestem nesmí nechat běžet záznam ani wake lock.
            try {
                new MutationObserver(function () {
                    if (m.style.display === 'none' && _rec !== 'off') stopRec();
                }).observe(m, { attributes: true, attributeFilter: ['style'] });
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:open'); }
        }
        m.style.display = 'flex';
        render();
    }

    try { window.addEventListener('pagehide', function () { if (_rec !== 'off') stopRec(); }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'obchuzka:open'); }

    // ---- dlaždice v Nástrojích ---------------------------------------------------------------------------------
    var _tries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'obchuzka', label: 'Obchůzka výkopu', icon: ICON, cat: 'Měření', onClick: open, order: 8 });
            return;
        }
        if (_tries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.AGObchuzka = { open: open, compute: compute };
    window.agOpenObchuzka = open;
})();
