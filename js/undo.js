// ===== AR Geodet - UNDO U MAZANI =====
// Po smazani zakazky / vlastniho bodu nabidne "Vratit zpet". Neinvazivni: obali existujici
// globalni funkce (deleteProject, deleteCustomPoint) z logika.js bez zasahu do jejich vnitrku.
// Princip: snapshot localStorage PRED akci; kdyz se neco zmenilo, ukaze se toast s undo.
// Vraceni = obnova snapshotu + reinicializace stavu ZA BEHU (loadProjectSettings atd.), bez
// reloadu stranky -> uzivatel zustane tam, kde je, a je to rychle. Reload jen jako fallback.

(function () {
    'use strict';

    // Snapshot bere localStorage I IndexedDB-cache (_idbMem z logika.js). Body se ukladaji do
    // IndexedDB, ne do localStorage — bez snimku _idbMem by se zmena (smazani bodu) nepoznala.
    // _idbMem drzi data AKTIVNI zakazky, takze pokryje i smazani bodu i smazani aktivni zakazky.
    //
    // VYKON: _idbMem se driv kopiroval pres JSON.parse(JSON.stringify(...)). Jenze jeho
    // hodnoty UZ JSOU hotove JSON retezce (setStoredData do nej uklada presne to, co jde
    // do IndexedDB) - u zakazky s tisici body je to nekolikamegovy retezec a stringify ho
    // cely znovu ESKAPUJE a parse zase odeskapuje. A delo se to DVAKRAT na kazde smazani
    // (snimek pred akci i po ni), takze smazani JEDNOHO bodu na chvili zaseklo UI.
    //
    // Retezce jsou v JS nemenne, takze na snimek uplne staci MELKA kopie: kdyz se hodnota
    // zmeni, setStoredData na to misto priradi NOVY retezec a stary nam v snimku zustane.
    // Navic se tim zrychli porovnani nize: nezmenene hodnoty jsou TYZ retezec, takze to
    // vyridi porovnani referenci misto znakoveho porovnani megabajtoveho retezce.
    // Neretezcovou hodnotu (kdyby ji sem nekdo casem dal) pro jistotu kopirujeme do hloubky.
    function snapMem() {
        let src = null;
        try { if (typeof _idbMem !== 'undefined' && _idbMem) src = _idbMem; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:snapMem'); }
        if (!src) return null;
        const out = {};
        Object.keys(src).forEach(k => {
            const v = src[k];
            if (typeof v === 'string' || v == null) out[k] = v;
            else { try { out[k] = JSON.parse(JSON.stringify(v)); } catch (e) { out[k] = v; } }
        });
        return out;
    }
    function snap() {
        const ls = {};
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
        return { ls: ls, mem: snapMem() };
    }
    function objChanged(a, b) {
        if (!a && !b) return false;
        if (!a || !b) return true;
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.length !== kb.length) return true;
        for (const k of ka) { if (a[k] !== b[k]) return true; }
        return false;
    }
    // POROVNANI BEZ DRUHEHO SNIMKU. Snimek PRED akci potrebujeme cely (undo z nej
    // obnovuje), ale ten PO akci slouzil UZ JEN k otazce "zmenilo se neco?" - a presto
    // se kvuli nemu cetl cely localStorage do dalsiho objektu. Kdyz IndexedDB nejede
    // (nebo se do ni zapis nepovede), lezi body v localStorage jako nekolikamegovy
    // retezec, takze to bylo druhe drahe cteni na KAZDEM smazani.
    // Ted se prochazi jednou a KONCI SE PRI PRVNIM ROZDILU.
    function changedSince(before) {
        const b = before.ls;
        const n = localStorage.length;
        let seen = 0;
        for (let i = 0; i < n; i++) {
            const k = localStorage.key(i);
            if (!(k in b)) return true;                       // klic pribyl
            seen++;
            if (localStorage.getItem(k) !== b[k]) return true; // hodnota se zmenila
        }
        if (seen !== Object.keys(b).length) return true;       // klic ubyl
        return objChanged(before.mem, snapMem());
    }
    // ZAPISUJEME JEN TO, CO SE LISI. Drive se pri kazdem "Vratit zpet" prepsal CELY
    // localStorage a poslala se transakce do IndexedDB za KAZDY klic - u velke zakazky
    // to znamenalo megabajty zbytecnych zapisu (a na skoro plnem telefonu i riziko, ze
    // nektery z nich narazi na kvotu). Vraceni jednoho bodu ma sahnout na jeden klic.
    // Vraci slib, ktery dobehne, AZ jsou zapisy do IndexedDB opravdu na disku —
    // volajici pak muze stav overit proti ulozisti (viz applyRestore).
    // ⚠ #23 VRACENY BOD JE CERSTVA ZMENA. Firemni cloud (js/cloud-sync.js) resi
    // konflikty podle casu upravy `mts` a server zapis se starsim casem MLCKY zahodi
    // (`WHERE excluded.ts>sync_points.ts`). Po smazani uz ma na bod nahrobek s casem
    // smazani — kdyby se bod vratil s puvodnim `mts`, u kolegu by zustal smazany.
    // Razitko proto posouvame na TED, ale JEN bodum, ktere se opravdu vraceji do
    // zivota (v ulozisti ted nejsou). Kdybychom orazitkovali cely snimek, po kazdem
    // "Vratit zpet" by se do firmy pushla cela zakazka znovu.
    function orazitkujVracene(ted, snimek) {
        if (typeof snimek !== 'string' || !snimek) return snimek;
        try {
            const zive = {};
            const cur = JSON.parse(ted || '[]');
            if (Array.isArray(cur)) cur.forEach(p => { if (p && p.id) zive[p.id] = 1; });
            const pole = JSON.parse(snimek);
            if (!Array.isArray(pole)) return snimek;
            const now = Date.now();
            let n = 0;
            pole.forEach(p => { if (p && p.id && !zive[p.id]) { p.mts = now; n++; } });
            return n ? JSON.stringify(pole) : snimek;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:orazitkujVracene'); return snimek; }
    }
    // Klic s vlastnimi body zakazky (`<zakazka>_arCustomPoints12`) — jen u nej ma
    // razitkovani smysl, ostatni klice zadne body neobsahuji.
    function jsouToBody(k) { return typeof k === 'string' && k.indexOf('arCustomPoints12') >= 0; }

    function restore(s) {
        const cur = [];
        for (let i = 0; i < localStorage.length; i++) cur.push(localStorage.key(i));
        cur.forEach(k => { if (!(k in s.ls)) localStorage.removeItem(k); });
        Object.keys(s.ls).forEach(k => {
            const v = jsouToBody(k) ? orazitkujVracene(localStorage.getItem(k), s.ls[k]) : s.ls[k];
            if (localStorage.getItem(k) !== v) localStorage.setItem(k, v);
        });
        // IndexedDB (velka data: body) — vrat synchronni cache i samotne IDB
        const zapisy = [];
        if (s.mem && typeof _idbMem !== 'undefined' && _idbMem) {
            try {
                Object.keys(_idbMem).forEach(k => { if (!(k in s.mem)) { delete _idbMem[k]; if (typeof _idbDel === 'function') zapisy.push(_idbDel(k)); } });
                Object.keys(s.mem).forEach(k => {
                    const v = jsouToBody(k) ? orazitkujVracene(_idbMem[k], s.mem[k]) : s.mem[k];
                    if (_idbMem[k] === v) return;                 // beze zmeny -> zadny zapis
                    _idbMem[k] = v;
                    if (typeof _idbSet === 'function') zapisy.push(_idbSet(k, v));
                });
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:restore'); }
        }
        return Promise.all(zapisy).catch(() => null);
    }
    // Obnova bez reloadu: vrati localStorage a necha appku prekreslit se z nej.
    function applyRestore(snapshot) {
        const zapisy = restore(snapshot);
        // resync in-memory stavu, ktery si mazaci funkce drzi mimo localStorage
        try { const pl = localStorage.getItem('arProjectsList'); if (pl && typeof projects !== 'undefined') projects = JSON.parse(pl); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:applyRestore'); }
        try { if (typeof activeProjectId !== 'undefined') activeProjectId = localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:applyRestore'); }
        let ok = false;
        try { if (typeof renderProjectSelect === 'function') renderProjectSelect(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:applyRestore'); }
        try { if (typeof loadProjectSettings === 'function') { loadProjectSettings(); ok = true; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:applyRestore'); }
        try { if (typeof renderManageList === 'function') renderManageList(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:applyRestore'); }
        // Tezke prekresleni nad zivou kamerou ji umi "zamrznout" -> proaktivne ji oziv (jinak by ji uzivatel restartoval rucne).
        try { if (typeof ensureCameraAlive === 'function') setTimeout(() => ensureCameraAlive(true), 250); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:applyRestore'); }
        // ⚠ #13 OVERENI PROTI DISKU. Vsechno vys se prekreslilo z pameti (_idbMem),
        // takze obnova vypadala hotova i tehdy, kdyz se zapis do IndexedDB nepovedl —
        // uzivatel to poznal az rano po restartu, kdy byly body pryc. Az DOPSANE
        // zapisy proto nacteme zpatky z uloziste a appku prekreslime z toho, co
        // na disku opravdu je. Poradi je dulezite: kdyby se cetlo pred dopsanim,
        // hydratace by cerstve vracena data z pameti zase smazala.
        try {
            if (ok && typeof hydrateActiveProject === 'function') {
                Promise.resolve(zapisy)
                    .then(() => hydrateActiveProject())
                    .then(() => { try { if (typeof loadProjectSettings === 'function') loadProjectSettings(); if (typeof renderManageList === 'function') renderManageList(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:applyRestore'); } })
                    .catch(() => { });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:applyRestore'); }
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
            label.style.cssText = 'font-size:calc(14px * var(--ag-font-scale, 1)); line-height:1.25;';   // nowrap zrusen: hlasky hromadnych operaci se nevesly
            const btn = document.createElement('button'); btn.id = 'undo-toast-btn';
            btn.textContent = 'Vrátit zpět';
            btn.style.cssText = 'flex:none; padding:8px 16px; border:none; border-radius:9px; cursor:pointer; '
                + 'background:var(--accent,#2f9e74); color:#0b1020; font-weight:700; font-size:calc(13px * var(--ag-font-scale, 1)); line-height:1; white-space:nowrap;';
            toast.appendChild(label); toast.appendChild(btn);
            document.body.appendChild(toast);
        }
        const label = document.getElementById('undo-toast-label');
        const btn = document.getElementById('undo-toast-btn');
        label.textContent = msg;
        // snapshot muze byt bud snimek uloziste (mazani), nebo {_fn} — vlastni
        // vraceci funkce. Tu pouzivaji hromadne operace nad body (js/grafika.js),
        // ktere si stav vraci samy z before-zaznamu, ne pres snimek celeho uloziste.
        btn.onclick = function () { hide(); if (snapshot && typeof snapshot._fn === 'function') snapshot._fn(); else applyRestore(snapshot); };
        toast.style.display = 'flex';
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 8000);
    }
    function hide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } if (toast) toast.style.display = 'none'; }

    function wrap(name, msg) {
        const orig = window[name];
        if (typeof orig !== 'function' || orig._undoWrapped) return;   // idempotence (dvojí načtení)
        window[name] = function () {
            const before = snap();
            const ret = orig.apply(this, arguments);
            try { if (changedSince(before)) showUndo(msg, before); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:wrap'); }
            return ret;
        };
        // ⚠⚠ #27 PRENOS PRIZNAKU OBALENI. deleteCustomPoint obaluji ctyri moduly
        // (kos -> undo -> kalkulacka -> journal -> logika) a kazdy si dava vlastni
        // priznak. Kdyz ho novy obal nezdedi, priznaky predchozich ZMIZI — v bezici
        // appce pak plati jen pojistka toho posledniho v rade a kdokoli dalsi muze
        // obalit podruhe (dvojity toast „Vratit zpet", dvojity zapis do zurnalu).
        try { for (const k in orig) { if (/Wrapped$/.test(k)) window[name][k] = orig[k]; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'undo:wrap'); }
        window[name]._undoWrapped = true;
    }

    wrap('deleteProject', 'Zakázka smazána');
    wrap('deleteCustomPoint', 'Bod smazán');

    // Verejne API: stejny toast "Vrátit zpět" pro akce, ktere si vraceni resi samy.
    // Pouziva ho js/grafika.js u hromadnych operaci (posun, precislovani, kod, Helmert),
    // ktere driv nesly vratit vubec — zurnal si sice pamatoval before/after, ale
    // nikdo z nej neumel nic obnovit.
    window.AGUndo = {
        toast: function (msg, onUndo) {
            if (typeof onUndo !== 'function') return;
            showUndo(msg, { _fn: onUndo });
        },
        hide: hide
    };
})();
