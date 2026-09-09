// ===== AR Geodet — VZDÁLENÉ BODY DO AR: výběr výřezem mapy (ODPOJITELNÁ vrstva) ==
// Na přání 8. 9. 2026: „když budu chtít bod, který je někde v dálce a nezobrazuje
// se mi v AR, protože mám omezenou vzdálenost, a budu si z toho území to chtít vzít
// třeba 2 km daleko — natáhl bych tam čtvereček a zobrazily by se mi ještě body
// v tom území a viděl bych je také v ARku."
//
// CO TO DĚLÁ: prstem se v mapě natáhne obdélník, body uvnitř dostanou příznak
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
    var MAX_BODU = 400;               // strop výběru, ať se řez nezruší úplně
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
                    if (p.currentDist == null) p.currentDist = getDistance(userLat, userLng, p.lat, p.lng);
                    if (p.currentBearing == null) p.currentBearing = getBearing(userLat, userLng, p.lat, p.lng);
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
    var _vrstva = null, _ram = null, _lista = null, _tah = null;

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
        var lat1 = rohy[0].lat, lat2 = rohy[0].lat, lng1 = rohy[0].lng, lng2 = rohy[0].lng;
        for (i = 1; i < rohy.length; i++) {
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
            if (!p || p.lat == null || p.lng == null) continue;
            if (p.lat < bb.lat1 || p.lat > bb.lat2 || p.lng < bb.lng1 || p.lng > bb.lng2) continue;
            if (s[String(p.id)] === 1) continue;
            if (Object.keys(s).length >= MAX_BODU) { strop = true; break; }
            s[String(p.id)] = 1; pridano++;
        }
        if (pridano) uloz();
        return { pridano: pridano, celkem: Object.keys(s).length, strop: strop };
    }

    function konecTahu(e) {
        if (!_tah) return;
        var b = bodZUdalosti(e);
        var a = _tah;
        _tah = null;
        if (_ram) _ram.style.display = 'none';
        // Ťuknutí bez tažení není výběr — jinak by každé omylem klepnutí do mapy
        // sebralo bod pod prstem a nikdo by nevěděl proč.
        if (Math.abs(b.x - a.x) < 24 || Math.abs(b.y - a.y) < 24) { srovnejListu('Natáhni obdélník — samotné ťuknutí nestačí.'); return; }
        var bb = vyberDoBodu(a, b);
        if (!bb) { srovnejListu('Výřez se nepodařilo přepočítat.'); return; }
        var r = seber(bb);
        prekresli();
        if (r.strop) srovnejListu('Víc než ' + MAX_BODU + ' bodů to nepustí — nejdřív něco odeber.');
        else if (!r.pridano) srovnejListu('V tom obdélníku žádný nový bod není.');
        else srovnejListu('Přidáno ' + r.pridano + ' ' + plural(r.pridano) + '. Vybráno celkem ' + r.celkem + '.');
    }
    function plural(n) { if (n === 1) return 'bod'; if (n >= 2 && n <= 4) return 'body'; return 'bodů'; }

    function srovnejListu(zprava) {
        if (!_lista) return;
        var t = _lista.querySelector('.txt');
        var n = pocet();
        if (t) {
            t.innerHTML = zprava
                ? esc(zprava)
                : (n ? ('V AR se ukáže <b>' + n + ' ' + plural(n) + '</b> i mimo dosah. Natáhni další obdélník, nebo dej Hotovo.')
                    : 'Natáhni prstem obdélník přes body, které chceš vidět v AR i z dálky.');
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
            zrus(); srovnejListu('Výběr zrušen — v AR jsou zase jen body do nastaveného dosahu.');
        });

        var start = function (e) {
            _tah = bodZUdalosti(e);
            ramNa(_tah, _tah);
            if (e.cancelable) e.preventDefault();
        };
        var pohyb = function (e) {
            if (!_tah) return;
            ramNa(_tah, bodZUdalosti(e));
            if (e.cancelable) e.preventDefault();
        };
        _vrstva.addEventListener('touchstart', start, { passive: false });
        _vrstva.addEventListener('touchmove', pohyb, { passive: false });
        _vrstva.addEventListener('touchend', konecTahu);
        _vrstva.addEventListener('touchcancel', function () { _tah = null; if (_ram) _ram.style.display = 'none'; });
        _vrstva.addEventListener('mousedown', start);
        _vrstva.addEventListener('mousemove', pohyb);
        _vrstva.addEventListener('mouseup', konecTahu);
    }
    function vypniVyber() {
        [_vrstva, _ram, _lista].forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
        _vrstva = _ram = _lista = null; _tah = null;
        var n = pocet();
        if (n) toast('V AR se teď ukáže ' + n + ' vzdálených ' + (n === 1 ? 'bod' : 'bodů') + '.');
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
