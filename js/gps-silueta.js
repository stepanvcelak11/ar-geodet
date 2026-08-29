// ===== AR Geodet — SILUETA PŘESNOSTI GPS (ODPOJITELNÁ vrstva) ===================
// PROČ: přesnost se dosud hlásila jen číslem („±4,0 m"). Číslo ale samo o sobě
// neřekne, JAK MOC to je — kdo nemá v hlavě měřítko, nepozná rozdíl mezi ±2 m
// a ±12 m, dokud si bod neuloží špatně. Tenhle modul kreslí do rohu obrazovky
// postavu stojící na zemi a kolem ní kruh na zemi = oblast, kde se člověk podle
// telefonu právě může nacházet. Kruh těsně u nohou = dobré. Kruh přes celou
// kartu = „jsi někde tady". Pochopí to i ten, kdo číslo nečte.
//
// JAK SE TO ČTE:
//   • TEČKOVANÁ značka je pevná a odpovídá 5 m — hranici, kterou appka používá
//     všude jinde (stavová bublina: ≤5 m zelená, ≤15 m žlutá, víc červená).
//   • Plný kruh je aktuální přesnost. Uvnitř tečkované = měř. Venku = počkej.
//   • Barva kruhu drží STEJNÉ prahy jako stavová bublina, ať si dva ukazatele
//     neodporují.
//
// MĚŘÍTKO: poloměr neroste lineárně (±50 m by se do rohu nevešlo), ale sytící
// křivkou R = RMAX·a/(a+K). Do 5 m je růst skoro lineární — tam se rozhoduje —
// a nad 15 m už se kruh jen doplazí k okraji. Postava má NAOPAK stálou velikost:
// je to měřítko, které se uživatel naučí („kruh užší než ramena = výborné").
//
// Odstranění: smaž js/gps-silueta.js + css/gps-silueta.css, jejich řádky
// v index.html a v sw.js (přegeneruj scripts/gen_sw_assets.py) a řádek
// 'ag-sil-setrow' v js/nastaveni-poradek.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGSilueta) return;

    var KEY = 'agSiluetaOn_v1';     // '1' / '0' — přepínač v Nastavení → Vzhled
    var BOX_ID = 'ag-sil';
    var ROW_ID = 'ag-sil-setrow';

    // ---- měřítko kruhu -------------------------------------------------------------
    // viewBox je 120 × 92; střed scény (CX, GY) níž = místo, kde postava stojí.
    var RMAX = 54;      // poloměr, ke kterému se křivka blíží (dosáhne okraje karty)
    var KSAT = 3.2;     // „polovina" nasycení — čím menší, tím dřív se růst zpomalí
    var REF_M = 5;      // pevná tečkovaná značka = hranice, od které appka varuje

    function radiusFor(m) {
        if (!(m > 0)) return 0;
        return RMAX * m / (m + KSAT);
    }
    var R_REF = radiusFor(REF_M);

    // ---- stav GPS ------------------------------------------------------------------
    // Prahy schválně SHODNÉ se stavovou bublinou (js/stavovy-pruh.js), jinak by
    // dva ukazatele na jedné obrazovce tvrdily každý něco jiného.
    function acc() {
        try {
            if (typeof currentGpsAccuracy === 'number' && currentGpsAccuracy > 0) return currentGpsAccuracy;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-silueta:acc'); }
        return null;
    }
    function haveFix() {
        try {
            return (typeof userLat !== 'undefined' && userLat != null &&
                typeof userLng !== 'undefined' && userLng != null);
        } catch (e) { return false; }
    }
    function level(a) {
        if (a == null) return 'none';
        if (a <= 5) return 'ok';
        if (a <= 15) return 'warn';
        return 'bad';
    }
    function metry(a) {
        // jedno desetinné místo do 10 m, výš celé metry — jako jinde v appce
        if (a == null) return '—';
        return (a < 10 ? a.toFixed(1).replace('.', ',') : String(Math.round(a))) + ' m';
    }
    function slovy(a, lvl) {
        if (lvl === 'none') return 'zatím bez fixu GPS';
        if (lvl === 'ok') return 'přesnost ±' + metry(a) + ' — na měření dobré';
        if (lvl === 'warn') return 'přesnost ±' + metry(a) + ' — hraniční, počkej na ustálení';
        return 'přesnost ±' + metry(a) + ' — na ukládání bodů nestačí';
    }

    // ---- kresba --------------------------------------------------------------------
    // Postava je pictogram z kulatých tahů: v malém se čte líp než plná silueta.
    // Kruh na zemi je elipsa (svislý poloměr × 0.30), aby seděl v perspektivě země.
    var CX = 60, GY = 64, FLAT = 0.30;   // střed scény a zploštění elipsy (perspektiva země)

    // Přední půloblouk kruhu se kreslí AŽ ZA postavou, takže postava stojí UVNITŘ
    // kruhu, ne na něm. Bez toho vypadá malý kruh jako kaňka pod nohama.
    function frontArc(rx) {
        var ry = rx * FLAT;
        return 'M ' + (CX - rx).toFixed(1) + ' ' + GY +
            ' A ' + rx.toFixed(1) + ' ' + ry.toFixed(1) + ' 0 0 0 ' + (CX + rx).toFixed(1) + ' ' + GY;
    }

    // ---- OKOLÍ: co kolem sebe zrovna mám -------------------------------------------
    // Na přání z terénu (29. 8. 2026): „u toho panáčka ať se podle semaforu zobrazí
    // věci — pokud jsem u stromu, ať tam je strom, u domu část domu."
    // Bere se TÁŽ volba okolí, jakou má Skóre místa (js/gps-semafor.js, klíč
    // agSemaforEnv_v1) — nic se tu neměří znovu a obojí tak mluví o tomtéž.
    // Kulisa se kreslí ZA kruh přesnosti a hodně potlačeně: je to kontext, ne údaj.
    var ENV_KEY = 'agSemaforEnv_v1';
    function envNow() {
        try {
            var v = localStorage.getItem(ENV_KEY);
            if (v === 'stromy' || v === 'budovy') return v;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-silueta:envNow'); }
        return 'volne';
    }
    // Strom vlevo, dům vpravo — obojí u kraje scény, aby i velký kruh (RMAX 54)
    // zůstal čitelný. Výška je zhruba dvojnásobek postavy = na první pohled je
    // vidět, co stíní oblohu.
    var ENV_SVG = {
        volne: '',
        stromy: '<g class="ag-sil-env">' +
            '<path class="ag-sil-env-l" d="M15 64 V44"/>' +
            '<path class="ag-sil-env-f" d="M15 20 L27 41 H3 Z"/>' +
            '<path class="ag-sil-env-f" d="M15 31 L30 52 H0 Z"/>' +
            '</g>',
        budovy: '<g class="ag-sil-env">' +
            '<path class="ag-sil-env-f" d="M96 64 V22 H120 V64 Z"/>' +
            '<path class="ag-sil-env-w" d="M101 29 h5 M111 29 h5 M101 39 h5 M111 39 h5 M101 49 h5 M111 49 h5"/>' +
            '</g>'
    };

    function svgMarkup() {
        var rr = R_REF.toFixed(1), rry = (R_REF * FLAT).toFixed(1);
        return '' +
            '<svg class="ag-sil-svg" viewBox="0 0 120 92" aria-hidden="true" focusable="false">' +
            // kulisa okolí (strom / dům) — nejníž ve vrstvení, ať nic nepřekrývá
            '<g class="ag-sil-envwrap"></g>' +
            // země — jemná linka horizontu, aby postava „stála"
            '<line class="ag-sil-ground" x1="3" y1="' + GY + '" x2="117" y2="' + GY + '"/>' +
            // pevná značka 5 m (hranice, od které appka varuje)
            '<ellipse class="ag-sil-ref" cx="' + CX + '" cy="' + GY + '" rx="' + rr + '" ry="' + rry + '"/>' +
            // živý kruh přesnosti — zadní část (pod postavou)
            '<ellipse class="ag-sil-ring" cx="' + CX + '" cy="' + GY + '" rx="0" ry="0"/>' +
            // postava
            '<g class="ag-sil-fig">' +
            '<circle class="ag-sil-head" cx="' + CX + '" cy="30" r="4.8"/>' +
            '<path class="ag-sil-body" d="M60 35.5 V50"/>' +
            '<path class="ag-sil-arms" d="M52.5 47 L60 38.5 L67.5 47"/>' +
            '<path class="ag-sil-legs" d="M54.5 64 L60 50 L65.5 64"/>' +
            '</g>' +
            // přední půloblouk — přes postavu, aby stála uvnitř kruhu
            '<path class="ag-sil-front" d=""/>' +
            '</svg>' +
            '<span class="ag-sil-num"></span>';
    }

    var _box = null, _ring = null, _front = null, _num = null, _env = null, _lastKey = '';

    function build() {
        if (_box) return _box;
        _box = document.createElement('button');
        _box.id = BOX_ID;
        _box.type = 'button';
        _box.className = 'glass-panel';
        _box.setAttribute('aria-live', 'polite');
        _box.innerHTML = svgMarkup();
        _box.addEventListener('click', onTap);
        (document.body || document.documentElement).appendChild(_box);
        _ring = _box.querySelector('.ag-sil-ring');
        _front = _box.querySelector('.ag-sil-front');
        _num = _box.querySelector('.ag-sil-num');
        _env = _box.querySelector('.ag-sil-envwrap');
        return _box;
    }

    // Klepnutí vede tam, kde se s přesností dá něco DĚLAT — ne do dalšího výpisu čísel.
    function onTap() {
        try {
            if (window.AGSemafor && typeof AGSemafor.open === 'function') return AGSemafor.open();
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-silueta:onTap'); }
        try {
            if (typeof window.openGpsAvgModal === 'function') return window.openGpsAvgModal();
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-silueta:onTap'); }
    }

    function on() {
        try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; }
    }

    function render() {
        if (!on()) {
            if (_box) _box.style.display = 'none';
            // sloupec upozornění se zase vrátí na střed displeje
            try { document.documentElement.style.setProperty('--ag-sil-w', '0px'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-silueta:render'); }
            return;
        }
        build();
        _box.style.display = '';
        // Šířku karty hlásíme ven: stavová bublina (js/stavovy-pruh.js ve sloupci
        // #ag-stack) se o ni odsune doprava, aby na siluetu nelezla. Obojí pak stojí
        // v jedné řadě pod horní hranou — nahlášeno 29. 8. 2026 („bublina překáží
        // panáčkovi s přesností").
        try {
            var w = Math.round(_box.getBoundingClientRect().width) || 0;
            if (w) document.documentElement.style.setProperty('--ag-sil-w', (w + 14) + 'px');
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-silueta:render'); }
        var a = haveFix() ? acc() : null;
        var lvl = level(a);
        var r = lvl === 'none' ? R_REF : radiusFor(a);
        var ev = envNow();
        // překreslovat jen při skutečné změně — jinak by se DOM přepisoval 1× za sekundu
        var key = lvl + '|' + r.toFixed(1) + '|' + ev;
        if (key === _lastKey) return;
        _lastKey = key;
        if (_env) _env.innerHTML = ENV_SVG[ev] || '';
        _ring.setAttribute('rx', r.toFixed(1));
        _ring.setAttribute('ry', (r * FLAT).toFixed(1));
        _front.setAttribute('d', frontArc(r));
        _box.setAttribute('data-lvl', lvl);
        _num.textContent = a == null ? '—' : '±' + metry(a);
        var okoli = ev === 'stromy' ? ' Okolí: koruny stromů nebo jedna zeď.'
            : (ev === 'budovy' ? ' Okolí: mezi budovami.' : '');
        _box.setAttribute('aria-label', 'Přesnost GPS: ' + slovy(a, lvl) + '.' + okoli + ' Klepnutím otevřeš skóre místa.');
        _box.setAttribute('title', slovy(a, lvl) + okoli);
    }

    // ---- přepínač v Nastavení → Vzhled ----------------------------------------------
    function injectSettingsToggle() {
        if (document.getElementById(ROW_ID)) return;
        var tab = document.getElementById('tab-vzhled'); if (!tab) return;
        var row = document.createElement('div');
        row.className = 'st-row'; row.id = ROW_ID;
        var lab = document.createElement('span');
        lab.className = 'st-lab';
        lab.innerHTML = 'Silueta přesnosti<small>Postava s kruhem na zemi ukazuje, jak velká je právě nejistota polohy — bez čtení čísel</small>';
        var sw = document.createElement('label'); sw.className = 'st-sw';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on();
        cb.addEventListener('change', function () {
            try { localStorage.setItem(KEY, cb.checked ? '1' : '0'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-silueta:injectSettingsToggle'); }
            _lastKey = '';
            render();
        });
        var face = document.createElement('span'); face.className = 'st-sw-face';
        sw.appendChild(cb); sw.appendChild(face);
        row.appendChild(lab); row.appendChild(sw);
        tab.appendChild(row);
    }

    // ---- start ----------------------------------------------------------------------
    var _tries = 0;
    function init() {
        injectSettingsToggle();
        render();
        // uiInterval z js/idle-timers.js se sám uspí, když je appka na pozadí
        if (window.AG && typeof AG.uiInterval === 'function') AG.uiInterval(render, 1000);
        else setInterval(render, 1000);
        // Nastavení se do DOM dostane až s modálem — zkoušej, dokud tam záložka není
        if (!document.getElementById(ROW_ID) && _tries++ < 20) setTimeout(init, 500);
    }
    // POZOR: `load` uz mohl PROBEHNOUT. Modul se nacita pres ag/lazy, tedy AZ PO
    // vykresleni stranky — posluchac na 'load' by se pak nespustil nikdy a modul
    // by tise nedelal nic (dlazdice by nevznikla, obal saveCustomPoint taky ne).
    function nastartuj() { setTimeout(init, 400); }
    if (document.readyState === 'complete') nastartuj();
    else window.addEventListener('load', nastartuj);

    window.AGSilueta = {
        render: render,
        isOn: on,
        set: function (v) {
            try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-silueta:set'); }
            _lastKey = ''; render();
            var cb = document.querySelector('#' + ROW_ID + ' input'); if (cb) cb.checked = !!v;
        }
    };
})();
