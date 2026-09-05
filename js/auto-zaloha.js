// ===== AR Geodet — POJISTKA DAT: připomínka zálohy + stav (ODPOJITELNÁ vrstva) ==
// Neinvazivní, ve stylu js/gps-warn.js: NEEDITUJE logika.js ani grafika.js. Řeší
// riziko TICHÉ ztráty terénních dat — zvlášť na iOS, kde se localStorage i IndexedDB
// po ~7 dnech nečinnosti mažou (a navigator.storage.persist() tam nezabírá).
//
// CO DĚLÁ:
//   1) Při startu si (best-effort) vyžádá trvalé úložiště (persist()) — na Androidu/
//      desktopu pomůže, na iOS je to neškodné no-op.
//   2) Obalí window.exportAllData() z js/zaloha.js, aby po ÚSPĚŠNÉ záloze schoval
//      pruh. Razítko času si NEPÍŠE — to je výhradně věc js/zaloha.js, který ho
//      napíše až ve chvíli, kdy je jisté, že soubor někde přistál.
//   3) Když má uživatel body a poslední záloha je starší než REMIND_DAYS, nikdy
//      nebyla, nebo od ní přibylo aspoň REMIND_PTS bodů,
//      ukáže nenápadný pruh „Data nezálohována X dní" s tlačítkem „Zálohovat teď"
//      (1 klik = exportAllData) a „Později" (odloží na 1 den). Objeví se i po návratu
//      do appky (visibilitychange), ne však dotěrně (snooze).
//   4) window.agBackupNow() — programové spuštění zálohy odkudkoli.
//
// Odstranění: smaž js/auto-zaloha.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    // ⚠ 29. 8. 2026 — JEDINÁ PŘIPOMÍNKA ZÁLOHY V CELÉ APPCE. Dřív byly tři (toast
    // v js/zaloha.js po 14 dnech, modál v js/vylepseni.js po 5 dnech a tenhle pruh
    // po 7) a každá si vedla VLASTNÍ razítko, takže odbytí jedné ostatní neumlčelo
    // a po startu naskákala na uživatele upozornění na totéž. Ostatní dvě jsou
    // zrušené; tady se čte razítko ze VŠECH TŘÍ historických klíčů (bere se to
    // nejnovější), aby appka po aktualizaci nehlásila „nezálohováno" někomu, kdo
    // zálohu udělal.
    var TS_KEYS = ['agLastBackupTs', 'arLastBackupAt', 'agLastBackup'];
    var SNOOZE_KEY = 'agBackupSnoozeTs';  // ms epoch, do kdy nepřipomínat
    // ⚠ 5. 9. 2026: ze 7 na 3 dny. Sedm dní byla přesně ta lhůta, po které iOS maže
    // úložiště nepoužívané PWA — připomínka tak dorazila až ve chvíli, kdy už mohla
    // být data pryč. Tři dny dají prostor zareagovat.
    var REMIND_DAYS = 3;                  // starší záloha než X dní = připomenout
    var PTS_KEY = 'agLastBackupPts';      // počet bodů při poslední záloze (píše js/zaloha.js)
    var PID_KEY = 'agLastBackupPid';      // zakázka, ke které se ten počet váže (píše js/zaloha.js)
    var REMIND_PTS = 10;                  // od zálohy přibylo X bodů = připomenout bez ohledu na čas
    var SNOOZE_MS = 24 * 3600 * 1000;     // „Později" = klid na 1 den
    // ⚠ 29. 8. 2026 (test balíčku pro Google Play): pruh naskakoval 2,5 s po startu,
    // takže první, co člověk po zapnutí appky viděl, bylo napomenutí. Připomínka
    // není nikdy naléhavá (jde o data starší REMIND_DAYS), tak počká, až bude appka
    // opravdu používaná — a nikdy neleze přes přihlášení ani bránu.
    var BOOT_QUIET_MS = 4 * 60 * 1000;    // prvních X minut po startu ticho
    var _bootTs = Date.now();
    var _bar = null, _wrapped = false;

    function now() { return Date.now(); }
    function getTs(k) { try { var v = parseInt(localStorage.getItem(k), 10); return isFinite(v) ? v : 0; } catch (e) { return 0; } }
    function setTs(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'auto-zaloha:setTs'); } }
    // nejnovější razítko napříč historickými klíči
    function lastBackup() {
        var best = 0;
        for (var i = 0; i < TS_KEYS.length; i++) { var v = getTs(TS_KEYS[i]); if (v > best) best = v; }
        return best;
    }
    // ⚠ Razítko se odsud UŽ NEPÍŠE. Jediný, kdo ho smí napsat, je js/zaloha.js — a to
    // až potom, co je jisté, že soubor někde přistál (sdílení dokončeno, nebo to
    // uživatel potvrdil). Dřív razítkovala tahle vrstva hned po zavolání exportu,
    // takže zrušený list sdílení nebo plný disk skončil hláškou „Záloha vytvořena ✓"
    // a sedmidenním tichem.

    // Kolik bodů má uživatel teď (aktivní zakázka) — proti stavu při poslední záloze.
    function pocetBodu() {
        try { if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) return persistentCustomPoints.length; }
        catch (e) { window.AG && AG.swallow && AG.swallow(e, 'auto-zaloha:pocetBodu'); }
        return 0;
    }

    function hasData() {
        try {
            if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints) && persistentCustomPoints.length) return true;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'auto-zaloha:hasData'); }
        // fallback: existuje víc než výchozí zakázka? (uživatel appku reálně používá)
        try { var l = JSON.parse(localStorage.getItem('arProjectsList')); if (Array.isArray(l) && l.length > 1) return true; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'auto-zaloha:hasData'); }
        return false;
    }

    function daysSince(ts) { return ts ? Math.floor((now() - ts) / 86400000) : null; }

    // --- spuštění zálohy (obalí zaloha.js) --------------------------------------
    window.agBackupNow = function () {
        if (typeof window.exportAllData !== 'function') {
            try { if (typeof window.agAlert === 'function') window.agAlert({ title: 'Záloha nedostupná', message: 'Modul zálohy (zaloha.js) není načtený.' }); else agInfo('Záloha není dostupná.'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'auto-zaloha:agBackupNow'); }
            return Promise.resolve(false);
        }
        var r;
        try { r = window.exportAllData(); } catch (e) { selhalo(e); return Promise.resolve(false); }
        return Promise.resolve(r).then(function (ok) {
            // „Hotovo" hlásíme jen tehdy, když to řekl zaloha.js. Když uživatel sdílení
            // zrušil nebo se soubor neuložil, pruh záměrně zůstane viset.
            if (!ok) return false;
            hideBar();
            try { if (typeof window.quickToast === 'function') window.quickToast('Záloha vytvořena ✓'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'auto-zaloha:agBackupNow'); }
            return true;
        }).catch(function (e) { selhalo(e); return false; });
    };

    // Spadlý export (velký JSON.stringify se všemi fotkami, plné úložiště) se dřív
    // spolkl a po kliknutí na „Zálohovat" se prostě nic nestalo. Ticho je tady to
    // nejhorší, co appka může udělat.
    function selhalo(e) {
        console.warn('[auto-zaloha] backup', e);
        var m = (e && e.message) ? String(e.message) : 'Zkus uvolnit místo v telefonu a opakovat.';
        try {
            if (typeof window.agAlert === 'function') window.agAlert({ title: 'Záloha se nezdařila', message: m });
            else agInfo('Záloha se nezdařila: ' + m);
        } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'auto-zaloha:selhalo'); }
    }

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
            'font-size:calc(13px * var(--ag-font-scale, 1))', 'line-height:1.25', 'pointer-events:auto'
        ].join(';');
        _bar.innerHTML =
            '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="flex:0 0 auto;color:#fbbf24">'
            + '<path d="M12 2 1 21h22L12 2z" fill="currentColor"></path>'
            + '<rect x="11" y="9" width="2" height="6" rx="1" fill="#1a1205"></rect>'
            + '<rect x="11" y="17" width="2" height="2" rx="1" fill="#1a1205"></rect></svg>'
            + '<span id="ag-backup-txt" style="flex:1 1 auto"></span>'
            + '<button id="ag-backup-now" type="button" style="flex:0 0 auto;border:0;background:#22c55e;color:#04120a;font-weight:700;font-size:calc(12px * var(--ag-font-scale, 1));padding:8px 11px;border-radius:10px;cursor:pointer">Zálohovat</button>'
            + '<button id="ag-backup-later" type="button" aria-label="Později" style="flex:0 0 auto;border:1px solid rgba(255,255,255,0.25);background:transparent;color:#cbd5e1;font-size:calc(12px * var(--ag-font-scale, 1));padding:8px 10px;border-radius:10px;cursor:pointer">Později</button>';
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
            if (Date.now() - _bootTs < BOOT_QUIET_MS) { hideBar(); return; }   // čerstvý start
            // přes přihlašovací obrazovku ani bránu se nic nepřekresluje
            if (document.getElementById('ag-login') || document.getElementById('ag-gate')) { hideBar(); return; }
            if (!hasData()) { hideBar(); return; }
            if (now() < getTs(SNOOZE_KEY)) { hideBar(); return; }   // odloženo
            var ts = lastBackup();
            var d = daysSince(ts);
            // Přírůstek dat je naléhavější než kalendář: dvacet bodů naměřených dneska
            // ráno je ztráta celého dne, i když je záloha „stará jen dva dny".
            // ⚠ CHYBĚJÍCÍ KLÍČ NENÍ NULA. `agLastBackupPts` píše výhradně js/zaloha.js
            // po potvrzené záloze, takže KAŽDÝ, kdo zálohoval před 5. 9. 2026, ho nemá —
            // getTs() by vrátil 0 a „přibylo" by vyšlo jako CELÝ počet bodů. Hned po
            // aktualizaci by tak appka každému s deseti body vyčítala nezálohovanou
            // práci, kterou dávno zálohovanou má. Dokud klíč nevznikne, jede se jen
            // podle kalendáře; první potvrzená záloha ho založí a kritérium se zapne.
            var _rawPts = null, _pidOk = false;
            try {
                _rawPts = localStorage.getItem(PTS_KEY);
                // Pocet se vaze ke KONKRETNI zakazce (zapsal ji js/zaloha.js). Nad jinou
                // zakazkou by se porovnavaly dve ruzne hromady bodu a "prirustek" by
                // vznikl pouhym prepnutim; tam se tedy jede jen podle kalendare.
                var _pid = localStorage.getItem(PID_KEY);
                _pidOk = (_pid == null) || (typeof activeProjectId === 'undefined') || (_pid === String(activeProjectId));
            } catch (e) { _rawPts = null; _pidOk = false; }
            var pribylo = (ts && _rawPts != null && _pidOk) ? (pocetBodu() - getTs(PTS_KEY)) : 0;
            var cerstva = (ts && d != null && d < REMIND_DAYS);
            if (cerstva && pribylo < REMIND_PTS) { hideBar(); return; }
            var txt;
            if (!ts) txt = 'Ještě sis nezálohoval body. Na iOS se data mohou po ~7 dnech smazat.';
            else if (cerstva) txt = 'Od poslední zálohy přibylo ' + pribylo + ' ' + pluralBod(pribylo) + '. Zálohu ulož do Souborů.';
            else txt = 'Data nezálohována ' + d + ' ' + plural(d) + '. Zálohu ulož do Souborů.';
            showBar(txt);
        } catch (e) { /* fail-silent */ }
    }

    function plural(n) { if (n === 1) return 'den'; if (n >= 2 && n <= 4) return 'dny'; return 'dní'; }
    function pluralBod(n) { if (n === 1) return 'bod'; if (n >= 2 && n <= 4) return 'body'; return 'bodů'; }

    // --- init -------------------------------------------------------------------
    function wrapExport() {
        if (_wrapped) return;
        if (typeof window.exportAllData !== 'function') return;
        var orig = window.exportAllData;
        window.exportAllData = function () {
            var r = orig.apply(this, arguments);
            // Razítko ani odklad se tady NEmění — o tom rozhoduje jen zaloha.js podle
            // toho, jestli soubor opravdu odešel. Tahle vrstva jen schová pruh, když
            // záloha dopadla. VRACÍME řetězenou Promise, ať se volající (agBackupNow,
            // tlačítko v Nastavení) dozví výsledek, a ne jen „něco se spustilo".
            return Promise.resolve(r).then(function (ok) { if (ok) hideBar(); return ok; })
                .catch(function (e) { selhalo(e); return false; });
        };
        // Značku „razítko si řídím sám" přebíráme na sebe — jinak by řetěz vypadal jako
        // neoznačený a příští vrstva by ho zase mohla obalit a razítkovat naslepo
        // (viz komentář u _agStamp v js/zaloha.js).
        try { window.exportAllData._agStamp = true; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'auto-zaloha:wrapExport'); }
        _wrapped = true;
    }

    function init() {
        // best-effort trvalé úložiště (na iOS neúčinné, ale neškodné)
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'auto-zaloha:init'); }
        wrapExport();
        // zaloha.js se načítá dřív (defer, výše v index.html), ale pro jistotu i s odkladem
        setTimeout(wrapExport, 500);
        setTimeout(maybeRemind, BOOT_QUIET_MS + 1000);   // až se appka rozjede, ne hned po startu
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(maybeRemind, 800); });
})();
