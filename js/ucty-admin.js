// ============================================================================
// AR Geodet — ADMINISTRACE FIRMY: uživatelé, oprávnění, dashboard užívání
// ----------------------------------------------------------------------------
// Nadstavba nad js/ucty.js (jádro účtů) — bez něj se modul tiše vypne.
// Vstup: dlaždice „Firma a účty" v Nástrojích (kategorie Pomůcky).
//   • firemní režim VYPNUT  -> průvodce: založit firmu v CLOUDU (funguje mezi
//     zařízeními, Cloudflare Worker z cloud/worker.js) / připojit zařízení
//     kódem firmy / LOKÁLNÍ režim (jen toto zařízení, bez serveru)
//   • admin                 -> plná administrace (4 sekce); v cloudu se změny
//     (uživatelé, oprávnění, název, auto-zámek) ukládají na server a propíší
//     se všem zařízením; dashboard čte užívání ze VŠECH zařízení
//   • vedení s oprávněním   -> jen Přehled užívání
// Navíc: tlačítko „Přepnout uživatele / zamknout" v menu Více (jen ve firemním
// režimu); v LOKÁLNÍM režimu export/import firmy souborem .argeofirma.json.
//
// Odstranění: smaž js/ucty-admin.js + řádek <script> v index.html (a v sw.js).
// ============================================================================
(function () {
    'use strict';
    if (window.AGUctyAdmin) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    var STYLE_ID = 'ag-uctyadm-style';

    function U() { return window.AGUcty || null; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function agConfirm(opts) {
        try { if (typeof window.agConfirm === 'function') return window.agConfirm(opts); } catch (e) {}
        return Promise.resolve(confirm((opts.title || '') + '\n\n' + String(opts.message || '').replace(/<[^>]*>/g, '')));
    }
    function roleTxt(r) { return r === 'admin' ? 'Admin' : (r === 'vedeni' ? 'Vedení' : 'Zaměstnanec'); }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#agfa-modal .agfa-nav{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 12px;}',
            '#agfa-modal .agfa-nav button{border:1px solid var(--glass-border,rgba(255,255,255,0.15));background:var(--glass-bg,rgba(255,255,255,0.05));',
            '  color:var(--text,#e6e8eb);border-radius:999px;padding:8px 14px;font:600 12.5px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '#agfa-modal .agfa-nav button.act{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.14));color:var(--accent,#2f9e74);}',
            '#agfa-modal .agfa-row{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.08));}',
            '#agfa-modal .agfa-row b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}',
            '#agfa-modal .agfa-chip{font:600 10.5px/1 var(--font-ui,system-ui);border-radius:999px;padding:4px 9px;background:var(--accent-soft,rgba(47,158,116,0.14));color:var(--accent,#2f9e74);white-space:nowrap;}',
            '#agfa-modal .agfa-mini{border:1px solid var(--glass-border,rgba(255,255,255,0.18));background:transparent;color:var(--text,#e6e8eb);',
            '  border-radius:9px;padding:6px 10px;font:600 12px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '#agfa-modal .agfa-mini.danger{color:var(--danger,#e5534b);border-color:rgba(229,83,75,0.4);}',
            '#agfa-modal label.agfa-lb{display:block;font:600 12px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:10px 0 4px;}',
            '#agfa-modal input[type=text],#agfa-modal input[type=password],#agfa-modal input[type=number],#agfa-modal select{width:100%;box-sizing:border-box;',
            '  background:var(--glass-bg,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.18));border-radius:10px;',
            '  color:var(--text,#e6e8eb);padding:10px 12px;font:500 14px/1.2 var(--font-ui,system-ui);}',
            '#agfa-modal .agfa-perm{display:flex;align-items:center;gap:10px;padding:7px 2px;}',
            '#agfa-modal .agfa-perm input{width:18px;height:18px;accent-color:var(--accent,#2f9e74);}',
            '#agfa-modal .agfa-pg{font:700 11px/1 var(--font-ui,system-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);margin:14px 0 4px;}',
            '#agfa-modal .agfa-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin:8px 0;}',
            '#agfa-modal .agfa-card{background:var(--glass-bg,rgba(255,255,255,0.05));border:1px solid var(--glass-border,rgba(255,255,255,0.1));border-radius:12px;padding:10px 12px;}',
            '#agfa-modal .agfa-card b{display:block;font:800 19px/1.2 var(--font-display,system-ui);color:var(--accent,#2f9e74);}',
            '#agfa-modal .agfa-card span{font:600 11px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#agfa-modal table.agfa-tbl{width:100%;border-collapse:collapse;font:500 12.5px/1.35 var(--font-ui,system-ui);}',
            '#agfa-modal table.agfa-tbl th{text-align:left;font:700 11px/1 var(--font-ui,system-ui);letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);padding:7px 6px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.15));}',
            '#agfa-modal table.agfa-tbl td{padding:7px 6px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.07));}',
            '#agfa-modal .agfa-note{font:500 12px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:8px 0;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ------------------------------------------------------------------
    // Kostra modálu (vlastní overlay ve stylu appky, fullscreen dle konvence)
    // ------------------------------------------------------------------
    function ensureModal() {
        var m = document.getElementById('agfa-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'agfa-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Firma a účty</h3>' +
            '  <div class="agfa-nav" id="agfa-nav"></div>' +
            '  <div class="modal-body" id="agfa-body" style="flex:1;overflow-y:auto;"></div>' +
            '  <button class="btn btn-secondary" style="margin-top:12px;" onclick="document.getElementById(\'agfa-modal\').style.display=\'none\'">Zavřít</button>' +
            '</div>';
        document.body.appendChild(m);
        return m;
    }
    function openModal(section) {
        var m = ensureModal();
        m.style.display = 'flex';
        renderNav(section || 'uzivatele');
    }

    var _section = 'uzivatele';
    function renderNav(sec) {
        _section = sec;
        var u = U(); if (!u) return;
        var admin = u.isAdmin();
        var nav = document.getElementById('agfa-nav');
        var items = [];
        if (admin) {
            items = [['uzivatele', 'Uživatelé'], ['opravneni', 'Oprávnění'], ['uzivani', 'Užívání'], ['firma', 'Firma']];
        } else {
            items = [['uzivani', 'Přehled užívání']];
            _section = 'uzivani';
        }
        nav.innerHTML = items.map(function (it) {
            return '<button type="button" data-s="' + it[0] + '" class="' + (it[0] === _section ? 'act' : '') + '">' + it[1] + '</button>';
        }).join('');
        nav.onclick = function (e) {
            var b = e.target.closest ? e.target.closest('button[data-s]') : null;
            if (b) renderNav(b.getAttribute('data-s'));
        };
        var body = document.getElementById('agfa-body');
        if (_section === 'uzivatele') renderUsers(body);
        else if (_section === 'opravneni') renderPerms(body);
        else if (_section === 'uzivani') renderUsage(body);
        else renderFirm(body);
    }

    // ------------------------------------------------------------------
    // Průvodce zřízením firmy (když je režim vypnutý): cloud / připojit / lokální
    // ------------------------------------------------------------------
    function openWizard() {
        var m = ensureModal();
        m.style.display = 'flex';
        document.getElementById('agfa-nav').innerHTML = '';
        var body = document.getElementById('agfa-body');
        body.innerHTML =
            '<div class="agfa-note">Firemní režim zapne <b>přihlašování uživatelů</b>, role s různými oprávněními ' +
            'a <b>přehled užívání</b> pro admina. Doporučená <b>cloud</b> varianta funguje mezi zařízeními ' +
            '(server Cloudflare, zdarma) — stejné účty na všech mobilech firmy. Lokální varianta žije jen v tomto zařízení.</div>' +
            '<button class="btn" style="width:100%;margin-top:8px;" id="agfa-w-cloud">Založit firmu v cloudu (více zařízení)</button>' +
            '<button class="btn" style="width:100%;margin-top:8px;" id="agfa-w-join">Připojit toto zařízení k firmě (mám kód)</button>' +
            '<button class="btn btn-secondary" style="width:100%;margin-top:8px;" id="agfa-w-local">Jen toto zařízení (bez cloudu)</button>';
        body.querySelector('#agfa-w-cloud').onclick = function () { wizardCloud(body); };
        body.querySelector('#agfa-w-join').onclick = function () { wizardJoin(body); };
        body.querySelector('#agfa-w-local').onclick = function () { wizardLocal(body); };
    }

    // ---- cloud: založení firmy na serveru -----------------------------
    function wizardCloud(body) {
        var u = U();
        body.innerHTML =
            '<div class="agfa-note">Založí firmu na serveru (Cloudflare, zdarma, bez karty). Dostaneš <b>kód firmy</b> — ' +
            'tím se pak přihlásí zaměstnanci na svých mobilech. Potřebuje internet.</div>' +
            '<label class="agfa-lb">Název firmy</label><input type="text" id="agfa-w-firm" placeholder="Geodetika s.r.o." maxlength="60">' +
            '<label class="agfa-lb">Tvoje jméno (admin)</label><input type="text" id="agfa-w-name" placeholder="Jan Novák" maxlength="40">' +
            '<label class="agfa-lb">Heslo admina (min. 4 znaky)</label><input type="password" id="agfa-w-pin" maxlength="64" placeholder="••••">' +
            '<label class="agfa-lb">Heslo znovu</label><input type="password" id="agfa-w-pin2" maxlength="64" placeholder="••••">' +
            '<button class="btn" style="margin-top:14px;width:100%;" id="agfa-w-go">Založit firmu</button>' +
            '<button class="btn btn-secondary" style="margin-top:8px;width:100%;" id="agfa-w-back">Zpět</button>';
        var prevName = '';
        try { prevName = localStorage.getItem('arSurveyor') || ''; } catch (e) {}
        if (prevName) body.querySelector('#agfa-w-name').value = prevName;
        body.querySelector('#agfa-w-back').onclick = function () { openWizard(); };
        body.querySelector('#agfa-w-go').onclick = function () {
            var firm = (body.querySelector('#agfa-w-firm').value || '').trim();
            var name = (body.querySelector('#agfa-w-name').value || '').trim();
            var p1 = body.querySelector('#agfa-w-pin').value || '';
            var p2 = body.querySelector('#agfa-w-pin2').value || '';
            if (!name) { agAlert('Chybí jméno', 'Zadej jméno administrátora.'); return; }
            if (p1.length < 4) { agAlert('Slabé heslo', 'Heslo musí mít aspoň 4 znaky.'); return; }
            if (p1 !== p2) { agAlert('Heslo nesouhlasí', 'Zadaná hesla se liší.'); return; }
            this.disabled = true; this.textContent = 'Zakládám…';
            var btn = this;
            u.cloudFetch('/firms', { method: 'POST', api: u.DEFAULT_API, body: { firmName: firm || 'Moje firma', adminName: name, password: p1 } })
                .then(function (r) {
                    btn.disabled = false; btn.textContent = 'Založit firmu';
                    if (!r.ok) {
                        agAlert('Založení selhalo', r.status === 0
                            ? 'Server není dosažitelný — zkontroluj internet.'
                            : esc((r.data && r.data.error) || ('Chyba ' + r.status)));
                        return;
                    }
                    u.adoptLogin(r.data, u.DEFAULT_API);
                    u.usageLog('login', 'setup');
                    wizardShowCode(body);
                });
        };
    }

    // po založení: velký kód firmy + poučení
    function wizardShowCode(body) {
        var u = U(), f = u.getFirm();
        body.innerHTML =
            '<div class="agfa-note">Firma <b>' + esc(f.firmName) + '</b> je založená a ty jsi přihlášený jako admin. ' +
            'Tohle je <b>kód firmy</b> — dej ho zaměstnancům:</div>' +
            '<div style="font:800 38px/1.2 var(--font-display,system-ui);letter-spacing:.18em;text-align:center;color:var(--accent,#2f9e74);margin:14px 0;user-select:all;">' + esc(f.code) + '</div>' +
            '<div class="agfa-note">Zaměstnanec na svém mobilu otevře Nástroje → <b>Firma a účty</b> → „Připojit toto zařízení k firmě" ' +
            'a zadá tento kód + své jméno a heslo (účet mu nejdřív založ v sekci Uživatelé).</div>' +
            '<button class="btn" style="margin-top:12px;width:100%;" id="agfa-w-next">Pokračovat do administrace</button>';
        body.querySelector('#agfa-w-next').onclick = function () { renderNav('uzivatele'); };
    }

    // ---- cloud: připojení zařízení kódem firmy -------------------------
    function wizardJoin(body) {
        var u = U();
        body.innerHTML =
            '<div class="agfa-note">Připojí tento mobil k existující firmě. Kód firmy ti dá admin; jméno a heslo ' +
            'máš od něj taky (admin ti účet založil v administraci). Potřebuje internet.</div>' +
            '<label class="agfa-lb">Kód firmy</label><input type="text" id="agfa-j-code" maxlength="6" placeholder="K7M2PX" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.15em;">' +
            '<label class="agfa-lb">Tvoje jméno</label><input type="text" id="agfa-j-name" maxlength="40" placeholder="Jan Novák">' +
            '<label class="agfa-lb">Heslo</label><input type="password" id="agfa-j-pass" maxlength="64" placeholder="••••">' +
            '<button class="btn" style="margin-top:14px;width:100%;" id="agfa-j-go">Připojit a přihlásit</button>' +
            '<button class="btn btn-secondary" style="margin-top:8px;width:100%;" id="agfa-j-back">Zpět</button>';
        body.querySelector('#agfa-j-back').onclick = function () { openWizard(); };
        body.querySelector('#agfa-j-go').onclick = function () {
            var code = (body.querySelector('#agfa-j-code').value || '').trim().toUpperCase();
            var name = (body.querySelector('#agfa-j-name').value || '').trim();
            var pass = body.querySelector('#agfa-j-pass').value || '';
            if (!code || !name || !pass) { agAlert('Chybí údaje', 'Vyplň kód firmy, jméno i heslo.'); return; }
            this.disabled = true; this.textContent = 'Připojuji…';
            var btn = this;
            u.cloudFetch('/login', { method: 'POST', api: u.DEFAULT_API, body: { code: code, name: name, password: pass } })
                .then(function (r) {
                    btn.disabled = false; btn.textContent = 'Připojit a přihlásit';
                    if (!r.ok) {
                        agAlert('Připojení selhalo', r.status === 0
                            ? 'Server není dosažitelný — zkontroluj internet.'
                            : esc((r.data && r.data.error) || ('Chyba ' + r.status)));
                        return;
                    }
                    u.adoptLogin(r.data, u.DEFAULT_API);
                    u.usageLog('login', 'join');
                    document.getElementById('agfa-modal').style.display = 'none';
                    agAlert('Zařízení připojeno', 'Jsi přihlášen jako <b>' + esc(r.data.user.name) + '</b> (' + roleTxt(r.data.user.role) + ') ve firmě <b>' + esc(r.data.config.firm.name) + '</b>.');
                });
        };
    }

    // ---- lokální režim (bez serveru) — původní průvodce -----------------
    function wizardLocal(body) {
        body.innerHTML =
            '<div class="agfa-note">Účty budou žít <b>jen v tomto zařízení</b> — žádný server. Na další mobily je přeneseš ' +
            'souborem v sekci Firma. Není to tvrdá bezpečnost, ale pořádek: kdo co měří, kdo co vidí.</div>' +
            '<label class="agfa-lb">Název firmy</label><input type="text" id="agfa-w-firm" placeholder="Geodetika s.r.o." maxlength="60">' +
            '<label class="agfa-lb">Tvoje jméno (admin)</label><input type="text" id="agfa-w-name" placeholder="Jan Novák" maxlength="40">' +
            '<label class="agfa-lb">PIN admina (4–8 číslic)</label><input type="password" id="agfa-w-pin" inputmode="numeric" maxlength="8" placeholder="••••">' +
            '<label class="agfa-lb">PIN znovu</label><input type="password" id="agfa-w-pin2" inputmode="numeric" maxlength="8" placeholder="••••">' +
            '<button class="btn" style="margin-top:14px;width:100%;" id="agfa-w-go">Zapnout firemní režim</button>' +
            '<button class="btn btn-secondary" style="margin-top:8px;width:100%;" id="agfa-w-back">Zpět</button>';
        var prevName = '';
        try { prevName = localStorage.getItem('arSurveyor') || ''; } catch (e) {}
        if (prevName) body.querySelector('#agfa-w-name').value = prevName;
        body.querySelector('#agfa-w-back').onclick = function () { openWizard(); };
        body.querySelector('#agfa-w-go').onclick = function () {
            var u = U(); if (!u) return;
            var firm = (body.querySelector('#agfa-w-firm').value || '').trim();
            var name = (body.querySelector('#agfa-w-name').value || '').trim();
            var pin = body.querySelector('#agfa-w-pin').value || '';
            var pin2 = body.querySelector('#agfa-w-pin2').value || '';
            if (!name) { agAlert('Chybí jméno', 'Zadej jméno administrátora.'); return; }
            if (!/^\d{4,8}$/.test(pin)) { agAlert('Neplatný PIN', 'PIN musí mít 4–8 číslic.'); return; }
            if (pin !== pin2) { agAlert('PIN nesouhlasí', 'Zadané PINy se liší.'); return; }
            var salt = u.makeSalt();
            u.hashPin(pin, salt).then(function (h) {
                var f = {
                    enabled: true,
                    firmName: firm || 'Moje firma',
                    createdTs: Date.now(),
                    autoLockMin: 0,
                    users: [{ id: 'u' + Date.now(), name: name, role: 'admin', salt: salt, pinHash: h, noPin: false }],
                    perms: u.defaultPerms()
                };
                u.saveFirm(f);
                try { localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: f.users[0].id, ts: Date.now() })); } catch (e) {}
                try { localStorage.setItem('arSurveyor', name); } catch (e) {}
                u.usageLog('login', 'setup');
                agAlert('Firemní režim zapnut', 'Jsi přihlášen jako admin <b>' + esc(name) + '</b>. Teď přidej uživatele a nastav oprávnění.');
                renderNav('uzivatele');
            });
        };
    }

    // ------------------------------------------------------------------
    // Sekce Uživatelé (cloud: CRUD na serveru, propíše se všem zařízením)
    // ------------------------------------------------------------------
    function renderUsers(body, refreshed) {
        var u = U(), f = u.getFirm(); if (!f) return;
        var me = u.currentUser();
        var cloud = !!f.cloud;
        // v cloudu si jednou stáhni čerstvý seznam (mohl se změnit jinde)
        if (cloud && !refreshed) {
            u.refreshConfig().then(function (ok) { if (ok && _section === 'uzivatele') renderUsers(body, true); });
        }
        var rows = f.users.map(function (us) {
            return '<div class="agfa-row" data-id="' + esc(us.id) + '">' +
                '<b>' + esc(us.name) + (me && me.id === us.id ? ' <span style="color:var(--text-muted);font-weight:500;">(ty)</span>' : '') + '</b>' +
                '<span class="agfa-chip">' + roleTxt(us.role) + (!cloud && us.noPin ? ' · bez PINu' : '') + '</span>' +
                '<button class="agfa-mini" data-act="edit">Upravit</button>' +
                '<button class="agfa-mini danger" data-act="del">Smazat</button>' +
                '</div>';
        }).join('');
        body.innerHTML =
            (cloud ? '<div class="agfa-note">Účty platí pro celou firmu — nový zaměstnanec se pak na svém mobilu přihlásí kódem firmy <b>' + esc(f.code || '') + '</b>, svým jménem a heslem.</div>' : '') +
            '<div id="agfa-userlist">' + rows + '</div>' +
            '<button class="btn" style="margin-top:12px;width:100%;" id="agfa-add">+ Přidat uživatele</button>' +
            '<div id="agfa-uform"></div>';
        body.querySelector('#agfa-add').onclick = function () { userForm(body, null); };
        body.querySelector('#agfa-userlist').onclick = function (e) {
            var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
            if (!btn) return;
            var id = btn.closest('.agfa-row').getAttribute('data-id');
            var us = null;
            for (var i = 0; i < f.users.length; i++) if (f.users[i].id === id) us = f.users[i];
            if (!us) return;
            if (btn.getAttribute('data-act') === 'edit') { userForm(body, us); return; }
            // smazání: nesmí zmizet poslední admin (server to hlídá taky)
            var admins = f.users.filter(function (x) { return x.role === 'admin'; });
            if (us.role === 'admin' && admins.length <= 1) {
                agAlert('Nelze smazat', 'Toto je poslední admin. Nejdřív udělej adminem někoho jiného, nebo vypni firemní režim v sekci Firma.');
                return;
            }
            agConfirm({ title: 'Smazat uživatele', message: 'Opravdu smazat účet <b>' + esc(us.name) + '</b>? Jeho záznamy v žurnálu a přehledu užívání zůstanou.', okText: 'Smazat', danger: true }).then(function (ok) {
                if (!ok) return;
                if (cloud) {
                    u.cloudFetch('/users/' + encodeURIComponent(us.id), { method: 'DELETE' }).then(function (r) {
                        if (!r.ok) { agAlert('Smazání selhalo', cloudErr(r)); return; }
                        u.adoptConfig(r.data);
                        if (me && me.id === us.id) { u.logout(); document.getElementById('agfa-modal').style.display = 'none'; return; }
                        renderUsers(body, true);
                    });
                    return;
                }
                f.users = f.users.filter(function (x) { return x.id !== us.id; });
                u.saveFirm(f);
                if (me && me.id === us.id) { u.logout(); document.getElementById('agfa-modal').style.display = 'none'; return; }
                renderUsers(body);
            });
        };
    }
    function cloudErr(r) {
        if (r.status === 0) return 'Server není dosažitelný — správa firmy potřebuje internet.';
        return esc((r.data && r.data.error) || ('Chyba ' + r.status));
    }
    function userForm(body, us) {
        var u = U(), f = u.getFirm(); if (!f) return;
        var cloud = !!f.cloud;
        var box = body.querySelector('#agfa-uform');
        var passLbl = cloud
            ? (us ? 'Nové heslo (nech prázdné = beze změny)' : 'Heslo (min. 4 znaky)')
            : (us ? 'Nový PIN (nech prázdné = beze změny)' : 'PIN (4–8 číslic; prázdné = bez PINu)');
        box.innerHTML =
            '<div style="border:1px solid var(--glass-border,rgba(255,255,255,0.15));border-radius:12px;padding:12px;margin-top:12px;">' +
            '<label class="agfa-lb">Jméno</label><input type="text" id="agfa-u-name" maxlength="40" value="' + esc(us ? us.name : '') + '">' +
            '<label class="agfa-lb">Role</label><select id="agfa-u-role">' +
            '  <option value="zamestnanec"' + (us && us.role === 'zamestnanec' ? ' selected' : '') + '>Zaměstnanec</option>' +
            '  <option value="vedeni"' + (us && us.role === 'vedeni' ? ' selected' : '') + '>Vedení</option>' +
            '  <option value="admin"' + (us && us.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
            '</select>' +
            '<label class="agfa-lb">' + passLbl + '</label>' +
            (cloud ? '<input type="password" id="agfa-u-pin" maxlength="64" placeholder="••••">'
                : '<input type="password" id="agfa-u-pin" inputmode="numeric" maxlength="8" placeholder="••••">') +
            '<div style="display:flex;gap:8px;margin-top:12px;">' +
            '  <button class="btn" style="flex:1;" id="agfa-u-save">' + (us ? 'Uložit změny' : 'Přidat') + '</button>' +
            '  <button class="btn btn-secondary" style="flex:1;" id="agfa-u-cancel">Zrušit</button>' +
            '</div></div>';
        box.querySelector('#agfa-u-cancel').onclick = function () { box.innerHTML = ''; };
        box.querySelector('#agfa-u-save').onclick = function () {
            var name = (box.querySelector('#agfa-u-name').value || '').trim();
            var role = box.querySelector('#agfa-u-role').value;
            var pin = box.querySelector('#agfa-u-pin').value || '';
            if (!name) { agAlert('Chybí jméno', 'Zadej jméno uživatele.'); return; }
            // degradace posledního admina (server v cloudu hlídá taky)
            if (us && us.role === 'admin' && role !== 'admin') {
                var admins = f.users.filter(function (x) { return x.role === 'admin'; });
                if (admins.length <= 1) { agAlert('Nelze změnit', 'Toto je poslední admin — nejdřív udělej adminem někoho jiného.'); return; }
            }
            var me = u.currentUser();
            if (cloud) {
                if (!us && pin.length < 4) { agAlert('Slabé heslo', 'Heslo musí mít aspoň 4 znaky.'); return; }
                if (us && pin && pin.length < 4) { agAlert('Slabé heslo', 'Heslo musí mít aspoň 4 znaky (nebo nech prázdné).'); return; }
                var req = us
                    ? u.cloudFetch('/users/' + encodeURIComponent(us.id), { method: 'PATCH', body: Object.assign({ name: name, role: role }, pin ? { password: pin } : {}) })
                    : u.cloudFetch('/users', { method: 'POST', body: { name: name, role: role, password: pin } });
                req.then(function (r) {
                    if (!r.ok) { agAlert(us ? 'Uložení selhalo' : 'Přidání selhalo', cloudErr(r)); return; }
                    u.adoptConfig(r.data);
                    if (us && me && me.id === us.id) { try { localStorage.setItem('arSurveyor', name); } catch (e) {} }
                    renderUsers(body, true);
                });
                return;
            }
            if (pin && !/^\d{4,8}$/.test(pin)) { agAlert('Neplatný PIN', 'PIN musí mít 4–8 číslic (nebo nech prázdné).'); return; }
            function finish(pinHash, salt, noPin) {
                if (us) {
                    us.name = name; us.role = role;
                    if (pin) { us.pinHash = pinHash; us.salt = salt; us.noPin = false; }
                } else {
                    f.users.push({ id: 'u' + Date.now() + Math.floor(Math.random() * 1000), name: name, role: role, pinHash: pinHash, salt: salt, noPin: noPin });
                }
                u.saveFirm(f);
                if (us && me && me.id === us.id) { try { localStorage.setItem('arSurveyor', name); } catch (e) {} }
                renderUsers(body);
            }
            if (pin) {
                var salt = u.makeSalt();
                u.hashPin(pin, salt).then(function (h) { finish(h, salt, false); });
            } else if (us) {
                finish(us.pinHash, us.salt, us.noPin);
            } else {
                finish(null, null, true);
            }
        };
    }

    // ------------------------------------------------------------------
    // Sekce Oprávnění (matice: co vidí vedení / zaměstnanec)
    // ------------------------------------------------------------------
    function renderPerms(body) {
        var u = U(), f = u.getFirm(); if (!f) return;
        var role = body.getAttribute('data-permrole') || 'zamestnanec';
        var perms = f.perms[role] || {};
        var html =
            '<div class="agfa-note">Admin vidí vždy vše. Tady firma určuje, co potřebuje <b>vedení</b> a co <b>zaměstnanci</b> — ' +
            'zbytek se v appce skryje (jednodušší obrazovka v terénu, méně omylů).</div>' +
            '<label class="agfa-lb">Role</label><select id="agfa-p-role">' +
            '  <option value="zamestnanec"' + (role === 'zamestnanec' ? ' selected' : '') + '>Zaměstnanec</option>' +
            '  <option value="vedeni"' + (role === 'vedeni' ? ' selected' : '') + '>Vedení</option>' +
            '</select>';
        var group = null;
        u.PERMS.forEach(function (p) {
            if (p.g !== group) { group = p.g; html += '<div class="agfa-pg">' + esc(group) + '</div>'; }
            var on = perms[p.k] !== false;
            html += '<label class="agfa-perm"><input type="checkbox" data-k="' + esc(p.k) + '"' + (on ? ' checked' : '') + '> ' + esc(p.t) + '</label>';
        });
        body.innerHTML = html;
        body.querySelector('#agfa-p-role').onchange = function () {
            body.setAttribute('data-permrole', this.value);
            renderPerms(body);
        };
        body.onchange = function (e) {
            var cb = e.target;
            if (!cb || cb.type !== 'checkbox' || !cb.getAttribute('data-k')) return;
            if (!f.perms[role]) f.perms[role] = {};
            f.perms[role][cb.getAttribute('data-k')] = cb.checked;
            if (f.cloud) {
                // uložit na server → propíše se všem zařízením; lokální cache hned
                u.saveFirm(f);
                u.cloudFetch('/config', { method: 'PUT', body: { perms: f.perms } }).then(function (r) {
                    if (!r.ok) {
                        agAlert('Změna se neuložila na server', cloudErr(r) + '<br><br>Na tomto zařízení platí, ale ostatní ji neuvidí — zopakuj ji s internetem.');
                    }
                });
                return;
            }
            u.saveFirm(f);
        };
    }

    // ------------------------------------------------------------------
    // Sekce Užívání (dashboard pro admina / vedení s oprávněním)
    // ------------------------------------------------------------------
    var _range = 7;   // dní zpět (1 = dnes)
    function renderUsage(body) {
        var u = U(), f = u.getFirm(); if (!f) return;
        body.innerHTML = '<div class="agfa-note">Načítám…</div>';
        var from = new Date();
        from.setHours(0, 0, 0, 0);
        if (_range > 1) from.setDate(from.getDate() - (_range - 1));
        var cloudNote = '';
        // cloud: nejdřív odešli lokální frontu, pak čti ze serveru (VŠECHNA zařízení);
        // bez signálu spadni na lokální záznamy tohoto zařízení
        var getEvents = (f.cloud
            ? u.syncUsage().then(function () {
                return u.cloudFetch('/usage?from=' + from.getTime()).then(function (r) {
                    if (r.ok && r.data && Array.isArray(r.data.events)) {
                        cloudNote = '<div class="agfa-note">Data ze všech zařízení firmy (server).</div>';
                        return r.data.events;
                    }
                    cloudNote = '<div class="agfa-note" style="color:var(--danger,#e5534b);">⚠ Server nedostupný — zobrazeny jen záznamy z tohoto zařízení.</div>';
                    return u.usageQuery(from.getTime());
                });
            })
            : u.usageQuery(from.getTime()));
        getEvents.then(function (evs) {
            var byUser = {}, tools = {}, logins = 0, ptAdd = 0, ptEdit = 0, ptDel = 0;
            evs.forEach(function (ev) {
                var b = byUser[ev.u] = byUser[ev.u] || { logins: 0, tools: 0, add: 0, edit: 0, del: 0, days: {}, first: ev.ts, last: ev.ts };
                if (ev.ts < b.first) b.first = ev.ts;
                if (ev.ts > b.last) b.last = ev.ts;
                b.days[new Date(ev.ts).toDateString()] = 1;
                if (ev.t === 'login') { b.logins++; logins++; }
                else if (ev.t === 'tool') { b.tools++; tools[ev.k || '?'] = (tools[ev.k || '?'] || 0) + 1; }
                else if (ev.t === 'pt-add') { b.add++; ptAdd++; }
                else if (ev.t === 'pt-edit') { b.edit++; ptEdit++; }
                else if (ev.t === 'pt-del') { b.del++; ptDel++; }
            });
            var topTools = Object.keys(tools).map(function (k) { return [k, tools[k]]; })
                .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);

            var html = cloudNote +
                '<label class="agfa-lb">Období</label><select id="agfa-d-range">' +
                '  <option value="1"' + (_range === 1 ? ' selected' : '') + '>Dnes</option>' +
                '  <option value="7"' + (_range === 7 ? ' selected' : '') + '>Posledních 7 dní</option>' +
                '  <option value="30"' + (_range === 30 ? ' selected' : '') + '>Posledních 30 dní</option>' +
                '  <option value="365"' + (_range === 365 ? ' selected' : '') + '>Poslední rok</option>' +
                '</select>' +
                '<div class="agfa-cards">' +
                '  <div class="agfa-card"><b>' + ptAdd + '</b><span>bodů přidáno</span></div>' +
                '  <div class="agfa-card"><b>' + (ptEdit + ptDel) + '</b><span>úprav / smazání</span></div>' +
                '  <div class="agfa-card"><b>' + logins + '</b><span>přihlášení</span></div>' +
                '  <div class="agfa-card"><b>' + Object.keys(byUser).length + '</b><span>aktivních lidí</span></div>' +
                '</div>';

            html += '<div class="agfa-pg">Podle uživatele</div><table class="agfa-tbl"><tr><th>Uživatel</th><th>Body +</th><th>Úpr.</th><th>Nástroje</th><th>Dní</th><th>Naposledy</th></tr>';
            Object.keys(byUser).sort().forEach(function (name) {
                var b = byUser[name];
                html += '<tr><td><b>' + esc(name) + '</b></td><td>' + b.add + '</td><td>' + (b.edit + b.del) + '</td><td>' + b.tools + '</td><td>' + Object.keys(b.days).length + '</td><td>' + new Date(b.last).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</td></tr>';
            });
            if (!Object.keys(byUser).length) html += '<tr><td colspan="6" style="color:var(--text-muted);">Zatím žádné záznamy ve zvoleném období.</td></tr>';
            html += '</table>';

            if (topTools.length) {
                html += '<div class="agfa-pg">Nejpoužívanější nástroje</div>';
                topTools.forEach(function (t) {
                    html += '<div class="agfa-row"><b>' + esc(t[0]) + '</b><span class="agfa-chip">' + t[1] + '×</span></div>';
                });
            }

            // diagnostika appky (jen admin): chyby + úložiště
            if (u.isAdmin()) {
                html += '<div class="agfa-pg">Diagnostika appky</div><div id="agfa-diag" class="agfa-note">…</div>' +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
                    '  <button class="agfa-mini" id="agfa-d-csv">Export CSV</button>' +
                    '  <button class="agfa-mini" id="agfa-d-err">Protokol chyb</button>' +
                    '  <button class="agfa-mini danger" id="agfa-d-clear">Smazat záznamy užívání</button>' +
                    '</div>';
            }
            body.innerHTML = html;

            body.querySelector('#agfa-d-range').onchange = function () { _range = parseInt(this.value, 10) || 7; renderUsage(body); };

            if (u.isAdmin()) {
                var diag = body.querySelector('#agfa-diag');
                var errN = 0;
                try { if (window.agErrLog && typeof agErrLog.list === 'function') errN = (agErrLog.list() || []).length; } catch (e) {}
                var diagTxt = 'Zachycených chyb: <b>' + errN + '</b>';
                try {
                    if (navigator.storage && navigator.storage.estimate) {
                        navigator.storage.estimate().then(function (est) {
                            var used = est.usage ? (est.usage / 1048576).toFixed(1) : '?';
                            var quota = est.quota ? (est.quota / 1048576).toFixed(0) : '?';
                            diag.innerHTML = diagTxt + ' · Úložiště: <b>' + used + ' MB</b> z ' + quota + ' MB';
                        });
                    } else diag.innerHTML = diagTxt;
                } catch (e) { diag.innerHTML = diagTxt; }

                body.querySelector('#agfa-d-csv').onclick = function () { exportCsv(evs); };
                body.querySelector('#agfa-d-err').onclick = function () {
                    try { if (window.agErrLog && typeof agErrLog.show === 'function') agErrLog.show(); else agAlert('Protokol chyb', 'Modul err-log.js není načtený.'); } catch (e) {}
                };
                body.querySelector('#agfa-d-clear').onclick = function () {
                    agConfirm({ title: 'Smazat záznamy užívání', message: 'Smaže VŠECHNY záznamy o užívání (nejen zvolené období)' + (f.cloud ? ' — na serveru i v tomto zařízení' : '') + '. Žurnál bodů zůstane.', okText: 'Smazat', danger: true }).then(function (ok) {
                        if (!ok) return;
                        var done = function () { try { localStorage.removeItem('agFirmaSync_v1'); } catch (e) {} u.usageClear().then(function () { renderUsage(body); }); };
                        if (f.cloud) {
                            u.cloudFetch('/usage', { method: 'DELETE' }).then(function (r) {
                                if (!r.ok) { agAlert('Smazání na serveru selhalo', cloudErr(r)); return; }
                                done();
                            });
                        } else done();
                    });
                };
            }
        });
    }
    function exportCsv(evs) {
        var lines = ['datum;cas;uzivatel;typ;klic;zakazka'];
        evs.forEach(function (ev) {
            var d = new Date(ev.ts);
            lines.push([d.toLocaleDateString('cs-CZ'), d.toLocaleTimeString('cs-CZ'), ev.u, ev.t, ev.k || '', ev.proj || '']
                .map(function (v) { return String(v).replace(/;/g, ','); }).join(';'));
        });
        dl(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'ar-geodet-uzivani.csv');
    }
    function dl(blob, name) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }

    // ------------------------------------------------------------------
    // Sekce Firma (název, auto-zámek, export/import, vypnutí)
    // ------------------------------------------------------------------
    function renderFirm(body) {
        var u = U(), f = u.getFirm(); if (!f) return;
        if (f.cloud) { renderFirmCloud(body, u, f); return; }
        body.innerHTML =
            '<label class="agfa-lb">Název firmy</label><input type="text" id="agfa-f-name" maxlength="60" value="' + esc(f.firmName || '') + '">' +
            '<label class="agfa-lb">Auto-zámek po nečinnosti (minuty; 0 = vypnuto)</label>' +
            '<input type="number" id="agfa-f-lock" min="0" max="480" step="1" value="' + (parseInt(f.autoLockMin, 10) || 0) + '">' +
            '<div class="agfa-pg">Přenos na další zařízení</div>' +
            '<div class="agfa-note">Export uloží účty (s PINy v podobě otisků, ne v čitelné podobě) a matici oprávnění do souboru ' +
            '<b>.argeofirma.json</b>. Ten naimportuješ na telefonech zaměstnanců — stejná firma, stejné účty, stejná pravidla. Body a zakázky se nepřenáší (na to je Přenos zakázky).</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '  <button class="agfa-mini" id="agfa-f-exp">Exportovat firmu</button>' +
            '  <button class="agfa-mini" id="agfa-f-imp">Importovat firmu</button>' +
            '  <input type="file" id="agfa-f-file" accept=".json,application/json" style="display:none;">' +
            '</div>' +
            '<div class="agfa-pg">Nebezpečná zóna</div>' +
            '<button class="agfa-mini danger" id="agfa-f-off">Vypnout firemní režim</button>' +
            '<div class="agfa-note">Vypnutí smaže účty a oprávnění na tomto zařízení. Body, zakázky, žurnál i záznamy užívání zůstanou.</div>';

        body.querySelector('#agfa-f-name').onchange = function () { f.firmName = (this.value || '').trim() || 'Moje firma'; u.saveFirm(f); };
        body.querySelector('#agfa-f-lock').onchange = function () { f.autoLockMin = Math.max(0, parseInt(this.value, 10) || 0); u.saveFirm(f); };

        body.querySelector('#agfa-f-exp').onclick = function () {
            var out = { format: 'argeofirma', v: 1, exportedTs: Date.now(), firm: f };
            dl(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), (f.firmName || 'firma').replace(/[^\w\-]+/g, '_') + '.argeofirma.json');
        };
        var fileInp = body.querySelector('#agfa-f-file');
        body.querySelector('#agfa-f-imp').onclick = function () { fileInp.click(); };
        fileInp.onchange = function () {
            var file = this.files && this.files[0];
            if (!file) return;
            var rd = new FileReader();
            rd.onload = function () {
                try {
                    var data = JSON.parse(rd.result);
                    if (!data || data.format !== 'argeofirma' || !data.firm || !Array.isArray(data.firm.users) || !data.firm.users.length) {
                        agAlert('Neplatný soubor', 'Tohle není export firmy (.argeofirma.json).'); return;
                    }
                    agConfirm({ title: 'Importovat firmu', message: 'Nahradí zdejší firemní nastavení firmou <b>' + esc(data.firm.firmName || '?') + '</b> (' + data.firm.users.length + ' uživatelů). Body a zakázky se nemění.', okText: 'Importovat' }).then(function (ok) {
                        if (!ok) return;
                        data.firm.enabled = true;
                        u.saveFirm(data.firm);
                        document.getElementById('agfa-modal').style.display = 'none';
                        u.logout();   // vynutí přihlášení pod novou firmou
                    });
                } catch (e) { agAlert('Chyba importu', 'Soubor se nepodařilo přečíst: ' + esc(e.message || e)); }
            };
            rd.readAsText(file);
            this.value = '';
        };

        body.querySelector('#agfa-f-off').onclick = function () {
            agConfirm({ title: 'Vypnout firemní režim', message: 'Přihlašování i oprávnění se zruší, appka bude zase otevřená. Body a zakázky zůstanou.', okText: 'Vypnout', danger: true }).then(function (ok) {
                if (!ok) return;
                try { localStorage.removeItem('agFirma_v1'); localStorage.removeItem('agFirmaSess_v1'); } catch (e) {}
                document.getElementById('agfa-modal').style.display = 'none';
                if (u.applyPerms) u.applyPerms();
                agAlert('Hotovo', 'Firemní režim je vypnutý.');
            });
        };
    }

    // ---- sekce Firma v CLOUD režimu -------------------------------------
    function renderFirmCloud(body, u, f) {
        body.innerHTML =
            '<div class="agfa-pg">Kód firmy (pro připojení dalších zařízení)</div>' +
            '<div style="font:800 34px/1.2 var(--font-display,system-ui);letter-spacing:.18em;text-align:center;color:var(--accent,#2f9e74);margin:10px 0;user-select:all;">' + esc(f.code || '?') + '</div>' +
            '<div class="agfa-note">Zaměstnanec na svém mobilu otevře Nástroje → <b>Firma a účty</b> → „Připojit toto zařízení k firmě" a zadá kód + jméno + heslo (účet mu založ v sekci Uživatelé).</div>' +
            '<label class="agfa-lb">Název firmy</label><input type="text" id="agfa-f-name" maxlength="60" value="' + esc(f.firmName || '') + '">' +
            '<label class="agfa-lb">Auto-zámek po nečinnosti (minuty; 0 = vypnuto) — platí pro všechna zařízení</label>' +
            '<input type="number" id="agfa-f-lock" min="0" max="480" step="1" value="' + (parseInt(f.autoLockMin, 10) || 0) + '">' +
            '<div class="agfa-pg">Server</div>' +
            '<div class="agfa-note">Firma běží na Cloudflare (free plán, 100 000 požadavků/den). Adresa API: <code style="word-break:break-all;">' + esc(f.api || u.DEFAULT_API) + '</code><br>Kód serveru je v repu appky ve složce <b>cloud/</b> — provoz nezávisí na žádné AI.</div>' +
            '<div class="agfa-pg">Nebezpečná zóna</div>' +
            '<button class="agfa-mini danger" id="agfa-f-detach">Odpojit toto zařízení od firmy</button>' +
            '<div class="agfa-note">Odpojení zruší přihlašování jen na TOMTO zařízení. Firma na serveru i ostatní mobily jedou dál. Body a zakázky zůstanou.</div>';

        function putCfg(patch, input, revert) {
            u.cloudFetch('/config', { method: 'PUT', body: patch }).then(function (r) {
                if (!r.ok) { agAlert('Uložení selhalo', cloudErr(r)); if (input) input.value = revert; return; }
                u.adoptConfig(r.data);
            });
        }
        var nameInp = body.querySelector('#agfa-f-name');
        nameInp.onchange = function () { putCfg({ firmName: (this.value || '').trim() || 'Moje firma' }, this, f.firmName); };
        var lockInp = body.querySelector('#agfa-f-lock');
        lockInp.onchange = function () { putCfg({ autoLockMin: Math.max(0, parseInt(this.value, 10) || 0) }, this, f.autoLockMin); };

        body.querySelector('#agfa-f-detach').onclick = function () {
            agConfirm({ title: 'Odpojit zařízení', message: 'Toto zařízení se odhlásí a zapomene firmu. Firma na serveru se NEmění — kdykoli se jde připojit znovu kódem. Body a zakázky zůstanou.', okText: 'Odpojit', danger: true }).then(function (ok) {
                if (!ok) return;
                try {
                    localStorage.removeItem('agFirma_v1');
                    localStorage.removeItem('agFirmaSess_v1');
                    localStorage.removeItem('agFirmaTok_v1');
                    localStorage.removeItem('agFirmaOff_v1');
                    localStorage.removeItem('agFirmaSync_v1');
                } catch (e) {}
                document.getElementById('agfa-modal').style.display = 'none';
                if (u.applyPerms) u.applyPerms();
                agAlert('Zařízení odpojeno', 'Appka je zase otevřená (bez přihlašování). Body a zakázky zůstaly.');
            });
        };
    }

    // ------------------------------------------------------------------
    // Vstupy do modulu: dlaždice v Nástrojích + tlačítko v menu Více
    // ------------------------------------------------------------------
    function openEntry() {
        var u = U();
        if (!u) { agAlert('Chybí jádro', 'Modul js/ucty.js není načtený.'); return; }
        var f = u.getFirm();
        if (!f) { openWizard(); return; }
        if (u.isAdmin()) { openModal('uzivatele'); return; }
        if (u.can('x.dashboard')) { openModal('uzivani'); return; }
        agAlert('Jen pro admina', 'Administraci firmy otevře administrátor. Ty se můžeš odhlásit nebo přepnout v menu Více.');
    }

    function syncMenuBtn() {
        var u = U(); if (!u) return;
        var f = u.getFirm();
        var btn = document.getElementById('agfa-switch-btn');
        var scroll = document.querySelector('#side-menu .menu-scroll');
        if (!f) { if (btn) btn.remove(); return; }
        if (!scroll || btn) return;
        btn = document.createElement('button');
        btn.id = 'agfa-switch-btn';
        btn.className = 'menu-btn';
        btn.innerHTML = '<svg class="icon"><use href="#i-users"/></svg> Přepnout uživatele / zamknout';
        btn.onclick = function () {
            try { if (typeof window.toggleMenu === 'function') toggleMenu(); } catch (e) {}
            var uu = U(); if (uu) uu.lock();
        };
        var hr = scroll.querySelector('hr');
        scroll.insertBefore(btn, hr || null);
    }

    function init() {
        if (!U()) return;   // jádro chybí -> nic neinjektovat
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'ucty-firma', label: 'Firma a účty', icon: ICON, onClick: openEntry, order: 90, cat: 'Pomůcky' });
        }
        syncMenuBtn();
        setInterval(syncMenuBtn, 3000);
        // dlaždici „Firma a účty" skrýt zaměstnancům (nemají v ní co dělat)
        window.addEventListener('agucty:perms', function () {
            try {
                var u = U(); if (!u || !u.getFirm()) return;
                var tile = document.querySelector('#tools-modal .tool-tile[data-tool="ucty-firma"]');
                if (tile && !u.isAdmin() && !u.can('x.dashboard')) tile.style.display = 'none';
            } catch (e) {}
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 400); });
    else setTimeout(init, 400);

    window.AGUctyAdmin = { open: openEntry };
})();
