# Návrhy GPS + hledání — stav k 25. 7. 2026

Sada B (hledání bodu přes AR/mapu: režim DOHLEDÁNÍ, off-screen šipky,
místopis offline, TTS, chytrá obchůzka) byla 25. 7. 2026 ZRUŠENA na přání —
nevracet bez pokynu.

---

## A) Přesnější měření jen mobilem (GPS) — ✅ IMPLEMENTOVÁNO 25. 7. 2026

Vše na main, SW v175 (netestováno v prohlížeči):

- **A1 Kampaň „3 návštěvy"** — js/gps-campaign.js. Po prvním sezení v Brutální
  GPS karta „Naplánovat kampaň"; plánovač najde 2 okna s nejodlišnější sestavou
  družic (Jaccard) a dobrým PDOP v příštích 2 dnech (bez TLE fallback +6 h/+27 h);
  připomínka toastem + notifikací při startu appky v okně ±90 min; stav k/3
  v Brutální GPS; uložením bodu se kampaň uzavře.
- **A2 Dvoutelefonní DGPS** — js/dgps.js. Režim Základna (leží na známém bodě,
  minutové bloky dE/dN/dU, autosave do LS, export .json) + režim Korekce
  (import logu, najde body prov.origin='gps-avg' v čase logu, do 3 km od
  základny, posun = průměr bloků 6 min před uložením bodu; zápis do žurnálu,
  ochrana proti dvojí korekci).
- **A3 Skóre místa (semafor)** — js/gps-semafor.js. Dlaždice v Nástrojích →
  Měření + řádek v Brutální GPS. PDOP/družice nad uživatelovou maskou
  (skyObsMask1 z Predikce signálu) + hlášená přesnost + dotaz na okolí
  (volné/stromy/budovy) + nejlepší čas do 2 h. 🟢/🟠/🔴 s konkrétními tipy.
- **A4 Krokový offset (PDR)** — js/pdr-offset.js. B = A + Σ(krok × směr);
  detekce kroků akcelerometrem, směr currentHeading s fallbackem na vlastní
  deviceorientation, kruhový průměr směru mezi kroky, nejistota 2 % ⊕ sin 4°;
  kalibrace délky kroku na GPS úseku ≥25 m; ukládá origin 'pdr' + acc.
- **A5 Otočení 4×** — v brutal-gps.js: výzvy ve ¼, ½ a ¾ zvolené doby
  „otoč o 90° po směru hodin" (dřív jedno otočení 180° v půlce).

---

## C) Dohledávání bodů — ČEKÁ NA JMENOVITÝ VÝBĚR (nic z toho nedělat bez výběru)

### C1. Hledání podle místopisu — protínání z délek ⭐
Zadám 2–3 míry z místopisného náčrtu (od rohu plotu, sloupu, stromu…),
vztažné objekty určím klepnutím na mapě / v AR nebo krátkým GPS měřením.
Appka spočítá průsečík kružnic a povede mě do něj stávající navigací.
Řeší nejčastější reálný případ: „souřadnice nesedí nebo nejsou, ale mám
náčrt". Staví na geo-core/linalg. Pracnost: střední.

### C2. Stav bodu + hlášení závad ČÚZK
Po dohledání jedno klepnutí: nalezen / poškozen / zničen / nenalezen + foto
s časem a polohou. Z toho appka vygeneruje „Oznámení závady na bodovém poli"
(PDF/e-mail — u úředních bodů je to i zákonná povinnost). Ve firemním režimu
se stav sdílí přes existující cloud: kolega u bodu uvidí „zničen 3/2026,
nehledej". Staví na pdf-protocol + ucty/cloud. Pracnost: malá–střední.

### C3. Mapa prohledaného území („nehledej dvakrát")
Při hledání se na mapě vybarvuje pás, kudy jsem už prošel (track-log
existuje), volitelně navádění po vyhledávací spirále od nejpravděpodobnějšího
místa. Pracnost: malá.

### C4. Magnetometr jako hledačka kovů
Poslední fáze hledání: telefon těsně nad zemí, appka sleduje odchylku
magnetického pole od lokálního průměru a u anomálie (hřeb, trubka, hraniční
znak s kovem) zrychluje tikání/vibrace. Dosah ~10–20 cm — přesně na bod
schovaný pod drnem. Využije stávající práci s magnetometrem (kompas-check).
Pracnost: malá–střední.

### C5. Offline balíček úředních bodů v okolí
Při přípravě zakázky stáhnout TB/ZhB/PBPP/nivelační body v okruhu z ČÚZK
(ArcGIS REST služby bodových polí — nutno ověřit endpoint a CORS) do offline
vrstvy vč. čísel bodů. Rozšíření cuzk-geodata.js, které dnes jen odkazuje
na DATAZ ručně. Pracnost: střední.

### C6. OCR geodetických údajů
Vyfotit list geodetických údajů → appka vytáhne číslo bodu, souřadnice
i místopisné míry (ty rovnou nakrmí C1). Rozšíření stávajícího OCR.
Pracnost: střední.

### C7. Hledací karta bodu (příprava v kanceláři)
Pro každý bod zakázky jednostránkový brief k tisku/do PDF: výřez mapy,
katastr, míry z místopisu, poslední známý stav a poznámky kolegů. Staví
na pdf-protocol. Pracnost: malá.

**Doporučení ze sady C:** C1 (řeší jádro problému — bod vůbec najít) a
C2 (jednou implementované se vyplácí celé firmě). C3 je skoro zadarmo.
