// ===== QTRIG — KOUPĚ VERZE PRO (ODPOJITELNÁ vrstva, odložená) ===============
// Ceník, zkouška zdarma a platba QR kódem. Otevírá se z karty „Verze Pro"
// (js/pro-zamky.js) tlačítkem Koupit — ten soubor jede při startu a tohle ne,
// protože kupovat se chodí jednou, ne při každém spuštění.
//
// JAK SE PLATÍ: appka založí na serveru OBJEDNÁVKU (POST /objednavky) a dostane
// zpět variabilní symbol + řetězec „QR platba" (SPAYD). Ten se tady vykreslí
// jako QR kód knihovnou js/lib/qrcode.min.js (táž, co kreslí QR sdílení bodů)
// a člověk ho naskenuje bankovní appkou. Nic dalšího appka nedělá — peníze
// jdou napřímo na účet vlastníka, žádná brána, žádná karta.
//
// KDY SE PRO ROZSVÍTÍ: server platbu spáruje (sám z banky, nebo vlastník ručně)
// a nastaví tarif účtu. Appka se na /config ptá každou minutu, takže se zámky
// odemknou samy; tahle karta se navíc, dokud je otevřená, ptá každých 20 s na
// /objednavky/moje, aby člověk viděl „zaplaceno" hned.
//
// ⚠ CO KARTA SLIBUJE, MUSÍ SEDĚT S OBCHODNÍMI PODMÍNKAMI (podminky.html):
//   předplatné na dobu určitou, zapnutí hned po připsání, souhlas s okamžitým
//   plněním (tím zaniká právo spotřebitele odstoupit do 14 dnů — § 1837 písm. l
//   OZ). Texty tady neměnit bez změny tam.
//
// ⚠ ŽÁDNÉ ÚDAJE PRODEJCE V KÓDU: cena, účet i délka chodí ze serveru
//   (cloud/worker.js: prodejCfg) a cachují se v localStorage `agProdej_v1`,
//   aby karta uměla ukázat ceník i bez signálu.
//
// API (window.AGProKoupe): open(), close(), refresh()
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + './js/pro-koupe.js'
// v sw.js + tlačítko Koupit v js/pro-zamky.js (koupeRadek).
// ================================================================================
(function () {
    'use strict';
    if (window.AGProKoupe) return;

    var MODAL_ID = 'ag-koupe-modal';
    var STYLE_ID = 'ag-koupe-style';
    var LS = 'agProdej_v1';
    var LS_ACC = 'agUcet_v1';
    var POLL_MS = 20000;
    var PODMINKY = 'podminky.html';

    var _stav = null;        // poslední odpověď serveru {prodej, objednavky, tarif, tarifDo}
    var _vyber = 'rok';      // zvolený produkt
    var _busy = false;
    var _poll = null;
    var _hl = '';            // hláška pod tlačítky

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'pro-koupe:' + kde); } catch (x) { } }
    function esc(s) {
        if (window.AG && AG.esc) return AG.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function datum(ts) {
        if (!ts) return '';
        try { var d = new Date(ts); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear(); } catch (e) { return ''; }
    }
    function ucet() { try { return JSON.parse(localStorage.getItem(LS_ACC) || 'null'); } catch (e) { return null; } }
    function cache() { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; } }
    function ulozCache(d) { try { localStorage.setItem(LS, JSON.stringify({ prodej: d.prodej, objednavky: d.objednavky || [], ts: Date.now() })); } catch (e) { swallow(e, 'cache'); } }
    function online() { return navigator.onLine !== false; }
    function muzeServer() { return !!(window.AGUcty && AGUcty.cloudFetch && AGUcty.hasToken && AGUcty.hasToken()); }
    function api(path, opts) {
        if (!muzeServer()) return Promise.resolve({ ok: false, status: 0, data: null });
        return AGUcty.cloudFetch(path, opts || {});
    }

    // ---- vzhled ------------------------------------------------------------------
    function styly() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + MODAL_ID + '{position:fixed;inset:0;z-index:100065;display:none;align-items:center;justify-content:center;',
            '  padding:16px;background:rgba(0,0,0,.62);}',
            '#' + MODAL_ID + '.on{display:flex;}',
            '#' + MODAL_ID + ' .agk-box{width:min(440px,94vw);max-height:90vh;overflow:auto;border-radius:16px;',
            '  padding:18px 18px 16px;background:var(--modal-bg,#141a26);color:var(--text-color,#e9eef7);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,.12));box-shadow:0 18px 50px rgba(0,0,0,.5);',
            '  font-size:calc(13.5px * var(--ag-font-scale,1));line-height:1.45;}',
            'body.light-mode #' + MODAL_ID + ' .agk-box{background:#fff;color:#16202e;}',
            '#' + MODAL_ID + ' h2{margin:0 0 4px;font-size:calc(18px * var(--ag-font-scale,1));}',
            '#' + MODAL_ID + ' .agk-pod{margin:0 0 12px;opacity:.75;}',
            '#' + MODAL_ID + ' .agk-cenik{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:0 0 12px;}',
            '#' + MODAL_ID + ' .agk-pr{border:1.5px solid var(--glass-border,rgba(255,255,255,.16));border-radius:13px;padding:11px 10px;',
            '  text-align:center;cursor:pointer;background:transparent;color:inherit;font:inherit;position:relative;}',
            '#' + MODAL_ID + ' .agk-pr.on{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,.14));}',
            '#' + MODAL_ID + ' .agk-pr b{display:block;font-size:calc(19px * var(--ag-font-scale,1));margin:2px 0;}',
            '#' + MODAL_ID + ' .agk-pr small{display:block;opacity:.7;font-size:calc(11.5px * var(--ag-font-scale,1));}',
            '#' + MODAL_ID + ' .agk-pr .agk-tag{position:absolute;top:-9px;right:8px;background:var(--accent,#2f9e74);color:#fff;',
            '  border-radius:8px;padding:2px 7px;font-size:calc(10.5px * var(--ag-font-scale,1));font-weight:700;}',
            '#' + MODAL_ID + ' .agk-zk{width:100%;box-sizing:border-box;margin:0 0 12px;padding:11px;border-radius:11px;font:inherit;font-weight:600;',
            '  cursor:pointer;border:1.5px dashed var(--accent,#2f9e74);background:transparent;color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' label.agk-souhlas{display:flex;gap:9px;align-items:flex-start;margin:0 0 12px;opacity:.9;',
            '  font-size:calc(12.5px * var(--ag-font-scale,1));cursor:pointer;}',
            '#' + MODAL_ID + ' label.agk-souhlas input{margin:3px 0 0;flex:none;width:18px;height:18px;}',
            '#' + MODAL_ID + ' .agk-rada{display:flex;gap:9px;margin-top:10px;}',
            '#' + MODAL_ID + ' .agk-rada button{flex:1 1 0;padding:12px;border-radius:11px;font:inherit;font-weight:600;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,.16));background:transparent;color:inherit;}',
            '#' + MODAL_ID + ' .agk-rada button.hlavni{background:var(--accent,#2f9e74);border-color:transparent;color:#fff;}',
            '#' + MODAL_ID + ' .agk-rada button:disabled{opacity:.5;cursor:default;}',
            '#' + MODAL_ID + ' .agk-qr{text-align:center;margin:6px 0 10px;}',
            '#' + MODAL_ID + ' .agk-qr img{width:min(240px,70vw);image-rendering:pixelated;background:#fff;border-radius:10px;padding:6px;}',
            '#' + MODAL_ID + ' .agk-udaje{border-radius:11px;padding:10px 12px;background:var(--glass-bg,rgba(255,255,255,.05));margin:0 0 10px;}',
            '#' + MODAL_ID + ' .agk-udaje div{display:flex;justify-content:space-between;gap:10px;padding:3px 0;}',
            '#' + MODAL_ID + ' .agk-udaje span{opacity:.7;}',
            '#' + MODAL_ID + ' .agk-udaje b{font-family:var(--font-mono,monospace);user-select:all;-webkit-user-select:all;text-align:right;word-break:break-all;}',
            '#' + MODAL_ID + ' .agk-hl{margin:8px 0 0;min-height:17px;font-size:calc(12.5px * var(--ag-font-scale,1));}',
            '#' + MODAL_ID + ' .agk-hl.bad{color:#e2685f;}',
            '#' + MODAL_ID + ' .agk-hl.ok{color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .agk-pozn{margin:10px 0 0;opacity:.7;font-size:calc(12px * var(--ag-font-scale,1));}',
            '#' + MODAL_ID + ' .agk-odkazy{margin:12px 0 0;display:flex;gap:14px;flex-wrap:wrap;font-size:calc(12.5px * var(--ag-font-scale,1));}',
            '#' + MODAL_ID + ' .agk-odkazy a,#' + MODAL_ID + ' .agk-odkazy button{background:none;border:0;padding:0;font:inherit;cursor:pointer;',
            '  color:var(--accent,#2f9e74);text-decoration:underline;}',
            '#' + MODAL_ID + ' .agk-ok{font-size:calc(15px * var(--ag-font-scale,1));text-align:center;padding:14px 0;color:var(--accent,#2f9e74);font-weight:700;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function build() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        styly();
        m = document.createElement('div');
        m.id = MODAL_ID;
        m.innerHTML = '<div class="agk-box" role="dialog" aria-modal="true" id="agk-box"></div>';
        document.body.appendChild(m);
        m.addEventListener('click', function (e) { if (e.target === m) close(); });
        return m;
    }

    // ---- QR (SPAYD) ------------------------------------------------------------
    var _lib = null;
    function ensureQr() {
        if (typeof qrcode !== 'undefined') return Promise.resolve();
        if (window.AGUcty && AGUcty.ensureLib) return AGUcty.ensureLib('js/lib/qrcode.min.js');
        if (_lib) return _lib;
        _lib = new Promise(function (res, rej) {
            var s = document.createElement('script');
            s.src = 'js/lib/qrcode.min.js'; s.async = true;
            s.onload = res; s.onerror = function () { _lib = null; rej(new Error('qrcode')); };
            (document.head || document.documentElement).appendChild(s);
        });
        return _lib;
    }
    function kresliQr(el, text) {
        if (!el) return;
        ensureQr().then(function () {
            try {
                var qr = qrcode(0, 'M');
                qr.addData(text, 'Byte');
                qr.make();
                el.innerHTML = '<img alt="QR platba" src="' + qr.createDataURL(5, 8) + '">';
            } catch (e) { swallow(e, 'qr'); el.textContent = 'QR se nepovedlo vykreslit — zadej platbu ručně podle údajů níže.'; }
        }).catch(function () { el.textContent = 'QR knihovna se nenačetla — zadej platbu ručně podle údajů níže.'; });
    }

    // ---- data ------------------------------------------------------------------------
    function nacti(tichy) {
        if (!muzeServer() || !online()) { _stav = _stav || cache(); render(); return Promise.resolve(false); }
        if (!tichy) { _busy = true; render(); }
        return api('/objednavky/moje').then(function (r) {
            _busy = false;
            if (r.ok && r.data && r.data.prodej) {
                _stav = r.data;
                ulozCache(r.data);
                propisTarif(r.data.tarif, r.data.tarifDo);
            } else if (!_stav) _stav = cache();
            render();
            return !!(r.ok);
        });
    }
    // Když server řekne „máš Pro", rozsvítit ho hned — ne až za minutu s /config.
    function propisTarif(tarif, tarifDo) {
        try {
            var u = ucet();
            if (!u) return;
            if (u.tarif === tarif && (u.tarifDo || 0) === (tarifDo || 0)) return;
            u.tarif = tarif; u.tarifDo = tarifDo || 0;
            localStorage.setItem(LS_ACC, JSON.stringify(u));
            if (window.AGLic && AGLic.tarifUctu) AGLic.tarifUctu(tarif, tarifDo || 0);
            if (window.AGUcty && AGUcty.bustFirm) AGUcty.bustFirm();
        } catch (e) { swallow(e, 'propisTarif'); }
    }
    function otevrena() {
        var o = (_stav && _stav.objednavky) || [];
        for (var i = 0; i < o.length; i++) if (o[i].stav === 'ceka') return o[i];
        return null;
    }
    function maPro() { return !!(_stav && _stav.tarif === 'pro') || !!(window.AGLic && AGLic.isPro && AGLic.isPro()); }

    function objednat() {
        if (_busy) return;
        var m = build(), ch = m.querySelector('#agk-souhlas');
        if (ch && !ch.checked) { _hl = 'bad:Nejdřív potvrď souhlas s podmínkami.'; render(); return; }
        if (!muzeServer() || !online()) { _hl = 'bad:Pro objednání se připoj k internetu.'; render(); return; }
        _busy = true; _hl = ''; render();
        api('/objednavky', { method: 'POST', body: { produkt: _vyber } }).then(function (r) {
            _busy = false;
            if (!r.ok) {
                _hl = 'bad:' + ((r.data && r.data.error) || (r.status === 0 ? 'Server neodpověděl.' : 'Objednávku se nepodařilo založit (' + r.status + ').'));
                render(); return;
            }
            _stav = _stav || {};
            _stav.prodej = r.data.prodej || _stav.prodej;
            _stav.tarif = r.data.tarif; _stav.tarifDo = r.data.tarifDo;
            _stav.objednavky = [r.data.objednavka].concat((_stav.objednavky || []).filter(function (o) { return o.vs !== r.data.objednavka.vs; }));
            ulozCache(_stav);
            render();
            startPoll();
        });
    }
    function zkouska() {
        if (_busy) return;
        if (!muzeServer() || !online()) { _hl = 'bad:Pro zkoušku se připoj k internetu.'; render(); return; }
        _busy = true; _hl = ''; render();
        api('/zkouska', { method: 'POST', body: {} }).then(function (r) {
            _busy = false;
            if (!r.ok) { _hl = 'bad:' + ((r.data && r.data.error) || 'Zkoušku se nepodařilo zapnout.'); render(); return; }
            propisTarif('pro', r.data.tarifDo || 0);
            if (_stav) { _stav.tarif = 'pro'; _stav.tarifDo = r.data.tarifDo || 0; if (_stav.prodej && _stav.prodej.zkouska) _stav.prodej.zkouska.pouzita = true; ulozCache(_stav); }
            _hl = 'ok:Hotovo — Pro máš na ' + (r.data.dni || '') + ' dny, do ' + datum(r.data.tarifDo) + '.';
            render();
            oznac();
        });
    }
    function oznac() { try { if (window.AGProZamky && AGProZamky.oznac) AGProZamky.oznac(); } catch (e) { swallow(e, 'oznac'); } }
    function zrusit() {
        var o = otevrena();
        if (!o || _busy) return;
        _busy = true; render();
        api('/objednavky/' + o.vs, { method: 'DELETE' }).then(function (r) {
            _busy = false;
            if (r.ok && _stav) { _stav.objednavky = (_stav.objednavky || []).filter(function (x) { return x.vs !== o.vs; }); ulozCache(_stav); }
            _hl = r.ok ? '' : 'bad:Nepodařilo se zrušit.';
            render();
        });
    }
    function overit() {
        _hl = '';
        nacti(true).then(function (ok) {
            if (!ok) { _hl = 'bad:Server neodpověděl — zkus to za chvíli.'; }
            else if (!otevrena()) { _hl = 'ok:Platba dorazila — Pro je zapnuté.'; oznac(); }
            else _hl = 'Platba zatím nedorazila. Převod mezi bankami trvá i pár hodin; Pro se zapne samo.';
            render();
        });
    }
    function startPoll() {
        stopPoll();
        _poll = setInterval(function () {
            var m = document.getElementById(MODAL_ID);
            if (!m || !m.classList.contains('on') || document.hidden) return;
            if (!otevrena()) { stopPoll(); return; }
            nacti(true).then(function () { if (!otevrena()) { _hl = 'ok:Platba dorazila — Pro je zapnuté.'; render(); stopPoll(); oznac(); } });
        }, POLL_MS);
    }
    function stopPoll() { if (_poll) { clearInterval(_poll); _poll = null; } }

    // ---- vykreslení -------------------------------------------------------------------
    function render() {
        var m = build(), b = m.querySelector('#agk-box');
        var p = (_stav && _stav.prodej) || null;
        var u = ucet();
        var h = [];
        h.push('<h2>Verze Pro</h2>');

        if (maPro()) {
            var doK = (_stav && _stav.tarifDo) || (u && u.tarifDo) || 0;
            h.push('<p class="agk-pod">Pro máš zapnuté' + (doK ? ' do <b>' + datum(doK) + '</b>' : ' natrvalo') + '.</p>');
            if (doK && p && p.zapnuto) h.push('<p class="agk-pozn">Chceš prodloužit? Vyber délku a zaplať — dny se připočtou za konec.</p>');
            else {
                h.push(hlaska());
                h.push('<div class="agk-rada"><button type="button" id="agk-zavri">Zavřít</button></div>');
                b.innerHTML = h.join(''); wire(b); return;
            }
        }

        if (_busy && !p) { b.innerHTML = '<h2>Verze Pro</h2><p class="agk-pod">Načítám ceník…</p>'; return; }
        if (!p) {
            h.push('<p class="agk-pod">Ceník se načte, až bude signál' + (muzeServer() ? '' : ' a budeš přihlášený') + '.</p>');
            h.push('<p class="agk-pozn">Máš klíč Pro od autora? Opiš ho v kartě Verze Pro — funguje i bez signálu.</p>');
            h.push('<div class="agk-rada"><button type="button" id="agk-znovu">Zkusit znovu</button><button type="button" id="agk-zavri">Zavřít</button></div>');
            b.innerHTML = h.join(''); wire(b); return;
        }

        var o = otevrena();
        if (o) {
            // ---- čeká se na platbu: QR + údaje
            h.push('<p class="agk-pod">Objednávka č. <b>' + esc(o.vs) + '</b> — ' + esc(o.castka) + ' Kč za ' + dniText(o.dni) + '. Naskenuj QR bankovní appkou, nebo zadej převod ručně.</p>');
            h.push('<div class="agk-qr" id="agk-qr">' + (o.spayd ? 'Kreslím QR…' : '') + '</div>');
            h.push('<div class="agk-udaje">' +
                '<div><span>Částka</span><b>' + esc(o.castka) + ' Kč</b></div>' +
                (p.ucet ? '<div><span>Číslo účtu</span><b>' + esc(p.ucet) + '</b></div>' : '') +
                '<div><span>IBAN</span><b>' + esc(p.iban) + '</b></div>' +
                '<div><span>Variabilní symbol</span><b>' + esc(o.vs) + '</b></div>' +
                '<div><span>Zpráva pro příjemce</span><b>' + esc(o.msg) + '</b></div>' +
                '</div>');
            h.push('<p class="agk-pozn">' + (p.automat
                ? 'Po připsání se Pro zapne <b>samo</b>, obvykle do pár minut (převod z jiné banky může trvat déle).'
                : 'Po připsání ti Pro zapnu <b>ručně, nejpozději do 24 hodin</b>.') +
                ' Nemusíš tu čekat — appka se dozví sama.</p>');
            h.push(hlaska());
            h.push('<div class="agk-rada">' +
                '<button type="button" id="agk-overit"' + (_busy ? ' disabled' : '') + '>Už jsem zaplatil</button>' +
                '<button type="button" id="agk-zavri" class="hlavni">Zavřít</button></div>');
            h.push('<div class="agk-odkazy"><button type="button" id="agk-zrusit">Zrušit objednávku</button>' + odkazy() + '</div>');
            b.innerHTML = h.join('');
            wire(b);
            if (o.spayd) kresliQr(b.querySelector('#agk-qr'), o.spayd);
            startPoll();
            return;
        }

        // ---- ceník + zkouška + souhlas
        if (!maPro()) h.push('<p class="agk-pod">Základ je zdarma napořád. Pro je předplatné — bez závazku, prostě se za měsíc nebo za rok obnoví, když zaplatíš znovu.</p>');
        var pr = p.produkty || [];
        var mes = pr.filter(function (x) { return x.k === 'mesic'; })[0];
        var rok = pr.filter(function (x) { return x.k === 'rok'; })[0];
        var usetri = (mes && rok && mes.cena) ? Math.round((1 - rok.cena / (mes.cena * 12)) * 100) : 0;
        h.push('<div class="agk-cenik">');
        pr.forEach(function (x) {
            h.push('<button type="button" class="agk-pr' + (_vyber === x.k ? ' on' : '') + '" data-pr="' + esc(x.k) + '">' +
                (x.k === 'rok' && usetri > 0 ? '<span class="agk-tag">ušetříš ' + usetri + ' %</span>' : '') +
                esc(x.nazev) + '<b>' + esc(x.cena) + ' Kč</b><small>' +
                (x.k === 'rok' && mes ? ('≈ ' + Math.round(x.cena / 12) + ' Kč / měsíc') : ('na ' + dniText(x.dni))) + '</small></button>');
        });
        h.push('</div>');
        var z = p.zkouska || {};
        if (!maPro() && z.dni && !z.pouzita)
            h.push('<button type="button" class="agk-zk" id="agk-zkouska"' + (_busy ? ' disabled' : '') + '>Vyzkoušet Pro na ' + z.dni + ' dny zdarma</button>');
        if (!p.zapnuto) {
            h.push('<p class="agk-pozn">Platba QR kódem se teprve připravuje. Zatím napiš autorovi (Více → Napsat autorovi) a Pro dostaneš klíčem.</p>');
        } else {
            h.push('<label class="agk-souhlas"><input type="checkbox" id="agk-souhlas"><span>Souhlasím s <a href="' + PODMINKY + '" target="_blank" rel="noopener">obchodními podmínkami</a> a s tím, že se Pro zapne hned po připsání platby — tím zaniká právo odstoupit od smlouvy do 14 dnů.</span></label>');
        }
        h.push(hlaska());
        h.push('<div class="agk-rada">' +
            '<button type="button" id="agk-zavri">Zavřít</button>' +
            (p.zapnuto ? '<button type="button" class="hlavni" id="agk-objednat"' + (_busy ? ' disabled' : '') + '>Zaplatit QR kódem</button>' : '') +
            '</div>');
        h.push('<div class="agk-odkazy">' + odkazy() + '</div>');
        b.innerHTML = h.join('');
        wire(b);
    }
    function dniText(d) { return d === 0 ? 'navždy' : (d >= 360 ? 'rok' : (d >= 28 && d <= 31 ? 'měsíc' : d + ' dní')); }
    function hlaska() {
        if (!_hl) return '<p class="agk-hl"></p>';
        var t = _hl, cls = '';
        if (t.indexOf('bad:') === 0) { cls = ' bad'; t = t.slice(4); } else if (t.indexOf('ok:') === 0) { cls = ' ok'; t = t.slice(3); }
        return '<p class="agk-hl' + cls + '">' + esc(t) + '</p>';
    }
    function odkazy() {
        var s = '<a href="' + PODMINKY + '" target="_blank" rel="noopener">Obchodní podmínky</a>';
        if (window.AGProPrehled && typeof AGProPrehled.open === 'function') s += '<button type="button" id="agk-prehled">Co Pro přidá</button>';
        return s;
    }
    function wire(b) {
        var q = function (sel, fn) { var el = b.querySelector(sel); if (el) el.addEventListener('click', fn); };
        q('#agk-zavri', close);
        q('#agk-znovu', function () { nacti(false); });
        q('#agk-objednat', objednat);
        q('#agk-zkouska', zkouska);
        q('#agk-zrusit', zrusit);
        q('#agk-overit', overit);
        q('#agk-prehled', function () { try { AGProPrehled.open(); } catch (e) { swallow(e, 'prehled'); } });
        Array.prototype.forEach.call(b.querySelectorAll('[data-pr]'), function (el) {
            el.addEventListener('click', function () { _vyber = el.getAttribute('data-pr'); render(); });
        });
    }

    function open() {
        var m = build();
        _hl = '';
        m.classList.add('on');
        try { if (window.AGProZamky && AGProZamky.zavri) AGProZamky.zavri(); } catch (e) { swallow(e, 'zavriKartu'); }
        _stav = cache();
        render();
        nacti(!!_stav);
    }
    function close() {
        var m = document.getElementById(MODAL_ID);
        if (m) m.classList.remove('on');
        stopPoll();
    }

    window.AGProKoupe = { open: open, close: close, refresh: function () { return nacti(true); } };
})();
