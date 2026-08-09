// ===== AR Geodet — STAVOVÁ BUBLINA „MŮŽU TOMU VĚŘIT?" (ODPOJITELNÁ vrstva) =====
// Neinvazivní vrstva: NEEDITUJE logika.js ani grafika.js, jen čte globály.
// Odpovídá na jedinou otázku terénu: „můžu teď uložit bod, nebo je to k ničemu?"
//
// JEDNA bublina nahoře uprostřed místo pěti rozházených panelů (na přání):
//   • Sbaleno = semafor + dvě čísla:  ● ±0,8 m · 214,6°
//     (tečka má barvu NEJHORŠÍHO ze stavů GPS / sever / data / baterie).
//   • Když se stav zhorší, bublina se na 10 s rozšíří o krátký text („Srovnej
//     sever") a pak se zase stáhne na tečku a čísla — neřve pořád.
//   • Klepnutí = detail se ROZBALÍ NA MÍSTĚ (pod pilulkou, kamera zůstane vidět):
//     řádky GPS · Sever · Data · Baterie s radou, co udělat, + akce
//     Srovnat sever / Detail GPS / Skóre místa. Klepnutí mimo zavře.
//   • Rozbalený detail NIKDY nesahá na ovládání: jeho strop se počítá z živé polohy
//     svislé lišty #dock (Nástroje / Body / Nový bod…) a přebývající obsah roluje.
//     Když se ho uživatel půl minuty nedotkne, sbalí se sám.
//   • Kalibrace severu má EXPIRACI: po 30 minutách nebo 200 m od místa srovnání
//     zežloutne („srovnej znovu"). Zdroj: obalený nudgeHeadingOffset + AGPose.
//   • O polohu se stará sloupec upozornění (#ag-stack z js/upozorneni.js), který
//     si bublinu adoptuje jako první prvek — pod ní se řadí ostatní hlášky, nikdy
//     přes sebe. Bez toho modulu ji ukotví vlastní CSS (fixed, nahoře uprostřed).
//
// CO SE SLUČUJE (skryje se, dokud je bublina zapnutá — v DOM ale zůstává, takže
// moduly, které na prvky sahají, jedou dál):
//   #compass-debug (azimut) · #gps-avg (průměrování) · #ag-cstab (stabilita
//   kompasu) · #info (stavové hlášky — propíšou se do bubliny na 6 s).
// Vypnutím bubliny (Nastavení → Vzhled) se původní panely zase objeví.
//
// Odstranění: smaž js/stavovy-pruh.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var BAR_KEY = 'agStatusBar';           // '0' = vypnuto (výchozí zapnuto)
    var CAL_KEY = 'agCalibInfo';           // {ts,lat,lng} posledního srovnání severu
    var TILE_CACHE = 'argeodet-offline-v12';   // shodné se sw.js / logika.js
    var CAL_MAX_AGE = 30 * 60 * 1000;      // 30 min
    var CAL_MAX_DIST = 200;                // m od místa srovnání
    var ALERT_MS = 10000;                  // jak dlouho svítí text upozornění po změně
    var MSG_MS = 6000;                     // jak dlouho svítí hláška z #info

    var HIDE_IDS = ['compass-debug', 'gps-avg', 'ag-cstab', 'info'];

    var _bat = null;                        // {level,charging} nebo null (nepodporováno)
    var _tilesCached = null;                // null = nezjištěno, jinak boolean
    var _lastFixTs = null, _lastLat = null, _lastLng = null;
    var _open = false;                      // rozbalený detail
    var _alertKey = null, _alertTs = 0;     // co a odkdy hlásíme v hlavičce
    var _msg = null, _msgTs = 0;            // poslední hláška z #info
    var _lastHead = '', _lastBody = '';     // co už je v DOM (nepřepisovat zbytečně)
    var _openTs = 0;                        // kdy naposled uživatel s rozbaleným detailem pracoval
    var AUTO_CLOSE_MS = 30000;              // po půl minutě klidu se detail sbalí sám
    var _azTs = 0;                          // škrcení přepisů azimutu (viz mirrorAz)

    function on() { try { return localStorage.getItem(BAR_KEY) !== '0'; } catch (e) { return true; } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function calInfo() { try { return JSON.parse(localStorage.getItem(CAL_KEY)); } catch (e) { return null; } }
    function num(v, d) { var s = (+v).toFixed(d == null ? 1 : d); return s.replace('.', ','); }
    function metry(v) { return (v >= 10 ? num(v, 0) : num(v, 1)) + ' m'; }
    // JEDINÝ formát přesnosti v celé bublině. Dřív se totéž číslo psalo třemi způsoby
    // (pilulka metry() na 1 desetinu, řádek detailu num() a nadpis acc.toFixed(0)),
    // takže sbalená pilulka hlásila „±4,4 m" a po rozkliknutí stálo „GPS ±4 m" —
    // uživatel to (právem) čte jako dvě různé přesnosti. Číslo se smí formátovat
    // JEN tady; kdo potřebuje jiné zaokrouhlení, ať ho změní pro všechna místa.
    function accTxt(v) { return '±' + metry(v); }
    // Průměrovaná střední chyba se od živé přesnosti musí odlišit ZNAČKOU, ne
    // formátem — „⌀" je stejné jako v modálu Detail GPS („Stř. chyba ⌀").
    function avgTxt(v) { return '⌀ ±' + num(v, 2) + ' m'; }

    // ---- sběr stavů -----------------------------------------------------------------
    // GPS: přesnost + čerstvost fixu (změna souřadnic = fix; watchPosition v logice
    // hlásí průběžně, takže stárnutí = signál se ztratil)
    function gpsState() {
        var acc = (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy) ? currentGpsAccuracy : null;
        if (!haveUser() || acc == null) return { c: 'red', t: 'GPS —', d: 'Bez GPS fixu.', a: 'Jdi pod otevřené nebe a počkej. V budově GPS nechytneš.' };
        var age = _lastFixTs ? (Date.now() - _lastFixTs) : null;
        if (age != null && age > 30000) return { c: 'red', t: 'GPS ztracena', d: 'Poslední fix před ' + Math.round(age / 1000) + ' s.', a: 'Signál se ztratil — vyjdi zpod střechy/stromů a počkej na nový fix.' };
        if (acc <= 5 && (age == null || age <= 12000)) return { c: 'green', t: 'GPS ' + accTxt(acc), d: 'Přesnost ' + accTxt(acc) + ', fix čerstvý.', a: 'Dobré podmínky. Pro bod nech doběhnout průměrování.' };
        if (acc <= 15) return { c: 'yellow', t: 'GPS ' + accTxt(acc), d: 'Přesnost ' + accTxt(acc) + '.', a: 'Počkej 30–60 s v klidu, nebo poodejdi 5 m od zdí a aut. Pomůže i „Predikce signálu" v Nástrojích.' };
        return { c: 'red', t: 'GPS ' + accTxt(acc), d: 'Přesnost ' + accTxt(acc) + ' — na ukládání bodů to nestačí.', a: 'Přesuň se na volné prostranství. Pro co nejlepší bod z telefonu použij „Brutální GPS".' };
    }
    // průměrování GPS (dřívější panel #gps-avg): {txt, detail} nebo null
    function avgInfo() {
        var r = null;
        try { r = (typeof gpsAvgResult !== 'undefined') ? gpsAvgResult : null; } catch (e) { r = null; }
        if (!r) return null;
        if (r.coarse) return { txt: null, detail: 'Síťová poloha ' + accTxt(r.acc) + ' — počkej na satelitní fix.' };
        if (!(r.n >= 2)) return { txt: null, detail: 'Průměruji…' };
        var kolik = (r.total && r.total > r.n) ? (r.n + ' z ' + r.total) : ('' + r.n);
        return { txt: avgTxt(r.sterr), detail: '<b>' + avgTxt(r.sterr) + '</b> = stř. chyba průměru z <b>' + kolik + ' měření</b> (rozptyl σ ±' + num(r.sigma, 2) + ' m). Stejné číslo je v „Detail GPS".' };
    }
    // AR / sever: resekce (AGPose) > ruční srovnání (calInfo) > nic
    function arState() {
        if (window.AGPose && window.AGPose.valid && window.AGPose.source === 'resection') {
            var age = Math.round((Date.now() - (window.AGPose.ts || 0)) / 60000);
            return { c: 'green', t: 'AR ✓ resekce', d: 'Stanovisko zakotveno resekcí' + (age ? ' před ' + age + ' min' : '') + (window.AGPose.posSigma != null ? ' (±' + num(window.AGPose.posSigma, 2) + ' m)' : '') + '.', a: 'Nejlepší možný stav. Když poodejdeš, kotva se sama zruší.' };
        }
        var ci = calInfo();
        var hoff = (typeof userHeadingOffset !== 'undefined') ? userHeadingOffset : 0;
        if (ci && ci.ts) {
            var ageMs = Date.now() - ci.ts;
            var dist = null;
            if (haveUser() && ci.lat != null && typeof getDistance === 'function') { try { dist = getDistance(userLat, userLng, ci.lat, ci.lng); } catch (e) {} }
            var stale = ageMs > CAL_MAX_AGE || (dist != null && dist > CAL_MAX_DIST);
            if (!stale) return { c: 'green', t: 'AR ✓', d: 'Sever srovnán před ' + Math.round(ageMs / 60000) + ' min' + (dist != null ? ' (' + Math.round(dist) + ' m odsud)' : '') + '.', a: 'Platí. Po přesunu jinam nebo za ~30 min srovnej znovu.' };
            return { c: 'yellow', t: 'AR ?', d: 'Sever byl srovnán před ' + Math.round(ageMs / 60000) + ' min' + (dist != null ? ' a ' + Math.round(dist) + ' m odsud' : '') + ' — už nemusí platit.', a: 'Srovnej znovu podle bodu — tlačítko níž.' };
        }
        if (hoff) return { c: 'yellow', t: 'AR ~', d: 'Sever má ruční korekci, ale nevím odkdy.', a: 'Když značky nesedí, srovnej znovu — tlačítko níž.' };
        return { c: 'yellow', t: 'AR kompas', d: 'Sever jede jen z kompasu telefonu (typicky ±5–15°).', a: 'Pro přesné cílení srovnej sever podle známého bodu — tlačítko níž.' };
    }
    // stabilita kompasu (dřívější prvek #ag-cstab) — jen doplněk do řádku Sever
    function cstabText() {
        try {
            var s = window.AGCompassStability ? window.AGCompassStability.score : null;
            if (s == null) return '';
            return ' Kompas ' + (s >= 70 ? 'klidný' : (s >= 40 ? 'kolísá' : 'neklidný')) + ' (' + s + ' %).';
        } catch (e) { return ''; }
    }
    function dataState() {
        var onl = (typeof navigator !== 'undefined') ? navigator.onLine : true;
        if (onl) return { c: 'green', t: 'Online', d: 'Internet je. Katastr i mapy se donačtou.', a: _tilesCached ? 'Offline mapa je uložená — výpadek nevadí.' : 'Tip: před cestou do terénu ulož mapu — menu Více → „Uložit pro offline".' };
        if (_tilesCached) return { c: 'yellow', t: 'Offline ✓', d: 'Bez internetu, ale offline mapa je uložená.', a: 'Vše důležité funguje. Katastr online se nedotáhne.' };
        return { c: 'red', t: 'Offline!', d: 'Bez internetu a bez uložené offline mapy.', a: 'Body a měření fungují dál, ale mapa bude prázdná. Příště: Více → „Uložit pro offline".' };
    }
    function batState() {
        if (!_bat) return null;
        var p = Math.round(_bat.level * 100);
        if (_bat.charging) return { c: 'green', t: '⚡' + p + '%', d: 'Baterie ' + p + ' %, nabíjí se.', a: '' };
        if (p >= 35) return { c: 'green', t: p + '%', d: 'Baterie ' + p + ' %.', a: '' };
        if (p >= 15) return { c: 'yellow', t: p + '%', d: 'Baterie ' + p + ' % — AR s kamerou žere hodně.', a: 'Přepni na „Pouze mapa" (kolečko vpravo dole), displej ztlum. Úsporný režim appka řeší sama mimo AR.' };
        return { c: 'red', t: p + '%', d: 'Baterie ' + p + ' % — dojede ti během měření.', a: 'Zapni úsporný režim telefonu, používej jen mapu a zavři AR. Data máš uložená průběžně.' };
    }

    // ---- hlavička bubliny --------------------------------------------------------
    // azimut zrcadlíme z #compass-debug (jednotné jednotky °/gon i varování ⚠,
    // které tam píše grafika.js) — bez vlastního přepočtu a vlastního časovače
    function azHtml() {
        var el = document.getElementById('compass-debug');
        if (!el) return '';
        var h = el.innerHTML || '';
        h = h.replace(/<span class="hud-k">[^<]*<\/span>/i, '').trim();
        if (!h || /^--/.test(h)) return '';
        return h;
    }
    // Pilulka ukazuje ŽIVOU přesnost telefonu — tedy PŘESNĚ to číslo, co po rozkliknutí
    // stojí na řádku GPS — a teprve za ní, když už průměrování dává smysl, střední chybu
    // průměru se značkou ⌀. Dřív živé číslo průměr PŘEPSAL: ve sbalené pilulce svítilo
    // „±0,35 m", v rozbaleném detailu „±4,2 m", a nikde nebylo vidět, že jsou to dvě
    // různé věci (okamžitá přesnost fixu × přesnost průměru z N měření).
    function accHtml() {
        var acc = (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy) ? currentGpsAccuracy : null;
        var live = acc ? accTxt(acc) : '—';
        var a = avgInfo();
        if (a && a.txt) return live + '<span class="ag-sp-sep"> · </span><span class="ag-sp-avg">' + a.txt + '</span>';
        return live;
    }
    // co je nejhorší a jak to pojmenovat jednou větou
    function alertFor(g, ar, d, b) {
        if (g.c === 'red') return { c: 'red', k: 'gps-r', t: 'GPS nestačí' };
        if (d.c === 'red') return { c: 'red', k: 'data-r', t: 'Offline bez mapy' };
        if (b && b.c === 'red') return { c: 'red', k: 'bat-r', t: 'Baterie dochází' };
        if (g.c === 'yellow') return { c: 'yellow', k: 'gps-y', t: 'Slabá GPS' };
        if (ar.c === 'yellow') return { c: 'yellow', k: 'ar-y', t: 'Srovnej sever' };
        if (d.c === 'yellow') return { c: 'yellow', k: 'data-y', t: 'Jedeš offline' };
        if (b && b.c === 'yellow') return { c: 'yellow', k: 'bat-y', t: 'Slabá baterie' };
        return null;
    }
    function worst(g, ar, d, b) {
        var cs = [g.c, ar.c, d.c].concat(b ? [b.c] : []);
        if (cs.indexOf('red') >= 0) return 'red';
        if (cs.indexOf('yellow') >= 0) return 'yellow';
        return 'green';
    }

    // ---- styly -----------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('ag-sp-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-sp-style';
        st.textContent = [
            // bublina
            '#ag-sp{position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 4px);z-index:645;',
            '  display:none;flex-direction:column;border-radius:18px;overflow:hidden;cursor:pointer;',
            '  background:var(--glass-bg,rgba(18,22,28,0.88));border:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 2px 10px rgba(0,0,0,0.35);',
            '  font:600 12.5px/1 var(--font-ui,system-ui);color:var(--text-color,#eceef2);max-width:94vw;}',
            'body.app-started #ag-sp.ag-sp-on{display:flex;}',
            '#ag-sp.ag-sp-open{border-radius:16px;}',
            '#ag-sp.ui-faded{opacity:0.3;}',
            // hlavička (sbalený stav)
            '.ag-sp-head{display:flex;align-items:center;gap:7px;padding:7px 13px;white-space:nowrap;',
            '  font-variant-numeric:tabular-nums;}',
            '.ag-sp-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;}',
            '.ag-sp-dot.green{background:#34d399;box-shadow:0 0 5px rgba(52,211,153,0.8);}',
            '.ag-sp-dot.yellow{background:#fbbf24;box-shadow:0 0 5px rgba(251,191,36,0.8);}',
            '.ag-sp-dot.red{background:#fb7185;box-shadow:0 0 5px rgba(251,113,133,0.9);animation:agSpBlink 1.2s ease-in-out infinite;}',
            '@keyframes agSpBlink{0%,100%{opacity:1}50%{opacity:0.35}}',
            '.ag-sp-num{font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-weight:700;color:var(--data,#e6bd76);}',
            '.ag-sp-num sup{font-size:calc(9px * var(--ag-font-scale, 1));margin-left:1px;opacity:0.7;}',
            '.ag-sp-avg{opacity:0.82;}',
            '.ag-sp-sep{opacity:0.32;}',
            '.ag-sp-alert{font-weight:700;}',
            '.ag-sp-alert.yellow{color:var(--warning,#fbbf24);}',
            '.ag-sp-alert.red{color:var(--danger,#fb7185);}',
            '.ag-sp-msg{font-weight:600;opacity:0.85;max-width:46vw;overflow:hidden;text-overflow:ellipsis;}',
            // SLOUČENÝ PRUH: text upozornění z centra + počítadlo, když jich visí víc.
            // Text se musí umět zkrátit, jinak by dlouhá hláška vytlačila čísla
            // (přesnost a azimut) mimo pilulku — a ta jsou tu to hlavní.
            '.ag-sp-head .ag-sp-alert{max-width:44vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.ag-sp-ncount{font-family:var(--font-mono,ui-monospace,monospace);font-weight:700;',
            '  font-size:calc(9.5px * var(--ag-font-scale, 1));line-height:1;padding:2px 5px;border-radius:999px;',
            '  background:rgba(255,255,255,0.14);color:var(--text,#e6e8eb);flex:0 0 auto;}',
            // řádek v rozbaleném detailu, který vede na kartu se všemi hláškami
            '.ag-sp-note{display:flex;align-items:center;gap:8px;width:100%;margin:0 0 8px;padding:9px 10px;',
            '  border-radius:10px;cursor:pointer;text-align:left;',
            '  background:rgba(255,255,255,0.06);border:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  color:var(--text,#e6e8eb);font:600 calc(12.5px * var(--ag-font-scale, 1))/1.35 var(--font-ui,system-ui),sans-serif;}',
            '.ag-sp-note-tx{flex:1 1 auto;min-width:0;}',
            '.ag-sp-note-go{opacity:0.5;flex:0 0 auto;}',
            '.ag-sp-note:focus-visible{outline:2px solid var(--accent,#2f9e74);outline-offset:2px;}',
            '.ag-sp-caret{font-size:calc(9px * var(--ag-font-scale, 1));opacity:0.45;margin-left:1px;}',
            // rozbalený detail (na místě, pod hlavičkou)
            // OPRAVA 27. 7. — „rozbalená lišta se překrývá s Nástroji a Body“.
            // PŘÍČINA: detail neměl žádný výškový strop. Se čtyřmi řádky (GPS · Sever ·
            // Data · Baterie) včetně rad, třemi tlačítky a „Vypnout bublinu“ naroste
            // přes 350 px, začíná hned pod výřezem a je široký min(86vw,336px) — spadne
            // tedy přesně do dráhy svislé lišty #dock (ta má střed v 60 % výšky displeje).
            // ŘEŠENÍ: strop --ag-sp-maxh počítá fitBody() z živé polohy #dock; co se
            // nevejde, roluje (touch-action musí být pan-y — html+body mají none).
            '.ag-sp-body{width:min(86vw,336px);padding:2px 13px 11px;border-top:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  cursor:default;animation:agSpIn 0.16s ease both;',
            '  max-height:var(--ag-sp-maxh,46vh);overflow-y:auto;overscroll-behavior:contain;',
            '  -webkit-overflow-scrolling:touch;touch-action:pan-y;}',
            '@keyframes agSpIn{from{opacity:0;transform:translateY(-4px);}}',
            '.ag-sp-row{display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.07));}',
            '.ag-sp-row:last-of-type{border-bottom:none;}',
            '.ag-sp-row .ag-sp-dot{margin-top:4px;}',
            '.ag-sp-k{font-size:calc(11.5px * var(--ag-font-scale, 1));font-weight:700;width:52px;flex:0 0 auto;}',
            '.ag-sp-v{flex:1;min-width:0;font:400 11.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);white-space:normal;}',
            '.ag-sp-v b{color:var(--text-color,#eceef2);font-weight:600;}',
            '.ag-sp-v .ag-sp-a{display:block;margin-top:2px;color:var(--text-color,#eceef2);}',
            '.ag-sp-a::before{content:"→ ";color:var(--accent,#2f9e74);font-weight:700;}',
            '.ag-sp-acts{display:flex;gap:6px;margin-top:10px;}',
            '.ag-sp-acts button{flex:1;padding:9px 5px;border-radius:10px;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:var(--surface-2,rgba(255,255,255,0.07));',
            '  color:inherit;font:600 10.5px/1.15 var(--font-ui,system-ui);}',
            '.ag-sp-acts button.ag-sp-prim{background:var(--accent,#2f9e74);border-color:transparent;color:#fff;}',
            '.ag-sp-off{width:100%;margin-top:8px;padding:8px;border-radius:10px;cursor:pointer;background:transparent;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));color:var(--text-muted,#9aa1ac);font:600 10.5px/1 var(--font-ui,system-ui);}',
            // venku dobře viditelná varianta
            'body.outdoor-mode #ag-sp{background:#0a0e1a;border-color:rgba(255,255,255,0.85);font-size:calc(13px * var(--ag-font-scale, 1));}',
            'body.light-mode.outdoor-mode #ag-sp{background:#fff;border-color:rgba(10,14,26,0.7);}',
            'body.ag-glove #ag-sp .ag-sp-head{padding:9px 15px;font-size:calc(13.5px * var(--ag-font-scale, 1));}',
            'body.ag-glove #ag-sp .ag-sp-acts button{padding:12px 5px;}',
            // sloučené panely — dokud je bublina zapnutá, jsou schované (v DOM zůstávají)
            'body.ag-bubble #compass-debug,body.ag-bubble #gps-avg,',
            'body.ag-bubble #ag-cstab,body.ag-bubble #info{display:none !important;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- UI --------------------------------------------------------------------------
    function ensureBar() {
        var el = document.getElementById('ag-sp');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'ag-sp';
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', 'Stav měření — klepni pro detail a rady');
        el.addEventListener('click', function (e) {
            if (e.target.closest('.ag-sp-body')) return;   // klik uvnitř detailu nezavírá
            toggle();
        });
        el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
        (document.body || document.documentElement).appendChild(el);
        // pozici NEŘEŠÍME přes AGHud (drag/pinch) — sloupec #ag-stack prvek adoptuje
        // a přepne na position:static, takže by tažení stejně nic nedělalo
        mirrorAz();
        mirrorInfo();
        mirrorFade();
        return el;
    }
    function toggle() {
        _open = !_open;
        if (_open) { _alertTs = 0; _openTs = Date.now(); }   // po otevření už není co blikat v hlavičce
        _lastHead = _lastBody = '';   // vynutit překreslení
        renderBar();
    }
    function close() { if (!_open) return; _open = false; _lastHead = _lastBody = ''; renderBar(); }

    // Nejzávažnější upozornění z centra (js/upozorneni.js). Dokud je jeho karta
    // sbalená, NEKRESLÍ si vlastní pilulku a text patří do tohohle pruhu — nahoře
    // je pak jeden pruh místo dvou nad sebou.
    function noteNow() {
        try {
            if (!window.AGNotify || typeof AGNotify.worst !== 'function') return null;
            return AGNotify.worst();
        } catch (e) { return null; }
    }
    // Úrovně se v obou modulech jmenují JINAK: centrum upozornění má
    // danger/warn/ok/info (LVL v js/upozorneni.js), tenhle pruh green/yellow/red
    // (stejná jména mají i .ag-sp-dot a .ag-sp-alert v CSS). Tady je ten převod.
    function noteCls(level) {
        if (level === 'danger') return 'red';
        if (level === 'warn') return 'yellow';
        return 'green';
    }

    function headHtml(g, ar, d, b) {
        var w = worst(g, ar, d, b);
        var note = noteNow();
        // Upozornění PŘEBIJE i tečku závažnosti: centrum agreguje víc modulů než
        // tenhle pruh, takže když hlásí kritický stav, nesmí tu svítit zelená.
        var h = '<span class="ag-sp-dot ' + (note ? noteCls(note.level) : w) + '"></span>';
        if (note) {
            // Vlastní alertFor() se záměrně přeskakuje — centrum tu hlášku už nese
            // (jinak by tu „Srovnej sever" stálo dvakrát vedle sebe).
            h += '<span class="ag-sp-alert ' + noteCls(note.level) + '">' + esc(note.text) + '</span>'
                + (note.count > 1 ? '<span class="ag-sp-ncount">' + note.count + '</span>' : '')
                + '<span class="ag-sp-sep">·</span>';
        } else if (_msg && (Date.now() - _msgTs) < MSG_MS) {
            // hláška z #info (krátkodobá: „Stahuji data…")
            h += '<span class="ag-sp-msg">' + esc(_msg) + '</span>';
        } else {
            var al = alertFor(g, ar, d, b);
            if (al && (Date.now() - _alertTs) < ALERT_MS) h += '<span class="ag-sp-alert ' + al.c + '">' + esc(al.t) + '</span><span class="ag-sp-sep">·</span>';
        }
        h += '<span class="ag-sp-num ag-sp-acc">' + accHtml() + '</span>';   // sestaveno z čísel, ne z textu uživatele
        var az = azHtml();
        if (az) h += '<span class="ag-sp-sep">·</span><span class="ag-sp-num ag-sp-az">' + az + '</span>';
        h += '<span class="ag-sp-caret">' + (_open ? '▴' : '▾') + '</span>';
        return h;
    }
    function row(name, s, extra) {
        if (!s) return '';
        return '<div class="ag-sp-row"><span class="ag-sp-dot ' + s.c + '"></span><span class="ag-sp-k">' + esc(name) + '</span>'
            + '<span class="ag-sp-v">' + esc(s.d) + (extra || '') + (s.a ? '<span class="ag-sp-a">' + esc(s.a) + '</span>' : '') + '</span></div>';
    }
    // Dosažený kód kvality podle katastrální vyhlášky — jen informace k číslu, které
    // už na řádku svítí. (Věta o „cílové třídě zakázky" tu byla, dokud existovala
    // cílená přesnost; ta je na přání zrušená, mobilem ji stejně nešlo dosáhnout.)
    function qcHtml() {
        try {
            var r = (typeof gpsAvgResult !== 'undefined') ? gpsAvgResult : null;
            if (!r || r.coarse || !(r.n >= 2) || !window.AGQc || !AGQc.codeForSigma) return '';
            var g = AGQc.codeForSigma(r.sterr);
            return g ? (' Kód kvality <b>' + g.kod + '</b>.') : ' Na kód kvality 5 to zatím nestačí.';
        } catch (e) { return ''; }
    }
    function actsHtml() {
        var h = '';
        if (typeof window.agOpenCalibrate === 'function' || typeof window.openCompassModal === 'function') h += '<button type="button" class="ag-sp-prim" data-act="sever">Srovnat sever</button>';
        if (typeof window.openGpsAvgModal === 'function') h += '<button type="button" data-act="gps">Detail GPS</button>';
        if (window.AGSemafor && AGSemafor.open) h += '<button type="button" data-act="skore">Skóre místa</button>';
        return h ? '<div class="ag-sp-acts">' + h + '</div>' : '';
    }
    function bodyHtml(g, ar, d, b) {
        var a = avgInfo();
        var gExtra = (a && a.detail) ? (' ' + a.detail) : '';
        var az = azHtml();
        var arExtra = (az ? (' Azimut <b>' + az + '</b>.') : '') + cstabText();
        // Když v pruhu svítí upozornění, musí z něj vést cesta ke VŠEM hláškám.
        // Klepnutí na pruh záměrně dál otevírá tenhle detail (nemění se pod rukou,
        // co tlačítko dělá) a odsud se jde na kartu upozornění.
        var note = noteNow();
        var noteRow = note
            ? '<button type="button" class="ag-sp-note" data-act="notes">'
              + '<span class="ag-sp-dot ' + noteCls(note.level) + '"></span>'
              + '<span class="ag-sp-note-tx">' + esc(note.text) + '</span>'
              + (note.count > 1 ? '<span class="ag-sp-ncount">' + note.count + '</span>' : '')
              + '<span class="ag-sp-note-go" aria-hidden="true">›</span></button>'
            : '';
        return noteRow
            + row('GPS', g, gExtra + qcHtml())
            + row('Sever', ar, arExtra)
            + row('Data', d)
            + row('Baterie', b)
            + actsHtml()
            + '<button type="button" class="ag-sp-off" data-act="off">Vypnout bublinu (vrátí původní panely)</button>';
    }
    function renderBar() {
        var el = ensureBar();
        var live = on();
        el.classList.toggle('ag-sp-on', live);
        document.body.classList.toggle('ag-bubble', live);
        if (!live) { if (_open) _open = false; return; }

        var g = gpsState(), ar = arState(), d = dataState(), b = batState();
        // změna problému → znovu na 10 s ukázat text
        var al = alertFor(g, ar, d, b);
        var key = al ? al.k : null;
        if (key !== _alertKey) { _alertKey = key; _alertTs = key ? Date.now() : 0; }

        var head = headHtml(g, ar, d, b);
        var body = _open ? bodyHtml(g, ar, d, b) : '';
        if (head === _lastHead && body === _lastBody) return;   // nic se nezměnilo — nepsat do DOM
        var headChanged = (head !== _lastHead), bodyChanged = (body !== _lastBody);
        _lastHead = head; _lastBody = body;
        el.classList.toggle('ag-sp-open', _open);
        el.setAttribute('aria-expanded', _open ? 'true' : 'false');
        // PROBLIKÁVÁNÍ (nahlášeno 8. 8. 2026 z telefonu: „pilulka při svipu problikává
        // tím, jak se aktualizuje").
        // PŘÍČINA: tady se přepisoval CELÝ innerHTML pilulky při každé změně. Detail
        // .ag-sp-body má náběhovou animaci `agSpIn` a ta se znovuvytvořením uzlu
        // PŘEHRÁLA ZNOVU — každé dvě vteřiny tedy celý rozbalený panel blikl. A protože
        // rozbalený detail obsahuje živé hodnoty (přesnost, azimut, baterie), měnil se
        // skoro pořád. Navíc mirrorAz() nuluje _lastHead, takže se překreslovalo i tehdy,
        // když se ve skutečnosti nic nezměnilo.
        // ŘEŠENÍ: hlavička a detail se přepisují ZVLÁŠŤ a jen ta část, která se opravdu
        // změnila. Uzel .ag-sp-body tak zůstane týž → animace se nepřehrává a posluchač
        // na něm drží (nemusí se navěšovat znovu).
        var headEl = el.querySelector('.ag-sp-head');
        var bodyEl = el.querySelector('.ag-sp-body');
        if (!headEl) {                       // první vykreslení — postavit kostru
            el.innerHTML = '<div class="ag-sp-head"></div>';
            headEl = el.querySelector('.ag-sp-head');
            bodyEl = null;
        }
        if (headChanged) headEl.innerHTML = head;
        if (!_open) {
            if (bodyEl) bodyEl.remove();     // sbaleno → detail pryč (animace při dalším otevření je ŽÁDOUCÍ)
        } else {
            if (!bodyEl) {
                bodyEl = document.createElement('div');
                bodyEl.className = 'ag-sp-body';
                bodyEl.addEventListener('click', onAct);
                el.appendChild(bodyEl);
                bodyEl.innerHTML = body;
            } else if (bodyChanged) {
                bodyEl.innerHTML = body;     // TÝŽ uzel → agSpIn se nepřehraje
            }
        }
        fitBody();
    }
    // Strop rozbaleného detailu, aby NIKDY nesahal na svislou lištu ovládání.
    // Počítá se z živého getBoundingClientRect(): lišta si mění polohu podle režimu
    // levé ruky, výšky displeje i počtu chipů, takže pevná hodnota v CSS by dřív
    // nebo později neseděla. Když lišta není vidět (modul odpojen), strop drží
    // spodní hrana okna.
    function fitBody() {
        try {
            var el = document.getElementById('ag-sp'); if (!el) return;
            var bodyEl = el.querySelector('.ag-sp-body'); if (!bodyEl) return;
            var top = bodyEl.getBoundingClientRect().top;
            var limit = window.innerHeight;
            var dock = document.getElementById('dock');
            if (dock) {
                var r = dock.getBoundingClientRect();
                // jen když je lišta vidět a leží POD začátkem detailu (jinak by strop vyšel záporně)
                if (r.height > 0 && r.width > 0 && r.top > top + 60) limit = Math.min(limit, r.top);
            }
            bodyEl.style.maxHeight = Math.max(150, Math.round(limit - top - 12)) + 'px';
        } catch (e) {}
    }
    function onAct(e) {
        var btn = e.target.closest('button[data-act]');
        if (!btn) return;
        e.stopPropagation();
        var act = btn.getAttribute('data-act');
        close();
        try {
            if (act === 'notes') { if (window.AGNotify && AGNotify.expand) AGNotify.expand(); }
            else if (act === 'sever') { if (typeof window.agOpenCalibrate === 'function') window.agOpenCalibrate(); else if (typeof window.openCompassModal === 'function') window.openCompassModal(); }
            else if (act === 'gps') { if (typeof window.openGpsAvgModal === 'function') window.openGpsAvgModal(); }
            else if (act === 'skore') { if (window.AGSemafor && AGSemafor.open) AGSemafor.open(); }
            else if (act === 'off') {
                try { localStorage.setItem(BAR_KEY, '0'); } catch (err) {}
                var cb = document.querySelector('#ag-sp-row-set input'); if (cb) cb.checked = false;
                renderBar();
                if (typeof quickToast === 'function') quickToast('Bublina vypnuta — původní panely jsou zpět. Zapneš ji v Nastavení → Vzhled.');
            }
        } catch (err) {}
    }

    // ---- přepínač v Nastavení → Vzhled --------------------------------------------------
    function injectSettingsToggle() {
        if (document.getElementById('ag-sp-row-set')) return;
        var tab = document.getElementById('tab-vzhled'); if (!tab) return;
        var row = document.createElement('div');
        row.className = 'st-row'; row.id = 'ag-sp-row-set';
        var lab = document.createElement('span');
        lab.className = 'st-lab';
        lab.innerHTML = 'Stavová bublina<small>GPS · sever · data · baterie v jedné bublině nahoře; vypnutím se vrátí původní panely</small>';
        var sw = document.createElement('label'); sw.className = 'st-sw';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on();
        cb.addEventListener('change', function () {
            try { localStorage.setItem(BAR_KEY, cb.checked ? '1' : '0'); } catch (e) {}
            _open = false; _lastHead = _lastBody = '';
            renderBar();
            // po zapnutí bubliny musí původní panely zmizet, po vypnutí se řídí svými přepínači
            try { if (typeof toggleHudElements === 'function') toggleHudElements(); } catch (e) {}
        });
        var face = document.createElement('span'); face.className = 'st-sw-face';
        sw.appendChild(cb); sw.appendChild(face);
        row.appendChild(lab); row.appendChild(sw);
        tab.appendChild(row);
    }

    // ---- zdroje dat --------------------------------------------------------------------
    // časová značka srovnání severu: obal nudgeHeadingOffset (volá ho ar-calibrate,
    // ar-calib2, orient-point…) — uloží ts + polohu, od kterých se počítá expirace
    function wrapCalib() {
        if (window.__agSpCalWrapped || typeof window.nudgeHeadingOffset !== 'function') return;
        var orig = window.nudgeHeadingOffset;
        window.nudgeHeadingOffset = function () {
            var r = orig.apply(this, arguments);
            try { localStorage.setItem(CAL_KEY, JSON.stringify({ ts: Date.now(), lat: (haveUser() ? userLat : null), lng: (haveUser() ? userLng : null) })); } catch (e) {}
            return r;
        };
        window.__agSpCalWrapped = true;
    }
    // azimut: přepisujeme jen když se text v #compass-debug opravdu změní
    // (grafika.js tam píše taky jen při změně) — žádný vlastní časovač navíc
    function mirrorAz() {
        try {
            var src = document.getElementById('compass-debug');
            if (!src || window.__agSpAzMo || typeof MutationObserver === 'undefined') return;
            window.__agSpAzMo = new MutationObserver(function () {
                // grafika.js přepisuje azimut i 60×/s — do bubliny stačí 5×/s
                // (co se nestihne, dorovná pravidelný tick); jinak zbytečně žere baterii.
                // POZOR na pořadí: škrcení MUSÍ být první. Dokud tu stálo `on()` nad ním,
                // sáhlo se do localStorage při KAŽDÉ změně azimutu (naměřeno 25 čtení/s
                // v klidovém AR) jen proto, aby se o řádek níž zjistilo, že se překreslovat
                // nebude. localStorage je synchronní, takže to ubíralo i plynulost.
                var t = Date.now();
                if (t - _azTs < 200) return;
                if (!on()) return;
                _azTs = t;
                var el = document.querySelector('#ag-sp .ag-sp-az');
                var az = azHtml();
                if (el && az) { el.innerHTML = az; _lastHead = ''; }
                else if (!el) { _lastHead = ''; renderBar(); }
            });
            window.__agSpAzMo.observe(src, { childList: true, subtree: true, characterData: true });
        } catch (e) {}
    }
    // stavové hlášky z #info („Stahuji data…", chyba GPS) — ukázat v bublině na 6 s
    function mirrorInfo() {
        try {
            var src = document.getElementById('info');
            if (!src || window.__agSpInfoMo || typeof MutationObserver === 'undefined') return;
            window.__agSpInfoMo = new MutationObserver(function () {
                var t = (src.textContent || '').replace(/\s+/g, ' ').trim();
                if (!t || t === _msg) return;
                _msg = t; _msgTs = Date.now(); _lastHead = '';
                renderBar();
            });
            window.__agSpInfoMo.observe(src, { childList: true, subtree: true, characterData: true });
        } catch (e) {}
    }
    // vyblednutí HUD po nečinnosti: zrcadlíme .ui-faded z #compass-debug (řeší grafika.js)
    function syncFade() {
        var el = document.getElementById('ag-sp'); if (!el) return;
        if (_open) { el.classList.remove('ui-faded'); return; }   // rozbalený detail nikdy neblednem
        var src = document.getElementById('compass-debug');
        el.classList.toggle('ui-faded', !!(src && src.classList.contains('ui-faded')));
    }
    function mirrorFade() {
        try {
            var src = document.getElementById('compass-debug');
            if (!src || window.__agSpFadeMo || typeof MutationObserver === 'undefined') return;
            window.__agSpFadeMo = new MutationObserver(syncFade);
            window.__agSpFadeMo.observe(src, { attributes: true, attributeFilter: ['class'] });
            syncFade();
        } catch (e) {}
    }
    function watchBattery() {
        if (!navigator.getBattery) return;
        navigator.getBattery().then(function (b) {
            function upd() { _bat = { level: b.level, charging: b.charging }; renderBar(); }
            b.addEventListener('levelchange', upd);
            b.addEventListener('chargingchange', upd);
            upd();
        }).catch(function () {});
    }
    function checkTiles() {
        if (typeof caches === 'undefined') { _tilesCached = false; return; }
        caches.open(TILE_CACHE).then(function (c) { return c.keys(); })
            .then(function (keys) { _tilesCached = keys.length > 10; })
            .catch(function () { _tilesCached = false; });
    }
    function trackFix() {
        // preferuj přesný timestamp fixu z logika.js (window.AGFix, čte ho i gps-trust.js)
        if (window.AGFix && window.AGFix.ts) { _lastFixTs = window.AGFix.ts; return; }
        if (!haveUser()) return;
        if (userLat !== _lastLat || userLng !== _lastLng) { _lastLat = userLat; _lastLng = userLng; _lastFixTs = Date.now(); }
    }

    // ---- život modulu --------------------------------------------------------------------
    var _n = 0;
    function tick() {
        try {
            injectStyles();
            wrapCalib();
            injectSettingsToggle();
            trackFix();
            // rozbalený detail a půl minuty bez doteku → sbalit, ať nestíní ovládání
            if (_open && _openTs && (Date.now() - _openTs) > AUTO_CLOSE_MS) close();
            renderBar();
            if (_open) fitBody();      // lišta i obsah mění výšku i mimo překreslení
            syncFade();
            if ((_n++ % 15) === 0) checkTiles();   // ~1× za 30 s
        } catch (e) {}
    }
    function init() {
        injectStyles();
        watchBattery();
        checkTiles();
        window.addEventListener('online', renderBar);
        window.addEventListener('offline', renderBar);
        // klepnutí mimo bublinu ji zase sbalí
        if (!window.__agSpOutside) {
            window.__agSpOutside = true;
            document.addEventListener('click', function (e) {
                if (!_open) return;
                if (e.target.closest && e.target.closest('#ag-sp')) return;
                close();
            }, true);
        }
        // práce s rozbaleným detailem (rolování, klepnutí) odkládá auto-sbalení
        if (!window.__agSpKeep) {
            window.__agSpKeep = true;
            ['touchstart', 'pointerdown', 'scroll'].forEach(function (evt) {
                document.addEventListener(evt, function (e) {
                    if (!_open) return;
                    try { if (e.target && e.target.closest && e.target.closest('#ag-sp')) _openTs = Date.now(); } catch (err) {}
                }, true);
            });
            window.addEventListener('resize', function () { if (_open) fitBody(); });
        }
        if (!window.__agSpTimer) window.__agSpTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 2000);
        tick();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    window.AGStatusBar = {
        open: function () { if (!_open) { _open = true; _alertTs = 0; _openTs = Date.now(); _lastHead = _lastBody = ''; renderBar(); } },
        close: close,
        refresh: function () { _lastHead = _lastBody = ''; renderBar(); }
    };
})();
