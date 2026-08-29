// ===== AR Geodet — EPOCHY / MONITORING POSUNŮ (ODPOJITELNÁ vrstva) =============
// Sledování posunů bodů v čase (deformační monitoring): mosty, opěrné zdi, sesuvy,
// skládky… Ke sledovanému bodu se opakovaně zapisují souřadnice Y/X/Z (S-JTSK/Bpv)
// z TOTÁLNÍ STANICE nebo GNSS ROVERU — ručně, čtením OCR z fotky displeje/protokolu,
// převzetím z bodu v appce, nouzově i z GPS mobilu (orientační, přesnost v metrech).
// Appka počítá posuny proti 1. (referenční) epoše, hlídá mezní odchylky (mm),
// kreslí vývoj v čase + směrník posunu a umí export CSV.
//
// PROPOJENÍ S VLASTNÍMI BODY: sledovaný bod jde založit z existujícího vlastního
// bodu, nový se po uložení 1. epochy sám přidá do vlastních bodů (addImportedPoints);
// poloha propojeného bodu se pak drží na POSLEDNÍ epoše (mapa/AR ukazují aktuální stav).
//
// Data: per zakázka přes setStoredData/getStoredData (klíč 'agEpochy_v1').
// OCR: znovupoužívá parseOcrCoords/ensureTesseract/_prepForOcr z logika.js.
// Odstranění: smaž js/epochy.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'
        + '<path d="M19.5 4.5l1.8 1.8M21.3 4.5l-1.8 1.8" opacity="0.9"/></svg>';

    var KEY = 'agEpochy_v1';
    var MODAL_ID = 'ag-ep-modal';
    var S = { items: [] };          // {id,name,note,limP,limZ,epochs:[{t,y,x,z,src,note}]}
    var _view = { mode: 'list', itemId: null };
    var _ocrBusy = false;
    var _prefill = null;            // {y,x,z} pro předvyplnění formuláře epochy po renderu

    // ---- util -------------------------------------------------------------------
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'epochy:toast'); } }
    function agAlertX(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'epochy:agAlertX'); } agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); }
    function agConfirmX(t, m) {
        try { if (typeof window.agConfirm === 'function') return window.agConfirm({ title: t, message: m, danger: true }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'epochy:agConfirmX'); }
        return Promise.resolve(confirm(t + (m ? '\n' + m : '')));
    }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.').trim()); return isFinite(n) ? n : null; }
    function fmtDate(t) { try { var d = new Date(t); return d.toLocaleDateString('cs-CZ') + ' ' + d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
    // datum a čas pod sebou (úzký sloupec — ať tabulka nepřetéká)
    function fmtDate2r(t) { try { var d = new Date(t); return esc(d.toLocaleDateString('cs-CZ')) + '<br><span class="ag-ep-mini">' + esc(d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })) + '</span>'; } catch (e) { return ''; } }
    function fmtMM(m) { if (m == null || !isFinite(m)) return '—'; var mm = m * 1000; var v = Math.abs(mm) >= 100 ? mm.toFixed(0) : mm.toFixed(1); return (mm > 0 ? '+' : '') + v; }
    function nowLocalISO(t) { var d = t ? new Date(t) : new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

    // ---- data -------------------------------------------------------------------
    function load() {
        S = { items: [] };
        try {
            var raw = (typeof getStoredData === 'function') ? getStoredData(KEY) : null;
            var p = raw ? JSON.parse(raw) : null;
            if (p && Array.isArray(p.items)) S = p;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'epochy:load'); }
    }
    function save() { try { if (typeof setStoredData === 'function') setStoredData(KEY, JSON.stringify(S)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'epochy:save'); } }
    function itemById(id) { for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i]; return null; }
    function sortEpochs(it) { it.epochs.sort(function (a, b) { return a.t - b.t; }); }

    // posuny proti 1. (referenční) epoše
    function deltas(it) {
        var out = [];
        if (!it.epochs.length) return out;
        var r = it.epochs[0];
        for (var i = 0; i < it.epochs.length; i++) {
            var e = it.epochs[i];
            var dY = e.y - r.y, dX = e.x - r.x;
            var dZ = (e.z != null && r.z != null) ? e.z - r.z : null;
            out.push({ dY: dY, dX: dX, dZ: dZ, dP: Math.sqrt(dY * dY + dX * dX) });
        }
        return out;
    }
    // směrník posunu v S-JTSK (od osy +X, kladně k +Y) — klasická geodetická konvence
    function smernik(dY, dX) {
        var s = Math.atan2(dY, dX) * 180 / Math.PI;
        if (s < 0) s += 360;
        return s;
    }
    function statusOf(it) {
        // vyhodnocení POSLEDNÍ epochy proti mezím (mm); bez mezí / < 2 epoch => null
        if (it.epochs.length < 2) return null;
        var d = deltas(it), last = d[d.length - 1];
        var overP = (it.limP > 0 && last.dP * 1000 > it.limP);
        var overZ = (it.limZ > 0 && last.dZ != null && Math.abs(last.dZ) * 1000 > it.limZ);
        if (!(it.limP > 0) && !(it.limZ > 0)) return null;
        return { over: (overP || overZ), overP: overP, overZ: overZ, last: last };
    }

    // ---- graf (SVG) ---------------------------------------------------------------
    function chartSVG(it) {
        var d = deltas(it);
        if (d.length < 2) return '<div class="ag-ep-note">Zatím jen referenční epocha — posuny se ukážou od 2. epochy.</div>';
        var W = 340, H = 150, padL = 38, padR = 10, padT = 12, padB = 22;
        var iw = W - padL - padR, ih = H - padT - padB;
        var maxAbs = 1; // mm
        d.forEach(function (e) {
            maxAbs = Math.max(maxAbs, Math.abs(e.dP * 1000), e.dZ != null ? Math.abs(e.dZ * 1000) : 0);
        });
        if (it.limP > 0) maxAbs = Math.max(maxAbs, it.limP);
        if (it.limZ > 0) maxAbs = Math.max(maxAbs, it.limZ);
        maxAbs *= 1.15;
        function xAt(i) { return padL + (d.length === 1 ? 0 : iw * i / (d.length - 1)); }
        function yAt(mm) { return padT + ih / 2 - (mm / maxAbs) * (ih / 2); }
        function line(vals, col) {
            var pts = [], dots = '';
            for (var i = 0; i < vals.length; i++) {
                if (vals[i] == null) continue;
                var x = xAt(i), y = yAt(vals[i]);
                pts.push(x.toFixed(1) + ',' + y.toFixed(1));
                dots += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.6" fill="' + col + '"/>';
            }
            return '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + col + '" stroke-width="2"/>' + dots;
        }
        var pVals = d.map(function (e) { return e.dP * 1000; });
        var zVals = d.map(function (e) { return e.dZ != null ? e.dZ * 1000 : null; });
        var hasZ = zVals.some(function (v) { return v != null; });
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;">';
        s += '<line x1="' + padL + '" y1="' + yAt(0) + '" x2="' + (W - padR) + '" y2="' + yAt(0) + '" stroke="rgba(148,163,184,0.45)" stroke-width="1"/>';
        // mezní čáry
        if (it.limP > 0) s += '<line x1="' + padL + '" y1="' + yAt(it.limP) + '" x2="' + (W - padR) + '" y2="' + yAt(it.limP) + '" stroke="#f87171" stroke-width="1" stroke-dasharray="4 4"/>';
        if (it.limZ > 0 && hasZ) {
            s += '<line x1="' + padL + '" y1="' + yAt(it.limZ) + '" x2="' + (W - padR) + '" y2="' + yAt(it.limZ) + '" stroke="#fb923c" stroke-width="1" stroke-dasharray="2 4"/>'
               + '<line x1="' + padL + '" y1="' + yAt(-it.limZ) + '" x2="' + (W - padR) + '" y2="' + yAt(-it.limZ) + '" stroke="#fb923c" stroke-width="1" stroke-dasharray="2 4"/>';
        }
        // osy / popisky
        s += '<text x="4" y="' + (yAt(maxAbs / 1.15) + 4) + '" font-size="9" fill="#94a3b8">' + Math.round(maxAbs / 1.15) + '</text>'
           + '<text x="4" y="' + (yAt(0) + 3) + '" font-size="9" fill="#94a3b8">0 mm</text>';
        s += line(pVals, '#4da3ff');
        if (hasZ) s += line(zVals, '#fb923c');
        s += '<text x="' + padL + '" y="' + (H - 8) + '" font-size="9" fill="#94a3b8">' + esc(new Date(it.epochs[0].t).toLocaleDateString('cs-CZ')) + '</text>'
           + '<text x="' + (W - padR) + '" y="' + (H - 8) + '" font-size="9" fill="#94a3b8" text-anchor="end">' + esc(new Date(it.epochs[it.epochs.length - 1].t).toLocaleDateString('cs-CZ')) + '</text>';
        s += '</svg>'
           + '<div class="ag-ep-legend"><span style="color:#4da3ff;">■</span> vodorovný posun ΔP'
           + (hasZ ? ' &nbsp;&nbsp;<span style="color:#fb923c;">■</span> výškový posun ΔZ' : '')
           + ((it.limP > 0 || it.limZ > 0) ? ' &nbsp;&nbsp;<span style="color:#f87171;">- - -</span> mez' : '') + '</div>';
        return s;
    }

    // ---- render -------------------------------------------------------------------
    function isOpen() { var m = document.getElementById(MODAL_ID); return !!(m && m.style.display !== 'none'); }
    function render() {
        var body = document.getElementById('ag-ep-body');
        if (!body) return;
        body.innerHTML = (_view.mode === 'detail' && itemById(_view.itemId)) ? renderDetail(itemById(_view.itemId)) : renderList();
        bind(body);
        if (_prefill && _view.mode === 'detail') {
            var yEl = document.getElementById('ag-ep-y'), xEl = document.getElementById('ag-ep-x'), zEl = document.getElementById('ag-ep-z');
            if (yEl) yEl.value = _prefill.y;
            if (xEl) xEl.value = _prefill.x;
            if (zEl && _prefill.z) zEl.value = _prefill.z;
            _prefill = null;
        }
    }

    function renderList() {
        var h = '<div class="ag-ep-head"><h3 style="color:var(--accent);margin:0;display:flex;align-items:center;gap:8px;">' + ICON + ' Epochy / monitoring</h3>'
            + '<button class="btn btn-secondary ag-ep-sm" data-act="close">Zavřít</button></div>'
            + '<p class="ag-ep-note">Sledování posunů bodů v čase (mosty, zdi, sesuvy, skládky…). Souřadnice epoch zapisuj z <b>totální stanice nebo GNSS roveru</b> — ručně, OCR z fotky, nebo převzetím z bodu. Posuny se počítají proti 1. epoše.</p>';
        if (!S.items.length) h += '<div class="ag-ep-note" style="text-align:center;padding:14px 0;">Zatím žádný sledovaný bod.</div>';
        for (var i = 0; i < S.items.length; i++) {
            var it = S.items[i], st = statusOf(it);
            var badge = '';
            if (st) badge = st.over ? '<span class="ag-ep-badge ag-ep-bad">PŘEKROČENO</span>' : '<span class="ag-ep-badge ag-ep-ok">OK</span>';
            var d = deltas(it), lastTxt = '';
            if (it.epochs.length >= 2) {
                var last = d[d.length - 1];
                lastTxt = 'ΔP ' + fmtMM(last.dP) + ' mm' + (last.dZ != null ? ' · ΔZ ' + fmtMM(last.dZ) + ' mm' : '');
            } else if (it.epochs.length === 1) lastTxt = 'jen referenční epocha';
            else lastTxt = 'bez epoch';
            h += '<button class="ag-ep-item" data-act="open-item" data-id="' + esc(it.id) + '">'
                + '<span class="ag-ep-item-name">' + esc(it.name) + '</span>' + badge
                + '<span class="ag-ep-item-sub">' + it.epochs.length + '× epocha'
                + (it.epochs.length ? ' · ' + esc(fmtDate(it.epochs[it.epochs.length - 1].t)) : '') + '<br>' + esc(lastTxt) + '</span></button>';
        }
        h += '<div class="ag-ep-form"><label class="ag-ep-fld"><span>Nový sledovaný bod (název)</span>'
            + '<input type="text" id="ag-ep-new-name" placeholder="např. 501 — římsa mostu"></label>'
            + '<button class="btn" data-act="add-item">Založit sledovaný bod</button>'
            + '<label class="ag-ep-fld" style="margin-top:10px;"><span>…nebo sledovat existující vlastní bod</span>'
            + '<select id="ag-ep-from-pt"><option value="">— vyberte vlastní bod —</option>' + customPointOptions() + '</select></label>'
            + '<div class="ag-ep-mini">Nový sledovaný bod se po uložení 1. epochy přidá i do vlastních bodů; poloha propojeného bodu se pak drží na poslední epoše.</div></div>';
        return h;
    }

    function renderDetail(it) {
        var st = statusOf(it), d = deltas(it);
        var h = '<div class="ag-ep-head"><button class="btn btn-secondary ag-ep-sm" data-act="back">‹ Zpět</button>'
            + '<h3 style="color:var(--accent);margin:0;flex:1;text-align:center;font-size:calc(16px * var(--ag-font-scale, 1));">' + esc(it.name) + '</h3>'
            + '<button class="btn btn-danger ag-ep-sm" data-act="del-item">Smazat</button></div>';

        // propojení s vlastním bodem
        h += '<div class="ag-ep-mini" style="margin:0 0 6px;">'
            + (it.ptId ? '● Propojeno s vlastním bodem — jeho poloha v mapě/AR se drží na poslední epoše.'
                       : '○ Po uložení 1. epochy se bod přidá i do vlastních bodů.')
            + '</div>';

        // stav
        if (it.epochs.length >= 2) {
            var last = d[d.length - 1];
            var dirTxt = '';
            if (last.dP >= 0.001) {
                var sm = smernik(last.dY, last.dX);
                dirTxt = ' · směrník ' + sm.toFixed(1) + '° (' + (sm * 10 / 9).toFixed(1) + ' gon)';
            }
            h += '<div class="ag-ep-status' + (st && st.over ? ' ag-ep-status-bad' : '') + '">'
                + 'Poslední epocha vs. referenční: <b>ΔP ' + fmtMM(last.dP) + ' mm</b>'
                + (last.dZ != null ? ' · <b>ΔZ ' + fmtMM(last.dZ) + ' mm</b>' : '') + esc(dirTxt)
                + (st ? (st.over ? '<br><b>⚠ Mezní odchylka překročena' + (st.overP ? ' (poloha)' : '') + (st.overZ ? ' (výška)' : '') + '</b>' : '<br>V mezích.') : '')
                + '</div>';
        }

        // meze
        h += '<div class="ag-ep-row"><label class="ag-ep-fld"><span>Mez ΔP (mm)</span><input type="text" id="ag-ep-limp" inputmode="decimal" min="0" step="1" value="' + (it.limP > 0 ? esc(it.limP) : '') + '" placeholder="—"></label>'
            + '<label class="ag-ep-fld"><span>Mez ΔZ (mm)</span><input type="text" id="ag-ep-limz" inputmode="decimal" min="0" step="1" value="' + (it.limZ > 0 ? esc(it.limZ) : '') + '" placeholder="—"></label></div>';

        // graf
        h += '<div class="ag-ep-chart">' + chartSVG(it) + '</div>';

        // tabulka epoch
        if (it.epochs.length) {
            h += '<div class="ag-ep-tblwrap"><table class="ag-ep-tbl"><thead><tr><th>Datum</th><th>Y</th><th>X</th><th>Z</th><th>ΔP mm</th><th>ΔZ mm</th><th></th></tr></thead><tbody>';
            for (var i = 0; i < it.epochs.length; i++) {
                var e = it.epochs[i];
                h += '<tr' + (i === 0 ? ' class="ag-ep-ref"' : '') + '><td>' + fmtDate2r(e.t) + (i === 0 ? '<br><span class="ag-ep-mini">reference</span>' : '') + (e.src ? '<br><span class="ag-ep-mini">' + esc(e.src) + '</span>' : '') + '</td>'
                    + '<td>' + e.y.toFixed(2) + '</td><td>' + e.x.toFixed(2) + '</td><td>' + (e.z != null ? e.z.toFixed(2) : '—') + '</td>'
                    + '<td>' + (i === 0 ? '—' : fmtMM(d[i].dP)) + '</td><td>' + (i === 0 || d[i].dZ == null ? '—' : fmtMM(d[i].dZ)) + '</td>'
                    + '<td><button class="ag-ep-x" data-act="del-epoch" data-i="' + i + '" title="Smazat epochu">✕</button></td></tr>';
                if (e.note) h += '<tr' + (i === 0 ? ' class="ag-ep-ref"' : '') + '><td colspan="7" class="ag-ep-mini" style="padding-top:0;">' + esc(e.note) + '</td></tr>';
            }
            h += '</tbody></table></div>';
        }

        // nová epocha
        h += '<div class="ag-ep-form"><b style="font-size:calc(13px * var(--ag-font-scale, 1));">Přidat epochu</b>'
            + '<div class="ag-ep-row"><label class="ag-ep-fld"><span>Y (m, S-JTSK)</span><input type="text" id="ag-ep-y" inputmode="decimal" placeholder="např. 596956.46"></label>'
            + '<label class="ag-ep-fld"><span>X (m, S-JTSK)</span><input type="text" id="ag-ep-x" inputmode="decimal" placeholder="např. 1159621.33"></label></div>'
            + '<div class="ag-ep-row"><label class="ag-ep-fld"><span>Z (m, Bpv) — volitelné</span><input type="text" id="ag-ep-z" inputmode="decimal" placeholder="—"></label>'
            + '<label class="ag-ep-fld"><span>Datum a čas</span><input type="datetime-local" id="ag-ep-t" value="' + nowLocalISO() + '"></label></div>'
            + '<div class="ag-ep-row"><label class="ag-ep-fld"><span>Zdroj</span><select id="ag-ep-src">'
            + '<option value="totální stanice">totální stanice</option><option value="GNSS rover">GNSS rover</option>'
            + '<option value="mobil (orientační)">mobil (orientační)</option><option value="jiné">jiné</option></select></label>'
            + '<label class="ag-ep-fld"><span>Poznámka</span><input type="text" id="ag-ep-note" placeholder="—"></label></div>'
            + '<button class="btn" data-act="add-epoch">Uložit epochu</button>'
            + '<div class="ag-ep-helpers">'
            + '<label class="btn btn-secondary ag-ep-sm" style="margin:0;"><svg class="icon" style="width:15px;height:15px;margin-right:5px;"><use href="#i-camera"/></svg>OCR z fotky<input type="file" id="ag-ep-ocr" accept="image/*" style="display:none;"></label>'
            + '<button class="btn btn-secondary ag-ep-sm" data-act="gps">GPS mobilu</button>'
            + '</div>'
            + '<label class="ag-ep-fld" style="margin-top:8px;"><span>…nebo převzít souřadnice z bodu v appce</span><select id="ag-ep-pt"><option value="">— vyberte bod —</option>' + pointOptions() + '</select></label>'
            + '<div class="ag-ep-mini" style="margin-top:2px;">OCR / GPS / bod jen předvyplní pole — před uložením zkontroluj.</div>'
            + '</div>';

        h += '<button class="btn btn-secondary" data-act="csv" style="margin-top:10px;">Export epoch (CSV)</button>';
        return h;
    }

    function pointOptions() {
        var out = '';
        try {
            if (typeof arPoints === 'undefined' || !Array.isArray(arPoints)) return '';
            var pts = arPoints.slice(0, 300);
            for (var i = 0; i < pts.length; i++) {
                var p = pts[i];
                if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
                out += '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.cat && p.cat !== 'CUSTOM' ? ' (' + esc(p.cat) + ')' : '') + '</option>';
            }
        } catch (e) {}
        return out;
    }
    // jen VLASTNÍ body (cp_…) — pro zakládání sledovaného bodu z existujícího
    function customPointOptions() {
        var out = '';
        try {
            if (typeof persistentCustomPoints === 'undefined' || !Array.isArray(persistentCustomPoints)) return '';
            var linked = {};
            S.items.forEach(function (it) { if (it.ptId) linked[it.ptId] = true; });
            var pts = persistentCustomPoints.slice(0, 300);
            for (var i = 0; i < pts.length; i++) {
                var p = pts[i];
                if (!isFinite(p.lat) || !isFinite(p.lng) || linked[p.id]) continue;
                out += '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
            }
        } catch (e) {}
        return out;
    }

    // ---- propojení s vlastními body -------------------------------------------------
    // nový sledovaný bod → po 1. epoše se založí i jako vlastní bod (dedup řeší addImportedPoints)
    function ensureLinkedPoint(it) {
        if (it.ptId || !it.epochs.length) return;
        try {
            if (typeof window.addImportedPoints !== 'function' || !window.GeoCore || typeof persistentCustomPoints === 'undefined') return;
            var ref = it.epochs[it.epochs.length - 1];
            var ll = GeoCore.fromSJTSK(ref.y, ref.x);
            if (!ll || !isFinite(ll.lat)) return;
            var obj = { name: it.name, lat: ll.lat, lng: ll.lng };
            if (ref.z != null) obj.vyska = ref.z;
            window.addImportedPoints([obj]);
            // addImportedPoints vrací jen počet — id dohledáme (při dedupu se napojíme na existující bod)
            for (var i = persistentCustomPoints.length - 1; i >= 0; i--) {
                var p = persistentCustomPoints[i];
                if (p.name === it.name && Math.abs(p.lat - ll.lat) < 1e-4 && Math.abs(p.lng - ll.lng) < 1e-4) {
                    it.ptId = p.id; save();
                    toast('Bod „' + it.name + '" přidán do vlastních bodů.');
                    break;
                }
            }
        } catch (e) {}
    }
    // poloha propojeného bodu = POSLEDNÍ epocha (mapa/AR ukazují aktuální stav)
    function updateLinkedPoint(it) {
        if (!it.ptId || !it.epochs.length) return;
        try {
            if (typeof persistentCustomPoints === 'undefined' || !window.GeoCore) return;
            var last = it.epochs[it.epochs.length - 1];
            var ll = GeoCore.fromSJTSK(last.y, last.x);
            if (!ll || !isFinite(ll.lat)) return;
            var found = false;
            for (var i = 0; i < persistentCustomPoints.length; i++) {
                var p = persistentCustomPoints[i];
                if (p.id === it.ptId) { p.lat = ll.lat; p.lng = ll.lng; if (last.z != null) p.vyska = Math.round(last.z * 100) / 100; found = true; break; }
            }
            if (!found) { it.ptId = null; save(); return; }   // bod mezitím smazán → odpojit
            try {
                for (var j = 0; j < arPoints.length; j++) {
                    if (arPoints[j].id === it.ptId) { arPoints[j].lat = ll.lat; arPoints[j].lng = ll.lng; if (last.z != null) arPoints[j].vyska = Math.round(last.z * 100) / 100; break; }
                }
            } catch (e2) {}
            if (typeof setStoredData === 'function') setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints));
            try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e3) {}
            try { if (typeof renderManageList === 'function') renderManageList(); } catch (e4) {}
        } catch (e) {}
    }
    // založení sledovaného bodu z existujícího vlastního bodu (+ předvyplnění 1. epochy)
    function createItemFromPoint(pid) {
        if (!pid) return;
        try {
            var p = null;
            for (var i = 0; i < persistentCustomPoints.length; i++) if (persistentCustomPoints[i].id === pid) { p = persistentCustomPoints[i]; break; }
            if (!p) return;
            var id = 'ep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            S.items.push({ id: id, name: p.name, limP: 0, limZ: 0, epochs: [], ptId: p.id });
            save();
            if (window.GeoCore && GeoCore.toSJTSK) {
                var s = GeoCore.toSJTSK(p.lat, p.lng);
                _prefill = { y: s.y.toFixed(2), x: s.x.toFixed(2), z: (p.vyska != null ? Number(p.vyska).toFixed(2) : '') };
            }
            _view = { mode: 'detail', itemId: id };
            render();
            toast('Souřadnice bodu jsou předvyplněné — zkontroluj a ulož jako referenční epochu.');
        } catch (e) {}
    }

    // ---- akce -------------------------------------------------------------------
    function bind(body) {
        Array.prototype.forEach.call(body.querySelectorAll('[data-act]'), function (el) {
            el.addEventListener('click', function () { onAct(el.getAttribute('data-act'), el); });
        });
        var limp = body.querySelector('#ag-ep-limp'), limz = body.querySelector('#ag-ep-limz');
        var it = itemById(_view.itemId);
        if (limp && it) limp.addEventListener('change', function () { it.limP = num(limp.value) || 0; save(); render(); });
        if (limz && it) limz.addEventListener('change', function () { it.limZ = num(limz.value) || 0; save(); render(); });
        var ocr = body.querySelector('#ag-ep-ocr');
        if (ocr) ocr.addEventListener('change', function () { if (ocr.files && ocr.files[0]) runOcr(ocr.files[0]); ocr.value = ''; });
        var sel = body.querySelector('#ag-ep-pt');
        if (sel) sel.addEventListener('change', function () { fillFromPoint(sel.value); });
        var fromPt = body.querySelector('#ag-ep-from-pt');
        if (fromPt) fromPt.addEventListener('change', function () { createItemFromPoint(fromPt.value); });
    }

    function onAct(act, el) {
        var it = itemById(_view.itemId);
        if (act === 'close') return closeModal();
        if (act === 'back') { _view = { mode: 'list', itemId: null }; return render(); }
        if (act === 'open-item') { _view = { mode: 'detail', itemId: el.getAttribute('data-id') }; return render(); }
        if (act === 'add-item') {
            var inp = document.getElementById('ag-ep-new-name');
            var name = (inp && inp.value || '').trim();
            if (!name) return toast('Zadej název sledovaného bodu.');
            var id = 'ep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            S.items.push({ id: id, name: name, limP: 0, limZ: 0, epochs: [] });
            save();
            _view = { mode: 'detail', itemId: id };
            return render();
        }
        if (!it) return;
        if (act === 'del-item') {
            agConfirmX('Smazat sledovaný bod?', '„' + it.name + '" včetně ' + it.epochs.length + ' epoch. Nelze vrátit.').then(function (ok) {
                if (!ok) return;
                S.items = S.items.filter(function (x) { return x.id !== it.id; });
                save(); _view = { mode: 'list', itemId: null }; render();
            });
            return;
        }
        if (act === 'del-epoch') {
            var i = parseInt(el.getAttribute('data-i'), 10);
            agConfirmX('Smazat epochu?', fmtDate(it.epochs[i] && it.epochs[i].t) + (i === 0 ? ' — je to REFERENČNÍ epocha, referencí se stane další v pořadí.' : '')).then(function (ok) {
                if (!ok) return;
                it.epochs.splice(i, 1); save();
                updateLinkedPoint(it);
                render();
            });
            return;
        }
        if (act === 'add-epoch') return addEpoch(it);
        if (act === 'gps') return gpsFill();
        if (act === 'csv') return exportCSV(it);
    }

    function addEpoch(it) {
        var y = num((document.getElementById('ag-ep-y') || {}).value);
        var x = num((document.getElementById('ag-ep-x') || {}).value);
        var z = num((document.getElementById('ag-ep-z') || {}).value);
        var tEl = document.getElementById('ag-ep-t');
        var t = tEl && tEl.value ? new Date(tEl.value).getTime() : Date.now();
        if (!isFinite(t)) t = Date.now();
        if (y == null || x == null) return toast('Zadej souřadnice Y a X.');
        // prohozené Y/X je nejčastější přehmat — u českých S-JTSK souřadnic platí Y < X
        try {
            if (window.GeoCore && GeoCore.looksLikeSJTSK && !GeoCore.looksLikeSJTSK(y, x) && GeoCore.looksLikeSJTSK(x, y)) {
                var tmp = y; y = x; x = tmp;
                toast('Y a X vypadaly prohozeně — opraveno (Y < X).');
            }
        } catch (e) {}
        it.epochs.push({
            t: t, y: y, x: x, z: z,
            src: (document.getElementById('ag-ep-src') || {}).value || '',
            note: ((document.getElementById('ag-ep-note') || {}).value || '').trim()
        });
        sortEpochs(it);
        save();
        ensureLinkedPoint(it);      // 1. epocha → bod se přidá i do vlastních bodů
        updateLinkedPoint(it);      // propojený bod drží polohu poslední epochy
        render();
        toast('Epocha uložena (' + it.epochs.length + ' celkem).');
    }

    function fillFromPoint(id) {
        if (!id) return;
        try {
            var p = null;
            for (var i = 0; i < arPoints.length; i++) if (arPoints[i].id === id) { p = arPoints[i]; break; }
            if (!p || !window.GeoCore || !GeoCore.toSJTSK) return;
            var s = GeoCore.toSJTSK(p.lat, p.lng);
            document.getElementById('ag-ep-y').value = s.y.toFixed(2);
            document.getElementById('ag-ep-x').value = s.x.toFixed(2);
            if (p.vyska != null) document.getElementById('ag-ep-z').value = Number(p.vyska).toFixed(2);
            toast('Souřadnice převzaty z bodu „' + p.name + '" — zkontroluj a ulož.');
        } catch (e) {}
    }

    function gpsFill() {
        if (!navigator.geolocation) return toast('GPS není v tomto prohlížeči dostupná.');
        toast('Získávám polohu z mobilu…');
        navigator.geolocation.getCurrentPosition(function (pos) {
            try {
                var c = pos.coords;
                if (!window.GeoCore || !GeoCore.toSJTSK) return toast('Převod do S-JTSK není dostupný.');
                var s = GeoCore.toSJTSK(c.latitude, c.longitude);
                var yEl = document.getElementById('ag-ep-y'); if (!yEl) return;
                yEl.value = s.y.toFixed(2);
                document.getElementById('ag-ep-x').value = s.x.toFixed(2);
                if (c.altitude != null && isFinite(c.altitude)) {
                    var und = 0; try { und = GeoCore.geoidUndulation(c.latitude, c.longitude) || 0; } catch (e2) {}
                    document.getElementById('ag-ep-z').value = (c.altitude - und).toFixed(2);
                }
                var srcEl = document.getElementById('ag-ep-src'); if (srcEl) srcEl.value = 'mobil (orientační)';
                var acc = (c.accuracy != null && isFinite(c.accuracy)) ? Math.round(c.accuracy) : null;
                var nEl = document.getElementById('ag-ep-note');
                if (nEl && !nEl.value && acc != null) nEl.value = '±' + acc + ' m (mobil)';
                agAlertX('Orientační poloha', 'Mobil má přesnost ' + (acc != null ? '±' + acc + ' m' : 'v metrech') + ' — pro skutečný monitoring použij totálku/rover. Pole jsou předvyplněná, zkontroluj a ulož.');
            } catch (e) { toast('Polohu se nepodařilo zpracovat.'); }
        }, function () { toast('Polohu se nepodařilo získat.'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    }

    // ---- OCR (znovupoužití enginu z logika.js) ------------------------------------
    function runOcr(file) {
        if (_ocrBusy) return;
        if (typeof ensureTesseract !== 'function' || typeof parseOcrCoords !== 'function' || typeof _loadImageFromFile !== 'function' || typeof _prepForOcr !== 'function') {
            return toast('OCR není v této verzi appky dostupné.');
        }
        _ocrBusy = true;
        toast('Čtu souřadnice z fotky…');
        var worker = null;
        ensureTesseract()
            .then(function () { return _loadImageFromFile(file); })
            .then(function (img) {
                return Tesseract.createWorker('eng', 1).then(function (w) {
                    worker = w;
                    return worker.setParameters({ tessedit_char_whitelist: '0123456789.,;:=-/YXZyxz ', preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' })
                        .then(function () { return worker.recognize(_prepForOcr(img, 2000, false)); })
                        .then(function (res1) {
                            var best = parseOcrCoords((res1 && res1.data && res1.data.text) || '');
                            if (best.y != null && best.x != null) return best;
                            return worker.recognize(_prepForOcr(img, 2000, true)).then(function (res2) {
                                var alt = parseOcrCoords((res2 && res2.data && res2.data.text) || '');
                                return (alt.y != null && alt.x != null) ? alt : best;
                            });
                        });
                });
            })
            .then(function (r) {
                _ocrBusy = false;
                try { if (worker) worker.terminate(); } catch (e) {}
                if (!r || (r.y == null && r.x == null && r.z == null)) return toast('Souřadnice se z fotky přečíst nepodařilo — zkus ostřejší záběr, nebo zapiš ručně.');
                var yEl = document.getElementById('ag-ep-y'), xEl = document.getElementById('ag-ep-x'), zEl = document.getElementById('ag-ep-z');
                if (yEl && r.y != null) yEl.value = r.y;
                if (xEl && r.x != null) xEl.value = r.x;
                if (zEl && r.z != null) zEl.value = r.z;
                toast('Přečteno' + (r.y != null && r.x != null ? ' Y+X' : '') + (r.z != null ? ' +Z' : '') + ' — zkontroluj a ulož.');
            })
            .catch(function () {
                _ocrBusy = false;
                try { if (worker) worker.terminate(); } catch (e) {}
                toast('OCR selhalo — zapiš souřadnice ručně.');
            });
    }

    // ---- export CSV -----------------------------------------------------------------
    function exportCSV(it) {
        var d = deltas(it);
        var rows = ['bod;datum;Y;X;Z;dY_mm;dX_mm;dZ_mm;dP_mm;zdroj;poznamka'];
        for (var i = 0; i < it.epochs.length; i++) {
            var e = it.epochs[i];
            rows.push([it.name, fmtDate(e.t), e.y.toFixed(2), e.x.toFixed(2), e.z != null ? e.z.toFixed(2) : '',
                i === 0 ? '' : (d[i].dY * 1000).toFixed(1), i === 0 ? '' : (d[i].dX * 1000).toFixed(1),
                (i === 0 || d[i].dZ == null) ? '' : (d[i].dZ * 1000).toFixed(1),
                i === 0 ? '' : (d[i].dP * 1000).toFixed(1), e.src || '', (e.note || '').replace(/;/g, ',')
            ].join(';'));
        }
        try {
            var blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'epochy_' + it.name.replace(/[^\wěščřžýáíéúůťďňó-]+/gi, '_') + '.csv';
            document.body.appendChild(a); a.click();
            setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 2000);
            toast('CSV vyexportováno.');
        } catch (e) { toast('Export se nepovedl.'); }
    }

    // ---- modal + styly ---------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('ag-ep-style')) return;
        var st = document.createElement('style'); st.id = 'ag-ep-style';
        st.textContent = [
            '#' + MODAL_ID + ' .ag-ep-head{display:flex;align-items:center;gap:8px;justify-content:space-between;margin-bottom:8px;}',
            '#' + MODAL_ID + ' .ag-ep-sm{width:auto;flex:0 0 auto;padding:7px 12px;font-size:calc(12.5px * var(--ag-font-scale, 1));margin:0;}',
            '#' + MODAL_ID + ' .ag-ep-note{font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.82;line-height:1.45;margin:4px 0 10px;}',
            '#' + MODAL_ID + ' .ag-ep-item{display:block;width:100%;text-align:left;margin:6px 0;padding:10px 12px;border-radius:12px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.04);color:var(--text-color,#e8edf2);}',
            '#' + MODAL_ID + ' .ag-ep-item-name{font:700 14px/1.2 var(--font-ui,system-ui),sans-serif;margin-right:6px;}',
            '#' + MODAL_ID + ' .ag-ep-item-sub{display:block;font-size:calc(11.5px * var(--ag-font-scale, 1));opacity:.75;margin-top:3px;line-height:1.4;}',
            '#' + MODAL_ID + ' .ag-ep-badge{font:700 10px/1 var(--font-ui,system-ui),sans-serif;padding:3px 7px;border-radius:8px;vertical-align:middle;}',
            '#' + MODAL_ID + ' .ag-ep-ok{background:rgba(47,158,116,0.18);color:#34d399;}',
            '#' + MODAL_ID + ' .ag-ep-bad{background:rgba(248,113,113,0.2);color:#f87171;}',
            '#' + MODAL_ID + ' .ag-ep-status{font-size:calc(13px * var(--ag-font-scale, 1));line-height:1.5;padding:9px 12px;border-radius:12px;margin:6px 0 10px;',
            '  background:rgba(47,158,116,0.1);border:1px solid rgba(47,158,116,0.3);}',
            '#' + MODAL_ID + ' .ag-ep-status-bad{background:rgba(248,113,113,0.12);border-color:rgba(248,113,113,0.4);}',
            '#' + MODAL_ID + ' .ag-ep-row{display:flex;gap:8px;flex-wrap:wrap;}',
            // flex-basis + min-width:0 — jinak datetime-local svou vnitřní šířkou přeteče z formuláře
            '#' + MODAL_ID + ' .ag-ep-fld{display:block;flex:1 1 140px;min-width:0;margin:7px 0 3px;}',
            '#' + MODAL_ID + ' .ag-ep-fld>span{display:block;font-size:calc(11.5px * var(--ag-font-scale, 1));opacity:.75;margin-bottom:3px;}',
            '#' + MODAL_ID + ' .ag-ep-fld input,#' + MODAL_ID + ' .ag-ep-fld select{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:10px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:rgba(255,255,255,0.05);color:var(--text-color,#e8edf2);font:600 15px/1.1 var(--font-ui,system-ui),sans-serif;}',
            '#' + MODAL_ID + ' .ag-ep-chart{margin:8px 0;padding:8px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid var(--glass-border,rgba(255,255,255,0.1));}',
            '#' + MODAL_ID + ' .ag-ep-legend{font-size:calc(11px * var(--ag-font-scale, 1));opacity:.8;margin-top:4px;text-align:center;}',
            '#' + MODAL_ID + ' .ag-ep-tblwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:8px 0;}',
            '#' + MODAL_ID + ' .ag-ep-tbl{border-collapse:collapse;font-size:calc(12px * var(--ag-font-scale, 1));min-width:100%;white-space:nowrap;}',
            '#' + MODAL_ID + ' .ag-ep-tbl th,#' + MODAL_ID + ' .ag-ep-tbl td{padding:5px 7px;text-align:right;border-bottom:1px solid rgba(148,163,184,0.15);}',
            '#' + MODAL_ID + ' .ag-ep-tbl th:first-child,#' + MODAL_ID + ' .ag-ep-tbl td:first-child{text-align:left;}',
            '#' + MODAL_ID + ' .ag-ep-ref td{background:rgba(77,163,255,0.07);}',
            '#' + MODAL_ID + ' .ag-ep-mini{font-size:calc(10.5px * var(--ag-font-scale, 1));opacity:.65;}',
            '#' + MODAL_ID + ' .ag-ep-x{border:none;background:none;color:#f87171;font-size:calc(14px * var(--ag-font-scale, 1));padding:2px 6px;}',
            '#' + MODAL_ID + ' .ag-ep-form{margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid var(--glass-border,rgba(255,255,255,0.1));}',
            '#' + MODAL_ID + ' .ag-ep-helpers{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;}',
            '#' + MODAL_ID + ' .ag-ep-helpers .btn{display:inline-flex;align-items:center;justify-content:center;cursor:pointer;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    function ensureModal() {
        if (document.getElementById(MODAL_ID)) return;
        injectStyles();
        var ov = document.createElement('div');
        ov.className = 'modal-overlay'; ov.id = MODAL_ID; ov.style.zIndex = '100001'; ov.style.display = 'none';
        ov.innerHTML = '<div class="modal-content"><div class="modal-body" id="ag-ep-body"></div></div>';
        document.body.appendChild(ov);
    }

    function openModal() {
        ensureModal();
        load();
        _view = { mode: 'list', itemId: null };
        render();
        document.getElementById(MODAL_ID).style.display = 'flex';
    }
    function closeModal() {
        var m = document.getElementById(MODAL_ID);
        if (m) m.style.display = 'none';
        try { if (typeof fixAppLayout === 'function') fixAppLayout(); } catch (e) {}
    }
    window.agOpenEpochy = openModal;
    window.agCloseEpochy = closeModal;

    // přepnutí zakázky → přenačíst data (klíč je prefixovaný ID zakázky)
    window.addEventListener('load', function () {
        try {
            var orig = window.loadProjectSettings;
            if (typeof orig === 'function' && !orig._agEpWrapped) {
                var wrapped = function () {
                    var r = orig.apply(this, arguments);
                    try { load(); if (isOpen()) { _view = { mode: 'list', itemId: null }; render(); } } catch (e) {}
                    return r;
                };
                wrapped._agEpWrapped = true;
                window.loadProjectSettings = wrapped;
            }
        } catch (e) {}
    });

    // ---- registrace do launcheru -------------------------------------------------
    function register() {
        if (typeof window.agRegisterFieldTool !== 'function') return;
        window.agRegisterFieldTool({ id: 'epochy', label: 'Epochy / monitoring', icon: ICON, onClick: openModal, order: 10 });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
