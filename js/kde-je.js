// ===== AR Geodet — KDE MÁM AUTO / BÁZI / STATIV (ODPOJITELNÁ vrstva) ============
// Každodenní „kde jsem zaparkoval", ale pro geodetické vybavení. Jedním tapem
// uloží aktuální polohu pod štítkem (Auto, Báze, Stativ, Materiál, vlastní) a pak
// k ní naviguje: živá vzdálenost, azimut a ŠIPKA otočená podle kompasu telefonu.
//
// Proč to není „normální bod": tyhle značky NEJSOU měřená data — neukládají se do
// bodů zakázky, nelezou do exportů, protokolů ani do žurnálu. Drží se zvlášť
// (localStorage, globálně přes zakázky, protože auto stojí u jedné stavby a ne
// u jedné zakázky) a mažou se ručně nebo tlačítkem „Uklidit staré".
//
//   • Poloha se bere z průměrované GPS (gpsAvgResult), jinak z aktuální GPS appky.
//   • U báze / stativu se ukládá i přesnost fixu — orientačně poznáš, jak moc
//     se dá značce věřit (2 m vs. 15 m je rozdíl při hledání v kukuřici).
//   • „Zobrazit v mapě" vykreslí značky do hlavní mapy (vlastní Leaflet vrstva,
//     nedotýká se markersGroup s body).
//
// Neinvazivní: NEEDITUJE logika.js/grafika.js — čte globály (userLat/userLng,
// gpsAvgResult, currentGpsAccuracy, smoothedHeading, map, getDistance, getBearing).
// Vstup: dlaždice „Kde mám auto" v Nástrojích (Pomůcky). API: window.agOpenKdeJe().
// Odstranění: smaž js/kde-je.js + řádek <script> v index.html a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.__agKdeJeInit) return;
    window.__agKdeJeInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16V11l1.7-4.2A2 2 0 0 1 8.6 5.5h6.8a2 2 0 0 1 1.9 1.3L19 11v5"/><path d="M5 16h14M7.5 16v2M16.5 16v2M7 11.5h10"/></svg>';
    var STYLE_ID = 'ag-kj-style';
    var LS_KEY = 'agParked_v1';        // [{id, label, lat, lng, acc, ts}]
    var PRESETS = [
        { label: 'Auto', emoji: '🚗' },
        { label: 'Báze', emoji: '📡' },
        { label: 'Stativ', emoji: '📐' },
        { label: 'Materiál', emoji: '📦' }
    ];

    var _timer = null, _layer = null, _shown = false;

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function toast(m) { try { if (typeof window.quickToast === 'function') return window.quickToast(m); } catch (e) {} }
    function info(m) { try { if (typeof window.agInfo === 'function') return window.agInfo(m); } catch (e) {} agInfo(String(m).replace(/<[^>]*>/g, '')); }
    function ask(msg, cb) {
        try { if (typeof window.agAsk === 'function') { window.agAsk(msg).then(function (ok) { if (ok) cb(); }); return; } } catch (e) {}
        if (confirm(String(msg).replace(/<[^>]*>/g, ''))) cb();
    }

    function load() {
        try { var a = JSON.parse(localStorage.getItem(LS_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    function save(a) { try { localStorage.setItem(LS_KEY, JSON.stringify(a)); } catch (e) {} }

    function me() {
        // průměrovaná GPS má přednost (je to výsledek vědomého měření)
        try {
            if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && gpsAvgResult.n >= 2 && gpsAvgResult.lat != null) {
                return { lat: gpsAvgResult.lat, lng: gpsAvgResult.lng, acc: (gpsAvgResult.acc != null ? gpsAvgResult.acc : null), src: 'průměr GPS' };
            }
        } catch (e) {}
        try {
            if (typeof userLat === 'number' && userLat != null && typeof userLng === 'number' && userLng != null) {
                var a = null;
                try { if (typeof currentGpsAccuracy === 'number' && currentGpsAccuracy > 0) a = currentGpsAccuracy; } catch (e2) {}
                return { lat: userLat, lng: userLng, acc: a, src: 'GPS' };
            }
        } catch (e) {}
        return null;
    }
    function heading() {
        try { if (typeof smoothedHeading !== 'undefined' && smoothedHeading != null) return smoothedHeading; } catch (e) {}
        try { if (typeof currentHeading !== 'undefined' && currentHeading != null) return currentHeading; } catch (e) {}
        return null;
    }
    function dist(a, b) {
        try { if (typeof getDistance === 'function') return getDistance(a.lat, a.lng, b.lat, b.lng); } catch (e) {}
        var R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
        var la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180;
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    function bearing(a, b) {
        try { if (typeof getBearing === 'function') return getBearing(a.lat, a.lng, b.lat, b.lng); } catch (e) {}
        var la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180, dL = (b.lng - a.lng) * Math.PI / 180;
        var y = Math.sin(dL) * Math.cos(lb), x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dL);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }
    function distTxt(d) { return d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(d < 10000 ? 2 : 1) + ' km'; }
    function agoTxt(ts) {
        var m = Math.round((Date.now() - ts) / 60000);
        if (m < 1) return 'právě teď';
        if (m < 60) return 'před ' + m + ' min';
        var h = Math.round(m / 60);
        if (h < 24) return 'před ' + h + ' h';
        var d = Math.round(h / 24);
        return 'před ' + d + (d === 1 ? ' dnem' : ' dny');
    }
    function emojiOf(label) {
        for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].label === label) return PRESETS[i].emoji;
        return '📍';
    }

    // ---- uložení / smazání ------------------------------------------------------------
    function park(label) {
        var p = me();
        if (!p) { info('Nemám polohu — počkej na GPS fix a zkus to znovu.'); return; }
        var list = load();
        // stejný štítek = přeparkování (starou značku nedrž, jen mate)
        var old = null, i;
        for (i = 0; i < list.length; i++) if (list[i].label === label) { old = list[i]; break; }
        var rec = { id: 'pk_' + Date.now(), label: label, lat: p.lat, lng: p.lng, acc: p.acc, ts: Date.now() };
        if (old) {
            var moved = dist(old, rec);
            list = list.filter(function (x) { return x.label !== label; });
            list.push(rec);
            save(list);
            toast(label + ' přeuloženo (' + distTxt(moved) + ' od minulého místa).');
        } else {
            list.push(rec);
            save(list);
            toast(label + ' uloženo' + (p.acc != null ? ' (přesnost ±' + Math.round(p.acc) + ' m)' : '') + '.');
        }
        drawLayer(true);
        render();
    }
    function askCustom() {
        function go(name) {
            name = String(name || '').trim().slice(0, 24);
            if (!name) return;
            park(name);
        }
        try {
            if (typeof window.agPrompt === 'function') {
                window.agPrompt({ title: 'Vlastní značka', message: 'Jak se to místo jmenuje?', placeholder: 'Např. Vjezd na stavbu', okText: 'Uložit zde' })
                    .then(function (v) { if (v) go(v); });
                return;
            }
        } catch (e) {}
        var v = prompt('Název místa:');
        if (v) go(v);
    }
    function del(id) {
        var list = load().filter(function (x) { return x.id !== id; });
        save(list); drawLayer(true); render();
    }
    function cleanOld() {
        var list = load(), cut = Date.now() - 48 * 3600 * 1000;
        var keep = list.filter(function (x) { return x.ts >= cut; });
        if (keep.length === list.length) { toast('Nic staršího než 2 dny tu není.'); return; }
        ask('Smazat ' + (list.length - keep.length) + ' značek starších než 2 dny?', function () {
            save(keep); drawLayer(true); render(); toast('Uklizeno.');
        });
    }

    // ---- vrstva v mapě ----------------------------------------------------------------
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function drawLayer(onlyIfShown) {
        var m = getMap();
        if (!m || typeof L === 'undefined') return;
        if (onlyIfShown && !_shown) return;
        if (_layer) { try { m.removeLayer(_layer); } catch (e) {} _layer = null; }
        var list = load();
        if (!list.length) { _shown = false; return; }
        _layer = L.layerGroup();
        list.forEach(function (r) {
            try {
                L.marker([r.lat, r.lng], {
                    icon: L.divIcon({
                        className: 'ag-kj-mk',
                        html: '<div style="font-size:22px;line-height:1;text-shadow:0 1px 3px #000;">' + emojiOf(r.label) + '</div>' +
                            '<div style="font-size:10px;background:rgba(0,0,0,.65);color:#fff;padding:1px 4px;border-radius:4px;white-space:nowrap;">' + esc(r.label) + '</div>',
                        iconSize: [0, 0], iconAnchor: [10, 22]
                    }),
                    interactive: false, zIndexOffset: 800
                }).addTo(_layer);
            } catch (e) {}
        });
        _layer.addTo(m);
        _shown = true;
    }
    function toggleLayer() {
        var m = getMap();
        if (!m) { info('Mapa není k dispozici.'); return; }
        if (_shown && _layer) { try { m.removeLayer(_layer); } catch (e) {} _layer = null; _shown = false; toast('Značky v mapě skryté.'); }
        else { _shown = true; drawLayer(false); toast(_layer ? 'Značky jsou v mapě.' : 'Není co zobrazit.'); }
        render();
    }

    // ---- UI ---------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent =
            '#ag-kj-modal .ag-kj-btns{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px;}' +
            '#ag-kj-modal .ag-kj-btns button{flex:1 1 84px;padding:12px 6px;border-radius:12px;border:1px solid var(--border,rgba(255,255,255,.15));background:var(--bg-input,rgba(255,255,255,.06));color:inherit;font-size:.9em;}' +
            '#ag-kj-modal .ag-kj-btns button b{display:block;font-size:1.5em;margin-bottom:2px;}' +
            '#ag-kj-modal .ag-kj-it{display:flex;gap:10px;align-items:center;padding:10px;border-radius:12px;background:var(--bg-input,rgba(255,255,255,.06));margin-bottom:8px;}' +
            '#ag-kj-modal .ag-kj-ar{width:44px;height:44px;flex:0 0 44px;border-radius:50%;background:rgba(96,165,250,.18);display:flex;align-items:center;justify-content:center;font-size:22px;}' +
            '#ag-kj-modal .ag-kj-ar span{display:block;transition:transform .25s;}' +
            '#ag-kj-modal .ag-kj-tx{flex:1;min-width:0;} #ag-kj-modal .ag-kj-tx b{display:block;}' +
            '#ag-kj-modal .ag-kj-tx small{color:var(--text-muted,#9aa1ac);display:block;font-size:.82em;}' +
            '#ag-kj-modal .ag-kj-d{font-variant-numeric:tabular-nums;font-size:1.05em;white-space:nowrap;}' +
            '#ag-kj-modal .ag-kj-x{background:none;border:none;color:var(--text-muted,#9aa1ac);font-size:1.3em;padding:2px 6px;}' +
            '#ag-kj-modal .ag-kj-note{color:var(--text-muted,#9aa1ac);font-size:.82em;line-height:1.45;margin-top:10px;}' +
            // Seznam značek musí scrollovat SÁM: .modal-content má v css/style.css
            // overflow:hidden, takže po ~5 uložených značkách zbytek seznamu zmizel
            // pod okrajem okna a nešlo se k němu dostat (vzor brifink.js / denik-dne.js).
            '#ag-kj-modal .modal-content{display:flex;flex-direction:column;}' +
            '#ag-kj-modal h3,#ag-kj-modal .ag-kj-intro,#ag-kj-modal .ag-kj-btns{flex:none;}' +
            '#ag-kj-modal #ag-kj-list{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;padding-right:6px;}' +
            // Patička: .btn má width:100% + margin-top:10px, takže tři „řádkové" akce
            // se vykreslily jako tři pruhy pod sebou. Srovnáme je do jedné řady.
            '#ag-kj-modal .ag-kj-foot{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;flex:none;}' +
            '#ag-kj-modal .ag-kj-foot .btn{flex:1 1 0;min-width:96px;margin:0;min-height:44px;}' +
            'body.ag-glove #ag-kj-modal .ag-kj-foot .btn{min-height:52px;}';
        document.head.appendChild(s);
    }
    function ensureModal() {
        var m = document.getElementById('ag-kj-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'ag-kj-modal';
        var btns = PRESETS.map(function (p) {
            return '<button type="button" data-lbl="' + esc(p.label) + '"><b>' + p.emoji + '</b>' + esc(p.label) + '</button>';
        }).join('') + '<button type="button" data-lbl="__custom"><b>➕</b>Vlastní</button>';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Kde mám auto</h3>' +
            '  <p class="ag-kj-intro" style="margin:0;color:var(--text-muted,#9aa1ac);font-size:.9em;">Jedním tapem si tady označ, kde stojí auto, báze nebo stativ. Značky se neukládají mezi body zakázky.</p>' +
            '  <div class="ag-kj-btns" id="ag-kj-add">' + btns + '</div>' +
            '  <div id="ag-kj-list"></div>' +
            '  <div class="ag-kj-foot">' +
            '    <button type="button" class="btn btn-secondary" id="ag-kj-map">Zobrazit v mapě</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-kj-clean">Uklidit staré</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-kj-close">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-kj-close').addEventListener('click', close);
        m.querySelector('#ag-kj-map').addEventListener('click', toggleLayer);
        m.querySelector('#ag-kj-clean').addEventListener('click', cleanOld);
        m.querySelector('#ag-kj-add').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-lbl]') : null;
            if (!b) return;
            var lbl = b.getAttribute('data-lbl');
            if (lbl === '__custom') askCustom(); else park(lbl);
        });
        m.querySelector('#ag-kj-list').addEventListener('click', function (e) {
            var x = e.target.closest ? e.target.closest('.ag-kj-x') : null;
            if (!x) return;
            var id = x.getAttribute('data-id');
            ask('Smazat značku?', function () { del(id); });
        });
        return m;
    }

    function render() {
        var el = document.getElementById('ag-kj-list');
        if (!el) return;
        var list = load().slice().sort(function (a, b) { return b.ts - a.ts; });
        var p = me(), hd = heading();
        if (!list.length) {
            el.innerHTML = '<div style="padding:10px;color:var(--text-muted,#9aa1ac);font-size:.9em;">Nic neuloženo. Až vystoupíš z auta, klepni na 🚗 — pak tě sem appka dovede.</div>';
            return;
        }
        var h = '';
        list.forEach(function (r) {
            var d = p ? dist(p, r) : null;
            var az = p ? bearing(p, r) : null;
            var rel = (az != null && hd != null) ? ((az - hd + 360) % 360) : null;
            h += '<div class="ag-kj-it">' +
                '<div class="ag-kj-ar"><span style="transform:rotate(' + (rel != null ? rel.toFixed(0) : 0) + 'deg);">' + (rel != null ? '⬆' : emojiOf(r.label)) + '</span></div>' +
                '<div class="ag-kj-tx"><b>' + emojiOf(r.label) + ' ' + esc(r.label) + '</b>' +
                '<small>' + agoTxt(r.ts) + (r.acc != null ? ' · uloženo s přesností ±' + Math.round(r.acc) + ' m' : '') +
                (az != null ? ' · azimut ' + az.toFixed(0) + '°' : '') + '</small></div>' +
                '<div class="ag-kj-d">' + (d != null ? distTxt(d) : '–') + '</div>' +
                '<button type="button" class="ag-kj-x" data-id="' + esc(r.id) + '" aria-label="Smazat">×</button>' +
                '</div>';
        });
        if (!p) h += '<div class="ag-kj-note">Vzdálenosti a šipky se ukážou, až bude GPS fix.</div>';
        else if (hd == null) h += '<div class="ag-kj-note">Šipka se otočí, až kompas začne dávat data (zvedni telefon a otoč se).</div>';
        h += '<div class="ag-kj-note">Šipka ukazuje směr, když držíš telefon před sebou (jako v AR). U báze a stativu ber uloženou přesnost jako poloměr, ve kterém hledat.</div>';
        el.innerHTML = h;
    }

    function open() {
        var m = ensureModal();
        m.style.display = 'flex';
        render();
        if (_timer) clearInterval(_timer);
        _timer = setInterval(function () {
            var mm = document.getElementById('ag-kj-modal');
            if (!mm || mm.style.display === 'none') { clearInterval(_timer); _timer = null; return; }
            render();
        }, 1500);
    }
    function close() {
        var m = document.getElementById('ag-kj-modal');
        if (m) m.style.display = 'none';
        if (_timer) { clearInterval(_timer); _timer = null; }
    }

    // ---- registrace dlaždice ----------------------------------------------------------
    var _regTries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'kde-je', label: 'Kde mám auto', icon: ICON, cat: 'Pomůcky', onClick: open, order: 9 });
            return;
        }
        if (_regTries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.agOpenKdeJe = open;
    window.agParkHere = park;   // pro zkratky / hlasové ovládání v budoucnu
})();
