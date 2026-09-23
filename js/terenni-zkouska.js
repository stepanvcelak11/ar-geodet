/* TERÉNNÍ ZKOUŠKA TELEFONU (23. 9. 2026, n5 z 5. hodnocení — vybráno)
 *
 * Proč: nejnižší osa hodnocení je DŮVĚRA (7,0) — spousta věcí je ověřená jen v prohlížeči, ne na
 * skutečném telefonu, a každý telefon měří jinak. Tenhle průvodce za 5 minut venku změří to, co jde
 * zjistit jen v terénu, a dá JEDNU kartu „tvůj telefon měří na ±X m“, kterou jde poslat autorovi.
 *
 *   1) GPS 60 s na jednom místě — rozptyl fixů (95 % fixů do X m od průměru), hlášená přesnost, počet fixů
 *   2) Kompas proti Slunci — namíříš kameru na Slunce, rozdíl kurzu telefonu a spočítaného azimutu Slunce
 *   3) Kamera — je změřený zorný úhel (FOV)? Bez něj AR značky „ujíždějí“ ke krajům
 *   4) Známý bod — stoupneš si na bod v okolí (do 50 m), 15 s průměr GPS → odchylka od jeho souřadnic
 *
 * Nic se neukládá do zakázky; poslední výsledek je v localStorage (agTerenniZkouska_v1).
 * Odpojitelné: smaž tento soubor + řádek ag/lazy v index.html + záznam v js/tools-registry.js a návod.
 */
(function () {
    'use strict';
    var ID = 'ag-tz-modal', LS = 'agTerenniZkouska_v1';
    var swallow = function (e, w) { try { window.AG && AG.swallow && AG.swallow(e, 'terenni-zkouska:' + w); } catch (x) { /* nic */ } };
    var t = function (s) { try { return window.AGJazyk && AGJazyk.t ? AGJazyk.t(s) : s; } catch (e) { return s; } };
    var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var cz = function (x, d) { return Number(x).toFixed(d == null ? 1 : d).replace('.', ','); };
    var CFG = { gpsS: 60, bodS: 15 };          // délky měření (testy je zkracují přes _test.cfg)
    var V = { gps: null, kompas: null, fov: null, bod: null };

    function fix() { var f = window.AGFix; return (f && f.lat != null && !f.err) ? f : null; }
    function mistni(lat, lng) { try { return typeof agMistni === 'function' ? agMistni(lat, lng) : null; } catch (e) { return null; } }
    function vzd(a, b) { var dx = (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180), dy = (b.lat - a.lat) * 111320; return Math.hypot(dx, dy); }
    function kurz() { try { return (typeof currentHeading !== 'undefined' && isFinite(currentHeading)) ? ((currentHeading % 360) + 360) % 360 : null; } catch (e) { return null; } }

    // sbírá fixy z AGFix (appka už GPS sleduje — nový watch by jen spotřeboval baterii)
    function sbirej(sek, onTik) {
        return new Promise(function (res) {
            var body = [], posl = 0, start = Date.now();
            var h = setInterval(function () {
                var f = fix();
                if (f && f.ts !== posl) { posl = f.ts; body.push({ lat: f.lat, lng: f.lng, acc: f.acc }); }
                var z = Math.max(0, sek - Math.round((Date.now() - start) / 1000));
                if (onTik) onTik(z, body.length);
                if (Date.now() - start >= sek * 1000) { clearInterval(h); res(body); }
            }, 250);
        });
    }
    function rozbor(body) {
        if (!body.length) return null;
        var m = { lat: 0, lng: 0 };
        body.forEach(function (b) { m.lat += b.lat; m.lng += b.lng; });
        m.lat /= body.length; m.lng /= body.length;
        var d = body.map(function (b) { return vzd(m, b); }).sort(function (a, b) { return a - b; });
        var acc = body.map(function (b) { return b.acc || 0; }).filter(Boolean).sort(function (a, b) { return a - b; });
        return { n: body.length, stred: m, r95: d[Math.min(d.length - 1, Math.floor(d.length * 0.95))], max: d[d.length - 1], acc: acc.length ? acc[acc.length >> 1] : null };
    }

    // ---- kroky ------------------------------------------------------------------------
    function krokGps(el) {
        var b = el.querySelector('button');
        b.disabled = true;
        sbirej(CFG.gpsS, function (z, n) { b.textContent = t('Stůj na místě…') + ' ' + z + ' s · ' + n + ' ' + t('fixů'); }).then(function (body) {
            var r = rozbor(body);
            V.gps = r;
            b.disabled = false; b.textContent = t('Změřit znovu');
            vysledek(el, !r ? { st: 'bad', tx: t('Za minutu nepřišel žádný fix — vyjdi pod volné nebe a zkus to znovu.') }
                : { st: r.r95 <= 3 ? 'ok' : r.r95 <= 8 ? 'warn' : 'bad', tx: t('95 % fixů do') + ' ' + cz(r.r95) + ' m ' + t('od průměru') + ' · ' + t('telefon hlásí') + ' ±' + cz(r.acc || 0) + ' m · ' + r.n + ' ' + t('fixů') });
            souhrn();
        });
    }
    function krokKompas(el) {
        var f = fix(), s = null;
        try { if (f && window.AGSun) s = AGSun.pos(new Date(), f.lat, f.lng); } catch (e) { swallow(e, 'sun'); }
        if (!s || s.el < 5) { V.kompas = { preskoceno: true }; vysledek(el, { st: 'warn', tx: t('Slunce je teď pod obzorem nebo moc nízko — tenhle krok přeskoč, nebo použij Kontrolu kompasu podle Severky.') }); souhrn(); return; }
        var h = kurz();
        if (h == null) { vysledek(el, { st: 'bad', tx: t('Kompas nehlásí směr — povol v telefonu Pohyb a orientaci.') }); return; }
        var dif = ((h - s.az + 540) % 360) - 180;
        V.kompas = { dif: dif, az: s.az, el: s.el, kurz: h };
        var a = Math.abs(dif);
        vysledek(el, { st: a <= 5 ? 'ok' : a <= 15 ? 'warn' : 'bad', tx: t('Kompas ukazuje o') + ' ' + cz(dif, 0) + '° ' + t('vedle Slunce') + ' (' + t('Slunce') + ' ' + cz(s.az, 0) + '°, ' + t('výška') + ' ' + cz(s.el, 0) + '°)'
            + (a > 15 ? ' — ' + t('zkalibruj kompas osmičkou, nebo srovnej sever podle Slunce.') : '') });
        souhrn();
    }
    function krokFov(el) {
        var h = 90, kal = false;
        try { h = +visSettings.fovH || 90; kal = !!visSettings.fovH && Math.abs(visSettings.fovH - 90) > 0.05; } catch (e) { swallow(e, 'fov'); }
        V.fov = { h: h, kal: kal };
        vysledek(el, kal ? { st: 'ok', tx: t('Zorný úhel kamery je změřený:') + ' ' + cz(h) + '°' }
            : { st: 'warn', tx: t('Zorný úhel kamery není změřený (appka počítá s 90°) — značky v AR můžou ke krajům ujíždět. Změř ho v Nástrojích → Srovnat AR → Změřit zorný úhel kamery.') });
        souhrn();
    }
    function nejblizsiBod() {
        var f = fix(); if (!f || typeof arPoints === 'undefined') return null;
        var best = null;
        arPoints.forEach(function (p) { if (p.hidden || !isFinite(p.lat)) return; var d = vzd(f, p); if (d <= 50 && (!best || d < best.d)) best = { p: p, d: d }; });
        return best;
    }
    function krokBod(el) {
        var nb = nejblizsiBod(), b = el.querySelector('button');
        if (!nb) { vysledek(el, { st: 'warn', tx: t('Do 50 m není žádný bod. Dojdi k úřednímu nebo svému bodu, nebo krok přeskoč.') }); return; }
        b.disabled = true;
        sbirej(CFG.bodS, function (z) { b.textContent = t('Stůj přesně na bodu') + ' ' + (nb.p.name || '') + '… ' + z + ' s'; }).then(function (body) {
            b.disabled = false; b.textContent = t('Změřit znovu');
            var r = rozbor(body);
            if (!r) { vysledek(el, { st: 'bad', tx: t('Nepřišel žádný fix.') }); return; }
            var d = vzd(r.stred, nb.p), a = mistni(r.stred.lat, r.stred.lng), c = mistni(nb.p.lat, nb.p.lng);
            V.bod = { name: nb.p.name, d: d, dy: a && c ? a.y - c.y : null, dx: a && c ? a.x - c.x : null };
            vysledek(el, { st: d <= 3 ? 'ok' : d <= 6 ? 'warn' : 'bad', tx: t('Na bodu') + ' ' + (nb.p.name || '') + ' ' + t('ukazuje GPS') + ' ' + cz(d) + ' m ' + t('vedle')
                + (V.bod.dy != null ? ' (ΔY ' + cz(V.bod.dy, 2) + ' m, ΔX ' + cz(V.bod.dx, 2) + ' m)' : '') });
            souhrn();
        });
    }

    // ---- výsledek ---------------------------------------------------------------------------
    function vysledek(el, r) { var o = el.querySelector('.tz-out'); o.className = 'tz-out ' + r.st; o.textContent = r.tx; }
    function odhad() {
        var parts = [];
        if (V.gps) parts.push(V.gps.r95);
        if (V.bod) parts.push(V.bod.d);
        if (!parts.length) return null;
        return Math.max.apply(null, parts);
    }
    function text() {
        var L = [t('Terénní zkouška telefonu') + ' — ' + new Date().toLocaleString('cs-CZ')];
        try { L.push(String(navigator.userAgent || '').slice(0, 140)); } catch (e) { /* nic */ }
        if (V.gps) L.push('GPS 60 s: 95 % ' + cz(V.gps.r95) + ' m, max ' + cz(V.gps.max) + ' m, hlášeno ±' + cz(V.gps.acc || 0) + ' m, ' + V.gps.n + ' fixů');
        if (V.kompas) L.push(V.kompas.preskoceno ? 'Kompas × Slunce: přeskočeno' : 'Kompas × Slunce: ' + cz(V.kompas.dif, 0) + '° (Slunce az ' + cz(V.kompas.az, 0) + '°, výška ' + cz(V.kompas.el, 0) + '°)');
        if (V.fov) L.push('FOV: ' + cz(V.fov.h) + '° ' + (V.fov.kal ? 'změřený' : 'výchozí'));
        if (V.bod) L.push('Na bodu ' + V.bod.name + ': ' + cz(V.bod.d) + ' m' + (V.bod.dy != null ? ' (ΔY ' + cz(V.bod.dy, 2) + ', ΔX ' + cz(V.bod.dx, 2) + ')' : ''));
        var o = odhad(); if (o != null) L.push('Telefon měří na ±' + cz(o) + ' m');
        return L.join('\n');
    }
    function souhrn() {
        var m = document.getElementById(ID); if (!m) return;
        var o = odhad(), box = m.querySelector('.tz-sum');
        if (o == null) { box.hidden = true; return; }
        box.hidden = false;
        box.querySelector('b').textContent = t('Tvůj telefon měří na') + ' ±' + cz(o) + ' m';
        box.querySelector('span').textContent = o <= 3 ? t('Na dohledání bodů výborné — hledej v kruhu ±3 m.') : o <= 6 ? t('Na dohledání bodů dobré — hledej v kruhu kolem značky, pomůže Přesná GPS.') : t('Slabší — zkus volné nebe, Přesnou GPS nebo korekci z mapy; na centimetry je potřeba RTK.');
        try { localStorage.setItem(LS, JSON.stringify({ ts: Date.now(), gps: V.gps && { r95: V.gps.r95, acc: V.gps.acc, n: V.gps.n }, kompas: V.kompas, fov: V.fov, bod: V.bod, odhad: o })); } catch (e) { swallow(e, 'ls'); }
    }

    // ---- okno -------------------------------------------------------------------------------
    var CSS = '#' + ID + ' .tz-k{border:1px solid var(--glass-border,rgba(255,255,255,.12));border-radius:14px;padding:12px;margin:0 0 10px;background:var(--glass-bg,rgba(255,255,255,.03));}'
        + '#' + ID + ' .tz-k h4{margin:0 0 4px;font-size:calc(15px * var(--ag-font-scale,1));}'
        + '#' + ID + ' .tz-k p{margin:0 0 10px;font-size:calc(12.5px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);line-height:1.45;}'
        + '#' + ID + ' .tz-k .btn{margin:0;}'
        + '#' + ID + ' .tz-out{margin-top:10px;font-size:calc(13px * var(--ag-font-scale,1));line-height:1.45;}'
        + '#' + ID + ' .tz-out:empty{display:none;}'
        + '#' + ID + ' .tz-out.ok{color:var(--accent,#3fcf8e);} #' + ID + ' .tz-out.warn{color:var(--warning,#f0b24a);} #' + ID + ' .tz-out.bad{color:var(--danger,#f07167);}'
        + '#' + ID + ' .tz-sum{border:1px solid var(--accent,#3fcf8e);border-radius:14px;padding:12px;margin:0 0 10px;background:rgba(63,207,142,.08);}'
        + '#' + ID + ' .tz-sum b{display:block;font-size:calc(18px * var(--ag-font-scale,1));margin-bottom:4px;}'
        + '#' + ID + ' .tz-sum span{font-size:calc(13px * var(--ag-font-scale,1));}'
        + '#' + ID + ' .tz-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;}';
    var KROKY = [
        { k: 'gps', h: '1 · GPS na jednom místě (60 s)', p: 'Postav se pod volné nebe a minutu se nehýbej. Změřím, jak moc poloha skáče.', b: 'Spustit (60 s)', fn: krokGps },
        { k: 'kompas', h: '2 · Kompas proti Slunci', p: 'Namiř kameru telefonu ke Slunci (do slunce se nedívej, stačí mířit) a klepni. Porovnám kurz telefonu se spočítaným azimutem Slunce.', b: 'Mířím na Slunce', fn: krokKompas },
        { k: 'fov', h: '3 · Kamera', p: 'Zkontroluju, jestli je změřený zorný úhel kamery — bez něj AR značky ke krajům ujíždějí.', b: 'Zkontrolovat', fn: krokFov },
        { k: 'bod', h: '4 · Známý bod v okolí', p: 'Stoupni si přesně na bod do 50 m (úřední nebo svůj) a klepni. 15 s průměruju GPS a porovnám s jeho souřadnicemi.', b: 'Stojím na bodu', fn: krokBod }
    ];
    function build() {
        var m = document.getElementById(ID);
        if (m) return m;
        if (!document.getElementById(ID + '-css')) { var st = document.createElement('style'); st.id = ID + '-css'; st.textContent = CSS; document.head.appendChild(st); }
        m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = ID; m.setAttribute('data-ag-needs', 'gps kompas');
        m.innerHTML = '<div class="modal-content"><h2 style="margin-top:0;">' + esc(t('Terénní zkouška telefonu')) + '</h2>'
            + '<div class="modal-body"><p style="margin:0 0 12px;font-size:calc(13px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);">' + esc(t('Pět minut venku a víš, na kolik metrů tvůj telefon měří. Kroky jdou v libovolném pořadí, kterýkoli můžeš přeskočit.')) + '</p>'
            + '<div class="tz-sum" hidden><b></b><span></span></div>'
            + KROKY.map(function (k) { return '<div class="tz-k" data-k="' + k.k + '"><h4>' + esc(t(k.h)) + '</h4><p>' + esc(t(k.p)) + '</p><button type="button" class="btn btn-secondary">' + esc(t(k.b)) + '</button><div class="tz-out"></div></div>'; }).join('')
            + '</div><div class="tz-btns"><button type="button" class="btn" id="ag-tz-send">' + esc(t('Poslat autorovi')) + '</button>'
            + '<button type="button" class="btn btn-secondary" id="ag-tz-close">' + esc(t('Zavřít')) + '</button></div></div>';
        document.body.appendChild(m);
        KROKY.forEach(function (k) { var el = m.querySelector('.tz-k[data-k="' + k.k + '"]'); el.querySelector('button').addEventListener('click', function () { try { k.fn(el); } catch (e) { swallow(e, k.k); } }); });
        m.querySelector('#ag-tz-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-tz-send').addEventListener('click', function () {
            var txt = text();
            var go = function () { try { window.agOpenZpetnaVazba({ kind: 'jine', txt: txt }); } catch (e) { swallow(e, 'send'); } };
            m.style.display = 'none';
            if (typeof window.agOpenZpetnaVazba === 'function') go();
            else if (window.AGLazy && AGLazy.need) AGLazy.need('js/zpetna-vazba.js', go);
        });
        return m;
    }
    function open() { var m = build(); m.style.display = 'flex'; }

    window.agOpenTerenniZkouska = open;
    window.AGTerenniZkouska = { open: open, _test: { cfg: CFG, stav: function () { return V; }, text: text, rozbor: rozbor } };
    try {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'terenni-zkouska', label: 'Terénní zkouška telefonu', cat: 'Měření', onClick: open,
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 8l1.5 1.5L14.5 6.5"/><path d="M10 14h4M10 17h3"/></svg>' });
        }
    } catch (e) { swallow(e, 'registr'); }
})();
