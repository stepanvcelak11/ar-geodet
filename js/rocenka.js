// ===== AR Geodet — ROČENKA: rok a měsíc v číslech (ODPOJITELNÁ vrstva) ========
// PROČ TO EXISTUJE: appka o uživateli ví spoustu věcí — kolik nachodil, kolik
// bodů změřil, kde všude byl — a nikdy mu je neukáže jinak než jako dnešek.
// Tohle je jediná obrazovka, kterou si člověk zapne i doma na gauči, protože
// se na ni chce podívat, ne protože něco potřebuje vyřešit.
//
// ⚠⚠ PRVNÍ VĚC, KTEROU JSEM MUSEL VYŘEŠIT: „rok v číslech" NEJDE postavit na
// js/moje-aktivita.js. Ten drží podrobné dny v localStorage pod klíčem
// agAkt_v1 a má KEEP_DAYS = 120 — starší dny sám tiše zahazuje, protože
// localStorage není archiv. Postavit ročenku na něm by znamenalo, že v lednu
// ukáže „rok" od září. Proto:
//
//   1) MĚSÍČNÍ ARCHIV. Tenhle modul si z podrobných dnů skládá kompaktní
//      měsíční souhrny (jeden záznam na měsíc, pár set bajtů) a ukládá je do
//      IndexedDB přes js/ag-store.js. Ty už se nemažou. Archiv se tedy plní
//      OD TEĎ a prvních pár měsíců bude neúplných — appka to říká nahlas
//      místo aby předstírala, že ví víc.
//      Přepočet je IDEMPOTENTNÍ a NIKDY NEZMENŠUJE: měsíc se přepíše jen
//      tehdy, když nově spočítaný souhrn stojí na STEJNÉM NEBO VĚTŠÍM počtu
//      dnů než ten uložený. Jinak by měsíc, kterému už z okna 120 dnů vypadla
//      půlka, přepsal svou úplnou verzi tou osekanou.
//
//   2) BODY JAKO DRUHÝ, DELŠÍ ZDROJ. Změřené body nesou prov.ts (kdy vznikly)
//      a souřadnice a NEMAŽOU se — jsou to data zakázky. Takže počet bodů,
//      nejplodnější den a hlavně MAPA „kde jsem letos byl" jdou dohromady
//      i zpětně, dál než těch 120 dní. Čte se ze VŠECH zakázek, ne jen
//      z otevřené.
//
// CO SE ZÁMĚRNĚ NEDĚLÁ: nic se neměří navíc. Žádný nový GPS watch, žádný další
// časovač. Jen se čte, co appka stejně sbírá.
//
// SOUSEDNÍ MODULY, ať nevznikne dvojník:
//   • js/moje-aktivita.js — DNEŠEK a posledních pár dnů. Odtud jen ČTU.
//   • js/denik-dne.js     — jeden den jako text pro kancelář (doklad).
//   • js/plakat-dne.js    — jeden den jako obrázek.
//   • tenhle soubor       — MĚSÍC a ROK. Jiný horizont, jiná data.
//
// Otevírá se z Nástrojů: window.openRocenka().
//
// ODSTRANĚNÍ VRSTVY: smaž js/rocenka.js + css/rocenka.css a jejich řádky
// v index.html, js/tools-registry.js a data/navody.json.
// ==============================================================================
(function () {
    'use strict';
    if (window.AGRocenka) return;

    var MODAL_ID = 'ag-roc-modal';
    var POLICE = 'rocenka';
    var LS_AKT = 'agAkt_v1';

    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'rocenka'); } catch (e2) { /* i hlášení chyby smí selhat */ } }

    // ---- pomocné -------------------------------------------------------------
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function cislo(n, des) {
        if (n == null || !isFinite(n)) return '—';
        var v = (des ? n.toFixed(des) : String(Math.round(n)));
        // mezery v tisících, desetinná čárka — jako zbytek appky
        var p = v.split('.');
        p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        return p.join(',');
    }
    function mesicJmeno(m) {
        return ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec',
            'srpen', 'září', 'říjen', 'listopad', 'prosinec'][m] || '';
    }
    function police() {
        try { if (window.AGStore) return AGStore.shelf(POLICE); } catch (e) { swallow(e, 'rocenka:police'); }
        return null;
    }

    // ---- 1) měsíční archiv z js/moje-aktivita.js ------------------------------
    function aktivita() {
        try {
            var s = localStorage.getItem(LS_AKT);
            var d = s ? JSON.parse(s) : null;
            return (d && d.days) ? d.days : {};
        } catch (e) { swallow(e, 'rocenka:aktivita'); return {}; }
    }

    function prazdnyMesic() {
        return { dni: 0, ms: 0, dist: 0, up: 0, down: 0, steps: 0, pa: 0, pe: 0, pd: 0, tools: {} };
    }

    // Z podrobných dnů udělá měsíční souhrny. Vrací { 'RRRR-MM': souhrn }.
    function spoctiMesice(days) {
        var out = {};
        for (var k in days) {
            if (!Object.prototype.hasOwnProperty.call(days, k)) continue;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
            var d = days[k] || {};
            // Den, ve kterém uživatel appku jen otevřel a nic nedělal, se do
            // „dnů v terénu" nepočítá — jinak by číslo neznamenalo nic.
            var neco = (d.dist > 100) || (d.pts && (d.pts.a || d.pts.e || d.pts.d)) || (d.ms > 5 * 60000);
            var m = k.slice(0, 7);
            if (!out[m]) out[m] = prazdnyMesic();
            var o = out[m];
            if (neco) o.dni++;
            o.ms += d.ms || 0;
            o.dist += d.dist || 0;
            o.up += d.up || 0;
            o.down += d.down || 0;
            o.steps += d.steps || 0;
            if (d.pts) { o.pa += d.pts.a || 0; o.pe += d.pts.e || 0; o.pd += d.pts.d || 0; }
            if (d.tools) {
                for (var t in d.tools) {
                    if (!Object.prototype.hasOwnProperty.call(d.tools, t)) continue;
                    o.tools[t] = (o.tools[t] || 0) + d.tools[t];
                }
            }
        }
        return out;
    }

    // Uloží měsíce do archivu. NIKDY NEZMENŠÍ — viz rozbor v hlavičce.
    function ulozArchiv(nove) {
        var p = police();
        if (!p) return Promise.resolve(0);
        var mesice = Object.keys(nove);
        return Promise.all(mesice.map(function (m) {
            return p.get(m).then(function (stary) {
                if (stary && stary.dni != null && stary.dni > nove[m].dni) {
                    // Uložený měsíc stojí na víc dnech než ten, co jde spočítat
                    // teď — část dnů už z okna 120 dnů vypadla. Nechat starý.
                    return false;
                }
                return p.put(m, nove[m]);
            });
        })).then(function (r) { return r.filter(Boolean).length; });
    }

    function nactiArchiv() {
        var p = police();
        if (!p) return Promise.resolve({});
        return p.all().then(function (rows) {
            var out = {};
            rows.forEach(function (r) { if (r && r.k && r.v) out[r.k] = r.v; });
            return out;
        }).catch(function (e) { swallow(e, 'rocenka:nactiArchiv'); return {}; });
    }

    // ---- 2) body ze VŠECH zakázek --------------------------------------------
    // Klíče mají tvar `<idZakazky>_arCustomPoints12`. Čtou se z IndexedDB
    // (js/logika.js je tam ukládá) i z localStorage (starší zakázky a záloha).
    function vsechnyBody() {
        var out = [];
        function pridej(json) {
            try {
                var arr = JSON.parse(json);
                if (!Array.isArray(arr)) return;
                arr.forEach(function (p) {
                    if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
                    var ts = (p.prov && p.prov.ts) || p.t || null;
                    // `kontrola` = bod byl změřen podruhé s odstupem (js/dvoji-mereni.js).
                    // Nese ho js/odznaky.js pro odznak „Dvakrát měř" — jediný
                    // výkonnostní odznak, který v appce je, protože odměňuje
                    // pečlivost, ne rychlost.
                    out.push({ lat: p.lat, lng: p.lng, ts: ts, kontrola: !!(p.prov && p.prov.recheck) });
                });
            } catch (e) { swallow(e, 'rocenka:pridej'); }
        }
        // localStorage
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('arCustomPoints12') >= 0) pridej(localStorage.getItem(k));
            }
        } catch (e) { swallow(e, 'rocenka:vsechnyBody'); }
        // IndexedDB
        if (!window.AGStore) return Promise.resolve(out);
        var sh = AGStore.adopt('argeodet', 'kv');
        return sh.keys().then(function (ks) {
            var chci = ks.filter(function (k) { return k.indexOf('arCustomPoints12') >= 0; });
            return Promise.all(chci.map(function (k) { return sh.get(k); }));
        }).then(function (vals) {
            vals.forEach(function (v) { if (typeof v === 'string') pridej(v); });
            // Tentýž bod může být v localStorage i v IndexedDB (záloha při
            // selhání zápisu) — bez odstranění duplicit by se počítal dvakrát.
            var videl = {}, uniq = [];
            out.forEach(function (b) {
                var kl = b.lat.toFixed(6) + ',' + b.lng.toFixed(6) + ',' + (b.ts || 0);
                if (videl[kl]) return;
                videl[kl] = 1; uniq.push(b);
            });
            return uniq;
        }).catch(function (e) { swallow(e, 'rocenka:vsechnyBody'); return out; });
    }

    // ---- sestavení přehledu --------------------------------------------------
    function sestav(rok) {
        var dnes = new Date();
        var cilRok = rok || dnes.getFullYear();
        return Promise.resolve()
            .then(function () { return ulozArchiv(spoctiMesice(aktivita())); })
            .then(nactiArchiv)
            .then(function (archiv) {
                return vsechnyBody().then(function (body) { return { archiv: archiv, body: body }; });
            })
            .then(function (d) {
                var souhrn = prazdnyMesic();
                var mesice = [];
                var prvniMesic = null;
                for (var m = 0; m < 12; m++) {
                    var kl = cilRok + '-' + (m < 9 ? '0' : '') + (m + 1);
                    var z = d.archiv[kl];
                    mesice.push({ m: m, klic: kl, data: z || null });
                    if (!z) continue;
                    if (prvniMesic == null) prvniMesic = m;
                    souhrn.dni += z.dni || 0;
                    souhrn.ms += z.ms || 0;
                    souhrn.dist += z.dist || 0;
                    souhrn.up += z.up || 0;
                    souhrn.down += z.down || 0;
                    souhrn.steps += z.steps || 0;
                    souhrn.pa += z.pa || 0; souhrn.pe += z.pe || 0; souhrn.pd += z.pd || 0;
                    for (var t in (z.tools || {})) {
                        if (!Object.prototype.hasOwnProperty.call(z.tools, t)) continue;
                        souhrn.tools[t] = (souhrn.tools[t] || 0) + z.tools[t];
                    }
                }
                // body toho roku
                var od = new Date(cilRok, 0, 1).getTime();
                var doo = new Date(cilRok + 1, 0, 1).getTime();
                var bodyRoku = d.body.filter(function (b) { return b.ts && b.ts >= od && b.ts < doo; });
                var bezData = d.body.filter(function (b) { return !b.ts; }).length;

                // nejplodnější den podle bodů
                var podleDnu = {};
                bodyRoku.forEach(function (b) {
                    var k = new Date(b.ts);
                    var kl2 = k.getFullYear() + '-' + String(k.getMonth() + 1).padStart(2, '0') + '-' + String(k.getDate()).padStart(2, '0');
                    podleDnu[kl2] = (podleDnu[kl2] || 0) + 1;
                });
                var nejDen = null;
                for (var dk in podleDnu) {
                    if (!Object.prototype.hasOwnProperty.call(podleDnu, dk)) continue;
                    if (!nejDen || podleDnu[dk] > nejDen.n) nejDen = { den: dk, n: podleDnu[dk] };
                }
                var dnuSBody = Object.keys(podleDnu).length;

                return {
                    rok: cilRok,
                    souhrn: souhrn,
                    mesice: mesice,
                    body: bodyRoku,
                    bodyCelkem: d.body.length,
                    bodyBezData: bezData,
                    nejDen: nejDen,
                    dnuSBody: dnuSBody,
                    prvniMesic: prvniMesic,
                    archivMesicu: Object.keys(d.archiv).length
                };
            });
    }

    // ---- mapa „kde jsem byl" -------------------------------------------------
    // Rovnoběžná (equirectangular) projekce se stlačením podle zeměpisné šířky —
    // na velikosti jedné země je to k nerozeznání od správné projekce a nepotřebuje
    // to proj4 (ten je sice v appce, ale kreslíme obrázek, ne geodézii).
    function kresliMapu(cv, body) {
        if (!cv) return;
        var ctx = cv.getContext('2d');
        var W = cv.width, H = cv.height;
        ctx.clearRect(0, 0, W, H);
        if (!body.length) return;

        var minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity;
        body.forEach(function (b) {
            if (b.lat < minLa) minLa = b.lat; if (b.lat > maxLa) maxLa = b.lat;
            if (b.lng < minLo) minLo = b.lng; if (b.lng > maxLo) maxLo = b.lng;
        });
        var stred = (minLa + maxLa) / 2;
        var k = Math.cos(stred * Math.PI / 180) || 1;
        var sirka = Math.max(1e-6, (maxLo - minLo) * k);
        var vyska = Math.max(1e-6, maxLa - minLa);
        var pad = 26;
        var s = Math.min((W - 2 * pad) / sirka, (H - 2 * pad) / vyska);
        var ox = (W - sirka * s) / 2, oy = (H - vyska * s) / 2;
        function X(lo) { return ox + (lo - minLo) * k * s; }
        function Y(la) { return H - (oy + (la - minLa) * s); }

        // Body obarvené podle měsíce — z obrázku je pak vidět, jak se práce
        // v roce stěhovala.
        for (var i = 0; i < body.length; i++) {
            var b = body[i];
            var m = b.ts ? new Date(b.ts).getMonth() : 6;
            var odstin = 160 + Math.round(m / 11 * 160);        // zelená → modrá → fialová
            ctx.beginPath();
            ctx.arc(X(b.lng), Y(b.lat), 2.6, 0, Math.PI * 2);
            ctx.fillStyle = 'hsla(' + odstin + ', 70%, 58%, 0.85)';
            ctx.fill();
        }

        // Měřítko: bez něj je to jen skvrna a nikdo nepozná, jestli je to okres
        // nebo jedna zahrada.
        var metruNaPx = 111320 * (vyska / (vyska * s));   // = 111320 / s
        var cil = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
        var delka = null, popis = '';
        for (var c = 0; c < cil.length; c++) {
            var px = cil[c] / metruNaPx;
            if (px > 40 && px < W * 0.45) { delka = px; popis = cil[c] >= 1000 ? (cil[c] / 1000) + ' km' : cil[c] + ' m'; break; }
        }
        if (delka) {
            ctx.strokeStyle = 'rgba(255,255,255,0.55)';
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(pad, H - 14); ctx.lineTo(pad + delka, H - 14);
            ctx.moveTo(pad, H - 18); ctx.lineTo(pad, H - 10);
            ctx.moveTo(pad + delka, H - 18); ctx.lineTo(pad + delka, H - 10);
            ctx.stroke();
            ctx.font = '600 11px system-ui, sans-serif';
            ctx.fillText(popis, pad + delka + 8, H - 10);
        }
    }

    // ---- vykreslení okna -----------------------------------------------------
    function velkeCislo(hodnota, popisek, pod) {
        return '<div class="agroc-big"><div class="agroc-n">' + hodnota + '</div>' +
            '<div class="agroc-l">' + esc(popisek) + '</div>' +
            (pod ? '<div class="agroc-s">' + esc(pod) + '</div>' : '') + '</div>';
    }

    function nejNastroj(tools) {
        var nej = null;
        for (var t in tools) {
            if (!Object.prototype.hasOwnProperty.call(tools, t)) continue;
            if (!nej || tools[t] > nej.ms) nej = { k: t, ms: tools[t] };
        }
        if (!nej) return null;
        var jmeno = nej.k;
        // Popisek: nejdřív to, co si zapsala js/moje-aktivita.js přímo z dlaždice
        // (umí pojmenovat i nástroj, který v registru není), pak registr.
        // ⚠ AGReg.label() NEEXISTUJE — registr vystavuje get(k) a popisek je v poli `vl`.
        try {
            var lbl = JSON.parse(localStorage.getItem('agAktLabels_v1') || '{}');
            if (lbl && lbl[nej.k]) jmeno = lbl[nej.k];
            else if (window.AGReg && AGReg.get) {
                var r = AGReg.get(nej.k);
                if (r && r.vl) jmeno = r.vl;
            }
        } catch (e) { swallow(e, 'rocenka:nejNastroj'); }
        return { jmeno: jmeno, ms: nej.ms };
    }

    function telo(d) {
        var s = d.souhrn;
        var km = s.dist / 1000;
        var hod = s.ms / 3600000;
        var nej = nejNastroj(s.tools);
        // Výškové metry se líp představí jako něco známého než jako číslo.
        var snezka = 1603 - 400;   // převýšení běžného výstupu, ne nadmořská výška
        var vystupu = s.up > 0 ? (s.up / snezka) : 0;

        var h = '<div class="agroc-head">' +
            '<button type="button" class="agroc-rok" data-rok="' + (d.rok - 1) + '" aria-label="Předchozí rok">‹</button>' +
            '<div class="agroc-rok-t">' + d.rok + '</div>' +
            '<button type="button" class="agroc-rok" data-rok="' + (d.rok + 1) + '" aria-label="Další rok">›</button>' +
            '</div>';

        // Poctivost na prvním místě: uživatel musí vědět, od kdy appka počítá.
        if (d.archivMesicu < 3) {
            h += '<div class="agroc-note">Ročenka se plní od chvíle, kdy jsi ji poprvé otevřel — podrobnou denní aktivitu si appka drží jen 120 dní zpět a starší už nemá kde vzít. ' +
                'Body a mapa jsou úplné (ty se nemažou), ale nachozené kilometry a čas budou první měsíce neúplné.</div>';
        }

        h += '<div class="agroc-grid">' +
            velkeCislo(cislo(km, km < 100 ? 1 : 0) + '<span>km</span>', 'nachozeno', s.dist ? null : 'zatím nic nezměřeno') +
            velkeCislo(cislo(d.body.length), d.body.length === 1 ? 'změřený bod' : 'změřených bodů', d.bodyBezData ? (d.bodyBezData + ' bez data') : null) +
            velkeCislo(cislo(d.dnuSBody), 'dnů v terénu', s.dni && s.dni !== d.dnuSBody ? ('appka běžela ' + s.dni + ' dnů') : null) +
            velkeCislo(cislo(s.up) + '<span>m</span>', 'nastoupáno', vystupu >= 0.5 ? ('jako ' + cislo(vystupu, 1) + '× na Sněžku') : null) +
            '</div>';

        h += '<div class="agroc-podgrid">' +
            '<div class="agroc-radek"><span>Čas v appce</span><b>' + (hod >= 1 ? cislo(hod, 1) + ' h' : cislo(s.ms / 60000) + ' min') + '</b></div>' +
            '<div class="agroc-radek"><span>Kroků</span><b>' + cislo(s.steps) + '</b></div>' +
            (nej ? '<div class="agroc-radek"><span>Nejpoužívanější nástroj</span><b>' + esc(nej.jmeno) + '</b></div>' : '') +
            (d.nejDen ? '<div class="agroc-radek"><span>Nejplodnější den</span><b>' + esc(d.nejDen.den) + ' — ' + d.nejDen.n + ' bodů</b></div>' : '') +
            '</div>';

        // mapa
        h += '<h3 class="agroc-h3">Kde jsi letos byl</h3>';
        if (d.body.length) {
            h += '<div class="agroc-mapa"><canvas id="agroc-cv" width="720" height="420"></canvas></div>' +
                '<div class="agroc-mapa-pod">Každá tečka je jeden změřený bod, barva podle měsíce. ' +
                'Jsou to tvoje data z telefonu — nikam se neposílají.</div>';
        } else {
            h += '<div class="agroc-note">V tomhle roce zatím nemáš žádný změřený bod s datem.</div>';
        }

        // měsíční proužek
        h += '<h3 class="agroc-h3">Po měsících</h3><div class="agroc-mes">';
        var maxKm = 0;
        d.mesice.forEach(function (m) { if (m.data && m.data.dist > maxKm) maxKm = m.data.dist; });
        d.mesice.forEach(function (m) {
            var v = m.data ? m.data.dist : 0;
            var vyskaP = maxKm > 0 ? Math.max(2, Math.round(v / maxKm * 100)) : 2;
            h += '<div class="agroc-mes-i' + (m.data ? '' : ' prazdny') + '" title="' + esc(mesicJmeno(m.m)) + (m.data ? ': ' + cislo(v / 1000, 1) + ' km, ' + (m.data.dni || 0) + ' dnů' : ': nic') + '">' +
                '<div class="agroc-mes-b" style="height:' + vyskaP + '%"></div>' +
                '<div class="agroc-mes-l">' + esc(mesicJmeno(m.m).slice(0, 3)) + '</div>' +
                '</div>';
        });
        h += '</div>';

        // odznaky (js/odznaky.js) — když vrstva není, sekce se prostě neukáže
        try {
            if (window.AGOdznaky && AGOdznaky.html) h += AGOdznaky.html(d);
        } catch (e) { swallow(e, 'rocenka:odznaky'); }

        return h;
    }

    function zavri() {
        var m = document.getElementById(MODAL_ID);
        if (m) m.style.display = 'none';
    }

    function vykresli(rok) {
        var m = document.getElementById(MODAL_ID);
        if (!m) return;
        var tl = m.querySelector('.agroc-telo');
        if (tl) tl.innerHTML = '<div class="agroc-note">Počítám…</div>';
        sestav(rok).then(function (d) {
            var tl2 = m.querySelector('.agroc-telo');
            if (!tl2) return;
            tl2.innerHTML = telo(d);
            kresliMapu(document.getElementById('agroc-cv'), d.body);
            var tl3 = m.querySelectorAll('.agroc-rok');
            for (var i = 0; i < tl3.length; i++) {
                (function (b) {
                    b.addEventListener('click', function () { vykresli(parseInt(b.getAttribute('data-rok'), 10)); });
                })(tl3[i]);
            }
        }).catch(function (e) {
            swallow(e, 'rocenka:vykresli');
            var tl4 = m.querySelector('.agroc-telo');
            if (tl4) tl4.innerHTML = '<div class="agroc-note">Ročenku se nepodařilo sestavit. Podrobnosti jsou v protokolu chyb (Nastavení → Co appka hlásí).</div>';
        });
    }

    function otevri() {
        try { if (window.AG && AG.cssFile) AG.cssFile('ag-rocenka-css', 'css/rocenka.css'); } catch (e) { swallow(e, 'rocenka:css'); }
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
                '<div class="modal-content agroc-box">' +
                '<span class="close-btn" id="agroc-x" role="button" tabindex="0" aria-label="Zavřít">&times;</span>' +
                '<h2>Ročenka</h2>' +
                '<div class="agroc-telo"></div>' +
                '</div>';
            document.body.appendChild(m);
            var x = m.querySelector('#agroc-x');
            if (x) {
                x.addEventListener('click', zavri);
                x.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); zavri(); } });
            }
        }
        m.style.display = 'flex';
        vykresli(new Date().getFullYear());
    }

    // ---- dlaždice v Nástrojích ------------------------------------------------
    var IKONA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/><circle cx="19" cy="6" r="1.6"/></svg>';
    try {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'rocenka', label: 'Ročenka', icon: IKONA, onClick: otevri });
        }
    } catch (e) { swallow(e, 'rocenka:register'); }

    window.openRocenka = otevri;
    window.AGRocenka = { open: otevri, sestav: sestav };
})();
