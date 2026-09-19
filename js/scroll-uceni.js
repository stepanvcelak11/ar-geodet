// ===== QTRIG — GEO KARTIČKY (dřív Scrolluj a uč se): kartičky na posouvání (ODPOJITELNÁ, lazy nástroj) ====
// (17. 9. 2026, přání uživatele: „scrollovací vzdělání — narážka na dnešní dobu, kdy se prostě
// scrolluje: informační kartičky, které se posouvají scrollováním")
//
// CO DĚLÁ: celoobrazovkový svislý feed (scroll-snap, jedna karta = jedna obrazovka), palcem nahoru
// = další karta. Kartičky se skládají z toho, co appka už má — nic se nepíše dvakrát:
//   • POJEM      — geodetický slovník (window.agGeoDict z grafika.js, 44 pojmů)
//   • VZOREC     — Vzorce (AGVzorce.sekce), s odkazem Spočítat v Kalkulačce
//   • PŘEDPIS    — data/predpisy.json (Katastrální vyhláška, odchylky, kódy kvality…)
//   • OTÁZKA     — data/ulohy.json (zadání → klepnutím odkryješ výsledek, Spočítat = Cvičné úlohy)
//   • NÁSTROJ    — „Věděl jsi, že appka umí…" z registru nástrojů (data/navody.json), Otevřít
//   • TIP        — pár tipů z terénu (vestavěné níž)
// Pořadí: neviděné napřed, promíchané (jiný seed každý den). Filtry nahoře (Vše · Pojmy · Vzorce ·
// Předpisy · Otázky · Nástroje · Tipy · ★ Uložené). Uložené ★ a viděné se pamatují (localStorage,
// společné pro zakázky). Počítadlo „dnes N · celkem M / K".
// V Základu, bez zámku (sekce Učit se). Odstranění: smaž js/scroll-uceni.js + css/scroll-uceni.css,
// řádek v MANIFESTu js/lazy-tools.js, klíč 'scroll-uceni' v js/tools-registry.js a data/navody.json.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGScrollUceni) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'scroll-uceni:' + kde); } catch (e2) { /* nic */ } };
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/><path d="M12 1v2M12 21v2"/></svg>';
    var KEY = 'agScrollUceni_v1';
    var st = { videne: {}, ulozene: {}, dny: {} };
    try { var s0 = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s0) { st.videne = s0.videne || {}; st.ulozene = s0.ulozene || {}; st.dny = s0.dny || {}; } } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }
    function dnes() { return new Date().toISOString().slice(0, 10); }

    var TIPY = [
        { n: 'Proč se GPS plete o metry', d: 'Telefon nemá korekce (RTK) — chyba 2–5 m je systematická, ne šum. Průměrování 60 s ji zmenší jen trochu; u zdi a pod stromy vůbec. Oprav ji podle známého bodu nebo hrany (Korekce GPS).' },
        { n: 'Stůj na volném nebi', d: 'Nejlepší příjem je s výhledem na oblohu od 10° nad obzorem dokola. Fasáda vedle tebe zakryje půl nebe a přidá odrazy (multipath) — odstup 10 m od zdi dělá víc než minuta průměrování.' },
        { n: 'Bod dohledávej od hran, ne od GPS', d: 'Roh budovy, obruba, sloup — to jsou v mapě a v katastru na decimetry. Oměrné od dvou hran najdou bod přesněji než jakákoli GPS v telefonu.' },
        { n: 'Kompas kazí kov', d: 'Auto, zábradlí, bagr, i kovový pásek na hodinkách. Před vytyčováním srovnej sever podle známého bodu nebo Slunce, ne podle magnetky.' },
        { n: 'Výška z GPS = elipsoid', d: 'Telefon dává výšku nad elipsoidem WGS84. Bpv je o hodnotu geoidu níž (v ČR ~44–46 m). Appka to přepočítává (EGM2008), ale ±5 m ve výšce je pro GPS normální.' },
        { n: 'Kalibrace chůzí po hraně', d: 'Jdi 20 m podél hrany, kterou máš v mapě (plot, obruba). Appka z toho spočítá, o kolik GPS ujíždí kolmo na hranu, a opraví další body.' },
        { n: 'Tíhový bod není polohový', d: 'Tíhové body (ZTBP) mají v ČÚZK jen orientační polohu a bývají uvnitř budov. Na kotvení GPS se nehodí — bereš TB, ZhB nebo PPBP.' },
        { n: 'Nivelační značka je ve zdi', d: 'Čepová nebo hřebová značka ve fasádě — výška se vztahuje k hornímu okraji čepu / k hlavě hřebu. V mapě je bod „na zdi", ve 3D ho uvidíš jako sloupek nad terénem.' },
        { n: 'Kódy kvality 3–8', d: 'Kód 3 = mxy 0,14 m (měřeno v terénu), kód 8 = mxy 1,0 m (digitalizace staré mapy). Než hledáš bod podle katastru, podívej se na kód — u 6–8 hledáš plochu, ne bod.' },
        { n: 'Čas a Slunce jako záloha severu', d: 'Známý čas + poloha = azimut Slunce na desetinu stupně. Když kompas ujíždí, stín tyče je spolehlivější než magnetometr.' },
        { n: 'Severka = pravý sever', d: 'Hvězdy jsou nejstarší geodetická síť: azimut ze Severky, šířka z její výšky nad obzorem, délka z času průchodu hvězdy poledníkem — tak se orientovaly Laplaceovy body i S-JTSK. Severka je do 1° od pólu, zbytek se dopočítá z času; magnetka lže o stupně, Severka ne. V appce: Kompas → Zkontrolovat podle Severky.' },
        { n: 'Ověř si pásmo pásmem', d: 'Každá oměrná z appky je jen tak dobrá, jak dobrá je poloha telefonu. Než zapíšeš, přeměř jednu délku pásmem — je to 20 sekund a rozhodne to o všem ostatním.' },
        { n: 'Trasa terénem obchází, ale neví o všem', d: 'Budovy, voda, dálnice, koleje a tvoje ruční překážky ano; čerstvý výkop nebo hromada ne — označ je jako Překážku a trasa je obejde.' }
    ];

    var karty = [], zobrazene = [], filtr = 'vse', el = null, _io = null;

    // ---- sběr karet ------------------------------------------------------------------------------------
    // Datové soubory po jazyce (data/ulohy-en.json…) — bere je AGJazyk.fetchData, cizí jazyk bez
    // souboru spadne na češtinu; bez modulu jazyků obyčejný fetch.
    function nactiJson(u) { var f = (window.AGJazyk && AGJazyk.fetchData) ? AGJazyk.fetchData : fetch; return f(u, { cache: 'force-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    function sestav() {
        karty = [];
        try { (window.agGeoDict || []).forEach(function (p, i) { karty.push({ id: 'pojem:' + i, typ: 'pojem', n: p.t, d: p.d }); }); } catch (e) { swallow(e, 'pojmy'); }
        TIPY.forEach(function (t, i) { karty.push({ id: 'tip:' + i, typ: 'tip', n: t.n, d: t.d }); });
        var sl = Promise.resolve();
        // vzorce (lazy modul) — bez otevření okna, jen data
        sl = sl.then(function () { return (window.AGVzorce ? Promise.resolve() : (window.AGLazyTools ? AGLazyTools.load('js/vzorce.js') : Promise.resolve())).catch(function () { /* bez vzorců */ }); }).then(function () {
            try { (window.AGVzorce && AGVzorce.sekce || []).forEach(function (S) { (S.v || []).forEach(function (v, i) { karty.push({ id: 'vzorec:' + S.s + ':' + i, typ: 'vzorec', n: v.n, html: '<div class="agsu-f">' + v.f + '</div><div class="agsu-s">' + (v.s || '') + '</div>', sekce: S.s, calc: v.calc, tool: v.tool }); }); }); } catch (e) { swallow(e, 'vzorce'); }
        });
        sl = sl.then(function () { return nactiJson('data/predpisy.json'); }).then(function (d) {
            try { ((d && d.kategorie) || []).forEach(function (k) { (k.zaznamy || []).forEach(function (z, i) { karty.push({ id: 'predpis:' + k.id + ':' + i, typ: 'predpis', n: z.nazev, d: z.telo, sekce: k.nazev, tabulka: z.tabulka, tool: 'predpisy' }); }); }); } catch (e) { swallow(e, 'predpisy'); }
        });
        sl = sl.then(function () { return nactiJson('data/ulohy.json'); }).then(function (d) {
            try { ((d && d.ulohy) || []).forEach(function (u) { karty.push({ id: 'otazka:' + u.id, typ: 'otazka', nh: '<span>Úloha:</span> ' + esc(u.typ || '') + ' <span>(obtížnost ' + esc(String(u.obtiznost || 1)) + ')</span>', html: u.zadani, odpovedi: u.odpovedi, tool: 'cvicne-ulohy' }); }); } catch (e) { swallow(e, 'ulohy'); }
        });
        sl = sl.then(function () {
            try {
                var T = (window.AGReg && AGReg.all()) || [];
                T.forEach(function (r) { if (!r || r.hidden || !r.vl || !r.vh) return; karty.push({ id: 'nastroj:' + r.k, typ: 'nastroj', nh: '<span>Věděl jsi, že appka umí:</span> <span>' + esc(r.vl) + '</span>', html: '<p><span>' + esc(r.vh) + '</span>' + (r.verb ? '<span> · najdeš v Nástroje → </span><span>' + esc(r.verb) + '</span>' : '') + '</p>', tool: r.k, pro: !!r.pro }); });
            } catch (e) { swallow(e, 'nastroje'); }
        });
        return sl;
    }
    // pořadí: neviděné napřed, promíchané podle dne (stejný den = stejné pořadí, ať se feed nepřeskládá pod prstem)
    function poradi(list) {
        var seed = 0; dnes().split('').forEach(function (c) { seed = (seed * 31 + c.charCodeAt(0)) % 1000003; });
        function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
        var a = list.map(function (k) { return { k: k, r: rnd() + (st.videne[k.id] ? 1 : 0) }; });
        a.sort(function (x, y) { return x.r - y.r; });
        return a.map(function (x) { return x.k; });
    }
    function vyber() {
        var l = karty.filter(function (k) { if (filtr === 'vse') return true; if (filtr === 'ulozene') return !!st.ulozene[k.id]; return k.typ === filtr; });
        zobrazene = poradi(l);
        return zobrazene;
    }

    // ---- vykreslení ------------------------------------------------------------------------------------
    var TYPY = { pojem: 'Pojem', vzorec: 'Vzorec', predpis: 'Předpis', otazka: 'Otázka', nastroj: 'Nástroj', tip: 'Tip z terénu' };
    // velká ikona druhu v rohu karty (čárová, jednobarevná — bere barvu druhu z CSS)
    var IKONY = {
        pojem: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M8 7h7M8 11h7"/>',
        vzorec: '<path d="M17 4H7l6 8-6 8h10"/>',
        predpis: '<path d="M12 3v18M5 7l7-4 7 4M4 12l3-5 3 5a3 3 0 0 1-6 0zM14 12l3-5 3 5a3 3 0 0 1-6 0z"/>',
        otazka: '<path d="M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.4-1.5 2.4"/><circle cx="12" cy="18" r=".8"/><circle cx="12" cy="12" r="9.5"/>',
        nastroj: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2-2z"/>',
        tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1 1 1.6l.2 1h4.6l.2-1c.1-.6.4-1.1 1-1.6A6 6 0 0 0 12 3z"/>'
    };
    function tabulka(t) {
        if (!t || !t.hlavicka) return '';
        var h = '<table class="agsu-tab"><tr>' + t.hlavicka.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr>';
        (t.radky || []).slice(0, 8).forEach(function (r) { h += '<tr>' + r.map(function (x) { return '<td>' + esc(x) + '</td>'; }).join('') + '</tr>'; });
        return h + '</table>';
    }
    function karta(k, i) {
        var akce = '';
        if (k.typ === 'otazka') akce += '<button type="button" class="agsu-b" data-akce="odkryt">Ukázat výsledek</button>';
        if (k.calc) akce += '<button type="button" class="agsu-b" data-akce="tool" data-tool="kalkulacka">Spočítat v Kalkulačce</button>';
        if (k.tool && k.typ !== 'vzorec') akce += '<button type="button" class="agsu-b" data-akce="tool" data-tool="' + esc(k.tool) + '">' + (k.typ === 'nastroj' ? 'Otevřít' : k.typ === 'otazka' ? 'Spočítat v Cvičných úlohách' : 'Otevřít Předpisy') + '</button>';
        var telo = k.html ? k.html : '<p>' + esc(k.d) + '</p>';
        if (k.tabulka) telo += tabulka(k.tabulka);
        if (k.typ === 'otazka' && k.odpovedi) telo += '<div class="agsu-odp" hidden>' + k.odpovedi.map(function (o) { return '<div>' + o.l + ' = <b>' + esc(String(o.v)) + '</b></div>'; }).join('') + '</div>';
        return '<section class="agsu-slot" data-id="' + esc(k.id) + '" data-i="' + i + '"><div class="agsu-karta t-' + k.typ + '">'
            + '<svg class="agsu-ik" viewBox="0 0 24 24" aria-hidden="true">' + (IKONY[k.typ] || IKONY.pojem) + '</svg>'
            + '<div class="agsu-hl"><span class="agsu-typ"><span>' + TYPY[k.typ] + '</span>' + (k.sekce ? ' · <span>' + esc(k.sekce) + '</span>' : '') + '</span><button type="button" class="agsu-star' + (st.ulozene[k.id] ? ' on' : '') + '" data-akce="ulozit" aria-label="Uložit">★</button></div>'
            + '<h2>' + (k.nh || esc(k.n)) + '</h2><div class="agsu-telo">' + telo + '</div>'
            + (akce ? '<div class="agsu-akce">' + akce + '</div>' : '')
            + '<div class="agsu-dal"><i></i>' + (i + 1) + ' / ' + zobrazene.length + '</div></div></section>';
    }
    function vykresli() {
        var feed = el.querySelector('#agsu-feed');
        var l = vyber();
        feed.innerHTML = l.length ? l.map(karta).join('') : '<section class="agsu-slot"><div class="agsu-karta t-prazdno"><h2>' + (filtr === 'ulozene' ? 'Nic uloženého' : 'Žádné karty') + '</h2><p>' + (filtr === 'ulozene' ? 'Hvězdička na kartě ji uloží sem.' : 'Zkus jiný filtr.') + '</p></div></section>';
        feed.scrollTop = 0;
        pocitadlo();
        sleduj();
    }
    function pocitadlo() {
        var c = el.querySelector('#agsu-pocet'); if (!c) return;
        var d = st.dny[dnes()] || 0, v = Object.keys(st.videne).length;
        c.textContent = 'dnes ' + d + ' · celkem ' + v + ' / ' + karty.length;
    }
    // viděná karta = byla na obrazovce aspoň 1,2 s (IntersectionObserver), ne jen prolétla
    function sleduj() {
        try { if (_io) _io.disconnect(); } catch (e) { /* nic */ }
        if (!('IntersectionObserver' in window)) return;
        var casovace = {};
        _io = new IntersectionObserver(function (ents) {
            ents.forEach(function (en) {
                var id = en.target.getAttribute('data-id');
                if (en.isIntersecting && en.intersectionRatio >= 0.6) { if (!casovace[id]) casovace[id] = setTimeout(function () { videno(id); }, 1200); }
                else if (casovace[id]) { clearTimeout(casovace[id]); delete casovace[id]; }
            });
        }, { root: el.querySelector('#agsu-feed'), threshold: [0.6] });
        el.querySelectorAll('.agsu-slot[data-id]').forEach(function (s) { _io.observe(s); });
    }
    function videno(id) { if (st.videne[id]) return; st.videne[id] = Date.now(); st.dny[dnes()] = (st.dny[dnes()] || 0) + 1; uloz(); pocitadlo(); }
    function akce(ev) {
        var b = ev.target.closest('[data-akce]'); if (!b) return;
        var sec = b.closest('.agsu-slot'), id = sec && sec.getAttribute('data-id'), a = b.getAttribute('data-akce');
        if (a === 'ulozit') { if (st.ulozene[id]) delete st.ulozene[id]; else st.ulozene[id] = Date.now(); uloz(); b.classList.toggle('on', !!st.ulozene[id]); }
        else if (a === 'odkryt') { var o = sec.querySelector('.agsu-odp'); if (o) { o.hidden = !o.hidden; b.textContent = o.hidden ? 'Ukázat výsledek' : 'Skrýt výsledek'; } videno(id); }
        else if (a === 'tool') { var k = b.getAttribute('data-tool'); otevriNastroj(k); }
    }
    function otevriNastroj(k) {
        try {
            var r = window.AGReg && AGReg.get(k), fn = r && r.fn;
            if (k === 'kalkulacka' && !fn) fn = 'openCalcModal';
            if (k === 'predpisy' && !fn) fn = 'openPredpisy';
            zavri();
            if (fn && typeof window[fn] === 'function') { window[fn](); return true; }
            if (window.AGToolsHub && typeof AGToolsHub.run === 'function') return AGToolsHub.run(k);
        } catch (e) { swallow(e, 'tool'); }
        return false;
    }

    // ---- okno -------------------------------------------------------------------------------------------
    var FILTRY = [['vse', 'Vše'], ['pojem', 'Pojmy'], ['vzorec', 'Vzorce'], ['predpis', 'Předpisy'], ['otazka', 'Otázky'], ['nastroj', 'Nástroje'], ['tip', 'Tipy'], ['ulozene', '★ Uložené']];
    function html() {
        return '<div class="agsu-top"><b>Geo kartičky</b><span id="agsu-pocet"></span><button type="button" class="agsu-x" id="agsu-zavrit" aria-label="Zavřít">✕</button></div>'
            + '<div class="agsu-filtry">' + FILTRY.map(function (f) { return '<button type="button" data-f="' + f[0] + '"' + (f[0] === filtr ? ' class="on"' : '') + '>' + f[1] + '</button>'; }).join('') + '</div>'
            + '<div id="agsu-feed"><section class="agsu-slot"><div class="agsu-karta t-tip"><h2>Načítám kartičky…</h2></div></section></div>';
    }
    function zavri() { try { if (_io) _io.disconnect(); } catch (e) { /* nic */ } if (el) { el.style.display = 'none'; el.innerHTML = ''; } }
    function otevri() {
        if (!document.querySelector('link[href$="css/scroll-uceni.css"]')) { var lk = document.createElement('link'); lk.rel = 'stylesheet'; lk.href = 'css/scroll-uceni.css'; document.head.appendChild(lk); }
        if (!el) { el = document.createElement('div'); el.id = 'agsu'; document.body.appendChild(el); el.addEventListener('click', akce); }
        el.innerHTML = html(); el.style.display = 'block';
        el.querySelector('#agsu-zavrit').onclick = zavri;
        el.querySelectorAll('.agsu-filtry button').forEach(function (b) { b.onclick = function () { filtr = b.getAttribute('data-f'); el.querySelectorAll('.agsu-filtry button').forEach(function (x) { x.classList.toggle('on', x === b); }); vykresli(); }; });
        var p = karty.length ? Promise.resolve() : sestav();
        p.then(vykresli).catch(function (e) { swallow(e, 'sestav'); vykresli(); });
    }
    window.agOpenScrollUceni = otevri;
    window.AGScrollUceni = { otevri: otevri, zavri: zavri, karty: function () { return karty; }, zobrazene: function () { return zobrazene; }, sestav: sestav, filtr: function (f) { filtr = f; if (el) el.querySelectorAll('.agsu-filtry button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-f') === f); }); if (el && el.style.display === 'block') vykresli(); }, stav: function () { return st; }, videno: videno, TIPY: TIPY };

    function register() {
        try { if (typeof window.agRegisterFieldTool === 'function') window.agRegisterFieldTool({ id: 'scroll-uceni', label: 'Geo kartičky', icon: ICON, cat: 'Pomůcky', onClick: otevri, order: 2 }); } catch (e) { swallow(e, 'register'); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register); else register();
})();
