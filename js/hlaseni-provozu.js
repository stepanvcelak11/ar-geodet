// ===== QTRIG — HLÁŠENÍ PROVOZU (ODPOJITELNÁ vrstva) ===========================
// PROBLÉM (14. 11. 2026, vlastník): „nevidím, že by appku někdo zapnul — přitom mi
// člověk napsal, že ji používá, a vím o dalších dvou." Grafy v konzoli vlastníka
// stály jen na záznamech užívání (js/ucty.js usageLog), a ty vznikají JEN ve
// firemním režimu a na server odcházejí jen s přihlášením do firmy. Kdo appku
// používal sám za sebe, byl pro konzoli neviditelný.
//
// ŘEŠENÍ: 1× denně (při prvním spuštění dne, když je signál) pošle appka na
// POST /alive jen tohle:
//   dev    náhodný kód zařízení (vyrobený tady, NEodvozený z telefonu)
//   ver    verze appky (v426…)
//   tarif  'pro' / 'zaklad'
//   lang   jazyk appky
//   os     systém (iOS 18.1 PWA, Android 15…)
//   ucet   kód účtu, je-li člověk přihlášený (aby mu vlastník mohl dát Pro)
// Žádná poloha, body, jméno ani obsah. Server drží jeden řádek na zařízení a den.
//
// VYPNUTÍ: Nastavení → Účet a aplikace → Soukromí → „Hlášení provozu". ROZHODNUTÍ VLASTNÍKA: kdo si
// hlášení vypne, nemá Pro (js/licence.js jePro() se ptá AGHlaseni.vypnuto()) —
// vlastník ho pak nevidí a Pro mu nemůže dát ani ověřit. Přepínač na to PŘED
// vypnutím upozorní (a řekne, jestli Pro právě ztrácí, nebo ho nebude moct dostat).
// Vlastník appky (konzole) Pro neztrácí nikdy.
//
// Odstranění: smaž tenhle soubor + řádek v index.html (a přegeneruj sw.js);
// js/licence.js bez AGHlaseni bere hlášení jako zapnuté.
// ================================================================================
(function () {
    'use strict';
    if (window.__agHlaseniInit) return;
    window.__agHlaseniInit = true;

    var LS_VYP = 'agHlaseni_v1';        // '0' = vypnuto (čte i js/licence.js, proto jednoduchý klíč)
    var LS_DEV = 'agHlaseniDev_v1';     // náhodný kód zařízení
    var LS_DEN = 'agHlaseniDen_v1';     // den posledního úspěšného hlášení (YYYY-MM-DD)
    var API_FALLBACK = 'https://ar-geodet-api.ar-geodet.workers.dev';

    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, 'hlaseni-provozu:' + kde); } catch (e2) { /* nic */ } }
    function T(cs, o) { var v = cs; try { if (window.AGJazyk) v = AGJazyk.t(cs); } catch (e) { v = cs; } return o ? v.replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }) : v; }
    function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { swallow(e, 'ls'); } return null; }

    function vypnuto() { return ls(LS_VYP) === '0'; }
    function dnes() { return new Date().toISOString().slice(0, 10); }
    function kodZarizeni() {
        var d = ls(LS_DEV);
        if (d && /^[a-z0-9]{12,40}$/.test(d)) return d;
        var b = '';
        try {
            var a = new Uint8Array(12); crypto.getRandomValues(a);
            for (var i = 0; i < a.length; i++) b += (a[i] % 36).toString(36);
        } catch (e) { for (var j = 0; j < 16; j++) b += Math.floor(Math.random() * 36).toString(36); }
        d = 'z' + b;
        ls(LS_DEV, d);
        return d;
    }
    // čitelná podoba pro člověka (do Nastavení, ať ji může nadiktovat vlastníkovi)
    function kodCitelny() { var d = kodZarizeni().slice(1, 9).toUpperCase(); return d.slice(0, 4) + '-' + d.slice(4); }

    function verze() {
        try {
            var l = document.querySelector('link[rel="stylesheet"][href*="css/style.css?v="]');
            var m = l && (l.getAttribute('href') || '').match(/\?v=(\d+)/);
            if (m) return 'v' + m[1];
        } catch (e) { swallow(e, 'verze'); }
        return '';
    }
    function system() {
        var ua = String(navigator.userAgent || ''), d;
        var i = /iPhone OS (\d+)_(\d+)/.exec(ua), a = /Android ([\d.]+)/.exec(ua);
        d = i ? ('iOS ' + i[1] + '.' + i[2]) : a ? ('Android ' + a[1]) : (/Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'jiny');
        try { if (window.matchMedia && matchMedia('(display-mode: standalone)').matches) d += ' PWA'; } catch (e) { swallow(e, 'pwa'); }
        return d;
    }
    function api() {
        try { var f = window.AGUcty && AGUcty.getFirm && AGUcty.getFirm(); if (f && f.api) return f.api; } catch (e) { swallow(e, 'api'); }
        try { if (window.AGUcty && AGUcty.DEFAULT_API) return AGUcty.DEFAULT_API; } catch (e) { swallow(e, 'api2'); }
        return API_FALLBACK;
    }
    function ucet() {
        try { var u = window.AGUcty && AGUcty.ucet && AGUcty.ucet(); if (u && u.code) return String(u.code); } catch (e) { swallow(e, 'ucet'); }
        return null;
    }

    var _bezi = false;
    function nahlas(vynutit) {
        if (vypnuto() || _bezi) return;
        if (!vynutit && ls(LS_DEN) === dnes()) return;
        if (navigator.onLine === false) return;
        _bezi = true;
        var telo = {
            dev: kodZarizeni(), ver: verze(),
            tarif: (window.AGLic && AGLic.isPro && AGLic.isPro()) ? 'pro' : 'zaklad',
            lang: (function () { try { return (window.AGJazyk && AGJazyk.get && AGJazyk.get()) || 'cs'; } catch (e) { return 'cs'; } })(),
            os: system(), ucet: ucet()
        };
        try {
            fetch(api() + '/alive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(telo), cache: 'no-store', keepalive: true })
                .then(function (r) { if (r && r.ok) ls(LS_DEN, dnes()); })
                .catch(function () { /* bez signálu — zkusí se příště */ })
                .then(function () { _bezi = false; });
        } catch (e) { _bezi = false; swallow(e, 'fetch'); }
    }

    function zmenaPro() { try { window.dispatchEvent(new CustomEvent('aglic:zmena', { detail: window.AGLic && AGLic.stav ? AGLic.stav() : {} })); } catch (e) { swallow(e, 'zmena'); } }

    // ---- přepínač v Nastavení → Soukromí ------------------------------------------
    function popisek() {
        return '<span class="st-lab">' + T('Hlášení provozu') + '<small>'
            + T('Jednou denně pošle jen náhodný kód zařízení, verzi appky, Základ/Pro, jazyk a systém — žádnou polohu, body ani jméno. Bez něj nejde mít Pro.')
            + ' ' + T('Kód zařízení:') + ' <b id="ag-hl-kod">' + kodCitelny() + '</b></small></span>';
    }
    // Nastavení → Účet a aplikace, nová sekce „Soukromí" nad „Aplikace"
    function vlozPrepinac() {
        if (document.getElementById('ag-hl-row')) return true;
        var tab = document.getElementById('tab-ucet');
        if (!tab) return false;
        var kotva = null;
        Array.prototype.forEach.call(tab.querySelectorAll('.set-h'), function (h) { if (!kotva && /Aplikace|App/i.test(h.textContent)) kotva = h; });
        var nad = document.createElement('div');
        nad.className = 'set-h'; nad.id = 'ag-hl-h'; nad.textContent = T('Soukromí');
        var div = document.createElement('div');
        div.className = 'st-row'; div.id = 'ag-hl-row';
        div.setAttribute('data-ns-keep', '');   // krátké nastavení (js/nastaveni-hledani.js) ho nesmí schovat
        div.innerHTML = popisek() + '<label class="st-sw"><input type="checkbox" id="ag-hl-switch"><span class="st-sw-face"></span></label>';
        if (kotva) { tab.insertBefore(nad, kotva); tab.insertBefore(div, kotva); }
        else { tab.appendChild(nad); tab.appendChild(div); }
        var cb = div.querySelector('#ag-hl-switch');
        cb.checked = !vypnuto();
        cb.addEventListener('change', function () {
            if (cb.checked) { zapni(); return; }
            cb.checked = true;          // dokud nepotvrdí, zůstává zapnuto
            potvrdVypnuti().then(function (ano) {
                if (!ano) return;
                vypni();
                cb.checked = false;
            });
        });
        return true;
    }
    function maProTed() {
        // Pro, které by vypnutím zmizelo (vlastník appky ho neztrácí, viz js/licence.js)
        try { var s = window.AGLic && AGLic.stav && AGLic.stav(); return !!(s && s.pro && s.zdroj !== 'vlastnik'); } catch (e) { return false; }
    }
    function potvrdVypnuti() {
        var maPro = maProTed();
        var msg = maPro
            ? T('<b>Přijdeš o verzi Pro.</b> Pro platí jen se zapnutým hlášením — bez něj tě autor appky nevidí a nemůže ti Pro ověřit. Zámky Pro se vrátí hned po vypnutí; po zapnutí se Pro zase obnoví.')
            : T('<b>Nebudeš moct dostat verzi Pro.</b> Pro jde mít jen se zapnutým hlášením — bez něj tě autor appky nevidí, takže ti Pro nemůže dát ani ověřit.');
        msg += '<br><br>' + T('Hlášení posílá jen náhodný kód zařízení, verzi appky, Základ/Pro, jazyk a systém — žádnou polohu, body ani jméno.');
        var o = { title: T('Vypnout hlášení provozu?'), message: msg, okText: maPro ? T('Vypnout a přijít o Pro') : T('Vypnout'), cancelText: T('Nechat zapnuté'), danger: true };
        try { if (typeof window.agAsk === 'function') return Promise.resolve(window.agAsk(msg, o)); } catch (e) { swallow(e, 'ask'); }
        return Promise.resolve(window.confirm(msg.replace(/<[^>]+>/g, '')));
    }
    function vypni() {
        var predtim = window.AGLic && AGLic.isPro && AGLic.isPro();
        ls(LS_VYP, '0');
        if (predtim) zmenaPro();
        try { if (typeof quickToast === 'function') quickToast(T('Hlášení provozu vypnuto.')); } catch (e) { swallow(e, 'toast'); }
    }
    function zapni() {
        var predtim = window.AGLic && AGLic.isPro && AGLic.isPro();
        ls(LS_VYP, null);
        if (!predtim && window.AGLic && AGLic.isPro()) zmenaPro();
        nahlas(true);
        try { if (typeof quickToast === 'function') quickToast(T('Hlášení provozu zapnuto.')); } catch (e) { swallow(e, 'toast'); }
    }

    function start() {
        if (!vlozPrepinac()) setTimeout(vlozPrepinac, 3000);
        setTimeout(function () { nahlas(false); }, 4000);   // až po startu, ať nebrzdí první obraz
    }
    window.addEventListener('online', function () { setTimeout(function () { nahlas(false); }, 2000); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') nahlas(false); });   // přes půlnoc otevřená appka

    window.AGHlaseni = { vypnuto: vypnuto, nahlas: nahlas, kod: kodCitelny, zarizeni: kodZarizeni };
    if (document.body && document.body.classList.contains('app-started')) start();
    else window.addEventListener('ag:app-started', start, { once: true });
})();
