// ===== QTRIG — PRACOVNÍ KARTA BODU (ODPOJITELNÁ vrstva) ====================
// Neinvazivní vrstva ve stylu js/cuzk-geodata.js: NEEDITUJE logika.js ani
// grafika.js, jen za běhu OBALÍ showDetails() a doplní kartu bodu.
//
// PROČ: karta uměla „Zvýraznit / Skrýt / Zavřít". „Zvýraznit" přitom ve
// skutečnosti spouští navigaci (nastaví cíl AR šipky a rozsvítí okraje obrazu) —
// z názvu to nikdo nepozná. A když k bodu dojdeš, karta ti neřekne to hlavní:
// jak daleko od něj doopravdy stojíš.
//
// CO PŘIDÁVÁ (od 12. 9. 2026 — karta je PŘEHLED O BODU, ne navigace; na navigaci
// je mapa / AR / split — rozhodnutí uživatele):
//   • MOZAIKA DAT („bento"): Y a X velké, ikona druhu bodu, přesnost barevně,
//     stav vytyčení, výška, „ode mě" (jen vzdálenost, bez šipek), kdy / odkud / kdo,
//     počet fotek. Každá informace má velikost podle důležitosti.
//   • NÁČRT OKOLÍ z reálných dat: tenhle bod uprostřed, sousední body zakázky kolem
//     v měřítku (sever nahoře), k nim oměrné se vzdálenostmi v S-JTSK, hranice parcel
//     z vektorového katastru (když jsou stažené), měřítko. Statický obrázek jako
//     v zápisníku — nehýbe se podle tebe. Pod ním dlaždice oměrných.
//   • ODCHYLKA — jen když stojíš prakticky na bodě (< 3 m) a máš průměrovanou
//     polohu: Δ Y, Δ X, |d| v cm. Jinak se neukazuje (daleko od bodu je to šum).
//   • AKCE dole: „Doveď mě" · „Kontrolní bod" · „Vytyčeno ✓".
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
            '#bottom-sheet .sheet-actions .btn{border-radius:12px;}',
            // ===== KARTA JAKO PŘEHLED (12. 9. 2026): mozaika dat + náčrt okolí ===========
            '#ag-kb-nav{display:none;}',
            '#ag-kb-acts{margin:12px 0 14px;}',
            '.ag-kb-bento{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:minmax(56px,auto);gap:7px;margin:0 0 12px;}',
            '.ag-kb-t{position:relative;min-width:0;overflow:hidden;padding:8px 10px;border-radius:13px;background:var(--surface-1,rgba(255,255,255,.05));border:1px solid var(--glass-border,rgba(255,255,255,.09));}',
            '.ag-kb-t small{display:block;font:600 9.5px/1.2 var(--font-ui,system-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.ag-kb-t b{display:block;margin-top:3px;font:700 calc(14px * var(--ag-font-scale,1))/1.2 var(--font-mono,ui-monospace,Menlo,monospace);font-variant-numeric:tabular-nums;color:var(--text-color,#e6e8eb);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.ag-kb-t b.t{font-family:var(--font-ui,system-ui);font-weight:600;font-size:calc(12.5px * var(--ag-font-scale,1));white-space:normal;}',
            '.ag-kb-t.c2{grid-column:1/-1;}.ag-kb-t.r2{grid-row:span 2;}',
            '.ag-kb-t.yx{display:flex;flex-direction:column;justify-content:center;gap:6px;background:linear-gradient(135deg,var(--accent-soft,rgba(47,158,116,.18)),rgba(47,158,116,.04));border-color:var(--accent-line,rgba(47,158,116,.4));}',
            '.ag-kb-t.yx b{font-size:calc(17px * var(--ag-font-scale,1));color:var(--accent,#3fbc8c);margin-top:1px;}',
            '.ag-kb-t.yx .ic{position:absolute;right:8px;top:8px;width:30px;height:30px;color:var(--accent,#3fbc8c);opacity:.55;}',
            '.ag-kb-t.ok b{color:#3fbc8c;}.ag-kb-t.warn{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.35);}.ag-kb-t.warn b{color:#fbbf24;}',
            '.ag-kb-t.bad{background:rgba(226,104,95,.08);border-color:rgba(226,104,95,.35);}.ag-kb-t.bad b{color:#e2685f;}',
            '.ag-kb-t.tap{cursor:pointer;}',
            '.ag-kb-sk{position:relative;margin:0 0 8px;border-radius:14px;overflow:hidden;background:#0f151d;border:1px solid var(--glass-border,rgba(255,255,255,.12));}',
            '.ag-kb-sk svg{display:block;width:100%;height:auto;}',
            '.ag-kb-sk .lg{position:absolute;left:9px;top:7px;font:600 10px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);pointer-events:none;}',
            '.ag-kb-sk .lg i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle;font-style:normal;}',
            '.ag-kb-sk .pz{position:absolute;left:0;right:0;bottom:0;padding:22px 10px 8px;text-align:center;font:500 11px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);background:linear-gradient(transparent,rgba(0,0,0,.55));pointer-events:none;}',
            '.ag-kb-om{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:0 0 4px;}',
            '.ag-kb-om div{padding:7px 6px;border-radius:10px;background:var(--surface-1,rgba(255,255,255,.05));border:1px solid var(--glass-border,rgba(255,255,255,.08));text-align:center;min-width:0;}',
            '.ag-kb-om small{display:block;font:600 9.5px/1.2 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.ag-kb-om b{display:block;font:700 calc(13px * var(--ag-font-scale,1))/1.3 var(--font-mono,ui-monospace,monospace);color:#fbbf24;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- vykreslení ------------------------------------------------------------------
    function fillDev(pt) {
        var box = document.getElementById('ag-kb-dev');
        if (!box) return;
        var me = myPos();
        if (!me) { box.style.display = 'none'; return; }
        var dd = deltaJtsk(me, pt);
        if (!dd) { box.style.display = 'none'; return; }
        // Odchylka dává smysl, jen když stojíš prakticky na bodě a máš průměr.
        // Daleko od bodu se box vůbec neukáže — karta je přehled, ne navigace (12. 9. 2026).
        var far = dd.d > 3;
        if (far) { box.style.display = 'none'; return; }
        box.style.display = '';
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
    // Pořadí v #det-body: [odchylka — jen u bodu] → mozaika dat → náčrt okolí → oměrné →
    // akce → (původní bloky grafika.js: stabilizace ČÚZK, polohopis, úřední záznamy) →
    // foto-dokumentace (kalkulacka.js). Původní řádky Y/X/vzdálenost jsou schované CSS.
    function render(pt) {
        injectStyles();
        _pt = pt;
        var body = document.getElementById('det-body');
        if (!body) return;
        var dev = document.getElementById('ag-kb-dev');
        if (!dev) { dev = document.createElement('div'); dev.id = 'ag-kb-dev'; body.insertBefore(dev, body.firstChild); }
        var acts = document.getElementById('ag-kb-acts');
        if (!acts) { acts = document.createElement('div'); acts.id = 'ag-kb-acts'; acts.addEventListener('click', onAct); }
        acts.innerHTML = actsHtml(pt);
        try { hlavicka(pt); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:hlavicka'); }
        try { mozaika(pt, body, dev); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:mozaika'); }
        try { nacrt(pt, body); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:nacrt'); }
        // akce až pod náčrtem (nebo pod mozaikou, když náčrt není)
        var kotva = document.getElementById('ag-kb-om') || document.getElementById('ag-kb-sk') || document.getElementById('ag-kb-bento') || dev;
        kotva.insertAdjacentElement('afterend', acts);
        fillDev(pt); fillDist(pt);
        start();
    }

    // ---- hlavička: číslo + štítky (druh, kód, vytyčeno) ------------------------------------
    function hlavicka(pt) {
        var sub = document.getElementById('det-subtitle');
        if (!sub || sub.getAttribute('data-kb') === String(pt.id)) return;
        var druh = (sub.textContent || '').trim();
        sub.setAttribute('data-druh', druh);
        var h = '<span class="ag-kb-chip">' + esc(druh) + '</span>';
        if (pt.kod) h += '<span class="ag-kb-chip kod">' + esc(pt.kod) + '</span>';
        try { if (window.isStaked && isStaked(pt.id)) h += '<span class="ag-kb-chip ok">✓ vytyčeno</span>'; } catch (e) { }
        try { if (typeof agZHodinek === 'function' && agZHodinek(pt)) h += '<span class="ag-kb-chip">⌚ z hodinek</span>'; } catch (e) { }
        sub.innerHTML = h;
        sub.setAttribute('data-kb', String(pt.id));
    }

    // ---- souřadnice bodu v S-JTSK (kladné Y/X jako všude v appce) ----------------------------
    function jtsk(pt) {
        try {
            if (pt.type === 'custom' || !pt.rawData) {
                if (typeof proj4 !== 'function') return null;
                var c = proj4('EPSG:4326', 'EPSG:5514', [pt.lng, pt.lat]);
                return { y: Math.abs(c[0]), x: Math.abs(c[1]) };
            }
            var p = pt.rawData, sY = null, sX = null;
            for (var k in p) {
                var K = k.toUpperCase(), v = parseFloat(String(p[k]).replace(',', '.'));
                if (!isFinite(v)) continue;
                if (K === 'Y' || K === 'SOURADNICE_Y') sY = v;
                if (K === 'X' || K === 'SOURADNICE_X') sX = v;
            }
            if (sY == null || sX == null) return null;
            return sY < sX ? { y: sY, x: sX } : { y: sX, x: sY };   // Y je vždy to menší
        } catch (e) { return null; }
    }
    function fmtS(v) { return v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    var DRUH_IKONA = {
        CUSTOM: '<path d="M9 3h6l-1 8H10z"/><path d="M11 11l1 10 1-10"/><path d="M5 21h14"/>',
        TB: '<path d="M12 4l9 16H3z"/><circle cx="12" cy="14" r="2"/>',
        ZHB: '<path d="M12 4l9 16H3z"/><path d="M12 10v8M8 18h8"/>',
        PBPP: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>',
        NIVEL: '<path d="M4 18h16M6 14h12M8 10h8M10 6h4"/>'
    };
    function ikona(pt) {
        var d = DRUH_IKONA[pt.cat] || DRUH_IKONA.CUSTOM;
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
    }
    function zakazka() {
        try {
            var id = g('activeProjectId'), ps = g('projects');
            if (!ps || !ps.length) { ps = JSON.parse(localStorage.getItem('arProjectsList') || '[]'); }
            var p = (ps || []).filter(function (x) { return x && x.id === id; })[0];
            return p ? p.name : null;
        } catch (e) { return null; }
    }

    // ---- mozaika dat („bento") --------------------------------------------------------------
    function mozaika(pt, body, dev) {
        var old = document.getElementById('ag-kb-bento'); if (old) old.remove();
        var oldG = document.getElementById('ag-kb-grid'); if (oldG) oldG.remove();
        var oldR = document.getElementById('ag-kb-radius'); if (oldR) oldR.remove();
        var t = [];
        function tile(cls, lbl, val, extra) { t.push('<div class="ag-kb-t ' + cls + '"' + (extra || '') + '><small>' + esc(lbl) + '</small>' + val + '</div>'); }
        var s = jtsk(pt);
        var sub = document.getElementById('det-subtitle');
        var druh = (sub && sub.getAttribute('data-druh')) || '';
        // Y a X — to hlavní, velké
        t.push('<div class="ag-kb-t r2 yx"><div><small>S-JTSK Y</small><b>' + (s ? fmtS(s.y) : '—') + '</b></div><div><small>S-JTSK X</small><b>' + (s ? fmtS(s.x) : '—') + '</b></div><span class="ic" title="' + esc(druh) + '">' + ikona(pt) + '</span></div>');
        // přesnost: barevně
        if (pt.acc != null && isFinite(pt.acc)) tile('acc ' + (pt.acc <= 0.5 ? 'ok' : (pt.acc <= 2 ? 'warn' : 'bad')), 'Přesnost', '<b>±' + n2(pt.acc) + ' m</b>');
        else if (pt.type !== 'custom') tile('ok', 'Přesnost', '<b class="t">úřední bod</b>');
        else tile('', 'Přesnost', '<b class="t">neuvedena</b>');
        var staked = false; try { staked = !!(window.isStaked && isStaked(pt.id)); } catch (e) { }
        tile(staked ? 'ok' : '', 'Stav', '<b class="t">' + (staked ? '✓ vytyčeno' : 'nevytyčeno') + '</b>');
        var z = ptElev(pt);
        tile('', 'Výška Bpv', '<b>' + (z != null ? n2(z) + ' m' : '—') + '</b>');
        tile('', 'Ode mě', '<b id="ag-kb-dist">— m</b>');
        var kdy = (pt.prov && pt.prov.ts) || pt.mts || null, kdyS = null;
        if (kdy) { try { kdyS = new Date(kdy).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { } }
        var ZDROJ = { 'gps-avg': 'průměr GPS', gps: 'GPS', import: 'import ze souboru', firma: 'z firmy', foto: 'z fotky', map: 'z mapy', resekce: 'resekce', protinani: 'protínání', argeo: 'přenos zakázky', watch: 'hodinky', ruc: 'ručně' };
        var o = pt.prov && pt.prov.origin;
        var odkud = o ? (ZDROJ[o] || o) : (pt.type !== 'custom' ? 'bodové pole ČÚZK' : null);
        var kdo = pt.prov && pt.prov.kdo;
        var puvod = [kdo, kdyS, odkud].filter(Boolean).join(' · ');
        if (puvod) tile('c2', kdyS ? 'Změřeno' : 'Zdroj', '<b class="t">' + esc(puvod) + '</b>');
        var zk = zakazka();
        if (zk) tile('', 'Zakázka', '<b class="t">' + esc(zk) + '</b>');
        tile((zk ? '' : 'c2 ') + 'tap', 'Fotky a poznámka', '<b class="t" id="ag-kb-foto">—</b>', ' data-a="foto"');
        // úřední bod: výšku už máme v mozaice, v zeleném rámečku (stabilizace…) by byla dvakrát
        if (z != null) { var dup = body.querySelectorAll('.geo-highlight .geo-data-row'); for (var d = 0; d < dup.length; d++) { var dl = dup[d].querySelector('.geo-label'); if (dl && /^Nadmořská/.test(dl.textContent || '')) dup[d].remove(); } }
        var box = document.createElement('div'); box.id = 'ag-kb-bento'; box.className = 'ag-kb-bento';
        box.innerHTML = t.join('');
        box.addEventListener('click', function (e) {
            var f = e.target.closest('[data-a="foto"]'); if (!f) return;
            var sec = body.querySelector('.point-doc'); if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        (dev || body.firstChild).insertAdjacentElement('afterend', box);
        // počet fotek dorazí z IndexedDB
        try {
            if (typeof loadPointDoc === 'function') loadPointDoc(pt.id).then(function (doc) {
                var el = document.getElementById('ag-kb-foto'); if (!el || _pt !== pt) return;
                var n = (doc && doc.photos && doc.photos.length) || (doc && doc.photo ? 1 : 0);
                var pozn = doc && doc.note ? ' · poznámka' : '';
                el.textContent = (n ? (n + (n === 1 ? ' fotka' : (n < 5 ? ' fotky' : ' fotek'))) : 'žádná') + pozn;
            }).catch(function () { var el = document.getElementById('ag-kb-foto'); if (el) el.textContent = 'žádná'; });
            else { var el0 = document.getElementById('ag-kb-foto'); if (el0) el0.textContent = 'žádná'; }
        } catch (e) { }
    }
    // „Ode mě": jen vzdálenost — žádné šipky, karta nenavádí
    function fillDist(pt) {
        var d = document.getElementById('ag-kb-dist'); if (!d) return;
        var dist = distTo(pt);
        d.textContent = (dist == null) ? '— m' : (dist < 10 ? n2(dist) : (dist < 1000 ? n1(dist) + ' m' : (dist / 1000).toFixed(1).replace('.', ',') + ' km'));
        if (dist != null && dist < 10) d.textContent += ' m';
    }

    // ---- náčrt okolí z reálných dat ----------------------------------------------------------
    // Sousední body zakázky (max 6, do 150 m; když je okolí prázdné, aspoň 3 nejbližší do
    // 500 m), hranice parcel z vektorového katastru (klíč agCadastreParcels, když jsou
    // stažené), moje poloha (jen tečka, když je v záběru), měřítko, sever nahoře.
    function enu(lat0, lng0, lat, lng) {
        var m = (window.GeoCore && GeoCore.metersPerDeg) ? GeoCore.metersPerDeg(lat0) : { lat: 111320, lng: 111320 * Math.cos(lat0 * Math.PI / 180) };
        return { e: (lng - lng0) * m.lng, n: (lat - lat0) * m.lat };
    }
    function sousede(pt) {
        var all = g('arPoints') || [], out = [];
        for (var i = 0; i < all.length; i++) {
            var q = all[i];
            if (!q || q === pt || q.id === pt.id || q.hidden || q.lat == null) continue;
            var o = enu(pt.lat, pt.lng, q.lat, q.lng), d = Math.sqrt(o.e * o.e + o.n * o.n);
            if (d > 500 || d < 0.01) continue;
            var dj = deltaJtsk(pt, q);
            out.push({ pt: q, e: o.e, n: o.n, d: dj ? dj.d : d });
        }
        out.sort(function (a, b) { return a.d - b.d; });
        var blizko = out.filter(function (x) { return x.d <= 150; }).slice(0, 5);
        return blizko.length >= 2 ? blizko : out.slice(0, 3);
    }
    function parcely() {
        try {
            if (typeof getStoredData !== 'function') return [];
            var s = getStoredData('agCadastreParcels');
            return s ? (JSON.parse(s) || []) : [];
        } catch (e) { return []; }
    }
    function hezkeMeritko(m) { var k = [1, 2, 5, 10, 20, 50, 100, 200, 500]; for (var i = k.length - 1; i >= 0; i--) if (k[i] <= m) return k[i]; return 1; }
    function nacrt(pt, body) {
        var old = document.getElementById('ag-kb-sk'); if (old) old.remove();
        var oldO = document.getElementById('ag-kb-om'); if (oldO) oldO.remove();
        var W = 340, H = 210, cx = W / 2, cy = H / 2;
        var sb = sousede(pt);
        var R = 10;
        for (var i = 0; i < sb.length; i++) R = Math.max(R, Math.sqrt(sb[i].e * sb[i].e + sb[i].n * sb[i].n));
        R *= 1.18;
        var sc = (Math.min(W, H) / 2 - 14) / R;        // px na metr
        function X(e) { return cx + e * sc; } function Y(n) { return cy - n * sc; }
        var f = function (v) { return Math.round(v * 10) / 10; };
        var h = [];
        // mřížka
        h.push('<defs><pattern id="ag-kb-g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,.05)"/></pattern><clipPath id="ag-kb-c"><rect width="' + W + '" height="' + H + '"/></clipPath></defs>');
        h.push('<rect width="' + W + '" height="' + H + '" fill="url(#ag-kb-g)"/>');
        // parcely (jen segmenty, co zasahují do záběru)
        var pc = parcely(), nPar = 0;
        for (var p = 0; p < pc.length && nPar < 400; p++) {
            var rings = pc[p].rings || [];
            for (var r = 0; r < rings.length; r++) {
                var pts = rings[r], d = [], vid = false;
                for (var k = 0; k < pts.length; k++) {
                    var o = enu(pt.lat, pt.lng, pts[k].lat, pts[k].lng);
                    if (Math.abs(o.e) < R * 1.6 && Math.abs(o.n) < R * 1.1) vid = true;
                    d.push((k ? 'L' : 'M') + f(X(o.e)) + ' ' + f(Y(o.n)));
                }
                if (vid) { h.push('<path d="' + d.join('') + '" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1" clip-path="url(#ag-kb-c)"/>'); nPar++; }
            }
        }
        // oměrné + sousedé
        for (i = 0; i < sb.length; i++) {
            var q = sb[i], x2 = X(q.e), y2 = Y(q.n);
            h.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + f(x2) + '" y2="' + f(y2) + '" stroke="#fbbf24" stroke-opacity=".8" stroke-dasharray="4 3"/>');
            if (i >= 3) continue;   // popisky vzdáleností jen u tří nejbližších (ty jsou i v dlaždicích) — jinak se přepisují
            var mx = cx + (x2 - cx) * 0.58, my = cy + (y2 - cy) * 0.58;
            var lab = (q.d < 10 ? n2(q.d) : n1(q.d)) + ' m';
            h.push('<text x="' + f(mx) + '" y="' + f(my - 4) + '" font-size="10" font-weight="600" fill="#fbbf24" text-anchor="middle" paint-order="stroke" stroke="#0b0f15" stroke-width="3" font-family="ui-monospace,Menlo,monospace">' + esc(lab) + '</text>');
        }
        for (i = 0; i < sb.length; i++) {
            q = sb[i]; x2 = X(q.e); y2 = Y(q.n);
            h.push('<circle cx="' + f(x2) + '" cy="' + f(y2) + '" r="4.5" fill="#9aa1ac" stroke="#0b0f15" stroke-width="1.5"/>');
            h.push('<text x="' + f(x2 + 7) + '" y="' + f(y2 - 6) + '" font-size="10.5" font-weight="700" fill="#e6e8eb" paint-order="stroke" stroke="#0b0f15" stroke-width="3" font-family="ui-monospace,Menlo,monospace">' + esc(String(q.pt.name || '')) + '</text>');
        }
        // já (jen tečka, když jsem v záběru)
        var la = g('userLat'), ln = g('userLng');
        if (la != null && ln != null) {
            var me = enu(pt.lat, pt.lng, la, ln);
            if (Math.abs(me.e) * sc < W / 2 - 10 && Math.abs(me.n) * sc < H / 2 - 10) {
                h.push('<circle cx="' + f(X(me.e)) + '" cy="' + f(Y(me.n)) + '" r="5" fill="#fff" stroke="#0b0f15" stroke-width="1.5"/>');
                h.push('<text x="' + f(X(me.e) + 8) + '" y="' + f(Y(me.n) + 4) + '" font-size="10" font-weight="700" fill="#fff" paint-order="stroke" stroke="#0b0f15" stroke-width="3" font-family="system-ui">ty</text>');
            }
        }
        // tenhle bod
        h.push('<circle cx="' + cx + '" cy="' + cy + '" r="13" fill="none" stroke="#3fbc8c" stroke-opacity=".35"/>');
        h.push('<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="#3fbc8c" stroke="#0b0f15" stroke-width="1.5"/>');
        h.push('<text x="' + (cx - 10) + '" y="' + (cy + 22) + '" font-size="12" font-weight="800" fill="#3fbc8c" paint-order="stroke" stroke="#0b0f15" stroke-width="3" font-family="ui-monospace,Menlo,monospace">' + esc(String(pt.name || '')) + '</text>');
        // sever + měřítko
        h.push('<path d="M' + (W - 22) + ' 34 l0 -18 m-5 6 l5 -6 5 6" fill="none" stroke="#e6e8eb" stroke-width="1.4" stroke-linecap="round"/><text x="' + (W - 26) + '" y="47" font-size="10" font-weight="700" fill="#9aa1ac" font-family="system-ui">S</text>');
        var mm = hezkeMeritko(R * 0.6), mpx = mm * sc;
        h.push('<line x1="12" y1="' + (H - 12) + '" x2="' + f(12 + mpx) + '" y2="' + (H - 12) + '" stroke="#e6e8eb" stroke-width="2"/><text x="12" y="' + (H - 17) + '" font-size="10" fill="#9aa1ac" font-family="system-ui">' + mm + ' m</text>');
        var sk = document.createElement('div'); sk.id = 'ag-kb-sk'; sk.className = 'ag-kb-sk';
        sk.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Náčrt okolí bodu">' + h.join('') + '</svg>'
            + '<div class="lg"><i style="background:#3fbc8c"></i>tento bod' + (sb.length ? ' &nbsp;<i style="background:#9aa1ac"></i>sousední body &nbsp;<i style="background:#fbbf24;border-radius:0;height:2px"></i>oměrné' : '') + (nPar ? ' &nbsp;<i style="background:rgba(255,255,255,.4);border-radius:0;height:2px"></i>parcely' : '') + '</div>'
            + ((!sb.length && !nPar) ? '<div class="pz">Zatím jen tenhle bod. Přidej další body zakázky, nebo stáhni parcely (Nástroje → Katastr — parcely) a náčrt se doplní sám.</div>' : '');
        var bento = document.getElementById('ag-kb-bento');
        (bento || body.firstChild).insertAdjacentElement('afterend', sk);
        if (sb.length) {
            var om = document.createElement('div'); om.id = 'ag-kb-om'; om.className = 'ag-kb-om';
            om.innerHTML = sb.slice(0, 3).map(function (q) { return '<div><small>→ ' + esc(String(q.pt.name || '')) + '</small><b>' + (q.d < 10 ? n2(q.d) : n1(q.d)) + ' m</b></div>'; }).join('');
            sk.insertAdjacentElement('afterend', om);
        }
    }

    // živé hodnoty, dokud je karta otevřená (2×/s stačí — čísla se čtou očima)
    function start() {
        stop();
        TIMER = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () {
            var sheet = document.getElementById('bottom-sheet');
            if (!sheet || !sheet.classList.contains('open') || !_pt) { stop(); return; }
            try { fillDev(_pt); fillDist(_pt); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'karta-bodu:start'); }
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
