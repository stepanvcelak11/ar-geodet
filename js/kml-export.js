// ===== AR Geodet — KML EXPORT (ODPOJITELNÁ vrstva) ==============================
// Neinvazivní, ve stylu js/vylepseni.js: NEEDITUJE logika.js ani grafika.js, jen za
// běhu přidá tlačítko "Export KML" do existujícího exportního menu (#manage-modal
// .exp-opts) a vygeneruje validní KML 2.2 pro Google Earth / GIS.
//
// Odstranění: smaž js/kml-export.js + řádek <script ...> v index.html (a záznam v sw.js).
//
// Data (OVĚŘENO v logika.js):
//   persistentCustomPoints: { id, name, lat, lng, cat, type }
//   pointLines:             { id, aId, bId, aName, bName, aLat, aLng, bLat, bLng }
//   activeProjectId:        identifikátor aktivní zakázky (do názvu souboru)
// KML používá WGS84 (lat/lng) — souřadnice ve formátu "lng,lat,0" (žádný převod do S-JTSK).
// ================================================================================
(function () {
    'use strict';

    // --- pomocné -----------------------------------------------------------------
    function xmlEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    function alertFail(title, message) {
        try {
            if (typeof window.agAlert === 'function') { window.agAlert({ title: title, message: message }); return; }
        } catch (e) {}
        try { alert(title + '\n\n' + String(message).replace(/<[^>]*>/g, '')); } catch (e) {}
    }

    function downloadText(filename, mime, text) {
        try {
            const blob = new Blob([text], { type: mime + ';charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (e) {
            alertFail('Export selhal', 'Nepodařilo se stáhnout soubor.');
        }
    }

    function coordStr(lng, lat) {
        // KML pořadí: longitude,latitude,altitude
        return (+lng).toFixed(8) + ',' + (+lat).toFixed(8) + ',0';
    }

    // --- generátor KML 2.2 -------------------------------------------------------
    window.exportPointsKML = function () {
        try {
            const pts = (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : [];
            const lines = (typeof pointLines !== 'undefined' && Array.isArray(pointLines)) ? pointLines : [];

            if (!pts.length && !lines.length) {
                alertFail('Není co exportovat', 'Tato zakázka nemá žádné vlastní body ani spojnice.');
                return;
            }

            let body = '';
            let nPts = 0, nLines = 0;

            // Placemark / Point pro každý vlastní bod
            pts.forEach(function (p) {
                if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number' || !isFinite(p.lat) || !isFinite(p.lng)) return;
                body += '    <Placemark>\n' +
                    '      <name>' + xmlEsc(p.name || 'Bod') + '</name>\n' +
                    '      <styleUrl>#agPoint</styleUrl>\n' +
                    '      <Point><coordinates>' + coordStr(p.lng, p.lat) + '</coordinates></Point>\n' +
                    '    </Placemark>\n';
                nPts++;
            });

            // Placemark / LineString pro každou spojnici
            lines.forEach(function (l) {
                if (!l) return;
                const aLat = +l.aLat, aLng = +l.aLng, bLat = +l.bLat, bLng = +l.bLng;
                if (![aLat, aLng, bLat, bLng].every(isFinite)) return;
                const nm = (l.aName || '?') + ' – ' + (l.bName || '?');
                body += '    <Placemark>\n' +
                    '      <name>' + xmlEsc(nm) + '</name>\n' +
                    '      <styleUrl>#agLine</styleUrl>\n' +
                    '      <LineString>\n' +
                    '        <tessellate>1</tessellate>\n' +
                    '        <coordinates>' + coordStr(aLng, aLat) + ' ' + coordStr(bLng, bLat) + '</coordinates>\n' +
                    '      </LineString>\n' +
                    '    </Placemark>\n';
                nLines++;
            });

            if (!nPts && !nLines) {
                alertFail('Není co exportovat', 'Body ani spojnice nemají platné souřadnice.');
                return;
            }

            const proj = (typeof activeProjectId !== 'undefined') ? activeProjectId : 'body';
            const docName = 'AR Geodet — body (' + proj + ')';

            const kml =
                '<?xml version="1.0" encoding="UTF-8"?>\n' +
                '<kml xmlns="http://www.opengis.net/kml/2.2">\n' +
                '  <Document>\n' +
                '    <name>' + xmlEsc(docName) + '</name>\n' +
                '    <Style id="agPoint">\n' +
                '      <IconStyle><color>ff749e2f</color><scale>1.1</scale>\n' +
                '        <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/grn-pushpin.png</href></Icon>\n' +
                '      </IconStyle>\n' +
                '      <LabelStyle><scale>0.9</scale></LabelStyle>\n' +
                '    </Style>\n' +
                '    <Style id="agLine">\n' +
                '      <LineStyle><color>ff749e2f</color><width>3</width></LineStyle>\n' +
                '    </Style>\n' +
                body +
                '  </Document>\n' +
                '</kml>\n';

            downloadText('body_' + proj + '.kml', 'application/vnd.google-earth.kml+xml', kml);
        } catch (e) {
            console.warn('[kml-export] generate', e);
            alertFail('Export selhal', 'Při tvorbě KML došlo k chybě.');
        }
    };

    // --- injekce tlačítka do exportního menu (vzor: injectDxfButton) -------------
    function injectKmlButton() {
        const opts = document.querySelector('#manage-modal .exp-opts');
        if (!opts || document.getElementById('ag-export-kml')) return;
        const btn = document.createElement('button');
        btn.id = 'ag-export-kml';
        btn.className = 'btn btn-secondary';
        btn.type = 'button';
        btn.innerHTML = '<svg class="icon"><use href="#i-upload"/></svg> Export KML (Google Earth)';
        btn.addEventListener('click', function () { try { window.exportPointsKML(); } catch (e) { console.warn(e); } });
        // vlož před tlačítko Importu (btn-blue), ať "Export ..." řada zůstane pohromadě
        const importBtn = opts.querySelector('button.btn-blue');
        if (importBtn) opts.insertBefore(btn, importBtn);
        else opts.appendChild(btn);
    }

    // --- init (DOMContentLoaded + window load druhý průchod) ----------------------
    function init() {
        try { injectKmlButton(); } catch (e) { console.warn('[kml-export] inject', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
