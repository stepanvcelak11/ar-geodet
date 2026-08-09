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

## Přesnost — co to číslo u bodu znamená

U každého bodu je údaj `±X m`. **Není to střední chyba určení polohy.**

Connect IQ číselnou přesnost ani DOP nedává — `Position.Info.accuracy` je jen
hrubý stupeň (POOR / USABLE / GOOD). Jediné, co se dá spočítat, je **rozptyl
vlastních vzorků**: nabere se 30 poloh po sekundě, vyhodí se odlehlé (nad 2,5
rozptylu) a vezme se průměr.

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

## Co v tom zatím není

- **Podklad pod body** — čáry cest, vody a srázů z OpenStreetMap. Je to
  domluvený další krok: dlaždice 500 × 500 m se zjednodušenými polyliniemi
  (Douglas–Peucker ~3 m), souřadnice jako celá čísla v decimetrech od kotvy,
  ukládané do `Application.Storage`, aby to fungovalo i bez signálu. Kreslit
  se budou jako vrstva pod body — v `MapaView.onUpdate` mezi `_kruznice`
  a `_body`, nic ostatního se kvůli tomu nepředělá.
- **Varování „napřímo to nepůjde"** — test, jestli úsečka já → cíl protíná
  čáru třídy překážka (sráz, voda, plot). Dává smysl až s podkladem.
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
