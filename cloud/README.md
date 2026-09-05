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

## Běží na serveru to, co mám v repu?

```
python scripts/check_worker_deployed.py
```

Přečte `v` z `worker.js`, zavolá `GET /health` živé služby a porovná.

**Proč zvlášť skript a ne prostě `curl`:** worker vrací `401` **dřív, než se
podívá na cestu**, takže i vymyšlený endpoint odpoví „Neplatné přihlášení“.
Podle odpovědí tedy *nejde* poznat, které endpointy nasazená verze zná —
jediný spolehlivý ukazatel je pole `v` v `/health`.

**Z toho plyne pravidlo:** změní-li se `worker.js` tak, že na tom klientovi
záleží, **bumpni `v`** u odpovědi `/health`. Jinak se po čase nedá zjistit,
jestli je změna venku, a poznámka „zbývá nasadit worker“ visí v úkolech měsíce.

**Stav 29. 8. 2026** (proměřeno, ne odhadnuto): služba běží,
`GET /health` → `{"ok":true,"v":5,"wx":true,"watch":true}`, `/wx/chmi`
i `/wx/chmi/day` odpovídají, všechny chráněné endpointy vracejí `401` (tedy
běží a chtějí token). Bezpečnostní úprava přihlašování z commitu `9bc1401`
ale `v` nebumpla, takže **zvenčí se nedá poznat, jestli je nasazená** — proto
je v repu nově `v: 6`. Po prvním `wrangler deploy` bude odpověď jednoznačná.

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
- `POST /chat` `{txt, to?}` (max 500 znaků; `to` = id uživatele → soukromá
  zpráva, bez `to` = všem ve firmě) · `GET /chat?after=id` — vrací veřejné
  zprávy + soukromé pro mě/ode mě; server drží posledních ~500 zpráv na firmu
  (vyžaduje sloupec `chat.to_uid` — u starší DB `ALTER TABLE chat ADD COLUMN to_uid TEXT;`)
- `GET /stats` (admin) — vytížení: denní počty požadavků (celé API, posledních
  14 dní, tabulka `stats`) + počty záznamů firmy; klient z toho kreslí ukazatel
  proti limitu free plánu
- `GET /backup` (admin) — kompletní záloha firmy (účty **bez hesel**,
  oprávnění, užívání max 20 000 záznamů, chat) jako JSON.
  ⚠ 5. 9. 2026: otisky hesel v záloze **nejsou vůbec** — dřív si je admin stáhl
  jako obyčejný soubor a mohl je hádat mimo server, kde na něj žádná brzda
  nedosáhne. Po obnově ze zálohy si tedy lidé nastaví heslo znovu.
- `POST /sync/points` · `GET /sync/points?job=...&since=...` — živá
  synchronizace vlastních bodů zakázky mezi zařízeními firmy (klient
  js/cloud-sync.js; tabulku `sync_points` si worker založí sám) —
  podrobně viz `README-sync.md`
- retence: server si při ~2 % požadavků na pozadí maže užívání starší ~12
  měsíců a denní čítače starší 60 dní

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
