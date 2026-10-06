// ===== QTRIG — STOJÍŠ U ÚŘEDNÍHO BODU? OPRAV PODLE NĚJ GPS (ODPOJITELNÁ vrstva) ===
// (6. 10. 2026, hodnocení — návrh 5: „automatické ukotvení na úřední bod")
//
// PROČ: oprava GPS podle známého bodu (js/ref-calibration.js) je to nejlepší, co
// telefon v terénu umí — chyba GPS je na pár set metrů a pár desítek minut skoro
// stejná, takže když stojíš na bodě se známými souřadnicemi, appka ji změří
// a odečte od dalších bodů. Jenže se spouští RUČNĚ (Nástroje → Opravit GPS, nebo
// karta bodu → Opravit GPS) a v terénu na to člověk nevzpomene, i když na TB zrovna
// stojí. Tenhle modul si všimne, že ses u úředního bodu ZASTAVIL, a nabídne to sám:
//   „Stojíš u bodu TB 12 (2,4 m)? Oprav podle něj GPS — body v okolí budou přesnější."
//   [Opravit GPS]  [Teď ne]  [Neptat se]
// „Opravit GPS" otevře totéž potvrzení jako karta bodu (agRefCalibrateFromPoint) —
// s upozorněním, že se musí stát PŘÍMO na bodě. Nic se neděje bez potvrzení.
//
// KDY SE NABÍDNE (všechno najednou):
//   • bod je polohový úřední bod (TB, ZhB, PBPP) — nivelační a tíhové ne (poloha jen
//     orientačně / bývají v budově),
//   • GPS je čerstvá (agFixState), přesnost ≤ 15 m a stojíš (rychlost < 0,7 m/s),
//   • bod je do max(3 m, min(10 m, 1,5 × přesnost)) — když na bodě stojíš, telefon
//     ukazuje vzdálenost zhruba rovnou své chybě,
//   • tak je to aspoň PRODLEVA (8 s) — kdo jen projde kolem, nic nedostane,
//   • žádná korekce zrovna neběží (agRefShift.on, mladší 20 min) a není otevřené okno,
//   • na tenhle bod se neptalo posledních 12 h; „Neptat se" vypne nabídku úplně
//     (localStorage agKotvaNabidka_v1; zpátky ji zapne Nastavení → AR & přesnost →
//     „Nabízet opravu GPS u úředního bodu").
//
// Odstranění: smaž js/kotva-nabidka.js + řádek <script type="ag/lazy"> v index.html,
// přegeneruj sw.js. Nikdo jiný na modul nesahá.
// ================================================================================
(function () {
    'use strict';
    if (window.AGKotvaNabidka) return;

    var LS = 'agKotvaNabidka_v1', ID = 'ag-kn-pruh';
    var KATEGORIE = { TB: 1, ZHB: 1, PBPP: 1 };
    var PRODLEVA = 8000, ZNOVU = 12 * 3600e3, KOREKCE_MS = 20 * 60e3;

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'kotva-nabidka:' + kde); } catch (x) { /* nic */ } }
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function g(name) { try { return (0, eval)('typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined'); } catch (e) { return undefined; } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function st() { try { var s = JSON.parse(localStorage.getItem(LS) || 'null'); return (s && typeof s === 'object') ? s : {}; } catch (e) { return {}; } }
    function ulozSt(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { swallow(e, 'ls'); } }

    function korekceBezi(now) {
        var s = window.agRefShift;
        return !!(s && s.on && s.t && now - s.t < KOREKCE_MS);
    }
    function oknoOtevrene() {
        try {
            var bs = document.getElementById('bottom-sheet'); if (bs && bs.classList.contains('open')) return true;
            // zavřená okna appky často jen parkují mimo obrazovku (display nic neříká) — rozhoduje,
            // jestli okno opravdu leží přes obraz (stejně jako js/prvni-mereni.js)
            var ms = document.querySelectorAll('.modal-overlay, .ag-dlg-overlay, #agsu, #ag-cu, #ag-gate, #ag-login');
            for (var i = 0; i < ms.length; i++) {
                var cs = getComputedStyle(ms[i]);
                if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;
                var r = ms[i].getBoundingClientRect();
                if (r.width > innerWidth * 0.5 && r.height > innerHeight * 0.5 && r.left < innerWidth - 4 && r.right > 4 && r.top < innerHeight - 4 && r.bottom > 4) return true;
            }
        } catch (e) { swallow(e, 'okno'); }
        return false;
    }
    function nejblizsi(lat, lng, dosah) {
        var pts = g('arPoints') || [], best = null;
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i];
            if (!p || p.hidden || !KATEGORIE[String(p.cat || '').toUpperCase()] || !isFinite(p.lat) || !isFinite(p.lng)) continue;
            var d = getDistance(lat, lng, p.lat, p.lng);   // eslint-disable-line no-undef
            if (d <= dosah && (!best || d < best.d)) best = { p: p, d: d };
        }
        return best;
    }

    // ---- rozhodnutí (now = Date.now(), v testu se dá podstrčit) ----
    var _kand = null;   // { id, od } — u kterého bodu stojím a odkdy
    function tik(now) {
        now = now || Date.now();
        var s = st();
        if (s.vyp || document.getElementById(ID)) return null;
        var lat = g('userLat'), lng = g('userLng'), acc = g('currentGpsAccuracy'), rych = g('gpsSpeed');
        var ok = lat && lng && acc > 0 && acc <= 15 && !(rych > 0.7);
        try { if (ok && typeof window.agFixState === 'function') { var fs = window.agFixState(); ok = !fs || fs === 'fresh' || (fs && fs.state === 'fresh'); } } catch (e) { swallow(e, 'fix'); }
        if (!ok || korekceBezi(now)) { _kand = null; return null; }
        var P = window.AGEsm && window.AGEsm.presnost; if (!P) return null;   // js/esm/presnost.mjs
        var dosah = P.dosahKotvy(acc);
        var b = nejblizsi(lat, lng, dosah);
        if (!b) { _kand = null; return null; }
        if (!_kand || _kand.id !== b.p.id) { _kand = { id: b.p.id, od: now }; return null; }
        if (now - _kand.od < PRODLEVA) return null;
        var ptala = (s.body || {})[b.p.id];
        if (ptala && now - ptala < ZNOVU) return null;
        if (oknoOtevrene()) return null;
        ukaz(b, now);
        return b;
    }

    function styl() {
        if (document.getElementById(ID + '-css')) return;
        var css = '#' + ID + '{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 96px);z-index:12500;'
            + 'width:min(430px,calc(100vw - 20px));box-sizing:border-box;padding:12px 13px;border-radius:14px;background:#0f2a20;color:#d1fae5;'
            + 'border:1px solid rgba(52,211,153,.5);box-shadow:0 10px 30px rgba(0,0,0,.45);font:500 calc(13px * var(--ag-font-scale,1))/1.45 var(--font-ui,system-ui);}'
            + '#' + ID + ' b{color:#6ee7b7;}#' + ID + ' small{display:block;opacity:.8;margin-top:2px;}'
            + '#' + ID + ' .kn-akce{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px;}'
            + '#' + ID + ' button{flex:1 1 auto;min-height:42px;padding:8px 12px;border-radius:10px;border:1px solid rgba(52,211,153,.45);background:rgba(52,211,153,.12);'
            + 'color:#d1fae5;font:600 calc(12.5px * var(--ag-font-scale,1))/1.2 var(--font-ui,system-ui);cursor:pointer;}'
            + '#' + ID + ' button.hl{background:var(--accent,#2f9e74);border-color:var(--accent,#2f9e74);color:#fff;}'
            + 'body.light-mode #' + ID + '{background:#ecfdf5;color:#064e3b;border-color:#10b981;}body.light-mode #' + ID + ' b{color:#047857;}'
            + 'body.light-mode #' + ID + ' button{color:#064e3b;background:#d1fae5;border-color:#10b981;}body.light-mode #' + ID + ' button.hl{color:#fff;background:#047857;}';
        var el = document.createElement('style'); el.id = ID + '-css'; el.textContent = css; document.head.appendChild(el);
    }
    function zavri() { var el = document.getElementById(ID); if (el) el.remove(); }
    function zapamatuj(id, now) {
        var s = st(); s.body = s.body || {}; s.body[id] = now || Date.now();
        var k = Object.keys(s.body); if (k.length > 60) { k.sort(function (a, b) { return s.body[a] - s.body[b]; }); delete s.body[k[0]]; }
        ulozSt(s);
    }
    function ukaz(b, now) {
        styl(); zavri();
        zapamatuj(b.p.id, now);
        var el = document.createElement('div'); el.id = ID; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', t('Opravit GPS podle bodu'));
        el.innerHTML = '<div>' + t('Stojíš u bodu') + ' <b>' + esc(b.p.name || '?') + '</b> (' + b.d.toFixed(1).replace('.', ',') + ' m)? ' + t('Oprav podle něj GPS.') + '</div>'
            + '<small>' + t('Body, které uložíš v okolí 300 m během 20 minut, budou přesnější. Musíš stát přímo na značce.') + '</small>'
            + '<div class="kn-akce"><button type="button" class="hl" data-a="ano">' + t('Opravit GPS') + '</button>'
            + '<button type="button" data-a="ne">' + t('Teď ne') + '</button><button type="button" data-a="nikdy">' + t('Neptat se') + '</button></div>';
        document.body.appendChild(el);
        el.addEventListener('click', function (e) {
            var btn = e.target.closest && e.target.closest('button[data-a]'); if (!btn) return;
            var a = btn.getAttribute('data-a');
            zavri();
            if (a === 'nikdy') { var s = st(); s.vyp = true; ulozSt(s); try { if (typeof quickToast === 'function') quickToast(t('Nabídka vypnutá. Opravit GPS podle bodu jde dál z karty bodu.')); } catch (x) { /* nic */ } }
            else if (a === 'ano') {
                var go = function () { try { if (typeof window.agRefCalibrateFromPoint === 'function') window.agRefCalibrateFromPoint(b.p); } catch (x) { swallow(x, 'oprava'); } };
                if (typeof window.agRefCalibrateFromPoint === 'function' || !window.AGLazy) go(); else AGLazy.need('js/ref-calibration.js', go);
            }
        });
        setTimeout(function () { if (el.isConnected) el.remove(); }, 45000);
    }

    // ---- Nastavení → AR & přesnost (stejný vzor jako js/prichyceni.js) ----
    function ui() {
        var uz = document.getElementById('s-kotva-nabidka');
        if (uz) { uz.checked = !st().vyp; return; }   // „Neptat se" z nabídky se musí propsat i do už postaveného řádku
        var tab = document.getElementById('tab-ar'); if (!tab) return;
        var r = document.createElement('div'); r.className = 'st-row';
        r.innerHTML = '<span class="st-lab">' + esc(t('Nabízet opravu GPS u úředního bodu')) + '<small>' + esc(t('když se zastavíš u TB, ZhB nebo PBPP, appka nabídne opravit podle něj GPS')) + '</small></span>'
            + '<label class="st-sw"><input type="checkbox" id="s-kotva-nabidka"' + (st().vyp ? '' : ' checked') + '><span class="st-sw-face"></span></label>';
        var za = document.getElementById('s-prichyceni'), radek = za && za.closest ? za.closest('.st-row') : null;
        if (radek && radek.parentNode === tab) tab.insertBefore(r, radek.nextSibling); else tab.appendChild(r);
        r.querySelector('input').addEventListener('change', function (ev) { var x = st(); x.vyp = !ev.target.checked; ulozSt(x); });
    }
    try { ui(); } catch (e) { swallow(e, 'ui'); }
    document.addEventListener('click', function (ev) { try { if (ev.target && ev.target.closest && ev.target.closest('#settings-btn, [data-open="settings"]')) setTimeout(ui, 80); } catch (e) { /* nic */ } }, true);
    document.addEventListener('ag:nastaveni-strana', function () { try { ui(); } catch (e) { swallow(e, 'ui'); } });

    setInterval(function () { if (document.visibilityState === 'visible') { try { tik(); } catch (e) { swallow(e, 'tik'); } } }, 4000);

    window.AGKotvaNabidka = {
        zapnuto: function () { return !st().vyp; },
        zapni: function (v) { var s = st(); s.vyp = !v; ulozSt(s); },
        _test: { tik: tik, ui: ui, reset: function () { _kand = null; zavri(); } }
    };
})();
