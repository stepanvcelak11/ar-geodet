// ===== AR Geodet — SBALITELNÝ NÁSTROJ „MINI PANEL" (ODPOJITELNÁ vrstva) =========
// Neinvazivní vrstva. NEEDITUJE logika.js, grafika.js ani jednotlivé nástroje.
//
// PROBLÉM: nástroje s živými čísly (Vytyčení přímky, Krokový offset) běží
// v celoobrazovkovém modálu. Když jdeš s výtyčkou, buď ti modál překrývá kameru
// i mapu, nebo ho zavřeš — a o živá čísla přijdeš.
//
// ŘEŠENÍ: tlačítko „Sbalit" v hlavičce nástroje. Modál se JEN VIZUÁLNĚ schová
// (zůstává display:flex, takže jeho vlastní obnovovací smyčka běží dál a stav se
// nikam neztratí) a nahoře zůstane úzký proužek s tím podstatným:
//
//     ⟨ Vytyčení přímky ⟩  Staničení 24,18 m · Odstup 0,12 m vlevo      ▴  ✕
//
// Klepnutí na proužek (nebo na ▴) nástroj zase rozbalí, ✕ ho zavře úplně.
//
// JAK PŘIDAT DALŠÍ NÁSTROJ: buď ho zapiš do TOOLS níž, nebo mu na .modal-overlay
// dej atribut data-ag-mini="Název nástroje" (a volitelně data-ag-mini-src="#id"
// s kontejnerem živých hodnot) — víc netřeba.
//
// Odstranění: smaž js/mini-panel.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGMini) return;

    var BAR_ID = 'ag-mini';
    var HIDE_CLS = 'ag-mini-off';
    var MAX_VALS = 3;

    // Nástroje, které se dají sbalit. src = kontejner s živými řádky (label + <b>),
    // vals = ruční výběr hodnot, když nástroj nemá jeden společný kontejner.
    var TOOLS = [
        { modal: 'agsl-modal', title: 'Vytyčení přímky', src: '#agsl-live' },
        {
            modal: 'ag-pdr-modal', title: 'Krokový offset', vals: [
                { l: 'Kroky', s: '#ag-pdr-steps' },
                { l: 'Vzdálenost', s: '#ag-pdr-dist' },
                { l: 'Směr', s: '#ag-pdr-head' }
            ]
        }
    ];

    var _cur = null;        // právě sbalený nástroj {cfg, modal}
    var _timer = null;
    var _lastHtml = '';

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }

    // ---- styly -----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('ag-mini-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-mini-style';
        st.textContent = [
            // sbalený modál: zůstává „otevřený" (běží mu smyčka), jen není vidět
            '.modal-overlay.' + HIDE_CLS + '{opacity:0 !important;visibility:hidden !important;pointer-events:none !important;}',
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
            // tlačítko „Sbalit" v hlavičce nástroje
            '.ag-mini-btn{margin:-2px 0 10px auto;display:flex;align-items:center;gap:6px;padding:7px 12px;cursor:pointer;',
            '  border-radius:999px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:var(--surface-2,rgba(255,255,255,0.07));color:var(--text-color,#eceef2);',
            '  font:600 11.5px/1 var(--font-ui,system-ui);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- čtení živých hodnot ze (skrytého) modálu -------------------------------
    function readVals(cfg, modal) {
        var out = [];
        if (cfg.vals) {
            for (var i = 0; i < cfg.vals.length && out.length < MAX_VALS; i++) {
                var v = txt(modal.querySelector(cfg.vals[i].s));
                if (v) out.push({ l: cfg.vals[i].l, v: v });
            }
            return out;
        }
        var src = modal.querySelector(cfg.src || (modal.getAttribute('data-ag-mini-src') || ''));
        if (!src) return out;
        // řádky typu <div><span>Popisek</span><b>hodnota</b></div>
        var rows = src.querySelectorAll('div');
        for (var j = 0; j < rows.length && out.length < MAX_VALS; j++) {
            var b = rows[j].querySelector('b');
            if (!b) continue;
            var lab = txt(rows[j].querySelector('span')) || '';
            var val = txt(b);
            if (!val) continue;
            out.push({ l: lab.replace(/:$/, ''), v: val, c: (b.style && b.style.color) || '' });
        }
        if (!out.length) { var t = txt(src); if (t) out.push({ l: '', v: t.slice(0, 42) }); }
        return out;
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
        _cur = { modal: modal, cfg: cfg };
        _lastHtml = '';
        modal.classList.add(HIDE_CLS);
        bar().classList.add('on');
        paint();
        if (!_timer) _timer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 500);
        try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
    }
    function expand() {
        if (!_cur) { bar().classList.remove('on'); return; }
        _cur.modal.classList.remove(HIDE_CLS);
        // nástroj mohl být mezitím zavřený jinudy — pak ho zase otevřeme
        if (_cur.modal.style.display !== 'flex') _cur.modal.style.display = 'flex';
        _cur = null;
        bar().classList.remove('on');
        stop();
    }
    function closeTool() {
        if (!_cur) return;
        var m = _cur.modal;
        m.classList.remove(HIDE_CLS);
        // Zavřít nástroj jeho VLASTNÍM tlačítkem — nástroje si při zavření uklízejí
        // časovače a rozdělaný stav; pouhé display:none by je nechalo běžet.
        var btn = null, bs = m.querySelectorAll('button');
        for (var i = 0; i < bs.length; i++) {
            var t = (bs[i].textContent || '').trim().toLowerCase();
            if (t === 'zavřít' || t === 'zpět' || t === 'hotovo') { btn = bs[i]; break; }
        }
        _cur = null;
        bar().classList.remove('on');
        stop();
        if (btn) btn.click(); else m.style.display = 'none';
    }
    function stop() { if (_timer) { (window.AG && AG.clearUiInterval ? AG.clearUiInterval : clearInterval)(_timer); _timer = null; } }

    function tick() {
        if (!_cur) { stop(); return; }
        // nástroj zavřel někdo jiný (např. tlačítkem uvnitř) → proužek zmizí taky
        if (!document.body.contains(_cur.modal) || _cur.modal.style.display !== 'flex') {
            _cur.modal.classList.remove(HIDE_CLS);
            _cur = null; bar().classList.remove('on'); stop(); return;
        }
        paint();
    }

    // ---- tlačítko „Sbalit" do hlavičky nástroje -------------------------------------
    function cfgFor(modal) {
        for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].modal === modal.id) return TOOLS[i];
        var t = modal.getAttribute('data-ag-mini');
        if (t) return { modal: modal.id, title: t, src: modal.getAttribute('data-ag-mini-src') || '' };
        return null;
    }
    function ensureBtn(modal) {
        if (!modal || modal.querySelector('.ag-mini-btn')) return;
        var cfg = cfgFor(modal); if (!cfg) return;
        var content = modal.querySelector('.modal-content'); if (!content) return;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ag-mini-btn';
        b.innerHTML = '▾ Sbalit — nechat běžet nahoře';
        b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); collapse(modal, cfg); });
        var h = content.querySelector('h3, h2');
        if (h && h.nextSibling) content.insertBefore(b, h.nextSibling);
        else content.insertBefore(b, content.firstChild);
    }
    // nástroje si modály staví až při prvním otevření → hlídáme, kdy se objeví
    function scan() {
        for (var i = 0; i < TOOLS.length; i++) {
            var m = document.getElementById(TOOLS[i].modal);
            if (m) ensureBtn(m);
        }
        var opt = document.querySelectorAll('.modal-overlay[data-ag-mini]');
        for (var j = 0; j < opt.length; j++) ensureBtn(opt[j]);
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
        collapse: function (id) { var m = document.getElementById(id); if (m) { var c = cfgFor(m); if (c) collapse(m, c); } },
        expand: expand,
        get active() { return _cur ? _cur.cfg.modal : null; }
    };
})();
