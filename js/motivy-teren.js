// ===== AR Geodet — DVA TERÉNNÍ MOTIVY + NOČNÍ AUTOMATIKA (ODPOJITELNÁ vrstva) ==
// Neinvazivní. NEEDITUJE js/grafika.js ani css/tokens.css — jen:
//   • doplní dvě položky do <select id="v-theme"> (Nastavení → Vzhled),
//   • obalí globální previewTheme() z grafika.js (aby uměla naše třídy sundat),
//   • přidá pod ten select řádek „Noční režim: Vypnuto / Automaticky po setmění".
// Samotné palety jsou v css/motivy-teren.css.
//
// CO PŘIBUDE
//   ① MODROTISK — appka vypadá jako geodetický výkres: světlá kresba na tmavé
//     modři, mapa se přebarví filtrem, modály dostanou raster milimetrového
//     papíru. Čistě vizuální, nic nemění na chování.
//   ② NOČNÍ REŽIM — červeno-jantarová paleta bez jediné modré. Oko se na tmu
//     adaptuje ~30 minut a jediný pohled do modrobílého displeje tu adaptaci
//     srazí; červené světlo tyčinky sítnice prakticky nedráždí (proto ho mají
//     mapy v letectví a na lodích). Ztlumí se i mapa a obraz z kamery.
//   ③ AUTOMATIKA — volitelně se noční režim zapne sám po OBČANSKÉM SOUMRAKU
//     a ráno se sám vrátí zpět. Časy počítá lokálně window.AGSun (js/slunce.js,
//     NOAA, bez internetu) z aktuální polohy.
//
// PROČ SE AUTOMATICKÝ MOTIV NEUKLÁDÁ DO NASTAVENÍ (důležité):
// grafika.js si při ukládání nastavení čte motiv Z DOM (`_agStr('v-theme', …)`).
// Kdyby automatika přepsala hodnotu v <select>, první uložení nastavení v noci
// by uživateli NATRVALO přepsalo jeho vlastní volbu motivu. Automatika proto
// mění jen třídu na <body>, select nechává být a po rozednění vrátí motiv, který
// tam byl. Po restartu appky v noci se automatika prostě spustí znovu.
//
// RUČNÍ VOLBA MÁ PŘEDNOST: když si uživatel v noci vybere motiv sám, automatika
// se do nejbližšího poledne odmlčí (jinak by mu ho hned přepnula zpět).
//
// Odstranění: smaž js/motivy-teren.js + css/motivy-teren.css a jejich řádky
// v index.html, pak spusť python scripts/gen_sw_assets.py --bump.
// ==============================================================================
(function () {
    'use strict';
    if (window.AGMotivy) return;

    var LS_AUTO = 'agNightAuto_v1';   // 'off' | 'auto'
    var LS_POS = 'agNightPos_v1';     // poslední známá poloha (pro výpočet soumraku)
    var LS_SEEN = 'agNightSeen_v1';   // datum, kdy už toast o zapnutí byl (1× za noc)

    // Naše třídy + třídy motivů z css/tokens.css. Seznam musí být úplný, protože
    // setTheme() přepíná motiv bez pomoci grafika.js (ta o našich dvou neví).
    var OUR = ['theme-blueprint', 'theme-night'];
    var CORE = ['theme-aurora', 'theme-sunset', 'theme-ocean', 'theme-forest', 'theme-graphite'];
    var BG = { blueprint: '#08182e', night: '#0b0503' };

    var OPTS = [
        { v: 'blueprint', t: 'Modrotisk (jako výkres)' },
        { v: 'night', t: 'Noční (červená, šetří oči)' }
    ];

    var _autoOn = false;      // právě běží AUTOMATICKY zapnutý noční režim
    var _prevTheme = null;    // motiv, na který se má po rozednění vrátit
    var _snoozeUntil = 0;     // do kdy automatika mlčí (ruční volba uživatele)
    var _timer = null;

    function swallow(e, where) { try { window.AG && AG.swallow && AG.swallow(e, 'motivy-teren:' + where); } catch (e2) { /* fail-silent */ } }

    // STYLOPIS SI PRIPOJUJE MODUL SAM, ne <link> v index.html. Duvod je rozpocet
    // startu (scripts/check_start_budget.py): eager CSS bylo 314 kB ze stropu
    // 320 kB, takze dalsich 8 kB by shodilo CI a s nim i nasazeni na Pages.
    // Skript samotny zustava `defer` (ne lazy) — kdyz ma nekdo ulozeny nas motiv,
    // musi se trida na <body> objevit hned, ne az 700 ms po vykresleni.
    // Soubor MUSI byt v EXTRA_ASSETS (scripts/gen_sw_assets.py), jinak zustane
    // appka offline bez techto palet.
    try {
        if (window.AG && typeof AG.cssFile === 'function') AG.cssFile('ag-motivy-teren-css', 'css/motivy-teren.css');
        else {
            var _l = document.createElement('link');
            _l.id = 'ag-motivy-teren-css'; _l.rel = 'stylesheet'; _l.href = 'css/motivy-teren.css';
            (document.head || document.documentElement).appendChild(_l);
        }
    } catch (e) { /* fail-silent */ }

    // ---- poloha pro výpočet soumraku -----------------------------------------
    // userLat/userLng z js/logika.js jsou `let` — NEJSOU na window, ale v globálním
    // lexikálním scope, takže se na ně dá sáhnout přímo (proto ten typeof, ne
    // window.userLat, které by bylo vždycky undefined).
    function pos() {
        try {
            if (typeof userLat === 'number' && typeof userLng === 'number' && isFinite(userLat) && isFinite(userLng)) {
                var p = { lat: userLat, lng: userLng };
                try { localStorage.setItem(LS_POS, JSON.stringify(p)); } catch (e) { swallow(e, 'pos:save'); }
                return p;
            }
        } catch (e) { swallow(e, 'pos:live'); }
        try {
            var s = JSON.parse(localStorage.getItem(LS_POS) || 'null');
            if (s && isFinite(s.lat) && isFinite(s.lng)) return s;
        } catch (e) { swallow(e, 'pos:cache'); }
        // Bez polohy radši hrubý střed ČR, než aby automatika nešla vůbec.
        // Chyba je řádu minut, což je pro „už je tma" úplně jedno.
        return { lat: 49.8, lng: 15.5 };
    }

    // Je teď noc? null = nevím (js/slunce.js není načtená).
    // Zenit 96° = OBČANSKÝ soumrak: hranice, za kterou už není vidět na náčrt
    // a displej začne oslňovat. Východ/západ (90,833°) by přepínal moc brzo.
    function isNight(now) {
        var S = window.AGSun;
        if (!S || typeof S.times !== 'function') return null;
        var p = pos(), t;
        try { t = S.times(now, p.lat, p.lng, 96); } catch (e) { swallow(e, 'isNight'); return null; }
        if (!t) return null;
        if (t.polar === 'noc') return true;     // slunce dnes nevyjde
        if (t.polar === 'den') return false;    // slunce dnes nezapadne
        if (!t.rise || !t.set) return null;
        return now < t.rise || now > t.set;
    }

    // ---- přepínání motivu -----------------------------------------------------
    function curTheme() {
        var b = document.body, i;
        for (i = 0; i < OUR.length; i++) if (b.classList.contains(OUR[i])) return OUR[i].slice(6);
        for (i = 0; i < CORE.length; i++) if (b.classList.contains(CORE[i])) return CORE[i].slice(6);
        return 'smaragd';
    }

    // Barva pod obsahem a v systémové liště. previewMode() z grafika.js ji nastaví
    // podle světlého/tmavého režimu — naše dva motivy mají vlastní a musí ji
    // přebít, jinak nad appkou visí světlý pruh (tentýž problém, který grafika.js
    // řeší v komentáři u previewMode).
    function chrome(t) {
        var c = BG[t];
        try {
            if (c) document.documentElement.style.backgroundColor = c;
            var mc = document.querySelector('meta[name="theme-color"]');
            if (mc && c) mc.setAttribute('content', c);
        } catch (e) { swallow(e, 'chrome'); }
    }

    function setTheme(t) {
        var b = document.body;
        try {
            CORE.concat(OUR).forEach(function (c) { b.classList.remove(c); });
            if (t && t !== 'smaragd') b.classList.add('theme-' + t);
        } catch (e) { swallow(e, 'setTheme'); }
        if (BG[t]) chrome(t);
        else if (typeof previewMode === 'function') {
            // vrací se na běžný motiv → ať si barvu kořene srovná jádro samo
            try { previewMode(document.body.classList.contains('light-mode') ? 'light' : 'dark'); } catch (e) { swallow(e, 'setTheme:mode'); }
        }
    }

    // ---- automatika -----------------------------------------------------------
    function autoMode() {
        try { return localStorage.getItem(LS_AUTO) === 'auto'; } catch (e) { return false; }
    }

    function engage() {
        _prevTheme = curTheme();
        if (_prevTheme === 'night') { _autoOn = false; return; }
        _autoOn = true;
        setTheme('night');
        markState();
        // Toast jen jednou za noc, ať to neotravuje při každém zapnutí appky.
        try {
            var key = new Date().toDateString();
            if (localStorage.getItem(LS_SEEN) !== key) {
                localStorage.setItem(LS_SEEN, key);
                if (typeof window.agInfo === 'function') {
                    window.agInfo('Setmělo se — zapnul jsem noční režim (červená paleta). Vypnout jde v Nastavení → Vzhled.');
                }
            }
        } catch (e) { swallow(e, 'engage:toast'); }
    }

    function restore() {
        if (!_autoOn) return;
        _autoOn = false;
        setTheme(_prevTheme || 'smaragd');
        _prevTheme = null;
        markState();
    }

    function tick() {
        try {
            if (!autoMode()) { restore(); return; }
            if (Date.now() < _snoozeUntil) return;
            var n = isNight(new Date());
            if (n === null) return;
            if (n && !_autoOn && curTheme() !== 'night') engage();
            else if (!n && _autoOn) restore();
        } catch (e) { swallow(e, 'tick'); }
    }

    // Ruční volba motivu v době, kdy je tma: automatika se odmlčí do poledne,
    // jinak by uživateli motiv okamžitě přepnula zpátky na noční.
    function snoozeTillNoon() {
        var d = new Date();
        if (d.getHours() >= 12) d.setDate(d.getDate() + 1);
        d.setHours(12, 0, 0, 0);
        _snoozeUntil = d.getTime();
    }

    // ---- napojení na jádro ----------------------------------------------------
    // previewTheme() z grafika.js naše třídy PŘIDAT umí (dělá 'theme-' + t), ale
    // NEUMÍ je sundat — její seznam k odebrání je pevný a o modrotisku a noci neví.
    // Bez tohohle obalu by po přepnutí z modrotisku na Smaragd zůstala třída viset.
    function wrapPreview() {
        var orig = window.previewTheme;
        if (typeof orig !== 'function' || orig.__agMotivy) return false;
        var wrapped = function (t) {
            try { OUR.forEach(function (c) { document.body.classList.remove(c); }); } catch (e) { swallow(e, 'wrap:clean'); }
            var r;
            try { r = orig.apply(this, arguments); } catch (e) { swallow(e, 'wrap:orig'); }
            chrome(t);
            // uživatel si vybral sám → automatika couvne a zapamatuje si jeho volbu
            _autoOn = false;
            _prevTheme = null;
            if (autoMode()) snoozeTillNoon();
            markState();
            return r;
        };
        wrapped.__agMotivy = true;
        window.previewTheme = wrapped;
        return true;
    }

    function installOptions() {
        var sel = document.getElementById('v-theme');
        if (!sel || sel.__agMotivy) return false;
        sel.__agMotivy = true;
        OPTS.forEach(function (o) {
            if (sel.querySelector('option[value="' + o.v + '"]')) return;
            var el = document.createElement('option');
            el.value = o.v; el.textContent = o.t;
            sel.appendChild(el);
        });
        // Uložený motiv mohl být náš — grafika.js ho do selectu nastavit umí
        // (bere hodnotu z visSettings), ale třídu přidá jen když previewTheme
        // proběhne PO nás. Srovnáme to sami.
        try {
            var v = sel.value;
            if (v === 'blueprint' || v === 'night') setTheme(v);
        } catch (e) { swallow(e, 'installOptions:apply'); }
        return true;
    }

    function installRow() {
        var sel = document.getElementById('v-theme');
        if (!sel || document.getElementById('ag-night-auto')) return false;

        var row = document.createElement('div');
        row.className = 'ag-night-row';
        var lab = document.createElement('span');
        lab.className = 'ag-night-lab';
        lab.textContent = 'Noční režim';
        var s = document.createElement('select');
        s.id = 'ag-night-auto';
        s.className = 'st-sel';
        [{ v: 'off', t: 'Vypnuto' }, { v: 'auto', t: 'Automaticky po setmění' }].forEach(function (o) {
            var el = document.createElement('option');
            el.value = o.v; el.textContent = o.t;
            s.appendChild(el);
        });
        try { s.value = autoMode() ? 'auto' : 'off'; } catch (e) { swallow(e, 'installRow:val'); }
        s.addEventListener('change', function () {
            try { localStorage.setItem(LS_AUTO, s.value === 'auto' ? 'auto' : 'off'); } catch (e) { swallow(e, 'installRow:save'); }
            _snoozeUntil = 0;
            tick();
        });
        row.appendChild(lab); row.appendChild(s);

        var hint = document.createElement('div');
        hint.className = 'ag-night-hint';
        hint.id = 'ag-night-hint';

        sel.parentNode.insertBefore(row, sel.nextSibling);
        sel.parentNode.insertBefore(hint, row.nextSibling);
        markState();
        return true;
    }

    // Popisek pod přepínačem: kdy se dnes přepne (nebo že běží).
    function markState() {
        var h = document.getElementById('ag-night-hint');
        if (!h) return;
        var txt = 'Červená paleta bez modré — po tmě nezničí adaptaci oka a displej tolik nesvítí. Vybrat ho jde i ručně nahoře jako barevný odstín.';
        try {
            if (autoMode()) {
                var S = window.AGSun, p = pos(), t = S && S.times ? S.times(new Date(), p.lat, p.lng, 96) : null;
                var hh = function (d) { return d ? ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) : '–'; };
                if (_autoOn) txt = 'Teď je zapnutý automaticky. Ráno v ' + (t ? hh(t.rise) : '–') + ' se vrátí motiv, který jsi měl předtím.';
                else if (t && t.set) txt = 'Zapne se dnes v ' + hh(t.set) + ' (občanský soumrak) a ráno v ' + hh(t.rise) + ' se zase vrátí zpět.';
            }
        } catch (e) { swallow(e, 'markState'); }
        h.textContent = txt;
    }

    // ---- start ----------------------------------------------------------------
    function boot() {
        installOptions();
        installRow();
        wrapPreview();
        tick();
        if (!_timer) _timer = setInterval(tick, 60000);   // 1× za minutu = pro baterii nic
    }

    try {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
        // Nastavení i grafika.js dobíhají po load — zkusit ještě jednou, kdyby
        // <select id="v-theme"> v DOM při prvním pokusu ještě nebyl.
        window.addEventListener('load', function () { setTimeout(boot, 300); });
        document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    } catch (e) { swallow(e, 'boot'); }

    window.AGMotivy = { isNight: isNight, setTheme: setTheme, tick: tick };
})();
