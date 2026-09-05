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
                try { if (typeof quickToast === 'function') quickToast('Něco se pokazilo (' + String(msg).slice(0, 60) + '). Detail: Více → Protokol chyb.'); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'err-log:record'); }
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

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    // ---- ODESÍLÁNÍ VLASTNÍKOVI --------------------------------------------------
    // Do 30. 8. 2026 zůstal protokol chyb jen v tom telefonu, kde chyba spadla —
    // o pádech u lidí v terénu se vlastník aplikace nedozvěděl nic a čekal, až mu
    // někdo napíše. Odsud chodí na server jen to, co je k opravě potřeba:
    //   hláška, soubor, řádek, kolikrát se to opakovalo, verze appky, druh telefonu.
    // ⚠ NECHODÍ ODSUD: souřadnice, jména bodů ani zakázek, zásobník volání (může
    //   nést cesty a hodnoty), nic z měření. Platí totéž pravidlo jako u „Nahlásit".
    //
    // ⚠ ODESÍLÁNÍ NESMÍ SAMO DĚLAT PROBLÉM. Proto: nejvýš jednou za 10 minut,
    //   nejvýš 20 záznamů v dávce, jen když je člověk přihlášený do cloudové firmy
    //   a jen když je síť. Chybová smyčka (60 výjimek za sekundu z AR smyčky) tak
    //   nemůže ani zaplnit denní limit serveru, ani vybít baterii vysíláním.
    var SEND_GAP = 600000;         // 10 min mezi dávkami
    var SEND_KEY = 'agErrSent_v1'; // razítko posledního odeslaného záznamu
    var _sendT = 0;

    function sentTs() { try { return parseInt(localStorage.getItem(SEND_KEY) || '0', 10) || 0; } catch (e) { return 0; } }
    function setSentTs(v) { try { localStorage.setItem(SEND_KEY, String(v)); } catch (e) { } }

    function druhTelefonu() {
        try {
            var u = navigator.userAgent || '';
            if (/iPhone|iPad|iPod/.test(u)) return 'iOS';
            if (/Android/.test(u)) return 'Android';
            if (/Windows/.test(u)) return 'Windows';
            if (/Mac/.test(u)) return 'Mac';
        } catch (e) { }
        return '?';
    }

    function odeslat() {
        try {
            if (navigator.onLine === false) return;
            var now = Date.now();
            if (now - _sendT < SEND_GAP) return;
            var U = window.AGUcty;
            // Bez cloudové firmy není kam ani za koho posílat (a lokální firma
            // server vůbec nemá). Ticho je tady správná odpověď, ne chyba.
            if (!U || !U.isCloud || !U.isCloud() || !U.currentUser || !U.currentUser()) return;
            var od = sentTs();
            var nove = load().filter(function (e) { return (e.t || 0) > od; });
            if (!nove.length) return;
            _sendT = now;
            var davka = nove.slice(-20);
            var maxT = 0;
            var items = davka.map(function (e) {
                if ((e.t || 0) > maxT) maxT = e.t || 0;
                return { t: e.t, sig: e.sig, msg: e.msg, src: e.src, line: e.line, n: e.n || 1 };
            });
            U.cloudFetch('/errors', {
                method: 'POST',
                body: { ver: verzeAppky(), dev: druhTelefonu(), items: items }
            }).then(function (r) {
                // Razítko se posouvá JEN při úspěchu — jinak by se chyby z terénu
                // (kde se dotaz nezdaří nejčastěji) tiše zahodily a nikdy nedošly.
                if (r && r.ok) setSentTs(maxT || now);
            }).catch(function () { });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'err-log:odeslat'); }
    }

    // Zkusit v klidu po startu a pak jednou za deset minut. Ne hned při chybě:
    // ve chvíli pádu má appka jiné starosti a další požadavek do sítě jí nepomůže.
    setTimeout(odeslat, 20000);
    (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(odeslat, SEND_GAP);
    window.addEventListener('online', function () { setTimeout(odeslat, 4000); });

    // ---- HLÁŠENÍ Z TERÉNU ------------------------------------------------------
    // Chyby se sbíraly, ale nikdo se k nim nedostal: „Kopírovat" dalo holý výpis
    // hlášek bez jediného údaje o tom, CO za appku a NA ČEM zrovna běželo. Z věty
    // „appka mi spadla" se pak nedalo vyjít. Tohle sbalí protokol i s okolnostmi
    // do jednoho textu, který jde poslat (navigator.share) nebo zkopírovat.
    //
    // CO SE DO HLÁŠENÍ NEDÁVÁ, ZÁMĚRNĚ: souřadnice (ani vlastní polohy, ani bodů),
    // jména zakázek a bodů, přihlašovací údaje. Diagnostice stačí PŘESNOST fixu
    // a POČTY — a hlášení může skončit v cizí schránce nebo chatu.
    function verzeAppky() {
        try {
            var l = document.querySelector('link[rel="stylesheet"][href*="css/style.css?v="]');
            var m = l && /[?&]v=(\d+)/.exec(l.getAttribute('href') || '');
            if (m) return 'v' + m[1];
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'err-log:verzeAppky'); }
        return 'neznámá';
    }

    function okolnosti() {
        var r = [];
        function pridej(k, v) { if (v !== null && v !== undefined && v !== '') r.push(k + ': ' + v); }
        try {
            pridej('Verze appky', verzeAppky());
            pridej('Čas', new Date().toLocaleString('cs-CZ'));
            pridej('Zařízení', navigator.userAgent);
            pridej('Displej', innerWidth + '×' + innerHeight + ' @' + (devicePixelRatio || 1) + 'x');
            pridej('Síť', navigator.onLine ? 'online' : 'OFFLINE');
            if (navigator.deviceMemory) pridej('Paměť', navigator.deviceMemory + ' GB');
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'err-log:okolnosti'); }
        // Stav měření — jen čísla, nic, co by ukazovalo KDE to bylo.
        try {
            if (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy)
                pridej('Přesnost GPS', '±' + Math.round(currentGpsAccuracy * 10) / 10 + ' m');
            else pridej('Přesnost GPS', 'bez fixu');
            if (typeof arPoints !== 'undefined' && arPoints) pridej('Bodů v zobrazení', arPoints.length);
            if (typeof persistentCustomPoints !== 'undefined' && persistentCustomPoints)
                pridej('Vlastních bodů', persistentCustomPoints.length);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'err-log:okolnosti'); }
        // Které moduly se vůbec načetly — chybějící modul je sám o sobě nález.
        try {
            var chybi = [];
            [['GeoCore', 'geo-core'], ['AGStatusBar', 'stavový pruh'], ['AGDraft', 'rozdělaná práce'],
             ['AGKartaBodu', 'karta bodu'], ['agRegisterFieldTool', 'nástroje']].forEach(function (p) {
                if (typeof window[p[0]] === 'undefined') chybi.push(p[1]);
            });
            pridej('Nenačtené moduly', chybi.length ? chybi.join(', ') : 'žádné');
            var lazy = document.querySelectorAll('script[data-ag-lazy]').length;
            if (lazy) pridej('Dotažených modulů', lazy);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'err-log:okolnosti'); }
        return r.join('\n');
    }

    function hlaseni() {
        var list = load();
        var chyby = list.length
            ? list.map(function (e) {
                return new Date(e.t).toLocaleString('cs-CZ') + (e.n > 1 ? ' (' + e.n + 'x)' : '') + '  ' + e.msg
                    + (e.src ? '  [' + String(e.src).split('/').pop() + ':' + e.line + ']' : '')
                    + (e.stack ? '\n' + e.stack : '');
            }).join('\n\n')
            : '(žádné zaznamenané chyby)';
        return 'AR Geodet — hlášení z terénu\n'
            + '================================\n' + okolnosti()
            + '\n\nCO SE DĚLO (doplň prosím vlastními slovy):\n\n\n'
            + 'PROTOKOL CHYB (' + list.length + ')\n================================\n' + chyby + '\n';
    }

    // ---- POSLAT AUTOROVI (js/zpetna-vazba.js) ----------------------------------
    // ⚠ PROČ TOHLE VZNIKLO: „Poslat hlášení" dosud jen otevřelo systémové sdílení
    // nebo hodilo text do schránky — tedy odsud vedla cesta k autorovi jen přes
    // e‑mail, který si člověk musel složit sám. Chyby, které nikdo nenahlásí, jsou
    // přesně ty, co appku sráží; tohle je nejlevnější způsob, jak se o nich dozvědět.
    //
    // ⚠ ZPRÁVA MÁ STROP 4000 ZNAKŮ (server i klient), takže se posílá ZKRÁCENÝ výpis:
    // okolnosti + posledních pár chyb. Celý protokol zůstává pod „Kopírovat".
    var PRO_ZPRAVU = 2500;
    function proZpravu() {
        var list = load().slice(-6).reverse();
        var chyby = list.length
            ? list.map(function (e) {
                return new Date(e.t).toLocaleString('cs-CZ') + (e.n > 1 ? ' (' + e.n + 'x)' : '') + '  ' + e.msg
                    + (e.src ? '  [' + String(e.src).split('/').pop() + ':' + e.line + ']' : '');
            }).join('\n')
            : '(zadne zaznamenane chyby)';
        var txt = '--- PROTOKOL CHYB (' + load().length + ', posledni ' + list.length + ') ---\n'
            + chyby + '\n\n--- OKOLNOSTI ---\n' + okolnosti();
        return txt.length > PRO_ZPRAVU ? txt.slice(0, PRO_ZPRAVU) + '\n… (zkraceno)' : txt;
    }
    function autorovi() {
        try {
            if (window.AGZpetna && typeof AGZpetna.open === 'function') {
                var el = document.getElementById('errlog-modal');
                if (el) el.style.display = 'none';
                AGZpetna.open({ kind: 'chyba', txt: proZpravu() });
                return;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'err-log:autorovi'); }
        poslat();   // vrstva zpětné vazby je odpojená — zbývá sdílení / schránka
    }

    function poslat() {
        var txt = hlaseni();
        // Web Share s textem umí i iOS; když ne, spadne to na schránku.
        try {
            if (navigator.share) {
                navigator.share({ title: 'AR Geodet — hlášení z terénu', text: txt })
                    .catch(function (e) { if (!e || e.name !== 'AbortError') doSchranky(txt); });
                return;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'err-log:poslat'); }
        doSchranky(txt);
    }

    function doSchranky(txt) {
        function hotovo() { if (typeof quickToast === 'function') quickToast('Hlášení zkopírováno — vlož ho do zprávy.'); }
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(txt).then(hotovo, function () { stahnout(txt); });
                return;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'err-log:doSchranky'); }
        stahnout(txt);
    }

    function stahnout(txt) {
        try {
            var a = document.createElement('a');
            a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(txt);
            a.download = 'ar-geodet-hlaseni-' + new Date().toISOString().slice(0, 10) + '.txt';
            document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'err-log:stahnout'); }
    }

    function show() {
        var el = document.getElementById('errlog-modal');
        if (!el) {
            el = document.createElement('div');
            el.className = 'modal-overlay'; el.id = 'errlog-modal'; el.style.zIndex = '100005';
            el.innerHTML = '<div class="modal-content"><h3 style="color:var(--accent); margin-top:0;"><svg class="icon"><use href="#i-alert"/></svg> Protokol chyb</h3>'
                + '<div class="modal-body" id="errlog-list" style="font-size:calc(12px * var(--ag-font-scale, 1));"></div>'
                + '<button class="btn btn-primary" style="width:100%; margin-top:12px;" id="errlog-autor">Poslat autorovi appky</button>'
                + '<p style="margin:6px 2px 0; opacity:0.65; font-size:calc(11px * var(--ag-font-scale, 1));">Přibalí verzi appky, typ telefonu, stav sítě a GPS a nenačtené moduly. Souřadnice, jména zakázek ani bodů se neposílají. Bez signálu zpráva počká a odejde sama.</p>'
                + '<div style="display:flex; gap:8px; margin-top:10px;">'
                + '<button class="btn btn-secondary" style="flex:1;" id="errlog-send">Sdílet</button>'
                + '<button class="btn btn-secondary" style="flex:1;" id="errlog-copy">Kopírovat</button>'
                + '<button class="btn btn-secondary" style="flex:1;" id="errlog-clear">Vymazat</button>'
                + '<button class="btn btn-secondary" style="flex:1;" onclick="document.getElementById(\'errlog-modal\').style.display=\'none\'">Zavřít</button>'
                + '</div></div>';
            document.body.appendChild(el);
            el.querySelector('#errlog-autor').addEventListener('click', autorovi);
            el.querySelector('#errlog-send').addEventListener('click', poslat);
            el.querySelector('#errlog-copy').addEventListener('click', function () {
                doSchranky(hlaseni());
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

    window.agErrLog = {
        show: show, list: load, report: hlaseni,
        send: odeslat,
        record: function (m) { record(m, 'manual', 0, 0, ''); }
    };

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
