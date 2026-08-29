// ===== AR Geodet — GPS KAMPAŇ „3 NÁVŠTĚVY" (A1, ODPOJITELNÁ vrstva) ============
// Vícedenní měřicí kampaň pro Brutální GPS. Chyba mobilní GNSS je během jedné
// návštěvy systematicky posunutá (atmosféra + okamžitá geometrie družic);
// konstelace GPS se opakuje po ~23 h 56 min, takže měření v JINOU denní dobu
// má JINOU systematiku. Tři sezení v různých konstelacích → jejich spojení
// (inverzně-varianční průměr už umí brutal-gps) je výrazně blíž pravdě.
//
// Co modul dělá:
//   • Po prvním sezení v Brutální GPS nabídne „Naplánovat kampaň (3 návštěvy)".
//   • Ze satelitního enginu (satelity.js) najde 2 okna s co NEJODLIŠNĚJŠÍ
//     sestavou viditelných družic (Jaccardova odlišnost) a slušným PDOP.
//     Bez stažených drah (TLE) padá na jednoduché +6 h a +27 h.
//   • Plán drží v localStorage; při startu appky připomene (toast + notifikace,
//     je-li povolená) a v Brutální GPS ukazuje stav kampaně (sezení k/3).
//   • Po uložení bodu (save v brutal-gps) kampaň ukončí.
//
// Vazba na brutal-gps.js: hooky AGCampaign.onBrutalOpen/onSession/onSaved,
// volané guarded (try/typeof) — bez tohoto souboru appka funguje beze změny.
// Odstranění: smaž js/gps-campaign.js + řádky v index.html a sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGCampaign) return;

    var LS_KEY = 'agGpsCampaign_v1';
    var LS_SESS = 'agBrutalSessions';         // sezení drží brutal-gps.js
    var SCAN_FROM_MIN = 180;                  // plánovat nejdřív za 3 h
    var SCAN_TO_MIN = 52 * 60;                // …a nejdál za ~2 dny
    var SCAN_STEP_MIN = 30;
    var SLOT_GAP_MIN = 6 * 60;                // 2. návštěva aspoň 6 h od 1.
    var WINDOW_MIN = 90;                      // připomínka: okno ±90 min

    // ---- pomůcky ----------------------------------------------------------------
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-campaign:agAlert'); } agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function toast(msg) { try { if (typeof quickToast === 'function') { quickToast(msg); return; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-campaign:toast'); } try { console.log('[kampaň]', msg); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-campaign:toast'); } }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function load() { try { var o = JSON.parse(localStorage.getItem(LS_KEY)); return (o && typeof o === 'object' && Array.isArray(o.plan)) ? o : null; } catch (e) { return null; } }
    function save(c) { try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-campaign:save'); } }
    function clear() { try { localStorage.removeItem(LS_KEY); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-campaign:clear'); } }
    function sessCount() { try { var a = JSON.parse(localStorage.getItem(LS_SESS)); return Array.isArray(a) ? a.length : 0; } catch (e) { return 0; } }
    function mask() { try { return (typeof SAT_EL_MASK !== 'undefined' && isFinite(SAT_EL_MASK)) ? SAT_EL_MASK : 10; } catch (e) { return 10; } }
    function hasSat() { try { return typeof computeSatPositions === 'function' && typeof computePDOP === 'function'; } catch (e) { return false; } }

    // „dnes 14:30" / „zítra 9:05" / „28. 7. 14:30"
    function fmtWhen(ts) {
        var d = new Date(ts), now = new Date();
        var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        var dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        var diff = Math.round((dd - day0) / 86400000);
        if (diff === 0) return 'dnes ' + hm;
        if (diff === 1) return 'zítra ' + hm;
        return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + hm;
    }

    // ---- odlišnost konstelací -----------------------------------------------------
    // „podpis" oblohy = množina jmen družic nad maskou v daný čas
    function sigAt(ts) {
        try {
            var obs = computeSatPositions(new Date(ts)) || [];
            var m = mask();
            return obs.filter(function (o) { return o.el >= m; }).map(function (o) { return o.name || o.short || ''; });
        } catch (e) { return null; }
    }
    function jaccardDiff(a, b) {
        if (!a || !b || (!a.length && !b.length)) return 0;
        var setA = {}, inter = 0, uni = 0, k;
        a.forEach(function (n) { setA[n] = 1; });
        b.forEach(function (n) { if (setA[n]) { inter++; setA[n] = 2; } });
        for (k in setA) uni++;
        b.forEach(function (n) { if (!setA[n]) uni++; });
        return uni ? 1 - inter / uni : 0;
    }

    // ---- plánovač: 2 okna s nejodlišnější geometrií -------------------------------
    // Asynchronně po dávkách (SGP4 nad ~50 družicemi × ~100 časů by jinak zamrzl UI).
    function planWindows(cb, progress) {
        var now = Date.now();
        if (!hasSat()) {
            // fallback bez TLE: jiná denní doba dnes večer + zítra dopoledne
            cb([{ ts: now + 6 * 3600000, pdop: null, n: null, diff: null },
                { ts: now + 27 * 3600000, pdop: null, n: null, diff: null }], true);
            return;
        }
        try { if ((typeof tleSats === 'undefined' || !tleSats || !tleSats.length) && typeof loadTleFromCache === 'function') loadTleFromCache(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-campaign:planWindows'); }
        var sig0 = sigAt(now);
        if (!sig0 || !sig0.length) {
            cb([{ ts: now + 6 * 3600000, pdop: null, n: null, diff: null },
                { ts: now + 27 * 3600000, pdop: null, n: null, diff: null }], true);
            return;
        }
        var mins = [], m;
        for (m = SCAN_FROM_MIN; m <= SCAN_TO_MIN; m += SCAN_STEP_MIN) mins.push(m);
        var cands = [], i = 0, mk = mask();
        function step() {
            var end = Math.min(i + 6, mins.length);
            for (; i < end; i++) {
                try {
                    var ts = now + mins[i] * 60000;
                    var obs = computeSatPositions(new Date(ts)) || [];
                    var vis = obs.filter(function (o) { return o.el >= mk; });
                    var p = computePDOP(obs);
                    if (p == null || !isFinite(p) || p > 4.5 || vis.length < 5) continue;
                    var sig = vis.map(function (o) { return o.name || o.short || ''; });
                    cands.push({ ts: ts, pdop: p, n: vis.length, sig: sig, diff: jaccardDiff(sig0, sig) });
                } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-campaign:step'); }
            }
            if (progress) { try { progress(Math.round(i / mins.length * 100)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-campaign:step'); } }
            if (i < mins.length) { setTimeout(step, 0); return; }
            // výběr: 1. slot = max (odlišnost − pokuta za PDOP); 2. slot ≥6 h od 1. a odlišný i od něj
            if (!cands.length) {
                cb([{ ts: now + 6 * 3600000, pdop: null, n: null, diff: null },
                    { ts: now + 27 * 3600000, pdop: null, n: null, diff: null }], true);
                return;
            }
            function score(c, other) {
                var s = c.diff * 3 - Math.max(0, c.pdop - 2) * 0.4;
                if (other) s += jaccardDiff(other.sig, c.sig) * 1.5;
                return s;
            }
            var s1 = cands.slice().sort(function (a, b) { return score(b, null) - score(a, null); })[0];
            var rest = cands.filter(function (c) { return Math.abs(c.ts - s1.ts) >= SLOT_GAP_MIN * 60000; });
            var s2 = rest.length ? rest.sort(function (a, b) { return score(b, s1) - score(a, s1); })[0] : null;
            var out = [ { ts: s1.ts, pdop: s1.pdop, n: s1.n, diff: s1.diff } ];
            if (s2) out.push({ ts: s2.ts, pdop: s2.pdop, n: s2.n, diff: s2.diff });
            out.sort(function (a, b) { return a.ts - b.ts; });
            cb(out, false);
        }
        step();
    }

    // ---- notifikace ---------------------------------------------------------------
    function notify(title, body) {
        try {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
                navigator.serviceWorker.ready.then(function (reg) {
                    try { reg.showNotification(title, { body: body, icon: 'icon-192.png', tag: 'ag-campaign' }); }
                    catch (e) { try { new Notification(title, { body: body }); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'gps-campaign:notify'); } }
                });
            } else { new Notification(title, { body: body }); }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-campaign:notify'); }
    }

    // ---- plánovací modal ------------------------------------------------------------
    var DLG_ID = 'ag-campaign-modal';
    function ensureModal() {
        if (document.getElementById(DLG_ID)) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = DLG_ID;
        el.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent); margin-top:0; margin-bottom:5px;">📅 Kampaň: 3 návštěvy</h3>'
            + '<p style="margin:0 0 10px; font-size:calc(12.5px * var(--ag-font-scale, 1)); opacity:0.8;">Chyba GPS se během dne systematicky posouvá. Tři sezení v různých konstelacích družic se zprůměrují a systematika se z velké části vyruší — typicky ±0,3–0,5 m → ±0,15–0,25 m.</p>'
            + '<div class="modal-body" id="ag-campaign-body"></div>'
            + '<button class="btn btn-secondary" style="margin-top:15px;" id="ag-campaign-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        el.querySelector('#ag-campaign-close').addEventListener('click', function () { el.style.display = 'none'; });
        el.addEventListener('mousedown', function (e) { if (e.target === el) el.style.display = 'none'; });
    }
    function openModal() {
        ensureModal();
        var el = document.getElementById(DLG_ID);
        el.style.display = 'flex';
        renderModal();
    }
    function renderModal() {
        var body = document.getElementById('ag-campaign-body');
        if (!body) return;
        var camp = load();
        if (camp) {
            var k = Math.min(sessCount(), 3);
            var rows = camp.plan.map(function (w, i) {
                var past = w.ts < Date.now();
                return '<div class="geo-data-row" style="padding:6px 0;"><span class="geo-label">Návštěva ' + (i + 2) + '</span>'
                    + '<span class="geo-value">' + fmtWhen(w.ts)
                    + (w.pdop != null ? ' · PDOP ' + w.pdop.toFixed(1) : '')
                    + (w.diff != null ? ' · jiná obloha ' + Math.round(w.diff * 100) + ' %' : '')
                    + (past ? ' (proběhlo?)' : '') + '</span></div>';
            }).join('');
            var notifState = ('Notification' in window) ? Notification.permission : 'unsupported';
            body.innerHTML = '<p style="font-size:calc(13px * var(--ag-font-scale, 1));"><b>' + esc(camp.name || 'Bod') + '</b> — hotová sezení: <b>' + k + '/3</b>'
                + (camp.fallback ? '<br><span style="opacity:.7; font-size:calc(12px * var(--ag-font-scale, 1));">Plán bez drah družic (obecné pravidlo „jiná denní doba"). Pro chytřejší plán otevři jednou „GNSS satelity" a naplánuj znovu.</span>' : '') + '</p>'
                + rows
                + '<p style="font-size:calc(12px * var(--ag-font-scale, 1)); opacity:.75; margin:10px 0 6px;">Připomínka naskočí po otevření appky v okně ±' + (WINDOW_MIN / 60).toFixed(1).replace('.0', '') + ' h kolem termínu. Appka si sama „nezavolá" — notifikace na pozadí bez serveru neumí.</p>'
                + (notifState === 'granted'
                    ? '<p style="font-size:calc(12px * var(--ag-font-scale, 1)); color:var(--accent);">Notifikace povoleny ✓</p>'
                    : (notifState === 'unsupported' ? '' : '<button class="btn btn-secondary" id="ag-campaign-notif" style="margin-top:4px;">Povolit notifikace</button>'))
                + '<button class="btn btn-secondary" id="ag-campaign-replan" style="margin-top:8px;">Naplánovat znovu</button>'
                + '<button class="btn btn-secondary" id="ag-campaign-cancel" style="margin-top:8px; color:var(--danger,#fb7185);">Zrušit kampaň</button>';
            var nb = document.getElementById('ag-campaign-notif');
            if (nb) nb.addEventListener('click', function () { try { Notification.requestPermission().then(renderModal); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-campaign:renderModal'); } });
            var rb = document.getElementById('ag-campaign-replan');
            if (rb) rb.addEventListener('click', function () { startPlanning(camp.lat, camp.lng, camp.name); });
            var cb = document.getElementById('ag-campaign-cancel');
            if (cb) cb.addEventListener('click', function () { clear(); renderModal(); refreshCard(); });
            return;
        }
        // bez kampaně: nabídka založení (vyžaduje aspoň 1 sezení, ať máme polohu)
        var sess = null;
        try { var a = JSON.parse(localStorage.getItem(LS_SESS)); if (Array.isArray(a) && a.length) sess = a[a.length - 1]; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'gps-campaign:renderModal'); }
        if (!sess) {
            body.innerHTML = '<p style="font-size:calc(13px * var(--ag-font-scale, 1));">Nejdřív změř v Brutální GPS <b>první sezení</b> a ulož ho tlačítkem „Přidat jako další sezení". Pak sem naplánuju zbylé 2 návštěvy.</p>';
            return;
        }
        body.innerHTML = '<p style="font-size:calc(13px * var(--ag-font-scale, 1));">První sezení je hotové. Naplánuju 2 další návštěvy s co nejodlišnější sestavou družic (a dobrým PDOP) v příštích 2 dnech.</p>'
            + '<input class="bgps-name" id="ag-campaign-name" type="text" placeholder="Název bodu (např. BG1)" style="width:100%; margin:6px 0;">'
            + '<button class="btn" id="ag-campaign-go">Naplánovat 2 návštěvy</button>';
        document.getElementById('ag-campaign-go').addEventListener('click', function () {
            var nm = (document.getElementById('ag-campaign-name').value || '').trim() || 'Bod';
            startPlanning(sess.lat, sess.lng, nm);
        });
    }
    function startPlanning(lat, lng, name) {
        var body = document.getElementById('ag-campaign-body');
        if (body) body.innerHTML = '<p style="font-size:calc(13px * var(--ag-font-scale, 1));">Počítám dráhy družic… <span id="ag-campaign-prog">0 %</span></p>';
        planWindows(function (plan, fallback) {
            save({ created: Date.now(), name: name || 'Bod', lat: lat, lng: lng, plan: plan, fallback: !!fallback, notified: {} });
            renderModal(); refreshCard();
        }, function (pct) {
            var p = document.getElementById('ag-campaign-prog'); if (p) p.textContent = pct + ' %';
        });
    }

    // ---- karta v overlayi Brutální GPS ---------------------------------------------
    var _brutalUi = null;
    function refreshCard() {
        if (!_brutalUi) return;
        var card = _brutalUi.querySelector('#bgps-campaign');
        if (!card) {
            card = document.createElement('div');
            card.id = 'bgps-campaign';
            card.className = 'bgps-card amber';
            card.style.cursor = 'pointer';
            card.addEventListener('click', openModal);
            var anchor = _brutalUi.querySelector('#bgps-reocc');
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor.nextSibling);
            else _brutalUi.appendChild(card);
        }
        var camp = load();
        if (camp) {
            var k = Math.min(sessCount(), 3);
            var next = null;
            for (var i = 0; i < camp.plan.length; i++) { if (camp.plan[i].ts > Date.now() - WINDOW_MIN * 60000) { next = camp.plan[i]; break; } }
            card.style.display = '';
            card.innerHTML = '<b>📅 Kampaň „' + esc(camp.name) + '": sezení ' + k + '/3</b>'
                + (k >= 3 ? ' — hotovo, ulož bod.' : (next ? ' — další ' + fmtWhen(next.ts) + '.' : ' — termíny prošly, změř kdykoli (jinou denní dobu).'))
                + ' <span style="opacity:.7;">(detail klepnutím)</span>';
        } else if (sessCount() >= 1) {
            card.style.display = '';
            card.innerHTML = '<b>📅 Naplánovat kampaň (3 návštěvy)</b> — jiná konstelace družic vyruší systematiku. <span style="opacity:.7;">(klepni)</span>';
        } else {
            card.style.display = 'none';
        }
    }

    // ---- hooky z brutal-gps.js -------------------------------------------------------
    function onBrutalOpen(ui) { _brutalUi = ui; refreshCard(); }
    function onSession(sessions, ui) {
        if (ui) _brutalUi = ui;
        refreshCard();
        var camp = load();
        if (!camp && sessions && sessions.length === 1) {
            toast('Tip: naplánuj kampaň „3 návštěvy" — 2 další sezení jindy zpřesní bod (karta dole).');
        }
        if (camp && sessions && sessions.length >= 3) {
            toast('Kampaň „' + (camp.name || 'Bod') + '": 3/3 sezení hotová — můžeš uložit bod.');
        }
    }
    function onSaved() { if (load()) { clear(); toast('Kampaň dokončena a uzavřena — bod je uložen ze spojených sezení.'); } refreshCard(); }

    // ---- připomínka při startu appky --------------------------------------------------
    function checkReminder() {
        var camp = load();
        if (!camp) return;
        if (!camp.notified) camp.notified = {};
        var now = Date.now(), k = Math.min(sessCount(), 3);
        if (k >= 3) { toast('Kampaň „' + camp.name + '": vše změřeno — otevři Brutální GPS a ulož bod.'); return; }
        for (var i = 0; i < camp.plan.length; i++) {
            var w = camp.plan[i];
            if (Math.abs(now - w.ts) <= WINDOW_MIN * 60000) {
                var key = 'w' + i;
                var msg = 'Kampaň „' + camp.name + '": teď je vhodné okno na sezení ' + (k + 1) + '/3 (' + fmtWhen(w.ts) + ').';
                toast(msg);
                if (!camp.notified[key]) { notify('AR Geodet — kampaň', msg); camp.notified[key] = 1; save(camp); }
                return;
            }
        }
        // prošlé okno (do 20 h zpět): připomeň měkce
        for (var j = 0; j < camp.plan.length; j++) {
            var p = camp.plan[j];
            if (now - p.ts > WINDOW_MIN * 60000 && now - p.ts < 20 * 3600000 && k < j + 2) {
                toast('Kampaň „' + camp.name + '": okno ' + fmtWhen(p.ts) + ' prošlo — změř sezení ' + (k + 1) + '/3 dnes kdykoli (hlavně jinou denní dobu).');
                return;
            }
        }
    }

    window.AGCampaign = { onBrutalOpen: onBrutalOpen, onSession: onSession, onSaved: onSaved, open: openModal };

    function init() { setTimeout(checkReminder, 4000); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
