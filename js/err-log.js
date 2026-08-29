// ===== AR Geodet - PROTOKOL CHYB (odpojitelné: smaž tento řádek v index.html + js/err-log.js) =====
// Globální zachytávač chyb: window 'error' + 'unhandledrejection'. Bez něj výjimka
// v kterémkoli z ~60 modulů tiše vyřadí funkci a v terénu se nedá zjistit proč.
// Chyby se ukládají do kruhového logu v localStorage (jede i offline, přežije reload
// a přibalí se do zálohy) a jednou za čas se ukáže nenápadný toast.
// Načítá se jako PRVNÍ modul, aby chytil i chyby při startu ostatních skriptů.

(function () {
    'use strict';

    var KEY = 'agErrorLog';
    var MAX = 40;              // kruhový buffer - nejstarší se zahazují
    var TOAST_MIN_GAP = 30000; // ms mezi toasty, ať chybová smyčka nespamuje
    var _lastToast = 0;
    var _lastSig = '';

    // VYKON: log se drzi v PAMETI a na disk se zapisuje nejvys jednou za 5 s.
    // Drive delal record() JSON.parse + JSON.stringify celeho klice pri KAZDE
    // chybe. Kdyz vyjimka vypadla z AR smycky (~60x/s), appka se zadrhla presne
    // ve chvili, kdy mela problem nahlasit - a zadrhnuti vyrabelo dalsi chyby.
    var FLUSH_MS = 5000;
    var _list = null, _dirty = false, _flushT = null;
    function load() {
        if (_list) return _list;
        try { var v = JSON.parse(localStorage.getItem(KEY)); _list = Array.isArray(v) ? v : []; }
        catch (e) { _list = []; }
        return _list;
    }
    function _writeNow() {
        if (_flushT) { clearTimeout(_flushT); _flushT = null; }
        if (!_dirty) return;
        _dirty = false;
        try { localStorage.setItem(KEY, JSON.stringify(_list || [])); } catch (e) { /* plná kvota - log není důvod shodit appku */ }
    }
    function save(list) {
        if (list && list !== _list) _list = list;
        _dirty = true;
        if (!_flushT) _flushT = setTimeout(_writeNow, FLUSH_MS);
    }
    // Co spadlo tesne pred odchodem se nesmi ztratit. 'pagehide' + skryta zalozka
    // jsou na mobilu spolehlivejsi nez 'beforeunload' (ten iOS casto vubec nepusti).
    window.addEventListener('pagehide', _writeNow);
    document.addEventListener('visibilitychange', function () { if (document.hidden) _writeNow(); });

    function record(msg, src, line, col, stack) {
        var sig = msg + '|' + src + '|' + line;
        var list = load();
        var last = list[list.length - 1];
        if (last && last.sig === sig) { last.n = (last.n || 1) + 1; last.t = Date.now(); save(list); return; }
        list.push({ t: Date.now(), msg: String(msg).slice(0, 300), src: String(src || '').slice(0, 120), line: line || 0, col: col || 0, stack: String(stack || '').slice(0, 500), sig: sig, n: 1 });
        if (list.length > MAX) list = list.slice(list.length - MAX);
        save(list);
        var now = Date.now();
        if (now - _lastToast > TOAST_MIN_GAP || sig !== _lastSig) {
            _lastToast = now; _lastSig = sig;
            // toast až po startu (quickToast je v logika.js, která se teprve načte)
            setTimeout(function () {
                try { if (typeof quickToast === 'function') quickToast('Něco se pokazilo (' + String(msg).slice(0, 60) + '). Detail: Více → Protokol chyb.'); } catch (e) {}
            }, 800);
        }
    }

    window.addEventListener('error', function (ev) {
        // chyba načtení zdroje (img/script) nemá message - zaznamenat stručně
        if (ev && ev.target && ev.target !== window && (ev.target.src || ev.target.href)) {
            record('Nepodařilo se načíst: ' + (ev.target.src || ev.target.href), '', 0, 0, '');
            return;
        }
        if (!ev) return;
        record(ev.message || 'Chyba', ev.filename, ev.lineno, ev.colno, ev.error && ev.error.stack);
    }, true);

    window.addEventListener('unhandledrejection', function (ev) {
        var r = ev && ev.reason;
        record('Promise: ' + (r && (r.message || r) || 'neznámá chyba'), '', 0, 0, r && r.stack);
    });

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function show() {
        var el = document.getElementById('errlog-modal');
        if (!el) {
            el = document.createElement('div');
            el.className = 'modal-overlay'; el.id = 'errlog-modal'; el.style.zIndex = '100005';
            el.innerHTML = '<div class="modal-content"><h3 style="color:var(--accent); margin-top:0;"><svg class="icon"><use href="#i-alert"/></svg> Protokol chyb</h3>'
                + '<div class="modal-body" id="errlog-list" style="font-size:calc(12px * var(--ag-font-scale, 1));"></div>'
                + '<div style="display:flex; gap:8px; margin-top:12px;">'
                + '<button class="btn btn-secondary" style="flex:1;" id="errlog-copy">Kopírovat</button>'
                + '<button class="btn btn-secondary" style="flex:1;" id="errlog-clear">Vymazat</button>'
                + '<button class="btn btn-secondary" style="flex:1;" onclick="document.getElementById(\'errlog-modal\').style.display=\'none\'">Zavřít</button>'
                + '</div></div>';
            document.body.appendChild(el);
            el.querySelector('#errlog-copy').addEventListener('click', function () {
                var txt = load().map(function (e) { return new Date(e.t).toLocaleString('cs-CZ') + (e.n > 1 ? ' (' + e.n + 'x)' : '') + '  ' + e.msg + (e.src ? '  [' + e.src + ':' + e.line + ']' : '') + (e.stack ? '\n' + e.stack : ''); }).join('\n\n');
                try { navigator.clipboard.writeText(txt); if (typeof quickToast === 'function') quickToast('Zkopírováno.'); } catch (e) {}
            });
            el.querySelector('#errlog-clear').addEventListener('click', function () { save([]); render(); });
        }
        render();
        el.style.display = 'flex';
    }

    function render() {
        var box = document.getElementById('errlog-list'); if (!box) return;
        var list = load().slice().reverse();
        if (!list.length) { box.innerHTML = '<p style="text-align:center; opacity:0.7;">Žádné zaznamenané chyby. To je dobře.</p>'; return; }
        box.innerHTML = list.map(function (e) {
            var when = new Date(e.t).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
            return '<div style="padding:8px 2px; border-bottom:1px solid var(--glass-border);">'
                + '<div style="opacity:0.6;">' + when + (e.n > 1 ? ' · ' + e.n + 'x' : '') + (e.src ? ' · ' + esc(e.src.split('/').pop()) + ':' + e.line : '') + '</div>'
                + '<div style="word-break:break-word;">' + esc(e.msg) + '</div>'
                + '</div>';
        }).join('');
    }

    window.agErrLog = { show: show, list: load, record: function (m) { record(m, 'manual', 0, 0, ''); } };

    // Protokol chyb BÝVAL položkou menu „Více". Přesunut do Nástrojů — v „Více" má
    // zůstat jen to, co je o aplikaci samotné. Skončí v sekci „Další nástroje", která
    // je ve seznamu úkonů výchozně sbalená, což diagnostice přesně odpovídá:
    // dostupná na dvě klepnutí, ale nestojí v cestě měřickým nástrojům.
    function injectMenuBtn() {
        var old = document.getElementById('errlog-menu-btn');   // úklid po starší verzi
        if (old && old.parentNode) old.parentNode.removeChild(old);
        if (typeof window.agRegisterFieldTool !== 'function') return;
        window.agRegisterFieldTool({
            id: 'err-log', label: 'Protokol chyb',
            icon: '<svg class="icon"><use href="#i-alert"/></svg>',
            cat: 'Pomůcky', order: 90, onClick: show
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectMenuBtn);
    else injectMenuBtn();
    // field-tools.js se může načíst po nás → zkusit registraci ještě po load
    window.addEventListener('load', function () { setTimeout(injectMenuBtn, 600); });
})();
