// ===== QTRIG — CO JE V PRO: přehled Základ × Pro + znak Pro (ODPOJITELNÁ vrstva) ==
// Uživatel (11. 9. 2026): „Nevidím, co je ta Pro verze a co je základní. Nikde
// není shrnutí rozdílů, nějaká lákací nabídka pro lidi, aby si to třeba koupili."
// A: „jakmile bude appka Pro, mohl by se trochu upravit vizuál, aby to bylo na
// pohled vidět." Tenhle modul dělá obojí a NIC jiného:
//
//   ① PŘEHLED — celoobrazovkové okno „Základ × Pro": dvě karty nahoře (co umí
//      Základ zdarma, co přidá Pro) a pod nimi tabulka všech nástrojů po slovesech
//      se sloupci Základ / Pro. Vstup: řádek „Co je v Pro" v menu Více
//      a window.AGProPrehled.open() (může zavolat karta Pro v js/pro-zamky.js).
//   ② ZNAK PRO — kdo Pro má, vidí to na pohled: body.ag-pro, zlatá pilulka „PRO"
//      v nadpisu Nástrojů a v hlavičce menu Více, tenký zlatý obrys na tlačítku
//      Nástroje v doku. Accent barva se NEMĚNÍ (řídí čitelnost v celé appce).
//
// ⚠ OBSAH SE SKLÁDÁ Z REGISTRU (window.AGReg.all()), NE Z RUČNÍHO VÝČTU.
//   Dělicí čára Základ/Pro je pole `pro: 1` v js/tools-registry.js a právě se
//   mění. Ruční seznam by zastaral první den — takhle přehled ukazuje vždycky
//   to, co zámky (js/pro-zamky.js) skutečně zamykají. Položky rozcestníků
//   (`inhub`) stojí pod svým rozcestníkem, `hidden` a `notile` se vynechávají
//   (nejsou to nástroje, které by kdo v Nástrojích našel).
//
// ⚠ TŘÍDA ag-pro SE PŘEPÍNÁ TADY, tik 5 s + událost 'aglic:zmena' z js/licence.js.
//   Modul smí jet v odkládací frontě (ag/lazy) — než doběhne, je tlačítko v doku
//   pár vteřin bez obrysu, což nikomu neublíží. Kdyby to mělo být hned od
//   prvního obrazu, patří přepnutí třídy do js/licence.js (6 řádků, viz výstup
//   z 11. 9. 2026), ne sem.
//
// ⚠ VSTUP V MENU JE SCHVÁLNĚ MIMO ZÁLOŽKY NASTAVENÍ I MIMO .tool-grid — obojí
//   umí schovat applyPerms() podle role (tatáž past už spolkla „Napsat autorovi").
//
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + './js/pro-prehled.js'
// v sw.js. Bez něj zůstane karta Pro (js/pro-zamky.js) jediným místem, kde se o Pro mluví.
// ================================================================================
(function () {
    'use strict';
    if (window.AGProPrehled) return;

    var STYLE_ID = 'ag-prehled-style', MODAL_ID = 'ag-prehled-modal', MENU_ID = 'ag-prehled-menu-btn';
    var ADRESA_PRO = './pro/';       // stejně jako js/pro-zamky.js — relativně, kvůli Pages v podadresáři
    var DALSI = 'Další nástroje';    // záchytná skupina pro záznam bez slovesa (jako v seznamu úkonů)
    var IKONA = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.6 6.2L21 9l-5 4.4L17.5 21 12 17.6 6.5 21 8 13.4 3 9l6.4-.8z"/></svg>';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'pro-prehled:' + kde); } catch (x) { } }
    function esc(s) {
        if (window.AG && AG.esc) return AG.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function maPro() { try { return !!(window.AGLic && AGLic.isPro()); } catch (e) { return false; } }
    function jeZaklad() { try { return !!(window.AGLic && AGLic.vydani && AGLic.vydani() === 'zaklad'); } catch (e) { return false; } }

    // ---- vzhled ------------------------------------------------------------------
    function styly() {
        if (document.getElementById(STYLE_ID)) return;
        try {
            var st = document.createElement('style');
            st.id = STYLE_ID;
            var M = '#' + MODAL_ID;
            st.textContent = [
                // ② znak Pro — vše jen pod body.ag-pro, v Základu se nepřidává nic
                '.ag-pro-pill{display:none;}',
                'body.ag-pro .ag-pro-pill{display:inline-block;vertical-align:middle;margin-left:8px;padding:2px 7px 1px;',
                '  border-radius:999px;background:linear-gradient(135deg,#f0cf85,#d8a54a);color:#1b1406;',
                '  font:700 11px/1.4 var(--font-ui,system-ui,sans-serif);letter-spacing:.12em;font-style:normal;}',
                'body.ag-pro #dock-nastroje-btn,body.ag-pro #dock .dock-btn[onclick*="tools-modal"]{',
                '  box-shadow:inset 0 0 0 1.5px rgba(230,189,118,.9),var(--shadow-1,0 2px 8px rgba(0,0,0,.25));}',
                // ① okno — celoobrazovkové jako ostatní okna modulů, barvy podle #ag-pro-modal
                M + '{position:fixed;inset:0;z-index:100055;display:none;flex-direction:column;',
                '  background:var(--modal-bg,rgba(14,18,24,.97));color:var(--text-color,#e9eef7);',
                '  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);',
                '  padding:calc(env(safe-area-inset-top,0px) + 14px) max(16px,env(safe-area-inset-right,0px))',
                '  calc(env(safe-area-inset-bottom,0px) + 12px) max(16px,env(safe-area-inset-left,0px));}',
                M + '.on{display:flex;}',
                'body.light-mode ' + M + '{background:#fff;color:#16202e;}',
                M + ' .agpp-head{display:flex;align-items:center;gap:10px;flex:0 0 auto;margin-bottom:8px;}',
                M + ' h2{margin:0;flex:1 1 auto;font-family:var(--font-display,inherit);font-weight:700;',
                '  font-size:calc(20px * var(--ag-font-scale,1));color:var(--accent,#2f9e74);}',
                M + ' .agpp-x{flex:0 0 auto;width:38px;height:38px;border-radius:50%;border:1px solid var(--glass-border,rgba(255,255,255,.14));',
                '  background:rgba(255,255,255,.06);color:inherit;font-size:22px;line-height:1;cursor:pointer;}',
                M + ' .agpp-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;',
                '  font-size:calc(13.5px * var(--ag-font-scale,1));line-height:1.45;}',
                // karty vedle sebe až od 520 px; na telefonu pod sebou (dva sloupce po 170 px lámou každou položku na tři řádky)
                M + ' .agpp-karty{display:grid;grid-template-columns:1fr;gap:9px;margin-bottom:12px;}',
                '@media (min-width:520px){' + M + ' .agpp-karty{grid-template-columns:1fr 1fr;}}',
                M + ' .agpp-karta{padding:11px 12px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,.12));background:rgba(255,255,255,.04);}',
                M + ' .agpp-karta.pro{border-color:rgba(230,189,118,.55);background:linear-gradient(160deg,rgba(240,207,133,.16),rgba(216,165,74,.05));}',
                M + ' .agpp-karta b{display:block;font-size:calc(16px * var(--ag-font-scale,1));}',
                M + ' .agpp-karta.pro b{color:#e6bd76;}',
                'body.light-mode ' + M + ' .agpp-karta{background:rgba(0,0,0,.03);}',
                'body.light-mode ' + M + ' .agpp-karta.pro b{color:#8a5f14;}',
                M + ' .agpp-karta i{display:block;font-style:normal;opacity:.75;font-size:calc(12px * var(--ag-font-scale,1));margin-bottom:6px;}',
                M + ' .agpp-karta ul{margin:0;padding-left:16px;}',
                M + ' .agpp-karta li{margin:2px 0;font-size:calc(12.5px * var(--ag-font-scale,1));}',
                M + ' .agpp-karta li em{font-style:normal;opacity:.7;}',
                M + ' .agpp-karta li.dal{list-style:none;margin-left:-16px;opacity:.7;}',
                M + ' table{width:100%;border-collapse:collapse;}',
                M + ' th,' + M + ' td{padding:6px 4px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,.09));text-align:left;vertical-align:top;}',
                M + ' th.sl{text-align:center;width:52px;font-weight:600;font-size:calc(11px * var(--ag-font-scale,1));opacity:.8;}',
                M + ' tr.verb th{padding-top:12px;font-family:var(--font-display,inherit);font-weight:700;color:var(--accent,#2f9e74);border-bottom-color:var(--accent,#2f9e74);}',
                M + ' td.z,' + M + ' td.p{text-align:center;width:52px;}',
                M + ' td.z b{color:var(--accent,#2f9e74);}',
                M + ' td.p b{color:#d8a54a;}',
                M + ' td.z span{opacity:.3;}',
                M + ' tr.dite td.n{padding-left:20px;}',
                M + ' tr.dite td.n::before{content:"↳ ";opacity:.5;}',
                M + ' td.n small{display:block;opacity:.65;font-size:calc(11.5px * var(--ag-font-scale,1));}',
                M + ' .agpp-pata{flex:0 0 auto;display:flex;gap:9px;padding-top:10px;}',
                M + ' .agpp-pata button{flex:1 1 0;padding:12px;border-radius:11px;font:inherit;font-weight:600;cursor:pointer;',
                '  border:1px solid var(--glass-border,rgba(255,255,255,.16));background:transparent;color:inherit;}',
                M + ' .agpp-pata button.hlavni{background:var(--accent,#2f9e74);border-color:transparent;color:#fff;}',
                M + ' .agpp-pata .agpp-mam{flex:1 1 0;display:flex;align-items:center;justify-content:center;gap:8px;',
                '  padding:12px;border-radius:11px;background:linear-gradient(135deg,rgba(240,207,133,.25),rgba(216,165,74,.12));color:#e6bd76;font-weight:600;}',
                'body.light-mode ' + M + ' .agpp-mam{color:#8a5f14;}'
            ].join('\n');
            (document.head || document.documentElement).appendChild(st);
        } catch (e) { swallow(e, 'styly'); }
    }

    // ---- ② znak Pro --------------------------------------------------------------
    function pilulka(host) {
        if (!host || host.querySelector('.ag-pro-pill')) return;
        var i = document.createElement('i');
        i.className = 'ag-pro-pill'; i.textContent = 'PRO'; i.setAttribute('aria-label', 'verze Pro');
        host.appendChild(i);
    }
    function znak() {
        try {
            var je = maPro();
            if (document.body) document.body.classList.toggle('ag-pro', je);
            if (!je) return;              // v Základu se do DOM nepřidává nic
            pilulka(document.querySelector('#tools-modal .modal-content > h3'));
            pilulka(document.querySelector('#side-menu .menu-head'));
        } catch (e) { swallow(e, 'znak'); }
    }

    // ---- ① data z registru -------------------------------------------------------
    // Vrací { skupiny:[{t, radky:[{r, deti:[r]}]}], zaklad, pro, hubu, radku, base:[r] }.
    function data() {
        var out = { skupiny: [], zaklad: 0, pro: 0, hubu: 0, radku: 0, base: [] };
        if (!window.AGReg) return out;
        var all = AGReg.all(), verbs = AGReg.verbs(), i, r;
        var byVerb = {}, poradi = verbs.concat([DALSI]), radek = {};
        for (i = 0; i < poradi.length; i++) byVerb[poradi[i]] = { t: poradi[i], radky: [] };
        function skupina(v) { return byVerb[v && byVerb[v] ? v : DALSI]; }
        // 1. samostatné položky a rozcestníky (v pořadí registru)
        for (i = 0; i < all.length; i++) {
            r = all[i];
            if (r.hidden || r.notile || r.inhub) continue;
            radek[r.k] = { r: r, deti: [] };
            skupina(r.verb).radky.push(radek[r.k]);
        }
        // 2. položky rozcestníků — pod svůj rozcestník; bez něj (schovaný) stojí samy
        for (i = 0; i < all.length; i++) {
            r = all[i];
            if (r.hidden || r.notile || !r.inhub) continue;
            if (radek[r.inhub]) radek[r.inhub].deti.push(r);
            else { radek[r.k] = { r: r, deti: [] }; skupina(r.verb).radky.push(radek[r.k]); }
        }
        for (i = 0; i < poradi.length; i++) if (byVerb[poradi[i]].radky.length) out.skupiny.push(byVerb[poradi[i]]);
        // počty: nástroj = záznam bez rozcestníku (rozcestník jen sdružuje)
        for (i = 0; i < all.length; i++) {
            r = all[i];
            if (r.hidden || r.notile) continue;
            out.radku++;
            if (r.hub) { out.hubu++; continue; }
            if (r.pro) out.pro++; else out.zaklad++;
            if (r.base) out.base.push(r);
        }
        return out;
    }

    // Pro položky po slovesech (pro kartu „Pro"): { verb: [vl, …] }, rozcestníky vynechané.
    function proPodleSloves(d) {
        var out = [], i, j;
        for (i = 0; i < d.skupiny.length; i++) {
            var s = d.skupiny[i], vl = [];
            for (j = 0; j < s.radky.length; j++) {
                var x = s.radky[j];
                if (x.r.pro && !x.r.hub) vl.push(x.r.vl || x.r.k);
                for (var m = 0; m < x.deti.length; m++) if (x.deti[m].pro) vl.push(x.deti[m].vl || x.deti[m].k);
            }
            if (vl.length) out.push({ t: s.t, vl: vl });
        }
        return out;
    }

    function seznam(vl, max) {
        var h = '', n = Math.min(vl.length, max);
        for (var i = 0; i < n; i++) h += '<li>' + esc(vl[i]) + '</li>';
        if (vl.length > n) h += '<li class="dal">+ ' + (vl.length - n) + ' další</li>';
        return h;
    }

    function radekHtml(r, dite) {
        var n = esc(r.vl || (r.help && r.help.t) || r.k) + (r.vh ? '<small>' + esc(r.vh) + '</small>' : '');
        return '<tr class="' + (dite ? 'dite' : '') + (r.hub ? ' hub' : '') + '"><td class="n">' + n + '</td>' +
            '<td class="z">' + (r.pro ? '<span>—</span>' : '<b>✓</b>') + '</td><td class="p"><b>✓</b></td></tr>';
    }

    function obsah() {
        var d = data(), h = '', i, j;
        // karty nahoře
        var baseVl = [];
        for (i = 0; i < d.base.length; i++) baseVl.push(d.base[i].vl || d.base[i].k);
        h += '<div class="agpp-karty">' +
            '<div class="agpp-karta zk"><b>Základ</b><i>zdarma · ' + d.zaklad + ' nástrojů</i><ul>' + seznam(baseVl, 6) + '</ul></div>' +
            '<div class="agpp-karta pro"><b>Pro</b><i>navíc ' + d.pro + ' nástrojů</i><ul>';
        var ps = proPodleSloves(d);
        for (i = 0; i < ps.length; i++) {
            var vl = ps[i].vl.slice(0, 3), zb = ps[i].vl.length - vl.length;
            h += '<li><em>' + esc(ps[i].t) + ':</em> ' + esc(vl.join(', ')) + (zb > 0 ? ' <em>+' + zb + '</em>' : '') + '</li>';
        }
        h += '</ul></div></div>';
        // tabulka po slovesech
        h += '<table><thead><tr><th>Nástroj</th><th class="sl">Základ</th><th class="sl">Pro</th></tr></thead><tbody>';
        for (i = 0; i < d.skupiny.length; i++) {
            var s = d.skupiny[i];
            h += '<tr class="verb"><th colspan="3">' + esc(s.t) + '</th></tr>';
            for (j = 0; j < s.radky.length; j++) {
                h += radekHtml(s.radky[j].r, false);
                for (var m = 0; m < s.radky[j].deti.length; m++) h += radekHtml(s.radky[j].deti[m], true);
            }
        }
        h += '</tbody></table>';
        return h;
    }

    // ---- ① okno --------------------------------------------------------------------
    function okno() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        styly();
        m = document.createElement('div');
        m.id = MODAL_ID;
        m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Základ a Pro');
        m.innerHTML =
            '<div class="agpp-head"><h2>Základ × Pro</h2><button type="button" class="agpp-x" aria-label="Zavřít">&times;</button></div>' +
            '<div class="agpp-body"></div>' +
            '<div class="agpp-pata"><span class="agpp-akce"></span><button type="button" class="agpp-zavri">Zavřít</button></div>';
        document.body.appendChild(m);
        m.querySelector('.agpp-x').addEventListener('click', close);
        m.querySelector('.agpp-zavri').addEventListener('click', close);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && m.classList.contains('on')) { e.preventDefault(); close(); }
        });
        return m;
    }

    // Tlačítko dole podle stavu: Základ → přechod na /pro/; Pro bez klíče → karta
    // koupě (js/pro-zamky.js, tam se právě přidává cena a QR — jen se volá);
    // s licencí jen věta, není co koupit.
    function akce(m) {
        var a = m.querySelector('.agpp-akce');
        if (maPro()) { a.innerHTML = '<span class="agpp-mam">' + IKONA + ' Máš Pro — všechno je odemčené</span>'; return; }
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'hlavni';
        if (jeZaklad()) {
            b.textContent = 'Otevřít verzi Pro';
            b.addEventListener('click', function () { try { window.location.href = ADRESA_PRO; } catch (e) { swallow(e, 'prechod'); } });
        } else {
            b.textContent = 'Mám klíč / koupit';
            b.addEventListener('click', function () {
                close();
                try {
                    if (window.AGProZamky && AGProZamky.prehled) AGProZamky.prehled();
                    else if (window.AGProZamky && AGProZamky.karta) AGProZamky.karta('');
                } catch (e) { swallow(e, 'karta'); }
            });
        }
        a.innerHTML = ''; a.appendChild(b);
    }

    function open() {
        try {
            var m = okno();
            m.querySelector('.agpp-body').innerHTML = obsah();   // vždy znovu: registr i licence se mění
            akce(m);
            m.classList.add('on');
            m.querySelector('.agpp-body').scrollTop = 0;
        } catch (e) { swallow(e, 'open'); }
    }
    function close() {
        var m = document.getElementById(MODAL_ID);
        if (m) m.classList.remove('on');
    }

    // ---- vstup v menu Více ----------------------------------------------------------
    function injectMenu() {
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById(MENU_ID)) return;
        var host = menu.querySelector('.menu-scroll') || menu;
        var btn = document.createElement('button');
        btn.id = MENU_ID; btn.className = 'menu-btn'; btn.type = 'button';
        btn.innerHTML = IKONA + ' Co je v Pro';
        btn.addEventListener('click', function () {
            // toggleMenu() PŘEPÍNÁ — zavírá se jen otevřený panel
            try { if (typeof toggleMenu === 'function' && menu.classList.contains('open')) toggleMenu(); } catch (e) { swallow(e, 'menu'); }
            open();
        });
        // těsně PŘED „Verze Pro a klíč" (js/pro-zamky.js): napřed co Pro je, pak klíč.
        // Za ten řádek se řadí i js/ucty.js a js/pro-klice.js, takže „za ním" by
        // nás od něj odsunuly (naměřeno: mezi nimi skončilo „Kde pracuju").
        var pred = document.getElementById('ag-pro-menu-btn');
        if (pred && pred.parentNode) { pred.parentNode.insertBefore(btn, pred); return; }
        var after = document.getElementById('ag-fb-menu-btn') || document.getElementById('hist-menu-btn');
        if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
        else host.appendChild(btn);
    }

    // ---- rozjezd --------------------------------------------------------------------
    styly();
    function tik() { znak(); injectMenu(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tik);
    else tik();
    window.addEventListener('load', tik);
    setInterval(tik, 5000);
    window.addEventListener('aglic:zmena', znak);

    window.AGProPrehled = { open: open, close: close, znak: znak, data: data };
})();
