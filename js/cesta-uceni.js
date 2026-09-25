/* CESTA UČENÍ (25. 9. 2026, 7. hodnocení f3) — jako Duolingo, s maskotem Toti.
 *
 * Proč: obsah na učení už v appce je (slovník pojmů, poznávačka bodů, předpisy, cvičné úlohy,
 * nástroje), ale je rozházený po čtyřech nástrojích a nic člověka nevede dál. Tady je z něj
 * CESTA LEKCÍ po tématech: lekce se odemykají jedna po druhé, každá má 3–6 otázek, za lekci
 * jsou body (XP), denní cíl (1–3 lekce) a SÉRIE DNŮ v řadě. Toti je v hlavičce, fandí, a na
 * hlavní obrazovce večer připomene, když by série padla (js/maskot.js).
 *
 * Otázky se skládají z PŘELOŽENÝCH zdrojů (nic se nepíše dvakrát):
 *   Pojmy      → window.agGeoDict (grafika.js): definice → který pojem to je
 *   Body       → AGPoznavacka.otazky (js/poznavacka.js): náčrt + popis → co je to za bod
 *   Předpisy   → data/predpisy.json: úryvek → který předpis / do které kategorie patří
 *   Výpočty    → data/ulohy.json: zadání → číslo s tolerancí
 *   Appka      → AGReg.all() (tools-registry.js): popis → který nástroj to umí
 * Lekce N tématu bere vždy stejné otázky (stabilní pořadí zdroje); možnosti se míchají.
 * Chybně zodpovězená otázka se jednou vrátí na konec lekce (jako v Duolingu).
 *
 * Stav v localStorage agCestaUceni_v1. Odpojitelné: smaž tento soubor + položky
 * 'cesta-uceni' v js/lazy-tools.js a js/tools-registry.js (a návod v data/navody*.json).
 */
(function () {
    'use strict';
    if (window.AGCesta) return;

    var ID = 'ag-cu', STYLE_ID = 'ag-cu-css', LS = 'agCestaUceni_v1';
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'cesta-uceni:' + kde); } catch (x) { /* nic */ } }
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function den(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function dnes() { return den(); }
    function vcera() { var d = new Date(); d.setDate(d.getDate() - 1); return den(d); }
    function st() {
        var s = null; try { s = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { s = null; }
        s = s && typeof s === 'object' ? s : {};
        if (!s.hotove || typeof s.hotove !== 'object') s.hotove = {};
        if (!s.xp) s.xp = 0;
        if (!s.streak) s.streak = { n: 0, last: null };
        if (!s.cil) s.cil = 1;
        if (s.dnesD !== dnes()) { s.dnesD = dnes(); s.dnesN = 0; }
        // série padla (včera nesplněno) — ukazovat 0, poslední den se nemaže
        if (s.streak.n && s.streak.last !== dnes() && s.streak.last !== vcera()) s.streak.n = 0;
        return s;
    }
    function uloz(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { swallow(e, 'ls'); } }
    function nahodne(a) { return a[Math.floor(Math.random() * a.length)]; }
    function zamichej(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
    function zkrat(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
    function bezTagu(s) { return String(s || '').replace(/<[^>]+>/g, ''); }
    function maskuj(text, nazev) {
        try { return text.replace(new RegExp(String(nazev).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '…'); } catch (e) { return text; }
    }
    function fetchData(url) {
        var f = (window.AGJazyk && AGJazyk.fetchData) ? AGJazyk.fetchData : fetch;
        return f(url, { cache: 'no-cache' }).then(function (r) { return r.json(); }).catch(function () { return null; });
    }
    function mcq(base, spravne, jine, n) {
        var moz = [spravne], pokus = 0;
        while (moz.length < (n || 3) && pokus++ < 60) { var o = nahodne(jine); if (o && moz.indexOf(o) < 0) moz.push(o); }
        base.typ = 'mcq'; base.spravne = spravne; base.moznosti = zamichej(moz);
        return base;
    }

    // ikony jako SVG (v appce žádné emoji jako ikony — test_pruchod_15_9 H1)
    var IK = {
        plamen: '<svg class="cu-ik" viewBox="0 0 24 24" aria-hidden="true" style="color:#f97316"><path fill="currentColor" d="M12 2c.9 3.2-.9 5.1-2.2 6.4C8.3 9.9 7 11.6 7 14a5 5 0 0 0 10 0c0-1.9-.9-3.4-1.9-4.4.1 1.6-.7 2.7-1.9 2.9.9-2.3.8-6.1-1.2-10.5z"/></svg>',
        hvezda: '<svg class="cu-ik" viewBox="0 0 24 24" aria-hidden="true" style="color:#facc15"><path fill="currentColor" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6-4.9-4.5 6.6-.8z"/></svg>',
        zamek: '<svg class="cu-ik" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
        koruna: '<svg class="cu-ik" viewBox="0 0 24 24" aria-hidden="true" style="color:#facc15"><path fill="currentColor" d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>'
    };
    // ---- zdroje otázek (pool = [{id, make()}], stabilní pořadí) ----
    function poolPojmy() {
        var D = (window.agGeoDict || []).filter(function (p) { return p && p.t && p.d && String(p.t).length <= 48 && String(p.d).length >= 25; })
            .slice().sort(function (a, b) { return String(a.t).localeCompare(String(b.t), 'cs'); });
        return Promise.resolve(D.map(function (p) {
            return { id: 'p:' + p.t, make: function () {
                var nazev = t(p.t);
                var jine = D.filter(function (x) { return x.t !== p.t; }).map(function (x) { return t(x.t); });
                return mcq({ otazka: t('Který pojem to je?'), text: zkrat(maskuj(t(p.d), nazev), 220), vysvetleni: nazev + ': ' + zkrat(t(p.d), 200) }, nazev, jine, 3);
            } };
        }));
    }
    function poolBody() {
        var nacti = window.AGPoznavacka ? Promise.resolve() : (window.AGLazyTools && AGLazyTools.load ? AGLazyTools.load('js/poznavacka.js') : Promise.resolve());
        return Promise.resolve(nacti).catch(function () { /* bez poznávačky */ }).then(function () {
            var Q = (window.AGPoznavacka && AGPoznavacka.otazky) || [];
            return Q.map(function (q) {
                return { id: 'b:' + q.n, make: function () {
                    var jine = Q.filter(function (x) { return x.n !== q.n; }).map(function (x) { return t(x.n); });
                    return mcq({ otazka: t('Co je to za bod?'), obr: q.kres || '', text: t(q.popis), vysvetleni: t(q.vys) }, t(q.n), jine, 4);
                } };
            });
        });
    }
    function poolPredpisy() {
        return fetchData('data/predpisy.json').then(function (d) {
            var R = [];
            ((d && d.kategorie) || []).forEach(function (k) { (k.zaznamy || []).forEach(function (z) { R.push({ z: z, kat: k.nazev }); }); });
            var kats = ((d && d.kategorie) || []).map(function (k) { return k.nazev; });
            return R.map(function (r, i) {
                return { id: 'r:' + r.z.nazev, make: function () {
                    if (i % 2 === 0) {
                        var jine = R.filter(function (x) { return x.z.nazev !== r.z.nazev; }).map(function (x) { return x.z.nazev; });
                        return mcq({ otazka: t('O kterém předpisu je řeč?'), text: zkrat(maskuj(bezTagu(r.z.telo), r.z.nazev), 230), vysvetleni: r.z.nazev + ' — ' + zkrat(bezTagu(r.z.telo), 180) }, r.z.nazev, jine, 3);
                    }
                    return mcq({ otazka: t('Do které oblasti patří tenhle předpis?'), text: r.z.nazev, vysvetleni: r.kat + ': ' + zkrat(bezTagu(r.z.telo), 180) }, r.kat, kats.filter(function (k) { return k !== r.kat; }), 3);
                } };
            });
        });
    }
    function poolVypocty() {
        return fetchData('data/ulohy.json').then(function (d) {
            var U = ((d && d.ulohy) || []).filter(function (u) { return u.odpovedi && u.odpovedi.length; })
                .slice().sort(function (a, b) { return ((a.obtiznost || 1) - (b.obtiznost || 1)) || String(a.id).localeCompare(String(b.id)); });
            return U.map(function (u) {
                return { id: 'v:' + u.id, make: function () {
                    var o = u.odpovedi[0];
                    return { typ: 'cislo', otazka: t('Vypočti'), html: u.zadani, label: o.l, v: o.v, tol: o.tol || 0.01,
                        vysvetleni: t('Správně je:') + ' ' + String(o.v).replace('.', ',') + ' (± ' + String(o.tol).replace('.', ',') + ')' };
                } };
            });
        });
    }
    function poolAppka() {
        var T = [];
        try { T = ((window.AGReg && AGReg.all()) || []).filter(function (r) { return r && !r.hidden && r.vl && r.vh; }).slice().sort(function (a, b) { return String(a.k).localeCompare(String(b.k)); }); } catch (e) { T = []; }
        return Promise.resolve(T.map(function (r) {
            return { id: 'a:' + r.k, make: function () {
                var jine = T.filter(function (x) { return x.k !== r.k; }).map(function (x) { return t(x.vl); });
                return mcq({ otazka: t('Který nástroj appky tohle umí?'), text: t(r.vh), vysvetleni: t(r.vl) + ' — ' + t(r.vh), k: r.k }, t(r.vl), jine, 3);
            } };
        }));
    }

    var TEMATA = [
        { id: 'pojmy', t: 'Základní pojmy', barva: '#1d7a57', lekci: 5, na: 6, pool: poolPojmy },
        { id: 'body', t: 'Body v terénu', barva: '#2563eb', lekci: 2, na: 5, pool: poolBody },
        { id: 'predpisy', t: 'Předpisy', barva: '#6d28d9', lekci: 4, na: 6, pool: poolPredpisy },
        { id: 'vypocty', t: 'Výpočty', barva: '#b45309', lekci: 4, na: 3, pool: poolVypocty },
        { id: 'appka', t: 'Co umí appka', barva: '#c62828', lekci: 3, na: 6, pool: poolAppka }
    ];
    var _pools = {};
    function pool(tem) { if (!_pools[tem.id]) _pools[tem.id] = tem.pool().catch(function (e) { swallow(e, 'pool:' + tem.id); _pools[tem.id] = null; return []; }); return _pools[tem.id]; }
    function klic(temId, i) { return temId + ':' + i; }
    // pořadí všech lekcí na cestě → která je na řadě (první nehotová)
    function vsechny() { var out = []; TEMATA.forEach(function (tm) { for (var i = 0; i < tm.lekci; i++) out.push({ tem: tm, i: i, k: klic(tm.id, i) }); }); return out; }
    function aktualni(s) { var v = vsechny(); for (var i = 0; i < v.length; i++) if (!s.hotove[v[i].k]) return v[i].k; return null; }
    function odemcena(s, k) { if (s.hotove[k]) return true; return aktualni(s) === k; }

    // ---- maskot ----
    function maskot(fn) { try { if (window.AGMaskot) return fn(window.AGMaskot); if (window.AGLazy) AGLazy.need('js/maskot.js', function () { if (window.AGMaskot) fn(window.AGMaskot); }); } catch (e) { /* bez maskota */ } }
    var _toti = null;
    function toti(fn) { maskot(function (M) { var h = el() && el().querySelector('.cu-toti'); if (!h) return; if (!_toti || !_toti.isConnected) { _toti = M.pripoj(h, { rekni: false }); if (_toti) _toti.classList.add('mk-mini'); } if (_toti) fn(M, _toti); }); }

    // ---- UI ----
    function styl() {
        if (document.getElementById(STYLE_ID)) return;
        var css = ''
            + '#ag-cu{position:fixed;inset:0;z-index:100001;display:none;flex-direction:column;background:var(--bg-color,#0f1216);color:var(--text-color,#e6e8eb);'
            + 'padding:calc(env(safe-area-inset-top,0px) + 8px) 0 calc(env(safe-area-inset-bottom,0px) + 8px);font-family:var(--font-ui,system-ui);}'
            + 'body.light-mode #ag-cu{background:#f4f6f5;color:#141821;}'
            + '#ag-cu .cu-top{display:flex;align-items:flex-start;gap:6px;padding:0 12px;}'
            + '#ag-cu .cu-toti{flex:1;min-width:0;}'
            + '#ag-cu .cu-toti .ag-maskot{margin:0;}'
            + '#ag-cu .cu-x{flex:0 0 auto;width:44px;height:44px;border-radius:50%;border:1px solid var(--glass-border,rgba(255,255,255,.16));background:transparent;color:inherit;font-size:20px;cursor:pointer;}'
            + '#ag-cu .cu-view{flex:1;min-height:0;overflow-y:auto;padding:6px 14px 16px;-webkit-overflow-scrolling:touch;}'
            + '#ag-cu .cu-stat{display:flex;gap:8px;margin:4px 0 12px;}'
            + '#ag-cu .cu-stat div{flex:1;min-width:0;padding:8px 6px;border-radius:12px;background:var(--surface-1,rgba(255,255,255,.06));border:1px solid var(--glass-border,rgba(255,255,255,.1));text-align:center;}'
            + 'body.light-mode #ag-cu .cu-stat div{background:#fff;}'
            + '#ag-cu .cu-stat b{display:block;font-size:calc(18px * var(--ag-font-scale,1));}'
            + '#ag-cu .cu-stat small{color:var(--text-muted,#9aa1ac);font-size:calc(11px * var(--ag-font-scale,1));}'
            + '#ag-cu .cu-stat select{margin-top:2px;max-width:100%;border-radius:8px;border:1px solid var(--glass-border,rgba(255,255,255,.14));background:transparent;color:inherit;font:inherit;font-size:calc(11px * var(--ag-font-scale,1));}'
            + '#ag-cu .cu-tema{margin:14px 0 8px;padding:12px 14px;border-radius:14px;color:#fff;display:flex;align-items:center;gap:10px;}'
            + '#ag-cu .cu-tema b{flex:1;font-size:calc(16px * var(--ag-font-scale,1));}'
            + '#ag-cu .cu-tema small{font-weight:700;font-size:calc(12px * var(--ag-font-scale,1));}'
            + '#ag-cu .cu-cesta{display:flex;flex-direction:column;align-items:center;gap:14px;padding:6px 0;}'
            + '#ag-cu .cu-uzel{position:relative;width:70px;height:66px;border-radius:50%;border:0;cursor:pointer;color:#fff;font-size:26px;font-weight:800;'
            + 'box-shadow:0 6px 0 rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;}'
            + '#ag-cu .cu-uzel:active{transform:translateY(3px);box-shadow:0 3px 0 rgba(0,0,0,.28);}'
            + '#ag-cu .cu-uzel.zamceno{background:#3a414b !important;color:#8a929c;box-shadow:0 6px 0 #262b31;cursor:default;}'
            + 'body.light-mode #ag-cu .cu-uzel.zamceno{background:#d5dad7 !important;color:#8a929c;box-shadow:0 6px 0 #b9c0bc;}'
            + '#ag-cu .cu-uzel.ted::after{content:"";position:absolute;inset:-9px;border-radius:50%;border:4px solid currentColor;opacity:.55;animation:cu-puls 1.6s ease-out infinite;}'
            + '#ag-cu .cu-uzel .cu-start{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);background:#fff;color:#141821;font-size:12px;font-weight:800;'
            + 'padding:6px 10px;border-radius:10px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.3);letter-spacing:.04em;}'
            + '#ag-cu .cu-uzel .cu-korunka{position:absolute;right:-4px;top:-6px;font-size:18px;}'
            + '#ag-cu .cu-ik{width:1.1em;height:1.1em;vertical-align:-0.15em;display:inline-block;}#ag-cu .cu-korunka .cu-ik{width:22px;height:22px;}#ag-cu .cu-uzel .cu-ik{width:26px;height:26px;}'
            + '@keyframes cu-puls{0%{transform:scale(.95);opacity:.7}100%{transform:scale(1.25);opacity:0}}'
            + '@media (prefers-reduced-motion:reduce){#ag-cu .cu-uzel.ted::after{animation:none;}}'
            // lekce
            + '#ag-cu .cu-prog{height:14px;border-radius:7px;background:var(--surface-1,rgba(255,255,255,.1));overflow:hidden;margin:8px 0 14px;}'
            + '#ag-cu .cu-prog i{display:block;height:100%;background:var(--accent,#2f9e74);border-radius:7px;transition:width .35s ease;}'
            + '#ag-cu .cu-q{font-size:calc(19px * var(--ag-font-scale,1));font-weight:800;margin:0 0 10px;}'
            + '#ag-cu .cu-text{font-size:calc(15px * var(--ag-font-scale,1));line-height:1.5;margin:0 0 14px;padding:12px 14px;border-radius:14px;background:var(--surface-1,rgba(255,255,255,.06));border:1px solid var(--glass-border,rgba(255,255,255,.1));}'
            + 'body.light-mode #ag-cu .cu-text{background:#fff;}'
            + '#ag-cu .cu-obr{display:flex;justify-content:center;margin:0 0 10px;}#ag-cu .cu-obr svg{max-width:100%;max-height:150px;}'
            + '#ag-cu .cu-moz{display:flex;flex-direction:column;gap:10px;}'
            + '#ag-cu .cu-moz button{min-height:52px;padding:10px 14px;border-radius:14px;border:2px solid var(--glass-border,rgba(255,255,255,.18));border-bottom-width:4px;'
            + 'background:transparent;color:inherit;font:600 calc(15px * var(--ag-font-scale,1))/1.3 var(--font-ui,system-ui);text-align:left;cursor:pointer;}'
            + '#ag-cu .cu-moz button.vyb{border-color:#3b82f6;background:rgba(59,130,246,.14);}'
            + '#ag-cu .cu-moz button.ok{border-color:#2f9e74;background:rgba(47,158,116,.18);}'
            + '#ag-cu .cu-moz button.bad{border-color:#ef4444;background:rgba(239,68,68,.14);}'
            + '#ag-cu .cu-cislo{display:flex;gap:8px;align-items:center;}#ag-cu .cu-cislo label{flex:0 0 auto;font-weight:700;}'
            + '#ag-cu .cu-cislo input{flex:1;min-width:0;min-height:52px;padding:10px 12px;border-radius:12px;border:2px solid var(--glass-border,rgba(255,255,255,.18));background:transparent;color:inherit;font:700 calc(18px * var(--ag-font-scale,1)) var(--font-mono,monospace);}'
            + '#ag-cu .cu-dole{padding:10px 14px 0;border-top:1px solid var(--glass-border,rgba(255,255,255,.08));}'
            + '#ag-cu .cu-dole.ok{background:rgba(47,158,116,.16);}#ag-cu .cu-dole.bad{background:rgba(239,68,68,.12);}'
            + '#ag-cu .cu-fb{margin:0 0 10px;font-size:calc(14px * var(--ag-font-scale,1));line-height:1.45;}#ag-cu .cu-fb b{display:block;font-size:calc(17px * var(--ag-font-scale,1));margin-bottom:3px;}'
            + '#ag-cu .cu-dole.ok .cu-fb b{color:#2f9e74;}#ag-cu .cu-dole.bad .cu-fb b{color:#ef4444;}'
            + '#ag-cu .cu-go{width:100%;min-height:52px;border-radius:14px;border:0;border-bottom:4px solid rgba(0,0,0,.25);background:var(--accent,#2f9e74);color:#fff;font:800 calc(16px * var(--ag-font-scale,1)) var(--font-ui,system-ui);cursor:pointer;letter-spacing:.02em;}'
            + '#ag-cu .cu-go:disabled{background:#3a414b;color:#8a929c;cursor:default;}'
            + '#ag-cu .cu-dole.bad .cu-go{background:#ef4444;}'
            + '#ag-cu .cu-konec{text-align:center;padding:10px 0;}#ag-cu .cu-konec h2{margin:6px 0 14px;font-size:calc(24px * var(--ag-font-scale,1));}'
            + '#ag-cu .cu-konec .cu-stat div b{font-size:calc(22px * var(--ag-font-scale,1));}';
        var s = document.createElement('style'); s.id = STYLE_ID; s.textContent = css; document.head.appendChild(s);
    }
    function el() { return document.getElementById(ID); }
    function build() {
        styl();
        var d = el(); if (d) return d;
        d = document.createElement('div'); d.id = ID; d.setAttribute('role', 'dialog'); d.setAttribute('data-ag-okno', ''); d.setAttribute('aria-label', t('Cesta učení'));
        d.innerHTML = '<div class="cu-top"><div class="cu-toti"></div><button type="button" class="cu-x" data-close aria-label="' + esc(t('Zavřít')) + '">✕</button></div>'
            + '<div class="cu-view"></div><div class="cu-dole" hidden></div>';
        document.body.appendChild(d);
        d.querySelector('.cu-x').addEventListener('click', function () { if (_lekce && !_lekce.konec) { mapa(); } else close(); });
        return d;
    }
    function view() { return el().querySelector('.cu-view'); }
    function dole() { return el().querySelector('.cu-dole'); }

    function mapa() {
        _lekce = null;
        var s = st(), d = build(), ted = aktualni(s);
        dole().hidden = true; dole().className = 'cu-dole';
        var h = '<div class="cu-stat">'
            + '<div><b>' + IK.plamen + ' ' + (s.streak.n || 0) + '</b><small>' + esc(t('dní v řadě')) + '</small></div>'
            + '<div><b>' + IK.hvezda + ' ' + s.xp + '</b><small>XP</small></div>'
            + '<div><b>' + Math.min(s.dnesN, s.cil) + ' / ' + s.cil + '</b><small>' + esc(t('dnes')) + '</small>'
            + '<select aria-label="' + esc(t('Denní cíl')) + '" data-cil>' + [1, 2, 3].map(function (n) { return '<option value="' + n + '"' + (s.cil === n ? ' selected' : '') + '>' + esc(t('cíl')) + ' ' + n + '</option>'; }).join('') + '</select></div>'
            + '</div>';
        TEMATA.forEach(function (tm) {
            var hot = 0; for (var i = 0; i < tm.lekci; i++) if (s.hotove[klic(tm.id, i)]) hot++;
            h += '<div class="cu-tema" style="background:' + tm.barva + '"><b>' + esc(t(tm.t)) + '</b><small>' + hot + ' / ' + tm.lekci + '</small></div><div class="cu-cesta">';
            var POS = [0, 44, 66, 44, 0, -44, -66, -44];
            for (var j = 0; j < tm.lekci; j++) {
                var k = klic(tm.id, j), done = s.hotove[k], odem = odemcena(s, k), jeTed = k === ted;
                h += '<button type="button" class="cu-uzel' + (odem ? '' : ' zamceno') + (jeTed ? ' ted' : '') + '" data-k="' + k + '" style="background:' + tm.barva + ';color:' + (jeTed ? tm.barva : '#fff') + ';transform:translateX(' + POS[j % POS.length] + 'px)"'
                    + ' aria-label="' + esc(t(tm.t) + ' ' + (j + 1) + (done ? ' — ' + t('hotovo') : (odem ? '' : ' — ' + t('zamčeno')))) + '"' + (odem ? '' : ' aria-disabled="true"') + '>'
                    + '<span style="color:#fff">' + (done ? '✓' : (odem ? '★' : IK.zamek)) + '</span>'
                    + (done && done.perfekt ? '<span class="cu-korunka" aria-hidden="true">' + IK.koruna + '</span>' : '')
                    + (jeTed ? '<span class="cu-start">' + esc(t('START')) + '</span>' : '') + '</button>';
            }
            h += '</div>';
        });
        view().innerHTML = h;
        view().querySelector('[data-cil]').addEventListener('change', function () { var x = st(); x.cil = parseInt(this.value, 10) || 1; uloz(x); mapa(); });
        view().querySelectorAll('.cu-uzel').forEach(function (b) {
            b.addEventListener('click', function () {
                var k = b.getAttribute('data-k'), s2 = st();
                if (!odemcena(s2, k)) { toti(function (M, m) { M.rekniText(m, t('Tahle lekce je ještě zamčená. Nejdřív dodělej tu, která svítí.'), 'mysli'); }); return; }
                var p = k.split(':'); startLekce(p[0], parseInt(p[1], 10));
            });
        });
        // aktuální lekci do středu obrazovky
        try { var cur = view().querySelector('.cu-uzel.ted'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center' }); } catch (e) { /* nic */ }
        toti(function (M, m) {
            var s3 = st();
            if (!ted) M.rekniText(m, t('Celou cestu máš hotovou! Lekce si můžeš kdykoli zopakovat.'), 'radost');
            else if (s3.dnesN >= s3.cil) M.rekniText(m, t('Dnešní cíl splněný. Série běží! Chceš ještě jednu?'), 'radost');
            else M.rekniText(m, s3.streak.n ? t('Série {n} dní! Jedna lekce a pojede dál.').replace('{n}', s3.streak.n) : t('Klepni na lekci, která svítí. Zvládneš ji za pár minut.'), 'mluvi');
        });
    }

    // ---- lekce ----
    var _lekce = null;
    function startLekce(temId, i) {
        var tm = TEMATA.filter(function (x) { return x.id === temId; })[0]; if (!tm) return;
        view().innerHTML = '<p style="opacity:.7">' + esc(t('Připravuji lekci…')) + '</p>';
        return pool(tm).then(function (P) {
            P = P || [];
            if (!P.length) { toti(function (M, m) { M.rekniText(m, t('Otázky pro tohle téma se nepodařilo načíst — zkus to se signálem.'), 'smutek'); }); mapa(); return; }
            var out = [];
            for (var j = 0; j < tm.na; j++) out.push(P[(i * tm.na + j) % P.length]);
            var otazky = out.map(function (q) { try { return q.make(); } catch (e) { swallow(e, 'make'); return null; } }).filter(Boolean);
            _lekce = { tem: tm, i: i, k: klic(tm.id, i), fronta: otazky, celkem: otazky.length, dobre: 0, prvni: {}, vraceno: {}, n: 0, konec: false };
            otazka();
        });
    }
    function otazka() {
        var L = _lekce; if (!L) return;
        if (!L.fronta.length) return konecLekce();
        var q = L.fronta[0], hotovo = L.n;
        var h = '<div class="cu-prog"><i style="width:' + Math.round(hotovo / (L.celkem + Object.keys(L.vraceno).length) * 100) + '%"></i></div>'
            + '<div class="cu-q">' + esc(q.otazka) + '</div>'
            + (q.obr ? '<div class="cu-obr" aria-hidden="true">' + q.obr + '</div>' : '')
            + (q.html ? '<div class="cu-text">' + q.html + '</div>' : (q.text ? '<div class="cu-text">' + esc(q.text) + '</div>' : ''));
        if (q.typ === 'mcq') h += '<div class="cu-moz" role="radiogroup">' + q.moznosti.map(function (m, j) { return '<button type="button" role="radio" aria-checked="false" data-j="' + j + '">' + esc(m) + '</button>'; }).join('') + '</div>';
        else h += '<div class="cu-cislo"><label for="cu-in">' + (q.label || '') + '</label><input id="cu-in" inputmode="decimal" autocomplete="off" placeholder="0,000"></div>';
        view().innerHTML = h; view().scrollTop = 0;
        var D = dole(); D.hidden = false; D.className = 'cu-dole';
        D.innerHTML = '<button type="button" class="cu-go" disabled>' + esc(t('Zkontrolovat')) + '</button>';
        var go = D.querySelector('.cu-go'), volba = null;
        if (q.typ === 'mcq') {
            view().querySelectorAll('.cu-moz button').forEach(function (b) {
                b.addEventListener('click', function () {
                    if (L.odpovezeno) return;
                    view().querySelectorAll('.cu-moz button').forEach(function (x) { x.classList.remove('vyb'); x.setAttribute('aria-checked', 'false'); });
                    b.classList.add('vyb'); b.setAttribute('aria-checked', 'true'); volba = q.moznosti[+b.getAttribute('data-j')]; go.disabled = false;
                });
            });
        } else {
            var inp = view().querySelector('#cu-in');
            inp.addEventListener('input', function () { go.disabled = !String(inp.value).trim(); });
            inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !go.disabled) go.click(); });
        }
        L.odpovezeno = false;
        go.addEventListener('click', function () {
            if (!L.odpovezeno) {
                var ok;
                if (q.typ === 'mcq') ok = volba === q.spravne;
                else { var v = parseFloat(String(view().querySelector('#cu-in').value).replace(/\s/g, '').replace(',', '.')); ok = isFinite(v) && Math.abs(v - q.v) <= q.tol; }
                vyhodnot(q, ok);
            } else {
                L.fronta.shift(); L.n++; otazka();
            }
        });
    }
    function vyhodnot(q, ok) {
        var L = _lekce; L.odpovezeno = true;
        var id = q.otazka + '|' + (q.text || q.html || '');
        if (L.prvni[id] == null) { L.prvni[id] = ok; if (ok) L.dobre++; }
        if (q.typ === 'mcq') view().querySelectorAll('.cu-moz button').forEach(function (b) {
            var m = q.moznosti[+b.getAttribute('data-j')]; b.disabled = true;
            if (m === q.spravne) b.classList.add('ok'); else if (b.classList.contains('vyb')) b.classList.add('bad');
        });
        if (!ok && !L.vraceno[id]) { L.vraceno[id] = true; L.fronta.push(q); }   // jednou znovu na konec
        var D = dole(); D.className = 'cu-dole ' + (ok ? 'ok' : 'bad');
        D.innerHTML = '<div class="cu-fb" role="status"><b>' + esc(ok ? t('Správně!') : t('Tentokrát ne')) + '</b>' + esc(q.vysvetleni || '') + '</div>'
            + '<button type="button" class="cu-go">' + esc(t('Pokračovat')) + '</button>';
        D.querySelector('.cu-go').addEventListener('click', function () { L.fronta.shift(); L.n++; otazka(); });
        try { D.querySelector('.cu-go').focus(); } catch (e) { /* nic */ }
        toti(function (M) { M.rekni(ok ? 'spravne' : 'spatne'); });
    }
    function konecLekce() {
        var L = _lekce; L.konec = true;
        var s = st(), perfekt = L.dobre === L.celkem;
        var xp = L.dobre * 2 + 3 + (perfekt ? 5 : 0);
        var bylo = s.hotove[L.k];
        s.hotove[L.k] = { ts: Date.now(), perfekt: perfekt || !!(bylo && bylo.perfekt), dobre: Math.max(L.dobre, (bylo && bylo.dobre) || 0) };
        s.xp += xp;
        s.dnesN = (s.dnesN || 0) + 1;
        var novaSerie = false;
        if (s.dnesN >= s.cil && s.streak.last !== dnes()) {
            s.streak.n = (s.streak.last === vcera()) ? (s.streak.n || 0) + 1 : 1;
            s.streak.last = dnes(); novaSerie = true;
        }
        uloz(s);
        dole().hidden = false; dole().className = 'cu-dole';
        dole().innerHTML = '<button type="button" class="cu-go">' + esc(t('Pokračovat')) + '</button>';
        dole().querySelector('.cu-go').addEventListener('click', mapa);
        var proc = Math.round(L.dobre / Math.max(1, L.celkem) * 100);
        view().innerHTML = '<div class="cu-konec"><h2>' + esc(perfekt ? t('Bez chyby!') : t('Lekce hotová!')) + '</h2>'
            + '<div class="cu-stat"><div><b>' + IK.hvezda + ' +' + xp + '</b><small>XP</small></div><div><b>' + proc + ' %</b><small>' + esc(t('napoprvé správně')) + '</small></div>'
            + '<div><b>' + IK.plamen + ' ' + s.streak.n + '</b><small>' + esc(t('dní v řadě')) + '</small></div></div>'
            + (novaSerie ? '<p>' + esc(t('Dnešní cíl splněný — série pokračuje!')) + '</p>' : '') + '</div>';
        toti(function (M) { M.rekni(perfekt ? 'konec_super' : (proc >= 70 ? 'konec_dobre' : 'konec_slabe'), { skore: L.dobre, celkem: L.celkem }); });
    }

    function open() {
        var d = build(); d.style.display = 'flex';
        mapa();
    }
    function close() { var d = el(); if (d) d.style.display = 'none'; _lekce = null; }

    function register() {
        try {
            if (typeof window.agRegisterFieldTool === 'function') window.agRegisterFieldTool({ id: 'cesta-uceni', label: t('Cesta učení'), cat: 'Pomůcky', onClick: open, order: 1,
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/></svg>' });
        } catch (e) { swallow(e, 'register'); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register); else register();

    window.agOpenCesta = open;
    window.AGCesta = { open: open, close: close, stav: st, TEMATA: TEMATA,
        _test: { startLekce: startLekce, lekce: function () { return _lekce; }, otazka: function () { return _lekce && _lekce.fronta[0]; }, reset: function () { _pools = {}; } } };
})();
