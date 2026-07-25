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
    txt     TEXT NOT NULL                -- max 500 znaků (ořezává server)
);
CREATE INDEX IF NOT EXISTS idx_chat_firm ON chat(firm_id, id);

-- denní počítadlo požadavků (hlídání limitu free plánu Workers: 100 000/den)
CREATE TABLE IF NOT EXISTS stats (
    day TEXT PRIMARY KEY,                -- YYYY-MM-DD (UTC)
    n   INTEGER NOT NULL
);
