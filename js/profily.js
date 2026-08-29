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
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:lsSet'); } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:lsDel'); } }
    function $(id) { return document.getElementById(id); }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(msg) {
        try { if (typeof quickToast === 'function') { quickToast(msg); return; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:toast'); }
        try { if (typeof window.agInfo === 'function') { window.agInfo(msg); return; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:toast'); }
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
            '#ag-prof-note button[data-snap]{display:inline-block;background:none;border:none;padding:0;cursor:pointer;',
            '  color:var(--accent,#2f9e74);font:600 11.5px/1.45 var(--font-ui,system-ui),sans-serif;text-decoration:underline;}',

            // ---- PRŮVODCE vlastním profilem ----
            // z-index nad Nastavením, ale POD dialogy (--z-dialog 2000000)
            '#ag-wiz{position:fixed;inset:0;z-index:1000004;display:none;align-items:center;justify-content:center;',
            '  padding:14px;background:rgba(4,8,12,0.7);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);}',
            '#ag-wiz.on{display:flex;}',
            '#ag-wiz .ag-wiz-box{width:min(440px,100%);max-height:90vh;display:flex;flex-direction:column;',
            '  box-sizing:border-box;padding:16px 18px 18px;border-radius:18px;background:var(--bg-elev,#151a21);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));box-shadow:0 24px 60px rgba(0,0,0,0.55);',
            '  color:var(--text-color,#eceef2);}',
            '.ag-wiz-top{display:flex;align-items:center;gap:10px;margin-bottom:10px;}',
            '.ag-wiz-top span{font:700 11px/1.2 var(--font-ui,system-ui),sans-serif;letter-spacing:.12em;',
            '  text-transform:uppercase;color:var(--accent,#2f9e74);}',
            '.ag-wiz-top button{margin-left:auto;background:none;border:none;cursor:pointer;padding:2px 4px;',
            '  color:var(--text-muted,#9aa1ac);font-size:calc(17px * var(--ag-font-scale, 1));line-height:1;}',
            '#ag-wiz-body{overflow-y:auto;-webkit-overflow-scrolling:touch;}',
            '#ag-wiz-body h3{margin:0 0 4px;font:700 17px/1.25 var(--font-ui,system-ui),sans-serif;}',
            '.ag-wiz-h{margin:0 0 12px;font:500 12px/1.5 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            // odpovědi: velký dotykový cíl, vysvětlení pod jménem
            '#ag-wiz-body button[data-opt]{display:block;width:100%;text-align:left;margin-bottom:8px;padding:13px 14px;',
            '  border-radius:13px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:rgba(255,255,255,0.05);color:var(--text-color,#eceef2);cursor:pointer;}',
            '#ag-wiz-body button[data-opt] b{display:block;font:700 14.5px/1.3 var(--font-ui,system-ui),sans-serif;}',
            '#ag-wiz-body button[data-opt] span{display:block;margin-top:3px;font:500 12px/1.45 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-muted,#9aa1ac);}',
            '#ag-wiz-body button[data-opt].on{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.16));}',
            '#ag-wiz-body button[data-opt].on b{color:var(--accent-bright,#4ccd99);}',
            // shrnutí: dvojice popisek → hodnota, hodnoty monospace kvůli zarovnání
            '.ag-wiz-sum{list-style:none;margin:0 0 14px;padding:0;}',
            '.ag-wiz-sum li{display:flex;align-items:baseline;gap:10px;padding:6px 0;',
            '  border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.08));}',
            '.ag-wiz-sum li span{flex:1;font:500 12.5px/1.4 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '.ag-wiz-sum li b{font-family:var(--font-mono,ui-monospace,monospace);font-size:calc(12px * var(--ag-font-scale, 1));',
            '  color:var(--data,#e6bd76);white-space:nowrap;}',
            '#ag-wiz-body label{display:block;margin:0 0 4px;font:600 12px/1.2 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-muted,#9aa1ac);}',
            '#ag-wiz-name{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.06);',
            '  color:var(--text-color,#eceef2);font:inherit;font-size:calc(15px * var(--ag-font-scale, 1));}',
            '.ag-wiz-err{min-height:15px;margin-top:6px;color:var(--danger,#ef4444);',
            '  font:600 12px/1.3 var(--font-ui,system-ui),sans-serif;}',
            '.ag-wiz-btns{display:flex;gap:8px;margin-top:14px;}',
            '.ag-wiz-btns button{flex:1;padding:12px;border-radius:12px;cursor:pointer;',
            '  font:700 13.5px/1 var(--font-ui,system-ui),sans-serif;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.06);',
            '  color:var(--text-color,#eceef2);}',
            '.ag-wiz-btns button.prim{border-color:transparent;background:var(--accent-grad,#2f9e74);color:#fff;}',
            '.ag-wiz-btns button:disabled{opacity:.45;cursor:default;}',
            'body.ag-glove #ag-wiz-body button[data-opt]{padding:16px;}',
            // „Bez profilu" je rovnocenná volba, ne popřená akce — svítí stejně jako profil
            '#ag-prof-row button[data-off].on{border-color:var(--glass-border,rgba(255,255,255,0.28));',
            '  background:rgba(255,255,255,0.10);color:var(--text-color,#eceef2);}',
            '#ag-prof-row button[data-off].on .icon{color:var(--text-color,#eceef2);}',
            '#ag-prof-row button[data-new]{border-style:dashed;}',
            // ---- sbalitelné srovnání ----
            // ⚠ PILULKA V KRABICI (nahlášeno 9. 8. 2026: „obrovskej šedej obdélník
            // a v tom malinkatej obdélníček s tím nápisem"). Tady se potkaly DVA
            // vzhledy rozbalovátka: css/tools-polish.css dělá z každého <details>
            // v .modal-content KARTU (rámeček + šedé pozadí přes celou šířku), kdežto
            // tenhle soubor si z <summary> dělal malou pilulku s vlastním rámečkem —
            // výsledkem byl 352 px široký šedý blok, ve kterém se krčilo 198 px tlačítko.
            // Souboj vyhrávala pilulka (specifičnost id), ale kartu pod sebou nezrušila.
            // ŘEŠENÍ: summary je celý řádek karty (vlastní rámeček ani pozadí nemá).
            // Šipku kreslí ::after z tools-polish.css — vlastní sem NEPŘIDÁVAT, byly by dvě.
            '#ag-prof-det{margin:10px 0 0;}',
            '#ag-prof-det>summary{list-style:none;cursor:pointer;display:block;',
            '  padding:11px 13px;border:0;background:none;color:var(--text-muted,#9aa1ac);',
            '  font:600 calc(12.5px * var(--ag-font-scale, 1))/1.25 var(--font-ui,system-ui),sans-serif;}',
            '#ag-prof-det>summary::-webkit-details-marker{display:none;}',
            '#ag-prof-det[open]>summary{color:var(--accent-bright,#3eb487);}',
            '#ag-prof-body{margin-top:2px;}',
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
            'body.ag-glove #ag-prof-det>summary{padding:14px 13px;font-size:calc(13.5px * var(--ag-font-scale, 1));}'
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
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:setControl'); }
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:setControl'); }
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
        try { a = JSON.parse(ls(CUST_KEY) || '[]'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:rawCustoms'); }
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
            try { lsSet(CUST_KEY, JSON.stringify(list)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:done'); }
            lsSet(LAST_KEY, id);
            renderBar();
            toast('Profil „' + name + '" uložen z toho, jak to máš teď nastavené.');
        };
        var msg = 'Uloží se ' + Object.keys(set).length + ' voleb tak, jak je máš právě teď. Jak se má profil jmenovat?';
        try {
            if (typeof window.agGet === 'function') { window.agGet(msg, { title: 'Vlastní profil', placeholder: 'Např. Moje pokládka' }).then(done); return; }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:done'); }
        done(window.prompt(msg, ''));
    }
    function deleteCustom(id) {
        var p = byId(id); if (!p || !p.custom) return;
        var go = function () {
            try { lsSet(CUST_KEY, JSON.stringify(rawCustoms().filter(function (c) { return c.id !== id; }))); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:go'); }
            // smazaný profil nesmí zůstat „aktivní"; nastavení se ZÁMĚRNĚ nevrací
            // (stejný důvod jako u odznačení — viz hlavička souboru)
            if (ls(LAST_KEY) === id) lsDel(LAST_KEY);
            renderBar();
            toast('Profil smazán. Nastavení zůstává, jak je.');
        };
        var q = 'Smazat profil „' + p.t + '"? Nastavení se nemění, zmizí jen tenhle uložený otisk.';
        try {
            if (typeof window.agGuard === 'function') { window.agGuard(q, go, { title: 'Smazat profil', danger: true }); return; }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:go'); }
        if (window.confirm(q)) go();
    }

    // ================================================================================
    // PRŮVODCE VLASTNÍM PROFILEM
    // PROČ: „ulož, jak to mám teď" předpokládá, že si člověk nejdřív projde ~80 voleb
    // ve čtyřech záložkách a najde v nich to, co profil vůbec umí přepnout. To po
    // nikom nechceme. Průvodce se místo toho zeptá na ČTYŘI VĚCI BĚŽNOU ŘEČÍ a každá
    // odpověď přepne rovnou celou skupinu voleb; na konci ukáže, co z toho vzešlo.
    //
    // ZÁSADY:
    //  • Ptáme se na ZÁMĚR („vydržet směnu"), ne na hodnoty („uspat GPS: ano/ne").
    //    Konkrétní čísla jsou pod odpovědí drobným písmem — kdo chce, přečte si je.
    //  • Předvybírá se to, co uživatel má NASTAVENÉ TEĎ (funkce `now`), takže projít
    //    průvodce a nic neměnit = uložit si dnešek pod jménem.
    //  • Nic se neaplikuje během klikání. Teprve „Uložit" nastaví ovládací prvky
    //    a zavolá saveSettings — stejnou cestou jako vestavěné profily.
    //  • Volby, které v téhle verzi appky nejsou (odpojený modul), se tiše vynechají.
    // ================================================================================
    var WIZ = [
        {
            q: 'Co je pro tebe důležitější?',
            h: 'Podle toho se nastaví spánek senzorů, buzení displeje a plynulost AR.',
            now: function () { return $('agp-enabled') && !$('agp-enabled').checked ? 'plynule' : ($('s-wakelock') && $('s-wakelock').checked ? 'vyvazene' : 'setrit'); },
            opts: [
                { id: 'setrit', t: 'Vydržet celou směnu', s: 'Kamera, kompas i GPS spí, když nekoukáš do AR. Displej se nechá zhasnout.',
                  set: { 'agp-enabled': true, 'agp-gps': true, 's-wakelock': false, 's-anim': 'off', 'ag-arfusion-cb': false, 'agvt-settings-cb': false } },
                { id: 'vyvazene', t: 'Vyvážené', s: 'Senzory spí mimo AR, ale displej nezhasne a směr je plynulý.',
                  set: { 'agp-enabled': true, 'agp-gps': false, 's-wakelock': true, 's-anim': 'off', 'ag-arfusion-cb': true, 'agvt-settings-cb': false } },
                { id: 'plynule', t: 'Ať to jede jak po másle', s: 'Nic se neuspává, běží stabilizace obrazu i fúze gyra. Baterie ubývá výrazně rychleji.',
                  set: { 'agp-enabled': false, 'agp-gps': false, 's-wakelock': true, 's-anim': 'on', 'ag-arfusion-cb': true, 'agvt-settings-cb': true } }
            ]
        },
        {
            q: 'Kde budeš na displej koukat?',
            h: 'Řídí kontrast, průhlednost panelů a velikost štítků u bodů.',
            now: function () { return ($('s-outdoor') && $('s-outdoor').checked) ? 'slunce' : 'stin'; },
            opts: [
                { id: 'slunce', t: 'Venku na ostrém slunci', s: 'Vysoký kontrast, neprůhledné panely, větší štítky bodů.',
                  set: { 's-outdoor': true, 'v-adaptive-glass': false, 'v-panel-opacity': '100', 'v-marker-scale': '110' } },
                { id: 'stin', t: 'Ve stínu nebo v autě', s: 'Běžný vzhled, panely prosvítají, štítky menší — vidíš víc mapy.',
                  set: { 's-outdoor': false, 'v-adaptive-glass': true, 'v-panel-opacity': '85', 'v-marker-scale': '100' } }
            ]
        },
        {
            q: 'Jak daleko chceš vidět body?',
            h: 'Daleký dohled zaplní obrazovku body, které zrovna neřešíš, a stojí výkon.',
            now: function () { var v = $('s-ar-radius-slider') ? +$('s-ar-radius-slider').value : 150; return v <= 200 ? 'blizko' : (v <= 700 ? 'stredne' : 'daleko'); },
            opts: [
                { id: 'blizko', t: 'Jen kolem sebe', s: 'V AR 100 m a nejvýš 20 bodů — čistý obraz, když stojíš v hustém bodovém poli.',
                  set: { 's-ar-radius-slider': '100', 's-max-ar-slider': '20', 's-map-radius-slider': '300' } },
                { id: 'stredne', t: 'Po celé stavbě', s: 'V AR 400 m a 60 bodů. Rozumný kompromis pro běžnou zakázku.',
                  set: { 's-ar-radius-slider': '400', 's-max-ar-slider': '60', 's-map-radius-slider': '1000' } },
                { id: 'daleko', t: 'Co nejdál', s: 'V AR 2000 m a 120 bodů. Na předvádění nebo rozhled po okolí, ne na práci.',
                  set: { 's-ar-radius-slider': '2000', 's-max-ar-slider': '120', 's-map-radius-slider': '2000' } }
            ]
        },
        {
            q: 'Jak se má chovat směr v AR?',
            h: 'Vyhlazení a korekce kompasu: buď rychlá reakce, nebo klidné značky.',
            now: function () { var v = $('s-heading-smooth') ? +$('s-heading-smooth').value : 70; return v >= 85 ? 'klidne' : 'svizne'; },
            opts: [
                { id: 'svizne', t: 'Svižně reagovat', s: 'Otočíš se a značky jdou hned s tebou. Trochu se chvějí.',
                  set: { 's-heading-smooth': '55', 's-auto-compass': false, 's-tilt-comp': false, 'tgl-gpsavg': true } },
                { id: 'klidne', t: 'Klidně stát na místě', s: 'Značky se netřesou a drží, kde mají. Reakce na otočení je pomalejší.',
                  set: { 's-heading-smooth': '90', 's-auto-compass': true, 's-tilt-comp': true, 'tgl-gpsavg': true } }
            ]
        }
    ];

    var _wizStep = 0, _wizPick = [];

    // Sloučí odpovědi do jedné mapy id → hodnota. Pozdější krok přebíjí dřívější
    // (žádný se dnes nepřekrývá, ale ať to platí i po přidání otázky).
    function wizSet() {
        var out = {};
        for (var i = 0; i < WIZ.length; i++) {
            var o = null, j;
            for (j = 0; j < WIZ[i].opts.length; j++) if (WIZ[i].opts[j].id === _wizPick[i]) o = WIZ[i].opts[j];
            if (!o) continue;
            for (var k in o.set) if (Object.prototype.hasOwnProperty.call(o.set, k)) out[k] = o.set[k];
        }
        return out;
    }
    // Shrnutí lidsky: jména a formát bere z LABELS (stejný zdroj jako srovnávací
    // tabulka), takže se nemůže rozejít. Co v appce není, se vynechá.
    function wizSummary(set) {
        var rows = [];
        for (var i = 0; i < LABELS.length; i++) {
            var L = LABELS[i];
            if (!(L.id in set)) continue;
            if (!$(L.id)) continue;
            rows.push({ n: L.n, v: L.f(set[L.id]) });
        }
        return rows;
    }

    function wizEl() {
        var el = $('ag-wiz');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'ag-wiz';
        el.innerHTML = '<div class="ag-wiz-box" role="dialog" aria-modal="true" aria-label="Průvodce profilem">'
            + '<div class="ag-wiz-top"><span id="ag-wiz-step"></span>'
            + '<button type="button" id="ag-wiz-x" aria-label="Zavřít">✕</button></div>'
            + '<div id="ag-wiz-body"></div>'
            + '<div class="ag-wiz-btns">'
            + '  <button type="button" id="ag-wiz-back">Zpět</button>'
            + '  <button type="button" class="prim" id="ag-wiz-next">Další</button>'
            + '</div></div>';
        document.body.appendChild(el);
        el.addEventListener('click', function (ev) { if (ev.target === el) wizClose(); });
        el.querySelector('#ag-wiz-x').addEventListener('click', wizClose);
        el.querySelector('#ag-wiz-back').addEventListener('click', function () {
            if (_wizStep === 0) { wizClose(); return; }
            _wizStep--; wizRender();
        });
        el.querySelector('#ag-wiz-next').addEventListener('click', function () {
            if (_wizStep < WIZ.length) { _wizStep++; wizRender(); return; }
            wizSave();
        });
        el.querySelector('#ag-wiz-body').addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('button[data-opt]') : null;
            if (!b) return;
            _wizPick[_wizStep] = b.getAttribute('data-opt');
            wizRender();
        });
        return el;
    }
    function wizClose() { var el = $('ag-wiz'); if (el) el.classList.remove('on'); }

    function wizRender() {
        var el = wizEl();
        var body = el.querySelector('#ag-wiz-body');
        var last = _wizStep >= WIZ.length;
        el.querySelector('#ag-wiz-step').textContent = last
            ? 'Hotovo — zkontroluj a pojmenuj'
            : 'Krok ' + (_wizStep + 1) + ' z ' + WIZ.length;
        el.querySelector('#ag-wiz-back').textContent = _wizStep === 0 ? 'Zrušit' : 'Zpět';
        el.querySelector('#ag-wiz-next').textContent = last ? 'Uložit profil' : 'Další';
        el.querySelector('#ag-wiz-next').disabled = !last && !_wizPick[_wizStep];

        if (!last) {
            var s = WIZ[_wizStep];
            body.innerHTML = '<h3>' + esc(s.q) + '</h3><p class="ag-wiz-h">' + esc(s.h) + '</p>'
                + s.opts.map(function (o) {
                    return '<button type="button" data-opt="' + esc(o.id) + '"'
                        + (o.id === _wizPick[_wizStep] ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>'
                        + '<b>' + esc(o.t) + '</b><span>' + esc(o.s) + '</span></button>';
                }).join('');
            return;
        }
        var set = wizSet(), rows = wizSummary(set);
        body.innerHTML = '<h3>Co se profilem nastaví</h3>'
            + '<ul class="ag-wiz-sum">' + rows.map(function (r) {
                return '<li><span>' + esc(r.n) + '</span><b>' + esc(r.v) + '</b></li>';
            }).join('') + '</ul>'
            + '<label for="ag-wiz-name">Jméno profilu</label>'
            + '<input type="text" id="ag-wiz-name" maxlength="24" autocomplete="off" placeholder="Např. Pokládka na slunci" value="' + esc(_wizName()) + '">'
            + '<div class="ag-wiz-err" id="ag-wiz-err"></div>';
    }
    // Návrh jména z odpovědí — ať uživatel nemusí vymýšlet nic, když nechce.
    function _wizName() {
        var a = _wizPick[0], b = _wizPick[1];
        var t = a === 'setrit' ? 'Na celý den' : (a === 'plynule' ? 'Plynulé AR' : 'Vyvážený');
        if (b === 'slunce') t += ' na slunci';
        return t;
    }
    function wizSave() {
        var el = $('ag-wiz');
        var name = (el.querySelector('#ag-wiz-name').value || '').trim();
        var err = el.querySelector('#ag-wiz-err');
        if (!name) { err.textContent = 'Napiš jméno profilu.'; return; }
        var set = wizSet();
        // ulož jen to, co v téhle verzi appky opravdu existuje
        var clean = {}, n = 0;
        for (var k in set) if (Object.prototype.hasOwnProperty.call(set, k) && $(k)) { clean[k] = set[k]; n++; }
        if (!n) { err.textContent = 'Nastavení se nepodařilo přečíst — zavři a zkus to znovu.'; return; }
        var list = rawCustoms();
        var id = CUST_PREFIX + Date.now();
        list.push({ id: id, t: name.slice(0, 24), set: clean });
        try { lsSet(CUST_KEY, JSON.stringify(list)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:wizSave'); }
        wizClose();
        apply(id);            // rovnou zapnout — projít průvodce a nic nevidět by bylo divné
    }
    function wizOpen() {
        injectStyles();
        _wizStep = 0;
        _wizPick = WIZ.map(function (s) { try { return s.now(); } catch (e) { return null; } });
        wizEl().classList.add('on');
        wizRender();
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
        // Vlastní hlavička („Profil použití — nastaví několik voleb naráz") tu BYLA
        // a je pryč: od návrhu C nad pruhem stojí nadpis sekce „PROFIL NASTAVENÍ",
        // takže to byly dvě verzálkové hlavičky nad sebou. Co profily dělají, říká
        // úvod záložky a řádek #ag-prof-note pod dlaždicemi.
        // Taky pryč: vlastní SVG chevron v <summary>. Rozbalovátka v Nastavení mají
        // svou šipku z css/style.css (details summary::after), takže tu byly DVĚ.
        bar.innerHTML = '<div id="ag-prof-row" role="group" aria-label="Profil nastavení"></div>'
            + '<p id="ag-prof-note"></p>'
            + '<details id="ag-prof-det">'
            + '<summary>Co profily mění a v čem se liší</summary>'
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
            // „Vlastní" = PRŮVODCE (ptá se běžnou řečí a nastaví to za tebe).
            // Otisk současného nastavení zůstává jako druhá cesta — nabízí se
            // v #ag-prof-note, když už nějaký profil běží nebo si člověk doladil své.
            if (ev.target.closest('button[data-new]')) { wizOpen(); return; }
            var b = ev.target.closest('button[data-prof]');
            if (!b) return;
            var id = b.getAttribute('data-prof');
            if (id === ls(LAST_KEY)) clearProfile(); else apply(id);
        });
        bar.querySelector('#ag-prof-note').addEventListener('click', function (ev) {
            if (!ev.target.closest) return;
            var d = ev.target.closest('button[data-del]');
            if (d) { deleteCustom(d.getAttribute('data-del')); return; }
            if (ev.target.closest('button[data-snap]')) saveCustom();
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
            row.removeAttribute('data-last');   // vynuť dorovnání zvýraznění níž
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
                + 'Dlaždice <b>Vlastní</b> tě provede pár otázkami a nastaví to za tebe. '
                + '<button type="button" data-snap>Nebo ulož, jak to mám teď</button>';
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
        try { if (typeof userHeadingOffset !== 'undefined' && isFinite(userHeadingOffset)) return +userHeadingOffset; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:headingOffset'); }
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
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:collectDevice'); }
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
            setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:exportDevice'); } }, 4000);
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
                } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:nahrajProfil'); }
                try { if (typeof applyVisualSettings === 'function') applyVisualSettings(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:nahrajProfil'); }
            }
            // korekce severu: jen přes oficiální páku appky, ať se přepočítá i AR
            try {
                if (typeof d.headingOffset === 'number' && typeof resetHeadingOffset === 'function'
                    && typeof nudgeHeadingOffset === 'function') {
                    resetHeadingOffset();
                    if (d.headingOffset) nudgeHeadingOffset(d.headingOffset);
                }
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:nahrajProfil'); }
            if (d.calibProfiles && d.calibProfiles.length) {
                try { lsSet('agCalibProfiles', JSON.stringify(d.calibProfiles)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:nahrajProfil'); }
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
        try { renderBar(); renderDevice(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'profily:tick'); }
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
