// ===== AR Geodet — EXPORT DXF (vektor do CADu) (ODPOJITELNÁ vrstva) ============
// Neinvazivní, ve stylu js/kml-export.js + js/export.js: NEEDITUJE logika.js ani
// grafika.js. Za běhu přidá tlačítko „Export DXF (do CADu)" do exportního menu
// (#manage-modal .exp-opts) a vygeneruje validní DXF R12 (AC1009) — nejširší
// kompatibilita (AutoCAD, BricsCAD, MicroStation, QGIS, Kokeš, Groma…).
//
// CO EXPORTUJE (vlastní body zakázky + spojnice):
//   • POINT   — každý bod (vrstva BODY), Z = výška bodu (0, když není).
//   • TEXT    — číslo/název bodu vedle značky (vrstva POPIS).
//   • LINE    — spojnice mezi body (vrstva SPOJNICE).
//
// SOUŘADNICE: S-JTSK (Křovák) přes proj4 EPSG:4326→EPSG:5514, kladné hodnoty —
//   STEJNÁ konvence jako CSV/TXT export appky (řádek „název;Y;X"). Do DXF jdou jako
//   X_dxf = Y_JTSK (východ), Y_dxf = X_JTSK (sever) — tj. sever nahoru. Import DXF
//   v této appce třídí osy podle velikosti, takže export↔import bodů drží (round-trip).
//   Text s diakritikou je v UTF-8 (moderní CAD/QGIS čtou; starší český CAD může
//   chtít Windows-1250 — pak názvy překóduj v CADu).
//
// Odstranění: smaž js/dxf-export.js + řádek <script> v index.html (a záznam v sw.js).
// ================================================================================
(function () {
    'use strict';

    var TEXT_H = 1.0;   // výška popisu v metrech (orientační; v CADu lze hromadně změnit)
    var LBL_DX = 0.4;   // odsazení popisu od bodu (m), aby text nekryl značku

    function alertFail(title, message) {
        try { if (typeof window.agAlert === 'function') return window.agAlert({ title: title, message: message }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'dxf-export:alertFail'); }
        agInfo(title + (message ? '\n\n' + message : ''));
    }

    function _downloadText(filename, mime, text) {
        var blob = new Blob([text], { type: mime + ';charset=utf-8' });
        // DXF do CADu je typický „pošli to do kanceláře" soubor — na iPhonu ho ven
        // dostane jen list sdílení (js/sdilet-soubor.js), ne <a download>.
        if (typeof window.agShareOrDownload === 'function') {
            return window.agShareOrDownload(blob, filename, mime)['catch'](function (e) {
                window.AG && AG.swallow && AG.swallow(e, 'dxf-export:_downloadText');
                return 'fail';
            });
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        return Promise.resolve('download');
    }

    // POZN.: za běhu appky přebíjí window.exportPointsDXF verze z vylepseni.js (načítá se
    // později) — tenhle modul je fallback, když je odpojitelná vrstva vylepseni.js pryč.
    // WGS84 (lat/lng) -> S-JTSK. #15: NEPOUŽÍVAT Math.abs — proj4 5514 vrací pro ČR záporné
    // hodnoty a kreslíme je přímo (DXF_X = Y_JTSK, DXF_Y = X_JTSK) => východ vpravo, sever
    // nahoru. Absolutní hodnota obě osy negovala = výkres otočený o 180° (shodně s vylepseni.js).
    // POZOR — tady se ZAMERNE vraci ZNAMENKOVY (negativni) Krovak, protoze presne to
    // se zapisuje do DXF; appka jinak vsude pracuje s kladnymi Y,X. GeoCore vraci kladne,
    // takze se znamenko vraci zpet: raw = [-Y, -X] (overeno proti PROJ v tests/cases-geo.js).
    // Nemenit na kladne — zmenila by se poloha vsech dosud exportovanych vykresu.
    function toSJTSK(lat, lng) {
        try {
            if (window.GeoCore && GeoCore.toSJTSK) {
                var s = GeoCore.toSJTSK(lat, lng);
                if (!s || !isFinite(s.y) || !isFinite(s.x)) return null;
                return { y: -s.y, x: -s.x };
            }
            var sj = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]);
            var Y = sj[0], X = sj[1];
            if (!isFinite(Y) || !isFinite(X)) return null;
            return { y: Y, x: X };
        } catch (e) { return null; }
    }

    // DXF text nesmí obsahovat řídicí znaky; ^ má v DXF speciální význam (kódování) → nahradit.
    function dxfText(s) {
        return String(s == null ? '' : s).replace(/[\r\n\t]/g, ' ').replace(/\^/g, ' ').slice(0, 250);
    }

    function num(n) { return (Math.round(n * 1000) / 1000).toFixed(3); }

    // jeden pár (kód, hodnota) na dvou řádcích — základní stavební kámen DXF
    function g(code, val, out) { out.push(String(code)); out.push(String(val)); }

    function layerRecord(name, colorIndex, out) {
        g(0, 'LAYER', out); g(2, name, out); g(70, 0, out); g(62, colorIndex, out); g(6, 'CONTINUOUS', out);
    }

    window.exportPointsDXF = function () {
        var pts = (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : [];
        var lines = (typeof pointLines !== 'undefined' && Array.isArray(pointLines)) ? pointLines : [];
        if (!pts.length && !lines.length) { alertFail('Nemáte co exportovat', 'V zakázce nejsou žádné vlastní body ani spojnice.'); return; }
        if (typeof proj4 !== 'function') { alertFail('Export selhal', 'Chybí knihovna proj4 pro převod do S-JTSK.'); return; }

        try {
            var o = [];
            // --- HEADER (minimální, jednotky = metry) ---
            g(0, 'SECTION', o); g(2, 'HEADER', o);
            g(9, '$ACADVER', o); g(1, 'AC1009', o);
            g(9, '$INSUNITS', o); g(70, 6, o); // 6 = metry
            g(0, 'ENDSEC', o);
            // --- TABLES: vrstvy ---
            g(0, 'SECTION', o); g(2, 'TABLES', o);
            g(0, 'TABLE', o); g(2, 'LAYER', o); g(70, 4, o);
            layerRecord('0', 7, o);
            layerRecord('BODY', 2, o);       // žlutá
            layerRecord('POPIS', 3, o);      // zelená
            layerRecord('SPOJNICE', 5, o);   // modrá
            g(0, 'ENDTAB', o);
            g(0, 'ENDSEC', o);
            // --- ENTITIES ---
            g(0, 'SECTION', o); g(2, 'ENTITIES', o);

            var skipped = 0, np = 0, nl = 0;
            pts.forEach(function (p) {
                if (typeof p.lat !== 'number' || typeof p.lng !== 'number') { skipped++; return; }
                var s = toSJTSK(p.lat, p.lng);
                if (!s) { skipped++; return; }
                var z = (p.vyska != null && isFinite(p.vyska)) ? +p.vyska : 0;
                // POINT (X_dxf = Y_JTSK, Y_dxf = X_JTSK)
                g(0, 'POINT', o); g(8, 'BODY', o); g(10, num(s.y), o); g(20, num(s.x), o); g(30, num(z), o);
                // TEXT (číslo bodu)
                g(0, 'TEXT', o); g(8, 'POPIS', o);
                g(10, num(s.y + LBL_DX), o); g(20, num(s.x + LBL_DX), o); g(30, num(z), o);
                g(40, num(TEXT_H), o); g(1, dxfText(p.name || 'Bod'), o);
                np++;
            });
            lines.forEach(function (l) {
                var a = toSJTSK(+l.aLat, +l.aLng), b = toSJTSK(+l.bLat, +l.bLng);
                if (!a || !b) { skipped++; return; }
                g(0, 'LINE', o); g(8, 'SPOJNICE', o);
                g(10, num(a.y), o); g(20, num(a.x), o); g(30, 0, o);
                g(11, num(b.y), o); g(21, num(b.x), o); g(31, 0, o);
                nl++;
            });

            g(0, 'ENDSEC', o);
            g(0, 'EOF', o);

            var dxf = o.join('\r\n') + '\r\n';
            var proj = (typeof activeProjectId !== 'undefined') ? activeProjectId : 'body';
            // ⚠ Hlásit se smí AŽ PODLE VÝSLEDKU. Když člověk v systémovém listu sdílení
            // klepne na „Zrušit“, NIC se neuložilo — a appka mu přesto psala „DXF vytvořeno“.
            // Prázdné ruce a hláška o úspěchu jsou horší než žádná hláška.
            var _ven = _downloadText('body_' + proj + '.dxf', 'application/dxf', dxf);

            var msg = 'Exportováno: ' + np + ' bodů' + (nl ? ', ' + nl + ' spojnic' : '') + '.'
                + (skipped ? '\n(' + skipped + ' přeskočeno — chybné souřadnice.)' : '')
                + '\n\nSouřadnice S-JTSK (sever nahoru), výška v ose Z. Text v UTF-8.';
            _ven.then(function (jak) {
                if (jak === 'abort' || jak === 'fail') return;
                try { if (typeof window.quickToast === 'function') window.quickToast('DXF vytvořeno (' + np + ' bodů)'); else alertFail('DXF vytvořeno', msg); }
                catch (e) { alertFail('DXF vytvořeno', msg); }
            });
        } catch (e) {
            console.warn('[dxf-export] generate', e);
            alertFail('Export selhal', 'Při tvorbě DXF došlo k chybě.');
        }
    };

    // --- injekce tlačítka do exportního menu (vzor: kml-export.js) ---------------
    function injectDxfButton() {
        var opts = document.querySelector('#manage-modal .exp-opts');
        if (!opts || document.getElementById('ag-export-dxf')) return;
        var btn = document.createElement('button');
        btn.id = 'ag-export-dxf';
        btn.className = 'btn btn-secondary';
        btn.type = 'button';
        btn.innerHTML = '<svg class="icon"><use href="#i-upload"/></svg> Export DXF (do CADu)';
        btn.addEventListener('click', function () { try { window.exportPointsDXF(); } catch (e) { console.warn(e); } });
        var importBtn = opts.querySelector('button.btn-blue');
        if (importBtn) opts.insertBefore(btn, importBtn);
        else opts.appendChild(btn);
    }

    function init() { try { injectDxfButton(); } catch (e) { console.warn('[dxf-export] inject', e); } }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
