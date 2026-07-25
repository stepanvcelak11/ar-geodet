// ===== AR Geodet — POČASÍ (odpojitelná vrstva) =================================
// Celoobrazovkový nástroj „Počasí" ve stylu Apple Weather pro geodety v terénu.
//
// Co dělá:
//   • Stáhne předpověď z VÍCE nezávislých zdrojů najednou a zkombinuje je
//     VÁŽENÝM PRŮMĚREM (váhy pro střední Evropu):
//       – Open-Meteo multi-model: ECMWF IFS (1.3), DWD ICON (1.25), NOAA GFS (0.9)
//       – MET Norway locationforecast (1.1) — když selže, prostě se vynechá
//   • U každé veličiny drží i min–max rozptyl mezi zdroji → dlaždice „Shoda zdrojů".
//   • Pouze online zdroj dat, ale POSLEDNÍ stažená data si pamatuje v localStorage;
//     offline ukáže poslední data se štítkem „Naposledy aktualizováno HH:MM (offline)".
//   • Poloha: výchozí GPS appky (userLat/userLng, fallback arLastPos); nahoře
//     searchbar s geokodérem Open-Meteo (našeptávač, poslední hledaná místa).
//   • Geodetická přidaná hodnota: karta upozornění pro měření v terénu
//     (silný vítr → stativ/výtyčka, bouřka do 3 h → blesk + výtyčka, mráz, vedro).
//   • Hodinová předpověď 24 h (s východem/západem slunce), 7denní s teplotními
//     proužky, mřížka detailů (vítr, tlak vč. trendu, vlhkost, srážky, slunce).
//   • Tlak se přepočítává na hladinu moře (Open-Meteo vrací přízemní), aby šel
//     korektně kombinovat s MET Norway a dával známé hodnoty ~1013 hPa.
//   • Vše 100% bez API klíče, bez externích knihoven; ikony jsou inline SVG.
//
// Technika: NEEDITUJE logika.js/grafika.js — jen čte globály. Časy z API se
// berou jako unix epoch (&timeformat=unixtime) kvůli spolehlivému slícování
// zdrojů napříč časovými pásmy; zobrazení přes utc_offset_seconds místa.
//
// Vstup: dlaždice „Počasí" v Nástrojích (window.agRegisterFieldTool).
// Veřejné API: window.agOpenPocasi().
// Odstranění: smaž js/pocasi.js + css/pocasi.css a jejich řádky v index.html a sw.js.
// ================================================================================
(function () {
    'use strict';

    // ---- konstanty ------------------------------------------------------------
    var LS_CACHE   = 'agWeatherCache_v1';    // {t, lat, lon, placeName, data, sources}
    var LS_PLACES  = 'agWeatherPlaces_v1';   // poslední hledaná místa (max 5)
    var REFRESH_MS = 15 * 60 * 1000;         // auto-refresh při otevřeném overlayi
    var FETCH_MS   = 9000;                   // timeout jednoho požadavku
    var SAME_KM    = 2.0;                    // cache platí pro stejné místo ±2 km

    // Deset předpovědních modelů + MET Norway = 11 nezávislých zdrojů, ze kterých se
    // dělá vážený průměr. Vybrané jsou JEN modely provozované národními
    // meteorologickými službami, které skutečně pokrývají Česko (ověřeno dotazem na
    // Prahu — u modelů mimo doménu, např. AROME France, vrací API prázdno, proto tu
    // nejsou). Váha odpovídá tomu, jak jemné je rozlišení a jak si model pro střední
    // Evropu stojí: nejvyšší mají ECMWF (referenční globál) a ICON-D2 (2,2 km, DWD).
    // Modely s krátkým dosahem (D2, HARMONIE) dávají data jen na první dny — dál
    // vrací null a průměr je prostě vynechá.
    var OM_MODELS = [
        { id: 'ecmwf_ifs025',                  label: 'ECMWF IFS 0,25°',    w: 1.35 },
        { id: 'icon_d2',                       label: 'DWD ICON-D2 2 km',   w: 1.35 },
        { id: 'icon_eu',                       label: 'DWD ICON-EU 7 km',   w: 1.25 },
        { id: 'icon_global',                   label: 'DWD ICON 11 km',     w: 1.00 },
        { id: 'knmi_harmonie_arome_europe',    label: 'KNMI HARMONIE',      w: 1.15 },
        { id: 'dmi_harmonie_arome_europe',     label: 'DMI HARMONIE',       w: 1.15 },
        { id: 'arpege_europe',                 label: 'Météo-France ARPEGE', w: 1.05 },
        { id: 'ukmo_global_deterministic_10km', label: 'UK Met Office',     w: 1.05 },
        { id: 'gfs_seamless',                  label: 'NOAA GFS',           w: 0.90 },
        { id: 'gem_seamless',                  label: 'CMC GEM',            w: 0.85 }
    ];
    var METNO_W = 1.10;

    var DAYS_CS = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
    var DIRS_CS = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];

    // Ikona dlaždice (slunce za mrakem, styl appky — stroke currentColor)
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2M4.9 4.9l1.4 1.4M2 12h2M19.1 4.9l-1.4 1.4M17.7 9.2A5 5 0 1 0 9 12.5"/><path d="M13 22H7a4 4 0 1 1 .6-7.96A5.5 5.5 0 0 1 18.4 16 3 3 0 0 1 18 22h-5z"/></svg>';
    var ICON_LOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.6"/><path d="M12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5"/></svg>';
    var ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
    var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V5M6.5 10.5L12 5l5.5 5.5"/></svg>';

    // ---- stav -----------------------------------------------------------------
    var _ui = null, _open = false;
    var _place = null;          // {name, lat, lon} nebo null = GPS appky
    var _cur = null;            // poslední zobrazený balík {t, lat, lon, placeName, data, sources}
    var _offline = false;
    var _reqSeq = 0;            // ochrana proti závodům fetchů
    var _timer = null;          // auto-refresh
    var _searchTimer = null;

    // ---- drobné utility ---------------------------------------------------------
    function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
    function at(arr, i) { if (!arr || !arr.length || i == null || i < 0 || i >= arr.length) return null; return num(arr[i]); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function nf(v, dec) {
        if (v == null || !isFinite(v)) return '–';
        return Number(v).toFixed(dec == null ? 0 : dec).replace('.', ',');
    }
    function fmtHM(epoch, off) {
        if (epoch == null) return '–';
        var d = new Date((epoch + (off || 0)) * 1000);
        return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
    }
    function hourOf(epoch, off) { return new Date((epoch + (off || 0)) * 1000).getUTCHours(); }
    function dayShort(epoch, off) { return DAYS_CS[new Date((epoch + (off || 0)) * 1000).getUTCDay()]; }
    function dirName(deg) { if (deg == null) return ''; return DIRS_CS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]; }
    function distKm(aLat, aLon, bLat, bLon) {
        var R = 6371, dLa = (bLat - aLat) * Math.PI / 180, dLo = (bLon - aLon) * Math.PI / 180;
        var s = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
                Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
        return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    }
    function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt != null) e.textContent = txt;
        return e;
    }

    // ---- fetch s timeoutem ------------------------------------------------------
    function fetchJson(url, ms) {
        var p;
        if (typeof window.fetchWithTimeout === 'function') {
            p = window.fetchWithTimeout(url, ms);
        } else {
            var ctl = null, to = null;
            try { ctl = new AbortController(); } catch (e) { ctl = null; }
            if (ctl) to = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, ms);
            p = fetch(url, ctl ? { signal: ctl.signal } : {}).then(
                function (r) { if (to) clearTimeout(to); return r; },
                function (e) { if (to) clearTimeout(to); throw e; }
            );
        }
        return p.then(function (r) {
            if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
            return r.json();
        });
    }

    // ---- URL zdrojů ---------------------------------------------------------------
    function omUrl(lat, lon) {
        // hodinová řada jen na 48 h (UI ukazuje 24 h) — s deseti modely by sedmidenní
        // hodinovka byla zbytečně velká stahovka do mobilních dat
        return 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(5) + '&longitude=' + lon.toFixed(5) +
            '&models=' + OM_MODELS.map(function (m) { return m.id; }).join(',') +
            '&forecast_hours=48' +
            '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
            '&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
            '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset' +
            '&timezone=auto&forecast_days=7&wind_speed_unit=ms&timeformat=unixtime';
    }
    function metnoUrl(lat, lon) {
        return 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4);
    }
    function geoUrl(q) {
        return 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=6&language=cs&format=json';
    }

    // ---- WMO weather_code → čeština + klíč ikony ---------------------------------
    var WMO = {
        0: ['jasno', 'sun'], 1: ['skoro jasno', 'sun'], 2: ['polojasno', 'partly'], 3: ['zataženo', 'cloud'],
        45: ['mlha', 'fog'], 48: ['mlha s jinovatkou', 'fog'],
        51: ['slabé mrholení', 'drizzle'], 53: ['mrholení', 'drizzle'], 55: ['silné mrholení', 'drizzle'],
        56: ['mrznoucí mrholení', 'drizzle'], 57: ['silné mrznoucí mrholení', 'drizzle'],
        61: ['slabý déšť', 'rain'], 63: ['déšť', 'rain'], 65: ['silný déšť', 'rain'],
        66: ['mrznoucí déšť', 'rain'], 67: ['silný mrznoucí déšť', 'rain'],
        68: ['déšť se sněhem', 'sleet'], 69: ['silný déšť se sněhem', 'sleet'],
        71: ['slabé sněžení', 'snow'], 73: ['sněžení', 'snow'], 75: ['husté sněžení', 'snow'], 77: ['sněhová zrna', 'snow'],
        80: ['slabé přeháňky', 'rain'], 81: ['přeháňky', 'rain'], 82: ['silné přeháňky', 'rain'],
        85: ['sněhové přeháňky', 'snow'], 86: ['silné sněhové přeháňky', 'snow'],
        95: ['bouřka', 'thunder'], 96: ['bouřka s kroupami', 'thunder'], 99: ['silná bouřka s kroupami', 'thunder']
    };
    function wmoText(c) { var e = (c != null) ? WMO[c] : null; return e ? e[0] : 'oblačno'; }
    function wmoKind(c) { var e = (c != null) ? WMO[c] : null; return e ? e[1] : 'cloud'; }
    function isPrecipCode(c) { return c != null && c >= 51; }

    // ---- MET Norway symbol_code → WMO kód ----------------------------------------
    var METNO_WMO = {
        clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45,
        lightrain: 61, rain: 63, heavyrain: 65,
        lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82,
        lightsleet: 68, sleet: 68, heavysleet: 69,
        lightsleetshowers: 68, sleetshowers: 68, heavysleetshowers: 69,
        lightsnow: 71, snow: 73, heavysnow: 75,
        lightsnowshowers: 85, snowshowers: 85, heavysnowshowers: 86,
        lightrainandthunder: 95, rainandthunder: 95, heavyrainandthunder: 95,
        lightrainshowersandthunder: 95, rainshowersandthunder: 95, heavyrainshowersandthunder: 95,
        lightsleetandthunder: 95, sleetandthunder: 95, heavysleetandthunder: 95,
        lightssleetshowersandthunder: 95, sleetshowersandthunder: 95, heavysleetshowersandthunder: 95,
        lightsnowandthunder: 95, snowandthunder: 95, heavysnowandthunder: 95,
        lightsnowshowersandthunder: 95, snowshowersandthunder: 95, heavysnowshowersandthunder: 95
    };
    function symToWmo(sym) {
        if (!sym || typeof sym !== 'string') return null;
        var base = sym.replace(/_(day|night|polartwilight)$/, '');
        var c = METNO_WMO[base];
        return (typeof c === 'number') ? c : null;
    }

    // ---- inline SVG ikony počasí ---------------------------------------------------
    function cloudPath(fill, dy) {
        return '<path d="M24 13.3h-1.7A10.6 10.6 0 1 0 12 26.6h12a6.6 6.6 0 0 0 0-13.3z" fill="' + fill + '"' +
            (dy ? ' transform="translate(0,' + dy + ')"' : '') + '/>';
    }
    var SUN_FULL = '<circle cx="16" cy="16" r="6" fill="#ffd166"/>' +
        '<g stroke="#ffd166" stroke-width="2.2" stroke-linecap="round">' +
        '<path d="M16 3.5v4"/><path d="M16 24.5v4"/><path d="M3.5 16h4"/><path d="M24.5 16h4"/>' +
        '<path d="M7.2 7.2l2.8 2.8"/><path d="M22 22l2.8 2.8"/><path d="M24.8 7.2L22 10"/><path d="M10 22l-2.8 2.8"/></g>';
    var MOON_FULL = '<path d="M22.8 19.2A8.2 8.2 0 0 1 12.6 7.4a9 9 0 1 0 10.2 11.8z" fill="#cfd6e4"/>';
    var SUN_SMALL = '<circle cx="11" cy="9.5" r="4" fill="#ffd166"/>' +
        '<g stroke="#ffd166" stroke-width="1.8" stroke-linecap="round">' +
        '<path d="M11 1.8v2.4"/><path d="M3.3 9.5h2.4"/><path d="M16.3 9.5h2.4"/>' +
        '<path d="M5.5 4l1.7 1.7"/><path d="M14.8 4l-1.7 1.7"/></g>';
    var MOON_SMALL = '<path d="M15.2 11.2a5.6 5.6 0 0 1-7-8.1 6.2 6.2 0 1 0 7 8.1z" fill="#cfd6e4"/>';
    var DROPS_RAIN = '<g stroke="#6db3f2" stroke-width="2" stroke-linecap="round">' +
        '<path d="M11 26l-1.4 3.4"/><path d="M16.5 26l-1.4 3.4"/><path d="M22 26l-1.4 3.4"/></g>';
    var DROPS_DRIZZLE = '<g fill="#6db3f2"><circle cx="11" cy="27.4" r="1.3"/><circle cx="16.5" cy="27.4" r="1.3"/><circle cx="22" cy="27.4" r="1.3"/></g>';
    var DROPS_SNOW = '<g fill="#eef4fb"><circle cx="11" cy="27.4" r="1.5"/><circle cx="16.5" cy="27.4" r="1.5"/><circle cx="22" cy="27.4" r="1.5"/></g>';
    var DROPS_SLEET = '<path d="M11.5 26l-1.4 3.4" stroke="#6db3f2" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="17" cy="27.4" r="1.5" fill="#eef4fb"/>' +
        '<path d="M22.5 26l-1.4 3.4" stroke="#6db3f2" stroke-width="2" stroke-linecap="round"/>';
    var BOLT = '<path d="M17.5 21l-4.5 6.5h3l-1.8 4.3 6-7.3h-3l2.3-3.5z" fill="#ffd166"/>';
    var FOG_LINES = '<g stroke="#c9d3e0" stroke-width="2" stroke-linecap="round"><path d="M8 27h16"/><path d="M10 30.4h12"/></g>';

    var ICONS = {
        sun:     SUN_FULL,
        moon:    MOON_FULL,
        partly:  SUN_SMALL + '<g transform="translate(3.5,2.5) scale(0.88)">' + cloudPath('#c9d3e0', 0) + '</g>',
        partlyn: MOON_SMALL + '<g transform="translate(3.5,2.5) scale(0.88)">' + cloudPath('#aeb9c8', 0) + '</g>',
        cloud:   cloudPath('#c9d3e0', 0),
        fog:     cloudPath('#b8c2d0', -4) + FOG_LINES,
        drizzle: cloudPath('#b8c2d0', -3) + DROPS_DRIZZLE,
        rain:    cloudPath('#aab6c6', -3) + DROPS_RAIN,
        sleet:   cloudPath('#aab6c6', -3) + DROPS_SLEET,
        snow:    cloudPath('#c9d3e0', -3) + DROPS_SNOW,
        thunder: cloudPath('#9aa8ba', -3) + BOLT,
        sunrise: '<path d="M16 14V6.5M12.8 9.7L16 6.5l3.2 3.2" stroke="#ffd166" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
                 '<path d="M9 24a7 7 0 0 1 14 0" fill="none" stroke="#ffd166" stroke-width="2.2"/>' +
                 '<path d="M4 24h24" stroke="#c9d3e0" stroke-width="2" stroke-linecap="round"/>',
        sunset:  '<path d="M16 6.5V14M12.8 10.8L16 14l3.2-3.2" stroke="#ffb56b" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
                 '<path d="M9 24a7 7 0 0 1 14 0" fill="none" stroke="#ffb56b" stroke-width="2.2"/>' +
                 '<path d="M4 24h24" stroke="#c9d3e0" stroke-width="2" stroke-linecap="round"/>'
    };
    function iconSvg(key) {
        var body = ICONS[key] || ICONS.cloud;
        return '<svg viewBox="0 0 32 32" aria-hidden="true">' + body + '</svg>';
    }
    function iconForCode(code, day) {
        var k = wmoKind(code);
        if (k === 'sun' && !day) k = 'moon';
        else if (k === 'partly' && !day) k = 'partlyn';
        return iconSvg(k);
    }

    // ---- poloha appky ---------------------------------------------------------------
    function appPos() {
        try {
            if (typeof userLat === 'number' && userLat && typeof userLng === 'number') {
                return { lat: userLat, lon: userLng };
            }
        } catch (e) {}
        try {
            var p = JSON.parse(localStorage.getItem('arLastPos'));
            if (p && typeof p.lat === 'number' && typeof p.lng === 'number') return { lat: p.lat, lon: p.lng };
        } catch (e) {}
        return null;
    }

    // ---- přepočet přízemního tlaku na hladinu moře -----------------------------------
    function toMsl(p, elevM, tempC) {
        if (p == null) return null;
        if (elevM == null || !isFinite(elevM) || elevM < 1) return p;
        var T = (tempC == null) ? 15 : tempC;
        try {
            return p * Math.pow(1 - (0.0065 * elevM) / (T + 0.0065 * elevM + 273.15), -5.257);
        } catch (e) { return p; }
    }

    // ---- parsování Open-Meteo (multi-model, suffixované klíče) -----------------------
    // Při více modelech jsou pole suffixovaná názvem modelu (temperature_2m_ecmwf_ifs025);
    // když suffix chybí (jediný model), platí holý klíč. Defenzivně obojí.
    function pick(block, name, model) {
        if (!block) return undefined;
        var k = name + '_' + model;
        if (Object.prototype.hasOwnProperty.call(block, k) && block[k] != null) return block[k];
        if (Object.prototype.hasOwnProperty.call(block, name) && block[name] != null) return block[name];
        return undefined;
    }
    // Blok `current` posílá Open-Meteo při dotazu na víc modelů JEN JEDNOU a BEZ
    // přípony modelu — všechny modely by tedy hlásily tutéž hodnotu a „Shoda zdrojů"
    // by byla vždycky nulová. Aktuální stav proto bereme z hodinové řady KAŽDÉHO
    // modelu (ta příponu má) v nejbližší hodině; `current` slouží jen jako záloha.
    function nearestHourIdx(times) {
        var now = Date.now() / 1000, best = -1, bd = Infinity;
        for (var i = 0; i < times.length; i++) {
            var t = num(times[i]); if (t == null) continue;
            var d = Math.abs(t - now);
            if (d < bd) { bd = d; best = i; }
        }
        return bd <= 5400 ? best : -1;      // víc než 1,5 h od teď už není „aktuální"
    }
    function parseOm(j) {
        var out = [];
        if (!j || typeof j !== 'object') return out;
        var off = num(j.utc_offset_seconds); if (off == null) off = 0;
        var elev = num(j.elevation);
        for (var i = 0; i < OM_MODELS.length; i++) {
            var m = OM_MODELS[i];
            var src = { id: m.id, label: m.label, w: m.w, off: off, cur: null, hourly: null, daily: null };
            var h = j.hourly;
            var suffixed = !!(j.current && Object.prototype.hasOwnProperty.call(j.current, 'temperature_2m_' + m.id));
            try {
                var hTime = h ? pick(h, 'time', m.id) : null;
                var hi = (hTime && hTime.length) ? nearestHourIdx(hTime) : -1;
                if (hi >= 0 && !suffixed) {
                    var g = function (nm) { var a = pick(h, nm, m.id); return (a && a.length > hi) ? num(a[hi]) : null; };
                    var th = g('temperature_2m');
                    var curH = {
                        t: th, feels: g('apparent_temperature'), hum: g('relative_humidity_2m'),
                        precip: g('precipitation'), code: g('weather_code'), cloud: g('cloud_cover'),
                        wind: g('wind_speed_10m'), dir: g('wind_direction_10m'), gusts: g('wind_gusts_10m'),
                        pmsl: toMsl(g('surface_pressure'), elev, th)
                    };
                    if (curH.t != null || curH.wind != null || curH.code != null) src.cur = curH;
                }
            } catch (e) {}
            try {
                var c = j.current;
                // nesufixovaný `current` patří jen prvnímu modelu — ostatním by podstrčil
                // cizí hodnotu a shoda zdrojů by vypadala lépe, než jaká ve skutečnosti je
                if (c && !src.cur && (suffixed || i === 0)) {
                    var t = num(pick(c, 'temperature_2m', m.id));
                    var cur = {
                        t: t,
                        feels: num(pick(c, 'apparent_temperature', m.id)),
                        hum: num(pick(c, 'relative_humidity_2m', m.id)),
                        precip: num(pick(c, 'precipitation', m.id)),
                        code: num(pick(c, 'weather_code', m.id)),
                        cloud: num(pick(c, 'cloud_cover', m.id)),
                        wind: num(pick(c, 'wind_speed_10m', m.id)),
                        dir: num(pick(c, 'wind_direction_10m', m.id)),
                        gusts: num(pick(c, 'wind_gusts_10m', m.id)),
                        pmsl: toMsl(num(pick(c, 'surface_pressure', m.id)), elev, t)
                    };
                    if (cur.t != null || cur.wind != null || cur.code != null) src.cur = cur;
                }
            } catch (e) {}
            try {
                var time = h ? pick(h, 'time', m.id) : null;
                if (time && time.length) {
                    src.hourly = {
                        time: time,
                        temp: pick(h, 'temperature_2m', m.id) || null,
                        prob: pick(h, 'precipitation_probability', m.id) || null,
                        precip: pick(h, 'precipitation', m.id) || null,
                        code: pick(h, 'weather_code', m.id) || null,
                        wind: pick(h, 'wind_speed_10m', m.id) || null,
                        gusts: pick(h, 'wind_gusts_10m', m.id) || null
                    };
                    if (!src.hourly.temp && !src.hourly.code) src.hourly = null;
                }
            } catch (e) {}
            try {
                var d = j.daily;
                var dt = d ? pick(d, 'time', m.id) : null;
                if (dt && dt.length) {
                    src.daily = {
                        time: dt,
                        code: pick(d, 'weather_code', m.id) || null,
                        tmax: pick(d, 'temperature_2m_max', m.id) || null,
                        tmin: pick(d, 'temperature_2m_min', m.id) || null,
                        psum: pick(d, 'precipitation_sum', m.id) || null,
                        pprob: pick(d, 'precipitation_probability_max', m.id) || null,
                        wmax: pick(d, 'wind_speed_10m_max', m.id) || null,
                        sunrise: pick(d, 'sunrise', m.id) || null,
                        sunset: pick(d, 'sunset', m.id) || null
                    };
                    if (!src.daily.tmax && !src.daily.code) src.daily = null;
                }
            } catch (e) {}
            if (src.cur || src.hourly || src.daily) out.push(src);
        }
        return out;
    }

    // ---- parsování MET Norway ----------------------------------------------------------
    function parseMetno(j) {
        try {
            var ts = j && j.properties && j.properties.timeseries;
            if (!ts || !ts.length) return null;
            var src = {
                id: 'metno', label: 'MET Norway', w: METNO_W, off: null, cur: null,
                hourly: { time: [], temp: [], prob: [], precip: [], code: [], wind: [], gusts: [] },
                daily: null
            };
            for (var i = 0; i < ts.length; i++) {
                var e = ts[i];
                var det = e && e.data && e.data.instant && e.data.instant.details;
                if (!det) continue;
                var t = Math.round(Date.parse(e.time) / 1000);
                if (!isFinite(t)) continue;
                var code = null, pr = null;
                var n1 = e.data.next_1_hours;
                if (n1) {
                    code = symToWmo(n1.summary && n1.summary.symbol_code);
                    pr = num(n1.details && n1.details.precipitation_amount);
                }
                src.hourly.time.push(t);
                src.hourly.temp.push(num(det.air_temperature));
                src.hourly.prob.push(null);
                src.hourly.precip.push(pr);
                src.hourly.code.push(code);
                src.hourly.wind.push(num(det.wind_speed));
                src.hourly.gusts.push(null);
                if (!src.cur) {
                    src.cur = {
                        t: num(det.air_temperature), feels: null,
                        hum: num(det.relative_humidity), precip: pr, code: code,
                        cloud: num(det.cloud_area_fraction),
                        wind: num(det.wind_speed), dir: num(det.wind_from_direction),
                        gusts: null,
                        pmsl: num(det.air_pressure_at_sea_level)   // met.no už dává hladinu moře
                    };
                }
            }
            if (!src.hourly.time.length) src.hourly = null;
            return (src.cur || src.hourly) ? src : null;
        } catch (e) { return null; }
    }

    // ---- kombinování zdrojů (vážený průměr + rozptyl) -----------------------------------
    function wstat(items) {   // items: [{v, w}]
        var sw = 0, s = 0, mn = Infinity, mx = -Infinity, n = 0;
        for (var i = 0; i < items.length; i++) {
            var v = items[i].v;
            if (v == null || !isFinite(v)) continue;
            var w = items[i].w || 1;
            sw += w; s += v * w; n++;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        if (!n || !sw) return null;
        return { v: s / sw, min: mn, max: mx, n: n };
    }
    function wv(items) { var r = wstat(items); return r ? r.v : null; }
    function maxOf(items) {
        var mx = null;
        for (var i = 0; i < items.length; i++) {
            var v = items[i].v;
            if (v == null || !isFinite(v)) continue;
            if (mx == null || v > mx) mx = v;
        }
        return mx;
    }
    function circMean(items) {  // vážený průměr směrů ve stupních
        var sx = 0, sy = 0, n = 0;
        for (var i = 0; i < items.length; i++) {
            var v = items[i].v;
            if (v == null || !isFinite(v)) continue;
            var w = items[i].w || 1, r = v * Math.PI / 180;
            sx += w * Math.cos(r); sy += w * Math.sin(r); n++;
        }
        if (!n) return null;
        var a = Math.atan2(sy, sx) * 180 / Math.PI;
        return ((a % 360) + 360) % 360;
    }
    // Kód počasí: vezmi kód zdroje s nejvyšší vahou; ale pokud VĚTŠINA zdrojů
    // hlásí srážky a favorit ne, ukaž srážkový kód (od nejváženějšího srážkového).
    function combineCode(items) {  // items: [{code, w}]
        var have = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].code != null && isFinite(items[i].code)) have.push(items[i]);
        }
        if (!have.length) return null;
        have.sort(function (a, b) { return (b.w || 0) - (a.w || 0); });
        var top = have[0].code;
        var precip = have.filter(function (x) { return isPrecipCode(x.code); });
        if (!isPrecipCode(top) && precip.length * 2 > have.length) return precip[0].code;
        return top;
    }
    function srcIdx(s) {   // mapa epoch → index v hourly poli zdroje (lazy)
        if (!s.hourly || !s.hourly.time) return null;
        if (!s._hm) {
            s._hm = {};
            for (var i = 0; i < s.hourly.time.length; i++) s._hm[s.hourly.time[i]] = i;
        }
        return s._hm;
    }

    function combineAll(sources, prevHist) {
        var data = { off: 0, current: null, hourly: [], daily: [], perSource: [], pressHist: [], isDayNow: true };
        var i, s;

        // časový posun místa (z Open-Meteo; met.no ho nemá → fallback zařízení)
        var off = null;
        for (i = 0; i < sources.length; i++) { if (sources[i].off != null) { off = sources[i].off; break; } }
        if (off == null) off = -new Date().getTimezoneOffset() * 60;
        data.off = off;

        // --- aktuální stav ---
        var curS = sources.filter(function (x) { return x.cur; });
        if (curS.length) {
            var items = function (get) { return curS.map(function (x) { return { v: get(x.cur), w: x.w }; }); };
            var tSt = wstat(items(function (c) { return c.t; }));
            data.current = {
                temp: tSt ? tSt.v : null,
                feels: wv(items(function (c) { return c.feels; })),
                hum: wv(items(function (c) { return c.hum; })),
                precip: wv(items(function (c) { return c.precip; })),
                cloud: wv(items(function (c) { return c.cloud; })),
                pmsl: wv(items(function (c) { return c.pmsl; })),
                wind: wv(items(function (c) { return c.wind; })),
                gusts: wv(items(function (c) { return c.gusts; })),
                dir: circMean(items(function (c) { return c.dir; })),
                code: combineCode(curS.map(function (x) { return { code: x.cur.code, w: x.w }; }))
            };
            data.spreadTemp = tSt ? { min: tSt.min, max: tSt.max, n: tSt.n } : null;
            data.perSource = curS.map(function (x) { return { id: x.id, label: x.label, w: x.w, temp: x.cur.t }; });
        }

        // --- denní (jen zdroje, které daily mají — tj. Open-Meteo modely) ---
        var dayS = sources.filter(function (x) { return x.daily; });
        if (dayS.length) {
            // osa = model s nejdelší denní řadou (krátkodosahové modely mají kratší)
            var axisD = dayS[0].daily;
            for (i = 1; i < dayS.length; i++) { if (dayS[i].daily.time.length > axisD.time.length) axisD = dayS[i].daily; }
            for (i = 0; i < axisD.time.length && i < 7; i++) {
                var epoch = num(axisD.time[i]);
                var row = { t: epoch, code: null, tmax: null, tmin: null, psum: null, pprob: null, wmax: null, sunrise: null, sunset: null };
                var im = [], ix = [], ip = [], iw = [], ic = [];
                for (var k = 0; k < dayS.length; k++) {
                    s = dayS[k];
                    // najdi index dne se stejným epoch časem (osy se běžně shodují)
                    var di = i;
                    if (s.daily.time[i] !== epoch) {
                        di = -1;
                        for (var q = 0; q < s.daily.time.length; q++) { if (s.daily.time[q] === epoch) { di = q; break; } }
                        if (di < 0) continue;
                    }
                    ix.push({ v: at(s.daily.tmax, di), w: s.w });
                    im.push({ v: at(s.daily.tmin, di), w: s.w });
                    ip.push({ v: at(s.daily.psum, di), w: s.w });
                    iw.push({ v: at(s.daily.wmax, di), w: s.w });
                    ic.push({ code: at(s.daily.code, di), w: s.w });
                    if (row.pprob == null || (at(s.daily.pprob, di) != null && at(s.daily.pprob, di) > row.pprob)) {
                        var pp = at(s.daily.pprob, di);
                        if (pp != null) row.pprob = pp;
                    }
                    if (row.sunrise == null) row.sunrise = at(s.daily.sunrise, di);
                    if (row.sunset == null) row.sunset = at(s.daily.sunset, di);
                }
                row.tmax = wv(ix); row.tmin = wv(im); row.psum = wv(ip); row.wmax = maxOf(iw);
                row.code = combineCode(ic);
                data.daily.push(row);
            }
        }

        // pomocník: je v čase t den? (podle sunrise/sunset kombinovaných dní)
        function isDayAt(t) {
            for (var di = 0; di < data.daily.length; di++) {
                var d = data.daily[di];
                if (d.t != null && t >= d.t && t < d.t + 86400) {
                    if (d.sunrise != null && d.sunset != null) return t >= d.sunrise && t < d.sunset;
                    break;
                }
            }
            var h = hourOf(t, off);
            return h >= 6 && h < 20;
        }
        data.isDayAt = null;   // funkce se do cache neserializuje — den/noc uložíme do položek

        // --- hodinové (osa = zdroj s nejdelší řadou, prakticky Open-Meteo) ---
        var axisSrc = null;
        for (i = 0; i < sources.length; i++) {
            s = sources[i];
            if (s.hourly && s.hourly.time && s.hourly.time.length &&
                (!axisSrc || s.hourly.time.length > axisSrc.hourly.time.length)) axisSrc = s;
        }
        var nowSec = Math.floor(Date.now() / 1000);
        if (axisSrc) {
            var times = axisSrc.hourly.time;
            var hs = sources.filter(function (x) { return x.hourly; });
            var added = 0;
            for (i = 0; i < times.length && added < 24; i++) {
                var t = num(times[i]);
                if (t == null || t < nowSec - 3600) continue;
                var it = [], iwd = [], ig = [], ipr = [], icx = [], probMax = null;
                for (var k2 = 0; k2 < hs.length; k2++) {
                    s = hs[k2];
                    var hm = srcIdx(s);
                    var idx = hm ? hm[t] : null;
                    if (idx == null) continue;
                    it.push({ v: at(s.hourly.temp, idx), w: s.w });
                    iwd.push({ v: at(s.hourly.wind, idx), w: s.w });
                    ig.push({ v: at(s.hourly.gusts, idx), w: s.w });
                    ipr.push({ v: at(s.hourly.precip, idx), w: s.w });
                    icx.push({ code: at(s.hourly.code, idx), w: s.w });
                    var pb = at(s.hourly.prob, idx);
                    if (pb != null && (probMax == null || pb > probMax)) probMax = pb;
                }
                data.hourly.push({
                    t: t,
                    temp: wv(it), wind: wv(iwd), gusts: wv(ig),
                    precip: wv(ipr), prob: probMax,
                    code: combineCode(icx),
                    day: isDayAt(t)
                });
                added++;
            }
        }

        data.isDayNow = isDayAt(nowSec);

        // --- historie tlaku (trend) ---
        var hist = [];
        try {
            if (prevHist && prevHist.length) {
                hist = prevHist.filter(function (h) {
                    return h && num(h.t) != null && num(h.p) != null && h.t > Date.now() - 12 * 3600 * 1000;
                });
            }
        } catch (e) { hist = []; }
        if (data.current && data.current.pmsl != null) {
            var last = hist.length ? hist[hist.length - 1] : null;
            if (!last || Date.now() - last.t > 20 * 60 * 1000) hist.push({ t: Date.now(), p: data.current.pmsl });
        }
        data.pressHist = hist;

        return data;
    }

    function pressTrend(hist) {
        if (!hist || hist.length < 2) return null;
        var now = hist[hist.length - 1];
        var ref = null;
        for (var i = 0; i < hist.length; i++) {   // nejstarší vzorek v okně 2–9 h zpět
            var age = now.t - hist[i].t;
            if (age >= 2 * 3600 * 1000 && age <= 9 * 3600 * 1000) { ref = hist[i]; break; }
        }
        if (!ref) return null;
        var d = now.p - ref.p;
        if (d >= 1.2) return { txt: 'stoupá', arrow: '↗' };
        if (d <= -1.2) return { txt: 'klesá', arrow: '↘' };
        return { txt: 'setrvalý', arrow: '→' };
    }

    // ---- cache + poslední místa -----------------------------------------------------
    function loadCache() {
        try {
            var o = JSON.parse(localStorage.getItem(LS_CACHE));
            if (o && o.data && typeof o.lat === 'number' && typeof o.lon === 'number') return o;
        } catch (e) {}
        return null;
    }
    function saveCache(obj) { try { localStorage.setItem(LS_CACHE, JSON.stringify(obj)); } catch (e) {} }
    function loadPlaces() {
        try {
            var a = JSON.parse(localStorage.getItem(LS_PLACES));
            if (a && a.length) {
                return a.filter(function (p) {
                    return p && typeof p.name === 'string' && typeof p.lat === 'number' && typeof p.lon === 'number';
                }).slice(0, 5);
            }
        } catch (e) {}
        return [];
    }
    function pushPlace(p) {
        try {
            var a = loadPlaces().filter(function (x) {
                return !(x.name === p.name && Math.abs(x.lat - p.lat) < 0.01 && Math.abs(x.lon - p.lon) < 0.01);
            });
            a.unshift({ name: p.name, lat: p.lat, lon: p.lon });
            localStorage.setItem(LS_PLACES, JSON.stringify(a.slice(0, 5)));
        } catch (e) {}
    }

    // ---- hero gradient podle počasí a dne/noci ----------------------------------------
    var HERO_CLASSES = ['wx-bg-day', 'wx-bg-night', 'wx-bg-cloud', 'wx-bg-cloudn', 'wx-bg-rain', 'wx-bg-snow', 'wx-bg-thunder', 'wx-bg-fog'];
    function heroClass(code, day) {
        var k = wmoKind(code);
        if (k === 'thunder') return 'wx-bg-thunder';
        if (k === 'snow') return 'wx-bg-snow';
        if (k === 'rain' || k === 'drizzle' || k === 'sleet') return 'wx-bg-rain';
        if (k === 'fog') return 'wx-bg-fog';
        if (k === 'cloud') return day ? 'wx-bg-cloud' : 'wx-bg-cloudn';
        return day ? 'wx-bg-day' : 'wx-bg-night';
    }

    // ---- Počasí v místě klepnutí do mapy ---------------------------------------------
    // Vlastní překryv nad mapou (vzor js/cadastre-area.js): počasí se na dobu výběru
    // schová, klepnutí se převede přes window.agScreenToLatLng, které zpětně vyruší
    // otočení mapy podle azimutu — bez toho by místo padlo jinam, než se klepne.
    function pickOnMap() {
        var m = null; try { m = (typeof map !== 'undefined' && map) ? map : null; } catch (e) {}
        var vm = null; try { vm = viewMode; } catch (e) {}
        if (!m) { alert('Mapa zatím neběží — spusť nejdřív vyhledávání.'); return; }
        if (vm === 'ar') { alert('Přepni na mapu nebo dělené zobrazení, pak vyber místo klepnutím.'); return; }

        var ov = document.getElementById('ag-wx-pick');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'ag-wx-pick';
            ov.style.cssText = 'position:fixed;inset:0;z-index:100001;display:none;cursor:crosshair;';
            ov.innerHTML = '<div id="ag-wx-pick-hint" style="position:absolute;left:50%;transform:translateX(-50%);'
                + 'bottom:max(18px,env(safe-area-inset-bottom));display:flex;gap:10px;align-items:center;'
                + 'background:rgba(8,11,15,0.88);border:1px solid rgba(255,255,255,0.16);border-radius:999px;'
                + 'padding:10px 14px;color:#fff;font-size:13px;white-space:nowrap;">'
                + '<span>Klepni do mapy — ukážu počasí v tom místě</span>'
                + '<button type="button" id="ag-wx-pick-x" style="border:none;border-radius:999px;padding:6px 12px;'
                + 'background:rgba(255,255,255,0.14);color:#fff;font-size:13px;cursor:pointer;">Zrušit</button></div>';
            document.body.appendChild(ov);
            ov.addEventListener('click', function (e) {
                if (e.target.closest && e.target.closest('#ag-wx-pick-hint')) return;
                var ll = null;
                try { if (typeof window.agScreenToLatLng === 'function') ll = window.agScreenToLatLng(e.clientX, e.clientY); } catch (err) {}
                if (!ll) {
                    try {
                        var el = document.getElementById('map'), r = el.getBoundingClientRect();
                        ll = m.containerPointToLatLng([e.clientX - r.left, e.clientY - r.top]);
                    } catch (err2) {}
                }
                endPick();
                if (!ll || !isFinite(ll.lat) || !isFinite(ll.lng)) return;
                _place = { name: 'Místo na mapě · ' + ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4), lat: ll.lat, lon: ll.lng };
                var inp = byId('ag-wx-search'); if (inp) inp.value = '';
                hideResults();
                loadWeather(true);
            });
            document.getElementById('ag-wx-pick-x').addEventListener('click', function (e) { e.stopPropagation(); endPick(); });
        }
        function endPick() {
            ov.style.display = 'none';
            if (_ui) _ui.classList.add('on');
        }
        if (_ui) _ui.classList.remove('on');    // uhni, ať je vidět mapa
        ov.style.display = 'block';
    }

    // ---- UI kostra ------------------------------------------------------------------
    function ensureUI() {
        if (_ui) return;
        _ui = document.createElement('div');
        _ui.id = 'ag-wx-overlay';
        _ui.innerHTML =
            '<div class="wx-top">' +
                '<button type="button" class="wx-x" id="ag-wx-close" aria-label="Zavřít">×</button>' +
                '<div class="wx-search-wrap">' +
                    '<input type="text" id="ag-wx-search" placeholder="Hledat místo…" autocomplete="off" spellcheck="false">' +
                    '<div id="ag-wx-results" class="wx-results" style="display:none"></div>' +
                '</div>' +
                '<button type="button" class="wx-loc" id="ag-wx-mappick" title="Počasí v místě na mapě" aria-label="Počasí v místě na mapě">' + ICON_PIN + '</button>' +
                '<button type="button" class="wx-loc" id="ag-wx-myloc" title="Moje poloha" aria-label="Moje poloha">' + ICON_LOC + '</button>' +
            '</div>' +
            '<div id="ag-wx-offline" class="wx-offline" style="display:none"></div>' +
            '<div id="ag-wx-body" style="display:none">' +
                '<div id="ag-wx-alerts"></div>' +
                '<div id="ag-wx-hero" class="wx-hero">' +
                    '<div class="wx-place" id="ag-wx-place"></div>' +
                    '<div class="wx-bigtemp" id="ag-wx-temp"></div>' +
                    '<div class="wx-desc" id="ag-wx-desc"></div>' +
                    '<div class="wx-minmax" id="ag-wx-minmax"></div>' +
                '</div>' +
                '<div class="wx-card"><div class="wx-card-h">Hodinová předpověď</div><div class="wx-hours" id="ag-wx-hours"></div></div>' +
                '<div class="wx-card"><div class="wx-card-h">7denní předpověď</div><div id="ag-wx-days"></div></div>' +
                '<div class="wx-grid" id="ag-wx-grid"></div>' +
                '<div class="wx-foot" id="ag-wx-foot"></div>' +
            '</div>' +
            '<div id="ag-wx-empty" class="wx-empty" style="display:none"></div>' +
            '<div id="ag-wx-loading" class="wx-load" style="display:none">Načítám předpověď…</div>';
        document.body.appendChild(_ui);

        byId('ag-wx-close').addEventListener('click', close);
        byId('ag-wx-mappick').addEventListener('click', pickOnMap);
        byId('ag-wx-myloc').addEventListener('click', function () {
            _place = null;
            byId('ag-wx-search').value = '';
            hideResults();
            loadWeather(true);
        });

        var inp = byId('ag-wx-search');
        inp.addEventListener('input', function () {
            if (_searchTimer) clearTimeout(_searchTimer);
            var q = inp.value.replace(/^\s+|\s+$/g, '');
            if (q.length < 2) { showRecent(); return; }
            _searchTimer = setTimeout(function () { geoSearch(q); }, 400);
        });
        inp.addEventListener('focus', function () {
            var q = inp.value.replace(/^\s+|\s+$/g, '');
            if (q.length < 2) showRecent();
        });
        inp.addEventListener('blur', function () { setTimeout(hideResults, 250); });
        // mousedown na výsledcích nesmí sebrat fokus inputu dřív, než proběhne click
        byId('ag-wx-results').addEventListener('mousedown', function (e) { e.preventDefault(); });
    }
    function byId(id) { return document.getElementById(id); }

    // ---- vyhledávání místa (geokodér) --------------------------------------------------
    function geoSearch(q) {
        fetchJson(geoUrl(q), FETCH_MS).then(function (j) {
            var res = (j && j.results) ? j.results : [];
            renderResults(res, false);
        }, function () { /* ticho — našeptávač prostě nic nenabídne */ });
    }
    function renderResults(list, isRecent) {
        var box = byId('ag-wx-results');
        if (!box) return;
        box.innerHTML = '';
        var any = false;

        if (isRecent) {
            var my = el('button', 'wx-res wx-res-my');
            my.type = 'button';
            var mi = el('span', 'wx-res-ic'); mi.innerHTML = ICON_LOC;
            my.appendChild(mi);
            my.appendChild(el('span', 'wx-res-name', 'Moje poloha (GPS)'));
            my.addEventListener('click', function () {
                _place = null;
                byId('ag-wx-search').value = '';
                hideResults();
                loadWeather(true);
            });
            box.appendChild(my);
            any = true;
            if (list.length) box.appendChild(el('div', 'wx-res-h', 'Poslední hledaná'));
        }

        for (var i = 0; i < list.length; i++) {
            (function (r) {
                var name = String(r.name || '');
                var lat = num(r.latitude != null ? r.latitude : r.lat);
                var lon = num(r.longitude != null ? r.longitude : r.lon);
                if (!name || lat == null || lon == null) return;
                var sub = [];
                if (r.admin1) sub.push(String(r.admin1));
                if (r.country_code) sub.push(String(r.country_code));
                if (num(r.elevation) != null) sub.push(nf(r.elevation, 0) + ' m');
                var b = el('button', 'wx-res');
                b.type = 'button';
                b.appendChild(el('span', 'wx-res-name', name));          // textContent — XSS safe
                if (sub.length) b.appendChild(el('span', 'wx-res-sub', sub.join(' · ')));
                b.addEventListener('click', function () {
                    var p = { name: name, lat: lat, lon: lon };
                    pushPlace(p);
                    _place = p;
                    byId('ag-wx-search').value = name;
                    hideResults();
                    loadWeather(true);
                });
                box.appendChild(b);
                any = true;
            })(list[i]);
        }
        box.style.display = any ? 'block' : 'none';
    }
    function showRecent() { renderResults(loadPlaces(), true); }
    function hideResults() {
        var box = byId('ag-wx-results');
        if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    }

    // ---- upozornění pro měření v terénu -------------------------------------------------
    function buildAlerts(data) {
        var out = [];
        var c = data.current || {};
        var nowSec = Math.floor(Date.now() / 1000);
        var next3 = (data.hourly || []).filter(function (h) { return h.t >= nowSec - 1800 && h.t <= nowSec + 3 * 3600; });

        var thunder = next3.some(function (h) { return h.code != null && h.code >= 95; }) || (c.code != null && c.code >= 95);
        var rain = !thunder && (
            next3.some(function (h) { return (h.code != null && isPrecipCode(h.code)) || (h.prob != null && h.prob >= 55) || (h.precip != null && h.precip >= 0.3); })
        );
        if (thunder) {
            out.push({ cls: 'bad', title: 'Bouřka v okolí / do 3 hodin', txt: 'Sbal to — blesk + výtyčka/stativ = nebezpečí. Kovové vybavení polož a najdi úkryt.' });
        } else if (rain) {
            out.push({ cls: 'warn', title: 'Déšť v příštích 3 hodinách', txt: 'Počítej s mokrou optikou a horší viditelností terčů; chraň přístroj i tablet.' });
        }
        var windMax = Math.max(c.wind != null ? c.wind : 0, 0);
        if (c.wind != null && c.wind > 8) {
            out.push({ cls: 'warn', title: 'Silný vítr ' + nf(windMax, 1) + ' m/s' + (c.gusts != null ? ' (nárazy ' + nf(c.gusts, 1) + ')' : ''), txt: 'Pozor na stativ a výtyčku — zatiž stativ, výtyčku drž obouruč, hrozí pád přístroje.' });
        }
        if (c.temp != null && c.temp <= 0) {
            out.push({ cls: 'warn', title: 'Mráz ' + nf(Math.round(c.temp), 0) + ' °C', txt: 'Námraza na hranolech a displeji; baterie vydrží kratší dobu — vezmi náhradní.' });
        }
        if (c.temp != null && c.temp > 30) {
            out.push({ cls: 'warn', title: 'Vedro ' + nf(Math.round(c.temp), 0) + ' °C', txt: 'Refrakce/tetelení vzduchu zhoršuje záměry; měř raději ráno, pij a kryj přístroj před sluncem.' });
        }
        return out;
    }

    // ---- render ---------------------------------------------------------------------
    function renderAll(pack, staleShown) {
        if (!_ui) return;
        var data = pack.data || {};
        var off = data.off || 0;
        var c = data.current;

        byId('ag-wx-loading').style.display = 'none';
        byId('ag-wx-empty').style.display = 'none';
        byId('ag-wx-body').style.display = 'block';

        // offline / stáří dat
        var offBox = byId('ag-wx-offline');
        if (_offline || staleShown) {
            var dt = new Date(pack.t);
            offBox.textContent = 'Naposledy aktualizováno ' + pad2(dt.getHours()) + ':' + pad2(dt.getMinutes()) + (_offline ? ' (offline)' : '…');
            offBox.style.display = 'block';
        } else {
            offBox.style.display = 'none';
        }

        // --- upozornění ---
        var alBox = byId('ag-wx-alerts');
        alBox.innerHTML = '';
        var alerts = buildAlerts(data);
        for (var i = 0; i < alerts.length; i++) {
            var a = alerts[i];
            var card = el('div', 'wx-alert ' + a.cls);
            card.appendChild(el('div', 'wx-alert-t', a.title));
            card.appendChild(el('div', 'wx-alert-x', a.txt));
            alBox.appendChild(card);
        }

        // --- hero ---
        var hero = byId('ag-wx-hero');
        for (var hc = 0; hc < HERO_CLASSES.length; hc++) hero.classList.remove(HERO_CLASSES[hc]);
        hero.classList.add(heroClass(c ? c.code : null, !!data.isDayNow));
        byId('ag-wx-place').textContent = pack.placeName || 'Moje poloha';
        byId('ag-wx-temp').textContent = (c && c.temp != null) ? nf(Math.round(c.temp), 0) + '°' : '–';
        byId('ag-wx-desc').textContent = c ? wmoText(c.code) : '';
        var mm = '';
        if (data.daily && data.daily.length) {
            var d0 = data.daily[0];
            if (d0.tmax != null && d0.tmin != null) mm = 'Max: ' + nf(Math.round(d0.tmax), 0) + '°  Min: ' + nf(Math.round(d0.tmin), 0) + '°';
        }
        if (c && c.feels != null) mm += (mm ? '  ·  ' : '') + 'Pocitově ' + nf(Math.round(c.feels), 0) + '°';
        byId('ag-wx-minmax').textContent = mm;

        renderHours(data, off);
        renderDays(data, off);
        renderGrid(data, off);

        // --- patička ---
        var labels = (pack.sources && pack.sources.length) ? pack.sources.join(', ') : 'ECMWF, DWD ICON, NOAA GFS (Open-Meteo), MET Norway';
        var upd = new Date(pack.t);
        byId('ag-wx-foot').textContent = 'Zdroje: ' + labels + ' · vážený průměr · aktualizováno ' + pad2(upd.getHours()) + ':' + pad2(upd.getMinutes());
    }

    function renderHours(data, off) {
        var box = byId('ag-wx-hours');
        box.innerHTML = '';
        var hours = data.hourly || [];
        if (!hours.length) { box.appendChild(el('div', 'wx-none', 'Hodinová data nejsou k dispozici.')); return; }

        // východy/západy v rozsahu časové osy → vložené položky
        var events = [];
        var lastT = hours[hours.length - 1].t;
        var firstT = hours[0].t;
        for (var di = 0; di < (data.daily || []).length; di++) {
            var d = data.daily[di];
            if (d.sunrise != null && d.sunrise > firstT && d.sunrise <= lastT) events.push({ t: d.sunrise, kind: 'sunrise' });
            if (d.sunset != null && d.sunset > firstT && d.sunset <= lastT) events.push({ t: d.sunset, kind: 'sunset' });
        }
        events.sort(function (a, b) { return a.t - b.t; });
        var evIdx = 0;

        for (var i = 0; i < hours.length; i++) {
            var h = hours[i];
            while (evIdx < events.length && events[evIdx].t <= h.t) {
                box.appendChild(sunItem(events[evIdx], off));
                evIdx++;
            }
            var it = el('div', 'wx-h');
            it.appendChild(el('div', 'wx-h-t', i === 0 ? 'Teď' : pad2(hourOf(h.t, off))));
            var ic = el('div', 'wx-h-i');
            ic.innerHTML = iconForCode(h.code, h.day !== false);
            it.appendChild(ic);
            it.appendChild(el('div', 'wx-h-v', h.temp != null ? nf(Math.round(h.temp), 0) + '°' : '–'));
            var pTxt = '';
            if (h.prob != null && h.prob >= 10) pTxt = nf(Math.round(h.prob), 0) + ' %';
            else if (h.precip != null && h.precip >= 0.1) pTxt = nf(h.precip, 1) + ' mm';
            it.appendChild(el('div', 'wx-h-p', pTxt));
            box.appendChild(it);
        }
    }
    function sunItem(ev, off) {
        var it = el('div', 'wx-h wx-h-sun');
        it.appendChild(el('div', 'wx-h-t', fmtHM(ev.t, off)));
        var ic = el('div', 'wx-h-i');
        ic.innerHTML = iconSvg(ev.kind);
        it.appendChild(ic);
        it.appendChild(el('div', 'wx-h-v wx-h-sunl', ev.kind === 'sunrise' ? 'Východ' : 'Západ'));
        it.appendChild(el('div', 'wx-h-p', ''));
        return it;
    }

    function renderDays(data, off) {
        var box = byId('ag-wx-days');
        box.innerHTML = '';
        var days = data.daily || [];
        if (!days.length) { box.appendChild(el('div', 'wx-none', 'Denní data nejsou k dispozici.')); return; }

        var wMin = Infinity, wMax = -Infinity, i;
        for (i = 0; i < days.length; i++) {
            if (days[i].tmin != null && days[i].tmin < wMin) wMin = days[i].tmin;
            if (days[i].tmax != null && days[i].tmax > wMax) wMax = days[i].tmax;
        }
        var span = (isFinite(wMin) && isFinite(wMax) && wMax > wMin) ? (wMax - wMin) : 1;

        for (i = 0; i < days.length; i++) {
            var d = days[i];
            var row = el('div', 'wx-d');
            row.appendChild(el('div', 'wx-d-n', i === 0 ? 'Dnes' : dayShort(d.t, off)));
            var ic = el('div', 'wx-d-i');
            ic.innerHTML = iconForCode(d.code, true);
            row.appendChild(ic);
            var pTxt = '';
            if (d.pprob != null && d.pprob >= 10) pTxt = nf(Math.round(d.pprob), 0) + ' %';
            else if (d.psum != null && d.psum >= 0.5) pTxt = nf(d.psum, 1) + ' mm';
            row.appendChild(el('div', 'wx-d-p', pTxt));
            row.appendChild(el('div', 'wx-d-min', d.tmin != null ? nf(Math.round(d.tmin), 0) + '°' : '–'));
            var barWrap = el('div', 'wx-d-bar');
            var bar = el('div', 'wx-d-bar-in');
            if (d.tmin != null && d.tmax != null && isFinite(wMin)) {
                var left = Math.max(0, Math.min(100, (d.tmin - wMin) / span * 100));
                var width = Math.max(4, Math.min(100 - left, (d.tmax - d.tmin) / span * 100));
                bar.style.left = left + '%';
                bar.style.width = width + '%';
            }
            barWrap.appendChild(bar);
            row.appendChild(barWrap);
            row.appendChild(el('div', 'wx-d-max', d.tmax != null ? nf(Math.round(d.tmax), 0) + '°' : '–'));
            box.appendChild(row);
        }
    }

    function tile(box, title, wide) {
        var t = el('div', 'wx-tile' + (wide ? ' wx-tile-wide' : ''));
        t.appendChild(el('div', 'wx-tile-h', title));
        box.appendChild(t);
        return t;
    }
    function renderGrid(data, off) {
        var box = byId('ag-wx-grid');
        box.innerHTML = '';
        var c = data.current || {};
        var d0 = (data.daily && data.daily.length) ? data.daily[0] : null;

        // Vítr
        var tw = tile(box, 'Vítr');
        var wRow = el('div', 'wx-wind');
        var arr = el('span', 'wx-wind-arr');
        arr.innerHTML = ICON_ARROW;
        if (c.dir != null) {
            // šipka ukazuje KAM vítr fouká (meteorologický směr = odkud → +180°)
            arr.style.transform = 'rotate(' + Math.round(c.dir + 180) + 'deg)';
            arr.title = 'vítr od ' + dirName(c.dir);
        }
        wRow.appendChild(arr);
        wRow.appendChild(el('span', 'wx-tile-big', c.wind != null ? nf(c.wind, 1) : '–'));
        wRow.appendChild(el('span', 'wx-tile-un', 'm/s'));
        tw.appendChild(wRow);
        var wSub = [];
        if (c.gusts != null) wSub.push('nárazy ' + nf(c.gusts, 1) + ' m/s');
        if (c.dir != null) wSub.push('od ' + dirName(c.dir));
        tw.appendChild(el('div', 'wx-tile-sub', wSub.join(' · ')));

        // Tlak
        var tp = tile(box, 'Tlak');
        var pRow = el('div');
        pRow.appendChild(el('span', 'wx-tile-big', c.pmsl != null ? nf(Math.round(c.pmsl), 0) : '–'));
        pRow.appendChild(el('span', 'wx-tile-un', 'hPa'));
        tp.appendChild(pRow);
        var tr = pressTrend(data.pressHist);
        tp.appendChild(el('div', 'wx-tile-sub', tr ? (tr.arrow + ' ' + tr.txt) : 'hladina moře'));

        // Vlhkost
        var th = tile(box, 'Vlhkost');
        var hRow = el('div');
        hRow.appendChild(el('span', 'wx-tile-big', c.hum != null ? nf(Math.round(c.hum), 0) : '–'));
        hRow.appendChild(el('span', 'wx-tile-un', '%'));
        th.appendChild(hRow);
        th.appendChild(el('div', 'wx-tile-sub', c.cloud != null ? ('oblačnost ' + nf(Math.round(c.cloud), 0) + ' %') : ''));

        // Srážky dnes
        var ts = tile(box, 'Srážky dnes');
        var sRow = el('div');
        sRow.appendChild(el('span', 'wx-tile-big', (d0 && d0.psum != null) ? nf(d0.psum, 1) : '–'));
        sRow.appendChild(el('span', 'wx-tile-un', 'mm'));
        ts.appendChild(sRow);
        ts.appendChild(el('div', 'wx-tile-sub', (d0 && d0.pprob != null) ? ('pravděpodobnost ' + nf(Math.round(d0.pprob), 0) + ' %') : ''));

        // Východ / západ slunce
        var tsun = tile(box, 'Východ / západ');
        var sunRow = el('div');
        sunRow.appendChild(el('span', 'wx-tile-big', d0 ? fmtHM(d0.sunrise, off) : '–'));
        tsun.appendChild(sunRow);
        tsun.appendChild(el('div', 'wx-tile-sub', d0 && d0.sunset != null ? ('západ ' + fmtHM(d0.sunset, off)) : ''));

        // Shoda zdrojů
        var tq = tile(box, 'Shoda zdrojů', true);
        var sp = data.spreadTemp;
        if (sp && sp.n >= 2) {
            var half = (sp.max - sp.min) / 2;
            var verdict = half <= 1 ? 'zdroje se shodují' : (half <= 2 ? 'menší rozdíly mezi modely' : 'nejistá předpověď');
            var qRow = el('div');
            qRow.appendChild(el('span', 'wx-tile-big', '±' + nf(half, 1)));
            qRow.appendChild(el('span', 'wx-tile-un', '°C'));
            tq.appendChild(qRow);
            tq.appendChild(el('div', 'wx-tile-sub', verdict));
        } else {
            tq.appendChild(el('div', 'wx-tile-sub', 'K dispozici je jen jeden zdroj — rozptyl nelze určit.'));
        }
        var list = el('div', 'wx-srcs');
        var ps = data.perSource || [];
        for (var i = 0; i < ps.length; i++) {
            var row = el('div', 'wx-src');
            row.appendChild(el('span', 'wx-src-n', ps[i].label + ' (váha ' + nf(ps[i].w, 2) + ')'));
            row.appendChild(el('span', 'wx-src-v', ps[i].temp != null ? nf(ps[i].temp, 1) + ' °C' : '–'));
            list.appendChild(row);
        }
        if (ps.length) tq.appendChild(list);
    }

    function showEmpty(msg) {
        if (!_ui) return;
        byId('ag-wx-loading').style.display = 'none';
        byId('ag-wx-body').style.display = 'none';
        byId('ag-wx-offline').style.display = 'none';
        var e = byId('ag-wx-empty');
        e.textContent = msg || 'Čekám na GPS… Zadej místo do vyhledávání nahoře, nebo klepni na ikonu zaměřovače, až bude poloha známa.';
        e.style.display = 'block';
    }

    // ---- načtení + kombinace + cache ---------------------------------------------------
    function loadWeather(showCacheFirst) {
        if (!_ui) return;
        var pos = _place ? { lat: _place.lat, lon: _place.lon } : appPos();
        if (!pos) {
            var cached = loadCache();
            if (cached) { _cur = cached; _offline = true; renderAll(cached, false); }
            else showEmpty();
            return;
        }
        var name = _place ? _place.name : 'Moje poloha';

        var c = loadCache();
        var haveCache = c && distKm(c.lat, c.lon, pos.lat, pos.lon) <= SAME_KM;
        if (showCacheFirst && haveCache) {
            _cur = c;
            _offline = false;
            renderAll(c, true);      // hned ukaž poslední data, online refresh běží souběžně
        } else if (!_cur || !haveCache) {
            byId('ag-wx-body').style.display = 'none';
            byId('ag-wx-empty').style.display = 'none';
            byId('ag-wx-loading').style.display = 'block';
        }
        refresh(pos, name, haveCache ? c : null);
    }

    function refresh(pos, name, cacheFallback) {
        var seq = ++_reqSeq;
        var pOm = fetchJson(omUrl(pos.lat, pos.lon), FETCH_MS).then(parseOm, function () { return []; });
        var pMet = fetchJson(metnoUrl(pos.lat, pos.lon), FETCH_MS).then(
            function (j) { var s = parseMetno(j); return s ? [s] : []; },
            function () { return []; }    // met.no smí selhat (CORS/síť) — celek jede dál
        );
        Promise.all([pOm, pMet]).then(function (rr) {
            if (seq !== _reqSeq) return;   // mezitím přišel novější požadavek
            var sources = rr[0].concat(rr[1]);
            if (!sources.length) {
                // úplné selhání → poslední data + štítek offline
                _offline = true;
                if (cacheFallback) { _cur = cacheFallback; renderAll(cacheFallback, false); }
                else if (_cur) renderAll(_cur, false);
                else showEmpty('Předpověď se nepodařilo stáhnout (jsi offline?) a v paměti nejsou žádná starší data pro toto místo.');
                return;
            }
            var prevHist = (cacheFallback && cacheFallback.data && cacheFallback.data.pressHist) ? cacheFallback.data.pressHist : [];
            var data;
            try { data = combineAll(sources, prevHist); }
            catch (e) {
                _offline = true;
                if (cacheFallback) { _cur = cacheFallback; renderAll(cacheFallback, false); }
                return;
            }
            delete data.isDayAt;
            var pack = {
                t: Date.now(), lat: pos.lat, lon: pos.lon, placeName: name,
                data: data,
                sources: sources.map(function (s) { return s.label; })
            };
            saveCache(pack);
            _cur = pack;
            _offline = false;
            if (_open) { try { renderAll(pack, false); } catch (e) {} }
        });
    }

    // ---- otevření / zavření --------------------------------------------------------------
    function open() {
        try {
            ensureUI();
            _open = true;
            _ui.classList.add('on');
            loadWeather(true);
            if (!_timer) {
                var mk = (window.AG && AG.uiInterval) ? AG.uiInterval : setInterval;
                _timer = mk(function () { if (_open) loadWeather(false); }, REFRESH_MS);
            }
        } catch (e) {}
    }
    function close() {
        _open = false;
        if (_ui) _ui.classList.remove('on');
        hideResults();
        if (_timer) {
            if (window.AG && AG.clearUiInterval) AG.clearUiInterval(_timer);
            else { try { clearInterval(_timer); } catch (e) {} }
            _timer = null;
        }
    }

    // ---- registrace dlaždice ----------------------------------------------------------
    function register() {
        try {
            if (typeof window.agRegisterFieldTool === 'function') {
                window.agRegisterFieldTool({ id: 'pocasi', label: 'Počasí', icon: ICON, cat: 'Pomůcky', onClick: open, order: 7 });
            }
        } catch (e) {}
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });

    window.agOpenPocasi = open;
})();
