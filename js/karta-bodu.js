// ===== QTRIG — PRACOVNÍ KARTA BODU (ODPOJITELNÁ vrstva) ====================
// Neinvazivní vrstva ve stylu js/cuzk-geodata.js: NEEDITUJE logika.js ani
// grafika.js, jen za běhu OBALÍ showDetails() a doplní kartu bodu.
//
// PROČ: karta uměla „Zvýraznit / Skrýt / Zavřít". „Zvýraznit" přitom ve
// skutečnosti spouští navigaci (nastaví cíl AR šipky a rozsvítí okraje obrazu) —
// z názvu to nikdo nepozná. A když k bodu dojdeš, karta ti neřekne to hlavní:
// jak daleko od něj doopravdy stojíš.
//
// CO PŘIDÁVÁ:
//   • NAVIGAČNÍ PRUH nahoře — velká vzdálenost, kam se otočit (◀ ▶ ▲ s počtem
//     stupňů) a převýšení k bodu, když má bod i telefon výšku. Aktualizuje se
//     průběžně, dokud je karta otevřená.
//   • ODCHYLKA — porovná PRŮMĚROVANOU polohu (gpsAvgResult, ne syrový fix) se
//     souřadnicemi bodu a ukáže Δ Y, Δ X, |d| v centimetrech i s tím, jestli se
//     na to dá při dané přesnosti spolehnout. To je celá kontrola vytyčení.
//   • AKCE: „Doveď mě" (dřív Zvýraznit) · „Kontrolní bod" (uloží, kde stojíš,
//     s odkazem na kontrolovaný bod) · „Vytyčeno ✓" (zapíše do vytyčovacího
//     checklistu, když je zapojený) · Skrýt · Zavřít.
//
// Vše fail-silent: co appka zrovna nemá (výška, průměr GPS, checklist), se
// prostě nezobrazí. Odstranění: smaž js/karta-bodu.js + řádek v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGKartaBodu) return;

    var TIMER = null, _pt = null;

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function n2(v) { return (Math.round(v * 100) / 100).toFixed(2).replace('.', ','); }
    function n1(v) { return (Math.round(v * 10) / 10).toFixed(1).replace('.', ','); }
    // POZOR (nalezeno 8.8. v prohlizeci): userLat/userLng/userAlt/gpsAvgResult…
    // deklaruje logika.js pres `let` na nejvyssi urovni skriptu. To je GLOBALNI
    // LEXIKALNI vazba — NENI to vlastnost window, takze window['userLat'] vracelo
    // VZDY undefined. Dusledek: myPos()/distTo()/bearingTo() vracely null a
    // navigacni pruh karty bodu nikdy neukazal vzdalenost ani azimut — porad jen
    // „— m". Ctreme proto pres Function konstruktor: jeho telo bezi v globalnim
    // scope, ktery lexikalni vazby vidi. Jmena jsou v tomhle modulu vzdy literaly.
    var _gFn = {};
    function g(name) {
        try { if (name in window) return window[name]; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:g'); }
        try {
            var f = _gFn[name] || (_gFn[name] = new Function('return typeof ' + name + '!=="undefined"?' + name + ':undefined'));
            return f();
        } catch (e) { return undefined; }
    }

    // ---- výpočty ----------------------------------------------------------------
    function myPos() {
        // PŘESNOST: pro odchylku má smysl jen průměrovaná poloha, ne poslední fix
        var r = g('gpsAvgResult');
        // ⚠ #22 BRANA CERSTVOSTI. gpsAvgResult drzi posledni vysledek DONEKONECNA —
        // kdyz GPS prestane dodavat fixy (auto, tunel, iOS suspend), karta bodu by
        // dal pocitala odchylku proti poloze, kde telefon stal pred dvaceti minutami,
        // a jeste by u ni napsala „průměr N měření". Bez razitka (starsi data)
        // se chovame jako driv, at se nic neztrati.
        var cerstve = (typeof window.agAvgFresh === 'function') ? window.agAvgFresh(15000) : true;
        if (r && r.ts && !cerstve) r = null;
        if (r && !r.coarse && r.n >= 2 && r.lat != null) return { lat: r.lat, lng: r.lng, alt: r.alt, sterr: r.sterr, n: r.n, avg: true };
        var la = g('userLat'), ln = g('userLng');
        if (la == null || ln == null) return null;
        return { lat: la, lng: ln, alt: g('userAlt'), sterr: g('currentGpsAccuracy'), n: 1, avg: false };
    }
    function bpv(alt, lat, lng) {
        if (alt == null || !isFinite(alt)) return null;
        try {
            if (typeof getGeoidUndulation === 'function') return alt - getGeoidUndulation(lat, lng);
            if (window.GeoCore && GeoCore.geoidUndulation) return alt - GeoCore.geoidUndulation(lat, lng);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:bpv'); }
        return null;
    }
    // Δ v S-JTSK (kladné Y/X jako všude v appce) — to je řeč, kterou geodet čte
    function deltaJtsk(from, to) {
        try {
            if (typeof proj4 !== 'function') return null;
            var a = proj4('EPSG:4326', 'EPSG:5514', [from.lng, from.lat]);
            var b = proj4('EPSG:4326', 'EPSG:5514', [to.lng, to.lat]);
            var dy = Math.abs(b[0]) - Math.abs(a[0]);
            var dx = Math.abs(b[1]) - Math.abs(a[1]);
            return { dy: dy, dx: dx, d: Math.sqrt(dy * dy + dx * dx) };
        } catch (e) { return null; }
    }
    function bearingTo(pt) {
        try {
            if (typeof getBearing === 'function') {
                var la = g('userLat'), ln = g('userLng');
                if (la != null) return getBearing(la, ln, pt.lat, pt.lng);
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:bearingTo'); }
        return null;
    }
    function distTo(pt) {
        try {
            var la = g('userLat'), ln = g('userLng');
            if (la != null && typeof getDistance === 'function') return getDistance(la, ln, pt.lat, pt.lng);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:distTo'); }
        return null;
    }
    // výška bodu: vlastní bod (pt.vyska) i úřední záznam ČÚZK (rawData)
    function ptElev(pt) {
        if (pt.vyska != null && isFinite(pt.vyska)) return Number(pt.vyska);
        try {
            var p = pt.rawData; if (!p) return null;
            var KEYS = ['VYSKA_BPV', 'NADMORSKA_VYSKA', 'VYSKA_BODU', 'VYSKA_H', 'H_BPV'];
            for (var k in p) {
                if (KEYS.indexOf(k.toUpperCase()) < 0) continue;
                var v = parseFloat(String(p[k]).replace(',', '.'));
                if (isFinite(v) && v > 50 && v < 3000) return v;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:ptElev'); }
        return null;
    }

    // ---- styly --------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('ag-kb-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-kb-style';
        st.textContent = [
            '#ag-kb-nav{display:flex;align-items:center;gap:12px;margin:0 0 12px;padding:12px 14px;border-radius:14px;',
            '  background:var(--surface-1,rgba(255,255,255,0.05));border:1px solid var(--glass-border,rgba(255,255,255,0.09));}',
            '#ag-kb-turn{flex:0 0 auto;width:52px;text-align:center;font:700 26px/1 var(--font-ui,system-ui);color:var(--warning,#fbbf24);}',
            '#ag-kb-turn small{display:block;font:600 10.5px/1.2 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin-top:3px;}',
            '#ag-kb-main{flex:1;min-width:0;}',
            '#ag-kb-dist{font:800 30px/1 var(--font-mono,ui-monospace,Menlo,monospace);color:var(--data,#e6bd76);font-variant-numeric:tabular-nums;}',
            '#ag-kb-sub{margin-top:4px;font:600 12px/1.35 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#ag-kb-dev{margin:0 0 12px;padding:11px 13px;border-radius:12px;font:600 12.5px/1.45 var(--font-ui,system-ui);',
            '  background:rgba(52,211,153,0.10);border-left:4px solid #34d399;}',
            '#ag-kb-dev.warn{background:rgba(251,191,36,0.10);border-left-color:#fbbf24;}',
            '#ag-kb-dev b{font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-variant-numeric:tabular-nums;}',
            '#ag-kb-dev em{display:block;margin-top:3px;font-style:normal;font-weight:500;color:var(--text-muted,#9aa1ac);font-size:calc(11.5px * var(--ag-font-scale, 1));}',
            '#ag-kb-acts{display:flex;gap:7px;margin:0 0 14px;}',
            '#ag-kb-acts button{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:11px 4px;cursor:pointer;',
            '  border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:var(--surface-2,rgba(255,255,255,0.07));',
            '  color:var(--text-color,#eceef2);font:600 11px/1.15 var(--font-ui,system-ui);text-align:center;}',
            '#ag-kb-acts button .icon{width:19px;height:19px;}',
            '#ag-kb-acts button.on{background:var(--accent,#2f9e74);border-color:transparent;color:#fff;}',
            'body.ag-glove #ag-kb-acts button{padding:14px 4px;font-size:calc(12px * var(--ag-font-scale, 1));}',
            // ===== OBNOVA KARTY 12. 9. 2026 („dlouho jsme to neměnili, jen vizuálně obnovit") =====
            // Hlavička: číslo velké, druh a kód jako štítky. Data bodu jako mřížka dlaždic
            // (Y, X, Z, přesnost, kdy, zdroj) místo dlouhého sloupce řádků. Rádius hledání
            // jedním řádkem pod daty. Původní řádky z grafika.js se jen schovají (nic se nemaže).
            '#bottom-sheet #det-title{font:800 calc(26px * var(--ag-font-scale,1))/1.1 var(--font-display,system-ui);letter-spacing:-.01em;margin:0 0 6px !important;}',
            '#bottom-sheet #det-subtitle{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px !important;font-size:calc(11px * var(--ag-font-scale,1)) !important;}',
            '#bottom-sheet #det-subtitle .ag-kb-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;font:600 11px/1 var(--font-ui,system-ui);',
            '  background:var(--surface-2,rgba(255,255,255,.07));border:1px solid var(--glass-border,rgba(255,255,255,.12));color:var(--text-muted,#9aa1ac);}',
            '#bottom-sheet #det-subtitle .ag-kb-chip.kod{color:var(--accent,#2f9e74);border-color:var(--accent-line,rgba(47,158,116,.4));background:var(--accent-soft,rgba(47,158,116,.12));}',
            '#bottom-sheet #det-subtitle .ag-kb-chip.ok{color:#3fbc8c;}',
            '#det-body > .geo-data-row,#det-body > div[style*="border-left:4px solid #fbbf24"],#det-body > div[style*="font-style:italic"]{display:none;}',
            '.ag-kb-lbl{margin:2px 0 7px;font:700 10.5px/1 var(--font-ui,system-ui);letter-spacing:.09em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.ag-kb-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:0 0 10px;}',
            '.ag-kb-cell{padding:9px 11px;border-radius:12px;background:var(--surface-1,rgba(255,255,255,.05));border:1px solid var(--glass-border,rgba(255,255,255,.09));min-width:0;}',
            '.ag-kb-cell.w{grid-column:1/-1;}',
            '.ag-kb-cell small{display:block;font:600 10px/1.2 var(--font-ui,system-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);margin-bottom:3px;}',
            '.ag-kb-cell b{display:block;font:600 calc(15px * var(--ag-font-scale,1))/1.2 var(--font-mono,ui-monospace,Menlo,monospace);font-variant-numeric:tabular-nums;color:var(--text-color,#e6e8eb);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.ag-kb-cell b.t{font-family:var(--font-ui,system-ui);font-weight:600;white-space:normal;}',
            '.ag-kb-radius{display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:8px 11px;border-radius:10px;font:500 calc(12px * var(--ag-font-scale,1))/1.4 var(--font-ui,system-ui);',
            '  color:var(--text-muted,#9aa1ac);background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.25);}',
            '.ag-kb-radius b{color:#fbbf24;font-family:var(--font-mono,ui-monospace,monospace);}',
            '#bottom-sheet .sheet-actions .btn{border-radius:12px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- vykreslení ------------------------------------------------------------------
    function turnHtml(pt) {
        var b = bearingTo(pt), h = g('currentHeading');
        if (b == null || h == null || !isFinite(h)) return '<span style="opacity:.45;">•</span><small>směr</small>';
        var diff = ((b - h + 540) % 360) - 180;
        var a = Math.abs(diff);
        var sym = a < 10 ? '▲' : (diff > 0 ? '▶' : '◀');
        return sym + '<small>' + (a < 10 ? 'rovně' : Math.round(a) + '° ' + (diff > 0 ? 'vpravo' : 'vlevo')) + '</small>';
    }
    function fillNav(pt) {
        var t = document.getElementById('ag-kb-turn');
        var d = document.getElementById('ag-kb-dist');
        var s = document.getElementById('ag-kb-sub');
        if (!t || !d) return;
        t.innerHTML = turnHtml(pt);
        var dist = distTo(pt);
        d.textContent = (dist == null) ? '— m' : (dist < 10 ? n2(dist) : n1(dist)) + ' m';

        var bits = [];
        var pe = ptElev(pt);
        var me = myPos();
        var mine = me ? bpv(me.alt, me.lat, me.lng) : null;
        if (pe != null && mine != null) {
            var dz = pe - mine;
            bits.push('převýšení k bodu <b style="color:var(--text-color,#eceef2);">' + (dz >= 0 ? '+' : '−') + n2(Math.abs(dz)) + ' m</b>');
        } else if (pe != null) {
            bits.push('bod ' + n2(pe) + ' m Bpv');
        }
        var br = bearingTo(pt);
        if (br != null) bits.push('azimut ' + n1(br) + '°');
        if (s) s.innerHTML = bits.join(' · ');
    }
    function fillDev(pt) {
        var box = document.getElementById('ag-kb-dev');
        if (!box) return;
        var me = myPos();
        if (!me) { box.style.display = 'none'; return; }
        var dd = deltaJtsk(me, pt);
        if (!dd) { box.style.display = 'none'; return; }
        box.style.display = '';
        // Odchylka dává smysl, jen když stojíš prakticky na bodě a máš průměr.
        var far = dd.d > 3;
        var loose = !me.avg || (me.sterr != null && me.sterr > 0.5);
        box.classList.toggle('warn', far || loose);
        var cm = function (v) { return (v >= 0 ? '+' : '−') + Math.round(Math.abs(v) * 100) + ' cm'; };
        box.innerHTML = 'Stojím od bodu <b>' + (dd.d < 10 ? n2(dd.d) : n1(dd.d)) + ' m</b> — Δ Y <b>' + cm(dd.dy) + '</b>, Δ X <b>' + cm(dd.dx) + '</b>'
            + '<em>' + (far ? 'Jsi ještě daleko — čísla platí, až budeš stát na bodě.'
                : (loose ? 'Poloha zatím není zprůměrovaná (nebo je přesnost slabá) — nech GPS chvíli běžet.'
                    : 'Z průměru ' + me.n + ' měření, ± ' + n2(me.sterr) + ' m.')) + '</em>';
    }

    function actsHtml(pt) {
        var nav = (g('highlightedPointId') === pt.id);
        var staked = false;
        try { if (typeof window.isStaked === 'function') staked = !!window.isStaked(pt.id); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:actsHtml'); }
        var h = '<button type="button" data-a="nav" class="' + (nav ? 'on' : '') + '">'
            + '<svg class="icon"><use href="#i-navigation"/></svg><span>' + (nav ? 'Navádí' : 'Doveď mě') + '</span></button>'
            + '<button type="button" data-a="check"><svg class="icon"><use href="#i-crosshair"/></svg><span>Kontrolní<br>bod</span></button>';
        if (typeof window.toggleStaked === 'function') {
            h += '<button type="button" data-a="staked" class="' + (staked ? 'on' : '') + '">'
                + '<svg class="icon"><use href="#i-check"/></svg><span>' + (staked ? 'Vytyčeno ✓' : 'Vytyčeno') + '</span></button>';
        }
        return h;
    }

    function onAct(e) {
        var b = e.target.closest('button[data-a]');
        if (!b || !_pt) return;
        e.preventDefault(); e.stopPropagation();
        var a = b.getAttribute('data-a');
        try {
            if (a === 'nav') {
                if (typeof window.toggleHighlight === 'function') window.toggleHighlight();   // zavře kartu (původní chování)
            } else if (a === 'staked') {
                if (typeof window.toggleStaked === 'function') window.toggleStaked(_pt);
                render(_pt);
            } else if (a === 'check') {
                newCheckPoint(_pt);
            }
        } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'karta-bodu:onAct'); }
    }

    // „Kontrolní bod": ulož, kde právě stojím, pod jménem odkazujícím na kontrolovaný bod.
    // Necháváme to na standardním formuláři (validace, kód bodu, fotka, QC brána) —
    // jen ho předvyplníme, aby to v terénu bylo na dvě klepnutí.
    function newCheckPoint(pt) {
        var me = myPos();
        if (!me) { if (typeof window.agInfo === 'function') agInfo('Nemám polohu — počkej na GPS fix.'); return; }
        try { if (typeof window.closeBottomSheet === 'function') closeBottomSheet(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:newCheckPoint'); }
        try {
            if (typeof window.openNewPointModal !== 'function') return;
            openNewPointModal();
            var nm = document.getElementById('custom-name');
            if (nm && !nm.value) nm.value = 'K_' + String(pt.name || '').replace(/\s+/g, '_');
            var note = document.getElementById('custom-note');
            var dd = deltaJtsk(me, pt);
            if (note && !note.value && dd) {
                note.value = 'Kontrola bodu ' + (pt.name || '') + ': ΔY ' + Math.round(dd.dy * 100) + ' cm, ΔX ' + Math.round(dd.dx * 100)
                    + ' cm, |d| ' + Math.round(dd.d * 100) + ' cm' + (me.avg ? (' (průměr ' + me.n + ' měření, ±' + n2(me.sterr) + ' m)') : '');
            }
            if (typeof window.fillAveragedGPS === 'function') fillAveragedGPS();
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:newCheckPoint'); }
    }

    // ---- vložení do karty --------------------------------------------------------------
    function render(pt) {
        injectStyles();
        _pt = pt;
        var body = document.getElementById('det-body');
        if (!body) return;

        var nav = document.getElementById('ag-kb-nav');
        if (!nav) {
            nav = document.createElement('div'); nav.id = 'ag-kb-nav';
            nav.innerHTML = '<div id="ag-kb-turn"></div><div id="ag-kb-main"><div id="ag-kb-dist">— m</div><div id="ag-kb-sub"></div></div>';
            var dev = document.createElement('div'); dev.id = 'ag-kb-dev';
            var acts = document.createElement('div'); acts.id = 'ag-kb-acts';
            acts.addEventListener('click', onAct);
            body.insertBefore(nav, body.firstChild);
            nav.insertAdjacentElement('afterend', dev);
            dev.insertAdjacentElement('afterend', acts);
        }
        var acts2 = document.getElementById('ag-kb-acts');
        if (acts2) acts2.innerHTML = actsHtml(pt);
        fillNav(pt); fillDev(pt);
        try { hlavicka(pt); mrizka(pt, body, acts2); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:mrizka'); }
        start();
    }

    // ---- hlavička: číslo + štítky (druh, kód, vytyčeno) ------------------------------------
    function hlavicka(pt) {
        var sub = document.getElementById('det-subtitle');
        if (!sub || sub.getAttribute('data-kb') === String(pt.id)) return;
        var druh = (sub.textContent || '').trim();
        var h = '<span class="ag-kb-chip">' + esc(druh) + '</span>';
        if (pt.kod) h += '<span class="ag-kb-chip kod">' + esc(pt.kod) + '</span>';
        try { if (window.isStaked && isStaked(pt.id)) h += '<span class="ag-kb-chip ok">✓ vytyčeno</span>'; } catch (e) { }
        try { if (typeof agZHodinek === 'function' && agZHodinek(pt)) h += '<span class="ag-kb-chip">⌚ z hodinek</span>'; } catch (e) { }
        sub.innerHTML = h;
        sub.setAttribute('data-kb', String(pt.id));
    }
    // ---- data bodu jako mřížka ---------------------------------------------------------------
    // Hodnoty se berou z řádků, které grafika.js už vykreslila (Y/X i pro úřední body z
    // rawData), plus přesnost, kdy a odkud bod je (prov) — to dřív karta neukazovala vůbec.
    function mrizka(pt, body, acts) {
        var old = document.getElementById('ag-kb-grid'); if (old) old.remove();
        var oldR = document.getElementById('ag-kb-radius'); if (oldR) oldR.remove();
        var rows = body.querySelectorAll(':scope > .geo-data-row');
        var m = {};
        for (var i = 0; i < rows.length; i++) {
            var l = rows[i].querySelector('.geo-label'), v = rows[i].querySelector('.geo-value');
            if (l && v) m[(l.textContent || '').trim()] = (v.textContent || '').trim();
        }
        var cells = [];
        function cell(lbl, val, cls) { if (val == null || val === '' || val === 'Neznámé') return; cells.push('<div class="ag-kb-cell' + (cls ? ' ' + cls : '') + '"><small>' + esc(lbl) + '</small><b' + (cls === 't' || cls === 'w t' ? ' class="t"' : '') + '>' + esc(val) + '</b></div>'); }
        function sour(v) { var f = parseFloat(String(v || '').replace(',', '.')); return isFinite(f) ? f.toFixed(2) : v; }
        cell('S-JTSK Y', sour(m['S-JTSK Y'])); cell('S-JTSK X', sour(m['S-JTSK X']));
        var z = ptElev(pt);
        cell('Výška Bpv', z != null ? n2(z) + ' m' : null);
        // úřední bod: výšku už máme v mřížce, v zeleném rámečku (stabilizace…) by byla dvakrát
        if (z != null) { var dup = body.querySelectorAll('.geo-highlight .geo-data-row'); for (var d = 0; d < dup.length; d++) { var dl = dup[d].querySelector('.geo-label'); if (dl && /^Nadmořská/.test(dl.textContent || '')) dup[d].remove(); } }
        cell('Přesnost bodu', (pt.acc != null && isFinite(pt.acc)) ? '±' + n2(pt.acc) + ' m' : null);
        var kdy = (pt.prov && pt.prov.ts) || pt.mts || null;
        if (kdy) { try { cell('Změřeno', new Date(kdy).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }), 't'); } catch (e) { } }
        var ZDROJ = { 'gps-avg': 'průměr GPS', gps: 'GPS', import: 'import ze souboru', firma: 'z firmy', foto: 'z fotky', map: 'z mapy', resekce: 'resekce', protinani: 'protínání', argeo: 'přenos zakázky', watch: 'hodinky' };
        var o = pt.prov && pt.prov.origin;
        if (o) cell('Zdroj', ZDROJ[o] || o, 't');
        if (pt.prov && pt.prov.kdo) cell('Změřil', pt.prov.kdo, 't');
        if (pt.type !== 'custom' && !o) cell('Zdroj', 'bodové pole ČÚZK', 't');
        if (!cells.length) return;
        var box = document.createElement('div'); box.id = 'ag-kb-grid';
        box.innerHTML = '<div class="ag-kb-lbl">Data bodu</div><div class="ag-kb-grid">' + cells.join('') + '</div>';
        var kotva = acts || document.getElementById('ag-kb-acts');
        if (kotva && kotva.parentNode === body) kotva.insertAdjacentElement('afterend', box); else body.insertBefore(box, body.firstChild);
        // rádius hledání jedním řádkem (přesnost telefonu teď)
        var acc = null;
        try { acc = g('currentGpsAccuracy'); } catch (e) { acc = null; }
        if (acc != null && isFinite(acc)) {
            var r = document.createElement('div'); r.id = 'ag-kb-radius'; r.className = 'ag-kb-radius';
            r.innerHTML = '<span>⌖</span><span>Značka v AR má rozptyl <b>±' + n1(acc) + ' m</b> (přesnost GPS teď) — bod hledej v tomhle okruhu, ne na centimetr.</span>';
            box.insertAdjacentElement('afterend', r);
        }
    }

    // živé hodnoty, dokud je karta otevřená (2×/s stačí — čísla se čtou očima)
    function start() {
        stop();
        TIMER = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () {
            var sheet = document.getElementById('bottom-sheet');
            if (!sheet || !sheet.classList.contains('open') || !_pt) { stop(); return; }
            try { fillNav(_pt); fillDev(_pt); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:start'); }
        }, 500);
    }
    function stop() { if (TIMER) { clearInterval(TIMER); TIMER = null; } }

    // ---- napojení na appku ---------------------------------------------------------------
    function wrap() {
        if (window.__agKbWrapped || typeof window.showDetails !== 'function') return;
        var orig = window.showDetails;
        window.showDetails = function (pt, distance) {
            var r = orig.apply(this, arguments);
            try { if (pt && document.getElementById('bottom-sheet').classList.contains('open')) render(pt); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:showDetails'); }
            return r;
        };
        window.__agKbWrapped = true;
    }
    // „Zvýraznit" v původní liště karty přejmenujeme — dělá navigaci, ne zvýraznění
    function relabel() {
        var b = document.getElementById('highlight-btn');
        if (!b || b._agKb) return;
        var s = b.querySelector('span');
        if (s && /Zvýraznit/i.test(s.textContent)) { b.style.display = 'none'; b._agKb = true; }   // nahradila ho dlaždice „Doveď mě"
    }

    function init() {
        injectStyles();
        wrap();
        relabel();
        if (!window.__agKbWatch) {
            window.__agKbWatch = setInterval(function () { wrap(); relabel(); }, 1500);
            setTimeout(function () { clearInterval(window.__agKbWatch); window.__agKbWatch = 0; }, 15000);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });

    window.AGKartaBodu = { render: render, refresh: function () { if (_pt) render(_pt); } };
})();
