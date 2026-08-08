// ===== AR Geodet — POJISTKA DAT: připomínka zálohy + stav (ODPOJITELNÁ vrstva) ==
// Neinvazivní, ve stylu js/gps-warn.js: NEEDITUJE logika.js ani grafika.js. Řeší
// riziko TICHÉ ztráty terénních dat — zvlášť na iOS, kde se localStorage i IndexedDB
// po ~7 dnech nečinnosti mažou (a navigator.storage.persist() tam nezabírá).
//
// CO DĚLÁ:
//   1) Při startu si (best-effort) vyžádá trvalé úložiště (persist()) — na Androidu/
//      desktopu pomůže, na iOS je to neškodné no-op.
//   2) Obalí window.exportAllData() z js/zaloha.js a po každé záloze si uloží čas
//      (klíč 'agLastBackupTs' — globální, ne per zakázka; záloha je celého stavu).
//   3) Když má uživatel body a poslední záloha je starší než REMIND_DAYS (nebo nikdy),
//      ukáže nenápadný pruh „Data nezálohována X dní" s tlačítkem „Zálohovat teď"
//      (1 klik = exportAllData) a „Později" (odloží na 1 den). Objeví se i po návratu
//      do appky (visibilitychange), ne však dotěrně (snooze).
//   4) window.agBackupNow() — programové spuštění zálohy odkudkoli.
//
// Odstranění: smaž js/auto-zaloha.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var TS_KEY = 'agLastBackupTs';       // ms epoch poslední zálohy (localStorage, globální)
    var SNOOZE_KEY = 'agBackupSnoozeTs';  // ms epoch, do kdy nepřipomínat
    var REMIND_DAYS = 7;                  // starší záloha než X dní = připomenout
    var SNOOZE_MS = 24 * 3600 * 1000;     // „Později" = klid na 1 den
    var _bar = null, _wrapped = false;

    function now() { return Date.now(); }
    function getTs(k) { try { var v = parseInt(localStorage.getItem(k), 10); return isFinite(v) ? v : 0; } catch (e) { return 0; } }
    function setTs(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }

    function hasData() {
        try {
            if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints) && persistentCustomPoints.length) return true;
        } catch (e) {}
        // fallback: existuje víc než výchozí zakázka? (uživatel appku reálně používá)
        try { var l = JSON.parse(localStorage.getItem('arProjectsList')); if (Array.isArray(l) && l.length > 1) return true; } catch (e) {}
        return false;
    }

    function daysSince(ts) { return ts ? Math.floor((now() - ts) / 86400000) : null; }

    // --- spuštění zálohy (obalí zaloha.js) --------------------------------------
    window.agBackupNow = function () {
        if (typeof window.exportAllData !== 'function') {
            try { if (typeof window.agAlert === 'function') window.agAlert({ title: 'Záloha nedostupná', message: 'Modul zálohy (zaloha.js) není načtený.' }); else agInfo('Záloha není dostupná.'); } catch (e) {}
            return Promise.resolve(false);
        }
        var r;
        try { r = window.exportAllData(); } catch (e) { console.warn('[auto-zaloha] backup', e); return Promise.resolve(false); }
        return Promise.resolve(r).then(function () {
            setTs(TS_KEY, now());
            try { localStorage.removeItem(SNOOZE_KEY); } catch (e) {}
            hideBar();
            try { if (typeof window.quickToast === 'function') window.quickToast('Záloha vytvořena ✓'); } catch (e) {}
            return true;
        }).catch(function () { return false; });
    };

    // --- nenápadný pruh připomínky ----------------------------------------------
    function ensureBar() {
        if (_bar && document.body.contains(_bar)) return _bar;
        if (!document.body) return null;
        _bar = document.createElement('div');
        _bar.id = 'ag-backup-bar';
        _bar.setAttribute('role', 'status');
        _bar.style.cssText = [
            'position:fixed', 'left:50%', 'transform:translateX(-50%)',
            'bottom:calc(env(safe-area-inset-bottom,0px) + 84px)',
            'z-index:8000', 'max-width:min(94vw,460px)', 'box-sizing:border-box',
            'display:none', 'align-items:center', 'gap:10px',
            'padding:10px 12px', 'border-radius:14px',
            'background:rgba(20,22,28,0.96)', 'color:#fff',
            'border:1px solid rgba(255,255,255,0.14)',
            'box-shadow:0 8px 26px rgba(0,0,0,0.45)',
            'font-size:13px', 'line-height:1.25', 'pointer-events:auto'
        ].join(';');
        _bar.innerHTML =
            '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="flex:0 0 auto;color:#fbbf24">'
            + '<path d="M12 2 1 21h22L12 2z" fill="currentColor"></path>'
            + '<rect x="11" y="9" width="2" height="6" rx="1" fill="#1a1205"></rect>'
            + '<rect x="11" y="17" width="2" height="2" rx="1" fill="#1a1205"></rect></svg>'
            + '<span id="ag-backup-txt" style="flex:1 1 auto"></span>'
            + '<button id="ag-backup-now" type="button" style="flex:0 0 auto;border:0;background:#22c55e;color:#04120a;font-weight:700;font-size:12px;padding:8px 11px;border-radius:10px;cursor:pointer">Zálohovat</button>'
            + '<button id="ag-backup-later" type="button" aria-label="Později" style="flex:0 0 auto;border:1px solid rgba(255,255,255,0.25);background:transparent;color:#cbd5e1;font-size:12px;padding:8px 10px;border-radius:10px;cursor:pointer">Později</button>';
        document.body.appendChild(_bar);
        _bar.querySelector('#ag-backup-now').addEventListener('click', function () { window.agBackupNow(); });
        _bar.querySelector('#ag-backup-later').addEventListener('click', function () { setTs(SNOOZE_KEY, now() + SNOOZE_MS); hideBar(); });
        return _bar;
    }

    function showBar(txt) {
        var b = ensureBar(); if (!b) return;
        var t = b.querySelector('#ag-backup-txt'); if (t) t.textContent = txt;
        b.style.display = 'flex';
    }
    function hideBar() { if (_bar) _bar.style.display = 'none'; }

    function maybeRemind() {
        try {
            if (!hasData()) { hideBar(); return; }
            if (now() < getTs(SNOOZE_KEY)) { hideBar(); return; }   // odloženo
            var ts = getTs(TS_KEY);
            var d = daysSince(ts);
            if (ts && d != null && d < REMIND_DAYS) { hideBar(); return; }  // čerstvá záloha
            var txt = ts
                ? ('Data nezálohována ' + d + ' ' + plural(d) + '. Zálohu ulož do Souborů.')
                : 'Ještě sis nezálohoval body. Na iOS se data mohou po ~7 dnech smazat.';
            showBar(txt);
        } catch (e) { /* fail-silent */ }
    }

    function plural(n) { if (n === 1) return 'den'; if (n >= 2 && n <= 4) return 'dny'; return 'dní'; }

    // --- init -------------------------------------------------------------------
    function wrapExport() {
        if (_wrapped) return;
        if (typeof window.exportAllData !== 'function') return;
        var orig = window.exportAllData;
        window.exportAllData = function () {
            var r = orig.apply(this, arguments);
            Promise.resolve(r).then(function () { setTs(TS_KEY, now()); try { localStorage.removeItem(SNOOZE_KEY); } catch (e) {} hideBar(); }).catch(function () {});
            return r;
        };
        _wrapped = true;
    }

    function init() {
        // best-effort trvalé úložiště (na iOS neúčinné, ale neškodné)
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
        wrapExport();
        // zaloha.js se načítá dřív (defer, výše v index.html), ale pro jistotu i s odkladem
        setTimeout(wrapExport, 500);
        setTimeout(maybeRemind, 2500);   // po ustálení startu, ať nepřekáží onboardingu
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(maybeRemind, 800); });
})();
