// ============================================================================
// AR Geodet — FIREMNÍ CHAT (ODPOJITELNÁ vrstva nad js/ucty.js)
// ----------------------------------------------------------------------------
// Jednoduché zprávy mezi všemi přihlášenými ve firmě („pošli mi číslo bodu,
// jsem u šachty B"). ŽÁDNÝ realtime — prosté dotazování serveru (Cloudflare
// Worker, cloud/worker.js: POST/GET /chat) jednou za pár sekund, jen dokud je
// chat otevřený, aby se šetřil limit požadavků i baterie.
//   • funguje jen u CLOUDOVÉ firmy a s internetem (offline ukáže poslední
//     načtené zprávy z mezipaměti zařízení)
//   • server drží posledních ~500 zpráv na firmu, starší maže
// Odstranění: smaž js/firma-chat.js + řádek <script> v index.html (a v sw.js).
// ============================================================================
(function () {
    'use strict';
    if (window.AGFirmaChat) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2.4-2.9A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>';
    // ikona bodu (čárová grafika jako zbytek appky — žádné emoji)
    var PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>';
    var LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
    var STYLE_ID = 'ag-chat-style';
    var LS_CACHE = 'agChatCache_v1';   // {code, msgs:[posledních ~80]} — offline náhled
    var LS_READ = 'agChatRead_v1';     // {code, lastId} — poslední přečtená zpráva
    var POLL_MS = 8000;
    var PT_PREFIX = 'AG1\n';           // zpráva s body = stejný formát jako QR sdílení (sdileni.js)

    function U() { return window.AGUcty || null; }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function fmtT(ts) { return new Date(ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); }
    function fmtD(ts) { return new Date(ts).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric' }); }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // rozložení: obsah modálu je sloupec, seznam zpráv se roztahuje a roluje
            '#agch-modal .modal-content{display:flex;flex-direction:column;}',
            '#agch-modal .modal-body{display:flex;flex-direction:column;min-height:0;}',
            '#agch-list{flex:1;min-height:120px;overflow-y:auto;display:flex;flex-direction:column;gap:7px;padding:6px 2px;}',
            // volba adresáta (Všem / konkrétní člověk)
            '#agch-to{display:flex;gap:6px;flex-wrap:wrap;flex:none;padding:0 0 8px;align-items:center;}',
            '#agch-to .agch-tolabel{font:700 10.5px/1 var(--font-ui,system-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);margin-right:2px;}',
            '#agch-to button .cnt{display:inline-block;margin-left:5px;min-width:15px;height:15px;border-radius:999px;background:var(--glass-bg,rgba(255,255,255,0.12));',
            '  color:var(--text-color,#e6e8eb);font:700 10px/15px var(--font-ui,system-ui);text-align:center;padding:0 3px;}',
            '#agch-to button svg{width:11px;height:11px;margin-right:3px;vertical-align:-1px;}',
            // pruh „píšeš soukromě" + odkazy na soukromá vlákna
            '#agch-bar{flex:none;display:none;align-items:center;gap:8px;margin:0 0 8px;padding:8px 11px;border-radius:11px;',
            '  border:1px solid rgba(212,160,44,0.42);background:rgba(212,160,44,0.1);color:#d4a02c;font:600 11.5px/1.35 var(--font-ui,system-ui);}',
            '#agch-bar.on{display:flex;}',
            '#agch-bar svg{width:14px;height:14px;flex:none;}',
            '#agch-bar span{flex:1;min-width:0;}',
            '#agch-bar button{flex:none;border:1px solid rgba(212,160,44,0.5);background:transparent;color:#d4a02c;border-radius:9px;',
            '  padding:6px 9px;font:700 11px/1 var(--font-ui,system-ui);cursor:pointer;}',
            // soukromá zpráva ve společném seznamu: viditelně odlišená, ale ve stejném toku
            '#agch-modal .priv .agch-bubble{border-style:dashed;}',
            '#agch-to button{border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:var(--glass-bg,rgba(255,255,255,0.04));',
            '  color:var(--text-muted,#9aa1ac);border-radius:999px;padding:7px 12px;font:600 12px/1 var(--font-ui,system-ui);cursor:pointer;',
            '  transition:color .15s ease,border-color .15s ease,background .15s ease;}',
            '#agch-to button.act{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.14));color:var(--accent,#2f9e74);}',
            // hledání adresáta (nahradilo vodorovný pásek se všemi jmény)
            '#agch-to .agch-tonone{font:500 11.5px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#agch-to .agch-pickbox{flex:1 1 100%;margin-top:6px;padding:8px;border-radius:12px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '#agch-to .agch-pickbox input{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:10px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:var(--surface-2,rgba(255,255,255,0.06));',
            '  color:var(--text-color,#e6e8eb);font:500 13.5px/1.2 var(--font-ui,system-ui);outline:none;}',
            '#agch-to .agch-pickbox input:focus{border-color:var(--accent,#2f9e74);}',
            '#agch-to .agch-picklist{display:flex;flex-direction:column;gap:5px;max-height:190px;overflow-y:auto;margin-top:7px;}',
            '#agch-to .agch-picklist button{text-align:left;width:100%;}',
            '#agch-modal .agch-meta .lock{color:#d4a02c;font-weight:700;}',
            '#agch-modal .priv .agch-bubble{border-color:rgba(212,160,44,0.4);background:rgba(212,160,44,0.08);}',
            '#agch-modal .agch-day{align-self:center;font:600 10.5px/1 var(--font-ui,system-ui);letter-spacing:.05em;text-transform:uppercase;',
            '  color:var(--text-muted,#9aa1ac);background:var(--glass-bg,rgba(255,255,255,0.06));border-radius:999px;padding:5px 11px;margin:6px 0 2px;}',
            '#agch-modal .agch-msg{max-width:82%;display:flex;flex-direction:column;gap:2px;align-self:flex-start;}',
            '#agch-modal .agch-msg.mine{align-self:flex-end;align-items:flex-end;}',
            '#agch-modal .agch-meta{display:flex;align-items:center;gap:6px;font:600 10.5px/1 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);padding:0 4px;}',
            '#agch-modal .agch-meta .who{font-weight:700;}',
            '#agch-modal .agch-bubble{border-radius:14px;padding:9px 12px;font:500 13.5px/1.45 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);',
            '  background:var(--glass-bg,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.09));',
            '  border-bottom-left-radius:5px;word-break:break-word;white-space:pre-wrap;}',
            '#agch-modal .mine .agch-bubble{background:var(--accent-soft,rgba(47,158,116,0.16));border-color:var(--accent-line,rgba(47,158,116,0.35));',
            '  border-bottom-left-radius:14px;border-bottom-right-radius:5px;}',
            '#agch-modal .agch-empty{align-self:center;text-align:center;font:500 12px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:22px 10px;}',
            '#agch-modal .agch-inrow{display:flex;gap:8px;margin-top:10px;flex:none;}',
            '#agch-modal .agch-inrow textarea{flex:1;resize:none;height:44px;box-sizing:border-box;background:var(--glass-bg,rgba(255,255,255,0.06));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.16));border-radius:12px;color:var(--text-color,#e6e8eb);padding:11px 12px;',
            '  font:500 14px/1.3 var(--font-ui,system-ui);outline:none;transition:border-color .15s ease;}',
            '#agch-modal .agch-inrow textarea:focus{border-color:var(--accent,#2f9e74);}',
            '#agch-modal .agch-send{flex:none;width:48px;height:44px;border:none;border-radius:12px;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;',
            '  background:linear-gradient(150deg,var(--accent,#2f9e74),rgba(0,0,0,0.22)) var(--accent,#2f9e74);',
            '  box-shadow:0 4px 12px var(--accent-soft,rgba(47,158,116,0.3));transition:transform .12s ease;}',
            '#agch-modal .agch-send:active{transform:scale(.94);}',
            '#agch-modal .agch-send svg{width:20px;height:20px;}',
            '#agch-modal .agch-off{font:600 11.5px/1.4 var(--font-ui,system-ui);color:#d4a02c;text-align:center;margin-top:6px;min-height:15px;}',
            // zpráva s body: karta s tlačítkem převzetí
            '#agch-modal .agch-pts{display:flex;flex-direction:column;gap:6px;}',
            '#agch-modal .agch-pts .nm{font:600 12.5px/1.4 var(--font-ui,system-ui);}',
            '#agch-modal .agch-take{border:1px solid var(--accent-line,rgba(47,158,116,0.4));background:var(--accent-soft,rgba(47,158,116,0.12));',
            '  color:var(--accent,#2f9e74);border-radius:10px;padding:8px 12px;font:700 12px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '#agch-modal .agch-ptbtn{flex:none;width:48px;height:44px;border:1px solid var(--glass-border,rgba(255,255,255,0.16));border-radius:12px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));color:var(--accent,#2f9e74);cursor:pointer;display:flex;align-items:center;justify-content:center;}',
            '#agch-modal .agch-ptbtn svg{width:20px;height:20px;}',
            '#agch-modal .agch-pts .nm svg{width:14px;height:14px;vertical-align:-2px;color:var(--accent,#2f9e74);}',
            '#agch-modal .agch-meta .lock svg{width:11px;height:11px;vertical-align:-1px;margin-right:2px;}',
            '#agch-picker h3 svg{width:17px;height:17px;vertical-align:-2px;}',
            // výběr bodů k odeslání
            '#agch-picker .modal-content{display:flex;flex-direction:column;}',
            '#agch-picker .modal-body{min-height:0;}',
            '#agch-picker .agch-pk-row{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.07));',
            '  font:500 13px/1.3 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '#agch-picker .agch-pk-row input{width:18px;height:18px;accent-color:var(--accent,#2f9e74);}',
            '#agch-picker .agch-pk-row span{color:var(--text-muted,#9aa1ac);font-size:calc(11px * var(--ag-font-scale, 1));}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    var _msgs = [];      // [{id, uid, u, ts, txt}]
    var _lastId = 0;
    var _poll = null;
    var _loadBusy = false, _failN = 0, _backoffUntil = 0;   // ochrana pollingu (baterie/rádio)
    var _busySend = false;

    function firmCode() { var u = U(); var f = u && u.getFirm(); return (f && f.code) || null; }
    function meId() { var m = meUser(); return (m && m.id) || null; }
    // MEZIPAMET PATRI KONKRETNIMU CLOVEKU, NE JEN FIRME. Do _msgs se dostanou i
    // SOUKROME zpravy (server je posila jen adresatovi), takze kdyz se cache
    // klicovala jen kodem firmy, precetl si je na sdilenem firemnim telefonu
    // i dalsi kolega, ktery se prihlasil po nem — appka mu je vykreslila z
    // localStorage jeste driv, nez se server stihl zeptat.
    function cacheLoad() {
        try {
            var c = JSON.parse(localStorage.getItem(LS_CACHE) || 'null');
            if (c && c.code === firmCode() && c.uid === meId() && Array.isArray(c.msgs)) {
                _msgs = c.msgs; _lastId = _msgs.length ? _msgs[_msgs.length - 1].id : 0;
            } else if (c) {
                _msgs = []; _lastId = 0;
                try { localStorage.removeItem(LS_CACHE); } catch (e2) { }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:cacheLoad'); }
    }
    function cacheSave() {
        try { localStorage.setItem(LS_CACHE, JSON.stringify({ code: firmCode(), uid: meId(), msgs: _msgs.slice(-80) })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:cacheSave'); }
    }

    function ensureModal() {
        var m = document.getElementById('agch-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'agch-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Firemní chat</h3>' +
            '  <div class="modal-body" style="flex:1;min-height:0;">' +
            '    <div class="agch-to" id="agch-to"></div>' +
            '    <div id="agch-bar"></div>' +
            '    <div id="agch-list"></div>' +
            '    <div class="agch-off" id="agch-off"></div>' +
            '    <div class="agch-inrow">' +
            '      <button type="button" class="agch-ptbtn" id="agch-pt" title="Poslat body" aria-label="Poslat body">' + PIN_SVG + '</button>' +
            '      <textarea id="agch-inp" maxlength="500" placeholder="Napiš zprávu…"></textarea>' +
            '      <button type="button" class="agch-send" id="agch-send" aria-label="Odeslat">' +
            '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>' +
            '      </button>' +
            '    </div>' +
            '  </div>' +
            '  <button class="btn btn-secondary" style="margin-top:12px;" id="agch-close">Zavřít</button>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#agch-close').onclick = close;
        m.querySelector('#agch-send').onclick = send;
        m.querySelector('#agch-pt').onclick = openPicker;
        // volba adresáta: Všem / konkrétní člověk (i z pruhu a z nabídky vláken)
        m.querySelector('.modal-body').addEventListener('click', function (e) {
            // rozbalení/zavření hledání adresáta
            var p = e.target.closest ? e.target.closest('button[data-pick]') : null;
            if (p) {
                _pickOpen = p.getAttribute('data-pick') === '1';
                if (!_pickOpen) _pickQ = '';
                renderTo();
                return;
            }
            var b = e.target.closest ? e.target.closest('button[data-to]') : null;
            if (!b) return;
            _to = b.getAttribute('data-to') || '';
            _pickOpen = false; _pickQ = '';
            renderTo();
            render();
            try { m.querySelector('#agch-inp').focus(); } catch (err) { window.AG && AG.swallow && AG.swallow(err, 'firma-chat:ensureModal'); }
        });
        m.querySelector('#agch-inp').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        });
        // převzetí bodů ze zprávy (delegovaně — seznam se překresluje)
        m.querySelector('#agch-list').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.agch-take') : null;
            if (!b) return;
            var pts = _ptByMsg[b.getAttribute('data-mid')];
            if (pts) importPts(pts);
        });
        return m;
    }

    // ---- adresát zprávy: '' = všem ve firmě, jinak id uživatele -------------
    var _to = '';
    function meUser() { var u = U(); return u && u.currentUser ? u.currentUser() : null; }
    // ⚠ ZABLOKOVANÉ ÚČTY SE NENABÍZEJÍ. Administrace je vidět schválně (admin je musí
    // umět odblokovat), ale poslat soukromou zprávu někomu, kdo se nemůže přihlásit,
    // je slepá ulička. Spolu s obnovou seznamu při otevření (viz open()) to je odpověď
    // na hlášení z 29. 8. 2026: „chat má v sobě uživatele, kteří neexistují, a nejsou
    // tam stávající členové."
    function firmUsers() {
        var u = U(); var f = u && u.getFirm();
        var me = meUser();
        return ((f && f.users) || []).filter(function (x) {
            return x && !x.disabled && (!me || x.id !== me.id);
        });
    }
    function toName(id) {
        var us = firmUsers();
        for (var i = 0; i < us.length; i++) if (us[i].id === id) return us[i].name;
        var me = meUser();
        if (me && me.id === id) return me.name;
        return '?';
    }
    // volba adresáta NOVÉ zprávy (na zobrazení seznamu nemá vliv)
    //
    // ⚠ HLEDÁNÍ MÍSTO VODOROVNÉHO PÁSKU (na přání 29. 8. 2026: „u toho chatu bych
    // udělal vyhledávání členu, komu napsat, místo vodorovného pásku uživatelé — až
    // jich bude hodně, ten pásek není přehledný"). Pásek se všemi jmény vedle sebe je
    // čitelný do pěti lidí; při dvaceti je to nekonečné rolování do strany. Teď je
    // vidět jen aktuální adresát a tlačítko, které rozbalí pole s hledáním. Pod
    // PRAH_HLEDANI lidí se hledací pole neukazuje — u tří kolegů by jen překáželo.
    var PRAH_HLEDANI = 6;
    var _pickOpen = false, _pickQ = '';
    // porovnání bez diakritiky a velikosti písmen, ať „nováková" najde „Nováková"
    function normTxt(s) {
        s = String(s == null ? '' : s).toLowerCase();
        try { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { return s; }
    }
    function renderTo() {
        var box = document.getElementById('agch-to');
        if (!box) return;
        var users = firmUsers();
        var html = '<span class="agch-tolabel">Komu:</span>' +
            '<button type="button" data-to="" class="' + (_to === '' ? 'act' : '') + '">Všem ve firmě</button>';
        if (_to) {
            html += '<button type="button" data-to="' + esc(_to) + '" class="act">' + LOCK_SVG + esc(toName(_to)) + '</button>';
        }
        if (!users.length) {
            html += '<span class="agch-tonone">ve firmě zatím nikdo další není</span>';
        } else if (users.length <= PRAH_HLEDANI && !_pickOpen) {
            // málo lidí → nemá cenu nic schovávat, ať je to na jeden klik
            users.forEach(function (x) {
                if (x.id === _to) return;
                html += '<button type="button" data-to="' + esc(x.id) + '">' + LOCK_SVG + esc(String(x.name).slice(0, 14)) + '</button>';
            });
        } else {
            html += '<button type="button" class="agch-pick" data-pick="' + (_pickOpen ? '0' : '1') + '">'
                + (_pickOpen ? 'Zavřít' : 'Soukromě komu… (' + users.length + ')') + '</button>';
        }
        if (_pickOpen) {
            var q = normTxt(_pickQ);
            var hit = users.filter(function (x) { return !q || normTxt(x.name).indexOf(q) !== -1; });
            html += '<div class="agch-pickbox">' +
                '<input type="search" id="agch-pickq" placeholder="Hledej jméno…" autocomplete="off" value="' + esc(_pickQ) + '">' +
                '<div class="agch-picklist">' +
                (hit.length
                    ? hit.map(function (x) {
                        return '<button type="button" data-to="' + esc(x.id) + '">' + LOCK_SVG + esc(x.name) + '</button>';
                    }).join('')
                    : '<span class="agch-tonone">Nikdo takový ve firmě není.</span>') +
                '</div></div>';
        }
        box.innerHTML = html;
        if (_pickOpen) {
            var qi = document.getElementById('agch-pickq');
            if (qi) {
                qi.addEventListener('input', function () { _pickQ = this.value || ''; renderTo(); });
                // fokus zpět do pole, ať se dá psát dál i po překreslení seznamu
                try { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:renderTo'); }
            }
        }
        var inp = document.getElementById('agch-inp');
        if (inp) inp.placeholder = _to ? ('Soukromě pro ' + toName(_to) + '…') : 'Napiš zprávu všem…';

        // pruh, když se píše soukromě (aby to nikoho nepřekvapilo)
        var bar = document.getElementById('agch-bar');
        if (bar) {
            if (_to) {
                bar.className = 'on';
                bar.innerHTML = LOCK_SVG + '<span>Píšeš <b>soukromě</b> pro ' + esc(toName(_to)) + ' — nikdo jiný to neuvidí.</span>' +
                    '<button type="button" data-to="">Psát všem</button>';
            } else {
                bar.className = '';
                bar.innerHTML = '';
            }
        }
    }

    // ---- body ve zprávě (stejný kompaktní formát jako QR sdílení, sdileni.js) ----
    var _ptByMsg = {};
    function decodePts(txt) {
        if (!txt || txt.indexOf(PT_PREFIX) !== 0) return null;
        // formát drží sdileni.js (vč. výšky a poznámky) — dekódování má na starosti on
        if (window.AGShare && typeof window.AGShare.decode === 'function') {
            var d = window.AGShare.decode(txt);
            return (d && d.length) ? d : null;
        }
        var rows = txt.replace(/\r/g, '').split('\n');
        var out = [];
        for (var i = 1; i < rows.length; i++) {
            if (!rows[i]) continue;
            var c = rows[i].split('\t');
            if (c.length < 3) continue;
            var lat = parseFloat(c[1]), lng = parseFloat(c[2]);
            if (isNaN(lat) || isNaN(lng)) continue;
            out.push({ name: c[0] || 'Bod', lat: lat, lng: lng });
        }
        return out.length ? out : null;
    }
    // import = stejná cesta jako naskenované QR body: přidává, nikdy nepřepisuje
    function importPts(pts) {
        if (typeof persistentCustomPoints === 'undefined') { setOff('Aplikace ještě není připravená na import bodů.'); return; }
        // stejná cesta jako QR: uloží i poznámku k bodu, zapíše provenienci a žurnál
        if (window.AGShare && typeof window.AGShare.importPoints === 'function') { window.AGShare.importPoints(pts, 'chat'); return; }
        var added = 0, skipped = 0;
        pts.forEach(function (np) {
            var dup = persistentCustomPoints.some(function (ep) {
                return ep.name === np.name && (typeof getDistance === 'function'
                    ? getDistance(ep.lat, ep.lng, np.lat, np.lng) < 0.5
                    : Math.abs(ep.lat - np.lat) < 1e-5 && Math.abs(ep.lng - np.lng) < 1e-5);
            });
            if (dup) { skipped++; return; }
            var pt = { id: 'cp_' + Date.now() + '_' + Math.round(Math.random() * 1e6), name: np.name, lat: np.lat, lng: np.lng, cat: 'CUSTOM', type: 'custom', shared: true };
            persistentCustomPoints.push(pt);
            if (typeof arPoints !== 'undefined') arPoints.push(Object.assign({}, pt, { hidden: false }));
            added++;
        });
        if (added) {
            try { setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:importPts'); }
            try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:importPts'); }
            try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:importPts'); }
            try { if (typeof updateInfoPanel === 'function') updateInfoPanel(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:importPts'); }
        }
        var msg = 'Přidáno ' + added + ' bodů' + (skipped ? ', ' + skipped + ' přeskočeno (už je máš)' : '') + '.';
        try { if (typeof quickToast === 'function') { quickToast(msg); return; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:importPts'); }
        agInfo(msg);
    }
    // výběr vlastních bodů k odeslání
    function openPicker() {
        if (typeof persistentCustomPoints === 'undefined' || !persistentCustomPoints.length) {
            setOff('Nemáš žádné vlastní body k poslání.');
            return;
        }
        var old = document.getElementById('agch-picker'); if (old) old.remove();
        var m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'agch-picker';
        m.innerHTML =
            '<div class="modal-content">' +
            '<h3 style="color:var(--accent);margin-top:0;">' + PIN_SVG + ' Poslat body do chatu</h3>' +
            '<div class="modal-body" style="flex:1;overflow-y:auto;">' +
            persistentCustomPoints.map(function (p, i) {
                return '<label class="agch-pk-row"><input type="checkbox" data-i="' + i + '"> ' + esc(p.name || 'Bod') +
                    ' <span>(' + (+p.lat).toFixed(5) + ', ' + (+p.lng).toFixed(5) + ')</span></label>';
            }).join('') +
            '</div>' +
            '<div class="agch-off" id="agch-pk-err"></div>' +
            '<button class="btn" style="margin-top:10px;" id="agch-pk-send">Odeslat vybrané</button>' +
            '<button class="btn btn-secondary" style="margin-top:8px;" id="agch-pk-x">Zrušit</button></div>';
        document.body.appendChild(m);
        m.style.display = 'flex';
        var errEl = m.querySelector('#agch-pk-err');
        m.querySelector('#agch-pk-x').onclick = function () { m.remove(); };
        m.querySelector('#agch-pk-send').onclick = function () {
            var sel = [];
            var cbs = m.querySelectorAll('input[data-i]');
            for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) sel.push(persistentCustomPoints[+cbs[i].getAttribute('data-i')]);
            if (!sel.length) { errEl.textContent = 'Vyber aspoň jeden bod.'; return; }
            var payload = (window.AGShare && typeof window.AGShare.encode === 'function')
                ? window.AGShare.encode(sel)
                : PT_PREFIX + sel.map(function (p) {
                    var name = String(p.name || 'Bod').replace(/[\t\n\r]/g, ' ').slice(0, 40);
                    return name + '\t' + (+p.lat).toFixed(6) + '\t' + (+p.lng).toFixed(6);
                }).join('\n');
            if (payload.length > 490) { errEl.textContent = 'Do jedné zprávy se vejde méně bodů — odeber pár z výběru.'; return; }
            var u = U(); if (!u) return;
            errEl.textContent = 'Odesílám…';
            u.cloudFetch('/chat', { method: 'POST', body: { txt: payload, to: _to || undefined } }).then(function (r) {
                if (!r.ok) { errEl.textContent = r.status === 0 ? 'Bez internetu body nejde poslat.' : 'Odeslání selhalo (' + r.status + ').'; return; }
                m.remove();
                load();
            });
        };
    }

    function render(scrollDown) {
        var list = document.getElementById('agch-list');
        if (!list) return;
        var u = U();
        var me = u && u.currentUser();
        var meId = me ? me.id : null;
        // JEDEN seznam: veřejné i soukromé zprávy pohromadě (server posílá jen to,
        // co smím vidět). Soukromé jsou označené zámkem — nic se nikam „neschová",
        // volba adresáta níž ovlivňuje jen to, KAM půjde nová zpráva.
        var shown = _msgs;
        if (!shown.length) {
            list.innerHTML = '<div class="agch-empty">Zatím žádné zprávy.<br>Napiš první — uvidí ji všichni ve firmě.</div>';
            return;
        }
        var html = '', lastDay = '';
        _ptByMsg = {};
        shown.forEach(function (msg) {
            var day = new Date(msg.ts).toDateString();
            if (day !== lastDay) { html += '<div class="agch-day">' + esc(fmtD(msg.ts)) + '</div>'; lastDay = day; }
            var mine = meId && msg.uid === meId;
            var priv = !!msg.to_uid;
            html += '<div class="agch-msg' + (mine ? ' mine' : '') + (priv ? ' priv' : '') + '">' +
                '<div class="agch-meta">' +
                (mine ? '' : '<span class="who" style="color:hsl(' + hue(msg.u) + ',55%,62%);">' + esc(msg.u || '?') + '</span>') +
                (priv ? '<span class="lock">' + LOCK_SVG + esc(mine ? ('jen pro ' + (msg.toName || toName(msg.to_uid))) : 'jen tobě') + '</span>' : '') +
                '<span>' + fmtT(msg.ts) + '</span></div>';
            var pts = decodePts(msg.txt);
            if (pts) {
                _ptByMsg[msg.id] = pts;
                html += '<div class="agch-bubble agch-pts">' +
                    '<div class="nm">' + PIN_SVG + ' ' + (pts.length === 1 ? 'Bod' : 'Body (' + pts.length + ')') + ': ' +
                    esc(pts.map(function (p) { return p.name; }).join(', ').slice(0, 120)) + '</div>' +
                    (mine ? '' : '<button type="button" class="agch-take" data-mid="' + esc(String(msg.id)) + '">Převzít do mých bodů</button>') +
                    '</div></div>';
            } else {
                html += '<div class="agch-bubble">' + esc(msg.txt) + '</div></div>';
            }
        });
        list.innerHTML = html;
        if (scrollDown !== false) list.scrollTop = list.scrollHeight;
    }
    function hue(name) {
        // respektuj vlastní barvu avataru (AGUcty.avatarGet), jinak hash jména
        try {
            var u = U();
            if (u && u.avatarGet) { var c = u.avatarGet(name); if (c && c.h != null) return c.h; }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:hue'); }
        var h = 0, s = String(name || '');
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
        return h;
    }
    function setOff(msg) {
        var el = document.getElementById('agch-off');
        if (el) el.textContent = msg || '';
    }

    function setDisabled(on, why) {
        var inp = document.getElementById('agch-inp');
        var sd = document.getElementById('agch-send');
        var pt = document.getElementById('agch-pt');
        [inp, sd, pt].forEach(function (el) {
            if (!el) return;
            el.disabled = !!on;
            el.style.opacity = on ? '0.45' : '';
        });
        if (on && why) setOff(why);
    }

    function load() {
        var u = U(); if (!u) return;
        // BATERIE/RADIO: bez teto pojistky se pri zaseknute siti dotazy kupily (kazdych 8 s
        // novy) a pri chybe se tlouklo do radia porad stejne rychle. Nove: jen jeden dotaz
        // v letu + po chybe se interval docasne prodlouzi (8 -> 16 -> 32 -> max 64 s).
        if (_loadBusy) return;
        if (navigator.onLine === false) { setOff('Offline — zobrazeny poslední načtené zprávy.'); return; }
        if (_backoffUntil && Date.now() < _backoffUntil) return;
        _loadBusy = true;
        u.cloudFetch('/chat' + (_lastId ? '?after=' + _lastId : '')).then(function (r) {
            _loadBusy = false;
            if (r && (r.status === 0 || r.status >= 500)) {
                _failN = Math.min(_failN + 1, 3);
                _backoffUntil = Date.now() + POLL_MS * Math.pow(2, _failN);
            } else { _failN = 0; _backoffUntil = 0; }
            if (!r.ok || !r.data || !Array.isArray(r.data.messages)) {
                if (r.status === 404) {
                    // server běží na starém kódu (bez /chat) — jasně to říct, ne mlčet
                    setDisabled(true, 'Server ještě neumí chat — je potřeba nasadit nový cloud/worker.js (viz cloud/README.md).');
                    return;
                }
                setOff(r.status === 0 ? 'Offline — zobrazeny poslední načtené zprávy.' : (r.status ? 'Server vrátil chybu ' + r.status + '.' : ''));
                return;
            }
            setDisabled(false);
            setOff('');
            var seen = {};
            _msgs.forEach(function (msg) { seen[msg.id] = 1; });
            var fresh = r.data.messages.filter(function (msg) { return msg && msg.id && !seen[msg.id]; });
            if (fresh.length) {
                var list = document.getElementById('agch-list');
                var atBottom = !list || (list.scrollHeight - list.scrollTop - list.clientHeight < 60);
                _msgs = _msgs.concat(fresh).slice(-300);
                _lastId = _msgs[_msgs.length - 1].id;
                cacheSave();
                render(atBottom);
                renderTo();   // seznam lidí se mohl doplnit (nový kolega ve firmě)
            }
            markRead();   // chat je otevřený → vše je přečtené
        }).catch(function () { _loadBusy = false; });   // pojistka, ať se guard nezasekne
    }

    // ---- nepřečtené zprávy (tečka na dlaždici + hláška po startu) ----------
    var _unread = 0;
    function readPtr() {
        try {
            var c = JSON.parse(localStorage.getItem(LS_READ) || 'null');
            if (c && c.code === firmCode() && c.uid === meId()) return c.lastId || 0;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:readPtr'); }
        return 0;
    }
    function markRead() {
        try { localStorage.setItem(LS_READ, JSON.stringify({ code: firmCode(), uid: meId(), lastId: _lastId })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:markRead'); }
        _unread = 0;
        syncBadge();
    }
    // dlaždici překreslují jiné moduly → badge se periodicky obnovuje (viz init)
    function syncBadge() {
        var tile = document.querySelector('#tools-modal .tool-tile[data-tool="firma-chat"]');
        if (!tile) return;
        var b = tile.querySelector('.agch-badge');
        if (!_unread) { if (b) b.remove(); return; }
        if (!b) {
            b = document.createElement('span');
            b.className = 'agch-badge';
            b.style.cssText = 'position:absolute;top:6px;right:6px;min-width:18px;height:18px;border-radius:999px;' +
                'background:var(--danger,#e5534b);color:#fff;font:700 11px/18px system-ui;text-align:center;padding:0 4px;pointer-events:none;';
            try { if (getComputedStyle(tile).position === 'static') tile.style.position = 'relative'; } catch (e) { tile.style.position = 'relative'; }
            tile.appendChild(b);
        }
        b.textContent = _unread > 9 ? '9+' : String(_unread);
    }
    // po startu / přihlášení: JEDEN dotaz na nové zprávy (žádné trvalé dotazování)
    function startupCheck() {
        var u = U();
        if (!u || !u.isCloud || !u.isCloud() || !u.currentUser()) return;
        var ptr = readPtr();
        u.cloudFetch('/chat' + (ptr ? '?after=' + ptr : '')).then(function (r) {
            if (!r.ok || !r.data || !Array.isArray(r.data.messages)) return;
            // rovnou doplnit mezipaměť (ušetří stažení při otevření chatu)
            cacheLoad();
            var seen = {};
            _msgs.forEach(function (m3) { seen[m3.id] = 1; });
            var fresh = r.data.messages.filter(function (m3) { return m3 && m3.id && !seen[m3.id]; });
            if (fresh.length) {
                _msgs = _msgs.concat(fresh).slice(-300);
                _lastId = _msgs[_msgs.length - 1].id;
                cacheSave();
            } else if (_msgs.length) {
                _lastId = _msgs[_msgs.length - 1].id;
            }
            if (!ptr) { markRead(); return; }   // první seznámení s chatem: nehlásit historii
            var me = u.currentUser();
            _unread = r.data.messages.filter(function (m4) { return m4 && (!me || m4.uid !== me.id); }).length;
            if (!_unread) return;
            syncBadge();
            var t = 'Firemní chat: ' + _unread + ' ' + (_unread === 1 ? 'nová zpráva' : (_unread < 5 ? 'nové zprávy' : 'nových zpráv'));
            try { if (typeof quickToast === 'function') quickToast(t); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:startupCheck'); }
        });
    }

    // Odchozí zprávy jdou přes js/fronta.js. DŮVOD: chat je jediný modul, který
    // psal do cloudu a NEMĚL frontu — bez signálu se napsaná zpráva zahodila
    // s hláškou „Bez internetu zprávu nejde odeslat." a kolega se nikdy
    // nedozvěděl, že jsi psal. A geodet je bez signálu půl dne (sklep, les,
    // zástavba), takže to nebyl okrajový stav.
    var _frontaHotova = false;
    function zaridFrontu() {
        if (_frontaHotova || !window.AGFronta) return _frontaHotova;
        AGFronta.registruj('chat', {
            popis: 'zpráva do chatu',
            odeslat: function (telo) {
                var u = U();
                // Odhlášený uživatel: 401 = fronta se pozastaví a počká,
                // nezahodí. Přesně to chceme — po přihlášení se to odešle.
                if (!u) return Promise.resolve({ ok: false, status: 401 });
                return u.cloudFetch('/chat', { method: 'POST', body: telo });
            }
        });
        _frontaHotova = true;
        return true;
    }

    function send() {
        if (_busySend) return;
        var inp = document.getElementById('agch-inp');
        var txt = (inp.value || '').trim();
        if (!txt) return;
        var u = U(); if (!u) return;
        var telo = { txt: txt, to: _to || undefined };
        var kam = _to ? (' soukromě pro ' + toName(_to)) : '';

        if (zaridFrontu()) {
            _busySend = true;
            setOff('Odesílám…');
            // Pole se vyprazdňuje HNED: zpráva je od téhle chvíle uložená ve
            // frontě, takže ji nikdo neztratí ani zavřením appky. Nechat ji
            // viset v poli by svádělo k druhému odeslání téhož.
            inp.value = '';
            AGFronta.posli('chat', telo).then(function (v) {
                _busySend = false;
                if (v.stav === 'odeslano') {
                    setOff(_to ? ('Odesláno' + kam + '.') : '');
                    if (_to) setTimeout(function () { setOff(''); }, 2500);
                    load();
                } else if (v.stav === 'ceka') {
                    setOff('Uloženo — odešle se' + kam + ', jakmile bude signál.');
                } else {
                    // Server to odmítl natrvalo (moc dlouhá, prázdná). Vrátit
                    // uživateli text, ať o něj nepřijde.
                    inp.value = txt;
                    setOff('Zprávu server odmítl' + (v.status ? ' (' + v.status + ')' : '') + ' — zkrať ji.');
                }
            });
            return;
        }

        // Záloha, když vrstva fronty není načtená: původní chování.
        _busySend = true;
        setOff('Odesílám…');
        u.cloudFetch('/chat', { method: 'POST', body: telo }).then(function (r) {
            _busySend = false;
            if (!r.ok) {
                setOff(r.status === 0 ? 'Bez internetu zprávu nejde odeslat.'
                    : (r.status === 404 ? 'Server ještě neumí chat — je potřeba nasadit nový cloud/worker.js.'
                        : 'Odeslání selhalo (' + ((r.data && r.data.error) || r.status) + ').'));
                return;
            }
            inp.value = '';
            // krátké potvrzení, ať je jasné, KAM zpráva šla
            setOff(_to ? ('Odesláno soukromě pro ' + toName(_to) + '.') : '');
            if (_to) setTimeout(function () { setOff(''); }, 2500);
            load();
        });
    }

    function close() {
        var m = document.getElementById('agch-modal');
        if (m) m.style.display = 'none';
        if (_poll) { clearInterval(_poll); _poll = null; }
    }

    function open() {
        var u = U();
        var f = u && u.getFirm();
        function say(t, msg) {
            try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: msg }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:say'); }
            agInfo(t + '\n\n' + msg);
        }
        if (!f) return say('Firemní chat', 'Chat funguje ve firemním režimu (Nástroje → Firma a účty).');
        if (!f.cloud) return say('Firemní chat', 'Chat potřebuje CLOUDOVOU firmu (účty na serveru) — lokální firma nemá kam zprávy posílat.');
        if (!u.currentUser()) return say('Firemní chat', 'Nejdřív se přihlas.');
        var m = ensureModal();
        m.style.display = 'flex';
        cacheLoad();
        _pickOpen = false; _pickQ = '';
        renderTo();
        render();
        load();
        // Seznam kolegů je v telefonu z posledního stažení konfigurace — mezitím mohl
        // někdo přibýt nebo být smazaný. Při otevření chatu se proto obnoví a soupis
        // adresátů se překreslí. Fail-silent: bez signálu zůstane, co bylo.
        try {
            if (u.refreshConfig) u.refreshConfig().then(function (ok) {
                var mm = document.getElementById('agch-modal');
                if (ok && mm && mm.style.display !== 'none') {
                    // adresát mezitím mohl z firmy zmizet → spadni zpátky na „všem"
                    if (_to && !firmUsers().some(function (x) { return x.id === _to; })) _to = '';
                    renderTo();
                }
            });
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'firma-chat:open'); }
        if (_poll) clearInterval(_poll);
        _poll = setInterval(function () {
            var mm = document.getElementById('agch-modal');
            if (!mm || mm.style.display === 'none') { close(); return; }
            if (document.hidden) return;   // na pozadí nedotazovat (limit + baterie)
            load();
        }, POLL_MS);
    }

    function init() {
        if (!U()) return;
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'firma-chat', label: 'Firemní chat', icon: ICON, onClick: open, order: 89, cat: 'Pomůcky' });
        }
        setTimeout(startupCheck, 9000);
        // Prepnuti uzivatele/firmy musi vyhodit i to, co uz je v pameti — jinak by
        // dalsi prihlaseny videl zpravy predchoziho, dokud by se stranka nenacetla.
        function zapomen() {
            _msgs = []; _lastId = 0; _unread = 0;
            try { localStorage.removeItem(LS_CACHE); localStorage.removeItem(LS_READ); } catch (e) { }
            try { syncBadge(); } catch (e) { }
        }
        window.addEventListener('agucty:logout', function () { zapomen(); try { close(); } catch (e) { } });
        window.addEventListener('agucty:firmswitch', zapomen);
        window.addEventListener('agucty:login', function () { zapomen(); setTimeout(startupCheck, 2500); });
        // odznak nepřečtených je jen DOM; přes AG.uiInterval se uspí, když je appka na pozadí
        (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(syncBadge, 5000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 400); });
    else setTimeout(init, 400);

    window.AGFirmaChat = { open: open };
})();
