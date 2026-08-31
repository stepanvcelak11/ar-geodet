// ===== AR Geodet — DVA LIDI NA JEDNÉ ZAKÁZCE: kolize bodů (ODPOJITELNÁ vrstva) ===
// PROBLÉM, KTERÝ TENHLE SOUBOR ŘEŠÍ: appka už umí sdílet zakázku mezi lidmi —
// js/cloud-sync.js protáhne body oběma směry každých 30 s a js/vysilacka.js
// ukáže, kde kolega stojí. Co ale NIKDO nepozná: že jste OBA změřili TÝŽ BOD.
//
// Stane se to snadno. Dva lidi si rozdělí obvod pozemku, potkají se u rohu a
// každý si ten roh vezme jako svůj. V seznamu pak leží dva body 40 cm od sebe,
// každý pod jiným jménem, a nikdo si toho nevšimne — dokud to nepraskne
// v kanceláři nad výkresem.
//
// ⚠ PROČ TO NEODCHYTÍ EXISTUJÍCÍ SYNCHRONIZACE: js/cloud-sync.js má findTwin(),
// ale ten hledá STEJNÉ JMÉNO a shodu souřadnic na 1e-7° (asi 1 cm). To je
// odstranění téhož ZÁZNAMU staženého dvakrát, ne rozpoznání téhož MÍSTA
// změřeného dvěma telefony. Dvě nezávislá mobilní určení téhož rohu se liší
// o decimetry až metry a mají různá jména — findTwin je nikdy nespojí.
//
// ⚠⚠ A PROČ TO APPKA NESMÍ ROZHODNOUT SAMA: dva body 80 cm od sebe můžou být
// TÝŽ roh změřený dvakrát — nebo dva SKUTEČNĚ RŮZNÉ body (roh budovy a roh
// obruby vedle něj). Z čísel to nikdo nepozná, protože přesnost mobilu je
// právě v tomhle řádu. Kdyby appka body slučovala automaticky, tiše by mazala
// poctivě změřená data. Proto tahle vrstva jen UPOZORNÍ a zeptá se.
//
// K ČEMU JE TO DOBRÉ NAVÍC (a proto to není jen hlídač chyb): když se potvrdí,
// že jde o tentýž bod, appka z toho udělá KONTROLNÍ MĚŘENÍ — a to je přesně
// ten druh údaje, který js/duvera.js hodnotí nejvýš. Dvě nezávislá určení
// s odstupem a z jiného telefonu dávají poctivou přesnost včetně systematiky.
// Kolega tedy omylem neudělal duplicitu, ale ověřil ti bod.
//
// ZDROJ DAT: událost 'ag:sync-points', kterou vyhlašuje js/cloud-sync.js po
// každém stažení. Nic se nedotazuje serveru navíc a neběží žádný nový časovač.
//
// ODSTRANĚNÍ VRSTVY: smaž js/kolize-bodu.js + css/kolize-bodu.css a jejich
// řádky v index.html. Událost v cloud-sync.js může zůstat, nikomu nevadí.
// ==============================================================================
(function () {
    'use strict';
    if (window.AGKolize) return;

    var MODAL_ID = 'ag-kol-modal';
    var LS_IGNOR = 'agKolizeIgnor1';    // dvojice, u kterých uživatel řekl „jsou to dva různé body"
    var PRAH = 1.5;                     // m — do téhle vzdálenosti to STOJÍ ZA DOTAZ
    var PRAH_MIN = 0.02;                // pod 2 cm to není dvojí měření, ale tentýž záznam

    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'kolize-bodu'); } catch (e2) { /* i hlášení chyby smí selhat */ } }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function body() {
        try { if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) return persistentCustomPoints; } catch (e) { swallow(e, 'kolize:body'); }
        return null;
    }
    function num(v) { return (Math.round(v * 100) / 100).toFixed(2).replace('.', ','); }

    // Vzdálenost v metrech. Používá se sdílené jádro appky, ne vlastní vzoreček —
    // getDistance je jediný testovaný převod (dřív byl o 1700 ppm krátký).
    function vzdalenost(a, b) {
        try { if (typeof getDistance === 'function') return getDistance(a.lat, a.lng, b.lat, b.lng); } catch (e) { swallow(e, 'kolize:vzdalenost'); }
        var dy = (b.lat - a.lat) * 111320;
        var dx = (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ---- seznam „tohle jsou dva různé body, neptej se znovu" ------------------
    function klicDvojice(a, b) {
        var x = String(a.id), y = String(b.id);
        return (x < y) ? (x + '|' + y) : (y + '|' + x);
    }
    function ignorovane() {
        try {
            var s = (typeof getStoredData === 'function') ? getStoredData(LS_IGNOR) : localStorage.getItem(LS_IGNOR);
            var d = s ? JSON.parse(s) : null;
            return (d && typeof d === 'object') ? d : {};
        } catch (e) { swallow(e, 'kolize:ignorovane'); return {}; }
    }
    function ulozIgnor(d) {
        try {
            var s = JSON.stringify(d);
            if (typeof setStoredData === 'function') setStoredData(LS_IGNOR, s);
            else localStorage.setItem(LS_IGNOR, s);
        } catch (e) { swallow(e, 'kolize:ulozIgnor'); }
    }

    // ---- hledání dvojic ------------------------------------------------------
    // Mřížka místo porovnávání každého s každým: u tisíce bodů by O(n²) byl
    // půlmilion výpočtů vzdálenosti při každé synchronizaci, tedy každých 30 s.
    // Buňka je o něco větší než práh, takže stačí projít 9 sousedních buněk.
    function najdi() {
        var P = body();
        if (!P || P.length < 2) return [];
        var ign = ignorovane();
        var stupen = PRAH / 111320 * 1.5;        // hrana buňky ve stupních šířky
        var kos = {};
        var i, p, gx, gy;
        for (i = 0; i < P.length; i++) {
            p = P[i];
            if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
            gx = Math.floor(p.lng / stupen); gy = Math.floor(p.lat / stupen);
            var kl = gx + ':' + gy;
            (kos[kl] || (kos[kl] = [])).push(p);
        }
        var out = [], videl = {};
        for (i = 0; i < P.length; i++) {
            p = P[i];
            if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
            gx = Math.floor(p.lng / stupen); gy = Math.floor(p.lat / stupen);
            for (var dx = -1; dx <= 1; dx++) {
                for (var dy = -1; dy <= 1; dy++) {
                    var sk = kos[(gx + dx) + ':' + (gy + dy)];
                    if (!sk) continue;
                    for (var j = 0; j < sk.length; j++) {
                        var q = sk[j];
                        if (!q || q === p || String(q.id) === String(p.id)) continue;
                        var kd = klicDvojice(p, q);
                        if (videl[kd] || ign[kd]) continue;
                        var d = vzdalenost(p, q);
                        if (!(d >= PRAH_MIN && d <= PRAH)) continue;
                        videl[kd] = 1;
                        out.push({ a: p, b: q, d: d, klic: kd });
                    }
                }
            }
        }
        // Nejtěsnější dvojice napřed — u těch je shoda nejpravděpodobnější.
        out.sort(function (x, y) { return x.d - y.d; });
        return out;
    }

    // ---- upozornění ----------------------------------------------------------
    function ohlas(n) {
        try {
            if (!window.AGNotify) return;
            if (!n) { AGNotify.clear('kolize'); return; }
            AGNotify.set('kolize', {
                level: 'warn',
                text: n === 1
                    ? 'Dva body leží skoro na sobě — nejde o tentýž bod změřený dvakrát?'
                    : (n + ' dvojic bodů leží skoro na sobě — nejde o tytéž body změřené dvakrát?'),
                action: 'Ukázat',
                onAction: otevri
            });
        } catch (e) { swallow(e, 'kolize:ohlas'); }
    }

    // ---- potvrzení: udělat z toho kontrolní měření ---------------------------
    // Zapisuje se PŘESNĚ do téhož tvaru, jaký používá js/dvoji-mereni.js
    // (prov.recheck + prov.trueAcc), aby protokol kvality, pečeť v kartě bodu
    // i js/duvera.js viděly jedno a totéž. Sigma se počítá jeho funkcí, ne
    // vlastní kopií vzorce.
    function jeToTyz(dvojice, rezim) {
        var A = dvojice.a, B = dvojice.b;
        // Starší určení je „původní bod", novější je „kontrola" — tak to sedí
        // s časovou logikou dvojího měření.
        var tA = (A.prov && A.prov.ts) || 0, tB = (B.prov && B.prov.ts) || 0;
        var p = (tA <= tB) ? A : B;          // původní
        var r = (tA <= tB) ? B : A;          // kontrolní (novější)

        var d = vzdalenost(p, r);
        var sg;
        try { sg = (window.AGRecheck && AGRecheck.sigmaFromDelta) ? AGRecheck.sigmaFromDelta(d) : { one: d / Math.SQRT2, mean: d / 2 }; }
        catch (e) { swallow(e, 'kolize:jeToTyz'); sg = { one: d / Math.SQRT2, mean: d / 2 }; }

        p.prov = p.prov || {};
        p.prov.recheck = {
            t1: (p.prov && p.prov.ts) || null,
            lat1: p.lat, lng1: p.lng,
            acc1: (p.prov && p.prov.acc != null) ? p.prov.acc : (p.acc != null ? p.acc : null),
            t2: (r.prov && r.prov.ts) || Date.now(),
            lat2: r.lat, lng2: r.lng,
            acc2: (r.prov && r.prov.acc != null) ? r.prov.acc : (r.acc != null ? r.acc : null),
            n2: 0,
            d: Math.round(d * 1000) / 1000,
            dH: (p.vyska != null && r.vyska != null) ? Math.round((r.vyska - p.vyska) * 1000) / 1000 : null,
            mode: rezim,
            // Odlišení od běžné kontroly: tohle určení nepochází z mého telefonu.
            odKolegy: true
        };
        if (rezim === 'mean') {
            p.lat = (p.lat + r.lat) / 2;
            p.lng = (p.lng + r.lng) / 2;
            if (p.vyska != null && r.vyska != null) p.vyska = (p.vyska + r.vyska) / 2;
        }
        p.prov.trueAcc = Math.round((rezim === 'mean' ? sg.mean : sg.one) * 1000) / 1000;

        // Druhý bod se SMAŽE, protože od téhle chvíle žije jako kontrola v tom
        // prvním. Kdyby zůstal, byla by ve výkresu pořád duplicita — jen by
        // o ní appka mlčela.
        smaz(r);

        // zrcadlo v arPoints (twin se stejným id), jinak by mapa i AR kreslily starou polohu
        try {
            if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                for (var i = 0; i < arPoints.length; i++) {
                    if (String(arPoints[i].id) === String(p.id)) {
                        arPoints[i].lat = p.lat; arPoints[i].lng = p.lng;
                        arPoints[i].prov = p.prov;
                        if (arPoints[i].element) { arPoints[i].element.remove(); arPoints[i].element = null; }
                    }
                }
            }
        } catch (e) { swallow(e, 'kolize:jeToTyz'); }

        uloz();
        prekresli();
    }

    function smaz(bod) {
        var P = body(); if (!P) return;
        for (var i = P.length - 1; i >= 0; i--) if (P[i] === bod || String(P[i].id) === String(bod.id)) P.splice(i, 1);
        try {
            if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                for (var j = arPoints.length - 1; j >= 0; j--) {
                    if (String(arPoints[j].id) === String(bod.id)) {
                        if (arPoints[j].element) arPoints[j].element.remove();
                        arPoints.splice(j, 1);
                    }
                }
            }
        } catch (e) { swallow(e, 'kolize:smaz'); }
        // Do žurnálu, ať je v historii vidět, že bod nezmizel sám od sebe.
        try { if (window.AGJournal) AGJournal.commit({ op: 'del', id: bod.id, before: bod, origin: 'kolize' }); } catch (e) { swallow(e, 'kolize:smaz'); }
    }

    function uloz() {
        try { if (typeof setStoredData === 'function') setStoredData('arCustomPoints12', JSON.stringify(body() || [])); }
        catch (e) { swallow(e, 'kolize:uloz'); }
    }
    function prekresli() {
        try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { swallow(e, 'kolize:prekresli'); }
        try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) { swallow(e, 'kolize:prekresli'); }
        try { if (typeof renderManageList === 'function') renderManageList(); } catch (e) { swallow(e, 'kolize:prekresli'); }
    }

    function ruzne(dvojice) {
        var d = ignorovane();
        d[dvojice.klic] = 1;
        ulozIgnor(d);
    }

    // ---- okno ----------------------------------------------------------------
    function radek(dv, i) {
        var A = dv.a, B = dv.b;
        function znak(p) {
            try { if (window.AGDuvera) return AGDuvera.odznak(p); } catch (e) { swallow(e, 'kolize:znak'); }
            return '';
        }
        function kdy(p) {
            var t = (p.prov && p.prov.ts) || null;
            if (!t) return 'neznámo kdy';
            var dd = new Date(t);
            return dd.getDate() + '. ' + (dd.getMonth() + 1) + '. ' + dd.getFullYear();
        }
        // Verdikt: sedí ta vzdálenost na to, co obě určení o sobě tvrdí?
        var ocek = null, hlaska = '';
        try {
            if (window.AGDuvera) {
                var va = AGDuvera.bod(A), vb = AGDuvera.bod(B);
                if (va.a != null && vb.a != null) {
                    ocek = Math.sqrt(va.a * va.a + vb.a * vb.a);
                    hlaska = (dv.d <= ocek)
                        ? 'Rozdíl sedí do toho, co obě měření o sobě tvrdí — vypadá to opravdu na tentýž bod.'
                        : 'Rozdíl je větší, než by podle obou přesností měl být. Buď to jsou dva různé body, nebo jedno z měření bylo rušené.';
                }
            }
        } catch (e) { swallow(e, 'kolize:radek'); }

        return '<div class="agkol-i" data-i="' + i + '">' +
            '<div class="agkol-hl"><b>' + esc(A.name || A.id) + '</b> × <b>' + esc(B.name || B.id) + '</b>' +
            '<span class="agkol-d">' + num(dv.d) + ' m od sebe</span></div>' +
            '<div class="agkol-dvoj">' +
            '<div class="agkol-p"><div class="agkol-jm">' + esc(A.name || A.id) + '</div><div class="agkol-m">' + esc(kdy(A)) + '</div>' + znak(A) + '</div>' +
            '<div class="agkol-p"><div class="agkol-jm">' + esc(B.name || B.id) + '</div><div class="agkol-m">' + esc(kdy(B)) + '</div>' + znak(B) + '</div>' +
            '</div>' +
            (hlaska ? '<div class="agkol-verdikt">' + esc(hlaska) + '</div>' : '') +
            '<div class="agkol-akce">' +
            '<button type="button" class="agkol-b prim" data-akce="mean" data-i="' + i + '">Tentýž bod — vzít průměr</button>' +
            '<button type="button" class="agkol-b" data-akce="keep" data-i="' + i + '">Tentýž bod — nechat můj</button>' +
            '<button type="button" class="agkol-b" data-akce="ruzne" data-i="' + i + '">Jsou to dva různé body</button>' +
            '</div></div>';
    }

    var _seznam = [];

    function vykresli() {
        var m = document.getElementById(MODAL_ID);
        if (!m) return;
        _seznam = najdi();
        var tl = m.querySelector('.agkol-telo');
        if (!tl) return;
        if (!_seznam.length) {
            tl.innerHTML = '<div class="agkol-note">Žádné body, které by ležely podezřele blízko sebe. ' +
                'Appka se ozve sama, jakmile se něco takového objeví po synchronizaci s kolegou.</div>';
            ohlas(0);
            return;
        }
        var h = '<div class="agkol-note">Tyhle body leží tak blízko u sebe, že to může být <b>tentýž bod změřený dvakrát</b> — třeba tebou a kolegou z druhé strany pozemku. ' +
            'Appka to sama nerozhodne: dva body 80 cm od sebe můžou být týž roh i dva skutečně různé body. ' +
            'Když potvrdíš, že jde o tentýž bod, použije se druhé určení jako <b>kontrolní měření</b> — a bod tím dostane poctivou přesnost.</div>';
        for (var i = 0; i < _seznam.length; i++) h += radek(_seznam[i], i);
        tl.innerHTML = h;

        var btns = tl.querySelectorAll('.agkol-b');
        for (var j = 0; j < btns.length; j++) {
            (function (b) {
                b.addEventListener('click', function () {
                    var idx = parseInt(b.getAttribute('data-i'), 10);
                    var akce = b.getAttribute('data-akce');
                    var dv = _seznam[idx];
                    if (!dv) return;
                    try {
                        if (akce === 'ruzne') ruzne(dv);
                        else jeToTyz(dv, akce === 'mean' ? 'mean' : 'keep');
                    } catch (e) { swallow(e, 'kolize:akce'); }
                    vykresli();
                });
            })(btns[j]);
        }
        ohlas(_seznam.length);
    }

    function zavri() {
        var m = document.getElementById(MODAL_ID);
        if (m) m.style.display = 'none';
    }

    function otevri() {
        try { if (window.AG && AG.cssFile) AG.cssFile('ag-kolize-css', 'css/kolize-bodu.css'); } catch (e) { swallow(e, 'kolize:css'); }
        var m = document.getElementById(MODAL_ID);
        if (!m) {
            m = document.createElement('div');
            m.id = MODAL_ID;
            // ⚠⚠ `modal-overlay`, NE `modal`. Třída `modal` v appce NEEXISTUJE (css/style.css
            //   zná jen `.modal-overlay` a `.modal-content`), takže tenhle <div> nedostal ani
            //   `position:fixed`, ani `inset:0`. A protože <body> je flex-sloupec (kamera +
            //   mapa), stal se z okna při `display:flex` TŘETÍ SLOUPEC LAYOUTU: ve splitu se
            //   vykreslilo MÍSTO MAPY, kamera nad ním zůstala běžet a zavřít to nešlo jinak
            //   než křížkem. Nahlášeno 31. 8. 2026 („Ročenka se mi zobrazuje místo mapy ve
            //   splitu a nechává mi to tam kameru"). NEVRACET.
            m.className = 'modal-overlay';
            m.innerHTML =
                '<div class="modal-content agkol-box">' +
                '<span class="close-btn" id="agkol-x" role="button" tabindex="0" aria-label="Zavřít">&times;</span>' +
                '<h2>Body na sobě</h2>' +
                '<div class="agkol-telo"></div>' +
                '</div>';
            document.body.appendChild(m);
            var x = m.querySelector('#agkol-x');
            if (x) {
                x.addEventListener('click', zavri);
                x.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); zavri(); } });
            }
        }
        m.style.display = 'flex';
        vykresli();
    }

    // ---- napojení na synchronizaci -------------------------------------------
    // Kontroluje se AŽ po stažení od kolegy, ne při každém vlastním uložení —
    // vlastní duplicity si člověk hlídá sám a upozorňovat na ně při každém
    // kliknutí by bylo otravné.
    var _cekaKontrola = null;
    try {
        document.addEventListener('ag:sync-points', function (ev) {
            var det = ev && ev.detail;
            if (det && !det.add && !det.edit) return;      // přišlo jen mazání
            if (_cekaKontrola) clearTimeout(_cekaKontrola);
            // Odklad: po synchronizaci se překresluje mapa i AR, ať se to nepere.
            _cekaKontrola = setTimeout(function () {
                _cekaKontrola = null;
                try { ohlas(najdi().length); } catch (e) { swallow(e, 'kolize:sync'); }
            }, 2500);
        });
    } catch (e) { swallow(e, 'kolize:listen'); }

    var IKONA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="10" cy="12" r="5"/><circle cx="15" cy="12" r="5"/></svg>';
    try {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'kolize-bodu', label: 'Body na sobě', icon: IKONA, cat: 'Měření', onClick: otevri });
        }
    } catch (e) { swallow(e, 'kolize:register'); }

    window.openKolizeBodu = otevri;
    window.AGKolize = { open: otevri, najdi: najdi, PRAH: PRAH };
})();
