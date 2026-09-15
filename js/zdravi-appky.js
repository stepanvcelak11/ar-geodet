// ================================================================================
//  FUNGUJE MI VŠECHNO? — obrazovka zdraví appky (odpojitelné: smaž tento řádek
//  v index.html, tento soubor, záznam v sw.js a řádek 'zdravi-appky' v
//  js/tools-registry.js + data/navody.json)
//
//  Proč: na „nefunguje mi to" se dřív odpovídalo deseti otázkami (máš povolenou
//  GPS? točí se ti kompas? jakou máš verzi?). Tester si teď otevře jednu obrazovku
//  se zelenými/oranžovými/červenými řádky a jedním klepnutím ji pošle autorovi —
//  zpráva jde přes Napsat autorovi (js/zpetna-vazba.js), takže počká i na signál.
//  Schváleno 13. 9. 2026 (návrhy před betou).
//
//  Nic tu neměří nově: čísla se berou z toho, co appka už má (přesnost GPS a stáří
//  fixu, AGCompassDenied, cam-live, _agPersisted, protokol chyb, účet). Jediné
//  vlastní měření je kompas — dvě vteřiny se počítají události deviceorientation,
//  protože razítko poslední události žije v uzávěru grafika.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGZdravi) return;

    var ID = 'ag-zdravi-modal', STYLE_ID = 'ag-zdravi-style';
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'zdravi:' + kde); } catch (x) { } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function g(name) { try { return (0, eval)('typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined'); } catch (e) { return undefined; } }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + ID + ' .zd-row{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.08));}',
            '#' + ID + ' .zd-row:last-child{border-bottom:none;}',
            '#' + ID + ' .zd-dot{flex:0 0 12px;width:12px;height:12px;border-radius:50%;margin-top:5px;background:var(--text-muted,#9aa1ac);}',
            '#' + ID + ' .zd-row.ok .zd-dot{background:var(--accent,#2f9e74);}',
            '#' + ID + ' .zd-row.warn .zd-dot{background:var(--warning,#fbbf24);}',
            '#' + ID + ' .zd-row.bad .zd-dot{background:var(--danger,#fb7185);}',
            '#' + ID + ' .zd-tx{flex:1;min-width:0;}',
            '#' + ID + ' .zd-tx b{display:block;font-size:calc(14px * var(--ag-font-scale,1));}',
            '#' + ID + ' .zd-tx span{display:block;font-size:calc(12.5px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);line-height:1.4;word-break:break-word;}',
            '#' + ID + ' .zd-row.bad .zd-tx span{color:var(--text-color,#eceef2);}',
            '#' + ID + ' .zd-sum{margin:0 0 8px;padding:10px 12px;border-radius:10px;font-size:calc(13.5px * var(--ag-font-scale,1));line-height:1.45;}',
            '#' + ID + ' .zd-sum.ok{background:rgba(47,158,116,0.14);}',
            '#' + ID + ' .zd-sum.warn{background:rgba(251,191,36,0.14);}',
            '#' + ID + ' .zd-sum.bad{background:rgba(251,113,133,0.16);}',
            '#' + ID + ' .zd-btns{display:flex;gap:8px;margin-top:14px;}',
            '#' + ID + ' .zd-btns .btn{flex:1;margin:0;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- sběr údajů ---------------------------------------------------------------------
    function verze() {
        try {
            var l = document.querySelector('link[rel="stylesheet"][href*="css/style.css?v="]');
            var m = l && (l.getAttribute('href') || '').match(/\?v=(\d+)/);
            return m ? 'v' + m[1] : '?';
        } catch (e) { return '?'; }
    }
    function telefon() {
        var ua = String(navigator.userAgent || '');
        var m = /iPhone OS (\d+)_(\d+)/.exec(ua);
        if (m) return 'iPhone, iOS ' + m[1] + '.' + m[2];
        m = /Android ([\d.]+)/.exec(ua);
        if (m) return 'Android ' + m[1] + (/Chrome\/(\d+)/.test(ua) ? ', Chrome ' + /Chrome\/(\d+)/.exec(ua)[1] : '');
        return ua.slice(0, 60);
    }
    function stariFixu() {
        var fx = window.AGFix;
        if (!fx || !fx.ts) return null;
        return Math.round((Date.now() - fx.ts) / 1000);
    }
    function permission(name) {
        return new Promise(function (res) {
            try {
                if (!navigator.permissions || !navigator.permissions.query) return res(null);
                navigator.permissions.query({ name: name }).then(function (p) { res(p.state); }, function () { res(null); });
            } catch (e) { res(null); }
        });
    }
    function kompasUdalosti(ms) {
        return new Promise(function (res) {
            var n = 0, absN = 0;
            function h() { n++; }
            function ha() { absN++; }
            try {
                window.addEventListener('deviceorientation', h);
                window.addEventListener('deviceorientationabsolute', ha);
            } catch (e) { swallow(e, 'kompas:listen'); }
            setTimeout(function () {
                try { window.removeEventListener('deviceorientation', h); window.removeEventListener('deviceorientationabsolute', ha); } catch (e) { swallow(e, 'kompas:off'); }
                res({ n: n, abs: absN, s: ms / 1000 });
            }, ms);
        });
    }
    function uloziste() {
        return new Promise(function (res) {
            try {
                if (!navigator.storage || !navigator.storage.estimate) return res(null);
                navigator.storage.estimate().then(function (e) { res({ usage: e.usage || 0, quota: e.quota || 0 }); }, function () { res(null); });
            } catch (e) { res(null); }
        });
    }
    function mb(b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB'; }

    function sesbirat() {
        var rows = [];
        return Promise.all([permission('geolocation'), kompasUdalosti(2000), uloziste(), permission('camera')]).then(function (r) {
            var geoPerm = r[0], kom = r[1], sto = r[2], camPerm = r[3];

            // 1) verze a spojení
            var sw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
            rows.push({ k: 'verze', st: sw ? 'ok' : 'warn', b: t('Verze appky') + ' ' + verze(),
                s: (navigator.onLine === false ? t('offline') : t('online')) + ' · ' + (sw ? t('offline vrstva připravena') : t('offline vrstva ještě není nainstalovaná — po prvním startu s internetem se doinstaluje')) + ' · ' + telefon() });

            // 2) GPS
            var acc = g('currentGpsAccuracy'), lat = g('userLat');
            var fixS = stariFixu();
            var gSt = 'bad', gTx;
            if (geoPerm === 'denied') gTx = t('Poloha je zakázaná — povol ji telefonu v nastavení prohlížeče / systému.');
            else if (!lat) { gSt = geoPerm === 'prompt' ? 'warn' : 'bad'; gTx = geoPerm === 'prompt' ? t('Appka se na polohu ještě nezeptala (dovolení přijde po startu).') : t('Zatím žádná poloha — vyjdi pod volné nebe a chvíli počkej.'); }
            else if (fixS != null && fixS > 15) { gSt = 'warn'; gTx = t('Poslední poloha je stará ' + fixS + ' s') + (acc ? ' · ±' + Number(acc).toFixed(1) + ' m' : ''); }
            else if (acc && acc > 20) { gSt = 'warn'; gTx = t('Slabý fix') + ' ±' + Number(acc).toFixed(0) + ' m · ' + t('zkus volné nebe'); }
            else { gSt = 'ok'; gTx = (acc ? '±' + Number(acc).toFixed(1) + ' m' : t('fix bez udané přesnosti')) + (fixS != null ? ' · ' + t('před ' + fixS + ' s') : ''); }
            rows.push({ k: 'gps', st: gSt, b: 'GPS', s: gTx });

            // 3) kompas
            var kSt, kTx, needPerm = !!(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function');
            if (window.AGCompassDenied) { kSt = 'bad'; kTx = t('Pohyb a orientace nejsou povolené — appka bez nich neukáže směr. Zavři a otevři appku a při dotazu povol.'); }
            else if (kom.n + kom.abs === 0) { kSt = needPerm ? 'warn' : 'bad'; kTx = needPerm ? t('Za 2 s nepřišla žádná událost — na iPhonu se kompas probudí až po prvním dotyku na obrazovku.') : t('Za 2 s nepřišla žádná událost — telefon kompas nehlásí (chybí senzor, nebo prohlížeč nemá povolený pohyb).'); }
            else { kSt = 'ok'; kTx = Math.round((kom.n + kom.abs) / kom.s) + ' ' + t('událostí/s') + (kom.abs ? ' · ' + t('absolutní sever') : ' · ' + t('jen relativní — sever si appka dopočítá')); }
            rows.push({ k: 'kompas', st: kSt, b: t('Kompas'), s: kTx });

            // 4) kamera
            var cam = document.body.classList.contains('cam-live');
            var cSt = cam ? 'ok' : (camPerm === 'denied' ? 'bad' : 'warn');
            var cTx = cam ? t('AR běží (obraz z kamery je živý)') : (camPerm === 'denied' ? t('Kamera je zakázaná — AR nepůjde; povol ji v nastavení prohlížeče.') : t('AR teď neběží (režim Mapa) — to je v pořádku, když jsi ho sám vypnul.'));
            rows.push({ k: 'kamera', st: cSt, b: t('Kamera / AR'), s: cTx });

            // 5) úložiště
            var pers = window._agPersisted;
            var uSt = pers === false ? 'warn' : 'ok';
            var uTx = (pers === true ? t('trvalé — data se nesmažou samy') : pers === false ? t('NE trvalé — prohlížeč smí data při nedostatku místa smazat (iOS i po ~7 dnech nečinnosti); dělej zálohy') : t('trvalost neznámá'))
                + (sto && sto.quota ? ' · ' + t(mb(sto.usage) + ' z ' + mb(sto.quota)) : '');
            if (sto && sto.quota && sto.usage / sto.quota > 0.85) uSt = 'bad';
            rows.push({ k: 'uloziste', st: uSt, b: t('Úložiště'), s: uTx });

            // 6) účet
            var U = window.AGUcty, cu = null, fm = null, cloud = false;
            try { cu = U && U.currentUser && U.currentUser(); fm = U && U.getFirm && U.getFirm(); cloud = !!(U && U.isCloud && U.isCloud()); } catch (e) { swallow(e, 'ucet'); }
            var pro = false; try { pro = !!(window.AGLic && AGLic.isPro && AGLic.isPro()); } catch (e) { swallow(e, 'lic'); }   // bylo AGLic.jePro — takové API není, řádek Účet hlásil Základ i s Pro (15. 9. 2026)
            rows.push({ k: 'ucet', st: cu ? 'ok' : 'warn', b: t('Účet'),
                s: cu ? (cu.name || '?') + (fm && fm.firmName ? ' · ' + fm.firmName : '') + ' · ' + (cloud ? t('firemní server') : t('jen v telefonu')) + ' · ' + (pro ? 'Pro' : t('Základ')) : t('nepřihlášen') });

            // 7) chyby
            var errs = [];
            try { errs = (window.agErrLog && agErrLog.list && agErrLog.list()) || []; } catch (e) { swallow(e, 'errlog'); }
            var posl = errs.slice(-3).reverse();
            var pocet = 0; try { pocet = errs.reduce(function (a, e) { return a + (e.n || 1); }, 0); } catch (e) { pocet = errs.length; }
            rows.push({ k: 'chyby', st: posl.length ? (pocet > 10 ? 'bad' : 'warn') : 'ok', b: t('Chyby appky'),
                s: posl.length ? (t(pocet + ' záznamů; poslední') + ': ' + posl.map(function (e) { return String(e.msg || e.sig || '?').slice(0, 70); }).join(' | ')) : t('protokol chyb je prázdný') });

            return rows;
        });
    }

    // ---- okno --------------------------------------------------------------------------
    var _rows = null;
    function build() {
        var m = document.getElementById(ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = ID; m.setAttribute('data-ag-needs', 'gps kompas'); /* js/power-save.js: senzory neuspávat, dokud je okno vidět */
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h2 style="margin-top:0;"><span style="display:inline-block;width:22px;height:22px;vertical-align:-4px;color:var(--accent);">' + ICON + '</span> ' + t('Funguje mi všechno?') + '</h2>' +
            '  <div class="modal-body" id="ag-zdravi-body"></div>' +
            '  <div class="zd-btns">' +
            '    <button type="button" class="btn btn-secondary" id="ag-zdravi-again">' + t('Změřit znovu') + '</button>' +
            '    <button type="button" class="btn" id="ag-zdravi-send">' + t('Poslat autorovi') + '</button>' +
            '  </div>' +
            '  <button type="button" class="btn btn-secondary" id="ag-zdravi-close" style="margin-top:10px;">' + t('Zavřít') + '</button>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-zdravi-close').addEventListener('click', close);
        m.querySelector('#ag-zdravi-again').addEventListener('click', function () { render(); });
        m.querySelector('#ag-zdravi-send').addEventListener('click', poslat);
        return m;
    }
    function render() {
        var body = document.getElementById('ag-zdravi-body');
        if (!body) return;
        body.innerHTML = '<p style="color:var(--text-muted,#9aa1ac);">' + t('Měřím… (2 s kvůli kompasu)') + '</p>';
        _rows = null;
        sesbirat().then(function (rows) {
            _rows = rows;
            var bad = rows.filter(function (r) { return r.st === 'bad'; }).length;
            var warn = rows.filter(function (r) { return r.st === 'warn'; }).length;
            var sum = bad ? { c: 'bad', t: t('Něco tu nefunguje — červené řádky pošli autorovi, opraví se to rychleji.') }
                : warn ? { c: 'warn', t: t('Základ jede. Oranžové řádky nejsou chyba, jen stojí za pohled.') }
                    : { c: 'ok', t: t('Všechno jede. Kdyby se přesto něco dělo, pošli tenhle přehled autorovi.') };
            body.innerHTML = '<div class="zd-sum ' + sum.c + '">' + esc(sum.t) + '</div>' + rows.map(function (r) {
                return '<div class="zd-row ' + r.st + '" data-k="' + esc(r.k) + '"><span class="zd-dot"></span><div class="zd-tx"><b>' + esc(r.b) + '</b><span>' + esc(r.s) + '</span></div></div>';
            }).join('');
        }).catch(function (e) { swallow(e, 'render'); body.innerHTML = '<p>' + t('Měření se nepovedlo.') + '</p>'; });
    }
    function textZpravy() {
        var Z = { ok: '✓', warn: '!', bad: '✗' };
        return t('Funguje mi všechno?') + ' — ' + new Date().toLocaleString('cs-CZ') + '\n' +
            (_rows || []).map(function (r) { return Z[r.st] + ' ' + r.b + ': ' + r.s; }).join('\n');
    }
    function poslat() {
        if (!_rows) return;
        var txt = textZpravy();
        close();
        if (typeof window.agOpenZpetnaVazba === 'function') window.agOpenZpetnaVazba({ kind: 'chyba', txt: txt });
        else if (window.AGLazy && typeof AGLazy.need === 'function') AGLazy.need('js/zpetna-vazba.js', function () { try { window.agOpenZpetnaVazba({ kind: 'chyba', txt: txt }); } catch (e) { swallow(e, 'poslat'); } });
    }
    function open() {
        var m = build();
        m.style.display = 'flex';
        render();
    }
    function close() {
        var m = document.getElementById(ID);
        if (m) m.style.display = 'none';
    }

    // ---- napojení ----------------------------------------------------------------------
    function injectSettings() {
        var tab = document.getElementById('tab-udrzba');
        if (!tab || document.getElementById('ag-zdravi-set-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'ag-zdravi-set-btn'; btn.type = 'button'; btn.className = 'btn btn-secondary';
        btn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;vertical-align:-3px;">' + ICON + '</span> ' + t('Funguje mi všechno? — kontrola telefonu');
        btn.addEventListener('click', function () {
            var mm = document.getElementById('settings-modal');
            if (mm) mm.style.display = 'none';
            open();
        });
        var after = document.getElementById('ag-fb-set-btn') || document.getElementById('hist-set-btn');
        if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
        else tab.appendChild(btn);
    }
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'zdravi-appky', label: t('Funguje mi všechno?'), icon: ICON, cat: 'Pomůcky', onClick: open, order: 95 });
        }
        injectSettings();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
    (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () { try { injectSettings(); } catch (e) { swallow(e, 'tick'); } }, 4000);

    window.AGZdravi = { open: open, close: close, sesbirat: sesbirat, text: textZpravy };
})();
