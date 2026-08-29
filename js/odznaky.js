// ===== AR Geodet — ODZNAKY A SÉRIE: tiše (ODPOJITELNÁ vrstva) =================
// PROČ: appka má být něco, co si člověk zapne i doma. Odznaky to umí — ale
// jenom když nejsou otravné. Proto tahle vrstva dodržuje čtyři pravidla:
//
//   1. NIKDY NEVYSKOČÍ SAMA. Žádné vyskakovací okno, žádná notifikace, žádný
//      zvuk uprostřed měření. Odznaky se ukážou jen tam, kam si uživatel sám
//      došel — v Ročence. Geodet u výtyčky nechce potlesk.
//   2. NEJSOU TO ÚKOLY. Nikde nestojí „splň tohle a dostaneš odznak" a nikde
//      není ukazatel postupu k nesplněnému. To by z práce dělalo hru s cizími
//      pravidly. Odznak je POZOROVÁNÍ toho, co člověk odvedl, ne pobídka.
//   3. NIC, CO BY SVÁDĚLO K HORŠÍ PRÁCI. ZÁMĚRNĚ tu není žádný odznak za
//      rychlost, za počet bodů za hodinu ani za nejdelší nepřetržitou směnu.
//      Odměňovat spěch u měřické appky je vyloženě škodlivé — geodet by měl
//      měřit pomalu a dvakrát. Proto jediný „výkonnostní" odznak, který tu je,
//      je za KONTROLNÍ měření, tedy za pečlivost.
//   4. NIC SE NEPOSÍLÁ. Žádný žebříček, žádné sdílení, nic neopouští telefon.
//      Srovnávání s kolegy by z toho udělalo nástroj tlaku od firmy.
//
// ZDROJ DAT: totéž, co počítá js/rocenka.js — žádné nové měření a žádný další
// časovač. Tenhle soubor jen čte hotový přehled a rozhoduje, co v něm je vidět.
//
// SÉRIE: „kolik dnů po sobě jsi byl v terénu" se počítá z dnů, kdy vznikl
// aspoň jeden bod. ⚠ Víkendy a svátky se NEPŘERUŠUJÍ jako chyba — série se
// počítá přes pracovní dny, protože jinak by odznak trestal za to, že si
// člověk v sobotu nešel měřit. To je přesně ta past, kvůli které série
// v jiných appkách nutí lidi dělat blbosti.
//
// ODSTRANĚNÍ VRSTVY: smaž js/odznaky.js a jeho řádek v index.html. Ročenka si
// existenci téhle vrstvy ověřuje (`window.AGOdznaky && AGOdznaky.html`), takže
// se bez ní jen neukáže sekce s odznaky.
// ==============================================================================
(function () {
    'use strict';
    if (window.AGOdznaky) return;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'odznaky'); } catch (e2) { /* i hlášení chyby smí selhat */ } }

    // ---- série pracovních dnů ------------------------------------------------
    // Vrací nejdelší řadu PO SOBĚ JDOUCÍCH PRACOVNÍCH dnů, ve kterých vznikl bod.
    function serie(dny) {
        var kl = Object.keys(dny).sort();
        if (!kl.length) return { nej: 0, ted: 0 };
        function den(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
        // Posun na následující pracovní den (so/ne se přeskočí).
        function dalsiPracovni(d) {
            var n = new Date(d.getTime());
            do { n.setDate(n.getDate() + 1); } while (n.getDay() === 0 || n.getDay() === 6);
            return n;
        }
        function stejny(a, b) {
            return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
        }
        var nej = 1, cur = 1, ted = 1;
        for (var i = 1; i < kl.length; i++) {
            var prev = den(kl[i - 1]), now = den(kl[i]);
            if (stejny(dalsiPracovni(prev), now)) { cur++; }
            else { cur = 1; }
            if (cur > nej) nej = cur;
            ted = cur;
        }
        return { nej: nej, ted: ted };
    }

    // ---- kolik bodů má kontrolní měření --------------------------------------
    // Čte se z týchž bodů, ze kterých staví ročenku mapu — prov.recheck je
    // příznak, že bod byl změřen podruhé s odstupem (js/dvoji-mereni.js).
    function kontrolovanych(body) {
        var n = 0;
        for (var i = 0; i < body.length; i++) if (body[i] && body[i].kontrola) n++;
        return n;
    }

    // ---- seznam odznaků ------------------------------------------------------
    // Každý: { id, znak, nazev, popis, ma(d) -> true/false, hodnota(d) -> text }
    // `ma` rozhoduje, jestli se ukáže. Nesplněné se NEUKAZUJÍ VŮBEC (viz pravidlo 2).
    var ODZNAKY = [
        {
            id: 'prvni-bod', znak: '📍', nazev: 'První bod',
            popis: 'Změřil jsi svůj první bod.',
            ma: function (d) { return d.body.length >= 1; }
        },
        {
            id: 'sto-bodu', znak: '🎯', nazev: 'Sto bodů',
            popis: 'Sto změřených bodů za rok.',
            ma: function (d) { return d.body.length >= 100; },
            hodnota: function (d) { return d.body.length + ' bodů'; }
        },
        {
            id: 'maraton', znak: '👟', nazev: 'Maraton v terénu',
            popis: 'Nachodil jsi za rok přes 42 km — a to jen s appkou v ruce.',
            ma: function (d) { return d.souhrn.dist >= 42195; },
            hodnota: function (d) { return Math.round(d.souhrn.dist / 1000) + ' km'; }
        },
        {
            id: 'snezka', znak: '⛰', nazev: 'Výškař',
            popis: 'Nastoupáno tolik, co výstup na Sněžku.',
            ma: function (d) { return d.souhrn.up >= 1200; },
            hodnota: function (d) { return Math.round(d.souhrn.up) + ' m nahoru'; }
        },
        {
            id: 'peclivy', znak: '✔', nazev: 'Dvakrát měř',
            popis: 'Body, které jsi ověřil druhým měřením s odstupem. Tohle je jediné číslo přesnosti, které z telefonu dostaneš poctivě.',
            ma: function (d) { return kontrolovanych(d.body) >= 1; },
            hodnota: function (d) { return kontrolovanych(d.body) + ' ověřených bodů'; }
        },
        {
            id: 'serie', znak: '📅', nazev: 'Série',
            popis: 'Nejdelší řada pracovních dnů po sobě, kdy jsi byl v terénu. Víkendy sérii nepřerušují.',
            ma: function (d) { return d.serie.nej >= 3; },
            hodnota: function (d) { return d.serie.nej + ' dnů po sobě'; }
        },
        {
            id: 'cely-rok', znak: '🗓', nazev: 'Celý rok',
            popis: 'Měřil jsi aspoň v deseti různých měsících.',
            ma: function (d) { return d.mesicuSBody >= 10; },
            hodnota: function (d) { return d.mesicuSBody + ' měsíců'; }
        },
        {
            id: 'sirokosahly', znak: '🗺', nazev: 'Široký záběr',
            popis: 'Body od sebe vzdálené přes 50 km — za rok jsi projezdil pořádný kus republiky.',
            ma: function (d) { return d.rozpeti >= 50000; },
            hodnota: function (d) { return Math.round(d.rozpeti / 1000) + ' km napříč'; }
        }
    ];

    // ---- dopočet toho, co ročenka sama nepočítá ------------------------------
    function doplnky(d) {
        // dny a měsíce, ve kterých vznikl bod
        var dny = {}, mesice = {};
        d.body.forEach(function (b) {
            if (!b.ts) return;
            var t = new Date(b.ts);
            dny[t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')] = 1;
            mesice[t.getMonth()] = 1;
        });
        // největší vzdálenost mezi dvěma body (hrubě, přes ohraničující obdélník —
        // přesná dvojice by byla O(n²) a pro odznak to nemá cenu)
        var minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity;
        d.body.forEach(function (b) {
            if (b.lat < minLa) minLa = b.lat; if (b.lat > maxLa) maxLa = b.lat;
            if (b.lng < minLo) minLo = b.lng; if (b.lng > maxLo) maxLo = b.lng;
        });
        var rozpeti = 0;
        if (d.body.length > 1 && isFinite(minLa)) {
            var stred = (minLa + maxLa) / 2;
            var dy = (maxLa - minLa) * 111320;
            var dx = (maxLo - minLo) * 111320 * Math.cos(stred * Math.PI / 180);
            rozpeti = Math.sqrt(dx * dx + dy * dy);
        }
        return {
            body: d.body,
            souhrn: d.souhrn,
            serie: serie(dny),
            mesicuSBody: Object.keys(mesice).length,
            rozpeti: rozpeti
        };
    }

    var AGOdznaky = {};

    AGOdznaky.ziskane = function (prehled) {
        var d = doplnky(prehled);
        var out = [];
        ODZNAKY.forEach(function (o) {
            var ma = false;
            try { ma = !!o.ma(d); } catch (e) { swallow(e, 'odznaky:ziskane'); }
            if (!ma) return;
            var hod = '';
            try { hod = o.hodnota ? o.hodnota(d) : ''; } catch (e) { swallow(e, 'odznaky:ziskane'); }
            out.push({ id: o.id, znak: o.znak, nazev: o.nazev, popis: o.popis, hodnota: hod });
        });
        return { odznaky: out, serie: d.serie };
    };

    // HTML do Ročenky. Nesplněné odznaky se NEUKAZUJÍ — viz pravidlo 2 v hlavičce.
    AGOdznaky.html = function (prehled) {
        var v;
        try { v = AGOdznaky.ziskane(prehled); } catch (e) { swallow(e, 'odznaky:html'); return ''; }
        if (!v.odznaky.length) return '';
        var h = '<h3 class="agroc-h3">Co se povedlo</h3><div class="agodz">';
        v.odznaky.forEach(function (o) {
            h += '<div class="agodz-i">' +
                '<div class="agodz-z" aria-hidden="true">' + o.znak + '</div>' +
                '<div class="agodz-t">' +
                '<div class="agodz-n">' + esc(o.nazev) + (o.hodnota ? ' <span>' + esc(o.hodnota) + '</span>' : '') + '</div>' +
                '<div class="agodz-p">' + esc(o.popis) + '</div>' +
                '</div></div>';
        });
        h += '</div>';
        return h;
    };

    window.AGOdznaky = AGOdznaky;
})();
