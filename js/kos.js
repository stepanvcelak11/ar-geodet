// ===== AR Geodet - KOŠ (odpojitelné: smaž tento řádek v index.html + js/kos.js) =====
// Smazané zakázky a vlastní body se 30 dní drží v koši (localStorage) a dají se obnovit
// v menu „Více" → Koš. Doplňuje undo.js: toast „Vrátit zpět" zmizí za pár vteřin,
// koš zůstává — omylem smazaná zakázka z terénu tak není definitivní ztráta.
// Do koše se NEukládají stažené úřední body (arOfflinePoints12) — jsou velké
// a dají se kdykoli znovu stáhnout z ČÚZK; jen vlastní body, spojnice a nastavení.
// Načítá se PO undo.js (obaluje stejné funkce, obě vrstvy se snesou).

(function () {
    'use strict';

    var KEY = 'agTrash';
    var TTL = 30 * 24 * 3600 * 1000; // 30 dni
    // ⚠⚠ STROP 3. 9. 2026: 15 → 400 ZÁZNAMŮ. Patnáct byla tichá ztráta práce:
    //   hromadné smazání v panelu Body se ptá „Opravdu smazat 25 vybraných bodů?
    //   Obnovit je půjde 30 dní z koše" — jenže do koše se z těch 25 vešlo jen
    //   POSLEDNÍCH 15 a zbytek zmizel nadobro. Změřeno: smazáno 25 bodů, v koši
    //   15 (T110…T124), prvních deset pryč. A u hromadného mazání se toast
    //   „Vrátit zpět" schválně neukazuje, takže koš je tam JEDINÁ záchrana.
    //   Počet se proto řídí velikostí, ne palcem: bod je v koši ~300 B, takže
    //   400 záznamů je pod 150 kB. O skutečnou mez se stará BYTES níž a pojistka
    //   `while (!save(list) …)` na konci push() — kvóta úložiště platila vždycky.
    var MAX = 400;
    // Strop v bajtech (zakázka v koši je o řád větší než bod, takže sám počet
    // nestačí). Přeteče-li, zahazují se NEJSTARŠÍ záznamy — ne ty čerstvě smazané,
    // o které uživatel přišel před minutou a které shání.
    var MAX_BYTES = 1500000;

    function load() { try { var v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
    function purge() { var now = Date.now(); var list = load().filter(function (r) { return now - r.t < TTL; }); save(list); return list; }
    function push(rec) {
        // ⚠⚠ VLASTNI IDENTITA ZAZNAMU. Driv se zaznam v kosi poznaval podle dvojice
        // (cas, typ), jenze `t` je Date.now() s rozlisenim 1 ms a hromadne mazani
        // smaze i tucet bodu za dve milisekundy — na jedno razitko tak pripadalo
        // bezne 4-7 zaznamu. Obnova JEDNOHO bodu pak z kose vymazala VSECHNY se
        // stejnym razitkem: jeden se vratil do zakazky, zbytek zmizel nadobro.
        // A kos je posledni zachrana, protoze u hromadneho mazani se toast
        // „Vratit zpet" schvalne neukazuje (js/grafika.js).
        if (!rec.id) rec.id = 'tr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        var list = purge(); list.push(rec);
        if (list.length > MAX) list = list.slice(list.length - MAX);
        // velikostni strop: zahazuj nejstarsi, dokud se kos vejde do MAX_BYTES
        try {
            while (list.length > 1 && JSON.stringify(list).length > MAX_BYTES) list.shift();
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kos:push'); }
        // plna kvota: zahazuj nejstarsi, dokud se zaznam nevejde (kos nesmi blokovat mazani)
        while (!save(list) && list.length > 1) list.shift();
    }

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kos:toast'); } }

    // primy pristup k ulozisti CIZI (neaktivni) zakazky — getStoredData umi jen aktivni
    function rawGetCustom(projId) {
        var fk = projId + '_arCustomPoints12';
        if (typeof _idbMem !== 'undefined' && (fk in _idbMem)) return Promise.resolve(_idbMem[fk]);
        if (typeof _idbGet === 'function') return Promise.resolve(_idbGet(fk)).then(function (v) { return v != null ? v : localStorage.getItem(fk); }).catch(function () { return localStorage.getItem(fk); });
        return Promise.resolve(localStorage.getItem(fk));
    }
    function rawSetCustom(projId, val) {
        var fk = projId + '_arCustomPoints12';
        if (typeof _idbMem !== 'undefined' && typeof activeProjectId !== 'undefined' && projId === activeProjectId) _idbMem[fk] = val;
        if (typeof _idbSet === 'function') { try { _idbSet(fk, val); return; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kos:rawSetCustom'); } }
        try { localStorage.setItem(fk, val); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kos:rawSetCustom'); }
    }

    // ---- zachyceni mazani -------------------------------------------------------

    function wrapDeletePoint() {
        var orig = window.deleteCustomPoint;
        if (typeof orig !== 'function' || orig._trashWrapped) return;
        window.deleteCustomPoint = function (id) {
            var pt = null, lines = [];
            try {
                if (typeof persistentCustomPoints !== 'undefined') pt = persistentCustomPoints.find(function (p) { return p.id === id; }) || null;
                if (typeof pointLines !== 'undefined') lines = pointLines.filter(function (l) { return l.aId === id || l.bId === id; });
                pt = pt ? JSON.parse(JSON.stringify(pt)) : null;
                lines = JSON.parse(JSON.stringify(lines));
            } catch (e) { pt = null; lines = []; }
            var ret = orig.apply(this, arguments);
            try {
                var stillThere = typeof persistentCustomPoints !== 'undefined' && persistentCustomPoints.some(function (p) { return p.id === id; });
                if (pt && !stillThere) push({ type: 'point', t: Date.now(), projectId: (typeof activeProjectId !== 'undefined' ? activeProjectId : 'default'), point: pt, lines: lines });
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kos:deleteCustomPoint'); }
            return ret;
        };
        window.deleteCustomPoint._trashWrapped = true;
    }

    function wrapDeleteProject() {
        var orig = window.deleteProject;
        if (typeof orig !== 'function' || orig._trashWrapped) return;
        window.deleteProject = function () {
            var rec = null;
            try {
                var pid = activeProjectId;
                var proj = projects.find(function (p) { return p.id === pid; });
                rec = {
                    type: 'project', t: Date.now(), projectId: pid,
                    name: proj ? proj.name : pid,
                    custom: (typeof getStoredData === 'function' ? getStoredData('arCustomPoints12') : null),
                    lines: (typeof getStoredData === 'function' ? getStoredData('arLines12') : null),
                    ls: {}
                };
                ['arFilters12', 'arRadiusMap', 'arRadiusAR', 'arVisSettings12', 'arHeadingOffset'].forEach(function (k) {
                    var v = localStorage.getItem(pid + '_' + k); if (v != null) rec.ls[k] = v;
                });
            } catch (e) { rec = null; }
            var ret = orig.apply(this, arguments);
            try {
                var gone = rec && typeof projects !== 'undefined' && !projects.some(function (p) { return p.id === rec.projectId; });
                if (gone) push(rec);
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kos:deleteProject'); }
            return ret;
        };
        window.deleteProject._trashWrapped = true;
    }

    // ---- obnova -----------------------------------------------------------------

    function restorePoint(rec, done) {
        var targetProj = rec.projectId;
        var projExists = typeof projects !== 'undefined' && projects.some(function (p) { return p.id === targetProj; });
        if (!projExists) targetProj = (typeof activeProjectId !== 'undefined' ? activeProjectId : 'default');
        if (typeof activeProjectId !== 'undefined' && targetProj === activeProjectId) {
            // aktivni zakazka: rovnou do zivych struktur + prekresleni
            try {
                if (!persistentCustomPoints.some(function (p) { return p.id === rec.point.id; })) {
                    persistentCustomPoints.push(rec.point);
                    setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints));
                    arPoints.push(Object.assign({}, rec.point, { hidden: false, element: null, distElement: null }));
                    (rec.lines || []).forEach(function (l) { if (!pointLines.some(function (x) { return x.id === l.id; })) pointLines.push(l); });
                    if (typeof saveLines === 'function') saveLines();
                    if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap();
                    if (typeof renderManageList === 'function') renderManageList();
                    if (typeof updateInfoPanel === 'function') updateInfoPanel();
                    // #18: zapiš obnovu do žurnálu, ať auditní stopa sedí se stavem
                    try { if (window.AGJournal) window.AGJournal.commit({ op: 'restore', id: rec.point.id, after: rec.point, origin: (rec.point.prov && rec.point.prov.origin) || null }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kos:restorePoint'); }
                }
                toast('Bod #' + rec.point.name + ' obnoven' + (projExists ? '' : ' (do aktuální zakázky — původní už neexistuje)') + '.');
            } catch (e) { toast('Obnova bodu se nezdařila.'); }
            done();
        } else {
            // jina zakazka: upravit primo jeji ulozena data
            rawGetCustom(targetProj).then(function (cur) {
                var arr = [];
                try { arr = cur ? JSON.parse(cur) : []; } catch (e) { arr = []; }
                if (!Array.isArray(arr)) arr = [];
                if (!arr.some(function (p) { return p && p.id === rec.point.id; })) arr.push(rec.point);
                rawSetCustom(targetProj, JSON.stringify(arr));
                if (rec.lines && rec.lines.length) {
                    try {
                        var lk = targetProj + '_arLines12';
                        var lcur = []; try { lcur = JSON.parse(localStorage.getItem(lk)) || []; } catch (e) { lcur = []; }
                        rec.lines.forEach(function (l) { if (!lcur.some(function (x) { return x.id === l.id; })) lcur.push(l); });
                        localStorage.setItem(lk, JSON.stringify(lcur));
                    } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kos:restorePoint'); }
                }
                toast('Bod #' + rec.point.name + ' obnoven do zakázky.');
                done();
            });
        }
    }

    function restoreProject(rec, done) {
        try {
            if (projects.some(function (p) { return p.id === rec.projectId; })) { toast('Zakázka s tímto ID už existuje.'); done(); return; }
            projects.push({ id: rec.projectId, name: rec.name });
            localStorage.setItem('arProjectsList', JSON.stringify(projects));
            if (rec.custom != null) rawSetCustom(rec.projectId, rec.custom);
            if (rec.lines != null) { try { localStorage.setItem(rec.projectId + '_arLines12', rec.lines); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kos:restoreProject'); } }
            Object.keys(rec.ls || {}).forEach(function (k) { try { localStorage.setItem(rec.projectId + '_' + k, rec.ls[k]); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'kos:restoreProject'); } });
            if (typeof renderProjectSelect === 'function') renderProjectSelect();
            toast('Zakázka „' + rec.name + '" obnovena (stažené úřední body si stáhni znovu).');
        } catch (e) { toast('Obnova zakázky se nezdařila.'); }
        done();
    }

    // ---- UI ----------------------------------------------------------------------

    function show() {
        var el = document.getElementById('trash-modal');
        if (!el) {
            el = document.createElement('div');
            el.className = 'modal-overlay'; el.id = 'trash-modal'; el.style.zIndex = '100005';
            el.innerHTML = '<div class="modal-content"><h3 style="color:var(--accent); margin-top:0;"><svg class="icon"><use href="#i-trash"/></svg> Koš</h3>'
                + '<p style="font-size:calc(12px * var(--ag-font-scale, 1)); opacity:0.7; margin:4px 0 10px;">Smazané zakázky a body tu zůstávají 30 dní. Stažené úřední body se do koše neukládají (dají se stáhnout znovu).</p>'
                + '<div class="modal-body" id="trash-list"></div>'
                + '<button class="btn btn-secondary" style="margin-top:12px; width:100%;" onclick="document.getElementById(\'trash-modal\').style.display=\'none\'">Zavřít</button></div>';
            document.body.appendChild(el);
        }
        render();
        el.style.display = 'flex';
    }

    function render() {
        var box = document.getElementById('trash-list'); if (!box) return;
        var list = purge().slice().reverse();
        if (!list.length) { box.innerHTML = '<p style="text-align:center; opacity:0.7;">Koš je prázdný.</p>'; return; }
        box.innerHTML = '';
        list.forEach(function (rec) {
            var when = new Date(rec.t).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
            var title = rec.type === 'project' ? ('Zakázka „' + esc(rec.name) + '"') : ('Bod #' + esc(rec.point && rec.point.name || '?'));
            var row = document.createElement('div');
            row.className = 'cp-item';
            row.innerHTML = '<div style="flex:1; min-width:0;"><div class="cp-title">' + title + '</div>'
                + '<div class="cp-coords">smazáno ' + when + (rec.type === 'point' && rec.lines && rec.lines.length ? ' · +' + rec.lines.length + ' spojnic' : '') + '</div></div>'
                + '<div class="cp-actions"><button class="cp-btn cp-btn-edit" title="Obnovit" aria-label="Obnovit bod z koše"><svg class="icon"><use href="#i-download"/></svg></button>'
                + '<button class="cp-btn cp-btn-delete" title="Smazat trvale" aria-label="Smazat bod natrvalo"><svg class="icon"><use href="#i-trash"/></svg></button></div>';
            row.querySelector('.cp-btn-edit').addEventListener('click', function () {
                var fin = function () { removeRec(rec); render(); };
                if (rec.type === 'project') restoreProject(rec, fin); else restorePoint(rec, fin);
            });
            row.querySelector('.cp-btn-delete').addEventListener('click', function () {
                agAsk('Smazat trvale? Tohle už vrátit nepůjde.', { title: 'Smazat z koše', okText: 'Smazat trvale', danger: true }).then(function (ok) {
                    if (!ok) return;
                    removeRec(rec); render();
                });
            });
            box.appendChild(row);
        });
    }

    // Maze se podle vlastniho id (viz push). Zaznamy, ktere v kosi uzivatele uz lezi
    // ze starsi verze, zadne nemaji — u tech se rozlisuje jeste podle id bodu resp.
    // zakazky, at ani ony nemizi po skupinach.
    function removeRec(rec) {
        save(load().filter(function (r) {
            if (rec.id || r.id) return r.id !== rec.id;
            if (r.t !== rec.t || r.type !== rec.type) return true;
            if (r.type === 'point') return !(r.point && rec.point && r.point.id === rec.point.id);
            return r.projectId !== rec.projectId;
        }));
    }

    // Koš BÝVAL položkou menu „Více". Přesunut do Nástrojů: „Více" má být o aplikaci
    // (návod, o aplikaci, sdílení, offline), zatímco obnova smazaného bodu je práce
    // s daty zakázky — tedy nástroj. Navíc se tím zapojí do hledání v Nástrojích.
    function injectMenuBtn() {
        var old = document.getElementById('trash-menu-btn');   // úklid po starší verzi
        if (old && old.parentNode) old.parentNode.removeChild(old);
        if (typeof window.agRegisterFieldTool !== 'function') return;
        window.agRegisterFieldTool({
            id: 'kos', label: 'Koš (smazané)',
            icon: '<svg class="icon"><use href="#i-trash"/></svg>',
            cat: 'Pomůcky', order: 64, onClick: show
        });
    }

    function init() {
        wrapDeletePoint(); wrapDeleteProject(); injectMenuBtn(); purge();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    // field-tools.js (vlastník mřížky) se může načíst po nás → registraci zkusit znovu
    window.addEventListener('load', function () { setTimeout(injectMenuBtn, 600); });
})();
