// ===== AR Geodet — NOVÝ TUTORIÁL: základní + pokročilá prohlídka (ODPOJITELNÁ vrstva) =====
// Neinvazivní modul ve stylu ostatních odpojitelných vrstev (IIFE + try/catch +
// idempotentní + fail-silent). NEEDITUJE logika.js ani grafika.js. Má vlastní
// spotlight (coachmark) engine. NAHRAZUJE původní js/tutorial.js (ten je odpojený).
//
// Dvě prohlídky:
//   • ZÁKLADNÍ — ovládání: zobrazení (AR/Split/Mapa), vrstvy v mapě, stavová
//     bublina, nový bod, body, nástroje, více, nastavení.
//   • POKROČILÁ — přehled nástrojů po kategoriích (Měření, Vytyčování,
//     Katastr a data, AR a kalibrace, Pomůcky), nápověda „?" na dlaždicích,
//     AR na terénu (DMR 5G), Průvodce úkolem.
//
// POZOR: kroky citují konkrétní tlačítka a názvy nástrojů — po každé změně UI
// (přesun tlačítka, přejmenování nástroje, nová dlaždice) sem koukni, jinak
// prohlídka ukazuje na něco, co tam už není.
//
// Vstup: existující tlačítko „Návod a prohlídka" v menu „Více" (modul převezme
//   window.startTutorial), nebo přímo:
//   window.agOpenTutorialPro()  — rozcestník
//   window.agStartBasicTour()   — rovnou základní
//   window.agStartAdvancedTour()— rovnou pokročilá
// Auto-start ZÁKLADNÍ prohlídky na 1. spuštění (flag agTutProSeen).
//
// Odstranění: smaž js/tutorial-pro.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agTutProInit) return;
    window.__agTutProInit = true;

    // ---- pomocné ---------------------------------------------------------------
    function $(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
    function visible(el) {
        if (!el) return false;
        try {
            var cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
            var r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return false;
            if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
            return true;
        } catch (e) { return false; }
    }
    function call(fn) { try { if (typeof fn === 'function') fn(); } catch (e) {} }
    function callGlobal(name) { try { if (typeof window[name] === 'function') { window[name](); return true; } } catch (e) {} return false; }

    var MODAL_IDS = ['tools-modal', 'measure-modal', 'custom-modal-overlay', 'manage-modal', 'settings-modal',
        'dict-modal', 'compass-modal', 'cluster-modal', 'nearby-modal', 'about-modal', 'agpc-modal'];
    function closeAllModals(exceptId) {
        MODAL_IDS.forEach(function (id) { if (id === exceptId) return; var m = document.getElementById(id); if (m) m.style.display = 'none'; });
        var sm = document.getElementById('side-menu'); if (sm) sm.classList.remove('open');
        var bs = document.getElementById('bottom-sheet'); if (bs) bs.classList.remove('open');
    }
    // Nástroje nechat otevřené mezi kroky — zavřít+otevřít by pokaždé přehrálo
    // nájezdovou animaci modálu (poskakování). Vrací true, když se teď otevíraly.
    function showTools() {
        closeAllModals('tools-modal');
        var m = document.getElementById('tools-modal');
        if (m && m.style.display !== 'flex') { m.style.display = 'flex'; return true; }
        return false;
    }
    // Krok s kategorií Nástrojů: otevřít modal, srolovat na nadpis kategorie a ten zvýraznit.
    function catStep(name) {
        return {
            before: function () {
                var opened = showTools();
                // roluje se až po doběhnutí nájezdu modálu, jinak se cíl trefí uprostřed animace
                setTimeout(function () {
                    try {
                        var el = findCat(name);
                        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
                    } catch (e) {}
                }, opened ? 400 : 30);
            },
            target: function () { return findCat(name); }
        };
    }
    function findCat(name) {
        var cats = document.querySelectorAll('#tools-modal .tool-cat');
        for (var i = 0; i < cats.length; i++) {
            if ((cats[i].textContent || '').trim().toLowerCase().indexOf(name.toLowerCase()) === 0) return cats[i];
        }
        return null;
    }

    // ---- kroky -----------------------------------------------------------------
    // {title, body, target?:selector|fn, before?:fn}  — bez target = vystředí kartu
    var BASIC = [
        { title: 'Vítej v AR&nbsp;Geodet', body: 'Krátká prohlídka základního ovládání. Posouvej tlačítkem <b>Další</b>.' },
        { title: 'Přepínání zobrazení', target: '#ag-view-wheel', body: 'Kolečko vpravo dole přepíná jedním klepnutím mezi <b>AR</b> kamerou, <b>Split</b> (dělené) a 2D <b>Mapou</b> — podle situace a baterie.' },
        { title: 'Vrstvy v mapě', target: '#map-ctrl-toggle', body: 'Tlačítko <b>Vrstvy</b> vlevo dole v mapě: přepnutí <b>mapa / ortofoto</b>, zapnutí <b>katastru</b> a <b>terénu (DMR 5G)</b> a nástroje mapy (na mě, body v okolí, spojit body, měřit plochu, uložit offline). Odznak ukazuje, kolik vrstev je zapnutých.' },
        {
            // stavová bublina sloučila přesnost i azimut do jednoho prvku; kdyby ji měl
            // uživatel vypnutou, ukaž původní panel průměrování GPS
            title: 'Stav měření',
            target: function () {
                var b = document.getElementById('ag-sp');
                if (b && b.classList.contains('ag-sp-on')) return b;
                return document.getElementById('gps-avg');
            },
            body: 'Jedna bublina nahoře: <b>semafor</b> (barva nejhoršího ze stavů GPS · sever · data · baterie), <b>přesnost</b> a <b>azimut</b>. Klepnutím se rozbalí detail s radami a tlačítky <b>Srovnat sever</b>, <b>Detail GPS</b> a <b>Skóre místa</b>.'
        },
        { title: 'Nový bod', target: '.dock-primary', body: 'Založ vlastní bod. Nahoře ve formuláři jsou čtyři dlaždice, odkud vzít souřadnice: <b>Z průměru GPS</b> (běžná volba), <b>Z mapy</b>, <b>Z fotky (OCR)</b> a <b>Přesná GPS</b> (dlouhé průměrování). Podržením tlačítka založíš místo bodu <b>závadu</b>.' },
        { title: 'Body', target: '#dock button[onclick*="openManageModal"]', body: 'Seznam bodů a pod <b>Export / Import</b> mřížka akcí: import souboru, <b>PDF protokol</b>, <b>sdílet QR</b> a <b>načíst QR</b>. Formát exportu (CSV, GPX, GeoJSON, DXF…) vybíráš posuvníkem nad nimi.' },
        { title: 'Nástroje', target: '#dock button[onclick*="tools-modal"]', body: 'Měření vzdálenosti a plochy, kalkulačka, GNSS satelity, vytyčovací checklist, náčrt — a nové pokročilé nástroje.' },
        { title: 'Více', target: '#dock-vice-btn', body: '<b>Průvodce úkolem</b>, uložení okolí offline, návody, zpravodaj a chytré vyhledávání funkcí appky.' },
        { title: 'Nastavení', target: '#dock button[onclick*="openSettings"]', body: 'Vzhled (motiv, barvy, prvky na obrazovce), <b>AR &amp; přesnost</b> (FOV, vyhlazení, fúze gyra) a správa zakázek a dat.' },
        { title: 'Základ máš za sebou', body: 'Pokračuj <b>Pokročilou prohlídkou</b> — ukáže nové geodetické nástroje, které appka umí navíc.' }
    ];

    var ADV = [
        { title: 'Pokročilé nástroje', body: 'Co appka umí navíc — sada geodetických nástrojů v sekci <b>Nástroje</b>. Tip: každá dlaždice má vpravo nahoře <b>?</b> s krátkým návodem, hvězdičkou ⭐ si oblíbené držíš nahoře.' },
        {
            title: 'Sekce Nástroje', target: '#dock button[onclick*="tools-modal"]',
            body: 'Nástroje jsou řazené do kategorií: <b>Měření</b>, <b>Vytyčování a náčrt</b>, <b>Katastr a data</b>, <b>AR a kalibrace</b> a <b>Pomůcky</b>.',
            before: function () { closeAllModals(); }
        },
        Object.assign(catStep('Měření'), {
            title: 'Měření', body: '<b>Brutální GPS</b> (dlouhé průměrování — ve čtvrtinách doby vyzve otočit telefon o 90°, tím vyruší odrazy), <b>Dvoutelefonní DGPS</b> (korekce z druhého mobilu), <b>Skóre místa</b> a <b>GNSS předpověď</b> (kdy a kde měřit), <b>Korekce měření</b> (pásmo, ppm, refrakce), <b>Výška objektu</b>, <b>Epochy/monitoring</b> posunů, <b>Zápisníky</b> (nivelace, směry), oměrné, kubatury a vrstevnice, stopa trasy.'
        }),
        Object.assign(catStep('AR a kalibrace'), {
            title: 'AR a kalibrace', body: 'Aby AR sedělo na skutečnost: <b>Srovnat sever</b> (1 bod), <b>Srovnat AR na 2 body</b>, <b>AR resekce</b> a <b>Volné stanovisko</b> (kde stojím?), <b>Protínání vpřed</b>, <b>Rajón</b>, <b>Lokalizace (Helmert)</b> pro usazení měření na dané body.'
        }),
        Object.assign(catStep('Vytyčování'), {
            title: 'Vytyčování a náčrt', body: '<b>Vytyčovací checklist</b> s navigací na bod a CSV protokolem, <b>Vytyčení přímky</b> (staničení + kolmý odstup), <b>Offset bod</b>, polní <b>náčrt/tachymetrie</b>, <b>Závady/hlášení</b> (foto + kategorie, jde vázat na konkrétní bod) a <b>Vrstvy/pokládka</b> pro kontrolu vrstev vozovky („Do tabletu: +X cm").'
        }),
        Object.assign(catStep('Katastr a data'), {
            title: 'Katastr a data', body: '<b>Vektorový katastr</b> (hranice parcel z ČÚZK v mapě i AR), <b>import projektu/DXF</b>, hromadné <b>stažení bodů z výřezu mapy</b>, <b>podzemní sítě</b> („rentgen do země") a <b>poslat/načíst zakázku</b> souborem .argeo.'
        }),
        Object.assign(catStep('Pomůcky'), {
            title: 'Pomůcky', body: 'Denní nutnosti: <b>Dnešek v terénu</b> (ranní brífink), <b>Počasí</b> a <b>Bezpečnost</b>, <b>Slunce a světlo</b> (kolik zbývá dne), <b>Co s sebou</b>, <b>Kde mám auto</b>, <b>Kniha jízd</b>, <b>Hlasové poznámky</b> s přepisem a večerní <b>Deník dne</b>. Dál <b>Příručka</b> (postupy, předpisy, slovník), <b>Signál GNSS</b> a ve firemním režimu <b>Docházka</b>, <b>Firemní chat</b> a <b>Firma a účty</b>.'
        }),
        {
            title: 'AR sedí na terénu (DMR 5G)', target: '#map-ctrl-toggle',
            body: 'Tlačítkem <b>Vrstvy</b> v mapě zapni <b>Terén (DMR 5G)</b> — AR objekty a body si sednou na skutečný výškopis místo ploché roviny. Lepší dojem hloubky ve svahu. Ve stejném panelu je i katastr, ortofoto a vlastní podklad.',
            before: function () { closeAllModals(); }
        },
        {
            title: 'Průvodce úkolem', target: '#dock-vice-btn',
            body: 'Nevíš, čím začít? V menu <b>Více → Průvodce úkolem</b> ti appka podle činnosti (vytyčování, sběr bodů, úřední body, měření) sama nachystá zakázku a správné nástroje.',
            before: function () { closeAllModals(); }
        },
        { title: 'Hotovo!', body: 'Skoro vše funguje <b>offline</b> a každý nástroj má návod pod <b>?</b> na dlaždici. Hodně zdaru v terénu. 📐' }
    ];

    // ---- engine ----------------------------------------------------------------
    var steps = [], idx = 0, curTarget = null, listening = false, renderToken = 0;
    function resolveTarget(t) {
        if (typeof t === 'function') { try { return t(); } catch (e) { return null; } }
        if (typeof t === 'string') return $(t);
        return null;
    }

    function injectStyles() {
        if (document.getElementById('agtp-style')) return;
        var st = document.createElement('style'); st.id = 'agtp-style';
        st.textContent = [
            '#agtp-block{position:fixed;inset:0;z-index:200000;display:none;background:transparent;}',
            '#agtp-block.show{display:block;}',
            '#agtp-hole{position:fixed;z-index:200001;display:none;border-radius:14px;pointer-events:none;',
            '  box-shadow:0 0 0 9999px rgba(6,10,14,0.72);border:2px solid var(--accent,#2f9e74);',
            '  transition:top .25s,left .25s,width .25s,height .25s;}',
            '#agtp-hole.show{display:block;}',
            '#agtp-card{position:fixed;z-index:200002;display:none;max-width:min(86vw,360px);box-sizing:border-box;',
            '  background:var(--bg-elev,#171b20);color:var(--text-color,#e8edf2);border:1px solid var(--glass-border,rgba(255,255,255,.12));',
            '  border-radius:16px;padding:16px 16px 12px;box-shadow:0 16px 44px rgba(0,0,0,.6);',
            '  font:400 14px/1.5 var(--font-ui,system-ui),sans-serif;}',
            '#agtp-card.show{display:block;}',
            '#agtp-card .agtp-t{font:800 17px/1.25 var(--font-display,var(--font-ui,system-ui)),sans-serif;color:var(--accent,#2f9e74);margin:0 0 6px;}',
            '#agtp-card .agtp-b{margin:0 0 12px;opacity:.95;}',
            '#agtp-card .agtp-b b{color:var(--text-color,#fff);}',
            '#agtp-card .agtp-f{display:flex;align-items:center;gap:8px;}',
            '#agtp-card .agtp-count{font:600 12px/1 var(--font-mono,monospace);opacity:.6;margin-right:auto;}',
            '#agtp-card .agtp-skip{background:none;border:none;color:var(--text-muted,#9aa1ac);font-size:13px;cursor:pointer;padding:8px 6px;text-decoration:underline;}',
            '#agtp-card .agtp-btn{border:none;border-radius:10px;padding:9px 16px;font:700 14px/1 var(--font-ui,system-ui),sans-serif;cursor:pointer;}',
            '#agtp-card .agtp-back{background:var(--surface-2,rgba(255,255,255,.09));color:var(--text-color,#e8edf2);}',
            '#agtp-card .agtp-next{background:var(--accent,#2f9e74);color:#04110b;}',
            '#agtp-card .agtp-back:disabled{opacity:.4;cursor:default;}',
            // rozcestník — mřížka vyplní výšku fullscreen modálu (stejný vzor jako .modal-body),
            // takže „Zavřít" sedí dole jako pevná patička (margin-top:auto na iOS zlobí)
            '#agtp-pick .agtp-pick-grid{display:flex;flex-direction:column;gap:10px;margin:8px 0 4px;flex:1 1 auto;min-height:0;overflow-y:auto;}',
            '#agtp-pick .agtp-pick-b{display:flex;align-items:flex-start;gap:12px;text-align:left;padding:14px;border-radius:14px;cursor:pointer;',
            '  background:var(--surface-2,rgba(255,255,255,.06));border:1px solid var(--glass-border,rgba(255,255,255,.12));color:var(--text-color,#e8edf2);}',
            '#agtp-pick .agtp-pick-b:active{transform:scale(.99);}',
            '#agtp-pick .agtp-pick-b .ic{flex:0 0 38px;height:38px;width:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;',
            '  background:var(--accent-soft,rgba(47,158,116,.16));color:var(--accent,#2f9e74);}',
            '#agtp-pick .agtp-pick-b .ic svg{width:22px;height:22px;}',
            '#agtp-pick .agtp-pick-b h4{margin:0 0 2px;font:700 15px/1.2 var(--font-ui,system-ui),sans-serif;}',
            '#agtp-pick .agtp-pick-b p{margin:0;font-size:12.5px;opacity:.72;line-height:1.4;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    function buildUI() {
        if (document.getElementById('agtp-card')) return;
        injectStyles();
        var block = document.createElement('div'); block.id = 'agtp-block';
        var hole = document.createElement('div'); hole.id = 'agtp-hole';
        var card = document.createElement('div'); card.id = 'agtp-card';
        card.innerHTML =
            '<h3 class="agtp-t"></h3>'
            + '<div class="agtp-b"></div>'
            + '<div class="agtp-f">'
            + '  <span class="agtp-count"></span>'
            + '  <button type="button" class="agtp-skip">Přeskočit</button>'
            + '  <button type="button" class="agtp-btn agtp-back">Zpět</button>'
            + '  <button type="button" class="agtp-btn agtp-next">Další</button>'
            + '</div>';
        document.body.appendChild(block);
        document.body.appendChild(hole);
        document.body.appendChild(card);
        card.querySelector('.agtp-skip').addEventListener('click', finish);
        card.querySelector('.agtp-back').addEventListener('click', function () { go(-1); });
        card.querySelector('.agtp-next').addEventListener('click', function () { go(1); });
        block.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    function show(on) {
        ['agtp-block', 'agtp-card'].forEach(function (id) { var el = document.getElementById(id); if (el) el.classList.toggle('show', on); });
        if (!on) { var h = document.getElementById('agtp-hole'); if (h) h.classList.remove('show'); }
    }

    function placeCard(rect) {
        var card = document.getElementById('agtp-card'); if (!card) return;
        var cw = card.offsetWidth || 320, ch = card.offsetHeight || 160;
        var vw = window.innerWidth, vh = window.innerHeight, m = 12;
        var top, left;
        function clampv(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
        if (!rect) {
            top = Math.max(m, (vh - ch) / 2); left = Math.max(m, (vw - cw) / 2);
        } else if (rect.left > vw * 0.6 && rect.left - cw - m >= 0) {
            // cíl u pravého okraje (svislý dok): karta VLEVO od něj, svisle na střed cíle
            // — karta pod tlačítkem doku by zakryla zbytek doku
            left = rect.left - cw - m;
            top = clampv(rect.top + (rect.bottom - rect.top) / 2 - ch / 2, m, vh - ch - m);
        } else if (rect.right < vw * 0.4 && rect.right + cw + m <= vw) {
            // totéž zrcadlově (režim levé ruky — dok u levého okraje)
            left = rect.right + m;
            top = clampv(rect.top + (rect.bottom - rect.top) / 2 - ch / 2, m, vh - ch - m);
        } else {
            // pod cílem, jinak nad, jinak vystředit svisle
            if (rect.bottom + ch + m <= vh) top = rect.bottom + m;
            else if (rect.top - ch - m >= 0) top = rect.top - ch - m;
            else top = Math.max(m, (vh - ch) / 2);
            left = rect.left + rect.width / 2 - cw / 2;
            left = clampv(left, m, vw - cw - m);
        }
        card.style.top = Math.round(top) + 'px';
        card.style.left = Math.round(left) + 'px';
    }

    function positionFor(target) {
        var hole = document.getElementById('agtp-hole');
        if (target && visible(target)) {
            var r = target.getBoundingClientRect(), pad = 8;
            var pr = { top: Math.max(0, r.top - pad), bottom: r.bottom + pad, left: Math.max(0, r.left - pad), right: r.right + pad, width: r.width + pad * 2 };
            if (hole) {
                hole.style.top = pr.top + 'px';
                hole.style.left = pr.left + 'px';
                hole.style.width = pr.width + 'px';
                hole.style.height = (r.height + pad * 2) + 'px';
                hole.classList.add('show');
            }
            placeCard(pr);
        } else {
            if (hole) hole.classList.remove('show');
            placeCard(null);
        }
    }

    function render() {
        var s = steps[idx]; if (!s) { finish(); return; }
        var token = ++renderToken;
        call(s.before);
        // počkej chvíli, ať se otevřený modal stihne vykreslit, pak pozicuj
        var doPos = function () {
            if (token !== renderToken) return; // mezitím se šlo na jiný krok
            curTarget = s.target || null;
            var card = document.getElementById('agtp-card');
            if (card) {
                card.querySelector('.agtp-t').innerHTML = s.title || '';
                card.querySelector('.agtp-b').innerHTML = s.body || '';
                card.querySelector('.agtp-count').textContent = (idx + 1) + ' / ' + steps.length;
                var back = card.querySelector('.agtp-back'); back.disabled = (idx === 0);
                card.querySelector('.agtp-next').textContent = (idx === steps.length - 1) ? 'Dokončit' : 'Další';
            }
            positionFor(resolveTarget(curTarget));
        };
        if (s.before) setTimeout(doPos, 90); else doPos();
        // dopozicování po doběhnutí animací (nájezd modálu 0,34 s + scrollIntoView) —
        // dřív se cíl trefil uprostřed animace a rámeček/karta zůstaly rozhozené
        setTimeout(function () { if (token === renderToken && steps.length) positionFor(resolveTarget(curTarget)); }, 560);
    }

    function go(dir) {
        var n = idx + dir;
        if (n < 0) return;
        if (n >= steps.length) { finish(); return; }
        idx = n; render();
    }

    function reposition() {
        if (!steps.length) return;
        positionFor(resolveTarget(curTarget));
    }

    function startTour(arr) {
        if (!arr || !arr.length) return;
        buildUI();
        closeAllModals();
        steps = arr; idx = 0;
        show(true);
        if (!listening) {
            window.addEventListener('resize', reposition);
            window.addEventListener('orientationchange', reposition);
            window.addEventListener('scroll', reposition, true);
            listening = true;
        }
        render();
    }

    function finish() {
        show(false);
        closeAllModals();
        var wasAuto = autoFirstRun; autoFirstRun = false;
        steps = []; curTarget = null;
        if (listening) {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('orientationchange', reposition);
            window.removeEventListener('scroll', reposition, true);
            listening = false;
        }
        // po onboardingu na 1. spuštění nabídni kalibraci kompasu (jako původní tutoriál)
        if (wasAuto) { try { if (typeof window.showCompassCalibHint === 'function') setTimeout(function () { window.showCompassCalibHint(); }, 400); } catch (e) {} }
    }

    // ---- rozcestník (chooser) --------------------------------------------------
    function ensurePicker() {
        if (document.getElementById('agtp-pick')) return;
        injectStyles();
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agtp-pick'; el.style.zIndex = '199000';
        // BEZ inline max-width: modaly jsou v appce fullscreen (.modal-overlay .modal-content
        // width/height 100 %) — zúžená karta s výškou 100 % vypadala jako rozbitý pás.
        // „Zavřít" je pevná patička dole (margin-top:auto) jako u ostatních modálů.
        el.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;"><svg class="icon"><use href="#i-bulb"/></svg> Interaktivní návod</h3>'
            + '<p style="font-size:13px;opacity:.7;margin:2px 0 8px;">Vyber prohlídku. Procházej tlačítkem Další, kdykoli můžeš přeskočit.</p>'
            + '<div class="agtp-pick-grid">'
            + '  <button type="button" class="agtp-pick-b" id="agtp-go-basic">'
            + '    <span class="ic"><svg class="icon"><use href="#i-navigation"/></svg></span>'
            + '    <span><h4>Základní prohlídka</h4><p>Ovládání appky: zobrazení, nový bod, body, nástroje, nastavení, přesnost a kompas.</p></span>'
            + '  </button>'
            + '  <button type="button" class="agtp-pick-b" id="agtp-go-adv">'
            + '    <span class="ic"><svg class="icon"><use href="#i-ruler"/></svg></span>'
            + '    <span><h4>Pokročilé nástroje</h4><p>Co appka umí navíc: Brutální GPS a DGPS, parcela &amp; dělení, AR resekce a kalibrace, kubatury/vrstevnice, import DXF, katastr v AR i denní pomůcky.</p></span>'
            + '  </button>'
            + '</div>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" id="agtp-pick-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        $('#agtp-go-basic', el).addEventListener('click', function () { closePicker(); startTour(BASIC); });
        $('#agtp-go-adv', el).addEventListener('click', function () { closePicker(); startTour(ADV); });
        $('#agtp-pick-close', el).addEventListener('click', closePicker);
        el.addEventListener('click', function (e) { if (e.target === el) closePicker(); });
    }
    function openPicker() { ensurePicker(); var el = document.getElementById('agtp-pick'); if (el) el.style.display = 'flex'; }
    function closePicker() { var el = document.getElementById('agtp-pick'); if (el) el.style.display = 'none'; }

    // ---- první spuštění (auto-start ZÁKLADNÍ prohlídky) ------------------------
    var SEEN_KEY = 'agTutProSeen';
    var autoFirstRun = false;
    var waiting = false;

    // Přes bránu přihlášení, průvodce založením firmy ani úvodní obrazovku prohlídku
    // spustit nejde — uživatel by ji neviděl a „viděno" by se přesto zapsalo.
    function startBlocked() {
        if (document.getElementById('ag-gate') || document.getElementById('ag-login')) return true;
        var wiz = document.getElementById('agfa-modal');
        if (wiz && wiz.style.display === 'flex') return true;
        var w = document.getElementById('welcome-screen');
        if (w && w.style.display !== 'none') return true;
        return false;
    }
    function maybeStart() {
        var seen = false; try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) {}
        if (seen || waiting) return;
        waiting = true;
        var waited = 0;
        (function attempt() {
            if (startBlocked()) {
                waited += 500;
                if (waited > 180000) { waiting = false; return; }   // vzdáno, „viděno" se nezapisuje
                setTimeout(attempt, 500);
                return;
            }
            waiting = false;
            setTimeout(function () {
                if (startBlocked()) { maybeStart(); return; }   // mezitím naskočila brána
                try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
                autoFirstRun = true;
                startTour(BASIC);
            }, 700);
        })();
    }

    // ---- veřejné API (modul NAHRAZUJE původní js/tutorial.js) ------------------
    window.agOpenTutorialPro = openPicker;
    window.agStartBasicTour = function () { startTour(BASIC); };
    window.agStartAdvancedTour = function () { startTour(ADV); };
    window.agCloseTutorialPro = function () { finish(); closePicker(); };
    // Převzetí vstupů původního tutoriálu — tlačítko „Návod a prohlídka" v menu Více:
    window.startTutorial = function () {
        var sm = document.getElementById('settings-modal'); if (sm) sm.style.display = 'none';
        var menu = document.getElementById('side-menu'); if (menu) menu.classList.remove('open');
        setTimeout(openPicker, 60);
    };
    window.maybeStartTutorial = maybeStart;

    // Auto-start po prvním spuštění z úvodní obrazovky — obalíme startAppFromWelcome
    // (stejný princip jako původní tutorial.js, který je teď odpojený).
    window.addEventListener('load', function () {
        var orig = window.startAppFromWelcome;
        if (typeof orig === 'function' && !orig.__agtpWrapped) {
            var wrapped = function () { var r = orig.apply(this, arguments); try { maybeStart(); } catch (e) {} return r; };
            wrapped.__agtpWrapped = true;
            window.startAppFromWelcome = wrapped;
        }
        // Pojistka: kdyby se do appky vstoupilo jinudy než tlačítkem na úvodní
        // obrazovce, hlídač si stejně počká, až bude na prohlídku vidět.
        setTimeout(maybeStart, 2500);
    });
})();
