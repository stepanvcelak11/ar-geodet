// ===== AR Geodet — PDF PROTOKOL O BODECH (ODPOJITELNÁ vrstva) ==================
// Neinvazivní, ve stylu js/kml-export.js + js/export.js: NEEDITUJE logika.js ani
// grafika.js. Za běhu přidá tlačítko "PDF protokol" do existujícího exportního menu
// (#manage-modal .exp-opts) a vygeneruje profesionální PDF protokol k zakázce:
//   - hlavička (název zakázky, datum/čas),
//   - tabulka bodů (číslo, S-JTSK Y, X, dosažená přesnost acc, příznak Vytyčeno),
//   - náhled foto-dokumentace bodu (pokud existuje),
//   - patička s atribucí "Podkladová data © ČÚZK" a upozorněním, že appka je
//     orientační pomůcka.
//
// jsPDF se lazy-loaduje z CDN (vzor: ensureTesseract v logika.js) — první použití
// vyžaduje internet, pak drží SW cache. Pro českou diakritiku se pokusí stáhnout
// Unicode TTF font (DejaVu/Roboto) přes addFileToVFS+addFont; když to selže,
// bezpečný fallback = transliterace na ASCII (diakritika se nikdy nerozsype).
//
// Data (OVĚŘENO v logika.js / kalkulacka.js / vytycovani.js):
//   persistentCustomPoints: { id, name, lat, lng, cat, type, acc? }
//   activeProjectId + projects[{id,name}]
//   proj4("EPSG:4326","EPSG:5514",[lng,lat]) -> [Y,X] (kladné přes Math.abs)
//   loadPointDoc(id) -> Promise<{ photos:[dataURL], note, t }>  (foto-dokumentace)
//   stakeoutData[id] / getStoredData('arStakeout12') -> mapa { id:{t,acc} } (Vytyčeno)
//
// Odstranění: smaž js/pdf-protocol.js + řádek <script ...> v index.html (a záznam v sw.js).
// ================================================================================
(function () {
    'use strict';

    // --- CDN zdroje --------------------------------------------------------------
    var JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    // Unicode TTF fonty (regular). Bereme první, který se podaří stáhnout.
    var FONT_CANDIDATES = [
        { url: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf', vfs: 'DejaVuSans.ttf', name: 'DejaVuSans' },
        { url: 'https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.0.8/files/roboto-latin-ext-400-normal.woff', vfs: 'Roboto.ttf', name: 'Roboto' },
        { url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/apache/roboto/static/Roboto-Regular.ttf', vfs: 'Roboto.ttf', name: 'Roboto' }
    ];

    // --- pomocné: alert v UI appky (vzor kml-export.js) --------------------------
    function alertFail(title, message) {
        try {
            if (typeof window.agAlert === 'function') { window.agAlert({ title: title, message: message }); return; }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pdf-protocol:alertFail'); }
        try { agInfo(title + '\n\n' + String(message).replace(/<[^>]*>/g, '')); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pdf-protocol:alertFail'); }
    }

    // --- transliterace na ASCII (bezpečný fallback, když TTF font selže) ---------
    // Diakritika se NESMÍ rozsypat: když není Unicode font, převedeme znaky na ASCII.
    var TRANSLIT_MAP = {
        'á': 'a', 'č': 'c', 'ď': 'd', 'é': 'e', 'ě': 'e', 'í': 'i', 'ň': 'n',
        'ó': 'o', 'ř': 'r', 'š': 's', 'ť': 't', 'ú': 'u', 'ů': 'u', 'ý': 'y', 'ž': 'z',
        'Á': 'A', 'Č': 'C', 'Ď': 'D', 'É': 'E', 'Ě': 'E', 'Í': 'I', 'Ň': 'N',
        'Ó': 'O', 'Ř': 'R', 'Š': 'S', 'Ť': 'T', 'Ú': 'U', 'Ů': 'U', 'Ý': 'Y', 'Ž': 'Z',
        'ä': 'a', 'ö': 'o', 'ü': 'u', 'ß': 'ss', 'Ä': 'A', 'Ö': 'O', 'Ü': 'U',
        '–': '-', '—': '-', ' ': ' ', '©': '(c)', '±': '+/-', '°': 'deg'
    };
    function translit(s) {
        s = String(s == null ? '' : s);
        var out = '';
        for (var i = 0; i < s.length; i++) {
            var ch = s[i];
            out += (TRANSLIT_MAP.hasOwnProperty(ch) ? TRANSLIT_MAP[ch] : (ch.charCodeAt(0) > 127 ? '?' : ch));
        }
        return out;
    }

    // --- lazy-load jsPDF (vzor ensureTesseract) ----------------------------------
    var _jspdfPromise = null;
    function ensureJsPDF() {
        if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
        if (!_jspdfPromise) {
            _jspdfPromise = new Promise(function (resolve, reject) {
                var sc = document.createElement('script');
                sc.src = JSPDF_URL;
                sc.onload = function () {
                    if (window.jspdf && window.jspdf.jsPDF) resolve();
                    else { _jspdfPromise = null; reject(new Error('Knihovna jsPDF se načetla nekorektně.')); }
                };
                sc.onerror = function () {
                    _jspdfPromise = null;
                    reject(new Error('Nepodařilo se stáhnout knihovnu pro PDF — první použití vyžaduje internet.'));
                };
                document.head.appendChild(sc);
            });
        }
        return _jspdfPromise;
    }

    // --- načtení Unicode TTF fontu a registrace do dokumentu ---------------------
    // ArrayBuffer -> base64 (po dávkách, ať to nepřeteče stack u velkého fontu).
    function bufToBase64(buf) {
        var bytes = new Uint8Array(buf);
        var bin = '';
        var chunk = 0x8000;
        for (var i = 0; i < bytes.length; i += chunk) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(bin);
    }

    var _fontPromise = null; // cache výsledku: { ok:true, name } nebo { ok:false }
    function ensureUnicodeFont(doc) {
        // Pokud už máme zaregistrovaný font, jen ho přidáme do tohoto dokumentu.
        if (_fontPromise) {
            return _fontPromise.then(function (res) {
                if (res && res.ok) { try { applyFontToDoc(doc, res); } catch (e) { return { ok: false }; } }
                return res;
            });
        }
        _fontPromise = (function () {
            var idx = 0;
            function tryNext() {
                if (idx >= FONT_CANDIDATES.length) return Promise.resolve({ ok: false });
                var f = FONT_CANDIDATES[idx++];
                return fetch(f.url, { mode: 'cors' })
                    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
                    .then(function (buf) {
                        var b64 = bufToBase64(buf);
                        return { ok: true, vfs: f.vfs, name: f.name, b64: b64 };
                    })
                    .catch(function () { return tryNext(); });
            }
            return tryNext();
        })();
        return _fontPromise.then(function (res) {
            if (res && res.ok) { try { applyFontToDoc(doc, res); } catch (e) { return { ok: false }; } }
            return res;
        });
    }

    function applyFontToDoc(doc, res) {
        // addFileToVFS + addFont -> font je k dispozici přes setFont(name)
        doc.addFileToVFS(res.vfs, res.b64);
        doc.addFont(res.vfs, res.name, 'normal');
    }

    // --- čtení dat zakázky -------------------------------------------------------
    function getPoints() {
        try {
            if (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) return persistentCustomPoints;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pdf-protocol:getPoints'); }
        return [];
    }
    function getProjectName() {
        try {
            var id = (typeof activeProjectId !== 'undefined') ? activeProjectId : 'default';
            if (typeof projects !== 'undefined' && Array.isArray(projects)) {
                var p = projects.find(function (x) { return x && x.id === id; });
                if (p && p.name) return p.name;
            }
            return id;
        } catch (e) { return 'zakázka'; }
    }
    function getProjectId() {
        try { return (typeof activeProjectId !== 'undefined') ? activeProjectId : 'body'; } catch (e) { return 'body'; }
    }

    // Příznak Vytyčeno: nejdřív živá globální mapa stakeoutData, jinak z úložiště.
    function getStakeoutMap() {
        try { if (typeof stakeoutData !== 'undefined' && stakeoutData) return stakeoutData; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pdf-protocol:getStakeoutMap'); }
        try {
            if (typeof getStoredData === 'function') {
                var s = getStoredData('arStakeout12');
                if (s) return JSON.parse(s) || {};
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pdf-protocol:getStakeoutMap'); }
        return {};
    }

    // S-JTSK [Y,X] (kladné) z WGS84; vrací null když proj4 chybí / hodnoty nejsou platné.
    function toSJTSK(lat, lng) {
        try {
            if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return null;
            // S-JTSK pres GeoCore (jediny autoritativni prevod, testovany proti PROJ);
            // fallback na vlastni proj4 kvuli odpojitelnosti geo-core.js.
            if (window.GeoCore && GeoCore.toSJTSK) return GeoCore.toSJTSK(lat, lng);
            if (typeof proj4 !== 'function') return null;
            var sj = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]);
            return { y: Math.abs(sj[0]), x: Math.abs(sj[1]) };
        } catch (e) { return null; }
    }

    // Foto-dokumentace bodu -> Promise<dataURL|null> (první fotka jako náhled).
    function getPointThumb(id) {
        try {
            if (typeof loadPointDoc === 'function') {
                return loadPointDoc(id).then(function (doc) {
                    try {
                        if (typeof _normalizeDoc === 'function') _normalizeDoc(doc);
                    } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pdf-protocol:getPointThumb'); }
                    if (doc && Array.isArray(doc.photos) && doc.photos.length) return doc.photos[0];
                    if (doc && doc.photo) return doc.photo; // starý formát
                    return null;
                }).catch(function () { return null; });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'pdf-protocol:getPointThumb'); }
        return Promise.resolve(null);
    }

    // --- generátor PDF -----------------------------------------------------------
    window.openPdfProtocol = function () {
        var pts = getPoints();
        if (!pts.length) {
            alertFail('Není co exportovat', 'Tato zakázka nemá žádné vlastní body.');
            return;
        }

        ensureJsPDF().then(function () {
            var jsPDF = window.jspdf.jsPDF;
            var doc = new jsPDF({ unit: 'mm', format: 'a4' });

            return ensureUnicodeFont(doc).then(function (fontRes) {
                var hasUni = !!(fontRes && fontRes.ok);
                var FONT = hasUni ? fontRes.name : 'helvetica';
                // T(): když máme Unicode font, necháme text být; jinak transliterujeme.
                var T = hasUni ? function (s) { return String(s == null ? '' : s); } : translit;
                function setFont(style) {
                    try {
                        if (hasUni) doc.setFont(FONT, 'normal'); // náš TTF má jen normal
                        else doc.setFont('helvetica', style || 'normal');
                    } catch (e) { try { doc.setFont('helvetica', 'normal'); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'pdf-protocol:setFont'); } }
                }

                // Přednačteme náhledy fotek (async), pak vykreslíme.
                return Promise.all(pts.map(function (p) {
                    return getPointThumb(p && p.id).then(function (thumb) { return { p: p, thumb: thumb }; });
                })).then(function (rows) {
                    renderPdf(doc, rows, { FONT: FONT, T: T, setFont: setFont, hasUni: hasUni });
                    var fname = 'protokol_' + sanitizeFilename(getProjectId()) + '.pdf';
                    // doc.save() uvnitř klikne na <a download> — a ten na iPhonu (PWA
                    // z plochy) často neudělá nic, takže protokol z telefonu nešel
                    // dostat ven. Když je po ruce js/sdilet-soubor.js, jde PDF rovnou
                    // do systémového listu sdílení; jinak zůstává původní doc.save().
                    try {
                        if (typeof window.agShareOrDownload === 'function') {
                            window.agShareOrDownload(doc.output('blob'), fname, 'application/pdf')['catch'](function (e3) {
                                try { alertFail('Export selhal', 'PDF se nepodařilo poslat ven.'); }
                                catch (e4) { window.AG && AG.swallow && AG.swallow(e4, 'pdf-protocol:ven'); }
                            });
                        } else {
                            doc.save(fname);
                        }
                    }
                    catch (e) {
                        // fallback download přes blob
                        try {
                            var blob = doc.output('blob');
                            var url = URL.createObjectURL(blob);
                            var a = document.createElement('a');
                            a.href = url; a.download = fname;
                            document.body.appendChild(a); a.click(); a.remove();
                            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
                        } catch (e2) { alertFail('Export selhal', 'PDF se nepodařilo uložit.'); }
                    }
                });
            });
        }).catch(function (err) {
            console.warn('[pdf-protocol]', err);
            alertFail('PDF se nepodařilo vytvořit', (err && err.message) ? err.message : 'Neznámá chyba při tvorbě PDF.');
        });
    };

    function sanitizeFilename(s) {
        return translit(s).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'body';
    }

    function renderPdf(doc, rows, ctx) {
        var T = ctx.T, setFont = ctx.setFont;
        var PW = doc.internal.pageSize.getWidth();   // 210
        var PH = doc.internal.pageSize.getHeight();  // 297
        var ML = 15, MR = 15;                          // okraje
        var contentW = PW - ML - MR;
        var y = 0;

        var stakeMap = getStakeoutMap();
        var now = new Date();
        var dateStr;
        try { dateStr = now.toLocaleString('cs-CZ'); } catch (e) { dateStr = now.toISOString(); }

        // ---- HLAVIČKA ----
        function drawHeader() {
            y = 16;
            doc.setTextColor(20, 60, 40);
            setFont('bold'); doc.setFontSize(17);
            doc.text(T('Protokol o bodech'), ML, y);
            y += 8;
            doc.setTextColor(40, 40, 40);
            setFont('normal'); doc.setFontSize(11);
            doc.text(T('Zakázka: ' + getProjectName()), ML, y);
            y += 6;
            doc.setFontSize(10); doc.setTextColor(90, 90, 90);
            doc.text(T('Vyhotoveno: ' + dateStr), ML, y);
            doc.text(T('AR Geodet'), PW - MR, y, { align: 'right' });
            y += 4;
            doc.setDrawColor(120, 158, 47); doc.setLineWidth(0.6);
            doc.line(ML, y, PW - MR, y);
            y += 7;
        }

        // sloupce tabulky: Číslo | Y | X | Přesnost | Vytyčeno
        var cols = [
            { key: 'name', title: 'Číslo bodu', w: 42, align: 'left' },
            { key: 'y', title: 'S-JTSK Y [m]', w: 38, align: 'right' },
            { key: 'x', title: 'S-JTSK X [m]', w: 38, align: 'right' },
            { key: 'acc', title: 'Přesnost', w: 28, align: 'right' },
            { key: 'staked', title: 'Vytyčeno', w: contentW - 42 - 38 - 38 - 28, align: 'center' }
        ];

        function colX(i) { var x = ML; for (var j = 0; j < i; j++) x += cols[j].w; return x; }

        function drawTableHead() {
            doc.setFillColor(232, 240, 222);
            doc.setDrawColor(200, 210, 190); doc.setLineWidth(0.2);
            doc.rect(ML, y, contentW, 8, 'FD');
            setFont('bold'); doc.setFontSize(9); doc.setTextColor(40, 60, 40);
            for (var i = 0; i < cols.length; i++) {
                var c = cols[i];
                var cx = colX(i);
                var tx = c.align === 'right' ? cx + c.w - 2 : (c.align === 'center' ? cx + c.w / 2 : cx + 2);
                doc.text(T(c.title), tx, y + 5.4, { align: c.align });
            }
            y += 8;
        }

        function ensureSpace(needed) {
            if (y + needed > PH - 22) { // 22 = rezerva na patičku
                drawFooter();
                doc.addPage();
                drawHeader();
                drawTableHead();
            }
        }

        // ---- PATIČKA (na každé stránce) ----
        function drawFooter() {
            var fy = PH - 14;
            doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
            doc.line(ML, fy - 3, PW - MR, fy - 3);
            setFont('normal'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
            doc.text(T('Podkladová data © ČÚZK. AR Geodet je orientační pomůcka — výstup nenahrazuje úřední geodetické zaměření a ověření.'), ML, fy, { maxWidth: contentW });
            var pageNo = doc.internal.getNumberOfPages();
            doc.text(T('Strana ' + pageNo), PW - MR, fy + 6, { align: 'right' });
        }

        drawHeader();
        drawTableHead();

        // ---- ŘÁDKY TABULKY ----
        setFont('normal'); doc.setFontSize(9);
        var idxNum = 0;
        for (var r = 0; r < rows.length; r++) {
            var p = rows[r].p; if (!p) continue;
            var thumb = rows[r].thumb;
            var sj = toSJTSK(p.lat, p.lng);
            var rec = (p.id != null) ? stakeMap[p.id] : null;
            var staked = !!rec;

            // přesnost: p.acc (zaznamenaná při vložení) má přednost, jinak z vytyčení
            var accVal = null;
            if (typeof p.acc === 'number' && isFinite(p.acc)) accVal = p.acc;
            else if (rec && typeof rec.acc === 'number' && isFinite(rec.acc)) accVal = rec.acc;

            var rowH = thumb ? 24 : 9;
            ensureSpace(rowH);

            // zebra pozadí
            if (idxNum % 2 === 1) {
                doc.setFillColor(247, 249, 244);
                doc.rect(ML, y, contentW, 9, 'F');
            }

            var cells = {
                name: '#' + (p.name == null ? 'Bod' : p.name),
                y: sj ? sj.y.toFixed(2) : '—',
                x: sj ? sj.x.toFixed(2) : '—',
                acc: accVal != null ? '±' + accVal.toFixed(2) + ' m' + (window.AGQc ? window.AGQc.codeSuffix(accVal) : '') : '—',
                staked: staked ? 'ANO' : '—'
            };

            doc.setTextColor(staked ? 16 : 40, staked ? 120 : 40, staked ? 80 : 40);
            for (var i = 0; i < cols.length; i++) {
                var c = cols[i];
                var cx = colX(i);
                var tx = c.align === 'right' ? cx + c.w - 2 : (c.align === 'center' ? cx + c.w / 2 : cx + 2);
                // jen sloupec Vytyčeno barvíme zeleně; ostatní černě
                if (c.key === 'staked' && staked) doc.setTextColor(16, 120, 80);
                else doc.setTextColor(40, 40, 40);
                doc.text(T(String(cells[c.key])), tx, y + 6, { align: c.align });
            }
            y += 9;

            // náhled foto-dokumentace pod řádkem
            if (thumb) {
                var imgW = 26, imgH = 19;
                try {
                    var fmt = /^data:image\/png/i.test(thumb) ? 'PNG' : 'JPEG';
                    doc.addImage(thumb, fmt, ML + 2, y + 1, imgW, imgH);
                    setFont('normal'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
                    doc.text(T('Foto-dokumentace bodu #' + (p.name == null ? '' : p.name)), ML + imgW + 6, y + 8);
                } catch (e) {
                    setFont('normal'); doc.setFontSize(8); doc.setTextColor(150, 150, 150);
                    doc.text(T('(náhled fotky se nepodařilo vložit)'), ML + 2, y + 6);
                    imgH = 6;
                }
                y += imgH + 3;
                doc.setFontSize(9);
            }

            // tenká dělicí linka
            doc.setDrawColor(225, 228, 220); doc.setLineWidth(0.1);
            doc.line(ML, y, PW - MR, y);
            idxNum++;
        }

        // shrnutí pod tabulkou
        ensureSpace(12);
        y += 4;
        setFont('normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
        var stakedCount = 0;
        for (var k = 0; k < rows.length; k++) {
            var pp = rows[k].p; if (pp && pp.id != null && stakeMap[pp.id]) stakedCount++;
        }
        doc.text(T('Počet bodů: ' + rows.length + '   ·   z toho vytyčeno: ' + stakedCount), ML, y);

        drawFooter();
    }

    // --- injekce tlačítka do exportního menu (vzor kml-export.js) ----------------
    function injectPdfButton() {
        var opts = document.querySelector('#manage-modal .exp-opts');
        if (!opts || document.getElementById('ag-export-pdf')) return;
        var btn = document.createElement('button');
        btn.id = 'ag-export-pdf';
        btn.type = 'button';
        // Akce exportu jsou dlaždice v mřížce #exp-actions (.ag-quad) — dřív to byla
        // řada tlačítek přes celou šířku a zabírala moc místa. Když mřížka chybí
        // (starší index.html), zůstane fallback na řádkové tlačítko.
        var quad = opts.querySelector('#exp-actions');
        if (quad) {
            btn.innerHTML = '<svg class="icon"><use href="#i-file-text"/></svg><span>PDF<br>protokol</span>';
            btn.title = 'Exportovat PDF protokol k zakázce';
            btn.addEventListener('click', function () { try { window.openPdfProtocol(); } catch (e) { console.warn(e); } });
            var shareBtn = quad.querySelector('#exp-share-qr');
            if (shareBtn) quad.insertBefore(btn, shareBtn);
            else quad.appendChild(btn);
            return;
        }
        btn.className = 'btn btn-secondary';
        btn.innerHTML = '<svg class="icon"><use href="#i-file-text"/></svg> PDF protokol';
        btn.addEventListener('click', function () { try { window.openPdfProtocol(); } catch (e) { console.warn(e); } });
        var importBtn = opts.querySelector('button.btn-blue');
        if (importBtn) opts.insertBefore(btn, importBtn);
        else opts.appendChild(btn);
    }

    // --- init (DOMContentLoaded + window load druhý průchod) ---------------------
    function init() {
        try { injectPdfButton(); } catch (e) { console.warn('[pdf-protocol] inject', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    window.addEventListener('load', function () { setTimeout(init, 300); });
})();
