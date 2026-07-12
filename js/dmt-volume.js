// ===== AR Geodet — DMT: KUBATURY A VRSTEVNICE (odpojitelná vrstva) =============
// Digitální model terénu z 3D bodů: Delaunayho trojúhelníková síť (TIN),
// výpočet OBJEMŮ (výkop/násyp vůči vodorovné rovině) a VRSTEVNICE.
// Neinvazivní vrstva ve stylu ostatních modulů — čte globály (proj4, arPoints,
// persistentCustomPoints, getStoredData/setStoredData, quickToast) a vykresluje
// do vlastního <canvas> (nezasahuje do hlavní mapy ani AR).
//
// Vstup výšek: body v zakázce, které mají výšku (z / alt / h / VYSKA_BPV …),
// nebo ruční vložení seznamu „Y X Z" (např. data z totální stanice / RTK).
//
// Spouští se z dlaždice v Nástrojích: window.openDmtVolume().
//
// Odstranění: smaž js/dmt-volume.js + css/dmt-volume.css a jejich řádky v
// index.html a sw.js. Aplikace pak jede přesně jako předtím.
// ================================================================================
(function () {
    'use strict';

    var LS = 'agDmtState';
    var overlay = null, canvas = null, ctx = null;
    var pts = [];                 // {name, ex, ny, z}  (ex = Y/východ, ny = X/sever, lokální metry)
    var origin = { Y: 0, X: 0 };  // odečtený počátek (kvůli numerice i kreslení)
    var tris = [];                // [[i,j,k], …] indexy do pts
    var result = null;            // {area, fill, cut, net, zmin, zmax}
    var contourStep = 1.0;
    var refLevel = null;          // referenční výška roviny (Bpv); null => min
    var view = { scale: 1, ox: 0, oy: 0, ready: false };

    // ---- pomocné: převod WGS84 -> S-JTSK (Y,X kladné) -------------------------
    function toSJTSK(lat, lng) {
        try { var r = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); return { Y: Math.abs(r[0]), X: Math.abs(r[1]) }; }
        catch (e) { return null; }
    }
    function num(v) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }

    // Pokus vytáhnout výšku z bodu (vlastního i úředního).
    function pointHeight(p) {
        if (!p) return null;
        var keys = ['z', 'alt', 'h', 'elev', 'vyska', 'height', 'Z', 'H'];
        for (var i = 0; i < keys.length; i++) { if (p[keys[i]] != null) { var v = num(p[keys[i]]); if (v != null && v > -500 && v < 5000) return v; } }
        if (p.rawData) {
            var rk = ['VYSKA_BPV', 'NADMORSKA_VYSKA', 'VYSKA_BODU', 'VYSKA_H', 'H_BPV', 'VYSKA', 'H', 'Z'];
            for (var j = 0; j < rk.length; j++) {
                for (var k in p.rawData) {
                    if (k.toUpperCase() === rk[j]) {
                        var w = num(p.rawData[k]); if (w != null && w > 50 && w < 3000) return w;
                    }
                }
            }
        }
        return null;
    }

    // ---- sběr 3D bodů ---------------------------------------------------------
    function gatherFromProject() {
        var src = [];
        try { if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) src = src.concat(arPoints); } catch (e) {}
        try { if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) src = src.concat(persistentCustomPoints); } catch (e) {}
        var out = [], seen = {};
        src.forEach(function (p) {
            if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
            var z = pointHeight(p); if (z == null) return;
            var s = toSJTSK(p.lat, p.lng); if (!s) return;
            var key = s.Y.toFixed(2) + '_' + s.X.toFixed(2);
            if (seen[key]) return; seen[key] = 1;
            out.push({ name: p.name || '', Y: s.Y, X: s.X, z: z });
        });
        return out;
    }
    function parsePasted(text) {
        var out = [];
        String(text || '').split(/\r?\n/).forEach(function (line) {
            line = line.trim(); if (!line || line[0] === '#' || line.slice(0, 2) === '//') return;
            var parts = line.split(/[;,\t ]+/).map(function (t) { return t.trim(); }).filter(function (t) { return t !== ''; });
            if (parts.length < 3) return;
            // poslední 3 čísla = Y X Z; cokoli před = jméno
            var nums = parts.map(num);
            // najdi 3 po sobě jdoucí čísla od konce
            if (nums.length >= 3 && nums[nums.length - 1] != null && nums[nums.length - 2] != null && nums[nums.length - 3] != null) {
                var z = nums[nums.length - 1], X = nums[nums.length - 2], Y = nums[nums.length - 3];
                // v ČR je Y < X; když přijde opačně, prohoď
                if (Y > X) { var t = Y; Y = X; X = t; }
                var name = parts.length > 3 ? parts[0] : '';
                if (Y > 400000 && Y < 950000 && X > 900000 && X < 1300000) out.push({ name: name, Y: Y, X: X, z: z });
            }
        });
        return out;
    }

    function setPoints(list) {
        if (!list || !list.length) { quickToastSafe('Žádné body s výškou.'); return false; }
        // počátek = min, pro numeriku
        var minY = Infinity, minX = Infinity;
        list.forEach(function (p) { if (p.Y < minY) minY = p.Y; if (p.X < minX) minX = p.X; });
        origin = { Y: minY, X: minX };
        pts = list.map(function (p) { return { name: p.name, ex: p.Y - minY, ny: p.X - minX, z: p.z, Y: p.Y, X: p.X }; });
        save();
        recompute();
        fitView();
        return true;
    }

    function quickToastSafe(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} try { alert(m); } catch (e) {} }

    // ---- perzistence (per zakázka) -------------------------------------------
    function save() {
        try {
            var data = { pts: pts.map(function (p) { return { name: p.name, Y: p.Y, X: p.X, z: p.z }; }), step: contourStep, ref: refLevel };
            if (typeof setStoredData === 'function') setStoredData(LS, JSON.stringify(data));
            else localStorage.setItem(LS, JSON.stringify(data));
        } catch (e) {}
    }
    function load() {
        try {
            var s = (typeof getStoredData === 'function') ? getStoredData(LS) : localStorage.getItem(LS);
            if (!s) return;
            var d = JSON.parse(s);
            if (d && Array.isArray(d.pts) && d.pts.length) {
                if (typeof d.step === 'number') contourStep = d.step;
                if (typeof d.ref === 'number') refLevel = d.ref;
                setPoints(d.pts);
            }
        } catch (e) {}
    }

    // =====================================================================
    // DELAUNAY (Bowyer–Watson) v rovině (ex, ny)
    // =====================================================================
    function orient(a, b, c) { return (b.ex - a.ex) * (c.ny - a.ny) - (b.ny - a.ny) * (c.ex - a.ex); }
    function inCircumcircle(a, b, c, p) {
        // a,b,c musí být CCW (orient>0)
        var ax = a.ex - p.ex, ay = a.ny - p.ny;
        var bx = b.ex - p.ex, by = b.ny - p.ny;
        var cx = c.ex - p.ex, cy = c.ny - p.ny;
        var det = (ax * ax + ay * ay) * (bx * cy - by * cx)
            - (bx * bx + by * by) * (ax * cy - ay * cx)
            + (cx * cx + cy * cy) * (ax * by - ay * bx);
        // RELATIVNÍ práh: det škáluje ~ (rozsah souřadnic)^4, takže pevné epsilon
        // (1e-9) bylo při rozsahu stovek metrů bezvýznamné a u malých trojúhelníků
        // naopak moc hrubé -> chybná triangulace. Hraniční (kocirkulární) = "není uvnitř".
        var s = Math.max(Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by), Math.abs(cx), Math.abs(cy), 1e-6);
        var eps = 1e-12 * s * s * s * s;
        return det > eps;
    }
    function triangulate(points) {
        var n = points.length;
        if (n < 3) return [];
        var maxc = 0;
        points.forEach(function (p) { maxc = Math.max(maxc, Math.abs(p.ex), Math.abs(p.ny)); });
        var M = (maxc || 1) * 100;
        // super-trojúhelník (indexy n, n+1, n+2)
        var P = points.slice();
        P.push({ ex: -M, ny: -M }); P.push({ ex: M, ny: -M }); P.push({ ex: 0, ny: M });
        var st0 = n, st1 = n + 1, st2 = n + 2;
        function ccw(i, j, k) { if (orient(P[i], P[j], P[k]) < 0) return [i, k, j]; return [i, j, k]; }
        var T = [ccw(st0, st1, st2)];
        for (var ip = 0; ip < n; ip++) {
            var p = P[ip];
            var bad = [];
            for (var t = 0; t < T.length; t++) {
                var tr = T[t];
                if (inCircumcircle(P[tr[0]], P[tr[1]], P[tr[2]], p)) bad.push(t);
            }
            // hraniční hrany díry (hrany jen jednoho bad trojúhelníku)
            var edges = {};
            bad.forEach(function (t) {
                var tr = T[t];
                [[tr[0], tr[1]], [tr[1], tr[2]], [tr[2], tr[0]]].forEach(function (e) {
                    var key = Math.min(e[0], e[1]) + '_' + Math.max(e[0], e[1]);
                    if (edges[key]) edges[key].c++; else edges[key] = { a: e[0], b: e[1], c: 1 };
                });
            });
            // odstraň bad (od konce)
            bad.sort(function (x, y) { return y - x; }).forEach(function (t) { T.splice(t, 1); });
            // znovu trianguluj díru
            for (var key in edges) {
                if (edges[key].c !== 1) continue;
                T.push(ccw(edges[key].a, edges[key].b, ip));
            }
        }
        // vyhoď trojúhelníky se super-vrcholy
        var out = [];
        T.forEach(function (tr) {
            if (tr[0] >= n || tr[1] >= n || tr[2] >= n) return;
            out.push([tr[0], tr[1], tr[2]]);
        });
        return out;
    }

    // =====================================================================
    // VÝPOČET: plocha, objem (výkop/násyp dělením trojúhelníku rovinou H0)
    // =====================================================================
    function triArea2(a, b, c) { return Math.abs((b.ex - a.ex) * (c.ny - a.ny) - (b.ny - a.ny) * (c.ex - a.ex)) / 2; }

    // integrál (z-H0) přes (sub)trojúhelník = plocha * průměr(z-H0)
    function prismVolume(a, b, c, H0) {
        return triArea2(a, b, c) * ((a.z - H0) + (b.z - H0) + (c.z - H0)) / 3;
    }
    function interpAtLevel(A, B, H0) {
        var dz = B.z - A.z;
        if (Math.abs(dz) < 1e-9) return { ex: A.ex, ny: A.ny, z: H0 };  // hrana ve vodorovné rovině → bez dělení nulou
        var t = (H0 - A.z) / dz;
        if (t < 0) t = 0; else if (t > 1) t = 1;                         // clamp kvůli FP u degenerované geometrie
        return { ex: A.ex + t * (B.ex - A.ex), ny: A.ny + t * (B.ny - A.ny), z: H0 };
    }
    // rozdělí trojúhelník rovinou H0 a vrátí {fill, cut} (kladné objemy)
    function triCutFill(a, b, c, H0) {
        var v = [a, b, c];
        var above = [], below = [];
        v.forEach(function (p) { if (p.z >= H0) above.push(p); else below.push(p); });
        if (below.length === 0) { return { fill: prismVolume(a, b, c, H0), cut: 0 }; }
        if (above.length === 0) { return { fill: 0, cut: -prismVolume(a, b, c, H0) }; }
        // straddling — apex je osamocený vrchol
        var apex, base1, base2, apexAbove;
        if (above.length === 1) { apex = above[0]; base1 = below[0]; base2 = below[1]; apexAbove = true; }
        else { apex = below[0]; base1 = above[0]; base2 = above[1]; apexAbove = false; }
        var c1 = interpAtLevel(apex, base1, H0);
        var c2 = interpAtLevel(apex, base2, H0);
        // ROBUSTNÍ ZNAMÉNKO: apex je celý nad/pod H0 (apexAbove), takže jeho strana je
        // jednoznačně násyp/výkop a základna ta opačná. Bereme |objemy| a přiřadíme je
        // podle apexAbove — nespoléháme na znaménko jednotlivých subtrojúhelníků (FP u
        // degenerované geometrie by mohlo objem započítat do špatné kategorie).
        var apexVol = Math.abs(prismVolume(apex, c1, c2, H0));               // apexová část
        var baseVol = Math.abs(prismVolume(base1, base2, c2, H0)) + Math.abs(prismVolume(base1, c2, c1, H0)); // základnová část (quad)
        if (apexAbove) return { fill: apexVol, cut: baseVol };
        return { fill: baseVol, cut: apexVol };
    }

    function recompute() {
        tris = triangulate(pts);
        var zmin = Infinity, zmax = -Infinity;
        pts.forEach(function (p) { if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; });
        var H0 = (refLevel != null) ? refLevel : zmin;
        var area = 0, fill = 0, cut = 0;
        tris.forEach(function (tr) {
            var a = pts[tr[0]], b = pts[tr[1]], cc = pts[tr[2]];
            area += triArea2(a, b, cc);
            var vf = triCutFill(a, b, cc, H0);
            fill += vf.fill; cut += vf.cut;
        });
        result = { area: area, fill: fill, cut: cut, net: fill - cut, zmin: zmin, zmax: zmax, H0: H0 };
        // auto interval, pokud nezadán rozumně
        if (!(contourStep > 0) || contourStep > (zmax - zmin)) {
            var span = Math.max(0.01, zmax - zmin);
            contourStep = niceStep(span / 10);
        }
        renderResults();
        draw();
    }
    function niceStep(x) {
        if (!(x > 0)) return 1;
        var p = Math.pow(10, Math.floor(Math.log(x) / Math.LN10));
        var f = x / p;
        var nf = f < 1.5 ? 1 : (f < 3.5 ? 2 : (f < 7.5 ? 5 : 10));
        return nf * p;
    }

    // =====================================================================
    // VRSTEVNICE: segmenty z TIN
    // =====================================================================
    function contourSegments(level) {
        var segs = [];
        for (var t = 0; t < tris.length; t++) {
            var a = pts[tris[t][0]], b = pts[tris[t][1]], c = pts[tris[t][2]];
            var crossings = [];
            [[a, b], [b, c], [c, a]].forEach(function (e) {
                var z0 = e[0].z, z1 = e[1].z;
                if ((z0 < level && z1 >= level) || (z1 < level && z0 >= level)) {
                    crossings.push(interpAtLevel(e[0], e[1], level));
                }
            });
            if (crossings.length === 2) segs.push([crossings[0], crossings[1]]);
        }
        return segs;
    }

    // =====================================================================
    // VYKRESLENÍ (canvas)
    // =====================================================================
    function colorForZ(z) {
        if (!result || result.zmax <= result.zmin) return '#34d399';
        var t = (z - result.zmin) / (result.zmax - result.zmin);
        t = Math.max(0, Math.min(1, t));
        var h = (1 - t) * 220; // 220 (modrá) -> 0 (červená)
        return 'hsl(' + h.toFixed(0) + ',75%,55%)';
    }
    function worldToPx(ex, ny) { return { x: view.ox + ex * view.scale, y: view.oy - ny * view.scale }; }

    function fitView() {
        if (!canvas || !pts.length) return;
        var W = canvas.width, H = canvas.height, pad = 36;
        var minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
        pts.forEach(function (p) { if (p.ex < minE) minE = p.ex; if (p.ex > maxE) maxE = p.ex; if (p.ny < minN) minN = p.ny; if (p.ny > maxN) maxN = p.ny; });
        var w = Math.max(1, maxE - minE), h = Math.max(1, maxN - minN);
        var s = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
        view.scale = s;
        view.ox = pad - minE * s + ((W - 2 * pad) - w * s) / 2;
        view.oy = H - pad + minN * s - ((H - 2 * pad) - h * s) / 2;
        view.ready = true;
        draw();
    }

    function draw() {
        if (!ctx || !canvas) return;
        var W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0c0f13'; ctx.fillRect(0, 0, W, H);
        if (!pts.length) {
            ctx.fillStyle = '#8b95a1'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Načti body se zařízením výšky nebo vlož seznam Y X Z.', W / 2, H / 2);
            return;
        }
        if (!view.ready) fitView();

        // TIN (slabě)
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        tris.forEach(function (tr) {
            var p0 = worldToPx(pts[tr[0]].ex, pts[tr[0]].ny), p1 = worldToPx(pts[tr[1]].ex, pts[tr[1]].ny), p2 = worldToPx(pts[tr[2]].ex, pts[tr[2]].ny);
            ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.closePath(); ctx.stroke();
        });

        // vrstevnice
        if (result && contourStep > 0) {
            var z0 = Math.ceil(result.zmin / contourStep) * contourStep;
            var nLevels = 0;
            for (var lvl = z0; lvl <= result.zmax && nLevels < 200; lvl += contourStep, nLevels++) {
                var major = (Math.round(lvl / contourStep) % 5 === 0);
                var segs = contourSegments(lvl);
                ctx.strokeStyle = colorForZ(lvl);
                ctx.lineWidth = major ? 2 : 1;
                ctx.beginPath();
                segs.forEach(function (s) {
                    var a = worldToPx(s[0].ex, s[0].ny), b = worldToPx(s[1].ex, s[1].ny);
                    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
                });
                ctx.stroke();
                // popisek major vrstevnice u prvního segmentu
                if (major && segs.length) {
                    var m = worldToPx(segs[0][0].ex, segs[0][0].ny);
                    ctx.fillStyle = colorForZ(lvl); ctx.font = '10px monospace'; ctx.textAlign = 'left';
                    ctx.fillText(lvl.toFixed(2), m.x + 3, m.y - 2);
                }
            }
        }

        // referenční vrstevnice (H0) zvýrazněně
        if (result) {
            var rsegs = contourSegments(result.H0);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
            ctx.beginPath();
            rsegs.forEach(function (s) { var a = worldToPx(s[0].ex, s[0].ny), b = worldToPx(s[1].ex, s[1].ny); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); });
            ctx.stroke(); ctx.setLineDash([]);
        }

        // body + výšky
        ctx.textAlign = 'center';
        pts.forEach(function (p) {
            var q = worldToPx(p.ex, p.ny);
            ctx.fillStyle = colorForZ(p.z);
            ctx.beginPath(); ctx.arc(q.x, q.y, 3.2, 0, 6.283); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.8; ctx.stroke();
            if (view.scale > 0.6) {
                ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '9px monospace';
                ctx.fillText(p.z.toFixed(2), q.x, q.y - 6);
            }
        });

        // měřítko (scale bar)
        drawScaleBar(W, H);
    }
    function drawScaleBar(W, H) {
        if (!view.scale) return;
        var target = 80; // px
        var meters = target / view.scale;
        var nice = niceStep(meters);
        var px = nice * view.scale;
        var x0 = 14, y0 = H - 16;
        ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4); ctx.moveTo(x0 + px, y0 - 4); ctx.lineTo(x0 + px, y0 + 4); ctx.stroke();
        ctx.font = '11px monospace'; ctx.textAlign = 'left';
        ctx.fillText(nice >= 1 ? (nice + ' m') : (nice.toFixed(2) + ' m'), x0, y0 - 7);
    }

    function renderResults() {
        var el = document.getElementById('dmt-results');
        if (!el) return;
        if (!result || !pts.length) { el.innerHTML = '<span class="dmt-muted">Žádná data.</span>'; return; }
        function row(l, v, c) { return '<div class="dmt-rrow"><span>' + l + '</span><b' + (c ? ' style="color:' + c + '"' : '') + '>' + v + '</b></div>'; }
        el.innerHTML =
            row('Bodů / trojúhelníků', pts.length + ' / ' + tris.length) +
            row('Rozsah výšek', result.zmin.toFixed(2) + ' – ' + result.zmax.toFixed(2) + ' m') +
            row('Ref. rovina (H₀)', result.H0.toFixed(2) + ' m Bpv') +
            row('Plocha (2D)', fmtArea(result.area)) +
            row('Násyp (nad H₀)', result.fill.toFixed(1) + ' m³', '#34d399') +
            row('Výkop (pod H₀)', result.cut.toFixed(1) + ' m³', '#f87171') +
            row('Netto (násyp − výkop)', (result.net >= 0 ? '+' : '') + result.net.toFixed(1) + ' m³', result.net >= 0 ? '#34d399' : '#f87171') +
            '<div class="dmt-muted" style="font-size:11px; margin-top:6px; line-height:1.35;">TIN pokrývá KONVEXNÍ obálku bodů — u nekonvexního obvodu (tvar L, koryto) '
            + 'plochu i objem nadhodnotí. Zaměř obvod hustěji, nebo počítej po konvexních částech.</div>';
    }
    function fmtArea(a) {
        if (a >= 10000) return (a / 10000).toFixed(3) + ' ha (' + Math.round(a) + ' m²)';
        return a.toFixed(1) + ' m²';
    }

    // =====================================================================
    // UI
    // =====================================================================
    function build() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'dmt-overlay';
        overlay.className = 'dmt-overlay';
        overlay.innerHTML =
            '<div class="dmt-sheet">' +
            '  <div class="dmt-head">' +
            '    <div class="dmt-title">Kubatury a vrstevnice (DMT)</div>' +
            '    <button class="dmt-x" id="dmt-close" aria-label="Zavřít">✕</button>' +
            '  </div>' +
            '  <div class="dmt-toolbar">' +
            '    <button class="dmt-btn" id="dmt-load">Načíst body ze zakázky</button>' +
            '    <button class="dmt-btn" id="dmt-paste">Vložit Y X Z…</button>' +
            '    <label class="dmt-fld">Ref. H₀ <input type="number" step="0.1" id="dmt-ref" placeholder="min"></label>' +
            '    <label class="dmt-fld">Interval <input type="number" step="0.1" min="0.01" id="dmt-step"> m</label>' +
            '    <button class="dmt-btn dmt-btn-acc" id="dmt-recalc">Přepočítat</button>' +
            '    <button class="dmt-btn" id="dmt-fit">Vystředit</button>' +
            '  </div>' +
            '  <div class="dmt-canvas-wrap"><canvas id="dmt-canvas"></canvas></div>' +
            '  <div class="dmt-results" id="dmt-results"></div>' +
            '  <div class="dmt-foot">' +
            '    <button class="dmt-btn" id="dmt-png">Export PNG</button>' +
            '    <button class="dmt-btn" id="dmt-clear">Vymazat body</button>' +
            '    <button class="dmt-btn dmt-btn-sec" id="dmt-close2">Zavřít</button>' +
            '  </div>' +
            '  <div class="dmt-paste-modal" id="dmt-paste-modal">' +
            '    <div class="dmt-paste-box">' +
            '      <div class="dmt-paste-h">Vlož seznam bodů — řádky <code>[číslo] Y X Z</code></div>' +
            '      <textarea id="dmt-paste-ta" placeholder="101 546123.45 1045789.23 312.40\n102 546140.10 1045792.00 311.85"></textarea>' +
            '      <div class="dmt-paste-btns"><button class="dmt-btn dmt-btn-sec" id="dmt-paste-cancel">Zrušit</button><button class="dmt-btn dmt-btn-acc" id="dmt-paste-ok">Načíst</button></div>' +
            '    </div>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(overlay);
        canvas = overlay.querySelector('#dmt-canvas');
        ctx = canvas.getContext('2d');
        wire();
        return overlay;
    }

    function resizeCanvas() {
        if (!canvas) return;
        var wrap = canvas.parentElement; if (!wrap) return;
        var r = wrap.getBoundingClientRect();
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(50, Math.floor(r.width * dpr));
        canvas.height = Math.max(50, Math.floor(r.height * dpr));
        canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
        view.ready = false;
    }

    function wire() {
        function close() { overlay.classList.remove('open'); }
        overlay.querySelector('#dmt-close').addEventListener('click', close);
        overlay.querySelector('#dmt-close2').addEventListener('click', close);
        overlay.querySelector('#dmt-load').addEventListener('click', function () {
            var list = gatherFromProject();
            if (!list.length) { quickToastSafe('V zakázce nejsou body s výškou. Vlož seznam Y X Z.'); return; }
            if (setPoints(list)) quickToastSafe('Načteno bodů: ' + list.length);
        });
        overlay.querySelector('#dmt-paste').addEventListener('click', function () {
            overlay.querySelector('#dmt-paste-modal').classList.add('show');
            overlay.querySelector('#dmt-paste-ta').focus();
        });
        overlay.querySelector('#dmt-paste-cancel').addEventListener('click', function () { overlay.querySelector('#dmt-paste-modal').classList.remove('show'); });
        overlay.querySelector('#dmt-paste-ok').addEventListener('click', function () {
            var list = parsePasted(overlay.querySelector('#dmt-paste-ta').value);
            overlay.querySelector('#dmt-paste-modal').classList.remove('show');
            if (!list.length) { quickToastSafe('Nerozpoznal jsem žádný platný řádek Y X Z.'); return; }
            if (setPoints(list)) quickToastSafe('Načteno bodů: ' + list.length);
        });
        overlay.querySelector('#dmt-recalc').addEventListener('click', function () {
            var rv = num(overlay.querySelector('#dmt-ref').value);
            refLevel = (rv != null) ? rv : null;
            var sv = num(overlay.querySelector('#dmt-step').value);
            if (sv != null && sv > 0) contourStep = sv;
            save(); recompute();
        });
        overlay.querySelector('#dmt-fit').addEventListener('click', fitView);
        overlay.querySelector('#dmt-png').addEventListener('click', exportPNG);
        overlay.querySelector('#dmt-clear').addEventListener('click', function () {
            if (!confirm('Vymazat všechny body z DMT?')) return;
            pts = []; tris = []; result = null; save(); renderResults(); draw();
        });

        // pan & zoom
        var dragging = false, lastX = 0, lastY = 0, pinch = null;
        canvas.addEventListener('pointerdown', function (e) {
            canvas.setPointerCapture(e.pointerId);
            if (!pinch) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
        });
        canvas.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            var dpr = Math.min(2, window.devicePixelRatio || 1);
            view.ox += (e.clientX - lastX) * dpr; view.oy += (e.clientY - lastY) * dpr;
            lastX = e.clientX; lastY = e.clientY; draw();
        });
        function endDrag(e) { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch (er) {} }
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            var dpr = Math.min(2, window.devicePixelRatio || 1);
            var rect = canvas.getBoundingClientRect();
            var cx = (e.clientX - rect.left) * dpr, cy = (e.clientY - rect.top) * dpr;
            var f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            zoomAt(cx, cy, f);
        }, { passive: false });
        // pinch (dvouprstý)
        var pts2 = {};
        canvas.addEventListener('pointerdown', function (e) { pts2[e.pointerId] = e; if (Object.keys(pts2).length === 2) dragging = false; });
        canvas.addEventListener('pointermove', function (e) {
            if (!(e.pointerId in pts2)) return; pts2[e.pointerId] = e;
            var ids = Object.keys(pts2);
            if (ids.length === 2) {
                var a = pts2[ids[0]], b = pts2[ids[1]];
                var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                if (pinch != null) {
                    var dpr = Math.min(2, window.devicePixelRatio || 1);
                    var rect = canvas.getBoundingClientRect();
                    var cx = ((a.clientX + b.clientX) / 2 - rect.left) * dpr, cy = ((a.clientY + b.clientY) / 2 - rect.top) * dpr;
                    zoomAt(cx, cy, d / pinch);
                }
                pinch = d;
            }
        });
        function clearPt(e) { delete pts2[e.pointerId]; if (Object.keys(pts2).length < 2) pinch = null; }
        canvas.addEventListener('pointerup', clearPt);
        canvas.addEventListener('pointercancel', clearPt);

        window.addEventListener('resize', function () { if (overlay.classList.contains('open')) { resizeCanvas(); fitView(); } });
    }
    function zoomAt(cx, cy, f) {
        // zachovej bod pod kurzorem
        var wx = (cx - view.ox) / view.scale, wy = (view.oy - cy) / view.scale;
        view.scale *= f;
        view.ox = cx - wx * view.scale; view.oy = cy + wy * view.scale;
        draw();
    }

    function exportPNG() {
        if (!pts.length) { quickToastSafe('Není co exportovat.'); return; }
        try {
            // bílé pozadí pro tisk
            var out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
            var octx = out.getContext('2d');
            octx.fillStyle = '#ffffff'; octx.fillRect(0, 0, out.width, out.height);
            octx.drawImage(canvas, 0, 0);
            var url = out.toDataURL('image/png');
            var a = document.createElement('a');
            var proj = '';
            try { proj = (typeof activeProjectId !== 'undefined') ? ('_' + activeProjectId) : ''; } catch (e) {}
            a.href = url; a.download = 'dmt' + proj + '.png'; document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { quickToastSafe('Export selhal.'); }
    }

    // veřejné API (volá dlaždice v Nástrojích)
    window.openDmtVolume = function () {
        build();
        overlay.classList.add('open');
        setTimeout(function () {
            resizeCanvas();
            if (!pts.length) load();   // zkus poslední uložený stav
            // sync polí
            var rf = overlay.querySelector('#dmt-ref'); if (rf) rf.value = (refLevel != null ? refLevel : '');
            var sp = overlay.querySelector('#dmt-step'); if (sp) sp.value = (contourStep || '');
            if (pts.length) { recompute(); fitView(); } else draw();
        }, 60);
    };
})();
