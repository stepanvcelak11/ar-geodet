# Build tooling (OPT-IN) — zabalení + minifikace JS

Ve **zdrojích** se nic nemění: `index.html` v repu dál načítá jednotlivé
`<script>` tagy, takže vývoj zůstává bez buildu (uprav soubor, obnov stránku).
Build se pouští **až při nasazení** — workflow `.github/workflows/pages.yml` z něj
udělá jediný `dist/app.<hash>.min.js`, otestuje ho a teprve pak publikuje na Pages.

## Co to dělá

`scripts/build.mjs`:

1. Přečte **pořadí** lokálních `<script src="js/...">` přesně z `index.html`
   (jeden zdroj pravdy; pořadí je kritické, moduly spoléhají na globály vzniklé
   dřívějšími skripty).
2. **Vynechá knihovny `js/lib/*`** (Leaflet, esri-leaflet, satellite, qrcode, jsqr,
   proj4) — ty zůstávají samostatné `<script>` tagy (třetí strany, mění se zřídka).
3. **Volitelně** vynechá těžké „lazy" moduly (jen s přepínačem `--lazy`).
4. Zbytek zkonkatenuje ve správném pořadí, zminifikuje přes `esbuild.transform`
   a zapíše `dist/app.<contenthash>.min.js`. Hash v názvu = cache-busting.

Idempotentní: stejný vstup => stejný hash => stejný název. Staré `dist/app.*.min.js`
se před zápisem uklidí.

## Jak spustit

```bash
npm i            # jednorázově — stáhne esbuild do node_modules
npm run build        # vyrobí dist/app.<hash>.min.js (název vypíše na poslední řádek)
npm run build:check  # jen ověří/minifikuje, dist NEzapíše (sanity / CI)
```

Užitečné přepínače `node scripts/build.mjs`:

- `--list` — jen vypíše zjištěné pořadí souborů a skončí (kontrola, co se zabalí)
- `--lazy` — z bundlu vynechá lazy moduly (menší bundle; pak je musíš lazy-loadovat)
- `--check` — jako `build:check`

## Nasazení (automaticky, `.github/workflows/pages.yml`)

Workflow `Nasazení na Pages (zabalený kód)` dělá tohle — všechno jen ve svém
checkoutu, do repa nic nezapisuje:

1. `python scripts/check_js.py` — syntaxe a duplicitní klíče ve všech `js/*.js`.
2. `npm run build -- --apply` — vyrobí `dist/app.<hash>.min.js` **a přepíše
   `index.html`**: všech ~112 vlastních `<script src="js/…">` tagů zmizí a na místo
   posledního z nich se vloží jeden tag s bundlem. Knihovny `js/lib/*` zůstávají
   samostatné a před bundlem; kdyby některá byla v dokumentu ZA posledním vlastním
   skriptem, build to odmítne (jinak by se pořadí tiše rozbilo).
3. `python scripts/gen_sw_assets.py` — `sw.js` si přegeneruje `ASSETS_TO_CACHE`
   podle nového `index.html`, takže se cachuje bundle a ne 112 nepoužitých souborů.
4. `npm run test:smoke` — Playwright nastartuje **zabalenou** verzi appky. Když
   nenaběhne, deploy se nespustí a venku zůstane předchozí verze.
5. `upload-pages-artifact` + `deploy-pages`.

### Jednorázové nastavení

GitHub → repo → **Settings → Pages → Build and deployment → Source**: přepnout
z „Deploy from a branch" na **„GitHub Actions"**. Do té doby jde workflow spustit
ručně (Run workflow) — build i testy proběhnou, jen poslední krok (deploy) selže.
Po přepnutí odkomentuj v `pages.yml` spouštěč `push: branches: [main]` a nasazuje
se samo.

### Co tím odpadá

- **Ruční bump `SHELL_CACHE`** po každém pushi: název bundlu obsahuje contenthash,
  takže každá změna kódu = jiná URL = prohlížeč si vezme čerstvý kód sám. Bump
  zůstává jako pojistka pro CSS (`?v=NNN`), o který se stará `gen_sw_assets.py`.
- **112 HTTP requestů a ~3,7 MB JS** při studeném startu na telefonu.

Dokud běží Pages ze branche (tj. před přepnutím Source), nasazuje se pořád
nezabalený `index.html` z repa a `SHELL_CACHE` se bumpuje ručně jako dosud.

## Ruční cutover (když bys build chtěl zapnout přímo v repu)

1. `npm i && npm run build -- --apply`
2. `python scripts/gen_sw_assets.py`
3. commitni i `dist/` (v `.gitignore` ho pak nesmíš ignorovat) — je to artefakt,
   který appka načítá.

Nevýhoda: každý další commit do `js/*.js` vyžaduje build znovu, jinak nasazená
verze neodpovídá zdrojům. Proto je automatická cesta přes CI lepší.

## Lazy-load těžkých nástrojů na klik (vzor `ensureTesseract`)

Vzorem je `ensureTesseract()` v `js/logika.js` — knihovna se stáhne přidáním
`<script>` do `document.head` až při prvním použití, s cache přes uloženou Promise:

```js
let _modPromise = null;
function ensureKalkulacka() {
    if (window.openKalkulacka) return Promise.resolve(); // už načteno
    if (!_modPromise) {
        _modPromise = new Promise((resolve, reject) => {
            const sc = document.createElement('script');
            sc.src = 'js/kalkulacka.js';            // nebo dist/kalkulacka.<hash>.min.js
            sc.onload = () => resolve();
            sc.onerror = () => { _modPromise = null; reject(new Error('Nepodařilo se načíst nástroj.')); };
            document.head.appendChild(sc);
        });
    }
    return _modPromise;
}
// na klik:  ensureKalkulacka().then(() => openKalkulacka()).catch(e => alert(e.message));
```

Kandidáti na lazy-load na klik (= `LAZY_MODULES` v `build.mjs`, zapínáš `--lazy`):

| modul                  | spouští se… | globál ke kontrole (orientačně) |
|------------------------|-------------|---------------------------------|
| `js/kalkulacka.js`     | otevření kalkulačky | `window.openKalkulacka` |
| `js/dmt-volume.js`     | výpočet kubatur/vrstevnic | `window.openDmtVolume` |
| `js/satelity.js`       | obrazovka satelitů | `window.openSatelity` |
| `js/parcela.js`        | geometrie & dělení parcel | `window.openParcela` |
| `js/project-import.js` | import projektu (DXF/…) | `window.openProjectImport` |

> Přesné názvy globálů si ověř v daném souboru (každý modul vystavuje vlastní
> `window.*` / registraci v launcheru `field-tools.js`). Tabulka je jen vodítko —
> u lazy varianty kontroluj reálný globál, který modul po načtení vytvoří.

Při lazy variantě tyhle moduly **nedávej** do hlavního bundlu (spouštěj build
s `--lazy`) a v `sw.js` je nech jako samostatné položky v `ASSETS_TO_CACHE`, ať
fungují offline (stáhly se aspoň jednou online).
