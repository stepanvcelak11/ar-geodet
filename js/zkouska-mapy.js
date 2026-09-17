// ===== QTRIG — ZKOUŠKA MAPY: dočasné tlačítko na hlavní obrazovce (ODPOJITELNÁ, ag/lazy) ======
// (17. 9. 2026, na přání uživatele: „dočasně mi vytvoř na hlavní obrazovce tlačítko, kde si budu
//  moct vše vyzkoušet" — vlastní mapa a všechno, co na ní stojí)
//
// Jedno tlačítko vlevo dole → list s akcemi v pořadí, jak se to zkouší v terénu:
//   zapnout vektorovou mapu (+ styl) · 3D pohled · Kde se dá měřit · ukázkový výkres DXF kolem
//   mě (osa se staničením) · překážka dvěma klepnutími · zkušební cíl za rohem (trasa terénem)
//   · hlídač okolí (stav + vypínač) · korekce po hraně (režim) · přichytávání k rohům · země
//   měření · úklid zkušebních věcí. Každý řádek říká, co se má stát a kde to pak najdu natrvalo.
// DOČASNÉ: křížkem se schová (localStorage agZkouskaMapy_v1 = '0'); odstranění = smazat soubor
// + řádek v index.html. Na nic nesahá, jen volá veřejná API modulů.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGZkouskaMapy) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'zkouska-mapy:' + kde); } catch (e2) { /* nic */ } };
    var KEY = 'agZkouskaMapy_v1';
    var ZKUS_CIL = 'zkouska-cil';

    function poloha() { try { return (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng } : null; } catch (e) { return null; } }
    function stred() { var p = poloha(); if (p) return p; try { var c = map.getCenter(); return { lat: c.lat, lng: c.lng }; } catch (e) { return { lat: 50.0875, lng: 14.4213 }; } }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s); }
    function toast(m) { try { window.agInfo && window.agInfo(m); } catch (e) { /* nic */ } }

    function css() {
        if (!window.AG || !AG.style) return;
        AG.style('ag-zkouska-style', [
            '#ag-zkouska-btn{position:fixed;left:12px;bottom:calc(118px + env(safe-area-inset-bottom,0px));z-index:9990;display:none;align-items:center;gap:6px;padding:9px 12px;border:0;border-radius:14px;background:#0b6e76;color:#fff;font:700 12px/1.2 var(--font-ui,system-ui),sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4)}',
            'body.app-started #ag-zkouska-btn{display:flex}', 'body.ag-simple #ag-zkouska-btn,#ag-zkouska-btn.off{display:none!important}',
            '#ag-zkouska-btn .icon{width:16px;height:16px}',
            '#ag-zkouska{position:fixed;inset:0;z-index:100003;display:none;background:rgba(0,0,0,.45)}', '#ag-zkouska.open{display:block}',
            '#ag-zkouska .zk-list{position:absolute;left:0;right:0;bottom:0;max-height:88%;overflow:auto;background:var(--bg-color,#12161a);color:var(--text-color,#eef);border-radius:18px 18px 0 0;padding:12px 14px calc(16px + env(safe-area-inset-bottom,0px));font-family:var(--font-ui,system-ui),sans-serif}',
            '#ag-zkouska h3{margin:4px 0 2px;font-size:calc(17px * var(--ag-font-scale,1))}', '#ag-zkouska .zk-sub{opacity:.7;font-size:calc(12px * var(--ag-font-scale,1));margin-bottom:10px}',
            '#ag-zkouska .zk-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.08)}',
            '#ag-zkouska .zk-row .t{flex:1;min-width:0;font-size:calc(13px * var(--ag-font-scale,1))}', '#ag-zkouska .zk-row .t small{display:block;opacity:.65;font-size:calc(11px * var(--ag-font-scale,1))}',
            '#ag-zkouska .zk-row .n{width:22px;height:22px;border-radius:50%;background:#0b6e76;color:#fff;font:700 12px/22px inherit;text-align:center;flex:0 0 22px}',
            '#ag-zkouska button.zk-b{appearance:none;border:0;border-radius:10px;padding:8px 12px;background:var(--accent,#2f9e74);color:#04110b;font:600 12px inherit;white-space:nowrap}',
            '#ag-zkouska button.zk-b.sec{background:rgba(255,255,255,.14);color:inherit}', '#ag-zkouska select.zk-s{border-radius:8px;padding:6px 8px;background:rgba(255,255,255,.1);color:inherit;border:1px solid rgba(255,255,255,.2);font:600 12px inherit;max-width:44vw}',
            '#ag-zkouska .zk-x{position:absolute;right:12px;top:10px;width:34px;height:34px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:inherit;font-size:18px}',
            '#ag-zkouska .zk-stav{font:600 11px inherit;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.12)}', '#ag-zkouska .zk-stav.ok{background:rgba(34,197,94,.3)}', '#ag-zkouska .zk-stav.bad{background:rgba(239,68,68,.35)}'
        ].join('\n'));
    }
    function stavMapy() { var m = window.AGMapaVektor; if (!m) return { t: 'modul se načítá…', c: '' }; var s = m.stav(); return s === 'zapnuto' ? { t: 'zapnuto · ' + m.varianta(), c: 'ok' } : s === 'nacitam' ? { t: 'načítám…', c: '' } : s === 'chyba' ? { t: 'chyba: ' + m.chyba(), c: 'bad' } : { t: 'vypnuto', c: '' }; }
    function radek(n, titul, pozn, ovladani) { return '<div class="zk-row"><span class="n">' + n + '</span><span class="t">' + titul + '<small>' + pozn + '</small></span>' + ovladani + '</div>'; }
    function html() {
        var sm = stavMapy(), mv = window.AGMapaVektor, zapMapa = mv && mv.stav() === 'zapnuto';
        var styl = (mv && mv.nastaveni().styl) || 'auto';
        var okoli = window.AGOkoli && AGOkoli.stav();
        var zeme = window.AGSour ? AGSour.rezim() : 'auto';
        var hrana = window.AGHranaAuto ? AGHranaAuto.rezim() : 'ptat';
        return '<div class="zk-list"><button type="button" class="zk-x" id="zk-zavrit" aria-label="Zavřít">✕</button>'
            + '<h3>Zkouška vlastní mapy</h3><div class="zk-sub">Dočasný rozcestník — každá věc má natrvalo své místo (píšu kde). Tlačítko schováš křížkem dole.</div>'
            + radek(1, 'Vektorová mapa <span class="zk-stav ' + sm.c + '" id="zk-stav-mapy">' + esc(sm.t) + '</span>', 'natrvalo: Nastavení → Vzhled → Nová mapa (vektor, beta). Data: celé Česko z cloudu.',
                '<select class="zk-s" id="zk-styl"><option value="auto"' + (styl === 'auto' ? ' selected' : '') + '>podle motivu</option><option value="den"' + (styl === 'den' ? ' selected' : '') + '>den</option><option value="noc"' + (styl === 'noc' ? ' selected' : '') + '>noc</option><option value="modrotisk"' + (styl === 'modrotisk' ? ' selected' : '') + '>modrotisk</option><option value="tisk"' + (styl === 'tisk' ? ' selected' : '') + '>tisk</option></select>'
                + '<button type="button" class="zk-b" id="zk-mapa">' + (zapMapa ? 'Vypnout' : 'Zapnout') + '</button>')
            + radek(2, '3D pohled', 'budovy do výšky, terén, body a výkres; natrvalo: Nástroje → Katastr a podklady', '<button type="button" class="zk-b" id="zk-3d">Otevřít</button>')
            + radek(3, 'Kde se dá měřit', 'mapa stínění GPS kolem mě; natrvalo: Nástroje → Přesné měření; vrstvu schováš ve Vrstvách', '<button type="button" class="zk-b" id="zk-kv">Spočítat</button>')
            + radek(4, 'Ukázkový výkres DXF kolem mě', 'osa 340 m + hrana + šachta; klepni na červenou čáru = staničení; natrvalo: Import projektu (DXF)', '<button type="button" class="zk-b" id="zk-dxf">Načíst</button>')
            + radek(5, 'Překážka v mapě', 'klepni na dva rohy hromady/výkopu; natrvalo: Vrstvy → Nástroje mapy → Překážka', '<button type="button" class="zk-b" id="zk-prek">Nakreslit</button>')
            + radek(6, 'Zkušební cíl za rohem', 'bod ~150 m daleko; navádění po terénu obejde budovy, šipka vede na další lom, klepnutí na trasu = profil', '<button type="button" class="zk-b" id="zk-cil">Navigovat</button>')
            + radek(7, 'Hlídač okolí <span class="zk-stav ' + (okoli ? (okoli.trida === 'bad' ? 'bad' : '') : 'ok') + '">' + esc(okoli ? okoli.text : 'v pořádku / nic v okolí') + '</span>', 'hlídá budovy, les, koleje, překážky; natrvalo: Nastavení → AR & přesnost',
                '<button type="button" class="zk-b sec" id="zk-okoli">' + (window.AGOkoli && AGOkoli.zapnuto() ? 'Vypnout' : 'Zapnout') + '</button>')
            + radek(8, 'Korekce podle hrany při chůzi', '≥ 20 m souběžně se zdí/hranicí parcely → nabídne posun; natrvalo: Nastavení → AR & přesnost',
                '<select class="zk-s" id="zk-hrana"><option value="vyp"' + (hrana === 'vyp' ? ' selected' : '') + '>vypnuto</option><option value="ptat"' + (hrana === 'ptat' ? ' selected' : '') + '>zeptat se</option><option value="auto"' + (hrana === 'auto' ? ' selected' : '') + '>samo</option></select>')
            + radek(9, 'Přichytávání k rohům', 'nový bod u lomu parcely / rohu budovy / bodu výkresu → nabídne souřadnice z mapy',
                '<button type="button" class="zk-b sec" id="zk-prich">' + (window.AGPrichyceni && AGPrichyceni.zapnuto() ? 'Vypnout' : 'Zapnout') + '</button>')
            + radek(10, 'Země měření', 'souřadnice, výšky a podklady podle země; natrvalo: Nastavení → Data',
                '<select class="zk-s" id="zk-zeme"><option value="auto"' + (zeme === 'auto' ? ' selected' : '') + '>automaticky</option>' + ['CZ', 'SK', 'PL', 'AT', 'DE', 'HU', 'CH', 'NL', 'FR'].map(function (k) { return '<option value="' + k + '"' + (zeme === k ? ' selected' : '') + '>' + esc(window.AGSour ? AGSour.ZEME[k].nazev : k) + '</option>'; }).join('') + '</select>')
            + radek('×', 'Úklid', 'smaže zkušební cíl, ukázkový výkres a překážky této zakázky', '<button type="button" class="zk-b sec" id="zk-uklid">Uklidit</button>')
            + '<div class="zk-row"><span class="t"><small>Tlačítko je dočasné.</small></span><button type="button" class="zk-b sec" id="zk-schovat">Schovat tlačítko</button></div>'
            + '</div>';
    }
    var el = null;
    function otevri() {
        if (!el) { el = document.createElement('div'); el.id = 'ag-zkouska'; document.body.appendChild(el); el.addEventListener('click', function (ev) { if (ev.target === el) zavri(); }); }
        el.innerHTML = html(); el.classList.add('open');
        var $ = function (id) { return document.getElementById(id); };
        $('zk-zavrit').onclick = zavri;
        $('zk-mapa').onclick = function () { if (!window.AGMapaVektor) return toast('Modul mapy se ještě načítá…'); var z = AGMapaVektor.stav() === 'zapnuto'; toast(z ? 'Vypínám vektorovou mapu.' : 'Zapínám vektorovou mapu — stahuji knihovny a data (chvilku)…'); AGMapaVektor.nastav({ zap: !z }).then(function () { if (el.classList.contains('open')) otevri(); if (!z && AGMapaVektor.stav() === 'zapnuto') { zavri(); toast('Vektorová mapa běží. Podklad „Mapa" je teď náš — zkus zoom na budovy a čísla popisná.'); } }); };
        $('zk-styl').onchange = function () { if (window.AGMapaVektor) AGMapaVektor.nastav({ styl: this.value }); };
        $('zk-3d').onclick = function () { zavri(); if (typeof window.agOpenPohled3d === 'function') window.agOpenPohled3d(); else toast('3D pohled se ještě načítá — zkus za chvíli.'); };
        $('zk-kv').onclick = function () { zavri(); if (typeof window.agOpenKvalitaGpsMapa === 'function') window.agOpenKvalitaGpsMapa(); else toast('Nástroj se ještě načítá — zkus za chvíli.'); };
        $('zk-dxf').onclick = function () { zavri(); ukazkovyDxf(); };
        $('zk-prek').onclick = function () { zavri(); if (window.AGOkoli) AGOkoli.kresliNovou('hromada'); else toast('Hlídač okolí se ještě načítá.'); };
        $('zk-cil').onclick = function () { zavri(); zkusebniCil(); };
        $('zk-okoli').onclick = function () { if (window.AGOkoli) { AGOkoli.nastav({ zap: !AGOkoli.zapnuto() }); AGOkoli.tik(); otevri(); } };
        $('zk-hrana').onchange = function () { if (window.AGHranaAuto) AGHranaAuto.nastav({ rezim: this.value }); };
        $('zk-prich').onclick = function () { if (window.AGPrichyceni) { AGPrichyceni.nastav({ zap: !AGPrichyceni.zapnuto() }); otevri(); } };
        $('zk-zeme').onchange = function () { if (window.AGSour) AGSour.nastav(this.value); };
        $('zk-uklid').onclick = function () { uklid(); otevri(); };
        $('zk-schovat').onclick = function () { schovej(true); zavri(); toast('Tlačítko schované. Všechno najdeš v Nastavení a Nástrojích; vrátit: Nastavení → Vzhled → Mapa → Tlačítko Zkouška mapy.'); };
    }
    function zavri() { if (el) el.classList.remove('open'); }

    // ---- ukázkový DXF kolem mě: osa 3 body (~341 m), hrana 200 m, šachta -----------------
    function ukazkovyDxf() {
        if (!window.AGProjektDxf || !window.GeoCore) return toast('Import projektu se ještě načítá.');
        var c = stred(), m = 111320, ml = m * Math.cos(c.lat * Math.PI / 180);
        function yx(lat, lng) { var s = GeoCore.toSJTSK(lat, lng); return [-s.y, -s.x]; }
        var A = yx(c.lat, c.lng), B = yx(c.lat + 100 / m, c.lng + 100 / ml), C = yx(c.lat + 100 / m, c.lng + 300 / ml), H1 = yx(c.lat - 20 / m, c.lng), H2 = yx(c.lat - 20 / m, c.lng + 200 / ml), P = yx(c.lat + 50 / m, c.lng + 50 / ml);
        function p(k, v) { return k + '\n' + v + '\n'; }
        var s = p(0, 'SECTION') + p(2, 'TABLES') + p(0, 'TABLE') + p(2, 'LAYER');
        [['OSA', 1], ['HRANA', 5], ['SACHTY', 3]].forEach(function (l) { s += p(0, 'LAYER') + p(2, l[0]) + p(70, 0) + p(62, l[1]) + p(6, 'CONTINUOUS'); });
        s += p(0, 'ENDTAB') + p(0, 'ENDSEC') + p(0, 'SECTION') + p(2, 'ENTITIES') + p(0, 'LWPOLYLINE') + p(8, 'OSA') + p(90, 3) + p(70, 0);
        [A, B, C].forEach(function (q) { s += p(10, q[0].toFixed(3)) + p(20, q[1].toFixed(3)); });
        s += p(0, 'LINE') + p(8, 'HRANA') + p(10, H1[0].toFixed(3)) + p(20, H1[1].toFixed(3)) + p(11, H2[0].toFixed(3)) + p(21, H2[1].toFixed(3));
        s += p(0, 'POINT') + p(8, 'SACHTY') + p(10, P[0].toFixed(3)) + p(20, P[1].toFixed(3)) + p(0, 'TEXT') + p(8, 'SACHTY') + p(10, P[0].toFixed(3)) + p(20, P[1].toFixed(3)) + p(40, 1) + p(1, 'SACHTA 12') + p(0, 'ENDSEC') + p(0, 'EOF');
        try { var d = AGProjektDxf.nacti(s); d.osa = 'OSA'; AGProjektDxf.prepni(true); toast('Ukázkový výkres načten: červená osa se staničením po 100 m, modrá hrana, šachta. Klepni na čáru.'); } catch (e) { swallow(e, 'dxf'); toast('Výkres se nepodařilo načíst.'); }
    }
    // ---- zkušební cíl ~150 m daleko (ne uvnitř budovy) -------------------------------------
    function zkusebniCil() {
        var c = stred(), m = 111320, ml = m * Math.cos(c.lat * Math.PI / 180);
        var t = { lat: c.lat + 110 / m, lng: c.lng + 110 / ml };
        try { if (window.AGOkoli) for (var k = 0; k < 20 && AGOkoli.vyhodnot(t.lat, t.lng).uvnitr; k++) t = { lat: t.lat + 6 / m, lng: t.lng + 2 / ml }; } catch (e) { /* nic */ }
        try {
            var i = arPoints.findIndex(function (q) { return q.id === ZKUS_CIL; }); if (i >= 0) arPoints.splice(i, 1);
            arPoints.push({ id: ZKUS_CIL, name: 'Zkušební cíl', lat: t.lat, lng: t.lng, type: 'custom', cat: 'CUSTOM', hidden: false, zkouska: true });
            highlightedPointId = ZKUS_CIL;
            try { initARMarkers(); drawAllMarkersOnMap(); } catch (e) { /* nic */ }
            if (window.AGTrasa) setTimeout(function () { var r = AGTrasa.prepocitej('zkouška'); toast(r ? ('Trasa po terénu: ' + Math.round(r.delka) + ' m, ' + r.body.length + ' lomů. Klepni na žlutou čáru = profil.') : 'Trasa se nespočítala (zapni vektorovou mapu a počkej na načtení) — vede přímka.'); }, 300);
        } catch (e) { swallow(e, 'cil'); }
    }
    function uklid() {
        try { var i = arPoints.findIndex(function (q) { return q.id === ZKUS_CIL; }); if (i >= 0) arPoints.splice(i, 1); if (highlightedPointId === ZKUS_CIL) highlightedPointId = null; try { initARMarkers(); drawAllMarkersOnMap(); } catch (e) { /* nic */ } } catch (e) { /* nic */ }
        try { if (window.AGProjektDxf) { var d = AGProjektDxf.design(); if (d && d.layers && d.layers.SACHTY && AGProjektDxf.smaz) AGProjektDxf.smaz(); } } catch (e) { /* nic */ }
        try { if (window.AGOkoli) { while (AGOkoli.prekazky().length) AGOkoli.smazPrekazku(0); } } catch (e) { /* nic */ }
        try { if (window.AGKvalitaGpsMapa) AGKvalitaGpsMapa.prepni(false); } catch (e) { /* nic */ }
        toast('Uklizeno.');
    }
    function schovej(ano) {
        try { if (ano) localStorage.setItem(KEY, '0'); else localStorage.removeItem(KEY); } catch (e) { /* nic */ }
        var b = document.getElementById('ag-zkouska-btn'); if (b) b.classList.toggle('off', !!ano);
        var sw = document.getElementById('s-zkouska-btn'); if (sw) sw.checked = !ano;
    }
    // Nastavení → Vzhled → Mapa: vypínač tlačítka (ať jde vrátit, když ho schovám)
    function ui() {
        if (document.getElementById('s-zkouska-btn')) return;
        var kotva = document.getElementById('s-mapa-vektor-vice'); if (!kotva) return;
        var r = document.createElement('div'); r.className = 'st-row';
        var on = true; try { on = localStorage.getItem(KEY) !== '0'; } catch (e) { /* nic */ }
        r.innerHTML = '<span class="st-lab">Tlačítko „Zkouška mapy"<small>dočasný rozcestník vlevo dole na hlavní obrazovce</small></span><label class="st-sw"><input type="checkbox" id="s-zkouska-btn"' + (on ? ' checked' : '') + '><span class="st-sw-face"></span></label>';
        kotva.parentNode.insertBefore(r, kotva.nextSibling);
        r.querySelector('input').addEventListener('change', function (ev) { schovej(!ev.target.checked); });
    }
    document.addEventListener('click', function (ev) { try { if (ev.target && ev.target.closest && ev.target.closest('#settings-btn, [data-open="settings"]')) setTimeout(ui, 120); } catch (e) { /* nic */ } }, true);
    function tlacitko() {
        if (document.getElementById('ag-zkouska-btn')) return;
        css();
        var b = document.createElement('button'); b.type = 'button'; b.id = 'ag-zkouska-btn';
        b.innerHTML = '<svg class="icon"><use href="#i-layers"/></svg><span>Zkouška mapy</span>';
        try { if (localStorage.getItem(KEY) === '0') b.classList.add('off'); } catch (e) { /* nic */ }
        b.addEventListener('click', otevri);
        document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tlacitko); else tlacitko();
    window.AGZkouskaMapy = { otevri: otevri, zavri: zavri, ukaz: function () { schovej(false); }, schovej: schovej, ukazkovyDxf: ukazkovyDxf, zkusebniCil: zkusebniCil, uklid: uklid };
})();
