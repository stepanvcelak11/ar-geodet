// ===== QTRIG — ANDROID: TLAČÍTKO ZPĚT + NABÍDKA INSTALACE (ODPOJITELNÁ vrstva) =====
// NÁLEZ 16. 9. 2026 (průchod appkou v emulaci Androidu — uživatel má jen iPhone):
// appka nikde nepracovala s historií prohlížeče (žádný pushState/popstate). Na
// Androidu má každý telefon tlačítko/gesto ZPĚT — a to v appce na ploše (PWA)
// při prázdné historii APPKU ZAVŘE. Kdo měl otevřené Nástroje nebo kartu bodu
// a stiskl Zpět, aby je zavřel, vypadl z appky. Na iPhonu se to nepozná, tam
// tlačítko Zpět není.
//
// CO TO DĚLÁ:
//   • Jakmile se otevře jakékoli okno (modál, dialog agConfirm, karta bodu,
//     postranní menu, celoobrazovkové okno modulu), přidá se do historie jeden
//     záznam-STRÁŽ. Zpět ho vyzvedne → popstate → zavře se NEJVYŠŠÍ otevřené okno,
//     a pokud je pod ním další, stráž se vrátí. Zavírá se vlastním tlačítkem okna
//     (úklid modulu proběhne), teprve bez něj schováním.
//   • Okno zavřené ručně nechá stráž v historii ležet — další Zpět ji jen tiše
//     sní (nic se nezavře, appka nezmizí). Lepší než vyhodit člověka z appky.
//   • Na hlavní obrazovce (nic otevřené) v appce na ploše: první Zpět řekne
//     „Ještě jednou Zpět zavře appku", druhý do 2,5 s appku opravdu zavře — stejně
//     jako to dělají běžné androidí appky.
// Platí všude (na iPhonu / desktopu tím Zpět v prohlížeči zavírá okna místo odchodu
// ze stránky, což je taky správně); dvojité Zpět pro ukončení jen na Androidu v PWA.
//
// NABÍDKA INSTALACE: Chrome na Androidu pošle `beforeinstallprompt`, když appka
// splní podmínky PWA. Bez posluchače ukáže jen svou nenápadnou lištu, kterou lidi
// přehlédnou. Tady se událost odloží a po minutě v appce (ne hned při startu) se
// jednou zeptáme: „Přidat QTRIG na plochu?" → prompt(). Odmítnutí = klid na 14 dní.
// iPhone tuhle událost nemá (tam je Sdílet → Přidat na plochu), nic se neukáže.
//
// Odstranění: smaž js/android.js + řádek <script> v index.html (a přegeneruj
// sw.js: python scripts/gen_sw_assets.py). Nikdo jiný na modul nesahá.
// ================================================================================
(function () {
    'use strict';
    if (window.AGZpet) return;

    var STAV = { agZpet: 1 };
    // ar-overlay = vrstva AR značek (žádné okno), ms-overlay = pozadí panelu Vrstvy (zavře se s panelem)
    var SKIP = { 'welcome-screen': 1, 'ag-gate': 1, 'ag-login': 1, 'update-banner': 1, 'compass-interference': 1, 'ag-upd-pill': 1, 'quick-toast': 1, 'offline-progress': 1, 'ar-overlay': 1, 'ms-overlay': 1 };
    var EXIT_MS = 2500;
    var _guard = false, _exitTs = 0, _timer = null, _obs = null;

    function android() { return /Android/i.test(navigator.userAgent || ''); }
    function standalone() { try { return !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || !!navigator.standalone; } catch (e) { return false; } }
    function shown(el) {
        try {
            var cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
            var r = el.getBoundingClientRect();
            if (!(r.width > 0 && r.height > 0)) return false;
            // zavřené modály parkují mimo displej (viz index.html) — počítá se jen to, co je vidět
            return r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
        } catch (e) { return false; }
    }
    // Otevřená okna seřazená zdola nahoru: podle z-indexu, při shodě podle pořadí
    // v DOM (později vložené = výš). Dialog agConfirm (.ag-dlg-overlay) je vždy nad vším.
    function zi(el) { try { var z = parseInt(getComputedStyle(el).zIndex, 10); return isFinite(z) ? z : 0; } catch (e) { return 0; } }
    function otevrene() {
        var out = [], dlg = [];
        var nodes;
        try { nodes = document.querySelectorAll('.modal-overlay, .ag-dlg-overlay, [id$="-overlay"], [id$="-modal"], #side-menu.open, #bottom-sheet.open'); } catch (e) { return out; }
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (SKIP[n.id] || !shown(n)) continue;
            if (n.classList.contains('ag-dlg-overlay')) dlg.push(n); else out.push({ el: n, z: zi(n), i: i });
        }
        out.sort(function (a, b) { return (a.z - b.z) || (a.i - b.i); });
        return out.map(function (o) { return o.el; }).concat(dlg);
    }
    function klik(el) { try { el.click(); return true; } catch (e) { return false; } }
    function zavri(el) {
        try {
            if (el.id === 'bottom-sheet') { if (typeof window.closeBottomSheet === 'function') { window.closeBottomSheet(); return; } el.classList.remove('open'); return; }
            if (el.id === 'side-menu') { el.classList.remove('open'); return; }
            // Nastavení nanovo (18. 9. 2026): na stránce Nastavení vede Zpět napřed na první obrazovku
            if (el.id === 'settings-modal' && el.getAttribute('data-page') && typeof window.agSettingsHome === 'function') { window.agSettingsHome(); return; }
            if (el.classList.contains('ag-dlg-overlay')) {   // Zpět = „Zpět/Zrušit", ne potvrzení
                var c = el.querySelector('.ag-dlg-cancel');
                if (c && shown(c)) { klik(c); return; }
                var o = el.querySelector('.ag-dlg-ok'); if (o) { klik(o); return; }
            }
            if (el.classList.contains('modal-overlay') && window.AGModalClose && typeof AGModalClose.close === 'function') { AGModalClose.close(el); return; }
            var b = el.querySelector('.modal-close, [data-close], [id$="-close"], [id$="-zavrit"], button.agp-x, button.ag-x');
            if (b && klik(b)) return;
            var btns = el.querySelectorAll('button');
            for (var i = btns.length - 1; i >= 0; i--) { if (/^\s*(Zavřít|Zpět|Hotovo|OK)\s*$/i.test(btns[i].getAttribute('data-ag-cs') || btns[i].textContent || '')) { klik(btns[i]); return; } }   // data-ag-cs = český originál po překladu (js/jazyky.js)
            el.style.display = 'none';
            el.classList.remove('open', 'on');
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'android-zpet:zavri'); }
    }
    function hlidej() {
        if (_guard) return;
        try { history.pushState(STAV, ''); _guard = true; } catch (e) { /* file:// apod. */ }
    }
    function toast(m) {
        try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { /* nic */ }
        try { if (window.AG && AG.toast) return AG.toast(m); } catch (e) { /* nic */ }
    }

    window.addEventListener('popstate', function () {
        _guard = false;
        var o = otevrene();
        if (o.length) {
            zavri(o[o.length - 1]);
            // zbylo něco pod tím? stráž zpátky (až po zavření, ať se nepočítá právě zavírané)
            setTimeout(function () { if (otevrene().length) hlidej(); }, 80);
            return;
        }
        // nic otevřené = hlavní obrazovka
        if (!(android() && standalone())) return;   // v prohlížeči nech Zpět prohlížeči
        var now = Date.now();
        if (now - _exitTs < EXIT_MS) { try { history.back(); } catch (e) { /* nic */ } return; }
        _exitTs = now;
        toast('Ještě jednou Zpět zavře appku.');
        hlidej();
    });

    // Sledování oken: jakmile se něco otevře, stráž. Throttle přes rAF, sleduje se
    // jen style/class (tak se okna otvírají) — žádné procházení DOM při každé změně textu.
    var _pending = false, _later = null;
    function check() {
        _pending = false;
        if (_guard) return;
        if (otevrene().length) { hlidej(); return; }
        // Nastavení/Body/Nástroje/Nový bod se otvírají přechodem opacity 0 → 1 (0,28 s):
        // v okamžiku změny stylu jsou ještě „neviditelné" → podívat se znovu za chvíli
        if (!_later) _later = setTimeout(function () { _later = null; if (!_guard && otevrene().length) hlidej(); }, 400);
    }
    function start() {
        try {
            _obs = new MutationObserver(function () { if (_pending) return; _pending = true; (window.requestAnimationFrame || setTimeout)(check); });
            _obs.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'], subtree: true, childList: true });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'android-zpet:observer'); }
        // v PWA na Androidu drž jednu stráž hned od startu, ať první Zpět neukončí appku bez varování
        if (android() && standalone()) { _timer = setTimeout(hlidej, 1500); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.AGZpet = { otevrene: otevrene, zavri: zavri, _test: { hlidej: hlidej, guard: function () { return _guard; } } };

    // ---- nabídka „Přidat na plochu" ----------------------------------------------------------
    var LS_INST = 'agInstalaceOdlozeno_v1', INST_ODKLAD = 14 * 864e5, INST_ZPOZDENI = 60000;
    var _inst = null, _instTimer = null;
    function instalaceNabidnout() {
        if (!_inst || standalone()) return;
        try { var t = parseInt(localStorage.getItem(LS_INST) || '0', 10); if (t && Date.now() - t < INST_ODKLAD) return; } catch (e) { /* nic */ }
        if (!document.body.classList.contains('app-started')) { _instTimer = setTimeout(instalaceNabidnout, 15000); return; }
        if (otevrene().length) { _instTimer = setTimeout(instalaceNabidnout, 20000); return; }   // nerušit uprostřed práce v okně
        var ask = window.agConfirm;
        if (typeof ask !== 'function') return;
        ask({ title: 'Přidat QTRIG na plochu?', message: 'Spustí se jako appka přes celý displej, má vlastní ikonu a funguje i bez signálu. Jde to kdykoli zrušit jako u každé appky.', okText: 'Přidat', cancelText: 'Teď ne' })
            .then(function (ok) {
                if (!ok) { try { localStorage.setItem(LS_INST, String(Date.now())); } catch (e) { /* nic */ } return; }
                var ev = _inst; _inst = null;
                try { ev.prompt(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'android:prompt'); }
            });
    }
    function bip(e) {
        try { e.preventDefault(); } catch (x) { /* nic */ }
        _inst = e;
        clearTimeout(_instTimer);
        _instTimer = setTimeout(instalaceNabidnout, INST_ZPOZDENI);
    }
    window.addEventListener('beforeinstallprompt', bip);
    // událost, která přišla dřív, než se tenhle (odložený) modul načetl — odchytil ji index.html
    if (window.__agBip) { bip(window.__agBip); window.__agBip = null; }
    window.addEventListener('appinstalled', function () { _inst = null; clearTimeout(_instTimer); toast('QTRIG je na ploše.'); });
    window.AGAndroid = { instalovat: function () { if (_inst) { var ev = _inst; _inst = null; try { ev.prompt(); } catch (e) { /* nic */ } return true; } return false; }, muzeInstalovat: function () { return !!_inst; }, _test: { nabidnout: instalaceNabidnout } };
})();
