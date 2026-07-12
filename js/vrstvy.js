// ===== AR Geodet — VRSTVY / POKLÁDKA: skladby vozovky + kalkulátor odsazení =====
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu field-tools modulů: NEEDITUJE
// logika.js ani grafika.js.
//
// Pro geodeta na pokládce (finisher s 3D nivelací):
//   1) SKLADBY — pro každou stavbu/úsek si uložíš vrstvy konstrukce vozovky
//      shora dolů (název, tloušťka po zhutnění, % nadvýšení na hutnění).
//   2) KALKULÁTOR — zvolíš, které vrstvě odpovídá model v kontroleru (horní
//      plocha) a kterou vrstvu pokládáš. Appka sečte tloušťky mezi nimi
//      (odsazení nahoru/dolů) + nadvýšení na hutnění pokládané vrstvy
//      a ukáže hodnotu, kterou nastavíš do tabletu.
//
// Nadvýšení = tloušťka × % / 100. Výchozí procenta jsou ORIENTAČNÍ — vždy
// uprav podle zhutňovací zkoušky / zkušenosti party.
//
// Vše v localStorage (agVrstvy_v1), funguje offline, žádná GPS.
// Odstranění: smaž js/vrstvy.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var KEY = 'agVrstvy_v1';
    var MODAL_ID = 'vrstvy-modal';
    var STYLE_ID = 'ag-vr-style';
    var ICON = '<svg class="icon"><use href="#i-layers"/></svg>';

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function num(v, def) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : def; }
    function fmt(n) { return (Math.round(n * 10) / 10).toFixed(1).replace('.', ','); }

    // ---- data ----------------------------------------------------------------
    // { skladby: [{id, name, layers:[{n, t, p}]}], sel: {sk, ref, lay} }
    // layers SHORA dolů; t = projektová tloušťka po zhutnění (cm); p = % nadvýšení.
    var D = null;

    function load() {
        try { var v = JSON.parse(localStorage.getItem(KEY)); if (v && Array.isArray(v.skladby)) { D = v; return; } } catch (e) {}
        // první spuštění: ukázková skladba, ať je vidět princip
        D = {
            skladby: [{
                id: 's' + Date.now(),
                name: 'Ukázka — uprav podle stavby',
                layers: [
                    { n: 'ACO 11 (obrusná)', t: 4, p: 20 },
                    { n: 'ACL 16 (ložná)', t: 6, p: 20 },
                    { n: 'ACP 16 (podkladní)', t: 8, p: 20 },
                    { n: 'MZK', t: 20, p: 25 },
                    { n: 'ŠD', t: 25, p: 25 }
                ]
            }],
            sel: { sk: 0, ref: 2, lay: 1 }
        };
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) {} }
    function skladba() { if (!D.skladby.length) return null; D.sel.sk = Math.min(Math.max(0, D.sel.sk | 0), D.skladby.length - 1); return D.skladby[D.sel.sk]; }

    // ---- styly ---------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + MODAL_ID + ' .vr-skrow{display:flex;gap:8px;align-items:center;margin-bottom:10px;}',
            '#' + MODAL_ID + ' .vr-skrow select{flex:1;min-width:0;margin:0;}',
            '#' + MODAL_ID + ' .vr-ico{flex:0 0 auto;width:42px;height:40px;display:flex;align-items:center;justify-content:center;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.15));border-radius:var(--r-sm,8px);background:rgba(255,255,255,0.05);',
            '  color:var(--text-color,#e8edf2);cursor:pointer;}',
            '#' + MODAL_ID + ' .vr-ico.danger{color:var(--danger,#ef4444);border-color:rgba(239,68,68,0.4);}',
            '#' + MODAL_ID + ' .vr-ico svg{width:17px;height:17px;}',
            '#' + MODAL_ID + ' .vr-head{display:grid;grid-template-columns:1fr 62px 62px 88px;gap:6px;margin:6px 0 4px;',
            '  font-size:10.5px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .vr-row{display:grid;grid-template-columns:1fr 62px 62px 88px;gap:6px;align-items:center;margin-bottom:6px;}',
            '#' + MODAL_ID + ' .vr-row input{margin:0;padding:9px 8px;min-width:0;}',
            '#' + MODAL_ID + ' .vr-btns{display:flex;gap:4px;}',
            '#' + MODAL_ID + ' .vr-btns button{flex:1;height:38px;border:1px solid var(--glass-border,rgba(255,255,255,0.15));',
            '  border-radius:var(--r-sm,8px);background:rgba(255,255,255,0.05);color:var(--text-color,#e8edf2);cursor:pointer;font-size:14px;line-height:1;}',
            '#' + MODAL_ID + ' .vr-btns button.vr-del{color:var(--danger,#ef4444);}',
            '#' + MODAL_ID + ' .vr-res{margin-top:12px;padding:14px;border-radius:var(--r-md,12px);border:1px solid var(--accent,#34d399);',
            '  background:rgba(47,158,116,0.10);}',
            '#' + MODAL_ID + ' .vr-res .vr-line{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:6px;color:var(--text-color,#e8edf2);}',
            '#' + MODAL_ID + ' .vr-res .vr-line span:last-child{font-family:var(--font-mono,monospace);white-space:nowrap;}',
            '#' + MODAL_ID + ' .vr-res .vr-total{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:8px;padding-top:10px;',
            '  border-top:1px solid var(--glass-border,rgba(255,255,255,0.15));font-weight:800;font-size:15px;}',
            '#' + MODAL_ID + ' .vr-res .vr-total b{font-family:var(--font-mono,monospace);font-size:22px;color:var(--accent,#34d399);white-space:nowrap;}',
            '#' + MODAL_ID + ' .vr-hint{margin-top:10px;font-size:12px;line-height:1.45;color:var(--text-muted,#9aa1ac);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- modal ----------------------------------------------------------------
    function ensureModal() {
        if (document.getElementById(MODAL_ID)) return;
        injectStyles();
        var ov = document.createElement('div');
        ov.className = 'modal-overlay';
        ov.id = MODAL_ID;
        ov.innerHTML =
            '<div class="modal-content">' +
            '<h3 style="color: var(--accent); margin-top:0;">' + ICON + ' Vrstvy / pokládka</h3>' +
            '<p style="font-size:13px; margin-top:0; opacity:0.8;">Skladba vozovky shora dolů + kolik nastavit do tabletu, když model v kontroleru sedí na jiné vrstvě, než pokládáš.</p>' +
            '<div class="modal-body">' +
            '<label>Stavba / úsek</label>' +
            '<div class="vr-skrow">' +
            '<select id="vr-sk" class="st-sel"></select>' +
            '<button type="button" class="vr-ico" id="vr-sk-add" aria-label="Nová skladba"><svg class="icon"><use href="#i-plus"/></svg></button>' +
            '<button type="button" class="vr-ico danger" id="vr-sk-del" aria-label="Smazat skladbu"><svg class="icon"><use href="#i-trash"/></svg></button>' +
            '</div>' +
            '<input type="text" id="vr-sk-name" placeholder="Název stavby / úseku (např. D35 Ostrov, km 3,2–5,6)">' +
            '<div class="vr-head"><span>Vrstva (shora dolů)</span><span>tl. cm</span><span>hutn. %</span><span></span></div>' +
            '<div id="vr-layers"></div>' +
            '<button class="btn btn-secondary" id="vr-add" style="margin-top:4px; padding:10px;"><svg class="icon"><use href="#i-plus"/></svg> Přidat vrstvu (dospod)</button>' +
            '<hr style="border-color: var(--glass-border); width: 100%; margin: 16px 0;">' +
            '<label>Model v kontroleru = horní plocha vrstvy</label>' +
            '<select id="vr-ref" class="st-sel"></select>' +
            '<label style="margin-top:10px;">Pokládám vrstvu</label>' +
            '<select id="vr-lay" class="st-sel"></select>' +
            '<div class="vr-res" id="vr-res"></div>' +
            '<div class="vr-hint">Nadvýšení na hutnění je orientační (tloušťka × %). Běžně: asfaltové vrstvy ~15–25 %, MZK/ŠD ~20–30 %, beton ~0 %. Uprav podle zhutňovací zkoušky nebo zkušenosti.</div>' +
            '</div>' +
            '<button class="btn btn-secondary" style="margin-top:12px;" id="vr-close">Zavřít</button>' +
            '</div>';
        document.body.appendChild(ov);

        document.getElementById('vr-close').addEventListener('click', closeModal);
        document.getElementById('vr-sk').addEventListener('change', function () { D.sel.sk = this.selectedIndex; D.sel.ref = 0; D.sel.lay = 0; save(); renderAll(); });
        document.getElementById('vr-sk-name').addEventListener('input', function () { var s = skladba(); if (s) { s.name = this.value; save(); renderSkladbaSelect(); } });
        document.getElementById('vr-sk-add').addEventListener('click', function () {
            D.skladby.push({ id: 's' + Date.now(), name: 'Nová stavba', layers: [{ n: 'Nová vrstva', t: 5, p: 20 }] });
            D.sel = { sk: D.skladby.length - 1, ref: 0, lay: 0 };
            save(); renderAll();
        });
        document.getElementById('vr-sk-del').addEventListener('click', function () {
            var s = skladba(); if (!s) return;
            var ok = true;
            try { ok = confirm('Smazat skladbu „' + s.name + '" včetně vrstev?'); } catch (e) {}
            if (!ok) return;
            D.skladby.splice(D.sel.sk, 1);
            D.sel = { sk: 0, ref: 0, lay: 0 };
            save(); renderAll();
        });
        document.getElementById('vr-add').addEventListener('click', function () {
            var s = skladba(); if (!s) return;
            s.layers.push({ n: 'Nová vrstva', t: 5, p: 20 });
            save(); renderAll();
        });
        document.getElementById('vr-ref').addEventListener('change', function () { D.sel.ref = this.selectedIndex; save(); renderCalc(); });
        document.getElementById('vr-lay').addEventListener('change', function () { D.sel.lay = this.selectedIndex; save(); renderCalc(); });
    }

    function renderSkladbaSelect() {
        var sel = document.getElementById('vr-sk');
        if (!sel) return;
        sel.innerHTML = '';
        D.skladby.forEach(function (s) {
            var o = document.createElement('option');
            o.textContent = s.name || '(bez názvu)';
            sel.appendChild(o);
        });
        sel.selectedIndex = Math.min(D.sel.sk, D.skladby.length - 1);
    }

    function renderLayers() {
        var box = document.getElementById('vr-layers');
        if (!box) return;
        box.innerHTML = '';
        var s = skladba();
        if (!s) return;
        s.layers.forEach(function (L, i) {
            var row = document.createElement('div');
            row.className = 'vr-row';

            var inN = document.createElement('input');
            inN.type = 'text'; inN.value = L.n; inN.placeholder = 'např. ACL 16';
            inN.addEventListener('input', function () { L.n = inN.value; save(); renderSelects(); renderCalc(); });

            var inT = document.createElement('input');
            inT.type = 'number'; inT.step = '0.5'; inT.min = '0'; inT.inputMode = 'decimal'; inT.value = L.t;
            inT.addEventListener('input', function () { L.t = num(inT.value, 0); save(); renderSelects(); renderCalc(); });

            var inP = document.createElement('input');
            inP.type = 'number'; inP.step = '1'; inP.min = '0'; inP.inputMode = 'numeric'; inP.value = L.p;
            inP.addEventListener('input', function () { L.p = num(inP.value, 0); save(); renderCalc(); });

            var btns = document.createElement('div');
            btns.className = 'vr-btns';
            var up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.disabled = (i === 0);
            up.addEventListener('click', function () { s.layers.splice(i - 1, 0, s.layers.splice(i, 1)[0]); save(); renderAll(); });
            var dn = document.createElement('button'); dn.type = 'button'; dn.textContent = '↓'; dn.disabled = (i === s.layers.length - 1);
            dn.addEventListener('click', function () { s.layers.splice(i + 1, 0, s.layers.splice(i, 1)[0]); save(); renderAll(); });
            var del = document.createElement('button'); del.type = 'button'; del.className = 'vr-del'; del.textContent = '✕';
            del.addEventListener('click', function () { s.layers.splice(i, 1); save(); renderAll(); });
            btns.appendChild(up); btns.appendChild(dn); btns.appendChild(del);

            row.appendChild(inN); row.appendChild(inT); row.appendChild(inP); row.appendChild(btns);
            box.appendChild(row);
        });
        var nameInp = document.getElementById('vr-sk-name');
        if (nameInp) nameInp.value = s.name || '';
    }

    function renderSelects() {
        var s = skladba();
        ['vr-ref', 'vr-lay'].forEach(function (id) {
            var sel = document.getElementById(id);
            if (!sel) return;
            sel.innerHTML = '';
            if (!s) return;
            s.layers.forEach(function (L, i) {
                var o = document.createElement('option');
                o.textContent = (i + 1) + '. ' + (L.n || '(vrstva)') + ' — ' + fmt(L.t) + ' cm';
                sel.appendChild(o);
            });
        });
        if (s) {
            D.sel.ref = Math.min(Math.max(0, D.sel.ref | 0), s.layers.length - 1);
            D.sel.lay = Math.min(Math.max(0, D.sel.lay | 0), s.layers.length - 1);
            var r = document.getElementById('vr-ref'); if (r) r.selectedIndex = D.sel.ref;
            var l = document.getElementById('vr-lay'); if (l) l.selectedIndex = D.sel.lay;
        }
    }

    // Hloubka horní plochy vrstvy i od horní plochy celé skladby (cm, kladně dolů).
    function depthOfTop(layers, i) {
        var d = 0;
        for (var k = 0; k < i; k++) d += num(layers[k].t, 0);
        return d;
    }

    function renderCalc() {
        var box = document.getElementById('vr-res');
        if (!box) return;
        var s = skladba();
        if (!s || !s.layers.length) { box.innerHTML = '<div class="vr-line"><span>Přidej vrstvy skladby.</span></div>'; return; }
        var ref = Math.min(D.sel.ref, s.layers.length - 1);
        var lay = Math.min(D.sel.lay, s.layers.length - 1);
        var L = s.layers[lay];

        // odsazení horní plochy pokládané vrstvy vůči modelu (+ nahoru, − dolů)
        var offset = depthOfTop(s.layers, ref) - depthOfTop(s.layers, lay);
        // nadvýšení na hutnění pokládané vrstvy
        var extra = num(L.t, 0) * num(L.p, 0) / 100;
        var total = offset + extra;

        var dir = offset > 0 ? 'nahoru' : (offset < 0 ? 'dolů' : 'stejná plocha');
        var sign = function (v) { return (v > 0 ? '+' : (v < 0 ? '−' : '±')) + fmt(Math.abs(v)); };

        box.innerHTML =
            '<div class="vr-line"><span>Odsazení od modelu (' + dir + ')</span><span>' + sign(offset) + ' cm</span></div>' +
            '<div class="vr-line"><span>Nadvýšení na hutnění (' + fmt(num(L.p, 0)) + ' % z ' + fmt(num(L.t, 0)) + ' cm)</span><span>' + sign(extra) + ' cm</span></div>' +
            '<div class="vr-total"><span>Do tabletu</span><b>' + sign(total) + ' cm</b></div>';
    }

    function renderAll() { renderSkladbaSelect(); renderLayers(); renderSelects(); renderCalc(); }

    function openModal() {
        if (!D) load();
        ensureModal();
        renderAll();
        document.getElementById(MODAL_ID).style.display = 'flex';
    }
    function closeModal() {
        var ov = document.getElementById(MODAL_ID);
        if (ov) ov.style.display = 'none';
        try { if (typeof fixAppLayout === 'function') fixAppLayout(); } catch (e) {}
    }

    window.agOpenVrstvy = openModal;

    // ---- vstup: dlaždice v Nástrojích ------------------------------------------
    function register() {
        if (typeof window.agRegisterFieldTool !== 'function') return;
        window.agRegisterFieldTool({ id: 'vrstvy', label: 'Vrstvy / pokládka', icon: ICON, onClick: openModal, order: 7 });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
