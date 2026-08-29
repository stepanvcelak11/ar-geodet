// ===== AR Geodet — NEJBLIŽŠÍ ZNÁMÝ BOD (BODOVÉ POLE ČÚZK) (ODPOJITELNÁ vrstva) ==
// Neinvazivní vrstva ve stylu js/ref-calibration.js: NEEDITUJE logika.js ani
// grafika.js, jen čte globály přes typeof-guardy a registruje vlastní dlaždici.
//
// PROBLÉM: appka body bodového pole (TB / ZhB / PBPP / nivelační) STAHUJE už dlouho
// (fetchGeodata v logika.js, endpoint BodovaPole/MapServer) a ukládá je offline do
// `arOfflinePoints12`. Jenže leží jen jako fialové/modré tečky mezi stovkami dalších
// v mapě a v AR. Na dvě otázky, které geodet v terénu reálně řeší, appka odpovědět
// neuměla:
//     1) „Na který známý bod si mám dojít, abych si ověřil / zkalibroval polohu?"
//     2) „Kterým směrem a jak daleko to je?"
// A hlavně: „Posun GPS na známý bod" (js/ref-calibration.js) — jediná funkce, která
// systematickou chybu GPS opravdu odstraní — nabízela v rozbalovátku POUZE vlastní
// uložené body. Úřední bod, tedy přesně to, na co si člověk stoupne, se musel opsat
// ručně z karty bodu. Tenhle modul tu díru zavírá.
//
// CO DĚLÁ:
//   • Dlaždice „Nejbližší známý bod" → seznam úředních bodů seřazený podle
//     vzdálenosti, s azimutem, světovou stranou, kategorií a S-JTSK Y/X.
//   • U každého řádku dvě akce: „Navést" (zvýrazní bod jako cíl navigace, jako
//     kdyby se na něj klepnulo v mapě) a „Kotva" (otevře Posun GPS na známý bod
//     s PŘEDVYPLNĚNÝMI souřadnicemi — dvě klepnutí místo přepisování osmi číslic).
//   • Filtr podle spolehlivosti: TB+ZhB jsou nejpřesnější, PBPP nejhustší.
//   • Funguje OFFLINE z `arOfflinePoints12`; se signálem umí „Dohledat v okolí"
//     (volá fetchGeodata, tedy tentýž ČÚZK endpoint jako zbytek appky).
//
// Data © ČÚZK. Odstranění: smaž js/bodove-pole.js + css/bodove-pole.css a oba
// řádky se značkou "BODOVÉ POLE" v index.html (a cesty v sw.js).
// ================================================================================
(function () {
    'use strict';
    // Stylopis uz nevisi v index.html: modul je odlozeny (type="ag/lazy"),
    // takze by jeho <link> jen zbytecne blokoval prvni vykresleni. Pripoji se
    // tady, tedy davno pred tim, nez uzivatel okno otevre.
    try { window.AG && AG.cssFile && AG.cssFile('bp-css', 'css/bodove-pole.css'); } catch (e) { }


    // Kategorie tak, jak je plní fetchGeodata() v logika.js. `q` = pořadí kvality:
    // TB a ZhB mají řádově centimetrové souřadnice a stabilizaci, PBPP je hustší,
    // ale slabší; nivelační bod je VÝŠKOVÝ — na kotvení polohy se nehodí a modul
    // to u něj napíše.
    var CATS = {
        TB: { label: 'Trigonometrický', short: 'TB', color: 'var(--color-tb)', q: 1 },
        ZHB: { label: 'Zhušťovací', short: 'ZhB', color: 'var(--color-zhb)', q: 2 },
        PBPP: { label: 'Podrobný (PPBP)', short: 'PBPP', color: 'var(--color-pbpp)', q: 3 },
        NIVEL: { label: 'Nivelační (výškový)', short: 'NIV', color: 'var(--color-nivel)', q: 4 }
    };
    var FILTERS = [
        { k: 'all', label: 'Vše' },
        { k: 'best', label: 'TB + ZhB', cats: ['TB', 'ZHB'] },
        { k: 'pbpp', label: 'PBPP', cats: ['PBPP'] },
        { k: 'nivel', label: 'Nivelační', cats: ['NIVEL'] }
    ];
    var LIMIT = 30;                 // kolik řádků vypsat (dál od 30. bodu už nikdo nejde)
    var REFRESH_MS = 2000;          // přepočet vzdáleností, když se s telefonem jde

    var _ov = null, _timer = null, _filter = 'all';

    // Časovače jen pro UI jdou přes AG.uiInterval (js/idle-timers.js) — samy se
    // uspí, když appka jde na pozadí, a probudí po návratu. Bez té vrstvy fallback
    // na nativní setInterval, aby modul zůstal odpojitelný.
    function every(fn, ms) {
        try { if (window.AG && AG.uiInterval) return AG.uiInterval(fn, ms); } catch (e) { /* fallback níž */ }
        return setInterval(fn, ms);
    }
    function stop(h) {
        if (!h) return;
        try { if (window.AG && AG.clearUiInterval) return AG.clearUiInterval(h); } catch (e) { /* fallback níž */ }
        try { clearInterval(h); } catch (e) { /* nic */ }
    }


    // --------------------------------------------------------------------------------
    // Čtení živých globálů — fail-silent, stejný vzor jako ref-calibration.js
    // --------------------------------------------------------------------------------
    function gLat() { try { return (typeof userLat !== 'undefined' && userLat != null) ? userLat : null; } catch (e) { return null; } }
    function gLng() { try { return (typeof userLng !== 'undefined' && userLng != null) ? userLng : null; } catch (e) { return null; } }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toastSafe(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:toastSafe'); } }

    function dist(lat1, lng1, lat2, lng2) {
        try { if (typeof getDistance === 'function') return getDistance(lat1, lng1, lat2, lng2); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:dist'); }
        try { if (window.GeoCore && GeoCore.getDistance) return GeoCore.getDistance(lat1, lng1, lat2, lng2); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:dist'); }
        return null;
    }
    function bearing(lat1, lng1, lat2, lng2) {
        try { if (window.GeoCore && GeoCore.getBearing) return GeoCore.getBearing(lat1, lng1, lat2, lng2); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:bearing'); }
        return null;
    }
    // Světová strana slovy — v terénu se čte rychleji než 247°.
    var DIRS = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];
    function dirWord(az) {
        if (az == null || !isFinite(az)) return '';
        return DIRS[Math.round(((az % 360) + 360) % 360 / 45) % 8];
    }
    function fmtDist(m) {
        if (m == null || !isFinite(m)) return '?';
        if (m < 1000) return Math.round(m) + ' m';
        return (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';
    }

    // --------------------------------------------------------------------------------
    // Zdroj bodů: živé arPoints (mají currentDist přepočtený watchPosition), a když
    // v nich úřední body nejsou (studený start bez signálu), sáhne se do offline
    // cache `arOfflinePoints12`, kterou plní logika.js.
    // --------------------------------------------------------------------------------
    function officialPoints() {
        var live = [];
        try {
            if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                live = arPoints.filter(function (p) { return p && p.cat && p.cat !== 'CUSTOM' && isFinite(p.lat) && isFinite(p.lng); });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:officialPoints'); }
        if (live.length) return live;
        try {
            var raw = (typeof getStoredData === 'function') ? getStoredData('arOfflinePoints12') : null;
            if (raw) {
                var arr = JSON.parse(raw);
                if (Array.isArray(arr)) return arr.filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng); });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:officialPoints'); }
        return [];
    }

    // Seřazený seznam nejbližších úředních bodů. Veřejné přes window.AGBodovePole,
    // aby si ho mohly vzít i jiné moduly (kotva, protokol) bez duplikace filtrů.
    function nearest(lat, lng, limit, cats) {
        var la = (lat == null) ? gLat() : lat;
        var ln = (lng == null) ? gLng() : lng;
        var pts = officialPoints();
        if (la == null || ln == null) return [];
        var out = [];
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i];
            if (cats && cats.indexOf(p.cat) < 0) continue;
            // currentDist plní watchPosition a respektuje zakotvené stanovisko (AGPose),
            // takže má přednost před vlastním výpočtem — stejně to dělá pas-blizkosti.js.
            var d = (p.currentDist != null && isFinite(p.currentDist)) ? p.currentDist : dist(la, ln, p.lat, p.lng);
            if (d == null || !isFinite(d)) continue;
            out.push({ pt: p, d: d, az: bearing(la, ln, p.lat, p.lng) });
        }
        out.sort(function (a, b) { return a.d - b.d; });
        return out.slice(0, limit || LIMIT);
    }

    // S-JTSK Y,X pro výpis a pro předvyplnění kotvy. Jeden zdroj pravdy = GeoCore.
    function sjtsk(p) {
        try {
            if (window.GeoCore && GeoCore.toSJTSK) {
                var r = GeoCore.toSJTSK(p.lat, p.lng);
                if (r && isFinite(r.y) && isFinite(r.x)) return { Y: Math.abs(r.y), X: Math.abs(r.x) };
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:sjtsk'); }
        try {
            if (typeof proj4 === 'function') {
                var sj = proj4('EPSG:4326', 'EPSG:5514', [p.lng, p.lat]);
                return { Y: Math.abs(sj[0]), X: Math.abs(sj[1]) };
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:sjtsk'); }
        return null;
    }

    // --------------------------------------------------------------------------------
    // Akce na řádku
    // --------------------------------------------------------------------------------
    // „Navést" — tentýž stav, jaký nastaví klepnutí na bod v mapě (highlightedPointId
    // + překreslení). Vzor převzatý z js/cadastre-vector.js.
    //! ⚠ highlightPoint() v grafika.js je PŘEPÍNAČ: na už zvýrazněném bodu navádění
    //  VYPNE. Kdyby se volal naslepo, „Navést" na aktuálním cíli by šipku zhaslo —
    //  proto se volá jen, když cíl teprve nastavujeme (tak to dělá i ar-calibrate.js).
    function navigateTo(pt) {
        var ok = false;
        try {
            var cur = (typeof highlightedPointId !== 'undefined') ? highlightedPointId : null;
            if (cur === pt.id) { ok = true; }                    // už je to cíl — nechat být
            else if (typeof highlightPoint === 'function') { highlightPoint(pt); ok = true; }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:navigateTo'); }
        if (!ok) {
            try { highlightedPointId = pt.id; ok = true; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:navigateTo'); }
            try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:navigateTo'); }
            try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:navigateTo'); }
        }
        close();
        toastSafe(ok ? ('Cíl: ' + (pt.name || 'bod') + ' — šipka a vzdálenost jedou.') : 'Cíl se nepodařilo nastavit.');
    }

    // „Kotva" — otevře Posun GPS na známý bod s předvyplněnými Y/X a názvem.
    //! ⚠ js/ref-calibration.js visí v index.html jako `type="ag/lazy"`, takže hned po
    //  startu JEŠTĚ NENÍ načtený a openRefCalibration neexistuje. Kdyby se to bralo
    //  jako „nástroj v sestavě není", ohlásila by Kotva nesmysl přesně v tu chvíli,
    //  kdy ji člověk zmáčkne poprvé. Proto se modul nejdřív dotáhne přes AGLazy.need.
    function useAsAnchor(pt) {
        var s = sjtsk(pt);
        if (!s) { toastSafe('Souřadnice S-JTSK se nepodařilo spočítat.'); return; }
        var prefill = { name: pt.name || '', Y: s.Y, X: s.X, cat: pt.cat };
        if (typeof window.openRefCalibration === 'function') {
            close();
            window.openRefCalibration(prefill);
            return;
        }
        if (window.AGLazy && typeof AGLazy.need === 'function') {
            toastSafe('Otevírám kotvu…');
            AGLazy.need('js/ref-calibration.js', function () {
                if (typeof window.openRefCalibration === 'function') {
                    close();
                    window.openRefCalibration(prefill);
                } else {
                    toastSafe('Nástroj „Posun GPS na známý bod" se nepodařilo načíst.');
                }
            });
            return;
        }
        toastSafe('Nástroj „Posun GPS na známý bod" není v této sestavě appky.');
    }

    // --------------------------------------------------------------------------------
    // Dohledání v okolí — tentýž fetchGeodata, který používá zbytek appky.
    // --------------------------------------------------------------------------------
    function refetch() {
        var btn = _ov && _ov.querySelector('#agbp-refetch');
        var la = gLat(), ln = gLng();
        if (la == null || ln == null) { toastSafe('Čekám na GPS polohu.'); return; }
        if (typeof fetchGeodata !== 'function') { toastSafe('Stahování bodů není k dispozici.'); return; }
        if (btn) { btn.disabled = true; btn.textContent = 'Stahuji…'; }
        var radius = 0;
        try { radius = (typeof mapRadius !== 'undefined' && isFinite(mapRadius)) ? mapRadius : 0; } catch (e) { radius = 0; }
        Promise.resolve(fetchGeodata(la, ln, radius || 1000, false)).then(function (n) {
            toastSafe(n ? ('Přibylo ' + n + ' bodů bodového pole.') : 'Nic nového se nenašlo.');
        }).catch(function () {
            toastSafe('Stažení se nepovedlo — ČÚZK neodpovídá nebo není signál.');
        }).then(function () {
            if (btn) { btn.disabled = false; btn.textContent = 'Dohledat v okolí'; }
            render();
        });
    }

    // --------------------------------------------------------------------------------
    // UI
    // --------------------------------------------------------------------------------
    function build() {
        if (_ov && document.body.contains(_ov)) return _ov;
        _ov = document.createElement('div');
        _ov.className = 'modal-overlay agbp-overlay';
        _ov.id = 'agbp-modal';
        _ov.innerHTML =
            '<div class="modal-content agbp-content" role="dialog" aria-modal="true" aria-labelledby="agbp-title">' +
            '  <h3 class="agbp-title" id="agbp-title"><svg class="icon"><use href="#i-crosshair"/></svg> Nejbližší známý bod</h3>' +
            '  <div class="agbp-filters" id="agbp-filters" role="group" aria-label="Filtr podle druhu bodu"></div>' +
            '  <div class="modal-body agbp-body"><div id="agbp-list"></div></div>' +
            '  <div class="agbp-foot">' +
            '    <button type="button" class="btn btn-secondary" id="agbp-refetch">Dohledat v okolí</button>' +
            '    <button type="button" class="btn btn-secondary" id="agbp-close">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(_ov);

        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov) close(); });
        _ov.querySelector('#agbp-close').addEventListener('click', close);
        _ov.querySelector('#agbp-refetch').addEventListener('click', refetch);

        var fw = _ov.querySelector('#agbp-filters');
        FILTERS.forEach(function (f) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'agbp-chip' + (f.k === _filter ? ' on' : '');
            b.dataset.f = f.k;
            b.textContent = f.label;
            b.setAttribute('aria-pressed', f.k === _filter ? 'true' : 'false');
            b.addEventListener('click', function () { _filter = f.k; syncChips(); render(); });
            fw.appendChild(b);
        });

        // Delegovaně: řádků jsou desítky a překreslují se každé 2 s, vlastní posluchač
        // na každém tlačítku by se s nimi pořád zakládal a zahazoval.
        _ov.querySelector('#agbp-list').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-act]') : null;
            if (!b) return;
            var id = b.getAttribute('data-id');
            var pt = null, all = officialPoints();
            for (var i = 0; i < all.length; i++) { if (String(all[i].id) === String(id)) { pt = all[i]; break; } }
            if (!pt) { toastSafe('Bod se nepodařilo najít.'); return; }
            if (b.getAttribute('data-act') === 'nav') navigateTo(pt);
            else useAsAnchor(pt);
        });
        return _ov;
    }

    function syncChips() {
        if (!_ov) return;
        var chips = _ov.querySelectorAll('.agbp-chip');
        for (var i = 0; i < chips.length; i++) {
            var on = chips[i].dataset.f === _filter;
            chips[i].classList.toggle('on', on);
            chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    function currentCats() {
        for (var i = 0; i < FILTERS.length; i++) if (FILTERS[i].k === _filter) return FILTERS[i].cats || null;
        return null;
    }

    function render() {
        var host = _ov && _ov.querySelector('#agbp-list');
        if (!host) return;
        var la = gLat(), ln = gLng();
        if (la == null || ln == null) {
            host.innerHTML = '<div class="agbp-empty">Čekám na GPS polohu — bez ní se vzdálenosti spočítat nedají.</div>';
            return;
        }
        var rows = nearest(la, ln, LIMIT, currentCats());
        if (!rows.length) {
            var total = officialPoints().length;
            host.innerHTML = '<div class="agbp-empty">' + (total
                ? 'V tomhle filtru není žádný bod. Zkus „Vše".'
                : 'Žádné body bodového pole zatím stažené.<br>Se signálem klepni na <b>Dohledat v okolí</b>; stažené body pak zůstanou i offline.') + '</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i], p = r.pt;
            var c = CATS[p.cat] || { label: 'Bod bodového pole', short: '?', color: 'var(--text-muted)', q: 9 };
            var s = sjtsk(p);
            var az = (r.az != null && isFinite(r.az)) ? (Math.round(r.az) + '° ' + dirWord(r.az)) : '—';
            // Tri patra, ne tri sloupce: souradnice S-JTSK maji pres deset znaku a
            // v uzkem flexu vedle tlacitek se VZDY usekly (tatáž chyba jako kdysi ve
            // stavovem pruhu). Cislo vzdalenosti drzi prvni radek, souradnice maji
            // celou sirku a akce jsou dole vedle sebe, kam dosahne palec.
            html += '<div class="agbp-row">'
                + '<div class="agbp-head">'
                + '  <div class="agbp-name"><span class="agbp-badge" style="background:' + c.color + ';">' + esc(c.short) + '</span> ' + esc(p.name || 'Bod') + '</div>'
                + '  <div class="agbp-num"><b>' + esc(fmtDist(r.d)) + '</b><small>' + esc(az) + '</small></div>'
                + '</div>'
                + '<div class="agbp-sub">' + esc(c.label) + (s ? ' · Y ' + s.Y.toFixed(2) + ' · X ' + s.X.toFixed(2) : '') + '</div>'
                + (p.cat === 'NIVEL' ? '<div class="agbp-warn">Výškový bod — na kotvu polohy se nehodí.</div>' : '')
                + '<div class="agbp-acts">'
                + '  <button type="button" class="btn btn-secondary agbp-act" data-act="nav" data-id="' + esc(p.id) + '">Navést</button>'
                + '  <button type="button" class="btn btn-secondary agbp-act" data-act="anchor" data-id="' + esc(p.id) + '"' + (p.cat === 'NIVEL' ? ' disabled' : '') + '>Kotva</button>'
                + '</div>'
                + '</div>';
        }
        host.innerHTML = html;
    }

    function open() {
        build();
        syncChips();
        render();
        _ov.style.display = 'flex';
        stop(_timer);
        _timer = every(render, REFRESH_MS);
    }
    function close() {
        stop(_timer); _timer = null;
        if (_ov) _ov.style.display = 'none';
    }

    window.AGBodovePole = { nearest: nearest, open: open, points: officialPoints, sjtsk: sjtsk };
    window.openBodovePole = open;

    // --------------------------------------------------------------------------------
    // Vstup: dlaždice v Nástrojích. Boční menu je nouzový fallback, když
    // field-tools.js v sestavě chybí (stejně to řeší ref-calibration.js).
    // --------------------------------------------------------------------------------
    function injectTile() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'bodove-pole', label: 'Nejbližší známý bod', icon: '<svg class="icon"><use href="#i-crosshair"/></svg>', cat: 'Katastr a data', onClick: open, order: 30 });
            var stale = document.getElementById('agbp-launch'); if (stale) stale.remove();
            return;
        }
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('agbp-launch')) return;
        var host = menu.querySelector('.menu-scroll') || menu;
        var btn = document.createElement('button');
        btn.id = 'agbp-launch';
        btn.className = 'menu-btn';
        btn.type = 'button';
        btn.innerHTML = '<svg class="icon"><use href="#i-crosshair"/></svg> Nejbližší známý bod';
        btn.addEventListener('click', function () {
            try { if (typeof toggleMenu === 'function') toggleMenu(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bodove-pole:injectTile'); }
            open();
        });
        var about = host.querySelector('button[onclick*="openAbout"]');
        if (about) host.insertBefore(btn, about); else host.appendChild(btn);
    }

    function init() {
        try { injectTile(); } catch (e) { console.warn('[bodove-pole] tile', e); }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 350); });
})();
