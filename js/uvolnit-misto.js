// ===== QTRIG — UVOLNIT MÍSTO: co appka v telefonu drží a jak to smazat (ODPOJITELNÁ) ==
// PŘÁNÍ (15. 9. 2026): „appka teď stahuje mapu i body, tak by bylo fajn mít možnost
// je smazat a uvolnit tak místo v mobilu."
//
// CO DĚLÁ: do Nastavení → Údržba přidá blok „Uvolnit místo" s přehledem, co zabírá
// místo, a s tlačítkem Smazat u každé položky:
//   • Mapa offline — dlaždice OSM / katastru / ortofota z „Uložit okolí", „Sbalit
//     zakázku" i „Stáhnout oblast" (jedna cache 'argeodet-offline-v12'); velikost je
//     ODHAD (počet dílků × 14 kB), přesně by se muselo číst každý obrázek.
//   • Stažené oblasti — balíčky bodů okresů/krajů/ČR (js/oblasti-offline.js), každý
//     zvlášť; smazání bere i jeho dlaždice.
//   • Ostatní — co hlásí AGStore.report() (fotky, hlasovky, žurnál…): jen přehled,
//     mazání mají vlastní nástroje (Závady, Geo-fotka…).
// Kód appky (service worker, cache shellu) se tu nemaže — o ten se stará aktualizace.
// Po každém smazání se přepočítá řádek „Využito X MB" (agRenderStorageUsage v logika.js).
//
// Odstranění: smaž js/uvolnit-misto.js + řádek <script> v index.html.
// ================================================================================
(function () {
    'use strict';
    if (window.AGUvolnit) return;

    var TILE_CACHE = 'argeodet-offline-v12';    // MUSÍ sedět s sw.js / logika.js / oblasti-offline.js
    var TILE_KB = 14;                            // průměrná dlaždice OSM/WMS (odhad)
    var ID = 'ag-uvolnit';

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde); } catch (x) { } }
    function toast(m) { try { if (window.AG && AG.toast) return AG.toast(m); } catch (e) { } try { if (typeof quickToast === 'function') quickToast(m); } catch (e) { } }
    function confirmBox(o) { if (typeof window.agConfirm === 'function') return window.agConfirm(o); return Promise.resolve(window.confirm(String(o.message || '').replace(/<[^>]+>/g, ''))); }
    function mb(b) { return b < 1048576 ? Math.round(b / 1024) + ' kB' : (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' MB'; }
    function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function refreshUsage() { try { if (typeof window.agRenderStorageUsage === 'function') window.agRenderStorageUsage(); } catch (e) { swallow(e, 'uvolnit:usage'); } }

    function box() {
        var b = document.getElementById(ID);
        if (b) return b;
        var tab = document.getElementById('tab-udrzba'); if (!tab) return null;
        b = document.createElement('div'); b.id = ID;
        b.innerHTML = '<div class="set-h">Uvolnit místo</div><div id="ag-uvolnit-rows" style="display:flex;flex-direction:column;gap:8px;font-size:calc(12.5px * var(--ag-font-scale, 1));line-height:1.4;"></div>';
        // za řádek „Využito X MB", před „Úklid"
        var anchor = document.getElementById('storage-usage');
        if (anchor && anchor.parentNode === tab) tab.insertBefore(b, anchor.nextSibling); else tab.appendChild(b);
        b.addEventListener('click', onClick);
        return b;
    }
    function row(html, btn) {
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,.12));background:rgba(255,255,255,.03);">'
            + '<div style="flex:1 1 auto;min-width:0;">' + html + '</div>' + (btn || '') + '</div>';
    }
    function delBtn(act, id, label) {
        return '<button type="button" class="btn btn-secondary" data-act="' + act + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + ' style="flex:0 0 auto;width:auto;min-width:0;margin:0;padding:7px 12px;min-height:36px;font-size:calc(12px * var(--ag-font-scale, 1));">' + (label || 'Smazat') + '</button>';
    }

    function tileCount() {
        if (!('caches' in window)) return Promise.resolve(null);
        return caches.open(TILE_CACHE).then(function (c) { return c.keys(); }).then(function (k) { return k.length; }).catch(function () { return null; });
    }

    var _busy = false;
    function render() {
        var b = box(); if (!b) return;
        var host = b.querySelector('#ag-uvolnit-rows'); if (!host) return;
        host.innerHTML = '<div style="color:var(--text-muted)">Počítám…</div>';
        var O = window.AGOblasti;
        Promise.all([
            tileCount(),
            O && O.loadMeta ? O.loadMeta().then(function (m) { return (m && m.balicky) || []; }).catch(function () { return []; }) : Promise.resolve([]),
            (window.AGStore && AGStore.report) ? AGStore.report().catch(function () { return []; }) : Promise.resolve([])
        ]).then(function (r) {
            var tiles = r[0], bal = r[1], rep = r[2], h = '';
            if (tiles == null) h += row('<b>Mapa offline</b><br><span style="color:var(--text-muted)">tenhle prohlížeč ukládání dlaždic neumí</span>');
            else if (!tiles) h += row('<b>Mapa offline</b><br><span style="color:var(--text-muted)">nic staženého</span>');
            else h += row('<b>Mapa offline</b> — ' + num(tiles) + ' dílků, ≈ ' + mb(tiles * TILE_KB * 1024) + '<br><span style="color:var(--text-muted)">z Uložit okolí, Sbalit zakázku i Stáhnout oblast; po smazání se mapa zase stahuje ze sítě</span>', delBtn('mapa', '', 'Smazat'));
            if (bal.length) {
                bal.forEach(function (x) {
                    var casti = [];
                    if (x.body) casti.push(num(x.body.pocet || 0) + ' bodů ≈ ' + mb((x.body.pocet || 0) * 160));
                    if (x.mapa) casti.push(num(x.mapa.celkem || 0) + ' dílků mapy');
                    h += row('<b>Oblast: ' + esc(x.nazev) + '</b><br><span style="color:var(--text-muted)">' + esc(casti.join(' · ') || 'rozdělaný balíček') + '</span>', delBtn('oblast', x.id, 'Smazat'));
                });
            } else if (O) h += row('<b>Stažené oblasti</b><br><span style="color:var(--text-muted)">žádný okres ani kraj v telefonu</span>');
            var jine = (rep || []).filter(function (x) { return x && x.bajtu > 200 * 1024; });
            if (jine.length) h += row('<b>Ostatní</b><br><span style="color:var(--text-muted)">' + jine.map(function (x) { return esc(x.co || x.db) + ' ' + mb(x.bajtu); }).join(' · ') + ' — mažou se v příslušném nástroji (fotky u závad, geo-fotky…)</span>');
            host.innerHTML = h || '<div style="color:var(--text-muted)">Nic ke smazání.</div>';
        }).catch(function (e) { swallow(e, 'uvolnit:render'); host.innerHTML = '<div style="color:var(--text-muted)">Přehled se nepodařilo sestavit.</div>'; });
    }

    function onClick(e) {
        var b = e.target.closest ? e.target.closest('button[data-act]') : null; if (!b || _busy) return;
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
        if (act === 'mapa') {
            confirmBox({ title: 'Smazat mapu offline', message: 'Smazat všechny stažené dílky mapy (Uložit okolí, Sbalit zakázku i Stáhnout oblast)? Body zůstanou. Bez signálu pak bude mapa prázdná, dokud si ji zase nestáhneš.', okText: 'Smazat', danger: true }).then(function (ok) {
                if (!ok) return; _busy = true;
                return caches.delete(TILE_CACHE).then(function () { return (window.AGOblasti && AGOblasti.mapaSmazana) ? AGOblasti.mapaSmazana() : null; })
                    .then(function () { toast('Mapa offline smazána.'); }).catch(function (e) { swallow(e, 'uvolnit:mapa'); toast('Smazání se nepovedlo.'); })
                    .then(function () { _busy = false; render(); refreshUsage(); });
            });
        } else if (act === 'oblast' && window.AGOblasti) {
            confirmBox({ title: 'Smazat oblast', message: 'Smazat tenhle balíček (body i jeho dílky mapy) z telefonu? Body se pak zase stahují ze sítě.', okText: 'Smazat', danger: true }).then(function (ok) {
                if (!ok) return; _busy = true;
                return AGOblasti.smazat(id).then(function () { toast('Oblast smazána.'); try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { } })
                    .catch(function (e) { swallow(e, 'uvolnit:oblast'); toast('Smazání se nepovedlo.'); })
                    .then(function () { _busy = false; render(); refreshUsage(); });
            });
        }
    }

    // Přehled se skládá až při otevřené záložce Údržba (cache.keys() nad tisíci
    // dlaždicemi není zadarmo) — sleduje se přepnutí záložky, ne tik.
    function init() {
        var btn = document.getElementById('tabbtn-udrzba');
        if (btn) btn.addEventListener('click', function () { setTimeout(render, 50); });
        try {
            var tab = document.getElementById('tab-udrzba');
            if (tab && tab.classList.contains('active')) render();
        } catch (e) { swallow(e, 'uvolnit:init'); }
    }
    window.AGUvolnit = { render: render };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
