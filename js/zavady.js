// ===== AR Geodet — ZÁVADY / HLÁŠENÍ PORUCH V TERÉNU (ODPOJITELNÁ vrstva) ========
// Neinvazivní vrstva ve stylu js/utility-networks.js: NEEDITUJE logika.js ani
// grafika.js. Přidá nástroj „Závady / hlášení":
//
//   • Zápis nálezu na jedno ťuknutí: foto → kategorie → závažnost (1–3) → poznámka.
//     Poloha, čas, přesnost GPS a zakázka se doplní samy z toho, co appka už má.
//   • Rychlý vstup: DLOUHÝ STISK tlačítka „Nový bod" v doku otevře rovnou formulář
//     závady (krátké ťuknutí dál otevírá normální nový bod — nic se nemění).
//   • Závady jsou barevné vykřičníky v mapě i v AR (podle závažnosti), oddělené
//     od měřených bodů. Vyřešené z mapy/AR zmizí, v seznamu zůstanou.
//   • Seznam s filtrem otevřené/vyřešené, řazení závažnost → vzdálenost.
//   • Export: CSV (S-JTSK) a tiskový protokol s fotkami (Sdílet/Uložit jako PDF
//     přes systémový tisk).
//
// Fotky se ukládají zmenšené (JPEG ~1280 px) do IndexedDB 'arGeodetZavady' —
// nezaplácnou localStorage. Záznamy per zakázka pod klíčem '<pid>_zavady'.
// Vstup: dlaždice „Závady / hlášení" v Nástrojích (agRegisterFieldTool).
// Odstranění: smaž js/zavady.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'
        + '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

    var KEY_SUFFIX = '_zavady';
    var PDB = 'arGeodetZavady', PSTORE = 'fotky';
    var R2D = 180 / Math.PI;

    // Kategorie nálezů — pokládka (uživatelův hlavní workflow) + obecné geodetické
    var CATS = [
        { id: 'vyska',    label: 'Výška mimo toleranci' },
        { id: 'tloustka', label: 'Tloušťka vrstvy' },
        { id: 'sklon',    label: 'Sklon / příčný spád' },
        { id: 'spara',    label: 'Spára / napojení' },
        { id: 'hutneni',  label: 'Hutnění / povrch' },
        { id: 'poklop',   label: 'Poklop / vpusť' },
        { id: 'bod-zn',   label: 'Bod zničen / chybí' },
        { id: 'bod-pos',  label: 'Bod posunut' },
        { id: 'sit',      label: 'Kolize se sítí' },
        { id: 'gp',       label: 'Neshoda s dokumentací' },
        { id: 'jine',     label: 'Jiné' }
    ];
    var SEV = {
        1: { label: 'Drobná',   color: '#fbbf24' },
        2: { label: 'Vážná',    color: '#fb923c' },
        3: { label: 'Kritická', color: '#fb7185' }
    };

    // stav
    var _list = [];            // [{id,cat,sev,note,lat,lng,acc,ts,resolved,resolvedTs,foto}]
    var _pid = null;
    var _filter = 'open';      // open | done | all
    var _mapGroup = null;
    var _arSvg = null, _arRAF = null;
    var _formPhoto = null;     // dataURL rozpracované fotky
    var _formPos = null;       // {lat,lng,acc,src} rozpracovaná poloha (src: gps|map|bod)
    var _formPt = null;        // {id,name} bod, ke kterému se závada váže (volitelné)
    var _editId = null;        // detail otevřené závady

    // ---- pomocné ----------------------------------------------------------------
    function agAlertW(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} try { alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e2) {} }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function haveUser() { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); }
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function storeKey() { return pid() + KEY_SUFFIX; }
    function dist2user(z) {
        if (!haveUser() || typeof getDistance !== 'function') return null;
        try { return getDistance(userLat, userLng, z.lat, z.lng); } catch (e) { return null; }
    }
    function fmtDist(d) { return d == null ? '' : (d < 995 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'); }
    function fmtTs(ts) { try { var d = new Date(ts); return d.toLocaleDateString('cs-CZ') + ' ' + d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
    function catLabel(id) { for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i].label; return id || '—'; }
    function toSJTSK(lat, lng) {
        try { if (window.GeoCore && GeoCore.toSJTSK) return GeoCore.toSJTSK(lat, lng); } catch (e) {}
        try { if (typeof proj4 === 'function') { var c = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); return { y: Math.abs(c[0]), x: Math.abs(c[1]) }; } } catch (e2) {}
        return null;
    }

    // ---- úložiště záznamů ---------------------------------------------------------
    function load() {
        _pid = pid();
        try { var a = JSON.parse(localStorage.getItem(storeKey())); _list = Array.isArray(a) ? a : []; }
        catch (e) { _list = []; }
    }
    function persist() {
        try { localStorage.setItem(storeKey(), JSON.stringify(_list)); }
        catch (e) { agAlertW('Závadu se nepodařilo uložit', 'Úložiště je nejspíš plné. Smaž staré vyřešené závady, nebo uvolni místo.'); }
    }

    // ---- fotky (IndexedDB, zmenšené) — vzor js/vylepseni.js ------------------------
    function photoDB() {
        return new Promise(function (res, rej) {
            if (typeof indexedDB === 'undefined') { rej(new Error('no idb')); return; }
            var r = indexedDB.open(PDB, 1);
            r.onupgradeneeded = function () { try { r.result.createObjectStore(PSTORE); } catch (e) {} };
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { rej(r.error); };
        });
    }
    function photoPut(k, v) { return photoDB().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(PSTORE, 'readwrite'); tx.objectStore(PSTORE).put(v, k); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }
    function photoGet(k) { return photoDB().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(PSTORE, 'readonly'); var rq = tx.objectStore(PSTORE).get(k); rq.onsuccess = function () { res(rq.result || null); }; rq.onerror = function () { rej(rq.error); }; }); }); }
    function photoDel(k) { return photoDB().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(PSTORE, 'readwrite'); tx.objectStore(PSTORE).delete(k); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }).catch(function () {}); }
    function photoKey(z) { return _pid + '_' + z.id; }
    function downscale(file, maxDim, quality) {
        return new Promise(function (res) {
            var img = new Image();
            var url = URL.createObjectURL(file);
            img.onload = function () {
                var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
                var sc = Math.min(1, maxDim / Math.max(w, h));
                var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
                var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
                try { cv.getContext('2d').drawImage(img, 0, 0, cw, ch); } catch (e) {}
                URL.revokeObjectURL(url);
                try { res(cv.toDataURL('image/jpeg', quality)); } catch (e) { res(null); }
            };
            img.onerror = function () { URL.revokeObjectURL(url); res(null); };
            img.src = url;
        });
    }

    // ---- styly ---------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('ag-zv-style')) return;
        var st = document.createElement('style');
        st.id = 'ag-zv-style';
        st.textContent = [
            '.ag-zv-ov{position:fixed;inset:0;z-index:1000050;display:none;align-items:center;justify-content:center;background:rgba(4,8,12,0.62);}',
            '.ag-zv-ov.open{display:flex;}',
            '.ag-zv-card{width:100%;height:100%;display:flex;flex-direction:column;padding:calc(env(safe-area-inset-top,0px) + 16px) 16px calc(env(safe-area-inset-bottom,0px) + 12px);',
            '  background:var(--glass-bg,rgba(14,18,24,0.97));color:var(--text-color,#eceef2);}',
            '.ag-zv-card h3{margin:0 0 10px;color:var(--accent,#2f9e74);font-size:18px;display:flex;align-items:center;gap:8px;}',
            '.ag-zv-card h3 svg{width:20px;height:20px;}',
            '.ag-zv-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;min-height:0;}',
            '.ag-zv-foot{display:flex;gap:8px;padding-top:10px;flex-wrap:wrap;}',
            '.ag-zv-foot .btn{flex:1;margin:0;min-width:110px;}',
            // filtr
            '.ag-zv-chips{display:flex;gap:6px;margin:0 0 10px;}',
            '.ag-zv-chip{flex:1;padding:9px 6px;border-radius:999px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:transparent;',
            '  color:var(--text-muted,#9aa1ac);font:600 13px/1 var(--font-ui,system-ui);cursor:pointer;text-align:center;}',
            '.ag-zv-chip.on{background:var(--accent-soft,rgba(47,158,116,0.15));color:var(--accent,#2f9e74);border-color:var(--accent-line,rgba(47,158,116,0.4));}',
            // řádek seznamu
            '.ag-zv-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:11px 12px;margin-bottom:7px;border-radius:12px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.10));background:var(--surface-1,rgba(255,255,255,0.05));color:inherit;cursor:pointer;}',
            '.ag-zv-row.done{opacity:0.55;}',
            '.ag-zv-sev{flex:0 0 auto;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 16px/1 var(--font-ui,system-ui);color:#1a1205;}',
            '.ag-zv-mid{flex:1;min-width:0;}',
            '.ag-zv-t{font:600 14px/1.3 var(--font-ui,system-ui);}',
            '.ag-zv-s{font-size:12px;color:var(--text-muted,#9aa1ac);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.ag-zv-d{flex:0 0 auto;font:600 12.5px/1 var(--font-mono,monospace);color:var(--data,#e6bd76);}',
            '.ag-zv-empty{padding:24px 10px;text-align:center;color:var(--text-muted,#9aa1ac);font-size:13.5px;line-height:1.5;}',
            // formulář
            '.ag-zv-lbl{display:block;margin:12px 2px 6px;font:600 12px/1 var(--font-ui,system-ui);letter-spacing:0.05em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.ag-zv-cats{display:flex;flex-wrap:wrap;gap:6px;}',
            '.ag-zv-cat{padding:9px 12px;border-radius:999px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:transparent;color:var(--text-color,#eceef2);font:600 13px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '.ag-zv-cat.on{background:var(--accent-soft,rgba(47,158,116,0.15));color:var(--accent,#2f9e74);border-color:var(--accent-line,rgba(47,158,116,0.4));}',
            '.ag-zv-sevseg{display:flex;gap:6px;}',
            '.ag-zv-sevb{flex:1;padding:11px 6px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:transparent;color:var(--text-color,#eceef2);font:700 13.5px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '.ag-zv-sevb.on{color:#1a1205;}',
            '.ag-zv-note{width:100%;box-sizing:border-box;min-height:64px;padding:10px 12px;border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  background:var(--surface-1,rgba(255,255,255,0.05));color:inherit;font:500 14px/1.4 var(--font-ui,system-ui);outline:none;resize:vertical;}',
            '.ag-zv-pos{margin-top:6px;padding:9px 12px;border-radius:10px;background:var(--surface-1,rgba(255,255,255,0.05));font-size:12.5px;color:var(--text-muted,#9aa1ac);}',
            '.ag-zv-pos b{color:var(--text-color,#eceef2);}',
            '.ag-zv-thumb{margin-top:6px;}',
            '.ag-zv-thumb img{max-width:100%;max-height:180px;border-radius:12px;display:block;}',
            // detail
            '.ag-zv-detimg{max-width:100%;border-radius:12px;display:block;margin:8px 0;}',
            '.ag-zv-kv{display:flex;justify-content:space-between;gap:12px;padding:6px 2px;font-size:13.5px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.07));}',
            '.ag-zv-kv span{color:var(--text-muted,#9aa1ac);}',
            // rukavice + outdoor
            'body.ag-glove .ag-zv-chip,body.ag-glove .ag-zv-cat{padding:12px 14px;font-size:14px;}',
            'body.ag-glove .ag-zv-row{padding:14px 12px;}',
            'body.outdoor-mode .ag-zv-card{background:#0a0e1a;}',
            'body.light-mode.outdoor-mode .ag-zv-card{background:#ffffff;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- modály ---------------------------------------------------------------------
    function ensureOv(id, html) {
        var m = document.getElementById(id);
        if (m) return m;
        m = document.createElement('div');
        m.id = id; m.className = 'ag-zv-ov';
        m.innerHTML = html;
        document.body.appendChild(m);
        return m;
    }
    function openOv(id) { var m = document.getElementById(id); if (m) m.classList.add('open'); }
    function closeOv(id) { var m = document.getElementById(id); if (m) m.classList.remove('open'); }

    // ==== SEZNAM ======================================================================
    function ensureListModal() {
        var m = ensureOv('ag-zv-list-ov',
            '<div class="ag-zv-card">'
            + '<h3>' + ICON + ' Závady / hlášení</h3>'
            + '<div class="ag-zv-chips">'
            + '  <button type="button" class="ag-zv-chip" data-f="open">Otevřené</button>'
            + '  <button type="button" class="ag-zv-chip" data-f="done">Vyřešené</button>'
            + '  <button type="button" class="ag-zv-chip" data-f="all">Vše</button>'
            + '</div>'
            + '<div class="ag-zv-body" id="ag-zv-list"></div>'
            + '<div class="ag-zv-foot">'
            + '  <button type="button" class="btn btn-primary" id="ag-zv-new">+ Nová závada</button>'
            + '  <button type="button" class="btn btn-secondary" id="ag-zv-csv">CSV</button>'
            + '  <button type="button" class="btn btn-secondary" id="ag-zv-print">Protokol</button>'
            + '  <button type="button" class="btn btn-secondary" id="ag-zv-close">Zavřít</button>'
            + '</div></div>');
        if (!m._agInit) {
            m._agInit = true;
            m.querySelector('#ag-zv-new').addEventListener('click', function () { openForm(); });
            m.querySelector('#ag-zv-csv').addEventListener('click', exportCsv);
            m.querySelector('#ag-zv-print').addEventListener('click', printProtocol);
            m.querySelector('#ag-zv-close').addEventListener('click', function () { closeOv('ag-zv-list-ov'); });
            m.querySelectorAll('.ag-zv-chip').forEach(function (ch) {
                ch.addEventListener('click', function () { _filter = ch.getAttribute('data-f'); renderList(); });
            });
        }
        return m;
    }
    function filtered() {
        return _list.filter(function (z) {
            if (_filter === 'open') return !z.resolved;
            if (_filter === 'done') return !!z.resolved;
            return true;
        });
    }
    function renderList() {
        var m = ensureListModal();
        m.querySelectorAll('.ag-zv-chip').forEach(function (ch) { ch.classList.toggle('on', ch.getAttribute('data-f') === _filter); });
        var host = m.querySelector('#ag-zv-list');
        var rows = filtered().slice();
        // závažnost sestupně, pak vzdálenost vzestupně
        rows.forEach(function (z) { z._d = dist2user(z); });
        rows.sort(function (a, b) { return (b.sev - a.sev) || ((a._d == null ? 9e9 : a._d) - (b._d == null ? 9e9 : b._d)); });
        if (!rows.length) {
            var t = _filter === 'done' ? 'Žádné vyřešené závady.' : (_filter === 'open' ? 'Žádné otevřené závady. 👍' : 'Zatím žádné závady.');
            host.innerHTML = '<div class="ag-zv-empty">' + t + '<br><br>Tip: závadu zapíšeš i <b>dlouhým stiskem</b> tlačítka „Nový bod" v doku.</div>';
            return;
        }
        host.innerHTML = '';
        rows.forEach(function (z) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'ag-zv-row' + (z.resolved ? ' done' : '');
            var sv = SEV[z.sev] || SEV[1];
            b.innerHTML = '<span class="ag-zv-sev" style="background:' + sv.color + ';">!</span>'
                + '<span class="ag-zv-mid"><span class="ag-zv-t">' + esc(catLabel(z.cat)) + (z.ptName ? ' · ⌖ ' + esc(z.ptName) : '') + (z.resolved ? ' · vyřešeno' : '') + '</span>'
                + '<span class="ag-zv-s">' + esc(z.note || fmtTs(z.ts)) + '</span></span>'
                + '<span class="ag-zv-d">' + fmtDist(z._d) + '</span>';
            b.addEventListener('click', function () { openDetail(z.id); });
            host.appendChild(b);
        });
    }
    function openList() {
        syncProject();
        injectStyles();
        ensureListModal();
        renderList();
        openOv('ag-zv-list-ov');
    }

    // ==== FORMULÁŘ ====================================================================
    function ensureFormModal() {
        var catBtns = CATS.map(function (c) { return '<button type="button" class="ag-zv-cat" data-c="' + c.id + '">' + esc(c.label) + '</button>'; }).join('');
        var m = ensureOv('ag-zv-form-ov',
            '<div class="ag-zv-card">'
            + '<h3>' + ICON + ' Nová závada</h3>'
            + '<div class="ag-zv-body">'
            + '  <button type="button" class="btn btn-secondary" id="ag-zv-cap" style="margin:0;"><svg class="icon"><use href="#i-camera"/></svg> Vyfotit závadu</button>'
            + '  <input type="file" id="ag-zv-file" accept="image/*" capture="environment" style="display:none">'
            + '  <div class="ag-zv-thumb" id="ag-zv-thumb"></div>'
            + '  <label class="ag-zv-lbl">Měřený bod (volitelné)</label>'
            + '  <div style="display:flex;gap:8px;align-items:stretch;">'
            + '    <button type="button" class="btn btn-secondary" id="ag-zv-ptpick" style="margin:0;flex:1;">⌖ Vázat na bod…</button>'
            + '    <button type="button" class="btn btn-secondary" id="ag-zv-ptclear" style="margin:0;display:none;flex:0 0 auto;min-width:48px;">×</button>'
            + '  </div>'
            + '  <div class="ag-zv-pos" id="ag-zv-ptlab" style="display:none;"></div>'
            + '  <label class="ag-zv-lbl">Kategorie</label>'
            + '  <div class="ag-zv-cats" id="ag-zv-cats">' + catBtns + '</div>'
            + '  <label class="ag-zv-lbl">Závažnost</label>'
            + '  <div class="ag-zv-sevseg" id="ag-zv-sevseg">'
            + '    <button type="button" class="ag-zv-sevb" data-s="1">1 · Drobná</button>'
            + '    <button type="button" class="ag-zv-sevb" data-s="2">2 · Vážná</button>'
            + '    <button type="button" class="ag-zv-sevb" data-s="3">3 · Kritická</button>'
            + '  </div>'
            + '  <label class="ag-zv-lbl">Poznámka (volitelné)</label>'
            + '  <textarea class="ag-zv-note" id="ag-zv-note" placeholder="Např. „+4 cm nad projekt, staničení 1,240“"></textarea>'
            + '  <div class="ag-zv-pos" id="ag-zv-pos">Poloha: čekám na GPS…</div>'
            + '  <button type="button" class="btn btn-secondary" id="ag-zv-mappick" style="margin-top:8px;"><svg class="icon"><use href="#i-map-pin"/></svg> Vybrat polohu z mapy</button>'
            + '</div>'
            + '<div class="ag-zv-foot">'
            + '  <button type="button" class="btn btn-secondary" id="ag-zv-f-cancel">Zrušit</button>'
            + '  <button type="button" class="btn btn-primary" id="ag-zv-f-save">Uložit závadu</button>'
            + '</div></div>');
        if (!m._agInit) {
            m._agInit = true;
            m.querySelector('#ag-zv-cap').addEventListener('click', function () { var f = document.getElementById('ag-zv-file'); if (f) f.click(); });
            m.querySelector('#ag-zv-file').addEventListener('change', function (e) {
                var f = e.target.files && e.target.files[0]; e.target.value = '';
                if (!f) return;
                var cap = document.getElementById('ag-zv-cap'); var old = cap.innerHTML;
                cap.disabled = true; cap.textContent = 'Zpracovávám…';
                downscale(f, 1280, 0.72).then(function (data) {
                    _formPhoto = data || null;
                    var th = document.getElementById('ag-zv-thumb');
                    th.innerHTML = data ? '<img src="' + data + '" alt="foto závady">' : '';
                    cap.disabled = false; cap.innerHTML = old;
                });
            });
            m.querySelectorAll('.ag-zv-cat').forEach(function (b) {
                b.addEventListener('click', function () {
                    m.querySelectorAll('.ag-zv-cat').forEach(function (x) { x.classList.remove('on'); });
                    b.classList.add('on');
                });
            });
            m.querySelectorAll('.ag-zv-sevb').forEach(function (b) {
                b.addEventListener('click', function () {
                    m.querySelectorAll('.ag-zv-sevb').forEach(function (x) { x.classList.remove('on'); x.style.background = ''; x.style.borderColor = ''; });
                    b.classList.add('on');
                    var sv = SEV[parseInt(b.getAttribute('data-s'), 10)];
                    b.style.background = sv.color; b.style.borderColor = sv.color;
                });
            });
            m.querySelector('#ag-zv-mappick').addEventListener('click', startMapPickZv);
            m.querySelector('#ag-zv-ptpick').addEventListener('click', openPtPick);
            m.querySelector('#ag-zv-ptclear').addEventListener('click', function () {
                _formPt = null;
                if (_formPos && _formPos.src === 'bod') _formPos = null;
                refreshPtLab(); refreshFormPos();
            });
            m.querySelector('#ag-zv-f-cancel').addEventListener('click', function () { closeOv('ag-zv-form-ov'); });
            m.querySelector('#ag-zv-f-save').addEventListener('click', saveForm);
        }
        return m;
    }

    // ---- výběr bodu, ke kterému se závada váže (jaký bod, co je s ním špatně) --------
    function zvPoints() {
        try {
            if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                return arPoints.filter(function (p) { return p && !p.hidden && p.lat != null && p.lng != null; });
            }
        } catch (e) {}
        return [];
    }
    function ensurePtModal() {
        var m = ensureOv('ag-zv-pt-ov',
            '<div class="ag-zv-card">'
            + '<h3>' + ICON + ' K jakému bodu?</h3>'
            + '<input type="text" id="ag-zv-pt-q" class="ag-zv-note" style="min-height:0;margin:0 0 10px;" placeholder="Hledat bod podle názvu…" autocomplete="off">'
            + '<div class="ag-zv-body" id="ag-zv-pt-list"></div>'
            + '<div class="ag-zv-foot">'
            + '  <button type="button" class="btn btn-secondary" id="ag-zv-pt-close">Zavřít</button>'
            + '</div></div>');
        if (!m._agInit) {
            m._agInit = true;
            m.querySelector('#ag-zv-pt-close').addEventListener('click', function () { closeOv('ag-zv-pt-ov'); });
            m.querySelector('#ag-zv-pt-q').addEventListener('input', renderPtList);
        }
        return m;
    }
    function renderPtList() {
        var host = document.getElementById('ag-zv-pt-list'); if (!host) return;
        var qEl = document.getElementById('ag-zv-pt-q');
        var q = (qEl && qEl.value ? qEl.value : '').toLowerCase().replace(/^\s+|\s+$/g, '');
        var pts = zvPoints().slice();
        if (q) pts = pts.filter(function (p) { return String(p.name || '').toLowerCase().indexOf(q) !== -1; });
        pts.forEach(function (p) { p._zvD = dist2user(p); });
        pts.sort(function (a, b) { return (a._zvD == null ? 9e9 : a._zvD) - (b._zvD == null ? 9e9 : b._zvD); });
        pts = pts.slice(0, 80);   // nejbližších 80 stačí; zbytek přes hledání
        if (!pts.length) {
            host.innerHTML = '<div class="ag-zv-empty">' + (q ? 'Žádný bod na dotaz „' + esc(q) + '“.' : 'V zakázce nejsou žádné body.') + '</div>';
            return;
        }
        host.innerHTML = '';
        pts.forEach(function (p) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'ag-zv-row';
            b.innerHTML = '<span class="ag-zv-mid"><span class="ag-zv-t">' + esc(p.name || p.id) + '</span></span>'
                + '<span class="ag-zv-d">' + fmtDist(p._zvD) + '</span>';
            b.addEventListener('click', function () {
                _formPt = { id: p.id, name: String(p.name || p.id) };
                _formPos = { lat: p.lat, lng: p.lng, acc: null, src: 'bod' };
                closeOv('ag-zv-pt-ov');
                refreshPtLab(); refreshFormPos();
            });
            host.appendChild(b);
        });
    }
    function openPtPick() {
        var m = ensurePtModal();
        m.querySelector('#ag-zv-pt-q').value = '';
        renderPtList();
        openOv('ag-zv-pt-ov');
    }
    function refreshPtLab() {
        var lab = document.getElementById('ag-zv-ptlab');
        var clr = document.getElementById('ag-zv-ptclear');
        var btn = document.getElementById('ag-zv-ptpick');
        if (!lab) return;
        if (_formPt) {
            lab.style.display = '';
            lab.innerHTML = 'Závada u bodu <b>' + esc(_formPt.name) + '</b> — poloha převzata z bodu.';
            if (clr) clr.style.display = '';
            if (btn) btn.textContent = '⌖ Vázat na jiný bod…';
        } else {
            lab.style.display = 'none';
            if (clr) clr.style.display = 'none';
            if (btn) btn.textContent = '⌖ Vázat na bod…';
        }
    }
    function refreshFormPos() {
        var el = document.getElementById('ag-zv-pos');
        if (!el) return;
        if (_formPos) {
            var srcTxt = _formPos.src === 'map' ? 'z mapy'
                : _formPos.src === 'bod' ? 'z bodu ' + esc(_formPt ? _formPt.name : '')
                : 'GPS ±' + (_formPos.acc != null ? _formPos.acc.toFixed(1) : '?') + ' m';
            el.innerHTML = 'Poloha: <b>' + srcTxt + '</b> · ' + fmtTs(Date.now());
        } else if (haveUser()) {
            var acc = (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy) ? currentGpsAccuracy : null;
            _formPos = { lat: userLat, lng: userLng, acc: acc, src: 'gps' };
            el.innerHTML = 'Poloha: <b>GPS ±' + (acc != null ? acc.toFixed(1) : '?') + ' m</b> (aktuální pozice)';
        } else {
            el.innerHTML = 'Poloha: <b>GPS zatím není</b> — vyber polohu z mapy, nebo počkej na fix.';
        }
    }
    function openForm() {
        syncProject();
        injectStyles();
        var m = ensureFormModal();
        // reset formuláře
        _formPhoto = null; _formPos = null; _formPt = null;
        refreshPtLab();
        m.querySelector('#ag-zv-thumb').innerHTML = '';
        m.querySelector('#ag-zv-note').value = '';
        m.querySelectorAll('.ag-zv-cat').forEach(function (x) { x.classList.remove('on'); });
        m.querySelectorAll('.ag-zv-sevb').forEach(function (x) { x.classList.remove('on'); x.style.background = ''; x.style.borderColor = ''; });
        // výchozí závažnost 2 (střed)
        var s2 = m.querySelector('.ag-zv-sevb[data-s="2"]'); if (s2) s2.click();
        refreshFormPos();
        openOv('ag-zv-form-ov');
    }
    // jednorázový výběr polohy klepnutím do mapy
    function startMapPickZv() {
        var mp = getMap();
        if (!mp) { agAlertW('Mapa není k dispozici', 'Spusť nejdřív aplikaci (mapa se načítá po startu).'); return; }
        closeOv('ag-zv-form-ov');
        toast('Klepni do mapy — tam bude závada.');
        var handler = function (e) {
            mp.off('click', handler);
            _formPos = { lat: e.latlng.lat, lng: e.latlng.lng, acc: null, src: 'map' };
            _formPt = null;   // poloha z mapy ruší vazbu na bod
            openOv('ag-zv-form-ov');
            refreshPtLab(); refreshFormPos();
        };
        mp.on('click', handler);
    }
    function saveForm() {
        var m = document.getElementById('ag-zv-form-ov');
        var catBtn = m.querySelector('.ag-zv-cat.on');
        if (!catBtn) { agAlertW('Chybí kategorie', 'Vyber, o jakou závadu jde — stačí ťuknout na jednu z možností.'); return; }
        var sevBtn = m.querySelector('.ag-zv-sevb.on');
        refreshFormPos();
        if (!_formPos) { agAlertW('Chybí poloha', 'Počkej na GPS fix, nebo vyber polohu z mapy.'); return; }
        var z = {
            id: 'zv_' + Date.now() + '_' + Math.round(Math.random() * 1e5),
            cat: catBtn.getAttribute('data-c'),
            sev: sevBtn ? parseInt(sevBtn.getAttribute('data-s'), 10) : 2,
            note: (m.querySelector('#ag-zv-note').value || '').trim(),
            lat: _formPos.lat, lng: _formPos.lng,
            acc: (_formPos.acc != null ? Math.round(_formPos.acc * 100) / 100 : null),
            posSrc: _formPos.src,
            ptId: (_formPt ? _formPt.id : null),
            ptName: (_formPt ? _formPt.name : null),
            ts: Date.now(),
            resolved: false, resolvedTs: null,
            foto: !!_formPhoto
        };
        _list.push(z);
        persist();
        if (_formPhoto) { photoPut(photoKey(z), _formPhoto).catch(function () { z.foto = false; persist(); }); }
        closeOv('ag-zv-form-ov');
        toast('Závada uložena (' + catLabel(z.cat) + ').');
        drawMap();
        // seznam obnovit, pokud je otevřený
        var lo = document.getElementById('ag-zv-list-ov');
        if (lo && lo.classList.contains('open')) renderList();
    }

    // ==== DETAIL ======================================================================
    function ensureDetailModal() {
        var m = ensureOv('ag-zv-det-ov',
            '<div class="ag-zv-card">'
            + '<h3>' + ICON + ' <span id="ag-zv-det-t">Závada</span></h3>'
            + '<div class="ag-zv-body" id="ag-zv-det-b"></div>'
            + '<div class="ag-zv-foot">'
            + '  <button type="button" class="btn btn-secondary" id="ag-zv-det-del">Smazat</button>'
            + '  <button type="button" class="btn btn-primary" id="ag-zv-det-res">Vyřešeno</button>'
            + '  <button type="button" class="btn btn-secondary" id="ag-zv-det-close">Zavřít</button>'
            + '</div></div>');
        if (!m._agInit) {
            m._agInit = true;
            m.querySelector('#ag-zv-det-close').addEventListener('click', function () { closeOv('ag-zv-det-ov'); });
            m.querySelector('#ag-zv-det-res').addEventListener('click', function () {
                var z = byId(_editId); if (!z) return;
                z.resolved = !z.resolved;
                z.resolvedTs = z.resolved ? Date.now() : null;
                persist(); drawMap(); renderList(); openDetail(z.id);
                toast(z.resolved ? 'Označeno jako vyřešené.' : 'Závada znovu otevřena.');
            });
            m.querySelector('#ag-zv-det-del').addEventListener('click', function () {
                var z = byId(_editId); if (!z) return;
                if (!confirm('Smazat závadu „' + catLabel(z.cat) + '"? Tohle nejde vrátit.')) return;
                photoDel(photoKey(z));
                _list = _list.filter(function (x) { return x.id !== z.id; });
                persist(); drawMap(); closeOv('ag-zv-det-ov'); renderList();
                toast('Závada smazána.');
            });
        }
        return m;
    }
    function byId(id) { for (var i = 0; i < _list.length; i++) if (_list[i].id === id) return _list[i]; return null; }
    function openDetail(id) {
        var z = byId(id); if (!z) return;
        _editId = id;
        var m = ensureDetailModal();
        var sv = SEV[z.sev] || SEV[1];
        m.querySelector('#ag-zv-det-t').textContent = catLabel(z.cat);
        var sj = toSJTSK(z.lat, z.lng);
        var d = dist2user(z);
        var b = m.querySelector('#ag-zv-det-b');
        b.innerHTML =
            '<div class="ag-zv-kv"><span>Stav</span><b>' + (z.resolved ? 'Vyřešeno ' + fmtTs(z.resolvedTs) : 'Otevřeno') + '</b></div>'
            + '<div class="ag-zv-kv"><span>Závažnost</span><b style="color:' + sv.color + ';">' + z.sev + ' · ' + sv.label + '</b></div>'
            + '<div class="ag-zv-kv"><span>Zapsáno</span><b>' + fmtTs(z.ts) + '</b></div>'
            + (z.ptName ? '<div class="ag-zv-kv"><span>Bod</span><b>⌖ ' + esc(z.ptName) + '</b></div>' : '')
            + (sj ? '<div class="ag-zv-kv"><span>S-JTSK</span><b>Y ' + sj.y.toFixed(2) + ' · X ' + sj.x.toFixed(2) + '</b></div>' : '')
            + '<div class="ag-zv-kv"><span>Poloha</span><b>' + (z.posSrc === 'map' ? 'z mapy' : 'GPS' + (z.acc != null ? ' ±' + z.acc + ' m' : '')) + '</b></div>'
            + (d != null ? '<div class="ag-zv-kv"><span>Odsud</span><b>' + fmtDist(d) + '</b></div>' : '')
            + (z.note ? '<p style="font-size:14px;line-height:1.5;">' + esc(z.note) + '</p>' : '')
            + '<div id="ag-zv-det-img"></div>';
        m.querySelector('#ag-zv-det-res').textContent = z.resolved ? 'Znovu otevřít' : 'Vyřešeno';
        if (z.foto) {
            photoGet(photoKey(z)).then(function (data) {
                var host = document.getElementById('ag-zv-det-img');
                if (host && data) host.innerHTML = '<img class="ag-zv-detimg" src="' + data + '" alt="foto závady">';
            }).catch(function () {});
        }
        openOv('ag-zv-det-ov');
    }

    // ==== MAPA ========================================================================
    function drawMap() {
        var mp = getMap();
        if (!mp || typeof L === 'undefined') return;
        if (!_mapGroup) _mapGroup = L.layerGroup().addTo(mp);
        _mapGroup.clearLayers();
        _list.forEach(function (z) {
            if (z.resolved) return;
            var sv = SEV[z.sev] || SEV[1];
            var mk = L.circleMarker([z.lat, z.lng], { radius: 9, color: sv.color, weight: 2.5, fillColor: sv.color, fillOpacity: 0.35 });
            mk.bindTooltip('⚠ ' + catLabel(z.cat) + (z.ptName ? ' · ' + z.ptName : ''), { direction: 'top', offset: [0, -8] });
            mk.on('click', function () { injectStyles(); ensureDetailModal(); openDetail(z.id); });
            mk.addTo(_mapGroup);
        });
    }

    // ==== AR ==========================================================================
    function originLL() {
        if (window.AGPose && typeof window.AGPose.origin === 'function' && haveUser()) {
            try { var o = window.AGPose.origin(userLat, userLng); if (o && o[0] != null) return { lat: o[0], lng: o[1] }; } catch (e) {}
        }
        return haveUser() ? { lat: userLat, lng: userLng } : null;
    }
    function ensureArSvg() {
        var ov = document.getElementById('ar-overlay'); if (!ov) return null;
        if (!_arSvg) {
            _arSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            _arSvg.setAttribute('viewBox', '0 0 100 100'); _arSvg.setAttribute('preserveAspectRatio', 'none');
            _arSvg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
            ov.insertBefore(_arSvg, ov.firstChild);
        }
        return _arSvg;
    }
    var _lastH = null, _lastP = null, _lastLat = null, _lastLng = null, _lastN = -1;
    function arLoop() {
        _arRAF = requestAnimationFrame(arLoop);
        var svg = _arSvg; if (!svg) return;
        var oLL = originLL();
        var open = _list.filter(function (z) { return !z.resolved; });
        if (!open.length || !oLL || (typeof viewMode !== 'undefined' && viewMode === 'map') || !window._arProj) {
            if (svg.childNodes.length) svg.innerHTML = ''; _lastH = null; return;
        }
        var pj = window._arProj;
        var hd = (typeof currentHeading === 'number' && isFinite(currentHeading)) ? currentHeading : null;
        if (hd == null) { if (svg.childNodes.length) svg.innerHTML = ''; _lastH = null; return; }
        var pitch = pj.pitch || 0;
        if (_lastH != null && Math.abs(hd - _lastH) < 0.3 && Math.abs(pitch - (_lastP || 0)) < 0.3 && _lastLat === oLL.lat && _lastLng === oLL.lng && _lastN === open.length) return;
        _lastH = hd; _lastP = pitch; _lastLat = oLL.lat; _lastLng = oLL.lng; _lastN = open.length;
        var rad = (typeof arRadius !== 'undefined' && arRadius) ? arRadius : 150;
        var html = '';
        open.forEach(function (z) {
            var dist = getDistance(oLL.lat, oLL.lng, z.lat, z.lng);
            if (dist > rad) return;
            var bearing = getBearing(oLL.lat, oLL.lng, z.lat, z.lng);
            var diff = ((bearing - hd + 540) % 360) - 180;
            if (Math.abs(diff) > 60) return;
            var vV = Math.atan2(1.6, Math.max(dist, 0.5)) * R2D - pitch;   // na zemi (výška očí 1,6 m)
            var x = 50 + (diff / pj.halfH) * 50;
            var y = 50 + (vV / pj.halfV) * 50;
            if (y < -10 || y > 110) return;
            var sv = SEV[z.sev] || SEV[1];
            // vykřičník v trojúhelníku, velikost mírně klesá se vzdáleností
            var s = Math.max(2.2, 4.6 - dist / 60);
            html += '<g opacity="0.95">'
                + '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="' + s.toFixed(2) + '" fill="' + sv.color + '" fill-opacity="0.85" stroke="#1a1205" stroke-width="0.35"/>'
                + '<text x="' + x.toFixed(2) + '" y="' + (y + s * 0.42).toFixed(2) + '" text-anchor="middle" font-size="' + (s * 1.3).toFixed(2) + '" font-weight="800" fill="#1a1205">!</text>'
                + '</g>';
        });
        svg.innerHTML = html;
    }
    function startAr() { if (ensureArSvg() && !_arRAF) _arRAF = requestAnimationFrame(arLoop); }

    // ==== EXPORTY =====================================================================
    function download(name, mime, text) {
        try {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: mime }));
            a.download = name;
            document.body.appendChild(a); a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
        } catch (e) { agAlertW('Export se nepovedl', String(e && e.message || e)); }
    }
    function exportCsv() {
        if (!_list.length) { toast('Žádné závady k exportu.'); return; }
        var rows = ['kategorie;bod;zavaznost;stav;Y;X;presnost_m;poznamka;zapsano;vyreseno'];
        _list.forEach(function (z) {
            var sj = toSJTSK(z.lat, z.lng);
            rows.push([
                catLabel(z.cat),
                '"' + String(z.ptName || '').replace(/"/g, '""') + '"',
                z.sev, (z.resolved ? 'vyreseno' : 'otevreno'),
                sj ? sj.y.toFixed(2) : '', sj ? sj.x.toFixed(2) : '',
                (z.acc != null ? z.acc : ''),
                '"' + String(z.note || '').replace(/"/g, '""') + '"',
                fmtTs(z.ts), (z.resolvedTs ? fmtTs(z.resolvedTs) : '')
            ].join(';'));
        });
        download('zavady_' + _pid + '.csv', 'text/csv;charset=utf-8', '﻿' + rows.join('\r\n'));
        toast('CSV staženo.');
    }
    function printProtocol() {
        if (!_list.length) { toast('Žádné závady k protokolu.'); return; }
        var rows = _list.slice().sort(function (a, b) { return b.sev - a.sev; });
        // fotky dotáhnout async, pak otevřít tiskové okno
        Promise.all(rows.map(function (z) {
            return z.foto ? photoGet(photoKey(z)).catch(function () { return null; }) : Promise.resolve(null);
        })).then(function (fotky) {
            var projName = _pid;
            try { if (typeof projects !== 'undefined' && projects) { var p = projects.find(function (x) { return x.id === _pid; }); if (p && p.name) projName = p.name; } } catch (e) {}
            var h = '<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Protokol závad</title><style>'
                + 'body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px;}'
                + 'h1{font-size:19px;margin:0 0 2px;} .sub{color:#555;margin:0 0 18px;font-size:12px;}'
                + '.z{border:1px solid #ccc;border-radius:8px;padding:12px 14px;margin-bottom:12px;page-break-inside:avoid;}'
                + '.z h2{font-size:14.5px;margin:0 0 6px;} .z .sev{display:inline-block;padding:2px 8px;border-radius:99px;font-weight:700;font-size:11px;margin-left:8px;color:#3a2c00;}'
                + 'table{border-collapse:collapse;font-size:12px;} td{padding:2px 14px 2px 0;color:#333;} td:first-child{color:#777;}'
                + 'img{max-width:320px;max-height:240px;border-radius:6px;margin-top:8px;display:block;}'
                + '.done{opacity:0.6;} @media print{button{display:none}}'
                + '</style></head><body>'
                + '<button onclick="window.print()" style="padding:8px 16px;margin-bottom:14px;">🖨 Tisk / Uložit PDF</button>'
                + '<h1>Protokol závad — ' + esc(projName) + '</h1>'
                + '<p class="sub">Vygenerováno ' + fmtTs(Date.now()) + ' · AR Geodet · poloha dle GPS telefonu (orientační)</p>';
            rows.forEach(function (z, i) {
                var sv = SEV[z.sev] || SEV[1];
                var sj = toSJTSK(z.lat, z.lng);
                h += '<div class="z' + (z.resolved ? ' done' : '') + '">'
                    + '<h2>' + (i + 1) + '. ' + esc(catLabel(z.cat))
                    + '<span class="sev" style="background:' + sv.color + ';">' + z.sev + ' · ' + sv.label + '</span>'
                    + (z.resolved ? ' <span style="font-weight:400;color:#2c7a4b;">✓ vyřešeno</span>' : '') + '</h2>'
                    + '<table>'
                    + (z.ptName ? '<tr><td>Bod</td><td>' + esc(z.ptName) + '</td></tr>' : '')
                    + (sj ? '<tr><td>S-JTSK</td><td>Y ' + sj.y.toFixed(2) + ' · X ' + sj.x.toFixed(2) + '</td></tr>' : '')
                    + '<tr><td>Zapsáno</td><td>' + fmtTs(z.ts) + (z.acc != null ? ' (GPS ±' + z.acc + ' m)' : '') + '</td></tr>'
                    + (z.resolvedTs ? '<tr><td>Vyřešeno</td><td>' + fmtTs(z.resolvedTs) + '</td></tr>' : '')
                    + (z.note ? '<tr><td>Poznámka</td><td>' + esc(z.note) + '</td></tr>' : '')
                    + '</table>'
                    + (fotky[i] ? '<img src="' + fotky[i] + '" alt="foto">' : '')
                    + '</div>';
            });
            h += '</body></html>';
            var w = window.open('', '_blank');
            if (!w) { agAlertW('Protokol se neotevřel', 'Prohlížeč zablokoval nové okno. Povol vyskakovací okna pro tuto aplikaci.'); return; }
            w.document.write(h); w.document.close();
        });
    }

    // ==== DLOUHÝ STISK „Nový bod" v doku =============================================
    function hookLongPress() {
        var btn = document.querySelector('#dock .dock-btn.dock-primary');
        if (!btn || btn._agZvLp) return;
        btn._agZvLp = true;
        var timer = null, fired = false;
        function clear() { if (timer) { clearTimeout(timer); timer = null; } }
        btn.addEventListener('pointerdown', function () {
            fired = false;
            clear();
            timer = setTimeout(function () {
                fired = true;
                if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }
                openForm();
            }, 550);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { btn.addEventListener(ev, clear); });
        // po dlouhém stisku spolkni následný click, ať se neotevře i Nový bod
        btn.addEventListener('click', function (e) {
            if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; }
        }, true);
    }

    // ==== ŽIVOT MODULU ================================================================
    function syncProject() {
        if (pid() !== _pid) { load(); drawMap(); }
    }
    function tick() {
        try {
            syncProject();
            hookLongPress();
            // mapová vrstva po startu mapy
            if (!_mapGroup && getMap()) drawMap();
            startAr();
        } catch (e) {}
    }
    function openTool() { openList(); }

    function init() {
        load();
        injectStyles();
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'zavady', label: 'Závady / hlášení', icon: ICON, cat: 'Vytyčování a náčrt', onClick: openTool, order: 15 });
        }
        if (!window.__agZvTimer) window.__agZvTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 2000);
        tick();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    // veřejné API (stavový pruh / jiné moduly můžou otevřít formulář s předvyplněním)
    window.AGZavady = { open: openList, novaZavada: openForm, count: function () { return _list.filter(function (z) { return !z.resolved; }).length; } };
})();
