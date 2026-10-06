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
 * OPRAVA FACE ID VLASTNÍKA (6. 10. 2026, „stále mi blbne přihlašování pomocí Face ID jakožto vlastník“):
 *   1) GESTO. iPhone pustí Face ID jen krátce po klepnutí. Dřív se po klepnutí nejdřív stahoval
 *      tenhle soubor a pak výzva ze serveru — na pomalém signálu gesto vypršelo a Safari žádost
 *      zamítl, jako by ji uživatel zrušil („Přihlášení přes Face ID bylo zrušené“). Teď se výzva
 *      (i podklady k zapnutí) stáhne PŘEDEM (predpriprav / pripravZapnuti) a klepnutí volá Face ID hned.
 *   2) VLASTNÍK BEZ ÚČTU. Vlastník se přihlašuje jménem VLASTNIK + klíčem, ne účtem, takže si passkey
 *      zapnout nemohl a jeho „Face ID“ bylo jen místní odemknutí, které po smazání dat appky zmizelo.
 *      zapnoutVlastnika() uloží klíč „QTRIG vlastník“ na server (/owner/passkey/*) i jako místní
 *      odemknutí (zlaté tlačítko funguje dál i bez signálu); po přeinstalaci stačí na bráně
 *      „Přihlásit přes Face ID“ a vybrat „QTRIG vlastník“.
 *   3) STARÉ MÍSTNÍ KLÍČE V NABÍDCE. iPhone ukládá i místní odemknutí do Klíčenky a nabízí je
 *      v seznamu („Vlastník aplikace“, jména lidí z firmy). Server je nezná → dřív „Tenhle klíč
 *      server nezná“. Teď appka takový klíč pozná (userHandle „ag:…“): vlastnický se uloženým
 *      klíčem odemkne rovnou, jinak řekne, který klíč vybrat.
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

    // ---- výzvy stažené předem (kvůli gestu, viz hlavička bod 1) ----
    // Server drží výzvu 5 minut; bereme ji jen do 4 minut stáří a jen jednou.
    var MAX_STARI = 4 * 60e3;
    var _vyzva = null;      // přihlášení: { ch, rpId, api, ts }
    var _reg = {};          // zapnutí: { ucet|vlastnik: { o, ts } }
    function cerstva(x) { return !!(x && Date.now() - x.ts < MAX_STARI); }
    function predpriprav(api) {
        if (!podpora() || !window.AGUcty) return Promise.resolve(false);
        if (cerstva(_vyzva) && _vyzva.api === (api || '')) return Promise.resolve(true);
        var o = { method: 'POST', body: {} }; if (api) o.api = api;
        return AGUcty.cloudFetch('/passkey/login/start', o).then(function (r) {
            if (!r || !r.ok || !r.data || !r.data.challenge) return false;
            _vyzva = { ch: r.data.challenge, rpId: r.data.rpId, api: api || '', ts: Date.now() };
            return true;
        }, function () { return false; });
    }
    function regFetch(kdo) {
        if (kdo === 'vlastnik') {
            var V = window.AGVlastnik, k = vlastnikKlic();
            if (!V || !V.ext || !V.ext.api || !k) return Promise.resolve(null);
            return V.ext.api('/owner/passkey/start', k, 12000, { method: 'POST', body: {} });
        }
        return AGUcty.cloudFetch('/passkey/register/start', { method: 'POST', body: {} });
    }
    function pripravZapnuti(kdo) {
        kdo = kdo || 'ucet';
        if (!podpora() || !window.AGUcty) return Promise.resolve(false);
        if (cerstva(_reg[kdo])) return Promise.resolve(true);
        return regFetch(kdo).then(function (r) {
            if (!r || !r.ok || !r.data || !r.data.challenge) { _reg[kdo] = null; return r || false; }
            _reg[kdo] = { o: r.data, ts: Date.now() };
            return true;
        }, function () { return false; });
    }
    function vytvorKlic(o) {
        return navigator.credentials.create({ publicKey: {
            challenge: dec(o.challenge), rp: { id: o.rpId, name: 'QTRIG' },
            user: { id: dec(o.user.id), name: o.user.name, displayName: o.user.displayName },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
            excludeCredentials: (o.exclude || []).map(function (id) { return { type: 'public-key', id: dec(id) }; }),
            attestation: 'none', timeout: 60000
        } });
    }
    // Face ID MUSÍ naskočit ve stejném kroku jako klepnutí: s připravenými podklady se create()
    // zavolá synchronně, jinak (podklady chybí) až po dotazu na server jako dřív.
    function sGestem(kdo) {
        var x = _reg[kdo]; _reg[kdo] = null;
        if (cerstva(x)) { try { return vytvorKlic(x.o); } catch (e) { return Promise.reject(e); } }
        return regFetch(kdo).then(function (r) {
            if (!r || !r.ok || !r.data || !r.data.challenge) throw chyba(r, t('Server teď klíč nepřipravil — zkus to se signálem.'));
            return vytvorKlic(r.data);
        });
    }
    function telo(cred) {
        var resp = cred.response;
        var pub = resp.getPublicKey ? resp.getPublicKey() : null;
        if (!pub) throw new Error(t('Tenhle prohlížeč neumí předat veřejný klíč — aktualizuj iOS nebo Chrome.'));
        return { id: cred.id, clientDataJSON: b64u(resp.clientDataJSON), publicKey: b64u(pub), alg: resp.getPublicKeyAlgorithm ? resp.getPublicKeyAlgorithm() : -7, name: zarizeni() };
    }

    // ---- zapnutí (registrace) ----
    function zapnout() {
        if (!podpora()) return Promise.reject(new Error(t('Tenhle telefon přihlášení přes Face ID (passkey) neumí.')));
        var u = ucet(); if (!u || !window.AGUcty) return Promise.reject(new Error(t('Nejdřív se přihlas ke svému účtu.')));
        return sGestem('ucet').then(function (cred) {
            var body = telo(cred);
            var ok = vlastnikKlic(); if (ok) body.ownerKey = ok;
            return AGUcty.cloudFetch('/passkey/register/finish', { method: 'POST', body: body });
        }).then(function (r) {
            if (!r || !r.ok) throw chyba(r);
            var s = st(); s[u.id] = { ts: Date.now(), owner: !!(r.data && r.data.owner) }; ulozSt(s);
            karta();
            return { ok: true, owner: !!(r.data && r.data.owner) };
        });
    }

    // ---- zapnutí pro vlastníka (bez účtu; viz hlavička bod 2) ----
    // Klíč „QTRIG vlastník“: na serveru (přežije přeinstalaci) + jako místní odemknutí pro zlaté
    // tlačítko na bráně (js/vlastnik.js — ověří jen telefon, jde i bez signálu).
    function zapnoutVlastnika() {
        if (!podpora()) return Promise.reject(new Error(t('Tenhle telefon přihlášení přes Face ID (passkey) neumí.')));
        var k = vlastnikKlic(); if (!k || !window.AGVlastnik || !AGVlastnik.ext) return Promise.reject(new Error(t('Nejdřív se přihlas jako vlastník (jméno VLASTNIK a klíč).')));
        var id = null;
        return sGestem('vlastnik').then(function (cred) {
            id = cred.id;
            return AGVlastnik.ext.api('/owner/passkey/finish', k, 15000, { method: 'POST', body: telo(cred) });
        }).then(function (r) {
            if (!r || !r.ok) throw chyba(r);
            try { if (window.AGUcty && AGUcty.bio && AGUcty.bio.remember) AGUcty.bio.remember('vlastnik', id); } catch (e) { swallow(e, 'bio'); }
            var s = st(); s['!vlastnik'] = { ts: Date.now(), owner: true }; ulozSt(s);
            return { ok: true, owner: true };
        });
    }

    // pustit dovnitř jako vlastník; js/vlastnik.js je ag/lazy — na bráně hned po startu ještě nemusí být
    function vstupVlastnika() {
        var go = function () {
            try { if (window.AGVlastnik && AGVlastnik.vstup) AGVlastnik.vstup(); else if (window.AGUcty && AGUcty.ownerEnter) AGUcty.ownerEnter(); } catch (e) { swallow(e, 'vstup'); }
        };
        if (window.AGVlastnik || !window.AGLazy || !AGLazy.need) go(); else AGLazy.need('js/vlastnik.js', go);
    }
    // userHandle klíče z nabídky iPhonu: „ag:…“ = jen místní odemknutí (js/ucty.js bioEnroll), server ho nezná
    function handle(resp) {
        try { var u = new Uint8Array(resp.userHandle || []), x = ''; for (var i = 0; i < u.length; i++) x += String.fromCharCode(u[i]); return x; } catch (e) { return ''; }
    }
    function mistniKlic(h) {
        var k = ''; try { k = localStorage.getItem('agFbKey_v1') || ''; } catch (e) { k = ''; }
        if (h === 'ag:vlastnik' && k) {
            // vlastnické místní odemknutí a klíč vlastníka v telefonu je → telefon ověřil, pustit dovnitř
            try { localStorage.setItem('agVlastnik_v1', '1'); } catch (e) { swallow(e, 'owner'); }
            vstupVlastnika();
            return { owner: true, ownerOnly: true, mistni: true };
        }
        throw new Error(h === 'ag:vlastnik'
            ? t('Vybral jsi starý klíč „Vlastník aplikace“ — ten jen odemykal tenhle telefon a po smazání dat appky nestačí. Přihlas se jménem VLASTNIK a klíčem; appka pak nabídne nové Face ID, které přežije i přeinstalaci.')
            : t('Tenhle klíč jen odemyká telefon pro člověka z firmy — server ho nezná. V nabídce vyber klíč s kódem účtu, nebo se přihlas heslem.'));
    }

    // ---- přihlášení ----
    function overit(ch, rpId) {
        return navigator.credentials.get({ publicKey: { challenge: dec(ch), rpId: rpId, userVerification: 'required', timeout: 60000 } });
    }
    function prihlasit(api) {
        if (!podpora()) return Promise.reject(new Error(t('Tenhle telefon přihlášení přes Face ID (passkey) neumí.')));
        var o = { method: 'POST', body: {} }; if (api) o.api = api;
        var v = _vyzva; _vyzva = null;
        var krok;
        if (cerstva(v) && v.api === (api || '')) {
            // výzva je připravená → Face ID hned v gestu klepnutí (viz hlavička bod 1)
            try { krok = overit(v.ch, v.rpId); } catch (e) { krok = Promise.reject(e); }
        } else {
            krok = AGUcty.cloudFetch('/passkey/login/start', o).then(function (r) {
                if (!r || !r.ok || !r.data || !r.data.challenge) throw chyba(r, t('Server není dosažitelný — přihlášení přes Face ID potřebuje internet.'));
                return overit(r.data.challenge, r.data.rpId);
            });
        }
        var mistni = null, credId = null;
        return krok.then(function (a) {
            var resp = a.response;
            credId = a.id;
            var h = handle(resp);
            if (h.indexOf('ag:') === 0) { mistni = mistniKlic(h); return null; }
            var body = { id: a.id, clientDataJSON: b64u(resp.clientDataJSON), authenticatorData: b64u(resp.authenticatorData), signature: b64u(resp.signature) };
            var o2 = { method: 'POST', body: body }; if (api) o2.api = api;
            return AGUcty.cloudFetch('/passkey/login/finish', o2);
        }).then(function (r) {
            if (mistni) return mistni;
            if (r && r.ok && r.data && r.data.ownerOnly && r.data.ownerKey) {
                // klíč „QTRIG vlastník“ (bez účtu): klíč zpátky do telefonu a vstoupit jako vlastník
                try { localStorage.setItem('agFbKey_v1', r.data.ownerKey); localStorage.setItem('agVlastnik_v1', '1'); } catch (e) { swallow(e, 'owner'); }
                var s0 = st(); s0['!vlastnik'] = s0['!vlastnik'] || { ts: Date.now(), owner: true }; ulozSt(s0);
                // tentýž klíč jako místní odemknutí → zlaté tlačítko na bráně příště i bez signálu
                try { if (window.AGUcty && AGUcty.bio && AGUcty.bio.remember) AGUcty.bio.remember('vlastnik', credId); } catch (e) { swallow(e, 'bio'); }
                vstupVlastnika();
                try { if (typeof quickToast === 'function') quickToast(t('Přihlášen jako vlastník.')); } catch (e) { /* nic */ }
                return r.data;
            }
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
        }).then(null, function (e) {
            predpriprav(api);   // další pokus zase hned v gestu
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
        pripravZapnuti('ucet');
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
        pripravZapnuti('ucet');
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

    window.AGPasskey = { podpora: podpora, zapnout: zapnout, prihlasit: prihlasit, nabidni: nabidni, karta: karta,
        predpriprav: predpriprav, pripravZapnuti: pripravZapnuti, zapnoutVlastnika: zapnoutVlastnika,
        _test: { b64u: b64u, dec: dec, mistniKlic: mistniKlic, vyzva: function () { return _vyzva; }, reg: function () { return _reg; } } };
})();
