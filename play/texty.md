# Texty do Google Play — AR Geodet

Připraveno k okopírování do Play Console → **Grow → Store presence → Main store listing**.
Limity znaků hlídá `python play/kontrola-textu.py`.

---

## Název aplikace (max 30 znaků)

```
AR Geodet
```

## Krátký popis (max 80 znaků)

```
Bodové pole v rozšířené realitě. Mapa, katastr, vytyčování i bez signálu.
```

## Dlouhý popis (max 4000 znaků)

```
AR Geodet je terénní pomůcka pro geodety. Zvedneš telefon, namíříš ho před sebe a v obraze kamery uvidíš, kde jsou body bodového pole a kam máš jít — bez papírových náčrtů a bez zdlouhavého dohledávání.

VYHLEDÁVÁNÍ BODŮ V TERÉNU
• Body bodového pole ČÚZK vidíš přímo v obraze kamery, se vzdáleností a směrem
• Navádění šipkou až k bodu, s upozorněním na blížící se cíl
• Body si můžeš přidat i vlastní — ručně, ze souboru nebo z předchozí zakázky

MAPA A KATASTR
• Mapa s katastrálními hranicemi a parcelními čísly
• Stažení okolí pro práci bez signálu
• Přepínání podkladů (základní mapa, letecký snímek)

MĚŘENÍ A VYTYČOVÁNÍ
• Vytyčování bodů a přímek s průběžnou odchylkou
• Oměrné míry, plochy, protínání, rajón, volné stanovisko
• Metr v kameře a libela pro rychlé kontroly na místě
• AR resekce — srovnání severu podle známých bodů, když kompas telefonu blbne

PŘESNOST NA OČÍCH
• Stav GPS, počet družic a odhad přesnosti pořád na obrazovce
• Protokol kvality měření a kontrolní dvojí měření
• Poznámka: appka je orientační pomůcka, ne měřicí přístroj — přesnost odpovídá GPS a kompasu v telefonu, ne geodetické aparatuře

ZAKÁZKY A PŘEDÁNÍ DO KANCELÁŘE
• Body se řadí do zakázek, každý se svými poznámkami a fotkami
• Export seznamu souřadnic i výkresu DXF
• Záloha a přenos dat mezi telefony

DO TERÉNU
• Funguje offline — stažená data zůstanou v telefonu
• Šetří baterii, čitelná i na ostrém slunci, ovládání jednou rukou i v rukavicích
• Režim levé ruky, gesta jako zkratky na oblíbené nástroje

PRO FIRMY
• Sdílené zakázky a body pro celý tým
• Účty s rolemi (co kdo smí měnit)
• Appku lze používat i bez přihlášení, se základní sadou nástrojů

DATA
Zdrojem bodů bodového pole a katastrálních podkladů jsou otevřená data ČÚZK (Český úřad zeměměřický a katastrální). Appka nesbírá osobní údaje, poloha se používá jen pro zobrazení a měření a neposílá se nikam dál. Podrobnosti v zásadách ochrany soukromí.
```

---

## Ostatní pole v Console

**Zásady ochrany soukromí (Privacy policy URL)**
```
https://stepanvcelak11.github.io/ar-geodet/soukromi.html
```

**Kategorie:** Nástroje (Tools) · značky: geodézie, mapy, měření

**Ikona 512×512:** `icon-512.png` (v kořeni repa)
**Feature graphic 1024×500:** `play/promo/feature.png`
**Screenshoty telefonu:** `play/promo/play-1…4.png` (1080×1920)

> Obrázky vyrábí `python scripts/gen_promo.py` z předlohy `play/promo.html`.
> **Nic se k nim nedodává.** Scéna je APPKA V RÁMU TELEFONU a k němu dvě vyzdvižené
> karty, které přesahují jeho okraj a nesou další fakt.
>
> ⚠⚠ **ROZHRANÍ NA OBRAZOVKÁCH JE OPSANÉ ZE SKUTEČNÉ APPKY**, ne vymyšlené
> (nahlášeno 31. 8. 2026: „jen to moc nevypadá podle aplikace designem"): horní
> stavová pilulka, **svislý dok u pravého okraje** (Body · Nástroje · Nový bod ·
> Vrstvy · Nastavení), kapkovité značky bodů s tučným číslem, moje poloha jako
> kroužek se šipkou a celoobrazovková okna se zeleným nadpisem, kulatým ✕,
> hledacím polem a sekcemi VELKÝMI PÍSMENY. Panel 3 ukazuje okno **Nástroje** i se
> skutečnými názvy nástrojů, panel 4 okno **Body**. Kdyby se appka překreslila,
> srovnat i tohle — jinak budou obrázky v obchodě slibovat něco jiného, než co se
> spustí.
>
> Písma jsou firemní (Sora / Inter / JetBrains Mono z `css/fonts.css`), čísla vždy
> v mono řezu. Pod scénou nadpis a čtyři až pět výhod. Čtyři panely místo osmi a jen pro Android (přání 31. 8. 2026:
> „udělej jich méně, jen pro Android, a na každou fotku klidně více věcí"), takže
> každý spojuje celou oblast:
>
> | # | Panel | Co je na obrázku |
> |---|---|---|
> | 1 | V terénu | AR pohled se značkami + karty „128 bodů v okolí" a „sever srovnán" |
> | 2 | Podklady | mapa s parcelami + karta vrstev + karta „staženo 12 km² offline" |
> | 3 | Měření a výpočty | terč vytyčení s odchylkou + karty výměry a stavu GPS |
> | 4 | Po měření | body zakázky + karta formátů exportu + karta týmu |
>
> ⚠ Čísla ve scénách (souřadnice, výměry, parcelní čísla) jsou UKÁZKOVÁ, ne data.
> ⚠ Starší `play/feature-graphic.png` a `play/screenshoty/` (z `play/make-play-graphics.py`)
> zůstávají jako záloha; screenshoty v nich jsou ale z úvodní obrazovky, která už
> v appce není.

---

## App access (přístup pro recenzenta) — POZOR, tady se to nejčastěji zasekne

Appka má přihlašovací obrazovku, takže Google chce vědět, jak se dovnitř dostane.
Zvol **„All functionality is available without special access"** není správně — appka
má část funkcí za přihlášením. Správně:

> **All or some functionality is restricted** → přidej instrukci:
> „Na úvodní obrazovce lze pokračovat bez přihlášení (režim hosta) — v tomto režimu
> jsou dostupné vyhledávání bodů, mapa a základní měření. Firemní funkce (sdílené
> zakázky, správa účtů) vyžadují firemní účet; testovací účet na vyžádání."

Když budeš chtít, ať vidí i firemní část, založ jim jednorázový účet a vyplň
přihlašovací jméno a heslo do stejného formuláře.

## Data safety (Zabezpečení dat)

- **Sbíráte data?** Ano — **Poloha → Přesná poloha**
  - Účel: *Funkčnost aplikace* (App functionality)
  - Sdíleno s třetími stranami: **NE**
  - Shromažďováno (odesíláno na server): **NE** — poloha zůstává v telefonu
  - Šifrováno při přenosu: **ANO** (vše přes HTTPS)
  - Může uživatel požádat o smazání: **ANO** (data lze smazat v appce)
- **Fotografie/kamera:** kamera se používá jen k živému obrazu, snímky se nikam neodesílají
- Žádné jméno, e-mail, kontakty, reklamní identifikátory — mimo firemní účet
  (e-mail + jméno), pokud se uživatel přihlásí

## Content rating (Hodnocení obsahu)

Vyplní se dotazníkem IARC: **Nástroj / utilita**, žádné násilí, hazard, drogy,
uživatelský obsah ani nákupy → vyjde **3+ / Everyone**.

## Target audience (Cílová skupina)

- Věková skupina: **18 a více** (pracovní nástroj)
- Appka **necílí na děti**
- Reklamy: **NE**
