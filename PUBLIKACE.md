# QTRIG → Google Play (Android) + „Přidat na plochu" (iOS)

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
| ✅ | `.well-known/assetlinks.json` | Digital Asset Links pro balíček `cz.stepanvcelak.argeodet` s otiskem podpisového klíče z PWABuilderu (29. 8. 2026); otisk Play App Signing se **přidá** v kroku A6 |
| ✅ | `.nojekyll` | bez něj GitHub Pages (Jekyll) **neservíruje složku `.well-known`** → ověření domény by selhalo |
| ✅ | `soukromi.html` | zásady ochrany soukromí — Play Console vyžaduje veřejnou URL (přepsáno 13. 9. 2026: účet povinný, co server ukládá) |
| ✅ | `smazani-uctu.html` | **povinné od 2024**: appka se zakládáním účtu musí umět účet smazat v appce (O aplikaci → Smazat účet, `POST /account/delete`) a mít veřejnou stránku k žádosti — URL se vyplňuje v Zabezpečení dat |
| ✅ | `play/snimky/` | feature graphic + 5 screenshotů ze SKUTEČNÉ appky (`scripts/gen_play_snimky.py`), texty v `play/texty.md` |

Po merge na main ověř, že funguje:
`https://stepanvcelak11.github.io/ar-geodet/.well-known/assetlinks.json`, `…/soukromi.html`
a `…/smazani-uctu.html`.

## Stav k 13. 9. 2026 — co je hotové a co zbývá na tobě

Hotové v repu: viz tabulka výše. Balíček z PWABuilderu z **29. 8. 2026** (`Geodet - Google Play
package/`, mimo git) je **k ničemu**: jmenuje se „Geodet", má starou ikonu a hlavně JINÝ název
balíčku (`io.github.stepanvcelak11.twa`) — Console chce `cz.stepanvcelak.argeodet`. Musí se
vyrobit znovu (krok A2) s tímhle ID; podpisový klíč z něj (`signing.keystore` + hesla v
`signing-key-info.txt`) se dá použít dál („Use mine"), klíč na názvu balíčku nezávisí.

**Doplněk 15. 9. 2026:** bod 1 i 4 níž jsou HOTOVÉ — 13. 9. večer vznikl nový balíček
`QTRIG - Google Play package (2)` (Downloads, package `cz.stepanvcelak.argeodet`, týž klíč) a ve
22:07 přibyl do `assetlinks.json` otisk Play App Signing, který Console vydá až po prvním
nahrání. Do Console se kvůli změnám v appce NEVRACÍ — obal je hotový, novou verzi appky si
telefony berou z Pages samy (viz Údržba níž).

Zbývá udělat ručně v Play Console (nic z toho appka neudělá sama):
1. ~~Vygenerovat nový `.aab` (A2), nahrát do interního testu (A5).~~ hotovo 13. 9.
2. Záznam v obchodě: texty z `play/texty.md`, obrázky z `play/snimky/` (A3).
3. Obsah aplikace: **Přístup k aplikaci** s demo účtem, **Zabezpečení dat** včetně URL pro
   smazání účtu, hodnocení obsahu, cílová skupina (A4). Bez zelené sekce Console nepustí ani
   uzavřený test.
4. ~~Po prvním nahrání: otisk Play App Signing do `assetlinks.json` (A6).~~ hotovo 13. 9. (e0bf701)
5. Uzavřený test 12 testerů / 14 dní (A7), texty v `play/pozvanka-testeri.md`.

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
   - **Package ID**: `cz.stepanvcelak.argeodet` — ⚠⚠ přesně tohle, Play Console ho má u appky
     ZAMČENÉ (13. 9. 2026 odmítla balíček: „musí mít název balíčku cz.stepanvcelak.argeodet").
     Srpnový balíček z PWABuilderu měl `io.github.stepanvcelak11.twa` a je k ničemu.
     `.well-known/assetlinks.json` nese tohle ID,
   - **App name**: QTRIG, **Launcher name**: QTRIG, **verze**: 1.1.0, **version code**: 2
     (starý balíček má 1 — Play chce vždy vyšší),
   - **Signing key**: **„Use mine"** → nahraj `signing.keystore` ze složky
     `Geodet - Google Play package/`, alias `my-key-alias`, hesla ze `signing-key-info.txt`.
     Jen tak zůstane otisk `43:06:F4:…:F8:AE`, který už je v `assetlinks.json`,
   - ⚠️ **Location delegation: ZAPNOUT** (jinak GPS v TWA nedostane nativní permission dialog),
   - Display: standalone/fullscreen dle chuti (standalone doporučuji), barvy se načtou z manifestu.
4. Stáhne se ZIP: `*.aab` (pro Play), `*.apk` (na vyzkoušení v telefonu — nainstaluj a ověř
   kameru + GPS!), `signing.keystore` + hesla (**bezpečně zálohovat!**), `assetlinks.json`.

### A3. Založ appku v Play Console
1. **Create app** → jazyk čeština, název „QTRIG", App (ne hra), Free.
2. Vyplň **Store listing**: texty z `play/texty.md`, **screenshoty** `play/snimky/01…05`
   (1080×1920), **ikona 512×512** (`icon-512.png`), **feature graphic 1024×500**
   (`play/snimky/feature.png`).
3. **Privacy policy URL**: `https://stepanvcelak11.github.io/ar-geodet/soukromi.html`.

### A4. Dotazníky (App content)
- **Data safety**: tabulka položek je v `play/texty.md` (jméno, interakce v aplikaci,
  protokoly chyb, ID zařízení — vše jen shromažďováno, nic sdíleno, HTTPS; **poloha se
  nesbírá**, zpracovává se jen v telefonu). Odpovídá `soukromi.html`.
- **Content rating** (IARC dotazník): utilita, bez násilí/hazardu → rating 3+/Everyone.
- **Target audience**: 18+ (pracovní nástroj), appka necílí na děti.
- Reklamy: NE.
- ⚠⚠ **Přístup k aplikaci (App access): ANO — „Všechny nebo některé funkce jsou
  omezené".** Do 6. 9. 2026 tu stálo „NE" a to už **NEPLATÍ**: hostovský režim byl
  zrušen, appka má bránu hned při startu (`js/ucty.js`) a bez účtu se dovnitř
  nedostane nikdo — tedy ani kontrolor Googlu. S deklarací „NE" by se na to přišlo
  až při kontrole a vydání by se vrátilo zamítnuté.
  **Vyplň přihlašovací údaje demo účtu** (kód účtu + heslo jsou v `play/texty.md`;
  založený 6. 9. 2026 na ostrém serveru, tarif Základ) a jako postup napiš: *na úvodní
  obrazovce zvol „Přihlásit se (mám kód účtu)", zadej kód účtu a heslo*.
- ⚠⚠ **Zabezpečení dat — smazání účtu (13. 9. 2026).** Appka umožňuje založit účet, takže
  Google vyžaduje (a) možnost smazat účet v appce — je: Nastavení → Více → O aplikaci →
  Smazat účet — a (b) **URL pro žádost o smazání**:
  `https://stepanvcelak11.github.io/ar-geodet/smazani-uctu.html`. Přesné položky formuláře
  (jméno, interakce v aplikaci, protokoly chyb, ID zařízení; poloha se NEsbírá) jsou v
  `play/texty.md`.
  ⚠ Dokud není celá sekce Obsah aplikace zelená, Console nepustí vydání ani do
  uzavřeného testu — a tím ani start 14denních hodin.

### A5. Nahraj balíček — začni Internal testing
1. **Testing → Internal testing → Create release** → nahraj `.aab`.
2. Při prvním nahrání zvol **Google Play App Signing** (Google si balíček přepodepíše
   vlastním klíčem — proto se otisk bere z Console, viz A6).
3. Přidej sebe jako testera, nainstaluj z odkazu, ověř funkce.

### A6. Digital Asset Links (zmizí adresní řádek Chromu)
1. Play Console → **Setup (Nastavení) → App integrity → App signing key certificate** →
   zkopíruj **SHA‑256 certificate fingerprint**.
2. **Přidej ho** do pole `sha256_cert_fingerprints` v `.well-known/assetlinks.json` jako druhou
   položku (první — otisk klíče z PWABuilderu — nech, hodí se pro `.apk` nainstalované
   napřímo), push na main.
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

#### ⚠ „Nevidím žádné testery" (hlášeno 14. 9. 2026) — kde se to láme
Tester se v Console **objeví jen tehdy, když prošel touto cestou, a to v tomhle pořadí**:
1. Jeho Google účet (e‑mail) je v seznamu testerů (*Testování → Uzavřené testování → Alpha →
   Testeři*) — nebo je v Google skupině, kterou tam máš přidanou.
2. Vydání ve stopě Alpha má stav **„K dispozici pro testery"** (ne „Koncept", ne „Čeká na
   kontrolu"). Dokud kontrola neproběhla, opt‑in odkaz hlásí „aplikace není dostupná".
3. Tester otevřel **opt‑in odkaz** `https://play.google.com/apps/testing/cz.stepanvcelak.argeodet`
   (v Console: *Testeři → Zkopírovat odkaz*) **na telefonu s Androidem, přihlášený tím účtem,
   který je v seznamu** — a klepl na „Stát se testerem".
4. Teprve pak nainstaloval appku **z Google Play** (odkaz na téže stránce). Ve stopě Alpha
   se pak ukáže v *Testeři → Přihlášení testeři*; počítadlo se **aktualizuje se zpožděním,
   běžně den, někdy dva**.

Co se do testu NEPOČÍTÁ, i když to vypadá stejně:
- **Instalace přes QR kód / odkaz z appky** („Sdílet aplikaci") — to je PWA z prohlížeče, ne
  z Play. Google o ní neví. Přesně proto se tenhle tester po instalaci nikdy nezeptal „chceš
  se stát testerem" — ta otázka se ukáže jen na opt‑in stránce z bodu 3. (Od v315 tlačítko
  vidí jen vlastník appky.)
- Instalace `.apk`/`.aab` ze souboru nebo z pracovní plochy PWABuilderu.
- Tester s jiným Google účtem v telefonu, než jaký je v seznamu (typicky pracovní vs. soukromý).
- Ty sám na svém telefonu se počítáš jen tehdy, když jsi taky prošel opt‑in odkazem a
  nainstaloval z Play (vývojářský účet automaticky testerem není).

Rychlá kontrola bez čekání: na telefonu testera otevři Google Play → profil → *Správa aplikací
a zařízení* → QTRIG; u appky z uzavřeného testu je nahoře pruh **„Jsi beta tester"**. Když tam
není, instalace nebyla z Play.

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
- Feature graphic, screenshoty i texty do Playe jsou hotové (`play/snimky/`, `play/texty.md`).
- **Ověř demo účet** (`play/texty.md`, App access) ještě před odesláním k recenzi — heslo se nedá obnovit.
