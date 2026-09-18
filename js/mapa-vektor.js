// ===== QTRIG — VLASTNÍ VEKTOROVÁ MAPA (ODPOJITELNÁ vrstva, ag/lazy) ==================
// (16. 9. 2026, fáze 2 „vlastní mapa" — A1; viz paměť project-vlastni-mapa-svet-vyber-16-9)
//
// PROČ: podklad byl cizí rastr (tile.openstreetmap.org) — obrázek, který nejde
// přebarvit, nesmí se hromadně stahovat a nic „neví". Tady je podklad NÁŠ: jeden
// soubor PMTiles s daty OpenStreetMap (Protomaps Basemap), který si telefon tahá po
// kouskách (HTTP Range), a styl „stavba" (js/mapa-styl.js) se čtyřmi variantami z
// jedněch dat. A hlavně: budovy, silnice, vodstvo jsou v telefonu jako GEOMETRIE,
// takže se s nimi dá počítat (přichycení k rohu, korekce po hraně, mapa kvality GPS,
// 3D pohled — další moduly téhle fáze).
//
// JAK JE ZAPOJENÁ: NEnahrazuje Leaflet. Přes plugin maplibre-gl-leaflet se MapLibre
// kreslí jako podkladová vrstva UVNITŘ Leafletu, takže všech ~10 modulů, které sahají
// na `map` (body, spojnice, tachymetrie, radar, stopa…), jede beze změny. Když je
// zapnutá, nahradí v `baseLayers.osm` rastr OSM — applyMapLayers() z grafika.js ji
// pak přidává/odebírá jako dřív. Ortofoto ČÚZK zůstává druhý podklad.
//
// ZAPÍNÁNÍ: panel Mapa (tlačítko Vrstvy) → Podklad → karta Mapa; adresa vlastních dat v
// Nastavení → Data. VÝCHOZE ZAPNUTO (od 18. 9. 2026 — uživatel: „moje nová mapa funguje
// vizuálně líp než klasická, obyčejnou pryč"); do té doby výchozí vypnuto (beta). Když se
// nedá zapnout (slabší telefon = AGLite, bez signálu, data pro zemi nejsou), zůstává pod
// kartou rastr OSM a při startu se nic nehlásí (jen tichý toast); ruční zapnutí hlásí dál.
// V režimu slabší telefon se nenabízí — MapLibre je 1 MB knihovny a WebGL.
// Knihovny (js/lib/maplibre-gl-5.24.0.js + css, pmtiles-4.5.0.js, maplibre-gl-leaflet)
// se stahují AŽ při zapnutí, ne při startu.
//
// STYL: 'auto' = podle motivu appky (tmavý → noc, modrotisk → modrotisk, jinak den),
// nebo napevno den/noc/modrotisk/tisk. Třída .base-osm (invertování rastru v tmavém
// motivu, css/motivy-teren.css) se na plátno MapLibre nevztahuje — kreslíme rovnou barvy.
//
// DATA: adresa souboru PMTiles je v nastavení (agMapaVektor_v1.url); výchozí je worker
// /mapa/evropa.pmtiles (R2, viz cloud/wrangler.toml). Pro testy se podstrčí místní
// fixture (tests/fixtures/mapa-praha.pmtiles). Range požadavky NESMÍ přes cache
// service workeru (Cache API rozsahy nezná) — sw.js je pouští mimo.
//
// Odstranění: smaž js/mapa-vektor.js, js/mapa-styl.js, js/lib/maplibre-gl-*, js/lib/pmtiles-*,
// js/lib/maplibre-gl-leaflet-*, řádky v index.html; python scripts/gen_sw_assets.py --bump.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGMapaVektor) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'mapa-vektor:' + kde); } catch (e2) { /* nic */ } };

    var KEY = 'agMapaVektor_v1';
    var LIBS = ['js/lib/maplibre-gl-5.24.0.js', 'js/lib/pmtiles-4.5.0.js', 'js/lib/maplibre-gl-leaflet-0.1.4.js'];
    var CSS = 'js/lib/maplibre-gl-5.24.0.css';
    // Data PO ZEMÍCH (17. 9. 2026): worker /mapa/<kód>.pmtiles — cz.pmtiles = celé Česko (asset
    // vydání GitHubu „mapa-data", 1,7 GB), další země přibudou stejně (do 2 GB na soubor); až bude
    // R2 s celou Evropou, worker sáhne tam. Země = registr (AGSour), ruční adresa má přednost.
    var URL_ZAKLAD = 'https://ar-geodet-api.ar-geodet.workers.dev/mapa/';
    var URL_VYCHOZI = URL_ZAKLAD + 'cz.pmtiles';
    // DÍLY VELKÝCH ZEMÍ (18. 9. 2026 večer, „mapa pro celou Evropu"): asset vydání GitHubu smí 2 GB,
    // Německo nebo Francie mají 5–8 GB → scripts/mapa-evropa.py je rozřeže na díly de-1, de-2… a bboxy
    // zapíše do data/mapa-dily.json. Tady se podle polohy (GPS, jinak střed mapy) vybere díl; země bez
    // záznamu má jeden soubor <kód>.pmtiles. Přejezd do jiného dílu hlídá tik níž (url() se změní →
    // nastavStyl() přepne zdroj; mapa-data.js si zdroj přebuduje podle url() sám).
    var DILY = null;            // { CZ: [{f, bbox:[lon0,lat0,lon1,lat1]}], … } nebo {} když soubor chybí
    function nactiDily() {
        if (DILY || typeof fetch !== 'function') return;
        DILY = {};
        fetch('data/mapa-dily.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) { if (j && j.dily) { DILY = j.dily; nastavStyl(); } })
            .catch(function (e) { swallow(e, 'dily'); });
    }
    function poloha() {
        try { if (typeof userLat === 'number' && typeof userLng === 'number' && isFinite(userLat) && isFinite(userLng) && userLat) return { lat: userLat, lng: userLng }; } catch (e) { /* nic */ }
        try { if (typeof map !== 'undefined' && map && map.getCenter) { var c = map.getCenter(); return { lat: c.lat, lng: c.lng }; } } catch (e2) { /* nic */ }
        return null;
    }
    function dil(kod) {
        var d = DILY && DILY[kod]; if (!d || !d.length) return null;
        var p = poloha();
        if (p) {
            for (var i = 0; i < d.length; i++) {
                var b = d[i].bbox;
                if (p.lng >= b[0] && p.lng <= b[2] && p.lat >= b[1] && p.lat <= b[3]) return d[i].f;
            }
            // mimo všechny bboxy (roztažení obrysu) → nejbližší střed dílu
            var best = d[0], bd = Infinity;
            for (var j = 0; j < d.length; j++) {
                var bb = d[j].bbox, dx = p.lng - (bb[0] + bb[2]) / 2, dy = p.lat - (bb[1] + bb[3]) / 2, dd = dx * dx + dy * dy;
                if (dd < bd) { bd = dd; best = d[j]; }
            }
            return best.f;
        }
        return d[0].f;
    }
    function soubor() {
        try {
            var k = (window.AGSour && AGSour.kod()) || 'CZ';
            if (k === 'XX') return 'svet.pmtiles';
            return (dil(k) || k.toLowerCase()) + '.pmtiles';
        } catch (e) { return 'cz.pmtiles'; }
    }

    var st = { zap: true, styl: 'auto', url: '' };   // zap: výchozí ZAPNUTO (18. 9. 2026), uložená volba má přednost
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') { if (s.zap != null) st.zap = !!s.zap; if (s.styl) st.styl = s.styl; if (s.url) st.url = String(s.url); } } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }
    function url() { return st.url || (URL_ZAKLAD + soubor()); }
    function lite() { return !!(window.AGLite && AGLite.lite); }

    var vrstva = null;          // L.maplibreGL vrstva
    var rastr = null;           // původní baseLayers.osm (rastr OSM) pro návrat
    var nacitam = null;         // Promise knihoven
    var stav = 'vypnuto';       // vypnuto | nacitam | zapnuto | chyba
    var _posledniChyba = '';    // poslední chyba MapLibre (dlaždice/glyfy) — jen pro diagnostiku
    var chybaText = '';

    // ---- knihovny až na požádání --------------------------------------------------
    function nactiSkript(src) {
        return new Promise(function (res, rej) {
            if (document.querySelector('script[src="' + src + '"]')) { res(); return; }
            var el = document.createElement('script'); el.src = src; el.async = false;
            el.onload = function () { res(); }; el.onerror = function () { rej(new Error('nelze načíst ' + src)); };
            document.head.appendChild(el);
        });
    }
    function nactiCss(href) {
        if (document.querySelector('link[href="' + href + '"]')) return;
        var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
    }
    function knihovny() {
        if (nacitam) return nacitam;
        nactiCss(CSS);
        nacitam = LIBS.reduce(function (p, src) { return p.then(function () { return nactiSkript(src); }); }, Promise.resolve())
            .then(function () {
                if (!window.maplibregl || !window.pmtiles || !L.maplibreGL) throw new Error('knihovny mapy se nenačetly');
                if (!knihovny._proto) { knihovny._proto = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', knihovny._proto.tile); }
            })
            .catch(function (e) { nacitam = null; throw e; });
        return nacitam;
    }

    // ---- varianta stylu podle motivu ---------------------------------------------------
    function variantaAuto() {
        var b = document.body.classList;
        if (b.contains('theme-blueprint')) return 'modrotisk';
        if (b.contains('theme-night') || !b.contains('light-mode')) return 'noc';
        return 'den';
    }
    function varianta() { return (st.styl && st.styl !== 'auto') ? st.styl : variantaAuto(); }
    var _varianta = null, _url = null;
    function nastavStyl() {
        if (!vrstva) return;
        var v = varianta(), u = url(); if (v === _varianta && u === _url) return;
        _varianta = v; _url = u; _rotPosl = null;
        try { var m = vrstva.getMaplibreMap(); if (m) m.setStyle(AGMapaStyl.vytvor(v, u)); } catch (e) { swallow(e, 'setStyle'); }
    }
    // přejezd do jiného DÍLU téže země: každých 20 s porovnat url(); změna → nastavStyl() přepne zdroj
    setInterval(function () { try { if (st.zap && vrstva && !st.url && DILY && url() !== _url) nastavStyl(); } catch (e) { swallow(e, 'dilTik'); } }, 20000);
    // jiná země = jiný soubor dat (cz → sk…); když pro ni data nejsou, mapa to řekne
    document.addEventListener('ag:zeme', function () { if (st.zap && vrstva && !st.url) overData().then(nastavStyl).catch(function (e) { chybaText = (e && e.message) || String(e); try { window.agInfo && window.agInfo('Vektorová mapa: ' + chybaText); } catch (e2) { /* nic */ } }); });
    try { new MutationObserver(function () { nastavStyl(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] }); } catch (e) { swallow(e, 'observer'); }

    // ---- zapnutí / vypnutí ---------------------------------------------------------------
    // Data opravdu existují? Jeden malý Range požadavek na hlavičku PMTiles (16 kB). Bez toho
    // se přepínač tvářil jako zapnutý a mapa byla prázdná (worker bez R2 vrací 503 s návodem).
    function overData() {
        if (typeof fetch !== 'function') return Promise.resolve(true);
        return fetch(url(), { headers: { Range: 'bytes=0-16383' }, cache: 'no-store' }).then(function (r) {
            if (r.status === 206 || r.status === 200) return true;
            var t = (r.status === 404 ? (st.url ? 'Data mapy na zadané adrese nejsou (404).' : 'Data mapy pro tuhle zemi (' + soubor() + ') ještě nejsou nahraná.') : 'Data mapy nejsou k dispozici (server odpověděl ' + r.status + ').');
            return r.json().then(function (j) { if (j && j.jak) t += ' ' + j.jak; return t; }).catch(function () { return t; }).then(function (txt) { throw new Error(txt); });
        }, function () { throw new Error('Data mapy se nepodařilo načíst (bez signálu, nebo špatná adresa).'); });
    }
    // tise = automatické zapnutí při startu / po návratu signálu: bez dialogu, jen toast
    function zapni(tise) {
        if (lite()) { stav = 'chyba'; chybaText = 'V režimu slabší telefon vektorová mapa není (WebGL + 1 MB knihovny).'; return Promise.resolve(false); }
        if (typeof baseLayers === 'undefined' || typeof map === 'undefined' || !window.AGMapaStyl) { stav = 'chyba'; chybaText = 'Mapa appky ještě neběží.'; return Promise.resolve(false); }
        stav = 'nacitam';
        nactiDily();
        return overData().then(knihovny).then(function () {
            if (!vrstva) {
                _varianta = varianta(); _url = url();
                vrstva = L.maplibreGL({ style: AGMapaStyl.vytvor(_varianta, _url), interactive: false, attributionControl: false, pane: 'tilePane' });
                // chyby MapLibre (dlaždice, glyfy) do protokolu + poslední pro diagnostiku
                try { vrstva.on('add', function () { var m = vrstva.getMaplibreMap(); if (m && !m._agErr) { m._agErr = 1; m.on('error', function (ev) { _posledniChyba = (ev && ev.error && ev.error.message) || String(ev && ev.error); swallow(ev && ev.error, 'maplibre'); }); } }); } catch (e) { swallow(e, 'on-error'); }
                vrstva.on('add', function () { try { document.getElementById('map').classList.add('base-vektor'); } catch (e) { /* nic */ } });
                vrstva.on('remove', function () { try { document.getElementById('map').classList.remove('base-vektor'); } catch (e) { /* nic */ } });
            }
            if (!rastr) rastr = baseLayers.osm;
            var bylOsm = map.hasLayer(baseLayers.osm);
            if (bylOsm) map.removeLayer(baseLayers.osm);
            baseLayers.osm = vrstva;
            if (bylOsm) vrstva.addTo(map);
            stav = 'zapnuto'; chybaText = '';
            // zapnutí (i z 3D pohledu / panelu Mapa) = volba uživatele: jinak další nastav({styl}) mapu zase vypnulo (st.zap zůstalo false)
            if (!st.zap) { st.zap = true; uloz(); }
            try { document.dispatchEvent(new CustomEvent('ag:mapa-vektor', { detail: { zap: true } })); } catch (e) { /* nic */ }
            return true;
        }).catch(function (e) {
            stav = 'chyba'; chybaText = (e && e.message) || String(e); swallow(e, 'zapni');
            try { if (!zapni._rekl) { zapni._rekl = true; if (tise) { window.quickToast && window.quickToast('Mapa jede z rastru: ' + chybaText); } else if (typeof window.agInfo === 'function') window.agInfo('Vektorová mapa: ' + chybaText); } } catch (e2) { /* nic */ }
            try { document.dispatchEvent(new CustomEvent('ag:mapa-vektor', { detail: { zap: false, chyba: chybaText } })); } catch (e3) { /* nic */ }
            return false;
        });
    }
    function vypni() {
        if (!vrstva || !rastr || typeof baseLayers === 'undefined') { stav = 'vypnuto'; return; }
        var byl = map.hasLayer(vrstva);
        if (byl) map.removeLayer(vrstva);
        baseLayers.osm = rastr;
        if (byl) rastr.addTo(map);
        stav = 'vypnuto';
        try { document.dispatchEvent(new CustomEvent('ag:mapa-vektor', { detail: { zap: false } })); } catch (e) { /* nic */ }
    }
    // Změny jdou FRONTOU za sebou: zapni() je asynchronní (knihovny), a kdyby mezitím přišlo
    // vypni(), dokončené zapnutí by vrstvu zase přidalo (závod z testu, 16. 9. 2026).
    var _fronta = Promise.resolve();
    function nastav(o) {
        var zmenaUrl = o && o.url !== undefined && String(o.url || '') !== st.url;
        if (o && o.zap !== undefined) st.zap = !!o.zap;
        if (o && o.styl) st.styl = o.styl;
        if (o && o.url !== undefined) st.url = String(o.url || '');
        uloz();
        var chci = st.zap;
        _fronta = _fronta.then(function () {
            if (chci) { if (zmenaUrl && vrstva) _varianta = null; return zapni().then(function (ok) { nastavStyl(); return ok; }); }
            vypni(); return true;
        }).catch(function (e) { swallow(e, 'nastav'); return false; });
        return _fronta;
    }

    // MapLibre mapa (pro další moduly: dotazy na budovy, 3D…) — null, dokud není zapnuto
    function mapa() { try { return vrstva ? vrstva.getMaplibreMap() : null; } catch (e) { return null; } }
    // Budovy v aktuálně načtených dlaždicích jako GeoJSON prvky (lng/lat) — pro přichycení,
    // hlídače okolí a mapu kvality GPS. Prázdné pole, dokud mapa nebo dlaždice nejsou.
    function budovy() {
        var m = mapa(); if (!m || !m.isStyleLoaded || !m.isStyleLoaded()) return [];
        try { return m.querySourceFeatures('pm', { sourceLayer: 'buildings' }) || []; } catch (e) { swallow(e, 'budovy'); return []; }
    }

    // Plochy (polygony) z vrstev podle kind — les pro mapu kvality GPS apod.; [[ring:[{lat,lng}]]]
    function plochy(sourceLayers, kinds) {
        var m = mapa(); if (!m || !m.isStyleLoaded || !m.isStyleLoaded()) return [];
        var out = [];
        (sourceLayers || []).forEach(function (sl) {
            var fs = []; try { fs = m.querySourceFeatures('pm', { sourceLayer: sl }) || []; } catch (e) { swallow(e, 'plochy'); }
            fs.forEach(function (f) {
                if (kinds && kinds.indexOf(f.properties && f.properties.kind) < 0) return;
                var g = f.geometry; if (!g) return;
                var polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
                polys.forEach(function (poly) { out.push(poly.map(function (ring) { return ring.map(function (c) { return { lat: c[1], lng: c[0] }; }); })); });
            });
        });
        return out;
    }

    // Čáry (LineString) z vrstvy podle kind — koleje pro hlídač okolí, silnice pro trasu; [[{lat,lng}]]
    function cary(sourceLayer, kinds) {
        var m = mapa(); if (!m || !m.isStyleLoaded || !m.isStyleLoaded()) return [];
        var out = [];
        var fs = []; try { fs = m.querySourceFeatures('pm', { sourceLayer: sourceLayer }) || []; } catch (e) { swallow(e, 'cary'); }
        fs.forEach(function (f) {
            if (kinds && kinds.indexOf(f.properties && f.properties.kind) < 0) return;
            var g = f.geometry; if (!g) return;
            var lines = g.type === 'LineString' ? [g.coordinates] : (g.type === 'MultiLineString' ? g.coordinates : []);
            lines.forEach(function (line) { var l = line.map(function (c) { return { lat: c[1], lng: c[0] }; }); l.vlastnosti = f.properties || {}; out.push(l); });
        });
        return out;
    }

    // ---- Nastavení → Data → „Data mapy" (jen adresa PMTiles) --------------------------------
    // ⚠ JEDNO MÍSTO (18. 9. 2026): zapínání a styl vektorové mapy bydlí v panelu Mapa → Podklad
    //   (tlačítko Vrstvy). Dřív byl přepínač i v Nastavení → Vzhled a čtyři hlášky posílaly
    //   uživatele právě tam — dvě místa pro jednu volbu. Tady zůstává jen adresa vlastních dat,
    //   což je věc dat, ne vzhledu.
    function ui() {
        if (document.getElementById('s-mapa-url')) return;
        var tab = document.getElementById('tab-data'); if (!tab) return;
        var h = document.createElement('div'); h.className = 'set-h'; h.textContent = 'Data mapy (vektor)';
        var r2 = document.createElement('div'); r2.id = 's-mapa-vektor-vice';
        r2.innerHTML = '<label>Adresa dat mapy (PMTiles)<small id="s-mapa-vektor-info" style="display:block; font-weight:400; color:var(--text-muted);"></small></label><input type="text" id="s-mapa-url" autocomplete="off" placeholder="' + URL_VYCHOZI + '">'
            + '<small style="display:block; margin-top:4px; color:var(--text-muted);">nech prázdné = výchozí data QTRIG; vlastní výřez z pmtiles extract. Mapa se zapíná tlačítkem Vrstvy → Podklad → Mapa.</small>';
        tab.appendChild(h); tab.appendChild(r2);
        var inp = r2.querySelector('input');
        inp.value = st.url;
        if (lite()) { inp.disabled = true; }
        inp.addEventListener('change', function () { nastav({ url: inp.value.trim() }).then(obnov); });
        obnov();
    }
    function obnov() {
        var i = document.getElementById('s-mapa-vektor-info'); if (!i) return;
        if (lite()) { i.textContent = 'v režimu slabší telefon není vektorová mapa k dispozici (WebGL)'; return; }
        i.textContent = stav === 'zapnuto' ? ('zapnuto · styl ' + varianta() + ' · ' + (st.url ? 'vlastní data' : 'data z cloudu QTRIG'))
            : stav === 'nacitam' ? 'načítám knihovny mapy…'
            : stav === 'chyba' ? ('nejde zapnout: ' + chybaText)
            : 'vlastní podklad z OpenStreetMap: budovy, hrany, koleje, bez reklam; styl podle motivu';
    }

    // POPISKY NEVZHŮRU NOHAMA (18. 9. 2026, přání: „čísla domů ať se otáčejí, ať je nečtu hlavou dolů"):
    // mapa se v režimu „po směru" otáčí CSS transformem #map-wrapper a plátno MapLibre se otočí s ní.
    // Bodové popisky (čísla popisná, sídla, vrcholy) dostanou text-rotate = opačný úhel, takže stojí
    // rovně jako popisky bodů appky. Názvy ulic jdou podél čáry — ty se otáčejí s ulicí (jako na papíře).
    var _rotPosl = null, _rotTik = null, ROT_VRSTVY = ['cisla-popisna', 'sidla', 'poi-vrcholy'];
    function otoceniMapy() { try { var mm = /rotate\((-?[\d.]+)deg\)/.exec(document.getElementById('map-wrapper').style.transform || ''); return mm ? parseFloat(mm[1]) : 0; } catch (e) { return 0; } }
    function srovnejPopisky(nasilim) {
        var m = mapa(); if (!m || !m.isStyleLoaded || !m.isStyleLoaded()) return;
        var r = otoceniMapy(); if (!nasilim && _rotPosl != null && Math.abs(((r - _rotPosl + 540) % 360) - 180) < 2) return;
        _rotPosl = r;
        ROT_VRSTVY.forEach(function (id) { try { if (m.getLayer(id)) m.setLayoutProperty(id, 'text-rotate', -r); } catch (e) { /* vrstva chybí */ } });
    }
    function start() {
        try { ui(); } catch (e) { swallow(e, 'ui'); }
        if (!_rotTik) _rotTik = setInterval(function () { try { if (vrstva && typeof map !== 'undefined' && map.hasLayer(vrstva)) srovnejPopisky(false); } catch (e) { /* nic */ } }, 400);
        document.addEventListener('ag:mapa-vektor', function () { _rotPosl = null; setTimeout(function () { srovnejPopisky(true); }, 800); });
        document.addEventListener('click', function (ev) { try { if (ev.target && ev.target.closest && ev.target.closest('#settings-btn, [data-open="settings"]')) setTimeout(ui, 50); } catch (e) { /* nic */ } }, true);
        if (st.zap && !lite()) {
            // až běží mapa appky (logika.js nastaví `map`), a v nečinnosti — ne před prvním obrazem
            var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1200); };
            idle(function () { zapni(true).then(obnov); });
            // bez signálu při startu zůstal rastr — jakmile se signál vrátí, zkusit vektor znovu (tiše)
            window.addEventListener('online', function () { if (st.zap && stav === 'chyba' && !lite()) { zapni._rekl = false; setTimeout(function () { zapni(true).then(obnov); }, 1500); } });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.AGMapaVektor = { nastav: nastav, zapni: zapni, vypni: vypni, stav: function () { return stav; }, chyba: function () { return chybaText; }, posledniChyba: function () { return _posledniChyba; }, mapa: mapa, budovy: budovy, plochy: plochy, cary: cary, url: url, varianta: varianta, nastaveni: function () { return { zap: st.zap, styl: st.styl, url: st.url }; }, protokol: function () { return knihovny._proto || null; }, knihovny: knihovny, overData: overData, srovnejPopisky: srovnejPopisky, otoceniMapy: otoceniMapy };
})();
