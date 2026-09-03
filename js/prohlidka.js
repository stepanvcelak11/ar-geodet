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
//   • V KAMEŘE hranice parcel POLOŽENÉ NA ZEM + štítky s číslem parcely.
//
// JAK VYPADÁ: okno jede PŘES CELOU OBRAZOVKU jako ostatní okna appky. Tlačítko
// „Ukázat v kameře" ho sbalí do úzké pilulky u spodní hrany, aby byl vidět
// obraz s hranicemi; pilulkou se panel zase vytáhne zpátky. Do 31. 8. 2026 to
// byla karta u spodní hrany, která se ještě odsouvala nad spodní ovládání —
// skončila přesně uprostřed displeje a nebylo pořádně vidět ani panel, ani
// kamera pod ním. NEVRACET.
//
// ČÍM SE LIŠÍ OD „Katastr — parcely" (js/cadastre-vector.js), ať to nejsou dva
// nástroje na totéž: ten je PRACOVNÍ — ukládá parcely do zakázky, umí navigovat
// na lomový bod, uloží ho jako bod a kreslí v AR samotné hrany. Prohlídka je
// PROHLÍŽECÍ: drží si vlastní dočasnou zásobu MIMO zakázku (klíč je globální,
// ne per zakázka), neumí uložit ani jeden bod, a v AR kreslí hlavně POPISKY
// parcel (číslo + druh nad plochou), protože to je celé, co má režim říct.
// Když běží obojí naráz, hrany se překreslí dvakrát — proto si prohlídka kreslí
// do VLASTNÍ svg vrstvy. Slabé čáry, kterými se to dřív řešilo, ale znamenaly,
// že v prohlídce (kde jsou to jediné čáry v obraze) nebylo vidět nic; teď mají
// tmavý obrys a plnou sílu a překryv s pracovní vrstvou se snese.
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
    var PILL_ID = 'ag-ph-pill';     // co po okně zbude, když se sbalí do kamery
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
    var _min = false;          // okno sbalené do kamery (kreslí se AR, ne panel)
    var _okoli = [];           // nejbližší sousední parcely [{p,d,b}] pro seznam v okně
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
        _okoli = [];
        if (!haveUser() || !_parcels.length) return;
        var on = null, near = [];
        for (var i = 0; i < _parcels.length; i++) {
            var p = _parcels[i];
            if (!on && inParcel(uLat(), uLng(), p)) { on = p; continue; }
            var e = nearestEdge(uLat(), uLng(), p);
            if (!e) continue;
            if (e.d < 30) near.push({ p: p, d: e.d });
            // Sousedi do 150 m — vzdálenost k nim se stejně počítá kvůli tomu,
            // na čem stojíš, takže seznam „co je kolem" nestojí ani snímek navíc.
            if (e.d < 150) _okoli.push({ p: p, d: e.d, b: e.brg });
        }
        _okoli.sort(function (x, y) { return x.d - y.d; });
        _okoli = _okoli.slice(0, 6);
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
        // Barvy JEN z tokenů (css/tokens.css). Napevno zapsané odstíny tu dřív
        // znamenaly světle šedý text na světlém podkladu — a tenhle režim se
        // otevírá venku na slunci, kde je světlý motiv to jediné čitelné.
        st.textContent = [
            // OKNO. Rám (celá obrazovka, pozadí, odsazení, safe-area) obstará
            // .modal-overlay + .modal-content z css/style.css — tady jen obsah.
            '#' + PANEL_ID + ' .ag-ph-box{gap:0;}',
            // vpravo nahoře sedí křížek z js/modal-close.js — nechat mu místo
            '.ag-ph-eyebrow{display:block;padding-right:54px;color:var(--accent-bright,#3eb487);',
            '  font-weight:700;letter-spacing:0.08em;text-transform:uppercase;',
            '  font-size:calc(11px * var(--ag-font-scale, 1));}',
            '.ag-ph-h{margin:8px 0 3px;line-height:1.2;font-weight:800;color:var(--text-color,#eceef2);',
            '  font-size:calc(24px * var(--ag-font-scale, 1));}',
            '.ag-ph-sub{margin-bottom:14px;line-height:1.4;color:var(--text-muted,#9aa1ac);',
            '  font-size:calc(13.5px * var(--ag-font-scale, 1));}',
            // Dlaždice s čísly. minmax(0,…) je nutné: bez něj by dlouhé číslo
            // roztáhlo sloupec a na 320px telefonu vystrčilo mřížku z okna.
            '.ag-ph-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px;}',
            '.ag-ph-c{min-width:0;padding:12px;border-radius:14px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.05));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));}',
            '.ag-ph-c b{display:block;font-weight:800;line-height:1.15;color:var(--text-color,#eceef2);',
            '  font-variant-numeric:tabular-nums;font-size:calc(19px * var(--ag-font-scale, 1));}',
            '.ag-ph-c span{display:block;margin-top:3px;line-height:1.3;color:var(--text-muted,#9aa1ac);',
            '  font-size:calc(12px * var(--ag-font-scale, 1));}',
            // Seznam „co je kolem" — kvůli němu je celoobrazovkové okno k něčemu.
            '.ag-ph-nadpis{margin:18px 0 8px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;',
            '  color:var(--text-muted,#9aa1ac);font-size:calc(11px * var(--ag-font-scale, 1));}',
            '.ag-ph-r{display:flex;align-items:baseline;gap:10px;padding:10px 2px;',
            '  border-top:1px solid var(--glass-border,rgba(255,255,255,0.1));}',
            '.ag-ph-r:first-of-type{border-top:none;}',
            '.ag-ph-rn{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
            '  color:var(--text-color,#eceef2);font-size:calc(14px * var(--ag-font-scale, 1));}',
            '.ag-ph-rn small{font-size:inherit;color:var(--text-muted,#9aa1ac);}',
            '.ag-ph-rd{flex:0 0 auto;color:var(--text-muted,#9aa1ac);',
            '  font-variant-numeric:tabular-nums;font-size:calc(12.5px * var(--ag-font-scale, 1));}',
            '.ag-ph-warn{margin-top:12px;padding:10px 12px;border-radius:12px;line-height:1.45;',
            '  background:var(--glass-bg,rgba(255,255,255,0.05));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  color:var(--warn,#fbbf24);font-size:calc(12.5px * var(--ag-font-scale, 1));}',
            '.ag-ph-status{margin-top:10px;min-height:1.2em;line-height:1.35;color:var(--text-muted,#9aa1ac);',
            '  font-size:calc(12.5px * var(--ag-font-scale, 1));}',
            '.ag-ph-zdroj{margin-top:16px;line-height:1.4;color:var(--text-faint,#6b727d);',
            '  font-size:calc(11.5px * var(--ag-font-scale, 1));}',
            // Tlačítka: 46 px na výšku, ať se do nich dá trefit i v rukavici.
            // flex-wrap: na 320 px se dvě vedle sebe nevejdou a zalomí se.
            '.ag-ph-foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;}',
            '.ag-ph-b{flex:1 1 140px;min-height:46px;padding:11px 12px;border-radius:13px;font-weight:600;',
            '  background:var(--glass-bg,rgba(255,255,255,0.06));color:var(--text-color,#eceef2);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  font-size:calc(14px * var(--ag-font-scale, 1));}',
            '.ag-ph-b:active{background:var(--accent-soft,rgba(47,158,116,0.18));}',
            '.ag-ph-b-main{border-color:var(--accent-bright,#3eb487);color:var(--accent-bright,#3eb487);}',
            '.ag-ph-b-close{flex:1 1 100%;margin-top:2px;}',
            // PILULKA — co po okně zbude, když se sbalí do kamery.
            '#' + PILL_ID + '{position:fixed;left:50%;bottom:0;transform:translateX(-50%);z-index:99992;',
            '  display:flex;align-items:center;gap:8px;max-width:min(86vw,400px);',
            '  padding:6px 6px 6px 14px;border-radius:999px;',
            '  background:var(--glass-bg,rgba(24,28,33,0.84));color:var(--text-color,#eceef2);',
            '  border:1px solid var(--glass-border-strong,rgba(255,255,255,0.2));',
            '  box-shadow:0 6px 22px rgba(0,0,0,0.45);',
            '  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);}',
            '#' + PILL_ID + ' .ag-ph-pill-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
            '  font-weight:700;font-size:calc(13px * var(--ag-font-scale, 1));}',
            '#' + PILL_ID + ' button{flex:0 0 auto;min-width:44px;min-height:44px;padding:0 12px;',
            '  border-radius:999px;background:transparent;color:var(--text-color,#eceef2);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));font-weight:600;',
            '  font-size:calc(13px * var(--ag-font-scale, 1));}',
            '#' + PILL_ID + ' button:active{background:var(--accent-soft,rgba(47,158,116,0.18));}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // Pilulka se usadí NAD OVLÁDÁNÍ PŘILEPENÉ KE SPODNÍ HRANĚ, ne přes něj.
    // POZOR NA LAYOUT TÉHLE APPKY: #dock NENÍ spodní lišta — je to svislý sloupec
    // vpravo (Body / Nový bod / Nastavení), který spodní hrany vůbec nedosáhne.
    // U spodní hrany naopak sedí tlačítka z #map-controls (Vrstvy vlevo, Mapa
    // vpravo), a ta se objevují jen v mapě. Proto se NEMĚŘÍ celý #dock (podle
    // jeho vysokého rámečku by pilulka vyskočila do půlky obrazovky), ale jen ty
    // prvky, které jsou VIDĚT a KONČÍ u dolního okraje.
    function nadDokem(el) {
        if (!el) return;
        var H = window.innerHeight;
        var top = null;
        try {
            // Prvky, kterým se pilulka uhýbá. Kromě dětí #dock a #map-controls je
            // to #ag-view-wheel — kolečko přepínání zobrazení (Mapa / AR / obojí).
            // V kameře sedí SAMO u pravé spodní hrany, není ničím dítětem a
            // pilulka mu vjížděla rohem do plochy.
            var kandidati = [];
            ['dock', 'map-controls'].forEach(function (id) {
                var host = document.getElementById(id);
                if (!host) return;
                for (var j = 0; j < host.children.length; j++) kandidati.push(host.children[j]);
            });
            ['ag-view-wheel', 'view-seg'].forEach(function (id) {
                var e2 = document.getElementById(id);
                if (e2) kandidati.push(e2);
            });
            for (var i = 0; i < kandidati.length; i++) {
                var c = kandidati[i];
                if (!c.getClientRects().length) continue;
                var r = c.getBoundingClientRect();
                if (!r.width || !r.height) continue;
                if (r.bottom < H - 40 || r.top > H) continue;   // nesedí u spodní hrany
                // ⚠⚠ A HLAVNĚ: opravdu je VIDĚT? Zavřený panel Mapa a vrstvy
                //   (#map-sheet) se neschovává přes display, ale opacity:0 +
                //   pointer-events:none — rect měří dál 421 px až ke spodní hraně.
                //   Prohlídka se podle něj uhýbala VŽDYCKY a narážela na strop,
                //   takže skákala do třetiny obrazovky. Přesně to byla ta
                //   „vyskočí mi to napůl uprostřed obrazovky" z 31. 8. 2026.
                //   NEVRACET bez téhle kontroly.
                var cs = null;
                try { cs = window.getComputedStyle(c); } catch (e3) { cs = null; }
                if (cs && (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05)) continue;
                if (top == null || r.top < top) top = r.top;
            }
        } catch (e) { swallow(e, 'nadDokem'); }
        // strop: i kdyby se něco změřilo špatně, pilulka nikdy nevyskočí přes
        // čtvrtinu obrazovky — je to úzký proužek, ne panel
        var b = (top == null) ? 12 : Math.min(Math.max(12, Math.round(H - top + 8)), Math.round(H * 0.25));
        el.style.bottom = 'calc(' + b + 'px + env(safe-area-inset-bottom, 0px))';
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
        // ⚠⚠ CELÁ OBRAZOVKA, ne karta u spodní hrany. Do 31. 8. 2026 se prohlídka
        //   otevírala jako panel přilepený dolů, který se navíc odsouval nad spodní
        //   ovládání — na telefonu skončil PŘESNĚ UPROSTŘED: pod ním kus mapy, nad
        //   ním kus kamery a ani jedno k ničemu („vyskočí mi to napůl uprostřed
        //   obrazovky, dole trochu mapy, nahoře trochu AR"). Ostatní okna appky
        //   jedou přes celou obrazovku, tohle je teď taky.
        //   ⚠⚠ Musí to být `modal-overlay`, NE `modal`: třída `modal` v appce
        //   NEEXISTUJE (css/style.css zná jen .modal-overlay a .modal-content),
        //   takže by <div> nedostal position:fixed a protože je <body> flex-sloupec
        //   (kamera + mapa), stal by se z okna TŘETÍ SLOUPEC LAYOUTU a vykreslil se
        //   místo mapy. Přesně tohle se 31. 8. opravovalo u Ročenky. NEVRACET.
        //   Bonus: js/modal-close.js sem sám dodá křížek i swipe „zpět".
        el.className = 'modal-overlay';
        el.innerHTML =
            '<div class="modal-content ag-ph-box">' +
            '  <span class="ag-ph-eyebrow">Prohlídka okolí</span>' +
            '  <div class="modal-body ag-ph-body" id="ag-ph-body"></div>' +
            '  <div class="ag-ph-foot">' +
            '    <button type="button" class="ag-ph-b" id="ag-ph-refresh">Načíst okolí znovu</button>' +
            '    <button type="button" class="ag-ph-b ag-ph-b-main" id="ag-ph-cam">Ukázat v kameře</button>' +
            '    <button type="button" class="ag-ph-b ag-ph-b-close" id="ag-ph-close">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(el);
        el.querySelector('#ag-ph-close').addEventListener('click', close);
        el.querySelector('#ag-ph-refresh').addEventListener('click', function () {
            _origin = null;
            fetchAround(function () { whereAmI(); renderPanel(); });
        });
        el.querySelector('#ag-ph-cam').addEventListener('click', toAr);
        return el;
    }

    // Sbalení do kamery. Okno se NEZAVÍRÁ — jen uhne z cesty, aby bylo vidět
    // obraz, a zůstane po něm pilulka, kterou se člověk vrátí zpátky. Bez ní by
    // celoobrazovkové okno znamenalo, že hranice v kameře už nikdo neuvidí.
    function ensurePill() {
        var p = document.getElementById(PILL_ID);
        if (p) return p;
        injectStyles();
        p = document.createElement('div');
        p.id = PILL_ID;
        p.innerHTML =
            '<span class="ag-ph-pill-t" id="ag-ph-pill-t">Prohlídka okolí</span>' +
            '<button type="button" id="ag-ph-pill-open">Panel</button>' +
            '<button type="button" id="ag-ph-pill-x" aria-label="Zavřít prohlídku">✕</button>';
        document.body.appendChild(p);
        p.querySelector('#ag-ph-pill-open').addEventListener('click', restore);
        p.querySelector('#ag-ph-pill-x').addEventListener('click', close);
        return p;
    }
    function pillText(t) {
        var e = document.getElementById('ag-ph-pill-t');
        if (e) e.textContent = t || 'Prohlídka okolí';
    }
    function minimize() {
        _min = true;
        var el = document.getElementById(PANEL_ID);
        if (el) el.style.display = 'none';
        var p = ensurePill();
        p.style.display = 'flex';
        pillText(nadpisText());
        nadDokem(p);
    }
    function restore() {
        _min = false;
        var p = document.getElementById(PILL_ID);
        if (p) p.style.display = 'none';
        ensurePanel().style.display = 'flex';
        renderPanel();
    }
    function toAr() {
        // Přepnout hlavní obrazovku na kameru a okno sbalit — přes celou
        // obrazovku by z „ukaž mi to v kameře" nebylo vidět vůbec nic.
        minimize();
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

    // Jedna věta, která shrnuje, kde stojíš. Potřebuje ji okno (velký nadpis)
    // i pilulka nad kamerou — proto je vytažená ven, ať se neliší.
    function nadpisText() {
        if (!haveUser()) return 'Čekám na GPS';
        var p = _here && _here.parcel;
        if (!p) return _parcels.length ? 'Tady katastr parcelu nenašel' : 'Zatím nemám data okolí';
        if (!_here.jistota && !_here.outside && _here.second) {
            return 'Na hranici parcel ' + p.cislo + ' a ' + _here.second.cislo;
        }
        return (_here.outside ? 'Nejblíž je parcela ' : 'Stojíš na parcele ') + p.cislo;
    }

    var ZDROJ = '<div class="ag-ph-zdroj">Hranice a údaje o parcelách: RÚIAN, prohlížecí služba ČÚZK. Data © ČÚZK. '
        + 'Prohlídka jen ukazuje — nic neměří a nic neukládá do zakázky.</div>';

    function renderPanel() {
        pillText(nadpisText());
        var pill = document.getElementById(PILL_ID);
        if (pill && _min) nadDokem(pill);
        var el = document.getElementById(PANEL_ID);
        if (!el || _min) return;
        var body = el.querySelector('#ag-ph-body');
        if (!body) return;
        var h = '';

        if (!haveUser()) {
            h = '<div class="ag-ph-h">Čekám na GPS</div>'
                + '<div class="ag-ph-sub">Prohlídka potřebuje vědět, kde stojíš. Venku to bývá pár vteřin.</div>';
            body.innerHTML = h + '<div class="ag-ph-status" id="ag-ph-status"></div>' + ZDROJ;
            return;
        }

        var p = _here && _here.parcel;
        if (!p) {
            h = '<div class="ag-ph-h">' + (_parcels.length ? 'Tady katastr parcelu nenašel' : 'Zatím nemám data okolí') + '</div>'
                + '<div class="ag-ph-sub">' + (_parcels.length ? 'Zkus popojít pár kroků nebo načíst okolí znovu.' : 'Ťukni na „Načíst okolí znovu“.') + '</div>';
            body.innerHTML = h + '<div class="ag-ph-status" id="ag-ph-status"></div>' + ZDROJ;
            return;
        }

        h += '<div class="ag-ph-h">' + esc(nadpisText()) + '</div>';
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

        // Co je kolem. Tohle je celý smysl režimu, a v okně přes celou obrazovku
        // je na to konečně místo — dřív se do karty u spodní hrany nevešlo.
        if (_okoli.length) {
            h += '<div class="ag-ph-nadpis">Kolem tebe</div>';
            for (var oi = 0; oi < _okoli.length; oi++) {
                var o = _okoli[oi], dr = druhTxt(o.p.druh);
                h += '<div class="ag-ph-r"><span class="ag-ph-rn">' + esc(o.p.cislo)
                    + (dr ? ' <small>· ' + esc(dr) + '</small>' : '')
                    + '</span><span class="ag-ph-rd">' + fmtM(o.d) + ' na ' + smer(o.b) + '</span></div>';
            }
        }
        h += '<div class="ag-ph-status" id="ag-ph-status"></div>' + ZDROJ;
        body.innerHTML = h;
    }

    // ---- AR: hranice po zemi + štítky parcel ---------------------------------
    // ⚠⚠ HRANICE MUSÍ SEDĚT NA ZEMI. Do 31. 8. 2026 se svislý úhel počítal jen
    //   z výšky držení telefonu (`atan2(eyeH, d)`) a terén se ignoroval, takže
    //   ve svahu — a u pokládky silnic je svah pravidlem — čáry plavaly nad
    //   krajinou („ty hranice jsou hodně ve vzduchu"). Terén dodává
    //   js/dmr-terrain.js jako terrainDZ(lat,lng) = převýšení bodu proti
    //   stanovisku; stejně to počítá grafika.js u AR značek. Když vrstva DMR
    //   není nebo dlaždice ještě nedorazila, vrací 0 = rovná zem a režim jede
    //   dál jako dřív.
    // ⚠ ČITELNOST: světle modrá čára o šířce 1,6 px při 50 % krytí se ztratila
    //   jak v trávě, tak proti obloze. Každá hrana se proto kreslí DVAKRÁT —
    //   nejdřív tmavý obrys, pak barevná čára — a štítek má plný podklad a text
    //   s tmavým lemem. Na slunci je to rozdíl mezi „vidím" a „nevidím".
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

    // ⚠ Vrstva má viewBox 0..100 a preserveAspectRatio="none", takže vodorovná
    //   jednotka je jinak dlouhá než svislá. Čárám to nevadí (mají
    //   non-scaling-stroke, tloušťka je v pixelech), ALE PÍSMO by se roztáhlo do
    //   výšky — na telefonu na výšku klidně dvojnásobně. Štítky se proto kreslí
    //   ve skupině s protiškálou scale(_kx, 1) a rozměry se počítají z pixelů.
    var _boxH = 0, _kx = 1, _fscale = 1, _boxT = 0;
    function measure() {
        var now = Date.now();
        if (_boxH && now - _boxT < 1000) return;
        _boxT = now;
        var w = 0, h = 0;
        try {
            var ov = _svg && _svg.parentNode;
            if (ov && ov.getBoundingClientRect) { var r = ov.getBoundingClientRect(); w = r.width; h = r.height; }
        } catch (e) { swallow(e, 'prohlidka:measure'); }
        if (!w || !h) { w = window.innerWidth || 360; h = window.innerHeight || 640; }
        _boxH = h; _kx = h / w;
        try {
            var f = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ag-font-scale'));
            _fscale = (isFinite(f) && f > 0) ? Math.max(0.8, Math.min(1.6, f)) : 1;
        } catch (e2) { _fscale = 1; }
    }
    // pixely -> jednotky vrstvy (uvnitř skupiny s protiškálou platí pro obě osy)
    function px(n) { return n * 100 / (_boxH || 640); }

    // Projekce bodu na obrazovku — stejná matematika, jakou používá appka
    // (window._arProj plní grafika.js každý snímek), včetně terénu pod bodem.
    function projAR(lat, lng, heading, pj, eyeH, vOff) {
        var d = dist(uLat(), uLng(), lat, lng);
        var b = brg(uLat(), uLng(), lat, lng);
        var diff = ((b - heading + 540) % 360) - 180;
        var dz = 0;
        try { if (typeof terrainDZ === 'function') dz = terrainDZ(lat, lng) || 0; } catch (e) { swallow(e, 'prohlidka:projAR'); }
        var uH = diff, vV = Math.atan2(eyeH - dz, Math.max(d, 0.5)) * 180 / Math.PI - pj.pitch;
        if (pj.roll) { var cr = Math.cos(pj.roll), sr = Math.sin(pj.roll); var tt = uH * cr - vV * sr; vV = uH * sr + vV * cr; uH = tt; }
        return { x: 50 + (uH / pj.halfH) * 50, y: 50 + (vV / pj.halfV) * 50 - vOff, diff: diff, dist: d };
    }
    var _lastH = null, _lastP = null, _lastLat = null, _lastLng = null;
    function arLoop() {
        var svg = _svg;
        // Stejná úspora jako v js/cadastre-vector.js: bez čeho kreslit se smyčka
        // stáhne na 3 snímky za vteřinu, ať se mobil nehřeje v mapě a na pozadí.
        // `_min` je tu taky: dokud je otevřené celoobrazovkové okno, není z obrazu
        // vidět ani pixel a kreslit hranice by byla čistá práce pro baterii.
        if (!svg || !_on || !_min || !_parcels.length || !haveUser() || !window._arProj
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
        measure();

        var eyeH = 1.6, vOff = 0;
        try { eyeH = visSettings.eyeHeight || 1.6; vOff = visSettings.arVerticalOffset || 0; } catch (e) { swallow(e, 'prohlidka:arLoop'); }
        var obrys = '', cary = '', labels = '';
        for (var i = 0; i < _parcels.length; i++) {
            var p = _parcels[i];
            for (var ri = 0; ri < p.rings.length; ri++) {
                var r = p.rings[ri];
                for (var k = 0; k + 1 < r.length; k++) {
                    var da = dist(uLat(), uLng(), r[k].lat, r[k].lng);
                    var db = dist(uLat(), uLng(), r[k + 1].lat, r[k + 1].lng);
                    var blizko = Math.min(da, db);
                    if (blizko > 160) continue;
                    var pa = projAR(r[k].lat, r[k].lng, heading, pj, eyeH, vOff);
                    var pb = projAR(r[k + 1].lat, r[k + 1].lng, heading, pj, eyeH, vOff);
                    if (Math.abs(pa.diff) > 100 || Math.abs(pb.diff) > 100) continue;
                    // Úsek celý mimo obraz nemá cenu kreslit; a kdyby se projekce
                    // z nesmyslných dat utrhla, tohle ji udrží u obrazovky.
                    if ((pa.y < -60 && pb.y < -60) || (pa.y > 160 && pb.y > 160)) continue;
                    // Dál = slabší a tenčí. Blízká hranice, o kterou tu jde, je nejsilnější.
                    var sila = blizko > 120 ? 2.0 : (blizko > 60 ? 2.6 : 3.2);
                    var kryti = blizko > 120 ? 0.62 : (blizko > 60 ? 0.82 : 0.98);
                    var geom = ' x1="' + pa.x.toFixed(2) + '" y1="' + pa.y.toFixed(2)
                        + '" x2="' + pb.x.toFixed(2) + '" y2="' + pb.y.toFixed(2) + '"';
                    obrys += '<line' + geom + ' stroke="rgba(2,10,18,0.85)" stroke-width="' + (sila + 3).toFixed(1)
                        + '" stroke-linecap="round" opacity="' + (kryti * 0.8).toFixed(2) + '" vector-effect="non-scaling-stroke"/>';
                    cary += '<line' + geom + ' stroke="' + EDGE + '" stroke-width="' + sila.toFixed(1)
                        + '" stroke-linecap="round" opacity="' + kryti.toFixed(2) + '" vector-effect="non-scaling-stroke"/>';
                }
            }
            // Štítek stojí NA ZEMI v těžišti parcely a drží se jí tenkou stopkou —
            // jinak by čísla plavala v obraze bez vztahu k tomu, co popisují.
            var c = centroid(p);
            if (!c) continue;
            var dc = dist(uLat(), uLng(), c.lat, c.lng);
            if (dc > 160) continue;
            var pc = projAR(c.lat, c.lng, heading, pj, eyeH, vOff);
            if (Math.abs(pc.diff) > 55) continue;
            if (pc.y < -20 || pc.y > 130) continue;
            var t2 = esc(p.cislo) + (p.vymera ? ('  ·  ' + Number(Math.round(p.vymera)).toLocaleString('cs-CZ') + ' m²') : '');
            var fs = px(14.5 * _fscale);                       // výška písma
            var vys = px(23 * _fscale);                        // výška rámečku
            var sir = px(t2.length * 8.2 * _fscale + 18);
            var stopka = px(14);
            var kryt = dc > 120 ? 0.72 : 0.97;
            labels += '<g transform="translate(' + pc.x.toFixed(2) + ',' + pc.y.toFixed(2) + ') scale(' + _kx.toFixed(4) + ',1)" opacity="' + kryt + '">'
                + '<line x1="0" y1="0" x2="0" y2="' + (-stopka).toFixed(2) + '" stroke="rgba(2,10,18,0.8)" stroke-width="4" vector-effect="non-scaling-stroke"/>'
                + '<line x1="0" y1="0" x2="0" y2="' + (-stopka).toFixed(2) + '" stroke="' + EDGE + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/>'
                + '<rect x="' + (-sir / 2).toFixed(2) + '" y="' + (-stopka - vys).toFixed(2) + '" width="' + sir.toFixed(2) + '" height="' + vys.toFixed(2)
                + '" rx="' + (vys / 2.6).toFixed(2) + '" fill="rgba(6,16,26,0.9)" stroke="' + EDGE + '" stroke-width="1.4" vector-effect="non-scaling-stroke"/>'
                + '<text x="0" y="' + (-stopka - vys / 2).toFixed(2) + '" fill="' + LABEL + '" font-size="' + fs.toFixed(2)
                + '" font-weight="800" text-anchor="middle" dominant-baseline="middle"'
                + ' stroke="rgba(2,10,18,0.9)" stroke-width="2.4" vector-effect="non-scaling-stroke"'
                + ' style="paint-order:stroke fill">' + t2 + '</text>'
                + '</g>';
        }
        svg.innerHTML = obrys + cary + labels;
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
        if (_on) { restore(); return; }
        _on = true;
        _min = false;
        loadCache();
        ensurePanel().style.display = 'flex';
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
                // Spodní ovládání se v mapě objevuje a mizí — pilulka se mu musí
                // uhýbat i potom, co ji sem vykreslení posadilo poprvé.
                try { if (_min) nadDokem(document.getElementById(PILL_ID)); } catch (e2) { swallow(e2, 'prohlidka:tik-pilulka'); }
            }, 3000);
        }
    }
    function close() {
        _on = false;
        _min = false;
        stopAr();
        if (_tick) { try { clearInterval(_tick); } catch (e) { swallow(e, 'prohlidka:close'); } _tick = null; }
        [PANEL_ID, PILL_ID].forEach(function (id) {
            var el = document.getElementById(id);
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
    }
    // Klepnutí na dlaždici, když je okno sbalené do kamery, ho VYTÁHNE ZPĚT —
    // zavřít by to bylo překvapení: člověk shání panel, který si před chvílí schoval.
    function toggle() {
        if (_on && _min) { restore(); return; }
        if (_on) { close(); return; }
        open();
    }

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
