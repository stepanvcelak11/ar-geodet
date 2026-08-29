// ===== AR Geodet — QC INSPEKTOR / KÓD KVALITY (odpojitelná vrstva) =============
// Po každém určení bodu (resekce, průměrování GPS, Brutální GPS) porovná dosaženou
// vnitřní přesnost se základní střední souřadnicovou chybou mxy podle katastrální
// vyhlášky a řekne, jaký KÓD KVALITY bod splňuje (3 / 4 / 5). Nic neblokuje — je to
// ČTENÍ, ne brána.
//
// ZRUŠENÁ „CÍLENÁ PŘESNOST" (na přání, 8. 8.): dřív se tu volila cílová třída zakázky
// (výchozí kód 3 = kataster, mxy ≤ 0,14 m) a při ukládání podlimitního bodu vyskočila
// brána „počkat / uložit jako orientační". Holým mobilem se ale kód 3 dosáhnout NEDÁ
// (i po dlouhém průměrování je realita decimetry až metr), takže brána vyskakovala
// prakticky u KAŽDÉHO bodu a jediná odpověď byla „uložit přesto" — z varování se stalo
// klikání. Zůstává informativní čip „±0,32 m → kód kvality 5" u výsledku měření; co
// s tím geodet udělá, je jeho rozhodnutí. Volba cíle ani dialog brány už tu nejsou.
//
// 100% OFFLINE a DETERMINISTICKÉ — prahy jsou kurátorované konstanty (NE AI), shodné
// s data/predpisy.json (kat. vyhláška 357/2013 Sb., příl. bod 13). Žádné síťové volání,
// jen lokální porovnání čísel počítaných v telefonu. Jde o VNITŘNÍ přesnost měření
// (z rozptylu fixů), ne o absolutní polohu — vždy ověř na kontrolním bodě.
//
// Neinvazivní vrstva: čte sdílený globál gpsAvgResult a OBALUJE window
// funkce (updateGpsAvgPanel, fillAveragedGPS). Do měřicích modulů přidává jen
// guardované jednořádkové háky `window.AGQc && AGQc.*` (ar-resection, brutal-gps,
// pdf-protocol) — bez nich appka funguje dál.
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

    function f2(n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ','); }

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

    // Verdikt je čistě informativní: co bod splňuje, ne co splnit MÁ.
    // (`ok` a `target` z API zmizely spolu s cílenou přesností — hlídalo se podle nich
    // ukládání bodu, a to už se nehlídá.)
    function evaluate(sigma) {
        var got = codeForSigma(sigma);
        _lastCode = got ? got.kod : null;
        return { sigma: sigma, got: got, kod: _lastCode };
    }
    var _lastCode = null;   // čte logika.js do prov.qc ukládaného bodu

    // --- HTML čip verdiktu (vkládá se do panelů) -------------------------------
    // Barva = jak dobré to je samo o sobě: kód 3 zelená, 4–5 žlutá, horší červená.
    function chipHtml(sigma) {
        if (sigma == null || !isFinite(sigma)) return '';
        var v = evaluate(sigma);
        var cls = !v.got ? 'qc-bad' : (v.got.kod <= 3 ? 'qc-ok' : 'qc-warn');
        var head = '±' + f2(sigma) + ' m → ' + (v.got ? ('<b>kód kvality ' + v.got.kod + '</b>') : '<b>horší než kód 5</b>');
        var tail = v.got
            ? '<span class="qc-tail">mxy ≤ ' + f2(v.got.mxy) + ' m' + (v.got.popis ? ' · ' + v.got.popis : '') + '</span>'
            : '<span class="qc-tail">pro zaměření v terénu nevyhovuje</span>';
        return '<div class="qc-chip ' + cls + '" data-sigma="' + sigma + '">' +
            '<span class="qc-chip-main">' + head + '</span>' + tail +
            '<button type="button" class="qc-why" aria-label="Proč?">Proč?</button>' +
            '</div>';
    }

    // překreslí všechny živé čipy (mění se s dalšími vzorky měření)
    function refreshAll() {
        var chips = document.querySelectorAll('.qc-chip[data-sigma]');
        Array.prototype.forEach.call(chips, function (ch) {
            var s = parseFloat(ch.getAttribute('data-sigma'));
            var tmp = document.createElement('div'); tmp.innerHTML = chipHtml(s);
            if (tmp.firstChild) ch.parentNode.replaceChild(tmp.firstChild, ch);
        });
    }

    function openWhy() {
        if (typeof window.openPredpisy === 'function') {
            try { window.openPredpisy(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'qc-engine:openWhy'); }
            setTimeout(function () {
                var i = document.getElementById('prd-search');
                if (i) { i.value = 'kód kvality'; try { i.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'qc-engine:openWhy'); } }
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
        var wrapped = function () { var r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'qc-engine:wrapped'); } return r; };
        wrapped._qcWrapped = true; wrapped._qcOrig = orig;
        try { Object.defineProperty(wrapped, 'name', { value: name }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'qc-engine:wrapped'); }
        window[name] = wrapped; return true;
    }

    // verdikt v modálu Průměrování GPS (#gpsavg-modal) — vyplní slot #gaq-qc
    // (čip kódu kvality + výběr cílové třídy). Panel samotný je jen kompaktní řádek.
    function fillGpsModal() {
        var slot = document.getElementById('gaq-qc'); if (!slot) return;
        var r = null; try { r = (typeof gpsAvgResult !== 'undefined') ? gpsAvgResult : null; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'qc-engine:fillGpsModal'); }
        if (!r || r.coarse || typeof r.sterr !== 'number' || !isFinite(r.sterr) || (r.n || 0) < 2) { slot.innerHTML = ''; return; }
        slot.innerHTML = chipHtml(r.sterr);
    }
    // dokud je modál otevřený, drž verdikt živý (volá se z obalu updateGpsAvgPanel)
    function afterGpsPanel() {
        var m = document.getElementById('gpsavg-modal');
        if (m && m.style.display === 'flex') fillGpsModal();
    }

    // verdikt + výběr cílové třídy v dialogu „Vložit bod" po vyplnění z průměrované GPS
    function afterFillGps() {
        var note = document.getElementById('custom-acc-note'); if (!note) return;
        var r = null; try { r = (typeof gpsAvgResult !== 'undefined') ? gpsAvgResult : null; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'qc-engine:afterFillGps'); }
        if (!r || typeof r.sterr !== 'number' || !isFinite(r.sterr)) return;
        var add = document.getElementById('qc-note-add');
        if (!add) { add = document.createElement('div'); add.id = 'qc-note-add'; note.appendChild(add); }
        add.innerHTML = chipHtml(r.sterr);
    }

    // --- vlastní dialogy (bez závislosti na agConfirm) -------------------------
    function ensureGateOverlay() {
        var ov = document.getElementById('qc-gate');
        if (!ov) { ov = document.createElement('div'); ov.id = 'qc-gate'; ov.className = 'qc-gate-ov'; document.body.appendChild(ov); }
        return ov;
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

    // --- delegace událostí (tlačítko „Proč?" v čipu) --------------------------
    document.addEventListener('click', function (e) {
        var why = e.target.closest ? e.target.closest('.qc-why') : null;
        if (why) { e.preventDefault(); openWhy(); }
    });

    // --- veřejné API ----------------------------------------------------------
    window.AGQc = {
        codeForSigma: codeForSigma, evaluate: evaluate,
        chipHtml: chipHtml, codeSuffix: codeSuffix, why: openWhy,
        onResection: onResection, onBrutal: onBrutal, refreshAll: refreshAll, fillGpsModal: fillGpsModal,
        // dosažený kód posledního vyhodnoceného měření (logika.js ho ukládá do prov.qc)
        get lastCode() { return _lastCode; }
    };

    // --- instalace obalů (opakovaně, ať chytí i pozdě definované funkce) -------
    function install() {
        wrapAfter('updateGpsAvgPanel', afterGpsPanel);
        wrapAfter('fillAveragedGPS', afterFillGps);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
    window.addEventListener('load', function () { setTimeout(install, 400); });
})();
