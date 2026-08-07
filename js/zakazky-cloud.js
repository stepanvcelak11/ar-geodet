// ===== AR Geodet — FIREMNÍ ZAKÁZKY NAPŘÍČ TELEFONY (ODPOJITELNÁ vrstva) =======
// PROBLÉM: zakázka byla čistě lokální věc jednoho telefonu. Když ji v pondělí
// založil jeden geodet, druhý ji ve středu neměl — musel si ji ručně vyrobit
// pod stejným názvem (jinak se nespároval ani přenos bodů z js/cloud-sync.js).
//
// CO TENHLE MODUL DĚLÁ: v CLOUDOVÉ firmě (js/ucty.js + cloud/worker.js) drží
// SEZNAM ZAKÁZEK firmy společný pro všechna zařízení:
//   • zakázku založenou tady ohlásí serveru (POST /jobs),
//   • zakázky od kolegů si doplní k sobě (GET /jobs) — se stejným názvem, takže
//     na ně hned sedne i synchronizace bodů,
//   • u každé takové zakázky ZAPNE přenos bodů (klíč '<pid>_agCloudSync' modulu
//     js/cloud-sync.js) → co jeden změní v pondělí, druhý vidí ve středu,
//   • respektuje PŘIDĚLENÍ: admin v Administraci určí, kdo na zakázku smí;
//     ostatním se ze seznamu i z přepínačů ztratí (vymáhá js/ucty.js přes
//     agProjAcl_v1, který tenhle modul plní podle serveru).
//
// CO SE ZÁMĚRNĚ NEDĚJE:
//   • NIC SE NEMAŽE. Archivace zakázky na serveru lokální data neodstraní.
//   • DOSAVADNÍ zakázky se do firmy samy nenahrávají — při prvním zapnutí se jen
//     označí jako „známé", takže se nikomu nerozsypou do firmy staré testovací
//     zakázky. Nahrát je jde ručně (AGZakazkyCloud.publishAll(), tlačítko
//     v Nastavení → Data).
//   • PŘEJMENOVÁNÍ se nepřenáší: klíč zakázky na serveru JE normalizovaný název
//     (stejně jako u bodů), takže přejmenování = jiná zakázka. Kdo přejmenuje,
//     rozpojí si sdílení — proto to modul nedělá sám.
//
// Vypnutí: přepínač 'agJobsCloud' = '0' (Nastavení → Data). Odstranění: smaž
// js/zakazky-cloud.js + řádek <script> v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGZakazkyCloud) return;

    var LS_ON = 'agJobsCloud';        // '0' = nesdílet zakázky ve firmě
    var LS_MAP = 'agJobMap_v1';       // { jobKey: pid } — spárování serverové zakázky s lokální
    var LS_PUSHED = 'agJobsPushed_v1';// { pid: jobKey } — co už server o tomto zařízení ví
    var LS_SEEDED = 'agJobsSeeded_v1';// '1' = první zapnutí proběhlo (staré zakázky se nenahrály)
    var LS_PULLED = 'agJobsPulledTs';  // čas poslední úspěšné synchronizace seznamu
    var PULL_EVERY = 90000;           // seznam zakázek se mění zřídka — stačí 1,5 min
    var TICK_MS = 5000;

    var _busy = false, _lastPull = 0, _lastSig = null;

    function U() { return window.AGUcty || null; }
    function on() { try { return localStorage.getItem(LS_ON) !== '0'; } catch (e) { return true; } }
    function setOn(v) { try { if (v) localStorage.removeItem(LS_ON); else localStorage.setItem(LS_ON, '0'); } catch (e) {} }
    function toast(t) { try { if (typeof window.quickToast === 'function') window.quickToast(t); } catch (e) {} }
    function ls(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
    function jget(k) { try { var o = JSON.parse(localStorage.getItem(k) || 'null'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    function jset(k, o) { try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) {} }

    // klíč zakázky = normalizovaný název (MUSÍ souhlasit s js/cloud-sync.js, jinak
    // by registr ukazoval na jiný kbelík než body)
    function keyOfName(name) {
        var k = String(name || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').toLowerCase();
        return k.slice(0, 60);
    }
    function projList() {
        try {
            var a = JSON.parse(localStorage.getItem('arProjectsList') || 'null');
            if (Array.isArray(a) && a.length) return a;
        } catch (e) {}
        return [{ id: 'default', name: 'Výchozí zakázka' }];
    }
    function saveProjList(list) {
        try { localStorage.setItem('arProjectsList', JSON.stringify(list)); } catch (e) {}
        // globál z logika.js drží tentýž seznam — bez srovnání by appka přepsala náš zápis
        try { if (typeof projects !== 'undefined' && Array.isArray(projects)) { projects.length = 0; list.forEach(function (p) { projects.push(p); }); } } catch (e) {}
        try { if (typeof window.renderProjectSelect === 'function') window.renderProjectSelect(); } catch (e) {}
        try { if (typeof window.renderSettingsProjects === 'function') window.renderSettingsProjects(); } catch (e) {}
    }
    function active() {
        var u = U();
        if (!u || !on()) return false;
        if (!u.isCloud || !u.isCloud()) return false;      // registr žije jen v cloudové firmě
        if (!u.currentUser || !u.currentUser()) return false;
        return navigator.onLine !== false;
    }
    function meId() { var u = U(), c = u && u.currentUser && u.currentUser(); return c ? c.id : null; }
    function meBoss() { var u = U(), c = u && u.currentUser && u.currentUser(); return !!(c && (c.role === 'admin' || c.role === 'vedeni')); }

    // ---- zapnutí přenosu bodů pro sdílenou zakázku ----------------------------
    function enablePointSync(pid) {
        try { if (localStorage.getItem(pid + '_agCloudSync') !== '1') localStorage.setItem(pid + '_agCloudSync', '1'); } catch (e) {}
    }

    // ---- první zapnutí: staré zakázky se NEnahrávají --------------------------
    function seedIfNeeded() {
        if (ls(LS_SEEDED, '0') === '1') return;
        var pushed = jget(LS_PUSHED);
        projList().forEach(function (p) { if (p && p.id) pushed[p.id] = keyOfName(p.name); });
        jset(LS_PUSHED, pushed);
        try { localStorage.setItem(LS_SEEDED, '1'); } catch (e) {}
    }

    // ---- PUSH: zakázky založené na tomhle telefonu ohlásit firmě ---------------
    function pushNew() {
        var u = U(); if (!u) return Promise.resolve(0);
        var pushed = jget(LS_PUSHED);
        var todo = projList().filter(function (p) { return p && p.id && p.name && !pushed[p.id]; });
        if (!todo.length) return Promise.resolve(0);
        var n = 0;
        return todo.reduce(function (chain, p) {
            return chain.then(function () {
                return u.cloudFetch('/jobs', { method: 'POST', body: { name: p.name, key: keyOfName(p.name), ts: Date.now() } })
                    .then(function (r) {
                        if (!r || !r.ok) return;      // bez signálu / starý worker → zkusí se příště
                        pushed[p.id] = (r.data && r.data.key) || keyOfName(p.name);
                        jset(LS_PUSHED, pushed);
                        var map = jget(LS_MAP);
                        map[pushed[p.id]] = p.id;
                        jset(LS_MAP, map);
                        enablePointSync(p.id);
                        n++;
                    });
            });
        }, Promise.resolve()).then(function () { return n; });
    }

    // ---- PULL: zakázky firmy k sobě --------------------------------------------
    function pull() {
        var u = U(); if (!u) return Promise.resolve(false);
        return u.cloudFetch('/jobs').then(function (r) {
            if (!r || !r.ok || !r.data || !Array.isArray(r.data.jobs)) return false;
            var jobs = r.data.jobs.filter(function (j) { return j && j.key && j.name && !j.deleted; });
            var map = jget(LS_MAP);
            var list = projList();
            var byKey = {};
            list.forEach(function (p) { byKey[keyOfName(p.name)] = p; });
            var added = [];
            jobs.forEach(function (j) {
                var local = byKey[j.key];
                if (!local) {
                    // zakázka od kolegy — doplnit k sobě (prázdná, body si dotáhne cloud-sync)
                    local = { id: 'proj_' + Date.now() + '_' + Math.floor(Math.random() * 1000), name: j.name };
                    list.push(local);
                    byKey[j.key] = local;
                    added.push(j.name);
                }
                map[j.key] = local.id;
                enablePointSync(local.id);
            });
            if (added.length) saveProjList(list);
            jset(LS_MAP, map);
            mirrorAcl(jobs, map);
            try { localStorage.setItem(LS_PULLED, String(Date.now())); } catch (e) {}
            if (added.length) {
                toast(added.length === 1 ? ('Nová firemní zakázka: ' + added[0]) : ('Přidáno ' + added.length + ' firemních zakázek'));
                try { if (window.AGNotify && AGNotify.push) AGNotify.push({ text: 'Firemní zakázky: ' + added.join(', ') }); } catch (e) {}
            }
            return true;
        });
    }

    // ---- přidělení do agProjAcl_v1 (vymáhá js/ucty.js) -------------------------
    // Server posílá JEN zakázky, na které přihlášený smí. Lokální zakázky, které
    // server nezná (nikdy se neohlásily — třeba vznikly offline nebo před zapnutím
    // sdílení), se nesmí schovat: nejsou to cizí zakázky, jen soukromé.
    function mirrorAcl(jobs, map) {
        var u = U(), id = meId();
        if (!u || !id || !u.setProjAcl) return;
        if (meBoss()) { u.setProjAcl(id, []); return; }   // admin/vedení: bez omezení
        var allow = {};
        jobs.forEach(function (j) { if (map[j.key]) allow[map[j.key]] = 1; });
        var pushed = jget(LS_PUSHED);
        projList().forEach(function (p) {
            if (!p || !p.id) return;
            if (!pushed[p.id]) allow[p.id] = 1;            // server o ní neví → nechat být
        });
        var arr = Object.keys(allow);
        // Pojistka: kdyby výsledek byl prázdný (rozbitá odpověď), NEomezovat vůbec —
        // radši širší přístup než člověk, který se nedostane do žádné zakázky.
        u.setProjAcl(id, arr.length ? arr : []);
        try { if (u.applyProjPerms) u.applyProjPerms(); } catch (e) {}
    }

    // ---- jeden cyklus ----------------------------------------------------------
    function syncNow(force) {
        if (_busy || !active()) return Promise.resolve(false);
        var now = Date.now();
        if (!force && now - _lastPull < PULL_EVERY) return Promise.resolve(false);
        _busy = true;
        _lastPull = now;
        seedIfNeeded();
        return pushNew()
            .then(function () { return pull(); })
            ['catch'](function () { return false; })
            .then(function (okPull) { _busy = false; return okPull; });
    }

    // ruční nahrání dosavadních zakázek do firmy (Nastavení → Data)
    function publishAll() {
        var u = U();
        if (!u || !u.isCloud || !u.isCloud()) return Promise.resolve(0);
        jset(LS_PUSHED, {});                 // vše se bere jako neohlášené → pushNew je pošle
        return pushNew().then(function (n) {
            toast(n ? ('Do firmy nahráno ' + n + ' zakázek') : 'Nebylo co nahrát');
            return syncNow(true).then(function () { return n; });
        });
    }

    // ---- život modulu ----------------------------------------------------------
    function tick() {
        try {
            // seznam zakázek si appka překresluje sama; když se změnil, ohlas nové
            var sig = null;
            try { sig = localStorage.getItem('arProjectsList'); } catch (e) {}
            if (sig !== _lastSig) {
                _lastSig = sig;
                if (active()) { seedIfNeeded(); pushNew(); }
            }
            syncNow(false);
        } catch (e) {}
    }
    function init() {
        seedIfNeeded();
        setTimeout(function () { syncNow(true); }, 4000);     // po startu, ať se stihne přihlásit
        if (!window.__agJobsTimer) {
            window.__agJobsTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(tick, TICK_MS);
        }
        window.addEventListener('agucty:login', function () { setTimeout(function () { syncNow(true); }, 1500); });
        window.addEventListener('online', function () { setTimeout(function () { syncNow(true); }, 2000); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGZakazkyCloud = {
        syncNow: function () { return syncNow(true); },
        publishAll: publishAll,
        enabled: on,
        setEnabled: function (v) { setOn(v); if (v) syncNow(true); },
        keyForPid: function (pid) {
            var map = jget(LS_MAP);
            for (var k in map) { if (map[k] === pid) return k; }
            var pushed = jget(LS_PUSHED);
            return pushed[pid] || null;
        },
        pidForKey: function (key) { return jget(LS_MAP)[key] || null; },
        lastPull: function () { var v = parseInt(ls(LS_PULLED, '0'), 10); return v || 0; }
    };
})();
