// ===== QTRIG — DOMŮ: „kde dnes měříš?" nad živou mapou (ODPOJITELNÁ) =====
// Spodní panel nad běžící appkou: výběr zakázky (počet bodů, kdy naposledy, vzdálenost;
// zakázka u tebe nahoře), nová zakázka, poznámka, počasí s tlakem u tebe, rychlé akce.
// Ukazuje se ráno a po pauze > 3 h; jinak nabídka „Jsi u zakázky X — přepnout?".
// Styly: css/domov.css. Odstranění: smaž js/domov.js + css/domov.css + řádky v index.html.
(function () {
    'use strict';
    if (window.AGDomov) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'domov:' + kde); } catch (e2) { /* nic */ } };

    var KEY = 'agDomov_v1';                // { auto: bool, rezim: 'chytre'|'vzdy' }
    var KEY_WX = 'agDomovWx_v1';           // { t, day, lat, lng, data }
    var KEY_ZAK = 'agDomovZak_v1';         // { <id>: { n, last, lat, lng, r } }
    var KEY_AKT = 'agDomovAkt_v1';         // { den, ts } — kdy se Domů ukázal / kdy appka naposledy běžela
    var KEY_POZN = 'agPoznamkyZakazky';    // per zakázka (<id>_agPoznamkyZakazky)
    var WX_MAX_AGE = 30 * 60000;
    var PAUZA_MS = 3 * 3600000;            // chytré ukazování: po pauze delší než 3 h
    var BLIZKO_M = 150;                    // „jsi u zakázky": do 150 m od okraje jejích bodů
    var ID = 'ag-domov';
    var st = { auto: true, rezim: 'vzdy' };
    try {
        var s0 = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (s0 && typeof s0.auto === 'boolean') st.auto = s0.auto;
        if (s0 && (s0.rezim === 'vzdy' || s0.rezim === 'chytre')) st.rezim = s0.rezim;
        // ⚠ JEDNORÁZOVĚ ZNOVU ZAPNOUT (13. 11. 2026): kdo si starý Domů (v418–v420, stránka přes
        //   celou obrazovku při KAŽDÉM startu) vypnul, protože překážel, ten předělaný (výběr
        //   zakázky, jen ráno a po pauze) nikdy neuviděl — a hlásil „vůbec nevidím úvodní
        //   obrazovku". Starý zápis nemá `v`; vypnutí v novém Domů (v:2) se už respektuje.
        //   V automatizovaném prohlížeči (testy si Domů vypínají starým zápisem) se nemigruje.
        if (s0 && !s0.v && s0.auto === false && !navigator.webdriver) { st.auto = true; st.v = 2; localStorage.setItem(KEY, JSON.stringify(st)); }
        // ⚠ v3 (14. 11. 2026): výchozí je ukazovat při KAŽDÉM spuštění (ne při návratu z pozadí).
        //   „Chytře" (ráno a po pauze > 3 h) zůstává volbou v Nastavení. Kdo měl uložené staré
        //   výchozí 'chytre' (v:2 — nikdo si ho nevybral, zapsalo se samo), přejde na 'vzdy'.
        if (s0 && (s0.v || 0) < 3 && st.rezim === 'chytre' && !navigator.webdriver) { st.rezim = 'vzdy'; st.v = 3; localStorage.setItem(KEY, JSON.stringify(st)); }
    } catch (e) { swallow(e, 'load'); }
    function uloz() { st.v = 3; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }

    var _otevrenoTs = 0;
    var root = null, _tik = null, _poznTmr = null, _ukazanoStart = false, _dotek = false, _vse = false;

    // ---- pomocné ------------------------------------------------------------------------------
    function T(cs, o) { var v = cs; try { if (window.AGJazyk && AGJazyk.t) v = AGJazyk.t(cs); } catch (e) { v = cs; } return o ? String(v).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }) : v; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function ikona(id) { return '<svg class="icon" aria-hidden="true"><use href="#' + id + '"/></svg>'; }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function dnes() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function loc() { try { return (window.AGJazyk && AGJazyk.locale) ? AGJazyk.locale() : 'cs-CZ'; } catch (e) { return 'cs-CZ'; } }
    function cislo(n, d) { return String(Number(n).toFixed(d == null ? 0 : d)).replace('.', ','); }
    function toast(m) { try { if (window.AG && AG.toast) AG.toast(m); else if (typeof quickToast === 'function') quickToast(m); } catch (e) { swallow(e, 'toast'); } }
    function jednoduchy() { try { return !!(window.AGJednoduchy && AGJednoduchy.zapnuto()) || localStorage.getItem('agJednoduchy_v1') === '1'; } catch (e) { return false; } }
    function pid() { try { return (typeof activeProjectId !== 'undefined' && activeProjectId) || localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function body() { try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; } catch (e) { return []; } }
    function poloha() {
        try { if (typeof userLat !== 'undefined' && userLat) return { lat: userLat, lng: userLng, gps: true }; } catch (e) { /* nic */ }
        try { var p = JSON.parse(localStorage.getItem('arLastPos')); if (p && p.lat != null) return { lat: +p.lat, lng: +p.lng, gps: false }; } catch (e) { /* nic */ }
        return null;
    }
    function jmeno() {
        try { var u = window.AGUcty && AGUcty.currentUser && AGUcty.currentUser(); if (u && u.name) return String(u.name).split(' ')[0]; } catch (e) { swallow(e, 'jmeno'); }
        return '';
    }
    function pozdrav() {
        var h = new Date().getHours();
        return h < 5 ? T('Dobrý večer') : h < 10 ? T('Dobré ráno') : h < 18 ? T('Dobrý den') : T('Dobrý večer');
    }
    function vzd(a, b) {
        var k = Math.PI / 180, x = (b.lng - a.lng) * k * Math.cos((a.lat + b.lat) / 2 * k), y = (b.lat - a.lat) * k;
        return Math.sqrt(x * x + y * y) * 6371000;
    }
    function vzdText(m) { return m < 1000 ? T('{m} m od tebe', { m: Math.max(10, Math.round(m / 10) * 10) }) : T('{km} km od tebe', { km: cislo(m / 1000, m < 10000 ? 1 : 0) }); }
    function kdyText(ts) {
        if (!ts) return '';
        var d = new Date(ts), n = new Date();
        var den = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
        var dd = Math.round((den(n) - den(d)) / 86400000);
        if (dd === 0) return T('dnes {t}', { t: pad2(d.getHours()) + ':' + pad2(d.getMinutes()) });
        if (dd === 1) return T('včera');
        if (dd < 7) return T('před {n} dny', { n: dd });
        return d.getDate() + '. ' + (d.getMonth() + 1) + '.' + (d.getFullYear() !== n.getFullYear() ? ' ' + d.getFullYear() : '');
    }
    function bodu(n) { return n === 1 ? T('1 bod') : (n >= 2 && n <= 4) ? T('{n} body', { n: n }) : T('{n} bodů', { n: n }); }
    // nástroj z odloženého modulu: když ještě není načtený, načíst a pak spustit
    function spust(fnName, src, args) {
        zavri();
        var f = window[fnName];
        if (typeof f === 'function') { try { f.apply(null, args || []); } catch (e) { swallow(e, fnName); } return; }
        if (src && window.AGLazy && AGLazy.need) {
            try { AGLazy.need(src, function () { var g = window[fnName]; if (typeof g === 'function') { try { g.apply(null, args || []); } catch (e) { swallow(e, fnName); } } }); } catch (e) { swallow(e, 'need'); }
        }
    }

    // ---- ZAKÁZKY ----------------------------------------------------------------------------------
    // seznam, který smí vidět přihlášený (firemní oprávnění) — stejně jako js/zmenit-zakazku.js
    function zakazky() {
        var u = window.AGUcty;
        try { if (u && u.allowedProjects) { var a = u.allowedProjects(u.currentUser ? u.currentUser() : null); if (Array.isArray(a) && a.length) return a; } } catch (e) { swallow(e, 'list'); }
        try { if (typeof projects !== 'undefined' && Array.isArray(projects) && projects.length) return projects; } catch (e) { swallow(e, 'list2'); }
        try { var l = JSON.parse(localStorage.getItem('arProjectsList')); if (Array.isArray(l) && l.length) return l; } catch (e) { /* nic */ }
        return [{ id: 'default', name: 'Výchozí zakázka' }];
    }
    function nazev(p) { return (p && p.name) ? (p.id === 'default' && p.name === 'Výchozí zakázka' ? T('Výchozí zakázka') : p.name) : T('Zakázka'); }
    function meta() { try { var o = JSON.parse(localStorage.getItem(KEY_ZAK)); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    function souhrn(pts) {
        var n = 0, la = 0, ln = 0, last = 0, ok = [];
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i]; if (!p) continue;
            n++;
            var t = +(p.mts || (p.prov && p.prov.ts) || 0); if (t > last) last = t;
            if (isFinite(p.lat) && isFinite(p.lng) && p.lat && p.lng) { la += +p.lat; ln += +p.lng; ok.push(p); }
        }
        var o = { n: n, last: last };
        if (ok.length) {
            o.lat = la / ok.length; o.lng = ln / ok.length;
            var r = 0;
            for (var j = 0; j < ok.length; j++) { var d = vzd(o, ok[j]); if (d > r) r = d; }
            o.r = Math.min(r, 5000);
        }
        return o;
    }
    function ulozMeta(id, o) {
        var m = meta(); var p = m[id] || {};
        m[id] = { n: o.n, last: Math.max(o.last || 0, p.otevreno || 0), otevreno: p.otevreno || 0, lat: o.lat, lng: o.lng, r: o.r };
        try { localStorage.setItem(KEY_ZAK, JSON.stringify(m)); } catch (e) { swallow(e, 'meta'); }
    }
    function oznacOtevreno(id) {
        var m = meta(); m[id] = m[id] || {}; m[id].otevreno = Date.now();
        try { localStorage.setItem(KEY_ZAK, JSON.stringify(m)); } catch (e) { swallow(e, 'otevreno'); }
    }
    function ctiBody(id) {
        if (id === pid()) return Promise.resolve(body());
        var fk = id + '_arCustomPoints12';
        var z = function (raw) { try { var a = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(a) ? a : []; } catch (e) { return []; } };
        var ls = function () { try { return z(localStorage.getItem(fk)); } catch (e) { return []; } };
        try {
            if (typeof _idbGet === 'function') return Promise.resolve(_idbGet(fk)).then(function (v) { return v != null ? z(v) : ls(); }, ls);
        } catch (e) { swallow(e, 'idb'); }
        return Promise.resolve(ls());
    }
    var _indexBezi = null;
    function indexuj() {
        if (_indexBezi) return _indexBezi;
        var ls = zakazky();
        _indexBezi = Promise.all(ls.map(function (p) {
            return ctiBody(p.id).then(function (pts) { ulozMeta(p.id, souhrn(pts)); }, function () { /* nic */ });
        })).then(function () { _indexBezi = null; }, function () { _indexBezi = null; });
        return _indexBezi;
    }
    // zakázky s tím, co o nich víme, a s vzdáleností od tebe (okraj bodů, ne střed)
    function seznam() {
        var m = meta(), ja = poloha(), cur = pid();
        var b = body(), akt = souhrn(b);
        return zakazky().map(function (p) {
            var x = p.id === cur ? akt : (m[p.id] || {});
            var o = { id: p.id, nazev: nazev(p), n: x.n, last: Math.max(x.last || 0, (m[p.id] || {}).otevreno || 0), akt: p.id === cur, d: null };
            if (ja && x.lat != null && isFinite(x.lat)) o.d = Math.max(0, vzd(ja, x) - (x.r || 0));
            return o;
        });
    }
    // Co nabídnout nahoře: zakázku, u které stojíš (když to není ta otevřená), jinak otevřenou.
    function rozdel(ls) {
        var akt = null, blizko = null;
        ls.forEach(function (z) {
            if (z.akt) akt = z;
            if (z.d != null && z.d <= BLIZKO_M && (!blizko || z.d < blizko.d)) blizko = z;
        });
        var hl = akt || ls[0];
        var uTebe = false;
        if (blizko && (!akt || akt.d == null || akt.d > BLIZKO_M) && blizko !== akt) { hl = blizko; uTebe = true; }
        else if (akt && akt.d != null && akt.d <= BLIZKO_M) uTebe = true;
        var ost = ls.filter(function (z) { return z !== hl; });
        ost.sort(function (a, b) {
            var ab = a.d != null && a.d < 1000, bb = b.d != null && b.d < 1000;
            if (ab !== bb) return ab ? -1 : 1;
            if (ab && bb) return a.d - b.d;
            if (a.akt !== b.akt) return a.akt ? -1 : 1;
            return (b.last || 0) - (a.last || 0) || String(a.nazev).localeCompare(String(b.nazev));
        });
        return { hl: hl, uTebe: uTebe, ost: ost };
    }
    function prepni(id) {
        if (!id || id === pid()) return true;
        try {
            var u = window.AGUcty;
            if (u && u.applyProject) { u.applyProject(id); return true; }
            if (typeof window.changeProjectFromSettings === 'function') {
                var sel = document.getElementById('s-project-select');
                if (sel) { sel.value = id; window.changeProjectFromSettings(); return true; }
            }
            if (typeof changeProject === 'function') {
                var s2 = document.getElementById('s-project-select') || document.getElementById('w-project-select');
                if (s2) { s2.value = id; changeProject(); return true; }
            }
        } catch (e) { swallow(e, 'prepni'); }
        return false;
    }
    // vybrat zakázku a jít měřit
    function vyber(id) {
        ulozPoznamku();
        var z = null; seznam().forEach(function (x) { if (x.id === id) z = x; });
        var zmena = id && id !== pid();
        prepni(id);
        oznacOtevreno(id || pid());
        zavri();
        if (zmena && z) toast(T('Zakázka: {z}', { z: z.nazev }));
    }
    function zalozit(jm) {
        jm = String(jm || '').trim();
        if (!jm) return false;
        if (typeof createNewProject !== 'function') return false;
        // createNewProject() se ptá dialogem agPrompt — jméno už máme, tak mu ho podstrčíme
        var orig = window.agPrompt;
        window.agPrompt = function () { return Promise.resolve(jm); };
        try { createNewProject(); } catch (e) { swallow(e, 'nova'); } finally { window.agPrompt = orig; }
        setTimeout(function () { oznacOtevreno(pid()); }, 50);
        zavri();
        toast(T('Nová zakázka: {z}', { z: jm }));
        return true;
    }

    // ---- poznámka k zakázce -------------------------------------------------------------------------
    var _poznId = null;
    function ctiPozn(id) {
        try {
            if (id === pid() && typeof getStoredData === 'function') return getStoredData(KEY_POZN) || '';
            return localStorage.getItem(id + '_' + KEY_POZN) || '';
        } catch (e) { return ''; }
    }
    function ulozPoznamku() {
        if (!root || !_poznId) return;
        clearTimeout(_poznTmr); _poznTmr = null;
        var ta = root.querySelector('#agd-pozn'); if (!ta) return;
        var v = ta.value;
        try {
            if (_poznId === pid() && typeof setStoredData === 'function') setStoredData(KEY_POZN, v);
            else localStorage.setItem(_poznId + '_' + KEY_POZN, v);
            var s = root.querySelector('#agd-pozn-st'); if (s) s.textContent = v ? T('Uloženo k zakázce.') : '';
        } catch (e) { swallow(e, 'poznSave'); }
    }

    // ---- POČASÍ ---------------------------------------------------------------------------------
    var WMO = { 0: 'Jasno', 1: 'Skoro jasno', 2: 'Polojasno', 3: 'Zataženo', 45: 'Mlha', 48: 'Mlha s námrazou', 51: 'Mrholení', 53: 'Mrholení', 55: 'Silné mrholení', 56: 'Mrznoucí mrholení', 57: 'Mrznoucí mrholení',
        61: 'Slabý déšť', 63: 'Déšť', 65: 'Silný déšť', 66: 'Mrznoucí déšť', 67: 'Mrznoucí déšť', 71: 'Slabé sněžení', 73: 'Sněžení', 75: 'Silné sněžení', 77: 'Sněhová zrna',
        80: 'Přeháňky', 81: 'Přeháňky', 82: 'Silné přeháňky', 85: 'Sněhové přeháňky', 86: 'Sněhové přeháňky', 95: 'Bouřka', 96: 'Bouřka s kroupami', 99: 'Bouřka s kroupami' };
    // ikona počasí (vlastní tahy — ve sprite appky je jen slunce a měsíc)
    var SVG = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    var MRAK = '<path d="M15 35h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 21a7 7 0 0 0 1 14z"/>';
    function wxIkona(kod, noc) {
        var k = +kod;
        if (k <= 1) return SVG + (noc ? '<path d="M33 31A13 13 0 0 1 19 13a13 13 0 1 0 14 18z"/>' : '<circle cx="24" cy="24" r="8"/><path d="M24 6v4M24 38v4M6 24h4M38 24h4M11.3 11.3l2.8 2.8M33.9 33.9l2.8 2.8M11.3 36.7l2.8-2.8M33.9 14.1l2.8-2.8"/>') + '</svg>';
        if (k === 2) return SVG + '<path d="M17 13a8 8 0 0 1 13.7 4.3" /><path d="M17 6v3M8.5 9.5l2 2M5 18h3"/>' + '<path d="M16 38h18a7 7 0 0 0 1-13.9A10 10 0 0 0 16 25a6.5 6.5 0 0 0 0 13z"/></svg>';
        if (k === 45 || k === 48) return SVG + '<path d="M8 20h32M6 27h36M10 34h28"/></svg>';
        if (k >= 71 && k <= 77 || k === 85 || k === 86) return SVG + MRAK + '<path d="M18 41h.01M24 43h.01M30 41h.01"/></svg>';
        if (k >= 95) return SVG + MRAK + '<path d="M25 37l-4 6h6l-4 5"/></svg>';
        if (k >= 51) return SVG + MRAK + '<path d="M18 39l-2 5M25 39l-2 5M32 39l-2 5"/></svg>';
        return SVG + MRAK + '</svg>';
    }
    function wxCache() { try { return JSON.parse(localStorage.getItem(KEY_WX)); } catch (e) { return null; } }
    function nactiPocasi() {
        var p = poloha(), c = wxCache();
        var cerstva = c && c.data && (Date.now() - c.t < WX_MAX_AGE) && c.day === dnes() && (!p || (Math.abs(c.lat - p.lat) < 0.05 && Math.abs(c.lng - p.lng) < 0.07));
        if (cerstva) return Promise.resolve({ w: c.data, stale: false });
        if (!p || navigator.onLine === false) return Promise.resolve(c && c.data ? { w: c.data, stale: true, when: c.t } : null);
        var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.lat.toFixed(3) + '&longitude=' + p.lng.toFixed(3)
            + '&current=temperature_2m,weather_code,wind_speed_10m,pressure_msl,surface_pressure,is_day'
            + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset'
            + '&hourly=precipitation&forecast_days=1&timezone=auto&wind_speed_unit=ms';
        return Promise.race([
            fetch(url).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 8000); })
        ]).then(function (j) {
            if (!j || !j.daily) throw new Error('bad');
            try { localStorage.setItem(KEY_WX, JSON.stringify({ t: Date.now(), day: dnes(), lat: p.lat, lng: p.lng, data: j })); } catch (e) { swallow(e, 'wxSave'); }
            return { w: j, stale: false };
        })['catch'](function () { var c2 = wxCache(); return c2 && c2.data ? { w: c2.data, stale: true, when: c2.t } : null; });
    }
    // ---- TLAK PŘEPOČTENÝ NA VÝŠKU (5. 11. 2026) ----
    // Open-Meteo dává tlak redukovaný na hladinu moře (QNH) — pro atmosférickou korekci dálkoměru
    // je potřeba tlak V MÍSTĚ. Barometrická rovnice (gradient 0,0065 K/m, teplota z předpovědi):
    //   p = p₀ · (1 − 0,0065·h / (T + 0,0065·h + 273,15))^5,257
    // Výška: z GPS (elipsoidická − kvazigeoid → Bpv), jinak výška terénu z Open-Meteo (DEM 90 m).
    function vyskaMista(w) {
        try {
            var f = window.AGFix;
            if (f && f.alt != null && isFinite(f.alt) && (Date.now() - f.ts) < 10 * 60000 && !f.manual) {
                var N = (typeof getGeoidUndulation === 'function') ? getGeoidUndulation(f.lat, f.lng) : 45;
                var h = f.alt - N;
                if (h > -450 && h < 9000) return { h: h, zdroj: 'GPS' };
            }
        } catch (e) { swallow(e, 'vyska'); }
        if (w && w.elevation != null && isFinite(w.elevation)) return { h: +w.elevation, zdroj: T('terén') };
        return null;
    }
    function tlakVeVysce(pMsl, h, t) {
        if (!isFinite(pMsl) || !isFinite(h)) return null;
        var T0 = isFinite(t) ? t : 15;
        return pMsl * Math.pow(1 - 0.0065 * h / (T0 + 0.0065 * h + 273.15), 5.257);
    }
    function tlak(w) {
        var c = (w && w.current) || {};
        if (c.pressure_msl == null || !isFinite(c.pressure_msl)) return null;
        var v = vyskaMista(w), o = { msl: Math.round(c.pressure_msl) };
        if (v) { var p = tlakVeVysce(c.pressure_msl, v.h, c.temperature_2m); if (p) { o.mist = Math.round(p); o.h = Math.round(v.h); o.zdroj = v.zdroj; } }
        return o;
    }
    function hm(iso) { var m = /T(\d{2}):(\d{2})/.exec(String(iso || '')); return m ? m[1] + ':' + m[2] : ''; }
    function destHodiny(h) {
        if (!h || !Array.isArray(h.precipitation)) return '';
        var v = h.precipitation, out = [], od = null;
        for (var i = 0; i <= v.length && i < 25; i++) {
            var mokro = i < v.length && v[i] != null && v[i] > 0.15;
            if (mokro && od == null) od = i;
            if (!mokro && od != null) { out.push(od + '–' + i + ' h'); od = null; }
        }
        return out.slice(0, 3).join(', ');
    }
    function vykresliPocasi(res) {
        var box = root && root.querySelector('#agd-wx'); if (!box) return;
        if (!res || !res.w || !res.w.daily) {
            box.innerHTML = '<div class="agd-wx-nic">' + esc(T(poloha() ? 'Počasí se teď nepodařilo stáhnout.' : 'Počasí ukážu, až bude známá poloha.')) + '</div>';
            return;
        }
        var w = res.w, d = w.daily, c = w.current || {};
        var kod = c.weather_code != null ? c.weather_code : (d.weather_code ? d.weather_code[0] : null);
        var teplota = c.temperature_2m != null ? Math.round(c.temperature_2m) : (d.temperature_2m_max ? Math.round(d.temperature_2m_max[0]) : null);
        var srazky = d.precipitation_sum ? d.precipitation_sum[0] : 0, pst = d.precipitation_probability_max ? d.precipitation_probability_max[0] : null;
        var hod = srazky > 0.1 ? destHodiny(w.hourly) : '';
        var dest = srazky > 0.1 ? (hod ? T('déšť {h}', { h: hod }) : T('Déšť {mm} mm', { mm: cislo(srazky, 1) })) : T('bez deště');
        var svetlo = '', zbyva = '';
        if (d.sunset) {
            var m = /T(\d{2}):(\d{2})/.exec(d.sunset[0]);
            if (m) {
                var n = new Date(), min = (+m[1] * 60 + +m[2]) - (n.getHours() * 60 + n.getMinutes());
                svetlo = min > 0 ? T('světlo do {t}', { t: m[1] + ':' + m[2] }) : T('po setmění');
                if (min > 0) zbyva = Math.floor(min / 60) + ':' + pad2(min % 60);
            }
        }
        var tl = tlak(w);
        var sub = [dest, svetlo].filter(Boolean).join(' · ');
        var det = [];
        if (d.temperature_2m_min && d.temperature_2m_max) det.push([T('Dnes'), T('{a} až {b} °C', { a: Math.round(d.temperature_2m_min[0]), b: Math.round(d.temperature_2m_max[0]) })]);
        if (srazky > 0.1) det.push([T('Srážky'), T('Déšť {mm} mm', { mm: cislo(srazky, 1) }) + (hod ? ' — ' + hod : '') + (pst != null ? ' (' + Math.round(pst) + ' %)' : '')]);
        if (d.wind_speed_10m_max) det.push([T('Vítr'), T('do {v} m/s', { v: Math.round(d.wind_speed_10m_max[0]) }) + (d.wind_gusts_10m_max ? ', ' + T('nárazy {v} m/s', { v: Math.round(d.wind_gusts_10m_max[0]) }) : '')]);
        if (d.sunrise && d.sunset) det.push([T('Slunce'), T('Slunce {a}–{b}', { a: hm(d.sunrise[0]), b: hm(d.sunset[0]) }).replace(/^\S+\s/, '') + (zbyva ? ' · ' + T('světla zbývá {t} h', { t: zbyva }) : '')]);
        if (tl) det.push([T('Tlak'), T('Tlak {p} hPa (moře)', { p: tl.msl }).replace(/^\S+\s/, '') + (tl.mist ? ' · ' + T('u tebe {p} hPa ({h} m n. m., {z})', { p: tl.mist, h: tl.h, z: tl.zdroj }) : '')]);
        var noc = c.is_day === 0;
        box.innerHTML = '<div class="agd-wx-ico">' + wxIkona(kod, noc) + '</div>'
            + '<div class="agd-wx-tx"><div class="agd-wx-l1"><b>' + (teplota != null ? teplota + '°' : '–') + '</b><span>' + esc(T(WMO[kod] || '')) + '</span></div>'
            + '<div class="agd-wx-l2">' + esc(sub) + '</div></div>'
            + (tl && tl.mist ? '<div class="agd-wx-p"><b>' + tl.mist + '</b><span>' + esc(T('hPa u tebe')) + '</span></div>' : (tl ? '<div class="agd-wx-p"><b>' + tl.msl + '</b><span>hPa</span></div>' : ''))
            + '<div class="agd-wx-det">' + det.map(function (r) { return '<span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b>'; }).join('')
            + '<button type="button" class="agd-wx-cele" data-agd="pocasi">' + esc(T('Celé počasí a radar')) + ' ›</button>'
            + '<button type="button" class="agd-wx-cele" data-agd="brifink">' + esc(T('Celý den v terénu (GNSS, monitoring) ›')) + '</button></div>'
            + (res.stale ? '<div class="agd-wx-off">' + esc(T('bez signálu — předpověď z {t}', { t: new Date(res.when).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) })) + '</div>' : '');
    }
    var _wx = { bezi: false, ok: false, pokus: 0, mel: false };
    function nactiWx() {
        if (_wx.bezi) return;
        if (!_wx.ok) { var c = wxCache(); if (c && c.data && c.data.daily) vykresliPocasi({ w: c.data, stale: true, when: c.t }); }
        _wx.bezi = true; _wx.pokus = Date.now(); _wx.mel = !!poloha();
        nactiPocasi().then(function (r) {
            _wx.bezi = false;
            if (r && r.w && r.w.daily) { _wx.ok = !r.stale; vykresliPocasi(r); }
            else if (!_wx.ok && !wxCache()) vykresliPocasi(null);
        }, function () { _wx.bezi = false; if (!_wx.ok && !wxCache()) vykresliPocasi(null); });
    }

    // ---- vzhled ---------------------------------------------------------------------------------
    // Styly jsou v css/domov.css (<link> v index.html) — mimo JS kvůli rozpočtu startu
    // (scripts/check_start_budget.py). Tady jen pojistka, kdyby <link> chyběl.
    function styly() {
        if (document.getElementById('ag-domov-style') || document.querySelector('link[href*="css/domov.css"]')) return;
        var l = document.createElement('link'); l.id = 'ag-domov-style'; l.rel = 'stylesheet'; l.href = 'css/domov.css';
        document.head.appendChild(l);
    }

    function postav() {
        if (root) return root;
        styly();
        root = document.createElement('div');
        root.id = ID;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', T('Domů'));
        root.setAttribute('data-no-swipe', '');
        var akceB = function (a, ic, t, id) { return '<button type="button" class="agd-a" data-agd="' + a + '"' + (id ? ' id="' + id + '"' : '') + '>' + ikona(ic) + '<span>' + esc(T(t)) + '</span></button>'; };
        root.innerHTML = '<div class="agd-nad" id="agd-nad"><div class="agd-nad-in">'
            + '<div class="agd-hlava"><div><small id="agd-datum"></small><h1 id="agd-pozdrav"></h1></div>'
            + '<button type="button" class="agd-x" data-agd="jit" aria-label="' + esc(T('Rovnou měřit')) + '">' + ikona('i-x') + '</button></div>'
            + '<div class="agd-sklo agd-wx" id="agd-wx" role="button" tabindex="0" aria-label="' + esc(T('Počasí dnes')) + '"><div class="agd-wx-nic">' + esc(T('Načítám počasí…')) + '</div></div>'
            + '</div>'
            + '<button type="button" class="agd-mapa-tip" data-agd="jit">' + ikona('i-camera') + esc(T('Klepni na mapu a měř v otevřené zakázce')) + '</button>'
            + '</div>'
            + '<section class="agd-panel" id="agd-panel">'
            + '<div class="agd-prubeh" id="agd-prubeh"><b id="agd-prubeh-b"></b></div>'
            + '<div class="agd-ucho" id="agd-ucho"><i></i></div>'
            + '<div class="agd-scroll"><div class="agd-in">'
            + '<div class="agd-otazka"><h2>' + esc(T('Kde dnes měříš?')) + '</h2><span id="agd-pocet"></span></div>'
            + '<div class="agd-hl" id="agd-hl"></div>'
            + '<div class="agd-sez" id="agd-sez"></div>'
            + '<div class="agd-akce">'
            + akceB('poslat', 'i-share', 'Poslat zakázku') + akceB('nacist', 'i-download', 'Načíst zakázku')
            + akceB('qr', 'i-grid', 'Body přes QR') + akceB('skenovat', 'i-camera', 'Načíst QR')
            + akceB('offline', 'i-map-download', 'Mapa offline') + akceB('slunce', 'i-sun', 'Na slunci', 'agd-outdoor')
            + akceB('jednoduchy', 'i-walk', 'Jednoduchý režim') + akceB('nastaveni', 'i-settings', 'Nastavení')
            + '</div>'
            + '<div class="agd-stav" id="agd-stav"></div>'
            + '<label class="agd-pata"><input type="checkbox" id="agd-auto"> <span>' + esc(T('Ukazovat po spuštění appky')) + '</span></label>'
            + '<span id="agd-prubeh-t" hidden></span>'
            + '</div></div></section>';
        document.body.appendChild(root);

        root.addEventListener('click', function (e) {
            var t = e.target && e.target.closest ? e.target.closest('[data-agd],[data-zak]') : null;
            // klepnutí do prázdné plochy nad panelem (na mapu) = jít měřit
            // klepnutí do prázdna v první půlvteřině = dotyk ze spuštění appky, ne „jít měřit"
            if (!t && Date.now() - _otevrenoTs < 600) return;
            if (!t) { if (e.target === root || e.target.id === 'agd-nad' || (e.target.classList && e.target.classList.contains('agd-nad-in'))) { _dotek = true; vyber(pid()); } return; }
            _dotek = true;
            if (t.hasAttribute('data-zak')) { vyber(t.getAttribute('data-zak')); return; }
            akce(t.getAttribute('data-agd'), t);
        });
        root.querySelector('#agd-wx').addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('[data-agd]')) return;
            this.classList.toggle('rozb');
        });
        root.addEventListener('input', function (e) {
            if (e.target.id !== 'agd-pozn') return;
            var s = root.querySelector('#agd-pozn-st'); if (s) s.textContent = '';
            clearTimeout(_poznTmr); _poznTmr = setTimeout(ulozPoznamku, 600);
        });
        // ⚠ po psaní poznámky NEPŘESTAVOVAT kartu: blur přijde při stisku jiného tlačítka a posunutý
        //   panel by klepnutí poslal jinam (naměřeno: „Na slunci" se nepřeplo). Jen se uloží.
        root.addEventListener('focusout', function (e) { if (e.target.id === 'agd-pozn') ulozPoznamku(); });
        root.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'agd-nova-in') { e.preventDefault(); zalozit(e.target.value); } });
        root.querySelector('#agd-auto').addEventListener('change', function () { st.auto = this.checked; uloz(); synchronizujNastaveni(); });
        tahPanelu();
        return root;
    }
    // stažení panelu dolů za ucho = jít měřit
    function tahPanelu() {
        var p = root.querySelector('#agd-panel'), u = root.querySelector('#agd-ucho');
        var y0 = null, dy = 0;
        u.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; p.classList.add('tah'); try { u.setPointerCapture(e.pointerId); } catch (er) { /* nic */ } });
        u.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); p.style.transform = 'translateY(' + dy + 'px)'; });
        var konec = function () {
            if (y0 == null) return;
            y0 = null; p.classList.remove('tah'); p.style.transform = '';
            if (dy > 90) { _dotek = true; vyber(pid()); }
        };
        u.addEventListener('pointerup', konec); u.addEventListener('pointercancel', konec);
    }

    function otevriNastaveni() {
        try { if (typeof window.openSettings === 'function') window.openSettings(); else document.getElementById('settings-modal').style.display = 'flex'; } catch (e) { swallow(e, 'nastaveni'); }
        setTimeout(vlozVstupy, 50);
    }
    function akce(a, el) {
        switch (a) {
            case 'jit': vyber(pid()); break;
            case 'pocasi': spust('agOpenPocasi', 'js/pocasi.js'); break;
            case 'brifink': spust('agOpenBrifink', 'js/brifink.js'); break;
            case 'pozn': otevriPoznamku(); break;
            case 'nova-otevri': {
                var f = root.querySelector('#agd-nova'); f.classList.add('on');
                var inp = root.querySelector('#agd-nova-in'); if (inp) { try { inp.focus(); } catch (e) { /* nic */ } }
                break;
            }
            case 'nova': zalozit((root.querySelector('#agd-nova-in') || {}).value); break;
            case 'vse': _vse = true; vykresliZakazky(); break;
            case 'zmenit':
                if (typeof window.agOpenZmenitZakazku === 'function') spust('agOpenZmenitZakazku');
                else { zavri(); otevriNastaveni(); }
                break;
            case 'poslat': case 'nacist': spust('agOpenJobTransfer', 'js/job-transfer.js'); break;
            case 'qr': spust('openShareQR', 'js/sdileni.js'); break;
            case 'skenovat': spust('openScanQR', 'js/sdileni.js'); break;
            case 'slunce': nastavVzhled({ outdoor: !vis('outdoorMode') }); break;
            case 'jednoduchy':
                zavri();
                try { if (window.AGJednoduchy) AGJednoduchy.zapni(); } catch (e) { swallow(e, 'jednoduchy'); }
                break;
            case 'offline':
                try {
                    if (navigator.onLine === false) { toast(T('Bez signálu se mapa stáhnout nedá.')); break; }
                    var mv = window.AGMapaVektor;
                    if (mv && mv.okoliUloz && mv.stav && mv.stav() === 'zapnuto') {
                        toast(T('Ukládám mapu okolí do telefonu…'));
                        mv.okoliUloz().then(function (r) {
                            if (r && r.ok + r.chybi > 0) toast(T('Mapa okolí je v telefonu.'));
                            else if (localStorage.getItem('agMapaOkoli_v1')) toast(T('Mapa okolí už v telefonu je.'));
                            vykresliStav();
                        });
                    } else if (typeof saveForOffline === 'function') { zavri(); saveForOffline(); }
                } catch (e) { swallow(e, 'offline'); }
                break;
            case 'nastaveni': zavri(); otevriNastaveni(); break;
        }
    }

    // ---- vzhled: venkovní režim přímo do visSettings (jako Nastavení) --------------------------------
    function vis(k) { try { return (typeof visSettings !== 'undefined' && visSettings) ? visSettings[k] : undefined; } catch (e) { return undefined; } }
    function nastavVzhled(o) {
        try {
            if (typeof visSettings === 'undefined' || !visSettings) return;
            if (o.mode) {
                visSettings.mode = o.mode;
                var sel = document.getElementById('v-mode'); if (sel) sel.value = o.mode;
                if (typeof previewMode === 'function') previewMode(o.mode);
            }
            if (typeof o.outdoor === 'boolean') { visSettings.outdoorMode = o.outdoor; var cb = document.getElementById('s-outdoor'); if (cb) cb.checked = o.outdoor; }
            if (o.fs) {
                var f = Math.round(((visSettings.fontScale || 1) + o.fs * 0.1) * 10) / 10;
                visSettings.fontScale = Math.max(0.8, Math.min(1.6, f));
                var fsEl = document.getElementById('v-font-scale'); if (fsEl) fsEl.value = Math.round(visSettings.fontScale * 100);
            }
            if (typeof setStoredData === 'function') setStoredData('arVisSettings12', JSON.stringify(visSettings));
            if (typeof applyVisualSettings === 'function') applyVisualSettings();
            if (typeof o.outdoor === 'boolean') toast(T(o.outdoor ? 'Vysoký kontrast na slunci zapnut' : 'Vysoký kontrast vypnut'));
        } catch (e) { swallow(e, 'vzhled'); }
        vykresliNastaveni();
    }
    function vykresliNastaveni() {
        if (!root) return;
        var ob = root.querySelector('#agd-outdoor'); if (ob) ob.classList.toggle('on', !!vis('outdoorMode'));
        root.querySelector('#agd-auto').checked = st.auto;
    }

    // ---- vykreslení zakázek -------------------------------------------------------------------------
    function metaText(z) {
        var c = [];
        c.push(z.n ? bodu(z.n) : (z.n === 0 ? T('zatím bez bodů') : ''));
        if (z.last) c.push(kdyText(z.last));
        return c.filter(Boolean).join(' · ');
    }
    function otevriPoznamku() {
        var w = root.querySelector('#agd-pozn-w'); if (!w) return;
        w.hidden = false;
        var b = root.querySelector('#agd-pozn-btn'); if (b) b.hidden = true;
        var ta = root.querySelector('#agd-pozn'); if (ta) { try { ta.focus(); } catch (e) { /* nic */ } }
    }
    var _hlId = null;
    function vykresliZakazky() {
        if (!root) return;
        var aktivni = document.activeElement;
        if (aktivni && root.contains(aktivni) && (aktivni.id === 'agd-pozn' || aktivni.id === 'agd-nova-in')) return;   // nepřepisovat pod prsty
        var ls = seznam(), r = rozdel(ls), hl = r.hl;
        _hlId = hl.id;
        root.querySelector('#agd-pocet').textContent = ls.length > 1 ? T('{n} zakázek', { n: ls.length }) : '';
        // hlavní karta
        var tag = r.uTebe ? ikona('i-map-pin') + esc(T('Jsi u této zakázky')) : (hl.akt ? ikona('i-folder') + esc(T('Naposledy otevřená')) : ikona('i-folder') + esc(T('Zakázka')));
        var m = metaText(hl);
        if (hl.d != null && !r.uTebe) m += (m ? ' · ' : '') + vzdText(hl.d);
        _poznId = hl.id;
        var pz = ctiPozn(hl.id);
        root.querySelector('#agd-hl').innerHTML = '<span class="agd-hl-tag">' + tag + '</span>'
            + '<div class="agd-hl-n" id="agd-zak">' + esc(hl.nazev) + '</div>'
            + '<div class="agd-hl-m" id="agd-zak-sub">' + esc(m || T('zatím bez bodů')) + '</div>'
            + '<button type="button" class="agd-pozn-b' + (pz ? ' ma' : ' prazdna') + '" id="agd-pozn-btn" data-agd="pozn">' + ikona('i-edit') + '<span>' + esc(pz || T('Poznámka k zakázce — kód od brány, kontakt, co dnes udělat')) + '</span></button>'
            + '<div id="agd-pozn-w" hidden><textarea id="agd-pozn" rows="3" placeholder="' + esc(T('Co dnes udělat, kód od brány, telefon na stavbyvedoucího…')) + '">' + esc(pz) + '</textarea><div class="agd-ulozeno" id="agd-pozn-st"></div></div>'
            + '<button type="button" class="agd-jit" id="agd-jit" data-zak="' + esc(hl.id) + '">' + ikona('i-camera') + esc(T(hl.akt ? 'Měřit' : 'Otevřít a měřit')) + '</button>';
        // ostatní
        var MAX = 4, ost = r.ost, vidim = _vse ? ost : ost.slice(0, MAX);
        var h = vidim.map(function (z) {
            var bl = z.d != null && z.d <= BLIZKO_M;
            var d = z.d == null ? '' : (bl ? T('tady') : (z.d < 1000 ? Math.max(10, Math.round(z.d / 10) * 10) + ' m' : cislo(z.d / 1000, z.d < 10000 ? 1 : 0) + ' km'));
            return '<button type="button" class="agd-z" data-zak="' + esc(z.id) + '"><span class="agd-z-i">' + ikona('i-folder') + '</span>'
                + '<span class="agd-z-t"><b>' + esc(z.nazev) + '</b><small>' + esc((z.akt ? T('otevřená') + (metaText(z) ? ' · ' : '') : '') + (metaText(z) || T('zatím bez bodů'))) + '</small></span>'
                + (d ? '<span class="agd-z-d' + (bl ? ' blizko' : '') + '">' + esc(d) + '</span>' : '') + '</button>';
        }).join('');
        h += '<button type="button" class="agd-z agd-z-nova" data-agd="nova-otevri"><span class="agd-z-i">' + ikona('i-plus') + '</span><span class="agd-z-t"><b>' + esc(T('Nová zakázka')) + '</b><small>' + esc(T('nové místo, čistý seznam bodů')) + '</small></span></button>'
            + '<div class="agd-nova" id="agd-nova"><input type="text" id="agd-nova-in" autocomplete="off" enterkeyhint="go" placeholder="' + esc(T('Název — lokalita, parcela nebo číslo zakázky')) + '">'
            + '<button type="button" data-agd="nova">' + esc(T('Založit a měřit')) + '</button></div>';
        var sez = root.querySelector('#agd-sez');
        var novaOtevrena = !!root.querySelector('#agd-nova.on');
        sez.innerHTML = h;
        if (novaOtevrena) root.querySelector('#agd-nova').classList.add('on');
        if (!_vse && ost.length > MAX) {
            var v = document.createElement('button'); v.type = 'button'; v.className = 'agd-vse'; v.setAttribute('data-agd', 'vse');
            v.textContent = T('Všechny zakázky ({n})', { n: ls.length });
            sez.appendChild(v);
        }
    }

    // ---- stav ---------------------------------------------------------------------------------------
    function pred(ts) {
        if (!ts) return '';
        var d = (Date.now() - ts) / 60000;
        if (d < 60) return T('před {n} min', { n: Math.max(1, Math.round(d)) });
        if (d < 48 * 60) return T('před {n} h', { n: Math.round(d / 60) });
        return T('před {n} dny', { n: Math.round(d / 1440) });
    }
    var _stavHtml = '';
    function vykresliStav() {
        var r = [];
        try {
            if (typeof userLat !== 'undefined' && userLat && typeof currentGpsAccuracy === 'number' && currentGpsAccuracy > 0) {
                var a = currentGpsAccuracy;
                r.push([a <= 5 ? 'ok' : 'poz', 'GPS ± ' + cislo(a, a < 10 ? 1 : 0) + ' m']);
            } else r.push(['poz', T('GPS hledá polohu…')]);
        } catch (e) { swallow(e, 'gps'); }
        var ok = null;
        try { ok = JSON.parse(localStorage.getItem('agMapaOkoli_v1') || 'null'); } catch (e) { ok = null; }
        r.push(ok && ok.ts ? ['ok', T('mapa offline {kdy}', { kdy: pred(ok.ts) })] : ['', T('mapa offline se uloží se signálem')]);
        var zal = 0;
        ['agLastBackupTs', 'arLastBackupAt', 'agLastBackup'].forEach(function (k) { try { var v = +localStorage.getItem(k); if (!isFinite(v)) v = Date.parse(localStorage.getItem(k)) || 0; if (v > zal) zal = v; } catch (e) { /* nic */ } });
        var zalStare = !zal || (Date.now() - zal) > 7 * 86400000;
        r.push([zalStare ? 'poz' : 'ok', zal ? T('záloha {kdy}', { kdy: pred(zal) }) : T('záloha zatím žádná')]);
        try {
            if (window.AGFronta && AGFronta.stav) { var f = AGFronta.stav(); if (f && f.ceka) r.push(['poz', T('{n} čeká na signál', { n: f.ceka })]); }
        } catch (e) { swallow(e, 'fronta'); }
        try { if (window.AGCloudSync && AGCloudSync.enabled()) r.push(['ok', T('sdílení s firmou')]); } catch (e) { swallow(e, 'cloud'); }
        var html = r.map(function (x) { return '<span><i class="' + x[0] + '"></i>' + esc(x[1]) + '</span>'; }).join('');
        if (html !== _stavHtml) { root.querySelector('#agd-stav').innerHTML = html; _stavHtml = html; }
    }
    // průběh nabíhání odložených modulů (js/lazy-load.js) — tenká linka nahoře na panelu
    var _celkem = 0;
    function vykresliPrubeh() {
        var t = root.querySelector('#agd-prubeh-t'), b = root.querySelector('#agd-prubeh-b'), box = root.querySelector('#agd-prubeh');
        var L = window.AGLazy;
        var zbyva = (L && L.pending) ? L.pending().length : 0;
        if (zbyva > _celkem) _celkem = zbyva;
        var hotovo = !L || !L.pending || (L.hotovo && L.hotovo()) || !zbyva;
        t.textContent = hotovo ? T('Vše připraveno') : T('Připravuji nástroje…');
        b.style.width = (hotovo ? 100 : (_celkem ? Math.round(100 * (1 - zbyva / _celkem)) : 5)) + '%';
        box.classList.toggle('hotovo', !!hotovo);
    }
    var _tikN = 0;
    function tik() {
        if (!root || !root.classList.contains('on')) return;
        _tikN++;
        try { vykresliStav(); vykresliPrubeh(); } catch (e) { swallow(e, 'tik'); }
        // poloha se během prvních vteřin zpřesňuje → vzdálenosti a „jsi u zakázky" (dokud se nesáhlo)
        try { if (!_dotek && _tikN % 3 === 0) vykresliZakazky(); } catch (e) { swallow(e, 'tikZak'); }
        // počasí ještě není čerstvé → po příchodu polohy / každých 20 s zkusit znovu
        try { if (!_wx.ok && !_wx.bezi && poloha() && navigator.onLine !== false && (!_wx.mel || Date.now() - _wx.pokus > 20000)) nactiWx(); } catch (e) { swallow(e, 'tikWx'); }
    }

    // ---- otevřít / zavřít ---------------------------------------------------------------------------
    function obnov() {
        if (!root) return;
        var j = jmeno();
        root.querySelector('#agd-pozdrav').textContent = pozdrav() + (j ? ', ' + j : '');
        var d = new Date().toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long' });
        root.querySelector('#agd-datum').textContent = d;
        _dotek = false; _vse = false;
        try { var jb = root.querySelector('[data-agd="jednoduchy"]'); if (jb) jb.hidden = !window.AGJednoduchy; } catch (e) { swallow(e, 'jb'); }
        vykresliZakazky(); vykresliNastaveni(); vykresliStav(); vykresliPrubeh();
        indexuj().then(function () { if (otevreno() && !_dotek) vykresliZakazky(); });
        nactiWx();
    }
    function otevri() {
        if (jednoduchy()) return false;
        postav();
        skryjTip();
        root.classList.add('on');
        document.body.classList.add('ag-domov-on');
        obnov();
        _otevrenoTs = Date.now();
        if (!_tik) _tik = setInterval(tik, 1000);
        // ⚠ ŽÁDNÉ AGLazy.flush() (13. 11. 2026): v zabaleném vydání je odložených modulů ~8 MB
        //   (obfuskace) a naráz to slabší telefon zpracovává vteřiny — appka „strašně dlouho
        //   nabíhá". Moduly dál jedou po dávkách v nečinnosti (js/lazy-load.js), změřeno ~6 s.
        // ranní brífink dnes sám neotvírat — počasí je tady
        try { localStorage.setItem('agBrifinkLastShown', dnes()); } catch (e) { swallow(e, 'brifink'); }
        zapisAkt(true);
        return true;
    }
    function zavri() {
        if (!root) return;
        if (_poznTmr) ulozPoznamku();
        root.classList.remove('on');
        document.body.classList.remove('ag-domov-on');
        if (_tik) { clearInterval(_tik); _tik = null; }
        try { document.dispatchEvent(new CustomEvent('ag:domov-zavreno')); } catch (e) { swallow(e, 'evt'); }
    }
    function otevreno() { return !!(root && root.classList.contains('on')); }

    // ---- kdy se ukázat (chytře: ráno a po pauze) -------------------------------------------------------
    function akt() { try { var o = JSON.parse(localStorage.getItem(KEY_AKT)); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    function zapisAkt(ukazano) {
        var o = akt(); o.ts = Date.now(); if (ukazano) o.den = dnes();
        try { localStorage.setItem(KEY_AKT, JSON.stringify(o)); } catch (e) { swallow(e, 'akt'); }
    }
    function maSeUkazat() {
        if (st.rezim === 'vzdy') return true;
        var o = akt();
        if (o.den !== dnes()) return true;                         // první spuštění dne
        if (!o.ts || Date.now() - o.ts > PAUZA_MS) return true;   // po pauze
        return false;
    }
    // appka běží → průběžně si značit čas (při zavření / uspání), ať „pauza" znamená skutečnou pauzu
    document.addEventListener('visibilitychange', function () { if (document.hidden) zapisAkt(false); });
    window.addEventListener('pagehide', function () { zapisAkt(false); });

    // ---- „Jsi u zakázky X" — když Domů neběží a GPS ukáže jinou zakázku, než je otevřená ----------------
    var _tipHotovo = false, _tipT = null;
    function skryjTip() { var t = document.getElementById('agd-tip'); if (t) { t.classList.remove('on'); setTimeout(function () { if (t.parentNode && !t.classList.contains('on')) t.parentNode.removeChild(t); }, 300); } if (_tipT) { clearTimeout(_tipT); _tipT = null; } }
    function hlidejMisto() {
        var konec = Date.now() + 120000, pokus = 0;
        var krok = function () {
            if (_tipHotovo || otevreno() || Date.now() > konec) return;
            var ja = null; try { if (typeof userLat !== 'undefined' && userLat && typeof currentGpsAccuracy === 'number' && currentGpsAccuracy > 0 && currentGpsAccuracy < 40) ja = true; } catch (e) { ja = null; }
            if (!ja) { setTimeout(krok, 3000); return; }
            if (pokus++ === 0) { indexuj().then(function () { setTimeout(krok, 200); }); return; }
            _tipHotovo = true;
            var ls = seznam(), r = rozdel(ls);
            if (!r.uTebe || r.hl.akt) return;
            styly();
            var t = document.createElement('div'); t.id = 'agd-tip'; t.setAttribute('role', 'status');
            t.innerHTML = ikona('i-map-pin') + '<span>' + esc(T('Jsi u zakázky „{z}". Přepnout na ni?', { z: r.hl.nazev })) + '</span>'
                + '<button type="button" data-t="ne">' + esc(T('Ne')) + '</button><button type="button" class="pri" data-t="ano">' + esc(T('Přepnout')) + '</button>';
            document.body.appendChild(t);
            requestAnimationFrame(function () { t.classList.add('on'); });
            t.addEventListener('click', function (e) {
                var b = e.target.closest && e.target.closest('[data-t]'); if (!b) return;
                if (b.getAttribute('data-t') === 'ano') { prepni(r.hl.id); oznacOtevreno(r.hl.id); toast(T('Zakázka: {z}', { z: r.hl.nazev })); }
                skryjTip();
            });
            _tipT = setTimeout(skryjTip, 15000);
        };
        setTimeout(krok, 2500);
    }

    // ---- vstupy: Nastavení → Časté, menu Více ----------------------------------------------------
    function vlozVstupy() {
        if (!document.getElementById('agd-set-row')) {
            var caste = document.getElementById('set-caste');
            if (caste) {
                var r = document.createElement('div');
                r.className = 'st-row'; r.id = 'agd-set-row'; r.setAttribute('data-ns-keep', '');
                r.innerHTML = '<span class="st-lab">' + esc(T('Úvodní obrazovka Domů')) + '<small>' + esc(T('výběr zakázky, počasí a sdílení po spuštění appky')) + '<br><span id="agd-set-diag"></span></small>'
                    + '<select id="agd-set-rezim" style="margin-top:6px;min-height:36px;"><option value="vzdy">' + esc(T('při každém spuštění')) + '</option><option value="chytre">' + esc(T('jen ráno a po pauze')) + '</option></select></span>'
                    + '<span style="display:flex;align-items:center;gap:10px;"><button type="button" class="st-seg-b" id="agd-set-open">' + esc(T('Otevřít')) + '</button>'
                    + '<label class="st-sw"><input type="checkbox" id="agd-set-auto"><span class="st-sw-face"></span></label></span>';
                caste.insertBefore(r, caste.firstChild);
                r.querySelector('#agd-set-open').addEventListener('click', function () {
                    try { document.getElementById('settings-modal').style.display = 'none'; } catch (e) { swallow(e, 'setClose'); }
                    otevri();
                });
                r.querySelector('#agd-set-auto').addEventListener('change', function (e) { st.auto = e.target.checked; uloz(); synchronizujNastaveni(); });
                r.querySelector('#agd-set-rezim').addEventListener('change', function (e) { st.rezim = e.target.value === 'chytre' ? 'chytre' : 'vzdy'; uloz(); });
            }
        }
        if (!document.getElementById('agd-menu-btn')) {
            var ms = document.querySelector('#side-menu .menu-head');
            if (ms) {
                var b = document.createElement('button');
                b.className = 'menu-btn'; b.id = 'agd-menu-btn';
                b.innerHTML = ikona('i-folder') + ' ' + esc(T('Domů — zakázky'));
                b.addEventListener('click', function () { try { if (typeof toggleMenu === 'function') toggleMenu(); } catch (e) { swallow(e, 'menu'); } otevri(); });
                ms.parentNode.insertBefore(b, ms.nextSibling);
            }
        }
        synchronizujNastaveni();
    }
    function synchronizujNastaveni() {
        var cb = document.getElementById('agd-set-auto'); if (cb) cb.checked = st.auto;
        var sel = document.getElementById('agd-set-rezim'); if (sel) { sel.value = st.rezim; sel.disabled = !st.auto; }
        // diagnostika: kdy se Domů naposledy ukázal / proč ne (agDomovDuvod_v1)
        var dg = document.getElementById('agd-set-diag');
        if (dg) {
            var d = null; try { d = JSON.parse(localStorage.getItem('agDomovDuvod_v1') || 'null'); } catch (e) { d = null; }
            var kdy = d && d.ts ? new Date(d.ts).toLocaleString(loc(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            dg.textContent = !d ? '' : (d.ukazano ? T('naposledy ukázáno {k}', { k: kdy }) : T('naposledy neukázáno {k}: {d}', { k: kdy, d: T(d.duvod || '?') }));
        }
    }

    // ---- start ----------------------------------------------------------------------------------------
    var _cekej = 0;
    function prihlaseni() {
        try {
            if (document.documentElement.classList.contains('ag-prelock')) return true;
            var ids = ['ag-login', 'ag-gate', 'ag-reg', 'ag-kod'];
            for (var i = 0; i < ids.length; i++) { var e = document.getElementById(ids[i]); if (e && e.isConnected && getComputedStyle(e).display !== 'none') return true; }
        } catch (e) { swallow(e, 'prihlaseni'); }
        return false;
    }
    function poStartu() {
        try { vlozVstupy(); } catch (e) { swallow(e, 'vstupy'); }
        if (_ukazanoStart) return;
        // přihlášení (Face ID / heslo) ještě svítí → rozhodnout až po něm, jinak by Domů
        // naběhl pod přihlašovací obrazovku a pak by ho zavřel vstup do appky
        if (prihlaseni()) { if (++_cekej < 600) setTimeout(poStartu, 500); return; }
        _ukazanoStart = true;
        var ukaz = st.auto && maSeUkazat();
        var duvod = !st.auto ? 'vypnuto' : (ukaz ? '' : 'dnes už byl a bez pauzy');
        // odkaz na bod (?bod= / ?geo=) nebo sdílený soubor = člověk jde za konkrétní věcí
        if (ukaz && /[?&](bod|geo|share|import|zkratka)=/.test(location.search || '')) { ukaz = false; duvod = 'odkaz'; }
        // zkratka z ikony appky (js/shortcuts.js parametr z adresy hned maže, proto příznak)
        if (ukaz && window.__agZkratka) { ukaz = false; duvod = 'zkratka'; }
        // ⚠ JINÉ OKNO UŽ DOMŮ NEPŘESKAKUJE (13. 11. 2026): při startu skoro vždy něco svítí
        //   (povolení kompasu, „Odemykat telefonem?", Co je nového) a Domů se tím pádem
        //   neukázal nikdy. Domů teď leží POD okny (z-index pod --z-modal), takže dialog
        //   zůstane nahoře a Domů je vidět po jeho zavření.
        if (ukaz && jednoduchy()) { ukaz = false; duvod = 'jednoduchý režim'; }
        try { localStorage.setItem('agDomovDuvod_v1', JSON.stringify({ ts: Date.now(), ukazano: !!ukaz, duvod: duvod })); } catch (e) { swallow(e, 'duvod'); }
        if (ukaz && otevri()) return;
        zapisAkt(false);
        // Domů se neukázal → aspoň pohlídat, jestli nestojíš u jiné zakázky
        if (st.auto && !jednoduchy()) hlidejMisto();
    }
    if (document.body && document.body.classList.contains('app-started')) poStartu();
    else window.addEventListener('ag:app-started', poStartu, { once: true });

    window.AGDomov = {
        otevri: otevri, zavri: zavri, otevreno: otevreno,
        auto: function (v) { if (typeof v === 'boolean') { st.auto = v; uloz(); synchronizujNastaveni(); } return st.auto; },
        rezim: function (v) { if (v === 'vzdy' || v === 'chytre') { st.rezim = v; uloz(); } return st.rezim; },
        _pocasi: function (res) { vykresliPocasi(res); },
        _seznam: seznam, _indexuj: indexuj, _tip: function () { _tipHotovo = false; hlidejMisto(); }
    };
})();
