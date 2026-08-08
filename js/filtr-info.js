// ===== AR Geodet — KOLIK BODŮ JE PRÁVĚ SCHOVANÝCH (ODPOJITELNÁ vrstva) ==========
// PROBLÉM, který řeší: body se zahazují na TŘECH nezávislých místech a ani jedno
// nedá o sobě vědět:
//   • filtry kategorií (filters.tb/zhb/pbpp/nivel/custom) — ULOŽENÉ PER ZAKÁZKA
//     (klíč arFilters12), takže přežijí restart telefonu i týden dovolené,
//   • hledání podle názvu (searchQuery ze zaškrtávacího pole v Nastavení),
//   • „Skrýt tento bod z AR" (pt.hidden, jen do restartu).
// Uživatel pak kouká na prázdnou mapu, hlásí „appka nezobrazuje body" a nikdo —
// ani on, ani ten, kdo to po něm hledá — nemá na obrazovce jedinou stopu proč.
// Tenhle scénář už reálně nastal a stál půl dne dohledávání.
//
// ŘEŠENÍ: dokud něco něco schovává, visí v centru upozornění (js/upozorneni.js)
// řádek „Filtry schovávají 128 z 214 bodů" s tlačítkem „Zobrazit vše", které
// jedním klepnutím zapne všechny kategorie, smaže hledání a odkryje ručně skryté
// body. Když se nic neschovává, řádek zmizí sám.
//
// DRUHÁ VĚC, kterou modul hlásí: STROP „max. bodů v AR". renderAR kreslí jen N
// nejbližších značek (posuvník v Nastavení → AR) a zbytek beze slova zahodí — na
// hustém staveništi tak uživatel kouká na neúplný obraz a myslí si, že jsou to
// všechny body. Hlásí se to až po pár vteřinách trvalého ubírání a se zaokrouhlením
// na desítky, aby text při chůzi neposkakoval.
//
// PROČ TO NENÍ jen ve výpisu Nástrojů: tohle musí být vidět BEZ hledání — smysl
// je, aby to uživatele trklo dřív, než začne přemýšlet, co je rozbité.
//
// ZÁMĚRNĚ SE NEHLÁSÍ dosah (arRadius/mapRadius): ten je vidět v Nastavení posuvníkem,
// je to vědomá volba „jak daleko chci koukat" a při chůzi se mění pořád — hlásit ho
// by znamenalo mít upozornění svítící trvale, což je stejně k ničemu jako nic.
//
// Bez js/upozorneni.js (AGNotify) se modul tiše vypne — nekreslí si vlastní pruh,
// aby si nezačal o místo nahoře říkat další prvek. Přesně tomu má sloupec bránit.
//
// Odstranění: smaž js/filtr-info.js + jeho řádek <script> v index.html a přegeneruj
// sw.js (python scripts/gen_sw_assets.py).
// ================================================================================
(function () {
    'use strict';
    if (window.AGFiltrInfo) return;

    var CATS = [
        { cat: 'TB', key: 'tb', box: 'f-tb', wbox: 'w-f-tb' },
        { cat: 'ZHB', key: 'zhb', box: 'f-zhb', wbox: 'w-f-zhb' },
        { cat: 'PBPP', key: 'pbpp', box: 'f-pbpp', wbox: 'w-f-pbpp' },
        { cat: 'NIVEL', key: 'nivel', box: 'f-nivel', wbox: 'w-f-nivel' },
        { cat: 'CUSTOM', key: 'custom', box: 'f-custom', wbox: 'w-f-custom' }
    ];

    // Globály z logika.js jsou top-level `let` — čitelné jménem, ale ReferenceError,
    // když se soubor odpojí. Všechno tedy přes typeof.
    function pts() {
        try { if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) return arPoints; } catch (e) {}
        return null;
    }
    function flt() {
        try { if (typeof filters !== 'undefined' && filters && typeof filters === 'object') return filters; } catch (e) {}
        return null;
    }
    function q() {
        try { if (typeof searchQuery === 'string') return searchQuery.trim(); } catch (e) {}
        return '';
    }

    // Shoda s hledaným textem: když appka nabízí vlastní porovnání (agMatchQuery — umí
    // i diakritiku a kódy bodů), použijeme JEHO, ať tenhle výpis neukazuje jiná čísla,
    // než co je doopravdy na mapě. Jinak prostý podřetězec jako v grafika.js.
    function matches(p, needleLC) {
        try { if (typeof agMatchQuery === 'function') return !!agMatchQuery(p, needleLC); } catch (e) {}
        return String(p.name == null ? '' : p.name).toLowerCase().indexOf(needleLC) >= 0;
    }

    // ---- spočítat, co se schovává ---------------------------------------------------
    // Vrací {total, shown, byFilter, bySearch, byHidden}. Kategorie bodu, na kterou
    // filtry neznáme, se bere jako zobrazená (nová kategorie nesmí vyrobit falešný poplach).
    function count() {
        var arr = pts(); if (!arr) return null;
        var f = flt(), needle = q().toLowerCase();
        var out = { total: arr.length, shown: 0, byFilter: 0, bySearch: 0, byHidden: 0 };
        for (var i = 0; i < arr.length; i++) {
            var p = arr[i]; if (!p) continue;
            if (p.hidden) { out.byHidden++; continue; }
            var offByFilter = false;
            if (f) {
                for (var c = 0; c < CATS.length; c++) {
                    if (p.cat === CATS[c].cat && f[CATS[c].key] === false) { offByFilter = true; break; }
                }
            }
            if (offByFilter) { out.byFilter++; continue; }
            if (needle && !matches(p, needle)) { out.bySearch++; continue; }
            out.shown++;
        }
        return out;
    }

    // ---- text hlášky ------------------------------------------------------------------
    // Jmenovitě říct ČÍM se schovává — jinak uživatel neví, kde to vypnout, a tlačítko
    // „Zobrazit vše" je jediná cesta ven (a on se pak bojí, že přijde o nastavení).
    function bodyText(c) {
        var hid = c.total - c.shown;
        var duvody = [];
        // mn = podmět je v množném čísle (kvůli shodě s přísudkem: filtry schovávAJÍ,
        // ale hledání schovávÁ). Čeština to hlídá i v jednořádkové hlášce.
        if (c.byFilter) duvody.push({ t: 'filtry kategorií', mn: true });
        if (c.bySearch) duvody.push({ t: 'hledání „' + q() + '"', mn: false });
        if (c.byHidden) duvody.push({ t: 'ruční skrytí', mn: false });
        var texty = duvody.map(function (d) { return d.t; });
        var kdo = texty.length === 1 ? texty[0] : texty.slice(0, -1).join(', ') + ' a ' + texty[texty.length - 1];
        // velké písmeno na začátku věty, ať to nezačíná „filtry" uprostřed pilulky
        kdo = kdo.charAt(0).toUpperCase() + kdo.slice(1);
        // víc podmětů = množné číslo vždy; jeden podmět = podle něj
        var sloveso = (duvody.length > 1 || duvody[0].mn) ? 'schovávají' : 'schovává';
        // „všechny body" schválně bez čísla — „všech 2 bodů" by byla patvarová shoda
        if (c.shown === 0) return kdo + ' ' + sloveso + ' všechny body — na mapě ani v AR nic není';
        return kdo + ' ' + sloveso + ' ' + hid + ' z ' + c.total + ' bodů';
    }

    // ---- zrušit všechno, co schovává ---------------------------------------------------
    function showAll() {
        var f = flt();
        if (f) CATS.forEach(function (c) { f[c.key] = true; });
        // zaškrtávátka v Nastavení i na úvodní obrazovce dorovnat, ať UI nelže
        CATS.forEach(function (c) {
            [c.box, c.wbox].forEach(function (id) {
                var el = document.getElementById(id); if (el) el.checked = true;
            });
        });
        // uložit stejným klíčem jako updateFilters() v logika.js — jinak se stav vrátí po restartu
        try { if (typeof setStoredData === 'function' && f) setStoredData('arFilters12', JSON.stringify(f)); } catch (e) {}
        // hledání
        try { if (typeof searchQuery === 'string') searchQuery = ''; } catch (e) {}
        ['s-search-name', 'w-search-name'].forEach(function (id) {
            var el = document.getElementById(id); if (el) el.value = '';
        });
        // ručně skryté body
        var arr = pts();
        if (arr) arr.forEach(function (p) {
            if (p && p.hidden) {
                p.hidden = false;
                // reziduum po animaci skrytí (stejný důvod jako v js/hidden-points.js):
                // bez vynulování opacity zůstane značka neviditelná, dokud ji něco nepřekreslí
                try { if (p.element && p.element.style) p.element.style.opacity = ''; } catch (e) {}
            }
        });
        try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) {}
        try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) {}
        try { if (typeof updateInfoPanel === 'function') updateInfoPanel(); } catch (e) {}
        try {
            var mm = document.getElementById('manage-modal');
            if (mm && mm.style.display === 'flex' && typeof renderManageList === 'function') renderManageList();
        } catch (e) {}
        try { if (typeof quickToast === 'function') quickToast('Zobrazeny všechny body.'); } catch (e) {}
        refresh();
    }

    // Ukázat, KDE se filtry přepínají — Nastavení → záložka Data (tam jsou f-tb…f-custom
    // i pole hledání). Uživatel tak vidí, co si zapnul, a může to zrušit po svém.
    function openFilters() {
        try { if (typeof openSettings === 'function') openSettings(); } catch (e) { return; }
        try {
            var btn = document.querySelector('#settings-modal .tab-btn[onclick*="tab-data"]');
            if (btn) btn.click();
            var row = document.getElementById('f-tb');
            if (row && row.closest) {
                var box = row.closest('.st-chip');
                if (box && box.scrollIntoView) box.scrollIntoView({ block: 'center' });
            }
        } catch (e) {}
    }

    // ---- hlášení do sloupce upozornění -------------------------------------------------
    var _lastKey = '';
    function refresh() {
        if (!window.AGNotify) return;
        // před spuštěním appky (úvodní obrazovka) nemá smysl nic hlásit — body se teprve stahují
        var started = true;
        try { if (typeof appStarted !== 'undefined') started = !!appStarted; } catch (e) {}
        var c = started ? count() : null;
        if (!c || c.total === 0 || c.shown === c.total) {
            if (_lastKey) { _lastKey = ''; try { AGNotify.clear('filtr-skryte'); } catch (e) {} }
            return;
        }
        // překreslovat jen při skutečné změně čísel (refresh() jede po každém drawAllMarkersOnMap)
        var key = c.total + '/' + c.shown + '/' + c.byFilter + '/' + c.bySearch + '/' + c.byHidden + '/' + q();
        if (key === _lastKey) return;
        _lastKey = key;
        try {
            AGNotify.set('filtr-skryte', {
                // všechno schované = tvrdá závada z pohledu uživatele, jinak jen upozornění
                level: c.shown === 0 ? 'danger' : 'warn',
                text: bodyText(c),
                order: 5,
                // tlačítko v rozjeté kartě = jednorázové zrušení všeho
                action: { label: 'Zobrazit vše', fn: showAll },
                // klepnutí na řádek NIC neruší, jen ukáže, kde se to přepíná
                // (mazat uživateli nastavení omylem prstem by bylo horší než ten problém)
                onAction: openFilters,
                // vyškrtnutí je jen na tenhle stav — jakmile se počty změní, ozve se znovu
                onDismiss: function () { _lastKey = ' dismissed'; }
            });
        } catch (e) {}
    }

    // ---- strop „max. bodů v AR" --------------------------------------------------------
    // renderAR vystavuje window._arCapped = {capped, shown, max}. Ohlásíme se, TEPRVE
    // když strop opravdu ubírá — a se zpožděním, protože při chůzi hustým staveništěm
    // číslo poskakuje snímek od snímku a blikající upozornění je horší než žádné.
    var _capSince = 0, _capKey = '';
    var CAP_DELAY_MS = 6000;      // jak dlouho musí strop ubírat, než se ozveme
    function refreshCap() {
        if (!window.AGNotify) return;
        var c = null;
        try { c = window._arCapped; } catch (e) {}
        // v mapovém režimu se AR nepočítá — poslední známý stav by lhal
        var arVidet = true;
        try { if (typeof viewMode !== 'undefined') arVidet = (viewMode !== 'map'); } catch (e) {}
        if (!c || !c.capped || !arVidet) {
            _capSince = 0;
            if (_capKey) { _capKey = ''; try { AGNotify.clear('ar-strop'); } catch (e) {} }
            return;
        }
        var now = Date.now();
        if (!_capSince) { _capSince = now; return; }
        if (now - _capSince < CAP_DELAY_MS) return;
        // zaokrouhlit na desítky, ať hláška nepřepisuje text při každém kroku
        var round = Math.round(c.capped / 10) * 10 || c.capped;
        var key = round + '/' + c.max;
        if (key === _capKey) return;
        _capKey = key;
        try {
            AGNotify.set('ar-strop', {
                level: 'info',
                text: 'V AR se kreslí jen ' + c.max + ' nejbližších bodů — dalších ~' + round + ' se nevejde',
                order: 30,
                action: { label: 'Zvýšit strop', fn: raiseCap },
                onAction: openArSettings
            });
        } catch (e) {}
    }
    // Zdvojnásobit strop (strop posuvníku je 200). Nastavení se ukládá stejnou cestou
    // jako ruční posun posuvníku, takže to přežije restart.
    function raiseCap() {
        try {
            if (typeof visSettings === 'undefined' || !visSettings) return;
            var cur = visSettings.maxARPoints || 60;
            var next = Math.min(200, Math.max(cur + 20, cur * 2));
            visSettings.maxARPoints = next;
            var sl = document.getElementById('s-max-ar-slider'); if (sl) sl.value = next;
            var lb = document.getElementById('s-max-ar-val'); if (lb) lb.innerText = next;
            try { if (typeof setStoredData === 'function') setStoredData('arVisSettings12', JSON.stringify(visSettings)); } catch (e) {}
            _capKey = ''; _capSince = 0;
            try { AGNotify.clear('ar-strop'); } catch (e) {}
            try { if (typeof quickToast === 'function') quickToast(next >= 200 ? 'Strop na maximu: 200 bodů v AR.' : 'Strop zvýšen na ' + next + ' bodů v AR.'); } catch (e) {}
        } catch (e) {}
    }
    function openArSettings() {
        try { if (typeof openSettings === 'function') openSettings(); } catch (e) { return; }
        try {
            var btn = document.querySelector('#settings-modal .tab-btn[onclick*="tab-ar"]');
            if (btn) btn.click();
            var sl = document.getElementById('s-max-ar-slider');
            if (sl && sl.scrollIntoView) sl.scrollIntoView({ block: 'center' });
        } catch (e) {}
    }

    // ---- napojení -----------------------------------------------------------------------
    // drawAllMarkersOnMap() je společný uzel: volá se po změně filtrů, uložení bodu,
    // skrytí/odkrytí i po stažení dat z ČÚZK. Obalíme ho, ať nemusíme hlídat každou cestu.
    // Obalujeme přes window[...] — stejný vzor jako js/undo.js. Funkce v grafika.js jsou
    // obyčejné globální deklarace, takže přepis na window je vidět i volajícím uvnitř ní.
    function hook() {
        try {
            var orig = window.drawAllMarkersOnMap;
            if (typeof orig !== 'function' || orig.__agFiltrInfo) return false;
            window.drawAllMarkersOnMap = function () {
                var r = orig.apply(this, arguments);
                try { refresh(); } catch (e) {}
                return r;
            };
            window.drawAllMarkersOnMap.__agFiltrInfo = true;
            return true;
        } catch (e) { return false; }
    }

    function init() {
        // grafika.js se načítá po nás jen výjimečně, ale obalení zkusíme i opakovaně,
        // dokud funkce nevznikne (stejný vzor jako ostatní odpojitelné vrstvy)
        if (!hook()) {
            var tries = 0;
            var t = setInterval(function () {
                if (hook() || ++tries > 40) clearInterval(t);
            }, 250);
        }
        // pojistka: stažení dalších bodů z ČÚZK při chůzi mapu překresluje, ale kdyby
        // nějaká cesta drawAllMarkersOnMap obešla, pomalý tik to dorovná (jen v popředí)
        (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(refresh, 4000);
        // strop AR se mění s chůzí, ne s překreslením mapy — vlastní, hustší tik
        (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(refreshCap, 2000);
        refresh();
    }

    window.AGFiltrInfo = { refresh: refresh, showAll: showAll, count: count, refreshCap: refreshCap };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
