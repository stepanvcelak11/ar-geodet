# 6 návrhů: hledání závad v terénu + vizuál a ovládání

Podklad z průchodu appkou (stav main + větev `fix/spodni-lista-tutorial`).

> **STAV (25. 7. 2026):** uživatel vybral **1, 4, 5, 6** → implementováno na větvi
> `feat/zavady-vizual-ux` (js/zavady.js, css/tokens-outdoor.css + nahledy-kontrast.html,
> js/usadit-ar.js + rozšíření app-search, js/stavovy-pruh.js). Z návrhu 6 vynecháno
> hlasové čtení výsledků (vyžadovalo by zásah do měřicích modulů). Netestováno v prohlížeči.
> Návrhy **2 a 3 čekají** na jmenovitý výběr.

> **Výklad zadání:** „hledání poruch v terénu" beru jako *hledání nesouladů mezi
> projektem/dokumentací a skutečností* — tedy vada pokládky (výška, tloušťka vrstvy,
> sklon), zničený/posunutý bod, kolize s podzemní sítí, geometrie nesedí na GP.
> Pokud jsi tím myslel něco užšího (např. poruchy sítí — úniky, kabelové závady),
> řekni to a návrhy 1–3 překlopím.

---

## Co jsem našel jako slabiny (fakta, ne dojmy)

| # | Nález | Kde |
|---|---|---|
| 1 | **44 dlaždic nástrojů** v jedné mřížce (12 statických + 32 registrovaných) | `index.html:312–332`, `agRegisterFieldTool` v 32 modulech |
| 2 | **7 kategorií, dvě skoro stejné**: „Katastr a data" (statická) vs. „Katastr a sítě" (jen kvůli jednomu modulu) | `utility-networks.js:639` |
| 3 | **7 nástrojů znamená totéž** („srovnej mi AR se skutečností"): Srovnat sever, Srovnat podle bodu, Srovnat AR na 2 body, Kalibrace na ref. bod, Lokalizace (Helmert), AR resekce, Volné stanovisko | `ar-calibrate`, `orient-point`, `ar-calib2`, `ref-calibration`, `localization-helmert`, `ar-resection`, `free-station` |
| 4 | **Dvě různá vyhledávání**: `tools-search` (uvnitř Nástrojů) a chytré hledání (uvnitř „Více") — musíš vědět, kde hledat | `index.html:309`, `app-search.js` |
| 5 | **Outdoor mód (na slunce) pokrývá 7 z 22 CSS** — dialogy 15 modulů zůstanou na slunci průsvitné sklo | `grep outdoor-mode css/` |
| 6 | **Režim rukavic pokrývá 8 z 22 CSS** — stejný problém, jen menší | `grep ag-glove css/` |
| 7 | **Průvodce úkolem nezná činnost „kontrola / hledání závad"** — má 7 větví (vytyčování, sběr, úřední body, měření, výpočty, kde stojím, monitoring) | `pruvodce.js:104–113` |
| 8 | **Nálezy jsou rozsypané po modulech** — oměrné hlásí odchylku v jednom modálu, epochy v druhém, QC ve třetím, ochranné pásmo sítí ve čtvrtém. Nikde není jeden seznam „co mi dnes nesedělo" | `check-distance`, `epochy`, `qc-engine`, `utility-networks` |
| 9 | **Bod nemá stav** — je nebo není. Chybí „nenalezen", „zničen", „posunut", „opraveno" | `logika.js` (model bodu: `id/name/lat/lng/cat/type/vyska/acc/prov`) |

---

## Návrh 1 — Režim „Závady": zápis nálezu na jedno ťuknutí

**Dnes:** když v terénu najdeš vadu (nedodržená výška, prasklina, chybějící mezník,
odkrytá chránička), nemáš kam ji dát. Uděláš „nový bod" a napíšeš to do poznámky —
a v seznamu bodů to pak splyne s vytyčovacími body.

**Návrh** (`js/zavady.js`, odpojitelná vrstva, ~1 nový modál + vrstva v mapě/AR):
- Velké tlačítko **„Závada"** (v doku vedle „Nový bod", nebo dlouhý stisk na „Nový bod").
- Jeden formulář na jednu obrazovku: **foto → kategorie → závažnost (1–3) → poznámka**.
  Poloha, čas, přesnost GPS a autor se doplní samy z toho, co appka už má.
- Kategorie per typ zakázky (pro pokládku: *výška mimo toleranci, tloušťka vrstvy,
  sklon, spára, hutnění, poklop/vpusť, znečištění*; obecné: *bod zničen, bod posunut,
  kolize se sítí, neshoda s GP*).
- Závady jsou **červené špendlíky v mapě i v AR**, oddělitelné od bodů zaškrtávátkem.
- Seznam „Závady" s filtrem **otevřené / opravené**, řazení podle závažnosti a
  vzdálenosti („nejbližší otevřená závada 12 m").
- **Protokol** — PDF/CSV s fotkami, souřadnicemi a časem (napojit na `pdf-protocol.js`,
  ať se nepíše nový generátor).

**Přínos:** z appky se stane i nástroj pro *hlášení*, ne jen měření. Zápis závady
trvá ~10 s a nikdo ji už nezapomene, protože visí v seznamu, dokud ji někdo neodškrtne.

**Rozsah:** střední (1 modul, ~600–800 řádků). Riziko nízké — nová vrstva, nesahá do
`logika.js`. Uložení per zakázka jako u ostatních modulů.

---

## Návrh 2 — „Kontrolní obchůzka": aby se závada našla, ne aby se o ni zakoplo

**Dnes:** appka umí *měřit tam, kam přijdeš*. Neumí ti říct **kudy jít** a **kde jsi
ještě nebyl** — a hlavně neumí průběžně hlásit „tady jsi 4 cm nad projektem".

**Návrh** (režim, ne modál — pruh dole + barvení mapy):
- Vybereš **referenci**: DMT z bodů (`dmt-volume.js`), projekt z DXF (`project-import.js`),
  nebo skladbu z „Vrstvy / pokládka" (`vrstvy.js`).
- Jdeš a appka **živě počítá odchylku** své polohy proti referenci a ukazuje ji velkým
  číslem: `+3,8 cm nad projektem`, se semaforem podle nastavené tolerance
  (zelená / žlutá / červená) + haptika při překročení (vibrace už používáme v 10 modulech).
- **Mapa pokrytí**: kudy jsi prošel (z `track-log.js`) se obarví — ohlídá se, že jsi
  nevynechal úsek. „Zkontrolováno 340 z 500 m úseku."
- Při překročení tolerance nabídne **„Zapsat závadu"** — předvyplněnou hodnotou odchylky
  (napojení na návrh 1).
- Do „Průvodce úkolem" přibude osmá větev **„Kontrola / hledání závad"**.

**Přínos:** tohle je vlastní jádro „hledání poruch" — systematické, s důkazem o pokrytí.
Zároveň přesně sedí na kontrolu výšky za finišerem.

**Rozsah:** větší (nový režim + napojení na 3 existující zdroje referencí).
Poctivé upozornění: **výšková odchylka z GPS mobilu je ±metry** — nástroj má smysl
jen s referencí z roveru/kalibrace, nebo jako *relativní* srovnání. Musí to být
v UI napsané, jinak vyrábíme falešnou jistotu.

---

## Návrh 3 — „Nálezy": jedna schránka na všechno, co nesedí

**Dnes:** kontroly už v appce jsou, ale každá si svůj výsledek nechá pro sebe —
oměrné, epochy, QC kód kvality, ochranné pásmo sítí, duplicitní body. Uživatel musí
vědět, že má otevřít zrovna ten modul.

**Návrh** (`js/nalezy.js` — sběrnice + jedna obrazovka):
- Jednotný zápis nálezu: `{typ, závažnost, popis, bod/úsek, hodnota, tolerance, čas}`.
  Existující moduly do ní jen **pošlou** nález (2 řádky kódu v každém).
- Automatické kontroly na pozadí (běží při uložení bodu, ne pořád):
  - bod se oproti minulé epoše posunul přes mez,
  - oměrná nesedí s dokumentací,
  - jsi v ochranném pásmu sítě,
  - dva body na sobě (< 5 cm) s různým číslem,
  - bod uložen s horší přesností, než vyžaduje třída zakázky (`qc-engine.js` to už umí),
  - bod leží mimo parcelu zakázky.
- **Badge s počtem** na doku a jedna obrazovka „Nálezy" se závažností a tlačítkem
  „Vzít na vědomí / Vyřešeno / Založit závadu".

**Přínos:** appka přestane čekat, až se uživatel zeptá, a začne sama upozorňovat.
Zároveň to spojí funkce, které dnes existují, ale nikdo je neotevře.

**Rozsah:** střední. Riziko: **otravnost**. Musí platit pravidlo „žádné hlášení bez
akce, kterou s ním jde udělat" a možnost typ nálezu vypnout.

---

## Návrh 4 — Vizuál: čitelnost na přímém slunci a jednotný vzhled modulů

**Dnes:** design systém v `style.css` je dobrý (tokeny, tmavá „precision instrument"
paleta), ale moduly ho drží jen napůl:
- outdoor mód řeší **7 z 22** CSS — otevřeš na slunci „Kubatury", „Urovnání",
  „Předpisy", „Počasí" a jsi zpátky u průsvitného skla s šedým textem `--text-muted`,
- režim rukavic řeší **8 z 22**,
- velikosti písma v modulech kolísají (11 / 12 / 12,5 / 13,5 px) — pod sluncem
  a v rukavicích je 11 px nečitelných.

**Návrh:**
1. **Jeden token layer navíc** (`css/tokens-outdoor.css`): outdoor a rukavice řešit
   *tokeny*, ne pravidlem per modul — `--glass-bg`, `--text-muted`, `--fs-body`,
   `--tap-min` se v `body.outdoor-mode` / `body.ag-glove` přepíšou globálně a moduly
   to dostanou zdarma, protože už tokeny používají.
2. **Minimální velikost písma 13 px** v modulech, 15 px pro čísla (data font).
3. **Denní (světlý) motiv** jako plnohodnotná varianta — tmavé UI na bílém poledním
   světle prohrává vždycky; opravdové řešení je černý text na bílém, ne jen
   „neprůhlednější tmavá".
4. **Kontrolní stránka** `nahledy-kontrast.html` se všemi panely ve 3 režimech
   (noc / den / slunce), aby šlo ověřit jedním pohledem, co se rozbilo.

**Přínos:** appka bude vypadat jako jeden výrobek, ne jako 80 modulů — a hlavně
půjde použít v poledne na silnici, což je přesně situace, pro kterou je určená.

**Rozsah:** menší až střední, ale dotýká se všeho → **musí se to vidět na mobilu**,
ne odhadovat. Nejlepší kandidát na „udělat a hned vyzkoušet".

---

## Návrh 5 — Ovládání: jeden vstup místo 44 dlaždic

**Dnes:** Nástroje = 44 dlaždic v 7 kategoriích, z toho 7 dlaždic dělá v podstatě
jedno („srovnej AR se skutečností"). Hledání je na dvou místech. Nový uživatel
nemá šanci; ty sám podle mě polovinu nástrojů neotevřeš, protože si nevzpomeneš,
že tam je.

**Návrh:**
1. **Jedno hledání pro celou appku** — sloučit `tools-search` a chytré hledání z „Více"
   do jednoho pole dostupného odkudkoli (lupa v doku). Jedno pole, jeden výsledek,
   otevře cíl.
2. **„Usadit AR" jako jeden průvodce** místo 7 dlaždic: 3 otázky (*Stojíš na známém
   bodě? Vidíš 1 nebo 2 známé body? Máš identické body?*) → appka sama zvolí metodu
   a spustí existující modul. Dlaždice zůstanou dohledatelné hledáním, ale zmizí
   z mřížky.
3. **Kontextové Nástroje** — nahoře sekce **„Teď se hodí"** podle stavu: v režimu
   vytyčování nabídne vytyčovací věci, po importu DXF nabídne lokalizaci, při špatné
   GPS nabídne Predikci signálu a Brutální GPS.
4. Sjednotit „Katastr a data" + „Katastr a sítě" do jedné kategorie (`utility-networks.js:639`).

**Přínos:** z 44 dlaždic se stane ~5 věcí, které vidíš, plus vyhledávání na zbytek.
Nic se nemaže — jen se to přestane cpát do očí naráz.

**Rozsah:** střední; nejvíc práce je průvodce „Usadit AR". Riziko: přesouvání věcí
uživatele mate → udělat to jako **přepínatelné** („zjednodušená mřížka" vs. „vše").

---

## Návrh 6 — „Můžu tomu věřit?": jeden stavový pruh místo hádání

**Dnes:** stav je rozprostřený po obrazovce — info panel, azimut, GPS pruh, indikátor
úspory energie, varování kompasu. Uživatel v terénu ale řeší jedinou otázku:
**můžu teď uložit bod, nebo je to k ničemu?** A na tu se odpovídá skládáním
tří údajů z různých rohů displeje.

**Návrh:**
- **Jeden pruh** (nahoře, tenký, vždy) se čtyřmi kontrolkami: **GPS** (přesnost +
  jak čerstvý fix), **AR/sever** (kalibrováno kdy a jestli platí), **Data** (offline
  podklad k dispozici), **Baterie**.
- Každá kontrolka je zelená/žlutá/červená a **klepnutím řekne, co s tím udělat** —
  ne „PDOP 4.2", ale „*počkej 30 s, nebo běž 5 m od zdi*".
- **Kalibrace AR má expiraci** — po X minutách nebo po přechodu jinam zežloutne
  („sever byl srovnán před 40 min a 300 m odsud — srovnej znovu").
- Před uložením bodu do třídy, na kterou přesnost nestačí, se zeptá (`qc-engine.js`
  bránu už má, jen není vidět).
- Hlasové potvrzení výsledku (jen výstup, `speechSynthesis`) — při měření na kolenou
  v rukavicích: „*plus tři celé osm centimetru*". Volitelné, vypínatelné.

**Přínos:** ubere prvky z obrazovky (dnes 4–5 panelů → 1 pruh) a zároveň přidá
jistotu. Je to nejlevnější způsob, jak se zbavit falešné přesnosti.

**Poznámka:** „semafor čerstvosti GPS" je rozpracovaný na větvi
`feat/zasadni-upravy-1-6` — tenhle návrh by ho měl pohltit, ne postavit vedle.

**Rozsah:** střední, hodně se dá poskládat z existujícího (`gnss-quality`,
`compass-stability`, `power-save`, `qc-engine`).

---

## Kdybych měl vybrat

1. **Návrh 4** (čitelnost/vizuál) — nejrychlejší viditelný efekt, opravuje něco, co
   dnes prokazatelně nefunguje na slunci.
2. **Návrh 1** (Závady) — největší nová hodnota pro „hledání poruch", malé riziko.
3. **Návrh 6** (stavový pruh) — ubere nepořádek a přidá důvěru.

Návrhy 2 a 3 jsou silné, ale větší; 5 je úklid, který dává smysl až po 4.
