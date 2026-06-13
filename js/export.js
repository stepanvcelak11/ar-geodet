// ===== AR Geodet - EXPORTY pro GIS / handheldy =====
// Doplnkove exportni formaty vedle JSON/CSV/TXT (ty zustavaji v logika.js).
// Pouziva globalni promenne z logika.js: persistentCustomPoints, pointLines, activeProjectId.
// GPX i GeoJSON jsou ve WGS84 (lat/lng) - tak to oba formaty vyzaduji (zadny prevod do S-JTSK,
// vyhneme se nejednoznacne konvenci os Krovaku). Cislo bodu jde do <name> / properties.name.

(function () {
    'use strict';

    function _downloadText(filename, mime, text) {
        const blob = new Blob([text], { type: mime + ';charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function _xml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    // ----- GPX 1.1: vlastni body jako <wpt>, spojnice jako <trk> -----
    window.exportPointsGPX = function () {
        const pts = (typeof persistentCustomPoints !== 'undefined') ? persistentCustomPoints : [];
        if (!pts.length) { alert('Nemáte žádné body.'); return; }
        const lines = (typeof pointLines !== 'undefined') ? pointLines : [];
        let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
        out += '<gpx version="1.1" creator="AR Geodet" xmlns="http://www.topografix.com/GPX/1/1">\n';
        pts.forEach(p => {
            if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
            out += `  <wpt lat="${p.lat.toFixed(8)}" lon="${p.lng.toFixed(8)}"><name>${_xml(p.name || 'Bod')}</name></wpt>\n`;
        });
        lines.forEach(l => {
            out += `  <trk><name>${_xml((l.aName || '?') + '-' + (l.bName || '?'))}</name><trkseg>`;
            out += `<trkpt lat="${(+l.aLat).toFixed(8)}" lon="${(+l.aLng).toFixed(8)}"></trkpt>`;
            out += `<trkpt lat="${(+l.bLat).toFixed(8)}" lon="${(+l.bLng).toFixed(8)}"></trkpt>`;
            out += '</trkseg></trk>\n';
        });
        out += '</gpx>\n';
        const proj = (typeof activeProjectId !== 'undefined') ? activeProjectId : 'body';
        _downloadText(`body_${proj}.gpx`, 'application/gpx+xml', out);
    };

    // ----- GeoJSON FeatureCollection (WGS84): body (Point) + spojnice (LineString) -----
    window.exportPointsGeoJSON = function () {
        const pts = (typeof persistentCustomPoints !== 'undefined') ? persistentCustomPoints : [];
        if (!pts.length) { alert('Nemáte žádné body.'); return; }
        const lines = (typeof pointLines !== 'undefined') ? pointLines : [];
        const features = [];
        pts.forEach(p => {
            if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
                properties: { name: p.name || 'Bod' }
            });
        });
        lines.forEach(l => {
            features.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[+l.aLng, +l.aLat], [+l.bLng, +l.bLat]] },
                properties: { name: (l.aName || '?') + '-' + (l.bName || '?') }
            });
        });
        const fc = { type: 'FeatureCollection', features: features };
        const proj = (typeof activeProjectId !== 'undefined') ? activeProjectId : 'body';
        _downloadText(`body_${proj}.geojson`, 'application/geo+json', JSON.stringify(fc, null, 2));
    };
})();
