// ===== AR Geodet — ŠABLONY ZAKÁZKY (převzetí nastavení) — ODPOJITELNÁ NADSTAVBA =====
// Co dělá:
//  1) Po založení nové zakázky (tlačítko „+" na úvodu i v Nastavení → Data) se zeptá,
//     zda převzít NASTAVENÍ z právě opuštěné zakázky: filtry bodů (arFilters12),
//     poloměry mapy/AR (arRadiusMap, arRadiusAR), vzhled a chování (arVisSettings12)
//     a typ práce (agWorkProfile::<pid>). BODY a další DATA se NIKDY nekopírují.
//  2) Do Nastavení → Data (pod řádek s výběrem zakázky) přidává tlačítko
//     „Nová zakázka podle této (převezme nastavení)" — založí novou zakázku běžnou
//     cestou (createNewProject vč. dialogu na jméno) a nastavení překopíruje bez ptaní.
// Jak funguje: obalí window.createNewProject (založení je ASYNCHRONNÍ — jméno se
// zadává v agPrompt dialogu, takže nový pid není znám hned). Po zavolání se krátce
// hlídá localStorage 'arProjectsList' + 'arActiveProjectId'; jakmile se objeví
// dosud neznámé id a je aktivní, překopírují se klíče nastavení `<novy pid>_...`
// a zavolá se loadProjectSettings() (znovu načte nastavení aktivní zakázky).
// ZÁMĚRNĚ SE NEKOPÍRUJE (data / vázané na místo): body (arOfflinePoints12,
// arCustomPoints12 — IndexedDB), spojnice (arLines12), vytyčovací seznam
// (arStakeout12), Helmert lokalizace (_helmertLoc), kalibrace severu
// (arHeadingOffset — platí pro konkrétní místo a seanci), drafty (agDraft::),
// závady, žurnál, foto-dokumentace (doc_*).
// Odstranění modulu: smaž js/zakazka-sablony.js + jeho <script> řádek v index.html
// a přegeneruj sw.js (scripts/gen_sw_assets.py). Nic jiného na něm nezávisí.
// =====================================================================================
(function () {
    'use strict';
    if (window.__agZakSablonyInit) return;
    window.__agZakSablonyInit = true;

    // Klíče NASTAVENÍ per zakázka (prefix `<pid>_` v localStorage). Vědomý whitelist —
    // všechno ostatní pod `<pid>_` jsou DATA (body, měření, fotky) a nekopíruje se.
    var SETTING_SUFFIXES = ['arFilters12', 'arRadiusMap', 'arRadiusAR', 'arVisSettings12'];
    var WORK_PROFILE_PREFIX = 'agWorkProfile::'; // typ práce (js/tools-simple.js)

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function currentPid() { return lsGet('arActiveProjectId') || 'default'; }
    function projList() {
        var l = null;
        try { l = JSON.parse(lsGet('arProjectsList') || '[]'); } catch (e) { l = null; }
        return (l && Object.prototype.toString.call(l) === '[object Array]') ? l : [];
    }
    function projName(id) {
        var l = projList(), i;
        for (i = 0; i < l.length; i++) { if (l[i] && l[i].id === id) return l[i].name || id; }
        return id;
    }
    function toast(m) { try { if (typeof window.quickToast === 'function') window.quickToast(m); } catch (e) {} }

    function hasAnySettings(pid) {
        var i;
        for (i = 0; i < SETTING_SUFFIXES.length; i++) {
            if (lsGet(pid + '_' + SETTING_SUFFIXES[i]) != null) return true;
        }
        return lsGet(WORK_PROFILE_PREFIX + pid) != null;
    }

    function copySettings(fromPid, toPid) {
        if (!fromPid || !toPid || fromPid === toPid) return 0;
        var n = 0, i, v;
        for (i = 0; i < SETTING_SUFFIXES.length; i++) {
            v = lsGet(fromPid + '_' + SETTING_SUFFIXES[i]);
            if (v != null && lsSet(toPid + '_' + SETTING_SUFFIXES[i], v)) n++;
        }
        v = lsGet(WORK_PROFILE_PREFIX + fromPid);
        if (v != null && lsSet(WORK_PROFILE_PREFIX + toPid, v)) n++;
        return n;
    }

    // Znovunačtení nastavení AKTIVNÍ (= nové) zakázky. loadProjectSettings čte
    // localStorage klíče přes getStoreKey a překreslí filtry/slidery/vzhled.
    // Malé zpoždění: ať doběhne hydrateActiveProject().then(loadProjectSettings)
    // z původní create cesty (druhé volání je neškodné, čte tatáž data).
    function applySettingsNow() {
        setTimeout(function () {
            try { if (typeof window.loadProjectSettings === 'function') window.loadProjectSettings(); } catch (e) {}
        }, 80);
    }

    // ---- hlídač založení nové zakázky (krátkodobý, samoukončovací) -----------------
    // createNewProject je async (dialog na jméno) → nový pid zjistíme sledováním
    // localStorage. Schválně obyčejný setInterval, NE AG.uiInterval: uiInterval se
    // uspává a dotaz na převzetí by mohl propadnout; hlídač se sám ukončí do 3 minut.
    var _watch = null; // {oldPid, known, auto, until, timer}
    var _dupNext = false; // příští založení = duplikace (kopíruj bez ptaní)

    function stopWatch() {
        if (_watch) { try { clearInterval(_watch.timer); } catch (e) {} _watch = null; }
    }

    function startWatch(auto) {
        stopWatch();
        var known = {}, l = projList(), i;
        for (i = 0; i < l.length; i++) { if (l[i] && l[i].id) known[l[i].id] = 1; }
        _watch = { oldPid: currentPid(), known: known, auto: !!auto, until: Date.now() + 3 * 60 * 1000, timer: null };
        _watch.timer = setInterval(watchTick, 500);
    }

    function watchTick() {
        if (!_watch) return;
        if (Date.now() > _watch.until) { stopWatch(); return; }
        var pid = currentPid();
        if (pid === _watch.oldPid) return;              // dialog na jméno ještě běží / zrušen
        if (_watch.known[pid] === 1) { stopWatch(); return; } // jen přepnutí na existující zakázku
        var w = _watch;
        stopWatch();
        onNewProject(w.oldPid, pid, w.auto);
    }

    function onNewProject(oldPid, newPid, auto) {
        if (!hasAnySettings(oldPid)) return; // z výchozí prázdné zakázky není co převzít
        if (auto) {
            var copied = copySettings(oldPid, newPid);
            if (copied > 0) {
                applySettingsNow();
                toast('Nastavení převzato ze zakázky „' + projName(oldPid) + '“.');
            }
            return;
        }
        var msg = 'Převzít nastavení z předchozí zakázky „' + projName(oldPid) + '“?\n\n'
            + 'Převezmou se filtry bodů, poloměry, vzhled a typ práce. Body a měření se NEkopírují.';
        var ask;
        if (typeof window.agAsk === 'function') {
            ask = window.agAsk(msg, { title: 'Nová zakázka', okText: 'Převzít nastavení' });
        } else {
            var ok = false;
            try { ok = window.confirm(msg); } catch (e) { ok = false; }
            ask = Promise.resolve(ok);
        }
        ask.then(function (yes) {
            if (!yes) return;
            var copied = copySettings(oldPid, newPid);
            if (copied > 0) { applySettingsNow(); toast('Nastavení převzato.'); }
        });
    }

    // ---- obal window.createNewProject ----------------------------------------------
    // logika.js deklaruje createNewProject jako top-level function (→ window vlastnost);
    // index.html i zakazky.js ji volají přes globální jméno, takže obal platí všude.
    function wrapCreate() {
        if (typeof window.createNewProject !== 'function') return false;
        if (window.createNewProject.__agSablony) return true;
        var orig = window.createNewProject;
        var wrapped = function () {
            var auto = _dupNext;
            _dupNext = false;
            startWatch(auto);
            return orig.apply(this, arguments);
        };
        wrapped.__agSablony = true;
        window.createNewProject = wrapped;
        return true;
    }

    // ---- tlačítko v Nastavení → Data -------------------------------------------------
    function injectButton() {
        if (document.getElementById('ag-dup-project-btn')) return true;
        var tab = document.getElementById('tab-data');
        var sel = document.getElementById('s-project-select');
        if (!tab || !sel) return false;
        var row = sel.parentElement; // řádek: select zakázky + tlačítka „+" / koš
        var btn = document.createElement('button');
        btn.id = 'ag-dup-project-btn';
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'margin:-4px 0 15px;';
        btn.innerHTML = '<svg class="icon"><use href="#i-plus"/></svg> Nová zakázka podle této (převezme nastavení)';
        btn.onclick = function () {
            if (typeof window.createNewProject !== 'function') {
                try { if (typeof window.agInfo === 'function') window.agInfo('Založení zakázky není dostupné (jádro appky se nenačetlo).'); } catch (e) {}
                return;
            }
            wrapCreate();          // pojistka, kdyby obal při startu nestihl
            _dupNext = true;       // příští založení → kopírovat nastavení bez ptaní
            window.createNewProject();
        };
        if (row && row.parentElement === tab) {
            if (row.nextSibling) tab.insertBefore(btn, row.nextSibling);
            else tab.appendChild(btn);
        } else {
            tab.insertBefore(btn, tab.firstChild);
        }
        return true;
    }

    // ---- init (idempotentní, s krátkým opakováním kvůli pořadí načítání) ------------
    function init() {
        var okWrap = wrapCreate();
        var okBtn = injectButton();
        if (okWrap && okBtn) return;
        var tries = 0;
        var t = setInterval(function () {
            tries++;
            var a = wrapCreate();
            var b = injectButton();
            if ((a && b) || tries > 40) clearInterval(t);
        }, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
