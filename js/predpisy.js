// ===== AR Geodet — PŘEDPISY / PRÁVNÍ TAHÁK (odpojitelná vrstva) ===============
// Offline vyhledávatelný tahák konkrétních hodnot (mezní odchylky, kódy kvality…)
// s citací a odkazem na plné znění. Neinvazivní vrstva ve stylu zpravodaj.js:
// NEEDITUJE logika.js ani grafika.js.
//
// DŮLEŽITÉ: data jsou KURÁTOROVANÁ a citovaná, NE generovaná AI. Hodnoty ověřeny
// proti oficiálnímu znění; u každého záznamu je zdroj + odkaz k ověření.
//
// Odstranění: smaž js/predpisy.js + css/predpisy.css + data/predpisy.json a řádky
// "PŘEDPISY" v index.html (+ ze sw.js).
// ================================================================================
(function () {
    'use strict';

    var DATA_URL = 'data/predpisy.json';
    var K_DATA = 'agPredpisyData';
    var _data = null;
    var _ov = null;
    var _activeCat = 'all';   // aktivní téma (id kategorie) nebo 'all'

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    // bez diakritiky + malá písmena (vyhledávání odolné proti háčkům/čárkám)
    function deburr(s) {
        // NFD rozloží písmeno+diakritiku; pak zahodíme kombinační značky (U+0300–U+036F)
        var s2 = String(s || '').toLowerCase().normalize('NFD');
        return s2.replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
    }

    function getCached() { var r = lsGet(K_DATA); if (!r) return null; try { return JSON.parse(r); } catch (e) { return null; } }

    function load() {
        var c = getCached();
        if (c) _data = c;
        var online = (typeof navigator === 'undefined') || navigator.onLine !== false;
        if (!online) return;
        fetch(DATA_URL, { cache: 'no-cache' })
            .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
            .then(function (j) {
                if (!j || !Array.isArray(j.kategorie)) throw new Error('bad json');
                _data = j; lsSet(K_DATA, JSON.stringify(j));
                if (_ov && _ov.classList.contains('open')) { renderChips(); render(currentQuery()); }
            })
            .catch(function () { /* zůstaneme u cache */ });
    }

    // ---- vyhledávací text záznamu -------------------------------------------------
    function entryHaystack(z) {
        var parts = [z.nazev, z.telo, z.pozn, (z.tagy || []).join(' '), z.zdroj];
        if (z.tabulka) {
            parts.push((z.tabulka.hlavicka || []).join(' '));
            (z.tabulka.radky || []).forEach(function (r) { parts.push(r.join(' ')); });
        }
        return deburr(parts.join(' '));
    }

    // ---- render -------------------------------------------------------------------
    function tableHtml(t) {
        if (!t || !Array.isArray(t.radky)) return '';
        var head = (t.hlavicka || []).map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('');
        var rows = t.radky.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
        }).join('');
        return '<div class="prd-tablewrap"><table class="prd-table"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function entryHtml(z) {
        var src = '';
        if (z.zdroj || z.odkaz) {
            var meta = (z.zdroj ? esc(z.zdroj) : '') + (z.platnost ? ' · ověř k ' + esc(z.platnost) : '');
            var link = z.odkaz ? '<a class="prd-link" href="' + esc(z.odkaz) + '" target="_blank" rel="noopener noreferrer">celé znění →</a>' : '';
            src = '<div class="prd-src"><span class="prd-cite">' + meta + '</span>' + link + '</div>';
        }
        return '<article class="prd-card">' +
            '<h3 class="prd-h">' + esc(z.nazev || '') + '</h3>' +
            (z.telo ? '<p class="prd-telo">' + esc(z.telo) + '</p>' : '') +
            tableHtml(z.tabulka) +
            (z.pozn ? '<div class="prd-pozn">' + esc(z.pozn) + '</div>' : '') +
            src +
            '</article>';
    }

    function currentQuery() { var i = document.getElementById('prd-search'); return i ? i.value : ''; }

    function render(q) {
        buildOverlay();
        if (!_data) _data = getCached();
        var body = document.getElementById('prd-body');
        if (!body) return;
        if (!_data || !Array.isArray(_data.kategorie)) {
            body.innerHTML = '<div class="prd-empty">Předpisy se nepodařilo načíst. Připoj se k internetu a otevři je znovu.</div>';
            return;
        }
        var needle = deburr(q || '');
        var html = '';
        var hits = 0;
        _data.kategorie.forEach(function (kat) {
            if (_activeCat !== 'all' && kat.id !== _activeCat) return;
            var zazn = (kat.zaznamy || []).filter(function (z) { return !needle || entryHaystack(z).indexOf(needle) >= 0; });
            if (!zazn.length) return;
            hits += zazn.length;
            html += '<section class="prd-cat"><h2 class="prd-cat-h">' + esc(kat.nazev) + '</h2>' + zazn.map(entryHtml).join('') + '</section>';
        });
        if (!hits) {
            html = '<div class="prd-empty">Nic nenalezeno pro „' + esc(q) + "“.<br>Zkus jiné slovo (např. „odchylka“, „kód kvality“, „výměra“).</div>";
        }
        body.innerHTML = html;
        body.scrollTop = 0;
    }

    function renderChips() {
        var box = document.getElementById('prd-chips');
        if (!box) return;
        if (!_data || !Array.isArray(_data.kategorie)) { box.innerHTML = ''; return; }
        var html = '<button type="button" class="prd-chip' + (_activeCat === 'all' ? ' active' : '') + '" data-cat="all">Vše</button>';
        html += _data.kategorie.map(function (k) {
            return '<button type="button" class="prd-chip' + (_activeCat === k.id ? ' active' : '') + '" data-cat="' + esc(k.id) + '">' + esc(k.zkratka || k.nazev) + '</button>';
        }).join('');
        box.innerHTML = html;
        box.querySelectorAll('.prd-chip').forEach(function (c) {
            c.addEventListener('click', function () {
                _activeCat = c.getAttribute('data-cat');
                renderChips();
                render(currentQuery());
            });
        });
    }

    function buildOverlay() {
        if (_ov) return _ov;
        _ov = document.createElement('div');
        _ov.className = 'prd-overlay';
        _ov.innerHTML =
            '<div class="prd-sheet" role="dialog" aria-modal="true" aria-label="Předpisy a odchylky">' +
            '  <div class="prd-head">' +
            '    <div class="prd-head-l"><svg class="icon prd-head-ic"><use href="#i-scale"/></svg>' +
            '      <div><div class="prd-title">Předpisy & odchylky</div><div class="prd-sub" id="prd-sub"></div></div></div>' +
            '    <button type="button" class="prd-x" aria-label="Zavřít">×</button>' +
            '  </div>' +
            '  <div class="prd-searchbar"><svg class="icon prd-search-ic"><use href="#i-crosshair"/></svg>' +
            '    <input type="search" id="prd-search" placeholder="Hledat: odchylka, kód kvality, výměra…" autocomplete="off" autocapitalize="none">' +
            '  </div>' +
            '  <div class="prd-chips" id="prd-chips"></div>' +
            '  <div class="prd-body" id="prd-body"></div>' +
            '  <div class="prd-foot" id="prd-foot"></div>' +
            '</div>';
        document.body.appendChild(_ov);

        _ov.querySelector('.prd-x').addEventListener('click', closeReader);
        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov) closeReader(); });
        document.addEventListener('keydown', function (e) {
            if (_ov.classList.contains('open') && e.key === 'Escape') { e.preventDefault(); closeReader(); }
        });
        _ov.querySelector('#prd-search').addEventListener('input', function () { render(this.value); });
        renderChips();

        var sub = _ov.querySelector('#prd-sub');
        if (sub && _data && _data.aktualizovano) sub.textContent = 'Aktualizováno ' + _data.aktualizovano;
        var foot = _ov.querySelector('#prd-foot');
        if (foot) foot.innerHTML = '<div class="prd-note">' + esc((_data && _data.disclaimer) || 'Orientační tahák, ne právní výklad — hodnoty ověř u zdroje.') + '</div>';
        return _ov;
    }

    function openReader() {
        buildOverlay();
        _activeCat = 'all';
        renderChips();
        render('');
        var i = document.getElementById('prd-search'); if (i) i.value = '';
        var sub = document.getElementById('prd-sub');
        if (sub && _data && _data.aktualizovano) sub.textContent = 'Aktualizováno ' + _data.aktualizovano;
        var foot = document.getElementById('prd-foot');
        if (foot && _data && _data.disclaimer) foot.innerHTML = '<div class="prd-note">' + esc(_data.disclaimer) + '</div>';
        _ov.classList.add('open');
    }
    function closeReader() { if (_ov) _ov.classList.remove('open'); }
    window.openPredpisy = openReader;

    // ---- vstupy (Nástroje + úvodní obrazovka) --------------------------------------
    // Primárně dlaždice v modalu „Nástroje" (kategorie Pomůcky); boční menu „Více"
    // je jen nouzový fallback, když field-tools.js chybí (odpojitelnost).
    function injectMenuButton() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'predpisy', label: 'Předpisy a odchylky', icon: '<svg class="icon"><use href="#i-scale"/></svg>', cat: 'Pomůcky', onClick: openReader, order: 60 });
            var stale = document.getElementById('prd-menu-btn'); if (stale) stale.remove();
            return;
        }
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('prd-menu-btn')) return;
        // Vkládáme do scrollovací části, ať položka scrolluje a dole zůstává pevné jen „Zavřít".
        var host = menu.querySelector('.menu-scroll') || menu;
        var btn = document.createElement('button');
        btn.id = 'prd-menu-btn'; btn.className = 'menu-btn'; btn.type = 'button';
        btn.innerHTML = '<svg class="icon"><use href="#i-scale"/></svg> Předpisy & odchylky';
        btn.addEventListener('click', function () { openReader(); if (typeof toggleMenu === 'function') try { toggleMenu(); } catch (e) {} });
        var hr = host.querySelector('hr'); var firstToggle = host.querySelector('.menu-toggle-row');
        if (hr) host.insertBefore(btn, hr); else if (firstToggle) host.insertBefore(btn, firstToggle); else host.appendChild(btn);
    }
    function injectWelcomeButton() {
        var wrap = document.querySelector('#welcome-screen .modal-content');
        if (!wrap || document.getElementById('prd-welcome-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'prd-welcome-btn'; btn.type = 'button'; btn.className = 'btn btn-secondary';
        btn.style.marginTop = '12px';
        btn.innerHTML = '<svg class="icon"><use href="#i-scale"/></svg> Předpisy & odchylky';
        btn.addEventListener('click', openReader);
        // za tlačítko zpravodaje, pokud existuje, jinak za průvodce
        // POZOR (nalezeno 8.8. v prohlížeči): kotva leží v .w-c-actions, ne přímo
        // v .modal-content — wrap.insertBefore proto hodilo NotFoundError a tlačítko
        // „Předpisy & odchylky" na úvodní obrazovce chybělo. Viz i js/zpravodaj.js.
        var anchor = document.getElementById('zpr-welcome-btn') || document.getElementById('pruv-welcome-btn');
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
        else wrap.appendChild(btn);
    }

    function init() {
        try { injectMenuButton(); } catch (e) { console.warn('[predpisy] menu', e); }
        try { injectWelcomeButton(); } catch (e) { console.warn('[predpisy] welcome', e); }
        try { load(); } catch (e) { console.warn('[predpisy] load', e); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () {
        setTimeout(function () { try { injectMenuButton(); } catch (e) {} try { injectWelcomeButton(); } catch (e) {} }, 400);
    });
    window.addEventListener('online', function () { try { load(); } catch (e) {} });
})();
