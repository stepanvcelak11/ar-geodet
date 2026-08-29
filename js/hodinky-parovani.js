// ===== AR Geodet — PÁROVÁNÍ HODINEK GARMIN (ODPOJITELNÁ VRSTVA) ==============
// Vygeneruje šestimístný kód, kterým se k zakázce připojí aplikace v hodinkách
// (garmin/hodinky). Odsud dál si hodinky poradí samy.
//
// PROČ KÓD A NE PŘIHLÁŠENÍ: hodinky nemají klávesnici. Přihlásit se nemůžou
// a s telefonem přímo nemluví — cesta „telefon ↔ hodinky“ přes Bluetooth chce
// nativní doprovodnou aplikaci (Connect IQ Mobile SDK) a tahle appka je web,
// takže se do té BLE linky nedostane; drží ji Garmin Connect a protokol je
// uzavřený. Proto to jde oklikou přes internet:
//
//     hodinky ──makeWebRequest──▶ Cloudflare Worker ◀──HTTPS── tahle appka
//
// SMER PAROVANI: kod ukazuji HODINKY a opisuje se sem. Puvodne to bylo
// obracene (kod vyrobil mobil a psal se do nastaveni aplikace v Garmin
// Connect), jenze NAHRANA APLIKACE SE V GARMIN CONNECT NEOBJEVI, takze do
// jejiho nastaveni nejde napsat nic. Otoceni ma i tak lepsi ovladani:
// pise se na zarizeni, ktere ma klavesnici.
//
// Body pak putují do TÉŽE tabulky sync_points jako z mobilu, takže se objeví
// mezi vlastními body samy — nic dalšího se nezapíná.
//
// ODPOJENÍ: smaž tento soubor, jeho <script> v index.html a záznam
// 'hodinky-parovani' v js/tools-registry.js.
(function () {
    'use strict';

    var ICON = '⌚';

    function toast(t) {
        try { if (typeof window.quickToast === 'function') return window.quickToast(t); } catch (e) {}
        try { if (typeof window.agInfo === 'function') window.agInfo(t); } catch (e2) {}
    }

    function pid() {
        try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; }
    }

    // Klíč zakázky MUSÍ vzniknout stejně jako v js/cloud-sync.js (normalizovaný
    // název), jinak by hodinky psaly do jiné přihrádky než mobil.
    function jobKey(p) {
        var name = null;
        try {
            var list = JSON.parse(localStorage.getItem('arProjectsList') || '[]');
            if (Array.isArray(list)) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i] && list[i].id === p) { name = list[i].name; break; }
                }
            }
        } catch (e) {}
        var k = String(name || p).replace(/\s+/g, ' ');
        k = k.replace(/^\s+|\s+$/g, '').toLowerCase();
        return k.slice(0, 60) || String(p);
    }

    function ucty() {
        return (window.AGUcty && typeof window.AGUcty.cloudFetch === 'function') ? window.AGUcty : null;
    }

    // ---- okno ---------------------------------------------------------

    function open() {
        var u = ucty();
        var job = jobKey(pid());
        var back = document.createElement('div');
        back.className = 'modal-overlay';
        back.id = 'agwatch-modal';
        back.style.zIndex = '100001';
        // .modal-overlay je v CSS skrytá — bez tohohle se okno vytvoří, ale
        // zůstane neviditelné a vypadá to, že tlačítko nic nedělá.
        back.style.display = 'flex';
        var mala = 'font-size:calc(12.5px * var(--ag-font-scale, 1));';
        back.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Hodinky Garmin</h3>'
            + '<p style="' + mala + 'opacity:.75;margin:2px 0 10px;">Připojí hodinky k zakázce '
            + '<b id="agwatch-job"></b>. Body naměřené na hodinkách se pak objeví tady a body '
            + 'odsud uvidíš na hodinkách.</p>'
            + '<p style="' + mala + 'margin:2px 0 6px;"><b>Na hodinkách</b> dlouze podrž ↑ → '
            + '<b>Synchronizovat s mobilem</b>. Ukážou šestimístný kód — ten opiš sem.</p>'
            + '<input type="text" id="agwatch-kod" inputmode="text" autocomplete="off" '
            + 'maxlength="7" placeholder="ABC 234" '
            + 'style="text-align:center;font-size:1.7em;letter-spacing:.18em;text-transform:uppercase;'
            + 'font-family:var(--font-mono,monospace);margin:6px 0;">'
            + '<div id="agwatch-stav" style="' + mala + 'text-align:center;opacity:.75;min-height:1.2em"></div>'
            + '<button class="btn" id="agwatch-gen" style="margin-top:10px;">Spárovat</button>'
            + '<div class="set-h" style="margin-top:16px;">Připravit pro hodinky</div>'
            + '<p style="' + mala + 'opacity:.75;margin:2px 0 8px;">Mapa okolí (cesty, voda, zeleň, '
            + 'srázy) a body, které si vybereš. Udělej to <b>před výjezdem</b>, dokud je signál — '
            + 'hodinky si to pak stáhnou jedním stiskem.</p>'
            + '<label class="filter-row" style="' + mala + '"><input type="checkbox" id="agwatch-chce-mapu" checked> Mapa okolí</label>'
            + '<label class="filter-row" style="' + mala + '"><input type="checkbox" id="agwatch-chce-body" checked> Body <span id="agwatch-pocet" style="opacity:.7"></span></label>'
            + '<div id="agwatch-body" style="max-height:32vh;overflow-y:auto;margin:6px 0;'
            + 'border-radius:10px;background:rgba(127,127,127,0.08);padding:4px 8px;"></div>'
            + '<div id="agwatch-mapa-stav" style="' + mala + 'text-align:center;opacity:.75;min-height:1.2em"></div>'
            + '<button class="btn btn-secondary" id="agwatch-mapa" style="margin-top:6px;">Připravit pro hodinky</button>'
            + '<button class="btn btn-secondary" style="margin-top:10px;" id="agwatch-x">Zavřít</button>'
            + '</div>';
        document.body.appendChild(back);

        back.querySelector('#agwatch-job').textContent = '„' + job + '“';
        back.querySelector('#agwatch-x').onclick = function () { back.remove(); };
        back.onclick = function (e) { if (e.target === back) { back.remove(); } };

        var btn = back.querySelector('#agwatch-gen');

        // Bez firemního účtu se kód vydat nedá — server bez přihlášení
        // nikoho nespáruje. Řekne se to rovnou v okně, ne bublinou, která
        // stihne zmizet dřív, než ji člověk přečte.
        if (!u) {
            btn.disabled = true;
            back.querySelector('#agwatch-stav').textContent =
                'Nejdřív se přihlas do firemního účtu — bez něj server hodinky nespáruje.';
            return;
        }

        var pole = back.querySelector('#agwatch-kod');
        var stav = back.querySelector('#agwatch-stav');
        pole.focus();

        mapaTlacitko(back, u);

        btn.onclick = function () {
            var kod = (pole.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (kod.length !== 6) {
                stav.textContent = 'kód má šest znaků';
                return;
            }
            btn.disabled = true;
            stav.textContent = 'páruji…';
            u.cloudFetch('/watch/claim', { method: 'POST', body: { code: kod, job: job } })
                .then(function (r) {
                    btn.disabled = false;
                    if (r && r.ok) {
                        stav.textContent = 'Hotovo — na hodinkách to naskočí do pár vteřin.';
                        pole.value = '';
                        return;
                    }
                    var s = r ? r.status : 0;
                    // POZOR na dvojí význam 404: stejný kód vrací i worker, který
                    // /watch/* VŮBEC NEZNÁ (běží na něm starší nasazení) — jeho
                    // catch-all hlásí „Neznámá cesta.". Bez rozlišení dostal uživatel
                    // „kód neplatí" a nechal si na hodinkách ukazovat nový donekonečna.
                    stav.textContent =
                        (s === 404 && staryServer(r)) ? 'server běží na starší verzi — párování hodinek začne fungovat po nasazení workeru'
                        : s === 404 ? 'kód neplatí — nech si na hodinkách ukázat nový'
                        : s === 409 ? 'tenhle kód už byl použitý'
                        : s === 401 ? 'nejsi přihlášený do firemního účtu'
                        : 'nepovedlo se (' + s + ')';
                }, function () {
                    btn.disabled = false;
                    stav.textContent = 'server neodpovídá';
                });
        };
    }

    // Pozna, ze odpoved 404 prisla z catch-all starsiho workeru (ten /watch/* nezna),
    // ne od samotneho endpointu. Nasazeny worker s /watch/* vraci vlastni hlasku.
    function staryServer(r) {
        try {
            var e = r && r.data && r.data.error;
            return typeof e === 'string' && e.indexOf('Neznámá cesta') >= 0;
        } catch (x) { return false; }
    }

    // ---- příprava mapy --------------------------------------------------

    function poloha() {
        return new Promise(function (ok, ne) {
            // nejdřív to, co appka už dávno zná — ať se nečeká na fix zbytečně
            try {
                if (typeof userLocation !== 'undefined' && userLocation
                    && isFinite(userLocation.lat) && isFinite(userLocation.lng)) {
                    return ok([+userLocation.lat, +userLocation.lng]);
                }
            } catch (e) {}
            if (!navigator.geolocation) { return ne(new Error('bez GPS')); }
            navigator.geolocation.getCurrentPosition(
                function (p) { ok([p.coords.latitude, p.coords.longitude]); },
                function () { ne(new Error('bez GPS')); },
                { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
        });
    }

    var CUZK = 'https://ags.cuzk.gov.cz/arcgis/rest/services/BodovaPole/MapServer';
    var CUZK_VRSTVY = [1, 2, 4, 5, 6];        // TB, ZhB, nivelační, PPBP

    function cisloBodu(a) {
        if (!a) { return 'Bod'; }
        var h = {};
        for (var k in a) { if (Object.prototype.hasOwnProperty.call(a, k)) { h[k.toUpperCase()] = a[k]; } }
        var n = h['CISLO'] || h['CISLO_BODU'] || h['VLASTNI_CISLO'] || h['OZNACENI']
             || h['UPLNE_CISLO'] || h['NAZEV'];
        n = (n == null) ? '' : String(n).trim();
        return (n && n !== 'Null') ? n : 'Bod';
    }

    //! Stáhne body bodového pole ČÚZK pro okolí — ONLINE, bez ohledu na to,
    //! jestli je appka někdy měla načtené.
    //!
    //! ⚠ Nestačí dotaz na obálku: vrstvy BodovaPole přes /query často vrátí
    //! prázdno a body reálně vydá teprve /identify. Přesně na tohle už jednou
    //! doplatil import (viz komentář v js/cadastre-area.js), tak se dělá obojí.
    function stahniCuzk(lat, lon, r) {
        var dLat = r / 111320, dLon = r / (111320 * Math.cos(lat * Math.PI / 180));
        var w = lon - dLon, e = lon + dLon, s = lat - dLat, n = lat + dLat;
        var bbox = w + ',' + s + ',' + e + ',' + n;
        var out = [];

        function pridej(g, a) {
            if (!g || typeof g.x !== 'number' || typeof g.y !== 'number') { return; }
            out.push({ name: cisloBodu(a), lat: g.y, lng: g.x });
        }
        function json(u) {
            return fetch(u).then(function (r2) { return r2.ok ? r2.json() : null; }).catch(function () { return null; });
        }

        var kroky = CUZK_VRSTVY.map(function (id) {
            return json(CUZK + '/' + id + '/query?where=1%3D1&geometry=' + encodeURIComponent(bbox)
                + '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects'
                + '&outFields=*&returnGeometry=true&outSR=4326&f=json')
                .then(function (d) {
                    if (d && d.features) { d.features.forEach(function (f) { pridej(f.geometry, f.attributes); }); }
                });
        });
        kroky.push(json(CUZK + '/identify?geometry=' + lon + ',' + lat
            + '&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1000'
            + '&mapExtent=' + encodeURIComponent(bbox)
            + '&imageDisplay=1000,1000,96&returnGeometry=true&f=json')
            .then(function (d) {
                if (d && d.results) { d.results.forEach(function (x) { pridej(x.geometry, x.attributes); }); }
            }));

        return Promise.all(kroky).then(function () { return out; });
    }

    //! Body v okolí seřazené od nejbližších: co má appka v paměti (vlastní
    //! i bodová pole načtená na mapě) PLUS čerstvě stažené z ČÚZK.
    function bodyOkolo(lat, lon, cuzk) {
        var zdroje = [];
        // arPoints drží body ČÚZK i kopie vlastních; persistentCustomPoints
        // jsou vlastní. Bereme obojí — co je navíc, vyřadí dedup níž.
        try { if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) { zdroje.push(arPoints); } } catch (e) {}
        try {
            if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) {
                zdroje.push(persistentCustomPoints);
            }
        } catch (e2) {}
        if (cuzk && cuzk.length) { zdroje.push(cuzk); }

        var kos = Math.cos(lat * Math.PI / 180);
        var videl = {};
        var out = [];
        for (var z = 0; z < zdroje.length; z++) {
            var P = zdroje[z];
            for (var i = 0; i < P.length; i++) {
                var b = P[i];
                if (!b || b.hidden) { continue; }
                if (!isFinite(+b.lat) || !isFinite(+b.lng)) { continue; }
                var jm = b.name || 'Bod';
                var klic = jm + '@' + (+b.lat).toFixed(6) + ',' + (+b.lng).toFixed(6);
                if (videl[klic]) { continue; }
                videl[klic] = 1;
                var _m = (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg)
                    ? GeoCore.metersPerDeg(lat) : { lat: 111320, lng: 111320 * kos };
                var dy = (+b.lat - lat) * _m.lat;
                var dx = (+b.lng - lon) * _m.lng;
                out.push({
                    name: jm, lat: +b.lat, lng: +b.lng,
                    vyska: (b.vyska != null && isFinite(+b.vyska)) ? +b.vyska : null,
                    d: Math.sqrt(dx * dx + dy * dy)
                });
            }
        }
        out.sort(function (a, b2) { return a.d - b2.d; });
        return out.slice(0, 60);
    }

    function popisD(m) {
        return (m < 1000) ? (Math.round(m) + ' m') : ((m / 1000).toFixed(1) + ' km');
    }

    //! Vypíše body k odškrtnutí. Prvních dvacet je předzaškrtnutých — to je
    //! rozumný výchozí stav, ale rozhoduje člověk: „nejbližší" nemusí být
    //! „ty, kvůli kterým tam jedu".
    var _kandidati = [];

    function vypisBody(back, lat, lon, cuzk) {
        var host = back.querySelector('#agwatch-body');
        var sez = bodyOkolo(lat, lon, cuzk);
        _kandidati = sez;
        if (!sez.length) {
            host.innerHTML = '<p style="opacity:.6;margin:6px 0;">V téhle zakázce zatím nejsou žádné body.</p>';
            return [];
        }
        var h = '<p style="opacity:.6;margin:4px 0 6px;font-size:calc(11.5px * var(--ag-font-scale,1));">'
            + '20 nejbližších je předvybraných — kterýkoli můžeš odškrtnout a vzít místo něj vzdálenější.</p>';
        for (var i = 0; i < sez.length; i++) {
            h += '<label class="filter-row" style="font-size:calc(12.5px * var(--ag-font-scale,1));">'
                + '<input type="checkbox" class="agwatch-bod" value="' + i + '"'
                + (i < 20 ? ' checked' : '') + '> '
                + (sez[i].name + '').replace(/[<>&]/g, '') + ' · ' + popisD(sez[i].d) + '</label>';
        }
        host.innerHTML = h;

        // Počet vybraných je vidět hned u zaškrtávátka — bez toho se musí
        // ručně přepočítávat, kolik toho vlastně do hodinek půjde.
        function spocitej() {
            var boxy = back.querySelectorAll('.agwatch-bod');
            var n = 0;
            for (var i = 0; i < boxy.length; i++) { if (boxy[i].checked) { n++; } }
            var el = back.querySelector('#agwatch-pocet');
            if (el) { el.textContent = '(' + n + ' z ' + boxy.length + ')'; }
        }
        var boxy = host.querySelectorAll('.agwatch-bod');
        for (var j = 0; j < boxy.length; j++) { boxy[j].onchange = spocitej; }
        spocitej();
        return sez;
    }

    function mapaTlacitko(back, u) {
        var btn = back.querySelector('#agwatch-mapa');
        var stav = back.querySelector('#agwatch-mapa-stav');
        var chceMapu = back.querySelector('#agwatch-chce-mapu');
        var chceBody = back.querySelector('#agwatch-chce-body');
        var job = jobKey(pid());
        if (!btn) { return; }

        // Seznam se plní hned při otevření a body ČÚZK se k tomu STAHUJÍ
        // ONLINE — bez toho by tam byly jen vlastní body a nejbližší „bod"
        // klidně 11 km daleko, protože nic jiného appka lokálně nemá.
        var host = back.querySelector('#agwatch-body');
        host.innerHTML = '<p style="opacity:.6;margin:6px 0;">hledám body v okolí…</p>';
        poloha().then(function (p) {
            return stahniCuzk(p[0], p[1], 1500).catch(function () { return []; })
                .then(function (c) { vypisBody(back, p[0], p[1], c); });
        }, function () {
            host.innerHTML = '<p style="opacity:.6;margin:6px 0;">bez polohy nejde body vybrat</p>';
        });

        btn.onclick = function () {
            if (!chceMapu.checked && !chceBody.checked) {
                stav.textContent = 'vyber aspoň mapu nebo body';
                return;
            }
            btn.disabled = true;

            poloha().then(function (p) {
                var kroky = Promise.resolve();
                var hlaseni = [];

                // ---- body: uloží se výběr, hodinky si ho stáhnou ----
                if (chceBody.checked) {
                    // Posílají se CELÉ body, ne odkazy: většina jsou bodová pole
                    // ČÚZK, která na serveru nikdy nebyla a odkaz by nenašel nic.
                    var vybrane = [];
                    var boxy = back.querySelectorAll('.agwatch-bod');
                    for (var i = 0; i < boxy.length; i++) {
                        if (!boxy[i].checked) { continue; }
                        var b = _kandidati[+boxy[i].value];
                        if (!b) { continue; }
                        // Y a X v S-JTSK počítá MOBIL, ne hodinky: appka na to má
                        // proj4 (GeoCore, jediný autoritativní převod v projektu)
                        // a přepisovat Křováka do Monkey C by znamenalo dvě
                        // implementace, které se dřív nebo později rozejdou.
                        var jt = null;
                        try {
                            if (window.GeoCore && GeoCore.toSJTSK) { jt = GeoCore.toSJTSK(b.lat, b.lng); }
                        } catch (e) {}
                        vybrane.push({
                            c: b.name, la: b.lat, lo: b.lng, h: b.vyska,
                            y: jt ? Math.abs(jt.y) : null,
                            x: jt ? Math.abs(jt.x) : null
                        });
                    }
                    kroky = kroky.then(function () {
                        stav.textContent = 'ukládám výběr ' + vybrane.length + ' bodů…';
                        return u.cloudFetch('/watch/select', { method: 'POST', body: { job: job, points: vybrane } })
                            .then(function (r) {
                                if (!r || !r.ok) { throw new Error(staryServer(r) ? 'server běží na starší verzi — nasaď worker (cloud/)' : 'výběr bodů (' + (r ? r.status : '?') + ')'); }
                                hlaseni.push(vybrane.length + ' bodů');
                            });
                    });
                }

                // ---- mapa ----
                if (chceMapu.checked) {
                    kroky = kroky.then(function () {
                        if (!window.AGHodinkyDlazdice) { throw new Error('modul dlaždic se ještě nenačetl'); }
                        return window.AGHodinkyDlazdice.pripravOkoli(p[0], p[1], function (t) {
                            stav.textContent = t;
                        }).then(function (dl) {
                            if (!dl.length) { hlaseni.push('mapa: v okolí není co kreslit'); return; }
                            stav.textContent = 'odesílám ' + dl.length + ' dlaždic…';
                            return u.cloudFetch('/watch/tiles', { method: 'POST', body: { tiles: dl } })
                                .then(function (r) {
                                    if (!r || !r.ok) { throw new Error(staryServer(r) ? 'server běží na starší verzi — nasaď worker (cloud/)' : 'mapa (' + (r ? r.status : '?') + ')'); }
                                    hlaseni.push(dl.length + ' dlaždic mapy');
                                });
                        });
                    });
                }

                return kroky.then(function () {
                    btn.disabled = false;
                    stav.textContent = 'Hotovo — ' + hlaseni.join(' a ')
                        + '. Na hodinkách dej Synchronizovat s mobilem.';
                });
            }).catch(function (e) {
                btn.disabled = false;
                var m = (e && e.message) ? e.message : 'chyba';
                stav.textContent = (m.indexOf('404') >= 0)
                    ? 'server tuhle funkci ještě neumí — nasaď nový worker'
                    : 'nepovedlo se: ' + m;
            });
        };
    }

    // ---- registrace ----------------------------------------------------

    var _tries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({
                id: 'hodinky-parovani', label: 'Hodinky Garmin', icon: ICON,
                cat: 'Katastr a data', onClick: open, order: 60
            });
            return;
        }
        if (_tries++ < 20) { setTimeout(register, 500); }
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', register); }
    else { register(); }
})();
