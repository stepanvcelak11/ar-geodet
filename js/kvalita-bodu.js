// ===== AR Geodet — KVALITA MĚŘENÍ A PROTOKOL (ODPOJITELNÁ vrstva) ==============
// PROČ: appka rozptyl měření POČÍTALA už dřív (sigma a sterr v logika.js i
// v brutal-gps.js), ale k uloženému bodu se z toho dostala jediná hodnota —
// `acc`. Zmizelo, KOLIKA odečty vznikla a jaký byl kolem nich rozptyl. Přesně
// to je ale to, čím se přesnost dokládá: „bod je z 240 epoch, σ 0,42 m" je
// doklad, „±0,3 m" je tvrzení.
//
// CO DĚLÁ:
//   1) K nově uloženému bodu doplní do prov: sigma (rozptyl odečtů),
//      n (kolik odečtů se použilo) a total (kolik jich přišlo celkem).
//      Neinvazivně — obalením window.saveCustomPoint, stejně jako to dělá
//      js/ref-calibration.js. Do logika.js se nesahá.
//   2) Přidá nástroj „Protokol kvality" — tabulku všech bodů zakázky s metodou,
//      dosaženou přesností, σ a počtem epoch. Jde vyexportovat jako text
//      (k zakázce) nebo CSV (do kanceláře).
//
// ZNAČENÍ (drží se toho, co appka počítá):
//   σ  (sigma) — rozptyl jednotlivých odečtů kolem středu. Říká, jak klidné
//                bylo měření.
//   ±  (sterr) — směrodatná chyba VÝSLEDKU. Menší než σ, protože průměrování
//                pomáhá — ale jen po mez, kterou brutal-gps.js drží zdola
//                (systematiku multipathu průměr neodstraní).
//
// Odstranění: smaž js/kvalita-bodu.js + jeho řádky v index.html, v sw.js
// a záznam 'kvalita-bodu' v js/tools-registry.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGKvalita) return;

    var MODAL_ID = 'ag-kv-modal';
    var STYLE_ID = 'ag-kv-style';
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 3-4 3 3 4-6"/><circle cx="7" cy="15" r="1.2"/><circle cx="10" cy="11" r="1.2"/><circle cx="13" cy="14" r="1.2"/><circle cx="17" cy="8" r="1.2"/></svg>';

    function esc(s) {
        return (window.AG && AG.esc) ? AG.esc(s)
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }
    function toast(m) {
        try { if (window.AG && AG.toast) return AG.toast(m); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kvalita-bodu:toast'); }
        try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kvalita-bodu:toast'); }
    }
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde); } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'kvalita-bodu:swallow'); } }

    function body() {
        try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; }
        catch (e) { return []; }
    }

    // ================================================================
    //  1) doplnění kvality k novému bodu
    // ================================================================
    // Snímek se bere PŘED uložením: saveCustomPoint si pendingPointAccuracy
    // po sobě nuluje, takže po návratu už by nebylo z čeho číst.
    function snapshot() {
        try {
            var r = (typeof gpsAvgResult !== 'undefined') ? gpsAvgResult : null;
            if (!r || r.coarse || !isFinite(r.sigma)) return null;
            return {
                sigma: Math.round(r.sigma * 1000) / 1000,
                n: r.n || 0,
                total: r.total || r.n || 0
            };
        } catch (e) { return null; }
    }

    function wrapSave() {
        if (typeof window.saveCustomPoint !== 'function' || window.saveCustomPoint._agKvWrapped) return;
        var orig = window.saveCustomPoint;
        var wrapped = function () {
            var pred = body().length;
            var editace = false;
            try { editace = (typeof editingCustomPointId !== 'undefined') && !!editingCustomPointId; } catch (e) { swallow(e, 'kvalita-bodu:wrapped'); }
            var snap = snapshot();

            var ret = orig.apply(this, arguments);

            try {
                if (editace || !snap) return ret;
                var arr = body();
                if (!arr.length || arr.length <= pred) return ret;    // nepřibyl bod
                var p = arr[arr.length - 1];
                if (!p || !p.prov || p.prov.sigma != null) return ret; // idempotence
                // Kvalitu má smysl psát jen k bodu, který VZNIKL z GPS. Ručně
                // zadaná Y/X žádný rozptyl odečtů nemají a číslo by lhalo.
                if (p.prov.origin !== 'gps' && p.prov.origin !== 'gps-avg' && p.prov.acc == null) return ret;
                p.prov.sigma = snap.sigma;
                p.prov.n = snap.n;
                p.prov.total = snap.total;
                try { if (typeof setStoredData === 'function') setStoredData('arCustomPoints12', JSON.stringify(arr)); } catch (e) { swallow(e, 'kvalita-bodu:ulozeni'); }
            } catch (e) { swallow(e, 'kvalita-bodu:wrapped'); }
            return ret;
        };
        wrapped._agKvWrapped = true;
        wrapped._agOrig = orig;
        window.saveCustomPoint = wrapped;
    }

    // ================================================================
    //  2) protokol
    // ================================================================
    var METODA = {
        'gps-avg': 'GPS průměrování',
        'gps': 'GPS jednorázově',
        'ruc': 'ručně zadáno',
        'import': 'import',
        'mapa': 'z mapy',
        'rajon': 'rajón',
        'protinani': 'protínání',
        'tachy': 'tachymetrie'
    };
    // Co se s bodem po kontrole stalo — do protokolu to patri, protoze to meni
    // vyklad souradnic: „prumer obou" znamena jinou polohu nez ta puvodne zamerena.
    var REZIM = { keep: 'ponechán původní', mean: 'průměr obou', 'new': 'přepsáno novým' };
    function metoda(p) {
        var o = (p.prov && p.prov.origin) || p.origin || '';
        return METODA[o] || (o || '—');
    }
    function num(v, d) {
        return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d == null ? 2 : d).replace('.', ',');
    }
    function sjtsk(p) {
        try {
            if (typeof proj4 !== 'function') return null;
            var s = proj4('EPSG:4326', 'EPSG:5514', [p.lng, p.lat]);
            return { Y: Math.abs(s[0]), X: Math.abs(s[1]) };
        } catch (e) { return null; }
    }
    function kdy(p) {
        var t = (p.prov && p.prov.ts) || null;
        if (!t) return '—';
        try { return new Date(t).toLocaleString('cs-CZ'); } catch (e) { return '—'; }
    }
    // Do tabulky na telefonu se plné datum nevejde a ukroji sloupec. Rok se vypouští
    // (zakázka je z letoška), v protokolu pro kancelář zůstává úplné.
    function kdyKratce(p) {
        var t = (p.prov && p.prov.ts) || null;
        if (!t) return '—';
        try {
            var d = new Date(t), dnes = new Date();
            var cas = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
            if (d.toDateString() === dnes.toDateString()) return cas;
            var den = d.getDate() + '.' + (d.getMonth() + 1) + '.';
            return den + (d.getFullYear() !== dnes.getFullYear() ? d.getFullYear() : '') + ' ' + cas;
        } catch (e) { return '—'; }
    }

    // Body se řadí od nejnovějšího — v terénu se nejčastěji dohledává to poslední.
    function radky() {
        return body().slice().sort(function (a, b) {
            return ((b.prov && b.prov.ts) || 0) - ((a.prov && a.prov.ts) || 0);
        });
    }

    // ---- KONTROLNÍ MĚŘENÍ (js/dvoji-mereni.js) --------------------------------------
    // Bod, který byl změřen podruhé s odstupem, nese v prov.recheck rozdíl obou
    // určení a v prov.trueAcc přesnost ODVOZENOU z toho rozdílu. To je jediné
    // číslo v celém protokolu, které vzniklo MĚŘENÍM, ne odhadem z jednoho stání —
    // proto tu má vlastní sloupec a v textovém protokolu vlastní odstavec.
    function kontrola(p) {
        var rc = p && p.prov && p.prov.recheck;
        return (rc && isFinite(rc.d)) ? rc : null;
    }
    // Meze slovního hodnocení musí sedět s js/dvoji-mereni.js — kdyby se rozešly,
    // tentýž bod by byl v jednom okně „v pořádku" a ve druhém „velký rozdíl".
    function kontrolaTrida(d) {
        if (d == null || !isFinite(d)) return 'none';
        if (d <= 1.50) return 'ok';
        if (d <= 3.00) return 'warn';
        return 'bad';
    }
    function kontrolaKratce(p) {
        var rc = kontrola(p);
        if (!rc) return '—';
        var t = 'Δ' + num(rc.d);
        if (p.prov.trueAcc != null && isFinite(p.prov.trueAcc)) t += ' → ±' + num(p.prov.trueAcc);
        return t;
    }

    function hodnoceni(p) {
        var a = (p.prov && p.prov.acc != null) ? p.prov.acc : (p.acc != null ? p.acc : null);
        if (a == null) return { t: '—', c: 'none' };
        if (a <= 0.5) return { t: '±' + num(a), c: 'ok' };
        if (a <= 2) return { t: '±' + num(a), c: 'warn' };
        return { t: '±' + num(a), c: 'bad' };
    }

    function tabulka() {
        var ps = radky();
        if (!ps.length) return '<p class="ag-kv-empty">V téhle zakázce zatím žádné body nejsou.</p>';
        var h = '<div class="ag-kv-scroll"><table class="ag-kv-t"><thead><tr>' +
            '<th>Bod</th><th>Metoda</th><th>±&nbsp;chyba</th><th>σ</th><th>epoch</th><th>Kontrola</th><th>Kdy</th>' +
            '</tr></thead><tbody>';
        ps.forEach(function (p) {
            var q = p.prov || {};
            var hd = hodnoceni(p);
            h += '<tr>' +
                '<td class="ag-kv-n">' + esc(p.name || p.id || '?') + '</td>' +
                '<td>' + esc(metoda(p)) + '</td>' +
                '<td class="ag-kv-num" data-q="' + hd.c + '">' + hd.t + '</td>' +
                '<td class="ag-kv-num">' + (q.sigma != null ? num(q.sigma) : '—') + '</td>' +
                '<td class="ag-kv-num">' + (q.n != null ? (q.n + (q.total && q.total !== q.n ? '/' + q.total : '')) : '—') + '</td>' +
                '<td class="ag-kv-num" data-q="' + kontrolaTrida(q.recheck ? q.recheck.d : null) + '">' + esc(kontrolaKratce(p)) + '</td>' +
                '<td class="ag-kv-t2">' + esc(kdyKratce(p)) + '</td>' +
                '</tr>';
        });
        return h + '</tbody></table></div>';
    }

    function protokolText() {
        var ps = radky(), L = [];
        L.push('AR Geodet — PROTOKOL KVALITY MĚŘENÍ');
        L.push('Vygenerováno: ' + new Date().toLocaleString('cs-CZ'));
        L.push('Počet bodů: ' + ps.length);
        L.push('');
        L.push('VYSVĚTLIVKY');
        L.push('  ± chyba  směrodatná chyba výsledné polohy (sterr)');
        L.push('  σ        rozptyl jednotlivých odečtů kolem středu');
        L.push('  epoch    kolik odečtů se použilo / kolik jich přišlo');
        L.push('  d KONTR  rozdíl dvou NEZÁVISLÝCH určení téhož bodu s časovým odstupem');
        L.push('  ± OVĚŘ   přesnost odvozená z toho rozdílu (viz odstavec KONTROLNÍ MĚŘENÍ)');
        L.push('  Souřadnice v S-JTSK (EPSG:5514).');
        L.push('');
        L.push('BOD; Y; X; METODA; ± CHYBA [m]; SIGMA [m]; EPOCH; d KONTR [m]; ± OVĚŘ [m]; VÝSLEDEK KONTROLY; KDY');
        ps.forEach(function (p) {
            var q = p.prov || {}, s = sjtsk(p);
            var a = (q.acc != null ? q.acc : (p.acc != null ? p.acc : null));
            L.push([
                (p.name || p.id || '?'),
                s ? s.Y.toFixed(2) : '',
                s ? s.X.toFixed(2) : '',
                metoda(p),
                a != null ? a.toFixed(2) : '',
                q.sigma != null ? q.sigma.toFixed(2) : '',
                q.n != null ? (q.n + (q.total && q.total !== q.n ? '/' + q.total : '')) : '',
                (q.recheck && isFinite(q.recheck.d)) ? q.recheck.d.toFixed(2) : '',
                (q.trueAcc != null && isFinite(q.trueAcc)) ? q.trueAcc.toFixed(2) : '',
                q.recheck ? (REZIM[q.recheck.mode] || q.recheck.mode) : '',
                kdy(p)
            ].join('; '));
        });
        L.push('');
        L.push('POZNÁMKA K VÝKLADU');
        L.push('  Hodnoty popisují VNITŘNÍ shodu měření telefonem. Systematickou chybu');
        L.push('  (odrazy signálu od fasád, troposféra) průměrování neodstraní, proto se');
        L.push('  ± chyba zdola omezuje reálnou mezí. Údaj nenahrazuje kontrolní měření');
        L.push('  nezávislou metodou.');
        var oc = ps.filter(function (p) { return kontrola(p); }).length;
        L.push('');
        L.push('KONTROLNÍ MĚŘENÍ  (ověřeno bodů: ' + oc + ' z ' + ps.length + ')');
        L.push('  Sloupec d KONTR je rozdíl DVOU NEZÁVISLÝCH určení téhož bodu, mezi');
        L.push('  kterými uplynul čas — konstelace družic se otočila a odrazy signálu');
        L.push('  se do každého určení promítly jinak. Na rozdíl od sigmy tenhle rozdíl');
        L.push('  systematiku OBSAHUJE, takže je to jediný údaj v protokolu, který');
        L.push('  vznikl měřením, a ne odhadem z jednoho stání.');
        L.push('  Z rozdílu d se odvozuje ± OVĚŘ: d/sqrt(2) pro jedno určení, d/2 pro');
        L.push('  průměr obou. Odhad má jeden stupeň volnosti, takže je sám nejistý —');
        L.push('  vypovídá o řádu, ne o setinách.');
        L.push('  Prázdný sloupec = bod kontrolním měřením neprošel; jeho ± chyba je');
        L.push('  pouze vnitřní shoda a skutečná odchylka může být násobně větší.');
        return L.join('\r\n');
    }

    function protokolCsv() {
        var ps = radky(), L = ['bod;Y;X;metoda;chyba_m;sigma_m;epoch_pouzito;epoch_celkem;kontrola_delta_m;kontrola_chyba_m;kontrola_rezim;kontrola_kdy;kdy'];
        ps.forEach(function (p) {
            var q = p.prov || {}, s = sjtsk(p);
            var a = (q.acc != null ? q.acc : (p.acc != null ? p.acc : null));
            L.push([
                (p.name || p.id || '?').replace(/;/g, ','),
                s ? s.Y.toFixed(2) : '', s ? s.X.toFixed(2) : '',
                metoda(p),
                a != null ? a.toFixed(2) : '',
                q.sigma != null ? q.sigma.toFixed(2) : '',
                q.n != null ? q.n : '', q.total != null ? q.total : '',
                (q.recheck && isFinite(q.recheck.d)) ? q.recheck.d.toFixed(3) : '',
                (q.trueAcc != null && isFinite(q.trueAcc)) ? q.trueAcc.toFixed(3) : '',
                q.recheck ? (REZIM[q.recheck.mode] || q.recheck.mode) : '',
                (q.recheck && q.recheck.t2) ? new Date(q.recheck.t2).toLocaleString('cs-CZ') : '',
                kdy(p)
            ].join(';'));
        });
        // BOM: bez něj Excel v češtině rozhází diakritiku
        return '﻿' + L.join('\r\n');
    }

    function download(name, text, mime) {
        try {
            var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click();
            setTimeout(function () { try { URL.revokeObjectURL(url); a.remove(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kvalita-bodu:download'); } }, 400);
            toast('Uloženo: ' + name);
        } catch (e) {
            swallow(e, 'kvalita-bodu:download');
            toast('Soubor se nepodařilo uložit.');
        }
    }

    function dnesniNazev(pripona) {
        var d = new Date();
        var p = function (v) { return (v < 10 ? '0' : '') + v; };
        return 'kvalita-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.' + pripona;
    }

    // ---- okno -----------------------------------------------------------------------
    var _scope = null;

    function styly() {
        var css = [
            '#' + MODAL_ID + '{position:fixed;inset:0;z-index:1000060;display:none;flex-direction:column;',
            '  background:var(--modal-bg,rgba(14,18,24,0.97));font-family:var(--font-ui,sans-serif);color:var(--text-color,#eceef2);}',
            '#' + MODAL_ID + '.on{display:flex;}',
            '#' + MODAL_ID + ' .ag-kv-head{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 12px) 14px 10px;',
            '  border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.1));}',
            '#' + MODAL_ID + ' .ag-kv-head h3{margin:0;font-size:calc(16px * var(--ag-font-scale,1));font-family:var(--font-display,inherit);}',
            '#' + MODAL_ID + ' .ag-kv-x{margin-left:auto;width:40px;height:40px;flex:0 0 40px;border-radius:12px;cursor:pointer;',
            '  background:var(--surface-2,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  color:var(--text-color,#eceef2);font-size:18px;line-height:1;}',
            '#' + MODAL_ID + ' .ag-kv-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 12px 4px;}',
            '#' + MODAL_ID + ' .ag-kv-lead{margin:0 0 10px;font-size:calc(12px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);line-height:1.45;}',
            '#' + MODAL_ID + ' .ag-kv-empty{color:var(--text-muted,#9aa1ac);text-align:center;padding:30px 10px;}',
            // Siroky obsah scrolluje SAM V SOBE — stranka se nikdy nesmi hybat do stran
            '.ag-kv-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}',
            '.ag-kv-t{width:100%;min-width:340px;border-collapse:collapse;font-size:calc(12px * var(--ag-font-scale,1));}',
            '.ag-kv-t th{text-align:left;padding:7px 6px;color:var(--text-muted,#9aa1ac);font-weight:600;white-space:nowrap;',
            '  border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.14));position:sticky;top:0;background:var(--modal-bg,#0e1218);}',
            '.ag-kv-t td{padding:7px 6px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.07));vertical-align:top;}',
            '.ag-kv-t .ag-kv-n{font-weight:700;}',
            '.ag-kv-t .ag-kv-num{font-family:var(--font-mono,ui-monospace,monospace);text-align:right;white-space:nowrap;}',
            '.ag-kv-t .ag-kv-t2{color:var(--text-muted,#9aa1ac);white-space:nowrap;font-size:calc(11px * var(--ag-font-scale,1));}',
            '.ag-kv-t [data-q="ok"]{color:var(--accent-bright,#3eb487);}',
            '.ag-kv-t [data-q="warn"]{color:var(--warning,#fbbf24);}',
            '.ag-kv-t [data-q="bad"]{color:var(--danger,#fb7185);}',
            '#' + MODAL_ID + ' .ag-kv-acts{display:flex;gap:8px;padding:10px 12px calc(env(safe-area-inset-bottom,0px) + 12px);',
            '  border-top:1px solid var(--glass-border,rgba(255,255,255,0.1));}',
            '#' + MODAL_ID + ' .ag-kv-acts button{flex:1;min-height:44px;border-radius:12px;cursor:pointer;font-weight:600;',
            '  font-size:calc(13px * var(--ag-font-scale,1));background:var(--surface-2,rgba(255,255,255,0.06));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));color:var(--text-color,#eceef2);}',
            '#' + MODAL_ID + ' .ag-kv-acts button.prim{background:var(--accent-fill,var(--accent,#2f9e74));border-color:transparent;color:#fff;}'
        ].join('');
        if (window.AG && AG.style) return AG.style(STYLE_ID, css);
        if (document.getElementById(STYLE_ID)) return false;
        var st = document.createElement('style'); st.id = STYLE_ID; st.textContent = css;
        document.head.appendChild(st); return true;
    }

    function build() {
        var el = document.getElementById(MODAL_ID);
        if (el) return el;
        styly();
        el = document.createElement('div');
        el.id = MODAL_ID;
        el.innerHTML =
            '<div class="ag-kv-head"><h3>Protokol kvality</h3>' +
            '<button class="ag-kv-x" type="button" aria-label="Zavřít">✕</button></div>' +
            '<div class="ag-kv-body">' +
            '<p class="ag-kv-lead">Čím byl bod změřen a jak dobře. <b>±&nbsp;chyba</b> je směrodatná chyba výsledku, <b>σ</b> rozptyl jednotlivých odečtů, <b>epoch</b> kolik odečtů se použilo. Ručně zadané body rozptyl nemají.</p>' +
            '<div class="ag-kv-tab"></div></div>' +
            '<div class="ag-kv-acts">' +
            '<button type="button" data-a="txt">Protokol (.txt)</button>' +
            '<button type="button" data-a="csv" class="prim">Tabulka (.csv)</button>' +
            '</div>';
        document.body.appendChild(el);
        return el;
    }

    function open() {
        var el = build();
        el.querySelector('.ag-kv-tab').innerHTML = tabulka();
        el.classList.add('on');
        // AG.scope: všechno, co se navěsí při otevření, se při zavření zruší jedním
        // voláním. Bez toho by se posluchače vrstvily s každým otevřením.
        if (_scope) _scope.off();
        _scope = (window.AG && AG.scope) ? AG.scope('kvalita-bodu') : null;
        var zavri = function () { close(); };
        var naKlavesu = function (e) { if (e.key === 'Escape') close(); };
        if (_scope) {
            _scope.on(el.querySelector('.ag-kv-x'), 'click', zavri);
            _scope.on(document, 'keydown', naKlavesu);
            _scope.on(el.querySelector('.ag-kv-acts'), 'click', naAkci);
        } else {
            el.querySelector('.ag-kv-x').addEventListener('click', zavri);
            document.addEventListener('keydown', naKlavesu);
            el.querySelector('.ag-kv-acts').addEventListener('click', naAkci);
        }
    }

    function naAkci(e) {
        var b = e.target.closest('button[data-a]'); if (!b) return;
        var a = b.getAttribute('data-a');
        if (a === 'txt') download(dnesniNazev('txt'), protokolText(), 'text/plain');
        else if (a === 'csv') download(dnesniNazev('csv'), protokolCsv(), 'text/csv');
    }

    function close() {
        var el = document.getElementById(MODAL_ID);
        if (el) el.classList.remove('on');
        if (_scope) { _scope.off(); _scope = null; }
    }

    // ---- start ----------------------------------------------------------------------
    var _tries = 0;
    function init() {
        wrapSave();
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({
                id: 'kvalita-bodu', label: 'Protokol kvality', icon: ICON,
                cat: 'Pomůcky', order: 64, onClick: open
            });
        }
        // saveCustomPoint i mřížka nástrojů vznikají až po startu — zkoušej chvíli
        if ((typeof window.saveCustomPoint !== 'function' || !window.saveCustomPoint._agKvWrapped) && _tries++ < 25) {
            setTimeout(init, 400);
        }
    }
    // POZOR: `load` uz mohl PROBEHNOUT. Modul se nacita pres ag/lazy, tedy AZ PO
    // vykresleni stranky — posluchac na 'load' by se pak nespustil nikdy a modul
    // by tise nedelal nic (dlazdice by nevznikla, obal saveCustomPoint taky ne).
    function nastartuj() { setTimeout(init, 500); }
    if (document.readyState === 'complete') nastartuj();
    else window.addEventListener('load', nastartuj);

    window.AGKvalita = { open: open, close: close, text: protokolText, csv: protokolCsv };
    window.agOpenKvalitaBodu = open;
})();
