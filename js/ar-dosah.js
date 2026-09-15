// ===== QTRIG — VZDÁLENÉ BODY DO AR: výběr výřezem mapy (ODPOJITELNÁ vrstva) ==
// Na přání 8. 9. 2026: „když budu chtít bod, který je někde v dálce a nezobrazuje
// se mi v AR, protože mám omezenou vzdálenost, a budu si z toho území to chtít vzít
// třeba 2 km daleko — natáhl bych tam čtvereček a zobrazily by se mi ještě body
// v tom území a viděl bych je také v ARku."
//
// CO TO DĚLÁ: v mapě se vybere obdélník (tahem, nebo ťuknutím na dva rohy; dvěma
// prsty se mapa posouvá), body uvnitř se DOSTÁHNOU Z ČÚZK a dostanou příznak
// „ukázat v AR vždy" a od té chvíle je AR kreslí BEZ OHLEDU na nastavený dosah
// (Nastavení → AR → viditelnost, běžně 150 m). Výběr přežije restart, drží se
// per zakázka a dá se jedním klepnutím zrušit.
//
// ⚠⚠ PROČ TO NEJDE UDĚLAT PROSTÝM ZVĚTŠENÍM DOSAHU. Dosah je v appce zároveň
//   VÝKONOVÝ ŘEZ: arPoints jsou seřazené podle vzdálenosti a smyčka v renderAR
//   se za prvním bodem mimo dosah přepne do „už jen zhasínám" (proměnná _beyond,
//   js/grafika.js). Po stažení bodového pole z ČÚZK jich v poli bývají stovky
//   a bez toho řezu by se každý snímek kompasu procházel celý ocas. Kdyby se
//   dosah zvedl na 2 km, projížděly by se všechny — a to na telefonu poznat je.
//   Proto se pouští jen VYBRANÉ body, přesně tak, jak už dnes projde navigovaný
//   cíl a právě otevřený bod (`_keepFar`).
//
// ⚠ AZIMUT SE POČÍTÁ JEN DO 1,25× DOSAHU (js/logika.js, _brgLim). Bez zásahu tam
//   by vybraný bod měl `currentBearing === null` a v AR by neměl kam se nakreslit.
//   Proto se ptá i tohohle modulu — viz `vzdy()` níž.
//
// KDE SE TO ZAPÍNÁ: Nástroje → Srovnat AR → „Vzdálené body do AR".
//
// Odstranění: smaž tenhle soubor + řádek <script> v index.html (a v sw.js) a
// zahoď tři podmínky `AGDosah` v js/grafika.js a js/logika.js. Bez modulu se
// appka chová jako dřív (v AR jen body do nastaveného dosahu).
// ================================================================================
(function () {
    'use strict';
    if (window.AGDosah) return;

    var KEY = 'agArVzdy_v1';          // seznam id (per zakázka — přes setStoredData)
    var STYLE_ID = 'ag-dosah-style';
    // ⚠ Strop VÝBĚRU. Na obrazovce jich stejně naráz svítí nejvýš MAX_DALEKO (25,
    //   js/grafika.js) — tenhle strop je proti tomu, aby se řez v renderAR nezrušil
    //   úplně: každý vybraný bod se totiž prochází i za koncem dosahu.
    var MAX_BODU = 250;
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>'
        + '<circle cx="12" cy="12" r="2.2"/></svg>';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'ar-dosah:' + kde); } catch (x) { } }
    function esc(s) {
        if (window.AG && AG.esc) return AG.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function toast(m) {
        try { if (typeof window.quickToast === 'function') return window.quickToast(m); } catch (e) { swallow(e, 'toast'); }
        try { if (typeof window.agInfo === 'function') return window.agInfo(m); } catch (e) { swallow(e, 'toast2'); }
    }

    // ---- úložiště -----------------------------------------------------------------
    // ⚠ Set, ne pole: ptá se na něj renderAR pro KAŽDÝ bod v KAŽDÉM snímku (60×/s).
    //   Nad polem by to byl lineární průchod a při stovkách bodů by výběr stál víc
    //   výkonu než samotné kreslení.
    var _set = null;
    function nacti() {
        if (_set) return _set;
        _set = Object.create(null);
        try {
            var raw = (typeof window.getStoredData === 'function') ? window.getStoredData(KEY) : localStorage.getItem(KEY);
            var a = raw ? JSON.parse(raw) : [];
            if (Array.isArray(a)) for (var i = 0; i < a.length; i++) _set[String(a[i])] = 1;
        } catch (e) { swallow(e, 'nacti'); }
        return _set;
    }
    function uloz() {
        var a = Object.keys(nacti());
        try {
            var s = JSON.stringify(a);
            if (typeof window.setStoredData === 'function') window.setStoredData(KEY, s);
            else localStorage.setItem(KEY, s);
        } catch (e) { swallow(e, 'uloz'); }
    }
    // Otázka, kterou pokládá renderAR: „má se tenhle bod ukázat i mimo dosah?"
    function vzdy(id) { return id != null && nacti()[String(id)] === 1; }
    function pocet() { return Object.keys(nacti()).length; }
    function zrus() {
        _set = Object.create(null);
        uloz();
        prekresli();
    }
    // Po změně výběru musí AR znovu postavit značky (mimo dosah je dřív zahodilo)
    // a mapa se překreslit, aby zvýraznění sedělo.
    function prekresli() {
        // ⚠⚠ AZIMUT SI DOPOČÍTÁME SAMI, HNED. Přepočet v js/logika.js běží až při
        //   posunu o 0,25 m nebo při změně počtu bodů — kdo stojí na místě, čekal
        //   by na první azimut, dokud se nehne, a čerstvě vybraný bod by v AR
        //   nebyl (bez `currentBearing` ho renderAR nemá kam posadit).
        //   ⚠ Nešlo to obejít zápisem do `_lastCalcCount`: ta proměnná je v
        //     logika.js deklarovaná `let` uvnitř bloku, takže `window._lastCalcCount`
        //     je JINÁ hodnota a zápis do ní by tiše nedělal nic (tatáž past jako
        //     u `window.currentGpsAccuracy` v testu GPS z 31. 8. 2026).
        try {
            var pole = (typeof arPoints !== 'undefined') ? arPoints : null;
            if (pole && typeof getBearing === 'function' && typeof userLat !== 'undefined'
                && userLat != null && typeof getDistance === 'function') {
                var s = nacti();
                for (var i = 0; i < pole.length; i++) {
                    var p = pole[i];
                    if (!p || p.lat == null || s[String(p.id)] !== 1) continue;
                    // ⚠ VŽDY, ne jen když chybí: bod čerstvě stažený pro výřez má currentDist
                    //   od STŘEDU VÝŘEZU (tak ho spočítal _cuzkVlozBody), ne ode mě — do dalšího
                    //   fixu by v kartě i v AR svítilo 24 m u bodu 2 km daleko.
                    p.currentDist = getDistance(userLat, userLng, p.lat, p.lng);
                    p.currentBearing = getBearing(userLat, userLng, p.lat, p.lng);
                }
            }
        } catch (e) { swallow(e, 'prekresli:azimut'); }
        try { if (typeof window.initARMarkers === 'function') window.initARMarkers(); } catch (e) { swallow(e, 'prekresli'); }
        try { if (typeof window.drawAllMarkersOnMap === 'function') window.drawAllMarkersOnMap(); } catch (e) { swallow(e, 'prekresli2'); }
    }

    // ---- vzhled --------------------------------------------------------------------
    function styly() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-dosah-vrstva{position:fixed;inset:0;z-index:9400;touch-action:none;cursor:crosshair;',
            '  background:rgba(4,8,12,0.12);}',
            '#ag-dosah-ram{position:fixed;border:2px dashed #38bdf8;background:rgba(56,189,248,0.14);',
            '  border-radius:4px;pointer-events:none;z-index:9401;display:none;}',
            '#ag-dosah-lista{position:fixed;left:50%;transform:translateX(-50%);z-index:9402;',
            '  bottom:calc(env(safe-area-inset-bottom,0px) + 22px);width:min(94vw,470px);box-sizing:border-box;',
            '  display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;',
            '  background:rgba(14,18,24,0.96);color:#eef2f6;border:1px solid rgba(255,255,255,0.14);',
            '  box-shadow:0 10px 30px rgba(0,0,0,0.45);font-size:calc(13px * var(--ag-font-scale,1));line-height:1.3;}',
            '#ag-dosah-lista .txt{flex:1 1 auto;}',
            '#ag-dosah-lista button{flex:0 0 auto;min-height:40px;padding:0 14px;border-radius:10px;',
            '  border:1px solid rgba(255,255,255,0.22);background:transparent;color:#cbd5e1;font:600 13px/1 inherit;cursor:pointer;}',
            '#ag-dosah-lista button.hl{background:#38bdf8;border-color:#38bdf8;color:#04121a;}',
            // Vybraný bod je v mapě poznat i po zavření výběru — jinak by nešlo zjistit,
            // které body vlastně do AR pouštím.
            '.ar-marker.ag-daleko{outline:2px solid #38bdf8;outline-offset:2px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- výběr obdélníkem ------------------------------------------------------------
    // TŘI ZPŮSOBY (15. 9. 2026 večer, přání: „mám problém vybrat území, protože nemohu
    // posouvat mapou a už musím být na místě — dvěma prsty posunout mapu a obdélník
    // ťuknutím do mapy a druhým ťuknutím"):
    //   • jeden prst TÁHNE  → obdélník jako dřív,
    //   • ŤUKNUTÍ + ŤUKNUTÍ → první roh (značka v mapě), druhý roh = protější,
    //   • DVA PRSTY         → posun a zoom mapy pod vrstvou (stejná matematika jako
    //                         ovládání mapy v js/grafika.js, včetně otočení mapy).
    // Po každém výřezu se body v něm ještě DOSTAHUJÍ Z ČÚZK (fetchGeodata se středem
    // výřezu a poloměrem půl úhlopříčky): appka stahuje bodové pole jen do dosahu mapy
    // kolem mě (300 m), takže území 2 km daleko dřív bývalo prázdné a nástroj hlásil
    // „žádný nový bod". Vybrané body pak kreslí i mapa (_mimoDosahMapy v grafika.js).
    var _vrstva = null, _ram = null, _lista = null, _tah = null;
    var _roh = null, _rohZnacka = null;        // první roh z ťuknutí (LatLng) + jeho značka v mapě
    var _obdelnik = null;                      // poslední výřez nakreslený v mapě (L.rectangle)
    var _pinch = null;                         // dva prsty: { d0, z0, x, y }
    var _stahuji = false;
    var TAP_PX = 24;                           // menší pohyb než tohle = ťuknutí, ne tah
    var MAX_POLOMER_M = 2000;                  // půl úhlopříčky výřezu; větší výřez ČÚZK nestahujeme

    function mapa() { try { return (typeof map !== 'undefined' && map && map.getCenter) ? map : null; } catch (e) { return null; } }
    function rotace() { try { return (typeof mapRotation === 'number' && isFinite(mapRotation)) ? mapRotation : 0; } catch (e) { return 0; } }
    function bodZUdalosti(e) {
        if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }
    function ramNa(a, b) {
        if (!_ram) return;
        var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        _ram.style.left = x + 'px'; _ram.style.top = y + 'px';
        _ram.style.width = Math.abs(b.x - a.x) + 'px';
        _ram.style.height = Math.abs(b.y - a.y) + 'px';
        _ram.style.display = 'block';
    }
    // Rohy obdélníku ze SOUŘADNIC OBRAZOVKY. ⚠ Nejde použít map.containerPointToLatLng:
    // mapa je otočená podle kompasu (transform na #map-wrapper) a přepočet by dal jiné
    // místo. agScreenToLatLng() z js/grafika.js otočení zahrnuje.
    function vyberDoBodu(a, b) {
        var f = window.agScreenToLatLng;
        if (typeof f !== 'function') { toast('Mapa ještě není připravená.'); return null; }
        // ⚠ VŠECHNY ČTYŘI ROHY, ne jen dva protilehlé. Nad otočenou mapou je obdélník
        //   na obrazovce v terénu KOSODÉLNÍK — ze dvou rohů by vyšel jiný výsek, než
        //   uživatel nakreslil (naměřeno při otočení 45°: minul polovinu bodů).
        var rohy = [f(a.x, a.y), f(b.x, a.y), f(b.x, b.y), f(a.x, b.y)];
        for (var i = 0; i < rohy.length; i++) if (!rohy[i]) return null;
        return bboxZLatLng(rohy);
    }
    function bboxZLatLng(rohy) {
        var lat1 = rohy[0].lat, lat2 = rohy[0].lat, lng1 = rohy[0].lng, lng2 = rohy[0].lng;
        for (var i = 1; i < rohy.length; i++) {
            lat1 = Math.min(lat1, rohy[i].lat); lat2 = Math.max(lat2, rohy[i].lat);
            lng1 = Math.min(lng1, rohy[i].lng); lng2 = Math.max(lng2, rohy[i].lng);
        }
        return { lat1: lat1, lat2: lat2, lng1: lng1, lng2: lng2 };
    }
    function seber(bb) {
        var pole = (typeof window.arPoints !== 'undefined' && window.arPoints) ? window.arPoints
            : ((typeof arPoints !== 'undefined') ? arPoints : null);
        if (!pole) return { pridano: 0, celkem: 0, strop: false };
        var s = nacti(), pridano = 0, i, p, strop = false;
        for (i = 0; i < pole.length; i++) {
            p = pole[i];
            if (!p || p.lat == null || p.lng == null || p.hidden) continue;
            if (p.lat < bb.lat1 || p.lat > bb.lat2 || p.lng < bb.lng1 || p.lng > bb.lng2) continue;
            if (s[String(p.id)] === 1) continue;
            if (Object.keys(s).length >= MAX_BODU) { strop = true; break; }
            s[String(p.id)] = 1; pridano++;
        }
        if (pridano) uloz();
        return { pridano: pridano, celkem: Object.keys(s).length, strop: strop };
    }

    // ---- značky v mapě (roh, výřez) ---------------------------------------------------
    function rohUkaz(ll) {
        var m = mapa(); if (!m || typeof L === 'undefined') return;
        try {
            if (!_rohZnacka) _rohZnacka = L.circleMarker(ll, { radius: 8, color: '#38bdf8', weight: 3, fillColor: '#38bdf8', fillOpacity: 0.35, interactive: false, className: 'ag-dosah-roh' }).addTo(m);
            else _rohZnacka.setLatLng(ll);
        } catch (e) { swallow(e, 'rohUkaz'); }
    }
    function rohSmaz() {
        _roh = null;
        if (_rohZnacka) { try { _rohZnacka.remove(); } catch (e) { swallow(e, 'rohSmaz'); } _rohZnacka = null; }
    }
    function obdelnikUkaz(bb) {
        var m = mapa(); if (!m || typeof L === 'undefined') return;
        try {
            var b = [[bb.lat1, bb.lng1], [bb.lat2, bb.lng2]];
            if (!_obdelnik) _obdelnik = L.rectangle(b, { color: '#38bdf8', weight: 2, dashArray: '6,6', fillOpacity: 0.08, interactive: false, className: 'ag-dosah-vyrez' }).addTo(m);
            else _obdelnik.setBounds(b);
        } catch (e) { swallow(e, 'obdelnikUkaz'); }
    }
    function obdelnikSmaz() {
        if (_obdelnik) { try { _obdelnik.remove(); } catch (e) { swallow(e, 'obdelnikSmaz'); } _obdelnik = null; }
    }

    // ---- dva prsty = posun a zoom mapy -------------------------------------------------
    function prstyStred(t) { return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 }; }
    function prstyDist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    function pinchStart(t) {
        var m = mapa(); if (!m) return;
        _tah = null; if (_ram) _ram.style.display = 'none';
        var c = prstyStred(t);
        _pinch = { d0: prstyDist(t), z0: m.getZoom(), x: c.x, y: c.y };
        // mapa zůstane, kam ji dám — GPS fix ji nesmí vrátit na mě (tlačítko „Na mě" to vrátí)
        try { window._mapHold = true; } catch (e) { swallow(e, 'pinchStart'); }
    }
    function pinchPohyb(t) {
        var m = mapa(); if (!m || !_pinch) return;
        var c = prstyStred(t), d = prstyDist(t);
        try {
            // ZOOM kolem středu mezi prsty (bod na obrazovce → bod mapy přes otočení)
            if (_pinch.d0 > 0 && d > 0 && typeof window.agScreenToLatLng === 'function') {
                var nz = _pinch.z0 + Math.log2(d / _pinch.d0);
                nz = Math.max(m.getMinZoom(), Math.min(m.getMaxZoom(), nz));
                var ll = window.agScreenToLatLng(c.x, c.y);
                if (ll && Math.abs(nz - m.getZoom()) > 0.001) m.setZoomAround(m.latLngToContainerPoint(ll), nz, { animate: false });
            }
            // POSUN: pohyb středu prstů otočený do souřadnic mapy (jako v grafika.js)
            var dx = c.x - _pinch.x, dy = c.y - _pinch.y;
            if (dx || dy) {
                var rad = rotace() * Math.PI / 180;
                var lx = dx * Math.cos(rad) - dy * Math.sin(rad), ly = dx * Math.sin(rad) + dy * Math.cos(rad);
                m.panBy([-lx, -ly], { animate: false });
            }
        } catch (e) { swallow(e, 'pinchPohyb'); }
        _pinch.x = c.x; _pinch.y = c.y;
    }
    function pinchKonec() { _pinch = null; }

    // ---- dokončení výřezu -----------------------------------------------------------------
    function plural(n) { if (n === 1) return 'bod'; if (n >= 2 && n <= 4) return 'body'; return 'bodů'; }
    function vzdalenost(a, b, c, d) {
        try { if (typeof getDistance === 'function') return getDistance(a, b, c, d); } catch (e) { swallow(e, 'vzdalenost'); }
        var m = 111320, k = Math.cos((a + c) / 2 * Math.PI / 180);
        return Math.hypot((c - a) * m, (d - b) * m * k);
    }
    function hotovVyrez(bb) {
        obdelnikUkaz(bb);
        // 1) co už v telefonu je, vybrat HNED (i bez signálu)
        var r = seber(bb);
        prekresli();
        if (r.strop) { srovnejListu('Víc než ' + MAX_BODU + ' bodů to nepustí — nejdřív něco odeber.'); return; }
        var zprava = r.pridano ? ('Přidáno ' + r.pridano + ' ' + plural(r.pridano) + '. Vybráno celkem ' + r.celkem + '.') : 'V tom obdélníku zatím žádný bod není.';
        // 2) dostáhnout z ČÚZK body, které appka pro tohle území ještě neměla
        var clat = (bb.lat1 + bb.lat2) / 2, clng = (bb.lng1 + bb.lng2) / 2;
        var polomer = Math.ceil(vzdalenost(clat, clng, bb.lat2, bb.lng2)) + 10;
        if (typeof fetchGeodata !== 'function') { srovnejListu(zprava); return; }
        if (polomer > MAX_POLOMER_M) { srovnejListu(zprava + ' Výřez je na stažení z ČÚZK moc velký (přes ' + Math.round(MAX_POLOMER_M * 2 / 1000) + ' km napříč) — zmenši ho.'); return; }
        if (_stahuji) { srovnejListu(zprava); return; }
        _stahuji = true;
        srovnejListu(zprava + ' Stahuji body ČÚZK pro výřez…');
        Promise.resolve().then(function () { return fetchGeodata(clat, clng, polomer, false); }).then(function () {
            var r2 = seber(bb);
            if (r2.pridano) prekresli();
            var celkem = r.pridano + r2.pridano;
            if (r2.strop) srovnejListu('Víc než ' + MAX_BODU + ' bodů to nepustí — nejdřív něco odeber.');
            else if (!celkem) srovnejListu('V tom obdélníku žádný bod není — ani v bodovém poli ČÚZK.');
            else srovnejListu('Přidáno ' + celkem + ' ' + plural(celkem) + (r2.pridano ? ' (z toho ' + r2.pridano + ' čerstvě z ČÚZK)' : '') + '. Vybráno celkem ' + r2.celkem + '.');
        }).catch(function (e) {
            swallow(e, 'hotovVyrez:fetch');
            srovnejListu(zprava + ' ČÚZK teď neodpovídá — vybrané je jen to, co telefon už měl.');
        }).then(function () { _stahuji = false; });
    }

    function konecTahu(e) {
        if (_pinch) { if (!e.touches || e.touches.length < 2) pinchKonec(); _tah = null; if (_ram) _ram.style.display = 'none'; return; }
        if (!_tah) return;
        var b = bodZUdalosti(e);
        var a = _tah;
        _tah = null;
        if (_ram) _ram.style.display = 'none';
        if (Math.abs(b.x - a.x) < TAP_PX && Math.abs(b.y - a.y) < TAP_PX) { tuknuti(b); return; }
        var bb = vyberDoBodu(a, b);
        if (!bb) { srovnejListu('Výřez se nepodařilo přepočítat.'); return; }
        rohSmaz();
        hotovVyrez(bb);
    }
    // Ťuknutí: první = roh (značka v mapě), druhé = protější roh → výřez. Mezi nimi jde
    // mapou dvěma prsty posouvat — roh drží na svém místě v terénu, ne na obrazovce.
    function tuknuti(b) {
        var f = window.agScreenToLatLng;
        var ll = (typeof f === 'function') ? f(b.x, b.y) : null;
        if (!ll) { srovnejListu('Mapa ještě není připravená.'); return; }
        if (!_roh) {
            _roh = { lat: ll.lat, lng: ll.lng };
            rohUkaz(ll);
            srovnejListu('První roh je v mapě. Posuň si mapu dvěma prsty a ťukni na protější roh.');
            return;
        }
        var bb = bboxZLatLng([_roh, ll]);
        if (vzdalenost(bb.lat1, bb.lng1, bb.lat2, bb.lng2) < 5) { srovnejListu('Druhý roh je moc blízko prvního — ťukni dál.'); return; }
        rohSmaz();
        hotovVyrez(bb);
    }

    function srovnejListu(zprava) {
        if (!_lista) return;
        var t = _lista.querySelector('.txt');
        var n = pocet();
        if (t) {
            t.innerHTML = zprava
                ? esc(zprava)
                : (n ? ('V AR i v mapě je <b>' + n + ' ' + plural(n) + '</b> mimo dosah. Další výřez: táhni, nebo ťukni na dva rohy. Dvěma prsty posuneš mapu.')
                    : 'Táhni prstem obdélník přes body, které chceš vidět i z dálky — nebo ťukni na jeden roh a pak na protější. Dvěma prsty posuneš mapu.');
        }
        var z = _lista.querySelector('#ag-dosah-zrus');
        if (z) z.style.display = n ? '' : 'none';
    }

    function zapniVyber() {
        if (_vrstva) return;
        styly();
        // V čisté kameře není mapa vidět, takže není kam kreslit — přepneme na Split.
        try {
            if (typeof viewMode !== 'undefined' && viewMode === 'ar') {
                viewMode = 'both';
                if (typeof applyViewMode === 'function') applyViewMode();
                if (typeof window.agSyncViewControls === 'function') window.agSyncViewControls();
            }
        } catch (e) { swallow(e, 'zapniVyber:view'); }

        _vrstva = document.createElement('div');
        _vrstva.id = 'ag-dosah-vrstva';
        _ram = document.createElement('div');
        _ram.id = 'ag-dosah-ram';
        _lista = document.createElement('div');
        _lista.id = 'ag-dosah-lista';
        _lista.innerHTML = '<span class="txt"></span>'
            + '<button type="button" id="ag-dosah-zrus">Zrušit výběr</button>'
            + '<button type="button" class="hl" id="ag-dosah-hotovo">Hotovo</button>';
        document.body.appendChild(_vrstva);
        document.body.appendChild(_ram);
        document.body.appendChild(_lista);
        srovnejListu('');

        _lista.querySelector('#ag-dosah-hotovo').addEventListener('click', vypniVyber);
        _lista.querySelector('#ag-dosah-zrus').addEventListener('click', function () {
            zrus(); obdelnikSmaz(); rohSmaz(); srovnejListu('Výběr zrušen — v AR jsou zase jen body do nastaveného dosahu.');
        });

        var start = function (e) {
            if (e.touches && e.touches.length >= 2) { pinchStart(e.touches); if (e.cancelable) e.preventDefault(); return; }
            if (_pinch) return;
            _tah = bodZUdalosti(e);
            ramNa(_tah, _tah);
            if (e.cancelable) e.preventDefault();
        };
        var pohyb = function (e) {
            if (e.touches && e.touches.length >= 2) {
                if (!_pinch) pinchStart(e.touches); else pinchPohyb(e.touches);
                if (e.cancelable) e.preventDefault(); return;
            }
            if (!_tah) return;
            ramNa(_tah, bodZUdalosti(e));
            if (e.cancelable) e.preventDefault();
        };
        _vrstva.addEventListener('touchstart', start, { passive: false });
        _vrstva.addEventListener('touchmove', pohyb, { passive: false });
        _vrstva.addEventListener('touchend', konecTahu);
        _vrstva.addEventListener('touchcancel', function (e) { if (!e.touches || !e.touches.length) pinchKonec(); _tah = null; if (_ram) _ram.style.display = 'none'; });
        _vrstva.addEventListener('mousedown', start);
        _vrstva.addEventListener('mousemove', pohyb);
        _vrstva.addEventListener('mouseup', konecTahu);
    }
    function vypniVyber() {
        [_vrstva, _ram, _lista].forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
        _vrstva = _ram = _lista = null; _tah = null; _pinch = null;
        rohSmaz(); obdelnikSmaz();
        var n = pocet();
        if (n) toast('V AR i v mapě se teď ukáže ' + n + ' vzdálených ' + (n === 1 ? 'bod' : 'bodů') + '.');
    }

    function otevri() {
        if (_vrstva) { vypniVyber(); return; }
        zapniVyber();
    }

    // ---- zapojení do appky -----------------------------------------------------------
    function registruj() {
        if (typeof window.agRegisterFieldTool !== 'function') return false;
        window.agRegisterFieldTool({
            id: 'ar-dosah', label: 'Vzdálené body do AR', icon: ICON,
            cat: 'Srovnat AR', order: 45, onClick: otevri
        });
        return true;
    }
    function init() {
        styly();
        if (!registruj()) {
            // launcher se ještě nenačetl — zkusit ještě jednou po startu
            window.addEventListener('load', function () { setTimeout(registruj, 400); });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.agOpenArDosah = otevri;
    window.AGDosah = { vzdy: vzdy, pocet: pocet, zrus: zrus, open: otevri };
})();
