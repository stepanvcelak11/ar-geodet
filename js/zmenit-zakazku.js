// ===== AR Geodet — ZMĚNIT ZAKÁZKU (dlaždice v Nástrojích) =======================
// Přepnutí aktivní zakázky jedním klepnutím přímo z Nástrojů (skupina „Firma
// a papíry"). Dřív se zakázka měnila jen na úvodní obrazovce nebo v Nastavení →
// Data, což je v terénu s rukavicemi několik kroků a člověk se musel proklikat
// pryč od rozdělané práce.
//
// Odpojitelná vrstva ve stylu js/vylepseni.js: needituje logika.js ani grafika.js.
// Odstranění: smaž tenhle soubor + řádek <script> v index.html, řádek v sw.js
// a záznam 'zmenit-zakazku' v js/tools-registry.js.
//
// CO NEDĚLÁ SÁM: seznam zakázek ani vlastní přepnutí. Obojí si bere z js/ucty.js
// (AGUcty.allowedProjects / AGUcty.applyProject) — proto se drží OPRÁVNĚNÍ: komu
// admin přidělil jen některé zakázky, uvidí a přepne jen ty. Bez firemního režimu
// se ukážou všechny. Když by ucty.js chybělo, spadne se na globály z logika.js.
// ================================================================================
(function () {
    'use strict';

    var OV_ID = 'ag-zz-ov';
    var STYLE_ID = 'ag-zz-style';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2"/></svg>';
    var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

    function U() { return window.AGUcty || null; }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function toast(t) { try { if (typeof quickToast === 'function') return quickToast(t); } catch (e) {} }

    function activeId() {
        try { if (typeof activeProjectId !== 'undefined' && activeProjectId) return activeProjectId; } catch (e) {}
        try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; }
    }

    // Seznam zakázek, které SMÍ vidět přihlášený člověk (viz hlavička).
    function list() {
        var u = U();
        try {
            if (u && u.allowedProjects) return u.allowedProjects(u.currentUser ? u.currentUser() : null) || [];
        } catch (e) {}
        try { if (typeof projects !== 'undefined' && Array.isArray(projects)) return projects; } catch (e) {}
        return [{ id: 'default', name: 'Výchozí zakázka' }];
    }

    // Kolik bodů má PRÁVĚ OTEVŘENÁ zakázka. U ostatních se to schválně nepočítá:
    // logika.js drží body pod klíčem `<idZakazky>_arCustomPoints12` v IndexedDB
    // (viz IDB_KEYS), takže by to znamenalo asynchronní čtení cizí zakázky jen
    // kvůli popisku — a to na mobilu při otevření seznamu není zadarmo.
    function ptCount(id) {
        if (id !== activeId()) return null;
        try { if (typeof customPoints !== 'undefined' && Array.isArray(customPoints)) return customPoints.length; } catch (e) {}
        return null;
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#' + OV_ID + '{position:fixed;inset:0;z-index:var(--z-tool,100000);display:flex;align-items:flex-end;',
            '  justify-content:center;background:rgba(0,0,0,0.45);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}',
            '#' + OV_ID + ' .zz-card{width:100%;max-width:520px;max-height:82vh;display:flex;flex-direction:column;',
            '  background:var(--modal-bg,rgba(14,18,24,0.97));color:var(--text-color,#eceef2);',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));border-bottom:none;',
            '  border-radius:var(--r-xl,22px) var(--r-xl,22px) 0 0;',
            '  padding:16px 16px calc(16px + env(safe-area-inset-bottom, 0px));box-sizing:border-box;}',
            '#' + OV_ID + ' .zz-h{display:flex;align-items:center;gap:9px;margin:0 0 4px;font:700 calc(16px * var(--ag-font-scale, 1))/1.2 var(--font-display,system-ui),sans-serif;}',
            '#' + OV_ID + ' .zz-h svg{width:19px;height:19px;color:var(--accent,#2f9e74);flex:none;}',
            '#' + OV_ID + ' .zz-sub{margin:0 0 12px;font:400 calc(12.5px * var(--ag-font-scale, 1))/1.4 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '#' + OV_ID + ' .zz-list{overflow:auto;-webkit-overflow-scrolling:touch;margin:0 -4px;padding:0 4px;}',
            '#' + OV_ID + ' .zz-i{display:flex;align-items:center;gap:11px;width:100%;box-sizing:border-box;',
            '  margin:0 0 8px;padding:13px 14px;border-radius:var(--r-md,12px);cursor:pointer;text-align:left;',
            '  background:var(--surface-1,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.10));',
            '  color:var(--text-color,#eceef2);font:600 calc(14.5px * var(--ag-font-scale, 1))/1.25 var(--font-ui,system-ui),sans-serif;}',
            '#' + OV_ID + ' .zz-i:active{transform:scale(0.985);}',
            '#' + OV_ID + ' .zz-i.on{border-color:var(--accent-line,rgba(47,158,116,0.42));background:var(--accent-soft,rgba(47,158,116,0.14));}',
            '#' + OV_ID + ' .zz-t{flex:1;min-width:0;}',
            '#' + OV_ID + ' .zz-t b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '#' + OV_ID + ' .zz-t span{display:block;margin-top:2px;font:400 calc(11.5px * var(--ag-font-scale, 1))/1.2 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '#' + OV_ID + ' .zz-ok{flex:none;width:20px;height:20px;color:var(--accent,#2f9e74);}',
            '#' + OV_ID + ' .zz-btns{display:flex;gap:8px;margin-top:4px;}',
            '#' + OV_ID + ' .zz-btns button{flex:1;padding:12px;border-radius:var(--r-md,12px);cursor:pointer;',
            '  font:600 calc(14px * var(--ag-font-scale, 1))/1 var(--font-ui,system-ui),sans-serif;',
            '  background:var(--surface-1,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.12));color:var(--text-color,#eceef2);}',
            '#' + OV_ID + ' .zz-btns button.pri{background:var(--accent-grad,var(--accent,#2f9e74));border-color:transparent;color:#fff;}'
        ].join('');
        document.head.appendChild(st);
    }

    function close() {
        var ov = document.getElementById(OV_ID);
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }

    function switchTo(id) {
        if (!id || id === activeId()) { close(); return; }
        var name = '';
        list().forEach(function (p) { if (p.id === id) name = p.name || ''; });
        var u = U();
        // Přepnutí ať dělá jádro — hydratuje body zakázky, překreslí mapu i AR
        // a srovná OBA přepínače (úvodní obrazovka + Nastavení).
        if (u && u.applyProject) u.applyProject(id);
        else if (typeof window.changeProjectFromSettings === 'function') {
            var sel = document.getElementById('s-project-select');
            if (sel) { sel.value = id; window.changeProjectFromSettings(); }
        }
        close();
        toast('Zakázka: ' + (name || id));
    }

    function open() {
        injectStyles();
        close();
        var cur = activeId();
        var items = list();
        var ov = document.createElement('div');
        ov.id = OV_ID;
        ov.innerHTML =
            '<div class="zz-card" role="dialog" aria-label="Změnit zakázku">' +
            '<div class="zz-h">' + ICON + 'Změnit zakázku</div>' +
            '<p class="zz-sub">Body, poznámky i nastavení se přepnou na zvolenou zakázku. Rozdělaná práce zůstane uložená v té dosavadní.</p>' +
            '<div class="zz-list">' +
            (items.length
                ? items.map(function (p) {
                    var n = ptCount(p.id);
                    return '<button type="button" class="zz-i' + (p.id === cur ? ' on' : '') + '" data-id="' + esc(p.id) + '">' +
                        '<span class="zz-t"><b>' + esc(p.name || p.id) + '</b>' +
                        '<span>' + (p.id === cur ? ('právě otevřená' + (n == null ? '' : ' · ' + n + (n === 1 ? ' bod' : (n < 5 ? ' body' : ' bodů')))) : 'klepnutím otevřeš') + '</span></span>' +
                        (p.id === cur ? '<span class="zz-ok">' + CHECK + '</span>' : '') +
                        '</button>';
                }).join('')
                : '<p class="zz-sub">Žádná zakázka k dispozici.</p>') +
            '</div>' +
            '<div class="zz-btns">' +
            '<button type="button" id="ag-zz-new" class="pri">+ Nová zakázka</button>' +
            '<button type="button" id="ag-zz-x">Zavřít</button>' +
            '</div></div>';
        document.body.appendChild(ov);

        ov.addEventListener('click', function (e) {
            if (e.target === ov) { close(); return; }              // klepnutí mimo kartu zavírá
            var b = e.target.closest ? e.target.closest('.zz-i') : null;
            if (b) switchTo(b.getAttribute('data-id'));
        });
        ov.querySelector('#ag-zz-x').onclick = close;
        ov.querySelector('#ag-zz-new').onclick = function () {
            close();
            try {
                if (typeof createNewProject === 'function') createNewProject();
                else toast('Novou zakázku založíš v Nastavení → Data.');
            } catch (err) { toast('Novou zakázku založíš v Nastavení → Data.'); }
        };
    }

    window.agOpenZmenitZakazku = open;

    function register() {
        if (typeof window.agRegisterFieldTool !== 'function') return false;
        window.agRegisterFieldTool({
            id: 'zmenit-zakazku',
            label: 'Změnit zakázku',
            icon: ICON,
            cat: 'Pomůcky',
            onClick: open
        });
        return true;
    }
    // field-tools.js se může načíst až po nás → zkusit znovu, ale jen chvíli
    if (!register()) {
        var tries = 0;
        var t = setInterval(function () {
            if (register() || ++tries > 40) clearInterval(t);
        }, 250);
    }
})();
