// ============================================================================
// AR Geodet — FIREMNÍ REŽIM: ÚČTY, ROLE A PŘIHLAŠOVÁNÍ (ODPOJITELNÁ vrstva)
// ----------------------------------------------------------------------------
// 100% offline (bez backendu): účty žijí LOKÁLNĚ na zařízení. Jde o řízení
// přístupu, personalizaci a auditovatelnost — NE o tvrdou serverovou bezpečnost
// (kdo má fyzicky odemčený telefon a vývojářské nástroje, k datům se dostane).
//
// Role:
//   admin       — vidí a může vše, spravuje firmu (uživatele, oprávnění, dashboard)
//   vedeni      — dle oprávnění; volitelně vidí přehled užívání
//   zamestnanec — dle oprávnění (firma si sama určí, co potřebuje)
//
// Co modul dělá:
//   • Přihlašovací/zamykací obrazovka (výběr uživatele + PIN, hash SHA-256+sůl)
//   • Vymáhání oprávnění: skrývá tlačítka doku, kategorie Nástrojů a záložky
//     Nastavení podle role (admin bez omezení)
//   • Přihlášený uživatel se propíše do localStorage 'arSurveyor' → žurnál bodů
//     (js/journal.js) automaticky eviduje autora každé změny
//   • Sledování užívání do VLASTNÍ IndexedDB (argeodet-usage): přihlášení,
//     otevření nástrojů, operace s body (z události agjournal:commit), aktivita
//   • Auto-zámek po nečinnosti (nastavitelné), rychlé přepnutí uživatele
//
// Administrace (dashboard, správa uživatelů, matice oprávnění, export/import
// firmy) je v js/ucty-admin.js. Bez něj jádro funguje (login+role), jen chybí UI
// správy.
//
// Když firemní režim NENÍ zapnutý, modul nic nemění — appka běží jako dřív.
// Odstranění: smaž js/ucty.js + js/ucty-admin.js + řádky <script> v index.html
// (a v sw.js). Data firmy zůstanou v localStorage (klíč agFirma_v1) — neškodí.
//
// API (window.AGUcty):
//   getFirm() / saveFirm(f)      — konfigurace firmy (null = režim vypnut)
//   currentUser()                — přihlášený uživatel nebo null
//   isAdmin() / can(permKey)     — oprávnění aktuálního uživatele
//   login()/lock()/logout()      — zobrazí přihlášení / zamkne / odhlásí
//   hashPin(pin, salt) -> Promise<hex>
//   usageLog(type, key)          — zapiš událost užívání
//   usageQuery(fromTs) -> Promise<[ev]>
//   usageClear() -> Promise      — smaže záznamy užívání (admin)
//   PERMS                        — definice oprávnění (klíč, popisek, skupina)
//   applyPerms()                 — znovu aplikuj skrývání (po změně konfigurace)
// ============================================================================
(function () {
    'use strict';
    if (window.AGUcty) return;

    var LS_FIRM = 'agFirma_v1';        // konfigurace firmy (NEprefixuje se zakázkou — platí pro celé zařízení)
    var LS_SESS = 'agFirmaSess_v1';    // aktivní přihlášení {userId, ts}
    var STYLE_ID = 'ag-ucty-style';
    var DB = 'argeodet-usage', STORE = 'ev', VER = 1;

    // ------------------------------------------------------------------
    // Definice oprávnění. Klíč -> co se skrývá. Admin má vždy vše.
    // 'tools.*' odpovídá textu nadpisu kategorie v modálu Nástroje.
    // Vzhled (tab-vzhled) záměrně NENÍ v seznamu — zůstává všem (motiv,
    // velikost písma… nikoho neohrozí a jejich skrytí by jen škodilo).
    // ------------------------------------------------------------------
    var PERMS = [
        { k: 'dock.novybod',   g: 'Hlavní obrazovka', t: 'Nový bod (měření)' },
        { k: 'dock.body',      g: 'Hlavní obrazovka', t: 'Správa bodů' },
        { k: 'dock.nastroje',  g: 'Hlavní obrazovka', t: 'Nástroje' },
        { k: 'dock.vice',      g: 'Hlavní obrazovka', t: 'Menu „Více"' },
        { k: 'dock.nastaveni', g: 'Hlavní obrazovka', t: 'Nastavení' },
        { k: 'tools.Měření',               g: 'Kategorie nástrojů', t: 'Měření' },
        { k: 'tools.Vytyčování a náčrt',   g: 'Kategorie nástrojů', t: 'Vytyčování a náčrt' },
        { k: 'tools.Katastr a data',       g: 'Kategorie nástrojů', t: 'Katastr a data' },
        { k: 'tools.AR a kalibrace',       g: 'Kategorie nástrojů', t: 'AR a kalibrace' },
        { k: 'tools.Pomůcky',              g: 'Kategorie nástrojů', t: 'Pomůcky' },
        { k: 'tools.Terénní nástroje',     g: 'Kategorie nástrojů', t: 'Terénní nástroje' },
        { k: 'set.tab-ar',     g: 'Záložky Nastavení', t: 'AR a přesnost' },
        { k: 'set.tab-data',   g: 'Záložky Nastavení', t: 'Data (zakázky, export)' },
        { k: 'set.tab-udrzba', g: 'Záložky Nastavení', t: 'Údržba (záloha, koš)' },
        { k: 'x.dashboard',    g: 'Ostatní', t: 'Přehled užívání (dashboard)' }
    ];

    // výchozí oprávnění nové firmy: vedení vše, zaměstnanec bez Údržby a dashboardu
    function defaultPerms() {
        var vd = {}, zm = {};
        PERMS.forEach(function (p) {
            vd[p.k] = true;
            zm[p.k] = (p.k !== 'set.tab-udrzba' && p.k !== 'x.dashboard');
        });
        return { vedeni: vd, zamestnanec: zm };
    }

    // ------------------------------------------------------------------
    // Úložiště konfigurace (localStorage, SUROVÉ klíče — bez prefixu zakázky)
    // ------------------------------------------------------------------
    function getFirm() {
        try {
            var raw = localStorage.getItem(LS_FIRM);
            if (!raw) return null;
            var f = JSON.parse(raw);
            if (!f || !f.enabled) return null;
            if (!Array.isArray(f.users) || !f.users.length) return null;   // fail-open: bez uživatelů nezamykat
            if (!f.perms) f.perms = defaultPerms();
            return f;
        } catch (e) { return null; }
    }
    function saveFirm(f) {
        try { localStorage.setItem(LS_FIRM, JSON.stringify(f)); } catch (e) {}
        applyPerms();
    }
    function getSess() {
        try { return JSON.parse(localStorage.getItem(LS_SESS) || 'null'); } catch (e) { return null; }
    }
    function setSess(s) {
        try { if (s) localStorage.setItem(LS_SESS, JSON.stringify(s)); else localStorage.removeItem(LS_SESS); } catch (e) {}
    }

    function currentUser() {
        var f = getFirm(); if (!f) return null;
        var s = getSess(); if (!s || !s.userId) return null;
        for (var i = 0; i < f.users.length; i++) if (f.users[i].id === s.userId) return f.users[i];
        return null;
    }
    function isAdmin() { var u = currentUser(); return !!(u && u.role === 'admin'); }
    function can(key) {
        var f = getFirm(); if (!f) return true;          // režim vypnut -> vše povoleno
        var u = currentUser(); if (!u) return false;      // nepřihlášen -> nic (stejně kryje overlay)
        if (u.role === 'admin') return true;
        var p = f.perms && f.perms[u.role];
        if (!p) return true;
        return p[key] !== false;
    }

    // ------------------------------------------------------------------
    // PIN: SHA-256(sůl + pin) přes WebCrypto; nouzový FNV fallback (http/file)
    // ------------------------------------------------------------------
    function hashPin(pin, salt) {
        var msg = String(salt || '') + '|' + String(pin || '');
        try {
            if (window.crypto && crypto.subtle && window.TextEncoder) {
                return crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg)).then(function (buf) {
                    var a = new Uint8Array(buf), s = '';
                    for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
                    return s;
                }).catch(function () { return fnv(msg); });
            }
        } catch (e) {}
        return Promise.resolve(fnv(msg));
    }
    function fnv(s) {
        var h = 0x811c9dc5;
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
        return 'fnv' + h.toString(16);
    }
    function makeSalt() {
        try {
            var a = new Uint8Array(8); crypto.getRandomValues(a);
            var s = ''; for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
            return s;
        } catch (e) { return 's' + Math.random().toString(36).slice(2, 12); }
    }

    // ------------------------------------------------------------------
    // Sledování užívání (IndexedDB, append-only — stejný vzor jako journal.js)
    // ev: { seq(auto), ts, u(jméno), uid, t(typ), k(klíč), proj }
    // typy: 'login' | 'tool' | 'pt-add' | 'pt-edit' | 'pt-del' | 'act'
    // ------------------------------------------------------------------
    var _db = null;
    function openDb() {
        return new Promise(function (res) {
            if (_db) return res(_db);
            var r; try { r = indexedDB.open(DB, VER); } catch (e) { return res(null); }
            r.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    var os = db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
                    os.createIndex('ts', 'ts', { unique: false });
                }
            };
            r.onsuccess = function () { _db = r.result; res(_db); };
            r.onerror = function () { res(null); };
            r.onblocked = function () { res(null); };
        });
    }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function usageLog(type, key) {
        var f = getFirm(); if (!f) return;               // bez firemního režimu nic nesledovat
        var u = currentUser();
        var rec = { ts: Date.now(), u: u ? u.name : '?', uid: u ? u.id : null, t: type, k: key || null, proj: pid() };
        openDb().then(function (db) {
            if (!db) return;
            try { db.transaction(STORE, 'readwrite').objectStore(STORE).add(rec); } catch (e) {}
        });
    }
    function usageQuery(fromTs) {
        return openDb().then(function (db) {
            if (!db) return [];
            return new Promise(function (res) {
                var out = [];
                try {
                    var range = fromTs ? IDBKeyRange.lowerBound(fromTs) : null;
                    var cur = db.transaction(STORE, 'readonly').objectStore(STORE).index('ts').openCursor(range);
                    cur.onsuccess = function (e) {
                        var c = e.target.result;
                        if (c) { out.push(c.value); c.continue(); } else res(out);
                    };
                    cur.onerror = function () { res(out); };
                } catch (e) { res(out); }
            });
        });
    }
    function usageClear() {
        return openDb().then(function (db) {
            if (!db) return;
            return new Promise(function (res) {
                try {
                    var t = db.transaction(STORE, 'readwrite');
                    t.objectStore(STORE).clear();
                    t.oncomplete = function () { res(); };
                    t.onerror = function () { res(); };
                } catch (e) { res(); }
            });
        });
    }

    // body z žurnálu (autor už je v žurnálu; tady jen agregační počítadlo)
    window.addEventListener('agjournal:commit', function (e) {
        try {
            var op = e.detail && e.detail.op;
            if (op === 'add') usageLog('pt-add', e.detail.id);
            else if (op === 'edit') usageLog('pt-edit', e.detail.id);
            else if (op === 'delete') usageLog('pt-del', e.detail.id);
        } catch (err) {}
    });

    // otevření nástroje: delegovaně na dlaždice v modálu Nástroje
    document.addEventListener('click', function (e) {
        try {
            var tile = e.target && e.target.closest ? e.target.closest('#tools-modal .tool-tile') : null;
            if (!tile) return;
            var key = tile.getAttribute('data-tool');
            if (!key) {
                var oc = tile.getAttribute('onclick') || '';
                var m = /^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(oc);
                key = m ? m[1] : (tile.textContent || '').trim().slice(0, 40);
            }
            usageLog('tool', key);
        } catch (err) {}
    }, true);

    // hrubá stopa aktivity (pro „pracovní dobu"): max 1 událost za 20 minut
    var _lastAct = 0;
    document.addEventListener('pointerdown', function () {
        _touchActivity();
        var now = Date.now();
        if (now - _lastAct > 20 * 60 * 1000) { _lastAct = now; usageLog('act', null); }
    }, true);
    // psaní (i na softwarové klávesnici) je taky aktivita — jinak by auto-zámek
    // zamkl uživatele uprostřed vyplňování formuláře
    document.addEventListener('keydown', function () { _touchActivity(); }, true);
    document.addEventListener('input', function () { _touchActivity(); }, true);

    // ------------------------------------------------------------------
    // Vymáhání oprávnění (skrývání UI podle role)
    // ------------------------------------------------------------------
    var DOCK_MAP = {
        'dock.novybod':   'openNewPointModal',
        'dock.body':      'openManageModal',
        'dock.nastroje':  'tools-modal',
        'dock.vice':      'toggleMenu',
        'dock.nastaveni': 'openSettings'
    };
    var SET_MAP = { 'set.tab-ar': 'tab-ar', 'set.tab-data': 'tab-data', 'set.tab-udrzba': 'tab-udrzba' };

    function applyPerms() {
        var f = getFirm();
        var u = currentUser();
        var restrict = !!(f && u && u.role !== 'admin');

        // 1) dok
        try {
            var btns = document.querySelectorAll('#dock .dock-btn');
            for (var i = 0; i < btns.length; i++) {
                var oc = btns[i].getAttribute('onclick') || '';
                var hide = false;
                if (restrict) {
                    for (var k in DOCK_MAP) {
                        if (oc.indexOf(DOCK_MAP[k]) !== -1 && !can(k)) { hide = true; break; }
                    }
                }
                btns[i].style.display = hide ? 'none' : '';
            }
        } catch (e) {}

        // 2) záložky Nastavení (tlačítko i panel)
        try {
            for (var sk in SET_MAP) {
                var tabId = SET_MAP[sk];
                var hideTab = restrict && !can(sk);
                var panel = document.getElementById(tabId);
                if (panel) panel.style.display = hideTab ? 'none' : '';
                var tbs = document.querySelectorAll('#settings-modal .tab-btn');
                for (var j = 0; j < tbs.length; j++) {
                    if ((tbs[j].getAttribute('onclick') || '').indexOf("'" + tabId + "'") !== -1) {
                        tbs[j].style.display = hideTab ? 'none' : '';
                    }
                }
            }
        } catch (e) {}

        // 3) kategorie v modálu Nástroje (statické i injektované „Terénní nástroje").
        // POZOR: display přepisujeme JEN u prvků, které jsme sami skryli (data-agucty),
        // aby se nerozbilo vyhledávání nástrojů (tools-plus taky přepíná display).
        // Oblíbené (tools-plus přesouvá dlaždice pod „★ Oblíbené" nahoru) se posuzují
        // podle PŮVODNÍ kategorie: statické přes kotvu span[data-ag-ph], injektované
        // přes mapu _toolCat (plněnou obalem agRegisterFieldTool níže).
        try {
            var grid = document.querySelector('#tools-modal .tool-grid');
            if (grid) {
                function setHide(el, ban) {
                    if (ban) { el.style.display = 'none'; el.setAttribute('data-agucty', '1'); }
                    else if (el.getAttribute('data-agucty')) { el.style.display = ''; el.removeAttribute('data-agucty'); }
                }
                // 1. průchod: celé kategorie (zóna oblíbených se přeskočí — řeší ji 2. průchod)
                var bannedKeys = [], curCat = null, node = grid.firstElementChild;
                while (node) {
                    if (node.classList.contains('tool-cat') || node.classList.contains('ag-ft-head')) {
                        curCat = (node.textContent || '').trim();
                    }
                    var isFav = (curCat === '★ Oblíbené');
                    var ban = !!(curCat && !isFav && restrict && !can('tools.' + curCat));
                    if (ban && node.hasAttribute('data-ag-ph')) bannedKeys.push(node.getAttribute('data-ag-ph'));
                    if (!isFav) setHide(node, ban);
                    node = node.nextElementSibling;
                }
                // 2. průchod: dlaždice v zóně oblíbených podle původní kategorie
                var favHead = document.getElementById('ag-fav-head');
                if (favHead && favHead.parentNode === grid) {
                    node = favHead.nextElementSibling;
                    while (node && !(node.classList.contains('tool-cat') || node.classList.contains('ag-ft-head'))) {
                        var ban2 = false;
                        if (restrict) {
                            var key = node.getAttribute('data-tool');
                            if (key) {
                                var c = _toolCat[key] || 'Terénní nástroje';
                                ban2 = !can('tools.' + c);
                            } else {
                                var oc = node.getAttribute('onclick') || '';
                                for (var bi = 0; bi < bannedKeys.length; bi++) {
                                    if (bannedKeys[bi] && oc.indexOf(bannedKeys[bi]) !== -1) { ban2 = true; break; }
                                }
                            }
                        }
                        setHide(node, ban2);
                        node = node.nextElementSibling;
                    }
                }
            }
        } catch (e) {}

        try { document.body.classList.toggle('ag-firm-restricted', restrict); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('agucty:perms')); } catch (e) {}
    }

    // mapa id injektovaného nástroje -> kategorie (pro posouzení oblíbených dlaždic);
    // plní se obalem agRegisterFieldTool — ucty.js se načítá až ZA field-tools.js,
    // registrace ostatních modulů běží ještě později (na load), takže obal je stihne
    var _toolCat = {};
    var _wrapped = false;
    function wrapRegister() {
        if (_wrapped || typeof window.agRegisterFieldTool !== 'function') return;
        _wrapped = true;
        var orig = window.agRegisterFieldTool;
        window.agRegisterFieldTool = function (item) {
            try { if (item && item.id) _toolCat[item.id] = item.cat || 'Terénní nástroje'; } catch (e) {}
            return orig.apply(this, arguments);
        };
    }
    wrapRegister();

    // mřížku Nástrojů překreslují field-tools/tools-plus → periodicky srovnat
    function tick() { wrapRegister(); if (getFirm()) applyPerms(); }

    // ------------------------------------------------------------------
    // Přihlašovací / zamykací obrazovka
    // ------------------------------------------------------------------
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-login{position:fixed;inset:0;z-index:999999;background:var(--bg,#0d1117);display:flex;flex-direction:column;',
            '  align-items:center;justify-content:center;gap:14px;padding:24px calc(16px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));}',
            '#ag-login .agl-logo{font:800 22px/1.2 var(--font-display,system-ui);color:var(--accent,#2f9e74);letter-spacing:.02em;}',
            '#ag-login .agl-firm{font:600 14px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#ag-login .agl-users{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;max-width:420px;max-height:38vh;overflow-y:auto;}',
            '#ag-login .agl-user{display:flex;flex-direction:column;align-items:center;gap:6px;background:var(--glass-bg,rgba(255,255,255,0.06));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));border-radius:14px;padding:12px 14px;min-width:92px;cursor:pointer;color:var(--text,#e6e8eb);}',
            '#ag-login .agl-user.sel{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.14));}',
            '#ag-login .agl-av{width:44px;height:44px;border-radius:50%;background:var(--accent,#2f9e74);color:#fff;display:flex;align-items:center;justify-content:center;font:800 17px/1 var(--font-display,system-ui);}',
            '#ag-login .agl-nm{font:600 12.5px/1.2 var(--font-ui,system-ui);max-width:110px;text-align:center;overflow:hidden;text-overflow:ellipsis;}',
            '#ag-login .agl-role{font:500 10.5px/1 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#ag-login .agl-pinbox{display:none;flex-direction:column;align-items:center;gap:10px;}',
            '#ag-login .agl-pinbox.on{display:flex;}',
            '#ag-login input.agl-pin{font:700 22px/1 var(--font-display,system-ui);letter-spacing:.35em;text-align:center;width:190px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.2));border-radius:12px;color:var(--text,#e6e8eb);padding:12px 8px;}',
            '#ag-login .agl-err{color:var(--danger,#e5534b);font:600 13px/1.3 var(--font-ui,system-ui);min-height:17px;}',
            '#ag-login .agl-btn{border:1px solid var(--accent-line,rgba(47,158,116,0.42));background:var(--accent,#2f9e74);color:#fff;',
            '  border-radius:12px;padding:12px 26px;font:700 15px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '#ag-login .agl-ghost{background:transparent;color:var(--text-muted,#9aa1ac);border:none;font:500 12.5px/1 var(--font-ui,system-ui);cursor:pointer;padding:8px;}',
            '#ag-login.agl-shake .agl-pinbox{animation:aglshake .35s;}',
            '@keyframes aglshake{20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    var _selUser = null;
    function showLogin(lockMode) {
        var f = getFirm(); if (!f) return;
        injectStyles();
        var old = document.getElementById('ag-login'); if (old) old.remove();
        setSess(null);
        applyPerms();

        var ov = document.createElement('div');
        ov.id = 'ag-login';
        var usersHtml = f.users.map(function (u) {
            var initials = (u.name || '?').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase();
            var roleTxt = u.role === 'admin' ? 'Admin' : (u.role === 'vedeni' ? 'Vedení' : 'Zaměstnanec');
            return '<button type="button" class="agl-user" data-id="' + esc(u.id) + '">' +
                '<span class="agl-av">' + esc(initials) + '</span>' +
                '<span class="agl-nm">' + esc(u.name) + '</span>' +
                '<span class="agl-role">' + roleTxt + '</span></button>';
        }).join('');
        ov.innerHTML =
            '<div class="agl-logo">AR Geodet</div>' +
            '<div class="agl-firm">' + esc(f.firmName || 'Firemní režim') + (lockMode ? ' — zamčeno' : '') + '</div>' +
            '<div class="agl-users">' + usersHtml + '</div>' +
            '<div class="agl-pinbox">' +
            '  <input class="agl-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="PIN">' +
            '  <div class="agl-err"></div>' +
            '  <button type="button" class="agl-btn">Přihlásit</button>' +
            '</div>' +
            '<button type="button" class="agl-ghost" id="agl-forgot">Zapomenutý PIN?</button>';
        document.body.appendChild(ov);

        var pinbox = ov.querySelector('.agl-pinbox');
        var pinInp = ov.querySelector('.agl-pin');
        var errEl = ov.querySelector('.agl-err');

        function pick(id) {
            _selUser = null;
            for (var i = 0; i < f.users.length; i++) if (f.users[i].id === id) _selUser = f.users[i];
            var us = ov.querySelectorAll('.agl-user');
            for (var j = 0; j < us.length; j++) us[j].classList.toggle('sel', us[j].getAttribute('data-id') === id);
            if (!_selUser) return;
            errEl.textContent = '';
            if (_selUser.noPin || !_selUser.pinHash) { finish(_selUser); return; }
            pinbox.classList.add('on');
            pinInp.value = '';
            setTimeout(function () { try { pinInp.focus(); } catch (e) {} }, 50);
        }
        function finish(u) {
            setSess({ userId: u.id, ts: Date.now() });
            try { localStorage.setItem('arSurveyor', u.name); } catch (e) {}
            ov.remove();
            _touchActivity();
            applyPerms();
            usageLog('login', lockMode ? 'unlock' : 'login');
            try { window.dispatchEvent(new CustomEvent('agucty:login', { detail: { user: u } })); } catch (e) {}
        }
        function submit() {
            if (!_selUser) { errEl.textContent = 'Nejdřív vyber uživatele.'; return; }
            var pin = pinInp.value || '';
            hashPin(pin, _selUser.salt).then(function (h) {
                if (h === _selUser.pinHash) { finish(_selUser); return; }
                errEl.textContent = 'Nesprávný PIN.';
                pinInp.value = '';
                ov.classList.remove('agl-shake');
                void ov.offsetWidth;   // restart animace
                ov.classList.add('agl-shake');
            });
        }

        ov.addEventListener('click', function (e) {
            var ub = e.target.closest ? e.target.closest('.agl-user') : null;
            if (ub) { pick(ub.getAttribute('data-id')); return; }
            if (e.target.classList.contains('agl-btn')) submit();
        });
        pinInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

        // Zapomenutý PIN: admin resetuje v administraci; když je zamčený i admin,
        // nouzový reset vypne JEN firemní režim (geodetická data zůstanou).
        ov.querySelector('#agl-forgot').addEventListener('click', function () {
            var admins = f.users.filter(function (u) { return u.role === 'admin'; }).map(function (u) { return u.name; });
            var msg = 'PIN ti může změnit administrátor (' + (admins.join(', ') || '—') + ') v Administraci firmy.\n\n' +
                'Když je nedostupný i admin, lze firemní režim NOUZOVĚ vypnout — appka se odemkne, ' +
                'účty a oprávnění se smažou. BODY A ZAKÁZKY ZŮSTANOU.\n\nPro nouzové vypnutí napiš RESET:';
            var v = prompt(msg, '');
            if (v === 'RESET') {
                try { localStorage.removeItem(LS_FIRM); } catch (e) {}
                setSess(null);
                ov.remove();
                applyPerms();
                alert('Firemní režim vypnut. Body a zakázky zůstaly beze změny.');
            }
        });

        // předvyber posledního (zamčení) / jediného uživatele
        if (lockMode) {
            var last = getSessLastUser();
            if (last) pick(last);
        } else if (f.users.length === 1) {
            pick(f.users[0].id);
        }
    }
    var _lastUserId = null;
    function getSessLastUser() { return _lastUserId; }

    function lock() {
        var u = currentUser();
        _lastUserId = u ? u.id : null;
        if (getFirm()) showLogin(true);
    }
    function logout() {
        _lastUserId = null;
        setSess(null);
        if (getFirm()) showLogin(false); else applyPerms();
    }

    // ------------------------------------------------------------------
    // Auto-zámek po nečinnosti (minuty; 0 = vypnuto)
    // ------------------------------------------------------------------
    var _actTs = Date.now();
    function _touchActivity() { _actTs = Date.now(); }
    function lockCheck() {
        var f = getFirm(); if (!f) return;
        var min = parseInt(f.autoLockMin, 10);
        if (!min || min <= 0) return;
        if (!currentUser()) return;                      // už je zamčeno/odhlášeno
        if (document.getElementById('ag-login')) return;
        if (Date.now() - _actTs > min * 60 * 1000) lock();
    }
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) lockCheck();
    });

    // ------------------------------------------------------------------
    // Start
    // ------------------------------------------------------------------
    function init() {
        var f = getFirm();
        if (f) {
            var u = currentUser();
            if (!u) showLogin(false);
            else {
                try { localStorage.setItem('arSurveyor', u.name); } catch (e) {}
                applyPerms();
            }
        }
        // periodické srovnání UI (mřížku Nástrojů překreslují jiné moduly) + auto-zámek
        setInterval(function () { tick(); lockCheck(); }, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 200); });
    else setTimeout(init, 200);

    // ------------------------------------------------------------------
    window.AGUcty = {
        PERMS: PERMS,
        defaultPerms: defaultPerms,
        getFirm: getFirm,
        saveFirm: saveFirm,
        currentUser: currentUser,
        isAdmin: isAdmin,
        can: can,
        login: function () { showLogin(false); },
        lock: lock,
        logout: logout,
        hashPin: hashPin,
        makeSalt: makeSalt,
        usageLog: usageLog,
        usageQuery: usageQuery,
        usageClear: usageClear,
        applyPerms: applyPerms
    };
})();
