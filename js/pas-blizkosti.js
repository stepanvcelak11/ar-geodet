// ===== AR Geodet — PÁS BLÍZKOSTI VE ŠVU (návrh ⑥, ODPOJITELNÁ vrstva) =====
// Vzdálenost k navigovanému bodu přestává být řádek v pilulce nad kamerou a stává
// se z ní vodorovný pás na dělicí hraně mezi kamerou a mapou (#resizer):
//   • pruh se vybarvuje zleva, jak se k bodu blížím (logaritmická stupnice
//     100 → 0,1 m, rysky 50 / 10 / 2 m),
//   • vpravo je samotné číslo v monospace, tučně, na PLNÉM podkladu,
//   • barva nese STAV: daleko → přibližuji (25 m) → hledáček (2 m) → na bodu.
// Ve splitu tím vzdálenost nebere ani pixel kameře ani mapě; v AR na celou
// obrazovku se ten samý pás přilepí ke spodní hraně obrazu.
//
// PROČ VŮBEC: na světlé scéně byla vzdálenost v pilulce prakticky neviditelná
// (viz oprava kaskády `body.cam-live.cam-light` v css/style.css) a hlavně neměla
// STAV — 120 m i 0,3 m vypadalo stejně. Pás jde přečíst koutkem oka za chůze.
//
// ⚠⚠ ANDROID — PROČ TENHLE MODUL NEVISÍ NA SNÍMCÍCH AR:
// renderAR() v grafika.js má DVA `return` JEŠTĚ PŘED updateNavGlow():
//   1) `if (rawCompass === null) return;` — telefon nedodá použitelný azimut
//      (chybí magnetometr, Chrome bez 'deviceorientationabsolute', odepřené čidlo),
//   2) `if (_haveAbsoluteHeading && event.absolute !== true) { ... return; }`
//      — zahazování relativních událostí, když už chodí absolutní.
// Kdyby se pás kreslil jen z updateNavGlow, na takovém telefonu by se NIKDY
// neaktualizoval. Vzdálenost ale na azimutu vůbec nezávisí (mění se s POLOHOU),
// takže vedle rychlé cesty (hook na updateNavGlow) běží ještě pomalá jistota:
// tik 1×/s, který si vzdálenost spočítá sám. Zápis do DOM hlídá dirty-check,
// takže z tiku bez pohybu nekouká žádná práce navíc.
//
// ⚠ NESMÍ SEBRAT TAŽENÍ DĚLIČE: všechno uvnitř má pointer-events:none a chytací
//   plocha #resizer::after (±8 px nad a pod) zůstává netknutá — proto se taky na
//   #resizer NESMÍ dávat overflow:hidden a ořez si dělá až obal #agpb.
// ⚠ Blednutí HUD po nečinnosti se pásu netýká: hudMustStayVisible() v grafika.js
//   vrací true, dokud je nastavený highlightedPointId — tedy po celou navigaci.
//
// Načítat AŽ PO grafika.js (čte jeho globály: viewMode, arPoints, userLat/userLng,
// highlightedPointId, appStarted, getDistance, updateNavGlow).
// ODSTRANĚNÍ: smaž js/pas-blizkosti.js + jeho <script> v index.html a spusť
//             python scripts/gen_sw_assets.py --bump
// =====================================================================================
(function () {
    'use strict';
    if (window.AGPasBlizkosti) return;

    // Stupnice je logaritmická: mezi 100 a 50 m se člověk nekouká, mezi 2 a 0,5 m ano.
    var HI = 100, LO = 0.1, LOG = Math.log(HI / LO);
    var TICKS = [50, 10, 2];
    var NEAR = 2.0;     // stejný práh, jaký má #edge-glow.near v grafika.js
    var HIT = 0.2;      // „na bodu" — pod přesností GPS, ale při kotvení (AGPose) reálné
    var MID = 25;

    var wrap = null, fill = null, edge = null, num = null;
    var _host = null, _txt = '', _band = '', _posK = -1, _on = false, _reserve = -1;
    var _pt = null, _ptId = null, _ptN = -1;

    // ---- čtení globálů z grafika.js / logika.js (typeof kvůli tomu, že se soubor nemusí načíst)
    function gPts()   { return (typeof arPoints !== 'undefined') ? arPoints : null; }
    function gLat()   { return (typeof userLat !== 'undefined') ? userLat : null; }
    function gLng()   { return (typeof userLng !== 'undefined') ? userLng : null; }
    function view()   { return (typeof viewMode === 'string') ? viewMode : 'both'; }
    function started(){ return (typeof appStarted !== 'undefined') && appStarted === true; }

    // Cíl navigace. arPoints bývá i pár tisíc bodů — hledáme jen při změně id/délky.
    function target() {
        var id = (typeof highlightedPointId !== 'undefined') ? highlightedPointId : null;
        var arr = gPts();
        if (id == null || !arr) { _pt = null; _ptId = null; return null; }
        if (_pt && _ptId === id && _ptN === arr.length) return _pt;
        _pt = null;
        for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) { _pt = arr[i]; break; } }
        _ptId = id; _ptN = arr.length;
        return _pt;
    }

    // pt.currentDist přepočítává watchPosition po každých 0,25 m chůze a respektuje
    // zakotvené stanovisko (AGPose) — proto má přednost před vlastním výpočtem.
    function dist(pt) {
        if (pt.currentDist != null && isFinite(pt.currentDist)) return pt.currentDist;
        if (typeof getDistance !== 'function') return null;
        var la = gLat(), ln = gLng();
        if (la == null || ln == null) return null;
        var d = getDistance(la, ln, pt.lat, pt.lng);
        return isFinite(d) ? d : null;
    }

    function pos(m) {
        var v = Math.max(LO, Math.min(HI, m));
        return 1 - Math.log(v / LO) / LOG;      // 100 m → 0 (vlevo), 0,1 m → 1 (vpravo)
    }
    function band(m) {
        if (m < HIT)  return 'na';
        if (m < NEAR) return 'hl';
        if (m < MID)  return 'pr';
        return 'da';
    }
    // stejné zaokrouhlení jako popisek cíle v mapě (js/cil-navigace.js), ať si dvě
    // čísla na jedné obrazovce neodporují
    function fmt(m) {
        if (m >= 1000) return (m / 1000).toFixed(2).replace('.', ',') + ' km';
        if (m >= 100)  return Math.round(m) + ' m';
        return m.toFixed(1).replace('.', ',') + ' m';
    }

    // ---- styly (vlastní, ať se dá modul vyhodit jedním smazáním) ----------------------
    function ensureStyle() {
        if (document.getElementById('ag-pb-style')) return;
        var s = document.createElement('style'); s.id = 'ag-pb-style';
        s.textContent = [
            '#agpb{position:absolute;inset:0;overflow:hidden;pointer-events:none;display:none;}',
            '#agpb.on{display:block;}',
            /* výplň se animuje scaleX (kompozitor) — width by nad kamerou znamenala layout */
            '#agpb .pb-fill{position:absolute;left:0;top:0;bottom:0;width:100%;transform:scaleX(0);',
            '  transform-origin:left center;background:var(--pb,#eceef2);opacity:0.18;}',
            '#agpb .pb-edge{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;',
            '  background:var(--pb,#eceef2);box-shadow:0 0 10px var(--pb,#eceef2);}',
            '#agpb .pb-tick{position:absolute;top:0;bottom:0;width:1px;background:var(--text-faint,#6b727d);opacity:0.55;}',
            '#agpb .pb-tl{position:absolute;top:1px;font-family:var(--font-mono,monospace);',
            '  font-size:calc(8px * var(--ag-font-scale,1));line-height:1.1;color:var(--text-muted,#9aa1ac);',
            '  transform:translateX(3px);}',
            /* číslo má vlastní plný podklad, aby přes něj neběžela hrana ani výplň */
            '#agpb .pb-num{position:absolute;right:var(--pb-right,7px);top:50%;transform:translateY(-50%);z-index:3;',
            '  font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;font-weight:800;',
            '  font-size:calc(13px * var(--ag-font-scale,1));line-height:1;letter-spacing:-0.01em;',
            '  color:var(--pb,#eceef2);background:var(--bg-color,#0f1216);padding:0 2px 0 7px;}',
            /* barvy stavu z tokenů — přebarvení motivu i světlý režim je tím pokrytý */
            '#agpb.b-da{--pb:var(--text-color,#eceef2);}',
            '#agpb.b-pr{--pb:var(--data,#e6bd76);}',
            '#agpb.b-hl{--pb:var(--warning,#fbbf24);}',
            '#agpb.b-na{--pb:var(--accent-bright,#3eb487);}',
            /* v AR na celou obrazovku není šev — pás se přilepí ke spodní hraně obrazu
               (nad systémový indikátor, proto bottom:env()) */
            '#agpb.pb-cam{top:auto;left:0;right:0;bottom:env(safe-area-inset-bottom,0px);height:26px;',
            '  z-index:45;background:var(--bg-color,#0f1216);border-top:1px solid var(--glass-border,rgba(255,255,255,0.10));}',
            /* šev je jinak 16 px; po dobu navigace o kousek vyšší, ať je číslo čitelné.
               Vlásková čára a prstenec úchytu by v barevném pásu dělaly tmavou díru. */
            'body.agpb-on #resizer{height:24px;}',
            'body.agpb-on.ag-glove #resizer{height:28px;}',
            'body.agpb-on #resizer::before{opacity:0;}',
            'body.agpb-on .grabber{box-shadow:none;}',
            /* vzdálenost se přestěhovala do pásu — v pilulce by byla podruhé */
            'body.agpb-on #ar-hud-dist{display:none;}',
            'body.agpb-on #ar-hud-info{padding-top:6px;padding-bottom:6px;}'
        ].join('\n');
        document.head.appendChild(s);
    }

    function ensureEl() {
        if (wrap && wrap.isConnected) return wrap;
        wrap = document.createElement('div');
        wrap.id = 'agpb';
        // je to duplicitní odečet (číslo je i v kartě bodu) a mění se ~1x/s — odečítačka
        // obrazovky by z toho jen mlela dokola
        wrap.setAttribute('aria-hidden', 'true');
        fill = document.createElement('div'); fill.className = 'pb-fill';
        edge = document.createElement('div'); edge.className = 'pb-edge';
        num  = document.createElement('div'); num.className  = 'pb-num';
        wrap.appendChild(fill); wrap.appendChild(edge);
        for (var i = 0; i < TICKS.length; i++) {
            var x = (pos(TICKS[i]) * 100).toFixed(2) + '%';
            var t = document.createElement('span'); t.className = 'pb-tick'; t.style.left = x;
            var l = document.createElement('span'); l.className = 'pb-tl';  l.style.left = x;
            l.textContent = TICKS[i];
            wrap.appendChild(t); wrap.appendChild(l);
        }
        wrap.appendChild(num);
        _host = null;   // po novém prvku se musí znovu zavěsit
        return wrap;
    }

    // Hostitel podle režimu zobrazení. Ve splitu šev, v AR spodní hrana obrazu,
    // v samostatné mapě nikde (tam vzdálenost nese popisek na spojnici).
    function pickHost() {
        var vm = view();
        if (vm === 'map') return null;
        var cam = document.getElementById('camera-container');
        if (vm === 'ar') return cam;
        var r = document.getElementById('resizer');
        // Celoobrazovkové nástroje (AR resekce, zorný úhel, rajón, výška objektu)
        // schovávají mapu i šev třídou `...-clean` na <body> — pak patří pás k obrazu.
        var clean = /\s\S*-clean(?=\s|$)/.test(' ' + document.body.className + ' ');
        if (!r || clean || r.style.display === 'none') return cam;
        return r;
    }

    // ⚠ PRAVY KONEC SVU NENI VOLNY. Svisla lista (#dock, 56 px + 8 px od kraje) stoji
    // svisle NA STREDU displeje — tedy presne tam, kde delic pri vychozich 50 % je —
    // a cislo pod ni zmizelo. Stejnou past uz resi `.rz-pct` v css/style.css tim, ze
    // zive procento posadilo doleva NAD hranu. Tady si misto radeji spocitame: kdyz se
    // pas s dokem svisle protne, odsadi se cislo o jeho sirku, jinak sedi u kraje.
    // Pocita se JEN v pomalem tiku (1x/s) — getBoundingClientRect vynucuje layout a na
    // snimku AR by to bylo zbytecne.
    function reserveRight(el) {
        var right = 7;
        try {
            var d = document.getElementById('dock');
            if (d && d.offsetParent !== null) {
                var dr = d.getBoundingClientRect(), er = el.getBoundingClientRect();
                if (dr.width > 0 && er.height > 0 && dr.bottom > er.top && dr.top < er.bottom) {
                    right = Math.round(dr.width + (window.innerWidth - dr.right) + 8);
                }
            }
        } catch (e) { /* bez mereni zustane vychozich 7 px */ }
        if (right !== _reserve) { el.style.setProperty('--pb-right', right + 'px'); _reserve = right; }
    }

    function hide() {
        if (!_on) return;
        _on = false;
        if (wrap) wrap.classList.remove('on');
        document.body.classList.remove('agpb-on');
    }

    function refresh(slow) {
        var pt = target();
        if (!pt || !started() || gLat() == null) return hide();
        var host = pickHost();
        if (!host) return hide();
        var m = dist(pt);
        if (m == null) return hide();

        var el = ensureEl();
        if (host !== _host) {
            host.appendChild(el);
            el.classList.toggle('pb-cam', host.id === 'camera-container');
            _host = host;
        }

        // DIRTY-CHECK: běží 1x/s + na každém snímku AR, ale zapisuje se jen při změně.
        // Promile stupnice je pod rozlišením displeje, takže stojící člověk nezapíše nic.
        var p = pos(m), pk = (p * 1000) | 0;
        if (pk !== _posK) {
            fill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
            edge.style.left = (p * 100).toFixed(2) + '%';
            _posK = pk;
        }
        var txt = fmt(m);
        if (txt !== _txt) { num.textContent = txt; _txt = txt; }
        var b = band(m);
        if (b !== _band) {
            el.classList.remove('b-da', 'b-pr', 'b-hl', 'b-na');
            el.classList.add('b-' + b);
            _band = b;
        }
        if (slow) reserveRight(el);
        if (!_on) {
            _on = true;
            el.classList.add('on');
            document.body.classList.add('agpb-on');
        }
    }

    function tick(slow) { try { refresh(slow === true); } catch (e) { /* jeden snímek zahodíme, HUD nesmí spadnout */ } }

    // ---- napojení --------------------------------------------------------------------
    // RYCHLÁ CESTA: updateNavGlow() volá renderAR na každém snímku kompasu.
    function hook() {
        if (typeof updateNavGlow !== 'function' || updateNavGlow._pbWrapped) return false;
        var orig = updateNavGlow;
        updateNavGlow = function () { orig.apply(this, arguments); tick(false); };
        updateNavGlow._pbWrapped = true;
        return true;
    }

    ensureStyle();
    if (!hook()) window.addEventListener('load', function () { hook(); });

    // POMALÁ JISTOTA (viz hlavička): 1x/s i bez jediné události kompasu. AG.uiInterval
    // umí js/power-save.js uspat, když je appka na pozadí — proto raději on než setInterval.
    (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () { tick(true); }, 1000);

    // po otoceni displeje se meni i to, kde dok stoji
    try { window.addEventListener('resize', function () { _reserve = -1; tick(true); }); } catch (e) {}

    window.AGPasBlizkosti = { tick: tick, pos: pos, fmt: fmt };
})();
