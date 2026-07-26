// ===== AR Geodet — NÁSTROJE PLUS: nápověda „?" + oblíbené nahoře (ODPOJITELNÁ) ====
// Neinvazivní vrstva ve stylu js/field-tools.js: NEEDITUJE logika.js ani grafika.js.
// Co dělá v modálu „Nástroje" (#tools-modal):
//   1) Každá dlaždice dostane badge „?" — klepnutí otevře krátký návod k nástroji
//      (co dělá, jak se používá). Texty jsou v TOOL_HELP níže.
//   2) „Oblíbené": tlačítkem ⭐ Upravit oblíbené se zapne režim úprav — hvězdičkou
//      na dlaždici si uživatel vybere nástroje, které se drží ÚPLNĚ NAHOŘE mřížky
//      (vlastní pořadí dle pořadí přidání). Uloženo v localStorage (per zařízení).
// Odstranění: smaž js/tools-plus.js + řádek <script> v index.html (a v sw.js).
// ==================================================================================
(function () {
    'use strict';

    var FAV_KEY = 'agToolFavs_v1';
    var STYLE_ID = 'ag-tp-style';

    // ---- nápovědy k nástrojům -----------------------------------------------------
    // klíč = data-tool (injektované moduly) NEBO název funkce z onclick (statické dlaždice)
    //
    // PRAVIDLO: každý NOVÝ nástroj musí mít návod — bez záznamu v TOOL_HELP se
    // dlaždice tváří jako hotová, ale uživatel u ní nemá „?" a neví, co s ní. Návod
    // pište zároveň s nástrojem, ne později. Osvědčená struktura:
    //   <p>k čemu to je a proč (1–2 věty, jazykem geodeta v terénu)</p>
    //   <ol><li>krok za krokem, co uživatel udělá</li></ol>
    //   <p>omezení a na co si dát pozor (přesnost, potřeba internetu, co to neumí)</p>
    // Kontrola, jestli nějaký nástroj návod nemá: porovnej klíče TOOL_HELP s ids
    // v agRegisterFieldTool( … ) napříč js/*.js.
    var TOOL_HELP = {
        'openMeasureModal': { t: 'Měření vzdálenosti', h: '<p>Spočítá vodorovnou délku, převýšení a šikmou délku mezi dvěma místy podle GPS.</p><ol><li>Postav se na první místo a klepni <b>Uložit moji aktuální pozici</b> u bodu A.</li><li>Přejdi na druhé místo a ulož bod B.</li><li>Výsledky se dopočítají hned. Přesnost odpovídá GPS telefonu (metry) — pro krátké délky použij pásmo.</li></ol>' },
        'startAreaMode': { t: 'Měření plochy', h: '<p>Plocha a obvod polygonu v rovině S-JTSK (Gaussova formule) — pro ČR přesný výpočet.</p><ol><li>Klepni do mapy pro přidání vrcholu, nebo obejdi pozemek a přidávej <b>Můj bod</b> (použije průměrovanou GPS).</li><li>Panel dole ukazuje živě plochu, obvod a počet vrcholů.</li><li><b>Vrátit</b> odebere poslední vrchol, <b>Ukončit</b> režim zavře.</li></ol>' },
        'openCheckDist': { t: 'Oměrné / kontrola', h: '<p>Kontrolní míry mezi uloženými body — porovnání s hodnotami z dokumentace (GP, náčrt).</p><ol><li>Vyber dvojice bodů, appka spočítá délky z S-JTSK souřadnic.</li><li>Zadej oměrnou z dokumentace — uvidíš rozdíl a jestli drží mezní odchylku.</li></ol>' },
        'openDmtVolume': { t: 'Kubatury / vrstevnice', h: '<p>Digitální model terénu z tvých bodů s výškou Z: vrstevnice a výpočet kubatur (výkop/násyp) vůči srovnávací rovině.</p><ol><li>Zaměř nebo naimportuj body s výškami.</li><li>Nástroj z nich vytvoří trojúhelníkovou síť (TIN).</li><li>Zadej srovnávací výšku — dostaneš objemy a plochu.</li></ol>' },
        'openStakeoutModal': { t: 'Vytyčovací checklist', h: '<p>Seznam bodů k vytyčení: postupné odškrtávání, navigace na bod a foto-dokumentace vytyčeného bodu.</p><ol><li>Vyber body do checklistu.</li><li>Klepnutím na bod se na něj navádíš (šipka v AR).</li><li>Po vytyčení bod odškrtni; lze přiložit fotku.</li></ol>' },
        'openTachymetrie': { t: 'Náčrt / Tachymetrie', h: '<p>Polní náčrt: kreslení situace (body, čáry, popisy) přes zaměřené body — náhrada papírového náčrtu.</p><ol><li>Otevři náčrt a přidávej prvky klepáním do plátna.</li><li>Body ze zakázky se do náčrtu propisují automaticky.</li><li>Náčrt jde exportovat (obrázek/PDF).</li></ol>' },
        'openKatastr': { t: 'Katastr (zde stojím)', h: '<p>Otevře katastrální mapu na tvé aktuální pozici ve zvoleném zdroji (Mapy.cz, iKatastr, Geoprohlížeč ČÚZK — nastavíš v Nastavení → Data).</p><p>Hodí se pro rychlé zjištění parcelního čísla a hranic tam, kde stojíš.</p>' },
        'openSatModal': { t: 'GNSS satelity', h: '<p>Přehled družic (GPS, Galileo, GLONASS, BeiDou) nad obzorem: kolik jich je, kde na obloze a jaká je geometrie.</p><p>Málo družic nízko nad obzorem = horší přesnost. Použij před přesnějším měřením — počkej si na lepší konstelaci.</p>' },
        'openDronView': { t: 'Dronové zóny (DronView)', h: '<p>Otevře oficiální mapu omezení letového provozu ŘLP ČR (DronView) — bezletové zóny, CTR letišť, omezené prostory.</p><p>Před letem s dronem na zakázce zkontroluj, jestli v místě smíš létat a v jaké výšce. Vyžaduje internet.</p>' },
        'openCalcModal': { t: 'Kalkulačka', h: '<p>Geodetické výpočty: směrník a délka ze souřadnic, rajón, protínání, převody úhlů (°/gon), redukce délek do S-JTSK a další.</p><p>Souřadnice zadávej v S-JTSK (kladné Y, X). Výsledky lze rovnou uložit jako bod.</p>' },
        'openDictModal': { t: 'Slovník', h: '<p>Geodetický slovník pojmů a zkratek (TB, ZhB, Bpv, ZPMZ, GP…). Hledej v poli nahoře; vlastní pojmy si můžeš přidat dole.</p>' },
        'agOpenCalibrate': { t: 'Srovnat sever', h: '<p>Kalibrace severu AR podle známého bodu: zacílíš na bod v terénu a appka dorovná otočení kompasu tak, aby AR sedělo.</p><ol><li>Vyber v mapě/AR bod, který v terénu bezpečně vidíš.</li><li>Namiř na něj střed obrazovky a potvrď.</li><li>Korekce severu se uloží (zrušíš ji v Kompasu).</li></ol>' },
        'ar-intersection': { t: 'Protínání vpřed', h: '<p>Určení neznámého bodu záměrami ze dvou (i více) známých stanovisek — čistě z úhlů, bez měření délky.</p><ol><li>Postav se na známý bod, zacíl na hledaný bod a ulož záměru.</li><li>Totéž z druhého známého bodu.</li><li>Appka protne směry (více záměr vyrovná MNČ) a bod uloží.</li></ol>' },
        'ar-resection': { t: 'AR resekce', h: '<p>Určení vlastní polohy a severu ze záměr na známé body (obdoba volného stanoviska) — pomáhá tam, kde GPS nestačí.</p><ol><li>Zacíl postupně na 2–3 známé body v terénu.</li><li>Appka dopočítá, kde stojíš, a srovná sever AR.</li></ol>' },
        'brutal-gps': { t: 'Brutální GPS', h: '<p>Vysoce přesné měření bodu jen s telefonem: dlouhé průměrování GPS s filtry (pohyb, Wi-Fi poloha, geometrie družic) a robustním odhadem.</p><ol><li>Zkontroluj řádek <b>Skóre místa</b> nahoře — červená = najdi lepší místo nebo čas.</li><li>Polož telefon na bod, zvol plánovanou dobu a spusť. Ve <b>¼, ½ a ¾ času</b> appka vyzve otočit telefon o 90° po směru hodin (vystředí vliv antény a odrazů).</li><li>Výsledek ulož jako bod — u něj zůstane dosažená přesnost. Nebo ho přidej jako <b>sezení</b> a vrať se později (tlačítko „Kdy se vrátit?" poradí čas) — spojený výsledek z více sezení je přesnější.</li></ol><p>Pro maximum přesnosti naplánuj kartou dole <b>kampaň „3 návštěvy"</b>: měření ve třech různých konstelacích družic vyruší velkou část systematické chyby.</p>' },
        'gps-semafor': { t: 'Skóre místa (GPS)', h: '<p>Semafor 🟢/🟠/🔴 <b>před</b> měřením: spojí geometrii družic (PDOP), tvoji elevační masku z Predikce signálu, přesnost hlášenou telefonem a okolí.</p><ol><li>Vyber, co máš kolem sebe: <b>volné nebe</b> / <b>stromy či jedna zeď</b> / <b>mezi budovami</b>.</li><li>Přečti verdikt a tipy — např. „posuň se od zdi" nebo za kolik minut bude lepší konstelace (hledá do 2 h dopředu).</li></ol><p>Odrazy od fasád a aut (multipath) dělají chyby v metrech, které průměrování NEodstraní — prevence je účinnější než dlouhé měření. Skóre vidíš i přímo v Brutální GPS.</p>' },
        'dgps': { t: 'Dvoutelefonní DGPS', h: '<p>Korekce z druhého mobilu: atmosférická chyba GPS je do ~2 km pro oba telefony stejná. Základna na známém bodě ji průběžně měří a body roveru se o ni zpětně opraví — typicky na polovinu až třetinu chyby. Funguje offline.</p><ol><li><b>Základna:</b> druhý telefon polož na bod se spolehlivě známými souřadnicemi (import S-JTSK, ne bod měřený mobilem), spusť a nech ležet po CELOU dobu měření.</li><li><b>Rover:</b> tímto telefonem normálně měř body (Brutální GPS / průměrovaná GPS).</li><li>Na základně klepni <b>Zastavit a ukázat korekce jako QR</b>.</li><li>Zde otevři režim <b>Korekce</b>, klepni <b>Naskenovat QR ze základny</b> a namiř kameru na displej druhého telefonu (nebo použij přenos souborem). Zkontroluj nabídnuté posuny a potvrď.</li></ol><p>Opraví se jen body měřené v době běhu základny a do 3 km od ní; posun se zapíše do žurnálu bodu a aplikuje se nejvýš jednou.</p>' },
        'pdr-offset': { t: 'Krokový offset', h: '<p>Nový bod „došlápnutím": od známého bodu A dojdeš na místo B a appka spočítá B = A + vektor z kroků (akcelerometr) a směru (kompas). Na 10–30 m bývá přesnější než dvě samostatná GPS měření — ideální na rohy budov a místa bez výhledu na oblohu.</p><ol><li>Jednou za čas udělej <b>kalibraci kroku</b>: rovný úsek ≥ 25 m pod volným nebem s dobrým fixem.</li><li>Stoupni si na bod A, vyber ho v seznamu a spusť chůzi.</li><li>Drž telefon volně před sebou displejem nahoru a normálně dojdi na B; zastav a bod pojmenuj + ulož.</li></ol><p>U budov ruší kompas kov — k bodu se proto ukládá poctivý odhad nejistoty (~2 % délky ⊕ chyba směru). Na delší vzdálenosti použij Offset bod s pásmem.</p>' },
        'cadastre-vector': { t: 'Katastr — parcely', h: '<p>Vektorové hranice parcel z ČÚZK přímo v mapě a AR: čáry hranic, parcelní čísla, klepnutím detail parcely.</p><p>Vyžaduje internet při prvním načtení oblasti; načtené hranice drží v zakázce.</p>' },
        'geo-overlay': { t: 'Vlastní podklad', h: '<p>Podložení mapy vlastním obrázkem (situace, GP, starý plán): obrázek nakalibruješ na dva body a zobrazí se v mapě i AR.</p>' },
        'offset-point': { t: 'Offset bod', h: '<p>Vytvoření bodu odsazením od jiného bodu: zadáš směr (azimut/směrník) a vzdálenost — třeba roh budovy, na který není vidět z GPS.</p>' },
        'orient-point': { t: 'Srovnat podle bodu', h: '<p>Rychlé dorovnání severu AR: vybereš bod, namíříš na něj telefon a appka srovná kompas. Jednodušší varianta „Srovnat sever".</p>' },
        'parcela': { t: 'Parcela / dělení', h: '<p>Geometrie parcely v S-JTSK: výměra, obvod, směrníky stran — a dělení parcely (rovnoběžkou, z vrcholu, na N dílů stejné výměry).</p>' },
        'project-import': { t: 'Import projektu (DXF)', h: '<p>Načtení výkresu DXF nebo seznamu souřadnic do zakázky: body a čáry z projektu uvidíš v mapě i AR a můžeš je vytyčovat.</p>' },
        'stakeout-line': { t: 'Vytyčení přímky', h: '<p>Navádění na přímku mezi dvěma body: appka ukazuje kolmou odchylku od přímky a staničení — třeba pro lavičky, ploty, výkopy.</p>' },
        'track-log': { t: 'Stopa trasy', h: '<p>Záznam prošlé trasy (GPS stopa) do mapy: obchůzka hranice, zaměření cesty. Stopu jde uložit a exportovat (GPX/KML).</p><ol><li>Klepni <b>Spustit nahrávání</b> — stopa se kreslí oranžově do mapy, bod se bere po posunu ≥ 1,5 m (šetří GPS šum i baterii).</li><li>Zaškrtnutím <b>Zobrazit stopu i v AR</b> uvidíš čáru položenou po zemi i v kameře — praktické, když se vracíš po vlastní stopě.</li><li><b>Export GPX</b> uloží trasu pro Kokeš, QGIS nebo mapy.</li></ol>' },
        'vyska-objektu': { t: 'Výška objektu', h: '<p>Trigonometrické určení výšky stožáru, komína, stromu… jen telefonem: zaměříš svislý úhel na patu a na vrchol objektu, výška se dopočítá.</p><ol><li>Zadej výšku telefonu nad zemí (odkud míříš — cca výška očí).</li><li>Vzdálenost k objektu se spočte ze záměru na patu (předpokládá rovnou zem) — nebo ji změř pásmem/krokováním a zadej ručně, bude to přesnější.</li><li>Zamiř kříž na <b>patu</b> objektu a klepni „Zaměřit patu", pak na <b>vrchol</b> a „Zaměřit vrchol".</li></ol><p>Výsledek ukazuje i poctivý odhad ± (typicky decimetry až ~1 m). Zpřesníš ho tím, že jdeš blíž, držíš telefon klidně, nebo zadáš vzdálenost ručně.</p>' },
        'epochy': { t: 'Epochy / monitoring', h: '<p>Sledování, jestli se bod v čase <b>hýbe</b> (monitoring posunů): římsa mostu, opěrná zeď, sesuv, skládka… Stejný bod opakovaně zaměříš <b>totálkou nebo GNSS roverem</b> a výsledné souřadnice sem po každém měření zapíšeš jako novou „epochu".</p><ol><li>Založ sledovaný bod — nový, nebo vyber existující z vlastních bodů.</li><li>Po každém měření přidej epochu: souřadnice Y/X/Z zapiš ručně, vyfoť displej či protokol (přečte je OCR), nebo je převezmi z bodu v appce.</li><li>První epocha je <b>referenční</b> — polohový posun ΔP a výškový ΔZ všech dalších epoch se počítají proti ní.</li></ol><p>Volitelně nastav mezní odchylky v mm — při překročení se bod označí červeně. Vývoj posunů ukazuje graf, vše jde exportovat do CSV. GPS mobilu je jen nouzová možnost (přesnost ±metry, pro skutečný monitoring nestačí).</p><p>V detailu sledovaného bodu jde nastavit <b>připomínku přeměření</b> (každých 7/14/30 dní nebo vlastní interval). Appka po startu upozorní lištou na body po termínu (počítá se od poslední epochy) a na dlaždici nástroje svítí červená tečka s počtem; volitelně jdou zapnout i systémové notifikace.</p>' },
        'postupy': { t: 'Postupy měření', h: '<p>Tahák krok za krokem pro běžné metody: rajón, volné stanovisko, tachymetrie, polygonový pořad, technická nivelace, GNSS-RTK…</p><p>Vychází z oficiálních předpisů (Návod pro obnovu katastrálního operátu, katastrální vyhláška). U limitů je vždy uveden zdroj.</p>' },
        'zapisnik': { t: 'Zápisníky', h: '<p>Digitální zápisník místo papíru: <b>technická nivelace</b> (čtení zpět/vpřed → převýšení, výšky, uzávěr) a <b>vodorovné směry</b> — pro každý cíl skupiny s Hz v I./II. poloze (redukce + průměry), zenitové úhly v obou polohách (zprůměruje se) a šikmá či vodorovná délka (šikmá se zenitem se přepočte na vodorovnou a převýšení).</p><p>Výpočty běží průběžně (lze vypnout v hlavičce zápisníku). Data se ukládají per zakázka a jdou exportovat.</p>' },
        // nástroje přesunuté z menu „Více" do sekce Nástroje
        'predpisy': { t: 'Předpisy & odchylky', h: '<p>Offline tahák z katastrálních předpisů: mezní odchylky, kódy kvality, lhůty a paragrafy. Kurátorovaný obsah s uvedeným zdrojem, hledej fulltextem.</p>' },
        'ref-calibration': { t: 'Kalibrace na ref. bod', h: '<p>Oprava GPS podle známého bodu: postav se na bod se známými souřadnicemi a appka spočítá posun, který pak průběžně aplikuje na tvoji polohu.</p><p>Pomáhá, když GPS systematicky „táhne" stranou. Posun zrušíš opětovnou kalibrací.</p>' },
        'sky-obstruction': { t: 'Predikce signálu', h: '<p>Skyplot pro aktuální polohu a čas: posuvníkem nastavíš elevační masku (kolik oblohy zaclání domy, stromy, svah) a appka ukáže, kolik družic zbude nad maskou a jak dobrá bude geometrie (PDOP).</p><p>Hodí se pro plánování měření v zástavbě nebo u lesa.</p>' },
        'cadastre-area': { t: 'Stáhnout body z výřezu mapy', h: '<p>Hromadný import bodů bodových polí z ČÚZK: tahem po mapě vybereš obdélník a body v něm se nabídnou k přidání do zakázky.</p><p>Vyžaduje internet; stažené body pak fungují offline.</p>' },
        'hidden-points': { t: 'Skryté body', h: '<p>Přehled bodů skrytých tlačítkem „Skrýt tento bod z AR". Klepnutím na <b>Zobrazit</b> vrátíš jednotlivý bod, nebo obnovíš všechny najednou.</p><p>Skrytí platí do restartu appky — po novém spuštění jsou body zase viditelné.</p>' },
        'vrstvy': { t: 'Vrstvy / pokládka', h: '<p>Skladby vozovky per stavba/úsek: vrstvy shora dolů s tloušťkou a % nadvýšení na hutnění. Vrstvy přidáš <b>z katalogu</b> (ACO, ACL, ACP, SMA, MZK, ŠD…) nebo vlastní; zkratky vysvětluje slovníček dole.</p><ol><li>Vyber, které vrstvě odpovídá <b>model v kontroleru</b> (horní plocha).</li><li>Vyber, kterou vrstvu <b>pokládáš</b>.</li><li>Nahoře svítí hodnota <b>Do tabletu</b> = odsazení mezi vrstvami + nadvýšení na hutnění.</li></ol><p>V <b>řezu</b> tažením čáry mezi vrstvami měníš tloušťku; sklon (jednostranný i střechovitý) je jen náhled, převýšený. Výchozí % hutnění jsou orientační — uprav dle zhutňovací zkoušky.</p>' },
        // doplněné návody (dřív chyběly — badge „?" ukazoval jen obecný text)
        'ar-calib2': { t: 'Srovnat AR na 2 body', h: '<p>Přesnější kalibrace AR podle <b>dvou</b> známých bodů: appka srovná natočení (sever) i posun tak, aby oba body v AR seděly na skutečnost.</p><ol><li>Vyber první bod, který v terénu bezpečně vidíš, zamiř na něj střed obrazovky a potvrď.</li><li>Totéž s druhým bodem — ideálně v jiném směru (ne v zákrytu).</li><li>Korekce se uloží; zrušíš ji novou kalibrací nebo v Kompasu.</li></ol><p>Oproti „Srovnat sever" (1 bod) řeší i posun polohy — hodí se, když GPS „táhne" stranou.</p>' },
        'ar-visual-track': { t: 'Vizuální stabilizace AR (beta)', h: '<p>Ukotví AR obraz pomocí kamery (optický tok): značky se méně třesou a neplavou při pohybu telefonu.</p><p>Zapíná se zde nebo v Nastavení → AR &amp; přesnost. Stojí něco baterie navíc — vypni, když ji potřebuješ šetřit. Beta: kdyby AR „ujíždělo", vypni a nahlas kdy se to stalo.</p>' },
        'free-station': { t: 'Volné stanovisko (průvodce)', h: '<p>Průvodce určením vlastního stanoviska ze záměr na známé body — když nestojíš na žádném známém bodě a GPS nestačí.</p><ol><li>Vyber 2–3 známé body, které z místa vidíš.</li><li>Průvodce tě provede záměrami (deleguje na AR resekci).</li><li>Výsledkem je tvá poloha + srovnaný sever AR.</li></ol>' },
        'localization-helmert': { t: 'Lokalizace (Helmert)', h: '<p>Usazení měření na známé body Helmertovou transformací: z dvojic <b>identických bodů</b> (moje měření ↔ dané souřadnice) spočítá posun, natočení a měřítko a aplikuje je na zakázku.</p><ol><li>Přiřaď aspoň 2 identické body (víc = kontrola, vyrovnání MNČ).</li><li>Zkontroluj odchylky na jednotlivých bodech (rezidua).</li><li>Potvrď — transformace se aplikuje; jde vrátit.</li></ol>' },
        'rajon': { t: 'Rajón (směr + délka)', h: '<p>Klasická polární metoda: nový bod ze <b>stanoviska</b> (známý bod) pomocí směru a vodorovné délky.</p><ol><li>Vyber stanovisko a orientaci (další známý bod), nebo použij kompas.</li><li>Zadej směr/směrník a délku (pásmo, dálkoměr).</li><li>Bod se spočítá a uloží do zakázky i s poznámkou o původu.</li></ol>' },
        'utility-networks': { t: 'Podzemní sítě', h: '<p>„Rentgen do země": vedení inženýrských sítí (voda, plyn, elektro, kanalizace…) zobrazené v mapě a v AR pod nohama, s barvami dle druhu sítě.</p><ol><li>Naimportuj data od správce sítě (DXF/GML z vyjádření).</li><li>V AR uvidíš trasy vedení promítnuté na terén, s hloubkou, pokud je v datech.</li></ol><p>Pozor: poloha sítí v podkladech bývá orientační — před výkopem vždy platí vytyčení správcem.</p>' },
        'zavady': { t: 'Závady / hlášení', h: '<p>Zápis nálezu v terénu na pár ťuknutí: foto → kategorie → závažnost → poznámka. Poloha, čas a přesnost GPS se doplní samy. Závadu můžeš <b>vázat na konkrétní měřený bod</b> („jaký bod a co je s ním špatně") — poloha se pak převezme z bodu a jeho jméno je v seznamu, CSV i protokolu.</p><ol><li>Otevři nástroj (nebo <b>podrž tlačítko „Nový bod"</b> v doku) a vyplň formulář.</li><li>Závady svítí jako barevné vykřičníky v mapě i AR — podle závažnosti.</li><li>V seznamu je odškrtávej jako <b>Vyřešeno</b>; nic se neztratí.</li></ol><p>Export: CSV se S-JTSK souřadnicemi a tiskový protokol s fotkami (uložíš jako PDF).</p>' },
        'usadit-ar': { t: 'Usadit AR (průvodce)', h: '<p>Jeden vstup místo sedmi kalibračních nástrojů: průvodce se zeptá, co tě trápí (pootočené značky / posun / nevím kde stojím / usadit zakázku) a sám spustí správný nástroj.</p><p>Skryté kalibrační dlaždice najdeš dál přes vyhledávání; vrátit je můžeš v Nastavení → Vzhled → „Zjednodušené Nástroje".</p>' },
        // rozcestníky z js/tools-hub.js (declutter 2. kolo — stejný přepínač jako Usadit AR)
        'bod-vypoctem': { t: 'Bod výpočtem', h: '<p>Rozcestník pro vytvoření nového bodu z existujících bodů — podle toho, co umíš změřit:</p><ol><li><b>Rajón</b>: stojíš na známém bodě a máš směr + vodorovnou délku.</li><li><b>Offset bod</b>: odsazení od bodu o azimut/směrník a vzdálenost.</li><li><b>Protínání vpřed</b>: délku změřit nemůžeš — bod protneš záměrami ze dvou známých stanovisek.</li></ol><p>Jednotlivé metody najdeš i vyhledáváním („rajón", „offset", „protínání").</p>' },
        'gnss-signal': { t: 'Signál GNSS', h: '<p>Rozcestník kvality GPS: <b>Družice teď</b> (kolik jich je nad obzorem a jaká je geometrie), <b>Predikce signálu</b> (skyplot s maskou překážek — plánování měření u lesa či v zástavbě) a <b>Semafor místa</b> (skóre odrazů a stability na aktuálním místě).</p><p>Použij před přesnějším měřením — počkej si na lepší konstelaci nebo si stoupni jinam.</p>' },
        'prirucka': { t: 'Příručka', h: '<p>Offline tahák do terénu: <b>Předpisy &amp; odchylky</b> (mezní odchylky, kódy kvality, lhůty — s uvedeným zdrojem), <b>Postupy měření</b> (krok za krokem: rajón, volné stanovisko, nivelace, GNSS-RTK…) a <b>Slovník</b> (pojmy a zkratky).</p>' },
        'job-transfer': { t: 'Poslat/načíst zakázku', h: '<p>Přenos celé zakázky mezi zařízeními souborem <b>.argeo</b> (body, nastavení, náčrty): pošli si ji mailem, messengerem nebo přes sdílení.</p><ol><li><b>Poslat:</b> vyber zakázku → vytvoří se soubor .argeo ke sdílení.</li><li><b>Načíst:</b> otevři přijatý soubor / vyber ho zde — zakázka se přidá vedle stávajících (nic nepřepíše bez potvrzení).</li></ol>' },
        'fov-kalib': { t: 'Zorný úhel kamery (FOV)', h: '<p>Změří skutečný zorný úhel kamery tvého telefonu. AR podle něj počítá, kam na obrazovku značku nakreslit — když je zadaný špatně, body <b>uprostřed</b> obrazu sedí, ale ke <b>krajům</b> se rozjíždějí. Každý model telefonu má jiný, hádat ho posuvníkem je loterie.</p><ol><li>Běž ven, zkalibruj kompas (osmička telefonem) a vyber si <b>vzdálený</b> osamocený objekt — stožár, komín, roh domu. Musí být dál než ~50 m, jinak se do měření promítne i to, jak se přitom pohneš.</li><li>Otoč telefon tak, aby objekt ležel přesně u <b>levé</b> hrany obrazu, a klepni Zaznamenat. Pak tak, aby byl u <b>pravé</b> hrany, a zaznamenej znovu — rozdíl azimutů je vodorovný zorný úhel.</li><li>Zopakuje se to 3× a bere se prostřední hodnota; kompas kolísá, takže jedno měření nestačí. Rozptyl nad 6° znamená „změř to znovu".</li><li>Svislý úhel buď změříš stejně (vysoký objekt u horní a dolní hrany, sleduje se sklon telefonu), nebo si ho nech dopočítat z poměru stran obrazu.</li><li>Nakonec <b>Uložit do nastavení</b>.</li></ol><p>Když kompas zlobí, je uvnitř popsaná i metoda přes zeď: ve známé vzdálenosti D změříš šířku W mezi kraji obrazu a platí FOV = 2·arctg(W/2D). Kontrola po uložení: bod, který v terénu vidíš, musí v AR sedět i u kraje obrazovky, ne jen uprostřed.</p>' },
        'pocasi': { t: 'Počasí', h: '<p>Předpověď pro místo měření složená až z <b>18 zdrojů</b> — 16 předpovědních modelů (ECMWF vč. AI modelů AIFS/GraphCast, DWD ICON, KNMI a DMI HARMONIE, Météo-France, UK Met Office, NOAA, JMA, CMA, BOM, CMC), MET Norway a DWD MOSMIX. Všechny hodnoty se váženě průměrují — dlaždice <b>Shoda zdrojů</b> ukazuje, jak moc se modely rozcházejí; velký rozptyl = nejistá předpověď. Appka navíc ví, jak se které modely trefovaly za poslední měsíc (historii si dohledá z archivu hned, není potřeba čekat), a trefnějším dává vyšší váhu — detail najdeš v rozbalovacím řádku „Z čeho předpověď vychází" úplně dole.</p><p><b>Srážkový radar</b> ukazuje animovaně, jak se srážkové mraky pohybují (~70 min zpět + 30 min výhled). Mapou radaru jde posouvat i přibližovat (tlačítka +/− a ⌖ zpět na tvoje místo), posuvníkem si přehraješ jednotlivé snímky ručně. Tlak je přepočtený na nadmořskou výšku místa (v závorce i na moře) a u deště je vedle pravděpodobnosti i množství v mm.</p><ol><li>Bez zadání ukazuje počasí ve tvé poloze.</li><li>Ikonou <b>špendlíku</b> vybereš místo klepnutím do mapy — mapa zůstane ovladatelná, takže si ji nejdřív posuň a přibliž na zakázku, kam teprve pojedeš, a pak klepni.</li><li>Do pole nahoře můžeš místo taky vyhledat podle názvu.</li></ol><p>Upozornění hlídají, co vadí v terénu: bouřka a déšť do 3 h, vítr nad 8 m/s (stativ, výtyčka), mráz a vedro. Poslední stažená předpověď se pamatuje i offline.</p>' },
        'firma-chat': { t: 'Firemní chat', h: '<p>Zprávy mezi lidmi ve firmě přes firemní cloud — domluva z terénu bez hledání telefonního čísla.</p><ol><li>Napiš zprávu; ostatní ji uvidí do pár sekund.</li><li>Tlačítkem <b>Poslat body</b> pošleš vybrané body ze zakázky, příjemce je přidá jedním klepnutím.</li><li>Nepřečtené hlásí odznak na dlaždici.</li></ol><p>Vyžaduje přihlášení do firmy a internet.</p>' },
        'dochazka': { t: 'Docházka', h: '<p>Příchod a odchod na zakázce s razítkem času a GPS polohy — podklad pro výkaz odpracovaných hodin.</p><ol><li>Na místě klepni <b>Příchod</b> — doplníš stavbu a s kým tam jsi (nepovinné, příště se předvyplní).</li><li>Na konci klepni <b>Odchod</b> a napiš, co se dělalo.</li><li>Když odchod zapomeneš, doplníš ho při dalším startu (nebo ho opraví admin).</li><li>Administrace firmy páruje směny a počítá hodiny; stavba, parta i činnost jsou v rozpisu, CSV i tisku.</li></ol><p>Funguje i offline — záznamy se odešlou, až bude signál.</p>' },
        'ucty-firma': { t: 'Firma a účty', h: '<p>Správa firmy: uživatelé, role a oprávnění, přehled užívání a docházky, zálohy.</p><ol><li><b>Uživatelé:</b> zakládání účtů, PIN, role (admin / geodet / pomocník) a co kdo smí.</li><li><b>Přehled:</b> kolik bodů kdo naměřil, na jakých zakázkách a kdy.</li><li><b>Zařízení:</b> připojení dalšího telefonu QR kódem od admina.</li></ol><p>Bez cloudu funguje lokálně na jednom zařízení; s cloudem se účty sdílejí mezi telefony.</p>' },
        'denik-dne': { t: 'Deník dne', h: '<p>Večerní souhrn dne za aktivní zakázku na jeden tap — podklad pro kancelář nebo stavební deník: nové/změněné/smazané body, docházka party, závady včetně stavu, počasí, ušlá stopa a založené zápisníky.</p><ol><li>Otevři dlaždici — souhrn za <b>dnešek</b> se sestaví sám; nahoře přepneš na včerejšek nebo libovolné datum.</li><li><b>Sdílet</b> pošle čistý textový report (mail, WhatsApp…); kde sdílení není, zkopíruje se do schránky.</li><li><b>Uložit PDF</b> otevře tiskový protokol — ulož přes systémový tisk (povol vyskakovací okna).</li></ol><p>Čte jen data z tohoto zařízení: docházka píchnutá na jiném telefonu tu není a staré body bez časového razítka nejde zařadit ke dni. Funguje offline (počasí ukáže poslední stažená data ze zvoleného dne).</p>' },
        'brifink': { t: 'Dnešek v terénu', h: '<p>Ranní brífink na jedné kartě: co tě dnes v terénu čeká, bez klikání po čtyřech nástrojích. Otevře se sám při <b>prvním spuštění dne</b> (vypneš přepínačem dole v kartě) nebo kdykoli touto dlaždicí.</p><ol><li><b>Počasí dnes:</b> teploty, kdy má pršet, vítr, východ–západ slunce a kolik zbývá světla (offline ukáže poslední stažené).</li><li><b>GNSS dnes:</b> z uložených drah družic spočte nejlepší a nejhorší okno dne (PDOP) + Kp index — při geomagnetické bouři GNSS zlobí.</li><li><b>Monitoring a zpravodaj:</b> body po termínu přeměření a titulek dnešního vydání.</li></ol><p>Okna GNSS potřebují stažené dráhy (nástroj GNSS satelity) a polohu; počasí a Kp potřebují při prvním stažení internet.</p>' },
        'hlasovky': { t: 'Hlasové poznámky', h: '<p>Nadiktované poznámky, které se rovnou <b>přepíšou na text</b> — v rukavicích a blátě se nepíše a samotný zvuk by se v kanceláři musel přehrávat. Každá poznámka dostane <b>georazítko</b>: čas, polohu (S-JTSK), přesnost GPS a nejbližší vlastní bod do 25 m („u bodu 105, 3 m").</p><ol><li>Klepni <b>Nahrát poznámku</b> a mluv — text naskakuje živě pod tlačítkem. Dalším klepnutím zastavíš (strop 5 minut).</li><li>Přepis si v seznamu <b>zkontroluj a oprav</b> — rozpoznávání komolí hlavně jména a žargon (S-JTSK, Bpv, ZPMZ appka opraví sama). Zvuk zůstává uložený jako důkaz.</li><li>Chybí-li přepis, klepni <b>Diktovat</b> a nadiktuj text dodatečně, nebo ho napiš.</li><li>Když je poznámek víc, hledej v nich políčkem nahoře. Večer je posbírá <b>Deník dne</b> i s textem.</li></ol><p><b>Přepis potřebuje signál</b> (prohlížeč posílá zvuk na server výrobce) — offline se uloží jen zvuk a text dopíšeš později. Přepis jde vypnout přepínačem v hlavičce; na iOS to zkus, kdyby mikrofon škubal obrazem kamery v AR. Data zůstávají jen v telefonu (necloudují se, nejdou v exportu zakázky).</p>' }
    };

    // ---- styly ---------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#tools-modal .tool-tile{position:relative;}',
            // badge je <i> (NE <span>!) — field-tools má pravidlo `#tools-modal .ag-ft-tile span{display:block}`,
            // které by span-badge u terénních nástrojů natvrdo zviditelnilo/roztáhlo
            'i.ag-tp-help{position:absolute;top:4px;right:4px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;',
            '  border-radius:50%;background:rgba(255,255,255,0.08);border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  color:var(--text-muted,#9aa1ac);font:700 12px/1 var(--font-ui,system-ui);font-style:normal;cursor:pointer;z-index:2;}',
            'i.ag-tp-help:active{background:var(--accent-soft,rgba(47,158,116,0.18));color:var(--accent,#2f9e74);}',
            '#tools-modal .tool-tile i.ag-tp-star{position:absolute;top:4px;left:4px;width:24px;height:24px;display:none !important;align-items:center;justify-content:center;',
            '  border-radius:50%;background:rgba(0,0,0,0.35);border:1px solid rgba(251,191,36,0.6);color:#fbbf24;font-size:14px;font-style:normal;cursor:pointer;z-index:2;}',
            'body.ag-tp-edit #tools-modal .tool-tile i.ag-tp-star{display:flex !important;}',
            'body.ag-tp-edit #tools-modal .tool-tile{outline:1px dashed var(--glass-border,rgba(255,255,255,0.2));}',
            '#tools-modal .tool-tile i.ag-tp-star.on{background:#fbbf24;color:#1a1205;}',
            '#ag-tp-editbtn{margin:2px 0 10px;width:100%;padding:9px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:transparent;color:var(--text-muted,#9aa1ac);font-size:12.5px;font-weight:600;cursor:pointer;}',
            'body.ag-tp-edit #ag-tp-editbtn{background:var(--accent-soft,rgba(47,158,116,0.15));color:var(--accent,#2f9e74);border-color:var(--accent-line,rgba(47,158,116,0.4));}',
            '#ag-fav-head{color:#fbbf24 !important;}',
            // modál nápovědy
            '#ag-tp-hm{position:fixed;inset:0;z-index:1000060;display:none;align-items:center;justify-content:center;background:rgba(4,8,12,0.6);}',
            '#ag-tp-hm.open{display:flex;}',
            '#ag-tp-hm .ag-tp-card{width:min(92vw,420px);max-height:calc(var(--app-vh, 100dvh) * 0.8);overflow:auto;padding:20px;border-radius:18px;',
            '  background:var(--glass-bg,rgba(14,18,24,0.97));border:1px solid var(--glass-border-strong,rgba(255,255,255,0.16));color:var(--text-color,#eceef2);}',
            '#ag-tp-hm h3{margin:0 0 10px;color:var(--accent,#2f9e74);font-size:17px;}',
            '#ag-tp-hm p,#ag-tp-hm li{font-size:13.5px;line-height:1.55;}',
            '#ag-tp-hm ol{padding-left:20px;margin:8px 0;}',
            '#ag-tp-hm .ag-tp-close{width:100%;margin-top:12px;padding:11px;border:none;border-radius:12px;background:rgba(255,255,255,0.1);color:inherit;font-weight:600;cursor:pointer;}',
            'body.outdoor-mode #ag-tp-hm .ag-tp-card{background:#0a0e1a;border-color:rgba(255,255,255,0.85);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- pomocné --------------------------------------------------------------------
    function getGrid() { var m = document.getElementById('tools-modal'); return m ? m.querySelector('.tool-grid') : null; }
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool');
        if (dt) return dt;
        var oc = tile.getAttribute('onclick') || '';
        var m = oc.match(/(?:^|[;\s])(?:window\.)?(?:if\(window\.)?(ag[A-Za-z]+|open[A-Za-z]+|start[A-Za-z]+)\s*\(/);
        // preferuj známé klíče (první funkce v onclicku je zavření modálu)
        var known = Object.keys(TOOL_HELP);
        for (var i = 0; i < known.length; i++) { if (oc.indexOf(known[i]) !== -1) return known[i]; }
        return m ? m[1] : null;
    }
    function tileLabel(tile) { var s = tile.querySelector('span'); return s ? s.textContent.replace(/\s+/g, ' ').trim() : (tile.textContent || '').trim(); }
    function loadFavs() { try { var a = JSON.parse(localStorage.getItem(FAV_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function saveFavs(a) { try { localStorage.setItem(FAV_KEY, JSON.stringify(a)); } catch (e) {} }
    function findTile(key) {
        var grid = getGrid(); if (!grid) return null;
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) { if (tileKey(tiles[i]) === key) return tiles[i]; }
        return null;
    }

    // ---- modál nápovědy ---------------------------------------------------------------
    function ensureHelpModal() {
        var m = document.getElementById('ag-tp-hm');
        if (!m) {
            m = document.createElement('div'); m.id = 'ag-tp-hm';
            m.innerHTML = '<div class="ag-tp-card"><h3 id="ag-tp-hm-t"></h3><div id="ag-tp-hm-b"></div><button type="button" class="ag-tp-close">Zavřít</button></div>';
            m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('open'); });
            m.querySelector('.ag-tp-close').addEventListener('click', function () { m.classList.remove('open'); });
            document.body.appendChild(m);
        }
        return m;
    }
    function openHelp(key, label) {
        var m = ensureHelpModal();
        var rec = TOOL_HELP[key];
        document.getElementById('ag-tp-hm-t').textContent = rec ? rec.t : (label || 'Nástroj');
        document.getElementById('ag-tp-hm-b').innerHTML = rec ? rec.h : '<p>Návod pro tento nástroj zatím není. Nástroj otevři a zkus ho — nic se neuloží bez potvrzení.</p>';
        m.classList.add('open');
    }

    // ---- badge „?" a hvězdička na dlaždicích -----------------------------------------
    function decorateTiles() {
        var grid = getGrid(); if (!grid) return;
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) {
            (function (tile) {
                if (!tile.querySelector('.ag-tp-help')) {
                    var b = document.createElement('i');   // <i>, ne <span> — viz komentář u stylů
                    b.className = 'ag-tp-help'; b.textContent = '?';
                    b.setAttribute('role', 'button'); b.setAttribute('aria-label', 'Návod k nástroji');
                    b.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); openHelp(tileKey(tile), tileLabel(tile)); });
                    tile.appendChild(b);
                }
                if (!tile.querySelector('.ag-tp-star')) {
                    var s = document.createElement('i');
                    s.className = 'ag-tp-star'; s.textContent = '★';
                    s.setAttribute('role', 'button'); s.setAttribute('aria-label', 'Oblíbený nástroj');
                    s.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); toggleFav(tile); });
                    tile.appendChild(s);
                }
                var key = tileKey(tile);
                var star = tile.querySelector('.ag-tp-star');
                if (star) star.classList.toggle('on', key != null && loadFavs().indexOf(key) !== -1);
            })(tiles[i]);
        }
    }

    // v režimu úprav klepnutí na dlaždici NÁSTROJ NEOTEVÍRÁ (jen hvězdička/`?`)
    document.addEventListener('click', function (e) {
        if (!document.body.classList.contains('ag-tp-edit')) return;
        var tile = e.target.closest ? e.target.closest('#tools-modal .tool-tile') : null;
        if (!tile) return;
        if (e.target.closest('.ag-tp-star') || e.target.closest('.ag-tp-help')) return;
        e.stopPropagation(); e.preventDefault();
        toggleFav(tile);   // v režimu úprav = klepnutí kamkoli na dlaždici přepne oblíbenost
    }, true);

    // ---- oblíbené ---------------------------------------------------------------------
    function toggleFav(tile) {
        var key = tileKey(tile);
        if (!key) return;
        var favs = loadFavs();
        var idx = favs.indexOf(key);
        if (idx === -1) favs.push(key); else favs.splice(idx, 1);
        saveFavs(favs);
        if (idx !== -1) restoreTile(tile);   // odebráno z oblíbených -> vrátit na původní místo
        applyFavs(); decorateTiles();
    }
    function restoreTile(tile) {
        if (tile.classList.contains('ag-ft-tile')) {
            // injektovaná dlaždice: smazat a nechat field-tools HNED vložit na správné místo
            tile.remove();
            try { if (typeof window.agFtSyncTiles === 'function') window.agFtSyncTiles(); } catch (e) {}
            return;
        }
        var ph = tile._agTpPh;
        if (ph && ph.isConnected) { ph.parentNode.insertBefore(tile, ph); ph.remove(); tile._agTpPh = null; }
    }
    function applyFavs() {
        var grid = getGrid(); if (!grid) return;
        var favs = loadFavs();
        var head = document.getElementById('ag-fav-head');
        // dohledej dlaždice; hlavičku Oblíbené drž jen když nějaká oblíbená existuje
        var found = [];
        favs.forEach(function (k) { var t = findTile(k); if (t) found.push(t); });
        if (!found.length) { if (head) head.remove(); return; }
        if (!head) {
            head = document.createElement('div');
            head.id = 'ag-fav-head'; head.className = 'tool-cat';
            head.textContent = '★ Oblíbené';
        }
        // Úplný začátek mřížky má pronajatý blok „⚡ Teď se hodí" (usadit-ar.js drží
        // #ag-ua-now-head + #ag-ua-now na grid.firstChild). Oblíbené se řadí AŽ ZA něj —
        // kdyby oba moduly chtěly první místo, přetahují se o něj každý tick a mřížka
        // viditelně přeskakuje (nahlášená závada „neustále se prohazuje, co je nahoře").
        var uaBox = document.getElementById('ag-ua-now');
        var uaAfter = (uaBox && uaBox.parentNode === grid) ? uaBox : null;
        if (head.parentNode !== grid || head.previousSibling !== uaAfter) {
            grid.insertBefore(head, uaAfter ? uaAfter.nextSibling : grid.firstChild);
        }
        var anchor = head;
        found.forEach(function (tile) {
            // statické dlaždici při prvním přesunu nech na původním místě neviditelnou kotvu
            if (!tile.classList.contains('ag-ft-tile') && !tile._agTpPh) {
                var ph = document.createElement('span');
                ph.style.display = 'none'; ph.setAttribute('data-ag-ph', tileKey(tile) || '');
                tile.parentNode.insertBefore(ph, tile);
                tile._agTpPh = ph;
            }
            if (anchor.nextSibling !== tile) grid.insertBefore(tile, anchor.nextSibling);
            anchor = tile;
        });
    }

    // ---- tlačítko režimu úprav ---------------------------------------------------------
    function injectEditButton() {
        var m = document.getElementById('tools-modal'); if (!m) return;
        if (document.getElementById('ag-tp-editbtn')) return;
        // dovnitř .modal-body PŘED mřížku — vedle vyhledávání se překrýval s nadpisem „Měření"
        var body = m.querySelector('.modal-body'); if (!body) return;
        var btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'ag-tp-editbtn';
        btn.innerHTML = '★ Upravit oblíbené (nástroje nahoře)';
        btn.addEventListener('click', function () {
            var on = document.body.classList.toggle('ag-tp-edit');
            btn.innerHTML = on ? '✓ Hotovo — ukončit úpravy' : '★ Upravit oblíbené (nástroje nahoře)';
        });
        body.insertBefore(btn, body.firstChild);
    }
    // při zavření modálu režim úprav vypnout
    function watchModalClose() {
        var m = document.getElementById('tools-modal'); if (!m || m._agTpWatch) return;
        m._agTpWatch = true;
        new MutationObserver(function () {
            if (m.style.display === 'none' && document.body.classList.contains('ag-tp-edit')) {
                document.body.classList.remove('ag-tp-edit');
                var btn = document.getElementById('ag-tp-editbtn');
                if (btn) btn.innerHTML = '★ Upravit oblíbené (nástroje nahoře)';
            }
        }).observe(m, { attributes: true, attributeFilter: ['style'] });
    }

    // ---- údržba (dlaždice se přerenderovávají field-tools modulem) ---------------------
    function tick() {
        try { injectStyles(); injectEditButton(); watchModalClose(); decorateTiles(); applyFavs(); } catch (e) {}
    }
    function init() {
        tick();
        if (!window.__agTpTimer) window.__agTpTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1600);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });
})();
