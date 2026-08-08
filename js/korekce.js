// ===== AR Geodet — ATMOSFÉRICKÉ KOREKCE MĚŘENÍ (ODPOJITELNÁ vrstva) =============
// Teploměr a barometr jako každodenní věc — ale zapojené do výpočtů, které geodet
// stejně musí udělat. Vše OFFLINE, meteo hodnoty se PŘEDVYPLNÍ z poslední cache
// nástroje Počasí (agWeatherCache_v1) a jdou ručně přepsat:
//
//   1) PÁSMO — oprava délky měřené ocelovým pásmem: teplotní roztažnost,
//      komparační oprava pásma, průvěs (volitelně) a převod šikmé délky na
//      vodorovnou. Výsledek i rozpis jednotlivých oprav v mm.
//   2) DÁLKOMĚR (ppm) — atmosférická oprava EDM z teploty, tlaku a vlhkosti
//      (grupová refraktivita podle Barrella–Searse / IUGG). Ukáže ppm, které se
//      zadává do totálky, a kolik to dělá mm na 100 m a na 1 km.
//   3) REFRAKCE + ZAKŘIVENÍ — oprava trigonometricky určeného převýšení
//      (1−k)·d²/2R, se zadatelným refrakčním koeficientem.
//
// Tlak: appka má z Počasí tlak přepočtený na hladinu moře, dálkoměr ale potřebuje
// tlak V MÍSTĚ. Přepočet zpět se dělá z nadmořské výšky GPS (userAlt) inverzí
// téhož vzorce jako v js/pocasi.js — a je zvlášť vypsaný, ať je vidět, s čím se
// počítá. Kdo má na přístroji barometr, přepíše hodnotu ručně.
//
// Neinvazivní: NEEDITUJE logika.js/grafika.js. Vstup: dlaždice „Korekce měření"
// v Nástrojích (Měření). API: window.agOpenKorekce().
// Odstranění: smaž js/korekce.js + řádek <script> v index.html a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.__agKorekceInit) return;
    window.__agKorekceInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5h4v10.2a4 4 0 1 1-4 0z"/><path d="M12 17.5v.01"/><path d="M16.5 6.5H20M16.5 10H19M16.5 13.5H20"/></svg>';
    var STYLE_ID = 'ag-ko-style';
    var LS = 'agKorekce_v1';   // uložené vstupy (ať se nezadávají pořád znovu)

    var MATERIALS = [
        { id: 'ocel', label: 'Ocelové pásmo', a: 11.5e-6 },
        { id: 'invar', label: 'Invar', a: 1.0e-6 },
        { id: 'sklolaminat', label: 'Sklolaminát / plast', a: 25e-6 },
        { id: 'alu', label: 'Hliník (lať)', a: 23e-6 }
    ];
    var LAMBDAS = [
        { id: '0.850', label: 'IR 850 nm (běžná totálka)', v: 0.850 },
        { id: '0.658', label: 'Červený laser 658 nm', v: 0.658 },
        { id: '0.780', label: '780 nm', v: 0.780 },
        { id: '0.900', label: '900 nm', v: 0.900 }
    ];

    var _tab = 'pasmo';

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
    function st() { try { var o = JSON.parse(localStorage.getItem(LS)); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    function setSt(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {} }
    function put(k, v) { var o = st(); o[k] = v; setSt(o); }

    // ---- meteo z cache počasí -----------------------------------------------------------
    function gpsAlt() {
        try { if (typeof userAlt === 'number' && isFinite(userAlt)) return userAlt; } catch (e) {}
        return null;
    }
    function meteo() {
        var out = { t: null, rh: null, pmsl: null, pLoc: null, age: null, alt: gpsAlt(), src: null };
        try {
            var c = JSON.parse(localStorage.getItem('agWeatherCache_v1'));
            if (!c || !c.data || !c.data.current) return out;
            var cur = c.data.current;
            out.age = Math.round((Date.now() - c.t) / 60000);
            out.t = cur.temp;
            out.rh = cur.hum;
            out.pmsl = cur.pmsl;
            out.src = c.placeName || null;
            // zpětný přepočet tlaku na místo (inverze toMsl z js/pocasi.js)
            if (out.pmsl != null && out.alt != null && out.alt >= 1) {
                var T = (out.t == null) ? 15 : out.t;
                out.pLoc = out.pmsl * Math.pow(1 - (0.0065 * out.alt) / (T + 0.0065 * out.alt + 273.15), 5.257);
            } else if (out.pmsl != null) out.pLoc = out.pmsl;
        } catch (e) {}
        return out;
    }

    // ---- fyzika ---------------------------------------------------------------------------
    // nasycený tlak vodní páry (Magnus), hPa
    function esat(t) { return 6.112 * Math.exp(17.62 * t / (243.12 + t)); }
    // grupová refraktivita standardního vzduchu (Barrell–Sears / IUGG 1963), λ v µm
    function Ngroup(lam) { return 287.6155 + 4.88660 / (lam * lam) + 0.06800 / Math.pow(lam, 4); }
    // refraktivita N = (n−1)·1e6 pro dané podmínky
    function refractivity(t, p, rh, lam) {
        var Ng = Ngroup(lam);
        var Tk = 273.15 + t;
        var e = (rh == null ? 0 : (rh / 100) * esat(t));
        return (273.15 / 1013.25) * (Ng * p / Tk) - 11.27 * e / Tk;
    }

    // ---- výpočty jednotlivých sekcí -------------------------------------------------------
    function calcPasmo(v) {
        var l = v.l, res = { rows: [], total: null };
        if (l == null || l <= 0) return res;
        var mat = MATERIALS.filter(function (m) { return m.id === v.mat; })[0] || MATERIALS[0];
        var out = l, sum = 0;

        // teplotní
        if (v.t != null && v.t0 != null) {
            var dt = mat.a * (v.t - v.t0) * l;
            res.rows.push({ n: 'Teplota (' + v.t.toFixed(1) + ' °C proti ' + v.t0.toFixed(1) + ' °C, α = ' + (mat.a * 1e6).toFixed(1) + '·10⁻⁶)', v: dt });
            sum += dt;
        }
        // komparační oprava pásma: Δl0 na etalonové délce l0
        if (v.dl0 != null && v.l0 != null && v.l0 > 0) {
            var dk = (v.dl0 / 1000) * (l / v.l0);
            res.rows.push({ n: 'Komparace pásma (' + v.dl0.toFixed(1) + ' mm na ' + v.l0 + ' m)', v: dk });
            sum += dk;
        }
        // průvěs: −q²·l³/(24·F²) (q v N/m, F v N)
        if (v.q != null && v.F != null && v.F > 0) {
            var ds = -(v.q * v.q * Math.pow(l, 3)) / (24 * v.F * v.F);
            res.rows.push({ n: 'Průvěs (' + v.q.toFixed(2) + ' N/m při napětí ' + v.F.toFixed(0) + ' N)', v: ds });
            sum += ds;
        }
        out = l + sum;
        // šikmá → vodorovná: −h²/(2·l)
        var horiz = out, dh = null;
        if (v.h != null && v.h !== 0) {
            dh = -(v.h * v.h) / (2 * out);
            res.rows.push({ n: 'Převod na vodorovnou (převýšení ' + v.h.toFixed(2) + ' m)', v: dh });
            horiz = out + dh;
        }
        res.total = horiz;
        res.sum = horiz - l;
        return res;
    }
    function calcEdm(v) {
        if (v.t == null || v.p == null) return null;
        var lam = (LAMBDAS.filter(function (x) { return x.id === v.lam; })[0] || LAMBDAS[0]).v;
        var Nact = refractivity(v.t, v.p, v.rh, lam);
        var Nref = refractivity(v.tRef != null ? v.tRef : 12, v.pRef != null ? v.pRef : 1013.25, v.rhRef != null ? v.rhRef : 60, lam);
        return { Nact: Nact, Nref: Nref, ppm: Nref - Nact, lam: lam };
    }
    function calcRefr(v) {
        if (v.d == null || v.d <= 0) return null;
        var k = (v.k == null ? 0.13 : v.k);
        var R = 6379000;
        var corr = (1 - k) * v.d * v.d / (2 * R);
        return { corr: corr, k: k, curv: v.d * v.d / (2 * R), refr: -k * v.d * v.d / (2 * R) };
    }

    // ---- UI -------------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent =
            '#ag-ko-modal .ag-ko-tabs{display:flex;gap:6px;margin:8px 0 12px;flex-wrap:wrap;}' +
            '#ag-ko-modal .ag-ko-tabs button{flex:1 1 90px;padding:8px 6px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.15));background:var(--bg-input,rgba(255,255,255,.06));color:inherit;font-size:.86em;}' +
            '#ag-ko-modal .ag-ko-tabs button.on{background:var(--accent,#60a5fa);color:#04121f;border-color:transparent;font-weight:600;}' +
            '#ag-ko-modal .ag-ko-met{background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.35);border-radius:10px;padding:8px 11px;margin:0 0 12px;font-size:.86em;line-height:1.5;}' +
            '#ag-ko-modal .ag-ko-f{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;}' +
            '#ag-ko-modal .ag-ko-f label{flex:1 1 150px;font-size:.88em;}' +
            '#ag-ko-modal .ag-ko-f input,#ag-ko-modal .ag-ko-f select{width:100%;background:var(--bg-input,rgba(255,255,255,.08));color:inherit;border:1px solid var(--border,rgba(255,255,255,.15));border-radius:8px;padding:7px 8px;margin-top:2px;}' +
            '#ag-ko-modal .ag-ko-out{background:var(--bg-input,rgba(255,255,255,.06));border-radius:10px;padding:10px 12px;margin:10px 0 0;}' +
            '#ag-ko-modal .ag-ko-out .big{font-size:1.35em;font-weight:600;font-variant-numeric:tabular-nums;}' +
            '#ag-ko-modal .ag-ko-out .r{display:flex;justify-content:space-between;gap:10px;font-size:.87em;padding:3px 0;border-top:1px solid rgba(255,255,255,.07);}' +
            '#ag-ko-modal .ag-ko-out .r span:last-child{font-variant-numeric:tabular-nums;white-space:nowrap;}' +
            '#ag-ko-modal details{margin:6px 0;font-size:.88em;} #ag-ko-modal summary{cursor:pointer;color:var(--text-muted,#9aa1ac);}' +
            '#ag-ko-modal .ag-ko-note{color:var(--text-muted,#9aa1ac);font-size:.82em;line-height:1.45;margin-top:10px;}' +
            // Formulář musí scrollovat SÁM: .modal-content má v css/style.css
            // overflow:hidden, takže na záložce Pásmo (delší formulář + rozpis oprav)
            // konec výsledku zůstal pod okrajem okna (vzor brifink.js / denik-dne.js).
            '#ag-ko-modal .modal-content{display:flex;flex-direction:column;}' +
            '#ag-ko-modal h3,#ag-ko-modal .ag-ko-tabs,#ag-ko-modal #ag-ko-met{flex:none;}' +
            '#ag-ko-modal #ag-ko-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;padding-right:6px;}' +
            // Patička: .btn má width:100% + margin-top:10px — sjednotíme s ostatními okny.
            '#ag-ko-modal .ag-ko-foot{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;flex:none;}' +
            '#ag-ko-modal .ag-ko-foot .btn{flex:1 1 0;min-width:96px;margin:0;min-height:44px;}' +
            'body.ag-glove #ag-ko-modal .ag-ko-foot .btn{min-height:52px;}';
        document.head.appendChild(s);
    }
    function ensureModal() {
        var m = document.getElementById('ag-ko-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'ag-ko-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Korekce měření</h3>' +
            '  <div class="ag-ko-tabs" id="ag-ko-tabs">' +
            '    <button type="button" data-t="pasmo">Pásmo</button>' +
            '    <button type="button" data-t="edm">Dálkoměr ppm</button>' +
            '    <button type="button" data-t="refr">Refrakce</button>' +
            '  </div>' +
            '  <div id="ag-ko-met"></div>' +
            '  <div id="ag-ko-body"></div>' +
            '  <div class="ag-ko-foot">' +
            '    <button type="button" class="btn btn-secondary" id="ag-ko-close">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-ko-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-ko-tabs').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-t]') : null;
            if (!b) return;
            _tab = b.getAttribute('data-t');
            render();
        });
        var body = m.querySelector('#ag-ko-body');
        body.addEventListener('input', onInput);
        body.addEventListener('change', onInput);
        return m;
    }
    function onInput(e) {
        var el = e.target;
        if (!el || !el.id || el.id.indexOf('ag-ko-i-') !== 0) return;
        var key = el.id.slice(8);
        put(key, el.type === 'number' ? num(el.value) : el.value);
        renderOut();
    }

    function inputs() {
        var o = st(), mt = meteo();
        return {
            // pásmo
            l: o.l != null ? o.l : null,
            mat: o.mat || 'ocel',
            t: o.t != null ? o.t : (mt.t != null ? Math.round(mt.t * 10) / 10 : null),
            t0: o.t0 != null ? o.t0 : 20,
            l0: o.l0 != null ? o.l0 : 50,
            dl0: o.dl0 != null ? o.dl0 : null,
            q: o.q != null ? o.q : null,
            F: o.F != null ? o.F : null,
            h: o.h != null ? o.h : null,
            // edm
            p: o.p != null ? o.p : (mt.pLoc != null ? Math.round(mt.pLoc * 10) / 10 : null),
            rh: o.rh != null ? o.rh : (mt.rh != null ? Math.round(mt.rh) : null),
            lam: o.lam || '0.850',
            tRef: o.tRef != null ? o.tRef : 12,
            pRef: o.pRef != null ? o.pRef : 1013.25,
            rhRef: o.rhRef != null ? o.rhRef : 60,
            // refrakce
            d: o.d != null ? o.d : null,
            k: o.k != null ? o.k : 0.13,
            _meteo: mt
        };
    }
    function fld(id, label, val, step, extra) {
        return '<label>' + esc(label) + '<input type="text" inputmode="decimal" id="ag-ko-i-' + id + '" step="' + (step || 'any') + '" value="' + (val != null ? val : '') + '"' + (extra || '') + '></label>';
    }
    function sel(id, label, list, val) {
        return '<label>' + esc(label) + '<select id="ag-ko-i-' + id + '">' +
            list.map(function (x) { return '<option value="' + x.id + '"' + (x.id === val ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') +
            '</select></label>';
    }

    function render() {
        var m = document.getElementById('ag-ko-modal');
        if (!m) return;
        var tabs = m.querySelectorAll('#ag-ko-tabs button');
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-t') === _tab);

        var v = inputs(), mt = v._meteo;
        // meteo hlavička
        var mel = document.getElementById('ag-ko-met');
        if (mt.t != null) {
            mel.innerHTML = '<div class="ag-ko-met">🌡 Z počasí' + (mt.src ? ' (' + esc(mt.src) + ')' : '') + ' před ' + mt.age + ' min: ' +
                mt.t.toFixed(1) + ' °C' + (mt.rh != null ? ', vlhkost ' + Math.round(mt.rh) + ' %' : '') +
                (mt.pmsl != null ? ', tlak ' + mt.pmsl.toFixed(0) + ' hPa na hladině moře' : '') +
                (mt.pLoc != null && mt.alt != null ? ' → <b>' + mt.pLoc.toFixed(0) + ' hPa v místě</b> (výška z GPS ' + Math.round(mt.alt) + ' m)' : '') +
                '. Hodnoty níž můžeš přepsat — měřený teploměr a barometr mají vždy přednost.</div>';
        } else {
            mel.innerHTML = '<div class="ag-ko-met">Nemám stažené počasí, takže se nic nepředvyplní — otevři nástroj <b>Počasí</b>, nebo zadej teplotu a tlak ručně.</div>';
        }

        var body = document.getElementById('ag-ko-body');
        var h = '';
        if (_tab === 'pasmo') {
            h += '<div class="ag-ko-f">' + fld('l', 'Měřená délka (m)', v.l, '0.001') + sel('mat', 'Materiál', MATERIALS, v.mat) + '</div>' +
                '<div class="ag-ko-f">' + fld('t', 'Teplota při měření (°C)', v.t, '0.1') + fld('t0', 'Teplota komparace (°C)', v.t0, '0.1') + '</div>' +
                '<div class="ag-ko-f">' + fld('h', 'Převýšení mezi konci (m)', v.h, '0.01') + '</div>' +
                '<details><summary>Komparace a průvěs (nepovinné)</summary><div class="ag-ko-f">' +
                fld('dl0', 'Oprava pásma (mm)', v.dl0, '0.1') + fld('l0', 'na délce (m)', v.l0, '1') +
                '</div><div class="ag-ko-f">' +
                fld('q', 'Tíha pásma (N/m)', v.q, '0.01') + fld('F', 'Napínací síla (N)', v.F, '1') +
                '</div><div class="ag-ko-note" style="margin-top:0;">Tíha pásma: hmotnost v kg/m × 9,81. Průvěs se počítá jen pro pásmo napjaté ve vzduchu — pásmo položené na zemi má průvěs nulový.</div></details>' +
                '<div id="ag-ko-out"></div>';
        } else if (_tab === 'edm') {
            h += '<div class="ag-ko-f">' + fld('t', 'Teplota (°C)', v.t, '0.1') + fld('p', 'Tlak v místě (hPa)', v.p, '0.1') + '</div>' +
                '<div class="ag-ko-f">' + fld('rh', 'Vlhkost (%)', v.rh, '1') + sel('lam', 'Vlnová délka dálkoměru', LAMBDAS, v.lam) + '</div>' +
                '<details><summary>Referenční atmosféra přístroje (z manuálu)</summary><div class="ag-ko-f">' +
                fld('tRef', 'Teplota (°C)', v.tRef, '0.1') + fld('pRef', 'Tlak (hPa)', v.pRef, '0.1') + fld('rhRef', 'Vlhkost (%)', v.rhRef, '1') +
                '</div><div class="ag-ko-note" style="margin-top:0;">Většina totálek má nulovou korekci při 12 °C a 1013,25 hPa; Leica bývá 12 °C, Trimble/Topcon 15 °C. Zkontroluj v manuálu — jinak dostaneš ppm proti špatné nule.</div></details>' +
                '<div id="ag-ko-out"></div>';
        } else {
            h += '<div class="ag-ko-f">' + fld('d', 'Vodorovná vzdálenost (m)', v.d, '0.1') + fld('k', 'Refrakční koeficient k', v.k, '0.01') + '</div>' +
                '<div id="ag-ko-out"></div>';
        }
        body.innerHTML = h;
        renderOut();
    }

    function renderOut() {
        var el = document.getElementById('ag-ko-out');
        if (!el) return;
        var v = inputs();
        var h = '';
        if (_tab === 'pasmo') {
            var r = calcPasmo(v);
            if (r.total == null) { el.innerHTML = '<div class="ag-ko-note">Zadej měřenou délku.</div>'; return; }
            h = '<div class="ag-ko-out"><div class="big">' + r.total.toFixed(4) + ' m</div>' +
                '<div style="color:var(--text-muted,#9aa1ac);font-size:.86em;">vodorovná délka po opravách (celkem ' + (r.sum >= 0 ? '+' : '') + (r.sum * 1000).toFixed(1) + ' mm)</div>';
            r.rows.forEach(function (x) {
                h += '<div class="r"><span>' + esc(x.n) + '</span><span>' + (x.v >= 0 ? '+' : '') + (x.v * 1000).toFixed(1) + ' mm</span></div>';
            });
            h += '</div><div class="ag-ko-note">Teplota pásma není teplota vzduchu — pásmo na rozpáleném asfaltu má klidně o 15 °C víc, a to je na 50 m ' +
                (11.5e-6 * 15 * 50 * 1000).toFixed(1) + ' mm. Když je to důležité, změř teplotu u pásma.</div>';
        } else if (_tab === 'edm') {
            var e = calcEdm(v);
            if (!e) { el.innerHTML = '<div class="ag-ko-note">Zadej teplotu a tlak v místě.</div>'; return; }
            var sign = e.ppm >= 0 ? '+' : '';
            h = '<div class="ag-ko-out"><div class="big">' + sign + e.ppm.toFixed(1) + ' ppm</div>' +
                '<div style="color:var(--text-muted,#9aa1ac);font-size:.86em;">zadej do totálky jako atmosférickou korekci (scale)</div>' +
                '<div class="r"><span>Na 100 m to je</span><span>' + sign + (e.ppm * 0.1).toFixed(2) + ' mm</span></div>' +
                '<div class="r"><span>Na 1 km to je</span><span>' + sign + e.ppm.toFixed(1) + ' mm</span></div>' +
                '<div class="r"><span>Refraktivita nyní / referenční</span><span>' + e.Nact.toFixed(1) + ' / ' + e.Nref.toFixed(1) + '</span></div>' +
                '</div>' +
                '<div class="ag-ko-note">Výpočet je grupová refraktivita podle Barrella–Searse (IUGG 1963) pro λ = ' + e.lam + ' µm; vlhkost hraje u optických dálkoměrů roli řádu desetin ppm, u krátkých záměr ji můžeš ignorovat. ' +
                'Přesná hodnota závisí na přístroji — ber to jako kontrolu toho, co ukazuje totálka, ne jako nahrazení manuálu.</div>';
        } else {
            var f = calcRefr(v);
            if (!f) { el.innerHTML = '<div class="ag-ko-note">Zadej vzdálenost.</div>'; return; }
            h = '<div class="ag-ko-out"><div class="big">+' + (f.corr * 1000).toFixed(1) + ' mm</div>' +
                '<div style="color:var(--text-muted,#9aa1ac);font-size:.86em;">přičti k trigonometricky určenému převýšení na ' + v.d.toFixed(0) + ' m</div>' +
                '<div class="r"><span>Z toho zakřivení Země</span><span>+' + (f.curv * 1000).toFixed(1) + ' mm</span></div>' +
                '<div class="r"><span>Z toho refrakce (k = ' + f.k + ')</span><span>' + (f.refr * 1000).toFixed(1) + ' mm</span></div>' +
                '</div>' +
                '<div class="ag-ko-note">k = 0,13 je běžný denní průměr. Nad rozpálenou plochou nebo nízko nad zemí bývá refrakce úplně jiná (i negativní) — proto se převýšení měří obousměrně, čímž se refrakce z většiny vyruší. ' +
                'Do 100 m je celá oprava pod 1 mm, řešit ji začni od stovek metrů.</div>';
        }
        el.innerHTML = h;
    }

    function open() {
        var m = ensureModal();
        m.style.display = 'flex';
        render();
    }

    // ---- registrace dlaždice ------------------------------------------------------------------
    var _regTries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'korekce', label: 'Korekce měření', icon: ICON, cat: 'Měření', onClick: open, order: 10 });
            return;
        }
        if (_regTries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.agOpenKorekce = open;
})();
