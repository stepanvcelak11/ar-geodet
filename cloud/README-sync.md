# Živá synchronizace bodů ve firmě — nasazení

Sdílení vlastních bodů zakázky mezi zařízeními přihlášenými do stejné cloudové
firmy. Klient je `js/cloud-sync.js` (v appce), server je rozšíření stávajícího
workeru `cloud/worker.js` o endpointy `/sync/points` a tabulku `sync_points`.

## Co je potřeba nasadit (jednorázově)

Stačí **znovu nasadit `worker.js`** — tabulku `sync_points` si worker založí
sám při prvním požadavku na `/sync/points` (`CREATE TABLE IF NOT EXISTS`).
Žádný ruční SQL příkaz není nutný.

Varianta A — wrangler (ve složce `cloud/`):

```
wrangler deploy
```

Varianta B — Cloudflare dashboard: Workers & Pages → **ar-geodet-api** →
Edit code → vložit celý obsah `cloud/worker.js` → Deploy. (D1 binding `DB`
musí zůstat beze změny.)

Volitelně (jen pro pořádek, není nutné — worker si tabulku založí sám):

```
wrangler d1 execute ar-geodet-db --remote --file=schema.sql
```

Nic dalšího se nemění: stávající endpointy (login, config, users, chat,
usage, stats, backup) zůstávají beze změny, žádná data se nemigrují.

## Jak se to pak používá v appce

1. Obě zařízení přihlášená do stejné firmy (cloudový režim).
2. Na obou založit/zvolit zakázku **stejného názvu** (párování je podle
   názvu zakázky — velikost písmen a mezery nehrají roli).
3. Na obou zapnout Nastavení → Data → **Firemní cloud** →
   „Sdílet body této zakázky ve firmě".

Synchronizuje se každých ~30 s, když appka běží a je signál; navíc hned po
startu, po návratu signálu a pár vteřin po každé změně bodu. Stav ukazuje
pilulka vedle přepínače („Sync: před 30 s / offline / vypnuto…").

## API (autorizace Bearer tokenem jako ostatní endpointy)

- `POST /sync/points` `{job, changes:[{id, data?, ts, deleted}]}` — nahrání
  změn; server přijme změnu, jen když je novější než uložená (`ts`,
  last-write-wins). `deleted:1` = náhrobek (smazání bodu). Max 300 změn
  na požadavek, `data` max 8 000 znaků.
  Odpověď nese `accepted: [id, …]` — **které** změny server vzal. Co v seznamu
  není, server odmítl jako starší; klient si takový bod dotáhne adresně (viz
  `?ids=` níž) a vezme serverovou verzi za svou. Bez toho se odmítnutá změna
  posílala pořád dokola a uživatel se nikdy nedozvěděl, že do firmy nedošla.
- `GET /sync/points?job=<klíč>&since=<srv>` — změny od kurzoru `srv`
  (čas zápisu na serveru, nezávislý na hodinách mobilů), max 500 řádků,
  `more:true` = pokračovat dalším požadavkem.
- `GET /sync/points?job=<klíč>&ids=<id,id,…>` — **adresné** dotažení konkrétních
  bodů (max 100). Kurzor `since` je nepřinese: odmítnutý zápis `srv` neposunul,
  takže řádek leží dávno za kurzorem.
- Všechny tři cesty prochází bránou zakázky (`jobAllowed`): kdo na zakázku nemá
  přístup, dostane **403** „K této zakázce nemáš přístup." Brána se opírá o řádek
  v tabulce `jobs`; dokud tam zakázka není, propouští (viz poznámka u `POST /jobs`
  v `cloud/README.md`).

## Limity a poznámky

- Sdílejí se jen **vlastní body** (ne úřední body ČÚZK, ne čáry/kresby,
  ne foto-dokumentace bodů — velká data).
- Náhrobky smazaných bodů server po ~půl roce uklízí (mazání do té doby
  spolehlivě doběhne na všechna zařízení).
- Konflikt (dva lidé upraví stejný bod) řeší poslední úprava — a od 5. 9. 2026
  je to **čas ÚPRAVY** (pole `mts` na bodu), ne čas odeslání. Předtím se posílalo
  `Date.now()` z okamžiku pushe, takže kdo byl den v lese bez signálu, večer po
  připojení přepsal odpolední opravu z kanceláře. Kdo `mts` nenastaví, tomu ho
  `localChanges()` v `js/cloud-sync.js` dosadí jako „teď", ale jen tehdy, když se
  obsah bodu proti poslednímu sesynchronizovanému stavu opravdu liší. Nic se
  neslučuje po složkách.
- `GET /backup` body ze synchronizace zatím neobsahuje (jsou v tabulce
  `sync_points`; každé zařízení je má i lokálně ve své záloze).
