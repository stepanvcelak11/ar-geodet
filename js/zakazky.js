// ===== AR Geodet - PREPINAC ZAKAZEK V NASTAVENI =====
// Umozni prepnout aktivni zakazku primo z Nastaveni (drive jen na uvodni obrazovce -> nutny
// restart appky). Prepnuti probehne ZA BEHU pres loadProjectSettings() (nacte body/nastaveni
// nove zakazky a prekresli mapu i AR). Cte globaly projects/activeProjectId z logika.js.
// Tlacitka + / koš jen volaji existujici createNewProject()/deleteProject().

(function () {
    'use strict';

    function fillSettingsSelect() {
        const sel = document.getElementById('s-project-select');
        if (!sel || typeof projects === 'undefined' || !Array.isArray(projects)) return;
        sel.innerHTML = '';
        projects.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id; opt.innerText = p.name;
            if (typeof activeProjectId !== 'undefined' && p.id === activeProjectId) opt.selected = true;
            sel.appendChild(opt);
        });
    }
    window.renderSettingsProjects = fillSettingsSelect;

    // Prepnuti zakazky ze settings selectu — stejna logika jako changeProject() na uvodu.
    window.changeProjectFromSettings = function () {
        const sel = document.getElementById('s-project-select');
        if (!sel || !sel.value) return;
        try { if (typeof _persistOfficialPoints === 'function') _persistOfficialPoints(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zakazky:changeProjectFromSettings'); }
        try { if (typeof activeProjectId !== 'undefined') activeProjectId = sel.value; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zakazky:changeProjectFromSettings'); }
        try { localStorage.setItem('arActiveProjectId', sel.value); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zakazky:changeProjectFromSettings'); }
        if (typeof loadProjectSettings === 'function') loadProjectSettings();
        if (typeof renderProjectSelect === 'function') renderProjectSelect(); // sync uvodni dropdown
        fillSettingsSelect();
        if (typeof renderManageList === 'function') renderManageList();
    };

    // Kdykoli app prekresli uvodni seznam zakazek (create/delete/switch), srovnat i ten v Nastaveni.
    if (typeof window.renderProjectSelect === 'function') {
        const orig = window.renderProjectSelect;
        window.renderProjectSelect = function () {
            const r = orig.apply(this, arguments);
            try { fillSettingsSelect(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'zakazky:renderProjectSelect'); }
            return r;
        };
    }

    // prvotni naplneni
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', fillSettingsSelect);
    else fillSettingsSelect();
})();
