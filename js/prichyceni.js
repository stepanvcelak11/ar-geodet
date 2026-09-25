// ===== QTRIG — PŘICHYCENÍ BODU K ROHU BUDOVY / LOMU PARCELY / VÝKRESU (ODPOJITELNÁ) =====
// (16. 9. 2026, fáze 2 „vlastní mapa" — P2; viz paměť project-vlastni-mapa-svet-vyber-16-9)
//
// Ukládáš bod z GPS 0,4 m od rohu budovy z katastru → appka se zeptá „Přichytit k rohu
// budovy č. 128 (0,4 m)?" a vezme souřadnice z mapy místo z telefonu. Rohy dodává
// js/hrany.js: lomy parcel (RÚIAN), rohy budov (vektorová mapa), lomy a body tvého DXF.
// Bod dostane provenienci `prichyceni` = { zdroj, popis, d } a přesnost podle zdroje
// (parcela 0,1 m · výkres 0,05 m · budova 0,5 m), takže QC a karta bodu vědí, odkud je.
//
// JAK: obalí window.saveCustomPoint (stejně jako js/kvalita-bodu.js). Ptá se jen u NOVÉHO
// bodu ze souřadnic v poli (GPS průměr, jeden odečet, z mapy) — ne při editaci, ne u ručně
// napsaných Y/X (ty jsou úmysl). Dosah: 0,6 m pro parcelu/výkres, 1,0 m pro budovu z OSM.
// Odpověď „Ne" bod uloží tak, jak je. Nastavení → AR & přesnost → „Přichytávat k rohům".
//
// Odstranění: smaž js/prichyceni.js + <script> v index.html; gen_sw_assets --bump.
// ==========================================================================================
(function () {
    'use strict';
    if (window.AGPrichyceni) return;
    var swallow = function (e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'prichyceni:' + kde); } catch (e2) { /* nic */ } };
    var KEY = 'agPrichyceni_v1';
    var DOSAH = { parcela: 0.6, dxf: 0.6, budova: 1.0 };
    var st = { zap: true };
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.zap != null) st.zap = !!s.zap; } catch (e) { swallow(e, 'load'); }
    function uloz() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { swallow(e, 'save'); } }

    var posledni = null;   // poslední přichycení (pro test a kartu bodu)
    var _probiha = false;  // právě ukládám po rozhodnutí — neptat se znovu (společné pro všechny obaly)
    var _obaleno = false;  // obalit JEDNOU: kdo obalí až nás, volá náš obal; dvojí obal se ptal dvakrát

    function kandidat(lat, lng) {
        if (!window.AGHrany) return null;
        var v = AGHrany.nejblizsiVrchol(lat, lng, 1.2);
        if (!v) return null;
        if (v.d > (DOSAH[v.zdroj] || 0.6)) return null;
        return v;
    }
    function souradniceZPole() {
        try {
            var y = agNumIn('custom-y'), x = agNumIn('custom-x');
            if (!isFinite(y) || !isFinite(x)) return null;
            var ll = mistniToLatLng(y, x);
            return (ll && isFinite(ll.lat)) ? { lat: ll.lat, lng: ll.lng } : null;
        } catch (e) { swallow(e, 'pole'); return null; }
    }
    function zapisDoPole(ll) {
        var m = agMistni(ll.lat, ll.lng);
        document.getElementById('custom-y').value = agFmtPresne(m.y);
        document.getElementById('custom-x').value = agFmtPresne(m.x);
    }
    function fmt(d) { return d.toFixed(2).replace('.', ','); }

    function obal() {
        var orig = window.saveCustomPoint;
        if (typeof orig !== 'function' || orig._agPrichyceni || _obaleno) return;
        _obaleno = true;
        var wrapped = function () {
            var args = arguments, self = this;
            try {
                var origin = window._agPointOrigin;
                var edituju = (typeof editingCustomPointId !== 'undefined') && !!editingCustomPointId;
                if (!st.zap || edituju || _probiha || !origin || origin === 'ruc' || origin === 'import') return orig.apply(self, args);
                var ll = souradniceZPole(); if (!ll) return orig.apply(self, args);
                var k = kandidat(ll.lat, ll.lng); if (!k) return orig.apply(self, args);
                var co = k.zdroj === 'parcela' ? 'lomu hranice parcely' : k.zdroj === 'dxf' ? 'bodu výkresu' : 'rohu budovy';
                var msg = 'Bod je <b>' + fmt(k.d) + ' m</b> od ' + co + ' (' + (window.AG && AG.esc ? AG.esc(k.popis) : k.popis) + '). Vzít souřadnice z mapy místo z GPS?<br><small>Přesnost zdroje ±' + fmt(k.presnost) + ' m; do bodu se zapíše, odkud je.</small>';
                var rozhodni = function (ano) {
                    _probiha = true;
                    try {
                        if (ano) {
                            zapisDoPole(k);
                            window._agPointOrigin = k.zdroj === 'parcela' ? 'katastr' : (k.zdroj === 'dxf' ? 'vykres' : 'mapa-budova');
                            try { pendingPointAccuracy = k.presnost; } catch (e) { swallow(e, 'acc'); }
                            posledni = { zdroj: k.zdroj, popis: k.popis, d: Math.round(k.d * 100) / 100, ts: Date.now() };
                        }
                        var pred = (typeof persistentCustomPoints !== 'undefined') ? persistentCustomPoints.length : -1;
                        var ret = orig.apply(self, args);
                        if (ano && pred >= 0 && persistentCustomPoints.length === pred + 1) {
                            var p = persistentCustomPoints[persistentCustomPoints.length - 1];
                            if (p && p.prov) { p.prov.prichyceni = posledni; try { setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints)); } catch (e) { swallow(e, 'persist'); } }
                        }
                        return ret;
                    } finally { _probiha = false; }
                };
                if (typeof window.agConfirm === 'function') { window.agConfirm({ title: 'Přichytit k ' + co + '?', message: msg, okText: 'Přichytit', cancelText: 'Nechat GPS' }).then(rozhodni); return; }
                return rozhodni(window.confirm('Bod je ' + fmt(k.d) + ' m od ' + co + '. Vzít souřadnice z mapy?'));
            } catch (e) { swallow(e, 'wrapped'); return orig.apply(self, args); }
        };
        wrapped._agPrichyceni = true; wrapped._agOrig = orig;
        window.saveCustomPoint = wrapped;
    }

    // ---- Nastavení → AR & přesnost -------------------------------------------------------------
    function ui() {
        if (document.getElementById('s-prichyceni')) return;
        var tab = document.getElementById('tab-ar'); if (!tab) return;
        var hs = tab.querySelectorAll('.set-h'), kotva = null;
        for (var i = 0; i < hs.length; i++) if (/Kompas/.test(hs[i].textContent)) { kotva = hs[i]; break; }
        var h = document.createElement('div'); h.className = 'set-h'; h.textContent = 'Přesnost z mapy';
        var r = document.createElement('div'); r.className = 'st-row';
        r.innerHTML = '<span class="st-lab">Přichytávat body k rohům<small>nový bod do 0,6 m od lomu parcely, rohu budovy nebo bodu výkresu → nabídne souřadnice z mapy</small></span><label class="st-sw"><input type="checkbox" id="s-prichyceni"' + (st.zap ? ' checked' : '') + '><span class="st-sw-face"></span></label>';
        if (kotva) { tab.insertBefore(h, kotva); tab.insertBefore(r, kotva); } else { tab.appendChild(h); tab.appendChild(r); }
        r.querySelector('input').addEventListener('change', function (ev) { st.zap = !!ev.target.checked; uloz(); });
    }
    function start() {
        obal();
        try { ui(); } catch (e) { swallow(e, 'ui'); }
        document.addEventListener('click', function (ev) { try { if (ev.target && ev.target.closest && ev.target.closest('#settings-btn, [data-open="settings"]')) setTimeout(ui, 50); } catch (e) { /* nic */ } }, true);
        // kdyby saveCustomPoint obalil ještě někdo po nás, náš obal zůstane uvnitř — obalujeme až po startu
        setTimeout(obal, 1500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    window.AGPrichyceni = { kandidat: kandidat, posledni: function () { return posledni; }, nastav: function (o) { if (o && o.zap != null) st.zap = !!o.zap; uloz(); }, zapnuto: function () { return st.zap; }, DOSAH: DOSAH };
})();
