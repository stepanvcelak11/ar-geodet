// ============================================================================
// QTRIG — firemní cloud API (Cloudflare Worker + D1)
// ----------------------------------------------------------------------------
// Backend pro přihlašování mezi zařízeními: firmy, uživatelé, role, oprávnění
// a sběr dat o užívání ze všech mobilů. Free plán Workers (100k požadavků/den)
// + D1 (5 GB) — pro malou firmu řádová rezerva.
//
// Bezpečnost (přiměřená účelu — geodetická data, ne bankovnictví):
//   • hesla: PBKDF2-SHA256, 40 000 iterací (Workers povolují max 100 000;
//     free plán má 10 ms CPU/požadavek, praktické pásmo je 20–80k), sůl 16 B
//   • tokeny: HMAC-SHA256 podepsané, platnost 60 dní, bez stavu na serveru;
//     každý požadavek ověřuje uživatele v DB (zablokování/smazání platí hned)
//   • zámek přihlašování: 8 chyb → 15 minut; zakládání firem: 5/den na IP
//   • podepisovací tajemství se vygeneruje samo a drží v D1 (tabulka meta)
//
// Nasazení (funguje i BEZ Claude — viz cloud/README.md):
//   wrangler d1 execute ar-geodet-db --remote --file=cloud/schema.sql
//   wrangler deploy cloud/worker.js --name ar-geodet-api  (binding DB → D1)
// ============================================================================

const ITERS = 40000;                       // PBKDF2 iterace (viz hlavička)
const TOKEN_DAYS = 60;                     // platnost tokenu
const ROLES = ['admin', 'vedeni', 'zamestnanec'];
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // bez O/0, I/1/L

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Owner-Key',
    'Access-Control-Max-Age': '86400'
};

// ---------------------------------------------------------------------------
// pomocné
// ---------------------------------------------------------------------------
function json(data, status) {
    return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, CORS)
    });
}
function err(status, msg, extra) { return json(Object.assign({ error: msg }, extra || {}), status); }

function hexToBuf(hex) {
    const a = new Uint8Array(hex.length / 2);
    for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
    return a;
}
function bufToHex(buf) {
    const a = new Uint8Array(buf); let s = '';
    for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
    return s;
}
function b64u(buf) {
    let s = typeof buf === 'string' ? buf : String.fromCharCode.apply(null, new Uint8Array(buf));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return atob(s);
}
function randHex(bytes) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return bufToHex(a.buffer);
}
function firmCode() {
    const a = new Uint8Array(6);
    crypto.getRandomValues(a);
    let s = '';
    for (let i = 0; i < 6; i++) s += CODE_ABC[a[i] % CODE_ABC.length];
    return s;
}

async function pbkdf2(password, saltHex, iters) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBuf(saltHex), iterations: iters }, key, 256);
    return bufToHex(bits);
}
function timingSafeEq(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

// ---- podepisovací tajemství (vygeneruje se samo, drží v D1.meta) -----------
let _secret = null;
async function getSecret(env) {
    if (_secret) return _secret;
    if (env.TOKEN_SECRET) { _secret = env.TOKEN_SECRET; return _secret; }
    const row = await env.DB.prepare("SELECT v FROM meta WHERE k='token_secret'").first();
    if (row && row.v) { _secret = row.v; return _secret; }
    const s = randHex(32);
    // INSERT OR IGNORE — kdyby se dvě izolace praly, vyhraje první a druhá si ji přečte
    await env.DB.prepare("INSERT OR IGNORE INTO meta(k,v) VALUES('token_secret',?)").bind(s).run();
    const row2 = await env.DB.prepare("SELECT v FROM meta WHERE k='token_secret'").first();
    _secret = row2.v;
    return _secret;
}
async function hmac(env, msg) {
    const secret = await getSecret(env);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
    return b64u(sig);
}
// `a` = id účtu. Ve starých tokenech chybí a chybět SMÍ — appka v telefonu se
// nepřehraje ze dne na den a token platí 60 dní. auth() si účet v tom případě
// dohledá přes users.acc_id, takže se nikdo neodhlásí kvůli nasazení.
async function makeToken(env, user, accId) {
    const p = { u: user.id, f: user.firm_id, exp: Date.now() + TOKEN_DAYS * 864e5 };
    if (accId || user.acc_id) p.a = accId || user.acc_id;
    const payload = b64u(JSON.stringify(p));
    return payload + '.' + await hmac(env, payload);
}
async function readToken(env, req) {
    const h = req.headers.get('Authorization') || '';
    const m = /^Bearer\s+(.+)$/.exec(h);
    if (!m) return null;
    const parts = m[1].split('.');
    if (parts.length !== 2) return null;
    if (!timingSafeEq(await hmac(env, parts[0]), parts[1])) return null;
    let p;
    try { p = JSON.parse(b64uDecode(parts[0])); } catch (e) { return null; }
    if (!p || !p.u || !p.f || !p.exp || p.exp < Date.now()) return null;
    return p;
}
// ověření tokenu VČETNĚ stavu v DB (role se čte čerstvá; disabled platí okamžitě)
async function auth(env, req) {
    const p = await readToken(env, req);
    if (!p) return null;
    // JOIN na firmu: stav zmrazení i strop lidí přijdou TÍMŽE dotazem, aby
    // každý požadavek nestál druhý round-trip do D1.
    const u = await dbFirst(env,
        'SELECT u.id, u.firm_id, u.name, u.role, u.disabled, u.acc_id, u.left_ts, u.own, '
        + 'f.frozen AS frozen, f.max_users AS maxUsers '
        + 'FROM users u JOIN firms f ON f.id = u.firm_id WHERE u.id=? AND u.firm_id=?', p.u, p.f);
    if (!u || u.disabled) return null;
    // ÚČET (identita + tarif). Čte se čerstvý z DB, ne z tokenu: konec
    // předplatného ani zablokování účtu nesmí čekat 60 dní, než token vyprší.
    // Když účet ještě není (starý řádek, který se od migrace nepřihlásil),
    // zůstává tarif 'zaklad' — placené cesty se tím zavřou, ale zbytek appky
    // běží dál a při nejbližším přihlášení se účet doplní.
    const accId = p.a || u.acc_id;
    u.acc = accId ? await dbFirst(env, 'SELECT * FROM accounts WHERE id=?', accId) : null;
    if (u.acc && u.acc.disabled) return null;
    u.tarif = tarifUctu(u.acc);
    u.accId = u.acc ? u.acc.id : null;
    // TOKEN HODINEK se pozna podle pole `j` (zakazka, na kterou byl sparovany).
    // Podepisuje se TYMZ tajemstvim jako bezny uzivatelsky token, takze bez tehle
    // znacky prosel kamkoli — komentar u parovani sliboval opak („hodinky nemohou
    // sahnout jinam"), ale nic to nevynucovalo. Kdo se k te hodnote dostal
    // (pujcene nebo prodane hodinky, zaloha nastaveni), mel 180 dni pristup k cele
    // firme. Ted si priznak nese `me` a brana ho pousti jen na /watch/*.
    u.watchJob = (typeof p.j === 'string' && p.j) ? p.j : null;
    return u;
}

// POZN. k odpovedim /firms a /login: uz NEOBSAHUJI polozku "offline".
// Drive se v ni klientovi posilala sul + pass_hash z databaze, takze telefon
// mel v localStorage presne tu hodnotu, kterou ma server ulozenou. Offline
// overovadlo si od te doby dela klient sam z vlastni soli (js/ucty.js,
// makeOffline). Starsi verze appky maji sve overovadlo ulozene z drivejska
// a funguji dal - nova odpoved ho jen neprepise.
// ---- rate-limit přes tabulku guard ----------------------------------------
async function guardHit(env, key, maxN, lockMs) {
    const now = Date.now();
    const row = await env.DB.prepare('SELECT n, until FROM guard WHERE k=?').bind(key).first();
    if (row && row.until > now && row.n >= maxN) return false;      // zamčeno
    if (!row || row.until <= now) {
        await env.DB.prepare('INSERT OR REPLACE INTO guard(k,n,until) VALUES(?,1,?)').bind(key, now + lockMs).run();
    } else {
        await env.DB.prepare('UPDATE guard SET n=n+1 WHERE k=?').bind(key).run();
    }
    return true;
}
async function guardClear(env, key) {
    await env.DB.prepare('DELETE FROM guard WHERE k=?').bind(key).run();
}

function defaultPermsJson() {
    // musí odpovídat PERMS v js/ucty.js (appka si stejně přebírá jen známé klíče)
    const keys = ['dock.novybod', 'dock.body', 'dock.nastroje', 'dock.vice', 'dock.nastaveni',
        'tools.Měření', 'tools.Vytyčování a náčrt', 'tools.Katastr a data', 'tools.AR a kalibrace',
        'tools.Pomůcky', 'tools.Terénní nástroje', 'set.tab-ar', 'set.tab-data', 'set.tab-udrzba', 'x.dashboard'];
    const vd = {}, zm = {};
    for (const k of keys) { vd[k] = true; zm[k] = (k !== 'set.tab-udrzba' && k !== 'x.dashboard'); }
    return JSON.stringify({ vedeni: vd, zamestnanec: zm });
}

// ---- složení odpovědi /config (posílá se i po přihlášení) ------------------
async function configPayload(env, firmId) {
    const firm = await dbFirst(env,
        'SELECT id, code, name, perms, auto_lock, max_users, frozen FROM firms WHERE id=?', firmId);
    if (!firm) return null;
    // `created` a `last_login` jdou ven schválně: admin v appce podle nich pozná,
    // jestli účet, který založil, už někdo na svém mobilu použil. Heslo ani sůl
    // se tímhle kanálem NEPOSÍLAJÍ (a nikdy posílat nesmí) — seznam vidí každý
    // přihlášený člen firmy, ne jen admin.
    // `left_ts` (kdo z firmy odešel) chodí ven schválně: admin musí bývalé členy
    // v seznamu vidět, jinak by nevěděl, komu ještě zůstal archiv — a nemohl by
    // ho odebrat. Do stropu míst se ale nepočítají (viz POST /users).
    const users = (await dbAll(env,
        'SELECT id, name, role, disabled, created, last_login, left_ts FROM users WHERE firm_id=? ORDER BY name', firmId))
        .map(u => ({
            id: u.id, name: u.name, role: u.role, disabled: u.disabled, created: u.created,
            lastLogin: u.last_login || 0, odesel: u.left_ts || 0
        }));
    let perms; try { perms = JSON.parse(firm.perms); } catch (e) { perms = {}; }
    // stav poslední žádosti o víc míst a hláška vlastníka appky. Obojí chodí
    // TÍMHLE kanálem schválně — klient už /config obnovuje sám, takže to
    // nepotřebuje vlastní dotazovací smyčku (a žádný další požadavek do limitu).
    let request = null, notice = null;
    try {
        request = await env.DB.prepare(
            'SELECT id, ts, want, reason, state, decided, reply FROM firm_requests WHERE firm_id=? ORDER BY id DESC LIMIT 1')
            .bind(firmId).first();
    } catch (e) { request = null; }
    try {
        const row = await env.DB.prepare("SELECT v FROM meta WHERE k='notice'").first();
        if (row && row.v) {
            const n = JSON.parse(row.v);
            if (n && n.txt && (!n.until || n.until > Date.now())) notice = n;
        }
    } catch (e) { notice = null; }
    // VYPINAC MODULU. Kdyz se neco rozbije, vlastnik to zhasne z konzole a appka
    // to pozna pri nejblizsim /config - bez cekani na nove vydani a bez toho, aby
    // si kazdy musel stahnout aktualizaci. Chodi to TIMHLE kanalem schvalne:
    // klient uz /config obnovuje sam, takze to nestoji zadny dotaz navic.
    let flags = null;
    try {
        const rowF = await env.DB.prepare("SELECT v FROM meta WHERE k='flags'").first();
        if (rowF && rowF.v) {
            const g = JSON.parse(rowF.v);
            if (g && Array.isArray(g.off) && g.off.length) flags = g;
        }
    } catch (e) { flags = null; }
    return {
        firm: { code: firm.code, name: firm.name, autoLockMin: firm.auto_lock, perms: perms },
        users: users,
        limits: {
            users: users.filter(u => !u.odesel).length,
            maxUsers: firm.max_users || FIRM_MAX_DEFAULT,
            frozen: firm.frozen || 0
        },
        request: request || null,
        notice: notice,
        flags: flags,
        serverTime: Date.now()
    };
}

// ---- zpětná vazba od uživatelů (klient js/zpetna-vazba.js) ----------------
// Schránka „napište mi": kdokoli, kdo appku otevřel, může poslat zprávu autorovi.
// ZÁMĚRNĚ BEZ PŘIHLÁŠENÍ — kdo se ještě nepřihlásil (host, člověk, co appku právě
// dostal odkazem), má k psaní nejvíc důvodů. Proto je POST /feedback jediná
// zapisující routa bez tokenu a hlídá ji jen počítadlo na IP.
//
// ⚠ ČTENÍ JE ODDĚLENÉ OD FIREM. Firemní účty (i admini) tuhle schránku vidět
//   NESMÍ — chodí do ní zprávy od cizích lidí. Proto se GET/POST /feedback/done
//   neváže na token, ale na tajemství OWNER_KEY, které zná jen vlastník appky:
//       wrangler secret put OWNER_KEY --name ar-geodet-api
//   Bez nastaveného tajemství čtení vrátí 503 (a psát jde dál) — je to bezpečný
//   výchozí stav: raději nedostupná schránka než schránka otevřená všem.
let _fbReady = false;
async function ensureFeedbackTable(env) {
    if (_fbReady) return;
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS feedback (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, ' +
        'kind TEXT, txt TEXT NOT NULL, contact TEXT, meta TEXT, ' +
        'who TEXT, done INTEGER NOT NULL DEFAULT 0)').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(done, id)').run();
    _fbReady = true;
}
// Vlastník = ten, kdo pošle správné OWNER_KEY. Porovnává se timingSafeEq (stejně
// jako hesla), aby se klíč nedal uhodnout po znacích podle doby odpovědi.
// Stav klíče na serveru — TŘI slova, ne jedno true/false. /health ho hlásí,
// aby šlo zvenčí poznat, PROČ konzole vrací 503, bez přístupu na Cloudflare:
//   'chybi'  = env.OWNER_KEY vůbec není (nikdy nenastaven, NEBO ho smazal
//              `wrangler deploy` — dashboardové proměnné typu „Text" nasazení
//              z GitHubu přepisuje; proto má wrangler.toml `keep_vars = true`
//              a deploy-worker.yml umí klíč sázet ze secretu repozitáře),
//   'kratky' = je tam, ale pod 24 znaků (worker ho záměrně nebere, viz níž),
//   'ok'     = použitelný. Délka ani hodnota se ven neposílá.
function ownerKeyStav(env) {
    const want = env && env.OWNER_KEY;
    if (!want) return 'chybi';
    if (String(want).length < 24) return 'kratky';
    return 'ok';
}
function ownerOk(req, env) {
    const want = env && env.OWNER_KEY;
    // Krátký klíč je totéž co žádný: za těmihle dveřmi se mažou celé firmy
    // i s body a docházkou. Radši ať konzole hlásí „není nastavená", než aby
    // ji hlídalo heslo, které se dá vystřílet dřív, než brzda stihne zabrat.
    if (ownerKeyStav(env) !== 'ok') return null;   // tajemství není použitelné → 503
    const got = req.headers.get('X-Owner-Key') || '';
    return timingSafeEq(String(got), String(want));
}

// ---------------------------------------------------------------------------
// SPRÁVA APPKY (vlastník) — stropy firem, zmrazení, žádosti, hláška všem
// ---------------------------------------------------------------------------
// Firma smí sama nabrat FIRM_MAX_DEFAULT lidí; víc jen když strop zvedne
// vlastník appky (žádost s odůvodněním → tabulka firm_requests). Zakladatel
// (otisk IP, ne IP sama) smí založit nejvýš FOUND_MAX firem za FOUND_WINDOW.
//
// MIGRACE SE DĚLÁ SAMA A JEN PŘI POTŘEBĚ: dbFirst() zkusí dotaz s novými sloupci,
// a teprve když selože, doplni sloupce a dotaz zopakuje. Studený start tak
// nestojí ani jeden dotaz navíc oproti dřívějšku — na rozdíl od varianty
// "na začátku každého requestu spusť pět ALTERů, co stejně selžou".
const FIRM_MAX_DEFAULT = 10;               // míst ve firmě bez schvalování
const FOUND_MAX = 3;                       // firem na jednoho zakladatele
const FOUND_WINDOW = 90 * 864e5;           // ...za 90 dní
const SOLO_MAX = 1;                        // míst ve VLASTNÍM prostoru účtu (Základ)
let _ownerMig = false;
async function ensureOwnerSchema(env) {
    if (_ownerMig) return;
    // SQLite neumí IF NOT EXISTS u ALTER — když sloupec už je, příkaz selže
    // a to je správně (proto try/catch u každého zvlášť, ne kolem celé smyčky).
    const alters = [
        'ALTER TABLE firms ADD COLUMN max_users INTEGER NOT NULL DEFAULT ' + FIRM_MAX_DEFAULT,
        'ALTER TABLE firms ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE firms ADD COLUMN note TEXT',
        'ALTER TABLE firms ADD COLUMN founder TEXT',
        // KDY SE ČLOVĚK NAPOSLED PŘIHLÁSIL. Bez toho admin z appky nepoznal, jestli
        // účet, který založil, někdo na svém mobilu vůbec použil — a stěžoval si
        // právem: „ve firmě nevidím uživatele, kteří jsou na jiném mobilu".
        'ALTER TABLE users ADD COLUMN last_login INTEGER'
    ];
    for (const s of alters) { try { await env.DB.prepare(s).run(); } catch (e) {} }
    // I tyhle příkazy jdou přes try/catch: když jeden selže, nesmí to shodit
    // požadavek, který migraci jen mimochodem spustil (třeba přihlášení).
    const creates = [
        'CREATE TABLE IF NOT EXISTS firm_requests ('
        + 'id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id TEXT NOT NULL, ts INTEGER NOT NULL, '
        + 'want INTEGER NOT NULL, reason TEXT, who TEXT, '
        + "state TEXT NOT NULL DEFAULT 'new', decided INTEGER, reply TEXT)",
        'CREATE INDEX IF NOT EXISTS idx_freq_firm ON firm_requests(firm_id, id)',
        'CREATE TABLE IF NOT EXISTS stats_firm ('
        + 'day TEXT NOT NULL, firm_id TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(day, firm_id))',
        // CHYBY OD LIDI. Do 30. 8. 2026 zustaval protokol chyb (js/err-log.js) jen
        // v tom jednom telefonu, kde chyba spadla - o padech u uzivatelu se vlastnik
        // nedozvedel vubec nic. Sem chodi POUZE hlaska, soubor, radek, verze appky
        // a jmeno uctu; ZADNE souradnice, zadna data mereni, zadny obsah zakazky.
        'CREATE TABLE IF NOT EXISTS errors ('
        + 'id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id TEXT NOT NULL, uname TEXT, '
        + 'ts INTEGER NOT NULL, sig TEXT NOT NULL, msg TEXT NOT NULL, src TEXT, '
        + 'line INTEGER, n INTEGER NOT NULL DEFAULT 1, ver TEXT, dev TEXT)',
        'CREATE INDEX IF NOT EXISTS idx_err_ts ON errors(ts)',
        'CREATE INDEX IF NOT EXISTS idx_err_firm ON errors(firm_id, ts)'
    ];
    for (const s of creates) { try { await env.DB.prepare(s).run(); } catch (e) {} }
    _ownerMig = true;
}
// ---------------------------------------------------------------------------
// ÚČTY A PROSTORY (nový model přihlašování, 6. 9. 2026)
// ---------------------------------------------------------------------------
// CO SE ZMĚNILO A PROČ:
//   Do teď platilo „účet = řádek ve firmě". Kdo chtěl appku sám pro sebe, musel
//   si založit firmu; kdo přešel k jinému zaměstnavateli, začínal od nuly, a kdo
//   dělal pro dva, měl dvě hesla. A hlavně: bez přihlášení se dalo dovnitř jako
//   HOST, takže „kdo to naměřil" nemělo odpověď.
//
//   Nově je IDENTITA (kdo jsi, heslo, tarif) v tabulce `accounts` a ČLENSTVÍ
//   (v jakém prostoru a s jakou rolí) zůstává řádkem v `users`. Jeden účet může
//   mít členství víc — vlastní prostor má vždycky a nikdy o něj nepřijde, firma
//   je členství DRUHÉ.
//
// ⚠⚠ PROČ SE `users` NEROZBILA NA `members`, JAK ŘÍKAL PŮVODNÍ NÁVRH:
//   `usage`, `chat`, `sync_points`, `jobs` i `stats_firm` se klíčují přes
//   users.id a firm_id. Přejmenovat tabulku by znamenalo přepsat každý dotaz
//   v souboru a odmigrovat všechna data — a jediná chyba v tom by nenávratně
//   rozpojila body od lidí, kteří je naměřili. Členství uz JE řádek v `users`;
//   chybělo jen spojení na účet. Přibyly proto TŘI SLOUPCE (acc_id, left_ts,
//   own) a jedna nová tabulka. Všechny dosavadní dotazy platí beze změny.
//
// ⚠⚠ TARIF DRŽÍ ÚČET, NE PROSTOR. Kdyby ho držel prostor, pozvaný člověk bez
//   Pro by vstupem do Pro firmy dostal chat i vysílačku. S tarifem na účtu je
//   „Základ ve firmě vidí jen body a zakázky" automatický důsledek, ne výjimka.
//   Prostor drží jen POČET MÍST (firms.max_users: 1 sólo vs 10 firma).
//
// ⚠⚠ TARIF SE NESMÍ VYMÁHAT JEN SKRÝVÁNÍM V UI. `applyPerms()` v appce stačí na
//   role (kolegové v jedné firmě), ale ne na placení — kdo si appku otevře
//   v prohlížeči, skrytou dlaždici si odkryje. Placené cesty proto kontroluje
//   SERVER (PLACENE_CESTY níž) a dělá to PŘED rolí: sólo uživatel je ve svém
//   prostoru správce, takže rolí by prošel na všechno.
const TARIFY = ['zaklad', 'pro'];

// Cesty, které smí jen účet s tarifem Pro. Co v seznamu NENÍ, je zdarma —
// vědomě: body, zakázky, konfigurace, změna hesla a záloha jsou to, čím člověk
// vládne svým vlastním datům, a za to se neplatí. Placené je všechno kolem
// SPOLUPRÁCE a VYKAZOVÁNÍ (rozhodnutí uživatele: pozvaný bez Pro vidí ve firmě
// jen body a zakázky).
const PLACENE_CESTY = [
    '/chat',        // firemní chat
    '/pos',         // vysílačka (kde kdo je)
    '/usage',       // užívání a docházka
    '/stats',       // přehledy firmy
    '/watch'        // hodinky (prefix — /watch/code, /watch/tiles, …)
];
function placenaCesta(path) {
    return PLACENE_CESTY.some(p => path === p || path.indexOf(p + '/') === 0);
}

// Kód účtu je OSMIZNAKOVÝ, kód firmy ŠESTIZNAKOVÝ — schválně, ne kosmeticky:
// přihlašovací pole bere JEDEN kód a server podle délky pozná, jestli hledat
// v účtech, nebo (u starých klientů) ve firmách. Se stejnou délkou by musel
// zkoušet obojí a kolize dvou kódů by tiše přihlásila do špatného místa.
function accCode() {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    let s = '';
    for (let i = 0; i < 8; i++) s += CODE_ABC[a[i] % CODE_ABC.length];
    return s;
}

let _uctyMig = false;
async function ensureUctySchema(env) {
    if (_uctyMig) return;
    const creates = [
        'CREATE TABLE IF NOT EXISTS accounts ('
        + 'id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, '
        + 'pass_hash TEXT NOT NULL, salt TEXT NOT NULL, iters INTEGER NOT NULL, '
        + "tarif TEXT NOT NULL DEFAULT 'zaklad', tarif_do INTEGER, "
        + 'disabled INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_login INTEGER)',
        'CREATE INDEX IF NOT EXISTS idx_acc_code ON accounts(code)'
    ];
    for (const s of creates) { try { await env.DB.prepare(s).run(); } catch (e) {} }
    // SQLite neumí IF NOT EXISTS u ALTER — když sloupec už je, příkaz selže
    // a to je v pořádku (proto try/catch u každého zvlášť).
    const alters = [
        'ALTER TABLE users ADD COLUMN acc_id TEXT',
        // ⚠ ODCHOD Z FIRMY NEMAŽE ČLENSTVÍ. Vyplní se `left_ts` a prostor
        //   zůstane v přepínači jako ARCHIV jen ke čtení. MUSÍ být zamrzlý:
        //   server vydává jen záznamy do toho času, jinak by bývalý člen viděl,
        //   co firma naměřila potom.
        'ALTER TABLE users ADD COLUMN left_ts INTEGER',
        // 1 = vlastní prostor účtu. Ten se nedá opustit ani smazat — je to
        // místo, kde člověku data zůstanou, i když ze všech firem odejde.
        'ALTER TABLE users ADD COLUMN own INTEGER NOT NULL DEFAULT 0'
    ];
    for (const s of alters) { try { await env.DB.prepare(s).run(); } catch (e) {} }
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_users_acc ON users(acc_id)').run(); } catch (e) {}
    _uctyMig = true;
}

// Účet pro starý řádek v `users`, který ještě žádný nemá.
// ⚠ DĚLÁ SE LÍNĚ, AŽ PŘI PŘIHLÁŠENÍ, A NIC NEMAŽE. Hromadná migrace všech řádků
//   naráz by musela proběhnout v jednom požadavku (10 ms CPU na free plánu)
//   a při chybě uprostřed by nechala databázi rozpůlenou. Takhle si každý účet
//   svůj záznam vyrobí sám, když se poprvé přihlásí, a stará cesta funguje dál
//   pro každého, kdo ještě má v telefonu starou appku.
async function ucetProUzivatele(env, u) {
    if (u.acc_id) {
        const a = await dbFirst(env, 'SELECT * FROM accounts WHERE id=?', u.acc_id);
        if (a) return a;
    }
    await ensureUctySchema(env);
    const id = crypto.randomUUID();
    const firm = await dbFirst(env, 'SELECT max_users FROM firms WHERE id=?', u.firm_id);
    // Zděděné heslo se PŘENÁŠÍ TAK, JAK JE (hash, sůl i počet iterací) — kdyby
    // se přepočítávalo, musel by tu být otevřený text a ten server nikdy nemá.
    let code = accCode();
    for (let i = 0; i < 3; i++) {
        try {
            await env.DB.prepare(
                'INSERT INTO accounts(id,code,name,pass_hash,salt,iters,tarif,disabled,created,last_login) '
                + "VALUES(?,?,?,?,?,?,?,?,?,?)")
                .bind(id, code, u.name, u.pass_hash, u.salt, u.iters,
                    // Kdo dosud platil za firmu (víc než jedno místo), o nic
                    // nepřijde: dostane Pro. Sólo účet začíná na Základu.
                    (firm && firm.max_users > SOLO_MAX) ? 'pro' : 'zaklad',
                    u.disabled ? 1 : 0, u.created || Date.now(), u.last_login || null).run();
            break;
        } catch (e) {
            if (i === 2) return null;
            code = accCode();
        }
    }
    await dbRunSoft(env, 'UPDATE users SET acc_id=? WHERE id=?', id, u.id);
    return await dbFirst(env, 'SELECT * FROM accounts WHERE id=?', id);
}

// Prostory (členství) účtu — i ty opuštěné, ty se vrací jako archiv.
async function prostoryUctu(env, accId) {
    const rows = await dbAll(env,
        'SELECT u.id AS uid, u.firm_id, u.role, u.own, u.left_ts, u.disabled, '
        + 'f.name AS nazev, f.code AS kod, f.max_users AS mist, f.frozen '
        + 'FROM users u JOIN firms f ON f.id=u.firm_id WHERE u.acc_id=? ORDER BY u.own DESC, f.name',
        accId);
    return (rows || []).map(r => ({
        uid: r.uid, firmId: r.firm_id, role: r.role,
        vlastni: !!r.own, archiv: !!r.left_ts, odesel: r.left_ts || 0,
        zablokovan: !!r.disabled,
        // ⚠ U VLASTNÍHO PROSTORU SE JMÉNO ANI KÓD NEPOSÍLÁ. Základ nemá o žádné
        //   „firmě" vědět — slovo firma se mu nikde ukázat nesmí. Kód je navíc
        //   POZVACÍ: rozdat ho u jednomístného prostoru nemá co dělat.
        nazev: r.own ? null : r.nazev,
        kod: (r.own || r.role !== 'admin') ? null : r.kod,
        mist: r.mist || FIRM_MAX_DEFAULT, frozen: r.frozen || 0
    }));
}

// Tarif účtu podle stavu v DB. Pro s prošlou platností padá zpátky na Základ —
// kontroluje se při KAŽDÉM požadavku, ne jen při přihlášení, aby konec
// předplatného nepočkal až na příští přihlášení (token platí 60 dní).
function tarifUctu(acc) {
    if (!acc) return 'zaklad';
    if (acc.tarif !== 'pro') return 'zaklad';
    if (acc.tarif_do && acc.tarif_do < Date.now()) return 'zaklad';
    return 'pro';
}

// ---------------------------------------------------------------------------
// PRODEJ PRO — objednávky, QR platba, párování plateb z banky
// ---------------------------------------------------------------------------
// Jak se Pro kupuje: appka založí OBJEDNÁVKU (číslo = variabilní symbol), ukáže
// QR platbu (český standard „QR platba" / SPAYD, čte ho každá banka v ČR) a
// člověk pošle peníze z vlastní bankovní appky. Žádná platební brána, žádná
// provize, žádné karty — jen převod na účet vlastníka.
//
// Jak se objednávka pozná jako zaplacená — DVĚ cesty, obě končí v zapniPro():
//   • RUČNĚ: vlastník vidí platbu ve výpisu, v konzoli klepne „Zaplaceno".
//   • SAMA: když je nastavený FIO_TOKEN (Fio banka, API jen ke čtení), worker se
//     každých pár minut (cron) zeptá banky na pohyby za posledních 7 dní, spáruje
//     příchozí platby podle VS (náhradně podle kódu účtu ve zprávě pro příjemce)
//     a Pro zapne bez lidské ruky. Co se nespáruje, zůstane v konzoli jako
//     „nezařazená platba" k ručnímu přiřazení — peníze se nikdy tiše nezahodí.
//
// ⚠ ÚDAJE PRODEJCE NEJSOU V KÓDU. Číslo účtu a ceny jsou proměnné workeru
//   (Cloudflare → Settings → Variables): PRODEJ_IBAN, PRODEJ_UCET (lidsky
//   čitelné „číslo/kód banky"), PRODEJ_CENA_MESIC a PRODEJ_CENA_ROK (Kč),
//   PRODEJ_ZKOUSKA_DNI (zkouška zdarma, 0 = žádná), PRODEJ_PRIJEMCE. Dokud
//   PRODEJ_IBAN chybí, je prodej VYPNUTÝ: appka ceník ukáže, ale místo QR řekne,
//   že se zatím platí jen klíčem. Tajemství FIO_TOKEN je secret
//   (wrangler secret put FIO_TOKEN) — má právo jen číst pohyby.
//
// MODEL (rozhodnutí uživatele 11. 9. 2026): PŘEDPLATNÉ po měsíci, nebo na rok
//   levněji, plus ZKOUŠKA ZDARMA na pár dní — jednou na účet. Doživotní licence
//   se neprodává; „navždy" umí jen ruční zapnutí z konzole (klíč nebo dar).
//
// ⚠ PÁROVÁNÍ JE IDEMPOTENTNÍ. Fio vrací pohyby za období a tentýž pohyb přijde
//   při každém dotazu znovu; každý má „ID pohybu" (column22), které se ukládá
//   do fio_pohyby jako PRIMARY KEY. Zpracuje se jen to, co tam ještě není —
//   pád uprostřed běhu tak nikomu nezapne Pro dvakrát ani ho nepřeskočí.
//   (Fio má i /last/ s automatickou zarážkou, ale ta se posune už při STAŽENÍ —
//   kdyby worker spadl mezi stažením a zápisem, platba by se ztratila.)
//
// ⚠ KOLIK DNÍ ZA PLATBU URČUJE ČÁSTKA, NE OBJEDNÁVKA. Kdo si objednal měsíc a
//   poslal roční částku, dostane rok (a naopak). Objednávka je jen VS a
//   připomínka; peníze jsou pravda. Díky tomu nevadí ani platba na zrušenou
//   objednávku (člověk přepnul měsíc→rok a zaplatil starý QR).
function prodejCfg(env) {
    const n = (v, d) => { const x = parseInt(v, 10); return isFinite(x) && x >= 0 ? x : d; };
    const iban = String((env && env.PRODEJ_IBAN) || '').replace(/\s+/g, '').toUpperCase();
    return {
        produkty: [
            { k: 'mesic', nazev: 'Měsíc', dni: 30, cena: n(env && env.PRODEJ_CENA_MESIC, 149) },
            { k: 'rok', nazev: 'Rok', dni: 365, cena: n(env && env.PRODEJ_CENA_ROK, 990) }
        ],
        zkouskaDni: n(env && env.PRODEJ_ZKOUSKA_DNI, 3),
        iban: /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban) ? iban : '',
        ucet: String((env && env.PRODEJ_UCET) || '').trim().slice(0, 40),
        prijemce: String((env && env.PRODEJ_PRIJEMCE) || 'QTRIG').trim().slice(0, 35),
        fio: !!(env && env.FIO_TOKEN)
    };
}
function produkt(cfg, k) { return cfg.produkty.find(p => p.k === k) || null; }
// Kolik dní si člověk zaplatil — nejdražší produkt, na který částka stačí
// (koruna tolerance kvůli zaokrouhlení). 0 = na nic nestačí (podplaceno).
function dniZaCastku(cfg, castka) {
    let dni = 0;
    cfg.produkty.forEach(p => { if (castka + 1 >= p.cena && p.dni > dni) dni = p.dni; });
    return dni;
}

let _prodejMig = false;
async function ensureProdejSchema(env) {
    if (_prodejMig) return;
    const creates = [
        // vs = číslo objednávky = variabilní symbol platby (8 číslic, náhodné,
        // aby se z něj nedalo číst, kolik lidí koupilo)
        'CREATE TABLE IF NOT EXISTS orders ('
        + 'vs INTEGER PRIMARY KEY, acc_id TEXT NOT NULL, code TEXT NOT NULL, '
        + 'amount INTEGER NOT NULL, dni INTEGER NOT NULL, created INTEGER NOT NULL, '
        + 'paid_ts INTEGER, paid_by TEXT, paid_amount INTEGER, paid_note TEXT, '
        + 'cancelled INTEGER NOT NULL DEFAULT 0)',
        'CREATE INDEX IF NOT EXISTS idx_orders_acc ON orders(acc_id)',
        // každý příchozí pohyb z banky, ať se spároval nebo ne
        'CREATE TABLE IF NOT EXISTS fio_pohyby ('
        + 'id TEXT PRIMARY KEY, ts INTEGER NOT NULL, castka INTEGER NOT NULL, mena TEXT, '
        + 'vs TEXT, msg TEXT, protiucet TEXT, nazev TEXT, stav TEXT NOT NULL, order_vs INTEGER, seen INTEGER NOT NULL)',
        // stav automatu: kdy naposled koukal, co řekla banka
        'CREATE TABLE IF NOT EXISTS fio_stav (k TEXT PRIMARY KEY, v TEXT)'
    ];
    for (const s of creates) { try { await env.DB.prepare(s).run(); } catch (e) {} }
    // zkouška zdarma: kdy si ji účet vzal (jednou a dost)
    try { await env.DB.prepare('ALTER TABLE accounts ADD COLUMN trial_ts INTEGER').run(); } catch (e) {}
    _prodejMig = true;
}

function novyVs() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return 10000000 + (a[0] % 90000000);          // 8 číslic, první nenulová
}

// QR platba (SPAYD). Zpráva bez diakritiky a bez hvězdičky — hvězdička je
// oddělovač formátu a diakritiku některé bankovní appky rozbijí.
function spayd(cfg, castka, vs, msg) {
    const cist = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[*]/g, ' ').trim();
    let s = 'SPD*1.0*ACC:' + cfg.iban + '*AM:' + (castka | 0) + '.00*CC:CZK';
    if (vs) s += '*X-VS:' + String(vs);
    if (msg) s += '*MSG:' + cist(msg).slice(0, 60);
    if (cfg.prijemce) s += '*RN:' + cist(cfg.prijemce).slice(0, 35);
    return s;
}

// Co z objednávky vidí appka (bez id účtu, bez interních polí).
function objednavkaProAppku(o, cfg, code) {
    const msg = 'QTRIG PRO ' + (code || o.code || '');
    return {
        vs: o.vs, castka: o.amount, dni: o.dni, created: o.created,
        stav: o.cancelled ? 'zrusena' : (o.paid_ts ? 'zaplacena' : 'ceka'),
        zaplaceno: o.paid_ts || 0,
        msg: msg,
        spayd: (cfg.iban && !o.paid_ts && !o.cancelled) ? spayd(cfg, o.amount, o.vs, msg) : ''
    };
}
function cfgProAppku(cfg, acc) {
    return {
        produkty: cfg.produkty, iban: cfg.iban, ucet: cfg.ucet, prijemce: cfg.prijemce,
        zapnuto: !!cfg.iban, automat: cfg.fio,
        zkouska: { dni: cfg.zkouskaDni, pouzita: !!(acc && acc.trial_ts), kdy: (acc && acc.trial_ts) || 0 }
    };
}

// Zapne (nebo prodlouží) Pro účtu. `dni` 0 = navždy. Prodloužení se počítá od
// konce běžícího předplatného, ne ode dneška — kdo zaplatí měsíc předem, o ten
// měsíc nepřijde.
async function zapniPro(env, acc, dni) {
    const now = Date.now();
    let doKdy = null;
    if (dni > 0) {
        const od = (acc.tarif === 'pro' && acc.tarif_do && acc.tarif_do > now) ? acc.tarif_do : now;
        doKdy = od + Math.max(1, Math.min(3650, dni | 0)) * 864e5;
    }
    await env.DB.prepare('UPDATE accounts SET tarif=?, tarif_do=? WHERE id=?').bind('pro', doKdy, acc.id).run();
    await mistaPodleTarifu(env, acc.id, 'pro');
    return doKdy;
}
async function vypniPro(env, acc) {
    await env.DB.prepare("UPDATE accounts SET tarif='zaklad', tarif_do=NULL WHERE id=?").bind(acc.id).run();
    await mistaPodleTarifu(env, acc.id, 'zaklad');
}
// ⚠ MÍSTA V PROSTORU JDOU S TARIFEM. Tarif drží účet, ale „kolik lidí se sem
//   vejde" je vlastnost prostoru — bez téhle věty by si čerstvě zaplacené Pro
//   nemělo koho pozvat. Zpátky na Základ se strop stahuje JEN u prostoru, kde
//   nikdo další není: nikoho to nevyhodí, ale admin by viděl „5 z 1".
async function mistaPodleTarifu(env, accId, tarif) {
    const vlastni = await dbFirst(env,
        'SELECT f.id, (SELECT COUNT(*) FROM users x WHERE x.firm_id=f.id AND x.left_ts IS NULL) AS lidi '
        + 'FROM firms f JOIN users u ON u.firm_id=f.id WHERE u.acc_id=? AND u.own=1', accId);
    if (vlastni && (tarif === 'pro' || vlastni.lidi <= SOLO_MAX)) {
        await dbRunSoft(env, 'UPDATE firms SET max_users=? WHERE id=?',
            tarif === 'pro' ? FIRM_MAX_DEFAULT : SOLO_MAX, vlastni.id);
    }
}

// Označí objednávku jako zaplacenou a zapne Pro na tolik dní, na kolik částka
// stačí (viz dniZaCastku). Vrací počet dní, nebo 0 když už zaplacená byla
// (druhé zavolání nesmí prodloužit podruhé) nebo částka na nic nestačí.
async function objednavkaZaplacena(env, cfg, order, kym, castka, pozn) {
    const dni = dniZaCastku(cfg, castka);
    if (!dni) return 0;
    const r = await env.DB.prepare(
        'UPDATE orders SET paid_ts=?, paid_by=?, paid_amount=?, paid_note=?, dni=?, cancelled=0 WHERE vs=? AND paid_ts IS NULL')
        .bind(Date.now(), String(kym).slice(0, 24), castka | 0, String(pozn || '').slice(0, 200), dni, order.vs).run();
    if (!r || !r.meta || !r.meta.changes) return 0;
    const acc = await dbFirst(env, 'SELECT * FROM accounts WHERE id=?', order.acc_id);
    if (!acc) return 0;
    await zapniPro(env, acc, dni);
    return dni;
}

async function fioStav(env, k) {
    try { const r = await env.DB.prepare('SELECT v FROM fio_stav WHERE k=?').bind(k).first(); return r ? r.v : null; }
    catch (e) { return null; }
}
async function fioStavZapis(env, k, v) {
    try { await env.DB.prepare('INSERT OR REPLACE INTO fio_stav(k,v) VALUES(?,?)').bind(k, String(v)).run(); } catch (e) {}
}
function fioCol(t, n) { const c = t && t['column' + n]; return c && c.value != null ? c.value : null; }
function fioDen(ts) { return new Date(ts).toISOString().slice(0, 10); }

// Jeden průchod bankou. `duvod` je jen do protokolu. Vrací shrnutí pro konzoli.
// ⚠ Fio pustí JEDEN dotaz za 30 s na token (jinak 409) — proto se tu drží
//   razítko posledního dotazu a dřív než za 30 s se nejde znovu.
async function fioZkontroluj(env, duvod) {
    const out = { nastaveno: !!env.FIO_TOKEN, novych: 0, sparovano: 0, nezarazeno: 0, chyba: null, ts: Date.now() };
    if (!env.FIO_TOKEN) return out;
    await ensureProdejSchema(env);
    await ensureUctySchema(env);
    const posl = parseInt(await fioStav(env, 'posledni_dotaz'), 10) || 0;
    if (Date.now() - posl < 30e3) { out.chyba = 'Banka pustí jeden dotaz za 30 s — zkus to za chvíli.'; out.preskoceno = true; return out; }
    await fioStavZapis(env, 'posledni_dotaz', Date.now());
    const od = fioDen(Date.now() - 7 * 864e5), doD = fioDen(Date.now());
    const url = 'https://fioapi.fio.cz/v1/rest/periods/' + encodeURIComponent(env.FIO_TOKEN) + '/' + od + '/' + doD + '/transactions.json';
    let data = null;
    try {
        const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (r.status === 409) { out.chyba = 'Banka: moc dotazů za sebou (409).'; }
        else if (r.status === 500 || r.status === 422) { out.chyba = 'Banka odmítla token (' + r.status + ') — je FIO_TOKEN platný a má právo číst pohyby?'; }
        else if (!r.ok) { out.chyba = 'Banka odpověděla ' + r.status + '.'; }
        else data = await r.json();
    } catch (e) { out.chyba = 'Banka neodpověděla: ' + (e && e.message ? e.message : e); }
    await fioStavZapis(env, 'posledni_vysledek', JSON.stringify({ ts: Date.now(), duvod: duvod, chyba: out.chyba }));
    if (!data) return out;

    const cfg = prodejCfg(env);
    const list = (((data.accountStatement || {}).transactionList || {}).transaction) || [];
    for (const t of list) {
        const id = String(fioCol(t, 22) || '');
        const castka = Math.round(Number(fioCol(t, 1)) || 0);
        if (!id || castka <= 0) continue;                       // odchozí a nulové pohyby nezajímají
        const uz = await env.DB.prepare('SELECT id FROM fio_pohyby WHERE id=?').bind(id).first();
        if (uz) continue;
        const mena = String(fioCol(t, 14) || 'CZK');
        const vs = String(fioCol(t, 5) || '').replace(/\D/g, '');
        const msg = [fioCol(t, 16), fioCol(t, 7), fioCol(t, 25)].filter(Boolean).join(' | ').slice(0, 200);
        const protiucet = String(fioCol(t, 2) || '') + (fioCol(t, 3) ? '/' + fioCol(t, 3) : '');
        const nazev = String(fioCol(t, 10) || '').slice(0, 60);
        const tsP = Date.parse(String(fioCol(t, 0) || '')) || Date.now();
        out.novych++;

        let stav = 'nezarazeno', orderVs = null;
        if (mena === 'CZK') {
            // 1) podle variabilního symbolu — i zrušená objednávka: člověk mohl
            //    zaplatit starší QR (viz hlavička)
            let order = vs ? await env.DB.prepare('SELECT * FROM orders WHERE vs=?').bind(parseInt(vs, 10) || 0).first() : null;
            // 2) náhradně podle kódu účtu ve zprávě (kdo VS zapomněl, ale kód opsal)
            let acc = null;
            if (!order) {
                const m = msg.toUpperCase().match(/\b[A-HJ-NP-Z2-9]{8}\b/g) || [];
                for (const k of m) {
                    acc = await dbFirst(env, 'SELECT * FROM accounts WHERE code=?', k);
                    if (acc) break;
                }
                if (acc) order = await env.DB.prepare('SELECT * FROM orders WHERE acc_id=? AND paid_ts IS NULL AND cancelled=0 ORDER BY created DESC').bind(acc.id).first();
            }
            if (order && order.paid_ts) {
                // VS už zaplacený → člověk platí PODRUHÉ tímtéž QR (další měsíc).
                // Založit novou objednávku pod jeho účtem a zaplatit ji.
                acc = acc || await dbFirst(env, 'SELECT * FROM accounts WHERE id=?', order.acc_id);
                order = null;
            }
            if (!order && acc && dniZaCastku(cfg, castka)) {
                const nvs = novyVs();
                await env.DB.prepare('INSERT INTO orders(vs,acc_id,code,amount,dni,created,cancelled) VALUES(?,?,?,?,?,?,0)')
                    .bind(nvs, acc.id, acc.code, castka, dniZaCastku(cfg, castka), Date.now()).run();
                order = await env.DB.prepare('SELECT * FROM orders WHERE vs=?').bind(nvs).first();
            }
            if (order) {
                const dni = await objednavkaZaplacena(env, cfg, order, 'fio', castka, id);
                if (dni) { stav = 'sparovano'; orderVs = order.vs; out.sparovano++; }
                else { stav = 'podplaceno'; orderVs = order.vs; }
            }
        }
        if (stav === 'nezarazeno' || stav === 'podplaceno') out.nezarazeno++;
        await env.DB.prepare('INSERT OR IGNORE INTO fio_pohyby(id,ts,castka,mena,vs,msg,protiucet,nazev,stav,order_vs,seen) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
            .bind(id, tsP, castka, mena, vs, msg, protiucet, nazev, stav, orderVs, Date.now()).run();
    }
    await fioStavZapis(env, 'posledni_ok', Date.now());
    return out;
}

// totéž pro dotaz na VÍC řádků (seznam uživatelů se opírá o users.last_login)
async function dbAll(env, sql, ...bind) {
    try { return (await env.DB.prepare(sql).bind(...bind).all()).results; }
    catch (e) {
        await ensureOwnerSchema(env);
        return (await env.DB.prepare(sql).bind(...bind).all()).results;
    }
}
// zápis, který se taky může opřít o nový sloupec; selhání NESMÍ shodit požadavek
async function dbRunSoft(env, sql, ...bind) {
    try { await env.DB.prepare(sql).bind(...bind).run(); return true; }
    catch (e) {
        try { await ensureOwnerSchema(env); await env.DB.prepare(sql).bind(...bind).run(); return true; }
        catch (e2) { return false; }
    }
}
// dotaz oprývající se o nové sloupce; při selhání doplni schéma a zkusí znovu
async function dbFirst(env, sql, ...bind) {
    try { return await env.DB.prepare(sql).bind(...bind).first(); }
    catch (e) {
        await ensureOwnerSchema(env);
        return await env.DB.prepare(sql).bind(...bind).first();
    }
}
// brána konzole i schránky zpětné vazby: stejné tajemství, žádný firemní token.
// BRZDA NA HÁDÁNÍ: OWNER_KEY je ručně zvolené heslo a za dveřmi je mazání celých
// firem, takže deset pokusů z adresy za hodinu. Zamčený stav vrací guardHit ještě
// PŘED zápisem do D1, útok tedy po zamčení databázi nezatěžuje. Počítadlo se maže
// až po ÚSPĚŠNÉM ověření — jinak by si ho útočník každým pokusem sám čistil.
async function ownerGate(req, env, co) {
    const ip = req.headers.get('CF-Connecting-IP') || '0';
    const kl = 'own:' + ip;
    const ok = ownerOk(req, env);
    const kdo = co || 'Konzole';
    // ⚠ NENASTAVENY SERVER SE RESI DRIV NEZ BRZDA. Kdyz na serveru zadny OWNER_KEY
    // neni, neni co hadat — a kdyby se pocitadlo zvedalo uz tady, po deseti otevrenich
    // konzole by prestal chodit i navod, kvuli kteremu ta 503 vznikla, a misto nej by
    // prisla hlaska "Moc pokusu o klic". Pocitadlo je navic spolecne pro konzoli
    // i schranku zpetne vazby ('own:' + ip), takze se ty marne pokusy jeste scitaly.
    if (ok === null) {
        // Říct rovnou, KTERÝ z obou stavů to je — uživatel klíč 11. 9. 2026 „nastavoval
        // několikrát" a appka mu pořád tvrdila obojí najednou. Hodnota ven nejde.
        const st = ownerKeyStav(env);
        return err(503, kdo + ' není nastavená: ' + (st === 'kratky'
            ? 'OWNER_KEY na serveru JE, ale má míň než 24 znaků — worker tak krátký klíč odmítá.'
            : 'na serveru žádný OWNER_KEY není (secret chybí, nebo ho smazalo nasazení z GitHubu — ulož ho jako typ Secret, ne Text).')
            + ' (wrangler secret put OWNER_KEY)', { ownerKey: st });
    }
    let pusti = true;
    // brzda nesmí konzoli shodit (tabulka guard nemusí být v cizí databázi);
    // klíč se ověřuje dál i tehdy, když se počítadlo nepodaří přečíst
    try { pusti = await guardHit(env, kl, 10, 60 * 60e3); } catch (e) { pusti = true; }
    if (!pusti) return err(429, 'Moc pokusů o klíč. Zkus to za hodinu.');
    if (!ok) return err(403, 'Špatný klíč.');
    try { await guardClear(env, kl); } catch (e) {}
    return null;
}
// ---------------------------------------------------------------------------
// VLASTNÍK PLUS (12. 9. 2026, 13 schválených návrhů z artefaktu „Návrhy pro vlastníka")
// ---------------------------------------------------------------------------
//   owner_log  — deník vlastníka: co kdy zapnul/vypnul/smazal a komu (návrh „audit")
//   vzkazy     — vzkaz KONKRÉTNÍMU účtu nebo firmě (návrh „vzkaz"); chodí s /config
//                jako `vzkazy`, přečtení potvrzuje POST /vzkaz/precteno
//   accounts.note — poznámka vlastníka u účtu (návrh „pozn-ucet")
let _ownerPlusMig = false;
async function ensureOwnerPlusSchema(env) {
    if (_ownerPlusMig) return;
    const sqls = [
        'CREATE TABLE IF NOT EXISTS owner_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, '
        + 'akce TEXT NOT NULL, cil TEXT, detail TEXT)',
        'CREATE INDEX IF NOT EXISTS idx_ownerlog_ts ON owner_log(ts)',
        'CREATE TABLE IF NOT EXISTS vzkazy (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, '
        + 'acc_id TEXT, firm_id TEXT, txt TEXT NOT NULL, read_ts INTEGER)',
        'CREATE INDEX IF NOT EXISTS idx_vzkazy_acc ON vzkazy(acc_id, read_ts)',
        'CREATE INDEX IF NOT EXISTS idx_vzkazy_firm ON vzkazy(firm_id, read_ts)',
        'ALTER TABLE accounts ADD COLUMN note TEXT'
    ];
    for (const q of sqls) { try { await env.DB.prepare(q).run(); } catch (e) {} }
    _ownerPlusMig = true;
}
// Zápis do deníku NIKDY nesmí shodit akci, kvůli které vznikl — proto try/catch a
// ctx.waitUntil, kde je k dispozici (jinak se počká, D1 zápis je levný).
async function ownerLog(env, akce, cil, detail) {
    try {
        await ensureOwnerPlusSchema(env);
        await env.DB.prepare('INSERT INTO owner_log(ts,akce,cil,detail) VALUES(?,?,?,?)')
            .bind(Date.now(), String(akce).slice(0, 40), cil == null ? null : String(cil).slice(0, 120),
                detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500)).run();
    } catch (e) {}
}
// Nepřečtené vzkazy pro přihlášeného člověka (účet NEBO jeho firma). Chodí s /config.
async function vzkazyPro(env, me) {
    try {
        await ensureOwnerPlusSchema(env);
        const rows = await dbAll(env,
            'SELECT id, ts, txt, acc_id, firm_id FROM vzkazy WHERE read_ts IS NULL AND ((acc_id IS NOT NULL AND acc_id=?) OR (firm_id IS NOT NULL AND firm_id=?)) ORDER BY ts DESC LIMIT 10',
            me.accId || '', me.firm_id || '');
        return (rows || []).map(r => ({ id: r.id, ts: r.ts, txt: r.txt, komu: r.acc_id ? 'ty' : 'firma' }));
    } catch (e) { return []; }
}

// otisk zakladatele — podepsaná IP, ne IP sama (v databázi tak neleží adresa)
async function founderId(env, req) {
    const ip = req.headers.get('CF-Connecting-IP') || '0';
    return (await hmac(env, 'founder:' + ip)).slice(0, 16);
}
// smazání firmy i všeho, co k ní patří (tabulky, které ještě nevznikly, se přeskočí)
async function dropFirm(env, id) {
    const tabs = ['users', 'usage', 'chat', 'sync_points', 'jobs', 'firm_requests',
        'stats_firm', 'pos', 'watch_codes', 'watch_seq', 'watch_pending', 'watch_tiles', 'watch_sel'];
    for (const t of tabs) {
        try { await env.DB.prepare('DELETE FROM ' + t + ' WHERE firm_id=?').bind(id).run(); } catch (e) {}
    }
    await env.DB.prepare('DELETE FROM firms WHERE id=?').bind(id).run();
}

// ---- živá synchronizace bodů (klient js/cloud-sync.js) ---------------------
// Tabulka se založí sama při prvním použití (idempotentní CREATE IF NOT EXISTS,
// jednou za život izolace) — nasazení nového worker.js tedy NEVYŽADUJE ruční
// SQL migraci. Řádek = poslední známý stav bodu v zakázce (job_key = název
// zakázky normalizovaný klientem): ts = čas změny na zařízení (last-write-wins),
// srv = čas zápisu na serveru (kurzor stahování — nezávislý na hodinách mobilů),
// deleted = náhrobek (bod smazán; drží se, ať se mazání doručí všem zařízením).
let _syncReady = false;
async function ensureSyncTable(env) {
    if (_syncReady) return;
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS sync_points (' +
        'firm_id TEXT NOT NULL, job_key TEXT NOT NULL, point_id TEXT NOT NULL, ' +
        'data TEXT, ts INTEGER NOT NULL, srv INTEGER NOT NULL, ' +
        'deleted INTEGER NOT NULL DEFAULT 0, uname TEXT, ' +
        'PRIMARY KEY (firm_id, job_key, point_id))').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sync_firm_job_srv ON sync_points(firm_id, job_key, srv)').run();
    _syncReady = true;
}

// ---- hodinky Garmin (garmin/hodinky) --------------------------------------
// Hodinky se NEMOHOU přihlásit — nemají klávesnici. Proto párovací kód:
// v mobilu se vygeneruje šestimístný kód, ten se do hodinek napíše v Garmin
// Connect (nastavení aplikace) a hodinky si za něj vymění dlouhodobý token.
// Token je úplně stejný jako uživatelský, jen navíc nese zakázku (j), aby
// hodinky nemohly sáhnout jinam než tam, kam byly spárované.
//
// Body se ukládají do TÉŽE tabulky sync_points jako z mobilu, ve stejném
// tvaru — takže se v aplikaci objeví samy, bez dalšího zařizování.
let _watchReady = false;
async function ensureWatchTables(env) {
    if (_watchReady) return;
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS watch_codes (' +
        'code TEXT PRIMARY KEY, firm_id TEXT NOT NULL, user_id TEXT NOT NULL, ' +
        'job_key TEXT NOT NULL, exp INTEGER NOT NULL)').run();
    // čísla bodů: hodinky si rezervují blok dopředu, aby se offline
    // nevyrobily dva body se stejným číslem
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS watch_seq (' +
        'firm_id TEXT NOT NULL, job_key TEXT NOT NULL, next INTEGER NOT NULL, ' +
        'PRIMARY KEY (firm_id, job_key))').run();
    // OPAČNÝ SMĚR PÁROVÁNÍ: kód si vyžádají hodinky a ukážou ho na displeji,
    // člověk ho opíše v mobilu. Vzniklo to z nutnosti — nahraná aplikace se
    // v Garmin Connect neobjeví, takže do jejího nastavení se nedá nic napsat
    // a kód se do hodinek jinak nedostane. Vedlejší efekt je lepší ovládání:
    // píše se na zařízení, které má klávesnici.
    //   secret drží jen hodinky; kód na displeji je veřejný, takže samotný
    //   kód nesmí stačit k vyzvednutí tokenu.
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS watch_pending (' +
        'code TEXT PRIMARY KEY, secret TEXT NOT NULL, exp INTEGER NOT NULL, ' +
        'firm_id TEXT, user_id TEXT, job_key TEXT)').run();
    _watchReady = true;
}

// Dlaždice podkladu pro hodinky.
//
// ⚠ SERVER JE POUZE SKLAD, NIC NEPOČÍTÁ. Free plán dává 10 ms procesoru na
// požadavek a rozebrat skoro dvoumegovou odpověď z OpenStreetMap a zjednodušit
// ji by ten strop rozmetalo. Dlaždice proto vyrábí MOBIL (js/hodinky-dlazdice.js)
// a sem je jen ukládá; hodinky si je pak stahují.
//
// Klíč dlaždice = kotva zaokrouhlená na 0,005° (v ČR asi 560 × 360 m). Dlaždice
// pokrývá poloměr 450 m kolem kotvy, takže sousedi se překrývají a na hranici
// mezi nimi nevznikne díra.
const TILE_KROK = 0.005;
function tileKlic(lat, lon) {
    return Math.round(lat / TILE_KROK) + '_' + Math.round(lon / TILE_KROK);
}

let _tilesReady = false;
async function ensureTileTable(env) {
    if (_tilesReady) return;
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS watch_tiles (' +
        'firm_id TEXT NOT NULL, k TEXT NOT NULL, data TEXT NOT NULL, ts INTEGER NOT NULL, ' +
        'PRIMARY KEY (firm_id, k))').run();
    // Výběr bodů pro hodinky: co si člověk v mobilu odklikl, že chce s sebou.
    // Bez výběru se posílá prostě nejbližší okolí — ale vybrat je lepší,
    // protože „nejbližší" nemusí být „ty, kvůli kterým tam jedu".
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS watch_sel (' +
        'firm_id TEXT NOT NULL, job_key TEXT NOT NULL, ids TEXT NOT NULL, ts INTEGER NOT NULL, ' +
        'PRIMARY KEY (firm_id, job_key))').run();
    _tilesReady = true;
}

function watchKod() {
    // bez O/0 a I/1/L — kód se opisuje z malého displeje
    const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const a = new Uint8Array(6);
    crypto.getRandomValues(a);
    let k = '';
    for (let i = 0; i < 6; i++) k += ABC[a[i] % ABC.length];
    return k;
}

const WATCH_DAYS = 180;
const WATCH_BLOK = 50;          // kolik čísel dostanou hodinky na jedno spárování

async function makeWatchToken(env, user, job) {
    const payload = b64u(JSON.stringify({
        u: user.user_id || user.id, f: user.firm_id, j: job,
        exp: Date.now() + WATCH_DAYS * 864e5
    }));
    return payload + '.' + await hmac(env, payload);
}

// zakázka, na kterou je token spárovaný (null u běžného uživatelského tokenu)
async function watchJob(env, req) {
    const p = await readToken(env, req);
    return (p && typeof p.j === 'string' && p.j) ? p.j : null;
}

// rezervace bloku čísel; vrací [od, do]
async function watchBlok(env, firmId, job) {
    const row = await env.DB.prepare('SELECT next FROM watch_seq WHERE firm_id=? AND job_key=?')
        .bind(firmId, job).first();
    const od = (row && row.next) ? row.next : 1;
    await env.DB.prepare('INSERT INTO watch_seq(firm_id,job_key,next) VALUES(?,?,?) ' +
        'ON CONFLICT(firm_id,job_key) DO UPDATE SET next=excluded.next')
        .bind(firmId, job, od + WATCH_BLOK).run();
    return [od, od + WATCH_BLOK - 1];
}

// ---- registr zakázek firmy (klient js/zakazky-cloud.js) --------------------
// Aby se zakázka nezakládala ručně na každém telefonu: kdo ji založí, ohlásí ji
// sem a ostatní zařízení firmy ji uvidí a doplní si ji k sobě. Klíč zakázky je
// STEJNÝ jako u synchronizace bodů (job_key = normalizovaný název), takže se
// registr a body drží pohromadě bez další mapovací tabulky.
//   acl  = JSON pole id uživatelů, kteří na zakázku smí; NULL / [] = všichni
//   ts   = čas změny na zařízení, srv = čas zápisu na serveru (kurzor)
// Přejmenování se ZÁMĚRNĚ nesynchronizuje: název je klíč, takže by přejmenování
// rozpojilo body. Nová jméno = nová zakázka; staré jde archivovat (deleted).
let _jobsReady = false;
async function ensureJobsTable(env) {
    if (_jobsReady) return;
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS jobs (' +
        'firm_id TEXT NOT NULL, job_key TEXT NOT NULL, name TEXT NOT NULL, ' +
        'acl TEXT, ts INTEGER NOT NULL, srv INTEGER NOT NULL, ' +
        'deleted INTEGER NOT NULL DEFAULT 0, uname TEXT, ' +
        'PRIMARY KEY (firm_id, job_key))').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_jobs_firm_srv ON jobs(firm_id, srv)').run();
    _jobsReady = true;
}
// vidí uživatel zakázku? (admin i vedení vidí vše — potřebují přehled firmy)
function jobVisible(row, me) {
    if (me.role === 'admin' || me.role === 'vedeni') return true;
    if (!row.acl) return true;
    try {
        const a = JSON.parse(row.acl);
        return !Array.isArray(a) || !a.length || a.indexOf(me.id) !== -1;
    } catch (e) { return true; }
}
// Smí přihlášený sáhnout na zakázku? Ptá se registru `jobs` — a ten řádek NEMUSÍ
// existovat. Neznámá zakázka se propouští, jinak by kontrola rozbila stávající
// sdílení. Klíč zakázky přitom není tajemství (je to jen název malými písmeny),
// takže bez téhle brány si vyřazený zaměstnanec stáhl i přepsal cizí body pouhým
// uhodnutím názvu.
//
// ⚠⚠ REGISTR `jobs` DNES NIKDO NEPLNÍ, takže brána zatím propouští VŽDYCKY.
// Jediný klient, který na POST /jobs a PATCH /jobs/<key> uměl sáhnout, byl
// js/zakazky-cloud.js a ten je smazaný (commit 77aada6) — přidělování zakázek
// lidem žije v localStorage (`agProjAcl_v1`, js/ucty.js). Kolej je tedy položená,
// ale vlak po ní zatím nejede: v hlášení k vydání se to nesmí psát jako „opraveno",
// jen jako „připraveno, čeká na registr zakázek".
// ⚠ Klienta nezapojovat narychlo: fail-open v js/ucty.js překládá „nemá nic
// přiděleno" na „vidí všechno" a přesně proto je js/zakazky-cloud.js dodnes mimo.
// Ostrá se brána stane až s klientem, který rozliší „bez omezení" od „nic přiděleno".
async function jobAllowed(env, me, job) {
    if (me.role === 'admin' || me.role === 'vedeni') return true;
    let row = null;
    try {
        await ensureJobsTable(env);
        row = await env.DB.prepare('SELECT acl FROM jobs WHERE firm_id=? AND job_key=?')
            .bind(me.firm_id, job).first();
    } catch (e) { return true; }   // registr ještě nevznikl → nezavírat dveře
    return !row || jobVisible(row, me);
}

// ---- živá poloha lidí ve firmě (klient js/vysilacka.js) --------------------
// ZÁMĚRNĚ NENÍ ŽURNÁL: jeden řádek na uživatele, který se přepisuje (UPSERT).
// Kdyby se poloha psala jako zprávy do /chat, vytlačila by z historie skutečné
// zprávy (server drží posledních ~500) a tabulka by rostla donekonečna. Takhle
// má tabulka nejvýš tolik řádků, kolik má firma lidí, a stará poloha se sama
// přepíše novou. Historie stopy tu ZÁMĚRNĚ není — vysílačka odpovídá na otázku
// „kde je kolega teď", ne „kudy dneska chodil" (to je sledování zaměstnanců).
//   st  = krátký stav („měřím", „hledám bod", …), sos = 1 při nouzi (Man Down)
let _posReady = false;
async function ensurePosTable(env) {
    if (_posReady) return;
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS pos (' +
        'firm_id TEXT NOT NULL, uid TEXT NOT NULL, uname TEXT, ' +
        'lat REAL, lng REAL, acc REAL, st TEXT, job TEXT, ' +
        'sos INTEGER NOT NULL DEFAULT 0, sos_ts INTEGER, ' +
        'ts INTEGER NOT NULL, PRIMARY KEY (firm_id, uid))').run();
    _posReady = true;
}

async function lastActiveAdminGuard(env, firmId, exceptUserId) {
    // vrací true, když po vyřazení exceptUserId zůstane aspoň jeden aktivní admin
    const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM users WHERE firm_id=? AND role='admin' AND disabled=0 AND id<>?")
        .bind(firmId, exceptUserId).first();
    return row.n > 0;
}

// ---------------------------------------------------------------------------
// ČHMÚ — naměřené hodnoty z nejbližší české stanice
// ---------------------------------------------------------------------------
// Proč přes worker: opendata.chmi.cz NEPOSÍLÁ hlavičku Access-Control-Allow-Origin,
// takže prohlížeč z něj nepřečte nic. Navíc jsou soubory velké (seznam stanic 75 kB,
// desetiminutovky jedné stanice až 190 kB/den) — do mobilu by to byla zbytečná
// stahovka. Worker tedy data stáhne, najde nejbližší stanici, vybere poslední platné
// hodnoty a pošle ~1 kB. Route je veřejná (bez tokenu): počasí není firemní data.
// Podmínky ČHMÚ: data zdarma s uvedením zdroje — atribuce „© ČHMÚ" je v appce
// v rozbalovacím seznamu zdrojů pod předpovědí.
const CHMI_BASE = 'https://opendata.chmi.cz/meteorology/climate/now/';
const CHMI_MAX_KM = 60;          // dál od stanice už měření tohle místo nepopisuje
// ⚠ 8.8.2026: TENHLE LIMIT BYL 2 h A TICHO SHAZOVAL CELÉ REGIONY.
// Stanice ČHMÚ nepublikují stejně rychle: v 15:09Z měla Praha-Karlov nejnovější
// záznam z 13:50Z (80 min), ale Ostrava, Brno i Olomouc jen z 13:00Z (130 min).
// Přes dvouhodinový strop tedy Praha prošla a zbytek republiky hlásil „žádná
// stanice v okolí nehlásí" — přitom stanice hlásily, jen o půl hodiny pozadu.
// Volnější strop nic nezkazí: appka si stáří měření sama odváží (nad 80 min mu
// nechá třetinu váhy), takže starší odečet do průměru skoro nemluví — ale
// nesmí zmizet, protože je to jediná SKUTEČNĚ NAMĚŘENÁ hodnota v celé směsi
// a jen proti ní se dá poctivě měřit trefnost modelů.
const CHMI_MAX_AGE_MS = 3.5 * 3600e3;
const CHMI_CAND = 6;             // kolik nejbližších stanic zkusit (viz níž)
const CHMI_ELEMS = { T: 1, H: 1, P: 1, F: 1, Fmax: 1, D: 1, SRA10M: 1 };

// ⚠⚠ 8.8.2026: TENHLE PŘEVOD MĚL TICHOU CHYBU, KTERÁ VYRÁBĚLA 0 °C.
// ČHMÚ u dosud nenaměřených desetiminutovek posílá `VAL` jako PRÁZDNÝ ŘETĚZEC
// (s QUALITY 4), ne jako null. Kontrola `val == null` na prázdný řetězec NESEDNE
// (`'' == null` je false), takže hodnota prošla dál — a `Number('')` je **0**.
// Z „ještě neměřím" se tak stala nula: stanice Kostelní Myslová hlásila
// v srpnu odpoledne T=0, H=0, P=0, F=0 (ověřeno na ostrých datech).
// Bylo to nebezpečné, protože měření má v appce NEJVYŠŠÍ VÁHU z celé směsi:
// stáhlo by celý vážený průměr, ukázalo „Naměřeno ČHMÚ 0 °C" a hlavně by tou
// nulou na měsíc znečistilo učení systematické chyby i trefnosti modelů, které
// se proti naměřené hodnotě poměřují.
// Proto se hodnota bere jen tehdy, když je to OPRAVDU ČÍSLO.
function chmiNum(val) {
    if (val == null) return null;
    if (typeof val === 'string' && val.trim() === '') return null;
    const n = Number(val);
    return isFinite(n) ? n : null;
}

function chmiDayStr(offsetDays) {
    return new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
}
async function chmiFetch(url, ttl) {
    // cf.cacheTtl = kolik sekund drží odpověď edge cache Cloudflare; seznam stanic
    // se mění jednou denně, desetiminutovky po deseti minutách
    const r = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
}
function chmiRows(j) {
    const d = j && j.data && j.data.data;
    return (d && Array.isArray(d.values)) ? d.values : [];
}
function kmBetween(aLat, aLon, bLat, bLon) {
    const R = 6371, dLa = (bLat - aLat) * Math.PI / 180, dLo = (bLon - aLon) * Math.PI / 180;
    const x = Math.sin(dLa / 2) ** 2 +
        Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
// nejbližší české stanice (seřazené) — seznam obsahuje i zahraniční, ty vynech
async function chmiStations(lat, lon) {
    let meta = null;
    for (const off of [0, -1]) {          // po půlnoci UTC nemusí být dnešek ještě nahraný
        try { meta = await chmiFetch(CHMI_BASE + 'metadata/meta1-' + chmiDayStr(off) + '.json', 21600); break; }
        catch (e) { meta = null; }
    }
    if (!meta) return [];
    const out = [];
    for (const r of chmiRows(meta)) {
        // WSI, GH_ID, FULL_NAME, GEOGR1 (zem. délka), GEOGR2 (šířka), ELEVATION, BEGIN_DATE
        const wsi = r[0], name = r[2], slon = Number(r[3]), slat = Number(r[4]), elev = Number(r[5]);
        if (!wsi || !isFinite(slat) || !isFinite(slon)) continue;
        if (slat < 48.4 || slat > 51.2 || slon < 12 || slon > 19) continue;   // jen ČR
        out.push({ wsi, name, lat: slat, lon: slon, elev: isFinite(elev) ? elev : null, km: kmBetween(lat, lon, slat, slon) });
    }
    out.sort((a, b) => a.km - b.km);
    return out;
}
// poslední platné hodnoty jedné stanice; vrací null, když stanice dnes nic neposlala
async function chmiLatest(wsi) {
    let rows = [];
    for (const off of [0, -1]) {
        try {
            const j = await chmiFetch(CHMI_BASE + 'data/10m-' + wsi + '-' + chmiDayStr(off) + '.json', 300);
            rows = chmiRows(j);
            if (rows.length) break;
        } catch (e) { rows = []; }
    }
    if (!rows.length) return null;
    const last = {}, rain = [];
    for (const r of rows) {
        const el = r[1], dt = r[2], val = r[3], q = Number(r[5]);
        if (!CHMI_ELEMS[el] || dt == null) continue;
        if (q === 2) continue;                       // „zatím nepoužívat" podle ČHMÚ
        const v = chmiNum(val);
        if (v == null) continue;                     // viz chmiNum — POZOR na prázdný řetězec
        const ts = Date.parse(dt);
        if (!isFinite(ts)) continue;
        if (el === 'SRA10M') rain.push([ts, v]);
        if (!last[el] || ts > last[el][0]) last[el] = [ts, v];
    }
    if (!last.T && !last.F && !last.H) return null;
    // čas měření = nejnovější z odečtených veličin
    let newest = 0;
    for (const k in last) { if (last[k][0] > newest) newest = last[k][0]; }
    if (!newest || Date.now() - newest > CHMI_MAX_AGE_MS) return null;
    // srážky za poslední hodinu = součet desetiminutovek v okně 60 min
    let p1h = null;
    const win = rain.filter(x => x[0] > newest - 3600e3 && x[0] <= newest && isFinite(x[1]));
    if (win.length) p1h = Math.round(win.reduce((a, x) => a + x[1], 0) * 100) / 100;
    const g = k => (last[k] && isFinite(last[k][1])) ? last[k][1] : null;
    return { t: Math.round(newest / 1000), T: g('T'), H: g('H'), P: g('P'), F: g('F'), Fmax: g('Fmax'), D: g('D'), precip1h: p1h };
}

// hodinová řada naměřených hodnot za posledních `days` dní — proti ní si appka
// ověřuje, jak se který model doopravdy trefil (viz chmiVerify v js/pocasi.js).
// Teplota = odečet nejbližší celé hodině, srážky = součet desetiminutovek za
// PŘEDCHOZÍ hodinu (tak je definovaná i hodinová srážka u modelů, ať se to srovnává
// se stejně definovaným číslem).
async function chmiHours(wsi, days) {
    const T = {}, R = {};
    for (let off = 0; off > -days; off--) {
        let rows = [];
        try { rows = chmiRows(await chmiFetch(CHMI_BASE + 'data/10m-' + wsi + '-' + chmiDayStr(off) + '.json', 600)); }
        catch (e) { continue; }
        for (const r of rows) {
            const el = r[1], dt = r[2], val = r[3], q = Number(r[5]);
            if (dt == null || q === 2) continue;
            if (el !== 'T' && el !== 'SRA10M') continue;
            const v = chmiNum(val);
            if (v == null) continue;                 // viz chmiNum
            const ts = Date.parse(dt);
            if (!isFinite(ts)) continue;
            if (el === 'T') {
                // ke které celé hodině odečet patří (±30 min) a jak je od ní daleko
                const hr = Math.round(ts / 3600e3) * 3600e3;
                const d = Math.abs(ts - hr);
                if (!T[hr] || d < T[hr][1]) T[hr] = [v, d];
            } else {
                // srážka spadlá v (h−1, h] se počítá k hodině h
                const hr = Math.ceil(ts / 3600e3) * 3600e3;
                R[hr] = (R[hr] || 0) + v;
            }
        }
    }
    const keys = {};
    for (const k in T) keys[k] = 1;
    for (const k in R) keys[k] = 1;
    const out = [];
    for (const k of Object.keys(keys).sort()) {
        const t = Number(k);
        out.push([Math.round(t / 1000),
            T[k] ? Math.round(T[k][0] * 10) / 10 : null,
            R[k] != null ? Math.round(R[k] * 100) / 100 : null]);
    }
    return out;
}

// ---------------------------------------------------------------------------
// hlavní router
// ---------------------------------------------------------------------------
export default {
    async fetch(req, env, ctx) {
        // denní počítadlo požadavků (VČETNĚ preflightů — ty se do limitu počítají
        // taky); na pozadí, aby nezdržovalo a jeho chyba neshodila API
        try {
            const day = new Date().toISOString().slice(0, 10);
            const p = env.DB.prepare('INSERT INTO stats(day,n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1')
                .bind(day).run().catch(() => {});
            if (ctx && ctx.waitUntil) ctx.waitUntil(p);
            // občasný úklid na pozadí (retence): užívání ~12 měsíců, čítač 60 dní
            if (Math.random() < 0.02 && ctx && ctx.waitUntil) {
                ctx.waitUntil(env.DB.prepare('DELETE FROM usage WHERE ts<?')
                    .bind(Date.now() - 370 * 864e5).run().catch(() => {}));
                ctx.waitUntil(env.DB.prepare('DELETE FROM stats WHERE day<?')
                    .bind(new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)).run().catch(() => {}));
                ctx.waitUntil(env.DB.prepare('DELETE FROM stats_firm WHERE day<?')
                    .bind(new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)).run().catch(() => {}));
                // chyby starsi nez 90 dni uz nikomu nic nereknou (a ta tabulka roste nejrychleji)
                ctx.waitUntil(env.DB.prepare('DELETE FROM errors WHERE ts<?')
                    .bind(Date.now() - 90 * 864e5).run().catch(() => {}));
            }
        } catch (e) {}
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        const url = new URL(req.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';
        try {
            // v = verze API; klient podle ní pozná, že na serveru běží starý kód
            // (chybějící v = původní nasazení bez chatu/statistik/zálohy)
            // watch:true = tenhle worker uz umi /watch/* (parovani hodinek, body, dlazdice).
            // Starsi nasazeny worker tuhle polozku nema, takze podle ni pozna appka,
            // ze na serveru bezi stara verze — viz js/hodinky-parovani.js.
            //
            // v:12 = prodej Pro: /objednavky, /owner/objednavky, /owner/blokace, cron s Fio.
            // v:7 = /feedback (schranka na vzkazy, bez tokenu) + /owner/* (konzole vlastnika).
            // v:6 = bezpecnostni zmena z 9bc1401 (brzda prihlaseni
            //       na TRI klice vcetne IP, aby kolegovi nesel zamknout ucet, a
            //       odpoved /login uz neposila offline overovadlo z databaze).
            //
            // ⚠ `v` JE JEDINY ZPUSOB, JAK ZVENCI POZNAT, CO JE OPRAVDU NASAZENE:
            // vsechny ostatni cesty vraci 401 DRIV, nez se worker podiva na cestu,
            // takze ani neexistujici endpoint se nepozna od nenasazeneho. Kdyz se
            // worker.js zmeni tak, ze na tom klientovi zalezi, BUMPNI `v` — a po
            // nasazeni to overi:  python scripts/check_worker_deployed.py
            if (req.method === 'GET' && path === '/health') return json({ ok: true, ts: Date.now(), v: 15, wx: true, watch: true, fb: true, owner: true, ownerKey: ownerKeyStav(env), seen: true, flags: true, errors: true, acl: true, accepted: true, ucty: true, tarify: true, prodej: true, zadosti: true });

            // ---------------- ČHMÚ: měření z nejbližší stanice ---------------
            // veřejné (bez tokenu) — počasí není firemní údaj
            if (req.method === 'GET' && path === '/wx/chmi') {
                const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
                if (!isFinite(lat) || !isFinite(lon)) return err(400, 'Chybí lat / lon.');
                if (lat < 48.4 || lat > 51.2 || lon < 12 || lon > 19) return json({ ok: false, reason: 'mimo ČR' });
                const st = await chmiStations(lat, lon);
                if (!st.length) return json({ ok: false, reason: 'seznam stanic ČHMÚ není dostupný' });
                // Nejbližší stanice nemusí zrovna hlásit → zkus pár dalších v okolí.
                // Kandidátů je 6, ne 4: seznam `meta1` má 758 stanic, ale desetiminutová
                // data z nich publikuje jen 475 — u Brna je první použitelná až TŘETÍ
                // v pořadí (Židenice a Jundrov soubor vůbec nemají), u Olomouce druhá.
                //
                // A hlavně: NEBER PRVNÍ STANICI, KTERÁ VRÁTÍ COKOLI. Stanice měří různé
                // veličiny — Ostrava-Zábřeh (3,9 km) má teplotu a vlhkost, ale žádný tlak
                // ani vítr, zatímco Ostrava-Poruba (7,4 km) má vítr i tlak, ale ŽÁDNOU
                // TEPLOTU. Dřív rozhodla vzdálenost, takže se klidně vrátil odečet bez
                // teploty — a teplota je přitom ta hodnota, která drží celý vážený průměr
                // a na které se učí systematická chyba modelů.
                // Proto: první stanice s teplotou vyhrává hned, stanice bez teploty se
                // odloží jako záloha a hledá se dál. Rychlé to zůstává, protože nejbližší
                // stanice teplotu obvykle má (Praha i Ostrava hned na první pokus).
                //
                // Hodnoty ze DVOU stanic se ZÁMĚRNĚ neslučují (teplota odsud, tlak odtamtud):
                // appka to ukazuje jako měření jedné konkrétní stanice a míchanina by
                // vydávala dopočet za měření.
                let fallback = null;
                for (const cand of st.slice(0, CHMI_CAND)) {
                    if (cand.km > CHMI_MAX_KM) break;
                    const v = await chmiLatest(cand.wsi);
                    if (!v) continue;
                    const hit = {
                        ok: true,
                        station: { wsi: cand.wsi, name: cand.name, lat: cand.lat, lon: cand.lon, elev: cand.elev },
                        distKm: Math.round(cand.km * 10) / 10,
                        source: '© ČHMÚ'
                    };
                    if (v.T != null) return json(Object.assign(hit, v));
                    if (!fallback) fallback = Object.assign(hit, v);
                }
                if (fallback) return json(fallback);
                return json({ ok: false, reason: 'žádná stanice ČHMÚ v okolí právě nehlásí' });
            }

            // ---------------- ČHMÚ: hodinová řada za posledních pár dní -------
            // slouží k ověřování trefnosti modelů proti skutečnosti (taky veřejné)
            if (req.method === 'GET' && path === '/wx/chmi/day') {
                const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
                if (!isFinite(lat) || !isFinite(lon)) return err(400, 'Chybí lat / lon.');
                if (lat < 48.4 || lat > 51.2 || lon < 12 || lon > 19) return json({ ok: false, reason: 'mimo ČR' });
                const days = Math.max(1, Math.min(3, parseInt(url.searchParams.get('days'), 10) || 2));
                const st = await chmiStations(lat, lon);
                if (!st.length) return json({ ok: false, reason: 'seznam stanic ČHMÚ není dostupný' });
                // Stejný důvod jako u /wx/chmi: víc kandidátů a přednost stanici, která
                // opravdu měří TEPLOTU. Řada se používá k ověřování trefnosti modelů, a
                // srážkoměrná stanice sice projde kontrolou na počet řádků (má srážky),
                // ale teplotu v nich má všude null — takže by se teplotní trefnost
                // nevyhodnotila vůbec a nebylo by poznat, proč.
                let fbDay = null;
                for (const cand of st.slice(0, CHMI_CAND)) {
                    if (cand.km > CHMI_MAX_KM) break;
                    const hours = await chmiHours(cand.wsi, days);
                    if (hours.length < 6) continue;      // stanice prakticky nehlásí
                    const res = {
                        ok: true,
                        station: { wsi: cand.wsi, name: cand.name, lat: cand.lat, lon: cand.lon, elev: cand.elev },
                        distKm: Math.round(cand.km * 10) / 10,
                        source: '© ČHMÚ',
                        hours: hours
                    };
                    let nT = 0;
                    for (const h of hours) { if (h[1] != null) nT++; }
                    if (nT >= 6) return json(res);
                    if (!fbDay) fbDay = res;
                }
                if (fbDay) return json(fbDay);
                return json({ ok: false, reason: 'žádná stanice ČHMÚ v okolí nemá dost dat' });
            }

            // ---------------- zpětná vazba: PSANÍ (bez přihlášení) -----------
            // Viz komentář u ensureFeedbackTable(). Limity jsou schválně měkké:
            // 20 zpráv z jedné adresy za den stačí i tomu, kdo posílá jednu chybu
            // za druhou, a přitom to nedovolí zahltit schránku.
            if (req.method === 'POST' && path === '/feedback') {
                await ensureFeedbackTable(env);
                const ip = req.headers.get('CF-Connecting-IP') || '0';
                if (!await guardHit(env, 'fb:' + ip, 20, 864e5))
                    return err(429, 'Z tohoto zařízení už dnes odešlo hodně zpráv. Zkus to zítra.');
                const b = await req.json().catch(() => null);
                const txt = b && typeof b.txt === 'string' ? b.txt.trim().slice(0, 4000) : '';
                if (!txt) return err(400, 'Prázdná zpráva.');
                // 'pro' = ŽÁDOST O VERZI PRO (12. 9. 2026). Pro se neprodává samo — člověk
                // o ni z karty Verze Pro POŽÁDÁ a vlastník mu ji zapne v konzoli Lidé
                // a prodej (záložka Žádosti). Kód účtu jde v `meta.ucet`, ať vlastník
                // nemusí hledat, komu Pro zapnout.
                const kind = ['chyba', 'napad', 'pochvala', 'jine', 'pro'].indexOf(String(b.kind || '')) >= 0 ? String(b.kind) : 'jine';
                const contact = b.contact ? String(b.contact).trim().slice(0, 120) : null;
                // meta = dobrovolné údaje o zařízení (verze appky, telefon, prohlížeč).
                // Ukládá se jako řetězec, ne rozparsované — ať se schéma nemusí měnit
                // pokaždé, když klient přidá další údaj.
                const meta = b.meta ? JSON.stringify(b.meta).slice(0, 1500) : null;
                const who = b.who ? String(b.who).trim().slice(0, 80) : null;
                await env.DB.prepare('INSERT INTO feedback(ts,kind,txt,contact,meta,who,done) VALUES(?,?,?,?,?,?,0)')
                    .bind(Date.now(), kind, txt, contact, meta, who).run();
                return json({ ok: true, ts: Date.now() });
            }

            // ---------------- zpětná vazba: ČTENÍ (jen vlastník) -------------
            if (req.method === 'GET' && path === '/feedback') {
                const brana = await ownerGate(req, env, 'Schránka');
                if (brana) return brana;
                await ensureFeedbackTable(env);
                const only = url.searchParams.get('stav');       // '' | 'open' | 'done'
                const before = parseInt(url.searchParams.get('before'), 10) || 0;
                let sql = 'SELECT id, ts, kind, txt, contact, meta, who, done FROM feedback WHERE 1=1';
                const args = [];
                if (only === 'open') sql += ' AND done=0';
                else if (only === 'done') sql += ' AND done=1';
                if (before > 0) { sql += ' AND id<?'; args.push(before); }
                sql += ' ORDER BY id DESC LIMIT 60';
                const rows = (await env.DB.prepare(sql).bind(...args).all()).results;
                const open = (await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE done=0').first()) || { n: 0 };
                return json({ messages: rows, open: open.n, serverTime: Date.now() });
            }

            // Odbavení zprávy (vyřízeno / zpět mezi nevyřízené) a smazání.
            if (req.method === 'POST' && path === '/feedback/done') {
                const brana2 = await ownerGate(req, env, 'Schránka');
                if (brana2) return brana2;
                await ensureFeedbackTable(env);
                const b = await req.json().catch(() => null);
                const id = b && parseInt(b.id, 10);
                if (!id) return err(400, 'Chybí id.');
                if (b.smazat) await env.DB.prepare('DELETE FROM feedback WHERE id=?').bind(id).run();
                else await env.DB.prepare('UPDATE feedback SET done=? WHERE id=?').bind(b.done ? 1 : 0, id).run();
                await ownerLog(env, b.smazat ? 'zprava-smazat' : (b.done ? 'zprava-vyrizeno' : 'zprava-zpet'), String(id));
                return json({ ok: true });
            }

            // ---------------- registrace firmy ------------------------------
            if (req.method === 'POST' && path === '/firms') {
                const ip = req.headers.get('CF-Connecting-IP') || '?';
                if (!await guardHit(env, 'reg:' + ip, 5, 864e5)) return err(429, 'Příliš mnoho registrací z této adresy, zkus to zítra.');
                const b = await req.json().catch(() => null);
                if (!b || !b.firmName || !b.adminName || !b.password) return err(400, 'Chybí firmName / adminName / password.');
                if (String(b.password).length < 8) return err(400, 'Heslo musí mít aspoň 8 znaků.');
                // KOLIK FIREM SMÍ JEDEN ČLOVĚK ZALOŽIT. Zakladač se pozná podle
                // PODEPSANÉ IP (founderId) — v databázi tedy neleží adresa, ale
                // otisk, který se dá jen porovnat. Starý čítač 'reg:<ip>' (5/den)
                // zůstává: ten brání návalu, tenhle dlouhodobému množení firem.
                await ensureOwnerSchema(env);
                const founder = await founderId(env, req);
                const founded = await env.DB.prepare('SELECT COUNT(*) AS n FROM firms WHERE founder=? AND created>?')
                    .bind(founder, Date.now() - FOUND_WINDOW).first();
                if (founded && founded.n >= FOUND_MAX)
                    return err(429, 'Z tohoto připojení už vznikly ' + FOUND_MAX + ' firmy. Potřebuješ-li další, napiš mi přes Zpětnou vazbu — povím to serveru.');
                const firmId = crypto.randomUUID(), userId = crypto.randomUUID();
                const salt = randHex(16);
                const hash = await pbkdf2(String(b.password), salt, ITERS);
                let code = firmCode();
                // pojistka na kolizi kódu (unikátní index) — 3 pokusy
                for (let i = 0; i < 3; i++) {
                    try {
                        await env.DB.prepare('INSERT INTO firms(id,code,name,perms,auto_lock,created,max_users,frozen,founder) VALUES(?,?,?,?,0,?,?,0,?)')
                            .bind(firmId, code, String(b.firmName).slice(0, 60), defaultPermsJson(), Date.now(), FIRM_MAX_DEFAULT, founder).run();
                        break;
                    } catch (e) {
                        if (i === 2) throw e;
                        code = firmCode();
                    }
                }
                await env.DB.prepare('INSERT INTO users(id,firm_id,name,role,pass_hash,salt,iters,disabled,created) VALUES(?,?,?,?,?,?,?,0,?)')
                    .bind(userId, firmId, String(b.adminName).slice(0, 40), 'admin', hash, salt, ITERS, Date.now()).run();
                const user = { id: userId, firm_id: firmId, name: b.adminName, role: 'admin' };
                const cfg = await configPayload(env, firmId);
                return json({
                    token: await makeToken(env, user),
                    user: { id: userId, name: user.name, role: 'admin' },
                    config: cfg
                });
            }

            // ---------------- registrace ÚČTU (nový model) -------------------
            // Jedna obrazovka pro obě verze: člověk si vymyslí jméno, název
            // svého prostoru a heslo. Založí se ÚČET (identita + heslo + tarif)
            // a k němu jeho VLASTNÍ PROSTOR, o kterém v Základu ani neví — slovo
            // „firma" se mu nikde neukáže, jen si pojmenoval, kde má data.
            //
            // ⚠ ŽÁDNÝ E-MAIL, ŽÁDNÁ OBNOVA HESLA (rozhodnutí uživatele). Kdo
            //   ztratí heslo, ztratí data — jediná pojistka je stažená záloha.
            //   Server proto nemá kam poslat odkaz a ani o to nikdo nepožádá.
            //
            // ⚠⚠ STROP ZAKLADATELE SE TU NEUPLATŇUJE. FOUND_MAX (3 firmy za 90
            //   dní) dával smysl, dokud firmu zakládal jen ten, kdo ji opravdu
            //   měl. Teď vzniká prostor při KAŽDÉ registraci, takže by ten strop
            //   zavřel dveře čtvrtému člověku na společné wifi. Vlastní prostory
            //   se do něj nepočítají; návaly dál brzdí čítač 'reg:<ip>' (5/den)
            //   a stropu podléhá jen zakládání skutečné firmy (POST /firms).
            if (req.method === 'POST' && path === '/register') {
                await ensureUctySchema(env);
                const ip = req.headers.get('CF-Connecting-IP') || '?';
                if (!await guardHit(env, 'reg:' + ip, 5, 864e5))
                    return err(429, 'Příliš mnoho registrací z této adresy, zkus to zítra.');
                const b = await req.json().catch(() => null);
                if (!b || !b.name || !b.spaceName || !b.password)
                    return err(400, 'Chybí name / spaceName / password.');
                if (String(b.password).length < 8) return err(400, 'Heslo musí mít aspoň 8 znaků.');
                await ensureOwnerSchema(env);

                const accId = crypto.randomUUID();
                const firmId = crypto.randomUUID();
                const userId = crypto.randomUUID();
                const salt = randHex(16);
                const hash = await pbkdf2(String(b.password), salt, ITERS);
                const nyni = Date.now();

                let code = accCode(), ok = false;
                for (let i = 0; i < 3 && !ok; i++) {
                    try {
                        await env.DB.prepare(
                            'INSERT INTO accounts(id,code,name,pass_hash,salt,iters,tarif,disabled,created,last_login) '
                            + "VALUES(?,?,?,?,?,?,'zaklad',0,?,?)")
                            .bind(accId, code, String(b.name).slice(0, 40), hash, salt, ITERS, nyni, nyni).run();
                        ok = true;
                    } catch (e) { code = accCode(); }
                }
                if (!ok) return err(500, 'Nepodařilo se vyrobit kód účtu, zkus to prosím znovu.');

                // Vlastní prostor: JEDNO MÍSTO. Až si účet pořídí Pro, strop se
                // zvedne na FIRM_MAX_DEFAULT (viz /owner/tarif) a teprve tehdy
                // se z prostoru stane firma, do které jde někoho pozvat.
                let fcode = firmCode();
                for (let i = 0; i < 3; i++) {
                    try {
                        await env.DB.prepare(
                            'INSERT INTO firms(id,code,name,perms,auto_lock,created,max_users,frozen,founder) '
                            + 'VALUES(?,?,?,?,0,?,?,0,?)')
                            .bind(firmId, fcode, String(b.spaceName).slice(0, 60), defaultPermsJson(),
                                nyni, SOLO_MAX, await founderId(env, req)).run();
                        break;
                    } catch (e) {
                        if (i === 2) return err(500, 'Nepodařilo se založit prostor.');
                        fcode = firmCode();
                    }
                }
                await env.DB.prepare(
                    'INSERT INTO users(id,firm_id,name,role,pass_hash,salt,iters,disabled,created,acc_id,own) '
                    + 'VALUES(?,?,?,?,?,?,?,0,?,?,1)')
                    .bind(userId, firmId, String(b.name).slice(0, 40), 'admin', hash, salt, ITERS,
                        nyni, accId).run();

                const u = { id: userId, firm_id: firmId, name: b.name, role: 'admin', acc_id: accId };
                return json({
                    token: await makeToken(env, u, accId),
                    ucet: { id: accId, code: code, name: String(b.name).slice(0, 40), tarif: 'zaklad' },
                    user: { id: userId, name: u.name, role: 'admin' },
                    prostory: await prostoryUctu(env, accId),
                    config: await configPayload(env, firmId)
                });
            }

            // ---------------- přihlášení ------------------------------------
            // DVĚ CESTY V JEDNÉ ROUTĚ, a rozhoduje DÉLKA KÓDU:
            //   8 znaků = kód ÚČTU  → nový model, jméno se nezadává
            //   6 znaků = kód FIRMY → stará cesta {code, name, password}, kterou
            //     dál potřebují telefony s neaktualizovanou appkou. Až doslouží,
            //     smaže se celá druhá větev a nic jiného se měnit nebude.
            if (req.method === 'POST' && path === '/login') {
              const b = await req.json().catch(() => null) || {};
              const kod = String(b.code || '').trim().toUpperCase();
              if (kod.length === 8) {
                await ensureUctySchema(env);
                if (b.password == null) return err(400, 'Chybí password.');
                const ip = req.headers.get('CF-Connecting-IP') || '0';
                const gkey = 'log2:' + kod + ':' + ip, gip = 'loginip:' + ip, gacct = 'log2:' + kod;
                if (!await guardHit(env, gkey, 8, 15 * 60e3)) return err(429, 'Příliš mnoho pokusů. Zkus to za 15 minut.');
                if (!await guardHit(env, gip, 30, 15 * 60e3)) return err(429, 'Příliš mnoho pokusů z této sítě. Zkus to za 15 minut.');
                if (!await guardHit(env, gacct, 60, 15 * 60e3)) return err(429, 'Účet je dočasně zamčený kvůli mnoha pokusům o přihlášení. Zkus to za 15 minut.');

                const acc = await dbFirst(env, 'SELECT * FROM accounts WHERE code=?', kod);
                if (!acc) return err(401, 'Nesprávný kód nebo heslo.');
                if (acc.disabled) return err(403, 'Účet je zablokovaný.');
                const h = await pbkdf2(String(b.password), acc.salt, acc.iters);
                if (!timingSafeEq(h, acc.pass_hash)) return err(401, 'Nesprávný kód nebo heslo.');
                await guardClear(env, gkey); await guardClear(env, gip); await guardClear(env, gacct);
                await dbRunSoft(env, 'UPDATE accounts SET last_login=? WHERE id=?', Date.now(), acc.id);

                const prostory = await prostoryUctu(env, acc.id);
                // Kam se přihlásit: buď kam si klient řekl (`firmId`), nebo do
                // posledního živého prostoru. Archiv se za výchozí nebere nikdy —
                // člověk by se přihlásil do místa, kde nesmí nic zapsat, a nechápal
                // by proč.
                let cil = null;
                if (b.firmId) cil = prostory.find(p => p.firmId === b.firmId && !p.archiv) || null;
                if (!cil) cil = prostory.find(p => p.vlastni && !p.archiv) || prostory.find(p => !p.archiv) || null;
                if (!cil) return err(403, 'Účet nemá žádný živý prostor.');
                await dbRunSoft(env, 'UPDATE users SET last_login=? WHERE id=?', Date.now(), cil.uid);
                return json({
                    token: await makeToken(env, { id: cil.uid, firm_id: cil.firmId }, acc.id),
                    ucet: { id: acc.id, code: acc.code, name: acc.name, tarif: tarifUctu(acc), tarifDo: acc.tarif_do || 0 },
                    user: { id: cil.uid, name: acc.name, role: cil.role },
                    prostory: prostory,
                    config: await configPayload(env, cil.firmId)
                });
              }

                // ---- stará cesta: kód FIRMY + jméno ------------------------
                if (!b.code || !b.name || b.password == null) return err(400, 'Chybí code / name / password.');
                // BRZDA PROTI HADANI HESLA — TRI klice, ne jeden.
                // Drive existoval jen klic 'login:<firma>:<jmeno>' bez IP, takze kdo znal
                // kod firmy a jmeno kolegy, ZAMKL MU UCET osmi pokusy na ctvrt hodiny -
                // uprostred dne v terenu. Ted:
                //   1) ucet+IP (8/15 min)  — utocnik zamkne jen SAM SEBE, ne kolegu
                //   2) IP        (30/15 min) — jedna adresa nemuze strilet po vice uctech
                //   3) ucet      (60/15 min) — posledni pojistka proti ROZPROSTRENEMU
                //      utoku z mnoha adres; prah je tak vysoko, aby ho nesel zneuzit
                //      k naschvalu, ale nizko na to, aby se nedal projit ctyrmistny PIN
                const ip = req.headers.get('CF-Connecting-IP') || '0';
                const acct = String(b.code).toUpperCase() + ':' + String(b.name).toLowerCase();
                const gkey = 'login:' + acct + ':' + ip;
                const gip = 'loginip:' + ip;
                const gacct = 'login:' + acct;
                if (!await guardHit(env, gkey, 8, 15 * 60e3)) return err(429, 'Příliš mnoho pokusů. Zkus to za 15 minut.');
                if (!await guardHit(env, gip, 30, 15 * 60e3)) return err(429, 'Příliš mnoho pokusů z této sítě. Zkus to za 15 minut.');
                if (!await guardHit(env, gacct, 60, 15 * 60e3)) return err(429, 'Účet je dočasně zamčený kvůli mnoha pokusům o přihlášení. Zkus to za 15 minut.');
                const firm = await dbFirst(env, 'SELECT id, frozen FROM firms WHERE code=?', String(b.code).toUpperCase());
                if (!firm) return err(401, 'Firma s tímto kódem neexistuje.');
                if (firm.frozen >= 2) return err(403, 'Firma je dočasně zamčená správcem aplikace.');
                const u = await env.DB.prepare(
                    'SELECT * FROM users WHERE firm_id=? AND name=? COLLATE NOCASE').bind(firm.id, String(b.name)).first();
                if (!u) return err(401, 'Nesprávné jméno nebo heslo.');
                if (u.disabled) return err(403, 'Účet je zablokovaný. Obrať se na admina.');
                const hash = await pbkdf2(String(b.password), u.salt, u.iters);
                if (!timingSafeEq(hash, u.pass_hash)) return err(401, 'Nesprávné jméno nebo heslo.');
                // uspesne prihlaseni maze vsechny tri citace
                await guardClear(env, gkey);
                await guardClear(env, gip);
                await guardClear(env, gacct);
                // Razítko PŘED configPayload(), ať čerstvý čas rovnou odjede v odpovědi.
                // Přes dbRunSoft: na nezmigrované databázi sloupec ještě není a
                // neúspěšný zápis razítka nesmí shodit přihlášení.
                await dbRunSoft(env, 'UPDATE users SET last_login=? WHERE id=?', Date.now(), u.id);
                // MIGRACE STARÉHO ÚČTU, LÍNĚ A PŘI PŘIHLÁŠENÍ. Tenhle člověk se
                // zrovna prokázal heslem, takže je to jediná chvíle, kdy se dá
                // jeho členství svázat s účtem bez ptaní. Když to selže, přihlášení
                // to nesmí shodit — appka bude fungovat jako dosud, jen bez tarifu.
                let ucet = null;
                try { ucet = await ucetProUzivatele(env, u); } catch (e) { ucet = null; }
                const cfg = await configPayload(env, firm.id);
                return json({
                    token: await makeToken(env, u, ucet ? ucet.id : null),
                    ucet: ucet ? { id: ucet.id, code: ucet.code, name: ucet.name, tarif: tarifUctu(ucet) } : null,
                    user: { id: u.id, name: u.name, role: u.role },
                    prostory: ucet ? await prostoryUctu(env, ucet.id) : [],
                    config: cfg
                });
            }

            // ---------------- vše dál vyžaduje token -------------------------
            // ---- spárování hodinek (bez přihlášení, jen na kód) ----
            // Kód platí 10 minut a je jednorázový; víc než 8 pokusů z jedné
            // IP za čtvrt hodiny se nepustí, ať se šest znaků nedá uhádnout.
            if (req.method === 'POST' && path === '/watch/pair') {
                await ensureWatchTables(env);
                const ip = req.headers.get('CF-Connecting-IP') || '0';
                // POZOR na význam: guardHit vrací true, když se SMÍ dál —
                // odmítá se tedy při false, stejně jako u přihlašování výš.
                if (!await guardHit(env, 'wpair:' + ip, 8, 15 * 60e3))
                    return err(429, 'Moc pokusů, zkuste to za čtvrt hodiny.');

                const b = await req.json().catch(() => null);
                const kod = String((b && b.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
                if (kod.length !== 6) return err(400, 'Chybí párovací kód.');

                const row = await env.DB.prepare(
                    'SELECT firm_id, user_id, job_key, exp FROM watch_codes WHERE code=?').bind(kod).first();
                if (!row || row.exp < Date.now()) return err(404, 'Kód neplatí.');
                await env.DB.prepare('DELETE FROM watch_codes WHERE code=?').bind(kod).run();

                const u = await env.DB.prepare('SELECT id, firm_id, name FROM users WHERE id=? AND firm_id=? AND disabled=0')
                    .bind(row.user_id, row.firm_id).first();
                if (!u) return err(403, 'Účet už neexistuje.');

                const blok = await watchBlok(env, row.firm_id, row.job_key);
                return json({
                    token: await makeWatchToken(env, u, row.job_key),
                    job: row.job_key, uname: u.name, from: blok[0], to: blok[1]
                });
            }

            // ---- párování z hodinek (bez přihlášení) ----
            // Bez těla: hodinky si vyžádají nový kód a dostanou k němu secret.
            // S {secret}: ptají se, jestli už kód někdo v mobilu potvrdil.
            if (req.method === 'POST' && path === '/watch/hello') {
                await ensureWatchTables(env);
                const ip = req.headers.get('CF-Connecting-IP') || '0';
                if (!await guardHit(env, 'whello:' + ip, 120, 15 * 60e3))
                    return err(429, 'Moc pokusů, zkuste to za čtvrt hodiny.');

                const b = await req.json().catch(() => null);
                const secret = String((b && b.secret) || '');

                if (!secret) {
                    const code = watchKod();
                    const s = randHex(16);
                    const exp = Date.now() + 15 * 60e3;
                    await env.DB.prepare('INSERT OR REPLACE INTO watch_pending(code,secret,exp) VALUES(?,?,?)')
                        .bind(code, s, exp).run();
                    await env.DB.prepare('DELETE FROM watch_pending WHERE exp<?').bind(Date.now()).run();
                    return json({ code: code, secret: s, exp: exp });
                }

                const row = await env.DB.prepare(
                    'SELECT code, firm_id, user_id, job_key, exp FROM watch_pending WHERE secret=?')
                    .bind(secret).first();
                if (!row || row.exp < Date.now()) return err(404, 'Párování vypršelo.');
                if (!row.firm_id) return json({ waiting: true });

                const u = await env.DB.prepare('SELECT id, firm_id, name FROM users WHERE id=? AND firm_id=? AND disabled=0')
                    .bind(row.user_id, row.firm_id).first();
                if (!u) return err(403, 'Účet už neexistuje.');

                await env.DB.prepare('DELETE FROM watch_pending WHERE code=?').bind(row.code).run();
                const blok = await watchBlok(env, row.firm_id, row.job_key);
                return json({
                    token: await makeWatchToken(env, u, row.job_key),
                    job: row.job_key, uname: u.name, from: blok[0], to: blok[1]
                });
            }

            // ================= KONZOLE VLASTNÍKA APPKY =======================
            // Neváže se na firemní token, ale na tajemství OWNER_KEY — stejně jako
            // schránka zpětné vazby. Firemní admini (ani ten někoho z větší firmy)
            // se sem nedostanou ani omylem: je to jiná část routerů NAD ověřením
            // tokenu, takže token se tu ani nečte.
            if (path.indexOf('/owner/') === 0) {
                const gate = await ownerGate(req, env, 'Konzole');
                if (gate) return gate;
                await ensureOwnerSchema(env);
                await ensureOwnerPlusSchema(env);

                // ===== VLASTNÍK PLUS =====================================================
                // Souhrn dne (návrh „dnes") + tečka „něco čeká" (?lite=1, návrh „badge")
                // + kdo je v terénu (návrh „online") + komu vyprší Pro (návrh „kalendar").
                // Okno je 24 h zpět, ne kalendářní den — server neví, jaké je u uživatele
                // ráno, a „za posledních 24 hodin" je stejně čitelné.
                if (req.method === 'GET' && path === '/owner/prehled') {
                    const ted = Date.now(), od = ted - 864e5;
                    const cnt = async (sql, ...b) => { try { const r = await env.DB.prepare(sql).bind(...b).first(); return (r && (r.n || 0)) || 0; } catch (e) { return 0; } };
                    const zadosti = await cnt("SELECT COUNT(*) AS n FROM feedback WHERE done=0 AND kind='pro'");
                    const zpravy = await cnt("SELECT COUNT(*) AS n FROM feedback WHERE done=0 AND kind!='pro'");
                    if (url.searchParams.get('lite') === '1') return json({ zadosti, zpravy, serverTime: ted });
                    const lidi24 = await cnt('SELECT COUNT(DISTINCT uid) AS n FROM usage WHERE ts>=?', od);
                    const body24 = await cnt('SELECT COUNT(*) AS n FROM sync_points WHERE srv>=? AND deleted=0', od);
                    const ucty24 = await cnt('SELECT COUNT(*) AS n FROM accounts WHERE created>=?', od);
                    const chyby24 = await cnt('SELECT SUM(n) AS n FROM errors WHERE ts>=?', od);
                    const uctyCelkem = await cnt('SELECT COUNT(*) AS n FROM accounts');
                    const proCelkem = await cnt("SELECT COUNT(*) AS n FROM accounts WHERE tarif='pro' AND (tarif_do IS NULL OR tarif_do=0 OR tarif_do>?)", ted);
                    let vyprsi = [];
                    try {
                        vyprsi = await dbAll(env, "SELECT id, code, name, tarif_do FROM accounts WHERE tarif='pro' AND tarif_do>? AND tarif_do<=? ORDER BY tarif_do LIMIT 50", ted, ted + 60 * 864e5) || [];
                    } catch (e) { vyprsi = []; }
                    // kdo je v terénu: aktivita za 10 minut (usage) + živé polohy (pos)
                    let online = [];
                    try {
                        const rows = await dbAll(env,
                            'SELECT u.uid, MAX(u.uname) AS uname, u.firm_id, MAX(u.ts) AS ts, COUNT(*) AS n, f.name AS firma '
                            + 'FROM usage u LEFT JOIN firms f ON f.id=u.firm_id WHERE u.ts>=? GROUP BY u.uid, u.firm_id ORDER BY ts DESC LIMIT 40', ted - 10 * 60e3);
                        online = (rows || []).map(r => ({ uid: r.uid, jmeno: r.uname, firma: r.firma, ts: r.ts, n: r.n }));
                    } catch (e) { online = []; }
                    try {
                        const rows = await dbAll(env, 'SELECT p.uid, p.uname, p.firm_id, p.ts, p.job, f.name AS firma FROM pos p LEFT JOIN firms f ON f.id=p.firm_id WHERE p.ts>=? ORDER BY p.ts DESC LIMIT 40', ted - 10 * 60e3);
                        (rows || []).forEach(r => { if (!online.some(o => o.uid === r.uid)) online.push({ uid: r.uid, jmeno: r.uname, firma: r.firma, ts: r.ts, n: 0, job: r.job }); });
                    } catch (e) {}
                    // kde se dnes měřilo — shluky bodů na ~2 km (0,02°), bez konkrétních souřadnic
                    const shluky = {};
                    try {
                        const rows = await dbAll(env, 'SELECT data FROM sync_points WHERE srv>=? AND deleted=0 LIMIT 3000', od);
                        (rows || []).forEach(r => {
                            let d = null; try { d = JSON.parse(r.data || 'null'); } catch (e) { d = null; }
                            if (!d || typeof d.lat !== 'number' || typeof d.lng !== 'number') return;
                            const k = (Math.round(d.lat / 0.02) * 0.02).toFixed(2) + ',' + (Math.round(d.lng / 0.02) * 0.02).toFixed(2);
                            shluky[k] = (shluky[k] || 0) + 1;
                        });
                    } catch (e) {}
                    return json({
                        serverTime: ted, lidi24, body24, ucty24, chyby24, zadosti, zpravy, uctyCelkem, proCelkem,
                        vyprsi, online,
                        shluky: Object.keys(shluky).map(k => { const p = k.split(','); return { lat: +p[0], lng: +p[1], n: shluky[k] }; })
                    });
                }
                // Deník vlastníka (návrh „audit")
                if (req.method === 'GET' && path === '/owner/log') {
                    const before = parseInt(url.searchParams.get('before'), 10) || 0;
                    let rows = [];
                    try {
                        rows = before
                            ? await dbAll(env, 'SELECT id, ts, akce, cil, detail FROM owner_log WHERE id<? ORDER BY id DESC LIMIT 100', before)
                            : await dbAll(env, 'SELECT id, ts, akce, cil, detail FROM owner_log ORDER BY id DESC LIMIT 100');
                    } catch (e) { rows = []; }
                    return json({ rows: rows || [], more: (rows || []).length === 100 });
                }
                // Vzkaz konkrétnímu účtu nebo firmě (návrh „vzkaz")
                if (req.method === 'POST' && path === '/owner/vzkaz') {
                    const b = await req.json().catch(() => null) || {};
                    const txt = String(b.txt || '').trim().slice(0, 500);
                    const acc = b.acc_id ? String(b.acc_id).slice(0, 40) : null;
                    const firm = b.firm_id ? String(b.firm_id).slice(0, 40) : null;
                    if (!txt) return err(400, 'Prázdný vzkaz.');
                    if (!acc && !firm) return err(400, 'Chybí komu (acc_id nebo firm_id).');
                    await env.DB.prepare('INSERT INTO vzkazy(ts,acc_id,firm_id,txt,read_ts) VALUES(?,?,?,?,NULL)').bind(Date.now(), acc, firm, txt).run();
                    await ownerLog(env, 'vzkaz', acc || firm, txt.slice(0, 120));
                    return json({ ok: true });
                }
                // Poznámka u účtu (návrh „pozn-ucet")
                const pm = /^\/owner\/ucty\/([\w-]+)\/pozn$/.exec(path);
                if (pm && req.method === 'POST') {
                    const b = await req.json().catch(() => null) || {};
                    const note = String(b.note || '').trim().slice(0, 500);
                    await env.DB.prepare('UPDATE accounts SET note=? WHERE id=?').bind(note || null, pm[1]).run();
                    await ownerLog(env, 'poznamka', pm[1], note.slice(0, 120));
                    return json({ ok: true, note: note || null });
                }
                // Pohled očima účtu (návrh „ocima"): co ten člověk má a vidí — tarif, role
                // v každém prostoru, poslední aktivita, jeho chyby, které nástroje používá.
                const vm = /^\/owner\/ucty\/([\w-]+)\/pohled$/.exec(path);
                if (vm && req.method === 'GET') {
                    await ensureUctySchema(env);
                    const acc = await dbFirst(env, 'SELECT id, code, name, tarif, tarif_do, disabled, created, last_login, note FROM accounts WHERE id=?', vm[1]);
                    if (!acc) return err(404, 'Účet nenalezen.');
                    let clenstvi = [], chyby = [], nastroje = [], zarizeni = [];
                    try {
                        clenstvi = await dbAll(env, 'SELECT u.id AS uid, u.role, u.own, u.left_ts, u.disabled, u.last_login, f.id AS firm_id, f.name, f.code, f.perms, f.frozen FROM users u JOIN firms f ON f.id=u.firm_id WHERE u.acc_id=? ORDER BY u.own DESC', vm[1]) || [];
                    } catch (e) {}
                    const uids = clenstvi.map(c => c.uid);
                    if (uids.length) {
                        const ph = uids.map(() => '?').join(',');
                        try { chyby = await dbAll(env, 'SELECT ts, msg, src, line, n, ver, dev FROM errors WHERE uname IN (SELECT name FROM users WHERE id IN (' + ph + ')) ORDER BY ts DESC LIMIT 15', ...uids) || []; } catch (e) {}
                        try { nastroje = await dbAll(env, "SELECT k, COUNT(*) AS n, MAX(ts) AS last FROM usage WHERE uid IN (" + ph + ") AND t='tool' AND ts>=? GROUP BY k ORDER BY n DESC LIMIT 30", ...uids, Date.now() - 30 * 864e5) || []; } catch (e) {}
                        try { zarizeni = await dbAll(env, 'SELECT dev, MAX(ts) AS last, COUNT(*) AS n FROM usage WHERE uid IN (' + ph + ') AND dev IS NOT NULL GROUP BY dev ORDER BY last DESC LIMIT 5', ...uids) || []; } catch (e) {}
                    }
                    return json({
                        ucet: Object.assign({}, acc, { tarifPlati: tarifUctu(acc) === 'pro' }),
                        clenstvi: clenstvi.map(c => ({ firm_id: c.firm_id, nazev: c.own ? null : c.name, kod: c.own ? null : c.code, role: c.role, vlastni: !!c.own, archiv: !!c.left_ts, blokovan: !!c.disabled, lastLogin: c.last_login, frozen: c.frozen || 0,
                            perms: (() => { try { return JSON.parse(c.perms || 'null'); } catch (e) { return null; } })() })),
                        chyby, nastroje, zarizeni,
                        vzkazy: await (async () => { try { return await dbAll(env, 'SELECT id, ts, txt, read_ts FROM vzkazy WHERE acc_id=? ORDER BY ts DESC LIMIT 10', vm[1]) || []; } catch (e) { return []; } })()
                    });
                }
                // Záloha celého serveru (návrh „zaloha"): všechny tabulky jako jeden JSON.
                // Hesla ven nejdou (pass_hash/salt se vynechávají), body max 20 000 řádků.
                if (req.method === 'GET' && path === '/owner/export') {
                    const dump = { ts: Date.now(), verze: 14, tabulky: {} };
                    const tab = async (nazev, sql) => { try { dump.tabulky[nazev] = await dbAll(env, sql) || []; } catch (e) { dump.tabulky[nazev] = []; } };
                    await tab('firms', 'SELECT id, code, name, perms, auto_lock, max_users, frozen, note, created, founder FROM firms');
                    await tab('users', 'SELECT id, firm_id, name, role, disabled, created, last_login, acc_id, left_ts, own FROM users');
                    await tab('accounts', 'SELECT id, code, name, tarif, tarif_do, disabled, created, last_login, trial_ts, note FROM accounts');
                    await tab('jobs', 'SELECT firm_id, job_key, name, acl, ts, srv, deleted, uname FROM jobs');
                    await tab('sync_points', 'SELECT firm_id, job_key, point_id, data, ts, srv, deleted, uname FROM sync_points WHERE deleted=0 LIMIT 20000');
                    await tab('feedback', 'SELECT id, ts, kind, txt, contact, meta, who, done FROM feedback');
                    await tab('orders', 'SELECT vs, acc_id, code, amount, dni, created, paid_ts, paid_by, cancelled FROM orders');
                    await tab('vzkazy', 'SELECT id, ts, acc_id, firm_id, txt, read_ts FROM vzkazy');
                    await tab('owner_log', 'SELECT id, ts, akce, cil, detail FROM owner_log ORDER BY id DESC LIMIT 2000');
                    await tab('meta', 'SELECT k, v FROM meta WHERE k IN (\'flags\',\'notice\')');
                    await ownerLog(env, 'zaloha', null, Object.keys(dump.tabulky).map(k => k + ':' + dump.tabulky[k].length).join(' '));
                    return json(dump);
                }

                // JEDNA ODPOVĚĎ = CELÁ OBRAZOVKA konzole. Záměrně: firem jsou
                // desítky, ne tisíce, a druhý dotaz na detail by znamenal další
                // čekání v terénu. Počty se sbírají GROUP BY dotazy (7 dotazů
                // celkem), ne dotazem na každou firmu zvlášť.
                if (req.method === 'GET' && path === '/owner/firms') {
                    const firms = (await env.DB.prepare(
                        'SELECT id, code, name, created, auto_lock, max_users, frozen, note, founder FROM firms ORDER BY created DESC LIMIT 500').all()).results;
                    const byId = {};
                    firms.forEach(f => {
                        byId[f.id] = f;
                        f.users = 0; f.off = 0; f.usage = 0; f.last = 0; f.chat = 0;
                        f.pts = 0; f.jobs = 0; f.reqToday = 0; f.req7 = 0; f.pending = 0;
                    });
                    // tabulka nemusí existovat (starší nasazení) → chyba se tichá přejde
                    async function fold(sql, bind, apply) {
                        try {
                            let st = env.DB.prepare(sql);
                            if (bind.length) st = st.bind(...bind);
                            (await st.all()).results.forEach(r => { const f = byId[r.firm_id]; if (f) apply(f, r); });
                        } catch (e) {}
                    }
                    const dToday = new Date().toISOString().slice(0, 10);
                    const d7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
                    await fold('SELECT firm_id, COUNT(*) AS n, SUM(disabled) AS d FROM users GROUP BY firm_id', [],
                        (f, r) => { f.users = r.n || 0; f.off = r.d || 0; });
                    await fold('SELECT firm_id, COUNT(*) AS n, MAX(ts) AS t FROM usage GROUP BY firm_id', [],
                        (f, r) => { f.usage = r.n || 0; f.last = r.t || 0; });
                    await fold('SELECT firm_id, COUNT(*) AS n FROM chat GROUP BY firm_id', [], (f, r) => { f.chat = r.n || 0; });
                    await fold('SELECT firm_id, COUNT(*) AS n FROM sync_points GROUP BY firm_id', [], (f, r) => { f.pts = r.n || 0; });
                    await fold('SELECT firm_id, COUNT(*) AS n FROM jobs GROUP BY firm_id', [], (f, r) => { f.jobs = r.n || 0; });
                    await fold('SELECT firm_id, n FROM stats_firm WHERE day=?', [dToday], (f, r) => { f.reqToday = r.n || 0; });
                    await fold('SELECT firm_id, SUM(n) AS n FROM stats_firm WHERE day>=? GROUP BY firm_id', [d7],
                        (f, r) => { f.req7 = r.n || 0; });
                    await fold("SELECT firm_id, COUNT(*) AS n FROM firm_requests WHERE state='new' GROUP BY firm_id", [],
                        (f, r) => { f.pending = r.n || 0; });

                    let requests = [];
                    try {
                        requests = (await env.DB.prepare(
                            'SELECT r.id, r.firm_id, r.ts, r.want, r.reason, r.who, r.state, r.reply, r.decided, '
                            + 'f.name AS firmName, f.code AS firmCode, f.max_users AS maxUsers '
                            + "FROM firm_requests r LEFT JOIN firms f ON f.id=r.firm_id ORDER BY (r.state='new') DESC, r.id DESC LIMIT 60").all()).results;
                    } catch (e) { requests = []; }
                    const days = (await env.DB.prepare('SELECT day, n FROM stats ORDER BY day DESC LIMIT 14').all()).results.reverse();
                    let notice = null;
                    try {
                        const row = await env.DB.prepare("SELECT v FROM meta WHERE k='notice'").first();
                        if (row && row.v) notice = JSON.parse(row.v);
                    } catch (e) { notice = null; }
                    // stav vypinace chodi s prehledem, at si ho konzole nemusi tahat zvlast
                    let flagsO = null;
                    try {
                        const rowG = await env.DB.prepare("SELECT v FROM meta WHERE k='flags'").first();
                        if (rowG && rowG.v) flagsO = JSON.parse(rowG.v);
                    } catch (e) { flagsO = null; }
                    return json({
                        firms: firms, requests: requests, days: days, notice: notice, flags: flagsO,
                        limits: { reqPerDay: 100000, plan: 'Workers Free', firmMaxDefault: FIRM_MAX_DEFAULT, foundMax: FOUND_MAX },
                        serverTime: Date.now()
                    });
                }

                // DATA FIRMY KE STAŽENÍ DO VLASTNÍ APPKY (12. 9. 2026, přání uživatele:
                // „z jakékoliv firmy si stáhnout data a dát si je k sobě do aplikace").
                // Vrací zakázky (tabulka jobs) a k nim živé body ze sync_points
                // (deleted=0) — tj. to, co firma synchronizovala z mobilů. Fotky u
                // bodů na server nechodí, takže tu nejsou. Strop 20 000 bodů na
                // odpověď (D1 i telefon to snesou; větší firma se nečeká).
                const fdm = /^\/owner\/firms\/([\w-]+)\/data$/.exec(path);
                if (fdm && req.method === 'GET') {
                    const fid = fdm[1];
                    const firma = await env.DB.prepare('SELECT id, code, name FROM firms WHERE id=?').bind(fid).first();
                    if (!firma) return err(404, 'Firma nenalezena.');
                    const nazvy = {};
                    try {
                        const jr = await dbAll(env, 'SELECT job_key, name, deleted FROM jobs WHERE firm_id=?', fid);
                        (jr || []).forEach(j => { nazvy[j.job_key] = { name: j.name || j.job_key, deleted: !!j.deleted }; });
                    } catch (e) {}
                    let rows = [];
                    try {
                        await ensureSyncTable(env);
                        rows = await dbAll(env, 'SELECT job_key, point_id, data, ts, uname FROM sync_points WHERE firm_id=? AND deleted=0 ORDER BY job_key, ts LIMIT 20000', fid) || [];
                    } catch (e) {}
                    const podle = {};
                    rows.forEach(r => {
                        let d = null;
                        try { d = JSON.parse(r.data || 'null'); } catch (e) { d = null; }
                        if (!d || typeof d !== 'object') return;
                        d.id = r.point_id; d.ts = r.ts; if (r.uname) d.uname = r.uname;
                        (podle[r.job_key] = podle[r.job_key] || []).push(d);
                    });
                    const keys = Object.keys(podle);
                    Object.keys(nazvy).forEach(k => { if (keys.indexOf(k) === -1 && !nazvy[k].deleted) keys.push(k); });
                    return json({
                        firm: firma,
                        jobs: keys.map(k => ({ key: k, name: (nazvy[k] && nazvy[k].name) || k, deleted: !!(nazvy[k] && nazvy[k].deleted), points: podle[k] || [] })),
                        total: rows.length, capped: rows.length >= 20000, serverTime: Date.now()
                    });
                }

                // změna firmy: název, strop lidí, zmrazení (0 běží / 1 jen čtení / 2 zamčeno), poznámka
                let fm = /^\/owner\/firms\/([\w-]+)$/.exec(path);
                if (fm && req.method === 'PATCH') {
                    const b = await req.json().catch(() => null);
                    if (!b) return err(400, 'Chybí tělo.');
                    const fid = fm[1];
                    if (!await env.DB.prepare('SELECT id FROM firms WHERE id=?').bind(fid).first()) return err(404, 'Firma nenalezena.');
                    if (b.name != null)
                        await env.DB.prepare('UPDATE firms SET name=? WHERE id=?').bind(String(b.name).slice(0, 60), fid).run();
                    if (b.maxUsers != null)
                        await env.DB.prepare('UPDATE firms SET max_users=? WHERE id=?')
                            .bind(Math.max(1, Math.min(1000, parseInt(b.maxUsers, 10) || FIRM_MAX_DEFAULT)), fid).run();
                    if (b.frozen != null) await ownerLog(env, 'firma-zmrazit', fid, String(b.frozen));
                    if (b.frozen != null)
                        await env.DB.prepare('UPDATE firms SET frozen=? WHERE id=?')
                            .bind(Math.max(0, Math.min(2, parseInt(b.frozen, 10) || 0)), fid).run();
                    if (b.note != null)
                        await env.DB.prepare('UPDATE firms SET note=? WHERE id=?').bind(String(b.note).slice(0, 500), fid).run();
                    return json({
                        ok: true,
                        firm: await env.DB.prepare('SELECT id, code, name, created, auto_lock, max_users, frozen, note FROM firms WHERE id=?').bind(fid).first()
                    });
                }

                // smazání jedné firmy — POJISTKA: v adrese musí sedět její kód,
                // ať se překlepem v seznamu nesmaže živá firma místo mrtvé.
                if (fm && req.method === 'DELETE') {
                    const fid = fm[1];
                    await ownerLog(env, 'firma-smazat', fid);
                    const f0 = await env.DB.prepare('SELECT id, code FROM firms WHERE id=?').bind(fid).first();
                    if (!f0) return err(404, 'Firma nenalezena.');
                    if ((url.searchParams.get('kod') || '').toUpperCase() !== String(f0.code).toUpperCase())
                        return err(400, 'Pro smazání firmy musí sedět její kód.');
                    await dropFirm(env, fid);
                    return json({ ok: true, deleted: f0.code });
                }

                // hromadný úklid mrtvých firem (seznam id poslá konzole až po potvrzení)
                if (req.method === 'POST' && path === '/owner/cleanup') {
                    const b = await req.json().catch(() => null) || {};
                    const ids = Array.isArray(b.ids) ? b.ids.slice(0, 50) : [];
                    if (!ids.length) return err(400, 'Chybí seznam firem.');
                    let n = 0;
                    for (const fid of ids) {
                        const f0 = await env.DB.prepare('SELECT id FROM firms WHERE id=?').bind(String(fid)).first();
                        if (!f0) continue;
                        await dropFirm(env, String(fid));
                        n++;
                    }
                    return json({ ok: true, n: n });
                }

                // vyřízení žádosti o víc míst: schválení rovnou zvedne strop firmy
                let rm = /^\/owner\/requests\/(\d+)$/.exec(path);
                if (rm && req.method === 'POST') {
                    const b = await req.json().catch(() => null) || {};
                    const rid = parseInt(rm[1], 10);
                    const r0 = await env.DB.prepare('SELECT id, firm_id, want FROM firm_requests WHERE id=?').bind(rid).first();
                    if (!r0) return err(404, 'Žádost nenalezena.');
                    const reply = b.reply ? String(b.reply).slice(0, 400) : null;
                    if (b.approve) {
                        const cap = Math.max(1, Math.min(1000, parseInt(b.maxUsers, 10) || r0.want));
                        await env.DB.prepare('UPDATE firms SET max_users=? WHERE id=?').bind(cap, r0.firm_id).run();
                        await env.DB.prepare("UPDATE firm_requests SET state='ok', decided=?, reply=? WHERE id=?")
                            .bind(Date.now(), reply, rid).run();
                        return json({ ok: true, maxUsers: cap });
                    }
                    await env.DB.prepare("UPDATE firm_requests SET state='no', decided=?, reply=? WHERE id=?")
                        .bind(Date.now(), reply, rid).run();
                    return json({ ok: true });
                }

                // hláška všem firmám — uloží se do meta a chodí s každou /config
                if (path === '/owner/notice' && req.method === 'PUT') {
                    const b = await req.json().catch(() => null) || {};
                    const txt = b.txt ? String(b.txt).trim().slice(0, 300) : '';
                    if (!txt) {
                        await env.DB.prepare("DELETE FROM meta WHERE k='notice'").run();
                        return json({ ok: true, notice: null });
                    }
                    await ownerLog(env, 'hlaska-vsem', null, txt);
                    const days2 = Math.max(1, Math.min(60, parseInt(b.dni, 10) || 7));
                    const n = { txt: txt, ts: Date.now(), until: Date.now() + days2 * 864e5 };
                    await env.DB.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('notice',?)").bind(JSON.stringify(n)).run();
                    return json({ ok: true, notice: n });
                }

                // VYPINAC MODULU - seznam vypnutych ID (nastroj nebo js/soubor.js).
                // Zapsat smi jen vlastnik; cist ho pak muze kdokoli prihlaseny
                // (chodi v /config), coz je v poradku: je to seznam nazvu, nic vic.
                if (path === '/owner/flags' && (req.method === 'PUT' || req.method === 'POST')) {
                    const b = await req.json().catch(() => null) || {};
                    const off = Array.isArray(b.off) ? b.off : [];
                    await ownerLog(env, 'vypinac', null, (off || []).join(', ').slice(0, 400) || 'vše zapnuto');
                    const clean = [];
                    for (const x of off) {
                        const v = String(x || '').trim().slice(0, 60);
                        if (v && clean.indexOf(v) === -1) clean.push(v);
                        if (clean.length >= 60) break;
                    }
                    if (!clean.length) {
                        await env.DB.prepare("DELETE FROM meta WHERE k='flags'").run();
                        return json({ ok: true, flags: null });
                    }
                    const g = { off: clean, ts: Date.now() };
                    await env.DB.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('flags',?)").bind(JSON.stringify(g)).run();
                    return json({ ok: true, flags: g });
                }

                // CHYBY OD LIDI, seskupene podle podpisu. Zajima "co pada nejcasteji
                // a kolika firmam", ne vypis jednotlivych radku - proto GROUP BY sig
                // a pocet ROZDILNYCH firem (jedna zacyklena smycka u jednoho cloveka
                // by jinak prebila skutecnou chybu, ktera trapi deset lidi).
                if (req.method === 'GET' && path === '/owner/errors') {
                    const dniE = Math.max(1, Math.min(90, parseInt(url.searchParams.get('dni'), 10) || 14));
                    const odE = Date.now() - dniE * 864e5;
                    let rowsE = [];
                    try {
                        rowsE = (await env.DB.prepare(
                            'SELECT sig, MAX(msg) AS msg, MAX(src) AS src, MAX(line) AS line, '
                            + 'SUM(n) AS n, COUNT(DISTINCT firm_id) AS firms, MAX(ts) AS last, MAX(ver) AS ver '
                            + 'FROM errors WHERE ts>=? GROUP BY sig ORDER BY n DESC LIMIT 80').bind(odE).all()).results;
                    } catch (e) { rowsE = []; }
                    let totalE = 0;
                    try {
                        const t = await env.DB.prepare('SELECT SUM(n) AS n FROM errors WHERE ts>=?').bind(odE).first();
                        totalE = (t && t.n) || 0;
                    } catch (e) { totalE = 0; }
                    // podle verze appky (návrh „zdravi"): která verze pada nejvíc
                    let verze = [];
                    try {
                        verze = (await env.DB.prepare('SELECT ver, SUM(n) AS n, COUNT(DISTINCT sig) AS sigs, COUNT(DISTINCT firm_id) AS firms FROM errors WHERE ts>=? GROUP BY ver ORDER BY n DESC LIMIT 12').bind(odE).all()).results || [];
                    } catch (e) { verze = []; }
                    return json({ dni: dniE, total: totalE, rows: rowsE, verze });
                }
                if (req.method === 'DELETE' && path === '/owner/errors') {
                    try { await env.DB.prepare('DELETE FROM errors').run(); } catch (e) {}
                    return json({ ok: true });
                }

                // KTERE NASTROJE SE DOOPRAVDY POUZIVAJI - napric VSEMI firmami.
                // `usage` sbira zaznamy uz dlouho, ale doted je videla jen firma sama;
                // vlastnik tak nemel jak poznat, co ma cenu doladovat a co je mrtve.
                if (req.method === 'GET' && path === '/owner/usage') {
                    const dniU = Math.max(1, Math.min(365, parseInt(url.searchParams.get('dni'), 10) || 30));
                    const odU = Date.now() - dniU * 864e5;
                    let rowsU = [], firmsU = 0, lidiU = 0;
                    try {
                        rowsU = (await env.DB.prepare(
                            "SELECT k, COUNT(*) AS n, COUNT(DISTINCT firm_id) AS firms, COUNT(DISTINCT uid) AS lidi, MAX(ts) AS last "
                            + "FROM usage WHERE t='tool' AND ts>=? AND k IS NOT NULL AND k<>'' GROUP BY k ORDER BY n DESC LIMIT 200")
                            .bind(odU).all()).results;
                        const c = await env.DB.prepare(
                            "SELECT COUNT(DISTINCT firm_id) AS f, COUNT(DISTINCT uid) AS u FROM usage WHERE t='tool' AND ts>=?")
                            .bind(odU).first();
                        firmsU = (c && c.f) || 0; lidiU = (c && c.u) || 0;
                    } catch (e) { rowsU = []; }
                    return json({ dni: dniU, firms: firmsU, lidi: lidiU, rows: rowsU });
                }

                // ---- ÚČTY A TARIFY (konzole vlastníka) ----------------------
                // Prodej Pro má dvě cesty a obě jsou schválně:
                //   • LICENČNÍ KLÍČ (js/licence.js) — ověřuje se v telefonu, bez
                //     serveru, aby si ho geodet mohl odemknout v lese. Odemyká
                //     ale jen NÁSTROJE v mobilu, ne placené cesty na serveru.
                //   • TARIF ÚČTU (tady) — vymáhá server, takže na něj nedosáhne
                //     ani ten, kdo si v prohlížeči odkryje schované dlaždice.
                // Kdo má tarif Pro, klíč nikdy neuvidí; appka si Pro rozsvítí
                // sama podle `tarif` z /config.
                // LIDÉ: všechny účty, u každého kde je (prostory) a co naposledy
                // dělal. Poslední aktivita se skládá ze dvou zdrojů: přihlášení
                // (accounts.last_login) a poslední záznam užívání za 30 dní
                // (`usage` přes users.acc_id) — jeden GROUP BY dotaz, ne dotaz
                // na každý účet zvlášť.
                if (req.method === 'GET' && path === '/owner/ucty') {
                    await ensureUctySchema(env);
                    await ensureProdejSchema(env);
                    const q = String(url.searchParams.get('q') || '').trim().toUpperCase();
                    const rows = q
                        ? await dbAll(env, 'SELECT id, code, name, tarif, tarif_do, disabled, created, last_login, trial_ts '
                            + 'FROM accounts WHERE code=? OR UPPER(name) LIKE ? ORDER BY created DESC LIMIT 200', q, '%' + q + '%')
                        : await dbAll(env, 'SELECT id, code, name, tarif, tarif_do, disabled, created, last_login, trial_ts '
                            + 'FROM accounts ORDER BY created DESC LIMIT 200');
                    const ids = (rows || []).map(r => r.id);
                    const prostory = {}, aktivita = {}, objednavky = {};
                    if (ids.length) {
                        const ph = ids.map(() => '?').join(',');
                        try {
                            const pr = await dbAll(env,
                                'SELECT u.acc_id, u.role, u.own, u.left_ts, u.disabled, u.last_login, f.name AS nazev, f.code AS kod, '
                                + '(SELECT COUNT(*) FROM users x WHERE x.firm_id=f.id AND x.left_ts IS NULL) AS lidi '
                                + 'FROM users u JOIN firms f ON f.id=u.firm_id WHERE u.acc_id IN (' + ph + ') ORDER BY u.own DESC, f.name', ...ids);
                            (pr || []).forEach(r => {
                                (prostory[r.acc_id] = prostory[r.acc_id] || []).push({
                                    nazev: r.own ? null : r.nazev, kod: r.own ? null : r.kod, role: r.role,
                                    vlastni: !!r.own, archiv: !!r.left_ts, lidi: r.lidi || 0, lastLogin: r.last_login || 0
                                });
                            });
                        } catch (e) {}
                        try {
                            const ak = await dbAll(env,
                                "SELECT u.acc_id, MAX(g.ts) AS ts, COUNT(*) AS n FROM usage g JOIN users u ON u.id=g.uid "
                                + 'WHERE g.ts>=? AND u.acc_id IN (' + ph + ') GROUP BY u.acc_id', Date.now() - 30 * 864e5, ...ids);
                            (ak || []).forEach(r => { aktivita[r.acc_id] = { ts: r.ts || 0, n: r.n || 0 }; });
                        } catch (e) {}
                        try {
                            const ob = await dbAll(env,
                                'SELECT acc_id, COUNT(*) AS n, SUM(CASE WHEN paid_ts IS NOT NULL THEN 1 ELSE 0 END) AS zaplaceno, '
                                + 'SUM(CASE WHEN paid_ts IS NULL AND cancelled=0 THEN 1 ELSE 0 END) AS ceka '
                                + 'FROM orders WHERE acc_id IN (' + ph + ') GROUP BY acc_id', ...ids);
                            (ob || []).forEach(r => { objednavky[r.acc_id] = { n: r.n || 0, zaplaceno: r.zaplaceno || 0, ceka: r.ceka || 0 }; });
                        } catch (e) {}
                    }
                    return json({
                        ucty: (rows || []).map(r => {
                            const ak = aktivita[r.id] || { ts: 0, n: 0 };
                            return Object.assign({}, r, {
                                tarifPlati: tarifUctu(r) === 'pro',
                                prostory: prostory[r.id] || [],
                                aktivita: Math.max(ak.ts, r.last_login || 0), akcí30d: ak.n,
                                objednavky: objednavky[r.id] || { n: 0, zaplaceno: 0, ceka: 0 }
                            });
                        }),
                        prodej: prodejCfg(env)
                    });
                }

                if (req.method === 'POST' && path === '/owner/tarif') {
                    await ensureUctySchema(env);
                    const b = await req.json().catch(() => null) || {};
                    const tarif = TARIFY.indexOf(b.tarif) === -1 ? null : b.tarif;
                    if (!tarif) return err(400, 'Tarif musí být zaklad nebo pro.');
                    const acc = await dbFirst(env, 'SELECT * FROM accounts WHERE id=? OR code=?',
                        String(b.id || ''), String(b.code || '').toUpperCase());
                    if (!acc) return err(404, 'Účet nenalezen.');
                    // Ruční zapnutí z konzole PRODLUŽUJE (od konce běžícího Pro),
                    // stejně jako platba — vlastník, který dá „rok" člověku s
                    // půlrokem zbývajícím, mu ho nesmí zkrátit.
                    if (tarif === 'pro') await zapniPro(env, acc, b.dni | 0);
                    else await vypniPro(env, acc);
                    await ownerLog(env, tarif === 'pro' ? 'pro-zapnout' : 'pro-vypnout', acc.code + ' ' + acc.name, tarif === 'pro' ? ((b.dni | 0) ? (b.dni | 0) + ' dní' : 'navždy') : '');
                    return json({ ok: true, ucet: await dbFirst(env, 'SELECT id, code, name, tarif, tarif_do FROM accounts WHERE id=?', acc.id) });
                }

                // „VYHODIT Z APPKY" = zablokovat účet. auth() vrací null hned při
                // příštím požadavku (účet se čte čerstvý z DB, ne z tokenu), takže
                // člověk vypadne do minuty i na telefonu, kde je přihlášený. Data
                // se nemažou — odblokování všechno vrátí.
                if (req.method === 'POST' && path === '/owner/blokace') {
                    await ensureUctySchema(env);
                    const b = await req.json().catch(() => null) || {};
                    const acc = await dbFirst(env, 'SELECT * FROM accounts WHERE id=? OR code=?',
                        String(b.id || ''), String(b.code || '').toUpperCase());
                    if (!acc) return err(404, 'Účet nenalezen.');
                    const dis = b.disabled ? 1 : 0;
                    await env.DB.prepare('UPDATE accounts SET disabled=? WHERE id=?').bind(dis, acc.id).run();
                    // i členství — starší appky se hlásí starou cestou přes users.disabled
                    await dbRunSoft(env, 'UPDATE users SET disabled=? WHERE acc_id=?', dis, acc.id);
                    await ownerLog(env, b.disabled ? 'blokace' : 'odblokovat', (acc && (acc.code + ' ' + acc.name)) || String(b.id));
                    return json({ ok: true, ucet: await dbFirst(env, 'SELECT id, code, name, tarif, tarif_do, disabled FROM accounts WHERE id=?', acc.id) });
                }

                // ---- OBJEDNÁVKY A PLATBY -------------------------------------
                if (req.method === 'GET' && path === '/owner/objednavky') {
                    await ensureProdejSchema(env);
                    // Když je automat zapnutý a naposled koukal před víc než minutou,
                    // kouknout hned teď na pozadí — konzole tak ukazuje čerstvý stav
                    // i bez čekání na cron. Odpověď se tím nezdrží.
                    let fio = { nastaveno: !!env.FIO_TOKEN };
                    try {
                        fio.posledniOk = parseInt(await fioStav(env, 'posledni_ok'), 10) || 0;
                        fio.posledniDotaz = parseInt(await fioStav(env, 'posledni_dotaz'), 10) || 0;
                        const v = await fioStav(env, 'posledni_vysledek');
                        fio.posledni = v ? JSON.parse(v) : null;
                    } catch (e) {}
                    if (env.FIO_TOKEN && Date.now() - (fio.posledniDotaz || 0) > 60e3 && ctx && ctx.waitUntil)
                        ctx.waitUntil(fioZkontroluj(env, 'konzole').catch(() => {}));
                    const rows = await dbAll(env,
                        'SELECT o.*, a.name AS jmeno, a.tarif, a.tarif_do FROM orders o LEFT JOIN accounts a ON a.id=o.acc_id '
                        + 'ORDER BY o.created DESC LIMIT 300');
                    let pohyby = [];
                    try {
                        pohyby = await dbAll(env,
                            "SELECT * FROM fio_pohyby WHERE stav IN ('nezarazeno','podplaceno','duplicitni') ORDER BY ts DESC LIMIT 100");
                    } catch (e) {}
                    return json({ objednavky: rows || [], pohyby: pohyby, fio: fio, prodej: prodejCfg(env) });
                }

                // ruční „Zaplaceno" (vlastník to viděl ve výpisu)
                {
                    const mo = path.match(/^\/owner\/objednavky\/(\d{1,12})\/(zaplaceno|zrusit)$/);
                    if (mo && req.method === 'POST') {
                        await ensureProdejSchema(env);
                        const o = await env.DB.prepare('SELECT * FROM orders WHERE vs=?').bind(parseInt(mo[1], 10)).first();
                        if (!o) return err(404, 'Objednávka nenalezena.');
                        const b = await req.json().catch(() => null) || {};
                        if (mo[2] === 'zrusit') {
                            if (o.paid_ts) return err(409, 'Zaplacenou objednávku nejde zrušit — vypni Pro u účtu.');
                            await env.DB.prepare('UPDATE orders SET cancelled=1 WHERE vs=?').bind(o.vs).run();
                            return json({ ok: true });
                        }
                        if (o.paid_ts) return err(409, 'Už je zaplacená (' + (o.paid_by || '?') + ').');
                        if (o.cancelled) return err(409, 'Objednávka je zrušená.');
                        const dniZ = await objednavkaZaplacena(env, prodejCfg(env), o, 'vlastnik', b.castka != null ? (b.castka | 0) : o.amount, b.pozn || '');
                        if (!dniZ) return err(409, 'Částka nestačí ani na měsíc — nebo už je označená.');
                        return json({ ok: true, ucet: await dbFirst(env, 'SELECT id, code, name, tarif, tarif_do FROM accounts WHERE id=?', o.acc_id) });
                    }
                }

                // kouknout do banky hned (tlačítko v konzoli)
                if (req.method === 'POST' && path === '/owner/fio/zkontrolovat') {
                    const r = await fioZkontroluj(env, 'rucne');
                    return json(r);
                }

                // nezařazená platba → přiřadit účtu (kód) a zapnout Pro
                {
                    const mp = path.match(/^\/owner\/fio\/([\w.-]{1,40})\/priradit$/);
                    if (mp && req.method === 'POST') {
                        await ensureProdejSchema(env);
                        await ensureUctySchema(env);
                        const p = await env.DB.prepare('SELECT * FROM fio_pohyby WHERE id=?').bind(mp[1]).first();
                        if (!p) return err(404, 'Pohyb nenalezen.');
                        if (p.stav === 'sparovano' || p.stav === 'zarazeno') return err(409, 'Tenhle pohyb už je přiřazený.');
                        const b = await req.json().catch(() => null) || {};
                        const acc = await dbFirst(env, 'SELECT * FROM accounts WHERE code=?', String(b.code || '').toUpperCase());
                        if (!acc) return err(404, 'Účet s tímhle kódem není.');
                        const cfg = prodejCfg(env);
                        if (!dniZaCastku(cfg, p.castka)) return err(409, 'Částka nestačí ani na měsíc — zapni Pro ručně u účtu.');
                        // otevřená objednávka účtu, nebo nová rovnou zaplacená
                        let o = await env.DB.prepare('SELECT * FROM orders WHERE acc_id=? AND paid_ts IS NULL AND cancelled=0 ORDER BY created DESC').bind(acc.id).first();
                        if (!o) {
                            const nvs = novyVs();
                            await env.DB.prepare('INSERT INTO orders(vs,acc_id,code,amount,dni,created,cancelled) VALUES(?,?,?,?,?,?,0)')
                                .bind(nvs, acc.id, acc.code, p.castka, dniZaCastku(cfg, p.castka), Date.now()).run();
                            o = await env.DB.prepare('SELECT * FROM orders WHERE vs=?').bind(nvs).first();
                        }
                        if (!o || !await objednavkaZaplacena(env, cfg, o, 'vlastnik', p.castka, p.id)) return err(409, 'Nepodařilo se přiřadit.');
                        await env.DB.prepare("UPDATE fio_pohyby SET stav='zarazeno', order_vs=? WHERE id=?").bind(o.vs, p.id).run();
                        return json({ ok: true, vs: o.vs, ucet: await dbFirst(env, 'SELECT id, code, name, tarif, tarif_do FROM accounts WHERE id=?', acc.id) });
                    }
                }

                return err(404, 'Neznámá cesta konzole.');
            }

            const me = await auth(env, req);
            if (!me) return err(401, 'Neplatné nebo prošlé přihlášení.');

            // Token hodinek smi JEN cesty hodinek — viz poznamka v auth().
            if (me.watchJob && !(path === '/watch/points' || path === '/watch/tile'))
                return err(403, 'Token hodinek smí jen /watch/*.');

            // ZMRAZENÍ FIRMY (přepíná vlastník appky v konzoli). 2 = zamčeno úplpě,
            // 1 = jen ke čtení: v terénu se dá dál měřit a stáhnout, co už na serveru
            // je, ale nic se tam nezapisuje. Než někomu appku úplně vypnu, tohle
            // bývá to správné — nikoho to nevyhodí uprostřed měření.
            if (me.frozen >= 2) return err(403, 'Firma je dočasně zamčená správcem aplikace.');
            if (me.frozen >= 1 && req.method !== 'GET')
                return err(403, 'Firma je dočasně jen ke čtení — zápis na server je pozastavený.');

            // ---- ARCHIV PO ODCHODU Z FIRMY ---------------------------------
            // Kdo z firmy odešel, má prostor dál v přepínači, ale JEN KE ČTENÍ a
            // jen do dne odchodu. Zápis se sem nesmí dostat vůbec — jinak by
            // bývalý zaměstnanec psal firmě do dat. Ořez podle času řeší
            // jednotlivé čtecí cesty (`me.leftTs` níž).
            me.leftTs = me.left_ts || 0;
            if (me.leftTs && req.method !== 'GET') {
                // ⚠⚠ PŘEPÍNAČ PROSTORŮ MUSÍ ZŮSTAT PRŮJEZDNÝ. Přepnutí i vstup do
                //   firmy jsou POST, takže by je zákaz zápisu zavřel taky — a kdo
                //   se přihlásí do archivovaného prostoru, by se z něj UŽ NEDOSTAL
                //   VEN. Nic to neotevírá: /spaces/* sahá jen na členství účtu,
                //   ne na data firmy, a ta jsou dál jen ke čtení.
                if (path !== '/spaces' && path.indexOf('/spaces/') !== 0)
                    return err(403, 'Z tohoto prostoru jsi odešel — zůstává jen ke čtení.');
            }

            // ---- TARIF (placené cesty) --------------------------------------
            // ⚠⚠ TOHLE JE PŘED ROLÍ, NE ZA NÍ. Sólo uživatel je ve svém prostoru
            //   správce, takže rolí projde na všechno — a placené věci by měl
            //   zadarmo. Skrývání v appce na to nestačí: co se schová v UI, dá
            //   se v prohlížeči odkrýt, a příslušné volání by pak prošlo.
            if (placenaCesta(path) && me.tarif !== 'pro')
                return err(402, 'Tohle je ve verzi Pro.');

            // DENNÍ POČÍTADLO PO FIRMÁCH. Globální `stats` řekne, že je zle, ale
            // neřekne KDO — a při limitu 100 000/den je potřeba najít tu jednu
            // firmu, která by appku sundala všem ostatním. Zápis jde na pozadí;
            // když tabulka ještě není, doplní se schéma a příště to sedne.
            try {
                const dayF = new Date().toISOString().slice(0, 10);
                const pf = env.DB.prepare('INSERT INTO stats_firm(day,firm_id,n) VALUES(?,?,1) ON CONFLICT(day,firm_id) DO UPDATE SET n=n+1')
                    .bind(dayF, me.firm_id).run().catch(() => ensureOwnerSchema(env).catch(() => {}));
                if (ctx && ctx.waitUntil) ctx.waitUntil(pf);
            } catch (e) {}

            if (req.method === 'GET' && path === '/config') {
                const cfg = await configPayload(env, me.firm_id);
                // `tarif` chodí TÍMHLE kanálem schválně: appka /config obnovuje
                // sama, takže konec předplatného pozná bez dalšího dotazu — a
                // zámky placených nástrojů se rozsvítí samy, bez odhlášení.
                return json(Object.assign({
                    me: {
                        id: me.id, name: me.name, role: me.role,
                        ucet: me.accId || null, tarif: me.tarif,
                        vlastni: !!me.own, archiv: !!me.leftTs, odesel: me.leftTs || 0
                    },
                    prostory: me.accId ? await prostoryUctu(env, me.accId) : [],
                    vzkazy: await vzkazyPro(env, me)
                }, cfg));
            }
            // vzkaz od vlastníka přečten (návrh „vzkaz"): jen svůj (účet nebo firma)
            if (req.method === 'POST' && path === '/vzkaz/precteno') {
                const b = await req.json().catch(() => null) || {};
                const id = parseInt(b.id, 10);
                if (!id) return err(400, 'Chybí id.');
                await ensureOwnerPlusSchema(env);
                await env.DB.prepare('UPDATE vzkazy SET read_ts=? WHERE id=? AND read_ts IS NULL AND ((acc_id IS NOT NULL AND acc_id=?) OR (firm_id IS NOT NULL AND firm_id=?))')
                    .bind(Date.now(), id, me.accId || '', me.firm_id || '').run();
                return json({ ok: true });
            }

            // ---------------- objednávky Pro (koupě z appky) ------------------
            // ⚠ NENÍ v PLACENE_CESTY schválně: objednat si Pro musí umět právě
            //   ten, kdo Pro NEMÁ. Vždy jedna otevřená objednávka na účet — druhé
            //   klepnutí vrátí tu samou (stejný VS), aby člověk neposlal peníze
            //   pod dvěma symboly.
            if (req.method === 'POST' && path === '/objednavky') {
                if (!me.accId) return err(400, 'Účet ještě nemá identitu — přihlas se znovu.');
                await ensureProdejSchema(env);
                const cfg = prodejCfg(env);
                if (!cfg.iban) return err(503, 'Prodej ještě není zapnutý — Pro se zatím odemyká klíčem.');
                const b = await req.json().catch(() => null) || {};
                const pr = produkt(cfg, b.produkt || 'rok');
                if (!pr) return err(400, 'Neznámý produkt.');
                if (!await guardHit(env, 'obj:' + me.accId, 20, 864e5)) return err(429, 'Moc objednávek za den.');
                let o = await env.DB.prepare('SELECT * FROM orders WHERE acc_id=? AND paid_ts IS NULL AND cancelled=0 ORDER BY created DESC')
                    .bind(me.accId).first();
                if (o && (o.amount !== pr.cena || o.dni !== pr.dni)) {
                    // jiný produkt nebo změněná cena — stará neplacená objednávka
                    // by ukazovala jinou částku; platba na ni se stejně pozná (VS)
                    await env.DB.prepare('UPDATE orders SET cancelled=1 WHERE vs=?').bind(o.vs).run();
                    o = null;
                }
                if (!o) {
                    for (let i = 0; i < 5 && !o; i++) {
                        const vs = novyVs();
                        try {
                            await env.DB.prepare('INSERT INTO orders(vs,acc_id,code,amount,dni,created,cancelled) VALUES(?,?,?,?,?,?,0)')
                                .bind(vs, me.accId, me.acc.code, pr.cena, pr.dni, Date.now()).run();
                            o = await env.DB.prepare('SELECT * FROM orders WHERE vs=?').bind(vs).first();
                        } catch (e) { o = null; }       // srážka VS — zkus jiný
                    }
                    if (!o) return err(500, 'Nepodařilo se založit objednávku.');
                }
                return json({ objednavka: objednavkaProAppku(o, cfg, me.acc.code), prodej: cfgProAppku(cfg, me.acc), tarif: me.tarif, tarifDo: (me.acc && me.acc.tarif_do) || 0 });
            }

            // ZKOUŠKA ZDARMA — jednou na účet. Zapne Pro na PRODEJ_ZKOUSKA_DNI a
            // zapíše razítko; druhé klepnutí vrátí 409. Nákup během zkoušky se
            // připočte za její konec (zapniPro počítá od tarif_do).
            if (req.method === 'POST' && path === '/zkouska') {
                if (!me.accId || !me.acc) return err(400, 'Účet ještě nemá identitu — přihlas se znovu.');
                await ensureProdejSchema(env);
                const cfg = prodejCfg(env);
                if (!cfg.zkouskaDni) return err(503, 'Zkouška zdarma teď není.');
                const acc = await dbFirst(env, 'SELECT * FROM accounts WHERE id=?', me.accId);
                if (!acc) return err(404, 'Účet nenalezen.');
                if (acc.trial_ts) return err(409, 'Zkoušku už tenhle účet měl.');
                if (tarifUctu(acc) === 'pro') return err(409, 'Pro už máš.');
                const r = await env.DB.prepare('UPDATE accounts SET trial_ts=? WHERE id=? AND trial_ts IS NULL').bind(Date.now(), acc.id).run();
                if (!r || !r.meta || !r.meta.changes) return err(409, 'Zkoušku už tenhle účet měl.');
                const doKdy = await zapniPro(env, acc, cfg.zkouskaDni);
                return json({ ok: true, tarif: 'pro', tarifDo: doKdy, dni: cfg.zkouskaDni });
            }

            // stav mých objednávek — appka se ptá, když má kartu otevřenou
            if (req.method === 'GET' && path === '/objednavky/moje') {
                await ensureProdejSchema(env);
                const cfg = prodejCfg(env);
                const rows = me.accId
                    ? await dbAll(env, 'SELECT * FROM orders WHERE acc_id=? ORDER BY created DESC LIMIT 10', me.accId)
                    : [];
                return json({
                    objednavky: (rows || []).map(o => objednavkaProAppku(o, cfg, me.acc ? me.acc.code : '')),
                    prodej: cfgProAppku(cfg, me.acc), tarif: me.tarif, tarifDo: (me.acc && me.acc.tarif_do) || 0
                });
            }

            {
                const mz = path.match(/^\/objednavky\/(\d{1,12})$/);
                if (mz && req.method === 'DELETE') {
                    await ensureProdejSchema(env);
                    const o = await env.DB.prepare('SELECT * FROM orders WHERE vs=? AND acc_id=?').bind(parseInt(mz[1], 10), me.accId || '').first();
                    if (!o) return err(404, 'Objednávka nenalezena.');
                    if (o.paid_ts) return err(409, 'Zaplacená objednávka se neruší.');
                    await env.DB.prepare('UPDATE orders SET cancelled=1 WHERE vs=?').bind(o.vs).run();
                    return json({ ok: true });
                }
            }

            // ---------------- prostory účtu (přepínač) ------------------------
            // ⚠ VSTUP DO FIRMY JE DRUHÉ ČLENSTVÍ, NE PŘESUN. Vlastní prostor
            //   účtu zůstává navždy; při odchodu z firmy si člověk svá data
            //   odnáší, protože se nikdy nikam nehnula. Přesouvat `firm_id`
            //   u řádků by data zabilo — `usage`, `chat`, `sync_points`, `jobs`
            //   i `stats_firm` se přes něj klíčují.
            if (req.method === 'GET' && path === '/spaces') {
                if (!me.accId) return json({ prostory: [] });
                return json({ prostory: await prostoryUctu(env, me.accId), tarif: me.tarif });
            }

            if (req.method === 'POST' && path === '/spaces/switch') {
                if (!me.accId) return err(400, 'Účet ještě nemá prostory.');
                const b = await req.json().catch(() => null) || {};
                const p = (await prostoryUctu(env, me.accId)).find(x => x.firmId === b.firmId);
                if (!p) return err(404, 'Do tohoto prostoru účet nepatří.');
                if (p.zablokovan) return err(403, 'Členství je zablokované.');
                await dbRunSoft(env, 'UPDATE users SET last_login=? WHERE id=?', Date.now(), p.uid);
                return json({
                    token: await makeToken(env, { id: p.uid, firm_id: p.firmId }, me.accId),
                    user: { id: p.uid, name: me.name, role: p.role },
                    prostor: p,
                    config: await configPayload(env, p.firmId)
                });
            }

            // Vstup do firmy na POZVACÍ KÓD. Kód firmy tím přestává být částí
            // přihlášení a stává se jen pozvánkou — přihlašuje se kódem ÚČTU.
            if (req.method === 'POST' && path === '/spaces/join') {
                if (!me.accId) return err(400, 'Účet ještě nemá prostory.');
                const b = await req.json().catch(() => null) || {};
                const kod = String(b.code || '').trim().toUpperCase();
                if (kod.length !== 6) return err(400, 'Pozvací kód má šest znaků.');
                const ip = req.headers.get('CF-Connecting-IP') || '0';
                if (!await guardHit(env, 'join:' + ip, 20, 15 * 60e3))
                    return err(429, 'Příliš mnoho pokusů. Zkus to za 15 minut.');
                const firm = await dbFirst(env, 'SELECT id, name, max_users, frozen FROM firms WHERE code=?', kod);
                if (!firm) return err(404, 'Firma s tímto kódem neexistuje.');
                if (firm.frozen >= 2) return err(403, 'Firma je dočasně zamčená správcem aplikace.');
                // ⚠ JEDNOMÍSTNÝ PROSTOR NENÍ FIRMA. Do cizího sólo prostoru se
                //   pozvat nedá — jeho kód se ani nikde neukazuje, ale kdyby ho
                //   někdo uhodl, nesmí se tam dostat.
                if ((firm.max_users || FIRM_MAX_DEFAULT) <= SOLO_MAX)
                    return err(403, 'Tenhle kód nikam nezve.');
                const uz = await dbFirst(env, 'SELECT id, left_ts FROM users WHERE acc_id=? AND firm_id=?', me.accId, firm.id);
                if (uz && !uz.left_ts) return err(409, 'V téhle firmě už jsi.');
                const cnt = await dbFirst(env, 'SELECT COUNT(*) AS n FROM users WHERE firm_id=? AND left_ts IS NULL', firm.id);
                if (cnt && cnt.n >= (firm.max_users || FIRM_MAX_DEFAULT))
                    return err(409, 'Firma má zaplněná všechna místa.');
                if (uz) {
                    // NÁVRAT DO FIRMY, ZE KTERÉ ODEŠEL: členství se oživí, takže
                    // se mu vrátí i to, co tam kdysi naměřil. Zakládat druhé
                    // členství by ta data nechalo viset u toho archivovaného.
                    await env.DB.prepare('UPDATE users SET left_ts=NULL, disabled=0 WHERE id=?').bind(uz.id).run();
                    return json({ ok: true, firmId: firm.id, prostory: await prostoryUctu(env, me.accId) });
                }
                const acc = await dbFirst(env, 'SELECT * FROM accounts WHERE id=?', me.accId);
                const uid = crypto.randomUUID();
                try {
                    await env.DB.prepare(
                        'INSERT INTO users(id,firm_id,name,role,pass_hash,salt,iters,disabled,created,acc_id,own) '
                        + "VALUES(?,?,?,'zamestnanec',?,?,?,0,?,?,0)")
                        .bind(uid, firm.id, acc.name, acc.pass_hash, acc.salt, acc.iters, Date.now(), me.accId).run();
                } catch (e) {
                    return err(409, 'Ve firmě už je někdo se stejným jménem — ať ti admin založí místo ručně.');
                }
                return json({ ok: true, firmId: firm.id, prostory: await prostoryUctu(env, me.accId) });
            }

            // Odchod z firmy. NEMAŽE ČLENSTVÍ — vyplní `left_ts` a prostor
            // zůstane v přepínači jako zamrzlý archiv jen ke čtení.
            if (req.method === 'POST' && path === '/spaces/leave') {
                if (!me.accId) return err(400, 'Účet ještě nemá prostory.');
                const b = await req.json().catch(() => null) || {};
                const p = (await prostoryUctu(env, me.accId)).find(x => x.firmId === b.firmId);
                if (!p) return err(404, 'Do tohoto prostoru účet nepatří.');
                if (p.vlastni) return err(400, 'Z vlastního prostoru odejít nejde — je to místo, kde ti data zůstávají.');
                if (p.archiv) return err(409, 'Z téhle firmy už jsi odešel.');
                if (p.role === 'admin' && !await lastActiveAdminGuard(env, p.firmId, p.uid))
                    return err(400, 'Jsi poslední admin firmy — napřed předej správu někomu jinému.');
                await env.DB.prepare('UPDATE users SET left_ts=? WHERE id=?').bind(Date.now(), p.uid).run();
                return json({ ok: true, prostory: await prostoryUctu(env, me.accId) });
            }

            // Správce firmy smí bývalému členovi archiv i sebrat (rozhodnutí
            // uživatele 6. 9. 2026). Výchozí stav zůstává archiv — odcházející
            // si odnáší čitelnou kopii toho, na čem dělal —, ale firma, které to
            // vadí, má páku. Smaže se JEN členství: body a zakázky ve firmě
            // zůstávají, protože patří firmě, ne odešlému.
            if (req.method === 'POST' && path === '/spaces/archiv-pryc') {
                if (me.role !== 'admin') return err(403, 'Jen admin firmy.');
                const b = await req.json().catch(() => null) || {};
                const t = await dbFirst(env, 'SELECT id, left_ts, own FROM users WHERE id=? AND firm_id=?', b.uid, me.firm_id);
                if (!t) return err(404, 'Takové členství tu není.');
                if (!t.left_ts) return err(400, 'Tenhle člověk ve firmě pořád je — napřed ho odeber ze seznamu lidí.');
                if (t.own) return err(400, 'Vlastní prostor účtu se odebrat nedá.');
                await env.DB.prepare('DELETE FROM users WHERE id=?').bind(t.id).run();
                return json(await configPayload(env, me.firm_id));
            }

            if (req.method === 'PUT' && path === '/config') {
                if (me.role !== 'admin') return err(403, 'Jen admin.');
                const b = await req.json().catch(() => null);
                if (!b) return err(400, 'Chybí tělo.');
                if (b.firmName != null) await env.DB.prepare('UPDATE firms SET name=? WHERE id=?')
                    .bind(String(b.firmName).slice(0, 60), me.firm_id).run();
                if (b.autoLockMin != null) await env.DB.prepare('UPDATE firms SET auto_lock=? WHERE id=?')
                    .bind(Math.max(0, parseInt(b.autoLockMin, 10) || 0), me.firm_id).run();
                if (b.perms != null) await env.DB.prepare('UPDATE firms SET perms=? WHERE id=?')
                    .bind(JSON.stringify(b.perms).slice(0, 20000), me.firm_id).run();
                return json(await configPayload(env, me.firm_id));
            }

            // ---------------- správa uživatelů (admin) -----------------------
            if (req.method === 'POST' && path === '/users') {
                if (me.role !== 'admin') return err(403, 'Jen admin.');
                const b = await req.json().catch(() => null);
                if (!b || !b.name || !b.password || ROLES.indexOf(b.role) === -1) return err(400, 'Chybí name / password / platná role.');
                if (String(b.password).length < 8) return err(400, 'Heslo musí mít aspoň 8 znaků.');
                // STROP LIDÍ VE FIRMĚ. Počítají se i zablokovaní — místo drží
                // dál a jde uvolnit smazáním. Kdo potřebuje víc, pošle žádost
                // (POST /requests) a strop mu zvedne vlastník appky v konzoli.
                const cap = me.maxUsers || FIRM_MAX_DEFAULT;
                // left_ts IS NULL: kdo z firmy odešel, drží už jen archiv a
                // místo neblokuje — jinak by firmu po pár odchodech nešlo doplnit
                // a admin by musel mazat lidem archiv, aby vůbec mohl nabrat.
                const cnt = await dbFirst(env,
                    'SELECT COUNT(*) AS n FROM users WHERE firm_id=? AND left_ts IS NULL', me.firm_id);
                if (cnt && cnt.n >= cap)
                    return err(409, 'Firma má zaplněných všech ' + cap + ' míst. Uvolní se smazáním účtu, nebo požádej o navýšení tlačítkem u seznamu uživatelů.');
                const salt = randHex(16);
                const hash = await pbkdf2(String(b.password), salt, ITERS);
                const id = crypto.randomUUID();
                try {
                    await env.DB.prepare('INSERT INTO users(id,firm_id,name,role,pass_hash,salt,iters,disabled,created) VALUES(?,?,?,?,?,?,?,0,?)')
                        .bind(id, me.firm_id, String(b.name).slice(0, 40), b.role, hash, salt, ITERS, Date.now()).run();
                } catch (e) { return err(409, 'Uživatel s tímto jménem už ve firmě je.'); }
                return json(await configPayload(env, me.firm_id));
            }

            let m = /^\/users\/([\w-]+)$/.exec(path);
            if (m && (req.method === 'PATCH' || req.method === 'DELETE')) {
                if (me.role !== 'admin') return err(403, 'Jen admin.');
                const uid = m[1];
                const target = await env.DB.prepare('SELECT * FROM users WHERE id=? AND firm_id=?').bind(uid, me.firm_id).first();
                if (!target) return err(404, 'Uživatel nenalezen.');
                if (req.method === 'DELETE') {
                    if (target.role === 'admin' && !await lastActiveAdminGuard(env, me.firm_id, uid))
                        return err(400, 'Nelze smazat posledního admina.');
                    await env.DB.prepare('DELETE FROM users WHERE id=?').bind(uid).run();
                    return json(await configPayload(env, me.firm_id));
                }
                const b = await req.json().catch(() => null);
                if (!b) return err(400, 'Chybí tělo.');
                const demote = (b.role != null && b.role !== 'admin') || b.disabled === true;
                if (target.role === 'admin' && demote && !await lastActiveAdminGuard(env, me.firm_id, uid))
                    return err(400, 'Nelze odstavit posledního admina.');
                if (b.name != null) {
                    try {
                        await env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind(String(b.name).slice(0, 40), uid).run();
                    } catch (e) { return err(409, 'Uživatel s tímto jménem už ve firmě je.'); }
                }
                if (b.role != null && ROLES.indexOf(b.role) !== -1)
                    await env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind(b.role, uid).run();
                if (b.disabled != null)
                    await env.DB.prepare('UPDATE users SET disabled=? WHERE id=?').bind(b.disabled ? 1 : 0, uid).run();
                if (b.password != null) {
                    if (String(b.password).length < 8) return err(400, 'Heslo musí mít aspoň 8 znaků.');
                    const salt = randHex(16);
                    const hash = await pbkdf2(String(b.password), salt, ITERS);
                    await env.DB.prepare('UPDATE users SET pass_hash=?, salt=?, iters=? WHERE id=?').bind(hash, salt, ITERS, uid).run();
                }
                return json(await configPayload(env, me.firm_id));
            }

            // ---------------- žádost o víc míst ve firmě (admin firmy) ---------
            // Firma smí sama až FIRM_MAX_DEFAULT lidí. Nad to se posílá žádost
            // s odůvodněním, kterou vlastník appky vyřídí v konzoli. Stav
            // žádosti chodí zpátky v /config (pole `request`), takže žadatel
            // vidí "čeká na vyřízení" i po zavření appky.
            if (req.method === 'POST' && path === '/requests') {
                if (me.role !== 'admin') return err(403, 'Jen admin.');
                await ensureOwnerSchema(env);
                const b = await req.json().catch(() => null) || {};
                const want = Math.max(2, Math.min(500, parseInt(b.want, 10) || 0));
                const reason = b.reason ? String(b.reason).trim().slice(0, 600) : '';
                if (!want) return err(400, 'Chybí požadovaný počet míst.');
                if (reason.length < 10) return err(400, 'Napiš prosím pár slov, k čemu firma víc míst potřebuje.');
                const open = await env.DB.prepare("SELECT id FROM firm_requests WHERE firm_id=? AND state='new'")
                    .bind(me.firm_id).first();
                if (open) return err(409, 'Žádost už čeká na vyřízení.');
                if (!await guardHit(env, 'req:' + me.firm_id, 5, 30 * 864e5))
                    return err(429, 'Z této firmy už přišlo hodně žádostí. Ozvi se přímo přes Zpětnou vazbu.');
                await env.DB.prepare("INSERT INTO firm_requests(firm_id,ts,want,reason,who,state) VALUES(?,?,?,?,?,'new')")
                    .bind(me.firm_id, Date.now(), want, reason, me.name).run();
                return json(await configPayload(env, me.firm_id));
            }

            // ---------------- změna vlastního hesla --------------------------
            if (req.method === 'POST' && path === '/password') {
                const b = await req.json().catch(() => null);
                if (!b || b.old == null || !b.password) return err(400, 'Chybí old / password.');
                if (String(b.password).length < 8) return err(400, 'Heslo musí mít aspoň 8 znaků.');
                const u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(me.id).first();
                const oldHash = await pbkdf2(String(b.old), u.salt, u.iters);
                if (!timingSafeEq(oldHash, u.pass_hash)) return err(401, 'Staré heslo nesouhlasí.');
                const salt = randHex(16);
                const hash = await pbkdf2(String(b.password), salt, ITERS);
                await env.DB.prepare('UPDATE users SET pass_hash=?, salt=?, iters=? WHERE id=?').bind(hash, salt, ITERS, me.id).run();
                return json({ ok: true, offline: { salt: salt, iters: ITERS, hash: hash } });
            }

            // ---------------- firemní chat ------------------------------------
            if (req.method === 'POST' && path === '/chat') {
                const b = await req.json().catch(() => null);
                const txt = b && typeof b.txt === 'string' ? b.txt.trim().slice(0, 500) : '';
                if (!txt) return err(400, 'Prázdná zpráva.');
                // příjemce: null = všem ve firmě; jinak id uživatele TÉŽE firmy
                let to = null;
                if (b.to) {
                    const t = await env.DB.prepare('SELECT id FROM users WHERE id=? AND firm_id=?').bind(String(b.to), me.firm_id).first();
                    if (!t) return err(400, 'Adresát není ve firmě.');
                    to = t.id;
                }
                await env.DB.prepare('INSERT INTO chat(firm_id,uid,uname,ts,txt,to_uid) VALUES(?,?,?,?,?,?)')
                    .bind(me.firm_id, me.id, me.name, Date.now(), txt, to).run();
                // občasný úklid: server drží posledních ~500 zpráv na firmu
                if (Math.random() < 0.05) {
                    await env.DB.prepare(
                        'DELETE FROM chat WHERE firm_id=? AND id NOT IN (SELECT id FROM chat WHERE firm_id=? ORDER BY id DESC LIMIT 500)')
                        .bind(me.firm_id, me.firm_id).run();
                }
                return json({ ok: true, ts: Date.now() });
            }

            if (req.method === 'GET' && path === '/chat') {
                const after = parseInt(url.searchParams.get('after'), 10) || 0;
                // vidím: zprávy všem (to_uid IS NULL), zprávy mně, a své vlastní
                const vis = ' AND (to_uid IS NULL OR to_uid=? OR uid=?)';
                let rows;
                if (after > 0) {
                    rows = (await env.DB.prepare(
                        'SELECT id, uid, uname AS u, ts, txt, to_uid FROM chat WHERE firm_id=? AND id>?' + vis + ' ORDER BY id LIMIT 200')
                        .bind(me.firm_id, after, me.id, me.id).all()).results;
                } else {
                    // první načtení: posledních 100 zpráv (vzestupně)
                    rows = (await env.DB.prepare(
                        'SELECT id, uid, uname AS u, ts, txt, to_uid FROM chat WHERE firm_id=?' + vis + ' ORDER BY id DESC LIMIT 100')
                        .bind(me.firm_id, me.id, me.id).all()).results.reverse();
                }
                // ke jménům adresátů (pro popisek „jen pro Petra")
                const names = {};
                (await env.DB.prepare('SELECT id, name FROM users WHERE firm_id=?').bind(me.firm_id).all())
                    .results.forEach(r2 => { names[r2.id] = r2.name; });
                rows.forEach(r3 => { if (r3.to_uid) r3.toName = names[r3.to_uid] || '?'; });
                return json({ messages: rows, serverTime: Date.now(), me: { id: me.id, name: me.name } });
            }

            // ---------------- živá poloha (vysílačka) --------------------------
            // Ohlášení vlastní polohy. Klient posílá řídce (viz js/vysilacka.js) —
            // server nic nevynucuje, jen přepíše poslední známý stav.
            if (req.method === 'POST' && path === '/pos') {
                await ensurePosTable(env);
                const b = await req.json().catch(() => null);
                if (!b) return err(400, 'Chybí tělo.');
                const num = (v, min, max) => {
                    const n = Number(v);
                    return (isFinite(n) && n >= min && n <= max) ? n : null;
                };
                const lat = num(b.lat, -90, 90), lng = num(b.lng, -180, 180);
                const acc = num(b.acc, 0, 100000);
                const st = b.st ? String(b.st).slice(0, 40) : null;
                const job = b.job ? String(b.job).slice(0, 80) : null;
                const sos = b.sos ? 1 : 0;
                const now = Date.now();
                // sos_ts se drží od PRVNÍHO nouzového hlášení — ať je v seznamu vidět,
                // jak dlouho už poplach trvá, i když poloha mezitím doběhla novější
                const old = await env.DB.prepare('SELECT sos, sos_ts FROM pos WHERE firm_id=? AND uid=?')
                    .bind(me.firm_id, me.id).first();
                const sosTs = sos ? ((old && old.sos && old.sos_ts) ? old.sos_ts : now) : null;
                await env.DB.prepare(
                    'INSERT OR REPLACE INTO pos(firm_id,uid,uname,lat,lng,acc,st,job,sos,sos_ts,ts) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
                    .bind(me.firm_id, me.id, me.name, lat, lng, acc, st, job, sos, sosTs, now).run();
                return json({ ok: true, ts: now });
            }

            // Kdo je kde. Vrací jen čerstvé záznamy — stará poloha je horší než žádná,
            // protože podle ní by se kolega hledal na místě, kde dávno není. Nouze
            // (sos) drží delší okno, aby poplach nezmizel dřív, než se k němu někdo dostane.
            if (req.method === 'GET' && path === '/pos') {
                await ensurePosTable(env);
                const now = Date.now();
                const rows = (await env.DB.prepare(
                    'SELECT uid, uname AS u, lat, lng, acc, st, job, sos, sos_ts AS sosTs, ts FROM pos ' +
                    'WHERE firm_id=? AND (ts>? OR (sos=1 AND ts>?)) ORDER BY sos DESC, ts DESC LIMIT 60')
                    .bind(me.firm_id, now - 30 * 60000, now - 6 * 3600000).all()).results;
                return json({ people: rows, serverTime: now, me: { id: me.id, name: me.name } });
            }

            // ---------------- vytížení serveru (admin) -------------------------
            if (req.method === 'GET' && path === '/stats') {
                if (me.role !== 'admin') return err(403, 'Jen admin.');
                const days = (await env.DB.prepare('SELECT day, n FROM stats ORDER BY day DESC LIMIT 14').all()).results.reverse();
                async function cnt(sql, ...b) {
                    const row = await env.DB.prepare(sql).bind(...b).first();
                    return row ? row.n : 0;
                }
                return json({
                    limits: { reqPerDay: 100000, plan: 'Workers Free' },
                    today: new Date().toISOString().slice(0, 10),
                    days: days,   // [{day:'YYYY-MM-DD', n}] — požadavky CELÉHO API (všechny firmy)
                    rows: {
                        users: await cnt('SELECT COUNT(*) AS n FROM users WHERE firm_id=?', me.firm_id),
                        usage: await cnt('SELECT COUNT(*) AS n FROM usage WHERE firm_id=?', me.firm_id),
                        chat: await cnt('SELECT COUNT(*) AS n FROM chat WHERE firm_id=?', me.firm_id),
                        firms: await cnt('SELECT COUNT(*) AS n FROM firms')
                    }
                });
            }

            // ---------------- záloha firmy (admin) -----------------------------
            if (req.method === 'GET' && path === '/backup') {
                if (me.role !== 'admin') return err(403, 'Jen admin.');
                const firm = await env.DB.prepare('SELECT code, name, perms, auto_lock, created FROM firms WHERE id=?').bind(me.firm_id).first();
                // ZÁLOHA ZÁMĚRNĚ NEOBSAHUJE pass_hash/salt/iters. Je to obyčejný
                // JSON, který admin nosí v Downloads a posílá mailem — a PBKDF2
                // otisk krátkého hesla se dá dopočítat. Obnova firmy ze zálohy
                // stejně neexistuje, hesla se při zakládání nastavují nová.
                const users = (await env.DB.prepare('SELECT id, name, role, disabled, created FROM users WHERE firm_id=?').bind(me.firm_id).all()).results;
                const usage = (await env.DB.prepare('SELECT uid, uname, ts, t, k, proj, dev FROM usage WHERE firm_id=? ORDER BY ts DESC LIMIT 20000').bind(me.firm_id).all()).results;
                const chatRows = (await env.DB.prepare('SELECT id, uid, uname, ts, txt FROM chat WHERE firm_id=? ORDER BY id DESC LIMIT 500').bind(me.firm_id).all()).results;
                let perms; try { perms = JSON.parse(firm.perms); } catch (e) { perms = {}; }
                return json({
                    format: 'argeodet-firm-backup', v: 1, exportedTs: Date.now(),
                    firm: { code: firm.code, name: firm.name, autoLockMin: firm.auto_lock, perms: perms, created: firm.created },
                    users: users,
                    usage: usage.reverse(),
                    chat: chatRows.reverse(),
                    note: 'Hesla v záloze nejsou vůbec — ani jako otisky. Slouží jako pojistka/archiv.'
                });
            }

            // ---------------- chyby z telefonu -------------------------------
            // Protejsek js/err-log.js. Posila se JEN hlaska, soubor, radek, pocet
            // opakovani, verze appky a hrube oznaceni zarizeni - zadne souradnice,
            // zadny obsah mereni. Vlastnik to cte seskupene v GET /owner/errors.
            // ⚠ ODESILANI NESMI SHODIT APPKU ANI VYCERPAT LIMIT: klient posila
            //   nejvys jednou za deset minut, tady je strop 20 zaznamu na davku a
            //   200 zaznamu na firmu a den. Chybova smycka v jednom telefonu tak
            //   nemuze zaplnit databazi ostatnim.
            if (req.method === 'POST' && path === '/errors') {
                const b = await req.json().catch(() => null);
                if (!b || !Array.isArray(b.items)) return err(400, 'Chybí items[].');
                const items = b.items.slice(0, 20);
                if (!items.length) return json({ ok: true, saved: 0 });
                const ver = b.ver != null ? String(b.ver).slice(0, 20) : null;
                const dev = b.dev != null ? String(b.dev).slice(0, 20) : null;
                try {
                    const dnes = await env.DB.prepare('SELECT COUNT(*) AS n FROM errors WHERE firm_id=? AND ts>=?')
                        .bind(me.firm_id, Date.now() - 864e5).first();
                    if (dnes && dnes.n >= 200) return json({ ok: true, saved: 0, plno: true });
                } catch (e) { await ensureOwnerSchema(env); }
                const stE = env.DB.prepare(
                    'INSERT INTO errors(firm_id,uname,ts,sig,msg,src,line,n,ver,dev) VALUES(?,?,?,?,?,?,?,?,?,?)');
                const rowsE = items.map(it => stE.bind(
                    me.firm_id,
                    String(me.name || '?').slice(0, 40),
                    Math.min(Math.max(0, +it.t || Date.now()), Date.now() + 864e5),
                    String(it.sig || it.msg || '?').slice(0, 200),
                    String(it.msg || '?').slice(0, 300),
                    it.src != null ? String(it.src).slice(0, 120) : null,
                    parseInt(it.line, 10) || 0,
                    Math.max(1, Math.min(9999, parseInt(it.n, 10) || 1)),
                    ver, dev
                ));
                try { await env.DB.batch(rowsE); }
                catch (e) {
                    // tabulka jeste neexistuje (starsi nasazeni) - doplnit a zkusit znovu
                    await ensureOwnerSchema(env);
                    try { await env.DB.batch(rowsE); } catch (e2) { return json({ ok: false, saved: 0 }); }
                }
                return json({ ok: true, saved: rowsE.length });
            }

            // ---------------- záznamy užívání --------------------------------
            if (req.method === 'POST' && path === '/usage') {
                const b = await req.json().catch(() => null);
                if (!b || !Array.isArray(b.events)) return err(400, 'Chybí events[].');
                const evs = b.events.slice(0, 200);
                if (!evs.length) return json({ ok: true, saved: 0 });
                // uid/uname bere z události (na sdíleném zařízení mohl být offline
                // přihlášen jiný kolega, než komu patří token) — token určuje firmu
                const stmt = env.DB.prepare('INSERT INTO usage(firm_id,uid,uname,ts,t,k,proj,dev) VALUES(?,?,?,?,?,?,?,?)');
                await env.DB.batch(evs.map(ev => stmt.bind(
                    me.firm_id,
                    ev.uid != null ? String(ev.uid).slice(0, 40) : me.id,
                    ev.u != null ? String(ev.u).slice(0, 40) : me.name,
                    Math.min(Math.max(0, +ev.ts || Date.now()), Date.now() + 864e5),
                    String(ev.t || '?').slice(0, 12),
                    // 500: klíč směny nese i detail (stavba/parta/činnost, URI-encoded JSON)
                    ev.k != null ? String(ev.k).slice(0, 500) : null,
                    ev.proj != null ? String(ev.proj).slice(0, 60) : null,
                    ev.dev != null ? String(ev.dev).slice(0, 20) : null
                )));
                return json({ ok: true, saved: evs.length });
            }

            if (req.method === 'GET' && path === '/usage') {
                if (me.role !== 'admin') {
                    // vedení jen s oprávněním x.dashboard
                    if (me.role !== 'vedeni') return err(403, 'Jen admin nebo vedení.');
                    const firm = await env.DB.prepare('SELECT perms FROM firms WHERE id=?').bind(me.firm_id).first();
                    let p; try { p = JSON.parse(firm.perms); } catch (e) { p = {}; }
                    if (p && p.vedeni && p.vedeni['x.dashboard'] === false) return err(403, 'Vedení nemá dashboard povolený.');
                }
                const from = parseInt(url.searchParams.get('from'), 10) || 0;
                const rows = (await env.DB.prepare(
                    'SELECT uid, uname AS u, ts, t, k, proj, dev FROM usage WHERE firm_id=? AND ts>=? ORDER BY ts LIMIT 20000')
                    .bind(me.firm_id, from).all()).results;
                return json({ events: rows });
            }

            if (req.method === 'DELETE' && path === '/usage') {
                if (me.role !== 'admin') return err(403, 'Jen admin.');
                await env.DB.prepare('DELETE FROM usage WHERE firm_id=?').bind(me.firm_id).run();
                return json({ ok: true });
            }

            // ---------------- registr zakázek firmy ---------------------------
            // GET  /jobs                  — zakázky, na které přihlášený smí
            // POST /jobs {name}           — ohlášení zakázky (zakládá kdokoli v terénu)
            // PATCH /jobs/<key> {acl?,deleted?} — přidělení lidem / archivace (jen admin)
            if (path === '/jobs' && req.method === 'GET') {
                await ensureJobsTable(env);
                // srv<=? : archiv po odchodu je zamrzlý ke dni odchodu (viz auth)
                const rows = (await env.DB.prepare(
                    'SELECT job_key AS key, name, acl, ts, srv, deleted, uname FROM jobs '
                    + 'WHERE firm_id=? AND srv<=? ORDER BY name')
                    .bind(me.firm_id, me.leftTs || Number.MAX_SAFE_INTEGER).all()).results;
                const boss = (me.role === 'admin' || me.role === 'vedeni');
                const out = rows.filter(r => jobVisible(r, me)).map(r => ({
                    key: r.key, name: r.name, ts: r.ts, srv: r.srv, deleted: r.deleted ? 1 : 0,
                    uname: r.uname,
                    // ACL vidí jen admin/vedení — zaměstnanci není co ukazovat, kdo další na zakázce je
                    acl: boss ? (r.acl ? JSON.parse(r.acl) : null) : undefined
                }));
                return json({ jobs: out, canManage: me.role === 'admin', serverTime: Date.now() });
            }

            if (path === '/jobs' && req.method === 'POST') {
                await ensureJobsTable(env);
                const b = await req.json().catch(() => null);
                const name = b && typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
                if (!name) return err(400, 'Chybí name.');
                const key = (b && typeof b.key === 'string' && b.key.trim())
                    ? b.key.trim().slice(0, 80)
                    : name.toLowerCase().slice(0, 60);
                const now = Date.now();
                const ts = Math.min(Math.max(0, +(b && b.ts) || now), now + 60e3);
                // existující zakázku POST nepřepisuje (jen osvěží název) — ACL a archivaci
                // řídí admin přes PATCH, ať ji zaměstnanci nechtěně nevrací zpátky
                await env.DB.prepare(
                    'INSERT INTO jobs(firm_id,job_key,name,acl,ts,srv,deleted,uname) VALUES(?,?,?,NULL,?,?,0,?) ' +
                    'ON CONFLICT(firm_id,job_key) DO UPDATE SET name=excluded.name, ts=excluded.ts, srv=excluded.srv, uname=excluded.uname ' +
                    'WHERE excluded.ts>jobs.ts')
                    .bind(me.firm_id, key, name, ts, now, me.name).run();
                return json({ ok: true, key: key, serverTime: now });
            }

            if (path.startsWith('/jobs/') && req.method === 'PATCH') {
                if (me.role !== 'admin') return err(403, 'Přidělovat zakázky může jen admin.');
                await ensureJobsTable(env);
                const key = decodeURIComponent(path.slice('/jobs/'.length)).trim().slice(0, 80);
                if (!key) return err(400, 'Chybí klíč zakázky.');
                const b = await req.json().catch(() => null);
                if (!b) return err(400, 'Chybí tělo požadavku.');
                const row = await env.DB.prepare('SELECT job_key FROM jobs WHERE firm_id=? AND job_key=?')
                    .bind(me.firm_id, key).first();
                if (!row) return err(404, 'Zakázka na serveru není.');
                const now = Date.now();
                if (b.acl !== undefined) {
                    const acl = Array.isArray(b.acl)
                        ? JSON.stringify(b.acl.filter(x => typeof x === 'string').slice(0, 200))
                        : null;
                    await env.DB.prepare('UPDATE jobs SET acl=?, srv=? WHERE firm_id=? AND job_key=?')
                        .bind(acl, now, me.firm_id, key).run();
                }
                if (b.deleted !== undefined) {
                    await env.DB.prepare('UPDATE jobs SET deleted=?, srv=? WHERE firm_id=? AND job_key=?')
                        .bind(b.deleted ? 1 : 0, now, me.firm_id, key).run();
                }
                return json({ ok: true, serverTime: now });
            }

            // ---------------- živá synchronizace bodů zakázky ----------------
            // POST /sync/points {job, changes:[{id, data?, ts, deleted}]} — push
            //   změn ze zařízení; server bere změnu jen když je novější (ts)
            // GET  /sync/points?job=...&since=<srv> — pull změn od kurzoru
            if (path === '/sync/points' && req.method === 'POST') {
                await ensureSyncTable(env);
                const b = await req.json().catch(() => null);
                if (!b || typeof b.job !== 'string' || !b.job.trim() || !Array.isArray(b.changes))
                    return err(400, 'Chybí job / changes[].');
                const job = b.job.trim().slice(0, 80);
                if (!await jobAllowed(env, me, job)) return err(403, 'K této zakázce nemáš přístup.');
                const now = Date.now();
                const list = b.changes.slice(0, 300).filter(c =>
                    c && typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 80);
                if (!list.length) return json({ ok: true, saved: 0, serverTime: now });
                // upsert s last-write-wins: přepíše se jen starší záznam (excluded.ts > ts)
                const stmt = env.DB.prepare(
                    'INSERT INTO sync_points(firm_id,job_key,point_id,data,ts,srv,deleted,uname) VALUES(?,?,?,?,?,?,?,?) ' +
                    'ON CONFLICT(firm_id,job_key,point_id) DO UPDATE SET ' +
                    'data=excluded.data, ts=excluded.ts, srv=excluded.srv, deleted=excluded.deleted, uname=excluded.uname ' +
                    'WHERE excluded.ts>sync_points.ts');
                const vysledky = await env.DB.batch(list.map(c => stmt.bind(
                    me.firm_id, job, c.id,
                    c.deleted ? null : String(c.data == null ? '' : (typeof c.data === 'string' ? c.data : JSON.stringify(c.data))).slice(0, 8000),
                    Math.min(Math.max(0, +c.ts || now), now + 60e3),   // ochrana proti rozjetým hodinám
                    now,
                    c.deleted ? 1 : 0,
                    me.name
                )));
                // CO SERVER OPRAVDU ZAPSAL. Upsert starší změnu tiše zahodí
                // (WHERE excluded.ts>ts) — a klient si ji dosud odškrtl jako
                // odeslanou hned po HTTP 200, takže ji už nikdy neposlal a ta
                // úprava zmizela beze stopy. Vracíme proto seznam přijatých id.
                // Když D1 počet změn neumí říct, pole vynecháme a starší klient
                // se chová po staru.
                let prijato = null;
                try {
                    if (Array.isArray(vysledky) && vysledky.length === list.length) {
                        const m0 = vysledky[0] && vysledky[0].meta;
                        if (m0 && (m0.changes != null || m0.rows_written != null)) {
                            prijato = [];
                            for (let i = 0; i < list.length; i++) {
                                const m = vysledky[i] && vysledky[i].meta;
                                const n = m ? (m.changes != null ? m.changes : m.rows_written) : 0;
                                if (+n > 0) prijato.push(list[i].id);
                            }
                        }
                    }
                } catch (e) { prijato = null; }
                // občasný úklid: náhrobky starší půl roku už všechna zařízení viděla
                if (Math.random() < 0.02 && ctx && ctx.waitUntil) {
                    ctx.waitUntil(env.DB.prepare('DELETE FROM sync_points WHERE firm_id=? AND deleted=1 AND srv<?')
                        .bind(me.firm_id, now - 180 * 864e5).run().catch(() => {}));
                }
                const odpoved = { ok: true, saved: list.length, serverTime: now };
                if (prijato) odpoved.accepted = prijato;
                return json(odpoved);
            }

            if (path === '/sync/points' && req.method === 'GET') {
                await ensureSyncTable(env);
                const job = String(url.searchParams.get('job') || '').trim().slice(0, 80);
                if (!job) return err(400, 'Chybí ?job=.');
                if (!await jobAllowed(env, me, job)) return err(403, 'K této zakázce nemáš přístup.');
                // ADRESNÉ DOTAŽENÍ konkrétních bodů (?ids=a,b,c). Klient si o ně
                // řekne, když mu server zápis odmítl jako starší: kurzor `since`
                // by mu je nepřinesl, protože odmítnutý upsert srv neposunul,
                // takže ten řádek je dávno „za kurzorem". Strop 100 kvůli limitu
                // vázaných parametrů v D1.
                const idsQ = String(url.searchParams.get('ids') || '').trim();
                if (idsQ) {
                    const ids = idsQ.split(',').map(x => x.trim().slice(0, 80)).filter(x => x).slice(0, 100);
                    if (!ids.length) return json({ points: [], more: false, serverTime: Date.now() });
                    const otazniky = ids.map(() => '?').join(',');
                    const radky = (await env.DB.prepare(
                        'SELECT point_id AS id, data, ts, srv, deleted, uname FROM sync_points ' +
                        'WHERE firm_id=? AND job_key=? AND srv<=? AND point_id IN (' + otazniky + ')')
                        .bind(me.firm_id, job, me.leftTs || Number.MAX_SAFE_INTEGER, ...ids).all()).results;
                    return json({ points: radky, more: false, serverTime: Date.now() });
                }
                const since = parseInt(url.searchParams.get('since'), 10) || 0;
                // ⚠ ARCHIV JE ZAMRZLÝ. Kdo z firmy odešel, vidí svůj prostor dál,
                //   ale JEN do dne odchodu — jinak by bývalý zaměstnanec sledoval,
                //   co firma měří teď. Ořez patří do dotazu, ne za něj: filtrovat
                //   až po `LIMIT 500` by u aktivní firmy vracelo prázdné stránky.
                const strop = me.leftTs || Number.MAX_SAFE_INTEGER;
                const rows = (await env.DB.prepare(
                    'SELECT point_id AS id, data, ts, srv, deleted, uname FROM sync_points ' +
                    'WHERE firm_id=? AND job_key=? AND srv>? AND srv<=? ORDER BY srv LIMIT 500')
                    .bind(me.firm_id, job, since, strop).all()).results;
                return json({ points: rows, more: rows.length === 500, serverTime: Date.now() });
            }

            // ---------------- hodinky Garmin ----------------
            // POST /watch/code {job}            — mobil si vyžádá párovací kód
            // GET  /watch/points?lat&lon&n      — hodinky stáhnou okolní body
            // POST /watch/points {points:[…]}   — hodinky nahrají, co naměřily
            if (req.method === 'POST' && path === '/watch/code') {
                await ensureWatchTables(env);
                const b = await req.json().catch(() => null);
                const job = String((b && b.job) || '').trim().slice(0, 80);
                if (!job) return err(400, 'Chybí zakázka.');

                // bez O/0 a I/1/L — kód se opisuje z displeje na displej
                const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
                const a = new Uint8Array(6);
                crypto.getRandomValues(a);
                let kod = '';
                for (let i = 0; i < 6; i++) kod += ABC[a[i] % ABC.length];

                const exp = Date.now() + 10 * 60e3;
                await env.DB.prepare('INSERT OR REPLACE INTO watch_codes(code,firm_id,user_id,job_key,exp) VALUES(?,?,?,?,?)')
                    .bind(kod, me.firm_id, me.id, job, exp).run();
                // úklid prošlých, ať tabulka neroste donekonečna
                await env.DB.prepare('DELETE FROM watch_codes WHERE exp<?').bind(Date.now()).run();
                return json({ code: kod, job: job, exp: exp });
            }

            // mobil potvrdí kód, který ukazují hodinky, a přiřadí mu zakázku
            if (req.method === 'POST' && path === '/watch/claim') {
                await ensureWatchTables(env);
                const b = await req.json().catch(() => null);
                const kod = String((b && b.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
                const job = String((b && b.job) || '').trim().slice(0, 80);
                if (kod.length !== 6) return err(400, 'Chybí kód z hodinek.');
                if (!job) return err(400, 'Chybí zakázka.');

                const row = await env.DB.prepare('SELECT exp, firm_id FROM watch_pending WHERE code=?')
                    .bind(kod).first();
                if (!row || row.exp < Date.now()) return err(404, 'Kód neplatí — na hodinkách si nech ukázat nový.');
                if (row.firm_id) return err(409, 'Tenhle kód už byl použitý.');

                await env.DB.prepare('UPDATE watch_pending SET firm_id=?, user_id=?, job_key=? WHERE code=?')
                    .bind(me.firm_id, me.id, job, kod).run();
                return json({ ok: true, job: job });
            }

            // POST /watch/tiles {tiles:[{k, a:[lat,lon], r, p:[…], l:[…]}]} — mobil
            //   nahraje hotové dlaždice; GET /watch/tile?lat&lon — hodinky si
            //   vyzvednou tu, ve které stojí
            if (req.method === 'POST' && path === '/watch/tiles') {
                await ensureTileTable(env);
                const b = await req.json().catch(() => null);
                if (!b || !Array.isArray(b.tiles)) return err(400, 'Chybí tiles[].');
                const now = Date.now();
                const list = b.tiles.slice(0, 25).filter(t => t && typeof t.k === 'string' && t.k.length <= 32);
                if (!list.length) return json({ ok: true, saved: 0 });

                const stmt = env.DB.prepare(
                    'INSERT INTO watch_tiles(firm_id,k,data,ts) VALUES(?,?,?,?) ' +
                    'ON CONFLICT(firm_id,k) DO UPDATE SET data=excluded.data, ts=excluded.ts');
                await env.DB.batch(list.map(t => {
                    // ořez je pojistka proti nafouklé dlaždici — hodinky mají
                    // paměť v řádu stovek kB a víc by stejně neustály
                    const d = JSON.stringify({ a: t.a, r: t.r || 450, p: t.p || [], l: t.l || [] }).slice(0, 60000);
                    return stmt.bind(me.firm_id, t.k, d, now);
                }));
                return json({ ok: true, saved: list.length });
            }

            // POST /watch/select {job, ids:[…]} — které body chci mít v hodinkách.
            // Prázdné ids výběr zruší a hodinky zas berou prostě nejbližší okolí.
            if (req.method === 'POST' && path === '/watch/select') {
                await ensureTileTable(env);
                const b = await req.json().catch(() => null);
                const job = String((b && b.job) || '').trim().slice(0, 80);
                if (!job) return err(400, 'Chybí zakázka.');
                if (!await jobAllowed(env, me, job)) return err(403, 'K této zakázce nemáš přístup.');
                // ⚠ Posílají se CELÉ BODY, ne jen jejich id. Většina bodů, které
                // geodet potřebuje, jsou bodová pole ČÚZK — ta žijí jen v mobilu
                // (stahují se za běhu z ArcGIS) a v sync_points nikdy nebyly.
                // Odkaz na id by tedy nenašel nic.
                const body = Array.isArray(b.points)
                    ? b.points.filter(p => p && isFinite(+p.la) && isFinite(+p.lo) && p.c != null)
                        .slice(0, 200)
                        .map(p => ({
                            c: String(p.c).slice(0, 16),
                            la: +(+p.la).toFixed(7), lo: +(+p.lo).toFixed(7),
                            h: (p.h != null && isFinite(+p.h)) ? +(+p.h).toFixed(1) : null,
                            s: (p.s != null && isFinite(+p.s)) ? +(+p.s).toFixed(1) : null,
                            // Y a X v S-JTSK spočítal mobil - hodinky je jen ukazují
                            y: (p.y != null && isFinite(+p.y)) ? +(+p.y).toFixed(2) : null,
                            x: (p.x != null && isFinite(+p.x)) ? +(+p.x).toFixed(2) : null,
                            k: p.k ? String(p.k).slice(0, 16) : ''
                        }))
                    : [];

                if (!body.length) {
                    await env.DB.prepare('DELETE FROM watch_sel WHERE firm_id=? AND job_key=?')
                        .bind(me.firm_id, job).run();
                    return json({ ok: true, vybrano: 0 });
                }
                await env.DB.prepare('INSERT INTO watch_sel(firm_id,job_key,ids,ts) VALUES(?,?,?,?) ' +
                    'ON CONFLICT(firm_id,job_key) DO UPDATE SET ids=excluded.ids, ts=excluded.ts')
                    .bind(me.firm_id, job, JSON.stringify(body), Date.now()).run();
                return json({ ok: true, vybrano: body.length });
            }

            if (req.method === 'GET' && path === '/watch/tile') {
                await ensureTileTable(env);
                const lat = parseFloat(url.searchParams.get('lat'));
                const lon = parseFloat(url.searchParams.get('lon'));
                if (!isFinite(lat) || !isFinite(lon)) return err(400, 'Chybí lat/lon.');
                const k = tileKlic(lat, lon);
                const row = await env.DB.prepare('SELECT data FROM watch_tiles WHERE firm_id=? AND k=?')
                    .bind(me.firm_id, k).first();
                if (!row) return err(404, 'Pro tohle místo není připravená mapa.');
                return new Response('{"k":"' + k + '","t":' + row.data + '}', {
                    headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, CORS)
                });
            }

            if (path === '/watch/points' && (req.method === 'GET' || req.method === 'POST')) {
                await ensureSyncTable(env);
                await ensureWatchTables(env);
                // zakázku bere z tokenu (hodinky), jinak z parametru (zkoušení z mobilu)
                const job = (await watchJob(env, req)) ||
                    String(url.searchParams.get('job') || '').trim().slice(0, 80);
                if (!job) return err(400, 'Token není spárovaný na zakázku.');
                // Táž brána jako u /sync/points: přes ?job= sem jde vlézt i běžným
                // uživatelským tokenem, takže bez ní by hodinková cesta obcházela
                // přidělení zakázky (a vydala body i tomu, koho admin vyřadil).
                if (!await jobAllowed(env, me, job)) return err(403, 'K této zakázce nemáš přístup.');

                if (req.method === 'GET') {
                    const lat = parseFloat(url.searchParams.get('lat'));
                    const lon = parseFloat(url.searchParams.get('lon'));
                    const n = Math.min(Math.max(parseInt(url.searchParams.get('n'), 10) || 20, 1), 50);
                    if (!isFinite(lat) || !isFinite(lon)) return err(400, 'Chybí lat/lon.');

                    // Filtrování podle vzdálenosti dělá schválně SERVER: hodinky
                    // mají paměť v řádu stovek kB a celá zakázka se do nich nevejde.
                    const rows = (await env.DB.prepare(
                        'SELECT point_id AS id, data FROM sync_points ' +
                        'WHERE firm_id=? AND job_key=? AND deleted=0 LIMIT 3000')
                        .bind(me.firm_id, job).all()).results;

                    // Když si člověk v mobilu body vybral, platí jeho výběr a nic
                    // jiného se neposílá — „nejbližší" totiž nemusí být „ty,
                    // kvůli kterým tam jedu", a hlavně to bývají body ČÚZK,
                    // které v sync_points vůbec nejsou.
                    await ensureTileTable(env);
                    const sel = await env.DB.prepare('SELECT ids FROM watch_sel WHERE firm_id=? AND job_key=?')
                        .bind(me.firm_id, job).first();
                    if (sel && sel.ids) {
                        let vybrane = null;
                        try { vybrane = JSON.parse(sel.ids); } catch (e) { vybrane = null; }
                        if (Array.isArray(vybrane) && vybrane.length && vybrane[0] && vybrane[0].la != null) {
                            const kos2 = Math.cos(lat * Math.PI / 180);
                            vybrane.forEach(p => {
                                const dy = (+p.la - lat) * 111320;
                                const dx = (+p.lo - lon) * 111320 * kos2;
                                p._d = dx * dx + dy * dy;
                            });
                            vybrane.sort((a, b2) => a._d - b2._d);
                            return json({
                                points: vybrane.slice(0, n).map(p => { delete p._d; return p; }),
                                job: job
                            });
                        }
                    }

                    const kos = Math.cos(lat * Math.PI / 180);
                    const ven = [];
                    for (const r of rows) {
                        let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
                        if (!d || !isFinite(+d.lat) || !isFinite(+d.lng)) continue;
                        const dy = (+d.lat - lat) * 111320;
                        const dx = (+d.lng - lon) * 111320 * kos;
                        ven.push({
                            c: String(d.name == null ? r.id : d.name).slice(0, 16),
                            la: +(+d.lat).toFixed(7), lo: +(+d.lng).toFixed(7),
                            h: d.vyska != null ? +(+d.vyska).toFixed(1) : null,
                            s: d.acc != null ? +(+d.acc).toFixed(1) : null,
                            k: (d.prov && d.prov.kod) ? String(d.prov.kod).slice(0, 16) : '',
                            _d: dx * dx + dy * dy
                        });
                    }
                    ven.sort((a, b) => a._d - b._d);
                    const vybrane = ven.slice(0, n).map(p => { delete p._d; return p; });

                    // DALŠÍ BLOK ČÍSEL, ale JEN NA VYŽÁDÁNÍ (?blok=1).
                    //
                    // Hodinky si o něj řeknou, teprve když jim ten z párování došel
                    // (viz Cloud._stahni v garmin/hodinky). Přidělovat ho při každé
                    // synchronizaci NELZE: watchBlok() čísla opravdu ukusuje, takže
                    // by každé ťuknutí na „Synchronizovat" spolklo padesát čísel
                    // a v číslování by po nich zůstaly díry.
                    //
                    // Bez bloku začnou hodinky čísla psát s předponou „W" — nikdy
                    // nevyrobí bod se stejným číslem jako mobil, jen to vypadá hůř.
                    const out = { points: vybrane, job: job };
                    if (url.searchParams.get('blok')) {
                        const blok = await watchBlok(env, me.firm_id, job);
                        out.from = blok[0];
                        out.to = blok[1];
                    }
                    return json(out);
                }

                const b = await req.json().catch(() => null);
                if (!b || !Array.isArray(b.points)) return err(400, 'Chybí points[].');
                const now = Date.now();
                const list = b.points.slice(0, 200).filter(p =>
                    p && isFinite(+p.la) && isFinite(+p.lo) && p.c != null);
                if (!list.length) return json({ ok: true, saved: 0 });

                // Ukládá se PŘESNĚ v tom tvaru, co čte js/cloud-sync.js (funkce
                // slim/fromData) — jinak by se body v aplikaci neobjevily.
                const stmt = env.DB.prepare(
                    'INSERT INTO sync_points(firm_id,job_key,point_id,data,ts,srv,deleted,uname) VALUES(?,?,?,?,?,?,0,?) ' +
                    'ON CONFLICT(firm_id,job_key,point_id) DO UPDATE SET ' +
                    'data=excluded.data, ts=excluded.ts, srv=excluded.srv, deleted=0, uname=excluded.uname ' +
                    'WHERE excluded.ts>sync_points.ts');
                await env.DB.batch(list.map(p => {
                    const id = 'cpw_' + String(p.c).replace(/[^A-Za-z0-9_-]/g, '') + '_' + (p.t || 0);
                    const d = {
                        id: id, name: String(p.c).slice(0, 40),
                        lat: +p.la, lng: +p.lo, cat: 'CUSTOM', type: 'custom'
                    };
                    if (p.h != null && isFinite(+p.h)) d.vyska = +p.h;
                    if (p.s != null && isFinite(+p.s)) d.acc = +p.s;
                    d.prov = { src: 'garmin', kod: p.k ? String(p.k).slice(0, 16) : '', n: +p.n || 0 };
                    return stmt.bind(me.firm_id, job, id, JSON.stringify(d),
                        Math.min(Math.max(0, (+p.t || 0) * 1000 || now), now + 60e3), now, me.name);
                }));
                return json({ ok: true, saved: list.length, serverTime: now });
            }

            return err(404, 'Neznámá cesta.');
        } catch (e) {
            return err(500, 'Chyba serveru: ' + (e && e.message ? e.message : String(e)));
        }
    },

    // CRON (wrangler.toml → [triggers] crons). Jediná práce: kouknout do banky
    // a spárovat, co přišlo. Bez FIO_TOKEN se hned vrátí — běh nic nestojí.
    async scheduled(event, env, ctx) {
        try { await fioZkontroluj(env, 'cron'); } catch (e) {}
    }
};
