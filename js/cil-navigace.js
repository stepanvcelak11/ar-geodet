// ===== AR Geodet — CÍL NAVIGACE: v mapě a na hraně displeje (ODPOJITELNÁ vrstva) =====
// Řeší dvě díry v dohledávání bodu:
//   ③ Cíl (highlightedPointId) vypadal v mapě úplně stejně jako každý jiný bod a
//     nevedla k němu žádná čára — po odzoomování se ztratil. Teď má zlatou pulzující
//     aureolu, čárkovanou spojnici ode mě k němu, popisek se vzdáleností a azimutem
//     a dlaždici „Ukázat cíl" (vejde do mapy mě i cíl).
//   ④ Když je cíl mimo záběr kamery, řekla to jen šipka dole. Teď se na hranu displeje
//     přilepí zlatá pilulka se šipkou a počtem stupňů („40°" vlevo) — a zmizí, jakmile
//     je cíl v záběru.
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
    var _edge = null, _eSide = '', _eTxt = '', _eOn = null, _eBack = null;
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
    // azimut ve stejné soustavě, v jaké ho ukazuje HUD („AZ") — včetně srovnání severu
    // a jednotky gon, jinak by číslo v mapě neodpovídalo číslu na obrazovce
    function fmtAz(brg) {
        var zero = (typeof compassZeroOffset === 'number') ? compassZeroOffset : 0;
        var rel = ((brg - zero) % 360 + 360) % 360;
        if (typeof compassUnit !== 'undefined' && compassUnit === 'gon') {
            var gt = rel * (400 / 360), gr = Math.floor(gt);
            return gr + ',' + Math.round((gt - gr) * 100).toString().padStart(2, '0') + ' g';
        }
        return rel.toFixed(0) + '°';
    }

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
            // se ztrácí (naměřeno 1,23:1). Zlatá s černým obrysem je čitelná v obou motivech.
            '.ag-cil-lbl{color:' + GOLD + ' !important;font-weight:700 !important;white-space:nowrap;',
            '  text-shadow:-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000 !important;}',
            /* ④ pilulka na hraně displeje */
            '#ag-cil-edge{position:absolute;top:50%;z-index:55;display:none;flex-direction:column;',
            '  align-items:center;gap:3px;padding:11px 8px;pointer-events:none;',
            '  background:rgba(8,11,15,0.74);border:1px solid rgba(251,191,36,0.55);',
            '  color:' + GOLD + ';font:700 12px/1 var(--font-mono,monospace);',
            '  box-shadow:0 0 20px rgba(251,191,36,0.28);}',
            '#ag-cil-edge.on{display:flex;}',
            /* POZOR: #map-sheet .ms-tile ma display:flex, coz PREBIJI atribut hidden
               (u .ms-row na to style.css pamatuje, u dlazdic ne) — bez tohoto radku
               by dlazdice „Ukazat cil" svitila v panelu i kdyz zadny cil nastaveny neni */
            '#ms-cil[hidden]{display:none !important;}',
            '#ag-cil-edge.side-l{left:0;border-left:0;border-radius:0 15px 15px 0;',
            '  transform:translateY(-50%) translateX(env(safe-area-inset-left,0px));}',
            '#ag-cil-edge.side-r{right:0;border-right:0;border-radius:15px 0 0 15px;',
            '  transform:translateY(-50%) translateX(calc(-1 * env(safe-area-inset-right,0px)));}',
            '#ag-cil-edge svg{width:26px;height:26px;display:block;}',
            '#ag-cil-edge .ag-cil-u{display:none;}',
            '#ag-cil-edge.back{border-color:rgba(239,68,68,0.6);color:#ef4444;box-shadow:0 0 20px rgba(239,68,68,0.28);}',
            '#ag-cil-edge.back .ag-cil-c{display:none;}',
            '#ag-cil-edge.back .ag-cil-u{display:block;}',
            /* na slunci (adaptivní sklo, body.cam-light) je tmavá pilulka nečitelná */
            'body.cam-light #ag-cil-edge{background:rgba(248,250,252,0.9);color:#92400e;',
            '  border-color:rgba(146,64,14,0.45);box-shadow:0 0 18px rgba(0,0,0,0.25);}',
            'body.cam-light #ag-cil-edge.back{color:#b91c1c;border-color:rgba(185,28,28,0.5);}'
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

        // popisek: vzdálenost + azimut ve stejné soustavě jako HUD
        if (hasGeo()) {
            var d = (pt.currentDist != null) ? pt.currentDist : getDistance(uLat, uLng, pt.lat, pt.lng);
            var brg = (pt.currentBearing != null) ? pt.currentBearing : getBearing(uLat, uLng, pt.lat, pt.lng);
            var pos = labelLatLng(m, A, B);
            if (pos) {
                var rot = (typeof mapRotation === 'number') ? mapRotation : 0;
                var html = '<div style="position:relative;width:0;height:0;">'
                    + '<div class="map-label-text ag-cil-lbl" style="left:-30px;top:-20px;transform:rotate(' + rot + 'deg);">'
                    + fmtD(d) + ' · ' + fmtAz(brg) + '</div></div>';
                L.marker(pos, {
                    icon: L.divIcon({ className: 'custom-map-marker', html: html, iconSize: [0, 0] }),
                    interactive: false, keyboard: false
                }).addTo(grp);
            }
        }
        // popisky se srovnávají proti otočení mapy dávkou v grafika.js — ta si musí
        // znovu načíst seznam .map-label-text, jinak by ten můj zůstal natočený s mapou
        try { window._labelsDirty = true; } catch (e) {}
    }

    // „Ukázat cíl" — vejde do mapy mě i cíl. _mapHold drží mapu tam, kam ji uživatel
    // dal (jinak by ji další GPS fix po 1,5 m posunu hned vycentroval zpět na mě);
    // po 6 s se pustí a mapa se chová zase normálně, včetně otáčení podle kompasu.
    function fitTarget() {
        var m = gMap(), pt = target(), uLat = gLat(), uLng = gLng();
        if (!m || !pt) return;
        if (uLat == null) { try { m.setView([pt.lat, pt.lng], 19, { animate: true }); } catch (e) {} return; }
        try {
            window._mapHold = true;
            m.fitBounds(L.latLngBounds([[uLat, uLng], [pt.lat, pt.lng]]), { padding: [90, 90], maxZoom: 19, animate: true });
            clearTimeout(_holdT);
            _holdT = setTimeout(function () { window._mapHold = false; }, 6000);
        } catch (e) {}
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
        try { if (window.AGMapTools && AGMapTools.adopt) AGMapTools.adopt(); } catch (e) {}
        return b;
    }
    function syncTile(has) {
        if (_tileOn === has) return;
        var b = ensureTile(); if (!b) return;
        _tileOn = has; b.hidden = !has;
    }

    // =================================================================================
    // ④ UKAZATEL MIMO ZÁBĚR
    // =================================================================================
    function ensureEdge() {
        if (_edge && _edge.isConnected) return _edge;
        var host = document.getElementById('camera-container'); if (!host) return null;
        var el = document.createElement('div');
        el.id = 'ag-cil-edge'; el.setAttribute('aria-hidden', 'true');
        el.innerHTML =
            '<svg class="ag-cil-c" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 5 8 12 15 19"/></svg>'
            + '<svg class="ag-cil-u" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20V10a5 5 0 0 1 10 0v4"/><polyline points="13 11 17 15 21 11"/></svg>'
            + '<b>0°</b>';
        host.appendChild(el);
        _edge = el;
        return el;
    }
    function edgeOff() {
        if (_eOn === false) return;
        var el = ensureEdge(); if (!el) return;
        el.classList.remove('on'); _eOn = false;
    }
    function updateEdge() {
        var pt = target(), uLat = gLat(), uLng = gLng();
        var hd = (typeof currentHeading === 'number') ? currentHeading : null;
        if (!pt || uLat == null || hd === null || !started() || view() === 'map' || !hasGeo()) return edgeOff();
        var brg = (pt.currentBearing != null) ? pt.currentBearing : getBearing(uLat, uLng, pt.lat, pt.lng);
        var diff = ((brg - hd + 540) % 360) - 180, ad = Math.abs(diff);

        // hranice = půlka zorného úhlu kamery (stejná, kterou renderAR používá na značky),
        // s hysterezí ±3°, aby pilulka na kraji záběru neblikala
        var half = (window._arProj && window._arProj.halfH)
            || ((typeof visSettings !== 'undefined' && visSettings && visSettings.fovH) ? visSettings.fovH / 2 : 45);
        if (ad < half - 3) return edgeOff();
        if (_eOn !== true && ad < half + 3) return;   // pořád v „mrtvém pásmu" → nezapínat

        var el = ensureEdge(); if (!el) return;
        var side = (diff < 0) ? 'side-l' : 'side-r';
        var back = (ad > 135);
        var txt = Math.round(ad) + '°';
        if (_eSide !== side) { el.classList.remove('side-l', 'side-r'); el.classList.add(side); _eSide = side; }
        if (_eBack !== back) { el.classList.toggle('back', back); _eBack = back; }
        if (_eTxt !== txt) { var bb = el.querySelector('b'); if (bb) bb.textContent = txt; _eTxt = txt; }
        if (_eOn !== true) { el.classList.add('on'); _eOn = true; }
    }

    // =================================================================================
    // NAPOJENÍ: updateNavGlow() volá renderAR každý snímek (i v režimu Mapa)
    // =================================================================================
    function tick() {
        try { updateEdge(); } catch (e) {}
        try { redrawMap(false); } catch (e) {}
        try { syncTile(!!target()); } catch (e) {}
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
