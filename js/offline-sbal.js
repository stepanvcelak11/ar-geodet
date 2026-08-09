// ===== AR Geodet — OFFLINE: CO POTŘEBUJE SÍŤ, JDE DO SBALENÉ ZÁLOŽKY ============
// PROČ (na přání): v terénu bez signálu zabírala půlka Nástrojů věci, které bez
// internetu nic neudělají (katastr online, stažení bodů, počasí, zpravodaj, firemní
// cloud…). Vypadaly stejně jako použitelné dlaždice, jen zprava „zbarvené" a šedé —
// a člověk je pořád přeskakoval očima. S internetem naopak nesmí být VŮBEC nic jinak.
//
// CO TO DĚLÁ: jakmile je appka offline, přesune tyhle dlaždice do jedné vlastní
// kategorie na konci mřížky Nástrojů:
//     „⛅ VYŽADUJE INTERNET — TEĎ OFFLINE"
// a nechá ji SBALENOU (rozklepnutím se dá dostat ke všemu — část nástrojů umí sáhnout
// do cache, takže zákaz by byl přehnaný). Po připojení se dlaždice vrátí přesně tam,
// odkud přišly, a záložka zmizí.
//
// JAK to nekoliduje se sekcemi ★ Oblíbené / ◆ Pro tuto práci a s hledáním: sbalení
// NEDĚLÁ tenhle modul — používá se ROVNOU mechanika js/field-tools.js (nadpis
// s .ag-ft-head + název v localStorage agToolCatsClosed_v1). O skrývání dlaždic pak
// dál rozhoduje applyFilter() field-tools: při hledání sbalení ignoruje (co si člověk
// vyhledá, to najde) a po každém přidání dlaždice se stav obnoví sám.
// Dlaždice v ★ Oblíbených se ZÁMĚRNĚ nepřesouvají — když si je tam člověk dal, chce
// je mít po ruce, i kdyby zrovna nefungovaly.
//
// Odstranění: smaž js/offline-sbal.js + jeho řádek <script> v index.html a v sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGOffline) return;

    var HEAD_ID = 'ag-net-head';
    var HEAD_TXT = 'Vyžaduje internet — teď offline';
    var COLL_KEY = 'agToolCatsClosed_v1';   // MUSÍ souhlasit s js/field-tools.js
    var MARK = 'data-agnet';                // odkud dlaždice přišla (pro návrat)

    // Dlaždice (data-tool id nebo název otevírací funkce z onclick), které bez sítě
    // buď neudělají nic, nebo jen ukážou poslední stažená data. Klíč se shoduje
    // s tileKey() ve field-tools.js / nastroje-ukony.js.
    // Seznam je v js/tools-registry.js jako příznak `net: 1` u nástroje. Bez registru
    // se bez sítě nic nepřerovnává — dlaždice zůstanou, kde byly.
    function needsNetKey(k) { return !!(k && window.AGReg && window.AGReg.isNet(k)); }

    function grid() {
        var m = document.getElementById('tools-modal');
        return m ? m.querySelector('.tool-grid') : null;
    }
    function tileKey(t) {
        var dt = t.getAttribute('data-tool');
        if (dt) return dt;
        var ms = (t.getAttribute('onclick') || '').match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function isOffline() { try { return navigator.onLine === false; } catch (e) { return false; } }

    function setClosed(on) {
        try {
            var a = JSON.parse(localStorage.getItem(COLL_KEY));
            if (!Array.isArray(a)) a = [];
            var ix = a.indexOf(HEAD_TXT);
            if (on && ix === -1) a.push(HEAD_TXT);
            if (!on && ix !== -1) a.splice(ix, 1);
            localStorage.setItem(COLL_KEY, JSON.stringify(a));
        } catch (e) {}
    }

    function ensureHead(g) {
        var h = document.getElementById(HEAD_ID);
        if (h) { if (h.parentNode !== g) g.appendChild(h); return h; }
        h = document.createElement('div');
        h.id = HEAD_ID;
        h.className = 'ag-ft-head ag-cat-closed';
        h.textContent = HEAD_TXT;          // textContent — nadpis se hledá podle textu
        g.appendChild(h);
        return h;
    }

    // ---- přesun do záložky --------------------------------------------------------
    function collapse() {
        var g = grid(); if (!g) return;
        var tiles = g.querySelectorAll('.tool-tile');
        var move = [], i, t, k;
        for (i = 0; i < tiles.length; i++) {
            t = tiles[i];
            if (t.hasAttribute(MARK)) continue;                  // už přesunuto
            k = tileKey(t);
            if (!needsNetKey(k)) continue;
            // ★ Oblíbené: dlaždice v sekci oblíbených necháváme na místě
            if (isInFavSection(g, t)) continue;
            move.push(t);
        }
        // Nic nového k přesunu → NESAHAT na stav sbalení. Kdyby se tu volalo
        // setClosed(true) při každém průchodu, zavřelo by to záložku i uživateli,
        // který si ji právě rozklepl (apply() běží po každém otevření Nástrojů).
        if (!move.length) return;
        var head = ensureHead(g);
        move.forEach(function (tile) {
            // kam se má vrátit: index mezi dětmi mřížky stačí (mřížka se nepřestavuje,
            // syncTiles je inkrementální) — ukládá se id následující dlaždice/nadpisu
            var nx = tile.nextElementSibling;
            tile.setAttribute(MARK, nx ? (nodeRef(nx) || '') : '');
            g.appendChild(tile);
        });
        setClosed(true);
        head.classList.add('ag-cat-closed');
        try { if (typeof window.agFilterTools === 'function') window.agFilterTools(); } catch (e) {}
    }

    // odkaz na sousední prvek: data-tool je stabilní, u nadpisu bereme jeho text
    function nodeRef(n) {
        var dt = n.getAttribute && n.getAttribute('data-tool');
        if (dt) return 'tool:' + dt;
        if (n.classList && (n.classList.contains('tool-cat') || n.classList.contains('ag-ft-head'))) {
            return 'head:' + (n.textContent || '').trim();
        }
        var oc = n.getAttribute && n.getAttribute('onclick');
        return oc ? 'oc:' + oc : '';
    }
    function findRef(g, ref) {
        if (!ref) return null;
        var kids = g.children, i, n;
        for (i = 0; i < kids.length; i++) {
            n = kids[i];
            if (nodeRef(n) === ref) return n;
        }
        return null;
    }
    function isInFavSection(g, tile) {
        // projdi dozadu k nejbližšímu nadpisu; ★ Oblíbené má id ag-fav-head
        var n = tile.previousElementSibling;
        while (n) {
            if (n.classList && (n.classList.contains('tool-cat') || n.classList.contains('ag-ft-head'))) {
                return n.id === 'ag-fav-head';
            }
            n = n.previousElementSibling;
        }
        return false;
    }

    // ---- návrat po připojení ------------------------------------------------------
    function restore() {
        var g = grid(); if (!g) return;
        var moved = g.querySelectorAll('[' + MARK + ']');
        for (var i = 0; i < moved.length; i++) {
            var t = moved[i], ref = t.getAttribute(MARK);
            t.removeAttribute(MARK);
            var before = findRef(g, ref);
            if (before) g.insertBefore(t, before); else g.appendChild(t);
        }
        var h = document.getElementById(HEAD_ID);
        if (h) h.remove();
        setClosed(false);
        try { if (typeof window.agFilterTools === 'function') window.agFilterTools(); } catch (e) {}
    }

    function apply() {
        if (!grid()) return;
        if (isOffline()) collapse(); else restore();
    }

    // ---- pruh v „Nástrojích" + reakce na změnu stavu sítě --------------------------
    var _t = null;
    function schedule() { if (_t) clearTimeout(_t); _t = setTimeout(function () { _t = null; apply(); }, 250); }

    window.addEventListener('online', schedule);
    window.addEventListener('offline', schedule);
    // Nástroje se otevírají opakovaně a dlaždice do mřížky dopadají postupně
    // (lazy-tools, moduly po loadu, rozcestníky tools-hub) → stav dorovnat po každém
    // otevření okna. Okno nemá otevírací funkci, dlaždice v doku ho zapíná inline
    // (`getElementById('tools-modal').style.display='flex'`), takže se hlídá VIDITELNOST
    // #tools-modal — to je odolné vůči tomu, odkud se okno otevřelo (dok, hledání, hub).
    var _wasOpen = false;
    function watchOpen() {
        var m = document.getElementById('tools-modal');
        var open = !!(m && m.style.display === 'flex');
        if (open && !_wasOpen) schedule();
        _wasOpen = open;
    }
    (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(watchOpen, 700);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
    else schedule();
    window.addEventListener('load', function () { setTimeout(apply, 900); setTimeout(apply, 2500); });

    window.AGOffline = {
        apply: apply,
        needsNet: needsNetKey,
        list: function () {
            var out = [], all = (window.AGReg && window.AGReg.all()) || [];
            for (var i = 0; i < all.length; i++) { if (all[i].net) out.push(all[i].k); }
            return out;
        }
    };
})();
