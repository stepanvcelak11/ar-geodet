// ===== AR Geodet — VÝROBA KLÍČŮ PRO (ODPOJITELNÁ vrstva, jen pro vlastníka) ===
// Kdo prodá licenci, potřebuje klíč vyrobit. Tenhle modul je ta dílna: v režimu
// vlastníka přibude ve „Více“ položka „Klíče Pro“, kde se zadá pořadové číslo a
// délka platnosti a vypadne klíč k opsání nebo poslání.
//
// ⚠ VYRÁBÍ SE TOUTÉŽ FUNKCÍ, KTEROU SE KLÍČ OVĚŘUJE (AGLic.vyrob z js/licence.js).
//   Kdyby si dílna počítala podpis po svém, rozešly by se dvě strany, které se
//   nikdy nepotkají — vlastník by rozdal klíče a poznal by to až od naštvaných
//   lidí. Proto tady žádná kryptografie není, jen formulář. Že obě strany sedí,
//   hlídá scripts/test_licence.py (podepíše klíč v Pythonu a nechá ho ověřit
//   appkou).
//
// ⚠ POŘADOVÉ ČÍSLO SI MUSÍ VLASTNÍK HLÍDAT SÁM. Appka neví, komu už jaké číslo
//   vydal — nemá kam, klíče žádný server neeviduje (to je celá pointa ověření
//   bez signálu). Modul si proto aspoň pamatuje POSLEDNÍ POUŽITÉ ČÍSLO v tomhle
//   telefonu a příště nabídne další v řadě. Komu který patří, si vlastník zapíše
//   vedle — dokud nebude odvolávání klíčů, je to jen poznámka pro něj.
//
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + './js/pro-klice.js'
// v sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGProKlice) return;

    var MODAL_ID = 'ag-pk-modal';
    var LS_POSL = 'agProPosledniCislo_v1';
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="14" r="4"/><path d="M11 12l8-8 2 2-2 2 2 2-2 2-2-2-2 2"/></svg>';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'pro-klice:' + kde); } catch (x) { } }
    function vlastnik() { try { return !!(window.AGVlastnik && AGVlastnik.isOn()); } catch (e) { return false; } }

    function posledni() {
        try { return parseInt(localStorage.getItem(LS_POSL) || '0', 10) || 0; } catch (e) { return 0; }
    }
    function zapisPosledni(n) {
        try { localStorage.setItem(LS_POSL, String(n)); } catch (e) { swallow(e, 'zapisPosledni'); }
    }

    function styly() {
        if (document.getElementById('ag-pk-style')) return;
        try {
            var st = document.createElement('style');
            st.id = 'ag-pk-style';
            st.textContent = [
                '#' + MODAL_ID + '{position:fixed;inset:0;z-index:100070;display:none;align-items:center;',
                '  justify-content:center;padding:16px;background:rgba(0,0,0,.62);}',
                '#' + MODAL_ID + '.on{display:flex;}',
                '#' + MODAL_ID + ' .pk-box{width:min(400px,94vw);border-radius:16px;padding:18px;',
                '  background:var(--modal-bg,#141a26);color:var(--text-color,#e9eef7);',
                '  border:1px solid var(--glass-border,rgba(255,255,255,.12));}',
                'body.light-mode #' + MODAL_ID + ' .pk-box{background:#fff;color:#16202e;}',
                '#' + MODAL_ID + ' h2{margin:0 0 12px;font-size:calc(17px * var(--ag-font-scale,1));}',
                '#' + MODAL_ID + ' label{display:block;margin:10px 0 4px;font-size:calc(12.5px * var(--ag-font-scale,1));opacity:.8;}',
                '#' + MODAL_ID + ' input,#' + MODAL_ID + ' select{width:100%;box-sizing:border-box;padding:10px 11px;',
                '  border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,.16));',
                '  background:rgba(0,0,0,.18);color:inherit;font:inherit;}',
                'body.light-mode #' + MODAL_ID + ' input,body.light-mode #' + MODAL_ID + ' select{background:#f4f6fa;}',
                '#' + MODAL_ID + ' .pk-out{margin:14px 0 0;padding:13px;border-radius:11px;text-align:center;',
                '  background:var(--accent-soft,rgba(47,158,116,.14));font-size:calc(17px * var(--ag-font-scale,1));',
                '  font-weight:700;letter-spacing:.06em;word-break:break-all;user-select:all;-webkit-user-select:all;}',
                '#' + MODAL_ID + ' .pk-rada{display:flex;gap:9px;margin-top:14px;}',
                '#' + MODAL_ID + ' .pk-rada button{flex:1 1 0;padding:11px;border-radius:11px;font:inherit;font-weight:600;',
                '  cursor:pointer;border:1px solid var(--glass-border,rgba(255,255,255,.16));background:transparent;color:inherit;}',
                '#' + MODAL_ID + ' .pk-rada button.hlavni{background:var(--accent,#2f9e74);border-color:transparent;color:#fff;}'
            ].join('\n');
            (document.head || document.documentElement).appendChild(st);
        } catch (e) { swallow(e, 'styly'); }
    }

    function build() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        styly();
        m = document.createElement('div');
        m.id = MODAL_ID;
        m.innerHTML =
            '<div class="pk-box" role="dialog" aria-modal="true">' +
            '  <h2>Klíče Pro</h2>' +
            '  <label for="pk-cislo">Pořadové číslo klíče (piš si vedle, komu patří)</label>' +
            '  <input id="pk-cislo" type="number" min="0" max="65535" inputmode="numeric">' +
            '  <label for="pk-dni">Platnost</label>' +
            '  <select id="pk-dni">' +
            '    <option value="0">natrvalo</option>' +
            '    <option value="365">1 rok</option>' +
            '    <option value="730">2 roky</option>' +
            '    <option value="30">30 dní (zkouška)</option>' +
            '  </select>' +
            '  <div class="pk-out" id="pk-out">—</div>' +
            '  <div class="pk-rada">' +
            '    <button type="button" id="pk-zavri">Zavřít</button>' +
            '    <button type="button" class="hlavni" id="pk-vyrob">Vyrobit</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('on'); });
        m.querySelector('#pk-zavri').addEventListener('click', function () { m.classList.remove('on'); });
        m.querySelector('#pk-vyrob').addEventListener('click', vyrob);
        return m;
    }

    function vyrob() {
        var m = build();
        var out = m.querySelector('#pk-out');
        if (!window.AGLic || !AGLic.vyrob) { out.textContent = 'Licence v téhle verzi appky není.'; return; }
        var cislo = parseInt(m.querySelector('#pk-cislo').value, 10);
        if (!(cislo >= 0 && cislo <= 65535)) { out.textContent = 'Číslo musí být 0 až 65535.'; return; }
        var dni = parseInt(m.querySelector('#pk-dni').value, 10) || 0;
        var klic = AGLic.vyrob(cislo, dni);
        out.textContent = klic;
        zapisPosledni(cislo);
        // Ověř si vlastní výrobek hned tady. Kdyby se výroba a ověření někdy
        // rozešly, ať to vlastník pozná dřív, než klíč pošle, ne až od zákazníka.
        var z = AGLic.over(klic);
        if (!z || !z.ok) out.textContent = klic + '  ⚠ tenhle klíč appka nepřijímá!';
        try { if (navigator.clipboard) navigator.clipboard.writeText(klic); } catch (e) { swallow(e, 'schranka'); }
    }

    function open() {
        var m = build();
        m.querySelector('#pk-cislo').value = String(posledni() + 1);
        m.querySelector('#pk-out').textContent = '—';
        m.classList.add('on');
    }

    // Vstup ve „Více“, jen v režimu vlastníka. Kontroluje se při každém tiku,
    // protože do režimu vlastníka se dá vstoupit i za běhu (dlouhý stisk znaku).
    function injectMenu() {
        var menu = document.getElementById('side-menu');
        if (!menu) return;
        var b = document.getElementById('ag-pk-menu-btn');
        if (!vlastnik()) { if (b) b.remove(); return; }
        if (b) return;
        var host = menu.querySelector('.menu-scroll') || menu;
        b = document.createElement('button');
        b.id = 'ag-pk-menu-btn'; b.className = 'menu-btn'; b.type = 'button';
        b.innerHTML = '<span style="display:inline-block;width:18px;height:18px;vertical-align:-3px;">' + ICON + '</span> Klíče Pro';
        b.addEventListener('click', function () {
            try { if (typeof toggleMenu === 'function' && menu.classList.contains('open')) toggleMenu(); } catch (e) { swallow(e, 'injectMenu'); }
            open();
        });
        var after = document.getElementById('ag-pro-menu-btn');
        if (after && after.parentNode) after.parentNode.insertBefore(b, after.nextSibling);
        else host.appendChild(b);
    }

    setInterval(injectMenu, 2000);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectMenu);
    else injectMenu();

    window.AGProKlice = { open: open, vyrob: vyrob };
})();
