// ===== QTRIG — POZNÁVAČKA: STABILIZACE A ZNAČKY (ODPOJITELNÁ vrstva) ==========
// Neinvazivní. NEEDITUJE logika.js ani grafika.js — vlastní modal, vlastní data,
// odkaz do Slovníku (openDictModal z grafika.js) a na Bodové pole.
//
// PROČ (hodnocení pro studenty, 13. 9. 2026): student z prvního ročníku často
// nikdy neviděl trigonometrický bod, natož nivelační čep ve zdi. Přitom je pozná
// v terénu dřív, než umí spočítat rajón — a když stojí u kamene s křížkem, měl by
// vědět, jestli je to TB, mezník, nebo zajišťovací bod, protože každý znamená něco
// jiného pro to, co s ním smí a nesmí dělat. Kvíz: náčrt + popis → čtyři možnosti,
// po odpovědi vysvětlení, k čemu bod slouží, jak ho poznat a s čím se plete.
//
// Náčrty jsou VLASTNÍ SVG (ne fotky): appka je offline a bez cizích práv, a schéma
// ukáže, na co se dívat (křížek, čep, ochranné kameny), líp než fotka z jednoho
// úhlu. Kdo chce skutečnou podobu, má u každé značky odkaz do Bodového pole —
// nejbližší bod má v geodetických údajích ČÚZK místopis i fotku.
//
// CO SE UKLÁDÁ: jen nejlepší skóre (agPoznavacka_v1). Odstranění: smaž
// js/poznavacka.js + řádek <script> v index.html, záznam 'poznavacka'
// v js/tools-registry.js a text v data/navody.json; přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGPoznavacka) return;

    var ID = 'ag-pz-modal', STYLE_ID = 'ag-pz-style', LS = 'agPoznavacka_v1';
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M9 21h6"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/><path d="M12 8v3M10.5 9.5h3"/></svg>';
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'poznavacka:' + kde); } catch (x) { } }

    // ---- kresby (pohled z boku / shora; barvy z motivu) -------------------------------------------
    var S = 'stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"';
    function svg(inner) { return '<svg viewBox="0 0 160 110" class="pz-svg" aria-hidden="true">' + inner + '</svg>'; }
    var KAMEN_KRIZ = svg('<path d="M10 90h140" ' + S + ' stroke-dasharray="3 3"/><path d="M62 90V48h36v42" ' + S + '/><rect x="60" y="40" width="40" height="9" ' + S + '/><path d="M74 44.5h12M80 41v7" ' + S + '/>'
        + '<rect x="24" y="80" width="14" height="10" ' + S + '/><rect x="122" y="80" width="14" height="10" ' + S + '/><text x="80" y="104" font-size="9" text-anchor="middle" fill="currentColor" opacity=".7">žulový hranol, křížek, ochranné kameny</text>');
    var KAMEN_MALY = svg('<path d="M10 90h140" ' + S + ' stroke-dasharray="3 3"/><path d="M68 90V58h24v32" ' + S + '/><rect x="66" y="52" width="28" height="7" ' + S + '/><path d="M76 55.5h8M80 53v5" ' + S + '/><path d="M40 90V70" ' + S + ' stroke-dasharray="2 2"/><text x="80" y="104" font-size="9" text-anchor="middle" fill="currentColor" opacity=".7">menší kámen s křížkem, bez ochrany, u TB</text>');
    var CEP_VE_ZDI = svg('<path d="M20 10v90M20 10h120v90" ' + S + '/><path d="M20 30h120M20 50h120M20 70h120M60 10v20M100 30v20M60 50v20M100 70v20" ' + S + ' opacity=".35"/><ellipse cx="80" cy="52" rx="14" ry="9" ' + S + '/><path d="M80 52m-10 0a10 4 0 0 0 20 0" ' + S + '/><path d="M80 61v14" ' + S + '/><text x="80" y="104" font-size="9" text-anchor="middle" fill="currentColor" opacity=".7">litinový čep ve zdi budovy, ~1 m nad zemí</text>');
    var KAMEN_CEP = svg('<path d="M10 90h140" ' + S + ' stroke-dasharray="3 3"/><path d="M62 90V50h36v40" ' + S + '/><rect x="60" y="44" width="40" height="7" ' + S + '/><path d="M80 44a5 4 0 0 1 0-8a5 4 0 0 1 0 8z" ' + S + '/><text x="80" y="104" font-size="9" text-anchor="middle" fill="currentColor" opacity=".7">kámen s polokulovým čepem nahoře</text>');
    var HREB = svg('<path d="M10 70h140" ' + S + '/><path d="M10 70l0 20h140v-20" ' + S + ' opacity=".4"/><circle cx="80" cy="66" r="9" ' + S + '/><path d="M76 66h8M80 62v8" ' + S + '/><path d="M80 75v22" ' + S + ' stroke-width="3"/><text x="80" y="104" font-size="9" text-anchor="middle" fill="currentColor" opacity=".7">kovový hřeb s hlavou v asfaltu / betonu</text>');
    var MEZNIK = svg('<path d="M10 90h140" ' + S + ' stroke-dasharray="3 3"/><path d="M66 90V40h28v50" ' + S + '/><path d="M64 36h32l-2 6H66z" ' + S + '/><path d="M76 39h8M80 36v6" ' + S + ' stroke-width="1.2"/><path d="M30 90V60M130 90V60" ' + S + ' stroke-dasharray="2 2"/><text x="80" y="104" font-size="9" text-anchor="middle" fill="currentColor" opacity=".7">plastový/kamenný hranol na hranici, bez čísla</text>');
    var TRUBKA = svg('<path d="M10 90h140" ' + S + ' stroke-dasharray="3 3"/><path d="M76 90V44h8v46" ' + S + '/><path d="M70 40h20v6H70z" ' + S + '/><path d="M80 38v2" ' + S + '/><text x="80" y="104" font-size="9" text-anchor="middle" fill="currentColor" opacity=".7">ocelová trubka / roxor s plastovou hlavou</text>');
    var KOLIK = svg('<path d="M10 90h140" ' + S + ' stroke-dasharray="3 3"/><path d="M74 90L76 34h8l2 56" ' + S + '/><path d="M74 34h12" ' + S + '/><path d="M80 34v-6" ' + S + ' stroke-width="2.4"/><path d="M84 42l10-3" ' + S + ' opacity=".6"/><text x="80" y="104" font-size="9" text-anchor="middle" fill="currentColor" opacity=".7">dřevěný kolík s hřebíkem, barevná značka</text>');
    var ROH = svg('<path d="M20 90V30l50-14 70 20v54" ' + S + '/><path d="M70 16v74M20 30l50 6" ' + S + '/><path d="M70 36l70 0" ' + S + ' opacity=".4"/><circle cx="70" cy="90" r="5" ' + S + '/><text x="80" y="104" font-size="9" text-anchor="middle" fill="currentColor" opacity=".7">roh stavby při terénu</text>');
    var VEZ = svg('<path d="M10 90h140" ' + S + ' stroke-dasharray="3 3"/><path d="M60 90L72 30h16l12 60" ' + S + '/><path d="M66 60h28M63 75h34" ' + S + '/><path d="M80 30V14M74 20h12" ' + S + '/><text x="80" y="104" font-size="9" text-anchor="middle" fill="currentColor" opacity=".7">věž / kostelní věž / stožár — signál na dálku</text>');

    // ---- otázky ---------------------------------------------------------------------------------------
    // n = správná odpověď (název), kres = SVG, popis = co vidíš, vys = vysvětlení po odpovědi,
    // plete = s čím se plete, dict = heslo ve Slovníku
    var Q = [
        { n: 'Trigonometrický bod (TB)', kres: KAMEN_KRIZ, popis: 'Žulový hranol asi 20 × 20 cm s vytesaným křížkem na horní ploše. Kolem něj čtyři malé kameny (ochranné) nebo betonová skruž, na kopci často s vysokou tyčí nebo věží nedaleko.',
          vys: 'Bod základního polohového bodového pole (1.–4. řád). Křížek = poloha, číslo a údaje najdeš v geodetických údajích ČÚZK. Ochranné kameny jsou tam proto, že TB se nesmí poškodit ani použít jinak než k měření.', plete: 'se zajišťovacím bodem (menší, bez ochrany) a s mezníkem (bez křížku uprostřed hlavy a bez čísla).', dict: 'TB' },
        { n: 'Zajišťovací bod TB', kres: KAMEN_MALY, popis: 'Menší kámen s křížkem pár desítek metrů od velkého kamene s ochranou. Žádné ochranné kameny, v místopisu jako „ZB“.',
          vys: 'Zajišťovací body slouží k obnovení TB, kdyby byl zničen: jsou od něj v přesně známé vzdálenosti a směru. Měřit se z nich dá, ale nejsou to samostatné body sítě.', plete: 's trigonometrickým bodem — rozhoduje velikost a ochranné kameny.', dict: 'TB' },
        { n: 'Nivelační značka čepová', kres: CEP_VE_ZDI, popis: 'Litinová polokulová hlava zapuštěná ve zdi budovy (kostel, škola, most), obvykle 0,5–1,5 m nad zemí, někdy s nápisem „Nivelační značka“ nebo „Výškový bod“.',
          vys: 'Bod České státní nivelační sítě. Výška se vztahuje k vrcholu čepu — lať se staví na něj, ne pod něj. Výšky jsou v Bpv (Balt po vyrovnání).', plete: 's kotvou nebo hmoždinkou ve zdi; pravá značka je litá, s hladkým polokulovým vrcholem a bývá v místopisu.', dict: 'Nivelační bod' },
        { n: 'Nivelační kámen', kres: KAMEN_CEP, popis: 'Kamenný hranol v zemi, na horní ploše místo křížku vystouplý kovový polokulový čep.',
          vys: 'Výškový bod stabilizovaný kamenem (kde není vhodná stavba). Čep nahoře = místo, kam se staví lať. Křížek by byl polohový bod; čep je výškový.', plete: 's TB (křížek vs. čep) a s mezníkem.', dict: 'Nivelační bod' },
        { n: 'Geodetický hřeb (hřebová značka)', kres: HREB, popis: 'Kovový hřeb s kulatou hlavou zapuštěný do asfaltu, betonu nebo obrubníku, na hlavě křížek nebo nápis „Geodetický bod“.',
          vys: 'Běžná stabilizace podrobných bodů polohového pole (PBPP) a zhušťovacích bodů ve městě, kde není kam dát kámen. Pozor: hřeby v obrubnících bývají i od jiných firem — rozhoduje evidence v ČÚZK.', plete: 's hřebem z vytyčení stavby (dočasný, bez evidence) a s krytem inženýrských sítí.', dict: 'Hřebová značka' },
        { n: 'Mezník (hraniční znak)', kres: MEZNIK, popis: 'Plastový nebo kamenný hranol na hranici pozemku, hlava často se šipkami nebo křížkem, bez čísla bodu. Stojí v řadě s dalšími na lomových bodech hranice.',
          vys: 'Označuje lomový bod hranice pozemku (katastr). Není to bod bodového pole — nemá souřadnice v databázi bodových polí, ale v katastrální mapě (jako podrobný bod se souřadnicemi). Posunout ho je zásah do hranice.', plete: 's TB (mezník nemá ochranné kameny ani číslo) a s kolíkem z vytyčení.', dict: 'Mezník' },
        { n: 'Trubka / roxor s plastovou hlavou', kres: TRUBKA, popis: 'Ocelová trubka nebo betonářská ocel zaražená do země, nahoře plastová hlavice (často oranžová nebo žlutá).',
          vys: 'Dočasná až polotrvalá stabilizace: pomocné měřické body, body pro stavbu, někdy i PBPP v poli. Číslo bývá na hlavici nebo v náčrtu firmy, ne v ČÚZK.', plete: 's mezníkem (ten má tvar hranolu a stojí na hranici).', dict: 'Stabilizace' },
        { n: 'Dřevěný kolík s hřebíkem', kres: KOLIK, popis: 'Dřevěný kolík zatlučený do země, v hlavě hřebík, hlava obarvená sprejem, vedle často „svědek“ (druhý kolík s číslem).',
          vys: 'Dočasná stabilizace při vytyčování: hřebík = poloha bodu, kolík = aby byl vidět. Po stavbě zmizí. Do bodového pole nepatří.', plete: 's ničím trvalým — a to je celý smysl.', dict: 'Vytyčení' },
        { n: 'Roh budovy jako podrobný bod', kres: ROH, popis: 'Žádná značka. Roh zděné stavby při terénu, v náčrtu označený jako bod se souřadnicemi.',
          vys: 'V katastru a v podrobném měření se rohy trvalých staveb používají jako identické body — mají souřadnice, ale žádnou stabilizaci: budova sama je stabilizace.', plete: 's ničím; jen pozor, KTERÝ roh (omítka vs. zdivo, sokl vs. stěna).', dict: 'PBPP' },
        { n: 'Signál TB (věž, stožár)', kres: VEZ, popis: 'Vysoký objekt viditelný zdaleka — kostelní věž, vodojem, stožár. V geodetických údajích je uvedený jako „TB — věž“ s tím, na co se cílí (makovice, hrot).',
          vys: 'Řada trigonometrických bodů je stabilizována přímo na věži: cílí se na hrot nebo makovici, na zem se nechodí. Souřadnice patří tomu bodu na věži, ne patě stavby.', plete: 's pozemním TB u paty věže — často existují oba a mají různá čísla.', dict: 'TB' }
    ];
    var VSECHNA = Q.map(function (q) { return q.n; });

    // ---- stav kvízu ------------------------------------------------------------------------------------
    var _por = [], _i = 0, _skore = 0, _odpovezeno = false;
    function best() { try { return +localStorage.getItem(LS) || 0; } catch (e) { return 0; } }
    function ulozBest(n) { try { if (n > best()) localStorage.setItem(LS, String(n)); } catch (e) { swallow(e, 'ls'); } }
    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
    function moznosti(q) {
        var jine = shuffle(VSECHNA.filter(function (n) { return n !== q.n; })).slice(0, 3);
        return shuffle(jine.concat([q.n]));
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style'); st.id = STYLE_ID;
        st.textContent = [
            '#' + ID + ' .pz-svg{width:100%;max-width:300px;display:block;margin:4px auto 8px;color:var(--text-color,#eceef2);}',
            '#' + ID + ' .pz-top{display:flex;justify-content:space-between;font-size:calc(12.5px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);margin-bottom:4px;}',
            '#' + ID + ' .pz-popis{font-size:calc(14px * var(--ag-font-scale,1));line-height:1.5;margin:0 0 10px;}',
            '#' + ID + ' .pz-opt{display:block;width:100%;box-sizing:border-box;text-align:left;margin:6px 0;padding:11px 12px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,.14));background:rgba(255,255,255,.04);color:inherit;font:inherit;font-size:calc(14px * var(--ag-font-scale,1));cursor:pointer;}',
            '#' + ID + ' .pz-opt.ok{border-color:var(--accent,#2f9e74);background:rgba(47,158,116,.18);}',
            '#' + ID + ' .pz-opt.bad{border-color:var(--danger,#fb7185);background:rgba(251,113,133,.16);}',
            '#' + ID + ' .pz-opt[disabled]{cursor:default;opacity:.85;}',
            '#' + ID + ' .pz-vys{margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.05);font-size:calc(13px * var(--ag-font-scale,1));line-height:1.5;}',
            '#' + ID + ' .pz-vys b{display:block;margin-bottom:2px;}',
            '#' + ID + ' .pz-btns{display:flex;gap:8px;margin-top:12px;}',
            '#' + ID + ' .pz-btns .btn{flex:1;margin:0;}',
            '#' + ID + ' .pz-go{font-size:calc(12px * var(--ag-font-scale,1));color:var(--accent,#2f9e74);text-decoration:underline;cursor:pointer;background:none;border:0;padding:0;margin-top:6px;}'
        ].join('\n');
        document.head.appendChild(st);
    }
    function build() {
        var m = document.getElementById(ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = ID;
        m.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;display:flex;align-items:center;gap:8px;"><span style="width:22px;height:22px;display:inline-block;">' + ICON + '</span> ' + t('Poznávačka: co je to za bod?') + '</h3>'
            + '<div class="modal-body" id="ag-pz-body"></div>'
            + '<div class="pz-btns"><button type="button" class="btn btn-primary" id="ag-pz-next">' + t('Další') + '</button><button type="button" class="btn btn-secondary" id="ag-pz-close">' + t('Zavřít') + '</button></div>'
            + '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-pz-close').addEventListener('click', close);
        m.querySelector('#ag-pz-next').addEventListener('click', dalsi);
        m.addEventListener('click', function (e) {
            var o = e.target.closest('button.pz-opt'); if (o && !_odpovezeno) { odpoved(o.getAttribute('data-n')); return; }
            var d = e.target.closest('button[data-dict]'); if (d) { close(); try { if (typeof window.openDictModal === 'function') { window.openDictModal(); var q = document.getElementById('dict-search'); if (q) { q.value = d.getAttribute('data-dict'); q.dispatchEvent(new Event('input')); } } } catch (err) { swallow(err, 'dict'); } return; }
            var b = e.target.closest('button[data-bp]'); if (b) { close(); try { var tile = document.querySelector('.tool-tile[data-tool="bodove-pole"]'); if (tile) tile.click(); else if (window.AGLazyTools && AGLazyTools.open) AGLazyTools.open('bodove-pole'); } catch (err) { swallow(err, 'bp'); } }
        });
        return m;
    }
    function start() { _por = shuffle(Q.slice()); _i = 0; _skore = 0; _odpovezeno = false; render(); }
    function render() {
        var body = document.getElementById('ag-pz-body'), next = document.getElementById('ag-pz-next'); if (!body) return;
        if (_i >= _por.length) {
            ulozBest(_skore);
            body.innerHTML = '<div class="pz-vys" style="text-align:center;"><b style="font-size:calc(22px * var(--ag-font-scale,1));">' + _skore + ' / ' + _por.length + '</b>'
                + (_skore === _por.length ? t('Všechno správně. V terénu už tě nic nepřekvapí.') : (_skore >= _por.length * 0.7 ? t('Slušné. Zkus to znovu, pořadí se míchá.') : t('Projdi si vysvětlení a zkus to znovu — pořadí i možnosti se míchají.')))
                + '<br><small>' + t('nejlepší výsledek') + ': ' + best() + ' / ' + Q.length + '</small></div>';
            next.textContent = t('Znovu');
            return;
        }
        var q = _por[_i];
        next.textContent = t('Další'); next.disabled = true;
        body.innerHTML = '<div class="pz-top"><span>' + (_i + 1) + ' / ' + _por.length + '</span><span>' + t('správně') + ': ' + _skore + '</span></div>'
            + q.kres + '<p class="pz-popis">' + t(q.popis) + '</p>'
            + moznosti(q).map(function (n) { return '<button type="button" class="pz-opt" data-n="' + n.replace(/"/g, '&quot;') + '">' + t(n) + '</button>'; }).join('')
            + '<div id="ag-pz-vys"></div>';
    }
    function odpoved(n) {
        var q = _por[_i]; _odpovezeno = true;
        var ok = n === q.n; if (ok) _skore++;
        document.querySelectorAll('#' + ID + ' .pz-opt').forEach(function (b) {
            b.disabled = true;
            if (b.getAttribute('data-n') === q.n) b.classList.add('ok');
            else if (b.getAttribute('data-n') === n && !ok) b.classList.add('bad');
        });
        var v = document.getElementById('ag-pz-vys');
        v.innerHTML = '<div class="pz-vys"><b>' + (ok ? t('Správně.') : t('Ne — je to') + ' ' + t(q.n) + '.') + '</b>' + t(q.vys) + '<br><i>' + t('Plete se') + ' ' + t(q.plete) + '</i><br>'
            + '<button type="button" class="pz-go" data-dict="' + q.dict + '">' + t('Slovník') + ': ' + q.dict + ' ›</button> &nbsp; <button type="button" class="pz-go" data-bp="1">' + t('Nejbližší skutečný bod') + ' ›</button></div>';
        document.getElementById('ag-pz-next').disabled = false;
        var t2 = document.querySelector('#' + ID + ' .pz-top span:last-child'); if (t2) t2.textContent = t('správně') + ': ' + _skore;
    }
    function dalsi() { if (_i >= _por.length) { start(); return; } if (!_odpovezeno) return; _i++; _odpovezeno = false; render(); }
    function open() { var m = build(); m.style.display = 'flex'; start(); }
    function close() { var m = document.getElementById(ID); if (m) m.style.display = 'none'; }

    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'poznavacka', label: t('Poznávačka bodů'), icon: ICON, cat: 'Pomůcky', onClick: open, order: 5 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });

    window.agOpenPoznavacka = open;
    window.AGPoznavacka = { open: open, close: close, otazky: Q };
})();
