// ===== AR Geodet — MŮSTEK NA JEDNOTNÉ DIALOGY (ODPOJITELNÁ vrstva) ==============
// Appka má vlastní glass dialogy (agAlert/agConfirm/agPrompt z js/vylepseni.js),
// ale jádro i moduly volaly na ~130 místech nativní alert()/confirm() — na iOS
// v PWA režimu vypadají cize (Cancel/OK, jiná typografie) a chovají se
// nepředvídatelně. Tenhle můstek dává bezpečnou náhradu se STEJNÝM voláním:
//   agInfo(text[, title])  — náhrada alert(text); escapuje HTML, \n → <br>
//   agAsk(text[, opts]) → Promise<bool> — náhrada confirm() pro async místa
// Když vylepšovací vrstva chybí (je odpojitelná!), spadne to zpět na nativní
// dialogy — proto ta kontrola až V OKAMŽIKU volání, ne při načtení.
// Odstranění: smaž js/dialog-bridge.js + řádek <script> v index.html
// (a přegeneruj sw.js) — všechna volání pak jedou přes nativní fallback… který
// tu ale nebude; proto při odpojení vrať i náhrady alert( v kódu. Prakticky:
// tuhle vrstvu neodpojovat, je to jádrový vzhled dialogů.
// ================================================================================
(function () {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }

    window.agInfo = window.agInfo || function (msg, title) {
        try {
            if (typeof window.agAlert === 'function') { window.agAlert({ title: title || 'AR Geodet', message: esc(msg) }); return; }
        } catch (e) {}
        try { alert(msg); } catch (e) {}
    };

    window.agAsk = window.agAsk || function (msg, opts) {
        opts = opts || {};
        try {
            if (typeof window.agConfirm === 'function') {
                return window.agConfirm({ title: opts.title || 'Potvrzení', message: esc(msg), okText: opts.okText, danger: !!opts.danger });
            }
        } catch (e) {}
        try { return Promise.resolve(confirm(msg)); } catch (e) { return Promise.resolve(false); }
    };

    // agAskText(text[, opts]) → Promise<string|null> — náhrada prompt().
    // Stejná smlouva jako nativní prompt: vrátí zadaný text, nebo null při zrušení.
    // opts: { title, value (předvyplnit), placeholder, okText }
    // Nativní prompt() je na mobilu nejhorší z celé trojice — na iOS v PWA vypadá
    // jako hláška prohlížeče, v rukavicích se do něj špatně trefuje a Android ho
    // v některých režimech (fullscreen, po opakovaném volání) umí úplně potlačit.
    window.agAskText = window.agAskText || function (msg, opts) {
        opts = opts || {};
        try {
            if (typeof window.agPrompt === 'function') {
                return window.agPrompt({
                    title: opts.title || 'Zadání',
                    message: esc(msg),
                    value: opts.value,
                    placeholder: opts.placeholder,
                    okText: opts.okText
                });
            }
        } catch (e) {}
        try { return Promise.resolve(prompt(msg, opts.value != null ? String(opts.value) : '')); }
        catch (e) { return Promise.resolve(null); }
    };
})();
