// ===== AR Geodet - UNDO U MAZANI =====
// Po smazani zakazky / vlastniho bodu nabidne "Vratit zpet". Neinvazivni: obali existujici
// globalni funkce (deleteProject, deleteCustomPoint) z logika.js bez zasahu do jejich vnitrku.
// Princip: snapshot localStorage PRED akci; kdyz se neco zmenilo, ukaze se toast s undo.
// Vraceni = obnova snapshotu + reload (appka se cela reinicializuje z localStorage -> bez
// rizika nekonzistence in-memory stavu). Nezavisi na tom, jak je puvodni funkce napsana.

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

    let toast = null, hideTimer = null;
    function showUndo(msg, snapshot) {
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'undo-toast';
            toast.style.cssText = 'position:fixed; left:50%; bottom:24px; transform:translateX(-50%); z-index:3000; '
                + 'display:flex; align-items:center; gap:14px; max-width:90%; padding:11px 14px 11px 16px; '
                + 'border-radius:14px; background:rgba(17,22,33,0.96); color:#fff; '
                + 'font-family:var(--font-display,sans-serif); font-size:14px; '
                + 'box-shadow:0 8px 26px rgba(0,0,0,0.55); border:1px solid var(--glass-border,rgba(255,255,255,0.12));';
            const label = document.createElement('span'); label.id = 'undo-toast-label';
            const btn = document.createElement('button'); btn.id = 'undo-toast-btn';
            btn.textContent = 'Vrátit zpět';
            btn.style.cssText = 'flex:none; padding:7px 14px; border:none; border-radius:10px; cursor:pointer; '
                + 'background:var(--accent,#34d399); color:#0b1020; font-weight:700; font-size:14px;';
            toast.appendChild(label); toast.appendChild(btn);
            document.body.appendChild(toast);
        }
        const label = document.getElementById('undo-toast-label');
        const btn = document.getElementById('undo-toast-btn');
        label.textContent = msg;
        btn.onclick = function () { hide(); restore(snapshot); location.reload(); };
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
