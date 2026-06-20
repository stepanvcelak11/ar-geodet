// ===== AR Geodet — iOS: tip „Přidat na plochu" (ODPOJITELNÁ vrstva) ==========
// Na iPhonu/iPadu zabírá spodní část displeje LIŠTA prohlížeče (Safari toolbar).
// Tu NELZE odstranit z kódu — jediná cesta k opravdu celé obrazovce je přidat
// appku na plochu (Sdílet → Přidat na plochu) a spouštět ji z ikony (standalone).
// Tento modul proto jen JEDNOU nenápadně poradí, jak na to.
//
// Ukáže se POUZE: na iOS + když appka NEBĚŽÍ ve standalone (tj. v prohlížeči)
// + dokud to uživatel nezavře. Po zavření už se neukáže (localStorage).
//
// Odstranění: smaž js/ios-home-hint.js + řádek <script> v index.html (a v sw.js).
// ============================================================================
(function () {
    'use strict';

    var FLAG = 'agIosHomeHintDismissed';

    function isIOS() {
        var ua = navigator.userAgent || '';
        return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }
    function isStandalone() {
        try { if (window.navigator.standalone === true) return true; } catch (e) {}
        try { if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true; } catch (e2) {}
        return false;
    }
    function dismissed() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return false; } }
    function setDismissed() { try { localStorage.setItem(FLAG, '1'); } catch (e) {} }

    function welcomeUp() {
        var w = document.getElementById('welcome-screen');
        return !!(w && getComputedStyle(w).display !== 'none');
    }

    function injectStyle() {
        if (document.getElementById('agios-style')) return;
        var s = document.createElement('style');
        s.id = 'agios-style';
        s.textContent =
            '#agios-hint{position:fixed;left:50%;transform:translateX(-50%) translateY(8px);'
            + 'bottom:calc(env(safe-area-inset-bottom,0px) + 92px);z-index:9500;width:min(420px,92vw);'
            + 'display:flex;align-items:flex-start;gap:10px;padding:12px 12px 12px 14px;border-radius:14px;'
            + 'border:1px solid var(--glass-border,rgba(255,255,255,.18));background:rgba(14,18,24,.94);'
            + '-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:var(--text,#eef2f6);'
            + 'box-shadow:0 10px 30px rgba(0,0,0,.55);opacity:0;pointer-events:none;'
            + 'transition:opacity .35s ease, transform .35s ease;font:500 13px/1.45 var(--font,system-ui),sans-serif;}'
            + '#agios-hint.on{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto;}'
            + '#agios-hint .agios-ic{flex:0 0 22px;width:22px;height:22px;color:var(--accent,#34d399);margin-top:1px;}'
            + '#agios-hint b{color:var(--accent,#34d399);}'
            + '#agios-hint .agios-x{flex:0 0 auto;margin-left:2px;border:none;background:rgba(255,255,255,.1);color:inherit;'
            + 'width:30px;height:30px;border-radius:50%;font-size:17px;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent;}'
            + '#agios-hint .agios-x:active{background:rgba(255,255,255,.2);}';
        document.head.appendChild(s);
    }

    function show() {
        if (document.getElementById('agios-hint')) return;
        injectStyle();
        var el = document.createElement('div');
        el.id = 'agios-hint';
        el.innerHTML =
            '<span class="agios-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V3"/><path d="M8 7l4-4 4 4"/><rect x="4" y="11" width="16" height="10" rx="2"/></svg></span>'
            + '<div>Spodní <b>lišta prohlížeče</b> ukrajuje displej. Pro <b>celou obrazovku</b> klepni dole na <b>Sdílet</b> a zvol <b>„Přidat na plochu"</b> — pak appku spouštěj z ikony.</div>'
            + '<button class="agios-x" aria-label="Zavřít">×</button>';
        document.body.appendChild(el);
        el.querySelector('.agios-x').addEventListener('click', function () {
            setDismissed();
            el.classList.remove('on');
            setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
        });
        // doběhne přechod (z display:none by transition nenaskočila — používáme jen opacity)
        requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('on'); }); });
    }

    function maybeShow() {
        if (!isIOS() || isStandalone() || dismissed()) return false;
        if (welcomeUp()) return false;     // počkej, až uživatel projde úvodní obrazovku
        show();
        return true;
    }

    function init() {
        if (!isIOS() || isStandalone() || dismissed()) return;
        // Zkoušej, dokud uživatel není v appce (úvodní obrazovka pryč), max ~2 min.
        var tries = 0;
        var iv = setInterval(function () {
            tries++;
            if (maybeShow() || tries > 240) clearInterval(iv);
        }, 500);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
