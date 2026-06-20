// ===== AR Geodet — VIDITELNOSTNE-VEDOME UI CASOVACE (odpojitelna vrstva) =======
// Maly sdileny helper: casovace, ktere jen osvezuji UI (kontrola "je modal
// otevreny?", zive prepocty v nastrojich, vzorkovani jasu kamery…), nemaji
// smysl, kdyz je appka na pozadi. Tady se daji vytvorit pres AG.uiInterval()
// a centralne se SAMY pozastavi pri prepnuti na pozadi a probudi po navratu.
//
// POZOR: pouzivat JEN pro kosmetiku / UI. Merici a zaznamove casovace (track-log,
// GNSS kvalita, brutal-gps…) zustavaji na obycejnem setInterval, aby bezely
// i pri zhasnutem displeji (napr. zaznam trasy podel hranice).
//
// API:
//   var h = AG.uiInterval(fn, ms);   // jako setInterval, vraci HANDLE (objekt)
//   AG.clearUiInterval(h);           // jako clearInterval
// Handle je "truthy", takze bezny strazny vzor `if (!_t) _t = AG.uiInterval(...)`
// funguje beze zmeny.
//
// MUSI se nacitat PRED moduly, ktere ho pouzivaji (hned za power-save.js).
// Odstraneni: smaz tento soubor + radky v index.html a sw.js; moduly maji
// fallback na nativni setInterval, takze pojedou dal (jen bez uspavani na pozadi).
// ================================================================================
(function () {
    'use strict';
    window.AG = window.AG || {};
    if (AG.uiInterval) return;   // uz definovano (dvoji nacteni) — nepreptat

    var timers = [];

    function startTimer(t) {
        if (t.id == null && document.visibilityState === 'visible') {
            try { t.id = setInterval(t.fn, t.ms); } catch (e) {}
        }
    }
    function stopTimer(t) {
        if (t.id != null) { try { clearInterval(t.id); } catch (e) {} t.id = null; }
    }

    AG.uiInterval = function (fn, ms) {
        var t = { fn: fn, ms: ms, id: null };
        timers.push(t);
        startTimer(t);
        return t;
    };

    AG.clearUiInterval = function (t) {
        if (!t) return;
        // fallback, kdyby nekdo predal cislo z nativniho setInterval
        if (typeof t === 'number') { try { clearInterval(t); } catch (e) {} return; }
        stopTimer(t);
        var i = timers.indexOf(t);
        if (i >= 0) timers.splice(i, 1);
    };

    try {
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') timers.forEach(startTimer);
            else timers.forEach(stopTimer);
        });
    } catch (e) { /* fail-silent */ }
})();
