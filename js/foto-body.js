/* BODY Z FOTKY — víc bodů z jedné fotky, výběr z galerie, lepší OCR (23. 9. 2026, n8)
 *
 * Na přání: „Když chci zapsat bod z fotky, zapíše mi to jen jeden bod, i když je jich na fotce
 * víc. Přidat možnost vybrat fotku z galerie, na které jsou body. Vylepšit OCR, protože to
 * zatím přepisuje špatně.“
 *
 * Co bylo špatně (logika.js ocrFromPhoto, zůstává jako záloha):
 *  - <input capture="environment"> → iPhone otevřel rovnou fotoaparát, galerii nenabídl;
 *  - z celého textu se bral JEN první Y a první X (parseOcrCoords) → jeden bod;
 *  - whitelist jen číslic a Y/X/Z nutil Tesseract každé písmeno „přečíst“ jako číslici a
 *    globální práh (průměr jasu) nezvládl stín přes půl papíru.
 *
 * Teď:
 *  1) volba Vyfotit / Z galerie (i víc fotek naráz);
 *  2) dva průchody OCR (šedotón s roztaženým kontrastem + místní práh Bradley), malé písmo se
 *     zvětší, tmavé pozadí se převrátí; vítězí průchod s víc platnými řádky, rozdíly mezi
 *     průchody se u bodu označí „nejisté“;
 *  3) každý řádek = jeden bod (číslo, Y, X, volitelně Z); opravy záměn O→0, l→1, S→5, B→8,
 *     slepení „596 956,46“, doplnění ztracené desetinné tečky, kontrola rozsahu S-JTSK
 *     a vzdálenosti od mé polohy;
 *  4) přehled: fotka se zvýrazněným řádkem, hodnoty jdou opravit, uložit vše najednou
 *     (window.addImportedPoints, původ 'foto-ocr'). Jeden bod z fotky v okně Nový bod jen
 *     předvyplní formulář jako dřív.
 *
 * Odpojitelné: smaž tento soubor + řádek ag/lazy v index.html; dlaždice „Z fotky“ pak spadne
 * na původní <input id="ocr-file">.
 */
(function () {
    'use strict';
    var swallow = function (e, w) { try { window.AG && AG.swallow && AG.swallow(e, 'foto-body:' + w); } catch (x) { /* nic */ } };
    var t = function (s) { try { return window.AGJazyk && AGJazyk.t ? AGJazyk.t(s) : s; } catch (e) { return s; } };
    var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

    // ---------------------------------------------------------------- rozsahy S-JTSK (ČR)
    var inY = function (v) { return v >= 400000 && v <= 910000; };
    var inX = function (v) { return v >= 930000 && v <= 1230000; };
    var inZ = function (v) { return v >= 100 && v <= 1700; };

    // ---------------------------------------------------------------- 1) text → řádky bodů
    // Záměny písmen za číslice UVNITŘ čísel (token, který je z větší části číslice).
    var ZAMENY = { O: '0', o: '0', Q: '0', D: '0', U: '0', I: '1', l: '1', i: '1', '|': '1', '!': '1', j: '1', S: '5', s: '5', B: '8', G: '6', b: '6', g: '9', q: '9', T: '7', Z: '2', z: '2' };
    function opravToken(tok) {
        var cis = (tok.match(/\d/g) || []).length;
        // jen dlouhá čísla (souřadnice, výšky s desetinami): čísla bodů typu „3B“, „12A“ se NEpřepisují
        if (cis < 5 || cis < tok.replace(/[.,]/g, '').length * 0.7) return tok;
        var out = '';
        for (var i = 0; i < tok.length; i++) { var c = tok[i]; out += (/[\d.,]/.test(c) ? c : (ZAMENY[c] != null ? ZAMENY[c] : c)); }
        return out;
    }
    function cislo(tok) {
        var s = String(tok).replace(/,/g, '.');
        if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return NaN;
        return parseFloat(s);
    }
    // Hodnota souřadnice z tokenu: i se ZTRACENOU desetinnou tečkou („59695646“ → 596956.46).
    function souradnice(tok) {
        var v = cislo(tok);
        if (!isFinite(v)) return null;
        if (inY(v)) return { k: 'Y', v: v };
        if (inX(v)) return { k: 'X', v: v };
        if (/^\d+$/.test(tok)) {
            for (var d = 1; d <= 3; d++) {
                var w = v / Math.pow(10, d);
                if (inY(w) && tok.length - d === 6) return { k: 'Y', v: w, opraveno: 'tečka' };
                if (inX(w) && (tok.length - d === 6 || tok.length - d === 7)) return { k: 'X', v: w, opraveno: 'tečka' };
            }
        }
        return null;
    }
    function tokeny(radek) {
        var s = String(radek || '')
            .replace(/[—–]/g, '-')
            .replace(/[“”"'`´]/g, ' ')
            .replace(/(\d)\s*[,.]\s+(\d{2,3})(?!\d)/g, '$1.$2');       // „596956, 46“ → 596956.46
        var raw = s.split(/[\s;|\t]+/).filter(Boolean);
        var out = [];
        raw.forEach(function (r) {
            // „Y:596956.46“ / „X=1059409.97“ → štítek + hodnota
            if (/^[YXZyxz][:=]?$/.test(r)) { out.push(r[0].toUpperCase() + ':'); return; }   // „Z:“ zvlášť, hodnota v dalším tokenu
            var m = r.match(/^([YXZyxz])[:=]?(.*)$/);
            if (m && m[2] && /\d/.test(m[2])) { out.push(m[1].toUpperCase() + ':'); r = m[2]; }
            r = r.replace(/^[:=]+|[:=]+$/g, '');
            if (!r) return;
            out.push(opravToken(r));
        });
        // TISÍCE S MEZEROU („743 215,42“, „1 042 118,37“): slepit sousední skupiny číslic, jen když
        // spojení padne do rozsahu Y nebo X — číslo bodu před nimi („12 743 215,42“) zůstane zvlášť.
        for (var a = 0; a < out.length; a++) {
            for (var kk = Math.min(out.length - 1, a + 3); kk > a; kk--) {
                var cast = out.slice(a, kk + 1), dobre = /^\d{1,4}$/.test(cast[0]);   // i „1042 071,55“ (OCR slepí „1 042“)
                for (var q = 1; q < cast.length && dobre; q++) dobre = (q === cast.length - 1) ? /^\d{3}([.,]\d+)?$/.test(cast[q]) : /^\d{3}$/.test(cast[q]);
                if (!dobre) continue;
                var sp = cast.join(''), vv = cislo(sp);
                if (isFinite(vv) && (inY(vv) || inX(vv))) { out.splice(a, cast.length, sp); break; }
            }
        }
        // „596956 46“ (mezera místo tečky) → 596956.46
        for (var i = 0; i < out.length - 1; i++) {
            if (/^\d{6,7}$/.test(out[i]) && /^\d{2}$/.test(out[i + 1]) && (inY(+out[i]) || inX(+out[i]))) { out[i] = out[i] + '.' + out[i + 1]; out.splice(i + 1, 1); }
        }
        return out;
    }
    // Jeden řádek textu → {name, y, x, z, opravy[]} nebo částečný nález (jen Y / jen X).
    function radekNaBod(radek) {
        var tk = tokeny(radek), b = { name: null, y: null, x: null, z: null, opravy: [] }, stitek = null;
        for (var i = 0; i < tk.length; i++) {
            var tok = tk[i];
            if (/^[YXZ]:$/.test(tok)) { stitek = tok[0]; continue; }
            var s = souradnice(tok);
            if (s && ((s.k === 'Y' && b.y === null) || (s.k === 'X' && b.x === null))) {
                if (s.k === 'Y') b.y = s.v; else b.x = s.v;
                if (s.opraveno) b.opravy.push(s.k + ': ' + t('doplněná desetinná tečka'));
                stitek = null; continue;
            }
            var v = cislo(tok);
            if (isFinite(v) && inZ(v) && b.z === null && (stitek === 'Z' || (/[.,]\d/.test(tok) && (b.y !== null || b.x !== null)))) { b.z = v; stitek = null; continue; }
            // číslo/název bodu: první token před souřadnicemi, co není souřadnice ani výška
            if (b.name === null && b.y === null && b.x === null && /^[A-Za-z0-9ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž][\w.\-/ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž]{0,24}$/.test(tok) && !/^(č|c|bod|cislo|číslo|y|x|z|m)\.?$/i.test(tok)) {
                b.name = tok.replace(/[.,]+$/, '');
            }
            stitek = null;
        }
        return b;
    }
    // Celý text (+ volitelně řádky s obdélníky) → seznam bodů.
    // Štítkový formát přes víc řádků („Bod 4002 / Y: … / X: …“) se skládá postupně.
    function textNaBody(text, lines) {
        var src = (lines && lines.length) ? lines : String(text || '').split(/\r?\n/).map(function (s) { return { text: s }; });
        var body = [], rozpr = null, posl = null;
        src.forEach(function (ln) {
            var b = radekNaBod(ln.text);
            if (b.y !== null && b.x !== null) {
                if (b.name === null && rozpr && rozpr.name && rozpr.y === null && rozpr.x === null) b.name = rozpr.name;
                else if (rozpr && (rozpr.y !== null || rozpr.x !== null)) { rozpr.neuplny = true; body.push(rozpr); }   // řádek jen s Y nebo X → k doplnění
                b.bbox = ln.bbox || null; b.conf = ln.confidence != null ? ln.confidence : null; b.text = String(ln.text || '').trim();
                body.push(b); rozpr = null; posl = null; return;
            }
            // štítek: „Z: 244,87“ až za řádkem X → patří k právě složenému bodu
            if (b.z !== null && b.y === null && b.x === null && b.name === null && !rozpr && posl && posl.z === null) { posl.z = b.z; return; }
            if (b.y !== null || b.x !== null || b.name !== null || b.z !== null) {
                if (!rozpr) rozpr = { name: null, y: null, x: null, z: null, opravy: [], bbox: null, text: '' };
                if (b.name !== null && rozpr.name === null && b.y === null && b.x === null) rozpr.name = b.name;
                if (b.y !== null && rozpr.y === null) rozpr.y = b.y;
                if (b.x !== null && rozpr.x === null) rozpr.x = b.x;
                if (b.z !== null && rozpr.z === null) rozpr.z = b.z;
                rozpr.opravy = rozpr.opravy.concat(b.opravy);
                rozpr.text += (rozpr.text ? ' / ' : '') + String(ln.text || '').trim();
                if (ln.bbox) rozpr.bbox = rozpr.bbox ? { x0: Math.min(rozpr.bbox.x0, ln.bbox.x0), y0: Math.min(rozpr.bbox.y0, ln.bbox.y0), x1: Math.max(rozpr.bbox.x1, ln.bbox.x1), y1: Math.max(rozpr.bbox.y1, ln.bbox.y1) } : ln.bbox;
                if (rozpr.y !== null && rozpr.x !== null) { body.push(rozpr); posl = rozpr; rozpr = null; }
            }
        });
        if (rozpr && (rozpr.y !== null || rozpr.x !== null)) { rozpr.neuplny = true; body.push(rozpr); }
        return body;
    }

    // ---------------------------------------------------------------- 2) příprava obrázku
    function nactiObrazek(file) {
        return new Promise(function (res, rej) {
            var im = new Image();
            im.onload = function () { res(im); };
            im.onerror = function () { rej(new Error(t('Fotku se nepodařilo načíst.'))); };
            im.src = URL.createObjectURL(file);
        });
    }
    // Odhad POZADÍ papíru (stín, přechod světla): zmenšit 8×, dvakrát maximum 3×3 (tmavé tenké
    // písmo zmizí, zůstane papír), rozmazat a zvětšit zpět. Jas / pozadí = papír všude stejně bílý.
    function pozadi(g, w, h) {
        var sw = Math.max(4, Math.round(w / 8)), sh = Math.max(4, Math.round(h / 8)), m = new Float32Array(sw * sh), cnt = new Uint16Array(sw * sh);
        for (var y = 0; y < h; y++) { var yy = Math.min(sh - 1, (y * sh / h) | 0); for (var x = 0; x < w; x++) { var q = yy * sw + Math.min(sw - 1, (x * sw / w) | 0); m[q] += g[y * w + x]; cnt[q]++; } }
        for (var i = 0; i < m.length; i++) m[i] = cnt[i] ? m[i] / cnt[i] : 255;
        for (var it = 0; it < 3; it++) {
            var o = new Float32Array(m.length);
            for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) { var mx = 0; for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var yy2 = y + dy, xx2 = x + dx; if (yy2 >= 0 && yy2 < sh && xx2 >= 0 && xx2 < sw && m[yy2 * sw + xx2] > mx) mx = m[yy2 * sw + xx2]; } o[y * sw + x] = mx; }
            m = o;
        }
        var bg = new Float32Array(w * h);
        for (y = 0; y < h; y++) {
            var fy = Math.max(0, Math.min(sh - 1.001, y * sh / h - 0.5)), y0 = fy | 0, ty = fy - y0;
            for (x = 0; x < w; x++) {
                var fx = Math.max(0, Math.min(sw - 1.001, x * sw / w - 0.5)), x0 = fx | 0, tx = fx - x0;
                var a0 = m[y0 * sw + x0], a1 = m[y0 * sw + x0 + 1], b0 = m[(y0 + 1) * sw + x0], b1 = m[(y0 + 1) * sw + x0 + 1];
                bg[y * w + x] = (a0 * (1 - tx) + a1 * tx) * (1 - ty) + (b0 * (1 - tx) + b1 * tx) * ty;
            }
        }
        return bg;
    }
    // rezim: 'seda' = šedotón s roztaženým kontrastem, 'stin' = navíc vyrovnaný stín (jas / pozadí),
    // 'prah' = místní práh (Bradley, integrální obraz). Světlé písmo na tmavém se napřed převrátí.
    function priprav(img, rezim) {
        var dl = Math.max(img.width, img.height);
        var k = dl > 2600 ? 2600 / dl : (dl < 1400 ? Math.min(2, 1400 / dl) : 1);   // malé písmo zvětšit
        var w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        try {
            var id = ctx.getImageData(0, 0, w, h), d = id.data, n = w * h, g = new Float32Array(n), sum = 0, i, j;
            for (i = 0, j = 0; j < n; i += 4, j++) { var v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; g[j] = v; sum += v; }
            if (sum / n < 105) for (j = 0; j < n; j++) g[j] = 255 - g[j];   // displej / rytina: světlé písmo na tmavém
            if (rezim === 'stin') { var bg = pozadi(g, w, h); for (j = 0; j < n; j++) g[j] = Math.min(255, g[j] * 255 / Math.max(24, bg[j])); }
            var hist = new Uint32Array(256); for (j = 0; j < n; j++) hist[g[j] | 0]++;
            var lo = 0, hi = 255, acc = 0;
            for (var a = 0; a < 256; a++) { acc += hist[a]; if (acc >= n * 0.02) { lo = a; break; } }
            acc = 0;
            for (var b2 = 255; b2 >= 0; b2--) { acc += hist[b2]; if (acc >= n * 0.02) { hi = b2; break; } }
            var span = Math.max(1, hi - lo);
            for (j = 0; j < n; j++) { var s2 = (g[j] - lo) * 255 / span; g[j] = s2 < 0 ? 0 : (s2 > 255 ? 255 : s2); }
            if (rezim === 'prah') {
                var ii = new Float64Array((w + 1) * (h + 1)), W1 = w + 1;
                for (var y = 0; y < h; y++) { var rs = 0; for (var x = 0; x < w; x++) { rs += g[y * w + x]; ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + rs; } }
                var r = Math.max(8, Math.round(Math.max(w, h) / 40)), T = 0.15, out = new Float32Array(n);
                for (y = 0; y < h; y++) {
                    var y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
                    for (x = 0; x < w; x++) {
                        var x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r), cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
                        var s3 = ii[(y1 + 1) * W1 + x1 + 1] - ii[y0 * W1 + x1 + 1] - ii[(y1 + 1) * W1 + x0] + ii[y0 * W1 + x0];
                        out[y * w + x] = g[y * w + x] * cnt <= s3 * (1 - T) ? 0 : 255;
                    }
                }
                g = out;
            }
            for (i = 0, j = 0; j < n; i += 4, j++) { d[i] = d[i + 1] = d[i + 2] = g[j]; d[i + 3] = 255; }
            ctx.putImageData(id, 0, 0);
        } catch (e) { swallow(e, 'priprav'); }
        return { canvas: c, k: k };
    }

    // ---------------------------------------------------------------- 3) OCR
    var _worker = null;
    function worker() {
        if (_worker) return _worker;
        _worker = (typeof ensureTesseract === 'function' ? ensureTesseract() : Promise.reject(new Error('OCR není k dispozici')))
            .then(function () {
                return Tesseract.createWorker('eng', 1, { logger: function (m) { if (m.status === 'recognizing text' && typeof updateOfflineProgress === 'function') updateOfflineProgress(Math.round((m.progress || 0) * 100), 100); } });
            })
            .then(function (w) {
                try { localStorage.setItem(OCR_LS, String(Date.now())); } catch (e) { /* nic */ }   // stažené = příště i offline
                // BEZ whitelistu číslic: s ním Tesseract „četl“ každé písmeno jako číslici. Záměny
                // uvnitř čísel opravuje opravToken(). PSM 6 = souvislý blok (seznam, štítek, tabulka).
                return w.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' }).then(function () { return w; });
            })
            .catch(function (e) { _worker = null; throw e; });
        return _worker;
    }
    function ukonciWorker() { var p = _worker; _worker = null; if (p) p.then(function (w) { try { w.terminate(); } catch (e) { /* nic */ } }).catch(function () { /* nic */ }); }

    function radky(res, k) {
        var data = (res && res.data) || {}, out = [];
        (data.lines || []).forEach(function (l) {
            var bb = l.bbox ? { x0: l.bbox.x0 / k, y0: l.bbox.y0 / k, x1: l.bbox.x1 / k, y1: l.bbox.y1 / k } : null;   // zpět do souřadnic originálu
            out.push({ text: l.text || '', bbox: bb, confidence: l.confidence });
        });
        return { text: data.text || '', lines: out };
    }
    function klic(b) { return (b.name || '') + '|' + Math.round(b.y) + '|' + Math.round(b.x); }
    // Dva průchody → vítěz s víc body; neshody mezi průchody se označí.
    function prectiFotku(img, popis) {
        var vysl = {};
        return worker().then(function (w) {
            var pr1 = priprav(img, window.AGFotoBodyRezim1 || 'stin');
            if (typeof showOfflineProgress === 'function') showOfflineProgress(0, 100, popis + ' (1/2)…', '%');
            return w.recognize(pr1.canvas).then(function (r) {
                vysl.a = radky(r, pr1.k);
                var pr2 = priprav(img, 'prah');
                if (typeof showOfflineProgress === 'function') showOfflineProgress(0, 100, popis + ' (2/2)…', '%');
                return w.recognize(pr2.canvas).then(function (r2) { vysl.b = radky(r2, pr2.k); });
            });
        }).then(function () {
            var A = textNaBody(vysl.a.text, vysl.a.lines), B = textNaBody(vysl.b.text, vysl.b.lines);
            var cele = function (arr) { return arr.filter(function (b) { return !b.neuplny; }).length; };
            var hl = cele(A) >= cele(B) ? A : B, dr = hl === A ? B : A;
            var shoda = function (b, o) { return (b.name && o.name === b.name) || (b.y != null && o.y != null && b.x != null && o.x != null && Math.abs(o.y - b.y) < 2 && Math.abs(o.x - b.x) < 2); };
            hl.forEach(function (b) {
                var m = dr.filter(function (o) { return shoda(b, o); })[0];
                if (b.neuplny) {
                    if (m && !m.neuplny) { b.y = m.y; b.x = m.x; if (b.z == null) b.z = m.z; b.neuplny = false; b.jistota = 'jen-1'; }
                    else b.jistota = 'neuplny';
                    return;
                }
                if (!m || m.neuplny) { b.jistota = dr.length ? 'jen-1' : 'ok'; return; }
                var neshoda = Math.abs(m.y - b.y) > 0.004 || Math.abs(m.x - b.x) > 0.004 || (m.z != null && b.z != null && Math.abs(m.z - b.z) > 0.004) || (m.name && b.name && m.name !== b.name);
                b.jistota = neshoda ? 'neshoda' : 'ok';
                if (neshoda) b.alt = { name: m.name, y: m.y, x: m.x, z: m.z };
                if (b.z == null && m.z != null) b.z = m.z;
            });
            // body, které našel jen druhý průchod, přidat (nejisté)
            dr.forEach(function (o) {
                if (o.neuplny) return;
                if (hl.some(function (b) { return shoda(b, o); })) return;
                o.jistota = 'jen-1'; hl.push(o);
            });
            // bod daleko od ostatních v seznamu (seznam bývá z jedné lokality) → nejspíš špatně přečtená číslice
            var ok = hl.filter(function (b) { return !b.neuplny && b.y != null && b.x != null; });
            if (ok.length >= 3) {
                var med = function (a) { a = a.slice().sort(function (p, q) { return p - q; }); return a[a.length >> 1]; };
                var my = med(ok.map(function (b) { return b.y; })), mx = med(ok.map(function (b) { return b.x; }));
                ok.forEach(function (b) { var dd = Math.hypot(b.y - my, b.x - mx); if (dd > 2000) b.odlehly = Math.round(dd / 100) / 10; });
            }
            return { body: hl, text: vysl.a.text.length >= vysl.b.text.length ? vysl.a.text : vysl.b.text };
        });
    }

    // ---------------------------------------------------------------- 4) kontroly bodu
    function kontroly(b) {
        var z = [];
        if (b.jistota === 'neshoda') z.push({ c: 'warn', t: t('dva pokusy OCR se liší — porovnej s fotkou') });
        if (b.jistota === 'jen-1') z.push({ c: 'warn', t: t('přečteno jen jedním pokusem') });
        if (b.neuplny) z.push({ c: 'warn', t: b.y == null ? t('chybí Y — doplň z fotky') : t('chybí X — doplň z fotky') });
        if (b.odlehly) z.push({ c: 'warn', t: t('leží daleko od ostatních bodů') + ' (' + String(b.odlehly).replace('.', ',') + ' km)' });
        (b.opravy || []).forEach(function (o) { z.push({ c: 'info', t: o }); });
        if (!b.name) z.push({ c: 'warn', t: t('bez čísla bodu — doplň') });
        try {
            if (typeof mistniToLatLng === 'function' && typeof userLat !== 'undefined' && userLat && userLng) {
                var ll = mistniToLatLng(b.y, b.x), dx = (ll.lng - userLng) * 111320 * Math.cos(userLat * Math.PI / 180), dy = (ll.lat - userLat) * 111320;
                var km = Math.hypot(dx, dy) / 1000;
                if (km > 30) z.push({ c: 'warn', t: t('daleko od tebe') + ' (' + Math.round(km) + ' km)' });
            }
        } catch (e) { swallow(e, 'dist'); }
        return z;
    }

    // ---------------------------------------------------------------- 5) UI
    var CSS = '#ag-fb{position:fixed;inset:0;z-index:20050;display:flex;flex-direction:column;background:var(--modal-bg,rgba(14,18,24,.98));color:var(--text-color,#e7ebe9);'
        + 'padding:calc(env(safe-area-inset-top,0px) + 12px) max(14px,env(safe-area-inset-right,0px)) calc(env(safe-area-inset-bottom,0px) + 12px) max(14px,env(safe-area-inset-left,0px));}'
        + 'body.light-mode #ag-fb{background:rgb(247,248,250);}'
        + '#ag-fb .fb-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;}'
        + '#ag-fb .fb-head h2{flex:1;margin:0;font-size:calc(19px * var(--ag-font-scale,1));color:var(--accent);}'
        + '#ag-fb .fb-x{width:40px;height:40px;border-radius:50%;border:1px solid var(--glass-border,rgba(255,255,255,.14));background:transparent;color:inherit;font-size:20px;}'
        + '#ag-fb .fb-foto{position:relative;flex:none;max-height:34vh;overflow:hidden;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,.14));background:#000;display:flex;justify-content:center;}'
        + '#ag-fb .fb-foto canvas{max-width:100%;max-height:34vh;display:block;}'
        + '#ag-fb .fb-sum{margin:10px 2px 6px;font-size:calc(13px * var(--ag-font-scale,1));color:var(--text-muted,#9aa4a0);}'
        + '#ag-fb .fb-list{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;display:flex;flex-direction:column;gap:8px;padding-bottom:6px;}'
        + '#ag-fb .fb-row{border:1px solid var(--glass-border,rgba(255,255,255,.12));border-radius:12px;padding:10px;display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;background:var(--glass-bg,rgba(255,255,255,.03));}'
        + '#ag-fb .fb-row.on{border-color:var(--accent);}'
        + '#ag-fb .fb-row.off{opacity:.5;}'
        + '#ag-fb .fb-row input[type=checkbox]{width:22px;height:22px;margin:0;}'
        + '#ag-fb .fb-f{display:grid;grid-template-columns:1fr 1.4fr 1.5fr 1fr;gap:6px;min-width:0;}'
        + '#ag-fb .fb-f label{display:flex;flex-direction:column;gap:2px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,#9aa4a0);min-width:0;}'
        + '#ag-fb .fb-f input{width:100%;min-width:0;box-sizing:border-box;padding:8px 6px;border-radius:8px;border:1px solid var(--glass-border,rgba(255,255,255,.14));background:rgba(0,0,0,.18);color:inherit;font:600 calc(13.5px * var(--ag-font-scale,1)) var(--font-mono,ui-monospace,monospace);}'
        + 'body.light-mode #ag-fb .fb-f input{background:#fff;}'
        + '#ag-fb .fb-z{grid-column:2;display:flex;flex-wrap:wrap;gap:5px;}'
        + '#ag-fb .fb-z span{font-size:calc(11.5px * var(--ag-font-scale,1));padding:3px 7px;border-radius:999px;background:rgba(240,178,74,.14);color:var(--warning,#f0b24a);}'
        + '#ag-fb .fb-z span.info{background:rgba(63,207,142,.12);color:var(--accent);}'
        + '#ag-fb .fb-foot{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;}'
        + '#ag-fb .fb-foot .btn{margin:0;}'
        + '#ag-fb .fb-foot .fb-save{grid-column:1/-1;}'
        + '#ag-fb details{font-size:12.5px;color:var(--text-muted,#9aa4a0);}'
        + '#ag-fb details pre{white-space:pre-wrap;font-size:11.5px;max-height:30vh;overflow:auto;}'
        + '#ag-fb-volba{position:fixed;inset:0;z-index:20060;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.45);}'
        + '#ag-fb-volba .fv{width:min(460px,100%);margin:0 10px calc(env(safe-area-inset-bottom,0px) + 12px);padding:16px;border-radius:18px;background:var(--modal-bg,rgb(22,27,32));border:1px solid var(--glass-border,rgba(255,255,255,.14));display:grid;gap:10px;}'
        + 'body.light-mode #ag-fb-volba .fv{background:#fff;}'
        + '#ag-fb-volba .fv b{font-size:calc(16px * var(--ag-font-scale,1));}'
        + '#ag-fb-volba .fv p{margin:0;font-size:calc(12.5px * var(--ag-font-scale,1));color:var(--text-muted,#9aa4a0);}'
        + '#ag-fb-volba .btn{margin:0;display:flex;align-items:center;justify-content:center;gap:8px;}'
        + '#ag-fb-volba .fb-offline:empty{display:none;}'
        + '#ag-fb-volba .fb-off-ok{color:var(--accent,#3fcf8e);margin:0;font-size:calc(12.5px * var(--ag-font-scale,1));}'
        + '@media (max-width:420px){#ag-fb .fb-f{grid-template-columns:1fr 1fr;}}';
    function styl() { if (document.getElementById('ag-fb-css')) return; var s = document.createElement('style'); s.id = 'ag-fb-css'; s.textContent = CSS; document.head.appendChild(s); }

    function vstup(capture, multiple) {
        var i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.style.display = 'none';
        if (capture) i.setAttribute('capture', 'environment');
        if (multiple) i.multiple = true;
        document.body.appendChild(i);
        return i;
    }

    // ---- ČTENÍ BEZ SIGNÁLU (24. 9. 2026, b2 ze 6. kola) ------------------------------------
    // OCR knihovna (~12 MB: tesseract.js + jádro WASM z jsdelivr → SW LIB_CACHE, jazyková data eng
    // → IndexedDB samotného Tesseractu) se dřív stáhla až při prvním čtení. Kdo to poprvé zkusil
    // v terénu bez signálu, dostal chybu. Teď se dá připravit předem: tlačítkem v nabídce, nebo
    // samo na Wi-Fi (Android hlásí typ připojení; iPhone ne → tam jen tlačítkem, ať appka
    // nestahuje 12 MB přes mobilní data bez ptaní).
    var OCR_LS = 'agOcrOffline_v1';
    function ocrPripraveno() { try { return !!localStorage.getItem(OCR_LS); } catch (e) { return false; } }
    var _priprava = null;
    function pripravOffline() {
        if (_priprava) return _priprava;
        _priprava = (typeof ensureTesseract === 'function' ? ensureTesseract() : Promise.reject(new Error('OCR není k dispozici')))
            .then(function () { return Tesseract.createWorker('eng', 1); })
            .then(function (w) { return w.terminate(); })
            .then(function () { try { localStorage.setItem(OCR_LS, String(Date.now())); } catch (e) { swallow(e, 'ocr-ls'); } return true; })
            .catch(function (e) { _priprava = null; throw e; });
        return _priprava;
    }
    function naWifi() {
        try { var c = navigator.connection; return !!(c && (c.type === 'wifi' || c.type === 'ethernet') && !c.saveData); } catch (e) { return false; }
    }
    function autoPriprava() {
        if (ocrPripraveno() || !navigator.onLine || !naWifi()) return;
        var go = function () { pripravOffline().catch(function (e) { swallow(e, 'auto-priprava'); }); };
        setTimeout(function () { if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 20000 }); else go(); }, 30000);
    }

    // Escape (klávesnice, tablet) zavře okno; androidí Zpět řeší js/android.js přes data-ag-okno + data-close
    function escZavre(ov, fn) {
        var h = function (e) {
            if (!ov.isConnected) return document.removeEventListener('keydown', h);
            if (e.key !== 'Escape' || document.querySelector('.ag-dlg-overlay')) return;
            if (ov.id === 'ag-fb-volba' || !document.getElementById('ag-fb-volba')) { e.preventDefault(); fn(); document.removeEventListener('keydown', h); }
        };
        document.addEventListener('keydown', h);
    }

    // Volba zdroje fotky
    function open(opts) {
        styl();
        opts = opts || {};
        var old = document.getElementById('ag-fb-volba'); if (old) old.remove();
        var ov = document.createElement('div'); ov.id = 'ag-fb-volba'; ov.setAttribute('data-ag-okno', '');
        ov.innerHTML = '<div class="fv" role="dialog" aria-label="' + esc(t('Body z fotky')) + '"><b>' + esc(t('Body z fotky')) + '</b>'
            + '<p>' + esc(t('Seznam souřadnic, štítek nebo výpis — každý řádek s číslem, Y a X se uloží jako bod. Fotku drž rovně a zblízka.')) + '</p>'
            + '<button type="button" class="btn btn-primary" data-k="foto"><svg class="icon"><use href="#i-camera"/></svg>' + esc(t('Vyfotit')) + '</button>'
            + '<button type="button" class="btn btn-secondary" data-k="galerie"><svg class="icon"><use href="#i-folder"/></svg>' + esc(t('Vybrat z galerie (i víc fotek)')) + '</button>'
            + '<div class="fb-offline"></div>'
            + '<button type="button" class="btn btn-secondary" data-k="zrusit" data-close>' + esc(t('Zrušit')) + '</button></div>';
        document.body.appendChild(ov);
        var zavri = function () { ov.remove(); };
        escZavre(ov, zavri);
        var off = ov.querySelector('.fb-offline');
        var ukazOffline = function () {
            if (ocrPripraveno()) { off.innerHTML = '<p class="fb-off-ok">✓ ' + esc(t('Čtení fotek funguje i bez signálu.')) + '</p>'; return; }
            off.innerHTML = '<button type="button" class="btn btn-secondary" data-k="offline">' + esc(t('Připravit pro práci bez signálu (~12 MB)')) + '</button>';
        };
        ukazOffline();
        ov.addEventListener('click', function (e) {
            if (e.target === ov) return zavri();
            var b = e.target.closest('button'); if (!b) return;
            var k = b.getAttribute('data-k');
            if (k === 'offline') {
                b.disabled = true; b.textContent = t('Stahuji čtení fotek…');
                pripravOffline().then(ukazOffline).catch(function (er) { b.disabled = false; b.textContent = t('Nepodařilo se — zkus to s internetem znovu'); swallow(er, 'priprava'); });
                return;
            }
            zavri();
            if (k === 'zrusit') return;
            var inp = vstup(k === 'foto', k === 'galerie');
            inp.addEventListener('change', function () {
                var files = Array.prototype.slice.call(inp.files || []); inp.remove();
                if (files.length) zpracuj(files, opts);
            });
            inp.click();
        });
    }

    var stav = null;   // { body:[], fotky:[{img}], text }
    function zpracuj(files, opts) {
        var body = [], texty = [], fotky = [], i = 0;
        var dalsi = function () {
            if (i >= files.length) return Promise.resolve();
            var f = files[i], idx = i; i++;
            return nactiObrazek(f).then(function (img) {
                fotky.push(img);
                var popis = files.length > 1 ? t('Čtu fotku') + ' ' + (idx + 1) + '/' + files.length : t('Čtu body z fotky');
                return prectiFotku(img, popis).then(function (r) {
                    r.body.forEach(function (b) { b.foto = fotky.length - 1; });
                    body = body.concat(r.body); texty.push(r.text);
                });
            }).then(dalsi);
        };
        dalsi().then(function () {
            if (typeof hideOfflineProgress === 'function') hideOfflineProgress();
            ukonciWorker();
            var predchozi = (opts.pridat && stav) ? stav : null;
            if (predchozi) { var off = predchozi.fotky.length; body.forEach(function (b) { b.foto += off; }); body = predchozi.body.concat(body); fotky = predchozi.fotky.concat(fotky); texty = predchozi.texty.concat(texty); }
            // Jeden bod a otevřené okno Nový bod → jen předvyplnit formulář (jako dřív)
            var form = document.getElementById('custom-modal-overlay');
            if (!predchozi && body.length === 1 && form && form.style.display === 'flex' && typeof applyOcrParsed === 'function') {
                var b = body[0];
                applyOcrParsed({ name: b.name, y: b.y, x: b.x, z: b.z });
                try { if (b.jistota !== 'ok') { var n = document.getElementById('ocr-note'); if (n) n.innerHTML += '<br>' + esc(kontroly(b).map(function (z) { return z.t; }).join(' · ')); } } catch (e) { swallow(e, 'note'); }
                window._agPointOrigin = 'foto-ocr';
                return;
            }
            stav = { body: body, fotky: fotky, texty: texty };
            prehled();
        }).catch(function (e) {
            if (typeof hideOfflineProgress === 'function') hideOfflineProgress();
            ukonciWorker();
            (window.agInfo || alert)(t('Čtení z fotky se nezdařilo:') + ' ' + ((e && e.message) ? e.message : e));
        });
    }

    var _aktivni = -1;
    function kresliFoto(canvas, idx) {
        var b = stav.body[idx], fi = b ? b.foto : 0, img = stav.fotky[fi] || stav.fotky[0];
        if (!img) return;
        var max = 1200, k = Math.min(1, max / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * k); canvas.height = Math.round(img.height * k);
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        stav.body.forEach(function (o, j) {
            if (o.foto !== fi || !o.bbox) return;
            var on = j === idx;
            ctx.lineWidth = on ? 4 : 2;
            ctx.strokeStyle = on ? '#3fcf8e' : 'rgba(240,178,74,.85)';
            ctx.fillStyle = on ? 'rgba(63,207,142,.18)' : 'rgba(240,178,74,.08)';
            var x = o.bbox.x0 * k - 4, y = o.bbox.y0 * k - 3, w = (o.bbox.x1 - o.bbox.x0) * k + 8, h = (o.bbox.y1 - o.bbox.y0) * k + 6;
            ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
        });
        // zvýrazněný řádek do středu výřezu (fotka je vyšší než pruh)
        try {
            if (b && b.bbox) { var box = canvas.parentNode, cy = (b.bbox.y0 + b.bbox.y1) / 2 * k * (canvas.clientHeight / canvas.height); box.scrollTop = Math.max(0, cy - box.clientHeight / 2); }
        } catch (e) { swallow(e, 'scroll'); }
    }

    function prehled() {
        styl();
        var old = document.getElementById('ag-fb'); if (old) old.remove();
        var ov = document.createElement('div'); ov.id = 'ag-fb'; ov.setAttribute('role', 'dialog'); ov.setAttribute('data-ag-okno', '');
        var n = stav.body.length;
        ov.innerHTML = '<div class="fb-head"><h2>' + esc(t('Body z fotky')) + '</h2><button type="button" class="fb-x" data-close aria-label="' + esc(t('Zavřít')) + '">✕</button></div>'
            + '<div class="fb-foto"><canvas></canvas></div>'
            + '<div class="fb-sum"></div><div class="fb-list"></div>'
            + '<details><summary>' + esc(t('Co OCR přečetlo (celý text)')) + '</summary><pre></pre></details>'
            + '<div class="fb-foot"><button type="button" class="btn btn-primary fb-save"></button>'
            + '<button type="button" class="btn btn-secondary fb-add">' + esc(t('+ Další fotka')) + '</button>'
            + '<button type="button" class="btn btn-secondary fb-cancel">' + esc(t('Zrušit')) + '</button></div>';
        document.body.appendChild(ov);
        ov.querySelector('pre').textContent = stav.texty.join('\n\n———\n\n');
        var list = ov.querySelector('.fb-list'), canvas = ov.querySelector('canvas');
        var sum = ov.querySelector('.fb-sum');
        var nejiste = stav.body.filter(function (b) { return b.jistota !== 'ok' || b.odlehly || b.neuplny; }).length;
        sum.textContent = n
            ? (t('Nalezeno bodů:') + ' ' + n + (nejiste ? ' · ' + t('k ověření:') + ' ' + nejiste : '') + ' · ' + t('Zkontroluj hodnoty proti fotce, klepnutím na bod ho na ní ukážu.'))
            : t('Na fotce se nenašel žádný řádek s číslem, Y a X. Zkus ostřejší záběr zblízka, kolmo na papír, bez stínů — nebo níž rozbal, co OCR přečetlo.');
        stav.body.forEach(function (b, i) {
            b.ulozit = b.ulozit !== false;
            var r = document.createElement('div'); r.className = 'fb-row' + (b.ulozit ? '' : ' off'); r.setAttribute('data-i', i);
            r.innerHTML = '<input type="checkbox" aria-label="' + esc(t('Uložit tento bod')) + '"' + (b.ulozit ? ' checked' : '') + '>'
                + '<div class="fb-f">'
                + '<label>' + esc(t('Číslo')) + '<input data-k="name" type="text" autocomplete="off" value="' + esc(b.name || '') + '"></label>'
                + '<label>Y<input data-k="y" type="text" inputmode="decimal" value="' + (b.y != null ? b.y.toFixed(2) : '') + '"></label>'
                + '<label>X<input data-k="x" type="text" inputmode="decimal" value="' + (b.x != null ? b.x.toFixed(2) : '') + '"></label>'
                + '<label>Z<input data-k="z" type="text" inputmode="decimal" value="' + (b.z != null ? b.z.toFixed(2) : '') + '"></label></div>'
                + '<div class="fb-z">' + kontroly(b).map(function (z) { return '<span class="' + (z.c === 'info' ? 'info' : '') + '">' + esc(z.t) + '</span>'; }).join('')
                + (b.alt ? '<span>' + esc(t('2. pokus:')) + ' ' + esc((b.alt.name || '') + ' ' + (b.alt.y != null ? b.alt.y.toFixed(2) : '') + ' ' + (b.alt.x != null ? b.alt.x.toFixed(2) : '')) + '</span>' : '') + '</div>';
            list.appendChild(r);
        });
        var ukaz = function (i) {
            _aktivni = i;
            list.querySelectorAll('.fb-row').forEach(function (r) { r.classList.toggle('on', +r.getAttribute('data-i') === i); });
            kresliFoto(canvas, i);
        };
        list.addEventListener('focusin', function (e) { var r = e.target.closest('.fb-row'); if (r) ukaz(+r.getAttribute('data-i')); });
        list.addEventListener('click', function (e) { var r = e.target.closest('.fb-row'); if (r) ukaz(+r.getAttribute('data-i')); });
        list.addEventListener('change', function (e) {
            var r = e.target.closest('.fb-row'); if (!r) return;
            var b = stav.body[+r.getAttribute('data-i')];
            if (e.target.type === 'checkbox') { b.ulozit = e.target.checked; r.classList.toggle('off', !b.ulozit); pocitej(); return; }
            var k = e.target.getAttribute('data-k'), v = e.target.value.trim();
            if (k === 'name') b.name = v || null;
            else { var c = parseFloat(v.replace(',', '.').replace(/\s/g, '')); b[k] = isFinite(c) ? c : null; if (b.y != null && b.x != null) b.neuplny = false; }
            pocitej();
        });
        var save = ov.querySelector('.fb-save');
        var pocitej = function () {
            var ok = stav.body.filter(function (b) { return b.ulozit && b.y != null && b.x != null && inY(b.y) && inX(b.x); }).length;
            save.textContent = ok === 1 ? t('Uložit 1 bod') : (t('Uložit bodů:') + ' ' + ok);
            save.disabled = !ok;
        };
        pocitej();
        var zavri = function () { ov.remove(); stav = null; };
        ov.querySelector('.fb-x').onclick = zavri;
        ov.querySelector('.fb-cancel').onclick = zavri;
        escZavre(ov, zavri);
        ov.querySelector('.fb-add').onclick = function () { open({ pridat: true }); };
        save.onclick = function () {
            var arr = stav.body.filter(function (b) { return b.ulozit && b.y != null && b.x != null && inY(b.y) && inX(b.x); }).map(function (b, i) {
                var ll = (typeof mistniToLatLng === 'function') ? mistniToLatLng(b.y, b.x) : null;
                return ll ? { name: b.name || ('F' + (i + 1)), lat: ll.lat, lng: ll.lng, vyska: b.z, origin: 'foto-ocr', prov: { origin: 'foto-ocr', ts: Date.now(), acc: null } } : null;
            }).filter(Boolean);
            var pred = (typeof persistentCustomPoints !== 'undefined') ? persistentCustomPoints.length : 0;
            var added = (typeof window.addImportedPoints === 'function') ? window.addImportedPoints(arr) : 0;
            zavri();
            try { if (typeof closeCustomModal === 'function') { var f = document.getElementById('custom-modal-overlay'); if (f && f.style.display === 'flex') closeCustomModal(); } } catch (e) { swallow(e, 'close'); }
            var dup = arr.length - added;
            var msg = (added === 1 ? t('Uložen 1 bod z fotky.') : (t('Uloženo bodů z fotky:') + ' ' + added + '.')) + (dup > 0 ? ' ' + t('Už v zakázce (přeskočeno):') + ' ' + dup + '.' : '');
            (window.quickToast || window.agInfo)(msg);
            void pred;
        };
        if (n) ukaz(0); else kresliFoto(canvas, -1);
    }

    // dlaždice v Nástrojích (Určit nový bod) — registr js/tools-registry.js, návod data/navody*.json
    window.agOpenBodyZFotky = function () { open(); };
    try {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'body-z-fotky', label: 'Body z fotky', cat: 'Měření', onClick: function () { open(); },
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l2-3h6l2 3h3v12H4z"/><path d="M8 12h8M8 15.5h5"/></svg>' });
        }
    } catch (e) { swallow(e, 'registr'); }

    // úspěšné čtení online = knihovna je stažená → příště funguje i bez signálu
    autoPriprava();

    window.AGFotoBody = {
        open: open,
        // pro testy a jiné moduly
        _test: { pripravOffline: pripravOffline, ocrPripraveno: ocrPripraveno, prehled: function (body, fotky, texty) { stav = { body: body, fotky: fotky || [], texty: texty || [''] }; prehled(); }, textNaBody: textNaBody, radekNaBod: radekNaBod, tokeny: tokeny, priprav: priprav, prectiFotku: prectiFotku, zpracuj: zpracuj, stav: function () { return stav; } }
    };
})();
