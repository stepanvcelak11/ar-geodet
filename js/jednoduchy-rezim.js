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
//   • NAVIGOVAT   → seznam bodů zakázky OD NEJBLIŽŠÍHO PO NEJVZDÁLENĚJŠÍ,
//                   po klepnutí celoobrazovková šipka + vzdálenost.
//   • malý odkaz „Celá appka" vpravo nahoře → zpátky do plné appky.
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

    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, 'jednoduchy-rezim:' + kde); } catch (e2) { /* ani logovat nejde */ } }

    // ---- most k appce: všechno přes typeof, ať modul přežije i odpojení jádra ----
    function zapnuto() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
    function nastav(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { swallow(e, 'nastav'); } }
    function maFix() { try { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); } catch (e) { return false; } }
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
            + '    <button type="button" class="jr-maly" id="ag-jr-konec">Celá appka</button></div>'
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
            + '        <div><label class="jr-label" for="ag-jr-y">S-JTSK Y (m)</label><input type="text" id="ag-jr-y" class="jr-vstup" inputmode="decimal" autocomplete="off" placeholder="596956,46"></div>'
            + '        <div><label class="jr-label" for="ag-jr-x">S-JTSK X (m)</label><input type="text" id="ag-jr-x" class="jr-vstup" inputmode="decimal" autocomplete="off" placeholder="1163343,34"></div>'
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
        var h = root.querySelector('#ag-jr-hledat');
        h.addEventListener('input', function () { filtr = h.value.trim().toLowerCase(); vykresliSeznam(); });
        return root;
    }

    // ---- přepínání obrazovek -----------------------------------------------------
    function ukaz(kam) {
        aktivni = kam;
        Object.keys(stranky).forEach(function (k) {
            if (stranky[k]) stranky[k].classList.toggle('jr-vidno', k === kam);
        });
        hlidejTik();
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
        try { if (typeof sjtskToLatLng === 'function') c = sjtskToLatLng(y, x); } catch (e) { swallow(e, 'rucneZmena'); }
        if (!c || !isFinite(c.lat) || !isFinite(c.lng)) { novy = null; vysledek('Souřadnice se nepodařilo převést.', true); prepocitejUlozit(); return; }
        novy = { lat: c.lat, lng: c.lng, acc: null, vyska: null, zpusob: 'ruc' };
        var kde = maFix() ? (' — od tebe <b>' + cislo(vzdal(userLat, userLng, c.lat, c.lng), 1) + ' m</b>') : '';
        vysledek('Zadáno ručně' + kde + '.', false);
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
            vysledek('Měřím… ještě <b>' + zbyva + ' s</b> (' + avgVzorky.length + ' vzorků). Stůj na místě — klepnutím na „Z GPS" to ukončíš dřív.', false);
            if (Date.now() >= avgDo) dokonciMereni();
        }, 250);
        hlidejTik();
        vysledek('Měřím… ještě <b>' + Math.ceil(AVG_MS / 1000) + ' s</b> (0 vzorků). Stůj na místě.', false);
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
        vysledek('Změřeno z GPS: <b>' + n + '</b> vzorků, rozptyl <b>' + cislo(rozptyl, 2) + ' m</b>'
            + (acc != null ? ', přesnost ± <b>' + cislo(acc, 1) + ' m</b>' : '') + '.', false);
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
        if (!pridano) { vysledek('Bod se neuložil — číslo „' + esc(jm) + '" už na tomhle místě v zakázce je.', true); return; }
        bumpSerie(jm);
        vibruj(40);
        toast('Bod ' + jm + ' uložen.');
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
        h.hidden = body().length <= 12;    // u hrstky bodů je hledání jen překážka navíc
        ukaz('list');
        vykresliSeznam();
    }

    // ⚠ Vrací OBALY {id, name, d}, ne body samotné. Kdyby se vzdálenost zapsala
    // do objektu bodu, odešla by při nejbližším uložení do JSON.stringify
    // (persistentCustomPoints se ukládá celé) a usadila by se v zakázce i v exportu.
    function serazene() {
        var pts = body().map(function (p) { return { id: p.id, name: p.name || 'Bod', lat: p.lat, lng: p.lng, d: null }; });
        if (filtr) pts = pts.filter(function (p) { return p.name.toLowerCase().indexOf(filtr) >= 0; });
        if (maFix()) {
            pts.forEach(function (p) { p.d = vzdal(userLat, userLng, p.lat, p.lng); });
            pts.sort(function (a, b) { return a.d - b.d; });
        } else {
            pts.sort(function (a, b) { return a.name.localeCompare(b.name, 'cs', { numeric: true }); });
        }
        return pts;
    }

    function vykresliSeznam() {
        var box = root.querySelector('#ag-jr-seznam');
        var pts = serazene();
        if (!pts.length) {
            box.innerHTML = '<div class="jr-prazdno">' + (body().length
                ? 'Žádný bod tomu hledání neodpovídá.'
                : 'Zatím tu není žádný bod.<br>Ulož si první tlačítkem <b>Přidat bod</b>.') + '</div>';
            return;
        }
        var html = '';
        pts.forEach(function (p) {
            html += '<button type="button" class="jr-radek" data-jr-id="' + esc(p.id) + '">'
                + '<span class="jr-radek-jm">' + esc(p.name || 'Bod') + '</span>'
                + '<span class="jr-radek-vzd" data-jr-d="' + esc(p.id) + '">' + popisD(p.d) + '</span>'
                + '</button>';
        });
        box.innerHTML = html;
        Array.prototype.forEach.call(box.querySelectorAll('[data-jr-id]'), function (b) {
            b.addEventListener('click', function () { naviguj(b.getAttribute('data-jr-id')); });
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
        body().forEach(function (p) { mapa[p.id] = vzdal(userLat, userLng, p.lat, p.lng); });
        Array.prototype.forEach.call(box.querySelectorAll('[data-jr-d]'), function (s) {
            var d = mapa[s.getAttribute('data-jr-d')];
            var t = popisD(d == null ? null : d);
            if (s.textContent !== t) s.textContent = t;
        });
    }

    // ---- NAVIGACE ----------------------------------------------------------------
    function naviguj(id) {
        var p = null;
        body().forEach(function (q) { if (q.id === id) p = q; });
        if (!p) return;
        cil = p; doma = false;
        _uhel = 0; _vzdText = null; _poznText = null;
        root.querySelector('#ag-jr-sipka').style.transform = 'rotate(0deg)';
        root.querySelector('#ag-jr-cilnazev').innerText = p.name || 'Bod';
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
                poznTxt = 'Kompas nehlásí směr — jdi po azimutu ' + cislo(az, 0) + '°. (Šipka míří na sever.)';
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
        if (!tiche) toast('Jednoduchý režim zapnut.');
    }

    function vypni() {
        nastav(false);
        zrusMereni();
        if (tick) { clearInterval(tick); tick = null; }
        cil = null; novy = null;
        if (root) root.classList.remove('jr-on');
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
        div.innerHTML = '<span class="st-lab">Jednoduchý režim<small>schová mapu, kameru i nástroje — zůstane jen „Přidat bod" a „Navigovat k bodu". Zpátky odkazem „Celá appka" vpravo nahoře.</small></span>'
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
        zapnuto: zapnuto,
        zapni: function () { zapni(false); },
        vypni: vypni
    };
})();
