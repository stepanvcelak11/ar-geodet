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
// Kód se opíše v Garmin Connect (Zařízení → Connect IQ → AR Geodet →
// Nastavení) a hodinky si za něj vymění dlouhodobý token vázaný na zakázku.
// Platí 10 minut a je jednorázový.
//
// Body pak putují do TÉŽE tabulky sync_points jako z mobilu, takže se objeví
// mezi vlastními body samy — nic dalšího se nezapíná.
//
// ODPOJENÍ: smaž tento soubor, jeho <script> v index.html a záznam
// 'hodinky-parovani' v js/tools-registry.js.
(function () {
    'use strict';

    var ICON = '⌚';        // ⌚

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
        if (!u) {
            toast('Párování potřebuje firemní účet — nejdřív se přihlas.');
            return;
        }

        var job = jobKey(pid());
        var back = document.createElement('div');
        back.className = 'modal-overlay';
        back.id = 'agwatch-modal';
        back.style.zIndex = '100001';
        var mala = 'font-size:calc(12.5px * var(--ag-font-scale, 1));';
        back.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Hodinky Garmin</h3>'
            + '<p style="' + mala + 'opacity:.75;margin:2px 0 10px;">Připojí hodinky k zakázce '
            + '<b id="agwatch-job"></b>. Body naměřené na hodinkách se pak objeví tady a body '
            + 'odsud uvidíš na hodinkách.</p>'
            + '<div id="agwatch-kod" style="font-size:2.1em;letter-spacing:.18em;text-align:center;'
            + 'font-weight:700;margin:14px 0;min-height:1.2em;font-family:var(--font-mono,monospace);'
            + 'color:var(--accent);"></div>'
            + '<div id="agwatch-stav" style="' + mala + 'text-align:center;opacity:.75;min-height:1.2em"></div>'
            + '<button class="btn" id="agwatch-gen" style="margin-top:12px;">Vygenerovat kód</button>'
            + '<p style="' + mala + 'opacity:.75;margin:14px 0 0;">Kód opiš v <b>Garmin Connect</b>: '
            + 'Zařízení → Connect IQ → AR Geodet → Nastavení → „Párovací kód z mobilu“. Pak na '
            + 'hodinkách dlouze podrž ↑ a dej <b>Synchronizovat s mobilem</b>.</p>'
            + '<button class="btn btn-secondary" style="margin-top:10px;" id="agwatch-x">Zavřít</button>'
            + '</div>';
        document.body.appendChild(back);

        back.querySelector('#agwatch-job').textContent = '„' + job + '“';
        back.querySelector('#agwatch-x').onclick = function () { back.remove(); };
        back.onclick = function (e) { if (e.target === back) { back.remove(); } };

        var btn = back.querySelector('#agwatch-gen');
        btn.onclick = function () {
            btn.disabled = true;
            back.querySelector('#agwatch-stav').textContent = 'generuji…';
            u.cloudFetch('/watch/code', { method: 'POST', body: { job: job } }).then(function (r) {
                btn.disabled = false;
                if (!r || !r.ok || !r.data || !r.data.code) {
                    back.querySelector('#agwatch-stav').textContent =
                        (r && r.status === 404)
                            ? 'server tuhle funkci ještě neumí — nasaď nový worker'
                            : 'nepovedlo se (' + (r ? r.status : '?') + ')';
                    return;
                }
                back.querySelector('#agwatch-kod').textContent = r.data.code;
                odpocet(back, r.data.exp);
            }, function () {
                btn.disabled = false;
                back.querySelector('#agwatch-stav').textContent = 'server neodpovídá';
            });
        };
    }

    // Odpočet do vypršení — kód platí 10 minut a je jednorázový, ať je vidět,
    // že se čekáním nic nezkazí, jen se vygeneruje znovu.
    function odpocet(back, exp) {
        var el = back.querySelector('#agwatch-stav');
        function tik() {
            if (!document.body.contains(back)) { return; }
            var z = Math.round((exp - Date.now()) / 1000);
            if (z <= 0) { el.textContent = 'kód vypršel — vygeneruj nový'; return; }
            el.textContent = 'platí ještě ' + Math.floor(z / 60) + ':' + ('0' + (z % 60)).slice(-2);
            setTimeout(tik, 1000);
        }
        tik();
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
