// ============================================================================
// QTRIG — VSTUP DO ADMINISTRACE FIRMY (14. 11. 2026)
// ----------------------------------------------------------------------------
// Malý odložený modul: dlaždice „Firma a účty" v Nástrojích, tlačítka v menu Více
// a skrývání dlaždice podle oprávnění. Samotná administrace (js/ucty-admin.js,
// ~160 kB) se stahuje AŽ při otevření — při startu ji dřív stahoval a parsoval
// každý telefon, i když ji používá jen admin. V index.html má data-na-vyzadani,
// takže ji service worker dál předcacheuje (offline) a need() ji dotáhne.
// Odstranění: smaž tenhle soubor a v ucty-admin.js vrať registraci do init().
// ============================================================================
(function () {
    'use strict';
    if (window.__agUctyAdminVstup) return;
    window.__agUctyAdminVstup = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    var SRC = 'js/ucty-admin.js';

    function U() { return window.AGUcty || null; }
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, 'ucty-admin-vstup:' + kde); } catch (x) { /* nic */ } }
    function T(cs) { try { return (window.AGJazyk && typeof AGJazyk.t === 'function') ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function SK() {
        try { if (window.AGProfilOsoby && AGProfilOsoby.skupina) return AGProfilOsoby.skupina(); } catch (e) { /* bez modulu */ }
        return { n: 'firma' };
    }

    // otevře administraci; modul se při prvním použití dotáhne
    function otevri() {
        if (window.AGUctyAdmin && AGUctyAdmin.open) { AGUctyAdmin.open(); return; }
        if (window.AGLazy && AGLazy.need) {
            AGLazy.need(SRC, function () {
                if (window.AGUctyAdmin && AGUctyAdmin.open) AGUctyAdmin.open();
                else if (typeof window.quickToast === 'function') quickToast(T('Administraci se nepodařilo načíst — zkus to znovu.'));
            });
        }
    }

    function syncMenuBtn() {
        var u = U(); if (!u) return;
        var f = u.getFirm();
        var btn = document.getElementById('agfa-switch-btn');
        var adm = document.getElementById('agfa-admin-btn');
        var scroll = document.querySelector('#side-menu .menu-scroll');
        if (!f) { if (btn) btn.remove(); if (adm) adm.remove(); return; }
        if (!scroll) return;
        var hr = scroll.querySelector('hr');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'agfa-switch-btn';
            btn.className = 'menu-btn';
            btn.innerHTML = '<svg class="icon"><use href="#i-users"/></svg> Přepnout uživatele / zamknout';
            btn.onclick = function () {
                try { if (typeof window.toggleMenu === 'function') toggleMenu(); } catch (e) { swallow(e, 'menu'); }
                var uu = U(); if (uu) uu.lock();
            };
            scroll.insertBefore(btn, hr || null);
        }
        // admin má administraci po ruce (nemusí ji hledat v Nástrojích)
        if (u.isAdmin()) {
            if (!adm) {
                adm = document.createElement('button');
                adm.id = 'agfa-admin-btn';
                adm.className = 'menu-btn';
                adm.innerHTML = '<svg class="icon"><use href="#i-users"/></svg> Administrace firmy (admin)';
                adm.setAttribute('data-tool', 'ucty-firma');
                adm.onclick = function () {
                    try { if (typeof window.toggleMenu === 'function') toggleMenu(); } catch (e) { swallow(e, 'menu'); }
                    // ⚠ Vstup MIMO mřížku nástrojů: odchyt kliku v js/pro-zamky.js
                    //   hledá dlaždici (data-tool / .tool-tile), takže sem nedosáhne
                    //   a Pro nástroj by šel v Základu otevřít bez klíče.
                    if (window.AGProZamky && AGProZamky.zamceno('ucty-firma')) { AGProZamky.karta('ucty-firma'); return; }
                    otevri();
                };
                scroll.insertBefore(adm, btn);
            }
        } else if (adm) adm.remove();
    }

    function reg() {
        if (typeof window.agRegisterFieldTool !== 'function') return;
        window.agRegisterFieldTool({ id: 'ucty-firma', label: (SK().n === 'parta' ? 'Parta a účty' : 'Firma a účty'), icon: ICON, onClick: otevri, order: 90, cat: 'Pomůcky' });
    }

    function init() {
        if (!U()) return;   // jádro chybí -> nic neinjektovat
        reg();
        // student-start: po změně „Kdo jsi" se dlaždice přejmenuje (Firma ↔ Parta a účty)
        window.addEventListener('ag:profil-osoby', reg);
        syncMenuBtn();
        // BATERIE: jen DOM v bočním menu — přes AG.uiInterval se na pozadí uspí
        (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(syncMenuBtn, 3000);
        // dlaždici „Firma a účty" skrýt zaměstnancům (nemají v ní co dělat); musí umět i UKÁZAT
        // (vyhodnocení před přihlášením by ji jinak schovalo i adminovi)
        window.addEventListener('agucty:perms', function () {
            try {
                var u = U(); if (!u) return;
                var tile = document.querySelector('#tools-modal .tool-tile[data-tool="ucty-firma"]');
                if (!tile) return;
                if (!u.getFirm()) { tile.style.display = ''; return; }   // bez firmy = vstup pro založení
                var usr = u.currentUser ? u.currentUser() : null;
                var show = !usr || u.isAdmin() || u.can('x.dashboard');
                tile.style.display = show ? '' : 'none';
            } catch (e) { swallow(e, 'perms'); }
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 400); });
    else setTimeout(init, 400);

    window.AGUctyAdminVstup = { otevri: otevri };
})();
