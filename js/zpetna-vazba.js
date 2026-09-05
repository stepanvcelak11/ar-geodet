// ===== AR Geodet — NAPIŠTE MI: schránka na zpětnou vazbu (odpojitelná vrstva) ====
// Místo, kam může KDOKOLI, kdo appku otevřel, napsat autorovi: co nefunguje, co
// chybí, co ho štve. Zprávy jdou do firemního cloudu (cloud/worker.js, routa
// POST /feedback) a čte je jen vlastník appky.
//
// ⚠ POSÍLÁ SE BEZ PŘIHLÁŠENÍ. Kdo se ještě nepřihlásil — host, člověk, co appku
//   právě dostal odkazem — má k psaní nejvíc důvodů, takže by bylo hloupé po něm
//   nejdřív chtít účet. Server proto tuhle jedinou zapisující routu pouští bez
//   tokenu a brzdí ji jen počítadlem na IP (20 zpráv za den).
//
// ⚠ ČTENÍ NEMÁ S FIRMAMI NIC SPOLEČNÉHO. Do schránky chodí zprávy od cizích lidí,
//   takže ji firemní admini vidět NESMÍ — ani ten, kdo je adminem své firmy.
//   Server ji vydá jen proti tajemství OWNER_KEY (hlavička X-Owner-Key), které
//   se do telefonu zadá jednou a uloží. Bez klíče je tlačítko „schránka" jen
//   nefunkční odkaz — o tom, kdo dovnitř smí, rozhoduje server, ne skrytí v UI.
//
// ⚠ OFFLINE SE ZPRÁVA NEZTRATÍ. V terénu je bez signálu půl dne — nenapsat nic
//   nebo přijít o napsané je ta nejhorší varianta. Zpráva se proto vždycky napřed
//   uloží do fronty v telefonu a odesílá se z ní: hned, při návratu signálu a při
//   dalším startu appky. Uživatel se tak nikdy nemusí vracet a psát to znovu.
//
// Vstupy: „Více" → Napište mi; Nastavení → Údržba → Aplikace; hledání v appce.
//
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + './js/zpetna-vazba.js'
// v sw.js. Routy /feedback ve workeru pak jen zůstanou nepoužité.
// ================================================================================
(function () {
    'use strict';
    if (window.AGZpetna) return;

    var LS_Q = 'agFbQ_v1';        // fronta neodeslaných zpráv
    var LS_KEY = 'agFbKey_v1';    // tajemství schránky (jen u vlastníka)
    var LS_DRAFT = 'agFbDraft_v1';// rozepsaná zpráva (přežije zavření okna)
    var STYLE_ID = 'ag-fb-style';
    var MAX = 4000;               // shodné s ořezem na serveru
    var Q_MAX = 30;               // víc než tolik čekajících zpráv nedrží smysl

    // Poslední záchrana, kdyby byla vrstva účtů odpojená. Musí sedět s DEFAULT_API
    // v js/ucty.js — jinak by zprávy odcházely někam jinam než všechno ostatní.
    var API_FALLBACK = 'https://ar-geodet-api.ar-geodet.workers.dev';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 11.5a8 8 0 0 1-8 8H7l-4 3v-5.4A8 8 0 1 1 21 11.5z"/><path d="M8 10h8M8 14h5"/></svg>';

    var KINDS = [
        { k: 'chyba', l: 'Chyba' },
        { k: 'napad', l: 'Nápad' },
        { k: 'pochvala', l: 'Pochvala' },
        { k: 'jine', l: 'Jiné' }
    ];

    var _sending = false, _inbox = null, _inboxState = { stav: 'open', rows: [], konec: false };

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'zpetna-vazba:' + kde); } catch (x) { } }
    function esc(s) {
        if (window.AG && AG.esc) return AG.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function info(m, t) { try { if (typeof window.agInfo === 'function') return window.agInfo(m, t); } catch (e) { swallow(e, 'info'); } }
    function ask(m) {
        try { if (typeof window.agAsk === 'function') return window.agAsk(m); } catch (e) { swallow(e, 'ask'); }
        return Promise.resolve(window.confirm(m));
    }
    // Text, který si modul skládá sám, projde slovníkem js/jazyky.js — jinak by
    // hlášky zůstaly česky i po přepnutí jazyka (DOM je přeložený, tohle ne).
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }

    function lsGet(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { swallow(e, 'lsSet'); } }

    // ---- cloud -----------------------------------------------------------------
    function base() {
        try {
            var u = window.AGUcty;
            if (u && typeof u.apiUrl === 'function') return u.apiUrl();
            if (u && u.DEFAULT_API) return u.DEFAULT_API;
        } catch (e) { swallow(e, 'base'); }
        return API_FALLBACK;
    }
    // Vlastní fetch (ne AGUcty.cloudFetch), protože čtení schránky potřebuje
    // hlavičku X-Owner-Key, kterou cloudFetch neumí předat. Timeout je stejný
    // důvod jako tam: na „mrtvém, ale otevřeném" spoji visí dotaz jinak minuty
    // a drží rádio ve vysokém příkonu.
    function api(path, opts) {
        opts = opts || {};
        var h = { 'Content-Type': 'application/json' };
        if (opts.ownerKey) h['X-Owner-Key'] = opts.ownerKey;
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var to = null;
        var p;
        try {
            p = fetch(base() + path, {
                method: opts.method || 'GET',
                headers: h,
                body: opts.body != null ? JSON.stringify(opts.body) : undefined,
                signal: ctrl ? ctrl.signal : undefined
            });
            if (ctrl) to = setTimeout(function () { try { ctrl.abort(); } catch (e) { swallow(e, 'abort'); } }, opts.timeoutMs || 12000);
        } catch (e) {
            if (to) clearTimeout(to);
            return Promise.resolve({ ok: false, status: 0, data: null });
        }
        return p.then(function (r) {
            if (to) { clearTimeout(to); to = null; }
            return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
        }).catch(function () {
            if (to) clearTimeout(to);
            return { ok: false, status: 0, data: null };
        });
    }

    // ---- údaje o zařízení ------------------------------------------------------
    // Dobrovolná příloha. Bez ní se chyba typu „na mém telefonu se to rozsype"
    // nedá dohledat; s ní je vidět verze appky i prohlížeč. Nic z toho člověka
    // neidentifikuje a checkbox jde odškrtnout.
    function meta() {
        var o = {};
        try {
            var l = document.querySelector('link[rel="stylesheet"][href*="css/style.css?v="]');
            var m = l && (l.getAttribute('href') || '').match(/\?v=(\d+)/);
            if (m) o.v = parseInt(m[1], 10);
        } catch (e) { swallow(e, 'meta:v'); }
        try {
            o.ua = String(navigator.userAgent || '').slice(0, 300);
            o.jaz = String(navigator.language || '');
            o.appJaz = window.AGJazyk ? AGJazyk.get() : 'cs';
            o.px = (screen.width || 0) + 'x' + (screen.height || 0) + '@' + (window.devicePixelRatio || 1);
            o.pwa = !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || !!navigator.standalone;
        } catch (e) { swallow(e, 'meta'); }
        return o;
    }
    function who() {
        try {
            var u = window.AGUcty, c = u && u.currentUser && u.currentUser();
            var f = u && u.getFirm && u.getFirm();
            if (!c) return null;
            return (c.name || '') + (f && f.firmName ? ' · ' + f.firmName : '');
        } catch (e) { return null; }
    }

    // ---- fronta ----------------------------------------------------------------
    function queue() { var q = lsGet(LS_Q, []); return Array.isArray(q) ? q : []; }
    function enqueue(rec) {
        var q = queue();
        q.push(rec);
        while (q.length > Q_MAX) q.shift();
        lsSet(LS_Q, q);
        renderQueueNote();
    }
    // Odesílá frontu POSTUPNĚ a při prvním neúspěchu KONČÍ. Kdyby se pokračovalo,
    // při vypnutém serveru by každý start appky vystřelil celou frontu do prázdna.
    function flush() {
        var q = queue();
        if (!q.length) return Promise.resolve(0);
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(0);
        var sent = 0;
        function step() {
            var cur = queue();
            if (!cur.length) return Promise.resolve(sent);
            return api('/feedback', { method: 'POST', body: cur[0] }).then(function (r) {
                // Z fronty se zahazuje JEN to, co opakováním nikdy neprojde: 400 =
                // server obsah odmítl (prázdná zpráva), 413 = je moc velká.
                // ⚠ 404/405 se zahodit NESMÍ. Přesně tohle vrátí worker, který ještě
                //   nemá nasazenou routu /feedback — a to je stav, ve kterém zprávu
                //   MÁME podržet, ne tiše vyhodit. Stejně tak 429 („zkus to zítra")
                //   a všechna 5xx: to jsou dočasné stavy.
                if (r.ok || r.status === 400 || r.status === 413) {
                    var rest = queue(); rest.shift(); lsSet(LS_Q, rest);
                    if (r.ok) sent++;
                    return step();
                }
                return sent;
            });
        }
        return step().then(function (n) { renderQueueNote(); return n; });
    }

    // ---- okno „Napište mi" -----------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-fb-modal .modal-content{display:flex;flex-direction:column;}',
            '#ag-fb-modal .modal-body{display:flex;flex-direction:column;min-height:0;overflow-y:auto;}',
            '.ag-fb-kinds{display:flex;gap:7px;flex-wrap:wrap;margin:2px 0 12px;}',
            '.ag-fb-kinds button{border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:var(--glass-bg,rgba(255,255,255,0.04));',
            '  color:var(--text-muted,#9aa1ac);border-radius:999px;padding:8px 14px;font:600 13px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '.ag-fb-kinds button.act{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.14));color:var(--accent,#2f9e74);}',
            '#ag-fb-txt{width:100%;min-height:140px;resize:vertical;}',
            '.ag-fb-cnt{text-align:right;font:500 11px/1 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:4px 0 12px;}',
            '.ag-fb-cnt.over{color:#e0574a;}',
            '.ag-fb-chk{display:flex;align-items:flex-start;gap:9px;margin:10px 0;cursor:pointer;}',
            '.ag-fb-chk input{margin-top:2px;flex:none;}',
            '.ag-fb-chk small{display:block;color:var(--text-muted,#9aa1ac);font:500 11.5px/1.4 var(--font-ui,system-ui);}',
            '.ag-fb-note{margin:12px 0 0;padding:10px 12px;border-radius:11px;border:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));font:500 12px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.ag-fb-note.on{border-color:rgba(212,160,44,0.42);background:rgba(212,160,44,0.1);color:#d4a02c;}',
            '.ag-fb-owner{margin-top:16px;text-align:center;}',
            '.ag-fb-owner button{background:none;border:none;color:var(--text-muted,#9aa1ac);text-decoration:underline;',
            '  font:500 11.5px/1.4 var(--font-ui,system-ui);cursor:pointer;padding:6px;}',
            // schránka
            '.ag-fb-filter{display:flex;gap:7px;margin:0 0 12px;flex-wrap:wrap;}',
            '.ag-fb-msg{border:1px solid var(--glass-border,rgba(255,255,255,0.12));border-radius:12px;padding:11px 13px;margin:0 0 9px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '.ag-fb-msg.done{opacity:.55;}',
            '.ag-fb-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;',
            '  font:600 11px/1 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);letter-spacing:.04em;text-transform:uppercase;}',
            '.ag-fb-tag{padding:3px 8px;border-radius:999px;border:1px solid currentColor;}',
            '.ag-fb-tag.chyba{color:#e0574a;}.ag-fb-tag.napad{color:#d4a02c;}.ag-fb-tag.pochvala{color:var(--accent,#2f9e74);}',
            '.ag-fb-t{white-space:pre-wrap;word-break:break-word;font:500 14px/1.5 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '.ag-fb-meta{margin-top:7px;font:500 11px/1.4 var(--font-mono,monospace);color:var(--text-muted,#9aa1ac);word-break:break-all;}',
            '.ag-fb-acts{display:flex;gap:7px;margin-top:9px;flex-wrap:wrap;}',
            '.ag-fb-acts button{border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:transparent;color:var(--text-muted,#9aa1ac);',
            '  border-radius:9px;padding:6px 11px;font:600 11.5px/1 var(--font-ui,system-ui);cursor:pointer;}'
        ].join('');
        document.head.appendChild(st);
    }

    function build() {
        var m = document.getElementById('ag-fb-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'ag-fb-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h2 style="margin-top:0;"><span style="display:inline-block;width:22px;height:22px;vertical-align:-4px;color:var(--accent);">' + ICON + '</span> Napište mi</h2>' +
            '  <div class="modal-body">' +
            '    <p style="margin:0 0 14px;color:var(--text-muted,#9aa1ac);font:500 13px/1.5 var(--font-ui,system-ui);">' +
            '      Co vám nesedí, co chybí, co byste změnili? Čte to autor appky — a podle toho, co sem přijde, se appka mění.</p>' +
            '    <label>Čeho se to týká</label>' +
            '    <div class="ag-fb-kinds" id="ag-fb-kinds"></div>' +
            '    <label for="ag-fb-txt">Vaše zpráva</label>' +
            '    <textarea id="ag-fb-txt" maxlength="' + MAX + '" placeholder="Co se stalo, kde, a co jste čekali, že se stane…"></textarea>' +
            '    <div class="ag-fb-cnt" id="ag-fb-cnt"></div>' +
            '    <label for="ag-fb-contact">Kontakt (e-mail) — nepovinné</label>' +
            '    <input type="email" id="ag-fb-contact" maxlength="120" autocomplete="email" placeholder="jen když chcete odpověď">' +
            '    <label class="ag-fb-chk"><input type="checkbox" id="ag-fb-meta" checked>' +
            '      <span>Přiložit údaje o zařízení<small>verze appky, telefon, prohlížeč — pomůže při hledání chyby</small></span></label>' +
            '    <div class="ag-fb-note" id="ag-fb-note"></div>' +
            '    <button type="button" class="btn" id="ag-fb-send" style="margin-top:16px;">Odeslat</button>' +
            '    <div class="ag-fb-owner"><button type="button" id="ag-fb-owner-btn">Jsem vlastník — otevřít schránku</button></div>' +
            '    <button type="button" class="btn btn-secondary" id="ag-fb-close" style="margin-top:18px;">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);

        var kinds = m.querySelector('#ag-fb-kinds');
        KINDS.forEach(function (k, i) {
            var b = document.createElement('button');
            b.type = 'button'; b.dataset.k = k.k; b.textContent = k.l;
            if (i === 0) b.className = 'act';
            b.addEventListener('click', function () {
                Array.prototype.forEach.call(kinds.children, function (c) { c.className = ''; });
                b.className = 'act';
                saveDraft();
            });
            kinds.appendChild(b);
        });

        var txt = m.querySelector('#ag-fb-txt');
        txt.addEventListener('input', function () { count(); saveDraft(); });
        m.querySelector('#ag-fb-contact').addEventListener('input', saveDraft);
        m.querySelector('#ag-fb-meta').addEventListener('change', saveDraft);
        m.querySelector('#ag-fb-send').addEventListener('click', send);
        m.querySelector('#ag-fb-close').addEventListener('click', close);
        m.querySelector('#ag-fb-owner-btn').addEventListener('click', openInbox);
        return m;
    }

    function count() {
        var m = document.getElementById('ag-fb-modal'); if (!m) return;
        var n = (m.querySelector('#ag-fb-txt').value || '').length;
        var c = m.querySelector('#ag-fb-cnt');
        c.textContent = n + ' / ' + MAX;
        c.className = 'ag-fb-cnt' + (n >= MAX ? ' over' : '');
    }

    function saveDraft() {
        var m = document.getElementById('ag-fb-modal'); if (!m) return;
        var act = m.querySelector('#ag-fb-kinds .act');
        lsSet(LS_DRAFT, {
            kind: act ? act.dataset.k : 'chyba',
            txt: m.querySelector('#ag-fb-txt').value,
            contact: m.querySelector('#ag-fb-contact').value,
            meta: !!m.querySelector('#ag-fb-meta').checked
        });
    }
    function loadDraft() {
        var m = document.getElementById('ag-fb-modal'); if (!m) return;
        var d = lsGet(LS_DRAFT, null);
        if (!d) return;
        m.querySelector('#ag-fb-txt').value = d.txt || '';
        m.querySelector('#ag-fb-contact').value = d.contact || '';
        m.querySelector('#ag-fb-meta').checked = d.meta !== false;
        Array.prototype.forEach.call(m.querySelectorAll('#ag-fb-kinds button'), function (b) {
            b.className = (b.dataset.k === d.kind) ? 'act' : '';
        });
    }

    function renderQueueNote() {
        var m = document.getElementById('ag-fb-modal'); if (!m) return;
        var el = m.querySelector('#ag-fb-note'); if (!el) return;
        var n = queue().length;
        if (!n) { el.className = 'ag-fb-note'; el.textContent = t('Zpráva jde i bez signálu — počká v telefonu a odejde sama, až bude připojení.'); return; }
        el.className = 'ag-fb-note on';
        el.textContent = t('Čekající zprávy') + ': ' + n + ' — ' + t('odejdou samy, až bude připojení.');
    }

    function send() {
        if (_sending) return;
        var m = document.getElementById('ag-fb-modal'); if (!m) return;
        var txt = (m.querySelector('#ag-fb-txt').value || '').trim();
        if (!txt) { info(t('Zpráva je prázdná.'), t('Napište mi')); return; }
        var rec = {
            kind: (m.querySelector('#ag-fb-kinds .act') || { dataset: {} }).dataset.k || 'jine',
            txt: txt.slice(0, MAX),
            contact: (m.querySelector('#ag-fb-contact').value || '').trim() || null,
            who: who()
        };
        if (m.querySelector('#ag-fb-meta').checked) rec.meta = meta();

        // ⚠ NEJDŘÍV DO FRONTY, teprve pak odeslat. Kdyby se posílalo napřímo a spoj
        //   spadl uprostřed, napsaný text by byl pryč — a to je přesně ta situace,
        //   po které už člověk podruhé nepíše.
        enqueue(rec);
        var btn = m.querySelector('#ag-fb-send');
        _sending = true; btn.disabled = true;
        var orig = btn.textContent;
        btn.textContent = t('Odesílám…');
        flush().then(function (n) {
            _sending = false; btn.disabled = false; btn.textContent = orig;
            // po odeslání je koncept k ničemu — a kdyby zůstal, příště by se text
            // objevil znovu a člověk by ho poslal podruhé
            try { localStorage.removeItem(LS_DRAFT); } catch (e) { swallow(e, 'send:draft'); }
            m.querySelector('#ag-fb-txt').value = '';
            count();
            renderQueueNote();
            if (n > 0) { close(); info(t('Děkuji! Zpráva odešla.'), t('Napište mi')); }
            else info(t('Bez signálu — zpráva počká a odejde sama.'), t('Napište mi'));
        });
    }

    function open() {
        var m = build();
        m.style.display = 'flex';
        loadDraft();
        count();
        renderQueueNote();
        try { m.querySelector('#ag-fb-txt').focus(); } catch (e) { swallow(e, 'open:focus'); }
    }
    function close() {
        var m = document.getElementById('ag-fb-modal');
        if (m) m.style.display = 'none';
    }

    // ---- schránka vlastníka ----------------------------------------------------
    function ownerKey() { try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; } }
    function setOwnerKey(k) {
        try { if (k) localStorage.setItem(LS_KEY, k); else localStorage.removeItem(LS_KEY); } catch (e) { swallow(e, 'setOwnerKey'); }
    }

    function openInbox() {
        var k = ownerKey();
        if (!k) {
            var v = window.prompt('Klíč schránky (OWNER_KEY ze serveru):', '');
            if (!v) return;
            setOwnerKey(v.trim());
        }
        close();
        _inboxState = { stav: 'open', rows: [], konec: false };
        buildInbox().style.display = 'flex';
        loadInbox(true);
    }

    function buildInbox() {
        var m = document.getElementById('ag-fb-inbox');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'ag-fb-inbox';
        m.setAttribute('data-no-i18n', '');   // zprávy od lidí se nepřekládají
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h2 style="margin-top:0;">Zprávy od lidí <span id="ag-fb-open-n" style="font:600 13px/1 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);"></span></h2>' +
            '  <div class="modal-body">' +
            '    <div class="ag-fb-filter ag-fb-kinds" id="ag-fb-filter">' +
            '      <button type="button" data-s="open" class="act">Nevyřízené</button>' +
            '      <button type="button" data-s="">Vše</button>' +
            '      <button type="button" data-s="done">Vyřízené</button>' +
            '    </div>' +
            '    <div id="ag-fb-list"></div>' +
            '    <button type="button" class="btn btn-secondary" id="ag-fb-more" style="display:none;">Načíst starší</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-fb-forget" style="margin-top:18px;">Zapomenout klíč schránky</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-fb-inbox-close" style="margin-top:10px;">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-fb-inbox-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-fb-more').addEventListener('click', function () { loadInbox(false); });
        m.querySelector('#ag-fb-forget').addEventListener('click', function () {
            setOwnerKey('');
            m.style.display = 'none';
            info('Klíč schránky smazán z tohoto telefonu.', 'Zprávy od lidí');
        });
        var f = m.querySelector('#ag-fb-filter');
        Array.prototype.forEach.call(f.children, function (b) {
            b.addEventListener('click', function () {
                Array.prototype.forEach.call(f.children, function (c) { c.className = ''; });
                b.className = 'act';
                _inboxState = { stav: b.dataset.s, rows: [], konec: false };
                loadInbox(true);
            });
        });
        return m;
    }

    function loadInbox(reset) {
        var m = buildInbox();
        var list = m.querySelector('#ag-fb-list');
        if (reset) { _inboxState.rows = []; _inboxState.konec = false; list.innerHTML = '<p style="color:var(--text-muted,#9aa1ac);">Načítám…</p>'; }
        var q = '/feedback?stav=' + encodeURIComponent(_inboxState.stav || '');
        var last = _inboxState.rows[_inboxState.rows.length - 1];
        if (!reset && last) q += '&before=' + last.id;
        api(q, { ownerKey: ownerKey() }).then(function (r) {
            if (r.status === 403) { list.innerHTML = '<p style="color:#e0574a;">Špatný klíč schránky. Smaž ho dole a zadej znovu.</p>'; return; }
            // 429 = brzda proti hádání klíče (ownerGate v cloud/worker.js). Bez téhle
            // větve spadne do obecného „Nepovedlo se načíst (429)" a vypadá to jako
            // porucha serveru, přitom se jen čeká.
            if (r.status === 429) { list.innerHTML = '<p style="color:#d4a02c;">Moc pokusů o klíč, zkus to za hodinu.</p>'; return; }
            if (r.status === 503) { list.innerHTML = '<p style="color:#d4a02c;">' + esc((r.data && r.data.error) || 'Schránka není na serveru nastavená.') + '</p>'; return; }
            if (!r.ok) { list.innerHTML = '<p style="color:#e0574a;">Nepovedlo se načíst (' + r.status + ').</p>'; return; }
            var msgs = (r.data && r.data.messages) || [];
            _inboxState.rows = _inboxState.rows.concat(msgs);
            _inboxState.konec = msgs.length < 60;
            m.querySelector('#ag-fb-open-n').textContent = r.data && r.data.open ? '· ' + r.data.open + ' nevyřízených' : '';
            renderInbox();
        });
    }

    function renderInbox() {
        var m = document.getElementById('ag-fb-inbox'); if (!m) return;
        var list = m.querySelector('#ag-fb-list');
        var rows = _inboxState.rows;
        if (!rows.length) { list.innerHTML = '<p style="color:var(--text-muted,#9aa1ac);">Zatím žádné zprávy.</p>'; }
        else {
            list.innerHTML = rows.map(function (r) {
                var d = new Date(r.ts);
                var kindL = 'jiné';
                for (var i = 0; i < KINDS.length; i++) if (KINDS[i].k === r.kind) kindL = KINDS[i].l;
                return '<div class="ag-fb-msg' + (r.done ? ' done' : '') + '" data-id="' + r.id + '">' +
                    '<div class="ag-fb-h"><span class="ag-fb-tag ' + esc(r.kind || 'jine') + '">' + esc(kindL) + '</span>' +
                    '<span>' + esc(d.toLocaleString('cs-CZ')) + '</span>' +
                    (r.who ? '<span>· ' + esc(r.who) + '</span>' : '') +
                    (r.contact ? '<span>· ' + esc(r.contact) + '</span>' : '') + '</div>' +
                    '<div class="ag-fb-t">' + esc(r.txt) + '</div>' +
                    (r.meta ? '<div class="ag-fb-meta">' + esc(r.meta) + '</div>' : '') +
                    '<div class="ag-fb-acts">' +
                    '  <button type="button" data-a="done">' + (r.done ? 'Zpět mezi nevyřízené' : 'Vyřízeno') + '</button>' +
                    (r.contact ? '  <button type="button" data-a="mail">Odpovědět e-mailem</button>' : '') +
                    '  <button type="button" data-a="del">Smazat</button>' +
                    '</div></div>';
            }).join('');
        }
        m.querySelector('#ag-fb-more').style.display = _inboxState.konec ? 'none' : '';
        // jeden posluchač na seznam místo jednoho na tlačítko — seznam se
        // překresluje celý a jednotlivé posluchače by nemělo kdo odhlásit
        if (!list.dataset.bound) {
            list.dataset.bound = '1';
            list.addEventListener('click', onInboxClick);
        }
    }

    function onInboxClick(e) {
        var b = e.target.closest && e.target.closest('button[data-a]');
        if (!b) return;
        var box = b.closest('.ag-fb-msg');
        var id = box && parseInt(box.dataset.id, 10);
        if (!id) return;
        var rec = null;
        for (var i = 0; i < _inboxState.rows.length; i++) if (_inboxState.rows[i].id === id) rec = _inboxState.rows[i];
        if (!rec) return;
        var a = b.dataset.a;
        if (a === 'mail') {
            try {
                window.location.href = 'mailto:' + encodeURIComponent(rec.contact) +
                    '?subject=' + encodeURIComponent('AR Geodet — odpověď na vaši zprávu') +
                    '&body=' + encodeURIComponent('\n\n---\nVaše zpráva:\n' + rec.txt);
            } catch (err) { swallow(err, 'mail'); }
            return;
        }
        if (a === 'done') {
            api('/feedback/done', { method: 'POST', ownerKey: ownerKey(), body: { id: id, done: rec.done ? 0 : 1 } })
                .then(function (r) { if (r.ok) { rec.done = rec.done ? 0 : 1; renderInbox(); } });
            return;
        }
        if (a === 'del') {
            ask('Smazat tuhle zprávu natrvalo?').then(function (ok) {
                if (!ok) return;
                api('/feedback/done', { method: 'POST', ownerKey: ownerKey(), body: { id: id, smazat: 1 } })
                    .then(function (r) {
                        if (!r.ok) return;
                        _inboxState.rows = _inboxState.rows.filter(function (x) { return x.id !== id; });
                        renderInbox();
                    });
            });
        }
    }

    // ---- vstupy ----------------------------------------------------------------
    // „Více" (#side-menu) — hned za „Historie aktualizací" / „O aplikaci": všechno
    // tři je o appce samotné, ne o měření.
    function injectMenu() {
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('ag-fb-menu-btn')) return;
        var host = menu.querySelector('.menu-scroll') || menu;
        var btn = document.createElement('button');
        btn.id = 'ag-fb-menu-btn'; btn.className = 'menu-btn'; btn.type = 'button';
        btn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;vertical-align:-3px;">' + ICON + '</span> Napište mi';
        btn.addEventListener('click', function () {
            open();
            // toggleMenu() PŘEPÍNÁ — kdyby se sem někdo dostal jinak než z otevřeného
            // panelu, zavřením by ho naopak otevřel.
            try { if (typeof toggleMenu === 'function' && menu.classList.contains('open')) toggleMenu(); } catch (e) { swallow(e, 'injectMenu'); }
        });
        var after = null, all = host.querySelectorAll('.menu-btn');
        for (var i = 0; i < all.length; i++) {
            if (all[i].id === 'hist-menu-btn') { after = all[i]; break; }
            if ((all[i].getAttribute('onclick') || '').indexOf('openAbout') >= 0) after = all[i];
        }
        if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
        else host.appendChild(btn);
    }

    // Nastavení → Údržba. Tlačítko schránky se ukáže jen tomu, kdo už klíč zadal —
    // ostatním by k ničemu nebylo (server je stejně nepustí) a jen by mátlo.
    function injectSettings() {
        var tab = document.getElementById('tab-udrzba');
        if (!tab) return;
        if (!document.getElementById('ag-fb-set-btn')) {
            var btn = document.createElement('button');
            btn.id = 'ag-fb-set-btn'; btn.type = 'button'; btn.className = 'btn btn-secondary';
            btn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;vertical-align:-3px;">' + ICON + '</span> Napište mi — nápady a chyby';
            btn.addEventListener('click', function () {
                var mm = document.getElementById('settings-modal');
                if (mm) mm.style.display = 'none';
                open();
            });
            var after = document.getElementById('hist-set-btn');
            if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
            else tab.appendChild(btn);
        }
        var has = !!ownerKey();
        var ib = document.getElementById('ag-fb-inbox-btn');
        if (has && !ib) {
            ib = document.createElement('button');
            ib.id = 'ag-fb-inbox-btn'; ib.type = 'button'; ib.className = 'btn btn-secondary';
            ib.textContent = 'Zprávy od lidí (schránka)';
            ib.addEventListener('click', function () {
                var mm = document.getElementById('settings-modal');
                if (mm) mm.style.display = 'none';
                openInbox();
            });
            var a2 = document.getElementById('ag-fb-set-btn');
            if (a2 && a2.parentNode) a2.parentNode.insertBefore(ib, a2.nextSibling); else tab.appendChild(ib);
        } else if (!has && ib && ib.parentNode) ib.parentNode.removeChild(ib);
    }

    function init() {
        injectMenu();
        injectSettings();
        // Fronta se zkusí doručit až v klidu po startu — na startu appka stahuje
        // dlaždice mapy a body, a jedna odložená zpráva nikam nespěchá.
        var later = function () { try { flush(); } catch (e) { swallow(e, 'init:flush'); } };
        if (window.requestIdleCallback) window.requestIdleCallback(later, { timeout: 10000 });
        else setTimeout(later, 8000);
        window.addEventListener('online', function () { setTimeout(later, 1500); });
        (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
            try { injectMenu(); injectSettings(); } catch (e) { swallow(e, 'tick'); }
        }, 4000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.agOpenZpetnaVazba = open;
    window.AGZpetna = { open: open, close: close, inbox: openInbox, queued: function () { return queue().length; } };
})();
