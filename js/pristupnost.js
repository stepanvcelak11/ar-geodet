/* PŘÍSTUPNOST (25. 9. 2026, 6. hodnocení c1) — VoiceOver/TalkBack, orientační oblasti, popisky.
 *
 * Audit axe-core (scripts/test_pristupnost.py) našel na hlavních obrazovkách: 20+ posuvníků
 * a polí bez popisku (label), značku „moje poloha“ v mapě bez jména, stavovou bublinu s rolí
 * tlačítka a tlačítky uvnitř (nested-interactive) a obsah mimo orientační oblasti (region).
 * Místo úprav v desítkách modulů to tenhle modul dorovná za běhu:
 *   • ovládací prvek bez jména dostane aria-label z nejbližšího popisu v řádku nastavení
 *     (.st-lab / label / .st-slider-head), bez podtitulku <small>;
 *   • orientační oblasti: mapa = main, kamera, menu, info panel, karta bodu; okna appky
 *     (.modal-overlay) dostanou role=dialog a jméno podle nadpisu;
 *   • značka polohy v mapě „Tvoje poloha“; stavová bublina = skupina (tlačítka uvnitř zůstávají).
 * Hlídá i prvky, které přibudou později (okna modulů), přes jeden líný MutationObserver.
 *
 * ⚠ meta viewport s user-scalable=no ZŮSTÁVÁ vědomě: zvětšení stránky prsty by rozbilo gesta
 *   mapy a AR. Náhradou je Nastavení → Vzhled → Velikost písma (do 200 %), test to hlídá.
 *
 * Odpojitelné: smaž tento soubor + řádek <script type="ag/lazy"> v index.html.
 */
(function () {
    'use strict';
    if (window.AGPristupnost) return;
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'pristupnost:' + kde); } catch (x) { /* nic */ } }

    function textBez(el) {
        if (!el) return '';
        var c = el.cloneNode(true);
        c.querySelectorAll('small, .st-val, svg, input, select, button').forEach(function (x) { x.remove(); });
        return String(c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    function maJmeno(el) {
        if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) return true;
        if (el.id) { try { if (document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return true; } catch (e) { /* nic */ } }
        if (el.closest('label') && textBez(el.closest('label'))) return true;
        return false;
    }
    function popisek(el) {
        var r = el.closest('.st-slider, .st-row, .set-row, .ag-row, .szs-row, label, div');
        for (var i = 0; r && i < 3; i++, r = r.parentElement && r.parentElement.closest('.st-slider, .st-row, div')) {
            var lab = r.querySelector('.st-lab, label, .lbl, b, strong');
            var txt = textBez(lab && !lab.contains(el) ? lab : null);
            if (txt) return txt;
        }
        var prev = el.previousElementSibling;
        if (prev && /^(LABEL|SPAN|B|STRONG|DIV)$/.test(prev.tagName)) return textBez(prev);
        return el.getAttribute('placeholder') || '';
    }
    function ovladace(root) {
        (root || document).querySelectorAll('input:not([type=hidden]), select, textarea').forEach(function (el) {
            try { if (!maJmeno(el)) { var p = popisek(el); if (p) el.setAttribute('aria-label', p); } } catch (e) { swallow(e, 'ovladac'); }
        });
    }
    function okna(root) {
        (root || document).querySelectorAll('.modal-overlay:not([role])').forEach(function (m) {
            m.setAttribute('role', 'dialog');
            var h = m.querySelector('h1, h2, h3');
            var j = textBez(h); if (j) m.setAttribute('aria-label', j);
        });
    }
    var OBLASTI = [
        ['map-container', 'main', 'Mapa'], ['camera-container', 'region', 'Kamera (AR)'], ['side-menu', 'navigation', 'Menu'],
        ['info', 'region', 'Informační panel'], ['bottom-sheet', 'region', 'Karta bodu'], ['map-controls', 'region', 'Ovládání mapy']
    ];
    function oblasti() {
        OBLASTI.forEach(function (o) {
            var el = document.getElementById(o[0]); if (!el || el.getAttribute('role')) return;
            el.setAttribute('role', o[1]); el.setAttribute('aria-label', t(o[2]));
        });
        var sp = document.getElementById('ag-sp');
        if (sp && sp.getAttribute('role') === 'button') sp.setAttribute('role', 'group');   // tlačítka uvnitř nesmí být v tlačítku
        document.querySelectorAll('.leaflet-marker-icon.custom-user-icon:not([aria-label])').forEach(function (m) { m.setAttribute('aria-label', t('Tvoje poloha')); });
    }
    function vse(root) { ovladace(root); okna(root); oblasti(); }

    var _t = null, _koren = [];
    function naplanuj(n) {
        if (n && n.nodeType === 1) _koren.push(n);
        if (_t) return;
        _t = setTimeout(function () {
            _t = null; var k = _koren; _koren = [];
            try { if (k.length > 20) vse(document); else k.forEach(function (x) { if (x.isConnected) vse(x); }); } catch (e) { swallow(e, 'vse'); }
        }, 400);
    }
    function start() {
        try { vse(document); } catch (e) { swallow(e, 'start'); }
        try {
            new MutationObserver(function (recs) {
                for (var i = 0; i < recs.length; i++) for (var j = 0; j < recs[i].addedNodes.length; j++) {
                    var n = recs[i].addedNodes[j];
                    if (n.nodeType === 1 && (n.matches('input, select, textarea, .modal-overlay, .leaflet-marker-icon') || (n.querySelector && n.querySelector('input, select, textarea, .modal-overlay')))) naplanuj(n.parentElement || n);
                }
            }).observe(document.body, { childList: true, subtree: true });
        } catch (e) { swallow(e, 'observer'); }
        document.addEventListener('ag:nastaveni-strana', function () { naplanuj(document.getElementById('settings-modal')); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    window.AGPristupnost = { obnov: function () { vse(document); } };
})();
