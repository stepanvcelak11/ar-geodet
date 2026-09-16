// ===== QTRIG — JAK MĚŘIT PŘESNĚ Z MOBILU (rozcestník sekce Přesné měření) =======
// Uživatel 15. 9. 2026: „v Nástrojích vytvoř novou sekci Přesné měření, kam dej vše,
// co se toho týká… pro nové lidi je to složité na pochopení, ke každému dej
// jednoduché vysvětlení s postupem co a jak."
//
// Tohle okno je ta jednoduchá vstupní brána: neměří nic samo, jen vysvětluje,
// JAKÉ TŘI CHYBY GPS v telefonu má (šum, posun, plavání), KTERÝ nástroj kterou
// z nich řeší, CO ČEKAT za čísla a v jakém POŘADÍ nástroje spojit. U každé
// metody je postup ve 3–5 krocích a tlačítko, které nástroj rovnou otevře
// (klikem na jeho dlaždici přes AGUkony.run — stejná cesta jako seznam úkonů,
// takže platí zámky Pro, počítadla i návody).
//
// ODKUD JSOU ČÍSLA (ať je nikdo neopisuje jako změřený fakt): holá GPS ±3–5 m
// je zkušenost z terénu (js/brutal-gps.js, js/dvoji-mereni.js); Přesná GPS
// ±0,5–1 m je strop daný korelací fixů (viz kDur v brutal-gps.js); kalibrace
// chůzí ±0,3–0,5 m je odhad z chyby fixů ÷ √n ⊕ přesnost čáry (kalibrace-hranou.js);
// DGPS „poloviční až třetinová chyba" je z hlavičky dgps.js; akustika ±2–5 cm
// z akusticky-dalkomer.js (test_akustika.py). Na skutečných telefonech to
// ověřené v jedné sadě NENÍ — okno to říká.
//
// Vstup: dlaždice „Jak měřit přesně" v Nástrojích (Přesné měření), lazy.
// Odstranění: smaž js/presne-mereni.js + záznam v js/lazy-tools.js a
// js/tools-registry.js (+ data/navody.json), přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGPresne) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>';
    var DLG_ID = 'ag-presne-modal';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'presne:' + kde); } catch (e2) { /* nic */ } }
    function byId(id) { return document.getElementById(id); }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { swallow(e, 'toast'); } }

    // Spuštění nástroje = klik na jeho dlaždici (zámky Pro, počítadla, návrat). Když
    // dlaždice není (role, vypínač), řekni to místo tichého nic.
    function run(k) {
        var ok = false;
        try { ok = !!(window.AGUkony && AGUkony.run && AGUkony.run(k)); } catch (e) { swallow(e, 'run'); }
        if (!ok) { try { if (window.AGLazyTools && AGLazyTools.open) { AGLazyTools.open(k); ok = true; } } catch (e) { swallow(e, 'lazy'); } }
        if (!ok) { toast('Nástroj teď není k dispozici (role nebo vypnutý modul).'); return; }
        var el = byId(DLG_ID); if (el) el.style.display = 'none';
    }

    function css() {
        if (!window.AG || !AG.style) return;
        AG.style('ag-presne-style', [
            '#' + DLG_ID + ' .modal-content{max-width:560px;}',
            '.pm-p{font-size:calc(12.5px * var(--ag-font-scale,1));opacity:.88;margin:0 0 10px;line-height:1.45;}',
            '.pm-card{border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px 12px;margin:8px 0;background:rgba(255,255,255,.04);font-size:calc(12.5px * var(--ag-font-scale,1));line-height:1.45;}',
            '.pm-card.green{border-color:rgba(74,222,128,.4);background:rgba(74,222,128,.07);}',
            '.pm-card.amber{border-color:rgba(251,191,36,.4);background:rgba(251,191,36,.07);}',
            '.pm-card h4{margin:0 0 4px;font-size:calc(14px * var(--ag-font-scale,1));color:var(--accent);display:flex;align-items:center;gap:6px;}',
            '.pm-card h4 .pm-n{display:inline-flex;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#000;font-size:12px;font-weight:700;align-items:center;justify-content:center;flex:0 0 22px;}',
            '.pm-card ol{padding-left:18px;margin:6px 0;}',
            '.pm-card li{margin:3px 0;}',
            '.pm-card .pm-cek{display:block;margin-top:6px;font-size:.93em;opacity:.85;}',
            '.pm-card .btn{width:auto;padding:7px 12px;margin:8px 6px 0 0;font-size:calc(13px * var(--ag-font-scale,1));}',
            '.pm-tab{width:100%;border-collapse:collapse;font-size:calc(12px * var(--ag-font-scale,1));margin:6px 0 10px;}',
            '.pm-tab td,.pm-tab th{padding:5px 6px;border-bottom:1px solid rgba(255,255,255,.1);text-align:left;vertical-align:top;}',
            '.pm-tab th{opacity:.7;font-weight:600;}',
            '.pm-tab td.v{white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600;}',
            '.pm-how{margin:0 0 10px;font-size:calc(12.5px * var(--ag-font-scale,1));}',
            '.pm-how summary{cursor:pointer;color:var(--accent);font-weight:600;padding:6px 0;}',
            '.pm-tag{display:inline-block;font-size:.8em;padding:1px 6px;border-radius:999px;background:rgba(255,255,255,.1);margin-left:4px;vertical-align:middle;}'
        ].join('\n'));
    }

    function card(n, title, why, steps, expect, buttons, cls) {
        return '<div class="pm-card' + (cls ? ' ' + cls : '') + '"><h4><span class="pm-n">' + n + '</span>' + title + '</h4>'
            + '<div>' + why + '</div>'
            + '<ol>' + steps.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>'
            + (expect ? '<span class="pm-cek"><b>Co čekat:</b> ' + expect + '</span>' : '')
            + buttons.map(function (b) { return '<button type="button" class="btn ' + (b.primary ? 'btn-primary' : 'btn-secondary') + '" data-run="' + b.k + '">' + b.l + '</button>'; }).join('')
            + '</div>';
    }

    function html() {
        return '<p class="pm-p">Telefon nemá RTK, ale má tři různé chyby a každá se dá zmenšit jinak. <b>Šum</b> (každý fix jinde, ±3–5 m) — zmenší ho dlouhé průměrování. <b>Posun</b> (všechny fixy stejným směrem, 1–3 m) — ten průměrování nevidí, zjistí ho jen porovnání s něčím známým: hrana z mapy, známý bod, druhý telefon. <b>Plavání</b> (posun se za 20 minut změní o půl metru až metr) — řeší se tím, že se kalibruje před i po měření.</p>'
            + '<table class="pm-tab"><tr><th>Metoda</th><th>Vodorovně</th><th>Poznámka</th></tr>'
            + '<tr><td>Holá GPS, jeden fix</td><td class="v">±3–5 m</td><td>šum + posun</td></tr>'
            + '<tr><td>Přesná GPS 10–15 min</td><td class="v">±0,5–1 m</td><td>šum pryč, posun zůstává</td></tr>'
            + '<tr><td>+ Kalibrace chůzí po hraně</td><td class="v">±0,3–0,5 m</td><td>posun pryč; nikdy líp než čára, po které jdeš</td></tr>'
            + '<tr><td>+ chůze před i po</td><td class="v">±0,3–0,4 m</td><td>plavání zpola pryč, body přepočtené podle času</td></tr>'
            + '<tr><td>Dvoutelefonní DGPS (rover)</td><td class="v">±0,5 m vůči základně</td><td>celek jak dobře znáš bod základny</td></tr>'
            + '<tr><td>Akustický dálkoměr</td><td class="v">±2–5 cm do 40 m</td><td>tvar a délky; celek jak známé body</td></tr>'
            + '<tr><td>Výška (jakkoli)</td><td class="v">±1–2 m</td><td>tu nezachrání nic z toho</td></tr>'
            + '</table>'
            + '<p class="pm-p" style="opacity:.7">Čísla jsou odhady z výpočtu a z terénu s běžným telefonem pod volným nebem; u budov a pod stromy je všechno horší. Na jedné sadě telefonů to ověřené není — každý nástroj ukazuje vlastní odhad chyby u výsledku.</p>'

            + card(1, 'Kalibrace chůzí po hraně', 'Zjistí <b>posun</b> GPS tady a teď: projdeš hranu, kterou appka zná z mapy, a ona spočítá, o kolik a kam se GPS plete. Na přímce jen kolmo k ní; když obejdeš <b>roh, plusko nebo celý obvod pozemku</b>, vyjde chyba v obou směrech.',
                ['V mapě zapni <b>ortofoto</b>, najdi ostrou hranu na zemi (obrubník, hrana asfaltu, pata zdi). Uliční mapa se nehodí (±1–5 m), střechy taky ne.',
                 '<b>Vybrat v mapě</b> → naklepej hranu, u pozemku klepni <b>Uzavřít tvar</b>. Nebo dva uložené body.',
                 '<b>Spustit chůzi</b>, projdi ji tam i zpět (30–50 m stačí) → <b>Zastavit a spočítat → Zapnout korekci</b>.',
                 'Změř body. Až skončíš, <b>projdi hranu znovu</b> → appka nabídne přepočet bodů podle času.'],
                'z ±3–5 m na ±0,3–0,5 m; platí ~20 min a ~300 m.',
                [{ k: 'kalibrace-hranou', l: '<svg class="icon"><use href="#i-navigation"/></svg> Otevřít kalibraci chůzí', primary: true }])

            + card(2, 'Přesná GPS (dlouhé průměrování)', 'Zmenší <b>šum</b>: telefon leží na bodě, appka průměruje stovky fixů, vyhazuje uskoky a ve čtvrtinách tě vyzve otočit telefon o 90°, aby se vyrušila poloha antény. Posun GPS sama nezná — proto napřed krok 1.',
                ['Polož telefon <b>středem na bod</b> (křížek v okně), displejem nahoru, mimo tělo a kov.',
                 'Vyber <b>10–15 min</b> (5 min = ±0,7 m, 15 min = ±0,4–0,5 m, 30 min už nepřidá — pokud nekalibruješ před i po).',
                 '<b>Spustit</b>; když řekne, otoč o 90° kolem středu. Pak <b>Uložit bod</b>.'],
                '±0,5–1 m samotné, ±0,3–0,5 m s kalibrací chůzí.',
                [{ k: 'brutal-gps', l: '<svg class="icon"><use href="#i-crosshair"/></svg> Otevřít Přesnou GPS', primary: true }])

            + card(3, 'Nejpřesnější bod z jednoho telefonu: plusko → Přesná GPS → plusko', 'Spojení 1 + 2: chůze odstraní posun, průměrování šum, druhá chůze plavání. Každý krok dělá to, co ostatní neumí.',
                ['Kolem místa měření obejdi <b>uzavřený tvar</b> po známé hraně (plusko, čtverec, obvod) → Zapnout korekci.',
                 '<b>Hned</b> polož telefon na bod a změř <b>Přesnou GPS 10–15 min</b> → Uložit.',
                 'Obejdi tvar <b>znovu</b> → „Přepočítat body" → bod dostane vektor podle času svého měření.'],
                '±0,3–0,4 m vodorovně; víc z holého telefonu nejde (přesnost čáry z ortofota + anténa + plavání).',
                [{ k: 'kalibrace-hranou', l: '<svg class="icon"><use href="#i-navigation"/></svg> 1. Kalibrace chůzí', primary: true }, { k: 'brutal-gps', l: '<svg class="icon"><use href="#i-crosshair"/></svg> 2. Přesná GPS' }], 'green')

            + card(4, 'Dvoutelefonní DGPS — druhý telefon jako základna', 'Dva telefony se ve stejnou chvíli pletou skoro stejně. Jeden leží na známém bodě a hlásí, o kolik GPS lže; druhý měří a odečítá to. Bod základny může být i ten z kroku 3 (<b>dočasná základna</b>) — Přesná GPS ho po uložení rovnou nabídne.',
                ['Telefon A polož na známý bod (úřední, importovaný, nebo z kroku 3) → <b>Základna → Spustit</b>. Nech ho ležet; ukáže 6znakový kód.',
                 'Telefon B: <b>Živě z internetu</b> → zadej kód. Body ukládané od té chvíle se opravují hned.',
                 'Bez internetu: základnu zastav → QR; rover ho naskenuje a body opraví zpětně.'],
                'body roveru vůči sobě ±0,5 m (nejlíp do 150 m, platí do ~2 km); poloha celku = jak dobře znáš bod základny. Bez známého bodu jen tvar, celek může být posunutý o metry. Zato prodlouží platnost kalibrace chůzí v čase.',
                [{ k: 'dgps', l: '<svg class="icon"><use href="#i-satellite"/></svg> Otevřít DGPS', primary: true }])

            + card(5, 'Akustický dálkoměr — tvar na centimetry', 'Délka mezi dvěma telefony ze zvuku, ±2–5 cm do ~40 m. Ze dvou délek ke dvěma známým bodům vyjde nový bod bez GPS. Když jsou známé body z kroku 3, je <b>tvar a délky</b> na centimetry a <b>poloha celku</b> zdědí jejich ±0,3–0,5 m — na hranici pozemku (výměra, délky) to je víc, než dá cokoli jiného z telefonu.',
                ['Dva body změř Přesnou GPS s kalibrací (krok 3) — to jsou „známé body".',
                 'Telefon B polož na známý bod (<b>Stojím na známém bodě</b>), telefonem A změř délku k novému bodu; pak B přenes na druhý známý bod a změř znovu.',
                 '<b>Bod ze dvou délek</b> → ulož. Úhel protnutí drž mezi 30° a 150°.'],
                '±2–5 cm vůči známým bodům; absolutně jako známé body.',
                [{ k: 'akusticky-dalkomer', l: '<svg class="icon"><use href="#i-sound"/></svg> Otevřít akustický dálkoměr', primary: true }])

            + card(6, 'Posun GPS na známý bod', 'Totéž co kalibrace chůzí, jen ve stoje: stoupneš si na <b>úřední nebo vytyčený bod</b>, appka porovná průměr GPS s jeho souřadnicemi. Bez chůze a bez mapy — potřebuje ale bod, na který se dá stoupnout.',
                ['Stoupni si na bod, počkej na ustálení průměru GPS.',
                 'Vyber bod z nabídky (úřední body jsou v ní) nebo zadej S-JTSK → <b>Spočítat a zapnout</b>.'],
                '±0,5 m; platí ~20 min a ~300 m.',
                [{ k: 'ref-calibration', l: '<svg class="icon"><use href="#i-map-pin"/></svg> Otevřít posun na známý bod' }])

            + card(7, 'Oprava GPS z mapy za chůze', 'Nejrychlejší korekce: na ortofotu vidíš, kde přesně stojíš (roh budovy, obruba, kanál) — klepneš tam a appka odečítá chybu GPS <b>i za chůze</b>: v AR, navigaci i u ukládaných bodů. Bez známého bodu, bez chůze po hraně.',
                ['Postůj 30–60 s na volném místě, ať se GPS zprůměruje (okno ukazuje počet měření).',
                 'Ortofoto, přiblížit, <b>Klepnout, kde stojím</b> → přesně na své místo → <b>Zapnout</b>.'],
                '±1,5–2 m místo ±3–5 m; platí 10 min a 100 m od místa klepnutí, pak klepnout znovu.',
                [{ k: 'korekce-z-mapy', l: '<svg class="icon"><use href="#i-map-pin"/></svg> Otevřít opravu z mapy', primary: true }])

            + card(8, 'Kontrolní měření', 'Jediný poctivý důkaz přesnosti: bod změř podruhé (nejlíp za 30–60 min, kdy jsou družice jinde) a rozdíl ti řekne, čemu věřit.',
                ['Změř bod znovu stejnou metodou.',
                 'Appka ukáže rozdíl obou měření a zapíše ho k bodu.'],
                '',
                [{ k: 'dvoji-mereni', l: '<svg class="icon"><use href="#i-check"/></svg> Otevřít kontrolní měření' }])

            + '<details class="pm-how"><summary>Kde jde kalibrovat chůzí a kde ne</summary>'
            + '<table class="pm-tab"><tr><th>Zdroj čáry</th><th>Přesnost</th><th>Jak poznáš</th></tr>'
            + '<tr><td>Dva známé body (úřední, vytyčené, DXF)</td><td class="v">cm</td><td>v nástroji „z bodů" místo klepání</td></tr>'
            + '<tr><td>Hranice z katastru (DKM)</td><td class="v">±0,14–0,3 m</td><td>stažené parcely — klepnutí u lomového bodu se přichytí; plot na hranici často není</td></tr>'
            + '<tr><td>Ortofoto — ostrá hrana na zemi</td><td class="v">±0,2–0,5 m</td><td>obrubník, hrana asfaltu, pata zdi, kryt šachty</td></tr>'
            + '<tr><td>Ortofoto — střecha, římsa</td><td class="v">±1–3 m</td><td><b>nepoužívat</b>: střecha je na fotce posunutá</td></tr>'
            + '<tr><td>Uliční mapa</td><td class="v">±1–5 m</td><td><b>nepoužívat</b>: čáry kreslené od ruky, silnice = osa</td></tr>'
            + '<tr><td>Pole bez hrany a bez bodu</td><td class="v">—</td><td>není proti čemu; jde jen relativně (DGPS, akustika)</td></tr>'
            + '</table></details>'

            + '<details class="pm-how"><summary>Typické situace a pořadí nástrojů</summary>'
            + '<p class="pm-p"><b>Pokládka u obrubníku:</b> 1 (rovná hrana stačí — kolmá složka je ta, o kterou jde) → měř → 1 znovu cestou zpět.</p>'
            + '<p class="pm-p"><b>Pozemek, kolem je plot nebo cesta vidět na ortofotu:</b> obejdi obvod (1, uzavřený tvar) → rohy Přesnou GPS (2) → obejdi znovu → délky mezi rohy akusticky (5).</p>'
            + '<p class="pm-p"><b>Pole bez hrany, úřední bod do 2 km:</b> 6 na tom bodě → dojdi na místo → měř (platí 20 min / 300 m — když je to dál, vezmi druhý telefon a nech ho na bodě jako základnu, 4).</p>'
            + '<p class="pm-p"><b>Pole bez hrany a bez bodu:</b> absolutně to nejde líp než ±3–5 m. Tvar a délky ano: základna „kde leží" (4) nebo akustika (5); až najdeš známý bod, celek se dá posunout.</p>'
            + '</details>';
    }

    function ensureModal() {
        if (byId(DLG_ID)) return;
        css();
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = DLG_ID;
        el.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent); margin-top:0; margin-bottom:5px;">' + ICON + ' Jak měřit přesně z mobilu</h3>'
            + '<div class="modal-body" id="ag-presne-body"></div>'
            + '<button class="btn btn-secondary" style="margin-top:15px;" id="ag-presne-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        function close() { el.style.display = 'none'; }
        el.querySelector('#ag-presne-close').addEventListener('click', close);
        el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
        el.addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('button[data-run]') : null;
            if (b) run(b.getAttribute('data-run'));
        });
    }
    function open() {
        ensureModal();
        var body = byId('ag-presne-body');
        if (body && !body.childNodes.length) body.innerHTML = html();
        byId(DLG_ID).style.display = 'flex';
    }

    window.AGPresne = { open: open, _test: { html: html } };
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'presne-mereni', label: 'Jak měřit přesně', icon: ICON, cat: 'Přesné měření', onClick: open, order: 1 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
