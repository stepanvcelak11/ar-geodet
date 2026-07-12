// ===== AR Geodet — ZÁPISNÍKY (ODPOJITELNÁ vrstva) ================================
// Digitální měřické zápisníky místo papíru:
//   1) TECHNICKÁ NIVELACE — řádky: bod, čtení zpět (z), čtení vpřed (p).
//      Auto-výpočet: převýšení h = z − p, průběžné výšky od zadané výchozí výšky,
//      součty Σz/Σp/Σh a uzávěr proti známé koncové výšce (mez 40·√R mm pro TN).
//   2) VODOROVNÉ SMĚRY — cíle × skupiny, čtení v I. a II. poloze (gon).
//      Auto-výpočet: průměr z poloh (II − 200g), redukce na první směr, průměr
//      redukovaných směrů ze skupin + největší rozdíl mezi skupinami.
// Auto-výpočet jde v hlavičce zápisníku VYPNOUT (na přání: možnost jen zapisovat).
// Data se ukládají per ZAKÁZKA (getStoredData/setStoredData z logika.js) a jdou
// exportovat jako textový soubor.
//
// NEEDITUJE logika.js ani grafika.js. Odstranění: smaž js/zapisnik.js + řádek
// <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var KEY = 'agZapisniky12';
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';

    // ---- úložiště (per zakázka; fallback čisté localStorage) -------------------------
    function loadAll() {
        var s = null;
        try { s = (typeof getStoredData === 'function') ? getStoredData(KEY) : localStorage.getItem(KEY); } catch (e) {}
        var d = null; try { d = s ? JSON.parse(s) : null; } catch (e) {}
        if (!d || typeof d !== 'object') d = {};
        if (!Array.isArray(d.niv)) d.niv = [];
        if (!Array.isArray(d.sm)) d.sm = [];
        return d;
    }
    function saveAll(d) {
        var s = JSON.stringify(d);
        try { if (typeof setStoredData === 'function') { setStoredData(KEY, s); return; } } catch (e) {}
        try { localStorage.setItem(KEY, s); } catch (e) {}
    }
    function num(v) { if (v == null || v === '') return null; var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
    function f3(v) { return v == null ? '—' : v.toFixed(3); }
    function f4(v) { return v == null ? '—' : v.toFixed(4); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function uid() { return 'zb_' + Date.now() + '_' + Math.round(Math.random() * 1e5); }
    // rozdíl úhlů v gon do <-200,200>
    function gDiff(a, b) { return ((a - b + 600) % 400) - 200; }

    // ---- styly ------------------------------------------------------------------------
    var STYLE_ID = 'ag-zb-style';
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-zb-ov{position:fixed;inset:0;z-index:1000040;display:none;flex-direction:column;background:var(--bg-color,#0f1216);color:var(--text-color,#eceef2);}',
            '#ag-zb-ov.open{display:flex;}',
            '#ag-zb-head{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px 12px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.12));}',
            '#ag-zb-head h2{margin:0;font-size:17px;flex:1;color:var(--accent,#34d399);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '#ag-zb-head button{border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:transparent;color:inherit;border-radius:99px;padding:8px 14px;font-weight:600;cursor:pointer;flex:0 0 auto;}',
            '#ag-zb-body{flex:1 1 auto;overflow:auto;padding:14px 14px calc(env(safe-area-inset-bottom,0px) + 20px);-webkit-overflow-scrolling:touch;}',
            '.ag-zb-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;margin-bottom:10px;padding:13px 14px;border-radius:14px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:rgba(255,255,255,0.04);color:inherit;cursor:pointer;}',
            '.ag-zb-item b{flex:1;font-size:14.5px;}',
            '.ag-zb-item small{color:var(--text-muted,#9aa1ac);}',
            '.ag-zb-del{border:none;background:transparent;color:var(--danger,#ef4444);font-size:16px;cursor:pointer;padding:6px;}',
            '.ag-zb-sec{margin:16px 2px 8px;font:700 11px/1 var(--font-display,system-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.ag-zb-newbtn{width:100%;padding:12px;margin-bottom:8px;border-radius:12px;border:1px dashed var(--accent-line,rgba(52,211,153,0.4));background:var(--accent-soft,rgba(52,211,153,0.07));color:var(--accent,#34d399);font-weight:600;cursor:pointer;}',
            '.ag-zb-meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;}',
            '.ag-zb-meta label{flex:1 1 120px;font-size:11px;color:var(--text-muted,#9aa1ac);display:flex;flex-direction:column;gap:4px;}',
            '.ag-zb-meta input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.05);color:inherit;font-size:14px;}',
            '.ag-zb-auto{display:flex;align-items:center;gap:8px;margin:4px 0 12px;font-size:13px;color:var(--text-muted,#9aa1ac);}',
            '.ag-zb-auto input{width:18px;height:18px;accent-color:var(--accent,#34d399);}',
            '.ag-zb-tblwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--glass-border,rgba(255,255,255,0.1));border-radius:12px;}',
            '.ag-zb-tbl{border-collapse:collapse;width:100%;min-width:520px;font-size:13px;}',
            '.ag-zb-tbl th{position:sticky;top:0;background:rgba(20,25,32,0.97);padding:8px 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#9aa1ac);border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.12));text-align:left;}',
            '.ag-zb-tbl td{padding:4px 4px;border-bottom:1px solid rgba(255,255,255,0.06);vertical-align:middle;}',
            '.ag-zb-tbl input{width:86px;box-sizing:border-box;padding:8px 8px;border-radius:8px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:rgba(255,255,255,0.05);color:inherit;font-size:14px;font-family:var(--font-mono,monospace);}',
            '.ag-zb-tbl input.ag-zb-name{width:96px;font-family:inherit;}',
            '.ag-zb-comp{font-family:var(--font-mono,monospace);color:var(--accent-bright,#34d399);white-space:nowrap;}',
            '.ag-zb-sum{margin-top:12px;padding:12px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:rgba(255,255,255,0.04);font-size:13.5px;line-height:1.7;}',
            '.ag-zb-sum b{font-family:var(--font-mono,monospace);}',
            '.ag-zb-warn{color:var(--danger,#ef4444);font-weight:700;}',
            '.ag-zb-okk{color:var(--accent,#34d399);font-weight:700;}',
            '.ag-zb-rowbtns{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}',
            '.ag-zb-rowbtns button{flex:1 1 130px;padding:11px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:rgba(255,255,255,0.05);color:inherit;font-weight:600;cursor:pointer;}',
            '.ag-zb-rowbtns .primary{background:var(--accent-soft,rgba(52,211,153,0.12));border-color:var(--accent-line,rgba(52,211,153,0.4));color:var(--accent,#34d399);}',
            'body.outdoor-mode #ag-zb-ov{background:#000;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- overlay ------------------------------------------------------------------------
    var _ov = null, _view = { mode: 'list', id: null };
    function ensureOverlay() {
        if (_ov && _ov.isConnected) return _ov;
        injectStyles();
        _ov = document.createElement('div');
        _ov.id = 'ag-zb-ov';
        _ov.innerHTML = '<div id="ag-zb-head"><h2 id="ag-zb-title">Zápisníky</h2><button type="button" id="ag-zb-exp" style="display:none;">Export</button><button type="button" id="ag-zb-back">Zavřít</button></div><div id="ag-zb-body"></div>';
        document.body.appendChild(_ov);
        _ov.querySelector('#ag-zb-back').addEventListener('click', function () {
            if (_view.mode !== 'list') renderHome(); else close();
        });
        _ov.querySelector('#ag-zb-exp').addEventListener('click', exportCurrent);
        return _ov;
    }
    function setHead(title, backLabel, canExport) {
        _ov.querySelector('#ag-zb-title').textContent = title;
        _ov.querySelector('#ag-zb-back').textContent = backLabel;
        _ov.querySelector('#ag-zb-exp').style.display = canExport ? '' : 'none';
    }
    function open() { ensureOverlay(); renderHome(); _ov.classList.add('open'); }
    function close() { if (_ov) _ov.classList.remove('open'); }
    window.agOpenZapisnik = open;

    // ---- seznam zápisníků ------------------------------------------------------------------
    function renderHome() {
        var ov = ensureOverlay();
        _view = { mode: 'list', id: null };
        setHead('Zápisníky', 'Zavřít', false);
        var d = loadAll();
        var b = ov.querySelector('#ag-zb-body');
        var h = '<p style="font-size:12.5px;color:var(--text-muted,#9aa1ac);line-height:1.5;margin:2px 2px 10px;">Zápis měření do mobilu místo papíru. Výpočty běží průběžně — v hlavičce zápisníku je lze vypnout. Uloženo v aktuální zakázce.</p>';
        h += '<div class="ag-zb-sec">Technická nivelace</div>';
        h += '<button type="button" class="ag-zb-newbtn" data-new="niv">＋ Nový nivelační zápisník</button>';
        d.niv.forEach(function (n) {
            h += '<div class="ag-zb-item" data-open="niv:' + n.id + '"><b>' + esc(n.name || 'Nivelace') + '</b><small>' + n.rows.length + ' sestav</small><button type="button" class="ag-zb-del" data-del="niv:' + n.id + '" aria-label="Smazat">✕</button></div>';
        });
        h += '<div class="ag-zb-sec">Vodorovné směry</div>';
        h += '<button type="button" class="ag-zb-newbtn" data-new="sm">＋ Nový zápisník směrů</button>';
        d.sm.forEach(function (n) {
            h += '<div class="ag-zb-item" data-open="sm:' + n.id + '"><b>' + esc(n.name || 'Směry') + '</b><small>' + n.targets.length + ' cílů · ' + n.groups.length + ' skupin</small><button type="button" class="ag-zb-del" data-del="sm:' + n.id + '" aria-label="Smazat">✕</button></div>';
        });
        b.innerHTML = h;
        b.scrollTop = 0;
        b.querySelectorAll('[data-new]').forEach(function (el) {
            el.addEventListener('click', function () { createNotebook(el.getAttribute('data-new')); });
        });
        b.querySelectorAll('[data-open]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                if (e.target.closest('.ag-zb-del')) return;
                var p = el.getAttribute('data-open').split(':');
                if (p[0] === 'niv') renderNiv(p[1]); else renderSm(p[1]);
            });
        });
        b.querySelectorAll('.ag-zb-del').forEach(function (el) {
            el.addEventListener('click', function () {
                if (!confirm('Smazat tento zápisník včetně všech zápisů?')) return;
                var p = el.getAttribute('data-del').split(':');
                var dd = loadAll();
                dd[p[0]] = dd[p[0]].filter(function (n) { return n.id !== p[1]; });
                saveAll(dd); renderHome();
            });
        });
    }
    function createNotebook(type) {
        var name = prompt(type === 'niv' ? 'Název nivelačního pořadu (např. „ČB-101 → ČB-102"):' : 'Název zápisníku směrů (např. „Stanovisko 4001"):');
        if (name === null) return;
        var d = loadAll();
        if (type === 'niv') {
            var n = { id: uid(), name: name || 'Nivelace', h0: '', hEnd: '', lenKm: '', autoCalc: true, rows: [{ bod: '', z: '', p: '', note: '' }] };
            d.niv.push(n); saveAll(d); renderNiv(n.id);
        } else {
            var s = { id: uid(), name: name || 'Směry', stan: '', autoCalc: true, targets: ['', ''], groups: [{ a: ['', ''], b: ['', ''] }] };
            d.sm.push(s); saveAll(d); renderSm(s.id);
        }
    }
    function getNb(type, id) {
        var d = loadAll();
        var arr = type === 'niv' ? d.niv : d.sm;
        for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return { d: d, nb: arr[i] };
        return null;
    }

    // ==== NIVELACE =========================================================================
    function nivCompute(nb) {
        var h0 = num(nb.h0);
        var H = h0, sz = 0, sp = 0, out = [];
        nb.rows.forEach(function (r) {
            var z = num(r.z), p = num(r.p);
            var h = (z != null && p != null) ? (z - p) : null;
            if (z != null) sz += z;
            if (p != null) sp += p;
            if (h != null && H != null) H = H + h; else if (h == null) H = (H != null && z == null && p == null) ? H : null;
            out.push({ h: h, H: (h != null) ? H : null });
        });
        var res = { rows: out, sz: sz, sp: sp, sh: sz - sp, Hend: null, odch: null, mez: null };
        if (h0 != null) { var Hl = h0; out.forEach(function (o) { if (o.h != null && Hl != null) Hl += o.h; }); res.Hend = Hl; }
        var hEnd = num(nb.hEnd);
        if (hEnd != null && res.Hend != null) res.odch = (res.Hend - hEnd) * 1000; // mm
        var R = num(nb.lenKm);
        if (R != null && R > 0) res.mez = 40 * Math.sqrt(R); // mm — běžná mez pro TN
        return res;
    }
    function renderNiv(id) {
        var g = getNb('niv', id); if (!g) { renderHome(); return; }
        var nb = g.nb;
        _view = { mode: 'niv', id: id };
        var ov = ensureOverlay();
        setHead(nb.name || 'Nivelace', '‹ Zpět', true);
        var b = ov.querySelector('#ag-zb-body');
        var h = '<div class="ag-zb-meta">'
            + '<label>Výška výchozího bodu (m)<input inputmode="decimal" data-meta="h0" value="' + esc(nb.h0) + '" placeholder="např. 312.450"></label>'
            + '<label>Známá výška koncového bodu (m)<input inputmode="decimal" data-meta="hEnd" value="' + esc(nb.hEnd) + '" placeholder="volitelné"></label>'
            + '<label>Délka pořadu R (km)<input inputmode="decimal" data-meta="lenKm" value="' + esc(nb.lenKm) + '" placeholder="pro mez 40·√R"></label>'
            + '</div>'
            + '<label class="ag-zb-auto"><input type="checkbox" data-meta="autoCalc"' + (nb.autoCalc ? ' checked' : '') + '> Počítat průběžně (převýšení, výšky, uzávěr)</label>';
        h += '<div class="ag-zb-tblwrap"><table class="ag-zb-tbl"><thead><tr><th>Bod</th><th>Zpět z (m)</th><th>Vpřed p (m)</th><th>h = z−p</th><th>Výška (m)</th><th></th></tr></thead><tbody>';
        nb.rows.forEach(function (r, i) {
            h += '<tr>'
                + '<td><input class="ag-zb-name" data-row="' + i + '" data-f="bod" value="' + esc(r.bod) + '" placeholder="bod ' + (i + 1) + '"></td>'
                + '<td><input inputmode="decimal" data-row="' + i + '" data-f="z" value="' + esc(r.z) + '"></td>'
                + '<td><input inputmode="decimal" data-row="' + i + '" data-f="p" value="' + esc(r.p) + '"></td>'
                + '<td><span class="ag-zb-comp" data-ch="' + i + '">—</span></td>'
                + '<td><span class="ag-zb-comp" data-cH="' + i + '">—</span></td>'
                + '<td><button type="button" class="ag-zb-del" data-delrow="' + i + '" aria-label="Smazat řádek">✕</button></td>'
                + '</tr>';
        });
        h += '</tbody></table></div>';
        h += '<div class="ag-zb-rowbtns"><button type="button" class="primary" id="ag-zb-addrow">＋ Přidat sestavu</button></div>';
        h += '<div class="ag-zb-sum" id="ag-zb-sum"></div>';
        h += '<p style="font-size:11.5px;color:var(--text-muted,#9aa1ac);line-height:1.5;">Jedna sestava = čtení zpět na předchozí bod a vpřed na další bod. Mez uzávěru 40·√R mm je běžná hodnota pro technickou nivelaci — pro přesnější řády použij předpis dané třídy.</p>';
        b.innerHTML = h;
        b.querySelectorAll('[data-meta]').forEach(function (inp) {
            var ev = inp.type === 'checkbox' ? 'change' : 'input';
            inp.addEventListener(ev, function () {
                var gg = getNb('niv', id); if (!gg) return;
                gg.nb[inp.getAttribute('data-meta')] = inp.type === 'checkbox' ? inp.checked : inp.value;
                saveAll(gg.d); nivRefresh(id);
            });
        });
        b.querySelectorAll('input[data-row]').forEach(function (inp) {
            inp.addEventListener('input', function () {
                var gg = getNb('niv', id); if (!gg) return;
                var r = gg.nb.rows[parseInt(inp.getAttribute('data-row'), 10)];
                if (r) { r[inp.getAttribute('data-f')] = inp.value; saveAll(gg.d); nivRefresh(id); }
            });
        });
        b.querySelectorAll('[data-delrow]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var gg = getNb('niv', id); if (!gg) return;
                gg.nb.rows.splice(parseInt(btn.getAttribute('data-delrow'), 10), 1);
                if (!gg.nb.rows.length) gg.nb.rows.push({ bod: '', z: '', p: '', note: '' });
                saveAll(gg.d); renderNiv(id);
            });
        });
        var add = b.querySelector('#ag-zb-addrow');
        if (add) add.addEventListener('click', function () {
            var gg = getNb('niv', id); if (!gg) return;
            gg.nb.rows.push({ bod: '', z: '', p: '', note: '' });
            saveAll(gg.d); renderNiv(id);
            var rows = _ov.querySelectorAll('input[data-f="z"]');
            if (rows.length) rows[rows.length - 1].focus();
        });
        nivRefresh(id);
    }
    function nivRefresh(id) {
        var g = getNb('niv', id); if (!g || !_ov) return;
        var nb = g.nb;
        var sum = _ov.querySelector('#ag-zb-sum'); if (!sum) return;
        if (!nb.autoCalc) {
            _ov.querySelectorAll('[data-ch],[data-cH]').forEach(function (el) { el.textContent = '·'; });
            sum.innerHTML = 'Průběžný výpočet je vypnutý — jen zapisuješ. Zapneš ho přepínačem nahoře.';
            return;
        }
        var res = nivCompute(nb);
        res.rows.forEach(function (o, i) {
            var eh = _ov.querySelector('[data-ch="' + i + '"]'); if (eh) eh.textContent = o.h == null ? '—' : (o.h > 0 ? '+' : '') + o.h.toFixed(3);
            var eH = _ov.querySelector('[data-cH="' + i + '"]'); if (eH) eH.textContent = o.H == null ? '—' : o.H.toFixed(3);
        });
        var hh = 'Σ zpět = <b>' + f3(res.sz) + '</b> m · Σ vpřed = <b>' + f3(res.sp) + '</b> m · Σ h = <b>' + f3(res.sh) + '</b> m';
        if (res.Hend != null) hh += '<br>Výška konce z měření: <b>' + res.Hend.toFixed(3) + '</b> m';
        if (res.odch != null) {
            var okTxt = '';
            if (res.mez != null) okTxt = Math.abs(res.odch) <= res.mez ? ' <span class="ag-zb-okk">✓ v mezi ' + res.mez.toFixed(0) + ' mm</span>' : ' <span class="ag-zb-warn">✗ nad mez ' + res.mez.toFixed(0) + ' mm!</span>';
            hh += '<br>Uzávěr: <b>' + (res.odch > 0 ? '+' : '') + res.odch.toFixed(1) + ' mm</b>' + okTxt;
        } else if (res.mez != null) {
            hh += '<br>Mez uzávěru (40·√R): <b>' + res.mez.toFixed(0) + ' mm</b> — zadej známou koncovou výšku pro porovnání.';
        }
        sum.innerHTML = hh;
    }

    // ==== VODOROVNÉ SMĚRY ==================================================================
    // skupina: a[i] = čtení I. poloha na cíl i, b[i] = čtení II. poloha (gon)
    function smCompute(nb) {
        var nT = nb.targets.length;
        var groups = nb.groups.map(function (gr) {
            var means = [], reds = [];
            for (var i = 0; i < nT; i++) {
                var a = num(gr.a[i]), b2 = num(gr.b[i]);
                var m = null;
                if (a != null && b2 != null) { var bb = ((b2 - 200) % 400 + 400) % 400; m = ((a + gDiff(bb, a) / 2) % 400 + 400) % 400; }
                else if (a != null) m = a;
                else if (b2 != null) m = ((b2 - 200) % 400 + 400) % 400;
                means.push(m);
            }
            var base = means[0];
            for (var j = 0; j < nT; j++) {
                reds.push((means[j] != null && base != null) ? ((means[j] - base) % 400 + 400) % 400 : null);
            }
            return { means: means, reds: reds };
        });
        // průměr redukovaných směrů přes skupiny + největší rozdíl
        var avg = [], span = [];
        for (var i = 0; i < nT; i++) {
            var vals = [];
            groups.forEach(function (gr) { if (gr.reds[i] != null) vals.push(gr.reds[i]); });
            if (!vals.length) { avg.push(null); span.push(null); continue; }
            var ref = vals[0], s = 0, mn = 0, mx = 0;
            vals.forEach(function (v, k) { var dv = gDiff(v, ref); s += dv; if (k === 0 || dv < mn) mn = dv; if (k === 0 || dv > mx) mx = dv; });
            avg.push(((ref + s / vals.length) % 400 + 400) % 400);
            span.push((mx - mn) * 1000); // mgon
        }
        return { groups: groups, avg: avg, span: span };
    }
    function renderSm(id) {
        var g = getNb('sm', id); if (!g) { renderHome(); return; }
        var nb = g.nb;
        _view = { mode: 'sm', id: id };
        var ov = ensureOverlay();
        setHead(nb.name || 'Směry', '‹ Zpět', true);
        var b = ov.querySelector('#ag-zb-body');
        var h = '<div class="ag-zb-meta">'
            + '<label>Stanovisko<input data-meta="stan" value="' + esc(nb.stan) + '" placeholder="číslo bodu"></label>'
            + '</div>'
            + '<label class="ag-zb-auto"><input type="checkbox" data-meta="autoCalc"' + (nb.autoCalc ? ' checked' : '') + '> Počítat průběžně (průměry poloh, redukce, průměr ze skupin)</label>';
        h += '<div class="ag-zb-tblwrap"><table class="ag-zb-tbl"><thead><tr><th>Cíl</th>';
        nb.groups.forEach(function (_, gi) { h += '<th>' + (gi + 1) + '. sk — I (gon)</th><th>II (gon)</th><th>red.</th>'; });
        h += '<th>Ø red. (gon)</th><th>rozptyl</th><th></th></tr></thead><tbody>';
        nb.targets.forEach(function (t, ti) {
            h += '<tr><td><input class="ag-zb-name" data-t="' + ti + '" value="' + esc(t) + '" placeholder="cíl ' + (ti + 1) + '"></td>';
            nb.groups.forEach(function (gr, gi) {
                h += '<td><input inputmode="decimal" data-g="' + gi + '" data-ab="a" data-i="' + ti + '" value="' + esc(gr.a[ti] || '') + '"></td>'
                    + '<td><input inputmode="decimal" data-g="' + gi + '" data-ab="b" data-i="' + ti + '" value="' + esc(gr.b[ti] || '') + '"></td>'
                    + '<td><span class="ag-zb-comp" data-red="' + gi + ':' + ti + '">—</span></td>';
            });
            h += '<td><span class="ag-zb-comp" data-avg="' + ti + '">—</span></td><td><span class="ag-zb-comp" data-span="' + ti + '">—</span></td>'
                + '<td><button type="button" class="ag-zb-del" data-delt="' + ti + '" aria-label="Smazat cíl">✕</button></td></tr>';
        });
        h += '</tbody></table></div>';
        h += '<div class="ag-zb-rowbtns"><button type="button" class="primary" id="ag-zb-addt">＋ Přidat cíl</button><button type="button" id="ag-zb-addg">＋ Přidat skupinu</button>' + (nb.groups.length > 1 ? '<button type="button" id="ag-zb-delg">− Odebrat poslední skupinu</button>' : '') + '</div>';
        h += '<p style="font-size:11.5px;color:var(--text-muted,#9aa1ac);line-height:1.5;">Čtení v gon. II. poloha se převádí o 200<sup>g</sup>; „red." = směr redukovaný na první cíl skupiny. „Rozptyl" = největší rozdíl redukovaných směrů mezi skupinami (mgon) — velká hodnota znamená chybu čtení nebo pohnutý přístroj.</p>';
        b.innerHTML = h;
        b.querySelectorAll('[data-meta]').forEach(function (inp) {
            var ev = inp.type === 'checkbox' ? 'change' : 'input';
            inp.addEventListener(ev, function () {
                var gg = getNb('sm', id); if (!gg) return;
                gg.nb[inp.getAttribute('data-meta')] = inp.type === 'checkbox' ? inp.checked : inp.value;
                saveAll(gg.d); smRefresh(id);
            });
        });
        b.querySelectorAll('input[data-t]').forEach(function (inp) {
            inp.addEventListener('input', function () {
                var gg = getNb('sm', id); if (!gg) return;
                gg.nb.targets[parseInt(inp.getAttribute('data-t'), 10)] = inp.value;
                saveAll(gg.d);
            });
        });
        b.querySelectorAll('input[data-g]').forEach(function (inp) {
            inp.addEventListener('input', function () {
                var gg = getNb('sm', id); if (!gg) return;
                var gr = gg.nb.groups[parseInt(inp.getAttribute('data-g'), 10)];
                if (gr) { gr[inp.getAttribute('data-ab')][parseInt(inp.getAttribute('data-i'), 10)] = inp.value; saveAll(gg.d); smRefresh(id); }
            });
        });
        b.querySelectorAll('[data-delt]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var gg = getNb('sm', id); if (!gg) return;
                var ti = parseInt(btn.getAttribute('data-delt'), 10);
                gg.nb.targets.splice(ti, 1);
                gg.nb.groups.forEach(function (gr) { gr.a.splice(ti, 1); gr.b.splice(ti, 1); });
                if (!gg.nb.targets.length) { gg.nb.targets.push(''); gg.nb.groups.forEach(function (gr) { gr.a.push(''); gr.b.push(''); }); }
                saveAll(gg.d); renderSm(id);
            });
        });
        var addT = b.querySelector('#ag-zb-addt');
        if (addT) addT.addEventListener('click', function () {
            var gg = getNb('sm', id); if (!gg) return;
            gg.nb.targets.push('');
            gg.nb.groups.forEach(function (gr) { gr.a.push(''); gr.b.push(''); });
            saveAll(gg.d); renderSm(id);
        });
        var addG = b.querySelector('#ag-zb-addg');
        if (addG) addG.addEventListener('click', function () {
            var gg = getNb('sm', id); if (!gg) return;
            gg.nb.groups.push({ a: gg.nb.targets.map(function () { return ''; }), b: gg.nb.targets.map(function () { return ''; }) });
            saveAll(gg.d); renderSm(id);
        });
        var delG = b.querySelector('#ag-zb-delg');
        if (delG) delG.addEventListener('click', function () {
            var gg = getNb('sm', id); if (!gg || gg.nb.groups.length <= 1) return;
            if (!confirm('Odebrat poslední skupinu včetně čtení?')) return;
            gg.nb.groups.pop(); saveAll(gg.d); renderSm(id);
        });
        smRefresh(id);
    }
    function smRefresh(id) {
        var g = getNb('sm', id); if (!g || !_ov) return;
        var nb = g.nb;
        if (!nb.autoCalc) {
            _ov.querySelectorAll('[data-red],[data-avg],[data-span]').forEach(function (el) { el.textContent = '·'; });
            return;
        }
        var res = smCompute(nb);
        res.groups.forEach(function (gr, gi) {
            gr.reds.forEach(function (r, ti) {
                var el = _ov.querySelector('[data-red="' + gi + ':' + ti + '"]');
                if (el) el.textContent = r == null ? '—' : r.toFixed(4);
            });
        });
        res.avg.forEach(function (a, ti) {
            var el = _ov.querySelector('[data-avg="' + ti + '"]');
            if (el) el.textContent = a == null ? '—' : a.toFixed(4);
            var sp = _ov.querySelector('[data-span="' + ti + '"]');
            if (sp) sp.textContent = res.span[ti] == null ? '—' : res.span[ti].toFixed(1) + ' mgon';
        });
    }

    // ==== EXPORT ===========================================================================
    function dl(name, text) {
        var a = document.createElement('a');
        a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent('﻿' + text);
        a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    }
    function exportCurrent() {
        if (_view.mode === 'niv') {
            var g = getNb('niv', _view.id); if (!g) return;
            var nb = g.nb, res = nivCompute(nb);
            var L = ['NIVELAČNÍ ZÁPISNÍK — ' + (nb.name || ''), 'Výchozí výška: ' + (nb.h0 || '—') + ' m', ''];
            L.push('bod;zpět z (m);vpřed p (m);h (m);výška (m)');
            nb.rows.forEach(function (r, i) {
                L.push([r.bod, r.z, r.p, res.rows[i].h == null ? '' : res.rows[i].h.toFixed(3), res.rows[i].H == null ? '' : res.rows[i].H.toFixed(3)].join(';'));
            });
            L.push('');
            L.push('Σz=' + f3(res.sz) + ' m; Σp=' + f3(res.sp) + ' m; Σh=' + f3(res.sh) + ' m');
            if (res.odch != null) L.push('Uzávěr: ' + res.odch.toFixed(1) + ' mm' + (res.mez != null ? ' (mez 40·√R = ' + res.mez.toFixed(0) + ' mm)' : ''));
            dl('nivelace_' + (nb.name || 'zapisnik').replace(/[^\wěščřžýáíéúůóťďň-]+/gi, '_') + '.csv', L.join('\r\n'));
        } else if (_view.mode === 'sm') {
            var g2 = getNb('sm', _view.id); if (!g2) return;
            var nb2 = g2.nb, res2 = smCompute(nb2);
            var L2 = ['ZÁPISNÍK VODOROVNÝCH SMĚRŮ — ' + (nb2.name || ''), 'Stanovisko: ' + (nb2.stan || '—'), ''];
            var head = ['cíl'];
            nb2.groups.forEach(function (_, gi) { head.push((gi + 1) + '.sk I (gon)', 'II (gon)', 'red. (gon)'); });
            head.push('Ø red. (gon)', 'rozptyl (mgon)');
            L2.push(head.join(';'));
            nb2.targets.forEach(function (t, ti) {
                var row = [t];
                nb2.groups.forEach(function (gr, gi) {
                    row.push(gr.a[ti] || '', gr.b[ti] || '', res2.groups[gi].reds[ti] == null ? '' : res2.groups[gi].reds[ti].toFixed(4));
                });
                row.push(res2.avg[ti] == null ? '' : res2.avg[ti].toFixed(4), res2.span[ti] == null ? '' : res2.span[ti].toFixed(1));
                L2.push(row.join(';'));
            });
            dl('smery_' + (nb2.name || 'zapisnik').replace(/[^\wěščřžýáíéúůóťďň-]+/gi, '_') + '.csv', L2.join('\r\n'));
        }
    }

    // ---- registrace dlaždice ---------------------------------------------------------------
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'zapisnik', label: 'Zápisníky (nivelace, směry)', icon: ICON, onClick: open, order: 4 });
        } else {
            setTimeout(register, 700);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
})();
