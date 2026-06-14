// ===== AR Geodet — VYLEPŠENÍ (UI/UX vrstva) =====================================
// Neinvazivní, ODPOJITELNÁ vrstva ve stylu undo.js / zakazky.js: obaluje globální
// funkce za běhu, NEEDITUJE logika.js ani grafika.js. Načítá se jako POSLEDNÍ skript.
//
// Odstranění celé vrstvy: smaž js/vylepseni.js + css/vylepseni.css a oba řádky se
// značkou "VYLEPŠENÍ" v index.html. Aplikace pak funguje přesně jako předtím.
//
// Obsah:
//   1) In-app dialogy (agPrompt / agConfirm / agAlert) — náhrada nativních prompt/confirm
//   2) Zakázky: hezké dialogy místo prompt()/confirm() + PŘEJMENOVÁNÍ zakázky
//   3) Poctivá přesnost: vysvětlivka + varování o systematické chybě GPS v panelu
//   4) Režim rukavic: přepínač v menu (větší dotykové terče)
//   5) Indikátor zaplnění localStorage v Nastavení
// ================================================================================
(function () {
    'use strict';

    // --------------------------------------------------------------------------------
    // 1) IN-APP DIALOGY
    // --------------------------------------------------------------------------------
    let _ov = null, _resolve = null, _hasInput = false;

    function buildOverlay() {
        if (_ov) return _ov;
        _ov = document.createElement('div');
        _ov.className = 'ag-dlg-overlay';
        _ov.innerHTML =
            '<div class="ag-dlg" role="dialog" aria-modal="true">' +
            '  <h3 class="ag-dlg-title"></h3>' +
            '  <div class="ag-dlg-msg"></div>' +
            '  <input class="ag-dlg-input" type="text" autocomplete="off" autocapitalize="sentences">' +
            '  <div class="ag-dlg-btns">' +
            '    <button type="button" class="ag-dlg-btn ag-dlg-cancel"></button>' +
            '    <button type="button" class="ag-dlg-btn ag-ok ag-dlg-ok"></button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(_ov);

        const input = _ov.querySelector('.ag-dlg-input');
        _ov.querySelector('.ag-dlg-ok').addEventListener('click', function () { finish(true); });
        _ov.querySelector('.ag-dlg-cancel').addEventListener('click', function () { finish(false); });
        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov) finish(false); });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        document.addEventListener('keydown', function (e) {
            if (!_ov.classList.contains('open')) return;
            if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        return _ov;
    }

    function finish(ok) {
        if (!_ov) return;
        const input = _ov.querySelector('.ag-dlg-input');
        const val = _hasInput ? input.value.trim() : true;
        _ov.classList.remove('open');
        const r = _resolve; _resolve = null;
        if (!r) return;
        if (_hasInput) r(ok ? val : null);
        else r(!!ok);
    }

    // opts: { title, message, input(bool), value, placeholder, okText, cancelText, danger }
    function open(opts) {
        opts = opts || {};
        buildOverlay();
        // pokud běží předchozí dialog, zruš jej (nezablokuje se)
        if (_resolve) { const r = _resolve; _resolve = null; r(_hasInput ? null : false); }
        _hasInput = !!opts.input;

        _ov.querySelector('.ag-dlg-title').textContent = opts.title || '';
        _ov.querySelector('.ag-dlg-msg').innerHTML = opts.message || '';

        const input = _ov.querySelector('.ag-dlg-input');
        input.classList.toggle('ag-hide', !_hasInput);
        if (_hasInput) {
            input.value = opts.value != null ? String(opts.value) : '';
            input.placeholder = opts.placeholder || '';
        }

        const ok = _ov.querySelector('.ag-dlg-ok');
        const cancel = _ov.querySelector('.ag-dlg-cancel');
        ok.textContent = opts.okText || 'OK';
        ok.classList.toggle('ag-danger', !!opts.danger);
        const single = opts.cancelText === false;
        _ov.querySelector('.ag-dlg-btns').classList.toggle('ag-single', single);
        cancel.textContent = opts.cancelText || 'Zrušit';

        _ov.classList.add('open');
        return new Promise(function (res) {
            _resolve = res;
            if (_hasInput) setTimeout(function () { input.focus(); input.select(); }, 60);
            else setTimeout(function () { ok.focus(); }, 60);
        });
    }

    // Veřejné API (idempotentní — nepřepisuje, pokud už existuje jiná implementace)
    window.agPrompt = window.agPrompt || function (opts) { opts = opts || {}; opts.input = true; return open(opts); };
    window.agConfirm = window.agConfirm || function (opts) { opts = opts || {}; opts.input = false; if (opts.okText == null) opts.okText = 'Potvrdit'; return open(opts); };
    window.agAlert = window.agAlert || function (opts) { opts = opts || {}; opts.input = false; opts.cancelText = false; if (opts.okText == null) opts.okText = 'Rozumím'; return open(opts); };

    // --------------------------------------------------------------------------------
    // 2) ZAKÁZKY — hezké dialogy + přejmenování
    //    Trik: necháme PŮVODNÍ logiku (zachová se i undo z undo.js), jen dočasně
    //    "podstrčíme" výsledek nativního prompt()/confirm(), který původní funkce volá.
    // --------------------------------------------------------------------------------
    function projName(id) {
        try {
            if (typeof projects === 'undefined' || !Array.isArray(projects)) return '';
            const p = projects.find(function (x) { return x.id === id; });
            return p ? p.name : '';
        } catch (e) { return ''; }
    }

    function rewireProjects() {
        if (typeof window.createNewProject === 'function' && !window.createNewProject._agWrapped) {
            const orig = window.createNewProject;
            const wrapped = function () {
                agPrompt({
                    title: 'Nová zakázka',
                    message: 'Pojmenuj zakázku (lokalita / parcela / zakázkové číslo).',
                    placeholder: 'Např. Pole u lesa 123/4',
                    okText: 'Vytvořit'
                }).then(function (name) {
                    if (name == null || !name) return;
                    const op = window.prompt;
                    window.prompt = function () { return name; };
                    try { orig.call(window); } finally { window.prompt = op; }
                });
            };
            wrapped._agWrapped = true;
            window.createNewProject = wrapped;
        }

        if (typeof window.deleteProject === 'function' && !window.deleteProject._agWrapped) {
            const orig = window.deleteProject; // může už být obalená undo.js — to chceme zachovat
            const wrapped = function () {
                if (typeof projects !== 'undefined' && Array.isArray(projects) && projects.length <= 1) {
                    agAlert({ title: 'Nelze smazat', message: 'Tohle je poslední zakázka — aspoň jedna musí zůstat.' });
                    return;
                }
                const nm = projName(typeof activeProjectId !== 'undefined' ? activeProjectId : '') || 'tuto zakázku';
                agConfirm({
                    title: 'Smazat zakázku?',
                    message: 'Smaže se <b>' + escapeHtml(nm) + '</b> včetně všech jejích uložených bodů.<br>Hned po smazání se na pár vteřin objeví „Vrátit zpět".',
                    okText: 'Smazat', cancelText: 'Ponechat', danger: true
                }).then(function (ok) {
                    if (!ok) return;
                    const oc = window.confirm;
                    window.confirm = function () { return true; };
                    try { orig.call(window); } finally { window.confirm = oc; }
                });
            };
            wrapped._agWrapped = true;
            window.deleteProject = wrapped;
        }
    }

    // Přejmenování aktivní zakázky — nové tlačítko (tužka) vedle výběru zakázky v Nastavení
    function injectRename() {
        const sel = document.getElementById('s-project-select');
        if (!sel || document.getElementById('ag-proj-rename')) return;
        const row = sel.parentElement;
        if (!row) return;
        const btn = document.createElement('button');
        btn.id = 'ag-proj-rename';
        btn.className = 'w-proj-icon';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Přejmenovat zakázku');
        btn.innerHTML = '<svg class="icon"><use href="#i-edit"/></svg>';
        btn.style.flex = '0 0 auto';
        btn.addEventListener('click', function () {
            if (typeof projects === 'undefined' || typeof activeProjectId === 'undefined') return;
            const p = projects.find(function (x) { return x.id === activeProjectId; });
            if (!p) return;
            agPrompt({ title: 'Přejmenovat zakázku', value: p.name, okText: 'Uložit' }).then(function (nv) {
                if (nv == null || !nv) return;
                p.name = nv;
                try { localStorage.setItem('arProjectsList', JSON.stringify(projects)); } catch (e) {}
                if (typeof renderProjectSelect === 'function') renderProjectSelect();
                if (typeof renderSettingsProjects === 'function') renderSettingsProjects();
            });
        });
        // vlož hned za výběr zakázky (před + a koš), ať destruktivní akce zůstane poslední
        if (sel.nextSibling) row.insertBefore(btn, sel.nextSibling);
        else row.appendChild(btn);
    }

    // --------------------------------------------------------------------------------
    // 3) POCTIVÁ PŘESNOST — vysvětlivka + varování v panelu Průměrování GPS
    // --------------------------------------------------------------------------------
    function injectGpsNote() {
        const panel = document.getElementById('gps-avg');
        if (!panel || document.getElementById('ag-gps-note')) return;
        const note = document.createElement('div');
        note.id = 'ag-gps-note';
        note.innerHTML =
            'σ = rozptyl měření · stř. chyba = odhad polohy.<br>' +
            '<b>Pozor:</b> telefonní GPS má systematickou chybu ~5–15 m, kterou průměrování ' +
            '<u>neodstraní</u>. Bod v terénu vždy ověř.';
        panel.appendChild(note);
    }

    // --------------------------------------------------------------------------------
    // 4) REŽIM RUKAVIC — přepínač v bočním menu
    // --------------------------------------------------------------------------------
    function applyGlove() {
        try { document.body.classList.toggle('ag-glove', localStorage.getItem('agGlove') === '1'); } catch (e) {}
    }
    function injectGloveToggle() {
        const menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('ag-glove-row')) return;
        const row = document.createElement('label');
        row.className = 'menu-toggle-row';
        row.id = 'ag-glove-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'ag-glove-cb';
        try { cb.checked = localStorage.getItem('agGlove') === '1'; } catch (e) {}
        cb.addEventListener('change', function () {
            try { localStorage.setItem('agGlove', cb.checked ? '1' : '0'); } catch (e) {}
            applyGlove();
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' Režim rukavic (větší tlačítka)'));
        menu.appendChild(row);
    }

    // --------------------------------------------------------------------------------
    // 5) INDIKÁTOR ZAPLNĚNÍ localStorage (Nastavení → Funkce a Data)
    // --------------------------------------------------------------------------------
    const LS_LIMIT = 5 * 1024 * 1024; // typický limit ~5 MB (Safari/iOS), orientační
    function lsBytes() {
        let t = 0;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                const v = localStorage.getItem(k) || '';
                t += (k.length + v.length) * 2; // UTF-16 ≈ 2 B/znak
            }
        } catch (e) {}
        return t;
    }
    function injectQuota() {
        const tab = document.getElementById('tab-funkce');
        if (!tab || document.getElementById('ag-quota')) return;
        const box = document.createElement('div');
        box.id = 'ag-quota';
        box.className = 'ag-quota';
        box.innerHTML =
            '<div class="ag-quota-head"><span>Využité úložiště zařízení</span><b id="ag-quota-val">—</b></div>' +
            '<div class="ag-quota-bar"><div class="ag-quota-fill" id="ag-quota-fill"></div></div>' +
            '<div class="ag-quota-note" id="ag-quota-note"></div>';
        tab.appendChild(box);
        refreshQuota();
    }
    function refreshQuota() {
        const box = document.getElementById('ag-quota');
        if (!box) return;
        const b = lsBytes();
        const mb = b / (1024 * 1024);
        const pct = Math.max(2, Math.min(100, (b / LS_LIMIT) * 100));
        const valEl = document.getElementById('ag-quota-val');
        const fillEl = document.getElementById('ag-quota-fill');
        const noteEl = document.getElementById('ag-quota-note');
        if (valEl) valEl.textContent = (mb < 0.1 ? (Math.round(b / 1024) + ' kB') : (mb.toFixed(1) + ' MB')) + ' / ~5 MB';
        if (fillEl) fillEl.style.width = pct + '%';
        box.classList.remove('warn', 'crit');
        if (pct >= 85) box.classList.add('crit');
        else if (pct >= 60) box.classList.add('warn');
        if (noteEl) {
            if (pct >= 85) noteEl.innerHTML = '<b>Skoro plno.</b> Smaž stažené okolí nebo staré zakázky. Velká data bodů se ukládají zvlášť (IndexedDB) a do tohoto limitu se nepočítají.';
            else if (pct >= 60) noteEl.textContent = 'Naplňuje se. Stažené okolí / zálohy zabírají místo — případně ukliď nepotřebné zakázky.';
            else noteEl.textContent = 'Nastavení a texty. Velká data bodů jsou zvlášť v IndexedDB (mimo tento limit).';
        }
    }
    // Po otevření Nastavení přepočítej (hodnota se mění s prací)
    function hookSettings() {
        if (typeof window.openSettings === 'function' && !window.openSettings._agQuota) {
            const orig = window.openSettings;
            const wrapped = function () { const r = orig.apply(this, arguments); try { refreshQuota(); } catch (e) {} return r; };
            wrapped._agQuota = true;
            wrapped._agOrig = orig;
            window.openSettings = wrapped;
        }
    }

    // --------------------------------------------------------------------------------
    // Pomocné
    // --------------------------------------------------------------------------------
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // --------------------------------------------------------------------------------
    // Init
    // --------------------------------------------------------------------------------
    function init() {
        try { rewireProjects(); } catch (e) { console.warn('[vylepseni] zakázky', e); }
        try { injectRename(); } catch (e) { console.warn('[vylepseni] rename', e); }
        try { injectGpsNote(); } catch (e) { console.warn('[vylepseni] gps-note', e); }
        try { injectGloveToggle(); applyGlove(); } catch (e) { console.warn('[vylepseni] glove', e); }
        try { injectQuota(); hookSettings(); } catch (e) { console.warn('[vylepseni] quota', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // Druhý průchod po plném loadu — některé prvky/funkce vznikají později.
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
