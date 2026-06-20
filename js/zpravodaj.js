// ===== AR Geodet — GEO ZPRAVODAJ (odpojitelná vrstva) ==========================
// Denní geodetický zpravodaj. Neinvazivní vrstva ve stylu vylepseni.js: NEEDITUJE
// logika.js ani grafika.js, vše si staví a obsluhuje sama.
//
// Odstranění celé funkce: smaž js/zpravodaj.js + css/zpravodaj.css a oba řádky se
// značkou "ZPRAVODAJ" v index.html (+ ./js/zpravodaj.js a ./data/zpravodaj.json ze sw.js).
//
// Jak funguje:
//   - Při zapnutí (online) stáhne data/zpravodaj.json a uloží poslední vydání do
//     localStorage. Bez signálu ukáže poslední uložené vydání s odznakem "offline".
//   - V bočním menu přibude položka "Zpravodaj" s tečkou, když je čerstvé nepřečtené
//     vydání. Tečka zmizí po otevření čtečky.
//   - Střípek je sbalený (perex); klepnutím se rozbalí delší text + odkaz na originál.
// ================================================================================
(function () {
    'use strict';

    var DATA_URL = 'data/zpravodaj.json';
    var K_DATA = 'agZprData';   // poslední úspěšně stažené vydání (JSON)
    var K_SEEN = 'agZprSeen';   // vydani (YYYY-MM-DD) naposledy otevřeného vydání

    // Barvy štítků rubrik (kvůli skenovatelnosti) — sladěno s paletou appky.
    var RUBR = {
        'Z domova': '#2dd4bf',
        'Ze světa': '#38bdf8',
        'Přístroje': '#a78bfa',
        'Technologie': '#f472b6',
        'Zákon': '#fbbf24',
        'Z praxe': '#34d399',
        'Tip': '#5eead4',
        'Akce': '#fb7185',
        'Vzdělávání': '#818cf8'
    };

    var _edition = null;   // aktuálně nejlepší známé vydání (objekt)
    var _offline = false;  // čteme z cache, ne z čerstvé sítě?
    var _ov = null;        // overlay čtečky

    // --------------------------------------------------------------------------------
    // Pomocné
    // --------------------------------------------------------------------------------
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

    function hexRgba(hex, a) {
        var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
        if (!m) return 'rgba(45,212,191,' + a + ')';
        return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
    }

    // "2026-06-14" -> "so 14. 6. 2026"
    function fmtEdition(iso) {
        if (!iso) return '';
        try {
            var p = String(iso).split('-');
            var d = new Date(+p[0], +p[1] - 1, +p[2]);
            if (isNaN(d.getTime())) return String(iso);
            return d.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });
        } catch (e) { return String(iso); }
    }
    // "2026-06-13" -> "13. 6." (krátké, na kartu)
    function fmtShort(iso) {
        if (!iso) return '';
        var p = String(iso).split('-');
        if (p.length < 3) return String(iso);
        return (+p[2]) + '. ' + (+p[1]) + '.';
    }

    function getCached() {
        var raw = lsGet(K_DATA);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function latestVydani() {
        return _edition && _edition.vydani ? _edition.vydani : null;
    }
    function isFresh() {
        var v = latestVydani();
        return !!v && v !== lsGet(K_SEEN);
    }

    // --------------------------------------------------------------------------------
    // Odznak (tečka) v menu
    // --------------------------------------------------------------------------------
    function updateDot() {
        var fresh = isFresh();
        var dots = document.querySelectorAll('.zpr-dot');
        for (var i = 0; i < dots.length; i++) dots[i].hidden = !fresh;
    }

    // --------------------------------------------------------------------------------
    // Načtení dat (cache hned, síť když online)
    // --------------------------------------------------------------------------------
    function loadEdition() {
        // 1) cache hned — ať je co ukázat i offline a hned po startu
        var cached = getCached();
        if (cached) { _edition = cached; _offline = true; }
        updateDot();

        // 2) síť, když jsme online (service worker dělá pro vlastní původ network-first)
        var online = (typeof navigator === 'undefined') || navigator.onLine !== false;
        if (!online) { updateDot(); return; }

        fetch(DATA_URL, { cache: 'no-cache' })
            .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
            .then(function (j) {
                if (!j || !Array.isArray(j.polozky)) throw new Error('bad json');
                _edition = j; _offline = false;
                lsSet(K_DATA, JSON.stringify(j));
                updateDot();
                // pokud je čtečka zrovna otevřená, překresli
                if (_ov && _ov.classList.contains('open')) render();
            })
            .catch(function () { /* zůstaneme u cache, _offline=true */ updateDot(); });
    }

    // --------------------------------------------------------------------------------
    // Čtečka (modal)
    // --------------------------------------------------------------------------------
    function buildOverlay() {
        if (_ov) return _ov;
        _ov = document.createElement('div');
        _ov.className = 'zpr-overlay';
        _ov.innerHTML =
            '<div class="zpr-sheet" role="dialog" aria-modal="true" aria-label="Geo zpravodaj">' +
            '  <div class="zpr-head">' +
            '    <div class="zpr-head-l">' +
            '      <svg class="icon zpr-head-ic"><use href="#i-news"/></svg>' +
            '      <div><div class="zpr-title">Geo zpravodaj</div><div class="zpr-sub" id="zpr-sub"></div></div>' +
            '    </div>' +
            '    <button type="button" class="zpr-x" aria-label="Zavřít">×</button>' +
            '  </div>' +
            '  <div class="zpr-body" id="zpr-body"></div>' +
            '  <div class="zpr-foot" id="zpr-foot"></div>' +
            '</div>';
        document.body.appendChild(_ov);

        _ov.querySelector('.zpr-x').addEventListener('click', closeReader);
        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov) closeReader(); });
        document.addEventListener('keydown', function (e) {
            if (_ov.classList.contains('open') && e.key === 'Escape') { e.preventDefault(); closeReader(); }
        });
        return _ov;
    }

    function cardHtml(p, i) {
        var color = RUBR[p.rubrika] || '#2dd4bf';
        var tagStyle = 'background:' + hexRgba(color, 0.16) + ';color:' + color + ';border-color:' + hexRgba(color, 0.42) + ';';
        var hasBody = p.body && p.body.length;
        var bodyHtml = hasBody ? ('<ul class="zpr-list">' + p.body.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>') : '';
        var procHtml = p.proc ? ('<div class="zpr-proc">💡 Proč to řešit: ' + esc(p.proc) + '</div>') : '';
        var srcHtml = (p.odkaz)
            ? ('<a class="zpr-src" href="' + esc(p.odkaz) + '" target="_blank" rel="noopener noreferrer">📄 Číst originál' + (p.zdroj ? (' u zdroje (' + esc(p.zdroj) + ')') : '') + ' →</a>')
            : (p.zdroj ? ('<div class="zpr-src zpr-src-none">Zdroj: ' + esc(p.zdroj) + '</div>') : '');
        var teloHtml = p.telo ? ('<p class="zpr-telo">' + esc(p.telo) + '</p>') : '';

        return '' +
            '<article class="zpr-card' + (p.top ? ' zpr-top' : '') + '" data-i="' + i + '">' +
            '  <button type="button" class="zpr-card-head">' +
            '    <div class="zpr-meta">' +
            '      <span class="zpr-tag" style="' + tagStyle + '">' + (p.top ? '★ ' : '') + esc(p.rubrika || '—') + '</span>' +
            '      <span class="zpr-date">' + esc(fmtShort(p.datum)) + '</span>' +
            '    </div>' +
            '    <h3 class="zpr-h">' + esc(p.nadpis || '') + '</h3>' +
            '    <p class="zpr-perex">' + esc(p.perex || '') + '</p>' +
            '    <span class="zpr-more">klepni pro více ▾</span>' +
            '  </button>' +
            '  <div class="zpr-detail" hidden>' + teloHtml + bodyHtml + procHtml + srcHtml + '</div>' +
            '</article>';
    }

    function render() {
        buildOverlay();
        if (!_edition) _edition = getCached();
        var sub = document.getElementById('zpr-sub');
        var body = document.getElementById('zpr-body');
        var foot = document.getElementById('zpr-foot');
        if (!body) return;

        if (!_edition || !Array.isArray(_edition.polozky) || !_edition.polozky.length) {
            if (sub) sub.textContent = '';
            body.innerHTML = '<div class="zpr-empty">' +
                (_offline
                    ? 'Zatím není stažené žádné vydání. Připoj se k internetu a otevři zpravodaj znovu.'
                    : 'Vydání se nepodařilo načíst. Zkus to za chvíli znovu.') +
                '</div>';
            if (foot) foot.innerHTML = '';
            return;
        }

        var ed = _edition;
        if (sub) sub.innerHTML = 'Vydání ' + esc(fmtEdition(ed.vydani)) +
            (_offline ? ' <span class="zpr-badge zpr-badge-off">offline</span>' : ' <span class="zpr-badge zpr-badge-on">online</span>');

        var intro = ed.uvodnik ? ('<p class="zpr-intro">' + esc(ed.uvodnik) + '</p>') : '';
        body.innerHTML = intro + ed.polozky.map(cardHtml).join('');

        // rozbalování střípků (delegace)
        body.querySelectorAll('.zpr-card-head').forEach(function (h) {
            h.addEventListener('click', function () {
                var card = h.closest('.zpr-card');
                if (!card) return;
                var det = card.querySelector('.zpr-detail');
                var more = card.querySelector('.zpr-more');
                var open = card.classList.toggle('open');
                if (det) det.hidden = !open;
                if (more) more.textContent = open ? 'méně ▴' : 'klepni pro více ▾';
            });
        });

        if (foot) {
            foot.innerHTML =
                '<div class="zpr-note">Automatický přehled — před jednáním ověř u zdroje. Externí odkazy vedou mimo aplikaci.</div>' +
                '<div class="zpr-attr">Souhrny dle veřejných zdrojů; práva náleží jejich autorům.</div>';
        }
    }

    function openReader() {
        try { loadEdition(); } catch (e) {}   // při otevření vždy zkus dotáhnout nejčerstvější vydání
        buildOverlay();
        render();
        _ov.classList.add('open');
        // označit aktuální vydání jako přečtené -> zhasne tečka
        var v = latestVydani();
        if (v) { lsSet(K_SEEN, v); updateDot(); }
    }
    function closeReader() { if (_ov) _ov.classList.remove('open'); }

    window.openZpravodaj = openReader; // veřejné API (volitelné napojení odjinud)

    // --------------------------------------------------------------------------------
    // Položka v bočním menu (+ tečka)
    // --------------------------------------------------------------------------------
    function injectMenuButton() {
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('zpr-menu-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'zpr-menu-btn';
        btn.className = 'menu-btn';
        btn.type = 'button';
        btn.innerHTML = '<svg class="icon"><use href="#i-news"/></svg> Zpravodaj<span class="zpr-dot" id="zpr-dot" hidden></span>';
        btn.addEventListener('click', function () {
            openReader();
            if (typeof toggleMenu === 'function') try { toggleMenu(); } catch (e) {}
        });
        // vlož před oddělovač (hr) / přepínače HUD, ať akční tlačítka zůstanou pohromadě
        var hr = menu.querySelector('hr');
        var firstToggle = menu.querySelector('.menu-toggle-row');
        if (hr) menu.insertBefore(btn, hr);
        else if (firstToggle) menu.insertBefore(btn, firstToggle);
        else menu.appendChild(btn);
        updateDot();
    }

    // Vstup i na úvodní obrazovku — boční menu je dostupné až po spuštění AR,
    // ale zpravodaj má jít číst hned (i bez kamery/GPS).
    function injectWelcomeButton() {
        var wrap = document.querySelector('#welcome-screen .modal-content');
        if (!wrap || document.getElementById('zpr-welcome-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'zpr-welcome-btn';
        btn.type = 'button';
        btn.className = 'btn btn-secondary';
        btn.style.marginTop = '12px';
        btn.innerHTML = '<svg class="icon"><use href="#i-news"/></svg> Geo zpravodaj<span class="zpr-dot" hidden></span>';
        btn.addEventListener('click', openReader);
        // vlož za „Průvodce úkolem" (před primární „Spustit vyhledávání")
        var pruv = document.getElementById('pruv-welcome-btn');
        if (pruv) wrap.insertBefore(btn, pruv.nextSibling);
        else wrap.appendChild(btn);
        updateDot();
    }

    // --------------------------------------------------------------------------------
    // Init
    // --------------------------------------------------------------------------------
    function init() {
        try { injectMenuButton(); } catch (e) { console.warn('[zpravodaj] menu', e); }
        try { injectWelcomeButton(); } catch (e) { console.warn('[zpravodaj] welcome', e); }
        try { loadEdition(); } catch (e) { console.warn('[zpravodaj] load', e); }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    // druhý průchod — menu/úvodní obrazovka mohou vznikat později
    window.addEventListener('load', function () {
        setTimeout(function () { try { injectMenuButton(); } catch (e) {} try { injectWelcomeButton(); } catch (e) {} }, 400);
    });
    // když se přepne online, zkus dotáhnout čerstvé vydání
    window.addEventListener('online', function () { try { loadEdition(); } catch (e) {} });
    // PWA může běžet dny v paměti — po návratu do popředí zkus dotáhnout nové vydání
    // (jinak init() znovu neproběhne a 'online' se nespustí → uživatel vidí staré zprávy).
    var _lastFgFetch = 0;
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        var now = Date.now();
        if (now - _lastFgFetch < 300000) return;   // max 1×/5 min, ať nezatěžujeme síť
        _lastFgFetch = now;
        try { loadEdition(); } catch (e) {}
    });
})();
