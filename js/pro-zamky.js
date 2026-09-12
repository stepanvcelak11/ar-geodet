// ===== QTRIG — ZÁMKY PRO VERZE (ODPOJITELNÁ vrstva) =======================
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
// ⚠ V BALÍČKU „ZÁKLAD" PRO MODULY VŮBEC NEJSOU (scripts/vydani.py --zaklad je
//   vynechá), takže se nemají jak zaregistrovat a v seznamu by prostě chyběly.
//   Uživatel by se o Pro nedozvěděl. Modul proto pro každý Pro nástroj, který se
//   sám nepřihlásil, VYROBÍ ZÁSTUPNÝ ŘÁDEK z registru — registr se posílá v obou
//   balíčcích celý právě kvůli tomuhle.
//
// ⚠ KARTA „VERZE PRO" (co to umí, klíč, žádost o Pro) je od 12. 9. 2026 v ODLOŽENÉM
//   js/pro-karta.js — tady zůstává jen skořápka okna (viz karta()). Rozpočet startu.
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

    // KDE BYDLÍ PRO. Obě vydání jsou na TÉMŽE originu (Základ na kořeni, Pro pod
    // /pro/) — schválně: localStorage i cache jsou per-origin, takže se po koupi
    // nepřenáší nic ručně. Zakázky, body i opsaný klíč jsou v Pro rovnou. Cesta
    // je RELATIVNÍ, aby fungovala i na Pages v podadresáři (/ar_geodet/pro/).
    var ADRESA_PRO = './pro/';

    // Vydání sestaveného balíčku. Ve zdrojích (bez sestavení) je 'pro', aby se
    // dalo vyvíjet obojí — zapisuje to scripts/vydani.py při sestavení.
    function jeZaklad() {
        try { return !!(window.AGLic && AGLic.vydani && AGLic.vydani() === 'zaklad'); }
        catch (e) { return false; }
    }

    function maPro() { try { return !!(window.AGLic && AGLic.isPro()); } catch (e) { return false; } }

    // KOUPĚ PRO. Samotný nákup (cena, QR platba, objednávka) je v ODLOŽENÉM
    // js/pro-koupe.js — tenhle soubor jede při startu a rozpočet startu má
    // pár kB rezervy. Tady je jen tlačítko a rozhodnutí, jestli se smí ukázat.
    //
    // ⚠ V APPCE Z GOOGLE PLAY SE NEPRODÁVÁ. Pravidla Play zakazují v aplikaci
    //   z obchodu nabízet vlastní platbu za digitální obsah (chtějí svou
    //   pokladnu s provizí) — a appka z Play je tentýž web (TWA). Pozná se
    //   podle refereru `android-app://…`, který má jen první navigace, proto
    //   se poznatek uloží. V Play verzi zůstává jen pole na klíč; cena a QR
    //   jsou na webu a na iPhonu (tam žádný obchod nestojí v cestě).
    var LS_TWA = 'agTwa_v1';
    function jeTwa() {
        try {
            if (localStorage.getItem(LS_TWA) === '1') return true;
            if ((document.referrer || '').indexOf('android-app://') === 0) { localStorage.setItem(LS_TWA, '1'); return true; }
        } catch (e) { swallow(e, 'jeTwa'); }
        return false;
    }
    function otevriKoupi() {
        var jdi = function () { if (window.AGProKoupe) AGProKoupe.open(); else alert('Nákup se nenačetl — zkus to znovu, až bude signál.'); };
        if (window.AGProKoupe) return jdi();
        if (window.AGLazy && typeof AGLazy.need === 'function') AGLazy.need('js/pro-koupe.js', jdi);
        else jdi();
    }
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
                // SKOŘÁPKA KARTY. Celý vzhled (celá obrazovka, hero, skupiny, tlačítka)
                // je v odloženém js/pro-karta.js — tady jen tolik, aby okno s názvem
                // a křížkem stálo hned po klepnutí, i než ten soubor dojede.
                '#' + MODAL_ID + '{position:fixed;inset:0;z-index:100060;display:none;background:var(--bg,#0d1117);color:var(--text-color,#e9eef7);}',
                '#' + MODAL_ID + '.on{display:flex;flex-direction:column;}',
                'body.light-mode #' + MODAL_ID + '{background:#f5f7fa;color:#16202e;}',
                '#' + MODAL_ID + ' .agp-box{flex:1 1 auto;display:flex;flex-direction:column;padding:calc(10px + env(safe-area-inset-top,0px)) 18px 18px;overflow:hidden;}',
                '#' + MODAL_ID + ' .agp-top{display:flex;align-items:center;justify-content:flex-end;}',
                '#' + MODAL_ID + ' .agp-x{width:44px;height:44px;border-radius:50%;border:1px solid var(--glass-border,rgba(255,255,255,.14));',
                '  background:var(--glass-bg,rgba(255,255,255,.06));color:inherit;font:400 26px/1 var(--font-ui,system-ui);cursor:pointer;padding:0;}',
                '#' + MODAL_ID + ' .agp-nazev{margin:18px 0 6px;text-align:center;font:700 calc(22px * var(--ag-font-scale,1))/1.25 var(--font-ui,system-ui);}',
                '#' + MODAL_ID + ' .agp-pod{margin:0;text-align:center;opacity:.7;font-size:calc(13px * var(--ag-font-scale,1));}'
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
    // ⚠⚠ ZÁMEK NESMÍ STÁT NA PŘEOBALOVÁNÍ V INTERVALU. Odkládací vrstva
    //   (js/lazy-load.js, js/lazy-tools.js) zapíše pod `window.openDmtVolume`
    //   nejdřív zástupce a skutečný modul si po načtení jméno PŘEPÍŠE. Obal se
    //   sice pozná podle identity (`fn.__agPro`) a příští tik ho vrátí, jenže
    //   mezi přepsáním a tikem je až 1,5 s, kdy pod tím jménem visí HOLÁ funkce
    //   — a gesto, hledání nebo přímé volání ji v tom okně otevřou. Nebyla to
    //   teorie: scripts/test_pro_verze.py na kontrole E1 padal zhruba obden.
    //
    //   Proto se pod to jméno místo hodnoty položí PŘÍSTUPOVÁ VLASTNOST: čtení
    //   vrací obal, zápis se uloží jako nová vnitřní funkce a obalí se rovnou,
    //   takže okno, ve kterém by šla vzít holá, vůbec nevznikne.
    //
    // ⚠ Ne každé jméno se dá takhle pohlídat: `function openX(){}` v hlavičce
    //   klasického skriptu vyrobí na window vlastnost s configurable:false a
    //   defineProperty na ni vyhodí výjimku. Pro ty zůstává původní obalení
    //   v tiku — je slabší, ale pořád lepší než nic.
    var _hlidane = {};

    // ⚠ KLÍČ ZÁMKU A JMÉNO FUNKCE JSOU DVĚ RŮZNÉ VĚCI (od 8. 9. 2026). `k` je klíč
    //   v registru (podle něj se ptáme `zamceno()` a otevírá karta), `n` je jméno
    //   vlastnosti na window. Do téhle chvíle to byl jeden řetězec — viz obalFunkce().
    //   Jméno smí být i tečkové (`AGPdr.open`): pak se obaluje metoda na objektu.
    function drzitel(n) {
        if (n.indexOf('.') === -1) return { obj: window, klic: n };
        var casti = n.split('.'), o = window;
        for (var i = 0; i < casti.length - 1; i++) { o = o && o[casti[i]]; if (!o) return null; }
        return { obj: o, klic: casti[casti.length - 1] };
    }
    // ⚠⚠⚠ OBAL MUSÍ ZŮSTAT PRŮHLEDNÝ PRO ZNAČKY NA PŮVODNÍ FUNKCI (10. 9. 2026).
    //   js/lazy-tools.js si na zástupce odloženého nástroje sází `_agLazyStub` a
    //   pak se ptá `isStub()`, aby zástupce NIKDY nezavolal jako výsledek načtení
    //   modulu — je to jeho pojistka proti nekonečné smyčce (viz dropStub tamtéž).
    //   Jenže náš obal je jiná funkce a značku nenesl, takže `isStub(obal)` vyšlo
    //   false, openTool() zavolal obal, ten zavolal zástupce, ten zase openTool…
    //   NAMĚŘENO: `window.agOpenOdhad()` se po odemčení Pro UŽ NIKDY nevrátilo
    //   (test_navrhy_d2 visel na místě, kde na mainu prochází).
    //   Značky se proto z původní funkce na obal ZKOPÍRUJÍ. `__agPro`/`__agRaw`
    //   nastavuje volající AŽ POTOM, aby je kopie nepřebila.
    function prenesZnacky(zdroj, cil) {
        try {
            for (var k in zdroj) {
                if (!Object.prototype.hasOwnProperty.call(zdroj, k)) continue;
                if (k === '__agPro' || k === '__agRaw') continue;
                cil[k] = zdroj[k];
            }
        } catch (e) { swallow(e, 'prenesZnacky'); }
        return cil;
    }

    function obalPrimo(k, n) {
        n = n || k;
        var d = drzitel(n); if (!d) return;
        var cur = d.obj[d.klic];
        if (typeof cur !== 'function' || cur.__agPro === k) return;
        var obal = function () {
            if (zamceno(k)) { otevriKartu(k); return; }
            return cur.apply(this, arguments);
        };
        prenesZnacky(cur, obal);
        obal.__agPro = k;
        obal.__agRaw = cur;
        try { d.obj[d.klic] = obal; _obalene[n] = obal; } catch (e) { swallow(e, 'obalPrimo'); }
    }

    function hlidejFunkci(k, n) {
        n = n || k;
        // tečkové jméno (metoda objektu) přístupovou vlastností hlídat neumíme —
        // obalí se přímo a znovu při každém tiku, kdyby modul metodu přepsal
        if (n.indexOf('.') !== -1) { obalPrimo(k, n); return; }
        var popis = null;
        try { popis = Object.getOwnPropertyDescriptor(window, n); } catch (e) { popis = null; }
        // Hlídka drží, jen dokud je na window pořád NAŠE přístupová vlastnost.
        // Kdyby ji někdo přepsal vlastní (nebo smazal), příznak se zahodí a
        // položí se znovu — jinak by se `_hlidane` tvářilo, že je zamčeno, a
        // zámek by tiše zmizel na zbytek běhu.
        if (_hlidane[n]) {
            if (popis && popis.get && popis.get.__agPro === k) return;
            _hlidane[n] = false;
        }
        if (popis && popis.configurable === false) { obalPrimo(k, n); return; }

        var vnitrni;
        try { vnitrni = window[n]; } catch (e) { vnitrni = undefined; }
        if (vnitrni && vnitrni.__agRaw) vnitrni = vnitrni.__agRaw;   // nešahat na vlastní obal
        var obal = null;

        function dej() {
            if (typeof vnitrni !== 'function') return vnitrni;
            if (obal && obal.__agRaw === vnitrni) return obal;
            obal = function () {
                if (zamceno(k)) { otevriKartu(k); return; }
                return vnitrni.apply(this, arguments);
            };
            prenesZnacky(vnitrni, obal);
            obal.__agPro = k;
            obal.__agRaw = vnitrni;
            return obal;
        }

        dej.__agPro = k;
        try {
            Object.defineProperty(window, n, {
                configurable: true,
                enumerable: popis ? popis.enumerable !== false : true,
                get: dej,
                set: function (v) {
                    vnitrni = (v && v.__agRaw) ? v.__agRaw : v;
                    obal = null;
                }
            });
            _hlidane[n] = true;
        } catch (e) {
            swallow(e, 'hlidejFunkci');
            obalPrimo(k, n);
        }
    }

    // ⚠⚠ DRUHÁ ZÁVORA HLÍDALA ŠPATNÉ JMÉNO (opraveno 8. 9. 2026).
    //   Do téhle chvíle se obalovalo `window[<klíč z registru>]` — jenže klíč se
    //   názvu funkce rovná jen u DVOU nástrojů ze třiceti, a to náhodou
    //   (openDmtVolume, openTachymetrie). Moduly svůj otvírák vystavují pod jiným
    //   jménem: klíč `parcela` → `window.agOpenParcela`. Hlídka se tedy pokládala
    //   na neexistující vlastnost a skutečný otvírák zůstal HOLÝ.
    //   Naměřeno ve stavu Základ (AGLic.isPro() === false): 28 z 30 Pro nástrojů
    //   šlo spustit přímo — `agOpenParcela()` otevřelo Parcelu, `agOpenFreeStation()`
    //   Volné stanovisko, `agOpenLocalize()` Helmerta. Klik na dlaždici držel, ale
    //   Průvodce úkolem (js/pruvodce.js) volá právě `window[it.fn]()`.
    //
    //   Jména se berou ze TŘÍ zdrojů, ať se nemusí vést čtvrtá tabulka:
    //     ① klíč sám (kvůli openDmtVolume / openTachymetrie),
    //     ② `fn` v js/tools-registry.js,
    //     ③ `open` z manifestu js/lazy-tools.js (odložené nástroje ho mají odjakživa).
    //   Že žádný Pro nástroj nezůstal bez hlídky, hlídá scripts/test_pro_verze.py.
    function jmenaOtviraku(k) {
        var out = [k];
        try { var f = (window.AGReg && AGReg.fn) ? AGReg.fn(k) : ''; if (f) out.push(f); } catch (e) { swallow(e, 'jmenaOtviraku:reg'); }
        try {
            var man = (window.AGLazyTools && AGLazyTools.manifest) || [];
            for (var i = 0; i < man.length; i++) if (man[i] && man[i].id === k && man[i].open) { out.push(man[i].open); break; }
        } catch (e) { swallow(e, 'jmenaOtviraku:lazy'); }
        return out;
    }
    function obalFunkce() {
        try {
            var klice = (window.AGReg && AGReg.proKeys && AGReg.proKeys()) || [];
            for (var i = 0; i < klice.length; i++) {
                var jm = jmenaOtviraku(klice[i]);
                for (var j = 0; j < jm.length; j++) hlidejFunkci(klice[i], jm[j]);
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
        // ⚠⚠⚠ ZÁSTUPCE UMÍ MODUL ZABÍT (opraveno 8. 9. 2026). Tahle funkce se
        //   pouštěla BEZ OHLEDU na vydání a na to, jestli telefon Pro má. Jediná
        //   pojistka byla „už je dlaždice v DOM?" — jenže mřížku kreslí
        //   js/field-tools.js až za startem a Pro moduly jsou odložené, takže
        //   dlaždice v tu chvíli neexistuje. agRegisterFieldTool pak záznam se
        //   stejným id NAHRADÍ mrtvým zástupcem s onClick „otevři kartu Pro" —
        //   a moduly se registrují jen jednou, takže se to už nevrátí.
        //   NAMĚŘENO s odemčeným Pro (režim vlastníka): AGLic.isPro() === true,
        //   žádná dlaždice neměla data-agpro, a přesto 21 dlaždic místo nástroje
        //   otevíralo kartu „Verze Pro". Přesně to hlásil uživatel 8. 9. 2026:
        //   „ani mi to neodemkne tu pro verzi, jenom vidím nějaký věci návrh".
        // ⚠⚠ ROZHODUJE VÝHRADNĚ VYDÁNÍ, NE TO, JESTLI JE PRO ODEMČENÉ.
        //   Nejdřív tu stálo i `if (maPro()) return;` — a byla by to nová vada:
        //   v balíčku ZÁKLAD Pro moduly VŮBEC NEJSOU, takže zástupná dlaždice je
        //   jediná zmínka o tom, že takový nástroj existuje, a jediná cesta na
        //   /pro/ (kartu s odkazem otevírá otevriKartu). Kdo si v Základu opíše
        //   klíč, přišel by tím o všechny ty řádky naráz.
        //   V balíčku PRO (co má vlastník) moduly jsou — a tam zástupce škodí.
        if (!jeZaklad()) return;
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
                // DOM nestačí: dlaždice se kreslí až za startem (js/field-tools.js),
                // takže se musíme zeptat i SEZNAMU registrovaných nástrojů.
                if (document.querySelector('[data-tool="' + k + '"]')) continue;
                if (window.agListFieldTools && agListFieldTools().indexOf(k) !== -1) continue;
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
    // ⚠ OD 12. 9. 2026 JE KARTA V ODLOŽENÉM js/pro-karta.js (celá obrazovka, křížek,
    //   žádost o Pro). Tady vzniká jen SKOŘÁPKA: #ag-pro-modal s názvem v .agp-nazev
    //   a křížkem — stojí hned po klepnutí (testy i člověk vidí odezvu okamžitě),
    //   obsah dokreslí AGProKarta.render(), jakmile je načtený. Rozpočet startu
    //   (scripts/check_start_budget.py) měl 2 kB rezervy; karta by se nevešla.
    function karta() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        styly();
        m = document.createElement('div');
        m.id = MODAL_ID;
        m.innerHTML =
            '<div class="agp-box" role="dialog" aria-modal="true">' +
            '  <div class="agp-top"><button type="button" class="agp-x" aria-label="Zavřít">&times;</button></div>' +
            '  <h2 class="agp-nazev"></h2>' +
            '  <p class="agp-pod">Načítám…</p>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('.agp-x').addEventListener('click', zavri);
        return m;
    }

    function zavri() {
        var m = document.getElementById(MODAL_ID);
        if (m) m.classList.remove('on');
    }

    // Otevření: název synchronně (podle registru), tělo z odložené vrstvy.
    // `opts` = { k: klíč nástroje } (klepnutí na zámek) nebo {} (přehled z Více).
    function ukaz(opts) {
        var m = karta();
        m._agOpts = opts;
        var nazev;
        if (opts.k) {
            var r = (window.AGReg && AGReg.get(opts.k)) || {};
            nazev = (r.help && r.help.t) || r.vl || opts.k;
        } else nazev = maPro() ? 'Verze Pro — odemčeno' : 'Verze Pro';
        var nz = m.querySelector('.agp-nazev');
        if (nz) nz.textContent = nazev;
        m.classList.add('on');
        var go = function () { try { if (window.AGProKarta) AGProKarta.render(m, opts); } catch (e) { swallow(e, 'karta'); } };
        if (window.AGProKarta) go();
        else if (window.AGLazy && typeof AGLazy.need === 'function') AGLazy.need('js/pro-karta.js', go);
        // (když soubor teprve běží, dokreslí se sám — viz konec js/pro-karta.js)
    }

    function otevriKartu(k) { ukaz({ k: k }); }

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

    function otevriPrehled() { ukaz({}); }

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

    window.AGProZamky = { oznac: oznac, karta: otevriKartu, prehled: otevriPrehled, zamceno: zamceno, koupit: otevriKoupi, jeTwa: jeTwa, zavri: zavri };
})();
