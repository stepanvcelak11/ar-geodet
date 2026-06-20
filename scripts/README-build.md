# Build tooling (OPT-IN) — zabalení + minifikace JS

Tohle je **volitelný** nástroj. Appka se pořád normálně načítá přes jednotlivé
`<script>` tagy v `index.html` a bez tohoto buildu funguje úplně stejně jako dosud.
Nic v `index.html` ani v `sw.js` se teď **nemění** — cutover přijde až při společné
integraci (viz níže).

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

## Proč je to ZATÍM opt-in

- Na projektu pracuje víc lidí/AI naráz; cutover by jim rozbil načítání přes
  `<script>` tagy. Build je proto čistě stranou: vyrobí soubor do `dist/`, ale
  nikdo ho nepoužívá, dokud ručně nepřepíšeme `index.html`.
- `node_modules` ani `dist` se zatím nemusí verzovat (viz integrace `.gitignore`).
- Plná ES-module migrace (`import`/`export`, odstranění globálů) je **mnohem** větší
  zásah — tohle je jen „zabal a minifikuj", bez změny architektury.

## CUTOVER při integraci (PŘESNÝ postup)

Až se všechny větve sloučí a budeme chtít build zapnout v ostré verzi:

1. Spusť `npm i && npm run build`. Zapamatuj si vypsaný název, např.
   `app.a1b2c3d4e5.min.js`.

2. V `index.html` (konec souboru, blok script tagů ~ř. 536–589) **nahraď** všechny
   řádky `<script src="js/...">` (NE knihovny `js/lib/*`) jediným řádkem:

   ```html
   <script src="dist/app.a1b2c3d4e5.min.js"></script>
   ```

   Knihovny `js/lib/*` (Leaflet, esri, satellite, qrcode, jsqr) **nech být** a nech
   je **PŘED** bundlem (appka je potřebuje dřív). Tj. výsledek: nejdřív `js/lib/*`
   řádky, pak jeden `dist/app.<hash>.min.js`.

3. **`sw.js` — ruční bump `SHELL_CACHE` ODPADÁ.** Protože název bundlu obsahuje
   contenthash, každá změna kódu = nový název souboru = jiná URL = prohlížeč si
   stáhne čerstvý kód sám. V `sw.js` v `ASSETS_TO_CACHE` (~ř. 25–78) pak smaž
   jednotlivé `'./js/*.js'` položky (kromě `js/lib/*`) a přidej místo nich jeden
   řádek `'./dist/app.<hash>.min.js'`. CSS a `js/lib/*` v seznamu nech.

   > Pozn.: dokud bundle NEpoužíváš (před cutoverem), `SHELL_CACHE` bumpuj dál ručně
   > jako teď — hashovaný název pomáhá **až** po cutoveru.

4. `dist/` se po cutoveru musí **commitnout** (je to deploy artefakt, který appka
   načítá). Tzn. v `.gitignore` `dist/` NEignoruj, nebo build pouštěj v CI před
   deployem. Před cutoverem klidně `dist/` ignoruj (viz integrace `.gitignore`).

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
