// ===== AR Geodet — NÁSTROJE PLUS: nápověda „?" + oblíbené nahoře (ODPOJITELNÁ) ====
// Neinvazivní vrstva ve stylu js/field-tools.js: NEEDITUJE logika.js ani grafika.js.
// Co dělá v modálu „Nástroje" (#tools-modal):
//   1) Každá dlaždice dostane badge „?" — klepnutí otevře krátký návod k nástroji
//      (co dělá, jak se používá). Texty jsou v TOOL_HELP níže.
//   2) „Oblíbené": tlačítkem ⭐ Upravit oblíbené se zapne režim úprav — hvězdičkou
//      na dlaždici si uživatel vybere nástroje, které se drží ÚPLNĚ NAHOŘE mřížky
//      (vlastní pořadí dle pořadí přidání). Uloženo v localStorage (per zařízení).
// Odstranění: smaž js/tools-plus.js + řádek <script> v index.html (a v sw.js).
// ==================================================================================
(function () {
    'use strict';

    var FAV_KEY = 'agToolFavs_v1';
    var STYLE_ID = 'ag-tp-style';

    // ---- nápovědy k nástrojům -----------------------------------------------------
    // klíč = data-tool (injektované moduly) NEBO název funkce z onclick (statické dlaždice)
    var TOOL_HELP = {
        'openMeasureModal': { t: 'Měření vzdálenosti', h: '<p>Spočítá vodorovnou délku, převýšení a šikmou délku mezi dvěma místy podle GPS.</p><ol><li>Postav se na první místo a klepni <b>Uložit moji aktuální pozici</b> u bodu A.</li><li>Přejdi na druhé místo a ulož bod B.</li><li>Výsledky se dopočítají hned. Přesnost odpovídá GPS telefonu (metry) — pro krátké délky použij pásmo.</li></ol>' },
        'startAreaMode': { t: 'Měření plochy', h: '<p>Plocha a obvod polygonu v rovině S-JTSK (Gaussova formule) — pro ČR přesný výpočet.</p><ol><li>Klepni do mapy pro přidání vrcholu, nebo obejdi pozemek a přidávej <b>Můj bod</b> (použije průměrovanou GPS).</li><li>Panel dole ukazuje živě plochu, obvod a počet vrcholů.</li><li><b>Vrátit</b> odebere poslední vrchol, <b>Ukončit</b> režim zavře.</li></ol>' },
        'openCheckDist': { t: 'Oměrné / kontrola', h: '<p>Kontrolní míry mezi uloženými body — porovnání s hodnotami z dokumentace (GP, náčrt).</p><ol><li>Vyber dvojice bodů, appka spočítá délky z S-JTSK souřadnic.</li><li>Zadej oměrnou z dokumentace — uvidíš rozdíl a jestli drží mezní odchylku.</li></ol>' },
        'openDmtVolume': { t: 'Kubatury / vrstevnice', h: '<p>Digitální model terénu z tvých bodů s výškou Z: vrstevnice a výpočet kubatur (výkop/násyp) vůči srovnávací rovině.</p><ol><li>Zaměř nebo naimportuj body s výškami.</li><li>Nástroj z nich vytvoří trojúhelníkovou síť (TIN).</li><li>Zadej srovnávací výšku — dostaneš objemy a plochu.</li></ol>' },
        'openStakeoutModal': { t: 'Vytyčovací checklist', h: '<p>Seznam bodů k vytyčení: postupné odškrtávání, navigace na bod a foto-dokumentace vytyčeného bodu.</p><ol><li>Vyber body do checklistu.</li><li>Klepnutím na bod se na něj navádíš (šipka v AR).</li><li>Po vytyčení bod odškrtni; lze přiložit fotku.</li></ol>' },
        'openTachymetrie': { t: 'Náčrt / Tachymetrie', h: '<p>Polní náčrt: kreslení situace (body, čáry, popisy) přes zaměřené body — náhrada papírového náčrtu.</p><ol><li>Otevři náčrt a přidávej prvky klepáním do plátna.</li><li>Body ze zakázky se do náčrtu propisují automaticky.</li><li>Náčrt jde exportovat (obrázek/PDF).</li></ol>' },
        'openKatastr': { t: 'Katastr (zde stojím)', h: '<p>Otevře katastrální mapu na tvé aktuální pozici ve zvoleném zdroji (Mapy.cz, iKatastr, Geoprohlížeč ČÚZK — nastavíš v Nastavení → Data).</p><p>Hodí se pro rychlé zjištění parcelního čísla a hranic tam, kde stojíš.</p>' },
        'openSatModal': { t: 'GNSS satelity', h: '<p>Přehled družic (GPS, Galileo, GLONASS, BeiDou) nad obzorem: kolik jich je, kde na obloze a jaká je geometrie.</p><p>Málo družic nízko nad obzorem = horší přesnost. Použij před přesnějším měřením — počkej si na lepší konstelaci.</p>' },
        'openDronView': { t: 'Dronové zóny (DronView)', h: '<p>Otevře oficiální mapu omezení letového provozu ŘLP ČR (DronView) — bezletové zóny, CTR letišť, omezené prostory.</p><p>Před letem s dronem na zakázce zkontroluj, jestli v místě smíš létat a v jaké výšce. Vyžaduje internet.</p>' },
        'openCalcModal': { t: 'Kalkulačka', h: '<p>Geodetické výpočty: směrník a délka ze souřadnic, rajón, protínání, převody úhlů (°/gon), redukce délek do S-JTSK a další.</p><p>Souřadnice zadávej v S-JTSK (kladné Y, X). Výsledky lze rovnou uložit jako bod.</p>' },
        'openDictModal': { t: 'Slovník', h: '<p>Geodetický slovník pojmů a zkratek (TB, ZhB, Bpv, ZPMZ, GP…). Hledej v poli nahoře; vlastní pojmy si můžeš přidat dole.</p>' },
        'agOpenCalibrate': { t: 'Srovnat sever', h: '<p>Kalibrace severu AR podle známého bodu: zacílíš na bod v terénu a appka dorovná otočení kompasu tak, aby AR sedělo.</p><ol><li>Vyber v mapě/AR bod, který v terénu bezpečně vidíš.</li><li>Namiř na něj střed obrazovky a potvrď.</li><li>Korekce severu se uloží (zrušíš ji v Kompasu).</li></ol>' },
        'ar-intersection': { t: 'Protínání vpřed', h: '<p>Určení neznámého bodu záměrami ze dvou (i více) známých stanovisek — čistě z úhlů, bez měření délky.</p><ol><li>Postav se na známý bod, zacíl na hledaný bod a ulož záměru.</li><li>Totéž z druhého známého bodu.</li><li>Appka protne směry (více záměr vyrovná MNČ) a bod uloží.</li></ol>' },
        'ar-resection': { t: 'AR resekce', h: '<p>Určení vlastní polohy a severu ze záměr na známé body (obdoba volného stanoviska) — pomáhá tam, kde GPS nestačí.</p><ol><li>Zacíl postupně na 2–3 známé body v terénu.</li><li>Appka dopočítá, kde stojíš, a srovná sever AR.</li></ol>' },
        'brutal-gps': { t: 'Brutální GPS', h: '<p>Vysoce přesné měření bodu jen s telefonem: dlouhé průměrování GPS s otočením telefonu o 180° v půlce (potlačí systematickou chybu antény).</p><ol><li>Polož telefon na bod a spusť měření.</li><li>V půlce času appka vyzve k otočení o 180°.</li><li>Výsledek ulož jako bod — u něj zůstane dosažená přesnost.</li></ol>' },
        'cadastre-vector': { t: 'Katastr — parcely', h: '<p>Vektorové hranice parcel z ČÚZK přímo v mapě a AR: čáry hranic, parcelní čísla, klepnutím detail parcely.</p><p>Vyžaduje internet při prvním načtení oblasti; načtené hranice drží v zakázce.</p>' },
        'geo-overlay': { t: 'Vlastní podklad', h: '<p>Podložení mapy vlastním obrázkem (situace, GP, starý plán): obrázek nakalibruješ na dva body a zobrazí se v mapě i AR.</p>' },
        'offset-point': { t: 'Offset bod', h: '<p>Vytvoření bodu odsazením od jiného bodu: zadáš směr (azimut/směrník) a vzdálenost — třeba roh budovy, na který není vidět z GPS.</p>' },
        'orient-point': { t: 'Srovnat podle bodu', h: '<p>Rychlé dorovnání severu AR: vybereš bod, namíříš na něj telefon a appka srovná kompas. Jednodušší varianta „Srovnat sever".</p>' },
        'parcela': { t: 'Parcela / dělení', h: '<p>Geometrie parcely v S-JTSK: výměra, obvod, směrníky stran — a dělení parcely (rovnoběžkou, z vrcholu, na N dílů stejné výměry).</p>' },
        'project-import': { t: 'Import projektu (DXF)', h: '<p>Načtení výkresu DXF nebo seznamu souřadnic do zakázky: body a čáry z projektu uvidíš v mapě i AR a můžeš je vytyčovat.</p>' },
        'rangefinder': { t: 'Optický dálkoměr', h: '<p>Odhad vzdálenosti k patě objektu z náklonu telefonu (znáš výšku očí). Orientační pomůcka na desítky metrů.</p><ol><li>Zadej výšku očí (výchozí 1,6 m).</li><li>Zamiř ryskou na patu objektu — vzdálenost se dopočítá z úhlu sklonu.</li></ol>' },
        'stakeout-line': { t: 'Vytyčení přímky', h: '<p>Navádění na přímku mezi dvěma body: appka ukazuje kolmou odchylku od přímky a staničení — třeba pro lavičky, ploty, výkopy.</p>' },
        'track-log': { t: 'Stopa trasy', h: '<p>Záznam prošlé trasy (GPS stopa) do mapy: obchůzka hranice, zaměření cesty. Stopu jde uložit a exportovat (GPX/KML).</p>' },
        'urovnani': { t: 'Urovnání stativu', h: '<p>Chytrá libela: telefon položený na stativu/přístroji ukáže, kterou nohou či šroubem a kam točit, aby byl přístroj v rovině.</p>' },
        'postupy': { t: 'Postupy měření', h: '<p>Tahák krok za krokem pro běžné metody: rajón, volné stanovisko, tachymetrie, polygonový pořad, technická nivelace, GNSS-RTK…</p><p>Vychází z oficiálních předpisů (Návod pro obnovu katastrálního operátu, katastrální vyhláška). U limitů je vždy uveden zdroj.</p>' },
        'zapisnik': { t: 'Zápisníky', h: '<p>Digitální zápisník místo papíru: <b>technická nivelace</b> (čtení zpět/vpřed → převýšení, výšky, uzávěr) a <b>vodorovné směry</b> — pro každý cíl skupiny s Hz v I./II. poloze (redukce + průměry), zenitové úhly v obou polohách (zprůměruje se) a šikmá či vodorovná délka (šikmá se zenitem se přepočte na vodorovnou a převýšení).</p><p>Výpočty běží průběžně (lze vypnout v hlavičce zápisníku). Data se ukládají per zakázka a jdou exportovat.</p>' },
        // nástroje přesunuté z menu „Více" do sekce Nástroje
        'predpisy': { t: 'Předpisy & odchylky', h: '<p>Offline tahák z katastrálních předpisů: mezní odchylky, kódy kvality, lhůty a paragrafy. Kurátorovaný obsah s uvedeným zdrojem, hledej fulltextem.</p>' },
        'ref-calibration': { t: 'Kalibrace na ref. bod', h: '<p>Oprava GPS podle známého bodu: postav se na bod se známými souřadnicemi a appka spočítá posun, který pak průběžně aplikuje na tvoji polohu.</p><p>Pomáhá, když GPS systematicky „táhne" stranou. Posun zrušíš opětovnou kalibrací.</p>' },
        'sky-obstruction': { t: 'Predikce signálu', h: '<p>Skyplot pro aktuální polohu a čas: posuvníkem nastavíš elevační masku (kolik oblohy zaclání domy, stromy, svah) a appka ukáže, kolik družic zbude nad maskou a jak dobrá bude geometrie (PDOP).</p><p>Hodí se pro plánování měření v zástavbě nebo u lesa.</p>' },
        'cadastre-area': { t: 'Stáhnout body z výřezu mapy', h: '<p>Hromadný import bodů bodových polí z ČÚZK: tahem po mapě vybereš obdélník a body v něm se nabídnou k přidání do zakázky.</p><p>Vyžaduje internet; stažené body pak fungují offline.</p>' },
        'hidden-points': { t: 'Skryté body', h: '<p>Přehled bodů skrytých tlačítkem „Skrýt tento bod z AR". Klepnutím na <b>Zobrazit</b> vrátíš jednotlivý bod, nebo obnovíš všechny najednou.</p><p>Skrytí platí do restartu appky — po novém spuštění jsou body zase viditelné.</p>' },
        'vrstvy': { t: 'Vrstvy / pokládka', h: '<p>Skladby vozovky per stavba/úsek: vrstvy shora dolů s tloušťkou a % nadvýšení na hutnění.</p><ol><li>Vyber, které vrstvě odpovídá <b>model v kontroleru</b> (horní plocha).</li><li>Vyber, kterou vrstvu <b>pokládáš</b>.</li><li>Appka sečte odsazení mezi vrstvami + nadvýšení na hutnění a ukáže hodnotu <b>do tabletu</b>.</li></ol><p>Výchozí % hutnění jsou orientační — uprav dle zhutňovací zkoušky.</p>' }
    };

    // ---- styly ---------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#tools-modal .tool-tile{position:relative;}',
            // badge je <i> (NE <span>!) — field-tools má pravidlo `#tools-modal .ag-ft-tile span{display:block}`,
            // které by span-badge u terénních nástrojů natvrdo zviditelnilo/roztáhlo
            'i.ag-tp-help{position:absolute;top:4px;right:4px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;',
            '  border-radius:50%;background:rgba(255,255,255,0.08);border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  color:var(--text-muted,#9aa1ac);font:700 12px/1 var(--font-ui,system-ui);font-style:normal;cursor:pointer;z-index:2;}',
            'i.ag-tp-help:active{background:var(--accent-soft,rgba(52,211,153,0.18));color:var(--accent,#34d399);}',
            '#tools-modal .tool-tile i.ag-tp-star{position:absolute;top:4px;left:4px;width:24px;height:24px;display:none !important;align-items:center;justify-content:center;',
            '  border-radius:50%;background:rgba(0,0,0,0.35);border:1px solid rgba(251,191,36,0.6);color:#fbbf24;font-size:14px;font-style:normal;cursor:pointer;z-index:2;}',
            'body.ag-tp-edit #tools-modal .tool-tile i.ag-tp-star{display:flex !important;}',
            'body.ag-tp-edit #tools-modal .tool-tile{outline:1px dashed var(--glass-border,rgba(255,255,255,0.2));}',
            '#tools-modal .tool-tile i.ag-tp-star.on{background:#fbbf24;color:#1a1205;}',
            '#ag-tp-editbtn{margin:2px 0 10px;width:100%;padding:9px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:transparent;color:var(--text-muted,#9aa1ac);font-size:12.5px;font-weight:600;cursor:pointer;}',
            'body.ag-tp-edit #ag-tp-editbtn{background:var(--accent-soft,rgba(52,211,153,0.15));color:var(--accent,#34d399);border-color:var(--accent-line,rgba(52,211,153,0.4));}',
            '#ag-fav-head{color:#fbbf24 !important;}',
            // modál nápovědy
            '#ag-tp-hm{position:fixed;inset:0;z-index:1000060;display:none;align-items:center;justify-content:center;background:rgba(4,8,12,0.6);}',
            '#ag-tp-hm.open{display:flex;}',
            '#ag-tp-hm .ag-tp-card{width:min(92vw,420px);max-height:80vh;overflow:auto;padding:20px;border-radius:18px;',
            '  background:var(--glass-bg,rgba(14,18,24,0.97));border:1px solid var(--glass-border-strong,rgba(255,255,255,0.16));color:var(--text-color,#eceef2);}',
            '#ag-tp-hm h3{margin:0 0 10px;color:var(--accent,#34d399);font-size:17px;}',
            '#ag-tp-hm p,#ag-tp-hm li{font-size:13.5px;line-height:1.55;}',
            '#ag-tp-hm ol{padding-left:20px;margin:8px 0;}',
            '#ag-tp-hm .ag-tp-close{width:100%;margin-top:12px;padding:11px;border:none;border-radius:12px;background:rgba(255,255,255,0.1);color:inherit;font-weight:600;cursor:pointer;}',
            'body.outdoor-mode #ag-tp-hm .ag-tp-card{background:#0a0e1a;border-color:rgba(255,255,255,0.85);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- pomocné --------------------------------------------------------------------
    function getGrid() { var m = document.getElementById('tools-modal'); return m ? m.querySelector('.tool-grid') : null; }
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool');
        if (dt) return dt;
        var oc = tile.getAttribute('onclick') || '';
        var m = oc.match(/(?:^|[;\s])(?:window\.)?(?:if\(window\.)?(ag[A-Za-z]+|open[A-Za-z]+|start[A-Za-z]+)\s*\(/);
        // preferuj známé klíče (první funkce v onclicku je zavření modálu)
        var known = Object.keys(TOOL_HELP);
        for (var i = 0; i < known.length; i++) { if (oc.indexOf(known[i]) !== -1) return known[i]; }
        return m ? m[1] : null;
    }
    function tileLabel(tile) { var s = tile.querySelector('span'); return s ? s.textContent.replace(/\s+/g, ' ').trim() : (tile.textContent || '').trim(); }
    function loadFavs() { try { var a = JSON.parse(localStorage.getItem(FAV_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function saveFavs(a) { try { localStorage.setItem(FAV_KEY, JSON.stringify(a)); } catch (e) {} }
    function findTile(key) {
        var grid = getGrid(); if (!grid) return null;
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) { if (tileKey(tiles[i]) === key) return tiles[i]; }
        return null;
    }

    // ---- modál nápovědy ---------------------------------------------------------------
    function ensureHelpModal() {
        var m = document.getElementById('ag-tp-hm');
        if (!m) {
            m = document.createElement('div'); m.id = 'ag-tp-hm';
            m.innerHTML = '<div class="ag-tp-card"><h3 id="ag-tp-hm-t"></h3><div id="ag-tp-hm-b"></div><button type="button" class="ag-tp-close">Zavřít</button></div>';
            m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('open'); });
            m.querySelector('.ag-tp-close').addEventListener('click', function () { m.classList.remove('open'); });
            document.body.appendChild(m);
        }
        return m;
    }
    function openHelp(key, label) {
        var m = ensureHelpModal();
        var rec = TOOL_HELP[key];
        document.getElementById('ag-tp-hm-t').textContent = rec ? rec.t : (label || 'Nástroj');
        document.getElementById('ag-tp-hm-b').innerHTML = rec ? rec.h : '<p>Návod pro tento nástroj zatím není. Nástroj otevři a zkus ho — nic se neuloží bez potvrzení.</p>';
        m.classList.add('open');
    }

    // ---- badge „?" a hvězdička na dlaždicích -----------------------------------------
    function decorateTiles() {
        var grid = getGrid(); if (!grid) return;
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) {
            (function (tile) {
                if (!tile.querySelector('.ag-tp-help')) {
                    var b = document.createElement('i');   // <i>, ne <span> — viz komentář u stylů
                    b.className = 'ag-tp-help'; b.textContent = '?';
                    b.setAttribute('role', 'button'); b.setAttribute('aria-label', 'Návod k nástroji');
                    b.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); openHelp(tileKey(tile), tileLabel(tile)); });
                    tile.appendChild(b);
                }
                if (!tile.querySelector('.ag-tp-star')) {
                    var s = document.createElement('i');
                    s.className = 'ag-tp-star'; s.textContent = '★';
                    s.setAttribute('role', 'button'); s.setAttribute('aria-label', 'Oblíbený nástroj');
                    s.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); toggleFav(tile); });
                    tile.appendChild(s);
                }
                var key = tileKey(tile);
                var star = tile.querySelector('.ag-tp-star');
                if (star) star.classList.toggle('on', key != null && loadFavs().indexOf(key) !== -1);
            })(tiles[i]);
        }
    }

    // v režimu úprav klepnutí na dlaždici NÁSTROJ NEOTEVÍRÁ (jen hvězdička/`?`)
    document.addEventListener('click', function (e) {
        if (!document.body.classList.contains('ag-tp-edit')) return;
        var tile = e.target.closest ? e.target.closest('#tools-modal .tool-tile') : null;
        if (!tile) return;
        if (e.target.closest('.ag-tp-star') || e.target.closest('.ag-tp-help')) return;
        e.stopPropagation(); e.preventDefault();
        toggleFav(tile);   // v režimu úprav = klepnutí kamkoli na dlaždici přepne oblíbenost
    }, true);

    // ---- oblíbené ---------------------------------------------------------------------
    function toggleFav(tile) {
        var key = tileKey(tile);
        if (!key) return;
        var favs = loadFavs();
        var idx = favs.indexOf(key);
        if (idx === -1) favs.push(key); else favs.splice(idx, 1);
        saveFavs(favs);
        if (idx !== -1) restoreTile(tile);   // odebráno z oblíbených -> vrátit na původní místo
        applyFavs(); decorateTiles();
    }
    function restoreTile(tile) {
        if (tile.classList.contains('ag-ft-tile')) {
            // injektovaná dlaždice: smazat, field-tools ji do ~1,5 s znovu vloží na správné místo
            tile.remove();
            return;
        }
        var ph = tile._agTpPh;
        if (ph && ph.isConnected) { ph.parentNode.insertBefore(tile, ph); ph.remove(); tile._agTpPh = null; }
    }
    function applyFavs() {
        var grid = getGrid(); if (!grid) return;
        var favs = loadFavs();
        var head = document.getElementById('ag-fav-head');
        // dohledej dlaždice; hlavičku Oblíbené drž jen když nějaká oblíbená existuje
        var found = [];
        favs.forEach(function (k) { var t = findTile(k); if (t) found.push(t); });
        if (!found.length) { if (head) head.remove(); return; }
        if (!head) {
            head = document.createElement('div');
            head.id = 'ag-fav-head'; head.className = 'tool-cat';
            head.textContent = '★ Oblíbené';
        }
        if (grid.firstChild !== head) grid.insertBefore(head, grid.firstChild);
        var anchor = head;
        found.forEach(function (tile) {
            // statické dlaždici při prvním přesunu nech na původním místě neviditelnou kotvu
            if (!tile.classList.contains('ag-ft-tile') && !tile._agTpPh) {
                var ph = document.createElement('span');
                ph.style.display = 'none'; ph.setAttribute('data-ag-ph', tileKey(tile) || '');
                tile.parentNode.insertBefore(ph, tile);
                tile._agTpPh = ph;
            }
            if (anchor.nextSibling !== tile) grid.insertBefore(tile, anchor.nextSibling);
            anchor = tile;
        });
    }

    // ---- tlačítko režimu úprav ---------------------------------------------------------
    function injectEditButton() {
        var m = document.getElementById('tools-modal'); if (!m) return;
        if (document.getElementById('ag-tp-editbtn')) return;
        // dovnitř .modal-body PŘED mřížku — vedle vyhledávání se překrýval s nadpisem „Měření"
        var body = m.querySelector('.modal-body'); if (!body) return;
        var btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'ag-tp-editbtn';
        btn.innerHTML = '★ Upravit oblíbené (nástroje nahoře)';
        btn.addEventListener('click', function () {
            var on = document.body.classList.toggle('ag-tp-edit');
            btn.innerHTML = on ? '✓ Hotovo — ukončit úpravy' : '★ Upravit oblíbené (nástroje nahoře)';
        });
        body.insertBefore(btn, body.firstChild);
    }
    // při zavření modálu režim úprav vypnout
    function watchModalClose() {
        var m = document.getElementById('tools-modal'); if (!m || m._agTpWatch) return;
        m._agTpWatch = true;
        new MutationObserver(function () {
            if (m.style.display === 'none' && document.body.classList.contains('ag-tp-edit')) {
                document.body.classList.remove('ag-tp-edit');
                var btn = document.getElementById('ag-tp-editbtn');
                if (btn) btn.innerHTML = '★ Upravit oblíbené (nástroje nahoře)';
            }
        }).observe(m, { attributes: true, attributeFilter: ['style'] });
    }

    // ---- údržba (dlaždice se přerenderovávají field-tools modulem) ---------------------
    function tick() {
        try { injectStyles(); injectEditButton(); watchModalClose(); decorateTiles(); applyFavs(); } catch (e) {}
    }
    function init() {
        tick();
        if (!window.__agTpTimer) window.__agTpTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1600);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });
})();
