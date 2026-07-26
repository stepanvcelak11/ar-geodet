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
