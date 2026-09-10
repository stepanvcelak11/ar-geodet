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
//   • Brzda proti hádání hesla: po 5 chybách zámek na 1 min, dál se čekání
//     zdvojnásobuje (max 15 min); počítadlo přežije reload (LS_FAIL)
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
    // ⚠⚠ HOST (`agGuest_v1`) BYL ZRUŠEN 6. 9. 2026. Klíč se tu drží jen proto, aby
    //   se dal při startu SMAZAT — kdo appku měl v hostovském režimu, měl ho
    //   nastavený natrvalo a bez úklidu by mu brána nikdy nenaskočila.
    //   Proč zrušen: bez profilu neměla otázka „kdo to naměřil" odpověď, a přitom
    //   se v hostovském režimu měřilo. Nově se do appky bez účtu nedostane nikdo;
    //   registrace je za tři pole a nechce e-mail (viz showRegister níž).
    var LS_GUEST_STARY = 'agGuest_v1';
    var LS_ACC = 'agUcet_v1';          // účet: {id, code, name, tarif, tarifDo}
    var LS_SPACES = 'agProstory_v1';   // prostory účtu (přepínač) [{firmId,...}]
    var LS_OWNER = 'agVlastnik_v1';    // rezim vlastnika appky (js/vlastnik.js)
    var LS_PROF = 'agFirmy_v1';        // uložené firmy tohoto zařízení [{key,label,code,cloud,ts,snap}]
    var LS_LAST = 'agFirmaLastUser_v1';// id naposledy přihlášeného (rychlé odemknutí)
    var LS_LOCKSTART = 'agLockStart_v1'; // '0' = NEvyžadovat přihlášení při startu (výchozí: vyžadovat)
    var LS_DEVU = 'agFirmaDevUsers_v1';  // id účtů, které se přihlásily na TOMTO zařízení
    var LS_FAIL = 'agLoginFail_v1';      // brzda hádání hesla {n, until} — viz blok „ZAMYKÁNÍ" níže
    var LS_TRUST = 'agFirmaTrust_v1';    // pamatované přihlášení na TOMTO zařízení {userId,mode,n,ts}
    var LS_BIO = 'agFirmaBio_v1';        // Face ID / odemknutí telefonem {userId:{id,ts}}
    var LS_BIOASK = 'agFirmaBioAsk_v1';  // kdy se naposledy ptalo na zapnutí Face ID (aby to neotravovalo)
    var LS_PACL = 'agProjAcl_v1';        // zakázky povolené účtu NA TOMTO ZAŘÍZENÍ {userId:[projId]}
    var TRUST_MAX = 20;                  // po kolikátém automatickém přihlášení chtít znovu heslo/PIN
    var STYLE_ID = 'ag-ucty-style';
    var DB = 'argeodet-usage', STORE = 'ev', VER = 1;
    // adresa API (Cloudflare Worker, cloud/worker.js). Konstanta je jen výchozí —
    // skutečná adresa se ukládá do konfigurace firmy při založení/připojení.
    var DEFAULT_API = 'https://ar-geodet-api.ar-geodet.workers.dev';

    // líné načtení vendorované knihovny (stejný vzor jako sdileni.js) —
    // QR knihovny se stahují až při prvním použití, ne při startu appky
    var _libCache = {};
    function ensureLib(src) {
        if (_libCache[src]) return _libCache[src];
        _libCache[src] = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src; s.async = true;
            s.onload = function () { resolve(); };
            s.onerror = function () { _libCache[src] = null; reject(new Error('nelze načíst ' + src)); };
            (document.head || document.documentElement).appendChild(s);
        });
        return _libCache[src];
    }

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
        // Klíč zůstává 'dock.vice', i když tlačítko je teď „Vrstvy" — jinak by se
        // všem firmám při aktualizaci zahodilo uložené oprávnění pro tenhle slot.
        { k: 'dock.vice',      g: 'Hlavní obrazovka', t: 'Vrstvy (ovládání mapy)' },
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
    // ÚKLID PO ZRUŠENÉM HOSTOVI. Klíč `agGuest_v1` se nastavoval NATRVALO,
    // takže komu appka jednou v hostovském režimu naskočila, tomu by brána
    // nenaskočila nikdy. Smaže se hned při startu modulu, ne až v init() —
    // jinak by ho stihl přečíst kód v <head> index.html, který podle něj
    // rozhoduje, jestli vůbec ukázat úvodní obrazovku.
    function clearGuest() {
        try { localStorage.removeItem(LS_GUEST_STARY); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:clearGuest'); }
        bustFirm();
    }
    clearGuest();

    // ------------------------------------------------------------------
    // ÚČET A JEHO PROSTORY
    // ------------------------------------------------------------------
    // Identita (kdo jsi, tarif) je ÚČET; kde zrovna pracuješ, je PROSTOR.
    // Vlastní prostor má účet vždycky a nikdy o něj nepřijde — firma je
    // členství DRUHÉ. V Základu se o žádné „firmě" neví: prostor je jen
    // místo, kterému si člověk při registraci dal jméno.
    function getUcet() {
        try { return JSON.parse(localStorage.getItem(LS_ACC) || 'null'); } catch (e) { return null; }
    }
    function setUcet(u) {
        try {
            if (u) localStorage.setItem(LS_ACC, JSON.stringify(u));
            else localStorage.removeItem(LS_ACC);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:setUcet'); }
        // ⚠ TARIF SE MUSÍ PROPSAT DO LICENCE HNED. Kdyby se čekalo na příští
        //   /config, měl by člověk s Pro po přihlášení zamčené nástroje a
        //   nevěděl proč. AGLic si hodnotu uloží, takže platí i bez signálu.
        try {
            if (window.AGLic && AGLic.tarifUctu) AGLic.tarifUctu(u && u.tarif, u && u.tarifDo);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:tarif'); }
    }
    function getProstory() {
        try {
            var p = JSON.parse(localStorage.getItem(LS_SPACES) || '[]');
            return Array.isArray(p) ? p : [];
        } catch (e) { return []; }
    }
    function setProstory(p) {
        try { localStorage.setItem(LS_SPACES, JSON.stringify(Array.isArray(p) ? p : [])); }
        catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:setProstory'); }
    }
    // Prostor, ve kterém appka právě je (podle kódu firmy v agFirma_v1).
    function aktualniProstor() {
        var f = getFirm();
        if (!f) return null;
        var vse = getProstory();
        for (var i = 0; i < vse.length; i++) if (vse[i].kod && vse[i].kod === f.code) return vse[i];
        // Vlastní prostor kód neposílá (je jednomístný, není kam zvát) — pozná
        // se podle toho, že je jediný vlastní.
        for (i = 0; i < vse.length; i++) if (vse[i].vlastni) return vse[i];
        return null;
    }
    function tarif() { var u = getUcet(); return (u && u.tarif === 'pro') ? 'pro' : 'zaklad'; }

    // vyžadovat přihlášení při každém startu appky (výchozí ANO; per zařízení)
    function getLockOnStart() {
        try { return localStorage.getItem(LS_LOCKSTART) !== '0'; } catch (e) { return true; }
    }
    function setLockOnStart(on) {
        try { localStorage.setItem(LS_LOCKSTART, on ? '1' : '0'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:setLockOnStart'); }
    }

    // ------------------------------------------------------------------
    // Úložiště konfigurace (localStorage, SUROVÉ klíče — bez prefixu zakázky)
    // ------------------------------------------------------------------
    // BATERIE: getFirm() je nejčastěji volaná funkce v celé appce — can() ji volá dvakrát
    // (jednou přímo, jednou přes isGuest()) a applyPerms() volá can() pro každý hlídaný
    // prvek při každém ticku. Naměřeno v klidovém AR: 190 čtení localStorage za sekundu,
    // z toho 137 odsud, každé s vlastním JSON.parse. localStorage je SYNCHRONNÍ — každé
    // čtení blokuje hlavní vlákno, takže se to na mobilu projeví i na plynulosti AR.
    //
    // Proto krátká vyrovnávací paměť: v rámci TTL se vrací už rozparsovaný objekt.
    // Bezpečnost tím netrpí — oprávnění se nevymáhají tímhle čtením, ale skrýváním
    // prvků při applyPerms(), a to se stejně přepočítá při dalším ticku. Zápisy uvnitř
    // appky rušíme platnost okamžitě (bustFirm), takže změna role/odhlášení se projeví
    // hned; TTL je jen záchranná síť pro zápisy, o kterých nevíme (jiná záložka, ruční
    // zásah do úložiště). Cache se drží ZVLÁŠŤ pro syrový řetězec i pro výsledek, aby
    // volající nikdy nedostal objekt sdílený s dřívějším stavem.
    var FIRM_TTL = 500;                       // ms
    var _firmVal = null, _firmTs = 0, _firmHas = false;
    function bustFirm() { _firmHas = false; _ownHas = false; }
    function getFirm() {
        var now = Date.now();
        if (_firmHas && (now - _firmTs) < FIRM_TTL) return _firmVal;
        var out = null;
        try {
            var raw = localStorage.getItem(LS_FIRM);
            if (raw) {
                var f = JSON.parse(raw);
                if (f && f.enabled && Array.isArray(f.users) && f.users.length) {
                    if (!f.perms) f.perms = defaultPerms();       // fail-open: bez uživatelů nezamykat
                    out = f;
                }
            }
        } catch (e) { out = null; }
        _firmVal = out; _firmTs = now; _firmHas = true;
        return out;
    }
    // REŽIM VLASTNÍKA (js/vlastnik.js): vývojář appky se na bráně odemkne klíčem
    // OWNER_KEY a od té chvíle pro něj vrstva účtů neplatí — žádná brána, žádné
    // přihlášení, can() všude true. Firma na zařízení se NEMAŽE ani nepřepisuje,
    // jen se přeskočí; po ukončení režimu je zpátky nedotčená.
    // Cache ze stejného důvodu jako u getFirm(): can() se volá v každém ticku
    // desítkykrát a localStorage je synchronní.
    var _ownVal = false, _ownTs = 0, _ownHas = false;
    function isOwner() {
        var now = Date.now();
        if (_ownHas && (now - _ownTs) < FIRM_TTL) return _ownVal;
        var v = false;
        try { v = localStorage.getItem(LS_OWNER) === '1'; } catch (e) { v = false; }
        _ownVal = v; _ownTs = now; _ownHas = true;
        return v;
    }
    // Bez profilu se do appky nedostane nikdo — hostovský režim byl zrušen,
    // takže tahle otázka má vždycky tutéž odpověď. Funkce zůstává kvůli
    // modulům, které se na ni ptají (a kvůli starším zálohám nastavení).
    function isGuest() { return false; }
    // zápis do úložiště z JINÉ záložky/okna — zahodit cache hned, ne až po TTL
    try {
        window.addEventListener('storage', function (e) {
            if (!e || !e.key || e.key === LS_FIRM || e.key === LS_ACC || e.key === LS_OWNER) bustFirm();
        });
    } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:storage'); }
    function saveFirm(f) {
        try { localStorage.setItem(LS_FIRM, JSON.stringify(f)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:saveFirm'); }
        bustFirm();
        clearGuest();
        rememberCurrentFirm();
        applyPerms();
    }
    function getSess() {
        try { return JSON.parse(localStorage.getItem(LS_SESS) || 'null'); } catch (e) { return null; }
    }
    function setSess(s) {
        try { if (s) localStorage.setItem(LS_SESS, JSON.stringify(s)); else localStorage.removeItem(LS_SESS); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:setSess'); }
    }

    // ------------------------------------------------------------------
    // Účty na TOMTO zařízení: přihlašovací obrazovka nabízí jen lidi, kdo se
    // tu už přihlásil — na mobilu zaměstnance se tedy nesvítí dlaždice admina
    // ani vedení. Cizí účet se dá vždy přidat přes „Přihlásit jiné jméno".
    // U LOKÁLNÍ firmy (účty žijí jen v tomhle telefonu) se nabízejí všichni,
    // protože jinde neexistují.
    // ------------------------------------------------------------------
    function devUserIds() {
        var out = {};
        try {
            var a = JSON.parse(localStorage.getItem(LS_DEVU) || '[]');
            if (Array.isArray(a)) a.forEach(function (id) { out[id] = 1; });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:devUserIds'); }
        try { var o = getOff(); Object.keys(o || {}).forEach(function (id) { out[id] = 1; }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:devUserIds'); }
        return out;
    }
    function rememberDevUser(id) {
        if (!id) return;
        try {
            var a = JSON.parse(localStorage.getItem(LS_DEVU) || '[]');
            if (!Array.isArray(a)) a = [];
            if (a.indexOf(id) === -1) a.push(id);
            localStorage.setItem(LS_DEVU, JSON.stringify(a.slice(-12)));
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:rememberDevUser'); }
    }
    function loginUsers(f) {
        // lokální firma: účty existují jen zde, ale zablokované se nenabízejí
        if (!f.cloud) return f.users.filter(function (u) { return !u.disabled; });
        var known = devUserIds();
        var out = f.users.filter(function (u) { return known[u.id] && !u.disabled; });
        return out;
    }

    // zablokovaný účet se chová jako nepřihlášený (appka se zamkne, server
    // jeho token odmítá hned) — blokování tedy platí i offline na tomto zařízení
    function currentUser() {
        var f = getFirm(); if (!f) return null;
        var s = getSess(); if (!s || !s.userId) return null;
        for (var i = 0; i < f.users.length; i++) {
            if (f.users[i].id === s.userId) return f.users[i].disabled ? null : f.users[i];
        }
        return null;
    }
    function isAdmin() { var u = currentUser(); return !!(u && u.role === 'admin'); }
    function can(key) {
        if (isOwner()) return true;      // rezim vlastnika: opravneni firem se nevztahuji
        var f = getFirm();
        if (!f) return true;              // před branou / po nouzovém resetu
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
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:hashPin'); }
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
    function setTok(t) { try { if (t) localStorage.setItem(LS_TOK, JSON.stringify(t)); else localStorage.removeItem(LS_TOK); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:setTok'); } }
    function getOff() { try { return JSON.parse(localStorage.getItem(LS_OFF) || '{}') || {}; } catch (e) { return {}; } }
    function saveOff(userId, ver) { try { var o = getOff(); o[userId] = ver; localStorage.setItem(LS_OFF, JSON.stringify(o)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:saveOff'); } }

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

    // OFFLINE OVEROVADLO SI DELA TELEFON SAM.
    // Drive ho posilal server jako { salt, iters, hash: u.pass_hash } - v localStorage
    // tak lezel PRESNE ten retezec, ktery ma server v databazi, a jeste na 40 000
    // iteracich. Prihlasit se s nim na server nejde (server chce heslo a hashuje si ho
    // sam), ale bylo to zbytecne provazani telefonu s databazi a levne k hadani.
    // Ted si ho telefon pri online prihlaseni odvodi z VLASTNI nahodne soli a s vic
    // iteracemi. Server uz ho tedy neposila vubec.
    // ZPETNA KOMPATIBILITA: starsi zaznamy (bez v:2) se poznaji podle toho, ze v nich
    // je salt/iters od serveru - overovani je cte ze zaznamu, takze funguji dal
    // a prepisi se samy pri pristim online prihlaseni.
    var OFF_ITERS = 210000;
    function randSaltHex(n) {
        try {
            var a = new Uint8Array(n || 16); crypto.getRandomValues(a);
            var s = '';
            for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
            return s;
        } catch (e) { return null; }
    }
    function makeOffline(userId, pass) {
        var salt = randSaltHex(16);
        if (!salt || pass == null) return Promise.resolve(false);
        return pbkdf2Hex(pass, salt, OFF_ITERS).then(function (h) {
            if (!h) return false;
            saveOff(userId, { salt: salt, iters: OFF_ITERS, hash: h, v: 2 });
            return true;
        }).catch(function () { return false; });
    }

    // volání API s tokenem; VŽDY resolve {ok, status, data}; status 0 = síť/offline
    function cloudFetch(path, opts) {
        opts = opts || {};
        var headers = { 'Content-Type': 'application/json' };
        var tok = getTok();
        if (tok && tok.token) headers['Authorization'] = 'Bearer ' + tok.token;
        // BATERIE: bez timeoutu visel dotaz na „mrtvem, ale otevrenem" spoji (typicky slaby
         // signal v terenu) desitky sekund a drzel radio ve vysokem prikonu; pri pollingu
        // se takove dotazy jeste kupily. 12 s je pro toto API dost.
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var to = null;
        var p;
        try {
            // RAZITKO U GET. Service worker uz sam nechava *.workers.dev vzdy jit na
            // sit, ale firma si smi nastavit vlastni host (getFirm().api), na ktery
            // ta vyjimka nesedi. Bez razitka maji /config, /chat?after=N a
            // /sync/points?since=T porad stejnou URL, takze je jakakoli cache-first
            // vrstva (SW i HTTP cache) po prvni odpovedi zmrazi. Parametr `_`
            // worker nikde necte, na routovani ani na after/since nema vliv.
            var _m = opts.method || 'GET';
            var _u = (opts.api || apiUrl()) + path;
            if (_m === 'GET') _u += (_u.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now();
            p = fetch(_u, {
                method: _m,
                headers: headers,
                body: opts.body != null ? JSON.stringify(opts.body) : undefined,
                signal: ctrl ? ctrl.signal : undefined
            });
            if (ctrl) to = setTimeout(function () { try { ctrl.abort(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:cloudFetch'); } }, opts.timeoutMs || 12000);
        } catch (e) { if (to) clearTimeout(to); return Promise.resolve({ ok: false, status: 0, data: null }); }
        return p.then(function (r) {
            if (to) { clearTimeout(to); to = null; }
            return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
        }).catch(function () { if (to) { clearTimeout(to); to = null; } return { ok: false, status: 0, data: null }; });
    }

    // převzetí konfigurace ze serveru do lokální cache (tvar agFirma_v1)
    //
    // `nova` = true jen při PŘIHLÁŠENÍ (adoptLogin), kdy se firma smí legálně změnit.
    // ⚠⚠ JINAK SE KÓD FIRMY MUSÍ SHODOVAT (nahlášeno 29. 8. 2026: „když se přepnu do
    // druhé firmy a kliknu na Uživatele, kopne mě to zpátky do původní firmy").
    // Přesně to se dělo: sekce Uživatelé si na začátku říká o refreshConfig(), a když
    // v telefonu z jakéhokoli důvodu zůstal token PŘEDCHOZÍ firmy (profil bez tokenu,
    // rozdělané přepnutí, souběžný požadavek odeslaný ještě před přepnutím), server
    // poslal konfiguraci TÉ STARÉ firmy — a tenhle zápis ji beze slova nastavil jako
    // aktivní. Uživatel byl rázem zpátky ve firmě, ze které odešel. Odpověď, která
    // nesedí na právě aktivní firmu, se teď zahodí.
    function adoptConfig(cfg, api, nova) {
        if (!cfg || !cfg.firm) return;
        var old = null;
        try { old = JSON.parse(localStorage.getItem(LS_FIRM) || 'null'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:adoptConfig'); }
        if (!nova && old && old.enabled && old.cloud && old.code && cfg.firm.code && old.code !== cfg.firm.code) return;
        var f = {
            enabled: true, cloud: true,
            api: api || (old && old.api) || DEFAULT_API,
            code: cfg.firm.code,
            firmName: cfg.firm.name,
            autoLockMin: cfg.firm.autoLockMin || 0,
            perms: cfg.firm.perms || (old && old.perms) || defaultPerms(),
            // POZOR: zablokované účty se ZACHOVÁVAJÍ (admin je musí vidět, aby je
            // mohl odblokovat). Z přihlašování je vyřazuje loginUsers(),
            // z práce currentUser() a server odmítne jejich token hned.
            users: (cfg.users || []),
            // Strop míst, stav žádosti o navýšení a hláška vlastníka appky.
            // Chodí to s /config, takže to nestojí žádný další požadavek — a když
            // je appka offline, platí poslední známý stav místo prázdna.
            limits: cfg.limits || (old && old.limits) || null,
            request: cfg.request || null,
            notice: cfg.notice || null,
            // VYPÍNAČ MODULŮ NA DÁLKU (js/priznaky.js). Seznam vypnutých nástrojů
            // posílá worker v /config a čte se právě odsud (AGUcty.getFirm().flags).
            // ⚠ ZÁMĚRNĚ BEZ fallbacku na `old` jako u perms/limits: worker posílá
            //   flags: null ve chvíli, kdy vlastník vypínač ZRUŠIL, a právě na tom
            //   stojí druhá větev v priznaky.js (vyprázdnit seznam). S fallbackem
            //   by vypínač nešlo vypnout. Když pole chybí (starší worker), zapíše
            //   se null a priznaky.js na lokální seznam nesáhne.
            flags: cfg.flags || null,
            fetchedTs: Date.now()
        };
        try { localStorage.setItem(LS_FIRM, JSON.stringify(f)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:adoptConfig'); }
        // ZÁPIS MIMO saveFirm() → cache getFirm() se MUSÍ zneplatnit ručně. Bez toho
        // vracel getFirm() až 500 ms PŘEDCHOZÍ firmu (viz FIRM_TTL): applyPerms() níž
        // pak počítalo oprávnění ze staré firmy a refreshConfig() hned poté nenašel
        // přihlášeného uživatele v nové konfiguraci → appka se sama odhlásila.
        bustFirm();
        clearGuest();
        // ⚠⚠ PROFIL FIRMY SE MUSÍ AKTUALIZOVAT TAKY. Profil (`agFirmy_v1`) je záloha
        // klíčů firmy, ze které se firma obnovuje při přepnutí zpátky — a psal se
        // dosud jen v saveFirm(). Jenže čerstvý seznam uživatelů ze serveru chodí
        // TUDY, mimo saveFirm(), takže v profilu zůstávala konfigurace z okamžiku
        // přihlášení. Po přepnutí firem se pak obnovil TEN STARÝ stav: chyběli lidé,
        // kteří mezitím přibyli, a svítili ti, kdo byli dávno smazaní. Přesně to je
        // hlášení z 29. 8. 2026 — „chat má v sobě uživatele, kteří neexistují, a
        // nejsou tam stávající členové" a „u Uživatelů vidím pouze sebe".
        rememberCurrentFirm();
        applyPerms();
    }

    // po úspěšném /login nebo /firms: konfigurace + token + ověřovadlo + session
    function adoptLogin(data, api, pass) {
        adoptConfig(data.config, api, true);   // přihlášení SMÍ změnit firmu
        // ÚČET A JEHO PROSTORY. Chodí to z /login i /register; starší worker je
        // neposílá vůbec (pole chybí) — v tom případě se na uložený účet NESAHÁ,
        // aby nasazení nového klienta proti starému serveru nesebralo lidem Pro.
        if (data.ucet) setUcet({
            id: data.ucet.id, code: data.ucet.code, name: data.ucet.name,
            tarif: data.ucet.tarif || 'zaklad', tarifDo: data.ucet.tarifDo || 0
        });
        if (data.prostory) setProstory(data.prostory);
        setTok({ token: data.token, userId: data.user.id });
        // Overovadlo si spocita telefon sam (viz makeOffline). data.offline je tu uz
        // jen kvuli STARSIMU workeru, ktery ho jeste posila - a jako zachrana pro
        // zarizeni bez WebCrypto, kde se vlastni odvozeni nepovede.
        if (pass != null) {
            makeOffline(data.user.id, pass).then(function (ok) {
                if (!ok && data.offline) saveOff(data.user.id, data.offline);
            });
        } else if (data.offline) saveOff(data.user.id, data.offline);
        setSess({ userId: data.user.id, ts: Date.now() });
        try { localStorage.setItem('arSurveyor', data.user.name); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:adoptLogin'); }
        try { localStorage.setItem(LS_LAST, data.user.id); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:adoptLogin'); }
        rememberDevUser(data.user.id);
        rememberCurrentFirm();
        var g = document.getElementById('ag-gate'); if (g) g.remove();
    }

    // ⚠⚠ PROČ SE PAMATUJE, JAK OBNOVA DOPADLA (31. 8. 2026 — „ve firmě nevidím lidi").
    //   refreshConfig() vracel holé `false` pro čtyři úplně různé situace: firma není
    //   cloudová, v telefonu není token, server je nedosažitelný, odpověď patří jiné
    //   firmě. Sekce Uživatelé si o obnovu říká a při `false` prostě NEUDĚLÁ NIC —
    //   vykreslí seznam z paměti telefonu a MLČÍ. Kdo si tedy někoho přidal na jiném
    //   mobilu (nebo komu vypršel token), koukal na starý seznam bez jediného slova
    //   o tom, že se se serverem nemluvilo. Vypadalo to, že se lidi „ztratili".
    //   Důvod se proto ukládá a UI ho umí říct nahlas (AGUcty.lastSync()).
    //   Hodnoty `duvod`: 'lokalni' | 'bez-tokenu' | 'offline' | 'jina-firma' |
    //                    'odmitnuto' | 'server' | null (v pořádku)
    var _sync = { ts: 0, ok: false, duvod: null };
    function lastSync() { return { ts: _sync.ts, ok: _sync.ok, duvod: _sync.duvod }; }
    function syncStav(ok, duvod) {
        _sync = { ts: Date.now(), ok: !!ok, duvod: ok ? null : duvod };
        return !!ok;
    }

    // obnova konfigurace (perms/uživatelé se mohli změnit na jiném zařízení)
    //
    // ⚠⚠ `tichy` = VOLÁ TO PERIODICKÝ TIK NA POZADÍ, NE ČLOVĚK.
    //   Takové volání NESMÍ nikoho odhlásit kvůli 401/403. Server vrací 401 i za
    //   situací, které s platností účtu nesouvisejí (výpadek workeru, token po
    //   starším nasazení, hodiny mimo), a na pozadí to tikne každou minutu —
    //   geodet uprostřed měření by tak dostával přihlašovací obrazovku pořád
    //   dokola. Hlášeno z terénu 3. 9. 2026 („i po přihlášení mi appka píše,
    //   ať se přihlásím") hned po zavedení periodické obnovy.
    //   Na pozadí se proto jen zapíše stav 'odmitnuto' — panel firmy z něj sám
    //   napíše „přístup vypršel / účet zablokován" a nabídne tlačítko Přihlásit
    //   se. Odhlašuje jen volání OD ČLOVĚKA (start appky, návrat online, panel
    //   firmy), kde je přihlašovací obrazovka očekávaná reakce.
    //   Zablokovaný účet tím o nic nepřijde: server mu odmítá zápisy okamžitě
    //   a při dalším přihlášení ho nepustí.
    function refreshConfig(tichy) {
        if (!isCloud()) return Promise.resolve(syncStav(false, 'lokalni'));
        if (!getTok()) return Promise.resolve(syncStav(false, 'bez-tokenu'));
        return cloudFetch('/config').then(function (r) {
            if (r.ok) {
                // Odpověď patří jiné firmě než té právě aktivní → v telefonu visí
                // token po předchozí firmě. Zahodit ho (a nechat přihlásit znovu),
                // ne podle něj přepsat aktivní firmu — viz komentář u adoptConfig().
                var f0 = getFirm();
                if (f0 && f0.cloud && f0.code && r.data && r.data.firm && r.data.firm.code
                    && r.data.firm.code !== f0.code) {
                    setTok(null);
                    return syncStav(false, 'jina-firma');
                }
                adoptConfig(r.data);
                // ⚠ TARIF SE OBNOVUJE PŘI KAŽDÉM /config, ne jen při přihlášení.
                //   Token platí 60 dní — kdyby se tarif četl jen z přihlášení,
                //   zaplacené Pro by se rozsvítilo až za dva měsíce a skončené
                //   předplatné by dva měsíce svítilo dál. Tenhle GET appka dělá
                //   tak jako tak (jednou za minutu), takže to nestojí nic navíc.
                if (r.data.me) setUcet({
                    id: r.data.me.ucet, code: (getUcet() || {}).code, name: r.data.me.name,
                    tarif: r.data.me.tarif || 'zaklad', tarifDo: (getUcet() || {}).tarifDo || 0
                });
                if (r.data.prostory) setProstory(r.data.prostory);
                // účet mohl být mezitím zablokován jinde → zamknout appku
                if (getSess() && !currentUser()) { setSess(null); showLogin(false); }
                return syncStav(true, null);
            }
            if (r.status === 401 || r.status === 403) {
                // token prošel nebo účet zablokován → vynutit nové přihlášení.
                // NA POZADÍ SE NEODHLAŠUJE (viz hlavička funkce) — jen se zapíše stav.
                if (tichy) return syncStav(false, 'odmitnuto');
                setTok(null); setSess(null);
                if (getFirm()) showLogin(false);
                return syncStav(false, 'odmitnuto');
            }
            // status 0 (offline) → cache platí dál, nic se neděje
            return syncStav(false, r.status === 0 ? 'offline' : 'server');
        });
    }

    // přihlášení v cloud režimu: nejdřív server, bez signálu lokální ověřovadlo
    function cloudLogin(name, pass, done) {
        var f = getFirm(); if (!f) return done('Firemní režim není nastaven.');
        cloudFetch('/login', { method: 'POST', body: { code: f.code, name: name, password: pass } }).then(function (r) {
            if (r.ok && r.data && r.data.token) { adoptLogin(r.data, f.api, pass); return done(null, r.data.user); }
            if (r.status !== 0) {
                // třetí parametr = soft: takový pokus se do brzdy v telefonu NEpočítá.
                // 429 („moc pokusů") zvlášť — počítat ho jako uhádnutí hesla znamenalo,
                // že se serverová a telefonní brzda navzájem krmily až do zaseknutí.
                return done((r.data && r.data.error) || ('Přihlášení selhalo (' + r.status + ').'),
                    null, !spatneHeslo(r.status));
            }
            // offline: ověř proti lokálnímu ověřovadlu
            var u = null, i;
            for (i = 0; i < (f.users || []).length; i++) {
                if (String(f.users[i].name).toLowerCase() === String(name).toLowerCase()) { u = f.users[i]; break; }
            }
            if (u && u.disabled) return done('Účet je zablokovaný. Obrať se na admina.', null, true);
            if (!u) return done('Bez signálu nelze ověřit nové jméno — poprvé se přihlas s internetem.', null, true);
            var ver = getOff()[u.id];
            if (!ver) return done('Tento uživatel se na tomto zařízení ještě nepřihlásil online. Připoj se k internetu.', null, true);
            pbkdf2Hex(pass, ver.salt, ver.iters).then(function (h) {
                if (h && h === ver.hash) {
                    setSess({ userId: u.id, ts: Date.now() });
                    try { localStorage.setItem('arSurveyor', u.name); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:cloudLogin'); }
                    done(null, u);
                } else if (h) done('Nesprávné heslo.');
                else done('Toto zařízení neumí offline ověření (chybí WebCrypto).', null, true);
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
        try { ptr = (JSON.parse(localStorage.getItem(LS_SYNC) || '{}') || {}).lastSeq || 0; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:syncUsage'); }
        _syncBusy = true;
        return usageAfter(ptr, 200).then(function (evs) {
            if (!evs.length) { _syncBusy = false; return; }
            return cloudFetch('/usage', {
                method: 'POST',
                body: { events: evs.map(function (ev) { return { ts: ev.ts, t: ev.t, k: ev.k, proj: ev.proj, dev: ev.dev, u: ev.u, uid: ev.uid }; }) }
            }).then(function (r) {
                _syncBusy = false;
                if (r.ok) {
                    try { localStorage.setItem(LS_SYNC, JSON.stringify({ lastSeq: evs[evs.length - 1].seq })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:syncUsage'); }
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

    // ---- stejný účet napříč firmami (SSO na zařízení) -----------------------------
    // Kdo se jednou přihlásí v každé firmě stejným jménem a PINem, přepíná pak mezi
    // firmami BEZ dalšího zadávání PINu. Identita = SHA-256(jméno|PIN) se solí
    // zařízení — samotný PIN se nikam neukládá; mapa říká jen „tahle identita je
    // ve firmě X uživatel Y". Auto-přihlášení se použije JEN když je uživatel v
    // okamžiku přepnutí přihlášený (po zámku/odhlášení se PIN chce znovu).
    var LS_IDSALT = 'agIdentSalt_v1', LS_IDMAP = 'agIdentMap_v1', LS_IDCUR = 'agIdentCur_v1';
    function identSalt() {
        var s = null; try { s = localStorage.getItem(LS_IDSALT); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:identSalt'); }
        if (!s) { s = makeSalt(); try { localStorage.setItem(LS_IDSALT, s); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:identSalt'); } }
        return s;
    }
    function identOf(name, pin) {
        return hashPin(String(name || '').trim().toLowerCase() + '|' + String(pin || ''), 'ident|' + identSalt());
    }
    function identMap() { try { var m = JSON.parse(localStorage.getItem(LS_IDMAP) || '{}'); return (m && typeof m === 'object') ? m : {}; } catch (e) { return {}; } }
    function identRemember(u, pin) {
        var f = getFirm(); if (!f || !u) return;
        identOf(u.name, pin).then(function (h) {
            var m = identMap();
            m[h] = m[h] || {};
            m[h][profileKeyOf(f)] = u.id;
            try { localStorage.setItem(LS_IDMAP, JSON.stringify(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:identRemember'); }
            try { localStorage.setItem(LS_IDCUR, h); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:identRemember'); }
        }).catch(function () {});
    }
    function profileKeyOf(f) { return f.cloud ? ('c:' + (f.code || '?')) : ('l:' + (f.firmName || 'Moje firma')); }
    // KOLIK FIREM SMÍ BÝT V JEDNOM TELEFONU. Každý firemní profil si své
    // /config obnovuje sám a má vlastní synchronizaci bodů — pět je stop,
    // kde ještě dává smysl, že člověk dělá pro víc firem naráz. Kontroluje
    // se při ZAKLÁDÁNÍ a PŘIPOJOVÁNÍ (js/ucty-admin.js), ne při přepínání:
    // už uložený profil se nesmí stát nedostupným kvůli změně limitu.
    var PROFILE_MAX = 5;
    function profileLimit() {
        var n = listProfiles().length;
        return { max: PROFILE_MAX, n: n, full: n >= PROFILE_MAX };
    }
    function listProfiles() {
        try { var a = JSON.parse(localStorage.getItem(LS_PROF) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    function saveProfiles(a) { try { localStorage.setItem(LS_PROF, JSON.stringify(a)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:saveProfiles'); } }
    // ulož/obnov AKTUÁLNÍ firmu v seznamu profilů (volá se při každém uložení firmy)
    function rememberCurrentFirm() {
        var f = null;
        try { f = JSON.parse(localStorage.getItem(LS_FIRM) || 'null'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:rememberCurrentFirm'); }
        if (!f || !f.enabled) return;
        var snap = {};
        PROF_KEYS.forEach(function (k) {
            try { var v = localStorage.getItem(k); if (v != null) snap[k] = v; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:rememberCurrentFirm'); }
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
        var wasLogged = !!currentUser();             // SSO jen z přihlášeného stavu
        rememberCurrentFirm();                       // ať se dá vrátit zpět
        PROF_KEYS.forEach(function (k) {
            try { if (p.snap[k] != null) localStorage.setItem(k, p.snap[k]); else localStorage.removeItem(k); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:switchProfile'); }
        });
        // ZÁSADNÍ: konfiguraci jsme přepsali PŘÍMO v localStorage, mimo saveFirm().
        // Bez zneplatnění cache vracel getFirm() ještě až 500 ms PŮVODNÍ firmu (FIRM_TTL),
        // takže se pod hlavičkou nové firmy hledal SSO účet ve staré, applyPerms() počítalo
        // stará oprávnění a showLogin() postavil přihlášení se jménem, kódem a dlaždicemi
        // uživatelů PŘEDCHOZÍ firmy. Přesně proto „přepnu firmu a nedostanu se zpátky".
        bustFirm();
        // stejný účet v cílové firmě? (jméno+PIN už tu jednou prošly) -> bez PINu
        var auto = null;
        if (wasLogged) {
            try {
                var cur = localStorage.getItem(LS_IDCUR);
                var uid = cur && identMap()[cur] && identMap()[cur][key];
                var f2 = getFirm();
                if (uid && f2 && f2.users) {
                    for (var j = 0; j < f2.users.length; j++) {
                        if (f2.users[j].id === uid && !f2.users[j].disabled) { auto = f2.users[j]; break; }
                    }
                }
            } catch (e) { auto = null; }
        }
        clearGuest();
        var g = document.getElementById('ag-gate'); if (g) g.remove();
        if (auto) {
            setSess({ userId: auto.id, ts: Date.now() });
            try { localStorage.setItem('arSurveyor', auto.name); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:switchProfile'); }
            try { localStorage.setItem(LS_LAST, auto.id); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:switchProfile'); }
            rememberDevUser(auto.id);
            _touchActivity();
            applyPerms();
            usageLog('login', 'sso-switch');
            try { if (typeof quickToast === 'function') quickToast('Přihlášen jako ' + auto.name + ' (stejný účet).'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:switchProfile'); }
        } else {
            setSess(null);                           // nové přihlášení (PIN)
            applyPerms();
            if (getFirm()) showLogin(false);
        }
        try { window.dispatchEvent(new CustomEvent('agucty:firmswitch')); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:switchProfile'); }
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
            try { db.transaction(STORE, 'readwrite').objectStore(STORE).add(rec); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:usageLog'); }
        });
    }
    // zápis události s VLASTNÍMI poli (čas/uživatel) — např. zpětně doplněný
    // odchod docházky. Jde stejnou frontou (IndexedDB -> server) jako usageLog.
    function usageLogRaw(rec) {
        var f = getFirm(); if (!f || !rec || !rec.t) return;
        var u = currentUser();
        var full = {
            ts: rec.ts || Date.now(),
            u: rec.u != null ? rec.u : (u ? u.name : '?'),
            uid: rec.uid != null ? rec.uid : (u ? u.id : null),
            t: rec.t,
            k: rec.k || null,
            proj: rec.proj != null ? rec.proj : pid(),
            dev: rec.dev || devId()
        };
        openDb().then(function (db) {
            if (!db) return;
            try { db.transaction(STORE, 'readwrite').objectStore(STORE).add(full); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:usageLogRaw'); }
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
        } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'ucty:onerror'); }
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
        } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'ucty:onerror'); }
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
        'dock.vice':      'toggleMapControls',   // slot v liště drží od 8. 8. 2026 „Vrstvy"
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
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyPerms'); }

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
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyPerms'); }

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
                // 3. průchod: DLAŽDICE MIMO KATEGORIE I MIMO OBLÍBENÉ.
                // ⚠⚠ Naměřeno 5. 9. 2026: v mřížce jsou i zóny bez nadpisu .tool-cat —
                // „⚡ Teď se hodí" (js/tools-plus.js) a rozcestníky. Průchod podle
                // kategorií je tedy minul a hostovi, který nemá povolenou ANI JEDNU
                // kategorii, zůstala viditelná dlaždice „Firma a účty". Tenhle průchod
                // dojede zbytek podle SKUTEČNÉ kategorie nástroje (_toolCat), takže
                // nová zóna v mřížce už díru neudělá.
                if (restrict) {
                    var vse = grid.querySelectorAll('.tool-tile[data-tool]');
                    for (var vi = 0; vi < vse.length; vi++) {
                        var t3 = vse[vi];
                        var c3 = _toolCat[t3.getAttribute('data-tool')] || 'Terénní nástroje';
                        if (!can('tools.' + c3)) setHide(t3, true);
                    }
                }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:setHide'); }

        // 4) PRÁZDNÁ MŘÍŽKA NESMÍ BÝT NĚMÁ (naměřeno 5. 9. 2026).
        // Host má zakázané všechny kategorie nástrojů, takže v okně Nástroje uviděl
        // profilový přepínač „Co dnes děláš", „Poradit, co použít" — a pod tím
        // ze sta dlaždic PRÁZDNO, bez jediné věty vysvětlení. Appka, kterou člověk
        // právě dostal odkazem, se tím tváří prázdně přesně na toho, koho má získat.
        // Karta se staví jen tehdy, když opravdu není vidět ANI JEDNA dlaždice —
        // zaměstnanec s jednou zakázanou kategorií ji nedostane.
        try {
            var grid2 = document.querySelector('#tools-modal .tool-grid');
            var karta = document.getElementById('ag-tools-empty');
            var videt = 0;
            if (grid2) {
                var tiles = grid2.querySelectorAll('.tool-tile');
                for (var ti = 0; ti < tiles.length; ti++) {
                    if (getComputedStyle(tiles[ti]).display !== 'none') { videt++; break; }
                }
            }
            if (grid2 && restrict && !videt) {
                if (!karta) {
                    // zaměstnanec bez jediné povolené kategorie by jinak dostal
                    // neupravenou kartu — styly se sem musí vložit ručně
                    injectStyles();
                    karta = document.createElement('div');
                    karta.id = 'ag-tools-empty';
                    karta.className = 'ag-tools-empty';
                    karta.innerHTML = '<b>Tvoje role nemá povolený žádný nástroj.</b>'
                        + '<p>Kategorie nástrojů přiděluje správce firmy v Účtech a rolích.</p>';
                    // PŘED mřížku, ne za ni: za ní by karta ležela až pod profilovým
                    // přepínačem a „Upravit oblíbené", tedy o obrazovku níž — a to je
                    // přesně to prázdno, které má vysvětlit.
                    grid2.parentNode.insertBefore(karta, grid2);
                }
                karta.style.display = '';
            } else if (karta) {
                karta.style.display = 'none';
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:prazdneNastroje'); }

        try { document.body.classList.toggle('ag-firm-restricted', restrict); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:setHide'); }
        // ⚠ `ag-guest` se odstraňuje, ne jen nenastavuje: komu třída zůstala
        //   v DOM z předchozí verze appky (a v CSS jiných modulů něco schovávala),
        //   by jinak koukal na díry, které už nic nevysvětluje.
        try { document.body.classList.remove('ag-guest'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:setHide'); }
        syncGuestPill(false);
        try { window.dispatchEvent(new CustomEvent('agucty:perms')); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:setHide'); }
    }

    // Zbyl z toho jen ÚKLID. Oba štítky patřily hostovskému režimu, který byl
    // 6. 9. 2026 zrušen — appka je od té chvíle vždycky přihlášená, takže není
    // o čem informovat. Volá se dál, protože prvky mohly zůstat v DOM po
    // předchozí verzi appky (service worker drží starý shell až do bumpu).
    function syncGuestPill() {
        var pill = document.getElementById('ag-guest-pill');
        var exit = document.getElementById('ag-guest-exit');
        if (pill) pill.remove();
        if (exit) exit.remove();
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
            try { if (item && item.id) _toolCat[item.id] = item.cat || 'Terénní nástroje'; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:agRegisterFieldTool'); }
            return orig.apply(this, arguments);
        };
    }
    wrapRegister();

    // mřížku Nástrojů překreslují field-tools/tools-plus → periodicky srovnat
    function tick() { wrapRegister(); if (getFirm() || isOwner()) { applyPerms(); applyProjPerms(); prostoryMenu(); } gateCheck(); }

    // ------------------------------------------------------------------
    // Přihlašovací / zamykací obrazovka
    // ------------------------------------------------------------------
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    // deterministická barva avataru ze jména — lidé se na obrazovce rychle najdou
    function hueOf(name) {
        var h = 0, s = String(name || '');
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
        return h;
    }
    // ---- vzhled avataru: volitelná barva + symbol misto pismen -------------------
    // Ulozeno per zarizeni pod klicem "<firma>|<jmeno>" — prezije i refreshConfig
    // u cloudove firmy (ta o vzhledu avataru nic nevi, je to ciste vizualni vec).
    var LS_AVA = 'agAvatar_v1';
    function avaMap() { try { var m = JSON.parse(localStorage.getItem(LS_AVA) || '{}'); return (m && typeof m === 'object') ? m : {}; } catch (e) { return {}; } }
    function avaKey(name) {
        var f = getFirm();
        return (f ? profileKeyOf(f) : 'nofirm') + '|' + String(name || '').trim().toLowerCase();
    }
    function avaGet(name) { return avaMap()[avaKey(name)] || null; }
    function avaSet(name, cfg) {
        var m = avaMap();
        if (cfg && (cfg.h != null || cfg.e)) m[avaKey(name)] = { h: (cfg.h != null ? (+cfg.h % 360 + 360) % 360 : null), e: cfg.e || '' };
        else delete m[avaKey(name)];
        try { localStorage.setItem(LS_AVA, JSON.stringify(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:avaSet'); }
        try { window.dispatchEvent(new CustomEvent('agucty:avatar')); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:avaSet'); }
    }
    function avStyle(name) {
        var c = avaGet(name);
        var h = (c && c.h != null) ? c.h : hueOf(name);
        return 'background:linear-gradient(150deg,hsl(' + h + ',44%,48%),hsl(' + h + ',48%,33%));';
    }
    function avInitials(name) {
        return String(name || '?').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase();
    }
    // hotový avatar (span) — jedno místo pro přihlášení, administraci i chat
    function avHtml(name, cls) {
        var c = avaGet(name);
        var inner = (c && c.e) ? c.e : esc(avInitials(name));
        var extra = (c && c.e) ? 'font-size:1.15em;' : '';
        return '<span class="' + (cls || 'agl-av') + '" style="' + avStyle(name) + extra + '">' + inner + '</span>';
    }
    var FIRM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-4h6v4"/><path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/></svg>';
    // obličej v rámečku — Face ID / Touch ID / kód zámku obrazovky
    var BIO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 10v1M15 10v1M9.5 15c.8.7 1.6 1 2.5 1s1.7-.3 2.5-1"/></svg>';
    function brandHtml() {
        return '<div class="agl-brand"><span class="agl-mark"></span>' +
            '<span class="agl-logo">AR <b>Geodet</b></span></div>';
    }
    // Pozadí „Terén" (vybraný návrh 1): vrstevnice + živé hodnoty (návrh ② ze
    // zpětné vazby 27.7. — navrhy-uvod-pozadi.html). Dřív tu byla měřická čárka
    // se štítkem „142.7 m": čárka končila v 80 % šířky (vypadala useknutě) a
    // číslo bylo natvrdo → nahrazeno hodnotami, které něco znamenají.
    // Čistá dekorace pod kartou (z-index 0, pointer-events none), do krajů ji
    // rozpouští vinětace #ag-login::after do barvy pozadí.
    function terrainHtml() {
        return '<svg class="agl-topo" viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
            '<path class="major" d="M-20,120 C60,80 140,150 220,110 S380,60 420,100"/>' +
            '<path d="M-20,150 C60,110 150,180 230,140 S380,95 420,135"/>' +
            '<path d="M-20,180 C70,145 160,210 240,170 S385,130 420,170"/>' +
            '<path class="major" d="M-20,300 C40,340 120,260 210,310 S350,380 420,330"/>' +
            '<path d="M-20,330 C40,370 125,295 215,340 S350,410 420,360"/>' +
            '<path d="M-20,360 C45,400 130,330 220,370 S355,440 420,395"/>' +
            '<path d="M-20,390 C50,428 138,365 228,400 S360,468 420,428"/>' +
            '<path class="major" d="M-20,540 C80,500 170,580 260,540 S390,490 420,530"/>' +
            '<path d="M-20,575 C80,538 175,615 265,575 S390,528 420,568"/>' +
            '<path d="M-20,610 C85,575 180,648 270,610 S395,565 420,605"/>' +
            '</svg>' +
            '<div class="agl-live" aria-hidden="true"></div>';
    }

    // ------------------------------------------------------------------
    // ŽIVÉ HODNOTY V POZADÍ (návrh ②)
    // Čísla plují přes pozadí ve třech hloubkách (menší/bledší = dál).
    // ŽÁDNÉ nové stahování ani zapínání GPS: bere se výhradně to, co appka
    // už má v localStorage — poloha 'arLastPos' (píše logika.js) a počasí
    // 'agWeatherCache_v1' (píše pocasi.js). Hodiny, Y/X a Slunce se dopočítají
    // v telefonu. Když nic z toho není (čerstvá instalace), zůstane jen čas
    // a datum — proto se seznam staví z toho, co je opravdu k dispozici.
    // ------------------------------------------------------------------
    var LV_WX = 'agWeatherCache_v1';        // cache počasí (js/pocasi.js)
    var LV_WX_MAX = 3 * 3600 * 1000;        // starší než 3 h už neukazuj (bylo by to lživé)
    var LV_DNY = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
    var LV_TICK = 20000;                    // obnova textů (animace chipů běží dál v CSS)
    function lvP2(n) { return (n < 10 ? '0' : '') + n; }
    function lvNum(n, d) { return n.toFixed(d == null ? 1 : d).replace('.', ','); }
    function lvMez(n) {                      // 598214.3 → „598 214,3" (pevné mezery)
        var s = lvNum(n, 1).split(',');
        return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + s[1];
    }
    function lvPos() {
        try { if (typeof userLat === 'number' && userLat && typeof userLng === 'number' && userLng) return { lat: userLat, lng: userLng }; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:lvPos'); }
        try {
            var p = JSON.parse(localStorage.getItem('arLastPos'));
            if (p && p.lat != null) return { lat: +p.lat, lng: +(p.lng != null ? p.lng : p.lon) };
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:lvPos'); }
        return null;
    }
    function lvWx() {
        try {
            var o = JSON.parse(localStorage.getItem(LV_WX));
            if (o && o.data && o.t && (Date.now() - o.t) < LV_WX_MAX) return o;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:lvWx'); }
        return null;
    }
    // seznam dvojic [popisek, hodnota]; pořadí je stabilní, ať se chipy nepřehazují
    function lvVals() {
        var out = [], d = new Date();
        out.push(['Čas', lvP2(d.getHours()) + ':' + lvP2(d.getMinutes())]);
        out.push(['Datum', LV_DNY[d.getDay()] + ' ' + d.getDate() + '. ' + (d.getMonth() + 1) + '.']);
        var w = lvWx(), c = w && w.data ? w.data.current : null;
        if (c) {
            if (c.temp != null) out.push(['Teplota', lvNum(c.temp) + ' °C']);
            if (c.feels != null) out.push(['Pocitově', lvNum(c.feels) + ' °C']);
            if (c.wind != null) out.push(['Vítr', lvNum(c.wind) + ' m/s']);
            if (c.pmsl != null) out.push(['Tlak', Math.round(c.pmsl) + ' hPa']);
            if (c.hum != null) out.push(['Vlhkost', Math.round(c.hum) + ' %']);
        }
        if (w && w.data && w.data.elev != null) out.push(['Výška', lvNum(w.data.elev, 0) + ' m n. m.']);
        if (w && w.placeName) out.push(['Místo', w.placeName]);
        var p = lvPos();
        if (p) {
            try {
                var s = proj4('EPSG:4326', 'EPSG:5514', [p.lng, p.lat]);   // Křovák definuje logika.js
                out.push(['Y', lvMez(Math.abs(s[0]))]);
                out.push(['X', lvMez(Math.abs(s[1]))]);
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:lvVals'); }
            // desetinna CARKA jako u ostatnich hodnot (drive tu byla tecka z toFixed)
            out.push(['Šířka', Math.abs(p.lat).toFixed(5).replace('.', ',') + '° ' + (p.lat < 0 ? 'S' : 'N')]);
            out.push(['Délka', Math.abs(p.lng).toFixed(5).replace('.', ',') + '° ' + (p.lng < 0 ? 'W' : 'E')]);
            try {
                var t = window.AGSun ? window.AGSun.times(d, p.lat, p.lng, 90.833) : null;   // js/slunce.js
                if (t && t.rise) out.push(['Východ', lvP2(t.rise.getHours()) + ':' + lvP2(t.rise.getMinutes())]);
                if (t && t.set) out.push(['Západ', lvP2(t.set.getHours()) + ':' + lvP2(t.set.getMinutes())]);
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:lvVals'); }
        }
        try {
            if (typeof persistentCustomPoints !== 'undefined' && persistentCustomPoints && persistentCustomPoints.length) {
                out.push(['Body', String(persistentCustomPoints.length)]);
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:lvVals'); }
        return out;
    }
    // tři hloubky: vzdálené jsou menší, bledší a pomalejší (parallax)
    var LV_DEPTH = [
        { cls: 'far', op: 0.26, d0: 46, d1: 62 },
        { cls: 'mid', op: 0.5, d0: 32, d1: 44 },
        { cls: 'near', op: 0.8, d0: 24, d1: 32 }
    ];
    function startLive(root) {
        var host = root.querySelector('.agl-live');
        if (!host) return;
        var vals = lvVals();
        if (!vals.length) return;
        var html = [], kf = [];
        for (var i = 0; i < vals.length; i++) {
            var dp = LV_DEPTH[i % 3];
            var dur = dp.d0 + ((i * 7) % (dp.d1 - dp.d0));
            var lane = Math.round(i * 100 / vals.length);       // startovní výška (vh)
            var dy = ((i % 5) - 2) * 6;                          // mírné stoupání/klesání
            var rl = (i % 2 === 0);                              // střídavě zleva a zprava
            var delay = -Math.round(dur * ((i * 13) % 100) / 100);   // rozjeté hned, ne po řadě
            var xs = 8 + (i % 3) * 26;                           // klidová poloha (bez animací)
            // ⚠ KEYFRAMES S DOSAZENÝMI ČÍSLY, NIKDY `var()`.
            // Dřív tu byla JEDNA animace `aglfly`, která brala polohu z custom
            // properties (`translate(var(--x0),var(--y0))`). Staré WebKity (iOS
            // Safari) `var()` UVNITŘ @keyframes neumí — celou deklaraci zahodí,
            // takže chipy zůstaly bez transformu i bez opacity: nahromadily se
            // vlevo nahoře a nedělaly nic (nahlášeno 8.8.2026 z telefonu, na
            // Chromiu se to NEPROJEVÍ). Proto se pro každý chip vygeneruje
            // vlastní @keyframes s čísly.
            kf.push('@keyframes aglfly' + i + '{'
                + '0%{transform:translate(' + (rl ? -35 : 135) + 'vw,' + lane + 'vh);opacity:0}'
                + '14%{opacity:' + dp.op + '}82%{opacity:' + dp.op + '}'
                + '100%{transform:translate(' + (rl ? 135 : -35) + 'vw,' + (lane + dy) + 'vh);opacity:0}}');
            // STATICKÁ ZÁLOHA v inline stylu: když animace nepoběží (vypnuté
            // animace v systému, spořicí režim, starý prohlížeč), hodnoty aspoň
            // KLIDNĚ STOJÍ rozmístěné po obrazovce — nikdy ne v hromadě v koutě.
            // Běžící animace tenhle transform přebije, takže si nepřekáží.
            html.push('<div class="agl-fl ' + dp.cls + '" style="transform:translate(' + xs + 'vw,' + lane + 'vh);'
                + 'opacity:' + dp.op + ';animation-name:aglfly' + i + ';'
                + 'animation-duration:' + dur + 's;animation-delay:' + delay + 's;">'
                + '<span class="k">' + esc(vals[i][0]) + '</span>'
                + '<span class="v" data-k="' + esc(vals[i][0]) + '">' + esc(vals[i][1]) + '</span></div>');
        }
        // keyframes se generují dohromady do jednoho <style>, přepisuje se celý
        // (obrazovka se staví znovu → počet chipů se může změnit)
        var kfEl = document.getElementById('agl-live-kf');
        if (!kfEl) {
            kfEl = document.createElement('style');
            kfEl.id = 'agl-live-kf';
            (document.head || document.documentElement).appendChild(kfEl);
        }
        kfEl.textContent = kf.join('\n');
        host.innerHTML = html.join('');
        // Obnova: mění se JEN text, chipy se nepřekreslují (jinak by animace skočila).
        // Párování podle popisku, ne podle pořadí — seznam se může za běhu rozšířit
        // (např. když mezitím doběhne počasí). Časovač umře s obrazovkou.
        // BATERIE: časovač umře nejen s odstraněnou obrazovkou, ale i s tou jen
        // SCHOVANOU. Úvodní karta (#welcome-screen) se po startu appky nemaže, jen
        // dostane display:none — bez téhle podmínky by chipy přepočítávala každých
        // 20 s po celý den v terénu.
        var iv = setInterval(function () {
            if (!document.body.contains(host) || !host.getClientRects().length) { clearInterval(iv); return; }
            var now = lvVals(), map = {}, j;
            for (j = 0; j < now.length; j++) map[now[j][0]] = now[j][1];
            var els = host.querySelectorAll('.v');
            for (j = 0; j < els.length; j++) {
                var v = map[els[j].getAttribute('data-k')];
                if (v != null && els[j].textContent !== v) els[j].textContent = v;
            }
        }, LV_TICK);
    }
    // Logo: použij SKUTEČNÉ logo appky z úvodní obrazovky (klon uzlu, ať se
    // nemusí duplikovat kresba a vždy odpovídá tomu, co uživatel zná).
    // Záloha: icon.svg (stejná grafika jako ikona na ploše).
    function fillMark(root) {
        try {
            var slot = root.querySelector('.agl-mark');
            if (!slot) return;
            var src = document.querySelector('#welcome-screen .welcome-logo');
            if (src) {
                var clone = src.cloneNode(true);
                clone.removeAttribute('class');
                clone.removeAttribute('style');
                // gradienty mají id — v klonu je přejmenuj, ať nekolidují s originálem
                clone.innerHTML = clone.innerHTML.replace(/wl-vf/g, 'agl-vf');
                // první <g> = rohové závorky → pomalu rotují kolem záměrného kříže
                var spin = clone.querySelector('g');
                if (spin) spin.classList.add('agl-spin');
                slot.appendChild(clone);
                return;
            }
            var img = document.createElement('img');
            img.src = 'icon.svg';
            img.alt = 'AR Geodet';
            slot.appendChild(img);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:fillMark'); }
    }
    // aktivní zakázka + počet bodů (přihlašovací obrazovka je JEDINÝ úvod,
    // tak nese i kontext, který dřív ukazovala úvodní karta)
    function projInfoHtml() {
        var name = null, n = null;
        try {
            var id = localStorage.getItem('arActiveProjectId');
            if (typeof projects !== 'undefined' && Array.isArray(projects) && id) {
                for (var i = 0; i < projects.length; i++) if (projects[i] && projects[i].id === id) name = projects[i].name;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:projInfoHtml'); }
        try { if (typeof persistentCustomPoints !== 'undefined' && persistentCustomPoints) n = persistentCustomPoints.length; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:projInfoHtml'); }
        if (!name && n == null) return '';
        return '<div class="agl-proj">' + (name ? 'Zakázka <b>' + esc(name) + '</b>' : 'Bez zakázky') +
            (n != null ? ' · ' + n + ' ' + (n === 1 ? 'bod' : (n >= 2 && n <= 4 ? 'body' : 'bodů')) : '') + '</div>';
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // ---- společná kostra brány a přihlášení (jemný nástup + zář nahoře) ----
            // overflow-x:hidden je POVINNY: .agl-topo je siroka 140 % (inset:-20%), takze
            // v kontejneru s overflow-y:auto delala 82 px vodorovneho rolovani — uvodni
            // obrazovka se dala odsunout do strany (nalezeno 8.8. v prohlizeci).
            '#ag-login,#ag-gate{position:fixed;inset:0;z-index:999999;background:var(--bg,#0d1117);display:flex;flex-direction:column;',
            '  align-items:center;justify-content:center;gap:13px;overflow-y:auto;overflow-x:hidden;animation:aglin .28s ease-out;',
            '  padding:calc(24px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));}',
            '#ag-login::before,#ag-gate::before{content:"";position:absolute;top:-160px;left:50%;transform:translateX(-50%);width:460px;height:420px;',
            '  border-radius:50%;background:radial-gradient(closest-side,var(--accent-soft,rgba(47,158,116,0.16)),transparent 72%);pointer-events:none;}',
            '@keyframes aglin{from{opacity:0}to{opacity:1}}',
            '#ag-login>*,#ag-gate>*{position:relative;z-index:1;}',   // obsah nad září i terénem
            // ---- pozadí „Terén": pomalu plující vrstevnice + měřická linie (dekorace) ----
            // #ag-login/#ag-gate v selektoru: musí přebít '#ag-login>*' (position/z-index) výš
            // ⚠⚠ `fixed`, NE `absolute`. Vrstva je 140 % vysoká s inset:-20%, takže
            //   jako `absolute` přečnívala 169 px pod spodní hranu a dělala z brány
            //   ROLOVATELNOU plochu — a to je čistě dekorace, kterou nikdo rolovat
            //   nechce. Projevilo se to tím, že prohlížeč před klepnutím na spodní
            //   tlačítko plochu odroloval a klepnutí spadlo na jiné tlačítko
            //   (naměřeno: „Založit účet" trefilo „Přihlásit se"). Je to TÁŽ vada
            //   jako `overflow-x:hidden` o pár řádků výš, jen na druhé ose — tam se
            //   řešila následkem, tady příčinou. `#ag-gate` je sám `position:fixed;
            //   inset:0`, takže se obraz nikam neposune.
            '#ag-login .agl-topo,#ag-gate .agl-topo{position:fixed;inset:-20%;width:140%;height:140%;z-index:0;pointer-events:none;',
            '  animation:agldrift 40s ease-in-out infinite alternate;}',
            // vrstevnice jsou ztlumené — hlavní dění v pozadí jsou teď létající hodnoty
            '.agl-topo path{fill:none;stroke:rgba(47,158,116,0.08);stroke-width:1.2;}',
            '.agl-topo path.major{stroke:rgba(47,158,116,0.16);stroke-width:1.6;}',
            '@keyframes agldrift{from{transform:translate(0,0) scale(1)}to{transform:translate(-3%,-2%) scale(1.06)}}',
            // ---- létající hodnoty (návrh ②) ----
            // overflow:hidden je POVINNÝ: chipy startují na -35vw / 135vw, jinak by
            // #ag-login (overflow-y:auto) dostal vodorovné rolování.
            // maska: u kraju hodnoty VYBLEDNOU misto ostreho odriznuti v pulce slova
            // („Pr" misto „Praha" na levem okraji vypadalo jako chyba vykresleni)
            // #welcome-screen je tu ZÁMĚRNĚ: úvodní karta se zakázkou letící hodnoty
            // taky chce (nahlášeno 8. 8. 2026 — „na úvodní straně mělo na pozadí
            // poletovat čas/poloha/teplota a není to tam"). Byly naprogramované jen pro
            // přihlašovací obrazovku, takže je uživatel, který se přihlašuje trvale
            // (nebo jede jako host), nikdy neviděl. Mountuje je js/welcome-card.js
            // přes AGUcty.mountLive().
            '#ag-login .agl-live,#ag-gate .agl-live,#welcome-screen .agl-live{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;',
            '  -webkit-mask-image:linear-gradient(90deg,transparent,#000 14%,#000 86%,transparent);',
            '  mask-image:linear-gradient(90deg,transparent,#000 14%,#000 86%,transparent);}',
            // ⚠ Pravidlo výš je rozsekané do TŘÍ položek pole — nové pravidlo se musí
            // vkládat AŽ ZA jeho uzavírací `}`, jinak spadne doprostřed bloku a rozbije ho.
            // Na ÚVODNÍ KARTĚ chipy ztlumit: přihlašovací obrazovka má uprostřed jeden
            // neprůhledný panel a chipy jsou vidět jen kolem něj, kdežto úvodní karta má
            // obsah přes celou šířku a průsvitné panely (rgba 0,05) — v plné síle se
            // propíjejí do textu. Průhlednost patří na CELOU vrstvu, ne na chipy: ty si
            // opacitu animují v @keyframes a `!important` by animaci rozbil.
            '#welcome-screen .agl-live{opacity:0.45;}',
            // animation-name se dává INLINE (aglfly<i>) — každý chip má vlastní
            // keyframes s dosazenými čísly, viz startLive()
            '.agl-fl{position:absolute;top:0;left:0;white-space:nowrap;display:inline-flex;align-items:baseline;gap:6px;',
            '  font-family:var(--font-mono,ui-monospace,monospace);will-change:transform;',
            '  animation-timing-function:linear;animation-iteration-count:infinite;}',
            '.agl-fl .k{font-weight:500;font-size:.74em;letter-spacing:.08em;text-transform:uppercase;color:rgba(230,189,118,0.55);}',
            '.agl-fl .v{font-weight:600;color:var(--data,#e6bd76);}',
            '.agl-fl.far{font-size:calc(11px * var(--ag-font-scale, 1));}',
            '.agl-fl.mid{font-size:calc(13px * var(--ag-font-scale, 1));}',
            '.agl-fl.near{font-size:calc(16px * var(--ag-font-scale, 1));}',
            '.agl-fl.near .v{color:#f0cd90;}',
            // bez animací (systémové nastavení): animaci vypnout stačí — klidovou
            // polohu i průhlednost drží inline styl chipu (statická záloha)
            '@media (prefers-reduced-motion:reduce){.agl-fl{animation:none;}}',
            // vinětace: vrstevnice se do krajů ztrácí do barvy pozadí (funguje i ve světlém motivu)
            '#ag-login::after,#ag-gate::after{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;',
            '  background:radial-gradient(90% 70% at 50% 42%,transparent 25%,var(--bg,#0d1117) 100%);}',
            // karta úvodu: obsah na jednom panelu se smaragdovým nádechem (návrh „Terén")
            '#ag-login .agl-card,#ag-gate .agl-card{display:flex;flex-direction:column;align-items:center;gap:13px;width:min(390px,92vw);',
            '  box-sizing:border-box;padding:26px 20px 20px;border-radius:22px;',
            // KARTA MUSI BYT NEPRUHLEDNA. Driv byl podklad jen smaragdovy zavoj
            // (alfa ~0,04), takze letici hodnoty z pozadi PROSVITALY skrz kartu a
            // krizily se s jejim vlastnim textem („VITR 3,2 m/s" pres logo, „X 1 043
            // 009,5" pres tlacitko) — vypadalo to jako rozbita animace. Zavoj proto
            // lezi na plne barve pozadi; hodnoty dal plují v pozadi OKOLO karty.
            '  background:linear-gradient(175deg,var(--accent-soft,rgba(47,158,116,0.10)),rgba(255,255,255,0.035) 40%),var(--bg,#0d1117);',
            '  border:1px solid rgba(76,205,153,0.28);',
            '  box-shadow:0 24px 60px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.08);}',
            // značka: SKUTEČNÉ logo appky (klon z úvodní obrazovky) + název; jemně se vznáší
            '.agl-brand{display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:2px;}',
            '.agl-mark{width:76px;height:76px;display:flex;align-items:center;justify-content:center;',
            '  filter:drop-shadow(0 8px 22px var(--accent-soft,rgba(47,158,116,0.4)));animation:aglfloat 5s ease-in-out infinite;}',
            '@keyframes aglfloat{50%{transform:translateY(-6px)}}',
            '.agl-mark svg,.agl-mark img{width:100%;height:100%;display:block;}',
            // rohové závorky loga se pomalu otáčí kolem záměrného kříže (viewBox 96×96 → střed 48,48)
            '.agl-mark svg .agl-spin{transform-origin:48px 48px;animation:aglspin 14s linear infinite;}',
            '@keyframes aglspin{to{transform:rotate(360deg)}}',
            '#ag-login .agl-hint,#ag-gate .agl-hint{font:500 12.5px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);text-align:center;max-width:300px;}',
            '#ag-login .agl-logo,#ag-gate .agl-logo{font:800 21px/1.2 var(--font-display,system-ui);color:var(--text-color,#e6e8eb);letter-spacing:.02em;}',
            '#ag-login .agl-logo b,#ag-gate .agl-logo b{color:var(--accent,#2f9e74);}',
            '#ag-login .agl-firm,#ag-gate .agl-firm{font:600 13.5px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);max-width:340px;text-align:center;}',
            '#ag-login .agl-firmchip{display:inline-flex;align-items:center;gap:7px;background:var(--glass-bg,rgba(255,255,255,0.06));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));border-radius:999px;padding:7px 14px;',
            '  font:600 12.5px/1 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '#ag-login .agl-firmchip .dot{width:7px;height:7px;border-radius:50%;background:var(--accent,#2f9e74);',
            '  box-shadow:0 0 9px var(--accent,#2f9e74);animation:aglpulse 2s infinite;}',
            '@keyframes aglpulse{50%{opacity:.35}}',
            '#ag-login .agl-firmchip .lock{color:var(--warn,#d4a02c);}',
            '#ag-login .agl-proj{font:500 12px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);text-align:center;}',
            '#ag-login .agl-proj b{color:var(--text-color,#e6e8eb);font-weight:700;}',
            // dlaždice uživatelů
            '#ag-login .agl-users{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;max-width:440px;max-height:38vh;overflow-y:auto;padding:4px;}',
            '#ag-login .agl-user{display:flex;flex-direction:column;align-items:center;gap:7px;background:var(--glass-bg,rgba(255,255,255,0.05));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));border-radius:16px;padding:13px 15px 11px;min-width:96px;cursor:pointer;',
            '  color:var(--text-color,#e6e8eb);transition:transform .15s ease,border-color .15s ease,background .15s ease,box-shadow .15s ease;}',
            '#ag-login .agl-user:active{transform:scale(.96);}',
            '#ag-login .agl-user.sel{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.13));',
            '  box-shadow:0 0 0 1px var(--accent,#2f9e74),0 8px 22px var(--accent-soft,rgba(47,158,116,0.28));transform:translateY(-2px);}',
            '#ag-login .agl-av{width:46px;height:46px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;',
            '  font:800 17px/1 var(--font-display,system-ui);box-shadow:inset 0 1px 0 rgba(255,255,255,0.28),0 3px 8px rgba(0,0,0,0.28);}',
            '#ag-login .agl-nm{font:600 12.5px/1.2 var(--font-ui,system-ui);max-width:116px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#ag-login .agl-role{font:600 10px/1 var(--font-ui,system-ui);letter-spacing:.05em;text-transform:uppercase;border-radius:999px;padding:3px 8px;',
            '  color:var(--text-muted,#9aa1ac);background:var(--glass-bg,rgba(255,255,255,0.06));}',
            '#ag-login .agl-role.r-admin{color:#d4a02c;background:rgba(212,160,44,0.12);}',
            '#ag-login .agl-role.r-vedeni{color:#4a9eda;background:rgba(74,158,218,0.12);}',
            // PIN / heslo
            '#ag-login .agl-pinbox{display:none;flex-direction:column;align-items:center;gap:10px;}',
            '#ag-login .agl-pinbox.on{display:flex;animation:aglin .2s ease-out;}',
            '#ag-login input.agl-pin,#ag-login input.agl-name,#ag-gate .agg-box input{box-sizing:border-box;width:230px;text-align:center;',
            '  background:var(--glass-bg,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.18));border-radius:13px;',
            '  color:var(--text-color,#e6e8eb);padding:13px 10px;outline:none;transition:border-color .15s ease,box-shadow .15s ease;}',
            '#ag-login input.agl-pin{font:700 22px/1 var(--font-display,system-ui);letter-spacing:.35em;',
            '  border-color:rgba(76,205,153,0.45);box-shadow:0 0 0 3px var(--accent-soft,rgba(47,158,116,0.14));}',
            '#ag-login input.agl-name,#ag-gate .agg-box input{font:600 15px/1.2 var(--font-ui,system-ui);}',
            '#ag-login input.agl-pin:focus,#ag-login input.agl-name:focus,#ag-gate .agg-box input:focus{border-color:var(--accent,#2f9e74);',
            '  box-shadow:0 0 0 3px var(--accent-soft,rgba(47,158,116,0.2));}',
            '#ag-login .agl-err,#ag-gate .agl-err{color:var(--danger,#e5534b);font:600 13px/1.35 var(--font-ui,system-ui);min-height:18px;max-width:300px;text-align:center;}',
            // tlačítka: smaragdový gradient s tmavým textem (návrh „Terén")
            '#ag-login .agl-btn,#ag-gate .agl-btn{border:none;color:#06130d;border-radius:13px;padding:14px 30px;min-width:230px;box-sizing:border-box;',
            '  font:800 15px/1 var(--font-ui,system-ui);cursor:pointer;background:linear-gradient(135deg,#4ccd99,#2f9e74);',
            '  box-shadow:0 10px 26px rgba(47,158,116,0.38),inset 0 1px 0 rgba(255,255,255,0.35);transition:transform .12s ease,filter .12s ease;}',
            '#ag-login .agl-btn:active,#ag-gate .agl-btn:active{transform:scale(.97);filter:brightness(1.08);}',
            // zámek po neúspěšných pokusech: tlačítko i pole zjevně nejdou použít
            '#ag-login .agl-btn:disabled,#ag-gate .agl-btn:disabled{opacity:.45;filter:grayscale(.6);cursor:default;transform:none;}',
            '#ag-login input:disabled,#ag-gate input:disabled{opacity:.5;}',
            '#ag-login .agl-ghost,#ag-gate .agl-ghost{background:transparent;color:var(--text-muted,#9aa1ac);border:none;',
            '  font:600 12.5px/1 var(--font-ui,system-ui);cursor:pointer;padding:10px;text-decoration:underline;text-decoration-color:transparent;',
            '  text-underline-offset:3px;transition:color .15s ease,text-decoration-color .15s ease;}',
            '#ag-login .agl-ghost:active,#ag-gate .agl-ghost:active{color:var(--text-color,#e6e8eb);text-decoration-color:currentColor;}',
            // ---- výběr zakázky rovnou v přihlášení (ušetří „Více → přepnout zakázku") ----
            '#ag-login .agl-projpick{display:flex;flex-direction:column;gap:5px;width:min(300px,86vw);}',
            '#ag-login .agl-projpick label{font:700 10.5px/1 var(--font-ui,system-ui);letter-spacing:.08em;text-transform:uppercase;',
            '  color:var(--text-muted,#9aa1ac);padding-left:2px;}',
            '#ag-login .agl-projpick select{width:100%;box-sizing:border-box;padding:12px 13px;border-radius:13px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  color:var(--text-color,#e6e8eb);font:600 14px/1 var(--font-ui,system-ui);appearance:none;}',
            // ---- Face ID / odemknutí telefonem ----
            '#ag-login .agl-bio{display:inline-flex;align-items:center;justify-content:center;gap:9px;}',
            '#ag-login .agl-bio svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.9;}',
            // ---- „zůstat přihlášený" ----
            '#ag-login .agl-keep{display:flex;align-items:flex-start;gap:9px;width:min(300px,86vw);',
            '  font:600 12.5px/1.35 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);cursor:pointer;}',
            '#ag-login .agl-keep input{flex:0 0 auto;width:18px;height:18px;margin:0;}',
            '#ag-login .agl-keep small{display:block;margin-top:3px;font-weight:500;font-size:calc(11.5px * var(--ag-font-scale, 1));color:var(--text-faint,#7b828c);}',
            '#ag-login.agl-shake .agl-pinbox{animation:aglshake .35s;}',
            '@keyframes aglshake{20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}',
            // ---- brána při startu (přihlásit / založit / omezený režim) ----
            '#ag-gate .agg-sec{font:700 10.5px/1 var(--font-ui,system-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);margin-top:6px;}',
            '#ag-gate .agg-prof{display:flex;align-items:center;gap:12px;width:min(330px,88vw);box-sizing:border-box;text-align:left;',
            '  background:var(--glass-bg,rgba(255,255,255,0.05));border:1px solid var(--glass-border,rgba(255,255,255,0.1));border-radius:15px;',
            '  padding:11px 15px;cursor:pointer;color:var(--text-color,#e6e8eb);transition:transform .15s ease,border-color .15s ease;}',
            '#ag-gate .agg-prof:active{transform:scale(.97);border-color:var(--accent,#2f9e74);}',
            '#ag-gate .agg-prof .agg-pav{width:38px;height:38px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;',
            '  color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.13));}',
            '#ag-gate .agg-prof .agg-pav svg{width:20px;height:20px;}',
            '#ag-gate .agg-prof .agg-pt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
            '#ag-gate .agg-prof b{font:700 14px/1.2 var(--font-ui,system-ui);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#ag-gate .agg-prof span{font:500 11px/1.2 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#ag-gate .agg-prof .agg-go{flex:none;color:var(--text-muted,#9aa1ac);}',
            '#ag-gate .agg-box{display:none;flex-direction:column;gap:9px;width:min(330px,88vw);align-items:center;}',
            '#ag-gate .agg-box.on{display:flex;animation:aglin .2s ease-out;}',
            '#ag-gate .agg-box input{width:100%;}',
            '#ag-gate .agg-box .agl-btn{width:100%;}',
            '#ag-gate .agg-alt{border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:var(--glass-bg,rgba(255,255,255,0.04));',
            '  color:var(--text-color,#e6e8eb);border-radius:13px;padding:13px 22px;min-width:230px;box-sizing:border-box;',
            '  font:600 13.5px/1 var(--font-ui,system-ui);cursor:pointer;transition:transform .12s ease,border-color .15s ease;}',
            '#ag-gate .agg-alt:active{transform:scale(.97);border-color:var(--accent,#2f9e74);}',
            '#ag-gate #agg-show-join{width:min(330px,88vw);}',
            '#ag-gate .agg-note{max-width:330px;text-align:center;font:500 11.5px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            // karta u prazdne mrizky Nastroju (viz applyPerms, bod 4)
            '.ag-tools-empty{margin:8px 2px 4px;padding:16px 16px 18px;border-radius:14px;text-align:center;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '.ag-tools-empty b{display:block;margin-bottom:6px;color:var(--text-color,#e6e8eb);',
            '  font:700 calc(14px * var(--ag-font-scale,1))/1.4 var(--font-ui,system-ui);}',
            '.ag-tools-empty p{margin:0 0 12px;color:var(--text-muted,#9aa1ac);',
            '  font:500 calc(12.5px * var(--ag-font-scale,1))/1.5 var(--font-ui,system-ui);}',
            '.ag-tools-empty .btn{min-height:44px;}',
            // ⚠⚠ POJISTKA K applyPerms: dlaždici, kterou role zakazuje, schovává ucty.js
            // přes inline style. Jenže zónu „⚡ Teď se hodí“ přestavuje js/tools-plus.js a při
            // té přestavbě inline style přepíše — dlaždice se vrátí a zmizí až při dalším tiku
            // (až 4 s). Naměřeno u hosta: „Firma a účty“. Značku data-agucty vlastní ucty.js,
            // takže pravidlo nemůže schovat nic, co samo neschovalo.
            '.tool-tile[data-agucty="1"]{display:none !important;}'
        ].join('\n');
        // ⚠ ZALOŽENÍ ÚČTU (#ag-reg) A KÓD ÚČTU (#ag-kod) VYPADAJÍ JAKO BRÁNA,
        //   ale mají vlastní id. Místo aby se ke každému z těch ~40 pravidel
        //   dopisovaly další dva selektory (a na jeden se pak zapomnělo), se
        //   celý blok JEDNOU zopakuje s `#ag-gate` přepsaným na `.ag-gate-like`.
        //   Nové pravidlo pro bránu tak platí pro obě obrazovky samo od sebe.
        //   Dělí se po PRAVIDLECH (na `}`), ne po řádcích: skoro každé pravidlo je
        //   tu rozepsané na dva až tři prvky pole a filtr po řádcích by ukrojil
        //   jen ten první — zbyla by neuzavřená složená závorka, která spolkne
        //   všechno za sebou. Žádné `@media` ani `@keyframes` #ag-gate neobsahuje,
        //   takže vnořené závorky tu nehrozí (kdyby přibyly, tohle přestane stačit).
        st.textContent += '\n' + st.textContent.split('}')
            .filter(function (r) { return r.indexOf('#ag-gate') !== -1; })
            .map(function (r) { return r.replace(/#ag-gate/g, '.ag-gate-like') + '}'; })
            .join('\n')
            + '\n.ag-gate-like{position:fixed;inset:0;z-index:999999;}'
            + '\n#ag-kod .agk-kod{font:800 30px/1.2 var(--font-display,system-ui);letter-spacing:.22em;'
            + '  color:var(--accent,#2f9e74);padding:12px 8px;word-break:break-all;text-align:center;}';
        (document.head || document.documentElement).appendChild(st);
    }

    // ------------------------------------------------------------------
    // JEDINÝ VCHOD DO APPKY (31. 8. 2026). Přihlašovací obrazovka #ag-gate /
    // #ag-login je jediná vstupní stránka; stará úvodní karta #welcome-screen je
    // zrušená (v index.html po ní zbyla jen skrytá kostra s poli formuláře).
    //
    // ⚠ DŘÍV TU BYLA PODMÍNKA `ws.style.display !== 'none'`, tedy „spusť appku,
    // JEN KDYŽ je úvodní karta zrovna vidět". Se zrušenou kartou by neplatila
    // nikdy a po přihlášení by uživatel koukal na nenastartovanou appku. Teď se
    // rozhoduje podle toho, co nás doopravdy zajímá: jestli appka UŽ BĚŽÍ.
    //
    // startAppFromWelcome() je globál z grafika.js (obaluje ho i tutorial-pro.js,
    // takže výuka na prvním spuštění dál funguje). Nemusí být v tuhle chvíli
    // načtený — brána umí naskočit dřív než zbytek appky — proto se na něj chvíli
    // počká místo tichého vzdání.
    // ------------------------------------------------------------------
    // sundání pojistky proti probliknutí přihlašovací obrazovky (třída z <head>)
    function unprelock() {
        try { document.documentElement.classList.remove('ag-prelock'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:unprelock'); }
    }

    function appRunning() {
        try { return !!(document.body && document.body.classList.contains('app-started')); } catch (e) { return false; }
    }

    function enterApp() {
        unprelock();
        try {
            if (appRunning()) return;
            var tries = 0;
            (function go() {
                if (appRunning()) return;
                if (typeof window.startAppFromWelcome === 'function') {
                    try { window.startAppFromWelcome(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:enterApp'); }
                    return;
                }
                if (tries++ < 40) setTimeout(go, 150);   // ~6 s, pak to vzdáme (pojistka v <head> ukáže hlášku)
            })();
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:enterApp'); }
    }

    // ------------------------------------------------------------------
    // ZAMYKÁNÍ po neúspěšných pokusech (brzda proti hádání PINu/hesla)
    // PIN bývá čtyřmístný — bez brzdy ho zvládne kdokoli s telefonem v ruce
    // vyzkoušet celý. Po 5 chybách se přihlašování na minutu zamkne a s každou
    // další chybou se čekání zdvojnásobí (max 15 min). Počítadlo je v
    // localStorage, takže restart appky ani reload stránky zámek neobejde.
    // Úspěšné přihlášení počítadlo maže.
    // ------------------------------------------------------------------
    var FAIL_FREE = 5;              // kolik pokusů projde bez čekání
    var FAIL_BASE = 60000;          // 1. zámek = 1 minuta
    var FAIL_MAX = 900000;          // strop 15 minut
    var FAIL_FORGET = 1800000;      // 30 min klidu = počitadlo se zapomene

    // ⚠ POČITADLO SE MUSÍ ZAPOMÍNAT. Dřív jen rostlo a maz(al) ho VÝHRADNĚ úspěšný
    // přihlášení. Jenže než se dostaneš k úspěchu, musíš se přihlásit — takže kdo se
    // jednou dostal přes 9 chyb, dostával od té chvíle 15minutový zámek po KAŽDÉM
    // dalším nezdaru, napořád. Ve spojení s tím, že se jako „nezdar" počítala i
    // odpověď serveru „příliš mnoho pokusů" (viz spatneHeslo níž), z toho byla past:
    // uživatel psal správné heslo a appka ho odmítla dřív, než se vůbec zeptala
    // serveru. Brzda proti hádání hesla má být OKNO, ne doživotní trest.
    function failGet() {
        try {
            var o = JSON.parse(localStorage.getItem(LS_FAIL) || 'null');
            if (o && typeof o.n === 'number') {
                // Záznam bez `ts` je z verze před touto opravou — nemáme, podle čeho
                // soudit stáří, a je to nejspíš právě ten zaseklý. Zahazuje se.
                if (!o.ts || (Date.now() - o.ts) > FAIL_FORGET) { failClear(); return { n: 0, until: 0, ts: 0 }; }
                return { n: o.n, until: o.until || 0, ts: o.ts };
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:failGet'); }
        return { n: 0, until: 0, ts: 0 };
    }
    function failSet(o) {
        o.ts = Date.now();
        try { localStorage.setItem(LS_FAIL, JSON.stringify(o)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:failSet'); }
    }

    // ⚠ Jen 401 je „nesprávné jméno nebo heslo". Server vrací i:
    //   429 = brzda na serveru (že se moc zkoušelo, ne že je heslo špatně),
    //   403 = účet zablokovaný adminem, 400 = vadný dotaz, 5xx = chyba serveru.
    // Počítat je jako uhádnutí hesla znamenalo, že serverová a telefonní brzda
    // se navzájem krmily: jeden 429 přidal chybu i v telefonu, uživatel to zkusil
    // znovu, přišel další 429… a zámky se sčítaly, dokud se nezaseklo obojí.
    function spatneHeslo(status) { return status === 401; }
    function failClear() { try { localStorage.removeItem(LS_FAIL); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:failClear'); } }
    // zbývající zámek v ms (0 = smí se zkoušet)
    function lockLeft() {
        var o = failGet();
        var left = (o.until || 0) - Date.now();
        // hodiny posunuté dozadu by zámek natáhly donekonečna — strop je FAIL_MAX
        if (left > FAIL_MAX) { failSet({ n: o.n, until: Date.now() + FAIL_MAX }); return FAIL_MAX; }
        return left > 0 ? left : 0;
    }
    // zapíše chybu a vrátí délku nově nasazeného zámku v ms (0 = ještě se smí)
    function failAdd() {
        var o = failGet();
        o.n = (o.n || 0) + 1;
        var wait = 0;
        if (o.n >= FAIL_FREE) {
            wait = Math.min(FAIL_BASE * Math.pow(2, o.n - FAIL_FREE), FAIL_MAX);
            o.until = Date.now() + wait;
        }
        failSet(o);
        return wait;
    }
    function lockTxt(ms) {
        var s2 = Math.ceil(ms / 1000);
        if (s2 >= 60) {
            var m = Math.floor(s2 / 60), r = s2 % 60;
            return m + ' min' + (r ? ' ' + r + ' s' : '');
        }
        return s2 + ' s';
    }

    // ------------------------------------------------------------------
    // PAMATOVANÉ PŘIHLÁŠENÍ („zůstat přihlášený") + FACE ID + VÝBĚR ZAKÁZKY
    // ------------------------------------------------------------------
    // Do teď se při každém spuštění psalo heslo/PIN (nebo se zámek vypnul úplně
    // přepínačem „Vyžadovat přihlášení při každém spuštění" — tedy všechno, nebo
    // nic). Tohle je střední cesta, kterou lidi znají z bankovnictví:
    //
    //   • ZŮSTAT PŘIHLÁŠENÝ na tomto zařízení. Appka pokračuje pod posledním
    //     účtem, ale KAŽDÉ TRUST_MAX-té spuštění chce heslo/PIN doopravdy
    //     („kontrolní přihlášení") — počítadlo je v LS_TRUST a resetuje ho jen
    //     skutečné zadání hesla.
    //   • FACE ID / ODEMKNUTÍ TELEFONEM (WebAuthn, platform authenticator).
    //     BUĎME POCTIVÍ, CO TO JE: ověřuje TELEFON (Face ID / Touch ID / kód
    //     zámku obrazovky) a appka se dozví jen to, že ověření prošlo. Není to
    //     kryptografické ověření proti serveru — proti někomu, kdo má root
    //     v telefonu, to nechrání. Chrání to přesně proti tomu, o co tady jde:
    //     aby se do rozdělané zakázky nedostal někdo, komu telefon půjčíš.
    //     Vyžaduje HTTPS (na GitHub Pages ano), v http/file režimu se neukáže.
    //
    // Zapamatování je vždycky PER ZAŘÍZENÍ a per účet: na cizím telefonu se nic
    // nezapíná samo a odhlášení (logout) pamatování ruší.
    function getTrust() {
        try { var t = JSON.parse(localStorage.getItem(LS_TRUST) || 'null'); return (t && t.userId) ? t : null; } catch (e) { return null; }
    }
    function setTrust(t) {
        try { if (t) localStorage.setItem(LS_TRUST, JSON.stringify(t)); else localStorage.removeItem(LS_TRUST); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:setTrust'); }
    }
    function clearTrust() { setTrust(null); }
    function trustFor(userId) {
        var t = getTrust();
        return (t && t.userId === userId && (t.mode === 'auto' || t.mode === 'bio')) ? t : null;
    }
    function trustLeft(t) { return Math.max(0, TRUST_MAX - ((t && t.n) || 0)); }
    function rememberTrust(userId, mode) { setTrust({ userId: userId, mode: mode, n: 0, ts: Date.now() }); }
    function bumpTrust(t) { t.n = (t.n || 0) + 1; t.ts = Date.now(); setTrust(t); }

    // ---- Face ID / odemknutí telefonem (WebAuthn) -----------------------------
    function bioSupported() {
        try {
            return !!(window.isSecureContext && window.PublicKeyCredential &&
                navigator.credentials && navigator.credentials.create && navigator.credentials.get);
        } catch (e) { return false; }
    }
    function bioStore() {
        try { var o = JSON.parse(localStorage.getItem(LS_BIO) || 'null'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
    }
    function bioSave(o) { try { localStorage.setItem(LS_BIO, JSON.stringify(o)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:bioSave'); } }
    function bioCred(userId) { var c = bioStore()[userId]; return (c && c.id) ? c : null; }
    function bioForget(userId) { var o = bioStore(); delete o[userId]; bioSave(o); }
    function bioAvailable(userId) { return bioSupported() && !!bioCred(userId); }
    function rndBuf(n) {
        var a = new Uint8Array(n);
        try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); }
        return a;
    }
    function b64u(buf) {
        var b = new Uint8Array(buf), s = '';
        for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function fromB64u(s) {
        s = String(s).replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        var bin = atob(s), a = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
        return a;
    }
    function strBuf(s) {
        s = String(s);
        var a = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
        return a;
    }
    // zapnutí: vyrobí klíč v Secure Enclave / TEE telefonu. MUSÍ se volat
    // z uživatelského gesta (Safari jinak vyhodí NotAllowedError).
    function bioEnroll(u) {
        if (!bioSupported() || !u) return Promise.resolve(false);
        return navigator.credentials.create({
            publicKey: {
                challenge: rndBuf(32),
                rp: { name: 'AR Geodet' },
                user: { id: strBuf('ag:' + u.id), name: u.name || u.id, displayName: u.name || u.id },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
                timeout: 60000,
                attestation: 'none'
            }
        }).then(function (cred) {
            if (!cred || !cred.rawId) return false;
            var o = bioStore();
            o[u.id] = { id: b64u(cred.rawId), ts: Date.now() };
            bioSave(o);
            return true;
        })['catch'](function () { return false; });
    }
    // ověření: vrací true jen když telefon opravdu ověřil uživatele
    function bioVerify(userId) {
        var c = bioCred(userId);
        if (!bioSupported() || !c) return Promise.resolve(false);
        return navigator.credentials.get({
            publicKey: {
                challenge: rndBuf(32),
                allowCredentials: [{ type: 'public-key', id: fromB64u(c.id), transports: ['internal'] }],
                userVerification: 'required',
                timeout: 60000
            }
        }).then(function (a) { return !!a; })['catch'](function () { return false; });
    }
    // ptát se na zapnutí Face ID nejvýš jednou za 30 dní (a ne, když už je zapnuté)
    function bioAskDue(userId) {
        if (!bioSupported() || bioCred(userId)) return false;
        try {
            var t = parseInt(localStorage.getItem(LS_BIOASK) || '0', 10);
            return !(t && Date.now() - t < 30 * 86400000);
        } catch (e) { return true; }
    }
    function bioAskDone() { try { localStorage.setItem(LS_BIOASK, String(Date.now())); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:bioAskDone'); } }

    // ---- zakázky, do kterých účet smí (per zařízení) ---------------------------
    // Zakázky žijí v tomhle telefonu (arProjectsList), ne na serveru — přidělení
    // je proto taky per zařízení. Není to bezpečnostní hranice (kdo má odemčený
    // telefon a konzoli, dostane se k datům), ale úklid: zaměstnanec vidí
    // v přihlášení i v přepínačích jen zakázky, na kterých má dělat.
    function projList() {
        try { if (typeof projects !== 'undefined' && Array.isArray(projects) && projects.length) return projects; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:projList'); }
        try { var a = JSON.parse(localStorage.getItem('arProjectsList')); if (Array.isArray(a) && a.length) return a; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:projList'); }
        return [{ id: 'default', name: 'Výchozí zakázka' }];
    }
    function projAclAll() {
        try { var o = JSON.parse(localStorage.getItem(LS_PACL) || 'null'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
    }
    function projAclFor(userId) {
        var a = projAclAll()[userId];
        return Array.isArray(a) ? a : null;      // null = nic nepřiděleno → všechno (fail-open)
    }
    function setProjAcl(userId, arr) {
        var o = projAclAll();
        if (Array.isArray(arr) && arr.length) o[userId] = arr; else delete o[userId];
        try { localStorage.setItem(LS_PACL, JSON.stringify(o)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:setProjAcl'); }
    }
    function allowedProjects(u) {
        var list = projList();
        if (!u || u.role === 'admin') return list;
        var acl = projAclFor(u.id);
        if (!acl) return list;
        var out = list.filter(function (p) { return acl.indexOf(p.id) !== -1; });
        // přidělené zakázky někdo smazal → radši pustit všechny než nechat člověka
        // stát před appkou, do které se nedostane
        return out.length ? out : list;
    }
    // přepnutí zakázky (i před startem appky — tehdy stačí přepsat klíč a natáhnout data)
    function applyProject(id) {
        if (!id) return;
        var cur = null;
        try { cur = localStorage.getItem('arActiveProjectId'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyProject'); }
        if (cur === id) return;
        try { if (typeof _persistOfficialPoints === 'function') _persistOfficialPoints(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyProject'); }
        try { localStorage.setItem('arActiveProjectId', id); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyProject'); }
        try { if (typeof activeProjectId !== 'undefined') activeProjectId = id; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyProject'); }
        var w = document.getElementById('w-project-select'); if (w) { try { w.value = id; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyProject'); } }
        var s = document.getElementById('s-project-select'); if (s) { try { s.value = id; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyProject'); } }
        try {
            if (typeof hydrateActiveProject === 'function') {
                hydrateActiveProject().then(function () {
                    try { if (typeof loadProjectSettings === 'function') loadProjectSettings(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyProject'); }
                    try { if (typeof renderProjectSelect === 'function') renderProjectSelect(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyProject'); }
                });
                return;
            }
            if (typeof loadProjectSettings === 'function') loadProjectSettings();
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyProject'); }
    }
    // vymáhání: v přepínačích zakázek nechat jen povolené (renderProjectSelect je
    // plní znovu, takže se to musí opakovat v tiku — stejně jako u dlaždic Nástrojů)
    function applyProjPerms() {
        if (!getFirm()) return;
        var u = currentUser();
        if (!u || u.role === 'admin') return;
        if (!projAclFor(u.id)) return;
        var allow = {};
        allowedProjects(u).forEach(function (p) { allow[p.id] = 1; });
        ['w-project-select', 's-project-select'].forEach(function (id) {
            var sel = document.getElementById(id);
            if (!sel || !sel.options) return;
            for (var i = sel.options.length - 1; i >= 0; i--) {
                if (!allow[sel.options[i].value]) sel.remove(i);
            }
        });
        var cur = null;
        try { cur = localStorage.getItem('arActiveProjectId'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:applyProjPerms'); }
        if (cur && !allow[cur]) {
            var first = allowedProjects(u)[0];
            if (first && first.id !== cur) applyProject(first.id);
        }
    }
    var _toastN = 0;
    function toast(msg) {
        try { if (typeof window.quickToast === 'function') { window.quickToast(msg); return; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:toast'); }
        // Náhradník: AGNotify umí jen TRVALÉ stavy (set/clear), žádné .info — proto se
        // hláška musí po chvíli uklidit sama, jinak by v kartě upozornění visela napořád.
        // Vlastní id na každou hlášku, ať si dvě rychle po sobě nesmažou odpočet.
        try {
            if (window.AGNotify && typeof AGNotify.set === 'function') {
                var id = 'ucty-toast-' + (++_toastN);
                AGNotify.set(id, { level: 'info', text: msg });
                setTimeout(function () { try { AGNotify.clear(id); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:toast'); } }, 6000);
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:toast'); }
    }

    var _selUser = null;
    function showLogin(lockMode, checkMode) {
        var f = getFirm(); if (!f) return;
        injectStyles();
        var old = document.getElementById('ag-login'); if (old) old.remove();
        setSess(null);
        applyPerms();
        // Od téhle chvíle není nikdo přihlášený. Co zůstalo otevřené POD přihlašovací
        // obrazovkou (typicky administrace firmy), patří předchozímu přihlášení —
        // moduly si to tímhle uklidí samy. Viz js/ucty-admin.js, kde se panel zavírá:
        // po přepnutí firmy v něm jinak visela celá firma předchozí.
        try { window.dispatchEvent(new CustomEvent('agucty:logout', { detail: { lockMode: !!lockMode } })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:showLogin'); }

        var ov = document.createElement('div');
        ov.id = 'ag-login';
        // dlaždice jen pro účty, které se na TOMTO zařízení už přihlásily
        var shownUsers = loginUsers(f);
        var usersHtml = shownUsers.map(function (u) {
            var roleTxt = u.role === 'admin' ? 'Admin' : (u.role === 'vedeni' ? 'Vedení' : 'Zaměstnanec');
            var roleCls = u.role === 'admin' ? ' r-admin' : (u.role === 'vedeni' ? ' r-vedeni' : '');
            return '<button type="button" class="agl-user" data-id="' + esc(u.id) + '">' +
                avHtml(u.name, 'agl-av') +
                '<span class="agl-nm">' + esc(u.name) + '</span>' +
                '<span class="agl-role' + roleCls + '">' + roleTxt + '</span></button>';
        }).join('');
        var cloud = !!f.cloud;
        ov.innerHTML =
            terrainHtml() +
            '<div class="agl-card">' +
            brandHtml() +
            '<div class="agl-firmchip"><span class="dot"></span>' + esc(f.firmName || 'Firemní režim') +
            (cloud && f.code ? ' · ' + esc(f.code) : '') + (lockMode ? ' <span class="lock">· zamčeno</span>' : '') + '</div>' +
            projInfoHtml() +
            // Duvod ANO (jinak by ťuknuti na heslo z niceho nic vypadalo jako chyba),
            // ale bez cisla „po 20 spustenich" — to uzivatel na uvodni obrazovce nechce.
            (checkMode ? '<div class="agl-hint">Kontrolní přihlášení — appka se jednou za čas pro jistotu zeptá na heslo.</div>' : '') +
            (usersHtml
                ? '<div class="agl-users">' + usersHtml + '</div>'
                : '<div class="agl-hint">Na tomhle telefonu se ještě nikdo nepřihlásil — zadej své jméno a heslo.</div>') +
            '<div class="agl-projpick" id="agl-projpick" style="display:none;">' +
            '  <label for="agl-projsel">Zakázka</label>' +
            '  <select id="agl-projsel"></select>' +
            '</div>' +
            '<button type="button" class="agl-btn agl-bio" id="agl-bio" style="display:none;">' + BIO_SVG + ' Odemknout telefonem</button>' +
            '<div class="agl-pinbox' + (usersHtml ? '' : ' on') + '">' +
            '  <input class="agl-name" type="text" autocomplete="username" maxlength="40" placeholder="Jméno"' + (usersHtml ? ' style="display:none;"' : '') + '>' +
            (cloud
                ? '  <input class="agl-pin" type="password" autocomplete="current-password" maxlength="64" placeholder="Heslo" style="letter-spacing:.12em;font-size:calc(17px * var(--ag-font-scale, 1));">'
                : '  <input class="agl-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="PIN">') +
            '  <div class="agl-err"></div>' +
            '  <button type="button" class="agl-btn">Přihlásit</button>' +
            '</div>' +
            '<label class="agl-keep" id="agl-keepwrap"><input type="checkbox" id="agl-keep" checked>' +
            '<span>Zůstat přihlášený na tomhle telefonu<small id="agl-keepnote"></small></span></label>' +
            (cloud ? '<button type="button" class="agl-ghost" id="agl-other">Přihlásit jiné jméno</button>' : '') +
            '<button type="button" class="agl-ghost" id="agl-forgot">' + (cloud ? 'Zapomenuté heslo?' : 'Zapomenutý PIN?') + '</button>' +
            '</div>';
        document.body.appendChild(ov);
        fillMark(ov);
        startLive(ov);

        var pinbox = ov.querySelector('.agl-pinbox');
        var pinInp = ov.querySelector('.agl-pin');
        var nameInp = ov.querySelector('.agl-name');
        var errEl = ov.querySelector('.agl-err');

        // ---- výběr zakázky + Face ID + „zůstat přihlášený" -------------------
        // Nabídka zakázek se řídí VYBRANÝM účtem: co má přidělené, to vidí.
        var projBox = ov.querySelector('#agl-projpick');
        var projSel = ov.querySelector('#agl-projsel');
        var bioBtn = ov.querySelector('#agl-bio');
        var keepWrap = ov.querySelector('#agl-keepwrap');
        var keepCb = ov.querySelector('#agl-keep');
        var keepNote = ov.querySelector('#agl-keepnote');

        function keepOn() { return !!(keepCb && keepCb.checked); }
        function chosenProject() { return (projSel && projSel.value) ? projSel.value : null; }
        function syncExtras() {
            var u = _selUser;
            // zakázky: vypisují se jen když je z čeho vybírat
            var list = u ? allowedProjects(u) : projList();
            if (projSel) {
                var cur = null;
                try { cur = localStorage.getItem('arActiveProjectId'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:syncExtras'); }
                projSel.innerHTML = list.map(function (p) {
                    return '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.name || p.id) + '</option>';
                }).join('');
                if (cur && list.length && !list.some(function (p) { return p.id === cur; })) projSel.value = list[0].id;
            }
            if (projBox) projBox.style.display = (list.length > 1) ? '' : 'none';
            // Face ID: jen pro účet, který si ho na tomhle telefonu zapnul
            if (bioBtn) bioBtn.style.display = (u && bioAvailable(u.id)) ? '' : 'none';
            if (keepWrap) {
                if (keepCb && !keepCb._touched) keepCb.checked = true;   // výchozí: pamatovat
                if (keepNote) {
                    // Vetu „Kazde 20. spusteni se zepta na heslo" tu uzivatel NECHCE
                    // (8.8.2026) — na prihlasovaci obrazovce jen zdrzuje a stejne se
                    // pripomene sama, az kontrolni prihlaseni doopravdy prijde.
                    // Vysvetleni zustava v Nastaveni → Firma (js/ucty-admin.js).
                    keepNote.textContent = (u && bioAvailable(u.id))
                        ? 'Příští spuštění odemkneš Face ID / kódem telefonu.'
                        : 'Příště se appka otevře přihlášená.';
                }
            }
        }
        if (keepCb) keepCb.addEventListener('change', function () { keepCb._touched = true; });

        function pick(id) {
            _selUser = null;
            for (var i = 0; i < f.users.length; i++) if (f.users[i].id === id) _selUser = f.users[i];
            var us = ov.querySelectorAll('.agl-user');
            for (var j = 0; j < us.length; j++) us[j].classList.toggle('sel', us[j].getAttribute('data-id') === id);
            syncExtras();
            if (!_selUser) return;
            nameInp.style.display = 'none';
            // běží-li zámek, nesmí ho obejít ani účet bez PINu, ani nové vybrání
            // uživatele (to by jen přepsalo hlášku odpočtu)
            if (lockLeft() > 0) { pinbox.classList.add('on'); startLockTick(); return; }
            errEl.textContent = '';
            if (!cloud && (_selUser.noPin || !_selUser.pinHash)) { finish(_selUser); return; }
            pinbox.classList.add('on');
            pinInp.value = '';
            setTimeout(function () { try { pinInp.focus(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:pick'); } }, 50);
        }
        function finish(u, pin) {
            setSess({ userId: u.id, ts: Date.now() });
            try { localStorage.setItem('arSurveyor', u.name); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:finish'); }
            identRemember(u, pin || '');   // stejný účet pak funguje i v dalších firmách
            afterLogin(u);
        }
        // odemknutí Face ID / kódem telefonu: heslo se nezadává, ověřuje telefon
        var _bioBusy = false;
        function bioUnlock(silent) {
            var u = _selUser;
            if (!u || !bioAvailable(u.id) || _bioBusy) return;
            if (lockLeft() > 0) { startLockTick(); return; }
            _bioBusy = true;
            if (bioBtn) { bioBtn.disabled = true; bioBtn.textContent = 'Ověřuji…'; }
            bioVerify(u.id).then(function (ok) {
                _bioBusy = false;
                if (bioBtn) { bioBtn.disabled = false; bioBtn.innerHTML = BIO_SVG + ' Odemknout telefonem'; }
                if (!ok) {
                    // Neúspěch NENÍ špatné heslo (uživatel mohl dialog jen zavřít nebo
                    // ho systém nepustil bez gesta) → do brzdy hádání se nepočítá.
                    if (!silent) errEl.textContent = 'Ověření telefonem neprošlo — zkus to znovu, nebo zadej ' + (cloud ? 'heslo' : 'PIN') + '.';
                    return;
                }
                // Zapamatovat přihlášení jen když si to uživatel přeje — odemčení
                // telefonem nesmí vrátit pamatování tomu, kdo si ho vypnul.
                if (keepOn()) {
                    var t = trustFor(u.id) || { userId: u.id, mode: 'bio', n: 0, ts: Date.now() };
                    t.mode = 'bio';
                    bumpTrust(t);
                } else { var t0 = getTrust(); if (t0 && t0.userId === u.id) clearTrust(); }
                setSess({ userId: u.id, ts: Date.now() });
                try { localStorage.setItem('arSurveyor', u.name); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:bioUnlock'); }
                afterLogin(u, 'bio');
            });
        }

        // společný závěr (lokální i cloud — cloud má session/token už uložené)
        // kind: undefined = heslo/PIN, 'bio' = odemčeno telefonem
        function afterLogin(u, kind) {
            if (kind !== 'bio') failClear();   // úspěch s heslem = brzda hádání se resetuje
            try { localStorage.setItem(LS_LAST, u.id); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:afterLogin'); }
            rememberDevUser(u.id);   // příště se nabídne jen na tomto zařízení
            // zapamatování přihlášení na tomhle zařízení (u 'bio' už je nastavené)
            if (kind !== 'bio') {
                if (keepOn()) rememberTrust(u.id, bioAvailable(u.id) ? 'bio' : 'auto');
                else { var t0 = getTrust(); if (t0 && t0.userId === u.id) clearTrust(); }
            }
            // zakázka vybraná rovnou v přihlášení (ušetří přepínání po startu)
            var pSel = chosenProject();
            if (pSel && (u.role === 'admin' || allowedProjects(u).some(function (p) { return p.id === pSel; }))) applyProject(pSel);
            ov.remove();
            _touchActivity();
            applyPerms();
            applyProjPerms();
            usageLog('login', kind === 'bio' ? 'bio' : (lockMode ? 'unlock' : 'login'));
            if (cloud) setTimeout(syncUsage, 2000);
            try { window.dispatchEvent(new CustomEvent('agucty:login', { detail: { user: u, kind: kind || 'pass' } })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:afterLogin'); }
            enterApp();
            // nabídka Face ID: jen když chce zůstat přihlášený, telefon to umí,
            // ještě to nemá zapnuté a neodmítl to nedávno
            if (kind !== 'bio' && keepOn() && bioAskDue(u.id)) setTimeout(function () { offerBio(u); }, 700);
        }
        // odpočet zámku: dokud běží, je pole i tlačítko vypnuté a v chybové řádce
        // tiká, za jak dlouho to půjde zkusit znovu
        var _lockTimer = null;
        // POZOR: musí to být '.agl-pinbox .agl-btn', ne holé '.agl-btn' — tlačítko Face ID
        // (#agl-bio) má stejnou class a je v DOM DŘÍV, takže by zámek mrzačil jeho ikonu
        // a popisek, zatímco skutečné „Přihlásit" by zůstalo aktivní.
        var loginBtn = ov.querySelector('.agl-pinbox .agl-btn');
        function lockTick() {
            var left = lockLeft();
            if (left <= 0) {
                if (_lockTimer) { clearInterval(_lockTimer); _lockTimer = null; }
                pinInp.disabled = false; nameInp.disabled = false;
                if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Přihlásit'; }
                errEl.textContent = 'Zkus to znovu.';
                return;
            }
            pinInp.disabled = true; nameInp.disabled = true;
            if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = 'Zamčeno'; }
            errEl.textContent = 'Příliš mnoho pokusů — zkus to za ' + lockTxt(left) + '.';
        }
        function startLockTick() {
            if (_lockTimer) clearInterval(_lockTimer);
            lockTick();
            _lockTimer = setInterval(lockTick, 1000);
        }
        function fail(msg, soft) {
            // soft = chyba, která není špatné heslo (nedostupný server, neznámé jméno
            // bez signálu) — takový pokus se do brzdy nezapočítává
            if (soft) {
                errEl.textContent = msg || 'Přihlášení selhalo.';
                pinInp.value = '';
                return;
            }
            var wait = failAdd();
            errEl.textContent = msg || 'Přihlášení selhalo.';
            pinInp.value = '';
            ov.classList.remove('agl-shake');
            void ov.offsetWidth;   // restart animace
            ov.classList.add('agl-shake');
            if (wait > 0) startLockTick();
            else {
                var zb = FAIL_FREE - failGet().n;
                // ⚠ VLASTNÍ UZEL, ne přilepení k hlášce. Překlad (js/jazyky.js) hledá
                //   podle CELÉHO textového uzlu, takže slepenec „Špatné heslo. Zbývá 2
                //   pokusy do zamčení." by musel být ve slovníku pro každou hlášku zvlášť
                //   — a cizinec ho neviděl přeložený vůbec.
                if (zb <= 2) {
                    var zbEl = document.createElement('span');
                    zbEl.textContent = ' Zbývá ' + zb + (zb === 1 ? ' pokus' : ' pokusy') + ' do zamčení.';
                    errEl.appendChild(zbEl);
                }
            }
        }
        var _busy = false;
        function submit() {
            if (_busy) return;
            if (lockLeft() > 0) { startLockTick(); return; }
            var pin = pinInp.value || '';
            if (cloud) {
                // jméno: vybraný uživatel, nebo ručně zadané („Přihlásit jiné jméno")
                var nm = _selUser ? _selUser.name : (nameInp.value || '').trim();
                if (!nm) { errEl.textContent = 'Vyber uživatele nebo zadej jméno.'; return; }
                _busy = true;
                errEl.textContent = 'Ověřuji…';
                cloudLogin(nm, pin, function (errMsg, u2, soft) {
                    _busy = false;
                    if (errMsg) return fail(errMsg, soft);
                    identRemember(u2, pin);   // stejný účet pak funguje i v dalších firmách
                    afterLogin(u2);
                });
                return;
            }
            if (!_selUser) { errEl.textContent = 'Nejdřív vyber uživatele.'; return; }
            hashPin(pin, _selUser.salt).then(function (h) {
                if (h === _selUser.pinHash) { finish(_selUser, pin); return; }
                fail('Nesprávný PIN.');
            });
        }

        ov.addEventListener('click', function (e) {
            var ub = e.target.closest ? e.target.closest('.agl-user') : null;
            if (ub) { pick(ub.getAttribute('data-id')); return; }
            // POZOR: tlačítko Face ID má taky class agl-btn (stejný vzhled), takže se
            // musí odchytit DŘÍV, jinak by místo odemčení telefonem poslalo prázdné heslo
            var bb = e.target.closest ? e.target.closest('#agl-bio') : null;
            if (bb) { bioUnlock(false); return; }
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
            setTimeout(function () { try { nameInp.focus(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:submit'); } }, 50);
        });

        // Zapomenutý PIN/heslo: admin resetuje v administraci; nouzový reset
        // vypne JEN firemní režim na TOMTO zařízení (geodetická data zůstanou;
        // v cloud režimu se firma na serveru nijak nemění).
        ov.querySelector('#agl-forgot').addEventListener('click', async function () {
            var admins = f.users.filter(function (u) { return u.role === 'admin'; }).map(function (u) { return u.name; });
            var msg = cloud
                ? ('Heslo ti změní administrátor (' + (admins.join(', ') || '—') + ') v Administraci firmy — z libovolného zařízení.\n\n' +
                    'Nouzově lze toto ZAŘÍZENÍ od firmy odpojit — appka se odemkne bez účtů. ' +
                    'BODY A ZAKÁZKY ZŮSTANOU, firma na serveru se nemění (jiná zařízení jedou dál).\n\nPro odpojení napiš RESET:')
                : ('PIN ti může změnit administrátor (' + (admins.join(', ') || '—') + ') v Administraci firmy.\n\n' +
                    'Když je nedostupný i admin, lze firemní režim NOUZOVĚ vypnout — appka se odemkne, ' +
                    'účty a oprávnění se smažou. BODY A ZAKÁZKY ZŮSTANOU.\n\nPro nouzové vypnutí napiš RESET:');
            agGet(msg, { title: 'Zapomenuté přihlášení', placeholder: 'RESET', okText: 'Potvrdit' }).then(function (v) {
            if (v === 'RESET') {
                removeProfile(profileKeyOf(f));
                try { localStorage.removeItem(LS_FIRM); localStorage.removeItem(LS_TOK); localStorage.removeItem(LS_OFF); localStorage.removeItem(LS_SYNC); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:submit'); }
                bustFirm();
                setSess(null);
                ov.remove();
                applyPerms();
                agInfo(cloud ? 'Zařízení odpojeno od firmy. Body a zakázky zůstaly beze změny.'
                    : 'Firemní režim vypnut. Body a zakázky zůstaly beze změny.');
                showGate();
            }
            });
        });

        // zámek z předchozích pokusů běží dál i po restartu appky
        if (lockLeft() > 0) startLockTick();

        // předvyber jediného / naposledy přihlášeného uživatele (rychlé odemknutí
        // jedním tapem — heslo/PIN samozřejmě zůstává)
        var lastId = getSessLastUser();
        if (!lastId) { try { lastId = localStorage.getItem(LS_LAST); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty'); } }
        if (f.users.length === 1) {
            pick(f.users[0].id);
        } else if (lastId) {
            for (var li = 0; li < f.users.length; li++) {
                if (f.users[li].id === lastId) { pick(lastId); break; }
            }
        }
        syncExtras();
        // Face ID zkusíme rovnou samo (jeden pohled = odemčeno). Safari umí systémový
        // dialog odmítnout bez uživatelského gesta — proto `silent`: chyba se nehlásí
        // a zůstane viset tlačítko, kterým to uživatel spustí ťuknutím.
        if (_selUser && bioAvailable(_selUser.id) && lockLeft() <= 0 && !checkMode) {
            setTimeout(function () { bioUnlock(true); }, 250);
        }
    }

    // ------------------------------------------------------------------
    // Nabídka „zapnout Face ID" (musí běžet z gesta → tlačítko v kartě)
    // ------------------------------------------------------------------
    function offerBio(u) {
        if (!u || !bioSupported() || bioCred(u.id)) return;
        if (document.getElementById('ag-bio-ask')) return;
        injectStyles();
        var ov = document.createElement('div');
        ov.className = 'modal-overlay';
        ov.id = 'ag-bio-ask';
        ov.style.display = 'flex';
        ov.setAttribute('data-no-swipe', '1');
        ov.innerHTML = '<div class="modal-content" style="max-width:420px;">' +
            '<h3 style="margin-top:0;color:var(--accent);">Odemykat appku telefonem?</h3>' +
            '<p style="font-size:calc(13.5px * var(--ag-font-scale, 1));line-height:1.55;color:var(--text-muted,#9aa1ac);">' +
            'Příště se přihlásíš <b>Face ID / Touch ID nebo kódem zámku obrazovky</b> místo hesla — jeden pohled a jsi v zakázce. ' +
            // Věta „Každé 20. spuštění se stejně jednou zeptá na heslo" tu BYLA a je
            // pryč (8.8.2026, přání uživatele) — stejně jako z keepNote a z hlášky
            // kontrolního přihlášení. Číslo patří do Nastavení → Firma, ne do dialogu,
            // kde jen kazí jednoduchou nabídku „zapnout / teď ne".
            'Ověřuje samotný telefon, appka se dozví jen to, že ověření prošlo; heslo si nikam neukládá.</p>' +
            '<div style="display:flex;gap:8px;margin-top:6px;">' +
            '  <button type="button" class="btn btn-secondary" id="ag-bio-no" style="flex:1;">Teď ne</button>' +
            '  <button type="button" class="btn btn-primary" id="ag-bio-yes" style="flex:1;">Zapnout</button>' +
            '</div></div>';
        document.body.appendChild(ov);
        function close() { bioAskDone(); try { ov.remove(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:close'); } }
        ov.querySelector('#ag-bio-no').onclick = close;
        ov.querySelector('#ag-bio-yes').onclick = function () {
            var btn = this;
            btn.disabled = true;
            btn.textContent = 'Ověřuji…';
            bioEnroll(u).then(function (ok) {
                close();
                if (ok) {
                    var t = trustFor(u.id) || { userId: u.id, mode: 'bio', n: 0, ts: Date.now() };
                    t.mode = 'bio';
                    setTrust(t);
                    toast('Odemykání telefonem zapnuto.');
                } else {
                    toast('Telefon odemykání nepovolil — zůstává heslo.');
                }
            });
        };
    }
    var _lastUserId = null;
    function getSessLastUser() { return _lastUserId; }

    // ------------------------------------------------------------------
    // POZVÁNKA V ODKAZU  (?firma=KOD&jmeno=Jan%20Novak)
    // ------------------------------------------------------------------
    // Odkaz vyrábí admin v sekci Uživatelé (js/ucty-admin.js, showInvite).
    // Kdo appku dostane takhle, má bránu předvyplněnou a dopisuje jen heslo —
    // bez toho stál před prázdným polem „Kód firmy" a netušil, co tam patří.
    // ⚠ HESLO V ODKAZU NIKDY NENÍ: odkaz se přeposílá dál, zůstává v historii
    //   prohlížeče i v náhledech zpráv. Kód firmy sám o sobě nikoho nepustí.
    // ⚠ Z ADRESY SE PARAMETRY HNED MAŽOU (replaceState): jinak by se pozvánka
    //   držela v záložce „na ploše" a vracela se při každém spuštění appky.
    var _invite = (function () {
        try {
            if (typeof URLSearchParams !== 'function' || !location.search) return null;
            var q = new URLSearchParams(location.search);
            var code = String(q.get('firma') || '').trim().toUpperCase().slice(0, 6);
            if (!/^[A-Z0-9]{4,6}$/.test(code)) return null;
            var inv = { code: code, name: String(q.get('jmeno') || '').trim().slice(0, 40) };
            q['delete']('firma'); q['delete']('jmeno');
            var rest = q.toString();
            try {
                history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:invite-url'); }
            return inv;
        } catch (e) { return null; }
    })();
    // Pro průvodce „Připojit toto zařízení k firmě" (js/ucty-admin.js): když
    // pozvánka dorazila do telefonu, kde UŽ nějaká firma je, brána se vůbec
    // neukáže — údaje si vyzvedne průvodce.
    function pendingInvite() { return _invite ? { code: _invite.code, name: _invite.name } : null; }

    // ------------------------------------------------------------------
    // BRÁNA při startu: bez firmy se appka neotevře — uživatel se přihlásí
    // (kód firmy), založí firmu (průvodce v ucty-admin.js), přepne na firmu,
    // kterou zařízení už zná, nebo pokračuje v omezeném režimu bez přihlášení.
    // ------------------------------------------------------------------
    function showGate() {
        if (getFirm()) { showLogin(false); return; }   // firma už nastavena → rovnou přihlášení
        injectStyles();
        // ⚠⚠ STOJÍCÍ BRÁNU NEBOURAT. Do 6. 9. 2026 se tady overlay bezpodmínečně
        //   odstranil a postavil znovu. Kdo v tu chvíli psal heslo, přišel o
        //   napsané — a hůř: prvek pod prstem se mezi dotykem a klepnutím vyměnil
        //   za jiný, takže klepnutí spadlo vedle. Chytil to test nového
        //   přihlašování (klepnutí na „Založit účet" trefilo „Přihlásit se")
        //   a nejdřív jsem to považoval za vrtkavost testu; není.
        var old = document.getElementById('ag-gate');
        if (old) { old.style.display = ''; return; }
        var ov = document.createElement('div');
        ov.id = 'ag-gate';
        var profs = listProfiles();
        var profHtml = '';
        if (profs.length) {
            profHtml = '<div class="agg-sec">Firmy na tomto zařízení</div>' +
                profs.map(function (p) {
                    return '<button type="button" class="agg-prof" data-key="' + esc(p.key) + '">' +
                        '<span class="agg-pav">' + FIRM_SVG + '</span>' +
                        '<span class="agg-pt"><b>' + esc(p.label) + '</b>' +
                        '<span>' + (p.cloud ? 'cloud · kód ' + esc(p.code || '?') : 'jen toto zařízení') + '</span></span>' +
                        '<span class="agg-go">›</span></button>';
                }).join('');
        }
        ov.innerHTML =
            terrainHtml() +
            '<div class="agl-card">' +
            brandHtml() +
            '<div class="agl-firm">Přihlas se svým kódem účtu, nebo si účet za chvilku založ.</div>' +
            profHtml +
            '<div class="agg-box" id="agg-join">' +
            '  <input type="text" id="agg-code" maxlength="8" placeholder="Kód účtu" autocapitalize="characters" autocomplete="username" style="text-transform:uppercase;letter-spacing:.15em;">' +
            // Jméno se ptá JEN u šestiznakového kódu firmy (stará cesta pro telefony
            // s neaktualizovanou appkou). U kódu účtu je zbytečné — kód je unikátní
            // sám o sobě — a pole navíc na přihlašovací obrazovce zdržuje každý den.
            '  <input type="text" id="agg-name" maxlength="40" placeholder="Jméno" autocomplete="username" hidden>' +
            '  <input type="password" id="agg-pass" maxlength="64" placeholder="Heslo" autocomplete="current-password">' +
            '  <div class="agl-err" id="agg-err"></div>' +
            '  <button type="button" class="agl-btn" id="agg-go">Přihlásit</button>' +
            '  <button type="button" class="agl-ghost" id="agg-scan">Naskenovat QR od admina</button>' +
            '</div>' +
            '<button type="button" class="agl-btn" id="agg-show-join">Přihlásit se (mám kód účtu)</button>' +
            '<button type="button" class="agl-btn" id="agg-reg">Založit účet</button>' +
            '<button type="button" class="agg-alt" id="agg-new">Další možnosti</button>' +
            // ⚠ ŽÁDNÁ OBNOVA HESLA (rozhodnutí uživatele): registrace nechce e-mail,
            //   takže není kam poslat odkaz. Musí to být napsané TADY, u hesla,
            //   ne až někde v nápovědě — jinak se to člověk dozví ve chvíli, kdy
            //   už je pozdě.
            '<div class="agg-note">Registrace je na tři pole a nechce e-mail. Heslo proto nejde obnovit — ' +
            'ulož si ho a čas od času si stáhni zálohu zakázky.</div>' +
            '</div>';
        document.body.appendChild(ov);
        fillMark(ov);
        startLive(ov);

        var errEl = ov.querySelector('#agg-err');
        var gateApi = DEFAULT_API;   // QR od admina může nést i vlastní adresu API
        ov.addEventListener('click', function (e) {
            var pb = e.target.closest ? e.target.closest('.agg-prof') : null;
            if (pb) { switchProfile(pb.getAttribute('data-key')); return; }
        });
        function showJoin() {
            var b = ov.querySelector('#agg-show-join');
            if (b) b.style.display = 'none';
            ov.querySelector('#agg-join').classList.add('on');
        }
        ov.querySelector('#agg-show-join').onclick = function () {
            showJoin();
            setTimeout(function () { try { ov.querySelector('#agg-code').focus(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:onclick'); } }, 50);
        };
        ov.querySelector('#agg-scan').onclick = function () {
            scanFirmQR(function (d) {
                showJoin();
                ov.querySelector('#agg-code').value = d.code;
                ov.querySelector('#agg-name').value = d.name;
                srovnejPole();       // QR nese kód FIRMY → jméno se musí odkrýt
                if (d.api) gateApi = d.api;
                errEl.textContent = '';
                setTimeout(function () { try { ov.querySelector('#agg-pass').focus(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:onclick'); } }, 50);
            });
        };
        var _busy = false;
        // stejná brzda proti hádání jako na přihlašovací obrazovce (viz blok ZAMYKÁNÍ)
        var _gateTimer = null;
        var goBtn = ov.querySelector('#agg-go');
        function gateLockTick() {
            var left = lockLeft();
            if (left <= 0) {
                if (_gateTimer) { clearInterval(_gateTimer); _gateTimer = null; }
                goBtn.disabled = false; goBtn.textContent = 'Přihlásit';
                errEl.textContent = '';
                return;
            }
            goBtn.disabled = true; goBtn.textContent = 'Zamčeno';
            errEl.textContent = 'Příliš mnoho pokusů — zkus to za ' + lockTxt(left) + '.';
        }
        function gateLockStart() { if (_gateTimer) clearInterval(_gateTimer); gateLockTick(); _gateTimer = setInterval(gateLockTick, 1000); }
        if (lockLeft() > 0) gateLockStart();
        goBtn.onclick = function () {
            if (_busy) return;
            if (lockLeft() > 0) { gateLockStart(); return; }
            var code = (ov.querySelector('#agg-code').value || '').trim().toUpperCase();
            var name = (ov.querySelector('#agg-name').value || '').trim();
            var pass = ov.querySelector('#agg-pass').value || '';
            // OSM ZNAKŮ = kód účtu (nová cesta, jméno se nezadává),
            // ŠEST = kód firmy (stará cesta pro telefony s neaktualizovanou appkou).
            // Rozhoduje délka, ne přepínač: uživatel má jedno pole a nemusí vědět,
            // který ze dvou světů zrovna používá.
            var jeUcet = code.length === 8;
            if (!code || !pass || (!jeUcet && !name)) {
                errEl.textContent = jeUcet ? 'Vyplň kód účtu i heslo.' : 'Vyplň kód, jméno i heslo.';
                return;
            }
            var telo = jeUcet ? { code: code, password: pass } : { code: code, name: name, password: pass };
            _busy = true;
            errEl.textContent = 'Ověřuji…';
            cloudFetch('/login', { method: 'POST', api: gateApi, body: telo }).then(function (r) {
                _busy = false;
                if (r.ok && r.data && r.data.token) {
                    failClear();
                    adoptLogin(r.data, gateApi, pass);   // odstraní i bránu
                    usageLog('login', 'join');
                    try { window.dispatchEvent(new CustomEvent('agucty:login', { detail: { user: r.data.user } })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:onclick'); }
                    return;
                }
                if (r.status === 0) {
                    // server nedosažitelný není špatné heslo — pokus se nezapočítává
                    errEl.textContent = 'Server není dosažitelný — bez internetu se lze přihlásit jen k firmě, kterou toto zařízení už zná.';
                    return;
                }
                if (!spatneHeslo(r.status)) {
                    // brzda na serveru (429), zablokovaný účet (403) nebo chyba serveru —
                    // nic z toho není uhádnuté heslo, takže se do brzdy v telefonu nepočítá
                    errEl.textContent = (r.data && r.data.error) || ('Přihlášení selhalo (' + r.status + ').');
                    return;
                }
                var wait = failAdd();
                errEl.textContent = (r.data && r.data.error) || ('Přihlášení selhalo (' + r.status + ').');
                if (wait > 0) gateLockStart();
            });
        };
        var passInp = ov.querySelector('#agg-pass');
        passInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ov.querySelector('#agg-go').click(); });
        // Pole „Jméno" se ukáže, teprve když je v kódu vidět, že jde o starou
        // cestu (kód firmy má šest znaků). Osmiznakový kód účtu si vystačí sám.
        var codeInp = ov.querySelector('#agg-code'), nameInp = ov.querySelector('#agg-name');
        function srovnejPole() {
            var d = (codeInp.value || '').trim().length;
            nameInp.hidden = !(d > 0 && d <= 6);
        }
        codeInp.addEventListener('input', srovnejPole);
        srovnejPole();
        ov.querySelector('#agg-new').onclick = function () {
            // ucty-admin.js (nejtěžší modul appky) se načítá až po startu — viz
            // js/lazy-load.js. Brána je ale vidět HNED, takže když sem někdo ťukne
            // dřív, než se modul dotáhne, počká se na něj místo hlášky o nenačtení.
            var run = function () {
                if (window.AGUctyAdmin && typeof AGUctyAdmin.wizard === 'function') {
                    ov.remove();
                    AGUctyAdmin.wizard();   // zavření průvodce bez dokončení vrátí bránu (gateCheck)
                } else {
                    errEl.textContent = 'Modul administrace (ucty-admin.js) není načtený.';
                }
            };
            if (!window.AGUctyAdmin && window.AGLazy && typeof AGLazy.need === 'function') {
                errEl.textContent = 'Načítám…';
                AGLazy.need('js/ucty-admin.js', function () { errEl.textContent = ''; run(); });
            } else run();
        };
        ov.querySelector('#agg-reg').onclick = function () { showRegister(gateApi); };

        // Pozvánka z odkazu: otevřít přihlašovací pole, vyplnit, co víme, a
        // postavit kurzor na heslo. Vyplňuje se AŽ TADY, na konci — showJoin()
        // i pole existují teprve po navěšení obsluh výše.
        if (_invite && _invite.code) {
            showJoin();
            ov.querySelector('#agg-code').value = _invite.code;
            if (_invite.name) ov.querySelector('#agg-name').value = _invite.name;
            srovnejPole();
            var fi = ov.querySelector('.agl-firm');
            if (fi) fi.textContent = 'Pozvánka do firmy ' + _invite.code + (_invite.name ? ' pro ' + _invite.name : '')
                + ' — dopiš heslo, které ti poslal admin.';
            setTimeout(function () {
                try { ov.querySelector(_invite.name ? '#agg-pass' : '#agg-name').focus(); }
                catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:invite-focus'); }
            }, 60);
        }
    }

    // ---- založení účtu -------------------------------------------------------
    // TŘI POLE A ŽÁDNÝ E-MAIL. Registrace je pro obě verze STEJNÁ: člověk si
    // vymyslí jméno, název místa, kde má data, a heslo. Sólo uživatel se o žádné
    // „firmě" nedozví — jen si pojmenoval svůj prostor; teprve s Pro se z něj
    // stane firma, do které jde někoho pozvat.
    //
    // ⚠ HESLO NEJDE OBNOVIT a musí to být napsané TADY, u toho pole, ne v nápovědě.
    //   Bez e-mailu není kam poslat odkaz — a člověk, který si to přečte až ve
    //   chvíli, kdy heslo zapomněl, přijde o data.
    function showRegister(api) {
        injectStyles();
        var g = document.getElementById('ag-gate'); if (g) g.remove();
        var old = document.getElementById('ag-reg'); if (old) old.remove();
        var ov = document.createElement('div');
        ov.id = 'ag-reg';
        ov.className = 'ag-gate-like';
        ov.innerHTML =
            terrainHtml() +
            '<div class="agl-card">' +
            brandHtml() +
            '<div class="agl-firm">Založení účtu — bez e-mailu, za dvě minuty.</div>' +
            '<div class="agg-box on">' +
            '  <input type="text" id="agr-name" maxlength="40" placeholder="Tvoje jméno" autocomplete="name">' +
            '  <input type="text" id="agr-space" maxlength="60" placeholder="Název místa, kde budeš mít data" autocomplete="off">' +
            '  <input type="password" id="agr-pass" maxlength="64" placeholder="Heslo (aspoň 8 znaků)" autocomplete="new-password">' +
            '  <input type="password" id="agr-pass2" maxlength="64" placeholder="Heslo ještě jednou" autocomplete="new-password">' +
            '  <div class="agl-err" id="agr-err"></div>' +
            '  <button type="button" class="agl-btn" id="agr-go">Založit účet</button>' +
            '  <button type="button" class="agl-ghost" id="agr-back">Zpět na přihlášení</button>' +
            '</div>' +
            '<div class="agg-note">Heslo nejde obnovit — nikam se neposílá e-mail. Zapiš si ho. ' +
            'Zakázky si čas od času stáhni jako zálohu, je to jediná pojistka.</div>' +
            '</div>';
        document.body.appendChild(ov);
        fillMark(ov);
        startLive(ov);

        var err = ov.querySelector('#agr-err');
        ov.querySelector('#agr-back').onclick = function () { ov.remove(); showGate(); };
        var busy = false;
        ov.querySelector('#agr-go').onclick = function () {
            if (busy) return;
            var jm = (ov.querySelector('#agr-name').value || '').trim();
            var pr = (ov.querySelector('#agr-space').value || '').trim();
            var h1 = ov.querySelector('#agr-pass').value || '';
            var h2 = ov.querySelector('#agr-pass2').value || '';
            if (!jm) { err.textContent = 'Napiš, jak ti máme říkat.'; return; }
            if (!pr) { err.textContent = 'Pojmenuj místo, kde budeš mít data — třeba svým jménem nebo názvem firmy.'; return; }
            if (h1.length < 8) { err.textContent = 'Heslo musí mít aspoň 8 znaků.'; return; }
            // Heslo dvakrát je tu SCHVÁLNĚ, i když to jinde v appce není zvykem:
            // překlep v hesle bez možnosti obnovy znamená ztrátu dat.
            if (h1 !== h2) { err.textContent = 'Hesla se neshodují.'; return; }
            busy = true;
            err.textContent = 'Zakládám…';
            cloudFetch('/register', {
                method: 'POST', api: api || DEFAULT_API,
                body: { name: jm, spaceName: pr, password: h1 }
            }).then(function (r) {
                busy = false;
                if (r.ok && r.data && r.data.token) {
                    failClear();
                    adoptLogin(r.data, api || DEFAULT_API, h1);
                    ov.remove();
                    usageLog('login', 'register');
                    // Kód účtu je JEDINÁ cesta zpátky, když si člověk appku smaže
                    // nebo vymění telefon — ukázat ho jednou v hlášce nestačí.
                    ukazKodUctu(r.data.ucet);
                    try { window.dispatchEvent(new CustomEvent('agucty:login', { detail: { user: r.data.user } })); }
                    catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:register'); }
                    return;
                }
                if (r.status === 0) { err.textContent = 'Server není dosažitelný — účet se zakládá přes internet.'; return; }
                err.textContent = (r.data && r.data.error) || ('Registrace selhala (' + r.status + ').');
            });
        };
        setTimeout(function () { try { ov.querySelector('#agr-name').focus(); } catch (e) { } }, 60);
    }

    // ---- prostory účtu: přepínač, vstup do firmy, odchod ---------------------
    // ⚠ V ZÁKLADU SE TENHLE VCHOD NEUKAZUJE VŮBEC. Sólo uživatel má jediný
    //   prostor a slovo „firma" se mu podle rozhodnutí uživatele nikde ukázat
    //   nesmí — pro něj je to prostě appka. Vchod se objeví, teprve když má
    //   Pro (může zvát) nebo když ho někdo pozval (má víc prostorů).
    function maProstory() {
        return tarif() === 'pro' || getProstory().length > 1;
    }

    function prostoryMenu() {
        var menu = document.getElementById('side-menu');
        if (!menu) return;
        var btn = document.getElementById('ag-prostory-btn');
        if (!maProstory()) { if (btn) btn.remove(); return; }
        if (btn) return;
        btn = document.createElement('button');
        btn.id = 'ag-prostory-btn'; btn.className = 'menu-btn'; btn.type = 'button';
        btn.textContent = 'Kde pracuju (prostory)';
        btn.addEventListener('click', function () {
            try { if (typeof toggleMenu === 'function' && menu.classList.contains('open')) toggleMenu(); }
            catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:prostoryMenu'); }
            showProstory();
        });
        var host = menu.querySelector('.menu-scroll') || menu;
        var after = document.getElementById('ag-pro-menu-btn');
        if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
        else host.appendChild(btn);
    }

    function showProstory() {
        injectStyles();
        var old = document.getElementById('ag-prostory'); if (old) old.remove();
        var ov = document.createElement('div');
        ov.id = 'ag-prostory';
        ov.className = 'ag-gate-like';
        var ted = aktualniProstor();
        var seznam = getProstory().map(function (p) {
            var kde = p.vlastni ? 'Moje vlastní místo' : (p.nazev || 'Firma');
            var pod = p.vlastni
                ? 'Zůstává ti navždy — sem se nikdo jiný nedostane.'
                : (p.archiv ? 'Archiv — jen ke čtení, do dne odchodu.' : ('Role: ' + p.role));
            var tady = ted && ted.firmId === p.firmId;
            return '<button type="button" class="agg-prof" data-firm="' + esc(p.firmId) + '"' +
                (tady ? ' disabled' : '') + '>' +
                '<span class="agg-pt"><b>' + esc(kde) + (tady ? ' · tady jsi' : '') + '</b>' +
                '<span>' + esc(pod) + '</span></span><span class="agg-go">›</span></button>';
        }).join('');
        ov.innerHTML =
            '<div class="agl-card">' +
            '<div class="agl-firm">Kde právě pracuješ</div>' +
            (seznam || '<div class="agg-note">Zatím máš jen svoje místo.</div>') +
            '<div class="agg-box on">' +
            '  <input type="text" id="agp-kod" maxlength="6" placeholder="Pozvací kód firmy" ' +
            '         autocapitalize="characters" autocomplete="off" style="text-transform:uppercase;letter-spacing:.15em;">' +
            '  <div class="agl-err" id="agp-err"></div>' +
            '  <button type="button" class="agl-btn" id="agp-join">Připojit se k firmě</button>' +
            '</div>' +
            '<button type="button" class="agl-ghost" id="agp-zpet">Zpět</button>' +
            // Odchod je popsaný přesně tak, jak se chová — člověk se musí předem
            // dozvědět, že mu prostor zůstane, ale zamrzlý.
            '<div class="agg-note">Když z firmy odejdeš, prostor ti tu zůstane jako archiv jen ke čtení ' +
            '(do dne odchodu). Správce firmy ti ho ale může odebrat.</div>' +
            '</div>';
        document.body.appendChild(ov);
        var err = ov.querySelector('#agp-err');
        ov.querySelector('#agp-zpet').onclick = function () { ov.remove(); };
        ov.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.agg-prof') : null;
            if (!b || b.disabled) return;
            prepniProstor(b.getAttribute('data-firm'), function (chyba) {
                if (chyba) { err.textContent = chyba; return; }
                ov.remove();
            });
        });
        ov.querySelector('#agp-join').onclick = function () {
            var kod = (ov.querySelector('#agp-kod').value || '').trim().toUpperCase();
            if (kod.length !== 6) { err.textContent = 'Pozvací kód má šest znaků.'; return; }
            err.textContent = 'Připojuji…';
            cloudFetch('/spaces/join', { method: 'POST', body: { code: kod } }).then(function (r) {
                if (r.ok && r.data && r.data.prostory) {
                    setProstory(r.data.prostory);
                    err.textContent = '';
                    ov.remove();
                    showProstory();
                    return;
                }
                err.textContent = (r.data && r.data.error) || ('Připojení selhalo (' + r.status + ').');
            });
        };
    }

    // Přepnutí do jiného prostoru = NOVÝ TOKEN, ne jen jiný pohled. Server
    // vydává token na konkrétní členství; bez výměny by appka dál sahala na
    // data té předchozí firmy.
    function prepniProstor(firmId, done) {
        done = done || function () { };
        cloudFetch('/spaces/switch', { method: 'POST', body: { firmId: firmId } }).then(function (r) {
            if (!(r.ok && r.data && r.data.token)) {
                return done((r.data && r.data.error) || ('Přepnutí selhalo (' + r.status + ').'));
            }
            // Heslo se sem nepředává (nezadávalo se) — ověřovadlo pro offline
            // přihlášení zůstává to, které si telefon udělal při přihlášení.
            adoptLogin(r.data, apiUrl(), null);
            applyPerms();
            try { window.dispatchEvent(new CustomEvent('agucty:prostor', { detail: r.data.prostor || null })); }
            catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:prepniProstor'); }
            done(null);
        });
    }

    // Kód účtu po registraci. Zůstává na obrazovce, dokud ho člověk neodklikne —
    // je to jediné, čím se příště přihlásí, a heslo mu nikdo neobnoví.
    function ukazKodUctu(ucet) {
        if (!ucet || !ucet.code) return;
        injectStyles();
        var ov = document.createElement('div');
        ov.id = 'ag-kod';
        ov.className = 'ag-gate-like';
        ov.innerHTML =
            '<div class="agl-card">' +
            '<div class="agl-firm">Hotovo. Tímhle kódem se budeš přihlašovat:</div>' +
            '<div class="agk-kod">' + esc(ucet.code) + '</div>' +
            '<div class="agg-note">Opiš si ho někam mimo telefon. Spolu s heslem je to všechno, ' +
            'co potřebuješ, aby ses dostal ke svým datům na jiném zařízení.</div>' +
            '<button type="button" class="agl-btn" id="agk-ok">Zapsáno, jdeme měřit</button>' +
            '</div>';
        document.body.appendChild(ov);
        ov.querySelector('#agk-ok').onclick = function () { ov.remove(); enterApp(); };
    }

    // ---- sken přihlašovacího QR od admina (payload 'AGF1\ncode\tname\tapi?';
    // heslo se NIKDY nepřenáší — to zadá zaměstnanec sám) ----------------------
    function scanFirmQR(done) {
        ensureLib('js/lib/jsqr.min.js').then(function () {
            var ov = document.createElement('div');
            ov.id = 'agg-scan-ov';
            ov.style.cssText = 'position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,0.93);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;';
            ov.innerHTML =
                '<video id="agg-scan-video" playsinline muted style="width:min(420px,92vw);border-radius:14px;background:#000;"></video>' +
                '<div id="agg-scan-st" style="color:#9aa1ac;font:600 13px/1.4 system-ui;text-align:center;">Spouštím kameru…</div>' +
                '<button type="button" id="agg-scan-x" style="background:transparent;border:1px solid rgba(255,255,255,0.3);color:#e6e8eb;border-radius:12px;padding:11px 26px;font:600 14px/1 system-ui;cursor:pointer;">Zrušit</button>';
            document.body.appendChild(ov);
            var video = ov.querySelector('#agg-scan-video');
            var st = ov.querySelector('#agg-scan-st');
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            var stream = null, raf = null;
            function stop() {
                if (raf) cancelAnimationFrame(raf);
                if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
                stream = null;
                ov.remove();
            }
            ov.querySelector('#agg-scan-x').onclick = stop;
            navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (s) {
                stream = s; video.srcObject = s;
                try { video.play(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:stop'); }
                st.textContent = 'Namiř na QR kód od admina…';
                var _lastScanT = 0;
                function tick() {
                    if (!stream) return;
                    // BATERIE: ~10 snímků/s a zmenšený obraz stačí (QR je v záběru déle než
                    // 100 ms); plné rozlišení každý snímek je nejteplejší smyčka v appce.
                    var _now = performance.now();
                    if (_now - _lastScanT < 100) { raf = requestAnimationFrame(tick); return; }
                    _lastScanT = _now;
                    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
                        var _s = Math.min(1, 640 / video.videoWidth);
                        canvas.width = Math.round(video.videoWidth * _s); canvas.height = Math.round(video.videoHeight * _s);
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        var code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                        if (code && code.data) {
                            if (code.data.indexOf('AGF1\n') === 0) {
                                var c = code.data.split('\n')[1].split('\t');
                                stop();
                                done({ code: (c[0] || '').toUpperCase(), name: c[1] || '', api: c[2] || '' });
                                return;
                            }
                            st.textContent = 'Tohle není přihlašovací QR AR Geodet.';
                        }
                    }
                    raf = requestAnimationFrame(tick);
                }
                raf = requestAnimationFrame(tick);
            }).catch(function (err) {
                st.textContent = 'Kameru nelze spustit: ' + (err && err.message ? err.message : err);
            });
        }).catch(function () { agInfo('Knihovnu pro čtení QR se nepodařilo načíst.'); });
    }

    // pojistka: bez účtu a bez otevřené brány/průvodce → ukázat bránu
    function gateCheck() {
        if (isOwner()) return;                // rezim vlastnika branu nepotrebuje
        if (getFirm()) return;
        // ⚠⚠ SEZNAM MUSÍ OBSAHOVAT VŠECHNY OBRAZOVKY, KTERÉ BRÁNU ZASTUPUJÍ.
        //   Pojistka běží v tiku po 2 s, takže cokoli, co tu chybí, se po dvou
        //   sekundách překryje bránou — a člověk uprostřed zakládání účtu přijde
        //   o všechno napsané. Přesně to udělalo zapomenuté `ag-reg`: registrace
        //   se otevřela a za dvě vteřiny přes ni naskočilo přihlášení.
        if (document.getElementById('ag-gate') || document.getElementById('ag-login')
            || document.getElementById('ag-reg') || document.getElementById('ag-kod')) return;
        var m = document.getElementById('agfa-modal');
        if (m && m.style.display === 'flex') return;   // běží průvodce založením firmy
        showGate();
    }

    function lock() {
        var u = currentUser();
        _lastUserId = u ? u.id : null;
        if (getFirm()) showLogin(true);
    }
    // start s pamatovaným přihlášením: buď se odemkne telefonem (Face ID), nebo
    // appka prostě pokračuje pod posledním účtem (jako když je zámek vypnutý —
    // úvodní obrazovka se ukáže normálně, žádný tap navíc).
    function autoLogin(u, t) {
        if (t.mode === 'bio') {
            // Face ID zmizelo (uživatel ho vypnul v systému, jiný telefon) — zapamatování
            // se opíralo o ověření telefonem, takže bez něj se musí zadat heslo
            if (!bioAvailable(u.id)) { clearTrust(); lock(); return; }
            _lastUserId = u.id;
            showLogin(true);
            return;
        }
        setSess({ userId: u.id, ts: Date.now() });
        bumpTrust(t);
        _touchActivity();
        applyPerms();
        applyProjPerms();
        usageLog('login', 'auto');
        try { window.dispatchEvent(new CustomEvent('agucty:login', { detail: { user: u, kind: 'auto' } })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:autoLogin'); }
        enterApp();          // pamatovane prihlaseni branu preskoci -> appka musi nastartovat sama
        var left = trustLeft(t);
        if (left <= 3) setTimeout(function () { toast('Přihlášen jako ' + u.name + ' · za ' + left + ' spuštění bude potřeba heslo'); }, 1200);
    }
    function logout() {
        if (isOwner()) { applyPerms(); return; }   // rezim vlastnika se konci v konzoli, ne odhlasenim
        _lastUserId = null;
        try { localStorage.removeItem(LS_IDCUR); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:logout'); }   // odhlášení ruší i SSO
        clearTrust();          // „odhlásit" musí zrušit i pamatované přihlášení
        setSess(null);
        if (getFirm()) showLogin(false);
        else showGate();
    }

    // ------------------------------------------------------------------
    // Auto-zámek po nečinnosti (minuty; 0 = vypnuto)
    // ------------------------------------------------------------------
    var _actTs = Date.now();
    function _touchActivity() { _actTs = Date.now(); }
    function lockCheck() {
        if (isOwner()) return;                // rezim vlastnika se po necinnosti nezamyka
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
        // rezim vlastnika: appka nabehne rovnou, s vsim odemcenym (js/vlastnik.js).
        // ZADNY early return - periodicke srovnani UI nize musi bezet i tady,
        // mrizku Nastroju prekresluji jine moduly a bez ticku by zustala orezana.
        var f = isOwner() ? null : getFirm();
        if (isOwner()) {
            applyPerms();
            enterApp();                            // vlastnik branou neprochazi -> spustit rovnou
        } else if (f) {
            rememberCurrentFirm();                 // ať je aktivní firma vždy v profilech
            var u = currentUser();
            if (!u) showLogin(false);
            else if (getLockOnStart()) {
                try { localStorage.setItem('arSurveyor', u.name); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:init'); }
                // PAMATOVANÉ PŘIHLÁŠENÍ: když si to uživatel na tomhle zařízení
                // zapnul, appka se otevře přihlášená (u režimu 'bio' po ověření
                // telefonem). Každé TRUST_MAX-té spuštění chce heslo doopravdy.
                var t = trustFor(u.id);
                if (t && trustLeft(t) > 0) autoLogin(u, t);
                else if (t) { clearTrust(); showLogin(true, true); }   // kontrolní přihlášení
                else lock();
            } else {
                try { localStorage.setItem('arSurveyor', u.name); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:init'); }
                applyPerms();
                enterApp();                        // zamek pri startu vypnuty -> zadna brana, spustit rovnou
            }
            if (f.cloud) {
                setTimeout(refreshConfig, 2500);   // oprávnění/uživatelé se mohli změnit jinde
                setTimeout(syncUsage, 9000);       // odešli, co se nasbíralo offline
            }
        } else {
            showGate();                            // bez účtu se appka neotevře
        }
        // pojistka: kdyby cokoli selhalo, úvodní obrazovka se nesmí zaseknout skrytá
        // pojistka: kdyz po 6 s nestoji zadna brana a appka porad nebezi, spustit ji
        // (jinak by uzivatel koukal na zamcenou prazdnou obrazovku)
        setTimeout(function () {
            if (document.getElementById('ag-login') || document.getElementById('ag-gate')) return;
            enterApp();
        }, 6000);
        // periodické srovnání UI (mřížku Nástrojů překreslují jiné moduly) + auto-zámek
        // + jednou za ~2 minuty synchronizace fronty užívání (cloud)
        // BATERIE: přes AG.uiInterval, ať to netiká s appkou na pozadí (na pozadí není co
        // srovnávat ani co zamykat — auto-zámek se stejně vyhodnotí hned po návratu).
        var n = 0;
        (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () {
            tick(); lockCheck();
            n++;
            if (n % 60 === 0 && isCloud() && currentUser() && navigator.onLine !== false) syncUsage();
            // ⚠⚠ ZABLOKOVANÝ ÚČET SE MUSÍ SÁM ODHLÁSIT (doplněno 3. 9. 2026).
            //   Admin při blokaci čte: „nebude se moct přihlásit — ani na mobilu, kde
            //   je právě přihlášený (ODHLÁSÍ SE DO MINUTY)". Ten slib ale nikdo neplnil:
            //   refreshConfig() (ten zámek umí — viz `if (getSess() && !currentUser())`)
            //   se volal jen po přihlášení, po návratu online a z panelu firmy. Změřeno:
            //   účet zablokovaný na serveru jel na mobilu dál i po 160 s a otevíral
            //   nástroje; ven ho dostal až restart appky.
            //   Teď se konfigurace srovná jednou za minutu (30 × 2 s). Je to jeden malý
            //   GET /config; na pozadí netiká vůbec (AG.uiInterval) a offline se
            //   refreshConfig() sám vrátí bez požadavku.
            if (n % 30 === 0 && isCloud() && currentUser() && navigator.onLine !== false) {
                try { refreshConfig(true); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:tickRefreshConfig'); }
            }
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
        // zahodit vyrovnávací paměť getFirm()/isGuest() — volá ucty-admin.js po zápisu
        // do agFirma_v1 mimo tenhle modul (jinak by se změna projevila až po TTL)
        bustFirm: bustFirm,
        currentUser: currentUser,
        isAdmin: isAdmin,
        can: can,
        login: function () { showLogin(false); },
        lock: lock,
        logout: logout,
        // brána + host + profily firem
        showGate: showGate,
        // pozvánka z odkazu (?firma=&jmeno=) pro průvodce připojením
        pendingInvite: pendingInvite,
        // Letící hodnoty na pozadí (návrh ②) k použití i mimo přihlašovací obrazovku.
        // Vloží do `root` vrstvu .agl-live a nastartuje ji. ŽÁDNÉ stahování ani GPS —
        // čte jen to, co appka už má v localStorage (viz lvVals výš). Volá to
        // js/welcome-card.js pro #welcome-screen.
        mountLive: function (root) {
            if (!root) return null;
            injectStyles();
            var host = root.querySelector('.agl-live');
            if (!host) {
                host = document.createElement('div');
                host.className = 'agl-live';
                host.setAttribute('aria-hidden', 'true');
                root.insertBefore(host, root.firstChild);
            }
            startLive(root);
            return host;
        },
        isGuest: isGuest,
        // ucet a jeho prostory (novy model prihlasovani, 6. 9. 2026)
        ucet: getUcet,
        tarif: tarif,
        prostory: getProstory,
        aktualniProstor: aktualniProstor,
        prepniProstor: prepniProstor,
        showProstory: showProstory,
        showRegister: showRegister,
        isOwner: isOwner,
        listProfiles: listProfiles,
        profileLimit: profileLimit,
        switchProfile: switchProfile,
        removeProfile: removeProfile,
        rememberCurrentFirm: rememberCurrentFirm,
        profileKeyOf: profileKeyOf,
        avatarStyle: avStyle,   // barva avataru ze jména (užívá i administrace/chat)
        avatarHtml: avHtml,     // hotový <span> avataru (respektuje vlastní vzhled)
        avatarGet: avaGet,      // {h: odstín 0-359 | null, e: symbol/emoji | ''} nebo null
        avatarSet: avaSet,      // uloží vzhled avataru pro jméno v aktuální firmě
        getLockOnStart: getLockOnStart,
        setLockOnStart: setLockOnStart,
        // pamatované přihlášení + Face ID (nastavení v js/ucty-admin.js)
        TRUST_MAX: TRUST_MAX,
        getTrust: getTrust,
        clearTrust: clearTrust,
        trustFor: trustFor,
        trustLeft: trustLeft,
        bioSupported: bioSupported,
        bioAvailable: bioAvailable,
        bioEnroll: bioEnroll,
        bioForget: bioForget,
        offerBio: offerBio,
        // zakázky přidělené účtu na tomto zařízení
        projList: projList,
        projAclFor: projAclFor,
        setProjAcl: setProjAcl,
        allowedProjects: allowedProjects,
        applyProject: applyProject,
        applyProjPerms: applyProjPerms,
        hashPin: hashPin,
        makeSalt: makeSalt,
        ensureLib: ensureLib,
        usageLogRaw: usageLogRaw,
        usageLog: usageLog,
        usageQuery: usageQuery,
        usageClear: usageClear,
        applyPerms: applyPerms,
        // cloud
        isCloud: isCloud,
        // Má telefon platný přístup k serveru firmy? Bez tokenu vrací server 401 —
        // a to NENÍ výpadek serveru, i když to tak dřív vypadalo (viz cloudDuvod()
        // v js/ucty-admin.js). Panely to potřebují vědět, aby nabídly přihlášení
        // místo hlášky „Server nedostupný".
        hasToken: function () { return !!getTok(); },
        apiUrl: apiUrl,
        DEFAULT_API: DEFAULT_API,
        cloudFetch: cloudFetch,
        adoptLogin: adoptLogin,
        adoptConfig: adoptConfig,
        refreshConfig: refreshConfig,
        lastSync: lastSync,
        syncUsage: syncUsage
    };
})();
