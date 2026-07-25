# AR Geodet → Google Play (Android) + „Přidat na plochu" (iOS)

Kompletní návod. **Část technické přípravy je už hotová v repu** — viz checklist níže.
Hosting běží na `https://stepanvcelak11.github.io/ar-geodet/` (veřejné repo, HTTPS ✓).

---

## Co je v repu už připravené (touto větví)

| Hotovo | Soubor | K čemu |
|---|---|---|
| ✅ | `icon-192.png`, `icon-512.png` | PNG ikony pro Play/PWABuilder (SVG nestačí) |
| ✅ | `icon-maskable-192/512.png` | „maskable" varianta — Android si ji ořízne do kruhu, motiv je v bezpečné zóně |
| ✅ | `apple-touch-icon.png` (180×180) | ikona pro iOS „Přidat na plochu" — **dosud byla SVG, kterou iOS ignoruje**, takže se na ploše ukazoval screenshot; teď bude správné logo |
| ✅ | `manifest.json` | doplněno `id`, `scope`, `lang`, kategorie a PNG ikony (PWABuilder je vyžaduje) |
| ✅ | `.well-known/assetlinks.json` | šablona Digital Asset Links — **je v ní placeholder**, otisk doplníš v kroku A6 |
| ✅ | `.nojekyll` | bez něj GitHub Pages (Jekyll) **neservíruje složku `.well-known`** → ověření domény by selhalo |
| ✅ | `soukromi.html` | zásady ochrany soukromí — Play Console vyžaduje veřejnou URL |

Po merge na main ověř, že funguje:
`https://stepanvcelak11.github.io/ar-geodet/.well-known/assetlinks.json` a `…/soukromi.html`.

---

## Část A — Google Play (TWA přes PWABuilder)

Aplikace v Playi bude „Trusted Web Activity" — tenký obal, který otevře web ve fullscreen
Chromu. Kamera, GPS i senzory fungují stejně jako v prohlížeči. Appku dál vyvíjíš jen na
webu; balíček se znovu nahrává jen při změně názvu/ikony/balíčku.

### A1. Založ vývojářský účet (25 $ jednorázově)
1. https://play.google.com/console → **osobní účet** (25 $, platí navždy).
2. Ověření identity (doklad) — počítej den až dva.
3. ⚠️ **Osobní účty založené po 13. 11. 2023 mají testovací povinnost**: před vydáním
   do produkce musí mít appka **uzavřený test s min. 12 testery nepřetržitě 14 dní**
   (viz krok A7). Firemní/organizační účet tuhle povinnost nemá, ale chce D‑U‑N‑S číslo
   a je to papírování — pro začátek doporučuji osobní účet a 12 kolegů/známých.

### A2. Vygeneruj balíček na PWABuilder.com
1. https://www.pwabuilder.com → vlož `https://stepanvcelak11.github.io/ar-geodet/`.
2. Zkontroluje manifest/SW (po téhle větvi projde) → **Package for stores → Android**.
3. Nastavení balíčku:
   - **Package ID**: `cz.stepanvcelak.argeodet` (musí sedět s `.well-known/assetlinks.json`;
     když zvolíš jiné, přepiš ho i tam),
   - **App name**: AR Geodet, **verze**: 1.0.0,
   - **Signing key**: nech „Create new" — PWABuilder vygeneruje podpisový klíč,
   - ⚠️ **Location delegation: ZAPNOUT** (jinak GPS v TWA nedostane nativní permission dialog),
   - Display: standalone/fullscreen dle chuti (standalone doporučuji), barvy se načtou z manifestu.
4. Stáhne se ZIP: `*.aab` (pro Play), `*.apk` (na vyzkoušení v telefonu — nainstaluj a ověř
   kameru + GPS!), `signing.keystore` + hesla (**bezpečně zálohovat!**), `assetlinks.json`.

### A3. Založ appku v Play Console
1. **Create app** → jazyk čeština, název „AR Geodet", App (ne hra), Free.
2. Vyplň **Store listing**: krátký popis (80 znaků), dlouhý popis, **min. 2 screenshoty**
   z telefonu (stačí printscreeny appky), **ikona 512×512** (`icon-512.png`),
   **feature graphic 1024×500** (banner — řekni si, vygeneruji).
3. **Privacy policy URL**: `https://stepanvcelak11.github.io/ar-geodet/soukromi.html`.

### A4. Dotazníky (App content)
- **Data safety**: deklaruj *Poloha (přesná) — shromažďována dočasně pro funkčnost appky,
  nesdílena s třetími stranami, šifrována při přenosu (HTTPS)*. Nic jiného se nesbírá
  (žádné osobní údaje, kamera zůstává v zařízení). Odpovídá `soukromi.html`.
- **Content rating** (IARC dotazník): utilita, bez násilí/hazardu → rating 3+/Everyone.
- **Target audience**: 18+ (pracovní nástroj), appka necílí na děti.
- Reklamy: NE. Přístup vyžadující přihlášení: NE.

### A5. Nahraj balíček — začni Internal testing
1. **Testing → Internal testing → Create release** → nahraj `.aab`.
2. Při prvním nahrání zvol **Google Play App Signing** (Google si balíček přepodepíše
   vlastním klíčem — proto se otisk bere z Console, viz A6).
3. Přidej sebe jako testera, nainstaluj z odkazu, ověř funkce.

### A6. Digital Asset Links (zmizí adresní řádek Chromu)
1. Play Console → **Setup (Nastavení) → App integrity → App signing key certificate** →
   zkopíruj **SHA‑256 certificate fingerprint**.
2. Vlož ho do `.well-known/assetlinks.json` místo placeholderu
   (`NAHRAD_OTISKEM_SHA256_Z_PLAY_CONSOLE_APP_SIGNING`), push na main.
3. Ověření: otevři appku z Playe — nesmí být vidět lišta s URL. Kontrola:
   `https://developers.google.com/digital-asset-links/tools/generator`.

### A7. Uzavřený test „12 testerů / 14 dní" (jen osobní účty po 11/2023)
1. **Closed testing → Create track** → nahraj stejný `.aab`, přidej e‑maily 12+ testerů
   (kolegové geodeti, parta, rodina — reálné Google účty, reálné telefony).
2. Rozešli opt‑in odkaz; každý musí kliknout „Become a tester" a **nainstalovat appku**.
3. Testeři musí zůstat přihlášení **14 dní v kuse** (když někdo vypadne, okno se láme).
   Appku nemusí denně používat — stačí ji mít nainstalovanou a být opt‑in.
4. Po 14 dnech se v Console odemkne **Apply for production access** — krátký dotazník
   (co ses z testu dozvěděl).

### A8. Produkce
**Production → Create release** → stejný `.aab` → review Googlu (obvykle dny) → appka je v Playi. 🎉

### Údržba
Web měníš jako dosud (push + bump SW). Balíček v Playi se týká jen obalu — novou verzi
`.aab` nahráváš jen při změně ikony, názvu, package ID nebo TWA nastavení.

---

## Část B — iPhone: „Přidat na plochu" (bez App Store, zdarma)

Funguje už teď; touto větví se opravila ikona (PNG místo SVG, kterou iOS ignoroval).

**Návod pro kolegy (můžeš zkopírovat do zprávy):**
1. Otevři v **Safari**: `https://stepanvcelak11.github.io/ar-geodet/`
2. Tlačítko **Sdílet** (čtvereček se šipkou) → **Přidat na plochu** → **Přidat**.
3. Appku spouštěj **ikonou z plochy** (ne ze Safari) — poběží fullscreen, offline,
   s kamerou, GPS i kompasem. Při prvním spuštění povol polohu, kameru a pohyb.

Poznámky:
- Kdo měl ikonu na ploše už dřív, ať ji **smaže a přidá znovu** (iOS si ikonu/meta ukládá při instalaci).
- Aktualizace se natáhnou samy při spuštění s internetem (banner „Nová verze").
- iOS umí PWA notifikace a je plnohodnotný fullscreen — App Store je potřeba jen pro
  veřejnou distribuci/vyhledatelnost; na to by byl potřeba obal (Capacitor) + účet 99 $/rok + Mac.

---

## Než vydáš veřejně — nezapomeň

- **© ČÚZK atribuce**: appka tahá data ČÚZK — atribuce musí zůstat viditelná; při větším
  počtu uživatelů pohlídej rate‑limity (viz paměť projektu). Zvaž info do popisu v Playi.
- **Otestuj `.apk` z PWABuilderu v terénu** (kamera + GPS v TWA) dřív, než pozveš testery.
- **Záloha `signing.keystore` + hesel** z PWABuilderu (bez nich nejde vydat update, pokud
  nepoužiješ Play App Signing — používej ho).
- Feature graphic 1024×500 a texty do Playe — řekni si, připravím.
