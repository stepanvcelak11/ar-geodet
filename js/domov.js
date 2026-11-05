// ===== QTRIG — DOMŮ: úvodní obrazovka „nejdřív si nachystám den, pak jdu měřit" (ODPOJITELNÁ) =====
// (4. 11. 2026, přání uživatele: „obecně úvodní obrazovku, kde by bylo dnešní počasí, v tu chvíli
//  by nabíhalo vše, co appka umí, výběr zakázky, poznámky, sdílení zakázek či bodů… nedával bych
//  tam nástroje, protože nejdříve si nastavíš aplikaci a potom jdeš měřit")
//
// ⚠ TOHLE NENÍ STARÁ ÚVODNÍ OBRAZOVKA (#welcome-screen, zrušená 31. 8. 2026). Ta stála PŘED
//   přihlášením a hostovi brala cestu k přihlášení. Domů se ukazuje AŽ PO vstupu do appky
//   (událost ag:app-started), leží POD přihlašovací bránou (z-index 999990 < 999999) a pod
//   jednoduchým režimem (ten má vlastní domovskou stránku — v jednoduchém režimu se Domů
//   neukazuje vůbec). Appka pod ní mezitím normálně nabíhá: GPS, mapa, odložené moduly.
//
// CO TU JE (a schválně NE nástroje):
//   • pozdrav + datum, POČASÍ na dnešek (Open-Meteo, cache 30 min, offline poslední stažené);
//     klepnutí = celý nástroj Počasí;
//   • ZAKÁZKA: název, počet bodů, Změnit / Nová;
//   • POZNÁMKY k zakázce (ukládají se k zakázce — setStoredData, takže jedou i v přenosu .argeo);
//   • SDÍLENÍ: poslat / načíst zakázku (.argeo), body přes QR, načíst QR; stav firemní synchronizace;
//   • PŘED VÝJEZDEM: světlý/tmavý vzhled, venkovní režim (kontrast na slunci), velikost písma,
//     jednoduchý režim, mapa okolí do telefonu, všechna nastavení;
//   • STAV: GPS, uložená mapa okolí, poslední záloha, co čeká na signál;
//   • průběh nabíhání appky („Připravuji nástroje…" → „Vše připraveno");
//   • velké tlačítko JÍT MĚŘIT.
//
// Ukazuje se při každém spuštění appky (ne při návratu z pozadí); vypnout jde zaškrtnutím
// dole nebo v Nastavení (Časté → „Úvodní obrazovka Domů"). Znovu otevřít: Nastavení → Časté,
// nebo menu Více → Domů. Ranní brífink se v den, kdy se Domů ukázalo, sám neotvírá — počasí
// je tady (celý brífink je odkaz pod počasím).
// Odstranění: smaž js/domov.js + <script> v index.html; gen_sw_assets --bump.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGDomov) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'domov:' + kde); } catch (e2) { /* nic */ } };

    var KEY = 'agDomov_v1';                // { auto: true|false }
    var KEY_WX = 'agDomovWx_v1';           // { t, day, lat, lng, data }
    var KEY_POZN = 'agPoznamkyZakazky';    // per zakázka přes setStoredData
    var WX_MAX_AGE = 30 * 60000;
    var ID = 'ag-domov';
    var st = { auto: true };
    try { var s0 = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s0 && typeof s0.auto === 'boolean') st.auto = s0.auto; } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }

    var root = null, _tik = null, _poznTmr = null, _ukazanoStart = false;

    // ---- pomocné ------------------------------------------------------------------------------
    function T(cs, o) { var v = cs; try { if (window.AGJazyk && AGJazyk.t) v = AGJazyk.t(cs); } catch (e) { v = cs; } return o ? String(v).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }) : v; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function ikona(id) { return '<svg class="icon" aria-hidden="true"><use href="#' + id + '"/></svg>'; }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function dnes() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function loc() { try { return (window.AGJazyk && AGJazyk.locale) ? AGJazyk.locale() : 'cs-CZ'; } catch (e) { return 'cs-CZ'; } }
    function cislo(n, d) { return String(Number(n).toFixed(d == null ? 0 : d)).replace('.', ','); }
    function toast(t) { try { if (typeof quickToast === 'function') quickToast(t); } catch (e) { swallow(e, 'toast'); } }
    function jednoduchy() { try { return !!(window.AGJednoduchy && AGJednoduchy.zapnuto()) || localStorage.getItem('agJednoduchy_v1') === '1'; } catch (e) { return false; } }
    function pid() { try { return (typeof activeProjectId !== 'undefined' && activeProjectId) || localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function nazevZakazky() {
        var id = pid();
        try { if (typeof projects !== 'undefined' && Array.isArray(projects)) for (var i = 0; i < projects.length; i++) if (projects[i] && projects[i].id === id) return projects[i].name || id; } catch (e) { swallow(e, 'nazev'); }
        return id === 'default' ? T('Výchozí zakázka') : id;
    }
    function body() { try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; } catch (e) { return []; } }
    function poloha() {
        try { if (typeof userLat !== 'undefined' && userLat) return { lat: userLat, lng: userLng }; } catch (e) { /* nic */ }
        try { var p = JSON.parse(localStorage.getItem('arLastPos')); if (p && p.lat != null) return { lat: p.lat, lng: p.lng }; } catch (e) { /* nic */ }
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
    // nástroj z odloženého modulu: když ještě není načtený, načíst a pak spustit
    function spust(fnName, src, args) {
        zavri();
        var f = window[fnName];
        if (typeof f === 'function') { try { f.apply(null, args || []); } catch (e) { swallow(e, fnName); } return; }
        if (src && window.AGLazy && AGLazy.need) {
            try { AGLazy.need(src, function () { var g = window[fnName]; if (typeof g === 'function') { try { g.apply(null, args || []); } catch (e) { swallow(e, fnName); } } }); } catch (e) { swallow(e, 'need'); }
        }
    }

    // ---- POČASÍ ---------------------------------------------------------------------------------
    var WMO = { 0: 'Jasno', 1: 'Skoro jasno', 2: 'Polojasno', 3: 'Zataženo', 45: 'Mlha', 48: 'Mlha s námrazou', 51: 'Mrholení', 53: 'Mrholení', 55: 'Silné mrholení', 56: 'Mrznoucí mrholení', 57: 'Mrznoucí mrholení',
        61: 'Slabý déšť', 63: 'Déšť', 65: 'Silný déšť', 66: 'Mrznoucí déšť', 67: 'Mrznoucí déšť', 71: 'Slabé sněžení', 73: 'Sněžení', 75: 'Silné sněžení', 77: 'Sněhová zrna',
        80: 'Přeháňky', 81: 'Přeháňky', 82: 'Silné přeháňky', 85: 'Sněhové přeháňky', 86: 'Sněhové přeháňky', 95: 'Bouřka', 96: 'Bouřka s kroupami', 99: 'Bouřka s kroupami' };
    function wxCache() { try { return JSON.parse(localStorage.getItem(KEY_WX)); } catch (e) { return null; } }
    function nactiPocasi() {
        var p = poloha(), c = wxCache();
        var cerstva = c && c.data && (Date.now() - c.t < WX_MAX_AGE) && c.day === dnes() && (!p || (Math.abs(c.lat - p.lat) < 0.05 && Math.abs(c.lng - p.lng) < 0.07));
        if (cerstva) return Promise.resolve({ w: c.data, stale: false });
        if (!p || navigator.onLine === false) return Promise.resolve(c && c.data ? { w: c.data, stale: true, when: c.t } : null);
        var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.lat.toFixed(3) + '&longitude=' + p.lng.toFixed(3)
            + '&current=temperature_2m,weather_code,wind_speed_10m,pressure_msl,surface_pressure'
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
    // ---- TLAK PŘEPOČTENÝ NA VÝŠKU (5. 11. 2026, přání uživatele) ----
    // Open-Meteo dává tlak redukovaný na hladinu moře (QNH, jak ho hlásí předpovědi) — pro
    // atmosférickou korekci dálkoměru a barometrickou výšku je ale potřeba tlak V MÍSTĚ.
    // Přepočet barometrickou rovnicí (standardní gradient 0,0065 K/m, teplota z předpovědi):
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
    function radekTlaku(w) {
        var c = (w && w.current) || {};
        if (c.pressure_msl == null || !isFinite(c.pressure_msl)) return '';
        var v = vyskaMista(w);
        var out = T('Tlak {p} hPa (moře)', { p: Math.round(c.pressure_msl) });
        if (v) {
            var p = tlakVeVysce(c.pressure_msl, v.h, c.temperature_2m);
            if (p) out += ' · ' + T('u tebe {p} hPa ({h} m n. m., {z})', { p: Math.round(p), h: Math.round(v.h), z: v.zdroj });
        }
        return out;
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
        var radky = [];
        if (d.temperature_2m_min && d.temperature_2m_max) radky.push(T('dnes {a} až {b} °C', { a: Math.round(d.temperature_2m_min[0]), b: Math.round(d.temperature_2m_max[0]) })
            + (d.wind_speed_10m_max ? ' · ' + T('vítr do {v} m/s', { v: Math.round(d.wind_speed_10m_max[0]) }) : ''));
        var srazky = d.precipitation_sum ? d.precipitation_sum[0] : 0, pst = d.precipitation_probability_max ? d.precipitation_probability_max[0] : null;
        if (srazky > 0.1) { var hod = destHodiny(w.hourly); radky.push(T('Déšť {mm} mm', { mm: cislo(srazky, 1) }) + (hod ? ' — ' + hod : '') + (pst != null ? ' (' + Math.round(pst) + ' %)' : '')); }
        else radky.push(T('Bez deště'));
        if (d.sunrise && d.sunset) {
            var zbyva = '';
            var m = /T(\d{2}):(\d{2})/.exec(d.sunset[0]);
            if (m) { var n = new Date(), min = (+m[1] * 60 + +m[2]) - (n.getHours() * 60 + n.getMinutes()); if (min > 0) zbyva = ' · ' + T('světla zbývá {t} h', { t: Math.floor(min / 60) + ':' + pad2(min % 60) }); }
            radky.push(T('Slunce {a}–{b}', { a: hm(d.sunrise[0]), b: hm(d.sunset[0]) }) + zbyva);
        }
        var tl = radekTlaku(w); if (tl) radky.push(tl);
        box.innerHTML = '<div class="agd-wx-hl"><span class="agd-wx-t">' + (teplota != null ? teplota + '°' : '–') + '</span><span class="agd-wx-co">' + esc(T(WMO[kod] || '')) + '</span></div>'
            + radky.map(function (r) { return '<div class="agd-wx-r">' + esc(r) + '</div>'; }).join('')
            + (res.stale ? '<div class="agd-wx-off">' + esc(T('bez signálu — předpověď z {t}', { t: new Date(res.when).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) })) + '</div>' : '');
    }

    // ---- stavba obrazovky -----------------------------------------------------------------------
    function styly() {
        if (document.getElementById('ag-domov-style')) return;
        var s = document.createElement('style'); s.id = 'ag-domov-style';
        s.textContent = [
            '#ag-domov{position:fixed;inset:0;z-index:999990;display:none;flex-direction:column;background:var(--bg-color,#0e1216);color:var(--text-color,#e8eaed);font-family:var(--font-ui,system-ui),sans-serif;overscroll-behavior:contain;}',
            '#ag-domov.on{display:flex;}',
            '#ag-domov .agd-scroll{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:calc(env(safe-area-inset-top,0px) + 16px) max(16px,env(safe-area-inset-right,0px)) 12px max(16px,env(safe-area-inset-left,0px));}',
            '#ag-domov .agd-in{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:12px;}',
            '#ag-domov .agd-head h1{margin:0;font:700 calc(26px * var(--ag-font-scale,1))/1.15 var(--font-display,system-ui),sans-serif;}',
            '#ag-domov .agd-head p{margin:4px 0 0;color:var(--text-muted,#9aa1ac);font-size:calc(14px * var(--ag-font-scale,1));}',
            '#ag-domov .agd-karta{background:var(--surface-1,rgba(255,255,255,.05));border:1px solid var(--glass-border,rgba(255,255,255,.1));border-radius:var(--r-xl,18px);padding:14px 16px;}',
            '#ag-domov .agd-h{display:flex;align-items:center;gap:8px;margin:0 0 8px;font:700 calc(12px * var(--ag-font-scale,1))/1 var(--font-display,system-ui),sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#ag-domov .agd-h .icon{width:16px;height:16px;color:var(--accent,#2f9e74);}',
            '#ag-domov .agd-wx{cursor:pointer;}',
            '#ag-domov .agd-wx-hl{display:flex;align-items:baseline;gap:12px;margin-bottom:4px;}',
            '#ag-domov .agd-wx-t{font:800 calc(44px * var(--ag-font-scale,1))/1 var(--font-display,system-ui),sans-serif;}',
            '#ag-domov .agd-wx-co{font-size:calc(17px * var(--ag-font-scale,1));font-weight:600;}',
            '#ag-domov .agd-wx-r,#ag-domov .agd-wx-nic{font-size:calc(14px * var(--ag-font-scale,1));line-height:1.5;color:var(--text-color,#e8eaed);}',
            '#ag-domov .agd-wx-off{margin-top:4px;font-size:calc(12px * var(--ag-font-scale,1));color:var(--warning,#fbbf24);}',
            '#ag-domov .agd-odkaz{background:none;border:none;padding:6px 0 0;color:var(--accent,#2f9e74);font:600 calc(13px * var(--ag-font-scale,1)) inherit;cursor:pointer;}',
            '#ag-domov .agd-zak{font:700 calc(19px * var(--ag-font-scale,1))/1.25 var(--font-display,system-ui),sans-serif;word-break:break-word;}',
            '#ag-domov .agd-sub{margin-top:2px;font-size:calc(13px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);}',
            '#ag-domov .agd-tl{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}',
            '#ag-domov .agd-b{flex:1 1 calc(50% - 8px);min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;border-radius:var(--r-lg,14px);border:1px solid var(--glass-border-strong,rgba(255,255,255,.16));background:var(--surface-2,rgba(255,255,255,.07));color:var(--text-color,#e8eaed);font:600 calc(14px * var(--ag-font-scale,1)) inherit;cursor:pointer;text-align:center;}',
            '#ag-domov .agd-b .icon{width:18px;height:18px;flex:0 0 auto;color:var(--accent,#2f9e74);}',
            '#ag-domov .agd-b:active{transform:scale(.98);}',
            '#ag-domov textarea{width:100%;box-sizing:border-box;min-height:84px;resize:vertical;border-radius:var(--r-lg,14px);border:1px solid var(--glass-border-strong,rgba(255,255,255,.16));background:var(--surface-2,rgba(255,255,255,.06));color:inherit;padding:10px 12px;font:calc(15px * var(--ag-font-scale,1))/1.45 inherit;}',
            '#ag-domov .agd-ulozeno{min-height:16px;margin-top:4px;font-size:calc(12px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);}',
            '#ag-domov .agd-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;border-top:1px solid var(--glass-border,rgba(255,255,255,.08));}',
            '#ag-domov .agd-row:first-of-type{border-top:none;}',
            '#ag-domov .agd-row span small{display:block;color:var(--text-muted,#9aa1ac);font-size:calc(12px * var(--ag-font-scale,1));}',
            '#ag-domov .agd-seg{display:flex;gap:4px;}',
            '#ag-domov .agd-seg button{min-width:48px;min-height:40px;padding:6px 12px;border-radius:var(--r-md,10px);border:1px solid var(--glass-border-strong,rgba(255,255,255,.16));background:transparent;color:inherit;font:600 calc(14px * var(--ag-font-scale,1)) inherit;cursor:pointer;}',
            '#ag-domov .agd-seg button.on{background:var(--accent-fill,#2f9e74);border-color:transparent;color:#fff;}',
            '#ag-domov .agd-stav{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;font-size:calc(14px * var(--ag-font-scale,1));}',
            '#ag-domov .agd-stav b{font-weight:600;}',
            '#ag-domov .agd-ok{color:var(--accent,#2f9e74);} #ag-domov .agd-pozor{color:var(--warning,#fbbf24);}',
            '#ag-domov .agd-pata{flex:0 0 auto;padding:10px max(16px,env(safe-area-inset-right,0px)) max(14px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));border-top:1px solid var(--glass-border,rgba(255,255,255,.08));background:var(--bg-color,#0e1216);}',
            '#ag-domov .agd-pata-in{max-width:560px;margin:0 auto;}',
            '#ag-domov .agd-prubeh{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:calc(13px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);}',
            '#ag-domov .agd-prubeh i{flex:1 1 auto;height:4px;border-radius:2px;background:var(--surface-2,rgba(255,255,255,.08));overflow:hidden;}',
            '#ag-domov .agd-prubeh i b{display:block;height:100%;width:0;background:var(--accent,#2f9e74);transition:width .3s;}',
            '#ag-domov .agd-jit{width:100%;min-height:60px;border:none;border-radius:var(--r-xl,18px);background:var(--accent-fill,#2f9e74);box-shadow:var(--accent-glow,none);color:#fff;font:800 calc(20px * var(--ag-font-scale,1)) var(--font-display,system-ui),sans-serif;letter-spacing:.02em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;}',
            '#ag-domov .agd-jit .icon{width:26px;height:26px;color:#fff;}',
            '#ag-domov .agd-auto{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:8px;font-size:calc(13px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);}',
            '#ag-domov .agd-auto input{width:20px;height:20px;accent-color:var(--accent,#2f9e74);}'
        ].join('\n');
        document.head.appendChild(s);
    }

    function karta(id, ikonaId, nadpis, telo, extraTrida) {
        return '<section class="agd-karta' + (extraTrida ? ' ' + extraTrida : '') + '" id="' + id + '"><div class="agd-h">' + ikona(ikonaId) + esc(T(nadpis)) + '</div>' + telo + '</section>';
    }
    function tlac(akce, ikonaId, text) { return '<button type="button" class="agd-b" data-agd="' + akce + '">' + ikona(ikonaId) + '<span>' + esc(T(text)) + '</span></button>'; }

    function postav() {
        if (root) return root;
        styly();
        root = document.createElement('div');
        root.id = ID;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', T('Domů'));
        root.setAttribute('data-no-swipe', '');
        root.innerHTML = '<div class="agd-scroll"><div class="agd-in">'
            + '<header class="agd-head"><h1 id="agd-pozdrav"></h1><p id="agd-datum"></p></header>'
            + karta('agd-wx-karta', 'i-sun', 'Počasí dnes', '<div class="agd-wx" id="agd-wx" data-agd="pocasi"><div class="agd-wx-nic">' + esc(T('Načítám počasí…')) + '</div></div>'
                + '<button type="button" class="agd-odkaz" data-agd="brifink">' + esc(T('Celý den v terénu (GNSS, monitoring) ›')) + '</button>')
            + karta('agd-zak-karta', 'i-folder', 'Zakázka', '<div class="agd-zak" id="agd-zak"></div><div class="agd-sub" id="agd-zak-sub"></div>'
                + '<div class="agd-tl">' + tlac('zmenit', 'i-folder', 'Změnit zakázku') + tlac('nova', 'i-plus', 'Nová zakázka') + '</div>')
            + karta('agd-pozn-karta', 'i-edit', 'Poznámky k zakázce', '<textarea id="agd-pozn" rows="3" placeholder="' + esc(T('Co dnes udělat, kód od brány, telefon na stavbyvedoucího…')) + '"></textarea><div class="agd-ulozeno" id="agd-pozn-st"></div>')
            + karta('agd-sdil-karta', 'i-share', 'Sdílení', '<div class="agd-tl" style="margin-top:0;">' + tlac('poslat', 'i-share', 'Poslat zakázku') + tlac('nacist', 'i-download', 'Načíst zakázku')
                + tlac('qr', 'i-share', 'Body přes QR') + tlac('skenovat', 'i-locate', 'Načíst QR') + '</div><div class="agd-sub" id="agd-cloud" style="margin-top:8px;"></div>')
            + karta('agd-nast-karta', 'i-settings', 'Před výjezdem',
                '<div class="agd-row"><span>' + esc(T('Vzhled')) + '</span><span class="agd-seg" id="agd-mode"><button type="button" data-mode="light">' + esc(T('Světlý')) + '</button><button type="button" data-mode="dark">' + esc(T('Tmavý')) + '</button></span></div>'
                + '<div class="agd-row"><span>' + esc(T('Venkovní režim')) + '<small>' + esc(T('vysoký kontrast na slunci')) + '</small></span><span class="agd-seg"><button type="button" id="agd-outdoor">' + esc(T('Vypnuto')) + '</button></span></div>'
                + '<div class="agd-row"><span>' + esc(T('Velikost písma')) + '<small id="agd-fs-val"></small></span><span class="agd-seg"><button type="button" data-fs="-1" aria-label="' + esc(T('Menší písmo')) + '">A−</button><button type="button" data-fs="1" aria-label="' + esc(T('Větší písmo')) + '">A+</button></span></div>'
                + '<div class="agd-row"><span>' + esc(T('Jednoduchý režim')) + '<small>' + esc(T('jen Přidat bod a Navigovat, s mapou')) + '</small></span><span class="agd-seg"><button type="button" data-agd="jednoduchy">' + esc(T('Zapnout')) + '</button></span></div>'
                + '<div class="agd-tl">' + tlac('offline', 'i-download', 'Mapu okolí do telefonu') + tlac('nastaveni', 'i-settings', 'Všechna nastavení') + '</div>')
            + karta('agd-stav-karta', 'i-locate', 'Stav', '<div class="agd-stav" id="agd-stav"></div>')
            + '</div></div>'
            + '<footer class="agd-pata"><div class="agd-pata-in">'
            + '<div class="agd-prubeh" id="agd-prubeh"><span id="agd-prubeh-t"></span><i><b id="agd-prubeh-b"></b></i></div>'
            + '<button type="button" class="agd-jit" id="agd-jit">' + ikona('i-navigation') + esc(T('JÍT MĚŘIT')) + '</button>'
            + '<label class="agd-auto"><input type="checkbox" id="agd-auto"> ' + esc(T('Ukazovat po spuštění appky')) + '</label>'
            + '</div></footer>';
        document.body.appendChild(root);

        root.addEventListener('click', function (e) {
            var t = e.target && e.target.closest ? e.target.closest('[data-agd],[data-mode],[data-fs],#agd-outdoor,#agd-jit') : null;
            if (!t) return;
            if (t.id === 'agd-jit') { zavri(); return; }
            if (t.id === 'agd-outdoor') { nastavVzhled({ outdoor: !vis('outdoorMode') }); return; }
            if (t.hasAttribute('data-mode')) { nastavVzhled({ mode: t.getAttribute('data-mode') }); return; }
            if (t.hasAttribute('data-fs')) { nastavVzhled({ fs: +t.getAttribute('data-fs') }); return; }
            akce(t.getAttribute('data-agd'));
        });
        var pz = root.querySelector('#agd-pozn');
        pz.addEventListener('input', function () {
            root.querySelector('#agd-pozn-st').textContent = '';
            clearTimeout(_poznTmr); _poznTmr = setTimeout(ulozPoznamku, 600);
        });
        pz.addEventListener('blur', ulozPoznamku);
        var au = root.querySelector('#agd-auto');
        au.addEventListener('change', function () { st.auto = au.checked; uloz(); synchronizujNastaveni(); });
        return root;
    }

    function otevriNastaveni() {
        try { if (typeof window.openSettings === 'function') window.openSettings(); else document.getElementById('settings-modal').style.display = 'flex'; } catch (e) { swallow(e, 'nastaveni'); }
        setTimeout(vlozVstupy, 50);
    }
    function akce(a) {
        switch (a) {
            case 'pocasi': spust('agOpenPocasi', 'js/pocasi.js'); break;
            case 'brifink': spust('agOpenBrifink', 'js/brifink.js'); break;
            case 'zmenit':
                if (typeof window.agOpenZmenitZakazku === 'function') spust('agOpenZmenitZakazku');
                else { zavri(); otevriNastaveni(); }
                break;
            case 'nova': try { if (typeof createNewProject === 'function') { createNewProject(); setTimeout(obnov, 800); } } catch (e) { swallow(e, 'nova'); } break;
            case 'poslat': case 'nacist': spust('agOpenJobTransfer', 'js/job-transfer.js'); break;
            case 'qr': spust('openShareQR', 'js/sdileni.js'); break;
            case 'skenovat': spust('openScanQR', 'js/sdileni.js'); break;
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

    // ---- vzhled: přímo do visSettings (jako Nastavení), uložit a použít --------------------------
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
        } catch (e) { swallow(e, 'vzhled'); }
        vykresliNastaveni();
    }
    function vykresliNastaveni() {
        if (!root) return;
        var m = vis('mode') || (document.body.classList.contains('light-mode') ? 'light' : 'dark');
        Array.prototype.forEach.call(root.querySelectorAll('#agd-mode button'), function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === m); });
        var o = !!vis('outdoorMode'), ob = root.querySelector('#agd-outdoor');
        ob.classList.toggle('on', o); ob.textContent = T(o ? 'Zapnuto' : 'Vypnuto');
        root.querySelector('#agd-fs-val').textContent = Math.round((vis('fontScale') || 1) * 100) + ' %';
        root.querySelector('#agd-auto').checked = st.auto;
    }

    // ---- zakázka a poznámky -------------------------------------------------------------------------
    var _poznPid = null;
    function nactiPoznamku() {
        _poznPid = pid();
        var v = '';
        try { v = (typeof getStoredData === 'function' ? getStoredData(KEY_POZN) : localStorage.getItem(_poznPid + '_' + KEY_POZN)) || ''; } catch (e) { swallow(e, 'poznLoad'); }
        var pz = root.querySelector('#agd-pozn');
        if (document.activeElement !== pz) pz.value = v;
    }
    function ulozPoznamku() {
        if (!root) return;
        clearTimeout(_poznTmr); _poznTmr = null;
        if (_poznPid && _poznPid !== pid()) return;   // zakázka se mezitím změnila — nezapsat do cizí
        var v = root.querySelector('#agd-pozn').value;
        try {
            if (typeof setStoredData === 'function') setStoredData(KEY_POZN, v);
            else localStorage.setItem(pid() + '_' + KEY_POZN, v);
            root.querySelector('#agd-pozn-st').textContent = v ? T('Uloženo k zakázce.') : '';
        } catch (e) { swallow(e, 'poznSave'); root.querySelector('#agd-pozn-st').textContent = T('Poznámku se nepodařilo uložit.'); }
    }
    function vykresliZakazku() {
        root.querySelector('#agd-zak').textContent = nazevZakazky();
        var b = body(), sub = b.length ? T('Bodů v zakázce: {n}', { n: b.length }) : T('Zatím bez bodů');
        if (b.length) { var posl = b[b.length - 1]; if (posl && posl.name) sub += ' · ' + T('naposledy {p}', { p: posl.name }); }
        root.querySelector('#agd-zak-sub').textContent = sub;
        var cl = '';
        try { if (window.AGCloudSync && AGCloudSync.enabled()) cl = T('Body této zakázky se samy sdílejí s firmou.'); } catch (e) { swallow(e, 'cloud'); }
        var ce = root.querySelector('#agd-cloud'); ce.textContent = cl; ce.hidden = !cl;
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
        var radky = [];
        var gps;
        try {
            if (typeof userLat !== 'undefined' && userLat && typeof currentGpsAccuracy === 'number' && currentGpsAccuracy > 0) {
                var a = currentGpsAccuracy;
                gps = '<b class="' + (a <= 5 ? 'agd-ok' : 'agd-pozor') + '">± ' + cislo(a, a < 10 ? 1 : 0) + ' m</b>';
            } else gps = '<b class="agd-pozor">' + esc(T('hledám polohu…')) + '</b>';
        } catch (e) { gps = '–'; }
        radky.push([T('GPS'), gps]);
        var ok = null;
        try { ok = JSON.parse(localStorage.getItem('agMapaOkoli_v1') || 'null'); } catch (e) { ok = null; }
        radky.push([T('Mapa offline'), ok && ok.ts ? '<b class="agd-ok">' + esc(T('okolí uloženo {kdy}', { kdy: pred(ok.ts) })) + '</b>' : '<b>' + esc(T('uloží se samo se signálem')) + '</b>']);
        var zal = 0;
        ['agLastBackupTs', 'arLastBackupAt', 'agLastBackup'].forEach(function (k) { try { var v = +localStorage.getItem(k); if (!isFinite(v)) v = Date.parse(localStorage.getItem(k)) || 0; if (v > zal) zal = v; } catch (e) { /* nic */ } });
        var zalStare = !zal || (Date.now() - zal) > 7 * 86400000;
        radky.push([T('Záloha'), '<b class="' + (zalStare ? 'agd-pozor' : 'agd-ok') + '">' + esc(zal ? pred(zal) : T('zatím žádná')) + '</b>']);
        try {
            if (window.AGFronta && AGFronta.stav) { var f = AGFronta.stav(); if (f && f.ceka) radky.push([T('Čeká na signál'), '<b class="agd-pozor">' + f.ceka + '</b>']); }
        } catch (e) { swallow(e, 'fronta'); }
        var html = radky.map(function (r) { return '<span>' + esc(r[0]) + '</span>' + r[1]; }).join('');
        if (html !== _stavHtml) { root.querySelector('#agd-stav').innerHTML = html; _stavHtml = html; }
    }
    // průběh nabíhání odložených modulů (js/lazy-load.js)
    var _celkem = 0;
    function vykresliPrubeh() {
        var t = root.querySelector('#agd-prubeh-t'), b = root.querySelector('#agd-prubeh-b'), box = root.querySelector('#agd-prubeh');
        var L = window.AGLazy;
        if (!L || !L.pending) { box.hidden = true; return; }
        var zbyva = L.pending().length;
        if (zbyva > _celkem) _celkem = zbyva;
        var hotovo = (L.hotovo && L.hotovo()) || !zbyva;
        box.hidden = false;
        t.textContent = hotovo ? T('Vše připraveno') : T('Připravuji nástroje…');
        b.style.width = (hotovo ? 100 : (_celkem ? Math.round(100 * (1 - zbyva / _celkem)) : 5)) + '%';
    }
    function tik() {
        if (!root || !root.classList.contains('on')) return;
        try { vykresliStav(); vykresliPrubeh(); if (_poznPid !== pid()) { nactiPoznamku(); vykresliZakazku(); } } catch (e) { swallow(e, 'tik'); }
        // počasí ještě není čerstvé → po příchodu polohy / každých 20 s zkusit znovu
        try { if (!_wx.ok && !_wx.bezi && poloha() && navigator.onLine !== false && (!_wx.mel || Date.now() - _wx.pokus > 20000)) nactiWx(); } catch (e) { swallow(e, 'tikWx'); }
    }

    // ---- otevřít / zavřít ---------------------------------------------------------------------------
    function obnov() {
        if (!root) return;
        var j = jmeno();
        root.querySelector('#agd-pozdrav').textContent = pozdrav() + (j ? ', ' + j : '');
        var d = new Date().toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long' });
        root.querySelector('#agd-datum').textContent = d.charAt(0).toUpperCase() + d.slice(1);
        vykresliZakazku(); nactiPoznamku(); vykresliNastaveni(); vykresliStav(); vykresliPrubeh();
        try { var jb = root.querySelector('[data-agd="jednoduchy"]').closest('.agd-row'); jb.hidden = !window.AGJednoduchy; } catch (e) { swallow(e, 'jb'); }
        nactiWx();
    }
    // Počasí: hned poslední stažené (i starší, se štítkem), pak čerstvé. Když ještě není
    // poloha (GPS se v telefonu chytá i desítky sekund), zkusí se znovu, jakmile přijde —
    // dřív zůstalo „Počasí ukážu, až bude známá poloha" viset do zavření Domů.
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
    function otevri() {
        if (jednoduchy()) return false;
        postav();
        root.classList.add('on');
        document.body.classList.add('ag-domov-on');
        obnov();
        if (!_tik) _tik = setInterval(tik, 1000);
        // „v tu chvíli by nabíhalo vše, co appka umí": dokud člověk čte Domů, nic neměří —
        // odložené moduly se dotáhnou NAJEDNOU (jinak po dávkách v nečinnosti i desítky
        // sekund na slabém telefonu). Až po vykreslení Domů, ať se ukáže hned.
        setTimeout(function () { try { if (otevreno() && window.AGLazy && AGLazy.flush) AGLazy.flush(); } catch (e) { swallow(e, 'flush'); } }, 600);
        // ranní brífink dnes sám neotvírat — počasí je tady
        try { localStorage.setItem('agBrifinkLastShown', dnes()); } catch (e) { swallow(e, 'brifink'); }
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

    // ---- vstupy: Nastavení → Časté, menu Více ----------------------------------------------------
    function vlozVstupy() {
        if (!document.getElementById('agd-set-row')) {
            var caste = document.getElementById('set-caste');
            if (caste) {
                var r = document.createElement('div');
                r.className = 'st-row'; r.id = 'agd-set-row'; r.setAttribute('data-ns-keep', '');
                r.innerHTML = '<span class="st-lab">' + esc(T('Úvodní obrazovka Domů')) + '<small>' + esc(T('počasí, zakázka, poznámky, sdílení a nastavení před výjezdem')) + '</small></span>'
                    + '<span style="display:flex;align-items:center;gap:10px;"><button type="button" class="st-seg-b" id="agd-set-open">' + esc(T('Otevřít')) + '</button>'
                    + '<label class="st-sw"><input type="checkbox" id="agd-set-auto"><span class="st-sw-face"></span></label></span>';
                caste.insertBefore(r, caste.firstChild);
                r.querySelector('#agd-set-open').addEventListener('click', function () {
                    try { document.getElementById('settings-modal').style.display = 'none'; } catch (e) { swallow(e, 'setClose'); }
                    otevri();
                });
                r.querySelector('#agd-set-auto').addEventListener('change', function (e) { st.auto = e.target.checked; uloz(); });
            }
        }
        if (!document.getElementById('agd-menu-btn')) {
            var ms = document.querySelector('#side-menu .menu-head');
            if (ms) {
                var b = document.createElement('button');
                b.className = 'menu-btn'; b.id = 'agd-menu-btn';
                b.innerHTML = ikona('i-sun') + ' ' + esc(T('Domů'));
                b.addEventListener('click', function () { try { if (typeof toggleMenu === 'function') toggleMenu(); } catch (e) { swallow(e, 'menu'); } otevri(); });
                ms.parentNode.insertBefore(b, ms.nextSibling);
            }
        }
        synchronizujNastaveni();
    }
    function synchronizujNastaveni() { var cb = document.getElementById('agd-set-auto'); if (cb) cb.checked = st.auto; }

    // ---- start ----------------------------------------------------------------------------------------
    function jineOkno() {
        try {
            var ov = document.querySelectorAll('.modal-overlay, .ag-modal, [role="dialog"]');
            for (var i = 0; i < ov.length; i++) {
                var e = ov[i];
                if (e.id === 'ag-domov' || !e.isConnected) continue;
                var cs = getComputedStyle(e);
                // okna appky jsou zavřená i přes opacity 0 + pointer-events none (ne jen display)
                if (cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05 && cs.pointerEvents !== 'none'
                    && e.getClientRects().length && e.offsetWidth > 200) return true;
            }
        } catch (e) { swallow(e, 'jineOkno'); }
        return false;
    }
    function poStartu() {
        try { vlozVstupy(); } catch (e) { swallow(e, 'vstupy'); }
        if (_ukazanoStart || !st.auto) return;
        _ukazanoStart = true;
        // odkaz na bod (?bod= / ?geo=) nebo sdílený soubor = člověk jde za konkrétní věcí
        if (/[?&](bod|geo|share|import|zkratka)=/.test(location.search || '')) return;
        // zkratka z ikony appky (js/shortcuts.js parametr z adresy hned maže, proto příznak)
        if (window.__agZkratka) return;
        // už je otevřené okno (zkratka, odkaz, obnovený nástroj) — Domů by ho zakryl
        if (jineOkno()) return;
        otevri();
    }
    if (document.body && document.body.classList.contains('app-started')) poStartu();
    else window.addEventListener('ag:app-started', poStartu, { once: true });

    window.AGDomov = {
        otevri: otevri, zavri: zavri, otevreno: otevreno,
        auto: function (v) { if (typeof v === 'boolean') { st.auto = v; uloz(); synchronizujNastaveni(); } return st.auto; },
        _pocasi: function (res) { vykresliPocasi(res); }
    };
})();
