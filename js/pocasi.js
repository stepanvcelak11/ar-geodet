// ===== AR Geodet — POČASÍ (odpojitelná vrstva) =================================
// Celoobrazovkový nástroj „Počasí" ve stylu Apple Weather pro geodety v terénu.
//
// Co dělá:
//   • Stáhne předpověď z VÍCE nezávislých zdrojů najednou (16 modelů přes
//     Open-Meteo + MET Norway + DWD MOSMIX přes Bright Sky = až 18 zdrojů)
//     a VŠECHNY veličiny kombinuje VÁŽENÝM PRŮMĚREM (váhy pro střední Evropu):
//     teplota, pocitová, vlhkost, oblačnost, tlak, srážky v mm, pravděpodobnost
//     srážek, vítr, nárazy, denní max/min i denní maximum větru, východ a západ
//     slunce. Směr větru vážený PRŮMĚR PO KRUHU (jinak by 350° a 10° daly 180°),
//     ikona/druh počasí vážené HLASOVÁNÍ (kategorii nelze sečíst a vydělit).
//   • U každé veličiny drží i min–max rozptyl mezi zdroji → dlaždice „Shoda zdrojů".
//   • SPOLEHLIVOST PODLE HISTORIE: trefnost každého modelu za POSLEDNÍ MĚSÍC, a to
//     ZVLÁŠŤ NA TEPLOTĚ a ZVLÁŠŤ NA SRÁŽKÁCH (vítr se nesleduje — na přání).
//     Nečeká se měsíc provozu — historie se rovnou DOHLEDÁ Z ARCHIVU (previous-runs
//     API = co model před dnem předpovídal, archive API/ERA5 = jak doopravdy bylo),
//     jednou týdně a po přesunu jinam. Navíc se appka doučuje za provozu
//     (predikce na +3/6/12/24 h vs. skutečnost). Model dobrý na teplotu nemusí být
//     dobrý na déšť, takže z každé trefnosti plyne vlastní váha: teplotní váží
//     teplotu/tlak/vlhkost/vítr, srážková milimetry, pravděpodobnost a ikonu počasí.
//   • SRÁŽKOVÝ RADAR (RainViewer): animovaná OVLADATELNÁ mapa (posun, zoom), kde je
//     vidět, jak se srážkové mraky pohybují (~70 min zpět + 30 min výhled).
//   • Tlak se ukazuje přepočtený na nadmořskou výšku místa (a v závorce na moře).
//   • Seznam zdrojů/vah je schovaný v rozbalovacím řádku úplně dole.
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
        { id: 'gem_seamless',                  label: 'CMC GEM',            w: 0.85 },
        // rozšíření na ~18 zdrojů: AI modely + globály dalších služeb (ověřeno, že
        // pro ČR vracejí data; když zrovna nevrátí, průměr je prostě vynechá)
        { id: 'ecmwf_aifs025',                 label: 'ECMWF AIFS (AI)',    w: 1.00 },
        { id: 'gfs_graphcast025',              label: 'GraphCast (AI)',     w: 0.85 },
        { id: 'jma_seamless',                  label: 'JMA (Japonsko)',     w: 0.80 },
        { id: 'cma_grapes_global',             label: 'CMA (Čína)',         w: 0.70 },
        { id: 'bom_access_global',             label: 'BOM (Austrálie)',    w: 0.70 },
        { id: 'arpege_world',                  label: 'ARPEGE svět',        w: 0.75 }
    ];
    var METNO_W = 1.10;
    var BRIGHTSKY_W = 1.05;   // DWD MOSMIX (statisticky doladěné výstupy stanic)

    // ---- ensemble: 7 dalších nezávislých zdrojů ------------------------------------
    // Ensemble je N mírně rozházených běhů téhož modelu. Jejich PRŮMĚR je dlouhodobě
    // přesnější než jediný deterministický běh (náhodné chyby členů se navzájem
    // vyruší) — proto se sem počítá jako samostatný zdroj s vysokou vahou. Pro Česko
    // je nejcennější ICON-D2-EPS: jediný ensemble s krokem 2 km nad střední Evropou.
    // `sfx` je přípona, pod kterou model přijde v odpovědi (jiná než v dotazu:
    // icon_d2 → icon_d2_eps, gfs025 → ncep_gefs025 …).
    var ENS_MODELS = [
        { id: 'ens_ecmwf',  om: 'ecmwf_ifs025',              sfx: 'ecmwf_ifs025_ensemble',    label: 'ECMWF ensemble (51 běhů)',  w: 1.45 },
        { id: 'ens_icond2', om: 'icon_d2',                   sfx: 'icon_d2_eps',              label: 'DWD ICON-D2 ensemble 2 km', w: 1.40 },
        { id: 'ens_iconeu', om: 'icon_eu',                   sfx: 'icon_eu_eps',              label: 'DWD ICON-EU ensemble',      w: 1.30 },
        { id: 'ens_icon',   om: 'icon_global',               sfx: 'icon_global_eps',          label: 'DWD ICON ensemble',         w: 1.05 },
        { id: 'ens_ukmo',   om: 'ukmo_global_ensemble_20km', sfx: 'ukmo_global_ensemble_20km', label: 'UK Met Office ensemble',   w: 1.05 },
        { id: 'ens_gfs',    om: 'gfs025',                    sfx: 'ncep_gefs025',             label: 'NOAA GFS ensemble',         w: 0.95 },
        { id: 'ens_gem',    om: 'gem_global',                sfx: 'gem_global_ensemble',      label: 'CMC GEM ensemble',          w: 0.85 }
    ];
    // Ensemble data jsou objemná (~90 kB — všichni členové zvlášť), proto se stahují
    // nejvýš 1× za hodinu a mezitím se berou z paměti. Nic se tím neztrácí: nové běhy
    // ensemblů vycházejí po 3–12 hodinách, častější stahování by jen pálilo data.
    var LS_ENS     = 'agWeatherEns_v1';      // {t, lat, lon, srcs}
    var ENS_TTL_MS = 60 * 60 * 1000;
    var ENS_MS     = 14000;                  // velká odpověď → delší timeout než FETCH_MS

    // ---- ČHMÚ: skutečně naměřené hodnoty ------------------------------------------
    // Není to předpověď, ale MĚŘENÍ z nejbližší české stanice (10minutová data z
    // opendata.chmi.cz). Proto má ze všech zdrojů největší váhu a navíc slouží jako
    // „skutečnost" při vyhodnocování trefnosti modelů.
    // opendata.chmi.cz NEPOSÍLÁ hlavičku CORS, takže přímo z prohlížeče je nedosažitelné
    // — chodí se přes vlastní worker (route /wx/chmi v cloud/worker.js), který data
    // stáhne, najde nejbližší stanici a do mobilu pošle ~1 kB. Dokud route na workeru
    // není nasazená, požadavek tiše selže a zbytek předpovědi jede beze změny.
    // ČHMÚ zveřejňuje desetiminutovky se zpožděním kolem hodiny (ověřeno na ostrých
    // datech). Čerstvé měření tedy může modely přebít, hodinu staré už ne — váha se
    // proto snižuje s jeho stářím. CHMI_SKILL_MIN = do jakého stáří se měření bere
    // jako „skutečnost" při vyhodnocování trefnosti modelů (jinak by se předpověď na
    // teď porovnávala se stavem před hodinou).
    var CHMI_W        = 2.20;
    var CHMI_SKILL_MIN = 40;
    var CZ_BOX     = { la1: 48.4, la2: 51.2, lo1: 12.0, lo2: 18.95 };

    var DAYS_CS = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
    var DIRS_CS = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];

    // Ikona dlaždice (slunce za mrakem, styl appky — stroke currentColor)
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2M4.9 4.9l1.4 1.4M2 12h2M19.1 4.9l-1.4 1.4M17.7 9.2A5 5 0 1 0 9 12.5"/><path d="M13 22H7a4 4 0 1 1 .6-7.96A5.5 5.5 0 0 1 18.4 16 3 3 0 0 1 18 22h-5z"/></svg>';
    var ICON_LOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.6"/><path d="M12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5"/></svg>';
    var ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
    var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V5M6.5 10.5L12 5l5.5 5.5"/></svg>';
    var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.7 4.2v5h-5"/></svg>';

    // ---- stav -----------------------------------------------------------------
    var _ui = null, _open = false;
    var _place = null;          // {name, lat, lon} nebo null = GPS appky
    var _cur = null;            // poslední zobrazený balík {t, lat, lon, placeName, data, sources}
    var _offline = false;
    var _reqSeq = 0;            // ochrana proti závodům fetchů
    var _timer = null;          // auto-refresh
    var _searchTimer = null;
    var _busy = false;          // právě běží stahování (kvůli točícímu se tlačítku)
    var _radar = { map: null, marker: null, layers: [], frames: [], idx: 0, timer: null, playing: true, lastFetch: 0 };

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
    function brightskyUrl(lat, lon) {
        // DWD MOSMIX přes Bright Sky (bez klíče, CORS): hodinovka dnes + 2 dny
        function d(off) { var x = new Date(Date.now() + off * 86400000); return x.toISOString().slice(0, 10); }
        return 'https://api.brightsky.dev/weather?lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4) +
            '&date=' + d(0) + '&last_date=' + d(2);
    }
    function ensUrl(lat, lon) {
        // jen veličiny, které u ensemblu dávají smysl a unesou objem dat (kód počasí
        // ani denní souhrny ensemble API nenabízí); 30 h pokryje zobrazenou hodinovku
        return 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
            '&models=' + ENS_MODELS.map(function (m) { return m.om; }).join(',') +
            '&hourly=temperature_2m,precipitation,wind_speed_10m' +
            '&forecast_hours=30&timezone=auto&wind_speed_unit=ms&timeformat=unixtime';
    }
    function inCz(lat, lon) {
        return lat >= CZ_BOX.la1 && lat <= CZ_BOX.la2 && lon >= CZ_BOX.lo1 && lon <= CZ_BOX.lo2;
    }
    function chmiUrl(lat, lon, sub) {
        var base = '';
        try {
            if (window.AGUcty) base = (typeof AGUcty.apiUrl === 'function' ? AGUcty.apiUrl() : '') || AGUcty.DEFAULT_API || '';
        } catch (e) { base = ''; }
        if (!base) return null;
        return base.replace(/\/+$/, '') + '/wx/chmi' + (sub || '') + '?lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4);
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
    // zpět: tlak na hladině moře → skutečný (staniční) tlak v dané nadmořské výšce
    function fromMsl(p, elevM, tempC) {
        if (p == null) return null;
        if (elevM == null || !isFinite(elevM) || elevM < 1) return p;
        var T = (tempC == null) ? 15 : tempC;
        try {
            return p * Math.pow(1 - (0.0065 * elevM) / (T + 0.0065 * elevM + 273.15), 5.257);
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
            var src = { id: m.id, label: m.label, w: m.w, off: off, elev: elev, cur: null, hourly: null, daily: null };
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

    // ---- parsování Bright Sky (DWD MOSMIX) ----------------------------------------------
    // Jednotky „dwd": teplota °C, vítr km/h (→ /3.6 na m/s), tlak už na hladině moře.
    var BS_WMO = {
        'clear-day': 0, 'clear-night': 0, 'partly-cloudy-day': 2, 'partly-cloudy-night': 2,
        cloudy: 3, fog: 45, wind: 3, rain: 63, sleet: 68, snow: 73, hail: 96, thunderstorm: 95
    };
    function parseBrightsky(j) {
        try {
            var rows = j && j.weather;
            if (!rows || !rows.length) return null;
            var src = {
                id: 'brightsky', label: 'DWD MOSMIX', w: BRIGHTSKY_W, off: null, elev: null, cur: null,
                hourly: { time: [], temp: [], prob: [], precip: [], code: [], wind: [], gusts: [] },
                daily: null
            };
            var nowSec = Math.floor(Date.now() / 1000), bestCur = null, bestD = Infinity;
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                if (!r || !r.timestamp) continue;
                var t = Math.round(Date.parse(r.timestamp) / 1000);
                if (!isFinite(t)) continue;
                var code = (r.icon && BS_WMO.hasOwnProperty(r.icon)) ? BS_WMO[r.icon] : null;
                var wind = num(r.wind_speed), gust = num(r.wind_gust_speed);
                src.hourly.time.push(t);
                src.hourly.temp.push(num(r.temperature));
                src.hourly.prob.push(num(r.precipitation_probability));
                src.hourly.precip.push(num(r.precipitation));
                src.hourly.code.push(code);
                src.hourly.wind.push(wind != null ? wind / 3.6 : null);
                src.hourly.gusts.push(gust != null ? gust / 3.6 : null);
                var d = Math.abs(t - nowSec);
                if (d < bestD && d <= 5400) {
                    bestD = d;
                    bestCur = {
                        t: num(r.temperature), feels: null,
                        hum: num(r.relative_humidity), precip: num(r.precipitation), code: code,
                        cloud: num(r.cloud_cover),
                        wind: wind != null ? wind / 3.6 : null, dir: num(r.wind_direction),
                        gusts: gust != null ? gust / 3.6 : null,
                        pmsl: num(r.pressure_msl)
                    };
                }
            }
            src.cur = bestCur;
            if (!src.hourly.time.length) src.hourly = null;
            return (src.cur || src.hourly) ? src : null;
        } catch (e) { return null; }
    }

    // ---- parsování ensemblů (průměr přes členy) -------------------------------------
    // Klíče chodí jako temperature_2m_member01_icon_d2_eps; řídicí běh je bez čísla
    // člena (temperature_2m_icon_d2_eps) a počítá se stejnou vahou jako ostatní.
    // `kind`: 'mean' (teplota, vítr), 'median' (srážky — průměr z 51 běhů udělá
    // z ostré přeháňky mrholení) nebo 'prob' (v kolika % běhů prší → poctivá
    // pravděpodobnost srážek, kterou deterministické modely nabídnout neumí).
    function ensStat(h, name, sfx, n, kind) {
        var keys = [], k, tail = '_' + sfx;
        for (k in h) {
            if (!Object.prototype.hasOwnProperty.call(h, k) || k === 'time') continue;
            if (k.indexOf(name + '_') !== 0) continue;
            if (k.length <= tail.length || k.slice(k.length - tail.length) !== tail) continue;
            var mid = k.slice(name.length + 1, k.length - tail.length);   // '' nebo 'memberNN'
            if (mid === '' || /^member\d+$/.test(mid)) keys.push(k);
        }
        if (!keys.length) return null;
        var out = new Array(n), i, j, v, any = false;
        for (i = 0; i < n; i++) {
            var vals = [];
            for (j = 0; j < keys.length; j++) {
                var a = h[keys[j]];
                v = (a && a.length > i) ? num(a[i]) : null;
                if (v != null) vals.push(v);
            }
            if (!vals.length) { out[i] = null; continue; }
            any = true;
            if (kind === 'prob') {
                var wet = 0;
                for (j = 0; j < vals.length; j++) { if (vals[j] >= WET_MM) wet++; }
                out[i] = Math.round((wet / vals.length) * 100);
            } else if (kind === 'median') {
                vals.sort(function (x, y) { return x - y; });
                var mid2 = vals.length >> 1;
                out[i] = (vals.length % 2) ? vals[mid2] : (vals[mid2 - 1] + vals[mid2]) / 2;
            } else {
                var sum = 0;
                for (j = 0; j < vals.length; j++) sum += vals[j];
                out[i] = sum / vals.length;
            }
        }
        return any ? out : null;
    }
    function parseEns(j) {
        var out = [];
        try {
            var h = j && j.hourly;
            var time = h && h.time;
            if (!time || !time.length) return out;
            var off = num(j.utc_offset_seconds); if (off == null) off = 0;
            var elev = num(j.elevation);
            for (var i = 0; i < ENS_MODELS.length; i++) {
                var m = ENS_MODELS[i];
                var temp = ensStat(h, 'temperature_2m', m.sfx, time.length, 'mean');
                var prec = ensStat(h, 'precipitation', m.sfx, time.length, 'median');
                var pprob = ensStat(h, 'precipitation', m.sfx, time.length, 'prob');
                var wind = ensStat(h, 'wind_speed_10m', m.sfx, time.length, 'mean');
                if (!temp && !prec && !wind) continue;   // model nad ČR neběží → vynech
                var src = {
                    id: m.id, label: m.label, w: m.w, off: off, elev: elev, cur: null,
                    hourly: { time: time, temp: temp, prob: pprob, precip: prec, code: null, wind: wind, gusts: null },
                    daily: null
                };
                var hi = nearestHourIdx(time);
                if (hi >= 0) {
                    var t = at(temp, hi), wd = at(wind, hi);
                    if (t != null || wd != null) {
                        src.cur = {
                            t: t, feels: null, hum: null, precip: at(prec, hi), code: null,
                            cloud: null, wind: wd, dir: null, gusts: null, pmsl: null
                        };
                    }
                }
                out.push(src);
            }
        } catch (e) { return out; }
        return out;
    }
    // ensemble data se drží hodinu v localStorage (viz komentář u ENS_TTL_MS)
    function loadEnsCache(lat, lon) {
        try {
            var c = JSON.parse(localStorage.getItem(LS_ENS));
            if (!c || !c.srcs || !c.srcs.length) return null;
            if (Date.now() - c.t > ENS_TTL_MS) return null;
            if (distKm(c.lat, c.lon, lat, lon) > SAME_KM) return null;
            // nejstarší hodiny už mohly propadnout — `cur` se dopočte znovu z řady
            for (var i = 0; i < c.srcs.length; i++) {
                var s = c.srcs[i];
                s._hm = null;
                var hi = (s.hourly && s.hourly.time) ? nearestHourIdx(s.hourly.time) : -1;
                if (hi < 0) return null;      // data přestárla natolik, že „teď" v nich není
                s.cur = {
                    t: at(s.hourly.temp, hi), feels: null, hum: null, precip: at(s.hourly.precip, hi),
                    code: null, cloud: null, wind: at(s.hourly.wind, hi), dir: null, gusts: null, pmsl: null
                };
            }
            return c.srcs;
        } catch (e) { return null; }
    }
    function saveEnsCache(lat, lon, srcs) {
        try {
            var slim = srcs.map(function (s) {
                return { id: s.id, label: s.label, w: s.w, off: s.off, elev: s.elev, cur: null, hourly: s.hourly, daily: null };
            });
            localStorage.setItem(LS_ENS, JSON.stringify({ t: Date.now(), lat: lat, lon: lon, srcs: slim }));
        } catch (e) { /* plná paměť → ensembly se příště prostě stáhnou znovu */ }
    }

    // ---- parsování ČHMÚ (měření z nejbližší stanice, přes vlastní worker) ------------
    function parseChmi(j) {
        try {
            if (!j || !j.ok || !j.station) return null;
            var st = j.station;
            var t = num(j.T);
            var p = num(j.P);
            // ČHMÚ hlásí staniční tlak → na hladinu moře, ať se sejde s modely
            var pmsl = toMsl(p, num(st.elev), t);
            var cur = {
                t: t, feels: null, hum: num(j.H),
                precip: num(j.precip1h), code: null, cloud: null,
                wind: num(j.F), dir: num(j.D), gusts: num(j.Fmax),
                pmsl: pmsl
            };
            if (cur.t == null && cur.wind == null && cur.hum == null) return null;
            var d = num(j.distKm);
            var obs = num(j.t);
            var ageMin = (obs != null) ? (Date.now() / 1000 - obs) / 60 : 999;
            var w = (ageMin <= 30) ? CHMI_W : (ageMin <= 80 ? CHMI_W * 0.6 : CHMI_W * 0.3);
            return {
                id: 'chmi', label: 'ČHMÚ ' + (st.name || 'stanice') + (d != null ? ' · ' + nf(d, 1) + ' km' : ''),
                w: w, off: null, elev: num(st.elev), meas: true,
                // syrová naměřená hodnota — applyLapse teplotu přepočte na výšku bodu,
                // ale v dlaždici „Naměřeno ČHMÚ" musí zůstat to, co stanice OPRAVDU
                // změřila, jinak by appka vydávala dopočet za měření
                rawT: t, stElev: num(st.elev),
                station: st.name || null, distKm: d, obsT: obs,
                ageMin: Math.round(ageMin),
                cur: cur, hourly: null, daily: null
            };
        } catch (e) { return null; }
    }

    // ---- spolehlivost podle historie (trefnost modelů, okno 1 měsíc) ---------------------
    // Při každém stažení si appka uloží, co který zdroj předpovídá na +3/6/12/24 h.
    // Až ten čas nastane (další otevření počasí), předpověď se srovná s tehdejší
    // „skutečností" a výsledek se zapíše do logu vyhodnocení [čas, chyba].
    // Trefnost modelu = průměrná chyba ze VŠECH vyhodnocení za POSLEDNÍ MĚSÍC.
    //
    // Sleduje se ZVLÁŠŤ TEPLOTA a ZVLÁŠŤ SRÁŽKY (na přání; vítr se nesleduje) — model
    // dobrý na teplotu nemusí být dobrý na déšť. Z každé se počítá vlastní váha:
    //   • `w`  (podle teploty) váží teplotu, vlhkost, tlak, oblačnost, vítr…
    //   • `wp` (podle srážek)  váží mm srážek, pravděpodobnost srážek a ikonu počasí.
    // Kdo se trefuje, dostává vyšší váhu (×0,6–1,5).
    // PÁSMA DOSAHU: model dobrý na tři hodiny dopředu nemusí být dobrý na zítřek —
    // ICON-D2 (2 km) je špička nakrátko a za +48 h vůbec neexistuje, ECMWF naopak vede
    // až od druhého dne. Jedna společná známka obojí rozmazává, takže se trefnost i
    // váhy počítají zvlášť pro KRÁTKÝ dosah (do 6 h) a DLOUHÝ (dál).
    // Záznamy bez uloženého horizontu (z dřívějších verzí) platí v obou pásmech.
    var BAND_SHORT_H = 6;
    var LS_SKILL = 'agWeatherSkill_v1';       // {pend:[{t,id,v,p,h}], hist:{id:[[ms,err,h]]}, histP:{id:[[ms,mm,zásah,h]]}}
    var SKILL_WIN_MS = 30 * 86400000;         // trefnost se počítá z okna 30 dní zpětně
    var SKILL_MAX_PER_MODEL = 400;            // pojistka proti přetečení localStorage
    var WET_MM = 0.1;                         // od kolika mm/h se hodina počítá jako „prší"
    var PEND_KEEP_S = 30 * 3600;              // jak dlouho čekat s nevyhodnocenou předpovědí na měření ČHMÚ
    var PEND_MAX = 1400;                      // strop na počet čekajících předpovědí (~60 kB v localStorage)
    function loadSkill() {
        try {
            var o = JSON.parse(localStorage.getItem(LS_SKILL));
            if (o && Object.prototype.toString.call(o.pend) === '[object Array]') {
                if (!o.hist || typeof o.hist !== 'object') o.hist = {};    // migrace ze starší verze (EMA bez logu)
                if (!o.histP || typeof o.histP !== 'object') o.histP = {}; // migrace: dřív jen teplota
                return o;
            }
        } catch (e) {}
        return { pend: [], hist: {}, histP: {} };
    }
    function saveSkill(sk) { try { localStorage.setItem(LS_SKILL, JSON.stringify(sk)); } catch (e) {} }
    // ---- ZPĚTNÉ dohledání trefnosti z archivu (aby platila hned, ne až za měsíc) -------
    // Živé učení výše potřebuje měsíc provozu, než něco ukáže. Proto se jednou týdně
    // (a při přesunu jinam) stáhne rovnou MĚSÍC HOTOVÉ HISTORIE:
    //   • previous-runs API Open-Meteo = co každý model před DNEM předpovídal na tuto
    //     hodinu (`temperature_2m_previous_day1_<model>`, `precipitation_previous_day1_…`),
    //     31 dní zpět,
    //   • archive API (reanalýza ERA5) = jak pak doopravdy bylo → skutečnost.
    // Rozdíl obojího = průměrná chyba modelu na 24 h dopředu za celý měsíc (~740 hodin).
    // U srážek se kromě chyby v mm počítá i ZÁSAH: v kolika procentech hodin model
    // správně řekl prší / neprší (to je pro terén čitelnější než desetiny milimetru).
    // Ověřeno dotazem pro ČR: archiv má 13 ze 16 modelů; AI modely (AIFS, GraphCast) a
    // BOM v něm nejsou → ty se dál učí jen živě. ERA5 je na hrubší síti než modely, ale
    // společný posun se ve VZÁJEMNÉM porovnání modelů vykrátí.
    var LS_SKILL_BF = 'agWeatherSkillBf_v1';   // {t, lat, lon, days, mae:{id:{e,n}}, maeP:{id:{e,n,hit}}}
    var BF_MAX_AGE_MS = 7 * 86400000;          // jednou týdně stačí
    var BF_DAYS = 31;
    var BF_CAP = 240;                          // strop vlivu archivu, ať se živé učení časem prosadí
    var BF_MOVE_KM = 60;                       // po přesunu jinam se archiv dohledá znovu
    var _bf, _bfBusy = false;

    function loadBf() {
        if (_bf !== undefined) return _bf;
        try { var o = JSON.parse(localStorage.getItem(LS_SKILL_BF)); _bf = (o && o.mae) ? o : null; }
        catch (e) { _bf = null; }
        return _bf;
    }
    function saveBf(o) { _bf = o; try { localStorage.setItem(LS_SKILL_BF, JSON.stringify(o)); } catch (e) {} }

    // průměrná chyba TEPLOTY za poslední měsíc: archiv + živě naměřené (null = zatím nic)
    function inBand(h, band) {
        if (!band) return true;
        if (h == null || !isFinite(h)) return true;   // starší záznam bez horizontu platí všude
        return (band === 's') ? (h <= BAND_SHORT_H) : (h > BAND_SHORT_H);
    }
    function maeOf(sk, id, band) {
        var live = null;
        var a = sk.hist ? sk.hist[id] : null;
        if (a && a.length) {
            var lim = Date.now() - SKILL_WIN_MS, s = 0, n = 0;
            for (var i = 0; i < a.length; i++) {
                if (a[i] && a[i][0] >= lim && a[i][1] != null && isFinite(a[i][1]) && inBand(a[i][2], band)) { s += a[i][1]; n++; }
            }
            if (n) live = { e: s / n, n: n };
        }
        // archiv dohledává předpověď na 24 h dopředu → do krátkého pásma nepatří
        if (band === 's') return live ? { e: live.e, n: live.n, src: 'měřeno v provozu' } : null;
        var bf = loadBf();
        var b = (bf && bf.mae) ? bf.mae[id] : null;
        if (b && b.n) {
            var bn = Math.min(b.n, BF_CAP);
            if (!live) return { e: b.e, n: b.n, src: 'archiv' };
            return { e: (b.e * bn + live.e * live.n) / (bn + live.n), n: b.n + live.n, src: 'archiv + měření' };
        }
        return live ? { e: live.e, n: live.n, src: 'měřeno v provozu' } : null;
    }
    // totéž pro SRÁŽKY: e = průměrná chyba v mm/h (podle ní se váží), hit = podíl hodin
    // se správným verdiktem prší/neprší (to se ukazuje uživateli)
    function maePOf(sk, id, band) {
        var live = null;
        var a = sk.histP ? sk.histP[id] : null;
        if (a && a.length) {
            var lim = Date.now() - SKILL_WIN_MS, s = 0, n = 0, h = 0;
            for (var i = 0; i < a.length; i++) {
                if (a[i] && a[i][0] >= lim && a[i][1] != null && isFinite(a[i][1]) && inBand(a[i][3], band)) {
                    s += a[i][1]; n++; if (a[i][2]) h++;
                }
            }
            if (n) live = { e: s / n, n: n, hit: h / n };
        }
        if (band === 's') return live ? { e: live.e, n: live.n, hit: live.hit, src: 'měřeno v provozu' } : null;
        var bf = loadBf();
        var b = (bf && bf.maeP) ? bf.maeP[id] : null;
        if (b && b.n) {
            var bn = Math.min(b.n, BF_CAP);
            if (!live) return { e: b.e, n: b.n, hit: b.hit, src: 'archiv' };
            var hit = (b.hit != null && live.hit != null)
                ? (b.hit * bn + live.hit * live.n) / (bn + live.n)
                : (b.hit != null ? b.hit : live.hit);
            return { e: (b.e * bn + live.e * live.n) / (bn + live.n), n: b.n + live.n, hit: hit, src: 'archiv + měření' };
        }
        return live ? { e: live.e, n: live.n, hit: live.hit, src: 'měřeno v provozu' } : null;
    }

    function bfDate(shiftDays) {
        var d = new Date(Date.now() - shiftDays * 86400000);
        return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }
    function maybeBackfill(lat, lon) {
        var bf = loadBf();
        if (_bfBusy) return;
        if (bf && (Date.now() - bf.t) < BF_MAX_AGE_MS && distKm(bf.lat, bf.lon, lat, lon) < BF_MOVE_KM) return;
        _bfBusy = true;
        var ll = 'latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4);
        var uPrev = 'https://previous-runs-api.open-meteo.com/v1/forecast?' + ll +
            '&hourly=temperature_2m_previous_day1,precipitation_previous_day1&models=' + OM_MODELS.map(function (m) { return m.id; }).join(',') +
            '&past_days=' + BF_DAYS + '&forecast_days=1&timeformat=unixtime';
        var uArch = 'https://archive-api.open-meteo.com/v1/archive?' + ll +
            '&start_date=' + bfDate(BF_DAYS + 1) + '&end_date=' + bfDate(1) +
            '&hourly=temperature_2m,precipitation&timeformat=unixtime';
        Promise.all([
            fetchJson(uPrev, 25000).then(null, function () { return null; }),
            fetchJson(uArch, 25000).then(null, function () { return null; })
        ]).then(function (rr) {
            _bfBusy = false;
            var p = rr[0], a = rr[1];
            if (!p || !p.hourly || !a || !a.hourly) return;
            var truT = {}, truP = {}, aT = a.hourly.time || [];
            var aTemp = a.hourly.temperature_2m || [], aPrec = a.hourly.precipitation || [], i, v;
            for (i = 0; i < aT.length; i++) {
                v = num(aTemp[i]); if (v != null) truT[aT[i]] = v;
                v = num(aPrec[i]); if (v != null) truP[aT[i]] = v;
            }
            var pT = p.hourly.time || [], mae = {}, maeP = {}, maxN = 0, any = false;
            OM_MODELS.forEach(function (m) {
                var k, f, t;
                // teplota
                var arr = p.hourly['temperature_2m_previous_day1_' + m.id];
                if (arr && arr.length) {
                    var s = 0, n = 0;
                    for (k = 0; k < pT.length && k < arr.length; k++) {
                        f = num(arr[k]); if (f == null) continue;
                        t = truT[pT[k]]; if (t == null) continue;
                        s += Math.abs(f - t); n++;
                    }
                    if (n >= 48) {   // aspoň dva dny překryvu, jinak je průměr k ničemu
                        mae[m.id] = { e: Math.round((s / n) * 100) / 100, n: n };
                        if (n > maxN) maxN = n;
                        any = true;
                    }
                }
                // srážky: chyba v mm/h + zásah (správně prší / neprší)
                var arrP = p.hourly['precipitation_previous_day1_' + m.id];
                if (arrP && arrP.length) {
                    var sp = 0, np = 0, hit = 0;
                    for (k = 0; k < pT.length && k < arrP.length; k++) {
                        f = num(arrP[k]); if (f == null) continue;
                        t = truP[pT[k]]; if (t == null) continue;
                        sp += Math.abs(f - t); np++;
                        if ((f >= WET_MM) === (t >= WET_MM)) hit++;
                    }
                    if (np >= 48) {
                        maeP[m.id] = {
                            e: Math.round((sp / np) * 1000) / 1000,
                            n: np, hit: Math.round((hit / np) * 1000) / 1000
                        };
                        if (np > maxN) maxN = np;
                        any = true;
                    }
                }
            });
            if (!any) return;
            saveBf({ t: Date.now(), lat: lat, lon: lon, days: Math.round(maxN / 24), mae: mae, maeP: maeP });
            applySkillToCur();
        }, function () { _bfBusy = false; });
    }
    // ---- trefnost proti SKUTEČNÉMU MĚŘENÍ ČHMÚ ---------------------------------------
    // Dosud se předpověď porovnávala s kombinovaným odhadem všech modelů. To je ale
    // částečně kruhem: model, který se drží u davu, dostal dobrou známku, i když se
    // spletli úplně všichni. Tady se jednou za pár hodin stáhne CELÝ DEN naměřených
    // hodnot z nejbližší stanice ČHMÚ a proti nim se vyhodnotí všechny čekající
    // předpovědi — i ty, u kterých appka zrovna v danou hodinu otevřená nebyla.
    var LS_CHMI_V = 'agWeatherChmiVerify_v1';   // {t, lat, lon}
    var CHMI_VERIFY_MS = 6 * 3600 * 1000;
    var CHMI_VERIFY_KM = 30;
    var _cvBusy = false;
    var _lastElevReal = null;    // poslední známá skutečná výška místa (pro chmiVerify)
    function maybeChmiVerify(lat, lon) {
        if (_cvBusy || !inCz(lat, lon)) return;
        var u = chmiUrl(lat, lon, '/day');
        if (!u) return;
        var st = null;
        try { st = JSON.parse(localStorage.getItem(LS_CHMI_V)); } catch (e) { st = null; }
        if (st && st.t && (Date.now() - st.t) < CHMI_VERIFY_MS && distKm(st.lat, st.lon, lat, lon) < CHMI_VERIFY_KM) return;
        _cvBusy = true;
        fetchJson(u + '&days=2', 20000).then(function (j) {
            _cvBusy = false;
            try { localStorage.setItem(LS_CHMI_V, JSON.stringify({ t: Date.now(), lat: lat, lon: lon })); } catch (e) {}
            try { chmiVerify(j); } catch (e) {}
        }, function () { _cvBusy = false; });
    }
    function chmiVerify(j) {
        if (!j || !j.ok || !j.hours || !j.hours.length) return;
        // Uložené předpovědi jsou přepočtené na výšku BODU (applyLapse), měření je ze
        // stanice v jiné výšce. Bez srovnání na stejnou hladinu by se do trefnosti
        // každého modelu započetl stejný umělý posun a pořadí modelů by to zkreslilo.
        var stElev = (j.station && num(j.station.elev) != null) ? num(j.station.elev) : null;
        var dt = lapseDT(stElev, _lastElevReal);
        var obsT = {}, obsP = {}, i, r, t, v;
        for (i = 0; i < j.hours.length; i++) {
            r = j.hours[i]; if (!r) continue;
            t = num(r[0]); if (t == null) continue;
            v = num(r[1]); if (v != null) obsT[t] = v + dt;
            v = num(r[2]); if (v != null) obsP[t] = v;
        }
        var sk = loadSkill(), nowMs = Date.now(), rest = [], touchT = {}, touchP = {}, id, done = 0;
        for (i = 0; i < sk.pend.length; i++) {
            var p = sk.pend[i];
            if (!p || p.t == null) continue;
            var oT = obsT[p.t], oP = obsP[p.t], used = false;
            if (oT != null && p.v != null) {
                if (!sk.hist[p.id]) sk.hist[p.id] = [];
                sk.hist[p.id].push([nowMs, Math.round(Math.abs(p.v - oT) * 100) / 100, (p.h != null ? p.h : null)]);
                touchT[p.id] = 1; used = true;
            }
            if (oP != null && p.p != null) {
                if (!sk.histP[p.id]) sk.histP[p.id] = [];
                sk.histP[p.id].push([nowMs, Math.round(Math.abs(p.p - oP) * 1000) / 1000,
                    ((p.p >= WET_MM) === (oP >= WET_MM)) ? 1 : 0, (p.h != null ? p.h : null)]);
                touchP[p.id] = 1; used = true;
            }
            if (used) done++; else rest.push(p);
        }
        if (!done) return;
        sk.pend = rest;
        for (id in touchT) trimLog(sk.hist, id);
        for (id in touchP) trimLog(sk.histP, id);
        sk.chmiVerified = (sk.chmiVerified || 0) + done;
        saveSkill(sk);
        applySkillToCur();
    }

    // přepočítá zobrazenou trefnost bez nového stahování předpovědi
    // (váhy se dorovnají při nejbližším obnovení dat — ta jsou stejně čerstvá)
    function applySkillToCur() {
        if (!_cur || !_cur.data) return;
        var sk = loadSkill(), ref = skillRef(sk, 'temp', 'l'), refP = skillRef(sk, 'precip', 'l'), bf = loadBf();
        (_cur.data.perSource || []).forEach(function (s) {
            var m = maeOf(sk, s.id, 'l'), mp = maePOf(sk, s.id, 'l');
            s.skill = m ? Math.round(m.e * 10) / 10 : null;
            s.skillSrc = m ? m.src : null;
            s.skillP = mp ? Math.round(mp.e * 1000) / 1000 : null;
            s.skillPHit = (mp && mp.hit != null) ? mp.hit : null;
        });
        _cur.data.skillInfo = ref
            ? { ref: Math.round(ref.ref * 10) / 10, models: ref.models, days: (bf ? bf.days : 0) }
            : null;
        _cur.data.skillInfoP = refP
            ? { ref: Math.round(refP.ref * 1000) / 1000, models: refP.models, hit: (refP.hit != null ? refP.hit : null) }
            : null;
        if (!_open || !_ui) return;
        try { renderGrid(_cur.data, _cur.data.off); renderSrcPanel(_cur); } catch (e) {}
    }
    function trimLog(log, id) {
        var lim = Date.now() - SKILL_WIN_MS;
        var a = (log[id] || []).filter(function (r) { return r && r[0] >= lim; });
        if (a.length > SKILL_MAX_PER_MODEL) a = a.slice(a.length - SKILL_MAX_PER_MODEL);
        log[id] = a;
    }
    function updateSkill(sources, observedTemp, observedPrecip) {
        var sk = loadSkill();
        var now = Math.floor(Date.now() / 1000);
        var nowMs = Date.now();
        var i, id;
        var haveT = (observedTemp != null && isFinite(observedTemp));
        var haveP = (observedPrecip != null && isFinite(observedPrecip));
        if (haveT || haveP) {
            var rest = [], touchT = {}, touchP = {};
            for (i = 0; i < sk.pend.length; i++) {
                var p = sk.pend[i];
                if (!p || p.t == null) continue;
                if (Math.abs(p.t - now) <= 2700) {          // ±45 min → vyhodnoť proti „teď"
                    if (haveT && p.v != null) {
                        if (!sk.hist[p.id]) sk.hist[p.id] = [];
                        sk.hist[p.id].push([nowMs, Math.round(Math.abs(p.v - observedTemp) * 100) / 100, (p.h != null ? p.h : null)]);
                        touchT[p.id] = 1;
                    }
                    if (haveP && p.p != null) {
                        if (!sk.histP[p.id]) sk.histP[p.id] = [];
                        sk.histP[p.id].push([nowMs, Math.round(Math.abs(p.p - observedPrecip) * 1000) / 1000,
                            ((p.p >= WET_MM) === (observedPrecip >= WET_MM)) ? 1 : 0, (p.h != null ? p.h : null)]);
                        touchP[p.id] = 1;
                    }
                    // prošlé, ale ještě ne moc staré předpovědi se DRŽÍ: vyhodnotí je
                    // denní srovnání s měřením ČHMÚ (chmiVerify), i když appka zrovna
                    // v tu hodinu otevřená nebyla
                } else if (p.t > now || (now - p.t) < PEND_KEEP_S) rest.push(p);
            }
            sk.pend = rest;
            // prořez logů: jen okno 1 měsíc + strop na počet záznamů
            for (id in touchT) trimLog(sk.hist, id);
            for (id in touchP) trimLog(sk.histP, id);
        }
        // nové predikce (jen když pro daný zdroj+čas ještě nejsou)
        var have = {}, horizons = [3, 6, 12, 24];
        for (i = 0; i < sk.pend.length; i++) have[sk.pend[i].id + '@' + sk.pend[i].t] = 1;
        for (i = 0; i < sources.length; i++) {
            var s = sources[i];
            if (!s.hourly || !s.hourly.time) continue;
            for (var hzi = 0; hzi < horizons.length; hzi++) {
                var target = now + horizons[hzi] * 3600, best = -1, bd = 1800;
                for (var k = 0; k < s.hourly.time.length; k++) {
                    var tt = num(s.hourly.time[k]);
                    if (tt == null) continue;
                    var d = Math.abs(tt - target);
                    if (d < bd) { bd = d; best = k; }
                }
                if (best < 0) continue;
                var te = num(s.hourly.time[best]);
                if (te == null || have[s.id + '@' + te]) continue;
                var v = at(s.hourly.temp, best), pv = at(s.hourly.precip, best);
                if (v == null && pv == null) continue;
                sk.pend.push({
                    t: te, id: s.id, h: horizons[hzi],
                    v: (v == null ? null : Math.round(v * 10) / 10),
                    p: (pv == null ? null : Math.round(pv * 100) / 100)
                });
                have[s.id + '@' + te] = 1;
            }
        }
        if (sk.pend.length > PEND_MAX) sk.pend = sk.pend.slice(sk.pend.length - PEND_MAX);
        saveSkill(sk);
        return sk;
    }
    // referenční chyba = průměr modelů s dost dlouhou historií (okno 1 měsíc).
    // `kind`: 'temp' (výchozí) nebo 'precip'
    function skillRef(sk, kind, band) {
        var precip = (kind === 'precip');
        var ids = {}, k, m, bf = loadBf();
        for (k in (precip ? (sk.histP || {}) : (sk.hist || {}))) ids[k] = 1;
        var bfm = bf ? (precip ? bf.maeP : bf.mae) : null;
        if (bfm) { for (k in bfm) ids[k] = 1; }
        var sum = 0, n = 0, hitSum = 0, hitN = 0;
        for (k in ids) {
            m = precip ? maePOf(sk, k, band) : maeOf(sk, k, band);
            if (m && m.n >= 3) {
                sum += m.e; n++;
                if (m.hit != null) { hitSum += m.hit; hitN++; }
            }
        }
        if (!n) return null;
        return { ref: sum / n, models: n, hit: (hitN ? hitSum / hitN : null) };
    }
    // `kind`: 'temp' (výchozí) nebo 'precip'. Podíl referenční a vlastní chyby
    // omezený na 0,6–1,5, ať jeden šťastný/nešťastný měsíc nepřebije váhy úplně.
    function skillFactor(sk, ref, id, kind, band) {
        var precip = (kind === 'precip');
        var m = precip ? maePOf(sk, id, band) : maeOf(sk, id, band);
        var floor = precip ? 0.02 : 0.05;   // mm/h vs. °C — jinak by dělení šumem utrhlo faktor
        if (!ref || !m || m.n < 3 || ref.ref <= floor) return 1;
        return Math.max(0.6, Math.min(1.5, ref.ref / Math.max(m.e, floor)));
    }

    // ---- kombinování zdrojů (vážený průměr + rozptyl) -----------------------------------
    // Váha zdroje pro SRÁŽKOVÉ veličiny (mm, pravděpodobnost, ikona) — plyne z trefnosti
    // na srážkách. Když ji zdroj nemá (met.no, Bright Sky, nebo zatím žádná historie),
    // použije se běžná váha.
    function wpOf(s, far) {
        var v = far ? s_wpLong(s) : s_wpShort(s);
        if (v != null) return v;
        return (s && s.wp != null) ? s.wp : (s ? s.w : 1);
    }
    function s_wpShort(s) { return (s && s.wpShort != null) ? s.wpShort : null; }
    function s_wpLong(s) { return (s && s.wpLong != null) ? s.wpLong : null; }
    // váha zdroje pro NEsrážkové veličiny, rozlišená podle dosahu předpovědi
    function wOf(s, far) {
        if (!s) return 1;
        var v = far ? s.wLong : s.wShort;
        if (v != null) return v;
        return (s.w != null) ? s.w : 1;
    }

    // ---- nezávislost zdrojů: rodiny modelů ------------------------------------------
    // Vážený průměr dává smysl jen mezi NEZÁVISLÝMI zdroji. ICON-D2, ICON-EU, ICON
    // global a jejich tři ensembly ale nejsou šest názorů — je to jeden model DWD se
    // stejnou asimilací dat, jen v různém rozlišení. Kdyby se počítaly jako nezávislé,
    // mělo by DWD šestinásobný hlas a „Shoda zdrojů" by hlásila falešnou jistotu
    // (sourozenci se pochopitelně shodnou mezi sebou). Proto se počítá DVOUSTUPŇOVĚ:
    // nejdřív průměr UVNITŘ rodiny, pak průměr MEZI rodinami — a rozptyl se bere taky
    // jen mezi rodinami. Váha rodiny = PRŮMĚR vah jejích členů (ne součet, jinak by se
    // početnější rodina zase prosadila objemem).
    // AI modely jsou u své rodiny schválně: AIFS i GraphCast startují z analýzy IFS,
    // resp. GFS, takže s nimi sdílejí počáteční podmínky a nejsou nezávislé.
    var FAMILY = {
        ecmwf_ifs025: 'ecmwf', ecmwf_aifs025: 'ecmwf', ens_ecmwf: 'ecmwf',
        icon_d2: 'icon', icon_eu: 'icon', icon_global: 'icon',
        ens_icond2: 'icon', ens_iconeu: 'icon', ens_icon: 'icon',
        gfs_seamless: 'gfs', gfs_graphcast025: 'gfs', ens_gfs: 'gfs',
        gem_seamless: 'gem', ens_gem: 'gem',
        ukmo_global_deterministic_10km: 'ukmo', ens_ukmo: 'ukmo',
        arpege_europe: 'meteofrance', arpege_world: 'meteofrance',
        knmi_harmonie_arome_europe: 'knmi',      // HARMONIE, ale vlastní asimilace KNMI
        dmi_harmonie_arome_europe: 'dmi',        // totéž u DMI — proto zvlášť
        jma_seamless: 'jma', cma_grapes_global: 'cma', bom_access_global: 'bom',
        metno: 'metno',
        brightsky: 'mosmix',   // statisticky doladěné výstupy na stanicích — jiná povaha než holý model
        chmi: 'chmi'           // měření, stejně stojí samo
    };
    function famOf(s) { return (s && FAMILY[s.id]) || (s && s.id ? ('x_' + s.id) : 'x'); }

    // Zredukuje položky [{v, w, fam}] na JEDEN hlas za rodinu.
    // `circular` = jde o úhly (směr větru), kde se průměruje přes jednotkový kruh.
    function famReduce(items, circular) {
        var g = {}, order = [], i, it, f, q, w, r;
        for (i = 0; i < items.length; i++) {
            it = items[i];
            if (!it || it.v == null || !isFinite(it.v)) continue;
            f = it.fam || ('#' + i);
            if (!g[f]) { g[f] = { s: 0, sx: 0, sy: 0, sw: 0, wsum: 0, n: 0 }; order.push(f); }
            q = g[f]; w = it.w || 1;
            if (circular) { r = it.v * Math.PI / 180; q.sx += w * Math.cos(r); q.sy += w * Math.sin(r); }
            else q.s += it.v * w;
            q.sw += w; q.wsum += w; q.n++;
        }
        var out = [], v;
        for (i = 0; i < order.length; i++) {
            q = g[order[i]];
            if (!q.sw || !q.n) continue;
            if (circular) { v = Math.atan2(q.sy, q.sx) * 180 / Math.PI; v = ((v % 360) + 360) % 360; }
            else v = q.s / q.sw;
            out.push({ v: v, w: q.wsum / q.n, fam: order[i], n: q.n });
        }
        return out;
    }
    function wstat(items) {   // items: [{v, w, fam}] → průměr a rozptyl MEZI RODINAMI
        var fam = famReduce(items, false);
        var sw = 0, s = 0, mn = Infinity, mx = -Infinity, n = 0, nsrc = 0, i, v, w;
        for (i = 0; i < fam.length; i++) {
            v = fam[i].v; w = fam[i].w || 1;
            sw += w; s += v * w; n++; nsrc += fam[i].n;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        if (!n || !sw) return null;
        return { v: s / sw, min: mn, max: mx, n: n, nsrc: nsrc };
    }
    function wv(items) { var r = wstat(items); return r ? r.v : null; }
    // Vážený MEDIÁN mezi rodinami — používá se na SRÁŽKY. Průměr udělá z ostré
    // přeháňky „0,3 mm mrholení všude": stačí, aby jeden model dal 3 mm a devět nic.
    // Medián nechá stát to, na čem se většina rodin shodne, a extrém neutopí ostatní.
    function wmedian(items) {
        var fam = famReduce(items, false);
        if (!fam.length) return null;
        fam.sort(function (a, b) { return a.v - b.v; });
        var tot = 0, acc = 0, i;
        for (i = 0; i < fam.length; i++) tot += (fam[i].w || 1);
        for (i = 0; i < fam.length; i++) {
            acc += (fam[i].w || 1);
            if (acc >= tot / 2) return fam[i].v;
        }
        return fam[fam.length - 1].v;
    }
    function circMean(items) {  // vážený průměr směrů ve stupních (taky přes rodiny)
        var fam = famReduce(items, true);
        if (!fam.length) return null;
        var sx = 0, sy = 0, i, w, r;
        for (i = 0; i < fam.length; i++) {
            w = fam[i].w || 1; r = fam[i].v * Math.PI / 180;
            sx += w * Math.cos(r); sy += w * Math.sin(r);
        }
        var a = Math.atan2(sy, sx) * 180 / Math.PI;
        return ((a % 360) + 360) % 360;
    }

    // ---- výšková korekce teploty -----------------------------------------------------
    // Model počítá s výškou SVÉHO gridu (Open-Meteo ji vrací v `elevation`) — pro Prahu
    // třeba 251 m. Skutečnou výšku bodu má appka z DMR 5G (ČÚZK), stahuje si ho kvůli AR.
    // Rozdíl se přepočte standardním vertikálním gradientem 0,65 °C/100 m: v údolí nebo
    // na svahu jde běžně o 100–200 m, tedy 0,7–1,3 °C systematické chyby — přesně to, co
    // vadí u teploty směsi, rosného bodu i přízemního mrazíku.
    // Strop ±3 °C: při inverzi (zimní údolí) gradient neplatí a bez stropu by korekce
    // napáchala víc škody než užitku; totéž když je DMR vedle (skála, most, chyba buňky).
    var LAPSE_C_PER_M = 0.0065;
    var LAPSE_MAX_DT = 3.0;
    function lapseDT(srcElev, realElev) {
        if (srcElev == null || realElev == null || !isFinite(srcElev) || !isFinite(realElev)) return 0;
        var d = (srcElev - realElev) * LAPSE_C_PER_M;
        return Math.max(-LAPSE_MAX_DT, Math.min(LAPSE_MAX_DT, d));
    }
    // posune všechny teploty jednoho zdroje o jeho vlastní výškový rozdíl
    function applyLapse(src, realElev) {
        var dt = lapseDT(src ? src.elev : null, realElev);
        if (!dt) return 0;
        var i;
        if (src.cur) {
            if (src.cur.t != null) src.cur.t += dt;
            if (src.cur.feels != null) src.cur.feels += dt;
        }
        if (src.hourly && src.hourly.temp) {
            for (i = 0; i < src.hourly.temp.length; i++) {
                if (src.hourly.temp[i] != null && isFinite(src.hourly.temp[i])) src.hourly.temp[i] += dt;
            }
        }
        if (src.daily) {
            ['tmax', 'tmin'].forEach(function (k) {
                var a = src.daily[k];
                if (!a) return;
                for (var q = 0; q < a.length; q++) { if (a[q] != null && isFinite(a[q])) a[q] += dt; }
            });
        }
        src.lapseDT = Math.round(dt * 100) / 100;
        return dt;
    }
    // Kód počasí je kategorie — sečíst a vydělit ho nejde, takže se „průměruje"
    // VÁŽENÝM HLASOVÁNÍM: každý zdroj hlasuje svou vahou pro DRUH počasí (jasno,
    // polojasno, zataženo, déšť, sníh, bouřka…), vyhraje druh s největším součtem
    // vah a v něm kód s největším součtem vah (při rovnosti ten silnější stupeň).
    // Dřív se prostě vzal kód nejváženějšího modelu s berličkou na srážky — jeden
    // model tak mohl přebít shodu všech ostatních.
    // Kód počasí se „průměruje" hlasováním — a i tady platí, že šest sourozenců z
    // rodiny ICON nesmí přehlasovat cizí model. Nejdřív tedy jeden vítězný kód za
    // rodinu (vahou průměru jejích členů), teprve pak hlasování mezi rodinami.
    function combineCode(items) {  // items: [{code, w, fam}]
        var g = {}, order = [], i, it, f;
        for (i = 0; i < items.length; i++) {
            it = items[i];
            if (!it || it.code == null || !isFinite(it.code)) continue;
            f = it.fam || ('#' + i);
            if (!g[f]) { g[f] = []; order.push(f); }
            g[f].push(it);
        }
        var reduced = [];
        for (i = 0; i < order.length; i++) {
            var arr = g[order[i]], code = voteCode(arr), ws = 0;
            if (code == null) continue;
            for (var q = 0; q < arr.length; q++) ws += (arr[q].w || 1);
            reduced.push({ code: code, w: ws / arr.length });
        }
        return voteCode(reduced);
    }
    function voteCode(items) {  // items: [{code, w}]
        var byKind = {}, votes = {}, i, it, k, w;
        for (i = 0; i < items.length; i++) {
            it = items[i];
            if (!it || it.code == null || !isFinite(it.code)) continue;
            k = wmoKind(it.code);
            w = it.w || 1;
            votes[k] = (votes[k] || 0) + w;
            if (!byKind[k]) byKind[k] = [];
            byKind[k].push(it);
        }
        var winner = null, best = -1;
        for (k in votes) { if (votes[k] > best) { best = votes[k]; winner = k; } }
        if (winner == null) return null;
        var sums = {}, arr = byKind[winner];
        for (i = 0; i < arr.length; i++) sums[arr[i].code] = (sums[arr[i].code] || 0) + (arr[i].w || 1);
        var code = null, bs = -1;
        for (k in sums) {
            var c = +k;
            if (sums[k] > bs || (sums[k] === bs && code != null && c > code)) { bs = sums[k]; code = c; }
        }
        return code;
    }
    function srcIdx(s) {   // mapa epoch → index v hourly poli zdroje (lazy)
        if (!s.hourly || !s.hourly.time) return null;
        if (!s._hm) {
            s._hm = {};
            for (var i = 0; i < s.hourly.time.length; i++) s._hm[s.hourly.time[i]] = i;
        }
        return s._hm;
    }

    function combineAll(sources, prevHist, realElev) {
        var data = { off: 0, current: null, hourly: [], daily: [], perSource: [], pressHist: [], isDayNow: true };
        var i, s;

        // časový posun místa (z Open-Meteo; met.no ho nemá → fallback zařízení)
        var off = null;
        for (i = 0; i < sources.length; i++) { if (sources[i].off != null) { off = sources[i].off; break; } }
        if (off == null) off = -new Date().getTimezoneOffset() * 60;
        data.off = off;

        // --- výšková korekce -------------------------------------------------------
        // Výška gridu modelu (Open-Meteo `elevation`) vs. skutečná výška bodu z DMR 5G.
        // Korekce se dělá zdroj po zdroji jeho VLASTNÍM rozdílem — ensembly i ČHMÚ mají
        // výšku jinou než deterministické modely, jeden společný posun by je rozhodil.
        data.elevModel = null;
        for (i = 0; i < sources.length; i++) {
            if (sources[i].elev != null && !sources[i].meas) { data.elevModel = sources[i].elev; break; }
        }
        data.elevReal = (realElev != null && isFinite(realElev)) ? realElev : null;
        if (data.elevReal != null) {
            for (i = 0; i < sources.length; i++) applyLapse(sources[i], data.elevReal);
            data.lapseDT = (data.elevModel != null)
                ? Math.round(lapseDT(data.elevModel, data.elevReal) * 100) / 100 : null;
        } else {
            data.lapseDT = null;
        }
        // pro přepočet tlaku „tady" platí skutečná výška, když ji známe
        data.elev = (data.elevReal != null) ? data.elevReal : data.elevModel;

        // --- aktuální stav ---
        var curS = sources.filter(function (x) { return x.cur; });
        if (curS.length) {
            var items = function (get) {
                return curS.map(function (x) { return { v: get(x.cur), w: wOf(x, false), fam: famOf(x) }; });
            };
            var tSt = wstat(items(function (c) { return c.t; }));
            // Rozptyl („Shoda zdrojů") se počítá JEN z předpovědí — naměřená hodnota
            // z ČHMÚ není další názor, ale skutečnost, a do rozptylu modelů nepatří.
            var fcS = curS.filter(function (x) { return !x.meas; });
            var tSpread = wstat(fcS.map(function (x) { return { v: x.cur.t, w: wOf(x, false), fam: famOf(x) }; }));
            data.current = {
                temp: tSt ? tSt.v : null,
                feels: wv(items(function (c) { return c.feels; })),
                hum: wv(items(function (c) { return c.hum; })),
                precip: wmedian(curS.map(function (x) { return { v: x.cur.precip, w: wpOf(x, false), fam: famOf(x) }; })),
                cloud: wv(items(function (c) { return c.cloud; })),
                pmsl: wv(items(function (c) { return c.pmsl; })),
                wind: wv(items(function (c) { return c.wind; })),
                gusts: wv(items(function (c) { return c.gusts; })),
                dir: circMean(items(function (c) { return c.dir; })),
                code: combineCode(curS.map(function (x) { return { code: x.cur.code, w: wpOf(x, false), fam: famOf(x) }; }))
            };
            data.spreadTemp = tSpread ? { min: tSpread.min, max: tSpread.max, n: tSpread.n, nsrc: tSpread.nsrc } : null;
            var msr = null;
            for (i = 0; i < curS.length; i++) { if (curS[i].meas) { msr = curS[i]; break; } }
            data.measured = msr ? {
                label: msr.station || 'ČHMÚ',
                temp: msr.cur.t,                              // přepočteno na výšku bodu (do průměru)
                raw: (msr.rawT != null ? msr.rawT : null),    // co stanice skutečně naměřila
                stElev: (msr.stElev != null ? msr.stElev : null),
                hum: msr.cur.hum,
                wind: msr.cur.wind, gusts: msr.cur.gusts, precip: msr.cur.precip,
                dist: (msr.distKm != null ? msr.distKm : null), t: (msr.obsT != null ? msr.obsT : null),
                ageMin: (msr.ageMin != null ? msr.ageMin : null)
            } : null;
            data.perSource = curS.map(function (x) {
                return {
                    id: x.id, label: x.label, w: x.w, wp: (x.wp != null ? x.wp : null), temp: x.cur.t,
                    meas: !!x.meas, fam: famOf(x), lapse: (x.lapseDT != null ? x.lapseDT : null),
                    skill: (x.skill != null ? x.skill : null), skillN: (x.skillN || 0), skillSrc: (x.skillSrc || null),
                    skillP: (x.skillP != null ? x.skillP : null), skillPHit: (x.skillPHit != null ? x.skillPHit : null)
                };
            });
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
                var im = [], ix = [], ip = [], iw = [], ic = [], ipp = [], isr = [], iss = [];
                for (var k = 0; k < dayS.length; k++) {
                    s = dayS[k];
                    // najdi index dne se stejným epoch časem (osy se běžně shodují)
                    var di = i;
                    if (s.daily.time[i] !== epoch) {
                        di = -1;
                        for (var q = 0; q < s.daily.time.length; q++) { if (s.daily.time[q] === epoch) { di = q; break; } }
                        if (di < 0) continue;
                    }
                    // denní řady jsou z podstaty „daleko" → váhy pro delší dosah
                    var fm = famOf(s), wd = wOf(s, true), wpd = wpOf(s, true);
                    ix.push({ v: at(s.daily.tmax, di), w: wd, fam: fm });
                    im.push({ v: at(s.daily.tmin, di), w: wd, fam: fm });
                    ip.push({ v: at(s.daily.psum, di), w: wpd, fam: fm });
                    iw.push({ v: at(s.daily.wmax, di), w: wd, fam: fm });
                    ic.push({ code: at(s.daily.code, di), w: wpd, fam: fm });
                    ipp.push({ v: at(s.daily.pprob, di), w: wpd, fam: fm });
                    isr.push({ v: at(s.daily.sunrise, di), w: wd, fam: fm });
                    iss.push({ v: at(s.daily.sunset, di), w: wd, fam: fm });
                }
                // VŠECHNY veličiny váženým průměrem — vítr už ne maximem z modelů
                // (jeden ustřelený model dřív posunul celý den do „silného větru")
                row.tmax = wv(ix); row.tmin = wv(im); row.wmax = wv(iw);
                // MILIMETRY medián (aby se ostrá přeháňka nerozmazala), ale
                // PRAVDĚPODOBNOST průměrem — medián z pravděpodobností nedává smysl:
                // šance na déšť napříč modely je jejich průměr, ne prostřední hodnota.
                // Vedle mediánu se drží i nejhorší varianta (nejdeštivější rodina), ať
                // se riziko neschová jen proto, že většina modelů je suchá.
                row.psum = wmedian(ip);
                row.pprob = wv(ipp);
                var pst = wstat(ip);
                row.psumMax = pst ? pst.max : null;
                var sr = wv(isr), ss = wv(iss);
                row.sunrise = (sr == null ? null : Math.round(sr));
                row.sunset = (ss == null ? null : Math.round(ss));
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
                var it = [], iwd = [], ig = [], ipr = [], icx = [], ipb = [];
                // do 6 h platí váhy pro krátký dosah (tam vede ICON-D2), dál pro dlouhý
                var far = (t - nowSec) > 6 * 3600;
                for (var k2 = 0; k2 < hs.length; k2++) {
                    s = hs[k2];
                    var hm = srcIdx(s);
                    var idx = hm ? hm[t] : null;
                    if (idx == null) continue;
                    var fh = famOf(s), wh = wOf(s, far), wph = wpOf(s, far);
                    it.push({ v: at(s.hourly.temp, idx), w: wh, fam: fh });
                    iwd.push({ v: at(s.hourly.wind, idx), w: wh, fam: fh });
                    ig.push({ v: at(s.hourly.gusts, idx), w: wh, fam: fh });
                    ipr.push({ v: at(s.hourly.precip, idx), w: wph, fam: fh });
                    icx.push({ code: at(s.hourly.code, idx), w: wph, fam: fh });
                    ipb.push({ v: at(s.hourly.prob, idx), w: wph, fam: fh });
                }
                var prSt = wstat(ipr);
                data.hourly.push({
                    t: t,
                    temp: wv(it), wind: wv(iwd), gusts: wv(ig),
                    precip: wmedian(ipr), precipMax: (prSt ? prSt.max : null), prob: wv(ipb),
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
    // ŽÁDNÝ celoplošný překryv — ten dřív mapu zablokoval, takže nešla posunout ani
    // přiblížit a vzdálenější místo vůbec nešlo vybrat. Teď zůstává mapa plně
    // ovladatelná (posun, zoom) a výběr je normální klepnutí: Leafletí 'click' po
    // tahu prstem nevystřelí, takže se posouvání s výběrem neplete. Souřadnice se
    // převádí přes window.agScreenToLatLng (vyruší otočení mapy podle azimutu),
    // fallback je e.latlng.
    function pickOnMap() {
        var m = null; try { m = (typeof map !== 'undefined' && map) ? map : null; } catch (e) {}
        var vm = null; try { vm = viewMode; } catch (e) {}
        if (!m) { alert('Mapa zatím neběží — spusť nejdřív vyhledávání.'); return; }
        if (vm === 'ar') { alert('Přepni na mapu nebo dělené zobrazení, pak vyber místo klepnutím.'); return; }

        // lišta se staví vždy čerstvá, ať jsou posluchače navázané na aktuální handler
        var old = document.getElementById('ag-wx-pick');
        if (old) old.remove();
        var bar = document.createElement('div');
        bar.id = 'ag-wx-pick';
        bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);z-index:100001;'
            + 'bottom:max(18px,env(safe-area-inset-bottom));display:flex;gap:10px;align-items:center;'
            + 'background:rgba(8,11,15,0.88);border:1px solid rgba(255,255,255,0.16);border-radius:999px;'
            + 'padding:10px 14px;color:#fff;font-size:calc(13px * var(--ag-font-scale, 1));white-space:nowrap;box-shadow:0 6px 24px rgba(0,0,0,0.4);';
        bar.innerHTML = '<span>Posuň si mapu a <b>klepni na místo</b></span>'
            + '<button type="button" id="ag-wx-pick-x" style="border:none;border-radius:999px;padding:6px 12px;'
            + 'background:rgba(255,255,255,0.14);color:#fff;font-size:calc(13px * var(--ag-font-scale, 1));cursor:pointer;">Zrušit</button>';
        document.body.appendChild(bar);

        function endPick() {
            try { m.off('click', onMapClick); } catch (e) {}
            bar.remove();
            if (_ui) _ui.classList.add('on');
        }
        function onMapClick(e) {
            var ll = null;
            try {
                if (e.originalEvent && typeof window.agScreenToLatLng === 'function') {
                    ll = window.agScreenToLatLng(e.originalEvent.clientX, e.originalEvent.clientY);
                }
            } catch (err) {}
            if (!ll && e.latlng) ll = e.latlng;
            endPick();
            if (!ll || !isFinite(ll.lat) || !isFinite(ll.lng)) return;
            _place = { name: 'Místo na mapě · ' + ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4), lat: ll.lat, lon: ll.lng };
            var inp = byId('ag-wx-search'); if (inp) inp.value = '';
            hideResults();
            loadWeather(true);
        }
        bar.querySelector('#ag-wx-pick-x').addEventListener('click', endPick);
        if (_ui) _ui.classList.remove('on');    // uhni, ať je vidět mapa
        m.on('click', onMapClick);
    }

    // ---- srážkový radar (RainViewer + mapa Leaflet) --------------------------------------
    // Animace posledních ~70 minut radaru + 30 min nowcast: je vidět, odkud a jak
    // rychle se srážkové mraky ženou. Bez klíče; když RainViewer/Leaflet není, karta
    // se prostě schová.
    // MAPA JE PLNĚ OVLADATELNÁ (posun, přiblížení dvěma prsty, dvojklik, tlačítka +/−) —
    // dřív byla zamčená a nešlo se podívat, co se blíží od západu za hranicí výřezu.
    // Kolečko myši je ZÁMĚRNĚ vypnuté: karta je uvnitř rolovacího přehledu počasí a
    // zoom kolečkem by kradl rolování stránky (na mobilu se stejně používají prsty).
    // Výřez, který si uživatel nastaví, zůstává i po obnovení dat — setView se dělá
    // jen při prvním zobrazení a při změně místa předpovědi.
    function radarCard() { return byId('ag-wx-radar-card'); }
    function hideRadar() { var c = radarCard(); if (c) c.style.display = 'none'; }
    function setupRadar(pack) {
        var c = radarCard(); if (!c) return;
        if (typeof L === 'undefined' || !L.map || !L.tileLayer) { hideRadar(); return; }
        var host = byId('ag-wx-radar'); if (!host) return;
        c.style.display = '';
        try {
            if (!_radar.map) {
                _radar.map = L.map(host, {
                    zoomControl: false, attributionControl: false,
                    dragging: true, touchZoom: true, doubleClickZoom: true, boxZoom: false,
                    scrollWheelZoom: false, keyboard: false,
                    minZoom: 4, maxZoom: 17, zoomSnap: 0.5, inertia: true
                });
                // podkladová mapa je záměrně potlačená (CSS filtr .wx-radar .leaflet-tile-pane),
                // ať jsou srážky čitelné a přesto bylo poznat města a hranice
                // POZOR: BEZ crossOrigin. Hlavní mapa appky načítá tytéž dlaždice bez CORS,
                // takže je service worker uložil jako „opaque" odpovědi. Vrstva s crossOrigin
                // by je z cache dostala taky — a prohlížeč opaque odpověď pro CORS požadavek
                // zahodí → mapa se vykreslila jen tam, kde dlaždice v cache ještě nebyly.
                L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19, className: 'wx-radar-base'
                }).addTo(_radar.map);
                // tlačítko „na moje místo" zvýrazni, jen když je výřez odjetý jinam
                _radar.map.on('zoomend moveend', function () {
                    var b = byId('ag-wx-radar-center');
                    if (b && _radar.center) {
                        var far = _radar.map.getCenter().distanceTo(L.latLng(_radar.center)) > 3000;
                        b.classList.toggle('on', far);
                    }
                });
            }
            var moved = !_radar.center || Math.abs(_radar.center[0] - pack.lat) > 0.002 || Math.abs(_radar.center[1] - pack.lon) > 0.002;
            _radar.center = [pack.lat, pack.lon];
            if (moved) _radar.map.setView(_radar.center, 7);      // jinak nech výřez, jak si ho uživatel nastavil
            if (!_radar.marker) {
                _radar.marker = L.circleMarker(_radar.center, {
                    radius: 6, color: '#fff', weight: 2.5, fillColor: '#2f9e74', fillOpacity: 1
                }).addTo(_radar.map);
            } else _radar.marker.setLatLng(_radar.center);
            // overlay je právě viditelný → mapa si musí přepočítat rozměr
            setTimeout(function () { try { _radar.map.invalidateSize(); } catch (e) {} }, 250);
        } catch (e) { hideRadar(); return; }
        loadRadarFrames();
    }
    function loadRadarFrames() {
        if (!_radar.map) return;
        if (Date.now() - _radar.lastFetch < 5 * 60 * 1000) { startRadarAnim(); return; }   // snímky se obměňují ~po 10 min
        _radar.lastFetch = Date.now();
        fetchJson('https://api.rainviewer.com/public/weather-maps.json', FETCH_MS).then(function (j) {
            var past = (j && j.radar && j.radar.past) ? j.radar.past : [];
            var cast = (j && j.radar && j.radar.nowcast) ? j.radar.nowcast : [];
            var tHost = (j && j.host) ? j.host : 'https://tilecache.rainviewer.com';
            var keepPast = past.slice(-7);
            var frames = keepPast.concat(cast);
            if (!frames.length || !_radar.map) { hideRadar(); return; }
            _radar.layers.forEach(function (l) { try { _radar.map.removeLayer(l); } catch (e) {} });
            _radar.layers = frames.map(function (f) {
                // /512/{z}/{x}/{y}/<schéma barev 4>/<1_1 = vyhlazení + sníh>.png
                // 512px dlaždice = ostřejší obraz na retina displejích než 256px
                // maxNativeZoom: radar má rozlišení ~1 km, takže od z12 výš už nová
                // dlaždice nic nepřidá — Leaflet poslední ostrou úroveň jen roztáhne.
                // Bez toho (dřív maxZoom 11) srážky při větším přiblížení ZMIZELY.
                return L.tileLayer(tHost + f.path + '/512/{z}/{x}/{y}/4/1_1.png', {
                    opacity: 0, maxZoom: 17, maxNativeZoom: 12, tileSize: 512, zoomOffset: -1,
                    className: 'wx-radar-tiles'
                }).addTo(_radar.map);
            });
            _radar.frames = frames;
            _radar.nowIdx = Math.max(0, keepPast.length - 1);
            var seek = byId('ag-wx-radar-seek');
            if (seek) { seek.max = String(frames.length - 1); seek.value = String(_radar.nowIdx); }
            showRadarFrame(_radar.nowIdx);       // start na „teď"
            startRadarAnim();
        }, function () { _radar.lastFetch = 0; if (!_radar.frames.length) hideRadar(); });
    }
    function showRadarFrame(i) {
        if (!_radar.frames.length) return;
        if (i < 0) i = 0;
        if (i > _radar.frames.length - 1) i = _radar.frames.length - 1;
        for (var k = 0; k < _radar.layers.length; k++) _radar.layers[k].setOpacity(k === i ? 0.8 : 0);
        _radar.idx = i;
        var f = _radar.frames[i];
        var seek = byId('ag-wx-radar-seek');
        if (seek && seek.value !== String(i)) seek.value = String(i);
        var lab = byId('ag-wx-radar-lab');
        if (lab && f && f.time) {
            var off = (_cur && _cur.data) ? _cur.data.off : -new Date().getTimezoneOffset() * 60;
            var mins = Math.round((f.time * 1000 - Date.now()) / 60000);
            var rel = (mins >= 2) ? 'za ' + mins + ' min · výhled'
                : (mins <= -2 ? 'před ' + (-mins) + ' min' : 'teď');
            lab.innerHTML = '<b>' + fmtHM(f.time, off) + '</b><span>' + rel + '</span>';
            lab.classList.toggle('future', mins >= 2);
        }
    }
    function startRadarAnim() {
        if (_radar.timer) return;
        _radar.timer = setInterval(function () {
            if (!_open || !_radar.playing || !_radar.frames.length) return;
            // na konci smyčky krátká pauza, ať je vidět, kde animace končí
            var next = (_radar.idx + 1) % _radar.frames.length;
            if (next === 0) { _radar.hold = (_radar.hold || 0) + 1; if (_radar.hold < 3) return; }
            _radar.hold = 0;
            showRadarFrame(next);
        }, 620);
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
                '<button type="button" class="wx-loc" id="ag-wx-refresh" title="Aktualizovat počasí" aria-label="Aktualizovat počasí">' + ICON_REFRESH + '</button>' +
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
                '<div class="wx-card" id="ag-wx-radar-card" style="display:none">' +
                    '<div class="wx-card-h">Srážkový radar</div>' +
                    '<div id="ag-wx-radar" class="wx-radar">' +
                        '<div class="wx-radar-chip" id="ag-wx-radar-lab"></div>' +
                        '<div class="wx-radar-ctrl">' +
                            '<button type="button" id="ag-wx-radar-zin" aria-label="Přiblížit">+</button>' +
                            '<button type="button" id="ag-wx-radar-zout" aria-label="Oddálit">−</button>' +
                            '<button type="button" id="ag-wx-radar-center" title="Zpět na místo předpovědi" aria-label="Vycentrovat na místo předpovědi">⌖</button>' +
                        '</div>' +
                        '<div class="wx-radar-scale" aria-hidden="true">' +
                            '<span class="wx-radar-scale-bar"></span>' +
                            '<span class="wx-radar-scale-lab"><span>slabé</span><span>silné</span></span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="wx-radar-foot">' +
                        '<button type="button" id="ag-wx-radar-play" class="wx-radar-btn" aria-label="Přehrát / pozastavit">⏸</button>' +
                        '<input type="range" id="ag-wx-radar-seek" class="wx-radar-seek" min="0" max="0" step="1" value="0" aria-label="Čas snímku radaru">' +
                    '</div>' +
                    '<div class="wx-radar-sub"><span>−70 min</span><span class="wx-radar-hint">pohyb srážkových mraků — mapou jde hýbat i přibližovat</span><span>+30 min</span></div>' +
                    '<div class="wx-radar-att">Radar: RainViewer · mapa: OpenStreetMap</div>' +
                '</div>' +
                '<div class="wx-card"><div class="wx-card-h">7denní předpověď</div><div id="ag-wx-days"></div></div>' +
                '<div class="wx-grid" id="ag-wx-grid"></div>' +
                '<button type="button" class="wx-foot wx-foot-btn" id="ag-wx-foot-btn"></button>' +
                '<div class="wx-srcpanel" id="ag-wx-srcpanel" style="display:none"></div>' +
            '</div>' +
            '<div id="ag-wx-empty" class="wx-empty" style="display:none"></div>' +
            '<div id="ag-wx-loading" class="wx-load" style="display:none">Načítám předpověď…</div>';
        document.body.appendChild(_ui);

        byId('ag-wx-close').addEventListener('click', close);
        byId('ag-wx-mappick').addEventListener('click', pickOnMap);
        byId('ag-wx-foot-btn').addEventListener('click', function () {
            var p = byId('ag-wx-srcpanel');
            var on = p.style.display === 'none';
            p.style.display = on ? 'block' : 'none';
            renderFootBtn(on);
        });
        byId('ag-wx-radar-play').addEventListener('click', function () {
            _radar.playing = !_radar.playing;
            this.textContent = _radar.playing ? '⏸' : '▶';
        });
        byId('ag-wx-radar-center').addEventListener('click', function () {
            try { if (_radar.map && _radar.center) _radar.map.setView(_radar.center, 7); } catch (e) {}
        });
        byId('ag-wx-radar-zin').addEventListener('click', function () { try { _radar.map.zoomIn(1); } catch (e) {} });
        byId('ag-wx-radar-zout').addEventListener('click', function () { try { _radar.map.zoomOut(1); } catch (e) {} });
        // tažení posuvníku = ruční listování snímky (animace se pozastaví)
        byId('ag-wx-radar-seek').addEventListener('input', function () {
            _radar.playing = false;
            var pb = byId('ag-wx-radar-play'); if (pb) pb.textContent = '▶';
            showRadarFrame(parseInt(this.value, 10) || 0);
        });
        byId('ag-wx-myloc').addEventListener('click', function () {
            _place = null;
            byId('ag-wx-search').value = '';
            hideResults();
            loadWeather(true);
        });
        byId('ag-wx-refresh').addEventListener('click', function () {
            if (_busy) return;             // jedno stahování stačí
            hideResults();
            // ruční aktualizace = opravdu čerstvá data: zahoď i hodinovou paměť
            // ensemblů a nech znovu natáhnout snímky radaru
            try { localStorage.removeItem(LS_ENS); } catch (e) {}
            _radar.lastFetch = 0;
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
    // točící se šipka na tlačítku po dobu stahování — jinak není poznat, že se něco děje
    function setBusy(on) {
        _busy = !!on;
        try {
            var b = byId('ag-wx-refresh');
            if (b) {
                if (on) b.classList.add('wx-spin'); else b.classList.remove('wx-spin');
                b.disabled = !!on;
            }
        } catch (e) {}
    }

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
        // varování schválně vychází i z NEJHORŠÍ varianty (h.precipMax): milimetry se
        // kombinují mediánem, takže menšinová, ale vydatná přeháňka by se v mediánu
        // ztratila — u výstrahy je lepší zbytečně varovat než zmoknout s přístrojem
        var rain = !thunder && (
            next3.some(function (h) {
                return (h.code != null && isPrecipCode(h.code))
                    || (h.prob != null && h.prob >= 55)
                    || (h.precip != null && h.precip >= 0.3)
                    || (h.precipMax != null && h.precipMax >= 1.0);
            })
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

        // --- zdroje: rozbalovací řádek dole (na přání schované, ať nezavazí) ---
        var panel = byId('ag-wx-srcpanel');
        renderFootBtn(panel && panel.style.display !== 'none');
        renderSrcPanel(pack);

        // --- srážkový radar ---
        setupRadar(pack);
    }

    function renderFootBtn(open) {
        var b = byId('ag-wx-foot-btn'); if (!b) return;
        var n = (_cur && _cur.data && _cur.data.perSource) ? _cur.data.perSource.length : 0;
        var upd = _cur ? new Date(_cur.t) : null;
        b.textContent = 'Z čeho předpověď vychází' + (n ? ' · ' + n + ' zdrojů' : '')
            + (upd ? ' · aktualizováno ' + pad2(upd.getHours()) + ':' + pad2(upd.getMinutes()) : '')
            + (open ? '  ▴' : '  ▾');
    }
    function renderSrcPanel(pack) {
        var box = byId('ag-wx-srcpanel'); if (!box) return;
        box.innerHTML = '';
        var ps = (pack.data && pack.data.perSource) ? pack.data.perSource : [];
        if (!ps.length) { box.appendChild(el('div', 'wx-none', 'Seznam zdrojů není k dispozici.')); return; }
        var bf = loadBf();
        var famSet = {}, famN = 0;
        for (var fi = 0; fi < ps.length; fi++) {
            var fk = ps[fi].fam || ps[fi].id;
            if (!famSet[fk]) { famSet[fk] = 1; famN++; }
        }
        var head = 'Vážený průměr ' + ps.length + ' zdrojů, které tvoří ' + famN + ' NEZÁVISLÝCH rodin. '
            + 'Sourozenci z jedné rodiny (ICON-D2, ICON-EU a jejich ensembly jsou pořád jeden model DWD) se nejdřív zprůměrují mezi sebou a teprve pak vstupují do celku jedním hlasem — jinak by měl jeden ústav několikanásobnou váhu a „Shoda zdrojů" by hlásila falešnou jistotu. '
            + '„Trefnost“ = jak blízko byla předpověď tohoto modelu na den dopředu skutečnosti — zvlášť pro TEPLOTU (±°C) a zvlášť pro SRÁŽKY (v kolika % hodin správně řekl prší/neprší)';
        head += bf && bf.days
            ? ', spočítaná z archivu za posledních ' + bf.days + ' dní (skutečnost = reanalýza ERA5). Podle teploty se váží teplota, tlak, vlhkost a vítr; podle srážek milimetry, pravděpodobnost deště a ikona počasí. Appka se dál doučuje i za provozu.'
            : ' — dohledává se z archivu za poslední měsíc, mezitím se učí za provozu.';
        box.appendChild(el('div', 'wx-src-h', head));
        // měření napřed, pak předpovědi podle váhy
        var sorted = ps.slice().sort(function (a, b) {
            if (!!a.meas !== !!b.meas) return a.meas ? -1 : 1;
            return (b.w || 0) - (a.w || 0);
        });
        for (var i = 0; i < sorted.length; i++) {
            var s = sorted[i];
            var row = el('div', 'wx-src' + (s.meas ? ' wx-src-meas' : ''));
            var txt = s.label + ' · váha ' + nf(s.w, 2);
            if (s.meas) {
                txt += ' · MĚŘENÍ, ne předpověď';
            } else {
                if (s.skill != null) txt += ' · teplota ±' + nf(s.skill, 1) + ' °C';
                if (s.skillPHit != null) txt += ' · déšť ' + nf(s.skillPHit * 100, 0) + ' %';
                else if (s.skillP != null) txt += ' · déšť ±' + nf(s.skillP, 2) + ' mm/h';
                if (s.skill == null && s.skillP == null) txt += ' · trefnost zatím neznámá';
                else if (s.skillSrc) txt += ' (' + s.skillSrc + ')';
            }
            row.appendChild(el('span', 'wx-src-n', txt));
            row.appendChild(el('span', 'wx-src-v', s.temp != null ? nf(s.temp, 1) + ' °C' : '–'));
            box.appendChild(row);
        }
        box.appendChild(el('div', 'wx-src-h', 'U zdrojů se „ensemble" počítá průměr ze všech běhů toho modelu (ECMWF 51, ICON-D2 20 …) — bývá přesnější než jediný běh. U SRÁŽEK se místo průměru bere medián, aby se ostrá přeháňka nerozmazala na mrholení, a z ensemblů navíc vychází poctivá pravděpodobnost deště (v kolika procentech běhů prší). Váhy se počítají zvlášť pro dosah do 6 hodin a zvlášť dál — ICON-D2 je špička nakrátko, ECMWF na delší dobu. Ensembly se stahují nejvýš jednou za hodinu, ať nepálí mobilní data.'));
        var cvN = 0;
        try { cvN = loadSkill().chmiVerified || 0; } catch (e) { cvN = 0; }
        if (cvN) {
            box.appendChild(el('div', 'wx-src-h',
                'Trefnost je z části ověřená proti SKUTEČNÉMU měření ČHMÚ (' + cvN + ' srovnání), ne jen proti průměru modelů — model, který se drží u davu, tím pádem dobrou známku zadarmo nedostane.'));
        }
        box.appendChild(el('div', 'wx-src-h', 'Data: Open-Meteo (předpovědi, ensembly, archiv ERA5) · MET Norway · Bright Sky (DWD) · ČHMÚ (opendata.chmi.cz, © ČHMÚ) · radar RainViewer · mapa OpenStreetMap'));
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
            // pravděpodobnost I množství — ať je vidět, kolik mm má reálně spadnout
            var pParts = [];
            if (h.prob != null && h.prob >= 10) pParts.push(nf(Math.round(h.prob), 0) + ' %');
            if (h.precip != null && h.precip >= 0.1) pParts.push(nf(h.precip, 1) + ' mm');
            it.appendChild(el('div', 'wx-h-p', pParts.join(' ')));
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
            var dParts = [];
            if (d.pprob != null && d.pprob >= 10) dParts.push(nf(Math.round(d.pprob), 0) + ' %');
            if (d.psum != null && d.psum >= 0.1) dParts.push(nf(d.psum, 1) + ' mm');
            row.appendChild(el('div', 'wx-d-p', dParts.join(' ')));
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

        // Naměřeno ČHMÚ — jediná hodnota na obrazovce, která není předpověď, ale
        // skutečné měření z profesionální stanice. Dává smysl jen v Česku.
        var ms = data.measured;
        if (ms && (ms.raw != null || ms.temp != null)) {
            var tm = tile(box, 'Naměřeno ČHMÚ', true);
            var mShow = (ms.raw != null) ? ms.raw : ms.temp;
            var mRow = el('div');
            mRow.appendChild(el('span', 'wx-tile-big', nf(mShow, 1)));
            mRow.appendChild(el('span', 'wx-tile-un', '°C'));
            tm.appendChild(mRow);
            var mSub = [];
            if (ms.label) mSub.push('stanice ' + ms.label);
            if (ms.stElev != null) mSub.push(nf(Math.round(ms.stElev), 0) + ' m n. m.');
            if (ms.dist != null) mSub.push(nf(ms.dist, 1) + ' km');
            if (ms.t != null) {
                mSub.push(fmtHM(ms.t, off) + (ms.ageMin != null && ms.ageMin >= 5 ? ' (před ' + nf(ms.ageMin, 0) + ' min)' : ''));
            }
            if (ms.hum != null) mSub.push('vlhkost ' + nf(Math.round(ms.hum), 0) + ' %');
            if (ms.wind != null) mSub.push('vítr ' + nf(ms.wind, 1) + ' m/s');
            tm.appendChild(el('div', 'wx-tile-sub', mSub.join(' · ')));
            // když je stanice v jiné výšce než bod, ať je vidět i přepočet
            if (ms.raw != null && ms.temp != null && Math.abs(ms.temp - ms.raw) >= 0.15 && data.elevReal != null) {
                tm.appendChild(el('div', 'wx-tile-sub',
                    'Přepočteno na tvou výšku ' + nf(Math.round(data.elevReal), 0) + ' m n. m.: '
                    + nf(ms.temp, 1) + ' °C — a tahle hodnota jde do celkového průměru.'));
            }
            tm.appendChild(el('div', 'wx-tile-sub',
                'Skutečně naměřeno, ne předpověď. ČHMÚ data zveřejňuje se zhruba hodinovým zpožděním, '
                + 'takže čím starší měření, tím menší váhu v celkovém odhadu dostane.'));
        }

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

        // Tlak — hlavní hodnota přepočtená do nadmořské výšky místa, moře jen doplňkově
        var hasElev = (data.elev != null && isFinite(data.elev) && data.elev >= 1);
        var tp = tile(box, hasElev ? 'Tlak zde (' + nf(Math.round(data.elev), 0) + ' m n. m.)' : 'Tlak');
        var pLoc = hasElev ? fromMsl(c.pmsl, data.elev, c.temp) : c.pmsl;
        var pRow = el('div');
        pRow.appendChild(el('span', 'wx-tile-big', pLoc != null ? nf(Math.round(pLoc), 0) : '–'));
        pRow.appendChild(el('span', 'wx-tile-un', 'hPa'));
        tp.appendChild(pRow);
        var tr = pressTrend(data.pressHist);
        var pSub = [];
        if (tr) pSub.push(tr.arrow + ' ' + tr.txt);
        if (hasElev && c.pmsl != null) pSub.push('na moři ' + nf(Math.round(c.pmsl), 0) + ' hPa');
        else if (!hasElev) pSub.push('hladina moře');
        tp.appendChild(el('div', 'wx-tile-sub', pSub.join(' · ')));

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
        var sSub = [];
        if (d0 && d0.pprob != null) sSub.push('pravděpodobnost ' + nf(Math.round(d0.pprob), 0) + ' %');
        // když se modely rozcházejí, ať je vidět i ta deštivější varianta
        if (d0 && d0.psumMax != null && d0.psum != null && d0.psumMax - d0.psum >= 1) {
            sSub.push('některé modely až ' + nf(d0.psumMax, 1) + ' mm');
        }
        ts.appendChild(el('div', 'wx-tile-sub', sSub.join(' · ')));

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
        // výšková korekce — ať je vidět, že se s čísly něco stalo, a proč
        if (data.elevReal != null && data.lapseDT != null && Math.abs(data.lapseDT) >= 0.1) {
            tq.appendChild(el('div', 'wx-tile-sub',
                'Teploty jsou opravené o výšku: model počítá s ' + nf(Math.round(data.elevModel), 0)
                + ' m n. m., tady je podle DMR 5G ' + nf(Math.round(data.elevReal), 0) + ' m — posun '
                + (data.lapseDT > 0 ? '+' : '') + nf(data.lapseDT, 1) + ' °C.'));
        }
        // spolehlivost podle historie: jak se modely trefovaly za poslední měsíc
        if (data.skillInfo && data.skillInfo.ref != null) {
            var dTxt = data.skillInfo.days ? ('za posledních ' + data.skillInfo.days + ' dní') : 'podle dosavadní historie';
            var sTxt = 'Trefnost ' + dTxt + ': teplota na den dopředu sedí v průměru na ±'
                + nf(data.skillInfo.ref, 1) + ' °C (' + data.skillInfo.models + ' modelů)';
            if (data.skillInfoP && data.skillInfoP.hit != null) {
                sTxt += ', déšť/bez deště modely trefly v ' + nf(data.skillInfoP.hit * 100, 0) + ' % hodin';
            }
            sTxt += '. Trefnějším roste váha zvlášť pro teplotu a zvlášť pro srážky; detail zdrojů je dole.';
            tq.appendChild(el('div', 'wx-tile-sub', sTxt));
        } else {
            tq.appendChild(el('div', 'wx-tile-sub', 'Trefnost modelů (teplota i srážky) se právě dohledává z archivu za poslední měsíc — ukáže se do minuty (potřebuje internet).'));
        }
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
        setBusy(true);
        var pOm = fetchJson(omUrl(pos.lat, pos.lon), FETCH_MS).then(parseOm, function () { return []; });
        var pMet = fetchJson(metnoUrl(pos.lat, pos.lon), FETCH_MS).then(
            function (j) { var s = parseMetno(j); return s ? [s] : []; },
            function () { return []; }    // met.no smí selhat (CORS/síť) — celek jede dál
        );
        var pBs = fetchJson(brightskyUrl(pos.lat, pos.lon), FETCH_MS).then(
            function (j) { var s = parseBrightsky(j); return s ? [s] : []; },
            function () { return []; }    // Bright Sky smí selhat — celek jede dál
        );
        // ensembly: z paměti, pokud jsou čerstvé (do hodiny), jinak stáhnout
        var ensCached = loadEnsCache(pos.lat, pos.lon);
        var pEns = ensCached
            ? Promise.resolve(ensCached)
            : fetchJson(ensUrl(pos.lat, pos.lon), ENS_MS).then(
                function (j) {
                    var a = parseEns(j);
                    if (a.length) saveEnsCache(pos.lat, pos.lon, a);
                    return a;
                },
                function () { return []; }   // ensembly smí selhat — celek jede dál
            );
        // ČHMÚ jen v Česku a jen když je známá adresa workeru
        var cu = inCz(pos.lat, pos.lon) ? chmiUrl(pos.lat, pos.lon) : null;
        var pChmi = cu
            ? fetchJson(cu, FETCH_MS).then(
                function (j) { var s = parseChmi(j); return s ? [s] : []; },
                function () { return []; }   // route na workeru chybí / offline → tiše dál
            )
            : Promise.resolve([]);
        // skutečná výška bodu z DMR 5G (ČÚZK) — kvůli výškové korekci teplot.
        // Modul dmr-terrain.js nemusí být načtený (odpojitelná vrstva) → pak prostě null.
        var pElev = Promise.resolve(null);
        try {
            if (typeof window.terrainElevAsync === 'function') {
                pElev = window.terrainElevAsync(pos.lat, pos.lon).then(
                    function (v) { return (typeof v === 'number' && isFinite(v)) ? v : null; },
                    function () { return null; }
                );
            }
        } catch (e) { pElev = Promise.resolve(null); }
        Promise.all([pOm, pMet, pBs, pEns, pChmi, pElev]).then(function (rr) {
            if (seq !== _reqSeq) return;   // mezitím přišel novější požadavek (ten si spinner zhasne sám)
            setBusy(false);
            var sources = rr[0].concat(rr[1]).concat(rr[2]).concat(rr[3]).concat(rr[4]);
            if (!sources.length) {
                // úplné selhání → poslední data + štítek offline
                _offline = true;
                if (cacheFallback) { _cur = cacheFallback; renderAll(cacheFallback, false); }
                else if (_cur) renderAll(_cur, false);
                else showEmpty('Předpověď se nepodařilo stáhnout (jsi offline?) a v paměti nejsou žádná starší data pro toto místo.');
                return;
            }
            // trefnost podle historie (okno 1 měsíc): uprav váhy PŘED kombinací.
            // `w` podle teploty, `wp` podle srážek — model dobrý na teplotu nemusí
            // být dobrý na déšť, takže se každá skupina veličin váží po svém.
            var sk = loadSkill();
            var refS = skillRef(sk, 'temp', 's'), refL = skillRef(sk, 'temp', 'l');
            var refPS = skillRef(sk, 'precip', 's'), refPL = skillRef(sk, 'precip', 'l');
            sources.forEach(function (s) {
                var base = s.w;
                // ČHMÚ nic nepředpovídá — nemá tedy ani trefnost a váhu si drží
                if (s.meas) {
                    s.wp = base; s.wShort = base; s.wLong = base; s.wpShort = base; s.wpLong = base;
                    return;
                }
                // zobrazovaná trefnost = dlouhý dosah (předpověď na den dopředu)
                var m = maeOf(sk, s.id, 'l'), mp = maePOf(sk, s.id, 'l');
                s.skill = (m && m.n >= 3) ? Math.round(m.e * 10) / 10 : null;
                s.skillN = (m ? m.n : 0);
                s.skillSrc = (m ? m.src : null);
                s.skillP = (mp && mp.n >= 3) ? Math.round(mp.e * 1000) / 1000 : null;
                s.skillPHit = (mp && mp.n >= 3 && mp.hit != null) ? mp.hit : null;
                var mS = maeOf(sk, s.id, 's');
                s.skillShort = (mS && mS.n >= 3) ? Math.round(mS.e * 10) / 10 : null;
                s.wShort = base * skillFactor(sk, refS, s.id, 'temp', 's');
                s.wLong = base * skillFactor(sk, refL, s.id, 'temp', 'l');
                s.wpShort = base * skillFactor(sk, refPS, s.id, 'precip', 's');
                s.wpLong = base * skillFactor(sk, refPL, s.id, 'precip', 'l');
                s.w = s.wLong;      // pro zobrazení v seznamu zdrojů
                s.wp = s.wpLong;
            });
            var prevHist = (cacheFallback && cacheFallback.data && cacheFallback.data.pressHist) ? cacheFallback.data.pressHist : [];
            if (rr[5] != null && isFinite(rr[5])) _lastElevReal = rr[5];
            var data;
            try { data = combineAll(sources, prevHist, rr[5]); }
            catch (e) {
                _offline = true;
                if (cacheFallback) { _cur = cacheFallback; renderAll(cacheFallback, false); }
                return;
            }
            delete data.isDayAt;
            // srovnej dřívější předpovědi s právě pozorovaným stavem a ulož nové predikce
            try {
                // „skutečnost" pro vyhodnocení předpovědí: nejdřív měření ČHMÚ,
                // teprve když není, poslouží kombinovaný odhad ze všech modelů
                var msFresh = (data.measured && data.measured.ageMin != null && data.measured.ageMin <= CHMI_SKILL_MIN)
                    ? data.measured : null;
                var obsT = (msFresh && msFresh.temp != null) ? msFresh.temp
                    : (data.current ? data.current.temp : null);
                var obsP = (msFresh && msFresh.precip != null) ? msFresh.precip
                    : (data.current ? data.current.precip : null);
                var sk2 = updateSkill(sources, obsT, obsP);
                var ref2 = skillRef(sk2, 'temp', 'l'), refP2 = skillRef(sk2, 'precip', 'l');
                var bf2 = loadBf();
                if (ref2) data.skillInfo = { ref: Math.round(ref2.ref * 10) / 10, models: ref2.models, days: (bf2 ? bf2.days : 0) };
                if (refP2) {
                    data.skillInfoP = {
                        ref: Math.round(refP2.ref * 1000) / 1000, models: refP2.models,
                        hit: (refP2.hit != null ? refP2.hit : null)
                    };
                }
            } catch (e) {}
            // měsíc historie z archivu (jednou týdně, na pozadí — ať nebrzdí vykreslení)
            setTimeout(function () { try { maybeBackfill(pos.lat, pos.lon); } catch (e) {} }, 1500);
            // a jednou za pár hodin srovnání starších předpovědí se skutečností z ČHMÚ
            setTimeout(function () { try { maybeChmiVerify(pos.lat, pos.lon); } catch (e) {} }, 3000);
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
        if (_radar.timer) { try { clearInterval(_radar.timer); } catch (e) {} _radar.timer = null; }
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
