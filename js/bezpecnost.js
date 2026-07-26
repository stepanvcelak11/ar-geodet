// ===== AR Geodet — BEZPEČNOST V TERÉNU (ODPOJITELNÁ vrstva) =====================
// Denní rizika práce venku, spojená s daty, která appka už má:
//   • VEDRO / pitný režim — z posledního počasí (agWeatherCache_v1); při zapnutých
//     připomínkách připomene pití a přestávku ve stínu v rozumném intervalu.
//   • BOUŘKA — hlídá hodinovou předpověď; blíží-li se bouřka do 2 h, upozorní, že
//     výtyčka a stativ dělají z člověka nejvyšší bod v okolí.
//   • SOUMRAK — 30 min před koncem občanského soumraku (počítá js/slunce.js)
//     připomene reflexní vestu a ukončení AR měření (kamera potřebuje světlo).
//   • MRÁZ a VÍTR — náledí, foukání do stativu, padající větve.
//   • SOS karta — jedním tapem pošle (přes systémové Sdílet) svou polohu ve
//     WGS84 i S-JTSK, přesnost fixu a odkaz do mapy. Pro případ, kdy je potřeba
//     někoho k sobě navést — appka nikam nic sama neposílá.
//
// Připomínky jsou VÝCHOZÍ VYPNUTÉ a běží jen když je appka otevřená (webová appka
// na pozadí časovače nedostane). Naschvál se nepoužívají notifikace ani zvuk —
// jen tichý toast, aby to nerušilo měření. Text „na dnes ztišit" je jeden tap.
//
// PRÁVNÍ RÁMEC: čísla níž jsou ORIENTAČNÍ doporučení pro práci venku, NE citace
// vyhlášky. Povinnosti zaměstnavatele (poskytování ochranných nápojů, režim
// práce a bezpečnostních přestávek) řeší NV 361/2007 Sb. podle třídy práce a
// naměřených podmínek — to appka posoudit neumí a netvrdí, že umí.
//
// Neinvazivní: NEEDITUJE logika.js/grafika.js. Vstup: dlaždice „Bezpečnost"
// v Nástrojích (Pomůcky). API: window.agOpenBezpecnost().
// Odstranění: smaž js/bezpecnost.js + řádek <script> v index.html a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.__agBezpecnostInit) return;
    window.__agBezpecnostInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7.5 3v6c0 4.2-3 7.6-7.5 9-4.5-1.4-7.5-4.8-7.5-9V6z"/><path d="M12 8.5v4M12 15.5v.01"/></svg>';
    var STYLE_ID = 'ag-bz-style';
    var LS = 'agSafety_v1';           // {on, drinkMin, lastDrink, mutedDay, seen:{}}
    var DRINK_DEFAULT = 45;           // min

    var _timer = null;

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function toast(m) { try { if (typeof window.quickToast === 'function') return window.quickToast(m); } catch (e) {} }
    function pad2(n) { return ('0' + n).slice(-2); }
    function dayKey() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function cfg() {
        var o = null;
        try { o = JSON.parse(localStorage.getItem(LS)); } catch (e) {}
        if (!o || typeof o !== 'object') o = {};
        if (o.drinkMin == null) o.drinkMin = DRINK_DEFAULT;
        if (!o.seen || typeof o.seen !== 'object') o.seen = {};
        return o;
    }
    function saveCfg(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {} }

    function pos() {
        try { if (typeof userLat === 'number' && userLat != null && typeof userLng === 'number') return { lat: userLat, lng: userLng }; } catch (e) {}
        try { var p = JSON.parse(localStorage.getItem('arLastPos')); if (p && p.lat) return { lat: +p.lat, lng: +(p.lng != null ? p.lng : p.lon) }; } catch (e) {}
        return null;
    }
    function acc() { try { if (typeof currentGpsAccuracy === 'number' && currentGpsAccuracy > 0) return currentGpsAccuracy; } catch (e) {} return null; }

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
            } catch (e) {}
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
            toast('⛈ Blíží se bouřka — s výtyčkou a stativem pryč z volné plochy.');
            return;
        }
        // soumrak — jednou denně, 30 min předem
        if (r.toTwilight != null && r.toTwilight > 0 && r.toTwilight < 30 * 60000 && c.seen['dusk'] !== dayKey()) {
            c.seen['dusk'] = dayKey(); saveCfg(c);
            toast('🌆 Za ' + Math.round(r.toTwilight / 60000) + ' min je tma — vesta a konči s AR.');
            return;
        }
        // pití ve vedru
        if (r.tmax != null && r.tmax >= 27) {
            var last = c.lastDrink || 0;
            if (Date.now() - last > (c.drinkMin || DRINK_DEFAULT) * 60000) {
                c.lastDrink = Date.now(); saveCfg(c);
                toast('💧 ' + Math.round(r.tmax) + ' °C — napij se a na chvíli do stínu.');
            }
        }
    }
    function startTimer() {
        if (_timer) return;
        _timer = setInterval(tick, 5 * 60000);
        // uspávání mimo appku řeší prohlížeč sám (timery na pozadí zpomalí/zastaví)
    }
    function stopTimer() { if (_timer) { clearInterval(_timer); _timer = null; } }

    // ---- SOS: poslat polohu -----------------------------------------------------------------
    function sosText() {
        var p = pos();
        if (!p) return null;
        var a = acc();
        var lines = ['Potřebuji pomoc / navedení na tuto polohu:'];
        lines.push('GPS: ' + p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + (a != null ? ' (přesnost ±' + Math.round(a) + ' m)' : ''));
        try {
            if (typeof proj4 === 'function') {
                var s = proj4('EPSG:4326', 'EPSG:5514', [p.lng, p.lat]);
                lines.push('S-JTSK Y, X: ' + Math.abs(s[0]).toFixed(2) + ', ' + Math.abs(s[1]).toFixed(2));
            }
        } catch (e) {}
        lines.push('Mapa: https://www.google.com/maps?q=' + p.lat.toFixed(6) + ',' + p.lng.toFixed(6));
        lines.push('Čas: ' + new Date().toLocaleString('cs-CZ'));
        return lines.join('\n');
    }
    function sendSos() {
        var txt = sosText();
        if (!txt) { toast('Nemám polohu — počkej na GPS fix.'); return; }
        if (navigator.share) {
            navigator.share({ title: 'Moje poloha', text: txt }).then(function () {}, function () { copy(txt); });
        } else copy(txt);
    }
    function copy(txt) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(txt).then(function () { toast('Poloha zkopírována — vlož ji do zprávy.'); }, function () { legacy(txt); });
                return;
            }
        } catch (e) {}
        legacy(txt);
    }
    function legacy(txt) {
        try {
            var ta = document.createElement('textarea');
            ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            var ok = document.execCommand('copy'); ta.remove();
            toast(ok ? 'Poloha zkopírována — vlož ji do zprávy.' : 'Kopírování se nepovedlo.');
        } catch (e) { toast('Kopírování se nepovedlo.'); }
    }

    // ---- UI ---------------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent =
            '#ag-bz-modal .ag-bz-r{border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:.92em;line-height:1.5;border:1px solid transparent;}' +
            '#ag-bz-modal .ag-bz-r b{display:block;margin-bottom:2px;}' +
            '#ag-bz-modal .ag-bz-r.high{background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.45);}' +
            '#ag-bz-modal .ag-bz-r.mid{background:rgba(251,191,36,.1);border-color:rgba(251,191,36,.4);}' +
            '#ag-bz-modal .ag-bz-r.ok{background:rgba(52,211,153,.1);border-color:rgba(52,211,153,.35);}' +
            '#ag-bz-modal .ag-bz-sw{display:flex;align-items:center;gap:10px;background:var(--bg-input,rgba(255,255,255,.06));border-radius:10px;padding:10px 12px;margin:12px 0 8px;font-size:.92em;}' +
            '#ag-bz-modal .ag-bz-sw input{width:20px;height:20px;}' +
            '#ag-bz-modal .ag-bz-sos{background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.45);border-radius:10px;padding:10px 12px;margin:10px 0 0;font-size:.9em;line-height:1.5;}' +
            '#ag-bz-modal .ag-bz-note{color:var(--text-muted,#9aa1ac);font-size:.8em;line-height:1.45;margin-top:10px;}';
        document.head.appendChild(s);
    }
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
            '  <div id="ag-bz-body"></div>' +
            '  <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
            '    <button type="button" class="btn btn-primary" id="ag-bz-sos">Poslat mou polohu</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-bz-mute">Ztišit na dnes</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-bz-close" style="margin-left:auto;">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-bz-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-bz-sos').addEventListener('click', sendSos);
        m.querySelector('#ag-bz-mute').addEventListener('click', function () {
            var c = cfg(); c.mutedDay = dayKey(); saveCfg(c); toast('Připomínky na dnes ztišené.'); render();
        });
        m.querySelector('#ag-bz-body').addEventListener('change', function (e) {
            if (e.target && e.target.id === 'ag-bz-on') {
                var c = cfg();
                c.on = !!e.target.checked;
                if (c.on) { c.mutedDay = null; c.lastDrink = Date.now(); }
                saveCfg(c);
                if (c.on) startTimer(); else stopTimer();
                render();
            } else if (e.target && e.target.id === 'ag-bz-int') {
                var c2 = cfg();
                var n = parseInt(e.target.value, 10);
                c2.drinkMin = (isFinite(n) && n >= 15 && n <= 180) ? n : DRINK_DEFAULT;
                saveCfg(c2);
            }
        });
        return m;
    }
    function render() {
        var body = document.getElementById('ag-bz-body');
        if (!body) return;
        var r = risks(), c = cfg();
        var h = '';
        r.list.forEach(function (x) {
            h += '<div class="ag-bz-r ' + x.lvl + '"><b>' + esc(x.t) + '</b>' + esc(x.d) + '</div>';
        });
        if (r.sunset || r.twilight) {
            h += '<div style="color:var(--text-muted,#9aa1ac);font-size:.86em;margin:2px 0 0;">Západ ' +
                (r.sunset ? pad2(r.sunset.getHours()) + ':' + pad2(r.sunset.getMinutes()) : '–') +
                ', tma (konec soumraku) ' + (r.twilight ? pad2(r.twilight.getHours()) + ':' + pad2(r.twilight.getMinutes()) : '–') + '.</div>';
        }
        h += '<div class="ag-bz-sw"><input type="checkbox" id="ag-bz-on"' + (c.on ? ' checked' : '') + '>' +
            '<label for="ag-bz-on" style="flex:1;">Tiché připomínky (pití, bouřka, soumrak)' +
            (c.mutedDay === dayKey() ? '<br><small style="color:#fbbf24;">Dnes ztišeno.</small>' : '') + '</label></div>';
        if (c.on) {
            h += '<div style="font-size:.88em;margin-bottom:6px;">Připomínka pití každých ' +
                '<input type="number" id="ag-bz-int" min="15" max="180" step="5" value="' + (c.drinkMin || DRINK_DEFAULT) + '" style="width:70px;background:var(--bg-input,rgba(255,255,255,.08));color:inherit;border:1px solid var(--border,rgba(255,255,255,.15));border-radius:8px;padding:5px 7px;"> min ' +
                '<span style="color:var(--text-muted,#9aa1ac);">(jen když je nad 27 °C)</span></div>';
        }
        h += '<div class="ag-bz-sos">🆘 <b>Poslat mou polohu</b> — tlačítko dole otevře systémové sdílení s tvou polohou ve WGS84 i S-JTSK a odkazem do mapy. ' +
            'Appka sama nikam nic neposílá a nikoho nevolá; vybereš si, komu to pošleš. Tíseň volej 112.</div>';
        h += '<div class="ag-bz-note">' + (r.wxAge != null ? 'Počasí je z posledního stažení před ' + r.wxAge + ' min' + (r.wxStale ? ' (starší data — otevři Počasí)' : '') + '. ' : '') +
            'Uvedené hodnoty jsou orientační doporučení pro práci venku, ne citace předpisů — povinnosti zaměstnavatele (ochranné nápoje, bezpečnostní přestávky) řeší NV 361/2007 Sb. podle třídy práce a skutečně naměřených podmínek. ' +
            'Připomínky běží jen když je appka otevřená (webová appka časovače na pozadí nedostane).</div>';
        body.innerHTML = h;
    }

    function open() {
        var m = ensureModal();
        m.style.display = 'flex';
        render();
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
