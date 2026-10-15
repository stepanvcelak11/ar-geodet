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
// ⚠ OD 15. 10. 2026 JE TO JEDINÁ MAPA: rastr OSM je z appky pryč (blikal při startu, uživatel ho
// nechce). `baseLayers.osm` je v logika.js prázdná skupina; když vlastní mapa nejde (bez WebGL,
// bez dat a bez signálu), je pod body jen barva země. OFFLINE: kusy dat se ukládají do telefonu
// (ZdrojSCache níž), „Uložit okolí" a oblasti stahují tuhle mapu (ulozOblast).
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
// STYL: 'auto' = podle motivu appky (tmavý i modrotisk → noc, jinak den), nebo napevno
// den/noc/tisk (varianta modrotisk zrušena 19. 9. 2026 — uložená volba spadne na 'auto').
// Třída .base-osm (invertování rastru v tmavém
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
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') { if (s.zap != null) st.zap = !!s.zap; if (s.styl && s.styl !== 'modrotisk') st.styl = s.styl; if (s.url) st.url = String(s.url); } } catch (e) { swallow(e, 'load'); }
    // stará volba „vypnuto" znamenala rastr OSM — ten už není (15. 10. 2026), takže se JEDNOU
    // přepne na zapnuto (jinak by měl takový telefon mapu prázdnou). Pak volba zůstává jen
    // vnitřní (testy si mapu vypínají v scripts/ag_boot.py i se značkou migrace).
    try { if (!localStorage.getItem('agMapaVektorMig_v1')) { localStorage.setItem('agMapaVektorMig_v1', '1'); if (!st.zap) { st.zap = true; localStorage.setItem(KEY, JSON.stringify(st)); } } } catch (e) { swallow(e, 'mig'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }
    function url() { return st.url || (URL_ZAKLAD + soubor()); }
    // SLABŠÍ TELEFON (15. 10. 2026): rastr OSM je z appky pryč („klasickou mapu dej úplně pryč"),
    // takže i slabší telefon kreslí vlastní mapu — jinak by měl podklad prázdný. Bez WebGL to nejde.
    function webgl() {
        if (webgl._v != null) return webgl._v;
        try { var c = document.createElement('canvas'); webgl._v = !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { webgl._v = false; }
        return webgl._v;
    }
    function lite() { return !webgl(); }

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

    // ---- MAPA V TELEFONU (15. 10. 2026, „je appka provozu schopná offline?") -----------------
    // Data PMTiles se čtou Range požadavky mimo service worker (sw.js je pouští ven), takže bez
    // signálu vlastní mapa neměla nic a offline držel jen starý rastr OSM. Teď jde každý kus
    // souboru (hlavička, adresáře, dlaždice) přes tenhle zdroj: uloží se do Cache API pod
    // vlastním klíčem (adresa + posun + délka) a bez signálu se vezme odtud.
    //   • hlavička (posun 0) = nejdřív síť (do 4 s), aby se poznala nová data; jinak uložená,
    //   • ostatní kusy = nejdřív telefon; klíč nese otisk hlavičky (nová data = nové klíče,
    //     staré kusy s posuny ze starého souboru se nikdy nesmíchají s novou hlavičkou),
    //   • při prohlížení jde do MAPA_CACHE (strop MAPA_STROP kusů, nejstarší pryč),
    //     „Uložit okolí" do MAPA_OFFLINE a každá stažená oblast do vlastní cache
    //     'argeodet-mapa-o-<id>' (smazání oblasti = smazání její cache), obojí bez stropu.
    // Všechny začínají 'argeodet-mapa-' a sw.js je při aktualizaci nemaže (KEEP_CACHES + předpona).
    var MAPA_CACHE = 'argeodet-mapa-v1', MAPA_OFFLINE = 'argeodet-mapa-offline-v1', MAPA_STROP = 8000;
    function klic(u, ver, o, l) { return 'https://ag-mapa.invalid/k?u=' + encodeURIComponent(u) + '&v=' + encodeURIComponent(ver || '') + '&o=' + o + '&l=' + l; }
    function klicHlavicky(u) { return 'https://ag-mapa.invalid/h?u=' + encodeURIComponent(u); }
    function otisk(buf) {
        // hlavička PMTiles v3 = prvních 127 bajtů (posuny adresářů, délky, počty dlaždic) → FNV-1a
        var b = new Uint8Array(buf, 0, Math.min(127, buf.byteLength)), h = 0x811c9dc5;
        for (var i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
        return h.toString(36);
    }
    function maCache() { return typeof caches !== 'undefined' && caches && typeof caches.open === 'function'; }
    function zCache(k, jmeno) {
        if (!maCache()) return Promise.resolve(null);
        var p = jmeno ? caches.open(jmeno).then(function (c) { return c.match(k); }) : caches.match(k);
        return p.then(function (r) { return r ? r.arrayBuffer() : null; }).catch(function () { return null; });
    }
    function doCache(jmeno, k, buf) {
        if (!maCache()) return Promise.resolve();
        return caches.open(jmeno).then(function (c) { return c.put(k, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } })); })
            .then(function () { if (jmeno === MAPA_CACHE) prorezPozdeji(); })
            .catch(function (e) { swallow(e, 'cache-put'); });
    }
    var _prorez = null;
    function prorezPozdeji() {
        if (_prorez) return;
        _prorez = setTimeout(function () {
            caches.open(MAPA_CACHE).then(function (c) {
                return c.keys().then(function (ks) {
                    var nav = ks.length - MAPA_STROP; if (nav <= 0) return;
                    // klíče jdou v pořadí vložení → nejstarší první (hlavičky nemažeme)
                    var smaz = ks.filter(function (r) { return r.url.indexOf('/h?') < 0; }).slice(0, nav + Math.round(MAPA_STROP / 10));
                    return Promise.all(smaz.map(function (r) { return c.delete(r); }));
                });
            }).catch(function (e) { swallow(e, 'prorez'); }).then(function () { _prorez = null; });
        }, 60000);
    }
    function sitSLimitem(p, ms) {
        return new Promise(function (res, rej) {
            var t = setTimeout(function () { var e = new Error('NetworkError: hlavička mapy nepřišla včas'); e.sitova = true; rej(e); }, ms);
            p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
        });
    }
    function ZdrojSCache(u) { this.url = u; this.fs = new pmtiles.FetchSource(u); this.ver = ''; this.cil = []; }   // cil = cache právě běžícího ukládání
    ZdrojSCache.prototype.getKey = function () { return this.url; };
    ZdrojSCache.prototype.getBytes = function (o, l, signal, etag) {
        var self = this, u = this.url;
        if (o === 0) {
            var hk = klicHlavicky(u);
            var ulozena = function () {
                return zCache(hk).then(function (b) {
                    if (!b) { var e = new Error('NetworkError: data mapy nejsou v telefonu a není signál'); e.sitova = true; throw e; }
                    self.ver = otisk(b); return { data: b };
                });
            };
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return ulozena();
            return sitSLimitem(this.fs.getBytes(o, l, signal, etag), 4000).then(function (r) {
                var nova = otisk(r.data); self.ver = nova;
                doCache(MAPA_OFFLINE, hk, r.data.slice(0));
                return r;
            }, function (e) {
                if (e && e.name === 'AbortError') throw e;
                return ulozena().catch(function () { throw e; });
            });
        }
        var k = klic(u, this.ver, o, l), cil = this.cil.length ? this.cil[this.cil.length - 1] : null;
        return zCache(k, cil).then(function (b) {
            if (b) return { data: b };
            var dal = cil ? zCache(k) : Promise.resolve(null);
            return dal.then(function (b2) {
                if (b2) { doCache(cil, k, b2.slice(0)); return { data: b2 }; }
                return self.fs.getBytes(o, l, signal, etag).then(function (r) {
                    doCache(cil || MAPA_CACHE, k, r.data.slice(0));
                    return r;
                });
            });
        });
    };
    // Jeden PMTiles na adresu, zapsaný v protokolu MapLibre (pmtiles://) i pro AGMapaData.
    function pm(u) {
        u = u || url();
        if (!window.pmtiles || !knihovny._proto) return null;
        var p = knihovny._proto.get(u);
        if (!p) { p = new pmtiles.PMTiles(new ZdrojSCache(u)); knihovny._proto.add(p); }
        return p;
    }
    // Uložit vlastní mapu obdélníku do telefonu (pro „Uložit okolí" a oblasti).
    // bbox {s,w,n,e}, zooms [z…] (nad maximum dat se ořeže), prubeh(hotovo, celkem), strop = max dlaždic,
    // o.cache = cílová cache (výchozí MAPA_OFFLINE), o.zrus() → true = přestat.
    // → Promise<{ok, total, net, chybi, tooMany, zruseno}>
    function tileXY(lat, lng, z) {
        var n = Math.pow(2, z), x = Math.floor((lng + 180) / 360 * n);
        var r = lat * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
        return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
    }
    function dlazdiceOblasti(bbox, zooms) {
        var out = [];
        zooms.forEach(function (z) {
            var a = tileXY(bbox.n, bbox.w, z), b = tileXY(bbox.s, bbox.e, z);
            for (var x = a.x; x <= b.x; x++) for (var y = a.y; y <= b.y; y++) out.push([z, x, y]);
        });
        return out;
    }
    function ulozOblast(bbox, zooms, prubeh, strop, o) {
        o = o || {};
        var res = { ok: 0, total: 0, net: 0, chybi: 0, tooMany: false, zruseno: false };
        var cil = o.cache || MAPA_OFFLINE;
        return knihovny().then(function () {
            var p = pm(); if (!p) throw new Error('data mapy nejsou k dispozici');
            return p.getHeader().then(function (h) {
                var zs = zooms.filter(function (z) { return z >= h.minZoom && z <= h.maxZoom; });
                var seznam = dlazdiceOblasti(bbox, zs);
                res.total = seznam.length;
                if (strop && seznam.length > strop) { res.tooMany = true; return res; }
                var src = p.source; if (src.cil) src.cil.push(cil);
                var i = 0, hotovo = 0;
                function dalsi() {
                    if (i >= seznam.length) return Promise.resolve();
                    if (o.zrus && o.zrus()) { res.zruseno = true; return Promise.resolve(); }
                    var t = seznam[i++];
                    return p.getZxy(t[0], t[1], t[2]).then(function (d) { if (d) res.ok++; else res.chybi++; }, function (e) { res.net++; swallow(e && e.sitova ? e : new Error('NetworkError: ' + ((e && e.message) || e)), 'ulozOblast'); })
                        .then(function () { hotovo++; try { prubeh && prubeh(hotovo, res.total); } catch (e2) { /* nic */ } return dalsi(); });
                }
                return Promise.all([dalsi(), dalsi(), dalsi(), dalsi(), dalsi(), dalsi()])
                    .then(function () { konec(); return res; }, function (e) { konec(); throw e; });
                function konec() { if (src.cil) { var j = src.cil.lastIndexOf(cil); if (j >= 0) src.cil.splice(j, 1); } }
            });
        });
    }
    // Smazat uloženou mapu: jméno cache (oblast), nebo vše ('*' — Nastavení → Uvolnit místo)
    function smazUlozenou(jmeno) {
        if (!maCache()) return Promise.resolve(0);
        return caches.keys().then(function (ks) {
            var del = ks.filter(function (j) { return jmeno === '*' ? j.indexOf('argeodet-mapa-') === 0 : j === jmeno; });
            return Promise.all(del.map(function (j) { return caches.delete(j); })).then(function () { return del.length; });
        }).catch(function (e) { swallow(e, 'smaz'); return 0; });
    }
    // VLASTNÍ MAPA PRO DALŠÍ OKNA (radar počasí, tachymetrie, místopisný náčrt, konzole vlastníka) —
    // místo rastru OSM. → Promise<L.maplibreGL vrstva>; o.snimek = půjde z ní vyrobit obrázek
    // (preserveDrawingBuffer), o.varianta = 'den'|'noc'|'tisk' (výchozí podle motivu).
    function novaVrstva(o) {
        o = o || {};
        if (lite()) return Promise.reject(new Error('Telefon neumí WebGL — mapu nejde nakreslit.'));
        return knihovny().then(function () {
            var u = url(); pm(u);
            return L.maplibreGL({ style: AGMapaStyl.vytvor(o.varianta || varianta(), u), interactive: false, attributionControl: false, pane: o.pane || 'tilePane', preserveDrawingBuffer: !!o.snimek });
        });
    }
    // Obrázek výřezu Leaflet mapy `lm` z vrstvy novaVrstva({snimek:true}) do 2D kontextu ctx (w × h).
    // Počká, až MapLibre dokreslí (nejvýš 6 s). → Promise<bool>
    function snimek(v, lm, ctx, w, h) {
        var m = null; try { m = v && v.getMaplibreMap(); } catch (e) { m = null; }
        if (!m || !lm) return Promise.resolve(false);
        return new Promise(function (res) {
            var hotovo = false, t = setTimeout(function () { kresli(); }, 6000);
            function kresli() {
                if (hotovo) return; hotovo = true; clearTimeout(t);
                try {
                    var c = m.getCanvas(), b = lm.getBounds();
                    var a = m.project([b.getWest(), b.getNorth()]), z = m.project([b.getEast(), b.getSouth()]);
                    var k = c.width / (c.clientWidth || c.width);
                    ctx.drawImage(c, a.x * k, a.y * k, (z.x - a.x) * k, (z.y - a.y) * k, 0, 0, w, h);
                    res(true);
                } catch (e) { swallow(e, 'snimek'); res(false); }
            }
            try { if (m.loaded() && m.areTilesLoaded && m.areTilesLoaded()) { m.once('render', kresli); m.triggerRepaint(); } else m.once('idle', kresli); } catch (e) { kresli(); }
        });
    }
    // Kolik vlastní mapy je v telefonu (pro Nastavení → Úložiště / diagnostiku)
    function vTelefonu() {
        if (!maCache()) return Promise.resolve({ prohlizeni: 0, ulozeno: 0 });
        var n = function (j) { return caches.open(j).then(function (c) { return c.keys(); }).then(function (k) { return k.length; }).catch(function () { return 0; }); };
        return caches.keys().then(function (ks) {
            var ul = ks.filter(function (j) { return j.indexOf('argeodet-mapa-') === 0 && j !== MAPA_CACHE; });
            return Promise.all([n(MAPA_CACHE)].concat(ul.map(n))).then(function (a) { return { prohlizeni: a[0], ulozeno: a.slice(1).reduce(function (x, y) { return x + y; }, 0) }; });
        }).catch(function () { return { prohlizeni: 0, ulozeno: 0 }; });
    }

    // ---- varianta stylu podle motivu ---------------------------------------------------
    function variantaAuto() {
        var b = document.body.classList;
        if (b.contains('theme-blueprint') || b.contains('theme-night') || !b.contains('light-mode')) return 'noc';
        return 'den';
    }
    function varianta() { return (st.styl && st.styl !== 'auto') ? st.styl : variantaAuto(); }
    var _varianta = null, _url = null;
    function nastavStyl() {
        if (!vrstva) return;
        var v = varianta(), u = url(); if (v === _varianta && u === _url) return;
        _varianta = v; _url = u; _rotPosl = null;
        try { pm(u); } catch (e0) { swallow(e0, 'pm'); }
        try { var m = vrstva.getMaplibreMap(); if (m) m.setStyle(AGMapaStyl.vytvor(v, u)); } catch (e) { swallow(e, 'setStyle'); }
    }
    // přejezd do jiného DÍLU téže země: každých 20 s porovnat url(); změna → nastavStyl() přepne zdroj
    setInterval(function () { try { if (st.zap && vrstva && !st.url && DILY && url() !== _url) nastavStyl(); } catch (e) { swallow(e, 'dilTik'); } }, 20000);
    // jiná země = jiný soubor dat (cz → sk…); když pro ni data nejsou, mapa to řekne
    document.addEventListener('ag:zeme', function () { if (st.zap && vrstva && !st.url) overData().then(nastavStyl).catch(function (e) { chybaText = (e && e.message) || String(e); if (e && e.sitova) return; try { window.agInfo && window.agInfo('Vektorová mapa: ' + chybaText); } catch (e2) { /* nic */ } }); });
    try { new MutationObserver(function () { nastavStyl(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] }); } catch (e) { swallow(e, 'observer'); }

    // ---- zapnutí / vypnutí ---------------------------------------------------------------
    // Data opravdu existují? Jeden malý Range požadavek na hlavičku PMTiles (16 kB). Bez toho
    // se přepínač tvářil jako zapnutý a mapa byla prázdná (worker bez R2 vrací 503 s návodem).
    function overData() {
        if (typeof fetch !== 'function') return Promise.resolve(true);
        // bez signálu stačí hlavička uložená v telefonu (mapa pak jede z uložených kusů)
        var ulozena = function (eSit) { return zCache(klicHlavicky(url())).then(function (b) { if (b) return true; throw eSit; }); };
        if (typeof navigator !== 'undefined' && navigator.onLine === false) { var e0 = new Error('Data mapy nejsou v telefonu a není signál.'); e0.sitova = true; return ulozena(e0); }
        return fetch(url(), { headers: { Range: 'bytes=0-16383' }, cache: 'no-store' }).then(function (r) {
            if (r.status === 206 || r.status === 200) return true;
            var t = (r.status === 404 ? (st.url ? 'Data mapy na zadané adrese nejsou (404).' : 'Data mapy pro tuhle zemi (' + soubor() + ') ještě nejsou nahraná.') : 'Data mapy nejsou k dispozici (server odpověděl ' + r.status + ').');
            return r.json().then(function (j) { if (j && j.jak) t += ' ' + j.jak; return t; }).catch(function () { return t; }).then(function (txt) { throw new Error(txt); });
        }, function () {
            // ⚠ BEZ SIGNÁLU NENÍ CHYBA APPKY (18. 9. 2026 večer, T1): vektor je od v360 výchozí, takže
            //   tahle větev běží při KAŽDÉM startu v terénu bez signálu — a přes swallow() končila jako
            //   „Něco se pokazilo … Více → Protokol chyb" už na přihlašovací obrazovce. Označit jako
            //   síťový stav: zapni() ji nehlásí toastem, do protokolu jde jen jako NetworkError.
            var e = new Error('Data mapy se nepodařilo načíst (bez signálu, nebo špatná adresa).'); e.sitova = true;
            return ulozena(e);
        });
    }
    // tise = automatické zapnutí při startu / po návratu signálu: bez dialogu, jen toast
    function zapni(tise) {
        if (lite()) { stav = 'chyba'; chybaText = 'Telefon neumí WebGL — mapu nejde nakreslit.'; return Promise.resolve(false); }
        if (typeof baseLayers === 'undefined' || typeof map === 'undefined' || !window.AGMapaStyl) { stav = 'chyba'; chybaText = 'Mapa appky ještě neběží.'; return Promise.resolve(false); }
        stav = 'nacitam';
        nactiDily();
        return overData().then(knihovny).then(function () {
            pm(url());
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
            stav = 'chyba';
            if (e && e.sitova) {
                // síť: bez toastu (stav říká pilulka nahoře a řádek Mapa v Nastavení), do protokolu jen síťově
                chybaText = 'data mapy teď nejsou dostupná (bez signálu) — zkusím znovu, až se signál vrátí.';
                swallow(new Error('NetworkError: data mapy (' + soubor() + ') bez signálu'), 'zapni');
                if (!tise) { try { window.quickToast && window.quickToast('Vektorová mapa: ' + chybaText); } catch (e4) { /* nic */ } }
            } else {
                chybaText = (e && e.message) || String(e); swallow(e, 'zapni');
                try { if (!zapni._rekl) { zapni._rekl = true; if (tise) { window.quickToast && window.quickToast('Mapa: ' + chybaText); } else if (typeof window.agInfo === 'function') window.agInfo('Vektorová mapa: ' + chybaText); } } catch (e2) { /* nic */ }
            }
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
        if (lite()) { i.textContent = 'telefon neumí WebGL — mapu nejde nakreslit'; return; }
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

    window.AGMapaVektor = { nastav: nastav, zapni: zapni, vypni: vypni, stav: function () { return stav; }, chyba: function () { return chybaText; }, posledniChyba: function () { return _posledniChyba; }, mapa: mapa, budovy: budovy, plochy: plochy, cary: cary, url: url, varianta: varianta, nastaveni: function () { return { zap: st.zap, styl: st.styl, url: st.url }; }, protokol: function () { return knihovny._proto || null; }, knihovny: knihovny, pm: pm, ulozOblast: ulozOblast, dlazdiceOblasti: dlazdiceOblasti, vTelefonu: vTelefonu, smazUlozenou: smazUlozenou, novaVrstva: novaVrstva, snimek: snimek, CACHE: [MAPA_CACHE, MAPA_OFFLINE], overData: overData, srovnejPopisky: srovnejPopisky, otoceniMapy: otoceniMapy };
})();
