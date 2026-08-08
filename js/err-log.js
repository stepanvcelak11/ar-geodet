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

    function load() { try { var v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* plná kvota - log není důvod shodit appku */ } }

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

    // Tlačítko do menu „Více" (vloží se za „O aplikaci", ať nerozbíjí layout indexu)
    function injectMenuBtn() {
        var scroll = document.querySelector('#side-menu .menu-scroll');
        if (!scroll || document.getElementById('errlog-menu-btn')) return;
        var btn = document.createElement('button');
        btn.className = 'menu-btn'; btn.id = 'errlog-menu-btn';
        btn.innerHTML = '<svg class="icon"><use href="#i-alert"/></svg> Protokol chyb';
        btn.addEventListener('click', function () { show(); if (typeof toggleMenu === 'function') toggleMenu(); });
        var anchor = scroll.querySelector('hr');
        if (anchor) scroll.insertBefore(btn, anchor); else scroll.appendChild(btn);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectMenuBtn);
    else injectMenuBtn();
})();
