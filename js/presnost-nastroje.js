// ===== QTRIG — STAČÍ NA TO TELEFON? (ODPOJITELNÁ vrstva) =======================
// (6. 10. 2026, hodnocení — návrh 3, vybraný uživatelem)
//
// PROČ: telefon měří ±3–7 m, ale některé nástroje dávají výsledek, který vypadá
// jako geodetické měření — vytyčení s odchylkami na centimetry, rajón ze stanoviska
// z GPS, kubatura obejitím, posuny v čase. Nástroj to sám neřekne a člověk bere
// číslo vážně. Tady má každý takový nástroj v registru `acc` = jakou přesnost polohy
// výsledek potřebuje (js/tools-registry.js), a když telefon zrovna měří hůř, po
// spuštění nástroje se nahoře ukáže pruh:
//   „Na tohle telefon teď nestačí: potřeba ±0,10 m, telefon měří ±4,2 m.
//    Výsledek ber jako orientační.“   [Jak zpřesnit]  [U tohoto už neukazovat]
// NIC SE NEBLOKUJE — orientační výsledek má v terénu smysl (dojít na místo, najít
// mezník). Jde jen o to, aby bylo řečeno, co výsledek znamená.
//
// PŘESNOST TELEFONU: σ polohy jako u kruhu nejistoty (js/nejistota.js — průměr
// z Přesné GPS, jinak přesnost čipu); bez načteného modulu currentGpsAccuracy.
// Bez fixu se nic neukazuje (nevíme, co porovnat).
//
// ZACHYCENÍ: jeden posluchač kliku v capture fázi na dlaždici / řádek seznamu úkonů
// (stejné selektory jako js/pro-zamky.js). Klik se NEZASTAVUJE. Zamčený Pro nástroj
// sem nedojde — pro-zamky.js je registrovaný dřív a klik zastaví sám.
// „U tohoto už neukazovat“ se pamatuje v localStorage agPresnostNastroje_v1.
// Odstranění: smaž js/presnost-nastroje.js + řádek <script type="ag/lazy"> v index.html,
// přegeneruj sw.js; pole `acc` v registru pak nikdo nečte.
// ================================================================================
(function () {
    'use strict';
    if (window.AGPresnostNastroje) return;

    var LS = 'agPresnostNastroje_v1', ID = 'ag-pn-pruh';
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'presnost-nastroje:' + kde); } catch (x) { /* nic */ } }
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function g(name) { try { return (0, eval)('typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined'); } catch (e) { return undefined; } }
    function m(v) { return (v < 1 ? (+v).toFixed(2) : (+v).toFixed(1)).replace('.', ','); }
    function st() { try { var s = JSON.parse(localStorage.getItem(LS) || 'null'); return (s && typeof s === 'object') ? s : {}; } catch (e) { return {}; } }
    function ulozSt(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { swallow(e, 'ls'); } }

    function potreba(k) { try { var r = window.AGReg && AGReg.get(k); return (r && r.acc > 0) ? +r.acc : null; } catch (e) { return null; } }
    function telefon() {
        try { if (window.AGNejistota) { var s = AGNejistota.sigma(0, false); if (s) return s.gps; } } catch (e) { swallow(e, 'sigma'); }
        var a = g('currentGpsAccuracy');
        return (a && a > 0) ? +a : null;
    }
    // { k, potreba, telefon } když telefon nestačí, jinak null
    function posud(k) {
        var p = potreba(k); if (p == null) return null;
        if ((st().skryte || {})[k]) return null;
        var tel = telefon();
        var P = window.AGEsm && window.AGEsm.presnost;   // js/esm/presnost.mjs
        if (!P || P.telefonStaci(p, tel) !== false) return null;
        return { k: k, potreba: p, telefon: tel };
    }

    function styl() {
        if (document.getElementById(ID + '-css')) return;
        var css = '#' + ID + '{position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 10px);z-index:100070;'
            + 'width:min(440px,calc(100vw - 20px));box-sizing:border-box;padding:11px 13px;border-radius:14px;background:#2a1f05;color:#fde68a;'
            + 'border:1px solid rgba(251,191,36,.55);box-shadow:0 10px 30px rgba(0,0,0,.45);font:500 calc(13px * var(--ag-font-scale,1))/1.45 var(--font-ui,system-ui);}'
            + '#' + ID + ' b{color:#fbbf24;}'
            + '#' + ID + ' .pn-akce{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}'
            + '#' + ID + ' button{min-height:40px;padding:8px 12px;border-radius:10px;border:1px solid rgba(251,191,36,.5);background:rgba(251,191,36,.12);'
            + 'color:#fde68a;font:600 calc(12.5px * var(--ag-font-scale,1))/1.2 var(--font-ui,system-ui);cursor:pointer;}'
            + '#' + ID + ' .pn-x{position:absolute;top:4px;right:4px;width:36px;height:36px;min-height:0;padding:0;border:0;background:none;font-size:20px;}'
            + 'body.light-mode #' + ID + '{background:#fffbeb;color:#713f12;border-color:#f59e0b;}body.light-mode #' + ID + ' b{color:#b45309;}'
            + 'body.light-mode #' + ID + ' button{color:#713f12;border-color:#f59e0b;background:#fef3c7;}';
        var s = document.createElement('style'); s.id = ID + '-css'; s.textContent = css; document.head.appendChild(s);
    }
    var _tm = null;
    function zavri() { clearTimeout(_tm); var el = document.getElementById(ID); if (el) el.remove(); }
    function ukaz(v) {
        styl(); zavri();
        var el = document.createElement('div'); el.id = ID; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
        el.innerHTML = '<button type="button" class="pn-x" aria-label="' + t('Zavřít') + '">×</button>'
            + '<div style="padding-right:26px;">' + t('Na tohle telefon teď nestačí:') + ' ' + t('potřeba') + ' <b>±' + m(v.potreba) + ' m</b>, '
            + t('telefon měří') + ' <b>±' + m(v.telefon) + ' m</b>. ' + t('Výsledek ber jako orientační (dojít na místo, najít bod), ne jako měření.') + '</div>'
            + '<div class="pn-akce"><button type="button" data-a="jak">' + t('Jak zpřesnit') + '</button>'
            + '<button type="button" data-a="skryt">' + t('U tohoto už neukazovat') + '</button></div>';
        document.body.appendChild(el);
        el.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('button'); if (!b) return;
            if (b.classList.contains('pn-x')) return zavri();
            var a = b.getAttribute('data-a');
            if (a === 'skryt') { var s = st(); s.skryte = s.skryte || {}; s.skryte[v.k] = Date.now(); ulozSt(s); zavri(); }
            else if (a === 'jak') {
                zavri();
                try { if (!(window.AGUkony && AGUkony.run && AGUkony.run('presne-mereni')) && window.AGLazyTools) AGLazyTools.open('presne-mereni'); } catch (x) { swallow(x, 'jak'); }
            }
        });
        _tm = setTimeout(zavri, 12000);
    }

    function klicUzlu(el) {
        if (!el || !el.getAttribute) return null;
        var k = el.getAttribute('data-tool') || el.getAttribute('data-k');
        if (k) return k;
        var oc = el.getAttribute('onclick') || '';
        var ms = oc.match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    document.addEventListener('click', function (e) {
        try {
            if (!e.target || !e.target.closest) return;
            var el = e.target.closest('#tools-modal .tool-tile, .ag-uk-i, [data-tool]'); if (!el) return;
            if (el.hasAttribute('aria-expanded')) return;   // rozbalení rozcestníku není spuštění nástroje
            var v = posud(klicUzlu(el)); if (!v) return;
            // až se okno nástroje otevře — pruh má ležet NAD ním
            setTimeout(function () { ukaz(v); }, 700);
        } catch (err) { swallow(err, 'klik'); }
    }, true);

    window.AGPresnostNastroje = { posud: posud, ukaz: ukaz, zavri: zavri, telefon: telefon };
})();
