// ===== AR Geodet — NÁSTROJE PLUS: nápověda „?" + oblíbené nahoře (ODPOJITELNÁ) ====
// Neinvazivní vrstva ve stylu js/field-tools.js: NEEDITUJE logika.js ani grafika.js.
// Co dělá v modálu „Nástroje" (#tools-modal):
//   1) Každá dlaždice dostane badge „?" — klepnutí otevře krátký návod k nástroji
//      (co dělá, jak se používá). Texty jsou v js/tools-registry.js.
//   2) „Oblíbené": tlačítkem ⭐ Upravit oblíbené se zapne režim úprav — hvězdičkou
//      na dlaždici si uživatel vybere nástroje, které se drží ÚPLNĚ NAHOŘE mřížky
//      (vlastní pořadí dle pořadí přidání). Uloženo v localStorage (per zařízení).
// Odstranění: smaž js/tools-plus.js + řádek <script> v index.html (a v sw.js).
// ==================================================================================
(function () {
    'use strict';

    var FAV_KEY = 'agToolFavs_v1';
    var STYLE_ID = 'ag-tp-style';

    // ---- nápovědy k nástrojům -----------------------------------------------------
    // Texty návodů byly dřív tady v tabulce TOOL_HELP. Teď jsou v js/tools-registry.js
    // u záznamu nástroje (pole `help`), spolu s jeho slovesem, kategorií a synonymy —
    // aby se nemohlo stát, co se stalo DronView: dlaždice má id `dronview`, ale návod
    // byl zapsaný pod `openDronView`, takže se u ní „?" nikdy neukázalo.
    //
    // PRAVIDLO ZŮSTÁVÁ: každý NOVÝ nástroj musí mít návod. Bez něj se dlaždice tváří
    // jako hotová, ale uživatel u ní nemá „?" a neví, co s ní. Osvědčená struktura:
    //   <p>k čemu to je a proč (1–2 věty, jazykem geodeta v terénu)</p>
    //   <ol><li>krok za krokem, co uživatel udělá</li></ol>
    //   <p>omezení a na co si dát pozor (přesnost, potřeba internetu, co to neumí)</p>
    // Že nějaký nástroj návod nemá, hlásí scripts/check_tools_registry.py (běží v CI).
    function helpRec(key) { return (window.AGReg && window.AGReg.help(key)) || null; }

    // ---- styly ---------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#tools-modal .tool-tile{position:relative;}',
            // badge je <i> (NE <span>!) — field-tools má pravidlo `#tools-modal .ag-ft-tile span{display:block}`,
            // které by span-badge u terénních nástrojů natvrdo zviditelnilo/roztáhlo
            'i.ag-tp-help{position:absolute;top:4px;right:4px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;',
            '  border-radius:50%;background:rgba(255,255,255,0.08);border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  color:var(--text-muted,#9aa1ac);font:700 12px/1 var(--font-ui,system-ui);font-style:normal;cursor:pointer;z-index:2;}',
            'i.ag-tp-help:active{background:var(--accent-soft,rgba(47,158,116,0.18));color:var(--accent,#2f9e74);}',
            '#tools-modal .tool-tile i.ag-tp-star{position:absolute;top:4px;left:4px;width:24px;height:24px;display:none !important;align-items:center;justify-content:center;',
            '  border-radius:50%;background:rgba(0,0,0,0.35);border:1px solid rgba(251,191,36,0.6);color:#fbbf24;font-size:calc(14px * var(--ag-font-scale, 1));font-style:normal;cursor:pointer;z-index:2;}',
            'body.ag-tp-edit #tools-modal .tool-tile i.ag-tp-star{display:flex !important;}',
            'body.ag-tp-edit #tools-modal .tool-tile{outline:1px dashed var(--glass-border,rgba(255,255,255,0.2));}',
            '#tools-modal .tool-tile i.ag-tp-star.on{background:#fbbf24;color:#1a1205;}',
            '#ag-tp-editbtn{margin:2px 0 10px;width:100%;padding:9px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:transparent;color:var(--text-muted,#9aa1ac);font-size:calc(12.5px * var(--ag-font-scale, 1));font-weight:600;cursor:pointer;}',
            'body.ag-tp-edit #ag-tp-editbtn{background:var(--accent-soft,rgba(47,158,116,0.15));color:var(--accent,#2f9e74);border-color:var(--accent-line,rgba(47,158,116,0.4));}',
            '#ag-fav-head{color:#fbbf24 !important;}',
            // Proužek u dlaždic, které sahají na body zakázky. Tenká linka u SPODNÍ
            // hrany — horní rohy jsou obsazené („?" vpravo, hvězdička vlevo).
            '#tools-modal .tool-tile.ag-tp-w::after{content:"";position:absolute;left:22%;right:22%;bottom:0;height:3px;',
            '  border-radius:3px 3px 0 0;background:var(--accent,#2f9e74);opacity:0.85;pointer-events:none;}',
            'body.outdoor-mode #tools-modal .tool-tile.ag-tp-w::after{opacity:1;height:4px;}',
            // modál nápovědy
            '#ag-tp-hm{position:fixed;inset:0;z-index:1000060;display:none;align-items:center;justify-content:center;background:rgba(4,8,12,0.6);}',
            '#ag-tp-hm.open{display:flex;}',
            '#ag-tp-hm .ag-tp-card{width:min(92vw,420px);max-height:calc(var(--app-vh, 100dvh) * 0.8);overflow:auto;padding:20px;border-radius:18px;',
            '  background:var(--glass-bg,rgba(14,18,24,0.97));border:1px solid var(--glass-border-strong,rgba(255,255,255,0.16));color:var(--text-color,#eceef2);}',
            '#ag-tp-hm h3{margin:0 0 10px;color:var(--accent,#2f9e74);font-size:calc(17px * var(--ag-font-scale, 1));}',
            '#ag-tp-hm p,#ag-tp-hm li{font-size:calc(13.5px * var(--ag-font-scale, 1));line-height:1.55;}',
            '#ag-tp-hm ol{padding-left:20px;margin:8px 0;}',
            '#ag-tp-hm .ag-tp-close{width:100%;margin-top:12px;padding:11px;border:none;border-radius:12px;background:rgba(255,255,255,0.1);color:inherit;font-weight:600;cursor:pointer;}',
            'body.outdoor-mode #ag-tp-hm .ag-tp-card{background:#0a0e1a;border-color:rgba(255,255,255,0.85);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- pomocné --------------------------------------------------------------------
    function getGrid() { var m = document.getElementById('tools-modal'); return m ? m.querySelector('.tool-grid') : null; }
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool');
        if (dt) return dt;
        var oc = tile.getAttribute('onclick') || '';
        var m = oc.match(/(?:^|[;\s])(?:window\.)?(?:if\(window\.)?(ag[A-Za-z]+|open[A-Za-z]+|start[A-Za-z]+)\s*\(/);
        // preferuj známé klíče (první funkce v onclicku je zavření modálu)
        // Registr vrací klíče od NEJDELŠÍHO: kratší klíč umí být kusem delšího
        // („pocasi" je uvnitř „agOpenPocasi"), takže se musí zkoušet dřív ten delší.
        var known = (window.AGReg && window.AGReg.helpKeys()) || [];
        for (var i = 0; i < known.length; i++) { if (oc.indexOf(known[i]) !== -1) return known[i]; }
        return m ? m[1] : null;
    }
    function tileLabel(tile) { var s = tile.querySelector('span'); return s ? s.textContent.replace(/\s+/g, ' ').trim() : (tile.textContent || '').trim(); }
    function loadFavs() { try { var a = JSON.parse(localStorage.getItem(FAV_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function saveFavs(a) { try { localStorage.setItem(FAV_KEY, JSON.stringify(a)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'tools-plus:saveFavs'); } }
    function findTile(key) {
        var grid = getGrid(); if (!grid) return null;
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) { if (tileKey(tiles[i]) === key) return tiles[i]; }
        return null;
    }

    // ---- modál nápovědy ---------------------------------------------------------------
    function ensureHelpModal() {
        var m = document.getElementById('ag-tp-hm');
        if (!m) {
            m = document.createElement('div'); m.id = 'ag-tp-hm';
            m.innerHTML = '<div class="ag-tp-card"><h3 id="ag-tp-hm-t"></h3><div id="ag-tp-hm-b"></div><button type="button" class="ag-tp-close">Zavřít</button></div>';
            m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('open'); });
            m.querySelector('.ag-tp-close').addEventListener('click', function () { m.classList.remove('open'); });
            document.body.appendChild(m);
        }
        return m;
    }
    var BEZ_NAVODU = '<p>Návod pro tento nástroj zatím není. Nástroj otevři a zkus ho — nic se neuloží bez potvrzení.</p>';

    // Těla návodů žijí v data/navody.json a dotahují se až po startu (viz hlavička
    // js/tools-registry.js). Okno se proto otevře HNED (ať klepnutí něco udělá)
    // a text se doplní, jakmile je — obvykle už je v paměti a stihne se to v témže
    // ticku. `data-key` na prvku hlídá, aby rychlé přeťukání na jiný nástroj
    // nepřepsala opožděná odpověď pro ten předchozí.
    function openHelp(key, label) {
        var m = ensureHelpModal();
        var tEl = document.getElementById('ag-tp-hm-t');
        var bEl = document.getElementById('ag-tp-hm-b');
        var rec = helpRec(key);
        tEl.textContent = rec ? rec.t : (label || 'Nástroj');
        bEl.setAttribute('data-key', key || '');
        bEl.innerHTML = rec ? (rec.h || '') : BEZ_NAVODU;
        m.classList.add('open');
        if (rec && !rec.h && window.AGReg && typeof window.AGReg.helpAsync === 'function') {
            window.AGReg.helpAsync(key).then(function (r) {
                if (bEl.getAttribute('data-key') !== (key || '')) return;   // uživatel je jinde
                bEl.innerHTML = (r && r.h) || BEZ_NAVODU;
            }).catch(function () { bEl.innerHTML = BEZ_NAVODU; });
        }
    }
    // Návod umí otevřít i něco, co NENÍ dlaždice v Nástrojích — např. „Poloha z mapy"
    // žije v panelu Mapa a vrstvy (js/poloha-z-mapy.js) a její „?" míří sem. Bez
    // tohohle by záznam v registru existoval, ale uživatel by se k němu nedostal.
    window.agToolHelp = function (key, label) { try { openHelp(key, label); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'tools-plus:agToolHelp'); } };
    // Krátká nápověda jako HOLÝ TEXT (první věty návodu). Používá ji kolečko
    // nástrojů (js/kolecko-nastroju.js): v kolečku není kam dát otazník, tak se
    // u zamířeného nástroje rovnou vypíše, co dělá. Zdroj je TÝŽ registr,
    // takže se texty nemůžou rozejít — jen se zkrátí.
    // MUSÍ ZŮSTAT SYNCHRONNÍ (volá se při tažení prstu, na Promise není kdy).
    // Než se dotáhne data/navody.json, vrátí prázdno a kolečko popisek prostě
    // nezobrazí — AGReg.help() přitom stahování rozjede, takže je to na pár set
    // ms po startu. Návodů je 80 a stahují se jedním souborem.
    window.agToolHelpText = function (key, max) {
        try {
            var rec = helpRec(key);
            if (!rec || !rec.h) return '';
            var d = document.createElement('div');
            d.innerHTML = String(rec.h).replace(/<\/(p|li|ol|ul)>/gi, ' ');
            var t = (d.textContent || '').replace(/\s+/g, ' ').trim();
            var lim = max || 190;
            if (t.length <= lim) return t;
            // Řezat na konci VĚTY, ne uprostřed slova.
            var cut = t.slice(0, lim);
            var dot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
            if (dot > 60) return cut.slice(0, dot + 1);
            var sp = cut.lastIndexOf(' ');
            return (sp > 60 ? cut.slice(0, sp) : cut) + '…';
        } catch (e) { return ''; }
    };

    // ---- badge „?" a hvězdička na dlaždicích -----------------------------------------
    function decorateTiles() {
        var grid = getGrid(); if (!grid) return;
        var tiles = grid.querySelectorAll('.tool-tile');
        // BATERIE: oblíbené načti JEDNOU pro celý průchod. Dřív se loadFavs() (tedy
        // localStorage.getItem + JSON.parse) volalo pro KAŽDOU dlaždici — při ~58
        // dlaždicích a ticku po 1,6 s to bylo ~36 synchronních čtení localStorage
        // za sekundu, natrvalo, i když je modal Nástrojů zavřený.
        var favs = loadFavs();
        for (var i = 0; i < tiles.length; i++) {
            (function (tile) {
                if (!tile.querySelector('.ag-tp-help')) {
                    var b = document.createElement('i');   // <i>, ne <span> — viz komentář u stylů
                    b.className = 'ag-tp-help'; b.textContent = '?';
                    b.setAttribute('role', 'button'); b.setAttribute('aria-label', 'Návod k nástroji');
                    b.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); openHelp(tileKey(tile), tileLabel(tile)); });
                    tile.appendChild(b);
                }
                if (!tile.querySelector('.ag-tp-star')) {
                    var s = document.createElement('i');
                    s.className = 'ag-tp-star'; s.textContent = '★';
                    s.setAttribute('role', 'button'); s.setAttribute('aria-label', 'Oblíbený nástroj');
                    s.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); toggleFav(tile); });
                    tile.appendChild(s);
                }
                var key = tileKey(tile);
                var star = tile.querySelector('.ag-tp-star');
                if (star) star.classList.toggle('on', key != null && favs.indexOf(key) !== -1);

                // PROUŽEK U DLAŽDIC, KTERÉ SAHAJÍ NA BODY. V mřížce se všech 80
                // nástrojů tváří stejně, přitom část z nich jen ukazuje (počasí,
                // předpisy, kompas) a část přidá, posune nebo smaže bod. V terénu
                // se dlaždice otevírají i omylem a z názvu to není poznat.
                // Značí se ZÁMĚRNĚ jen ten úzký okruh (příznak `w` v registru) —
                // kdyby proužek měla většina dlaždic, nic by neříkal.
                if (key != null && window.AGReg && typeof AGReg.isWrite === 'function') {
                    var w = AGReg.isWrite(key);
                    tile.classList.toggle('ag-tp-w', w);
                    // Popisek jen doplňuje; barvu samotnou nesmí nést informace
                    // (venkovní režim, barvoslepost) — proto i title.
                    if (w && !tile.getAttribute('title')) tile.setAttribute('title', 'Ukládá nebo mění body zakázky');
                }
            })(tiles[i]);
        }
    }

    // v režimu úprav klepnutí na dlaždici NÁSTROJ NEOTEVÍRÁ (jen hvězdička/`?`)
    document.addEventListener('click', function (e) {
        if (!document.body.classList.contains('ag-tp-edit')) return;
        var tile = e.target.closest ? e.target.closest('#tools-modal .tool-tile') : null;
        if (!tile) return;
        if (e.target.closest('.ag-tp-star') || e.target.closest('.ag-tp-help')) return;
        e.stopPropagation(); e.preventDefault();
        toggleFav(tile);   // v režimu úprav = klepnutí kamkoli na dlaždici přepne oblíbenost
    }, true);

    // ---- oblíbené ---------------------------------------------------------------------
    function toggleFav(tile) {
        var key = tileKey(tile);
        if (!key) return;
        var favs = loadFavs();
        var idx = favs.indexOf(key);
        if (idx === -1) favs.push(key); else favs.splice(idx, 1);
        saveFavs(favs);
        if (idx !== -1) restoreTile(tile);   // odebráno z oblíbených -> vrátit na původní místo
        applyFavs(); decorateTiles();
    }
    function restoreTile(tile) {
        if (tile.classList.contains('ag-ft-tile')) {
            // injektovaná dlaždice: smazat a nechat field-tools HNED vložit na správné místo
            tile.remove();
            try { if (typeof window.agFtSyncTiles === 'function') window.agFtSyncTiles(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'tools-plus:restoreTile'); }
            return;
        }
        var ph = tile._agTpPh;
        if (ph && ph.isConnected) { ph.parentNode.insertBefore(tile, ph); ph.remove(); tile._agTpPh = null; }
    }
    function applyFavs() {
        var grid = getGrid(); if (!grid) return;
        var favs = loadFavs();
        var head = document.getElementById('ag-fav-head');
        // dohledej dlaždice; hlavičku Oblíbené drž jen když nějaká oblíbená existuje
        var found = [];
        favs.forEach(function (k) { var t = findTile(k); if (t) found.push(t); });
        if (!found.length) { if (head) head.remove(); return; }
        if (!head) {
            head = document.createElement('div');
            head.id = 'ag-fav-head'; head.className = 'tool-cat';
            head.textContent = '★ Oblíbené';
        }
        // Úplný začátek mřížky má pronajatý blok „⚡ Teď se hodí" (usadit-ar.js drží
        // #ag-ua-now-head + #ag-ua-now na grid.firstChild). Oblíbené se řadí AŽ ZA něj —
        // kdyby oba moduly chtěly první místo, přetahují se o něj každý tick a mřížka
        // viditelně přeskakuje (nahlášená závada „neustále se prohazuje, co je nahoře").
        var uaBox = document.getElementById('ag-ua-now');
        var uaAfter = (uaBox && uaBox.parentNode === grid) ? uaBox : null;
        if (head.parentNode !== grid || head.previousSibling !== uaAfter) {
            grid.insertBefore(head, uaAfter ? uaAfter.nextSibling : grid.firstChild);
        }
        var anchor = head;
        found.forEach(function (tile) {
            // statické dlaždici při prvním přesunu nech na původním místě neviditelnou kotvu
            if (!tile.classList.contains('ag-ft-tile') && !tile._agTpPh) {
                var ph = document.createElement('span');
                ph.style.display = 'none'; ph.setAttribute('data-ag-ph', tileKey(tile) || '');
                tile.parentNode.insertBefore(ph, tile);
                tile._agTpPh = ph;
            }
            if (anchor.nextSibling !== tile) grid.insertBefore(tile, anchor.nextSibling);
            anchor = tile;
        });
    }

    // ---- tlačítko režimu úprav ---------------------------------------------------------
    function injectEditButton() {
        var m = document.getElementById('tools-modal'); if (!m) return;
        if (document.getElementById('ag-tp-editbtn')) return;
        // dovnitř .modal-body PŘED mřížku — vedle vyhledávání se překrýval s nadpisem „Měření"
        var body = m.querySelector('.modal-body'); if (!body) return;
        var btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'ag-tp-editbtn';
        btn.innerHTML = '★ Upravit oblíbené (nástroje nahoře)';
        btn.addEventListener('click', function () {
            var on = document.body.classList.toggle('ag-tp-edit');
            btn.innerHTML = on ? '✓ Hotovo — ukončit úpravy' : '★ Upravit oblíbené (nástroje nahoře)';
        });
        body.insertBefore(btn, body.firstChild);
    }
    // při zavření modálu režim úprav vypnout
    function watchModalClose() {
        var m = document.getElementById('tools-modal'); if (!m || m._agTpWatch) return;
        m._agTpWatch = true;
        new MutationObserver(function () {
            if (m.style.display === 'none' && document.body.classList.contains('ag-tp-edit')) {
                document.body.classList.remove('ag-tp-edit');
                var btn = document.getElementById('ag-tp-editbtn');
                if (btn) btn.innerHTML = '★ Upravit oblíbené (nástroje nahoře)';
            }
        }).observe(m, { attributes: true, attributeFilter: ['style'] });
    }

    // ---- údržba (dlaždice se přerenderovávají field-tools modulem) ---------------------
    function tick() {
        try { injectStyles(); injectEditButton(); watchModalClose(); decorateTiles(); applyFavs(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'tools-plus:tick'); }
    }
    function init() {
        tick();
        if (!window.__agTpTimer) window.__agTpTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1600);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });
})();
