// ===== AR Geodet — PROVOZNÍ PROFILY + PROFIL ZAŘÍZENÍ (ODPOJITELNÁ vrstva) ======
// Neinvazivní vrstva ve stylu js/map-tools.js: NEEDITUJE logika.js ani grafika.js.
//
// PROČ: Nastavení má ~80 ovládacích prvků ve čtyřech záložkách a dalších 17 modulů
// si tam vkládá vlastní řádky. Vědět, co z toho nastavit na celodenní měření a co
// na maximální přesnost, je skryté know-how. Profil z toho dělá jeden tap.
//
// 1) PROVOZNÍ PROFILY (nad záložkami Nastavení): Terén (výdrž) · Přesnost ·
//    Ukázka. Profil se aplikuje tak, že modul NASTAVÍ EXISTUJÍCÍ OVLÁDACÍ PRVKY
//    a pošle jim 'input'/'change' — hodnoty tedy ukládá a aplikuje appka svým
//    vlastním kódem (saveSettings v grafika.js, vlastní handlery modulů). Modul
//    si nikde nedrží druhou kopii nastavení, takže se nemůže rozejít.
//    ZÁMĚRNĚ nesahá na věci vázané na TELEFON a ČLOVĚKA (zorný úhel, korekce
//    severu, barvy, motiv, levá ruka, volba kamery) — ty patří do bodu 2.
//
// 2) PROFIL ZAŘÍZENÍ (Nastavení → Údržba): export a import kalibrace telefonu
//    do souboru .agdev — zorný úhel kamery (fovH/fovV), výška očí, korekce severu
//    a pojmenované profily kalibrace z js/calib-profiles.js. Nový telefon v partě
//    se tak nastaví jedním souborem místo měření FOV od nuly.
//    Body, zakázky ani účty v tom NEJSOU (na to je záloha a .argeo).
//
// Odstranění: smaž js/profily.js + řádek <script> v index.html (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.__agProfInit) return;
    window.__agProfInit = true;

    var STYLE_ID = 'ag-prof-style';
    var LAST_KEY = 'agProfileLast';     // jen kvůli zvýraznění naposledy použitého

    // ---- definice profilů ---------------------------------------------------------
    // set: id ovládacího prvku -> hodnota. Boolean = checkbox, jinak value.
    // Prvky, které v appce nejsou (odpojený modul), se přeskočí — fail-silent.
    var PROFILES = [
        {
            id: 'teren', t: 'Terén', s: 'Celý den na baterku, čitelné na slunci',
            ic: '#i-sun',
            why: 'Vypne, co žere baterii (animace, vizuální stabilizace, buzení displeje), zapne venkovní kontrast a spánek senzorů mimo AR.',
            set: {
                's-outdoor': true,          // vysoký kontrast na slunci
                's-anim': 'off',
                'v-adaptive-glass': false,
                's-wakelock': false,        // největší žrout; o probuzení se stará spánek senzorů
                's-vibration': true,        // zpětná vazba v rukavicích, stojí skoro nic
                'tgl-gpsavg': true,
                's-max-ar-slider': '20',
                's-ar-radius-slider': '150',
                'agp-enabled': true,        // js/power-save.js — uspat kameru/kompas mimo AR
                'agp-gps': true,
                'agvt-settings-cb': false   // js/ar-visual-track.js — optický tok stojí výkon
            }
        },
        {
            id: 'presnost', t: 'Přesnost', s: 'Když měřím a chci nejlepší AR',
            ic: '#i-crosshair',
            why: 'Zapne stabilizaci AR, kompenzaci náklonu i automatickou korekci kompasu, nechá GPS běžet a nedovolí zhasnout displej. Baterie tím trpí.',
            set: {
                's-auto-compass': true,
                's-tilt-comp': true,
                's-heading-smooth': '85',   // víc vyhlazení = klidnější značky
                'tgl-gpsavg': true,
                's-wakelock': true,
                's-anim': 'off',            // výkon patří renderu AR, ne přechodům
                's-max-ar-slider': '60',
                's-ar-radius-slider': '300',
                'agp-enabled': false,       // GPS se nesmí uspat, fix má zůstat teplý
                'agp-gps': false,
                'agvt-settings-cb': true
            }
        },
        {
            id: 'ukazka', t: 'Ukázka', s: 'Předvést appku, uvnitř, na velké body',
            ic: '#i-star',
            why: 'Větší značky, šipka i HUD, daleký dohled v AR a plynulé animace. Na celodenní práci se nehodí.',
            set: {
                's-outdoor': false,
                's-anim': 'on',
                'v-adaptive-glass': true,
                's-wakelock': true,
                'v-marker-scale': '130',
                'v-arrow-scale': '130',
                'v-hud-scale': '110',
                's-max-ar-slider': '60',
                's-ar-radius-slider': '1000',
                'agp-enabled': false,
                'agp-gps': false
            }
        }
    ];

    function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function $(id) { return document.getElementById(id); }
    function toast(msg) {
        try { if (typeof quickToast === 'function') { quickToast(msg); return; } } catch (e) {}
        try { if (typeof window.agInfo === 'function') { window.agInfo(msg); return; } } catch (e) {}
    }

    // ---- styly --------------------------------------------------------------------
    function injectStyles() {
        if ($(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-prof-bar{margin:0 0 14px;}',
            '#ag-prof-bar .h{display:block;margin:0 0 7px;font:700 11px/1.2 var(--font-ui,system-ui),sans-serif;',
            '  letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#ag-prof-row{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;}',
            '#ag-prof-row button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;',
            '  min-height:74px;padding:10px 5px;box-sizing:border-box;cursor:pointer;',
            '  border-radius:var(--r-md,12px);border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:rgba(255,255,255,0.05);color:var(--text-color,#eceef2);text-align:center;',
            '  font:700 12.5px/1.2 var(--font-ui,system-ui),sans-serif;}',
            '#ag-prof-row button .icon{width:20px;height:20px;color:var(--accent-bright,#3eb487);}',
            '#ag-prof-row button small{display:block;font:500 10px/1.3 var(--font-ui,system-ui),sans-serif;',
            '  color:var(--text-muted,#9aa1ac);}',
            '#ag-prof-row button.on{border-color:var(--accent-line,rgba(47,158,116,0.42));background:var(--accent-soft,rgba(47,158,116,0.14));}',
            '#ag-prof-row button.on,#ag-prof-row button.on .icon{color:var(--accent,#2f9e74);}',
            '#ag-prof-row button:active{transform:scale(0.97);}',
            '#ag-prof-note{margin:7px 2px 0;font:500 11.5px/1.45 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            // profil zařízení v Údržbě
            '#ag-dev-box{margin-top:8px;}',
            '#ag-dev-box .ag-dev-row{display:flex;gap:8px;}',
            '#ag-dev-box .ag-dev-row .btn{flex:1;}',
            '#ag-dev-sum{margin:8px 2px 0;font:500 11.5px/1.5 var(--font-ui,system-ui),sans-serif;color:var(--text-muted,#9aa1ac);}',
            '#ag-dev-sum b{color:var(--accent,#2f9e74);}',
            'body.ag-glove #ag-prof-row button{min-height:86px;font-size:13.5px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- aplikace profilu ---------------------------------------------------------
    // Ovládací prvek nastavíme a pošleme mu události, které by přišly od uživatele.
    // Díky tomu se postarají o uložení TI, kdo za dané nastavení odpovídají
    // (oninput popisky v index.html, change handlery injektujících modulů).
    function setControl(id, val) {
        var el = $(id);
        if (!el) return false;                       // odpojený modul → přeskočit
        if (el.type === 'checkbox') {
            if (el.checked === !!val) return true;   // bez zbytečné události
            el.checked = !!val;
        } else {
            var v = String(val);
            if (el.value === v) return true;
            el.value = v;
        }
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        return true;
    }

    function apply(profId) {
        var p = null, i;
        for (i = 0; i < PROFILES.length; i++) if (PROFILES[i].id === profId) p = PROFILES[i];
        if (!p) return;
        var done = 0, skipped = 0;
        for (var k in p.set) {
            if (!Object.prototype.hasOwnProperty.call(p.set, k)) continue;
            if (setControl(k, p.set[k])) done++; else skipped++;
        }
        lsSet(LAST_KEY, p.id);
        // Uložení a použití nechme na appce — saveSettings() přečte VŠECHNY prvky
        // (i ty, na které jsme nesáhli) a zavře panel, takže je hned vidět výsledek.
        var saved = false;
        try {
            if (typeof saveSettings === 'function') { saveSettings(); saved = true; }
        } catch (e) { console.warn('[profily] saveSettings', e); }
        renderBar();
        toast('Profil „' + p.t + '" použit' + (saved ? '' : ' — potvrď „Uložit vše a Zavřít"')
            + (skipped ? ' (' + skipped + ' volb' + (skipped === 1 ? 'a' : 'y') + ' není v této verzi)' : ''));
    }

    // ---- pruh profilů nad záložkami Nastavení -------------------------------------
    function ensureBar() {
        var bar = $('ag-prof-bar');
        if (bar) return bar;
        var m = $('settings-modal'); if (!m) return null;
        var content = m.querySelector('.modal-content'); if (!content) return null;
        var tabs = content.querySelector('.tab-buttons'); if (!tabs) return null;
        bar = document.createElement('div');
        bar.id = 'ag-prof-bar';
        bar.innerHTML = '<span class="h">Profil použití — nastaví několik voleb naráz</span>'
            + '<div id="ag-prof-row" role="group" aria-label="Profil použití"></div>'
            + '<p id="ag-prof-note"></p>';
        content.insertBefore(bar, tabs);
        bar.querySelector('#ag-prof-row').addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('button[data-prof]') : null;
            if (b) apply(b.getAttribute('data-prof'));
        });
        return bar;
    }

    function renderBar() {
        injectStyles();
        var bar = ensureBar(); if (!bar) return;
        var last = ls(LAST_KEY);
        var row = bar.querySelector('#ag-prof-row');
        if (row.getAttribute('data-last') !== String(last)) {
            row.setAttribute('data-last', String(last));
            row.innerHTML = PROFILES.map(function (p) {
                return '<button type="button" data-prof="' + p.id + '"' + (p.id === last ? ' class="on"' : '') + '>'
                    + '<svg class="icon"><use href="' + p.ic + '"/></svg>' + p.t
                    + '<small>' + p.s + '</small></button>';
            }).join('');
        }
        var note = bar.querySelector('#ag-prof-note');
        var cur = null;
        for (var i = 0; i < PROFILES.length; i++) if (PROFILES[i].id === last) cur = PROFILES[i];
        var html = cur
            ? ('<b>' + cur.t + ':</b> ' + cur.why + ' Jednotlivé volby zůstávají v záložkách níž — profil je jen nastaví.').replace('<b>', '<b>')
            : 'Jednotlivé volby najdeš v záložkách níž. Profil je jen rychle nastaví, nic neschovává ani nemaže.';
        if (note.innerHTML !== html) note.innerHTML = html;
    }

    // ---- profil zařízení: export / import -----------------------------------------
    // POZOR: visSettings i userHeadingOffset jsou v logika.js deklarované přes `let`,
    // takže NEJSOU vlastnostmi window — musí se číst holým jménem s typeof guardem
    // (stejně to dělá js/calib-profiles.js). window.visSettings by bylo undefined.
    function headingOffset() {
        try { if (typeof userHeadingOffset !== 'undefined' && isFinite(userHeadingOffset)) return +userHeadingOffset; } catch (e) {}
        return 0;
    }
    function vis() {
        try { return (typeof visSettings !== 'undefined' && visSettings) ? visSettings : null; } catch (e) { return null; }
    }
    function collectDevice() {
        var v = vis() || {};
        var out = {
            format: 'ag-device-profile',
            v: 1,
            fovH: (+v.fovH) || null,
            fovV: (+v.fovV) || null,
            eyeHeight: (+v.eyeHeight) || null,
            headingOffset: headingOffset(),
            calibProfiles: null
        };
        try {
            var raw = ls('agCalibProfiles');
            if (raw) out.calibProfiles = JSON.parse(raw);
        } catch (e) {}
        return out;
    }
    function deviceSummary() {
        var d = collectDevice();
        var parts = [];
        parts.push('zorný úhel <b>' + (d.fovH ? d.fovH + '×' + (d.fovV || '?') + '°' : 'neurčen') + '</b>');
        parts.push('výška očí <b>' + (d.eyeHeight ? String(d.eyeHeight).replace('.', ',') + ' m' : 'neurčena') + '</b>');
        parts.push('korekce severu <b>' + (Math.round(d.headingOffset * 10) / 10).toString().replace('.', ',') + '°</b>');
        var n = (d.calibProfiles && d.calibProfiles.length) || 0;
        parts.push('uložených kalibrací <b>' + n + '</b>');
        return parts.join(' · ');
    }
    function exportDevice() {
        var d = collectDevice();
        var name = 'ar-geodet-zarizeni-' + (navigator.userAgent.indexOf('iPhone') > -1 ? 'iphone' : 'telefon') + '.agdev';
        try {
            var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 4000);
            toast('Profil zařízení uložen do souboru');
        } catch (e) {
            console.warn('[profily] export', e);
            toast('Export se nepovedl');
        }
    }
    function importDevice(file) {
        if (!file) return;
        var fr = new FileReader();
        fr.onload = function () {
            var d;
            try { d = JSON.parse(String(fr.result)); } catch (e) { toast('Soubor nejde přečíst'); return; }
            if (!d || d.format !== 'ag-device-profile') { toast('To není profil zařízení (.agdev)'); return; }
            var ask = 'Přepsat kalibraci TOHOTO telefonu?\n\n'
                + 'zorný úhel: ' + (d.fovH || '?') + '×' + (d.fovV || '?') + '°\n'
                + 'výška očí: ' + (d.eyeHeight || '?') + ' m\n'
                + 'korekce severu: ' + (Math.round((d.headingOffset || 0) * 10) / 10) + '°\n'
                + 'uložené kalibrace: ' + ((d.calibProfiles && d.calibProfiles.length) || 0) + '\n\n'
                + 'Body, zakázky ani účty se nemění. Zorný úhel platí pro MODEL telefonu — '
                + 'z jiného modelu ho nepřenášej.';
            if (!window.confirm(ask)) return;
            var v = vis();
            if (v) {
                if (d.fovH) v.fovH = +d.fovH;
                if (d.fovV) v.fovV = +d.fovV;
                if (d.eyeHeight) v.eyeHeight = +d.eyeHeight;
                try {
                    if (typeof setStoredData === 'function') setStoredData('arVisSettings12', JSON.stringify(v));
                } catch (e) {}
                try { if (typeof applyVisualSettings === 'function') applyVisualSettings(); } catch (e) {}
            }
            // korekce severu: jen přes oficiální páku appky, ať se přepočítá i AR
            try {
                if (typeof d.headingOffset === 'number' && typeof resetHeadingOffset === 'function'
                    && typeof nudgeHeadingOffset === 'function') {
                    resetHeadingOffset();
                    if (d.headingOffset) nudgeHeadingOffset(d.headingOffset);
                }
            } catch (e) {}
            if (d.calibProfiles && d.calibProfiles.length) {
                try { lsSet('agCalibProfiles', JSON.stringify(d.calibProfiles)); } catch (e) {}
            }
            // posuvníky v panelu dorovnat, ať tam nesvítí stará čísla
            if (v) { setControl('s-fovh', v.fovH || 90); setControl('s-fovv', v.fovV || 75); if (v.eyeHeight) setControl('s-eyeh', v.eyeHeight); }
            renderDevice();
            toast('Profil zařízení nahrán');
        };
        fr.onerror = function () { toast('Soubor nejde přečíst'); };
        fr.readAsText(file);
    }

    function ensureDeviceBox() {
        var box = $('ag-dev-box');
        if (box) return box;
        var tab = $('tab-udrzba'); if (!tab) return null;
        box = document.createElement('div');
        box.id = 'ag-dev-box';
        box.innerHTML =
            '<div class="set-h">Profil zařízení (kalibrace telefonu)</div>'
            + '<p id="ag-dev-sum"></p>'
            + '<div class="ag-dev-row" style="margin-top:10px;">'
            + '  <button type="button" class="btn btn-secondary" id="ag-dev-exp"><svg class="icon"><use href="#i-upload"/></svg> Uložit do souboru</button>'
            + '  <button type="button" class="btn btn-blue" id="ag-dev-imp"><svg class="icon"><use href="#i-folder"/></svg> Nahrát ze souboru</button>'
            + '</div>'
            + '<input type="file" id="ag-dev-file" accept=".agdev,.json,application/json" style="display:none">'
            + '<p style="font-size:11.5px;line-height:1.5;opacity:.7;margin:8px 2px 0;">Přenese zorný úhel kamery, výšku očí, korekci severu a uložené kalibrace '
            + 'na další telefon v partě. <b>Zorný úhel patří k modelu telefonu</b> — mezi různými modely ho nepřenášej. '
            + 'Body a zakázky v tom nejsou, na ty je záloha výše.</p>';
        tab.appendChild(box);
        box.querySelector('#ag-dev-exp').addEventListener('click', exportDevice);
        box.querySelector('#ag-dev-imp').addEventListener('click', function () { $('ag-dev-file').click(); });
        box.querySelector('#ag-dev-file').addEventListener('change', function (ev) {
            importDevice(ev.target.files && ev.target.files[0]);
            ev.target.value = '';
        });
        return box;
    }
    function renderDevice() {
        var box = ensureDeviceBox(); if (!box) return;
        var sum = box.querySelector('#ag-dev-sum');
        var html = deviceSummary();
        if (sum.innerHTML !== html) sum.innerHTML = html;
    }

    // ---- init ---------------------------------------------------------------------
    function tick() {
        try { renderBar(); renderDevice(); } catch (e) {}
    }
    function init() {
        tick();
        // Panel Nastavení a jeho injektované řádky vznikají postupně (17 modulů),
        // proto se dorovnáváme sdíleným UI časovačem jako ostatní vrstvy.
        if (!window.__agProfTimer) {
            window.__agProfTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(tick, 2000);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });

    window.AGProfily = { apply: apply, profiles: PROFILES, device: collectDevice };
})();
