# Odebrané „hračky" (červenec 2026, větev feat/nastroje-declutter)

Na přání odebráno z aplikace při úklidu Nástrojů — nástroje se v praxi nepoužijí
nebo budí falešný dojem měření. Kód je zde v plné verzi, kdyby bylo potřeba je vrátit.

| Soubor | Nástroj | Proč pryč |
|---|---|---|
| `urovnani.js` + `urovnani.css` | Urovnání stativu (chytrá libela) | Každý přístroj má vlastní libelu; telefon na hlavě stativu je v praxi nepoužitelný (podnět uživatele). |
| `rangefinder.js` | Optický dálkoměr | Odhad z náklonu je horší než krokování — hračka. |
| `photo-shot.js` | Foto-totálka (zaměřit bod kamerou) | Poloha z kompasu + GPS telefonu = metry; budí falešný dojem zaměření. |

## Jak vrátit

1. Přesuň soubor(y) zpět do `js/` (resp. `css/`).
2. Vrať řádky `<script defer src="…">` / `<link rel="stylesheet" …>` do `index.html`
   (viz git historie tohoto commitu).
3. Vrať záznamy v `TOOL_HELP` (js/tools-plus.js) a `SEARCH_ALIASES` + `TOOL_CATS`
   (js/field-tools.js).
4. Spusť `python scripts/gen_sw_assets.py --bump`.

Pozn.: „Výška objektu" (vyska-objektu.js) ZŮSTALA v appce — jediná z kamerových
pomůcek s reálným občasným užitkem a poctivým odhadem ±.
