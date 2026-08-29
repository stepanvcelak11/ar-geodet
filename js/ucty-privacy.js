// ===== AR Geodet — SOUKROMÍ ADMINA PŘED VEDENÍM (ODPOJITELNÁ vrstva) ===========
// Na přání: „ať člověk určený jako vedení nevidí, co dělá admin — nevidí jeho aktivitu."
//
// V administraci firmy jsou dvě sekce, které ukazují, kdo co kdy dělal:
//   • Užívání (dashboard)  — přihlášení, otevřené nástroje, přidané/upravené body,
//                            odhad odpracované doby, hodiny přes den, po uživatelích
//   • Docházka             — párování příchodů a odchodů, kde se píchlo, s kým, co se dělalo
// Obě čtou TÝŽ zdroj: události užívání (`AGUcty.usageQuery` lokálně / `/usage` ze
// serveru). Proto se filtruje JEDNO místo — samotný zdroj dat — a obě sekce (i cokoli,
// co nad usage vznikne později) jsou tím pokryté.
//
// PRAVIDLO: kdo NENÍ admin, nevidí události uživatelů s rolí `admin`. Admin vidí vše
// (jinak by nešlo firmu spravovat). V soukromém režimu (bez firmy) se nefiltruje nic.
// Chat se ZÁMĚRNĚ nefiltruje — to je komunikace, ne dohled; kdyby vedení nevidělo
// adminovy zprávy, přestala by firmě fungovat domluva.
//
// JAK: obaluje `AGUcty.usageQuery` a `AGUcty.cloudFetch` (jen cesta /usage). Filtr běží
// až nad odpovědí, takže se nesmaže nic uloženého — jde o ZOBRAZENÍ. Server posílá dál
// všechno; skutečné vynucení na serveru by chtělo roli v tokenu (viz cloud/worker.js),
// tady jde o firemní slušnost, ne o obranu proti útoku. To je vědomé rozhodnutí:
// dashboard je určený pro vedení firmy, ne pro nepřátelské prostředí.
//
// Odstranění: smaž js/ucty-privacy.js + jeho řádek <script> v index.html a v sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGUctyPrivacy) return;

    function U() { return window.AGUcty || null; }

    // množina „koho skrýt" = účty s rolí admin (id i jméno; události nesou u=jméno,
    // docházka navíc uid). Přepočítává se při každém dotazu — role se mění za běhu.
    function adminSet() {
        var u = U(); if (!u) return null;
        var f = null, me = null;
        try { f = u.getFirm(); me = u.currentUser(); } catch (e) { return null; }
        if (!f || !Array.isArray(f.users)) return null;      // bez firmy se nefiltruje
        if (!me) return null;                                 // nepřihlášen → řeší overlay
        if (me.role === 'admin') return null;                 // admin vidí vše
        var ids = {}, names = {}, any = false;
        f.users.forEach(function (x) {
            if (!x || x.role !== 'admin') return;
            if (x.id) ids[x.id] = 1;
            if (x.name) names[String(x.name)] = 1;
            any = true;
        });
        return any ? { ids: ids, names: names } : null;
    }

    function keep(ev, set) {
        if (!ev) return false;
        if (ev.uid && set.ids[ev.uid]) return false;
        if (ev.u && set.names[String(ev.u)]) return false;
        return true;
    }
    function filterEvents(arr) {
        if (!Array.isArray(arr)) return arr;
        var set = adminSet();
        if (!set) return arr;
        return arr.filter(function (ev) { return keep(ev, set); });
    }

    // ---- obalení zdrojů dat ---------------------------------------------------------
    function wrap() {
        var u = U();
        if (!u || u.__privWrapped) return false;

        if (typeof u.usageQuery === 'function') {
            var origQ = u.usageQuery;
            u.usageQuery = function () {
                var r;
                try { r = origQ.apply(this, arguments); } catch (e) { throw e; }
                // usageQuery vrací Promise<events[]>; kdyby v budoucnu vracelo pole
                // přímo, ošetři obojí (jinak by filtr tiše přestal fungovat)
                if (r && typeof r.then === 'function') return r.then(filterEvents);
                return filterEvents(r);
            };
        }

        if (typeof u.cloudFetch === 'function') {
            var origF = u.cloudFetch;
            u.cloudFetch = function (path) {
                var r = origF.apply(this, arguments);
                if (!r || typeof r.then !== 'function') return r;
                if (String(path || '').indexOf('/usage') !== 0) return r;
                return r.then(function (res) {
                    try {
                        if (res && res.ok && res.data && Array.isArray(res.data.events)) {
                            var set = adminSet();
                            if (set) {
                                // kopie objektu odpovědi — ať se nemutuje případná cache volajícího
                                var data = {};
                                Object.keys(res.data).forEach(function (k) { data[k] = res.data[k]; });
                                data.events = res.data.events.filter(function (ev) { return keep(ev, set); });
                                var out = {};
                                Object.keys(res).forEach(function (k) { out[k] = res[k]; });
                                out.data = data;
                                return out;
                            }
                        }
                    } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty-privacy:cloudFetch'); }
                    return res;
                });
            };
        }

        u.__privWrapped = true;
        return true;
    }

    var _tries = 0;
    function init() {
        if (!wrap() && _tries++ < 30) setTimeout(init, 300);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    window.AGUctyPrivacy = {
        // true = tenhle uživatel má skryté adminy (pro případné vysvětlení v UI)
        hidesAdmins: function () { return !!adminSet(); },
        filterEvents: filterEvents
    };
})();
