// ===== AR Geodet — GESTA JAKO ZKRATKY NA NÁSTROJE (ODPOJITELNÁ vrstva) ===========
// Nástroj, který používáš pořád, si přiřadíš ke gestu a pak ho spouštíš ZPAMĚTI —
// jedním tahem prstu kdekoli po displeji, bez hledání v Nástrojích. Tah má dvě
// části a kreslí se BEZ ZVEDNUTÍ PRSTU:
//
//      AKTIVAČNÍ GESTO (výchozí ↓→)  +  ZKRATKA NÁSTROJE (např. ↑↓ = Počasí)
//
// Appka do toho NEMLUVÍ: neukazuje nabídku, co jde nakreslit dál, ani seznam
// zkratek. To je záměr — smyslem je svalová paměť, ne čtení z obrazovky. Jediná
// zpětná vazba je krátké cuknutí vibrací u každého tahu a drobný ukazatel
// uprostřed s tím, co už máš nakreslené; nic neztmavuje a nebere dotyky.
// Soupis přiřazení je v Nastavení, kde se také mění.
//
// PROČ AKTIVAČNÍ GESTO A NE ROVNOU ZKRATKA: celá plocha appky je živá — mapa se
// posouvá prstem, v AR se chodí po značkách. Kdyby zkratkou byl JEDEN tah, spustí
// se nástroj při každém posunutí mapy. Dvoutahový úvod s lomem („L") při běžném
// posouvání nevznikne, a i kdyby, musí být hotový do PREFIX_MS a přesně od začátku
// tahu — jinak se rozpoznávání hned vzdá.
//
// MAPA SE VRÁTÍ, KAM PATŘILA. Než je aktivační gesto rozpoznané, mapa se pod prstem
// posouvá (nedá se dopředu vědět, že jde o gesto). Ve chvíli rozpoznání se proto
// vrátí střed i zoom zapamatovaný při položení prstu a další pohyb už se k mapě
// vůbec nedostane (stopPropagation v CAPTURE fázi — obsluha mapy visí na
// #map-container v bublání, takže ji tím spolehlivě přeskočíme).
//
// ⚠⚠ ZKRATKA NESMÍ ZAČÍNAT TÍMŽ SMĚREM, JAKÝM KONČÍ AKTIVAČNÍ GESTO. Dvě stejné
// šipky za sebou se jedním tahem nedají nakreslit — je to jeden rovný tah. Nastavení
// takové přiřazení ODMÍTNE (dřív jen varovalo, což při kreslení bez zvedání prstu
// nestačí). Ze stejného důvodu nejsou mezi směry diagonály: na displeji v rukavicích
// se „šikmo" od „doprava" nerozezná spolehlivě (proto RATIO).
//
// ZVEDNUTÍ PRSTU gesto uzavírá: co sedí, spustí se; co nesedí, jen krátce zčervená
// a zmizí. Jakmile je jasno (nakreslený kód sedí a žádná delší zkratka jím
// nezačíná), nástroj naskočí ještě pod rukou, bez čekání na zvednutí.
//
// KDE SE GESTO NEZAKLÁDÁ: nad tlačítky, poli, dlaždicemi, otevřeným modálem,
// v panelu vrstev, na popupu mapy, nad přihlašovací obrazovkou a v kolečku nástrojů
// (body.ag-kn-open). Tam tah znamená něco jiného a sebrat mu ho by bylo horší než
// chybějící zkratka.
//
// SPOUŠTÍ SE STEJNOU CESTOU JAKO KOLEČKO: AGUkony.run(klíč) klikne na původní
// dlaždici v Nástrojích. Nic se tu nevede vlastní — takže platí oprávnění rolí
// (skrytá dlaždice = nespustitelná zkratka), počítadlo použití i návody.
//
// Odstranění: smaž js/gesta-zkratky.js + řádek <script> v index.html (a řádek
// v sw.js + zápis 'ag-gz-setrow' v js/nastaveni-poradek.js). Nic jiného na tom
// nestojí.
// ================================================================================
(function () {
    'use strict';
    if (window.AGGesta) return;

    var KEY = 'agGesta_v1';
    var STYLE_ID = 'ag-gz-style', WRAP_ID = 'ag-gz', SET_ID = 'ag-gz-set', PAD_ID = 'ag-gz-pad';

    var SEG = 54;          // kolik pixelů musí prst ujet, aby z toho byla šipka
    var RATIO = 1.5;       // o kolik musí převládnout jedna osa (jinak je to šikmo → čeká se dál)
    var PREFIX_MS = 1600;  // do kdy musí být aktivační gesto hotové (pomalý tah = posun mapy)
    var RUN_MS = 200;      // ať je na okamžik vidět, co se spouští (pod hranicí, kdy to působí jako prodleva)
    var MAXSEG = 3;        // nejvýš tři šipky na zkratku (delší si nikdo nezapamatuje)

    var ARROW = { U: '↑', D: '↓', L: '←', R: '→' };
    var DIRNAME = { U: 'nahoru', D: 'dolů', L: 'doleva', R: 'doprava' };

    // Kde se tah NEZAKLÁDÁ (viz hlavička). `.btn` je i „Zavřít" v modálech,
    // `.glass-panel` panel vrstev, `#ag-kn` kolečko nástrojů.
    // ⚠ #ag-login/#ag-gate/#welcome-screen tu MUSÍ být: `body.app-started` je
    // nastavené i pod přihlašovací obrazovkou (ověřeno v prohlížeči), takže bez
    // nich by šlo kreslit zkratky ještě před přihlášením.
    var NOGO = 'input,textarea,select,button,a,[role="button"],canvas,video,' +
        '.tool-tile,.dock-btn,.btn,.leaflet-popup,.leaflet-marker-icon,#map-controls,' +
        '.glass-panel,.modal-overlay,.bottom-sheet,[data-no-swipe],' +
        '#ag-login,#ag-gate,#welcome-screen,#' + WRAP_ID;

    // ---- nastavení -----------------------------------------------------------------
    // Výchozí zkratky ZÁMĚRNĚ nezačínají šipkou → (aktivační gesto končí doprava),
    // aby šly nakreslit i jedním tahem. Viz poznámka v hlavičce.
    function defaults() {
        return {
            off: 0,
            fingers: 1,
            prefix: 'DR',
            map: { UD: 'pocasi', UR: 'kompas', UL: 'openMeasureModal', DU: 'brutal-gps' }
        };
    }
    var cfg = null;
    function isCode(s) { return typeof s === 'string' && /^[UDLR]{1,4}$/.test(s) && !/(.)\1/.test(s); }
    function load() {
        if (cfg) return cfg;
        cfg = defaults();
        try {
            var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (raw && typeof raw === 'object') {
                cfg.off = raw.off ? 1 : 0;
                cfg.fingers = (raw.fingers === 2) ? 2 : 1;
                if (isCode(raw.prefix) && raw.prefix.length >= 2) cfg.prefix = raw.prefix;
                if (raw.map && typeof raw.map === 'object') {
                    cfg.map = {};
                    for (var c in raw.map) {
                        if (isCode(c) && typeof raw.map[c] === 'string' && raw.map[c]) cfg.map[c] = raw.map[c];
                    }
                }
            }
        } catch (e) {}
        return cfg;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(load())); } catch (e) {} }

    function arrows(code) {
        var s = '';
        for (var i = 0; i < (code || '').length; i++) s += (ARROW[code.charAt(i)] || '');
        return s;
    }
    function words(code) {
        var a = [];
        for (var i = 0; i < (code || '').length; i++) a.push(DIRNAME[code.charAt(i)] || '?');
        return a.join(', ');
    }
    function buzz(ms) {
        try {
            if (typeof visSettings !== 'undefined' && visSettings.vibrationEnabled === false) return;
            if (navigator.vibrate) navigator.vibrate(ms);
        } catch (e) {}
    }
    function toast(msg) { try { if (typeof window.quickToast === 'function') window.quickToast(msg); } catch (e) {} }

    // ---- nástroje (bereme z registru, vlastní seznam se nevede) ----------------------
    function groups() {
        try {
            if (window.AGReg && typeof AGReg.groups === 'function') return AGReg.groups();
            if (window.AGUkony && AGUkony.groups) return AGUkony.groups;
        } catch (e) {}
        return [];
    }
    var LBL = null;
    function toolLabel(k) {
        if (!LBL) {
            LBL = {};
            var g = groups();
            for (var i = 0; i < g.length; i++) {
                for (var j = 0; j < g[i].items.length; j++) LBL[g[i].items[j].k] = g[i].items[j].l;
            }
        }
        return LBL[k] || k;
    }
    // Dlaždice nemusí existovat: nástroj může být schovaný oprávněním role nebo
    // v „Moje aktivita". Zkratku na něj pak ukazujeme zašedle a nespustíme.
    function toolReady(k) { try { return !!(window.AGUkony && AGUkony.has(k)); } catch (e) { return false; } }
    function runTool(k) { try { return !!(window.AGUkony && AGUkony.run(k)); } catch (e) { return false; } }

    // ---- mapa (stejný přístup jako js/cadastre-area.js: globální `map` z logika.js) ---
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function mapSnap() {
        var m = getMap();
        try { return m ? { c: m.getCenter(), z: m.getZoom() } : null; } catch (e) { return null; }
    }
    function mapBack(s) {
        var m = getMap();
        if (!m || !s) return;
        try { m.setView(s.c, s.z, { animate: false }); } catch (e) {}
        // grafika.js si při posunu zvedne _mapHold (mapa se pak přestane točit podle
        // kompasu) a jeho touchend už k ní kvůli stopPropagation nedorazí — spustíme
        // příznak sami, jinak by mapa zůstala „zamrzlá" natrvalo.
        try { window._mapHold = false; } catch (e) {}
    }

    // ---- rozklad tahu na šipky --------------------------------------------------------
    // Vrací novou šipku, nebo '' (pokračování téhož směru / ještě málo pohybu / šikmo).
    function Stroke(x, y) { this.ax = x; this.ay = y; this.dir = ''; }
    Stroke.prototype.step = function (x, y) {
        var dx = x - this.ax, dy = y - this.ay, adx = Math.abs(dx), ady = Math.abs(dy), d = '';
        if (adx >= SEG && adx >= ady * RATIO) d = dx > 0 ? 'R' : 'L';
        else if (ady >= SEG && ady >= adx * RATIO) d = dy > 0 ? 'D' : 'U';
        if (!d) return '';
        // kotva jde za prstem i u pokračování téhož směru — lom se pak měří od
        // MÍSTA ZLOMU, ne od začátku tahu (jinak by dlouhý tah lom „přejel")
        this.ax = x; this.ay = y;
        if (d === this.dir) return '';
        this.dir = d;
        return d;
    };

    function touchMid(t) {
        var n = Math.min(t.length, 2), x = 0, y = 0;
        for (var i = 0; i < n; i++) { x += t[i].clientX; y += t[i].clientY; }
        return { x: x / n, y: y / n };
    }

    // ================================================================================
    // ŽIVÉ GESTO — CELÉ JEDNÍM TAHEM, BEZ NABÍDKY
    // ================================================================================
    // Zkratka se dělá ZPAMĚTI: aktivační gesto a hned za ním, BEZ ZVEDNUTÍ PRSTU,
    // tahy vybraného nástroje. Appka do toho nemluví — žádný seznam možností,
    // žádné „co můžeš nakreslit dál". Jediná zpětná vazba je drobný ukazatel
    // uprostřed (co máš zatím nakresleno) a krátké cuknutí vibrací u každého tahu,
    // ať poznáš, že se tah opravdu započítal. Zvednutí prstu gesto UZAVÍRÁ:
    // co sedí, spustí se, co nesedí, tiše zmizí.
    var strk = null;     // právě kreslený tah: { s, t0, snap, armed, pre, code, fired, drew, over }

    function overlay() { return document.getElementById(WRAP_ID); }

    // OTEVŘENÉ OKNO se nehledá procházením overlayů — čtyři domácí modály
    // (Nastavení, Body, Nástroje, Nový bod) jsou v CSS TRVALE `display:flex`
    // a viditelnost jim řídí třída .ag-open (viz skript na konci index.html),
    // takže „computed display" o otevření nevypovídá vůbec nic. Rozhoduje proto
    // JEN to, na čem tah začal: nad zavřeným oknem dotek dopadne na mapu, nad
    // otevřeným na okno samotné — a to je v NOGO. Jedna podmínka navíc je kolečko
    // nástrojů, které kreslí do vlastní vrstvy přes celou obrazovku.
    function canStart(target) {
        if (load().off) return false;
        if (!document.body.classList.contains('app-started')) return false;
        if (document.body.classList.contains('ag-kn-open')) return false;   // kolečko nástrojů
        try { if (target && target.closest && target.closest(NOGO)) return false; } catch (e) {}
        return true;
    }

    function onStart(e) {
        var t = e.touches;
        if (!t) return;
        if (t.length !== load().fingers) { strk = null; return; }
        if (!canStart(e.target)) { strk = null; return; }
        var p = touchMid(t);
        strk = { s: new Stroke(p.x, p.y), t0: Date.now(), snap: mapSnap(), armed: false, pre: '', code: '', fired: false, drew: false, over: false };
    }

    function onMove(e) {
        if (!strk) return;
        var t = e.touches;
        if (!t || !t.length) return;
        if (t.length !== load().fingers) { if (!strk.armed) strk = null; return; }
        var p = touchMid(t);
        var d = strk.s.step(p.x, p.y);

        if (strk.armed) {
            // Od téhle chvíle patří pohyb NÁM: mapa se nesmí posouvat ani škubnout.
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            if (d) { strk.drew = true; addArrow(d); }
            return;
        }
        if (Date.now() - strk.t0 > PREFIX_MS) { strk = null; return; }   // moc pomalé = posun mapy
        if (!d) return;
        strk.pre += d;
        var pre = load().prefix;
        if (strk.pre === pre) {
            arm();
            // ⚠ I TENHLE pohyb už patří nám. Bez toho by obsluha mapy (bublání,
            // běží až po nás) zpracovala poslední kousek tahu: mapa by o kus
            // poskočila hned po tom, co jsme ji vrátili, a hlavně by si znovu
            // zvedla `_mapHold` — a ten by pak zůstal navěky (její touchend už
            // kvůli stopPropagation nedorazí), takže by se mapa přestala točit
            // podle kompasu. Odhaleno zkouškou v prohlížeči.
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (pre.indexOf(strk.pre) !== 0) strk = null;   // odbočil jinam → nejde o gesto
    }

    function onEnd(e) {
        if (!strk) return;
        if (e.touches && e.touches.length) return;      // druhý prst ještě drží
        var st = strk;
        strk = null;
        if (!st.armed) return;
        e.stopPropagation();
        if (st.drew) swallowClick();
        if (st.fired) return;                           // spuštěno už za pohybu prstu
        decide(st, false);
    }
    function onCancel() {
        if (!strk) return;
        if (strk.armed) hideChip(160);
        strk = null;
    }

    // Po tažení, které začalo nad tlačítkem, umí prohlížeč doručit ještě klik —
    // spolkneme ho, ať se nespustí něco, od čeho jsi jen odjížděl (vzor modal-close.js).
    function swallowClick() {
        var f = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
        document.addEventListener('click', f, true);
        setTimeout(function () { document.removeEventListener('click', f, true); }, 400);
    }

    // ---- rozpoznané aktivační gesto ------------------------------------------------------
    function arm() {
        strk.armed = true;
        mapBack(strk.snap);              // vrať mapu tam, kde byla před gestem
        buzz(25);
        showChip();
        paintChip('', '', '');
    }
    function addArrow(d) {
        if (strk.fired) return;
        if (strk.code.length >= MAXSEG) {
            // Delší zkratka existovat nemůže, další tahy tedy nemá cenu sbírat.
            // Ukazatel jen zčervená — křičet na uživatele uprostřed tahu nemá smysl.
            if (!strk.over) { strk.over = true; paintChip(strk.code, 'bad', ''); }
            return;
        }
        strk.code += d;
        buzz(10);
        paintChip(strk.code, '', '');
        decide(strk, true);
    }

    // drawing = true → rozhoduje se ještě za pohybu prstu
    function decide(st, drawing) {
        if (st.fired) return;
        var code = st.code, k = load().map[code];
        // Spustit HNED, jakmile je jasno: kód sedí a žádná delší zkratka jím
        // nezačíná. Nečeká se na zvednutí prstu a nástroj naskočí pod rukou.
        if (k && !extended(code)) { fire(st, code, k); return; }
        if (drawing) return;
        if (k) { fire(st, code, k); return; }
        miss(code);
    }
    function extended(code) {
        var m = load().map;
        for (var c in m) if (c !== code && c.indexOf(code) === 0) return true;
        return false;
    }

    function fire(st, code, k) {
        st.fired = true;
        buzz(30);
        paintChip(code, 'hit', toolLabel(k));   // jediná zpráva: co se spouští
        var ready = toolReady(k);
        setTimeout(function () {
            hideChip(0);
            if (!ready) { toast('Nástroj „' + toolLabel(k) + '" teď není dostupný.'); return; }
            if (!runTool(k)) toast('Nástroj „' + toolLabel(k) + '" se nepodařilo otevřít.');
        }, RUN_MS);
    }
    // Nesedící gesto se NEKOMENTUJE oknem ani nabídkou — jen krátce zčervená a zmizí.
    // Kdo si nevzpomene, najde soupis v Nastavení; smysl téhle vrstvy je dělat
    // zkratky zpaměti, ne se u nich zdržovat.
    function miss(code) {
        paintChip(code, 'bad', code ? 'nepřiřazeno' : '');
        hideChip(code ? 620 : 220);
    }

    // ================================================================================
    // UKAZATEL NAKRESLENÉHO (drobný, nic neblokuje)
    // ================================================================================
    // Není to nabídka ani okno: leží uprostřed, NEBERE dotyky (pointer-events:none)
    // a nic pod sebou neztmavuje. Ukazuje jen aktivační gesto (zesláble) a k němu
    // tahy, které už máš nakreslené — aby bylo poznat, že se tah započítal.
    var chipTimer = null;
    function showChip() {
        injectStyles();
        var w = overlay();
        if (!w) {
            w = document.createElement('div');
            w.id = WRAP_ID;
            w.innerHTML = '<div class="gz-chip"><div class="gz-code"><span class="gz-pre"></span><b class="gz-now"></b></div>' +
                '<div class="gz-lb"></div></div>';
            document.body.appendChild(w);
        }
        clearTimeout(chipTimer);
        w.style.display = 'flex';
        w.classList.remove('gz-out');
    }
    function paintChip(code, cls, label) {
        var w = overlay();
        if (!w) return;
        w.querySelector('.gz-pre').textContent = arrows(load().prefix);
        var now = w.querySelector('.gz-now');
        now.textContent = arrows(code);
        now.className = 'gz-now' + (cls ? ' ' + cls : '');
        var lb = w.querySelector('.gz-lb');
        lb.textContent = label || '';
        lb.className = 'gz-lb' + (cls ? ' ' + cls : '');
    }
    function hideChip(delay) {
        var w = overlay();
        if (!w) return;
        clearTimeout(chipTimer);
        chipTimer = setTimeout(function () {
            var el = overlay();
            if (!el) return;
            el.classList.add('gz-out');
            chipTimer = setTimeout(function () {
                var e2 = overlay();
                if (e2) { e2.style.display = 'none'; e2.classList.remove('gz-out'); }
            }, 200);
        }, delay || 0);
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    // ================================================================================
    // NASTAVENÍ: řádek ve Vzhledu → Ovládání + vlastní okno se zkratkami
    // ================================================================================
    function injectSettingRow() {
        if (document.getElementById('ag-gz-setrow')) return;
        var anchor = document.getElementById('s-lefthand');
        var row = anchor && anchor.closest ? anchor.closest('.st-row') : null;
        if (!row || !row.parentNode) return;
        var div = document.createElement('div');
        div.className = 'st-row'; div.id = 'ag-gz-setrow';
        div.innerHTML = '<span class="st-lab">Gesta – zkratky nástrojů' +
            '<small>jedním tahem: <b>' + arrows(load().prefix) + '</b> a rovnou zkratka nástroje</small></span>' +
            '<span class="ag-gz-cell"><button type="button" class="btn btn-secondary ag-gz-open">Nastavit…</button>' +
            '<label class="st-sw"><input type="checkbox" id="ag-gz-on"><span class="st-sw-face"></span></label></span>';
        row.parentNode.insertBefore(div, row.nextSibling);
        var cb = div.querySelector('#ag-gz-on');
        cb.checked = !load().off;
        cb.addEventListener('change', function () { load().off = cb.checked ? 0 : 1; save(); });
        div.querySelector('.ag-gz-open').addEventListener('click', function () { openSettings(); });
    }

    // ---- okno se zkratkami -------------------------------------------------------------
    var pendingCode = null;    // kód, který se právě přiřazuje (z „Přiřadit…" nebo z padu)

    function settingsEl() {
        var el = document.getElementById(SET_ID);
        if (el) return el;
        injectStyles();
        el = document.createElement('div');
        el.className = 'modal-overlay';
        el.id = SET_ID;
        el.innerHTML = '<div class="modal-content">' +
            '<h2 style="color:var(--accent);margin-top:0;">Gesta – zkratky nástrojů</h2>' +
            '<p class="ag-gz-p">Nástroj spustíš <b>jedním tahem</b> kdekoli po displeji (mimo tlačítka a otevřená okna), ' +
            'a to <b>bez zvednutí prstu</b>: nejdřív aktivační gesto <b class="ag-gz-prefix"></b>, rovnou za ním zkratka nástroje. ' +
            'Appka při tom nic nenabízí — jen krátce cukne a ukáže, co máš nakreslené. Zkratky se dělají zpaměti, ' +
            'tenhle seznam je na jejich nastavení, ne na hledání v terénu.</p>' +
            '<div class="st-row"><span class="st-lab">Zapnuto</span>' +
            '<label class="st-sw"><input type="checkbox" id="ag-gz-on2"><span class="st-sw-face"></span></label></div>' +
            '<div class="st-row"><span class="st-lab">Aktivační gesto<small class="ag-gz-prewords"></small></span>' +
            '<button type="button" class="btn btn-secondary" id="ag-gz-prefix-btn"></button></div>' +
            '<div class="st-row"><span class="st-lab">Kreslit<small>dvěma prsty se gesto nikdy nesplete s posunem mapy, ale hůř se dělá v rukavicích</small></span>' +
            '<select id="ag-gz-fingers"><option value="1">jedním prstem</option><option value="2">dvěma prsty</option></select></div>' +
            '<h3 class="set-h" style="margin-top:18px;">Zkratky</h3>' +
            '<div id="ag-gz-rows"></div>' +
            '<button class="btn" id="ag-gz-add" style="margin-top:10px;">+ Přidat zkratku</button>' +
            '<button class="btn btn-secondary" id="ag-gz-def" style="margin-top:8px;">Obnovit výchozí zkratky</button>' +
            '<button class="btn btn-secondary" id="ag-gz-close" style="margin-top:8px;">Zavřít</button>' +
            '</div>';
        document.body.appendChild(el);

        el.querySelector('#ag-gz-on2').addEventListener('change', function () {
            load().off = this.checked ? 0 : 1; save();
            var c = document.getElementById('ag-gz-on'); if (c) c.checked = this.checked;
        });
        el.querySelector('#ag-gz-fingers').addEventListener('change', function () {
            load().fingers = (this.value === '2') ? 2 : 1; save();
        });
        el.querySelector('#ag-gz-prefix-btn').addEventListener('click', function () {
            openPad('Nakresli aktivační gesto', 2, function (code) {
                if (code.length < 2) { toast('Aktivační gesto musí mít aspoň dva tahy — jeden by se pletl s posunem mapy.'); return false; }
                // Nové gesto může znepřístupnit už přiřazené zkratky (viz pravidlo
                // o dvou stejných šipkách za sebou) — radši to řekneme rovnou, než
                // aby uživatel v terénu marně kreslil zkratku, která nejde nakreslit.
                var last = code.charAt(code.length - 1), m = load().map, kolize = [];
                for (var c in m) if (c.charAt(0) === last) kolize.push(arrows(c));
                if (kolize.length) {
                    toast('Nešlo by nakreslit: ' + kolize.join(' ') + ' — začínají stejným směrem, jakým nové gesto končí. Změň napřed je.');
                    return false;
                }
                load().prefix = code; save(); renderSettings(); refreshRowHint();
                return true;
            });
        });
        el.querySelector('#ag-gz-add').addEventListener('click', function () { openPicker(); });
        el.querySelector('#ag-gz-def').addEventListener('click', function () {
            var d = defaults();
            load().map = d.map; load().prefix = d.prefix; save(); renderSettings(); refreshRowHint();
            toast('Zkratky vrácené na výchozí.');
        });
        el.querySelector('#ag-gz-close').addEventListener('click', function () { el.style.display = 'none'; });
        el.addEventListener('click', function (ev) {
            var b = ev.target && ev.target.closest ? ev.target.closest('button[data-act]') : null;
            if (!b) return;
            var act = b.getAttribute('data-act'), code = b.getAttribute('data-code');
            if (act === 'del') {
                delete load().map[code]; save(); renderSettings();
            } else if (act === 'edit') {
                var k = load().map[code];
                openPad('Nové gesto pro „' + toolLabel(k) + '"', 1, function (nc) {
                    if (nc === code) return true;
                    var back = load().map[code];
                    delete load().map[code];
                    if (assign(nc, k)) return true;
                    load().map[code] = back;   // neprošlo → vrátit původní přiřazení
                    renderSettings();
                    return false;
                }, lastPrefixDir());
            }
        });
        return el;
    }

    function renderSettings() {
        var el = document.getElementById(SET_ID);
        if (!el) return;
        var c = load();
        el.querySelector('#ag-gz-on2').checked = !c.off;
        el.querySelector('#ag-gz-fingers').value = String(c.fingers);
        el.querySelector('.ag-gz-prefix').textContent = arrows(c.prefix);
        el.querySelector('#ag-gz-prefix-btn').textContent = arrows(c.prefix) + '  Změnit';
        el.querySelector('.ag-gz-prewords').textContent = words(c.prefix);

        var codes = [], k;
        for (k in c.map) codes.push(k);
        codes.sort();
        var h = '';
        for (var i = 0; i < codes.length; i++) {
            var key = c.map[codes[i]], ready = toolReady(key);
            h += '<div class="ag-gz-row"><span class="ag-gz-ar">' + arrows(codes[i]) + '</span>' +
                '<span class="ag-gz-lb' + (ready ? '' : ' off') + '">' + esc(toolLabel(key)) +
                (ready ? '' : '<small>teď není v Nástrojích dostupný</small>') + '</span>' +
                '<button type="button" data-act="edit" data-code="' + codes[i] + '" title="Změnit gesto">✎</button>' +
                '<button type="button" data-act="del" data-code="' + codes[i] + '" title="Odebrat">✕</button></div>';
        }
        if (!codes.length) h = '<div class="ag-gz-empty">Zatím žádná zkratka. Přidej první tlačítkem níž.</div>';
        el.querySelector('#ag-gz-rows').innerHTML = h;
    }
    function refreshRowHint() {
        var r = document.getElementById('ag-gz-setrow');
        var s = r && r.querySelector('small');
        if (s) s.innerHTML = 'jedním tahem: <b>' + arrows(load().prefix) + '</b> a rovnou zkratka nástroje';
    }

    function openSettings(code) {
        var el = settingsEl();
        renderSettings();
        el.style.display = 'flex';
        if (code) { pendingCode = code; openPicker(code); }
    }

    // ---- výběr nástroje ------------------------------------------------------------------
    function openPicker(code) {
        var el = settingsEl();
        var box = document.getElementById('ag-gz-pick');
        if (!box) {
            box = document.createElement('div');
            box.className = 'modal-overlay'; box.id = 'ag-gz-pick';
            box.innerHTML = '<div class="modal-content">' +
                '<h2 style="color:var(--accent);margin-top:0;">Na který nástroj?</h2>' +
                '<input type="search" id="ag-gz-q" placeholder="Hledat nástroj…" autocomplete="off">' +
                '<div class="modal-body" id="ag-gz-tools"></div>' +
                '<button class="btn btn-secondary" id="ag-gz-pick-close">Zpět</button></div>';
            document.body.appendChild(box);
            box.querySelector('#ag-gz-pick-close').addEventListener('click', function () { box.style.display = 'none'; });
            box.querySelector('#ag-gz-q').addEventListener('input', function () { fillTools(this.value); });
            box.addEventListener('click', function (ev) {
                var b = ev.target && ev.target.closest ? ev.target.closest('button[data-tool]') : null;
                if (!b) return;
                var k = b.getAttribute('data-tool');
                box.style.display = 'none';
                if (pendingCode) {
                    var c = pendingCode; pendingCode = null;
                    assign(c, k);
                } else {
                    openPad('Nakresli gesto pro „' + toolLabel(k) + '"', 1, function (nc) { return assign(nc, k); }, lastPrefixDir());
                }
            });
        }
        if (code) pendingCode = code;
        fillTools('');
        box.querySelector('#ag-gz-q').value = '';
        box.style.display = 'flex';
        el.style.display = 'flex';
    }
    function fillTools(q) {
        var host = document.getElementById('ag-gz-tools');
        if (!host) return;
        q = String(q || '').toLowerCase();
        try { q = q.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
        var g = groups(), h = '';
        for (var i = 0; i < g.length; i++) {
            var rows = '';
            for (var j = 0; j < g[i].items.length; j++) {
                var it = g[i].items[j];
                var lab = it.l || it.k, hay = (lab + ' ' + (it.h || '') + ' ' + g[i].t).toLowerCase();
                try { hay = hay.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
                if (q && hay.indexOf(q) < 0) continue;
                rows += '<button type="button" data-tool="' + esc(it.k) + '">' + esc(lab) +
                    (it.h ? '<small>' + esc(it.h) + '</small>' : '') + '</button>';
            }
            if (rows) h += '<div class="ag-gz-grp">' + esc(g[i].t) + '</div>' + rows;
        }
        host.innerHTML = h || '<div class="ag-gz-empty">Nic takového tu není.</div>';
    }
    // Vrací false = neuloženo (volající pak nechá kreslicí plochu otevřenou).
    function assign(code, k) {
        // ⚠⚠ Celá zkratka se kreslí JEDNÍM TAHEM, takže dvě stejné šipky za sebou
        // nakreslit nejde — je to jeden rovný tah. Zkratka začínající směrem, kterým
        // končí aktivační gesto, by tedy byla NEDOSAŽITELNÁ. Dřív to bylo jen
        // varování (tehdy se dalo došvihnout po zvednutí prstu); teď se odmítá.
        if (code.charAt(0) === lastPrefixDir()) {
            toast('Zkratka nemůže začínat ' + DIRNAME[lastPrefixDir()] + ' — tím končí aktivační gesto a dva stejné tahy za sebou jedním tahem nenakreslíš.');
            return false;
        }
        if (load().map[code] && load().map[code] !== k) {
            toast('Gesto ' + arrows(code) + ' už má „' + toolLabel(load().map[code]) + '".');
            return false;
        }
        load().map[code] = k; save(); renderSettings();
        toast('Zkratka ' + arrows(load().prefix) + ' ' + arrows(code) + ' → ' + toolLabel(k));
        return true;
    }
    function lastPrefixDir() { var p = load().prefix; return p.charAt(p.length - 1); }

    // ---- kreslicí plocha („nauč se gesto") -------------------------------------------------
    var padState = null;
    // forbid = směr, kterým NESMÍ zkratka začínat (viz assign) — '' u aktivačního gesta
    function openPad(title, minLen, onSave, forbid) {
        injectStyles();
        var el = document.getElementById(PAD_ID);
        if (!el) {
            el = document.createElement('div');
            el.className = 'modal-overlay'; el.id = PAD_ID;
            // ⚠⚠ data-no-swipe je tu ŽIVOTNĚ DŮLEŽITÉ: js/modal-close.js zavírá modály
            // VODOROVNÝM TAHEM a po tahu delším než ARM_PX ještě spolkne následující
            // klik. Kreslení gesta je z jeho pohledu přesně takový tah — okno se při
            // učení gesta zavíralo a tlačítko „Uložit" pak nešlo zmáčknout (klik se
            // spolkl). Ověřeno v prohlížeči; bez tohohle atributu se zkratka NEULOŽÍ.
            el.setAttribute('data-no-swipe', '');
            el.innerHTML = '<div class="modal-content">' +
                '<h2 style="color:var(--accent);margin-top:0;" class="gzp-title"></h2>' +
                '<div class="gzp-area" id="ag-gz-area"><span class="gzp-hint">Táhni prstem sem</span><span class="gzp-code"></span></div>' +
                '<div class="gzp-note"></div>' +
                '<button class="btn" id="ag-gz-padsave">Uložit</button>' +
                '<button class="btn btn-secondary" id="ag-gz-padagain" style="margin-top:8px;">Nakreslit znovu</button>' +
                '<button class="btn btn-secondary" id="ag-gz-padcancel" style="margin-top:8px;">Zrušit</button>' +
                '</div>';
            document.body.appendChild(el);
            var area = el.querySelector('#ag-gz-area');
            var start = function (x, y) { padState.s = new Stroke(x, y); };
            var move = function (x, y) {
                if (!padState || !padState.s) return;
                var d = padState.s.step(x, y);
                if (!d) return;
                if (padState.code.length >= MAXSEG) return;
                padState.code += d;
                buzz(10);
                paintPad();
            };
            area.addEventListener('touchstart', function (e) { if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
            area.addEventListener('touchmove', function (e) {
                if (e.touches.length !== 1) return;
                if (e.cancelable) e.preventDefault();
                move(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: false });
            // myš jen kvůli zkoušení v prohlížeči — v terénu se kreslí prstem
            area.addEventListener('pointerdown', function (e) { if (padState && e.pointerType !== 'touch') { padState.md = true; start(e.clientX, e.clientY); } });
            area.addEventListener('pointermove', function (e) { if (padState && padState.md && e.pointerType !== 'touch') move(e.clientX, e.clientY); });
            window.addEventListener('pointerup', function () { if (padState) padState.md = false; });
            el.querySelector('#ag-gz-padagain').addEventListener('click', function () { padState.code = ''; padState.s = null; paintPad(); });
            el.querySelector('#ag-gz-padcancel').addEventListener('click', function () { el.style.display = 'none'; pendingCode = null; });
            el.querySelector('#ag-gz-padsave').addEventListener('click', function () {
                if (!padState || padState.code.length < padState.min) { toast('Nakresli aspoň ' + padState.min + ' tah' + (padState.min > 1 ? 'y' : '') + '.'); return; }
                if (padState.onSave(padState.code) !== false) el.style.display = 'none';
            });
        }
        padState = { code: '', s: null, min: minLen || 1, onSave: onSave, md: false, forbid: forbid || '' };
        el.querySelector('.gzp-title').textContent = title;
        el.style.display = 'flex';
        paintPad();
    }
    function paintPad() {
        var el = document.getElementById(PAD_ID);
        if (!el || !padState) return;
        el.querySelector('.gzp-code').textContent = arrows(padState.code);
        el.querySelector('.gzp-hint').style.display = padState.code ? 'none' : '';
        var note = el.querySelector('.gzp-note');
        var bad = padState.forbid && padState.code.charAt(0) === padState.forbid;
        note.className = 'gzp-note' + (bad ? ' bad' : '');
        if (bad) {
            note.textContent = 'Takhle to nepůjde: aktivační gesto končí ' + DIRNAME[padState.forbid] +
                ' a dva stejné tahy za sebou jedním tahem nenakreslíš. Začni jiným směrem.';
        } else {
            note.textContent = padState.code
                ? (words(padState.code) + (padState.code.length >= MAXSEG ? ' — víc tahů zkratka mít nemůže' : ''))
                : 'Nejvýš ' + MAXSEG + ' tahy. Směry: nahoru, dolů, doleva, doprava.';
        }
    }

    // ================================================================================
    // STYLY
    // ================================================================================
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // ---- UKAZATEL NAKRESLENÉHO ----
            // z-index 10050 = stejná vrstva jako kolečko nástrojů: nad HUD i dokem,
            // POD modály (ty jedou výš). `pointer-events:none` je tu podstatné —
            // ukazatel se objevuje UPROSTŘED TAHU, takže nesmí sebrat ani jeden dotek.
            '#' + WRAP_ID + '{position:fixed;inset:0;z-index:10050;display:none;align-items:center;justify-content:center;',
            '  pointer-events:none;opacity:1;transition:opacity .18s;}',
            '#' + WRAP_ID + '.gz-out{opacity:0;}',
            '#' + WRAP_ID + ' .gz-chip{padding:14px 20px;border-radius:18px;text-align:center;',
            '  background:var(--glass-bg,rgba(18,22,28,0.86));border:1px solid var(--glass-border,rgba(255,255,255,0.10));',
            '  backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%);',
            '  box-shadow:0 12px 34px rgba(0,0,0,0.45);color:var(--text-color,#eceef2);}',
            '#' + WRAP_ID + ' .gz-code{font-size:calc(34px * var(--ag-font-scale,1));line-height:1.05;letter-spacing:.08em;',
            '  text-shadow:0 2px 8px rgba(0,0,0,0.6);}',
            '#' + WRAP_ID + ' .gz-pre{opacity:.32;}',
            '#' + WRAP_ID + ' .gz-now{color:var(--accent-bright,#3eb487);}',
            '#' + WRAP_ID + ' .gz-now.bad{color:#ef4444;}',
            '#' + WRAP_ID + ' .gz-now.hit{color:var(--accent-bright,#3eb487);}',
            '#' + WRAP_ID + ' .gz-lb{margin-top:4px;font-size:calc(13px * var(--ag-font-scale,1));font-weight:600;',
            '  color:var(--accent-bright,#3eb487);}',
            '#' + WRAP_ID + ' .gz-lb:empty{display:none;}',
            '#' + WRAP_ID + ' .gz-lb.bad{color:#ef4444;font-weight:400;opacity:.85;}',
            // ---- řádek v Nastavení ----
            '.ag-gz-cell{display:flex;align-items:center;gap:10px;}',
            '.ag-gz-cell .btn{width:auto;margin:0;padding:7px 12px;font-size:calc(12.5px * var(--ag-font-scale,1));}',
            // ---- okno se zkratkami ----
            // ⚠ Řádky `.st-row`, popisky a přepínače má appka nastylované jen POD
            // `#settings-modal` (css/style.css). Ve vlastním okně by tedy vypadaly
            // jako holý formulář — popisek slepený s hodnotou a systémový čtvereček
            // místo přepínače. Tady je proto tentýž vzhled zopakovaný pro #ag-gz-set;
            // hodnoty se drží proměnných, takže motiv i velikost písma platí dál.
            '#' + SET_ID + ' .st-row{display:flex;align-items:center;justify-content:space-between;gap:12px;',
            '  padding:13px 0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.10));}',
            '#' + SET_ID + ' .st-row:last-of-type{border-bottom:none;}',
            '#' + SET_ID + ' .st-lab{font-size:calc(14.5px * var(--ag-font-scale,1));font-weight:600;color:var(--text-color,#eceef2);margin:0;}',
            '#' + SET_ID + ' .st-lab small{display:block;color:var(--text-muted,#9aa6b4);font-weight:400;margin-top:2px;',
            '  font-size:calc(11.5px * var(--ag-font-scale,1));}',
            '#' + SET_ID + ' .st-sw{position:relative;display:inline-block;width:46px;height:27px;flex:none;cursor:pointer;margin:0;}',
            '#' + SET_ID + ' .st-sw input{position:absolute;opacity:0;width:0;height:0;}',
            '#' + SET_ID + ' .st-sw .st-sw-face{position:absolute;inset:0;border-radius:99px;background:var(--surface-3,rgba(255,255,255,0.16));transition:background .2s ease;}',
            '#' + SET_ID + ' .st-sw .st-sw-face::after{content:"";position:absolute;top:3px;left:3px;width:21px;height:21px;border-radius:50%;',
            '  background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s ease;}',
            '#' + SET_ID + ' .st-sw input:checked + .st-sw-face{background:var(--accent,#2f9e74);}',
            '#' + SET_ID + ' .st-sw input:checked + .st-sw-face::after{transform:translateX(19px);}',
            '#' + SET_ID + ' select{width:auto;min-width:150px;margin:0;}',
            '#' + SET_ID + ' #ag-gz-prefix-btn{width:auto;margin:0;padding:8px 14px;white-space:nowrap;}',
            '#' + SET_ID + ' .ag-gz-p{font-size:calc(12.5px * var(--ag-font-scale,1));opacity:.8;line-height:1.5;margin:0 0 12px;}',
            '.ag-gz-row{display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;border-radius:12px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.10));background:rgba(255,255,255,0.04);}',
            '.ag-gz-row .ag-gz-ar{font-size:calc(19px * var(--ag-font-scale,1));letter-spacing:.05em;min-width:2.6em;color:var(--accent-bright,#3eb487);}',
            '.ag-gz-row .ag-gz-lb{flex:1;font-size:calc(13px * var(--ag-font-scale,1));}',
            '.ag-gz-row .ag-gz-lb small{display:block;opacity:.55;font-size:calc(11px * var(--ag-font-scale,1));}',
            '.ag-gz-row .ag-gz-lb.off{opacity:.5;}',
            '.ag-gz-row button{width:38px;height:38px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.10));',
            '  background:transparent;color:inherit;font-size:15px;}',
            '.ag-gz-empty{opacity:.6;font-size:calc(12.5px * var(--ag-font-scale,1));padding:10px 2px;}',
            '#ag-gz-tools{max-height:52vh;overflow:auto;}',
            '#ag-gz-tools button{display:block;width:100%;text-align:left;margin-bottom:6px;padding:10px 12px;border-radius:12px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.10));background:rgba(255,255,255,0.04);color:inherit;',
            '  font:inherit;font-size:calc(13px * var(--ag-font-scale,1));}',
            '#ag-gz-tools button small{display:block;opacity:.55;font-size:calc(11px * var(--ag-font-scale,1));}',
            '.ag-gz-grp{margin:12px 0 6px;font-weight:700;font-size:calc(12px * var(--ag-font-scale,1));',
            '  text-transform:uppercase;letter-spacing:.06em;opacity:.6;}',
            // ---- kreslicí plocha ----
            '#' + PAD_ID + ' .gzp-area{position:relative;height:min(46vh,300px);margin:6px 0 10px;border-radius:16px;',
            '  border:2px dashed var(--glass-border,rgba(255,255,255,0.18));background:rgba(255,255,255,0.03);',
            '  display:flex;align-items:center;justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none;}',
            '#' + PAD_ID + ' .gzp-hint{opacity:.5;font-size:calc(13px * var(--ag-font-scale,1));}',
            '#' + PAD_ID + ' .gzp-code{position:absolute;font-size:calc(46px * var(--ag-font-scale,1));letter-spacing:.08em;',
            '  color:var(--accent-bright,#3eb487);}',
            '#' + PAD_ID + ' .gzp-note{font-size:calc(12px * var(--ag-font-scale,1));opacity:.7;margin-bottom:10px;min-height:1.4em;}',
            '#' + PAD_ID + ' .gzp-note.bad{color:#ef4444;opacity:1;}',
            // rukavice: větší cíle
            'body.ag-glove #' + WRAP_ID + ' .gz-row{padding:12px;}',
            'body.ag-glove .ag-gz-row button{width:44px;height:44px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ================================================================================
    // START
    // ================================================================================
    function init() {
        load();
        // CAPTURE fáze = jsme na řadě dřív než obsluha mapy v grafika.js (ta visí na
        // #map-container v bublání). Jen díky tomu jde posun mapy po rozpoznání gesta
        // utnout jediným stopPropagation.
        document.addEventListener('touchstart', onStart, { passive: true, capture: true });
        document.addEventListener('touchmove', onMove, { passive: false, capture: true });
        document.addEventListener('touchend', onEnd, { passive: false, capture: true });
        document.addEventListener('touchcancel', onCancel, { passive: true, capture: true });
        try { injectStyles(); } catch (e) {}
        var tries = 0;
        var t = setInterval(function () {
            try { injectSettingRow(); } catch (e) {}
            if (document.getElementById('ag-gz-setrow') || ++tries > 40) clearInterval(t);
        }, 400);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGGesta = {
        open: openSettings,                       // otevře okno se zkratkami
        get: function () { return JSON.parse(JSON.stringify(load())); },
        // pro zkoušení v prohlížeči: „jako by uživatel dokreslil tenhle kód"
        simulate: function (code) {
            var st = { code: String(code || ''), fired: false, armed: true, drew: true };
            showChip();
            paintChip(st.code, '', '');
            decide(st, false);
        }
    };
})();
