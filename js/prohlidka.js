// ===== AR Geodet — PROHLÍDKOVÝ REŽIM: „co je kolem mě" (ODPOJITELNÁ vrstva) ====
// Neinvazivní vrstva ve stylu js/cadastre-vector.js: NEEDITUJE logika.js ani
// grafika.js. Jen čte globály přes typeof-guardy, kreslí do vlastní <svg>
// v #ar-overlay a registruje si vlastní dlaždici.
//
// PROČ TENHLE REŽIM VŮBEC JE: celá appka je postavená na TOM, ŽE MÁŠ PRÁCI —
// zakázku, body, vytyčovací seznam. Jenže nejsilnější věc, kterou umí, je
// „zvedni telefon a uvidíš hranice pozemků" — a k té se dneska člověk dostane
// až přes založení zakázky a stažení parcel do ní. Pro zvědavé rozhlédnutí
// (o víkendu, z okna, když někomu chceš ukázat, kudy vede plot) je to moc
// překážek a data by se navíc lepila do zakázky, kam nepatří.
//
// Prohlídka tenhle strop odstraňuje: otevře se jedním klepnutím, NIC nezakládá,
// NIC neukládá do zakázky a neumí měřit. Odpovídá na jedinou otázku:
//     KDE STOJÍM A CO JE KOLEM.
//   • parcela pod nohama — číslo, druh pozemku, výměra, katastrální území,
//   • jak daleko je nejbližší hranice a kterým směrem,
//   • nadmořská výška (DMR 5G z js/dmr-terrain.js, jinak z GPS),
//   • slunce — kde právě je a za jak dlouho zapadne (js/slunce.js),
//   • V KAMEŘE hranice parcel + POPISKY s číslem parcely nad jejich plochou.
//
// ČÍM SE LIŠÍ OD „Katastr — parcely" (js/cadastre-vector.js), ať to nejsou dva
// nástroje na totéž: ten je PRACOVNÍ — ukládá parcely do zakázky, umí navigovat
// na lomový bod, uloží ho jako bod a kreslí v AR samotné hrany. Prohlídka je
// PROHLÍŽECÍ: drží si vlastní dočasnou zásobu MIMO zakázku (klíč je globální,
// ne per zakázka), neumí uložit ani jeden bod, a v AR kreslí hlavně POPISKY
// parcel (číslo + druh nad plochou), protože to je celé, co má režim říct.
// Když běží obojí naráz, hrany se překreslí dvakrát — proto si prohlídka kreslí
// do VLASTNÍ svg vrstvy a hrany drží slabší, aby pracovní vrstva zůstala navrch.
//
// FUNGUJE I JAKO HOST (bez přihlášení) — je to prohlížení veřejných dat ČÚZK,
// žádná data zakázky se nečtou ani nezapisují.
//
// POCTIVĚ: „stojíš na parcele X" je jen tak dobré, jak dobrá je poloha z mobilu.
// U hranice, kde jde o metry, panel PŘESTANE tvrdit jistotu a řekne „na hranici
// parcel X a Y — GPS má přesnost ±N m". Bez toho by režim vypadal jako měření,
// kterým není.
//
// Zdroj: RÚIAN Prohlížecí služba ČÚZK, vrstva 5 „Parcela". Data © ČÚZK.
// Odstranění: smaž js/prohlidka.js + řádek <script> v index.html, záznam
// 'prohlidka' v js/tools-registry.js a jeho text v data/navody.json
// (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGProhlidka) return;

    var STYLE_ID = 'ag-ph-style';
    var PANEL_ID = 'ag-ph-panel';
    var LS_CACHE = 'agProhlidkaCache_v1';   // ZÁMĚRNĚ globální klíč, ne per zakázka
    var SVC = 'https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/5/query';
    var RADIUS = 350;          // m — co se stáhne kolem tebe
    var REFETCH_M = 200;       // po kolika metrech chůze se sáhne pro nová data
    var EDGE = '#7dd3fc', LABEL = '#e0f2fe';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';

    var _on = false;
    var _parcels = [];         // [{id,cislo,vymera,druh,ku,rings:[[{lat,lng}]]}]
    var _origin = null;        // kolem čeho je zásoba stažená {lat,lng}
    var _busy = false;
    var _svg = null, _raf = null, _idleT = 0;
    var _tick = null;
    var _here = null;          // { parcel, second, edge:{d,brg} }

    // ---- pomocné -------------------------------------------------------------
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'prohlidka'); } catch (err) { /* nic */ } }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : void 0); } catch (e) { swallow(e, 'prohlidka:toast'); } }
    function esc(s) {
        return (window.AG && AG.esc) ? AG.esc(s)
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function uLat() { return userLat; }
    function uLng() { return userLng; }
    function acc() { try { return (typeof currentGpsAccuracy === 'number' && isFinite(currentGpsAccuracy)) ? currentGpsAccuracy : null; } catch (e) { return null; } }
    function dist(la1, lo1, la2, lo2) {
        if (typeof getDistance === 'function') { try { return getDistance(la1, lo1, la2, lo2); } catch (e) { swallow(e, 'prohlidka:dist'); } }
        var R = 6371000, t1 = la1 * Math.PI / 180, t2 = la2 * Math.PI / 180;
        var dt = (la2 - la1) * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
        var a = Math.sin(dt / 2) * Math.sin(dt / 2) + Math.cos(t1) * Math.cos(t2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    function brg(la1, lo1, la2, lo2) {
        if (typeof getBearing === 'function') { try { return getBearing(la1, lo1, la2, lo2); } catch (e) { swallow(e, 'prohlidka:brg'); } }
        var t1 = la1 * Math.PI / 180, t2 = la2 * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
        var y = Math.sin(dl) * Math.cos(t2);
        var x = Math.cos(t1) * Math.sin(t2) - Math.sin(t1) * Math.cos(t2) * Math.cos(dl);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }
    var SMERY = ['sever', 'severovýchod', 'východ', 'jihovýchod', 'jih', 'jihozápad', 'západ', 'severozápad'];
    function smer(b) { return SMERY[Math.round(((b % 360) + 360) % 360 / 45) % 8]; }

    // druh pozemku podle číselníku ČÚZK — bez toho je v panelu jen holé číslo
    var DRUH = {
        2: 'orná půda', 3: 'chmelnice', 4: 'vinice', 5: 'zahrada', 6: 'ovocný sad',
        7: 'trvalý travní porost', 10: 'lesní pozemek', 11: 'vodní plocha',
        13: 'zastavěná plocha a nádvoří', 14: 'ostatní plocha'
    };
    function druhTxt(k) { var n = parseInt(k, 10); return DRUH[n] || (k ? 'druh ' + k : null); }

    // ---- geometrie -----------------------------------------------------------
    // Bod v polygonu (ray casting). Pracuje v zeměpisných stupních — na ploše
    // jedné parcely je zakřivení Země bez významu.
    function inRing(lat, lng, ring) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var yi = ring[i].lat, xi = ring[i].lng, yj = ring[j].lat, xj = ring[j].lng;
            if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
        }
        return inside;
    }
    function inParcel(lat, lng, p) {
        // první prstenec je vnější, další jsou díry
        if (!p.rings || !p.rings.length) return false;
        if (!inRing(lat, lng, p.rings[0])) return false;
        for (var i = 1; i < p.rings.length; i++) if (inRing(lat, lng, p.rings[i])) return false;
        return true;
    }
    // Vzdálenost k nejbližší hranici + azimut na nejbližší místo hranice.
    // Počítá se v LOKÁLNÍ ROVINĚ (metry) — vzdálenost bod–úsečka v zeměpisných
    // stupních by na naší šířce byla o třetinu vedle (stupeň délky je kratší).
    function nearestEdge(lat, lng, p) {
        var kx = Math.cos(lat * Math.PI / 180) * 111320, ky = 111320;
        var best = null;
        (p.rings || []).forEach(function (r) {
            for (var i = 0; i + 1 < r.length; i++) {
                var ax = (r[i].lng - lng) * kx, ay = (r[i].lat - lat) * ky;
                var bx = (r[i + 1].lng - lng) * kx, by = (r[i + 1].lat - lat) * ky;
                var dx = bx - ax, dy = by - ay;
                var len2 = dx * dx + dy * dy;
                var t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
                t = Math.max(0, Math.min(1, t));
                var px = ax + t * dx, py = ay + t * dy;
                var d = Math.sqrt(px * px + py * py);
                if (!best || d < best.d) best = { d: d, x: px, y: py };
            }
        });
        if (!best) return null;
        var b = (Math.atan2(best.x, best.y) * 180 / Math.PI + 360) % 360;
        return { d: best.d, brg: b };
    }
    function centroid(p) {
        var r = (p.rings && p.rings[0]) || [];
        if (!r.length) return null;
        var sLat = 0, sLng = 0, n = 0;
        for (var i = 0; i < r.length; i++) { sLat += r[i].lat; sLng += r[i].lng; n++; }
        return n ? { lat: sLat / n, lng: sLng / n } : null;
    }

    // ---- data ----------------------------------------------------------------
    function fetchTO(url, ms) {
        if (typeof fetchWithTimeout === 'function') return fetchWithTimeout(url, ms);
        var ctrl = new AbortController(); var t = setTimeout(function () { ctrl.abort(); }, ms || 15000);
        return fetch(url, { signal: ctrl.signal })['finally'](function () { clearTimeout(t); });
    }
    function bbox(lat, lng, radius) {
        var dLat = radius / 111320, dLng = radius / (111320 * Math.cos(lat * Math.PI / 180));
        return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
    }
    function buildUrl(bb) {
        var q = {
            where: '1=1', geometry: bb.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
            spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'true', f: 'json',
            outFields: 'cisloparcely,vymeraparcely,druhpozemkukod,katastralniuzemi,id',
            resultRecordCount: '600', resultOffset: '0'
        };
        return SVC + '?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
    }
    function esriToParcel(f) {
        var a = f.attributes || {};
        var rings = (f.geometry && f.geometry.rings) ? f.geometry.rings.map(function (r) {
            return r.map(function (c) { return { lat: +c[1].toFixed(7), lng: +c[0].toFixed(7) }; });
        }) : [];
        return { id: a.id || a.objectid, cislo: a.cisloparcely || '?', vymera: a.vymeraparcely || null, druh: a.druhpozemkukod || null, ku: a.katastralniuzemi || null, rings: rings };
    }
    function loadCache() {
        try {
            var o = JSON.parse(localStorage.getItem(LS_CACHE));
            if (o && Array.isArray(o.p) && o.o) { _parcels = o.p; _origin = o.o; }
        } catch (e) { swallow(e, 'prohlidka:loadCache'); }
    }
    function saveCache() {
        try { localStorage.setItem(LS_CACHE, JSON.stringify({ p: _parcels, o: _origin, t: Date.now() })); }
        catch (e) { swallow(e, 'prohlidka:saveCache'); }   // plný localStorage: prohlídka jede dál, jen se příště stáhne znovu
    }
    function needFetch() {
        if (!_parcels.length || !_origin) return true;
        if (!haveUser()) return false;
        return dist(uLat(), uLng(), _origin.lat, _origin.lng) > REFETCH_M;
    }
    function fetchAround(done) {
        if (_busy || !haveUser()) { if (done) done(false); return; }
        _busy = true; setStatus('Dívám se do katastru…');
        var bb = bbox(uLat(), uLng(), RADIUS);
        var oLat = uLat(), oLng = uLng();
        fetchTO(buildUrl(bb), 15000).then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.error) throw new Error(j.error.message || 'ČÚZK chyba');
            var feats = (j && j.features) || [];
            _parcels = feats.map(esriToParcel);
            _origin = { lat: oLat, lng: oLng };
            saveCache();
            _busy = false; setStatus('');
            if (done) done(true);
        })['catch'](function (e) {
            _busy = false; setStatus('');
            swallow(e, 'prohlidka:fetch');
            // Offline nebo ČÚZK mimo provoz: když je v zásobě něco z minula,
            // režim jede dál z ní — jen se to napíše, ať to není tichá lež.
            if (_parcels.length) setStatus('Bez signálu — ukazuji naposled stažené okolí');
            else setStatus('Katastr se nepodařilo stáhnout. Zkus to s připojením.');
            if (done) done(false);
        });
    }

    // ---- kde stojím ----------------------------------------------------------
    function whereAmI() {
        _here = null;
        if (!haveUser() || !_parcels.length) return;
        var on = null, near = [];
        for (var i = 0; i < _parcels.length; i++) {
            var p = _parcels[i];
            if (!on && inParcel(uLat(), uLng(), p)) { on = p; continue; }
            var e = nearestEdge(uLat(), uLng(), p);
            if (e && e.d < 30) near.push({ p: p, d: e.d });
        }
        if (!on) {
            near.sort(function (a, b) { return a.d - b.d; });
            if (!near.length) return;
            _here = { parcel: near[0].p, second: near[1] ? near[1].p : null, edge: { d: near[0].d, brg: nearestEdge(uLat(), uLng(), near[0].p).brg }, outside: true };
            return;
        }
        var eg = nearestEdge(uLat(), uLng(), on);
        // Když je hranice blíž, než kam sahá přesnost GPS, appka NESMÍ tvrdit,
        // na které parcele stojíš — vedle je stejně pravděpodobná.
        var a = acc();
        var jistota = !(a != null && eg && eg.d < a);
        near.sort(function (x, y) { return x.d - y.d; });
        _here = { parcel: on, second: (!jistota && near.length) ? near[0].p : null, edge: eg, jistota: jistota };
    }

    // ---- panel ---------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + PANEL_ID + '{position:fixed;left:0;right:0;bottom:0;z-index:99992;',
            '  background:linear-gradient(180deg, rgba(8,14,24,0.72) 0%, rgba(8,14,24,0.94) 42%);',
            '  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
            '  border-top:1px solid rgba(125,211,252,0.28);border-radius:20px 20px 0 0;',
            '  padding:14px 16px calc(14px + env(safe-area-inset-bottom, 0px));color:#e6f2fb;',
            '  font-size:calc(14px * var(--ag-font-scale, 1));box-shadow:0 -10px 34px rgba(0,0,0,0.5);}',
            '#' + PANEL_ID + '.ag-ph-min{padding-bottom:calc(8px + env(safe-area-inset-bottom, 0px));}',
            '#' + PANEL_ID + '.ag-ph-min .ag-ph-body,#' + PANEL_ID + '.ag-ph-min .ag-ph-foot{display:none;}',
            '.ag-ph-top{display:flex;align-items:center;gap:10px;}',
            '.ag-ph-eyebrow{color:#7dd3fc;font-weight:700;letter-spacing:0.08em;font-size:calc(11px * var(--ag-font-scale, 1));text-transform:uppercase;}',
            '.ag-ph-x{margin-left:auto;background:transparent;border:none;color:#9fb6c9;font-size:calc(22px * var(--ag-font-scale, 1));line-height:1;padding:2px 6px;}',
            '.ag-ph-min-btn{background:transparent;border:none;color:#9fb6c9;font-size:calc(18px * var(--ag-font-scale, 1));line-height:1;padding:2px 6px;}',
            '.ag-ph-h{font-size:calc(21px * var(--ag-font-scale, 1));font-weight:800;margin:4px 0 2px;line-height:1.22;}',
            '.ag-ph-sub{color:#9fb6c9;font-size:calc(13px * var(--ag-font-scale, 1));margin-bottom:10px;}',
            '.ag-ph-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px;}',
            '.ag-ph-c{background:rgba(255,255,255,0.055);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:8px 10px;}',
            '.ag-ph-c b{display:block;font-size:calc(17px * var(--ag-font-scale, 1));font-weight:800;}',
            '.ag-ph-c span{color:#9fb6c9;font-size:calc(11px * var(--ag-font-scale, 1));}',
            '.ag-ph-warn{margin-top:9px;color:#fcd34d;font-size:calc(12px * var(--ag-font-scale, 1));line-height:1.4;}',
            '.ag-ph-foot{display:flex;gap:8px;margin-top:11px;}',
            '.ag-ph-foot button{flex:1;background:rgba(125,211,252,0.14);color:#e6f2fb;border:1px solid rgba(125,211,252,0.3);',
            '  border-radius:11px;padding:9px 8px;font-size:calc(13px * var(--ag-font-scale, 1));font-weight:600;}',
            '.ag-ph-foot button:active{background:rgba(125,211,252,0.26);}',
            '.ag-ph-status{color:#9fb6c9;font-size:calc(12px * var(--ag-font-scale, 1));margin-top:6px;min-height:1em;}'
        ].join('\n');
        document.head.appendChild(st);
    }
    function setStatus(t) {
        var el = document.getElementById('ag-ph-status');
        if (el) el.textContent = t || '';
    }
    function ensurePanel() {
        var el = document.getElementById(PANEL_ID);
        if (el) return el;
        injectStyles();
        el = document.createElement('div');
        el.id = PANEL_ID;
        el.innerHTML =
            '<div class="ag-ph-top">' +
            '  <span class="ag-ph-eyebrow">Prohlídka okolí</span>' +
            '  <button type="button" class="ag-ph-min-btn" id="ag-ph-min" aria-label="Sbalit">▾</button>' +
            '  <button type="button" class="ag-ph-x" id="ag-ph-close" aria-label="Zavřít prohlídku">×</button>' +
            '</div>' +
            '<div class="ag-ph-body" id="ag-ph-body"></div>' +
            '<div class="ag-ph-foot">' +
            '  <button type="button" id="ag-ph-refresh">Načíst okolí znovu</button>' +
            '  <button type="button" id="ag-ph-cam">Ukázat v kameře</button>' +
            '</div>';
        document.body.appendChild(el);
        el.querySelector('#ag-ph-close').addEventListener('click', close);
        el.querySelector('#ag-ph-min').addEventListener('click', function () {
            el.classList.toggle('ag-ph-min');
            this.textContent = el.classList.contains('ag-ph-min') ? '▴' : '▾';
        });
        el.querySelector('#ag-ph-refresh').addEventListener('click', function () {
            _origin = null;
            fetchAround(function () { whereAmI(); renderPanel(); });
        });
        el.querySelector('#ag-ph-cam').addEventListener('click', toAr);
        return el;
    }
    function toAr() {
        // Přepnout hlavní obrazovku na kameru. setView() je globální funkce
        // z index.html; když by nebyla, jen se to řekne.
        try {
            if (typeof setView === 'function') {
                var btn = document.querySelector('#view-seg .seg-btn');
                setView('ar', btn || null);
                toast('Zvedni telefon a rozhlédni se.');
                return;
            }
        } catch (e) { swallow(e, 'prohlidka:toAr'); }
        toast('Přepni si nahoře zobrazení na kameru.');
    }

    function fmtM(v) { return v >= 100 ? Math.round(v) + ' m' : (Math.round(v * 10) / 10).toFixed(1).replace('.', ',') + ' m'; }
    function vyska() {
        if (!haveUser()) return null;
        try {
            if (typeof window.terrainElev === 'function') {
                var e = window.terrainElev(uLat(), uLng());
                if (e != null && isFinite(e)) return { v: e, src: 'DMR 5G' };
            }
        } catch (e2) { swallow(e2, 'prohlidka:vyska'); }
        try {
            if (typeof userAlt === 'number' && isFinite(userAlt)) return { v: userAlt, src: 'GPS' };
        } catch (e3) { swallow(e3, 'prohlidka:vyska'); }
        return null;
    }
    function slunce() {
        if (!haveUser() || !window.AGSun) return null;
        try {
            var now = new Date();
            var p = AGSun.pos(now, uLat(), uLng());
            var t = AGSun.times(now, uLat(), uLng(), 90.833);
            var out = { alt: p && p.alt, az: p && p.az, set: t && t.set, rise: t && t.rise };
            return out;
        } catch (e) { swallow(e, 'prohlidka:slunce'); return null; }
    }
    function hhmm(d) { return d ? (d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes()) : null; }

    function renderPanel() {
        var el = document.getElementById(PANEL_ID);
        if (!el) return;
        var body = el.querySelector('#ag-ph-body');
        if (!body) return;
        var h = '';

        if (!haveUser()) {
            h = '<div class="ag-ph-h">Čekám na GPS</div>'
                + '<div class="ag-ph-sub">Prohlídka potřebuje vědět, kde stojíš. Venku to bývá pár vteřin.</div>';
            body.innerHTML = h + '<div class="ag-ph-status" id="ag-ph-status"></div>';
            return;
        }

        var p = _here && _here.parcel;
        if (!p) {
            h = '<div class="ag-ph-h">' + (_parcels.length ? 'Tady katastr parcelu nenašel' : 'Zatím nemám data okolí') + '</div>'
                + '<div class="ag-ph-sub">' + (_parcels.length ? 'Zkus popojít pár kroků nebo načíst okolí znovu.' : 'Ťukni na „Načíst okolí znovu“.') + '</div>';
            body.innerHTML = h + '<div class="ag-ph-status" id="ag-ph-status"></div>';
            return;
        }

        var nadpis = _here.outside ? ('Nejblíž je parcela ' + esc(p.cislo)) : ('Stojíš na parcele ' + esc(p.cislo));
        if (!_here.jistota && !_here.outside && _here.second) nadpis = 'Na hranici parcel ' + esc(p.cislo) + ' a ' + esc(_here.second.cislo);
        h += '<div class="ag-ph-h">' + nadpis + '</div>';
        var subs = [];
        if (druhTxt(p.druh)) subs.push(druhTxt(p.druh));
        if (p.ku) subs.push('k. ú. ' + esc(p.ku));
        h += '<div class="ag-ph-sub">' + (subs.join(' · ') || '&nbsp;') + '</div>';

        h += '<div class="ag-ph-grid">';
        if (p.vymera) h += '<div class="ag-ph-c"><b>' + Number(p.vymera).toLocaleString('cs-CZ') + ' m²</b><span>výměra parcely</span></div>';
        if (_here.edge) h += '<div class="ag-ph-c"><b>' + fmtM(_here.edge.d) + '</b><span>k hranici na ' + smer(_here.edge.brg) + '</span></div>';
        var v = vyska();
        if (v) h += '<div class="ag-ph-c"><b>' + Math.round(v.v) + ' m n. m.</b><span>výška — ' + v.src + '</span></div>';
        var s = slunce();
        if (s && s.alt != null) {
            var sTxt = (s.alt > 0 && s.set) ? ('západ ' + hhmm(s.set)) : (s.rise ? ('východ ' + hhmm(s.rise)) : '');
            h += '<div class="ag-ph-c"><b>' + Math.round(s.alt) + '° ' + (s.az != null ? smer(s.az) : '') + '</b><span>slunce' + (sTxt ? ' · ' + sTxt : '') + '</span></div>';
        }
        h += '</div>';

        var a = acc();
        if (!_here.jistota && !_here.outside) {
            h += '<div class="ag-ph-warn">Hranice je blíž než přesnost GPS (±' + Math.round(a) + ' m) — která z parcel to je, appka poctivě neví.</div>';
        }
        h += '<div class="ag-ph-status" id="ag-ph-status"></div>';
        body.innerHTML = h;
    }

    // ---- AR: popisky parcel + slabé hrany ------------------------------------
    function ensureSvg() {
        var ov = document.getElementById('ar-overlay'); if (!ov) return null;
        if (!_svg) {
            _svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            _svg.setAttribute('viewBox', '0 0 100 100');
            _svg.setAttribute('preserveAspectRatio', 'none');
            _svg.id = 'ag-ph-svg';
            _svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
            ov.insertBefore(_svg, ov.firstChild);
        }
        return _svg;
    }
    // Projekce bodu na obrazovku — stejná matematika, jakou používá appka
    // (window._arProj plní grafika.js každý snímek).
    function projAR(lat, lng, heading, pj, eyeH, vOff) {
        var d = dist(uLat(), uLng(), lat, lng);
        var b = brg(uLat(), uLng(), lat, lng);
        var diff = ((b - heading + 540) % 360) - 180;
        var uH = diff, vV = Math.atan2(eyeH, Math.max(d, 0.5)) * 180 / Math.PI - pj.pitch;
        if (pj.roll) { var cr = Math.cos(pj.roll), sr = Math.sin(pj.roll); var tt = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = tt; }
        return { x: 50 + (uH / pj.halfH) * 50, y: 50 + (vV / pj.halfV) * 50 - vOff, diff: diff, dist: d };
    }
    var _lastH = null, _lastP = null, _lastLat = null, _lastLng = null;
    function arLoop() {
        var svg = _svg;
        // Stejná úspora jako v js/cadastre-vector.js: bez čeho kreslit se smyčka
        // stáhne na 3 snímky za vteřinu, ať se mobil nehřeje v mapě a na pozadí.
        if (!svg || !_on || !_parcels.length || !haveUser() || !window._arProj
            || (typeof viewMode !== 'undefined' && viewMode === 'map')
            || document.visibilityState !== 'visible') {
            if (svg && svg.childNodes.length) svg.innerHTML = '';
            _lastH = null; _raf = null;
            _idleT = setTimeout(function () { _idleT = 0; if (!_raf && _on) _raf = requestAnimationFrame(arLoop); }, 300);
            return;
        }
        _raf = requestAnimationFrame(arLoop);
        var pj = window._arProj;
        var heading = (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null;
        if (heading == null) { if (svg.childNodes.length) svg.innerHTML = ''; _lastH = null; return; }
        var pitch = pj.pitch || 0;
        if (_lastH != null && Math.abs(heading - _lastH) < 0.3 && Math.abs(pitch - (_lastP || 0)) < 0.3 && _lastLat === uLat() && _lastLng === uLng()) return;
        _lastH = heading; _lastP = pitch; _lastLat = uLat(); _lastLng = uLng();

        var eyeH = 1.6, vOff = 0;
        try { eyeH = visSettings.eyeHeight || 1.6; vOff = visSettings.arVerticalOffset || 0; } catch (e) { swallow(e, 'prohlidka:arLoop'); }
        var html = '', labels = '';
        for (var i = 0; i < _parcels.length; i++) {
            var p = _parcels[i];
            // hrany — slabě, aby zůstaly podkladem pro popisek
            for (var ri = 0; ri < p.rings.length; ri++) {
                var r = p.rings[ri];
                for (var k = 0; k + 1 < r.length; k++) {
                    var da = dist(uLat(), uLng(), r[k].lat, r[k].lng);
                    var db = dist(uLat(), uLng(), r[k + 1].lat, r[k + 1].lng);
                    if (Math.min(da, db) > 160) continue;
                    var pa = projAR(r[k].lat, r[k].lng, heading, pj, eyeH, vOff);
                    var pb = projAR(r[k + 1].lat, r[k + 1].lng, heading, pj, eyeH, vOff);
                    if (Math.abs(pa.diff) > 100 || Math.abs(pb.diff) > 100) continue;
                    html += '<line x1="' + pa.x.toFixed(2) + '" y1="' + pa.y.toFixed(2) + '" x2="' + pb.x.toFixed(2) + '" y2="' + pb.y.toFixed(2)
                        + '" stroke="' + EDGE + '" stroke-width="1.6" stroke-linecap="round" opacity="0.5" vector-effect="non-scaling-stroke"/>';
                }
            }
            // popisek nad těžištěm — to je celý smysl prohlídky
            var c = centroid(p);
            if (!c) continue;
            var dc = dist(uLat(), uLng(), c.lat, c.lng);
            if (dc > 160) continue;
            var pc = projAR(c.lat, c.lng, heading, pj, eyeH, vOff);
            if (Math.abs(pc.diff) > 55) continue;
            var t2 = esc(p.cislo) + (p.vymera ? ('  ·  ' + Math.round(p.vymera) + ' m²') : '');
            var wpx = 3.2 + t2.length * 1.05;
            labels += '<g opacity="' + (dc > 120 ? '0.6' : '0.95') + '">'
                + '<rect x="' + (pc.x - wpx / 2).toFixed(2) + '" y="' + (pc.y - 3.6).toFixed(2) + '" width="' + wpx.toFixed(2) + '" height="5.4" rx="2.2" fill="rgba(8,20,32,0.72)" stroke="' + EDGE + '" stroke-width="0.4" vector-effect="non-scaling-stroke"/>'
                + '<text x="' + pc.x.toFixed(2) + '" y="' + (pc.y + 0.35).toFixed(2) + '" fill="' + LABEL + '" font-size="3.1" font-weight="700" text-anchor="middle" dominant-baseline="middle" style="paint-order:stroke">' + t2 + '</text>'
                + '</g>';
        }
        svg.innerHTML = html + labels;
    }
    function startAr() { if (ensureSvg() && !_raf && !_idleT) _raf = requestAnimationFrame(arLoop); }
    function stopAr() {
        if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
        if (_idleT) { clearTimeout(_idleT); _idleT = 0; }
        if (_svg && _svg.parentNode) _svg.parentNode.removeChild(_svg);
        _svg = null; _lastH = null;
    }

    // ---- otevřít / zavřít ----------------------------------------------------
    function open() {
        if (_on) { renderPanel(); return; }
        _on = true;
        loadCache();
        ensurePanel();
        renderPanel();
        whereAmI(); renderPanel();
        if (needFetch()) fetchAround(function () { whereAmI(); renderPanel(); });
        startAr();
        // Panel se obnovuje pomalu — jde o rozhlížení, ne o navádění, a každá
        // sekunda navíc je jen práce pro baterii.
        if (!_tick) {
            _tick = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
                if (!_on) return;
                try {
                    if (needFetch() && !_busy) fetchAround(function () { whereAmI(); renderPanel(); });
                    else { whereAmI(); renderPanel(); }
                } catch (e) { swallow(e, 'prohlidka:tik'); }
            }, 3000);
        }
        toast('Prohlídka: zvedni telefon a rozhlédni se.');
    }
    function close() {
        _on = false;
        stopAr();
        if (_tick) { try { clearInterval(_tick); } catch (e) { swallow(e, 'prohlidka:close'); } _tick = null; }
        var el = document.getElementById(PANEL_ID);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    function toggle() { if (_on) close(); else open(); }

    // ================================================================
    //  init
    // ================================================================
    var _tries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'prohlidka', label: 'Prohlídka okolí', icon: ICON, onClick: toggle, order: 13 });
            return true;
        }
        return false;
    }
    function init() { if (!register() && _tries++ < 20) setTimeout(init, 500); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGProhlidka = { open: open, close: close, toggle: toggle, kdeStojim: function () { whereAmI(); return _here; } };
})();
