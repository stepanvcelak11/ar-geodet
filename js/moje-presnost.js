/* MOJE PŘESNOST (25. 9. 2026, 6. hodnocení a1 + a2)
 *
 * a1 — PŘESNOST PODLE MODELU TELEFONU: Terénní zkouška (js/terenni-zkouska.js) po výsledku
 *      pošle anonymně JEN model telefonu a čísla (bez polohy, bez účtu) na /stats/phone
 *      (cloud/worker.js) a ukáže, jak měří ostatní se stejným telefonem: „typicky ±2,8 m (37 zkoušek)“.
 * a2 — MAPA TVÉ PŘESNOSTI: každá skutečná chyba GPS na místě (kontrolní bod proti úřednímu nebo
 *      tvému bodu, 4. krok Terénní zkoušky) se zapamatuje s polohou (jen v telefonu,
 *      agPresnostMista_v1). Nástroj Moje přesnost ji ukáže v mapě barevnými kruhy a u Nového bodu
 *      appka řekne, jak tu telefon měřil podle nejbližší kontroly.
 *
 * Sdílení do statistiky jde vypnout (agMojePresnost_v1.sdilet=false) — pak appka ani nic nečte
 * ze serveru. Testy (scripts/ag_boot.py) ho mají vypnuté, testovací prostředí server nevidí.
 *
 * Odpojitelné: smaž tento soubor + řádek <script type="ag/lazy"> v index.html + záznam
 * 'moje-presnost' v js/tools-registry.js; volání v terenni-zkouska.js a overeni-bodu.js jsou
 * obalená `if (window.AGMojePresnost)`.
 */
(function () {
    'use strict';
    if (window.AGMojePresnost) return;

    var LS_MISTA = 'agPresnostMista_v1', LS = 'agMojePresnost_v1', ID = 'ag-mp-modal';
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'moje-presnost:' + kde); } catch (x) { /* nic */ } }
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function cz(v, d) { return (Math.round(v * Math.pow(10, d == null ? 1 : d)) / Math.pow(10, d == null ? 1 : d)).toFixed(d == null ? 1 : d).replace('.', ','); }
    function g(name) { try { return (new Function('return typeof ' + name + '!=="undefined"?' + name + ':undefined'))(); } catch (e) { return undefined; } }
    function nast() { var s = null; try { s = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { s = null; } s = s && typeof s === 'object' ? s : {}; if (s.sdilet == null) s.sdilet = true; return s; }
    function ulozNast(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { swallow(e, 'ls'); } }
    function vzd(a, b, c, d) {
        try { if (typeof getDistance === 'function') return getDistance(a, b, c, d); } catch (e) { /* nic */ }
        var R = 6371000, r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
        return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
    }

    // ---- model telefonu (a1) ----
    var IOS = { '375x667@2': 'iPhone SE / 8', '414x736@3': 'iPhone 8 Plus', '375x812@3': 'iPhone X/XS/11 Pro/12 mini/13 mini', '414x896@2': 'iPhone XR/11',
        '414x896@3': 'iPhone XS Max/11 Pro Max', '390x844@3': 'iPhone 12/13/14', '428x926@3': 'iPhone 12/13 Pro Max, 14 Plus', '393x852@3': 'iPhone 14 Pro/15/15 Pro/16',
        '430x932@3': 'iPhone 14 Pro Max/15 Plus/15 Pro Max/16 Plus', '402x874@3': 'iPhone 16 Pro', '440x956@3': 'iPhone 16 Pro Max' };
    function modelUA() {
        var ua = String(navigator.userAgent || '');
        if (/iPhone/.test(ua)) {
            var w = Math.min(screen.width, screen.height), h = Math.max(screen.width, screen.height), k = w + 'x' + h + '@' + Math.round(window.devicePixelRatio || 1);
            return IOS[k] || ('iPhone ' + k);
        }
        var m = /Android [\d.]+; ([^;)]+?)(?: Build|\))/.exec(ua);
        if (m && m[1] && m[1].trim() !== 'K') return m[1].trim().slice(0, 60);
        if (/Android/.test(ua)) return 'Android';
        return /iPad/.test(ua) ? 'iPad' : 'Počítač';
    }
    var _model = null;
    function model() {
        if (_model) return Promise.resolve(_model);
        var hotovo = function (m) { _model = String(m || modelUA()).slice(0, 60); return _model; };
        try {
            if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
                return navigator.userAgentData.getHighEntropyValues(['model']).then(function (v) { return hotovo(v && v.model ? v.model : modelUA()); }, function () { return hotovo(modelUA()); });
            }
        } catch (e) { /* nic */ }
        return Promise.resolve(hotovo(modelUA()));
    }
    function os() { var ua = String(navigator.userAgent || ''), i = /iPhone OS (\d+)_(\d+)/.exec(ua), a = /Android ([\d.]+)/.exec(ua); return i ? 'iOS ' + i[1] + '.' + i[2] : (a ? 'Android ' + a[1] : ''); }
    function api(path, opts) {
        if (!nast().sdilet || !window.AGUcty || !AGUcty.cloudFetch) return Promise.resolve(null);
        return AGUcty.cloudFetch(path, opts || {}).then(function (r) { return r && r.ok ? r.data : null; }).catch(function () { return null; });
    }
    function statModelu() { return model().then(function (m) { return api('/stats/phone?model=' + encodeURIComponent(m)).then(function (d) { return d ? Object.assign({ model: m }, d) : { model: m }; }); }); }
    function textStat(d) {
        if (!d || !d.model) return '';
        if (d.median != null) return t('Ostatní s telefonem') + ' ' + t(d.model) + ': ' + t('typicky') + ' ±' + cz(d.median) + ' m (' + d.n + ' ' + t('zkoušek') + ')';
        if (d.n) return t('Ostatní s telefonem') + ' ' + t(d.model) + ': ' + t('zatím málo zkoušek') + ' (' + d.n + ')';
        return t('S telefonem') + ' ' + t(d.model) + ' ' + t('zatím nikdo zkoušku neposlal — budeš první.');
    }
    // Terénní zkouška hotová → poslat anonymně (1× za 12 h) a do výsledku doplnit srovnání s ostatními
    function zkouska(V, odhad, box) {
        try {
            if (V && V.bod && isFinite(V.bod.d) && V.bod.lat != null) pridej({ lat: V.bod.lat, lng: V.bod.lng, d: V.bod.d, z: 'zkouska', jm: V.bod.name });
            var s = nast();
            var posli = s.sdilet && isFinite(odhad) && (!s.poslanoTs || Date.now() - s.poslanoTs > 12 * 3600e3);
            var p = posli ? model().then(function (m) {
                return api('/stats/phone', { method: 'POST', body: { model: m, os: os(), odhad: odhad, r95: V && V.gps ? V.gps.r95 : null, kompas: V && V.kompas && !V.kompas.preskoceno ? Math.abs(V.kompas.dif) : null, bod: V && V.bod ? V.bod.d : null } })
                    .then(function (r) { if (r) { var x = nast(); x.poslanoTs = Date.now(); ulozNast(x); } });
            }) : Promise.resolve();
            p.then(statModelu).then(function (d) {
                if (!box) return;
                var el = box.querySelector('.mp-stat'); if (!el) { el = document.createElement('small'); el.className = 'mp-stat'; el.style.cssText = 'display:block;margin-top:6px;opacity:.9;'; box.appendChild(el); }
                el.textContent = textStat(d);
            });
        } catch (e) { swallow(e, 'zkouska'); }
    }

    // ---- místa s naměřenou chybou (a2) ----
    function mista() { try { var a = JSON.parse(localStorage.getItem(LS_MISTA) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function ulozMista(a) { try { localStorage.setItem(LS_MISTA, JSON.stringify(a.slice(-300))); } catch (e) { swallow(e, 'mista'); } }
    function pridej(o) {
        if (!o || !isFinite(o.lat) || !isFinite(o.lng) || !isFinite(o.d)) return;
        var a = mista(), k = o.k || (o.z + ':' + Math.round(o.lat * 1e5) + ':' + Math.round(o.lng * 1e5));
        if (a.some(function (x) { return x.k === k; })) return;
        a.push({ k: k, lat: +o.lat, lng: +o.lng, d: Math.round(o.d * 100) / 100, ts: o.ts || Date.now(), z: o.z || 'kontrola', jm: String(o.jm || '').slice(0, 40) });
        ulozMista(a);
    }
    // kontrolní body (js/overeni-bodu.js: prov.checkOf, od v402 i prov.checkRef) → místa
    function sesbirejKontroly() {
        var P = g('persistentCustomPoints') || [], A = g('arPoints') || [];
        P.forEach(function (p) {
            if (!p || !p.prov || p.prov.checkOf == null) return;
            var ref = p.prov.checkRef;
            if (!ref) {
                var r = null;
                for (var i = 0; i < A.length && !r; i++) if (A[i] && A[i].id === p.prov.checkOf) r = A[i];
                for (var j = 0; j < P.length && !r; j++) if (P[j] && P[j].id === p.prov.checkOf) r = P[j];
                if (r) ref = { lat: r.lat, lng: r.lng, name: r.name };
            }
            if (!ref || !isFinite(ref.lat)) return;
            pridej({ k: 'k:' + p.id, lat: p.lat, lng: p.lng, d: vzd(p.lat, p.lng, ref.lat, ref.lng), ts: (p.prov && p.prov.ts) || Date.now(), z: 'kontrola', jm: ref.name || p.name });
        });
    }
    function nejblizsi(lat, lng, max) {
        var best = null;
        mista().forEach(function (m) { var dd = vzd(lat, lng, m.lat, m.lng); if (dd <= (max || 300) && (!best || dd < best.v)) best = { m: m, v: dd }; });
        return best;
    }
    function barva(d) { return d <= 2 ? '#22c55e' : (d <= 5 ? '#f59e0b' : '#ef4444'); }
    function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; }

    // ---- vrstva v mapě ----
    var _vrstva = null, _pas = null;
    function ukazVMape() {
        var L = window.L, M = g('map');
        if (!L || !M) return false;
        skryjZMapy();
        var a = mista(); if (!a.length) return false;
        _vrstva = L.layerGroup();
        a.forEach(function (m) {
            L.circle([m.lat, m.lng], { radius: Math.max(1.5, m.d), color: barva(m.d), weight: 2, fillColor: barva(m.d), fillOpacity: 0.25 }).addTo(_vrstva);
            L.circleMarker([m.lat, m.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: barva(m.d), fillOpacity: 1 })
                .bindTooltip('±' + cz(m.d) + ' m · ' + new Date(m.ts).toLocaleDateString((window.AGJazyk && AGJazyk.locale) ? AGJazyk.locale() : 'cs-CZ') + (m.jm ? ' · ' + m.jm : ''), { direction: 'top' }).addTo(_vrstva);
        });
        _vrstva.addTo(M);
        try { M.fitBounds(L.latLngBounds(a.map(function (m) { return [m.lat, m.lng]; })).pad(0.3), { maxZoom: 18 }); } catch (e) { swallow(e, 'fit'); }
        _pas = document.createElement('div'); _pas.id = 'ag-mp-pas'; _pas.setAttribute('role', 'status');
        _pas.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 16px);z-index:960;display:flex;gap:10px;align-items:center;'
            + 'padding:8px 10px 8px 14px;border-radius:14px;background:#161b22;color:#eef1f4;border:1px solid rgba(255,255,255,.18);box-shadow:0 8px 24px rgba(0,0,0,.35);font:600 calc(12.5px * var(--ag-font-scale,1)) var(--font-ui,system-ui);max-width:92vw;';
        _pas.innerHTML = '<span><span style="color:#22c55e">●</span> ≤ 2 m <span style="color:#f59e0b">●</span> ≤ 5 m <span style="color:#ef4444">●</span> ' + esc(t('víc')) + '</span>'
            + '<button type="button" style="min-height:36px;padding:6px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;font:inherit;cursor:pointer;">' + esc(t('Skrýt')) + '</button>';
        _pas.querySelector('button').addEventListener('click', skryjZMapy);
        document.body.appendChild(_pas);
        return true;
    }
    function skryjZMapy() {
        try { if (_vrstva) { _vrstva.remove(); _vrstva = null; } } catch (e) { swallow(e, 'skryj'); }
        if (_pas) { _pas.remove(); _pas = null; }
    }

    // ---- okno nástroje ----
    function open() {
        sesbirejKontroly();
        var m = document.getElementById(ID);
        if (!m) {
            m = document.createElement('div'); m.className = 'modal-overlay'; m.id = ID;
            m.innerHTML = '<div class="modal-content"><h2 style="margin-top:0;">' + esc(t('Moje přesnost')) + '</h2><div class="modal-body" id="ag-mp-body"></div>'
                + '<button type="button" class="btn btn-secondary" id="ag-mp-close" style="margin-top:12px;">' + esc(t('Zavřít')) + '</button></div>';
            document.body.appendChild(m);
            m.querySelector('#ag-mp-close').addEventListener('click', function () { m.style.display = 'none'; });
        }
        var a = mista(), d = a.map(function (x) { return x.d; }), med = median(d);
        var h = '<div class="set-card" style="padding:12px 14px;margin:0 0 12px;"><b id="ag-mp-model">' + esc(t('Tvůj telefon')) + ': …</b><div id="ag-mp-stat" style="font-size:calc(13px * var(--ag-font-scale,1));color:var(--text-muted);margin-top:4px;line-height:1.45;"></div></div>';
        if (a.length) {
            h += '<p style="margin:0 0 8px;"><b>' + esc(t('Tvoje kontroly')) + ':</b> ' + a.length + ' · ' + esc(t('medián')) + ' ±' + cz(med) + ' m · ' + esc(t('nejhorší')) + ' ±' + cz(Math.max.apply(null, d)) + ' m</p>'
                + '<button type="button" class="btn btn-primary" id="ag-mp-mapa">' + esc(t('Ukázat v mapě')) + '</button>'
                + '<div style="margin-top:10px;">' + a.slice().reverse().slice(0, 12).map(function (x) {
                    return '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,.08));font-size:calc(13px * var(--ag-font-scale,1));">'
                        + '<span aria-hidden="true" style="width:10px;height:10px;border-radius:50%;background:' + barva(x.d) + ';flex:0 0 auto;"></span>'
                        + '<span style="flex:1;min-width:0;">' + esc(x.jm || (x.z === 'zkouska' ? t('Terénní zkouška') : t('Kontrolní bod'))) + ' · ' + esc(new Date(x.ts).toLocaleDateString((window.AGJazyk && AGJazyk.locale) ? AGJazyk.locale() : 'cs-CZ')) + '</span>'
                        + '<b>±' + cz(x.d) + ' m</b></div>';
                }).join('') + '</div>';
        } else {
            h += '<p style="margin:0;line-height:1.5;">' + esc(t('Zatím tu nic není. Stoupni si na úřední bod, otevři jeho kartu a klepni na Kontrolní bod — appka si zapamatuje, o kolik se tu telefon spletl. Stejně to udělá 4. krok Terénní zkoušky.')) + '</p>';
        }
        h += '<label style="display:flex;gap:10px;align-items:center;margin-top:14px;font-size:calc(13px * var(--ag-font-scale,1));"><input type="checkbox" id="ag-mp-sdilet"' + (nast().sdilet ? ' checked' : '') + '> '
            + esc(t('Přispívat do statistiky telefonů (jen model a výsledek Terénní zkoušky, bez polohy)')) + '</label>';
        m.querySelector('#ag-mp-body').innerHTML = h;
        m.style.display = 'flex';
        var bm = m.querySelector('#ag-mp-mapa');
        if (bm) bm.addEventListener('click', function () { m.style.display = 'none'; ukazVMape(); });
        m.querySelector('#ag-mp-sdilet').addEventListener('change', function () { var s = nast(); s.sdilet = !!this.checked; ulozNast(s); });
        model().then(function (mo) { var e = m.querySelector('#ag-mp-model'); if (e) e.textContent = t('Tvůj telefon') + ': ' + t(mo); });
        statModelu().then(function (st) { var e = m.querySelector('#ag-mp-stat'); if (e) e.textContent = nast().sdilet ? textStat(st) : t('Statistika telefonů je vypnutá.'); });
    }

    // ---- Nový bod: odhad podle nejbližší kontroly ----
    function tipNovyBod() {
        try {
            var lat = g('userLat'), lng = g('userLng'); if (!lat || !lng) return;
            var b = nejblizsi(lat, lng, 300);
            var host = document.querySelector('#custom-modal-overlay .modal-content'); if (!host) return;
            var el = document.getElementById('ag-mp-tip');
            if (!b) { if (el) el.remove(); return; }
            if (!el) {
                el = document.createElement('div'); el.id = 'ag-mp-tip'; el.setAttribute('role', 'note');
                el.style.cssText = 'margin:0 0 10px;padding:8px 10px;border-radius:10px;font-size:calc(12.5px * var(--ag-font-scale,1));line-height:1.4;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);';
                var h2 = host.querySelector('h2, h3'); if (h2 && h2.nextSibling) host.insertBefore(el, h2.nextSibling); else host.insertBefore(el, host.firstChild);
            }
            el.textContent = t('Podle tvé kontroly') + ' ' + Math.round(b.v) + ' m ' + t('odsud tu telefon měřil na') + ' ±' + cz(b.m.d) + ' m.';
        } catch (e) { swallow(e, 'tip'); }
    }
    function napoj() {
        var f = window.openNewPointModal;
        if (typeof f === 'function' && !f._agMp) {
            var w = function () { var r = f.apply(this, arguments); setTimeout(tipNovyBod, 50); return r; };
            w._agMp = true; try { Object.keys(f).forEach(function (k) { w[k] = f[k]; }); } catch (e) { /* nic */ }
            window.openNewPointModal = w;
        }
        sesbirejKontroly();
    }
    function register() {
        try {
            if (typeof window.agRegisterFieldTool === 'function') window.agRegisterFieldTool({ id: 'moje-presnost', label: t('Moje přesnost'), cat: 'Měření', onClick: open,
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>' });
        } catch (e) { swallow(e, 'register'); }
    }
    function start() { register(); napoj(); setTimeout(napoj, 3000); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.agOpenMojePresnost = open;
    window.AGMojePresnost = { open: open, zkouska: zkouska, pridej: pridej, mista: mista, model: model, statModelu: statModelu, ukazVMape: ukazVMape, skryjZMapy: skryjZMapy,
        _test: { modelUA: modelUA, nejblizsi: nejblizsi, sesbirejKontroly: sesbirejKontroly, tipNovyBod: tipNovyBod, textStat: textStat } };
})();
