// ===== AR Geodet — HISTORIE AKTUALIZACÍ (odpojitelná vrstva) ====================
// Prohlížitelný soupis toho, co se v appce kdy změnilo nebo přibylo. Otevírá se
// z „Více" a z Nastavení → Údržba → Aplikace. Je to čtení pro zajímavost, ne
// nástroj do terénu — proto nemá dlaždici v Nástrojích ani sloveso v registru.
//
// ⚠ VĚDOMĚ NEVYRÁBÍ DRUHÝ CHANGELOG. Data bere z `data/co-je-noveho.json`, tedy
// z TÉHOŽ souboru, který používá roletka „Co je nového" u lišty s novou verzí
// (js/co-je-noveho.js). Rozdíl je v záběru: roletka ukazuje jen to, co přinese
// verze, která PRÁVĚ ČEKÁ na instalaci; tenhle modul ukáže všechno odspodu.
// Kdyby vznikly dva soupisy, začaly by se rozcházet — proto jeden soubor.
//
// ⚠ FETCH JE ZÁMĚRNĚ BEZ RAZÍTKA `?t=`, na rozdíl od js/co-je-noveho.js. Ten
// razítko potřebuje, protože se ptá na soupis verze, kterou uživatel ještě nemá,
// a musí obejít cache. Historie naopak MÁ fungovat i bez signálu, takže se nechá
// obsloužit ze service workeru (cache-first) — v terénu bez dat je to k dispozici.
//
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + řádek
// './js/historie-aktualizaci.js' v sw.js. `data/co-je-noveho.json` NECHAT —
// patří roletce u lišty.
// ================================================================================
(function () {
    'use strict';
    if (window.AGHistorie) return;

    var URL_DATA = './data/co-je-noveho.json';
    var _ov = null, _data = null, _err = false;

    // <b>, <i> a <u> v textu jsou záměrné (zvýraznění názvu nástroje) — escapuje se
    // jen to, co by mohlo rozbít strukturu. Stejné pravidlo má js/co-je-noveho.js.
    function safe(s) { return String(s == null ? '' : s).replace(/<(?!\/?(b|i|u)>)/g, '&lt;'); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    // Verze, která TEĎ běží: číslo z `css/style.css?v=NNN` v index.html, které tam
    // ze SHELL_CACHE propisuje scripts/gen_sw_assets.py. Stejný postup jako
    // v js/co-je-noveho.js — ať obě okna mluví o téže verzi.
    function running() {
        try {
            var l = document.querySelector('link[rel="stylesheet"][href*="css/style.css?v="]');
            var m = l && (l.getAttribute('href') || '').match(/\?v=(\d+)/);
            if (m) return parseInt(m[1], 10);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'historie-aktualizaci:running'); }
        return null;
    }

    function load() {
        if (_data) return Promise.resolve(_data);
        return fetch(URL_DATA)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                _data = (j && Array.isArray(j.verze)) ? j.verze.slice() : null;
                if (_data) _data.sort(function (a, b) { return (b.v || 0) - (a.v || 0); });
                return _data;
            })
            .catch(function () { _err = true; return null; });
    }

    function injectStyles() {
        if (document.getElementById('ag-hist-style')) return;
        var s = document.createElement('style'); s.id = 'ag-hist-style';
        s.textContent = [
            /* stejný celoobrazovkový shell jako ostatní okna modulů (css/predpisy.css) */
            '.hist-ov{position:fixed;top:0;left:0;right:0;width:100%;height:var(--app-vh,100dvh);',
            '  z-index:var(--z-overlay,1000000);display:none;justify-content:center;align-items:center;',
            '  background:rgba(0,0,0,0.55);}',
            '.hist-ov.open{display:flex;}',
            '.hist-sheet{width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;',
            '  background:var(--modal-bg,rgba(14,18,24,0.97));color:var(--text-color,#eceef2);}',
            '.hist-head{display:flex;align-items:center;gap:11px;flex:0 0 auto;',
            '  padding:calc(14px + env(safe-area-inset-top,0px)) 16px 12px;',
            '  border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.10));}',
            '.hist-head .icon{width:22px;height:22px;color:var(--accent,#2f9e74);flex:0 0 auto;}',
            '.hist-t{font-family:var(--font-display,system-ui);font-weight:700;',
            '  font-size:calc(18px * var(--ag-font-scale,1));letter-spacing:-0.3px;}',
            '.hist-s{font-size:calc(12px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);margin-top:1px;}',
            '.hist-x{margin-left:auto;flex:0 0 auto;width:38px;height:38px;border-radius:50%;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.10));background:var(--surface-1,rgba(255,255,255,0.06));',
            '  color:var(--text-color,#eceef2);font-size:20px;line-height:1;}',
            '.hist-x:active{transform:scale(0.94);}',
            '.hist-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;',
            '  padding:16px 16px calc(22px + env(safe-area-inset-bottom,0px));}',
            /* časová osa: svislá linka a puntík u každé verze */
            '.hist-e{position:relative;padding:0 0 20px 40px;}',
            '.hist-e::before{content:"";position:absolute;left:11px;top:16px;bottom:-4px;width:2px;',
            '  background:var(--glass-border,rgba(255,255,255,0.10));}',
            '.hist-e:last-of-type::before{display:none;}',   /* posledni ditě je poznamka <p>, ne .hist-e */
            '.hist-e::after{content:"";position:absolute;left:6px;top:7px;width:12px;height:12px;border-radius:50%;',
            '  background:var(--bg-elev,#171b20);border:2px solid var(--text-faint,#6b727d);}',
            '.hist-e.now::after{border-color:var(--accent-bright,#3eb487);background:var(--accent-bright,#3eb487);',
            '  box-shadow:0 0 0 4px var(--accent-soft,rgba(47,158,116,0.14));}',
            '.hist-m{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:3px;}',
            '.hist-v{font-family:var(--font-mono,monospace);font-size:calc(11px * var(--ag-font-scale,1));',
            '  font-weight:700;color:var(--data,#e6bd76);}',
            '.hist-d{font-family:var(--font-mono,monospace);font-size:calc(10.5px * var(--ag-font-scale,1));',
            '  color:var(--text-faint,#6b727d);}',
            /* členění po dnech: nadpisem je DATUM, verze se schovaly dolů pod den */
            '.hist-d2{font-family:var(--font-display,system-ui);font-weight:700;',
            '  font-size:calc(13px * var(--ag-font-scale,1));color:var(--accent-bright,#3eb487);',
            '  letter-spacing:-0.2px;}',
            '.hist-cnt{font-family:var(--font-mono,monospace);font-size:calc(10.5px * var(--ag-font-scale,1));',
            '  color:var(--text-faint,#6b727d);}',
            '.hist-vv{margin-top:7px;font-family:var(--font-mono,monospace);',
            '  font-size:calc(10px * var(--ag-font-scale,1));color:var(--text-faint,#6b727d);}',
            '.hist-e h3.hist-h + ul{margin-bottom:10px;}',
            '.hist-now{font-size:calc(10px * var(--ag-font-scale,1));font-weight:700;letter-spacing:0.06em;',
            '  text-transform:uppercase;color:var(--accent-bright,#3eb487);',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.42));border-radius:999px;padding:1px 7px;}',
            '.hist-h{font-family:var(--font-display,system-ui);font-weight:700;',
            '  font-size:calc(14.5px * var(--ag-font-scale,1));line-height:1.3;margin:0 0 5px;}',
            '.hist-e ul{margin:0;padding-left:17px;}',
            '.hist-e li{margin:0 0 5px;font-size:calc(13px * var(--ag-font-scale,1));line-height:1.5;',
            '  color:var(--text-color,#eceef2);}',
            '.hist-e li:last-child{margin-bottom:0;}',
            '.hist-note{margin:2px 0 18px;font-size:calc(12.5px * var(--ag-font-scale,1));line-height:1.5;',
            '  color:var(--text-muted,#9aa1ac);}',
            '.hist-foot{margin:6px 0 0;padding-top:14px;border-top:1px solid var(--glass-border,rgba(255,255,255,0.10));',
            '  font-size:calc(11.5px * var(--ag-font-scale,1));line-height:1.5;color:var(--text-faint,#6b727d);}'
        ].join('');
        document.head.appendChild(s);
    }

    // ---- členění po dnech -----------------------------------------------------------
    var MESICE = ['ledna', 'února', 'března', 'dubna', 'května', 'června',
        'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
    var DNY = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
    // '2026-08-29' -> 'sobota 29. srpna 2026'. Když datum chybí nebo je v jiném tvaru,
    // vrací se, co přišlo — soupis se píše ručně a jeden překlep nesmí shodit okno.
    function denTxt(d) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
        if (!m) return d || 'bez data';
        var dt = new Date(+m[1], +m[2] - 1, +m[3]);
        if (isNaN(dt.getTime())) return d;
        var den = DNY[dt.getDay()];
        // velké písmeno JEN na začátku — `text-transform:capitalize` by v CSS udělalo
        // i „Srpna", což je česky špatně
        return den.charAt(0).toUpperCase() + den.slice(1) + ' ' + (+m[3]) + '. ' + MESICE[+m[2] - 1] + ' ' + m[1];
    }
    function groupByDay(list) {
        var out = [], byDay = {};
        for (var i = 0; i < list.length; i++) {
            var e = list[i], d = e.datum || '';
            var g = byDay[d];
            if (!g) { g = byDay[d] = { datum: d, polozky: [], verze: [], zmeny: [] }; out.push(g); }
            g.polozky.push(e);
            g.verze.push(e.v);
            // počet změn dne = kolik odrážek ten den celkem přibylo (ne kolik vydání)
            g.zmeny = g.zmeny.concat(e.body || []);
        }
        return out;
    }

    function render() {
        var body = _ov.querySelector('.hist-body');
        var sub = _ov.querySelector('.hist-s');
        if (!_data || !_data.length) {
            body.innerHTML = '<p class="hist-note">' + (_err
                ? 'Soupis změn se nepodařilo načíst. Zkus to znovu, až budeš mít signál — pak zůstane k dispozici i offline.'
                : 'Načítám…') + '</p>';
            return;
        }
        var cur = running();
        // „Tady jsi" patří NEJNOVĚJŠÍ verzi, která není novější než ta běžící. Přesnou
        // shodu hledat nelze: soupis se píše ručně a ne každá verze v něm má záznam.
        var nowV = null;
        if (cur != null) {
            for (var i = 0; i < _data.length; i++) {
                if ((_data[i].v || 0) <= cur) { nowV = _data[i].v; break; }
            }
        }
        // ⚠ ČLENĚNÍ PO DNECH, NE PO VERZÍCH (na přání 29. 8. 2026: „aktualizace bych
        // nepsal po verzích, ale po dnech"). Číslo vydání nikomu nic neříká a v jednom
        // dni jich bývá i devatenáct (9. 8. 2026) — soupis pak vypadá jako výpis z
        // gitu. Den je to, co si člověk pamatuje („co přibylo tenhle týden"), takže
        // nadpis nese DATUM a verze zůstávají jen jako drobná stopa u jednotlivých
        // změn. Pořadí dnů drží pořadí dat (soupis je setříděný podle verze sestupně,
        // což je zároveň sestupně podle času).
        var dny = groupByDay(_data);
        sub.textContent = dny.length + (dny.length === 1 ? ' den' : (dny.length < 5 ? ' dny' : ' dnů'))
            + ' · ' + _data.length + ' změn' + (cur != null ? ' · běžíš na verzi ' + cur : '');
        body.innerHTML =
            '<p class="hist-note">Co se v appce kdy změnilo nebo přibylo, den po dni. Psané ručně, takže tu nejsou úplně všechny drobnosti — jen to, co je na appce vidět.</p>' +
            dny.map(function (d) {
                var isNow = d.verze.indexOf(nowV) !== -1;
                return '<div class="hist-e' + (isNow ? ' now' : '') + '">' +
                    '<div class="hist-m"><span class="hist-d2">' + esc(denTxt(d.datum)) + '</span>' +
                    '<span class="hist-cnt">' + d.zmeny.length + '×</span>' +
                    (isNow ? '<span class="hist-now">tady jsi</span>' : '') + '</div>' +
                    d.polozky.map(function (e) {
                        return '<h3 class="hist-h">' + esc(e.nadpis || ('Verze ' + e.v)) + '</h3>' +
                            '<ul>' + (e.body || []).map(function (b) {
                                return '<li>' + safe(b) + '</li>';
                            }).join('') + '</ul>';
                    }).join('') +
                    '<div class="hist-vv">verze ' + d.verze.map(function (v) { return esc(v); }).join(', ') + '</div>' +
                    '</div>';
            }).join('') +
            '<p class="hist-foot">U každého dne je vidět, kolik změn ten den přišlo; čísla vydání jsou dole u dne, ' +
            'kdyby je bylo potřeba dohledat. Když čeká nová verze, ukáže se nahoře lišta a u ní roletka „Co je nového“.</p>';
    }

    function build() {
        if (_ov) return _ov;
        injectStyles();
        _ov = document.createElement('div');
        _ov.className = 'hist-ov';
        _ov.innerHTML =
            '<div class="hist-sheet" role="dialog" aria-modal="true" aria-label="Historie aktualizací">' +
            '  <div class="hist-head"><svg class="icon"><use href="#i-file-text"/></svg>' +
            '    <div><div class="hist-t">Historie aktualizací</div><div class="hist-s"></div></div>' +
            '    <button type="button" class="hist-x" aria-label="Zavřít">&times;</button></div>' +
            '  <div class="hist-body"></div>' +
            '</div>';
        document.body.appendChild(_ov);
        _ov.querySelector('.hist-x').addEventListener('click', close);
        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov) close(); });
        document.addEventListener('keydown', function (e) {
            if (_ov.classList.contains('open') && e.key === 'Escape') { e.preventDefault(); close(); }
        });
        return _ov;
    }

    function open() {
        build();
        _ov.classList.add('open');
        render();
        if (!_data) load().then(function () { if (_ov.classList.contains('open')) render(); });
    }
    function close() { if (_ov) _ov.classList.remove('open'); }

    // ---- vstupy ----------------------------------------------------------------
    // „Více" (#side-menu). Tlačítko patří za „O aplikaci" — obojí je o appce samotné.
    function injectMenu() {
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('hist-menu-btn')) return;
        var host = menu.querySelector('.menu-scroll') || menu;
        var btn = document.createElement('button');
        btn.id = 'hist-menu-btn'; btn.className = 'menu-btn'; btn.type = 'button';
        btn.innerHTML = '<svg class="icon"><use href="#i-file-text"/></svg> Historie aktualizací';
        btn.addEventListener('click', function () {
            open();
            // toggleMenu() PŘEPÍNÁ — kdyby se sem někdo dostal jinak než z otevřeného
            // panelu, zavřením by ho naopak otevřel. Proto se zavírá jen když je otevřený.
            try {
                if (typeof toggleMenu === 'function' && menu.classList.contains('open')) toggleMenu();
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'historie-aktualizaci:injectMenu'); }
        });
        var after = null, all = host.querySelectorAll('.menu-btn');
        for (var i = 0; i < all.length; i++) {
            if ((all[i].getAttribute('onclick') || '').indexOf('openAbout') >= 0) { after = all[i]; break; }
        }
        if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
        else host.appendChild(btn);
    }

    // Nastavení → Údržba, sekce „Aplikace" (za tlačítko, které otevírá „Více").
    function injectSettings() {
        var tab = document.getElementById('tab-udrzba');
        if (!tab || document.getElementById('hist-set-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'hist-set-btn'; btn.type = 'button'; btn.className = 'btn btn-secondary';
        btn.innerHTML = '<svg class="icon"><use href="#i-file-text"/></svg> Historie aktualizací — co v appce přibylo';
        btn.addEventListener('click', function () {
            // Nastavení se musí zavřít, jinak by leželo přes okno historie —
            // stejně to dělá i tlačítko „Více" hned vedle.
            var m = document.getElementById('settings-modal');
            if (m) m.style.display = 'none';
            open();
        });
        var after = null, all = tab.querySelectorAll('button');
        for (var i = 0; i < all.length; i++) {
            if ((all[i].getAttribute('onclick') || '').indexOf('toggleMenu') >= 0) { after = all[i]; break; }
        }
        if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
        else tab.appendChild(btn);
    }

    function init() {
        injectMenu();
        injectSettings();
        // PŘEDNAČTENÍ. Naměřeno v prohlížeči: když se okno otevře krátce po startu,
        // stihne se v něm vteřiny ukazovat „Načítám…" — fetch stojí ve frontě za
        // dlaždicemi mapy a dotazy na ČÚZK. Soubor má ~13 kB a service worker ho má
        // v cache (cache-first), takže tohle je prakticky zadarmo a okno se pak
        // otevře rovnou plné. Až v klidu po startu, ať se nepřidává k té frontě.
        var pre = function () { try { load(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'historie-aktualizaci:pre'); } };
        if (window.requestIdleCallback) window.requestIdleCallback(pre, { timeout: 8000 });
        else setTimeout(pre, 6000);
        // Oba hostitelé se za běhu přestavují (oprávnění v js/ucty.js schovávají části
        // Nastavení, moduly si do „Více" přisypávají vlastní tlačítka), takže se
        // přítomnost levně překontroluje. Bez tiku by tlačítko po přestavbě zmizelo.
        (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
            try { injectMenu(); injectSettings(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'historie-aktualizaci:pre'); }
        }, 4000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.agOpenHistorie = open;
    window.AGHistorie = { open: open, close: close };
})();
