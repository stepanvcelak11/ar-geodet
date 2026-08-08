// ===== AR Geodet — PŘENOS CELÉ ZAKÁZKY BEZ SERVERU (.argeo) (ODPOJITELNÁ vrstva) =
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Doplněk k záloze
// (js/zaloha.js) a QR sdílení bodů — tohle přenáší CELOU aktivní zakázku (body +
// spojnice + foto-dokumentace + žurnál + nastavení) do JEDNOHO souboru .argeo a
// druhý telefon si ho MERGNE do svojí zakázky. Žádný server, žádný účet, offline.
//
//   Export: posbírá z localStorage i IndexedDB všechny klíče aktivní zakázky
//     (prefix '<pid>_' — arCustomPoints12, arLines12, nastavení, doc_<id> fotky),
//     metadata z 'arProjectsList' a žurnál (AGJournal.all). Sbalí do JSON →
//     gzip nativním CompressionStream('gzip') (bez knihovny) → Blob .argeo.
//     Sdílení přes navigator.share({files}) (Web Share Level 2), jinak download.
//   Import: .argeo → DecompressionStream('gzip') → JSON → MERGE do AKTIVNÍ zakázky
//     (NIKDY nepřepíše celý stav): body přes window.addImportedPoints (dedup +
//     zachová prov/acc/vyska/doc), spojnice doplní, žurnál přes importRecords.
//     Fallback bez Compression Streams: nezabalený JSON (detekce 1. bajtu).
//
// POCTIVĚ: přesnost telefonu je orientační; přenos souřadnice NEMĚNÍ, jen kopíruje.
//   iOS Web Share s files je vrtkavý → vždy nabízíme i „Stáhnout soubor".
//
// Vstup: dlaždice „Poslat/načíst zakázku" v Nástrojích (agRegisterFieldTool);
//        když launcher chybí, modul si vyrobí vlastní plovoucí tlačítko.
// Odstranění: smaž js/job-transfer.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>'
        + '<path d="M8 8l4-4 4 4"/><path d="M12 4v12"/></svg>';

    var FORMAT = 'argeo', VERSION = 1;
    var _busy = false;

    // ---- pomocné --------------------------------------------------------------
    function agAlert(t, m) {
        try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m, cancelText: false }); } catch (e) {}
        try { agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e2) {}
    }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} }

    // aktivní zakázka — čteme přímo z localStorage (nezávisle na tom, zda jsou
    // globály logika.js v dosahu); pid = klíčový prefix všech dat zakázky
    function getPid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function getProjMeta(pid) {
        var name = pid;
        try {
            var list = JSON.parse(localStorage.getItem('arProjectsList') || '[]');
            if (Array.isArray(list)) { var p = list.find(function (x) { return x && x.id === pid; }); if (p && p.name) name = p.name; }
        } catch (e) {}
        return { id: pid, name: name };
    }
    // bezpečný název souboru z názvu zakázky
    function safeName(s) {
        return String(s || 'zakazka').normalize ? String(s || 'zakazka').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'zakazka'
            : String(s || 'zakazka').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'zakazka';
    }
    function stamp() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
    function fmtSize(bytes) { if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' kB'; return (bytes / 1048576).toFixed(2) + ' MB'; }

    // ---- gzip přes nativní streamy (bez knihovny) -----------------------------
    function hasCompression() { return (typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Response === 'function'); }
    function gzip(str) {
        // vrací Promise<Blob>. Když streamy nejsou, vrátí nezabalený text (fallback).
        if (!hasCompression()) return Promise.resolve(new Blob([str], { type: 'application/json' }));
        try {
            var cs = new CompressionStream('gzip');
            var stream = new Blob([str]).stream().pipeThrough(cs);
            return new Response(stream).blob();
        } catch (e) { return Promise.resolve(new Blob([str], { type: 'application/json' })); }
    }
    function gunzipBlob(blob) {
        // vrací Promise<string>
        var ds = new DecompressionStream('gzip');
        var stream = blob.stream().pipeThrough(ds);
        return new Response(stream).text();
    }

    // odstraní z foto-dokumentace fotky (base64), poznámku nechá; vrátí null když nezbylo nic
    function stripPhotos(val) {
        try {
            var doc = JSON.parse(val);
            if (doc) { doc.photos = []; delete doc.photo; }
            if (!doc || (!doc.note)) return null;
            return JSON.stringify(doc);
        } catch (e) { return null; }
    }

    // ---- SBĚR DAT AKTIVNÍ ZAKÁZKY ---------------------------------------------
    function collect(withPhotos) {
        var pid = getPid();
        var proj = getProjMeta(pid);
        var prefix = pid + '_';

        // 1) localStorage klíče zakázky (nastavení, spojnice, případně body když nejsou v IDB)
        var ls = {};
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (!key || key.indexOf(prefix) !== 0) continue;
                var suf = key.slice(prefix.length);
                if (suf === 'arOfflinePoints12') continue;   // úřední body: velké a znovu stažitelné z ČÚZK
                ls[suf] = localStorage.getItem(key);
            }
        } catch (e) {}

        // 2) IndexedDB klíče zakázky (body arCustomPoints12 + fotky doc_<id>)
        return collectIdb(pid, prefix, withPhotos, ls).then(function (idb) {
            // 3) žurnál (provenience) — pro .argeo přenos
            var jP = Promise.resolve([]);
            try { if (window.AGJournal && typeof window.AGJournal.all === 'function') jP = window.AGJournal.all(pid).catch(function () { return []; }); } catch (e) {}
            return jP.then(function (journal) {
                return {
                    format: FORMAT, v: VERSION, app: 'AR Geodet',
                    exportedAt: new Date().toISOString(),
                    project: proj,
                    withPhotos: !!withPhotos,
                    ls: ls, idb: idb,
                    journal: Array.isArray(journal) ? journal : []
                };
            });
        });
    }

    function collectIdb(pid, prefix, withPhotos, ls) {
        var idb = {};
        // preferovaně přes idbDumpAll (dump celého kv storu, definován v logika.js)
        if (typeof idbDumpAll === 'function') {
            return Promise.resolve(idbDumpAll()).then(function (all) {
                try {
                    Object.keys(all || {}).forEach(function (k) {
                        if (k.indexOf(prefix) !== 0) return;
                        var suf = k.slice(prefix.length);
                        if (suf === 'arOfflinePoints12') return;
                        var val = all[k];
                        if (typeof val !== 'string') { try { val = String(val); } catch (e) { return; } }
                        if (suf.indexOf('doc_') === 0 && !withPhotos) { val = stripPhotos(val); if (val == null) return; }
                        idb[suf] = val;
                    });
                } catch (e) {}
                return idb;
            }).catch(function () { return idb; });
        }
        // fallback bez idbDumpAll: aspoň vlastní body + jejich fotky
        return collectIdbFallback(withPhotos, ls, idb);
    }

    function collectIdbFallback(withPhotos, ls, idb) {
        // body: getStoredData vrací aktivní zakázku (= pid)
        var cpRaw = null;
        try { if (typeof getStoredData === 'function') cpRaw = getStoredData('arCustomPoints12'); } catch (e) {}
        if (cpRaw == null) cpRaw = ls.arCustomPoints12 || null;
        if (cpRaw != null) idb.arCustomPoints12 = cpRaw;
        var pts = [];
        try { if (cpRaw) pts = JSON.parse(cpRaw) || []; } catch (e) { pts = []; }
        if (!Array.isArray(pts) || !pts.length || typeof loadPointDoc !== 'function') return Promise.resolve(idb);
        // fotky bod po bodu (loadPointDoc(id) -> Promise)
        var chain = Promise.resolve();
        pts.forEach(function (p) {
            if (!p || !p.id) return;
            chain = chain.then(function () {
                return loadPointDoc(p.id).then(function (doc) {
                    if (!doc) return;
                    if (!withPhotos) { if (doc.photos) doc.photos = []; delete doc.photo; if (!doc.note) return; }
                    idb['doc_' + p.id] = JSON.stringify(doc);
                }).catch(function () {});
            });
        });
        return chain.then(function () { return idb; });
    }

    // stručný přehled co je v balíčku (pro UI a hlášku)
    function pkgSummary(pkg) {
        var cpRaw = (pkg.idb && pkg.idb.arCustomPoints12) || (pkg.ls && pkg.ls.arCustomPoints12) || null;
        var nPts = 0; try { if (cpRaw) nPts = (JSON.parse(cpRaw) || []).length; } catch (e) {}
        var lnRaw = (pkg.ls && pkg.ls.arLines12) || (pkg.idb && pkg.idb.arLines12) || null;
        var nLines = 0; try { if (lnRaw) nLines = (JSON.parse(lnRaw) || []).length; } catch (e) {}
        var nDocs = 0; try { Object.keys(pkg.idb || {}).forEach(function (k) { if (k.indexOf('doc_') === 0) nDocs++; }); } catch (e) {}
        var nJ = (pkg.journal && pkg.journal.length) || 0;
        return { pts: nPts, lines: nLines, docs: nDocs, journal: nJ };
    }

    // ---- EXPORT ---------------------------------------------------------------
    function doExport() {
        if (_busy) return; _busy = true;
        var withPhotos = !(document.getElementById('agjt-nophoto') && document.getElementById('agjt-nophoto').checked);
        var out = document.getElementById('agjt-export-out');
        if (out) out.innerHTML = '<div style="opacity:.75;font-size:13px;padding:6px 0;">Sbírám data zakázky…</div>';
        collect(withPhotos).then(function (pkg) {
            var json = JSON.stringify(pkg);
            var sum = pkgSummary(pkg);
            return gzip(json).then(function (blob) {
                var name = 'zakazka_' + safeName(pkg.project.name) + '_' + stamp() + '.argeo';
                // .argeo je vždy octet-stream (i nezabalený fallback), ať iOS nedělá s příponou psí kusy
                var file = new File([blob], name, { type: 'application/octet-stream' });
                renderExportResult(file, blob, sum, pkg.withPhotos);
            });
        }).catch(function (e) {
            console.warn('[job-transfer] export', e);
            if (out) out.innerHTML = '';
            agAlert('Export selhal', 'Zakázku se nepodařilo sbalit: ' + ((e && e.message) ? e.message : e));
        }).then(function () { _busy = false; });
    }

    function renderExportResult(file, blob, sum, withPhotos) {
        var out = document.getElementById('agjt-export-out'); if (!out) return;
        var canS = false;
        try { canS = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canS = false; }
        var comp = hasCompression() ? '' : '<div style="color:#fbbf24;font-size:11.5px;margin-top:4px;">Prohlížeč neumí gzip → soubor je nezabalený (větší). Na druhém telefonu se přesto načte.</div>';
        out.innerHTML =
            '<div class="agjt-box">'
            + '<div style="font-size:14px;margin-bottom:4px;">Balíček připraven <b>' + fmtSize(blob.size) + '</b></div>'
            + '<div style="font-size:12.5px;opacity:.85;line-height:1.5;">' + sum.pts + ' bodů · ' + sum.lines + ' spojnic · ' + sum.docs + ' foto/pozn.' + (sum.journal ? ' · ' + sum.journal + ' záznamů žurnálu' : '') + '<br>'
            + (withPhotos ? '' : '<span style="color:#fbbf24;">bez fotek (jen poznámky)</span> · ') + 'soubor <b>' + file.name + '</b></div>'
            + comp
            + '<div class="agjt-actrow">'
            + (canS ? '<button class="btn" id="agjt-do-share"><svg class="icon"><use href="#i-upload"/></svg> Sdílet (Airdrop/chat…)</button>' : '')
            + '<button class="btn ' + (canS ? 'btn-secondary' : '') + '" id="agjt-do-dl"><svg class="icon"><use href="#i-download"/></svg> Stáhnout soubor</button>'
            + '</div>'
            + '<div style="font-size:11.5px;opacity:.65;margin-top:6px;line-height:1.45;">Na druhém telefonu otevři AR Geodet → Nástroje → „Poslat/načíst zakázku" → <b>Načíst</b> a vyber tenhle .argeo soubor. Body se <b>přidají</b> do jeho aktivní zakázky (nic se nepřepíše).</div>'
            + '</div>';
        var sh = document.getElementById('agjt-do-share');
        if (sh) sh.addEventListener('click', function () {
            try {
                navigator.share({ files: [file], title: 'AR Geodet — zakázka', text: 'Přenos zakázky (.argeo)' })
                    .then(function () { toast('Sdíleno'); })
                    .catch(function (err) { if (err && err.name === 'AbortError') return; downloadBlob(file, file.name); });
            } catch (e) { downloadBlob(file, file.name); }
        });
        var dl = document.getElementById('agjt-do-dl');
        if (dl) dl.addEventListener('click', function () { downloadBlob(file, file.name); });
    }

    function downloadBlob(blob, name) {
        try {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
            toast('Soubor stažen');
        } catch (e) { agAlert('Stažení selhalo', String(e && e.message || e)); }
    }

    // ---- IMPORT ---------------------------------------------------------------
    function pickFile() {
        var inp = document.getElementById('agjt-file');
        if (!inp) {
            inp = document.createElement('input');
            inp.type = 'file'; inp.id = 'agjt-file';
            inp.accept = '.argeo,application/octet-stream,application/gzip,application/json';
            inp.style.display = 'none';
            inp.addEventListener('change', onFilePicked);
            document.body.appendChild(inp);
        }
        inp.value = '';
        inp.click();
    }

    function onFilePicked(ev) {
        var file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!file) return;
        if (_busy) return; _busy = true;
        var out = document.getElementById('agjt-import-out');
        if (out) out.innerHTML = '<div style="opacity:.75;font-size:13px;padding:6px 0;">Čtu soubor…</div>';
        readFileToJson(file).then(function (pkg) {
            if (!pkg || pkg.format !== FORMAT) {
                agAlert('Nepodporovaný soubor', 'Tohle nevypadá jako přenos AR Geodet (.argeo). Zkontroluj, že jsi vybral správný soubor.');
                if (out) out.innerHTML = '';
                return;
            }
            confirmAndMerge(pkg);
        }).catch(function (e) {
            console.warn('[job-transfer] import', e);
            if (out) out.innerHTML = '';
            var msg = 'Soubor se nepodařilo přečíst.';
            if (e && e.name === 'GzipUnsupported') msg = 'Soubor je zabalený (gzip), ale tenhle prohlížeč ho neumí rozbalit. Otevři přenos v novějším prohlížeči (Chrome/Safari).';
            agAlert('Načtení selhalo', msg + (e && e.message ? '\n\n' + e.message : ''));
        }).then(function () { _busy = false; });
    }

    function readFileToJson(file) {
        return file.arrayBuffer().then(function (buf) {
            var bytes = new Uint8Array(buf);
            var isGzip = bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b;
            if (isGzip) {
                if (typeof DecompressionStream !== 'function' || typeof Response !== 'function') {
                    var err = new Error('DecompressionStream není k dispozici'); err.name = 'GzipUnsupported'; throw err;
                }
                return gunzipBlob(new Blob([buf])).then(function (txt) { return JSON.parse(txt); });
            }
            // nezabaleno: očekáváme čitelný JSON ('{')
            var txt;
            try { txt = new TextDecoder('utf-8').decode(buf); } catch (e) { txt = ''; }
            return JSON.parse(txt);
        });
    }

    async function confirmAndMerge(pkg) {
        var sum = pkgSummary(pkg);
        var target = getProjMeta(getPid());
        var when = '';
        try { when = new Date(pkg.exportedAt).toLocaleString('cs-CZ'); } catch (e) {}
        var html = 'Přenos zakázky <b>„' + escHtml(pkg.project && pkg.project.name || '?') + '"</b>' + (when ? ' (' + when + ')' : '') + ':<br>'
            + '<b>' + sum.pts + '</b> bodů · <b>' + sum.lines + '</b> spojnic · <b>' + sum.docs + '</b> foto/pozn.' + (sum.journal ? ' · ' + sum.journal + ' zázn. žurnálu' : '') + '<br><br>'
            + 'Sloučit do tvojí aktivní zakázky <b>„' + escHtml(target.name) + '"</b>?<br>'
            + '<span style="opacity:.75;font-size:12.5px;">Body se <b>přidají</b> (shodné se přeskočí, nic se nepřepíše). Nastavení druhé zakázky se nepřebírá. Chceš-li přenos oddělit, nejdřív si v appce založ novou zakázku a přepni se na ni.</span>';
        function proceed() { runMerge(pkg); }
        if (typeof window.agAlert === 'function') {
            window.agAlert({ title: 'Načíst zakázku', message: html, okText: 'Sloučit', cancelText: 'Zrušit' }).then(function (ok) { if (ok) proceed(); else clearImportOut(); });
        } else {
            if ((await agAsk('Sloučit ' + sum.pts + ' bodů do aktivní zakázky?', { okText: 'Sloučit' }))) proceed(); else clearImportOut();
        }
    }
    function clearImportOut() { var out = document.getElementById('agjt-import-out'); if (out) out.innerHTML = ''; }

    function runMerge(pkg) {
        var targetPid = getPid();
        var out = document.getElementById('agjt-import-out');
        if (out) out.innerHTML = '<div style="opacity:.75;font-size:13px;padding:6px 0;">Slučuji…</div>';

        // 1) BODY přes window.addImportedPoints (dedup + zachová prov/acc/vyska/doc)
        var cpRaw = (pkg.idb && pkg.idb.arCustomPoints12) || (pkg.ls && pkg.ls.arCustomPoints12) || null;
        var pts = []; try { if (cpRaw) pts = JSON.parse(cpRaw) || []; } catch (e) { pts = []; }
        var docs = pkg.idb || {};
        var toImport = [];
        (Array.isArray(pts) ? pts : []).forEach(function (p) {
            if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
            var o = { name: p.name, lat: p.lat, lng: p.lng };
            if (p.vyska != null) o.vyska = p.vyska;
            if (p.acc != null) o.acc = p.acc;
            if (p.prov) o.prov = p.prov;
            o.origin = (p.prov && p.prov.origin) || 'transfer';
            var d = docs['doc_' + p.id];
            if (d) { try { o.doc = JSON.parse(d); } catch (e) {} }
            toImport.push(o);
        });
        var addedPts = 0;
        try { if (typeof window.addImportedPoints === 'function' && toImport.length) addedPts = window.addImportedPoints(toImport) || 0; } catch (e) { console.warn('[job-transfer] addPoints', e); }

        // 2) SPOJNICE — doplnit (best-effort remap podle názvu+souřadnic na nové body)
        var addedLines = mergeLines(pkg);

        // 3) ŽURNÁL — #14: zdrojový žurnál NEreplayujeme. addImportedPoints přiděluje bodům NOVÁ
        // id a samo commitne čerstvý 'add' (s proveniencí), takže replay starých id by vytvořil
        // jen osiřelé (nedohledatelné) záznamy a druhý 'add'. Provenience i tak zůstává na bodu.
        var jP = Promise.resolve(0);

        jP.then(function (jAdded) {
            var skipped = toImport.length - addedPts;
            var msg = 'Sloučeno do aktivní zakázky:\n'
                + '• ' + addedPts + ' nových bodů' + (skipped > 0 ? ' (' + skipped + ' shodných přeskočeno)' : '') + '\n'
                + '• ' + addedLines + ' spojnic'
                + (jAdded ? '\n• ' + jAdded + ' záznamů žurnálu' : '');
            if (out) out.innerHTML = '<div class="agjt-box"><div style="font-size:14px;">Hotovo</div><div style="font-size:12.5px;opacity:.85;white-space:pre-line;margin-top:4px;">' + escHtml(msg) + '</div></div>';
            toast('Zakázka sloučena (' + addedPts + ' bodů)');
        });
    }

    // doplnění spojnic do aktivní zakázky (nepřepisuje, jen přidává; remap id podle názvu+polohy)
    function mergeLines(pkg) {
        try {
            if (typeof pointLines === 'undefined' || !Array.isArray(pointLines)) return 0;
            if (typeof persistentCustomPoints === 'undefined' || !Array.isArray(persistentCustomPoints)) return 0;
            var lnRaw = (pkg.ls && pkg.ls.arLines12) || (pkg.idb && pkg.idb.arLines12) || null;
            var lines = []; try { if (lnRaw) lines = JSON.parse(lnRaw) || []; } catch (e) { lines = []; }
            if (!Array.isArray(lines) || !lines.length) return 0;

            function findPt(name, lat, lng) {
                if (typeof lat !== 'number' || typeof lng !== 'number') return null;
                return persistentCustomPoints.find(function (p) {
                    return (name == null || p.name === name) && Math.abs(p.lat - lat) < 1e-6 && Math.abs(p.lng - lng) < 1e-6;
                }) || persistentCustomPoints.find(function (p) {
                    return Math.abs(p.lat - lat) < 1e-6 && Math.abs(p.lng - lng) < 1e-6;
                }) || null;
            }
            function dup(aLat, aLng, bLat, bLng) {
                return pointLines.some(function (l) {
                    var f = (Math.abs(l.aLat - aLat) < 1e-6 && Math.abs(l.aLng - aLng) < 1e-6 && Math.abs(l.bLat - bLat) < 1e-6 && Math.abs(l.bLng - bLng) < 1e-6);
                    var r = (Math.abs(l.aLat - bLat) < 1e-6 && Math.abs(l.aLng - bLng) < 1e-6 && Math.abs(l.bLat - aLat) < 1e-6 && Math.abs(l.bLng - aLng) < 1e-6);
                    return f || r;
                });
            }
            var added = 0;
            lines.forEach(function (l) {
                if (!l || l.aLat == null || l.bLat == null) return;
                if (dup(+l.aLat, +l.aLng, +l.bLat, +l.bLng)) return;
                var a = findPt(l.aName, +l.aLat, +l.aLng), b = findPt(l.bName, +l.bLat, +l.bLng);
                var newLine = {
                    id: 'ln_' + Date.now() + '_' + Math.round(Math.random() * 1e6),
                    aId: a ? a.id : (l.aId || null), bId: b ? b.id : (l.bId || null),
                    aName: l.aName, bName: l.bName,
                    aLat: +l.aLat, aLng: +l.aLng, bLat: +l.bLat, bLng: +l.bLng
                };
                pointLines.push(newLine); added++;
            });
            if (added) {
                try { if (typeof saveLines === 'function') saveLines(); } catch (e) {}
                try { if (typeof drawAllLinesOnMap === 'function') drawAllLinesOnMap(); } catch (e) {}
            }
            return added;
        } catch (e) { console.warn('[job-transfer] mergeLines', e); return 0; }
    }

    function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }

    // ---- UI: hlavní modal -----------------------------------------------------
    function ensureModal() {
        if (document.getElementById('agjt-modal')) return;
        injectStyles();
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agjt-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Poslat / načíst zakázku</h3>'
            + '<p style="font-size:12.5px;opacity:.82;margin:2px 0 12px;line-height:1.45;">Přenes celou zakázku (body, spojnice, fotky, poznámky, žurnál) do jednoho souboru <b>.argeo</b> a načti ji na druhém telefonu — <b>bez serveru a offline</b>. Souřadnice se jen kopírují, nic se nepřepočítává.</p>'

            + '<div class="agjt-sec">'
            + '  <div class="agjt-sec-h">Poslat tuhle zakázku</div>'
            + '  <label class="agjt-chk"><input type="checkbox" id="agjt-nophoto"> <span>bez fotek (menší soubor — poznámky zůstanou)</span></label>'
            + '  <button class="btn" id="agjt-export"><svg class="icon"><use href="#i-upload"/></svg> Vytvořit balíček .argeo</button>'
            + '  <div id="agjt-export-out"></div>'
            + '</div>'

            + '<div class="agjt-sec">'
            + '  <div class="agjt-sec-h">Načíst zakázku ze souboru</div>'
            + '  <p style="font-size:12px;opacity:.7;margin:0 0 8px;">Body a spojnice se <b>přidají</b> do tvojí aktuální zakázky (shodné se přeskočí). Nic se nepřepíše.</p>'
            + '  <button class="btn btn-blue" id="agjt-import"><svg class="icon"><use href="#i-download"/></svg> Vybrat .argeo soubor</button>'
            + '  <div id="agjt-import-out"></div>'
            + '</div>'

            + '<button class="btn btn-secondary" style="margin-top:14px;" onclick="window.agCloseJobTransfer&&window.agCloseJobTransfer()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('agjt-export').addEventListener('click', doExport);
        document.getElementById('agjt-import').addEventListener('click', pickFile);
    }

    function openTool() {
        ensureModal();
        var eo = document.getElementById('agjt-export-out'); if (eo) eo.innerHTML = '';
        var io = document.getElementById('agjt-import-out'); if (io) io.innerHTML = '';
        var m = document.getElementById('agjt-modal'); if (m) m.style.display = 'flex';
    }
    window.agCloseJobTransfer = function () { var m = document.getElementById('agjt-modal'); if (m) m.style.display = 'none'; };
    window.agOpenJobTransfer = openTool;

    // ---- styly (injektované) --------------------------------------------------
    function injectStyles() {
        if (document.getElementById('agjt-style')) return;
        var st = document.createElement('style'); st.id = 'agjt-style';
        st.textContent = [
            '#agjt-modal .agjt-sec{margin:10px 0 6px;padding:12px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid var(--glass-border,rgba(255,255,255,0.10));}',
            '#agjt-modal .agjt-sec-h{font:700 12px/1 var(--font-display,system-ui),sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);margin-bottom:8px;}',
            '#agjt-modal .agjt-chk{display:flex;align-items:center;gap:9px;margin:2px 0 10px;font-size:13px;cursor:pointer;}',
            '#agjt-modal .agjt-chk input{width:18px;height:18px;flex:0 0 18px;accent-color:var(--accent,#2f9e74);}',
            '#agjt-modal .agjt-box{margin-top:10px;padding:11px 13px;border-radius:10px;background:rgba(47,158,116,0.12);}',
            '#agjt-modal .agjt-actrow{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;}',
            '#agjt-modal .agjt-actrow .btn{width:auto;flex:1 1 auto;min-width:140px;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- registrace do launcheru + fallback tlačítko --------------------------
    function register() {
        injectStyles();
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'job-transfer', label: 'Poslat/načíst zakázku', icon: ICON, cat: 'Data a přenos', onClick: openTool, order: 20 });
        } else {
            ensureFallbackFab();
        }
    }
    function ensureFallbackFab() {
        if (document.getElementById('agjt-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'agjt-fab'; b.type = 'button';
        b.title = 'Poslat/načíst zakázku'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:322px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#2f9e74);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        try { b.querySelector('svg').style.cssText = 'width:24px;height:24px;'; } catch (e) {}
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
