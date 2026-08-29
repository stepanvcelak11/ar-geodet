// ===== AR Geodet — DRAFT STORE: rozdělaná práce přežije zabití appky (ODPOJITELNÁ) =====
// iOS Safari běžně zabije PWA při přepnutí na foťák/telefonát. Vícekrokové úlohy
// (parcela, protínání, rajón, rozepsaný Nový bod…) držely stav jen v proměnných
// a v celé appce nebyl jediný beforeunload → reálná denní ztráta práce v terénu.
//
// API (pro nástroje):
//   AGDraft.save(key, state, label)  — ulož rozpracovaný stav (debounce 400 ms; label do nabídky)
//   AGDraft.load(key)                — {state, ts, label} | null (jen aktivní zakázka, max stáří 24 h)
//   AGDraft.clear(key)               — po dokončení/uložení úlohy
//   AGDraft.register(key, {label, open})
//        — jak úlohu znovu otevřít; po startu appky se pro NEJNOVĚJŠÍ draft ukáže
//          lišta „Rozdělaná práce … Pokračovat / Zahodit“; open(state) obnoví nástroj
//
// Drafty jsou per zakázka (klíč agDraft::<pid>::<key> v localStorage), zápisy se
// flushují i na pagehide/skrytí stránky. Modul sám obsluhuje rozepsaný modál
// „Nový bod“ (pole + obnova při otevření); úklid po uložení dělá logika.js.
// Odstranění: smaž js/draft-store.js + řádek <script> v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agDraftInit) return;
    window.__agDraftInit = true;

    var TTL_MS = 24 * 3600 * 1000, DEB_MS = 400;
    var _pending = {}, _timers = {}, _openers = {};

    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function skey(key) { return 'agDraft::' + pid() + '::' + key; }

    function _flushKey(key) {
        if (!(key in _pending)) return;
        var rec = _pending[key]; delete _pending[key];
        clearTimeout(_timers[key]); delete _timers[key];
        try { localStorage.setItem(skey(key), JSON.stringify(rec)); } catch (e) {}
    }
    function flushAll() { Object.keys(_pending).forEach(_flushKey); }

    function save(key, state, label) {
        _pending[key] = { state: state, label: label || key, ts: Date.now() };
        clearTimeout(_timers[key]);
        _timers[key] = setTimeout(function () { _flushKey(key); }, DEB_MS);
    }
    function load(key) {
        if (_pending[key]) return _pending[key];
        var raw; try { raw = localStorage.getItem(skey(key)); } catch (e) { return null; }
        if (!raw) return null;
        var rec; try { rec = JSON.parse(raw); } catch (e) { return null; }
        if (!rec || !rec.ts || (Date.now() - rec.ts) > TTL_MS) { clear(key); return null; }
        return rec;
    }
    function clear(key) {
        delete _pending[key]; clearTimeout(_timers[key]); delete _timers[key];
        try { localStorage.removeItem(skey(key)); } catch (e) {}
    }
    function register(key, cfg) { if (cfg && typeof cfg.open === 'function') _openers[key] = cfg; }

    window.AGDraft = { save: save, load: load, clear: clear, register: register, flush: flushAll };

    window.addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', function () { if (document.hidden) flushAll(); });

    // ---- úklid prošlých draftů (jen aktivní zakázka se řeší, prošlé globálně) -----
    try {
        for (var i = localStorage.length - 1; i >= 0; i--) {
            var k = localStorage.key(i);
            if (k && k.indexOf('agDraft::') === 0) {
                try { var r = JSON.parse(localStorage.getItem(k)); if (!r || !r.ts || Date.now() - r.ts > TTL_MS) localStorage.removeItem(k); } catch (e) { localStorage.removeItem(k); }
            }
        }
    } catch (e) {}

    // ---- lišta „Pokračovat v rozdělané práci“ po startu ---------------------------
    var BAR_ID = 'ag-draft-bar';
    function showResumeBar() {
        var newest = null, newestKey = null;
        Object.keys(_openers).forEach(function (key) {
            var rec = load(key);
            if (rec && (!newest || rec.ts > newest.ts)) { newest = rec; newestKey = key; }
        });
        if (!newest) return;
        var bar = document.createElement('div');
        bar.id = BAR_ID;
        bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 84px);z-index:15000;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:14px;background:var(--glass-bg,rgba(24,28,33,0.94));border:1px solid var(--glass-border,rgba(255,255,255,0.14));color:var(--text-color,#eceef2);font:500 13px/1.35 var(--font-ui,system-ui),sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.5);max-width:92vw;';
        var age = Math.round((Date.now() - newest.ts) / 60000);
        var lbl = document.createElement('span');
        lbl.textContent = 'Rozdělaná práce: ' + (newest.label || newestKey) + (age > 0 ? ' (' + (age < 60 ? age + ' min' : Math.round(age / 60) + ' h') + ' zpět)' : '');
        var go = document.createElement('button');
        go.textContent = 'Pokračovat';
        go.style.cssText = 'border:none;border-radius:9px;padding:8px 13px;font:700 13px/1 var(--font-ui,system-ui),sans-serif;background:var(--accent,#2f9e74);color:#04110b;cursor:pointer;';
        var drop = document.createElement('button');
        drop.textContent = 'Zahodit';
        drop.setAttribute('aria-label', 'Zahodit rozdělanou práci');
        drop.style.cssText = 'border:none;background:none;color:var(--text-muted,#9aa1ac);font:500 13px/1 var(--font-ui,system-ui),sans-serif;text-decoration:underline;cursor:pointer;padding:8px 4px;';
        go.addEventListener('click', function () {
            bar.remove();
            var rec = load(newestKey);
            if (rec) { try { _openers[newestKey].open(rec.state); } catch (e) {} }
        });
        drop.addEventListener('click', function () { clear(newestKey); bar.remove(); });
        bar.appendChild(lbl); bar.appendChild(go); bar.appendChild(drop);
        document.body.appendChild(bar);
        setTimeout(function () { try { bar.remove(); } catch (e) {} }, 30000);
    }
    // po startu appky (tlačítko Start na welcome) — čekej na body.app-started
    var _resumeShown = false;
    // Misto pollu 2x/s cekame na udalost z grafika.js. Fallback na tridu je tu
    // proto, ze tenhle modul se muze nacist AZ PO startu appky (lazy-load) a
    // udalost by mu utekla. Zamerne bez zavislosti na jinem modulu - vrstva
    // zustava odpojitelna.
    function _onAppStarted(fn) {
        if (document.body && document.body.classList.contains('app-started')) { fn(); return; }
        window.addEventListener('ag:app-started', function () { fn(); }, { once: true });
    }
    _onAppStarted(function () {
        if (_resumeShown) return;
        _resumeShown = true;
        setTimeout(showResumeBar, 1200);
    });

    // ---- rozepsaný modál „Nový bod“ (jádrová pole v index.html) -------------------
    var NP_KEY = 'novy-bod';
    var NP_FIELDS = ['custom-name', 'custom-y', 'custom-x', 'custom-z', 'custom-kod', 'custom-note'];
    function npCollect() {
        var st = {}, any = false;
        NP_FIELDS.forEach(function (id) {
            var el = document.getElementById(id); var v = el ? el.value : ''; st[id] = v;
            // cislo bodu predvyplnene automaticky ze serie NENI rozdelana prace — jinak
            // by kazde otevreni formulare zalozilo draft „Novy bod 102“, na ktery nikdo nesahl
            if (el && el.dataset && el.dataset.agAutofill === '1') return;
            if (v && String(v).trim()) any = true;
        });
        return any ? st : null;
    }
    function npRestore(st) {
        if (!st) return;
        NP_FIELDS.forEach(function (id) { var el = document.getElementById(id); if (el && st[id] != null && !el.value) el.value = st[id]; });
    }
    // editace EXISTUJÍCÍHO bodu se nedraftuje (obnova by přepsala jiný bod);
    // editingCustomPointId je top-level let (není na window) → poznáme ji z titulku
    function npIsEditing() {
        var t = document.getElementById('custom-modal-title');
        return !!(t && /upravit/i.test(t.innerText || ''));
    }
    document.addEventListener('input', function (e) {
        if (!e.target || NP_FIELDS.indexOf(e.target.id) < 0) return;
        var ov = document.getElementById('custom-modal-overlay');
        if (!ov || ov.style.display !== 'flex') return;
        if (npIsEditing()) return;
        var st = npCollect();
        if (st) save(NP_KEY, st, 'Nový bod „' + (st['custom-name'] || 'bez názvu') + '“');
        else clear(NP_KEY);
    }, true);
    // obnova při otevření modálu (jen do prázdných polí — nic nepřepisuje)
    (function () {
        var ov = document.getElementById('custom-modal-overlay');
        function wire() {
            ov = ov || document.getElementById('custom-modal-overlay');
            if (!ov) return;
            var was = ov.style.display === 'flex';
            new MutationObserver(function () {
                var open = ov.style.display === 'flex';
                if (open && !was) {
                    var rec = load(NP_KEY);
                    if (rec && !npIsEditing()) {
                        npRestore(rec.state);
                        if (typeof window.quickToast === 'function') { try { quickToast('Obnoven rozepsaný bod.'); } catch (e) {} }
                    }
                }
                was = open;
            }).observe(ov, { attributes: true, attributeFilter: ['style'] });
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
        else wire();
    })();
    register(NP_KEY, {
        label: 'Nový bod',
        open: function (st) {
            if (typeof window.openNewPointModal === 'function') { try { openNewPointModal(); } catch (e) {} }
            setTimeout(function () { npRestore(st); }, 120);
        }
    });
})();
