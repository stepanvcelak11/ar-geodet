/* MASKOT TOTI — totální stanice, která provází učením (24. 9. 2026)
 *
 * Na přání: „jak má Duolingo vlastního maskota, tak vytvořit vlastního maskota k učení
 * (kartičky a tak) — třeba totální stanice, která hýbe dalekohledem, otáčí se, bliká
 * laserem, … a dej mi možnost nahrát soubor s hláškami, co by měla říkat v bublině“.
 *
 * CO TO JE:
 *   • Kreslená totálka na stativu (SVG): displej s očima, dalekohled se naklání, laser
 *     bliká a „měří“ bublinu, při správné odpovědi vyskočí a otočí se, při chybě svěsí
 *     dalekohled. Mrká. Klepnutí = další rada.
 *   • Bublina s hláškou (píše se po písmenech). Hlášky jsou po kategoriích (uvod,
 *     spravne, spatne, serie, konec_super/dobre/slabe, tip, klepnuti) a jazycích.
 *   • VLASTNÍ HLÁŠKY: tlačítko ⋯ u maskota → nahrát .txt nebo .json (vzor se dá stáhnout),
 *     jméno maskota, „jen moje hlášky“, ztlumit. Uloženo v localStorage (agMaskot_v1).
 *
 * KDE: Poznávačka bodů, Cvičné úlohy, Odhadni to (pruh nad obsahem okna) a Geo kartičky
 * (roh obrazovky). Moduly volají jen AGMaskot.pripoj(host, opts) a AGMaskot.rekni(kat, data);
 * maskot je ag/lazy (index.html), moduly si ho vyžádají přes AGLazy.need.
 *
 * TOTI 2 (25. 9. 2026, na přání: „udělat Totiho většího, ať se s ním líp interaguje, pokládal by
 * otázky, vysvětloval věci, reagoval na mnohem víc věcí, co dělám v aplikaci, a kecal mi do toho,
 * ať je zábava“): větší postavička; PLOVOUCÍ Toti na hlavní obrazovce (vlevo dole, u leváků vpravo,
 * schová se pod okny); klepnutí = nabídka Zeptej se mě / Vysvětli pojem / Poraď; kvíz ze slovníku
 * pojmů (window.agGeoDict) se skóre; komentáře k dění (uložení/smazání/import bodu, milníky,
 * otevřený nástroj, mapa ↔ kamera, přesnost GPS, bez signálu, baterie, jazyk, pozdrav podle denní
 * doby, po nečinnosti nabídne otázku); upovídanost Jen když klepnu / Občas / Ukecaný; volitelně
 * hlas telefonu + pípnutí laseru (f5). Vše jen obaluje existující funkce (window.saveCustomPoint…),
 * nic v nich nemění.
 *
 * Odpojitelné: smaž tento soubor + řádek <script type="ag/lazy"> v index.html; volání
 * v modulech jsou obalená `if (window.AGMaskot)` a nic se nerozbije.
 */
(function () {
    'use strict';
    if (window.AGMaskot) return;

    var LS = 'agMaskot_v1';
    var KAT = ['uvod', 'spravne', 'spatne', 'serie', 'konec_super', 'konec_dobre', 'konec_slabe', 'tip', 'klepnuti',
        // Toti 2: dění v appce
        'pozdrav_rano', 'pozdrav_den', 'pozdrav_vecer', 'pozdrav_noc', 'bod_ulozen', 'milnik', 'bod_smazan', 'import', 'nastroj',
        'nastaveni', 'kamera', 'mapa', 'gps_super', 'gps_spatne', 'offline', 'online', 'baterie', 'jazyk',
        'otazka_uvod', 'vysvetli_uvod', 'porad_uvod', 'neaktivita', 'menu'];
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'maskot:' + kde); } catch (x) { /* nic */ } }
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function jazyk() { try { return (window.AGJazyk && AGJazyk.get()) || 'cs'; } catch (e) { return 'cs'; } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function klid() { try { return document.documentElement.classList.contains('ag-lite') || matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

    // ---- výchozí hlášky ------------------------------------------------------------------------
    // {jmeno} = jméno maskota, {skore}/{celkem} = výsledek, {serie} = kolik správně po sobě
    var H = {
        cs: {
            uvod: ['Ahoj, jsem {jmeno}! Zacílím, změřím, poradím. Jdeme na to?', 'Stativ stojí, libela urovnaná. Můžeme začít.', 'Dneska měříme přesně. Aspoň v hlavě.', 'Nejdřív orientace, pak podrobné body. Stejně i v učení.', 'Zapnuto, zkalibrováno, připraveno. A ty?'],
            spravne: ['Správně! Trefa jako do hranolu.', 'Přesně tak. Odchylka nula celá nula.', 'Paráda, to sedí na milimetr.', 'Výborně! Tohle bych podepsal i do protokolu.', 'Ano! Laser se ani nezachvěl.', 'Sedí to. Jako fix s RTK.'],
            spatne: ['Vedle, ale nevadí. I já se někdy musím přeorientovat.', 'Tohle nesedí. Přečti si vysvětlení a jedeme dál.', 'Hrubá chyba? Ne, jen pokus. Příště to trefíš.', 'Hm, mírně mimo toleranci. Zkusíme znovu?', 'Nevadí. Každé měření se dá opakovat.'],
            serie: ['{serie}× po sobě! Tohle je uzávěr bez chyby.', 'Série {serie}! Ještě chvíli a budeš lepší než já.', 'Už {serie} správně za sebou. Měříš jako stroj. Věř mi, vím, o čem mluvím.'],
            konec_super: ['{skore} z {celkem}! Tohle je výsledek na zlatou libelu.', 'Plný počet! Můžeš jít rovnou do terénu.'],
            konec_dobre: ['{skore} z {celkem}. Slušné, ještě jedno kolo a bude to perfektní.', 'Dobrá práce, {skore} z {celkem}. Zbytek doladíme.'],
            konec_slabe: ['{skore} z {celkem}. Nevadí, přečti si vysvětlení a zkus to znovu.', 'Tohle byla zkušební sestava. Druhé kolo bude lepší.'],
            tip: ['Víš, že měřím délky laserem? Světlo letí k hranolu a zpátky, a já počítám, jak dlouho to trvalo.', 'Úhly měřím ve dvou polohách dalekohledu. Průměr vyruší většinu mých vlastních chyb.', 'Než začneš měřit, urovnej mě. Nakloněná totálka měří nakřivo.', 'Bod bodového pole hledej podle místopisu: je tam náčrt i oměrné míry.', 'Kontrolní měření není ztráta času. Je to pojistka proti hrubé chybě.', 'Výšku přístroje měř vždycky dvakrát. Z toho bývá nejvíc chyb.', 'Na slunci se vzduch vlní a cíl skáče. Ráno a večer se měří líp.', 'S-JTSK má osu Y na západ a X na jih. Proto jsou souřadnice u nás kladné.'],
            klepnuti: ['Klepni ještě jednou a řeknu ti další radu.', 'Hej, to lechtá! Radši měř.', 'Jsem tady, kdybys potřeboval poradit.', 'Otočím se, ukážu ti dalekohled. Ten je moje chlouba.']
        },
        en: {
            uvod: ['Hi, I am {jmeno}! I aim, measure and give tips. Ready?', 'Tripod set, bubble levelled. Let us start.', 'Today we measure precisely. At least in our heads.'],
            spravne: ['Correct! Right on the prism.', 'Exactly. Zero point zero deviation.', 'Great, spot on to the millimetre.', 'Yes! The laser did not even flicker.'],
            spatne: ['Missed, never mind. I sometimes have to re-orient too.', 'That does not fit. Read the explanation and let us go on.', 'Slightly out of tolerance. Try again?'],
            serie: ['{serie} in a row! A closure without error.', 'Streak of {serie}! Soon you will be better than me.'],
            konec_super: ['{skore} of {celkem}! A golden-bubble result.', 'Full marks! Straight to the field with you.'],
            konec_dobre: ['{skore} of {celkem}. Decent, one more round and it will be perfect.'],
            konec_slabe: ['{skore} of {celkem}. Never mind, read the explanations and try again.'],
            tip: ['I measure distances with a laser: light flies to the prism and back and I time it.', 'I measure angles in two telescope faces. The mean cancels most of my own errors.', 'Level me before you measure. A tilted total station measures crooked.', 'Always measure the instrument height twice. That is where most errors come from.'],
            klepnuti: ['Tap again and I will give you another tip.', 'Hey, that tickles! Better measure something.', 'I am here if you need advice.']
        },
        de: {
            uvod: ['Hallo, ich bin {jmeno}! Ich ziele, messe und gebe Tipps. Los geht’s?', 'Stativ steht, Libelle eingespielt. Wir können anfangen.'],
            spravne: ['Richtig! Mitten aufs Prisma.', 'Genau. Abweichung null Komma null.', 'Super, das passt auf den Millimeter.'],
            spatne: ['Daneben, macht nichts. Ich muss mich auch manchmal neu orientieren.', 'Das passt nicht. Lies die Erklärung und weiter geht’s.'],
            serie: ['{serie}× hintereinander! Ein Abschluss ohne Fehler.'],
            konec_super: ['{skore} von {celkem}! Ein Ergebnis für die goldene Libelle.'],
            konec_dobre: ['{skore} von {celkem}. Ordentlich, noch eine Runde und es ist perfekt.'],
            konec_slabe: ['{skore} von {celkem}. Macht nichts, lies die Erklärungen und versuch es nochmal.'],
            tip: ['Strecken messe ich mit Laser: Das Licht fliegt zum Prisma und zurück, ich messe die Zeit.', 'Horizontiere mich vor dem Messen. Eine schiefe Totalstation misst schief.', 'Miss die Instrumentenhöhe immer zweimal.'],
            klepnuti: ['Tipp nochmal, dann gibt’s den nächsten Tipp.', 'Hey, das kitzelt! Miss lieber was.']
        },
        pl: {
            uvod: ['Cześć, jestem {jmeno}! Celuję, mierzę, doradzam. Zaczynamy?', 'Statyw stoi, libella wypoziomowana. Możemy zaczynać.'],
            spravne: ['Dobrze! Prosto w pryzmat.', 'Dokładnie. Odchyłka zero przecinek zero.', 'Świetnie, zgadza się co do milimetra.'],
            spatne: ['Obok, nic nie szkodzi. Ja też czasem muszę się przeorientować.', 'To się nie zgadza. Przeczytaj wyjaśnienie i jedziemy dalej.'],
            serie: ['{serie}× z rzędu! Zamknięcie bez błędu.'],
            konec_super: ['{skore} z {celkem}! Wynik na złotą libellę.'],
            konec_dobre: ['{skore} z {celkem}. Nieźle, jeszcze jedna runda i będzie idealnie.'],
            konec_slabe: ['{skore} z {celkem}. Nic nie szkodzi, przeczytaj wyjaśnienia i spróbuj znowu.'],
            tip: ['Odległości mierzę laserem: światło leci do pryzmatu i z powrotem, a ja liczę czas.', 'Wypoziomuj mnie przed pomiarem. Przechylony tachimetr mierzy krzywo.', 'Wysokość instrumentu mierz zawsze dwa razy.'],
            klepnuti: ['Stuknij jeszcze raz, dam ci kolejną radę.', 'Hej, to łaskocze! Lepiej coś zmierz.']
        },
        es: {
            uvod: ['¡Hola, soy {jmeno}! Apunto, mido y doy consejos. ¿Empezamos?', 'Trípode firme, nivel calado. Podemos empezar.'],
            spravne: ['¡Correcto! Justo en el prisma.', 'Exacto. Desviación cero coma cero.', 'Genial, cuadra al milímetro.'],
            spatne: ['Fallaste, no pasa nada. Yo también tengo que reorientarme a veces.', 'Eso no cuadra. Lee la explicación y seguimos.'],
            serie: ['¡{serie} seguidas! Un cierre sin error.'],
            konec_super: ['¡{skore} de {celkem}! Un resultado de nivel de oro.'],
            konec_dobre: ['{skore} de {celkem}. Bien, una ronda más y será perfecto.'],
            konec_slabe: ['{skore} de {celkem}. No pasa nada, lee las explicaciones y vuelve a intentarlo.'],
            tip: ['Mido distancias con láser: la luz va al prisma y vuelve, y yo mido el tiempo.', 'Nivélame antes de medir. Una estación total inclinada mide torcido.', 'Mide siempre dos veces la altura del instrumento.'],
            klepnuti: ['Toca otra vez y te doy otro consejo.', '¡Eh, eso hace cosquillas! Mejor mide algo.']
        },
        it: {
            uvod: ['Ciao, sono {jmeno}! Punto, misuro e do consigli. Iniziamo?', 'Treppiede fermo, livella centrata. Possiamo iniziare.'],
            spravne: ['Giusto! Dritto nel prisma.', 'Esatto. Scarto zero virgola zero.', 'Ottimo, torna al millimetro.'],
            spatne: ['Mancato, non importa. Anch’io a volte devo riorientarmi.', 'Non torna. Leggi la spiegazione e andiamo avanti.'],
            serie: ['{serie} di fila! Una chiusura senza errori.'],
            konec_super: ['{skore} su {celkem}! Un risultato da livella d’oro.'],
            konec_dobre: ['{skore} su {celkem}. Bene, ancora un giro e sarà perfetto.'],
            konec_slabe: ['{skore} su {celkem}. Non importa, leggi le spiegazioni e riprova.'],
            tip: ['Misuro le distanze con il laser: la luce va al prisma e torna, e io misuro il tempo.', 'Mettimi in bolla prima di misurare. Una stazione totale inclinata misura storto.', 'Misura sempre due volte l’altezza dello strumento.'],
            klepnuti: ['Tocca ancora e ti do un altro consiglio.', 'Ehi, fa il solletico! Meglio misurare qualcosa.']
        },
        fr: {
            uvod: ['Salut, je suis {jmeno} ! Je vise, je mesure, je conseille. On y va ?', 'Trépied stable, nivelle calée. On peut commencer.'],
            spravne: ['Correct ! Pile sur le prisme.', 'Exactement. Écart zéro virgule zéro.', 'Super, juste au millimètre.'],
            spatne: ['Raté, pas grave. Moi aussi, je dois parfois me réorienter.', 'Ça ne colle pas. Lis l’explication et on continue.'],
            serie: ['{serie} d’affilée ! Une fermeture sans erreur.'],
            konec_super: ['{skore} sur {celkem} ! Un résultat digne d’une nivelle en or.'],
            konec_dobre: ['{skore} sur {celkem}. Pas mal, encore un tour et ce sera parfait.'],
            konec_slabe: ['{skore} sur {celkem}. Pas grave, lis les explications et réessaie.'],
            tip: ['Je mesure les distances au laser : la lumière va au prisme et revient, et je chronomètre.', 'Mets-moi de niveau avant de mesurer. Une station totale penchée mesure de travers.', 'Mesure toujours deux fois la hauteur de l’instrument.'],
            klepnuti: ['Touche encore une fois et je te donne un autre conseil.', 'Hé, ça chatouille ! Mesure plutôt quelque chose.']
        },
        nl: {
            uvod: ['Hoi, ik ben {jmeno}! Ik richt, meet en geef tips. Zullen we?', 'Statief staat, libel ingespeeld. We kunnen beginnen.'],
            spravne: ['Goed! Midden op het prisma.', 'Precies. Afwijking nul komma nul.', 'Top, klopt op de millimeter.'],
            spatne: ['Mis, geeft niet. Ik moet me soms ook opnieuw oriënteren.', 'Dat klopt niet. Lees de uitleg en we gaan verder.'],
            serie: ['{serie} op rij! Een sluiting zonder fout.'],
            konec_super: ['{skore} van {celkem}! Een resultaat voor de gouden libel.'],
            konec_dobre: ['{skore} van {celkem}. Netjes, nog één ronde en het is perfect.'],
            konec_slabe: ['{skore} van {celkem}. Geeft niet, lees de uitleg en probeer het opnieuw.'],
            tip: ['Afstanden meet ik met een laser: het licht vliegt naar het prisma en terug, en ik meet de tijd.', 'Zet me waterpas voordat je meet. Een scheve total station meet scheef.', 'Meet de instrumenthoogte altijd twee keer.'],
            klepnuti: ['Tik nog eens en je krijgt nog een tip.', 'Hé, dat kietelt! Meet liever iets.']
        },
        pt: {
            uvod: ['Olá, sou o {jmeno}! Aponto, meço e dou dicas. Vamos?', 'Tripé firme, nível calado. Podemos começar.'],
            spravne: ['Certo! Mesmo no prisma.', 'Exato. Desvio zero vírgula zero.', 'Ótimo, bate ao milímetro.'],
            spatne: ['Ao lado, não faz mal. Eu também às vezes tenho de me reorientar.', 'Isso não bate. Lê a explicação e continuamos.'],
            serie: ['{serie} seguidas! Um fecho sem erro.'],
            konec_super: ['{skore} de {celkem}! Um resultado de nível de ouro.'],
            konec_dobre: ['{skore} de {celkem}. Bem, mais uma ronda e fica perfeito.'],
            konec_slabe: ['{skore} de {celkem}. Não faz mal, lê as explicações e tenta de novo.'],
            tip: ['Meço distâncias com laser: a luz vai ao prisma e volta, e eu cronometro.', 'Nivela-me antes de medir. Uma estação total inclinada mede torto.', 'Mede sempre duas vezes a altura do instrumento.'],
            klepnuti: ['Toca outra vez e dou-te outra dica.', 'Ei, isso faz cócegas! Mede antes alguma coisa.']
        }
    };

    var H2 = {
        cs: {
            pozdrav_rano: ['Dobré ráno! Káva je, baterka nabitá? Jdeme měřit.', 'Ráno se měří nejlíp, vzduch se ještě nevlní.', 'Brý ráno, {jmeno} hlásí připravenost!'],
            pozdrav_den: ['Ahoj! Jsem tady, kdybys potřeboval poradit.', 'Čau! Dneska to změříme na milimetr.', 'Zdravím v terénu! Klepni na mě a zeptám se tě na něco.'],
            pozdrav_vecer: ['Dobrý večer! Ještě stihneme pár bodů, než zapadne slunce.', 'Večerní směna? Hlídej světlo, potmě kamera v AR nevidí.'],
            pozdrav_noc: ['Měříš v noci? Respekt. Já na svítícím displeji vydržím.', 'Noc, klid, žádný vlnící se vzduch. Ideální čas na kvíz.'],
            bod_ulozen: ['Bod {bod} uložen. Pěkná práce!', 'Mám ho! {bod} je v zakázce.', 'Další bod do sbírky. Kolik jich dneska dáme?', 'Uloženo. A kontrolní měření? Jen říkám.', '{bod}, zapsáno. Jako do zápisníku, jen bez propisky.'],
            milnik: ['{n} bodů v zakázce! To už je pořádná síť.', 'Gratuluju, {n} bodů! Tohle chce oslavu. Aspoň virtuální.', '{n} bodů! Takhle vypadá geodet v plném nasazení.'],
            bod_smazan: ['Smazáno. Kdyby něco, je to v koši.', 'Pryč s ním. Hrubé chyby do zakázky nepatří.', 'Bod je fuč. Snad to byl ten správný.'],
            import: ['Naimportováno {n} bodů. To šlo rychle!', '{n} nových bodů. Mrkni na ně v mapě.'],
            nastroj: ['{nastroj}? Dobrá volba.', 'Otevíráš {nastroj}. Kdyby něco, klepni na mě.', 'Jo, {nastroj}. Jeden z mých oblíbených.', '{nastroj}! Tak ukaž, co umíš.'],
            nastaveni: ['Ladíš nastavení? Na slunci se hodí Venkovní režim.', 'Tip: souřadnice jde přepnout na 3 desetinná místa. Na milimetry!', 'Nastavení. Jen mi prosím nevypínej hlas.'],
            kamera: ['Kamera zapnutá! Míř na bod a já ti ho ukážu.', 'AR režim. Drž telefon rovně, ať kompas nelže.', 'Koukám tvýma očima. Teda kamerou.'],
            mapa: ['Zpátky v mapě. Přehled nade vše.', 'Mapa! Tady je vidět, co je kolem.'],
            gps_super: ['GPS na ±{acc} m! Na telefon skvělé.', 'Výborný signál, ±{acc} m. Teď měř!'],
            gps_spatne: ['GPS jen ±{acc} m. Zkus vyjít z budovy nebo chvíli počkat.', 'Signál GPS je slabý (±{acc} m). Pod stromy a u zdí to skáče.'],
            offline: ['Signál pryč. Nevadí, body mám v sobě.', 'Jsi offline. Měřit jde dál, synchronizace počká.'],
            online: ['Signál je zpátky!', 'Zase online. Můžeme stahovat body.'],
            baterie: ['Baterka jen {n} %! Uber jas nebo zapni úsporu.', 'Pozor, dochází šťáva ({n} %). Bez telefonu neměříme.'],
            jazyk: ['Jazyk přepnut. Mluvím, jak si přeješ.'],
            otazka_uvod: ['Kvíz! Co je tohle:', 'Zkusím tě. Jak se tomu říká:', 'Otázka pro geodeta:'],
            vysvetli_uvod: ['Vysvětlím ti jeden pojem.', 'Malá lekce:', 'Víš, co to je?'],
            porad_uvod: ['Věděl jsi, že appka umí tohle?', 'Tip ode mě:'],
            neaktivita: ['Chvíli se nic neděje. Nezkusíme kvíz?', 'Nuda? Mám pro tebe otázku.'],
            menu: ['Co pro tebe můžu udělat?', 'Jsem tady! Vyber si.', 'Zeptám se, vysvětlím, nebo poradím?']
        },
        en: {
            pozdrav_rano: ['Good morning! Coffee done, battery charged? Let us measure.', 'Mornings are the best for measuring, the air is still calm.'],
            pozdrav_den: ['Hi! I am here if you need advice.', 'Hey! Today we measure to the millimetre.', 'Greetings in the field! Tap me and I will ask you something.'],
            pozdrav_vecer: ['Good evening! We can still get a few points before sunset.', 'Evening shift? Watch the light, the AR camera cannot see in the dark.'],
            pozdrav_noc: ['Measuring at night? Respect. My display glows anyway.', 'Night, quiet, no shimmering air. Perfect time for a quiz.'],
            bod_ulozen: ['Point {bod} saved. Nice work!', 'Got it! {bod} is in the job.', 'Another point for the collection. How many today?', 'Saved. And a check measurement? Just saying.'],
            milnik: ['{n} points in the job! That is a proper network.', 'Congratulations, {n} points! This calls for a celebration. A virtual one.'],
            bod_smazan: ['Deleted. Just in case, it is in the bin.', 'Gone. Blunders do not belong in the job.'],
            import: ['Imported {n} points. That was quick!', '{n} new points. Have a look at them on the map.'],
            nastroj: ['{nastroj}? Good choice.', 'Opening {nastroj}. Tap me if you need help.', 'Ah, {nastroj}. One of my favourites.'],
            nastaveni: ['Tuning the settings? Outdoor mode helps in the sun.', 'Tip: coordinates can show 3 decimals. Millimetres!'],
            kamera: ['Camera on! Aim at a point and I will show it to you.', 'AR mode. Hold the phone level so the compass does not lie.'],
            mapa: ['Back on the map. Overview first.', 'Map! Here you can see what is around.'],
            gps_super: ['GPS at ±{acc} m! Great for a phone.', 'Excellent signal, ±{acc} m. Measure now!'],
            gps_spatne: ['GPS only ±{acc} m. Try leaving the building or wait a bit.', 'Weak GPS (±{acc} m). It jumps under trees and next to walls.'],
            offline: ['Signal gone. No problem, I keep the points inside.', 'You are offline. Measuring goes on, sync can wait.'],
            online: ['Signal is back!', 'Online again. We can download points.'],
            baterie: ['Battery only {n} %! Lower the brightness or turn on saving.', 'Careful, running out of juice ({n} %).'],
            jazyk: ['Language switched. I speak as you wish.'],
            otazka_uvod: ['Quiz! What is this:', 'Let me test you. What is it called:', 'A question for a surveyor:'],
            vysvetli_uvod: ['Let me explain a term.', 'A small lesson:'],
            porad_uvod: ['Did you know the app can do this?', 'A tip from me:'],
            neaktivita: ['Nothing is happening. How about a quiz?', 'Bored? I have a question for you.'],
            menu: ['What can I do for you?', 'I am here! Pick one.']
        }
    };
    Object.keys(H2).forEach(function (l) { Object.keys(H2[l]).forEach(function (k) { H[l][k] = H2[l][k]; }); });

    // ---- nastavení -----------------------------------------------------------------------------
    function nast() {
        var s = null;
        try { s = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { s = null; }
        s = s && typeof s === 'object' ? s : {};
        if (s.zap == null) s.zap = true;
        if (!s.jmeno) s.jmeno = 'Toti';
        if (!s.vlastni || typeof s.vlastni !== 'object') s.vlastni = {};
        if (s.spolecnik == null) s.spolecnik = true;          // plovoucí Toti na hlavní obrazovce
        if (!s.ukecanost) s.ukecanost = 'obcas';              // tichy | obcas | ukecany
        if (s.hlas == null) s.hlas = false;                   // hlas telefonu + pípnutí laseru
        if (!s.kviz) s.kviz = { n: 0, ok: 0 };
        return s;
    }
    function uloz(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { swallow(e, 'ls'); } }

    // Soubor s hláškami: .json {kategorie:[…]} nebo [..] (= tipy), jinak text po řádcích:
    //   [spravne]            ← hlavička = kategorie pro další řádky
    //   spatne: Vedle!       ← kategorie přímo na řádku
    //   # komentář           ← přeskočí se
    //   Řádek bez kategorie  ← tip
    function rozparsuj(text) {
        var out = {}, add = function (k, v) {
            v = String(v == null ? '' : v).trim(); if (!v) return;
            k = String(k || 'tip').trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (KAT.indexOf(k) < 0) k = 'tip';
            (out[k] = out[k] || []).push(v.slice(0, 400));
        };
        var s = String(text || '').replace(/^﻿/, '');
        var tr = s.trim();
        if (tr.charAt(0) === '{' || tr.charAt(0) === '[') {
            try {
                var j = JSON.parse(tr);
                if (Array.isArray(j)) j.forEach(function (v) { add('tip', v); });
                else Object.keys(j).forEach(function (k) { var v = j[k]; (Array.isArray(v) ? v : [v]).forEach(function (x) { add(k, x); }); });
                return out;
            } catch (e) { /* není JSON → jako text */ }
        }
        var kat = 'tip';
        s.split(/\r?\n/).forEach(function (r) {
            var l = r.trim(); if (!l || l.charAt(0) === '#' || l.indexOf('//') === 0) return;
            var h = /^\[\s*([\w\s-]+)\s*\]$/.exec(l); if (h) { kat = h[1]; return; }
            var p = /^([a-z_]+)\s*:\s*(.+)$/i.exec(l);
            if (p && KAT.indexOf(p[1].toLowerCase()) >= 0) { add(p[1], p[2]); return; }
            add(kat, l);
        });
        return out;
    }
    function vzor() {
        var s = nast(), cs = H.cs, L = ['# Hlášky pro maskota ' + s.jmeno + ' (QTRIG).',
            '# Řádek [kategorie] začíná skupinu, každý další řádek = jedna hláška. Řádky s # se přeskočí.',
            '# Kategorie: ' + KAT.join(', '),
            '# Do textu můžeš dát {jmeno}, {skore}, {celkem} (výsledek kvízu) a {serie} (kolik správně po sobě).', ''];
        KAT.forEach(function (k) {
            L.push('[' + k + ']');
            ((s.vlastni[k] && s.vlastni[k].length) ? s.vlastni[k] : (cs[k] || [])).forEach(function (v) { L.push(v); });
            L.push('');
        });
        return L.join('\n');
    }

    function hlasky(kat) {
        var s = nast(), vl = (s.vlastni[kat] || []).slice();
        if (s.jenVlastni && vl.length) return vl;
        var L = H[jazyk()] || H.en;
        var zakl = (L[kat] && L[kat].length) ? L[kat] : ((H.en[kat] || []).length ? H.en[kat] : (H.cs[kat] || []));
        return vl.concat(zakl);
    }
    var _posledni = {};
    function vyber(kat, data) {
        var l = hlasky(kat); if (!l.length) l = hlasky('tip'); if (!l.length) return '';
        var i = Math.floor(Math.random() * l.length);
        if (l.length > 1 && l[i] === _posledni[kat]) i = (i + 1) % l.length;   // neopakovat hned tutéž
        _posledni[kat] = l[i];
        var d = data || {}, s = nast();
        return l[i].replace(/\{(\w+)\}/g, function (m, k) { return k === 'jmeno' ? s.jmeno : (d[k] != null ? d[k] : m); });
    }

    // ---- kresba --------------------------------------------------------------------------------
    var SVG = '<svg class="mk-svg" viewBox="0 0 100 120" aria-hidden="true">'
        + '<g class="mk-stativ" stroke-linecap="round">'
        + '<line x1="50" y1="80" x2="20" y2="117" stroke="#b7793a" stroke-width="5"/>'
        + '<line x1="50" y1="80" x2="80" y2="117" stroke="#b7793a" stroke-width="5"/>'
        + '<line x1="50" y1="80" x2="50" y2="116" stroke="#9c6630" stroke-width="4.5"/>'
        + '<line x1="16" y1="117" x2="24" y2="117" stroke="#6b7280" stroke-width="3"/><line x1="76" y1="117" x2="84" y2="117" stroke="#6b7280" stroke-width="3"/>'
        + '<rect x="36" y="76" width="28" height="6" rx="2" fill="#6b7280"/></g>'
        + '<g class="mk-telo">'
        + '<rect x="37" y="69" width="26" height="8" rx="2" fill="#374151"/>'
        + '<g class="mk-otoc">'
        + '<rect x="28" y="52" width="44" height="19" rx="5" fill="#f2c230" stroke="#b8901a" stroke-width="1.2"/>'
        + '<rect x="27" y="22" width="11" height="34" rx="4" fill="#f2c230" stroke="#b8901a" stroke-width="1.2"/>'
        + '<rect x="62" y="22" width="11" height="34" rx="4" fill="#f2c230" stroke="#b8901a" stroke-width="1.2"/>'
        + '<path d="M36 22 Q50 10 64 22" fill="none" stroke="#374151" stroke-width="3.5" stroke-linecap="round"/>'
        + '<rect class="mk-displej" x="36" y="55" width="28" height="13" rx="3" fill="#0f2233"/>'
        + '<g class="mk-oci"><rect class="mk-oko" x="42" y="58" width="5" height="7" rx="2.2" fill="#6ee7ff"/><rect class="mk-oko" x="53" y="58" width="5" height="7" rx="2.2" fill="#6ee7ff"/></g>'
        + '<g class="mk-oci-ok"><path d="M41.5 63 Q44.5 58.5 47.5 63" fill="none" stroke="#6ee7ff" stroke-width="2" stroke-linecap="round"/><path d="M52.5 63 Q55.5 58.5 58.5 63" fill="none" stroke="#6ee7ff" stroke-width="2" stroke-linecap="round"/></g>'
        + '<g class="mk-oci-smut"><path d="M42 61.5 L47 59.5" stroke="#6ee7ff" stroke-width="2" stroke-linecap="round"/><path d="M58 61.5 L53 59.5" stroke="#6ee7ff" stroke-width="2" stroke-linecap="round"/><rect x="42.5" y="63" width="4" height="3" rx="1.4" fill="#6ee7ff"/><rect x="53.5" y="63" width="4" height="3" rx="1.4" fill="#6ee7ff"/></g>'
        + '<g class="mk-teky"><circle cx="44" cy="62" r="1.4" fill="#6ee7ff"/><circle cx="50" cy="62" r="1.4" fill="#6ee7ff"/><circle cx="56" cy="62" r="1.4" fill="#6ee7ff"/></g>'
        + '<g class="mk-dalek">'
        + '<rect x="33" y="31" width="42" height="13" rx="6" fill="#2f9e74" stroke="#1f6e51" stroke-width="1.2"/>'
        + '<rect x="71" y="29.5" width="7" height="16" rx="3" fill="#1f2937"/>'
        + '<circle cx="77.5" cy="37.5" r="3.2" fill="#93c5fd" class="mk-cocka"/>'
        + '<rect x="29" y="33.5" width="6" height="8" rx="2" fill="#1f2937"/>'
        + '<circle cx="50" cy="37.5" r="4.2" fill="#f2c230" stroke="#b8901a" stroke-width="1"/>'
        + '<line class="mk-laser" x1="80" y1="37.5" x2="100" y2="37.5" stroke="#ff3b3b" stroke-width="1.6" stroke-linecap="round"/>'
        + '<circle class="mk-laser-bod" cx="100" cy="37.5" r="2" fill="#ff3b3b"/>'
        + '</g></g></g></svg>';

    function styl() {
        if (document.getElementById('ag-maskot-css')) return;
        var css = ''
            + '.ag-maskot{display:flex;align-items:flex-start;gap:8px;margin:0 0 10px;position:relative;}'
            + '.ag-maskot .mk-btn{flex:0 0 auto;width:92px;height:112px;padding:0;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent;}'
            + '.ag-maskot .mk-akce{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}.ag-maskot .mk-akce:empty{display:none;}'
            + '.ag-maskot .mk-akce button{flex:1 1 auto;min-height:40px;padding:8px 11px;border-radius:10px;border:1px solid var(--accent-line,rgba(47,158,116,.45));'
            + 'background:var(--accent-soft,rgba(47,158,116,.14));color:var(--text-color,#e6e8eb);font:600 calc(13px * var(--ag-font-scale,1))/1.2 var(--font-ui,system-ui);cursor:pointer;text-align:center;}'
            + '.ag-maskot .mk-akce button.ok{background:var(--accent,#2f9e74);color:#fff;border-color:var(--accent,#2f9e74);}'
            + '.ag-maskot .mk-akce button.bad{border-color:#ef4444;color:#ef4444;background:transparent;}'
            + '.ag-maskot .mk-akce button:disabled{opacity:.7;cursor:default;}'
            + 'body.light-mode .ag-maskot .mk-akce button{color:#141821;}'
            + '.ag-maskot .mk-skore{display:block;margin-top:6px;font-size:calc(11.5px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);}'
            // PLOVOUCÍ TOTI (hlavní obrazovka) — vlevo dole, dok je vpravo; u leváků obráceně
            + '.ag-maskot.mk-plovak{position:fixed;z-index:950;left:calc(env(safe-area-inset-left,0px) + 8px);bottom:calc(env(safe-area-inset-bottom,0px) + 14px);'
            + 'max-width:min(330px,calc(100vw - 130px));margin:0;pointer-events:none;align-items:flex-end;}'
            + '.ag-maskot.mk-plovak > *{pointer-events:auto;}'
            + '.ag-maskot.mk-plovak .mk-btn{width:78px;height:95px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.4));}'
            + '.ag-maskot.mk-plovak .mk-bublina{margin:0 0 40px;box-shadow:0 8px 24px rgba(0,0,0,.3);transition:opacity .25s ease,transform .25s ease;}'
            + '.ag-maskot.mk-plovak .mk-bublina::before{top:auto;bottom:14px;}'
            + '.ag-maskot.mk-plovak.mk-ticho .mk-bublina{opacity:0;transform:translateY(6px);pointer-events:none;}'
            // nad mapou PLNÉ pozadí (surface-2 je poloprůhledné sklo → na světlé mapě nečitelné)
            + '.ag-maskot.mk-plovak .mk-bublina,.ag-maskot.mk-roh .mk-bublina{background:#161b22;border-color:rgba(255,255,255,.18);color:#eef1f4;}'
            + '.ag-maskot.mk-plovak.mk-skryt{display:none;}'
            + 'body.left-hand .ag-maskot.mk-plovak{left:auto;right:calc(env(safe-area-inset-right,0px) + 8px);flex-direction:row-reverse;}'
            + 'body.left-hand .ag-maskot.mk-plovak .mk-bublina::before{left:auto;right:-7px;transform:rotate(225deg);}'
            + 'body.left-hand .ag-maskot.mk-plovak .mk-svg{transform:scaleX(-1);}'
            + '.ag-maskot .mk-svg{width:100%;height:100%;overflow:visible;display:block;}'
            + '.ag-maskot .mk-bublina{flex:1;min-width:0;position:relative;margin-top:6px;padding:9px 12px;border-radius:14px;'
            + 'background:var(--surface-2,#1f2530);border:1px solid var(--glass-border,rgba(255,255,255,.14));color:var(--text-color,#e6e8eb);'
            + 'font-size:calc(13.5px * var(--ag-font-scale,1));line-height:1.45;min-height:22px;}'
            + '.ag-maskot .mk-bublina::before{content:"";position:absolute;left:-7px;top:16px;width:12px;height:12px;background:inherit;'
            + 'border-left:1px solid var(--glass-border,rgba(255,255,255,.14));border-bottom:1px solid var(--glass-border,rgba(255,255,255,.14));transform:rotate(45deg);}'
            + '.ag-maskot .mk-jmeno{display:block;font-size:calc(11px * var(--ag-font-scale,1));font-weight:700;color:var(--accent,#2f9e74);margin-bottom:2px;letter-spacing:.02em;}'
            + '.ag-maskot .mk-vic{position:absolute;right:4px;top:2px;width:30px;height:30px;border:0;background:none;color:var(--text-muted,#9aa1ac);font-size:18px;line-height:1;cursor:pointer;border-radius:50%;}'
            + '.ag-maskot .mk-vic:active{background:var(--surface-1,rgba(255,255,255,.08));}'
            + 'body.light-mode .ag-maskot .mk-bublina{background:#fff;border-color:rgba(15,23,42,.16);color:#141821;}'
            // ztlumený: jen malá hlavička, bez bubliny
            + '.ag-maskot.mk-off .mk-bublina{display:none;}.ag-maskot.mk-off .mk-btn{width:40px;height:49px;opacity:.75;}'
            + '.ag-maskot.mk-off{margin-bottom:4px;}'
            // roh obrazovky (Geo kartičky)
            + '.ag-maskot.mk-roh{position:fixed;z-index:9000;left:calc(env(safe-area-inset-left,0px) + 10px);bottom:calc(env(safe-area-inset-bottom,0px) + 58px);'
            + 'max-width:min(360px,calc(100vw - 20px));margin:0;pointer-events:none;}'
            + '.ag-maskot.mk-roh > *{pointer-events:auto;}'
            + '.ag-maskot.mk-roh .mk-btn{width:80px;height:97px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.35));}'
            + '.ag-maskot.mk-roh .mk-bublina{box-shadow:0 8px 24px rgba(0,0,0,.3);transition:opacity .25s ease,transform .25s ease;}'
            + '.ag-maskot.mk-roh.mk-ticho .mk-bublina{opacity:0;transform:translateY(6px);pointer-events:none;}'
            // výrazy
            + '.ag-maskot .mk-oci-ok,.ag-maskot .mk-oci-smut,.ag-maskot .mk-teky{display:none;}'
            + '.ag-maskot.mk-radost .mk-oci{display:none;}.ag-maskot.mk-radost .mk-oci-ok{display:inline;}'
            + '.ag-maskot.mk-smutek .mk-oci{display:none;}.ag-maskot.mk-smutek .mk-oci-smut{display:inline;}'
            + '.ag-maskot.mk-mysli .mk-oci{display:none;}.ag-maskot.mk-mysli .mk-teky{display:inline;}'
            + '.ag-maskot .mk-laser,.ag-maskot .mk-laser-bod{opacity:0;}'
            + '.ag-maskot .mk-otoc{transform-box:view-box;transform-origin:50px 50px;}'
            + '.ag-maskot .mk-dalek{transform-box:view-box;transform-origin:50px 37.5px;}'
            + '.ag-maskot .mk-oko{transform-box:fill-box;transform-origin:center;}'
            + '.ag-maskot .mk-telo{transform-box:view-box;transform-origin:50px 80px;}';
        if (!klid()) css += ''
            + '.ag-maskot .mk-telo{animation:mk-dech 3.2s ease-in-out infinite;}'
            + '.ag-maskot .mk-dalek{animation:mk-kyv 5s ease-in-out infinite;}'
            + '.ag-maskot .mk-oko{animation:mk-mrk 4.6s infinite;}'
            + '.ag-maskot.mk-mluvi .mk-laser,.ag-maskot.mk-mluvi .mk-laser-bod{animation:mk-blik .5s steps(2,end) infinite;}'
            + '.ag-maskot.mk-radost .mk-telo{animation:mk-skok .5s ease-out 2;}'
            + '.ag-maskot.mk-radost .mk-otoc{animation:mk-otocka .8s ease-in-out 1;}'
            + '.ag-maskot.mk-radost .mk-laser{stroke:#3fcf8e;}.ag-maskot.mk-radost .mk-laser-bod{fill:#3fcf8e;}'
            + '.ag-maskot.mk-smutek .mk-dalek{animation:none;transform:rotate(14deg);transition:transform .5s ease;}'
            + '.ag-maskot.mk-smutek .mk-telo{animation:mk-trep .45s ease-in-out 1;}'
            + '.ag-maskot.mk-mysli .mk-dalek{animation:mk-sken 1.6s ease-in-out infinite;}'
            + '.ag-maskot.mk-mysli .mk-laser,.ag-maskot.mk-mysli .mk-laser-bod{animation:mk-blik .3s steps(2,end) infinite;}'
            + '@keyframes mk-dech{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6px)}}'
            + '@keyframes mk-kyv{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(4deg)}}'
            + '@keyframes mk-mrk{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}'
            + '@keyframes mk-blik{0%{opacity:1}100%{opacity:.25}}'
            + '@keyframes mk-skok{0%,100%{transform:translateY(0)}40%{transform:translateY(-9px)}}'
            + '@keyframes mk-otocka{0%{transform:scaleX(1)}25%{transform:scaleX(.1)}50%{transform:scaleX(-1)}75%{transform:scaleX(.1)}100%{transform:scaleX(1)}}'
            + '@keyframes mk-trep{0%,100%{transform:translateX(0)}25%{transform:translateX(-2.5px)}75%{transform:translateX(2.5px)}}'
            + '@keyframes mk-sken{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg)}}';
        else css += '.ag-maskot.mk-mluvi .mk-laser,.ag-maskot.mk-mluvi .mk-laser-bod,.ag-maskot.mk-mysli .mk-laser,.ag-maskot.mk-mysli .mk-laser-bod{opacity:1;}'
            + '.ag-maskot.mk-smutek .mk-dalek{transform:rotate(14deg);}';
        css += ''
            // panel nastavení maskota
            + '#ag-mk-panel{position:fixed;inset:0;z-index:100050;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.5);}'
            + '#ag-mk-panel .mkp{width:min(480px,100%);max-height:88vh;overflow:auto;box-sizing:border-box;background:var(--bg-color,#12161c);color:var(--text-color,#e6e8eb);'
            + 'border-radius:18px 18px 0 0;padding:16px 16px calc(env(safe-area-inset-bottom,0px) + 16px);display:flex;flex-direction:column;gap:10px;}'
            + 'body.light-mode #ag-mk-panel .mkp{background:#fff;color:#141821;}'
            + '#ag-mk-panel h3{margin:0;display:flex;align-items:center;gap:8px;}#ag-mk-panel h3 svg{width:34px;height:40px;}'
            + '#ag-mk-panel p{margin:0;font-size:calc(13px * var(--ag-font-scale,1));line-height:1.45;color:var(--text-muted,#9aa1ac);}'
            + '#ag-mk-panel label{display:flex;align-items:center;gap:10px;font-size:calc(14px * var(--ag-font-scale,1));min-height:40px;}'
            + '#ag-mk-panel select{flex:1;min-width:0;padding:9px 10px;border-radius:9px;border:1px solid var(--border,rgba(255,255,255,.14));background:var(--bg-input,rgba(255,255,255,.06));color:inherit;font:inherit;}'
            + '#ag-mk-panel input[type=text]{flex:1;min-width:0;padding:9px 10px;border-radius:9px;border:1px solid var(--border,rgba(255,255,255,.14));background:var(--bg-input,rgba(255,255,255,.06));color:inherit;font:inherit;}'
            + '#ag-mk-panel .btn{margin:0;}#ag-mk-panel .mkp-stav{font-size:calc(12.5px * var(--ag-font-scale,1));color:var(--accent,#2f9e74);min-height:1em;}';
        var st = document.createElement('style'); st.id = 'ag-maskot-css'; st.textContent = css; document.head.appendChild(st);
    }

    // ---- instance ------------------------------------------------------------------------------
    var _akt = null;          // naposledy připojený maskot
    function vytvor(roh) {
        var s = nast();
        var el = document.createElement('div');
        el.className = 'ag-maskot' + (roh ? ' mk-roh mk-ticho' : '') + (s.zap ? '' : ' mk-off');
        el.innerHTML = '<button type="button" class="mk-btn" aria-label="' + esc(t('Maskot') + ' ' + s.jmeno + ' — ' + t('další rada')) + '">' + SVG + '</button>'
            + '<div class="mk-bublina" role="status" aria-live="polite"><span class="mk-jmeno"></span><span class="mk-text"></span><div class="mk-akce"></div>'
            + '<button type="button" class="mk-vic" aria-label="' + esc(t('Nastavení maskota')) + '">⋯</button></div>';
        el.querySelector('.mk-jmeno').textContent = s.jmeno;
        el.querySelector('.mk-btn').addEventListener('click', function () {
            if (!nast().zap) { panel(); return; }
            menu(el);
        });
        el.querySelector('.mk-vic').addEventListener('click', function (e) { e.stopPropagation(); panel(); });
        // dlouhý stisk na maskota = nastavení (i když je ztlumený a bublina schovaná)
        var tm = null;
        el.querySelector('.mk-btn').addEventListener('pointerdown', function () { clearTimeout(tm); tm = setTimeout(function () { tm = 'dlouhy'; panel(); }, 650); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { el.querySelector('.mk-btn').addEventListener(ev, function () { if (tm !== 'dlouhy') clearTimeout(tm); }); });
        el.querySelector('.mk-btn').addEventListener('click', function (e) { if (tm === 'dlouhy') { tm = null; e.stopImmediatePropagation(); } }, true);
        return el;
    }

    function pripoj(host, opts) {
        opts = opts || {};
        if (!host) return null;
        styl();
        var roh = opts.misto === 'roh';
        var el = roh ? host.querySelector(':scope > .ag-maskot.mk-roh') : (opts.pred ? (host.previousElementSibling && host.previousElementSibling.classList.contains('ag-maskot') ? host.previousElementSibling : null) : host.querySelector(':scope > .ag-maskot'));
        if (!el) {
            el = vytvor(roh);
            if (roh) host.appendChild(el);
            else if (opts.pred) host.parentNode.insertBefore(el, host);
            else host.insertBefore(el, host.firstChild);
        }
        _akt = el;
        _serie = 0;
        if (opts.rekni !== false) rekniDo(el, opts.kat || 'uvod', opts.data, 'radost');
        return el;
    }

    var _serie = 0;
    function viditelny(el) { try { return !!(el && el.isConnected && el.getClientRects().length); } catch (e) { return false; } }
    function rekni(kat, data) {
        var el = _akt;
        if (!viditelny(el)) {
            var vse = document.querySelectorAll('.ag-maskot'); el = null;
            for (var i = vse.length - 1; i >= 0; i--) if (viditelny(vse[i])) { el = vse[i]; break; }
            if (!el) return;
        }
        if (kat === 'spravne') { _serie++; if (_serie >= 3 && _serie % 3 === 0) kat = 'serie'; }
        else if (kat === 'spatne') _serie = 0;
        data = data || {}; if (data.serie == null) data.serie = _serie;
        var nal = { spravne: 'radost', serie: 'radost', konec_super: 'radost', konec_dobre: 'radost', spatne: 'smutek', konec_slabe: 'smutek', tip: 'mysli' }[kat] || 'mluvi';
        rekniDo(el, kat, data, nal);
    }

    function rekniDo(el, kat, data, nalada, o) {
        o = o || {};
        if (!el || !nast().zap) return;
        var txt = o.text != null ? o.text : vyber(kat, data); if (!txt) return;
        var box = el.querySelector('.mk-text');
        akce(el, o.akce, o.skore);
        if (nalada === 'radost') pip(true); else if (nalada === 'smutek') pip(false);
        mluv(txt);
        clearTimeout(el._mkT1); clearTimeout(el._mkT2); clearInterval(el._mkPis);
        el.classList.remove('mk-radost', 'mk-smutek', 'mk-mysli', 'mk-mluvi', 'mk-ticho');
        void el.offsetWidth;   // znovu spustit animaci i při stejné náladě po sobě
        el.classList.add('mk-' + (nalada || 'mluvi'));
        if (klid()) { box.textContent = txt; }
        else {
            var i = 0; box.textContent = '';
            el._mkPis = setInterval(function () {
                i += 2; box.textContent = txt.slice(0, i);
                if (i >= txt.length) clearInterval(el._mkPis);
            }, 22);
        }
        // nálada doběhne, pak zase klidný dech; v rohu se bublina po čase schová
        el._mkT1 = setTimeout(function () { el.classList.remove('mk-radost', 'mk-mysli', 'mk-mluvi'); if (nalada !== 'smutek') el.classList.add('mk-mluvi'); }, 1600);
        var dlouho = o.akce && o.akce.length ? 30000 : Math.max(5000, txt.length * 70);
        el._mkT2 = setTimeout(function () {
            el.classList.remove('mk-mluvi', 'mk-smutek');
            if (el.classList.contains('mk-roh') || el.classList.contains('mk-plovak')) { el.classList.add('mk-ticho'); akce(el, null); }
        }, dlouho);
    }
    // tlačítka v bublině: [{l, fn, cls}]
    function akce(el, list, skore) {
        var box = el.querySelector('.mk-akce'); if (!box) return;
        box.innerHTML = '';
        (list || []).forEach(function (a) {
            var b = document.createElement('button'); b.type = 'button'; b.textContent = a.l; if (a.cls) b.className = a.cls;
            b.addEventListener('click', function (e) { e.stopPropagation(); try { a.fn(b, el); } catch (x) { swallow(x, 'akce'); } });
            box.appendChild(b);
        });
        if (skore) { var sk = document.createElement('span'); sk.className = 'mk-skore'; sk.textContent = skore; box.appendChild(sk); }
    }

    function obnovVse() {
        var s = nast();
        document.querySelectorAll('.ag-maskot').forEach(function (el) {
            el.classList.toggle('mk-off', !s.zap);
            var j = el.querySelector('.mk-jmeno'); if (j) j.textContent = s.jmeno;
        });
        hlidejPlovak();
    }

    // ---- panel: jméno, vlastní hlášky ----------------------------------------------------------
    function panel() {
        styl();
        var old = document.getElementById('ag-mk-panel'); if (old) old.remove();
        var s = nast();
        var n = 0; Object.keys(s.vlastni).forEach(function (k) { n += (s.vlastni[k] || []).length; });
        var ov = document.createElement('div'); ov.id = 'ag-mk-panel'; ov.setAttribute('data-ag-okno', ''); ov.setAttribute('role', 'dialog');
        ov.innerHTML = '<div class="mkp">'
            + '<h3>' + SVG + '<span>' + esc(t('Maskot')) + ' ' + esc(s.jmeno) + '</span></h3>'
            + '<p>' + esc(t('Provází tě kartičkami, poznávačkou, cvičnými úlohami a odhady. Klepni na něj a poradí ti.')) + '</p>'
            + '<label><input type="checkbox" data-k="zap"' + (s.zap ? ' checked' : '') + '> ' + esc(t('Maskot mluví (vypnutý zůstane jen malá ikonka)')) + '</label>'
            + '<label>' + esc(t('Jméno')) + ' <input type="text" data-k="jmeno" maxlength="20" value="' + esc(s.jmeno) + '"></label>'
            + '<label><input type="checkbox" data-k="spolecnik"' + (s.spolecnik ? ' checked' : '') + '> ' + esc(t('Toti na hlavní obrazovce (komentuje, co děláš)')) + '</label>'
            + '<label>' + esc(t('Upovídanost')) + ' <select data-k="ukecanost">'
            + [['tichy', 'Jen když na něj klepnu'], ['obcas', 'Občas'], ['ukecany', 'Ukecaný']].map(function (o) { return '<option value="' + o[0] + '"' + (s.ukecanost === o[0] ? ' selected' : '') + '>' + esc(t(o[1])) + '</option>'; }).join('')
            + '</select></label>'
            + '<label><input type="checkbox" data-k="hlas"' + (s.hlas ? ' checked' : '') + '> ' + esc(t('Mluví nahlas a pípá laserem')) + '</label>'
            + (s.kviz && s.kviz.n ? '<p>' + esc(t('Kvíz:')) + ' ' + s.kviz.ok + ' / ' + s.kviz.n + ' ' + esc(t('správně')) + '</p>' : '')
            + '<b style="margin-top:4px;">' + esc(t('Vlastní hlášky')) + '</b>'
            + '<p>' + esc(t('Nahraj textový soubor: řádek [spravne], [spatne], [tip]… začíná skupinu, každý další řádek je jedna hláška. Nejlíp si stáhni vzor, uprav ho a nahraj zpátky.')) + '</p>'
            + '<p class="mkp-stav">' + (n ? esc(t('Nahraných vlastních hlášek:')) + ' ' + n : '') + '</p>'
            + '<button type="button" class="btn btn-primary" data-k="nahrat">' + esc(t('Nahrát soubor s hláškami')) + '</button>'
            + '<button type="button" class="btn btn-secondary" data-k="vzor">' + esc(t('Stáhnout vzor (.txt)')) + '</button>'
            + '<label><input type="checkbox" data-k="jen"' + (s.jenVlastni ? ' checked' : '') + '> ' + esc(t('Říkat jen moje hlášky')) + '</label>'
            + (n ? '<button type="button" class="btn btn-secondary" data-k="smazat">' + esc(t('Smazat vlastní hlášky')) + '</button>' : '')
            + '<button type="button" class="btn btn-secondary" data-k="zavrit" data-close>' + esc(t('Hotovo')) + '</button>'
            + '</div>';
        document.body.appendChild(ov);
        var stav = ov.querySelector('.mkp-stav');
        var zavri = function () { ov.remove(); };
        ov.addEventListener('click', function (e) {
            if (e.target === ov) return zavri();
            var b = e.target.closest('button[data-k]'); if (!b) return;
            var k = b.getAttribute('data-k');
            if (k === 'zavrit') return zavri();
            if (k === 'vzor') return stahni('maskot-hlasky.txt', vzor());
            if (k === 'smazat') { var x = nast(); x.vlastni = {}; x.jenVlastni = false; uloz(x); panel(); return; }
            if (k === 'nahrat') {
                var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.txt,.json,.csv,text/plain,application/json'; inp.style.display = 'none';
                document.body.appendChild(inp);
                inp.addEventListener('change', function () {
                    var f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
                    var rd = new FileReader();
                    rd.onload = function () {
                        var h = rozparsuj(rd.result), pocet = 0;
                        Object.keys(h).forEach(function (kk) { pocet += h[kk].length; });
                        if (!pocet) { stav.textContent = t('V souboru jsem nenašel žádnou hlášku.'); return; }
                        var x = nast(); x.vlastni = h; uloz(x);
                        stav.textContent = t('Nahráno hlášek:') + ' ' + pocet;
                        if (_akt && viditelny(_akt)) rekniDo(_akt, h.uvod ? 'uvod' : Object.keys(h)[0], { skore: 8, celkem: 10, serie: 3 }, 'radost');
                    };
                    rd.onerror = function () { stav.textContent = t('Soubor se nepodařilo přečíst.'); };
                    rd.readAsText(f);
                });
                inp.click();
            }
        });
        ov.addEventListener('change', function (e) {
            var k = e.target.getAttribute('data-k'), x = nast();
            if (k === 'zap') x.zap = !!e.target.checked;
            else if (k === 'jen') x.jenVlastni = !!e.target.checked;
            else if (k === 'spolecnik') x.spolecnik = !!e.target.checked;
            else if (k === 'ukecanost') x.ukecanost = e.target.value;
            else if (k === 'hlas') { x.hlas = !!e.target.checked; if (!x.hlas) { try { speechSynthesis.cancel(); } catch (er) { /* nic */ } } }
            else return;
            uloz(x); obnovVse();
        });
        ov.querySelector('input[data-k=jmeno]').addEventListener('input', function (e) {
            var x = nast(); x.jmeno = String(e.target.value || '').trim().slice(0, 20) || 'Toti'; uloz(x); obnovVse();
        });
        var esc2 = function (e) { if (!ov.isConnected) return document.removeEventListener('keydown', esc2); if (e.key === 'Escape') { zavri(); document.removeEventListener('keydown', esc2); } };
        document.addEventListener('keydown', esc2);
    }
    function stahni(jmeno, text) {
        try {
            var url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
            var a = document.createElement('a'); a.href = url; a.download = jmeno; document.body.appendChild(a); a.click();
            setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 1500);
        } catch (e) { swallow(e, 'stahni'); }
    }

    // =============================== TOTI 2 =====================================================
    // ---- hlas + pípnutí (f5, výchozí vypnuto) ----
    var _ac = null;
    function mluv(txt) {
        var s = nast(); if (!s.hlas || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
        try {
            speechSynthesis.cancel();
            var u = new SpeechSynthesisUtterance(String(txt).replace(/[„“"]/g, ''));
            u.lang = (window.AGJazyk && AGJazyk.locale) ? AGJazyk.locale() : 'cs-CZ'; u.rate = 1.05; u.pitch = 1.35;
            speechSynthesis.speak(u);
        } catch (e) { swallow(e, 'mluv'); }
    }
    function pip(dobre) {
        var s = nast(); if (!s.hlas) return;
        try {
            var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
            _ac = _ac || new AC();
            var o = _ac.createOscillator(), g = _ac.createGain(), t0 = _ac.currentTime;
            o.type = 'square'; o.frequency.setValueAtTime(dobre ? 1480 : 330, t0); if (dobre) o.frequency.setValueAtTime(1980, t0 + 0.07);
            g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dobre ? 0.16 : 0.25));
            o.connect(g); g.connect(_ac.destination); o.start(t0); o.stop(t0 + 0.3);
        } catch (e) { swallow(e, 'pip'); }
    }

    // ---- nabídka po klepnutí ----
    function menu(el) {
        rekniDo(el, 'menu', null, 'radost', { akce: [
            { l: t('Zeptej se mě'), fn: function () { kviz(el); } },
            { l: t('Vysvětli pojem'), fn: function () { vysvetli(el); } },
            { l: t('Poraď'), fn: function () { porad(el); } },
            { l: '⋯', fn: function () { panel(); } }
        ] });
    }

    // ---- kvíz a vysvětlování ze slovníku pojmů (grafika.js GEO_DICT) ----
    function pojmy() {
        return ((window.agGeoDict || [])).filter(function (p) { return p && p.t && p.d && String(p.t).length <= 48 && String(p.d).length >= 20; });
    }
    function zkrat(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
    function nahodne(a) { return a[Math.floor(Math.random() * a.length)]; }
    function kviz(el) {
        var P = pojmy(); if (P.length < 4) { rekniDo(el, 'tip', null, 'mysli'); return; }
        var c = nahodne(P), moz = [c], pokus = 0;
        while (moz.length < 3 && pokus++ < 50) { var o = nahodne(P); if (moz.every(function (m) { return m.t !== o.t; })) moz.push(o); }
        moz.sort(function () { return Math.random() - 0.5; });
        // definice bez samotného názvu (jinak by se odpověď prozradila)
        var def = t(c.d), nazev = t(c.t);
        try { def = def.replace(new RegExp(nazev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '…'); } catch (e) { /* nic */ }
        var otazka = vyber('otazka_uvod') + ' „' + zkrat(def, 190) + '“';
        rekniDo(el, 'otazka_uvod', null, 'mysli', { text: otazka, akce: moz.map(function (m) {
            return { l: t(m.t), fn: function (b, host) {
                var box = host.querySelector('.mk-akce'); box.querySelectorAll('button').forEach(function (x) { x.disabled = true; if (x.textContent === nazev) x.classList.add('ok'); });
                var dobre = m.t === c.t; if (!dobre) b.classList.add('bad');
                var s = nast(); s.kviz.n++; if (dobre) s.kviz.ok++; uloz(s);
                var skore = t('Kvíz:') + ' ' + s.kviz.ok + ' / ' + s.kviz.n;
                setTimeout(function () {
                    rekniDo(host, dobre ? 'spravne' : 'spatne', null, dobre ? 'radost' : 'smutek', {
                        text: vyber(dobre ? 'spravne' : 'spatne') + (dobre ? '' : ' ' + t('Správně je:') + ' ' + nazev + '.') + ' ' + zkrat(t(c.d), 160),
                        akce: [{ l: t('Další otázka'), fn: function () { kviz(host); } }, { l: t('Stačí'), fn: function () { host.classList.add('mk-ticho'); akce(host, null); } }],
                        skore: skore
                    });
                }, 650);
            } };
        }) });
    }
    function vysvetli(el) {
        var P = pojmy(); if (!P.length) { rekniDo(el, 'tip', null, 'mysli'); return; }
        var c = nahodne(P);
        rekniDo(el, 'vysvetli_uvod', null, 'mysli', { text: vyber('vysvetli_uvod') + ' ' + t(c.t) + ': ' + zkrat(t(c.d), 260),
            akce: [{ l: t('Další pojem'), fn: function () { vysvetli(el); } }, { l: t('Zeptej se mě'), fn: function () { kviz(el); } }] });
    }
    function porad(el) {
        var T = [];
        try { T = ((window.AGReg && AGReg.all()) || []).filter(function (r) { return r && !r.hidden && r.vl && r.vh; }); } catch (e) { T = []; }
        if (!T.length || Math.random() < 0.3) { rekniDo(el, 'tip', null, 'mysli', { akce: [{ l: t('Další rada'), fn: function () { porad(el); } }] }); return; }
        var r = nahodne(T);
        rekniDo(el, 'porad_uvod', null, 'radost', { text: vyber('porad_uvod') + ' ' + t(r.vl) + ' (' + t(r.vh) + ').', akce: [
            { l: t('Otevřít'), fn: function () { try { if (window.AGToolsHub && AGToolsHub.run) AGToolsHub.run(r.k); else if (typeof window[r.k] === 'function') window[r.k](); } catch (e) { swallow(e, 'otevrit'); } } },
            { l: t('Další rada'), fn: function () { porad(el); } }
        ] });
    }

    // ---- plovoucí Toti na hlavní obrazovce ----
    var _plovak = null;
    // co ho schová: otevřená okna, karta bodu, Geo kartičky (tam je vlastní), dialogy
    var ZAKRYVA = '.modal-overlay.ag-open, .modal-overlay[style*="flex"], .modal-overlay[style*="block"], .ag-dlg-overlay, #agsu[style*="block"], #ag-fb, #ag-fb-volba, #ag-mk-panel, #bottom-sheet.open, #side-menu.open, #ag-gate, #ag-login';
    function plovak() {
        if (_plovak && _plovak.isConnected) return _plovak;
        styl();
        _plovak = vytvor(false); _plovak.classList.add('mk-plovak', 'mk-ticho'); _plovak.id = 'ag-maskot-plovak';
        document.body.appendChild(_plovak);
        hlidejPlovak();
        return _plovak;
    }
    function zakryto() { try { return !!document.querySelector(ZAKRYVA) || !document.body.classList.contains('app-started'); } catch (e) { return false; } }
    function hlidejPlovak() {
        if (!_plovak) return;
        var s = nast();
        var skryt = !s.spolecnik || zakryto();
        _plovak.classList.toggle('mk-skryt', skryt);
        _plovak.classList.toggle('mk-off', !s.zap);
    }

    // ---- komentáře k dění v appce ----
    var UKEC = { tichy: null, obcas: { cd: 90000, p: 0.6, idle: 300000, gap: 1200000 }, ukecany: { cd: 20000, p: 0.95, idle: 120000, gap: 360000 } };
    var _kom = 0, _otazkaTs = 0, _dotyk = Date.now();
    var NALADA = { bod_ulozen: 'radost', milnik: 'radost', import: 'radost', gps_super: 'radost', online: 'radost', pozdrav_rano: 'radost', pozdrav_den: 'radost',
        bod_smazan: 'smutek', gps_spatne: 'smutek', offline: 'smutek', baterie: 'smutek', kamera: 'mysli', nastaveni: 'mysli' };
    function komentuj(kat, data, o) {
        o = o || {};
        var s = nast(); if (!s.zap || !s.spolecnik) return false;
        var u = UKEC[s.ukecanost]; if (!u && !o.vzdy) return false;
        var now = Date.now();
        if (!o.vzdy && (now - _kom < u.cd || Math.random() > u.p)) return false;
        var el = plovak(); hlidejPlovak();
        if (el.classList.contains('mk-skryt')) return false;
        _kom = now;
        rekniDo(el, kat, data, o.nalada || NALADA[kat] || 'mluvi', o);
        return true;
    }
    function pocetBodu() { try { return persistentCustomPoints.length; } catch (e) { return null; } }   // eslint-disable-line no-undef
    function posledniBod() { try { return persistentCustomPoints[persistentCustomPoints.length - 1]; } catch (e) { return null; } }   // eslint-disable-line no-undef
    var MILNIKY = [1, 10, 25, 50, 100, 250, 500, 1000];
    function obal(nazev, po) {
        var f = window[nazev];
        if (typeof f !== 'function' || f._mkObal) return;
        var g = function () {
            var pred = pocetBodu(), r = f.apply(this, arguments), args = arguments;
            try { setTimeout(function () { try { po(r, pred, pocetBodu(), args); } catch (e) { swallow(e, 'po:' + nazev); } }, 700); } catch (e) { /* nic */ }
            return r;
        };
        g._mkObal = true;
        try { Object.keys(f).forEach(function (k) { g[k] = f[k]; }); } catch (e) { /* nic */ }
        window[nazev] = g;
    }
    function bodPridan(pred, po) {
        if (pred == null || po == null || po <= pred) return;
        for (var i = 0; i < MILNIKY.length; i++) if (pred < MILNIKY[i] && po >= MILNIKY[i] && MILNIKY[i] > 1) { komentuj('milnik', { n: MILNIKY[i] }, { vzdy: nast().ukecanost !== 'tichy' }); return; }
        var b = posledniBod();
        komentuj(po - pred > 1 ? 'import' : 'bod_ulozen', { n: po - pred, bod: (b && b.name) || '' });
    }
    function napoj() {
        if (napoj._hotovo) return; napoj._hotovo = true;
        obal('saveCustomPoint', function (r, pred, po) { bodPridan(pred, po); });
        obal('addImportedPoints', function (r, pred, po) { bodPridan(pred, po); });
        obal('deleteCustomPoint', function (r, pred, po) { if (pred != null && po != null && po < pred) komentuj('bod_smazan'); });
        obal('openSettings', function () { komentuj('nastaveni'); });
        // nástroj z panelu Nástroje
        document.addEventListener('click', function (e) {
            _dotyk = Date.now();
            var r = e.target && e.target.closest && e.target.closest('#tools-modal .ag-uk-i[data-k]');
            if (!r) return;
            var l = (r.querySelector('b, .ag-uk-l, span') || r).textContent.trim().split('\n')[0].slice(0, 60);
            setTimeout(function () { komentuj('nastroj', { nastroj: l }); }, 1500);
        }, true);
        document.addEventListener('pointerdown', function () { _dotyk = Date.now(); }, true);
        window.addEventListener('offline', function () { komentuj('offline', null, { vzdy: nast().ukecanost !== 'tichy' }); });
        window.addEventListener('online', function () { komentuj('online'); });
        document.addEventListener('ag:jazyk', function () { setTimeout(function () { komentuj('jazyk', null, { vzdy: nast().ukecanost !== 'tichy' }); }, 900); });
        try {
            if (navigator.getBattery) navigator.getBattery().then(function (b) {
                var hlas = false;
                var chk = function () { if (!b.charging && b.level <= 0.15 && !hlas) { hlas = true; komentuj('baterie', { n: Math.round(b.level * 100) }, { vzdy: true }); } if (b.charging) hlas = false; };
                b.addEventListener('levelchange', chk); b.addEventListener('chargingchange', chk); chk();
            }).catch(function () { /* nic */ });
        } catch (e) { /* nic */ }
        // mapa ↔ kamera, přesnost GPS, nečinnost, okna — jedna levná smyčka
        var _view = null, _gpsDobre = 0, _gpsSpatne = 0;
        setInterval(function () {
            hlidejPlovak();
            var v = null; try { v = viewMode; } catch (e) { v = null; }   // eslint-disable-line no-undef
            if (_view && v && v !== _view) komentuj(v === 'map' ? 'mapa' : 'kamera');
            _view = v || _view;
            var now = Date.now(), f = window.AGFixRaw;
            if (f && now - f.ts < 30000 && isFinite(f.acc)) {
                if (f.acc <= 3 && now - _gpsDobre > 1200000) { if (komentuj('gps_super', { acc: f.acc.toFixed(1).replace('.', ',') })) _gpsDobre = now; }
                else if (f.acc >= 20 && now - _gpsSpatne > 600000) { if (komentuj('gps_spatne', { acc: Math.round(f.acc) })) _gpsSpatne = now; }
            }
            var u = UKEC[nast().ukecanost];
            if (u && document.visibilityState === 'visible' && now - _dotyk > u.idle && now - _otazkaTs > u.gap && _plovak && !_plovak.classList.contains('mk-skryt')) {
                _otazkaTs = now;
                komentuj('neaktivita', null, { vzdy: true, nalada: 'mysli', akce: [{ l: t('Ano, ptej se'), fn: function () { kviz(_plovak); } }, { l: t('Teď ne'), fn: function () { _plovak.classList.add('mk-ticho'); akce(_plovak, null); } }] });
            }
        }, 2000);
    }
    function pozdrav() {
        var s = nast(), now = Date.now();
        if (s.pozdravTs && now - s.pozdravTs < 3 * 3600000) return;
        var h = new Date().getHours();
        var kat = h >= 5 && h < 10 ? 'pozdrav_rano' : (h < 18 && h >= 10 ? 'pozdrav_den' : (h >= 18 && h < 22 ? 'pozdrav_vecer' : 'pozdrav_noc'));
        if (komentuj(kat, null, { vzdy: s.ukecanost !== 'tichy', akce: [{ l: t('Zeptej se mě'), fn: function () { kviz(_plovak); } }] })) { s = nast(); s.pozdravTs = now; uloz(s); }
    }
    function start() {
        if (start._hotovo) return; start._hotovo = true;
        plovak(); napoj();
        setTimeout(pozdrav, 4000);
    }
    (function cekej(n) {
        if (document.body && document.body.classList.contains('app-started')) return start();
        if (n > 240) return start();
        setTimeout(function () { cekej(n + 1); }, 500);
    })(0);

    window.AGMaskot = {
        pripoj: pripoj, rekni: rekni, nastaveni: panel, komentuj: komentuj, kviz: function () { kviz(plovak()); }, vysvetli: function () { vysvetli(plovak()); },
        _test: { rozparsuj: rozparsuj, vyber: vyber, hlasky: hlasky, vzor: vzor, H: H, KAT: KAT, plovak: plovak, menu: menu, hlidej: hlidejPlovak, reset: function () { _kom = 0; _otazkaTs = 0; } }
    };
})();
