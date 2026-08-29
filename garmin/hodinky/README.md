# AR Geodet — hodinky (Garmin Forerunner 255)

Zjednodušený pomocník k mobilní aplikaci. Umí čtyři věci a schválně nic víc:

- **mapku okolních bodů** — vlastní plátno, já uprostřed, body kolem
- **seznam okolí** seřazený od nejbližšího bodu
- **navigaci k bodu** — velká šipka, zbývající vzdálenost, vibrace při dojití
- **založení bodu** průměrováním polohy, s automatickým číslováním 1, 2, 3, …

Bez signálu funguje celá — body vznikají a žijí v hodinkách. Když signál je,
umí navíc **párování s mobilem šestimístným kódem**, **synchronizaci bodů**
oběma směry a **stahování dlaždic podkladu**, všechno přes Cloudflare Worker
(`cloud/worker.js`, zdroje `source/Cloud.mc`, `ParovaniView.mc`, `SyncView.mc`).
Druhá cesta do mobilu je **QR kód** (`source/QrExportView.mc`) — ta signál
nepotřebuje vůbec.

> ⚠ Online část potřebuje **nasazený Worker** (`wrangler deploy` ve složce
> `cloud/`). Dokud na serveru běží starší verze bez `/watch/*`, párování ani
> synchronizace nefungují — mobil na to od SW v260 upozorní hláškou
> „server běží na starší verzi", dřív to vypadalo jako neplatný kód.

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
na *vytyčení* ne. V mobilní aplikaci jsou tyhle body proto vedené zvlášť:
kreslí se **růžově** (vlastní jsou zelené), v seznamu bodů mají značku ⌚
a vlastní přepínač „jen body z hodinek". Pozná se to podle `prov.src`,
které razítkuje Worker při nahrání.

## Korekce na známém bodu

Rozptyl výše neumí odhalit **systematickou** chybu — ionosféru, dráhy družic,
odrazy od domů. Ta posouvá všechny vzorky stejným směrem, takže se v rozptylu
neprojeví. Zjistit se ale dá porovnáním se skutečností:

1. Stoupnout si na bod, jehož souřadnice jsou známé (přišel z mobilu).
2. Dlouze ↑ → **Korekce na bodě** → vybrat ten bod ze seznamu.
3. Hodinky spočítají rozdíl mezi ním a tím, co hlásí GNSS, a **odečítají ho
   od všech dalších poloh** — od měření bodů i od navigace.

Aktivní korekce je vidět na mapě za časem (`12:34 · kor 1,2`) i na obrazovce
zakládání bodu. Vypne se sama po **15 minutách** nebo když se odejde dál než
**kilometr** — stará korekce je horší než žádná, protože se tváří, že se něco
zlepšilo.

**⚠ Není to RTK ani DGPS.** Vyruší se jen ta část chyby, která je v okolí
společná. Za známý bod se schválně dají vzít **jedině body z mobilu**: bod
naměřený hodinkami je sám nejistý na metry a korigovat podle něj znamená jen
přesypat šum z jedné hromádky na druhou.

## Označ tady

Dlouze ↑ → **Označ tady** uloží značku okamžitě, bez obrazovky a bez
potvrzování — auto, stanovisko, kde jsem nechal lať, odkud jsem odbočil.

Značky mají **vlastní číslování Z1, Z2, …** a nesahají na sérii měřených bodů:
kdyby ukusovaly z rezervovaného bloku čísel, vznikaly by v číslování díry,
které by nikdo neuměl vysvětlit.

## Čísla bodů se nemůžou potkat s mobilem

Při párování dostanou hodinky **rezervovaný blok** čísel (server pošle `from`
a `to`), takže offline nemůžou vyrobit bod se stejným číslem jako mobil.
Blok je ale konečný — kolik z něj zbývá, je vidět v nabídce u *Číslování bodů*.

**Až dojde, dostanou čísla předponu `W`** (`W51`, `W52`, …). Mobil čísluje
samými číslicemi, takže se s ním takové číslo potkat nemůže. Radši ošklivé
číslo než dva různé body, které si v kanceláři přepíšou jeden druhého.
Nový blok si hodinky vezmou při synchronizaci, jakmile ho server nabídne.

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

1. Přeložit pro zařízení: `Ctrl+Shift+P` → **Monkey C: Build for Device** →
   *Forerunner 255*. Z příkazové řádky:

   ```
   <sdk>\bin\monkeyc.bat -o bin\hodinky.prg -f monkey.jungle ^
       -y %APPDATA%\Garmin\ConnectIQ\developer_key.der -d fr255 -w
   ```
2. Připojit hodinky USB kabelem. Objeví se jako disk **GARMIN**.
3. Zkopírovat `bin/hodinky.prg` do složky **`GARMIN/APPS/`** na tom disku.
4. Bezpečně odpojit. Aplikace je pak na hodinkách mezi **aktivitami**
   (tlačítko START ze základní obrazovky).

Do obchodu Connect IQ se nic dávat nemusí.

⚠ Po prvním spuštění zapnout v hodinkách **Nastavení → Systém → GPS → Vše +
vícepásmové**. Aplikace se do toho schválně nemíchá a bere systémové
nastavení; na FR255 je L1+L5 znát.

## Přenos bodů z/do mobilu

**⚠ Hodinky s telefonem přímo nemluví.** Cesta „telefon ↔ hodinky" přes
Bluetooth vyžaduje nativní doprovodnou aplikaci (Connect IQ Mobile SDK)
a AR Geodet je web — do té BLE linky se nedostane, drží ji Garmin Connect
a protokol je uzavřený. Jde to tedy oklikou přes internet:

```
hodinky ──makeWebRequest──▶ Cloudflare Worker ◀──HTTPS── mobilní appka
```

Hodinky si tunel k síti berou přes Garmin Connect na telefonu (nebo přes
Wi-Fi doma), takže v terénu to funguje, dokud je telefon poblíž.

Přihlásit se hodinky nemůžou (nemají klávesnici), proto **párovací kód**.
Ten se ⚠ **opisuje z hodinek do mobilu**, ne naopak: sideloadovaná aplikace
se v seznamu Connect IQ v Garmin Connect vůbec neobjeví, takže do jejího
nastavení se nedá napsat nic.

1. Na hodinkách dlouze podržet ↑ → **Synchronizovat s mobilem**. Ukáže se
   šestiznakový kód.
2. Kód opsat v mobilu: **Nástroje → Hodinky Garmin**.
3. Hodinky se samy doptají a spárují — nahrají naměřené a stáhnou
   20 nejbližších bodů.

Kód na displeji je veřejný, proto sám o sobě nestačí: token se vydává proti
tajemství, které hodinky dostaly zároveň s kódem a nikde neukazují.

Body se ukládají do **téže tabulky `sync_points`** jako z mobilu a ve stejném
tvaru, takže se v aplikaci objeví samy. Filtrování podle vzdálenosti dělá
server — celá zakázka by se do paměti hodinek nevešla. Čísla bodů si hodinky
rezervují po blocích padesáti, aby offline nevznikly dva body se stejným
číslem.

**⚠ Vyžaduje nasazený Worker** s endpointy `/watch/code`, `/watch/pair`
a `/watch/points` (`cloud/worker.js`). Bez toho mobil u generování kódu
napíše, že to server ještě neumí.

## Podklad — barvy, ne tloušťky

Pod body se kreslí vektorový podklad z OpenStreetMap. **Význam nese barva.**
Tloušťku čáry si nikdo nezapamatuje, barvu ano:

| barva | co to je |
|---|---|
| šedá | silnice a cesty (širší = větší) |
| tmavě šedá, tenká | pěšina |
| modrá | voda |
| zelená plocha | les, park |
| žlutá plocha | pole, louky |
| **červená** | **neprojdeš** — sráz, násep, zeď, plot |
| šrafovaný obdélník | budova |

Budovy se schválně kreslí jen jako **šrafovaná obálka**, ne skutečný půdorys —
na 260px displeji by ho nikdo nepoznal a stál by desetkrát víc. V dlaždici
proto budova nese jen pět čísel.

Kdyby si člověk barvu nepamatoval, je v nabídce **Legenda**.

Zapíná se v nabídce položkou **Podklad**.

Přibalené jsou dvě **ukázkové dlaždice** a aplikace si vybere tu, ve které
právě stojíte:

| dlaždice | kotva | co je na ní vidět |
|---|---|---|
| město | 50,08 / 14,42 | hustá zástavba, ulice, pár parků |
| údolí | 50,0365 / 14,3760 | Prokopské údolí — les, pěšiny, 47 srázů |

Vyrábí je `garmin/nastroje/dlazdice.py` z dat Overpass API. V ostrém provozu
dlaždice počítá **mobil** (`js/hodinky-dlazdice.js`, Overpass + Douglas–Peucker)
a Worker je jen sklad — na free plánu má 10 ms CPU, takže by je nestihl spočítat
sám. Hodinky si je stáhnou přes `makeWebRequest`; v paměti je vždy jen jedna.

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

Dlaždice z Workeru i synchronizace s mobilem tady byly donedávna vedené jako
nehotové — **obojí je hotové** (viz úvod). Zbývá:

- **Nasadit Worker** — `wrangler deploy` ve složce `cloud/`. Do té doby je celá
  online část mrtvá, i když je v hodinkách i v mobilu napsaná.
- **Výška bodu z barometru** — teď se bere jen z GPS.
- **Editace bodu na hodinkách** — jde založit, smazat a opravit na známý bod,
  ale ne přepsat souřadnice ručně.

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
| `source/Podklad.mc` | plochy, čáry cest a překážky |
| `source/Legenda.mc` | co která barva znamená |
| `source/Korekce.mc` | posun podle známého bodu + jeho výběr |
| `source/Znacka.mc` | „Označ tady" — rychlá značka mimo číselnou sérii |
| `source/Displej.mc` | umísťování textu, aby ho kulatý okraj neořízl |
| `../nastroje/dlazdice.py` | výroba dlaždice podkladu z dat OpenStreetMap |
