// ===== AR Geodet — KONTROLA VRSTVY ZA FINIŠEREM (ODPOJITELNÁ vrstva) ===========
// Denní smyčka geodeta na pokládce: jdu za finišerem, na vytyčeném místě změřím
// výšku hotové vrstvy a chci HNED vědět, jestli sedí na projekt — a o kolik ne.
//
// PROČ TENHLE MODUL VZNIKL: v appce byly všechny díly, ale žádný je nespojoval.
//   • js/vrstvy.js zná skladbu vozovky a tloušťky, ale je to JEN kalkulačka
//     („žádná GPS" píše rovnou v hlavičce),
//   • js/vytycovani.js je jen odškrtávací checklist bez výšky,
//   • js/vyska-gps.js umí výšku z DMR, ale sám upozorňuje, že za finišerem je
//     DMR ŠPATNĚ (je to terén z leteckého skenu 2009–2013, ne tvůj nový povrch).
// Chybělo tedy to hlavní: změřeno → projekt → ROZDÍL → protokol.
//
// CO TENHLE MODUL ZÁMĚRNĚ NEDĚLÁ: nepředstírá, že měří telefonem. Výšku bere
// z ROVERU (ručně opsané Z) — appka nemá a nebude mít připojení na externí GNSS
// (Web Bluetooth je pro tenhle projekt zamítnutý). Výška z telefonu jde použít
// taky, ale jen jako hrubá orientace a modul u ní VŽDY napíše, jak je nejistá:
// GPS výška z mobilu je ±1,5 až 4 m, což je o dva řády mimo toleranci pokládky.
//
// REFERENČNÍ (PROJEKTOVÁ) PLOCHA — dvě poctivé varianty:
//   1) KÓTA — jedna projektová výška pro daný úsek. Nejrychlejší a nejčastější:
//      nepotřebuje polohu, takže do výsledku nepropadá chyba polohy telefonu.
//   2) ROVINA — proloží se metodou nejmenších čtverců body zakázky, které mají
//      výšku (min. 3). Projektová výška se pak počítá pro AKTUÁLNÍ polohu, takže
//      do ní vstupuje i chyba polohy z telefonu. Modul proto rovnou ukazuje,
//      kolik ta chyba v cm dělá (±poloha × sklon) — ať se nikdo nediví.
//
// ODSAZENÍ VRSTVY: když referenční kóta popisuje jinou vrstvu, než kterou právě
// pokládáš, sečtou se tloušťky mezi nimi ze skladby v js/vrstvy.js
// (localStorage agVrstvy_v1) včetně nadvýšení na hutnění. Jde i vypnout / přepsat.
//
// Data: per zakázka přes getStoredData/setStoredData (klíč agKvProtokol12),
// nastavení per zařízení v localStorage. Vše offline, žádné síťové volání.
//
// Odstranění: smaž js/kontrola-vrstvy.js + řádek <script> v index.html
// (a přegeneruj sw.js: python scripts/gen_sw_assets.py).
// ================================================================================
(function () {
    'use strict';
    if (window.AGKontrolaVrstvy) return;

    var MODAL_ID = 'agkv-modal';
    var STYLE_ID = 'agkv-style';
    var CFG_KEY = 'agKvCfg_v1';        // nastavení (per zařízení)
    var LOG_KEY = 'agKvProtokol12';    // protokol měření (per zakázka)
    var VRSTVY_KEY = 'agVrstvy_v1';    // skladba z js/vrstvy.js — jen ČTEME

    // ---- pomocné -------------------------------------------------------------
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    // čísla z formulářů čte agNum (snese desetinnou čárku); fallback pro případ,
    // že by odpojitelná vrstva js/vstupy.js chyběla.
    function num(src) {
        if (typeof window.agNum === 'function') return window.agNum(src);
        var el = (typeof src === 'string') ? document.getElementById(src) : src;
        var raw = (el && 'value' in el) ? el.value : src;
        var v = parseFloat(String(raw == null ? '' : raw).replace(/\s/g, '').replace(',', '.'));
        return isFinite(v) ? v : NaN;
    }
    function fmt(n, d) { return isFinite(n) ? n.toFixed(d == null ? 2 : d).replace('.', ',') : '—'; }
    function info(m, t) {
        try { if (typeof window.agInfo === 'function') return window.agInfo(m, t); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:info'); }
        try { alert(String(m).replace(/<[^>]*>/g, '')); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:info'); }
    }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:toast'); } }

    function loadCfg() {
        var d = { mode: 'kota', kota: null, tol: 2, anten: 0, planeIds: [], useVrstvy: true, manualOffset: null };
        try { var v = JSON.parse(localStorage.getItem(CFG_KEY)); if (v && typeof v === 'object') Object.assign(d, v); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:loadCfg'); }
        return d;
    }
    function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:saveCfg'); } }

    function loadLog() {
        try {
            var raw = (typeof window.getStoredData === 'function') ? getStoredData(LOG_KEY) : localStorage.getItem(LOG_KEY);
            var v = JSON.parse(raw || '[]');
            return Array.isArray(v) ? v : [];
        } catch (e) { return []; }
    }
    function saveLog(list) {
        var s = JSON.stringify(list);
        try {
            if (typeof window.setStoredData === 'function') setStoredData(LOG_KEY, s);
            else localStorage.setItem(LOG_KEY, s);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:saveLog'); }
    }

    // body zakázky, které mají výšku — kandidáti na proložení roviny
    function pointsWithZ() {
        var out = [];
        try {
            if (typeof persistentCustomPoints === 'undefined') return out;
            persistentCustomPoints.forEach(function (p) {
                if (p && p.vyska != null && isFinite(Number(p.vyska))) out.push(p);
            });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:pointsWithZ'); }
        return out;
    }

    // WGS84 -> S-JTSK; rovina se prokládá v metrických souřadnicích, ne ve stupních
    function toJTSK(lat, lng) {
        try {
            var s = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]);
            return { y: Math.abs(s[0]), x: Math.abs(s[1]) };
        } catch (e) { return null; }
    }

    // ---- REFERENČNÍ ROVINA (MNČ) ---------------------------------------------
    // z = a·y + b·x + c  proložené vybranými body. Vrací i sklon v procentech,
    // ze kterého se pak počítá, jak se do výsledku promítne chyba polohy.
    function fitPlane(pts) {
        if (!pts || pts.length < 3) return null;
        if (!window.LinAlg || typeof LinAlg.lstsq !== 'function') return null;
        var A = [], b = [], ok = true;
        // souřadnice se posouvají k prvnímu bodu — bez toho jsou v matici čísla
        // řádu 10^6 a normální rovnice ztrácejí přesnost
        var j0 = toJTSK(pts[0].lat, pts[0].lng);
        if (!j0) return null;
        pts.forEach(function (p) {
            var j = toJTSK(p.lat, p.lng);
            if (!j) { ok = false; return; }
            A.push([j.y - j0.y, j.x - j0.x, 1]);
            b.push(Number(p.vyska));
        });
        if (!ok) return null;
        var sol = LinAlg.lstsq(A, b);
        if (!sol || !isFinite(sol[0]) || !isFinite(sol[1]) || !isFinite(sol[2])) return null;
        // odchylky bodů od proložené roviny = kontrola, jestli body vůbec leží v rovině
        var maxDev = 0, sum2 = 0;
        for (var i = 0; i < A.length; i++) {
            var fitZ = sol[0] * A[i][0] + sol[1] * A[i][1] + sol[2];
            var dv = b[i] - fitZ;
            sum2 += dv * dv;
            if (Math.abs(dv) > Math.abs(maxDev)) maxDev = dv;
        }
        var rms = Math.sqrt(sum2 / A.length);
        var slopePct = Math.hypot(sol[0], sol[1]) * 100;   // spád roviny v %
        return { a: sol[0], b: sol[1], c: sol[2], y0: j0.y, x0: j0.x, n: A.length, rms: rms, maxDev: maxDev, slopePct: slopePct };
    }
    function planeZ(pl, lat, lng) {
        var j = toJTSK(lat, lng);
        if (!j || !pl) return null;
        return pl.a * (j.y - pl.y0) + pl.b * (j.x - pl.x0) + pl.c;
    }

    // ---- ODSAZENÍ ZE SKLADBY (js/vrstvy.js) ----------------------------------
    // Skladba je uložená SHORA dolů: layers[0] je nejvyšší vrstva. sel.ref = vrstva,
    // které odpovídá referenční kóta (model v kontroleru), sel.lay = vrstva, kterou
    // právě pokládám. Odsazení = součet tlouštěk vrstev MEZI nimi; u pokládané
    // vrstvy se přičte nadvýšení na hutnění (t × p/100), protože čerstvě položená
    // vrstva má být vyšší a sedne si až po zhutnění.
    function vrstvyOffset() {
        try {
            var D = JSON.parse(localStorage.getItem(VRSTVY_KEY));
            if (!D || !Array.isArray(D.skladby) || !D.skladby.length) return null;
            var sk = D.skladby[Math.min(Math.max(0, (D.sel && D.sel.sk) | 0), D.skladby.length - 1)];
            if (!sk || !Array.isArray(sk.layers) || !sk.layers.length) return null;
            var ref = (D.sel && D.sel.ref) | 0, lay = (D.sel && D.sel.lay) | 0;
            if (ref === lay) return { m: 0, popis: 'stejná vrstva jako reference', skladba: sk.name, refN: (sk.layers[ref] || {}).n, layN: (sk.layers[lay] || {}).n };
            var lo = Math.min(ref, lay), hi = Math.max(ref, lay);
            var cm = 0, kusy = [];
            for (var i = lo; i < hi; i++) {
                var L = sk.layers[i]; if (!L) continue;
                cm += Number(L.t) || 0;
                kusy.push((L.n || '?') + ' ' + (Number(L.t) || 0) + ' cm');
            }
            // pokládaná vrstva je NÍŽ než reference => její horní líc je pod referencí
            var znam = (lay > ref) ? -1 : 1;
            var LL = sk.layers[lay] || {};
            var nadv = ((Number(LL.t) || 0) * (Number(LL.p) || 0)) / 100;
            return {
                m: znam * (cm / 100) + (nadv / 100),
                popis: kusy.join(' + ') + (nadv ? (' · nadvýšení na hutnění +' + fmt(nadv, 1) + ' cm') : ''),
                skladba: sk.name, refN: (sk.layers[ref] || {}).n, layN: LL.n
            };
        } catch (e) { return null; }
    }

    // ---- ZMĚŘENÁ VÝŠKA -------------------------------------------------------
    // Z telefonu jen jako hrubá orientace. gpsAvgResult.alt je průměr z průměrování,
    // altSterr jeho střední chyba; když průměrování neběželo, bereme poslední fix.
    function phoneAlt() {
        try {
            if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && gpsAvgResult.alt != null && isFinite(gpsAvgResult.alt)) {
                return { z: gpsAvgResult.alt, sig: gpsAvgResult.altSterr, n: gpsAvgResult.altN, src: 'průměr GPS' };
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:phoneAlt'); }
        try {
            if (typeof userAlt !== 'undefined' && userAlt != null && isFinite(userAlt)) return { z: userAlt, sig: null, n: 1, src: 'poslední fix GPS' };
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:phoneAlt'); }
        return null;
    }
    function here() {
        try {
            if (typeof userLat !== 'undefined' && userLat != null) return { lat: userLat, lng: userLng, acc: (typeof currentGpsAccuracy !== 'undefined' ? currentGpsAccuracy : null) };
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:here'); }
        return null;
    }

    // ---- styly ---------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + MODAL_ID + ' .kv-res{margin:2px 0 12px;padding:16px 14px;border-radius:var(--r-md,12px);text-align:center;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.15));background:rgba(255,255,255,0.04);}',
            '#' + MODAL_ID + ' .kv-d{font:800 44px/1 var(--font-mono,ui-monospace),monospace;letter-spacing:-1px;}',
            '#' + MODAL_ID + ' .kv-w{font:700 15px/1.3 var(--font-ui,system-ui),sans-serif;margin-top:6px;}',
            '#' + MODAL_ID + ' .kv-sub{font-size:12px;opacity:.7;margin-top:7px;line-height:1.45;}',
            '#' + MODAL_ID + ' .kv-ok{border-color:rgba(52,211,153,0.65);background:rgba(52,211,153,0.10);}',
            '#' + MODAL_ID + ' .kv-ok .kv-d,#' + MODAL_ID + ' .kv-ok .kv-w{color:#34d399;}',
            '#' + MODAL_ID + ' .kv-warn{border-color:rgba(251,191,36,0.65);background:rgba(251,191,36,0.10);}',
            '#' + MODAL_ID + ' .kv-warn .kv-d,#' + MODAL_ID + ' .kv-warn .kv-w{color:#fbbf24;}',
            '#' + MODAL_ID + ' .kv-bad{border-color:rgba(239,68,68,0.7);background:rgba(239,68,68,0.12);}',
            '#' + MODAL_ID + ' .kv-bad .kv-d,#' + MODAL_ID + ' .kv-bad .kv-w{color:#fb7185;}',
            '#' + MODAL_ID + ' .kv-row{display:flex;gap:8px;align-items:flex-end;margin-bottom:10px;}',
            '#' + MODAL_ID + ' .kv-row>label{flex:1;min-width:0;margin:0;}',
            '#' + MODAL_ID + ' .kv-seg{display:flex;gap:6px;margin:4px 0 12px;}',
            '#' + MODAL_ID + ' .kv-seg button{flex:1;padding:9px 6px;border-radius:var(--r-sm,8px);min-height:44px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.15));background:rgba(255,255,255,0.05);',
            '  color:var(--text-color,#e8edf2);font:600 13px/1.2 var(--font-ui,system-ui),sans-serif;cursor:pointer;}',
            '#' + MODAL_ID + ' .kv-seg button.on{border-color:var(--accent,#34d399);background:rgba(52,211,153,0.16);color:var(--accent-bright,#6ee7b7);}',
            '#' + MODAL_ID + ' .kv-note{font-size:12px;opacity:.72;line-height:1.5;margin:-4px 0 12px;}',
            '#' + MODAL_ID + ' .kv-danger{color:var(--warning,#fbbf24);opacity:1;}',
            '#' + MODAL_ID + ' .kv-log{max-height:210px;overflow:auto;-webkit-overflow-scrolling:touch;margin-top:6px;}',
            '#' + MODAL_ID + ' .kv-li{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:8px;',
            '  background:rgba(255,255,255,0.04);margin-bottom:5px;font-size:12.5px;align-items:center;}',
            '#' + MODAL_ID + ' .kv-li b{font-family:var(--font-mono,ui-monospace),monospace;}',
            '#' + MODAL_ID + ' .kv-li .kv-x{flex:0 0 auto;border:0;background:rgba(255,255,255,0.12);color:inherit;',
            '  width:26px;height:26px;min-height:26px;border-radius:50%;cursor:pointer;font-size:14px;line-height:26px;padding:0;}',
            '#' + MODAL_ID + ' h4{margin:16px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;opacity:.6;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- modal ---------------------------------------------------------------
    var _cfg = null, _plane = null, _lastCalc = null;

    function ensureModal() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = MODAL_ID;
        m.setAttribute('data-no-swipe', '');   // rozepsané měření nesmí shodit cuknutí prstem
        m.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">Kontrola vrstvy</h3>'
            + '<div class="modal-body" id="agkv-body"></div>'
            + '<div class="row-buttons">'
            + '<button class="btn btn-secondary" id="agkv-close">Zpět</button>'
            + '<button class="btn btn-primary" id="agkv-save">Zapsat do protokolu</button>'
            + '</div></div>';
        document.body.appendChild(m);
        m.querySelector('#agkv-close').addEventListener('click', close);
        m.querySelector('#agkv-save').addEventListener('click', saveMeasurement);
        return m;
    }

    function close() {
        var m = document.getElementById(MODAL_ID);
        if (m) m.style.display = 'none';
        try { if (typeof fixAppLayout === 'function') fixAppLayout(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:close'); }
    }

    // Přepočet a vykreslení velkého výsledku. Volá se při každé změně vstupu.
    function recalc() {
        var body = document.getElementById('agkv-body');
        if (!body) return;
        var zMer = num('agkv-zmer');
        var anten = num('agkv-anten'); if (!isFinite(anten)) anten = 0;
        var tol = num('agkv-tol'); if (!isFinite(tol) || tol <= 0) tol = 2;

        // 1) projektová výška
        var zProj = null, projPozn = '', posErrCm = null;
        if (_cfg.mode === 'kota') {
            zProj = num('agkv-kota');
            projPozn = 'pevná kóta';
        } else {
            var pos = here();
            if (_plane && pos) {
                zProj = planeZ(_plane, pos.lat, pos.lng);
                projPozn = 'rovina z ' + _plane.n + ' bodů, spád ' + fmt(_plane.slopePct, 2) + ' %';
                // KLÍČOVÉ UPOZORNĚNÍ: chyba polohy z telefonu se přes sklon promítne do výšky
                if (pos.acc != null) posErrCm = pos.acc * (_plane.slopePct / 100) * 100;
            }
        }

        // 2) odsazení vrstvy ze skladby
        var off = 0, offPopis = '';
        if (_cfg.useVrstvy) {
            var vo = vrstvyOffset();
            if (vo) { off = vo.m; offPopis = 'Odsazení ze skladby „' + vo.skladba + '": ' + fmt(off * 100, 1) + ' cm (' + vo.popis + ')'; }
        } else if (isFinite(num('agkv-off'))) {
            off = num('agkv-off') / 100;
            offPopis = 'Ruční odsazení ' + fmt(off * 100, 1) + ' cm';
        }

        var resBox = document.getElementById('agkv-res');
        if (!resBox) return;
        if (!isFinite(zMer) || zProj == null || !isFinite(zProj)) {
            _lastCalc = null;
            resBox.className = 'kv-res';
            resBox.innerHTML = '<div class="kv-d">—</div><div class="kv-w">Doplň změřenou a projektovou výšku</div>';
            return;
        }
        var zPovrch = zMer - anten;             // odečti výšku výtyčky/antény nad povrchem
        var zCil = zProj + off;                 // kam má sahat právě pokládaná vrstva
        var d = zPovrch - zCil;                 // + = moc vysoko, − = moc nízko
        var dCm = d * 100;
        var cls = (Math.abs(dCm) <= tol) ? 'kv-ok' : (Math.abs(dCm) <= 2 * tol ? 'kv-warn' : 'kv-bad');
        var slovo = (Math.abs(dCm) <= tol) ? 'V TOLERANCI'
            : (dCm > 0 ? 'UBRAT ' + fmt(Math.abs(dCm), 1) + ' cm' : 'PŘIDAT ' + fmt(Math.abs(dCm), 1) + ' cm');
        var sub = 'povrch ' + fmt(zPovrch, 3) + ' m &middot; cíl ' + fmt(zCil, 3) + ' m &middot; tolerance ±' + fmt(tol, 1) + ' cm'
            + '<br>projekt: ' + esc(projPozn)
            + (offPopis ? '<br>' + esc(offPopis) : '');
        if (posErrCm != null && posErrCm > 0.3) {
            sub += '<br><span class="kv-danger">Pozor: poloha z telefonu ±' + fmt(here().acc, 1) + ' m se přes spád promítne do projektové výšky jako ±'
                + fmt(posErrCm, 1) + ' cm. Na přesnou kontrolu použij režim „Pevná kóta".</span>';
        }
        resBox.className = 'kv-res ' + cls;
        resBox.innerHTML = '<div class="kv-d">' + (dCm > 0 ? '+' : '') + fmt(dCm, 1) + ' cm</div>'
            + '<div class="kv-w">' + esc(slovo) + '</div><div class="kv-sub">' + sub + '</div>';
        _lastCalc = { zMer: zMer, anten: anten, zPovrch: zPovrch, zProj: zProj, off: off, zCil: zCil, d: d, tol: tol, mode: _cfg.mode, projPozn: projPozn };
    }

    function saveMeasurement() {
        if (!_lastCalc) { info('Nejdřív doplň změřenou a projektovou výšku.'); return; }
        var pos = here();
        var jt = pos ? toJTSK(pos.lat, pos.lng) : null;
        var rec = {
            t: Date.now(),
            nazev: (document.getElementById('agkv-nazev') || {}).value || '',
            lat: pos ? pos.lat : null, lng: pos ? pos.lng : null,
            y: jt ? +jt.y.toFixed(2) : null, x: jt ? +jt.x.toFixed(2) : null,
            acc: pos ? pos.acc : null,
            zMer: +_lastCalc.zPovrch.toFixed(3),
            zCil: +_lastCalc.zCil.toFixed(3),
            d: +(_lastCalc.d * 100).toFixed(1),
            tol: _lastCalc.tol,
            rezim: _lastCalc.mode
        };
        var list = loadLog();
        list.push(rec);
        saveLog(list);
        toast('Zapsáno do protokolu (' + list.length + ' měření).');
        // Připrav na další bod: výška se vymaže a číslo měření se zvýší, aby šlo
        // jet sérii bez ťukání. POZOR na pořadí — render() staví obsah modalu znovu
        // z HTML, takže hodnotu do pole musíme vrátit AŽ POTOM (dřív se ztratila).
        var nn = document.getElementById('agkv-nazev');
        var nextName = (nn && /\d+$/.test(nn.value))
            ? nn.value.replace(/(\d+)$/, function (s) { return String(Number(s) + 1); })
            : (nn ? nn.value : '');
        _lastCalc = null;
        render();
        var nn2 = document.getElementById('agkv-nazev');
        if (nn2) nn2.value = nextName;
        var nz = document.getElementById('agkv-zmer');
        try { if (nz) nz.focus(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:saveMeasurement'); }
    }

    function delRec(i) {
        var list = loadLog();
        list.splice(i, 1);
        saveLog(list);
        render();
    }

    // CSV pro protokol do kanceláře. Oddělovač ';' a desetinná ČÁRKA — tak to
    // otevře český Excel bez průvodce importem.
    function exportCsv() {
        var list = loadLog();
        if (!list.length) { info('Protokol je zatím prázdný.'); return; }
        var rows = [['cislo', 'datum', 'cas', 'Y', 'X', 'Z_merene', 'Z_cilove', 'odchylka_cm', 'tolerance_cm', 'presnost_polohy_m'].join(';')];
        list.forEach(function (r, i) {
            var dt = new Date(r.t);
            rows.push([
                (r.nazev || ('m' + (i + 1))),
                dt.toLocaleDateString('cs-CZ'),
                dt.toLocaleTimeString('cs-CZ'),
                r.y != null ? fmt(r.y, 2) : '',
                r.x != null ? fmt(r.x, 2) : '',
                fmt(r.zMer, 3), fmt(r.zCil, 3), fmt(r.d, 1), fmt(r.tol, 1),
                r.acc != null ? fmt(r.acc, 1) : ''
            ].join(';'));
        });
        // BOM, jinak Excel rozhodí diakritiku
        var blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'kontrola-vrstvy-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a); a.click();
        setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kontrola-vrstvy:exportCsv'); } }, 1000);
    }

    function render() {
        var body = document.getElementById('agkv-body');
        if (!body) return;
        var cands = pointsWithZ();
        var log = loadLog();
        var vo = _cfg.useVrstvy ? vrstvyOffset() : null;

        var h = '';
        h += '<div class="kv-res" id="agkv-res"><div class="kv-d">—</div><div class="kv-w">Doplň změřenou a projektovou výšku</div></div>';

        h += '<label>Změřená výška Z z roveru (Bpv, m):</label>'
            + '<input type="text" inputmode="decimal" autocomplete="off" id="agkv-zmer" placeholder="Např. 312,455">'
            + '<div class="kv-note">Opiš Z z roveru nebo niveláku. Telefon sám výšku na centimetry neumí — '
            + 'GPS výška z mobilu je ±1,5 až 4 m.'
            + (phoneAlt() ? ' <a href="#" id="agkv-fromgps">Přesto vzít z telefonu</a> (jen hrubá orientace).' : '')
            + '</div>';

        h += '<label>Výška antény / výtyčky nad povrchem (m):</label>'
            + '<input type="text" inputmode="decimal" autocomplete="off" id="agkv-anten" placeholder="Např. 2,000" value="' + (_cfg.anten ? esc(String(_cfg.anten).replace('.', ',')) : '') + '">'
            + '<div class="kv-note">Odečte se od změřené výšky. Nech prázdné, když už Z z roveru sedí na povrchu.</div>';

        h += '<h4>Projektová výška</h4>';
        h += '<div class="kv-seg" id="agkv-mode">'
            + '<button type="button" data-m="kota" class="' + (_cfg.mode === 'kota' ? 'on' : '') + '">Pevná kóta</button>'
            + '<button type="button" data-m="rovina" class="' + (_cfg.mode === 'rovina' ? 'on' : '') + '">Rovina z bodů</button>'
            + '</div>';

        if (_cfg.mode === 'kota') {
            h += '<input type="text" inputmode="decimal" autocomplete="off" id="agkv-kota" placeholder="Projektová výška v tomto místě (m)" value="' + (_cfg.kota != null ? esc(String(_cfg.kota).replace('.', ',')) : '') + '">'
                + '<div class="kv-note">Nejpřesnější varianta: nepotřebuje polohu, takže se do výsledku nepromítne chyba GPS telefonu.</div>';
        } else {
            if (cands.length < 3) {
                h += '<div class="kv-note kv-danger">V zakázce jsou jen ' + cands.length + ' body s výškou. Rovina potřebuje aspoň 3 — '
                    + 'ulož si vytyčovací body i s Z, nebo použij „Pevná kóta".</div>';
                _plane = null;
            } else {
                _plane = fitPlane(cands);
                if (!_plane) {
                    h += '<div class="kv-note kv-danger">Rovinu se z těch bodů nepodařilo proložit (leží v přímce?). Použij „Pevná kóta".</div>';
                } else {
                    h += '<div class="kv-note">Rovina proložená <b>' + _plane.n + '</b> body zakázky (MNČ). '
                        + 'Spád <b>' + fmt(_plane.slopePct, 2) + ' %</b>, body od roviny do <b>' + fmt(Math.abs(_plane.maxDev) * 100, 1) + ' cm</b> '
                        + '(RMS ' + fmt(_plane.rms * 100, 1) + ' cm).'
                        + (Math.abs(_plane.maxDev) > 0.05 ? ' <span class="kv-danger">Body v rovině neleží — zkontroluj, jestli patří do jedné plochy.</span>' : '')
                        + '</div>';
                }
            }
        }

        h += '<h4>Vrstva</h4>';
        h += '<label style="display:flex;align-items:center;gap:9px;margin:0 0 8px;"><input type="checkbox" id="agkv-usevr" style="width:auto;margin:0;"' + (_cfg.useVrstvy ? ' checked' : '') + '> Odsazení brát ze skladby (Vrstvy)</label>';
        if (_cfg.useVrstvy) {
            if (vo) {
                h += '<div class="kv-note">Skladba <b>' + esc(vo.skladba) + '</b>: reference <b>' + esc(vo.refN || '?') + '</b>, pokládám <b>' + esc(vo.layN || '?') + '</b>.'
                    + '<br>Odsazení <b>' + fmt(vo.m * 100, 1) + ' cm</b> — ' + esc(vo.popis) + '.</div>';
            } else {
                h += '<div class="kv-note kv-danger">Skladba zatím není nastavená. Otevři nástroj <b>Vrstvy</b> a vyber, které vrstvě odpovídá model a kterou pokládáš.</div>';
            }
        } else {
            h += '<input type="text" inputmode="decimal" autocomplete="off" id="agkv-off" placeholder="Ruční odsazení (cm, − = níž)" value="' + (_cfg.manualOffset != null ? esc(String(_cfg.manualOffset).replace('.', ',')) : '') + '">';
        }

        h += '<div class="kv-row"><label style="flex:1;">Tolerance (± cm):'
            + '<input type="text" inputmode="decimal" autocomplete="off" id="agkv-tol" value="' + esc(String(_cfg.tol).replace('.', ',')) + '"></label>'
            + '<label style="flex:1;">Označení měření:<input type="text" autocomplete="off" id="agkv-nazev" placeholder="km 1,250 vlevo"></label></div>';

        h += '<h4>Protokol (' + log.length + ')</h4>';
        if (!log.length) {
            h += '<div class="kv-note">Zatím prázdný. Každé „Zapsat do protokolu" sem přidá řádek i se souřadnicemi.</div>';
        } else {
            h += '<div class="kv-log">';
            for (var i = log.length - 1; i >= 0; i--) {
                var r = log[i];
                var col = Math.abs(r.d) <= r.tol ? '#34d399' : (Math.abs(r.d) <= 2 * r.tol ? '#fbbf24' : '#fb7185');
                h += '<div class="kv-li"><span>' + esc(r.nazev || ('m' + (i + 1)))
                    + ' <span style="opacity:.55;">' + new Date(r.t).toLocaleTimeString('cs-CZ').slice(0, 5) + '</span></span>'
                    + '<span><b style="color:' + col + ';">' + (r.d > 0 ? '+' : '') + fmt(r.d, 1) + ' cm</b>'
                    + ' <button type="button" class="kv-x" data-i="' + i + '" aria-label="Smazat řádek">×</button></span></div>';
            }
            h += '</div>';
            h += '<button class="btn btn-secondary" style="margin-top:10px;" id="agkv-csv">Export protokolu do CSV</button>';
        }

        body.innerHTML = h;

        // ---- posluchače ----
        var mode = document.getElementById('agkv-mode');
        if (mode) mode.addEventListener('click', function (ev) {
            var b = ev.target.closest('button[data-m]');
            if (!b) return;
            _cfg.mode = b.dataset.m; saveCfg(_cfg); render();
        });
        ['agkv-zmer', 'agkv-anten', 'agkv-kota', 'agkv-tol', 'agkv-off'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('input', function () {
                if (id === 'agkv-anten') { _cfg.anten = num(el); saveCfg(_cfg); }
                if (id === 'agkv-kota') { _cfg.kota = num(el); saveCfg(_cfg); }
                if (id === 'agkv-tol') { _cfg.tol = num(el); saveCfg(_cfg); }
                if (id === 'agkv-off') { _cfg.manualOffset = num(el); saveCfg(_cfg); }
                recalc();
            });
        });
        var uv = document.getElementById('agkv-usevr');
        if (uv) uv.addEventListener('change', function () { _cfg.useVrstvy = uv.checked; saveCfg(_cfg); render(); });
        var fg = document.getElementById('agkv-fromgps');
        if (fg) fg.addEventListener('click', function (ev) {
            ev.preventDefault();
            var a = phoneAlt();
            if (!a) { info('Telefon zatím nehlásí výšku.'); return; }
            var el = document.getElementById('agkv-zmer');
            el.value = a.z.toFixed(3).replace('.', ',');
            recalc();
            toast('Výška z telefonu (' + a.src + ')' + (a.sig != null ? ', ± ' + fmt(a.sig, 2) + ' m' : '') + ' — na kontrolu vrstvy je to hrubé.');
        });
        var csv = document.getElementById('agkv-csv');
        if (csv) csv.addEventListener('click', exportCsv);
        var lg = document.querySelector('#' + MODAL_ID + ' .kv-log');
        if (lg) lg.addEventListener('click', function (ev) {
            var b = ev.target.closest('.kv-x');
            if (b) delRec(Number(b.dataset.i));
        });
        recalc();
    }

    function open() {
        _cfg = loadCfg();
        var m = ensureModal();
        m.style.display = 'flex';
        render();
    }

    window.AGKontrolaVrstvy = { open: open, fitPlane: fitPlane, vrstvyOffset: vrstvyOffset };
    window.agOpenKontrolaVrstvy = open;

    // ---- dlaždice v Nástrojích ----------------------------------------------
    function registerTile() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({
                id: 'kontrola-vrstvy',
                label: 'Kontrola vrstvy',
                icon: '<svg class="icon"><use href="#i-layers"/></svg>',
                onClick: open,
                cat: 'Vytyčování a náčrt',
                order: 15
            });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerTile);
    else registerTile();
    window.addEventListener('load', function () { setTimeout(registerTile, 400); });
})();
