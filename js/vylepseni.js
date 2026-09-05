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
        // POZN.: createNewProject se ZDE UŽ NEOBALUJE. Nativní logika.js zakládá zakázku
        // přímo přes agPrompt(); staré obalení „podstrč window.prompt" tu otevíralo DRUHÝ
        // dialog (originál agPrompt volá sám) → zakázku bylo nutné zadat 2×. (bug fix)

        if (typeof window.deleteProject === 'function' && !window.deleteProject._agWrapped) {
            const orig = window.deleteProject; // může už být obalená undo.js — to chceme zachovat
            const wrapped = function () {
                if (typeof projects !== 'undefined' && Array.isArray(projects) && projects.length <= 1) {
                    agAlert({ title: 'Nelze smazat', message: 'Tohle je poslední zakázka — aspoň jedna musí zůstat.' });
                    return;
                }
                const nm = projName(typeof activeProjectId !== 'undefined' ? activeProjectId : '') || 'tuto zakázku';
                // ⚠⚠ #4b: TOHLE JE DIALOG, KTERÝ UŽIVATEL OPRAVDU VIDÍ. Nativní confirm
                // z js/logika.js si níže podstrčíme na `true`, takže jeho (poctivý) text
                // nikdo nepřečte — pravda o koši musí být napsaná ZDE. Slib „30 dní v koši"
                // platí jen na to, co koš umí zachytit (localStorage + body zakázky);
                // fotky u bodů, hlasovky a podložené plány leží ve vlastních databázích
                // a mizí nadobro. Dřív tu stálo jen „objeví se Vrátit zpět" — geodet tedy
                // mazal v přesvědčení, že má měsíc na rozmyšlenou.
                agConfirm({
                    title: 'Smazat zakázku?',
                    message: 'Smaže se <b>' + escapeHtml(nm) + '</b> se vším, co k ní patří.'
                        + '<br><br>Z <b>koše</b> půjde 30 dní vrátit: body, spojnice, zápisníky a nastavení zakázky.'
                        + '<br><b>Nenávratně</b> se smažou: fotky u bodů, hlasovky a podložené plány.'
                        + '<br><br>Hned po smazání se na pár vteřin objeví „Vrátit zpět". Když fotky potřebuješ, nejdřív si stáhni zálohu (Nastavení → Údržba).',
                    okText: 'Smazat', cancelText: 'Ponechat', danger: true
                }).then(function (ok) {
                    if (!ok) return;
                    const oc = window.confirm;
                    window.confirm = function () { return true; };
                    try { orig.call(window); } finally { window.confirm = oc; }
                });
            };
            // ⚠⚠ #27 PŘENOS PŘÍZNAKŮ OBALENÍ. Tenhle modul se načítá POSLEDNÍ, takže je
            // v řetězu deleteProject nejzevnější — a kdyby příznaky předchozích obalů
            // (kos.js: _trashWrapped, undo.js: _undoWrapped) nezdědil, zmizely by úplně
            // a kdokoli další by mohl obalit podruhé (dvojí záznam v koši, dvojí toast).
            try { for (const k in orig) { if (/Wrapped$/.test(k)) wrapped[k] = orig[k]; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:rewireProjects'); }
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
                try { localStorage.setItem('arProjectsList', JSON.stringify(projects)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:injectRename'); }
                if (typeof renderProjectSelect === 'function') renderProjectSelect();
                if (typeof renderSettingsProjects === 'function') renderSettingsProjects();
            });
        });
        // vlož hned za výběr zakázky (před + a koš), ať destruktivní akce zůstane poslední
        if (sel.nextSibling) row.insertBefore(btn, sel.nextSibling);
        else row.appendChild(btn);
    }

    // --------------------------------------------------------------------------------
    // 3) POCTIVÁ PŘESNOST — vysvětlivka + varování v DETAILU průměrování GPS (modál)
    // --------------------------------------------------------------------------------
    // Vysvětlivka + varování patří do DETAILU (modál #gpsavg-modal, otevře se klikem
    // na kompaktní panel „GPS: ±X m"), ne do hlavního pohledu — ať na obrazovce
    // nepřekáží, ale je dohledatelná u měření / rozptylu / kódu kvality.
    function injectGpsNote() {
        const body = document.querySelector('#gpsavg-modal .modal-body');
        if (!body || document.getElementById('ag-gps-note')) return;
        const note = document.createElement('div');
        note.id = 'ag-gps-note';
        note.innerHTML =
            'σ = rozptyl měření · stř. chyba = odhad polohy.<br>' +
            '<b>Pozor:</b> telefonní GPS má systematickou chybu ~5–15 m, kterou průměrování ' +
            '<u>neodstraní</u>. Bod v terénu vždy ověř.';
        body.appendChild(note);   // za řádky měření/rozptyl i čip kódu kvality (#gaq-qc)
    }

    // (Pozn.: dřívější sbalovací panel „Průměrování GPS" nahradil kompaktní jednořádkový
    // panel „GPS: ±X m" s detailem v modálu — viz index.html / grafika.js.)

    // --------------------------------------------------------------------------------
    // 4) REŽIM RUKAVIC — přepínač v Nastavení → Vzhled (dříve boční menu „Více")
    // --------------------------------------------------------------------------------
    function applyGlove() {
        try { document.body.classList.toggle('ag-glove', localStorage.getItem('agGlove') === '1'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:applyGlove'); }
    }
    function injectGloveToggle() {
        if (document.getElementById('ag-glove-row')) return;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'ag-glove-cb';
        try { cb.checked = localStorage.getItem('agGlove') === '1'; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:injectGloveToggle'); }
        cb.addEventListener('change', function () {
            try { localStorage.setItem('agGlove', cb.checked ? '1' : '0'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:injectGloveToggle'); }
            applyGlove();
        });
        const tab = document.getElementById('tab-vzhled');
        if (tab) {
            // st-row ve stylu ostatních přepínačů v Nastavení → Vzhled
            const row = document.createElement('div');
            row.className = 'st-row';
            row.id = 'ag-glove-row';
            const lab = document.createElement('span');
            lab.className = 'st-lab';
            lab.innerHTML = 'Režim rukavic<small>větší tlačítka a dotykové plochy</small>';
            const sw = document.createElement('label');
            sw.className = 'st-sw';
            const face = document.createElement('span');
            face.className = 'st-sw-face';
            sw.appendChild(cb); sw.appendChild(face);
            row.appendChild(lab); row.appendChild(sw);
            // hned za přepínač „Ovládání pro levou ruku", jinak na konec záložky
            const lh = document.getElementById('s-lefthand');
            const lhRow = lh ? lh.closest('.st-row') : null;
            if (lhRow && lhRow.parentNode === tab) tab.insertBefore(row, lhRow.nextSibling);
            else tab.appendChild(row);
            return;
        }
        // Fallback (kdyby #tab-vzhled nebyl): původní řádek v bočním menu „Více"
        const menu = document.getElementById('side-menu');
        if (!menu) return;
        const host = menu.querySelector('.menu-scroll') || menu;
        const row = document.createElement('label');
        row.className = 'menu-toggle-row';
        row.id = 'ag-glove-row';
        row.appendChild(cb);
        row.appendChild(document.createTextNode(' Režim rukavic (větší tlačítka)'));
        host.appendChild(row);
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
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:lsBytes'); }
        return t;
    }
    function injectQuota() {
        const tab = document.getElementById('tab-data');
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
            const wrapped = function () { const r = orig.apply(this, arguments); try { refreshQuota(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:wrapped'); } return r; };
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
    // Vraci [X_kresleni, Y_kresleni] = ZNAMENKOVY (negativni) Krovak — presne to, co jde
    // do DXF. Appka jinak drzi kladne Y,X, proto se u GeoCore znamenko vraci zpet.
    // POZOR: poradi parametru je (lat, lng) jako vsude jinde. DRIV to bylo (lng, lat),
    // coz byl jediny takovy pripad v celem repu a cekalo to na zamenu pri prvni uprave.
    function toSJTSK(lat, lng) {
        try {
            if (window.GeoCore && GeoCore.toSJTSK) {
                const s = GeoCore.toSJTSK(lat, lng);
                if (!s || !isFinite(s.y) || !isFinite(s.x)) return null;
                return [-s.y, -s.x];
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:toSJTSK'); }
        if (typeof proj4 !== 'function') return null;
        try { const sj = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); return [sj[0], sj[1]]; }
        catch (e) { return null; }
    }
    function dxfDownload(filename, text) {
        try {
            const blob = new Blob([text], { type: 'application/dxf;charset=utf-8' });
            // ⚠ #9 TICHÁ PAST: tenhle modul se načítá POSLEDNÍ a window.exportPointsDXF
            // níže přebíjí ten z js/dxf-export.js — oprava cesty ven udělaná tam by tedy
            // v běžící appce nic nedělala. DXF je typický „pošli to do kanceláře" soubor
            // a na iPhonu (PWA z plochy) ho ven dostane jen systémový list sdílení,
            // ne atribut download. Viz js/sdilet-soubor.js; bez něj zůstane stažení odkazem.
            if (typeof window.agShareOrDownload === 'function') {
                return window.agShareOrDownload(blob, filename, 'application/dxf')['catch'](function (e) {
                    agAlert({ title: 'Export selhal', message: 'Nepodařilo se soubor poslat ven.' });
                    return 'fail';
                });
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            return Promise.resolve('download');
        } catch (e) { agAlert({ title: 'Export selhal', message: 'Nepodařilo se stáhnout soubor.' }); return Promise.resolve('fail'); }
    }
    function dxfClean(s) { return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').slice(0, 250); }
    // Kod bodu -> nazev DXF vrstvy (bez diakritiky/mezer, max 31 znaku; bez kodu = BODY).
    // Diky tomu se body v CADu rovnou tridi po vrstvach (OBRUBA, SACHTA, ...).
    function dxfLayer(kod) {
        let s = String(kod || '');
        // NFD rozlozi 'c' na 'c'+hacek; zahodime vse mimo tisknutelne ASCII (= prave ty znacky).
        try { s = s.normalize('NFD').replace(/[^ -~]/g, ''); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:dxfLayer'); }
        s = s.toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 31);
        return s || 'BODY';
    }

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
            const c = toSJTSK(p.lat, p.lng);
            if (!c) { nSkip++; return; }
            const x = c[0].toFixed(3), y = c[1].toFixed(3);
            // bod — VRSTVA PODLE KODU (obruba -> OBRUBA), bez kodu vrstva BODY.
            // Vyska Z jde do skupiny 30, aby byl bod v CADu prostorovy (drive vzdy 0.0).
            const z = (p.vyska != null && isFinite(p.vyska)) ? Number(p.vyska).toFixed(3) : '0.0';
            e += '0\nPOINT\n8\n' + dxfLayer(p.kod) + '\n10\n' + x + '\n20\n' + y + '\n30\n' + z + '\n';
            // číslo bodu jako TEXT vedle bodu
            const tx = (c[0] + TXT_H * 0.6).toFixed(3), ty = (c[1] + TXT_H * 0.6).toFixed(3);
            e += '0\nTEXT\n8\nCISLA\n10\n' + tx + '\n20\n' + ty + '\n30\n0.0\n40\n' + TXT_H.toFixed(3) + '\n1\n' + dxfClean(p.name || 'Bod') + '\n';
            nOk++;
        });

        lines.forEach(function (l) {
            const a = toSJTSK(+l.aLat, +l.aLng), b = toSJTSK(+l.bLat, +l.bLng);
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
        // ⚠ Výhrada se hlásí AŽ PODLE VÝSLEDKU — po „Zrušit“ v listu sdílení se nic
        // neuložilo a věta „Export DXF vytvořen“ by byla nepravda.
        dxfDownload('body_' + proj + '.dxf', dxf).then(function (jak) {
            if (!nSkip || jak === 'abort' || jak === 'fail') return;
            agAlert({ title: 'Hotovo (s výhradou)', message: 'Export DXF vytvořen. <b>' + nSkip + '</b> ' + (nSkip === 1 ? 'prvek byl přeskočen' : 'prvků bylo přeskočeno') + ' (chybějící/neplatné souřadnice).' });
        });
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
    // 7) AR KALIBRAČNÍ PRŮVODCE — sever + zorný úhel
    //    Řídí jen EXISTUJÍCÍ ověřené funkce: nudgeHeadingOffset/resetHeadingOffset
    //    (korekce severu) a visSettings.fovH (AR ji čte každý snímek -> živě), persistuje
    //    přes setStoredData. Žádná nová "magie" -> nemůže být hůř než stávající posuvníky.
    // --------------------------------------------------------------------------------
    let _calib = null, _calibStep = 1, _calibTimer = null;

    function normDeg(v) { return ((v % 360) + 360) % 360; }
    function getHeading() { try { return (typeof currentHeading !== 'undefined' && isFinite(currentHeading)) ? normDeg(currentHeading) : null; } catch (e) { return null; } }
    function getOffset() { try { let v = (typeof userHeadingOffset !== 'undefined') ? userHeadingOffset : 0; v = ((v + 180) % 360 + 360) % 360 - 180; return Math.round(v); } catch (e) { return 0; } }
    function getFov() { try { return (typeof visSettings !== 'undefined' && visSettings.fovH) ? visSettings.fovH : 90; } catch (e) { return 90; } }

    function nudgeNorth(d) { try { if (typeof nudgeHeadingOffset === 'function') nudgeHeadingOffset(d); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:nudgeNorth'); } renderCalib(); }
    function resetNorth() { try { if (typeof resetHeadingOffset === 'function') resetHeadingOffset(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:resetNorth'); } renderCalib(); }
    function setFov(v) {
        v = Math.max(40, Math.min(120, v));
        try {
            if (typeof visSettings !== 'undefined') visSettings.fovH = v;
            if (typeof setStoredData === 'function') setStoredData('arVisSettings12', JSON.stringify(visSettings));
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:setFov'); }
        // sync s posuvníkem v Nastavení, ať to spolu sedí
        const sl = document.getElementById('s-fovh'); if (sl) sl.value = v;
        const lbl = document.getElementById('s-fovh-val'); if (lbl) lbl.innerText = v;
        renderCalib();
    }

    function buildCalib() {
        if (_calib) return _calib;
        _calib = document.createElement('div');
        _calib.id = 'ag-calib';
        document.body.appendChild(_calib);
        return _calib;
    }

    function renderCalib() {
        if (!_calib) return;
        const az = getHeading();
        if (_calibStep === 1) {
            const off = getOffset();
            _calib.innerHTML =
                '<div class="ag-calib-head"><span class="ag-calib-step">Kalibrace AR · krok 1 / 2</span><button type="button" class="ag-calib-x" data-act="close" aria-label="Zavřít">×</button></div>' +
                '<h3 class="ag-calib-title">Srovnání severu</h3>' +
                '<p class="ag-calib-desc">Namiř střed obrazu na <b>známý orientační bod</b> (roh budovy, komín, sloup) viditelný i v AR. Pak laď, dokud značka/šipka nesedí na realitu.</p>' +
                '<div class="ag-calib-read"><span class="lbl">Azimut</span><span class="val" id="ag-calib-az">' + (az == null ? '—' : Math.round(az) + '°') + '</span><span class="lbl">· korekce ' + (off > 0 ? '+' : '') + off + '°</span></div>' +
                '<div class="ag-calib-grid">' +
                '<button type="button" class="ag-calib-btn" data-nudge="-5">−5°</button>' +
                '<button type="button" class="ag-calib-btn" data-nudge="-1">−1°</button>' +
                '<button type="button" class="ag-calib-btn" data-nudge="1">+1°</button>' +
                '<button type="button" class="ag-calib-btn" data-nudge="5">+5°</button>' +
                '</div>' +
                '<div class="ag-calib-foot">' +
                '<button type="button" class="ag-calib-btn" data-act="resetN">Vynulovat</button>' +
                '<button type="button" class="ag-calib-btn prim" data-act="next">Dále →</button>' +
                '</div>';
        } else {
            const fov = getFov();
            _calib.innerHTML =
                '<div class="ag-calib-head"><span class="ag-calib-step">Kalibrace AR · krok 2 / 2</span><button type="button" class="ag-calib-x" data-act="close" aria-label="Zavřít">×</button></div>' +
                '<h3 class="ag-calib-title">Zorný úhel kamery</h3>' +
                '<p class="ag-calib-desc">Když značky <b>utíkají do stran</b> rychleji/pomaleji než realita, uprav šířku záběru, dokud okraj značky nesedí s reálným objektem na kraji obrazu.</p>' +
                '<div class="ag-calib-read"><span class="lbl">Šířka záběru</span><span class="val">' + fov + '°</span></div>' +
                '<div class="ag-calib-grid">' +
                '<button type="button" class="ag-calib-btn" data-fov="-5">−5°</button>' +
                '<button type="button" class="ag-calib-btn" data-fov="-2">−2°</button>' +
                '<button type="button" class="ag-calib-btn" data-fov="2">+2°</button>' +
                '<button type="button" class="ag-calib-btn" data-fov="5">+5°</button>' +
                '</div>' +
                '<div class="ag-calib-foot">' +
                '<button type="button" class="ag-calib-btn" data-act="back">← Zpět</button>' +
                '<button type="button" class="ag-calib-btn prim" data-act="done">Hotovo ✓</button>' +
                '</div>';
        }
        // handlery
        _calib.querySelectorAll('[data-nudge]').forEach(function (b) { b.addEventListener('click', function () { nudgeNorth(parseInt(b.getAttribute('data-nudge'), 10)); }); });
        _calib.querySelectorAll('[data-fov]').forEach(function (b) { b.addEventListener('click', function () { setFov(getFov() + parseInt(b.getAttribute('data-fov'), 10)); }); });
        _calib.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const a = b.getAttribute('data-act');
                if (a === 'close') closeCalib();
                else if (a === 'resetN') resetNorth();
                else if (a === 'next') { _calibStep = 2; renderCalib(); }
                else if (a === 'back') { _calibStep = 1; renderCalib(); }
                else if (a === 'done') { closeCalib(); agAlert({ title: 'Kalibrace uložena', message: 'Korekce severu i zorný úhel jsou uložené. V terénu klidně dolaď znovu — magnetické rušení a různé objektivy to ovlivňují.' }); }
            });
        });
    }

    function openCalib() {
        buildCalib();
        _calibStep = 1;
        renderCalib();
        _calib.classList.add('open');
        if (_calibTimer) clearInterval(_calibTimer);
        // živá aktualizace azimutu jen v kroku 1
        _calibTimer = setInterval(function () {
            if (_calibStep !== 1) return;
            const el = document.getElementById('ag-calib-az');
            if (el) { const az = getHeading(); el.textContent = (az == null ? '—' : Math.round(az) + '°'); }
        }, 250);
    }
    function closeCalib() {
        if (_calibTimer) { clearInterval(_calibTimer); _calibTimer = null; }
        if (_calib) _calib.classList.remove('open');
    }
    window.openARCalibration = openCalib;

    function injectCalibButton() {
        const body = document.querySelector('#tab-kompas');
        if (!body || document.getElementById('ag-calib-launch')) return;
        const btn = document.createElement('button');
        btn.id = 'ag-calib-launch';
        btn.className = 'btn btn-primary';
        btn.type = 'button';
        btn.style.marginBottom = '6px';
        btn.innerHTML = '<svg class="icon"><use href="#i-crosshair"/></svg> Průvodce kalibrací AR (sever + záběr)';
        btn.addEventListener('click', function () {
            const m = document.getElementById('settings-modal'); if (m) m.style.display = 'none';
            // kompas je nyní samostatný modál — před AR kalibrací (potřebuje vidět kameru) ho zavřít
            const cm = document.getElementById('compass-modal'); if (cm) cm.style.display = 'none';
            openCalib();
        });
        body.insertBefore(btn, body.firstChild);
    }

    // --------------------------------------------------------------------------------
    // 8) FOTODOKUMENTACE + PROTOKOL VYTYČENÍ
    //    Foto u vytyčeného bodu (zmenšené JPEG) + tiskový protokol (PDF) s fotkami.
    //    Fotky jdou do SAMOSTATNÉ IndexedDB ('arGeodetFotky') — NE do localStorage (kvóta)
    //    a NE do _idbMem (undo snapshoty). Napojeno obalením globálů z vytycovani.js.
    // --------------------------------------------------------------------------------
    const PDB = 'arGeodetFotky', PSTORE = 'fotky';
    let _curStakePt = null;

    function photoKey(pt) { const proj = (typeof activeProjectId !== 'undefined') ? activeProjectId : 'def'; return proj + '_' + (pt && pt.id != null ? pt.id : '?'); }
    function photoDB() {
        return new Promise(function (res, rej) {
            if (typeof indexedDB === 'undefined') { rej(new Error('no idb')); return; }
            const r = indexedDB.open(PDB, 1);
            r.onupgradeneeded = function () { try { r.result.createObjectStore(PSTORE); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:onupgradeneeded'); } };
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { rej(r.error); };
        });
    }
    function photoPut(k, v) { return photoDB().then(function (db) { return new Promise(function (res, rej) { const tx = db.transaction(PSTORE, 'readwrite'); tx.objectStore(PSTORE).put(v, k); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }
    // Uklid pri smazani zakazky (logika.js vyhlasi ag:project-deleted): fotky teto
    // zakazky (klice `${pid}_...`) by jinak zustaly v arGeodetFotky navzdy jako sirotci.
    document.addEventListener('ag:project-deleted', function (ev) {
        var pid = ev && ev.detail && ev.detail.id; if (!pid) return;
        photoDB().then(function (db) {
            var tx = db.transaction(PSTORE, 'readwrite');
            var cur = tx.objectStore(PSTORE).openCursor();
            cur.onsuccess = function (e) { var c = e.target.result; if (c) { if (typeof c.key === 'string' && c.key.indexOf(pid + '_') === 0) { try { c.delete(); } catch (er) { window.AG && AG.swallow && AG.swallow(er, 'vylepseni:onsuccess'); } } c.continue(); } };
        }).catch(function () {});
    });
    function photoGet(k) { return photoDB().then(function (db) { return new Promise(function (res, rej) { const tx = db.transaction(PSTORE, 'readonly'); const rq = tx.objectStore(PSTORE).get(k); rq.onsuccess = function () { res(rq.result || null); }; rq.onerror = function () { rej(rq.error); }; }); }); }
    function photoDel(k) { return photoDB().then(function (db) { return new Promise(function (res, rej) { const tx = db.transaction(PSTORE, 'readwrite'); tx.objectStore(PSTORE).delete(k); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }

    function downscale(file, maxDim, quality) {
        return new Promise(function (res) {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = function () {
                let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
                const sc = Math.min(1, maxDim / Math.max(w, h));
                const cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
                const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
                try { cv.getContext('2d').drawImage(img, 0, 0, cw, ch); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vylepseni:onload'); }
                URL.revokeObjectURL(url);
                try { res(cv.toDataURL('image/jpeg', quality)); } catch (e) { res(null); }
            };
            img.onerror = function () { URL.revokeObjectURL(url); res(null); };
            img.src = url;
        });
    }

    function showThumb(pt) {
        const t = document.getElementById('ag-stk-thumb'); if (!t) return;
        photoGet(photoKey(pt)).then(function (data) {
            if (document.getElementById('ag-stk-thumb') !== t) return; // mezitím se přepnul bod
            if (data) {
                t.innerHTML = '<img src="' + data + '" alt="foto vytyčení"><button type="button" class="ag-stk-del" id="ag-stk-del">Smazat foto</button>';
                const del = document.getElementById('ag-stk-del');
                if (del) del.addEventListener('click', function () { photoDel(photoKey(pt)).then(function () { showThumb(pt); }).catch(function () {}); });
            } else {
                t.innerHTML = '<div class="ag-stk-empty">Bez fotky — zdokumentuj stabilizaci bodu.</div>';
            }
        }).catch(function () { t.innerHTML = '<div class="ag-stk-empty">Foto nelze načíst (úložiště nedostupné).</div>'; });
    }

    function injectPhotoUI(pt) {
        if (!pt) return;
        const mc = document.querySelector('#stake-detail-modal .modal-content');
        if (!mc) return;
        let sec = document.getElementById('ag-stk-photo');
        if (!sec) {
            sec = document.createElement('div');
            sec.id = 'ag-stk-photo';
            sec.innerHTML =
                '<div id="ag-stk-thumb" class="ag-stk-thumb"></div>' +
                '<input type="file" id="ag-stk-file" accept="image/*" capture="environment" style="display:none">' +
                '<button type="button" class="btn btn-secondary" id="ag-stk-cap" style="margin-top:8px;"><svg class="icon"><use href="#i-camera"/></svg> Vyfotit / nahradit foto</button>';
            const body = document.getElementById('stkd-body');
            if (body && body.nextSibling) mc.insertBefore(sec, body.nextSibling); else mc.appendChild(sec);
            document.getElementById('ag-stk-cap').addEventListener('click', function () { const f = document.getElementById('ag-stk-file'); if (f) f.click(); });
            document.getElementById('ag-stk-file').addEventListener('change', function (e) {
                const f = e.target.files && e.target.files[0]; e.target.value = '';
                if (!f) return;
                const cap = document.getElementById('ag-stk-cap'); const old = cap ? cap.innerHTML : '';
                if (cap) { cap.disabled = true; cap.textContent = 'Zpracovávám…'; }
                downscale(f, 1280, 0.7).then(function (data) {
                    if (!data) throw new Error('img');
                    return photoPut(photoKey(_curStakePt), data);
                }).then(function () { showThumb(_curStakePt); }).catch(function () {
                    agAlert({ title: 'Foto se neuložilo', message: 'Zkus to znovu, nebo zkontroluj místo v úložišti.' });
                }).then(function () { if (cap) { cap.disabled = false; cap.innerHTML = old; } });
            });
        }
        _curStakePt = pt;
        showThumb(pt);
    }

    function buildProtocolHtml(proj, rows) {
        const today = new Date().toLocaleString('cs-CZ');
        const esc = escapeHtml;
        const cards = rows.map(function (r, idx) {
            return '<div class="card"><div class="hd"><span class="num">#' + esc(r.name) + '</span><span class="t">' + esc(r.when) + '</span></div>' +
                '<table><tr><th>S-JTSK Y</th><td>' + r.Y + '</td><th>S-JTSK X</th><td>' + r.X + '</td></tr>' +
                '<tr><th>Přesnost</th><td>' + esc(r.acc) + '</td><th>Pořadí</th><td>' + (idx + 1) + ' / ' + rows.length + '</td></tr></table>' +
                (r.photo ? '<img class="ph" src="' + r.photo + '">' : '<div class="nophoto">bez fotodokumentace</div>') +
                '</div>';
        }).join('');
        const css = 'body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:16px;}' +
            'h1{font-size:calc(20px * var(--ag-font-scale, 1));margin:0 0 4px;}.meta{font-size:calc(12px * var(--ag-font-scale, 1));color:#444;margin-bottom:8px;}' +
            '.prn{padding:10px 16px;border:0;border-radius:8px;background:#10b981;color:#04110b;font-weight:700;font-size:calc(14px * var(--ag-font-scale, 1));cursor:pointer;}' +
            '.note{font-size:calc(11px * var(--ag-font-scale, 1));color:#92400e;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 10px;margin:10px 0 14px;line-height:1.4;}' +
            '.card{border:1px solid #ddd;border-radius:10px;padding:10px 12px;margin-bottom:12px;page-break-inside:avoid;}' +
            '.hd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}' +
            '.num{font-size:calc(16px * var(--ag-font-scale, 1));font-weight:700;}.t{font-size:calc(12px * var(--ag-font-scale, 1));color:#555;}' +
            'table{width:100%;border-collapse:collapse;font-size:calc(12.5px * var(--ag-font-scale, 1));}th,td{text-align:left;padding:3px 6px;border-bottom:1px solid #eee;}th{color:#555;font-weight:600;width:90px;}' +
            '.ph{max-width:100%;max-height:340px;margin-top:8px;border-radius:8px;display:block;}' +
            '.nophoto{margin-top:8px;font-size:calc(11px * var(--ag-font-scale, 1));color:#999;font-style:italic;}' +
            '@media print{.prn{display:none;}body{padding:0;}}';
        return '<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<title>Protokol vytyčení — ' + esc(proj) + '</title><style>' + css + '</style></head><body>' +
            '<h1>Protokol vytyčení</h1>' +
            '<div class="meta">Zakázka: <b>' + esc(proj) + '</b> · Vytištěno: ' + esc(today) + ' · Bodů: ' + rows.length + '</div>' +
            '<button class="prn" onclick="window.print()">Tisk / Uložit PDF</button>' +
            '<div class="note">Orientační pomůcka, ne měřicí přístroj. Zaznamenaná „přesnost" je odhad z GPS telefonu — ten má systematickou chybu ~5–15 m, kterou průměrování neodstraní. Body v terénu ověřte.</div>' +
            cards +
            '<script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},500)}<\/script>' +
            '</body></html>';
    }

    window.exportStakeoutProtocol = function () {
        const pts = (typeof arPoints !== 'undefined') ? arPoints : [];
        const done = pts.filter(function (p) { return typeof stakeoutData !== 'undefined' && stakeoutData[p.id]; });
        if (!done.length) { agAlert({ title: 'Nic k tisku', message: 'Zatím není vytyčen žádný bod.' }); return; }
        if (typeof proj4 !== 'function') { agAlert({ title: 'Chybí proj4', message: 'Knihovna pro převod souřadnic se nenačetla.' }); return; }
        const proj = projName(typeof activeProjectId !== 'undefined' ? activeProjectId : '') || (typeof activeProjectId !== 'undefined' ? activeProjectId : '');
        Promise.all(done.map(function (pt) {
            const rec = stakeoutData[pt.id];
            const sj = proj4('EPSG:4326', 'EPSG:5514', [pt.lng, pt.lat]);
            const when = rec.t ? new Date(rec.t).toLocaleString('cs-CZ') : '';
            return photoGet(photoKey(pt)).catch(function () { return null; }).then(function (photo) {
                return { name: pt.name, Y: Math.abs(sj[0]).toFixed(2), X: Math.abs(sj[1]).toFixed(2), when: when, acc: rec.acc != null ? '±' + rec.acc + ' m' : '—', photo: photo };
            });
        })).then(function (rows) {
            const w = window.open('', '_blank');
            if (!w) { agAlert({ title: 'Okno blokováno', message: 'Povol vyskakovací okna a zkus to znovu — protokol se otevře jako tisknutelná stránka.' }); return; }
            const html = buildProtocolHtml(proj, rows);
            w.document.open(); w.document.write(html); w.document.close();
        });
    };

    function injectProtocolButton() {
        const modal = document.getElementById('stakeout-modal');
        if (!modal || document.getElementById('ag-stk-protocol')) return;
        const rowBtns = modal.querySelector('.row-buttons');
        const btn = document.createElement('button');
        btn.id = 'ag-stk-protocol';
        btn.className = 'btn btn-secondary';
        btn.type = 'button';
        btn.style.marginTop = '8px';
        btn.innerHTML = '<svg class="icon"><use href="#i-file-text"/></svg> Protokol s fotkami (PDF / tisk)';
        btn.addEventListener('click', function () { try { window.exportStakeoutProtocol(); } catch (e) { console.warn(e); } });
        if (rowBtns) modal.querySelector('.modal-content').insertBefore(btn, rowBtns);
        else modal.querySelector('.modal-content').appendChild(btn);
    }

    function hookStakeout() {
        if (typeof window.openStakeRecord === 'function' && !window.openStakeRecord._agPhoto) {
            const orig = window.openStakeRecord;
            const wrapped = function (pt) { const r = orig.apply(this, arguments); try { injectPhotoUI(pt); } catch (e) { console.warn('[vylepseni] photoUI', e); } return r; };
            wrapped._agPhoto = true; window.openStakeRecord = wrapped;
        }
        if (typeof window.openStakeoutModal === 'function' && !window.openStakeoutModal._agProto) {
            const orig = window.openStakeoutModal;
            const wrapped = function () { const r = orig.apply(this, arguments); try { injectProtocolButton(); } catch (e) { console.warn('[vylepseni] protoBtn', e); } return r; };
            wrapped._agProto = true; window.openStakeoutModal = wrapped;
        }
    }

    // --------------------------------------------------------------------------------
    // 9) ZÁLOHA — razítko po stažení (data jsou jen v telefonu)
    //
    //    ⚠ 29. 8. 2026: PŘIPOMÍNKA ZÁLOHY UŽ TADY NENÍ. Appka na ni upozorňovala
    //    ze TŘÍ míst naráz a každé si vedlo vlastní razítko i vlastní odklad:
    //      • tenhle modál „Doporučujeme zálohu" (po 5 dnech, klíč agLastBackup),
    //      • toast z js/zaloha.js (po 14 dnech, klíč arLastBackupAt),
    //      • pruh z js/auto-zaloha.js (po 7 dnech, klíč agLastBackupTs).
    //    Uživatel tak po startu dostal několik upozornění na totéž a odbytí jednoho
    //    ostatní neumlčelo („vyskakuje na mě spousta upozornění na zálohu, sjednoť
    //    to"). Zbyl JEDEN pruh v js/auto-zaloha.js; razítko se odsud píše dál, aby
    //    přežily i starší zálohy a výpis úložiště v js/logika.js.
    //
    //    ⚠⚠ 5. 9. 2026 (#24): RAZÍTKO SE ODSUD UŽ NEPÍŠE VŮBEC — wrapBackup() je pryč.
    //    Byla to čtvrtá vrstva, která psala „zálohováno" hned po zavolání exportAllData,
    //    tedy i tehdy, když uživatel list sdílení zrušil nebo se soubor nikdy neuložil.
    //    Appka pak mlčela další dny s tím, že zálohu má. Razítko (všechny tři klíče
    //    naráz) teď píše JEDINÉ místo — js/zaloha.js — a to až potom, co je jisté,
    //    že soubor někde přistál.
    // --------------------------------------------------------------------------------

    // --------------------------------------------------------------------------------
    // Pomocné
    // --------------------------------------------------------------------------------
    function escapeHtml(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

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
        try { injectCalibButton(); } catch (e) { console.warn('[vylepseni] calib', e); }
        try { hookStakeout(); } catch (e) { console.warn('[vylepseni] stakeout', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // Druhý průchod po plném loadu — některé prvky/funkce vznikají později.
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
