# Pozvánka pro testery — uzavřený test v Google Play

Google vyžaduje u osobních vývojářských účtů **uzavřený test: 12 přihlášených
testerů nepřetržitě 14 dní**. Teprve pak se odemkne žádost o produkci.

⚠ **Pozvi jich 16–18, ne přesně 12.** Když počet přihlášených klesne pod
požadovaný práh, čtrnáctidenní okno se láme a začíná znovu. Rezerva je jediná
pojistka proti tomu, aby ti test resetoval jeden člověk, co appku smaže.

⚠ **Každý potřebuje vlastní Google účet a skutečný telefon s Androidem.**
Iphonáři se do testu započítat nedají — pro ně je „Přidat na plochu" v Safari
(návod v `PUBLIKACE.md`, část B).

Než rozešleš: v `ODKAZ` níže nahraď **opt-in odkaz** z Play Console
(*Testování → Uzavřené testování → Testeři → Zkopírovat odkaz*).

---

## A) Dlouhá verze — e-mail / Messenger

> **Předmět: Prosba o 5 minut — testuju appku QTRIG v Google Play**
>
> Ahoj,
>
> dodělávám appku **QTRIG** — terénní pomůcka pro geodety: hledání bodů
> bodového pole v rozšířené realitě, vytyčování osy se staničením, katastr,
> měření a export souřadnic. Všechno funguje i offline.
>
> Než ji Google pustí do obchodu, musím ji mít čtrnáct dní v uzavřeném testu
> a potřebuju k tomu aspoň 12 lidí. Prosím tě o tohle:
>
> **1.** Na telefonu s Androidem otevři tenhle odkaz a dej „Stát se testerem":
> ODKAZ
>
> **2.** Na téže stránce klikni na odkaz do Google Play a **appku nainstaluj**.
>
> **3.** Při prvním spuštění tě appka poprosí o **účet** — dej „Založit účet",
> jsou to tři políčka a nechce to e‑mail. Bez něj se dovnitř nedostaneš.
> Heslo si ulož, obnovit ho zatím nejde.
>
> **4.** A teď to hlavní: **nech si ji v telefonu aspoň 14 dní** a z testu se
> neodhlašuj. Používat ji nemusíš — stačí, že je nainstalovaná. Kdyby ji někdo
> smazal, celé čtrnáctidenní okno se láme a začínám znovu, takže mi tím fakt
> pomůžeš.
>
> Kdybys ji zkusil naostro v terénu, budu rád za cokoli — co je nepochopitelné,
> co chybí, co spadlo. Piš rovnou mně.
>
> Díky moc,
> Štěpán

---

## B) Krátká verze — SMS / WhatsApp

> Ahoj, dodělávám appku pro geodety a Google chce, aby ji 14 dní testovalo
> 12 lidí. Pomůžeš? Na Androidu otevři ODKAZ → „Stát se testerem" → nainstaluj
> z Play → při prvním spuštění dej **„Založit účet"** (tři políčka, bez e‑mailu).
> A pak už jen prosím **nemazat 14 dní**, používat nemusíš. Díky!

---

## ⚠⚠ ÚČET JE POVINNÝ — bez něj se tester dovnitř NEDOSTANE

Od 6. 9. 2026 je **hostovský režim zrušený**: appka má bránu hned při startu
(`js/ucty.js`) a bez profilu ji neotevře nikdo. Do té doby tři dlaždice fungovaly
i bez přihlášení, takže starší znění pozvánky o účtu vůbec nemluvilo — a člověk,
který si appku nainstaluje a narazí na přihlašovací obrazovku, ji nejspíš prostě
zavře. **Do pozvánky proto účet PATŘÍ, jinak se na tom zasekne dvanáct lidí naráz.**

Registrace je krátká (jméno, heslo, potvrzení), **nechce e‑mail** a udělá se přímo
v appce. ⚠ Právě proto, že e‑mail nemá, **heslo nejde obnovit** — komu se ztratí,
zakládá účet znovu a přijde o zakázku. Řekni jim, ať si ho uloží.

Totéž platí pro **kontrolora Googlu**: v Play Console → *Zásady → Obsah aplikace →
Přístup k aplikaci* musí být vyplněný demo účet, jinak vydání zamítnou
(viz `PUBLIKACE.md`, oddíl A4).

---

## C) Připomínka po pár dnech

> Ahoj, díky za přihlášení do testu QTRIGa. Jen prosba: **appku ještě
> ~10 dní nemaž** — Google počítá nepřetržitou dobu a když někdo vypadne, začíná
> se od nuly. Až to doběhne, dám vědět. Díky!

---

## Co si hlídat v Play Console

- *Testování → Uzavřené testování* ukazuje **počet přihlášených testerů**
  a **odpočet dnů**. Přihlášený ≠ pozvaný — počítají se jen ti, co klikli.
- Odpočet se rozjede až po **schválení vydání kontrolou**, ne po nahrání .aab.
- Po 14 dnech se objeví **Požádat o přístup k produkci**. V dotazníku odpovídej
  konkrétně: kolik testerů, jakou zpětnou vazbu jsi dostal, co jsi podle ní
  opravil. Odbytá odpověď je nejčastější důvod zamítnutí žádosti.

## Na co se testerů zeptat (ať máš co napsat do žádosti)

1. Nastartovala appka a viděl jsi mapu se svou polohou?
2. Fungovala kamera v AR pohledu a povolil telefon polohu?
3. Zkusil jsi založit bod? Bylo jasné jak?
4. Spadlo něco, zaseklo se něco, bylo něco nečitelné na slunci?
