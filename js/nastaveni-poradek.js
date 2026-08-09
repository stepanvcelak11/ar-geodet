// ===== AR Geodet — POŘÁDEK V NASTAVENÍ (ODPOJITELNÁ VRSTVA) ======================
// PROBLÉM: záložky Nastavení jsou v index.html poskládané do sekcí (.set-h), jenže
// PŮLKA voleb do nich přiletí až za běhu z modulů — a ty skoro všechny končí
// `tab.appendChild(...)`. Výsledek: přepínače spadnou AŽ POD sbalené „Pokročilé",
// bez nadpisu, a jejich pořadí se řídí tím, který skript se zrovna načetl dřív.
// Stejně tak dva prvky nad záložkami (hledání z nastaveni-hledani.js a pruh
// profilů z profily.js) se oba vkládají před .tab-buttons, takže si pokaždé
// prohodí pořadí. Okno pak vypadá pokaždé jinak a nahodile.
//
// ŘEŠENÍ: jedno místo, které po každém otevření (a po každé změně DOM v okně)
// srovná obsah do PEVNÉHO pořadí:
//   • každý známý přisypaný řádek má svoji sekci (LAYOUT.put) — už nespadne na konec,
//   • sekce jdou v daném pořadí (LAYOUT.order), nezávisle na pořadí načtení skriptů,
//   • „Pokročilé" a „Zobrazit vše" jsou VŽDY úplně dole,
//   • co sem přisype modul, o kterém tenhle soubor neví, se nenechá pod „Pokročilé",
//     ale sesbírá se nad něj do sekce „Další volby" (viz strays) — takže i příští
//     modul zapadne do struktury, i když o něm nikdo neví.
//
// Nic se nepřejmenovává ani nemaže, jen stěhuje: saveSettings() v grafika.js i
// moduly čtou prvky podle id, takže přesun mezi sekcemi je pro ně neviditelný.
//
// Odstranění: smaž js/nastaveni-poradek.js + řádek <script> v index.html
// (a přegeneruj sw.js). Nastavení pak bude zase v pořadí načtení skriptů.
// ================================================================================
(function () {
    'use strict';
    if (window.AGSettingsOrder) return;

    // ---- co kam patří ------------------------------------------------------------------
    // order = pořadí sekcí v záložce (podle nadpisu .set-h; sekce, která v HTML není,
    //         se vytvoří teprve když do ní něco spadne)
    // put   = kam patří prvek přisypaný modulem. Klíč je id prvku NEBO id ovládacího
    //         prvku uvnitř řádku (moduly někdy id na řádek nedají, jen na checkbox).
    //         s = nadpis sekce, after = hned za řádek s tímhle id,
    //         i < 0 = na začátek sekce, i >= 0 = na konec (menší číslo vždy dřív)
    var LAYOUT = {
        'tab-vzhled': {
            order: ['Motiv a barvy', 'Displej a čitelnost', 'Ovládání', 'Prvky na obrazovce', 'Zjednodušení'],
            put: {
                'ag-glove-row': { s: 'Ovládání', after: 's-lefthand' },   // rukavice hned k levé ruce
                's-mapfab': { s: 'Prvky na obrazovce', i: 1 },        // tlačítko vrstev v mapě
                'ag-sp-row-set': { s: 'Prvky na obrazovce', i: 2 },        // stavová bublina
                'ag-ns-setrow': { s: 'Zjednodušení', i: 1 },              // krátké nastavení
                'ag-ts-setrow': { s: 'Zjednodušení', i: 2 },              // jednoduchý panel Nástrojů
                'ag-ua-simple-row': { s: 'Zjednodušení', i: 3 }               // zjednodušené Nástroje
                // 'ag-rp-setrow' se PŘESUNUL do záložky Profily (návrh C) — viz níž
            }
        },
        // ZÁLOŽKA PROFILY (návrh C): obě podobně pojmenované věci vedle sebe.
        // Sekce v panelu nejsou napsané v index.html — vyrobí je makeSec() podle
        // těchhle pravidel, takže když se modul odpojí, jeho nadpis vůbec nevznikne.
        'tab-profily': {
            order: ['Profil nastavení', 'Profil práce'],
            put: {
                'ag-prof-bar': { s: 'Profil nastavení', i: 1 },   // js/profily.js
                'ag-rp-setrow': { s: 'Profil práce', i: 1 }    // js/rezim-prace.js
            }
        },
        'tab-ar': {
            order: ['Body v AR kameře', 'Kompas a stabilita směru'],
            put: {
                'ag-arfusion-row': { s: 'Kompas a stabilita směru', i: -2 },  // nad tlačítko Kompas
                'agvt-settings-row': { s: 'Kompas a stabilita směru', i: -1 },
                'agp-card': { s: 'Kompas a stabilita směru', i: 9 }    // úspora baterie (vlastní nadpis)
            }
        },
        'tab-data': {
            order: ['Zakázka', 'Úřední body (ČÚZK)', 'Katastr a offline'],
            put: {
                'ag-dup-project-btn': { s: 'Zakázka', i: 1 },
                'ag-csync-sec': { s: 'Zakázka', i: 2 },   // firemní cloud (vlastní nadpis)
                'ag-quota': { s: 'Katastr a offline', i: 9 }    // zaplnění úložiště
            }
        },
        'tab-udrzba': {
            order: ['Skryté body', 'Záloha všech zakázek a nastavení', 'Úklid'],
            put: {
                'ag-dev-box': { s: 'Záloha všech zakázek a nastavení', i: 1 }  // profil zařízení
            }
        }
    };
    var STRAY_H = 'Další volby';     // sběrná sekce pro neznámé přírůstky

    function norm(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
        return s.replace(/\s+/g, ' ').trim();
    }
    function isHead(el) { return !!(el.classList && el.classList.contains('set-h')); }
    // „ocas" záložky — musí zůstat úplně dole
    function isTail(el) {
        return el.tagName === 'DETAILS'
            || !!(el.classList && el.classList.contains('ag-ns-more'));
    }
    // z id (klidně id checkboxu uvnitř) udělá PŘÍMÉHO potomka záložky, nebo null
    function rowOf(el, tab) {
        while (el && el.parentNode !== tab) el = el.parentNode;
        return (el && el.parentNode === tab) ? el : null;
    }
    function sameOrder(parent, want) {
        var k = parent.children;
        if (k.length !== want.length) return false;
        for (var i = 0; i < want.length; i++) if (k[i] !== want[i]) return false;
        return true;
    }

    // ---- rozbor záložky na sekce ---------------------------------------------------------
    function parse(tab) {
        var lead = [], secs = [], tail = [], strays = [], cur = null, seenTail = false;
        var kids = Array.prototype.slice.call(tab.children);
        for (var i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (isTail(el)) { tail.push(el); seenTail = true; continue; }
            // cokoli, co skončilo POD „Pokročilé", je přírůstek modulu — vytáhneme ho nahoru
            if (seenTail && !isHead(el)) { strays.push(el); continue; }
            if (isHead(el)) { cur = { h: el, t: norm(el.textContent), items: [] }; secs.push(cur); seenTail = false; continue; }
            if (cur) cur.items.push(el); else lead.push(el);
        }
        return { lead: lead, secs: secs, tail: tail, strays: strays };
    }
    function findSec(model, title) {
        var n = norm(title);
        for (var i = 0; i < model.secs.length; i++) if (model.secs[i].t === n) return model.secs[i];
        return null;
    }
    function makeSec(model, title) {
        var h = document.createElement('div');
        h.className = 'set-h';
        h.textContent = title;
        var sec = { h: h, t: norm(title), items: [], made: true };
        model.secs.push(sec);
        return sec;
    }
    // vytáhne prvek odkudkoli z modelu (vrací true, když ho našel)
    function detach(model, el) {
        var hit = false;
        function fromArr(a) { var i = a.indexOf(el); if (i !== -1) { a.splice(i, 1); hit = true; } }
        fromArr(model.lead); fromArr(model.strays); fromArr(model.tail);
        for (var i = 0; i < model.secs.length; i++) fromArr(model.secs[i].items);
        return hit;
    }

    // ---- srovnání jedné záložky ------------------------------------------------------------
    function arrangeTab(tabId) {
        var tab = document.getElementById(tabId);
        var spec = LAYOUT[tabId];
        if (!tab || !spec) return;
        var model = parse(tab);

        // 1) přisypané prvky do svých sekcí
        var planned = [];
        for (var id in spec.put) {
            if (!Object.prototype.hasOwnProperty.call(spec.put, id)) continue;
            var el = rowOf(document.getElementById(id), tab);
            if (!el) continue;                               // modul odpojený nebo vkládá jinam
            detach(model, el);
            planned.push({ el: el, r: spec.put[id] });
        }
        planned.sort(function (a, b) { return (a.r.i || 0) - (b.r.i || 0); });
        var front = {};                                      // kolik už je nahoře v které sekci
        planned.forEach(function (p) {
            var sec = findSec(model, p.r.s) || makeSec(model, p.r.s);
            if (p.r.after) {                                  // hned za konkrétní řádek
                for (var i = 0; i < sec.items.length; i++) {
                    var it = sec.items[i];
                    if (it.id === p.r.after || (it.querySelector && it.querySelector('#' + p.r.after))) {
                        sec.items.splice(i + 1, 0, p.el); return;
                    }
                }
            }
            if ((p.r.i || 0) < 0) {                           // nahoru, ale v pořadí podle i
                var n = front[sec.t] = (front[sec.t] || 0);
                sec.items.splice(n, 0, p.el);
                front[sec.t] = n + 1;
            } else sec.items.push(p.el);
        });

        // 2) přírůstky neznámých modulů (spadly pod „Pokročilé") → sběrná sekce
        if (model.strays.length) {
            var sc = findSec(model, STRAY_H) || makeSec(model, STRAY_H);
            model.strays.forEach(function (e) { sc.items.push(e); });
            model.strays = [];
        }

        // 3) pořadí sekcí: nejdřív podle LAYOUT.order, pak ty ostatní ve stávajícím pořadí
        var wantSecs = [], used = [];
        (spec.order || []).forEach(function (t) {
            var s = findSec(model, t);
            if (s && used.indexOf(s) === -1) { wantSecs.push(s); used.push(s); }
        });
        model.secs.forEach(function (s) {
            if (used.indexOf(s) !== -1) return;
            if (s.made && !s.items.length) return;          // prázdnou sekci nevyrábět
            wantSecs.push(s); used.push(s);
        });

        // 4) poskládat DOM (jen když se pořadí opravdu liší — jinak zbytečné přesuny)
        var want = model.lead.slice();
        wantSecs.forEach(function (s) {
            if (!s.items.length && s.made) return;
            want.push(s.h);
            s.items.forEach(function (e) { want.push(e); });
        });
        model.tail.forEach(function (e) { want.push(e); });
        if (sameOrder(tab, want)) return;
        want.forEach(function (e) { tab.appendChild(e); });
    }

    // ---- hlavička okna: nadpis → hledání → pruh záložek -------------------------------------
    // Pruh profilů se od návrhu C vkládá do ZÁLOŽKY „Profily", ne nad záložky, takže
    // tady většinou zbyde jen hledání. Větev s #ag-prof-bar zůstává kvůli starším
    // instalacím (a kdyby ta záložka někdy nebyla): oba prvky se totiž vkládaly
    // „před .tab-buttons" a bez tohohle si prohodily pořadí podle toho, kdo byl dřív.
    // ⚠⚠ NEKONEČNÁ SMYČKA (nahlášeno 9. 8. 2026: „kliknu na hledání, vyjede klávesnice
    // a hned mi spadne zase dolů"). Podmínka se dřív ptala na `(prof || tabs)`, ale
    // vkládalo se před `prof` jen tehdy, když prof leží v .modal-content. Od návrhu C
    // ale #ag-prof-bar žije v ZÁLOŽCE Profily — takže `prof` bylo pravdivé, srovnávalo
    // se s prvkem, který v hlavičce vůbec není, a pole hledání se přesouvalo znovu a
    // znovu. Každý přesun probudil MutationObserver → schedule → další přesun:
    // naměřeno 14 přesunů za 3 s. A přesun prvku SEBERE FOKUS, takže klávesnice
    // spadla dřív, než uživatel stiskl druhou klávesu.
    // Referenční prvek se proto počítá JEDNOU a použije se jak na porovnání, tak na
    // vložení — pak je funkce opravdu idempotentní.
    function arrangeHead() {
        var m = document.getElementById('settings-modal'); if (!m) return;
        var c = m.querySelector('.modal-content'); if (!c) return;
        var tabs = c.querySelector('.tab-buttons'); if (!tabs) return;
        var search = document.getElementById('ag-ns-search');
        var prof = document.getElementById('ag-prof-bar');
        var ref = (prof && prof.parentNode === c) ? prof : tabs;
        if (search && search.parentNode === c && search.nextElementSibling !== ref) c.insertBefore(search, ref);
        if (prof && prof.parentNode === c && prof.nextElementSibling !== tabs) c.insertBefore(prof, tabs);
    }

    // ---- život modulu ------------------------------------------------------------------------
    // BATERIE: MutationObserver níž hlídá CELÝ obsah Nastavení včetně podstromu, a do
    // Nastavení píší živé náhledy (stav GPS, kompas, profily…) i když je okno ZAVŘENÉ.
    // Přerovnání se tak spouštělo ~5×/s pořád dokola — naměřeno přes 2000 dotazů do DOM
    // za 20 s pro panel, na který se nikdo nedívá. Zavřené okno teď jen zvedne příznak
    // `_dirty` a skutečné srovnání proběhne až při otevření (viz níž wrapper openSettings
    // a hlídač zobrazení), takže uživatel dostane stejné pořadí, jen se pro to nedře celý den.
    var _busy = false, _timer = null, _dirty = false;
    function settingsVisible() {
        var m = document.getElementById('settings-modal');
        return !!(m && m.style && m.style.display && m.style.display !== 'none');
    }
    // POJISTKA k opravě arrangeHead() výše: přesun prvku v DOM sebere fokus všemu, co
    // je v něm — na mobilu se to projeví spadlou klávesnicí uprostřed psaní. Dokud
    // uživatel do Nastavení píše, srovnání se odloží; pořadí sekcí za rozepsaný text
    // nestojí. Retry si drží vlastní časovač, aby se srovnání po dopsání dohnalo i
    // bez další změny v DOM.
    function typingInSettings() {
        var a = document.activeElement;
        if (!a || a === document.body || !a.tagName) return false;
        if (a.tagName !== 'INPUT' && a.tagName !== 'TEXTAREA' && a.tagName !== 'SELECT') return false;
        var m = document.getElementById('settings-modal');
        return !!(m && m.contains(a));
    }
    // ⚠ PO STARTU SE SROVNÁVÁ I ZAVŘENÉ OKNO. Moduly se dosypávají do Nastavení ještě
    // dlouho po načtení (lazy-load) a dřív se na ně čekalo až do otevření — jenže to
    // znamená přeskládat obsah ve chvíli, kdy okno UŽ NAJÍŽDÍ (fade 0,28 s). Na rychlém
    // prohlížeči to nikdo nevidí, na telefonu se to projeví jako probliknutí starého
    // rozvržení. Po WARMUP ms od načtení se proto srovnává i naprázdno; pak už se šetří
    // baterie jako dřív (zavřené okno se nesrovnává, viz audit výkonu 9427482).
    var WARMUP = 25000, _load = Date.now();
    function warmingUp() { return (Date.now() - _load) < WARMUP; }
    function arrange() {
        if (_busy) return;
        if (!settingsVisible() && !warmingUp()) { _dirty = true; return; }
        if (typingInSettings()) {
            _dirty = true;
            if (!_timer) _timer = setTimeout(function () { _timer = null; arrange(); }, 900);
            return;
        }
        _dirty = false;
        _busy = true;
        try {
            arrangeHead();
            // Seznam záložek se bere z LAYOUT, ne natvrdo. Dřív tu byly vypsané čtyři
            // ids — nová záložka „Profily" se pak sice do LAYOUT zapsala, ale nikdy
            // se nesrovnala, takže její sekce vůbec nevznikly (8.8.2026).
            var ids = Object.keys(LAYOUT);
            for (var i = 0; i < ids.length; i++) arrangeTab(ids[i]);
        } catch (e) { console.warn('[nastaveni-poradek]', e); }
        _busy = false;
    }
    function schedule() {
        if (_busy || _timer) return;
        // zavřené okno nespěchá — delší prodleva svede víc dosypaných řádků do jednoho srovnání
        _timer = setTimeout(function () { _timer = null; arrange(); }, settingsVisible() ? 220 : 700);
    }
    function watch() {
        var m = document.getElementById('settings-modal'); if (!m) return false;
        var c = m.querySelector('.modal-content') || m;
        try {
            new MutationObserver(schedule).observe(c, { childList: true, subtree: true });
        } catch (e) { return false; }
        // ZÁCHYTNÁ SÍŤ k odloženému srovnání výše: okno se otevírá i jinudy než přes
        // openSettings() (dlaždice, zkratky, obnova stavu). Tenhle pozorovatel sleduje
        // jen atribut style samotného okna, takže tiká jen při skutečném otevření/zavření.
        try {
            new MutationObserver(function () {
                if (_dirty && settingsVisible()) arrange();
            }).observe(m, { attributes: true, attributeFilter: ['style', 'class'] });
        } catch (e3) {}
        // srovnat i při každém otevření (moduly dosypávají obsah až tam). Srovnáváme
        // SYNCHRONNĚ hned po otevření — okno už v tu chvíli je vidět a odložené srovnání
        // by se uživateli projevilo jako přeskládání obsahu pod rukama.
        try {
            var open = window.openSettings;
            if (typeof open === 'function' && !open.__agOrder) {
                var wrapped = function () {
                    var r = open.apply(this, arguments);
                    try { arrange(); } catch (e4) {}
                    // ještě jednou HNED v příštím snímku: otevření samo probouzí moduly,
                    // které si do Nastavení dosypou řádek — takhle se srovná dřív, než
                    // okno dojede do plné viditelnosti, ne až za 220 ms uprostřed fade.
                    try { requestAnimationFrame(function () { try { arrange(); } catch (e6) {} }); } catch (e5) {}
                    schedule();          // a naposled, až doběhne zbytek
                    return r;
                };
                wrapped.__agOrder = 1;
                window.openSettings = wrapped;
            }
        } catch (e2) {}
        arrange();
        return true;
    }
    function init() {
        if (!watch()) setTimeout(init, 600);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(arrange, 800); setTimeout(arrange, 2500); });

    window.AGSettingsOrder = { arrange: arrange, layout: LAYOUT };
})();
