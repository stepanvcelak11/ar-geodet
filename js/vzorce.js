// ===== QTRIG — VZORCE (ODPOJITELNÁ vrstva, Příručka) ==========================
// Neinvazivní. NEEDITUJE logika.js ani grafika.js — jen otevírá vlastní modal
// a u vzorců, které appka umí spočítat, odkazuje do Kalkulačky (openCalcModal /
// showCalcTool z js/kalkulacka.js) nebo na nástroj.
//
// PROČ (hodnocení pro studenty, 13. 9. 2026): Příručka měla 43 pojmů a ani jeden
// vzorec. Student u zkoušky ani na cvičení nepotřebuje definici „směrník", potřebuje
// σ = arctg(ΔY/ΔX) s pravidlem pro kvadrant. Tady je tahák: základní vzorce
// souřadnicových výpočtů, výšek, délek, vyrovnání a přesnosti — každý s významem
// symbolů a s tím, kde v appce se to počítá. Číselné meze (mezní odchylky) tu
// NEJSOU: ty jsou s odkazem na předpis v Příručce → Předpisy a odchylky, aby
// existovaly jen na jednom místě.
//
// Zápis: čisté HTML se <sub>/<sup>, žádná knihovna na sazbu (offline, 0 kB navíc).
// Odstranění: smaž js/vzorce.js + řádek <script> v index.html, záznam 'vzorce'
// v js/tools-registry.js, text v data/navody.json a 'vzorce' z rozcestníku
// Příručka v js/tools-hub.js; přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGVzorce) return;

    var ID = 'ag-vz-modal', STYLE_ID = 'ag-vz-style';
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 4h16"/><path d="M8 4l4 8-4 8"/><path d="M8 20h12"/><path d="M15 12h5"/></svg>';
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }

    // ---- data ----------------------------------------------------------------------------------
    // s = sekce; v = [{n: název, f: vzorec (HTML), s: symboly, calc: id v Kalkulačce | tool: id nástroje}]
    var SEKCE = [
        { s: 'Souřadnicové výpočty', v: [
            { n: 'Směrník a délka ze souřadnic', f: 'σ<sub>AB</sub> = arctg (ΔY / ΔX) → podle kvadrantu · s<sub>AB</sub> = √(ΔY² + ΔX²)',
              s: 'ΔY = Y<sub>B</sub> − Y<sub>A</sub>, ΔX = X<sub>B</sub> − X<sub>A</sub>. Kvadrant: I (+,+) σ = φ · II (+,−) σ = 200 − φ · III (−,−) σ = 200 + φ · IV (−,+) σ = 400 − φ, kde φ = arctg(|ΔY|/|ΔX|).', calc: 'smer' },
            { n: 'Polární metoda (rajón)', f: 'Y<sub>P</sub> = Y<sub>S</sub> + s · sin σ<sub>SP</sub> · X<sub>P</sub> = X<sub>S</sub> + s · cos σ<sub>SP</sub>',
              s: 'σ<sub>SP</sub> = o + ψ<sub>P</sub>, kde orientační posun o = σ<sub>SO</sub> − ψ<sub>O</sub> (ψ = čtení na kruhu). S stanovisko, O orientace.', calc: 'rajon' },
            { n: 'Ortogonální metoda', f: 'Y<sub>P</sub> = Y<sub>A</sub> + s · sin σ<sub>AB</sub> + k · sin (σ<sub>AB</sub> + 100) · X<sub>P</sub> = X<sub>A</sub> + s · cos σ<sub>AB</sub> + k · cos (σ<sub>AB</sub> + 100)',
              s: 's staničení po měřické přímce AB, k kolmice (vpravo +, vlevo −).', calc: 'orto' },
            { n: 'Protínání vpřed z úhlů', f: 's<sub>AP</sub> = s<sub>AB</sub> · sin β / sin γ · γ = 200 − α − β',
              s: 'α, β úhly na stanoviscích A, B mezi základnou a záměrou na P; γ úhel protnutí (nejlépe 33–167 gon). Pak polárně z A po σ<sub>AB</sub> + α.', calc: 'protuhel' },
            { n: 'Protínání z délek', f: 'a = (s<sub>A</sub>² − s<sub>B</sub>² + c²) / 2c · h = √(s<sub>A</sub>² − a²)',
              s: 'c = s<sub>AB</sub> základna, a pata kolmice od A, h kolmice (vlevo/vpravo podle zadání). P polárně: a po σ<sub>AB</sub>, pak h po σ<sub>AB</sub> ± 100.', calc: 'protdelka' },
            { n: 'Zpětné protínání / volné stanovisko', f: 'min Σ v² přes rotaci θ a posun (t<sub>Y</sub>, t<sub>X</sub>)',
              s: 'Ze 2+ známých bodů se směry a délkami; vyrovnání MNČ dá stanovisko + orientační posun, se 3+ body i m<sub>0</sub>.', calc: 'volne' },
            { n: 'Helmertova (podobnostní) transformace', f: 'Y = q (y cos θ − x sin θ) + t<sub>Y</sub> · X = q (y sin θ + x cos θ) + t<sub>X</sub>',
              s: 'q měřítko, θ rotace, t posun; ze 2+ identických bodů MNČ, 3+ dají opravy a m<sub>0</sub>.', calc: 'helmert' }
        ] },
        { s: 'Polygonový pořad', v: [
            { n: 'Úhlový uzávěr', f: 'O<sub>ω</sub> = σ<sub>konc</sub> − σ<sub>poč</sub> − Σω + n · 200',
              s: 'n počet vrcholových úhlů ω (levostranné); oprava každého úhlu = O<sub>ω</sub> / n (znaménko tak, aby uzávěr zmizel).', calc: 'polygon' },
            { n: 'Souřadnicové uzávěry a opravy', f: 'O<sub>Y</sub> = Y<sub>K</sub> − Y<sub>P</sub> − ΣΔY · O<sub>X</sub> = X<sub>K</sub> − X<sub>P</sub> − ΣΔX · v<sub>Y,i</sub> = O<sub>Y</sub> · s<sub>i</sub> / Σs',
              s: 'ΔY = s · sin σ, ΔX = s · cos σ z opravených směrníků; opravy úměrně délkám stran. Polohový uzávěr O<sub>p</sub> = √(O<sub>Y</sub>² + O<sub>X</sub>²), relativně 1 : Σs/O<sub>p</sub>.', calc: 'polygon' }
        ] },
        { s: 'Výšky', v: [
            { n: 'Geometrická nivelace', f: 'h<sub>AB</sub> = Σ zpět − Σ vpřed · H<sub>B</sub> = H<sub>A</sub> + h<sub>AB</sub>',
              s: 'Uzávěr O<sub>h</sub> = H<sub>B,daná</sub> − H<sub>B,měřená</sub>, rozdělí se rovným dílem na sestavy (nebo úměrně délkám).', calc: 'nivel' },
            { n: 'Trigonometrické převýšení', f: 'h = s<sub>v</sub> · cotg z + v<sub>p</sub> − v<sub>c</sub> + (1 − k) · s<sub>v</sub>² / 2R',
              s: 's<sub>v</sub> vodorovná délka, z zenitový úhel, v<sub>p</sub> výška přístroje, v<sub>c</sub> výška cíle; poslední člen = zakřivení Země a refrakce (k ≈ 0,13, R = 6 381 km), na 100 m ≈ +0,7 mm, na 1 km ≈ +68 mm.', tool: 'korekce' },
            { n: 'Ze šikmé délky', f: 's<sub>v</sub> = s<sub>š</sub> · sin z · h = s<sub>š</sub> · cos z',
              s: 's<sub>š</sub> šikmá délka, z zenitový úhel (100 gon = vodorovně).', calc: 'tachy' }
        ] },
        { s: 'Délky', v: [
            { n: 'Pásmo — teplota a komparace', f: 'Δs<sub>t</sub> = α · (t − t<sub>0</sub>) · s · Δs<sub>k</sub> = (l<sub>skut</sub> − l<sub>nom</sub>) · s / l<sub>nom</sub>',
              s: 'α = 11,5·10<sup>−6</sup> /°C pro ocel, t<sub>0</sub> = 20 °C. Průvěs: Δs<sub>p</sub> = − m² g² l³ / (24 F²) (m hmotnost na metr, F napínací síla).', tool: 'korekce' },
            { n: 'Redukce na horizont a z výšky', f: 's<sub>v</sub> = s<sub>š</sub> · sin z · s<sub>0</sub> = s<sub>v</sub> · (1 − H / R)',
              s: 'H nadmořská výška, R = 6 381 km. Na 1 km délky ve výšce 500 m: −78 mm.', calc: 'redukce' },
            { n: 'Zkreslení Křovákova zobrazení', f: 's<sub>JTSK</sub> = s<sub>0</sub> · m · m ∈ ⟨0,9999 ; 1,0014⟩',
              s: '−10 cm/km na základní rovnoběžce až +14 cm/km na okraji území. Pořadí: nejdřív z výšky, pak zobrazení.', calc: 'redukce' },
            { n: 'Atmosférická oprava dálkoměru', f: 'Δs = (N<sub>0</sub> − N) · 10<sup>−6</sup> · s',
              s: 'N grupový index lomu z teploty, tlaku a vlhkosti (Barrell–Sears); zadává se do totálky v ppm.', tool: 'korekce' }
        ] },
        { s: 'Přesnost a vyrovnání', v: [
            { n: 'Aritmetický průměr a jeho střední chyba', f: 'x̄ = Σx / n · m = √(Σv² / (n − 1)) · m<sub>x̄</sub> = m / √n',
              s: 'v = x<sub>i</sub> − x̄ opravy; m střední chyba jednoho měření, m<sub>x̄</sub> střední chyba průměru. Průměrování GPS v appce ukazuje právě m<sub>x̄</sub>.', tool: 'brutal-gps' },
            { n: 'Zákon hromadění středních chyb', f: 'm<sub>f</sub>² = (∂f/∂x<sub>1</sub>)² m<sub>1</sub>² + (∂f/∂x<sub>2</sub>)² m<sub>2</sub>² + …',
              s: 'Pro součet/rozdíl m = √(m<sub>1</sub>² + m<sub>2</sub>²). V AR: σ<sub>bod</sub> = √(σ<sub>GPS</sub>² + (d · sin σ<sub>kompas</sub>)²) — viz „Proč ±4 m?".', tool: 'chybovy-rozpocet' },
            { n: 'Střední chyba jednotková a mezní odchylka', f: 'm<sub>0</sub> = √(Σ p v² / (n − k)) · Δ<sub>mez</sub> = 2 · m (95 %) · 2,5 · m (99 %)',
              s: 'n měření, k neznámých, p váhy. Mezní odchylky pro katastr (m<sub>xy</sub> = 0,14 m pro kód 3) a nivelaci: Příručka → Předpisy.', tool: 'predpisy' },
            { n: 'Mezní odchylka technické nivelace', f: 'Δ<sub>h</sub> = 40 · √R [mm]',
              s: 'R délka pořadu v km (podle metodiky ČÚZK pro TN; přesná nivelace má jiné konstanty — viz Předpisy).', tool: 'predpisy' }
        ] },
        { s: 'Úhly a převody', v: [
            { n: 'Gony, stupně, radiány', f: '400 gon = 360° = 2π · 1 gon = 0,9° · 1 gon = 100 c = 10 000 cc · 1° = 60′ = 3600″',
              s: 'ρ<sup>cc</sup> = 636 620 (převod radiánů na cc: úhel<sub>cc</sub> = úhel<sub>rad</sub> · ρ<sup>cc</sup>).', calc: 'sci' },
            { n: 'Malý úhel a příčná chyba', f: 'q = s · ε / ρ',
              s: 'Chyba směru ε (v cc) na délce s udělá příčnou chybu q; ρ<sup>cc</sup> = 636 620. Na 100 m dělá 10 cc jen 1,6 mm — kompas telefonu (±3° = ±33 000 cc) 5,2 m.', tool: 'chybovy-rozpocet' },
            { n: 'Magnetická deklinace', f: 'A<sub>geo</sub> = A<sub>mag</sub> + D',
              s: 'D deklinace (v ČR 2026 ≈ +5° východní, roste ~0,15°/rok). Appka ji započítává sama, kompas ukazuje zeměpisný sever.', tool: 'kompas' }
        ] }
    ];

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style'); st.id = STYLE_ID;
        st.textContent = [
            '#' + ID + ' .vz-h{font-size:calc(11.5px * var(--ag-font-scale,1));font-weight:700;text-transform:uppercase;letter-spacing:.04em;opacity:.55;margin:16px 0 4px;}',
            '#' + ID + ' .vz-i{padding:10px 0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,.08));}',
            '#' + ID + ' .vz-n{font-weight:700;font-size:calc(14px * var(--ag-font-scale,1));}',
            '#' + ID + ' .vz-f{font-family:var(--font-mono,ui-monospace,monospace);font-size:calc(13.5px * var(--ag-font-scale,1));color:var(--accent,#2f9e74);margin:4px 0;line-height:1.6;word-break:break-word;}',
            '#' + ID + ' .vz-s{font-size:calc(12.5px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);line-height:1.45;}',
            '#' + ID + ' .vz-go{display:inline-block;margin-top:4px;font-size:calc(12px * var(--ag-font-scale,1));color:var(--accent,#2f9e74);text-decoration:underline;cursor:pointer;background:none;border:0;padding:0;}',
            '#' + ID + ' .vz-srch{width:100%;box-sizing:border-box;margin-bottom:4px;}'
        ].join('\n');
        document.head.appendChild(st);
    }
    function html(filtr) {
        var q = (filtr || '').trim().toLowerCase();
        var out = '';
        SEKCE.forEach(function (sec) {
            var items = sec.v.filter(function (v) { return !q || (v.n + ' ' + v.f + ' ' + v.s).toLowerCase().replace(/<[^>]+>/g, '').indexOf(q) >= 0; });
            if (!items.length) return;
            out += '<div class="vz-h">' + t(sec.s) + '</div>';
            items.forEach(function (v) {
                var go = '';
                if (v.calc) go = '<button type="button" class="vz-go" data-calc="' + v.calc + '">' + t('Spočítat v Kalkulačce') + ' ›</button>';
                else if (v.tool) go = '<button type="button" class="vz-go" data-tool="' + v.tool + '">' + t('Otevřít nástroj') + ' ›</button>';
                out += '<div class="vz-i"><div class="vz-n">' + t(v.n) + '</div><div class="vz-f">' + v.f + '</div><div class="vz-s">' + v.s + '</div>' + go + '</div>';
            });
        });
        return out || '<p style="opacity:.7;">' + t('Nic nenalezeno.') + '</p>';
    }
    function build() {
        var m = document.getElementById(ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = ID;
        m.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;display:flex;align-items:center;gap:8px;"><span style="width:22px;height:22px;display:inline-block;">' + ICON + '</span> ' + t('Vzorce') + '</h3>'
            + '<input type="search" class="vz-srch" id="ag-vz-q" placeholder="' + t('Hledat vzorec…') + '" autocomplete="off">'
            + '<div class="modal-body" id="ag-vz-body"></div>'
            + '<button type="button" class="btn btn-secondary" id="ag-vz-close" style="margin-top:14px;">' + t('Zavřít') + '</button>'
            + '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-vz-close').addEventListener('click', close);
        m.querySelector('#ag-vz-q').addEventListener('input', function () { document.getElementById('ag-vz-body').innerHTML = html(this.value); });
        m.addEventListener('click', function (e) {
            var b = e.target.closest('button[data-calc],button[data-tool]'); if (!b) return;
            var c = b.getAttribute('data-calc'), tl = b.getAttribute('data-tool');
            close();
            try {
                if (c && typeof window.openCalcModal === 'function') { window.openCalcModal(); window.showCalcTool(c); }
                else if (tl) otevriNastroj(tl);
            } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'vzorce:go'); }
        });
        return m;
    }
    // Nástroj se otevírá jako z mřížky: přes dlaždici (funguje i pro odložené moduly
    // a pro Pro zámky), záložně přes registr.
    function otevriNastroj(id) {
        var tile = document.querySelector('.tool-tile[data-tool="' + id + '"]');
        if (tile) { tile.click(); return; }
        if (id === 'kompas') { var az = document.getElementById('compass-debug'); if (az) { az.click(); return; } }
        if (window.AGLazyTools && AGLazyTools.open && AGLazyTools.open(id)) return;
        var r = window.AGReg && AGReg.get && AGReg.get(id);
        if (r && r.fn && typeof window[r.fn] === 'function') window[r.fn]();
    }
    function open() { var m = build(); m.style.display = 'flex'; var q = document.getElementById('ag-vz-q'); if (q) q.value = ''; document.getElementById('ag-vz-body').innerHTML = html(''); }
    function close() { var m = document.getElementById(ID); if (m) m.style.display = 'none'; }

    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'vzorce', label: t('Vzorce'), icon: ICON, cat: 'Pomůcky', onClick: open, order: 3 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });

    window.agOpenVzorce = open;
    window.AGVzorce = { open: open, close: close, sekce: SEKCE };
})();
