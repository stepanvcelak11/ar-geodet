// ============================================================================
// AR Geodet — DOCHÁZKA (ODPOJITELNÁ vrstva nad js/ucty.js)
// ----------------------------------------------------------------------------
// Jedno velké tlačítko Příchod/Odchod pro každého přihlášeného. Záznamy jdou
// STEJNOU cestou jako užívání (AGUcty.usageLog, typ 'shift', klíč 'in'/'out'):
//   • fungují offline (IndexedDB fronta, odešle se s internetem)
//   • v cloudu je vidí admin/vedení ze všech zařízení (záložka Docházka
//     v administraci, js/ucty-admin.js je páruje a počítá hodiny)
// Vlastní přehled (dnešek, tento týden, poslední dny) se čte z LOKÁLNÍCH
// záznamů zařízení — když si někdo píchne odchod na jiném mobilu, tady ho
// neuvidí (admin v přehledu ano). Je to orientační podklad pro výkazy.
//
// Vyžaduje firemní režim (js/ucty.js) a přihlášeného uživatele; bez nich se
// dlaždice neregistruje / ohlásí důvod. Odstranění: smaž js/dochazka.js
// + řádek <script> v index.html (a v sw.js).
// ============================================================================
(function () {
    'use strict';
    if (window.AGDochazka) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
    var STYLE_ID = 'ag-dochazka-style';

    function U() { return window.AGUcty || null; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    // klíč události: 'in|50.12345,14.67890|<meta>' — [0] směr, [1] hrubá poloha,
    // [2] volitelný detail směny (URI-encoded JSON {s:stavba, w:[s kým], c:činnost})
    function kDir(ev) { return String(ev.k || '').split('|')[0]; }
    function kMeta(ev) {
        var seg = String(ev.k || '').split('|')[2];
        if (!seg) return null;
        try {
            var m = JSON.parse(decodeURIComponent(seg));
            if (!m || typeof m !== 'object') return null;
            // normalizace (záznam mohl vzniknout jinde / v jiné verzi): s,c řetězce, w pole řetězců
            var out = {};
            if (m.s != null && typeof m.s !== 'object') out.s = String(m.s);
            if (m.c != null && typeof m.c !== 'object') out.c = String(m.c);
            if (Array.isArray(m.w)) out.w = m.w.map(function (x) { return String(x); });
            return (out.s || out.c || (out.w && out.w.length)) ? out : null;
        } catch (e) { return null; }
    }
    // detail směny -> segment klíče; drží se pod ~450 znaky (server ukládá max 500),
    // při přetečení se nejdřív krátí činnost, pak parta, nakonec se detail zahodí
    function encMeta(meta) {
        if (!meta) return '';
        var m = {};
        if (meta.s) m.s = String(meta.s).slice(0, 60);
        if (meta.w && meta.w.length) m.w = meta.w.slice(0, 8).map(function (x) { return String(x).slice(0, 30); });
        if (meta.c) m.c = String(meta.c).slice(0, 160);
        if (!m.s && !m.w && !m.c) return '';
        for (var i = 0; i < 6; i++) {
            var out = encodeURIComponent(JSON.stringify(m));
            if (out.length <= 450) return out;
            if (m.c && m.c.length > 20) m.c = m.c.slice(0, Math.floor(m.c.length / 2));
            else if (m.w && m.w.length) m.w = m.w.slice(0, Math.max(0, m.w.length - 2));
            else if (m.s) m.s = m.s.slice(0, 25);
            else break;
        }
        return '';
    }
    // poslední vyplněné hodnoty (předvyplnění dalšího píchnutí; jen toto zařízení)
    var LS_FORM = 'agDochazkaForm_v1';
    function lastForm() { try { return JSON.parse(localStorage.getItem(LS_FORM) || '{}') || {}; } catch (e) { return {}; } }
    function saveForm(o) { try { localStorage.setItem(LS_FORM, JSON.stringify(o)); } catch (e) {} }
    // název aktivní zakázky (globál `projects` ze zakazky.js; bez něj aspoň id)
    function activeProjName() {
        var id = null;
        try { id = localStorage.getItem('arActiveProjectId'); } catch (e) {}
        if (!id || id === 'default') return null;
        try {
            if (typeof projects !== 'undefined' && Array.isArray(projects)) {
                for (var i = 0; i < projects.length; i++) if (projects[i] && projects[i].id === id) return projects[i].name || id;
            }
        } catch (e) {}
        return id;
    }
    // hrubá poloha píchnutí (rychle a bez vysoké přesnosti; bez GPS se píchne bez ní)
    function quickPos(done) {
        var fired = false;
        function fin(sfx) { if (!fired) { fired = true; done(sfx); } }
        try {
            if (!navigator.geolocation) return fin('');
            var t = setTimeout(function () { fin(''); }, 2500);
            navigator.geolocation.getCurrentPosition(function (pos) {
                clearTimeout(t);
                fin('|' + pos.coords.latitude.toFixed(5) + ',' + pos.coords.longitude.toFixed(5));
            }, function () { clearTimeout(t); fin(''); }, { enableHighAccuracy: false, timeout: 2200, maximumAge: 120000 });
        } catch (e) { fin(''); }
    }
    function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function fmtT(ts) { return new Date(ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); }
    function fmtDur(ms) { var m = Math.round(ms / 60000); return Math.floor(m / 60) + ':' + pad2(m % 60); }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // rozložení: sloupec + rolující tělo (jinak se obsah hroutil a tlačítka skákala)
            '#agdo-modal .modal-content{display:flex;flex-direction:column;}',
            '#agdo-modal .modal-body{min-height:0;}',
            '#agdo-modal .agdo-status{display:flex;align-items:center;gap:12px;background:var(--glass-bg,rgba(255,255,255,0.04));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));border-radius:15px;padding:14px;margin:10px 0;}',
            '#agdo-modal .agdo-dot{width:12px;height:12px;border-radius:50%;background:var(--text-muted,#9aa1ac);flex:none;}',
            '#agdo-modal .agdo-status.on .agdo-dot{background:var(--accent,#2f9e74);box-shadow:0 0 10px var(--accent,#2f9e74);}',
            '#agdo-modal .agdo-status b{font:700 15px/1.3 var(--font-ui,system-ui);color:var(--text,#e6e8eb);display:block;}',
            '#agdo-modal .agdo-status span{font:500 12px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#agdo-modal .agdo-big{width:100%;border:none;border-radius:14px;padding:17px;font:700 16px/1 var(--font-ui,system-ui);color:#fff;cursor:pointer;',
            '  background:linear-gradient(150deg,var(--accent,#2f9e74),rgba(0,0,0,0.22)) var(--accent,#2f9e74);',
            '  box-shadow:0 6px 18px var(--accent-soft,rgba(47,158,116,0.3)),inset 0 1px 0 rgba(255,255,255,0.22);transition:transform .12s ease;}',
            '#agdo-modal .agdo-big:active{transform:scale(.97);}',
            '#agdo-modal .agdo-big.out{background:linear-gradient(150deg,#c05b54,rgba(0,0,0,0.22)) #c05b54;box-shadow:0 6px 18px rgba(192,91,84,0.3),inset 0 1px 0 rgba(255,255,255,0.22);}',
            '#agdo-modal .agdo-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0 4px;}',
            '#agdo-modal .agdo-card{background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.09));',
            '  border-radius:13px;padding:11px 12px;border-top:2px solid var(--accent-soft,rgba(47,158,116,0.35));}',
            '#agdo-modal .agdo-card b{display:block;font:800 20px/1.2 var(--font-display,system-ui);color:var(--text,#e6e8eb);}',
            '#agdo-modal .agdo-card span{font:600 10.5px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#agdo-modal .agdo-day{font:700 12px/1 var(--font-ui,system-ui);color:var(--text,#e6e8eb);margin:13px 0 3px;}',
            '#agdo-modal .agdo-row{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.07));',
            '  font:500 12.5px/1.3 var(--font-ui,system-ui);color:var(--text,#e6e8eb);}',
            '#agdo-modal .agdo-row .t{flex:1;}',
            '#agdo-modal .agdo-row .d{font-weight:700;}',
            '#agdo-modal .agdo-note{font:500 11.5px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:10px 0;}',
            // detail směny pod řádkem rozpisu (stavba / parta / činnost)
            '#agdo-modal .agdo-sub{font:500 11px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);padding:0 4px 8px;',
            '  border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.07));margin-top:-4px;}',
            '#agdo-modal .agdo-row.hasmeta{border-bottom:none;}',
            // formulář píchnutí (stavba, parta, činnost)
            '#agdo-modal label.agdo-lb{display:block;font:600 12px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:12px 0 4px;}',
            '#agdo-modal input[type=text],#agdo-modal textarea{width:100%;box-sizing:border-box;background:var(--glass-bg,rgba(255,255,255,0.06));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.16));border-radius:11px;color:var(--text,#e6e8eb);padding:11px 12px;',
            '  font:500 14px/1.3 var(--font-ui,system-ui);outline:none;transition:border-color .15s ease;}',
            '#agdo-modal input:focus,#agdo-modal textarea:focus{border-color:var(--accent,#2f9e74);}',
            '#agdo-modal textarea{resize:none;height:74px;}',
            '#agdo-modal .agdo-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;}',
            '#agdo-modal .agdo-chip{border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:var(--glass-bg,rgba(255,255,255,0.04));',
            '  color:var(--text-muted,#9aa1ac);border-radius:999px;padding:8px 13px;font:600 12.5px/1 var(--font-ui,system-ui);cursor:pointer;',
            '  transition:color .15s ease,border-color .15s ease,background .15s ease;}',
            '#agdo-modal .agdo-chip.on{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.14));color:var(--accent,#2f9e74);}',
            '#agdo-modal .agdo-back{width:100%;margin-top:8px;border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:transparent;',
            '  color:var(--text-muted,#9aa1ac);border-radius:14px;padding:12px;font:600 13px/1 var(--font-ui,system-ui);cursor:pointer;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function ensureModal() {
        var m = document.getElementById('agdo-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'agdo-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Docházka</h3>' +
            '  <div class="modal-body" id="agdo-body" style="flex:1;overflow-y:auto;"></div>' +
            '  <button class="btn btn-secondary" style="margin-top:12px;" onclick="document.getElementById(\'agdo-modal\').style.display=\'none\'">Zavřít</button>' +
            '</div>';
        document.body.appendChild(m);
        return m;
    }

    // moje lokální směny za posledních 14 dní -> {open, pairs[], todayMs, weekMs}
    function loadMine() {
        var u = U();
        var me = u && u.currentUser();
        if (!u || !me) return Promise.resolve(null);
        var from = Date.now() - 14 * 864e5;
        return u.usageQuery(from).then(function (evs) {
            var mine = evs.filter(function (ev) { return ev.t === 'shift' && ev.uid === me.id; })
                .sort(function (a, b) { return a.ts - b.ts; });
            var pairs = [], open = null;
            mine.forEach(function (ev) {
                var dir = kDir(ev);
                if (dir === 'in') {
                    if (open) pairs.push(open);           // dvojí příchod — starý zůstane bez odchodu
                    open = { inTs: ev.ts, outTs: null, inMeta: kMeta(ev), outMeta: null };
                } else if (dir === 'out') {
                    if (open) { open.outTs = ev.ts; open.outMeta = kMeta(ev); pairs.push(open); open = null; }
                    else pairs.push({ inTs: null, outTs: ev.ts, inMeta: null, outMeta: kMeta(ev) });
                }
            });
            var now = Date.now();
            var tKey = dayKey(now);
            var weekFrom = now - 7 * 864e5;
            var todayMs = 0, weekMs = 0;
            function addDur(startTs, endTs) {
                var ms = Math.max(0, endTs - startTs);
                if (dayKey(startTs) === tKey) todayMs += ms;
                if (startTs >= weekFrom) weekMs += ms;
            }
            pairs.forEach(function (p) { if (p.inTs && p.outTs) addDur(p.inTs, p.outTs); });
            if (open) addDur(open.inTs, now);
            return { open: open, pairs: pairs, todayMs: todayMs, weekMs: weekMs };
        });
    }

    var _timer = null;
    function render() {
        var body = document.getElementById('agdo-body');
        if (!body) return;
        var u = U();
        var me = u && u.currentUser();
        if (!me) { body.innerHTML = '<div class="agdo-note">Docházka funguje jen s přihlášeným uživatelem (firemní režim).</div>'; return; }
        loadMine().then(function (d) {
            if (!d) return;
            var on = !!d.open;
            var proj = activeProjName();
            var im = on ? (d.open.inMeta || {}) : {};
            var statusSub = on
                ? ('zatím ' + fmtDur(Date.now() - d.open.inTs) + ' h · ' + esc(me.name) +
                    (im.s ? '<br>🏗 ' + esc(im.s) : '') +
                    (im.w && im.w.length ? '<br>👷 s: ' + esc(im.w.join(', ')) : ''))
                : (esc(me.name) + ' — píchni si příchod, až začneš');
            var html =
                '<div class="agdo-status' + (on ? ' on' : '') + '"><span class="agdo-dot"></span><div>' +
                (on ? '<b>V práci od ' + fmtT(d.open.inTs) + '</b><span>' + statusSub + '</span>'
                    : '<b>Mimo práci</b><span>' + statusSub + '</span>') +
                '</div></div>' +
                '<button type="button" class="agdo-big' + (on ? ' out' : '') + '" id="agdo-toggle">' + (on ? 'Odchod' : 'Příchod') +
                (!on && proj ? ' <span style="font-weight:500;opacity:.85;">· ' + esc(String(proj).slice(0, 24)) + '</span>' : '') + '</button>' +
                (!on && proj ? '<div class="agdo-note" style="margin-top:6px;">Příchod se zapíše k aktivní zakázce — hodiny pak admin vidí i po zakázkách.</div>' : '') +
                '<div class="agdo-cards">' +
                '  <div class="agdo-card"><b>' + fmtDur(d.todayMs) + '</b><span>dnes (h)</span></div>' +
                '  <div class="agdo-card"><b>' + fmtDur(d.weekMs) + '</b><span>posledních 7 dní (h)</span></div>' +
                '</div>';

            // rozpis posledních dní (nejnovější nahoře), z tohoto zařízení
            var byDay = {};
            d.pairs.forEach(function (p) { var k = dayKey(p.inTs || p.outTs); (byDay[k] = byDay[k] || []).push(p); });
            if (d.open) { var ok = dayKey(d.open.inTs); (byDay[ok] = byDay[ok] || []).push(d.open); }
            var keys = Object.keys(byDay).sort().reverse();
            keys.forEach(function (k) {
                var parts = k.split('-');
                html += '<div class="agdo-day">' + parseInt(parts[2], 10) + '. ' + parseInt(parts[1], 10) + '.</div>';
                byDay[k].sort(function (a, b) { return (a.inTs || a.outTs) - (b.inTs || b.outTs); }).forEach(function (p) {
                    var dur = (p.inTs && p.outTs) ? fmtDur(p.outTs - p.inTs)
                        : (p.inTs && !p.outTs ? (k === dayKey(Date.now()) ? fmtDur(Date.now() - p.inTs) : '—') : '—');
                    // detail směny: stavba + parta z příchodu, činnost z odchodu
                    var mIn = p.inMeta || {}, mOut = p.outMeta || {};
                    var det = [];
                    if (mIn.s) det.push('🏗 ' + esc(mIn.s));
                    if (mIn.w && mIn.w.length) det.push('👷 s: ' + esc(mIn.w.join(', ')));
                    if (mOut.c) det.push('✏ ' + esc(mOut.c));
                    html += '<div class="agdo-row' + (det.length ? ' hasmeta' : '') + '"><span class="t">' +
                        (p.inTs ? fmtT(p.inTs) : '?') + ' → ' + (p.outTs ? fmtT(p.outTs) : (k === dayKey(Date.now()) ? 'teď' : 'chybí odchod')) +
                        '</span><span class="d">' + dur + '</span></div>' +
                        (det.length ? '<div class="agdo-sub">' + det.join(' · ') + '</div>' : '');
                });
            });
            html += '<div class="agdo-note">Záznam funguje i bez signálu — odešle se, až bude internet. ' +
                'Tady vidíš záznamy z tohoto zařízení; přehled všech (i z jiných mobilů) má admin v administraci firmy. Orientační podklad, ne docházkový systém.</div>';
            body.innerHTML = html;
            body.querySelector('#agdo-toggle').onclick = function () { renderForm(on); };
        });
    }

    // ------------------------------------------------------------------
    // Formulář píchnutí: příchod = stavba + s kým; odchod = co se dělalo.
    // Všechno je nepovinné — prázdný formulář píchne stejně jako dřív.
    // ------------------------------------------------------------------
    function renderForm(on) {
        var body = document.getElementById('agdo-body');
        var u = U();
        var me = u && u.currentUser();
        if (!body || !me) return;
        var last = lastForm();
        var f = u.getFirm() || {};
        // parta: kolegové z firmy (kromě mě a zablokovaných) jako přepínací štítky
        var mates = (f.users || []).filter(function (x) { return x && !x.disabled && x.id !== me.id; })
            .map(function (x) { return x.name; });
        var selW = {};
        (last.w || []).forEach(function (n) { selW[n] = true; });

        var html = '<div class="agdo-note" style="margin-top:4px;">' +
            (on ? 'Odchod — napiš, co se na stavbě dělalo (nepovinné, uvidí ho admin ve výkazu).'
                : 'Příchod — doplň stavbu a s kým jsi (nepovinné, předvyplní se příště).') + '</div>';
        if (!on) {
            var stavba = last.s || activeProjName() || '';
            html += '<label class="agdo-lb">Stavba / místo</label>' +
                '<input type="text" id="agdo-f-s" maxlength="60" placeholder="např. D35 Ostrov — hlavní trasa" value="' + esc(stavba) + '">';
            if (mates.length) {
                html += '<label class="agdo-lb">S kým jsi na stavbě</label><div class="agdo-chips">' +
                    mates.map(function (n) {
                        return '<button type="button" class="agdo-chip' + (selW[n] ? ' on' : '') + '" data-w="' + esc(n) + '">' + esc(n) + '</button>';
                    }).join('') + '</div>';
            }
            html += '<label class="agdo-lb">Další lidé (mimo firmu, odděl čárkou)</label>' +
                '<input type="text" id="agdo-f-wx" maxlength="120" placeholder="např. bagrista Franta" value="">';
        } else {
            html += '<label class="agdo-lb">Co se dělalo</label>' +
                '<textarea id="agdo-f-c" maxlength="160" placeholder="např. vytyčení obrubníků, kontrola pláně 2. úsek"></textarea>';
        }
        html += '<button type="button" class="agdo-big' + (on ? ' out' : '') + '" style="margin-top:14px;" id="agdo-go">' +
            (on ? 'Píchnout odchod' : 'Píchnout příchod') + '</button>' +
            '<button type="button" class="agdo-back" id="agdo-back">Zpět bez píchnutí</button>';
        body.innerHTML = html;

        body.querySelectorAll('.agdo-chip').forEach(function (ch) {
            ch.onclick = function () { this.classList.toggle('on'); };
        });
        body.querySelector('#agdo-back').onclick = render;
        body.querySelector('#agdo-go').onclick = function () {
            var meta = {};
            if (!on) {
                var s = (body.querySelector('#agdo-f-s') || { value: '' }).value.trim();
                var w = [];
                body.querySelectorAll('.agdo-chip.on').forEach(function (ch) { w.push(ch.getAttribute('data-w')); });
                ((body.querySelector('#agdo-f-wx') || { value: '' }).value || '').split(',').forEach(function (x) {
                    x = x.trim(); if (x) w.push(x);
                });
                if (s) meta.s = s;
                if (w.length) meta.w = w;
                saveForm({ s: s, w: w });
            } else {
                var c = (body.querySelector('#agdo-f-c') || { value: '' }).value.trim();
                if (c) meta.c = c;
            }
            this.disabled = true;
            this.textContent = on ? 'Zapisuji odchod…' : 'Zapisuji příchod…';
            // hrubá poloha píchnutí (štempl „kde"); bez GPS se zapíše bez ní
            quickPos(function (sfx) {
                var enc = encMeta(meta);
                // s detailem má klíč pevný tvar 'směr|poloha|meta' (poloha smí být prázdná)
                var key = (on ? 'out' : 'in') + (enc ? (sfx || '|') + '|' + enc : sfx);
                u.usageLog('shift', key);
                if (u.isCloud && u.isCloud()) setTimeout(function () { u.syncUsage(); }, 1200);
                setTimeout(render, 350);   // zápis do IndexedDB je asynchronní
            });
        };
    }

    function open() {
        var u = U();
        if (!u || !u.getFirm()) {
            try { if (typeof window.agAlert === 'function') return window.agAlert({ title: 'Docházka', message: 'Docházka funguje ve firemním režimu (Nástroje → Firma a účty).' }); } catch (e) {}
            alert('Docházka funguje ve firemním režimu (Nástroje → Firma a účty).');
            return;
        }
        var m = ensureModal();
        m.style.display = 'flex';
        render();
        // průběžné tikání času „v práci od…", jen dokud je modál otevřený
        if (_timer) clearInterval(_timer);
        _timer = setInterval(function () {
            var mm = document.getElementById('agdo-modal');
            if (!mm || mm.style.display === 'none') { clearInterval(_timer); _timer = null; return; }
            if (document.getElementById('agdo-go')) return;   // rozepsaný formulář nepřepisovat
            render();
        }, 60000);
    }

    // hlídání zapomenutého odchodu: při startu / po přihlášení zkontroluj,
    // jestli poslední můj záznam není příchod ze STARŠÍHO dne — nabídni doplnění
    var _checked = false;
    function checkForgotten() {
        if (_checked) return;
        var u = U();
        var me = u && u.currentUser();
        if (!me || !u.usageLogRaw) return;
        _checked = true;
        u.usageQuery(Date.now() - 7 * 864e5).then(function (evs) {
            var mine = evs.filter(function (ev) { return ev.t === 'shift' && ev.uid === me.id; })
                .sort(function (a, b) { return a.ts - b.ts; });
            if (!mine.length) return;
            var last = mine[mine.length - 1];
            if (kDir(last) !== 'in') return;
            if (dayKey(last.ts) === dayKey(Date.now())) return;   // dnešní směna běží — v pořádku
            var din = new Date(last.ts);
            agAskText('Z ' + din.toLocaleDateString('cs-CZ') + ' chybí odchod (příchod ' + fmtT(last.ts) + ').\n' +
                'Zadej čas odchodu (HH:MM) a doplní se zpětně; Zrušit = nechat bez odchodu.',
                { title: 'Chybí odchod', value: '17:00', okText: 'Doplnit' }).then(function (v) {
                if (!v) return;
                var m = /^(\d{1,2})[:.](\d{2})$/.exec(String(v).trim());
                if (!m) { agInfo('Času nerozumím — zadej např. 16:30.'); return; }
                var out = new Date(din.getFullYear(), din.getMonth(), din.getDate(), parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
                if (out.getTime() <= last.ts) { agInfo('Odchod musí být až po příchodu (' + fmtT(last.ts) + ').'); return; }
                u.usageLogRaw({ ts: out.getTime(), t: 'shift', k: 'out', uid: me.id, u: me.name, proj: last.proj });
                if (u.isCloud && u.isCloud()) setTimeout(function () { u.syncUsage(); }, 1500);
                try { if (typeof quickToast === 'function') quickToast('Odchod ' + String(v).trim() + ' doplněn.'); } catch (e) {}
            });
        });
    }

    function init() {
        if (!U()) return;
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'dochazka', label: 'Docházka', icon: ICON, onClick: open, order: 88, cat: 'Pomůcky' });
        }
        setTimeout(checkForgotten, 3500);
        window.addEventListener('agucty:login', function () { _checked = false; setTimeout(checkForgotten, 1500); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 400); });
    else setTimeout(init, 400);

    window.AGDochazka = { open: open };
})();
