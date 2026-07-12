// ===== AR Geodet — QC INSPEKTOR / KÓD KVALITY (odpojitelná vrstva) =============
// Po každém určení bodu (resekce, průměrování GPS, Brutální GPS) porovná dosaženou
// vnitřní přesnost se základní střední souřadnicovou chybou mxy podle katastrální
// vyhlášky a řekne, jaký KÓD KVALITY bod splňuje (3 / 4 / 5). U ukládaného bodu
// hlídá cílovou třídu zakázky a u podlimitního bodu nabídne „počkat / měřit dál"
// nebo „uložit přesto jako orientační".
//
// 100% OFFLINE a DETERMINISTICKÉ — prahy jsou kurátorované konstanty (NE AI), shodné
// s data/predpisy.json (kat. vyhláška 357/2013 Sb., příl. bod 13). Žádné síťové volání,
// jen lokální porovnání čísel počítaných v telefonu. Jde o VNITŘNÍ přesnost měření
// (z rozptylu fixů), ne o absolutní polohu — vždy ověř na kontrolním bodě.
//
// Neinvazivní vrstva: čte sdílené globály (gpsAvgResult, pendingPointAccuracy,
// editingCustomPointId, getStoredData/setStoredData, quickToast) a OBALUJE window
// funkce (updateGpsAvgPanel, fillAveragedGPS, saveCustomPoint). Do měřicích modulů
// přidává jen guardované jednořádkové háky `window.AGQc && AGQc.*` (ar-resection,
// brutal-gps, pdf-protocol) — bez nich appka funguje dál.
//
// Cílová třída se ukládá PER ZAKÁZKU (getStoredData prefixuje klíč id zakázky).
//
// Odstranění: smaž js/qc-engine.js + css/qc-engine.css a jejich řádky v index.html
// a sw.js; (volitelně) guardované řádky `window.AGQc && ...` v měřicích modulech.
// ================================================================================
(function () {
    'use strict';

    // --- KURÁTOROVANÉ PRAHY (kat. vyhláška 357/2013 Sb., příl. bod 13) ----------
    // Pro NOVĚ zaměřené body v terénu jsou relevantní kódy kvality 3–5
    // (6–8 = digitalizace starých map, ne čerstvé zaměření). Bod splní kód K,
    // je-li jeho vnitřní střední chyba polohy ≤ mxy[K].
    //   uxy = 2·mxy (mezní souřadnicová chyba) · mezní polohová = 2·√2·mxy.
    var CODES = [
        { kod: 3, mxy: 0.14, popis: 'kataster' },
        { kod: 4, mxy: 0.26, popis: '' },
        { kod: 5, mxy: 0.50, popis: '' }
    ];
    var CITACE = 'kat. vyhláška 357/2013 Sb., příl. bod 13';
    var K_TARGET = 'agQcCilKod';   // per-zakázku přes getStoredData

    function f2(n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ','); }
    function mxyFor(kod) { for (var i = 0; i < CODES.length; i++) if (CODES[i].kod === kod) return CODES[i].mxy; return null; }

    // dosažený kód kvality z vnitřní stř. chyby polohy (m) — nejlepší (nejnižší číslo),
    // jehož práh měření splňuje; null = horší než kód 5 (pro zaměření v terénu nevyhovuje)
    //
    // DEFINICE: appka počítá RADIÁLNÍ střední chybu polohy σr = √(mx²+my²).
    // Vyhlášková mxy je STŘEDNÍ SOUŘADNICOVÁ chyba mxy = √((mx²+my²)/2) = σr/√2.
    // Porovnává se tedy σr/√2 ≤ mxy (dřív se porovnávalo σr přímo → o √2 přísnější,
    // bod splňující kód 3 mohl být chybně odmítnut).
    function codeForSigma(s) {
        if (s == null || !isFinite(s) || s < 0) return null;
        var mxy = s / Math.SQRT2;
        for (var i = 0; i < CODES.length; i++) if (mxy <= CODES[i].mxy + 1e-9) return CODES[i];
        return null;
    }

    function target() {
        try {
            var v = (typeof getStoredData === 'function') ? getStoredData(K_TARGET) : localStorage.getItem(K_TARGET);
            var k = parseInt(v, 10);
            if (k >= 3 && k <= 5) return k;
        } catch (e) {}
        return 3; // výchozí = kataster (nejpřísnější)
    }
    function setTarget(k) {
        k = parseInt(k, 10); if (!(k >= 3 && k <= 5)) return;
        try { if (typeof setStoredData === 'function') setStoredData(K_TARGET, String(k)); else localStorage.setItem(K_TARGET, String(k)); } catch (e) {}
    }

    function evaluate(sigma) {
        var got = codeForSigma(sigma);
        var tgt = target();
        return { sigma: sigma, got: got, target: tgt, ok: !!got && got.kod <= tgt };
    }

    // --- HTML čip verdiktu (vkládá se do panelů) -------------------------------
    function chipHtml(sigma) {
        if (sigma == null || !isFinite(sigma)) return '';
        var v = evaluate(sigma);
        var cls = v.ok ? 'qc-ok' : (v.got ? 'qc-warn' : 'qc-bad');
        var head = '±' + f2(sigma) + ' m → ' + (v.got ? ('<b>kód kvality ' + v.got.kod + '</b>') : '<b>horší než kód 5</b>');
        var tail;
        if (v.ok) tail = '<span class="qc-tail">✓ splňuje cíl (kód ' + v.target + ')</span>';
        else if (v.got) tail = '<span class="qc-tail">cíl zakázky kód ' + v.target + ' nesplněn</span>';
        else tail = '<span class="qc-tail">pro zaměření v terénu nevyhovuje</span>';
        return '<div class="qc-chip ' + cls + '" data-sigma="' + sigma + '">' +
            '<span class="qc-chip-main">' + head + '</span>' + tail +
            '<button type="button" class="qc-why" aria-label="Proč?">Proč?</button>' +
            '</div>';
    }

    function targetSelectHtml() {
        var t = target();
        function opt(k, label) { return '<option value="' + k + '"' + (t === k ? ' selected' : '') + '>' + label + '</option>'; }
        return '<label class="qc-target"><span>Cíl zakázky:</span>' +
            '<select class="qc-target-sel">' +
            opt(3, 'kód 3 · kataster (±0,14 m)') +
            opt(4, 'kód 4 (±0,26 m)') +
            opt(5, 'kód 5 (±0,50 m)') +
            '</select></label>';
    }

    // překreslí všechny živé čipy + sjednotí selecty (po změně cílové třídy)
    function refreshAll() {
        var chips = document.querySelectorAll('.qc-chip[data-sigma]');
        Array.prototype.forEach.call(chips, function (ch) {
            var s = parseFloat(ch.getAttribute('data-sigma'));
            var tmp = document.createElement('div'); tmp.innerHTML = chipHtml(s);
            if (tmp.firstChild) ch.parentNode.replaceChild(tmp.firstChild, ch);
        });
        var sels = document.querySelectorAll('.qc-target-sel');
        Array.prototype.forEach.call(sels, function (sel) { sel.value = String(target()); });
    }

    function openWhy() {
        if (typeof window.openPredpisy === 'function') {
            try { window.openPredpisy(); } catch (e) {}
            setTimeout(function () {
                var i = document.getElementById('prd-search');
                if (i) { i.value = 'kód kvality'; try { i.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
            }, 60);
        } else {
            gateInfo('Kód kvality podrobných bodů',
                'mxy ≤ 0,14 m → kód 3 (kataster) · ≤ 0,26 m → kód 4 · ≤ 0,50 m → kód 5.<br>' +
                'uxy = 2·mxy (mezní souřadnicová chyba). Zdroj: ' + CITACE + '.<br>' +
                'Měřená ±hodnota je radiální chyba polohy; na mxy se převádí dělením √2. ' +
                'Verdikt vychází z VNITŘNÍ přesnosti měření — absolutní polohu vždy ověř na kontrolním bodě.');
        }
    }

    // --- napojení do panelů (volá se z háků měřicích modulů) -------------------
    // AR resekce: r.posSigma = odhad stř. chyby polohy (m); null u 2/3 bodů bez kontroly
    function onResection(box, r) {
        if (!box || !r || r.posSigma == null || !isFinite(r.posSigma)) return;
        var node = document.createElement('div');
        node.className = 'qc-inline';
        node.innerHTML = chipHtml(r.posSigma);
        box.appendChild(node);
    }

    // Brutální GPS: sterr = výsledná stř. chyba (m)
    function onBrutal(sterr) {
        var sub = document.getElementById('bgps-val-sub');
        if (!sub || sterr == null || !isFinite(sterr)) return;
        var node = document.getElementById('bgps-qc');
        if (!node) {
            node = document.createElement('div'); node.id = 'bgps-qc'; node.className = 'qc-inline qc-center';
            sub.parentNode.insertBefore(node, sub.nextSibling);
        }
        node.innerHTML = chipHtml(sterr);
    }

    // krátký přípis kódu pro PDF protokol: "±0,11 m" -> " · k3"
    function codeSuffix(sigma) {
        var g = codeForSigma(sigma);
        return g ? (' · k' + g.kod) : '';
    }

    // --- obalení window funkcí (vzor welcome-card.js) --------------------------
    function wrapAfter(name, after) {
        if (typeof window[name] !== 'function' || window[name]._qcWrapped) return false;
        var orig = window[name];
        var wrapped = function () { var r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) {} return r; };
        wrapped._qcWrapped = true; wrapped._qcOrig = orig;
        try { Object.defineProperty(wrapped, 'name', { value: name }); } catch (e) {}
        window[name] = wrapped; return true;
    }

    // verdikt v modálu Průměrování GPS (#gpsavg-modal) — vyplní slot #gaq-qc
    // (čip kódu kvality + výběr cílové třídy). Panel samotný je jen kompaktní řádek.
    function fillGpsModal() {
        var slot = document.getElementById('gaq-qc'); if (!slot) return;
        var r = null; try { r = (typeof gpsAvgResult !== 'undefined') ? gpsAvgResult : null; } catch (e) {}
        if (!r || r.coarse || typeof r.sterr !== 'number' || !isFinite(r.sterr) || (r.n || 0) < 2) { slot.innerHTML = ''; return; }
        slot.innerHTML = chipHtml(r.sterr) + targetSelectHtml();
    }
    // dokud je modál otevřený, drž verdikt živý (volá se z obalu updateGpsAvgPanel)
    function afterGpsPanel() {
        var m = document.getElementById('gpsavg-modal');
        if (m && m.style.display === 'flex') fillGpsModal();
    }

    // verdikt + výběr cílové třídy v dialogu „Vložit bod" po vyplnění z průměrované GPS
    function afterFillGps() {
        var note = document.getElementById('custom-acc-note'); if (!note) return;
        var r = null; try { r = (typeof gpsAvgResult !== 'undefined') ? gpsAvgResult : null; } catch (e) {}
        if (!r || typeof r.sterr !== 'number' || !isFinite(r.sterr)) return;
        var add = document.getElementById('qc-note-add');
        if (!add) { add = document.createElement('div'); add.id = 'qc-note-add'; note.appendChild(add); }
        add.innerHTML = chipHtml(r.sterr) + targetSelectHtml();
    }

    // BRÁNA: obalí saveCustomPoint tak, aby u podlimitního NOVÉHO bodu z GPS
    // nejdřív nabídla volbu (počkat / uložit jako orientační). Spustí původní save
    // až po souhlasu — orig se v jiných případech volá rovnou (nic neomezuje).
    function wrapSaveGate() {
        if (typeof window.saveCustomPoint !== 'function' || window.saveCustomPoint._qcGate) return false;
        var orig = window.saveCustomPoint;
        var wrapped = function () {
            var self = this, args = arguments;
            var proceed = function () { return orig.apply(self, args); };
            var editing = false, acc = null;
            try { editing = (typeof editingCustomPointId !== 'undefined') && !!editingCustomPointId; } catch (e) {}
            try { acc = (typeof pendingPointAccuracy !== 'undefined') ? pendingPointAccuracy : null; } catch (e) {}
            // brána jen pro NOVÝ bod určený průměrovanou GPS (má pendingPointAccuracy)
            if (editing || acc == null || !isFinite(acc)) return proceed();
            var v = evaluate(acc);
            if (v.ok) {
                proceed();
                try { if (typeof quickToast === 'function') quickToast('Uloženo · kód kvality ' + v.got.kod + ' ✓'); } catch (e) {}
                return;
            }
            gateDialog(acc, v, proceed);   // orig až po volbě uživatele
            return;
        };
        wrapped._qcGate = true; wrapped._qcOrig = orig;
        try { Object.defineProperty(wrapped, 'name', { value: 'saveCustomPoint' }); } catch (e) {}
        window.saveCustomPoint = wrapped;
        return true;
    }

    // --- vlastní dialogy (bez závislosti na agConfirm) -------------------------
    function ensureGateOverlay() {
        var ov = document.getElementById('qc-gate');
        if (!ov) { ov = document.createElement('div'); ov.id = 'qc-gate'; ov.className = 'qc-gate-ov'; document.body.appendChild(ov); }
        return ov;
    }

    function gateDialog(sigma, v, onProceed) {
        var ov = ensureGateOverlay();
        var cil = v.target, mez = mxyFor(cil);
        ov.innerHTML =
            '<div class="qc-gate-card" role="dialog" aria-modal="true" aria-label="Kontrola přesnosti">' +
            '  <div class="qc-gate-h"><svg class="icon"><use href="#i-alert"/></svg> Přesnost pod cílem zakázky</div>' +
            '  <div class="qc-gate-b">' +
            '    <p>Bod má vnitřní přesnost <b>±' + f2(sigma) + ' m</b> → ' + (v.got ? ('<b>kód kvality ' + v.got.kod + '</b>') : '<b>horší než kód 5</b>') + '.</p>' +
            '    <p>Cíl zakázky je <b>kód ' + cil + '</b> (mxy ≤ ' + f2(mez) + ' m' + (cil === 3 ? ', kataster' : '') + ') — tenhle bod ho <b>nesplní</b>.</p>' +
            '    <p class="qc-gate-tip">Tip: nech telefon déle ležet, vyjdi pod volnější oblohu, případně otoč o 180° — ať se průměr ustálí.</p>' +
            '    <p class="qc-gate-note">Jde o vnitřní přesnost měření (z rozptylu fixů), ne o absolutní polohu — ověř na kontrolním bodě. ' + CITACE + '.</p>' +
            '  </div>' +
            '  <div class="qc-gate-f">' +
            '    <button type="button" class="qc-gate-btn qc-gate-wait">Počkat / měřit dál</button>' +
            '    <button type="button" class="qc-gate-btn qc-gate-save">Uložit přesto jako orientační</button>' +
            '  </div>' +
            '</div>';
        ov.classList.add('open');
        function close() { ov.classList.remove('open'); }
        ov.querySelector('.qc-gate-wait').onclick = function () { close(); };
        ov.querySelector('.qc-gate-save').onclick = function () { close(); try { onProceed(); } catch (e) {} };
        ov.onmousedown = function (e) { if (e.target === ov) close(); };
    }

    function gateInfo(title, html) {
        var ov = ensureGateOverlay();
        ov.innerHTML =
            '<div class="qc-gate-card" role="dialog" aria-modal="true">' +
            '  <div class="qc-gate-h"><svg class="icon"><use href="#i-info"/></svg> ' + title + '</div>' +
            '  <div class="qc-gate-b"><p>' + html + '</p></div>' +
            '  <div class="qc-gate-f"><button type="button" class="qc-gate-btn qc-gate-wait">Zavřít</button></div>' +
            '</div>';
        ov.classList.add('open');
        function close() { ov.classList.remove('open'); }
        ov.querySelector('.qc-gate-wait').onclick = close;
        ov.onmousedown = function (e) { if (e.target === ov) close(); };
    }

    // --- delegace událostí (čipy + select cílové třídy) ------------------------
    document.addEventListener('click', function (e) {
        var why = e.target.closest ? e.target.closest('.qc-why') : null;
        if (why) { e.preventDefault(); openWhy(); }
    });
    document.addEventListener('change', function (e) {
        var sel = e.target.closest ? e.target.closest('.qc-target-sel') : null;
        if (sel) { setTarget(sel.value); refreshAll(); }
    });

    // --- veřejné API ----------------------------------------------------------
    window.AGQc = {
        codeForSigma: codeForSigma, evaluate: evaluate, target: target, setTarget: setTarget,
        chipHtml: chipHtml, codeSuffix: codeSuffix, why: openWhy,
        onResection: onResection, onBrutal: onBrutal, refreshAll: refreshAll, fillGpsModal: fillGpsModal
    };

    // --- instalace obalů (opakovaně, ať chytí i pozdě definované funkce) -------
    function install() {
        wrapAfter('updateGpsAvgPanel', afterGpsPanel);
        wrapAfter('fillAveragedGPS', afterFillGps);
        wrapSaveGate();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
    window.addEventListener('load', function () { setTimeout(install, 400); });
})();
