// ===== AR Geodet — SEMAFOR DŮVĚRY POLOHY (ODPOJITELNÁ vrstva) ===================
// Zamrzlý GPS fix se dřív nedal poznat: watchPosition prostě přestane doručovat
// (tunel, budova, iOS suspend), userLat/currentGpsAccuracy drží poslední hodnotu
// a AR i měření tiše jedou ze STARÉ polohy. Tenhle modul čte window.AGFix
// (timestamp posledního fixu, plní logika.js) a:
//   • drží stav ČERSTVÁ (<6 s) / STARÁ (6–30 s) / ZTRACENÁ (>30 s nebo chyba GPS)
//     + zvlášť OFFLINE (navigator.onLine) — třídy na <body>
//   • ukazuje nenápadný pruh pod horním HUD, jen když něco není v pořádku
//   • při ZTRACENÉ ztlumí AR overlay do šeda (ať je vidět, že značky nejsou živé)
//   • window.agFixState() pro ostatní moduly (brány ukládání)
// Bránu ukládání bodu z GPS průměru drží přímo logika.js (fillAveragedGPS).
//
// NEPLETAT s podobně pojmenovanými vrstvami:
//   • js/gps-semafor.js  — skóre MÍSTA (multipath, geometrie družic) PŘED měřením, dlaždice
//   • js/gps-warn.js     — varování na slabou PŘESNOST (±m) z posledního fixu
//   • tenhle modul       — ČERSTVOST fixu (nechodí-li fixy, čísla i AR lžou beze zvuku)
// Odstranění: smaž js/gps-trust.js + řádek <script> v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agGpsTrustInit) return;
    window.__agGpsTrustInit = true;

    var FRESH_MS = 6000, LOST_MS = 30000;
    var STYLE_ID = 'ag-gpst-style', BAR_ID = 'ag-gpst-bar';
    var _lastState = null;
    var _dismissed = null;   // klic stavu ('off'/'stale'/'lost'), ktery uzivatel zavrel krizkem

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + BAR_ID + '{position:fixed;left:50%;transform:translateX(-50%);',
            '  top:calc(env(safe-area-inset-top,0px) + 44px);z-index:12000;display:none;',
            '  align-items:center;gap:7px;padding:6px 14px;border-radius:999px;',
            '  font:600 12.5px/1.2 var(--font-ui,system-ui),sans-serif;color:#fff;',
            '  border:1px solid rgba(255,255,255,0.22);box-shadow:0 4px 16px rgba(0,0,0,0.45);',
            '  pointer-events:none;max-width:88vw;text-align:center;}',
            '#' + BAR_ID + '.show{display:flex;}',
            '#' + BAR_ID + ' .dot{width:9px;height:9px;border-radius:50%;flex:0 0 9px;background:#fff;}',
            // krizek na zavreni: jediny klikaci prvek (rodic ma pointer-events:none, at pruh neblokuje AR)
            // akcni tlacitko (Zkusit znovu / Jak povolit) — take musi byt klikaci
            '#' + BAR_ID + ' .act{pointer-events:auto;appearance:none;-webkit-appearance:none;border:1px solid rgba(255,255,255,0.45);',
            '  background:rgba(255,255,255,0.16);color:#fff;border-radius:999px;padding:4px 11px;min-height:30px;',
            '  font:700 12px/1 var(--font-ui,system-ui),sans-serif;cursor:pointer;white-space:nowrap;}',
            '#' + BAR_ID + ' .x{pointer-events:auto;appearance:none;-webkit-appearance:none;border:0;margin:-2px -6px -2px 0;',
            '  background:rgba(255,255,255,0.18);color:#fff;width:22px;height:22px;border-radius:50%;flex:0 0 22px;',
            '  font:700 14px/22px var(--font-ui,system-ui),sans-serif;padding:0;cursor:pointer;text-align:center;}',
            'body.ag-fix-stale #' + BAR_ID + '{background:rgba(146,94,7,0.92);}',
            'body.ag-fix-lost #' + BAR_ID + '{background:rgba(140,28,28,0.94);}',
            'body.ag-fix-lost #' + BAR_ID + ' .dot{animation:ag-gpst-pulse 1s infinite;}',
            'body.ag-net-off:not(.ag-fix-stale):not(.ag-fix-lost) #' + BAR_ID + '{background:rgba(50,58,70,0.92);}',
            '@keyframes ag-gpst-pulse{0%,100%{opacity:1;}50%{opacity:0.25;}}',
            // okraj panelu presnosti podle stavu (vidi ho i kdo si pruhu nevsimne)
            'body.ag-fix-stale #gps-avg{border-color:rgba(235,170,50,0.85)!important;}',
            'body.ag-fix-lost #gps-avg{border-color:rgba(239,68,68,0.95)!important;}',
            // ztracena poloha: AR znacky zsednou — jasny signal, ze NEJSOU zive
            'body.ag-fix-lost #ar-overlay{filter:grayscale(1) brightness(0.8);opacity:0.55;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function ensureBar() {
        var b = document.getElementById(BAR_ID);
        if (!b) {
            b = document.createElement('div');
            b.id = BAR_ID;
            b.innerHTML = '<span class="dot"></span><span class="txt"></span>'
                + '<button type="button" class="act" style="display:none;"></button>'
                + '<button type="button" class="x" aria-label="Zavřít upozornění">×</button>';
            b.querySelector('.x').addEventListener('click', function () {
                _dismissed = b.getAttribute('data-key') || null;
                b.classList.remove('show');
            });
            // Akce i ve fallbacku (bez js/upozorneni.js) — jinak by odpojeni centra
            // upozorneni tise sebralo jedinou cestu, jak se z chyby GPS dostat.
            b.querySelector('.act').addEventListener('click', function () {
                var fn = b._agAction;
                if (typeof fn === 'function') fn();
            });
            document.body.appendChild(b);
        }
        return b;
    }

    function computeState() {
        var fx = window.AGFix;
        if (!fx || !fx.ts) return { state: (fx && fx.err) ? 'lost' : 'unknown', ageMs: null, acc: null };
        var age = Date.now() - fx.ts;
        // chyba GPS novejsi nez posledni fix = fixy prestaly chodit kvuli chybe
        if (fx.err && fx.errTs && fx.errTs > fx.ts && age > FRESH_MS) return { state: 'lost', ageMs: age, acc: fx.acc };
        if (age > LOST_MS) return { state: 'lost', ageMs: age, acc: fx.acc };
        if (age > FRESH_MS) return { state: 'stale', ageMs: age, acc: fx.acc };
        return { state: 'fresh', ageMs: age, acc: fx.acc };
    }
    window.agFixState = computeState;

    function fmtAge(ms) {
        if (ms == null) return '';
        var s = Math.round(ms / 1000);
        return s < 120 ? (s + ' s') : (Math.round(s / 60) + ' min');
    }

    // ---- ZOTAVENI Z CHYBY GPS ------------------------------------------------------
    // Driv se chyba GPS jen vypsala do #info a tim to skoncilo: kdo omylem odmitl
    // pristup k poloze, videl vetu bez jedineho tlacitka a appka uz se o fix
    // nepokusila. Navic #info cisti az PRVNI uspesny fix (updateInfoPanel), takze
    // pri zakazane poloze tam ta hlaska zustala viset navzdy.
    var DENIED = 1;   // GeolocationPositionError.PERMISSION_DENIED

    function errCode() {
        var fx = window.AGFix;
        if (!fx || !fx.err) return 0;
        // chyba je aktualni jen kdyz je novejsi nez posledni platny fix
        if (fx.ts && fx.errTs && fx.errTs <= fx.ts) return 0;
        return fx.err;
    }

    function toast(m) { try { if (typeof window.quickToast === 'function') quickToast(m); } catch (e) {} }

    // Tvrdy restart GPS watchu. Umi ho jen js/power-save.js — jedine misto, ktere
    // drzi seznam zivych watchu i jejich callbacky (logika.js si handle neschovava).
    function retryGps() {
        var ok = false;
        try { ok = !!(window.AGPowerGps && window.AGPowerGps.restart()); } catch (e) {}
        // at uzivatel hned vidi, ze se neco deje: vynutime i nove jednorazove mereni
        try {
            if (navigator.geolocation && navigator.geolocation.getCurrentPosition) {
                navigator.geolocation.getCurrentPosition(function () {}, function () {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
            }
        } catch (e) {}
        _dismissed = null;   // po rucnim pokusu chceme stav zase videt
        toast(ok ? 'Zkouším znovu chytit GPS — vyjdi pod otevřené nebe a chvíli počkej.'
                 : 'GPS se nepodařilo restartovat. Zkus appku zavřít a otevřít znovu.');
    }

    // Napoveda k povoleni polohy. Kroky se lisi podle systemu, tak at uzivatel
    // nemusi hledat — a rovnou pripomeneme, ze po povoleni staci klepnout na Zkusit znovu.
    function explainDenied() {
        var ua = navigator.userAgent || '';
        var ios = /iPhone|iPad|iPod/i.test(ua);
        var steps = ios
            ? 'Nastavení → Soukromí a zabezpečení → Polohové služby → zapnout, '
              + 'pak najít Safari (nebo AR Geodet, když ho máš na ploše) → Při používání aplikace.'
            : 'Nastavení telefonu → Aplikace → prohlížeč / AR Geodet → Oprávnění → Poloha → Povolit. '
              + 'V Chromu jde poloha povolit i klepnutím na ikonu zámku vlevo od adresy.';
        var msg = 'Aplikace nemá přístup k poloze, takže nemůže měřit ani navigovat na body.\n\n'
                + steps + '\n\nPotom se sem vrať a klepni na „Zkusit znovu".';
        try {
            if (typeof window.agInfo === 'function') { window.agInfo(msg, 'Poloha je zakázaná'); return; }
        } catch (e) {}
        try { alert(msg); } catch (e) {}
    }

    function tick() {
        try {
            injectStyles();
            var started = document.body && document.body.classList.contains('app-started');
            var off = (typeof navigator.onLine === 'boolean') ? !navigator.onLine : false;
            var st = computeState();
            document.body.classList.toggle('ag-net-off', off);
            document.body.classList.toggle('ag-fix-stale', started && st.state === 'stale');
            document.body.classList.toggle('ag-fix-lost', started && st.state === 'lost');
            var bar = ensureBar();
            var txt = null, key = null, shortTxt = null, action = null;
            var ec = errCode();
            // txt = dlouhy text do vlastniho pruhu (fallback), shortTxt = do sloupce
            // upozorneni (tam je misto na jeden radek a detail otevre klepnuti),
            // action = co se stane po klepnuti na hlasku (zotaveni, ne jen konstatovani)
            if (started && ec === DENIED) {
                // ZAKAZANA POLOHA je jina liga nez slaby signal: cekanim se nespravi,
                // uzivatel musi zasahnout v nastaveni telefonu. Proto vlastni vetev
                // a napoveda misto obecneho „GPS ztracena".
                key = 'denied';
                txt = 'Poloha je zakázaná — appka nemůže měřit ani navigovat. Klepni pro návod, jak ji povolit.';
                shortTxt = 'Poloha je zakázaná — klepni pro návod';
                action = explainDenied;
            }
            else if (started && st.state === 'lost') { key = 'lost'; txt = 'GPS ztracena ' + (st.ageMs != null ? fmtAge(st.ageMs) : '') + ' — poloha i AR ukazují POSLEDNÍ známé místo'; shortTxt = 'GPS ztracena ' + (st.ageMs != null ? fmtAge(st.ageMs) : '') + ' — klepni pro nový pokus'; action = retryGps; }
            else if (started && st.state === 'stale') { key = 'stale'; txt = 'GPS bez čerstvého fixu ' + fmtAge(st.ageMs) + ' — poloha může být posunutá'; shortTxt = 'GPS bez fixu ' + fmtAge(st.ageMs) + ' — poloha může být posunutá'; }
            else if (started && off) { key = 'off'; txt = 'Offline — mapa a katastr jen z uložených dat, měření GPS funguje'; shortTxt = 'Offline — jen uložená data, měření funguje'; }
            // krizek zavre pruh pro AKTUALNI stav; kdyz vse pomine, dismiss se resetuje,
            // aby se pristi problem zase ukazal (jina zavada nez zavrena se ukaze hned)
            if (!key) _dismissed = null;
            bar.setAttribute('data-key', key || '');
            // Centrum upozorneni (js/upozorneni.js) = jednotny sloupec nahore. Kdyz
            // neni nactene, vykresli se puvodni vlastni pruh (fallback, odpojitelnost).
            var C = (window.AGNotify && typeof window.AGNotify.set === 'function') ? window.AGNotify : null;
            if (C) {
                bar.classList.remove('show');
                // Offline je JINA vec nez stav fixu, proto vlastni id: kdyby sdilelo
                // 'gps-fix', potlacilo by v centru hlasku o slabe presnosti (SUPPRESS).
                var nid = (key === 'off') ? 'net-off' : 'gps-fix';
                C.clear(nid === 'gps-fix' ? 'net-off' : 'gps-fix');
                if (txt && key !== _dismissed) {
                    C.set(nid, {
                        level: (key === 'lost' || key === 'denied') ? 'danger' : (key === 'stale' ? 'warn' : 'info'),
                        text: shortTxt || txt,
                        // action = pojmenovane tlacitko primo v radku (jasnejsi nez
                        // klepnuti na text), onAction = tentyz krok pri klepnuti na radek
                        action: action ? { label: (key === 'denied') ? 'Jak povolit' : 'Zkusit znovu', fn: action } : null,
                        onAction: action || undefined,
                        onDismiss: (function (k) { return function () { _dismissed = k; }; })(key)
                    });
                } else C.clear(nid);
            }
            else if (txt && key !== _dismissed) {
                bar.querySelector('.txt').textContent = txt;
                var ab = bar.querySelector('.act');
                bar._agAction = action;
                if (action) { ab.textContent = (key === 'denied') ? 'Jak povolit' : 'Zkusit znovu'; ab.style.display = ''; }
                else ab.style.display = 'none';
                bar.classList.add('show');
            }
            else bar.classList.remove('show');
            // prechodova hlaska jen pri zhorseni (fresh->stale/lost), at to nepipa porad
            if (started && _lastState === 'fresh' && st.state === 'lost' && typeof window.quickToast === 'function') {
                try { quickToast('Ztracen signál GPS — měření pozastavte, než se vrátí čerstvý fix.'); } catch (e) {}
            }
            if (started) _lastState = st.state;
        } catch (e) {}
    }

    function init() {
        tick();
        if (!window.__agGpstTimer) window.__agGpstTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1000);
        window.addEventListener('online', tick);
        window.addEventListener('offline', tick);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
