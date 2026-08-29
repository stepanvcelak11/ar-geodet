// ===== AR Geodet — SEVER PODLE SLUNCE (ODPOJITELNÁ vrstva) =====================
// Neinvazivní. NEEDITUJE logika.js, grafika.js ani js/kompas-check.js — jen čte
// globály (currentHeading, userLat/userLng, userHeadingOffset) a volá TÉHOŽ
// nudgeHeadingOffset() z grafika.js, který používá „Srovnat sever podle bodu".
// Žádná druhá cesta pro směr tu nevzniká.
//
// PROČ TO EXISTUJE
// js/kompas-check.js umí kompas podle Slunce ZKONTROLOVAT — řekne „kompas je
// vedle o 14°" a tím to končí. Tenhle nástroj tu chybějící druhou půlku dodělá:
// naměřenou odchylku rovnou POUŽIJE jako korekci severu.
//
// A hlavně: appka má čtyři způsoby, jak srovnat sever (podle bodu — ar-calibrate
// a orient-point, resekce, dvoubodová AR kalibrace) a VŠECHNY potřebují znát
// nějaký bod v dohledu. Uprostřed pole, na louce nebo v lese žádný takový není.
// Slunce je vidět vždycky a jeho azimut se spočítá na desetinu stupně dopředu —
// takže tohle je jediná orientace, která nepotřebuje ani bod, ani signál, ani
// magnetometr. Přesně to, co člověk ocení u armatury nebo mezi auty, kde
// magnetometr táhne o deset i dvacet stupňů vedle.
//
// DVA ZPŮSOBY MÍŘENÍ
//   • NA SLUNCE — otoč se tak, aby telefon (zadní kamera) mířil na Slunce.
//     Do Slunce se NEDÍVEJ; stačí namířit, díváš se na displej.
//   • PO STÍNU — když je Slunce vysoko nebo do něj mířit nechceš: postav se
//     zády ke Slunci a miř PODÉL vlastního stínu (stín míří k azimutu Slunce
//     + 180°). Stejná přesnost, oči v bezpečí.
//
// JAK SE MĚŘÍ
// Odchylka se nebere z jednoho okamžiku — po klepnutí se 3 sekundy sbírá směr
// a bere se KRUHOVÝ MEDIÁN vzorků (odolný proti třesu ruky i proti přeskoku
// přes 360°/0°). Ukáže se i rozptyl: když se ruka klepe, je to vidět a člověk
// může měření zopakovat.
//
// POCTIVĚ O PŘESNOSTI: namířit telefonem na Slunce od ruky jde tak na ±3–5°.
// To je pořád o řád lepší než magnetometr, který u kovu ujede i o 30°, ale
// není to náhrada za orientaci na známý bod (ta je na desetiny stupně).
// Nástroj proto míření odmítne, když je Slunce výš než 65° nad obzorem
// (kolem poledne se azimut mění nejrychleji a míření je nejméně spolehlivé)
// nebo když je pod obzorem.
//
// Vstup: dlaždice „Sever podle Slunce" v Nástrojích (AR a kalibrace).
// API: window.agOpenSeverSlunce().
// Odstranění: smaž js/sever-slunce.js + jeho řádek v index.html a spusť
//             python scripts/gen_sw_assets.py --bump.
// ==============================================================================
(function () {
    'use strict';
    if (window.agOpenSeverSlunce) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

    var EL_MAX = 65;      // nad tímhle je Slunce moc vysoko — azimut se mění rychle
    var EL_MIN = 1.5;     // pod tímhle je za obzorem / v refrakci
    var SAMPLE_MS = 3000; // jak dlouho se sbírá směr
    var SAMPLE_HZ = 12;

    var modal = null, tickTimer = null, sampling = null;
    var mode = 'sun';     // 'sun' = mířím na Slunce, 'shadow' = mířím po stínu
    var lastApplied = null;   // pro „Vzít zpět"

    function swallow(e, w) { try { window.AG && AG.swallow && AG.swallow(e, 'sever-slunce:' + w); } catch (e2) { /* fail-silent */ } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function info(m, t) { try { if (typeof window.agInfo === 'function') return window.agInfo(m, t); } catch (e) { swallow(e, 'info'); } }

    function heading() {
        try { if (typeof currentHeading === 'number' && isFinite(currentHeading)) return currentHeading; } catch (e) { swallow(e, 'heading'); }
        return null;
    }
    function here() {
        try {
            if (typeof userLat === 'number' && typeof userLng === 'number' && isFinite(userLat) && isFinite(userLng)) return { lat: userLat, lng: userLng };
        } catch (e) { swallow(e, 'here'); }
        return null;
    }
    function offsetNow() {
        try { if (typeof userHeadingOffset === 'number' && isFinite(userHeadingOffset)) return userHeadingOffset; } catch (e) { swallow(e, 'offsetNow'); }
        return 0;
    }

    // rozdíl úhlů v <-180, 180>
    function adiff(a, b) { return ((a - b + 540) % 360) - 180; }

    // KRUHOVÝ MEDIÁN: obyčejný medián by na přechodu 359°/1° dal 180°, tedy přesný
    // opak. Proto se všechno počítá jako odchylky od prvního vzorku a medián se
    // teprve pak vrátí zpět do absolutního azimutu.
    function circMedian(list) {
        if (!list.length) return null;
        var base = list[0];
        var d = list.map(function (v) { return adiff(v, base); }).sort(function (x, y) { return x - y; });
        var m = (d.length % 2) ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
        return ((base + m) % 360 + 360) % 360;
    }
    // rozptyl vzorků kolem mediánu (max odchylka) — ukazatel klidu ruky
    function spread(list, med) {
        var mx = 0;
        list.forEach(function (v) { var a = Math.abs(adiff(v, med)); if (a > mx) mx = a; });
        return mx;
    }

    function sun() {
        var p = here();
        if (!p) return null;
        try {
            if (window.AGSun && typeof AGSun.pos === 'function') return AGSun.pos(new Date(), p.lat, p.lng);
        } catch (e) { swallow(e, 'sun'); }
        return null;
    }

    // Azimut, kterým MÁ telefon mířit: na Slunce, nebo po stínu (opačně).
    function targetAz(s) {
        if (!s) return null;
        return mode === 'shadow' ? ((s.az + 180) % 360) : s.az;
    }

    // ---- UI --------------------------------------------------------------------
    function build() {
        modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'sever-slunce-modal';
        modal.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Sever podle Slunce</h3>'
            + '<div class="modal-body">'
            + '  <div class="ss-seg" id="ss-seg">'
            + '    <button type="button" class="ss-seg-b ss-on" data-m="sun">Mířím na Slunce</button>'
            + '    <button type="button" class="ss-seg-b" data-m="shadow">Mířím po stínu</button>'
            + '  </div>'
            + '  <div class="ss-note" id="ss-hint"></div>'
            + '  <div class="ss-dial" id="ss-dial"><div class="ss-need" id="ss-need"></div><div class="ss-val" id="ss-val">–</div></div>'
            + '  <div id="ss-rows"></div>'
            + '  <button class="btn btn-primary" id="ss-go" style="margin-top:12px;">Jsem namířený — změř</button>'
            + '  <div id="ss-out"></div>'
            + '</div>'
            + '<button class="btn btn-secondary" style="margin-top:15px;" id="ss-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(modal);

        modal.querySelector('#ss-close').addEventListener('click', close);
        modal.querySelector('#ss-go').addEventListener('click', measure);
        modal.querySelector('#ss-seg').addEventListener('click', function (ev) {
            var b = ev.target.closest('.ss-seg-b'); if (!b) return;
            mode = b.getAttribute('data-m');
            Array.prototype.forEach.call(modal.querySelectorAll('.ss-seg-b'), function (x) { x.classList.toggle('ss-on', x === b); });
            render();
        });
    }

    function styles() {
        var css =
            '#sever-slunce-modal .ss-seg{display:flex;gap:6px;margin-bottom:10px;}'
            + '#sever-slunce-modal .ss-seg-b{flex:1;padding:9px 6px;min-height:var(--tap-min,44px);border-radius:var(--r-sm,9px);'
            + 'border:1px solid var(--glass-border,rgba(255,255,255,.1));background:var(--surface-1,rgba(255,255,255,.06));'
            + 'color:var(--text-muted,#9aa1ac);font-size:calc(13px * var(--ag-font-scale,1));font-family:inherit;cursor:pointer;}'
            + '#sever-slunce-modal .ss-seg-b.ss-on{background:var(--accent-soft,rgba(47,158,116,.14));border-color:var(--accent-line,rgba(47,158,116,.42));color:var(--accent,#2f9e74);font-weight:600;}'
            + '#sever-slunce-modal .ss-note{color:var(--text-muted,#9aa1ac);font-size:calc(12.5px * var(--ag-font-scale,1));line-height:1.45;margin-bottom:12px;}'
            // Terč: kruh se šipkou, která ukazuje, kam se otočit. Velké a čitelné
            // na slunci — v terénu se na to kouká přimhouřenýma očima.
            + '#sever-slunce-modal .ss-dial{position:relative;width:150px;height:150px;margin:0 auto 12px;border-radius:50%;'
            + 'border:2px solid var(--glass-border,rgba(255,255,255,.1));background:var(--surface-1,rgba(255,255,255,.06));'
            + 'display:flex;align-items:center;justify-content:center;}'
            + '#sever-slunce-modal .ss-need{position:absolute;left:50%;top:6px;width:0;height:0;margin-left:-11px;'
            + 'border-left:11px solid transparent;border-right:11px solid transparent;border-bottom:26px solid var(--accent,#2f9e74);'
            + 'transform-origin:50% 69px;transition:transform .12s linear;}'
            + '#sever-slunce-modal .ss-val{font-family:var(--font-mono,monospace);font-size:calc(21px * var(--ag-font-scale,1));'
            + 'font-weight:700;color:var(--data,#e6bd76);}'
            + '#sever-slunce-modal .ss-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;'
            + 'border-bottom:1px solid var(--glass-border,rgba(255,255,255,.1));font-size:calc(13px * var(--ag-font-scale,1));}'
            + '#sever-slunce-modal .ss-row b{font-family:var(--font-mono,monospace);color:var(--text-color,#eceef2);}'
            + '#sever-slunce-modal .ss-res{margin-top:12px;padding:11px;border-radius:var(--r-sm,9px);'
            + 'background:var(--accent-soft,rgba(47,158,116,.14));border:1px solid var(--accent-line,rgba(47,158,116,.42));'
            + 'font-size:calc(13px * var(--ag-font-scale,1));line-height:1.45;}'
            + '#sever-slunce-modal .ss-warn{margin-top:10px;padding:10px;border-radius:var(--r-sm,9px);'
            + 'background:rgba(251,191,36,.12);border:1px solid var(--warning,#fbbf24);color:var(--text-color,#eceef2);'
            + 'font-size:calc(12.5px * var(--ag-font-scale,1));line-height:1.45;}';
        try {
            if (window.AG && typeof AG.style === 'function') AG.style('ag-sever-slunce-css', css);
            else { var st = document.createElement('style'); st.id = 'ag-sever-slunce-css'; st.textContent = css; document.head.appendChild(st); }
        } catch (e) { swallow(e, 'styles'); }
    }

    // ---- živé vykreslení -------------------------------------------------------
    function render() {
        if (!modal) return;
        var s = sun(), p = here(), h = heading();
        var hint = modal.querySelector('#ss-hint');
        var rows = modal.querySelector('#ss-rows');
        var go = modal.querySelector('#ss-go');
        var need = modal.querySelector('#ss-need');
        var val = modal.querySelector('#ss-val');

        hint.innerHTML = (mode === 'shadow')
            ? 'Postav se <b>zády ke Slunci</b> a otoč telefon tak, aby mířil <b>podél tvého stínu</b> (od tebe pryč). Do Slunce se nedíváš.'
            : 'Otoč se tak, aby <b>zadní kamera mířila na Slunce</b>. <b>Nedívej se do něj</b> — koukáš na displej, telefon drž svisle.';

        if (!p) {
            rows.innerHTML = '<div class="ss-warn">Nemám polohu — bez ní neumím spočítat, kde Slunce je. Počkej na GPS fix.</div>';
            go.disabled = true; val.textContent = '–'; return;
        }
        if (!s) {
            rows.innerHTML = '<div class="ss-warn">Nenačetl se výpočet polohy Slunce (js/slunce.js).</div>';
            go.disabled = true; val.textContent = '–'; return;
        }

        var tAz = targetAz(s);
        var html = ''
            + '<div class="ss-row"><span>Azimut Slunce</span><b>' + s.az.toFixed(1) + '°</b></div>'
            + '<div class="ss-row"><span>Výška Slunce</span><b>' + s.el.toFixed(1) + '°</b></div>'
            + '<div class="ss-row"><span>Mám mířit na azimut</span><b>' + tAz.toFixed(1) + '°</b></div>'
            + '<div class="ss-row"><span>Kompas teď ukazuje</span><b>' + (h == null ? '–' : h.toFixed(1) + '°') + '</b></div>'
            + '<div class="ss-row"><span>Korekce severu teď</span><b>' + fmtDeg(offsetNow()) + '</b></div>';

        var block = null;
        if (s.el < EL_MIN) block = 'Slunce je pod obzorem (výška ' + s.el.toFixed(1) + '°). Tenhle způsob teď nejde použít.';
        else if (s.el > EL_MAX) block = 'Slunce je vysoko (' + s.el.toFixed(0) + '°). Kolem poledne se jeho azimut mění nejrychleji a míření je nejméně spolehlivé — počkej na nižší Slunce, nebo srovnej sever podle známého bodu.';
        else if (h == null) block = 'Kompas zatím nedává data — pohni telefonem (osmička), ať se magnetometr rozjede.';

        rows.innerHTML = html + (block ? '<div class="ss-warn">' + esc(block) + '</div>' : '');
        go.disabled = !!block;

        // Šipka: o kolik a kam se otočit, aby telefon mířil na cíl.
        if (h != null) {
            var d = adiff(tAz, h);
            need.style.transform = 'rotate(' + d.toFixed(1) + 'deg)';
            val.textContent = (Math.abs(d) < 1 ? '0' : (d > 0 ? '▸ ' : '◂ ') + Math.abs(d).toFixed(0)) + '°';
        } else { val.textContent = '–'; }
    }

    function fmtDeg(v) { return (v > 180 ? v - 360 : v).toFixed(1).replace('.', ',') + '°'; }

    // ---- měření ----------------------------------------------------------------
    function measure() {
        if (sampling) return;
        var go = modal.querySelector('#ss-go');
        var out = modal.querySelector('#ss-out');
        var list = [], n = Math.round(SAMPLE_MS / 1000 * SAMPLE_HZ), i = 0;
        sampling = setInterval(function () {
            var h = heading();
            if (h != null) list.push(h);
            i++;
            go.textContent = 'Měřím… ' + Math.max(0, Math.ceil((n - i) / SAMPLE_HZ)) + ' s — drž směr';
            if (i >= n) {
                clearInterval(sampling); sampling = null;
                go.textContent = 'Jsem namířený — změř';
                finish(list, out);
            }
        }, Math.round(1000 / SAMPLE_HZ));
    }

    function finish(list, out) {
        if (list.length < 5) { out.innerHTML = '<div class="ss-warn">Kompas během měření nedal dost hodnot. Zkus to znovu.</div>'; return; }
        var s = sun(); if (!s) return;
        var med = circMedian(list);
        var sp = spread(list, med);
        var tAz = targetAz(s);
        // delta = o kolik se musí PŘIČÍST ke směru, aby kompas ukazoval pravdu
        var delta = adiff(tAz, med);

        var q = sp > 12 ? 'Ruka se dost klepala (rozptyl ' + sp.toFixed(0) + '°) — výsledek ber s rezervou, radši zopakuj.'
            : (sp > 6 ? 'Rozptyl ' + sp.toFixed(0) + '° — přijatelné.' : 'Klidná ruka (rozptyl ' + sp.toFixed(0) + '°).');

        out.innerHTML =
            '<div class="ss-res">'
            + '<div style="font-weight:700;margin-bottom:6px;">Kompas je vedle o ' + fmtDeg(delta) + '</div>'
            + '<div style="color:var(--text-muted,#9aa1ac);">Naměřený směr ' + med.toFixed(1) + '° · má být ' + tAz.toFixed(1) + '° · ' + esc(q) + '</div>'
            + '<button class="btn btn-primary" id="ss-apply" style="margin-top:10px;">Srovnat sever (' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + '°)</button>'
            + '<button class="btn btn-secondary" id="ss-undo" style="margin-top:6px;display:none;">Vzít zpět</button>'
            + '</div>';

        modal.querySelector('#ss-apply').addEventListener('click', function () { apply(delta); });
        var u = modal.querySelector('#ss-undo');
        u.addEventListener('click', function () {
            if (lastApplied == null) return;
            apply(-lastApplied, true);
            lastApplied = null;
            u.style.display = 'none';
            info('Korekce severu vrácena zpět.');
        });
    }

    // Používá TÝŽ nudgeHeadingOffset() z grafika.js jako „Srovnat sever podle bodu",
    // takže se korekce uloží (arHeadingOffset) a promítne do HUD úplně stejně.
    // Fallback je jen pro případ, že by jádro funkci nemělo.
    function apply(delta, isUndo) {
        var ok = false;
        try {
            if (typeof nudgeHeadingOffset === 'function') { nudgeHeadingOffset(delta); ok = true; }
        } catch (e) { swallow(e, 'apply:nudge'); }
        if (!ok) {
            try {
                if (typeof userHeadingOffset !== 'undefined') {
                    userHeadingOffset = ((userHeadingOffset + delta) % 360 + 360) % 360;
                    if (typeof setStoredData === 'function') setStoredData('arHeadingOffset', String(userHeadingOffset));
                    if (typeof updateHeadingOffsetVal === 'function') updateHeadingOffsetVal();
                    ok = true;
                }
            } catch (e) { swallow(e, 'apply:direct'); }
        }
        if (!ok) { info('Korekci severu se nepodařilo nastavit.'); return; }
        try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) { swallow(e, 'apply:vib'); }
        if (!isUndo) {
            lastApplied = delta;
            var u = modal && modal.querySelector('#ss-undo'); if (u) u.style.display = '';
            info('Sever srovnán podle Slunce o ' + fmtDeg(delta) + '.');
        }
        render();
    }

    // ---- otevření / zavření ----------------------------------------------------
    function open() {
        styles();
        if (!modal) build();
        modal.style.display = 'flex';
        modal.classList.add('ag-open');
        lastApplied = null;
        var out = modal.querySelector('#ss-out'); if (out) out.innerHTML = '';
        render();
        if (!tickTimer) tickTimer = setInterval(render, 200);
    }

    function close() {
        if (sampling) { clearInterval(sampling); sampling = null; }
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        if (modal) { modal.style.display = 'none'; modal.classList.remove('ag-open'); }
    }

    window.agOpenSeverSlunce = open;
    window.agCloseSeverSlunce = close;

    try {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'sever-slunce', label: 'Sever podle Slunce', icon: ICON, cat: 'AR a kalibrace', onClick: open });
        }
    } catch (e) { swallow(e, 'register'); }
})();
