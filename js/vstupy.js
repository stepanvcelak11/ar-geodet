// ===== AR Geodet — JEDNOTNÉ ČTENÍ ČÍSEL Z FORMULÁŘŮ (ODPOJITELNÁ vrstva) ========
// PROČ: appka je česká a česká klávesnice píše DESETINNOU ČÁRKU. Pole
// <input type="number"> ale podle specifikace drží číslo jen s TEČKOU:
//   • Chrome/Firefox mají lokalizovaný vstup a čárku samy přepíšou,
//   • Safari (a tedy i iPhone v PWA) NE — pole je „badInput" a .value vrátí
//     PRÁZDNÝ ŘETĚZEC. Uživatel vidí v poli „596956,46", appka dostane "" a
//     napíše mu „Vyplňte souřadnice!" u pole, které je viditelně vyplněné.
// Kód to na 38 místech řešil vlastním .replace(',', '.'), na dalších (mj.
// saveCustomPoint — hlavní formulář nového bodu) vůbec.
//
// ŘEŠENÍ: jedna funkce agNum() pro VŠECHNA čísla z formulářů. Snese čárku,
// mezery v tisících (i pevnou U+00A0, kterou vrací toLocaleString), unicode
// minus/pomlčku a prázdný vstup. Pole, do kterých se ručně píší naměřené
// hodnoty, jsou přepnutá na type="text" inputmode="decimal" — tam žádný
// prohlížeč obsah nezahazuje a číselná klávesnice vyjede stejně.
//
// POUŽITÍ:
//   agNum('12,5')            -> 12.5
//   agNum(el)  / agNum('id') -> přečte .value a rozparsuje (NaN když nejde)
//   agNumOk(v)               -> true, když z toho vzešlo konečné číslo
// Načítá se PŘED logika.js, aby ji viděly všechny moduly.
// Odstranění: smaž js/vstupy.js + řádek <script> v index.html (a přegeneruj
// sw.js) — volání agNum() by pak spadla, takže je vrať na parseFloat().
// ================================================================================
(function () {
    'use strict';

    // co všechno umí přijít z klávesnice / schránky místo obyčejného čísla
    var SPACES = /[\s   ']/g;          // mezery vč. pevné a apostrofu (1'234)
    var MINUS = /[−‒–—―]/g;  // unicode minus a pomlčky

    function parse(raw) {
        if (raw == null) return NaN;
        if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
        var s = String(raw).replace(SPACES, '').replace(MINUS, '-');
        if (!s) return NaN;
        // desetinná čárka -> tečka. Když jsou v čísle OBĚ (1.234,56), bereme
        // čárku jako desetinnou a tečky jako oddělovač tisíců.
        if (s.indexOf(',') >= 0) {
            if (s.indexOf('.') >= 0) s = s.replace(/\./g, '');
            s = s.replace(',', '.');
        }
        // zbylé čárky (víc desetinných teček nedává smysl) -> neplatné
        if (s.indexOf(',') >= 0) return NaN;
        var v = parseFloat(s);
        // parseFloat("12abc") vrátí 12 — to je u souřadnic past, chceme celé pole.
        // Rozepsané „312." projde (uživatel ťukne Uložit s tečkou navíc), „12abc" ne.
        if (!isFinite(v) || !/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
        return v;
    }

    // Vstup: číslo, řetězec, element formuláře nebo id elementu.
    function agNum(src) {
        if (src == null) return NaN;
        if (typeof src === 'number' || typeof src === 'string') {
            // řetězec, který je id existujícího pole, čteme jako pole
            if (typeof src === 'string') {
                var byId = null;
                try { byId = document.getElementById(src); } catch (e) {}
                if (byId && 'value' in byId) return parse(byId.value);
            }
            return parse(src);
        }
        if ('value' in src) return parse(src.value);
        return NaN;
    }

    function agNumOk(v) { return typeof v === 'number' && isFinite(v); }

    // Přečte pole a ořízne do rozsahu min/max (ty u type="text" prohlížeč nehlídá).
    function agNumClamp(src, min, max) {
        var v = agNum(src);
        if (!isFinite(v)) return NaN;
        if (min != null && v < min) v = min;
        if (max != null && v > max) v = max;
        return v;
    }

    window.agNum = agNum;
    window.agNumOk = agNumOk;
    window.agNumClamp = agNumClamp;
})();
