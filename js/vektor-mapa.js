// ===== AR Geodet — VEKTOROVÁ MAPA OFFLINE (ODPOJITELNÁ vrstva) =================
// Neinvazivní vrstva: NEEDITUJE logika.js ani grafika.js. Přidá si do mapy
// VLASTNÍ kreslicí vrstvu a vlastní dlaždici; když soubor smažeš, mapa jede
// přesně jako dřív.
//
// PROBLÉM, KTERÝ ŘEŠÍ: podklad mapy jsou dnes RASTROVÉ DLAŽDICE (OSM, ortofoto
// z ČÚZK). To má v terénu tři nepříjemnosti:
//   1) Bez signálu je vidět jen to, co se stihlo nacachovat — a „Uložit mapu
//      pro offline" stahuje dlaždice KOLEM AKTUÁLNÍ GPS, takže z kanceláře se
//      oblast sbalit nedala.
//   2) Dlaždice mají svůj nejvyšší zoom. Přiblížíš se na detail a obrázek se
//      rozmaže — přitom právě na detailu se v terénu pracuje.
//   3) Jsou to obrázky: nejdou obarvit do venkovního ani nočního režimu,
//      neotočí se s mapou popisky a jeden km² váží megabajty.
//
// CO DĚLÁ TAHLE VRSTVA: stáhne z OpenStreetMap GEOMETRII zvolené oblasti
// (budovy, silnice a cesty, vodu, koleje, plochy), uloží ji do IndexedDB
// a kreslí ji do mapy VEKTOROVĚ na <canvas>. Výsledek:
//   • funguje BEZ SIGNÁLU (data jsou v telefonu, ne v cache dlaždic),
//   • je ostrá v každém přiblížení, protože se kreslí, ne zvětšuje,
//   • obec i s okolím se vejde do jednotek MB místo stovek,
//   • barvy jdou ztlumit (venkovní / noční čtení) — je to kresba, ne fotka.
//
// SBALIT SE DÁ Z KANCELÁŘE. Oblast se vybírá OBDÉLNÍKEM V MAPĚ (posuň a přibliž
// mapu tam, kam pojedeš, a ťukni na „Sbalit tento výřez"), ne kolem aktuální
// GPS. To byla u js/offline-sbal.js / saveForOffline() ta hlavní překážka.
//
// ČÍM TO NENÍ: NENÍ to náhrada katastru ani ortofota a NENÍ to měřický podklad.
// OSM je dobrovolnická data — poloha budovy v něm může být metry vedle a nikdo
// ji negarantuje. Slouží k ORIENTACI (kde je cesta, kudy se dá projet, kde
// končí les), ne k odměřování. Proto vrstva NENABÍZÍ odečet souřadnic a proto
// je v panelu napsané, odkud data jsou.
//
// PROČ CANVAS A NE L.geoJSON: obec má klidně 15 000 čar. Jako SVG prvky by to
// byl stejný počet uzlů v DOM a mapa by se přestala hýbat. Tady je jeden
// <canvas> překreslený po dojetí posunu — kreslí se jen to, co je vidět,
// a podle přiblížení (budovy až od z16, drobné cesty od z15).
//
// ULOŽENÍ: IndexedDB 'agVektorMapa', jeden záznam na sbalenou oblast.
// ⚠ Vnitřní obálka idb() je ZÁMĚRNĚ tenká (open/get/put/del/list) — až vznikne
// společné úložiště js/ag-store.js, přesadí se výměnou téhle jedné obálky.
//
// Data © přispěvatelé OpenStreetMap (ODbL). Stahuje se přes Overpass API.
// Odstranění: smaž js/vektor-mapa.js + řádek <script> v index.html, záznam
// 'vektor-mapa' v js/tools-registry.js a jeho text v data/navody.json
// (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGVektorMapa) return;

    var STYLE_ID = 'ag-vm-style';
    var MODAL_ID = 'ag-vm-modal';
    var DB_NAME = 'agVektorMapa', DB_STORE = 'oblasti', DB_VER = 1;
    var LS_ON = 'agVektorMapaOn_v1';       // '1' = vrstva zapnutá
    var LS_AKT = 'agVektorMapaAkt_v1';     // id naposled použité oblasti
    var OVERPASS = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter'   // záloha, když je hlavní přetížený
    ];
    var MAX_KM2 = 12;          // strop výřezu — nad tím Overpass stejně odmítá
    var SIMPL_M = 1.5;         // zjednodušení linií (metry) — nižší nemá na mapě smysl

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/></svg>';

    // Co se stahuje a jak se to kreslí. Pořadí v tomhle seznamu je i pořadím
    // kreslení (plochy vespod, silnice navrch).
    var KIND = {
        les: { z: 12, fill: 'rgba(34,120,72,0.30)', stroke: null, plocha: 1 },
        louka: { z: 13, fill: 'rgba(88,140,60,0.20)', stroke: null, plocha: 1 },
        voda: { z: 11, fill: 'rgba(38,110,190,0.45)', stroke: 'rgba(90,170,240,0.75)', w: 1, plocha: 1 },
        tok: { z: 13, fill: null, stroke: 'rgba(90,170,240,0.8)', w: 1.6 },
        budova: { z: 16, fill: 'rgba(150,160,175,0.42)', stroke: 'rgba(190,200,215,0.65)', w: 0.8, plocha: 1 },
        kolej: { z: 14, fill: null, stroke: 'rgba(220,220,225,0.55)', w: 1.4, dash: [5, 4] },
        silnice: { z: 11, fill: null, stroke: 'rgba(250,220,140,0.92)', w: 3.2 },
        cesta: { z: 14, fill: null, stroke: 'rgba(215,215,220,0.62)', w: 1.5 },
        pesina: { z: 15, fill: null, stroke: 'rgba(200,190,170,0.5)', w: 1, dash: [3, 3] }
    };
    var PORADI = ['les', 'louka', 'voda', 'budova', 'kolej', 'tok', 'pesina', 'cesta', 'silnice'];

    var _layer = null, _map = null;
    var _feats = [];           // [{k, c:[[lat,lng],…], n}]
    var _aktId = null;
    var _busy = false;
    var _tlum = false;         // ztlumené barvy (venkovní / noční čtení)

    // ---- pomocné -------------------------------------------------------------
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'vektor-mapa'); } catch (err) { /* nic */ } }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : void 0); } catch (e) { swallow(e, 'vm:toast'); } }
    function esc(s) {
        return (window.AG && AG.esc) ? AG.esc(s)
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }
    function mapa() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function fmtMB(b) { return (b / 1048576).toFixed(b > 10485760 ? 0 : 1).replace('.', ',') + ' MB'; }

    // ---- IndexedDB (tenká obálka, viz hlavička) ------------------------------
    function idb() {
        return new Promise(function (res, rej) {
            var r;
            try { r = indexedDB.open(DB_NAME, DB_VER); } catch (e) { rej(e); return; }
            r.onupgradeneeded = function () {
                try { if (!r.result.objectStoreNames.contains(DB_STORE)) r.result.createObjectStore(DB_STORE, { keyPath: 'id' }); }
                catch (e) { swallow(e, 'vm:onupgradeneeded'); }
            };
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { rej(r.error); };
        });
    }
    function dbPut(rec) {
        return idb().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction(DB_STORE, 'readwrite');
                tx.objectStore(DB_STORE).put(rec);
                tx.oncomplete = function () { res(true); };
                tx.onerror = function () { rej(tx.error); };
            });
        });
    }
    function dbGet(id) {
        return idb().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction(DB_STORE, 'readonly');
                var q = tx.objectStore(DB_STORE).get(id);
                q.onsuccess = function () { res(q.result || null); };
                q.onerror = function () { rej(q.error); };
            });
        });
    }
    function dbDel(id) {
        return idb().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction(DB_STORE, 'readwrite');
                tx.objectStore(DB_STORE)['delete'](id);
                tx.oncomplete = function () { res(true); };
                tx.onerror = function () { rej(tx.error); };
            });
        });
    }
    function dbList() {
        return idb().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction(DB_STORE, 'readonly');
                var q = tx.objectStore(DB_STORE).getAll ? tx.objectStore(DB_STORE).getAll() : null;
                if (!q) { res([]); return; }
                q.onsuccess = function () {
                    // seznam bez geometrie — jinak by se do paměti natáhlo všechno naráz
                    res((q.result || []).map(function (r) {
                        return { id: r.id, name: r.name, bbox: r.bbox, ts: r.ts, n: (r.feats || []).length, bytes: r.bytes || 0 };
                    }));
                };
                q.onerror = function () { rej(q.error); };
            });
        })['catch'](function () { return []; });
    }

    // ---- stažení z Overpass --------------------------------------------------
    function kindOf(t) {
        if (!t) return null;
        if (t.building) return 'budova';
        if (t.waterway) return 'tok';
        if (t.natural === 'water' || t.landuse === 'reservoir') return 'voda';
        if (t.natural === 'wood' || t.landuse === 'forest') return 'les';
        if (t.landuse === 'meadow' || t.landuse === 'grass' || t.leisure === 'park') return 'louka';
        if (t.railway) return 'kolej';
        var h = t.highway;
        if (h) {
            if (h === 'motorway' || h === 'trunk' || h === 'primary' || h === 'secondary' || h === 'tertiary'
                || h === 'residential' || h === 'unclassified' || h === 'living_street'
                || /_link$/.test(h)) return 'silnice';
            if (h === 'track' || h === 'service') return 'cesta';
            return 'pesina';
        }
        return null;
    }
    // Douglas–Peucker; bez něj by se do IndexedDB ukládaly desetitisíce vrcholů,
    // které na mapě stejně padnou do jednoho pixelu.
    function simplify(pts, tolM) {
        if (pts.length < 3) return pts;
        var kx = Math.cos(pts[0][0] * Math.PI / 180) * 111320, ky = 111320;
        var tol2 = tolM * tolM;
        function seg(a, b, c) {
            var ax = a[1] * kx, ay = a[0] * ky, bx = b[1] * kx, by = b[0] * ky, cx = c[1] * kx, cy = c[0] * ky;
            var dx = cx - ax, dy = cy - ay, l2 = dx * dx + dy * dy;
            var t = l2 ? ((bx - ax) * dx + (by - ay) * dy) / l2 : 0;
            t = Math.max(0, Math.min(1, t));
            var px = ax + t * dx - bx, py = ay + t * dy - by;
            return px * px + py * py;
        }
        function rec(lo, hi, keep) {
            var maxD = -1, idx = -1;
            for (var i = lo + 1; i < hi; i++) {
                var d = seg(pts[lo], pts[i], pts[hi]);
                if (d > maxD) { maxD = d; idx = i; }
            }
            if (maxD > tol2 && idx > 0) { rec(lo, idx, keep); rec(idx, hi, keep); }
            else keep.push(hi);
        }
        var keep = [0];
        rec(0, pts.length - 1, keep);
        keep.sort(function (a, b) { return a - b; });
        var out = [];
        for (var i = 0; i < keep.length; i++) out.push(pts[keep[i]]);
        return out;
    }
    function dotaz(bb) {
        // bb = [jih, zapad, sever, vychod] — Overpass bere v tomhle pořadí
        var s = bb.join(',');
        return '[out:json][timeout:90];('
            + 'way["building"](' + s + ');'
            + 'way["highway"](' + s + ');'
            + 'way["railway"](' + s + ');'
            + 'way["waterway"](' + s + ');'
            + 'way["natural"~"^(water|wood)$"](' + s + ');'
            + 'way["landuse"~"^(forest|meadow|grass|reservoir)$"](' + s + ');'
            + 'way["leisure"="park"](' + s + ');'
            + ');out geom;';
    }
    function stahni(bb, name, progress) {
        var q = dotaz(bb);
        var idx = 0;
        function zkus() {
            if (idx >= OVERPASS.length) return Promise.reject(new Error('Overpass neodpověděl'));
            var url = OVERPASS[idx++];
            if (progress) progress('Stahuji z OpenStreetMap' + (idx > 1 ? ' (náhradní server)' : '') + '…');
            var ctrl = new AbortController();
            var t = setTimeout(function () { ctrl.abort(); }, 95000);
            return fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctrl.signal })
                .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                ['catch'](function (e) { clearTimeout(t); swallow(e, 'vm:stahni'); return zkus(); });
        }
        return zkus().then(function (j) {
            if (progress) progress('Zpracovávám…');
            var feats = [];
            var els = (j && j.elements) || [];
            for (var i = 0; i < els.length; i++) {
                var el = els[i];
                if (!el.geometry || el.geometry.length < 2) continue;
                var k = kindOf(el.tags);
                if (!k) continue;
                var pts = [];
                for (var g = 0; g < el.geometry.length; g++) {
                    var p = el.geometry[g];
                    pts.push([+p.lat.toFixed(6), +p.lon.toFixed(6)]);
                }
                pts = simplify(pts, SIMPL_M);
                if (pts.length < 2) continue;
                var f = { k: k, c: pts };
                if (el.tags && el.tags.name) f.n = el.tags.name;
                feats.push(f);
            }
            var rec = {
                id: 'o_' + Date.now(),
                name: name || 'Oblast',
                bbox: bb,
                ts: Date.now(),
                feats: feats
            };
            rec.bytes = JSON.stringify(rec.feats).length;
            return dbPut(rec).then(function () { return rec; });
        });
    }

    // ---- kreslicí vrstva -----------------------------------------------------
    function makeLayer() {
        if (typeof L === 'undefined' || !L.Layer) return null;
        var Vec = L.Layer.extend({
            onAdd: function (m) {
                this._m = m;
                var c = this._cv = document.createElement('canvas');
                c.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
                // pod značky bodů, nad podkladové dlaždice
                m.getPanes().overlayPane.appendChild(c);
                m.on('moveend zoomend resize', this._reset, this);
                // Během plynulého posunu se NEPŘEKRESLUJE (bylo by to trhané);
                // canvas se místo toho posune spolu s mapou a dokreslí se po dojetí.
                m.on('move', this._shift, this);
                this._reset();
            },
            onRemove: function (m) {
                m.off('moveend zoomend resize', this._reset, this);
                m.off('move', this._shift, this);
                if (this._cv && this._cv.parentNode) this._cv.parentNode.removeChild(this._cv);
                this._cv = null;
            },
            _shift: function () {
                if (!this._cv || !this._origin) return;
                var p = this._m.latLngToLayerPoint(this._origin);
                L.DomUtil.setPosition(this._cv, p);
            },
            _reset: function () {
                var m = this._m, c = this._cv;
                if (!m || !c) return;
                var size = m.getSize();
                var dpr = Math.min(window.devicePixelRatio || 1, 2);
                if (c.width !== Math.round(size.x * dpr) || c.height !== Math.round(size.y * dpr)) {
                    c.width = Math.round(size.x * dpr); c.height = Math.round(size.y * dpr);
                    c.style.width = size.x + 'px'; c.style.height = size.y + 'px';
                }
                this._origin = m.containerPointToLatLng([0, 0]);
                L.DomUtil.setPosition(c, m.latLngToLayerPoint(this._origin));
                this._draw(dpr);
            },
            _draw: function (dpr) {
                var m = this._m, c = this._cv;
                var g = c.getContext('2d');
                g.setTransform(dpr, 0, 0, dpr, 0, 0);
                g.clearRect(0, 0, c.width, c.height);
                if (!_feats.length) return;
                var z = m.getZoom();
                var b = m.getBounds().pad(0.15);
                var o = m.latLngToContainerPoint(this._origin);
                var alfa = _tlum ? 0.5 : 1;
                for (var pi = 0; pi < PORADI.length; pi++) {
                    var kind = PORADI[pi], st = KIND[kind];
                    if (!st || z < st.z) continue;
                    g.globalAlpha = alfa;
                    g.lineJoin = 'round'; g.lineCap = 'round';
                    g.setLineDash(st.dash || []);
                    g.strokeStyle = st.stroke || 'transparent';
                    g.fillStyle = st.fill || 'transparent';
                    // čáry sílí s přiblížením, ať mapa nevypadá v detailu prázdně
                    g.lineWidth = (st.w || 1) * (z >= 18 ? 1.8 : z >= 16 ? 1.35 : 1);
                    for (var i = 0; i < _feats.length; i++) {
                        var f = _feats[i];
                        if (f.k !== kind) continue;
                        var cs = f.c, n = cs.length;
                        // ořez: stačí testovat, jestli je aspoň jeden vrchol v okně
                        var vidno = false;
                        for (var t = 0; t < n; t += Math.max(1, (n / 8) | 0)) {
                            if (b.contains(cs[t])) { vidno = true; break; }
                        }
                        if (!vidno) continue;
                        g.beginPath();
                        for (var j = 0; j < n; j++) {
                            var p = m.latLngToContainerPoint(cs[j]);
                            var x = p.x - o.x, y = p.y - o.y;
                            if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
                        }
                        if (st.plocha) { g.closePath(); if (st.fill) g.fill(); }
                        if (st.stroke) g.stroke();
                    }
                }
                g.setLineDash([]);
                g.globalAlpha = 1;
            },
            redraw: function () { this._reset(); }
        });
        return new Vec();
    }

    function zapni() {
        var m = mapa();
        if (!m) { toast('Mapa ještě není připravená.'); return false; }
        if (!_layer) { _layer = makeLayer(); if (!_layer) { toast('Vektorová vrstva potřebuje Leaflet.'); return false; } }
        _map = m;
        if (!m.hasLayer(_layer)) _layer.addTo(m);
        try { localStorage.setItem(LS_ON, '1'); } catch (e) { swallow(e, 'vm:zapni'); }
        return true;
    }
    function vypni() {
        if (_layer && _map && _map.hasLayer(_layer)) { try { _map.removeLayer(_layer); } catch (e) { swallow(e, 'vm:vypni'); } }
        try { localStorage.setItem(LS_ON, '0'); } catch (e) { swallow(e, 'vm:vypni'); }
    }
    function jeZapnuta() { return !!(_layer && _map && _map.hasLayer(_layer)); }

    function nactiOblast(id) {
        return dbGet(id).then(function (rec) {
            if (!rec) { _feats = []; return null; }
            _feats = rec.feats || [];
            _aktId = rec.id;
            try { localStorage.setItem(LS_AKT, rec.id); } catch (e) { swallow(e, 'vm:nactiOblast'); }
            if (_layer && _layer.redraw) _layer.redraw();
            return rec;
        })['catch'](function (e) { swallow(e, 'vm:nactiOblast'); return null; });
    }

    // ---- UI ------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + MODAL_ID + ' .modal-content{max-width:520px;}',
            '.ag-vm-row{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.07);}',
            '.ag-vm-row b{display:block;font-size:calc(14px * var(--ag-font-scale, 1));}',
            '.ag-vm-row small{color:var(--text-muted,#9aa1ac);font-size:calc(11px * var(--ag-font-scale, 1));}',
            '.ag-vm-row .ag-vm-act{display:flex;gap:6px;flex:0 0 auto;}',
            '.ag-vm-row button{background:var(--surface-2,#1b2330);color:var(--text-color,#e6e8eb);border:1px solid rgba(255,255,255,0.10);',
            '  border-radius:9px;padding:6px 10px;font-size:calc(12px * var(--ag-font-scale, 1));}',
            '.ag-vm-row button.on{border-color:var(--accent,#2f9e74);background:rgba(47,158,116,0.2);font-weight:700;}',
            '.ag-vm-sw{display:flex;align-items:center;gap:9px;margin:4px 0 12px;font-size:calc(14px * var(--ag-font-scale, 1));}',
            '.ag-vm-sw input{width:18px;height:18px;accent-color:var(--accent,#2f9e74);}',
            '.ag-vm-note{color:var(--text-muted,#9aa1ac);font-size:calc(12px * var(--ag-font-scale, 1));line-height:1.45;margin:12px 0 0;}',
            '.ag-vm-stav{color:var(--accent,#2f9e74);font-size:calc(13px * var(--ag-font-scale, 1));min-height:1.2em;margin:8px 0 0;}',
            '.ag-vm-vyrez{background:rgba(47,158,116,0.10);border:1px solid rgba(47,158,116,0.28);border-radius:12px;padding:10px 12px;margin:0 0 12px;',
            '  font-size:calc(13px * var(--ag-font-scale, 1));line-height:1.5;}'
        ].join('\n');
        document.head.appendChild(st);
    }
    function ensureModal() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = MODAL_ID;
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Vektorová mapa offline</h3>' +
            '  <div id="ag-vm-body"></div>' +
            '  <div class="ag-vm-stav" id="ag-vm-stav"></div>' +
            '  <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
            '    <button type="button" class="btn btn-primary" id="ag-vm-sbal">Sbalit tento výřez</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-vm-close">Zavřít</button>' +
            '  </div>' +
            '  <p class="ag-vm-note">Data © přispěvatelé OpenStreetMap (ODbL). Je to podklad pro ORIENTACI, ne měřický podklad — poloha prvků v OSM není zaručená a neodečítej z ní souřadnice.</p>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-vm-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-vm-sbal').addEventListener('click', sbalVyrez);
        return m;
    }
    function stav(t) { var el = document.getElementById('ag-vm-stav'); if (el) el.textContent = t || ''; }

    function vyrez() {
        var m = mapa(); if (!m) return null;
        var b = m.getBounds();
        var jih = b.getSouth(), sev = b.getNorth(), zap = b.getWest(), vych = b.getEast();
        var vyskaKm = (sev - jih) * 111.32;
        var sirkaKm = (vych - zap) * 111.32 * Math.cos((sev + jih) / 2 * Math.PI / 180);
        return { bb: [jih, zap, sev, vych], km2: Math.abs(vyskaKm * sirkaKm), sirka: Math.abs(sirkaKm), vyska: Math.abs(vyskaKm) };
    }
    function sbalVyrez() {
        if (_busy) return;
        var v = vyrez();
        if (!v) { toast('Mapa ještě není připravená.'); return; }
        if (v.km2 > MAX_KM2) {
            stav('Výřez je moc velký (' + v.km2.toFixed(1) + ' km²). Přibliž mapu — strop je ' + MAX_KM2 + ' km².');
            return;
        }
        var nazev = null;
        try { nazev = window.prompt('Název oblasti:', 'Oblast ' + new Date().toLocaleDateString('cs-CZ')); }
        catch (e) { swallow(e, 'vm:sbalVyrez'); }
        if (nazev === null) return;
        _busy = true;
        var btn = document.getElementById('ag-vm-sbal'); if (btn) btn.disabled = true;
        stahni(v.bb, nazev || 'Oblast', stav).then(function (rec) {
            _busy = false; if (btn) btn.disabled = false;
            stav('Sbaleno: ' + rec.feats.length + ' prvků, ' + fmtMB(rec.bytes) + '.');
            toast('Oblast „' + rec.name + '“ je v telefonu.');
            return nactiOblast(rec.id).then(function () { zapni(); render(); });
        })['catch'](function (e) {
            _busy = false; if (btn) btn.disabled = false;
            swallow(e, 'vm:sbalVyrez');
            stav('Nepodařilo se stáhnout: ' + (e && e.message || e) + ' — zkus to znovu, Overpass bývá občas přetížený.');
        });
    }

    function render() {
        var m = ensureModal();
        var body = m.querySelector('#ag-vm-body');
        var v = vyrez();
        var h = '';

        h += '<div class="ag-vm-sw"><input type="checkbox" id="ag-vm-on"' + (jeZapnuta() ? ' checked' : '') + '>'
            + '<label for="ag-vm-on">Kreslit vektorovou mapu do podkladu</label></div>';
        h += '<div class="ag-vm-sw"><input type="checkbox" id="ag-vm-tlum"' + (_tlum ? ' checked' : '') + '>'
            + '<label for="ag-vm-tlum">Ztlumit barvy (na slunci a v noci)</label></div>';

        if (v) {
            h += '<div class="ag-vm-vyrez"><b>Co je teď v mapě:</b> ' + v.sirka.toFixed(2).replace('.', ',') + ' × '
                + v.vyska.toFixed(2).replace('.', ',') + ' km (' + v.km2.toFixed(2).replace('.', ',') + ' km²)'
                + (v.km2 > MAX_KM2 ? '<br><span style="color:#fbbf24">Nad strop ' + MAX_KM2 + ' km² — přibliž mapu.</span>' : '')
                + '<br><small>Posuň a přibliž mapu tam, kam pojedeš, a ťukni na „Sbalit tento výřez“. GPS k tomu není potřeba.</small></div>';
        }
        h += '<div id="ag-vm-list"><p class="ag-vm-note">Načítám sbalené oblasti…</p></div>';
        body.innerHTML = h;

        body.querySelector('#ag-vm-on').addEventListener('change', function () {
            if (this.checked) { if (!zapni()) { this.checked = false; return; } if (!_feats.length && _aktId) nactiOblast(_aktId); }
            else vypni();
        });
        body.querySelector('#ag-vm-tlum').addEventListener('change', function () {
            _tlum = this.checked;
            if (_layer && _layer.redraw) _layer.redraw();
        });

        dbList().then(function (list) {
            var el = document.getElementById('ag-vm-list');
            if (!el) return;
            if (!list.length) {
                el.innerHTML = '<p class="ag-vm-note">Zatím nemáš sbalenou žádnou oblast. Nastav si v mapě výřez a ťukni dole na „Sbalit tento výřez“ — pak už funguje bez signálu.</p>';
                return;
            }
            list.sort(function (a, b) { return b.ts - a.ts; });
            var hh = '<h4 style="margin:14px 0 4px;font-size:calc(13px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);">Sbalené oblasti</h4>';
            list.forEach(function (o) {
                hh += '<div class="ag-vm-row"><div><b>' + esc(o.name) + '</b>'
                    + '<small>' + o.n + ' prvků · ' + fmtMB(o.bytes) + ' · ' + new Date(o.ts).toLocaleDateString('cs-CZ') + '</small></div>'
                    + '<div class="ag-vm-act">'
                    + '<button type="button" data-use="' + esc(o.id) + '"' + (o.id === _aktId ? ' class="on"' : '') + '>' + (o.id === _aktId ? 'Používá se' : 'Použít') + '</button>'
                    + '<button type="button" data-del="' + esc(o.id) + '" aria-label="Smazat">✕</button>'
                    + '</div></div>';
            });
            el.innerHTML = hh;
            var bs = el.querySelectorAll('button[data-use]');
            for (var i = 0; i < bs.length; i++) {
                bs[i].addEventListener('click', function () {
                    var id = this.getAttribute('data-use');
                    stav('Načítám…');
                    nactiOblast(id).then(function (rec) {
                        if (!rec) { stav('Oblast se nepodařilo načíst.'); return; }
                        zapni();
                        var sw = document.getElementById('ag-vm-on'); if (sw) sw.checked = true;
                        stav('Kreslím „' + rec.name + '“ — ' + (rec.feats || []).length + ' prvků.');
                        render();
                    });
                });
            }
            var ds = el.querySelectorAll('button[data-del]');
            for (var k = 0; k < ds.length; k++) {
                ds[k].addEventListener('click', function () {
                    var id = this.getAttribute('data-del');
                    var ok = true;
                    try { ok = window.confirm('Smazat sbalenou oblast? Bez signálu už ji nepůjde obnovit.'); } catch (e) { swallow(e, 'vm:del'); }
                    if (!ok) return;
                    dbDel(id).then(function () {
                        if (_aktId === id) { _feats = []; _aktId = null; if (_layer && _layer.redraw) _layer.redraw(); }
                        render();
                    });
                });
            }
        });
        m.style.display = 'flex';
    }

    function open() { render(); }

    // ================================================================
    //  init
    // ================================================================
    // Po startu se vrstva sama obnoví, pokud si ji uživatel nechal zapnutou —
    // bez toho by po každém spuštění appky zmizel podklad, na který si zvykl.
    function obnov() {
        var zap = false;
        try { zap = localStorage.getItem(LS_ON) === '1'; } catch (e) { swallow(e, 'vm:obnov'); }
        if (!zap) return;
        var id = null;
        try { id = localStorage.getItem(LS_AKT); } catch (e) { swallow(e, 'vm:obnov'); }
        if (!id) return;
        nactiOblast(id).then(function (rec) { if (rec) zapni(); });
    }

    var _tries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'vektor-mapa', label: 'Vektorová mapa offline', icon: ICON, onClick: open, order: 14 });
            return true;
        }
        return false;
    }
    function init() {
        if (!register() && _tries++ < 20) setTimeout(init, 500);
        // mapa vzniká v logika.js až po startu — počkat, než na ni sáhneme
        var n = 0;
        var iv = setInterval(function () {
            if (mapa() || ++n > 40) { clearInterval(iv); if (mapa()) obnov(); }
        }, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGVektorMapa = { open: open, zapni: zapni, vypni: vypni, nactiOblast: nactiOblast, seznam: dbList };
})();
