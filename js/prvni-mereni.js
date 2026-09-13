// ================================================================================
//  PRŮVODCE PRVNÍM MĚŘENÍM „udělej to teď" (odpojitelné: smaž tento řádek
//  v index.html, tento soubor, záznam v sw.js a dvě místa v js/tutorial-pro.js
//  označená komentářem „první měření")
//
//  Proč: obrázkovou prohlídku lidé přeskočí. Tohle je pět skutečných kroků nad
//  živou appkou — povol GPS a kompas → počkej na ±10 m → ulož bod → otevři jeho
//  kartu → Doveď mě. Každý krok se odškrtne SÁM, když ho člověk udělá, takže je
//  to zároveň test, že mu appka na telefonu funguje. Schváleno 13. 9. 2026
//  (návrhy před betou). Na prvním spuštění nahrazuje automatický start základní
//  prohlídky (js/tutorial-pro.js); ta zůstává v rozcestníku „Interaktivní návod".
//
//  Nic v appce se nemění: stav kroků se čte z toho, co už existuje (userLat,
//  currentGpsAccuracy, persistentCustomPoints, #bottom-sheet.open,
//  highlightedPointId) — přes Function na globální lexikální vazby jako
//  v js/karta-bodu-plus.js, protože `let` na nejvyšší úrovni není ve window.
// ================================================================================
(function () {
    'use strict';
    if (window.AGPrvniMereni) return;

    var ID = 'ag-pm', STYLE_ID = 'ag-pm-style', LS = 'agPrvniMereni_v1';
    var _gFn = {};
    function g(name) {
        try { if (name in window) return window[name]; } catch (e) { swallow(e, 'g'); }
        try {
            var f = _gFn[name] || (_gFn[name] = new Function('return typeof ' + name + '!=="undefined"?' + name + ':undefined'));
            return f();
        } catch (e) { return undefined; }
    }
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'prvni-mereni:' + kde); } catch (x) { } }
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function lsGet() { try { return JSON.parse(localStorage.getItem(LS) || 'null') || null; } catch (e) { return null; } }
    function lsSet(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { swallow(e, 'ls'); } }

    // ---- kroky ---------------------------------------------------------------------------
    // hotovo() = pravda, když je krok splněný; rada = co udělat; tip = kde to je
    var _orient = 0;
    try { window.addEventListener('deviceorientation', function () { _orient++; }); window.addEventListener('deviceorientationabsolute', function () { _orient++; }); } catch (e) { swallow(e, 'orient'); }
    var _n0 = null;       // počet vlastních bodů při startu průvodce
    var KROKY = [
        {
            k: 'senzory', t: 'Povol polohu a kompas', cil: function () { return document.getElementById('ag-sp'); },
            rada: 'Když se telefon zeptá, povol polohu a pohyb/orientaci. Na iPhonu se kompas probudí až po prvním klepnutí na obrazovku.',
            hotovo: function () { return !!g('userLat') && !window.AGCompassDenied && _orient > 0; }
        },
        {
            k: 'presnost', t: 'Počkej na přesnost do ±10 m', cil: function () { return document.getElementById('ag-sp'); },
            rada: 'Stůj chvíli na místě pod volným nebem. Přesnost vidíš v bublině nahoře — jakmile je pod ±10 m, jdeme dál.',
            hotovo: function () { var a = g('currentGpsAccuracy'); return !!(a && a <= 10); }
        },
        {
            k: 'bod', t: 'Ulož svůj první bod', cil: function () { return document.querySelector('#dock .dock-primary'); },
            rada: 'Klepni na velké + dole, vyber „Z průměru GPS" a ulož bod. Pojmenuj ho třeba 1.',
            hotovo: function () { var p = g('persistentCustomPoints'); return !!(p && _n0 != null && p.length > _n0); }
        },
        {
            k: 'karta', t: 'Otevři kartu bodu', cil: function () { var m = document.querySelectorAll('.leaflet-marker-icon.custom-map-marker'); return m.length ? m[m.length - 1] : document.querySelector('#dock button[onclick*="openManageModal"]'); },
            rada: 'Klepni na svůj bod v mapě (nebo v Bodech dole). Karta ukáže souřadnice, přesnost a náčrt okolí.',
            hotovo: function () { var bs = document.getElementById('bottom-sheet'); return !!(bs && bs.classList.contains('open')); }
        },
        {
            k: 'doved', t: 'Nech se k bodu dovést', cil: function () { return document.querySelector('#ag-kb-acts button[data-a="nav"]'); },
            rada: 'Na kartě klepni na „Doveď mě". Šipka a vzdálenost tě k bodu navedou — tak se vytyčuje.',
            hotovo: function () { return g('highlightedPointId') != null; }
        }
    ];

    // ---- stav ----------------------------------------------------------------------------
    var _st = null;        // { krok, hotove:[k…], zacatek, hotovo:bool }
    var _timer = null, _open = false;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + ID + '{position:fixed;left:max(10px,env(safe-area-inset-left,0px));right:calc(env(safe-area-inset-right,0px) + 100px);bottom:calc(env(safe-area-inset-bottom,0px) + 12px);max-width:440px;',   // vpravo je svislý dok + kolečko zobrazení — ty zůstávají volné
            '  z-index:100010;background:var(--bg-elev,#151a20);color:var(--text-color,#eceef2);border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.45);font-family:var(--font-ui,system-ui);padding:12px 14px 10px;box-sizing:border-box;}',
            'body.light-mode #' + ID + '{background:#fff;border-color:rgba(15,23,42,0.18);box-shadow:0 10px 30px rgba(15,23,42,.22);}',
            'body.left-hand #' + ID + '{left:calc(env(safe-area-inset-left,0px) + 100px);right:max(10px,env(safe-area-inset-right,0px));}',
            '#' + ID + ' .pm-h{display:flex;align-items:center;gap:8px;margin-bottom:8px;}',
            '#' + ID + ' .pm-h b{font-size:calc(14px * var(--ag-font-scale,1));flex:1;}',
            '#' + ID + ' .pm-h small{color:var(--text-muted,#9aa1ac);font-size:calc(11.5px * var(--ag-font-scale,1));}',
            '#' + ID + ' .pm-x{width:34px;height:34px;border-radius:50%;border:1px solid var(--glass-border,rgba(255,255,255,0.18));background:transparent;color:inherit;font-size:18px;line-height:1;cursor:pointer;}',
            '#' + ID + ' .pm-list{display:flex;flex-direction:column;gap:4px;}',
            '#' + ID + ' .pm-i{display:flex;gap:9px;align-items:flex-start;padding:5px 6px;border-radius:9px;font-size:calc(13px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);}',
            '#' + ID + ' .pm-i .pm-n{flex:0 0 22px;width:22px;height:22px;border-radius:50%;border:2px solid var(--glass-border,rgba(255,255,255,0.22));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;}',
            '#' + ID + ' .pm-i.done{color:var(--text-color,#eceef2);}',
            '#' + ID + ' .pm-i.done .pm-n{background:var(--accent,#2f9e74);border-color:var(--accent,#2f9e74);color:#06231a;}',
            '#' + ID + ' .pm-i.now{background:rgba(47,158,116,0.12);color:var(--text-color,#eceef2);}',
            '#' + ID + ' .pm-i.now .pm-n{border-color:var(--accent,#2f9e74);color:var(--accent,#2f9e74);}',
            '#' + ID + ' .pm-i .pm-t{flex:1;min-width:0;line-height:1.35;}',
            '#' + ID + ' .pm-i.now .pm-t small{display:block;margin-top:3px;color:var(--text-muted,#9aa1ac);font-size:calc(12px * var(--ag-font-scale,1));line-height:1.4;}',
            '#' + ID + ' .pm-f{display:flex;gap:8px;margin-top:8px;}',
            '#' + ID + ' .pm-f button{flex:1;min-height:38px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.18));background:transparent;color:inherit;font:600 13px var(--font-ui,system-ui);cursor:pointer;}',
            '#' + ID + ' .pm-f button.hl{background:var(--accent,#2f9e74);border-color:transparent;color:#06231a;}',
            // ZMENŠENÝ režim: když je otevřená karta bodu nebo jiné okno, panel by ležel přes jeho
            // tlačítka (Doveď mě). Přesune se nahoru pod pilulku jako jeden řádek s radou a NEBERE
            // doteky (pointer-events:none); po zavření okna se vrátí dolů.
            '#' + ID + '.pm-mini{top:calc(env(safe-area-inset-top,0px) + 58px);bottom:auto;left:10px;right:10px;max-width:none;padding:8px 12px;pointer-events:none;opacity:.96;}',
            '#' + ID + '.pm-mini .pm-h,#' + ID + '.pm-mini .pm-f,#' + ID + '.pm-mini .pm-i:not(.now){display:none;}',
            '#' + ID + '.pm-mini .pm-i.now{padding:2px 0;background:transparent;}',
            // KROUŽEK NA CÍLI (13. 9. 2026, uživatel: „ani mi to neukázalo šipkou, kam mám kliknout"):
            // pulzující obrys kolem prvku, na který má člověk klepnout, + štítek „sem". Nebere doteky.
            '#ag-pm-ring{position:fixed;z-index:100011;pointer-events:none;border:3px solid var(--accent,#2f9e74);border-radius:16px;box-shadow:0 0 0 4px rgba(47,158,116,.25),0 0 18px rgba(47,158,116,.55);transition:left .25s,top .25s,width .25s,height .25s;display:none;}',
            '#ag-pm-ring.on{display:block;animation:agPmPulse 1.4s ease-in-out infinite;}',
            '#ag-pm-ring.kruh{border-radius:50%;}',
            '#ag-pm-ring .pm-tag{position:absolute;left:50%;transform:translateX(-50%);top:-30px;padding:4px 9px;border-radius:999px;background:var(--accent,#2f9e74);color:#06231a;font:700 12px/1 var(--font-ui,system-ui);white-space:nowrap;}',
            '#ag-pm-ring .pm-tag::after{content:"";position:absolute;left:50%;bottom:-5px;transform:translateX(-50%);border:5px solid transparent;border-bottom:0;border-top-color:var(--accent,#2f9e74);}',
            '#ag-pm-ring.dole .pm-tag{top:auto;bottom:-30px;}',
            '#ag-pm-ring.dole .pm-tag::after{bottom:auto;top:-5px;border-top:0;border-bottom:5px solid var(--accent,#2f9e74);}',
            '@keyframes agPmPulse{0%,100%{box-shadow:0 0 0 4px rgba(47,158,116,.25),0 0 18px rgba(47,158,116,.55);}50%{box-shadow:0 0 0 9px rgba(47,158,116,.12),0 0 26px rgba(47,158,116,.7);}}',
            '@media (prefers-reduced-motion: reduce){#ag-pm-ring.on{animation:none;}}',
            '#' + ID + ' .pm-i.done .pm-n{animation:agPmTick .35s ease-out;}',
            '@keyframes agPmTick{0%{transform:scale(.6);}60%{transform:scale(1.25);}100%{transform:scale(1);}}',
            '#' + ID + '.pm-done .pm-list{display:none;}',
            '#' + ID + ' .pm-fin{font-size:calc(13.5px * var(--ag-font-scale,1));line-height:1.45;margin:2px 0 4px;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    function el() { return document.getElementById(ID); }
    function ring() {
        var r = document.getElementById('ag-pm-ring');
        if (!r) { r = document.createElement('div'); r.id = 'ag-pm-ring'; r.innerHTML = '<span class="pm-tag"></span>'; document.body.appendChild(r); }
        return r;
    }
    function usadKrouzek() {
        var r = ring();
        if (!_open || !_st || _st.hotovo) { r.classList.remove('on'); return; }
        var kr = KROKY[_st.krok], cil = null;
        try { cil = kr.cil ? kr.cil() : null; } catch (e) { cil = null; }
        if (!cil) { r.classList.remove('on'); return; }
        var b = cil.getBoundingClientRect();
        if (!b.width || !b.height || b.bottom < 0 || b.top > innerHeight) { r.classList.remove('on'); return; }
        var pad = 6;
        r.style.left = (b.left - pad) + 'px'; r.style.top = (b.top - pad) + 'px';
        r.style.width = (b.width + 2 * pad) + 'px'; r.style.height = (b.height + 2 * pad) + 'px';
        r.classList.toggle('kruh', Math.abs(b.width - b.height) < 6 && b.width < 90);
        r.classList.toggle('dole', b.top < 60);           // štítek pod prvkem, když je prvek u horního okraje
        r.querySelector('.pm-tag').textContent = kr.k === 'senzory' || kr.k === 'presnost' ? t('tady') : t('klepni sem');
        r.classList.add('on');
    }
    function build() {
        injectStyles();
        var d = el();
        if (d) return d;
        d = document.createElement('div');
        d.id = ID;
        d.setAttribute('role', 'dialog');
        d.setAttribute('aria-label', t('Průvodce prvním měřením'));
        document.body.appendChild(d);
        d.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-a]') : null;
            if (!b) return;
            var a = b.getAttribute('data-a');
            if (a === 'close') close(false);
            else if (a === 'skip') { _pauza = 0; oznacHotovo(KROKY[_st.krok].k, true); posun(); usadKrouzek(); }
            else if (a === 'fin') close(true);
        });
        return d;
    }

    function oznacHotovo(k, preskoceno) {
        if (_st.hotove.indexOf(k) < 0) _st.hotove.push(k);
        if (preskoceno) { _st.preskoceno = _st.preskoceno || []; if (_st.preskoceno.indexOf(k) < 0) _st.preskoceno.push(k); }
        lsSet(_st);
    }
    // přejít na první nehotový krok; když žádný není, průvodce je hotový
    function posun() {
        var i = 0;
        while (i < KROKY.length && _st.hotove.indexOf(KROKY[i].k) >= 0) i++;
        _st.krok = i;
        if (i >= KROKY.length) { _st.hotovo = true; lsSet(_st); }
        else lsSet(_st);
        render();
    }
    function render() {
        var d = build();
        if (!_st) return;
        if (_st.hotovo) {
            d.classList.add('pm-done');
            d.innerHTML = '<div class="pm-h"><b>' + t('Máš za sebou první měření') + '</b></div>' +
                '<div class="pm-fin">' + t('Bod uložený, karta otevřená, navigace vyzkoušená — přesně tohle děláš v terénu. Další nástroje najdeš pod tlačítkem Nástroje, návod ke každému pod „?".') + '</div>' +
                '<div class="pm-f"><button type="button" class="hl" data-a="fin">' + t('Hotovo, jdu měřit') + '</button></div>';
            return;
        }
        d.classList.remove('pm-done');
        var kr = KROKY[_st.krok];
        var h = '<div class="pm-h"><b>' + t('Průvodce prvním měřením') + '</b><small>' + (_st.krok + 1) + ' / ' + KROKY.length + '</small>' +
            '<button type="button" class="pm-x" data-a="close" aria-label="' + t('Zavřít průvodce') + '">×</button></div><div class="pm-list">';
        KROKY.forEach(function (s, i) {
            var done = _st.hotove.indexOf(s.k) >= 0, now = i === _st.krok;
            h += '<div class="pm-i' + (done ? ' done' : '') + (now ? ' now' : '') + '"><span class="pm-n">' + (done ? '✓' : (i + 1)) + '</span>' +
                '<span class="pm-t">' + esc(t(s.t)) + (now ? '<small>' + esc(t(s.rada)) + '</small>' : '') + '</span></div>';
        });
        h += '</div><div class="pm-f"><button type="button" data-a="skip">' + t('Přeskočit krok') + '</button></div>';
        d.innerHTML = h;
    }

    // hlídání: každých 600 ms se podívej, jestli aktuální krok není hotový
    function jeNecoOtevrene() {
        try {
            var bs = document.getElementById('bottom-sheet');
            if (bs && bs.classList.contains('open')) return true;
            var ms = document.querySelectorAll('.modal-overlay, .ag-dlg-overlay');
            // zavřená okna appky často jen parkují mimo obrazovku (display nic neříká) — rozhoduje,
            // jestli okno opravdu leží přes obraz
            for (var i = 0; i < ms.length; i++) {
                var m = ms[i]; if (m.id === 'ag-pm') continue;
                var cs = getComputedStyle(m);
                if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;
                var r = m.getBoundingClientRect();
                if (r.width > innerWidth * 0.5 && r.height > innerHeight * 0.5 && r.left < innerWidth - 4 && r.right > 4 && r.top < innerHeight - 4 && r.bottom > 4) return true;
            }
        } catch (e) { swallow(e, 'otevrene'); }
        return false;
    }
    var _pauza = 0;   // krok se právě odškrtl — chvíli ho nechat vidět, než se jde dál
    function tick() {
        if (!_open || !_st) return;
        var d = el(); if (d) d.classList.toggle('pm-mini', !_st.hotovo && jeNecoOtevrene());
        usadKrouzek();
        if (_st.hotovo) return;
        if (_pauza) { if (Date.now() < _pauza) return; _pauza = 0; posun(); usadKrouzek(); return; }
        var kr = KROKY[_st.krok];
        var ok = false;
        try { ok = !!kr.hotovo(); } catch (e) { swallow(e, 'hotovo:' + kr.k); }
        if (ok) {
            // odškrtnout HNED (ať je to vidět) a posunout se až za chvíli — jinak kroky, které
            // jsou splněné už při startu (poloha, přesnost), přeskočí bez jediného mrknutí
            oznacHotovo(kr.k, false);
            var dd = el(), row = dd && dd.querySelectorAll('.pm-i')[_st.krok];
            if (row) { row.classList.add('done'); row.classList.remove('now'); var nn = row.querySelector('.pm-n'); if (nn) nn.textContent = '✓'; }
            _pauza = Date.now() + 900;
        }
    }

    function start(auto) {
        var s = lsGet();
        if (s && s.hotovo && !auto) { s = null; }          // ruční spuštění znovu = od začátku
        if (s && s.hotovo) return false;                    // automaticky už nikdy
        if (!s || !Array.isArray(s.hotove)) s = { krok: 0, hotove: [], zacatek: Date.now(), hotovo: false };
        _st = s;
        var p = g('persistentCustomPoints');
        _n0 = (p && typeof p.length === 'number') ? p.length : 0;
        // kdo už bod má z dřívějška, nemá krok „ulož bod" přeskočený — počítá se nový
        _open = true;
        build();
        posun();
        if (!_timer) _timer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 600);
        usadKrouzek();
        try { window.addEventListener('resize', usadKrouzek); window.addEventListener('scroll', usadKrouzek, true); } catch (e) { swallow(e, 'ring:listen'); }
        return true;
    }
    function close(dokonceno) {
        _open = false;
        var d = el(); if (d) d.remove();
        var r = document.getElementById('ag-pm-ring'); if (r) r.remove();
        if (_st) { if (dokonceno) _st.hotovo = true; _st.zavreno = Date.now(); lsSet(_st); }
        if (_timer) { clearInterval(_timer); _timer = null; }
    }
    // Průvodce se na prvním spuštění otevře sám (viz js/tutorial-pro.js), ale jen jednou:
    // kdo ho zavřel křížkem, dostane ho příště v rozcestníku „Interaktivní návod".
    function autoStart() {
        var s = lsGet();
        if (s && (s.hotovo || s.zavreno)) return false;
        return start(true);
    }

    window.AGPrvniMereni = { start: function () { return start(false); }, autoStart: autoStart, close: close, stav: function () { return lsGet(); } };
})();
