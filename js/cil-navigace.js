// ===== QTRIG — CÍL NAVIGACE: v mapě a na hraně displeje (ODPOJITELNÁ vrstva) =====
// Řeší dvě díry v dohledávání bodu:
//   ③ Cíl (highlightedPointId) vypadal v mapě úplně stejně jako každý jiný bod a
//     nevedla k němu žádná čára — po odzoomování se ztratil. Teď má zlatou pulzující
//     aureolu, čárkovanou spojnici ode mě k němu, popisek se vzdáleností a azimutem
//     a dlaždici „Ukázat cíl" (vejde do mapy mě i cíl).
//   ④ NAVÁDĚNÍ JE KOMPASOVÁ PÁSKA (od 9. 9. 2026 nahradila pilulku na hraně).
//     Vodorovná stužka se světovými stranami a ryskami po 15°; na ní zlatá ryska
//     cíle, uprostřed pevný hrot = kam se dívám. Prostřední pás ukazuje, co je
//     zrovna v obraze kamery, takže je poznat rozdíl mezi „cíl je těsně vedle
//     záběru" a „cíl je úplně jinde". Když odchylka přeroste půlku okna (±60°),
//     ryska se přilepí ke kraji a změní se v šipku s počtem stupňů; nad 135° je
//     cíl za zády a šipka se změní na otočku.
//     ⚠ VE SPLITU JE PÁSKA SAMOTNÝM DĚLIČEM (#resizer) — nezabírá tedy ani pixel
//       navíc (dělič se roztáhne z 16 na 24 px, přesně jako dřív s pásem
//       blízkosti, a jen dokud je cíl nastavený). Tažení funguje dál: páska
//       nebere klepnutí a chytací plocha #resizer::after zůstává.
//     ⚠ VZDÁLENOST NA PÁSCE NENÍ — páska odpovídá na „kam". Číslo je v HUD nad
//       kamerou a v mapě u čáry ke cíli. Pás blízkosti, který vzdálenost do
//       děliče kreslil, byl 10. 9. 2026 na přání uživatele zrušen
//       (js/pas-blizkosti.js smazán); tím se `#ar-hud-dist` vrátil do hry.
//
// ZÁMĚRNĚ nesahá do grafika.js/logika.js/style.css: jen obalí updateNavGlow()
// (volá se každý snímek z renderAR, viz grafika.js) a styly + prvky si vyrobí sám.
// Načítat AŽ PO grafika.js — čte jeho globály (highlightedPointId, map, arPoints,
// userLat/userLng, currentHeading, mapRotation, viewMode, getDistance/getBearing).
// ODSTRANĚNÍ: smaž js/cil-navigace.js + jeho <script> v index.html a spusť
//             python scripts/gen_sw_assets.py --bump
//
// VÝKON: updateNavGlow běží 60×/s, takže tady se každý snímek jen POROVNÁVÁ:
//   • mapa se překresluje, až když se posunu (>0,3 m), změní se cíl nebo režim,
//   • pilulka na hraně zapisuje do DOM jen při změně strany nebo celého stupně,
//   • cíl se v arPoints hledá jen při změně id (arPoints jich může být tisíce).
// =====================================================================================
(function () {
    'use strict';
    if (window.AGCilNav) return;

    var GOLD = '#fbbf24';
    var navGroup = null;
    var _pt = null, _ptId = null, _ptN = -1;            // cache dohledaného cíle
    var _mLat = null, _mLng = null, _mTLat = null, _mTLng = null, _mId = null, _mView = null;
    // (proměnné po pilulce na hraně zmizely s ní — 9. 9. 2026, viz páska níž)
    var _tile = null, _tileOn = null, _holdT = null;

    // ---- čtení globálů z grafika.js / logika.js (jsou ve vnějším scope) ---------------
    // typeof-testy kvůli tomu, že modul má fungovat i když se některý soubor nenačte
    function gMap() { return (typeof map !== 'undefined') ? map : null; }
    function gPts() { return (typeof arPoints !== 'undefined') ? arPoints : null; }
    function gLat() { return (typeof userLat !== 'undefined') ? userLat : null; }
    function gLng() { return (typeof userLng !== 'undefined') ? userLng : null; }
    function view() { return (typeof viewMode === 'string') ? viewMode : 'both'; }
    function started() { return (typeof appStarted !== 'undefined') && appStarted === true; }
    function hasGeo() { return (typeof getDistance === 'function' && typeof getBearing === 'function'); }

    // Cíl navigace. arPoints bývá i pár tisíc bodů, takže hledáme jen když se id
    // (nebo obsah pole) opravdu změnilo — ne 60×/s.
    function target() {
        var id = (typeof highlightedPointId !== 'undefined') ? highlightedPointId : null;
        var arr = gPts();
        if (id == null || !arr) { _pt = null; _ptId = null; return null; }
        if (_pt && _ptId === id && _ptN === arr.length) return _pt;
        _pt = null;
        for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) { _pt = arr[i]; break; } }
        _ptId = id; _ptN = arr.length;
        return _pt;
    }

    // ---- formátování (stejné konvence jako zbytek appky) ------------------------------
    function fmtD(m) {
        if (m >= 1000) return (m / 1000).toFixed(2).replace('.', ',') + ' km';
        if (m >= 100) return Math.round(m) + ' m';
        return m.toFixed(1).replace('.', ',') + ' m';
    }
    // ⚠ fmtAz() (azimut ve stupních/gonech) odsud 8. 9. 2026 ZMIZEL i s jediným
    //   svým voláním — popisek v mapě ukazuje už jen vzdálenost. Kdyby se stupně
    //   měly vrátit, je vzor v HUD (grafika.js) a v js/kompas-*.js.
    // ---- styly (vlastní, ať se dá modul vyhodit jedním smazáním) ----------------------
    function ensureStyle() {
        if (document.getElementById('ag-cil-style')) return;
        var s = document.createElement('style'); s.id = 'ag-cil-style';
        s.textContent = [
            /* aureola cíle v mapě — animuje se JEN opacity (kompozitor), ne box-shadow:
               nad mapou i kamerou by překreslování stínu 60×/s jelo na hlavním vlákně */
            '.ag-cil-halo{position:absolute;left:0;top:0;pointer-events:none;}',
            '.ag-cil-halo i{position:absolute;left:0;top:0;display:block;border-radius:50%;',
            '  transform:translate(-50%,-50%);border:2px solid ' + GOLD + ';}',
            '.ag-cil-halo i.r1{width:46px;height:46px;animation:ag-cil-pulse 1.8s infinite ease-in-out;}',
            '.ag-cil-halo i.r2{width:26px;height:26px;border-width:3px;background:rgba(251,191,36,0.18);}',
            '@keyframes ag-cil-pulse{0%,100%{opacity:0.25;}50%{opacity:0.95;}}',
            '@media (prefers-reduced-motion: reduce){.ag-cil-halo i.r1{animation:none;opacity:0.7;}}',
            /* popisek na spojnici — třídu map-label-text srovnává proti otočení mapy
               stejná smyčka, která srovnává popisky bodů (grafika.js) */
            // ⚠ Obrys MUSÍ zůstat ČERNÝ i ve světlém režimu. Třída map-label-text tam
            // dostává BÍLÝ obrys (aby byl tmavý popisek bodu čitelný nad světlou OSM),
            // jenže tenhle popisek je zlatý — zlatá na bílém obrysu nad světlou mapou
            // se ztrácí (naměřeno 1,23:1). Zlatá s černým obrysem je čitelná v obou
            // motivech. !important kvůli specificitě `body.light-mode #map.base-osm`.
            '.ag-cil-lbl{color:' + GOLD + ' !important;font-weight:700 !important;white-space:nowrap;',
            '  text-shadow:-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000 !important;}',
            /* ④ KOMPASOVÁ PÁSKA (na přání 9. 9. 2026 nahradila pilulku na hraně).
               Vodorovná stužka jako na kompasu: světové strany, rysky po 15° a na
               nich zlatá ryska cíle. Uprostřed pevný hrot = kam se právě dívám.
               ⚠ VE SPLITU JE PÁSKA SAMOTNÝM DĚLIČEM (#resizer), ne dalším pruhem
                 navíc — uživatel to řekl jednou větou: „ve splitu mi ji dej do
                 rozdělovače, aby nezabírala více prostoru než je třeba". Dělič je
                 běžně 16 px; s páskou se roztáhne na 26 px a jen po dobu, kdy je
                 nastavený cíl. Tažení tím netrpí: páska nebere klepnutí
                 (pointer-events:none) a chytací plocha #resizer::after zůstává. */
            '.ag-cil-paska{position:absolute;left:0;right:0;height:26px;z-index:55;display:none;',
            '  overflow:hidden;pointer-events:none;-webkit-user-select:none;user-select:none;}',
            '.ag-cil-paska.on{display:block;}',
            /* v čisté AR je to plovoucí stužka nad spodní hranou obrazu */
            '.ag-cil-paska.v-ar{bottom:calc(env(safe-area-inset-bottom,0px) + 10px);',
            '  left:8px;right:8px;border-radius:9px;background:rgba(8,11,15,0.72);',
            '  border:1px solid rgba(255,255,255,0.14);}',
            /* v děliči vyplní celý pruh a nekreslí si vlastní rám — rámem je dělič */
            '.ag-cil-paska.v-delic{top:0;bottom:0;height:auto;background:transparent;border:0;}',
            // ⚠ 24 px SCHVÁLNĚ: přesně tolik měl dělič i s pásem blízkosti, který
            //   páska nahradila (volba uživatele 10. 9. 2026). Split se tím proti
            //   dnešku nezmění ani o pixel — a přesně o to šlo („ať nezabírá víc
            //   prostoru než je třeba"). Bez cíle je dělič dál jen 16 px.
            // ⚠ `flex:0 0 auto` není ozdoba: dělič je pružná položka sloupce a bez
            //   toho si výšku, o kterou si řekne, neudrží.
            '#resizer.ag-cil-paska-on{height:24px;flex:0 0 auto;}',
            'body.ag-glove #resizer.ag-cil-paska-on{height:28px;}',
            /* úchyt děliče by seděl přesně tam, kde je hrot pásky — schová se a
               místo něj drží „tady se táhne" dvě rysky u pravého kraje */
            '#resizer.ag-cil-paska-on .grabber{display:none;}',
            '#resizer.ag-cil-paska-on::before{opacity:0.25;}',
            '.ag-cil-uchyt{position:absolute;right:7px;top:50%;transform:translateY(-50%);',
            '  display:flex;gap:3px;pointer-events:none;}',
            '.ag-cil-uchyt i{display:block;width:2px;height:11px;border-radius:1px;',
            '  background:var(--text-muted,#9aa1ac);opacity:.5;}',
            // v čisté AR není co táhnout (dělič tam není) a pod odchylkou vpravo
            // by rysky ležely přesně tam, kde je šipka „cíl je mimo pásku"
            '.ag-cil-paska.v-ar .ag-cil-uchyt,.ag-cil-paska.mimo-r .ag-cil-uchyt{display:none;}',
            /* stužka rysek: jeden široký pás, který se posouvá transformem
               (kompozitor) — žádné přepisování DOM 60x za sekundu */
            '.ag-cil-skala{position:absolute;left:0;top:0;bottom:0;will-change:transform;}',
            // ⚠ TŘI PATRA NAD SEBOU, NE VŠECHNO PŘES SEBE. Rysky i písmena nejdřív
            //   visely od spodní hrany a v 24px pruhu se překrývaly. Teď: hrot 0–6,
            //   rysky 8–14, písmena úplně dole.
            '.ag-cil-skala i{position:absolute;top:8px;width:1px;background:#8b969e;opacity:.55;}',
            '.ag-cil-skala i.d15{height:4px;}',
            '.ag-cil-skala i.d45{height:6px;opacity:.75;}',
            '.ag-cil-skala b{position:absolute;bottom:0;transform:translateX(-50%);',
            '  font:700 9px/1 var(--font-mono,monospace);color:#c6d0d6;opacity:.9;}',
            /* pás, který ukazuje, co je zrovna v obraze kamery */
            '.ag-cil-zaber{position:absolute;top:0;bottom:0;background:rgba(255,255,255,0.07);',
            '  border-left:1px solid rgba(255,255,255,0.16);border-right:1px solid rgba(255,255,255,0.16);}',
            /* pevný hrot uprostřed = směr pohledu */
            '.ag-cil-hrot{position:absolute;left:50%;top:0;width:0;height:0;transform:translateX(-50%);',
            '  border-left:5px solid transparent;border-right:5px solid transparent;',
            '  border-top:6px solid #e8eef2;}',
            /* ryska cíle */
            '.ag-cil-znak{position:absolute;top:0;bottom:0;width:2.5px;margin-left:-1.25px;',
            '  background:' + GOLD + ';border-radius:2px;box-shadow:0 0 8px rgba(251,191,36,.7);}',
            '.ag-cil-paska.trefa .ag-cil-znak{background:#34d399;box-shadow:0 0 10px rgba(52,211,153,.8);}',
            /* ⚠ CÍL MIMO PÁSKU. Když je odchylka větší než půlka okna, ryska by
               ležela za krajem a uživatel by nevěděl NIC. Místo toho se přilepí
               na kraj, změní se v šipku a připíše, o kolik stupňů jde. Nad 135°
               je cíl za zády a šipka se změní na otočku. */
            '.ag-cil-mimo{position:absolute;top:0;bottom:0;display:none;align-items:center;gap:3px;',
            '  padding:0 7px;background:rgba(251,191,36,.16);color:' + GOLD + ';',
            '  font:700 11px/1 var(--font-mono,monospace);}',
            '.ag-cil-paska.mimo-l .ag-cil-mimo.m-l{display:flex;left:0;border-radius:0 7px 7px 0;}',
            '.ag-cil-paska.mimo-r .ag-cil-mimo.m-r{display:flex;right:0;border-radius:7px 0 0 7px;}',
            '.ag-cil-mimo svg{width:13px;height:13px;flex:none;}',
            '.ag-cil-mimo .m-u{display:none;}',
            '.ag-cil-paska.vzad .ag-cil-mimo{background:rgba(239,68,68,.18);color:#f87171;}',
            '.ag-cil-paska.vzad .ag-cil-mimo .m-c{display:none;}',
            '.ag-cil-paska.vzad .ag-cil-mimo .m-u{display:block;}',
            /* ⚠ VZDÁLENOST NA PÁSCE NENÍ. Páska odpovídá na „kam", ne na „jak daleko" —
               číslo je v HUD nad kamerou (#ar-hud-dist) a v mapě u čáry ke cíli.
               Třetí výskyt téhož čísla by byl jen šum. (Volba uživatele 10. 9. 2026:
               pás blízkosti, který vzdálenost do děliče kreslil, byl zrušen.) */
            /* na slunci (adaptivní sklo) je tmavý podklad nečitelný */
            'body.cam-light .ag-cil-paska.v-ar{background:rgba(248,250,252,0.92);border-color:rgba(15,23,42,0.2);}',
            'body.cam-light .ag-cil-skala i{background:#4b5563;}',
            'body.cam-light .ag-cil-skala b{color:#1f2937;}',
            'body.cam-light .ag-cil-hrot{border-top-color:#111827;}',
            'body.cam-light .ag-cil-zaber{background:rgba(15,23,42,0.06);}',
            'body.cam-light .ag-cil-dist{color:#92400e;text-shadow:none;}'
        ].join('\n');
        document.head.appendChild(s);
    }

    // =================================================================================
    // ③ CÍL V MAPĚ
    // =================================================================================
    function ensureGroup() {
        if (navGroup) return navGroup;
        var m = gMap(); if (!m || typeof L === 'undefined') return null;
        navGroup = L.layerGroup().addTo(m);
        return navGroup;
    }
    function clearMap() {
        if (navGroup) navGroup.clearLayers();
        _mId = null; _mLat = _mLng = _mTLat = _mTLng = null;
    }

    // Popisek posadíme na spojnici ~90 px od mojí značky (ne doprostřed) — u vzdáleného
    // cíle by střed čáry ležel mimo displej a číslo by nebylo vidět. Otočení mapy
    // vzdálenosti v pixelech nemění, takže stačí počítat v souřadnicích kontejneru.
    function labelLatLng(m, a, b) {
        try {
            var pa = m.latLngToContainerPoint(a), pb = m.latLngToContainerPoint(b);
            var len = pa.distanceTo(pb);
            if (!isFinite(len) || len < 8) return null;
            var f = (len <= 200) ? 0.5 : Math.min(0.5, 90 / len);
            return m.containerPointToLatLng(L.point(pa.x + (pb.x - pa.x) * f, pa.y + (pb.y - pa.y) * f));
        } catch (e) { return null; }
    }

    function redrawMap(force) {
        var m = gMap(); if (!m) return;
        var pt = target(), uLat = gLat(), uLng = gLng(), vm = view();
        if (!pt || uLat == null || uLng == null || !started() || vm === 'ar') {
            // v čistém AR je #map-container display:none — kreslit do něj je mrhání
            if (_mId !== null) clearMap();
            _mView = vm;
            return;
        }
        // dirty-check: překreslit až při skutečné změně (posun >0,3 m, jiný cíl, návrat z AR)
        if (!force && _mId === pt.id && _mView === vm && _mLat != null
            && Math.abs(uLat - _mLat) < 3e-6 && Math.abs(uLng - _mLng) < 5e-6
            && _mTLat === pt.lat && _mTLng === pt.lng) return;
        _mId = pt.id; _mLat = uLat; _mLng = uLng; _mTLat = pt.lat; _mTLng = pt.lng; _mView = vm;

        var grp = ensureGroup(); if (!grp) return;
        grp.clearLayers();
        var A = L.latLng(uLat, uLng), B = L.latLng(pt.lat, pt.lng);

        // spojnice (overlayPane = pod značkami bodů, aby je nepřekrývala)
        L.polyline([A, B], {
            color: GOLD, weight: 3, opacity: 0.9, dashArray: '10,8',
            lineCap: 'round', interactive: false
        }).addTo(grp);

        // aureola do shadowPane = POD značku bodu, ať zůstane čitelná; interactive:false,
        // aby klepnutí dál patřilo bodu (detail / zrušení cíle v grafika.js)
        L.marker(B, {
            icon: L.divIcon({ className: 'ag-cil-halo-wrap', html: '<div class="ag-cil-halo"><i class="r1"></i><i class="r2"></i></div>', iconSize: [0, 0] }),
            interactive: false, pane: 'shadowPane', keyboard: false
        }).addTo(grp);

        // Popisek: UŽ JEN VZDÁLENOST. Azimut odsud vypadl 8. 9. 2026 na přání
        // uživatele („v mapě to vypadá hezky, jak je ta rovná čára a vzdálenost.
        // Ty stupně tam vymaž, to je zbytečný."). V mapě je směr vidět ze samotné
        // čáry, takže číslo ve stupních tam jen přidávalo šum. Na obrazovce AR
        // azimut zůstává na obrazovce (kompasová páska níž si ho počítá sama).
        if (hasGeo()) {
            // vzdálenost se na pásku nekreslí (viz styl výš); je v otisku stavu jen proto,
        // aby se DOM přepsal, když se změní i to, co na pásce vidět JE
        var d = (pt.currentDist != null) ? pt.currentDist : getDistance(uLat, uLng, pt.lat, pt.lng);
            var pos = labelLatLng(m, A, B);
            if (pos) {
                var rot = (typeof mapRotation === 'number') ? mapRotation : 0;
                var html = '<div style="position:relative;width:0;height:0;">'
                    + '<div class="map-label-text ag-cil-lbl" style="left:-30px;top:-20px;transform:rotate(' + rot + 'deg);">'
                    + fmtD(d) + '</div></div>';
                L.marker(pos, {
                    icon: L.divIcon({ className: 'custom-map-marker', html: html, iconSize: [0, 0] }),
                    interactive: false, keyboard: false
                }).addTo(grp);
            }
        }
        // popisky se srovnávají proti otočení mapy dávkou v grafika.js — ta si musí
        // znovu načíst seznam .map-label-text, jinak by ten můj zůstal natočený s mapou
        try { window._labelsDirty = true; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cil-navigace:redrawMap'); }
    }

    // „Ukázat cíl" — vejde do mapy mě i cíl. _mapHold drží mapu tam, kam ji uživatel
    // dal (jinak by ji další GPS fix po 1,5 m posunu hned vycentroval zpět na mě);
    // po 6 s se pustí a mapa se chová zase normálně, včetně otáčení podle kompasu.
    function fitTarget() {
        var m = gMap(), pt = target(), uLat = gLat(), uLng = gLng();
        if (!m || !pt) return;
        if (uLat == null) { try { m.setView([pt.lat, pt.lng], 19, { animate: true }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cil-navigace:fitTarget'); } return; }
        try {
            window._mapHold = true;
            m.fitBounds(L.latLngBounds([[uLat, uLng], [pt.lat, pt.lng]]), { padding: [90, 90], maxZoom: 19, animate: true });
            clearTimeout(_holdT);
            _holdT = setTimeout(function () { window._mapHold = false; }, 6000);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cil-navigace:fitTarget'); }
        redrawMap(true);
    }

    // dlaždice v panelu „Mapa a vrstvy" (#map-ctrl-stack je kontejner pro moduly);
    // ukazuje se jen když nějaký cíl vůbec je
    function ensureTile() {
        if (_tile && _tile.isConnected) return _tile;
        var stack = document.getElementById('map-ctrl-stack'); if (!stack) return null;
        var b = document.createElement('button');
        b.type = 'button'; b.id = 'ms-cil'; b.className = 'ms-tile'; b.hidden = true;
        b.setAttribute('aria-label', 'Ukázat cíl');
        b.innerHTML = '<svg class="icon"><use href="#i-navigation"/></svg><span>Ukázat cíl</span>';
        b.addEventListener('click', function () { fitTarget(); });
        stack.appendChild(b);
        _tile = b;
        // map-tools.js dlaždicím modulů dodává vzhled a popisek; naše je hotová, ale
        // ať ji zaregistruje (počítadlo / zavírání panelu po akci)
        try { if (window.AGMapTools && AGMapTools.adopt) AGMapTools.adopt(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cil-navigace:ensureTile'); }
        return b;
    }
    function syncTile(has) {
        if (_tileOn === has) return;
        var b = ensureTile(); if (!b) return;
        _tileOn = has; b.hidden = !has;
    }

    // =================================================================================
    // ④ KOMPASOVÁ PÁSKA (nahradila pilulku na hraně, 9. 9. 2026)
    // =================================================================================
    // Okno pásky je ±OKNO/2 stupňů kolem směru pohledu. Zorný úhel kamery je kolem
    // 60°, takže při okně 120° zabírá „co je v obraze" prostřední polovinu pásky —
    // a je na první pohled vidět rozdíl mezi „cíl je těsně vedle záběru" a „cíl je
    // úplně jinde". Rysky jsou po 15°, písmena světových stran po 90°.
    // ⚠⚠ OKNO PÁSKY SE ŘÍDÍ ZORNÝM ÚHLEM KAMERY, NE PEVNÝM ČÍSLEM. Nejdřív tu
    //   stálo natvrdo 120° — jenže naměřený poloviční záběr je 45°, takže by pás
    //   „co je v obraze" zabral 90 ze 120 stupňů, tedy tři čtvrtiny pásky, a na
    //   to podstatné (o kolik JSEM VEDLE záběru) by nezbylo místo. Okno je proto
    //   záběr + REZERVA na každou stranu; při 45° vyjde 150°, při užší kameře míň.
    var REZERVA = 30;            // kolik stupňů mimo záběr je vidět na každé straně
    var OKNO_MIN = 110, OKNO_MAX = 200;
    var TREFA = 3;               // do kolika stupňů se ryska považuje za trefu
    var VZAD = 135;              // nad kolik stupňů je cíl „za zády"
    var _pas = null, _pasHost = null, _pasW = 0, _pasPx = 0, _pasOkno = 0, _pasHalf = 0;
    var _pTx = null, _pZnak = null, _pMimoL = null, _pMimoR = null, _pZaber = null;
    var _pStav = '';             // otisk posledního zápisu do DOM (ať se nepíše 60x/s)

    var SIP = '<svg class="m-c" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 5 8 12 15 19"/></svg>'
        + '<svg class="m-u" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20V10a5 5 0 0 1 10 0v4"/><polyline points="13 11 17 15 21 11"/></svg>';

    // Kde má páska bydlet: ve splitu v děliči, v čisté AR nad spodní hranou obrazu.
    function hostPasky() {
        var vm = view();
        if (vm === 'both') return document.getElementById('resizer');
        if (vm === 'ar') return document.getElementById('camera-container');
        return null;                      // v samotné mapě páska nedává smysl
    }

    function ensurePaska() {
        if (_pas) return _pas;
        var el = document.createElement('div');
        el.className = 'ag-cil-paska';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML =
            '<div class="ag-cil-zaber"></div>'
            + '<div class="ag-cil-skala"></div>'
            + '<div class="ag-cil-znak"></div>'
            + '<div class="ag-cil-hrot"></div>'
            + '<div class="ag-cil-mimo m-l">' + SIP + '<span class="m-t"></span></div>'
            + '<div class="ag-cil-mimo m-r"><span class="m-t"></span>' + SIP + '</div>'
            + '<span class="ag-cil-uchyt"><i></i><i></i></span>';
        _pas = el;
        _pTx = el.querySelector('.ag-cil-skala');
        _pZnak = el.querySelector('.ag-cil-znak');
        _pMimoL = el.querySelector('.ag-cil-mimo.m-l .m-t');
        _pMimoR = el.querySelector('.ag-cil-mimo.m-r .m-t');
        _pZaber = el.querySelector('.ag-cil-zaber');
        return el;
    }

    // Stupnice se staví JEDNOU pro 720° (dvě otočky vedle sebe). Posun pak dělá
    // jediný transform — proto se dá hýbat každý snímek bez zápisu do DOM.
    // ⚠ Dvě otočky jsou tam kvůli přetečení přes sever: kdyby byla jen jedna, na
    //   359° by páska skočila. Kreslí se do souřadnic „stupeň × px na stupeň",
    //   takže se při změně šířky musí přepočítat.
    var SVET = { 0: 'S', 45: 'SV', 90: 'V', 135: 'JV', 180: 'J', 225: 'JZ', 270: 'Z', 315: 'SZ' };
    function okno(half) {
        var o = 2 * half + 2 * REZERVA;
        return Math.max(OKNO_MIN, Math.min(OKNO_MAX, o));
    }
    function postavSkalu(w, half) {
        _pasW = w;
        _pasHalf = half;
        _pasOkno = okno(half);
        _pasPx = w / _pasOkno;
        var h = [], d;
        for (d = 0; d < 720; d += 15) {
            var a = d % 360;
            var x = (d * _pasPx).toFixed(1);
            if (SVET[a] !== undefined) {
                h.push('<i class="d45" style="left:' + x + 'px"></i>');
                h.push('<b style="left:' + x + 'px">' + SVET[a] + '</b>');
            } else {
                h.push('<i class="d15" style="left:' + x + 'px"></i>');
            }
        }
        _pTx.style.width = (720 * _pasPx).toFixed(1) + 'px';
        _pTx.innerHTML = h.join('');
        // pás „tohle je zrovna v obraze kamery"
        _pZaber.style.left = (w / 2 - half * _pasPx).toFixed(1) + 'px';
        _pZaber.style.width = (2 * half * _pasPx).toFixed(1) + 'px';
    }
    function polovinaZaberu() {
        var h = (window._arProj && window._arProj.halfH)
            || ((typeof visSettings !== 'undefined' && visSettings && visSettings.fovH) ? visSettings.fovH / 2 : 30);
        if (!isFinite(h) || h <= 0) h = 30;
        return Math.max(10, Math.min(h, 80));
    }

    function paskaOff() {
        if (_pas && _pas.classList.contains('on')) _pas.classList.remove('on');
        if (_pasHost && _pasHost.id === 'resizer') _pasHost.classList.remove('ag-cil-paska-on');
        _pStav = '';
    }

    function updatePaska() {
        var pt = target(), uLat = gLat(), uLng = gLng();
        var hd = (typeof currentHeading === 'number') ? currentHeading : null;
        if (!pt || uLat == null || hd === null || !started() || !hasGeo()) return paskaOff();
        var host = hostPasky();
        if (!host || host.style.display === 'none') return paskaOff();

        var el = ensurePaska();
        // přestěhování mezi děličem a kamerou (přepnutí zobrazení)
        if (_pasHost !== host) {
            if (_pasHost && _pasHost.id === 'resizer') _pasHost.classList.remove('ag-cil-paska-on');
            host.appendChild(el);
            _pasHost = host;
            el.classList.toggle('v-delic', host.id === 'resizer');
            el.classList.toggle('v-ar', host.id !== 'resizer');
            if (host.id === 'resizer') host.classList.add('ag-cil-paska-on');
            _pasW = 0;                       // vynutit přestavbu stupnice v nové šířce
        }
        if (!el.classList.contains('on')) el.classList.add('on');
        // ⚠⚠ ZNAČKU NA DĚLIČ VRACET POKAŽDÉ, NE JEN PŘI PŘESTĚHOVÁNÍ. paskaOff() ji
        //   sundá, kdykoli cíl zmizí — a když se pak cíl nastaví znovu ve STEJNÉM
        //   zobrazení, podmínka `_pasHost !== host` neplatí a značka se nevrátila:
        //   dělič zůstal 16 px a páska se do něj zmáčkla (naměřeno — rysky se
        //   překryly s písmeny světových stran).
        if (host.id === 'resizer' && !host.classList.contains('ag-cil-paska-on')) {
            host.classList.add('ag-cil-paska-on');
            _pasW = 0;                       // v jiné výšce se stupnice staví znovu
        }

        var w = el.clientWidth || host.clientWidth;
        if (!w) return;
        var half = polovinaZaberu();
        // přestavět i po změně zorného úhlu (kalibrace FOV), ne jen po změně šířky
        if (Math.abs(w - _pasW) > 1 || Math.abs(half - _pasHalf) > 0.5) postavSkalu(w, half);

        // posun stupnice: azimut `a` má být na x = střed + (a - hd) * px.
        // Kreslíme prostřední otočku (proto hd + 360), aby zbylo místo na obě strany.
        var tx = (w / 2 - (hd + 360) * _pasPx);
        _pTx.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,0,0)';

        var brg = (pt.currentBearing != null) ? pt.currentBearing : getBearing(uLat, uLng, pt.lat, pt.lng);
        var diff = ((brg - hd + 540) % 360) - 180;   // kladné = cíl je vpravo
        var ad = Math.abs(diff);
        var mez = _pasOkno / 2 - 4;                   // rezerva, ať ryska nelepí na kraj
        var mimo = ad > mez;
        var d = (pt.currentDist != null) ? pt.currentDist : getDistance(uLat, uLng, pt.lat, pt.lng);

        // DOM píšeme jen při skutečné změně (funkce běží každý snímek kompasu)
        var stav = (mimo ? 'M' : 'I') + (diff < 0 ? 'L' : 'R') + Math.round(ad) + '|'
            + (ad <= TREFA ? 'T' : '-') + '|' + (ad > VZAD ? 'B' : '-') + '|' + fmtD(d);
        if (stav !== _pStav) {
            _pStav = stav;
            el.classList.toggle('trefa', ad <= TREFA);
            el.classList.toggle('vzad', ad > VZAD);
            el.classList.toggle('mimo-l', mimo && diff < 0);
            el.classList.toggle('mimo-r', mimo && diff > 0);
            var txt = Math.round(ad) + '\u00b0';
            if (mimo && diff < 0) _pMimoL.textContent = txt;
            if (mimo && diff > 0) _pMimoR.textContent = txt;
        }
        // ryska cíle: uvnitř okna na svém místě, mimo něj přilepená ke kraji
        var x = w / 2 + Math.max(-mez, Math.min(mez, diff)) * _pasPx;
        _pZnak.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
        _pZnak.style.opacity = mimo ? '0' : '1';
    }

    // =================================================================================
    // NAPOJENÍ: updateNavGlow() volá renderAR každý snímek (i v režimu Mapa)
    // =================================================================================
    function tick() {
        try { updatePaska(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cil-navigace:tick'); }
        try { redrawMap(false); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cil-navigace:tick'); }
        try { syncTile(!!target()); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cil-navigace:tick'); }
    }

    function hook() {
        if (typeof updateNavGlow !== 'function' || updateNavGlow._cilWrapped) return false;
        var orig = updateNavGlow;
        updateNavGlow = function () { orig.apply(this, arguments); tick(); };
        updateNavGlow._cilWrapped = true;
        return true;
    }

    ensureStyle();
    if (!hook()) {
        // grafika.js ještě neproběhlo (jiné pořadí <script>) — zkusit ještě po načtení
        window.addEventListener('load', function () { hook(); });
    }

    window.AGCilNav = { fit: fitTarget, redraw: function () { redrawMap(true); }, tick: tick };
})();
