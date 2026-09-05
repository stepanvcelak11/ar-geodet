// ===== AR Geodet — SEZNAM SOUŘADNIC PRO KANCELÁŘ (ODPOJITELNÁ vrstva) =========
// Neinvazivní, ve stylu js/kml-export.js + js/dxf-export.js: NEEDITUJE logika.js
// ani grafika.js. Přidává do exportu formát „Seznam souřadnic (kancelář)“, který
// se dá NASTAVIT tak, aby ho bez ručních úprav načetla Groma, Kokeš nebo GEUS.
//
// PROČ TENHLE MODUL VZNIKL: appka uměla CSV/TXT jen v JEDINÉ podobě —
// „název;Y;X[;Z][;kód]“, UTF-8, tečka jako desetinná značka (logika.js,
// exportPointsCSV/exportPointsTXT). Kancelářský software v ČR ale čte celou
// RODINU textových seznamů a naráží přesně na to, co bylo napevno:
//   • POŘADÍ SOUŘADNIC — Groma umí YXZ i XYZ, Kokeš taky; když se splete pořadí,
//     body skončí u Aše nebo v Polsku (a nikdo si toho hned nevšimne),
//   • ODDĚLOVAČ — Kokeš STX má VŽDY mezeru, Groma mezeru/tabulátor, CSV čárku
//     nebo středník; středník appky byl pro Kokeš nečitelný,
//   • DESETINNÁ ZNAČKA — česká lokalizace často chce čárku,
//   • KÓDOVÁNÍ — Groma i Kokeš jsou desktopové programy pro Windows a čekají
//     Windows-1250. UTF-8 z appky jim rozsypal diakritiku v kódech bodů.
// Import appky je na tom líp: čte binárně a kódování si DETEKUJE
// (logika.js `_agDecodeText` → UTF-8, při chybě Windows-1250), takže cesta
// z kanceláře do appky fungovala. Chyběl jen směr ven.
//
// ⚠ ŽÁDNÝ JEDINÝ „formát Gromy/Kokeše“ NEEXISTUJE — obě aplikace mají import
// konfigurovatelný. Předvolby níž jsou proto POCTIVĚ jen rozumné výchozí sady,
// ne úřední specifikace; proto je u exportu ŽIVÝ NÁHLED prvních řádků. Když
// protistrana chce něco jiného, přepne se to v dialogu a náhled to hned ukáže.
//
// TŘÍDA PŘESNOSTI se ZÁMĚRNĚ NEODVOZUJE z GPS přesnosti bodu. Třída přesnosti
// je právní charakteristika bodu (u katastru tř. 3 = základní střední souřadnicová
// chyba 0,14 m), kdežto `acc` z appky je okamžitá přesnost GPS fixu. Odvozovat
// jedno z druhého by do úředního výstupu vyrobilo číslo, které nikdo neověřil —
// modul proto sloupec vypisuje jen na výslovné přání a s hodnotou, kterou zadá
// uživatel.
//
// Data: čte persistentCustomPoints + activeProjectId (globály z logika.js),
// převod proj4 EPSG:4326 → EPSG:5514, kladné hodnoty (STEJNÁ konvence jako
// CSV/TXT export appky). Nastavení si pamatuje v localStorage (agSeznamCfg_v1).
//
// Odstranění: smaž js/seznam-souradnic.js + css/seznam-souradnic.css a jejich
// řádky v index.html (a přegeneruj sw.js: python scripts/gen_sw_assets.py).
// Ve výběru formátů v index.html pak smaž položku 'exportPointsSeznam'.
// ================================================================================
(function () {
    'use strict';
    if (window.AGSeznam) return;

    var LS = 'agSeznamCfg_v1';
    var overlay = null;

    // ---------------------------------------------------------------------------
    // Windows-1250 — kódování pro české desktopové programy
    // ---------------------------------------------------------------------------
    // TextEncoder umí JEN UTF-8, takže tabulku horní poloviny (0x80–0xFF) musíme
    // mít vlastní. ZÁMĚRNĚ jako KÓDY znaků, ne jako literál s písmeny: tabulka
    // obsahuje i neviditelné znaky (NBSP 0xA0, měkký spojovník 0xAD) a auto-formátovač
    // v tomhle repu umí mezery přepisovat na NBSP — v literálu by se to tiše rozjelo.
    // 0 = pozice, kterou CP1250 nedefinuje. Index 0 odpovídá bajtu 0x80.
    var CP1250_HI = [
        0x20AC, 0, 0x201A, 0, 0x201E, 0x2026, 0x2020, 0x2021, 0, 0x2030, 0x0160, 0x2039, 0x015A, 0x0164, 0x017D, 0x0179,
        0, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0, 0x2122, 0x0161, 0x203A, 0x015B, 0x0165, 0x017E, 0x017A,
        0x00A0, 0x02C7, 0x02D8, 0x0141, 0x00A4, 0x0104, 0x00A6, 0x00A7, 0x00A8, 0x00A9, 0x015E, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x017B,
        0x00B0, 0x00B1, 0x02DB, 0x0142, 0x00B4, 0x00B5, 0x00B6, 0x00B7, 0x00B8, 0x0105, 0x015F, 0x00BB, 0x013D, 0x02DD, 0x013E, 0x017C,
        0x0154, 0x00C1, 0x00C2, 0x0102, 0x00C4, 0x0139, 0x0106, 0x00C7, 0x010C, 0x00C9, 0x0118, 0x00CB, 0x011A, 0x00CD, 0x00CE, 0x010E,
        0x0110, 0x0143, 0x0147, 0x00D3, 0x00D4, 0x0150, 0x00D6, 0x00D7, 0x0158, 0x016E, 0x00DA, 0x0170, 0x00DC, 0x00DD, 0x0162, 0x00DF,
        0x0155, 0x00E1, 0x00E2, 0x0103, 0x00E4, 0x013A, 0x0107, 0x00E7, 0x010D, 0x00E9, 0x0119, 0x00EB, 0x011B, 0x00ED, 0x00EE, 0x010F,
        0x0111, 0x0144, 0x0148, 0x00F3, 0x00F4, 0x0151, 0x00F6, 0x00F7, 0x0159, 0x016F, 0x00FA, 0x0171, 0x00FC, 0x00FD, 0x0163, 0x02D9
    ];
    var _cpMap = null;
    function cpMap() {
        if (_cpMap) return _cpMap;
        _cpMap = {};
        for (var i = 0; i < CP1250_HI.length; i++) {
            if (CP1250_HI[i]) _cpMap[String.fromCharCode(CP1250_HI[i])] = 0x80 + i;
        }
        return _cpMap;
    }
    // Znak, ktery CP1250 nezna, RADSI prepiseme bez diakritiky nez na '?' —
    // v seznamu souradnic je citelny kod dulezitejsi nez vernost hacku.
    // Rozsah kombinujici diakritiky pisu ESCAPE sekvenci, ne znaky (viz vyse).
    function deaccent(s) {
        try { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { return s; }
    }
    function encodeCp1250(str) {
        var m = cpMap(), out = [];
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c < 0x80) { out.push(c); continue; }
            var ch = str.charAt(i), b = m[ch];
            if (b != null) { out.push(b); continue; }
            var alt = deaccent(ch);
            for (var j = 0; j < alt.length; j++) {
                var ac = alt.charCodeAt(j);
                out.push(ac < 0x80 ? ac : (m[alt.charAt(j)] != null ? m[alt.charAt(j)] : 0x3F));
            }
        }
        return new Uint8Array(out);
    }

    // ---------------------------------------------------------------------------
    // předvolby — rozumné výchozí sady, VŠECHNO jde přepnout (viz hlavička)
    // ---------------------------------------------------------------------------
    var PRESETS = [
        {
            id: 'groma', nm: 'Groma — obecný seznam (Y X Z)',
            hint: 'Volný formát YXZ: čísla oddělená mezerami. Nejběžnější cesta do Gromy.',
            cfg: { ord: 'YX', sep: 'space', dec: 2, dsep: '.', z: 'zero', kod: true, tr: false, trv: 3, enc: 'utf8', align: true, ext: 'txt' }
        },
        {
            id: 'katastr', nm: 'Groma — formát pro katastr',
            hint: 'číslo, Y, X, Z, třída přesnosti. Chybějící výška se píše jako 0.00.',
            cfg: { ord: 'YX', sep: 'space', dec: 2, dsep: '.', z: 'zero', kod: false, tr: true, trv: 3, enc: 'utf8', align: true, ext: 'txt' }
        },
        {
            id: 'kokes', nm: 'Kokeš — STX (textový seznam)',
            hint: 'Oddělovač je VŽDY mezera. Kódování Windows-1250 kvůli diakritice v kódech.',
            cfg: { ord: 'YX', sep: 'space', dec: 2, dsep: '.', z: 'zero', kod: true, tr: false, trv: 3, enc: 'cp1250', align: true, ext: 'stx' }
        },
        {
            id: 'excel', nm: 'CSV pro Excel (středník)',
            hint: 'Středník + desetinná čárka + BOM — česky lokalizovaný Excel to otevře rovnou.',
            cfg: { ord: 'YX', sep: 'semi', dec: 2, dsep: ',', z: 'zero', kod: true, tr: false, trv: 3, enc: 'utf8bom', align: false, ext: 'csv' }
        },
        { id: 'vlastni', nm: 'Vlastní nastavení', hint: 'Nic se nepřepisuje — nastav si sloupce sám a hlídej náhled.', cfg: null }
    ];

    var SEPS = { space: ' ', tab: '\t', semi: ';', comma: ',' };

    function defCfg() { var c = {}; var p = PRESETS[0].cfg; for (var k in p) c[k] = p[k]; c.preset = 'groma'; return c; }
    var cfg = defCfg();

    function loadCfg() {
        try {
            var raw = localStorage.getItem(LS); if (!raw) return;
            var o = JSON.parse(raw); if (!o || typeof o !== 'object') return;
            for (var k in cfg) if (o[k] != null) cfg[k] = o[k];
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'seznam-souradnic:loadCfg'); }
    }
    function saveCfg() { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'seznam-souradnic:saveCfg'); } }

    // ---------------------------------------------------------------------------
    // sestavení řádků
    // ---------------------------------------------------------------------------
    function pts() { return (typeof persistentCustomPoints !== 'undefined' && persistentCustomPoints) ? persistentCustomPoints : []; }

    function fmtNum(v, dec, dsep) {
        var s = Number(v).toFixed(dec);
        return dsep === ',' ? s.replace('.', ',') : s;
    }

    // Číslo bodu nesmí obsahovat oddělovač — jinak se řádek rozpadne na víc sloupců
    // a protistrana načte nesmysl. U mezery/tabulátoru proto bílé znaky nahradíme '_'.
    function cleanNum(name, sepCh) {
        var s = String(name == null ? 'Bod' : name).replace(/[\r\n]/g, ' ').trim();
        if (sepCh === ' ' || sepCh === '\t') s = s.replace(/\s+/g, '_');
        else s = s.split(sepCh).join(' ');
        return s || 'Bod';
    }
    function cleanTxt(s, sepCh) {
        var t = String(s == null ? '' : s).replace(/[\r\n]/g, ' ').trim();
        if (sepCh === ' ' || sepCh === '\t') t = t.replace(/\s+/g, '_');
        else t = t.split(sepCh).join(' ');
        return t;
    }

    // Vrací pole polí (buňky) — zarovnání řeší až render, ať se dá spočítat šířka sloupce.
    function buildRows(list, c) {
        var sepCh = SEPS[c.sep] || ' ';
        var rows = [];
        list.forEach(function (p) {
            if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
            var sj;
            try { sj = proj4('EPSG:4326', 'EPSG:5514', [p.lng, p.lat]); } catch (e) { return; }
            var Y = Math.abs(sj[0]), X = Math.abs(sj[1]);
            var cells = [cleanNum(p.name, sepCh)];
            if (c.ord === 'XY') { cells.push(fmtNum(X, c.dec, c.dsep)); cells.push(fmtNum(Y, c.dec, c.dsep)); }
            else { cells.push(fmtNum(Y, c.dec, c.dsep)); cells.push(fmtNum(X, c.dec, c.dsep)); }
            if (c.z !== 'skip') {
                var z = (p.vyska != null && isFinite(p.vyska)) ? Number(p.vyska) : 0;
                cells.push(fmtNum(z, c.dec, c.dsep));
            }
            if (c.tr) cells.push(String(c.trv == null ? '' : c.trv));
            if (c.kod) cells.push(cleanTxt(p.kod, sepCh));
            rows.push(cells);
        });
        return rows;
    }

    // Zarovnání sloupců: čísla doprava (aby řády seděly pod sebou), TEXT doleva.
    // Pořadí sloupců musí odpovídat buildRows.
    function colAlign(c) {
        var a = ['L', 'R', 'R'];              // číslo bodu, dvě souřadnice
        if (c.z !== 'skip') a.push('R');      // výška
        if (c.tr) a.push('R');                // třída přesnosti
        if (c.kod) a.push('L');               // kód bodu je text
        return a;
    }

    function renderRows(rows, c) {
        var sepCh = SEPS[c.sep] || ' ';
        // Zarovnání dává smysl JEN u mezery/tabulátoru — u CSV by přebytečné mezery
        // zůstaly uvnitř buňky a tabulkový procesor by je bral jako součást hodnoty.
        var pad = c.align && (c.sep === 'space' || c.sep === 'tab');
        if (!pad) return rows.map(function (r) { return r.join(sepCh); });
        var al = colAlign(c), w = [];
        rows.forEach(function (r) { r.forEach(function (cell, i) { w[i] = Math.max(w[i] || 0, cell.length); }); });
        return rows.map(function (r) {
            return r.map(function (cell, i) {
                var fill = new Array(Math.max(0, w[i] - cell.length) + 1).join(' ');
                return (al[i] === 'R') ? fill + cell : cell + fill;
            }).join(sepCh).replace(/\s+$/, '');
        });
    }

    // Konflikt, který by tiše rozbil soubor: desetinná čárka + čárka jako oddělovač.
    function conflict(c) { return c.dsep === ',' && c.sep === 'comma'; }

    function buildText(c) {
        var rows = buildRows(pts(), c);
        return renderRows(rows, c).join('\r\n') + '\r\n';
    }

    // ---------------------------------------------------------------------------
    // stažení souboru (Blob — kvůli CP1250 potřebujeme bajty, ne data: URL)
    // ---------------------------------------------------------------------------
    function download(name, bytesOrText, mime) {
        var blob = (bytesOrText instanceof Uint8Array)
            ? new Blob([bytesOrText], { type: mime })
            : new Blob([bytesOrText], { type: mime + ';charset=utf-8' });
        // Seznam souřadnic je konec denní smyčky — musí se dostat do kanceláře. Na
        // iPhonu to umí jen systémový list sdílení (js/sdilet-soubor.js); atribut
        // download tam u blob: URL nespolehlivě mlčí.
        if (typeof window.agShareOrDownload === 'function') {
            return window.agShareOrDownload(blob, name, mime)['catch'](function (e) {
                window.AG && AG.swallow && AG.swallow(e, 'seznam-souradnic:ven');
                return 'fail';
            });
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function doExport() {
        var list = pts();
        if (!list.length) { msg('Nemáte žádné body.'); return; }
        if (conflict(cfg)) { msg('Desetinná čárka nejde kombinovat s čárkou jako oddělovačem — řádek by se rozpadl. Přepni jedno z toho.'); return; }
        var text = buildText(cfg);
        var proj = (typeof activeProjectId !== 'undefined') ? activeProjectId : 'body';
        var fname = 'body_' + proj + '.' + (cfg.ext || 'txt');
        var mime = cfg.ext === 'csv' ? 'text/csv' : 'text/plain';
        if (cfg.enc === 'cp1250') download(fname, encodeCp1250(text), mime);
        else if (cfg.enc === 'utf8bom') download(fname, '﻿' + text, mime);
        else download(fname, text, mime);
        saveCfg();
        close();
    }

    function msg(t) {
        if (typeof agInfo === 'function') agInfo(t); else alert(t);
    }

    // ---------------------------------------------------------------------------
    // dialog
    // ---------------------------------------------------------------------------
    function applyPreset(id) {
        var p = null;
        for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) p = PRESETS[i];
        cfg.preset = id;
        if (p && p.cfg) for (var k in p.cfg) cfg[k] = p.cfg[k];
    }

    function opt(sel, val, label) { return '<option value="' + val + '"' + (sel === val ? ' selected' : '') + '>' + label + '</option>'; }

    function sheetHtml() {
        var pres = PRESETS.map(function (p) { return opt(cfg.preset, p.id, p.nm); }).join('');
        return '' +
            '<div class="szs-sheet" role="dialog" aria-label="Seznam souřadnic pro kancelář">' +
            '<div class="szs-head"><div class="szs-title">Seznam souřadnic pro kancelář</div>' +
            '<button type="button" class="szs-x" id="szs-close" aria-label="Zavřít">✕</button></div>' +
            '<div class="szs-sub">Nastav tvar tak, jak ho čeká protistrana, a zkontroluj náhled. Nastavení si appka zapamatuje.</div>' +
            '<div class="szs-body">' +
            '<label class="szs-row"><span>Předvolba</span><select id="szs-preset">' + pres + '</select></label>' +
            '<div class="szs-hint" id="szs-hint"></div>' +
            '<label class="szs-row"><span>Pořadí souřadnic</span><select id="szs-ord">' + opt(cfg.ord, 'YX', 'Y X (obvyklé)') + opt(cfg.ord, 'XY', 'X Y') + '</select></label>' +
            '<label class="szs-row"><span>Oddělovač</span><select id="szs-sep">' + opt(cfg.sep, 'space', 'mezera') + opt(cfg.sep, 'tab', 'tabulátor') + opt(cfg.sep, 'semi', 'středník') + opt(cfg.sep, 'comma', 'čárka') + '</select></label>' +
            '<label class="szs-row"><span>Desetinná místa</span><select id="szs-dec">' + opt(String(cfg.dec), '2', '2 (cm)') + opt(String(cfg.dec), '3', '3 (mm)') + '</select></label>' +
            '<label class="szs-row"><span>Desetinná značka</span><select id="szs-dsep">' + opt(cfg.dsep, '.', 'tečka') + opt(cfg.dsep, ',', 'čárka') + '</select></label>' +
            '<label class="szs-row"><span>Výška Z</span><select id="szs-z">' + opt(cfg.z, 'zero', 'vždy (chybí → 0.00)') + opt(cfg.z, 'skip', 'sloupec vynechat') + '</select></label>' +
            '<label class="szs-row"><span>Kód bodu</span><input type="checkbox" id="szs-kod"' + (cfg.kod ? ' checked' : '') + '></label>' +
            '<label class="szs-row"><span>Třída přesnosti</span><input type="checkbox" id="szs-tr"' + (cfg.tr ? ' checked' : '') + '></label>' +
            '<label class="szs-row szs-sub-row" id="szs-trv-row"><span>— hodnota pro všechny body</span><input type="number" id="szs-trv" min="1" max="9" step="1" value="' + (cfg.trv == null ? 3 : cfg.trv) + '"></label>' +
            '<div class="szs-note">Třídu appka <b>neodvozuje</b> z přesnosti GPS — je to právní údaj o bodu, ne okamžitá přesnost fixu. Vypíše se hodnota, kterou zadáš.</div>' +
            '<label class="szs-row"><span>Kódování</span><select id="szs-enc">' + opt(cfg.enc, 'utf8', 'UTF-8') + opt(cfg.enc, 'cp1250', 'Windows-1250 (Groma, Kokeš)') + opt(cfg.enc, 'utf8bom', 'UTF-8 s BOM (Excel)') + '</select></label>' +
            '<label class="szs-row"><span>Zarovnat sloupce</span><input type="checkbox" id="szs-align"' + (cfg.align ? ' checked' : '') + '></label>' +
            '<label class="szs-row"><span>Přípona souboru</span><select id="szs-ext">' + opt(cfg.ext, 'txt', '.txt') + opt(cfg.ext, 'stx', '.stx (Kokeš)') + opt(cfg.ext, 'csv', '.csv') + '</select></label>' +
            '<div class="szs-prev-lab">Náhled souboru</div>' +
            '<pre class="szs-prev" id="szs-prev"></pre>' +
            '<div class="szs-warn" id="szs-warn"></div>' +
            '</div>' +
            '<div class="szs-foot">' +
            '<button type="button" class="btn" id="szs-go">Exportovat</button>' +
            '<button type="button" class="btn btn-secondary" id="szs-cancel">Zpět</button>' +
            '</div></div>';
    }

    function readForm() {
        function v(id) { var e = document.getElementById(id); return e ? e.value : null; }
        function ck(id) { var e = document.getElementById(id); return e ? !!e.checked : false; }
        cfg.ord = v('szs-ord'); cfg.sep = v('szs-sep'); cfg.dec = parseInt(v('szs-dec'), 10) || 2;
        cfg.dsep = v('szs-dsep'); cfg.z = v('szs-z'); cfg.kod = ck('szs-kod');
        cfg.tr = ck('szs-tr'); cfg.trv = parseInt(v('szs-trv'), 10); if (!isFinite(cfg.trv)) cfg.trv = 3;
        cfg.enc = v('szs-enc'); cfg.align = ck('szs-align'); cfg.ext = v('szs-ext');
    }

    function refresh() {
        var hint = document.getElementById('szs-hint');
        if (hint) {
            var h = '';
            for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === cfg.preset) h = PRESETS[i].hint || '';
            hint.textContent = h;
        }
        var trvRow = document.getElementById('szs-trv-row');
        if (trvRow) trvRow.style.display = cfg.tr ? '' : 'none';

        var prev = document.getElementById('szs-prev');
        var warn = document.getElementById('szs-warn');
        var list = pts();
        if (prev) {
            if (!list.length) prev.textContent = '(zakázka zatím nemá žádné body)';
            else {
                var rows = buildRows(list.slice(0, 4), cfg);
                var txt = renderRows(rows, cfg).join('\n');
                if (list.length > 4) txt += '\n… (' + list.length + ' bodů celkem)';
                prev.textContent = txt;
            }
        }
        if (warn) {
            if (conflict(cfg)) { warn.textContent = '⚠ Desetinná čárka + čárka jako oddělovač: řádek by se rozpadl. Přepni jedno z toho.'; warn.style.display = ''; }
            else if (cfg.enc === 'cp1250') { warn.textContent = 'Windows-1250: znak, který v něm není, se zapíše bez diakritiky.'; warn.style.display = ''; }
            else { warn.textContent = ''; warn.style.display = 'none'; }
        }
    }

    function close() {
        if (overlay) { overlay.classList.remove('open'); setTimeout(function () { if (overlay) { overlay.remove(); overlay = null; } }, 10); }
    }

    function open() {
        loadCfg();
        if (overlay) close();
        overlay = document.createElement('div');
        overlay.className = 'szs-overlay';
        overlay.innerHTML = sheetHtml();
        document.body.appendChild(overlay);
        // třída .open až po vložení do DOM, ať naběhne přechod
        setTimeout(function () { if (overlay) overlay.classList.add('open'); }, 10);

        // POZOR: posluchače navazuje VÝHRADNĚ wire() — když se navazovalo i tady,
        // každá změna přepočítala náhled dvakrát a po přepnutí předvolby přibývaly
        // další a další kopie posluchačů.
        wire();
        refresh();
    }

    // navázání tlačítek (voláme i po překreslení dialogu předvolbou)
    function wire() {
        var c1 = document.getElementById('szs-close'), c2 = document.getElementById('szs-cancel'), go = document.getElementById('szs-go');
        if (c1) c1.addEventListener('click', close);
        if (c2) c2.addEventListener('click', close);
        if (go) go.addEventListener('click', function () { readForm(); doExport(); });
        var ps = document.getElementById('szs-preset');
        if (ps) ps.addEventListener('change', function () {
            applyPreset(ps.value);
            overlay.innerHTML = sheetHtml();
            wire(); refresh();
        });
        var ids = ['szs-ord', 'szs-sep', 'szs-dec', 'szs-dsep', 'szs-z', 'szs-kod', 'szs-tr', 'szs-trv', 'szs-enc', 'szs-align', 'szs-ext'];
        ids.forEach(function (id) {
            var e = document.getElementById(id);
            if (!e) return;
            var h = function () {
                readForm();
                cfg.preset = 'vlastni';
                var p = document.getElementById('szs-preset'); if (p) p.value = 'vlastni';
                refresh();
            };
            e.addEventListener('change', h);
            if (e.tagName === 'INPUT' && e.type === 'number') e.addEventListener('input', h);
        });
    }

    // ---------------------------------------------------------------------------
    // veřejné rozhraní — jméno funkce hlásí výběr formátů v index.html
    // ---------------------------------------------------------------------------
    window.exportPointsSeznam = function () {
        if (!pts().length) { msg('Nemáte žádné body.'); return; }
        open();
    };
    window.AGSeznam = { open: open, buildText: buildText, encodeCp1250: encodeCp1250 };
})();
