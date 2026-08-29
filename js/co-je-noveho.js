// ===== AR Geodet — CO JE NOVÉHO (roletka u lišty „Nová verze“) ==================
// K liště #update-banner přidá druhé tlačítko „Co je nového“, které rozbalí soupis
// změn čekající verze. Klepnutí na text lišty dělá dál totéž co dřív (applyUpdate),
// takže kdo aktualizaci jen odklepne, nic navíc neřeší.
//
// Odpojitelná vrstva: needituje logika.js ani grafika.js.
// Odstranění: smaž tenhle soubor + řádek <script> v index.html, řádky
// './js/co-je-noveho.js' a './data/co-je-noveho.json' v sw.js a data/co-je-noveho.json.
//
// ⚠ PROČ SE SOUPIS TAHÁ S RAZÍTKEM (`?t=`): service worker má na vlastní soubory
// CACHE-FIRST (viz sw.js). Kdyby se data/co-je-noveho.json načetlo normálně,
// dostali bychom STAROU verzi souboru z cache běžící verze — tedy přesně ten
// soupis, který uživatel už zná, a NE změny té verze, co čeká. Razítko v adrese
// dělá jinou URL, takže `caches.match` mine a jde se na síť.
// ================================================================================
(function () {
    'use strict';

    var URL_DATA = './data/co-je-noveho.json';
    var STYLE_ID = 'ag-cjn-style';
    var BOX_ID = 'ag-cjn-box';
    var BTN_ID = 'ag-cjn-btn';
    var K_SEEN = 'agCjnSeen';          // číslo verze, jejíž soupis už uživatel viděl

    var _data = null, _loading = false;

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    // Verze, která TEĎ běží. Bere se z `css/style.css?v=NNN` v index.html — to číslo
    // propisuje scripts/gen_sw_assets.py ze SHELL_CACHE, takže sedí se sw.js.
    function running() {
        try {
            var l = document.querySelector('link[rel="stylesheet"][href*="css/style.css?v="]');
            if (l) {
                var m = (l.getAttribute('href') || '').match(/\?v=(\d+)/);
                if (m) return parseInt(m[1], 10);
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'co-je-noveho:running'); }
        return null;
    }

    function load() {
        if (_data) return Promise.resolve(_data);
        if (_loading) return Promise.resolve(null);
        _loading = true;
        return fetch(URL_DATA + '?t=' + Date.now(), { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                _loading = false;
                _data = (j && Array.isArray(j.verze)) ? j : null;
                return _data;
            })
            .catch(function () { _loading = false; return null; });
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // tlačítko uvnitř lišty — vizuálně oddělené, ale pořád součást pilulky
            '#' + BTN_ID + '{margin-left:4px;flex:none;display:inline-flex;align-items:center;gap:5px;',
            '  padding:5px 10px;border-radius:999px;cursor:pointer;white-space:nowrap;',
            '  border:1px solid rgba(255,255,255,0.35);background:rgba(255,255,255,0.14);color:inherit;',
            '  font:600 calc(11.5px * var(--ag-font-scale, 1))/1 var(--font-ui,system-ui),sans-serif;}',
            '#' + BTN_ID + ' svg{width:11px;height:11px;transition:transform .18s var(--ease-out,ease);}',
            '#' + BTN_ID + '.on svg{transform:rotate(180deg);}',
            // vlastní roletka visí POD lištou, ve stejné ose
            '#' + BOX_ID + '{position:fixed;left:50%;transform:translateX(-50%);',
            '  z-index:1000003;width:max-content;max-width:calc(100vw - 20px);',
            '  max-height:56vh;overflow:auto;-webkit-overflow-scrolling:touch;box-sizing:border-box;',
            '  padding:14px 16px;border-radius:var(--r-lg,16px);',
            '  background:var(--modal-bg,rgba(14,18,24,0.97));color:var(--text-color,#eceef2);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));box-shadow:var(--shadow-2,0 10px 30px rgba(0,0,0,0.55));}',
            '#' + BOX_ID + ' h4{margin:0 0 2px;font:700 calc(13.5px * var(--ag-font-scale, 1))/1.25 var(--font-display,system-ui),sans-serif;color:var(--accent,#2f9e74);}',
            '#' + BOX_ID + ' .cjn-v{margin:0 0 10px;font:400 calc(11px * var(--ag-font-scale, 1))/1.2 var(--font-mono,monospace);color:var(--text-muted,#9aa1ac);}',
            '#' + BOX_ID + ' ul{margin:0 0 14px;padding-left:18px;}',
            '#' + BOX_ID + ' li{margin:0 0 6px;font:400 calc(12.5px * var(--ag-font-scale, 1))/1.45 var(--font-ui,system-ui),sans-serif;}',
            '#' + BOX_ID + ' li:last-child{margin-bottom:0;}',
            '#' + BOX_ID + ' .cjn-note{margin:0;font:400 calc(11.5px * var(--ag-font-scale, 1))/1.4 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '#' + BOX_ID + ' .cjn-go{display:block;width:100%;margin-top:12px;padding:11px;border-radius:var(--r-md,12px);cursor:pointer;',
            '  border:none;background:var(--accent-grad,var(--accent,#2f9e74));color:#fff;',
            '  font:600 calc(13.5px * var(--ag-font-scale, 1))/1 var(--font-ui,system-ui),sans-serif;}'
        ].join('');
        document.head.appendChild(st);
    }

    function closeBox() {
        var b = document.getElementById(BOX_ID);
        if (b && b.parentNode) b.parentNode.removeChild(b);
        var btn = document.getElementById(BTN_ID);
        if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); }
    }

    // Soupis pro CHYSTANOU verzi: všechno, co je novější než běžící verze. Když
    // se běžící verzi nepodaří zjistit (nebo je soubor starší), ukáže se aspoň
    // nejnovější záznam — prázdná roletka by byla horší než hrubý odhad.
    function entriesFor(data) {
        var cur = running();
        var all = data.verze.slice().sort(function (a, b) { return (b.v || 0) - (a.v || 0); });
        if (cur == null) return all.slice(0, 1);
        var out = all.filter(function (x) { return (x.v || 0) > cur; });
        return out.length ? out.slice(0, 5) : all.slice(0, 1);
    }

    function openBox() {
        injectStyles();
        var banner = document.getElementById('update-banner');
        if (!banner) return;
        var box = document.createElement('div');
        box.id = BOX_ID;
        box.innerHTML = '<p class="cjn-note">Načítám…</p>';
        document.body.appendChild(box);
        place();

        load().then(function (data) {
            if (!document.getElementById(BOX_ID)) return;
            if (!data) {
                box.innerHTML = '<p class="cjn-note">Soupis změn se nepodařilo stáhnout — zkus to po obnovení, nebo bez signálu prostě aktualizuj.</p>';
                place();
                return;
            }
            var list = entriesFor(data);
            box.innerHTML = list.map(function (e) {
                return '<h4>' + esc(e.nadpis || ('Verze ' + e.v)) + '</h4>' +
                    '<p class="cjn-v">v' + esc(e.v) + (e.datum ? ' · ' + esc(e.datum) : '') + '</p>' +
                    '<ul>' + (e.body || []).map(function (b) {
                        // <b> a <i> v textu jsou záměrné (zvýraznění názvu nástroje),
                        // proto se escapuje jen to, co by mohlo rozbít strukturu
                        return '<li>' + String(b).replace(/<(?!\/?(b|i|u)>)/g, '&lt;') + '</li>';
                    }).join('') + '</ul>';
            }).join('') +
                '<button type="button" class="cjn-go">Aktualizovat teď</button>';
            try { localStorage.setItem(K_SEEN, String(list[0] && list[0].v || '')); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'co-je-noveho:openBox'); }
            box.querySelector('.cjn-go').onclick = function () {
                closeBox();
                try { if (typeof applyUpdate === 'function') applyUpdate(); } catch (e3) { window.AG && AG.swallow && AG.swallow(e3, 'co-je-noveho:onclick'); }
            };
            place();
        });
    }

    // Roletka se drží pod lištou — ta má proměnnou výšku (bezpečná zóna nahoře,
    // velikost písma), takže se pozice počítá z její skutečné pozice, ne natvrdo.
    function place() {
        var box = document.getElementById(BOX_ID);
        var banner = document.getElementById('update-banner');
        if (!box || !banner) return;
        var r = banner.getBoundingClientRect();
        box.style.top = Math.round(r.bottom + 8) + 'px';
    }

    function toggle(e) {
        try { e.stopPropagation(); e.preventDefault(); } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'co-je-noveho:toggle'); }
        var btn = document.getElementById(BTN_ID);
        if (document.getElementById(BOX_ID)) { closeBox(); return; }
        if (btn) { btn.classList.add('on'); btn.setAttribute('aria-expanded', 'true'); }
        openBox();
    }

    // Tlačítko se přidá, jakmile se lišta poprvé ukáže. Lišta se vyrábí v index.html
    // a zobrazuje ji showUpdateBanner() z logika.js, takže se jen hlídá její stav.
    function ensureBtn() {
        var banner = document.getElementById('update-banner');
        if (!banner) return;
        if (getComputedStyle(banner).display === 'none') { closeBox(); return; }
        if (document.getElementById(BTN_ID)) return;
        injectStyles();
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = BTN_ID;
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = 'Co je nového<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
        // POZOR: lišta má onclick=applyUpdate() na SOBĚ, takže klik z tlačítka
        // nesmí probublat — jinak by „Co je nového" appku rovnou reloadlo.
        btn.addEventListener('click', toggle);
        banner.appendChild(btn);
    }

    function init() {
        ensureBtn();
        // Lišta se objeví až když service worker ohlásí čekající verzi (může to být
        // za minuty i hodiny). Hlídá se levně: MutationObserver na atribut style
        // + jeden záložní tik, kdyby ji někdo zobrazil jinak než přes style.
        try {
            var banner = document.getElementById('update-banner');
            if (banner && window.MutationObserver) {
                new MutationObserver(ensureBtn).observe(banner, { attributes: true, attributeFilter: ['style', 'class'] });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'co-je-noveho:init'); }
        (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(ensureBtn, 5000);
        window.addEventListener('resize', place);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGCoJeNoveho = { open: openBox, close: closeBox };
})();
