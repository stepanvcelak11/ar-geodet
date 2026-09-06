// ===== AR Geodet — ZÁMKY PRO VERZE (ODPOJITELNÁ vrstva) =======================
// Základ (zdarma) umí celý den v terénu; Pro přidává navrch protokoly, objemy,
// firmu a pokročilé výpočty. CO je čí, stojí na jediném místě — pole `pro: 1`
// u záznamu v js/tools-registry.js. ZDA to tenhle telefon má, ví js/licence.js.
// Tenhle modul dělá to třetí: postará se, aby Pro nástroj bez licence NEŠEL
// spustit, ale bylo VIDĚT, že existuje a co umí.
//
// ⚠ ZAMYKÁ SE JEDNÍM ODCHYTEM KLIKU V CAPTURE FÁZI, NE PĚTI ZÁSAHY DO MODULŮ.
//   Nástroj se dá dnes spustit z mřížky (#tools-modal .tool-tile), ze seznamu
//   úkonů (.ag-uk-i), z kolečka, z hledání a z gest — pět míst, každé v jiném
//   souboru, a další přibude. Kdyby se hlídalo v každém zvlášť, jedno zapomenuté
//   místo znamená díru v placené verzi a nikdo si toho nevšimne. Capture fáze
//   běží DŘÍV než posluchač dlaždice, takže stačí jedna past pro všechny.
//
// ⚠ DRUHÁ ZÁVORA JE NA SAMOTNÉ FUNKCI. Klik se dá obejít — gesto, hledání nebo
//   `window.openDmtVolume()` z konzole zavolají otevírací funkci přímo. Proto se
//   u Pro nástrojů obaluje i ta funkce (a `onClick` při registraci). Kdo si ji
//   přepíše zpátky, tomu to stejně nezakážu — cíl je, aby se Pro nástroj
//   nespustil OMYLEM, ne aby se to nedalo obejít (viz hlavička js/licence.js).
//
// ⚠ SCHOVÁVAT SE NESMÍ INLINE STYLEM. Hledání v Nástrojích (js/field-tools.js,
//   applyFilter) přepisuje `style.display` u každé dlaždice — inline zápis by
//   vydržel do prvního napsaného písmene. Značka je proto atribut `data-agpro`
//   a všechno ostatní dělá CSS pravidlo. (Tatáž past už jednou chytila vypínač
//   modulů, viz komentář v js/priznaky.js.)
//
// ⚠ V BALÍČKU „ZÁKLAD" PRO MODULY VŮBEC NEJSOU (scripts/build.mjs --zaklad je
//   vynechá), takže se nemají jak zaregistrovat a v seznamu by prostě chyběly.
//   Uživatel by se o Pro nedozvěděl. Modul proto pro každý Pro nástroj, který se
//   sám nepřihlásil, VYROBÍ ZÁSTUPNÝ ŘÁDEK z registru — registr se posílá v obou
//   balíčcích celý právě kvůli tomuhle.
//
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + './js/pro-zamky.js'
// v sw.js. Bez něj se Pro nástroje chovají jako dřív (bez zámku).
// ================================================================================
(function () {
    'use strict';
    if (window.AGProZamky) return;

    var STYLE_ID = 'ag-pro-style';
    var MODAL_ID = 'ag-pro-modal';
    var ZAMEK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'pro-zamky:' + kde); } catch (x) { } }
    function esc(s) {
        if (window.AG && AG.esc) return AG.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function maPro() { try { return !!(window.AGLic && AGLic.isPro()); } catch (e) { return false; } }
    function jePro(k) { try { return !!(k && window.AGReg && AGReg.isPro(k)); } catch (e) { return false; } }
    function zamceno(k) { return jePro(k) && !maPro(); }

    // Klíč prvku. Tři zápisy, všechny se v appce používají — stejné pořadí hledání
    // jako js/field-tools.js (tileToolKey) a js/tools-simple.js.
    function klicUzlu(el) {
        if (!el || !el.getAttribute) return null;
        var k = el.getAttribute('data-tool') || el.getAttribute('data-k');
        if (k) return k;
        var oc = el.getAttribute('onclick') || '';
        var ms = oc.match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }

    // ---- vzhled ------------------------------------------------------------------
    function styly() {
        if (document.getElementById(STYLE_ID)) return;
        try {
            var st = document.createElement('style');
            st.id = STYLE_ID;
            st.textContent = [
                // dlaždice i řádek: přišpendlený zámek v rohu + ztlumený obsah, ať je
                // na první pohled poznat, co je za penize, aniž by to zmizelo
                '[data-agpro="1"]{position:relative;}',
                '[data-agpro="1"]::after{content:"";position:absolute;top:5px;right:5px;width:13px;height:13px;',
                '  background:var(--accent,#2f9e74);-webkit-mask:var(--ag-pro-mask) center/10px 10px no-repeat;',
                '  mask:var(--ag-pro-mask) center/10px 10px no-repeat;border-radius:50%;padding:3px;opacity:.85;}',
                '#tools-modal .tool-tile[data-agpro="1"] > *{opacity:.55;}',
                '.ag-uk-i[data-agpro="1"] .ag-uk-ico,.ag-uk-i[data-agpro="1"] .ag-uk-tx{opacity:.6;}',
                '.ag-uk-i[data-agpro="1"]::after{top:50%;right:11px;transform:translateY(-50%);}',
                // karta
                '#' + MODAL_ID + '{position:fixed;inset:0;z-index:100060;display:none;align-items:center;',
                '  justify-content:center;padding:16px;background:rgba(0,0,0,.62);}',
                '#' + MODAL_ID + '.on{display:flex;}',
                '#' + MODAL_ID + ' .agp-box{width:min(430px,94vw);max-height:88vh;overflow:auto;border-radius:16px;',
                '  padding:18px 18px 16px;background:var(--panel,#141a26);color:var(--text,#e9eef7);',
                '  border:1px solid var(--glass-border,rgba(255,255,255,.12));box-shadow:0 18px 50px rgba(0,0,0,.5);}',
                'body.light-mode #' + MODAL_ID + ' .agp-box{background:#fff;color:#16202e;}',
                '#' + MODAL_ID + ' h2{margin:0 0 4px;font-size:calc(18px * var(--ag-font-scale,1));display:flex;align-items:center;gap:9px;}',
                '#' + MODAL_ID + ' h2 span{flex:0 0 auto;width:21px;height:21px;color:var(--accent,#2f9e74);}',
                '#' + MODAL_ID + ' h2 span svg{width:21px;height:21px;}',
                '#' + MODAL_ID + ' .agp-pod{margin:0 0 13px;opacity:.75;font-size:calc(13px * var(--ag-font-scale,1));line-height:1.45;}',
                '#' + MODAL_ID + ' .agp-co{margin:0 0 14px;padding:11px 13px;border-radius:11px;',
                '  background:var(--accent-soft,rgba(47,158,116,.13));font-size:calc(13px * var(--ag-font-scale,1));line-height:1.5;}',
                '#' + MODAL_ID + ' .agp-co b{display:block;margin-bottom:5px;}',
                '#' + MODAL_ID + ' .agp-co ul{margin:0;padding-left:18px;}',
                '#' + MODAL_ID + ' .agp-co li{margin:2px 0;}',
                '#' + MODAL_ID + ' label{display:block;margin:0 0 5px;font-size:calc(12.5px * var(--ag-font-scale,1));opacity:.8;}',
                '#' + MODAL_ID + ' input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;',
                '  border:1px solid var(--glass-border,rgba(255,255,255,.16));background:rgba(0,0,0,.18);',
                '  color:inherit;font:inherit;font-size:calc(15px * var(--ag-font-scale,1));',
                '  letter-spacing:.08em;text-transform:uppercase;}',
                'body.light-mode #' + MODAL_ID + ' input{background:#f4f6fa;}',
                '#' + MODAL_ID + ' .agp-hl{margin:8px 0 0;min-height:17px;font-size:calc(12.5px * var(--ag-font-scale,1));}',
                '#' + MODAL_ID + ' .agp-hl.bad{color:#e2685f;}',
                '#' + MODAL_ID + ' .agp-hl.ok{color:var(--accent,#2f9e74);}',
                '#' + MODAL_ID + ' .agp-rada{display:flex;gap:9px;margin-top:14px;}',
                '#' + MODAL_ID + ' .agp-rada button{flex:1 1 0;padding:12px;border-radius:11px;font:inherit;',
                '  font-weight:600;cursor:pointer;border:1px solid var(--glass-border,rgba(255,255,255,.16));',
                '  background:transparent;color:inherit;}',
                '#' + MODAL_ID + ' .agp-rada button.hlavni{background:var(--accent,#2f9e74);border-color:transparent;color:#fff;}'
            ].join('\n');
            (document.head || document.documentElement).appendChild(st);
            // Zámek jako maska, ať se obarví podle motivu (v CSS nejde vložit SVG přímo).
            var url = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
            ) + '")';
            document.documentElement.style.setProperty('--ag-pro-mask', url);
        } catch (e) { swallow(e, 'styly'); }
    }

    // ---- označení prvků ----------------------------------------------------------
    // Běží periodicky ze stejného důvodu jako u ostatních vrstev: mřížku i seznam
    // úkonů překresluje několik modulů a dlaždice přibývají postupně, jak se moduly
    // registrují. Je to jen čtení atributů, takže i při zavřeném okně je to levné.
    function oznac() {
        try {
            var uzly = document.querySelectorAll('#tools-modal .tool-tile, .ag-uk-i, [data-tool]');
            for (var i = 0; i < uzly.length; i++) {
                var el = uzly[i], k = klicUzlu(el);
                if (!k) continue;
                if (zamceno(k)) { if (el.getAttribute('data-agpro') !== '1') el.setAttribute('data-agpro', '1'); }
                else if (el.hasAttribute('data-agpro')) el.removeAttribute('data-agpro');
            }
        } catch (e) { swallow(e, 'oznac'); }
    }

    // ---- první závora: klik ------------------------------------------------------
    document.addEventListener('click', function (e) {
        try {
            if (!e.target || !e.target.closest) return;
            var el = e.target.closest('[data-agpro="1"]');
            if (!el) {
                // Dlaždice se ještě nemusela stihnout označit (registrace přišla mezi
                // dvěma tiky) — proto se klíč zkusí přečíst i přímo z toho, na co se
                // kleplo. Bez toho by první klik po startu Pro nástroj otevřel.
                var kand = e.target.closest('#tools-modal .tool-tile, .ag-uk-i, [data-tool]');
                if (!kand || !zamceno(klicUzlu(kand))) return;
                el = kand;
            }
            var k = klicUzlu(el);
            if (!zamceno(k)) return;
            e.preventDefault(); e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            otevriKartu(k);
        } catch (err) { swallow(err, 'klik'); }
    }, true);

    // ---- druhá závora: samotná funkce --------------------------------------------
    // `onClick` při registraci (injektované nástroje) i globální otevírací funkce
    // (statické dlaždice — openDmtVolume, openTachymetrie).
    //
    // ⚠ HLÍDÁ SE IDENTITA FUNKCE, NE JEN „UŽ JSEM OBALIL". Odkládací vrstva
    //   (js/lazy-load.js) zapíše pod `window.openDmtVolume` nejdřív ZÁSTUPCE,
    //   který teprve stáhne js/dmt-volume.js — a ten si po načtení jméno PŘEPÍŠE
    //   svou skutečnou funkcí. Kdo si poznamená jen „obaleno" a podruhé už
    //   nesáhne, přijde o obal přesně ve chvíli, kdy začne existovat skutečný
    //   nástroj: zámek držel do prvního otevření a pak tiše zmizel. (Změřeno
    //   testem E1 v scripts/test_pro_verze.py — nejdřív propadlo.)
    var _obalene = {};      // klíč -> náš obal, ať poznáme cizí přepsání
    function obalFunkce() {
        try {
            var klice = (window.AGReg && AGReg.proKeys && AGReg.proKeys()) || [];
            for (var i = 0; i < klice.length; i++) {
                var k = klice[i], cur = window[k];
                if (typeof cur !== 'function') continue;
                if (cur.__agPro === k) continue;          // to je pořád náš obal
                (function (k, orig) {
                    var obal = function () {
                        if (zamceno(k)) { otevriKartu(k); return; }
                        return orig.apply(this, arguments);
                    };
                    obal.__agPro = k;
                    window[k] = obal;
                    _obalene[k] = obal;
                })(k, cur);
            }
        } catch (e) { swallow(e, 'obalFunkce'); }
    }

    function obalRegistraci() {
        try {
            var orig = window.agRegisterFieldTool;
            if (typeof orig !== 'function' || orig.__agPro) return;
            var obal = function (item) {
                if (item && item.id && jePro(item.id) && typeof item.onClick === 'function') {
                    var puvodni = item.onClick, id = item.id;
                    item = {
                        id: id, label: item.label, icon: item.icon, order: item.order, cat: item.cat,
                        onClick: function () {
                            if (zamceno(id)) { otevriKartu(id); return; }
                            return puvodni.apply(this, arguments);
                        }
                    };
                }
                return orig.apply(this, arguments);
            };
            obal.__agPro = 1;
            window.agRegisterFieldTool = obal;
        } catch (e) { swallow(e, 'obalRegistraci'); }
    }

    // ---- zástupné řádky pro balíček Základ ---------------------------------------
    // V Základu Pro moduly v balíčku nejsou, takže se nemají jak zaregistrovat.
    // Bez tohohle by v seznamu prostě chyběly a uživatel by se o Pro nedozvěděl.
    // Vyrábí se AŽ po startu (a jen jednou), aby se nepředběhl modul, který se
    // registruje sám — ten má vždycky přednost, protože zná svou ikonu i název.
    var _zastupciHotovi = false;
    function zastupci() {
        if (_zastupciHotovi) return;
        if (typeof window.agRegisterFieldTool !== 'function' || !window.AGReg) return;
        _zastupciHotovi = true;
        try {
            var klice = AGReg.proKeys();
            for (var i = 0; i < klice.length; i++) {
                var k = klice[i], r = AGReg.get(k);
                if (!r || r.hidden) continue;
                // rozcestník ani statická dlaždice se neregistrují nikdy — ty v mřížce
                // buď jsou (statické jsou v index.html v obou balíčcích), nebo je
                // vyrábí js/tools-hub.js, který v Základu taky zůstává
                if (r.hub || r.notile) continue;
                if (document.querySelector('[data-tool="' + k + '"]')) continue;
                (function (k, r) {
                    window.agRegisterFieldTool({
                        id: k,
                        label: (r.help && r.help.t) || r.vl || k,
                        icon: ZAMEK,
                        cat: r.cat,
                        onClick: function () { otevriKartu(k); }
                    });
                })(k, r);
            }
        } catch (e) { swallow(e, 'zastupci'); }
    }

    // ---- karta „co to umí" --------------------------------------------------------
    function karta() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        styly();
        m = document.createElement('div');
        m.id = MODAL_ID;
        m.innerHTML =
            '<div class="agp-box" role="dialog" aria-modal="true">' +
            '  <h2><span>' + ZAMEK + '</span><span class="agp-nazev"></span></h2>' +
            '  <p class="agp-pod"></p>' +
            '  <div class="agp-co"></div>' +
            '  <label for="agp-klic">Máš klíč Pro? Opiš ho sem — funguje i bez signálu.</label>' +
            '  <input id="agp-klic" type="text" autocomplete="off" autocapitalize="characters"' +
            '         spellcheck="false" placeholder="ARG-0000-0000-0000-0000">' +
            '  <p class="agp-hl"></p>' +
            '  <div class="agp-rada">' +
            '    <button type="button" class="agp-zpet">Zpět</button>' +
            '    <button type="button" class="hlavni agp-ok">Odemknout</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        m.addEventListener('click', function (e) { if (e.target === m) zavri(); });
        m.querySelector('.agp-zpet').addEventListener('click', zavri);
        m.querySelector('.agp-ok').addEventListener('click', odemkni);
        m.querySelector('#agp-klic').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); odemkni(); }
        });
        return m;
    }

    function zavri() {
        var m = document.getElementById(MODAL_ID);
        if (m) m.classList.remove('on');
    }

    function odemkni() {
        var m = karta(), hl = m.querySelector('.agp-hl'), inp = m.querySelector('#agp-klic');
        hl.className = 'agp-hl';
        if (!window.AGLic) { hl.className = 'agp-hl bad'; hl.textContent = 'Licence v téhle verzi appky není.'; return; }
        var r = AGLic.uloz(inp.value);
        if (r && r.ok) {
            hl.className = 'agp-hl ok';
            hl.textContent = 'Hotovo — Pro je odemčené.';
            // Zástupné dlaždice ze Základu je potřeba nahradit skutečnými moduly,
            // které v tomhle balíčku vůbec nejsou. Říct to rovnou je poctivější
            // než nechat člověka klepat na dlaždice, které se neotevřou.
            if (window.AGLic.vydani && AGLic.vydani() === 'zaklad') {
                hl.textContent = 'Klíč platí. Pro nástroje jsou ale ve vydání Pro — otevři ho a klíč tam už bude.';
            }
            oznac();
            setTimeout(zavri, 1400);
            return;
        }
        hl.className = 'agp-hl bad';
        hl.textContent = ({
            tvar: 'Klíč má mít 16 znaků ve tvaru ARG-0000-0000-0000-0000.',
            verze: 'Tenhle klíč je pro jinou verzi aplikace.',
            podpis: 'Klíč nesedí — zkontroluj, jestli není překlep.',
            vyprsel: 'Klíči vypršela platnost.'
        })[r && r.duvod] || 'Klíč nesedí.';
    }

    function otevriKartu(k) {
        var m = karta();
        var r = (window.AGReg && AGReg.get(k)) || {};
        var nazev = (r.help && r.help.t) || r.vl || k;
        m.querySelector('.agp-nazev').textContent = nazev;
        var pod = r.vl || '';
        if (r.vh) pod += (pod ? ' — ' : '') + r.vh;
        m.querySelector('.agp-pod').textContent = pod || 'Nástroj z placené verze.';
        m.querySelector('.agp-co').innerHTML =
            '<b>Tohle je ve verzi Pro</b>' +
            '<ul>' +
            '<li>protokoly a papíry — vytyčení, kvalita bodu, deník</li>' +
            '<li>objemy a vrstvy — kubatury, DMT, kontrola pokládky</li>' +
            '<li>přesné určení bodu — protínání, resekce, volné stanovisko, Helmert</li>' +
            '<li>katastr do mapy i do AR, dělení parcel, podklady</li>' +
            '<li>firma — účty, docházka, chat, vysílačka, kniha jízd</li>' +
            '</ul>';
        m.querySelector('.agp-hl').textContent = '';
        m.querySelector('.agp-hl').className = 'agp-hl';
        m.classList.add('on');
        try { m.querySelector('#agp-klic').focus(); } catch (e) { swallow(e, 'focus'); }
    }

    // ---- vstup do „Více" ----------------------------------------------------------
    // ⚠ SCHVÁLNĚ MIMO ZÁLOŽKY NASTAVENÍ I MIMO .tool-grid: obojí umí schovat
    //   applyPerms() podle role a hostovi by se vstup ke koupi vůbec neukázal
    //   (tatáž past už jednou spolkla „Napsat autorovi", viz js/zpetna-vazba.js).
    function injectMenu() {
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('ag-pro-menu-btn')) return;
        var host = menu.querySelector('.menu-scroll') || menu;
        var btn = document.createElement('button');
        btn.id = 'ag-pro-menu-btn'; btn.className = 'menu-btn'; btn.type = 'button';
        btn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;vertical-align:-3px;">' + ZAMEK + '</span> ' +
            (maPro() ? 'Verze Pro — odemčeno' : 'Verze Pro a klíč');
        btn.addEventListener('click', function () {
            try { if (typeof toggleMenu === 'function' && menu.classList.contains('open')) toggleMenu(); } catch (e) { swallow(e, 'injectMenu'); }
            otevriPrehled();
        });
        var after = document.getElementById('ag-fb-menu-btn') || document.getElementById('hist-menu-btn');
        if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
        else host.appendChild(btn);
    }

    function otevriPrehled() {
        var m = karta();
        var s = (window.AGLic && AGLic.stav()) || { pro: false };
        m.querySelector('.agp-nazev').textContent = s.pro ? 'Verze Pro — odemčeno' : 'Verze Pro';
        m.querySelector('.agp-pod').textContent = s.pro
            ? ('Klíč č. ' + s.cislo + (s.do ? (', platí ještě ' + s.dniDoKonce + ' dní.') : ', platí natrvalo.'))
            : 'Základ umí celý den v terénu. Pro přidává navrch tohle:';
        m.querySelector('.agp-co').innerHTML =
            '<b>' + (s.pro ? 'Máš odemčeno' : 'Ve verzi Pro') + '</b>' +
            '<ul>' +
            '<li>protokoly a papíry — vytyčení, kvalita bodu, deník</li>' +
            '<li>objemy a vrstvy — kubatury, DMT, kontrola pokládky</li>' +
            '<li>přesné určení bodu — protínání, resekce, volné stanovisko, Helmert</li>' +
            '<li>katastr do mapy i do AR, dělení parcel, podklady</li>' +
            '<li>firma — účty, docházka, chat, vysílačka, kniha jízd</li>' +
            '</ul>';
        m.querySelector('.agp-hl').textContent = '';
        m.querySelector('.agp-hl').className = 'agp-hl';
        m.classList.add('on');
    }

    // ---- rozjezd -------------------------------------------------------------------
    obalRegistraci();
    styly();

    function tik() {
        obalRegistraci();      // jiná vrstva mohla registraci přeobalit po nás
        obalFunkce();
        oznac();
        injectMenu();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tik);
    else tik();
    window.addEventListener('load', function () { tik(); setTimeout(zastupci, 1200); });
    setInterval(tik, 1500);
    window.addEventListener('aglic:zmena', function () { _obalene = {}; tik(); });

    window.AGProZamky = { oznac: oznac, karta: otevriKartu, prehled: otevriPrehled, zamceno: zamceno };
})();
