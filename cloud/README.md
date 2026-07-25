# AR Geodet — firemní cloud (Cloudflare)

Backend pro přihlašování mezi zařízeními: firmy, uživatelé, role, oprávnění,
sběr užívání. Běží na **Cloudflare Workers + D1** (free plán: 100 000
požadavků/den, 5 GB databáze — pro malou firmu řádová rezerva, nepozastavuje se).

**Nasazeno (25. 7. 2026):** `https://ar-geodet-api.ar-geodet.workers.dev`
(worker `ar-geodet-api`, D1 `ar-geodet-db` id `774b47e6-41c0-4e3a-a738-cfbd0a5657ae`,
region WEUR, účet Cloudflare uživatele). Otestováno end-to-end (18 testů prošlo).

**Provoz je nezávislý na Claude.** Claude byl použit jen k napsání a prvnímu
nasazení; všechno níže jde udělat ručně.

## Soubory

| soubor | co je |
|---|---|
| `worker.js` | celé API (jeden soubor, bez závislostí a bez build kroku) |
| `schema.sql` | schéma D1 databáze (idempotentní) |
| `wrangler.toml` | konfigurace pro ruční nasazení |

## Ruční nasazení / aktualizace (bez Claude)

1. Nainstaluj [wrangler](https://developers.cloudflare.com/workers/wrangler/):
   `npm i -g wrangler` a přihlas se `wrangler login`.
2. Jednorázově vytvoř databázi: `wrangler d1 create ar-geodet-db`
   a vrácené `database_id` vlož do `wrangler.toml`.
3. Aplikuj schéma: `wrangler d1 execute ar-geodet-db --remote --file=schema.sql`
4. Nasaď: `wrangler deploy` (spouštět ve složce `cloud/`).

Alternativně jde `worker.js` vložit přes webový editor v dashboardu
(Workers & Pages → ar-geodet-api → Edit code) — jen musí zůstat D1 binding `DB`.

## API (vše JSON; autentizace `Authorization: Bearer <token>`)

- `GET /health` — test běhu
- `POST /firms` `{firmName, adminName, password}` → založí firmu, vrátí token,
  **kód firmy** (tím se připojují další zařízení) a konfiguraci
- `POST /login` `{code, name, password}` → token + konfigurace + offline
  ověřovadlo (pro odemknutí bez signálu)
- `GET /config` / `PUT /config` (admin) `{firmName?, autoLockMin?, perms?}`
- `POST /users` (admin) `{name, role, password}` · `PATCH /users/:id` (admin)
  `{name?, role?, password?, disabled?}` · `DELETE /users/:id` (admin)
- `POST /password` `{old, password}` — změna vlastního hesla
- `POST /usage` `{events:[{ts,t,k,proj,dev}]}` · `GET /usage?from=ts`
  (admin / vedení s oprávněním) · `DELETE /usage` (admin)
- `POST /chat` `{txt}` (max 500 znaků) · `GET /chat?after=id` — firemní chat;
  server drží posledních ~500 zpráv na firmu
- `GET /stats` (admin) — vytížení: denní počty požadavků (celé API, posledních
  14 dní, tabulka `stats`) + počty záznamů firmy; klient z toho kreslí ukazatel
  proti limitu free plánu

**Po přidání chatu/statistik (větev feat/auth-first-firmy-grafy) je potřeba
znovu aplikovat `schema.sql` (nové tabulky `chat` a `stats`) a znovu nasadit
`worker.js`** — jinak appka funguje po staru a chat/vytížení ohlásí chybu.

## Bezpečnost (poctivě)

- hesla PBKDF2-SHA256, 40 000 iterací, sůl 16 B (Workers strop je 100 000;
  free plán má 10 ms CPU/req, doporučené pásmo 20–80k)
- tokeny HMAC-SHA256, platnost 60 dní; každý požadavek ověřuje uživatele v DB,
  takže zablokování účtu platí okamžitě
- zámek přihlašování 8 chyb → 15 min; registrace firem max 5/den z jedné IP
- ochrana posledního admina (nejde smazat/odstavit/degradovat)
- určeno pro geodetická data malé firmy — přiměřené, ne bankovní úroveň
