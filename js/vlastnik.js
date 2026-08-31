// ===== AR Geodet — REŽIM VLASTNÍKA APLIKACE (ODPOJITELNÁ vrstva) ===============
// Jedno zvláštní přihlášení rovnou na úvodní bráně: vlastník (vývojář) aplikace se
// odemkne KLÍČEM (OWNER_KEY ze serveru), dostane VŠECHNA oprávnění bez ohledu na
// firmy a role a v „Více" mu přibude jediný vchod do vývojářských nástrojů —
// KONZOLE VLASTNÍKA.
//
// ⚠ PROČ TENHLE MODUL VZNIKL: klíč konzole se dosud dal zadat jen tlačítkem
//   v Nastavení → Údržba, jenže TO SE UKÁZALO JEN TOMU, KDO KLÍČ UŽ ULOŽENÝ MĚL
//   (viz injectSettings v js/sprava-appky.js a js/zpetna-vazba.js). Slepice a
//   vejce — kdo klíč v telefonu neměl, neměl ho ani kam napsat. Odsud pramenilo
//   „klíč mi nefunguje". Vstup je proto na BRÁNĚ i na přihlašovací obrazovce
//   (byť skrytý, viz níž) a hlášky říkají přesně, co je špatně (403 = jiná
//   hodnota, 503 = na serveru žádný klíč není, 404 = starý worker, 0 = síť).
//
// ⚠ O PŘÍSTUPU KE CIZÍM DATŮM POŘÁD ROZHODUJE SERVER. Klíč se ověřuje dotazem na
//   /owner/firms a bez správné hodnoty vrátí server 403, i kdyby si někdo příznak
//   v telefonu podvrhl. Příznak `agVlastnik_v1` odemyká jen UI TOHOTO telefonu
//   (dlaždice, záložky, nástroje) — tedy data, která v tom telefonu stejně už
//   leží. Nic cizího se tím neotevře.
//
// REŽIM VLASTNÍKA ZKRATUJE CELOU VRSTVU ÚČTŮ: brána se neukáže, přihlašovací
//   obrazovka taky ne a AGUcty.can() vrací vždy true. Firma se nezakládá ani
//   nepřepisuje — kdo měl na zařízení firmu, najde ji po ukončení režimu
//   nedotčenou (tři místa v js/ucty.js označená komentářem „režim vlastníka").
//
// ⚠ VSTUP NA BRANE JE SCHVALNE NEVIDITELNY (na prani 30. 8. 2026): na uvodni
//   obrazovce nema stat nic, co ostatnim rekne, ze appka ma zvlastni rezim pro
//   vyvojare. Otevira ho DLOUHY STISK ZNAKU APPKY (kolecko s logem nahore,
//   .agl-mark) po dobu HOLD_MS. Od 400. ms se znak pomalu zmensuje a bledne —
//   to vidi jen ten, kdo drzi, takze to nic neprozradi, ale drzeni to prestane
//   byt loterie. Odezva se pri pusteni vzdy vrati zpatky (funkce konec()).
//
// Vstupy: brana → dlouhy stisk znaku appky; Vice → „Konzole vlastnika";
//   window.agOpenKonzole().
//
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + './js/vlastnik.js'
// v sw.js a tři místa v js/ucty.js označená komentářem „režim vlastníka".
// ================================================================================
(function () {
    'use strict';
    if (window.AGVlastnik) return;

    var LS_KEY = 'agFbKey_v1';        // tentýž klíč jako schránka a Správa aplikace
    var LS_ON = 'agVlastnik_v1';      // příznak režimu na TOMTO zařízení
    var MODAL_ID = 'agv-modal';
    var STYLE_ID = 'agv-style';
    var API_FALLBACK = 'https://ar-geodet-api.ar-geodet.workers.dev';
    var HOLD_MS = 1600;               // jak dlouho drzet znak appky, nez se vstup otevre
    var VERIFY_GAP = 6 * 3600000;     // jak casto se klic potichu preveri na serveru
    var LS_VERIF = 'agVlastnikOveren_v1';

    // Konzole je jedno okno s nekolika pohledy: '' = rozcestnik, 'flags' = vypinac
    // modulu, 'errors' = chyby od lidi, 'usage' = zebricek nastroju. Zamerne jedno
    // okno: druhy modal nad modalem se na telefonu spatne zaviral a pod nim zustaval
    // otevreny prvni.
    var _view = '', _load = null, _pick = null, _dni = 14;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M14.7 6.3a5 5 0 0 0 6 6l-9.9 9.9a2.1 2.1 0 0 1-3 0l-3-3a2.1 2.1 0 0 1 0-3z"/><circle cx="18" cy="6" r="3"/></svg>';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'vlastnik:' + kde); } catch (x) { } }
    function esc(s) {
        if (window.AG && AG.esc) return AG.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function agAlert(t, m) {
        try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { swallow(e, 'agAlert'); }
        try { agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e) { swallow(e, 'agAlert2'); }
    }
    function ask(m) {
        try { if (typeof window.agAsk === 'function') return window.agAsk(m); } catch (e) { swallow(e, 'ask'); }
        return Promise.resolve(window.confirm(m));
    }

    // ---- klíč a příznak ---------------------------------------------------------
    function key() { try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; } }
    function setKey(k) {
        try { if (k) localStorage.setItem(LS_KEY, k); else localStorage.removeItem(LS_KEY); } catch (e) { swallow(e, 'setKey'); }
    }
    function isOn() { try { return localStorage.getItem(LS_ON) === '1'; } catch (e) { return false; } }
    function setOn(v) {
        try { if (v) localStorage.setItem(LS_ON, '1'); else localStorage.removeItem(LS_ON); } catch (e) { swallow(e, 'setOn'); }
    }

    function base() {
        try {
            var u = window.AGUcty;
            if (u && typeof u.apiUrl === 'function') return u.apiUrl();
            if (u && u.DEFAULT_API) return u.DEFAULT_API;
        } catch (e) { swallow(e, 'base'); }
        return API_FALLBACK;
    }
    // Vlastní fetch s hlavičkou X-Owner-Key (AGUcty.cloudFetch ji předat neumí).
    // Timeout ze stejného důvodu jako u schránky: na „mrtvém, ale otevřeném" spoji
    // visí dotaz jinak minuty a drží rádio ve vysokém příkonu.
    function api(path, k, timeoutMs, opts) {
        opts = opts || {};
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var to = null, p;
        try {
            p = fetch(base() + path, {
                method: opts.method || 'GET',
                headers: { 'Content-Type': 'application/json', 'X-Owner-Key': (k == null ? key() : k) },
                body: opts.body != null ? JSON.stringify(opts.body) : undefined,
                signal: ctrl ? ctrl.signal : undefined
            });
            if (ctrl) to = setTimeout(function () { try { ctrl.abort(); } catch (e) { swallow(e, 'abort'); } }, timeoutMs || 15000);
        } catch (e) {
            if (to) clearTimeout(to);
            return Promise.resolve({ ok: false, status: 0, data: null });
        }
        return p.then(function (r) {
            if (to) { clearTimeout(to); to = null; }
            return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
        }).catch(function () {
            if (to) clearTimeout(to);
            return { ok: false, status: 0, data: null };
        });
    }

    // Co je na klíči špatně, řečeno lidsky. Tohle je jádro celé opravy: dosud
    // uživatel viděl jen „Špatný klíč" i tehdy, když na serveru VŮBEC ŽÁDNÝ NEBYL.
    function proc(r) {
        if (r.ok) return '';
        if (r.status === 0) return 'Server neodpověděl. Zkontroluj připojení a zkus to znovu.';
        if (r.status === 503) return 'Na serveru zatím žádný klíč nastavený není. Nastav ho na dash.cloudflare.com → Workers &amp; Pages → <b>ar-geodet-api</b> → Settings → Variables and Secrets → přidej secret <b>OWNER_KEY</b>. Pak sem napiš tutéž hodnotu.';
        if (r.status === 403) return 'Tenhle klíč serveru nesedí. Musí to být PŘESNĚ hodnota, která je na Cloudflare uložená jako secret <b>OWNER_KEY</b> — rozlišuje velká a malá písmena a vadí i mezera na konci.';
        if (r.status === 404) return 'Server tuhle funkci nezná — běží na něm starší verze. Nasaď aktuální cloud/worker.js (wrangler deploy).';
        return 'Server odpověděl chybou ' + r.status + '.';
    }

    // ---- přihlášení vlastníka na bráně / přihlašovací obrazovce -----------------
    function loginOverlay() {
        return document.getElementById('ag-gate') || document.getElementById('ag-login') || null;
    }
    // Karta se NEPŘEKRESLUJE na místě staré (to by sebralo obsluhu tlačítek brány),
    // ale položí se do TÉHOŽ overlaye vedle ní a stará se jen schová. Díky tomu na
    // ni platí hotové styly `#ag-gate .agl-btn` i `#ag-login .agl-btn`.
    function login() {
        var ov = loginOverlay();
        if (!ov) { promptKey(); return; }          // appka už běží → jen zeptat na klíč
        if (ov.querySelector('.agv-card')) return; // už je otevřené
        injectStyles();
        var stara = ov.querySelector('.agl-card');
        if (stara) stara.style.display = 'none';

        var card = document.createElement('div');
        card.className = 'agl-card agv-card';
        card.innerHTML =
            '<div class="agv-mark">' + ICON + '</div>' +
            '<div class="agl-logo" style="font:800 19px/1.2 var(--font-display,system-ui);">Vlastník aplikace</div>' +
            '<div class="agl-firm">Zvláštní přihlášení pro toho, kdo aplikaci dělá. Odemkne všechny nástroje bez ohledu na firmy a role a přidá konzoli s přehledem celé aplikace.</div>' +
            '<input type="password" class="agv-inp" id="agv-key" placeholder="Klíč vlastníka" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">' +
            '<div class="agl-err" id="agv-err"></div>' +
            '<button type="button" class="agl-btn" id="agv-go">Odemknout</button>' +
            '<button type="button" class="agl-ghost" id="agv-back">Zpět na běžné přihlášení</button>' +
            '<div class="agv-note">Klíč je secret <b>OWNER_KEY</b> workeru na Cloudflare. Uloží se jen do tohohle telefonu.</div>';
        ov.appendChild(card);

        var inp = card.querySelector('#agv-key');
        var err = card.querySelector('#agv-err');
        var go = card.querySelector('#agv-go');
        var busy = false;

        // Uložený klíč se předvyplní: kdo stojí u brány s odemčeným telefonem, ten
        // si ho stejně přečte v úložišti — zato je hned vidět, že tam nějaký JE.
        if (key()) inp.value = key();
        setTimeout(function () { try { inp.focus(); } catch (e) { swallow(e, 'focus'); } }, 60);

        function zpet() {
            card.remove();
            if (stara) stara.style.display = '';
        }
        function submit() {
            if (busy) return;
            var k = (inp.value || '').trim();
            if (!k) { err.innerHTML = 'Napiš klíč.'; return; }
            busy = true; go.disabled = true; err.innerHTML = 'Ověřuji na serveru…';
            api('/owner/firms', k).then(function (r) {
                busy = false; go.disabled = false;
                if (!r.ok) { err.innerHTML = proc(r); return; }
                setKey(k); setOn(true);
                err.innerHTML = '';
                enter();
            });
        }
        go.addEventListener('click', submit);
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
        card.querySelector('#agv-back').addEventListener('click', zpet);
    }

    // Pustit vlastníka do aplikace: sundat bránu i přihlašovací obrazovku, srovnat
    // oprávnění (teď už can() vrací všude true) a přeskočit úvodní kartu — brána
    // byla vstupní obrazovkou, druhé „Spustit" by bylo klepnutí navíc.
    function enter() {
        try {
            var g = document.getElementById('ag-gate'); if (g) g.remove();
            var l = document.getElementById('ag-login'); if (l) l.remove();
        } catch (e) { swallow(e, 'enter:overlay'); }
        try { document.documentElement.classList.remove('ag-prelock'); } catch (e) { swallow(e, 'enter:prelock'); }
        try { if (window.AGUcty && AGUcty.applyPerms) AGUcty.applyPerms(); } catch (e) { swallow(e, 'enter:perms'); }
        try { if (!localStorage.getItem('arSurveyor')) localStorage.setItem('arSurveyor', 'Vývojář'); } catch (e) { swallow(e, 'enter:jmeno'); }
        injectMenu();
        // ⚠ 31. 8. 2026 — DŘÍV tu byla podmínka „jen když je zrovna vidět úvodní
        // obrazovka". Ta je zrušená (jediný vchod je přihlášení), takže by neplatila
        // nikdy a po odemčení klíčem by vlastník koukal na nenastartovanou appku.
        // Rozhoduje jediné, na čem záleží: jestli appka UŽ BĚŽÍ.
        try {
            if (!(document.body && document.body.classList.contains('app-started'))) {
                var tries = 0;
                (function go() {
                    if (document.body && document.body.classList.contains('app-started')) return;
                    if (typeof window.startAppFromWelcome === 'function') {
                        try { window.startAppFromWelcome(); } catch (e) { swallow(e, 'enter:start'); }
                        return;
                    }
                    if (tries++ < 40) setTimeout(go, 150);
                })();
            }
        } catch (e) { swallow(e, 'enter:start'); }
        try { if (typeof window.quickToast === 'function') quickToast('Režim vlastníka zapnut — vidíš úplně všechno.'); } catch (e) { swallow(e, 'enter:toast'); }
        setTimeout(open, 500);
    }

    // Změna klíče za běhu (appka už jede, brána není).
    function promptKey() {
        var k = window.prompt('Klíč vlastníka (OWNER_KEY ze serveru):', key());
        if (k == null) return;
        k = k.trim();
        if (!k) { setKey(''); setOn(false); injectMenu(); return agAlert('Klíč smazán', 'Režim vlastníka je vypnutý.'); }
        api('/owner/firms', k).then(function (r) {
            if (!r.ok) return agAlert('Klíč nesedí', proc(r));
            setKey(k); setOn(true); injectMenu();
            try { if (window.AGUcty && AGUcty.applyPerms) AGUcty.applyPerms(); } catch (e) { swallow(e, 'promptKey:perms'); }
            agAlert('Hotovo', 'Klíč sedí — režim vlastníka je zapnutý.');
        });
    }

    function leave() {
        ask('Ukončit režim vlastníka? Aplikace se vrátí k běžnému přihlášení. Klíč zůstane uložený.').then(function (ok) {
            if (!ok) return;
            setOn(false);
            close(); injectMenu();
            try { if (window.AGUcty && AGUcty.applyPerms) AGUcty.applyPerms(); } catch (e) { swallow(e, 'leave:perms'); }
            try { if (window.AGUcty && AGUcty.showGate) AGUcty.showGate(); } catch (e) { swallow(e, 'leave:gate'); }
        });
    }

    // ---- konzole ----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // karta zvláštního přihlášení (žije uvnitř #ag-gate / #ag-login)
            '.agv-card .agv-mark{width:56px;height:56px;color:var(--accent,#2f9e74);}',
            '.agv-card .agv-mark svg{width:100%;height:100%;display:block;}',
            '.agv-card .agv-inp{box-sizing:border-box;width:250px;text-align:center;border-radius:13px;padding:13px 14px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.16));',
            '  color:var(--text-color,#e6e8eb);font:600 15px/1.2 var(--font-mono,monospace);letter-spacing:.06em;outline:none;}',
            '.agv-card .agv-inp:focus{border-color:var(--accent,#2f9e74);}',
            '.agv-card .agv-note{max-width:300px;text-align:center;font:500 11.5px/1.5 var(--font-ui,system-ui);',
            '  color:var(--text-muted,#9aa1ac);}',
            '.agv-card .agl-err{max-width:320px;}',
            // konzole
            '#' + MODAL_ID + ' .agv-hd{display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:13px;margin:0 0 12px;',
            '  background:var(--accent-soft,rgba(47,158,116,0.12));border:1px solid var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .agv-hd b{display:block;font:700 13px/1.3 var(--font-ui,system-ui);color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .agv-hd small{display:block;margin-top:2px;font:500 11.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .agv-sec{font:600 10.5px/1 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);',
            '  text-transform:uppercase;letter-spacing:.06em;margin:16px 0 7px;}',
            '#' + MODAL_ID + ' .agv-it{display:flex;align-items:center;gap:11px;width:100%;box-sizing:border-box;text-align:left;',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  border-radius:12px;padding:11px 12px;margin:0 0 7px;cursor:pointer;color:var(--text-color,#e6e8eb);}',
            '#' + MODAL_ID + ' .agv-it:active{transform:scale(.99);}',
            '#' + MODAL_ID + ' .agv-it .ic{flex:none;width:22px;height:22px;color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .agv-it .ic svg{width:100%;height:100%;display:block;}',
            '#' + MODAL_ID + ' .agv-it .tx{flex:1;min-width:0;}',
            '#' + MODAL_ID + ' .agv-it .tx b{display:block;font:700 13.5px/1.3 var(--font-ui,system-ui);}',
            '#' + MODAL_ID + ' .agv-it .tx small{display:block;margin-top:2px;font:500 11.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .agv-it .go{flex:none;color:var(--text-muted,#9aa1ac);font:700 16px/1 var(--font-ui,system-ui);}',
            '#' + MODAL_ID + ' .agv-it.off{opacity:.45;}',
            '#' + MODAL_ID + ' .agv-st{font:500 12px/1.5 var(--font-mono,monospace);color:var(--text-muted,#9aa1ac);',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));border-radius:11px;padding:9px 11px;word-break:break-word;}',
            '#' + MODAL_ID + ' .agv-st b{color:var(--text-color,#e6e8eb);}',
            '#' + MODAL_ID + ' .agv-st .ok{color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .agv-st .bad{color:#e0574a;}',
            // podpohledy konzole
            '#' + MODAL_ID + ' .agv-back{background:transparent;border:none;color:var(--accent,#2f9e74);',
            '  font:700 13px/1 var(--font-ui,system-ui);padding:2px 0 10px;cursor:pointer;}',
            '#' + MODAL_ID + ' .agv-h2{font:800 17px/1.25 var(--font-display,system-ui);color:var(--text-color,#e6e8eb);margin:0 0 6px;}',
            '#' + MODAL_ID + ' .agv-p{font:500 12.5px/1.55 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:0 0 12px;}',
            '#' + MODAL_ID + ' .agv-p code{font-family:var(--font-mono,monospace);}',
            '#' + MODAL_ID + ' .agv-filtr{display:flex;gap:6px;flex-wrap:wrap;}',
            '#' + MODAL_ID + ' .agv-b{border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:transparent;',
            '  color:var(--text-muted,#9aa1ac);border-radius:9px;padding:7px 11px;font:600 11.5px/1 var(--font-ui,system-ui);cursor:pointer;flex:none;}',
            '#' + MODAL_ID + ' .agv-b.on{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.14));color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .agv-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));margin:0 0 5px;cursor:pointer;}',
            '#' + MODAL_ID + ' .agv-row.off{background:rgba(224,87,74,0.10);}',
            '#' + MODAL_ID + ' .agv-row input{flex:none;margin:0;width:18px;height:18px;}',
            '#' + MODAL_ID + ' .agv-row b{display:block;font:600 12.5px/1.3 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '#' + MODAL_ID + ' .agv-row small{display:block;margin-top:1px;font:500 10.5px/1.2 var(--font-mono,monospace);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .agv-err{border-left:3px solid #e0574a;background:var(--glass-bg,rgba(255,255,255,0.04));',
            '  border-radius:0 10px 10px 0;padding:8px 11px;margin:0 0 7px;}',
            '#' + MODAL_ID + ' .agv-err .hd{display:flex;align-items:center;gap:8px;margin-bottom:3px;}',
            '#' + MODAL_ID + ' .agv-err .hd b{font:800 13px/1 var(--font-display,system-ui);color:#e0574a;}',
            '#' + MODAL_ID + ' .agv-err .fm{font:600 10px/1 var(--font-ui,system-ui);color:#d4a02c;',
            '  background:rgba(212,160,44,0.14);border-radius:999px;padding:3px 7px;}',
            '#' + MODAL_ID + ' .agv-err .dt{margin-left:auto;font:500 10.5px/1 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .agv-err .ms{font:500 12.5px/1.45 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);word-break:break-word;}',
            '#' + MODAL_ID + ' .agv-err .sr{margin-top:3px;font:500 10.5px/1.3 var(--font-mono,monospace);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .agv-bar{position:relative;border-radius:9px;overflow:hidden;margin:0 0 5px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '#' + MODAL_ID + ' .agv-bar .fill{position:absolute;inset:0 auto 0 0;background:var(--accent-soft,rgba(47,158,116,0.18));}',
            '#' + MODAL_ID + ' .agv-bar .tx{position:relative;padding:7px 10px;}',
            '#' + MODAL_ID + ' .agv-bar .tx b{display:block;font:600 12.5px/1.3 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '#' + MODAL_ID + ' .agv-bar .tx small{display:block;margin-top:1px;font:500 10.5px/1.2 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}'
        ].join('');
        document.head.appendChild(st);
    }

    // Co konzole nabízí. `run` se volá až po klepnutí; `lazy` říká, který modul se
    // musí předtím donačíst (js/lazy-load.js) — jinak by tlačítko nic neudělalo.
    function polozky() {
        return [
            {
                sec: 'Celá aplikace',
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/></svg>',
                t: 'Všechny firmy', d: 'Kdo aplikaci používá, kolik má míst, žádosti o navýšení, zmrazení a úklid',
                lazy: 'js/sprava-appky.js', run: function () { if (window.AGSprava) AGSprava.open(); else chybi('js/sprava-appky.js'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H7l-3 3z"/></svg>',
                t: 'Zprávy od lidí', d: 'Schránka „Napište mi" — nápady a hlášení chyb od uživatelů',
                lazy: 'js/zpetna-vazba.js', run: function () { if (window.AGZpetna) AGZpetna.inbox(); else chybi('js/zpetna-vazba.js'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9"/></svg>',
                t: 'Stav serveru', d: 'Verze workeru, co má zapnuté a jestli klíč sedí',
                keep: true, run: function () { stav(true); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="22" height="12" rx="6"/><circle cx="8" cy="12" r="3"/></svg>',
                t: 'Vypínač modulů', d: 'Zhasnout rozbitý nástroj všem, bez čekání na novou verzi',
                keep: true, run: function () { jdi('flags'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
                t: 'Chyby od lidí', d: 'Co padá uživatelům v terénu, seřazeno podle četnosti',
                keep: true, run: function () { jdi('errors'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-5 3 3 5-7"/></svg>',
                t: 'Co lidi doopravdy používají', d: 'Žebříček nástrojů napříč všemi firmami — i ty, co nepoužil nikdo',
                keep: true, run: function () { jdi('usage'); }
            },
            {
                sec: 'Tenhle telefon',
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
                t: 'Protokol chyb', d: 'Co se v aplikaci na tomhle zařízení pokazilo',
                run: function () { if (window.agErrLog) agErrLog.show(); else chybi('js/err-log.js'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-5 3 3 5-7"/></svg>',
                t: 'Přehled užívání', d: 'Které nástroje se doopravdy používají a kdy',
                run: function () { if (typeof window.agOpenMojeAktivita === 'function') agOpenMojeAktivita(); else chybi('js/moje-aktivita.js'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
                t: 'Historie aktualizací', d: 'Co přibylo v které verzi',
                run: function () { if (typeof window.agOpenHistorie === 'function') agOpenHistorie(); else chybi('js/historie-aktualizaci.js'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/></svg>',
                t: 'Administrace firmy', d: 'Uživatelé, role a oprávnění firmy uložené na tomhle zařízení',
                lazy: 'js/ucty-admin.js', run: function () { if (window.AGUctyAdmin) AGUctyAdmin.open(); else chybi('js/ucty-admin.js'); }
            },
            {
                sec: 'Klíč a režim',
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a5 5 0 0 0 6 6l-9.9 9.9a2.1 2.1 0 0 1-3 0l-3-3a2.1 2.1 0 0 1 0-3z"/><circle cx="18" cy="6" r="3"/></svg>',
                t: 'Změnit klíč vlastníka', d: 'Nový klíč se hned ověří na serveru',
                run: function () { promptKey(); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
                t: 'Ukončit režim vlastníka', d: 'Vrátí se běžná brána a přihlášení do firmy',
                keep: true, run: leave
            }
        ];
    }
    function chybi(soubor) {
        agAlert('Modul není v aplikaci', 'Chybí <code>' + esc(soubor) + '</code> — buď byl odpojený, nebo se nestihl načíst.');
    }

    function build() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = MODAL_ID;
        m.setAttribute('data-no-i18n', '');
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h2 style="margin-top:0;"><span style="display:inline-block;width:22px;height:22px;vertical-align:-4px;color:var(--accent);">' + ICON + '</span> Konzole vlastníka</h2>' +
            '  <div class="modal-body" id="agv-body"></div>' +
            '</div>';
        document.body.appendChild(m);
        return m;
    }

    // Kazdy pohled ma jine rozumne okno: u chyb je 14 dni akorat, u zebricku
    // nastroju by z nej vypadly ty sezonni, tak se zacina mesicem.
    function jdi(v) {
        _view = v; _load = null; _pick = null;
        if (v === 'errors') _dni = 14;
        if (v === 'usage') _dni = 30;
        render();
    }

    // Spolecna hlavicka podpohledu (nadpis + zpet na rozcestnik).
    function hlava(nadpis, popis) {
        return '<button type="button" class="agv-back" id="agv-zpet">‹ Konzole</button>' +
            '<div class="agv-h2">' + esc(nadpis) + '</div>' +
            (popis ? '<div class="agv-p">' + popis + '</div>' : '');
    }
    function wireZpet(b) {
        var z = b.querySelector('#agv-zpet');
        if (z) z.addEventListener('click', function () { jdi(''); });
    }
    function cekam(b, txt) { b.innerHTML = '<div class="agv-p" style="padding:26px 4px;text-align:center;">' + esc(txt || 'Načítám…') + '</div>'; }

    // ---- pohled: VYPINAC MODULU -------------------------------------------------
    // Seznam nabizi nastroje z registru (js/tools-registry.js), protoze prave ty
    // ma smysl zhasinat. Pole dole bere cokoli — vcetne `js/soubor.js`, cimz se da
    // vypnout cely lazy modul, ktery se pak ani nestahne.
    function viewFlags(b) {
        if (!_load) {
            cekam(b, 'Načítám stav vypínače…');
            _load = 1;
            api('/owner/firms').then(function (r) {
                if (!r.ok) { _load = null; sayFail(r, 'vypínač'); jdi(''); return; }
                _pick = {};
                (((r.data || {}).flags || {}).off || []).forEach(function (x) { _pick[x] = 1; });
                _load = 2;
                render();
            });
            return;
        }
        var reg = [];
        try { if (window.AGReg && AGReg.all) reg = AGReg.all(); } catch (e) { swallow(e, 'reg'); }
        var vyp = Object.keys(_pick || {});
        var h = [hlava('Vypínač modulů',
            'Vypnutý nástroj se lidem přestane nabízet při nejbližším spuštění aplikace. ' +
            'Zapsat sem smí jen tenhle klíč; ostatní ho jen čtou spolu s konfigurací firmy.')];

        h.push('<div class="agv-st" style="margin-bottom:10px;">Vypnuto teď: <b>' + vyp.length + '</b>' +
            (vyp.length ? ' — ' + esc(vyp.join(', ')) : '') + '</div>');

        h.push('<div class="agv-sec">Nástroje z registru</div>');
        if (!reg.length) h.push('<div class="agv-p">Registr nástrojů se nenačetl, použij pole níž.</div>');
        var cat = '';
        reg.forEach(function (t) {
            var id = t.k;
            if (!id) return;
            if (t.cat !== cat) { cat = t.cat; h.push('<div class="agv-sec">' + esc(cat || 'Ostatní') + '</div>'); }
            var on = !!(_pick && _pick[id]);
            h.push('<label class="agv-row' + (on ? ' off' : '') + '">' +
                '<input type="checkbox" data-flag="' + esc(id) + '"' + (on ? ' checked' : '') + '>' +
                '<span><b>' + esc((t.verb ? t.verb + ' ' : '') + (t.vl || id)) + '</b><small>' + esc(id) + '</small></span>' +
                '</label>');
        });

        // rucne pridane (soubory, nebo id, ktere v registru nejsou)
        var mimo = vyp.filter(function (x) {
            for (var i = 0; i < reg.length; i++) if (reg[i].k === x) return false;
            return true;
        });
        h.push('<div class="agv-sec">Ručně zadané</div>');
        if (!mimo.length) h.push('<div class="agv-p">Zatím nic. Sem patří třeba <code>js/trenazer.js</code> — takový modul se pak vůbec nestáhne.</div>');
        mimo.forEach(function (x) {
            h.push('<label class="agv-row off"><input type="checkbox" data-flag="' + esc(x) + '" checked>' +
                '<span><b>' + esc(x) + '</b><small>ručně zadané</small></span></label>');
        });
        h.push('<div class="sa-line" style="display:flex;gap:6px;margin-top:8px;">' +
            '<input type="text" id="agv-add" placeholder="id nástroje nebo js/soubor.js" style="flex:1;min-width:80px;margin:0;">' +
            '<button type="button" class="agv-b" id="agv-addb">Přidat</button></div>');

        h.push('<button type="button" class="btn" id="agv-save" style="margin-top:16px;">Uložit vypínač</button>');
        h.push('<button type="button" class="btn btn-secondary" id="agv-none" style="margin-top:8px;">Zapnout zase všechno</button>');
        b.innerHTML = h.join('');
        wireZpet(b);
        Array.prototype.forEach.call(b.querySelectorAll('[data-flag]'), function (el) {
            el.addEventListener('change', function () {
                var id = el.getAttribute('data-flag');
                if (el.checked) _pick[id] = 1; else delete _pick[id];
            });
        });
        var add = b.querySelector('#agv-add');
        b.querySelector('#agv-addb').addEventListener('click', function () {
            var v = (add.value || '').trim();
            if (!v) return;
            _pick[v] = 1; add.value = '';
            render();
        });
        b.querySelector('#agv-save').addEventListener('click', function () { ulozFlags(Object.keys(_pick)); });
        b.querySelector('#agv-none').addEventListener('click', function () { ulozFlags([]); });
    }
    function ulozFlags(list) {
        api('/owner/flags', null, 15000, { method: 'PUT', body: { off: list } }).then(function (r) {
            if (!r.ok) return sayFail(r, 'vypínač');
            // Vlastnik ma videt ucinek hned na svem telefonu, ne az po /config.
            try { if (window.AGFlags) AGFlags.set(list, Date.now()); } catch (e) { swallow(e, 'flags:set'); }
            _load = null;
            agAlert('Uloženo', list.length
                ? 'Vypnuto: <b>' + esc(list.join(', ')) + '</b>.<br><br>Lidem se to projeví, jakmile si aplikace natáhne konfiguraci firmy — u spuštěné appky do minuty, jinak při dalším startu.'
                : 'Vypínač je prázdný, všechno je zase zapnuté.');
            render();
        });
    }

    // ---- pohled: CHYBY OD LIDI ---------------------------------------------------
    function viewErrors(b) {
        if (!_load) {
            cekam(b, 'Načítám chyby ze serveru…');
            _load = 1;
            api('/owner/errors?dni=' + _dni).then(function (r) {
                if (!r.ok) { _load = null; sayFail(r, 'chyby'); jdi(''); return; }
                _load = r.data || { rows: [], total: 0 };
                render();
            });
            return;
        }
        var d = _load, rows = d.rows || [];
        var h = [hlava('Chyby od lidí',
            'Sbírá je <code>js/err-log.js</code> v každém telefonu a jednou za deset minut posílá dál. ' +
            'Chodí jen hláška, soubor, řádek a verze — žádné souřadnice ani data měření.')];
        h.push('<div class="agv-filtr">' +
            [7, 14, 30, 90].map(function (x) {
                return '<button type="button" class="agv-b' + (x === _dni ? ' on' : '') + '" data-dni="' + x + '">' + x + ' dní</button>';
            }).join('') + '</div>');
        h.push('<div class="agv-st" style="margin:8px 0 12px;">Celkem <b>' + (d.total || 0) + '</b> výskytů v <b>' + rows.length + '</b> různých chybách</div>');
        if (!rows.length) {
            h.push('<div class="agv-p" style="padding:22px 4px;text-align:center;">Nic nespadlo. Buď je klid, nebo ještě nikdo nemá verzi, která chyby posílá.</div>');
        }
        rows.forEach(function (r) {
            h.push('<div class="agv-err">' +
                '<div class="hd"><b>' + (r.n || 1) + '×</b>' +
                (r.firms > 1 ? '<span class="fm">' + r.firms + ' firmy</span>' : '') +
                '<span class="dt">' + esc(kdy(r.last)) + '</span></div>' +
                '<div class="ms">' + esc(r.msg || '') + '</div>' +
                '<div class="sr">' + esc((r.src || '').split('/').pop() || 'neznámý soubor') +
                (r.line ? ':' + r.line : '') + (r.ver ? ' · ' + esc(r.ver) : '') + '</div>' +
                '</div>');
        });
        h.push('<button type="button" class="btn btn-secondary" id="agv-err-clr" style="margin-top:16px;">Smazat nasbírané chyby</button>');
        b.innerHTML = h.join('');
        wireZpet(b);
        Array.prototype.forEach.call(b.querySelectorAll('[data-dni]'), function (el) {
            el.addEventListener('click', function () { _dni = parseInt(el.getAttribute('data-dni'), 10) || 14; _load = null; render(); });
        });
        b.querySelector('#agv-err-clr').addEventListener('click', function () {
            ask('Smazat všechny nasbírané chyby ze serveru?').then(function (ok) {
                if (!ok) return;
                api('/owner/errors', null, 15000, { method: 'DELETE' }).then(function (r) {
                    if (!r.ok) return sayFail(r, 'mazání chyb');
                    _load = null; render();
                });
            });
        });
    }

    // ---- pohled: ZEBRICEK NASTROJU ------------------------------------------------
    // Nejcennejsi neni prvni desitka, ale POSLEDNI: nastroje, ktere za mesic
    // neotevrel NIKDO. Proto se dopocitavaji z registru a vypisuji zvlast.
    function viewUsage(b) {
        if (!_load) {
            cekam(b, 'Počítám napříč firmami…');
            _load = 1;
            api('/owner/usage?dni=' + _dni).then(function (r) {
                if (!r.ok) { _load = null; sayFail(r, 'užívání'); jdi(''); return; }
                _load = r.data || { rows: [] };
                render();
            });
            return;
        }
        var d = _load, rows = d.rows || [];
        var max = rows.length ? (rows[0].n || 1) : 1;
        var videl = {};
        rows.forEach(function (r) { videl[r.k] = 1; });
        var reg = [];
        try { if (window.AGReg && AGReg.all) reg = AGReg.all(); } catch (e) { swallow(e, 'reg2'); }
        var nikdo = reg.filter(function (t) { return t.k && !videl[t.k]; });

        var h = [hlava('Co lidi doopravdy používají',
            'Ze záznamů užívání ze všech firem. Ukazuje, co má cenu dolaďovat — a co je mrtvé.')];
        h.push('<div class="agv-filtr">' +
            [7, 30, 90, 365].map(function (x) {
                return '<button type="button" class="agv-b' + (x === _dni ? ' on' : '') + '" data-dni="' + x + '">' + (x === 365 ? 'rok' : x + ' dní') + '</button>';
            }).join('') + '</div>');
        h.push('<div class="agv-st" style="margin:8px 0 12px;">' + rows.length + ' nástrojů · ' +
            (d.firms || 0) + ' firem · ' + (d.lidi || 0) + ' lidí</div>');
        rows.forEach(function (r) {
            var t = null;
            try { t = window.AGReg && AGReg.get ? AGReg.get(r.k) : null; } catch (e) { t = null; }
            var pct = Math.max(2, Math.round((r.n || 0) / max * 100));
            h.push('<div class="agv-bar"><div class="fill" style="width:' + pct + '%;"></div>' +
                '<div class="tx"><b>' + esc(t && t.vl ? t.vl : r.k) + '</b>' +
                '<small>' + (r.n || 0) + '× · ' + (r.firms || 0) + ' firem · ' + (r.lidi || 0) + ' lidí</small></div></div>');
        });
        h.push('<div class="agv-sec">Neotevřel nikdo (' + nikdo.length + ')</div>');
        if (!nikdo.length) h.push('<div class="agv-p">Každý nástroj z registru někdo za tu dobu použil.</div>');
        else h.push('<div class="agv-p">' + nikdo.map(function (t) { return esc(t.vl || t.k); }).join(' · ') + '</div>');
        b.innerHTML = h.join('');
        wireZpet(b);
        Array.prototype.forEach.call(b.querySelectorAll('[data-dni]'), function (el) {
            el.addEventListener('click', function () { _dni = parseInt(el.getAttribute('data-dni'), 10) || 30; _load = null; render(); });
        });
    }

    function kdy(ts) {
        if (!ts) return '—';
        var d = Math.floor((Date.now() - ts) / 864e5);
        if (d <= 0) return 'dnes';
        if (d === 1) return 'včera';
        if (d < 31) return 'před ' + d + ' dny';
        return new Date(ts).toLocaleDateString('cs-CZ');
    }
    // spolecna hlaska pro odmitnuty dotaz (drive jen v sprava-appky.js)
    function sayFail(r, kde) {
        if (r.status === 403 || r.status === 503 || r.status === 404 || r.status === 0)
            return agAlert('Nepovedlo se', proc(r));
        agAlert('Nepovedlo se', esc((r.data && r.data.error) || ('Chyba ' + r.status + ' — ' + kde)));
    }

    function render() {
        var b = document.getElementById('agv-body');
        if (!b) return;
        if (_view === 'flags') return viewFlags(b);
        if (_view === 'errors') return viewErrors(b);
        if (_view === 'usage') return viewUsage(b);
        var h = ['<div class="agv-hd"><div style="flex:none;width:22px;height:22px;color:var(--accent);">' + ICON + '</div>' +
            '<div><b>Máš odemčeno všechno</b><small>Oprávnění firem a rolí se na tenhle telefon nevztahují.</small></div></div>'];
        var items = polozky();
        items.forEach(function (it, i) {
            if (it.sec) h.push('<div class="agv-sec">' + esc(it.sec) + '</div>');
            h.push('<button type="button" class="agv-it" data-i="' + i + '">' +
                '<span class="ic">' + it.ic + '</span>' +
                '<span class="tx"><b>' + esc(it.t) + '</b><small>' + esc(it.d) + '</small></span>' +
                '<span class="go">›</span></button>');
        });
        h.push('<div class="agv-sec">Server</div>');
        h.push('<div class="agv-st" id="agv-stav">Zjišťuji…</div>');
        h.push('<button type="button" class="btn btn-secondary" id="agv-close" style="margin-top:16px;">Zavřít</button>');
        b.innerHTML = h.join('');

        Array.prototype.forEach.call(b.querySelectorAll('.agv-it'), function (el) {
            el.addEventListener('click', function () {
                var it = items[parseInt(el.getAttribute('data-i'), 10)];
                if (!it) return;
                if (it.lazy && !it.ready && window.AGLazy && typeof AGLazy.need === 'function') {
                    el.classList.add('off');
                    AGLazy.need(it.lazy, function () {
                        el.classList.remove('off');
                        if (!it.keep) close();
                        it.run();
                    });
                    return;
                }
                if (!it.keep) close();
                it.run();
            });
        });
        var x = b.querySelector('#agv-close');
        if (x) x.addEventListener('click', close);
        stav(false);
    }

    // Stav serveru: /health řekne verzi a co má zapnuté, /owner/firms ověří klíč.
    // Tohle je diagnostika, kvůli které modul vznikl — na jednom řádku je vidět,
    // jestli je vada v klíči, ve workeru, nebo v síti.
    function stav(hlasite) {
        var el = document.getElementById('agv-stav');
        if (el) el.textContent = 'Zjišťuji…';
        api('/health').then(function (h) {
            return api('/owner/firms').then(function (o) { return { h: h, o: o }; });
        }).then(function (r) {
            var d = r.h.data || {};
            var txt;
            if (!r.h.ok) {
                txt = '<span class="bad">Server neodpovídá</span> (' + esc(String(r.h.status || 'bez signálu')) + ')';
            } else {
                txt = 'Worker <b>v' + esc(String(d.v == null ? '?' : d.v)) + '</b>' +
                    ' · konzole ' + (d.owner ? '<span class="ok">zapnutá</span>' : '<span class="bad">vypnutá</span>') +
                    ' · schránka ' + (d.fb ? '<span class="ok">ano</span>' : '<span class="bad">ne</span>') + '<br>' +
                    'Klíč: ' + (r.o.ok
                        ? '<span class="ok">sedí</span>'
                        : '<span class="bad">' + (r.o.status === 503 ? 'na serveru žádný není' : (r.o.status === 403 ? 'nesedí' : 'chyba ' + esc(String(r.o.status)))) + '</span>');
            }
            if (el) el.innerHTML = txt;
            if (hlasite) agAlert('Stav serveru', txt + (r.o.ok ? '' : '<br><br>' + proc(r.o)));
        });
    }

    function open() {
        if (!isOn()) return login();
        _view = ''; _load = null; _pick = null;
        var m = build();
        m.style.display = 'flex';
        m.classList.add('ag-open');
        render();
    }
    function close() {
        var m = document.getElementById(MODAL_ID);
        if (!m) return;
        m.style.display = 'none';
        m.classList.remove('ag-open');
    }

    // ---- vstupy v UI ------------------------------------------------------------
    // 1) SKRYTY vstup na bráně / přihlašovací obrazovce: dlouhý stisk znaku appky.
    //    Obě obrazovky se vytvářejí až za běhu a po každém přepnutí firmy znovu,
    //    proto se to zkouší v ticku, ne jednorázově při startu. Příznak data-agv
    //    hlídá, aby se obsluha na tentýž znak nenavěsila podruhé.
    //    ⚠ Obsluha visí na .agl-mark, ne na jeho obsahu: fillMark() v ucty.js
    //      vnitřek znaku po chvíli PŘEPÍŠE (klon loga z úvodní karty), takže
    //      listener na dítěti by tiše zmizel. Události z vnitřku probublají.
    function injectGate() {
        var ov = loginOverlay();
        if (!ov) return;
        var mark = ov.querySelector('.agl-mark');
        if (!mark || mark.getAttribute('data-agv') === '1') return;
        mark.setAttribute('data-agv', '1');
        // iOS by na dlouhý stisk obrázku nabídl „Uložit obrázek" / výběr textu
        mark.style.webkitTouchCallout = 'none';
        mark.style.webkitUserSelect = 'none';
        mark.style.userSelect = 'none';

        var t = null;
        function konec() {
            if (t) { clearTimeout(t); t = null; }
            mark.style.transition = 'transform .18s ease-out, opacity .18s ease-out';
            mark.style.transform = ''; mark.style.opacity = '';
        }
        function zacatek() {
            if (ov.querySelector('.agv-card')) return;   // karta klíče už je otevřená
            if (t) return;
            // Odezva se ukáže až po 400 ms a JEN tomu, kdo drží — kdo znak jen
            // mine prstem, nic nepozná. Bez ní by to byla loterie („drží se to
            // vůbec?"), s ní je poznat, že se něco děje, ještě než se to otevře.
            t = setTimeout(function () {
                t = setTimeout(function () {
                    t = null;
                    konec();
                    try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) { swallow(e, 'vibrate'); }
                    login();
                }, HOLD_MS - 400);
                mark.style.transition = 'transform ' + (HOLD_MS - 400) + 'ms linear, opacity ' + (HOLD_MS - 400) + 'ms linear';
                mark.style.transform = 'scale(.86)';
                mark.style.opacity = '.55';
            }, 400);
        }
        ['touchstart', 'mousedown'].forEach(function (n) {
            mark.addEventListener(n, zacatek, { passive: true });
        });
        ['touchend', 'touchcancel', 'touchmove', 'mouseup', 'mouseleave'].forEach(function (n) {
            mark.addEventListener(n, konec, { passive: true });
        });
        // Prst sjede po obrazovce (rolování karty) → stisk se nesmí dopočítat.
        ov.addEventListener('scroll', konec, { passive: true });
    }

    // 2) položka v „Více" — konzole PATŘÍ SEM, ne do Nastavení → Údržba. Tam byla
    //    schovaná pod dvěma rozbaleními a ukazovala se jen tomu, kdo klíč už měl.
    function injectMenu() {
        var host = document.querySelector('#side-menu .menu-scroll');
        if (!host) return;
        var b = document.getElementById('agv-menu-btn');
        if (isOn()) {
            if (!b) {
                b = document.createElement('button');
                b.id = 'agv-menu-btn'; b.type = 'button'; b.className = 'menu-btn';
                b.style.cssText = 'background:rgba(212,160,44,0.15);border-color:#d4a02c;color:#d4a02c;';
                b.innerHTML = '<span style="display:inline-block;width:18px;height:18px;vertical-align:-3px;">' + ICON + '</span> Konzole vlastníka';
                b.addEventListener('click', function () {
                    // toggleMenu() je PŘEPÍNAČ — bez testu na .open by panel naopak otevřel
                    try {
                        var sm = document.getElementById('side-menu');
                        if (sm && sm.classList.contains('open') && typeof window.toggleMenu === 'function') toggleMenu();
                    } catch (e) { swallow(e, 'menu:toggle'); }
                    open();
                });
                var head = host.querySelector('.menu-head');
                if (head && head.nextSibling) host.insertBefore(b, head.nextSibling);
                else host.insertBefore(b, host.firstChild);
            }
        } else if (b && b.parentNode) b.parentNode.removeChild(b);
    }

    // ⑦ TICHE OVERENI KLICE. Priznak `agVlastnik_v1` sam o sobe odemyka jen UI
    // tohohle telefonu, ale nema smysl ho drzet zapnuty, kdyz uz klic neplati
    // (zmenil jsem OWNER_KEY na serveru, telefon jsem pujcil dal, …). Jednou za
    // sest hodin se proto potichu zeptame serveru — a JEN pri jasnem 403 se rezim
    // vypne. Nedostupny server ani 503 rezim NEVYPINA: v terenu bez signalu by se
    // vlastnik jinak sam zamkl ven z vlastni aplikace.
    function overKlic() {
        if (!isOn() || !key()) return;
        if (navigator.onLine === false) return;
        var last = 0;
        try { last = parseInt(localStorage.getItem(LS_VERIF) || '0', 10) || 0; } catch (e) { last = 0; }
        if (Date.now() - last < VERIFY_GAP) return;
        api('/owner/firms').then(function (r) {
            if (r.ok) { try { localStorage.setItem(LS_VERIF, String(Date.now())); } catch (e) { swallow(e, 'verif'); } return; }
            if (r.status !== 403) return;
            setOn(false); injectMenu();
            try { if (window.AGUcty && AGUcty.applyPerms) AGUcty.applyPerms(); } catch (e) { swallow(e, 'verif:perms'); }
            agAlert('Režim vlastníka vypnut', 'Klíč už serveru nesedí, tak se režim sám vypnul. Zadej nový dlouhým stiskem znaku aplikace na úvodní obrazovce.');
        });
    }

    function init() {
        injectGate(); injectMenu();
        setTimeout(overKlic, 12000);
        (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
            try { injectGate(); injectMenu(); } catch (e) { swallow(e, 'tick'); }
        }, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.agOpenKonzole = open;
    window.AGVlastnik = {
        isOn: isOn, open: open, close: close, login: login, leave: leave,
        key: key, setKey: setKey, promptKey: promptKey
    };
})();
