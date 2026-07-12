// ===== AR Geodet — SKRYTÉ BODY: přehled a obnova (ODPOJITELNÁ) ==================
// Neinvazivní vrstva ve stylu field-tools modulů: NEEDITUJE logika.js ani
// grafika.js, vše čte přes globály s typeof-guardy.
//
// Co dělá:
//   Dlaždice v „Nástroje" → Katastr a data („Skryté body"): seznam všech bodů
//   skrytých tlačítkem „Skrýt tento bod z AR" — obnova jednotlivě klepnutím,
//   nebo všech najednou. Stejný seznam otevírá Nastavení → Údržba a řádek
//   v sekci Body přes window.agOpenHiddenPoints().
//
// Pozn.: skrytí bodu je jen pro aktuální běh appky (po restartu se body načtou
// znovu viditelné) — seznam tedy ukazuje, co je skryté teď.
//
// Odstranění: smaž js/hidden-points.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var MODAL_ID = 'hidden-pts-modal';
    var STYLE_ID = 'ag-hp-style';
    var ICON = '<svg class="icon"><use href="#i-eye-off"/></svg>';

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

    function hiddenPts() {
        try {
            if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) return arPoints.filter(function (p) { return p && p.hidden; });
        } catch (e) {}
        return [];
    }

    function catName(c) {
        return ({ TB: 'trigonometrický', ZHB: 'zhušťovací', PBPP: 'podrobný', NIVEL: 'výškový', CUSTOM: 'vlastní' })[c] || '';
    }

    // Po obnově překreslit AR, mapu i případně otevřený seznam Body.
    function refreshApp() {
        try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) {}
        try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) {}
        try { if (typeof updateInfoPanel === 'function') updateInfoPanel(); } catch (e) {}
        try {
            var mm = document.getElementById('manage-modal');
            if (mm && mm.style.display === 'flex' && typeof renderManageList === 'function') renderManageList();
        } catch (e) {}
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + MODAL_ID + ' .hp-row{display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px;',
            '  background:rgba(255,255,255,0.04);border:1px solid var(--glass-border,rgba(255,255,255,0.12));border-radius:var(--r-md,12px);}',
            '#' + MODAL_ID + ' .hp-name{flex:1;min-width:0;font-weight:700;color:var(--text-color,#e8edf2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#' + MODAL_ID + ' .hp-name small{display:block;font-weight:400;font-size:11.5px;color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .hp-show{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:var(--r-sm,8px);',
            '  border:1px solid var(--accent,#34d399);background:rgba(47,158,116,0.12);color:var(--accent,#34d399);',
            '  font:600 13px/1 var(--font,system-ui),sans-serif;cursor:pointer;}',
            '#' + MODAL_ID + ' .hp-show svg{width:15px;height:15px;}',
            '#' + MODAL_ID + ' .hp-empty{text-align:center;padding:18px 6px;color:var(--text-muted,#9aa1ac);font-size:14px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function ensureModal() {
        if (document.getElementById(MODAL_ID)) return;
        injectStyles();
        var ov = document.createElement('div');
        ov.className = 'modal-overlay';
        ov.id = MODAL_ID;
        ov.innerHTML =
            '<div class="modal-content">' +
            '<h3 style="color: var(--accent); margin-top:0;">' + ICON + ' Skryté body</h3>' +
            '<p style="font-size:13px; margin-top:0; opacity:0.8;">Body skryté z AR a mapy tlačítkem „Skrýt tento bod". Klepnutím na Zobrazit bod vrátíš.</p>' +
            '<div class="modal-body" id="hp-list"></div>' +
            '<button class="btn btn-secondary" id="hp-restore-all" style="margin-top:12px;"><svg class="icon"><use href="#i-rotate-ccw"/></svg> Zobrazit všechny skryté body</button>' +
            '<button class="btn btn-secondary" style="margin-top:10px;" id="hp-close">Zavřít</button>' +
            '</div>';
        document.body.appendChild(ov);
        document.getElementById('hp-close').addEventListener('click', closeModal);
        document.getElementById('hp-restore-all').addEventListener('click', function () {
            hiddenPts().forEach(function (p) { p.hidden = false; });
            refreshApp();
            render();
        });
    }

    function render() {
        var list = document.getElementById('hp-list');
        if (!list) return;
        var pts = hiddenPts();
        var btnAll = document.getElementById('hp-restore-all');
        if (btnAll) btnAll.style.display = pts.length ? '' : 'none';
        if (!pts.length) {
            list.innerHTML = '<div class="hp-empty">Žádné body nejsou skryté.</div>';
            return;
        }
        list.innerHTML = '';
        pts.forEach(function (p) {
            var row = document.createElement('div');
            row.className = 'hp-row';
            var sub = catName(p.cat);
            row.innerHTML = '<div class="hp-name">' + esc(p.name) + (sub ? '<small>' + sub + ' bod</small>' : '') + '</div>';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'hp-show';
            btn.innerHTML = '<svg class="icon"><use href="#i-check"/></svg> Zobrazit';
            btn.addEventListener('click', function () {
                p.hidden = false;
                refreshApp();
                render();
            });
            row.appendChild(btn);
            list.appendChild(row);
        });
    }

    function openModal() {
        ensureModal();
        render();
        document.getElementById(MODAL_ID).style.display = 'flex';
    }
    function closeModal() {
        var ov = document.getElementById(MODAL_ID);
        if (ov) ov.style.display = 'none';
        try { if (typeof fixAppLayout === 'function') fixAppLayout(); } catch (e) {}
    }

    window.agOpenHiddenPoints = openModal;

    // ---- vstup: dlaždice v Nástrojích (Katastr a data) --------------------------
    function register() {
        if (typeof window.agRegisterFieldTool !== 'function') return;
        window.agRegisterFieldTool({ id: 'hidden-points', label: 'Skryté body', icon: ICON, cat: 'Katastr a data', onClick: openModal, order: 50 });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
