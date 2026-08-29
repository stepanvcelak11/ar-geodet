// ===== AR Geodet — PROTOKOL O VYTYČENÍ (ODPOJITELNÁ vrstva) =====================
// Neinvazivní vrstva: NEEDITUJE js/vytycovani.js ani logika.js — jen za běhu
// OBALÍ toggleStaked() a přidá vlastní nástroj.
//
// PROČ: vytyčovací checklist (js/vytycovani.js) si u odškrtnutého bodu pamatoval
// jen ČAS a PŘESNOST TELEFONU v tu chvíli. Export „protokolu vytyčení" pak byl
// tabulka projektovaných Y/X a časů — tedy soupis toho, CO SE MĚLO vytyčit.
// To, co protokol o vytyčení dělá protokolem, tam chybělo: KAM KOLÍK OPRAVDU
// PŘIŠEL a JAK DALEKO to je od projektu.
//
// CO MODUL DĚLÁ:
//   1) Při odškrtnutí bodu zapíše i SKUTEČNOU polohu, kde jsi stál — přednostně
//      z průměrování GPS (gpsAvgResult), jinak poslední fix. Ukládá se do téhož
//      záznamu, který si vede checklist ('arStakeout12'), takže se to veze
//      s zakázkou i v záloze.
//   2) Přidá nástroj „Protokol vytyčení": tabulka projekt → skutečnost,
//      ΔY, ΔX, polohová odchylka Δp, mezní odchylka a verdikt.
//      Výstup: tisk / PDF (@media print) a CSV.
//
// MEZNÍ ODCHYLKA: mezní polohová odchylka = 2·√2·mxy podle kódu kvality
// (katastrální vyhláška č. 357/2013 Sb., příloha bod 13) — tytéž hodnoty, jaké
// appka ukazuje v Příručce (data/predpisy.json) a v Ověření bodů, ať si tři
// místa v appce neodporují.
//
// POCTIVĚ: odchylka změřená telefonem je jen tak dobrá, jak dobrá byla poloha
// při odškrtnutí. Když měl telefon v tu chvíli ±3 m, je ta odchylka k ničemu —
// protokol proto u KAŽDÉHO řádku vypisuje i dosaženou přesnost a řádky, kde
// je přesnost horší než polovina meze, označí jako NEPRŮKAZNÉ. Radši žádný
// verdikt než verdikt, na který se nedá spolehnout.
//
// STARŠÍ ZÁZNAMY: body odškrtnuté dřív, než tenhle modul existoval, skutečnou
// polohu nemají — v protokolu mají „—" a poznámku „bez záznamu polohy".
//
// Odstranění: smaž js/protokol-vytyceni.js + řádek <script> v index.html, záznam
// 'protokol-vytyceni' v js/tools-registry.js a jeho text v data/navody.json
// (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGProtVyt) return;

    var MODAL_ID = 'ag-pv-modal';
    var STYLE_ID = 'ag-pv-style';
    var LS_KOD = 'agOvereniKod_v1';     // ZÁMĚRNĚ týž klíč jako Ověření bodů

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h4"/></svg>';

    // Mezní polohová odchylka podle kódu kvality. Hodnoty se NEPOČÍTAJÍ ze vzorce,
    // ale berou se TAK, JAK JE PUBLIKUJE tabulka v katastrální vyhlášce
    // č. 357/2013 Sb. (příloha bod 13) — tutéž tabulku ukazuje Příručka
    // (data/predpisy.json). Vzorec 2·√2·mxy dá pro kód 3 hodnotu 0,3960 m, kdežto
    // vyhláška uvádí 0,39 m; kdyby appka počítala, hlásila by o centimetr jinou mez,
    // než má uživatel na papíře.
    var MEZ = { 3: 0.39, 4: 0.74, 5: 1.41, 6: 0.59, 7: 1.41, 8: 2.82 };
    function mez(k) { return MEZ[k] || MEZ[3]; }
    function kod() {
        try { var v = parseInt(localStorage.getItem(LS_KOD), 10); if (MEZ[v]) return v; } catch (e) { swallow(e, 'protvyt:kod'); }
        return 3;
    }

    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'protokol-vytyceni'); } catch (err) { /* nic */ } }
    function esc(s) {
        return (window.AG && AG.esc) ? AG.esc(s)
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }
    function toast(m) {
        try { if (window.AG && AG.toast) return AG.toast(m); } catch (e) { swallow(e, 'protvyt:toast'); }
        try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { swallow(e, 'protvyt:toast'); }
    }
    function sjtsk(lat, lng) {
        try {
            if (typeof proj4 !== 'function' || lat == null || lng == null) return null;
            var s = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]);
            return { y: Math.abs(s[0]), x: Math.abs(s[1]) };
        } catch (e) { return null; }
    }

    // ================================================================
    //  1) zápis skutečné polohy při odškrtnutí
    // ================================================================
    // Kde právě stojím. Průměr z GPS je NEPOROVNATELNĚ lepší podklad než jeden
    // fix, ale nemusí být k dispozici — pak bereme poslední fix i s jeho přesností.
    function kdeStojim() {
        try {
            var r = (typeof gpsAvgResult !== 'undefined') ? gpsAvgResult : null;
            if (r && !r.coarse && r.lat != null && r.lng != null) {
                return {
                    lat: r.lat, lng: r.lng,
                    acc: (r.sterr != null && isFinite(r.sterr)) ? r.sterr : null,
                    n: r.n || 0, avg: 1
                };
            }
        } catch (e) { swallow(e, 'protvyt:kdeStojim'); }
        try {
            if (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null) {
                var a = (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy) ? currentGpsAccuracy : null;
                return { lat: userLat, lng: userLng, acc: a, n: 1, avg: 0 };
            }
        } catch (e) { swallow(e, 'protvyt:kdeStojim'); }
        return null;
    }

    function stakeData() {
        try { return (typeof stakeoutData !== 'undefined' && stakeoutData) ? stakeoutData : null; }
        catch (e) { return null; }
    }

    // toggleStaked() odškrtnutí ZAPÍŠE a rovnou uloží. Doplníme skutečnou polohu
    // hned po něm a uložíme znovu — pořadí je důležité, protože při ODškrtnutí
    // (druhé klepnutí) záznam mizí a nemá se do čeho psát.
    function wrapToggle() {
        if (typeof window.toggleStaked !== 'function' || window.toggleStaked._agPvWrapped) return;
        var orig = window.toggleStaked;
        var wrapped = function (pt) {
            var ret = orig.apply(this, arguments);
            try {
                var d = stakeData();
                if (!d || !pt || pt.id == null) return ret;
                var rec = d[pt.id];
                if (!rec || rec.sy != null) return ret;        // zrušeno, nebo už zapsáno
                var me = kdeStojim();
                if (!me) return ret;
                var s = sjtsk(me.lat, me.lng);
                if (!s) return ret;
                rec.slat = me.lat; rec.slng = me.lng;          // skutečná poloha
                rec.sy = Math.round(s.y * 1000) / 1000;
                rec.sx = Math.round(s.x * 1000) / 1000;
                rec.sacc = (me.acc != null) ? Math.round(me.acc * 100) / 100 : null;
                rec.savg = me.avg; rec.sn = me.n;
                if (typeof window.saveStakeout === 'function') window.saveStakeout();
            } catch (e) { swallow(e, 'protvyt:wrapToggle'); }
            return ret;
        };
        wrapped._agPvWrapped = true;
        wrapped._agOrig = orig;
        window.toggleStaked = wrapped;
    }

    // ================================================================
    //  2) protokol
    // ================================================================
    function radky() {
        var d = stakeData();
        if (!d) return [];
        var body = [];
        try { if (typeof arPoints !== 'undefined' && arPoints) body = arPoints; } catch (e) { swallow(e, 'protvyt:radky'); }
        var out = [], m = mez(kod());
        for (var i = 0; i < body.length; i++) {
            var pt = body[i], rec = d[pt.id];
            if (!rec) continue;
            var proj = sjtsk(pt.lat, pt.lng);
            var r = {
                name: pt.name == null ? 'bod' : String(pt.name),
                t: rec.t || 0,
                py: proj ? proj.y : null, px: proj ? proj.x : null,
                sy: (rec.sy != null) ? rec.sy : null, sx: (rec.sx != null) ? rec.sx : null,
                acc: (rec.sacc != null) ? rec.sacc : (rec.acc != null ? rec.acc : null),
                avg: !!rec.savg, n: rec.sn || 0,
                mez: m
            };
            if (r.py != null && r.sy != null) {
                r.dy = r.sy - r.py;
                r.dx = r.sx - r.px;
                r.dp = Math.sqrt(r.dy * r.dy + r.dx * r.dx);
                // Verdikt dává smysl jen tehdy, když je měření aspoň dvakrát
                // přesnější než mez. Jinak by "v mezi" znamenalo jen "netrefil
                // jsem se natolik, aby to bylo vidět i přes šum".
                r.prukazne = (r.acc == null) ? false : (r.acc <= m / 2);
                r.ok = r.dp <= m;
            }
            out.push(r);
        }
        out.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
        return out;
    }

    function cm(v) { return (v == null) ? '—' : String(Math.round(v * 100)); }
    function m3(v) { return (v == null) ? '' : v.toFixed(3); }
    function datum(t) { return t ? new Date(t).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + MODAL_ID + ' table{width:100%;border-collapse:collapse;font-size:calc(11.5px * var(--ag-font-scale, 1));}',
            '#' + MODAL_ID + ' th,#' + MODAL_ID + ' td{padding:5px 3px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.12));text-align:right;white-space:nowrap;}',
            '#' + MODAL_ID + ' th:first-child,#' + MODAL_ID + ' td:first-child{text-align:left;}',
            '#' + MODAL_ID + ' th{opacity:0.7;font-weight:600;}',
            '#' + MODAL_ID + ' td.ok{color:#10b981;font-weight:700;}',
            '#' + MODAL_ID + ' td.mimo{color:#ef4444;font-weight:700;}',
            '#' + MODAL_ID + ' td.nejisto{color:#f59e0b;font-weight:700;}',
            '#' + MODAL_ID + ' td.chybi{opacity:0.55;}',
            '#ag-pv-souhrn{margin:2px 0 10px;font-size:calc(13px * var(--ag-font-scale, 1));}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function stav(r) {
        if (r.dp == null) return { cls: 'chybi', txt: 'bez polohy' };
        if (!r.prukazne) return { cls: 'nejisto', txt: 'neprůkazné' };
        return r.ok ? { cls: 'ok', txt: 'v mezi' } : { cls: 'mimo', txt: 'MIMO' };
    }

    function ensureModal() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = MODAL_ID;
        m.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent); margin-top:0;">Protokol vytyčení</h3>'
            + '<label class="filter-row" style="margin:2px 0 6px;">Mezní odchylka podle kódu kvality: '
            + '<select id="ag-pv-kod" style="margin-left:6px;">'
            + '<option value="3">3 — nové zaměření (mez 39 cm)</option>'
            + '<option value="4">4 — zaměření (mez 74 cm)</option>'
            + '<option value="5">5 — zaměření (mez 141 cm)</option>'
            + '</select></label>'
            + '<div id="ag-pv-souhrn"></div>'
            + '<div class="modal-body" id="ag-pv-list"></div>'
            + '<div style="display:flex; gap:8px; margin-top:10px;">'
            + '<button class="btn btn-secondary" style="flex:1;" id="ag-pv-print">Tisk / PDF</button>'
            + '<button class="btn btn-secondary" style="flex:1;" id="ag-pv-csv">CSV</button>'
            + '</div>'
            + '<div class="row-buttons"><button class="btn btn-secondary" id="ag-pv-close">Zavřít</button></div>'
            + '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-pv-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-pv-csv').addEventListener('click', exportCsv);
        m.querySelector('#ag-pv-print').addEventListener('click', tisk);
        m.querySelector('#ag-pv-kod').addEventListener('change', function () {
            try { localStorage.setItem(LS_KOD, this.value); } catch (e) { swallow(e, 'protvyt:kodSave'); }
            render();
        });
        return m;
    }

    function render() {
        var box = document.getElementById('ag-pv-list');
        var sou = document.getElementById('ag-pv-souhrn');
        if (!box) return;
        var rs = radky();
        if (!rs.length) {
            sou.innerHTML = '';
            box.innerHTML = '<p style="text-align:center; opacity:0.7;">V téhle zakázce zatím není odškrtnutý žádný vytyčený bod. '
                + 'Odškrtávají se ve <b>Vytyčovacím checklistu</b> nebo tlačítkem <b>Vytyčeno ✓</b> v kartě bodu.</p>';
            return;
        }
        var ok = 0, mimoM = 0, nejisto = 0, bez = 0;
        rs.forEach(function (r) {
            var s = stav(r);
            if (s.cls === 'ok') ok++; else if (s.cls === 'mimo') mimoM++;
            else if (s.cls === 'nejisto') nejisto++; else bez++;
        });
        sou.innerHTML = '<b>' + rs.length + '</b> vytyčených bodů · <b style="color:#10b981;">' + ok + '</b> v mezi'
            + (mimoM ? ' · <b style="color:#ef4444;">' + mimoM + '</b> mimo' : '')
            + (nejisto ? ' · <span style="color:#f59e0b;">' + nejisto + ' neprůkazných</span>' : '')
            + (bez ? ' · <span style="opacity:0.7;">' + bez + ' bez záznamu polohy</span>' : '');

        box.innerHTML = '<table><thead><tr><th>Bod</th><th>ΔY</th><th>ΔX</th><th>Δp</th><th>±</th><th>Stav</th></tr></thead><tbody>'
            + rs.map(function (r) {
                var s = stav(r);
                return '<tr><td>' + esc(r.name) + '</td>'
                    + '<td>' + cm(r.dy) + '</td><td>' + cm(r.dx) + '</td>'
                    + '<td>' + cm(r.dp) + '</td>'
                    + '<td>' + (r.acc != null ? cm(r.acc) : '—') + '</td>'
                    + '<td class="' + s.cls + '">' + s.txt + '</td></tr>';
            }).join('') + '</tbody></table>'
            + '<p style="opacity:0.7; margin-top:10px; font-size:calc(11.5px * var(--ag-font-scale, 1));">'
            + 'Hodnoty v <b>centimetrech</b>. Δp = polohová odchylka skutečnosti od projektu, ± = dosažená přesnost při odškrtnutí. '
            + 'Mez ' + cm(mez(kod())) + ' cm = 2·√2·mxy (katastrální vyhláška č. 357/2013 Sb., příloha bod 13). '
            + '<b>Neprůkazné</b> = telefon měl v tu chvíli horší přesnost než polovinu meze, takže verdikt by nic neznamenal.</p>';
    }

    function nazevZakazky() {
        try {
            if (typeof projects !== 'undefined' && typeof activeProjectId !== 'undefined') {
                for (var i = 0; i < projects.length; i++) { if (projects[i].id === activeProjectId) return projects[i].name || ''; }
            }
        } catch (e) { swallow(e, 'protvyt:nazevZakazky'); }
        return '';
    }

    function exportCsv() {
        var rs = radky();
        if (!rs.length) { toast('Není co exportovat.'); return; }
        var lines = ['bod;projekt_Y;projekt_X;skutecnost_Y;skutecnost_X;dY_m;dX_m;odchylka_m;presnost_m;mez_m;stav;vytyceno'];
        rs.forEach(function (r) {
            lines.push([
                r.name.replace(/[;\r\n]/g, ' '),
                r.py != null ? r.py.toFixed(2) : '', r.px != null ? r.px.toFixed(2) : '',
                r.sy != null ? r.sy.toFixed(2) : '', r.sx != null ? r.sx.toFixed(2) : '',
                m3(r.dy), m3(r.dx), m3(r.dp),
                r.acc != null ? r.acc.toFixed(2) : '',
                r.mez.toFixed(2),
                stav(r).txt,
                r.t ? new Date(r.t).toLocaleString('cs-CZ') : ''
            ].join(';'));
        });
        try {
            var csv = '﻿' + lines.join('\r\n') + '\r\n';
            var a = document.createElement('a');
            a.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv));
            a.setAttribute('download', 'protokol-vytyceni-' + new Date().toISOString().slice(0, 10) + '.csv');
            document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { swallow(e, 'protvyt:csv'); }
    }

    // Tisk vlastním oknem (vzor printProtocol v js/zavady.js) — appka nemá
    // knihovnu na PDF a tisk prohlížeče umí „Uložit jako PDF" na obou platformách.
    function tisk() {
        var rs = radky();
        if (!rs.length) { toast('Není co tisknout.'); return; }
        var w;
        try { w = window.open('', '_blank'); } catch (e) { swallow(e, 'protvyt:tisk'); }
        if (!w) { toast('Prohlížeč zablokoval okno tisku.'); return; }
        var html = '<!doctype html><html lang="cs"><head><meta charset="utf-8">'
            + '<title>Protokol o vytyčení</title><style>'
            + 'body{font:12px/1.45 system-ui,Segoe UI,Roboto,sans-serif;color:#111;margin:24px;}'
            + 'h1{font-size:17px;margin:0 0 2px;} .meta{color:#555;margin-bottom:14px;}'
            + 'table{width:100%;border-collapse:collapse;} th,td{border:1px solid #bbb;padding:4px 6px;text-align:right;}'
            + 'th:first-child,td:first-child{text-align:left;} th{background:#eee;}'
            + '.mimo{color:#b91c1c;font-weight:700;} .nejisto{color:#a16207;font-weight:700;}'
            + '.pozn{color:#555;margin-top:12px;font-size:11px;}'
            + '@media print{body{margin:10mm;}}'
            + '</style></head><body>'
            + '<h1>Protokol o vytyčení</h1>'
            + '<div class="meta">' + esc(nazevZakazky() || 'Zakázka bez názvu') + ' · vyhotoveno ' + esc(new Date().toLocaleString('cs-CZ')) + '</div>'
            + '<table><thead><tr><th>Bod</th><th>Y projekt</th><th>X projekt</th><th>Y skutečnost</th><th>X skutečnost</th>'
            + '<th>ΔY [m]</th><th>ΔX [m]</th><th>Δp [m]</th><th>Přesnost [m]</th><th>Stav</th><th>Vytyčeno</th></tr></thead><tbody>'
            + rs.map(function (r) {
                var s = stav(r);
                return '<tr><td>' + esc(r.name) + '</td>'
                    + '<td>' + (r.py != null ? r.py.toFixed(2) : '—') + '</td><td>' + (r.px != null ? r.px.toFixed(2) : '—') + '</td>'
                    + '<td>' + (r.sy != null ? r.sy.toFixed(2) : '—') + '</td><td>' + (r.sx != null ? r.sx.toFixed(2) : '—') + '</td>'
                    + '<td>' + (r.dy != null ? m3(r.dy) : '—') + '</td><td>' + (r.dx != null ? m3(r.dx) : '—') + '</td>'
                    + '<td>' + (r.dp != null ? m3(r.dp) : '—') + '</td>'
                    + '<td>' + (r.acc != null ? r.acc.toFixed(2) : '—') + '</td>'
                    + '<td class="' + (s.cls === 'ok' ? '' : s.cls) + '">' + esc(s.txt) + '</td>'
                    + '<td>' + esc(datum(r.t)) + '</td></tr>';
            }).join('') + '</tbody></table>'
            + '<p class="pozn">Mezní polohová odchylka ' + mez(kod()).toFixed(2) + ' m = 2·√2·mxy pro kód kvality ' + kod()
            + ' (katastrální vyhláška č. 357/2013 Sb., příloha bod 13).<br>'
            + 'Skutečná poloha je určena GNSS přijímačem mobilního telefonu v okamžiku odškrtnutí bodu; '
            + 'sloupec „Přesnost" udává dosaženou přesnost tohoto určení. Řádky označené „neprůkazné" mají přesnost horší '
            + 'než polovinu mezní odchylky — u nich se o dodržení meze nedá rozhodnout.</p>'
            + '</body></html>';
        try {
            w.document.write(html);
            w.document.close();
            w.focus();
            setTimeout(function () { try { w.print(); } catch (e) { swallow(e, 'protvyt:print'); } }, 350);
        } catch (e) { swallow(e, 'protvyt:tisk'); }
    }

    function open() {
        var m = ensureModal();
        var sel = document.getElementById('ag-pv-kod');
        if (sel) sel.value = String(kod());
        render();
        m.style.display = 'flex';
    }

    // ================================================================
    //  init
    // ================================================================
    function registruj() {
        if (typeof window.agRegisterFieldTool !== 'function') return false;
        window.agRegisterFieldTool({
            id: 'protokol-vytyceni', label: 'Protokol vytyčení', icon: ICON, onClick: open
        });
        return true;
    }

    var _pokusy = 0;
    function init() {
        wrapToggle();
        if (!registruj() && _pokusy++ < 20) setTimeout(init, 500);
        // js/vytycovani.js je načtený odloženě (ag/lazy) a toggleStaked může
        // vzniknout až po nás — obalení je idempotentní, tak ho jen zkoušíme dál.
        if (!window.__agPvTimer) {
            window.__agPvTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
                try { wrapToggle(); } catch (e) { swallow(e, 'protvyt:tik'); }
            }, 1700);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGProtVyt = { open: open, radky: radky, mez: mez };
})();
