// ===== AR Geodet — MŮSTEK NA JEDNOTNÉ DIALOGY (ODPOJITELNÁ vrstva) ==============
// Appka má vlastní glass dialogy (agAlert/agConfirm/agPrompt z js/vylepseni.js),
// ale jádro i moduly volaly na ~130 místech nativní alert()/confirm() — na iOS
// v PWA režimu vypadají cize (Cancel/OK, jiná typografie) a chovají se
// nepředvídatelně. Tenhle můstek dává bezpečnou náhradu se STEJNÝM voláním:
//   agInfo(text[, title])  — náhrada alert(text); escapuje HTML, \n → <br>
//   agAsk(text[, opts]) → Promise<bool> — náhrada confirm() pro async místa
//   agAskText(text[, opts]) → Promise<string|null> — náhrada prompt()
// Nativní prompt() navíc BLOKUJE hlavní vlákno: dokud v něm uživatel píše,
// stojí GPS callbacky, render AR i časovače a po zavření se všechno vysype
// naráz. Proto se mu vyhnout i tam, kde by vzhledově prošel.
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
                return window.agConfirm({ title: opts.title || 'Potvrzení', message: esc(msg), okText: opts.okText, cancelText: opts.cancelText, danger: !!opts.danger });
            }
        } catch (e) {}
        try { return Promise.resolve(confirm(msg)); } catch (e) { return Promise.resolve(false); }
    };

    //   agGet(text[, opts]) → Promise<string|null> — náhrada prompt()
    // Stejná sémantika jako nativní prompt(): potvrzení vrátí (oříznutý) text,
    // zrušení vrátí null. Nativní prompt() je na iOS obzvlášť škodlivý — MRAZÍ
    // kamerový stream, takže po jeho zavření zůstane v AR nehybný obraz
    // (viz komentář v js/zapisnik.js). opts: {title, value, placeholder, okText}
    window.agGet = window.agGet || function (msg, opts) {
        opts = opts || {};
        try {
            if (typeof window.agPrompt === 'function') {
                return window.agPrompt({
                    title: opts.title || 'Zadání', message: esc(msg),
                    value: opts.value, placeholder: opts.placeholder, okText: opts.okText
                });
            }
        } catch (e) {}
        try { return Promise.resolve(prompt(msg, opts.value != null ? opts.value : '')); } catch (e) { return Promise.resolve(null); }
    };

    // agAskText() = DRUHE JMENO pro agGet(). Vzniklo tim, ze na te same veci
    // pracovalo naraz vic vetvi a kazda si nahradu prompt() pojmenovala po svem.
    // Obe jmena tu zustavaji, at nemusime prepisovat desitky volani (a at se
    // priste nerozbije nic, co pocita s jednim z nich).
    window.agAskText = window.agAskText || function (msg, opts) { return window.agGet(msg, opts); };

    // agGuard(text, fn[, opts]) - "zeptej se a teprve pak to udelej".
    // Pouziva se misto `if (!confirm(m)) return; ...`: zbytek tela se zabali do fn.
    // Duvod, proc to vubec je: confirm() je SYNCHRONNI, ale in-app dialog ne, takze
    // ho nejde jen tak zamenit uvnitr te podminky. Nevraci nic uzitecneho (dialog je
    // asynchronni) - volajici se na vysledek nesmi spolehat, coz u obsluhy klepnuti
    // nikdy nevadi.
    window.agGuard = window.agGuard || function (msg, fn, opts) {
        if (typeof fn !== 'function') return;
        try {
            window.agAsk(msg, opts).then(function (ok) { if (ok) fn(); });
        } catch (e) {
            try { if (confirm(msg)) fn(); } catch (e2) {}
        }
    };
})();
