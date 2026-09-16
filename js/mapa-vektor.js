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
// ZAPÍNÁNÍ: Nastavení → Vzhled → „Nová mapa (vektor, beta)". VÝCHOZE VYPNUTO (beta) a
// v režimu slabší telefon (AGLite) se nenabízí — MapLibre je 1 MB knihovny a WebGL.
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
    var URL_VYCHOZI = 'https://ar-geodet-api.ar-geodet.workers.dev/mapa/evropa.pmtiles';

    var st = { zap: false, styl: 'auto', url: '' };
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') { st.zap = !!s.zap; if (s.styl) st.styl = s.styl; if (s.url) st.url = String(s.url); } } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }
    function url() { return st.url || URL_VYCHOZI; }
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
    var _varianta = null;
    function nastavStyl() {
        if (!vrstva) return;
        var v = varianta(); if (v === _varianta) return;
        _varianta = v;
        try { var m = vrstva.getMaplibreMap(); if (m) m.setStyle(AGMapaStyl.vytvor(v, url())); } catch (e) { swallow(e, 'setStyle'); }
    }
    try { new MutationObserver(function () { nastavStyl(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] }); } catch (e) { swallow(e, 'observer'); }

    // ---- zapnutí / vypnutí ---------------------------------------------------------------
    function zapni() {
        if (lite()) { stav = 'chyba'; chybaText = 'V režimu slabší telefon vektorová mapa není (WebGL + 1 MB knihovny).'; return Promise.resolve(false); }
        if (typeof baseLayers === 'undefined' || typeof map === 'undefined' || !window.AGMapaStyl) { stav = 'chyba'; chybaText = 'Mapa appky ještě neběží.'; return Promise.resolve(false); }
        stav = 'nacitam';
        return knihovny().then(function () {
            if (!vrstva) {
                _varianta = varianta();
                vrstva = L.maplibreGL({ style: AGMapaStyl.vytvor(_varianta, url()), interactive: false, attributionControl: false, pane: 'tilePane' });
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
            try { document.dispatchEvent(new CustomEvent('ag:mapa-vektor', { detail: { zap: true } })); } catch (e) { /* nic */ }
            return true;
        }).catch(function (e) { stav = 'chyba'; chybaText = (e && e.message) || String(e); swallow(e, 'zapni'); return false; });
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

    // ---- Nastavení → Vzhled → řádek ------------------------------------------------------
    function ui() {
        if (document.getElementById('s-mapa-vektor')) return;
        var tab = document.getElementById('tab-vzhled'); if (!tab) return;
        var hs = tab.querySelectorAll('.set-h'), kotva = null;
        for (var i = 0; i < hs.length; i++) if (/Displej/.test(hs[i].textContent)) { kotva = hs[i]; break; }
        var h = document.createElement('div'); h.className = 'set-h'; h.textContent = 'Mapa';
        var r1 = document.createElement('div'); r1.className = 'st-row';
        r1.innerHTML = '<span class="st-lab">Nová mapa (vektor, beta)<small id="s-mapa-vektor-info">vlastní podklad z OpenStreetMap: budovy, hrany, koleje, bez reklam; styl podle motivu</small></span>'
            + '<label class="st-sw"><input type="checkbox" id="s-mapa-vektor"><span class="st-sw-face"></span></label>';
        var r2 = document.createElement('div'); r2.id = 's-mapa-vektor-vice';
        r2.innerHTML = '<label>Styl vektorové mapy</label><select id="s-mapa-styl" class="st-sel"><option value="auto">Podle motivu</option><option value="den">Den</option><option value="noc">Noc</option><option value="modrotisk">Modrotisk</option><option value="tisk">Tisk (černobílá)</option></select>'
            + '<label>Adresa dat mapy (PMTiles)<small style="display:block; font-weight:400; color:var(--text-muted);">nech prázdné = výchozí; vlastní výřez z pmtiles extract</small></label><input type="text" id="s-mapa-url" autocomplete="off" placeholder="' + URL_VYCHOZI + '">';
        if (kotva) { tab.insertBefore(h, kotva); tab.insertBefore(r1, kotva); tab.insertBefore(r2, kotva); } else { tab.appendChild(h); tab.appendChild(r1); tab.appendChild(r2); }
        var sw = r1.querySelector('input'), sel = r2.querySelector('select'), inp = r2.querySelector('input');
        sw.checked = st.zap; sel.value = st.styl; inp.value = st.url; r2.style.display = st.zap ? '' : 'none';
        if (lite()) { sw.disabled = true; document.getElementById('s-mapa-vektor-info').textContent = 'v režimu slabší telefon není k dispozici (WebGL)'; }
        sw.addEventListener('change', function () { r2.style.display = sw.checked ? '' : 'none'; nastav({ zap: sw.checked }).then(obnov); });
        sel.addEventListener('change', function () { nastav({ styl: sel.value }).then(obnov); });
        inp.addEventListener('change', function () { nastav({ url: inp.value.trim() }).then(obnov); });
        obnov();
    }
    function obnov() {
        var i = document.getElementById('s-mapa-vektor-info'); if (!i || lite()) return;
        i.textContent = stav === 'zapnuto' ? ('zapnuto · styl ' + varianta() + ' · ' + (st.url ? 'vlastní data' : 'data z cloudu QTRIG'))
            : stav === 'nacitam' ? 'načítám knihovny mapy…'
            : stav === 'chyba' ? ('nejde zapnout: ' + chybaText)
            : 'vlastní podklad z OpenStreetMap: budovy, hrany, koleje, bez reklam; styl podle motivu';
    }

    function start() {
        try { ui(); } catch (e) { swallow(e, 'ui'); }
        document.addEventListener('click', function (ev) { try { if (ev.target && ev.target.closest && ev.target.closest('#settings-btn, [data-open="settings"]')) setTimeout(ui, 50); } catch (e) { /* nic */ } }, true);
        if (st.zap && !lite()) {
            // až běží mapa appky (logika.js nastaví `map`), a v nečinnosti — ne před prvním obrazem
            var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1200); };
            idle(function () { zapni().then(obnov); });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.AGMapaVektor = { nastav: nastav, zapni: zapni, vypni: vypni, stav: function () { return stav; }, chyba: function () { return chybaText; }, posledniChyba: function () { return _posledniChyba; }, mapa: mapa, budovy: budovy, url: url, varianta: varianta, nastaveni: function () { return { zap: st.zap, styl: st.styl, url: st.url }; } };
})();
