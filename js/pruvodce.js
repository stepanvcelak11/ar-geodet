// ===== AR Geodet - PRUVODCE UKOLEM =====
// Vetveny dotaznik, ktery uzivatele provede typickou cinnosti a sam posklada to, co
// appka uz umi (zalozeni zakazky, vlozeni/import bodu, vytycovaci checklist, sber bodu
// GPS, mereni). Nezdvojuje logiku — jen orchestruje existujici globalni funkce.
//
// Vetve: A) Vytycovani  B) Sber bodu  C) Uredni body (online)  D) Mereni
// U kazde volby je oznaceno, zda funguje OFFLINE nebo potrebuje INTERNET.
// Nacita se PO logika.js/grafika.js; vlastni modal i styly si vyrobi sam, do HTML/CSS nesaha.

(function () {
    'use strict';

    // ---------- stav pruvodce ----------
    var W = {
        active: false,        // probiha rezim navazany na pruvodce (kvuli konecne smycce)
        activity: null,       // 'stake' | 'collect' | 'official' | 'measure'
        doneShown: false,     // vytycovani: konecna obrazovka uz byla zobrazena
        collecting: false,    // probiha sber bodu
        savedCount: 0,
        collect: { prefix: '', n: 1, step: 1, threshold: null, foto: false }
    };
    var histStack = [];       // zasobnik kroku pro tlacitko Zpet

    // ---------- pomocne ----------
    function isOnline() { return (typeof navigator !== 'undefined' && navigator.onLine !== false); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    // znacka offline / online
    function badge(needsNet) {
        if (needsNet) return '<span class="pruv-badge off">🌐 potřebuje internet</span>';
        return '<span class="pruv-badge on">✓ funguje offline</span>';
    }

    // ---------- modal ----------
    function ensureModal() {
        if (document.getElementById('pruvodce-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'pruvodce-modal'; el.style.zIndex = '100050';
        el.innerHTML =
            '<div class="modal-content">'
            + '<div style="display:flex; align-items:center; gap:8px; margin-bottom:2px;">'
            + '<svg class="icon" style="color:var(--accent);"><use href="#i-navigation"/></svg>'
            + '<h3 id="pruv-title" style="color:var(--accent); margin:0;">Průvodce úkolem</h3></div>'
            + '<div id="pruv-crumb" style="font-size:12px; opacity:0.65; margin:2px 0 10px; min-height:14px;"></div>'
            + '<div class="modal-body" id="pruv-body"></div>'
            + '<div class="row-buttons" id="pruv-footer"></div>'
            + '</div>';
        document.body.appendChild(el);
    }

    function closeWizard() { var m = document.getElementById('pruvodce-modal'); if (m) m.style.display = 'none'; }
    function showWizard() { ensureModal(); document.getElementById('pruvodce-modal').style.display = 'flex'; }

    // vykresleni jednoho kroku
    // opts: { title, crumb, body (HTML), footer:[{label,cls,act,icon}], onMount }
    function render(opts) {
        ensureModal();
        document.getElementById('pruv-title').innerText = opts.title || 'Průvodce úkolem';
        document.getElementById('pruv-crumb').innerText = opts.crumb || '';
        document.getElementById('pruv-body').innerHTML = opts.body || '';
        var f = document.getElementById('pruv-footer');
        f.innerHTML = '';
        (opts.footer || []).forEach(function (b) {
            var btn = document.createElement('button');
            btn.className = 'btn ' + (b.cls || 'btn-secondary');
            btn.innerHTML = (b.icon ? '<svg class="icon"><use href="#i-' + b.icon + '"/></svg> ' : '') + b.label;
            btn.onclick = b.act;
            f.appendChild(btn);
        });
        if (typeof opts.onMount === 'function') opts.onMount();
    }

    // krok s historii (umozni Zpet)
    function go(stepFn) { histStack.push(stepFn); stepFn(); }
    function back() { if (histStack.length > 1) { histStack.pop(); histStack[histStack.length - 1](); } else closeWizard(); }
    function reset() { histStack = []; }

    // karta-volba (velke tlacitko se titulkem, podtitulkem a znackou)
    function card(title, sub, act, opts) {
        opts = opts || {};
        return '<button class="pruv-card" onclick="__pruv.cardClick(\'' + opts.key + '\')">'
            + '<div class="pruv-card-t">' + esc(title) + (opts.badge != null ? ' ' + badge(opts.badge) : '') + '</div>'
            + (sub ? '<div class="pruv-card-s">' + esc(sub) + '</div>' : '')
            + '</button>';
    }
    // registr akci pro karty (obejdeme problem s predavanim funkci pres onclick string)
    var _cardActs = {};
    function cards(list) {
        _cardActs = {};
        var html = '';
        list.forEach(function (c, i) {
            var key = 'c' + i; _cardActs[key] = c.act;
            html += card(c.title, c.sub, c.act, { key: key, badge: c.badge });
        });
        return html;
    }

    // ============================================================
    // KROK 1 — Co budeme delat?
    // ============================================================
    function stepActivity() {
        W.active = false; W.activity = null; W.collecting = false; W.doneShown = false; W.savedCount = 0;
        render({
            title: 'Co budeme dělat?',
            crumb: 'Vyber činnost',
            body: cards([
                { title: 'Vytyčování', sub: 'Najít v terénu navržené body a odškrtávat vytyčené.', badge: false, act: function () { W.activity = 'stake'; go(stepProject); } },
                { title: 'Sběr / zaměřování bodů', sub: 'Sbírat nové body průměrováním GPS na místě.', badge: false, act: function () { W.activity = 'collect'; go(stepProject); } },
                { title: 'Vyhledání úředních bodů', sub: 'Dohledat bodové pole (TB, ZHB, nivelační) z katastru.', badge: true, act: function () { W.activity = 'official'; go(stepProject); } },
                { title: 'Měření', sub: 'Vzdálenost mezi dvěma body nebo plocha z mapy.', badge: false, act: function () { W.activity = 'measure'; go(stepMeasure); } }
            ]),
            footer: [{ label: 'Zavřít', cls: 'btn-secondary', act: closeWizard }]
        });
    }

    function activityLabel() {
        return { stake: 'Vytyčování', collect: 'Sběr bodů', official: 'Úřední body', measure: 'Měření' }[W.activity] || '';
    }

    // ============================================================
    // KROK 2 — Zakazka (jen A/B/C; mereni preskakuje)
    // ============================================================
    function stepProject() {
        var existing = (typeof projects !== 'undefined' && Array.isArray(projects)) ? projects : [];
        var sel = '';
        if (existing.length) {
            sel = '<label style="margin-top:14px;">…nebo pokračovat v existující zakázce:</label>'
                + '<select id="pruv-proj-sel" style="width:100%;">'
                + existing.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === activeProjectId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('')
                + '</select>';
        }
        render({
            title: 'Zakázka',
            crumb: activityLabel() + ' › Zakázka',
            body: '<label>Název nové zakázky:</label>'
                + '<input type="text" id="pruv-proj-name" placeholder="Např. Novostavba Lhota" autocomplete="off">'
                + sel,
            footer: [
                { label: 'Zpět', cls: 'btn-secondary', act: back },
                existing.length ? { label: 'Pokračovat v této', cls: 'btn-secondary', act: function () { var s = document.getElementById('pruv-proj-sel'); selectProject(s.value); afterProject(); } } : null,
                { label: 'Založit a pokračovat', cls: 'btn-primary', icon: 'plus', act: function () { var nm = (document.getElementById('pruv-proj-name').value || '').trim(); if (!nm) { alert('Zadej název zakázky, nebo vyber existující.'); return; } createProject(nm).then(afterProject); } }
            ].filter(Boolean),
            onMount: function () { var i = document.getElementById('pruv-proj-name'); if (i) i.focus(); }
        });
    }

    function createProject(name) {
        var id = 'proj_' + Date.now();
        projects.push({ id: id, name: name });
        try { localStorage.setItem('arProjectsList', JSON.stringify(projects)); } catch (e) {}
        activeProjectId = id;
        try { localStorage.setItem('arActiveProjectId', activeProjectId); } catch (e) {}
        if (typeof renderProjectSelect === 'function') renderProjectSelect();
        if (typeof hydrateActiveProject === 'function') return hydrateActiveProject().then(function () { if (typeof loadProjectSettings === 'function') loadProjectSettings(); });
        return Promise.resolve();
    }
    function selectProject(id) {
        if (!id) return;
        activeProjectId = id;
        try { localStorage.setItem('arActiveProjectId', id); } catch (e) {}
        var w = document.getElementById('w-project-select'); if (w) w.value = id;
        if (typeof hydrateActiveProject === 'function') hydrateActiveProject().then(function () { if (typeof loadProjectSettings === 'function') loadProjectSettings(); });
        if (typeof renderProjectSelect === 'function') renderProjectSelect();
    }

    function afterProject() {
        if (W.activity === 'stake') go(stepStakeSource);
        else if (W.activity === 'collect') go(stepCollectConfig);
        else if (W.activity === 'official') go(stepOfficial);
    }

    // ============================================================
    // VETEV A — Vytycovani
    // ============================================================
    function stepStakeSource() {
        render({
            title: 'Odkud body k vytyčení?',
            crumb: 'Vytyčování › Zdroj bodů',
            body: cards([
                { title: 'Napsat / vložit souřadnice', sub: 'Vlož řádky „číslo;Y;X" (S-JTSK).', badge: false, act: function () { go(stepStakePaste); } },
                { title: 'Naimportovat soubor', sub: 'CSV, TXT nebo JSON se seznamem bodů.', badge: false, act: function () { triggerImport(); } },
                { title: 'Použít body už v zakázce', sub: 'Vytyčovat vlastní body, které už jsou vložené.', badge: false, act: function () { go(stepReadyStake); } },
                { title: 'Úřední body z katastru', sub: 'Vytyčit oficiální TB / ZHB / podrobné body.', badge: true, act: function () { W._stakeOfficial = true; go(stepOfficial); } }
            ]),
            footer: [{ label: 'Zpět', cls: 'btn-secondary', act: back }]
        });
    }

    function triggerImport() {
        var inp = document.getElementById('import-file');
        if (!inp) { alert('Import není dostupný.'); return; }
        inp.click();
        // importPoints() po vyberu sam naimportuje a zobrazi hlasku; pak nabidneme pokracovani
        render({
            title: 'Import souboru',
            crumb: 'Vytyčování › Import',
            body: '<p style="font-size:14px; line-height:1.5;">Vyber soubor s body. Až ho appka naimportuje (zobrazí hlášku „Importováno…"), klepni na <b>Pokračovat na vytyčování</b>.</p>'
                + '<p style="font-size:13px; opacity:0.75;">Podporováno: CSV/TXT s řádky <code>číslo;Y;X</code> nebo JSON.</p>',
            footer: [
                { label: 'Zpět', cls: 'btn-secondary', act: back },
                { label: 'Vybrat soubor znovu', cls: 'btn-secondary', icon: 'folder', act: function () { inp.click(); } },
                { label: 'Pokračovat na vytyčování', cls: 'btn-primary', act: function () { go(stepReadyStake); } }
            ]
        });
    }

    function stepStakePaste() {
        render({
            title: 'Vložit souřadnice',
            crumb: 'Vytyčování › Souřadnice',
            body: '<label>Body v S-JTSK (každý na řádek, „číslo;Y;X"):</label>'
                + '<textarea id="pruv-paste" rows="7" style="width:100%; font-family:var(--font-mono,monospace); font-size:13px;" placeholder="101;743210.50;1043330.25&#10;102;743225.10;1043351.80"></textarea>'
                + '<div id="pruv-paste-prev" style="font-size:13px; margin-top:8px;"></div>',
            footer: [
                { label: 'Zpět', cls: 'btn-secondary', act: back },
                { label: 'Zkontrolovat', cls: 'btn-secondary', icon: 'check', act: previewPaste },
                { label: 'Vložit a pokračovat', cls: 'btn-primary', act: commitPaste }
            ]
        });
    }

    function parsePasteField() {
        var txt = (document.getElementById('pruv-paste') || {}).value || '';
        if (!txt.trim()) return [];
        try { return parseCoordsCSV(txt); } catch (e) { return []; }
    }
    function previewPaste() {
        var pts = parsePasteField();
        var div = document.getElementById('pruv-paste-prev');
        if (!pts.length) { div.innerHTML = '<span style="color:#f87171;">Nenašel jsem žádný platný řádek. Čekám formát „číslo;Y;X".</span>'; return; }
        var outside = pts.filter(function (p) { return !(p.lat > 48 && p.lat < 51.2 && p.lng > 12 && p.lng < 19); }).length;
        var names = {}; var dup = 0;
        pts.forEach(function (p) { if (names[p.name]) dup++; names[p.name] = 1; });
        var sample = pts.slice(0, 4).map(function (p) { return '#' + esc(p.name); }).join(', ') + (pts.length > 4 ? ' …' : '');
        div.innerHTML = '<b style="color:var(--accent);">Rozpoznáno ' + pts.length + ' bodů.</b><br>' + sample
            + (dup ? '<br><span style="color:#fbbf24;">⚠ ' + dup + 'x stejné číslo bodu</span>' : '')
            + (outside ? '<br><span style="color:#fbbf24;">⚠ ' + outside + ' bodů leží mimo ČR — zkontroluj pořadí Y/X</span>' : '');
    }
    function commitPaste() {
        var pts = parsePasteField();
        if (!pts.length) { alert('Nenašel jsem žádný platný bod. Zkontroluj formát „číslo;Y;X".'); return; }
        var added = addParsedPoints(pts);
        alert('Vloženo ' + added + ' bodů do zakázky.');
        go(stepReadyStake);
    }

    // vlozeni rozparsovanych bodu — zrcadli logiku importPoints() z logika.js
    function addParsedPoints(arr) {
        if (typeof persistentCustomPoints === 'undefined') return 0;
        var added = 0;
        arr.forEach(function (p) {
            if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || isNaN(p.lat) || isNaN(p.lng)) return;
            if (!persistentCustomPoints.find(function (ex) { return ex.name === p.name && Math.abs(ex.lat - p.lat) < 0.0001; })) {
                persistentCustomPoints.push({ id: 'cp_' + Date.now() + '_' + Math.round(Math.random() * 1e6), name: p.name || 'Bod', lat: p.lat, lng: p.lng, cat: 'CUSTOM', type: 'custom' });
                added++;
            }
        });
        try { setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints)); } catch (e) {}
        if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap();
        if (typeof renderManageList === 'function') renderManageList();
        if (typeof userLat !== 'undefined' && userLat && userLng && typeof initFetch === 'function') initFetch(userLat, userLng);
        return added;
    }

    function stepReadyStake() {
        var hasGps = (typeof userLat !== 'undefined' && userLat != null);
        var off = !isOnline();
        render({
            title: 'Připraveno k vytyčování',
            crumb: 'Vytyčování › Kontrola',
            body: '<div class="pruv-check">' + (hasGps ? '✓ GPS poloha k dispozici' : '⏳ Čekám na GPS signál — venku se ustálí během chvíle') + '</div>'
                + '<div class="pruv-check">' + (off ? '○ Jsi offline — vytyčování i checklist fungují, ale mapový podklad se nenačte, pokud není stažený' : '✓ Online — mapový podklad se načte') + '</div>'
                + '<p style="font-size:13px; opacity:0.8; margin-top:10px;">Spustím vytyčovací checklist seřazený podle vzdálenosti. U každého bodu klepni „Vytyčeno" až ho zatlučeš.</p>',
            footer: [
                { label: 'Zpět', cls: 'btn-secondary', act: back },
                { label: 'Uložit mapu pro offline', cls: 'btn-secondary', icon: 'download', act: function () { if (typeof saveForOffline === 'function') saveForOffline(); } },
                { label: 'Spustit vytyčování', cls: 'btn-primary', icon: 'check', act: launchStake }
            ]
        });
    }

    function launchStake() {
        W.active = true; W.doneShown = false;
        ensureAppStarted(function () {
            setWizardView('both');
            applyFilters({ custom: true });
            closeWizard();
            if (typeof openStakeoutModal === 'function') openStakeoutModal();
        });
    }

    // ============================================================
    // VETEV B — Sber bodu
    // ============================================================
    function stepCollectConfig() {
        var c = W.collect;
        render({
            title: 'Nastavení sběru bodů',
            crumb: 'Sběr bodů › Nastavení',
            body: '<p style="font-size:13px; opacity:0.8; margin-top:0;">Nastav si, jak se mají body číslovat a jakou přesnost chceš. Vše můžeš změnit.</p>'
                + '<label>Předpona čísla (volitelné):</label><input type="text" id="pruv-c-prefix" value="' + esc(c.prefix) + '" placeholder="např. B nebo prázdné">'
                + '<label>Počáteční číslo:</label><input type="number" id="pruv-c-start" value="' + (c.n || 1) + '" step="1">'
                + '<label>Krok číslování:</label><input type="number" id="pruv-c-step" value="' + (c.step || 1) + '" step="1">'
                + '<label>Práh přesnosti (m, volitelné — varuje při horší):</label><input type="number" id="pruv-c-thr" value="' + (c.threshold != null ? c.threshold : '') + '" step="0.01" placeholder="např. 0.30">'
                + '<label class="filter-row" style="margin-top:10px;"><input type="checkbox" id="pruv-c-foto"' + (c.foto ? ' checked' : '') + '> Připomínat fotku u každého bodu</label>',
            footer: [
                { label: 'Zpět', cls: 'btn-secondary', act: back },
                { label: 'Spustit sběr', cls: 'btn-primary', icon: 'locate', act: function () {
                    c.prefix = (document.getElementById('pruv-c-prefix').value || '').trim();
                    c.n = parseInt(document.getElementById('pruv-c-start').value, 10); if (isNaN(c.n)) c.n = 1;
                    c.step = parseInt(document.getElementById('pruv-c-step').value, 10); if (isNaN(c.step) || c.step === 0) c.step = 1;
                    var thr = parseFloat(document.getElementById('pruv-c-thr').value); c.threshold = isNaN(thr) ? null : thr;
                    c.foto = document.getElementById('pruv-c-foto').checked;
                    launchCollect();
                } }
            ]
        });
    }

    function launchCollect() {
        W.active = true; W.collecting = true; W.savedCount = 0;
        ensureAppStarted(function () {
            setWizardView('ar');
            applyFilters({ custom: true });
            // zapnout prumerovani GPS na miste
            var tg = document.getElementById('tgl-gpsavg'); if (tg) { tg.checked = true; if (typeof toggleHudElements === 'function') toggleHudElements(); }
            showCollectPanel();
        });
    }

    function makeCollectName() { return (W.collect.prefix || '') + W.collect.n; }

    function showCollectPanel() {
        showWizard();
        var c = W.collect;
        var accTxt = '';
        if (c.threshold != null) accTxt = '<div class="pruv-check">Cílová přesnost: ±' + c.threshold + ' m</div>';
        render({
            title: 'Sběr bodů',
            crumb: 'Sběr bodů › Probíhá',
            body: '<div style="text-align:center; margin:6px 0 12px;"><div style="font-size:34px; font-weight:800; color:var(--accent); font-family:var(--font-mono,monospace);">' + W.savedCount + '</div><div style="font-size:13px; opacity:0.7;">uložených bodů</div></div>'
                + '<div class="pruv-check">Další bod dostane číslo <b>#' + esc(makeCollectName()) + '</b></div>'
                + accTxt
                + (c.foto ? '<div class="pruv-check">📷 Nezapomeň přidat fotku v kartě bodu</div>' : '')
                + '<p style="font-size:13px; opacity:0.8; margin-top:10px;">Postav se na bod, nech ustálit GPS, klepni „Zaměřit bod" a v okně použij „Vyplnit z průměru GPS" + Uložit.</p>',
            footer: [
                { label: 'Hotovo', cls: 'btn-secondary', act: function () { W.collecting = false; stepDone(); } },
                { label: 'Zaměřit bod', cls: 'btn-primary', icon: 'locate', act: function () {
                    closeWizard();
                    if (typeof openNewPointModal === 'function') openNewPointModal();
                    setTimeout(function () { var el = document.getElementById('custom-name'); if (el) el.value = makeCollectName(); }, 30);
                } }
            ]
        });
    }

    // ============================================================
    // VETEV C — Uredni body (online)
    // ============================================================
    function stepOfficial() {
        var off = !isOnline();
        render({
            title: 'Vyhledání úředních bodů',
            crumb: (W._stakeOfficial ? 'Vytyčování' : 'Úřední body') + ' › Katastr',
            body: (off ? '<div class="pruv-warn">⚠ Jsi offline. Úřední body se stahují z katastru a potřebují připojení. Mapový podklad si můžeš předem stáhnout tlačítkem níže.</div>' : '<div class="pruv-check">✓ Online — body se načtou z katastru ČÚZK.</div>')
                + '<label style="margin-top:12px;">Které body hledat?</label>'
                + '<div class="filter-group">'
                + '<label class="filter-row"><input type="checkbox" id="pruv-o-tb" checked> Trigonometrické (TB)</label>'
                + '<label class="filter-row"><input type="checkbox" id="pruv-o-zhb" checked> Zhušťovací (ZHB)</label>'
                + '<label class="filter-row"><input type="checkbox" id="pruv-o-pbpp" checked> Podrobné polohové</label>'
                + '<label class="filter-row"><input type="checkbox" id="pruv-o-nivel" checked> Výškové / nivelační</label>'
                + '</div>',
            footer: [
                { label: 'Zpět', cls: 'btn-secondary', act: back },
                { label: 'Stáhnout pro offline', cls: 'btn-secondary', icon: 'download', act: function () { if (typeof saveForOffline === 'function') saveForOffline(); } },
                { label: (W._stakeOfficial ? 'Pokračovat na vytyčování' : 'Zobrazit body'), cls: 'btn-primary', icon: 'map-pin', act: function () {
                    var cats = {
                        tb: document.getElementById('pruv-o-tb').checked,
                        zhb: document.getElementById('pruv-o-zhb').checked,
                        pbpp: document.getElementById('pruv-o-pbpp').checked,
                        nivel: document.getElementById('pruv-o-nivel').checked
                    };
                    if (W._stakeOfficial) { applyFilters(cats); W._stakeOfficial = false; go(stepReadyStake); }
                    else launchOfficial(cats);
                } }
            ]
        });
    }

    function launchOfficial(cats) {
        W.active = true;
        ensureAppStarted(function () {
            setWizardView('map');
            applyFilters(cats);
            closeWizard();
        });
    }

    // ============================================================
    // VETEV D — Mereni
    // ============================================================
    function stepMeasure() {
        render({
            title: 'Měření',
            crumb: 'Měření',
            body: cards([
                { title: 'Vzdálenost mezi dvěma body', sub: 'Zaměř dvě pozice a změř jejich vzdálenost.', badge: false, act: function () { ensureAppStarted(function () { closeWizard(); if (typeof openMeasureModal === 'function') openMeasureModal(); }); } },
                { title: 'Plocha z mapy', sub: 'Naklikej vrcholy v mapě a spočítej výměru.', badge: false, act: function () { ensureAppStarted(function () { closeWizard(); if (typeof startAreaMode === 'function') startAreaMode(); }); } }
            ]),
            footer: [{ label: 'Zpět', cls: 'btn-secondary', act: back }]
        });
    }

    // ============================================================
    // KONECNA SMYCKA — "je jeste neco potreba?"
    // ============================================================
    function stepDone() {
        W.doneShown = true;
        var f = [];
        if (W.activity === 'stake') f.push({ label: 'Export protokolu vytyčení', cls: 'btn-secondary', icon: 'upload', act: function () { if (typeof exportStakeoutCSV === 'function') exportStakeoutCSV(); } });
        if (W.activity === 'collect') f.push({ label: 'Spravovat / exportovat body', cls: 'btn-secondary', icon: 'wrench', act: function () { closeWizard(); if (typeof openManageModal === 'function') openManageModal(); } });
        f.push({ label: 'Nová činnost', cls: 'btn-secondary', icon: 'navigation', act: function () { reset(); go(stepActivity); } });
        f.push({ label: 'Hotovo', cls: 'btn-primary', icon: 'check', act: function () { W.active = false; closeWizard(); } });
        showWizard();
        render({
            title: 'Hotovo 🎉',
            crumb: activityLabel() + ' › Dokončeno',
            body: '<p style="font-size:14px; line-height:1.55;">' + activityLabel() + ' je hotové'
                + (W.activity === 'collect' ? ' — uloženo ' + W.savedCount + ' bodů.' : '.')
                + '</p><p style="font-size:14px;">Je ještě něco potřeba, nebo chceš výsledek uložit / exportovat?</p>',
            footer: f
        });
    }

    // detekce dokonceni vytycovani (vsechny kandidati odskrtnuti)
    function allStaked() {
        if (typeof stakeoutCandidates !== 'function' || typeof isStaked !== 'function') return false;
        var c = stakeoutCandidates();
        return c.length > 0 && c.every(function (p) { return isStaked(p.id); });
    }

    // ============================================================
    // spolecne — start appky, pohled, filtry
    // ============================================================
    function ensureAppStarted(cb) {
        if (typeof appStarted !== 'undefined' && appStarted) { cb(); return; }
        // jsme jeste na uvodni obrazovce — spustime appku a pockame na inicializaci mapy/AR
        if (typeof startAppFromWelcome === 'function') { try { startAppFromWelcome(); } catch (e) {} }
        setTimeout(cb, 700);
    }

    function setWizardView(mode) {
        if (typeof setView === 'function') {
            var btn = document.querySelector('#view-seg .seg-btn[data-view="' + mode + '"]');
            setView(mode, btn);
        }
    }

    // zapne pozadovane kategorie bodu (nic nevypina, aby se neskryly jine body)
    function applyFilters(cats) {
        if (typeof filters === 'undefined') return;
        Object.keys(cats).forEach(function (k) { if (cats[k]) filters[k] = true; });
        try { setStoredData('arFilters12', JSON.stringify(filters)); } catch (e) {}
        // synchronizace zaskrtavatek v Nastaveni i na uvodu
        [['tb', 'f-tb'], ['zhb', 'f-zhb'], ['pbpp', 'f-pbpp'], ['nivel', 'f-nivel'], ['custom', 'f-custom'],
         ['tb', 'w-f-tb'], ['zhb', 'w-f-zhb'], ['pbpp', 'w-f-pbpp'], ['nivel', 'w-f-nivel'], ['custom', 'w-f-custom']].forEach(function (m) {
            var el = document.getElementById(m[1]); if (el && filters[m[0]] != null) el.checked = !!filters[m[0]];
        });
        if (typeof appStarted !== 'undefined' && appStarted) {
            if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap();
            if (typeof initARMarkers === 'function') initARMarkers();
            if (typeof userLat !== 'undefined' && userLat && userLng && typeof initFetch === 'function') initFetch(userLat, userLng);
        }
    }

    // ============================================================
    // verejny vstup + napojeni
    // ============================================================
    window.openPruvodce = function () {
        var menu = document.getElementById('side-menu'); if (menu && menu.classList.contains('open') && typeof toggleMenu === 'function') toggleMenu();
        reset(); showWizard(); go(stepActivity);
    };

    // namespace pro karty (onclick string -> realna akce)
    window.__pruv = { cardClick: function (key) { if (_cardActs[key]) _cardActs[key](); } };

    // wrap saveCustomPoint — pri sberu napocita ulozeny bod a vrati panel
    if (typeof saveCustomPoint === 'function') {
        var _origSave = saveCustomPoint;
        saveCustomPoint = function () {
            var before = (typeof persistentCustomPoints !== 'undefined') ? persistentCustomPoints.length : 0;
            var isEdit = (typeof editingCustomPointId !== 'undefined' && editingCustomPointId);
            _origSave.apply(this, arguments);
            var after = (typeof persistentCustomPoints !== 'undefined') ? persistentCustomPoints.length : 0;
            if (W.collecting && !isEdit && after > before) {
                W.collect.n += W.collect.step;
                W.savedCount++;
                setTimeout(showCollectPanel, 50);
            }
        };
    }

    // wrap toggleStaked — pri vytycovani pres pruvodce nabidne konec po odskrtnuti vsech
    if (typeof toggleStaked === 'function') {
        var _origToggle = toggleStaked;
        toggleStaked = function (pt) {
            _origToggle(pt);
            try {
                if (W.active && W.activity === 'stake' && !W.doneShown && allStaked()) {
                    var sm = document.getElementById('stakeout-modal'); if (sm) sm.style.display = 'none';
                    stepDone();
                }
            } catch (e) {}
        };
    }

    // vstupni tlacitka (injektovana, at se nesaha do HTML)
    function injectEntries() {
        // bocni menu — nahoru
        var menu = document.getElementById('side-menu');
        if (menu && !document.getElementById('pruv-menu-btn')) {
            var b = document.createElement('button');
            b.id = 'pruv-menu-btn'; b.className = 'menu-btn';
            b.style.background = 'rgba(52,211,153,0.15)'; b.style.borderColor = 'var(--accent)'; b.style.color = 'var(--accent)';
            b.innerHTML = '<svg class="icon"><use href="#i-navigation"/></svg> Průvodce úkolem';
            b.onclick = function () { window.openPruvodce(); };
            menu.insertBefore(b, menu.firstChild);
        }
        // uvodni obrazovka — pred tlacitkem Spustit
        var startBtn = document.querySelector('#welcome-screen button.btn-primary');
        if (startBtn && !document.getElementById('pruv-welcome-btn')) {
            var w = document.createElement('button');
            w.id = 'pruv-welcome-btn'; w.className = 'btn btn-secondary';
            w.style.marginTop = '12px'; w.style.borderColor = 'var(--accent)'; w.style.color = 'var(--accent)';
            w.innerHTML = '<svg class="icon"><use href="#i-navigation"/></svg> Průvodce úkolem (provede tě krok za krokem)';
            w.onclick = function () { window.openPruvodce(); };
            startBtn.parentNode.insertBefore(w, startBtn);
        }
    }
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', injectEntries);
    else injectEntries();

    // ---------- styly (injektovane) ----------
    (function () {
        var st = document.createElement('style');
        st.textContent =
            '.pruv-card{display:block;width:100%;text-align:left;background:rgba(255,255,255,0.05);border:1px solid var(--glass-border);border-radius:12px;padding:14px;margin-bottom:10px;color:var(--text-color);cursor:pointer;transition:background .15s,border-color .15s;}'
            + '.pruv-card:hover,.pruv-card:active{background:rgba(52,211,153,0.12);border-color:var(--accent);}'
            + '.pruv-card-t{font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
            + '.pruv-card-s{font-size:13px;opacity:0.72;margin-top:4px;line-height:1.4;}'
            + '.pruv-badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;white-space:nowrap;}'
            + '.pruv-badge.on{background:rgba(16,185,129,0.2);color:#34d399;}'
            + '.pruv-badge.off{background:rgba(251,191,36,0.18);color:#fbbf24;}'
            + '.pruv-check{font-size:13px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);}'
            + '.pruv-warn{font-size:13px;line-height:1.5;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.35);color:#fbbf24;border-radius:10px;padding:10px;}'
            + '#pruvodce-modal .modal-body{max-height:60vh;overflow-y:auto;}';
        document.head.appendChild(st);
    })();
})();
