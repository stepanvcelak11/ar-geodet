// ===== QTRIG — CVIČNÉ ÚLOHY S KLÍČEM (ODPOJITELNÁ vrstva) ====================
// Neinvazivní. NEEDITUJE logika.js ani grafika.js — čte data/ulohy.json, otevírá
// vlastní modal a umí předvyplnit Kalkulačku (volá její veřejné funkce
// openCalcModal / showCalcTool / addPgRow / addNvRow z js/kalkulacka.js).
//
// PROČ (hodnocení pro studenty, 13. 9. 2026): Kalkulačka umí spočítat rajón,
// protínání i polygon, ale student u ní nemá NA ČEM cvičit — zadání z cvičení
// má na papíře a výsledek k porovnání nikde. Tady je 22 zadání se známým klíčem:
// student spočítá (ručně, nebo v Kalkulačce s předvyplněnými údaji), zapíše
// výsledek a appka řekne „sedí" / „nesedí o 3 cm". Klíče vznikly TÝMŽ postupem,
// jaký používá Kalkulačka (scratchpad gen_ulohy.py je port jejích funkcí), takže
// výsledek z Kalkulačky vždycky sedí — cvičí se ruční výpočet, ne hádání.
//
// CO SE UKLÁDÁ: jen stav úloh (agUlohy_v1: id → 'ok' | počet neúspěšných pokusů).
// Řešení se ukáže až po dvou neúspěšných pokusech, ať to nesvádí k opisování.
//
// Přidání úlohy: řádek do data/ulohy.json (id, typ = id nástroje v Kalkulačce,
// zadani (HTML), vstupy (id polí Kalkulačky → hodnota; '_pg-rows' / '_nv-rows'
// jsou řádky dávky), odpovedi [{k, l, v, tol}]). Odstranění: smaž js/cvicne-ulohy.js,
// data/ulohy.json, řádek <script> v index.html, záznam 'cvicne-ulohy'
// v js/tools-registry.js a text v data/navody.json; přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGUlohy) return;

    var ID = 'ag-ul-modal', STYLE_ID = 'ag-ul-style', LS = 'agUlohy_v1', SRC = 'data/ulohy.json';
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 4h12l4 4v12H4z"/><path d="M8 13l2.5 2.5L16 10"/></svg>';
    var TYPY = { smer: 'Směrník a délka', rajon: 'Rajón', orto: 'Ortogonální metoda', protuhel: 'Protínání vpřed z úhlů', protdelka: 'Protínání z délek', polygon: 'Polygonový pořad', nivel: 'Nivelace' };
    var HVEZDY = ['', '★', '★★', '★★★', '★★★★'];

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'cvicne-ulohy:' + kde); } catch (x) { } }
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function stav() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
    function ulozStav(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { swallow(e, 'ls'); } }
    function cislo(v) { if (v == null) return null; var s = String(v).trim().replace(/\s+/g, '').replace(',', '.'); if (!s) return null; var n = +s; return isFinite(n) ? n : null; }
    function fmt(v) { return String(v).replace('.', ','); }

    var _data = null, _open = null;   // _open = id rozbalené úlohy

    function nacti(cb) {
        if (_data) { cb(_data); return; }
        fetch(SRC, { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
            _data = (j && j.ulohy) || []; cb(_data);
        }).catch(function (e) { swallow(e, 'fetch'); cb([]); });
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style'); st.id = STYLE_ID;
        st.textContent = [
            '#' + ID + ' .ul-sum{display:flex;align-items:center;gap:10px;margin:0 0 10px;font-size:calc(13px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);}',
            '#' + ID + ' .ul-bar{flex:1;height:6px;border-radius:3px;background:var(--glass-border,rgba(255,255,255,.12));overflow:hidden;}',
            '#' + ID + ' .ul-bar i{display:block;height:100%;background:var(--accent,#2f9e74);}',
            '#' + ID + ' .ul-h{font-size:calc(11.5px * var(--ag-font-scale,1));font-weight:700;text-transform:uppercase;letter-spacing:.04em;opacity:.55;margin:14px 0 4px;}',
            '#' + ID + ' .ul-row{display:flex;align-items:center;gap:10px;padding:10px 8px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,.08));cursor:pointer;}',
            '#' + ID + ' .ul-row.ok .ul-n{color:var(--accent,#2f9e74);}',
            '#' + ID + ' .ul-n{flex:1;font-size:calc(14px * var(--ag-font-scale,1));}',
            '#' + ID + ' .ul-st{font-size:calc(11px * var(--ag-font-scale,1));color:var(--warning,#fbbf24);letter-spacing:-1px;}',
            '#' + ID + ' .ul-ok{color:var(--accent,#2f9e74);font-weight:700;}',
            '#' + ID + ' .ul-zad{font-size:calc(14px * var(--ag-font-scale,1));line-height:1.5;margin:4px 0 10px;}',
            '#' + ID + ' .ul-ans{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
            '#' + ID + ' .ul-ans label{display:block;font-size:calc(12px * var(--ag-font-scale,1));margin:0;}',
            '#' + ID + ' .ul-ans input{width:100%;box-sizing:border-box;margin-top:3px;}',
            '#' + ID + ' .ul-ans .bad input{border-color:var(--danger,#fb7185);}',
            '#' + ID + ' .ul-ans .good input{border-color:var(--accent,#2f9e74);}',
            '#' + ID + ' .ul-res{margin-top:10px;padding:10px 12px;border-radius:10px;font-size:calc(13px * var(--ag-font-scale,1));line-height:1.45;}',
            '#' + ID + ' .ul-res.ok{background:rgba(47,158,116,0.16);}',
            '#' + ID + ' .ul-res.bad{background:rgba(251,113,133,0.16);}',
            '#' + ID + ' .ul-btns{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}',
            '#' + ID + ' .ul-btns .btn{flex:1 1 45%;margin:0;}',
            '#' + ID + ' .ul-klic{margin-top:8px;font-family:var(--font-mono,ui-monospace,monospace);font-size:calc(12.5px * var(--ag-font-scale,1));}'
        ].join('\n');
        document.head.appendChild(st);
    }
    function build() {
        var m = document.getElementById(ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = ID;
        m.innerHTML = '<div class="modal-content">'
            + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;"><button id="ag-ul-back" class="btn btn-secondary" style="display:none;margin:0;padding:8px 14px;width:auto;flex:0 0 auto;">‹ ' + t('Zpět') + '</button>'
            + '<h3 style="color:var(--accent);margin:0;flex:1;display:flex;align-items:center;gap:8px;"><span style="width:22px;height:22px;display:inline-block;">' + ICON + '</span> <span id="ag-ul-title">' + t('Cvičné úlohy') + '</span></h3></div>'
            + '<div class="modal-body" id="ag-ul-body"></div>'
            + '<button type="button" class="btn btn-secondary" id="ag-ul-close" style="margin-top:14px;">' + t('Zavřít') + '</button>'
            + '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-ul-close').addEventListener('click', close);
        m.querySelector('#ag-ul-back').addEventListener('click', function () { _open = null; render(); });
        m.addEventListener('click', onClick);
        return m;
    }

    // ---- seznam -------------------------------------------------------------------------------
    function renderSeznam(body) {
        var s = stav(), n = 0;
        _data.forEach(function (u) { if (s[u.id] === 'ok') n++; });
        var html = '<div class="ul-sum"><span><b>' + n + ' / ' + _data.length + '</b> ' + t('vyřešeno') + '</span><span class="ul-bar"><i style="width:' + (_data.length ? Math.round(100 * n / _data.length) : 0) + '%"></i></span></div>'
            + '<p style="margin:0 0 6px;font-size:calc(12.5px * var(--ag-font-scale,1));opacity:.75;">' + t('Spočítej ručně nebo v Kalkulačce, zapiš výsledek a nech si ho zkontrolovat. Souřadnice v S-JTSK (kladné Y, X), úhly v gonech.') + '</p>';
        var typy = [];
        _data.forEach(function (u) { if (typy.indexOf(u.typ) === -1) typy.push(u.typ); });
        typy.forEach(function (ty) {
            html += '<div class="ul-h">' + esc(t(TYPY[ty] || ty)) + '</div>';
            _data.filter(function (u) { return u.typ === ty; }).forEach(function (u, i) {
                var ok = s[u.id] === 'ok';
                html += '<div class="ul-row' + (ok ? ' ok' : '') + '" data-ul="' + esc(u.id) + '"><span class="ul-n">' + esc(t(TYPY[ty] || ty)) + ' ' + (i + 1) + '</span>'
                    + '<span class="ul-st">' + HVEZDY[u.obtiznost || 1] + '</span>' + (ok ? '<span class="ul-ok">✓</span>' : '<span style="opacity:.5;">›</span>') + '</div>';
            });
        });
        body.innerHTML = html;
    }
    // ---- detail úlohy ---------------------------------------------------------------------------
    function renderUloha(body, u) {
        var s = stav(); var st = s[u.id];
        var html = '<div class="ul-zad">' + u.zadani + '</div><div class="ul-ans">';
        u.odpovedi.forEach(function (o) {
            html += '<label>' + o.l + '<input type="text" inputmode="decimal" autocomplete="off" data-k="' + esc(o.k) + '" placeholder="?"></label>';
        });
        html += '</div><div id="ag-ul-res"></div>'
            + '<div class="ul-btns"><button type="button" class="btn btn-primary" data-act="check">' + t('Zkontrolovat') + '</button>'
            + '<button type="button" class="btn btn-secondary" data-act="calc">' + t('Otevřít v Kalkulačce s údaji') + '</button>'
            + ((st === 'ok' || (typeof st === 'number' && st >= 2)) ? '<button type="button" class="btn btn-secondary" data-act="klic">' + t('Ukázat řešení') + '</button>' : '')
            + '</div>';
        body.innerHTML = html;
    }
    function render() {
        var body = document.getElementById('ag-ul-body'); if (!body) return;
        var back = document.getElementById('ag-ul-back'), title = document.getElementById('ag-ul-title');
        var u = _open && _data.filter(function (x) { return x.id === _open; })[0];
        if (u) { back.style.display = 'block'; title.textContent = t(TYPY[u.typ] || u.typ) + ' ' + HVEZDY[u.obtiznost || 1]; renderUloha(body, u); }
        else { back.style.display = 'none'; title.textContent = t('Cvičné úlohy'); renderSeznam(body); }
    }

    // ---- kontrola -------------------------------------------------------------------------------
    function zkontroluj(u) {
        var res = document.getElementById('ag-ul-res'); if (!res) return;
        var vse = true, prazdne = false, radky = [];
        u.odpovedi.forEach(function (o) {
            var inp = document.querySelector('#' + ID + ' input[data-k="' + o.k + '"]'); if (!inp) return;
            var v = cislo(inp.value), lab = inp.parentNode;
            lab.classList.remove('bad', 'good');
            if (v == null) { prazdne = true; vse = false; return; }
            var diff = v - o.v, ok = Math.abs(diff) <= o.tol;
            lab.classList.add(ok ? 'good' : 'bad');
            if (!ok) { vse = false; radky.push(o.l + ': ' + t('nesedí o') + ' ' + fmt(Math.abs(diff).toFixed(diff % 1 === 0 ? 0 : 3)) + (diff > 0 ? ' (' + t('máš víc') + ')' : ' (' + t('máš míň') + ')')); }
        });
        if (prazdne && !radky.length) { res.className = 'ul-res bad'; res.innerHTML = t('Vyplň všechny odpovědi.'); return; }
        var s = stav();
        if (vse) {
            s[u.id] = 'ok'; ulozStav(s);
            res.className = 'ul-res ok'; res.innerHTML = '<b>' + t('Sedí.') + '</b> ' + t('Všechny hodnoty jsou v toleranci.');
            try { if (typeof quickToast === 'function') quickToast(t('Úloha vyřešena') + ' ✓'); } catch (e) { swallow(e, 'toast'); }
        } else {
            var n = (typeof s[u.id] === 'number' ? s[u.id] : 0) + 1; if (s[u.id] !== 'ok') { s[u.id] = n; ulozStav(s); }
            res.className = 'ul-res bad';
            res.innerHTML = '<b>' + t('Nesedí.') + '</b><br>' + radky.join('<br>') + (n >= 2 && s[u.id] !== 'ok' ? '<br><small>' + t('Po dvou pokusech jde ukázat řešení — tlačítko níž.') + '</small>' : '');
            if (n >= 2) { var b = document.querySelector('#' + ID + ' .ul-btns'); if (b && !b.querySelector('[data-act=klic]')) b.insertAdjacentHTML('beforeend', '<button type="button" class="btn btn-secondary" data-act="klic">' + t('Ukázat řešení') + '</button>'); }
        }
    }
    function ukazKlic(u) {
        var res = document.getElementById('ag-ul-res'); if (!res) return;
        res.className = 'ul-res';
        res.innerHTML = '<b>' + t('Řešení') + '</b><div class="ul-klic">' + u.odpovedi.map(function (o) { return o.l + ' = ' + fmt(o.v); }).join('<br>') + '</div>'
            + '<small>' + t('Postup výpočtu krok za krokem ukáže Kalkulačka („Otevřít v Kalkulačce s údaji").') + '</small>';
    }
    // ---- předvyplnění Kalkulačky ----------------------------------------------------------------
    function doKalkulacky(u) {
        if (typeof window.openCalcModal !== 'function' || typeof window.showCalcTool !== 'function') return;
        close();
        window.openCalcModal(); window.showCalcTool(u.typ);
        var v = u.vstupy || {};
        try {
            if (v['_pg-rows'] && typeof window.addPgRow === 'function') {
                while (document.querySelectorAll('#pg-rows > div').length < v['_pg-rows'].length) window.addPgRow();
                var rows = document.querySelectorAll('#pg-rows > div');
                v['_pg-rows'].forEach(function (r, i) {
                    var idx = rows[i].id.replace('pg-row-', '');
                    set('pg-rd' + idx, r.d); set('pg-rw' + idx, r.w); set('pg-rn' + idx, r.n);
                });
            }
            if (v['_nv-rows'] && typeof window.addNvRow === 'function') {
                while (document.querySelectorAll('#nv-rows > div').length < v['_nv-rows'].length) window.addNvRow();
                var nrows = document.querySelectorAll('#nv-rows > div');
                v['_nv-rows'].forEach(function (r, i) { var idx = nrows[i].id.replace('nv-row-', ''); set('nv-b' + idx, r.b); set('nv-f' + idx, r.f); });
            }
            Object.keys(v).forEach(function (k) {
                if (k.charAt(0) === '_') return;
                if (k === 'pd-side') { var rad = document.querySelector('input[name="pd-side"][value="' + v[k] + '"]'); if (rad) rad.checked = true; return; }
                set(k, v[k]);
            });
        } catch (e) { swallow(e, 'prefill'); }
        function set(id, val) { var el = document.getElementById(id); if (el) el.value = String(val); }
    }

    function onClick(e) {
        var row = e.target.closest('.ul-row[data-ul]');
        if (row) { _open = row.getAttribute('data-ul'); render(); return; }
        var b = e.target.closest('button[data-act]'); if (!b) return;
        var u = _open && _data.filter(function (x) { return x.id === _open; })[0]; if (!u) return;
        var act = b.getAttribute('data-act');
        if (act === 'check') zkontroluj(u);
        else if (act === 'calc') doKalkulacky(u);
        else if (act === 'klic') ukazKlic(u);
    }
    function open(id) {
        var m = build(); m.style.display = 'flex';
        document.getElementById('ag-ul-body').innerHTML = '<p style="opacity:.7;">' + t('Načítám úlohy…') + '</p>';
        nacti(function () { _open = id || null; render(); });
    }
    function close() { var m = document.getElementById(ID); if (m) m.style.display = 'none'; }

    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'cvicne-ulohy', label: t('Cvičné úlohy'), icon: ICON, cat: 'Pomůcky', onClick: function () { open(); }, order: 4 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });

    window.agOpenCvicneUlohy = open;
    window.AGUlohy = { open: open, close: close, stav: stav };
})();
