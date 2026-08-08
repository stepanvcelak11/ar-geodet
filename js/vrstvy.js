// ===== AR Geodet — VRSTVY / POKLÁDKA: skladby vozovky + kalkulátor odsazení =====
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu field-tools modulů: NEEDITUJE
// logika.js ani grafika.js.
//
// Pro geodeta na pokládce (finisher s 3D nivelací):
//   1) DO TABLETU (nahoře) — zvolíš, které vrstvě odpovídá model v kontroleru
//      (horní plocha) a kterou vrstvu pokládáš. Appka sečte tloušťky mezi nimi
//      (odsazení nahoru/dolů) + nadvýšení na hutnění pokládané vrstvy.
//   2) ŘEZ SKLADBOU — vrstvy v příčném řezu (sklon jednostranný i střechovitý,
//      převýšeno; tenké vrstvy zvětšené pro čitelnost). Tažením čáry mezi
//      vrstvami se mění tloušťka. Značky MODEL a POKLÁDÁM.
//   3) TABULKA VRSTEV — název, tloušťka po zhutnění, % nadvýšení na hutnění.
//      Vrstvy jde přidat z KATALOGU (řazen podle použití shora dolů) i vlastní.
//   4) SLOVNÍČEK — jak číst zkratky (ACO/ACL/ACP, SMA…) — sbalený dole.
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

    // ---- katalog vrstev — ŘAZENO PODLE POUŽITÍ ve vozovce (shora dolů) ---------
    // c = zkratka, nm = co to je česky, d = k čemu / čím se liší,
    // t = typická tloušťka (cm), p = % nadvýšení, g = skupina barvy (a/n/s).
    // U asfaltů: AC = asfaltový beton, třetí písmeno O/L/P = Obrusná/Ložná/
    // Podkladní, číslo = největší zrno kameniva v mm.
    var CATALOG = [
        { sec: 'Obrusné vrstvy — úplně nahoře, po nich se jezdí' },
        { c: 'ACO 11', nm: 'Asfaltový beton — Obrusná, zrno do 11 mm', d: 'Nejběžnější vrchní vrstva běžných silnic.', t: 4, p: 20, g: 'a' },
        { c: 'ACO 8',  nm: 'Asfaltový beton — Obrusná, zrno do 8 mm',  d: 'Jemnější směs pro tenčí vrstvy a méně zatížené cesty.', t: 3, p: 20, g: 'a' },
        { c: 'ACO 16', nm: 'Asfaltový beton — Obrusná, zrno do 16 mm', d: 'Hrubší obrusná, kde se tolik nehledí na hlučnost.', t: 5, p: 20, g: 'a' },
        { c: 'SMA 11', nm: 'Mastixový koberec (Stone Mastic Asphalt), zrno do 11 mm', d: 'Odolnější než ACO — víc hrubého kameniva. Dálnice a těžká doprava.', t: 4, p: 20, g: 'a' },
        { c: 'SMA 8',  nm: 'Mastixový koberec (Stone Mastic Asphalt), zrno do 8 mm', d: 'Tenčí varianta SMA.', t: 3, p: 20, g: 'a' },
        { c: 'BBTM',   nm: 'Velmi tenká obrusná vrstva', d: 'Jen 2–3 cm — hlavně rychlé opravy povrchu.', t: 2.5, p: 20, g: 'a' },
        { c: 'PA 8',   nm: 'Drenážní (porézní) koberec', d: 'Propouští vodu skrz — méně odstřiku, tišší jízda.', t: 4, p: 20, g: 'a' },
        { c: 'MA 11',  nm: 'Litý asfalt', d: 'Lije se a NEhutní válci → nadvýšení 0 %. Mosty, chodníky.', t: 3.5, p: 0, g: 'a' },
        { sec: 'Ložná vrstva — prostřední asfaltová' },
        { c: 'ACL 16', nm: 'Asfaltový beton — Ložná, zrno do 16 mm', d: 'Mezi obrusnou a podkladní; roznáší zatížení od kol.', t: 6, p: 20, g: 'a' },
        { c: 'ACL 22', nm: 'Asfaltový beton — Ložná, zrno do 22 mm', d: 'Silnější ložná s hrubším kamenivem.', t: 7, p: 20, g: 'a' },
        { sec: 'Podkladní asfalt — spodní asfaltová' },
        { c: 'ACP 16', nm: 'Asfaltový beton — Podkladní, zrno do 16 mm', d: 'První asfalt na štěrkovém/stmeleném podkladu.', t: 7, p: 20, g: 'a' },
        { c: 'ACP 22', nm: 'Asfaltový beton — Podkladní, zrno do 22 mm', d: 'Silnější podkladní asfalt pro dálnice.', t: 9, p: 20, g: 'a' },
        { sec: 'Nestmelené podklady — štěrky' },
        { c: 'MZK', nm: 'Mechanicky zpevněné kamenivo', d: 'Horní podkladní vrstva z drceného kameniva, hutní se po vrstvách.', t: 20, p: 25, g: 'n' },
        { c: 'ŠD',  nm: 'Štěrkodrť', d: 'Podkladní/ochranná vrstva z drceného kameniva.', t: 20, p: 25, g: 'n' },
        { c: 'ŠP',  nm: 'Štěrkopísek', d: 'Ochranná vrstva — mrazová ochrana a odvodnění.', t: 15, p: 25, g: 'n' },
        { c: 'VŠ',  nm: 'Vibrovaný štěrk', d: 'Nestmelený podklad hutněný vibrací.', t: 15, p: 25, g: 'n' },
        { c: 'MZ',  nm: 'Mechanicky zpevněná zemina', d: 'Zlepšená zemina úplně dole (aktivní zóna).', t: 30, p: 25, g: 'n' },
        { sec: 'Stmelené podklady a beton' },
        { c: 'SC C8/10', nm: 'Stabilizace cementem', d: 'Zemina/kamenivo promíchané s cementem — tuhý podklad.', t: 15, p: 10, g: 's' },
        { c: 'KSC I', nm: 'Kamenivo zpevněné cementem', d: 'Stmelená podkladní vrstva pod asfalt či beton.', t: 15, p: 10, g: 's' },
        { c: 'CB', nm: 'Cementobetonový kryt', d: 'Betonová deska (dálnice, letiště) — pokládá se na hotovo, 0 %.', t: 22, p: 0, g: 's' },
        { c: 'PM', nm: 'Penetrační makadam', d: 'Kamenivo prolité asfaltem — starší technologie oprav.', t: 10, p: 20, g: 's' }
    ];
    var GRP_COLOR = { a: '#31353d', n: '#8b7c5c', s: '#6f7f8c' };
    var GRP_TEXT = { a: '#f2f4f7', n: '#16181c', s: '#16181c' };
    function guessGroup(name) {
        var n = String(name || '').toUpperCase();
        if (/ACO|ACL|ACP|SMA|BBTM|^PA|LITÝ|MA\s?\d|ASFALT/.test(n)) return 'a';
        if (/MZK|ŠD|SD\b|ŠP|SP\b|MZ\b|VŠ|VS\b|ŠTĚRK|STERK|KAMENIVO/.test(n)) return 'n';
        if (/SC|KSC|CB|BETON|STABIL|PM/.test(n)) return 's';
        return 'a';
    }

    // ---- data ----------------------------------------------------------------
    // { skladby: [{id, name, slope, roof, layers:[{n, t, p, g}]}], sel: {sk, ref, lay} }
    // layers SHORA dolů; t = projektová tloušťka po zhutnění (cm); p = % nadvýšení.
    var D = null;

    function load() {
        try { var v = JSON.parse(localStorage.getItem(KEY)); if (v && Array.isArray(v.skladby)) { D = v; return; } } catch (e) {}
        // první spuštění: ukázková skladba, ať je vidět princip
        D = {
            skladby: [{
                id: 's' + Date.now(),
                name: 'Ukázka — uprav podle stavby',
                slope: 2.5,
                roof: false,
                layers: [
                    { n: 'ACO 11', t: 4, p: 20, g: 'a' },
                    { n: 'ACL 16', t: 6, p: 20, g: 'a' },
                    { n: 'ACP 16', t: 8, p: 20, g: 'a' },
                    { n: 'MZK', t: 20, p: 25, g: 'n' },
                    { n: 'ŠD', t: 25, p: 25, g: 'n' }
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
            '#' + MODAL_ID + ' .vr-ico.danger{color:var(--danger,#fb7185);border-color:rgba(239,68,68,0.4);}',
            '#' + MODAL_ID + ' .vr-ico svg{width:17px;height:17px;}',
            // výsledek NAHOŘE
            '#' + MODAL_ID + ' .vr-res{margin:2px 0 12px;padding:14px;border-radius:var(--r-md,12px);border:1px solid var(--accent,#2f9e74);',
            '  background:rgba(47,158,116,0.10);}',
            '#' + MODAL_ID + ' .vr-res .vr-total{display:flex;justify-content:space-between;align-items:center;gap:10px;font-weight:800;font-size:calc(15px * var(--ag-font-scale, 1));}',
            '#' + MODAL_ID + ' .vr-res .vr-total b{font-family:var(--font-mono,monospace);font-size:calc(24px * var(--ag-font-scale, 1));color:var(--accent,#2f9e74);white-space:nowrap;}',
            '#' + MODAL_ID + ' .vr-res .vr-line{display:flex;justify-content:space-between;gap:10px;font-size:calc(12.5px * var(--ag-font-scale, 1));margin-top:7px;color:var(--text-color,#e8edf2);opacity:0.85;}',
            '#' + MODAL_ID + ' .vr-res .vr-line span:last-child{font-family:var(--font-mono,monospace);white-space:nowrap;}',
            // řez
            '#' + MODAL_ID + ' .vr-sec{margin:10px 0 4px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));border-radius:var(--r-md,12px);',
            '  background:rgba(255,255,255,0.03);padding:8px 8px 4px;}',
            '#' + MODAL_ID + ' .vr-sec svg{display:block;width:100%;height:auto;touch-action:none;}',
            '#' + MODAL_ID + ' .vr-sec .vr-drag{cursor:ns-resize;}',
            '#' + MODAL_ID + ' .vr-secrow{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:6px 2px 8px;font-size:calc(12px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .vr-secrow input{width:60px;margin:0;padding:7px 8px;}',
            '#' + MODAL_ID + ' .vr-secrow select{width:auto;margin:0;padding:7px 8px;}',
            '#' + MODAL_ID + ' .vr-sechint{margin:0 2px 8px;font-size:calc(11.5px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);}',
            // tabulka vrstev
            '#' + MODAL_ID + ' .vr-head{display:grid;grid-template-columns:1fr 62px 62px 88px;gap:6px;margin:10px 0 4px;',
            '  font-size:calc(10.5px * var(--ag-font-scale, 1));text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .vr-row{display:grid;grid-template-columns:1fr 62px 62px 88px;gap:6px;align-items:center;margin-bottom:6px;}',
            '#' + MODAL_ID + ' .vr-row input{margin:0;padding:9px 8px;min-width:0;}',
            '#' + MODAL_ID + ' .vr-btns{display:flex;gap:4px;}',
            '#' + MODAL_ID + ' .vr-btns button{flex:1;height:38px;border:1px solid var(--glass-border,rgba(255,255,255,0.15));',
            '  border-radius:var(--r-sm,8px);background:rgba(255,255,255,0.05);color:var(--text-color,#e8edf2);cursor:pointer;font-size:calc(14px * var(--ag-font-scale, 1));line-height:1;}',
            '#' + MODAL_ID + ' .vr-btns button.vr-del{color:var(--danger,#fb7185);}',
            // katalog — řádky se zalamují, popis je vidět celý
            '#' + MODAL_ID + ' .vr-addrow{display:flex;gap:8px;margin-top:6px;}',
            '#' + MODAL_ID + ' .vr-addrow .btn{flex:1;margin:0;padding:10px;}',
            '#' + MODAL_ID + ' .vr-cat{display:none;margin-top:8px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));border-radius:var(--r-md,12px);overflow:hidden;}',
            '#' + MODAL_ID + ' .vr-cat.open{display:block;}',
            '#' + MODAL_ID + ' .vr-cat .vr-catsec{padding:9px 12px 5px;font-size:calc(10.5px * var(--ag-font-scale, 1));text-transform:uppercase;letter-spacing:0.06em;',
            '  color:var(--text-muted,#9aa1ac);background:rgba(255,255,255,0.03);border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.08));}',
            '#' + MODAL_ID + ' .vr-cat .vr-catrow{display:block;width:100%;padding:10px 12px;border:none;',
            '  border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.08));background:transparent;color:var(--text-color,#e8edf2);',
            '  text-align:left;cursor:pointer;font:inherit;}',
            '#' + MODAL_ID + ' .vr-cat .vr-catrow:last-child{border-bottom:none;}',
            '#' + MODAL_ID + ' .vr-cat .vr-catrow:active{background:rgba(255,255,255,0.06);}',
            '#' + MODAL_ID + ' .vr-cat .vr-r1{display:flex;align-items:baseline;gap:8px;}',
            '#' + MODAL_ID + ' .vr-cat .vr-r1 b{flex:0 0 auto;color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .vr-cat .vr-r1 span{flex:1;min-width:0;font-size:calc(12.5px * var(--ag-font-scale, 1));}',
            '#' + MODAL_ID + ' .vr-cat .vr-r1 small{flex:0 0 auto;font-family:var(--font-mono,monospace);font-size:calc(11.5px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .vr-cat .vr-r2{margin-top:3px;font-size:calc(11.5px * var(--ag-font-scale, 1));line-height:1.4;color:var(--text-muted,#9aa1ac);}',
            // slovníček
            '#' + MODAL_ID + ' .vr-dict p{margin:8px 0;font-size:calc(12.5px * var(--ag-font-scale, 1));line-height:1.5;color:var(--text-color,#e8edf2);}',
            '#' + MODAL_ID + ' .vr-dict b{color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .vr-hint{margin-top:10px;font-size:calc(12px * var(--ag-font-scale, 1));line-height:1.45;color:var(--text-muted,#9aa1ac);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- modal ----------------------------------------------------------------
    function ensureModal() {
        if (document.getElementById(MODAL_ID)) return;
        injectStyles();
        var dict = '<p>Jak číst zkratky asfaltů: <b>AC</b> = asfaltový beton, třetí písmeno <b>O/L/P</b> = Obrusná / Ložná / Podkladní vrstva, číslo = největší zrno kameniva v mm (ACO 11 = obrusný asfalt se zrnem do 11 mm). Vrstvy jdou shora: obrusná → ložná → podkladní asfalt → stmelený či štěrkový podklad → ochranná vrstva.</p>' +
            CATALOG.map(function (it) {
                if (it.sec) return '';
                return '<p><b>' + esc(it.c) + '</b> — ' + esc(it.nm) + '. ' + esc(it.d) + ' Typicky ' + fmt(it.t) + ' cm.</p>';
            }).join('');
        var ov = document.createElement('div');
        ov.className = 'modal-overlay';
        ov.id = MODAL_ID;
        ov.innerHTML =
            '<div class="modal-content">' +
            '<h3 style="color: var(--accent); margin-top:0;">' + ICON + ' Vrstvy / pokládka</h3>' +
            '<div class="modal-body">' +
            '<label>Stavba / úsek</label>' +
            '<div class="vr-skrow">' +
            '<select id="vr-sk" class="st-sel"></select>' +
            '<button type="button" class="vr-ico" id="vr-sk-add" aria-label="Nová skladba"><svg class="icon"><use href="#i-plus"/></svg></button>' +
            '<button type="button" class="vr-ico danger" id="vr-sk-del" aria-label="Smazat skladbu"><svg class="icon"><use href="#i-trash"/></svg></button>' +
            '</div>' +
            // VÝSLEDEK NAHOŘE
            '<div class="vr-res" id="vr-res"></div>' +
            '<label>Model v kontroleru = horní plocha vrstvy</label>' +
            '<select id="vr-ref" class="st-sel"></select>' +
            '<label style="margin-top:10px;">Pokládám vrstvu</label>' +
            '<select id="vr-lay" class="st-sel"></select>' +
            // ŘEZ
            '<div class="vr-sec"><div id="vr-svg"></div></div>' +
            '<div class="vr-secrow">' +
            '<span>Sklon</span><input type="number" id="vr-slope" step="0.5" inputmode="decimal"><span>%</span>' +
            '<select id="vr-prof" class="st-sel"><option value="jedno">jednostranný</option><option value="strecha">střechovitý</option></select>' +
            '</div>' +
            '<div class="vr-sechint">Tažením čáry mezi vrstvami změníš tloušťku. Sklon je jen náhled (převýšený); tenké vrstvy jsou v řezu zvětšené, ať jdou přečíst.</div>' +
            // TABULKA
            '<div class="vr-head"><span>Vrstva (shora dolů)</span><span>tl. cm</span><span>hutn. %</span><span></span></div>' +
            '<div id="vr-layers"></div>' +
            '<div class="vr-addrow">' +
            '<button type="button" class="btn btn-blue" id="vr-add-cat"><svg class="icon"><use href="#i-list"/></svg> Z katalogu</button>' +
            '<button type="button" class="btn btn-secondary" id="vr-add"><svg class="icon"><use href="#i-plus"/></svg> Vlastní vrstva</button>' +
            '</div>' +
            '<div class="vr-cat" id="vr-cat"></div>' +
            '<input type="text" id="vr-sk-name" style="margin-top:14px;" placeholder="Název stavby / úseku (např. D35 Ostrov, km 3,2–5,6)">' +
            '<details class="vr-dict" style="margin-top:12px;"><summary style="cursor:pointer; color:var(--text-muted); font-size:calc(13px * var(--ag-font-scale, 1)); padding:6px 0;">Co znamenají zkratky vrstev? (slovníček)</summary>' + dict + '</details>' +
            '<div class="vr-hint">Nadvýšení na hutnění je orientační (tloušťka × %). Běžně: asfaltové vrstvy ~15–25 %, MZK/ŠD ~20–30 %, litý asfalt a beton 0 %. Uprav podle zhutňovací zkoušky.</div>' +
            '</div>' +
            '<button class="btn btn-secondary" style="margin-top:12px;" id="vr-close">Zavřít</button>' +
            '</div>';
        document.body.appendChild(ov);

        document.getElementById('vr-close').addEventListener('click', closeModal);
        document.getElementById('vr-sk').addEventListener('change', function () { D.sel.sk = this.selectedIndex; D.sel.ref = 0; D.sel.lay = 0; save(); renderAll(); });
        document.getElementById('vr-sk-name').addEventListener('input', function () { var s = skladba(); if (s) { s.name = this.value; save(); renderSkladbaSelect(); } });
        document.getElementById('vr-sk-add').addEventListener('click', function () {
            D.skladby.push({ id: 's' + Date.now(), name: 'Nová stavba', slope: 2.5, roof: false, layers: [] });
            D.sel = { sk: D.skladby.length - 1, ref: 0, lay: 0 };
            save(); renderAll();
            var cat = document.getElementById('vr-cat'); if (cat) cat.classList.add('open');
        });
        document.getElementById('vr-sk-del').addEventListener('click', function () {
            var s = skladba(); if (!s) return;
            agAsk('Smazat skladbu „' + s.name + '" včetně vrstev?', { title: 'Smazat skladbu', okText: 'Smazat', danger: true }).then(function (ok) {
                if (!ok) return;
                D.skladby.splice(D.sel.sk, 1);
                D.sel = { sk: 0, ref: 0, lay: 0 };
                save(); renderAll();
            });
        });
        document.getElementById('vr-add').addEventListener('click', function () {
            var s = skladba(); if (!s) return;
            s.layers.push({ n: 'Nová vrstva', t: 5, p: 20, g: 'a' });
            save(); renderAll();
        });
        document.getElementById('vr-add-cat').addEventListener('click', function () {
            var cat = document.getElementById('vr-cat');
            if (cat) cat.classList.toggle('open');
        });
        document.getElementById('vr-slope').addEventListener('input', function () {
            var s = skladba(); if (!s) return;
            s.slope = num(this.value, 2.5); save(); renderSection();
        });
        document.getElementById('vr-prof').addEventListener('change', function () {
            var s = skladba(); if (!s) return;
            s.roof = (this.value === 'strecha'); save(); renderSection();
        });
        document.getElementById('vr-ref').addEventListener('change', function () { D.sel.ref = this.selectedIndex; save(); renderCalc(); renderSection(); });
        document.getElementById('vr-lay').addEventListener('change', function () { D.sel.lay = this.selectedIndex; save(); renderCalc(); renderSection(); });

        // tažení hranic v řezu drží dokument (viz renderSection)
        document.addEventListener('pointermove', vrDragMove, { passive: false });
        document.addEventListener('pointerup', vrDragEnd);
        document.addEventListener('pointercancel', vrDragEnd);

        renderCatalog();
    }

    function renderCatalog() {
        var box = document.getElementById('vr-cat');
        if (!box) return;
        box.innerHTML = '';
        CATALOG.forEach(function (it) {
            if (it.sec) {
                var h = document.createElement('div');
                h.className = 'vr-catsec';
                h.textContent = it.sec;
                box.appendChild(h);
                return;
            }
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'vr-catrow';
            b.innerHTML =
                '<div class="vr-r1"><b>' + esc(it.c) + '</b><span>' + esc(it.nm) + '</span><small>' + fmt(it.t) + ' cm</small></div>' +
                '<div class="vr-r2">' + esc(it.d) + '</div>';
            b.addEventListener('click', function () {
                var s = skladba(); if (!s) return;
                s.layers.push({ n: it.c, t: it.t, p: it.p, g: it.g });
                save(); renderAll();
            });
            box.appendChild(b);
        });
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
        var nameInp = document.getElementById('vr-sk-name');
        if (nameInp) nameInp.value = s ? (s.name || '') : '';
        var slopeInp = document.getElementById('vr-slope');
        if (slopeInp) slopeInp.value = s ? (s.slope != null ? s.slope : 2.5) : 2.5;
        var profSel = document.getElementById('vr-prof');
        if (profSel) profSel.value = (s && s.roof) ? 'strecha' : 'jedno';
        if (!s) return;
        if (!s.layers.length) {
            box.innerHTML = '<div style="text-align:center; padding:10px; font-size:calc(13px * var(--ag-font-scale, 1)); color:var(--text-muted);">Přidej vrstvy — nejrychleji „Z katalogu".</div>';
            return;
        }
        s.layers.forEach(function (L, i) {
            var row = document.createElement('div');
            row.className = 'vr-row';

            var inN = document.createElement('input');
            inN.type = 'text'; inN.value = L.n; inN.placeholder = 'např. ACL 16';
            inN.addEventListener('input', function () { L.n = inN.value; L.g = guessGroup(L.n); save(); renderSelects(); renderCalc(); renderSection(); });

            var inT = document.createElement('input');
            inT.type = 'number'; inT.step = '0.5'; inT.min = '0'; inT.inputMode = 'decimal'; inT.value = L.t;
            inT.setAttribute('data-vr-t', i);
            inT.addEventListener('input', function () { L.t = num(inT.value, 0); save(); renderSelects(); renderCalc(); renderSection(); });

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
        if (s && s.layers.length) {
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
        if (!s || !s.layers.length) { box.innerHTML = '<div class="vr-line"><span>Přidej vrstvy skladby (dole „Z katalogu").</span></div>'; return; }
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
            '<div class="vr-total"><span>Do tabletu</span><b>' + sign(total) + ' cm</b></div>' +
            '<div class="vr-line"><span>Odsazení od modelu (' + dir + ')</span><span>' + sign(offset) + ' cm</span></div>' +
            '<div class="vr-line"><span>Nadvýšení na hutnění (' + fmt(num(L.p, 0)) + ' % z ' + fmt(num(L.t, 0)) + ' cm)</span><span>' + sign(extra) + ' cm</span></div>';
    }

    // ---- ŘEZ SKLADBOU (SVG, tažení hranic mezi vrstvami) -----------------------
    var _drag = null; // {i, y0, t0, k, kScreen}
    var W = 340;      // šířka viewBoxu (konstantní — používá se i pro přepočet tahu)

    // Body horní hrany v dané výšce y (podle profilu: jednostranný / střechovitý).
    // Vrací pole [x,y] zleva doprava. dy = svislý rozdíl hran (px).
    function edgePts(y, prof) {
        if (prof.roof) return [[0, y + prof.dy], [W / 2, y], [W, y + prof.dy]];
        return [[0, y], [W, y + prof.dy]];
    }
    function ptsToStr(pts) { return pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' '); }
    function bandPoints(y, h, prof) {
        var top = edgePts(y, prof);
        var bot = edgePts(y + h, prof).slice().reverse();
        return ptsToStr(top.concat(bot));
    }

    function renderSection(kOverride) {
        var host = document.getElementById('vr-svg');
        if (!host) return;
        var s = skladba();
        if (!s || !s.layers.length) { host.innerHTML = '<div style="text-align:center; padding:14px 6px; font-size:calc(13px * var(--ag-font-scale, 1)); color:var(--text-muted);">Řez se vykreslí, jakmile přidáš vrstvy.</div>'; return; }

        var PAD = 6;
        var MINH = 20; // minimální výška pruhu, ať je popisek vždy čitelný
        var total = 0;
        s.layers.forEach(function (L) { total += Math.max(0.1, num(L.t, 0)); });
        var k = kOverride || Math.max(1.5, Math.min(9, 260 / total)); // px na cm
        var slope = num(s.slope != null ? s.slope : 2.5, 2.5);
        // převýšení sklonu 2×, ať je zlom vidět; u střechy klesají OBĚ strany od středu
        var dy = s.roof ? Math.abs((W / 2) * (slope / 100) * 2) : W * (slope / 100) * 2;
        var prof = { roof: !!s.roof, dy: dy };
        var ref = Math.min(D.sel.ref, s.layers.length - 1);
        var lay = Math.min(D.sel.lay, s.layers.length - 1);

        // výšky pruhů: úměrné tloušťce, ale nikdy pod MINH (tenké vrstvy čitelné)
        var hs = s.layers.map(function (L) { return Math.max(MINH, Math.max(0.1, num(L.t, 0)) * k); });
        var sumH = 0; hs.forEach(function (h) { sumH += h; });

        var yl = PAD + (prof.roof ? 0 : (dy < 0 ? -dy : 0)); // horní bod kresby
        var H = PAD + Math.abs(dy) + sumH + PAD + 12;
        var svg = [];
        svg.push('<svg viewBox="0 0 ' + W + ' ' + Math.ceil(H) + '" xmlns="http://www.w3.org/2000/svg">');

        var y = yl;
        var bounds = []; // {i, yBot} — levá výška spodní hrany vrstvy (pro tažení)
        s.layers.forEach(function (L, i) {
            var h = hs[i];
            var g = L.g || guessGroup(L.n);
            var col = GRP_COLOR[g] || GRP_COLOR.a;
            var txt = GRP_TEXT[g] || '#fff';
            var isLay = (i === lay);
            svg.push('<polygon points="' + bandPoints(y, h, prof) + '" fill="' + col + '" stroke="' + (isLay ? 'var(--accent,#2f9e74)' : 'rgba(255,255,255,0.25)') + '" stroke-width="' + (isLay ? 2.5 : 1) + '"/>');
            // popisek u levé hrany (u střechy je levá hrana níž o dy)
            var labY = y + (prof.roof ? dy : 0) + h / 2;
            var nm = String(L.n || ('vrstva ' + (i + 1)));
            if (nm.length > 20) nm = nm.slice(0, 19) + '…';
            var label = esc(nm) + ' · ' + fmt(num(L.t, 0)) + ' cm';
            svg.push('<text x="8" y="' + (labY + 3.5) + '" font-size="11.5" font-weight="700" fill="' + txt + '">' + label + (isLay ? '  ◀ POKLÁDÁM' : '') + '</text>');
            bounds.push({ i: i, yBot: y + h });
            y += h;
        });

        // značka MODEL na horní ploše vrstvy ref (sleduje profil)
        var yRef = yl;
        for (var m = 0; m < ref; m++) yRef += hs[m];
        svg.push('<polyline points="' + ptsToStr(edgePts(yRef, prof)) + '" fill="none" stroke="#60a5fa" stroke-width="2" stroke-dasharray="7 5"/>');
        var tagY = Math.max(1, yRef + (prof.roof ? dy : Math.max(0, dy)) - 16);
        svg.push('<rect x="' + (W - 62) + '" y="' + tagY + '" width="60" height="15" rx="4" fill="#60a5fa"/>');
        svg.push('<text x="' + (W - 32) + '" y="' + (tagY + 11.5) + '" font-size="10" font-weight="800" fill="#0b1220" text-anchor="middle">MODEL</text>');

        // úchyty tažení: spodní hrana každé vrstvy (mění JEJÍ tloušťku)
        bounds.forEach(function (b) {
            var top = edgePts(b.yBot - 9, prof);
            var bot = edgePts(b.yBot + 9, prof).slice().reverse();
            svg.push('<polygon class="vr-drag" data-i="' + b.i + '" points="' + ptsToStr(top.concat(bot)) + '" fill="transparent"/>');
        });

        svg.push('</svg>');
        host.innerHTML = svg.join('');

        // tažení hranic — jen pointerdown; move/up drží DOKUMENT (SVG se při tahu
        // překresluje, posluchač na zaniklém prvku by tah utrhl)
        var el = host.querySelector('svg');
        if (!el) return;
        host.querySelectorAll('.vr-drag').forEach(function (hit) {
            hit.addEventListener('pointerdown', function (e) {
                var i = parseInt(hit.getAttribute('data-i'), 10);
                var s2 = skladba(); if (!s2 || !s2.layers[i]) return;
                // převod px obrazovky -> cm: šířka viewBoxu je konstantní (W)
                var box = el.getBoundingClientRect();
                var kScreen = k * (box.width / W);
                if (!(kScreen > 0)) return;
                _drag = { i: i, y0: e.clientY, t0: num(s2.layers[i].t, 0), k: k, kScreen: kScreen };
                e.preventDefault();
            });
        });
    }

    function vrDragMove(e) {
        if (!_drag) return;
        var s2 = skladba(); if (!s2 || !s2.layers[_drag.i]) { _drag = null; return; }
        var dcm = (e.clientY - _drag.y0) / _drag.kScreen;
        var nt = Math.round(Math.max(0.5, _drag.t0 + dcm) * 2) / 2; // krok 0,5 cm
        if (nt !== num(s2.layers[_drag.i].t, 0)) {
            s2.layers[_drag.i].t = nt;
            var inp = document.querySelector('#' + MODAL_ID + ' input[data-vr-t="' + _drag.i + '"]');
            if (inp) inp.value = nt;
            renderSection(_drag.k); // zmrazené měřítko, ať vrstvy pod prstem neutíkají
            renderCalc();
        }
        e.preventDefault();
    }
    function vrDragEnd() {
        if (!_drag) return;
        _drag = null;
        save();
        renderSelects(); renderCalc(); renderSection();
    }

    function renderAll() { renderSkladbaSelect(); renderLayers(); renderSelects(); renderCalc(); renderSection(); }

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
