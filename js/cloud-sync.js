// ============================================================================
// AR Geodet — ŽIVÁ SYNCHRONIZACE BODŮ VE FIRMĚ (ODPOJITELNÁ vrstva)
// ----------------------------------------------------------------------------
// Zařízení přihlášená do STEJNÉ CLOUDOVÉ FIRMY (js/ucty.js + cloud/worker.js)
// sdílejí VLASTNÍ body aktivní zakázky. Offline-first: každých ~30 s (a při
// startu, po návratu signálu a chvíli po každé změně bodu) se pošlou lokální
// změny na server a stáhnou změny od kolegů. Konflikty řeší „poslední úprava
// vyhrává" (podle času změny), mazání se přenáší náhrobky (tombstony).
//
//   • zapíná se RUČNĚ per zakázka: Nastavení → Data → sekce „Firemní cloud"
//     (viditelná jen u zařízení přihlášeného do firmy s cloudem)
//   • zakázky se mezi zařízeními PÁRUJÍ NÁZVEM (velikost písmen a přebytečné
//     mezery nehrají roli) — na obou telefonech stačí založit zakázku stejného
//     jména. Pozn.: id zakázky (pid) je čistě lokální (proj_<čas>) a přenos
//     .argeo ho nezachovává, proto název. POZOR: dvě RŮZNÉ zakázky stejného
//     jména v jedné firmě by se slily — sdílení je proto opt-in.
//   • sdílejí se jen VLASTNÍ body (persistentCustomPoints) — ne úřední body
//     ČÚZK, ne čáry/kresby a ne foto-dokumentace bodů (velká data).
//   • detekce lokálních změn: periodický DIFF otisků bodů proti poslednímu
//     synchronizovanému stavu (robustnější než obalování ukládacích funkcí —
//     na body sahá ~30 modulů a diff zachytí všechny, včetně budoucích).
//   • pojistka proti hromadnému smazání: synchronizuje se jen když je paměť
//     bodů konzistentní s uloženým snapshotem zakázky (po hydrataci).
//
// Server: cloud/worker.js — POST/GET /sync/points (tabulka sync_points v D1
// se založí sama při prvním použití). Nasazení viz cloud/README-sync.md.
//
// Odstranění modulu: smaž js/cloud-sync.js + řádek <script> v index.html
// (a položku v sw.js). Data na serveru ani klíče '<pid>_agCloudSync*'
// v localStorage ničemu nevadí (mažou se automaticky se zakázkou).
// ============================================================================
(function () {
    'use strict';
    if (window.__agCloudSyncInit) return;
    window.__agCloudSyncInit = true;

    var TICK_MS = 5000;             // vnitřní tep: obnova UI + kontrola, zda je čas na sync
    var SYNC_EVERY = 30000;         // běžná perioda synchronizace
    var NOSRV_RETRY = 10 * 60000;   // worker bez /sync/points (404) → zkoušet jen občas
    var PUSH_BATCH = 200;           // max změn v jednom POST
    var TOMB_KEEP = 90 * 86400000;  // úklid starých náhrobků v lokálním stavu
    var STYLE_ID = 'ag-csync-style';

    var _busy = false, _lastTry = 0, _lastErr = 0, _noServerTs = 0, _deb = null;

    // ------------------------------------------------------------------
    // pomocné
    // ------------------------------------------------------------------
    function U() { return window.AGUcty || null; }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:toast'); } }

    // klíč zakázky na serveru = normalizovaný NÁZEV zakázky (viz hlavička)
    function jobKey(p) {
        var name = null;
        try {
            var list = JSON.parse(localStorage.getItem('arProjectsList') || '[]');
            if (Array.isArray(list)) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i] && list[i].id === p) { name = list[i].name; break; }
                }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:jobKey'); }
        var k = String(name || p).replace(/\s+/g, ' ');
        k = k.replace(/^\s+|\s+$/g, '').toLowerCase();
        return k.slice(0, 60) || String(p);
    }

    // klíče drží konvenci '<pid>_...' — při smazání zakázky je logika.js
    // (úklid podle prefixu) smaže automaticky s ostatními daty zakázky
    function enabled(p) { try { return localStorage.getItem(p + '_agCloudSync') === '1'; } catch (e) { return false; } }
    function setEnabled(p, on) {
        try { if (on) localStorage.setItem(p + '_agCloudSync', '1'); else localStorage.removeItem(p + '_agCloudSync'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:setEnabled'); }
    }

    // stav synchronizace zakázky: { since: kurzor serveru, ok: čas posledního
    // úspěchu, known: { idBodu: {ts, h} | {ts, del:1} } — poslední sesynchro-
    // nizovaný otisk každého bodu }
    function loadSt(p) {
        try {
            var s = JSON.parse(localStorage.getItem(p + '_agCloudSyncSt') || 'null');
            if (s && typeof s === 'object') {
                if (!s.known || typeof s.known !== 'object') s.known = {};
                if (typeof s.since !== 'number') s.since = 0;
                return s;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:loadSt'); }
        return { since: 0, ok: 0, known: {} };
    }
    function saveSt(p, s) { try { localStorage.setItem(p + '_agCloudSyncSt', JSON.stringify(s)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:saveSt'); } }
    function pruneKnown(st) {
        var cut = Date.now() - TOMB_KEEP;
        for (var id in st.known) {
            if (!Object.prototype.hasOwnProperty.call(st.known, id)) continue;
            var k = st.known[id];
            if (k && k.del && k.ts < cut) delete st.known[id];
        }
    }

    // ------------------------------------------------------------------
    // body zakázky (globály logika.js — stejný přístup jako js/dgps.js)
    // ------------------------------------------------------------------
    function points() {
        try {
            return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : null;
        } catch (e) { return null; }
    }
    function findPt(id) {
        var P = points(); if (!P) return null;
        for (var i = 0; i < P.length; i++) { if (P[i] && String(P[i].id) === id) return P[i]; }
        return null;
    }

    // přenášená podoba bodu — jen podstata, žádná runtime pole (element apod.)
    function slim(p) {
        var o = { id: String(p.id), name: p.name != null ? String(p.name) : 'Bod', lat: +p.lat, lng: +p.lng, cat: 'CUSTOM', type: 'custom' };
        if (p.vyska != null && isFinite(+p.vyska)) o.vyska = +p.vyska;
        if (p.acc != null && isFinite(+p.acc)) o.acc = +p.acc;
        if (p.prov && typeof p.prov === 'object') o.prov = p.prov;
        return o;
    }
    // deterministická serializace (seřazené klíče) → stejný otisk na všech zařízeních
    function stable(v) {
        if (v == null || typeof v !== 'object') return String(JSON.stringify(v));
        if (Object.prototype.toString.call(v) === '[object Array]') {
            var a = [], i;
            for (i = 0; i < v.length; i++) a.push(stable(v[i]));
            return '[' + a.join(',') + ']';
        }
        var keys = [], k;
        for (k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) keys.push(k); }
        keys.sort();
        var out = [];
        for (var j = 0; j < keys.length; j++) {
            var val = v[keys[j]];
            if (val === undefined || typeof val === 'function') continue;
            out.push(JSON.stringify(keys[j]) + ':' + stable(val));
        }
        return '{' + out.join(',') + '}';
    }
    function fnv(s) {
        var h = 0x811c9dc5;
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
        return h.toString(36);
    }
    function hashPt(p) { return fnv(stable(slim(p))); }

    function fromData(d) {
        var np = { id: String(d.id), name: d.name != null ? String(d.name) : 'Bod', lat: +d.lat, lng: +d.lng, cat: 'CUSTOM', type: 'custom' };
        if (d.vyska != null && isFinite(+d.vyska)) np.vyska = +d.vyska;
        if (d.acc != null && isFinite(+d.acc)) np.acc = +d.acc;
        if (d.prov && typeof d.prov === 'object') np.prov = d.prov;
        return np;
    }

    // ------------------------------------------------------------------
    // pojistky: appka běží a paměť bodů odpovídá uloženému snapshotu zakázky
    // (jinak hrozí diff nad nenahydrovanými/cizími daty → falešné tombstony)
    // ------------------------------------------------------------------
    function ready() {
        if (!points()) return false;
        if (!document.body || !document.body.classList.contains('app-started')) return false;
        return true;
    }
    function consistent() {
        var raw = null;
        try { raw = (typeof getStoredData === 'function') ? getStoredData('arCustomPoints12') : null; } catch (e) { return false; }
        var stored = [];
        if (raw) {
            try { var a = JSON.parse(raw); if (Array.isArray(a)) stored = a; else return false; } catch (e) { return false; }
        }
        var P = points(); if (!P) return false;
        if (P.length !== stored.length) return false;
        var m = {}, i;
        for (i = 0; i < stored.length; i++) { if (stored[i]) m[String(stored[i].id)] = 1; }
        for (i = 0; i < P.length; i++) { if (!P[i] || !m[String(P[i].id)]) return false; }
        return true;
    }

    // ------------------------------------------------------------------
    // aplikace vzdálených změn do zakázky
    // ------------------------------------------------------------------
    function insertLocal(np) {
        var P = points(); if (!P) return;
        P.push(np);
        try {
            if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                var c = {};
                for (var k in np) { if (Object.prototype.hasOwnProperty.call(np, k)) c[k] = np[k]; }
                c.hidden = false;
                arPoints.push(c);
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:insertLocal'); }
    }

    function updateLocal(lp, np) {
        lp.name = np.name; lp.lat = np.lat; lp.lng = np.lng;
        if (np.vyska != null) lp.vyska = np.vyska; else if (lp.vyska != null) delete lp.vyska;
        if (np.acc != null) lp.acc = np.acc; else if (lp.acc != null) delete lp.acc;
        if (np.prov) lp.prov = np.prov;
        try {
            if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                for (var i = 0; i < arPoints.length; i++) {
                    var a = arPoints[i];
                    if (!a || String(a.id) !== String(lp.id)) continue;
                    a.name = np.name; a.lat = np.lat; a.lng = np.lng;
                    if (np.vyska != null) a.vyska = np.vyska; else if (a.vyska != null) delete a.vyska;
                    if (np.acc != null) a.acc = np.acc; else if (a.acc != null) delete a.acc;
                    if (np.prov) a.prov = np.prov;
                    try { if (a.element) { a.element.remove(); a.element = null; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:updateLocal'); }
                    try { if (a.distElement) { a.distElement.remove(); a.distElement = null; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:updateLocal'); }
                }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:updateLocal'); }
    }

    function removeLocal(id) {
        var P = points(); if (!P) return;
        var i;
        for (i = P.length - 1; i >= 0; i--) { if (P[i] && String(P[i].id) === id) P.splice(i, 1); }
        try {
            if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                for (i = arPoints.length - 1; i >= 0; i--) {
                    if (arPoints[i] && String(arPoints[i].id) === id) {
                        try { if (arPoints[i].element) arPoints[i].element.remove(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:removeLocal'); }
                        try { if (arPoints[i].distElement) arPoints[i].distElement.remove(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:removeLocal'); }
                        arPoints.splice(i, 1);
                    }
                }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:removeLocal'); }
        try {
            if (typeof pointLines !== 'undefined' && Array.isArray(pointLines)) {
                var n0 = pointLines.length;
                for (i = pointLines.length - 1; i >= 0; i--) {
                    if (pointLines[i] && (pointLines[i].aId === id || pointLines[i].bId === id)) pointLines.splice(i, 1);
                }
                if (n0 !== pointLines.length && typeof saveLines === 'function') { try { saveLines(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:removeLocal'); } }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:removeLocal'); }
    }

    // stejný fyzický bod vzniklý nezávisle na obou zařízeních (shodné jméno
    // i poloha do ~1 cm) → lokální bod převezme id ze serveru, ať se needituje
    // nadvakrát. Starý id (pokud už byl pushnut) diff přirozeně tombstonuje.
    function findTwin(np) {
        var P = points(); if (!P) return null;
        for (var i = 0; i < P.length; i++) {
            var q = P[i];
            if (q && String(q.name) === String(np.name) && Math.abs(+q.lat - np.lat) < 1e-7 && Math.abs(+q.lng - np.lng) < 1e-7) return q;
        }
        return null;
    }
    function adoptId(twin, newId) {
        var oldId = String(twin.id);
        if (oldId === newId) return;
        twin.id = newId;
        var i;
        try {
            if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                for (i = 0; i < arPoints.length; i++) { if (arPoints[i] && String(arPoints[i].id) === oldId) arPoints[i].id = newId; }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:adoptId'); }
        try {
            if (typeof pointLines !== 'undefined' && Array.isArray(pointLines)) {
                var ch = false;
                for (i = 0; i < pointLines.length; i++) {
                    var l = pointLines[i]; if (!l) continue;
                    if (l.aId === oldId) { l.aId = newId; ch = true; }
                    if (l.bId === oldId) { l.bId = newId; ch = true; }
                }
                if (ch && typeof saveLines === 'function') { try { saveLines(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:adoptId'); } }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:adoptId'); }
        // foto-dokumentace je klíčovaná id bodu → překopírovat pod nové id
        try {
            if (typeof loadPointDoc === 'function' && typeof savePointDoc === 'function') {
                loadPointDoc(oldId).then(function (doc) { if (doc) { try { savePointDoc(newId, doc); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:adoptId'); } } });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:adoptId'); }
    }

    function applyRows(p, st, rows) {
        if (!rows || !rows.length) return { add: 0, edit: 0, del: 0 };
        if (pid() !== p || !ready()) return null;
        var res = { add: 0, edit: 0, del: 0 };
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i]; if (!row || row.id == null) continue;
            var id = String(row.id);
            var k = st.known[id];
            var rts = +row.ts || 0;
            if (row.deleted) {
                var lp = findPt(id);
                if (lp) {
                    var hNow = hashPt(lp);
                    if (k && k.h && hNow !== k.h) {
                        // lokální nesesynchronizovaná úprava → bod nechat, diff ho pushne s novějším časem
                        st.known[id] = { ts: rts, h: k.h };
                    } else {
                        removeLocal(id); res.del++;
                        st.known[id] = { ts: rts, del: 1 };
                    }
                } else {
                    st.known[id] = { ts: rts, del: 1 };
                }
                continue;
            }
            var d = null;
            try { d = (typeof row.data === 'string') ? JSON.parse(row.data) : row.data; } catch (e) { d = null; }
            if (!d || typeof d !== 'object' || !isFinite(+d.lat) || !isFinite(+d.lng)) continue;
            d.id = id;
            var np = fromData(d);
            var hRem = hashPt(np);
            var lp2 = findPt(id);
            if (!lp2) {
                var twin = findTwin(np);
                if (twin) { adoptId(twin, id); lp2 = twin; }
            }
            if (!lp2) {
                if (k && k.del && k.ts >= rts) continue;   // náš novější náhrobek — nevzkřísit
                insertLocal(np); res.add++;
                st.known[id] = { ts: rts, h: hRem };
            } else {
                var hLoc = hashPt(lp2);
                if (hLoc === hRem) { st.known[id] = { ts: rts, h: hRem }; continue; }
                if (k && k.h && hLoc !== k.h) { st.known[id] = { ts: rts, h: k.h }; continue; }   // lokální změna vyhrává
                updateLocal(lp2, np); res.edit++;
                st.known[id] = { ts: rts, h: hRem };
            }
        }
        return res;
    }

    function persistAndRedraw(p, res) {
        if (pid() !== p) return;
        var P = points(); if (!P) return;
        try { if (typeof setStoredData === 'function') setStoredData('arCustomPoints12', JSON.stringify(P)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:persistAndRedraw'); }
        try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:persistAndRedraw'); }
        try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:persistAndRedraw'); }
        try { if (typeof renderManageList === 'function') renderManageList(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:persistAndRedraw'); }
        try { if (typeof updateInfoPanel === 'function') updateInfoPanel(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cloud-sync:persistAndRedraw'); }
        var parts = [];
        if (res.add) parts.push('nové: ' + res.add);
        if (res.edit) parts.push('upravené: ' + res.edit);
        if (res.del) parts.push('smazané: ' + res.del);
        if (parts.length) toast('Sdílení bodů ve firmě — ' + parts.join(', ') + '.');
    }

    // ------------------------------------------------------------------
    // diff lokálních změn proti poslednímu sesynchronizovanému stavu
    // ------------------------------------------------------------------
    function localChanges(st) {
        var P = points(); if (!P) return [];
        var now = Date.now(), out = [], seen = {}, i;
        for (i = 0; i < P.length; i++) {
            var pt = P[i]; if (!pt || pt.id == null) continue;
            var id = String(pt.id);
            seen[id] = 1;
            var s = slim(pt), h = fnv(stable(s));
            var k = st.known[id];
            if (!k || k.del || k.h !== h) out.push({ id: id, data: JSON.stringify(s), ts: now, deleted: 0, _h: h });
        }
        for (var kid in st.known) {
            if (!Object.prototype.hasOwnProperty.call(st.known, kid)) continue;
            var kk = st.known[kid];
            if (kk && !kk.del && !seen[kid]) out.push({ id: kid, ts: now, deleted: 1 });
        }
        return out;
    }

    // ------------------------------------------------------------------
    // synchronizační cyklus: napřed PULL (kvůli počátečnímu slévání a převzetí
    // id duplicit), pak PUSH lokálních změn
    // ------------------------------------------------------------------
    function pullAll(u, p, job, st, depth) {
        return u.cloudFetch('/sync/points?job=' + encodeURIComponent(job) + '&since=' + (st.since || 0)).then(function (r) {
            if (!r.ok) {
                _lastErr = r.status;
                if (r.status === 404) _noServerTs = Date.now();   // starý worker bez /sync/points
                return false;
            }
            var rows = (r.data && r.data.points) || [];
            var res = applyRows(p, st, rows);
            if (res === null) return false;   // mezitím přepnutá zakázka apod.
            var mx = st.since || 0;
            for (var i = 0; i < rows.length; i++) { var sv = +rows[i].srv || 0; if (sv > mx) mx = sv; }
            st.since = mx;
            saveSt(p, st);
            if (res.add || res.edit || res.del) persistAndRedraw(p, res);
            if (r.data && r.data.more && depth < 10) return pullAll(u, p, job, st, depth + 1);
            return true;
        });
    }

    function pushAll(u, p, job, st) {
        if (pid() !== p || !ready() || !consistent()) return Promise.resolve(false);
        var chg = localChanges(st);
        if (!chg.length) return Promise.resolve(true);
        var batch = chg.slice(0, PUSH_BATCH);
        var body = {
            job: job,
            changes: []
        };
        for (var i = 0; i < batch.length; i++) {
            var c = batch[i];
            body.changes.push(c.deleted ? { id: c.id, ts: c.ts, deleted: 1 } : { id: c.id, data: c.data, ts: c.ts, deleted: 0 });
        }
        return u.cloudFetch('/sync/points', { method: 'POST', body: body }).then(function (r) {
            if (!r.ok) {
                _lastErr = r.status;
                if (r.status === 404) _noServerTs = Date.now();
                return false;
            }
            for (var j = 0; j < batch.length; j++) {
                var c2 = batch[j];
                st.known[c2.id] = c2.deleted ? { ts: c2.ts, del: 1 } : { ts: c2.ts, h: c2._h };
            }
            pruneKnown(st);
            saveSt(p, st);
            if (chg.length > batch.length) return pushAll(u, p, job, st);
            return true;
        });
    }

    function due(force) {
        if (_busy) return false;
        if (force) return true;
        if (_noServerTs) return Date.now() - _noServerTs > NOSRV_RETRY;
        return Date.now() - _lastTry >= SYNC_EVERY;
    }

    function syncNow(force) {
        if (!due(force)) return;
        var u = U();
        if (!u || !u.isCloud || !u.isCloud() || !u.currentUser()) return;
        var p = pid();
        if (!enabled(p)) return;
        if (navigator.onLine === false) return;
        if (!ready() || !consistent()) return;
        if (force) _noServerTs = 0;
        _busy = true; _lastTry = Date.now();
        var st = loadSt(p), job = jobKey(p);
        var fin = function () { _busy = false; paint(); };
        try {
            pullAll(u, p, job, st, 0).then(function (ok) {
                if (!ok) { fin(); return; }
                return pushAll(u, p, job, st).then(function (ok2) {
                    if (ok2) { st.ok = Date.now(); _lastErr = 0; _noServerTs = 0; saveSt(p, st); }
                    fin();
                });
            })['catch'](fin);   // ['catch'] kvůli parse checku ve starém JScriptu (ES3 rezervované slovo)
        } catch (e) { fin(); }
    }

    // ------------------------------------------------------------------
    // UI: přepínač + stavová pilulka v Nastavení → Data
    // ------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-csync-sec .ag-csync-row .st-lab{flex:1;}',
            '.ag-csync-pill{display:inline-block;flex:none;padding:4px 10px;border-radius:999px;font:700 11px/1 var(--font-ui,system-ui);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.16));color:var(--text-muted,#9aa1ac);',
            '  background:var(--glass-bg,rgba(255,255,255,0.05));white-space:nowrap;}',
            '.ag-csync-pill.on{color:var(--accent,#2f9e74);border-color:var(--accent-line,rgba(47,158,116,0.4));background:var(--accent-soft,rgba(47,158,116,0.12));}',
            '.ag-csync-pill.warn{color:#d4a02c;border-color:rgba(212,160,44,0.45);background:rgba(212,160,44,0.1);}',
            '#ag-csync-note{font-size:calc(12px * var(--ag-font-scale, 1));color:var(--text-muted,#9aa1ac);margin-top:6px;line-height:1.5;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function pillState() {
        var u = U(), p = pid();
        if (!enabled(p)) return { t: 'Sync: vypnuto', c: '' };
        if (!u || !u.isCloud || !u.isCloud()) return { t: 'Sync: mimo cloud', c: 'warn' };
        if (!u.currentUser()) return { t: 'Sync: přihlas se', c: 'warn' };
        if (_noServerTs) return { t: 'Sync: server bez podpory', c: 'warn' };
        if (navigator.onLine === false) return { t: 'Sync: offline', c: 'warn' };
        var st = loadSt(p);
        if (st.ok) {
            var s = Math.max(0, Math.round((Date.now() - st.ok) / 1000));
            return { t: 'Sync: před ' + (s < 60 ? s + ' s' : Math.round(s / 60) + ' min'), c: 'on' };
        }
        if (_lastErr) return { t: 'Sync: chyba ' + _lastErr, c: 'warn' };
        return { t: 'Sync: čeká…', c: '' };
    }

    function paint() {
        var chk = document.getElementById('ag-csync-toggle');
        if (chk && chk !== document.activeElement) chk.checked = enabled(pid());
        var job = document.getElementById('ag-csync-job');
        if (job) job.textContent = '„' + jobKey(pid()) + '“';
        var pill = document.getElementById('ag-csync-pill');
        if (pill) {
            var s = pillState();
            pill.textContent = s.t;
            pill.className = 'ag-csync-pill' + (s.c ? ' ' + s.c : '');
        }
    }

    function ensureUI() {
        var tab = document.getElementById('tab-data');
        if (!tab) return;
        var u = U();
        var cloudOk = !!(u && u.isCloud && u.isCloud());
        var sec = document.getElementById('ag-csync-sec');
        if (!cloudOk) { if (sec) sec.style.display = 'none'; return; }
        if (!sec) {
            injectStyles();
            sec = document.createElement('div');
            sec.id = 'ag-csync-sec';
            // stejný přepínač jako všude jinde v Nastavení (.st-row + .st-sw), ne holý čtvereček
            sec.innerHTML = '<div class="set-h">Firemní cloud</div>'
                + '<div class="st-row ag-csync-row"><span class="st-lab">Sdílet body této zakázky ve firmě</span>'
                + '<span id="ag-csync-pill" class="ag-csync-pill"></span>'
                + '<label class="st-sw"><input type="checkbox" id="ag-csync-toggle"><span class="st-sw-face"></span></label></div>'
                + '<div id="ag-csync-note">Telefony přihlášené do stejné firmy sdílejí vlastní body zakázky '
                + '<b id="ag-csync-job"></b> (zakázky se párují názvem — na druhém zařízení založ zakázku stejného jména). '
                + 'Funguje i offline, změny se pošlou po připojení; při souběžné úpravě vyhrává poslední. Fotky bodů se nesdílejí.</div>';
            var selEl = document.getElementById('s-project-select');
            var row = selEl ? selEl.parentNode : null;   // řádek výběru zakázky v tabu Data
            if (row && row.parentNode === tab && row.nextSibling) tab.insertBefore(sec, row.nextSibling);
            else tab.appendChild(sec);
            var chk = sec.querySelector('#ag-csync-toggle');
            chk.addEventListener('change', function () {
                var on = !!chk.checked;
                setEnabled(pid(), on);
                _noServerTs = 0; _lastErr = 0;
                if (on) { toast('Sdílení bodů zapnuto — synchronizuji…'); syncNow(true); }
                else toast('Sdílení bodů této zakázky vypnuto.');
                paint();
            });
        }
        sec.style.display = '';
        paint();
    }

    // ------------------------------------------------------------------
    // start: pravidelný tep + rychlejší reakce na změny a návrat signálu
    // ------------------------------------------------------------------
    (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
        ensureUI();
        syncNow(false);
    }, TICK_MS);

    window.addEventListener('online', function () { setTimeout(function () { syncNow(true); }, 1500); });
    // po každé změně bodu (žurnál) pushni brzy — kolegové bod uvidí do pár vteřin
    window.addEventListener('agjournal:commit', function () {
        clearTimeout(_deb);
        _deb = setTimeout(function () { syncNow(true); }, 3000);
    });
    setTimeout(function () { syncNow(true); }, 9000);   // při startu (ready() počká na hydrataci)

    // malé veřejné API (ladění / jiné moduly)
    window.AGCloudSync = {
        syncNow: function () { syncNow(true); },
        enabled: function () { return enabled(pid()); },
        jobKey: function () { return jobKey(pid()); }
    };
})();
