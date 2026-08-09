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
            + '<div class="set-h" style="margin-top:16px;">Mapa do hodinek</div>'
            + '<p style="' + mala + 'opacity:.75;margin:2px 0 8px;">Připraví podklad — cesty, vodu, '
            + 'zeleň a srázy — pro okolí zhruba kilometr a půl kolem tebe. Udělej to <b>před '
            + 'výjezdem</b>, dokud je signál; hodinky si dlaždice stáhnou při synchronizaci.</p>'
            + '<div id="agwatch-mapa-stav" style="' + mala + 'text-align:center;opacity:.75;min-height:1.2em"></div>'
            + '<button class="btn btn-secondary" id="agwatch-mapa" style="margin-top:6px;">Připravit mapu okolí</button>'
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
                    stav.textContent =
                        s === 404 ? 'kód neplatí — nech si na hodinkách ukázat nový'
                        : s === 409 ? 'tenhle kód už byl použitý'
                        : s === 401 ? 'nejsi přihlášený do firemního účtu'
                        : 'nepovedlo se (' + s + ')';
                }, function () {
                    btn.disabled = false;
                    stav.textContent = 'server neodpovídá';
                });
        };
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

    function mapaTlacitko(back, u) {
        var btn = back.querySelector('#agwatch-mapa');
        var stav = back.querySelector('#agwatch-mapa-stav');
        if (!btn) { return; }

        btn.onclick = function () {
            if (!window.AGHodinkyDlazdice) {
                stav.textContent = 'modul dlaždic se ještě nenačetl, zkus to za chvíli';
                return;
            }
            btn.disabled = true;
            poloha().then(function (p) {
                return window.AGHodinkyDlazdice.pripravOkoli(p[0], p[1], function (t) {
                    stav.textContent = t;
                });
            }).then(function (dl) {
                if (!dl.length) {
                    btn.disabled = false;
                    stav.textContent = 'v okolí není co kreslit';
                    return;
                }
                stav.textContent = 'odesílám ' + dl.length + ' dlaždic…';
                return u.cloudFetch('/watch/tiles', { method: 'POST', body: { tiles: dl } })
                    .then(function (r) {
                        btn.disabled = false;
                        if (r && r.ok) {
                            stav.textContent = 'Hotovo — ' + dl.length
                                + ' dlaždic. Na hodinkách dej Synchronizovat s mobilem.';
                        } else {
                            stav.textContent = (r && r.status === 404)
                                ? 'server tuhle funkci ještě neumí — nasaď nový worker'
                                : 'odeslání selhalo (' + (r ? r.status : '?') + ')';
                        }
                    });
            }).catch(function (e) {
                btn.disabled = false;
                stav.textContent = 'nepovedlo se: ' + (e && e.message ? e.message : 'chyba');
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
