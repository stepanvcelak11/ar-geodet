// ===== AR Geodet — NÁSTROJE JAKO SEZNAM ÚKONŮ (ODPOJITELNÁ vrstva) =============
// PROBLÉM: Nástroje měly 70 dlaždic v 6 kategoriích. Kategorie „Pomůcky" jich
// nesla 23 a byla to skládka (Kalkulačka, Docházka, Počasí, Předpisy, Kniha jízd…),
// dlaždice byly zatoulané (Kalibrace na ref. bod patří k AR, Rajón není kalibrace)
// a kategorie „Terénní nástroje" měla jedinou dlaždici. Hledat mezi ikonami
// v rukavicích na slunci je pomalé — geodet neví „která ikona", ví „co chci udělat".
//
// ŘEŠENÍ: JEDINÝ pohled — svislý seznam sloves: Změřit · Určit nový bod · Vytyčit ·
// Zaznamenat · Srovnat AR · Zjistit podmínky · Katastr a podklady · Před výjezdem ·
// Firma a papíry · Příručka a výpočty (+ záchytné „Další nástroje").
//
// PROČ UŽ NE DVA POHLEDY: dřív tu byl přepínač „Úkony / Vše" a mřížka byla druhý
// plnohodnotný pohled. Měřením v prohlížeči se ukázalo, že týž nástroj je v jednom
// pohledu na jedno klepnutí a ve druhém dvě (schovaný v rozcestníku) — a pod jiným
// názvem („Brutální GPS" × „Přesnou GPS", „AR resekce" × „Resekcí ze známých bodů").
// Naučená cesta v jednom pohledu tedy v druhém neplatila. Přepínač je odstraněn,
// mřížka zůstává v DOM jako klikací cíl a ukazuje se při HLEDÁNÍ.
//
// KLÍČOVÉ: seznam si NEVEDE vlastní nástroje. Každá položka jen KLIKNE na svou
// (schovanou) dlaždici v mřížce — takže dál platí všechno, co na mřížce staví
// ostatních devět modulů: ★ Oblíbené, ⚡ Teď se hodí, ◆ Pro tuto práci, počítadlo
// použití, návody (?), návrat do Nástrojů, oprávnění rolí. Co v mapě sloves není
// (nový modul, který přibude potom), spadne do sekce „Další nástroje" — nikdy
// nezmizí.
//
// PŘEHLEDNOST SEZNAMU (nic se z něj neubírá — úkony jsou celé): každá skupina je
// vlastní <section> se SLEPENOU hlavičkou (position:sticky). Při rolování tak pořád
// vidíš, ve kterém slovese jsi („Změřit", „Vytyčit", …), a hlavička další skupiny tu
// předchozí vystřídá až ve chvíli, kdy skupina opravdu končí. Vedle názvu je počet
// položek, mezi skupinami je mezera a linka — dlouhý seznam se tím dá projet očima
// po blocích místo jednoho nekonečného sloupce.
//
// SKUPINY JSOU SBALITELNÉ (nadpis = tlačítko, stav v agUkonyClosed_v1). Plochý seznam
// všech nástrojů je vysoký 4585 px v okně 640 px, tedy 7,2 obrazovky; se sbalenými
// papíry a příručkou 3725 px a se všemi sbalenými se vejde na jednu obrazovku.
// Nic se sbalením neschovává — je to jedno klepnutí a stav se pamatuje.
//
// Hledání se nepřepisuje: jakmile začneš psát, pohled se přepne na mřížku, kde
// běží chytré vyhledávání z field-tools.js (synonyma, překlepy, řazení). Po
// smazání dotazu se vrátí seznam úkonů.
//
// Odstranění: smaž js/nastroje-ukony.js + řádek <script> v index.html
// (a přegeneruj sw.js). Nástroje pak vypadají přesně jako dřív.
// ================================================================================
(function () {
    'use strict';
    if (window.AGUkony) return;

    var STYLE_ID = 'ag-uk-style', LIST_ID = 'ag-uk-list', SEG_ID = 'ag-uk-seg';
    var VIEW_KEY = 'agToolsView_v1';        // 'ukony' (výchozí) | 'vse'

    // ---- mapa sloves --------------------------------------------------------------
    // key = data-tool id injektované dlaždice NEBO název funkce ze statického onclicku
    // (shodné klíčování jako field-tools.js / tools-plus.js / tools-hub.js)
    var GROUPS = [
        {
            t: 'Změřit', items: [
                { k: 'openMeasureModal', l: 'Vzdálenost a převýšení mezi body' },
                { k: 'startAreaMode', l: 'Plochu a obvod pozemku' },
                { k: 'openCheckDist', l: 'Oměrné — kontrolní míry' },
                { k: 'openDmtVolume', l: 'Kubaturu a vrstevnice' },
                { k: 'vyska-objektu', l: 'Výšku objektu', h: 'budova, stožár, strom' },
                { k: 'korekce', l: 'S korekcí na teplotu a tlak', h: 'pásmo, dálkoměr' },
                { k: 'obchuzka', l: 'Kubaturu obejitím výkopu', h: 'obvod z GNSS + dno, objem hned na místě' }
            ]
        },
        {
            t: 'Určit nový bod', items: [
                { k: 'brutal-gps', l: 'Přesnou GPS', h: 'dlouhé průměrování s otočením' },
                { k: 'rajon', l: 'Rajónem', h: 'směr a délka ze stanoviska' },
                { k: 'offset-point', l: 'Offsetem', h: 'odsazení od jiného bodu' },
                { k: 'ar-intersection', l: 'Protínáním vpřed', h: 'jen úhly, délku měřit nemůžu' },
                { k: 'pdr-offset', l: 'Krokovým offsetem', h: 'došlápnutý vektor' },
                { k: 'ar-resection', l: 'Resekcí ze známých bodů', h: 'určí i sever' },
                { k: 'free-station', l: 'Volným stanoviskem', h: 'průvodce krok za krokem' },
                { k: 'dgps', l: 'Dvoutelefonní DGPS', h: 'základna a rover' },
                { k: 'hlas-kod', l: 'Hlasem — nadiktovat číslo a kód', h: 'bez ťukání v rukavicích' }
            ]
        },
        {
            t: 'Vytyčit', items: [
                { k: 'openStakeoutModal', l: 'Body podle seznamu', h: 'vytyčovací checklist' },
                { k: 'stakeout-line', l: 'Přímku' },
                { k: 'vrstvy', l: 'Vrstvu pokládky', h: 'výška a sklon za finišerem' },
                { k: 'indoor', l: 'Dojít k bodu uvnitř budovy', h: 'bez GPS; navádí, nevytyčuje' }
            ]
        },
        {
            t: 'Zaznamenat', items: [
                { k: 'openTachymetrie', l: 'Náčrt / tachymetrii' },
                { k: 'zapisnik', l: 'Zápisník', h: 'nivelace, směry' },
                { k: 'zavady', l: 'Závadu s fotkou' },
                { k: 'hlasovky', l: 'Hlasovou poznámku', h: 's georazítkem' },
                { k: 'denik-dne', l: 'Deník dne' },
                { k: 'track-log', l: 'Stopu trasy' },
                { k: 'geo-foto', l: 'Fotku s razítkem', h: 'S-JTSK, výška, čas a azimut ve fotce' },
                { k: 'epochy', l: 'Epochy — posuny v čase', h: 'opakované měření bodu' },
                { k: 'kos', l: 'Obnovit smazaný bod', h: 'koš — body i zakázky, 30 dní' }
            ]
        },
        {
            t: 'Srovnat AR', items: [
                { k: 'usadit-ar', l: 'Nevím čím začít — průvodce', h: 'značky nesedí na realitu' },
                // Kompas patří ke SLOVESU „srovnat sever": v jeho okně se kromě růžice
                // nastavuje uživatelská nula, korekce severu pro AR i mapu a jednotky
                // (° / gon). Bez téhle položky by spadl do záchytného „Další nástroje" —
                // a přesně to uživatel 9. 8. 2026 hlásil („někde je magnetický sever
                // a já nevím kde").
                { k: 'kompas', l: 'Podívat se na kompas', h: 'růžice se zeměpisným i magnetickým severem' },
                { k: 'agOpenCalibrate', l: 'Srovnat sever' },
                { k: 'ar-calib2', l: 'Srovnat na dva body' },
                { k: 'orient-point', l: 'Srovnat podle známého bodu' },
                { k: 'localization-helmert', l: 'Lokalizace (Helmert)', h: 'místní systém' },
                { k: 'ref-calibration', l: 'Kalibrace na referenční bod' },
                { k: 'fov-kalib', l: 'Změřit zorný úhel kamery' },
                { k: 'ar-visual-track', l: 'Vizuální stabilizace', h: 'beta' }
            ]
        },
        {
            t: 'Zjistit podmínky', items: [
                { k: 'gps-semafor', l: 'Dá se tady měřit?', h: 'skóre místa, odrazy od fasád' },
                { k: 'openSatModal', l: 'Družice teď', h: 'kolik jich vidím a jaká geometrie' },
                { k: 'sky-obstruction', l: 'Predikci signálu', h: 'maska překážek' },
                { k: 'gnss-forecast', l: 'Kdy bude nejlíp měřit', h: 'GNSS předpověď' },
                { k: 'pocasi', l: 'Počasí' },
                { k: 'slunce', l: 'Slunce a světlo', h: 'protisvětlo, soumrak' },
                { k: 'dronview', l: 'Dronové zóny', h: 'omezení vzdušného prostoru (ŘLP)' }
            ]
        },
        {
            t: 'Katastr a podklady', items: [
                { k: 'openKatastr', l: 'Katastr — kde právě stojím' },
                { k: 'cadastre-vector', l: 'Parcely do mapy a do AR' },
                { k: 'cadastre-area', l: 'Stáhnout body z výřezu mapy' },
                { k: 'parcela', l: 'Parcela — geometrie a dělení' },
                { k: 'project-import', l: 'Import projektu', h: 'DXF, situace' },
                { k: 'geo-overlay', l: 'Podložit plán do mapy', h: 'georeference obrázku' },
                { k: 'utility-networks', l: 'Podzemní sítě' },
                { k: 'job-transfer', l: 'Poslat nebo načíst zakázku' },
                { k: 'hidden-points', l: 'Skryté body' }
            ]
        },
        {
            t: 'Před výjezdem', items: [
                { k: 'brifink', l: 'Dnešek v terénu', h: 'souhrn na ráno' },
                { k: 'checklist', l: 'Co s sebou' },
                { k: 'bezpecnost', l: 'Bezpečnost a rizika' },
                { k: 'kde-je', l: 'Kde mám auto nebo bázi' }
            ]
        },
        {
            t: 'Firma a papíry', items: [
                { k: 'dochazka', l: 'Docházka' },
                { k: 'firma-chat', l: 'Firemní chat' },
                { k: 'vysilacka', l: 'Vysílačka', h: 'kde je kolega, rychlé zprávy, hlídání pádu' },
                { k: 'ucty-firma', l: 'Firma a účty' },
                { k: 'kniha-jizd', l: 'Kniha jízd' },
                { k: 'moje-aktivita', l: 'Moje aktivita', h: 'kolik jsem ušel, co používám, co schovat' }
            ]
        },
        {
            t: 'Příručka a výpočty', items: [
                { k: 'predpisy', l: 'Předpisy a odchylky' },
                { k: 'postupy', l: 'Postupy měření' },
                { k: 'openDictModal', l: 'Slovník pojmů' },
                { k: 'openCalcModal', l: 'Kalkulačka' }
            ]
        }
    ];
    // Rozcestníky z tools-hub.js: v seznamu sloves jsou jejich položky rovnou,
    // takže samotné rozcestníky by byly jen mezikrok navíc. Kdyby tu nebyly, spadly
    // by do sekce „Další nástroje" a uživatel by měl stejnou věc v seznamu dvakrát.
    var SKIP = {
        'bod-vypoctem': 1, 'gnss-signal': 1, 'prirucka': 1,
        'pocasi-svetlo': 1, 'auto-bezpeci': 1
    };

    var KNOWN = {};
    GROUPS.forEach(function (g) { g.items.forEach(function (it) { KNOWN[it.k] = 1; }); });

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function modal() { return document.getElementById('tools-modal'); }
    function grid() { var m = modal(); return m ? m.querySelector('.tool-grid') : null; }
    function body() { var m = modal(); return m ? m.querySelector('.modal-body') : null; }
    function searchVal() { var i = document.getElementById('tools-search'); return i ? (i.value || '').trim() : ''; }

    // Pohled je JEDEN — seznam úkonů. Mřížka zůstává v DOM (klikací cíl pro run(),
    // a hlavně ji ukazuje HLEDÁNÍ, kde běží chytré vyhledávání z field-tools.js),
    // ale jako druhý plnohodnotný pohled se už nenabízí: týž nástroj v ní byl jinak
    // hluboko a pod jiným názvem než v seznamu, takže naučená cesta v jednom pohledu
    // v druhém neplatila. Klíč agToolsView_v1 se dál čte kvůli starým instalacím,
    // ale 'vse' už z něj nemůže vyjít.
    function view() { return 'ukony'; }

    // klíč dlaždice — stejná logika jako v ostatních modulech mřížky
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool');
        if (dt) return dt;
        var ms = (tile.getAttribute('onclick') || '').match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function tileLabel(tile) {
        var s = tile.querySelector('span');
        var d = document.createElement('div');
        d.innerHTML = ((s ? s.innerHTML : tile.innerHTML) || '').replace(/<br\s*\/?>/gi, ' ');
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function findTile(key) {
        var g = grid(); if (!g) return null;
        var tiles = g.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) {
            if (tileKey(tiles[i]) !== key) continue;
            // Oprávnění podle role se v appce VYMÁHAJÍ SKRYTÍM dlaždice (ucty.js
            // applyPerms nastaví display:none + data-agucty). Seznam úkonů hledá
            // dlaždice v DOM, takže bez téhle podmínky by zaměstnanci ukázal
            // a přes t.click() i spustil nástroj, na který nemá právo.
            // Záměrně se testuje JEN data-agucty: dlaždice skryté zjednodušením
            // Nástrojů (usadit-ar, tools-simple) mají v seznamu zůstat.
            if (tiles[i].hasAttribute('data-agucty')) return null;
            // Nástroje, které si uživatel sám schoval v „Moje aktivita" (js/moje-aktivita.js,
            // atribut data-ag-hidden), nemá cenu držet ani v seznamu úkonů — jinak by
            // schování zdánlivě nic nedělalo. Najít je pořád jde hledáním v mřížce.
            if (tiles[i].hasAttribute('data-ag-hidden')) return null;
            return tiles[i];
        }
        return null;
    }
    // Spuštění = klik na původní dlaždici. Tím se započítá použití, zafunguje
    // návrat do Nástrojů i skrytí dlaždic podle role — nic se neobchází.
    function run(key) {
        var t = findTile(key);
        if (t) { t.click(); return true; }
        return false;
    }

    // ---- styly ----------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // seznam úkonů
            '#' + LIST_ID + '{display:none;}',
            'body.ag-uk-on #' + LIST_ID + '{display:block;}',
            'body.ag-uk-on #tools-modal .tool-grid{display:none !important;}',
            // skupina = vlastní blok; sticky hlavička se drží jen po dobu SVÉ skupiny
            '.ag-uk-g{margin:0 0 14px;}',
            '.ag-uk-g:last-child{margin-bottom:6px;}',
            '.ag-uk-h{position:sticky;top:0;z-index:3;display:flex;align-items:baseline;gap:8px;',
            '  margin:0 0 7px;padding:9px 2px 7px;',
            '  background:var(--modal-bg,rgba(14,18,24,0.97));',
            '  border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  font:700 11px/1 var(--font-display,system-ui),sans-serif;',
            '  letter-spacing:.09em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.ag-uk-h .ag-uk-n{margin-left:auto;font-weight:600;font-size:calc(10.5px * var(--ag-font-scale, 1));',
            '  letter-spacing:.02em;color:var(--text-faint,#7b828c);}',
            // venkovní režim má modály neprůhledné — hlavička musí mít stejné pozadí,
            // jinak by pod ní při rolování prosvítal text položek
            'body.outdoor-mode .ag-uk-h{background:#0a0e1a;}',
            'body.light-mode.outdoor-mode .ag-uk-h{background:#fff;}',
            '.ag-uk-i{display:flex;align-items:center;gap:11px;width:100%;box-sizing:border-box;',
            '  margin:0 0 6px;padding:12px 13px;border-radius:12px;text-align:left;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.10));',
            '  background:var(--surface-1,rgba(255,255,255,0.045));color:inherit;',
            '  font:inherit;-webkit-tap-highlight-color:transparent;}',
            '.ag-uk-i:active{background:var(--accent-soft,rgba(47,158,116,0.15));',
            '  border-color:var(--accent-line,rgba(47,158,116,0.4));}',
            '.ag-uk-i:focus-visible{outline:2px solid var(--accent,#2f9e74);outline-offset:2px;}',
            '.ag-uk-ico{flex:0 0 auto;width:22px;height:22px;color:var(--accent,#2f9e74);}',
            '.ag-uk-ico svg{width:22px;height:22px;}',
            '.ag-uk-tx{flex:1 1 auto;min-width:0;}',
            '.ag-uk-tx b{display:block;font-size:calc(14.5px * var(--ag-font-scale, 1));font-weight:600;line-height:1.3;}',
            '.ag-uk-tx small{display:block;margin-top:2px;font-size:calc(12px * var(--ag-font-scale, 1));line-height:1.35;',
            '  color:var(--text-muted,#9aa1ac);}',
            // blok „Teď" nahoře — jeden vstup místo tří rozesetých
            '.ag-uk-now{margin:0 0 14px;padding:11px 13px;border-radius:12px;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.38));',
            '  background:var(--accent-soft,rgba(47,158,116,0.13));}',
            '.ag-uk-now .ag-uk-i{background:transparent;border:0;margin:0;padding:6px 0;}',
            '.ag-uk-now .ag-uk-i + .ag-uk-i{border-top:1px solid var(--glass-border,rgba(255,255,255,0.10));}',
            // sbalitelná skupina: šipka ukazuje stav, zavřená skryje své položky
            // nadpis je <button> — prohlížeč by mu jinak nakreslil vlastní rám a šířku.
            // border se musí přepsat CELÝ a spodní linka vrátit, jinak ji zruší reset.
            '.ag-uk-h{width:100%;-webkit-appearance:none;appearance:none;text-align:left;cursor:pointer;',
            '  border:0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  -webkit-user-select:none;user-select:none;}',
            '.ag-uk-h::after{content:"▾";margin-left:8px;font-size:calc(11px * var(--ag-font-scale, 1));',
            '  color:var(--text-muted,#9aa1ac);}',
            '.ag-uk-closed > .ag-uk-h::after{content:"▸";}',
            '.ag-uk-closed > .ag-uk-i{display:none;}',
            '.ag-uk-h:focus-visible{outline:2px solid var(--accent,#2f9e74);outline-offset:2px;}',
            // patička seznamu — co se dělá zřídka (průvodce, úprava oblíbených).
            // Odsazená linkou, ať je vidět, že tady seznam nástrojů končí.
            '.ag-uk-foot{margin:18px 0 0;padding-top:12px;',
            '  border-top:1px solid var(--glass-border,rgba(255,255,255,0.10));}',
            '.ag-uk-foot .ag-uk-i{background:transparent;}',
            // tlačítko oblíbených si vyrábí tools-plus.js; v patičce ho zesvětlíme,
            // ať nepřebíjí vlastní nástroje nad sebou
            '.ag-uk-foot #ag-tp-editbtn{width:100%;margin:8px 0 0;}',
            'body.ag-glove .ag-uk-i{padding:15px 14px;}',
            'body.ag-glove .ag-uk-tx b{font-size:calc(15.5px * var(--ag-font-scale, 1));}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- přepínač pohledu ------------------------------------------------------------
    // Přepínač „Úkony / Vše" byl TADY. Odstraněn: dva pohledy na týž obsah znamenaly
    // dvě různé cesty i dvě různá jména pro jeden nástroj. Kdyby se měl někdy vrátit,
    // je celý v historii tohohle souboru (funkce ensureSeg + syncSeg).
    // Zbytek po něm uklidíme, kdyby v DOM zůstal ze starší verze appky:
    function dropSeg() {
        var seg = document.getElementById(SEG_ID);
        if (seg && seg.parentNode) seg.parentNode.removeChild(seg);
    }

    // ---- „Teď" — Pokračovat + Průvodce na jednom místě --------------------------------
    function lastTool() {
        var r; try { r = JSON.parse(localStorage.getItem('agLastTool_v1')); } catch (e) { return null; }
        if (!r || !r.key || !r.ts) return null;
        if (Date.now() - r.ts > 48 * 3600 * 1000) return null;
        return findTile(r.key) ? r : null;
    }
    // NAHOŘE zůstává jen „Pokračovat" — to není organizátor, ale zkratka na jeden
    // konkrétní nástroj, který jsi měl v ruce naposledy. V terénu je to nejčastější
    // další klik, takže si první řádek zaslouží.
    function nowBlock() {
        var rec = lastTool();
        if (!rec) return null;
        var box = document.createElement('div');
        box.className = 'ag-uk-now';
        box.appendChild(item({ l: 'Pokračovat: ' + rec.label, h: 'naposledy použitý nástroj' }, function () { run(rec.key); }));
        return box;
    }

    // DOLE naopak to, co se dělá zřídka a nemá stát v cestě k nástrojům: průvodce
    // („Poradit, co použít" — je i v menu Více jako „Průvodce úkolem") a přepnutí do
    // režimu úprav oblíbených. Tlačítko oblíbených si staví tools-plus.js a vkládá ho
    // na začátek .modal-body; tady ho jen PŘESTĚHUJEME (nevyrábíme druhé), takže jeho
    // vlastní logika i text „✓ Hotovo" fungují dál.
    function footBlock() {
        var box = document.createElement('div');
        box.className = 'ag-uk-foot';
        if (typeof window.openPruvodce === 'function') {
            box.appendChild(item({ l: 'Poradit, co použít', h: 'průvodce úkolem' }, function () {
                var m = modal(); if (m) m.style.display = 'none';
                try { window.openPruvodce(); } catch (e) {}
            }));
        }
        return box;
    }
    // Přesun tlačítka oblíbených do patičky seznamu. Idempotentní — když už tam je,
    // nic nedělá, takže to smí volat periodický sync().
    function adoptFavBtn() {
        var btn = document.getElementById('ag-tp-editbtn');
        var host = document.getElementById(LIST_ID);
        if (!btn || !host) return;
        var foot = host.querySelector('.ag-uk-foot');
        if (!foot || btn.parentNode === foot) return;
        foot.appendChild(btn);
    }

    // ---- položka seznamu -----------------------------------------------------------------
    function item(def, onClick, iconHtml) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ag-uk-i';
        b.innerHTML = (iconHtml ? '<span class="ag-uk-ico">' + iconHtml + '</span>' : '')
            + '<span class="ag-uk-tx"><b>' + esc(def.l) + '</b>'
            + (def.h ? '<small>' + esc(def.h) + '</small>' : '') + '</span>';
        b.addEventListener('click', onClick);
        return b;
    }

    // ---- sestavení seznamu ------------------------------------------------------------------
    // Přestavuje se jen když se změní složení mřížky (dlaždice přibývají postupně,
    // jak se moduly registrují) — jinak by seznam problikával při každém tiku.
    // ---- sbalené skupiny --------------------------------------------------------------
    // Vlastní klíč, NE agToolCatsClosed_v1 z field-tools.js: ten drží názvy kategorií
    // MŘÍŽKY („Měření“, „Pomůcky“), tady jsou názvy sloves („Změřit“, „Vytyčit“).
    // Jeden klíč pro dvě různá názvosloví by se pletl, jakmile by se některý název
    // shodl. VÝCHOZÍ STAV: zavřené jsou skupiny, které se v terénu neotvírají každý
    // den — papíry a příručka. Nic se tím neschovává, jen to nestojí v cestě
    // k měřickým nástrojům; jedno klepnutí a je to zpátky (a stav se pamatuje).
    var CLOSED_KEY = 'agUkonyClosed_v1';
    var CLOSED_DEFAULT = ['Před výjezdem', 'Firma a papíry', 'Příručka a výpočty', 'Další nástroje'];
    function loadClosed() {
        try {
            var raw = localStorage.getItem(CLOSED_KEY);
            if (raw == null) return CLOSED_DEFAULT.slice();
            var a = JSON.parse(raw);
            return Array.isArray(a) ? a : [];
        } catch (e) { return []; }
    }
    function isClosed(title) { return loadClosed().indexOf(title) !== -1; }
    function setClosed(title, closed) {
        var a = loadClosed(), ix = a.indexOf(title);
        if (closed && ix === -1) a.push(title);
        else if (!closed && ix !== -1) a.splice(ix, 1);
        try { localStorage.setItem(CLOSED_KEY, JSON.stringify(a)); } catch (e) {}
    }

    function favKeys() {
        try { var a = JSON.parse(localStorage.getItem('agToolFavs_v1')); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    // tools-simple.js značí dlaždice zvoleného typu práce atributem data-ag-ts
    function profileKeys() {
        var g = grid(); if (!g) return [];
        var t = g.querySelectorAll('.tool-tile[data-ag-ts="1"]'), out = [];
        for (var i = 0; i < t.length; i++) { var k = tileKey(t[i]); if (k) out.push(k); }
        return out;
    }
    // Typ práce se dá nastavit na dvou místech (select v Nástrojích i karta na
    // úvodu z rezim-prace.js). Ptáme se proto přednostně tools-simple.js, který
    // je pro obě místa jediným zdrojem pravdy; select je jen záloha.
    function profileLabel() {
        try {
            if (window.AGToolsSimple && AGToolsSimple.profiles) {
                var pid = localStorage.getItem('arActiveProjectId') || 'default';
                var id = localStorage.getItem('agWorkProfile::' + pid);
                if (!id || id === 'univerzal') return '';
                var p = AGToolsSimple.profiles[id];
                if (p && p.label) return p.label;
            }
        } catch (e) {}
        var s = document.getElementById('ag-ts-profsel');
        if (!s || !s.options || s.selectedIndex < 0) return '';
        var v = s.options[s.selectedIndex];
        return (v && v.value !== 'univerzal') ? v.text : '';
    }
    function gridSig() {
        var g = grid(); if (!g) return '';
        var tiles = g.querySelectorAll('.tool-tile'), out = [];
        for (var i = 0; i < tiles.length; i++) { var k = tileKey(tiles[i]); if (k) out.push(k); }
        out.sort();
        // do otisku patří i personalizace — po změně oblíbených nebo typu práce
        // se seznam musí přestavět, jinak by volba nahoře zdánlivě nic nedělala
        return out.join(',') + '|f:' + favKeys().join(',') + '|p:' + profileKeys().join(',');
    }
    function iconOf(key) {
        var t = findTile(key); if (!t) return '';
        var svg = t.querySelector('svg');
        return svg ? svg.outerHTML : '';
    }
    function build() {
        var g = grid(); if (!g) return;
        var host = document.getElementById(LIST_ID);
        if (!host) {
            host = document.createElement('div');
            host.id = LIST_ID;
            g.parentNode.insertBefore(host, g);
        }
        host.innerHTML = '';

        var nb = nowBlock();
        if (nb) host.appendChild(nb);

        // Každá skupina je samostatná sekce — jen díky tomu se sticky hlavička
        // odlepí, jakmile skupina skončí (sticky se drží uvnitř svého rodiče).
        function section(title, count) {
            var sec = document.createElement('section');
            sec.className = 'ag-uk-g';
            if (isClosed(title)) sec.classList.add('ag-uk-closed');
            // Nadpis je TLAČÍTKO — sbalitelné skupiny jsou v Nástrojích už zavedené
            // (mřížka je tak má z field-tools.js), takže seznam se chová stejně.
            var h = document.createElement('button');
            h.type = 'button';
            h.className = 'ag-uk-h';
            h.setAttribute('aria-expanded', String(!isClosed(title)));
            h.innerHTML = '<span>' + esc(title) + '</span><span class="ag-uk-n">' + count + '</span>';
            h.addEventListener('click', function () {
                var nowClosed = !sec.classList.contains('ag-uk-closed');
                sec.classList.toggle('ag-uk-closed', nowClosed);
                h.setAttribute('aria-expanded', String(!nowClosed));
                setClosed(title, nowClosed);
            });
            sec.appendChild(h);
            host.appendChild(sec);
            return sec;
        }

        // Personalizace z mřížky se do seznamu propíše — ★ Oblíbené i ◆ typ práce
        // (jinak by volba „Typ práce" nad seznamem zdánlivě nic nedělala).
        function shortcutGroup(title, keys) {
            var live = keys.filter(function (k) { return !SKIP[k] && findTile(k); });
            if (!live.length) return;
            var sec = section(title, live.length);
            live.forEach(function (k) {
                var t = findTile(k);
                sec.appendChild(item({ l: tileLabel(t) }, (function (kk) { return function () { run(kk); }; })(k), iconOf(k)));
            });
        }
        shortcutGroup('★ Oblíbené', favKeys());
        var pl = profileLabel();
        if (pl) shortcutGroup('◆ Pro tuto práci · ' + pl, profileKeys());

        var used = {};
        GROUPS.forEach(function (grp) {
            var live = grp.items.filter(function (it) { return !!findTile(it.k); });
            if (!live.length) return;                       // celá skupina chybí (role/odpojený modul)
            var sec = section(grp.t, live.length);
            live.forEach(function (it) {
                used[it.k] = 1;
                sec.appendChild(item(it, function () { run(it.k); }, iconOf(it.k)));
            });
        });

        // POJISTKA: co v mapě sloves není (nový modul, který přibude potom), se
        // ukáže tady — nikdy nezmizí jen proto, že jsem ho nezařadil.
        var rest = [];
        var tiles = g.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) {
            var k = tileKey(tiles[i]);
            if (!k || used[k] || KNOWN[k] || SKIP[k]) continue;
            // Stejná dvě skrytí jako ve findTile(): tahle smyčka sahá na dlaždice
            // přímo, takže si je musí ohlídat sama. Bez toho by pojistka ukázala
            // (a přes run() i spustila) nástroj zakázaný rolí nebo ten, který si
            // uživatel schoval v „Moje aktivita".
            if (tiles[i].hasAttribute('data-agucty')) continue;
            if (tiles[i].hasAttribute('data-ag-hidden')) continue;
            if (tiles[i].id === 'ag-sm-allbtn') continue;
            rest.push({ k: k, l: tileLabel(tiles[i]) });
        }
        if (rest.length) {
            var rsec = section('Další nástroje', rest.length);
            rest.forEach(function (r) {
                rsec.appendChild(item({ l: r.l }, function () { run(r.k); }, iconOf(r.k)));
            });
        }
        host.appendChild(footBlock());
        adoptFavBtn();
        host.setAttribute('data-sig', gridSig());
    }

    // ---- hlavní sync -------------------------------------------------------------------------
    function sync() {
        injectStyles();
        if (!grid()) return;
        dropSeg();

        // Při psaní jde slovo mřížce — tam běží chytré hledání se synonymy,
        // překlepy a řazením z field-tools.js. Psát ho znovu by bylo horší.
        var q = searchVal();
        var active = q ? 'vse' : view();

        var host = document.getElementById(LIST_ID);
        if (active === 'ukony' && (!host || host.getAttribute('data-sig') !== gridSig())) build();

        document.body.classList.toggle('ag-uk-on', active === 'ukony');
        // tools-plus.js si tlačítko oblíbených vkládá zpátky na začátek .modal-body,
        // kdykoli ho tam nenajde — tak ho po každém ticku vrátíme do patičky seznamu.
        if (active === 'ukony') adoptFavBtn();
    }

    function init() {
        try { sync(); } catch (e) { console.warn('[nastroje-ukony] init', e); }
        if (!window.__agUkTimer) {
            window.__agUkTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () {
                try { sync(); } catch (e) {}
            }, 1400);
        }
        document.addEventListener('input', function (e) {
            if (e.target && e.target.id === 'tools-search') { try { sync(); } catch (er) {} }
        }, true);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 500); });

    // setView() zrušen spolu s přepínačem pohledů — pohled je jeden. Necháváme ho
    // v API jako no-op, aby starší volání odjinud nespadlo na „not a function".
    // groups/run/has vystrkuje ven kvůli js/kolecko-nastroju.js: kolečko musí
    // vybírat ze STEJNÉ mapy sloves a spouštět nástroje STEJNOU cestou (klik na
    // původní dlaždici), jinak by se rozešly a obcházela by se oprávnění.
    window.AGUkony = {
        rebuild: build,
        setView: function () { sync(); },
        groups: GROUPS,
        run: run,
        has: function (k) { return !!findTile(k); }
    };
})();
