// ===== AR Geodet — ROZCESTNÍKY NÁSTROJŮ (declutter mřížky i seznamu úkonů) =====
// ODPOJITELNÁ vrstva ve stylu js/usadit-ar.js. NEEDITUJE logika.js ani grafika.js.
// Pokračuje v úklidu Nástrojů: po „Usadit AR" (7 kalibračních dlaždic → průvodce)
// slučuje další příbuzné dlaždice do DESETI rozcestníků:
//
//   • „Bod výpočtem"      = Rajón + Offset bod + Protínání vpřed
//   • „Signál GNSS"       = Družice teď + Predikce signálu + Semafor místa
//   • „Příručka"          = Předpisy & odchylky + Postupy měření + Slovník
//   • „Počasí a světlo"   = Počasí + Slunce + GNSS předpověď + Dnešek v terénu
//   • „Auto a bezpečí"    = Kde co mám + Kniha jízd + Bezpečnost + Co s sebou
//   • „Moje čísla"        = Moje aktivita + Ročenka
//   • „Zápis dne"         = Deník dne + Plakát dne
//   • „Firma"             = Firma a účty + Docházka + Firemní chat + Vysílačka
//   • „Podklady a katastr"= Prohlídka okolí + Parcely + Body z výřezu +
//                           Vektorová mapa offline + Sbalit zakázku
//   • „Přenosy a zařízení"= Hodinky Garmin + Poslat/načíst zakázku
//   • „Srovnat jinak"    = Srovnat na 2 body + podle bodu + podle Slunce +
//                           Lokalizace (Helmert) + Posun GPS na bod + Zorný úhel
//
// a navíc SKRÝVÁ nástroje, které mají vstup jinde nebo je uživatel nechce vidět
// (v DOM zůstávají — hledáním i průvodcem „Usadit AR" jdou dál spustit):
//   • Brutální GPS       → tlačítko v modálu Nový bod (+ větev průvodce Usadit AR)
//   • Vizuální stabilizace → přepínač v Nastavení → AR & přesnost
//   • Skryté body        → tlačítko v Nastavení → Údržba
//   • + vše, co má v js/tools-registry.js `hidden: 1` (Podzemní sítě, Hlasová
//     poznámka — uživatel je 31. 8. 2026 označil za nepoužitelné, resp. zbytečné)
//
// ⚠⚠ PROČ SE ČLENSTVÍ ROZCESTNÍKŮ ČTE Z REGISTRU A NEPÍŠE SE TADY
// Do 31. 8. 2026 byl seznam položek zapsaný v tomhle souboru a rozcestník podle
// něj skrýval DLAŽDICE V MŘÍŽCE. Jenže mřížku dnes nikdo nevidí: panel Nástrojů
// ukazuje SEZNAM ÚKONŮ (js/nastroje-ukony.js), který mřížku schová a vypíše
// nástroje po slovesech — a tam se položky rozcestníku objevovaly dál každá
// zvlášť. Sloučení tedy neušetřilo ANI JEDEN řádek, uživatel dál viděl Počasí,
// Slunce, GNSS předpověď i Dnešek vedle sebe a žádal totéž sloučení znovu.
// Teď je členství JEDNOU v js/tools-registry.js (pole `inhub`), odkud ho čtou
// oba pohledy. Tady zůstává jen to, co registr nemá: ikona, titulek, uvedení
// a delší popisky voleb.
//
// Kromě slučování dělá modul ještě dvě věci proti „bordelu" v panelu:
//   • hlídá blok „⚡ Teď se hodí" (staví ho usadit-ar.js) — nechá nahoře nejvýš
//     NOW_MAX návrhů, zbytek schová pod nenápadné „další (N)" (viz komentář
//     u NOW_MAX, proč zrovna čtyři),
//   • sjednocuje rastr mřížky: stejně vysoké dlaždice, stejné mezery a stejně
//     odsazené nadpisy sekcí (statické .tool-cat i injektované .ag-ft-head).
//
// Řídí se STEJNÝM přepínačem „Zjednodušené Nástroje" (Nastavení → Vzhled,
// klíč agSimpleTools z usadit-ar.js, výchozí ZAPNUTO). Nic se nemaže.
// Odstranění: smaž js/tools-hub.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    // ⚠ NEPLÉST s 'agSimpleTools_v1' (js/tools-simple.js, js/rezim-prace.js) — to je
    // JINÝ přepínač („jednoduchý režim" = jen základní sada dlaždic) a je výchozím
    // stavem VYPNUTÝ. Tenhle klíč (bez _v1) řídí slučování do rozcestníků a je
    // výchozím stavem ZAPNUTÝ. Podobná jména, opačné výchozí hodnoty.
    var SIMPLE_KEY = 'agSimpleTools';   // sdílený přepínač s usadit-ar.js

    // ---- definice rozcestníků ---------------------------------------------------
    // Položky (a jejich pořadí) NEJSOU tady — jsou v js/tools-registry.js jako
    // `inhub: '<id>'`, protože z nich musí číst i seznam úkonů (viz hlavička).
    var HUBS = [
        {
            id: 'bod-vypoctem', label: 'Bod<br>výpočtem', title: 'Bod výpočtem', cat: 'Měření', order: 6,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M6.5 17.5L17.5 6.5"/><path d="M12 12l7 7"/></svg>',
            poradi: ['rajon', 'offset-point', 'ar-intersection'],
            sub: 'Nový bod z existujících bodů — vyber metodu podle toho, co umíš změřit:'
        },
        {
            id: 'gnss-signal', label: 'Signál<br>GNSS', title: 'Signál GNSS', cat: 'Měření', order: 7,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><circle cx="4" cy="20" r="0.5" fill="currentColor"/></svg>',
            poradi: ['openSatModal', 'sky-obstruction', 'gps-semafor'],
            sub: 'Jak dobré jsou teď (a budou) podmínky pro GPS měření:'
        },
        {
            id: 'prirucka', label: 'Příručka', title: 'Příručka', cat: 'Pomůcky', order: 6,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
            poradi: ['predpisy', 'postupy', 'openDictModal'],
            sub: 'Offline tahák do terénu — vše s uvedeným zdrojem:'
        },
        {
            id: 'pocasi-svetlo', label: 'Počasí<br>a světlo', title: 'Počasí a světlo', cat: 'Pomůcky', order: 7,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><path d="M8 2v1.4M8 12.6V14M2 8h1.4M12.6 8H14M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1"/><path d="M10.8 20.5h7.4a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.5-.8 3.4 3.4 0 0 0 .8 6.8z"/></svg>',
            poradi: ['pocasi', 'slunce', 'gnss-forecast', 'brifink'],
            sub: 'Co dnes udělá obloha — počasí, denní světlo i podmínky pro družice na jednom místě:'
        },
        {
            id: 'auto-bezpeci', label: 'Auto<br>a bezpečí', title: 'Auto a bezpečí', cat: 'Pomůcky', order: 8,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H3v-5l2.4-4.9A2 2 0 0 1 7.2 6h9.6a2 2 0 0 1 1.8 1.1L21 12v5h-2"/><path d="M9 17h6"/><path d="M3 12h18"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
            poradi: ['kde-je', 'kniha-jizd', 'bezpecnost', 'checklist'],
            sub: 'Kolem měření, ne měření samo — auto, kilometry a vlastní kůže:'
        },
        {
            id: 'moje-cisla', label: 'Moje<br>čísla', title: 'Moje čísla', cat: 'Pomůcky', order: 9,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><rect x="5" y="11" width="3.6" height="7" rx="1"/><rect x="10.2" y="6" width="3.6" height="12" rx="1"/><rect x="15.4" y="13" width="3.6" height="5" rx="1"/></svg>',
            poradi: ['moje-aktivita', 'rocenka'],
            sub: 'Co jsi za den, měsíc a rok nachodil a naměřil — vlastní čísla, ne data zakázky:'
        },
        {
            id: 'zapis-dne', label: 'Zápis<br>dne', title: 'Zápis dne', cat: 'Pomůcky', order: 10,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/></svg>',
            poradi: ['denik-dne', 'plakat-dne'],
            sub: 'Uzavření dne — slovy do výkazu, nebo obrázkem do skupiny:'
        },
        {
            id: 'firma-hub', label: 'Firma', title: 'Firma', cat: 'Pomůcky', order: 11,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M4 21V8l8-5 8 5v13"/><path d="M9.5 21v-6h5v6"/><path d="M9 10h.01M15 10h.01"/></svg>',
            poradi: ['ucty-firma', 'dochazka', 'firma-chat', 'vysilacka'],
            sub: 'Lidé, hodiny a zprávy — všechno firemní na jednom místě:'
        },
        {
            id: 'podklady-katastr', label: 'Podklady<br>a katastr', title: 'Podklady a katastr', cat: 'Katastr a data', order: 5,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5L3 6.5v14l6-3 6 3 6-3v-14l-6 3-6-3z"/><path d="M9 3.5v14M15 6.5v14"/></svg>',
            poradi: ['prohlidka', 'cadastre-vector', 'cadastre-area', 'vektor-mapa', 'balicek-zakazky'],
            sub: 'Co si přitáhneš do mapy a do AR. (Katastr „kde právě stojím" má vlastní dlaždici — to je jedno klepnutí.)'
        },
        {
            // ⚠⚠ PROČ TENHLE ROZCESTNÍK: sloveso „Srovnat AR" mělo DESET řádků — víc než
            // kterékoli jiné a dvakrát víc než „Vytyčit", což je hlavní denní úkon
            // geodeta u pokládky. Deset názvů, které všechny slibují „ať značky sedí",
            // není volba, ale hádanka. Nahoře zůstávají tři vstupy: průvodce (usadit-ar),
            // Kompas a Srovnat sever — tedy „nevím čím začít", „chci se podívat" a
            // „udělám to nejběžnější". Zbytek je tady, kde je u každé volby napsané, KDY
            // se hodí. Členství je v js/tools-registry.js (`inhub: 'srovnat-sever'`).
            id: 'srovnat-sever', label: 'Srovnat<br>jinak', title: 'Srovnat AR — další způsoby', cat: 'AR a kalibrace', order: 5,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.2 8.8l-2 4.4-4.4 2 2-4.4z"/><path d="M12 1.8v1.6"/></svg>',
            poradi: ['ar-calib2', 'orient-point', 'sever-slunce', 'ref-calibration', 'localization-helmert', 'fov-kalib'],
            sub: 'Značky v AR nesedí na realitu. Vyber podle toho, CO je špatně a co máš kolem sebe:'
        },
        {
            id: 'prenosy-zarizeni', label: 'Přenosy<br>a zařízení', title: 'Přenosy a zařízení', cat: 'Katastr a data', order: 6,
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="6" width="10" height="12" rx="3"/><path d="M9.5 6V3.5h5V6M9.5 18v2.5h5V18"/><path d="M12 9.5V12l1.7 1"/></svg>',
            poradi: ['hodinky-parovani', 'job-transfer'],
            sub: 'Data ven z telefonu a zpátky — jiná parketa než měření:'
        }
    ];

    // Titulek volby, když `vl` z registru nezní samostatně: `vl` je psané tak, aby
    // navazovalo na sloveso v seznamu úkonů („Zjistit podmínky → Predikci signálu"),
    // kdežto v rozcestníku stojí samo. Co tady není, bere se z `vl`.
    var NAZEV = {
        'rajon': 'Rajón (směr + délka)',
        'offset-point': 'Offset bod (odsazení)',
        'ar-intersection': 'Protínání vpřed (jen úhly)',
        'openSatModal': 'Družice teď',
        'sky-obstruction': 'Predikce signálu',
        'gps-semafor': 'Semafor místa',
        'predpisy': 'Předpisy & odchylky',
        'postupy': 'Postupy měření',
        'openDictModal': 'Slovník',
        'gnss-forecast': 'GNSS předpověď',
        'brifink': 'Dnešek v terénu',
        'kde-je': 'Kde co mám',
        'kniha-jizd': 'Kniha jízd',
        'bezpecnost': 'Bezpečnost a rizika',
        'checklist': 'Co s sebou',
        'cadastre-vector': 'Katastr — parcely',
        'cadastre-area': 'Body z výřezu mapy',
        'balicek-zakazky': 'Sbalit zakázku',
        'job-transfer': 'Poslat / načíst zakázku',
        'ucty-firma': 'Firma a účty',
        'ar-calib2': 'Srovnat na dva body',
        'orient-point': 'Srovnat sever podle bodu',
        'sever-slunce': 'Srovnat sever podle Slunce',
        'ref-calibration': 'Opravit posun GPS podle bodu',
        'localization-helmert': 'Lokalizace (Helmert)',
        'fov-kalib': 'Změřit zorný úhel kamery'
    };

    // Delší popisek volby v rozcestníku (celá věta — v registru je jen krátké `vh`
    // do seznamu úkonů). Když klíč chybí, vezme se `vh` z registru, takže nový
    // nástroj s `inhub` se v rozcestníku objeví i bez zápisu sem.
    var TXT = {
        'rajon': 'Stojím na známém bodě a mám směr a vodorovnou délku (pásmo, dálkoměr).',
        'offset-point': 'Bod odsadím od jiného bodu o azimut/směrník a vzdálenost — třeba roh budovy.',
        'ar-intersection': 'Délku změřit nemůžu — bod protnu záměrami ze dvou známých stanovisek.',
        'openSatModal': 'Kolik družic je nad obzorem a jaká je geometrie (GPS, Galileo, GLONASS, BeiDou).',
        'sky-obstruction': 'Skyplot s maskou překážek — kolik družic zbude u lesa, v zástavbě, ve svahu.',
        'gps-semafor': 'Skóre aktuálního místa: odrazy od fasád (multipath), stabilita, doporučení.',
        'predpisy': 'Mezní odchylky, kódy kvality, lhůty a paragrafy z katastrálních předpisů.',
        'postupy': 'Krok za krokem: rajón, volné stanovisko, polygonový pořad, nivelace, GNSS-RTK…',
        'openDictModal': 'Pojmy a zkratky (TB, ZhB, Bpv, ZPMZ…), vlastní pojmy jdou přidat.',
        'pocasi': 'Předpověď pro místo měření z 18 zdrojů, srážkový radar, vítr, tlak v tvé výšce.',
        'slunce': 'Východ, západ, konec soumraku, délka stínu a hodiny, kdy budeš mít slunce v ose záměry.',
        'gnss-forecast': 'Kdy dnes bude nejlepší geometrie družic (PDOP) a jestli nezlobí ionosféra (Kp).',
        'brifink': 'Ranní souhrn na jedné kartě: počasí, světlo, GNSS okna, body po termínu.',
        'kde-je': 'Označ, kde máš bázi, stativ, materiál nebo auto — pak tě tam navede šipka.',
        'kniha-jizd': 'Cesťák navázaný na zakázky, měsíční součty a export CSV pro účetní.',
        'bezpecnost': 'Bouřka, vedro, mráz, vítr, blížící se tma — a poslání vlastní polohy.',
        'checklist': 'Balicí seznam podle typu práce a dnešního počasí; odškrtáváš ráno u auta.',
        'moje-aktivita': 'Kolik jsi ušel a nastoupal, co používáš — a co si z Nástrojů schovat.',
        'rocenka': 'Rok a měsíc v číslech, mapa míst, kde jsi byl, odznaky a série.',
        'denik-dne': 'Co jsi dnes dělal, na které zakázce a jak dlouho — psaný záznam do výkazu.',
        'plakat-dne': 'Týž den jako jeden obrázek (mapa stopy, čísla, počasí) k poslání do skupiny.',
        'ucty-firma': 'Uživatelé, role a oprávnění, přihlašování do firmy.',
        'dochazka': 'Příchod, odchod, hodiny na směně a měsíční přehled.',
        'firma-chat': 'Zprávy kolegům, i když zrovna nejsou v terénu.',
        'vysilacka': 'Kde je kolega teď, rychlé zprávy a hlídání pádu.',
        'prohlidka': 'Co je kolem mě — hranice, sousední parcely, bez zakládání zakázky.',
        'cadastre-vector': 'Vektorové hranice parcel z KN do mapy i do AR; jdou vytyčovat a exportovat.',
        'cadastre-area': 'Bodové pole z oblasti, kterou máš právě na obrazovce.',
        'vektor-mapa': 'Výřez OSM sbalený v kanceláři — kreslí i úplně bez signálu.',
        'balicek-zakazky': 'Mapa, katastr a body kolem ZAKÁZKY (ne kolem tebe) — dělá se na wi-fi před výjezdem.',
        'hodinky-parovani': 'Spárování a body z hodinek do appky a zpátky (Forerunner, fenix, Connect IQ).',
        'job-transfer': 'Předat celou zakázku kolegovi nebo si ji převzít — do druhého telefonu i do kanceláře.',
        // Rozlišení „co je špatně" je tu důležitější než název metody — proto každý
        // popisek začíná situací, ne postupem.
        'ar-calib2': 'Značky jsou posunuté I otočené. Zamiř na dva známé body a srovná se sever i poloha naráz.',
        'orient-point': 'Poloha sedí, ale všechno je pootočené. Zamiř na JEDEN známý bod — opraví se AZIMUT.',
        'sever-slunce': 'Kompas lže (armatura, plot, auto) a není na co zamířit. Sever se dopočítá ze Slunce a času.',
        'ref-calibration': 'Otočení sedí, ale všechno je odsunuté o kus. Stoupni si na známý bod — opraví se POLOHA.',
        'localization-helmert': 'Projekt je v místním systému (staveništní síť). Ze 2+ identických bodů se spočítá transformační klíč.',
        'fov-kalib': 'Značky sedí uprostřed obrazu, ale u krajů utíkají. Změří se skutečný zorný úhel kamery tohohle telefonu.'
    };

    // Nouzová globální funkce, kdyby dlaždice v mřížce (ještě) nebyla — modul může
    // být lazy a klik na rozcestník nesmí spadnout do prázdna.
    var FN = {
        'openSatModal': 'openSatModal', 'openDictModal': 'openDictModal',
        'pocasi': 'agOpenPocasi', 'slunce': 'agOpenSlunce', 'gnss-forecast': 'agOpenGnssForecast',
        'brifink': 'agOpenBrifink', 'kde-je': 'agOpenKdeJe', 'kniha-jizd': 'agOpenKnihaJizd',
        'bezpecnost': 'agOpenBezpecnost', 'checklist': 'agOpenChecklist',
        'moje-aktivita': 'agOpenMojeAktivita', 'rocenka': 'openRocenka',
        'denik-dne': 'agOpenDenikDne', 'plakat-dne': 'agOpenPlakatDne',
        'vysilacka': 'agOpenVysilacka',
        'ar-calib2': 'agOpenCalib2', 'orient-point': 'agOpenOrientTool',
        'sever-slunce': 'agOpenSeverSlunce', 'ref-calibration': 'openRefCalibration',
        'localization-helmert': 'agOpenLocalize', 'fov-kalib': 'agOpenFovKalibrace'
    };

    // Položky rozcestníku ve tvaru, který čeká openHub(). Členství je z registru,
    // pořadí z `hub.poradi` — a to je jen NÁPOVĚDA: co v něm není, přijde nakonec
    // v pořadí registru, takže nový nástroj s `inhub` z rozcestníku nikdy nevypadne.
    function hubItems(hub) {
        var keys = (window.AGReg && AGReg.hubItems) ? AGReg.hubItems(hub.id) : [];
        var por = hub.poradi || [], serazene = [], i, ix;
        for (i = 0; i < por.length; i++) { ix = keys.indexOf(por[i]); if (ix !== -1) serazene.push(keys.splice(ix, 1)[0]); }
        serazene = serazene.concat(keys);
        var out = [];
        for (i = 0; i < serazene.length; i++) {
            var k = serazene[i], r = (window.AGReg && AGReg.get(k)) || {};
            out.push({ key: k, fn: FN[k], t: NAZEV[k] || r.vl || k, s: TXT[k] || r.vh || '' });
        }
        return out;
    }

    // dlaždice skryté bez rozcestníku — vstup mají jinde (viz hlavička souboru)
    var EXTRA_HIDE = ['brutal-gps', 'ar-visual-track', 'hidden-points'];

    // Co všechno se v mřížce schová: položky rozcestníků + `hidden` z registru
    // + EXTRA_HIDE. Počítá se až s registrem (modul je lazy, registr už stojí)
    // a jednou — applySimple() běží každou 1,2 s a průchod 90 záznamy tam nemá co dělat.
    var _hideKeys = null;
    function hideKeys() {
        if (_hideKeys) return _hideKeys;
        if (!window.AGReg || !AGReg.hubItems) return EXTRA_HIDE;   // registr ještě nenaběhl
        var out = EXTRA_HIDE.slice(), i, j, ks;
        for (i = 0; i < HUBS.length; i++) {
            ks = AGReg.hubItems(HUBS[i].id);
            for (j = 0; j < ks.length; j++) out.push(ks[j]);
        }
        ks = AGReg.hiddenKeys ? AGReg.hiddenKeys() : [];
        for (j = 0; j < ks.length; j++) out.push(ks[j]);
        _hideKeys = out;
        return out;
    }

    // ⚠⚠ CO NAHRADIL ROZCESTNÍK, TO V MŘÍŽCE STÁT NESMÍ — ANI SE ZJEDNODUŠENÍM VYPNUTÝM.
    //   Do 3. 9. 2026 se položky rozcestníků skrývaly jen při zapnutém přepínači
    //   „Zjednodušené Nástroje". Kdo ho měl vypnutý, viděl v mřížce OBOJE: rozcestník
    //   „Počasí a světlo" A vedle něj pořád Počasí, Slunce, GNSS předpověď i Dnešek —
    //   tedy přesný opak toho, proč se nástroje slučovaly. Hlášeno z terénu:
    //   „některé nástroje jsou sjednocené do jednoho a zůstaly tam i ty původní".
    //   Vypnuté zjednodušení znamená „ukaž mi i to ostatní", ne „ukaž mi totéž dvakrát".
    //   Totéž platí pro `hidden: 1` (Hlasové poznámky, Podzemní sítě) — ty se schovaly
    //   na přání uživatele a vypínač vzhledu je vracet nemá.
    //   Cesta k nim zůstává: rozcestník, hledání (najde je vždycky) a „Pro tuto práci".
    var _vzdyPryc = null;
    function vzdyPryc() {
        if (_vzdyPryc) return _vzdyPryc;
        if (!window.AGReg || !AGReg.hubItems) return null;         // registr ještě nenaběhl
        var out = [], i, j, ks;
        for (i = 0; i < HUBS.length; i++) {
            ks = AGReg.hubItems(HUBS[i].id);
            for (j = 0; j < ks.length; j++) out.push(ks[j]);
        }
        ks = AGReg.hiddenKeys ? AGReg.hiddenKeys() : [];
        for (j = 0; j < ks.length; j++) out.push(ks[j]);
        _vzdyPryc = out;
        return out;
    }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function simpleOn() { try { return localStorage.getItem(SIMPLE_KEY) !== '0'; } catch (e) { return true; } }
    function getGrid() { var m = document.getElementById('tools-modal'); return m ? m.querySelector('.tool-grid') : null; }
    function closeTools() { var m = document.getElementById('tools-modal'); if (m) m.style.display = 'none'; }

    // klíč dlaždice — stejná logika jako usadit-ar.js / tools-plus.js
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool'); if (dt) return dt;
        var oc = tile.getAttribute('onclick') || '';
        var hk = hideKeys();
        for (var i = 0; i < hk.length; i++) { if (oc.indexOf(hk[i]) !== -1) return hk[i]; }
        var ms = oc.match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function findTile(key) {
        var grid = getGrid(); if (!grid) return null;
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) { if (tileKey(tiles[i]) === key) return tiles[i]; }
        return null;
    }
    // spuštění nástroje = klik na jeho (klidně skrytou) dlaždici; nouzově globál
    function runTool(key, fallbackFn) {
        var t = findTile(key);
        closeModal();
        if (t) { t.click(); return true; }
        if (fallbackFn && typeof window[fallbackFn] === 'function') { closeTools(); try { window[fallbackFn](); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'tools-hub:runTool'); } return true; }
        return false;
    }

    // ---- styly (vzhled shodný s průvodcem Usadit AR) -----------------------------
    function injectStyles() {
        if (document.getElementById('ag-th-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-th-style';
        st.textContent = [
            '#ag-th-ov{position:fixed;inset:0;z-index:1000055;display:none;align-items:center;justify-content:center;background:rgba(4,8,12,0.62);}',
            '#ag-th-ov.open{display:flex;}',
            '#ag-th-card{width:min(94vw,440px);max-height:86vh;overflow:auto;padding:20px;border-radius:18px;',
            '  background:var(--glass-bg,rgba(14,18,24,0.97));border:1px solid var(--glass-border-strong,rgba(255,255,255,0.16));color:var(--text-color,#eceef2);}',
            '#ag-th-card h3{margin:0 0 6px;color:var(--accent,#2f9e74);font-size:calc(17px * var(--ag-font-scale, 1));display:flex;align-items:center;gap:8px;}',
            '#ag-th-card h3 svg{width:20px;height:20px;}',
            '#ag-th-sub{margin:0 0 14px;font-size:calc(13px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);line-height:1.45;}',
            '.ag-th-opt{display:block;width:100%;text-align:left;margin-bottom:8px;padding:13px 14px;border-radius:14px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--surface-1,rgba(255,255,255,0.05));color:inherit;cursor:pointer;}',
            '.ag-th-opt b{display:block;font-size:calc(14.5px * var(--ag-font-scale, 1));margin-bottom:2px;}',
            '.ag-th-opt small{display:block;font-size:calc(12.5px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);line-height:1.4;}',
            '.ag-th-opt:active{background:var(--accent-soft,rgba(47,158,116,0.15));border-color:var(--accent-line,rgba(47,158,116,0.4));}',
            '#ag-th-close{width:100%;margin-top:4px;padding:11px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:transparent;color:var(--text-muted,#9aa1ac);font-weight:600;cursor:pointer;}',
            'body.ag-glove .ag-th-opt{padding:16px;}',
            'body.outdoor-mode #ag-th-card{background:#0a0e1a;}',
            'body.light-mode.outdoor-mode #ag-th-card{background:#fff;}',

            // --- strop bloku „⚡ Teď se hodí" (chipy nad limit se jen schovají) ---
            '#ag-ua-now .ag-ua-chip.ag-th-ovf{display:none;}',
            '#ag-ua-now.ag-th-open .ag-ua-chip.ag-th-ovf{display:inline-flex;}',
            '#ag-ua-now .ag-th-more{border-style:dashed;color:var(--text-muted,#9aa1ac);}',

            // --- jednotný rastr mřížky Nástrojů (méně vizuálního šumu) ---
            // Selektory mají navíc #tools-modal .tool-grid, aby přebily jak style.css,
            // tak pozdější <style> z field-tools.js — jinak by o vzhledu rozhodovalo
            // náhodné pořadí načtení skriptů.
            '#tools-modal .tool-grid{gap:8px;}',
            '#tools-modal .tool-grid .tool-tile{min-height:84px;padding:14px 6px;gap:7px;',
            '  font-size:calc(12px * var(--ag-font-scale, 1));line-height:1.2;}',
            '#tools-modal .tool-grid .tool-tile svg,#tools-modal .tool-grid .tool-tile .icon{width:23px;height:23px;}',
            '#tools-modal .tool-grid .tool-cat,#tools-modal .tool-grid .ag-ft-head{',
            '  margin:12px 2px 2px;padding-top:9px;}',
            '#tools-modal .tool-grid > .tool-cat:first-child,#tools-modal .tool-grid > .ag-ft-head:first-child{',
            '  margin-top:0;padding-top:0;border-top:none;}',
            // v rukavicích zůstávají dlaždice velké (jinak by je tenhle blok zmenšil)
            'body.ag-glove #tools-modal .tool-grid .tool-tile{min-height:96px;padding:16px 6px;font-size:calc(13px * var(--ag-font-scale, 1));}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- rozcestníkový modál ------------------------------------------------------
    function ensureModal() {
        var m = document.getElementById('ag-th-ov');
        if (!m) {
            m = document.createElement('div'); m.id = 'ag-th-ov';
            m.innerHTML = '<div id="ag-th-card"><h3></h3><p id="ag-th-sub"></p><div id="ag-th-body"></div>'
                + '<button type="button" id="ag-th-close">Zavřít</button></div>';
            m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
            document.body.appendChild(m);
            m.querySelector('#ag-th-close').addEventListener('click', closeModal);
        }
        return m;
    }
    function closeModal() { var m = document.getElementById('ag-th-ov'); if (m) m.classList.remove('open'); }
    function openHub(hub) {
        injectStyles();
        var m = ensureModal();
        m.querySelector('h3').innerHTML = hub.icon + ' ' + esc(hub.title);
        m.querySelector('#ag-th-sub').innerHTML = hub.sub;
        var body = m.querySelector('#ag-th-body');
        body.innerHTML = '';
        hubItems(hub).forEach(function (it) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'ag-th-opt';
            b.innerHTML = '<b>' + esc(it.t) + '</b>' + (it.s ? '<small>' + esc(it.s) + '</small>' : '');
            b.addEventListener('click', function () { runTool(it.key, it.fn); });
            body.appendChild(b);
        });
        m.classList.add('open');
    }

    // ---- skrývání sloučených dlaždic (stejné chování jako usadit-ar.js) ------------
    function searchQuery() {
        var inp = document.getElementById('tools-search');
        return inp ? (inp.value || '').trim() : '';
    }
    function applySimple() {
        var grid = getGrid(); if (!grid) return;
        // integrace s tools-simple.js: „Zobrazit všechny nástroje" (.ag-sm-all) ruší i naše skrývání
        var showAll = grid.classList.contains('ag-sm-all');
        // BATERIE: searchQuery() (getElementById + čtení value) se dřív volalo i UVNITŘ
        // smyčky přes všechny dlaždice — tick běží po 1,2 s, takže to byl zbytečný
        // průchod DOMem na každou dlaždici. Hodnota se během jednoho průchodu nemění.
        var q = searchQuery();
        var on = simpleOn() && !q && !showAll;
        var hk = hideKeys();
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) {
            if (tiles[i].classList.contains('ag-th-tile')) continue;   // vlastní rozcestníky neskrývat
            // Dlaždici, kterou si uživatel schoval sám v „Moje aktivita" (js/moje-aktivita.js
            // ji značí data-ag-hidden), tady NESMÍME odkrýt zpátky — jinak by se oba moduly
            // v ticku přetahovaly a dlaždice by problikávala.
            if (tiles[i].hasAttribute('data-ag-hidden')) continue;
            // co zakázala role (js/ucty.js), do toho tenhle modul nesahá vůbec
            if (tiles[i].hasAttribute('data-agucty')) continue;
            var k = tileKey(tiles[i]);
            if (k && hk.indexOf(k) !== -1) {
                // dlaždice v sekci „Pro tuto práci" (tools-simple.js) se neskrývá
                if (tiles[i].getAttribute('data-ag-ts')) { if (tiles[i].style.display === 'none') tiles[i].style.display = ''; continue; }
                // Položka rozcestníku / `hidden` — v klidové mřížce pryč vždycky (viz
                // vzdyPryc() výš). PŘI HLEDÁNÍ SE JI TENHLE MODUL NESMÍ POKOUŠET
                // UKÁZAT: o tom, co dotazu odpovídá, rozhoduje filtr ve field-tools.js
                // (a ten sám nechává skryté to, co zakázala role — data-agucty).
                // Když se to tady „pomáhalo" nastavením display:'', ukázaly se při
                // hledání i dlaždice zakázané rolí a na nesmyslný dotaz vyskákaly
                // všechny položky rozcestníků.
                var vzdy = vzdyPryc();
                if (vzdy && vzdy.indexOf(k) !== -1 && !showAll) {
                    if (!q) tiles[i].style.display = 'none';
                    continue;
                }
                if (on) tiles[i].style.display = 'none';
                else if (tiles[i].style.display === 'none' && !q) tiles[i].style.display = '';
            }
        }
    }
    // po každém průchodu vyhledávání znovu prosadit skrytí (field-tools přepisuje display)
    function wrapFilter() {
        if (window.__agThWrapped || typeof window.agFilterTools !== 'function') return;
        var orig = window.agFilterTools;
        window.agFilterTools = function (v) { var r = orig.apply(this, arguments); try { applySimple(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'tools-hub:agFilterTools'); } return r; };
        window.__agThWrapped = true;
    }

    // ---- „⚡ Teď se hodí": strop na NOW_MAX návrhů --------------------------------
    // PROČ ZROVNA 4: blok je vodorovný řádek chipů úplně nahoře v Nástrojích a má se
    // číst na JEDEN pohled — v rukavicích, na slunci, často jednou rukou. Pátý a další
    // chip se zalomí na třetí řádek, odtlačí zbytek mřížky pod okraj displeje a
    // „doporučení" se změní v další seznam, který musí geodet přečíst. Čtyři se vejdou
    // na dva řádky i na úzkém iPhonu a pořád je to volba, ne výčet.
    // Nic se nesmí ZTRATIT POTICHU: co je nad limit, schová se pod „další (N)" a jedním
    // ťuknutím se rozbalí. (Zdroj návrhů — usadit-ar.js — dnes sám vrací nejvýš 4;
    // tohle je pojistka, aby strop platil i až kandidátů přibude.)
    var NOW_MAX = 4;
    function nowMoreLabel(box) {
        var m = box.querySelector('.ag-th-more'); if (!m) return;
        if (box.classList.contains('ag-th-open')) { m.textContent = 'méně'; return; }
        m.textContent = 'další (' + box.querySelectorAll('.ag-ua-chip.ag-th-ovf').length + ')';
    }
    function capNow() {
        var box = document.getElementById('ag-ua-now'); if (!box) return;
        var chips = box.querySelectorAll('.ag-ua-chip:not(.ag-th-more)');
        var more = box.querySelector('.ag-th-more');
        var i;
        if (chips.length <= NOW_MAX) {
            for (i = 0; i < chips.length; i++) chips[i].classList.remove('ag-th-ovf');
            box.classList.remove('ag-th-open');
            if (more) more.parentNode.removeChild(more);
            return;
        }
        for (i = 0; i < chips.length; i++) chips[i].classList.toggle('ag-th-ovf', i >= NOW_MAX);
        if (!more) {
            more = document.createElement('button');
            more.type = 'button';
            more.className = 'ag-ua-chip ag-th-more';
            more.addEventListener('click', function () {
                box.classList.toggle('ag-th-open');
                nowMoreLabel(box);
            });
        }
        // usadit-ar.js si blok při změně sady překreslí (innerHTML = ''), takže
        // tlačítko musíme umět kdykoli vrátit — a vždy na konec řádku
        if (box.lastChild !== more) box.appendChild(more);
        nowMoreLabel(box);
    }

    // ---- život modulu ---------------------------------------------------------------
    function tick() {
        try { injectStyles(); wrapFilter(); applySimple(); capNow(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'tools-hub:tick'); }
    }
    function init() {
        injectStyles();
        if (typeof window.agRegisterFieldTool === 'function') {
            HUBS.forEach(function (h) {
                window.agRegisterFieldTool({
                    id: h.id, label: h.label.replace(/<br>/g, ' '), icon: h.icon, cat: h.cat, order: h.order,
                    onClick: function () { openHub(h); }
                });
            });
        }
        if (!window.__agThTimer) window.__agThTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1200);
        tick();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    // ruční otevření (app-search, konzole)
    window.agOpenHub = function (id) { var h = null; HUBS.forEach(function (x) { if (x.id === id) h = x; }); if (h) openHub(h); };
})();
