// ===== AR Geodet — MŮSTEK NA JEDNOTNÉ DIALOGY (ODPOJITELNÁ vrstva) ==============
// Appka má vlastní glass dialogy (agAlert/agConfirm/agPrompt z js/vylepseni.js),
// ale jádro i moduly volaly na ~130 místech nativní alert()/confirm() — na iOS
// v PWA režimu vypadají cize (Cancel/OK, jiná typografie) a chovají se
// nepředvídatelně. Tenhle můstek dává bezpečnou náhradu se STEJNÝM voláním:
//   agInfo(text[, title])  — náhrada alert(text); escapuje HTML, \n → <br>
//   agAsk(text[, opts]) → Promise<bool> — náhrada confirm() pro async místa
//   agAskText(text[, opts]) → Promise<string|null> — náhrada prompt()
//   agGuard(text, fn[, opts]) — zeptá se a fn spustí TEPRVE po potvrzení
//
// PROČ NA TOM ZÁLEŽÍ VÍC, NEŽ JAK TO VYPADÁ: Chrome na Androidu při zobrazení
// nativního JS dialogu VYHODÍ STRÁNKU Z FULLSCREENU (dělá to schválně, aby byl
// vidět původ stránky). Uživatel tedy potvrdí smazání a najednou mu naskočí
// adresní řádek uprostřed práce — a fullscreen je v téhle appce záměrná funkce.
//
// agGuard() je tu proto, že confirm() je SYNCHRONNÍ a in-app dialog ne: nejde ho
// jen tak zaměnit uvnitř `if (!confirm(...)) return;`. agGuard vezme zbytek těla
// jako funkci a spustí ho až po potvrzení — bez přepisování zbytku logiky.
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

    // Nahrada prompt(). Vraci Promise: text, nebo null kdyz uzivatel zrusil
    // (stejna dohoda jako u nativniho prompt, takze se staci ptat na === null).
    window.agAskText = window.agAskText || function (msg, opts) {
        opts = opts || {};
        try {
            if (typeof window.agPrompt === 'function') {
                return window.agPrompt({
                    title: opts.title || 'Zadejte hodnotu',
                    message: msg ? esc(msg) : '',
                    value: opts.value != null ? String(opts.value) : '',
                    okText: opts.okText || 'Potvrdit'
                }).then(function (v) { return v == null ? null : String(v); });
            }
        } catch (e) {}
        try { return Promise.resolve(prompt(msg, opts.value != null ? String(opts.value) : '')); }
        catch (e) { return Promise.resolve(null); }
    };

    // "Zeptej se a teprve pak to udelej." Pouziva se misto `if (!confirm(m)) return; ...`
    // tak, ze se zbytek tela zabali do fn. Nevraci nic uzitecneho (dialog je async) -
    // volajici se na vysledek nesmi spolehat, coz u obsluhy klepnuti nikdy nevadi.
    window.agGuard = window.agGuard || function (msg, fn, opts) {
        if (typeof fn !== 'function') return;
        try {
            window.agAsk(msg, opts).then(function (ok) { if (ok) fn(); });
        } catch (e) {
            // kdyby selhal i mustek, at se akce nezdrhne uplne
            try { if (confirm(msg)) fn(); } catch (e2) {}
        }
    };
})();
