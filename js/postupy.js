// ===== AR Geodet — POSTUPY MĚŘENÍ (ODPOJITELNÁ vrstva) ==========================
// Terénní tahák „jak na to" pro běžné geodetické metody: rajón, volné stanovisko,
// tachymetrie, polygonový pořad, technická nivelace, GNSS-RTK, protínání, vytyčení.
// Kroky vychází z oficiálních postupů (Návod pro obnovu katastrálního operátu
// a převod ČÚZK, katastrální vyhláška č. 357/2013 Sb., vyhláška č. 31/1995 Sb.).
// Číselné meze jsou uvedené VČETNĚ zdroje; před použitím v elaborátu vždy ověř
// aktuální znění předpisu (tahák se nemusí krýt s poslední novelou).
//
// Kroky jde odškrtávat (jen pro přehled v terénu, nikam se neukládá).
// NEEDITUJE logika.js ani grafika.js. Odstranění: smaž js/postupy.js + řádek
// <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><polyline points="9 7 11 9 15 5"/><line x1="9" y1="13" x2="15" y2="13"/></svg>';

    // ---- data: postupy --------------------------------------------------------------
    // t = název, kdy = k čemu slouží, kroky = pracovní postup, limity = meze se zdrojem,
    // pozn = doplňující poznámka. HTML povoleno (obsah je vlastní, ne uživatelský).
    var POSTUPY = [
        {
            id: 'rajon', t: 'Rajón (pomocný měřický bod)',
            kdy: 'Rychlé určení pomocného stanoviska tam, kde není použitelný bod bodového pole: ze známého bodu se změří směr a délka na nový bod.',
            kroky: [
                'Postav přístroj na známý bod (stanovisko) a zcentruj + urovnej.',
                'Orientuj na NEJMÉNĚ 2 známé body — druhý slouží jako kontrola orientace; přednostně orientuj na vzdálenější bod.',
                'Změř vodorovný směr a délku na nový bod (délku tam i zpět, směr ideálně ve dvou polohách dalekohledu).',
                'Spočítej souřadnice polární metodou (směrník z orientace + měřený úhel, redukovaná délka).',
                'Kontrola: porovnej směr na druhou orientaci (odchylka orientace), případně urči bod podruhé nezávisle.'
            ],
            limity: [
                'Délka rajónu nejvýše <b>1 000 m</b> (Návod pro obnovu katastrálního operátu a převod, ČÚZK — pomocné měřické body).',
                'Délka rajónu nemá výrazně přesáhnout vzdálenost k orientacím; řetězení volných rajónů omez na minimum (přesné podmínky viz Návod, kap. o pomocných bodech).',
                'Pomocný bod pro katastr: souřadnice s kódem kvality dle dosažené mxy (kód 3 = mxy ≤ 0,14 m, vyhl. č. 357/2013 Sb., příl. 13).'
            ],
            pozn: 'V appce: nový bod ulož přes „Nový bod" a délku/směr si ověř nástrojem Kalkulačka (rajón) nebo Oměrné.'
        },
        {
            id: 'volne-stanovisko', t: 'Volné stanovisko',
            kdy: 'Přístroj postavíš KDEKOLI s výhledem na známé body — poloha stanoviska se dopočítá z měření na ně (protínání zpět / transformace). Nejpoužívanější metoda s totální stanicí.',
            kroky: [
                'Vyber místo s dobrou viditelností na nejméně 2, raději 3 a více známých bodů (a na měřenou situaci).',
                'Změř vodorovné směry A DÉLKY na známé body (délka + směr = robustnější výpočet než jen úhly).',
                'Nech přístroj/appku dopočítat polohu stanoviska (Helmertova transformace / vyrovnání MNČ).',
                'Zkontroluj opravy na připojovacích bodech (residua) — velká oprava = chybný bod nebo záměna čísla.',
                'Kontrola: změř směr+délku na další známý bod, který do výpočtu nevstoupil.'
            ],
            limity: [
                'Známé body voleny OKOLO stanoviska (ne všechny v jednom směru); určované body nemají ležet daleko vně obrazce připojovacích bodů.',
                'Opravy (residua) na připojovacích bodech drž v mezích odpovídajících třídě přesnosti — pro katastr kód 3: mxy ≤ 0,14 m (vyhl. č. 357/2013 Sb., příl. 13).'
            ],
            pozn: 'V appce: obdobou je „AR resekce" (poloha ze záměr na známé body) — orientační, bez přesnosti totální stanice.'
        },
        {
            id: 'tachymetrie', t: 'Tachymetrie / polární metoda (podrobné měření)',
            kdy: 'Hromadné zaměření podrobných bodů (polohopis + výškopis): z každého stanoviska se měří vodorovný směr, svislý úhel a délka na jednotlivé body.',
            kroky: [
                'Připrav stanovisko: známý bod, rajón nebo volné stanovisko; změř výšku přístroje.',
                'Orientuj na nejméně 2 známé body; zapiš čtení orientací.',
                'Měř podrobné body: směr Hz, zenitový úhel, šikmá délka, výška cíle (výtyčky) — a veď náčrt s čísly bodů.',
                'Průběžně dělej kontrolní oměrné (pásmem) mezi charakteristickými body.',
                'Na konci práce na stanovisku ZNOVU zacíl orientaci — ověření, že se přístroj nepohnul.',
                'Kancelář: výpočet souřadnic, porovnání oměrných, doplnění náčrtu.'
            ],
            limity: [
                'Katastr — kód kvality dle souřadnicové střední chyby mxy: <b>kód 3 ≤ 0,14 m</b>, kód 4 ≤ 0,26 m, kód 5 ≤ 0,50 m (vyhl. č. 357/2013 Sb., příl. 13).',
                'Rozdíl kontrolní oměrné vs. délky ze souřadnic drž v mezní odchylce délky dle přílohy 13 katastrální vyhlášky (závisí na velikosti délky).',
                'Orientace na konci stanoviska se nesmí od začátku lišit nad mez pro daný přístroj/třídu (typicky jednotky mgon).'
            ],
            pozn: 'V appce: náčrt vedeš nástrojem „Náčrt / Tachymetrie", oměrné hlídá nástroj „Oměrné / kontrola".'
        },
        {
            id: 'polygon', t: 'Polygonový pořad',
            kdy: 'Určení řady nových (pomocných) bodů mezi známými body: měří se vrcholové úhly a délky stran. Dnes hlavně pro pomocné body v zastavěném/zalesněném území, kde nejde GNSS.',
            kroky: [
                'Navrhni pořad: začátek i konec na známých bodech s orientací (oboustranně připojený a orientovaný pořad = standard).',
                'Strany volit pokud možno stejně dlouhé, bez extrémně krátkých stran.',
                'Na každém vrcholu měř levostranný vrcholový úhel ve DVOU polohách dalekohledu.',
                'Délky stran měř OBOUSMĚRNĚ (tam i zpět).',
                'Výpočet: úhlový uzávěr → rozdělení, souřadnicový uzávěr → vyrovnání; zkontroluj obě odchylky proti mezím.',
                'Nevejde-li se uzávěr do meze: hledej hrubou chybu (záměna bodu, špatná výška cíle, chybný zápis).'
            ],
            limity: [
                'Mezní odchylky uzávěrů a největší/nejmenší délky stran předepisuje Návod pro obnovu katastrálního operátu a převod (pomocné měřické body) — před měřením si je vypiš pro svou délku pořadu.',
                'Volný (jednostranně připojený) pořad jen výjimečně a krátký — vždy s kontrolou koncového bodu jiným způsobem.'
            ],
            pozn: 'V appce: zápis úhlů a délek veď v Zápisníku (vodorovné směry) a souřadnice počítej Kalkulačkou (polární metoda / dávkou v kanceláři).'
        },
        {
            id: 'nivelace', t: 'Technická nivelace (TN)',
            kdy: 'Určení převýšení/výšek geometrickou nivelací ze středu: přístroj mezi latěmi, čtení zpět (na bod se známou výškou) a vpřed (na určovaný bod).',
            kroky: [
                'Před pořadem ověř přístroj (zkouška nivelačního přístroje — kontrola sklonu záměrné přímky, „zkouška ze středu").',
                'Postav přístroj PŘIBLIŽNĚ DOPROSTŘED mezi latě — délky záměr zpět a vpřed co nejshodnější (eliminace chyby záměrné přímky).',
                'Čti lať: zpět (z) na výchozí bod, vpřed (p) na přestavový bod; převýšení sestavy h = z − p.',
                'Přestavové body volit pevně (podložka/hřeb), lať držet svisle (krabicová libela).',
                'Pořad VŽDY uzavři: buď na druhý známý výškový bod, nebo měř tam a zpět.',
                'Porovnej uzávěr s mezní odchylkou; při překročení měř znovu.'
            ],
            limity: [
                'Mezní odchylka TN (běžná praxe, ČSN/skripta): <b>Δ = 40·√R mm</b>, kde R je délka pořadu v km (tam a zpět, resp. mezi známými body).',
                'Délka záměry u TN zpravidla do ~80–120 m dle přístroje a viditelnosti; kratší záměry = přesnější čtení.',
                'Výšky v katastru a stavební praxi ČR = systém <b>Bpv</b>; nezaměň s elipsoidickou výškou z GNSS (rozdíl ~44–47 m, řeší undulace).'
            ],
            pozn: 'V appce: čtení zapisuj do Zápisníku (nivelace) — převýšení, průběžné výšky i uzávěr se počítají samy.'
        },
        {
            id: 'gnss-rtk', t: 'GNSS-RTK měření (katastr)',
            kdy: 'Určení bodů aparaturou GNSS s korekcemi v reálném čase (CZEPOS aj.). Pro katastr platí technologické požadavky vyhlášky č. 31/1995 Sb. (příloha 9).',
            kroky: [
                'Zkontroluj podmínky: volný obzor, PDOP, počet družic, fixní řešení (FIX, ne FLOAT).',
                'Centruj a urovnej výtyčku na bodě, změř výšku antény.',
                'Bod zaměř s dostatečnou observací (dle aparatury; ne jediná epocha).',
                'Bod urči PODRUHÉ NEZÁVISLE: s časovým odstupem (změna konstelace družic) a novou inicializací.',
                'Porovnej obě určení; výsledek = průměr. Rozdíl nad mez = měř potřetí / hledej chybu (multipath!).',
                'Kontrola připojení: zaměř known-point (bod se známými souřadnicemi) — ověří celou technologii.'
            ],
            limity: [
                'Opakované určení s odstupem — u RTK se běžně požaduje interval alespoň <b>1 hodina</b> mezi nezávislými měřeními (vyhl. č. 31/1995 Sb., příl. 9 — ověř aktuální znění pro svou technologii).',
                'Hodnota <b>PDOP při měření nemá překročit 7,0</b> (tamtéž).',
                'Vyhýbej se měření u zdí, aut, pod stromy — multipath dělá chyby, které průměrování neodhalí.'
            ],
            pozn: 'V appce: kvalitu GNSS hlídá panel GPS + QC inspektor; telefon ale NENÍ geodetická aparatura — RTK přesnost nečekej.'
        },
        {
            id: 'protinani', t: 'Protínání vpřed / zpět',
            kdy: 'Protínání VPŘED: neznámý bod se určí záměrami ze dvou známých bodů. Protínání ZPĚT: vlastní poloha ze záměr na tři známé body. Klasické metody bez měření délek.',
            kroky: [
                'Vpřed: na obou známých bodech změř vodorovný úhel mezi druhým známým bodem a bodem určovaným.',
                'Vpřed: souřadnice vyjdou z průsečíku směrů; třetí záměra z dalšího bodu = kontrola.',
                'Zpět: na neznámém stanovisku změř směry na TŘI známé body (čtvrtý jako kontrola).',
                'Zpět: pozor na „nebezpečnou kružnici" — stanovisko nesmí ležet blízko kružnice procházející třemi známými body (řešení je pak neurčité).',
                'Vždy proveď kontrolu nezávislým prvkem (další záměra, oměrná, GNSS).'
            ],
            limity: [
                'Úhel protnutí směrů drž v rozumném rozmezí — zpravidla <b>30 až 170 gon</b>; ostřejší/tupější protnutí degraduje přesnost (učebnicová zásada).',
                'U protínání zpět nikdy nevynech kontrolní čtvrtou záměru.'
            ],
            pozn: 'V appce: „Protínání vpřed" a „AR resekce" dělají totéž orientačně z kompasu telefonu (víc záměr = vyrovnání MNČ).'
        },
        {
            id: 'vytyceni', t: 'Vytyčení hranice pozemku',
            kdy: 'Přenesení hranice z katastru do terénu. Zeměměřická činnost s předepsaným postupem a dokumentací (vyhl. č. 357/2013 Sb., § 87–90).',
            kroky: [
                'Podklady: údaje katastru (souřadnice lomových bodů, kód kvality, ZPMZ/GP v místě).',
                'Zvol vytyčovací síť/stanoviska (bodové pole, pomocné body, GNSS).',
                'Vytyč lomové body hranice; označ je předepsaným způsobem (mezník, hřeb, plast. znak…).',
                'KONTROLA: oměrné mezi vytyčenými body vs. hodnoty ze souřadnic; případně kontrolní zaměření.',
                'Přizvi vlastníky dotčených pozemků k seznámení s průběhem vytyčené hranice.',
                'Vyhotov vytyčovací náčrt + protokol o vytyčení a předej je (kopie i katastrálnímu pracovišti přes dokumentaci).'
            ],
            limity: [
                'Přesnost vytyčení odpovídá kódu kvality vytyčovaných bodů — u kódu 3 pracuj v režimu mxy ≤ 0,14 m (vyhl. č. 357/2013 Sb., příl. 13).',
                'Vytyčení ověřuje ÚOZI; bez ověření nemá listinné účinky.'
            ],
            pozn: 'V appce: „Vytyčovací checklist" tě navede na body a pohlídá odškrtání + foto; oměrné zkontroluje nástroj „Oměrné / kontrola".'
        },
        {
            id: 'gps-mobil', t: 'Přesnější GPS jen mobilem (sada nástrojů)',
            kdy: 'Když není k dispozici rover ani totálka a bod je potřeba určit co nejpřesněji holým telefonem — pomocné a orientační body, dohledávání, práce „na první přiblížení". Kombinuje nástroje appky: Skóre místa, Brutální GPS (+ kampaň), Dvoutelefonní DGPS a Krokový offset.',
            kroky: [
                'PŘED měřením otevři „Skóre místa (GPS)": vyber okolí (volné nebe / stromy / budovy) a řiď se semaforem — červená = posuň se od fasád (aspoň 3–5 m, radši 15 m) nebo počkej na lepší konstelaci.',
                'Bod měř nástrojem „Brutální GPS": telefon na plocho na bod, zvol dobu (min. 5–10 min) a nech ležet; ve ¼, ½ a ¾ času otoč telefon o 90° po směru hodin, jak appka vyzve.',
                'Výsledek přidej jako SEZENÍ (ne rovnou uložit) a klepni „Kdy se vrátit?" — appka poradí čas s jinou geometrií družic pro druhé sezení.',
                'Pro nejvyšší nárok naplánuj kartou dole KAMPAŇ „3 návštěvy": tři sezení v různých konstelacích, appka je připomene a spojí inverzně-variančním průměrem.',
                'Máš-li druhý telefon: polož ho jako DGPS ZÁKLADNU na spolehlivě známý bod (import S-JTSK) po celou dobu měření; po práci přenes soubor korekcí a v režimu „Korekce" body zpětně oprav.',
                'Rohy budov a místa bez oblohy neměř GPS vůbec: dobře změř blízký volný bod a cíl urči „Krokovým offsetem" (nebo Offsetem s pásmem).'
            ],
            limity: [
                'Mobilní GNSS má systematickou chybu, kterou jedno průměrování neodstraní — reálné minimum je ~±0,2 m i při dlouhém měření; odhad ± u bodu je poctivý, centimetrům nevěř.',
                'Mezi sezeními re-okupace/kampaně drž odstup ALESPOŇ ~1 hodinu (jiná konstelace družic) — stejná zásada jako u opakovaného určení RTK (vyhl. č. 31/1995 Sb., příl. 9, analogicky).',
                'DGPS korekce platí jen do ~2–3 km od základny a jen pro body měřené v době jejího běhu; základna nesmí ležet na bodu měřeném mobilem.',
                'Výsledky NEJSOU určení pro katastr (kód 3 vyžaduje mxy ≤ 0,14 m, vyhl. č. 357/2013 Sb., příl. 13) — telefon nenahradí geodetickou aparaturu.'
            ],
            pozn: 'Nástroje najdeš v Nástroje → Měření. Kvalitu ohlídá i QC inspektor (kód kvality po měření); výšky z GPS jsou elipsoidické → Bpv řeší appka undulací, ale ber je jen orientačně.'
        }
    ];

    // ---- UI ---------------------------------------------------------------------------
    var STYLE_ID = 'ag-pm-style';
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-pm-ov{position:fixed;inset:0;z-index:1000040;display:none;flex-direction:column;background:var(--bg-color,#0f1216);color:var(--text-color,#eceef2);}',
            '#ag-pm-ov.open{display:flex;}',
            '#ag-pm-head{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px 12px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.12));}',
            '#ag-pm-head h2{margin:0;font-size:17px;flex:1;color:var(--accent,#2f9e74);}',
            '#ag-pm-head button{border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:transparent;color:inherit;border-radius:99px;padding:8px 14px;font-weight:600;cursor:pointer;}',
            '#ag-pm-body{flex:1 1 auto;overflow:auto;padding:14px 16px calc(env(safe-area-inset-bottom,0px) + 20px);-webkit-overflow-scrolling:touch;}',
            '.ag-pm-item{display:block;width:100%;text-align:left;margin-bottom:10px;padding:14px;border-radius:14px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:rgba(255,255,255,0.04);color:inherit;cursor:pointer;}',
            '.ag-pm-item b{display:block;font-size:15px;color:var(--accent,#2f9e74);margin-bottom:4px;}',
            '.ag-pm-item span{font-size:12.5px;line-height:1.45;color:var(--text-muted,#9aa1ac);}',
            '.ag-pm-sec{margin:16px 2px 6px;font:700 11px/1 var(--font-display,system-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.ag-pm-step{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;margin-bottom:8px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.1));background:rgba(255,255,255,0.03);font-size:13.5px;line-height:1.5;cursor:pointer;}',
            '.ag-pm-step input{margin-top:2px;flex:0 0 auto;width:18px;height:18px;accent-color:var(--accent,#2f9e74);}',
            '.ag-pm-step.done{opacity:0.55;text-decoration:line-through;}',
            '.ag-pm-lim{padding:10px 12px;margin-bottom:8px;border-left:3px solid var(--warning,#fbbf24);border-radius:8px;background:rgba(251,191,36,0.08);font-size:13px;line-height:1.5;}',
            '.ag-pm-note{padding:10px 12px;border-left:3px solid var(--accent,#2f9e74);border-radius:8px;background:var(--accent-soft,rgba(47,158,116,0.08));font-size:13px;line-height:1.5;}',
            '.ag-pm-foot{margin-top:16px;font-size:11.5px;line-height:1.5;color:var(--text-muted,#9aa1ac);}',
            'body.outdoor-mode #ag-pm-ov{background:#000;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    var _ov = null;
    function ensureOverlay() {
        if (_ov && _ov.isConnected) return _ov;
        injectStyles();
        _ov = document.createElement('div');
        _ov.id = 'ag-pm-ov';
        _ov.innerHTML = '<div id="ag-pm-head"><h2 id="ag-pm-title">Postupy měření</h2><button type="button" id="ag-pm-back">Zavřít</button></div><div id="ag-pm-body"></div>';
        document.body.appendChild(_ov);
        _ov.querySelector('#ag-pm-back').addEventListener('click', function () {
            if (_view === 'detail') renderList(); else close();
        });
        return _ov;
    }

    var _view = 'list';
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function renderList() {
        var ov = ensureOverlay();
        _view = 'list';
        ov.querySelector('#ag-pm-title').textContent = 'Postupy měření';
        ov.querySelector('#ag-pm-back').textContent = 'Zavřít';
        var b = ov.querySelector('#ag-pm-body');
        var h = '<p style="font-size:12.5px;color:var(--text-muted,#9aa1ac);line-height:1.5;margin:2px 2px 12px;">Krok za krokem podle oficiálních postupů (Návod pro obnovu KO, katastrální vyhláška, vyhláška o zeměměřictví). Klepni na metodu.</p>';
        POSTUPY.forEach(function (p) {
            h += '<button type="button" class="ag-pm-item" data-id="' + p.id + '"><b>' + esc(p.t) + '</b><span>' + esc(p.kdy) + '</span></button>';
        });
        b.innerHTML = h;
        b.scrollTop = 0;
        b.querySelectorAll('.ag-pm-item').forEach(function (el) {
            el.addEventListener('click', function () { renderDetail(el.getAttribute('data-id')); });
        });
    }

    function renderDetail(id) {
        var p = null;
        for (var i = 0; i < POSTUPY.length; i++) if (POSTUPY[i].id === id) p = POSTUPY[i];
        if (!p) return;
        var ov = ensureOverlay();
        _view = 'detail';
        ov.querySelector('#ag-pm-title').textContent = p.t;
        ov.querySelector('#ag-pm-back').textContent = '‹ Zpět';
        var b = ov.querySelector('#ag-pm-body');
        var h = '<p style="font-size:13px;line-height:1.55;color:var(--text-muted,#9aa1ac);margin:2px 2px 8px;">' + esc(p.kdy) + '</p>';
        h += '<div class="ag-pm-sec">Postup (odškrtávej)</div>';
        p.kroky.forEach(function (k, i) {
            h += '<label class="ag-pm-step"><input type="checkbox" data-step="' + i + '"><span>' + esc(k) + '</span></label>';
        });
        h += '<div class="ag-pm-sec">Meze a předpisy</div>';
        p.limity.forEach(function (l) { h += '<div class="ag-pm-lim">' + l + '</div>'; });
        if (p.pozn) { h += '<div class="ag-pm-sec">Tip v aplikaci</div><div class="ag-pm-note">' + esc(p.pozn) + '</div>'; }
        h += '<div class="ag-pm-foot">Tahák pro terén — před odevzdáním elaborátu vždy ověř aktuální znění předpisu (novely mění meze i postupy). Odškrtnutí kroků se nikam neukládá.</div>';
        b.innerHTML = h;
        b.scrollTop = 0;
        b.querySelectorAll('.ag-pm-step input').forEach(function (cb) {
            cb.addEventListener('change', function () { cb.closest('.ag-pm-step').classList.toggle('done', cb.checked); });
        });
    }

    function open() { ensureOverlay(); renderList(); _ov.classList.add('open'); }
    function close() { if (_ov) _ov.classList.remove('open'); }
    window.agOpenPostupy = open;

    // ---- registrace dlaždice ------------------------------------------------------------
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'postupy', label: 'Postupy měření', icon: ICON, onClick: open, order: 3 });
        } else {
            setTimeout(register, 700);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
})();
