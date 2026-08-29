// ===== AR Geodet — BEZPEČNOST V TERÉNU (ODPOJITELNÁ vrstva) =====================
// PROČ tenhle modul existuje: geodet je venku často sám, daleko od cesty, s výtyčkou
// v ruce. Když se něco stane (kolaps z vedra, pád do výkopu, uklouznutí na svahu,
// zásah proudem u trafostanice), rozhoduje se o tom, jak rychle se k němu někdo
// dostane, podle JEDINÉ věci: umí říct, KDE je. A přesně tuhle informaci má appka
// v ruce dřív než záchranka.
//
// PROČ TAKHLE VYPADÁ (přestavba vzhledu): dřív tu bylo osamocené tlačítko „Poslat
// mou polohu" pod výpisem rizik z počasí — vypadalo to jako přílepek a v nouzi
// nebylo z čeho číst. Teď je z toho panel se třemi patry, seřazenými podle toho,
// co člověk v maléru potřebuje v jakém pořadí:
//   1) STAV NAHOŘE — souřadnice (WGS84 i S-JTSK), STÁŘÍ té polohy, přesnost fixu,
//      datový signál, baterie a komu se poloha pošle. Tohle si člověk přečte nebo
//      nadiktuje operátorovi, i kdyby se pak už nic dalšího nepovedlo.
//   2) TÍSŇOVÁ LINKA — jeden velký, jednoznačný prvek. Ne ikonka mezi ostatními.
//   3) VEDLEJŠÍ AKCE — poslat polohu, SMS, kopírovat, zavolat kontaktu, další
//      tísňová čísla; kompaktní dlaždice ve stylu Nástrojů, ať se to vejde na jednu
//      obrazovku i s riziky dne.
// Tři patra jsou v rolovací vrstvě .modal-body (nadpis a Zavřít zůstávají mimo ni) a
// při každém otevření se odroluje na začátek — tísňové tlačítko tak člověk vidí hned,
// i kdyby okno minule opustil dole u kontaktů.
//
// PROČ JE NA TÍSŇOVÉM TLAČÍTKU POJISTKA (podržení + odpočet): omylem vytočená 112
// není nevinná chyba — blokuje linku, kterou v tu chvíli může potřebovat někdo jiný,
// a operátor musí každý takový hovor prověřit. Telefon je přitom v kapse u pasu,
// v rukavici a mokrý; náhodný dotek je běžná věc. Proto se linka nevytočí ťuknutím:
// musíš tlačítko DRŽET 2 sekundy (vidíš, jak se plní, a kolik zbývá) a teprve
// PUSTIT. Pustíš dřív = zrušeno, nic se nestalo. Pustíš mimo tlačítko = taky
// zrušeno. Vytočení se schválně spouští až na PUSTENÍ, ne v okamžiku doběhnutí
// odpočtu, a to ze dvou důvodů: (a) je to poslední místo, kde jde couvnout,
// (b) prohlížeč pouští odkaz tel: spolehlivě jen z dotyku uživatele — z časovače
// by ho iOS mohl potichu zahodit a člověk by si myslel, že volá, a přitom ne.
//
// CO APPKA UMÍ A CO NE (a proč to říká nahlas): appka NIKAM nic sama neposílá,
// nikoho sama nevolá a NEUMÍ ověřit, jestli hovor proběhl nebo jestli SMS odešla.
// Otevře vytáčení / zprávy / systémové sdílení a dál je to na uživateli a na jeho
// telefonu. Nikde proto nesvítí „odesláno", když se jen otevřelo okno — v terénu
// by falešné „odesláno" bylo horší než poctivé „musíš to potvrdit ve zprávách".
// Stejně tak se u polohy VŽDY ukazuje její stáří: poslední uložená poloha může být
// hodinu stará a poslat ji jako „jsem tady" by navedlo pomoc na špatné místo.
//
// Vedle nouze modul dál hlídá běžná denní rizika z dat, která appka už má:
//   • BOUŘKA — hodinová předpověď; výtyčka a stativ dělají z člověka nejvyšší bod.
//   • VEDRO / pitný režim — z posledního počasí (agWeatherCache_v1).
//   • SOUMRAK — 30 min před koncem občanského soumraku (počítá js/slunce.js).
//   • MRÁZ a VÍTR — náledí, foukání do stativu, padající větve.
// Připomínky jsou VÝCHOZÍ VYPNUTÉ a běží jen když je appka otevřená (webová appka
// časovače na pozadí nedostane). Naschvál bez notifikací a zvuku — jen tichý toast,
// aby to nerušilo měření. „Ztišit na dnes" je jeden tap.
//
// PRÁVNÍ RÁMEC: čísla u rizik jsou ORIENTAČNÍ doporučení pro práci venku, NE citace
// vyhlášky. Povinnosti zaměstnavatele (ochranné nápoje, režim práce a bezpečnostní
// přestávky) řeší NV 361/2007 Sb. podle třídy práce a naměřených podmínek — to
// appka posoudit neumí a netvrdí, že umí.
//
// IKONY: ze sprite v index.html přes <use href="#i-…">. Sprite nemá štít, telefon
// ani baterii, takže právě tyhle tři (a jen tyhle) jsou nakreslené lokálně dole
// v ICO_* — index.html tenhle modul needituje. Emoji nikde, ani v toastech.
// REŽIM LEVÉ RUKY: panel je záměrně symetrický (mřížka + tlačítko přes celou
// šířku), takže není co zrcadlit — v body.left-hand vypadá stejně a sedne stejně.
//
// Neinvazivní: NEEDITUJE logika.js/grafika.js. Čte window.AGFix / userLat / userLng
// (poloha), window.GeoCore nebo proj4 (S-JTSK), window.AGSun (soumrak) a cache
// počasí. Vstup: dlaždice „Bezpečnost" v Nástrojích (Pomůcky).
// API (nezměněné): window.agOpenBezpecnost().
// Uloženo v localStorage pod agSafety_v1 (vč. kontaktů — nikam se neodesílají).
// Odstranění: smaž js/bezpecnost.js + řádek <script> v index.html a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.__agBezpecnostInit) return;
    window.__agBezpecnostInit = true;

    // Sprite nemá štít, telefon ani baterii — jediné tři lokálně kreslené (viz hlavička).
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7.5 3v6c0 4.2-3 7.6-7.5 9-4.5-1.4-7.5-4.8-7.5-9V6z"/><path d="M12 8.5v4M12 15.5v.01"/></svg>';
    var ICO_PHONE = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.8a2 2 0 0 1-.4 2.1L8 9.8a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2z"/></svg>';
    var ICO_BAT = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/></svg>';
    function ic(id) { return '<svg class="icon"><use href="#' + id + '"/></svg>'; }

    var STYLE_ID = 'ag-bz-style';
    var LS = 'agSafety_v1';           // {on, drinkMin, lastDrink, mutedDay, seen:{}, contacts:[{n,p}]}
    var DRINK_DEFAULT = 45;           // min
    var HOLD_MS = 2000;               // jak dlouho držet tísňové tlačítko (pojistka, viz hlavička)
    var ARM_MS = 4000;                // jak dlouho je vedlejší číslo „natažené" na druhý tap
    var FIRED_MS = 3 * 60000;         // jak dlouho po vytočení zůstane nouzová obrazovka
    var MAX_CONTACTS = 4;

    // Tísňová čísla ČR. 112 je jednotné evropské, zbytek jsou národní linky.
    var NUMS = [
        { n: '155', l: 'Záchranka' },
        { n: '150', l: 'Hasiči' },
        { n: '158', l: 'Policie' }
    ];

    var _timer = null;       // tichý hlídač rizik (běží i se zavřeným oknem)
    var _refresh = null;     // obnovování panelu, jen dokud je okno otevřené
    var _bat = null;         // {level, charging} nebo null = prohlížeč to nedá
    var _batTried = false;
    var _hold = null;        // probíhající podržení tísňového tlačítka
    var _firedTs = 0;        // kdy se naposledy vytáčela tísňová linka
    var _firedNum = '';
    var _editCt = false;     // otevřený editor kontaktů

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(m) {
        try { if (typeof window.quickToast === 'function') { window.quickToast(m); return; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:toast'); }
        // Bez toastu by hlášky o (ne)úspěchu zmizely úplně — a právě tady se člověk
        // musí dozvědět, jestli se něco stalo, nebo ne.
        try { if (typeof window.agInfo === 'function') window.agInfo(m); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:toast'); }
    }
    function vib(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:vib'); } }
    function pad2(n) { return ('0' + n).slice(-2); }
    function cz(n, d) { return Number(n).toFixed(d == null ? 1 : d).replace('.', ','); }
    function dayKey() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function hhmm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

    function cfg() {
        var o = null;
        try { o = JSON.parse(localStorage.getItem(LS)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:cfg'); }
        if (!o || typeof o !== 'object') o = {};
        if (o.drinkMin == null) o.drinkMin = DRINK_DEFAULT;
        if (!o.seen || typeof o.seen !== 'object') o.seen = {};
        if (!o.contacts || !o.contacts.length) o.contacts = [];
        return o;
    }
    function saveCfg(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:saveCfg'); } }

    // ---- poloha VČETNĚ STÁŘÍ ---------------------------------------------------------------
    // Tři zdroje, sestupně podle důvěryhodnosti. Rozdíl mezi nimi je pro nouzi zásadní:
    // AGFix má časové razítko fixu, globály z logika.js ne a poslední uložená poloha
    // v localStorage může být klidně z rána. Proto se stáří táhne až do textu zprávy.
    function fix() {
        try {
            var f = window.AGFix;
            if (f && typeof f.lat === 'number' && typeof f.lng === 'number' && f.ts) {
                return { lat: f.lat, lng: f.lng, acc: (typeof f.acc === 'number' && f.acc > 0) ? f.acc : null, ts: f.ts, src: 'gps' };
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:fix'); }
        try {
            if (typeof userLat === 'number' && userLat != null && typeof userLng === 'number' && userLng != null) {
                return { lat: userLat, lng: userLng, acc: acc(), ts: null, src: 'gps' };
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:fix'); }
        try {
            var p = JSON.parse(localStorage.getItem('arLastPos'));
            if (p && p.lat != null) return { lat: +p.lat, lng: +(p.lng != null ? p.lng : p.lon), acc: null, ts: null, src: 'ulozena' };
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:fix'); }
        return null;
    }
    function acc() { try { if (typeof currentGpsAccuracy === 'number' && currentGpsAccuracy > 0) return currentGpsAccuracy; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:acc'); } return null; }
    function pos() { var f = fix(); return f ? { lat: f.lat, lng: f.lng } : null; }   // pro výpočty soumraku

    function ageTxt(f) {
        if (!f) return '';
        if (f.src === 'ulozena') return 'poslední uložená poloha, čas neznámý';
        if (f.ts == null) return 'čas fixu neznámý';
        var s = Math.max(0, Math.round((Date.now() - f.ts) / 1000));
        if (s < 45) return 'právě teď (před ' + s + ' s)';
        if (s < 3600) return 'před ' + Math.round(s / 60) + ' min';
        return 'před ' + cz(s / 3600) + ' h';
    }
    // 0 = čerstvé, 1 = zestárlé, 2 = nedůvěryhodné / neznámé stáří
    function ageLvl(f) {
        if (!f) return 2;
        if (f.src === 'ulozena' || f.ts == null) return 2;
        var s = (Date.now() - f.ts) / 1000;
        if (s <= 45) return 0;
        if (s <= 300) return 1;
        return 2;
    }
    function sjtsk(lat, lng) {
        try { if (window.GeoCore && typeof GeoCore.toSJTSK === 'function') { var r = GeoCore.toSJTSK(lat, lng); if (r) return { y: Math.abs(r.y), x: Math.abs(r.x) }; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:sjtsk'); }
        try { if (typeof proj4 === 'function') { var s = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); return { y: Math.abs(s[0]), x: Math.abs(s[1]) }; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:sjtsk'); }
        return null;
    }

    // ---- rizika z počasí + slunce ---------------------------------------------------------
    function wx() {
        try {
            var c = JSON.parse(localStorage.getItem('agWeatherCache_v1'));
            if (!c || !c.data) return null;
            return { data: c.data, t: c.t, stale: Date.now() - c.t > 6 * 3600 * 1000, place: c.placeName || null };
        } catch (e) { return null; }
    }
    // nejbližší bouřka v hodinové řadě (do 6 h) + dnešní extrémy
    function risks() {
        var out = { list: [], storm: null, tmax: null, tmin: null, wind: 0, gust: 0, twilight: null, toTwilight: null, sunset: null };
        var w = wx();
        var nowS = Math.floor(Date.now() / 1000);
        if (w && w.data.hourly) {
            w.data.hourly.forEach(function (h) {
                if (h.t == null || h.t < nowS - 3600) return;
                if (h.t <= nowS + 6 * 3600) {
                    if (h.code != null && h.code >= 95 && out.storm == null) out.storm = h.t;
                }
                if (h.t <= nowS + 12 * 3600) {
                    if (h.temp != null) {
                        if (out.tmax == null || h.temp > out.tmax) out.tmax = h.temp;
                        if (out.tmin == null || h.temp < out.tmin) out.tmin = h.temp;
                    }
                    if (h.wind != null && h.wind > out.wind) out.wind = h.wind;
                    if (h.gusts != null && h.gusts > out.gust) out.gust = h.gusts;
                }
            });
        }
        var p = pos();
        if (p && window.AGSun && typeof AGSun.times === 'function') {
            try {
                var tw = AGSun.times(new Date(), p.lat, p.lng, 96);
                var ts = AGSun.times(new Date(), p.lat, p.lng, 90.833);
                out.twilight = tw.set; out.sunset = ts.set;
                if (tw.set) out.toTwilight = tw.set - Date.now();
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:risks'); }
        }

        // sestav seznam rizik (nejzávažnější první)
        if (out.storm != null) {
            var mins = Math.round((out.storm - nowS) / 60);
            out.list.push({
                lvl: 'high', k: 'storm',
                t: mins <= 0 ? 'Bouřka právě teď' : 'Bouřka do ' + (mins < 60 ? mins + ' min' : Math.round(mins / 60) + ' h'),
                d: 'Výtyčka, stativ i ty na volném poli jste nejvyšší bod. Sundej výtyčku, jdi do auta (klec, ne přístřešek u stromu) a přečkej. Měření pár minut vydrží.'
            });
        }
        if (out.tmax != null && out.tmax >= 30) {
            out.list.push({ lvl: 'high', k: 'heat', t: 'Vedro ' + Math.round(out.tmax) + ' °C', d: 'Pij průběžně po menších dávkách (orientačně 0,5 l/h), přestávku dělej ve stínu, nejtěžší práci naplánuj na ráno. Displej v přímém slunci nepřečteš — stiň ho tělem.' });
        } else if (out.tmax != null && out.tmax >= 27) {
            out.list.push({ lvl: 'mid', k: 'heat', t: 'Teplo ' + Math.round(out.tmax) + ' °C', d: 'Voda s sebou, čepice, krém. Na otevřené ploše bez stínu se to sečte rychleji, než čekáš.' });
        }
        if (out.tmin != null && out.tmin <= 0) {
            out.list.push({ lvl: 'mid', k: 'frost', t: 'Mráz ' + Math.round(out.tmin) + ' °C', d: 'Náledí (pozor na krajnice a beton), baterie telefonu drží podstatně méně — nos ho v kapse u těla. Kolíky do promrzlé země nezatlučeš.' });
        }
        if ((out.gust || out.wind) >= 60) {
            out.list.push({ lvl: 'high', k: 'wind', t: 'Silný vítr, nárazy ' + Math.round(out.gust || out.wind) + ' km/h', d: 'Pod stromy nechoď (padající větve), stativ zatěž nebo neopouštěj, výtyčku nedrž svisle proti nárazům — svislost neudržíš a měření je bezcenné.' });
        } else if ((out.gust || out.wind) >= 40) {
            out.list.push({ lvl: 'mid', k: 'wind', t: 'Vítr ' + Math.round(out.gust || out.wind) + ' km/h', d: 'Stativ zatěž, u výtyčky čekej horší svislost — dej si pozor na to, jak držíš libelu.' });
        }
        if (out.toTwilight != null && out.toTwilight > 0 && out.toTwilight < 60 * 60000) {
            out.list.push({ lvl: 'mid', k: 'dusk', t: 'Do tmy zbývá ' + Math.round(out.toTwilight / 60000) + ' min', d: 'Reflexní vestu si vezmi hned (za soumraku tě řidič nevidí). AR měření za chvíli přestane fungovat — kamera potřebuje světlo.' });
        }
        if (!out.list.length) {
            out.list.push({ lvl: 'ok', k: 'ok', t: 'Žádné výrazné riziko', d: w ? 'Podle posledního počasí je dnes venku klid. Vestu a vodu ale stejně.' : 'Nemám stažené počasí — otevři nástroj Počasí a tahle karta se naplní.' });
        }
        out.wxAge = w ? Math.round((Date.now() - w.t) / 60000) : null;
        out.wxStale = w ? w.stale : null;
        out.serious = 0;
        out.list.forEach(function (x) { if (x.lvl === 'high' || x.lvl === 'mid') out.serious++; });
        return out;
    }

    // ---- tiché připomínky (jen když je appka otevřená) --------------------------------------
    function tick() {
        var c = cfg();
        if (!c.on) return;
        if (c.mutedDay === dayKey()) return;
        var r = risks();

        // bouřka — jednou za situaci
        if (r.storm != null && c.seen['storm_' + r.storm] !== 1) {
            c.seen['storm_' + r.storm] = 1; saveCfg(c);
            toast('Blíží se bouřka — s výtyčkou a stativem pryč z volné plochy.');
            return;
        }
        // soumrak — jednou denně, 30 min předem
        if (r.toTwilight != null && r.toTwilight > 0 && r.toTwilight < 30 * 60000 && c.seen['dusk'] !== dayKey()) {
            c.seen['dusk'] = dayKey(); saveCfg(c);
            toast('Za ' + Math.round(r.toTwilight / 60000) + ' min je tma — vesta a konči s AR.');
            return;
        }
        // pití ve vedru
        if (r.tmax != null && r.tmax >= 27) {
            var last = c.lastDrink || 0;
            if (Date.now() - last > (c.drinkMin || DRINK_DEFAULT) * 60000) {
                c.lastDrink = Date.now(); saveCfg(c);
                toast(Math.round(r.tmax) + ' °C — napij se a na chvíli do stínu.');
            }
        }
    }
    function startTimer() {
        if (_timer) return;
        _timer = setInterval(tick, 5 * 60000);
        // uspávání mimo appku řeší prohlížeč sám (timery na pozadí zpomalí/zastaví)
    }
    function stopTimer() { if (_timer) { clearInterval(_timer); _timer = null; } }

    // ---- baterie ----------------------------------------------------------------------------
    // Battery Status API má jen část prohlížečů (na iOS chybí). Když ho není, ukáže se
    // poctivě „nedostupná" — vymýšlet si stav baterie by v nouzovém panelu bylo horší
    // než nic, člověk by podle toho plánoval, jak dlouho ještě může svítit a volat.
    function watchBattery() {
        if (_batTried) return;
        _batTried = true;
        if (!navigator.getBattery) return;
        try {
            navigator.getBattery().then(function (b) {
                function upd() { _bat = { level: b.level, charging: b.charging }; renderStat(); }
                b.addEventListener('levelchange', upd);
                b.addEventListener('chargingchange', upd);
                upd();
            }).catch(function () {});
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:upd'); }
    }

    // ---- text zprávy s polohou --------------------------------------------------------------
    function sosText() {
        var f = fix();
        if (!f) return null;
        var lines = ['Potřebuji pomoc / navedení na tuto polohu:'];
        lines.push('GPS: ' + f.lat.toFixed(6) + ', ' + f.lng.toFixed(6) + (f.acc != null ? ' (přesnost ±' + Math.round(f.acc) + ' m)' : ''));
        var s = sjtsk(f.lat, f.lng);
        if (s) lines.push('S-JTSK Y, X: ' + s.y.toFixed(2) + ', ' + s.x.toFixed(2));
        lines.push('Mapa: https://www.google.com/maps?q=' + f.lat.toFixed(6) + ',' + f.lng.toFixed(6));
        // Stáří polohy patří DO zprávy: příjemce musí vědět, jestli jede na místo,
        // kde jsem teď, nebo kde jsem naposledy byl.
        if (f.ts != null) lines.push('Poloha zjištěna: ' + new Date(f.ts).toLocaleString('cs-CZ') + ' (' + ageTxt(f) + ')');
        else lines.push('POZOR: tohle je poslední uložená poloha, neznámo jak stará — od té doby jsem se mohl přesunout.');
        if (ageLvl(f) === 1) lines.push('POZOR: poloha už není úplně čerstvá, ověř si ji.');
        lines.push('Zpráva odeslána: ' + new Date().toLocaleString('cs-CZ'));
        return lines.join('\n');
    }

    function shareSos() {
        var txt = sosText();
        if (!txt) { toast('Nemám žádnou polohu — počkej na GPS fix nebo místo popiš slovy.'); return; }
        if (navigator.share) {
            navigator.share({ title: 'Moje poloha', text: txt }).then(function () {
                // Sdílení skončilo úspěchem = text jsme předali cizí aplikaci. Že tam
                // zpráva opravdu odešla, appka nezjistí — tak to taky nebude tvrdit.
                toast('Poloha předána vybrané aplikaci. Zkontroluj, že tam zpráva opravdu odešla.');
            }, function (err) {
                var name = (err && (err.name || err.message)) || '';
                if (/abort|cancel/i.test(String(name))) { toast('Sdílení zrušeno — nic se neodeslalo.'); return; }
                copy(txt);
            });
        } else {
            toast('Systémové sdílení tenhle prohlížeč nemá — zkouším zkopírovat.');
            copy(txt);
        }
    }
    function copy(txt) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(txt).then(function () { toast('Poloha zkopírována — vlož ji do zprávy.'); }, function () { legacy(txt); });
                return;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:copy'); }
        legacy(txt);
    }
    function legacy(txt) {
        try {
            var ta = document.createElement('textarea');
            ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            var ok = document.execCommand('copy'); ta.remove();
            toast(ok ? 'Poloha zkopírována — vlož ji do zprávy.' : 'Kopírování se nepovedlo — souřadnice si opiš z panelu.');
        } catch (e) { toast('Kopírování se nepovedlo — souřadnice si opiš z panelu.'); }
    }

    // Otevře vytáčení. Že se hovor spojil (nebo že telefon vůbec tel: umí), appka
    // nezjistí — proto se nikde neobjeví „voláno", jen „předávám telefonu".
    // quiet = nouzová obrazovka to říká sama, toast by se přes ni jen přebil.
    function dial(num, quiet) {
        try { window.location.href = 'tel:' + num; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'bezpecnost:dial'); }
        if (!quiet) toast('Předávám ' + num + ' telefonu. Jestli se vytáčení neotevřelo, vytoč ho ručně.');
    }
    // Otevře zprávy s předvyplněným textem. Odeslat musí uživatel sám.
    function smsTo(num) {
        var txt = sosText();
        if (!txt) { toast('Nemám žádnou polohu — počkej na GPS fix.'); return; }
        try {
            window.location.href = 'sms:' + num + '?&body=' + encodeURIComponent(txt);
            toast('Otevírám zprávy — odeslat musíš ještě ty. Jestli se nic neotevřelo, použij Zkopírovat.');
        } catch (e) { copy(txt); }
    }

    // ---- UI: styly ---------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = [
            // ---- stavová mřížka nahoře
            '#ag-bz-modal .bz-stat{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px;margin:0 0 12px;}',
            '#ag-bz-modal .bz-c{min-width:0;padding:7px 9px;border-radius:var(--r-sm,9px);border:1px solid var(--glass-border);background:var(--surface-1);}',
            '#ag-bz-modal .bz-c.wide{grid-column:1/-1;}',
            '#ag-bz-modal .bz-c .k{display:flex;align-items:center;gap:5px;font-size:calc(10px * var(--ag-font-scale, 1));font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted);}',
            '#ag-bz-modal .bz-c .k .icon{width:13px;height:13px;flex:none;}',
            '#ag-bz-modal .bz-c .v{margin-top:2px;font-size:calc(14px * var(--ag-font-scale, 1));font-weight:700;line-height:1.3;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}',
            '#ag-bz-modal .bz-c .s{font-size:calc(10.5px * var(--ag-font-scale, 1));line-height:1.35;color:var(--text-muted);overflow-wrap:anywhere;}',
            '#ag-bz-modal .bz-c.good .v{color:var(--accent-bright,#3eb487);}',
            '#ag-bz-modal .bz-c.warn{border-color:rgba(251,191,36,.45);}',
            '#ag-bz-modal .bz-c.warn .v{color:var(--warning,#fbbf24);}',
            '#ag-bz-modal .bz-c.bad{border-color:rgba(251,113,133,.5);}',
            '#ag-bz-modal .bz-c.bad .v{color:var(--danger,#fb7185);}',
            // ---- tísňová karta
            '#ag-bz-modal .bz-sos{margin:0 0 12px;padding:11px;border-radius:var(--r-md,12px);',
            '  border:1px solid rgba(251,113,133,.42);background:rgba(251,113,133,.09);}',
            '#ag-bz-modal .bz-hold{position:relative;display:block;width:100%;box-sizing:border-box;overflow:hidden;',
            '  min-height:86px;padding:14px 14px;margin:0;border-radius:var(--r-md,12px);',
            '  border:2px solid var(--danger,#fb7185);background:rgba(251,113,133,.16);color:var(--text-color);',
            '  font:800 20px/1.15 var(--font-display,inherit);letter-spacing:.03em;text-align:center;cursor:pointer;',
            '  touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}',
            '#ag-bz-modal .bz-hold .bz-fill{position:absolute;left:0;top:0;bottom:0;width:0;pointer-events:none;',
            '  background:var(--danger,#fb7185);opacity:.28;}',
            '#ag-bz-modal .bz-hold .bz-t,#ag-bz-modal .bz-hold .bz-s{position:relative;display:block;}',
            '#ag-bz-modal .bz-hold .bz-t{display:flex;align-items:center;justify-content:center;gap:9px;}',
            '#ag-bz-modal .bz-hold .bz-t .icon{width:24px;height:24px;flex:none;color:var(--danger,#fb7185);}',
            '#ag-bz-modal .bz-hold .bz-s{margin-top:7px;font:600 12px/1.35 var(--font-ui,inherit);letter-spacing:0;color:var(--text-muted);}',
            '#ag-bz-modal .bz-hold.holding{background:rgba(251,113,133,.24);}',
            '#ag-bz-modal .bz-hold.holding .bz-s{color:var(--text-color);}',
            '#ag-bz-modal .bz-hold.ready{background:rgba(251,113,133,.40);}',
            '#ag-bz-modal .bz-hold.ready .bz-s{color:var(--text-color);font-weight:800;}',
            '#ag-bz-modal .bz-hint{margin-top:8px;font-size:calc(11.5px * var(--ag-font-scale, 1));line-height:1.4;color:var(--text-muted);}',
            '#ag-bz-modal .bz-hint b{color:var(--text-color);}',
            // ---- po vytočení
            '#ag-bz-modal .bz-fired{padding:12px;border-radius:var(--r-md,12px);border:2px solid var(--danger,#fb7185);',
            '  background:rgba(251,113,133,.16);text-align:center;}',
            '#ag-bz-modal .bz-fired h4{margin:0 0 4px;font-size:calc(15px * var(--ag-font-scale, 1));font-weight:800;color:var(--danger,#fb7185);}',
            '#ag-bz-modal .bz-big{margin:8px 0;padding:8px;border-radius:var(--r-sm,9px);background:var(--surface-2);',
            '  font:800 20px/1.3 var(--font-mono,monospace);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}',
            // ---- tísňová čísla
            '#ag-bz-modal .bz-nums{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px;}',
            '#ag-bz-modal .bz-num{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 3px;margin:0;',
            '  border-radius:var(--r-sm,9px);border:1px solid var(--glass-border);background:var(--surface-1);',
            '  color:var(--text-color);font:800 16px/1 var(--font-ui,inherit);font-variant-numeric:tabular-nums;cursor:pointer;}',
            '#ag-bz-modal .bz-num small{font-size:calc(9.5px * var(--ag-font-scale, 1));font-weight:600;letter-spacing:.02em;color:var(--text-muted);}',
            '#ag-bz-modal .bz-num.armed{border-color:var(--danger,#fb7185);background:rgba(251,113,133,.20);color:var(--danger,#fb7185);}',
            '#ag-bz-modal .bz-num.armed small{color:var(--danger,#fb7185);}',
            // ---- rozbalovací bloky (rizika, kontakty, co appka umí)
            '#ag-bz-modal .bz-det{margin:0 0 8px;border:1px solid var(--glass-border);border-radius:var(--r-md,12px);',
            '  background:var(--surface-1);overflow:hidden;}',
            '#ag-bz-modal .bz-det>summary{list-style:none;display:flex;align-items:center;gap:8px;padding:11px 12px;',
            '  font-size:calc(13px * var(--ag-font-scale, 1));font-weight:700;cursor:pointer;}',
            '#ag-bz-modal .bz-det>summary::-webkit-details-marker{display:none;}',
            '#ag-bz-modal .bz-det>summary .icon{width:17px;height:17px;flex:none;color:var(--accent);}',
            '#ag-bz-modal .bz-det>summary .cnt{margin-left:auto;font-size:calc(11px * var(--ag-font-scale, 1));font-weight:600;color:var(--text-muted);}',
            // CHYBA (opraveno): globální „details summary" ve style.css dává margin-top:16px,
            // čáru nahoře a opacity .8. Uvnitř naší zaoblené karty z toho byl prázdný pruh
            // a linka přetnutá přes roh, a nadpis vypadal jako zašedlý/vypnutý.
            '#ag-bz-modal .bz-det>summary{margin-top:0;border-top:none;opacity:1;}',
            '#ag-bz-modal .bz-in{padding:0 12px 12px;}',
            // ---- rizika
            '#ag-bz-modal .bz-r{border-radius:var(--r-sm,9px);padding:9px 11px;margin-bottom:7px;font-size:calc(12.5px * var(--ag-font-scale, 1));',
            '  line-height:1.5;border:1px solid transparent;}',
            '#ag-bz-modal .bz-r:last-child{margin-bottom:0;}',
            '#ag-bz-modal .bz-r b{display:block;margin-bottom:2px;}',
            '#ag-bz-modal .bz-r.high{background:rgba(251,113,133,.12);border-color:rgba(251,113,133,.45);}',
            '#ag-bz-modal .bz-r.mid{background:rgba(251,191,36,.10);border-color:rgba(251,191,36,.40);}',
            '#ag-bz-modal .bz-r.ok{background:rgba(52,211,153,.10);border-color:rgba(52,211,153,.35);}',
            // ---- kontakty
            '#ag-bz-modal .bz-ct{display:flex;align-items:center;gap:7px;padding:8px 0;border-top:1px solid var(--glass-border);}',
            '#ag-bz-modal .bz-ct:first-child{border-top:none;padding-top:2px;}',
            '#ag-bz-modal .bz-ct .nm{flex:1;min-width:0;font-size:calc(13px * var(--ag-font-scale, 1));font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#ag-bz-modal .bz-ct .nm small{display:block;font-weight:500;color:var(--text-muted);font-variant-numeric:tabular-nums;}',
            '#ag-bz-modal .bz-mini{display:inline-flex;align-items:center;justify-content:center;gap:5px;flex:none;',
            '  padding:8px 11px;margin:0;border-radius:var(--r-sm,9px);border:1px solid var(--glass-border);',
            '  background:var(--surface-1);color:var(--text-color);font-size:calc(12px * var(--ag-font-scale, 1));font-weight:700;cursor:pointer;}',
            '#ag-bz-modal .bz-mini .icon{width:15px;height:15px;}',
            '#ag-bz-modal .bz-mini.prim{border-color:var(--accent-line);background:var(--accent-soft);color:var(--accent);}',
            '#ag-bz-modal .bz-mini.prim .icon{color:var(--accent);}',
            '#ag-bz-modal .bz-in input[type="text"],#ag-bz-modal .bz-in input[type="tel"]{width:100%;box-sizing:border-box;',
            '  margin:0 0 6px;padding:9px 10px;border-radius:var(--r-sm,9px);border:1px solid var(--glass-border);',
            // 16 px schválně: Safari na iOS při zaostření políčka menšího než 16 px
            // zvětší celou stránku a panel „uskočí" — v rukavicích nepříjemné.
            '  background:var(--surface-2);color:inherit;font-size:calc(16px * var(--ag-font-scale, 1));}',
            // ---- přepínač připomínek
            '#ag-bz-modal .bz-sw{display:flex;align-items:center;gap:10px;margin:0 0 8px;padding:10px 12px;',
            '  border-radius:var(--r-md,12px);border:1px solid var(--glass-border);background:var(--surface-1);font-size:calc(12.5px * var(--ag-font-scale, 1));}',
            '#ag-bz-modal .bz-sw input{width:20px;height:20px;flex:none;}',
            // CHYBA (opraveno): globální „.modal-content label" je display:block s
            // margin-top:16px — popisek přepínače kvůli tomu spadl o kus pod zaškrtávátko
            // a byl vybledlý barvou pro popisky formuláře.
            '#ag-bz-modal .bz-sw label{margin:0;font-size:calc(12.5px * var(--ag-font-scale, 1));font-weight:600;color:var(--text-color);}',
            '#ag-bz-modal .bz-num-int{width:66px;padding:5px 7px;border-radius:var(--r-sm,9px);',
            '  border:1px solid var(--glass-border);background:var(--surface-2);color:inherit;font-size:calc(16px * var(--ag-font-scale, 1));}',
            '#ag-bz-modal .bz-note{margin-top:2px;font-size:calc(11px * var(--ag-font-scale, 1));line-height:1.5;color:var(--text-muted);}',
            // ---- rukavice: větší dotykové cíle, panel zůstává kompaktní
            'body.ag-glove #ag-bz-modal .bz-hold{min-height:100px;font-size:calc(22px * var(--ag-font-scale, 1));}',
            'body.ag-glove #ag-bz-modal .bz-num{padding:11px 3px;font-size:calc(18px * var(--ag-font-scale, 1));}',
            'body.ag-glove #ag-bz-modal .bz-mini{padding:11px 13px;}'
        ].join('\n');
        document.head.appendChild(s);
    }

    // ---- UI: kostra okna ----------------------------------------------------------------------
    function ensureModal() {
        var m = document.getElementById('ag-bz-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'ag-bz-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Bezpečnost v terénu</h3>' +
            // CHYBA (opraveno): obsah MUSÍ být v .modal-body. Modály jedou přes celou
            // obrazovku a .modal-overlay .modal-content má height:100 % + overflow:hidden
            // — bez rolovací vrstvy se všechno pod ohybem displeje jen OŘÍZLO a nešlo se
            // dostat ke kontaktům ani k tlačítku Zavřít. Nadpis a Zavřít zůstávají mimo
            // rolování, ať jsou pořád na očích.
            '  <div class="modal-body" id="ag-bz-scroll">' +
            '    <div class="bz-stat" id="ag-bz-stat"></div>' +
            '    <div id="ag-bz-sosbox"></div>' +
            '    <div id="ag-bz-body"></div>' +
            '  </div>' +
            '  <div style="display:flex;gap:8px;margin-top:12px;">' +
            '    <button type="button" class="btn btn-secondary" id="ag-bz-close" style="margin-left:auto;">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);

        m.querySelector('#ag-bz-close').addEventListener('click', close);

        // klikací akce (tísňová karta i tělo) — delegovaně, obsah se překresluje
        m.addEventListener('click', onClick);

        // podržení tísňového tlačítka: Pointer Events tam, kde jsou; jinak dotyk + myš
        var box = m.querySelector('#ag-bz-sosbox');
        if (window.PointerEvent) {
            box.addEventListener('pointerdown', onDown);
        } else {
            box.addEventListener('touchstart', onDown, { passive: false });
            box.addEventListener('mousedown', onDown);
        }

        m.querySelector('#ag-bz-body').addEventListener('change', onChange);
        return m;
    }

    // ---- UI: stavová hlavička -------------------------------------------------------------
    function cell(cls, icon, key, val, sub) {
        // icon = buď id ze sprite ("i-…"), nebo rovnou hotové SVG z ICO_* (viz hlavička)
        return '<div class="bz-c ' + cls + '"><div class="k">' + (icon.charAt(0) === '<' ? icon : ic(icon)) + esc(key) + '</div>' +
            '<div class="v">' + val + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
    }
    function renderStat() {
        var el = document.getElementById('ag-bz-stat');
        if (!el) return;
        var f = fix(), h = '';

        // 1) poloha + stáří (nejdůležitější údaj celého panelu)
        if (f) {
            var lv = ageLvl(f);
            var s = sjtsk(f.lat, f.lng);
            h += cell(lv === 0 ? 'good wide' : (lv === 1 ? 'warn wide' : 'bad wide'), 'i-map-pin', 'Kde jsem',
                esc(f.lat.toFixed(6) + ', ' + f.lng.toFixed(6)),
                (s ? 'S-JTSK Y ' + esc(s.y.toFixed(2)) + ' &nbsp; X ' + esc(s.x.toFixed(2)) + '<br>' : 'S-JTSK teď nespočítám (chybí převodní knihovna).<br>') +
                'Poloha: ' + esc(ageTxt(f)) + (lv === 2 ? ' — <b>nespoléhej na ni</b>' : ''));
        } else {
            h += cell('bad wide', 'i-map-pin', 'Kde jsem', 'Nemám polohu',
                'GPS ještě nechytila fix. Tísňovou linku volej i tak a místo popiš slovy (obec, silnice, staničení, co je vidět).');
        }

        // 2) přesnost
        var a = f ? f.acc : null;
        if (a != null) h += cell(a <= 10 ? 'good' : (a <= 30 ? 'warn' : 'bad'), 'i-satellite', 'Přesnost', '±' + esc(cz(a, a < 10 ? 1 : 0)) + ' m', null);
        else h += cell('warn', 'i-satellite', 'Přesnost', 'neznámá', null);

        // 3) datový signál — hlasové volání na něm nezávisí, což je tady podstatné.
        // navigator.onLine umí říct jen „zařízení má nějaké spojení": na wifi bez
        // internetu i na jedné čárce EDGE hlásí Online. V bezpečnostním panelu se to
        // proto nevydává za jistotu — člověk by podle toho čekal, že sdílení projde.
        var on = (typeof navigator.onLine === 'boolean') ? navigator.onLine : true;
        h += cell(on ? 'good' : 'warn', 'i-download', 'Data', on ? 'Online' : 'Offline',
            on ? 'hlásí prohlížeč — že to opravdu projde, se pozná až při odeslání' : 'Volání a SMS to nebrání.');

        // 4) baterie
        if (_bat) {
            var pct = Math.round(_bat.level * 100);
            h += cell(pct <= 15 ? 'bad' : (pct <= 30 ? 'warn' : 'good'), ICO_BAT, 'Baterie', pct + ' %', _bat.charging ? 'nabíjí se' : null);
        } else {
            h += cell('', ICO_BAT, 'Baterie', 'nedostupná', 'prohlížeč ji neukáže');
        }

        // 5) komu poletí poloha
        var ct = cfg().contacts;
        if (ct.length) {
            h += cell('wide', 'i-users', 'Komu pošlu polohu', esc(ct[0].n || ct[0].p),
                esc(ct[0].p) + (ct.length > 1 ? ' &nbsp;+ dalších ' + (ct.length - 1) : '') + ' — appka neposílá sama, jen otevře zprávy nebo sdílení.');
        } else {
            h += cell('warn wide', 'i-users', 'Komu pošlu polohu', 'Nikdo nenastavený',
                'Přidej si kontakt níž — v nouzi na hledání čísla není čas.');
        }
        el.innerHTML = h;
    }

    // ---- UI: tísňová karta -----------------------------------------------------------------
    function renderSos() {
        var el = document.getElementById('ag-bz-sosbox');
        if (!el) return;

        // krátce po vytočení: obrazovka, ze které se dá číst operátorovi
        if (_firedTs && Date.now() - _firedTs < FIRED_MS) {
            var f = fix(), s = f ? sjtsk(f.lat, f.lng) : null;
            el.innerHTML =
                '<div class="bz-fired">' +
                // Ne „Vytáčím" — appka jen předala číslo telefonu a jestli se hovor
                // opravdu spojil, nezjistí. Nadpis proto říká přesně to, co se stalo.
                '<h4>' + esc(_firedNum) + ' — předáno telefonu</h4>' +
                '<div style="font-size:calc(12px * var(--ag-font-scale, 1));line-height:1.45;color:var(--text-muted);">Jestli se vytáčení neotevřelo, vytoč číslo ručně — appka nepozná, jestli hovor běží.</div>' +
                '<div class="bz-big">' + (f ? esc(f.lat.toFixed(6) + ', ' + f.lng.toFixed(6)) : 'polohu nemám') + '</div>' +
                (s ? '<div style="font-size:calc(12.5px * var(--ag-font-scale, 1));font-weight:700;">S-JTSK Y ' + esc(s.y.toFixed(2)) + ' &nbsp; X ' + esc(s.x.toFixed(2)) + '</div>' : '') +
                (f ? '<div style="font-size:calc(11px * var(--ag-font-scale, 1));color:var(--text-muted);margin-top:3px;">Poloha: ' + esc(ageTxt(f)) + '</div>' : '') +
                '<div style="display:flex;gap:7px;justify-content:center;flex-wrap:wrap;margin-top:10px;">' +
                '<button type="button" class="bz-mini" data-act="dial" data-num="' + esc(_firedNum) + '">' + ICO_PHONE + 'Vytočit znovu</button>' +
                '<button type="button" class="bz-mini" data-act="copy">' + ic('i-file-text') + 'Zkopírovat polohu</button>' +
                '<button type="button" class="bz-mini" data-act="unfire">' + ic('i-x') + 'Zpět na panel</button>' +
                '</div></div>';
            return;
        }
        _firedTs = 0;

        var nums = '';
        for (var i = 0; i < NUMS.length; i++) {
            nums += '<button type="button" class="bz-num" data-act="num" data-num="' + esc(NUMS[i].n) + '">' +
                esc(NUMS[i].n) + '<small>' + esc(NUMS[i].l) + '</small></button>';
        }
        el.innerHTML =
            // data-no-swipe: v tísňové kartě se DRŽÍ (2 s na 112) a dvoukrokově odjišťuje
            // (.bz-num). Vodorovné zavírací gesto z js/modal-close.js si posun počítá samo
            // z clientX na documentu, takže ho preventDefault() v onDown() nezastaví — bez
            // tohohle atributu stačí při držení drift ~10 px do strany a panel začne odjíždět,
            // nad 110 px se okno uprostřed odpočtu zavře. Tlačítko je vysoké 86 px (100 px
            // v rukavicích) a prst po něm v terénu běžně sjede.
            '<div class="bz-sos" data-no-swipe>' +
            '<button type="button" class="bz-hold" id="ag-bz-hold">' +
            '  <span class="bz-fill"></span>' +
            '  <span class="bz-t">' + ICO_PHONE + 'TÍSŇOVÁ LINKA 112</span>' +
            '  <span class="bz-s">Podrž 2 s a pusť — telefon vytočí 112</span>' +
            '</button>' +
            '<div class="bz-hint" id="ag-bz-hint">Pojistka proti omylu: ťuknutí nestačí. Pustíš dřív nebo mimo tlačítko a <b>nic se nestane</b>.</div>' +
            '<div class="bz-nums">' + nums + '</div>' +
            '</div>';
    }
    function hint(msg) {
        var el = document.getElementById('ag-bz-hint');
        if (el) el.innerHTML = msg;
    }

    // ---- podržení: pojistka tísňového tlačítka ----------------------------------------------
    function ptOf(e) {
        if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        if (typeof e.clientX === 'number') return { x: e.clientX, y: e.clientY };
        return null;
    }
    function overHold(e) {
        var p = ptOf(e);
        if (!p) return false;
        var el = document.elementFromPoint(p.x, p.y);
        return !!(el && el.closest && el.closest('#ag-bz-hold'));
    }
    function setHoldUI(p, ready) {
        var b = document.getElementById('ag-bz-hold');
        if (!b) return;
        var fill = b.querySelector('.bz-fill'), sub = b.querySelector('.bz-s');
        if (fill) fill.style.width = Math.round(p * 100) + '%';
        if (!sub) return;
        if (ready) sub.textContent = 'PUSŤ a telefon vytočí 112';
        else sub.textContent = 'Drž ještě ' + cz(Math.max(0, HOLD_MS * (1 - p)) / 1000) + ' s — pustíš, zrušeno';
    }
    function onDown(e) {
        var t = e.target;
        if (!t || !t.closest || !t.closest('#ag-bz-hold')) return;
        if (e.type === 'mousedown' && e.button !== 0) return;
        if (_hold) return;
        if (e.preventDefault) e.preventDefault();   // ať se nespustí výběr textu / scroll
        var btn = document.getElementById('ag-bz-hold');
        if (!btn) return;
        btn.classList.add('holding');
        vib(12);
        _hold = { t0: Date.now(), ready: false, iv: null };
        setHoldUI(0, false);
        _hold.iv = setInterval(function () {
            if (!_hold) return;
            var p = Math.min(1, (Date.now() - _hold.t0) / HOLD_MS);
            if (p >= 1 && !_hold.ready) {
                _hold.ready = true;
                var b = document.getElementById('ag-bz-hold');
                if (b) b.classList.add('ready');
                vib([40, 40, 40]);
            }
            setHoldUI(p, _hold.ready);
        }, 50);
        // konec držení chytáme na okně — prst může sjet mimo tlačítko
        if (window.PointerEvent) {
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onAbort);
        } else {
            window.addEventListener('touchend', onUp);
            window.addEventListener('touchcancel', onAbort);
            window.addEventListener('mouseup', onUp);
        }
    }
    function stopHold() {
        if (_hold && _hold.iv) clearInterval(_hold.iv);
        var ready = !!(_hold && _hold.ready);
        _hold = null;
        var b = document.getElementById('ag-bz-hold');
        if (b) {
            b.classList.remove('holding', 'ready');
            var fill = b.querySelector('.bz-fill'), sub = b.querySelector('.bz-s');
            if (fill) fill.style.width = '0';
            if (sub) sub.textContent = 'Podrž 2 s a pusť — telefon vytočí 112';
        }
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onAbort);
        window.removeEventListener('touchend', onUp);
        window.removeEventListener('touchcancel', onAbort);
        window.removeEventListener('mouseup', onUp);
        return ready;
    }
    function onUp(e) {
        if (!_hold) return;
        var over = overHold(e);
        var ready = stopHold();
        if (ready && over) { fire('112'); return; }
        if (ready) hint('Pustil jsi mimo tlačítko — <b>nic se nevytočilo</b>. Zkus to znovu a pusť na tlačítku.');
        else hint('Zrušeno — <b>nic se nevytočilo</b>. Tísňové tlačítko drž až do konce odpočtu.');
    }
    function onAbort() { if (_hold) { stopHold(); hint('Podržení přerušeno — <b>nic se nevytočilo</b>.'); } }

    function fire(num) {
        _firedTs = Date.now();
        _firedNum = num;
        vib([70, 60, 70, 60, 200]);
        renderSos();     // nejdřív obrazovka s údaji pro operátora, teprve pak vytáčení
        dial(num, true);
    }

    // ---- UI: tělo (dlaždice, kontakty, rizika, připomínky) -----------------------------------
    function quad(act, icon, label, prim) {
        return '<button type="button"' + (prim ? ' class="qt-prim"' : '') + ' data-act="' + act + '">' +
            (icon === 'phone' ? ICO_PHONE : ic(icon)) + '<span>' + esc(label) + '</span></button>';
    }
    function render() {
        renderStat();
        if (!_hold) renderSos();
        var body = document.getElementById('ag-bz-body');
        if (!body) return;
        var c = cfg(), r = risks(), h = '';

        // --- vedlejší akce jako čtverečky (stejný jazyk jako Nástroje)
        h += '<div class="ag-quad">' +
            quad('share', 'i-share', 'Poslat polohu', true) +
            quad('sms', 'i-file-text', 'SMS s polohou') +
            quad('copy', 'i-edit', 'Zkopírovat') +
            (c.contacts.length ? quad('callct', 'phone', 'Volat ' + shortName(c.contacts[0])) : quad('addct', 'i-users', 'Přidat kontakt')) +
            '</div>';

        // --- kontakty
        h += '<details class="bz-det"' + (_editCt ? ' open' : '') + ' id="ag-bz-ctd"><summary>' + ic('i-users') +
            'Nouzové kontakty<span class="cnt">' + (c.contacts.length ? c.contacts.length + ' uloženo' : 'žádný') + '</span></summary><div class="bz-in">';
        if (!c.contacts.length) {
            h += '<div class="bz-note" style="margin:0 0 8px;">Kdo se má o tobě dozvědět, když se něco stane — parťák, dispečink, doma. Čísla zůstávají jen v tomhle telefonu, nikam se neodesílají.</div>';
        }
        c.contacts.forEach(function (k, i) {
            h += '<div class="bz-ct"><div class="nm">' + esc(k.n || k.p) + '<small>' + esc(k.p) + '</small></div>' +
                '<button type="button" class="bz-mini prim" data-act="dialct" data-i="' + i + '">' + ICO_PHONE + 'Volat</button>' +
                '<button type="button" class="bz-mini" data-act="smsct" data-i="' + i + '">' + ic('i-share') + 'SMS</button>' +
                '<button type="button" class="bz-mini" data-act="delct" data-i="' + i + '">' + ic('i-trash') + '</button></div>';
        });
        if (c.contacts.length < MAX_CONTACTS) {
            h += '<div style="margin-top:9px;">' +
                '<input type="text" id="ag-bz-cn" placeholder="Jméno (např. Parťák Petr)" autocomplete="off">' +
                '<input type="tel" id="ag-bz-cp" placeholder="Telefon (+420…)" autocomplete="off">' +
                '<button type="button" class="bz-mini prim" data-act="savect" style="width:100%;">' + ic('i-plus') + 'Uložit kontakt</button></div>';
        } else {
            h += '<div class="bz-note">Víc než ' + MAX_CONTACTS + ' kontakty se v nouzi stejně neprolistují.</div>';
        }
        h += '</div></details>';

        // --- rizika dneška
        h += '<details class="bz-det"' + (r.serious ? ' open' : '') + '><summary>' + ic('i-alert') +
            'Rizika dneška<span class="cnt">' + (r.serious ? r.serious + '×' : 'klid') + '</span></summary><div class="bz-in">';
        r.list.forEach(function (x) { h += '<div class="bz-r ' + x.lvl + '"><b>' + esc(x.t) + '</b>' + esc(x.d) + '</div>'; });
        if (r.sunset || r.twilight) {
            h += '<div class="bz-note">Západ ' + (r.sunset ? esc(hhmm(r.sunset)) : '–') +
                ', tma (konec soumraku) ' + (r.twilight ? esc(hhmm(r.twilight)) : '–') + '.</div>';
        }
        if (r.wxAge != null) {
            h += '<div class="bz-note">Počasí je z posledního stažení před ' + r.wxAge + ' min' + (r.wxStale ? ' — starší data, otevři Počasí' : '') + '.</div>';
        } else {
            h += '<div class="bz-note">Nemám stažené počasí — otevři nástroj Počasí a rizika se dopočítají.</div>';
        }
        h += '</div></details>';

        // --- tiché připomínky
        h += '<div class="bz-sw"><input type="checkbox" id="ag-bz-on"' + (c.on ? ' checked' : '') + '>' +
            '<label for="ag-bz-on" style="flex:1;">Tiché připomínky (pití, bouřka, soumrak)' +
            (c.mutedDay === dayKey() ? '<br><small style="color:var(--warning,#fbbf24);">Dnes ztišeno.</small>' : '') + '</label>' +
            (c.on ? '<button type="button" class="bz-mini" data-act="mute">Ztišit na dnes</button>' : '') + '</div>';
        if (c.on) {
            h += '<div style="font-size:calc(12.5px * var(--ag-font-scale, 1));margin:0 0 8px;padding:0 2px;">Připomínka pití každých ' +
                '<input type="number" inputmode="numeric" id="ag-bz-int" class="bz-num-int" min="15" max="180" step="5" value="' + (c.drinkMin || DRINK_DEFAULT) + '"> min ' +
                '<span style="color:var(--text-muted);">(jen nad 27 °C)</span></div>';
        }

        // --- co appka umí a co ne (schválně napsané natvrdo, ne v nápovědě jinde)
        h += '<details class="bz-det"><summary>' + ic('i-info') + 'Co appka umí a co ne</summary><div class="bz-in">' +
            '<div class="bz-note">' +
            '<b>Neposílá nic sama.</b> Tísňové tlačítko otevře vytáčení, „SMS s polohou" otevře zprávy s předvyplněným textem, „Poslat polohu" otevře systémové sdílení. Odeslání ani spojení hovoru appka neumí ověřit, takže nikde netvrdí „odesláno".<br><br>' +
            '<b>Poloha může být stará.</b> Nahoře vždycky svítí, kdy byla naměřená. Když je z paměti (bez času), je to napsané i ve zprávě, kterou pošleš.<br><br>' +
            '<b>Připomínky běží jen v otevřené appce</b> — webová appka časovače na pozadí nedostane. Nejsou to notifikace ani zvuk, jen tichý toast.<br><br>' +
            'Hodnoty u rizik jsou orientační doporučení pro práci venku, ne citace předpisů: povinnosti zaměstnavatele (ochranné nápoje, bezpečnostní přestávky) řeší NV 361/2007 Sb. podle třídy práce a skutečně naměřených podmínek.' +
            '</div></div></details>';

        body.innerHTML = h;
    }
    function shortName(k) {
        var s = String(k.n || k.p || '');
        return s.length > 9 ? s.slice(0, 8) + '…' : s;
    }

    // ---- obsluha kliků -----------------------------------------------------------------------
    var _armed = null;   // {num, tid} — vedlejší tísňové číslo čeká na druhý tap
    function disarm() {
        if (!_armed) return;
        clearTimeout(_armed.tid);
        var b = document.querySelector('#ag-bz-modal .bz-num.armed');
        if (b) { b.classList.remove('armed'); b.innerHTML = esc(_armed.num) + '<small>' + esc(_armed.lbl) + '</small>'; }
        _armed = null;
    }
    function onClick(e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var b = t.closest('[data-act]');
        if (!b) return;
        var act = b.getAttribute('data-act');
        var c = cfg(), i;

        if (act === 'num') {
            // Druhý tap jako pojistka: první tap číslo jen „natáhne" (viz hlavička —
            // u vedlejších linek by plné podržení bylo zbytečně těžkopádné, ale
            // vytočit záchranku omylem taky nechceme).
            var num = b.getAttribute('data-num');
            if (_armed && _armed.num === num) { var n = num; disarm(); fire(n); return; }
            disarm();
            var lbl = '';
            for (i = 0; i < NUMS.length; i++) if (NUMS[i].n === num) lbl = NUMS[i].l;
            _armed = { num: num, lbl: lbl, tid: setTimeout(disarm, ARM_MS) };
            b.classList.add('armed');
            b.innerHTML = esc(num) + '<small>ťukni znovu = volat</small>';
            vib(12);
            return;
        }
        disarm();

        if (act === 'share') { shareSos(); return; }
        if (act === 'copy') { var tx = sosText(); if (tx) copy(tx); else toast('Nemám žádnou polohu — počkej na GPS fix.'); return; }
        if (act === 'sms') {
            if (!c.contacts.length) { toast('Nemáš nouzový kontakt — přidej si ho níž.'); openContacts(); return; }
            smsTo(c.contacts[0].p); return;
        }
        if (act === 'callct') { if (c.contacts.length) dial(c.contacts[0].p); return; }
        if (act === 'addct') { openContacts(); return; }
        if (act === 'dial') { dial(b.getAttribute('data-num'), true); return; }
        if (act === 'unfire') { _firedTs = 0; renderSos(); return; }
        if (act === 'dialct') { i = +b.getAttribute('data-i'); if (c.contacts[i]) dial(c.contacts[i].p); return; }
        if (act === 'smsct') { i = +b.getAttribute('data-i'); if (c.contacts[i]) smsTo(c.contacts[i].p); return; }
        if (act === 'delct') {
            i = +b.getAttribute('data-i');
            if (!c.contacts[i]) return;
            var nm = c.contacts[i].n || c.contacts[i].p;
            c.contacts.splice(i, 1); saveCfg(c); _editCt = true; render();
            toast('Kontakt ' + nm + ' smazán.');
            return;
        }
        if (act === 'savect') {
            var en = document.getElementById('ag-bz-cn'), ep = document.getElementById('ag-bz-cp');
            var nn = en ? String(en.value || '').trim() : '';
            var pp = ep ? String(ep.value || '').replace(/\s/g, '') : '';
            if (!/^\+?[0-9]{3,}$/.test(pp)) { toast('Zadej telefonní číslo (jen číslice, případně s +420).'); return; }
            c.contacts.push({ n: nn || pp, p: pp }); saveCfg(c); _editCt = true; render();
            toast('Kontakt uložen — zůstává jen v tomhle telefonu.');
            return;
        }
        if (act === 'mute') { c.mutedDay = dayKey(); saveCfg(c); toast('Připomínky na dnes ztišené.'); render(); return; }
    }
    function openContacts() {
        _editCt = true;
        var d = document.getElementById('ag-bz-ctd');
        if (d) { d.open = true; var f = document.getElementById('ag-bz-cn'); if (f) f.focus(); }
        else render();
    }
    function onChange(e) {
        var t = e.target;
        if (!t) return;
        if (t.id === 'ag-bz-on') {
            var c = cfg();
            c.on = !!t.checked;
            if (c.on) { c.mutedDay = null; c.lastDrink = Date.now(); }
            saveCfg(c);
            if (c.on) startTimer(); else stopTimer();
            render();
        } else if (t.id === 'ag-bz-int') {
            var c2 = cfg();
            var n = parseInt(t.value, 10);
            c2.drinkMin = (isFinite(n) && n >= 15 && n <= 180) ? n : DRINK_DEFAULT;
            saveCfg(c2);
        }
    }

    // ---- otevření / zavření --------------------------------------------------------------------
    function open() {
        var m = ensureModal();
        m.style.display = 'flex';
        _editCt = false;
        watchBattery();
        render();
        // Vždy odrolovat na začátek: nahoře je stav a hned pod ním tísňové tlačítko.
        // Kdyby okno zůstalo tam, kde ho člověk minule opustil (třeba u kontaktů),
        // otevřel by v maléru panel a tísňovou linku by musel teprve hledat.
        var sc = document.getElementById('ag-bz-scroll');
        if (sc) sc.scrollTop = 0;
        // Panel se sám obnovuje, dokud je vidět: stárne poloha, mění se přesnost
        // i signál. Mimo otevřené okno by to jen ujídalo baterii.
        if (!_refresh) _refresh = setInterval(function () {
            var el = document.getElementById('ag-bz-modal');
            if (!el || el.style.display === 'none') { clearInterval(_refresh); _refresh = null; return; }
            if (_hold) return;                 // překreslení uprostřed držení by tlačítko vyměnilo pod prstem
            renderStat();
            if (_firedTs) renderSos();
        }, 5000);
    }
    function close() {
        if (_hold) stopHold();
        disarm();
        if (_refresh) { clearInterval(_refresh); _refresh = null; }
        _firedTs = 0;
        var m = document.getElementById('ag-bz-modal');
        if (m) m.style.display = 'none';
    }

    // ---- start ------------------------------------------------------------------------------
    var _regTries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'bezpecnost', label: 'Bezpečnost', icon: ICON, cat: 'Pomůcky', onClick: open, order: 11 });
            return;
        }
        if (_regTries++ < 20) setTimeout(register, 500);
    }
    function init() {
        register();
        if (cfg().on) startTimer();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.agOpenBezpecnost = open;
})();
