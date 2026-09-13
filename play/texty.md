# Texty do Google Play — QTRIG

Připraveno k okopírování do Play Console → **Grow → Store presence → Main store listing**.
Limity znaků hlídá `python play/kontrola-textu.py`.

Přepsáno **13. 9. 2026** podle stavu appky v309+ (účet povinný, Základ/Pro, docházka, chat
a hodinky zrušené, smazání účtu, Pro do konce roku zdarma na žádost).

---

## Název aplikace (max 30 znaků)

```
QTRIG
```

## Krátký popis (max 80 znaků)

```
Bodové pole v rozšířené realitě. Mapa, katastr, vytyčování i bez signálu.
```

## Dlouhý popis (max 4000 znaků)

```
QTRIG je terénní pomůcka pro geodety. Zvedneš telefon, namíříš ho před sebe a v obraze kamery uvidíš, kde jsou body bodového pole a kam máš jít — bez papírových náčrtů a bez zdlouhavého dohledávání.

VYHLEDÁVÁNÍ BODŮ V TERÉNU
• Body bodového pole ČÚZK vidíš přímo v obraze kamery, se vzdáleností a směrem
• Karta bodu: vzdálenost, azimut, souřadnice S-JTSK, výška Bpv a rádius, ve kterém bod hledat
• Navádění šipkou až k bodu, průvodce prvním měřením

MAPA A KATASTR
• Mapa s katastrálními hranicemi a parcelními čísly
• Stažení okolí pro práci bez signálu
• Přepínání podkladů (základní mapa, letecký snímek)

VLASTNÍ BODY A ZAKÁZKY
• Nový bod z průměru GPS, klepnutím do mapy nebo přečtením souřadnic z fotky
• Kódy bodů (obruba, šachta, vpusť…) rovnou do CSV a DXF
• Export a import seznamu souřadnic, body řazené do zakázek s poznámkami

MĚŘENÍ A VYTYČOVÁNÍ
• Vytyčování bodů, přímek a lomené osy se staničením a průběžnou odchylkou
• Oměrné míry, plochy, protínání, rajón, volné stanovisko, kalkulačka s postupem výpočtu
• Metr v kameře a libela pro rychlé kontroly na místě
• Srovnání severu podle známých bodů, když kompas telefonu blbne

PŘESNOST NA OČÍCH
• Stav GPS, počet družic a odhad přesnosti pořád na obrazovce
• Vysvětlení, proč telefon měří na ±4 m, a kontrolní dvojí měření
• Poznámka: appka je orientační pomůcka, ne měřicí přístroj — přesnost odpovídá GPS a kompasu v telefonu, ne geodetické aparatuře

DO TERÉNU
• Funguje offline — stažená data zůstanou v telefonu
• Šetří baterii, čitelná i na ostrém slunci, ovládání jednou rukou
• Režim levé ruky, gesta jako zkratky na oblíbené nástroje

PRO STUDENTY
• Cvičné úlohy, poznávačka bodů a vzorce — appka se přizpůsobí, když řekneš, že jsi student

ZÁKLAD A PRO
• Základ je zdarma napořád: hledání bodů, mapa, katastr, vlastní body, oměrné, vytyčení podle seznamu, kalkulačka a další
• Pro přidává osu, rajón, geo-fotku, sdílené zakázky pro firmu a účty s rolemi
• Do konce roku 2026 je Pro zdarma na žádost přímo z appky

DATA A SOUKROMÍ
Zdrojem bodů bodového pole a katastrálních podkladů jsou otevřená data ČÚZK (Český úřad zeměměřický a katastrální). K používání je potřeba účet (jméno a heslo, bez e-mailu). Poloha i obraz kamery se zpracovávají jen v telefonu; na server jdou údaje účtu, anonymní záznamy užívání a hlášení chyb. Žádná reklama. Účet jde kdykoli smazat přímo v appce. Podrobnosti v zásadách ochrany soukromí.
```

---

## Ostatní pole v Console

**Zásady ochrany soukromí (Privacy policy URL)**
```
https://stepanvcelak11.github.io/ar-geodet/soukromi.html
```

**Kategorie:** Nástroje (Tools) · značky: geodézie, mapy, měření

**Ikona 512×512:** `icon-512.png` (v kořeni repa; ikona Q, od 11. 9. 2026)
**Feature graphic 1024×500:** `play/snimky/feature.png`
**Screenshoty telefonu:** `play/snimky/01-ar.png` … `05-novy-bod.png` (1080×1920, v tomhle pořadí)

> Obrázky vyrábí `python scripts/gen_play_snimky.py` ze **skutečných snímků běžící appky**
> (fotky z iPhonu v kořeni repa, `IMG_*.PNG`, ty se do repa neverzují). Skript ustřihne
> stavový řádek iOS a snímek posadí do rámu 9:16 s nadpisem v písmech appky; logo ve
> feature graphic je přímo `icon.svg`.
>
> **Druhá sada — propagační panely `play/promo/`** (`python scripts/gen_promo.py` z předlohy
> `play/promo.html`): rám s nadpisem, telefon se **skutečným snímkem** (od 13. 9. 2026, dřív
> kreslená scéna), dvě vyzdvižené karty s čísly opsanými ze snímku, výhody, patička.
> Do obchodu jdou obě sady — `play/snimky/` je čistá (jen nadpis + snímek), `play/promo/`
> hutnější (víc textu, karty). Vyber jednu, nemíchat. `play/promo/feature.png` je druhá
> varianta feature graphic (logo + text + odznaky, bez telefonu).
> Starší `play/screenshoty/` a `play/feature-graphic.png` (logo před přejmenováním) jsou zastaralé.
>
> Když se appka překreslí, vyfotit znovu (AR pohled jde jen na telefonu — headless nemá
> kameru) a spustit skript znovu; nadpisy jsou v něm v tabulce `SNIMKY`.

---

## App access (přístup pro recenzenta) — POZOR, tady se to nejčastěji zasekne

⚠⚠ Appka **vyžaduje účet hned při startu** (host byl zrušen 6. 9. 2026). Kontrolor Googlu se
bez přihlašovacích údajů nedostane nikam a vydání se vrátí zamítnuté. Správně:

> **All or some functionality is restricted** → přidej přihlašovací údaje:
>
> - Uživatelské jméno (kód účtu): `SUQP2D36`
> - Heslo: `Geodet-Demo-2026`
> - Instrukce: *Na úvodní obrazovce klepni na „Přihlásit se (mám kód účtu)", zadej kód
>   účtu a heslo. Účet je v tarifu Základ — přesně to, co dostane běžný uživatel.
>   Vyhledávání bodů v kameře vyžaduje polohu v ČR (data ČÚZK); mimo ČR appka ukáže mapu
>   a vlastní body.*

Demo účet byl založen 6. 9. 2026 na ostrém serveru (viz paměť projektu). Před odesláním
k recenzi si **ověř, že se s ním pořád jde přihlásit** (heslo se nedá obnovit — kdyby ne,
založ v appce nový demo účet a údaje tady přepiš).

## Data safety (Zabezpečení dat)

Musí sedět s `soukromi.html`. Od 13. 9. 2026 appka posílá na server víc než jen polohu
do dotazů — vyplň takhle:

- **Sbíráte nebo sdílíte uživatelská data?** ANO
- **Šifrováno při přenosu:** ANO (HTTPS)
- **Může uživatel požádat o smazání dat:** ANO — **URL pro smazání účtu:**
  ```
  https://stepanvcelak11.github.io/ar-geodet/smazani-uctu.html
  ```
  (appka umožňuje založit účet → Google vyžaduje i cestu ke smazání, v appce je
  Nastavení → Více → O aplikaci → Smazat účet)

Typy dat (vše *shromažďováno*, nic *sdíleno s třetími stranami*, účel vždy
*Funkčnost aplikace* + u záznamů užívání a chyb *Analytika*):

| Skupina | Položka | Povinné? | Poznámka |
|---|---|---|---|
| Osobní údaje | Jméno | povinné | jméno, které si člověk zvolí při založení účtu (nemusí být pravé) |
| Osobní údaje | Jiné info (kontakt) | volitelné | telefon/e-mail, jen když si ho sám vyplní |
| Aktivita v aplikaci | Interakce v aplikaci | povinné | které nástroje se otevřely, kolik bodů přibylo — bez souřadnic |
| Aktivita v aplikaci | Jiný obsah vytvořený uživatelem | volitelné | zprávy autorovi, hodnocení; body zakázky jen při zapnuté synchronizaci ve firmě |
| Informace a výkon aplikace | Protokoly chyb | povinné | text chyby, verze appky, druh telefonu |
| Zařízení nebo jiné ID | ID zařízení | povinné | anonymní identifikátor odvozený z prohlížeče |
| Poloha | Přesná poloha | **NE — nesbírá se** | zpracovává se jen v telefonu; do dotazů třetích stran (ČÚZK, mapy, počasí) jde jako parametr, ale server aplikace ji neukládá |

- **Fotografie/kamera:** kamera se používá jen k živému obrazu, snímky se nikam neodesílají → nedeklaruje se
- **Finanční info:** NE (v appce z Playe se nic nekupuje; Pro je do konce roku 2026 zdarma na žádost)

## Content rating (Hodnocení obsahu)

Vyplní se dotazníkem IARC: **Nástroj / utilita**, žádné násilí, hazard, drogy,
uživatelský obsah sdílený s cizími lidmi ani nákupy → vyjde **3+ / Everyone**.

## Target audience (Cílová skupina)

- Věková skupina: **18 a více** (pracovní nástroj)
- Appka **necílí na děti**
- Reklamy: **NE**
- Nákupy v aplikaci: **NE** (viz Finanční info výše; kdyby se od 2027 prodávalo Pro přímo
  v appce z Playe, muselo by to jít přes Google Play Billing — teď se v TWA nákup schovává,
  `js/pro-zamky.js` → `jeTwa()`)
