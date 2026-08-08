// ===== AR Geodet — CENTRUM UPOZORNĚNÍ (jeden sloupec nahoře, ODPOJITELNÁ vrstva) ==
// PROBLÉM, který řeší: nahoře uprostřed si o stejné místo říkalo SEDM nezávislých
// prvků, každý s vlastním vzhledem a vlastní výškou:
//   #ag-sp (stavový pruh, safe+4) · #ag-guest-pill (safe+8) · #ag-gpst-bar
//   (GPS ztracena, safe+44) · #dmr-status (safe+46) · #agpose-badge (safe+54) ·
//   #gps-warn (slabá GPS, safe+96) · #compass-interference (kompas rušen, 96px
//   BEZ safe-area → na telefonu s výřezem lezl přesně na #gps-warn).
// Sešly-li se dvě, prostě se překryly — nikdo je nekoordinoval.
//
// ŘEŠENÍ: nahoře je JEDNA sbalená pilulka a nic jiného.
//   • Svítí — prstenec pulsuje podle nejhoršího stavu — a ukazuje tu nejzávažnější
//     větu plus počet. Klepnutí ji rozjede na kartu se VŠEMI hláškami pod sebou.
//   • Každý řádek má svůj křížek, dole je „Beru na vědomí", které vyškrtne
//     všechno naráz. Vyškrtnuté se ozve, až se stav ZHORŠÍ (o paměť odklepnutí
//     se stará každý modul po svém — viz jejich onDismiss).
//   • Moduly hlásí stav přes window.AGNotify.set/clear, takže mají jednotný
//     vzhled: stejná pilulka, stejné písmo, barevná je jen tečka závažnosti.
//   • Cizí stavové štítky (kotva AR, terén DMR, štítek hosta) se ZRCADLÍ: originál
//     se odsune z dohledu (ne přes display — ten zůstává zdrojem pravdy o tom,
//     jestli má být vidět) a do karty jde běžné upozornění s převzatou akcí
//     („Zrušit" u kotvy, „Přihlásit" u hosta). Sbalí se a vyškrtne jako každé jiné.
//   • Stavový pruh #ag-sp se NEZRCADLÍ (umí se přesouvat a rozbalovat detail) —
//     karta se pod něj jen kotví podle jeho živé pozice.
//   • SUPPRESS: co je duplicita (slabá GPS × ztracená GPS), se neukazuje dvakrát.
//   • --ag-stack-h drží spodní hranu → #quick-toast a horní hinty jdou pod ni.
//   • Rozjetá karta se NIKDY nepoloží na ovládání: strop seznamu hlášek počítá
//     fitOpen() ze živé polohy svislé lišty #dock, zbytek roluje. Klepnutí mimo
//     kartu i půl minuty klidu ji zase sbalí.
//
// Odstranění: smaž js/upozorneni.js + řádek <script> v index.html (a přegeneruj
// sw.js). Moduly gps-warn / gps-trust / kompas-check si pak vykreslí vlastní
// pruhy jako dřív — fallback v nich zůstal.
// ================================================================================
(function () {
    'use strict';
    if (window.AGNotify) return;

    var STACK_ID = 'ag-stack', STYLE_ID = 'ag-stack-style', BOX_ID = 'ag-nbox';

    var _notes = {};                  // id -> {id,level,text,order,onAction,onDismiss,seq}
    var _seq = 0;
    var _expanded = false;            // je karta rozjetá?
    var _expandedTs = 0;              // kdy s ní uživatel naposled pracoval
    var AUTO_CLOSE_MS = 30000;        // po půl minutě klidu se karta sbalí sama

    // Duplicity: klíč se NEZOBRAZÍ, když je aktivní některé z uvedených id.
    // (Ztracený fix je nadřazený „slabé přesnosti" — obojí naráz je šum.)
    var SUPPRESS = { 'gps-acc': ['gps-fix'] };

    // ZRCADLENÉ prvky: stavové štítky, které si kreslí cizí moduly. Originál se
    // vizuálně schová (ale zůstane v DOM i „zobrazený", takže jeho vlastní logika
    // jede dál) a místo něj jde do karty běžné upozornění — sbalí se se všemi
    // ostatními a jde vyškrtnout křížkem jako každé jiné.
    //   act: popisek tlačítka v rozjeté kartě. 'btn' = převezmi tlačítko uvnitř
    //        originálu (kotva AR má „Zrušit"), jinak se klikne na prvek samotný.
    var MIRROR = [
        { sel: '#ag-guest-pill', id: 'guest', level: 'warn', act: 'Přihlásit' },
        { sel: '#agpose-badge', id: 'ar-anchor', level: 'ok', act: 'btn' },
        { sel: '#dmr-status', id: 'dmr', level: 'info', act: 'Co to je?' }
    ];
    var _mShown = {};                 // id -> text, který uživatel vyškrtl

    // Stavový pruh / bublina „Můžu měřit?" se NEzrcadlí: umí se přesouvat (AGHud)
    // a rozbalovat detail na místě. Místo toho se pod ni sloupec KOTVÍ podle její
    // živé pozice — funguje, ať je sbalená, rozbalená nebo přetažená jinam.
    var ANCHOR_SEL = '#ag-sp';

    var LVL = { danger: 0, warn: 10, ok: 20, info: 30 };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    // ---- styly -------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + STACK_ID + '{position:fixed;left:50%;transform:translateX(-50%);',
            // z-index 12000 = nejvyssi z puvodnich pruhu (drive #ag-gpst-bar), aby
            // sloupec nezmizel pod HUD panely (#info / #compass-debug / #gps-avg maji 9999).
            // Modaly (19999) a #quick-toast (1000002) zustavaji nad nim — zamerne.
            '  top:calc(env(safe-area-inset-top,0px) + 4px);z-index:12000;',
            '  display:flex;flex-direction:column;align-items:center;gap:5px;',
            '  width:max-content;max-width:min(92vw,460px);pointer-events:none;}',
            // Zrcadlené štítky: schovat z dohledu, ale NE přes display — vlastník
            // přes display pozná, jestli je má ukazovat, a to nám musí zůstat čitelné.
            '.ag-mirrored{position:fixed !important;left:-9999px !important;top:0 !important;',
            '  width:1px !important;height:1px !important;overflow:hidden !important;',
            '  opacity:0 !important;pointer-events:none !important;}',

            // ---- JEDNA hláška: sbalená pilulka, rozjetá karta ----
            '.ag-nbox{pointer-events:auto;box-sizing:border-box;width:max-content;max-width:100%;',
            '  overflow:hidden;border-radius:999px;',
            '  background:var(--glass-bg,rgba(18,22,28,0.90));',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));',
            '  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
            '  box-shadow:0 4px 16px rgba(0,0,0,0.40);',
            '  color:var(--text-color,#eceef2);font:600 12.5px/1.25 var(--font-ui,system-ui),sans-serif;',
            '  text-align:left;-webkit-tap-highlight-color:transparent;',
            '  transition:border-radius .18s ease, width .18s ease;',
            '  animation:ag-note-in .22s var(--ease-out,ease-out) both;}',
            '.ag-nbox.open{border-radius:16px;width:min(92vw,400px);}',
            '@keyframes ag-note-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}',

            // hlavička = to jediné, co je vidět sbalené
            '.ag-nhead{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;',
            '  padding:8px 10px 8px 12px;margin:0;border:0;background:none;color:inherit;',
            '  font:inherit;text-align:left;cursor:pointer;}',
            '.ag-nhead-tx{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.ag-ncount{flex:0 0 auto;min-width:19px;height:19px;padding:0 5px;box-sizing:border-box;',
            '  border-radius:10px;background:rgba(255,255,255,0.18);',
            '  font:800 10.5px/19px var(--font-ui,system-ui),sans-serif;text-align:center;}',
            '.ag-ncaret{flex:0 0 auto;width:13px;text-align:center;opacity:.6;line-height:1;',
            '  transition:transform .18s ease;}',
            '.ag-nbox.open .ag-ncaret{transform:rotate(180deg);}',
            '.ag-nhead:focus-visible{outline:2px solid var(--accent,#2f9e74);outline-offset:-2px;}',

            // rozjetý obsah
            '.ag-nlist{display:none;}',
            '.ag-nbox.open .ag-nlist{display:block;}',
            // OPRAVA 27. 7. — rozjetá karta se překrývala s Nástroji a Body.
            // PŘÍČINA: karta neměla žádný výškový strop — při víc hláškách (GPS, sever,
            // offline, host, kotva AR…) rostla od výřezu dolů přes celou horní polovinu
            // displeje a je široká min(92vw,400px), takže dosáhla až do dráhy svislé
            // lišty #dock (střed v 60 % výšky). ŘEŠENÍ: rolovací seznam řádků se
            // stropem, který počítá fitOpen() z živé polohy lišty; patička
            // („Beru na vědomí“) zůstává mimo rolování, ať je pořád po ruce.
            // touch-action:pan-y je nutný — html+body mají touch-action:none.
            '.ag-nrows{max-height:var(--ag-nrows-max,40vh);overflow-y:auto;overscroll-behavior:contain;',
            '  -webkit-overflow-scrolling:touch;touch-action:pan-y;}',
            '.ag-nrow{display:flex;align-items:flex-start;gap:9px;padding:9px 10px 9px 12px;cursor:pointer;',
            '  border-top:1px solid var(--glass-border,rgba(255,255,255,0.09));}',
            '.ag-nrow p{flex:1 1 auto;min-width:0;margin:0;font-size:calc(12.5px * var(--ag-font-scale, 1));line-height:1.4;font-weight:600;}',
            '.ag-nrow .ag-note-dot{margin-top:4px;}',
            '.ag-nact{flex:0 0 auto;padding:5px 10px;border-radius:99px;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.18));background:rgba(255,255,255,0.07);',
            '  color:inherit;font:600 11px/1 var(--font-ui,system-ui),sans-serif;white-space:nowrap;}',
            '.ag-nact:focus-visible{outline:2px solid var(--accent,#2f9e74);outline-offset:1px;}',
            '.ag-nfoot{display:flex;gap:7px;padding:9px 10px 10px;',
            '  border-top:1px solid var(--glass-border,rgba(255,255,255,0.09));}',
            '.ag-nbtn{flex:1 1 auto;padding:9px 10px;border-radius:10px;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:transparent;',
            '  color:var(--text-muted,#9aa1ac);font:600 12.5px/1 var(--font-ui,system-ui),sans-serif;}',
            '.ag-nbtn-primary{border-color:var(--accent-line,rgba(47,158,116,0.45));',
            '  background:var(--accent-soft,rgba(47,158,116,0.16));color:var(--accent-bright,#34d399);flex:1.4 1 auto;}',
            '.ag-nbtn:focus-visible{outline:2px solid var(--accent,#2f9e74);outline-offset:2px;}',

            // tečka závažnosti — jediný barevný prvek, tvar je u všech stejný
            '.ag-note-dot{flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:#9aa1ac;}',
            '.lvl-danger > .ag-nhead > .ag-note-dot,.ag-nrow.lvl-danger > .ag-note-dot{background:#fb7185;',
            '  box-shadow:0 0 7px rgba(251,113,133,0.9);animation:ag-note-blink 1.3s ease-in-out infinite;}',
            '.lvl-warn > .ag-nhead > .ag-note-dot,.ag-nrow.lvl-warn > .ag-note-dot{background:#fbbf24;',
            '  box-shadow:0 0 6px rgba(251,191,36,0.75);}',
            '.lvl-ok > .ag-nhead > .ag-note-dot,.ag-nrow.lvl-ok > .ag-note-dot{background:#34d399;',
            '  box-shadow:0 0 6px rgba(52,211,153,0.7);}',
            '@keyframes ag-note-blink{0%,100%{opacity:1}50%{opacity:0.3}}',
            '.ag-nbox.lvl-danger{border-color:rgba(251,113,133,0.55);}',
            '.ag-nbox.lvl-warn{border-color:rgba(251,191,36,0.50);}',
            '.ag-nbox.lvl-ok{border-color:rgba(52,211,153,0.45);}',

            // SVÍTÍ: sbalená hláška pulsuje prstencem, ať jde přehlédnout jen těžko.
            // Rozjetá už nesvítí — uživatel se na ni dívá.
            '.ag-nbox.lvl-danger:not(.open){animation:ag-note-in .22s var(--ease-out,ease-out) both,',
            '  ag-glow-danger 1.9s ease-in-out .3s infinite;}',
            '.ag-nbox.lvl-warn:not(.open){animation:ag-note-in .22s var(--ease-out,ease-out) both,',
            '  ag-glow-warn 2.4s ease-in-out .3s infinite;}',
            '@keyframes ag-glow-danger{0%,100%{box-shadow:0 4px 16px rgba(0,0,0,0.40),0 0 0 0 rgba(251,113,133,0.55);}',
            '  70%{box-shadow:0 4px 16px rgba(0,0,0,0.40),0 0 0 7px rgba(251,113,133,0);}}',
            '@keyframes ag-glow-warn{0%,100%{box-shadow:0 4px 16px rgba(0,0,0,0.40),0 0 0 0 rgba(251,191,36,0.45);}',
            '  70%{box-shadow:0 4px 16px rgba(0,0,0,0.40),0 0 0 6px rgba(251,191,36,0);}}',

            '.ag-note-x{flex:0 0 auto;width:24px;height:24px;padding:0;border:none;border-radius:50%;',
            '  background:rgba(255,255,255,0.14);color:inherit;font:700 14px/24px var(--font-ui,system-ui);',
            '  cursor:pointer;-webkit-tap-highlight-color:transparent;}',
            '.ag-note-x:focus-visible{outline:2px solid var(--accent,#2f9e74);outline-offset:1px;}',

            // ---- čitelnost: venkovní režim / rukavice ----
            'body.outdoor-mode .ag-nbox{background:#0a0e1a;border-width:2px;font-size:calc(13.5px * var(--ag-font-scale, 1));}',
            'body.light-mode.outdoor-mode .ag-nbox{background:#fff;color:#0a0e1a;}',
            'body.ag-glove .ag-nhead{padding:11px 12px 11px 15px;font-size:calc(13.5px * var(--ag-font-scale, 1));}',
            'body.ag-glove .ag-nrow{padding:12px;}',
            'body.ag-glove .ag-note-x{width:30px;height:30px;line-height:30px;}',
            'body.ag-glove .ag-nbtn{padding:12px 10px;}',
            '@media (prefers-reduced-motion: reduce){',
            '  .ag-nbox,.ag-nbox.lvl-danger:not(.open),.ag-nbox.lvl-warn:not(.open){animation:none;}',
            '  .lvl-danger > .ag-nhead > .ag-note-dot{animation:none;}}',

            // ---- co dřív leželo ve stejném pásmu, jde teď POD sloupec ----
            // --ag-stack-h = spodní hrana sloupce od horní hrany displeje (uz vcetne
            // safe-area); max() drzi rozumnou polohu i kdyby promenna chybela
            '#quick-toast,#update-banner,#map-pick-hint,#connect-hint{',
            '  top:max(calc(env(safe-area-inset-top,0px) + 10px), calc(var(--ag-stack-h,0px) + 10px)) !important;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- sloupec -------------------------------------------------------------------
    function ensureStack() {
        var el = document.getElementById(STACK_ID);
        if (el) return el;
        if (!document.body) return null;
        el = document.createElement('div');
        el.id = STACK_ID;
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
        return el;
    }

    // ---- zrcadlení cizích stavových štítků -------------------------------------------
    // Text prvku bez tlačítek a ikon (moduly do štítku vkládají i „Zrušit" apod.).
    function textOf(el) {
        var c = el.cloneNode(true);
        var junk = c.querySelectorAll('button, svg');
        for (var i = 0; i < junk.length; i++) junk[i].remove();
        return (c.textContent || '').replace(/\s+/g, ' ').trim();
    }
    // Vlastník štítku ho zobrazuje/skrývá přes display. Schováváme ho JINAK než
    // display:none (odsunutím z dohledu), aby nám jeho vlastní přepínání dál
    // fungovalo jako zdroj pravdy o tom, jestli má být vidět.
    function ownerShows(el) {
        try { return getComputedStyle(el).display !== 'none'; } catch (e) { return true; }
    }

    var _syncing = false;
    function syncMirrors() {
        _syncing = true;
        try {
            MIRROR.forEach(function (m) {
                var el = document.querySelector(m.sel);
                if (!el || !ownerShows(el)) {           // štítek zmizel → zapomeň i odklepnutí
                    delete _mShown[m.id];
                    if (_notes[m.id]) clear(m.id);
                    return;
                }
                el.classList.add('ag-mirrored');
                var txt = textOf(el);
                if (!txt) { if (_notes[m.id]) clear(m.id); return; }
                if (_mShown[m.id] === txt) { if (_notes[m.id]) clear(m.id); return; }   // vyškrtnuto

                var action = null;
                var btn = (m.act === 'btn') ? el.querySelector('button') : null;
                if (btn) action = { label: (btn.textContent || 'Zrušit').trim(), fn: function () { btn.click(); } };
                else if (m.act && m.act !== 'btn') action = { label: m.act, fn: function () { el.click(); } };

                set(m.id, {
                    level: m.level, text: txt, action: action,
                    onDismiss: (function (id, t) { return function () { _mShown[id] = t; }; })(m.id, txt)
                });
            });
        } catch (e) {}
        _syncing = false;
    }

    // ---- výběr toho, co se ukáže ------------------------------------------------------
    function activeNotes() {
        var ids = Object.keys(_notes), out = [], i, j;
        for (i = 0; i < ids.length; i++) {
            var n = _notes[ids[i]];
            var sup = SUPPRESS[n.id], skip = false;
            if (sup) for (j = 0; j < sup.length; j++) { if (_notes[sup[j]]) { skip = true; break; } }
            if (!skip) out.push(n);
        }
        out.sort(function (a, b) {
            var d = (LVL[a.level] == null ? 30 : LVL[a.level]) - (LVL[b.level] == null ? 30 : LVL[b.level]);
            if (d) return d;
            d = (a.order || 0) - (b.order || 0);
            return d || (a.seq - b.seq);
        });
        return out;
    }

    // ---- vykreslení ---------------------------------------------------------------------
    // JEDNA sbalená hláška, která svítí (puls podle nejhoršího stavu). Klepnutím
    // se rozjede karta se VŠEMI upozorněními — každé s vlastním křížkem — a dole
    // s „Beru na vědomí", které vyškrtne všechna naráz.
    function dismissNote(n) {
        if (typeof n.onDismiss === 'function') { try { n.onDismiss(); } catch (e) {} }
        clear(n.id);
    }
    function adviseFor(n) {
        if (n && typeof n.onAction === 'function') { try { n.onAction(); } catch (e) {} return; }
        // jedno místo, které poradí co dál (GPS · sever · data · baterie)
        try { if (window.AGStatusBar && AGStatusBar.open) AGStatusBar.open(); } catch (e) {}
    }
    // sbalená ukazuje NEJHORŠÍ hlášku, rozjetá jen počet (texty jsou pod ní)
    function headText(list, worst) {
        return _expanded ? (list.length + ' upozornění') : worst.text;
    }
    // Otisk STRUKTURY karty. Texty se mění po sekundě („GPS ztracena 45 s"), ale
    // dokud sedí složení a stavy, karta se jen přepíše — nepřestavuje se, takže
    // se nerestartuje animace ani nezmizí zaměření z tlačítka pod prstem.
    function sigOf(list) {
        return (_expanded ? 'o|' : 'c|') + list.map(function (n) { return n.id + ':' + n.level; }).join(',');
    }
    function patchBox(box, list) {
        var tx = box.querySelector('.ag-nhead-tx');
        if (tx) tx.textContent = headText(list, list[0]);
        var ps = box.querySelectorAll('.ag-nrow p');
        for (var i = 0; i < ps.length && i < list.length; i++) ps[i].textContent = list[i].text;
    }

    function buildBox(list) {
        var worst = list[0];
        var lvl = LVL[worst.level] != null ? worst.level : 'info';

        var box = document.createElement('div');
        box.id = BOX_ID;
        box.className = 'ag-nbox lvl-' + lvl + (_expanded ? ' open' : '');
        box.style.order = '5';

        // ---- hlavička: to, co je vidět sbalené ----
        var head = document.createElement('button');
        head.type = 'button';
        head.className = 'ag-nhead';
        head.setAttribute('aria-expanded', _expanded ? 'true' : 'false');
        head.setAttribute('aria-label', _expanded ? 'Sbalit upozornění' : ('Rozbalit upozornění (' + list.length + ')'));
        head.innerHTML = '<span class="ag-note-dot"></span>'
            + '<span class="ag-nhead-tx"></span>'
            + (list.length > 1 && !_expanded ? '<span class="ag-ncount">' + list.length + '</span>' : '')
            + '<span class="ag-ncaret" aria-hidden="true">⌄</span>';
        head.querySelector('.ag-nhead-tx').textContent = headText(list, worst);
        head.addEventListener('click', function () { _expanded = !_expanded; _expandedTs = Date.now(); render(); });
        box.appendChild(head);

        // ---- rozjeté: všechna upozornění pod sebou ----
        var body = document.createElement('div');
        body.className = 'ag-nlist';
        // řádky mají vlastní rolovací obal — patička s „Beru na vědomí“ zůstává vidět
        var rows = document.createElement('div');
        rows.className = 'ag-nrows';
        list.forEach(function (n) {
            var row = document.createElement('div');
            row.className = 'ag-nrow lvl-' + (LVL[n.level] != null ? n.level : 'info');
            row.innerHTML = '<span class="ag-note-dot"></span><p></p>';
            row.querySelector('p').textContent = n.text;
            // vlastní akce štítku (např. „Zrušit" u kotvy AR, „Přihlásit" u hosta)
            if (n.action && typeof n.action.fn === 'function') {
                var act = document.createElement('button');
                act.type = 'button'; act.className = 'ag-nact';
                act.textContent = n.action.label || 'Otevřít';
                act.addEventListener('click', function (ev) { ev.stopPropagation(); try { n.action.fn(); } catch (e) {} });
                row.appendChild(act);
            }
            var x = document.createElement('button');
            x.type = 'button'; x.className = 'ag-note-x';
            x.setAttribute('aria-label', 'Vyškrtnout: ' + n.text);
            x.textContent = '×';
            x.addEventListener('click', function (ev) { ev.stopPropagation(); dismissNote(n); });
            row.appendChild(x);
            row.addEventListener('click', function () { adviseFor(n); });
            rows.appendChild(row);
        });
        body.appendChild(rows);

        var foot = document.createElement('div');
        foot.className = 'ag-nfoot';
        var ok = document.createElement('button');
        ok.type = 'button'; ok.className = 'ag-nbtn ag-nbtn-primary';
        ok.textContent = 'Beru na vědomí';
        ok.addEventListener('click', function () { dismissAll(); });
        var help = document.createElement('button');
        help.type = 'button'; help.className = 'ag-nbtn';
        help.textContent = 'Co s tím?';
        help.addEventListener('click', function () { adviseFor(null); });
        foot.appendChild(ok); foot.appendChild(help);
        body.appendChild(foot);

        box.appendChild(body);
        return box;
    }

    // ---- SLOUČENÝ PRUH (návrh 1) --------------------------------------------------
    // Nahoře byly DVA pruhy nad sebou: stavový pruh #ag-sp (přesnost + azimut) a pod
    // ním tahle sbalená pilulka s nejzávažnější hláškou. Dohromady 73 px nad AR
    // obrazem a dva hlasy naráz. Teď platí: dokud je karta SBALENÁ, text hlášky si
    // ukáže sám stavový pruh (čte ho přes AGNotify.worst) a tahle pilulka se
    // nekreslí vůbec. Po rozbalení (z pruhu přes AGNotify.expand) se karta se všemi
    // hláškami vykreslí jako dřív — tam se nic nemění.
    // Když stavový pruh není (vypnutý v Nastavení → Vzhled, nebo soubor smazaný),
    // merged() je false a pilulka se kreslí jako dřív. Žádná hláška se neztratí.
    function merged() {
        var sp = document.getElementById('ag-sp');
        return !!(sp && sp.classList.contains('ag-sp-on'));
    }

    function render() {
        injectStyles();
        var stack = ensureStack();
        if (!stack) return;

        var old = stack.querySelector('#' + BOX_ID);
        var list = activeNotes();

        if (!list.length) {
            if (old) old.remove();
            _expanded = false;
            measure(stack);
            nudgeBar();
            return;
        }
        if (merged() && !_expanded) {
            if (old) old.remove();
            measure(stack);
            nudgeBar();               // pruh si text vyzvedne sám
            return;
        }
        var sig = sigOf(list);
        if (old && old.getAttribute('data-sig') === sig) { patchBox(old, list); measure(stack); return; }

        if (old) old.remove();
        var box = buildBox(list);
        box.setAttribute('data-sig', sig);
        stack.appendChild(box);
        measure(stack);
    }

    // „Vezmu to na vědomí" — vyškrtne VŠECHNO naráz, včetně potlačených duplicit,
    // ať se hned nevynoří to, co jen stálo ve stínu jiné hlášky. Moduly si svoje
    // odklepnutí pamatují po svém (gps-warn se ozve při výrazném zhoršení,
    // gps-trust při jiné závadě, kompas až po restartu appky).
    function dismissAll() {
        var ids = Object.keys(_notes);
        _expanded = false;
        ids.forEach(function (id) {
            var n = _notes[id];
            if (n && typeof n.onDismiss === 'function') { try { n.onDismiss(); } catch (e) {} }
        });
        _notes = {};
        render();
        try {
            if (typeof window.quickToast === 'function') {
                quickToast('Upozornění skryta. Stav měření kdykoli zjistíš klepnutím na pruh nahoře.');
            }
        } catch (e) {}
    }

    // Ukotvení pod stavovou bublinu + hlášení výšky sloupce ven (--ag-stack-h),
    // aby se pod něj posunul #quick-toast a horní hinty.
    function measure(stack) {
        if (!stack) return;
        try {
            var sp = document.querySelector(ANCHOR_SEL);
            var top = null;
            if (sp && !stack.contains(sp)) {
                var r = sp.getBoundingClientRect();
                // jen když je bublina vidět a leží ve svislém pruhu uprostřed, kde je sloupec
                if (r.height > 0 && r.width > 0) {
                    var cx = window.innerWidth / 2;
                    if (r.left < cx + 60 && r.right > cx - 60) top = Math.round(r.bottom + 6);
                }
            }
            if (top != null) stack.style.top = top + 'px';
            else if (stack.style.top) stack.style.top = '';   // zpět na CSS (safe-area + 4px)

            fitOpen(stack);

            var rect = stack.getBoundingClientRect();
            // výška od horní hrany displeje po konec sloupce — o tolik se odsune zbytek
            var used = Math.max(0, Math.round(rect.bottom));
            document.documentElement.style.setProperty('--ag-stack-h', used + 'px');
            watchAnchor(sp, stack);
        } catch (e) {}
    }

    // Strop rozjeté karty, aby se nepoložila na svislou lištu ovládání (#dock).
    // Počítá se ze živé polohy lišty — ta se stěhuje podle režimu levé ruky, výšky
    // displeje i počtu chipů, takže pevná hodnota v CSS by nikdy neseděla všude.
    // Bez lišty (odpojený dok) drží strop spodní hrana okna.
    function fitOpen(stack) {
        if (!_expanded) return;                 // sbalena karta zadny strop nepotrebuje
        try {
            var rows = stack.querySelector('.ag-nrows');
            if (!rows) return;
            var top = rows.getBoundingClientRect().top;
            var limit = window.innerHeight;
            var dock = document.getElementById('dock');
            if (dock) {
                var dr = dock.getBoundingClientRect();
                if (dr.height > 0 && dr.width > 0 && dr.top > top + 60) limit = Math.min(limit, dr.top);
            }
            var foot = stack.querySelector('.ag-nfoot');
            var footH = foot ? foot.getBoundingClientRect().height : 0;
            rows.style.maxHeight = Math.max(120, Math.round(limit - top - footH - 12)) + 'px';
        } catch (e) {}
    }

    // Bublina mění velikost (rozbalený detail) i polohu (tažení) — sleduj obojí,
    // ať se sloupec nepřekryje dřív, než doběhne periodický tik.
    var _watched = null, _ro = null, _mo = null;
    function watchAnchor(sp, stack) {
        if (!sp || sp === _watched) return;
        _watched = sp;
        try { if (_ro) _ro.disconnect(); } catch (e) {}
        try { if (_mo) _mo.disconnect(); } catch (e) {}
        var relayout = function () { try { measure(document.getElementById(STACK_ID)); } catch (e) {} };
        if (typeof ResizeObserver === 'function') {
            _ro = new ResizeObserver(relayout); _ro.observe(sp);
        }
        if (typeof MutationObserver === 'function') {
            _mo = new MutationObserver(relayout);
            _mo.observe(sp, { attributes: true, attributeFilter: ['style', 'class'] });
        }
    }

    // ---- veřejné API -----------------------------------------------------------------------
    // AGNotify.set(id, {level:'danger'|'warn'|'ok'|'info', text, order, action:{label,fn},
    //                   onAction, onDismiss})
    // Opakované volání se stejným textem nic nepřekresluje (moduly tikají po sekundě).
    function set(id, opt) {
        if (!id || !opt || !opt.text) return;
        var lvl = LVL[opt.level] != null ? opt.level : 'info';
        var prev = _notes[id];
        if (prev && prev.text === opt.text && prev.level === lvl) {
            prev.onAction = opt.onAction; prev.onDismiss = opt.onDismiss;
            if (opt.action) prev.action = opt.action;
            return;                                   // beze změny — nepřekresluj
        }
        _notes[id] = {
            id: id, level: lvl, text: opt.text, order: opt.order || 0,
            action: opt.action || null,
            onAction: opt.onAction, onDismiss: opt.onDismiss,
            seq: prev ? prev.seq : (++_seq)
        };
        if (!_syncing) render();
    }
    function clear(id) {
        if (!_notes[id]) return;
        delete _notes[id];
        if (!_syncing) render();
    }
    function has(id) { return !!_notes[id]; }

    // Stavový pruh si text hlášky kreslí sám (viz merged()), takže po každé změně
    // seznamu potřebuje překreslit. Zavolat ho MUSÍME asynchronně: render() běží
    // i z AGNotify.set(), který volají moduly uprostřed svého ticku, a AGStatusBar
    // .refresh() by se jim zavolal zpátky do zásobníku.
    function nudgeBar() {
        if (!window.AGStatusBar || typeof AGStatusBar.refresh !== 'function') return;
        if (nudgeBar._t) return;
        nudgeBar._t = setTimeout(function () {
            nudgeBar._t = 0;
            try { AGStatusBar.refresh(); } catch (e) {}
        }, 0);
    }

    window.AGNotify = {
        set: set, clear: clear, has: has, render: render,
        // Nejzávažnější hláška pro sloučený pruh: stejný text i úroveň, jaké by
        // měla sbalená pilulka. count = kolik hlášek celkem visí.
        worst: function () {
            var list = activeNotes();
            if (!list.length) return null;
            var w = list[0];
            return {
                text: headText(list, w),
                level: (LVL[w.level] != null ? w.level : 'info'),
                count: list.length
            };
        },
        // Rozbalení karty ZVENČÍ (ze stavového pruhu). Bez argumentu jen otevře.
        expand: function () {
            if (!activeNotes().length) return false;
            _expanded = true;
            _expandedTs = Date.now();
            render();
            return true;
        }
    };

    // ---- život modulu -------------------------------------------------------------------------
    // Tik dorovnává zrcadlené štítky (vznikají později než tenhle modul) a výšku
    // sloupce. Vlastní upozornění si moduly hlásí samy přes set/clear.
    function tick() {
        try {
            injectStyles();
            var stack = ensureStack();
            if (!stack) return;
            syncMirrors();
            // rozjetá karta a půl minuty bez doteku → sbalit, ať nestíní ovládání
            if (_expanded && _expandedTs && (Date.now() - _expandedTs) > AUTO_CLOSE_MS) _expanded = false;
            render();
            measure(stack);
        } catch (e) {}
    }
    function init() {
        try {
            injectStyles();
            tick();
            if (!window.__agStackTimer) {
                window.__agStackTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 1200);
            }
        } catch (e) { console.warn('[upozorneni] init', e); }
    }
    // Klepnutí mimo kartu ji sbalí (stejně jako u stavové bubliny), práce uvnitř
    // naopak odkládá auto-sbalení — uživatel si může číst, jak dlouho potřebuje.
    if (!window.__agStackOutside) {
        window.__agStackOutside = true;
        document.addEventListener('pointerdown', function (e) {
            if (!_expanded) return;
            try {
                if (e.target && e.target.closest && e.target.closest('#' + STACK_ID)) { _expandedTs = Date.now(); return; }
            } catch (err) { return; }
            _expanded = false;
            render();
        }, true);
        document.addEventListener('scroll', function (e) {
            if (!_expanded) return;
            try { if (e.target && e.target.closest && e.target.closest('#' + STACK_ID)) _expandedTs = Date.now(); } catch (err) {}
        }, true);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });
    window.addEventListener('resize', function () { try { measure(ensureStack()); } catch (e) {} });
})();
