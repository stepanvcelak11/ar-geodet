/* CELÁ OBRAZOVKA NA iPHONU — rada „přidej ikonu znovu“ (23. 9. 2026)
 *
 * Na přání („apka není na celou obrazovku, pod Dynamic Islandem je černý pruh“) je
 * v index.html meta apple-mobile-web-app-status-bar-style = black-translucent: kamera
 * a mapa jedou až pod hodiny. JENŽE iOS si tu meta uloží v okamžiku „Přidat na plochu“
 * a u staré ikony dál kreslí neprůhlednou lištu — oprava by se u lidí, co appku už mají
 * na ploše, nikdy neprojevila. Poznáme to tak, že appka běží z plochy (navigator.standalone)
 * na iPhonu s výřezem (výška displeje ≥ 812 bodů), a přesto env(safe-area-inset-top) = 0.
 * Pak JEDNOU poradíme ikonu odebrat a přidat znovu (data zůstávají — jsou vázaná na adresu,
 * ne na ikonu).
 *
 * Odpojitelné: smaž tento soubor + řádek <script> v index.html + položku v sw.js.
 */
(function () {
    'use strict';
    var KEY = 'agCelaObrazovkaRada_v1';

    function insetTop() {
        try {
            var d = document.createElement('div');
            d.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;';
            document.body.appendChild(d);
            var h = d.getBoundingClientRect().height;
            d.remove();
            return h;
        } catch (e) { return -1; }
    }

    function staraIkona() {
        try {
            if (navigator.standalone !== true) return false;           // jen ikona z plochy na iOS
            if (!/iPhone/.test(navigator.userAgent || '')) return false;
            var vys = Math.max(screen.height || 0, screen.width || 0);
            if (vys < 812) return false;                                 // iPhone bez výřezu (SE, 8) — lišta tam nevadí
            return insetTop() === 0;
        } catch (e) { return false; }
    }

    function t(s) { try { return window.AGJazyk && AGJazyk.t ? AGJazyk.t(s) : s; } catch (e) { return s; } }

    function rada() {
        try {
            if (localStorage.getItem(KEY)) return;
            if (!staraIkona()) return;
            localStorage.setItem(KEY, String(Date.now()));
            var msg = t('Appka teď umí jet přes celý displej — i pod hodinami a Dynamic Islandem. iPhone si ale vzhled pamatuje z doby, kdy jsi ikonu přidal na plochu, takže u tvé ikony zůstává nahoře černý pruh.');
            var jak = t('Oprava: podrž ikonu QTRIG → Odstranit aplikaci → Odstranit z plochy, pak v Safari otevři appku a dej Sdílet → Přidat na plochu. Body, zakázky i nastavení zůstanou.');
            // agAlert bere message jako HTML (texty výš žádné < > nemají)
            if (typeof window.agAlert === 'function') window.agAlert({ title: t('Celá obrazovka'), message: msg + '<br><br>' + jak });
            else if (typeof window.agInfo === 'function') window.agInfo(msg + '\n\n' + jak);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cela-obrazovka'); }
    }

    function start() {
        // až appka běží (brána, přihlášení a první dialogy mají přednost)
        var n = 0;
        var tik = setInterval(function () {
            n++;
            if (document.body && document.body.classList.contains('app-started')) { clearInterval(tik); setTimeout(rada, 6000); }
            else if (n > 120) clearInterval(tik);
        }, 1000);
    }

    window.AGCelaObrazovka = { staraIkona: staraIkona, insetTop: insetTop };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
