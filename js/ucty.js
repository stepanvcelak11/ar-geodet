// ============================================================================
// AR Geodet — FIREMNÍ REŽIM: ÚČTY, ROLE A PŘIHLAŠOVÁNÍ (ODPOJITELNÁ vrstva)
// ----------------------------------------------------------------------------
// DVA režimy firmy:
//   LOKÁLNÍ — účty žijí jen na tomto zařízení (bez serveru); PINy SHA-256+sůl
//   CLOUD   — firma žije na Cloudflare Workeru (cloud/worker.js): stejné účty
//             na všech mobilech, hesla se ověřují na serveru (PBKDF2 40k),
//             oprávnění spravovaná adminem se propíší všem, data o užívání
//             se sbírají ze všech zařízení. Offline-first: zařízení drží cache
//             konfigurace; bez signálu se odemkne proti lokálnímu ověřovadlu
//             (jen uživatelé, kdo se na zařízení už přihlásili online), fronta
//             užívání se odešle, až je signál.
// Ani cloud není „bankovní" bezpečnost — kdo má fyzicky odemčený telefon
// a vývojářské nástroje, k lokálním datům se dostane.
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
    var LS_TOK = 'agFirmaTok_v1';      // cloud: {token, userId} tohoto zařízení
    var LS_OFF = 'agFirmaOff_v1';      // cloud: offline ověřovadla {userId:{salt,iters,hash}}
    var LS_SYNC = 'agFirmaSync_v1';    // cloud: ukazatel odeslaných událostí užívání {lastSeq}
    var LS_GUEST = 'agGuest_v1';       // režim bez přihlášení {ts} — velmi omezené funkce
    var LS_PROF = 'agFirmy_v1';        // uložené firmy tohoto zařízení [{key,label,code,cloud,ts,snap}]
    var STYLE_ID = 'ag-ucty-style';
    var DB = 'argeodet-usage', STORE = 'ev', VER = 1;
    // adresa API (Cloudflare Worker, cloud/worker.js). Konstanta je jen výchozí —
    // skutečná adresa se ukládá do konfigurace firmy při založení/připojení.
    var DEFAULT_API = 'https://ar-geodet-api.ar-geodet.workers.dev';

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
    // Režim BEZ PŘIHLÁŠENÍ (host): appka jinak vyžaduje přihlášení (brána
    // při startu). Host smí jen základní měření a vzhled — vše ostatní
    // (Nástroje, Více, záložky dat/údržby) je skryté.
    // ------------------------------------------------------------------
    var GUEST_ALLOW = { 'dock.novybod': 1, 'dock.body': 1, 'dock.nastaveni': 1 };
    function isGuest() {
        if (getFirm()) return false;
        try { return !!localStorage.getItem(LS_GUEST); } catch (e) { return false; }
    }
    function enterGuest() {
        try { localStorage.setItem(LS_GUEST, JSON.stringify({ ts: Date.now() })); } catch (e) {}
        var g = document.getElementById('ag-gate'); if (g) g.remove();
        applyPerms();
    }
    function clearGuest() {
        try { localStorage.removeItem(LS_GUEST); } catch (e) {}
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
        clearGuest();
        rememberCurrentFirm();
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
        var f = getFirm();
        if (!f) {
            if (isGuest()) return !!GUEST_ALLOW[key];    // host: jen základní měření a vzhled
            return true;                                  // před branou / po nouzovém resetu
        }
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
    // CLOUD (Cloudflare Worker, cloud/worker.js): firma žije na serveru,
    // zařízení drží cache konfigurace v agFirma_v1 (stejný tvar čtou
    // can()/applyPerms() — zbytek modulu mezi režimy nerozlišuje).
    // ------------------------------------------------------------------
    function isCloud() { var f = getFirm(); return !!(f && f.cloud); }
    function apiUrl() { var f = getFirm(); return (f && f.api) || DEFAULT_API; }
    function getTok() { try { return JSON.parse(localStorage.getItem(LS_TOK) || 'null'); } catch (e) { return null; } }
    function setTok(t) { try { if (t) localStorage.setItem(LS_TOK, JSON.stringify(t)); else localStorage.removeItem(LS_TOK); } catch (e) {} }
    function getOff() { try { return JSON.parse(localStorage.getItem(LS_OFF) || '{}') || {}; } catch (e) { return {}; } }
    function saveOff(userId, ver) { try { var o = getOff(); o[userId] = ver; localStorage.setItem(LS_OFF, JSON.stringify(o)); } catch (e) {} }

    // PBKDF2 v prohlížeči (stejné parametry jako server) — offline odemknutí
    function pbkdf2Hex(pass, saltHex, iters) {
        try {
            if (!(window.crypto && crypto.subtle && window.TextEncoder)) return Promise.resolve(null);
            var salt = new Uint8Array(saltHex.length / 2);
            for (var i = 0; i < salt.length; i++) salt[i] = parseInt(saltHex.substr(i * 2, 2), 16);
            return crypto.subtle.importKey('raw', new TextEncoder().encode(String(pass)), 'PBKDF2', false, ['deriveBits'])
                .then(function (key) {
                    return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iters }, key, 256);
                })
                .then(function (bits) {
                    var a = new Uint8Array(bits), s = '';
                    for (var j = 0; j < a.length; j++) s += ('0' + a[j].toString(16)).slice(-2);
                    return s;
                })
                .catch(function () { return null; });
        } catch (e) { return Promise.resolve(null); }
    }

    // volání API s tokenem; VŽDY resolve {ok, status, data}; status 0 = síť/offline
    function cloudFetch(path, opts) {
        opts = opts || {};
        var headers = { 'Content-Type': 'application/json' };
        var tok = getTok();
        if (tok && tok.token) headers['Authorization'] = 'Bearer ' + tok.token;
        var p;
        try {
            p = fetch((opts.api || apiUrl()) + path, {
                method: opts.method || 'GET',
                headers: headers,
                body: opts.body != null ? JSON.stringify(opts.body) : undefined
            });
        } catch (e) { return Promise.resolve({ ok: false, status: 0, data: null }); }
        return p.then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
        }).catch(function () { return { ok: false, status: 0, data: null }; });
    }

    // převzetí konfigurace ze serveru do lokální cache (tvar agFirma_v1)
    function adoptConfig(cfg, api) {
        if (!cfg || !cfg.firm) return;
        var old = null;
        try { old = JSON.parse(localStorage.getItem(LS_FIRM) || 'null'); } catch (e) {}
        var f = {
            enabled: true, cloud: true,
            api: api || (old && old.api) || DEFAULT_API,
            code: cfg.firm.code,
            firmName: cfg.firm.name,
            autoLockMin: cfg.firm.autoLockMin || 0,
            perms: cfg.firm.perms || (old && old.perms) || defaultPerms(),
            users: (cfg.users || []).filter(function (u) { return !u.disabled; }),
            fetchedTs: Date.now()
        };
        try { localStorage.setItem(LS_FIRM, JSON.stringify(f)); } catch (e) {}
        clearGuest();
        applyPerms();
    }

    // po úspěšném /login nebo /firms: konfigurace + token + ověřovadlo + session
    function adoptLogin(data, api) {
        adoptConfig(data.config, api);
        setTok({ token: data.token, userId: data.user.id });
        if (data.offline) saveOff(data.user.id, data.offline);
        setSess({ userId: data.user.id, ts: Date.now() });
        try { localStorage.setItem('arSurveyor', data.user.name); } catch (e) {}
        rememberCurrentFirm();
        var g = document.getElementById('ag-gate'); if (g) g.remove();
    }

    // obnova konfigurace (perms/uživatelé se mohli změnit na jiném zařízení)
    function refreshConfig() {
        if (!isCloud() || !getTok()) return Promise.resolve(false);
        return cloudFetch('/config').then(function (r) {
            if (r.ok) { adoptConfig(r.data); return true; }
            if (r.status === 401 || r.status === 403) {
                // token prošel nebo účet zablokován → vynutit nové přihlášení
                setTok(null); setSess(null);
                if (getFirm()) showLogin(false);
            }
            return false;   // status 0 (offline) → cache platí dál, nic se neděje
        });
    }

    // přihlášení v cloud režimu: nejdřív server, bez signálu lokální ověřovadlo
    function cloudLogin(name, pass, done) {
        var f = getFirm(); if (!f) return done('Firemní režim není nastaven.');
        cloudFetch('/login', { method: 'POST', body: { code: f.code, name: name, password: pass } }).then(function (r) {
            if (r.ok && r.data && r.data.token) { adoptLogin(r.data, f.api); return done(null, r.data.user); }
            if (r.status !== 0) return done((r.data && r.data.error) || ('Přihlášení selhalo (' + r.status + ').'));
            // offline: ověř proti lokálnímu ověřovadlu
            var u = null, i;
            for (i = 0; i < (f.users || []).length; i++) {
                if (String(f.users[i].name).toLowerCase() === String(name).toLowerCase()) { u = f.users[i]; break; }
            }
            if (!u) return done('Bez signálu nelze ověřit nové jméno — poprvé se přihlas s internetem.');
            var ver = getOff()[u.id];
            if (!ver) return done('Tento uživatel se na tomto zařízení ještě nepřihlásil online. Připoj se k internetu.');
            pbkdf2Hex(pass, ver.salt, ver.iters).then(function (h) {
                if (h && h === ver.hash) {
                    setSess({ userId: u.id, ts: Date.now() });
                    try { localStorage.setItem('arSurveyor', u.name); } catch (e) {}
                    done(null, u);
                } else done(h ? 'Nesprávné heslo.' : 'Toto zařízení neumí offline ověření (chybí WebCrypto).');
            });
        });
    }

    // ---- odesílání fronty užívání na server (dávky po 200) -----------------
    function usageAfter(seq, limit) {
        return openDb().then(function (db) {
            if (!db) return [];
            return new Promise(function (res) {
                var out = [];
                try {
                    var cur = db.transaction(STORE, 'readonly').objectStore(STORE)
                        .openCursor(IDBKeyRange.lowerBound(seq || 0, true));
                    cur.onsuccess = function (e) {
                        var c = e.target.result;
                        if (c && out.length < (limit || 200)) { out.push(c.value); c.continue(); } else res(out);
                    };
                    cur.onerror = function () { res(out); };
                } catch (e) { res(out); }
            });
        });
    }
    var _syncBusy = false;
    function syncUsage() {
        if (!isCloud() || !getTok() || _syncBusy || navigator.onLine === false) return Promise.resolve();
        var ptr = 0;
        try { ptr = (JSON.parse(localStorage.getItem(LS_SYNC) || '{}') || {}).lastSeq || 0; } catch (e) {}
        _syncBusy = true;
        return usageAfter(ptr, 200).then(function (evs) {
            if (!evs.length) { _syncBusy = false; return; }
            return cloudFetch('/usage', {
                method: 'POST',
                body: { events: evs.map(function (ev) { return { ts: ev.ts, t: ev.t, k: ev.k, proj: ev.proj, dev: ev.dev, u: ev.u, uid: ev.uid }; }) }
            }).then(function (r) {
                _syncBusy = false;
                if (r.ok) {
                    try { localStorage.setItem(LS_SYNC, JSON.stringify({ lastSeq: evs[evs.length - 1].seq })); } catch (e) {}
                    if (evs.length === 200) return syncUsage();   // další dávka
                }
            });
        }).catch(function () { _syncBusy = false; });
    }
    window.addEventListener('online', function () { setTimeout(function () { syncUsage(); refreshConfig(); }, 1500); });

    // ------------------------------------------------------------------
    // PROFILY FIREM — jedno zařízení může znát víc firem (např. admin
    // vlastní + zákaznická). Profil = záloha klíčů firmy (konfigurace,
    // token, offline ověřovadla, ukazatel synchronizace) — ZÁMĚRNĚ bez
    // aktivní session: po přepnutí se vždy znovu přihlašuje (heslo/PIN),
    // aby si kdokoli u telefonu nepřepnul do cizí firmy bez ověření.
    // Body a zakázky se s firmou nepřepínají — zůstávají v zařízení.
    // ------------------------------------------------------------------
    var PROF_KEYS = [LS_FIRM, LS_TOK, LS_OFF, LS_SYNC];
    function profileKeyOf(f) { return f.cloud ? ('c:' + (f.code || '?')) : ('l:' + (f.firmName || 'Moje firma')); }
    function listProfiles() {
        try { var a = JSON.parse(localStorage.getItem(LS_PROF) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    function saveProfiles(a) { try { localStorage.setItem(LS_PROF, JSON.stringify(a)); } catch (e) {} }
    // ulož/obnov AKTUÁLNÍ firmu v seznamu profilů (volá se při každém uložení firmy)
    function rememberCurrentFirm() {
        var f = null;
        try { f = JSON.parse(localStorage.getItem(LS_FIRM) || 'null'); } catch (e) {}
        if (!f || !f.enabled) return;
        var snap = {};
        PROF_KEYS.forEach(function (k) {
            try { var v = localStorage.getItem(k); if (v != null) snap[k] = v; } catch (e) {}
        });
        var key = profileKeyOf(f);
        var a = listProfiles().filter(function (p) { return p && p.key !== key; });
        a.unshift({ key: key, label: f.firmName || 'Moje firma', code: f.code || null, cloud: !!f.cloud, ts: Date.now(), snap: snap });
        saveProfiles(a.slice(0, 10));
    }
    function switchProfile(key) {
        var a = listProfiles(), p = null;
        for (var i = 0; i < a.length; i++) if (a[i] && a[i].key === key) p = a[i];
        if (!p || !p.snap) return false;
        rememberCurrentFirm();                       // ať se dá vrátit zpět
        PROF_KEYS.forEach(function (k) {
            try { if (p.snap[k] != null) localStorage.setItem(k, p.snap[k]); else localStorage.removeItem(k); } catch (e) {}
        });
        setSess(null);                               // vždy nové přihlášení
        clearGuest();
        var g = document.getElementById('ag-gate'); if (g) g.remove();
        applyPerms();
        if (getFirm()) showLogin(false);
        try { window.dispatchEvent(new CustomEvent('agucty:firmswitch')); } catch (e) {}
        return true;
    }
    function removeProfile(key) {
        saveProfiles(listProfiles().filter(function (p) { return p && p.key !== key; }));
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
    // id zařízení — stejný klíč jako journal.js (arDeviceId)
    function devId() { try { var d = localStorage.getItem('arDeviceId'); if (!d) { d = 'd' + Math.abs((navigator.userAgent || '').split('').reduce(function (a, c) { return (a * 31 + c.charCodeAt(0)) | 0; }, 7)).toString(36); localStorage.setItem('arDeviceId', d); } return d; } catch (e) { return '?'; } }
    function usageLog(type, key) {
        var f = getFirm(); if (!f) return;               // bez firemního režimu nic nesledovat
        var u = currentUser();
        var rec = { ts: Date.now(), u: u ? u.name : '?', uid: u ? u.id : null, t: type, k: key || null, proj: pid(), dev: devId() };
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
        var guest = !f && isGuest();
        var restrict = !!(f && u && u.role !== 'admin') || guest;

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
        try { document.body.classList.toggle('ag-guest', guest); } catch (e) {}
        syncGuestPill(guest);
        try { window.dispatchEvent(new CustomEvent('agucty:perms')); } catch (e) {}
    }

    // trvalý štítek omezeného režimu (klepnutí = zpět na přihlašovací bránu)
    function syncGuestPill(on) {
        var el = document.getElementById('ag-guest-pill');
        if (!on) { if (el) el.remove(); return; }
        if (el || !document.body) return;
        injectStyles();
        el = document.createElement('button');
        el.type = 'button';
        el.id = 'ag-guest-pill';
        el.innerHTML = 'Omezený režim · <b>přihlásit</b>';
        el.onclick = function () { showGate(); };
        document.body.appendChild(el);
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
    function tick() { wrapRegister(); if (getFirm() || isGuest()) applyPerms(); gateCheck(); }

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
            '#ag-login .agl-logo,#ag-gate .agl-logo{font:800 22px/1.2 var(--font-display,system-ui);color:var(--accent,#2f9e74);letter-spacing:.02em;}',
            '#ag-login .agl-firm,#ag-gate .agl-firm{font:600 14px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);max-width:340px;text-align:center;}',
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
            '#ag-login .agl-err,#ag-gate .agl-err{color:var(--danger,#e5534b);font:600 13px/1.3 var(--font-ui,system-ui);min-height:17px;}',
            '#ag-login .agl-btn,#ag-gate .agl-btn{border:1px solid var(--accent-line,rgba(47,158,116,0.42));background:var(--accent,#2f9e74);color:#fff;',
            '  border-radius:12px;padding:12px 26px;font:700 15px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '#ag-login .agl-ghost,#ag-gate .agl-ghost{background:transparent;color:var(--text-muted,#9aa1ac);border:none;font:500 12.5px/1 var(--font-ui,system-ui);cursor:pointer;padding:8px;}',
            '#ag-login.agl-shake .agl-pinbox{animation:aglshake .35s;}',
            '@keyframes aglshake{20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}',
            // brána při startu (výběr: přihlásit / založit / omezený režim)
            '#ag-gate{position:fixed;inset:0;z-index:999999;background:var(--bg,#0d1117);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;',
            '  padding:calc(24px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));overflow-y:auto;}',
            '#ag-gate .agg-sec{font:700 11px/1 var(--font-ui,system-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);margin-top:4px;}',
            '#ag-gate .agg-prof{display:flex;flex-direction:column;align-items:center;gap:3px;width:min(320px,86vw);background:var(--glass-bg,rgba(255,255,255,0.06));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));border-radius:14px;padding:10px 14px;cursor:pointer;color:var(--text,#e6e8eb);}',
            '#ag-gate .agg-prof b{font:700 14px/1.2 var(--font-ui,system-ui);}',
            '#ag-gate .agg-prof span{font:500 11px/1.2 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#ag-gate .agg-box{display:none;flex-direction:column;gap:8px;width:min(320px,86vw);}',
            '#ag-gate .agg-box.on{display:flex;}',
            '#ag-gate .agg-box input{font:600 15px/1.2 var(--font-ui,system-ui);text-align:center;background:var(--glass-bg,rgba(255,255,255,0.06));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.2));border-radius:12px;color:var(--text,#e6e8eb);padding:12px 8px;}',
            '#ag-gate .agg-alt{border:1px solid var(--glass-border,rgba(255,255,255,0.18));background:transparent;color:var(--text,#e6e8eb);',
            '  border-radius:12px;padding:11px 22px;font:600 13.5px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '#ag-gate .agg-note{max-width:320px;text-align:center;font:500 11.5px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            // štítek omezeného režimu
            '#ag-guest-pill{position:fixed;top:calc(env(safe-area-inset-top) + 8px);left:50%;transform:translateX(-50%);z-index:9500;',
            '  background:rgba(13,17,23,0.82);border:1px solid var(--glass-border,rgba(255,255,255,0.2));border-radius:999px;',
            '  color:var(--text-muted,#9aa1ac);font:500 11.5px/1 var(--font-ui,system-ui);padding:7px 13px;cursor:pointer;}',
            '#ag-guest-pill b{color:var(--accent,#2f9e74);font-weight:700;}'
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
        var cloud = !!f.cloud;
        ov.innerHTML =
            '<div class="agl-logo">AR Geodet</div>' +
            '<div class="agl-firm">' + esc(f.firmName || 'Firemní režim') + (cloud && f.code ? ' · ' + esc(f.code) : '') + (lockMode ? ' — zamčeno' : '') + '</div>' +
            '<div class="agl-users">' + usersHtml + '</div>' +
            '<div class="agl-pinbox">' +
            '  <input class="agl-name" type="text" autocomplete="username" maxlength="40" placeholder="Jméno" style="display:none;font:600 15px/1.2 var(--font-ui,system-ui);letter-spacing:0;text-align:center;width:190px;background:var(--glass-bg,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.2));border-radius:12px;color:var(--text,#e6e8eb);padding:12px 8px;">' +
            (cloud
                ? '  <input class="agl-pin" type="password" autocomplete="current-password" maxlength="64" placeholder="Heslo" style="letter-spacing:.12em;font-size:17px;">'
                : '  <input class="agl-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="PIN">') +
            '  <div class="agl-err"></div>' +
            '  <button type="button" class="agl-btn">Přihlásit</button>' +
            '</div>' +
            (cloud ? '<button type="button" class="agl-ghost" id="agl-other">Přihlásit jiné jméno</button>' : '') +
            '<button type="button" class="agl-ghost" id="agl-forgot">' + (cloud ? 'Zapomenuté heslo?' : 'Zapomenutý PIN?') + '</button>';
        document.body.appendChild(ov);

        var pinbox = ov.querySelector('.agl-pinbox');
        var pinInp = ov.querySelector('.agl-pin');
        var nameInp = ov.querySelector('.agl-name');
        var errEl = ov.querySelector('.agl-err');

        function pick(id) {
            _selUser = null;
            for (var i = 0; i < f.users.length; i++) if (f.users[i].id === id) _selUser = f.users[i];
            var us = ov.querySelectorAll('.agl-user');
            for (var j = 0; j < us.length; j++) us[j].classList.toggle('sel', us[j].getAttribute('data-id') === id);
            if (!_selUser) return;
            errEl.textContent = '';
            nameInp.style.display = 'none';
            if (!cloud && (_selUser.noPin || !_selUser.pinHash)) { finish(_selUser); return; }
            pinbox.classList.add('on');
            pinInp.value = '';
            setTimeout(function () { try { pinInp.focus(); } catch (e) {} }, 50);
        }
        function finish(u) {
            setSess({ userId: u.id, ts: Date.now() });
            try { localStorage.setItem('arSurveyor', u.name); } catch (e) {}
            afterLogin(u);
        }
        // společný závěr (lokální i cloud — cloud má session/token už uložené)
        function afterLogin(u) {
            ov.remove();
            _touchActivity();
            applyPerms();
            usageLog('login', lockMode ? 'unlock' : 'login');
            if (cloud) setTimeout(syncUsage, 2000);
            try { window.dispatchEvent(new CustomEvent('agucty:login', { detail: { user: u } })); } catch (e) {}
        }
        function fail(msg) {
            errEl.textContent = msg || 'Přihlášení selhalo.';
            pinInp.value = '';
            ov.classList.remove('agl-shake');
            void ov.offsetWidth;   // restart animace
            ov.classList.add('agl-shake');
        }
        var _busy = false;
        function submit() {
            if (_busy) return;
            var pin = pinInp.value || '';
            if (cloud) {
                // jméno: vybraný uživatel, nebo ručně zadané („Přihlásit jiné jméno")
                var nm = _selUser ? _selUser.name : (nameInp.value || '').trim();
                if (!nm) { errEl.textContent = 'Vyber uživatele nebo zadej jméno.'; return; }
                _busy = true;
                errEl.textContent = 'Ověřuji…';
                cloudLogin(nm, pin, function (errMsg, u2) {
                    _busy = false;
                    if (errMsg) return fail(errMsg);
                    afterLogin(u2);
                });
                return;
            }
            if (!_selUser) { errEl.textContent = 'Nejdřív vyber uživatele.'; return; }
            hashPin(pin, _selUser.salt).then(function (h) {
                if (h === _selUser.pinHash) { finish(_selUser); return; }
                fail('Nesprávný PIN.');
            });
        }

        ov.addEventListener('click', function (e) {
            var ub = e.target.closest ? e.target.closest('.agl-user') : null;
            if (ub) { pick(ub.getAttribute('data-id')); return; }
            if (e.target.classList.contains('agl-btn')) submit();
        });
        pinInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
        // „Přihlásit jiné jméno" (cloud): nový zaměstnanec, kterého tahle cache ještě nezná
        var otherBtn = ov.querySelector('#agl-other');
        if (otherBtn) otherBtn.addEventListener('click', function () {
            _selUser = null;
            var us = ov.querySelectorAll('.agl-user');
            for (var j = 0; j < us.length; j++) us[j].classList.remove('sel');
            errEl.textContent = '';
            nameInp.style.display = '';
            pinbox.classList.add('on');
            setTimeout(function () { try { nameInp.focus(); } catch (e) {} }, 50);
        });

        // Zapomenutý PIN/heslo: admin resetuje v administraci; nouzový reset
        // vypne JEN firemní režim na TOMTO zařízení (geodetická data zůstanou;
        // v cloud režimu se firma na serveru nijak nemění).
        ov.querySelector('#agl-forgot').addEventListener('click', function () {
            var admins = f.users.filter(function (u) { return u.role === 'admin'; }).map(function (u) { return u.name; });
            var msg = cloud
                ? ('Heslo ti změní administrátor (' + (admins.join(', ') || '—') + ') v Administraci firmy — z libovolného zařízení.\n\n' +
                    'Nouzově lze toto ZAŘÍZENÍ od firmy odpojit — appka se odemkne bez účtů. ' +
                    'BODY A ZAKÁZKY ZŮSTANOU, firma na serveru se nemění (jiná zařízení jedou dál).\n\nPro odpojení napiš RESET:')
                : ('PIN ti může změnit administrátor (' + (admins.join(', ') || '—') + ') v Administraci firmy.\n\n' +
                    'Když je nedostupný i admin, lze firemní režim NOUZOVĚ vypnout — appka se odemkne, ' +
                    'účty a oprávnění se smažou. BODY A ZAKÁZKY ZŮSTANOU.\n\nPro nouzové vypnutí napiš RESET:');
            var v = prompt(msg, '');
            if (v === 'RESET') {
                removeProfile(profileKeyOf(f));
                try { localStorage.removeItem(LS_FIRM); localStorage.removeItem(LS_TOK); localStorage.removeItem(LS_OFF); localStorage.removeItem(LS_SYNC); } catch (e) {}
                setSess(null);
                ov.remove();
                applyPerms();
                alert(cloud ? 'Zařízení odpojeno od firmy. Body a zakázky zůstaly beze změny.'
                    : 'Firemní režim vypnut. Body a zakázky zůstaly beze změny.');
                showGate();
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

    // ------------------------------------------------------------------
    // BRÁNA při startu: bez firmy se appka neotevře — uživatel se přihlásí
    // (kód firmy), založí firmu (průvodce v ucty-admin.js), přepne na firmu,
    // kterou zařízení už zná, nebo pokračuje v omezeném režimu bez přihlášení.
    // ------------------------------------------------------------------
    function showGate() {
        if (getFirm()) { showLogin(false); return; }   // firma už nastavena → rovnou přihlášení
        injectStyles();
        var old = document.getElementById('ag-gate'); if (old) old.remove();
        var ov = document.createElement('div');
        ov.id = 'ag-gate';
        var profs = listProfiles();
        var profHtml = '';
        if (profs.length) {
            profHtml = '<div class="agg-sec">Firmy na tomto zařízení</div>' +
                profs.map(function (p) {
                    return '<button type="button" class="agg-prof" data-key="' + esc(p.key) + '">' +
                        '<b>' + esc(p.label) + '</b>' +
                        '<span>' + (p.cloud ? 'cloud · kód ' + esc(p.code || '?') : 'jen toto zařízení') + '</span></button>';
                }).join('');
        }
        ov.innerHTML =
            '<div class="agl-logo">AR Geodet</div>' +
            '<div class="agl-firm">Přihlas se ke své firmě, nebo pokračuj bez přihlášení s omezenými funkcemi.</div>' +
            profHtml +
            '<div class="agg-box" id="agg-join">' +
            '  <input type="text" id="agg-code" maxlength="6" placeholder="Kód firmy" autocapitalize="characters" autocomplete="off" style="text-transform:uppercase;letter-spacing:.15em;">' +
            '  <input type="text" id="agg-name" maxlength="40" placeholder="Jméno" autocomplete="username">' +
            '  <input type="password" id="agg-pass" maxlength="64" placeholder="Heslo" autocomplete="current-password">' +
            '  <div class="agl-err" id="agg-err"></div>' +
            '  <button type="button" class="agl-btn" id="agg-go">Přihlásit</button>' +
            '</div>' +
            '<button type="button" class="agl-btn" id="agg-show-join">Přihlásit se (mám kód firmy)</button>' +
            '<button type="button" class="agg-alt" id="agg-new">Založit firmu / další možnosti</button>' +
            '<button type="button" class="agl-ghost" id="agg-guest">Pokračovat bez přihlášení (omezený režim)</button>' +
            '<div class="agg-note">Bez přihlášení funguje jen základní měření bodů a vzhled. Nástroje, export, zakázky a nastavení dat vyžadují firemní účet.</div>';
        document.body.appendChild(ov);

        var errEl = ov.querySelector('#agg-err');
        ov.addEventListener('click', function (e) {
            var pb = e.target.closest ? e.target.closest('.agg-prof') : null;
            if (pb) { switchProfile(pb.getAttribute('data-key')); return; }
        });
        ov.querySelector('#agg-show-join').onclick = function () {
            this.style.display = 'none';
            ov.querySelector('#agg-join').classList.add('on');
            setTimeout(function () { try { ov.querySelector('#agg-code').focus(); } catch (e) {} }, 50);
        };
        var _busy = false;
        ov.querySelector('#agg-go').onclick = function () {
            if (_busy) return;
            var code = (ov.querySelector('#agg-code').value || '').trim().toUpperCase();
            var name = (ov.querySelector('#agg-name').value || '').trim();
            var pass = ov.querySelector('#agg-pass').value || '';
            if (!code || !name || !pass) { errEl.textContent = 'Vyplň kód firmy, jméno i heslo.'; return; }
            _busy = true;
            errEl.textContent = 'Ověřuji…';
            cloudFetch('/login', { method: 'POST', api: DEFAULT_API, body: { code: code, name: name, password: pass } }).then(function (r) {
                _busy = false;
                if (r.ok && r.data && r.data.token) {
                    adoptLogin(r.data, DEFAULT_API);   // odstraní i bránu
                    usageLog('login', 'join');
                    try { window.dispatchEvent(new CustomEvent('agucty:login', { detail: { user: r.data.user } })); } catch (e) {}
                    return;
                }
                errEl.textContent = r.status === 0
                    ? 'Server není dosažitelný — bez internetu se lze přihlásit jen k firmě, kterou toto zařízení už zná.'
                    : ((r.data && r.data.error) || ('Přihlášení selhalo (' + r.status + ').'));
            });
        };
        var passInp = ov.querySelector('#agg-pass');
        passInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ov.querySelector('#agg-go').click(); });
        ov.querySelector('#agg-new').onclick = function () {
            if (window.AGUctyAdmin && typeof AGUctyAdmin.wizard === 'function') {
                ov.remove();
                AGUctyAdmin.wizard();   // zavření průvodce bez dokončení vrátí bránu (gateCheck)
            } else {
                errEl.textContent = 'Modul administrace (ucty-admin.js) není načtený.';
            }
        };
        ov.querySelector('#agg-guest').onclick = function () { enterGuest(); };
    }

    // pojistka: bez firmy, bez hosta a bez otevřené brány/průvodce → ukázat bránu
    function gateCheck() {
        if (getFirm() || isGuest()) return;
        if (document.getElementById('ag-gate') || document.getElementById('ag-login')) return;
        var m = document.getElementById('agfa-modal');
        if (m && m.style.display === 'flex') return;   // běží průvodce založením firmy
        showGate();
    }

    function lock() {
        var u = currentUser();
        _lastUserId = u ? u.id : null;
        if (getFirm()) showLogin(true);
    }
    function logout() {
        _lastUserId = null;
        setSess(null);
        if (getFirm()) showLogin(false);
        else if (isGuest()) applyPerms();
        else showGate();
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
            rememberCurrentFirm();                 // ať je aktivní firma vždy v profilech
            var u = currentUser();
            if (!u) showLogin(false);
            else {
                try { localStorage.setItem('arSurveyor', u.name); } catch (e) {}
                applyPerms();
            }
            if (f.cloud) {
                setTimeout(refreshConfig, 2500);   // oprávnění/uživatelé se mohli změnit jinde
                setTimeout(syncUsage, 9000);       // odešli, co se nasbíralo offline
            }
        } else if (isGuest()) {
            applyPerms();                          // omezený režim bez přihlášení
        } else {
            showGate();                            // bez firmy se appka neotevře
        }
        // periodické srovnání UI (mřížku Nástrojů překreslují jiné moduly) + auto-zámek
        // + jednou za ~2 minuty synchronizace fronty užívání (cloud)
        var n = 0;
        setInterval(function () {
            tick(); lockCheck();
            if (++n % 60 === 0 && isCloud() && currentUser()) syncUsage();
        }, 2000);
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
        // brána + host + profily firem
        showGate: showGate,
        isGuest: isGuest,
        enterGuest: enterGuest,
        listProfiles: listProfiles,
        switchProfile: switchProfile,
        removeProfile: removeProfile,
        rememberCurrentFirm: rememberCurrentFirm,
        profileKeyOf: profileKeyOf,
        hashPin: hashPin,
        makeSalt: makeSalt,
        usageLog: usageLog,
        usageQuery: usageQuery,
        usageClear: usageClear,
        applyPerms: applyPerms,
        // cloud
        isCloud: isCloud,
        apiUrl: apiUrl,
        DEFAULT_API: DEFAULT_API,
        cloudFetch: cloudFetch,
        adoptLogin: adoptLogin,
        adoptConfig: adoptConfig,
        refreshConfig: refreshConfig,
        syncUsage: syncUsage
    };
})();
