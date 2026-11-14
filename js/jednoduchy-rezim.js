// ===== QTRIG — JEDNODUCHÝ REŽIM (ODPOJITELNÁ vrstva) ========================
// Celá appka schovaná za dvě tlačítka: PŘIDAT BOD a NAVIGOVAT K BODU.
//
// PROČ: appka umí přes 60 nástrojů, mapu, katastr, AR a firemní účty. To je
// správně pro geodeta, ale ne pro den, kdy potřebuješ jen „označit si místo" a
// „dojít zpátky" — nebo pro člověka, kterému appku půjčíš do ruky. Zapnutý
// jednoduchý režim proto NEschovává funkce do podmenu, on je celé vypne: není
// vidět mapa, kamera, dok, HUD ani nástroje. Zůstane holá obrazovka se dvěma
// tlačítky.
//
// CO REŽIM UMÍ (a nic víc — to je jeho smysl):
//   • PŘIDAT BOD  → název (předvyplněný dalším číslem série) + jedna volba
//                   „Z GPS" (6 s průměrování na místě) nebo „Ručně" (Y, X
//                   v S-JTSK) → ULOŽIT.
//   • NAVIGOVAT   → seznam bodů OD NEJBLIŽŠÍHO PO NEJVZDÁLENĚJŠÍ — moje body zakázky
//                   a od 19. 9. 2026 i ÚŘEDNÍ BODY (ČÚZK: TB, ZhB, PPBP, nivelační, tíhové)
//                   stažené kolem mé polohy (arPoints; stahuje je logika.js podle GPS
//                   i v tomhle režimu), s malým štítkem druhu; po klepnutí
//                   celoobrazovková šipka + vzdálenost.
//   • malý odkaz „Celá appka" vpravo nahoře → zpátky do plné appky.
//   • MAPA (4. 11. 2026, přání: „hodila by se tam i mapa, ale ať je to pořád jednoduchý
//     režim"): na domovské stránce okno s mapou appky (táž vektorová mapa, žádná druhá
//     instance — prvek #map se do okna jen PŘESUNE a při odchodu vrátí). Bez vrstev,
//     tlačítek a otáčení; klepnutí na bod v mapě = navigace k němu. V navigaci menší
//     mapa s čarou k cíli. Nic jiného z plné appky klepnutím do mapy otevřít nejde
//     (modály plné appky leží POD přebalem a otevřely by se neviditelně).
//   • POSLAT BOD z navigace (odkaz ?bod= z js/hledat-misto.js, jinak souřadnice).
//   • 14. 11. 2026 (přání: „jednoduchý mód je pomalu ta nejlepší verze … ale appka měla
//     pointu té kamery"):
//       – mapou jde hýbat prstem (posun, dva prsty = zoom, kolečko myši). Ovládání mapy
//         v plné appce visí na #map-container (grafika.js), takže v okně režimu nefungovalo
//         vůbec — tady má vlastní. Posun vypne sledování polohy (window._mapHold) a objeví
//         se tlačítko „Vycentrovat", stejně jako v plné appce.
//       – přepínač MAPA / KAMERA: místo mapy živý obraz s body v AR (#camera-container se
//         do okna přesune stejně jako mapa). Volba se pamatuje (agJrPohled_v1).
//       – klepnutí na bod (v mapě i na značku v kameře) = KARTA BODU (souřadnice, výška,
//         vzdálenost, azimut) s tlačítkem Navigovat. Dřív rovnou navigace.
//       – NÁSTROJE schované pod malým tlačítkem vpravo nahoře: napoprvé si uživatel vybere
//         nejvýš 10 nástrojů, pak vidí jen je (výběr jde kdykoli změnit). Nástroj se
//         spustí klepnutím na svou dlaždici v mřížce (jako js/nastroje-ukony.js — platí
//         práva rolí, zámky Pro i počítání použití). Okna nástrojů leží POD přebalem,
//         proto se přebal na dobu nástroje SCHOVÁ (pauza) a vrátí se sám, až se okno
//         nástroje zavře — nebo tlačítkem „Jednoduchý režim" nahoře.
//
// NEINVAZIVNÍ: NEEDITUJE logika.js ani grafika.js. Body ukládá JEDINOU
// oficiální cestou — window.addImportedPoints() (stejně jako import, hlasové
// kódování i brutální GPS), takže platí dedup, žurnál, Helmertova lokalizace
// i provenience bodu. Vypnutím režimu je appka přesně tam, kde byla.
//
// BATERIE: při zapnutí se zastaví kamera a zobrazení se přepne na „Mapa"
// (nejlevnější režim appky) — kamera pod neprůhledným přebalem by jela naprázdno.
// Původní zobrazení se při odchodu vrátí. Kompas běží dál, bez něj by nešla
// šipka. Přepočet navigace jede 5x/s, ne na každou událost kompasu (~60/s).
//
// ZAPÍNÁ SE: Nastavení → Vzhled → Ovládání → „Jednoduchý režim".
// Volba je GLOBÁLNÍ (ne per zakázka) a přežije restart — kdo si appku takhle
// nastavil, chce ji tak mít i zítra.
//
// Odstranění: smaž js/jednoduchy-rezim.js + css/jednoduchy-rezim.css + jejich
// dva řádky v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agJrInit) return;
    window.__agJrInit = true;

    var KEY = 'agJednoduchy_v1';       // '1' = režim zapnut (globální, ne per zakázka)
    var AVG_MS = 6000;                 // délka průměrování GPS u „Z GPS"
    var TICK_MS = 200;                 // přepočet navigace i vzdáleností v seznamu
    var DOMA_M = 0.5;                  // pod tuhle vzdálenost hlásíme „JSI NA BODĚ"

    var root = null, stranky = {}, aktivni = 'home';
    var tick = null;                   // interval běžící jen když je co počítat
    var cil = null;                    // bod, ke kterému se právě naviguje
    var doma = false;                  // už jsme na bodu ohlásili příchod?
    var predchoziView = null;          // zobrazení appky před zapnutím režimu
    var novy = null;                   // rozdělaný bod: {lat, lng, acc, vyska, zpusob}
    var avgT = null, avgDo = 0, avgVzorky = [];
    var filtr = '';
    var POHLED_KEY = 'agJrPohled_v1';  // 'kamera' | 'mapa' — co ukazuje okno na domovské stránce
    var NAS_KEY = 'agJrNastroje_v1';   // JSON pole klíčů dlaždic, které si uživatel vybral
    var NAS_MAX = 10;
    var karta = null;                  // bod, jehož karta je otevřená

    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, 'jednoduchy-rezim:' + kde); } catch (e2) { /* ani logovat nejde */ } }

    // ---- most k appce: všechno přes typeof, ať modul přežije i odpojení jádra ----
    function zapnuto() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
    function nastav(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { swallow(e, 'nastav'); } }
    function maFix() { try { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); } catch (e) { return false; } }
    // úřední body (ČÚZK) stažené kolem mé polohy — vše v arPoints, co není moje (CUSTOM) ani schované
    function uredni() {
        try {
            if (typeof arPoints === 'undefined' || !Array.isArray(arPoints)) return [];
            var out = [], viden = {};
            for (var i = 0; i < arPoints.length; i++) {
                var p = arPoints[i];
                if (!p || p.cat === 'CUSTOM' || p.hidden || typeof p.lat !== 'number' || typeof p.lng !== 'number' || viden[p.id]) continue;
                viden[p.id] = 1; out.push(p);
            }
            return out;
        } catch (e) { return []; }
    }
    function katLabel(c) { return { TB: 'TB', ZHB: 'ZhB', PBPP: 'PPBP', NIVEL: 'nivelační', TIHA: 'tíhový' }[c] || 'úřední'; }
    var UREDNICH_MAX = 80;             // v seznamu nejvýš 80 nejbližších úředních bodů (hledáním se najde kterýkoli)
    function body() {
        try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; }
        catch (e) { return []; }
    }
    function vzdal(la1, lo1, la2, lo2) {
        try { if (typeof getDistance === 'function') return getDistance(la1, lo1, la2, lo2); } catch (e) { swallow(e, 'vzdal'); }
        var R = 6371000, r = Math.PI / 180;
        var a = Math.sin((la2 - la1) * r / 2), b = Math.sin((lo2 - lo1) * r / 2);
        var c = a * a + Math.cos(la1 * r) * Math.cos(la2 * r) * b * b;
        return 2 * R * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
    }
    function azimut(la1, lo1, la2, lo2) {
        try { if (typeof getBearing === 'function') return getBearing(la1, lo1, la2, lo2); } catch (e) { swallow(e, 'azimut'); }
        var r = Math.PI / 180, d = (lo2 - lo1) * r;
        var y = Math.sin(d) * Math.cos(la2 * r);
        var x = Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos(d);
        return (Math.atan2(y, x) / r + 360) % 360;
    }
    // Směr, kam je otočený telefon. smoothedHeading je null, dokud nepřijde první
    // událost kompasu (počítač, zamítnuté povolení na iOS) — pak šipku neukazujeme
    // jako pravdu, ale řekneme azimut číslem.
    function smer() {
        try {
            if (typeof smoothedHeading === 'number' && isFinite(smoothedHeading)) return smoothedHeading;
        } catch (e) { swallow(e, 'smer'); }
        return null;
    }
    function toast(t) { try { if (typeof quickToast === 'function') quickToast(t); } catch (e) { swallow(e, 'toast'); } }
    function vibruj(p) { try { if (typeof agVibe === 'function') agVibe(p); } catch (e) { swallow(e, 'vibruj'); } }
    // překlad věty se zástupci {n}… (13. 10. 2026); česky vrací přesně původní text
    function T(cs, o) { var v = cs; try { if (window.AGJazyk) v = AGJazyk.t(cs); } catch (e) { v = cs; } return o ? v.replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }) : v; }
    function cislo(n, des) { return String(n.toFixed(des == null ? 1 : des)).replace('.', ','); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    // ---- stavba obrazovek (jednou; pak se jen přepínají) -------------------------
    function ikona(id, tridy) { return '<svg class="' + (tridy || 'icon') + '" aria-hidden="true"><use href="#' + id + '"/></svg>'; }

    function build() {
        if (root) return root;
        root = document.createElement('div');
        root.id = 'ag-jr';
        root.setAttribute('data-no-swipe', '');   // gesta appky sem nepatří, jsou to jiné obrazovky
        root.innerHTML = ''
            // ---------- domů ----------
            + '<section class="jr-page" id="ag-jr-home">'
            + '  <div class="jr-top"><div class="jr-stav" id="ag-jr-stav">Hledám GPS…</div>'
            + '    <button type="button" class="jr-maly jr-ikonka" id="ag-jr-nas-btn" aria-label="Nástroje" title="Nástroje">' + ikona('i-grid') + '</button>'
            + '    <button type="button" class="jr-maly" id="ag-jr-konec">Celá appka</button></div>'
            + '  <div class="jr-mapa" id="ag-jr-mapa-home" hidden>'
            + '    <button type="button" class="jr-pohled" id="ag-jr-pohled" data-jr-ovl></button>'
            + '    <button type="button" class="jr-mapa-ja" data-jr-ja aria-label="Vycentrovat na mou polohu" hidden>' + ikona('i-locate') + '<span>Vycentrovat</span></button>'
            + '    <div class="jr-mapa-tip" id="ag-jr-tip">klepni na bod = informace</div>'
            + '    <div class="jr-karta" id="ag-jr-karta" data-jr-ovl hidden></div>'
            + '  </div>'
            + '  <div class="jr-souhrn" id="ag-jr-souhrn"></div>'
            + '  <div class="jr-hlavni">'
            + '    <button type="button" class="jr-velke jr-velke-pridat" id="ag-jr-pridat">' + ikona('i-plus') + 'PŘIDAT BOD<small>tady stojím, ulož si to</small></button>'
            + '    <button type="button" class="jr-velke jr-velke-jit" id="ag-jr-jit">' + ikona('i-navigation') + 'NAVIGOVAT K BODU<small>šipka a vzdálenost</small></button>'
            + '  </div>'
            + '</section>'
            // ---------- nový bod ----------
            + '<section class="jr-page" id="ag-jr-new">'
            + '  <div class="jr-top"><div class="jr-stav" id="ag-jr-stav2">&nbsp;</div>'
            + '    <button type="button" class="jr-maly" data-jr-zpet="home">Zpět</button></div>'
            + '  <div class="jr-nadpis">Nový bod</div>'
            + '  <div class="jr-telo">'
            + '    <label class="jr-label" for="ag-jr-nazev">Název / číslo bodu</label>'
            + '    <input type="text" id="ag-jr-nazev" class="jr-vstup" autocomplete="off" placeholder="Např. 101">'
            + '    <label class="jr-label">Odkud souřadnice</label>'
            + '    <div class="jr-zpusob">'
            + '      <button type="button" id="ag-jr-zgps">' + ikona('i-locate') + 'Z GPS</button>'
            + '      <button type="button" id="ag-jr-zruky">' + ikona('i-edit') + 'Ručně</button>'
            + '    </div>'
            + '    <div id="ag-jr-rucne" hidden>'
            + '      <div class="jr-dvojice">'
            + '        <div><label class="jr-label" for="ag-jr-y">' + agSys() + ' ' + agOsy().osaA + ' (m)</label><input type="text" id="ag-jr-y" class="jr-vstup" inputmode="decimal" autocomplete="off" placeholder="596956,46"></div>'
            + '        <div><label class="jr-label" for="ag-jr-x">' + agSys() + ' ' + agOsy().osaB + ' (m)</label><input type="text" id="ag-jr-x" class="jr-vstup" inputmode="decimal" autocomplete="off" placeholder="1163343,34"></div>'
            + '      </div>'
            + '    </div>'
            + '    <div class="jr-vysledek" id="ag-jr-vysledek" hidden></div>'
            + '  </div>'
            + '  <div class="jr-pata"><button type="button" class="jr-ulozit" id="ag-jr-ulozit" disabled>ULOŽIT</button></div>'
            + '</section>'
            // ---------- seznam bodů ----------
            + '<section class="jr-page" id="ag-jr-list">'
            + '  <div class="jr-top"><div class="jr-stav" id="ag-jr-stav3">&nbsp;</div>'
            + '    <button type="button" class="jr-maly" data-jr-zpet="home">Zpět</button></div>'
            + '  <div class="jr-nadpis">Kam jít?</div>'
            + '  <input type="search" id="ag-jr-hledat" class="jr-vstup" placeholder="Hledat číslo bodu…" autocomplete="off" hidden>'
            + '  <div class="jr-telo" id="ag-jr-seznam"></div>'
            + '</section>'
            // ---------- navigace ----------
            + '<section class="jr-page" id="ag-jr-go">'
            + '  <div class="jr-top"><div class="jr-stav" id="ag-jr-stav4">&nbsp;</div>'
            + '    <button type="button" class="jr-maly" data-jr-zpet="list">Zpět</button></div>'
            + '  <div class="jr-cil" id="ag-jr-cilnazev">—</div>'
            + '  <div class="jr-sipka-box">'
            + '    <svg id="ag-jr-sipka" viewBox="0 0 100 100" aria-hidden="true">'
            + '      <path id="ag-jr-sipka-tvar" d="M50 6 L92 52 L68 52 L68 94 L32 94 L32 52 L8 52 Z" fill="var(--color-arrow)"/>'
            + '    </svg>'
            + '  </div>'
            + '  <div class="jr-vzdalenost" id="ag-jr-vzd">—</div>'
            + '  <div class="jr-pozn" id="ag-jr-pozn">&nbsp;</div>'
            + '  <div class="jr-mapa jr-mapa-go" id="ag-jr-mapa-go" hidden><button type="button" class="jr-mapa-ja" data-jr-ja aria-label="Vycentrovat" hidden>' + ikona('i-locate') + '<span>Vycentrovat</span></button></div>'
            + '  <button type="button" class="jr-maly jr-poslat" id="ag-jr-poslat">Poslat bod</button>'
            + '</section>'
            // ---------- nástroje (vrstva nad domovskou stránkou) ----------
            + '<section class="jr-nas" id="ag-jr-nas" hidden>'
            + '  <div class="jr-top"><div class="jr-nadpis jr-nas-nadpis" id="ag-jr-nas-nadpis">Nástroje</div>'
            + '    <button type="button" class="jr-maly" id="ag-jr-nas-zavri">Zavřít</button></div>'
            + '  <div class="jr-nas-info" id="ag-jr-nas-info"></div>'
            + '  <input type="search" id="ag-jr-nas-hledat" class="jr-vstup" placeholder="Hledat nástroj…" autocomplete="off" hidden>'
            + '  <div class="jr-telo" id="ag-jr-nas-seznam"></div>'
            + '  <div class="jr-pata" id="ag-jr-nas-pata"></div>'
            + '</section>';
        document.body.appendChild(root);

        ['home', 'new', 'list', 'go'].forEach(function (k) { stranky[k] = root.querySelector('#ag-jr-' + k); });

        root.querySelector('#ag-jr-konec').addEventListener('click', function () { vypni(); });
        root.querySelector('#ag-jr-pridat').addEventListener('click', otevriNovy);
        root.querySelector('#ag-jr-jit').addEventListener('click', otevriSeznam);
        Array.prototype.forEach.call(root.querySelectorAll('[data-jr-zpet]'), function (b) {
            b.addEventListener('click', function () { zpet(b.getAttribute('data-jr-zpet')); });
        });
        root.querySelector('#ag-jr-zgps').addEventListener('click', zmerGps);
        root.querySelector('#ag-jr-zruky').addEventListener('click', prepniRucne);
        root.querySelector('#ag-jr-ulozit').addEventListener('click', uloz);
        root.querySelector('#ag-jr-nazev').addEventListener('input', prepocitejUlozit);
        root.querySelector('#ag-jr-y').addEventListener('input', rucneZmena);
        root.querySelector('#ag-jr-x').addEventListener('input', rucneZmena);
        root.querySelector('#ag-jr-poslat').addEventListener('click', poslatBod);
        Array.prototype.forEach.call(root.querySelectorAll('.jr-mapa'), function (slot) { hlidejKlepnutiDoMapy(slot); hlidejGesta(slot); });
        Array.prototype.forEach.call(root.querySelectorAll('[data-jr-ja]'), function (b) {
            b.addEventListener('click', function (e) { e.stopPropagation(); vycentruj(); });
        });
        root.querySelector('#ag-jr-pohled').addEventListener('click', function (e) { e.stopPropagation(); prepniPohled(); });
        root.querySelector('#ag-jr-nas-btn').addEventListener('click', otevriNastroje);
        root.querySelector('#ag-jr-nas-zavri').addEventListener('click', zavriNastroje);
        var nh = root.querySelector('#ag-jr-nas-hledat');
        nh.addEventListener('input', function () { _nasFiltr = nh.value.trim().toLowerCase(); vykresliNastroje(); });
        var h = root.querySelector('#ag-jr-hledat');
        h.addEventListener('input', function () { filtr = h.value.trim().toLowerCase(); vykresliSeznam(); });
        return root;
    }

    // ---- přepínání obrazovek -----------------------------------------------------
    function ukaz(kam) {
        var bylo = aktivni;
        aktivni = kam;
        Object.keys(stranky).forEach(function (k) {
            if (stranky[k]) stranky[k].classList.toggle('jr-vidno', k === kam);
        });
        zavriKartu();
        if (kam === 'home') {
            if (pohled() === 'kamera' && kameraDo(true)) { /* okno drží kamera */ }
            else { kameraDo(false); mapaDo('#ag-jr-mapa-home'); }
            souhrn();
        } else {
            kameraDo(false);
            if (kam === 'go') mapaDo('#ag-jr-mapa-go'); else mapaDo(null);
        }
        if (kam !== bylo && (kam === 'home' || kam === 'go')) window._mapHold = false;   // nová stránka = zase sledovat polohu
        if (kam !== 'go') caraPryc();
        obnovPohledBtn();
        hlidejTik();
    }

    // ---- MAPA V JEDNODUCHÉM REŽIMU (4. 11. 2026) ------------------------------------
    // Prvek #map (Leaflet + vektorová mapa) se PŘESUNE do okna stránky a při odchodu
    // vrátí na původní místo (#map-wrapper). Druhá mapa by stála paměť a stahování
    // znovu; tahle je hotová, s body i polohou. Mimo #map-wrapper se neotáčí podle
    // kompasu (js/map-rotate.js otáčí obal) — v jednoduchém režimu je sever nahoře.
    var _mapaDomov = null, _mapaSlot = null, _cara = null;
    function leafletMapa() { try { return (typeof map !== 'undefined' && map && typeof map.invalidateSize === 'function') ? map : null; } catch (e) { return null; } }
    function mapaDo(sel) {
        var el = document.getElementById('map'), m = leafletMapa();
        var slot = sel ? root.querySelector(sel) : null;
        Array.prototype.forEach.call(root.querySelectorAll('.jr-mapa'), function (s) { s.hidden = !((el && m && s === slot) || (_kamera && s.id === 'ag-jr-mapa-home')); });
        if (!el || !m) return;
        if (!slot) {
            if (_mapaDomov && el.parentNode !== _mapaDomov.parent) {
                try { _mapaDomov.parent.insertBefore(el, _mapaDomov.next && _mapaDomov.next.parentNode === _mapaDomov.parent ? _mapaDomov.next : null); } catch (e) { swallow(e, 'mapaZpet'); }
                setTimeout(function () { try { m.invalidateSize(false); } catch (e) { swallow(e, 'mapaZpetSize'); } }, 30);
            }
            _mapaSlot = null;
            return;
        }
        if (!_mapaDomov || el.parentNode === _mapaDomov.parent) _mapaDomov = { parent: el.parentNode, next: el.nextSibling };
        if (el.parentNode !== slot) slot.insertBefore(el, slot.firstChild);
        var novy = _mapaSlot !== sel;
        _mapaSlot = sel;
        setTimeout(function () {
            try { m.invalidateSize(false); } catch (e) { swallow(e, 'mapaSize'); }
            if (novy && sel === '#ag-jr-mapa-home') naMe(false);
        }, 30);
    }
    function naMe(animuj) {
        var m = leafletMapa(); if (!m || !maFix()) return;
        try { m.setView([userLat, userLng], Math.max(m.getZoom() || 0, 17), { animate: !!animuj }); } catch (e) { swallow(e, 'naMe'); }
    }
    // „Vycentrovat": zapne zpátky sledování polohy (jako #map-recenter v plné appce).
    // V navigaci místo středu na mně ukáže zase celou čáru ke konci.
    function vycentruj() {
        window._mapHold = false;
        var m = leafletMapa();
        if (aktivni === 'go' && _cara && m) { try { m.fitBounds(_cara.getBounds(), { padding: [28, 28], maxZoom: 19, animate: true }); } catch (e) { swallow(e, 'vycentrujGo'); } }
        else naMe(true);
        obnovNaMe();
    }
    // tlačítko „Vycentrovat" jen když mapa nesleduje polohu (uživatel s ní pohnul)
    var _drzi = null;
    function obnovNaMe() {
        var d = !!window._mapHold && !_kamera;
        if (d === _drzi) return;
        _drzi = d;
        Array.prototype.forEach.call(root.querySelectorAll('[data-jr-ja]'), function (b) { b.hidden = !d; });
    }

    // ---- POSUN A ZOOM PRSTEM (14. 11. 2026) -----------------------------------------
    // Leaflet má vlastní tažení vypnuté (logika.js: dragging:false, touchZoom:false) —
    // mapu v plné appce posouvá grafika.js posluchači na #map-container. Jenže v okně
    // jednoduchého režimu #map v #map-container NENÍ, takže se mapou nedalo hnout vůbec.
    // Tady je tedy totéž v malém: jeden prst = posun, dva prsty = zoom kolem středu prstů,
    // myš = tažení a kolečko. Sever je v okně vždy nahoře, takže posun se nepřepočítává.
    var _posunT = 0;                   // kdy naposledy skončil posun (klepnutí hned po něm není klepnutí)
    function bodVOkne(m, x, y) { return m.mouseEventToContainerPoint({ clientX: x, clientY: y }); }
    function hlidejGesta(slot) {
        var g = null;
        var mimo = function (e) { return _kamera || (e.target && e.target.closest && e.target.closest('button, [data-jr-ovl]')); };
        var vzd2 = function (t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1; };
        var stred2 = function (t) { return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 }; };
        var zacni = function (t, m) {
            if (t.length >= 2) g = { dva: true, d: vzd2(t), z: m.getZoom(), pohnul: true };
            else g = { dva: false, x: t[0].clientX, y: t[0].clientY, sx: t[0].clientX, sy: t[0].clientY, pohnul: g ? g.pohnul : false };
        };
        slot.addEventListener('touchstart', function (e) {
            if (mimo(e)) return;
            var m = leafletMapa(); if (!m) return;
            zacni(e.touches, m);
        }, { passive: true });
        slot.addEventListener('touchmove', function (e) {
            if (!g) return;
            var m = leafletMapa(); if (!m) return;
            if (e.cancelable) e.preventDefault();
            var t = e.touches;
            try {
                if (g.dva && t.length >= 2) {
                    var z = Math.max(m.getMinZoom(), Math.min(m.getMaxZoom(), g.z + Math.log(vzd2(t) / g.d) / Math.LN2));
                    var c = stred2(t);
                    m.setZoomAround(bodVOkne(m, c.x, c.y), z, { animate: false });
                    window._mapHold = true;
                } else if (!g.dva && t.length === 1) {
                    var dx = t[0].clientX - g.x, dy = t[0].clientY - g.y;
                    if (!g.pohnul && Math.hypot(t[0].clientX - g.sx, t[0].clientY - g.sy) < 8) return;   // chvění prstu při klepnutí
                    g.pohnul = true;
                    m.panBy([-dx, -dy], { animate: false });
                    g.x = t[0].clientX; g.y = t[0].clientY;
                    window._mapHold = true;
                }
            } catch (er) { swallow(er, 'gesto'); }
            obnovNaMe();
        }, { passive: false });
        var konec = function (e) {
            if (!g) return;
            var m = leafletMapa();
            if (g.pohnul) _posunT = Date.now();
            if (e.touches && e.touches.length === 1 && m) { g.dva = false; zacni(e.touches, m); g.pohnul = true; return; }
            if (!e.touches || !e.touches.length) g = null;
        };
        slot.addEventListener('touchend', konec);
        slot.addEventListener('touchcancel', konec);
        // myš (počítač, tablet s myší)
        var mys = null;
        slot.addEventListener('mousedown', function (e) {
            if (e.button !== 0 || mimo(e) || !leafletMapa()) return;
            mys = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pohnul: false };
        });
        window.addEventListener('mousemove', function (e) {
            if (!mys) return;
            var m = leafletMapa(); if (!m) { mys = null; return; }
            if (!mys.pohnul && Math.hypot(e.clientX - mys.sx, e.clientY - mys.sy) < 5) return;
            mys.pohnul = true;
            try { m.panBy([mys.x - e.clientX, mys.y - e.clientY], { animate: false }); } catch (er) { swallow(er, 'mys'); }
            mys.x = e.clientX; mys.y = e.clientY;
            window._mapHold = true; obnovNaMe();
        });
        window.addEventListener('mouseup', function () { if (mys && mys.pohnul) _posunT = Date.now(); mys = null; });
        slot.addEventListener('wheel', function (e) {
            if (mimo(e)) return;
            var m = leafletMapa(); if (!m) return;
            e.preventDefault();
            try {
                var z = Math.max(m.getMinZoom(), Math.min(m.getMaxZoom(), m.getZoom() - Math.sign(e.deltaY) * 0.5));
                m.setZoomAround(bodVOkne(m, e.clientX, e.clientY), z, { animate: false });
            } catch (er) { swallow(er, 'kolecko'); }
            window._mapHold = true; obnovNaMe();
        }, { passive: false });
    }

    // Klepnutí do okna: CAPTURE zastaví událost dřív, než dojde do Leafletu nebo na
    // značku v kameře (jejich vlastní okna by se otevřela POD přebalem, neviditelně).
    // Místo toho se najde bod a ukáže se jeho KARTA. V mapě nejbližší bod do 36 px,
    // v kameře značka, na kterou prst padl.
    function hlidejKlepnutiDoMapy(slot) {
        ['click', 'dblclick', 'contextmenu'].forEach(function (typ) {
            slot.addEventListener(typ, function (e) {
                if (e.target && e.target.closest && e.target.closest('button, [data-jr-ovl]')) return;
                e.stopPropagation(); e.preventDefault();
                if (typ !== 'click' || aktivni !== 'home') return;
                if (Date.now() - _posunT < 350) return;          // konec tažení, ne klepnutí
                try {
                    var nej = null;
                    if (_kamera) {
                        var mk = e.target && e.target.closest && e.target.closest('.ar-marker');
                        if (mk && typeof arPoints !== 'undefined') arPoints.forEach(function (p) { if (!nej && p && p.element === mk) nej = p; });
                    } else {
                        var m = leafletMapa(); if (!m) return;
                        var bodKlik = m.mouseEventToContainerPoint(e), nejD = 36;
                        body().concat(uredni()).forEach(function (p) {
                            if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
                            var q = m.latLngToContainerPoint([p.lat, p.lng]);
                            var d = Math.hypot(q.x - bodKlik.x, q.y - bodKlik.y);
                            if (d < nejD) { nejD = d; nej = p; }
                        });
                    }
                    if (nej) otevriKartu(nej); else zavriKartu();
                } catch (er) { swallow(er, 'klikMapa'); }
            }, true);
        });
    }

    // ---- KARTA BODU (14. 11. 2026) ----------------------------------------------------
    function najdiBod(id) {
        var p = null;
        body().concat(uredni()).forEach(function (q) { if (!p && q.id === id) p = q; });
        if (!p) try { if (typeof arPoints !== 'undefined') arPoints.forEach(function (q) { if (!p && q && q.id === id) p = q; }); } catch (e) { swallow(e, 'najdiBod'); }
        return p;
    }
    function otevriKartu(p) {
        var el = root.querySelector('#ag-jr-karta'); if (!el || !p) return;
        karta = p;
        var moje = body().indexOf(p) >= 0 || p.cat === 'CUSTOM';
        var osy = { osaA: 'Y', osaB: 'X', vyska: 'Bpv' }, sys = 'S-JTSK', mi = null;
        try { if (typeof agOsy === 'function') osy = agOsy(); if (typeof agSys === 'function') sys = agSys(); } catch (e) { swallow(e, 'kartaOsy'); }
        try { if (typeof agMistni === 'function') mi = agMistni(p.lat, p.lng); } catch (e) { swallow(e, 'kartaMistni'); }
        var fm = function (v) { try { if (typeof agFmtM === 'function') return agFmtM(v).replace('.', ','); } catch (e) { swallow(e, 'fm'); } return cislo(v, 2); };
        var vyska = (p.vyska != null && isFinite(p.vyska)) ? Number(p.vyska) : null;
        var cluster = (p._arCluster && p._arCluster.length) ? p._arCluster.length : 0;
        var html = '<div class="jr-karta-hl"><b>' + esc(p.name || T('Bod')) + '</b>'
            + '<span class="jr-radek-kat">' + esc(moje ? T('můj bod') : katLabel(p.cat)) + '</span>'
            + '<button type="button" class="jr-karta-x" id="ag-jr-karta-x" aria-label="Zavřít">×</button></div>'
            + '<div class="jr-karta-vzd" id="ag-jr-karta-vzd">' + kartaVzd(p) + '</div>';
        if (mi && isFinite(mi.y) && isFinite(mi.x)) html += '<div class="jr-karta-r">' + esc(sys) + ' <span>' + esc(osy.osaA) + '</span> <b>' + fm(mi.y) + '</b> · <span>' + esc(osy.osaB) + '</span> <b>' + fm(mi.x) + '</b></div>';
        if (vyska != null) html += '<div class="jr-karta-r">' + T('Výška') + ' <span>' + esc(osy.vyska || 'Bpv') + '</span> <b>' + cislo(vyska, 2) + ' m</b></div>';
        if (p.kod) html += '<div class="jr-karta-r">' + T('Kód') + ' <b>' + esc(p.kod) + '</b></div>';
        if (cluster) html += '<div class="jr-karta-r jr-karta-pozn">' + T('Za ním je v záběru ještě {n} dalších bodů — přibliž se nebo je najdi v Navigovat.', { n: cluster }) + '</div>';
        html += '<button type="button" class="jr-karta-jit" id="ag-jr-karta-jit">' + ikona('i-navigation') + T('Navigovat sem') + '</button>';
        el.innerHTML = html;
        el.hidden = false;
        el.querySelector('#ag-jr-karta-x').addEventListener('click', function (e) { e.stopPropagation(); zavriKartu(); });
        el.querySelector('#ag-jr-karta-jit').addEventListener('click', function (e) { e.stopPropagation(); var id = p.id; zavriKartu(); naviguj(id); });
        vibruj(12);
    }
    function kartaVzd(p) {
        if (!maFix()) return T('Čekám na GPS.');
        var d = vzdal(userLat, userLng, p.lat, p.lng), az = azimut(userLat, userLng, p.lat, p.lng);
        return T('{d} od tebe · azimut {a}°', { d: '<b>' + popisD(d) + '</b>', a: cislo(az, 0) });
    }
    function zavriKartu() {
        karta = null;
        var el = root && root.querySelector('#ag-jr-karta');
        if (el) { el.hidden = true; el.innerHTML = ''; }
    }

    // ---- MAPA / KAMERA (14. 11. 2026) -------------------------------------------------
    // #camera-container (video + AR značky) se do okna PŘESUNE stejně jako mapa. Zobrazení
    // appky se přepne na „ar" (applyViewMode spustí kameru i značky); zpátky „map" kameru
    // zastaví — BATERIE: kamera jede jen na domovské stránce a jen v pohledu Kamera.
    var _kamera = false, _kamDomov = null;
    function pohled() { try { return localStorage.getItem(POHLED_KEY) === 'kamera' ? 'kamera' : 'mapa'; } catch (e) { return 'mapa'; } }
    function nastavPohled(v) { try { localStorage.setItem(POHLED_KEY, v); } catch (e) { swallow(e, 'nastavPohled'); } }
    function nastavView(v) {
        try {
            if (typeof viewMode === 'undefined' || viewMode === v) return;
            viewMode = v;
            if (typeof applyViewMode === 'function') applyViewMode();
        } catch (e) { swallow(e, 'nastavView'); }
    }
    function kameraDo(zap) {
        var cam = document.getElementById('camera-container');
        var slot = root && root.querySelector('#ag-jr-mapa-home');
        if (zap) {
            if (!cam || !slot || typeof applyViewMode !== 'function') return false;
            if (_kamera && cam.parentNode === slot) return true;
            mapaDo(null);                                // mapa domů (v plné appce teď nebude vidět)
            if (!_kamDomov || cam.parentNode === _kamDomov.parent) _kamDomov = { parent: cam.parentNode, next: cam.nextSibling };
            _kamera = true;
            slot.hidden = false;
            slot.classList.add('jr-kamera');
            slot.insertBefore(cam, slot.firstChild);
            nastavView('ar');
            return true;
        }
        if (!_kamera) return false;
        _kamera = false;
        nastavView('map');
        if (slot) slot.classList.remove('jr-kamera');
        if (cam && _kamDomov && cam.parentNode !== _kamDomov.parent) {
            try { _kamDomov.parent.insertBefore(cam, _kamDomov.next && _kamDomov.next.parentNode === _kamDomov.parent ? _kamDomov.next : null); } catch (e) { swallow(e, 'kameraZpet'); }
        }
        return false;
    }
    function prepniPohled() {
        var nove = pohled() === 'kamera' ? 'mapa' : 'kamera';
        nastavPohled(nove);
        zavriKartu();
        if (nove === 'kamera') { if (!kameraDo(true)) { nastavPohled('mapa'); toast(T('Kamera tu není k dispozici.')); } }
        else { kameraDo(false); mapaDo('#ag-jr-mapa-home'); window._mapHold = false; }
        obnovPohledBtn();
        vibruj(10);
    }
    function obnovPohledBtn() {
        var b = root && root.querySelector('#ag-jr-pohled'); if (!b) return;
        b.innerHTML = _kamera ? (ikona('i-map') + '<span>' + T('Mapa') + '</span>') : (ikona('i-camera') + '<span>' + T('Kamera') + '</span>');
        b.setAttribute('aria-label', _kamera ? T('Přepnout na mapu') : T('Přepnout na kameru'));
        var tip = root.querySelector('#ag-jr-tip');
        if (tip) tip.textContent = _kamera ? T('klepni na značku bodu = informace') : T('klepni na bod = informace');
        obnovNaMe();
    }
    // Kameru může appka sama vypnout (nepovolená kamera → handleCameraError přepne na
    // „map" a ukáže návod; dialog je nad přebalem). Pak okno vrátíme na mapu.
    function hlidejKameru() {
        if (!_kamera) return;
        try {
            if (typeof viewMode !== 'undefined' && viewMode === 'map') {
                _kamera = false;
                var slot = root.querySelector('#ag-jr-mapa-home'); slot.classList.remove('jr-kamera');
                var cam = document.getElementById('camera-container');
                if (cam && _kamDomov && cam.parentNode !== _kamDomov.parent) _kamDomov.parent.insertBefore(cam, _kamDomov.next && _kamDomov.next.parentNode === _kamDomov.parent ? _kamDomov.next : null);
                nastavPohled('mapa');
                if (aktivni === 'home') mapaDo('#ag-jr-mapa-home');
                obnovPohledBtn();
            }
        } catch (e) { swallow(e, 'hlidejKameru'); }
    }

    // ---- NÁSTROJE (14. 11. 2026) ------------------------------------------------------
    // Seznam si NEVEDE vlastní nástroje: čte dlaždice z mřížky #tools-modal a spouští je
    // klepnutím na dlaždici (stejně jako js/nastroje-ukony.js), takže platí práva rolí,
    // zámky Pro i počítání použití. Uživatel si vybere nejvýš 10 — víc by z malého
    // tlačítka udělalo zase celou appku.
    var _nasRezim = 'seznam', _nasVyber = [], _nasFiltr = '';
    function tileKey(t) {
        var dt = t.getAttribute('data-tool'); if (dt) return dt;
        var ms = (t.getAttribute('onclick') || '').match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function tileLabel(t) {
        var s = t.querySelector('span'), d = document.createElement('div');
        d.innerHTML = ((s ? s.innerHTML : t.innerHTML) || '').replace(/<br\s*\/?>/gi, ' ');
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function dlazdice() {
        var out = [], viden = {};
        var tiles = document.querySelectorAll('#tools-modal .tool-grid .tool-tile');
        for (var i = 0; i < tiles.length; i++) {
            var t = tiles[i], k = tileKey(t);
            if (!k || viden[k]) continue;
            if (t.hasAttribute('data-agucty') || t.hasAttribute('data-ag-hidden')) continue;   // role / schované uživatelem
            try { if (window.AGProZamky && AGProZamky.zamceno(k)) continue; } catch (e) { swallow(e, 'pro'); }
            var lab = tileLabel(t); if (!lab) continue;
            viden[k] = 1;
            var svg = t.querySelector('svg');
            out.push({ k: k, label: lab, svg: svg ? svg.outerHTML : '', el: t });
        }
        return out;
    }
    function vybrane() {
        try { var a = JSON.parse(localStorage.getItem(NAS_KEY)); return Array.isArray(a) ? a.slice(0, NAS_MAX) : null; } catch (e) { return null; }
    }
    function ulozVybrane(a) { try { localStorage.setItem(NAS_KEY, JSON.stringify(a.slice(0, NAS_MAX))); } catch (e) { swallow(e, 'ulozVybrane'); } }
    function otevriNastroje() {
        var v = vybrane();
        if (!v || !v.length) {
            // napoprvé: předvybraná základní sada (kolik se vejde), ať stačí potvrdit
            var mam = {}; dlazdice().forEach(function (d) { mam[d.k] = 1; });
            var base = []; try { base = (window.AGReg && AGReg.baseSet()) || []; } catch (e) { swallow(e, 'base'); }
            _nasVyber = base.filter(function (k) { return mam[k]; }).slice(0, NAS_MAX);
            _nasRezim = 'vyber';
        } else _nasRezim = 'seznam';
        _nasFiltr = '';
        var h = root.querySelector('#ag-jr-nas-hledat'); h.value = '';
        root.querySelector('#ag-jr-nas').hidden = false;
        vykresliNastroje();
    }
    function zavriNastroje() {
        var el = root && root.querySelector('#ag-jr-nas'); if (el) el.hidden = true;
    }
    function vykresliNastroje() {
        var box = root.querySelector('#ag-jr-nas-seznam'), pata = root.querySelector('#ag-jr-nas-pata');
        var info = root.querySelector('#ag-jr-nas-info'), h = root.querySelector('#ag-jr-nas-hledat');
        var vse = dlazdice(), html = '';
        if (_nasRezim === 'seznam') {
            root.querySelector('#ag-jr-nas-nadpis').textContent = T('Moje nástroje');
            info.hidden = true; h.hidden = true;
            var podle = {}; vse.forEach(function (d) { podle[d.k] = d; });
            var v = (vybrane() || []).filter(function (k) { return podle[k]; });
            v.forEach(function (k) {
                var d = podle[k];
                html += '<button type="button" class="jr-radek jr-nas-radek" data-jr-nas="' + esc(k) + '">' + d.svg + '<span class="jr-radek-jm">' + esc(d.label) + '</span></button>';
            });
            if (!v.length) html = '<div class="jr-prazdno">' + T('Žádný z vybraných nástrojů tu teď není.') + '</div>';
            box.innerHTML = html;
            pata.innerHTML = '<button type="button" class="jr-maly jr-nas-upravit" id="ag-jr-nas-upravit">' + T('Upravit výběr') + '</button>';
            pata.querySelector('#ag-jr-nas-upravit').addEventListener('click', function () { _nasVyber = (vybrane() || []).slice(); _nasRezim = 'vyber'; vykresliNastroje(); });
            Array.prototype.forEach.call(box.querySelectorAll('[data-jr-nas]'), function (b) {
                b.addEventListener('click', function () { spustNastroj(b.getAttribute('data-jr-nas')); });
            });
            return;
        }
        // výběr
        root.querySelector('#ag-jr-nas-nadpis').textContent = T('Vyber si nástroje');
        info.hidden = false;
        info.innerHTML = T('Vyber nejvýš {max} nástrojů, které budeš používat. Ostatní zůstanou schované. Vybráno: {n}/{max}.', { max: NAS_MAX, n: '<b>' + _nasVyber.length + '</b>' });
        h.hidden = vse.length <= 12;
        var f = _nasFiltr;
        // vybrané nahoře (v pořadí výběru), pak zbytek v pořadí mřížky
        var poradi = _nasVyber.map(function (k) { for (var i = 0; i < vse.length; i++) if (vse[i].k === k) return vse[i]; return null; }).filter(Boolean);
        vse.forEach(function (d) { if (_nasVyber.indexOf(d.k) < 0) poradi.push(d); });
        poradi.forEach(function (d) {
            if (f && d.label.toLowerCase().indexOf(f) < 0) return;
            var on = _nasVyber.indexOf(d.k) >= 0, plno = !on && _nasVyber.length >= NAS_MAX;
            html += '<button type="button" class="jr-radek jr-nas-radek' + (on ? ' jr-nas-on' : '') + (plno ? ' jr-nas-plno' : '') + '" aria-pressed="' + (on ? 'true' : 'false') + '" data-jr-vyb="' + esc(d.k) + '">'
                + d.svg + '<span class="jr-radek-jm">' + esc(d.label) + '</span><span class="jr-nas-check" aria-hidden="true">' + (on ? '✓' : '') + '</span></button>';
        });
        if (!html) html = '<div class="jr-prazdno">' + (vse.length ? T('Žádný nástroj tomu hledání neodpovídá.') : T('Nástroje se ještě načítají — zkus to za chvíli.')) + '</div>';
        box.innerHTML = html;
        pata.innerHTML = '<button type="button" class="jr-ulozit" id="ag-jr-nas-hotovo"' + (_nasVyber.length ? '' : ' disabled') + '>' + (_nasVyber.length ? T('HOTOVO') : T('VYBER ASPOŇ JEDEN')) + '</button>';
        pata.querySelector('#ag-jr-nas-hotovo').addEventListener('click', function () {
            if (!_nasVyber.length) return;
            ulozVybrane(_nasVyber);
            _nasRezim = 'seznam'; _nasFiltr = ''; root.querySelector('#ag-jr-nas-hledat').value = '';
            vykresliNastroje();
        });
        Array.prototype.forEach.call(box.querySelectorAll('[data-jr-vyb]'), function (b) {
            b.addEventListener('click', function () {
                var k = b.getAttribute('data-jr-vyb'), i = _nasVyber.indexOf(k);
                if (i >= 0) _nasVyber.splice(i, 1);
                else if (_nasVyber.length >= NAS_MAX) { toast(T('Nejvýš {n} nástrojů — nejdřív nějaký odeber.', { n: NAS_MAX })); return; }
                else _nasVyber.push(k);
                var sc = box.scrollTop;
                vykresliNastroje();
                box.scrollTop = sc;
            });
        });
    }

    // ---- PAUZA PŘEBALU PO DOBU NÁSTROJE ------------------------------------------------
    // Okna nástrojů mají z-index do 99999, přebal 999995 — nástroj by se otevřel POD ním.
    // Přebal se proto schová (mapa i kamera se vrátí do plné appky, kde s nimi nástroje
    // počítají) a nahoře zůstane tlačítko „Jednoduchý režim". Když nástroj otevřel okno
    // a to se zase zavřelo (uprostřed obrazovky je zase mapa), přebal se vrátí sám.
    var _pauza = null, _pill = null;
    function spustNastroj(k) {
        var d = null; dlazdice().forEach(function (x) { if (x.k === k) d = x; });
        if (!d) { toast(T('Nástroj teď není k dispozici.')); return; }
        zavriNastroje();
        pauza();
        try { d.el.click(); } catch (e) { swallow(e, 'spustNastroj'); obnovZPauzy(); return; }
        // okno nástroje se většinou otevře hned — zaznamenat to dřív než první tik hlídače
        // (kdo okno rychle zavře, nesmí zůstat v plné appce)
        if (_pauza && oknoUprostred()) _pauza.videl = true;
    }
    function oknoUprostred() {
        try {
            var el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
            if (!el || el === document.body || el === document.documentElement) return false;
            if (el.closest('#map-container, #camera-container, #ag-jr-pill')) return false;
            return true;
        } catch (e) { return false; }
    }
    function pauza() {
        kameraDo(false); mapaDo(null); caraPryc(); zavriKartu();
        if (tick) { clearInterval(tick); tick = null; }
        root.classList.add('jr-pauza');
        document.body.classList.add('ag-jr-pauza');
        if (!_pill) {
            _pill = document.createElement('button');
            _pill.type = 'button'; _pill.id = 'ag-jr-pill';
            _pill.addEventListener('click', obnovZPauzy);
            document.body.appendChild(_pill);
        }
        _pill.innerHTML = '‹ ' + esc(T('Jednoduchý režim'));
        _pill.hidden = false;
        _pauza = { videl: false, prazdno: 0, t: setInterval(function () {
            if (!_pauza) return;
            if (oknoUprostred()) { _pauza.videl = true; _pauza.prazdno = 0; return; }
            if (_pauza.videl && ++_pauza.prazdno >= 2) obnovZPauzy();
        }, 300) };
    }
    function obnovZPauzy() {
        if (_pauza) { clearInterval(_pauza.t); _pauza = null; }
        if (_pill) _pill.hidden = true;
        document.body.classList.remove('ag-jr-pauza');
        if (!root || !zapnuto()) return;
        root.classList.remove('jr-pauza');
        ukaz(aktivni);
    }

    function caraPryc() {
        if (_cara) { try { _cara.remove(); } catch (e) { swallow(e, 'caraPryc'); } _cara = null; }
    }
    function cara() {
        var m = leafletMapa(); if (!m || !cil || !maFix() || typeof L === 'undefined') return;
        var ll = [[userLat, userLng], [cil.lat, cil.lng]];
        try {
            if (!_cara) {
                _cara = L.polyline(ll, { color: '#f59e0b', weight: 4, dashArray: '8 8', interactive: false }).addTo(m);
                m.fitBounds(_cara.getBounds(), { padding: [28, 28], maxZoom: 19, animate: false });
            } else _cara.setLatLngs(ll);
        } catch (e) { swallow(e, 'cara'); }
    }
    // jedna řádka nad tlačítky: kolik bodů mám a který jsem uložil naposledy
    function souhrn() {
        var el = root && root.querySelector('#ag-jr-souhrn'); if (!el) return;
        var b = body(), t = '';
        if (b.length) {
            var posl = b[b.length - 1];
            t = T('Bodů v zakázce: {n} · naposledy {p}', { n: '<b>' + b.length + '</b>', p: '<b>' + esc(posl.name || T('Bod')) + '</b>' });
        }
        el.innerHTML = t;
        el.hidden = !t;
    }
    function poslatBod() {
        if (!cil) return;
        var nazev = cil.name || T('Bod');
        try { if (window.AGHledat && AGHledat.sdilej) { AGHledat.sdilej(cil.lat, cil.lng, nazev); return; } } catch (e) { swallow(e, 'poslat'); }
        var t = nazev + ' — ' + cil.lat.toFixed(6) + ', ' + cil.lng.toFixed(6);
        try { if (navigator.share) { navigator.share({ title: nazev, text: t }).catch(function () { /* zrušeno */ }); return; } } catch (e) { swallow(e, 'share'); }
        try { if (navigator.clipboard) { navigator.clipboard.writeText(t); toast(T('Zkopírováno') + ': ' + t); return; } } catch (e) { swallow(e, 'clip'); }
        toast(t);
    }
    function zpet(kam) {
        if (kam === 'home') zrusMereni();
        if (kam === 'list') { cil = null; doma = false; }
        ukaz(kam);
        if (kam === 'list') vykresliSeznam();
    }

    // Interval běží jen tam, kde se čísla opravdu mění (seznam, navigace, měření).
    function hlidejTik() {
        var chce = (aktivni === 'list' || aktivni === 'go' || avgT != null || aktivni === 'home');
        if (chce && !tick) tick = setInterval(tikni, TICK_MS);
        if (!chce && tick) { clearInterval(tick); tick = null; }
    }

    function tikni() {
        stavGps();
        hlidejKameru();
        if (aktivni === 'home' || aktivni === 'go') obnovNaMe();
        if (karta) { var kv = root.querySelector('#ag-jr-karta-vzd'), kt = kartaVzd(karta); if (kv && kv.innerHTML !== kt) kv.innerHTML = kt; }
        if (aktivni === 'list') obnovVzdalenosti();
        if (aktivni === 'go') vykresliNavigaci();
    }

    // Přepisuje se JEN při změně textu. Tik jede 5x/s, ale ± se mění nejvýš
    // jednou za sekundu — bez téhle stráže by se čtyři prvky přepisovaly
    // (a přepočítávaly rozvržení) 20x/s pro nic.
    var _stavText = null;
    function stavGps() {
        var txt, bez;
        if (!maFix()) { txt = 'Hledám GPS…'; bez = true; }
        else {
            var a = 0;
            try { a = (typeof currentGpsAccuracy === 'number' && isFinite(currentGpsAccuracy)) ? currentGpsAccuracy : 0; } catch (e) { swallow(e, 'stavGps'); }
            txt = 'GPS ± <b>' + cislo(a, 1) + ' m</b>'; bez = false;
        }
        if (txt === _stavText) return;
        _stavText = txt;
        ['#ag-jr-stav', '#ag-jr-stav2', '#ag-jr-stav3', '#ag-jr-stav4'].forEach(function (sel) {
            var el = root.querySelector(sel); if (!el) return;
            el.innerHTML = txt;
            el.classList.toggle('jr-bez', bez);
        });
    }

    // ---- NOVÝ BOD ----------------------------------------------------------------
    function otevriNovy() {
        novy = null;
        zrusMereni();
        root.querySelector('#ag-jr-nazev').value = navrhNazev();
        root.querySelector('#ag-jr-y').value = '';
        root.querySelector('#ag-jr-x').value = '';
        root.querySelector('#ag-jr-rucne').hidden = true;
        root.querySelector('#ag-jr-zgps').classList.remove('jr-vybrano');
        root.querySelector('#ag-jr-zruky').classList.remove('jr-vybrano');
        vysledek('', false);
        prepocitejUlozit();
        ukaz('new');
    }

    // Předvyplněný název: nejdřív série appky (tu vede i „Nový bod" v plné appce,
    // takže si obě cesty nečíslují každá po svém). Když série ještě není — třeba
    // body přišly importem — dopočítá se z NEJVYŠŠÍHO čísla v zakázce. Jinak by
    // uživatel jednoduchého režimu musel číslo vymyslet, a to je přesně ta práce,
    // kterou mu tenhle režim má sundat.
    function navrhNazev() {
        try { if (typeof window.agNextSerieName === 'function') { var n = window.agNextSerieName(); if (n) return n; } } catch (e) { swallow(e, 'navrhNazev'); }
        var max = null, pad = 0, prefix = '';
        body().forEach(function (p) {
            var m = /^(.*?)(\d{1,9})$/.exec(String(p.name || '').trim());
            if (!m) return;
            var v = parseInt(m[2], 10);
            if (max == null || v > max) { max = v; pad = m[2].length; prefix = m[1]; }
        });
        if (max == null) return '';
        var kand = prefix + String(max + 1).padStart(pad, '0');
        var obsazeno = body().some(function (p) { return p.name === kand; });
        return obsazeno ? '' : kand;
    }

    function vysledek(html, chyba) {
        var v = root.querySelector('#ag-jr-vysledek');
        v.innerHTML = html;
        v.hidden = !html;
        v.classList.toggle('jr-chyba', !!chyba);
    }

    // Zamčené tlačítko bez důvodu je past: na obrazovce nic jiného není, takže se
    // nemá čeho chytit. Popisek proto říká, CO ještě chybí.
    function prepocitejUlozit() {
        var jm = root.querySelector('#ag-jr-nazev').value.trim();
        var maSouradnice = !!(novy && isFinite(novy.lat) && isFinite(novy.lng));
        var b = root.querySelector('#ag-jr-ulozit');
        b.disabled = !(jm && maSouradnice);
        b.innerText = !maSouradnice ? 'NEJDŘÍV SOUŘADNICE' : (!jm ? 'ZADEJ NÁZEV BODU' : 'ULOŽIT');
    }

    function prepniRucne() {
        zrusMereni();
        novy = null;
        root.querySelector('#ag-jr-zgps').classList.remove('jr-vybrano');
        root.querySelector('#ag-jr-zruky').classList.add('jr-vybrano');
        root.querySelector('#ag-jr-rucne').hidden = false;
        vysledek('', false);
        rucneZmena();
        try { root.querySelector('#ag-jr-y').focus(); } catch (e) { swallow(e, 'prepniRucne'); }
    }

    function cti(id) {
        var el = root.querySelector(id);
        var s = String(el && el.value != null ? el.value : '').replace(/\s/g, '').replace(',', '.');
        return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
    }

    function rucneZmena() {
        var y = cti('#ag-jr-y'), x = cti('#ag-jr-x');
        if (!isFinite(y) || !isFinite(x)) { novy = null; vysledek('', false); prepocitejUlozit(); return; }
        var c = null;
        try { if (typeof sjtskToLatLng === 'function') c = mistniToLatLng(y, x); } catch (e) { swallow(e, 'rucneZmena'); }
        if (!c || !isFinite(c.lat) || !isFinite(c.lng)) { novy = null; vysledek('Souřadnice se nepodařilo převést.', true); prepocitejUlozit(); return; }
        novy = { lat: c.lat, lng: c.lng, acc: null, vyska: null, zpusob: 'ruc' };
        var kde = maFix() ? (' — ' + T('od tebe {d}', { d: '<b>' + cislo(vzdal(userLat, userLng, c.lat, c.lng), 1) + ' m</b>' })) : '';
        vysledek(T('Zadáno ručně') + kde + '.', false);
        prepocitejUlozit();
    }

    // Průměrování GPS: 6 s, vzorky bereme z polohy, kterou appka už sleduje
    // (watchPosition v logika.js) — druhý watchPosition by jen žral baterii a
    // vracel by přesně totéž.
    function zmerGps() {
        if (avgT) { dokonciMereni(); return; }             // druhé klepnutí = „stačilo"
        if (!maFix()) { vysledek('GPS zatím nemá polohu. Počkej pár vteřin venku pod nebem.', true); return; }
        novy = null;
        root.querySelector('#ag-jr-zruky').classList.remove('jr-vybrano');
        root.querySelector('#ag-jr-zgps').classList.add('jr-vybrano');
        root.querySelector('#ag-jr-rucne').hidden = true;
        avgVzorky = [];
        avgDo = Date.now() + AVG_MS;
        prepocitejUlozit();
        avgT = setInterval(function () {
            if (maFix()) {
                var acc = null, alt = null;
                try { acc = (typeof currentGpsAccuracy === 'number' && isFinite(currentGpsAccuracy)) ? currentGpsAccuracy : null; } catch (e) { swallow(e, 'zmerGps'); }
                try { alt = (typeof userAlt !== 'undefined' && userAlt != null && isFinite(userAlt)) ? userAlt : null; } catch (e) { swallow(e, 'zmerGps'); }
                var p = avgVzorky[avgVzorky.length - 1];
                if (!p || p.lat !== userLat || p.lng !== userLng) avgVzorky.push({ lat: userLat, lng: userLng, acc: acc, alt: alt });
            }
            var zbyva = Math.max(0, Math.ceil((avgDo - Date.now()) / 1000));
            vysledek(T('Měřím… ještě {s} ({n} vzorků). Stůj na místě — klepnutím na „Z GPS" to ukončíš dřív.', { s: '<b>' + zbyva + ' s</b>', n: avgVzorky.length }), false);
            if (Date.now() >= avgDo) dokonciMereni();
        }, 250);
        hlidejTik();
        vysledek(T('Měřím… ještě {s} (0 vzorků). Stůj na místě.', { s: '<b>' + Math.ceil(AVG_MS / 1000) + ' s</b>' }), false);
    }

    function zrusMereni() {
        if (avgT) { clearInterval(avgT); avgT = null; }
        avgVzorky = [];
        hlidejTik();
    }

    function dokonciMereni() {
        if (avgT) { clearInterval(avgT); avgT = null; }
        hlidejTik();
        var n = avgVzorky.length;
        if (!n) { vysledek('Za dobu měření nepřišla ani jedna poloha. Zkus to venku pod nebem.', true); prepocitejUlozit(); return; }
        var sLat = 0, sLng = 0, sAcc = 0, nAcc = 0, sAlt = 0, nAlt = 0, i;
        for (i = 0; i < n; i++) {
            sLat += avgVzorky[i].lat; sLng += avgVzorky[i].lng;
            if (avgVzorky[i].acc != null) { sAcc += avgVzorky[i].acc; nAcc++; }
            if (avgVzorky[i].alt != null) { sAlt += avgVzorky[i].alt; nAlt++; }
        }
        var lat = sLat / n, lng = sLng / n;
        var acc = nAcc ? sAcc / nAcc : null;
        // rozptyl vzorků kolem průměru — poctivější číslo než to, co hlásí telefon
        var rozptyl = 0;
        for (i = 0; i < n; i++) rozptyl += vzdal(lat, lng, avgVzorky[i].lat, avgVzorky[i].lng);
        rozptyl = rozptyl / n;
        // výška: elipsoidická z GPS → Bpv (stejný převod jako karta bodu)
        var vyska = null;
        if (nAlt) {
            var und = 0;
            try { if (typeof getGeoidUndulation === 'function') und = getGeoidUndulation(lat, lng) || 0; } catch (e) { swallow(e, 'dokonciMereni'); }
            vyska = (sAlt / nAlt) - und;
        }
        novy = { lat: lat, lng: lng, acc: acc, vyska: (vyska != null && isFinite(vyska)) ? vyska : null, zpusob: 'gps-avg' };
        avgVzorky = [];
        vysledek(T('Změřeno z GPS: {n} vzorků, rozptyl {r}', { n: '<b>' + n + '</b>', r: '<b>' + cislo(rozptyl, 2) + ' m</b>' })
            + (acc != null ? ', ' + T('přesnost ± {a}', { a: '<b>' + cislo(acc, 1) + ' m</b>' }) : '') + '.', false);
        vibruj(25);
        prepocitejUlozit();
    }

    function uloz() {
        var jm = root.querySelector('#ag-jr-nazev').value.trim();
        if (!jm || !novy) return;
        if (typeof window.addImportedPoints !== 'function') { vysledek('Ukládání bodů není dostupné.', true); return; }
        var zaznam = {
            name: jm, lat: novy.lat, lng: novy.lng,
            vyska: (novy.vyska != null) ? novy.vyska : undefined,
            acc: (novy.acc != null) ? novy.acc : undefined,
            origin: novy.zpusob
        };
        var pridano = 0;
        try { pridano = window.addImportedPoints([zaznam]); } catch (e) { swallow(e, 'uloz'); }
        if (!pridano) { vysledek(T('Bod se neuložil — číslo „{n}" už na tomhle místě v zakázce je.', { n: esc(jm) }), true); return; }
        bumpSerie(jm);
        vibruj(40);
        toast(T('Bod {n} uložen.', { n: jm }));
        novy = null;
        ukaz('home');
    }

    // po uložení posuneme sérii i pro „Nový bod" v plné appce — jinak by si obě
    // cesty číslovaly každá po svém a v zakázce by vznikly díry
    function bumpSerie(name) {
        try {
            var m = /^(.*?)(\d{1,9})$/.exec(String(name || '').trim());
            if (!m || typeof setStoredData !== 'function') return;
            setStoredData('agPointSerie', JSON.stringify({ prefix: m[1], next: parseInt(m[2], 10) + 1, pad: m[2].length }));
        } catch (e) { swallow(e, 'bumpSerie'); }
    }

    // ---- SEZNAM BODŮ -------------------------------------------------------------
    function otevriSeznam() {
        filtr = '';
        var h = root.querySelector('#ag-jr-hledat');
        h.value = '';
        h.hidden = (body().length + uredni().length) <= 12;    // u hrstky bodů je hledání jen překážka navíc
        ukaz('list');
        vykresliSeznam();
    }

    // ⚠ Vrací OBALY {id, name, d}, ne body samotné. Kdyby se vzdálenost zapsala
    // do objektu bodu, odešla by při nejbližším uložení do JSON.stringify
    // (persistentCustomPoints se ukládá celé) a usadila by se v zakázce i v exportu.
    function serazene() {
        var pts = body().map(function (p) { return { id: p.id, name: p.name || 'Bod', lat: p.lat, lng: p.lng, d: null, kat: null }; });
        var ur = uredni().map(function (p) { return { id: p.id, name: p.name || 'Bod', lat: p.lat, lng: p.lng, d: null, kat: p.cat || 'X' }; });
        if (filtr) { var f = function (p) { return p.name.toLowerCase().indexOf(filtr) >= 0; }; pts = pts.filter(f); ur = ur.filter(f); }
        var podle;
        if (maFix()) {
            pts.concat(ur).forEach(function (p) { p.d = vzdal(userLat, userLng, p.lat, p.lng); });
            podle = function (a, b) { return a.d - b.d; };
        } else {
            podle = function (a, b) { return a.name.localeCompare(b.name, 'cs', { numeric: true }); };
        }
        ur.sort(podle);
        if (!filtr && ur.length > UREDNICH_MAX) ur = ur.slice(0, UREDNICH_MAX);
        pts = pts.concat(ur); pts.sort(podle);
        return pts;
    }

    function vykresliSeznam() {
        var box = root.querySelector('#ag-jr-seznam');
        var pts = serazene();
        var html = '';
        if (!pts.length) {
            html = '<div class="jr-prazdno">' + ((body().length + uredni().length)
                ? 'Žádný bod tomu hledání neodpovídá.'
                : 'Zatím tu není žádný bod.<br>Ulož si první tlačítkem <b>Přidat bod</b>.') + '</div>';
        }
        pts.forEach(function (p) {
            html += '<button type="button" class="jr-radek' + (p.kat ? ' jr-radek-ur' : '') + '" data-jr-id="' + esc(p.id) + '">'
                + '<span class="jr-radek-jm">' + esc(p.name || T('Bod')) + (p.kat ? ' <span class="jr-radek-kat">' + esc(katLabel(p.kat)) + '</span>' : '') + '</span>'
                + '<span class="jr-radek-vzd" data-jr-d="' + esc(p.id) + '">' + popisD(p.d) + '</span>'
                + '</button>';
        });
        // úřední body ještě nejsou (appka je stahuje podle GPS sama; bez signálu z offline oblasti) → nabídnout stažení teď
        if (!filtr && !uredni().length) {
            html += '<div class="jr-prazdno jr-uredni-tip">Úřední body (ČÚZK) kolem tebe se stáhnou samy podle polohy.'
                + (maFix() && typeof initFetch === 'function' ? '<br><button type="button" class="jr-maly" id="ag-jr-stahnout">Stáhnout okolí teď</button>' : '') + '</div>';
        }
        box.innerHTML = html;
        Array.prototype.forEach.call(box.querySelectorAll('[data-jr-id]'), function (b) {
            b.addEventListener('click', function () { naviguj(b.getAttribute('data-jr-id')); });
        });
        var st = box.querySelector('#ag-jr-stahnout');
        if (st) st.addEventListener('click', function () {
            st.disabled = true; st.textContent = 'Stahuji…';
            try { var r = initFetch(userLat, userLng); if (r && r.then) r.then(function () { vykresliSeznam(); }, function () { vykresliSeznam(); }); else setTimeout(vykresliSeznam, 4000); }
            catch (e) { swallow(e, 'stahnout'); setTimeout(vykresliSeznam, 4000); }
        });
    }

    function popisD(d) {
        if (d == null) return '—';
        if (d >= 1000) return cislo(d / 1000, 2) + ' km';
        return cislo(d, d < 10 ? 1 : 0) + ' m';
    }

    // Přepisujeme JEN čísla vzdáleností. Pořadí se přerovná až na další otevření
    // seznamu — kdyby se řádky přeskládaly pod prstem, uživatel by klepl na jiný bod,
    // než na který mířil.
    function obnovVzdalenosti() {
        if (!maFix()) return;
        var box = root.querySelector('#ag-jr-seznam');
        var mapa = {};
        body().concat(uredni()).forEach(function (p) { mapa[p.id] = vzdal(userLat, userLng, p.lat, p.lng); });
        Array.prototype.forEach.call(box.querySelectorAll('[data-jr-d]'), function (s) {
            var d = mapa[s.getAttribute('data-jr-d')];
            var t = popisD(d == null ? null : d);
            if (s.textContent !== t) s.textContent = t;
        });
    }

    // ---- NAVIGACE ----------------------------------------------------------------
    function naviguj(id) {
        var p = najdiBod(id);
        if (!p) return;
        caraPryc();
        cil = p; doma = false;
        _uhel = 0; _vzdText = null; _poznText = null;
        root.querySelector('#ag-jr-sipka').style.transform = 'rotate(0deg)';
        root.querySelector('#ag-jr-cilnazev').innerText = p.name || T('Bod');
        ukaz('go');
        vykresliNavigaci();
    }

    // Úhel se NEZAOKROUHLUJE do 0–360, ale drží se spojitě (viz _uhel). Kdyby se
    // šipka přepínala z 359° na 1°, CSS přechod by ji přetočil skoro celé kolo
    // dozadu — přesně v okamžiku, kdy se člověk otáčí k severu.
    var _uhel = 0, _vzdText = null, _poznText = null;
    function vykresliNavigaci() {
        if (!cil) return;
        var vzdEl = root.querySelector('#ag-jr-vzd');
        var poznEl = root.querySelector('#ag-jr-pozn');
        var sipka = root.querySelector('#ag-jr-sipka');
        var go = stranky.go;
        var vzdHtml, poznTxt, varovani = false;

        if (!maFix()) {
            vzdHtml = '—';
            poznTxt = 'Čekám na GPS.';
            varovani = true;
            go.classList.remove('jr-doma');
        } else {
            var d = vzdal(userLat, userLng, cil.lat, cil.lng);
            var az = azimut(userLat, userLng, cil.lat, cil.lng);
            var h = smer();

            // Desetiny mají smysl jen zblízka. „734,9 m" je jednak nesmysl (GPS má
            // metry), jednak poslední číslice při chůzi bliká a oko na ní visí.
            vzdHtml = (d >= 1000) ? (cislo(d / 1000, 2) + '<span>km</span>')
                : (cislo(d, d < 10 ? 2 : (d < 100 ? 1 : 0)) + '<span>m</span>');

            if (h == null) {
                // bez kompasu šipka lže — otočíme ji na sever a řekneme azimut číslem
                _uhel = 0;
                poznTxt = T('Kompas nehlásí směr — jdi po azimutu {a}°. (Šipka míří na sever.)', { a: cislo(az, 0) });
                varovani = true;
            } else {
                var rel = ((az - h) % 360 + 360) % 360;
                var delta = ((rel - _uhel) % 360 + 540) % 360 - 180;   // nejkratší cesta
                _uhel += delta;
                poznTxt = (d <= DOMA_M) ? 'Jsi na bodě.' : 'Drž telefon před sebou a jdi za šipkou.';
            }
            sipka.style.transform = 'rotate(' + _uhel.toFixed(1) + 'deg)';

            var jeDoma = (d <= DOMA_M);
            go.classList.toggle('jr-doma', jeDoma);
            if (jeDoma && !doma) { doma = true; vibruj([40, 60, 40]); }
            if (!jeDoma && d > DOMA_M * 3) doma = false;   // hystereze, ať to nevibruje na hraně
        }

        cara();
        if (vzdHtml !== _vzdText) { vzdEl.innerHTML = vzdHtml; _vzdText = vzdHtml; }
        if (poznTxt !== _poznText) { poznEl.innerText = poznTxt; _poznText = poznTxt; }
        poznEl.classList.toggle('jr-varovani', varovani);
    }

    // ---- zapnutí / vypnutí režimu -------------------------------------------------
    function zapni(tiche) {
        nastav(true);
        build();
        // BATERIE: kamera pod neprůhledným přebalem by jela naprázdno.
        try {
            if (typeof viewMode !== 'undefined') {
                predchoziView = viewMode;
                if (viewMode !== 'map') { viewMode = 'map'; if (typeof applyViewMode === 'function') applyViewMode(); }
            }
            if (typeof stopCameraStream === 'function') stopCameraStream();
        } catch (e) { swallow(e, 'zapni'); }
        try { if (typeof startCompass === 'function') startCompass(); } catch (e) { swallow(e, 'zapni'); }
        try { if (typeof requestWakeLock === 'function') requestWakeLock(); } catch (e) { swallow(e, 'zapni'); }
        root.classList.add('jr-on');
        document.body.classList.add('ag-jr-on');
        cil = null; doma = false; novy = null;
        ukaz('home');
        stavGps();
        synchronizujPrepinac();
        if (!tiche) toast(T('Jednoduchý režim zapnut.'));
    }

    function vypni() {
        nastav(false);
        zrusMereni();
        if (tick) { clearInterval(tick); tick = null; }
        cil = null; novy = null;
        if (_pauza) { clearInterval(_pauza.t); _pauza = null; }
        if (_pill) _pill.hidden = true;
        document.body.classList.remove('ag-jr-pauza');
        if (root) { kameraDo(false); zavriKartu(); zavriNastroje(); mapaDo(null); caraPryc(); root.classList.remove('jr-on', 'jr-pauza'); }
        document.body.classList.remove('ag-jr-on');
        // vrať zobrazení, které měl uživatel před zapnutím
        try {
            if (predchoziView && typeof viewMode !== 'undefined' && viewMode !== predchoziView) {
                viewMode = predchoziView;
                if (typeof applyViewMode === 'function') applyViewMode();
            }
        } catch (e) { swallow(e, 'vypni'); }
        predchoziView = null;
        synchronizujPrepinac();
    }

    // ---- přepínač v Nastavení → Vzhled → Ovládání ---------------------------------
    function vlozPrepinac() {
        if (document.getElementById('ag-jr-setrow')) return;
        var kotva = document.getElementById('s-vibration');   // stabilní řádek v sekci „Ovládání"
        var radek = kotva ? kotva.closest('.st-row') : null;
        if (!radek || !radek.parentNode) return;
        var div = document.createElement('div');
        div.className = 'st-row'; div.id = 'ag-jr-setrow';
        // ⚠ BEZ TOHOHLE JE PŘEPÍNAČ NEDOSAŽITELNÝ PRO TOHO, KDO HO POTŘEBUJE.
        // js/nastaveni-hledani.js schová v „krátkém nastavení" každý řádek, který
        // nezná (třída ag-ns-adv), a odkryje ho až tlačítko „Zobrazit vše" —
        // tedy přesně to hrabání v nastavení, před kterým má tenhle režim utéct.
        // data-ns-keep je oficiální výjimka toho modulu (stejně ji používá volba
        // jazyka, ze stejného důvodu).
        div.setAttribute('data-ns-keep', '');
        div.innerHTML = '<span class="st-lab">Jednoduchý režim<small>místo celé appky jen mapa (nebo kamera s body), „Přidat bod", „Navigovat k bodu" a tvých až 10 nástrojů pod malým tlačítkem. Zpátky odkazem „Celá appka" vpravo nahoře.</small></span>'
            + '<label class="st-sw"><input type="checkbox" id="ag-jr-switch"><span class="st-sw-face"></span></label>';
        radek.parentNode.insertBefore(div, radek.nextSibling);
        var cb = div.querySelector('#ag-jr-switch');
        cb.checked = zapnuto();
        cb.addEventListener('change', function () {
            if (cb.checked) {
                // ať uživatel vidí, co se stalo: zavři Nastavení, jinak by nový přebal
                // překryl modál a vypadalo by to jako zamrznutí
                try { var m = document.getElementById('settings-modal'); if (m) m.style.display = 'none'; } catch (e) { swallow(e, 'vlozPrepinac'); }
                zapni(false);
            } else vypni();
        });
    }

    function synchronizujPrepinac() {
        var cb = document.getElementById('ag-jr-switch');
        if (cb) cb.checked = zapnuto();
    }

    // ---- start --------------------------------------------------------------------
    function sundejPlachtu() {
        try { document.documentElement.classList.remove('ag-jr-prelock'); } catch (e) { swallow(e, 'sundejPlachtu'); }
    }

    function start() {
        vlozPrepinac();
        if (zapnuto()) zapni(true);
        sundejPlachtu();
    }

    // POJISTKA: kdyby se appka nikdy nerozjela (nedokončené přihlášení, chyba
    // v jádru), plachta by zůstala viset přes celou obrazovku. Po 15 s ji sundáme
    // i bez startu — ať uživatel vidí aspoň to, co appka zvládla.
    setTimeout(sundejPlachtu, 15000);

    if (document.body && document.body.classList.contains('app-started')) start();
    else window.addEventListener('ag:app-started', start, { once: true });

    window.AGJednoduchy = {
        stranka: function () { return aktivni; },
        naviguj: function (id) { naviguj(id); },
        zapnuto: zapnuto,
        zapni: function () { zapni(false); },
        vypni: vypni,
        pohled: function () { return _kamera ? 'kamera' : 'mapa'; },
        prepniPohled: prepniPohled,
        karta: function () { return karta ? karta.id : null; },
        nastroje: otevriNastroje,
        pauza: function () { return !!_pauza; },
        obnov: obnovZPauzy
    };
})();
