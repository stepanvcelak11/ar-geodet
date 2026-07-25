# Návrhy k výběru (25. 7. 2026) — NIC z toho není implementováno

Dvě sady návrhů podle zadání. Vyber jmenovitě, co se má udělat — bez výběru se
nic z tohoto souboru nerealizuje.

---

## A) Přesnější měření jen mobilem (GPS) — inovace nad rámec Brutální GPS

Brutální GPS už umí: warm-up, anti-Fused filtr, filtr pohybu/rychlosti/výšky,
PDOP bránu, MAD ořez, vážený průměr, efektivní N, otočení 180°, re-okupaci,
plánování návratu dle konstelace. Na co navázat:

### A1. Vícedenní měřicí kampaň s připomínkami („3 návštěvy")
Průvodce: bod změř dnes, appka podle drah družic naplánuje 2 další návštěvy
(jiná konstelace = jiná systematika) a připomene je notifikací. Sezení se už
dnes slučují inverzně-variančním průměrem — přidá se jen plánovač + notifikace.
Reálný zisk: potlačení denní systematiky, typicky ±0,3–0,5 m → ±0,15–0,25 m.
Pracnost: malá (staví na combineSessions + whenToReturn).

### A2. Dvoutelefonní diferenční korekce („DGPS z druhého mobilu")
Telefon A leží na známém bodě a loguje odchylku GPS v čase. Telefon B měří
nové body. Po měření se log korekcí přenese (QR / .argeo soubor) a appka
zpětně opraví měření B o časově odpovídající odchylku A (společná atmosférická
a orbitalní chyba se odečte). Funguje offline, bez serveru.
Reálný zisk: odstranění korelované systematiky — na krátkou vzdálenost (do km)
typicky poloviční chyba. Pracnost: střední.

### A3. Skóre místa před měřením („multipath semafor")
Před spuštěním měření appka zkombinuje: predikci PDOP (už umí), elevační masku
z Predikce signálu, gyroskopem změřený sklon horizontu a jednoduchou detekci
fasád z kamery. Výsledek: zelená/oranžová/červená + tip „posuň se 3 m od zdi".
Reálný zisk: prevence nejhorších měření (multipath u fasád je metry!).
Pracnost: malá–střední (vše skoro existuje, jen spojit).

### A4. Krokové vektory mezi body (PDR offset)
Přesně zprůměruji bod A, pak jdu k bodu B s počítáním kroků + směru (IMU dead
reckoning). Na krátké vzdálenosti (do ~30 m) je relativní vektor z kroků
přesnější než GPS rozptyl → bod B = A + vektor. Vhodné pro rohy budov, kam
GPS nevidí (doplněk Offset bodu bez pásma).
Pracnost: střední (kalibrace délky kroku na GPS úsecích).

### A5. Otočení 4× (0°/90°/180°/270°)
Rozšíření stávající otočky 180° na 4 orientace — lépe vystředí anténní
excentricitu i lokální multipath. Triviální změna v brutal-gps.
Pracnost: velmi malá.

---

## B) „Velké změny" zaměřené na jádro appky: najít bod v terénu přes AR a mapu

### B1. Režim DOHLEDÁNÍ (samostatná obrazovka „lovu bodu") ⭐ doporučuji
Jedno klepnutí z karty bodu → celoobrazovkový režim vedení na bod, který sám
přepíná podle toho, jak telefon držím:
- telefon zvednutý = AR průhled s šipkou a vzdáleností (dnešní navigace),
- telefon naplocho = RADAR: kruh se severem, já uprostřed, bod jako tečka
  (posledních 20 m se hledá líp shora než přes kameru),
- posledních ~5 m: sílící vibrace + tikání jako detektor kovu (funguje
  s telefonem v kapse, ruce zůstávají volné na výtyčku/rýč).
Kolem cíle kruh nejistoty (GPS ± bodu i moje) — „hledej v tomhle kruhu",
ne ve falešně přesném bodě.

### B2. Off-screen šipky v AR
Body mimo záběr kamery ukazují malé šipky na okrajích obrazovky (+ počet bodů
vlevo/vpravo). Konec otáčení se dokola „kde všechny jsou". Malá pracnost,
velký efekt na hlavní scénář.

### B3. Místopis bodu offline („najdi kámen")
U úředních bodů stáhnout a cachovat místopisný PDF/obrázek ČÚZK (odkaz už
v datech je) + moje fotky z minula. Na místě: fotka stabilizace vedle AR.
Nejčastější reálný problém není dojít na bod, ale POZNAT ho v trávě.

### B4. Hlasové navádění (TTS)
„Třicet metrů, mírně vlevo… deset metrů… jsi na místě." Web Speech API,
česky, offline hlas dle systému. Ruce volné, displej zhasnutý = úspora
baterie. Přirozeně se kombinuje s B1.

### B5. Chytré pořadí obchůzky (mini-TSP)
Ve vytyčovacím checklistu tlačítko „seřadit podle trasy": appka spočítá
rozumné pořadí bodů (nearest-neighbor + 2-opt, pár set ms) a vede mě po nich.
Ušetří kilometry na velkých zakázkách.

---

**Doporučená kombinace, kdyby sis měl vybrat 2:** B1 + A3 (největší terénní
užitek na odpracovanou hodinu). B2 a A5 jsou skoro zadarmo.
