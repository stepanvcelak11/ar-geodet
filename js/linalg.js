// ===== AR Geodet — LINEÁRNÍ ALGEBRA (robustní řešiče pro geodetické výpočty) ===
// Neinvazivní knihovna ČISTÝCH funkcí. NEEDITUJE žádný existující soubor a nic
// nevykresluje — jen vystaví window.LinAlg. Cílem je nahradit ručně psané, méně
// stabilní řešiče roztroušené po appce:
//   • js/ar-resection.js  — solve3() (3×3 Gauss) + inv3() (3×3 kofaktory) +
//                            ruční Gauss-Newton smyčka resekce  → LinAlg.solve /
//                            invert / gaussNewton
//   • js/ar-intersection.js — ruční 2×2 protnutí paprsků (determinant)  → LinAlg.solve
//   • js/satelity.js      — computePDOP(): inline 4×4 Gauss-Jordan inverze  → LinAlg.invert
//   • js/dmt-volume.js    — (zatím bez maticového řešiče; využije až přibude vyrovnání)
// Tyto moduly se ZÁMĚRNĚ nepřepisují — tato vrstva jen poskytuje společný, číselně
// stabilnější základ (částečné pivotování, kontrola podmíněnosti, konvergence GN),
// na který je lze postupně převést.
//
// Použití:
//   var x = LinAlg.solve([[2,1],[1,3]], [3,5]);     // -> [0.8, 1.4]
//   var Ai = LinAlg.invert([[4,7],[2,6]]);          // -> [[0.6,-0.7],[-0.2,0.4]]
//   var x = LinAlg.lstsq(A, b);                       // přeurčená soustava (MNČ)
//   // obecná nelineární MNČ (resekce/protínání):
//   var fit = LinAlg.gaussNewton(residualFn, jacobianFn, x0, { maxIter: 25 });
//   // fit = { x:[...], iters, converged:true, rmse: 0.0021 }
//
// Self-testy (NESPOUŠTĚNÉ — jen pro orientaci, kontrolovat ručně):
//   console.assert(Math.abs(LinAlg.det([[1,2],[3,4]]) + 2) < 1e-12, 'det 2x2');
//   console.assert(LinAlg.solve([[1,0],[0,1]], [5,7]).join() === '5,7', 'I*x=b');
//   console.assert(LinAlg.solve([[1,1],[1,1]], [2,2]) === null, 'singularni -> null');
//
// Odstranění: smaž js/linalg.js + jeho <script> v index.html a řádek v sw.js.
// (Dokud na něj žádný modul nepřejde, jeho odebrání nic nerozbije.)
// ================================================================================
(function () {
    'use strict';

    // ---- pomocné: kopie / tvar ------------------------------------------------
    function cloneMat(A) {
        var m = A.length, out = new Array(m);
        for (var i = 0; i < m; i++) { var r = A[i], n = r.length, rr = new Array(n); for (var j = 0; j < n; j++) rr[j] = r[j]; out[i] = rr; }
        return out;
    }
    function isFiniteNum(x) { return typeof x === 'number' && isFinite(x); }
    // hrubá norma matice (max |a_ij|) pro relativní práh pivotu
    function maxAbs(A) {
        var m = 0;
        for (var i = 0; i < A.length; i++) for (var j = 0; j < A[i].length; j++) { var v = Math.abs(A[i][j]); if (v > m) m = v; }
        return m;
    }

    // ---- transpozice ----------------------------------------------------------
    function transpose(A) {
        if (!A || !A.length) return [];
        var m = A.length, n = A[0].length, out = new Array(n);
        for (var j = 0; j < n; j++) { var col = new Array(m); for (var i = 0; i < m; i++) col[i] = A[i][j]; out[j] = col; }
        return out;
    }

    // ---- součin matic A(m×k) · B(k×n) -> (m×n) --------------------------------
    function matMul(A, B) {
        var m = A.length, k = A[0].length, n = B[0].length;
        if (B.length !== k) return null;
        var out = new Array(m);
        for (var i = 0; i < m; i++) {
            var rowA = A[i], rowO = new Array(n);
            for (var j = 0; j < n; j++) {
                var s = 0;
                for (var t = 0; t < k; t++) s += rowA[t] * B[t][j];
                rowO[j] = s;
            }
            out[i] = rowO;
        }
        return out;
    }

    // ---- součin matice A(m×n) · vektor v(n) -> (m) ----------------------------
    function matVec(A, v) {
        var m = A.length, out = new Array(m);
        for (var i = 0; i < m; i++) {
            var row = A[i], n = row.length, s = 0;
            for (var j = 0; j < n; j++) s += row[j] * v[j];
            out[i] = s;
        }
        return out;
    }

    // ---- determinant (LU s částečným pivotováním) -----------------------------
    function det(A) {
        var n = A.length;
        if (!n || A[0].length !== n) return NaN;
        var M = cloneMat(A), sign = 1, d = 1;
        for (var c = 0; c < n; c++) {
            var piv = c, best = Math.abs(M[c][c]);
            for (var r = c + 1; r < n; r++) { var v = Math.abs(M[r][c]); if (v > best) { best = v; piv = r; } }
            if (best === 0) return 0;
            if (piv !== c) { var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp; sign = -sign; }
            var p = M[c][c]; d *= p;
            for (var rr = c + 1; rr < n; rr++) {
                var f = M[rr][c] / p;
                if (f === 0) continue;
                for (var cc = c; cc < n; cc++) M[rr][cc] -= f * M[c][cc];
            }
        }
        return sign * d;
    }

    // ---- solve(A,b): Gaussova eliminace s ČÁSTEČNÝM pivotováním ----------------
    // Vrací x (délka n) nebo null, když je soustava singulární / velmi špatně
    // podmíněná (relativní velikost pivotu pod prahem vůči normě matice).
    function solve(A, b) {
        var n = A.length;
        if (!n || !A[0] || A[0].length !== n || !b || b.length !== n) return null;
        var scale = maxAbs(A);
        if (scale === 0 || !isFinite(scale)) return null;
        var eps = 1e-12 * scale;          // relativní práh pivotu
        // rozšířená matice [A | b]
        var M = new Array(n);
        for (var i = 0; i < n; i++) {
            var row = new Array(n + 1);
            for (var j = 0; j < n; j++) row[j] = A[i][j];
            row[n] = b[i];
            M[i] = row;
        }
        // dopředná eliminace
        for (var c = 0; c < n; c++) {
            var piv = c, best = Math.abs(M[c][c]);
            for (var r = c + 1; r < n; r++) { var v = Math.abs(M[r][c]); if (v > best) { best = v; piv = r; } }
            if (best <= eps) return null;  // singulární / špatně podmíněné
            if (piv !== c) { var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp; }
            var p = M[c][c];
            for (var r2 = c + 1; r2 < n; r2++) {
                var f = M[r2][c] / p;
                if (f === 0) continue;
                M[r2][c] = 0;
                for (var cc = c + 1; cc <= n; cc++) M[r2][cc] -= f * M[c][cc];
            }
        }
        // zpětná substituce
        var x = new Array(n);
        for (var k = n - 1; k >= 0; k--) {
            var s = M[k][n];
            for (var jj = k + 1; jj < n; jj++) s -= M[k][jj] * x[jj];
            var dk = M[k][k];
            if (Math.abs(dk) <= eps) return null;
            x[k] = s / dk;
            if (!isFiniteNum(x[k])) return null;
        }
        return x;
    }

    // ---- invert(A): inverze přes Gauss-Jordan s částečným pivotováním ---------
    // Vrací matici n×n nebo null (singulární / špatně podmíněná).
    function invert(A) {
        var n = A.length;
        if (!n || !A[0] || A[0].length !== n) return null;
        var scale = maxAbs(A);
        if (scale === 0 || !isFinite(scale)) return null;
        var eps = 1e-12 * scale;
        // rozšířená matice [A | I]
        var M = new Array(n);
        for (var i = 0; i < n; i++) {
            var row = new Array(2 * n);
            for (var j = 0; j < n; j++) { row[j] = A[i][j]; row[n + j] = (i === j) ? 1 : 0; }
            M[i] = row;
        }
        for (var c = 0; c < n; c++) {
            var piv = c, best = Math.abs(M[c][c]);
            for (var r = c + 1; r < n; r++) { var v = Math.abs(M[r][c]); if (v > best) { best = v; piv = r; } }
            if (best <= eps) return null;
            if (piv !== c) { var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp; }
            var d = M[c][c];
            for (var j2 = 0; j2 < 2 * n; j2++) M[c][j2] /= d;
            for (var r2 = 0; r2 < n; r2++) {
                if (r2 === c) continue;
                var f = M[r2][c];
                if (f === 0) continue;
                for (var j3 = 0; j3 < 2 * n; j3++) M[r2][j3] -= f * M[c][j3];
            }
        }
        var inv = new Array(n);
        for (var k = 0; k < n; k++) {
            var rr = new Array(n);
            for (var t = 0; t < n; t++) { var val = M[k][n + t]; if (!isFiniteNum(val)) return null; rr[t] = val; }
            inv[k] = rr;
        }
        return inv;
    }

    // ---- lstsq(A,b): nejmenší čtverce (přeurčená soustava A·x ≈ b) ------------
    // Řeší normální rovnice (AᵀA)·x = Aᵀb přes solve() (s pivotováním). Vrací x
    // nebo null. Pozn.: normální rovnice umocňují podmíněnost — pro běžné
    // geodetické úlohy (dobře škálované) je to dostatečné a rychlé; pokud A není
    // přeurčená (m == n), spočítá přímo solve(A,b).
    function lstsq(A, b) {
        var m = A.length;
        if (!m || !A[0] || !b || b.length !== m) return null;
        var n = A[0].length;
        if (m === n) { var direct = solve(A, b); if (direct) return direct; }   // čtvercová: zkus přímo
        if (m < n) return null;            // podurčená — bez regularizace neřešíme
        var At = transpose(A);             // n×m
        var AtA = matMul(At, A);           // n×n
        var Atb = matVec(At, b);           // n
        if (!AtA || !Atb) return null;
        return solve(AtA, Atb);
    }

    // ---- gaussNewton: obecný robustní řešitel nelineárních MNČ -----------------
    // residualFn(x) -> pole reziduí r (délka m)
    // jacobianFn(x) -> Jacobiho matice m×n (∂r_i/∂x_j)
    // x0           -> počáteční odhad (pole délky n)
    // opts: { maxIter=30, tol=1e-9 (norma kroku), tolGrad=1e-12, damping=0 (Levenberg
    //         tlumení λ přičtené na diagonálu JᵀJ — stabilizace u singulárních kroků) }
    // Vrací { x, iters, converged, rmse } i při nekonvergenci (converged:false) — volající
    // se rozhodne podle rmse/converged. Při fatální chybě (singulární krok hned na startu)
    // vrátí converged:false s počátečním x.
    function gaussNewton(residualFn, jacobianFn, x0, opts) {
        opts = opts || {};
        var maxIter = opts.maxIter != null ? opts.maxIter : 30;
        var tol = opts.tol != null ? opts.tol : 1e-9;
        var tolGrad = opts.tolGrad != null ? opts.tolGrad : 1e-12;
        var lambda = opts.damping != null ? opts.damping : 0;
        var x = x0.slice();
        var n = x.length;
        var iters = 0, converged = false, rmse = NaN;

        function computeRmse(r) {
            if (!r || !r.length) return NaN;
            var s = 0; for (var i = 0; i < r.length; i++) s += r[i] * r[i];
            return Math.sqrt(s / r.length);
        }

        for (iters = 0; iters < maxIter; iters++) {
            var r, J;
            try { r = residualFn(x); J = jacobianFn(x); }
            catch (e) { break; }
            if (!r || !J || !J.length || J[0].length !== n) break;

            rmse = computeRmse(r);

            // normální rovnice: (JᵀJ)·dx = −Jᵀr
            var Jt = transpose(J);          // n×m
            var JtJ = matMul(Jt, J);        // n×n
            var Jtr = matVec(Jt, r);        // n
            if (!JtJ || !Jtr) break;

            // gradient = Jᵀr ; konec, když je nulový (lokální minimum)
            var gnorm = 0; for (var g = 0; g < n; g++) gnorm += Jtr[g] * Jtr[g];
            gnorm = Math.sqrt(gnorm);
            if (gnorm < tolGrad) { converged = true; break; }

            // volitelné Levenberg tlumení (stabilizace špatně podmíněného kroku)
            if (lambda > 0) for (var d = 0; d < n; d++) JtJ[d][d] += lambda * JtJ[d][d];

            var neg = new Array(n); for (var k = 0; k < n; k++) neg[k] = -Jtr[k];
            var dx = solve(JtJ, neg);
            if (!dx) break;                 // singulární krok — vrátíme dosavadní x

            var step = 0;
            for (var i2 = 0; i2 < n; i2++) { x[i2] += dx[i2]; step += dx[i2] * dx[i2]; }
            step = Math.sqrt(step);

            // přepočti rmse po kroku (aby výsledné rmse odpovídalo finálnímu x)
            try { var rNew = residualFn(x); rmse = computeRmse(rNew); } catch (e2) {}

            if (step < tol) { converged = true; iters++; break; }
        }

        return { x: x, iters: iters, converged: converged, rmse: rmse };
    }

    // ---- export --------------------------------------------------------------
    var LinAlg = {
        solve: solve,
        invert: invert,
        lstsq: lstsq,
        det: det,
        transpose: transpose,
        matMul: matMul,
        matVec: matVec,
        gaussNewton: gaussNewton
    };

    try { window.LinAlg = LinAlg; } catch (e) {}
    try { if (typeof module !== 'undefined' && module.exports) module.exports = LinAlg; } catch (e) {}
})();
