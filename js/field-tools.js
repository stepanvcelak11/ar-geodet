// ===== AR Geodet — TERÉNNÍ NÁSTROJE: dlaždice v sekci „Nástroje" (ODPOJITELNÁ) ==
// Neinvazivní vrstva ve stylu js/gps-warn.js / js/kml-export.js: NEEDITUJE
// logika.js ani grafika.js. Ostatní moduly (orientace přes bod, offset bodu,
// stopa trasy, vytyčení přímky, AR resekce, import projektu, katastr, parcela…)
// se REGISTRUJÍ přes
//   window.agRegisterFieldTool({ id, label, icon, onClick, order, cat })
// a tento launcher je vykreslí jako DLAŽDICE přímo do mřížky v modalu „Nástroje"
// (#tools-modal .tool-grid), pod oddělovací nadpis „Terénní nástroje".
// Volitelné `cat: 'Pomůcky'` zařadí dlaždici na konec existující statické
// kategorie (.tool-cat se stejným názvem) místo sekce „Terénní nástroje".
// Když tento soubor chybí, každý modul si vyrobí vlastní nouzové tlačítko, takže
// je každý odpojitelný samostatně.
//
// Odstranění: smaž js/field-tools.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var STYLE_ID = 'ag-ft-style';
    var COLL_KEY = 'agToolCatsClosed_v1';   // sbalené kategorie (názvy)
    var USE_KEY = 'agToolUsage_v1';         // počítadlo použití nástrojů (klíč -> počet)
    var _items = [];          // {id,label,icon,onClick,order}

    // Kategorie pro injektované nástroje, které si ji samy neurčí (cat v registraci
    // má přednost). Neznámé id spadnou do záchytné sekce „Terénní nástroje".
    var TOOL_CATS = {
        'brutal-gps': 'Měření', 'vyska-objektu': 'Měření',
        'epochy': 'Měření', 'zapisnik': 'Měření', 'track-log': 'Měření',
        'gps-semafor': 'Měření', 'dgps': 'Měření', 'pdr-offset': 'Měření',
        'stakeout-line': 'Vytyčování a náčrt', 'offset-point': 'Vytyčování a náčrt', 'vrstvy': 'Vytyčování a náčrt',
        'cadastre-vector': 'Katastr a data', 'parcela': 'Katastr a data', 'project-import': 'Katastr a data', 'geo-overlay': 'Katastr a data',
        'ar-resection': 'AR a kalibrace', 'ar-intersection': 'Měření', 'orient-point': 'AR a kalibrace',
        'postupy': 'Pomůcky'
    };

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }

    // ---- styly (injektované, ať se nesahá do style.css) ------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // oddělovací nadpis přes celou šířku mřížky
            '#tools-modal .ag-ft-head{grid-column:1/-1;margin:8px 2px 0;padding-top:8px;border-top:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  font:700 11px/1 var(--font-display,system-ui),sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);text-align:left;}',
            // ikona uvnitř injektované dlaždice (moduly dodávají <svg> bez rozměrů)
            '#tools-modal .ag-ft-tile svg{width:24px;height:24px;color:var(--accent,#2f9e74);}',
            '#tools-modal .ag-ft-tile span{display:block;}',
            // sbalitelné kategorie: nadpis je klikací, šipka ukazuje stav
            '#tools-modal .tool-cat,#tools-modal .ag-ft-head{cursor:pointer;-webkit-user-select:none;user-select:none;}',
            '#tools-modal .tool-cat:not(#ag-fav-head)::after,#tools-modal .ag-ft-head::after{content:"▾";float:right;font-size:calc(11px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);}',
            '#tools-modal .ag-cat-closed::after{content:"▸" !important;}',
            // hlaska „nic nenalezeno" pri hledani bez zasahu
            '#ag-ft-empty{grid-column:1/-1;display:none;padding:14px 8px;text-align:center;color:var(--text-muted,#9aa1ac);font:500 13px/1.4 var(--font-ui,system-ui),sans-serif;}',
            '#ag-ft-empty.on{display:block;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function getGrid() {
        var m = document.getElementById('tools-modal');
        return m ? m.querySelector('.tool-grid') : null;
    }
    function closeToolsModal() { var m = document.getElementById('tools-modal'); if (m) m.style.display = 'none'; }

    // ---- vykreslení dlaždic do mřížky Nástrojů --------------------------------
    function makeTile(it) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tool-tile ag-ft-tile';
        btn.setAttribute('data-tool', it.id);
        btn.innerHTML = (it.icon || '') + '<span>' + esc(it.label) + '</span>';
        btn.addEventListener('click', function () {
            closeToolsModal();
            if (typeof it.onClick === 'function') {
                try { it.onClick(); } catch (err) { console.warn('[field-tools]', err); }
            }
        });
        return btn;
    }
    // Vloží dlaždici na KONEC pojmenované statické kategorie (např. cat: 'Pomůcky').
    // Vrací false, když kategorie v mřížce není — dlaždice pak spadne do „Terénní nástroje".
    function placeInCategory(grid, it) {
        var cats = grid.querySelectorAll('.tool-cat');
        for (var i = 0; i < cats.length; i++) {
            if ((cats[i].textContent || '').trim() !== it.cat) continue;
            // konec bloku kategorie = další nadpis (.tool-cat / .ag-ft-head), jinak konec mřížky
            var node = cats[i].nextSibling;
            while (node) {
                if (node.nodeType === 1 && node.classList &&
                    (node.classList.contains('tool-cat') || node.classList.contains('ag-ft-head'))) break;
                node = node.nextSibling;
            }
            grid.insertBefore(makeTile(it), node);
            return true;
        }
        return false;
    }
    function itemById(id) {
        for (var i = 0; i < _items.length; i++) { if (_items[i].id === id) return _items[i]; }
        return null;
    }
    function syncTiles() {
        var grid = getGrid();
        if (!grid) return;
        injectStyles();
        // INKREMENTÁLNĚ: dlaždice, které už v mřížce jsou, se NEsahají — mohou být
        // přesunuté v sekcích ★ Oblíbené (tools-plus) / ◆ Pro tuto práci (tools-simple).
        // Dřívější plné zbourání a přestavění s těmi moduly válčilo: každé jejich
        // odebrání dlaždice spustilo rebuild, ten zas jejich přesun → mřížka
        // viditelně problikávala. Teď se jen odstraní osiřelé/duplicitní a doplní chybějící.
        var have = {}, i;
        var cur = grid.querySelectorAll('.ag-ft-tile');
        for (i = 0; i < cur.length; i++) {
            var id = cur[i].getAttribute('data-tool');
            if (!id || have[id] || !itemById(id)) { cur[i].remove(); continue; }
            have[id] = true;
        }
        if (!_items.length) return;

        var sorted = _items.slice().sort(function (a, b) { return (a.order || 50) - (b.order || 50); });
        // dlaždice s cat jdou do své statické kategorie, zbytek pod „Terénní nástroje"
        var rest = sorted.filter(function (it) {
            if (have[it.id]) return false;
            return !(it.cat && placeInCategory(grid, it));
        });
        if (rest.length) {
            var head = grid.querySelector('.ag-ft-head');
            if (!head) {
                head = document.createElement('div');
                head.className = 'ag-ft-head';
                head.textContent = 'Terénní nástroje';
                grid.appendChild(head);
            }
            // vlož na konec bloku „Terénní nástroje" (za nadpis, před další nadpis)
            var node = head.nextSibling;
            while (node) {
                if (node.nodeType === 1 && node.classList &&
                    (node.classList.contains('tool-cat') || node.classList.contains('ag-ft-head'))) break;
                node = node.nextSibling;
            }
            rest.forEach(function (it) { grid.insertBefore(makeTile(it), node); });
        }
        try { applyFilter(); } catch (e) {}   // znovu aplikuj aktivní hledání i na čerstvě vložené dlaždice
    }

    // ---- CHYTRÉ vyhledávání nástrojů --------------------------------------------
    // Víc než prosté „obsahuje": bez diakritiky, slova v libovolném pořadí,
    // SYNONYMA (geodetický slang → dlaždice), tolerance překlepu (1 znak)
    // a řazení výsledků podle relevance (+ lehký bonus často používaným).
    function norm(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
        return s.replace(/\s+/g, ' ').trim();
    }
    // Synonyma/klíčová slova: klíč = data-tool id NEBO název volané funkce (tileToolKey).
    // Hodnota = slova bez diakritiky, kterými geodet nástroj reálně hledá.
    var SEARCH_ALIASES = {
        openMeasureModal: 'vzdalenost delka metry mezi body prevyseni sikma pasmo distance',
        startAreaMode: 'plocha vymera obvod pozemek polygon hektar m2 area',
        openCheckDist: 'omerne kontrolni miry kontrola delek pasmo overeni',
        openDmtVolume: 'kubatura objem vrstevnice dmt teren vykop nasyp hromada',
        openStakeoutModal: 'vytyceni vytycovaci checklist seznam protokol',
        openTachymetrie: 'nacrt kresba skica tachymetrie zpmz polni nakres',
        openKatastr: 'katastr parcela kn nahlizeni kde stojim mapa cuzk',
        openSatModal: 'gnss satelity druzice obloha prekazky signal gps kvalita',
        dronview: 'dron drony zony letani omezeni vzdusny prostor uas dronview rlp',
        'err-log': 'protokol chyb log chyba diagnostika hlaseni',
        agOpenCalibrate: 'sever kalibrace kompas azimut srovnat smer odchylka',
        openCalcModal: 'kalkulacka vypocet prevod gon stupne uhly plocha',
        kompas: 'kompas busola ruzice sever magneticky zemepisny pravy azimut deklinace smer strelka gon nula',
        openDictModal: 'slovnik pojmy zkratky vyznam terminologie',
        'brutal-gps': 'presne gps mereni prumer prumerovani brutalni poloha bod',
        'gps-semafor': 'semafor skore mista multipath signal kvalita gps fasada odrazy podminky',
        dgps: 'dgps diferencni korekce zakladna rover druhy telefon presnost oprava bodu',
        'pdr-offset': 'kroky krokovy offset vektor chuze pdr roh budovy dead reckoning',
        'vyska-objektu': 'vyska objektu budova strom stozar uhel meridlo',
        epochy: 'epochy monitoring posuny deformace sledovani opakovane',
        zapisnik: 'zapisnik polni denik poznamky mereni zaznamy',
        'track-log': 'stopa trasa log gpx zaznam cesty prochazka',
        'stakeout-line': 'vytyceni primky linie rovina stanoveni smeru',
        'offset-point': 'odsazeny bod offset kolmice stanoveni vypocet',
        vrstvy: 'vrstvy pokladka skladba silnice asfalt sklon rez finisher tablet',
        'cadastre-vector': 'katastr vektor hranice parcely dxf import mapa kn',
        parcela: 'parcela geometrie deleni vymera obvod smerniky dily',
        'project-import': 'import projekt oblast stazeni csv dxf soubor nahrat',
        'geo-overlay': 'podklad georeference obrazek plan situace vykres overlay',
        'ar-resection': 'resekce protinani zpet stanovisko volne zname body',
        'ar-intersection': 'protinani vpred uhly neznamy bod urceni',
        'orient-point': 'orientace bod sever srovnani smer',
        postupy: 'postupy navody checklisty pracovni kroky jak na',
        rajon: 'rajon polarni metoda uhel delka stanovisko novy bod',
        'free-station': 'volne stanovisko pruvodce resekce prechodne',
        'hidden-points': 'skryte body obnovit zobrazit schovane',
        'kml-export': 'kml export google earth mapy soubor',
        'dxf-export': 'dxf export cad vykres autocad soubor',
        predpisy: 'predpisy vyhlaska odchylky kody lhuty tahak normy trida presnosti',
        'sky-obstruction': 'predikce signalu obloha prekazky stromy budovy gnss planovani',
        'job-transfer': 'prenos zakazky export import argeo sdileni telefon',
        'utility-networks': 'site podzemni vedeni inzenyrske gml kabel plyn voda',
        'localization-helmert': 'helmert lokalizace transformace klic mistni system',
        zavady: 'zavada zavady porucha vada nalez hlaseni defekt kontrola oprava foto protokol reklamace',
        'usadit-ar': 'usadit srovnat kalibrace sever ar pruvodce orientace nesedi posun helmert resekce stanovisko',
        'bod-vypoctem': 'bod vypoctem novy vypocet rajon offset protinani smernik delka uhel konstrukce rozcestnik',
        'gnss-signal': 'gnss signal gps kvalita druzice satelity predikce semafor skore multipath obloha podminky',
        prirucka: 'prirucka predpisy postupy slovnik odchylky kody lhuty navody tahak pojmy zkratky',
        zpravodaj: 'zpravodaj zpravy novinky clanky geodezie',
        kos: 'kos smazane body obnovit odpadky obnova vratit zpet zakazky',
        zaloha: 'zaloha export import obnova dat json',
        'gnss-forecast': 'gnss predpoved kdy merit pdop dop okno planovani ionosfera kp bourka geometrie druzic pocasi pro gps',
        slunce: 'slunce svetlo zapad vychod soumrak stin protisvetlo oslneni tma azimut zlata hodina',
        checklist: 'checklist co s sebou baleni vybaveni seznam rano nezapomen vzit',
        'kde-je': 'auto parkovani kde stoji baze stativ material najit zpatky navigace znacka',
        'kniha-jizd': 'kniha jizd cestak kilometry km naklady cestovni nahrady tachometr vozidlo ucetni',
        korekce: 'korekce ppm pasmo teplota tlak vlhkost refrakce zakriveni edm dalkomer atmosfericka oprava pruves',
        bezpecnost: 'bezpecnost bozp riziko vedro pitny rezim bourka blesk vesta soumrak mraz vitr sos poloha pomoc',
        'moje-aktivita': 'aktivita statistika prehled kroky krokomer kilometry vyskove metry nastoupano cas souhrn dne kolik jsem udelal pouzivani nastroju skryt nepouzivane'
    };
    function loadClosed() { try { var a = JSON.parse(localStorage.getItem(COLL_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function saveClosed(a) { try { localStorage.setItem(COLL_KEY, JSON.stringify(a)); } catch (e) {} }
    // vzdalenost uprav max 1 (preklep/vynechany znak) — staci pro slova dlazdic
    function within1(a, b) {
        if (a === b) return true;
        var la = a.length, lb = b.length;
        if (Math.abs(la - lb) > 1) return false;
        var i = 0, j = 0, diff = 0;
        while (i < la && j < lb) {
            if (a[i] === b[j]) { i++; j++; continue; }
            if (++diff > 1) return false;
            if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
        }
        return diff + (la - i) + (lb - j) <= 1;
    }
    // skóre jednoho tokenu proti seznamu slov (0 = nesedí)
    function tokenScore(tok, words) {
        var best = 0;
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (w === tok) { best = Math.max(best, 3); }
            else if (w.indexOf(tok) === 0) { best = Math.max(best, 2.5); }
            else if (tok.length >= 3 && w.indexOf(tok) !== -1) { best = Math.max(best, 2); }
            else if (tok.length >= 4 && within1(tok, w)) { best = Math.max(best, 1.2); }
            if (best >= 3) break;
        }
        return best;
    }
    // celkové skóre dlaždice: všechna slova dotazu musí sedět (název NEBO synonyma)
    function tileScore(tile, tokens, usage) {
        var label = norm(tileToolLabel(tile));
        var lWords = label.split(' ');
        var key = tileToolKey(tile);
        var alias = SEARCH_ALIASES[key] || '';
        var aWords = alias ? alias.split(' ') : [];
        var total = 0;
        for (var t = 0; t < tokens.length; t++) {
            var sL = tokenScore(tokens[t], lWords);
            var sA = aWords.length ? tokenScore(tokens[t], aWords) : 0;
            var s = Math.max(sL, sA * 0.8);   // shoda v názvu má přednost před synonymem
            if (!s) return 0;
            total += s;
        }
        // lehký bonus často používaným nástrojům (rozhoduje jen při stejné shodě)
        var u = usage[key] || 0;
        return total + Math.min(u, 10) * 0.03;
    }
    function ensureEmptyMsg(grid) {
        var e = document.getElementById('ag-ft-empty');
        if (!e) { e = document.createElement('div'); e.id = 'ag-ft-empty'; e.textContent = 'Nic nenalezeno — zkus jiné slovo (např. „výměra", „kubatura", „sever").'; grid.appendChild(e); }
        else if (e.parentNode !== grid) grid.appendChild(e);
        return e;
    }
    var _bestTile = null;   // nejlepší zásah pro Enter
    function applyFilter() {
        var grid = getGrid(); if (!grid) return;
        var inp = document.getElementById('tools-search');
        var q = norm(inp ? inp.value : '');
        var tokens = q ? q.split(' ') : [];
        var closed = loadClosed();
        var usage = loadUsage();
        var kids = grid.children, lastHead = null, headHasHit = false, secClosed = false;
        var anyHit = false, bestScore = 0;
        _bestTile = null;
        // při hledání se sbalení ignoruje (ukázat zásahy), bez hledání se nadpisy nechávají vidět
        function flushHead() { if (lastHead) lastHead.style.display = (q && !headHasHit) ? 'none' : ''; }
        for (var i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (el.id === 'ag-ft-empty') continue;
            if (el.classList.contains('tool-cat') || el.classList.contains('ag-ft-head')) {
                flushHead(); lastHead = el; headHasHit = false;
                secClosed = !q && el.id !== 'ag-fav-head' && closed.indexOf((el.textContent || '').trim()) !== -1;
                el.classList.toggle('ag-cat-closed', secClosed);
                continue;
            }
            if (el.classList.contains('tool-tile') || el.classList.contains('ag-ft-tile')) {
                if (!q) {
                    el.style.display = secClosed ? 'none' : '';
                    el.style.order = '';
                    continue;
                }
                var score = tileScore(el, tokens, usage);
                var hit = score > 0;
                el.style.display = hit ? '' : 'none';
                // řazení podle relevance: mřížka je CSS grid → stačí order (vyšší skóre dřív)
                el.style.order = hit ? String(Math.max(0, 1000 - Math.round(score * 50))) : '';
                if (hit) { headHasHit = true; anyHit = true; if (score > bestScore) { bestScore = score; _bestTile = el; } }
            }
        }
        flushHead();
        var emptyMsg = ensureEmptyMsg(grid);
        emptyMsg.classList.toggle('on', !!q && !anyHit);
    }
    window.agFilterTools = applyFilter;
    // Enter ve vyhledávání = otevřít nejlepší zásah
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var inp = document.getElementById('tools-search');
        if (!inp || document.activeElement !== inp || !inp.value) return;
        if (_bestTile) { e.preventDefault(); _bestTile.click(); }
    });
    // klepnutí na nadpis kategorie = sbalit/rozbalit (mimo ★ Oblíbené)
    document.addEventListener('click', function (e) {
        var head = e.target.closest ? e.target.closest('#tools-modal .tool-cat, #tools-modal .ag-ft-head') : null;
        if (!head || head.id === 'ag-fav-head') return;
        var name = (head.textContent || '').trim(); if (!name) return;
        var closed = loadClosed(); var ix = closed.indexOf(name);
        if (ix === -1) closed.push(name); else closed.splice(ix, 1);
        saveClosed(closed); applyFilter();
    });

    // ---- počítadlo použití (řadí výsledky hledání; řádek „Nejčastější" ODEBRÁN na přání) ----
    function loadUsage() { try { var o = JSON.parse(localStorage.getItem(USE_KEY)); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    function tileToolKey(tile) {
        var dt = tile.getAttribute('data-tool'); if (dt) return dt;
        var ms = (tile.getAttribute('onclick') || '').match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;   // poslední volaná funkce = otevření nástroje
    }
    function tileToolLabel(tile) {
        var s = tile.querySelector('span');
        var d = document.createElement('div');
        d.innerHTML = ((s ? s.innerHTML : tile.innerHTML) || '').replace(/<br\s*\/?>/gi, ' ');   // <br> v názvu = mezera
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function bumpUsage(key) { try { var u = loadUsage(); u[key] = (u[key] || 0) + 1; localStorage.setItem(USE_KEY, JSON.stringify(u)); } catch (e) {} }
    document.addEventListener('click', function (e) {
        if (document.body.classList.contains('ag-tp-edit')) return;   // režim úprav oblíbených nepočítat
        var tile = e.target.closest ? e.target.closest('#tools-modal .tool-tile') : null;
        if (!tile || e.target.closest('.ag-tp-star') || e.target.closest('.ag-tp-help')) return;
        var k = tileToolKey(tile); if (k) bumpUsage(k);
    });
    // ---- veřejné API: registrace nástroje --------------------------------------
    window.agRegisterFieldTool = function (item) {
        if (!item || !item.id || typeof item.onClick !== 'function') return;
        // přepsat existující se stejným id (idempotentní při dvojím initu modulu)
        _items = _items.filter(function (x) { return x.id !== item.id; });
        _items.push({ id: item.id, label: item.label || item.id, icon: item.icon || '', onClick: item.onClick, order: item.order, cat: item.cat || TOOL_CATS[item.id] || '' });
        syncTiles();
    };
    // zpětná kompatibilita (dříve zavíralo plovoucí menu — teď není potřeba)
    window.agCloseFieldTools = function () {};
    // tools-plus/tools-simple po odebrání injektované dlaždice zavolají okamžité
    // doplnění zpět do kategorie (bez čekání na periodický tick → žádné probliknutí)
    window.agFtSyncTiles = function () { try { syncTiles(); } catch (e) {} };

    // ---- bezpečnostní udržování dlaždic (kdyby se mřížka objevila/přerenderovala) -
    function needsSync() {
        var grid = getGrid();
        if (!grid) return false;
        // porovnává se PODLE ID, ne počtem — přesun dlaždice jiným modulem není důvod k zásahu
        var cur = grid.querySelectorAll('.ag-ft-tile'), seen = {}, distinct = 0, i, id;
        for (i = 0; i < cur.length; i++) {
            id = cur[i].getAttribute('data-tool');
            if (!id || seen[id]) return true;      // duplikát / poškozená dlaždice → ukliď
            seen[id] = true; distinct++;
        }
        if (distinct !== _items.length) return true;
        for (i = 0; i < _items.length; i++) { if (!seen[_items[i].id]) return true; }
        return false;
    }
    var _wasOpen = false;
    function tick() {
        try {
            if (needsSync()) syncTiles();
            // (řádek „Nejčastější" odebrán; starý #ag-ft-freq z dřívější verze ukliď)
            var oldFreq = document.getElementById('ag-ft-freq'); if (oldFreq) oldFreq.remove();
            // Vyhledávání vyresetuj při zavření modalu, ať se příště otevře čisté.
            var m = document.getElementById('tools-modal');
            var open = !!(m && m.style.display !== 'none' && m.style.display !== '');
            var inp = document.getElementById('tools-search');
            if (_wasOpen && !open && inp && inp.value) { inp.value = ''; applyFilter(); }
            _wasOpen = open;
        } catch (e) {}
    }

    // Dronové zóny (DronView) BÝVALY položkou menu „Více". Je to ale informace k práci
    // v terénu (omezení vzdušného prostoru), ne nastavení aplikace — patří k nástrojům.
    // Vlastní modál nemá, jen otevře mapu ŘLP v prohlížeči; funkce openDronView žije
    // v grafika.js, tak se registruje odsud (vlastník mřížky) a jen na ni odkáže.
    function registerDronView() {
        if (typeof window.openDronView !== 'function') return;
        window.agRegisterFieldTool({
            id: 'dronview', label: 'Dronové zóny (DronView)',
            icon: '<svg class="icon"><use href="#i-drone"/></svg>',
            cat: 'Pomůcky', order: 66,
            onClick: function () { try { window.openDronView(); } catch (e) {} }
        });
    }

    function init() {
        try {
            syncTiles();
            registerDronView();
            if (!window.__agFtTimer) window.__agFtTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1500);
        } catch (e) { console.warn('[field-tools] init', e); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
