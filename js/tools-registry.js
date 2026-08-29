// ===== AR Geodet — REGISTR NÁSTROJŮ: jeden záznam na nástroj (ODPOJITELNÁ vrstva) =
// PROBLÉM, KTERÝ TENHLE SOUBOR ŘEŠÍ: appka má ~70 nástrojů a co o každém z nich
// platí, bylo rozepsané v ŠESTI ručních tabulkách v pěti různých souborech —
// kategorie v mřížce a synonyma pro hledání (field-tools.js), sloveso a popisek
// v seznamu úkonů (nastroje-ukony.js), návod pod „?“ (tools-plus.js), základní
// sada a typy práce (tools-simple.js), příznak „bez sítě neudělá nic“
// (offline-sbal.js). Nový nástroj se musel dopsat do všech šesti a NIC to
// nekontrolovalo — takže se to opakovaně nedopsalo:
//   • Kompas chyběl ve slovesech i v základní sadě → uživatel ho nenašel,
//   • Kontrola vrstvy a Metr v kameře padaly do záchytného „Další nástroje“,
//   • DronView měl návod zapsaný pod klíčem `openDronView`, ale dlaždice se jmenuje
//     `dronview` — takže se u ní „?“ vůbec neukázalo a offline se neodsunula
//     (příznak `net` visel na tomtéž špatném klíči). Při stěhování sem opraveno,
//   • 19 nástrojů nemělo synonyma, takže se nedaly najít hledáním. Doplněna.
//
// ŘEŠENÍ: tady je JEDEN ZÁZNAM NA NÁSTROJ a ostatní moduly si z něj berou, co
// potřebují (AGReg.groups(), AGReg.help(), AGReg.aliases(), AGReg.cat(), …).
// Přidat nástroj = přidat sem jeden řádek. Že se na něco zapomnělo, hlásí
// scripts/check_tools_registry.py (běží v CI).
//
// CO SEM NEPATŘÍ: samotné chování nástroje. Modul se dál registruje sám přes
// window.agRegisterFieldTool({id,label,icon,onClick}) a zůstává odpojitelný —
// registr je jen POPIS (kam patří, jak se hledá, co říká návod), ne kód.
//
// KLÍČ (`k`) je tentýž, jaký po dlaždici čte zbytek appky: `data-tool` u dlaždic
// vyrobených modulem, nebo název otevírací funkce z `onclick` u statických
// dlaždic v index.html (openMeasureModal, startAreaMode…).
//
// POLE ZÁZNAMU
//   k     klíč dlaždice (povinný)
//   cat   kategorie v mřížce Nástrojů; statické dlaždice ji mají z index.html
//   verb  sloveso = skupina v seznamu úkonů; bez něj spadne do „Další nástroje“
//   vl    popisek v seznamu úkonů („Vzdálenost a převýšení mezi body“)
//   vh    upřesnění pod popiskem (šedě, menším písmem)
//   keys  synonyma pro hledání, BEZ DIAKRITIKY a malými písmeny
//   help  { t: titulek } — že nástroj MÁ návod; samotný text je v data/navody.json
//         pod týmž klíčem `k` (viz „KDE JSOU TĚLA NÁVODŮ" níž)
//   net   1 = bez signálu neudělá nic (offline-sbal.js dlaždici odsune dolů)
//   w     1 = UKLÁDÁ NEBO MĚNÍ SOUŘADNICE BODŮ. Dlaždice pak dostane v mřížce
//         proužek (js/tools-plus.js), aby bylo předem vidět, co sáhne na data
//         zakázky a co jen ukazuje. Význam je ZÁMĚRNĚ ÚZKÝ — ne „nástroj si
//         něco uloží" (to dělá skoro každý: nastavení, poslední volby, protokol),
//         ale „přibude, posune se nebo zmizí BOD". Kdyby se to rozšířilo na
//         cokoli zapisujícího, měla by proužek většina dlaždic a značka by
//         přestala něco znamenat.
//         Poznávací znamení v kódu modulu: volá addImportedPoints() nebo
//         saveCustomPoint(), případně přímo přepisuje persistentCustomPoints.
//   base  1 = patří do základní sady jednoduchého režimu
//   hub   1 = dlaždici vyrábí jako rozcestník js/tools-hub.js (jen pro kontrolora)
//   notile 1 = není dlaždice v Nástrojích, návod se otevírá odjinud (jen pro kontrolora)
//   noverb 1 = záměrně bez slovesa, zůstává v „Dalších nástrojích“ (jen pro kontrolora)
//
// KDE JSOU TĚLA NÁVODŮ A PROČ NE TADY
// Návody jsou dlouhé HTML odstavce a bylo jich tu 80 — dvě třetiny objemu celého
// souboru (91 kB, z toho 65 kB samotné návody). Registr přitom čte appka HNED PŘI
// STARTU (kategorie, synonyma, slovesa), takže se těch 65 kB textu stahovalo,
// parsovalo a drželo v paměti VŽDYCKY, i když za celý den nikdo na „?" neťukne.
//
// Proto jsou těla v `data/navody.json` pod týmž klíčem `k` a dotahují se
// AŽ PO VYKRESLENÍ appky (idle) nebo na první vyžádání. Rozdělení hlídá
// scripts/check_tools_registry.py: každý `help` tady musí mít neprázdný text
// tam a naopak — takže se to nemůže tiše rozejít.
//
// PŘIDÁNÍ NÁVODU K NOVÉMU NÁSTROJI: sem `help: { t: 'Titulek' }`, text do
// data/navody.json pod stejný klíč. (Soubor je čisté JSON, žádné escapování
// apostrofů jako dřív v JS řetězci.)
//
// API pro čtení návodu:
//   AGReg.help(k)       → { t, h } SYNCHRONNĚ; h je '' dokud se JSON nedotáhl
//   AGReg.helpAsync(k)  → Promise<{ t, h }>, text zaručeně naplněný
//   AGReg.helpLoad()    → Promise, ruční předtažení
//
// Odstranění: smaž js/tools-registry.js + data/navody.json + řádek <script>
// v index.html. Appka pojede dál, ale nástroje přijdou o slovesa, návody,
// synonyma a typy prací — všechny moduly to snesou (mají prázdný registr
// jako platný stav).
// =================================================================================
(function () {
    'use strict';
    if (window.AGReg) return;

    // Pořadí sloves = pořadí skupin v seznamu úkonů (js/nastroje-ukony.js).
    var VERBS = ['Změřit', 'Určit nový bod', 'Vytyčit', 'Zaznamenat', 'Srovnat AR', 'Zjistit podmínky', 'Katastr a podklady', 'Před výjezdem', 'Firma a papíry', 'Příručka a výpočty'];

    // Typy práce pro jednoduchý režim (js/tools-simple.js). Pořadí = pořadí
    // v přepínači; `tools` je pořadí dlaždic v sekci „Pro tuto práci“.
    var PROFILES = [
        { id: 'univerzal', label: 'Univerzální', tools: [] },
        { id: 'vytycovani', label: 'Vytyčování', tools: ['openStakeoutModal', 'stakeout-line', 'offset-point', 'usadit-ar', 'agOpenCalibrate', 'kompas', 'rajon', 'project-import', 'openMeasureModal'] },
        { id: 'pokladka', label: 'Pokládka / vrstvy', tools: ['vrstvy', 'brutal-gps', 'gps-semafor', 'openCheckDist', 'track-log', 'kompas', 'zavady', 'epochy', 'openMeasureModal'] },
        { id: 'katastr', label: 'Katastr a mapování', tools: ['openKatastr', 'cadastre-vector', 'parcela', 'startAreaMode', 'openTachymetrie', 'project-import', 'openMeasureModal'] },
        { id: 'kontrola', label: 'Kontrola a monitoring', tools: ['openCheckDist', 'epochy', 'zavady', 'openDmtVolume', 'vyska-objektu', 'track-log', 'zapisnik', 'openMeasureModal'] }
    ];

    // ---- JEDEN ZÁZNAM NA NÁSTROJ ------------------------------------------------
    var T = [
        // ── Změřit ──────────────────────────────────────────────────────
        { k: 'openMeasureModal', verb: 'Změřit', vl: 'Vzdálenost a převýšení mezi body', keys: 'vzdalenost delka metry mezi body prevyseni sikma pasmo distance', base: 1,
          help: { t: 'Měření vzdálenosti' } },
        { k: 'ar-metr', verb: 'Změřit', vl: 'Krátkou délku kamerou', vh: 'telefon plocho nad zemí, bez pásma', keys: 'metr pravitko kamera kratka delka bez pasma meritko svinovaci zmerit rukou',
          help: { t: 'Metr v kameře' } },
        { k: 'startAreaMode', verb: 'Změřit', vl: 'Plochu a obvod pozemku', keys: 'plocha vymera obvod pozemek polygon hektar m2 area', base: 1,
          help: { t: 'Měření plochy' } },
        { k: 'openCheckDist', verb: 'Změřit', vl: 'Oměrné — kontrolní míry', keys: 'omerne kontrolni miry kontrola delek pasmo overeni',
          help: { t: 'Oměrné / kontrola' } },
        { k: 'kontrola-vrstvy', verb: 'Změřit', vl: 'Sedí hotová vrstva na projekt?', vh: 'výška za finišerem, odchylka a protokol', keys: 'kontrola vrstvy finiser pokladka asfalt vyska projekt odchylka tloustka protokol',
          help: { t: 'Kontrola vrstvy' } },
        { k: 'openDmtVolume', verb: 'Změřit', vl: 'Kubaturu a vrstevnice', keys: 'kubatura objem vrstevnice dmt teren vykop nasyp hromada',
          help: { t: 'Kubatury / vrstevnice' } },
        { k: 'vyska-objektu', cat: 'Měření', verb: 'Změřit', vl: 'Výšku objektu', vh: 'budova, stožár, strom', keys: 'vyska objektu budova strom stozar uhel meridlo',
          help: { t: 'Výška objektu' } },
        { k: 'korekce', verb: 'Změřit', vl: 'S korekcí na teplotu a tlak', vh: 'pásmo, dálkoměr', keys: 'korekce ppm pasmo teplota tlak vlhkost refrakce zakriveni edm dalkomer atmosfericka oprava pruves',
          help: { t: 'Korekce měření' } },
        { k: 'obchuzka', w: 1, verb: 'Změřit', vl: 'Kubaturu obejitím výkopu', vh: 'obvod z GNSS + dno, objem hned na místě', keys: 'obchuzka vykop kubatura objem obejiti obvod dno jama',
          help: { t: 'Obchůzka výkopu' } },
        { k: 'dvoji-mereni', cat: 'Měření', verb: 'Změřit', vl: 'Kontrolní měření bodu podruhé', vh: 'jediná poctivá přesnost z mobilu', keys: 'kontrola dvoji mereni podruhe overeni presnost rozdil delta opakovane zmerit znovu multipath',
          help: { t: 'Kontrolní měření' } },

        // ── Určit nový bod ──────────────────────────────────────────────
        { k: 'brutal-gps', w: 1, cat: 'Měření', verb: 'Určit nový bod', vl: 'Přesnou GPS', vh: 'dlouhé průměrování s otočením', keys: 'presne gps mereni prumer prumerovani brutalni poloha bod', base: 1,
          help: { t: 'Přesná GPS (dlouhé průměrování)' } },
        { k: 'rajon', w: 1, verb: 'Určit nový bod', vl: 'Rajónem', vh: 'směr a délka ze stanoviska', keys: 'rajon polarni metoda uhel delka stanovisko novy bod',
          help: { t: 'Rajón (směr + délka)' } },
        { k: 'offset-point', w: 1, cat: 'Vytyčování a náčrt', verb: 'Určit nový bod', vl: 'Offsetem', vh: 'odsazení od jiného bodu', keys: 'odsazeny bod offset kolmice stanoveni vypocet',
          help: { t: 'Offset bod' } },
        { k: 'ar-intersection', w: 1, cat: 'Měření', verb: 'Určit nový bod', vl: 'Protínáním vpřed', vh: 'jen úhly, délku měřit nemůžu', keys: 'protinani vpred uhly neznamy bod urceni',
          help: { t: 'Protínání vpřed' } },
        { k: 'pdr-offset', w: 1, cat: 'Měření', verb: 'Určit nový bod', vl: 'Krokovým offsetem', vh: 'došlápnutý vektor', keys: 'kroky krokovy offset vektor chuze pdr roh budovy dead reckoning',
          help: { t: 'Krokový offset' } },
        { k: 'ar-resection', w: 1, cat: 'AR a kalibrace', verb: 'Určit nový bod', vl: 'Resekcí ze známých bodů', vh: 'určí i sever', keys: 'resekce protinani zpet stanovisko volne zname body',
          help: { t: 'Resekce ze známých bodů' } },
        { k: 'free-station', verb: 'Určit nový bod', vl: 'Volným stanoviskem', vh: 'průvodce krok za krokem', keys: 'volne stanovisko pruvodce resekce prechodne',
          help: { t: 'Volné stanovisko (průvodce)' } },
        { k: 'dgps', w: 1, cat: 'Měření', verb: 'Určit nový bod', vl: 'Dvoutelefonní DGPS', vh: 'základna a rover', keys: 'dgps diferencni korekce zakladna rover druhy telefon presnost oprava bodu',
          help: { t: 'Dvoutelefonní DGPS' } },
        { k: 'hlas-kod', w: 1, verb: 'Určit nový bod', vl: 'Hlasem — nadiktovat číslo a kód', vh: 'bez ťukání v rukavicích', keys: 'hlas hlasem kod bod diktovat rukavice mluvit cislo poznamka',
          help: { t: 'Hlasové kódování bodu' } },

        // ── Vytyčit ─────────────────────────────────────────────────────
        { k: 'openStakeoutModal', verb: 'Vytyčit', vl: 'Body podle seznamu', vh: 'vytyčovací checklist', keys: 'vytyceni vytycovaci checklist seznam protokol', base: 1,
          help: { t: 'Vytyčovací checklist' } },
        { k: 'protokol-vytyceni', verb: 'Vytyčit', vl: 'Protokol vytyčení', vh: 'odchylky projekt → skutečnost, tisk a CSV', keys: 'protokol vytyceni odchylka odchylky mezni skutecnost projekt doklad papir tisk pdf kolik jsem se netrefil',
          help: { t: 'Protokol vytyčení' } },
        { k: 'stakeout-line', w: 1, cat: 'Vytyčování a náčrt', verb: 'Vytyčit', vl: 'Přímku', keys: 'vytyceni primky linie rovina stanoveni smeru',
          help: { t: 'Vytyčení přímky' } },
        { k: 'vrstvy', cat: 'Vytyčování a náčrt', verb: 'Vytyčit', vl: 'Vrstvu pokládky', vh: 'výška a sklon za finišerem', keys: 'vrstvy pokladka skladba silnice asfalt sklon rez finisher tablet',
          help: { t: 'Vrstvy / pokládka' } },
        { k: 'indoor', verb: 'Vytyčit', vl: 'Dojít k bodu uvnitř budovy', vh: 'bez GPS; navádí, nevytyčuje', keys: 'uvnitr budovy bez gps interier hala navadeni krokovani',
          help: { t: 'Uvnitř budovy' } },

        // ── Zaznamenat ──────────────────────────────────────────────────
        { k: 'openTachymetrie', verb: 'Zaznamenat', vl: 'Náčrt / tachymetrii', keys: 'nacrt kresba skica tachymetrie zpmz polni nakres',
          help: { t: 'Náčrt / Tachymetrie' } },
        { k: 'zapisnik', cat: 'Měření', verb: 'Zaznamenat', vl: 'Zápisník', vh: 'nivelace, směry', keys: 'zapisnik polni denik poznamky mereni zaznamy', base: 1,
          help: { t: 'Zápisníky' } },
        { k: 'zavady', verb: 'Zaznamenat', vl: 'Závadu s fotkou', keys: 'zavada zavady porucha vada nalez hlaseni defekt kontrola oprava foto protokol reklamace',
          help: { t: 'Závady / hlášení' } },
        { k: 'hlasovky', verb: 'Zaznamenat', vl: 'Hlasovou poznámku', vh: 's georazítkem', keys: 'hlasovka nahravka diktafon zvuk mluvena poznamka audio',
          help: { t: 'Hlasové poznámky' } },
        { k: 'denik-dne', verb: 'Zaznamenat', vl: 'Deník dne', keys: 'denik dne zaznam prace vykaz co jsem delal poznamky',
          help: { t: 'Deník dne' } },
        { k: 'track-log', cat: 'Měření', verb: 'Zaznamenat', vl: 'Stopu trasy', keys: 'stopa trasa log gpx zaznam cesty prochazka',
          help: { t: 'Stopa trasy' } },
        { k: 'geo-foto', verb: 'Zaznamenat', vl: 'Fotku s razítkem', vh: 'S-JTSK, výška, čas a azimut ve fotce', keys: 'fotka foto razitko georazitko snimek dokumentace souradnice',
          help: { t: 'Geo-fotka' } },
        { k: 'epochy', w: 1, cat: 'Měření', verb: 'Zaznamenat', vl: 'Epochy — posuny v čase', vh: 'opakované měření bodu', keys: 'epochy monitoring posuny deformace sledovani opakovane',
          help: { t: 'Epochy / monitoring' } },
        { k: 'kvalita-bodu', verb: 'Zaznamenat', vl: 'Protokol kvality', vh: 'čím byl bod změřen a jak dobře', keys: 'kvalita protokol presnost sigma smerodatna odchylka epochy doklad rozptyl mereni doložit',
          help: { t: 'Protokol kvality' } },
        { k: 'overeni-bodu', verb: 'Zaznamenat', vl: 'Ověření bodů', vh: 'které body mají druhé nezávislé určení', keys: 'overeni overeny bod kontrola druhe urceni kontrolni mereni odchylka mez mezni kod kvality dvakrat prekontrolovat',
          help: { t: 'Ověření bodů' } },
        { k: 'kos', w: 1, verb: 'Zaznamenat', vl: 'Obnovit smazaný bod', vh: 'koš — body i zakázky, 30 dní', keys: 'kos smazane body obnovit odpadky obnova vratit zpet zakazky',
          help: { t: 'Koš — obnovení smazaného' } },

        // ── Srovnat AR ──────────────────────────────────────────────────
        { k: 'usadit-ar', verb: 'Srovnat AR', vl: 'Nevím čím začít — průvodce', vh: 'značky nesedí na realitu', keys: 'usadit srovnat kalibrace sever ar pruvodce orientace nesedi posun helmert resekce stanovisko',
          help: { t: 'Usadit AR (průvodce)' } },
        { k: 'kompas', verb: 'Srovnat AR', vl: 'Podívat se na kompas', vh: 'růžice se zeměpisným i magnetickým severem', keys: 'kompas busola ruzice sever magneticky zemepisny pravy azimut deklinace smer strelka gon nula', base: 1,
          help: { t: 'Kompas a sever' } },
        { k: 'agOpenCalibrate', verb: 'Srovnat AR', vl: 'Srovnat sever', keys: 'sever kalibrace kompas azimut srovnat smer odchylka', base: 1,
          help: { t: 'Srovnat sever' } },
        { k: 'ar-calib2', verb: 'Srovnat AR', vl: 'Srovnat na dva body', keys: 'srovnat ar dva body kalibrace posun sever usadit znacky nesedi',
          help: { t: 'Srovnat AR na 2 body' } },
        { k: 'orient-point', cat: 'AR a kalibrace', verb: 'Srovnat AR', vl: 'Srovnat sever podle bodu', vh: 'opravuje AZIMUT, ne polohu', keys: 'orientace bod sever srovnani smer',
          help: { t: 'Srovnat sever podle bodu' } },
        { k: 'localization-helmert', verb: 'Srovnat AR', vl: 'Lokalizace (Helmert)', vh: 'místní systém', keys: 'helmert lokalizace transformace klic mistni system',
          help: { t: 'Lokalizace (Helmert)' } },
        { k: 'ref-calibration', w: 1, verb: 'Srovnat AR', vl: 'Opravit posun GPS podle bodu', vh: 'opravuje POLOHU, ne sever', keys: 'kalibrace referencni bod srovnani ar posun usazeni znamy bod',
          help: { t: 'Posun GPS na známý bod' } },
        { k: 'fov-kalib', verb: 'Srovnat AR', vl: 'Změřit zorný úhel kamery', keys: 'zorny uhel kamery fov kalibrace ohnisko sirka zaberu ar presnost',
          help: { t: 'Zorný úhel kamery (FOV)' } },
        { k: 'ar-visual-track', verb: 'Srovnat AR', vl: 'Vizuální stabilizace', vh: 'beta', keys: 'stabilizace ar obraz kamera drift plavani znacek vizualni beta',
          help: { t: 'Vizuální stabilizace AR (beta)' } },

        // ── Zjistit podmínky ────────────────────────────────────────────
        { k: 'gps-semafor', cat: 'Měření', verb: 'Zjistit podmínky', vl: 'Dá se tady měřit?', vh: 'skóre místa, odrazy od fasád', keys: 'semafor skore mista multipath signal kvalita gps fasada odrazy podminky',
          help: { t: 'Skóre místa (GPS)' } },
        { k: 'openSatModal', verb: 'Zjistit podmínky', vl: 'Družice teď', vh: 'kolik jich vidím a jaká geometrie', keys: 'gnss satelity druzice obloha prekazky signal gps kvalita',
          help: { t: 'GNSS satelity' } },
        { k: 'sky-obstruction', verb: 'Zjistit podmínky', vl: 'Predikci signálu', vh: 'maska překážek', keys: 'predikce signalu obloha prekazky stromy budovy gnss planovani',
          help: { t: 'Predikce signálu' } },
        { k: 'gnss-forecast', verb: 'Zjistit podmínky', vl: 'Kdy bude nejlíp měřit', vh: 'GNSS předpověď', keys: 'gnss predpoved kdy merit pdop dop okno planovani ionosfera kp bourka geometrie druzic pocasi pro gps', net: 1,
          help: { t: 'GNSS předpověď' } },
        { k: 'pocasi', verb: 'Zjistit podmínky', vl: 'Počasí', keys: 'pocasi predpoved dest vitr teplota radar srazky obloha bourka', net: 1,
          help: { t: 'Počasí' } },
        { k: 'slunce', verb: 'Zjistit podmínky', vl: 'Slunce a světlo', vh: 'protisvětlo, soumrak', keys: 'slunce svetlo zapad vychod soumrak stin protisvetlo oslneni tma azimut zlata hodina',
          help: { t: 'Slunce a světlo' } },
        { k: 'dronview', verb: 'Zjistit podmínky', vl: 'Dronové zóny', vh: 'omezení vzdušného prostoru (ŘLP)', keys: 'dron drony zony letani omezeni vzdusny prostor uas dronview rlp', net: 1,
          help: { t: 'Dronové zóny (DronView)' } },

        // ── Katastr a podklady ──────────────────────────────────────────
        { k: 'openKatastr', verb: 'Katastr a podklady', vl: 'Katastr — kde právě stojím', keys: 'katastr parcela kn nahlizeni kde stojim mapa cuzk', net: 1, base: 1,
          help: { t: 'Katastr (zde stojím)' } },
        { k: 'cadastre-vector', w: 1, cat: 'Katastr a data', verb: 'Katastr a podklady', vl: 'Parcely do mapy a do AR', keys: 'katastr vektor hranice parcely dxf import mapa kn', net: 1,
          help: { t: 'Katastr — parcely' } },
        { k: 'cadastre-area', w: 1, verb: 'Katastr a podklady', vl: 'Stáhnout body z výřezu mapy', keys: 'stahnout body vyrez oblast okoli bodove pole import mapa', net: 1,
          help: { t: 'Stáhnout body z výřezu mapy' } },
        { k: 'balicek-zakazky', cat: 'Katastr a data', verb: 'Před výjezdem', vl: 'Sbalit zakázku pro terén', vh: 'mapa, katastr a body kolem ZAKÁZKY, ne kolem mě', keys: 'sbalit balicek offline pred vyjezdem stahnout mapu katastr body zakazka kancelar wifi priprava',
          help: { t: 'Sbalit zakázku' } },
        { k: 'bodove-pole', cat: 'Katastr a data', verb: 'Katastr a podklady', vl: 'Nejbližší známý bod', vh: 'kam dojít na ověření / kotvu GPS', keys: 'znamy bod bodove pole trigonometricky zhustovaci pbpp nivelacni nejblizsi overeni kotva cuzk kam dojit',
          help: { t: 'Nejbližší známý bod' } },
        { k: 'parcela', w: 1, cat: 'Katastr a data', verb: 'Katastr a podklady', vl: 'Parcela — geometrie a dělení', keys: 'parcela geometrie deleni vymera obvod smerniky dily',
          help: { t: 'Parcela / dělení' } },
        { k: 'hodinky-parovani', cat: 'Katastr a data', verb: 'Před výjezdem', vl: 'Hodinky Garmin', vh: 'body z hodinek a zpátky', keys: 'hodinky garmin forerunner fenix watch parovani synchronizace body zapesti connect iq', net: 1,
          help: { t: 'Hodinky Garmin' } },
        { k: 'project-import', w: 1, cat: 'Katastr a data', verb: 'Katastr a podklady', vl: 'Import projektu', vh: 'DXF, situace', keys: 'import projekt oblast stazeni csv dxf soubor nahrat', base: 1,
          help: { t: 'Import projektu (DXF)' } },
        { k: 'geo-overlay', cat: 'Katastr a data', verb: 'Katastr a podklady', vl: 'Podložit plán do mapy', vh: 'georeference obrázku', keys: 'podklad georeference obrazek plan situace vykres overlay',
          help: { t: 'Vlastní podklad' } },
        { k: 'utility-networks', verb: 'Katastr a podklady', vl: 'Podzemní sítě', keys: 'site podzemni vedeni inzenyrske gml kabel plyn voda',
          help: { t: 'Podzemní sítě' } },
        { k: 'job-transfer', w: 1, verb: 'Katastr a podklady', vl: 'Poslat nebo načíst zakázku', keys: 'prenos zakazky export import argeo sdileni telefon', net: 1,
          help: { t: 'Poslat/načíst zakázku' } },
        { k: 'hidden-points', verb: 'Katastr a podklady', vl: 'Skryté body', keys: 'skryte body obnovit zobrazit schovane',
          help: { t: 'Skryté body' } },

        // ── Před výjezdem ───────────────────────────────────────────────
        { k: 'brifink', verb: 'Před výjezdem', vl: 'Dnešek v terénu', vh: 'souhrn na ráno', keys: 'brifink dnesek souhrn rano prehled dne pocasi svetlo terminy', net: 1,
          help: { t: 'Dnešek v terénu' } },
        { k: 'checklist', verb: 'Před výjezdem', vl: 'Co s sebou', keys: 'checklist co s sebou baleni vybaveni seznam rano nezapomen vzit',
          help: { t: 'Co s sebou' } },
        { k: 'bezpecnost', verb: 'Před výjezdem', vl: 'Bezpečnost a rizika', keys: 'bezpecnost bozp riziko vedro pitny rezim bourka blesk vesta soumrak mraz vitr sos poloha pomoc',
          help: { t: 'Bezpečnost' } },
        { k: 'kde-je', verb: 'Před výjezdem', vl: 'Kde co mám', vh: 'báze, stativ, materiál — i auto', keys: 'auto parkovani kde stoji baze stativ material najit zpatky navigace znacka',
          help: { t: 'Kde co mám' } },

        // ── Firma a papíry ──────────────────────────────────────────────
        { k: 'zmenit-zakazku', w: 1, cat: 'Pomůcky', verb: 'Firma a papíry', vl: 'Změnit zakázku', vh: 'přepnout se na jinou práci bez restartu', keys: 'zakazka zakazky prepnout zmenit projekt praca stavba jina zakazka prepnuti vybrat zakazku zmena zakazky',
          help: { t: 'Změnit zakázku' } },
        { k: 'dochazka', verb: 'Firma a papíry', vl: 'Docházka', keys: 'dochazka prichod odchod pracovni doba hodiny smena',
          help: { t: 'Docházka' } },
        { k: 'firma-chat', verb: 'Firma a papíry', vl: 'Firemní chat', keys: 'chat zpravy firma kolegove komunikace vzkaz psani', net: 1,
          help: { t: 'Firemní chat' } },
        { k: 'vysilacka', verb: 'Firma a papíry', vl: 'Vysílačka', vh: 'kde je kolega, rychlé zprávy, hlídání pádu', keys: 'vysilacka poloha kolegove tym kde jsou sdileni pozice',
          help: { t: 'Vysílačka' } },
        { k: 'ucty-firma', verb: 'Firma a papíry', vl: 'Firma a účty', keys: 'firma ucty uzivatele role opravneni sprava zamestnanci prihlaseni',
          help: { t: 'Firma a účty' } },
        { k: 'kniha-jizd', verb: 'Firma a papíry', vl: 'Kniha jízd', keys: 'kniha jizd cestak kilometry km naklady cestovni nahrady tachometr vozidlo ucetni',
          help: { t: 'Kniha jízd' } },
        { k: 'moje-aktivita', verb: 'Firma a papíry', vl: 'Moje aktivita', vh: 'kolik jsem ušel, co používám, co schovat', keys: 'aktivita statistika prehled kroky krokomer kilometry vyskove metry nastoupano cas souhrn dne kolik jsem udelal pouzivani nastroju skryt nepouzivane',
          help: { t: 'Moje aktivita' } },
        { k: 'rocenka', verb: 'Firma a papíry', vl: 'Ročenka', vh: 'rok a měsíc v číslech, mapa kde jsi byl', keys: 'rocenka rok v cislech mesic statistika souhrn roku kde jsem byl mapa roku odznaky serie kolik jsem nachodil vyrocni prehled bilance',
          help: { t: 'Ročenka' } },
        { k: 'kolize-bodu', cat: 'Měření', verb: 'Změřit', vl: 'Body na sobě', vh: 'nezměřili jste s kolegou týž bod dvakrát?', keys: 'kolize duplicita dvojity bod dva body na sobe stejny bod tyz bod kolega spoluprace sdilena zakazka slouceni bodu prekryv',
          help: { t: 'Body na sobě' }, w: 1 },

        // ── Příručka a výpočty ──────────────────────────────────────────
        { k: 'predpisy', verb: 'Příručka a výpočty', vl: 'Předpisy a odchylky', keys: 'predpisy vyhlaska odchylky kody lhuty tahak normy trida presnosti',
          help: { t: 'Předpisy & odchylky' } },
        { k: 'postupy', cat: 'Pomůcky', verb: 'Příručka a výpočty', vl: 'Postupy měření', keys: 'postupy navody checklisty pracovni kroky jak na',
          help: { t: 'Postupy měření' } },
        { k: 'openDictModal', verb: 'Příručka a výpočty', vl: 'Slovník pojmů', keys: 'slovnik pojmy zkratky vyznam terminologie',
          help: { t: 'Slovník' } },
        { k: 'openCalcModal', verb: 'Příručka a výpočty', vl: 'Kalkulačka', keys: 'kalkulacka vypocet prevod gon stupne uhly plocha',
          help: { t: 'Kalkulačka' } },
        { k: 'gesta-zkratky', cat: 'Pomůcky', verb: 'Příručka a výpočty', vl: 'Gesta (zkratky nástrojů)', vh: 'spustit nástroj jedním tahem prstu',
          keys: 'gesto gesta zkratka zkratky tah prstem swipe rychle spusteni nastroje bez hledani trenazer prirazeni',
          help: { t: 'Gesta (zkratky nástrojů)' } },
        { k: 'sprava-appky', notile: 1,
          help: { t: 'Správa aplikace' } },

        // ── bez slovesa (spadnou do „Další nástroje“ / nejsou dlaždice) ─────
        { k: 'agPosFromMap', notile: 1,
          help: { t: 'Poloha z mapy' } },
        { k: 'auto-bezpeci', keys: 'auto bezpeci kde mam auto baze stativ material kniha jizd cestak kilometry bourka vedro mraz vitr tma sos rizika co s sebou balici seznam checklist rozcestnik', hub: 1,
          help: { t: 'Auto a bezpečí' } },
        { k: 'bod-vypoctem', w: 1, keys: 'bod vypoctem novy vypocet rajon offset protinani smernik delka uhel konstrukce rozcestnik', hub: 1,
          help: { t: 'Bod výpočtem' } },
        { k: 'err-log', keys: 'protokol chyb log chyba diagnostika hlaseni', noverb: 1,
          help: { t: 'Protokol chyb' } },
        { k: 'gnss-signal', keys: 'gnss signal gps kvalita druzice satelity predikce semafor skore multipath obloha podminky', hub: 1,
          help: { t: 'Signál GNSS' } },
        { k: 'pocasi-svetlo', keys: 'pocasi svetlo slunce vychod zapad soumrak stin srazky dest radar vitr tlak gnss predpoved pdop kp brifink dnesek obloha podminky rozcestnik', hub: 1,
          help: { t: 'Počasí a světlo' } },
        { k: 'prirucka', keys: 'prirucka predpisy postupy slovnik odchylky kody lhuty navody tahak pojmy zkratky', hub: 1,
          help: { t: 'Příručka' } }
    ];

    // ---- rejstřík a API ---------------------------------------------------------
    var BY = {};
    for (var i = 0; i < T.length; i++) { BY[T[i].k] = T[i]; }

    function get(k) { return (k && BY[k]) || null; }

    // Skupiny pro seznam úkonů ve tvaru, který čeká js/nastroje-ukony.js:
    // [{ t: 'Změřit', items: [{ k, l, h }] }] — pořadí skupin dle VERBS, pořadí
    // položek dle pořadí záznamů v T.
    function groups() {
        var byVerb = {}, out = [], j;
        for (j = 0; j < VERBS.length; j++) { byVerb[VERBS[j]] = { t: VERBS[j], items: [] }; }
        for (j = 0; j < T.length; j++) {
            var r = T[j];
            if (!r.verb || !byVerb[r.verb]) continue;
            var it = { k: r.k, l: r.vl || r.k };
            if (r.vh) it.h = r.vh;
            byVerb[r.verb].items.push(it);
        }
        for (j = 0; j < VERBS.length; j++) { if (byVerb[VERBS[j]].items.length) out.push(byVerb[VERBS[j]]); }
        return out;
    }

    // Klíče s návodem. Vrací je od NEJDELŠÍHO — dlaždice se poznává hledáním
    // klíče v textu `onclick` a kratší klíč umí být kusem delšího („pocasi“ je
    // uvnitř „agOpenPocasi“), takže na pořadí záleží.
    var HELP_KEYS = null;
    function helpKeys() {
        if (!HELP_KEYS) {
            HELP_KEYS = [];
            for (var j = 0; j < T.length; j++) { if (T[j].help) HELP_KEYS.push(T[j].k); }
            HELP_KEYS.sort(function (a, b) { return b.length - a.length; });
        }
        return HELP_KEYS;
    }

    // ---- těla návodů (data/navody.json) ------------------------------------------
    // Dotahují se AŽ PO vykreslení appky: 65 kB textu, který většina dní nikdo
    // neotevře, nemá co brzdit start. Cache-first service worker (sw.js) soubor
    // předcachuje, takže to funguje i bez signálu.
    var URL_NAVODY = './data/navody.json';
    var NAV = null;          // { k: '<html>' } až po načtení
    var NAV_P = null;        // rozjetý Promise (aby se nestahovalo dvakrát)

    function helpLoad() {
        if (NAV) return Promise.resolve(NAV);
        if (NAV_P) return NAV_P;
        if (typeof fetch !== 'function') { NAV = {}; return Promise.resolve(NAV); }
        NAV_P = fetch(URL_NAVODY)
            .then(function (r) { return r.ok ? r.json() : {}; })
            .then(function (j) { NAV = j || {}; return NAV; })
            .catch(function () { NAV = {}; return NAV; });   // bez návodů, ale appka jede
        return NAV_P;
    }

    // `h` je '' dokud se JSON nedotáhl. Volající, kterým to vadí (bublina „?"),
    // mají helpAsync; volající, kterým to nevadí (krátký popisek v kolečku),
    // jen chvíli po startu nic neukážou.
    function help(k) {
        var r = get(k);
        if (!r || !r.help) return null;
        if (!NAV) helpLoad();
        return { t: r.help.t, h: (NAV && NAV[k]) || '' };
    }

    function helpAsync(k) {
        var r = get(k);
        if (!r || !r.help) return Promise.resolve(null);
        return helpLoad().then(function (n) { return { t: r.help.t, h: n[k] || '' }; });
    }

    // Předtažení v nečinnosti — ať je text v paměti dřív, než na „?" někdo ťukne.
    // Testy pouštějí registr v holém V8 (scripts/check_tools_registry.py), kde
    // žádné časovače ani fetch nejsou — proto ta kontrola typeof.
    (function predtahni() {
        var start = function () { helpLoad(); };
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 4000 });
        else if (typeof setTimeout === 'function') setTimeout(start, 2500);
    })();

    window.AGReg = {
        all: function () { return T.slice(); },
        get: get,
        groups: groups,
        verbs: function () { return VERBS.slice(); },
        help: help,
        helpAsync: helpAsync,
        helpLoad: helpLoad,
        helpKeys: helpKeys,
        aliases: function (k) { var r = get(k); return (r && r.keys) || ''; },
        cat: function (k) { var r = get(k); return (r && r.cat) || ''; },
        isNet: function (k) { var r = get(k); return !!(r && r.net); },
        // ukládá / mění souřadnice bodů (viz `w` v popisu polí nahoře)
        isWrite: function (k) { var r = get(k); return !!(r && r.w); },
        baseSet: function () {
            var out = [];
            for (var j = 0; j < T.length; j++) { if (T[j].base) out.push(T[j].k); }
            return out;
        },
        profiles: function () { return PROFILES.slice(); }
    };
})();
