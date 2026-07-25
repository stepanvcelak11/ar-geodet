# Vydávání verze (sw.js + cache) — `gen_sw_assets.py`

Service worker (`sw.js`) má ručně nebezpečná 3 místa, která se musí shodovat:

1. `sw.js` → `const SHELL_CACHE = 'argeodet-shell-vNNN'` (zdroj pravdy),
2. `sw.js` → položka `'./css/style.css?v=NNN'` v `ASSETS_TO_CACHE`,
3. `index.html` → `<link rel="stylesheet" href="css/style.css?v=NNN">`.

Navíc seznam `ASSETS_TO_CACHE` (~119 položek) musí obsahovat všechny lokální
skripty/styly. Obojí teď hlídá a generuje `scripts/gen_sw_assets.py`
(čistý Python 3 stdlib — Node na vývojářském stroji není potřeba).

## Jak vydat novou verzi

```
python scripts/gen_sw_assets.py --bump
```

`--bump` zvedne NNN v `SHELL_CACHE` o 1 a propíše `?v=NNN` do sw.js
i index.html. Zároveň přegeneruje seznam assetů z aktuálního `index.html`
a `manifest.json`. Pak commit + push — uživatelům naskočí update banner.

## Když přidáš/odeberu soubor (script/css) v index.html

```
python scripts/gen_sw_assets.py
```

(bez `--bump`) — jen přegeneruje seznam mezi markery
`// >>> GENEROVANO … // <<< KONEC GENEROVANEHO SEZNAMU` v `sw.js`.
**Seznam mezi markery NEeditovat ručně.** Soubory, které nejsou vidět
z index.html (fetch za běhu, lazy load, CDN URL), přidej do `EXTRA_ASSETS`
nahoře v `gen_sw_assets.py`.

## Co hlídá CI

`.github/workflows/release-check.yml` spouští na každý push do `main`
a na PR:

```
python scripts/gen_sw_assets.py --check
```

Nic nezapisuje; selže (a zčervená), když:

- seznam v `sw.js` neodpovídá tomu, co by generátor vygeneroval
  (zapomenutý soubor, ručně editovaný seznam),
- některý lokální asset ze seznamu neexistuje na disku (překlep, smazaný soubor),
- verze NNN nesedí mezi `SHELL_CACHE`, `style.css?v=` v sw.js a `<link>`
  v index.html (zapomenutý bump / ruční přepis jen na jednom místě).

Oprava je vždy stejná: spustit `python scripts/gen_sw_assets.py`
(při vydání s `--bump`) a commitnout výsledek.
