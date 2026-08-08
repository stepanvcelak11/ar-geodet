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
    var MAX = 15;

    function load() { try { var v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
    function purge() { var now = Date.now(); var list = load().filter(function (r) { return now - r.t < TTL; }); save(list); return list; }
    function push(rec) {
        var list = purge(); list.push(rec);
        if (list.length > MAX) list = list.slice(list.length - MAX);
        // plna kvota: zahazuj nejstarsi, dokud se zaznam nevejde (kos nesmi blokovat mazani)
        while (!save(list) && list.length > 1) list.shift();
    }

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }

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
        if (typeof _idbSet === 'function') { try { _idbSet(fk, val); return; } catch (e) {} }
        try { localStorage.setItem(fk, val); } catch (e) {}
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
            } catch (e) {}
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
            } catch (e) {}
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
                    try { if (window.AGJournal) window.AGJournal.commit({ op: 'restore', id: rec.point.id, after: rec.point, origin: (rec.point.prov && rec.point.prov.origin) || null }); } catch (e) {}
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
                    } catch (e) {}
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
            if (rec.lines != null) { try { localStorage.setItem(rec.projectId + '_arLines12', rec.lines); } catch (e) {} }
            Object.keys(rec.ls || {}).forEach(function (k) { try { localStorage.setItem(rec.projectId + '_' + k, rec.ls[k]); } catch (e) {} });
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
                + '<div class="cp-actions"><button class="cp-btn cp-btn-edit" title="Obnovit"><svg class="icon"><use href="#i-download"/></svg></button>'
                + '<button class="cp-btn cp-btn-delete" title="Smazat trvale"><svg class="icon"><use href="#i-trash"/></svg></button></div>';
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

    function removeRec(rec) { save(load().filter(function (r) { return !(r.t === rec.t && r.type === rec.type); })); }

    function injectMenuBtn() {
        var scroll = document.querySelector('#side-menu .menu-scroll');
        if (!scroll || document.getElementById('trash-menu-btn')) return;
        var btn = document.createElement('button');
        btn.className = 'menu-btn'; btn.id = 'trash-menu-btn';
        btn.innerHTML = '<svg class="icon"><use href="#i-trash"/></svg> Koš (smazané)';
        btn.addEventListener('click', function () { show(); if (typeof toggleMenu === 'function') toggleMenu(); });
        var anchor = scroll.querySelector('hr');
        if (anchor) scroll.insertBefore(btn, anchor); else scroll.appendChild(btn);
    }

    function init() {
        wrapDeletePoint(); wrapDeleteProject(); injectMenuBtn(); purge();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
