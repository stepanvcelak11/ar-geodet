// AR Geodet — karta aktivní zakázky na úvodu (Návrh C „Zakázka v centru").
// Plní #w-proj-name a #w-proj-chips reálnými daty (název zakázky + chip počtu bodů a data vzniku).
// Samostatný soubor: NEzasahuje do logika.js/grafika.js, jen obaluje jejich funkce
// (loadProjectSettings / renderProjectSelect), aby se karta přepočítala při každé změně.
// Načítat AŽ PO logika.js, grafika.js a zakazky.js.
(function () {
    'use strict';

    // České skloňování slova "bod"
    function bodWord(n) { return (n === 1) ? 'bod' : (n >= 2 && n <= 4) ? 'body' : 'bodů'; }

    // Aktuální název zakázky — primárně z DOM selectu (vždy aktuální), fallback z 'projects'
    function activeName() {
        var sel = document.getElementById('w-project-select');
        if (sel && sel.selectedOptions && sel.selectedOptions.length) return sel.selectedOptions[0].text;
        if (sel && sel.options && sel.selectedIndex >= 0) return sel.options[sel.selectedIndex].text;
        try {
            if (typeof projects !== 'undefined' && Array.isArray(projects) && typeof activeProjectId !== 'undefined') {
                var p = projects.find(function (x) { return x.id === activeProjectId; });
                if (p) return p.name;
            }
        } catch (e) {}
        return 'Zakázka';
    }

    // Počet vlastních (uložených) bodů v aktivní zakázce
    function savedPointCount() {
        try {
            if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) {
                return persistentCustomPoints.length;
            }
        } catch (e) {}
        try {
            if (typeof getStoredData === 'function') {
                var raw = getStoredData('arCustomPoints12');
                if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.length; }
            }
        } catch (e) {}
        return 0;
    }

    // Datum vzniku zakázky z id 'proj_<timestamp>' (výchozí zakázka razítko nemá → null)
    function projectCreatedDate() {
        try {
            var id = (typeof activeProjectId !== 'undefined') ? activeProjectId : null;
            var sel = document.getElementById('w-project-select');
            if (!id && sel && sel.value) id = sel.value;
            var m = /^proj_(\d{10,})$/.exec(id || '');
            if (!m) return null;
            var ts = parseInt(m[1], 10);
            return isFinite(ts) ? new Date(ts) : null;
        } catch (e) { return null; }
    }
    function relDate(d) {
        var now = new Date();
        var a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        var diff = Math.round((a - b) / 86400000);
        if (diff <= 0) return 'dnes';
        if (diff === 1) return 'včera';
        return d.getDate() + '. ' + (d.getMonth() + 1) + '.';
    }
    var CLOCK_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

    function updateWelcomeProjectCard() {
        var nameEl = document.getElementById('w-proj-name');
        var chipsEl = document.getElementById('w-proj-chips');
        if (!nameEl && !chipsEl) return; // jiný návrh úvodu — nic neděláme
        if (nameEl) nameEl.textContent = activeName();
        if (chipsEl) {
            var n = savedPointCount();
            var html = (n > 0)
                ? '<span class="w-proj-chip"><svg class="icon"><use href="#i-map-pin"/></svg><span><b>' + n + '</b> ' + bodWord(n) + '</span></span>'
                : '<span class="w-proj-chip empty"><svg class="icon"><use href="#i-map-pin"/></svg><span>zatím bez bodů</span></span>';
            var d = projectCreatedDate();
            if (d) html += '<span class="w-proj-chip">' + CLOCK_SVG + '<span>' + relDate(d) + '</span></span>';
            chipsEl.innerHTML = html;
        }
    }
    window.updateWelcomeProjectCard = updateWelcomeProjectCard;

    // Obalí globální funkci tak, aby po jejím doběhnutí přepočítala kartu (i pro async řetězce)
    function wrapAfter(name) {
        if (typeof window[name] !== 'function' || window[name]._wcWrapped) return;
        var orig = window[name];
        var wrapped = function () {
            var r = orig.apply(this, arguments);
            try { setTimeout(updateWelcomeProjectCard, 0); } catch (e) {}
            return r;
        };
        wrapped._wcWrapped = true;
        try { Object.defineProperty(wrapped, 'name', { value: name }); } catch (e) {}
        window[name] = wrapped;
    }

    // loadProjectSettings běží po hydrataci při startu i při každém přepnutí zakázky
    // (changeProject, changeProjectFromSettings, createNewProject, undo, průvodce) → spolehlivý hák.
    wrapAfter('loadProjectSettings');
    // renderProjectSelect aktualizuje název hned (než doběhne async načtení bodů).
    wrapAfter('renderProjectSelect');

    // Úvodní vykreslení (kdyby start proběhl dřív, než se tenhle soubor zapojil)
    function kick() { setTimeout(updateWelcomeProjectCard, 60); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kick);
    else kick();
})();
