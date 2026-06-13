// ===== AR Geodet - UNDO U MAZANI =====
// Po smazani zakazky / vlastniho bodu nabidne "Vratit zpet". Neinvazivni: obali existujici
// globalni funkce (deleteProject, deleteCustomPoint) z logika.js bez zasahu do jejich vnitrku.
// Princip: snapshot localStorage PRED akci; kdyz se neco zmenilo, ukaze se toast s undo.
// Vraceni = obnova snapshotu + reinicializace stavu ZA BEHU (loadProjectSettings atd.), bez
// reloadu stranky -> uzivatel zustane tam, kde je, a je to rychle. Reload jen jako fallback.

(function () {
    'use strict';

    function snap() {
        const o = {};
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
        return o;
    }
    function changed(a, b) {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.length !== kb.length) return true;
        for (const k of ka) { if (a[k] !== b[k]) return true; }
        return false;
    }
    function restore(s) {
        const cur = [];
        for (let i = 0; i < localStorage.length; i++) cur.push(localStorage.key(i));
        cur.forEach(k => { if (!(k in s)) localStorage.removeItem(k); });
        Object.keys(s).forEach(k => localStorage.setItem(k, s[k]));
    }
    // Obnova bez reloadu: vrati localStorage a necha appku prekreslit se z nej.
    function applyRestore(snapshot) {
        restore(snapshot);
        // resync in-memory stavu, ktery si mazaci funkce drzi mimo localStorage
        try { const pl = localStorage.getItem('arProjectsList'); if (pl && typeof projects !== 'undefined') projects = JSON.parse(pl); } catch (e) { }
        try { if (typeof activeProjectId !== 'undefined') activeProjectId = localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { }
        let ok = false;
        try { if (typeof renderProjectSelect === 'function') renderProjectSelect(); } catch (e) { }
        try { if (typeof loadProjectSettings === 'function') { loadProjectSettings(); ok = true; } } catch (e) { }
        try { if (typeof renderManageList === 'function') renderManageList(); } catch (e) { }
        if (!ok) location.reload(); // kdyby app funkce nebyly k dispozici
    }

    let toast = null, hideTimer = null;
    function showUndo(msg, snapshot) {
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'undo-toast';
            toast.style.cssText = 'position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom, 0px) + 88px); transform:translateX(-50%); z-index:1000001; '
                + 'display:flex; align-items:center; gap:10px; max-width:90%; padding:8px 8px 8px 16px; '
                + 'border-radius:12px; background:rgba(17,22,33,0.96); color:#fff; '
                + 'font-family:var(--font-display,sans-serif); '
                + 'box-shadow:0 8px 26px rgba(0,0,0,0.55); border:1px solid var(--glass-border,rgba(255,255,255,0.12));';
            const label = document.createElement('span'); label.id = 'undo-toast-label';
            label.style.cssText = 'font-size:14px; line-height:1.2; white-space:nowrap;';
            const btn = document.createElement('button'); btn.id = 'undo-toast-btn';
            btn.textContent = 'Vrátit zpět';
            btn.style.cssText = 'flex:none; padding:8px 16px; border:none; border-radius:9px; cursor:pointer; '
                + 'background:var(--accent,#34d399); color:#0b1020; font-weight:700; font-size:13px; line-height:1; white-space:nowrap;';
            toast.appendChild(label); toast.appendChild(btn);
            document.body.appendChild(toast);
        }
        const label = document.getElementById('undo-toast-label');
        const btn = document.getElementById('undo-toast-btn');
        label.textContent = msg;
        btn.onclick = function () { hide(); applyRestore(snapshot); };
        toast.style.display = 'flex';
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 8000);
    }
    function hide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } if (toast) toast.style.display = 'none'; }

    function wrap(name, msg) {
        const orig = window[name];
        if (typeof orig !== 'function') return;
        window[name] = function () {
            const before = snap();
            const ret = orig.apply(this, arguments);
            try { if (changed(before, snap())) showUndo(msg, before); } catch (e) { }
            return ret;
        };
    }

    wrap('deleteProject', 'Zakázka smazána');
    wrap('deleteCustomPoint', 'Bod smazán');
})();
