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
    // 6) DXF EXPORT do CADu (AutoCAD / Kokeš / MicroStation)
    //    Souřadnice: WGS84 -> EPSG:5514 (S-JTSK) přes proj4. Kreslíme (X=sj[0], Y=sj[1]),
    //    což dává VÝKRESOVOU orientaci — sever nahoru, východ vpravo, v metrech (1:1).
    //    Hodnoty jsou u S-JTSK ve výkresu běžně záporné; georeferencovaný CAD je zvládne.
    //    Minimální DXF R12 (AC1009) bez TABLES — vrstvy se v CADu vytvoří automaticky.
    // --------------------------------------------------------------------------------
    function toSJTSK(lng, lat) {
        // vrací [X_kresleni, Y_kresleni] = [sj[0], sj[1]] (sever nahoru)
        if (typeof proj4 !== 'function') return null;
        try { const sj = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); return [sj[0], sj[1]]; }
        catch (e) { return null; }
    }
    function dxfDownload(filename, text) {
        try {
            const blob = new Blob([text], { type: 'application/dxf;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (e) { agAlert({ title: 'Export selhal', message: 'Nepodařilo se stáhnout soubor.' }); }
    }
    function dxfClean(s) { return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').slice(0, 250); }

    window.exportPointsDXF = function () {
        if (typeof proj4 !== 'function') { agAlert({ title: 'Chybí proj4', message: 'Knihovna pro převod souřadnic se nenačetla.' }); return; }
        const pts = (typeof persistentCustomPoints !== 'undefined') ? persistentCustomPoints : [];
        const lines = (typeof pointLines !== 'undefined') ? pointLines : [];
        if (!pts.length && !lines.length) { agAlert({ title: 'Není co exportovat', message: 'Tato zakázka nemá žádné vlastní body ani spojnice.' }); return; }

        const TXT_H = 2.0; // výška popisku v metrech (uživatel si v CADu přeškáluje)
        let e = ''; // ENTITIES
        let nOk = 0, nSkip = 0;

        pts.forEach(function (p) {
            if (typeof p.lat !== 'number' || typeof p.lng !== 'number') { nSkip++; return; }
            const c = toSJTSK(p.lng, p.lat);
            if (!c) { nSkip++; return; }
            const x = c[0].toFixed(3), y = c[1].toFixed(3);
            // bod
            e += '0\nPOINT\n8\nBODY\n10\n' + x + '\n20\n' + y + '\n30\n0.0\n';
            // číslo bodu jako TEXT vedle bodu
            const tx = (c[0] + TXT_H * 0.6).toFixed(3), ty = (c[1] + TXT_H * 0.6).toFixed(3);
            e += '0\nTEXT\n8\nCISLA\n10\n' + tx + '\n20\n' + ty + '\n30\n0.0\n40\n' + TXT_H.toFixed(3) + '\n1\n' + dxfClean(p.name || 'Bod') + '\n';
            nOk++;
        });

        lines.forEach(function (l) {
            const a = toSJTSK(+l.aLng, +l.aLat), b = toSJTSK(+l.bLng, +l.bLat);
            if (!a || !b) { nSkip++; return; }
            e += '0\nLINE\n8\nSPOJNICE\n10\n' + a[0].toFixed(3) + '\n20\n' + a[1].toFixed(3) + '\n30\n0.0\n'
                + '11\n' + b[0].toFixed(3) + '\n21\n' + b[1].toFixed(3) + '\n31\n0.0\n';
        });

        if (!nOk && !lines.length) { agAlert({ title: 'Není co exportovat', message: 'Body nemají platné souřadnice.' }); return; }

        const dxf =
            '999\nAR Geodet — S-JTSK (EPSG:5514), vykresova orientace (sever nahoru), metry\n' +
            '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n' +
            '0\nSECTION\n2\nENTITIES\n' + e + '0\nENDSEC\n0\nEOF\n';

        const proj = (typeof activeProjectId !== 'undefined') ? activeProjectId : 'body';
        dxfDownload('body_' + proj + '.dxf', dxf);
        if (nSkip) {
            agAlert({ title: 'Hotovo (s výhradou)', message: 'Export DXF vytvořen. <b>' + nSkip + '</b> ' + (nSkip === 1 ? 'prvek byl přeskočen' : 'prvků bylo přeskočeno') + ' (chybějící/neplatné souřadnice).' });
        }
    };

    function injectDxfButton() {
        // přidá tlačítko do existujícího exportního menu (manage-modal) vedle ostatních exportů
        const opts = document.querySelector('#manage-modal .exp-opts');
        if (!opts || document.getElementById('ag-export-dxf')) return;
        const btn = document.createElement('button');
        btn.id = 'ag-export-dxf';
        btn.className = 'btn btn-secondary';
        btn.type = 'button';
        btn.innerHTML = '<svg class="icon"><use href="#i-upload"/></svg> Export DXF (CAD)';
        btn.addEventListener('click', function () { try { window.exportPointsDXF(); } catch (e) { console.warn(e); } });
        // vlož za GeoJSON (poslední z "Export ..." řady), před tlačítko Importu pokud existuje
        const importBtn = opts.querySelector('button.btn-blue');
        if (importBtn) opts.insertBefore(btn, importBtn);
        else opts.appendChild(btn);
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
        try { injectDxfButton(); } catch (e) { console.warn('[vylepseni] dxf', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // Druhý průchod po plném loadu — některé prvky/funkce vznikají později.
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
