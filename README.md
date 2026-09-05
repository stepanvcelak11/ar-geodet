# AR Geodet

Webový nástroj (PWA) pro geodety k vyhledávání bodů v rozšířené realitě (AR). Aplikace zobrazuje geodetické body přímo v obraze z kamery a naviguje uživatele k nim pomocí směrové šipky, kompasu a mapy.

## Funkce

- **AR navigace** — body se zobrazují přes obraz z kamery se směrovou šipkou k cíli
- **Mapa** — zobrazení bodů v mapě (Leaflet + esri-leaflet) s podkladem ČÚZK
- **Souřadnicové systémy** — převod souřadnic přes proj4 (např. S-JTSK / Křovák ↔ WGS84)
- **Offline režim** — díky service workeru funguje aplikace i bez připojení
- **Instalovatelná PWA** — lze přidat na plochu telefonu jako nativní aplikaci

## Technologie

Aplikace je čistě klientská (statický web), bez build kroku:

- HTML / CSS / JavaScript (vanilla)
- [Leaflet](https://leafletjs.com/) 1.9.4 + [esri-leaflet](https://github.com/Esri/esri-leaflet) 3.0.12 — mapa
- [proj4js](http://proj4js.org/) 2.9.0 — převody souřadnic
- Service Worker + Web App Manifest — PWA / offline

## Spuštění

Protože jde o statický web, stačí ho servírovat přes libovolný HTTP server (kvůli service workeru a kameře je potřeba `https` nebo `localhost`).

```bash
python scripts/test_server.py 8099
```

Poté otevři `http://localhost:8099` v prohlížeči.

> **Nepoužívej `python -m http.server`.** Jede v režimu HTTP/1.0, kde se spojení zavírá po každé odpovědi — appka si při startu tahne ~145 souborů, část spojení se resetne a prohlížeč náhodně nenačte třeba `js/logika.js`. Projeví se to jako pády uvnitř appky (`map.on is not a function`, `filters is not defined`), i když appka v pořádku je. `scripts/test_server.py` drží HTTP/1.1 s keep-alive; ten samý server používají i smoke testy (`playwright.config.mjs`).

> **Pozn.:** Přístup ke kameře a geolokaci vyžaduje zabezpečený kontext (HTTPS nebo localhost). Při nasazení na GitHub Pages je HTTPS automaticky.

## Nasazení na GitHub Pages

V nastavení repozitáře (**Settings → Pages**) musí být **Build and deployment → Source: `GitHub Actions`** (ne `Deploy from a branch`). Nasazuje se totiž **zabalená** verze, kterou vyrobí workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml): zdroje se zminifikují do jediného `dist/app.<hash>.min.js`, přegeneruje se seznam v `sw.js` a než se cokoli publikuje, projedou nad zabalenou verzí smoke testy. Když neprojdou, deploy se nespustí a venku zůstane předchozí verze.

Kdyby byl Source přepnutý na `Deploy from a branch`, job „Publikovat" selže a venku poběží nezabalená a neotestovaná kopie větve. Adresa je `https://<uzivatel>.github.io/<nazev-repo>/`. Ve zdrojích v repu se nic nemění — přepis `index.html` i `sw.js` se děje jen v checkoutu toho běhu.

## Struktura

```
.
├── index.html        # kostra appky + soupis <script> tagů (pořadí je závazné)
├── css/              # 32 stylopisů; css/tokens.css = barvy a rozměry (design tokeny)
├── js/               # ~180 modulů ve SPOLEČNÉM globálním prostoru window.*
│   ├── logika.js     # jádro: převody souřadnic, ČÚZK, GPS, ukládání, zakázky
│   ├── grafika.js    # jádro: AR značky/šipka, mapa, kompas, modály, vzhled
│   ├── geo-core.js   # geodetické výpočty (S-JTSK, vzdálenosti) — kryté testy
│   ├── lazy-load.js  # odkládací vrstva: 81 modulů se <script type="ag/lazy">
│   ├── lazy-tools.js # 29 nástrojů se stáhne AŽ na klepnutí (zástupná dlaždice)
│   └── lib/          # cizí knihovny (Leaflet, proj4, esri-leaflet, satellite…)
├── data/             # slovníky jazyků, předpisy, zpravodaj
├── scripts/          # vývojářské nástroje: kontroly do CI, generátory, testy
├── cloud/            # Cloudflare worker firemního režimu (nasazuje se zvlášť)
├── manifest.json     # PWA manifest
└── sw.js             # service worker (offline cache, verze = SHELL_CACHE)
```

> Appka **nemá build krok**: moduly se načítají jednotlivými `<script>` tagy a
> sdílejí jeden globální prostor, takže **pořadí v `index.html` je závazné** —
> `js/logika.js` musí být před `js/grafika.js` a moduly před tím, kdo je používá.
> Balíček (`scripts/build.mjs`) vzniká až při nasazení, viz výše — a zabalí se
> do něj **jen moduly spouštěné při startu**. Odložené (`type="ag/lazy"`)
> i nástroje z `js/lazy-tools.js` zůstávají samostatnými soubory, jinak by se
> celá odkládací vrstva v nasazené verzi obešla.
>
> Nástroje, které se otevírají z dlaždice, patří do odkládací vrstvy
> (`type="ag/lazy"`) — hlídá to `scripts/check_start_budget.py` v CI.


## Upozornění, soukromí a data

**Upozornění:** AR Geodet je orientační pomůcka, nikoli měřicí přístroj. Zobrazená poloha bodů závisí na přesnosti GPS a kompasu telefonu (běžně ±3–7 m). Body v terénu vždy ověřte; za rozhodnutí na základě aplikace odpovídá uživatel.

**Soukromí:** Obraz z kamery zařízení nikdy neopustí — AR se počítá celá v telefonu a žádný snímek se nikam neposílá. **Poloha (GPS) ale ven odchází**, a to čtyřmi kanály: (1) do služeb počasí (`open-meteo.com`, `met.no`, `brightsky.dev`, srážkový radar) jde zeměpisná šířka a délka na pět desetinných míst — děje se to i bez přihlášení do firmy, protože bez souřadnic nejde předpověď na místo stavby zjistit; (2) při píchnutí docházky jde poloha na firemní server; (3) vysílačka posílá živou polohu kolegům ve firmě; (4) synchronizace zakázek do firemního cloudu odesílá souřadnice bodů. Tři z těch čtyř kanálů (docházka, vysílačka, cloud) fungují jen v přihlášeném firemním režimu — bez něj zůstávají body i nastavení uložené pouze v telefonu. Podrobně, včetně toho, co se ukládá a na jak dlouho, je to popsáno v [soukromi.html](soukromi.html).

**Zdroje dat:** Bodová pole, ortofoto a katastrální mapa — Podkladová data © ČÚZK (užití dle Podmínek poskytování ČÚZK a Zásad užívání dat a služeb ZÚ). Mapový podklad © přispěvatelé OpenStreetMap (ODbL).
