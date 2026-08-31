// ===== AR Geodet — POKRAČOVAT, KDE JSEM SKONČIL (ODPOJITELNÁ) =====
// Denní rutina: otevřít appku → vybrat zakázku → Nástroje → najít dlaždici.
// Tenhle modul si pamatuje POSLEDNÍ použitý nástroj (klepnutí na dlaždici v modálu
// Nástroje) včetně zakázky a hned po startu nabídne „Pokračovat: <nástroj>" —
// jeden ťuk přepne zakázku a otevře nástroj.
//
// ⚠ 31. 8. 2026: nabídka bývala TLAČÍTKEM NA ÚVODNÍ OBRAZOVCE. Ta je zrušená
// (jediný vchod je přihlášení), takže by modul ztratil jediný vchod. Přesunut do
// CENTRA UPOZORNĚNÍ (window.AGNotify, js/upozorneni.js): sbalí se do téže pilulky
// nahoře jako ostatní hlášky, má akci „Otevřít" a jde odklepnout křížkem — místo
// další samostatné plovoucí lišty, kterých už appka měla dost.
//
// Doplňuje (neduplikuje) draft-store.js: draft bar řeší ROZDĚLANÝ STAV uvnitř
// vícekrokových úloh po startu, tohle řeší CESTU k nástroji před startem.
// Záznam max 48 h starý; nic jiného se neukládá (jen localStorage, offline).
// NEEDITUJE logika.js/grafika.js — jen volá existující globály
// (changeProject, startAppFromWelcome) a klapi na dlaždici.
// Odstranění: smaž js/pokracovat.js + řádek <script> v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agPkInit) return;
    window.__agPkInit = true;

    var KEY = 'agLastTool_v1';
    var MAX_AGE_MS = 48 * 3600 * 1000;

    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function loadRec() {
        var raw; try { raw = localStorage.getItem(KEY); } catch (e) { return null; }
        if (!raw) return null;
        var r; try { r = JSON.parse(raw); } catch (e) { return null; }
        if (!r || !r.key || !r.ts || (Date.now() - r.ts) > MAX_AGE_MS) return null;
        return r;
    }
    function saveRec(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pokracovat:saveRec'); } }

    function getGrid() { var m = document.getElementById('tools-modal'); return m ? m.querySelector('.tool-grid') : null; }
    function tileKey(tile) {
        var dt = tile.getAttribute('data-tool');
        if (dt) return dt;
        var oc = tile.getAttribute('onclick') || '';
        var ms = oc.match(/([A-Za-z_$][\w$]*)\s*\(/g);
        return ms ? ms[ms.length - 1].replace(/\s*\($/, '') : null;
    }
    function tileLabel(tile) {
        var s = tile.querySelector('span');
        var d = document.createElement('div');
        d.innerHTML = ((s ? s.innerHTML : '') || '').replace(/<br\s*\/?>/gi, ' ');
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function findTile(key) {
        var grid = getGrid(); if (!grid) return null;
        var tiles = grid.querySelectorAll('.tool-tile');
        for (var i = 0; i < tiles.length; i++) { if (tileKey(tiles[i]) === key) return tiles[i]; }
        return null;
    }
    // ⚠ Dřív se četlo z #w-project-select na úvodní obrazovce. Ta je od 31. 8. 2026
    // zrušená, takže se bere TÝŽ seznam zakázek z Nastavení → Zakázky.
    function projName(id) {
        var sel = document.getElementById('s-project-select');
        if (sel) for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === id) return sel.options[i].text; }
        return null;
    }
    function relAge(ts) {
        var min = Math.round((Date.now() - ts) / 60000);
        if (min < 2) return 'právě teď';
        if (min < 60) return 'před ' + min + ' min';
        var h = Math.round(min / 60);
        if (h < 24) return 'před ' + h + ' h';
        return 'včera';
    }

    // ---- záznam posledního nástroje (klepnutí na dlaždici v Nástrojích) --------------
    document.addEventListener('click', function (e) {
        if (document.body.classList.contains('ag-tp-edit')) return;   // režim úprav oblíbených
        var tile = e.target.closest ? e.target.closest('#tools-modal .tool-tile') : null;
        if (!tile || e.target.closest('.ag-tp-star') || e.target.closest('.ag-tp-help')) return;
        var key = tileKey(tile); if (!key) return;
        saveRec({ pid: pid(), key: key, label: tileLabel(tile) || key, ts: Date.now() });
    });

    // ---- nabídka ------------------------------------------------------------------
    // Nabídka žije v centru upozornění. Ukazuje se JEN v prvních PK_WINDOW_MS po
    // startu appky: „pokračovat, kde jsem skončil" je ranní úkon — po půl hodině
    // práce už je to jen řádek navíc v hlášeních. Jakmile uživatel klepne na
    // Otevřít nebo hlášku odklepne, znovu se v tomhle běhu neozve.
    var PK_WINDOW_MS = 4 * 60 * 1000;
    var _startedTs = 0, _dismissed = false, _done = false;

    function started() { return !!(document.body && document.body.classList.contains('app-started')); }

    function refreshBtn() {
        if (!window.AGNotify || !AGNotify.set) return;
        if (!started()) { _startedTs = 0; return; }
        if (!_startedTs) _startedTs = Date.now();
        if (_dismissed || _done || (Date.now() - _startedTs) > PK_WINDOW_MS) { AGNotify.clear('pokracovat'); return; }
        var rec = loadRec();
        if (!rec) { AGNotify.clear('pokracovat'); return; }
        var pn = (rec.pid !== pid()) ? projName(rec.pid) : null;
        if (rec.pid !== pid() && !pn) { AGNotify.clear('pokracovat'); return; }   // zakázka už neexistuje
        AGNotify.set('pokracovat', {
            level: 'info', order: 40,
            text: 'Naposledy jsi měl otevřené: ' + rec.label
                + ' (' + (pn ? 'zakázka ' + pn + ' · ' : '') + relAge(rec.ts) + ')',
            action: 'Otevřít',
            onAction: function () { _done = true; AGNotify.clear('pokracovat'); resume(); },
            onDismiss: function () { _dismissed = true; }
        });
    }

    // ---- obnovení: zakázka → start → nástroj -------------------------------------------
    function resume() {
        var rec = loadRec(); if (!rec) return;
        try {
            if (rec.pid !== pid() && projName(rec.pid) != null) {
                var sel = document.getElementById('s-project-select');
                if (sel) {
                    sel.value = rec.pid;
                    if (typeof window.changeProjectFromSettings === 'function') changeProjectFromSettings();
                    else if (typeof window.changeProject === 'function') changeProject();
                }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pokracovat:resume'); }
        function go() {
            // appka uz zpravidla bezi (nabidka se ukazuje az po startu); spousteni
            // zustava jen jako pojistka, kdyby resume() zavolal nekdo driv
            try { if (!started() && typeof window.startAppFromWelcome === 'function') startAppFromWelcome(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pokracovat:go'); }
            var waited = 0;
            var t = setInterval(function () {
                waited += 500;
                var started = document.body && document.body.classList.contains('app-started');
                if (started) {
                    clearInterval(t);
                    setTimeout(function () {
                        var tile = findTile(rec.key);
                        if (tile) tile.click();   // dlaždice sama zavře modál a otevře nástroj
                        else if (typeof window.quickToast === 'function') { try { quickToast('Nástroj „' + rec.label + '" se nepodařilo najít.'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pokracovat:go'); } }
                    }, 900);
                } else if (waited >= 20000) clearInterval(t);
            }, 500);
        }
        // Stejná zakázka → start HNED (synchronně): iOS pak bere requestPermission
        // kompasu/kamery jako součást ťuknutí. setTimeout by gesto zahodil a oprávnění
        // by spadlo („requires a user gesture"). Jen při přepnutí zakázky dáme odstup.
        if (rec.pid !== pid()) setTimeout(go, 700);
        else go();
    }

    // ---- údržba ---------------------------------------------------------------------------
    function init() {
        try { refreshBtn(); } catch (e) { console.warn('[pokracovat] init', e); }
        if (!window.__agPkTimer) window.__agPkTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(function () {
            try { refreshBtn(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pokracovat:init'); }
        }, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });
})();
