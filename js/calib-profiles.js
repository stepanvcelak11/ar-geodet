// ===== AR Geodet — PROFILY KALIBRACE (ODPOJITELNÁ vrstva) =======================
// Neinvazivní vrstva ve stylu js/vylepseni.js: NEEDITUJE logika.js ani grafika.js,
// jen za běhu vkládá UI do existujícího modálu Kompasu. Načítá se jako poslední skript.
//
// Co umí:
//   Ukládání pojmenovaných profilů kalibrace {název, headingOffset, fovH, fovV}.
//   Hodnoty čte/nastavuje VÝHRADNĚ přes ověřené globály:
//     - korekce severu: userHeadingOffset (čtení) + nudgeHeadingOffset/resetHeadingOffset
//     - zorný úhel: visSettings.fovH / visSettings.fovV + setStoredData('arVisSettings12')
//   Profily v localStorage pod klíčem "agCalibProfiles".
//   UI: sekce v #compass-modal (.modal-body) — uložit aktuální profil, seznam profilů
//       s tlačítky "Použít" a "Smazat".
//
// Odstranění: smaž js/calib-profiles.js + css/calib-profiles.css a jejich řádky v index.html.
// ================================================================================
(function () {
    'use strict';

    var LS_KEY = 'agCalibProfiles';
    var SEC_ID = 'ag-calibprof';

    // --------------------------------------------------------------------------------
    // Úložiště profilů
    // --------------------------------------------------------------------------------
    function loadProfiles() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (!raw) return [];
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }
    function saveProfiles(list) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
    }

    // --------------------------------------------------------------------------------
    // Čtení/zápis kalibračních hodnot přes existující mechanismy
    // --------------------------------------------------------------------------------
    function getHeadingOffset() {
        try { return (typeof userHeadingOffset !== 'undefined' && isFinite(userHeadingOffset)) ? (((userHeadingOffset % 360) + 360) % 360) : 0; }
        catch (e) { return 0; }
    }
    function getFovH() {
        try { return (typeof visSettings !== 'undefined' && visSettings && isFinite(visSettings.fovH)) ? visSettings.fovH : 90; }
        catch (e) { return 90; }
    }
    function getFovV() {
        try { return (typeof visSettings !== 'undefined' && visSettings && isFinite(visSettings.fovV)) ? visSettings.fovV : 75; }
        catch (e) { return 75; }
    }

    // Nastav korekci severu na absolutní hodnotu pomocí relativního nudge (žádná nová "magie").
    function applyHeadingOffset(target) {
        try {
            if (typeof nudgeHeadingOffset !== 'function') return;
            var cur = getHeadingOffset();
            var t = ((target % 360) + 360) % 360;
            // nejkratší dráha (−180..180), ať se nuluje korektně i přes 0/360
            var delta = ((t - cur + 540) % 360) - 180;
            if (Math.abs(delta) < 0.001) {
                // i tak zavolej (pro jistotu obnoví zobrazení), ale jen pokud je co měnit
                return;
            }
            nudgeHeadingOffset(delta);
        } catch (e) {}
    }

    function applyFov(fovH, fovV) {
        try {
            if (typeof visSettings === 'undefined' || !visSettings) return;
            if (isFinite(fovH)) visSettings.fovH = Math.max(40, Math.min(120, fovH));
            if (isFinite(fovV)) visSettings.fovV = Math.max(40, Math.min(130, fovV));
            if (typeof setStoredData === 'function') setStoredData('arVisSettings12', JSON.stringify(visSettings));
            // AR čte visSettings.fov* každý snímek → projeví se živě; jen pro jistotu:
            if (typeof applyVisualSettings === 'function') applyVisualSettings();
        } catch (e) {}
        // synchronizace posuvníků v Nastavení, ať hodnoty sedí
        syncSlider('s-fovh', 's-fovh-val', getFovH());
        syncSlider('s-fovv', 's-fovv-val', getFovV());
    }

    function syncSlider(slId, lblId, val) {
        try {
            var sl = document.getElementById(slId);
            if (sl) sl.value = val;
            var lbl = document.getElementById(lblId);
            if (lbl) lbl.innerText = val;
        } catch (e) {}
    }

    // --------------------------------------------------------------------------------
    // Akce
    // --------------------------------------------------------------------------------
    function alertMsg(opts) {
        if (typeof window.agAlert === 'function') { window.agAlert(opts); return; }
        try { alert((opts.title ? opts.title + '\n\n' : '') + String(opts.message || '').replace(/<[^>]+>/g, '')); } catch (e) {}
    }
    function confirmMsg(opts) {
        if (typeof window.agConfirm === 'function') return window.agConfirm(opts);
        return Promise.resolve(window.confirm((opts.title ? opts.title + '\n\n' : '') + String(opts.message || '').replace(/<[^>]+>/g, '')));
    }
    function promptName(opts) {
        if (typeof window.agPrompt === 'function') return window.agPrompt(opts);
        var v = window.prompt((opts.title || '') + (opts.message ? '\n' + String(opts.message).replace(/<[^>]+>/g, '') : ''), opts.value || '');
        return Promise.resolve(v == null ? null : v.trim());
    }

    function fmtOffset(v) { var n = ((v + 180) % 360 + 360) % 360 - 180; return (n > 0 ? '+' : '') + Math.round(n) + '°'; }

    function saveCurrentProfile() {
        promptName({
            title: 'Uložit profil kalibrace',
            message: 'Ulož aktuální korekci severu a zorný úhel pod názvem ' +
                '(např. telefon / objektiv / lokalita).<br>Korekce ' + escapeHtml(fmtOffset(getHeadingOffset())) +
                ' · záběr ' + getFovH() + '×' + getFovV() + '°.',
            placeholder: 'Např. Samsung širák',
            okText: 'Uložit'
        }).then(function (name) {
            if (name == null) return;
            name = String(name).trim();
            if (!name) return;
            var list = loadProfiles();
            var prof = {
                name: name,
                headingOffset: getHeadingOffset(),
                fovH: getFovH(),
                fovV: getFovV(),
                t: Date.now()
            };
            var idx = -1;
            for (var i = 0; i < list.length; i++) { if (list[i] && list[i].name === name) { idx = i; break; } }
            if (idx >= 0) {
                confirmMsg({
                    title: 'Přepsat profil?',
                    message: 'Profil <b>' + escapeHtml(name) + '</b> už existuje. Přepsat ho aktuálním nastavením?',
                    okText: 'Přepsat', cancelText: 'Ponechat'
                }).then(function (ok) {
                    if (!ok) return;
                    list[idx] = prof;
                    if (saveProfiles(list)) renderList();
                    else alertMsg({ title: 'Neuloženo', message: 'Úložiště telefonu je plné — profil se neuložil.' });
                });
                return;
            }
            list.push(prof);
            if (saveProfiles(list)) renderList();
            else alertMsg({ title: 'Neuloženo', message: 'Úložiště telefonu je plné — profil se neuložil.' });
        });
    }

    function useProfile(name) {
        var list = loadProfiles();
        var p = null;
        for (var i = 0; i < list.length; i++) { if (list[i] && list[i].name === name) { p = list[i]; break; } }
        if (!p) return;
        if (typeof p.headingOffset === 'number') applyHeadingOffset(p.headingOffset);
        applyFov(p.fovH, p.fovV);
        // obnov zobrazení korekce v modálu kompasu
        try { if (typeof updateHeadingOffsetVal === 'function') updateHeadingOffsetVal(); } catch (e) {}
        renderList();
        alertMsg({
            title: 'Profil použit',
            message: '<b>' + escapeHtml(p.name) + '</b> nastaven: korekce ' + escapeHtml(fmtOffset(p.headingOffset || 0)) +
                ', záběr ' + (p.fovH || 90) + '×' + (p.fovV || 75) + '°. V terénu dolaď podle reality.'
        });
    }

    function deleteProfile(name) {
        confirmMsg({
            title: 'Smazat profil?',
            message: 'Smaže se profil <b>' + escapeHtml(name) + '</b>. Aktuální kalibraci to nezmění.',
            okText: 'Smazat', cancelText: 'Ponechat', danger: true
        }).then(function (ok) {
            if (!ok) return;
            var list = loadProfiles().filter(function (p) { return !p || p.name !== name; });
            saveProfiles(list);
            renderList();
        });
    }

    // --------------------------------------------------------------------------------
    // UI
    // --------------------------------------------------------------------------------
    function renderList() {
        var listEl = document.getElementById('ag-calibprof-list');
        if (!listEl) return;
        var list = loadProfiles();
        if (!list.length) {
            listEl.innerHTML = '<div class="ag-cp-empty">Zatím žádný profil. Nastav korekci severu a zorný úhel výše, pak ulož.</div>';
            return;
        }
        listEl.innerHTML = list.map(function (p) {
            var nm = escapeHtml(p && p.name ? p.name : 'Profil');
            var meta = 'korekce ' + escapeHtml(fmtOffset(p && p.headingOffset || 0)) + ' · záběr ' + (p && p.fovH || 90) + '×' + (p && p.fovV || 75) + '°';
            return '<div class="ag-cp-item">' +
                '<div class="ag-cp-info"><span class="ag-cp-name">' + nm + '</span><span class="ag-cp-meta">' + meta + '</span></div>' +
                '<div class="ag-cp-acts">' +
                '<button type="button" class="ag-cp-btn ag-cp-use" data-use="' + nm + '">Použít</button>' +
                '<button type="button" class="ag-cp-btn ag-cp-del" data-del="' + nm + '" aria-label="Smazat profil">Smazat</button>' +
                '</div></div>';
        }).join('');
        listEl.querySelectorAll('[data-use]').forEach(function (b) {
            b.addEventListener('click', function () { useProfile(unescapeAttr(b.getAttribute('data-use'))); });
        });
        listEl.querySelectorAll('[data-del]').forEach(function (b) {
            b.addEventListener('click', function () { deleteProfile(unescapeAttr(b.getAttribute('data-del'))); });
        });
    }

    function injectSection() {
        var body = document.querySelector('#compass-modal .modal-body');
        if (!body || document.getElementById(SEC_ID)) return;
        var sec = document.createElement('div');
        sec.id = SEC_ID;
        sec.className = 'ag-cp-section';
        sec.innerHTML =
            '<hr class="ag-cp-hr">' +
            '<label class="ag-cp-label">Profily kalibrace</label>' +
            '<div class="ag-cp-desc">Ulož si korekci severu + zorný úhel pro různé telefony / objektivy / lokality a rychle je přepínej.</div>' +
            '<button type="button" class="btn btn-primary ag-cp-save" id="ag-calibprof-save">' +
            '<svg class="icon"><use href="#i-sliders"/></svg> Uložit aktuální jako profil</button>' +
            '<div class="ag-cp-list" id="ag-calibprof-list"></div>';
        body.appendChild(sec);
        var saveBtn = document.getElementById('ag-calibprof-save');
        if (saveBtn) saveBtn.addEventListener('click', function () { try { saveCurrentProfile(); } catch (e) { console.warn('[calib-profiles] save', e); } });
        renderList();
    }

    // Po každém otevření modálu kompasu obnov seznam (a zaruč, že sekce existuje).
    function hookOpenCompass() {
        try {
            if (typeof window.openCompassModal === 'function' && !window.openCompassModal._agCalibProf) {
                var orig = window.openCompassModal;
                var wrapped = function () {
                    var r = orig.apply(this, arguments);
                    try { injectSection(); renderList(); } catch (e) { console.warn('[calib-profiles] hook', e); }
                    return r;
                };
                wrapped._agCalibProf = true;
                window.openCompassModal = wrapped;
            }
        } catch (e) {}
    }

    // --------------------------------------------------------------------------------
    // Pomocné
    // --------------------------------------------------------------------------------
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function unescapeAttr(s) {
        return String(s == null ? '' : s)
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    }

    // --------------------------------------------------------------------------------
    // Init
    // --------------------------------------------------------------------------------
    function init() {
        try { injectSection(); } catch (e) { console.warn('[calib-profiles] inject', e); }
        try { hookOpenCompass(); } catch (e) { console.warn('[calib-profiles] hook', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // Druhý průchod — modál i globály mohou vzniknout/načíst se později.
    window.addEventListener('load', function () { setTimeout(init, 350); });
})();
