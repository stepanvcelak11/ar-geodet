// ===== AR Geodet — PŘIPOMÍNKY EPOCH MONITORINGU (ODPOJITELNÁ vrstva) ===========
// Doplněk nástroje Epochy (js/epochy.js): u každého sledovaného bodu jde nastavit
// interval přeměření (7/14/30 dní nebo vlastní). Appka pak po startu ukáže lištu
// „Monitoring: N bodů po termínu přeměření — Otevřít / Později" a na dlaždici
// Epochy v Nástrojích svítí červená tečka s počtem bodů po termínu.
//
// NEEDITUJE epochy.js — UI (select „Připomínka přeměření" + přepínač notifikací)
// se injektuje do detailu sledovaného bodu přes MutationObserver na #ag-ep-body.
// Volitelné systémové notifikace: o povolení se žádá AŽ když uživatel zapne
// přepínač; když nejsou k dispozici, stačí lišta (vždy se ukáže i tak).
//
// Data: localStorage klíč agEpochyRemind::<pid> — { pts: {bodId:{days}},
// snoozeTs, notif, lastNotifTs }; termín = poslední epocha bodu + days dní.
// Data epoch se jen ČTOU přes getStoredData('agEpochy_v1') (per zakázka).
// Odstranění: smaž js/epochy-pripominky.js + řádek <script> v index.html
// (a přegeneruj sw.js). Nástroj Epochy funguje dál beze změny.
// ================================================================================
(function () {
    'use strict';
    if (window.__agEpRemindInit) return;
    window.__agEpRemindInit = true;

    var EP_KEY = 'agEpochy_v1';
    var DAY_MS = 86400000;
    var BAR_ID = 'ag-epr-bar';
    var BOX_ID = 'ag-epr-box';

    // ---- util ---------------------------------------------------------------
    function toast(m) { try { if (typeof window.quickToast === 'function') return window.quickToast(m); } catch (e) {} try { if (typeof window.agInfo === 'function') window.agInfo(m); } catch (e2) {} }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function rkey() { return 'agEpochyRemind::' + pid(); }
    function sameDay(a, b) { try { return new Date(a).toDateString() === new Date(b).toDateString(); } catch (e) { return false; } }
    function bodWord(n) { return n === 1 ? 'bod' : (n >= 2 && n <= 4 ? 'body' : 'bodů'); }
    function fmtD(t) { try { return new Date(t).toLocaleDateString('cs-CZ'); } catch (e) { return ''; } }

    // ---- data ----------------------------------------------------------------
    function loadR() {
        try {
            var r = JSON.parse(localStorage.getItem(rkey()));
            if (r && typeof r === 'object') { if (!r.pts || typeof r.pts !== 'object') r.pts = {}; return r; }
        } catch (e) {}
        return { pts: {}, snoozeTs: 0, notif: false, lastNotifTs: 0 };
    }
    function saveR(r) { try { localStorage.setItem(rkey(), JSON.stringify(r)); } catch (e) {} _cacheT = 0; }

    // sledované body nástroje Epochy (jen čtení, per aktivní zakázka)
    function epItems() {
        try {
            if (typeof window.getStoredData !== 'function') return null;
            var raw = window.getStoredData(EP_KEY);
            var p = raw ? JSON.parse(raw) : null;
            return (p && Array.isArray(p.items)) ? p.items : [];
        } catch (e) { return null; }
    }

    // body po termínu: [{id,name,due}] — s krátkou cache (tick běží periodicky)
    var _cacheT = 0, _cacheList = [];
    function overdueList() {
        if (Date.now() - _cacheT < 30000) return _cacheList;
        var out = [];
        var items = epItems();
        if (items && items.length) {
            var r = loadR();
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                var cfg = r.pts[it.id];
                if (!cfg || !(cfg.days > 0) || !it.epochs || !it.epochs.length) continue;
                var due = it.epochs[it.epochs.length - 1].t + cfg.days * DAY_MS;
                if (Date.now() > due) out.push({ id: it.id, name: it.name, due: due });
            }
        }
        _cacheT = Date.now(); _cacheList = out;
        return out;
    }
    // úklid připomínek bodů, které už neexistují (jen když data epoch jdou přečíst)
    function pruneR() {
        var items = epItems();
        if (!items) return;
        var have = {}, i;
        for (i = 0; i < items.length; i++) have[items[i].id] = true;
        var r = loadR(), changed = false;
        for (var k in r.pts) { if (r.pts.hasOwnProperty(k) && !have[k]) { delete r.pts[k]; changed = true; } }
        if (changed) saveR(r);
    }

    // ---- styly -----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('ag-epr-style')) return;
        var st = document.createElement('style'); st.id = 'ag-epr-style';
        st.textContent = [
            '.ag-epr-box{margin:6px 0 10px;padding:9px 12px;border-radius:12px;background:rgba(77,163,255,0.06);border:1px solid rgba(77,163,255,0.25);}',
            '.ag-epr-box .ag-epr-ttl{display:block;font-size:calc(11.5px * var(--ag-font-scale, 1));opacity:.75;margin-bottom:3px;}',
            '.ag-epr-box select,.ag-epr-box input[type=number]{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:10px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.05);color:var(--text-color,#e8edf2);font:600 15px/1.1 var(--font-ui,system-ui),sans-serif;}',
            '.ag-epr-box .ag-epr-row{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;}',
            '.ag-epr-box .ag-epr-row>label{flex:1 1 140px;min-width:0;display:block;}',
            '.ag-epr-box .ag-epr-due{font-size:calc(11.5px * var(--ag-font-scale, 1));opacity:.8;margin-top:6px;line-height:1.4;}',
            '.ag-epr-box .ag-epr-due.ag-epr-over{color:#f87171;opacity:1;font-weight:700;}',
            '.ag-epr-box .ag-epr-notif{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.9;cursor:pointer;}',
            '.ag-epr-box .ag-epr-notif input{width:auto;margin:0;}',
            '.ag-epr-custom{display:none;margin-top:6px;}',
            '.ag-epr-custom.on{display:flex;gap:8px;}',
            '.ag-epr-custom input{flex:1;}',
            '.ag-epr-custom button{flex:0 0 auto;border:none;border-radius:10px;padding:9px 14px;font:700 13px/1 var(--font-ui,system-ui),sans-serif;background:var(--accent,#2f9e74);color:#04110b;cursor:pointer;}',
            // červená tečka s počtem na dlaždici Epochy
            '.tool-tile[data-tool="epochy"]{position:relative;}',
            '.ag-epr-badge{position:absolute;top:6px;right:6px;min-width:17px;height:17px;padding:0 4px;box-sizing:border-box;border-radius:9px;',
            '  background:#ef4444;color:#fff;font:700 10.5px/17px var(--font-ui,system-ui),sans-serif;text-align:center;pointer-events:none;}',
            // lišta po startu
            '#' + BAR_ID + '{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 84px);z-index:15000;',
            '  display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:14px;background:var(--glass-bg,rgba(24,28,33,0.94));',
            '  border:1px solid rgba(239,68,68,0.5);color:var(--text-color,#eceef2);font:500 13px/1.35 var(--font-ui,system-ui),sans-serif;',
            '  box-shadow:0 10px 30px rgba(0,0,0,0.5);max-width:92vw;}',
            '#' + BAR_ID + ' .ag-epr-go{border:none;border-radius:9px;padding:8px 13px;font:700 13px/1 var(--font-ui,system-ui),sans-serif;background:var(--accent,#2f9e74);color:#04110b;cursor:pointer;}',
            '#' + BAR_ID + ' .ag-epr-later{border:none;background:none;color:var(--text-muted,#9aa1ac);font:500 13px/1 var(--font-ui,system-ui),sans-serif;text-decoration:underline;cursor:pointer;padding:8px 4px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- injekce UI do detailu sledovaného bodu (modal nástroje Epochy) -----------
    // Detail poznáme podle pole #ag-ep-limp; sledovaný bod dohledáme podle názvu
    // v nadpisu (epochy.js si drží aktuální položku jen interně).
    function injectDetailUI() {
        var body = document.getElementById('ag-ep-body');
        if (!body || document.getElementById(BOX_ID)) return;
        var limp = body.querySelector('#ag-ep-limp');
        if (!limp) return;                                   // není detail (seznam)
        var h3 = body.querySelector('.ag-ep-head h3');
        var name = h3 ? (h3.textContent || '').trim() : '';
        if (!name) return;
        var items = epItems();
        if (!items) return;
        var it = null;
        for (var i = 0; i < items.length; i++) if (items[i].name === name) { it = items[i]; break; }
        if (!it) return;

        injectStyles();
        var r = loadR();
        var cfg = r.pts[it.id] || null;
        var days = cfg && cfg.days > 0 ? cfg.days : 0;

        var box = document.createElement('div');
        box.id = BOX_ID; box.className = 'ag-epr-box';

        var opts = '<option value="0"' + (days === 0 ? ' selected' : '') + '>— žádná —</option>'
            + '<option value="7"' + (days === 7 ? ' selected' : '') + '>každých 7 dní</option>'
            + '<option value="14"' + (days === 14 ? ' selected' : '') + '>každých 14 dní</option>'
            + '<option value="30"' + (days === 30 ? ' selected' : '') + '>každých 30 dní</option>';
        if (days > 0 && days !== 7 && days !== 14 && days !== 30) {
            opts += '<option value="' + days + '" selected>každých ' + days + ' dní (vlastní)</option>';
        }
        opts += '<option value="custom">vlastní…</option>';

        box.innerHTML = '<span class="ag-epr-ttl">Připomínka přeměření</span>'
            + '<div class="ag-epr-row"><label><select id="ag-epr-days">' + opts + '</select></label></div>'
            + '<div class="ag-epr-custom" id="ag-epr-custom"><input type="number" id="ag-epr-custom-n" inputmode="numeric" min="1" step="1" placeholder="počet dní"><button type="button" id="ag-epr-custom-ok">Nastavit</button></div>'
            + '<div class="ag-epr-due" id="ag-epr-due"></div>'
            + '<label class="ag-epr-notif"><input type="checkbox" id="ag-epr-notif"' + (r.notif ? ' checked' : '') + '> Upozorňovat i systémovou notifikací</label>';

        // vlož za řádek s mezemi ΔP/ΔZ (nenásilně, bez zásahu do epochy.js)
        var row = null;
        try { row = limp.closest ? limp.closest('.ag-ep-row') : null; } catch (e) {}
        if (row && row.parentNode) row.parentNode.insertBefore(box, row.nextSibling);
        else body.appendChild(box);

        function setDays(d) {
            var r2 = loadR();
            if (d > 0) r2.pts[it.id] = { days: d };
            else delete r2.pts[it.id];
            saveR(r2);
            refreshDue(d);
            updateBadges();
            toast(d > 0 ? ('Připomínka nastavena: každých ' + d + ' dní.') : 'Připomínka zrušena.');
        }
        function refreshDue(d) {
            var el = document.getElementById('ag-epr-due');
            if (!el) return;
            if (!(d > 0)) { el.textContent = 'Bez připomínky.'; el.className = 'ag-epr-due'; return; }
            if (!it.epochs || !it.epochs.length) { el.textContent = 'Termín se počítá od poslední epochy — zatím žádná není.'; el.className = 'ag-epr-due'; return; }
            var due = it.epochs[it.epochs.length - 1].t + d * DAY_MS;
            if (Date.now() > due) {
                var late = Math.floor((Date.now() - due) / DAY_MS);
                el.textContent = '⚠ Po termínu přeměření (' + fmtD(due) + (late > 0 ? ', ' + late + ' d zpožděné' : '') + ').';
                el.className = 'ag-epr-due ag-epr-over';
            } else {
                el.textContent = 'Další přeměření do: ' + fmtD(due) + '.';
                el.className = 'ag-epr-due';
            }
        }
        refreshDue(days);

        var sel = box.querySelector('#ag-epr-days');
        var cust = box.querySelector('#ag-epr-custom');
        sel.addEventListener('change', function () {
            if (sel.value === 'custom') { cust.className = 'ag-epr-custom on'; return; }
            cust.className = 'ag-epr-custom';
            setDays(parseInt(sel.value, 10) || 0);
        });
        box.querySelector('#ag-epr-custom-ok').addEventListener('click', function () {
            var n = parseInt((box.querySelector('#ag-epr-custom-n') || {}).value, 10);
            if (!(n > 0) || n > 3650) return toast('Zadej počet dní (1–3650).');
            cust.className = 'ag-epr-custom';
            // promítni vlastní hodnotu do selectu (idempotentně)
            var own = null;
            for (var j = 0; j < sel.options.length; j++) if (sel.options[j].getAttribute('data-own')) { own = sel.options[j]; break; }
            if (n !== 7 && n !== 14 && n !== 30) {
                if (!own) { own = document.createElement('option'); own.setAttribute('data-own', '1'); sel.insertBefore(own, sel.querySelector('option[value="custom"]')); }
                own.value = String(n); own.textContent = 'každých ' + n + ' dní (vlastní)';
                sel.value = String(n);
            } else { if (own) own.remove(); sel.value = String(n); }
            setDays(n);
        });

        // notifikace: o povolení žádáme AŽ na výslovné zapnutí přepínače
        var chk = box.querySelector('#ag-epr-notif');
        chk.addEventListener('change', function () {
            var r3 = loadR();
            if (!chk.checked) { r3.notif = false; saveR(r3); return; }
            if (!('Notification' in window) || typeof Notification.requestPermission !== 'function') {
                chk.checked = false;
                return toast('Notifikace tenhle prohlížeč nenabízí — zůstane lišta po startu.');
            }
            try {
                Promise.resolve(Notification.requestPermission()).then(function (perm) {
                    if (perm === 'granted') { var r4 = loadR(); r4.notif = true; saveR(r4); toast('Notifikace zapnuty.'); }
                    else { chk.checked = false; toast('Notifikace nejsou povolené — zůstane lišta po startu.'); }
                })['catch'](function () { chk.checked = false; });   // ['catch'] kvůli parse checku v JScriptu (ES3 reserved word)
            } catch (e) { chk.checked = false; }
        });
    }

    // modal nástroje Epochy vzniká líně — hlídej jeho tělo, až bude existovat
    function watchModal() {
        var body = document.getElementById('ag-ep-body');
        if (!body || body.__agEprWatched) { if (body) injectDetailUI(); return; }
        body.__agEprWatched = true;
        try {
            new MutationObserver(function () { setTimeout(injectDetailUI, 0); }).observe(body, { childList: true });
        } catch (e) {}
        injectDetailUI();
    }

    // ---- badge na dlaždici Epochy (dlaždice se přerenderovávají → periodicky) -----
    function updateBadges() {
        var n = overdueList().length;
        var tiles = document.querySelectorAll('[data-tool="epochy"]');
        for (var i = 0; i < tiles.length; i++) {
            var b = tiles[i].querySelector('.ag-epr-badge');
            if (!n) { if (b) b.remove(); continue; }
            injectStyles();
            if (!b) { b = document.createElement('span'); b.className = 'ag-epr-badge'; tiles[i].appendChild(b); }
            var txt = n > 9 ? '9+' : String(n);
            if (b.textContent !== txt) b.textContent = txt;
        }
    }

    // ---- lišta po startu appky -------------------------------------------------
    function showBar(od) {
        if (document.getElementById(BAR_ID)) return;
        injectStyles();
        var bar = document.createElement('div');
        bar.id = BAR_ID;
        var lbl = document.createElement('span');
        lbl.textContent = 'Monitoring: ' + od.length + ' ' + bodWord(od.length) + ' po termínu přeměření';
        var go = document.createElement('button');
        go.className = 'ag-epr-go'; go.textContent = 'Otevřít';
        go.addEventListener('click', function () {
            bar.remove();
            try { if (typeof window.agOpenEpochy === 'function') window.agOpenEpochy(); } catch (e) {}
        });
        var later = document.createElement('button');
        later.className = 'ag-epr-later'; later.textContent = 'Později';
        later.setAttribute('aria-label', 'Připomenout zase zítra');
        later.addEventListener('click', function () {
            var r = loadR(); r.snoozeTs = Date.now(); saveR(r);
            bar.remove();
            toast('Dobře — připomenu zase zítra.');
        });
        bar.appendChild(lbl); bar.appendChild(go); bar.appendChild(later);
        document.body.appendChild(bar);
        setTimeout(function () { try { bar.remove(); } catch (e) {} }, 30000);
    }

    function tryNotify(od) {
        try {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            var r = loadR();
            if (r.lastNotifTs && sameDay(r.lastNotifTs, Date.now())) return;   // max 1× denně
            r.lastNotifTs = Date.now(); saveR(r);
            var names = [];
            for (var i = 0; i < od.length && i < 3; i++) names.push(od[i].name);
            var txt = od.length + ' ' + bodWord(od.length) + ' po termínu přeměření: ' + names.join(', ') + (od.length > 3 ? '…' : '');
            var opts = { body: txt, tag: 'ag-epochy-remind' };
            // v PWA (Android) funguje jen showNotification přes service worker
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
                navigator.serviceWorker.ready.then(function (reg) {
                    if (reg && typeof reg.showNotification === 'function') return reg.showNotification('AR Geodet — monitoring', opts);
                    throw new Error('no showNotification');
                })['catch'](function () {
                    try { new Notification('AR Geodet — monitoring', opts); } catch (e) {}
                });
            } else {
                new Notification('AR Geodet — monitoring', opts);
            }
        } catch (e) {}
    }

    function startupCheck() {
        pruneR();
        var od = overdueList();
        if (!od.length) return;
        var r = loadR();
        if (r.snoozeTs && sameDay(r.snoozeTs, Date.now())) return;   // „Později" platí do zítřka
        if (r.notif) tryNotify(od);
        showBar(od);
    }

    // po startu appky (tlačítko Start na welcome) — čekej na body.app-started
    var _started = false;
    // Misto pollu 2x/s cekame na udalost z grafika.js. Fallback na tridu je tu
    // proto, ze tenhle modul se muze nacist AZ PO startu appky (lazy-load) a
    // udalost by mu utekla. Zamerne bez zavislosti na jinem modulu - vrstva
    // zustava odpojitelna.
    function _onAppStarted(fn) {
        if (document.body && document.body.classList.contains('app-started')) { fn(); return; }
        window.addEventListener('ag:app-started', function () { fn(); }, { once: true });
    }
    _onAppStarted(function () {
        if (_started) return;
        _started = true;
        setTimeout(startupCheck, 1500);
    });

    // periodicky: badge na dlaždici + hlídání modalu (obojí levné, data s cache 30 s)
    (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
        try { watchModal(); updateBadges(); } catch (e) {}
    }, 4000);
})();
