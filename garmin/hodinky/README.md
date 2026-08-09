# AR Geodet — hodinky (Garmin Forerunner 255)

Zjednodušený pomocník k mobilní aplikaci. Umí čtyři věci a schválně nic víc:

- **mapku okolních bodů** — vlastní plátno, já uprostřed, body kolem
- **seznam okolí** seřazený od nejbližšího bodu
- **navigaci k bodu** — velká šipka, zbývající vzdálenost, vibrace při dojití
- **založení bodu** průměrováním polohy, s automatickým číslováním 1, 2, 3, …

Zatím pracuje **čistě offline** — body vznikají a žijí v hodinkách. Přenos
z mobilu a do mobilu je další krok (přes Cloudflare Worker, který už projekt má).

> S webovou aplikací v `../..` nesdílí ani řádek kódu. Connect IQ má vlastní
> jazyk (Monkey C), vlastní SDK a vlastní build — geodetické vzorce jsou tady
> napsané znovu.

## Ovládání

Forerunner 255 nemá dotykový displej, všechno jde přes pět tlačítek.

| Obrazovka | tlačítko | co udělá |
|---|---|---|
| **Mapa** | START | otevře seznam okolí |
| | nahoru / dolů | přiblíží / oddálí (25 – 800 m) |
| | **dlouze nahoru** | nabídka |
| | BACK | zruší navigaci, podruhé ukončí aplikaci |
| **Seznam** | nahoru / dolů | listování |
| | START | naviguj k tomuto bodu |
| **Navigace** | START / BACK | zpátky na mapu |
| **Nový bod** | START | ukončí měření dřív, pak uloží |
| | BACK | zahodí (uloží se **jedině** přes START) |

V nabídce (dlouze nahoru) je *Nový bod*, přepínač *Otočení mapy*
(podle směru / sever nahoře), počet bodů v paměti, *Ukázkové body* pro
zkoušení v simulátoru a mazání.

## Zakládání bodu — nečeká se

Aplikace průměruje **pořád**, kdykoli se stojí na místě. Jakmile se člověk
pohne (rychlost přes 1 m/s nebo skok o víc než 8 m od dosavadního průměru),
sběr se zahodí a začne znovu.

Takže když se bod zakládá, je zpřesněná poloha **už hotová** a START ji rovnou
uloží — žádný odpočet, žádné čekání. Kdo chce přesněji, prostě chvíli počká
a dívá se, jak rozptyl klesá; čekání je dobrovolné, ne povinné. Na mapě je
průběžný stav nahoře jako `±0,8 m · 24 s`.

Drží se klouzavé okno posledních dvou minut — starší vzorky už o tom, kde
stojím teď, nic neříkají.

## Přesnost — co to číslo u bodu znamená

U každého bodu je údaj `±X m`. **Není to střední chyba určení polohy.**

Connect IQ číselnou přesnost ani DOP nedává — `Position.Info.accuracy` je jen
hrubý stupeň (POOR / USABLE / GOOD). Jediné, co se dá spočítat, je **rozptyl
vlastních vzorků**: vyhodí se odlehlé (nad 2,5 rozptylu) a vezme se průměr.

To číslo tedy říká „jak klidně to leželo", ne „jak daleko jsem od pravdy".
**Systematickou chybu z odrazů signálu (multipath) neodhalí** — ta posouvá
všechny vzorky stejným směrem, takže se v rozptylu vůbec neprojeví. Schválně
se taky nedělí odmocninou z počtu vzorků (což by dalo střední chybu průměru):
u GPS jsou vzorky po sekundě silně závislé a takový výsledek by lhal směrem
k optimismu.

Reálně čekejte **jednotky metrů**. Na *nalezení* bodu v terénu to stačí,
na *vytyčení* ne. Až se body budou přenášet do mobilu, měly by tam být vedené
jako zvláštní třída, ať se nesmíchají s tím, co je změřené pořádně.

**Nastavte si v hodinkách** Nastavení → Systém → GPS na *Vše + vícepásmové*
(SatIQ). Aplikace se do toho schválně nemíchá a bere, co je nastavené
systémově — Forerunner 255 umí L1 + L5 a je to znát.

## Sestavení a zkoušení

Na tomhle počítači **Connect IQ SDK není nainstalované, takže projekt zatím
nikdo nezkompiloval** — kód je napsaný, ale neověřený překladačem. První
build nejspíš vypíše pár drobností k dorovnání.

1. **SDK Manager** — stáhnout z <https://developer.garmin.com/connect-iq/sdk/>
   (chce přihlášení Garmin účtem, zdarma). V něm stáhnout nejnovější SDK
   a zařízení *Forerunner 255*. Java už na počítači je (Corretto 21).
2. **VS Code** — rozšíření *Monkey C* od Garminu.
3. `Ctrl+Shift+P` → **Monkey C: Generate a Developer Key** (jednorázově).
4. Otevřít složku `garmin/hodinky` a `Ctrl+Shift+P` → **Monkey C: Build for
   Device** / **Run App** (simulátor).

V simulátoru se poloha nastavuje přes *Simulation → Position*. Body se tam
žádné nenaměří, proto je v nabídce položka **Ukázkové body** — rozsype deset
bodů v okolí do 350 m.

### Nahrání do hodinek

Připojit přes USB, zkopírovat `bin/hodinky.prg` do `GARMIN/APPS/` na disku
hodinek, odpojit. Aplikace se objeví mezi aktivitami. Do obchodu Connect IQ
se nic dávat nemusí.

## Podklad — čáry cest, vody a překážek

Pod body se kreslí vektorový podklad z OpenStreetMap: silnice, cesty, pěšiny,
voda a hlavně **překážky** (sráz, násep, zeď, plot) červeně — kvůli tomu ten
podklad hlavně je, aby bylo vidět, že napřímo to nepůjde.

Zapíná se v nabídce položkou **Podklad**.

Zatím je přibalená jedna **ukázková dlaždice** pro okolí 50,08 / 14,42 (Praha),
aby šel podklad vyzkoušet v simulátoru. Vyrábí ji `garmin/nastroje/dlazdice.py`
z dat Overpass API; v ostrém provozu tutéž práci udělá Cloudflare Worker
a hodinky si dlaždice stáhnou přes `makeWebRequest`.

**⚠ Kreslení musí být škrceno, jinak hodinky aplikaci shodí** hláškou
*Watchdog Tripped — Code Executed Too Long*. Proto:

- obálka každé čáry a pořadí podle důležitosti se počítají **předem ve
  skriptu**; když se to zkusilo na hodinkách, watchdog to zabil
- čáry mimo výřez se přeskakují podle obálky
- na snímek se vykreslí nejvýš **260 úseků**, v pořadí překážky → silnice →
  voda → cesty → pěšiny → budovy; co se nevejde, se nenakreslí. Při přiblížení
  se stejně skoro všechno ořeže výřezem, strop dolehne jen na největší oddálení

Zdroj dat: OpenStreetMap, licence ODbL.

## Co v tom zatím není

- **Varování „napřímo to nepůjde"** — test, jestli úsečka já → cíl protíná
  čáru třídy překážka. Podklad už je, takže tohle je pár desítek průsečíků
  úseček a levné.
- **Dlaždice z Workeru** — stahování po dlaždicích 500 × 500 m a ukládání do
  `Application.Storage`, aby podklad fungoval i bez signálu. Zatím jen jedna
  ukázková, přibalená ve zdrojích.
- **Synchronizace s mobilem** — endpointy `GET/POST /watch/points` ve Workeru,
  párování šestimístným kódem, rezervace bloku čísel pro offline provoz
  (jinak vzniknou dva body se stejným číslem).

## Soubory

| soubor | co dělá |
|---|---|
| `source/ArGeodetApp.mc` | vstupní bod, drží sledovač polohy a mapu |
| `source/Sledovac.mc` | poslední poloha z GNSS, kvalita, směr |
| `source/Geo.mc` | vzdálenost a azimut na elipsoidu WGS84 |
| `source/Prumer.mc` | průměrování polohy a rozptyl vzorků |
| `source/Body.mc` | body v `Application.Storage`, číslování, hledání okolí |
| `source/MapaView.mc` | mapka + ovládání tlačítky |
| `source/Seznam.mc` | seznam okolí (Menu2) |
| `source/NavigaceView.mc` | šipka a vzdálenost k bodu |
| `source/NovyBodView.mc` | měření nového bodu |
| `source/Nabidka.mc` | nabídka pod dlouhým stiskem nahoru |
| `source/Podklad.mc` | vektorové čáry cest, vody a překážek |
| `source/Displej.mc` | umísťování textu, aby ho kulatý okraj neořízl |
| `../nastroje/dlazdice.py` | výroba dlaždice podkladu z dat OpenStreetMap |
