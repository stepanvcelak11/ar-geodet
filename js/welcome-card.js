// AR Geodet — karta aktivní zakázky na úvodu (Návrh C „Zakázka v centru").
// Plní #w-proj-name a #w-proj-chips reálnými daty (název zakázky + chip počtu bodů a data vzniku).
// Samostatný soubor: NEzasahuje do logika.js/grafika.js, jen obaluje jejich funkce
// (loadProjectSettings / renderProjectSelect), aby se karta přepočítala při každé změně.
// Načítat AŽ PO logika.js, grafika.js a zakazky.js.
(function () {
    'use strict';

    // České skloňování slova "bod"
    function bodWord(n) { return (n === 1) ? 'bod' : (n >= 2 && n <= 4) ? 'body' : 'bodů'; }

    // Aktuální název zakázky — primárně z DOM selectu (vždy aktuální), fallback z 'projects'
    function activeName() {
        var sel = document.getElementById('w-project-select');
        if (sel && sel.selectedOptions && sel.selectedOptions.length) return sel.selectedOptions[0].text;
        if (sel && sel.options && sel.selectedIndex >= 0) return sel.options[sel.selectedIndex].text;
        try {
            if (typeof projects !== 'undefined' && Array.isArray(projects) && typeof activeProjectId !== 'undefined') {
                var p = projects.find(function (x) { return x.id === activeProjectId; });
                if (p) return p.name;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'welcome-card:activeName'); }
        return 'Zakázka';
    }

    // Počet vlastních (uložených) bodů v aktivní zakázce
    function savedPointCount() {
        try {
            if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) {
                return persistentCustomPoints.length;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'welcome-card:savedPointCount'); }
        try {
            if (typeof getStoredData === 'function') {
                var raw = getStoredData('arCustomPoints12');
                if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.length; }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'welcome-card:savedPointCount'); }
        return 0;
    }

    // Datum vzniku zakázky z id 'proj_<timestamp>' (výchozí zakázka razítko nemá → null)
    function projectCreatedDate() {
        try {
            var id = (typeof activeProjectId !== 'undefined') ? activeProjectId : null;
            var sel = document.getElementById('w-project-select');
            if (!id && sel && sel.value) id = sel.value;
            var m = /^proj_(\d{10,})$/.exec(id || '');
            if (!m) return null;
            var ts = parseInt(m[1], 10);
            return isFinite(ts) ? new Date(ts) : null;
        } catch (e) { return null; }
    }
    function relDate(d) {
        var now = new Date();
        var a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        var diff = Math.round((a - b) / 86400000);
        if (diff <= 0) return 'dnes';
        if (diff === 1) return 'včera';
        return d.getDate() + '. ' + (d.getMonth() + 1) + '.';
    }
    var CLOCK_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

    function updateWelcomeProjectCard() {
        var nameEl = document.getElementById('w-proj-name');
        var chipsEl = document.getElementById('w-proj-chips');
        if (!nameEl && !chipsEl) return; // jiný návrh úvodu — nic neděláme
        if (nameEl) nameEl.textContent = activeName();
        if (chipsEl) {
            var n = savedPointCount();
            var html = (n > 0)
                ? '<span class="w-proj-chip"><svg class="icon"><use href="#i-map-pin"/></svg><span><b>' + n + '</b> ' + bodWord(n) + '</span></span>'
                : '<span class="w-proj-chip empty"><svg class="icon"><use href="#i-map-pin"/></svg><span>zatím bez bodů</span></span>';
            var d = projectCreatedDate();
            if (d) html += '<span class="w-proj-chip">' + CLOCK_SVG + '<span>' + relDate(d) + '</span></span>';
            chipsEl.innerHTML = html;
        }
    }
    window.updateWelcomeProjectCard = updateWelcomeProjectCard;

    // Obalí globální funkci tak, aby po jejím doběhnutí přepočítala kartu (i pro async řetězce)
    function wrapAfter(name) {
        if (typeof window[name] !== 'function' || window[name]._wcWrapped) return;
        var orig = window[name];
        var wrapped = function () {
            var r = orig.apply(this, arguments);
            try { setTimeout(updateWelcomeProjectCard, 0); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'welcome-card:wrapped'); }
            return r;
        };
        wrapped._wcWrapped = true;
        try { Object.defineProperty(wrapped, 'name', { value: name }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'welcome-card:wrapped'); }
        window[name] = wrapped;
    }

    // loadProjectSettings běží po hydrataci při startu i při každém přepnutí zakázky
    // (changeProject, changeProjectFromSettings, createNewProject, undo, průvodce) → spolehlivý hák.
    wrapAfter('loadProjectSettings');
    // renderProjectSelect aktualizuje název hned (než doběhne async načtení bodů).
    wrapAfter('renderProjectSelect');

    // LETÍCÍ HODNOTY NA POZADÍ (čas, poloha, teplota…) — návrh ②.
    // Byly naprogramované jen pro přihlašovací obrazovku v js/ucty.js, takže je
    // uživatel s trvalým přihlášením ani host na úvodní kartě nikdy neviděl
    // (nahlášeno 8. 8. 2026). Vrstvu sem vloží AGUcty.mountLive() — nic nestahuje
    // ani nezapíná GPS, čte jen localStorage.
    // ⚠ js/ucty.js se v index.html načítá AŽ ZA tímhle souborem, takže window.AGUcty
    // při jeho spuštění ještě neexistuje; proto se to zkouší až po doběhnutí všech
    // defer skriptů a párkrát se to zopakuje.
    function mountLiveBg(tries) {
        var ws = document.getElementById('welcome-screen');
        if (!ws || ws.querySelector('.agl-live')) return;
        if (window.AGUcty && typeof AGUcty.mountLive === 'function') {
            try { AGUcty.mountLive(ws); } catch (e) { console.warn('[welcome-card] mountLive', e); }
            return;
        }
        if ((tries || 0) < 10) setTimeout(function () { mountLiveBg((tries || 0) + 1); }, 150);
    }

    // ================================================================================
    // KLID PO STARTU (29. 8. 2026 — zpětná vazba z testu balíčku pro Google Play)
    // ================================================================================
    // 1) Lišta „Nová verze — klepni pro obnovení" naskakovala hned v první vteřině
    //    po otevření appky. Člověk ještě nepřečetl úvodní obrazovku a už na něj
    //    bliká výzva k restartu. Aktualizace nikam neutíká (čeká ve service workeru,
    //    dokud se appka nezavře), tak se prvních QUIET_MS jen podrží.
    //    POZOR: lištu zobrazuje showUpdateBanner() z js/grafika.js přes inline
    //    style.display='flex' (výchozí je none z css/style.css) — proto se hlídá
    //    inline styl, ne třída.
    var QUIET_MS = 120000;              // 2 minuty ticha po startu
    var _t0 = Date.now();
    var _quietTimer = null;

    function bannerQuiet() {
        var b = document.getElementById('update-banner');
        if (!b) return;
        if (Date.now() - _t0 < QUIET_MS) {
            if (b.style.display && b.style.display !== 'none') {
                b.setAttribute('data-ag-held', '1');
                b.style.display = 'none';
            }
            return;
        }
        // ticho skončilo — co se podrželo, se teď ukáže
        if (b.getAttribute('data-ag-held') === '1') {
            b.removeAttribute('data-ag-held');
            b.style.display = 'flex';
        }
        if (_quietTimer) { clearInterval(_quietTimer); _quietTimer = null; }
    }

    // 2) Když se js/ucty.js vůbec nerozběhne (offline start s nedotaženou cache),
    //    sundá pojistka v index.html třídu ag-prelock a ZPOD zámku vyjede úvodní
    //    obrazovka — vypadá to jako appka bez přihlašování (nahlášeno 29. 8. 2026
    //    z letového režimu) a je to i díra v zámku při startu. Tady se ten stav
    //    pozná a místo úvodní karty se ukáže poctivé „nenačetlo se to celé".
    function lockedButOpen() {
        try {
            if (document.getElementById('ag-login') || document.getElementById('ag-gate')) return false;
            if (localStorage.getItem('agGuest_v1')) return false;              // host je v pořádku
            if (localStorage.getItem('agLockStart_v1') === '0') return false;  // zámek při startu vypnutý
            if (localStorage.getItem('agFirmaSess_v1')) return false;          // přihlášení proběhlo
            var f = JSON.parse(localStorage.getItem('agFirma_v1') || 'null');
            return !!(f && f.enabled && f.users && f.users.length);
        } catch (e) { return false; }
    }

    function bootFail() {
        if (document.getElementById('ag-bootfail')) return;
        var ws = document.getElementById('welcome-screen');
        if (ws) ws.style.display = 'none';
        var d = document.createElement('div');
        d.id = 'ag-bootfail';
        d.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:999998', 'display:flex',
            'flex-direction:column', 'align-items:center', 'justify-content:center',
            'gap:14px', 'padding:24px', 'box-sizing:border-box', 'text-align:center',
            'background:#0c1014', 'color:#e8edf2',
            'font:400 14px/1.5 var(--font-ui,system-ui),sans-serif'
        ].join(';');
        d.innerHTML =
            '<div style="font:800 20px/1.2 var(--font-display,system-ui),sans-serif">AR Geodet</div>' +
            '<div style="max-width:300px;color:#9aa1ac">Appka se nestihla načíst celá — nejspíš se to zapínalo bez signálu.' +
            ' Zkus to znovu, ať se přihlášení ukáže správně.</div>' +
            '<button type="button" style="margin-top:4px;border:0;border-radius:13px;padding:13px 26px;cursor:pointer;' +
            'background:#2f9e74;color:#04120a;font:700 14px/1 var(--font-ui,system-ui),sans-serif">Spustit znovu</button>';
        document.body.appendChild(d);
        var btn = d.querySelector('button');
        if (btn) btn.onclick = function () { try { location.reload(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'welcome-card:reload'); } };
    }

    // Kontroluje se až PO pojistkách v ucty.js (6 s) a index.html (8 s), jinak by
    // to křičelo na normální, jen pomalý start.
    function watchBoot() {
        setTimeout(function () { if (lockedButOpen()) bootFail(); }, 10000);
        setTimeout(function () { if (lockedButOpen()) bootFail(); }, 16000);
    }

    // Úvodní vykreslení (kdyby start proběhl dřív, než se tenhle soubor zapojil)
    function kick() {
        setTimeout(updateWelcomeProjectCard, 60);
        setTimeout(mountLiveBg, 80);
        bannerQuiet();
        _quietTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(bannerQuiet, 1000);
        setTimeout(bannerQuiet, QUIET_MS + 200);
        watchBoot();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kick);
    else kick();
})();
