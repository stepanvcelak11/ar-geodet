// ===== QTRIG — NAJÍT MÍSTO NEBO ADRESU + ODKAZ NA BOD (ODPOJITELNÁ, ag/lazy) ==================
// (19. 9. 2026, čtvrté kolo hodnocení, E6 — vybráno uživatelem)
//
// PROČ: v appce nebylo žádné hledání místa v mapě — jediné geokódování mělo Počasí
// (js/pocasi.js, Open-Meteo). „Poloha z mapy" znamenalo posunout mapu prstem; do cizího
// města na druhém konci Evropy se tak nedalo dostat. A odkaz s bodem neexistoval: adresa
// se četla jen pro pozvánku do firmy (?firma= v js/ucty.js), takže „přijeď sem" šlo jen
// přes export CSV.
//
// CO DĚLÁ:
//   1) HLEDÁNÍ (nástroj „Najít místo nebo adresu" + dlaždice v panelu Vrstvy → #map-ctrl-stack):
//      • text → Photon (photon.komoot.io, OSM, celý svět, bez klíče, CORS *; jazyk podle appky
//        en/de/fr, jinak výchozí), řazení s ohledem na mou polohu (lat/lon bias);
//      • souřadnice napsané jakkoli: „50,0755 14,4378", „50.0755, 14.4378", „50°04'32"N 14°26'16"E",
//        i dvojice v MÍSTNÍM systému země (S-JTSK 741817,8 1044492,5; Lambert-93; UTM…) —
//        pořadí os podle registru zemí (js/sour-zeme.js AGSour.zMistnich);
//      • výsledek: mapa tam skočí (značka s názvem) a nabídne: Vzít jako mou polohu (ruční poloha,
//        js/poloha-z-mapy.js — appka pak stáhne okolí tam), Uložit jako bod, Navigovat (bod +
//        cíl v AR), Zkopírovat odkaz.
//   2) ODKAZ NA BOD: index.html?bod=lat,lng,název (nebo ?geo=geo:lat,lng — protokol geo: z manifestu
//      na Androidu). Po startu appky se bod založí do zakázky (jednou — stejné jméno a poloha se
//      nezdvojí), nastaví jako cíl navigace a mapa na něj skočí. Parametry se z adresy hned mažou
//      (replaceState), ať se nevrací při každém spuštění z plochy. V kartě bodu je řádek
//      „Poslat odkaz na bod" (navigator.share, jinak schránka).
//
// NEINVAZIVNÍ: nesahá do logika.js/grafika.js — čte globály (map, userLat/userLng, arPoints,
// highlightPoint, addImportedPoints, showDetails) přes typeof. Vstup: agRegisterFieldTool
// (dlaždice hledat-misto) + registr js/tools-registry.js. API: window.AGHledat.
// Odstranění: smaž js/hledat-misto.js + řádek <script type="ag/lazy"> v index.html + záznam
// v js/tools-registry.js a data/navody*.json; přegeneruj sw.js.
// ==============================================================================================
(function () {
    'use strict';
    if (window.AGHledat) return;

    var OV_ID = 'ag-hm-modal', STYLE_ID = 'ag-hm-style', PARAM = 'bod';
    var PHOTON = 'https://photon.komoot.io/api/';
    var _ov = null, _seq = 0, _marker = null, _posledni = null, _t = null;

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'hledat-misto:' + kde); } catch (e2) { /* nic */ } }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function T(s) { try { return (window.AGJazyk && AGJazyk.t) ? AGJazyk.t(s) : s; } catch (e) { return s; } }
    function toast(m) { try { if (typeof quickToast === 'function') quickToast(m); else if (typeof agInfo === 'function') agInfo(m); } catch (e) { /* nic */ } }
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function mojePoloha() { try { return (typeof userLat === 'number' && userLat) ? { lat: userLat, lng: userLng } : null; } catch (e) { return null; } }
    function jazyk() { try { var l = window.AGJazyk && AGJazyk.get ? AGJazyk.get() : 'cs'; return (l === 'en' || l === 'de' || l === 'fr') ? l : 'default'; } catch (e) { return 'default'; } }
    function f5(v) { return (Math.round(v * 1e5) / 1e5).toString(); }

    // ---- rozpoznání souřadnic v textu ---------------------------------------------------------
    function cislo(s) { var n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; }
    function dmsVsechny(str) {   // 50°04'32.5"N 14°26'16"E → [50.0757, 14.4378]
        var re = /(-?\d+)[°\s]+(\d+)[′'\s]+(\d+(?:[.,]\d+)?)?[″"]?\s*([NSEWnsew])?/g, out = [], m;
        while ((m = re.exec(str))) {
            var v = Math.abs(parseInt(m[1], 10)) + parseInt(m[2], 10) / 60 + (m[3] ? cislo(m[3]) / 3600 : 0);
            if (m[1].charAt(0) === '-' || /[SWsw]/.test(m[4] || '')) v = -v;
            out.push(v);
        }
        return out;
    }
    function souradnice(q) {
        var s = String(q || '').trim();
        // DMS dvojice
        if (/[°]/.test(s)) {
            var d = dmsVsechny(s);
            if (d.length >= 2 && Math.abs(d[0]) <= 90 && Math.abs(d[1]) <= 180) return { lat: d[0], lng: d[1], popis: 'DMS' };
            return null;
        }
        // mezery jako oddělovač tisíců („1 044 492,5") slít — ale ne mezeru mezi dvěma čísly („…,8 1044492,5")
        var m = /^\s*(-?\d{1,7}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,7}(?:[.,]\d+)?)\s*$/.exec(s.replace(/(\d)\s(\d{3})(?!\d)/g, '$1$2'));
        if (!m) return null;
        var x = cislo(m[1]), y = cislo(m[2]); if (x == null || y == null) return null;
        // zeměpisné: obě do 90/180; „14,4378 50,0755" (prohozené) poznat podle Evropy (lat 35–72, lng −12–45)
        var evropa = function (la, lo) { return la >= 34 && la <= 72 && lo >= -12 && lo <= 45; };
        if (Math.abs(x) <= 90 && Math.abs(y) <= 180 && (String(m[1]).indexOf('.') !== -1 || String(m[1]).indexOf(',') !== -1)) {
            if (!evropa(x, y) && evropa(y, x) && Math.abs(y) <= 90) return { lat: y, lng: x, popis: 'WGS84' };
            return { lat: x, lng: y, popis: 'WGS84' };
        }
        if (Math.abs(y) <= 90 && Math.abs(x) <= 180 && Math.abs(x) > 90) return { lat: y, lng: x, popis: 'WGS84' };
        // místní systém země (S-JTSK Y X, Lambert-93 X Y, UTM E N…) — pořadí os z registru
        if (Math.abs(x) > 1000 && Math.abs(y) > 1000 && window.AGSour && AGSour.zMistnich) {
            try {
                var ll = AGSour.zMistnich(x, y);   // (1. osa, 2. osa) v pořadí země: S-JTSK Y X, Lambert-93 X Y, UTM E N
                if (ll && isFinite(ll.lat) && isFinite(ll.lng) && Math.abs(ll.lat) <= 90) { var c = AGSour.crs(); return { lat: ll.lat, lng: ll.lng, popis: (c && c.nazev) || T('místní souřadnice') }; }
            } catch (e) { swallow(e, 'zMistnich'); }
        }
        return null;
    }

    // ---- Photon ---------------------------------------------------------------------------------
    function photon(q) {
        var me = mojePoloha();
        var u = PHOTON + '?q=' + encodeURIComponent(q) + '&limit=7' + (jazyk() !== 'default' ? '&lang=' + jazyk() : '') + (me ? '&lat=' + me.lat.toFixed(4) + '&lon=' + me.lng.toFixed(4) : '');
        var ctrl = (typeof AbortController === 'function') ? new AbortController() : null, t = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
        return fetch(u, { mode: 'cors', signal: ctrl ? ctrl.signal : undefined }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (d) {
            return ((d && d.features) || []).map(function (f) {
                var p = f.properties || {}, g = f.geometry && f.geometry.coordinates; if (!g) return null;
                var radky = [p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : '', p.postcode ? p.postcode + ' ' + (p.city || p.locality || '') : (p.city || p.locality || ''), p.country || ''].filter(Boolean);
                var nazev = p.name || radky[0] || (p.osm_value || '');
                return { nazev: nazev, popis: radky.filter(function (x) { return x !== nazev; }).join(', '), lat: g[1], lng: g[0], typ: p.osm_value || p.type || '' };
            }).filter(Boolean);
        }).finally(function () { if (t) clearTimeout(t); });
    }

    // ---- UI -------------------------------------------------------------------------------------
    function styl() {
        if (!window.AG || !AG.style) return;
        AG.style(STYLE_ID, [
            '#' + OV_ID + '{z-index:19999;}',
            '#' + OV_ID + ' .aghm-content{display:flex;flex-direction:column;max-height:88vh;}',
            '.aghm-title{margin:0 0 8px;color:var(--accent);font-family:var(--font-display,sans-serif);}',
            '.aghm-q{display:flex;gap:6px;}',
            '.aghm-q input{flex:1;min-width:0;font-size:calc(15px * var(--ag-font-scale,1));padding:10px 12px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--surface-1);color:inherit;}',
            '.aghm-q button{flex:0 0 auto;padding:0 14px;border-radius:10px;}',
            '.aghm-hint{color:var(--text-muted,#9aa1ac);font-size:calc(12px * var(--ag-font-scale,1));line-height:1.45;margin:6px 2px 2px;}',
            '#' + OV_ID + ' .aghm-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:8px;}',
            '.aghm-r{display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;padding:9px 8px;border:0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.08));background:transparent;color:inherit;cursor:pointer;font:inherit;}',
            '.aghm-r b{font-size:calc(14px * var(--ag-font-scale,1));}',
            '.aghm-r small{color:var(--text-muted,#9aa1ac);font-size:calc(12px * var(--ag-font-scale,1));}',
            '.aghm-r.on{background:var(--accent-soft,rgba(47,158,116,0.15));}',
            '.aghm-acts{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;}',
            '#' + OV_ID + ' .aghm-acts .btn{margin:0;padding:10px 6px;font-size:calc(13px * var(--ag-font-scale,1));}',
            '.aghm-wait{padding:14px 4px;color:var(--text-muted,#9aa1ac);}',
            '.ag-hm-pin{background:var(--accent,#2f9e74);color:#fff;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.35);}',
            '#ag-kb-share{display:block;width:100%;margin:0 0 12px;padding:9px 10px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:transparent;color:var(--accent);font:inherit;font-size:calc(13px * var(--ag-font-scale,1));text-align:left;cursor:pointer;}'
        ].join('\n'));
    }
    function build() {
        if (_ov && document.body.contains(_ov)) return _ov;
        styl();
        _ov = document.createElement('div');
        _ov.className = 'modal-overlay'; _ov.id = OV_ID;
        _ov.innerHTML =
            '<div class="modal-content aghm-content" role="dialog" aria-modal="true" aria-labelledby="aghm-title">' +
            '  <h3 class="aghm-title" id="aghm-title">' + esc(T('Najít místo nebo adresu')) + '</h3>' +
            '  <form class="aghm-q" id="aghm-form"><input type="search" id="aghm-q" autocomplete="off" enterkeyhint="search" placeholder="' + esc(T('adresa, obec, název místa, nebo souřadnice')) + '"><button type="submit" class="btn btn-blue">' + esc(T('Hledat')) + '</button></form>' +
            '  <div class="aghm-hint">' + esc(T('Souřadnice jdou napsat jakkoli: 50,0755 14,4378 · 50°04\'32"N 14°26\'16"E · nebo dvojice v systému země (S-JTSK Y X, UTM E N).')) + '</div>' +
            '  <div class="aghm-body" id="aghm-body"></div>' +
            '  <div class="aghm-acts" id="aghm-acts"></div>' +
            '  <button type="button" class="btn btn-secondary" id="aghm-close" style="margin-top:8px;">' + esc(T('Zavřít')) + '</button>' +
            '</div>';
        document.body.appendChild(_ov);
        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov) close(); });
        _ov.querySelector('#aghm-close').addEventListener('click', close);
        _ov.querySelector('#aghm-form').addEventListener('submit', function (e) { e.preventDefault(); hledej(_ov.querySelector('#aghm-q').value); });
        _ov.querySelector('#aghm-body').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-i]') : null; if (!b || !_vysledky) return;
            vyber(_vysledky[+b.getAttribute('data-i')], b);
        });
        _ov.querySelector('#aghm-acts').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-act]') : null; if (!b || !_posledni) return;
            akce(b.getAttribute('data-act'), _posledni);
        });
        return _ov;
    }
    var _vysledky = null;
    function open(q) {
        build(); _ov.style.display = 'flex';
        var i = _ov.querySelector('#aghm-q');
        if (q) { i.value = q; hledej(q); } else { try { i.focus(); } catch (e) { /* nic */ } }
    }
    function close() { if (_ov) _ov.style.display = 'none'; _seq++; }
    function hledej(q) {
        q = String(q || '').trim(); if (!q) return;
        var body = _ov.querySelector('#aghm-body'), acts = _ov.querySelector('#aghm-acts'); acts.innerHTML = ''; _posledni = null;
        var c = souradnice(q);
        if (c) { _vysledky = [{ nazev: f5(c.lat) + ', ' + f5(c.lng), popis: c.popis, lat: c.lat, lng: c.lng, typ: 'souradnice' }]; vypis(); vyber(_vysledky[0], body.querySelector('button[data-i]')); return; }
        if (navigator.onLine === false) { body.innerHTML = '<div class="aghm-wait">' + esc(T('Hledání adresy potřebuje signál — teď jsi offline. Souřadnice jdou i bez něj.')) + '</div>'; return; }
        var seq = ++_seq;
        body.innerHTML = '<div class="aghm-wait">' + esc(T('Hledám…')) + '</div>';
        photon(q).then(function (r) {
            if (seq !== _seq) return;
            _vysledky = r; vypis();
            if (!r.length) body.innerHTML = '<div class="aghm-wait">' + esc(T('Nic jsem nenašel. Zkus obec a ulici, nebo souřadnice.')) + '</div>';
        }).catch(function (e) { if (seq !== _seq) return; swallow(e, 'photon'); body.innerHTML = '<div class="aghm-wait">' + esc(T('Hledání teď neodpovědělo')) + ' (' + esc((e && e.message) || 'síť') + '). ' + esc(T('Zkus to za chvíli.')) + '</div>'; });
    }
    function vypis() {
        var body = _ov.querySelector('#aghm-body'); body.innerHTML = '';
        (_vysledky || []).forEach(function (r, i) {
            var b = document.createElement('button'); b.type = 'button'; b.className = 'aghm-r'; b.setAttribute('data-i', String(i));
            b.innerHTML = '<b>' + esc(r.nazev) + '</b>' + (r.popis ? '<small>' + esc(r.popis) + '</small>' : '') + '<small>' + f5(r.lat) + ', ' + f5(r.lng) + (r.typ && r.typ !== 'souradnice' ? ' · ' + esc(r.typ) : '') + '</small>';
            body.appendChild(b);
        });
    }
    function vyber(r, btn) {
        if (!r) return; _posledni = r;
        try { _ov.querySelectorAll('.aghm-r').forEach(function (x) { x.classList.toggle('on', x === btn); }); } catch (e) { /* nic */ }
        ukaz(r);
        var acts = _ov.querySelector('#aghm-acts');
        acts.innerHTML = '<button type="button" class="btn btn-blue" data-act="poloha">' + esc(T('Vzít jako mou polohu')) + '</button>'
            + '<button type="button" class="btn btn-secondary" data-act="bod">' + esc(T('Uložit jako bod')) + '</button>'
            + '<button type="button" class="btn btn-secondary" data-act="nav">' + esc(T('Navigovat sem')) + '</button>'
            + '<button type="button" class="btn btn-secondary" data-act="odkaz">' + esc(T('Zkopírovat odkaz')) + '</button>';
    }
    function ukaz(r) {
        var m = getMap(); if (!m || typeof L === 'undefined') return;
        try {
            if (_marker) { m.removeLayer(_marker); _marker = null; }
            _marker = L.marker([r.lat, r.lng], { interactive: false, icon: L.divIcon({ className: 'ag-hm-pin-wrap', html: '<span class="ag-hm-pin">' + esc(r.nazev).slice(0, 40) + '</span>', iconAnchor: [0, 0] }) }).addTo(m);
            m.setView([r.lat, r.lng], Math.max(m.getZoom() || 0, 17));
            try { var vm = document.getElementById('map-view'); if (vm && typeof applyViewMode === 'function' && typeof viewMode !== 'undefined' && viewMode === 'ar') { viewMode = 'map'; applyViewMode(); } } catch (e) { /* nic */ }
        } catch (e) { swallow(e, 'ukaz'); }
    }
    function odkaz(lat, lng, nazev) {
        var u = location.origin + location.pathname + '?' + PARAM + '=' + f5(lat) + ',' + f5(lng) + (nazev ? ',' + encodeURIComponent(String(nazev).slice(0, 60)) : '');
        return u;
    }
    function kopiruj(t, hlaska) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast(hlaska || (T('Zkopírováno') + ': ' + t)); }, function () { toast(t); });
            else toast(t);
        } catch (e) { toast(t); }
    }
    function sdilej(lat, lng, nazev) {
        var u = odkaz(lat, lng, nazev), text = (nazev ? nazev + ' — ' : '') + f5(lat) + ', ' + f5(lng);
        if (navigator.share) { try { navigator.share({ title: 'QTRIG', text: text, url: u }).catch(function () { /* zrušeno */ }); return; } catch (e) { /* níže */ } }
        kopiruj(u, T('Odkaz na bod zkopírován — pošli ho kolegovi, appka ho k bodu dovede.'));
    }
    function ulozBod(r, nazev) {
        if (typeof window.addImportedPoints !== 'function') return null;
        var jm = nazev || r.nazev || T('Místo');
        var n = 0; try { n = window.addImportedPoints([{ name: String(jm).slice(0, 60), lat: r.lat, lng: r.lng, origin: 'hledani' }]); } catch (e) { swallow(e, 'ulozBod'); }
        var pt = null;
        try { pt = (typeof arPoints !== 'undefined') ? arPoints.find(function (p) { return p.name === String(jm).slice(0, 60) && Math.abs(p.lat - r.lat) < 0.0001 && Math.abs(p.lng - r.lng) < 0.0001; }) : null; } catch (e) { pt = null; }
        return { pt: pt, novy: n > 0 };
    }
    function naviguj(pt) {
        if (!pt) return false;
        try {
            if (typeof highlightPoint === 'function') {
                var uz = false; try { uz = (typeof highlightedPointId !== 'undefined' && highlightedPointId === pt.id); } catch (e) { uz = false; }
                if (!uz) highlightPoint(pt);
            }
            var m = getMap(); if (m) m.setView([pt.lat, pt.lng], Math.max(m.getZoom() || 0, 17));
            return true;
        } catch (e) { swallow(e, 'naviguj'); return false; }
    }
    // bod se neuložil: nejspíš leží v jiné zemi, než ve které měřím (js/csv-validate.js hlídá rozsah S-JTSK)
    function jinaZeme(r) {
        var k = null, a = null; try { k = AGSour.urciZemi(r.lat, r.lng); a = AGSour.kod(); } catch (e) { k = null; }
        if (k && a && k !== a) toast(T('Místo je v jiné zemi, než ve které měříš — napřed „Vzít jako mou polohu“, appka přepne zemi a bod pak uloží.'));
        else toast(T('Bod se neuložil — zkus to znovu, nebo ho ulož ručně přes Nový bod.'));
    }
    function akce(act, r) {
        if (act === 'poloha') {
            if (window.AGManualPos && typeof AGManualPos.take === 'function') { AGManualPos.take(r.lat, r.lng, 18); toast(T('Ruční poloha') + ': ' + r.nazev + '. ' + T('Okolí se stáhne odsud; skutečná GPS ji zase nahradí.')); close(); }
            else toast(T('Ruční poloha není k dispozici (modul poloha-z-mapy).'));
        } else if (act === 'bod') {
            var v = ulozBod(r); if (v && v.pt) { toast(v.novy ? T('Bod uložen do zakázky') + ': ' + v.pt.name : T('Takový bod už v zakázce je') + ': ' + v.pt.name); try { if (typeof showDetails === 'function') { close(); showDetails(v.pt, 0); } } catch (e) { /* nic */ } }
            else jinaZeme(r);
        } else if (act === 'nav') {
            var w = ulozBod(r); if (w && w.pt) { close(); naviguj(w.pt); toast(T('Cíl navigace') + ': ' + w.pt.name); }
            else jinaZeme(r);
        } else if (act === 'odkaz') {
            sdilej(r.lat, r.lng, r.nazev);
        }
    }

    // ---- odkaz na bod v adrese ------------------------------------------------------------------
    function zAdresy() {
        try {
            if (typeof URLSearchParams !== 'function' || !location.search) return null;
            var q = new URLSearchParams(location.search), out = null;
            var b = q.get(PARAM), g = q.get('geo');
            if (b) { var p = b.split(','); var la = cislo(p[0]), lo = cislo(p[1]); if (la != null && lo != null && Math.abs(la) <= 90 && Math.abs(lo) <= 180) out = { lat: la, lng: lo, nazev: p[2] ? decodeURIComponent(p[2]).slice(0, 60) : '' }; }
            else if (g) { var m = /geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[;?].*?q=([^&]*))?/.exec(g); if (m) out = { lat: parseFloat(m[1]), lng: parseFloat(m[2]), nazev: m[3] ? decodeURIComponent(m[3]).replace(/\(.*\)$/, '').slice(0, 60) : '' }; }
            if (q.has(PARAM) || q.has('geo')) {
                q['delete'](PARAM); q['delete']('geo');
                var rest = q.toString();
                try { history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash); } catch (e) { swallow(e, 'replaceState'); }
            }
            return out;
        } catch (e) { swallow(e, 'zAdresy'); return null; }
    }
    var _zOdkazu = zAdresy();   // číst HNED (než adresu někdo přepíše), použít až po startu
    function zpracujOdkaz() {
        var o = _zOdkazu; if (!o) return; _zOdkazu = null;
        var od = Date.now(), tik = setInterval(function () {
            try {
                var bezi = document.body && document.body.classList.contains('app-started');
                var prekryv = document.querySelector('#ag-gate, #ag-login, #agtp-block, #agtp-card');
                if (bezi && !prekryv && typeof window.addImportedPoints === 'function') {
                    clearInterval(tik);
                    var jm = o.nazev || (T('Bod z odkazu') + ' ' + f5(o.lat) + ',' + f5(o.lng));
                    var v = ulozBod({ lat: o.lat, lng: o.lng, nazev: jm }, jm);
                    if (v && v.pt) { naviguj(v.pt); toast((v.novy ? T('Bod z odkazu uložen do zakázky a nastaven jako cíl') : T('Bod z odkazu už v zakázce je — nastaven jako cíl')) + ': ' + v.pt.name); }
                } else if (Date.now() - od > 180000) clearInterval(tik);
            } catch (e) { swallow(e, 'zpracujOdkaz'); clearInterval(tik); }
        }, 1500);
    }

    // ---- karta bodu: „Poslat odkaz na bod" ----------------------------------------------------
    function tlacitkoVKarte() {
        try {
            var body = document.getElementById('det-body'); if (!body) return;
            var pt = null; try { pt = (typeof arPoints !== 'undefined' && typeof activePointIdForModal !== 'undefined') ? arPoints.find(function (p) { return p.id === activePointIdForModal; }) : null; } catch (e) { pt = null; }
            if (!pt || !isFinite(pt.lat)) return;
            var b = document.getElementById('ag-kb-share');
            if (!b) { styl(); b = document.createElement('button'); b.type = 'button'; b.id = 'ag-kb-share'; }
            b.innerHTML = '<svg class="icon" style="width:15px;height:15px;vertical-align:-3px;margin-right:6px;"><use href="#i-share"/></svg>' + esc(T('Poslat odkaz na bod kolegovi')) + ' ↗';
            b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); sdilej(pt.lat, pt.lng, pt.name); };
            var kotva = document.getElementById('ag-kb-hint') || document.getElementById('ag-kb-acts');
            if (kotva && kotva.parentNode === body) kotva.insertAdjacentElement('afterend', b); else body.appendChild(b);
        } catch (e) { swallow(e, 'karta'); }
    }
    function obalKartu() {
        var n = 0, t = setInterval(function () {
            if (typeof window.showDetails === 'function') {
                clearInterval(t);
                var puv = window.showDetails;
                window.showDetails = function () { var r = puv.apply(this, arguments); setTimeout(tlacitkoVKarte, 60); return r; };
            } else if (++n > 40) clearInterval(t);
        }, 500);
    }

    // ---- vstupy: dlaždice, tlačítko v panelu Vrstvy -------------------------------------------
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/></svg>';
    function injectTile() {
        if (typeof window.agRegisterFieldTool !== 'function') return false;
        window.agRegisterFieldTool({ id: 'hledat-misto', label: 'Najít místo nebo adresu', icon: ICON, cat: 'Katastr a data', onClick: function () { open(); }, order: 3 });
        return true;
    }
    function injectBtn() {
        if (document.getElementById('btn-hledat-misto')) return true;
        var stack = document.getElementById('map-ctrl-stack'); if (!stack) return false;
        var b = document.createElement('button'); b.type = 'button'; b.id = 'btn-hledat-misto'; b.className = 'ms-tile'; b.setAttribute('aria-label', 'Najít místo');
        b.innerHTML = ICON.replace('<svg ', '<svg class="icon" ') + '<span>Najít místo</span>';
        b.addEventListener('click', function () { try { document.getElementById('map-controls').classList.remove('expanded'); } catch (e) { /* nic */ } open(); });
        stack.appendChild(b);
        return true;
    }
    function init() {
        if (!injectTile()) { var n = 0, t = setInterval(function () { if (injectTile() || ++n > 40) clearInterval(t); }, 500); }
        if (!injectBtn()) { var n2 = 0, t2 = setInterval(function () { if (injectBtn() || ++n2 > 40) clearInterval(t2); }, 800); }
        obalKartu();
        zpracujOdkaz();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.agOpenHledatMisto = open;
    window.AGHledat = { open: open, hledej: hledej, souradnice: souradnice, odkaz: odkaz, sdilej: sdilej, zAdresy: zAdresy, ulozBod: ulozBod, naviguj: naviguj, _photon: photon };
})();
