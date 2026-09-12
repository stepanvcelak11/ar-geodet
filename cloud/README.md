# QTRIG — firemní cloud (Cloudflare)

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

## Klíč vlastníka `OWNER_KEY` (konzole, schránka, žádosti o Pro)

**⚠ Proč „nastavený" klíč mizel (12. 9. 2026):** `wrangler deploy` (běží sám
z GitHubu po každém pushi do `cloud/`) přepisuje proměnné typu **Text** z
dashboardu tím, co je v `[vars]` — tedy ničím. Klíč uložený jako Text byl po
každém nasazení pryč a `/owner/*` vracelo 503. Od v13 drží `keep_vars = true`
ve `wrangler.toml` a nasazení umí klíč sázet ze secretu repozitáře.

Dvě cesty (stačí jedna):
1. **GitHub → Settings → Secrets and variables → Actions → `OWNER_KEY`** —
   `deploy-worker.yml` ho po nasazení zapíše jako secret workeru (a v souhrnu
   běhu napíše, že ano; kratší než 24 znaků nebo s jinými znaky než `a-z0-9_-`
   odmítne a řekne proč).
2. dash.cloudflare.com → Workers & Pages → ar-geodet-api → Settings →
   Variables and Secrets → typ **Secret** → `OWNER_KEY` → **Deploy**.

Ověření bez appky: `GET /health` → `"ownerKey":"ok"` (`"chybi"` = není,
`"kratky"` = pod 24 znaků). Odpověď 503 z `/owner/*` nese totéž pole.

V appce: „Přihlásit jiné jméno" → jméno `VLASTNIK`, heslo = klíč.

## Žádosti o Pro (12. 9. 2026)

Pro se neprodává samo: karta Verze Pro (`js/pro-karta.js`) pošle
`POST /feedback` s `kind: "pro"`, kontaktem a `meta.ucet` (kód účtu). Vlastník
je vyřídí v Lidé a prodej → Žádosti (`GET /feedback?stav=open`, pak
`POST /owner/tarif` + `POST /feedback/done`). Koupě se v appce ukáže sama, až
bude nastavený `PRODEJ_IBAN` (viz níž).

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

## Prodej Pro — zapnutí krok za krokem (11. 9. 2026)

Kód umí prodávat předplatné Pro (měsíc / rok) a zkoušku zdarma; platí se
QR platbou na účet vlastníka a Pro se zapne buď ručně z Konzole vlastníka
(Lidé a prodej Pro), nebo **samo** podle výpisu z Fio banky. Dokud není
nastaven `PRODEJ_IBAN`, je prodej vypnutý — appka ukáže ceník a řekne, že se
zatím platí klíčem. Nic z toho nevyžaduje změnu kódu.

**Proměnné workeru** (dash.cloudflare.com → Workers & Pages → ar-geodet-api →
Settings → Variables and Secrets; obyčejné „Variables", ne secrets):

| proměnná | význam | výchozí |
|---|---|---|
| `PRODEJ_IBAN` | účet, kam se platí (IBAN bez mezer). **Prázdné = prodej vypnutý.** | — |
| `PRODEJ_UCET` | totéž lidsky, např. `2301234567/2010` (jen k zobrazení) | — |
| `PRODEJ_CENA_MESIC` | Kč za 30 dní | 149 |
| `PRODEJ_CENA_ROK` | Kč za 365 dní | 990 |
| `PRODEJ_ZKOUSKA_DNI` | zkouška zdarma, jednou na účet (0 = žádná) | 3 |
| `PRODEJ_PRIJEMCE` | jméno příjemce do QR | QTRIG |

**Automat z banky (volitelné, Fio):** v internetovém bankovnictví Fio →
Nastavení → API → vytvořit token **jen pro čtení pohybů**; uložit jako
**secret** `FIO_TOKEN` (`wrangler secret put FIO_TOKEN --name ar-geodet-api`
nebo v dashboardu jako Secret). Cron v `wrangler.toml` (`*/5 * * * *`) pak
každých 5 minut stáhne pohyby za 7 dní, spáruje je podle variabilního symbolu
(náhradně podle kódu účtu ve zprávě) a zapne Pro. Co se nespáruje, ukáže
konzole jako „nezařazenou platbu" k ručnímu přiřazení. Bez tokenu cron hned
skončí a nic nestojí.

**Než se prodej zapne:** doplnit zástupné údaje v `podminky.html` (jméno,
IČO, sídlo, e-mail, číslo účtu, datum) — dokud tam jsou hranaté závorky,
`PRODEJ_IBAN` nechat prázdný. Živnost, daně a Google Play viz poznámky
k projektu.

**Routy:** `POST /objednavky {produkt}` (založí/vrátí otevřenou objednávku:
VS + SPAYD), `GET /objednavky/moje`, `DELETE /objednavky/:vs`, `POST /zkouska`;
konzole: `GET /owner/ucty` (lidé, prostory, aktivita, objednávky),
`POST /owner/tarif {id|code, tarif, dni}` (0 = navždy, prodlužuje od konce
běžícího), `POST /owner/blokace {id|code, disabled}`, `GET /owner/objednavky`,
`POST /owner/objednavky/:vs/zaplaceno|zrusit`, `POST /owner/fio/zkontrolovat`,
`POST /owner/fio/:id/priradit {code}`. Testy: `scripts/test_prodej_worker.py`
(routy ve V8 s falešnou D1), `scripts/test_prodej.py` (appka v Chromiu).

## Bezpečnost (poctivě)

- hesla PBKDF2-SHA256, 40 000 iterací, sůl 16 B (Workers strop je 100 000;
  free plán má 10 ms CPU/req, doporučené pásmo 20–80k)
- tokeny HMAC-SHA256, platnost 60 dní; každý požadavek ověřuje uživatele v DB,
  takže zablokování účtu platí okamžitě
- zámek přihlašování 8 chyb → 15 min; registrace firem max 5/den z jedné IP
- ochrana posledního admina (nejde smazat/odstavit/degradovat)
- určeno pro geodetická data malé firmy — přiměřené, ne bankovní úroveň


## Brzda vydání (od 12. 9. 2026, worker v16)

Vlastník vyvíjí a testuje na svém telefonu, ale lidem venku nesmí každý push
skákat do appky. Proto:

- `GET /vydano` (veřejné) vrací `{verze, ts, pozn}` — číslo verze (SHELL_CACHE
  v `sw.js`), která je „puštěná" ostatním. `verze: null` = brzda vypnutá.
- `sw.js` se před instalací nové verze zeptá `/vydano`; když je jeho verze vyšší,
  instalaci odmítne (nic se nestáhne, lidé pracují dál po staru). Výjimky: telefon
  vlastníka (značka `ag-vlastnik` v Cache Storage), první instalace, nedostupný
  server (fail-open).
- Konzole vlastníka → **Pustit tuhle verzi ostatním** → `POST /owner/vydat
  {verze}`; `{verze: null}` brzdu vypne. Zapisuje se do deníku vlastníka (`vydani`).
- Stav leží v tabulce `fio_stav` pod klíčem `vydano` (obecné k/v, žádná migrace).
