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
    function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function fmtT(ts) { return new Date(ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); }
    function fmtDur(ms) { var m = Math.round(ms / 60000); return Math.floor(m / 60) + ':' + pad2(m % 60); }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
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
            '#agdo-modal .agdo-note{font:500 11.5px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:10px 0;}'
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
                if (ev.k === 'in') {
                    if (open) pairs.push(open);           // dvojí příchod — starý zůstane bez odchodu
                    open = { inTs: ev.ts, outTs: null };
                } else if (ev.k === 'out') {
                    if (open) { open.outTs = ev.ts; pairs.push(open); open = null; }
                    else pairs.push({ inTs: null, outTs: ev.ts });
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
            var html =
                '<div class="agdo-status' + (on ? ' on' : '') + '"><span class="agdo-dot"></span><div>' +
                (on ? '<b>V práci od ' + fmtT(d.open.inTs) + '</b><span>zatím ' + fmtDur(Date.now() - d.open.inTs) + ' h · ' + esc(me.name) + '</span>'
                    : '<b>Mimo práci</b><span>' + esc(me.name) + ' — píchni si příchod, až začneš</span>') +
                '</div></div>' +
                '<button type="button" class="agdo-big' + (on ? ' out' : '') + '" id="agdo-toggle">' + (on ? 'Odchod' : 'Příchod') + '</button>' +
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
                    html += '<div class="agdo-row"><span class="t">' +
                        (p.inTs ? fmtT(p.inTs) : '?') + ' → ' + (p.outTs ? fmtT(p.outTs) : (k === dayKey(Date.now()) ? 'teď' : 'chybí odchod')) +
                        '</span><span class="d">' + dur + '</span></div>';
                });
            });
            html += '<div class="agdo-note">Záznam funguje i bez signálu — odešle se, až bude internet. ' +
                'Tady vidíš záznamy z tohoto zařízení; přehled všech (i z jiných mobilů) má admin v administraci firmy. Orientační podklad, ne docházkový systém.</div>';
            body.innerHTML = html;
            body.querySelector('#agdo-toggle').onclick = function () {
                this.disabled = true;
                u.usageLog('shift', on ? 'out' : 'in');
                if (u.isCloud && u.isCloud()) setTimeout(function () { u.syncUsage(); }, 1200);
                setTimeout(render, 350);   // zápis do IndexedDB je asynchronní
            };
        });
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
            render();
        }, 60000);
    }

    function init() {
        if (!U()) return;
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'dochazka', label: 'Docházka', icon: ICON, onClick: open, order: 88, cat: 'Pomůcky' });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 400); });
    else setTimeout(init, 400);

    window.AGDochazka = { open: open };
})();
