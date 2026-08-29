-- AR Geodet — firemní cloud (Cloudflare D1)
-- Schéma se aplikuje příkazem: wrangler d1 execute ar-geodet-db --remote --file=cloud/schema.sql
-- (nebo přes Claude/Cloudflare dashboard). Všechny příkazy jsou idempotentní.

CREATE TABLE IF NOT EXISTS firms (
    id        TEXT PRIMARY KEY,          -- uuid
    code      TEXT UNIQUE NOT NULL,      -- krátký kód firmy pro připojení zařízení (např. K7M2PX)
    name      TEXT NOT NULL,
    perms     TEXT NOT NULL,             -- JSON: { vedeni: {klic:bool}, zamestnanec: {...} }
    auto_lock INTEGER NOT NULL DEFAULT 0,-- minuty auto-zámku (0 = vypnuto)
    created   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id        TEXT PRIMARY KEY,          -- uuid
    firm_id   TEXT NOT NULL,
    name      TEXT NOT NULL,
    role      TEXT NOT NULL,             -- admin | vedeni | zamestnanec
    pass_hash TEXT NOT NULL,             -- hex PBKDF2-SHA256
    salt      TEXT NOT NULL,             -- hex 16 B
    iters     INTEGER NOT NULL,          -- iterace PBKDF2 (40000; Workers max 100000)
    disabled  INTEGER NOT NULL DEFAULT 0,
    created   INTEGER NOT NULL,
    UNIQUE (firm_id, name)
);
CREATE INDEX IF NOT EXISTS idx_users_firm ON users(firm_id);

-- záznamy užívání ze všech zařízení (append-only)
CREATE TABLE IF NOT EXISTS usage (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id TEXT NOT NULL,
    uid     TEXT,                        -- id uživatele (může být smazán — jméno zůstává)
    uname   TEXT,
    ts      INTEGER NOT NULL,            -- čas události v ms (čas zařízení)
    t       TEXT NOT NULL,               -- login | tool | pt-add | pt-edit | pt-del | act
    k       TEXT,                        -- klíč (id nástroje / bodu)
    proj    TEXT,                        -- id zakázky
    dev     TEXT                         -- id zařízení
);
CREATE INDEX IF NOT EXISTS idx_usage_firm_ts ON usage(firm_id, ts);

-- počítadla pro rate-limit (přihlašování, zakládání firem)
CREATE TABLE IF NOT EXISTS guard (
    k     TEXT PRIMARY KEY,
    n     INTEGER NOT NULL,
    until INTEGER NOT NULL
);

-- interní klíče (podepisovací tajemství tokenů, vygeneruje se samo při 1. požadavku)
CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);

-- firemní chat (server drží posledních ~500 zpráv na firmu, starší se mažou)
CREATE TABLE IF NOT EXISTS chat (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id TEXT NOT NULL,
    uid     TEXT,                        -- id autora (může být smazán — jméno zůstává)
    uname   TEXT,
    ts      INTEGER NOT NULL,            -- čas zprávy v ms (čas serveru)
    txt     TEXT NOT NULL,               -- max 500 znaků (ořezává server)
    to_uid  TEXT                         -- NULL = všem ve firmě; jinak soukromá zpráva
);
CREATE INDEX IF NOT EXISTS idx_chat_firm ON chat(firm_id, id);
-- Když tabulka chat existuje z dřívějšího nasazení BEZ to_uid, přidej sloupec
-- (SQLite neumí IF NOT EXISTS u ALTER — příkaz jednou selže a to je v pořádku):
-- ALTER TABLE chat ADD COLUMN to_uid TEXT;

-- denní počítadlo požadavků (hlídání limitu free plánu Workers: 100 000/den)
CREATE TABLE IF NOT EXISTS stats (
    day TEXT PRIMARY KEY,                -- YYYY-MM-DD (UTC)
    n   INTEGER NOT NULL
);

-- živá synchronizace vlastních bodů zakázky mezi zařízeními firmy
-- (js/cloud-sync.js; worker si tabulku umí založit i sám při prvním použití)
CREATE TABLE IF NOT EXISTS sync_points (
    firm_id  TEXT NOT NULL,
    job_key  TEXT NOT NULL,              -- normalizovaný NÁZEV zakázky (párování mezi zařízeními)
    point_id TEXT NOT NULL,              -- id bodu z klienta (cp_...)
    data     TEXT,                       -- JSON bodu (bez fotek); NULL u smazaného
    ts       INTEGER NOT NULL,           -- čas změny na zařízení (last-write-wins)
    srv      INTEGER NOT NULL,           -- čas zápisu na serveru (kurzor stahování)
    deleted  INTEGER NOT NULL DEFAULT 0, -- 1 = náhrobek (bod smazán)
    uname    TEXT,                       -- kdo změnu poslal (informativní)
    PRIMARY KEY (firm_id, job_key, point_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_firm_job_srv ON sync_points(firm_id, job_key, srv);

-- schranka "napiste mi" (js/zpetna-vazba.js; worker si tabulku umi zalozit i sam)
-- PSANI je verejne (bez tokenu, limit 20/den na IP), CTENI ma jen vlastnik appky:
--   wrangler secret put OWNER_KEY --name ar-geodet-api
-- Firemni ucty do teto tabulky nevidi - chodi do ni zpravy od cizich lidi.
CREATE TABLE IF NOT EXISTS feedback (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      INTEGER NOT NULL,            -- cas prijeti na serveru (ms)
    kind    TEXT,                        -- chyba | napad | pochvala | jine
    txt     TEXT NOT NULL,               -- max 4000 znaku (oreze server)
    contact TEXT,                        -- e-mail, kdyz clovek chce odpoved (nepovinne)
    meta    TEXT,                        -- JSON: verze appky, telefon, prohlizec (nepovinne)
    who     TEXT,                        -- jmeno z prihlaseni, pokud bylo (informativni)
    done    INTEGER NOT NULL DEFAULT 0   -- 1 = vyrizeno
);
CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(done, id);

-- ---------------------------------------------------------------------------
-- SPRÁVA APLIKACE (konzole vlastníka, js/sprava-appky.js + routy /owner/*)
-- Worker si tohle umí doplnit i sám při prvním použití (ensureOwnerSchema),
-- takže nasazení nového worker.js NEVYŽADUJE ruční migraci. Tady je to kvůli
-- úplnosti schématu — SQLite neumí IF NOT EXISTS u ALTER, takže na existující
-- databázi ty čtyři ALTERy jednou selžou a to je v pořádku:
--   ALTER TABLE firms ADD COLUMN max_users INTEGER NOT NULL DEFAULT 10;
--   ALTER TABLE firms ADD COLUMN frozen    INTEGER NOT NULL DEFAULT 0;  -- 0 běží / 1 jen čtení / 2 zamčeno
--   ALTER TABLE firms ADD COLUMN note      TEXT;                        -- poznámka vlastníka appky
--   ALTER TABLE firms ADD COLUMN founder   TEXT;                        -- PODEPSANÁ IP zakladatele, ne IP sama

-- žádost firmy o navýšení počtu míst (firma smí sama 10 lidí)
CREATE TABLE IF NOT EXISTS firm_requests (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id TEXT NOT NULL,
    ts      INTEGER NOT NULL,          -- kdy žádost přišla
    want    INTEGER NOT NULL,          -- kolik míst firma chce celkem
    reason  TEXT,                      -- odůvodnění (max 600 znaků)
    who     TEXT,                      -- jméno admina, který žádost poslal
    state   TEXT NOT NULL DEFAULT 'new', -- new | ok | no
    decided INTEGER,                   -- kdy jsem rozhodl
    reply   TEXT                       -- co jsem k tomu napsal (vidí žadatel)
);
CREATE INDEX IF NOT EXISTS idx_freq_firm ON firm_requests(firm_id, id);

-- denní počet požadavků PO FIRMÁCH. Globální `stats` řekne, že je zle, ale
-- neřekne KDO — a při limitu 100 000/den je potřeba najít tu jednu firmu,
-- která by appku sundala všem ostatním.
CREATE TABLE IF NOT EXISTS stats_firm (
    day     TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
    firm_id TEXT NOT NULL,
    n       INTEGER NOT NULL,
    PRIMARY KEY (day, firm_id)
);

-- Hláška všem firmám se ukládá do už existující tabulky meta pod klíčem
-- 'notice' jako JSON {txt, ts, until} — chodí klientům s každou /config.
