/* PŘIHLÁŠENÍ PŘES FACE ID — PASSKEY (25. 9. 2026, 7. hodnocení f1)
 *
 * Proč: dosavadní „Face ID“ v appce bylo jen místní zámek nad heslem uloženým v telefonu. Když
 * iPhone data appky smaže (odebrání ikony z plochy, 24. 9. to potkalo vlastníka), zmizelo přihlášení
 * i Face ID. Přístupový klíč (passkey) drží iPhone v Klíčence na iCloudu — přežije přeinstalaci
 * i nový telefon. Server (cloud/worker.js /passkey/*) ověří podpis a vydá stejné přihlášení jako heslo.
 *
 *   • Brána (js/ucty.js): tlačítko „Přihlásit přes Face ID“ → AGPasskey.prihlasit(api).
 *   • Po přihlášení heslem appka jednou nabídne zapnutí (AGPasskey.nabidni).
 *   • Nastavení → Účet a aplikace: karta #set-passkey (zapnout, stav).
 *   • Vlastník: když je v telefonu klíč vlastníka, pošle se při zapnutí na server; po přihlášení
 *     passkeyem ho server vrátí a appka ho uloží zpátky (vlastnický režim po přeinstalaci).
 *
 * Odpojitelné: smaž tento soubor, řádek <script type="ag/lazy">, kartu #set-passkey v index.html
 * a tlačítko #agg-pk v js/ucty.js (vše je obalené `if (window.AGPasskey)`).
 */
(function () {
    'use strict';
    if (window.AGPasskey) return;

    var LS = 'agPasskey_v1';            // { accId: { ts, owner } } — na tomhle telefonu je klíč zapnutý
    var LS_ASK = 'agPasskeyNabidka_v1';
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'passkey:' + kde); } catch (x) { /* nic */ } }
    function podpora() { return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get); }
    function b64u(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function dec(s) { s = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    function st() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
    function ulozSt(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { swallow(e, 'ls'); } }
    function ucet() { try { return window.AGUcty && AGUcty.ucet ? AGUcty.ucet() : null; } catch (e) { return null; } }
    function vlastnikKlic() { try { return localStorage.getItem('agVlastnik_v1') === '1' ? (localStorage.getItem('agFbKey_v1') || '') : ''; } catch (e) { return ''; } }
    function zarizeni() {
        var ua = String(navigator.userAgent || '');
        return (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'zařízení') + ' · ' + new Date().toLocaleDateString('cs-CZ');
    }
    function chyba(r, zaloha) { return new Error((r && r.data && r.data.error) || zaloha || ('HTTP ' + (r ? r.status : 0))); }
    function zrusenoUzivatelem(e) { return e && (e.name === 'NotAllowedError' || e.name === 'AbortError'); }

    // ---- zapnutí (registrace) ----
    function zapnout() {
        if (!podpora()) return Promise.reject(new Error(t('Tenhle telefon přihlášení přes Face ID (passkey) neumí.')));
        var u = ucet(); if (!u || !window.AGUcty) return Promise.reject(new Error(t('Nejdřív se přihlas ke svému účtu.')));
        return AGUcty.cloudFetch('/passkey/register/start', { method: 'POST', body: {} }).then(function (r) {
            if (!r || !r.ok || !r.data || !r.data.challenge) throw chyba(r, t('Server teď klíč nepřipravil — zkus to se signálem.'));
            var o = r.data;
            return navigator.credentials.create({ publicKey: {
                challenge: dec(o.challenge), rp: { id: o.rpId, name: 'QTRIG' },
                user: { id: dec(o.user.id), name: o.user.name, displayName: o.user.displayName },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
                authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
                excludeCredentials: (o.exclude || []).map(function (id) { return { type: 'public-key', id: dec(id) }; }),
                attestation: 'none', timeout: 60000
            } });
        }).then(function (cred) {
            var resp = cred.response;
            var pub = resp.getPublicKey ? resp.getPublicKey() : null;
            if (!pub) throw new Error(t('Tenhle prohlížeč neumí předat veřejný klíč — aktualizuj iOS nebo Chrome.'));
            var body = { id: cred.id, clientDataJSON: b64u(resp.clientDataJSON), publicKey: b64u(pub), alg: resp.getPublicKeyAlgorithm ? resp.getPublicKeyAlgorithm() : -7, name: zarizeni() };
            var ok = vlastnikKlic(); if (ok) body.ownerKey = ok;
            return AGUcty.cloudFetch('/passkey/register/finish', { method: 'POST', body: body });
        }).then(function (r) {
            if (!r || !r.ok) throw chyba(r);
            var s = st(); s[u.id] = { ts: Date.now(), owner: !!(r.data && r.data.owner) }; ulozSt(s);
            karta();
            return { ok: true, owner: !!(r.data && r.data.owner) };
        });
    }

    // ---- přihlášení ----
    function prihlasit(api) {
        if (!podpora()) return Promise.reject(new Error(t('Tenhle telefon přihlášení přes Face ID (passkey) neumí.')));
        var o = { method: 'POST', body: {} }; if (api) o.api = api;
        return AGUcty.cloudFetch('/passkey/login/start', o).then(function (r) {
            if (!r || !r.ok || !r.data || !r.data.challenge) throw chyba(r, t('Server není dosažitelný — přihlášení přes Face ID potřebuje internet.'));
            return navigator.credentials.get({ publicKey: { challenge: dec(r.data.challenge), rpId: r.data.rpId, userVerification: 'required', timeout: 60000 } });
        }).then(function (a) {
            var resp = a.response;
            var body = { id: a.id, clientDataJSON: b64u(resp.clientDataJSON), authenticatorData: b64u(resp.authenticatorData), signature: b64u(resp.signature) };
            var o2 = { method: 'POST', body: body }; if (api) o2.api = api;
            return AGUcty.cloudFetch('/passkey/login/finish', o2);
        }).then(function (r) {
            if (!r || !r.ok || !r.data || !r.data.token) throw chyba(r);
            AGUcty._adoptLogin(r.data, api, null);
            if (r.data.ucet && r.data.ucet.id) { var s = st(); s[r.data.ucet.id] = s[r.data.ucet.id] || { ts: Date.now() }; ulozSt(s); }
            if (r.data.ownerKey) {
                // vlastník: klíč zpátky do telefonu → vlastnický režim naběhne (bez psaní 24znakového klíče)
                try { localStorage.setItem('agFbKey_v1', r.data.ownerKey); localStorage.setItem('agVlastnik_v1', '1'); } catch (e) { swallow(e, 'owner'); }
                try { if (typeof quickToast === 'function') quickToast(t('Klíč vlastníka obnoven.')); } catch (e) { /* nic */ }
            }
            try { window.dispatchEvent(new CustomEvent('agucty:login', { detail: { user: r.data.user, passkey: true } })); } catch (e) { swallow(e, 'event'); }
            return r.data;
        }, function (e) {
            if (zrusenoUzivatelem(e)) throw new Error(t('Přihlášení přes Face ID bylo zrušené. Zkus to znovu, nebo použij heslo.'));
            throw e;
        });
    }

    // ---- nabídka po přihlášení heslem (1× za 30 dní, jen kde to telefon umí a klíč tu ještě není) ----
    function nabidni() {
        var u = ucet(); if (!u || !podpora() || st()[u.id]) return;
        var last = 0; try { last = +localStorage.getItem(LS_ASK) || 0; } catch (e) { last = 0; }
        if (Date.now() - last < 30 * 864e5) return;
        try { localStorage.setItem(LS_ASK, String(Date.now())); } catch (e) { swallow(e, 'ask'); }
        setTimeout(function () {
            var msg = t('Přihlašovat se příště přes Face ID?') + '\n\n' + t('Klíč uloží iPhone do Klíčenky na iCloudu — funguje i po přeinstalaci appky nebo na novém telefonu, bez hesla.');
            var ask = (typeof window.agAsk === 'function') ? agAsk(msg, { okText: t('Zapnout') }) : Promise.resolve(confirm(msg));
            ask.then(function (ano) {
                if (!ano) return;
                zapnout().then(function (v) {
                    try { if (typeof quickToast === 'function') quickToast(v.owner ? t('Face ID zapnuté — i pro vlastníka.') : t('Face ID zapnuté. Příště stačí jedno klepnutí.')); } catch (e) { /* nic */ }
                }, function (e) { if (!zrusenoUzivatelem(e)) (window.agInfo || alert)(t('Face ID se nepodařilo zapnout:') + ' ' + ((e && e.message) || e)); });
            });
        }, 1500);
    }

    // ---- Nastavení → Účet a aplikace ----
    function karta() {
        var el = document.getElementById('set-passkey'); if (!el) return;
        var u = ucet();
        el.hidden = !(u && podpora());
        if (el.hidden) return;
        var s = st()[u.id], stav = el.querySelector('#set-passkey-stav'), b = el.querySelector('#set-passkey-zapnout');
        var txt = s ? (t('Zapnuto na tomhle telefonu') + (s.owner ? ' · ' + t('i pro vlastníka') : '')) : t('Zatím vypnuto.');
        if (stav._cs !== txt) { stav.textContent = txt; stav._cs = txt; }
        b.textContent = s ? t('Přidat klíč znovu') : t('Zapnout přihlášení přes Face ID');
        if (!b._pk) {
            b._pk = true;
            b.addEventListener('click', function () {
                b.disabled = true;
                zapnout().then(function (v) {
                    b.disabled = false;
                    try { if (typeof quickToast === 'function') quickToast(v.owner ? t('Face ID zapnuté — i pro vlastníka.') : t('Face ID zapnuté. Příště stačí jedno klepnutí.')); } catch (e) { /* nic */ }
                }, function (e) { b.disabled = false; if (!zrusenoUzivatelem(e)) (window.agInfo || alert)(t('Face ID se nepodařilo zapnout:') + ' ' + ((e && e.message) || e)); });
            });
        }
    }
    function start() { karta(); document.addEventListener('ag:nastaveni-strana', karta); window.addEventListener('agucty:login', function () { setTimeout(karta, 300); }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.AGPasskey = { podpora: podpora, zapnout: zapnout, prihlasit: prihlasit, nabidni: nabidni, karta: karta, _test: { b64u: b64u, dec: dec } };
})();
