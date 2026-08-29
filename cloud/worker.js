// ============================================================================
// AR Geodet — firemní cloud API (Cloudflare Worker + D1)
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
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
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
function err(status, msg) { return json({ error: msg }, status); }

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
async function makeToken(env, user) {
    const payload = b64u(JSON.stringify({ u: user.id, f: user.firm_id, exp: Date.now() + TOKEN_DAYS * 864e5 }));
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
    const u = await env.DB.prepare('SELECT id, firm_id, name, role, disabled FROM users WHERE id=? AND firm_id=?')
        .bind(p.u, p.f).first();
    if (!u || u.disabled) return null;
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
    const firm = await env.DB.prepare('SELECT id, code, name, perms, auto_lock FROM firms WHERE id=?').bind(firmId).first();
    if (!firm) return null;
    const users = (await env.DB.prepare(
        'SELECT id, name, role, disabled FROM users WHERE firm_id=? ORDER BY name').bind(firmId).all()).results;
    let perms; try { perms = JSON.parse(firm.perms); } catch (e) { perms = {}; }
    return {
        firm: { code: firm.code, name: firm.name, autoLockMin: firm.auto_lock, perms: perms },
        users: users,
        serverTime: Date.now()
    };
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
            // v:6 = obsahuje bezpecnostni zmenu z commitu 9bc1401 (brzda prihlaseni
            //       na TRI klice vcetne IP, aby kolegovi nesel zamknout ucet, a
            //       odpoved /login uz neposila offline overovadlo z databaze).
            //
            // ⚠ `v` JE JEDINY ZPUSOB, JAK ZVENCI POZNAT, CO JE OPRAVDU NASAZENE:
            // vsechny ostatni cesty vraci 401 DRIV, nez se worker podiva na cestu,
            // takze ani neexistujici endpoint se nepozna od nenasazeneho. Kdyz se
            // worker.js zmeni tak, ze na tom klientovi zalezi, BUMPNI `v` — a po
            // nasazeni to overi:  python scripts/check_worker_deployed.py
            if (req.method === 'GET' && path === '/health') return json({ ok: true, ts: Date.now(), v: 6, wx: true, watch: true });

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

            // ---------------- registrace firmy ------------------------------
            if (req.method === 'POST' && path === '/firms') {
                const ip = req.headers.get('CF-Connecting-IP') || '?';
                if (!await guardHit(env, 'reg:' + ip, 5, 864e5)) return err(429, 'Příliš mnoho registrací z této adresy, zkus to zítra.');
                const b = await req.json().catch(() => null);
                if (!b || !b.firmName || !b.adminName || !b.password) return err(400, 'Chybí firmName / adminName / password.');
                if (String(b.password).length < 4) return err(400, 'Heslo musí mít aspoň 4 znaky.');
                const firmId = crypto.randomUUID(), userId = crypto.randomUUID();
                const salt = randHex(16);
                const hash = await pbkdf2(String(b.password), salt, ITERS);
                let code = firmCode();
                // pojistka na kolizi kódu (unikátní index) — 3 pokusy
                for (let i = 0; i < 3; i++) {
                    try {
                        await env.DB.prepare('INSERT INTO firms(id,code,name,perms,auto_lock,created) VALUES(?,?,?,?,0,?)')
                            .bind(firmId, code, String(b.firmName).slice(0, 60), defaultPermsJson(), Date.now()).run();
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

            // ---------------- přihlášení ------------------------------------
            if (req.method === 'POST' && path === '/login') {
                const b = await req.json().catch(() => null);
                if (!b || !b.code || !b.name || b.password == null) return err(400, 'Chybí code / name / password.');
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
                const firm = await env.DB.prepare('SELECT id FROM firms WHERE code=?').bind(String(b.code).toUpperCase()).first();
                if (!firm) return err(401, 'Firma s tímto kódem neexistuje.');
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
                const cfg = await configPayload(env, firm.id);
                return json({
                    token: await makeToken(env, u),
                    user: { id: u.id, name: u.name, role: u.role },
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

            const me = await auth(env, req);
            if (!me) return err(401, 'Neplatné nebo prošlé přihlášení.');

            if (req.method === 'GET' && path === '/config') {
                const cfg = await configPayload(env, me.firm_id);
                return json(Object.assign({ me: { id: me.id, name: me.name, role: me.role } }, cfg));
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
                if (String(b.password).length < 4) return err(400, 'Heslo musí mít aspoň 4 znaky.');
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
                    if (String(b.password).length < 4) return err(400, 'Heslo musí mít aspoň 4 znaky.');
                    const salt = randHex(16);
                    const hash = await pbkdf2(String(b.password), salt, ITERS);
                    await env.DB.prepare('UPDATE users SET pass_hash=?, salt=?, iters=? WHERE id=?').bind(hash, salt, ITERS, uid).run();
                }
                return json(await configPayload(env, me.firm_id));
            }

            // ---------------- změna vlastního hesla --------------------------
            if (req.method === 'POST' && path === '/password') {
                const b = await req.json().catch(() => null);
                if (!b || b.old == null || !b.password) return err(400, 'Chybí old / password.');
                if (String(b.password).length < 4) return err(400, 'Heslo musí mít aspoň 4 znaky.');
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
                const users = (await env.DB.prepare('SELECT id, name, role, pass_hash, salt, iters, disabled, created FROM users WHERE firm_id=?').bind(me.firm_id).all()).results;
                const usage = (await env.DB.prepare('SELECT uid, uname, ts, t, k, proj, dev FROM usage WHERE firm_id=? ORDER BY ts DESC LIMIT 20000').bind(me.firm_id).all()).results;
                const chatRows = (await env.DB.prepare('SELECT id, uid, uname, ts, txt FROM chat WHERE firm_id=? ORDER BY id DESC LIMIT 500').bind(me.firm_id).all()).results;
                let perms; try { perms = JSON.parse(firm.perms); } catch (e) { perms = {}; }
                return json({
                    format: 'argeodet-firm-backup', v: 1, exportedTs: Date.now(),
                    firm: { code: firm.code, name: firm.name, autoLockMin: firm.auto_lock, perms: perms, created: firm.created },
                    users: users,
                    usage: usage.reverse(),
                    chat: chatRows.reverse(),
                    note: 'Hesla jsou jen PBKDF2 otisky, nejsou čitelná. Slouží jako pojistka/archiv.'
                });
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
                const rows = (await env.DB.prepare(
                    'SELECT job_key AS key, name, acl, ts, srv, deleted, uname FROM jobs WHERE firm_id=? ORDER BY name')
                    .bind(me.firm_id).all()).results;
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
                await env.DB.batch(list.map(c => stmt.bind(
                    me.firm_id, job, c.id,
                    c.deleted ? null : String(c.data == null ? '' : (typeof c.data === 'string' ? c.data : JSON.stringify(c.data))).slice(0, 8000),
                    Math.min(Math.max(0, +c.ts || now), now + 60e3),   // ochrana proti rozjetým hodinám
                    now,
                    c.deleted ? 1 : 0,
                    me.name
                )));
                // občasný úklid: náhrobky starší půl roku už všechna zařízení viděla
                if (Math.random() < 0.02 && ctx && ctx.waitUntil) {
                    ctx.waitUntil(env.DB.prepare('DELETE FROM sync_points WHERE firm_id=? AND deleted=1 AND srv<?')
                        .bind(me.firm_id, now - 180 * 864e5).run().catch(() => {}));
                }
                return json({ ok: true, saved: list.length, serverTime: now });
            }

            if (path === '/sync/points' && req.method === 'GET') {
                await ensureSyncTable(env);
                const job = String(url.searchParams.get('job') || '').trim().slice(0, 80);
                if (!job) return err(400, 'Chybí ?job=.');
                const since = parseInt(url.searchParams.get('since'), 10) || 0;
                const rows = (await env.DB.prepare(
                    'SELECT point_id AS id, data, ts, srv, deleted, uname FROM sync_points ' +
                    'WHERE firm_id=? AND job_key=? AND srv>? ORDER BY srv LIMIT 500')
                    .bind(me.firm_id, job, since).all()).results;
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
    }
};
