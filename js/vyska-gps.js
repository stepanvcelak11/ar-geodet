// ===== AR Geodet — VÝŠKA BODU: GPS × TERÉNNÍ MODEL (ODPOJITELNÁ vrstva) ========
// Svislá složka je na telefonu nejslabší: GPS výška je 1,5–3× horší než poloha, takže
// i po dlouhém průměrování je ±1,5 až ±4 m. Tenhle modul do dialogu „Vložit bod"
// (u bodu vyplněného z průměrované GPS) přidá DRUHÝ, nezávislý zdroj výšky —
// výškopis ČÚZK DMR 5G (±0,18 m v otevřeném terénu) — ukáže rozdíl a nechá výšku
// jedním klepnutím přepsat.
//
// PROČ NE BAROMETR (uživatel se ptal): telefony tlakové čidlo mají, ale prohlížeč ho
// NEZPŘÍSTUPŇUJE — Generic Sensor API zná akcelerometr, gyroskop, magnetometr i čidlo
// osvětlení, barometr v něm není a ani iOS ho webu nedává. Bez nativní obálky se k
// tlaku z webové appky nedostaneme. A i kdyby: barometr sám o sobě dává jen ZMĚNU
// výšky (±0,3 m za desítky minut), absolutní výška z něj vyjde jen proti známé
// referenci a tlak se během dne posune o metry (1 hPa ≈ 8 m). Terénní model dává to,
// co by od barometru člověk chtěl — nezávislou přesnou výšku — a offline z cache.
//
// KDY DMR NEBRAT (a modul to říká i v UI): DMR 5G je terén z leteckého laserového
// skenování 2009–2013. Kontroluješ-li ZA FINIŠEREM výšku nové vrstvy, násep, zásyp
// nebo cokoli, co od té doby vzniklo, DMR ukazuje starý terén, ne tvůj povrch —
// tam je správná odpověď „nechat GPS" (a doopravdy rover či nivelák).
//
// Neinvazivní: NEEDITUJE logika.js. Obaluje window.fillAveragedGPS (stejný vzor jako
// js/qc-engine.js) a píše do #custom-z, tedy do stejného pole, jaké appka ukládá.
//
// Odstranění: smaž js/vyska-gps.js + jeho řádek <script> v index.html a v sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGVyska) return;

    var BOX_ID = 'ag-vz';
    var DMR_SIGMA = 0.30;        // konzervativní střední chyba DMR 5G (v lese víc)
    var _busy = false, _lastKey = '';

    function f2(v) { return (Math.round(v * 100) / 100).toFixed(2).replace('.', ','); }
    function el(id) { return document.getElementById(id); }

    function styles() {
        if (el('agvz-style')) return;
        var st = document.createElement('style');
        st.id = 'agvz-style';
        st.textContent = [
            '#' + BOX_ID + '{margin-top:8px;padding:9px 11px;border-radius:11px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--surface-1,rgba(255,255,255,0.05));',
            '  font:400 12px/1.45 var(--font-ui,system-ui);}',
            '#' + BOX_ID + ' .agvz-r{display:flex;justify-content:space-between;gap:8px;padding:2px 0;}',
            '#' + BOX_ID + ' .agvz-r b{font-family:var(--font-mono,ui-monospace,monospace);color:var(--data,#e6bd76);white-space:nowrap;}',
            '#' + BOX_ID + ' .agvz-d{font-weight:600;}',
            '#' + BOX_ID + ' .agvz-btns{display:flex;gap:6px;margin-top:7px;}',
            '#' + BOX_ID + ' .agvz-btns button{flex:1;padding:8px 6px;border-radius:9px;cursor:pointer;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.4));background:var(--accent-soft,rgba(47,158,116,0.14));',
            '  color:var(--text-color,#eceef2);font:600 11.5px/1.15 var(--font-ui,system-ui);}',
            '#' + BOX_ID + ' .agvz-btns button.agvz-sec{border-color:var(--glass-border,rgba(255,255,255,0.14));background:transparent;}',
            '#' + BOX_ID + ' .agvz-n{color:var(--text-muted,#9aa1ac);font-size:11px;margin-top:6px;}',
            '#' + BOX_ID + ' .agvz-warn{color:var(--warning,#fbbf24);}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // hostitel = poznámka pod souřadnicemi v dialogu „Vložit bod"
    function ensureBox() {
        var note = el('custom-acc-note');
        if (!note) return null;
        var box = el(BOX_ID);
        if (!box) {
            styles();
            box = document.createElement('div');
            box.id = BOX_ID;
            note.parentNode.insertBefore(box, note.nextSibling);
        }
        return box;
    }

    function avg() {
        try { return (typeof gpsAvgResult !== 'undefined') ? gpsAvgResult : null; } catch (e) { return null; }
    }
    function bpvFromGps(r) {
        if (!r || r.alt == null || !isFinite(r.alt)) return null;
        try { return r.alt - getGeoidUndulation(r.lat, r.lng); } catch (e) { return null; }
    }

    function render(gpsZ, gpsSig, dmr, state) {
        var box = ensureBox(); if (!box) return;
        var h = '';
        h += '<div class="agvz-r"><span>Výška z GPS (Bpv)</span><b>' + (gpsZ == null ? '—' : (f2(gpsZ) + ' m'))
            + (gpsSig != null ? ' <span style="opacity:.7">±' + f2(gpsSig) + '</span>' : '') + '</b></div>';
        h += '<div class="agvz-r"><span>Výška terénu DMR 5G</span><b>'
            + (state === 'wait' ? 'zjišťuji…' : (dmr == null ? '—' : (f2(dmr) + ' m <span style="opacity:.7">±' + f2(DMR_SIGMA) + '</span>'))) + '</b></div>';
        if (gpsZ != null && dmr != null) {
            var d = gpsZ - dmr;
            var big = Math.abs(d) > Math.max(2.5, 2 * (gpsSig || 2));
            h += '<div class="agvz-r agvz-d"><span>Rozdíl GPS − terén</span><b class="' + (big ? 'agvz-warn' : '') + '">'
                + (d >= 0 ? '+' : '−') + f2(Math.abs(d)) + ' m</b></div>';
            h += '<div class="agvz-btns">'
                + '<button type="button" id="agvz-use">Vzít výšku z DMR (' + f2(dmr) + ')</button>'
                + '<button type="button" class="agvz-sec" id="agvz-keep">Nechat GPS</button>'
                + '</div>';
            h += '<div class="agvz-n">DMR 5G je <b>terén z leteckého skenu 2009–2013</b>, ne dnešní povrch. '
                + 'Na hotové pláni a v otevřeném terénu je o řád přesnější než GPS z mobilu; '
                + '<b class="agvz-warn">za finišerem, na náspu, mostě nebo zásypu ho neber</b> — tam měří starý terén.'
                + (big ? ' Rozdíl je velký: buď stojíš na něčem novém, nebo je výška z GPS mimo.' : '') + '</div>';
        } else if (state === 'off') {
            h += '<div class="agvz-n">Výšku terénu se nepodařilo zjistit (bez internetu a mimo uloženou oblast). '
                + 'Zůstává výška z GPS. Tip: stažením okolí pro offline se výškopis uloží i pro tenhle bod.</div>';
        }
        box.innerHTML = h;
        var u = el('agvz-use');
        if (u) u.addEventListener('click', function () {
            var z = el('custom-z'); if (z && dmr != null) z.value = f2(dmr).replace(',', '.');
            box.querySelector('.agvz-btns').outerHTML = '<div class="agvz-n">✓ Výška přepsána hodnotou z DMR 5G ('
                + f2(dmr) + ' m). Můžeš ji ještě ručně upravit.</div>';
            try { if (typeof quickToast === 'function') quickToast('Výška z DMR 5G: ' + f2(dmr) + ' m'); } catch (e) {}
        });
        var k = el('agvz-keep');
        if (k) k.addEventListener('click', function () {
            box.querySelector('.agvz-btns').outerHTML = '<div class="agvz-n">✓ Zůstává výška z GPS.</div>';
        });
    }

    // po vyplnění bodu z průměrované GPS: dopočítej terén a nabídni
    function afterFill() {
        var r = avg();
        var gpsZ = bpvFromGps(r);
        if (!r || r.coarse) { var b = el(BOX_ID); if (b) b.innerHTML = ''; return; }
        var key = (r.lat || 0).toFixed(6) + ',' + (r.lng || 0).toFixed(6);
        render(gpsZ, r.altSterr, null, 'wait');
        if (_busy && _lastKey === key) return;
        _busy = true; _lastKey = key;
        var p = (typeof window.terrainElevAsync === 'function')
            ? window.terrainElevAsync(r.lat, r.lng)
            : Promise.resolve(null);
        p.then(function (v) {
            _busy = false;
            render(gpsZ, r.altSterr, (v != null && isFinite(v)) ? v : null, (v == null) ? 'off' : 'ok');
        })['catch'](function () { _busy = false; render(gpsZ, r.altSterr, null, 'off'); });
    }

    // ---- obalení window funkce (vzor js/qc-engine.js) ---------------------------
    function wrapAfter(name, after) {
        if (typeof window[name] !== 'function' || window[name]._vzWrapped) return false;
        var orig = window[name];
        var wrapped = function () { var out = orig.apply(this, arguments); try { after(); } catch (e) {} return out; };
        wrapped._vzWrapped = true; wrapped._vzOrig = orig;
        try { Object.defineProperty(wrapped, 'name', { value: name }); } catch (e) {}
        window[name] = wrapped;
        return true;
    }
    function install() { wrapAfter('fillAveragedGPS', afterFill); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
    window.addEventListener('load', function () { setTimeout(install, 450); });

    window.AGVyska = {
        DMR_SIGMA: DMR_SIGMA,
        refresh: afterFill,
        // vážená kombinace dvou výšek (m, σ) — kdyby ji chtěl použít jiný modul
        combine: function (z1, s1, z2, s2) {
            if (z1 == null || !isFinite(z1)) return (z2 != null && isFinite(z2)) ? { z: z2, s: s2 } : null;
            if (z2 == null || !isFinite(z2)) return { z: z1, s: s1 };
            var w1 = 1 / Math.pow(Math.max(s1 || 2, 0.05), 2), w2 = 1 / Math.pow(Math.max(s2 || 2, 0.05), 2);
            return { z: (w1 * z1 + w2 * z2) / (w1 + w2), s: 1 / Math.sqrt(w1 + w2) };
        }
    };
})();
