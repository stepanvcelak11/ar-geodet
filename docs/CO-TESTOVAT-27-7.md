# Co je v appce nového z 27. 7. 2026 — seznam k otestování

Verze cache: **SHELL_CACHE v207**. Po otevření na mobilu nech doběhnout aktualizaci
(nebo appku zavři a znovu otevři), ať nesedíš na staré verzi.

Na hlavní větvi je dnes **14 commitů** od tří paralelních sessions. Nic z toho není
odzkoušené v prohlížeči — proto tenhle seznam.

---

## 1. Úvodní a přihlašovací obrazovka

**Živé hodnoty v pozadí** místo staré měřické čárky a natvrdo napsaného „142,7 m".
Čísla plují ve třech hloubkách (vzdálená menší, bledší, pomalejší).

- [ ] Čárka, která končila v 80 % šířky, je opravdu pryč — nikde neuvidíš useknutou linku.
- [ ] V pozadí prolétávají hodnoty: čas, datum, teplota, vítr, tlak, vlhkost, nadmořská
      výška, místo, Y a X v S-JTSK, šířka/délka, východ a západ Slunce, počet bodů.
- [ ] **Na čerstvé instalaci uvidíš jen čas a datum** — to je správně. Zbytek se doplní,
      až appka během práce nasbírá polohu a stáhne počasí (nic si kvůli pozadí nestahuje
      ani nezapíná GPS).
- [ ] Hodnoty se po ~20 s samy obnoví (hlavně čas).

**Režim práce na úvodní obrazovce** — pod kartou zakázky: Univerzální / Pokládka /
Vytyčování / Katastr / Kontrola.

- [ ] Volba zúží Nástroje na 6–8 dlaždic pro danou práci; zbytek je pod „Zobrazit
      všechny nástroje" a hledání prohledává vždy vše.
- [ ] Kartu jde vypnout („Nezobrazovat") a zapnout zpět v Nastavení → Vzhled.

**Zámek proti hádání hesla** — po 5 chybách zámek na 1 minutu, dál se čekání
zdvojnásobuje až na 15 minut.

- [ ] Zámek přežije reload appky.
- [ ] Platí i pro bránu s kódem firmy a pro účty bez PINu.
- [ ] Chyba sítě se do počítadla NEmá počítat.

---

## 2. Modály (okna)

**Křížek vpravo nahoře + zavření potáhnutím dolů.** Tlačítka „Zavřít" zůstala.

- [ ] Křížek je vidět hned, bez rolování (zkus *O aplikaci* nebo *Předpisy* — dřív jsi
      musel doscrollovat na konec).
- [ ] Potáhnutí dolů okno zavře, **ale jen když je obsah nascrollovaný úplně nahoře** —
      uprostřed dlouhého textu má gesto normálně rolovat.
- [ ] **Nikde nejsou DVA křížky vedle sebe** (tohle jsem dnes opravoval — u nástrojových
      oken je přidávaly dvě různé vrstvy).
- [ ] **Nastavení** křížek ani gesto záměrně NEMÁ — ukládá se teprve tlačítkem „Uložit vše
      a Zavřít", takže by zavření mimo něj tiše zahodilo přenastavené volby.
- [ ] **Formulář nového bodu** má křížek, ale gesto ne (cuknutí prstem by zahodilo
      rozepsaný bod).
- [ ] Křížek v levorukém režimu přeskočí na druhou stranu.

---

## 3. Nástroje

**Nástroje jako seznam úkonů** — druhý pohled vedle mřížky, seznam sloves místo 61 ikon.

- [ ] Přepínač mezi seznamem a mřížkou funguje, hledání funguje v obou.
- [ ] **Zaměstnanec (role bez práv) nesmí v seznamu vidět nástroj, na který nemá právo** —
      tohle jsem dnes opravoval, seznam si dlaždice bere z DOM a skryté podle role
      nepoznal.

**Dělené načítání nástrojů** (dvě různé techniky, dohromady 866 kB mimo start).

- [ ] Appka startuje viditelně dřív než včera.
- [ ] **V Nástrojích jsou po startu všechny dlaždice** — nejpozději do ~1,5 s. Když
      Nástroje otevřeš okamžitě po startu, mají se dotáhnout hned.
- [ ] Nástroje jde otevřít i **offline** (soubory jsou v předcache; tohle je nejdůležitější
      test celé změny — vypni data a projdi pár nástrojů).
- [ ] V bráně „Založit firmu / další možnosti" funguje i když na něj ťukneš hned po
      startu (počká si na modul, místo hlášky o nenačtení).

---

## 4. Nahoře na obrazovce

**Centrum upozornění** — jeden sloupec místo sedmi prvků, které si o stejné místo
říkaly a překrývaly se (stavový pruh, host, GPS ztracena, DMR, AGPose, slabá GPS,
rušený kompas).

- [ ] Když se sejdou dvě hlášení, řadí se pod sebe a **nepřekrývají se**.
- [ ] Na telefonu s výřezem nic neleze pod systémovou lištu.
- [ ] Hlášení jde odklepnout a nevrací se hned zpátky.

**Stavová bublina** — semafor + přesnost + azimut v jedné bublině, po klepnutí detail
GPS · sever · data · baterie.

- [ ] Sloučené panely (#compass-debug, #gps-avg, kompasová stabilita, #info) jsou skryté
      a nekoukají zpod bubliny.

---

## 5. Nastavení

- [ ] **Hledání v Nastavení** najde volbu podle názvu a skočí na ni.
- [ ] Výchozí pohled je kratší; jednotlivé volby zůstávají dostupné pod tím.
- [ ] **Záložka skrytá podle role se nesmí dát najít hledáním** (dnes opraveno).
- [ ] **Profily Terén / Přesnost / Ukázka** nad záložkami přenastaví existující prvky
      (appka je ukládá svým vlastním kódem, modul si nedrží druhou kopii nastavení).
- [ ] **Profil zařízení** v Údržbě: export/import kalibrace telefonu do `.agdev`
      (zorný úhel, výška očí, korekce severu). Body a zakázky v tom nejsou.

---

## 6. Mapa, AR, baterie

- [ ] **Panel Mapa a vrstvy ve Splitu** se vejde na obrazovku a jde v něm rolovat
      (dřív tah po panelu posouval mapu).
- [ ] **AR značky** se pozicují jen přes `transform` — poloha má být identická jako dřív,
      jen bez zátěže. Zkontroluj, že značky sedí na bodech.
- [ ] V režimu „AR" (mapa skrytá) se mapa už nerotuje na pozadí — **ale po přepnutí zpět
      do Splitu musí být mapa hned správně otočená.**
- [ ] Kompas se poslouchá jen jednou — azimut má reagovat stejně plynule jako dřív.

---

## 7. Formuláře a čtverečky

- [ ] **Nový bod**: pomocníci (Z průměru GPS / Z mapy / Z fotky OCR / Přesná GPS) jsou
      mřížka dlaždic, ne čtyři široké řádky.
- [ ] **Export / Import bodů**: stejná mřížka (Import souboru, PDF protokol, Sdílet QR,
      Načíst QR).

---

## 8. Texty a návody

- [ ] **15 návodů (TOOL_HELP)** přepsáno podle skutečného kódu — u nástrojů, které jsi
      dřív používal, si přečti nápovědu a řekni, jestli teď odpovídá.
- [ ] **Tutoriál**: nový krok Vrstvy v mapě, přepsané kroky Nový bod a Body, otočka
      180° → 90° ve čtvrtinách.
- [ ] **O aplikaci + soukromi.html**: text „appka nemá žádný server a nic neodesílá" už
      neplatil (firemní cloud, přepis hlasovek, počasí) — teď jsou tam tři jmenované
      výjimky. Přečti si to, je to právní text o tvé appce.

---

## 9. Pod kapotou (nemá se poznat, ale kdyby něco…)

- **Jedno geodetické jádro** (`js/geo-core.js`) — pět modulů dřív mělo vlastní kopii
  přepočtu S-JTSK. Pokud by se někde rozešly souřadnice nebo vzdálenosti, hlas se hned.
  Kryjí to geodetické testy v CI (31 testů, prochází).
- **CI kontrola integrity kódu** — hlídá syntaxi všech 125 skriptů, duplicitní klíče
  v objektech, duplicitní `id` a odkazy na neexistující soubory (i v předcache service
  workeru, kde chybějící soubor umí zablokovat aktualizaci celé appky).
  Před commitem: `python scripts/check_js.py`.
- **Náhled návrhů pozadí** zůstává na `navrhy-uvod-pozadi.html` (varianty ①③④ nebyly
  vybrány, jsou tam jen k nahlédnutí).

---

## Kde se to nejspíš zlomí (na tohle bych se koukal první)

1. **Gesto potáhnutí dolů vs. rolování** v dlouhých oknech — nejjemnější věc z celého dne.
2. **Nástroje offline po děleném načítání** — kdyby některý nástroj offline nešel otevřít,
   je to chyba předcache.
3. **Chybějící dlaždice nebo tlačítko v mapě** krátce po startu — modul, který se načítá
   později, než by měl.
4. **Dvě hlášení nahoře přes sebe** — centrum upozornění nepřevzalo některý starý prvek.
