// AR Geodet — karta aktivní zakázky na úvodu (Návrh C „Zakázka v centru").
// Plní #w-proj-name a #w-proj-stats reálnými daty (název zakázky + počet uložených bodů).
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

    function updateWelcomeProjectCard() {
        var nameEl = document.getElementById('w-proj-name');
        var statsEl = document.getElementById('w-proj-stats');
        if (!nameEl && !statsEl) return; // jiný návrh úvodu — nic neděláme
        if (nameEl) nameEl.textContent = activeName();
        if (statsEl) {
            var n = savedPointCount();
            statsEl.innerHTML = (n > 0)
                ? '<b>' + n + '</b> ' + bodWord(n) + ' · S-JTSK'
                : 'zatím bez uložených bodů · S-JTSK';
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
