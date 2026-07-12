// ===== AR Geodet — OFFSET BOD / NEPŘÍSTUPNÝ BOD (ODPOJITELNÁ vrstva) ============
// Neinvazivní vrstva. NEEDITUJE logika.js ani grafika.js — čte globály a ukládá
// přes oficiální window.addImportedPoints(). Spočítá souřadnice bodu, ke kterému
// se nedá stoupnout (roh budovy, střed šachty, pata sloupu): ze základu
// (moje GPS poloha NEBO vybraný bod) + zeměpisný azimut + vodorovná délka.
//
// Azimut je ZEMĚPISNÝ (0°=sever, po směru hodin) — shodně se zbytkem appky
// (getBearing, currentHeading). Lze ho převzít z kompasu.
//
// Vstup do nástroje: tlačítko „Offset bod" v launcheru (js/field-tools.js).
// Odstranění: smaž js/offset-point.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';
    var _baseMode = 'gps';     // 'gps' | 'point'
    var _basePointId = null;

    function agAlert(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {} alert(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function num(id) { var el = document.getElementById(id); var v = el ? parseFloat(String(el.value).replace(',', '.')) : NaN; return isFinite(v) ? v : NaN; }

    // ---- základ výpočtu --------------------------------------------------------
    function getBase() {
        if (_baseMode === 'point' && _basePointId != null && typeof arPoints !== 'undefined') {
            var p = arPoints.find(function (q) { return q.id === _basePointId; });
            if (p) return { lat: p.lat, lng: p.lng, label: '#' + p.name, acc: null };
        }
        // GPS: preferuj zprůměrovanou polohu (přesnější)
        try {
            if (typeof gpsAvgResult !== 'undefined' && gpsAvgResult && gpsAvgResult.n >= 2) {
                return { lat: gpsAvgResult.lat, lng: gpsAvgResult.lng, label: 'GPS (⌀ ' + gpsAvgResult.n + ' měření)', acc: gpsAvgResult.sterr };
            }
        } catch (e) {}
        if (typeof userLat !== 'undefined' && userLat != null && userLng != null) {
            return { lat: userLat, lng: userLng, label: 'GPS (aktuální)', acc: (typeof currentGpsAccuracy !== 'undefined' ? currentGpsAccuracy : null) };
        }
        return null;
    }

    // ZEMĚPISNÝ forward: lokální rovinná aproximace (přesná na metry–km offsetů v ČR).
    // Poloměry křivosti elipsoidu (GeoCore) — konstanta 111320 měla ~0,15 % chybu (15 cm/100 m).
    function forward(lat, lng, azDeg, dist) {
        var _m = (typeof GeoCore !== 'undefined' && GeoCore.metersPerDeg) ? GeoCore.metersPerDeg(lat) : { lat: 111320, lng: 111320 * Math.cos(lat * Math.PI / 180) };
        var mLat = _m.lat, mLng = _m.lng;
        var a = azDeg * Math.PI / 180;
        var dN = dist * Math.cos(a), dE = dist * Math.sin(a);
        return { lat: lat + dN / mLat, lng: lng + dE / mLng };
    }

    function recompute() {
        var base = getBase();
        var baseEl = document.getElementById('agof-base-info');
        if (baseEl) {
            baseEl.innerHTML = base
                ? (base.label + (base.acc != null ? ' · ±' + base.acc.toFixed(1) + ' m' : ''))
                : '<span style="color:var(--danger,#fb7185)">Není poloha — počkej na GPS, nebo vyber bod.</span>';
        }
        var out = document.getElementById('agof-result');
        var az = num('agof-az'), d = num('agof-dist');
        if (!base || isNaN(az) || isNaN(d)) { if (out) out.innerHTML = '<span style="opacity:.6">Vyplň azimut a délku…</span>'; return null; }
        var t = forward(base.lat, base.lng, az, d);
        var sj = proj4('EPSG:4326', 'EPSG:5514', [t.lng, t.lat]);
        var Y = Math.abs(sj[0]).toFixed(2), X = Math.abs(sj[1]).toFixed(2);
        if (out) out.innerHTML = '<b>Y</b> ' + Y + ' &nbsp; <b>X</b> ' + X + '<br><span style="opacity:.65;font-size:12px">' + t.lat.toFixed(6) + ', ' + t.lng.toFixed(6) + '</span>';
        return { lat: t.lat, lng: t.lng, Y: Y, X: X };
    }

    function fromCompass() {
        try {
            if (typeof currentHeading === 'number' && isFinite(currentHeading)) {
                var el = document.getElementById('agof-az'); if (el) { el.value = currentHeading.toFixed(1); recompute(); }
            } else agAlert('Kompas', 'Zatím nemám směr z kompasu — chvíli podrž telefon ve svislé poloze.');
        } catch (e) {}
    }

    function fillPointSelect() {
        var sel = document.getElementById('agof-point'); if (!sel || typeof arPoints === 'undefined') return;
        var list = arPoints.filter(function (p) { return !p.hidden; })
            .map(function (p) { return { p: p, d: (typeof userLat !== 'undefined' && userLat != null) ? getDistance(userLat, userLng, p.lat, p.lng) : null }; })
            .sort(function (a, b) { return (a.d == null || b.d == null) ? 0 : a.d - b.d; });
        sel.innerHTML = list.map(function (x) {
            return '<option value="' + x.p.id + '">#' + x.p.name + (x.d != null ? ' · ' + x.d.toFixed(0) + ' m' : '') + '</option>';
        }).join('');
        if (list.length && _basePointId == null) _basePointId = list[0].p.id;
        if (_basePointId != null) sel.value = _basePointId;
    }

    function ensureModal() {
        if (document.getElementById('agof-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agof-modal'; el.style.zIndex = '100001';
        el.innerHTML =
            '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON.replace('width="20"', '') + ' Offset bod (nepřístupný bod)</h3>'
            + '<p style="font-size:12.5px;opacity:.7;margin:2px 0 10px;">Spočítá bod, kam se nedá stoupnout: ze základu + zeměpisného azimutu (0°=sever) + vodorovné délky.</p>'
            + '<label class="filter-row" style="font-size:13px;"><input type="radio" name="agof-base" value="gps" checked> Z mé polohy (GPS)</label>'
            + '<label class="filter-row" style="font-size:13px;"><input type="radio" name="agof-base" value="point"> Od vybraného bodu</label>'
            + '<select id="agof-point" style="display:none;width:100%;margin:4px 0 6px;"></select>'
            + '<div id="agof-base-info" style="font-size:13px;margin:2px 0 12px;color:var(--accent);"></div>'
            + '<label>Azimut (°, zeměpisný)</label>'
            + '<div style="display:flex;gap:8px;align-items:center;"><input type="number" id="agof-az" step="0.1" inputmode="decimal" style="flex:1;" placeholder="0–360">'
            + '<button type="button" class="btn btn-secondary" style="white-space:nowrap;margin:0;" id="agof-compass">Z kompasu</button></div>'
            + '<label style="margin-top:8px;">Vodorovná délka (m)</label>'
            + '<input type="number" id="agof-dist" step="0.01" inputmode="decimal" placeholder="např. 4.20">'
            + '<label style="margin-top:8px;">Název bodu</label>'
            + '<input type="text" id="agof-name" placeholder="OFF1">'
            + '<div style="margin:12px 0;padding:10px 12px;border-radius:10px;background:rgba(47,158,116,0.12);font-family:var(--font-mono,monospace);" id="agof-result"></div>'
            + '<button class="btn" id="agof-save"><svg class="icon"><use href="#i-plus"/></svg> Uložit bod</button>'
            + '<button class="btn btn-secondary" style="margin-top:10px;" onclick="document.getElementById(\'agof-modal\').style.display=\'none\'">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);

        el.querySelectorAll('input[name="agof-base"]').forEach(function (r) {
            r.addEventListener('change', function () {
                _baseMode = r.value;
                document.getElementById('agof-point').style.display = (_baseMode === 'point') ? 'block' : 'none';
                recompute();
            });
        });
        document.getElementById('agof-point').addEventListener('change', function () { _basePointId = this.value; recompute(); });
        document.getElementById('agof-az').addEventListener('input', recompute);
        document.getElementById('agof-dist').addEventListener('input', recompute);
        document.getElementById('agof-compass').addEventListener('click', fromCompass);
        document.getElementById('agof-save').addEventListener('click', save);
    }

    function save() {
        var r = recompute();
        if (!r) { agAlert('Chybí údaje', 'Potřebuju polohu/základ, azimut i délku.'); return; }
        var name = (document.getElementById('agof-name').value || '').trim() || ('OFF' + Date.now().toString().slice(-4));
        if (typeof window.addImportedPoints !== 'function') { agAlert('Nelze uložit', 'Funkce pro vkládání bodů není dostupná.'); return; }
        var added = window.addImportedPoints([{ name: name, lat: r.lat, lng: r.lng }]);
        if (added > 0) {
            agAlert('Bod uložen', '#' + name + ' uložen do aktuální zakázky.\nY ' + r.Y + '  X ' + r.X);
            document.getElementById('agof-modal').style.display = 'none';
        } else {
            agAlert('Neuloženo', 'Bod se stejným názvem a polohou už v zakázce je.');
        }
    }

    function openTool() {
        ensureModal();
        fillPointSelect();
        var nm = document.getElementById('agof-name'); if (nm && !nm.value) nm.value = '';
        recompute();
        document.getElementById('agof-modal').style.display = 'flex';
    }

    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'offset-point', label: 'Offset bod', icon: ICON, onClick: openTool, order: 20 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
    window.agOpenOffsetTool = openTool;   // ať jde navázat i ručně (např. na tlačítko v doku)
})();

/* === DOPLNĚK: scroll + zavírací X v rohu pro VŠECHNY modály terénních nástrojů =
   (Umístěno zde, protože offset-point.js je vždy zadrátovaný/načtený. Dřív byl
   tento doplněk v geo-overlay.js, který ale NENÍ v index.html -> neběžel.)
   Každý .modal-overlay, jehož .modal-content nemá .modal-body (= „plochý"
   nástrojový modál), dostane scroll + přilepený zavírací křížek. Nativní okna
   appky (Nastavení/Export/Kalkulačka…) mají modal-body / jsou na denylistu. */
(function () {
    'use strict';
    // nativní okna appky (staticky v index.html + známé dynamické) — nikdy nešahat
    var SKIP = { 'settings-modal': 1, 'manage-modal': 1, 'calc-modal': 1, 'about-modal': 1, 'dict-modal': 1, 'tools-modal': 1, 'compass-modal': 1, 'compass-calib-modal': 1, 'cluster-modal': 1, 'nearby-modal': 1, 'measure-modal': 1, 'custom-modal-overlay': 1, 'welcome-screen': 1, 'stakeout-modal': 1, 'stake-detail-modal': 1 };
    function injectCss() {
        if (document.getElementById('ag-modalx-css')) return;
        var st = document.createElement('style'); st.id = 'ag-modalx-css';
        st.textContent =
            '.modal-overlay .modal-content.ag-scrollable{display:block;width:100%;max-width:100%;height:100%;max-height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;}'
            + '.ag-modal-x{position:sticky;top:0;z-index:6;height:0;text-align:right;pointer-events:none;}'
            + '.ag-modal-x>button{pointer-events:auto;position:relative;top:-10px;right:-6px;width:34px;height:34px;border:none;border-radius:50%;background:rgba(0,0,0,0.5);color:#fff;font:300 23px/1 system-ui,sans-serif;cursor:pointer;}';
        (document.head || document.documentElement).appendChild(st);
    }
    function isToolModal(ov, c) {
        if (!c) return false;
        if (ov.id && SKIP[ov.id]) return false;   // nativní okno appky -> přeskočit
        return true;                               // vše ostatní = nástrojový modál (i s modal-body, např. parcela)
    }
    function enhance(ov, c) {
        // scroll override JEN pro „ploché" modály (bez modal-body) — s modal-body by display:block rozbil layout
        if (!c.querySelector('.modal-body') && !c.classList.contains('ag-scrollable')) c.classList.add('ag-scrollable');
        if (c.querySelector('.ag-modal-x')) return;   // křížek přidáváme VŽDY (i k modálům s modal-body)
        var wrap = document.createElement('div'); wrap.className = 'ag-modal-x';
        var b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Zavřít'); b.textContent = '×';
        b.addEventListener('click', function () { try { ov.style.display = 'none'; } catch (e) {} });
        wrap.appendChild(b); c.insertBefore(wrap, c.firstChild);
    }
    function tick() {
        try {
            injectCss();
            var ovs = document.querySelectorAll('.modal-overlay');
            for (var i = 0; i < ovs.length; i++) { var ov = ovs[i], c = ov.querySelector('.modal-content'); if (isToolModal(ov, c)) enhance(ov, c); }
        } catch (e) {}
    }
    function init() { try { injectCss(); if (!window.__agModalXTimer) window.__agModalXTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(tick, 400); tick(); } catch (e) {} }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    window.addEventListener('load', function () { setTimeout(init, 500); });
})();
