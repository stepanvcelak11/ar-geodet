/* ZÁLOHA DO ÚČTU (25. 9. 2026, 6. hodnocení b1)
 *
 * PROČ: iOS smí data webové appky smazat — po ~7 dnech nepoužívání, a hlavně při odebrání
 * ikony z plochy (24. 9. to potkalo vlastníka: pryč přihlášení, Face ID i klíč). Ruční
 * záloha do souboru (js/zaloha.js) funguje, ale dělá ji málokdo. Firemní účty mají
 * synchronizaci bodů, jednotlivec neměl nic.
 *
 * CO TO DĚLÁ:
 *   • Kdo je přihlášený k účtu, tomu appka tiše pošle zálohu (body a nastavení, BEZ fotek
 *     a hlasovek) do účtu na serveru: jednou denně a po každých 20 nových bodech, jen se
 *     signálem, v klidu (requestIdleCallback). gzip + base64, nejvýš 1,5 MB; když se nevejde,
 *     vynechá největší položky databáze (typicky přílohy bodů) a řekne, co vynechal.
 *   • Server drží DVĚ poslední zálohy (cloud/worker.js /account/backup), nová přepíše starší.
 *   • Po přihlášení na PRÁZDNÉM telefonu (0 vlastních bodů) appka sama nabídne obnovu.
 *   • Karta v Nastavení → Záloha a údržba: stav, Zálohovat teď, Obnovit z účtu, vypínač.
 *   • Přihlašovací údaje v záloze nejsou (js/zaloha.js SECRET_KEYS) — patří telefonu.
 *
 * Odpojitelné: smaž tento soubor + řádek <script type="ag/lazy"> a kartu #ag-zu v index.html.
 */
(function () {
    'use strict';
    if (window.AGZalohaUcet) return;

    var LS = 'agZalohaUcet_v1';
    var MAX = 1500000;
    var DEN = 24 * 3600e3;
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'zaloha-ucet:' + kde); } catch (x) { /* nic */ } }
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function st() { try { var s = JSON.parse(localStorage.getItem(LS) || 'null'); return s && typeof s === 'object' ? s : {}; } catch (e) { return {}; } }
    function ulozSt(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { swallow(e, 'ls'); } }
    function ucet() { try { return (window.AGUcty && AGUcty.ucet && AGUcty.ucet()) || null; } catch (e) { return null; } }
    function pocet() { try { return persistentCustomPoints.length; } catch (e) { return 0; } }   // eslint-disable-line no-undef
    function verze() { try { return (typeof SHELL_VER !== 'undefined' && SHELL_VER) || (document.querySelector('script[src*="?v="]') || {}).src.split('?v=')[1] || ''; } catch (e) { return ''; } }   // eslint-disable-line no-undef
    function datum(ts) {
        try { return new Date(ts).toLocaleString((window.AGJazyk && AGJazyk.locale) ? AGJazyk.locale() : 'cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); }
        catch (e) { return new Date(ts).toISOString().slice(0, 16).replace('T', ' '); }
    }

    // ---- komprese ----
    function b64(buf) {
        var b = new Uint8Array(buf), s = '';
        for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(s);
    }
    function zabal(text) {
        if (!window.CompressionStream) return Promise.reject(new Error(t('Tenhle prohlížeč neumí kompresi — zálohu do účtu nejde poslat. Použij Stáhnout zálohu.')));
        var proud = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
        return new Response(proud).arrayBuffer().then(b64);
    }
    function rozbal(data) {
        var bin = atob(data), u = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        var proud = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Response(proud).text();
    }

    // ---- záloha ----
    var _bezi = null;
    function zalohuj(rucne) {
        if (_bezi) return _bezi;
        if (!ucet()) return Promise.resolve({ ok: false, msg: t('Nejsi přihlášený k účtu.') });
        if (!window.AGZaloha || !window.AGUcty || !AGUcty.cloudFetch) return Promise.resolve({ ok: false, msg: t('Záloha teď není k dispozici.') });
        var vynechano = [];
        _bezi = AGZaloha.sestav({ bezExtra: true, typ: 'ucet' }).then(function (p) {
            var pokus = function () {
                return zabal(JSON.stringify(p)).then(function (data) {
                    if (data.length <= MAX) return data;
                    // nevejde se: vynechat největší položku databáze bodů (přílohy, podklady)
                    var idb = p.idb || {}, nej = null, vel = -1;
                    Object.keys(idb).forEach(function (k) { var l = 0; try { l = JSON.stringify(idb[k]).length; } catch (e) { l = 0; } if (l > vel) { vel = l; nej = k; } });
                    if (!nej || vel < 2000) throw new Error(t('Záloha je i bez fotek moc velká pro účet. Použij Stáhnout zálohu (vše).'));
                    delete idb[nej]; vynechano.push(nej); p.vynechano = vynechano;
                    return pokus();
                });
            };
            return pokus();
        }).then(function (data) {
            return AGUcty.cloudFetch('/account/backup', { method: 'POST', timeoutMs: 60000,
                body: { data: data, body_n: pocet(), ver: verze(), dev: String(navigator.platform || '').slice(0, 40) } })
                .then(function (r) {
                    var s = st();
                    if (r && r.ok) { s.ts = Date.now(); s.n = pocet(); s.size = data.length; s.err = null; s.errTs = 0; s.vynechano = vynechano.length; }
                    else { s.err = (r && r.data && r.data.error) || (r && r.status ? 'HTTP ' + r.status : t('bez spojení')); s.errTs = Date.now(); }
                    ulozSt(s); karta();
                    return { ok: !!(r && r.ok), size: data.length, msg: s.err, vynechano: vynechano };
                });
        }).catch(function (e) {
            var s = st(); s.err = (e && e.message) || String(e); s.errTs = Date.now(); ulozSt(s); karta();
            return { ok: false, msg: s.err };
        }).then(function (v) { _bezi = null; return v; });
        return _bezi;
    }
    function potreba() {
        var s = st(), now = Date.now();
        if (s.vyp || !ucet() || !navigator.onLine) return false;
        if (s.errTs && now - s.errTs < 30 * 60e3) return false;          // po chybě půl hodiny klid
        if (!s.ts || now - s.ts > DEN) return true;
        return pocet() - (s.n || 0) >= 20;
    }
    function tik() {
        if (_bezi || !potreba()) return;
        var go = function () { zalohuj(false); };
        if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 15000 }); else setTimeout(go, 3000);
    }

    // ---- obnova ----
    function seznam() {
        if (!ucet() || !window.AGUcty) return Promise.resolve(null);
        return AGUcty.cloudFetch('/account/backup').then(function (r) { return r && r.ok ? (r.data.zalohy || []) : null; });
    }
    function obnov(slot) {
        return AGUcty.cloudFetch('/account/backup?slot=' + slot, { timeoutMs: 60000 }).then(function (r) {
            if (!r || !r.ok || !r.data || !r.data.data) throw new Error((r && r.data && r.data.error) || t('Zálohu se nepodařilo stáhnout — zkus to se signálem.'));
            return rozbal(r.data.data);
        }).then(function (txt) { return AGZaloha.obnov(JSON.parse(txt)); });
    }
    function ptejSeAObnov(z) {
        var msg = t('Obnovit zálohu z účtu?') + '\n\n' + datum(z.ts) + (z.body_n != null ? ' · ' + t('bodů:') + ' ' + z.body_n : '')
            + '\n\n' + t('Přepíše současné body a nastavení v tomhle telefonu a appka se znovu načte.');
        var ask = (typeof window.agAsk === 'function') ? agAsk(msg, { danger: true, okText: t('Obnovit') }) : Promise.resolve(confirm(msg));
        return ask.then(function (ok) {
            if (!ok) return false;
            try { if (typeof quickToast === 'function') quickToast(t('Obnovuji zálohu z účtu…')); } catch (e) { /* nic */ }
            return obnov(z.slot).catch(function (e) { (window.agAlert ? agAlert({ title: t('Obnova se nezdařila'), message: (e && e.message) || String(e) }) : agInfo(String(e))); return false; });
        });
    }
    // Po přihlášení na prázdném telefonu: nabídnout obnovu (nejvýš 1× za 3 dny)
    function nabidka() {
        if (!ucet() || pocet() > 0) return;
        var s = st(); if (s.nabidnutoTs && Date.now() - s.nabidnutoTs < 3 * DEN) return;
        seznam().then(function (z) {
            if (!z || !z.length || pocet() > 0) return;
            s = st(); s.nabidnutoTs = Date.now(); ulozSt(s);
            ptejSeAObnov(z[0]);
        }).catch(function (e) { swallow(e, 'nabidka'); });
    }

    // ---- karta v Nastavení → Záloha a údržba ----
    function karta() {
        var el = document.getElementById('ag-zu'); if (!el) return;
        var s = st(), u = ucet();
        var txt = el.querySelector('#ag-zu-stav');
        var b1 = el.querySelector('#ag-zu-ted'), b2 = el.querySelector('#ag-zu-obnov'), sw = el.querySelector('#ag-zu-auto');
        if (sw) sw.checked = !s.vyp;
        if (!u) { var n0 = t('Přihlas se k účtu a appka bude body zálohovat sama.'); if (txt._cs !== n0) { txt.textContent = n0; txt._cs = n0; } b1.disabled = true; b2.disabled = true; return; }
        b1.disabled = false; b2.disabled = false;
        var r = [];
        if (s.ts) r.push(t('Naposledy:') + ' ' + datum(s.ts) + ' · ' + Math.max(1, Math.round((s.size || 0) / 1024)) + ' kB' + (s.n != null ? ' · ' + t('bodů:') + ' ' + s.n : ''));
        else r.push(t('Zatím žádná záloha v účtu.'));
        if (s.vynechano) r.push(t('Vynechány velké přílohy — celou zálohu i s fotkami dá jen Stáhnout zálohu.'));
        if (s.err) r.push('⚠ ' + s.err);
        if (s.vyp) r.push(t('Automatická záloha je vypnutá.'));
        var nove = r.join(' · ');
        if (txt._cs !== nove) { txt.textContent = nove; txt._cs = nove; }   // jen při změně (jinak by v cizím jazyce problikl)
    }
    function napojKartu() {
        var el = document.getElementById('ag-zu'); if (!el || el._zu) return;
        el._zu = true;
        el.querySelector('#ag-zu-ted').addEventListener('click', function () {
            var b = this; b.disabled = true; var puv = b.textContent; b.textContent = t('Zálohuji…');
            zalohuj(true).then(function (v) {
                b.textContent = puv; b.disabled = false;
                try { if (typeof quickToast === 'function') quickToast(v.ok ? t('Záloha je v účtu.') : (t('Záloha se nezdařila:') + ' ' + (v.msg || ''))); } catch (e) { /* nic */ }
            });
        });
        el.querySelector('#ag-zu-obnov').addEventListener('click', function () {
            var b = this; b.disabled = true;
            seznam().then(function (z) {
                b.disabled = false;
                if (!z) { agInfo(t('Seznam záloh se nepodařilo načíst — zkus to se signálem.')); return; }
                if (!z.length) { agInfo(t('V účtu zatím žádná záloha není.')); return; }
                ptejSeAObnov(z[0]);
            });
        });
        el.querySelector('#ag-zu-auto').addEventListener('change', function () { var s = st(); s.vyp = !this.checked; ulozSt(s); karta(); if (!s.vyp) tik(); });
        karta();
    }

    function start() {
        napojKartu();
        setTimeout(tik, 20000);
        setInterval(tik, 5 * 60e3);
        setTimeout(nabidka, 6000);
        window.addEventListener('online', function () { setTimeout(tik, 5000); });
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') tik(); });
        // po přihlášení (účet se objeví) nabídnout obnovu / poslat první zálohu
        var mel = !!ucet();
        setInterval(function () { var ma = !!ucet(); if (ma && !mel) { setTimeout(nabidka, 1500); setTimeout(tik, 30000); } mel = ma; karta(); }, 4000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.AGZalohaUcet = { zalohuj: zalohuj, seznam: seznam, obnov: obnov, nabidka: nabidka, karta: karta,
        _test: { zabal: zabal, rozbal: rozbal, potreba: potreba, MAX: MAX } };
})();
