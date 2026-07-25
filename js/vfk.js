// ===== AR Geodet - IMPORT VFK (vymenny format CUZK) =====
// VFK je povinny vymenny format katastru. Struktura:
//   &H<...>            hlavicka souboru (metadata) - ignorujeme
//   &B<BLOK>;COL TYP;COL TYP;...   definice sloupcu datoveho bloku
//   &D<BLOK>;hodnota;hodnota;...   datovy radek
// Parser je ZAMERNE schematu-agnosticky: nespoleha na presny nazev bloku, ale v KAZDEM
// bloku hleda sloupce se souradnicemi (SOURADNICE_Y/X, resp. *_Y/*_X) a cislo bodu.
// Diky tomu vytahne body z ruznych variant VFK (SOBR, SBP, detailni body...) bez znalosti schematu.
// Kodovani (obvykle Windows-1250) resi volajici pres _agDecodeBuf (jako u CSV importu).

(function () {
    'use strict';

    // Rozdeleni radku po ';' se zachovanim "uvozovkovanych" hodnot (retezce ve VFK jsou v "...").
    function _split(line) {
        var out = [], cur = '', inq = false;
        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (ch === '"') { inq = !inq; continue; }
            if (ch === ';' && !inq) { out.push(cur); cur = ''; continue; }
            cur += ch;
        }
        out.push(cur);
        return out;
    }

    // Text VFK -> pole { name, y, x, z } v S-JTSK (kladne hodnoty; poradi os resi sjtskToLatLng).
    window.parseVFK = function (text) {
        if (!text || typeof text !== 'string' || text.indexOf('&') < 0) return [];
        var lines = text.split(/\r?\n/);
        var blocks = {}; // nazev -> { cols:[...], rows:[[...]] }
        lines.forEach(function (raw) {
            if (!raw || raw.charAt(0) !== '&') return;
            var tag = raw.charAt(1);
            if (tag === 'B') {
                var parts = _split(raw.substring(2));
                var name = parts.shift();
                var cols = parts.map(function (c) { return String(c || '').trim().split(/\s+/)[0].toUpperCase(); }).filter(Boolean);
                blocks[name] = { cols: cols, rows: [] };
            } else if (tag === 'D') {
                var parts2 = _split(raw.substring(2));
                var name2 = parts2.shift();
                if (!blocks[name2]) blocks[name2] = { cols: [], rows: [] };
                blocks[name2].rows.push(parts2);
            }
        });

        var pts = [];
        Object.keys(blocks).forEach(function (bn) {
            var b = blocks[bn];
            if (!b.cols.length || !b.rows.length) return;
            var yi = -1, xi = -1, zi = -1, ni = -1;
            b.cols.forEach(function (c, idx) {
                if (yi < 0 && (/SOURADNICE_Y/.test(c) || /(^|_)Y$/.test(c))) yi = idx;
                if (xi < 0 && (/SOURADNICE_X/.test(c) || /(^|_)X$/.test(c))) xi = idx;
                if (zi < 0 && (/SOURADNICE_Z/.test(c) || /(^|_)Z$/.test(c) || /VYSKA/.test(c))) zi = idx;
            });
            // cislo bodu: preferuj CISLO_BODU, pak jine *CISLO*/BOD, az nakonec ID
            b.cols.forEach(function (c, idx) { if (ni < 0 && /CISLO_BODU/.test(c)) ni = idx; });
            if (ni < 0) b.cols.forEach(function (c, idx) { if (ni < 0 && (/CISLO/.test(c) || /^BOD/.test(c))) ni = idx; });
            if (ni < 0) b.cols.forEach(function (c, idx) { if (ni < 0 && c === 'ID') ni = idx; });
            if (yi < 0 || xi < 0) return;

            b.rows.forEach(function (r) {
                var yv = parseFloat(String(r[yi] == null ? '' : r[yi]).replace(',', '.'));
                var xv = parseFloat(String(r[xi] == null ? '' : r[xi]).replace(',', '.'));
                if (!isFinite(yv) || !isFinite(xv)) return;
                var ay = Math.abs(yv), ax = Math.abs(xv);
                // hruby filtr na rozsah S-JTSK pro CR -> vyradi radky, kde Y/X sloupec nejsou souradnice
                var LO = 400000, HI = 1300000;
                if (ay < LO || ay > HI || ax < LO || ax > HI) return;
                var nm = (ni >= 0 && r[ni] != null && String(r[ni]).trim() !== '') ? String(r[ni]).trim() : (bn + '_' + (pts.length + 1));
                var zv = (zi >= 0) ? parseFloat(String(r[zi] == null ? '' : r[zi]).replace(',', '.')) : NaN;
                pts.push({ name: nm, y: ay, x: ax, z: (isFinite(zv) ? zv : null) });
            });
        });
        return pts;
    };

    // Text VFK -> pridani bodu do aktualni zakazky (prevod S-JTSK -> WGS84). Vraci pocet pridanych.
    window.importVFKText = function (text) {
        var raw = window.parseVFK(text);
        if (!raw.length) return 0;
        if (typeof sjtskToLatLng !== 'function' || typeof window.addImportedPoints !== 'function') return 0;
        var conv = raw.map(function (p) {
            var c = sjtskToLatLng(p.y, p.x);
            if (!c || !isFinite(c.lat) || !isFinite(c.lng)) return null;
            return { name: p.name, lat: c.lat, lng: c.lng, vyska: (p.z != null ? p.z : null) };
        }).filter(Boolean);
        return window.addImportedPoints(conv);
    };
})();
