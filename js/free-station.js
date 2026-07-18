// ===== AR Geodet — VOLNÉ STANOVISKO: průvodce (ODPOJITELNÁ vrstva) ============
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js. Spojuje do JEDNOHO toku
// tři kroky „volného stanoviska měřeného telefonem":
//
//   1) Založ 2–5 VLASTNÍCH bodů kolem sebe (GPS) — projdeš je a na každém necháš
//      telefon zprůměrovat polohu. (Přesné přes „Brutální GPS", nebo rychle „Vložit bod".)
//   2) Postav se na stanovisko a přes kameru POSTUPNĚ zaměř každý z těch bodů.
//   3) Z rozdílů azimutů appka spočítá tvoji polohu (stanovisko) + srovná sever.
//
//   Kroky 2 a 3 provádí sdílený, ověřený engine AR RESEKCE (js/ar-resection.js) —
//   tenhle průvodce jen dovede uživatele od založení bodů k zaměření, aby nemusel
//   skládat tři nástroje dohromady sám. Bez ar-resection.js průvodce nabídne aspoň
//   založení bodů a upozorní, že zaměřovací část chybí.
//
// Vstup: dlaždice „Volné stanovisko (průvodce)" v Nástrojích; když launcher chybí,
//        modul si vyrobí vlastní plovoucí tlačítko.
// Odstranění: smaž js/free-station.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>';

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }

    // počet vlastních (uživatelských) bodů v zakázce — z persistentCustomPoints
    function customCount() {
        try { if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) return persistentCustomPoints.length; } catch (e) {}
        try { if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) return arPoints.filter(function (p) { return p && p.cat === 'CUSTOM'; }).length; } catch (e) {}
        return 0;
    }

    function ensureModal() {
        if (document.getElementById('agfs-modal')) return;
        injectStyles();
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agfs-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Volné stanovisko — průvodce</h3>'
            + '<p style="font-size:12.5px;opacity:.85;margin:2px 0 12px;line-height:1.5;">Urči svou polohu (stanovisko) na místě, kde nejsou žádné úřední body — '
            + 'z vlastních bodů, které si sám založíš GPS a pak na ně zaměříš. Rozdíly azimutů ruší chybu kompasu, '
            + 'takže výsledek je přesnější než samotná GPS.</p>'

            + '<div class="agfs-step">'
            + '  <div class="agfs-step-h"><span class="agfs-num">1</span> Založ 2–5 vlastních bodů kolem sebe (GPS)</div>'
            + '  <div class="agfs-note">Projdi 2–5 dobře viditelných míst kolem budoucího stanoviska (rohy, patníky, sloupky). '
            + '  Na každém nech telefon chvíli stát a zprůměrovat polohu. Čím dál od sebe a čím lépe rozmístěné (ne v řadě), tím přesnější stanovisko.</div>'
            + '  <div class="agfs-count" id="agfs-count"></div>'
            + '  <button class="btn btn-blue" id="agfs-brutal"><svg class="icon"><use href="#i-satellite"/></svg> Přesný GPS bod (doporučeno)</button>'
            + '  <button class="btn btn-secondary" id="agfs-quick" style="margin-top:8px;"><svg class="icon"><use href="#i-plus"/></svg> Rychlé zadání bodu</button>'
            + '</div>'

            + '<div class="agfs-step" style="margin-top:12px;">'
            + '  <div class="agfs-step-h"><span class="agfs-num">2</span> Postav se na stanovisko a zaměř body</div>'
            + '  <div class="agfs-note">Až máš aspoň 3 body (2 srovnají jen sever), postav se na místo, odkud je uvidíš, '
            + '  a přes kameru postupně zaměř každý z nich. Výpočet i srovnání severu provede AR resekce.</div>'
            + '  <div id="agfs-warn" class="agfs-warn"></div>'
            + '  <button class="btn" id="agfs-go"><svg class="icon"><use href="#i-crosshair"/></svg> Pokračovat na zaměření →</button>'
            + '</div>'

            + '<button class="btn btn-secondary" style="margin-top:14px;" onclick="window.agCloseFreeStation&&window.agCloseFreeStation()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        document.getElementById('agfs-brutal').addEventListener('click', function () {
            // Brutální GPS má overlay z-index 100002 (NAD průvodcem 100001, plně neprůhledný),
            // takže průvodce NEskrýváme — po zavření GPS se uživatel vrátí rovnou sem a počet
            // bodů se sám obnoví (agfs live timer). Fallback (vložit bod) je core modál POD
            // průvodcem, ten skrýt musíme.
            if (typeof window.agOpenBrutalGps === 'function') { window.agOpenBrutalGps(); }
            else if (typeof openNewPointModal === 'function') { hide(); openNewPointModal(); }
            else agAlert('Nedostupné', 'Nástroj pro založení GPS bodu není k dispozici.');
        });
        document.getElementById('agfs-quick').addEventListener('click', function () {
            if (typeof openNewPointModal === 'function') { hide(); openNewPointModal(); }
            else agAlert('Nedostupné', 'Formulář pro vložení bodu není k dispozici.');
        });
        document.getElementById('agfs-go').addEventListener('click', function () {
            var n = customCount();
            if (n < 2) { agAlert('Málo bodů', 'Nejdřív založ aspoň 2 vlastní body (ideálně 3+). Zatím jich máš ' + n + '.'); return; }
            if (typeof window.agOpenResection !== 'function') { agAlert('Nedostupné', 'Zaměřovací část (AR resekce) není v této verzi k dispozici. Body ale máš založené — zaměř je v nástroji AR resekce.'); return; }
            hide();
            window.agOpenResection();
        });
    }

    function render() {
        var n = customCount();
        var cnt = document.getElementById('agfs-count');
        if (cnt) {
            var col = n >= 3 ? '#34d399' : (n >= 2 ? '#fbbf24' : '#9aa1ac');
            cnt.innerHTML = 'Vlastních bodů v zakázce: <b style="color:' + col + '">' + n + '</b>'
                + (n >= 3 ? ' <span style="opacity:.7">— stačí na výpočet polohy</span>'
                    : n >= 2 ? ' <span style="opacity:.7">— 2 srovnají jen sever, přidej 3.</span>'
                        : ' <span style="opacity:.7">— potřebuješ aspoň 2 (ideálně 3+).</span>');
        }
        var warn = document.getElementById('agfs-warn'), go = document.getElementById('agfs-go');
        if (warn) warn.innerHTML = n < 2 ? 'Zatím nemáš dost vlastních bodů — dokonči krok 1.'
            : (n < 3 ? 'Se 2 body appka srovná jen sever. Pro výpočet polohy stanoviska přidej 3. bod.' : '');
        if (go) go.disabled = n < 2;
    }

    function hide() { var m = document.getElementById('agfs-modal'); if (m) m.style.display = 'none'; }

    var _liveTimer = null;
    function openTool() {
        ensureModal(); render();
        document.getElementById('agfs-modal').style.display = 'flex';
        // po návratu ze zakládání bodů (brutal-gps / vložit bod) obnovit počet
        if (!_liveTimer) _liveTimer = setInterval(function () {
            var m = document.getElementById('agfs-modal');
            if (m && m.style.display === 'flex') render();
        }, 700);
    }
    window.agCloseFreeStation = function () { hide(); if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; } };
    window.agOpenFreeStation = openTool;

    function injectStyles() {
        if (document.getElementById('agfs-style')) return;
        var st = document.createElement('style'); st.id = 'agfs-style';
        st.textContent = [
            '#agfs-modal .agfs-step{border:1px solid var(--glass-border,rgba(255,255,255,0.12));border-radius:12px;padding:12px 14px;background:rgba(255,255,255,0.025);}',
            '#agfs-modal .agfs-step-h{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:var(--text-color,#e8edf2);margin-bottom:6px;}',
            '#agfs-modal .agfs-num{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:var(--accent,#2f9e74);color:#04110b;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:800;}',
            '#agfs-modal .agfs-note{font-size:12px;opacity:.8;line-height:1.5;margin-bottom:10px;}',
            '#agfs-modal .agfs-count{font-size:13px;margin:6px 0 10px;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,0.18);}',
            '#agfs-modal .agfs-warn{font-size:12px;color:#fbbf24;margin:2px 0 8px;min-height:1px;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- registrace do launcheru + fallback tlačítko --------------------------
    function register() {
        injectStyles();
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'free-station', label: 'Volné stanovisko (průvodce)', icon: ICON, cat: 'AR a kalibrace', onClick: openTool, order: 4 });
        } else {
            ensureFallbackFab();
        }
    }
    function ensureFallbackFab() {
        if (document.getElementById('agfs-fab') || typeof window.agRegisterFieldTool === 'function') return;
        var b = document.createElement('button'); b.id = 'agfs-fab'; b.type = 'button';
        b.title = 'Volné stanovisko'; b.innerHTML = ICON;
        b.style.cssText = 'position:fixed;left:12px;bottom:324px;z-index:99990;width:48px;height:48px;border:none;border-radius:14px;background:var(--accent,#2f9e74);color:#04110b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);';
        b.querySelector('svg').style.cssText = 'width:24px;height:24px;';
        b.addEventListener('click', openTool);
        if (document.body) document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
