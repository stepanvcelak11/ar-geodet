// ===== AR Geodet — PROVOZNÍ PROFILY + PROFIL ZAŘÍZENÍ (ODPOJITELNÁ vrstva) ======
// Neinvazivní vrstva ve stylu js/map-tools.js: NEEDITUJE logika.js ani grafika.js.
//
// PROČ: Nastavení má ~80 ovládacích prvků ve čtyřech záložkách a dalších 17 modulů
// si tam vkládá vlastní řádky. Vědět, co z toho nastavit na celodenní měření a co
// na maximální přesnost, je skryté know-how. Profil z toho dělá jeden tap.
//
// 1) PROVOZNÍ PROFILY (nad záložkami Nastavení): Terén (výdrž) · Přesnost ·
//    Ukázka. Profil se aplikuje tak, že modul NASTAVÍ EXISTUJÍCÍ OVLÁDACÍ PRVKY
//    a pošle jim 'input'/'change' — hodnoty tedy ukládá a aplikuje appka svým
//    vlastním kódem (saveSettings v grafika.js, vlastní handlery modulů). Modul
//    si nikde nedrží druhou kopii nastavení, takže se nemůže rozejít.
//    ZÁMĚRNĚ nesáhá na věci vázané na TELEFON a ČLOVĚKA (zorný úhel, korekce
//    severu, barvy, motiv, levá ruka, volba kamery) — ty patří do bodu 2.
//
//    BEZ PROFILU je rovnocenný stav: ťuknutí na PRÁVĚ AKTIVNÍ profil ho odznačí.
//    Odznačení ÚMYSLNĚ nic nevrací zpět — jen se přestane tvářit, že profil platí
//    (smaže agProfileLast). Nastavení zůstane přesně tak, jak si ho uživatel nechá.
//    Vracet výchozí hodnoty by bylo horní cesta do pekla: profil by mazal ruční
//    doladění, které uživatel udělal PO jeho zapnutí.
//
//    SROVNÁVACÍ TABULKA (sbalené „Co profily mění“) se GENERUJE z objektu `set`
//    každého profilu — není nikde psaná ručně, takže nemůže zastarat. Řádek se
//    vykreslí jen tehdy, když ovládací prvek v téhle verzi opravdu existuje.
//    Nový klíč v `set` = přidej i řádek do LABELS, jinak se ve srovnání neukáže.
//
// 2) PROFIL ZAŘÍZENÍ (Nastavení → Údržba): export a import kalibrace telefonu
//    do souboru .agdev — zorný úhel kamery (fovH/fovV), výška očí, korekce severu
//    a pojmenované profily kalibrace z js/calib-profiles.js. Nový telefon v partě
//    se tak nastaví jedním souborem místo měření FOV od nuly.
//    Body, zakázky ani účty v tom NEJSOU (na to je záloha a .argeo).
//
// Odstranění: smaž js/profily.js + řádek <script> v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agProfInit) return;
    window.__agProfInit = true;

    var STYLE_ID = 'ag-prof-style';
    var LAST_KEY = 'agProfileLast';     // právě aktivní profil; chybí = bez profilu

    // ---- překlad hodnot do lidské řeči ----------------------------------------------
    function fBool(v) { return v ? 'ano' : 'ne'; }
    function fM(v) { return String(v) + ' m'; }
    function fPct(v) { return String(v) + ' %'; }
    function fNum(v) { return String(v); }
    function fAnim(v) { return v === 'off' ? 'vypnuté' : (v === 'on' ? 'zapnuté' : 'podle systému'); }

    // ---- čtění: id ovládacího prvku -> název, kterýmu rozumí geodet -------------------
    // Pořadí = pořadí řádků ve srovnávací tabulce (nahoru to, co je nejvíc poznát).
    var LABELS = [
        { id: 's-ar-radius-slider', n: 'Dohled v AR — jak daleko body vidíš', f: fM },
        { id: 's-max-ar-slider', n: 'Bodů v AR najednou', f: fNum },
        { id: 's-map-radius-slider', n: 'Dohled v mapě', f: fM },
        { id: 's-outdoor', n: 'Vysoký kontrast na slunci', f: fBool },
        { id: 's-auto-outdoor', n: 'Venkovní režim se zapíná sám', f: fBool },
        { id: 'v-font-scale', n: 'Velikost písma', f: fPct },
        { id: 's-wakelock', n: 'Displej nezhasne', f: fBool },
        { id: 'agp-enabled', n: 'Spánek senzorů mimo AR a mapu', f: fBool },
        { id: 'agp-gps', n: 'Spánek GPS v nástrojích', f: fBool },
        { id: 'agvt-settings-cb', n: 'Vizuální stabilizace AR (optický tok)', f: fBool },
        { id: 'ag-arfusion-cb', n: 'Plynulý směr — fúze gyroskopu', f: fBool },
        { id: 's-tilt-comp', n: 'Kompenzace náklonu telefonu', f: fBool },
        { id: 's-auto-compass', n: 'Automatická korekce kompasu', f: fBool },
        { id: 's-heading-smooth', n: 'Vyhlazení kompasu', f: fPct },
        { id: 'tgl-gpsavg', n: 'Průměrování GPS na místě', f: fBool },
        { id: 's-anim', n: 'Animace rozhraní', f: fAnim },
        { id: 'v-adaptive-glass', n: 'Adaptivní sklo panelů dle jasu', f: fBool },
        { id: 'v-marker-scale', n: 'Velikost štítků bodů', f: fPct },
        { id: 'v-marker-opacity', n: 'Krytí štítků', f: fPct },
        { id: 'v-arrow-scale', n: 'Velikost 3D šipky', f: fPct },
        { id: 'v-hud-scale', n: 'Velikost navigačního štítku', f: fPct },
        { id: 'v-panel-opacity', n: 'Krytí panelů na skle', f: fPct },
        { id: 's-vibration', n: 'Vibrace při uložení bodu', f: fBool }
    ];

    // ---- definice profilů ---------------------------------------------------------
    // set: id ovládacího prvku -> hodnota. Boolean = checkbox, jinak value.
    // Prvky, které v appce nejsou (odpojený modul), se přeskočí — fail-silent.
    // Hodnoty jsou ZÁMĚRNĚ roztažené od sebe: profily mají být na první pohled
    // rozeznatelné (100 / 400 / 2000 m dohled), ne tři odstíny téhož.
    var PROFILES = [
        {
            id: 'teren', t: 'Terén', s: 'Celý den na baterku',
            ic: '#i-sun',
            use: 'Celý den za finišerem. Telefon vydrží směnu, displej je čitelný na slunci '
                + 'a v AR se kreslí jen to nejbližší — všechno zbytné (fúze gyra, stabilizace obrazu, '
                + 'animace, buzení displeje) je vypnuté a senzory spí, když nekoukáš do kamery.',
            set: {
                's-outdoor': true,          // vysoký kontrast na slunci
                's-anim': 'off',
                'v-adaptive-glass': false,
                's-wakelock': false,        // největší žrout; o probuzení se stará spánek senzorů
                's-vibration': true,        // zpětná vazba v rukavicích, stojí skoro nic
                'tgl-gpsavg': true,
                's-ar-radius-slider': '100',
                's-max-ar-slider': '20',
                's-map-radius-slider': '300',
                's-heading-smooth': '70',
                'v-marker-scale': '110',    // větší štítky = čitelné na slunci a v rukavicích
                'v-panel-opacity': '100',   // neprůhledné panely, sklo se na slunci nepřečte
                'agp-enabled': true,        // js/power-save.js — uspat kameru/kompas mimo AR
                'agp-gps': true,
                'agvt-settings-cb': false,  // js/ar-visual-track.js — optický tok stojí výkon
                'ag-arfusion-cb': false     // js/ar-fusion.js — gyro na plných otáčkách, šetříme
            }
        },
        {
            id: 'presnost', t: 'Přesnost', s: 'Když musí značka sedět',
            ic: '#i-crosshair',
            use: 'Když kontroluješ výšku a sklon vrstvy a značka musí sedět na centimetry. '
                + 'Běží stabilizace obrazu, fúze gyra, kompenzace náklonu i průměrování GPS, '
                + 'GPS se neuspíná (fix zůstává teplý) a displej nezhasne. Baterie ubývá výrazně rychleji.',
            set: {
                's-auto-compass': true,
                's-tilt-comp': true,
                's-heading-smooth': '90',   // víc vyhlazení = klidnější značky
                'tgl-gpsavg': true,
                's-wakelock': true,
                's-anim': 'off',            // výkon patří renderu AR, ne přechodům
                's-ar-radius-slider': '400',
                's-max-ar-slider': '60',
                's-map-radius-slider': '1000',
                'v-marker-scale': '90',     // menší štítky = méně překryvů, líp vidíš na patu značky
                'v-panel-opacity': '95',
                'agp-enabled': false,       // GPS se nesmí uspat, fix má zůstat teplý
                'agp-gps': false,
                'agvt-settings-cb': true,
                'ag-arfusion-cb': true
            }
        },
        {
            id: 'ukazka', t: 'Ukázka', s: 'Předvádění appky',
            ic: '#i-star',
            use: 'Předvádění v kanceláři nebo na stavbě. Velké štítky i šipka, daleko vidět, '
                + 'plynulé animace, displej svítí pořád. Na celodenní práci se nehodí — bere baterku '
                + 'a daleký dohled zaplní obrazovku body, které zrovna neřešíš.',
            set: {
                's-outdoor': false,
                's-anim': 'on',
                'v-adaptive-glass': true,
                's-wakelock': true,
                's-ar-radius-slider': '2000',
                's-max-ar-slider': '120',
                's-map-radius-slider': '2000',
                's-heading-smooth': '55',   // svižnější reakce, hezky se to hýbe
                'v-marker-scale': '150',
                'v-arrow-scale': '150',
                'v-hud-scale': '130',
                'v-panel-opacity': '70',
                'agp-enabled': false,
                'agp-gps': false,
                'agvt-settings-cb': false,  // snímky kamery patří snímkové frekvenci, ne optickému toku
                'ag-arfusion-cb': true
            }
        }
    ];

    function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function toast(msg) {
        try { if (typeof quickToast === 'function') { quickToast(msg); return; } } catch (e) {}
        try { if (typeof window.agInfo === 'function') { window.agInfo(msg); return; } } catch (e) {}
    }

    // ---- styly --------------------------------------------------------------------
    // Pruh je ZÁMĚRNĚ nízký (jeden řádek, ikona + název): Nastavení je přeplněné
    // a tři dvouřádkové dlaždice před záložkami braly půl obrazovky. Popisky a celé
    // srovnání jsou schované v sbalitelném detailu. Rukavice (body.ag-glove) dostanou
    // vyšší variantu, aby zůstal dotykový cíl.
    function injectStyles() {
        if ($(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-prof-bar{margin:0 0 12px;}',
            '#ag-prof-bar .h{display:block;margin:0 0 6px;font:700 11px/1.2 var(--font-ui,system-ui),sans-serif;',
            '  letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#ag-prof-row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}',
            '#ag-prof-row button{display:flex;flex-direction:row;align-items:center;justify-content:center;gap:6px;',
            '  min-height:40px;padding:8px 6px;box-sizing:border-box;cursor:pointer;',
            '  border-radius:var(--r-md,12px);border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:rgba(255,255,255,0.05);color:var(--text-color,#eceef2);text-align:center;',
            '  font:700 12.5px/1.15 var(--font-ui,system-ui),sans-serif;}',
            '#ag-prof-row button .icon{width:15px;height:15px;flex:0 0 auto;color:var(--accent-bright,#3eb487);}',
            '#ag-prof-row button.on{border-color:var(--accent-line,rgba(47,158,116,0.42));background:var(--accent-soft,rgba(47,158,116,0.14));}',
            '#ag-prof-row button.on,#ag-prof-row button.on .icon{color:var(--accent,#2f9e74);}',
            '#ag-prof-row button:active{transform:scale(0.97);}',
            '#ag-prof-note{margin:6px 2px 0;font:500 11.5px/1.45 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '#ag-prof-note b{color:var(--text-color,#eceef2);}',
            '#ag-prof-note button[data-del]{display:inline-block;margin-left:2px;background:none;border:none;padding:0;',
            '  cursor:pointer;color:var(--danger,#ef4444);font:600 11.5px/1.45 var(--font-ui,system-ui),sans-serif;text-decoration:underline;}',
            // „Bez profilu" je rovnocenná volba, ne popřená akce — svítí stejně jako profil
            '#ag-prof-row button[data-off].on{border-color:var(--glass-border,rgba(255,255,255,0.28));',
            '  background:rgba(255,255,255,0.10);color:var(--text-color,#eceef2);}',
            '#ag-prof-row button[data-off].on .icon{color:var(--text-color,#eceef2);}',
            '#ag-prof-row button[data-new]{border-style:dashed;}',
            // sbalitelné srovnání
            '#ag-prof-det{margin:7px 0 0;}',
            '#ag-prof-det>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;',
            '  padding:5px 10px;border-radius:var(--r-md,12px);border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:rgba(255,255,255,0.04);color:var(--text-muted,#9aa1ac);',
            '  font:600 11px/1.2 var(--font-ui,system-ui),sans-serif;}',
            '#ag-prof-det>summary::-webkit-details-marker{display:none;}',
            '#ag-prof-det>summary .chev{transition:transform .15s;}',
            '#ag-prof-det[open]>summary{color:var(--accent-bright,#3eb487);border-color:var(--accent-line,rgba(47,158,116,0.42));}',
            '#ag-prof-det[open]>summary .chev{transform:rotate(180deg);}',
            '#ag-prof-body{margin-top:8px;}',
            // Srovnávací tabulka je širší než okno a posouvá se do stran. Rodič
            // #settings-modal .modal-content má ale touch-action:pan-y (css/style.css)
            // a touch-action se s předky PRŮNIKUJE — bez tohohle řádku by tabulka
            // prstem nešla posunout a pravý sloupec by byl nedosažitelný. Okno samo
            // vodorovně nepřetéká (overflow-x:hidden), takže povolení nic nerozbije.
            '#settings-modal .modal-content{touch-action:pan-x pan-y;}',
            '#ag-prof-tw{overflow-x:auto;-webkit-overflow-scrolling:touch;}',
            '#ag-prof-tw table{border-collapse:collapse;width:100%;min-width:300px;}',
            '#ag-prof-tw th,#ag-prof-tw td{padding:5px 6px;text-align:center;white-space:nowrap;',
            '  border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  font:500 11px/1.3 var(--font-ui,system-ui),sans-serif;color:var(--text-color,#eceef2);}',
            '#ag-prof-tw th:first-child,#ag-prof-tw td:first-child{text-align:left;white-space:normal;',
            '  color:var(--text-muted,#9aa1ac);font-weight:500;}',
            '#ag-prof-tw thead th{font-weight:700;color:var(--text-muted,#9aa1ac);}',
            '#ag-prof-tw thead th.on{color:var(--accent-bright,#3eb487);}',
            '#ag-prof-tw td.on{color:var(--accent-bright,#3eb487);font-weight:700;}',
            '#ag-prof-tw td.x{opacity:.32;}',
            '#ag-prof-use{margin:10px 0 0;}',
            '#ag-prof-use p{margin:0 0 7px;font:500 11.5px/1.5 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '#ag-prof-use b{color:var(--accent-bright,#3eb487);}',
            '#ag-prof-legend{margin:2px 2px 0;font:500 10.5px/1.4 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);opacity:.8;}',
            // profil zařízení v Údržbě
            '#ag-dev-box{margin-top:8px;}',
            '#ag-dev-box .ag-dev-row{display:flex;gap:8px;}',
            '#ag-dev-box .ag-dev-row .btn{flex:1;}',
            '#ag-dev-sum{margin:8px 2px 0;font:500 11.5px/1.5 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '#ag-dev-sum b{color:var(--accent,#2f9e74);}',
            'body.ag-glove #ag-prof-row button{min-height:54px;font-size:calc(13.5px * var(--ag-font-scale, 1));}',
            'body.ag-glove #ag-prof-row button .icon{width:18px;height:18px;}',
            'body.ag-glove #ag-prof-det>summary{padding:9px 12px;font-size:calc(12.5px * var(--ag-font-scale, 1));}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- aplikace profilu ---------------------------------------------------------
    // Ovládací prvek nastavíme a pošleme mu události, které by přišly od uživatele.
    // Díky tomu se postarají o uložení TI, kdo za dané nastavení odpovídají
    // (oninput popisky v index.html, change handlery injektujících modulů).
    function setControl(id, val) {
        var el = $(id);
        if (!el) return false;                       // odpojený modul → přeskočit
        if (el.type === 'checkbox') {
            if (el.checked === !!val) return true;   // bez zbytečné události
            el.checked = !!val;
        } else {
            var v = String(val);
            if (el.value === v) return true;
            el.value = v;
        }
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        return true;
    }

    // ---- VLASTNÍ PROFILY ----------------------------------------------------------
    // „Ulož, jak to mám teď" — vlastní profil je otisk PRÁVĚ NASTAVENÝCH hodnot
    // těch voleb, kterými hýbou vestavěné profily. Záměrně se nevymýšlí nový
    // seznam voleb: co umí vestavěný profil přepnout, to umí i vlastní, takže se
    // obě větve nemůžou rozejít. Aplikuje se úplně stejnou cestou (setControl →
    // saveSettings), takže se nikde nedrží druhá kopie nastavení.
    var CUST_KEY = 'agProfileCustom_v1';
    var CUST_PREFIX = 'vlastni_';
    function isCustom(id) { return String(id || '').indexOf(CUST_PREFIX) === 0; }
    function rawCustoms() {
        var a = null;
        try { a = JSON.parse(ls(CUST_KEY) || '[]'); } catch (e) {}
        if (Object.prototype.toString.call(a) !== '[object Array]') return [];
        return a.filter(function (c) { return c && c.id && c.t && c.set; });
    }
    function customProfiles() {
        return rawCustoms().map(function (c) {
            return {
                id: c.id, t: c.t, s: 'Tvůj vlastní profil', ic: '#i-star', custom: true,
                use: 'Vlastní profil — uložil sis do něj nastavení, které jsi měl v tu chvíli zapnuté.',
                set: c.set
            };
        });
    }
    function allProfiles() { return PROFILES.concat(customProfiles()); }
    function custSig() { return rawCustoms().map(function (c) { return c.id + ':' + c.t; }).join(','); }
    // klíče, které umí profil přepnout = sjednocení `set` vestavěných profilů
    function profileKeys() {
        var out = [], i, k;
        for (i = 0; i < PROFILES.length; i++) {
            for (k in PROFILES[i].set) {
                if (Object.prototype.hasOwnProperty.call(PROFILES[i].set, k) && out.indexOf(k) === -1) out.push(k);
            }
        }
        return out;
    }
    // otisk současného stavu; prvky, které v téhle verzi nejsou, se vynechají
    function snapshot() {
        var set = {}, keys = profileKeys(), n = 0;
        keys.forEach(function (k) {
            var el = $(k); if (!el) return;
            set[k] = (el.type === 'checkbox') ? !!el.checked : String(el.value);
            n++;
        });
        return n ? set : null;
    }
    function saveCustom() {
        var set = snapshot();
        if (!set) { toast('Nastavení se nepodařilo přečíst — otevři Nastavení a zkus to znovu.'); return; }
        var done = function (name) {
            name = (name || '').trim();
            if (!name) return;
            var list = rawCustoms();
            var id = CUST_PREFIX + Date.now();
            list.push({ id: id, t: name.slice(0, 24), set: set });
            try { lsSet(CUST_KEY, JSON.stringify(list)); } catch (e) {}
            lsSet(LAST_KEY, id);
            renderBar();
            toast('Profil „' + name + '" uložen z toho, jak to máš teď nastavené.');
        };
        var msg = 'Uloží se ' + Object.keys(set).length + ' voleb tak, jak je máš právě teď. Jak se má profil jmenovat?';
        try {
            if (typeof window.agGet === 'function') { window.agGet(msg, { title: 'Vlastní profil', placeholder: 'Např. Moje pokládka' }).then(done); return; }
        } catch (e) {}
        done(window.prompt(msg, ''));
    }
    function deleteCustom(id) {
        var p = byId(id); if (!p || !p.custom) return;
        var go = function () {
            try { lsSet(CUST_KEY, JSON.stringify(rawCustoms().filter(function (c) { return c.id !== id; }))); } catch (e) {}
            // smazaný profil nesmí zůstat „aktivní"; nastavení se ZÁMĚRNĚ nevrací
            // (stejný důvod jako u odznačení — viz hlavička souboru)
            if (ls(LAST_KEY) === id) lsDel(LAST_KEY);
            renderBar();
            toast('Profil smazán. Nastavení zůstává, jak je.');
        };
        var q = 'Smazat profil „' + p.t + '"? Nastavení se nemění, zmizí jen tenhle uložený otisk.';
        try {
            if (typeof window.agGuard === 'function') { window.agGuard(q, go, { title: 'Smazat profil', danger: true }); return; }
        } catch (e) {}
        if (window.confirm(q)) go();
    }

    function byId(profId) {
        var a = allProfiles();
        for (var i = 0; i < a.length; i++) if (a[i].id === profId) return a[i];
        return null;
    }

    function apply(profId) {
        var p = byId(profId);
        if (!p) return;
        var done = 0, skipped = 0;
        for (var k in p.set) {
            if (!Object.prototype.hasOwnProperty.call(p.set, k)) continue;
            if (setControl(k, p.set[k])) done++; else skipped++;
        }
        lsSet(LAST_KEY, p.id);
        // Uložení a použití nechme na appce — saveSettings() přečte VŠECHNY prvky
        // (i ty, na které jsme nesáhli) a zavře panel, takže je hned vidět výsledek.
        var saved = false;
        try {
            if (typeof saveSettings === 'function') { saveSettings(); saved = true; }
        } catch (e) { console.warn('[profily] saveSettings', e); }
        renderBar();
        toast('Profil „' + p.t + '“ použit' + (saved ? '' : ' — potvrď „Uložit vše a Zavřít“')
            + (skipped ? ' (' + skipped + ' volb' + (skipped === 1 ? 'a' : 'y') + ' není v této verzi)' : ''));
    }

    // Odznačení profilu. NIC nepřepisuje zpět — viz hlavička souboru.
    function clearProfile() {
        lsDel(LAST_KEY);
        renderBar();
        toast('Bez profilu — nastavení zůstává, jak je. Řídíš si ho sám.');
    }

    // ---- pruh profilů nad záložkami Nastavení -------------------------------------
    function ensureBar() {
        var bar = $('ag-prof-bar');
        if (bar) return bar;
        var m = $('settings-modal'); if (!m) return null;
        var content = m.querySelector('.modal-content'); if (!content) return null;
        var tabs = content.querySelector('.tab-buttons'); if (!tabs) return null;
        // NOVĚ (návrh C): pruh patří do záložky „Profily", ne NAD záložky. Dřív ho
        // musel přejít každý, kdo šel do Nastavení cokoli přepnout — první skutečná
        // volba tak začínala až v třetině displeje. Do staršího index.html bez téhle
        // záložky spadneme na původní místo, ať modul zůstane samostatný.
        var host = $('tab-profily');
        bar = document.createElement('div');
        bar.id = 'ag-prof-bar';
        bar.innerHTML = '<span class="h">Přepne několik voleb naráz</span>'
            + '<div id="ag-prof-row" role="group" aria-label="Profil použití"></div>'
            + '<p id="ag-prof-note"></p>'
            + '<details id="ag-prof-det">'
            + '<summary>Co profily mění a v čem se liší'
            + '<svg class="icon chev" style="width:13px;height:13px;"><use href="#i-chevron-down"/></svg></summary>'
            + '<div id="ag-prof-body"></div>'
            + '</details>';
        if (host) host.appendChild(bar); else content.insertBefore(bar, tabs);
        bar.querySelector('#ag-prof-row').addEventListener('click', function (ev) {
            if (!ev.target.closest) return;
            // „Bez profilu" je od 8.8.2026 VIDITELNÁ dlaždice. Dřív se profil vypínal
            // jen ťuknutím na právě aktivní dlaždici — což se nedalo uhodnout, takže
            // kdo si profil jednou zapnul, neměl jak se dostat zpátky do stavu
            // „nastavení si řídím sám". Skryté ťuknutí zůstává, ať se nikomu nezmění
            // zvyk.
            if (ev.target.closest('button[data-off]')) { clearProfile(); return; }
            if (ev.target.closest('button[data-new]')) { saveCustom(); return; }
            var b = ev.target.closest('button[data-prof]');
            if (!b) return;
            var id = b.getAttribute('data-prof');
            if (id === ls(LAST_KEY)) clearProfile(); else apply(id);
        });
        bar.querySelector('#ag-prof-note').addEventListener('click', function (ev) {
            var d = ev.target.closest ? ev.target.closest('button[data-del]') : null;
            if (d) deleteCustom(d.getAttribute('data-del'));
        });
        bar.querySelector('#ag-prof-det').addEventListener('toggle', function () { renderDetail(true); });
        return bar;
    }

    function renderBar() {
        injectStyles();
        var bar = ensureBar(); if (!bar) return;
        var last = ls(LAST_KEY);
        var row = bar.querySelector('#ag-prof-row');
        // pruh se přestavuje i po přibytí/smazání vlastního profilu, ne jen jednou
        if (row.getAttribute('data-sig') !== custSig()) {
            row.setAttribute('data-sig', custSig());
            row.setAttribute('data-last', ' ');   // vynuť dorovnání zvýraznění níž
            row.innerHTML =
                '<button type="button" data-off="1" title="Nepoužívat žádný profil" aria-pressed="false">'
                + '<svg class="icon"><use href="#i-x"/></svg>Bez profilu</button>'
                + allProfiles().map(function (p) {
                    return '<button type="button" data-prof="' + p.id + '" title="' + esc(p.s) + '" aria-pressed="false">'
                        + '<svg class="icon"><use href="' + p.ic + '"/></svg>' + esc(p.t) + '</button>';
                }).join('')
                + '<button type="button" data-new="1" title="Uložit současné nastavení jako vlastní profil" aria-pressed="false">'
                + '<svg class="icon"><use href="#i-plus"/></svg>Vlastní</button>';
        }
        if (row.getAttribute('data-last') !== String(last)) {
            row.setAttribute('data-last', String(last));
            var btns = row.querySelectorAll('button[data-prof]');
            for (var i = 0; i < btns.length; i++) {
                var on = btns[i].getAttribute('data-prof') === last;
                btns[i].className = on ? 'on' : '';
                btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
            }
            // „Bez profilu" svítí, když žádný profil neběží — stav je tak vidět,
            // ne jen odvoditelný z toho, že nesvítí nic
            var off = row.querySelector('button[data-off]');
            if (off) {
                var none = !byId(last);
                off.className = none ? 'on' : '';
                off.setAttribute('aria-pressed', none ? 'true' : 'false');
            }
        }
        var note = bar.querySelector('#ag-prof-note');
        var cur = byId(last);
        var html = cur
            ? ('<b>' + esc(cur.t) + ':</b> ' + esc(cur.use)
                + ' <i>Vypneš ho dlaždicí „Bez profilu“.</i>'
                + (cur.custom ? ' <button type="button" data-del="' + esc(cur.id) + '">Smazat tenhle profil</button>' : ''))
            // Dřív tu byly tři řádky vysvětlování a hlavička Nastavení kvůli nim začínala
            // až třetinu obrazovky pod okrajem. Podrobnosti jsou v detailu pod tím.
            : '<b>Bez profilu</b> — nastavení si řídíš sám v záložkách níž. '
                + 'Až si ho doladíš, můžeš si ho uložit dlaždicí <b>Vlastní</b>.';
        if (note.innerHTML !== html) note.innerHTML = html;
        renderDetail(false);
    }

    // ---- srovnávací tabulka (generovaná z `set`, nikdy ručně psaná) -----------------
    // Staví se až při otevření detailu — tedy až tehdy, když už mají všechny moduly
    // vložené své řádky do Nastavení. Řádek pro prvek, který v appce není, by lhal.
    function renderDetail(force) {
        var det = $('ag-prof-det'); if (!det) return;
        if (!det.open) return;
        var body = $('ag-prof-body'); if (!body) return;
        var last = String(ls(LAST_KEY));
        var i, j, L;

        // podpis: aktivní profil + které prvky zrovna existují → zbytečně nepřekresluj
        var sig = last + '|';
        for (i = 0; i < LABELS.length; i++) sig += ($(LABELS[i].id) ? '1' : '0');
        if (!force && body.getAttribute('data-sig') === sig) return;
        body.setAttribute('data-sig', sig);

        var head = '<tr><th>Co se nastaví</th>';
        for (j = 0; j < PROFILES.length; j++) {
            head += '<th' + (PROFILES[j].id === last ? ' class="on"' : '') + '>' + esc(PROFILES[j].t) + '</th>';
        }
        head += '</tr>';

        var rows = '';
        for (i = 0; i < LABELS.length; i++) {
            L = LABELS[i];
            if (!$(L.id)) continue;                 // prvek v téhle verzi není — řádek vynech
            var any = false, tds = '';
            for (j = 0; j < PROFILES.length; j++) {
                var s = PROFILES[j].set;
                var has = Object.prototype.hasOwnProperty.call(s, L.id);
                if (has) any = true;
                var cls = (PROFILES[j].id === last ? 'on' : '') + (has ? '' : ' x');
                tds += '<td' + (cls.replace(/^\s+|\s+$/g, '') ? ' class="' + cls.replace(/^\s+|\s+$/g, '') + '"' : '') + '>'
                    + (has ? esc(L.f(s[L.id])) : '–') + '</td>';
            }
            if (any) rows += '<tr><td>' + esc(L.n) + '</td>' + tds + '</tr>';
        }

        var use = '';
        for (j = 0; j < PROFILES.length; j++) {
            use += '<p><b>' + esc(PROFILES[j].t) + '</b> — ' + esc(PROFILES[j].use) + '</p>';
        }

        body.innerHTML = '<div id="ag-prof-tw"><table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>'
            + '<p id="ag-prof-legend">– = profil na tuhle volbu vůbec nesáhá, zůstane po tvém. '
            + 'Zorný úhel kamery, korekci severu, barvy, motiv ani levou ruku profil nemění nikdy — '
            + 'to je nastavení telefonu a člověka, ne způsobu práce. '
            + 'Ťuknutí na profil nastaví několik voleb naráz, ťuknutí na ten samý ho zase vypne '
            + '(hodnoty zůstanou, jen se přestane hlídat).</p>'
            + '<div id="ag-prof-use">' + use + '</div>';
    }

    // ---- profil zařízení: export / import -----------------------------------------
    // POZOR: visSettings i userHeadingOffset jsou v logika.js deklarované přes `let`,
    // takže NEJSOU vlastnostmi window — musí se číst holým jménem s typeof guardem
    // (stejně to dělá js/calib-profiles.js). window.visSettings by bylo undefined.
    function headingOffset() {
        try { if (typeof userHeadingOffset !== 'undefined' && isFinite(userHeadingOffset)) return +userHeadingOffset; } catch (e) {}
        return 0;
    }
    function vis() {
        try { return (typeof visSettings !== 'undefined' && visSettings) ? visSettings : null; } catch (e) { return null; }
    }
    function collectDevice() {
        var v = vis() || {};
        var out = {
            format: 'ag-device-profile',
            v: 1,
            fovH: (+v.fovH) || null,
            fovV: (+v.fovV) || null,
            eyeHeight: (+v.eyeHeight) || null,
            headingOffset: headingOffset(),
            calibProfiles: null
        };
        try {
            var raw = ls('agCalibProfiles');
            if (raw) out.calibProfiles = JSON.parse(raw);
        } catch (e) {}
        return out;
    }
    function deviceSummary() {
        var d = collectDevice();
        var parts = [];
        parts.push('zorný úhel <b>' + (d.fovH ? d.fovH + '×' + (d.fovV || '?') + '°' : 'neurčen') + '</b>');
        parts.push('výška očí <b>' + (d.eyeHeight ? String(d.eyeHeight).replace('.', ',') + ' m' : 'neurčena') + '</b>');
        parts.push('korekce severu <b>' + (Math.round(d.headingOffset * 10) / 10).toString().replace('.', ',') + '°</b>');
        var n = (d.calibProfiles && d.calibProfiles.length) || 0;
        parts.push('uložených kalibrací <b>' + n + '</b>');
        return parts.join(' · ');
    }
    function exportDevice() {
        var d = collectDevice();
        var name = 'ar-geodet-zarizeni-' + (navigator.userAgent.indexOf('iPhone') > -1 ? 'iphone' : 'telefon') + '.agdev';
        try {
            var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 4000);
            toast('Profil zařízení uložen do souboru');
        } catch (e) {
            console.warn('[profily] export', e);
            toast('Export se nepovedl');
        }
    }
    function importDevice(file) {
        if (!file) return;
        var fr = new FileReader();
        fr.onload = function () {
            var d;
            try { d = JSON.parse(String(fr.result)); } catch (e) { toast('Soubor nejde přečíst'); return; }
            if (!d || d.format !== 'ag-device-profile') { toast('To není profil zařízení (.agdev)'); return; }
            var ask = 'Přepsat kalibraci TOHOTO telefonu?\n\n'
                + 'zorný úhel: ' + (d.fovH || '?') + '×' + (d.fovV || '?') + '°\n'
                + 'výška očí: ' + (d.eyeHeight || '?') + ' m\n'
                + 'korekce severu: ' + (Math.round((d.headingOffset || 0) * 10) / 10) + '°\n'
                + 'uložené kalibrace: ' + ((d.calibProfiles && d.calibProfiles.length) || 0) + '\n\n'
                + 'Body, zakázky ani účty se nemění. Zorný úhel platí pro MODEL telefonu — '
                + 'z jiného modelu ho nepřenášej.';
            agGuard(ask, function () { nahrajProfil(d); }, { danger: true });
        };
        // Vlastni nahrani profilu. Vytazeno z obsluhy FileReaderu, protoze potvrzeni je
        // ted in-app dialog (asynchronni) - jinak by se telo muselo cele odsadit dovnitr.
        function nahrajProfil(d) {
            var v = vis();
            if (v) {
                if (d.fovH) v.fovH = +d.fovH;
                if (d.fovV) v.fovV = +d.fovV;
                if (d.eyeHeight) v.eyeHeight = +d.eyeHeight;
                try {
                    if (typeof setStoredData === 'function') setStoredData('arVisSettings12', JSON.stringify(v));
                } catch (e) {}
                try { if (typeof applyVisualSettings === 'function') applyVisualSettings(); } catch (e) {}
            }
            // korekce severu: jen přes oficiální páku appky, ať se přepočítá i AR
            try {
                if (typeof d.headingOffset === 'number' && typeof resetHeadingOffset === 'function'
                    && typeof nudgeHeadingOffset === 'function') {
                    resetHeadingOffset();
                    if (d.headingOffset) nudgeHeadingOffset(d.headingOffset);
                }
            } catch (e) {}
            if (d.calibProfiles && d.calibProfiles.length) {
                try { lsSet('agCalibProfiles', JSON.stringify(d.calibProfiles)); } catch (e) {}
            }
            // posuvníky v panelu dorovnat, ať tam nesvítí stará čísla
            if (v) { setControl('s-fovh', v.fovH || 90); setControl('s-fovv', v.fovV || 75); if (v.eyeHeight) setControl('s-eyeh', v.eyeHeight); }
            renderDevice();
            toast('Profil zařízení nahrán');
        }
        fr.onerror = function () { toast('Soubor nejde přečíst'); };
        fr.readAsText(file);
    }

    function ensureDeviceBox() {
        var box = $('ag-dev-box');
        if (box) return box;
        var tab = $('tab-udrzba'); if (!tab) return null;
        box = document.createElement('div');
        box.id = 'ag-dev-box';
        box.innerHTML =
            '<div class="set-h">Profil zařízení (kalibrace telefonu)</div>'
            + '<p id="ag-dev-sum"></p>'
            + '<div class="ag-dev-row" style="margin-top:10px;">'
            + '  <button type="button" class="btn btn-secondary" id="ag-dev-exp"><svg class="icon"><use href="#i-upload"/></svg> Uložit do souboru</button>'
            + '  <button type="button" class="btn btn-blue" id="ag-dev-imp"><svg class="icon"><use href="#i-folder"/></svg> Nahrát ze souboru</button>'
            + '</div>'
            + '<input type="file" id="ag-dev-file" accept=".agdev,.json,application/json" style="display:none">'
            + '<p style="font-size:calc(11.5px * var(--ag-font-scale, 1));line-height:1.5;opacity:.7;margin:8px 2px 0;">Přenese zorný úhel kamery, výšku očí, korekci severu a uložené kalibrace '
            + 'na další telefon v partě. <b>Zorný úhel patří k modelu telefonu</b> — mezi různými modely ho nepřenášej. '
            + 'Body a zakázky v tom nejsou, na ty je záloha výše.</p>';
        tab.appendChild(box);
        box.querySelector('#ag-dev-exp').addEventListener('click', exportDevice);
        box.querySelector('#ag-dev-imp').addEventListener('click', function () { $('ag-dev-file').click(); });
        box.querySelector('#ag-dev-file').addEventListener('change', function (ev) {
            importDevice(ev.target.files && ev.target.files[0]);
            ev.target.value = '';
        });
        return box;
    }
    function renderDevice() {
        var box = ensureDeviceBox(); if (!box) return;
        var sum = box.querySelector('#ag-dev-sum');
        var html = deviceSummary();
        if (sum.innerHTML !== html) sum.innerHTML = html;
    }

    // ---- init ---------------------------------------------------------------------
    function tick() {
        try { renderBar(); renderDevice(); } catch (e) {}
    }
    function init() {
        tick();
        // Panel Nastavení a jeho injektované řádky vznikají postupně (17 modulů),
        // proto se dorovnáváme sdíleným UI časovačem jako ostatní vrstvy.
        if (!window.__agProfTimer) {
            window.__agProfTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(tick, 2000);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    window.AGProfily = { apply: apply, clear: clearProfile, profiles: PROFILES, labels: LABELS, device: collectDevice };
})();
