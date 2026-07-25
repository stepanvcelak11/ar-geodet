// ===== AR Geodet — NOVÝ TUTORIÁL: základní + pokročilá prohlídka (ODPOJITELNÁ vrstva) =====
// Neinvazivní modul ve stylu ostatních odpojitelných vrstev (IIFE + try/catch +
// idempotentní + fail-silent). NEEDITUJE logika.js ani grafika.js. Má vlastní
// spotlight (coachmark) engine. NAHRAZUJE původní js/tutorial.js (ten je odpojený).
//
// Dvě prohlídky:
//   • ZÁKLADNÍ — ovládání: zobrazení (AR/Split/Mapa), stav & přesnost, kompas,
//     nový bod, body, nástroje, více, nastavení.
//   • POKROČILÁ — přehled nástrojů po kategoriích (Měření, Vytyčování,
//     Katastr a data, AR a kalibrace, Pomůcky), nápověda „?" na dlaždicích,
//     AR na terénu (DMR 5G), Průvodce úkolem.
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
    function closeAllModals() {
        MODAL_IDS.forEach(function (id) { var m = document.getElementById(id); if (m) m.style.display = 'none'; });
        var sm = document.getElementById('side-menu'); if (sm) sm.classList.remove('open');
        var bs = document.getElementById('bottom-sheet'); if (bs) bs.classList.remove('open');
    }

    // ---- kroky -----------------------------------------------------------------
    // {title, body, target?:selector|fn, before?:fn}  — bez target = vystředí kartu
    var BASIC = [
        { title: 'Vítej v AR&nbsp;Geodet', body: 'Krátká prohlídka základního ovládání. Posouvej tlačítkem <b>Další</b>.' },
        { title: 'Přepínání zobrazení', target: '#ag-view-wheel', body: 'Kolečko vpravo dole přepíná jedním klepnutím mezi <b>AR</b> kamerou, <b>Split</b> (dělené) a 2D <b>Mapou</b> — podle situace a baterie.' },
        { title: 'Stav a přesnost', target: '#gps-avg', body: 'Průměrovaná přesnost GPS — čím nižší ± metry, tím spolehlivější poloha. Klepnutím otevřeš detail měření.' },
        { title: 'Azimut a kompas', target: '#compass-debug', body: 'Aktuální azimut. Klepnutím otevřeš kalibraci kompasu a srovnání severu (důležité pro AR).' },
        { title: 'Nový bod', target: '.dock-primary', body: 'Založ vlastní bod — z <b>průměru GPS</b> (nejpřesnější), klepnutím do <b>mapy</b>, nebo přečtením z <b>fotky (OCR)</b>.' },
        { title: 'Body', target: '#dock button[onclick*="openManageModal"]', body: 'Správa bodů: seznam, <b>import/export</b> (CSV, GPX, GeoJSON…) a <b>sdílení přes QR</b>.' },
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
        {
            title: 'Měření', body: '<b>Brutální GPS</b> (dlouhé průměrování s otočkou 180° — nejpřesnější bod jen z mobilu), <b>Výška objektu</b>, <b>Epochy/monitoring</b> posunů, digitální <b>Zápisníky</b> (nivelace, směry), <b>oměrné</b>, <b>kubatury a vrstevnice</b>, optický dálkoměr, stopa trasy.',
            before: function () { closeAllModals(); var m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; }
        },
        {
            title: 'AR a kalibrace', body: 'Aby AR sedělo na skutečnost: <b>Srovnat sever</b> (1 bod), <b>Srovnat AR na 2 body</b>, <b>AR resekce</b> a <b>Volné stanovisko</b> (kde stojím?), <b>Protínání vpřed</b>, <b>Rajón</b>, <b>Lokalizace (Helmert)</b> pro usazení měření na dané body.',
            before: function () { closeAllModals(); var m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; }
        },
        {
            title: 'Vytyčování a náčrt', body: '<b>Vytyčovací checklist</b> s navigací na bod, <b>Vytyčení přímky</b> (odchylka + staničení), <b>Offset bod</b>, polní <b>náčrt/tachymetrie</b> a <b>Vrstvy/pokládka</b> pro kontrolu vrstev vozovky („Do tabletu: +X cm").',
            before: function () { closeAllModals(); var m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; }
        },
        {
            title: 'Katastr a data', body: '<b>Vektorový katastr</b> (hranice parcel z ČÚZK v mapě i AR), <b>import projektu/DXF</b>, hromadné <b>stažení bodů z výřezu mapy</b>, <b>podzemní sítě</b> („rentgen do země") a <b>poslat/načíst zakázku</b> souborem .argeo.',
            before: function () { closeAllModals(); var m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; }
        },
        {
            title: 'Pomůcky', body: '<b>Postupy měření</b> (tahák krok za krokem), <b>Předpisy &amp; odchylky</b> (offline limity z vyhlášek), <b>Urovnání stativu</b> (chytrá libela), <b>Predikce signálu</b> (kolik družic zbude u lesa/v zástavbě), kalkulačka, slovník.',
            before: function () { closeAllModals(); var m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; }
        },
        {
            title: 'AR sedí na terénu (DMR 5G)', body: 'V ovládání mapy zapni vrstvu <b>terén</b> — AR objekty a body si sednou na skutečný výškopis terénu místo ploché roviny. Lepší dojem hloubky ve svahu.',
            before: function () { closeAllModals(); }
        },
        {
            title: 'Průvodce úkolem', body: 'Nevíš, čím začít? V menu <b>Více → Průvodce úkolem</b> ti appka podle činnosti (vytyčování, sběr bodů, úřední body, měření) sama nachystá zakázku a správné nástroje.',
            before: function () { closeAllModals(); }
        },
        { title: 'Hotovo!', body: 'Skoro vše funguje <b>offline</b> a každý nástroj má návod pod <b>?</b> na dlaždici. Hodně zdaru v terénu. 📐' }
    ];

    // ---- engine ----------------------------------------------------------------
    var steps = [], idx = 0, curTargetSel = null, listening = false;

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
            // rozcestník
            '#agtp-pick .agtp-pick-grid{display:flex;flex-direction:column;gap:10px;margin:8px 0 4px;}',
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
        if (!rect) {
            top = Math.max(m, (vh - ch) / 2); left = Math.max(m, (vw - cw) / 2);
        } else {
            // pod cílem, jinak nad, jinak vystředit svisle
            if (rect.bottom + ch + m <= vh) top = rect.bottom + m;
            else if (rect.top - ch - m >= 0) top = rect.top - ch - m;
            else top = Math.max(m, (vh - ch) / 2);
            left = rect.left + rect.width / 2 - cw / 2;
            left = Math.max(m, Math.min(left, vw - cw - m));
        }
        card.style.top = Math.round(top) + 'px';
        card.style.left = Math.round(left) + 'px';
    }

    function positionFor(target) {
        var hole = document.getElementById('agtp-hole');
        if (target && visible(target)) {
            var r = target.getBoundingClientRect(), pad = 8;
            if (hole) {
                hole.style.top = Math.max(0, r.top - pad) + 'px';
                hole.style.left = Math.max(0, r.left - pad) + 'px';
                hole.style.width = (r.width + pad * 2) + 'px';
                hole.style.height = (r.height + pad * 2) + 'px';
                hole.classList.add('show');
            }
            placeCard({ top: Math.max(0, r.top - pad), bottom: r.bottom + pad, left: Math.max(0, r.left - pad), width: r.width + pad * 2 });
        } else {
            if (hole) hole.classList.remove('show');
            placeCard(null);
        }
    }

    function render() {
        var s = steps[idx]; if (!s) { finish(); return; }
        call(s.before);
        // počkej chvíli, ať se otevřený modal stihne vykreslit, pak pozicuj
        var doPos = function () {
            curTargetSel = (typeof s.target === 'string') ? s.target : null;
            var target = null;
            if (typeof s.target === 'function') { try { target = s.target(); } catch (e) {} }
            else if (typeof s.target === 'string') target = $(s.target);
            var card = document.getElementById('agtp-card');
            if (card) {
                card.querySelector('.agtp-t').innerHTML = s.title || '';
                card.querySelector('.agtp-b').innerHTML = s.body || '';
                card.querySelector('.agtp-count').textContent = (idx + 1) + ' / ' + steps.length;
                var back = card.querySelector('.agtp-back'); back.disabled = (idx === 0);
                card.querySelector('.agtp-next').textContent = (idx === steps.length - 1) ? 'Dokončit' : 'Další';
            }
            positionFor(target);
        };
        if (s.before) setTimeout(doPos, 90); else doPos();
    }

    function go(dir) {
        var n = idx + dir;
        if (n < 0) return;
        if (n >= steps.length) { finish(); return; }
        idx = n; render();
    }

    function reposition() {
        if (!steps.length) return;
        var target = curTargetSel ? $(curTargetSel) : null;
        positionFor(target);
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
        steps = []; curTargetSel = null;
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
        el.innerHTML =
            '<div class="modal-content" style="max-width:420px;">'
            + '<h3 style="color:var(--accent);margin-top:0;"><svg class="icon"><use href="#i-bulb"/></svg> Interaktivní návod</h3>'
            + '<p style="font-size:13px;opacity:.7;margin:2px 0 8px;">Vyber prohlídku. Procházej tlačítkem Další, kdykoli můžeš přeskočit.</p>'
            + '<div class="agtp-pick-grid">'
            + '  <button type="button" class="agtp-pick-b" id="agtp-go-basic">'
            + '    <span class="ic"><svg class="icon"><use href="#i-navigation"/></svg></span>'
            + '    <span><h4>Základní prohlídka</h4><p>Ovládání appky: zobrazení, nový bod, body, nástroje, nastavení, přesnost a kompas.</p></span>'
            + '  </button>'
            + '  <button type="button" class="agtp-pick-b" id="agtp-go-adv">'
            + '    <span class="ic"><svg class="icon"><use href="#i-ruler"/></svg></span>'
            + '    <span><h4>Pokročilé nástroje</h4><p>Parcela &amp; dělení, terénní nástroje, AR resekce, kubatury/vrstevnice, oměrné, import DXF, AR na terénu.</p></span>'
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
    function maybeStart() {
        var seen = false; try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) {}
        if (seen) return;
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
        autoFirstRun = true;
        setTimeout(function () { startTour(BASIC); }, 700);
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
    });
})();
