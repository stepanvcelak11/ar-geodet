// ===== AR Geodet — SBALITELNÝ NÁSTROJ „MINI PANEL" (ODPOJITELNÁ vrstva) =========
// Neinvazivní vrstva. NEEDITUJE logika.js, grafika.js ani jednotlivé nástroje.
//
// PROBLÉM: nástroje s živými čísly (Vytyčení přímky, Krokový offset) běží
// v celoobrazovkovém modálu. Když jdeš s výtyčkou, buď ti modál překrývá kameru
// i mapu, nebo ho zavřeš — a o živá čísla přijdeš.
//
// ŘEŠENÍ: tlačítko „Sbalit" v hlavičce nástroje. Modál se JEN VIZUÁLNĚ schová
// (zůstává otevřený, takže jeho vlastní obnovovací smyčka běží dál a stav se
// nikam neztratí) a nahoře zůstane úzký proužek s tím podstatným:
//
//     ⟨ Vytyčení přímky ⟩  Staničení 24,18 m · Odstup 0,12 m vlevo      ▴  ✕
//
// Klepnutí na proužek (nebo na ▴) nástroj zase rozbalí, ✕ ho zavře úplně.
//
// ⚠ 29. 8. 2026 — NA PŘÁNÍ Z TERÉNU: „toto umí jen krokový ofset a chtěl bych,
// aby to uměly všechny nástroje." Dřív tu byl ruční seznam DVOU nástrojů a nikdo
// další sbalit nešel. Teď se sbalit dá KAŽDÉ otevřené okno nástroje a rozpoznává
// se stejně jako v js/modal-close.js (odkud je i seznam výjimek):
//   • domácí modály .modal-overlay s .modal-content → textové tlačítko v hlavičce,
//   • okna, která si modul kreslí sám (#tachy-modal, .ag-zv-ov…) → kulaté
//     tlačítko ▾ vedle křížku, protože do cizí hlavičky se strkat nedá.
// Okna, která nejsou nástroj (Nastavení, seznam Nástrojů, dialogy, úvodní
// obrazovka, kolečko), jsou vyjmutá jmenovitě — sbalit seznam nedává smysl.
//
// ŽIVÉ HODNOTY do proužku: kdo má záznam v TOOLS (nebo atribut data-ag-mini-src),
// bere se odtud. Zbytku se hodnoty NAJDOU SAMY: hledají se řádky typu
// „popisek + číslo" (<span>Přesnost teď:</span><b>±2,4 m</b>, .geo-data-row,
// .bgps-stat…), což je tvar, který v appce používá skoro každý nástroj. Když se
// nic nenajde, v proužku zůstane aspoň název nástroje — o to hlavní, tedy že
// nástroj běží dál, uživatel nepřijde.
//
// JAK PŘIDAT DALŠÍ NÁSTROJ: nic. Když chceš vybrat konkrétní hodnoty, zapiš ho
// do TOOLS níž, nebo mu na okno dej atribut data-ag-mini="Název nástroje"
// (a volitelně data-ag-mini-src="#id" s kontejnerem živých hodnot).
// Vypnout sbalení pro jedno okno: atribut data-ag-mini-off.
//
// Odstranění: smaž js/mini-panel.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGMini) return;

    var BAR_ID = 'ag-mini';
    var HIDE_CLS = 'ag-mini-off';
    var MAX_VALS = 3;

    // Nástroje s RUČNĚ vybranými hodnotami. src = kontejner s živými řádky
    // (label + <b>), vals = ruční výběr, když nástroj nemá jeden společný kontejner.
    // Kdo tu není, dostane tlačítko taky — hodnoty si najde autoVals() níž.
    var TOOLS = [
        { modal: 'agsl-modal', title: 'Vytyčení přímky', src: '#agsl-live' },
        {
            modal: 'ag-pdr-modal', title: 'Krokový offset', vals: [
                { l: 'Kroky', s: '#ag-pdr-steps' },
                { l: 'Vzdálenost', s: '#ag-pdr-dist' },
                { l: 'Směr', s: '#ag-pdr-head' }
            ]
        },
        {
            modal: 'gpsavg-modal', title: 'Průměrování GPS', vals: [
                { l: 'Měření', s: '#ga-n' },
                { l: 'Stř. chyba', s: '#ga-pos' },
                { l: 'Teď', s: '#ga-now' }
            ]
        },
        {
            modal: 'measure-modal', title: 'Měření vzdálenosti', vals: [
                { l: 'Vodorovná', s: '#meas-horiz' },
                { l: 'Převýšení', s: '#meas-elev' }
            ]
        }
    ];

    // Okna, která NEJSOU nástroj — sbalit seznam nebo dialog nedává smysl.
    // (Seznam vychází z MOD_SKIP v js/modal-close.js a z domácích modálů, které
    // jsou formulář nebo rozcestník, ne běžící měření.)
    var SKIP = {
        'settings-modal': 1, 'tools-modal': 1, 'manage-modal': 1, 'custom-modal-overlay': 1,
        'dict-modal': 1, 'about-modal': 1, 'cluster-modal': 1, 'nearby-modal': 1,
        'compass-calib-modal': 1,
        'ag-kn': 1, 'ag-gate': 1, 'ag-login': 1, 'welcome-screen': 1, 'agtp-block': 1,
        'ag-mini': 1, 'ag-backup-bar': 1, 'ag-stack': 1, 'hud-editor': 1
    };

    var _cur = null;        // právě sbalený nástroj {cfg, modal, disp}
    var _timer = null;
    var _lastHtml = '';

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
    function cs(el) { try { return window.getComputedStyle(el); } catch (e) { return null; } }

    // ---- styly -----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('ag-mini-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-mini-style';
        st.textContent = [
            // sbalené okno: zůstává „otevřené" (běží mu smyčka), jen není vidět.
            // ⚠ ZÁMĚRNĚ ne display:none — tím by se zastavily rAF smyčky, kamera
            // by dostala nulovou velikost a nástroj by po rozbalení naskočil znovu.
            '.' + HIDE_CLS + '{opacity:0 !important;visibility:hidden !important;pointer-events:none !important;}',
            // proužek — pod stavovou bublinou; se sloupcem upozornění (--ag-stack-h) se posune níž
            '#' + BAR_ID + '{position:fixed;left:50%;transform:translateX(-50%);',
            '  top:calc(env(safe-area-inset-top,0px) + var(--ag-stack-h, 38px) + 10px);z-index:9998;',
            '  display:none;align-items:center;gap:9px;max-width:94vw;padding:7px 8px 7px 13px;border-radius:999px;cursor:pointer;',
            '  background:var(--glass-bg,rgba(18,22,28,0.90));border:1px solid var(--accent,#2f9e74);',
            '  backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);box-shadow:0 4px 16px rgba(0,0,0,0.42);',
            '  color:var(--text-color,#eceef2);font:600 12px/1.15 var(--font-ui,system-ui);white-space:nowrap;}',
            '#' + BAR_ID + '.on{display:flex;}',
            '#' + BAR_ID + ' .agm-t{flex:0 0 auto;font-size:calc(10.5px * var(--ag-font-scale, 1));letter-spacing:.04em;text-transform:uppercase;color:var(--accent,#2f9e74);}',
            '#' + BAR_ID + ' .agm-v{display:flex;gap:9px;min-width:0;overflow:hidden;font-variant-numeric:tabular-nums;}',
            '#' + BAR_ID + ' .agm-v i{font-style:normal;color:var(--text-muted,#9aa1ac);font-weight:600;margin-right:3px;}',
            '#' + BAR_ID + ' .agm-v b{font-family:var(--font-mono,ui-monospace,Menlo,monospace);color:var(--data,#e6bd76);}',
            '#' + BAR_ID + ' button{flex:0 0 auto;width:26px;height:26px;padding:0;border-radius:50%;cursor:pointer;',
            '  border:none;background:rgba(255,255,255,0.13);color:inherit;font:700 13px/26px var(--font-ui,system-ui);}',
            'body.ag-glove #' + BAR_ID + '{font-size:calc(13px * var(--ag-font-scale, 1));padding:9px 10px 9px 15px;}',
            'body.ag-glove #' + BAR_ID + ' button{width:32px;height:32px;line-height:32px;}',
            'body.outdoor-mode #' + BAR_ID + '{background:#0a0e1a;border-width:2px;}',
            'body.light-mode.outdoor-mode #' + BAR_ID + '{background:#fff;}',
            // tlačítko „Sbalit" v hlavičce domácího modálu
            '.ag-mini-btn{margin:-2px 0 10px auto;display:flex;align-items:center;gap:6px;padding:7px 12px;cursor:pointer;',
            '  border-radius:999px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:var(--surface-2,rgba(255,255,255,0.07));color:var(--text-color,#eceef2);',
            '  font:600 11.5px/1 var(--font-ui,system-ui);}',
            // kulaté tlačítko pro okna modulů — vedle křížku z js/modal-close.js
            // (ten sedí na right:10px a je 40px široký, takže my na 58px)
            '.ag-mini-fab{position:absolute;z-index:30;top:calc(env(safe-area-inset-top,0px) + 10px);',
            '  right:calc(env(safe-area-inset-right,0px) + 58px);width:40px;height:40px;border-radius:50%;',
            '  display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;',
            '  background:var(--surface-2,rgba(255,255,255,0.09));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  color:var(--text-color,#eceef2);font:700 15px/1 var(--font-ui,system-ui);}',
            '.ag-mini-fab:active{transform:scale(.92);}',
            'body.left-hand .ag-mini-fab{right:auto;left:calc(env(safe-area-inset-left,0px) + 58px);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- čtení živých hodnot ze (skrytého) okna -----------------------------------
    // Hodnota má smysl ukazovat, jen když v ní je číslo — „—", „--" i „-- m"
    // znamenají „zatím nic naměřeno" a v proužku by jen zabíraly místo.
    var NUMISH = /[0-9]/;
    function useful(v) { return !!v && NUMISH.test(v); }
    // Řádky typu <div><span>Popisek</span><b>hodnota</b></div> — tvar, na kterém
    // stojí skoro každý panel v appce (.ga-row, .geo-data-row, .bgps-stat…).
    function rowsFrom(root, out) {
        var rows = root.querySelectorAll('div,li,p');
        for (var j = 0; j < rows.length && out.length < MAX_VALS; j++) {
            var b = rows[j].querySelector('b,strong,.v,.geo-value,.val');
            if (!b) continue;
            var lab = txt(rows[j].querySelector('span,.k,.geo-label')) || '';
            var val = txt(b);
            if (!useful(val)) continue;
            out.push({ l: lab.replace(/:$/, ''), v: val, c: (b.style && b.style.color) || '' });
        }
        return out;
    }
    function autoVals(modal) {
        var out = [], seen = {};
        // ⚠ jen VIDITELNÉ řádky — panely nástrojů mají spoustu skrytých větví
        // (jiná záložka, nerozbalený detail) a z těch by se do proužku dostaly
        // hodnoty, které uživatel na obrazovce vůbec neměl.
        var cand = modal.querySelectorAll('div,li,p');
        for (var i = 0; i < cand.length && out.length < MAX_VALS; i++) {
            var row = cand[i];
            if (row.children.length !== 2) continue;
            var a = row.children[0], b = row.children[1];
            if (a.children.length > 1 || b.children.length > 1) continue;
            var lab = txt(a), val = txt(b);
            if (!lab || !val || lab.length > 26 || val.length > 22) continue;
            if (!useful(val)) continue;
            var rst = cs(row);
            if (!row.offsetParent && (!rst || rst.position !== 'fixed')) continue;
            lab = lab.replace(/:$/, '');
            if (seen[lab]) continue;
            seen[lab] = 1;
            out.push({ l: lab, v: val, c: (b.style && b.style.color) || '' });
        }
        return out;
    }
    function readVals(cfg, modal) {
        var out = [];
        if (cfg.vals) {
            for (var i = 0; i < cfg.vals.length && out.length < MAX_VALS; i++) {
                var v = txt(modal.querySelector(cfg.vals[i].s));
                if (useful(v)) out.push({ l: cfg.vals[i].l, v: v });
            }
            return out.length ? out : autoVals(modal);
        }
        var sel = cfg.src || modal.getAttribute('data-ag-mini-src') || '';
        var src = sel ? modal.querySelector(sel) : null;
        if (src) {
            rowsFrom(src, out);
            if (!out.length) { var t = txt(src); if (t) out.push({ l: '', v: t.slice(0, 42) }); }
        }
        return out.length ? out : autoVals(modal);
    }

    // ---- proužek ----------------------------------------------------------------
    function bar() {
        var el = document.getElementById(BAR_ID);
        if (el) return el;
        el = document.createElement('div');
        el.id = BAR_ID;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', 'Sbalený nástroj — klepni pro rozbalení');
        el.addEventListener('click', function (e) {
            var b = e.target.closest('button[data-a]');
            if (!b) { expand(); return; }
            e.stopPropagation();
            if (b.getAttribute('data-a') === 'close') closeTool(); else expand();
        });
        (document.body || document.documentElement).appendChild(el);
        return el;
    }
    function paint() {
        if (!_cur) return;
        var vals = readVals(_cur.cfg, _cur.modal);
        var h = '<span class="agm-t">' + esc(_cur.cfg.title) + '</span><span class="agm-v">';
        for (var i = 0; i < vals.length; i++) {
            h += '<span>' + (vals[i].l ? '<i>' + esc(vals[i].l) + '</i>' : '')
                + '<b' + (vals[i].c ? ' style="color:' + esc(vals[i].c) + '"' : '') + '>' + esc(vals[i].v) + '</b></span>';
        }
        h += '</span><button type="button" data-a="open" aria-label="Rozbalit">▴</button>'
            + '<button type="button" data-a="close" aria-label="Zavřít nástroj">✕</button>';
        if (h === _lastHtml) return;
        _lastHtml = h;
        bar().innerHTML = h;
    }

    // ---- sbalit / rozbalit / zavřít ------------------------------------------------
    function collapse(modal, cfg) {
        if (!modal) return;
        injectStyles();
        if (_cur && _cur.modal !== modal) expand();      // sbalený je vždycky jen jeden
        // ⚠ inline display si musíme zapamatovat: okna modulů nejedou jen na
        // 'flex' (tachymetrie má flex, jiné block, další nic a řídí se třídou),
        // takže „vrať na flex" by některé z nich rozbilo.
        _cur = { modal: modal, cfg: cfg, disp: modal.style.display };
        _lastHtml = '';
        modal.classList.add(HIDE_CLS);
        bar().classList.add('on');
        paint();
        if (!_timer) _timer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 500);
        try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
    }
    function expand() {
        if (!_cur) { bar().classList.remove('on'); return; }
        var m = _cur.modal, disp = _cur.disp;
        m.classList.remove(HIDE_CLS);
        // nástroj mohl být mezitím zavřený jinudy — pak ho zase otevřeme tím, co
        // měl na sobě v okamžiku sbalení
        var st = cs(m);
        if (st && st.display === 'none') m.style.display = (disp && disp !== 'none') ? disp : 'flex';
        _cur = null;
        bar().classList.remove('on');
        stop();
    }
    // Zavírací tlačítko okna — stejná pravidla jako v js/modal-close.js: nástroje
    // si při zavření uklízejí časovače, kameru a rozdělaný stav, takže se nikdy
    // nevypíná natvrdo přes display.
    function ownClose(m) {
        var bs = m.querySelectorAll('button'), best = null, bestScore = 0;
        for (var i = 0; i < bs.length; i++) {
            var t = (bs[i].textContent || '').trim().toLowerCase();
            var al = (bs[i].getAttribute('aria-label') || '').trim().toLowerCase();
            var score = 0;
            if (t === 'zavřít' || t === 'zavrit') score = 100;
            else if (t === 'zpět' || t === 'zpet' || t === 'hotovo') score = 95;
            else if (al === 'zavřít' || al === 'zavrit') score = 90;
            else if (t === '✕' || t === '×' || t === '✖' || t === 'x') score = 85;
            if (score && score >= bestScore) { best = bs[i]; bestScore = score; }
        }
        return best;
    }
    function closeTool() {
        if (!_cur) return;
        var m = _cur.modal;
        m.classList.remove(HIDE_CLS);
        var btn = ownClose(m);
        _cur = null;
        bar().classList.remove('on');
        stop();
        if (btn) btn.click(); else m.style.display = 'none';
    }
    function stop() { if (_timer) { (window.AG && AG.clearUiInterval ? AG.clearUiInterval : clearInterval)(_timer); _timer = null; } }

    function tick() {
        if (!_cur) { stop(); return; }
        // nástroj zavřel někdo jiný (např. tlačítkem uvnitř) → proužek zmizí taky
        var st = cs(_cur.modal);
        if (!document.body.contains(_cur.modal) || !st || st.display === 'none') {
            _cur.modal.classList.remove(HIDE_CLS);
            _cur = null; bar().classList.remove('on'); stop(); return;
        }
        paint();
    }

    // ---- rozpoznání okna nástroje --------------------------------------------------
    // Domácí modál appky: .modal-overlay s .modal-content.
    function coreWin(el) {
        return !!(el && el.classList && el.classList.contains('modal-overlay') && el.querySelector('.modal-content'));
    }
    // Okno, které si kreslí modul sám. Pravidla jsou ZÁMĚRNĚ stejná jako
    // modOverlay() v js/modal-close.js: přes celý displej, viditelné, klikatelné
    // a z-index ≥ 1000 (níž leží mapa, AR a dok — do těch se sahat nesmí).
    function modWin(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.classList && el.classList.contains('modal-overlay')) return false;
        var st = cs(el);
        if (!st || st.position !== 'fixed' || st.display === 'none') return false;
        if (st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false;
        if (st.pointerEvents === 'none') return false;
        var z = parseInt(st.zIndex, 10);
        if (!(z >= 1000)) return false;
        var r = el.getBoundingClientRect();
        return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.6;
    }
    function skipped(el) {
        if (el.id && SKIP[el.id]) return true;
        if (el.hasAttribute && el.hasAttribute('data-ag-mini-off')) return true;
        // dialogy agAlert/agConfirm/agPrompt — ty neběží, ty se odpovídají
        if (el.classList && el.classList.contains('ag-dlg-overlay')) return true;
        return false;
    }
    function titleOf(modal) {
        var t = modal.getAttribute('data-ag-mini');
        if (t) return t;
        var h = modal.querySelector('h1,h2,h3,.tt-title');
        var s = txt(h);
        if (s) return s.replace(/\s*[×✕✖]\s*$/, '').slice(0, 28);
        return 'Nástroj';
    }
    function cfgFor(modal) {
        for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].modal === modal.id) return TOOLS[i];
        return { modal: modal.id || '', title: titleOf(modal), src: modal.getAttribute('data-ag-mini-src') || '' };
    }

    // ---- tlačítko „Sbalit" do okna -------------------------------------------------
    function ensureBtn(modal) {
        if (!modal || skipped(modal)) return;
        if (modal.querySelector('.ag-mini-fab') || modal.querySelector('.ag-mini-btn')) return;
        var core = coreWin(modal);
        if (!core && !modWin(modal)) return;
        injectStyles();
        var mk = function () {
            var b = document.createElement('button');
            b.type = 'button';
            b.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                collapse(modal, cfgFor(modal));
            });
            return b;
        };
        if (core) {
            var content = modal.querySelector('.modal-content'); if (!content) return;
            var b = mk();
            b.className = 'ag-mini-btn';
            b.innerHTML = '▾ Sbalit — nechat běžet nahoře';
            var h = content.querySelector('h3, h2');
            if (h && h.nextSibling) content.insertBefore(b, h.nextSibling);
            else content.insertBefore(b, content.firstChild);
        } else {
            // Okno modulu: do cizí hlavičky se strkat nedá (každý modul ji má jinak),
            // takže kulaté tlačítko na okno samo — vedle křížku z modal-close.js.
            var f = mk();
            f.className = 'ag-mini-fab';
            f.title = 'Sbalit — nechat běžet nahoře';
            f.setAttribute('aria-label', 'Sbalit — nechat běžet nahoře');
            f.textContent = '▾';
            modal.appendChild(f);
        }
    }

    // Nástroje si okna staví až při prvním otevření → hlídáme, kdy se objeví.
    // Domácí modály se dají najít podle třídy; okna modulů se poznají až podle
    // rozměru a z-indexu, takže se prohlížejí přímé děti <body> (tam je moduly
    // přidávají) a jen ta, která jsou právě vidět.
    function scan() {
        var i, list = document.querySelectorAll('.modal-overlay');
        for (i = 0; i < list.length; i++) ensureBtn(list[i]);
        var kids = document.body ? document.body.children : [];
        for (i = 0; i < kids.length; i++) {
            var k = kids[i];
            if (k.nodeType !== 1 || k.tagName === 'SCRIPT' || k.tagName === 'STYLE') continue;
            if (k.classList && k.classList.contains('modal-overlay')) continue;
            if (skipped(k)) continue;
            if (k.style && k.style.display === 'none') continue;   // levné odmítnutí bez layoutu
            ensureBtn(k);
        }
    }

    function init() {
        injectStyles();
        scan();
        if (!window.__agMiniScan) window.__agMiniScan = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(scan, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    window.AGMini = {
        // ruční zapojení nástroje z jiného modulu: AGMini.register({modal:'id', title:'…', src:'#…'})
        register: function (cfg) { if (cfg && cfg.modal) { TOOLS.push(cfg); scan(); } },
        collapse: function (id) { var m = document.getElementById(id); if (m) collapse(m, cfgFor(m)); },
        expand: expand,
        scan: scan,
        get active() { return _cur ? _cur.cfg.modal : null; }
    };
})();
