// ===== AR Geodet - SDILENI BODU PŘES QR =====
// Bez serveru: kolega zobrazi QR ze svych vlastnich bodu, ja ho naskenuji kamerou
// a body se mi pridaji (read-only kopie — cizi body neprepisuji, jen pridavam).
// Vlastni body = persistentCustomPoints (cat 'CUSTOM'). QR pobere cislo, souradnice, vysku
// a poznamku; fotka ma 80-300 kB, takze se do QR nevejde -> na plne predani (poznamky + fotky)
// slouzi soubor .argeobod. Pouziva vendorovane knihovny: qrcode-generator (gen) a jsQR (scan).
// Modul je samostatny: modaly i styly si vytvari sam, do zbytku kodu saha jen pres globaly.

(function () {
    'use strict';

    const PREFIX = 'AG1';          // hlavicka payloadu (verze formatu)
    let _scanStream = null, _scanRAF = null;

    // ---------- Line nacitani QR knihoven (jsqr ~10k radku + qrcode) ----------
    // Nactou se az pri prvnim pouziti QR, ne pri startu appky. Promise se cachuje,
    // takze opakovane volani nestahuje knihovnu znovu. Offline funguje, protoze
    // oba soubory jsou v cache service workeru.
    const _libCache = {};
    function ensureLib(src) {
        if (_libCache[src]) return _libCache[src];
        _libCache[src] = new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            s.src = src; s.async = true;
            s.onload = function () { resolve(); };
            s.onerror = function () { _libCache[src] = null; reject(new Error('nelze nacist ' + src)); };
            (document.head || document.documentElement).appendChild(s);
        });
        return _libCache[src];
    }

    // ---------- Kodovani / dekodovani ----------
    // Kompaktni format: "AG1\n<jmeno>\t<lat>\t<lng>[\t<vyska>][\t<poznamka>]\n..."
    // (lat/lng na 6 mist ~0,1 m). Sloupce 4 a 5 jsou novejsi rozsireni — starsi verze
    // appky ctou jen prvni tri a zbytek ignoruji, takze kod zustane citelny i pro ne.
    const NOTE_MAX = 90;              // delsi poznamka by uz QR nafoukla nad citelnost
    function clean(s, max) { return String(s == null ? '' : s).replace(/[\t\n\r]/g, ' ').trim().slice(0, max); }

    function encodePoints(pts) {
        const lines = pts.map(p => {
            const cells = [clean(p.name || 'Bod', 40), (+p.lat).toFixed(6), (+p.lng).toFixed(6)];
            const note = clean(p._note, NOTE_MAX);
            const vys = (p.vyska != null && isFinite(p.vyska)) ? (+p.vyska).toFixed(2) : '';
            if (note || vys) cells.push(vys);
            if (note) cells.push(note);
            return cells.join('\t');
        });
        return PREFIX + '\n' + lines.join('\n');
    }
    function decodePoints(txt) {
        if (!txt) return null;
        const rows = txt.replace(/\r/g, '').split('\n');
        if (rows[0] !== PREFIX) return null;
        const out = [];
        for (let i = 1; i < rows.length; i++) {
            if (!rows[i]) continue;
            const c = rows[i].split('\t');
            if (c.length < 3) continue;
            const lat = parseFloat(c[1]), lng = parseFloat(c[2]);
            if (isNaN(lat) || isNaN(lng)) continue;
            const pt = { name: c[0] || 'Bod', lat: lat, lng: lng };
            const v = parseFloat(c[3]); if (!isNaN(v)) pt.vyska = v;
            const note = (c[4] || '').trim(); if (note) pt.note = note;
            out.push(pt);
        }
        return out;
    }

    // ---------- Pridani prijatych bodu (nikdy neprepisuje, jen pridava) ----------
    // Jde pres window.addImportedPoints (logika.js) — jediny spravny vstup vlastnich bodu:
    // resi dedup, provenienci, zurnal a hlavne ULOZENI foto-dokumentace (poznamka + fotky).
    function importDecoded(pts, originLabel) {
        if (typeof window.addImportedPoints !== 'function' || typeof persistentCustomPoints === 'undefined') {
            agInfo('Aplikace ještě není připravená.'); return 0;
        }
        const now = Date.now();
        const arr = pts.map(np => {
            const o = {
                name: np.name, lat: np.lat, lng: np.lng,
                prov: { origin: originLabel || 'qr-sdileni', ts: now, acc: (np.acc != null ? np.acc : null) }
            };
            if (np.vyska != null && isFinite(np.vyska)) o.vyska = np.vyska;
            if (np.acc != null && isFinite(np.acc)) o.acc = np.acc;
            const doc = np.doc || (np.note ? { note: np.note } : null);
            if (doc && (doc.note || (doc.photos && doc.photos.length))) {
                o.doc = { note: doc.note || '', photos: Array.isArray(doc.photos) ? doc.photos.slice(0, 3) : [], t: doc.t || now };
            }
            return o;
        });
        const added = window.addImportedPoints(arr) || 0;
        const skipped = arr.length - added;
        const withDoc = arr.filter(o => o.doc).length;
        const photos = arr.reduce((n, o) => n + (o.doc && o.doc.photos ? o.doc.photos.length : 0), 0);
        let msg = `Přidáno ${added} bodů` + (skipped ? `, ${skipped} přeskočeno (už je máte)` : '');
        if (added && withDoc) msg += ` — včetně poznámek` + (photos ? ` a ${photos} fotek` : '');
        if (typeof quickToast === 'function') quickToast(msg + '.'); else agInfo(msg + '.');
        return added;
    }

    // ---------- Nacteni poznamek/fotek k vybranym bodum ----------
    // Poznamka i fotky nejsou v objektu bodu, ale v samostatnem zaznamu 'doc_<id>'
    // v IndexedDB (viz kalkulacka.js). Nacitaji se tedy asynchronne.
    function loadDocs(pts) {
        if (typeof loadPointDoc !== 'function') return Promise.resolve(pts.map(() => null));
        return Promise.all(pts.map(p => loadPointDoc(p.id).catch(() => null)));
    }

    // ---------- Balicek se vsim vsudy (.argeobod) ----------
    // Fotka ma 80-300 kB, do QR kodu se vejde radove 1 kB — fotky proto pres QR poslat
    // NELZE. Pro plne predani (poznamky + fotky + vysky) slouzi soubor: gzipovany JSON,
    // ktery kolega otevre tlacitkem „Nacist ze souboru" u skenovani QR.
    const PKG_FORMAT = 'argeo-body', PKG_V = 1;
    function gzip(str) {
        if (typeof CompressionStream !== 'function' || typeof Response !== 'function') return Promise.resolve(new Blob([str], { type: 'application/json' }));
        try { return new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).blob(); }
        catch (e) { return Promise.resolve(new Blob([str], { type: 'application/json' })); }
    }
    function readPkgFile(file) {
        // gzip zacina 0x1f 0x8b; nezabaleny fallback je cisty JSON
        return file.arrayBuffer().then(buf => {
            const u = new Uint8Array(buf);
            if (u.length > 2 && u[0] === 0x1f && u[1] === 0x8b && typeof DecompressionStream === 'function') {
                return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
            }
            return new TextDecoder().decode(buf);
        }).then(txt => JSON.parse(txt));
    }
    function buildPkg(pts, docs) {
        return {
            format: PKG_FORMAT, v: PKG_V, app: 'AR Geodet', exportedAt: new Date().toISOString(),
            points: pts.map((p, i) => {
                const o = { name: p.name || 'Bod', lat: +p.lat, lng: +p.lng };
                if (p.vyska != null && isFinite(p.vyska)) o.vyska = +p.vyska;
                if (p.acc != null && isFinite(p.acc)) o.acc = +p.acc;
                if (p.prov) o.prov = p.prov;
                const d = docs[i];
                if (d && (d.note || (d.photos && d.photos.length) || d.photo)) {
                    o.doc = { note: d.note || '', photos: Array.isArray(d.photos) ? d.photos : (d.photo ? [d.photo] : []), t: d.t || Date.now() };
                }
                return o;
            })
        };
    }
    function fmtSize(b) { return b < 1024 ? b + ' B' : (b < 1048576 ? (b / 1024).toFixed(0) + ' kB' : (b / 1048576).toFixed(2) + ' MB'); }

    // ---------- Modal: vytvoreni QR ----------
    function buildShareModal() {
        if (document.getElementById('qr-share-modal')) return;
        const m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = 'qr-share-modal';
        m.innerHTML = `<div class="modal-content" style="max-width:420px;">
            <h3 style="color:var(--accent); margin-top:0;">Sdílet body</h3>
            <div style="font-size:calc(13px * var(--ag-font-scale, 1)); color:var(--text-muted); margin-bottom:10px;">Kolega naskenuje QR kód a vaše vybrané body se mu přidají. <b>Fotky se do QR nevejdou</b> — na ty použijte soubor níže.</div>
            <div id="qr-share-list" class="modal-body" style="max-height:30vh; text-align:left;"></div>
            <label class="filter-row" style="margin-top:8px;"><input type="checkbox" id="qr-share-notes" checked> Přenést i poznámky u bodů</label>
            <button class="btn btn-primary" id="qr-share-gen" style="margin-top:10px;">Vytvořit QR z vybraných</button>
            <div id="qr-share-out" style="text-align:center; margin-top:12px;"></div>
            <div style="border-top:1px solid var(--glass-border); margin-top:14px; padding-top:12px;">
                <div style="font-size:calc(13px * var(--ag-font-scale, 1)); color:var(--text-muted); margin-bottom:8px;">Kompletní předání <b>včetně fotek a výšek</b> — soubor pošlete kolegovi (Messenger, e-mail, WhatsApp…) a on ho načte tlačítkem „Načíst ze souboru".</div>
                <button class="btn btn-secondary" id="qr-share-file" style="margin:0;">Soubor s fotkami a poznámkami</button>
                <div id="qr-share-fout" style="font-size:calc(12px * var(--ag-font-scale, 1)); color:var(--text-muted); margin-top:8px;"></div>
            </div>
            <button class="btn btn-secondary" style="margin-top:14px;" onclick="document.getElementById('qr-share-modal').style.display='none';">Zavřít</button>
        </div>`;
        document.body.appendChild(m);
        m.querySelector('#qr-share-gen').addEventListener('click', generateFromSelection);
        m.querySelector('#qr-share-file').addEventListener('click', sharePackage);
    }

    function selectedPoints() {
        const sel = [];
        document.querySelectorAll('.qr-share-cb').forEach(cb => { if (cb.checked) sel.push(persistentCustomPoints[+cb.dataset.i]); });
        return sel;
    }

    // názvy bodů mohou pocházet z NASKENOVANÉHO cizího QR / importu = nedůvěryhodný vstup →
    // escapovat před vložením do innerHTML (jinak uložené XSS z názvu typu <img onerror=…>).
    function escHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }

    window.openShareQR = function () {
        if (typeof persistentCustomPoints === 'undefined' || !persistentCustomPoints.length) { agInfo('Nemáte žádné vlastní body ke sdílení.'); return; }
        ensureLib('js/lib/qrcode.min.js').catch(function () {});   // predehrat, nez uzivatel klikne na "Vytvorit"
        buildShareModal();
        const list = document.getElementById('qr-share-list');
        list.innerHTML = persistentCustomPoints.map((p, i) =>
            `<label class="filter-row"><input type="checkbox" class="qr-share-cb" data-i="${i}" checked> #${escHtml(p.name || 'Bod')} <span style="color:var(--text-muted); font-size:calc(11px * var(--ag-font-scale, 1));">(${(+p.lat).toFixed(5)}, ${(+p.lng).toFixed(5)})</span></label>`
        ).join('');
        document.getElementById('qr-share-out').innerHTML = '';
        document.getElementById('qr-share-modal').style.display = 'flex';
    };

    function generateFromSelection() {
        const sel = selectedPoints();
        const out = document.getElementById('qr-share-out');
        if (!sel.length) { out.innerHTML = '<span style="color:var(--warning);">Vyberte alespoň jeden bod.</span>'; return; }
        if (typeof qrcode === 'undefined') {
            out.innerHTML = '<span style="color:var(--text-muted);">Načítám knihovnu QR…</span>';
            ensureLib('js/lib/qrcode.min.js').then(generateFromSelection)
                .catch(function () { out.innerHTML = '<span style="color:var(--danger);">Knihovnu QR se nepodařilo načíst.</span>'; });
            return;
        }
        const wantNotes = !!(document.getElementById('qr-share-notes') || {}).checked;
        out.innerHTML = '<span style="color:var(--text-muted);">Připravuji…</span>';
        (wantNotes ? loadDocs(sel) : Promise.resolve(sel.map(() => null))).then(docs => {
            let notes = 0, photosLeft = 0;
            sel.forEach((p, i) => {
                const d = docs[i];
                p._note = (d && d.note) ? d.note : '';
                if (p._note) notes++;
                if (d) photosLeft += (Array.isArray(d.photos) ? d.photos.length : (d.photo ? 1 : 0));
            });
            const payload = encodePoints(sel);
            sel.forEach(p => { delete p._note; });     // pomocne pole nenechavat v bodu
            try {
                if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
                const qr = qrcode(0, 'M');     // 0 = automaticka velikost, M = stredni korekce chyb
                qr.addData(payload, 'Byte');
                qr.make();
                const url = qr.createDataURL(6, 12);
                let sub = `${sel.length} bodů`;
                if (notes) sub += `, ${notes}× poznámka`;
                sub += ' — ukažte kolegovi k naskenování';
                let warn = '';
                if (photosLeft) warn = `<div style="font-size:calc(12px * var(--ag-font-scale, 1)); color:var(--warning); margin-top:6px;">${photosLeft} fotek se přes QR nepřenese — pošlete soubor níže.</div>`;
                out.innerHTML = `<img src="${url}" alt="QR" style="width:100%; max-width:300px; image-rendering:pixelated; background:#fff; border-radius:8px;"><div style="font-size:calc(12px * var(--ag-font-scale, 1)); color:var(--text-muted); margin-top:6px;">${escHtml(sub)}</div>${warn}`;
            } catch (e) {
                out.innerHTML = `<span style="color:var(--danger);">Do jednoho QR kódu se to nevejde (${sel.length} bodů${notes ? ' s poznámkami' : ''}). Vyberte méně bodů, vypněte poznámky, nebo pošlete soubor.</span>`;
            }
        }).catch(function () { out.innerHTML = '<span style="color:var(--danger);">Body se nepodařilo připravit.</span>'; });
    }

    // ---------- Odeslani balicku se vsim (poznamky + fotky) ----------
    function sharePackage() {
        const sel = selectedPoints();
        const out = document.getElementById('qr-share-fout');
        if (!sel.length) { out.innerHTML = '<span style="color:var(--warning);">Vyberte alespoň jeden bod.</span>'; return; }
        out.textContent = 'Balím body, poznámky a fotky…';
        loadDocs(sel).then(docs => {
            const pkg = buildPkg(sel, docs);
            const photos = pkg.points.reduce((n, p) => n + (p.doc ? p.doc.photos.length : 0), 0);
            const notes = pkg.points.filter(p => p.doc && p.doc.note).length;
            return gzip(JSON.stringify(pkg)).then(blob => {
                const d = new Date(), z = n => String(n).padStart(2, '0');
                const fname = 'body_' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + '.argeobod';
                const file = new File([blob], fname, { type: 'application/octet-stream' });
                const info = `${pkg.points.length} bodů, ${notes}× poznámka, ${photos} fotek — ${fmtSize(blob.size)}`;
                if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
                    return navigator.share({ files: [file], title: 'Body — AR Geodet' })
                        .then(function () { out.textContent = 'Odesláno: ' + info; })
                        .catch(function (e) { if (e && e.name === 'AbortError') { out.textContent = ''; return; } download(blob, fname, out, info); });
                }
                download(blob, fname, out, info);
            });
        }).catch(function () { out.innerHTML = '<span style="color:var(--danger);">Soubor se nepodařilo vytvořit.</span>'; });
    }
    function download(blob, fname, out, info) {
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = u; a.download = fname;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
        out.textContent = 'Uloženo do souborů: ' + fname + ' (' + info + ')';
    }

    // ---------- Nacteni balicku od kolegy ----------
    window.openImportPointsFile = function () {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.argeobod,.json,application/json,application/octet-stream';
        inp.addEventListener('change', function () {
            const f = inp.files && inp.files[0]; if (!f) return;
            readPkgFile(f).then(pkg => {
                if (!pkg || pkg.format !== PKG_FORMAT || !Array.isArray(pkg.points) || !pkg.points.length) {
                    agInfo('Tento soubor neobsahuje body z AR Geodet.'); return;
                }
                try { if (typeof closeScanQR === 'function') closeScanQR(); } catch (e) {}
                importDecoded(pkg.points, 'soubor-body');
            }).catch(function () { agInfo('Soubor se nepodařilo přečíst.'); });
        });
        inp.click();
    };

    // ---------- Sdileni APLIKACE pres QR (menu Vice) ----------
    // QR s adresou appky — kolega naskenuje fotakem a otevre se mu appka v prohlizeci.
    // K tomu tlacitka Kopirovat odkaz / systemove Sdilet (navigator.share, kde je).
    function appUrl() {
        try { return location.origin + location.pathname; } catch (e) { return ''; }
    }
    function buildShareAppModal() {
        if (document.getElementById('qr-app-modal')) return;
        const m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = 'qr-app-modal';
        m.innerHTML = `<div class="modal-content" style="max-width:420px; text-align:center;">
            <h3 style="color:var(--accent); margin-top:0;">Sdílet aplikaci</h3>
            <div style="font-size:calc(13px * var(--ag-font-scale, 1)); color:var(--text-muted); margin-bottom:12px;">Kolega naskenuje kód fotoaparátem a AR&nbsp;Geodet se mu otevře. Pak si ho může „Přidat na plochu".</div>
            <div id="qr-app-out" style="min-height:120px;"><span style="color:var(--text-muted);">Vytvářím QR…</span></div>
            <div id="qr-app-url" style="font-size:calc(12px * var(--ag-font-scale, 1)); color:var(--text-muted); margin-top:8px; word-break:break-all; user-select:all;"></div>
            <div style="display:flex; gap:8px; margin-top:12px;">
                <button class="btn btn-secondary" id="qr-app-copy" style="flex:1; margin:0;">Kopírovat odkaz</button>
                <button class="btn btn-primary" id="qr-app-share" style="flex:1; margin:0;">Sdílet…</button>
            </div>
            <button class="btn btn-secondary" style="margin-top:10px;" onclick="document.getElementById('qr-app-modal').style.display='none';">Zavřít</button>
        </div>`;
        document.body.appendChild(m);
        m.querySelector('#qr-app-copy').addEventListener('click', function () {
            const u = appUrl();
            const done = function () { if (typeof quickToast === 'function') quickToast('Odkaz zkopírován.'); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done).catch(function () {});
            else { try { const i = document.createElement('input'); i.value = u; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove(); done(); } catch (e) {} }
        });
        const shareBtn = m.querySelector('#qr-app-share');
        if (navigator.share) shareBtn.addEventListener('click', function () { navigator.share({ title: 'AR Geodet', text: 'Geodetická AR appka — hledání a vytyčování bodů v terénu:', url: appUrl() }).catch(function () {}); });
        else shareBtn.style.display = 'none';
    }
    function renderAppQR() {
        const out = document.getElementById('qr-app-out'); if (!out) return;
        if (typeof qrcode === 'undefined') {
            ensureLib('js/lib/qrcode.min.js').then(renderAppQR)
                .catch(function () { out.innerHTML = '<span style="color:var(--danger);">Knihovnu QR se nepodařilo načíst (offline?). Odkaz níže jde zkopírovat i tak.</span>'; });
            return;
        }
        try {
            const qr = qrcode(0, 'M');
            qr.addData(appUrl());
            qr.make();
            out.innerHTML = `<img src="${qr.createDataURL(6, 12)}" alt="QR" style="width:100%; max-width:260px; image-rendering:pixelated; background:#fff; border-radius:10px; padding:4px;">`;
        } catch (e) { out.innerHTML = '<span style="color:var(--danger);">QR se nepodařilo vytvořit.</span>'; }
    }
    window.openShareApp = function () {
        buildShareAppModal();
        const u = document.getElementById('qr-app-url'); if (u) u.textContent = appUrl();
        document.getElementById('qr-app-modal').style.display = 'flex';
        renderAppQR();
    };

    // ---------- Modal: skenovani QR (obecny — pouziva ho i DGPS na korekce) ----------
    function buildScanModal() {
        if (document.getElementById('qr-scan-modal')) return;
        const m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = 'qr-scan-modal';
        m.innerHTML = `<div class="modal-content" style="max-width:420px;">
            <h3 style="color:var(--accent); margin-top:0;" id="qr-scan-title">Načíst body z QR</h3>
            <div style="font-size:calc(13px * var(--ag-font-scale, 1)); color:var(--text-muted); margin-bottom:10px;" id="qr-scan-hint">Namiřte kameru na QR kód kolegy.</div>
            <video id="qr-scan-video" playsinline muted style="width:100%; border-radius:10px; background:#000;"></video>
            <div id="qr-scan-status" style="text-align:center; font-size:calc(13px * var(--ag-font-scale, 1)); margin-top:8px; color:var(--text-muted);">Spouštím kameru…</div>
            <button class="btn btn-primary" id="qr-scan-file" style="margin-top:12px;" onclick="openImportPointsFile()">Načíst ze souboru (i s fotkami)</button>
            <button class="btn btn-secondary" style="margin-top:8px;" onclick="closeScanQR()">Zrušit</button>
        </div>`;
        document.body.appendChild(m);
    }

    // opts: {title, hint, badMsg, showFile, onData(text) -> true = zpracovano (skener se zavre)}
    function startScan(opts) {
        opts = opts || {};
        if (typeof jsQR === 'undefined') {
            ensureLib('js/lib/jsqr.min.js').then(function () { startScan(opts); })
                .catch(function () { agInfo('Knihovnu pro čtení QR se nepodařilo načíst.'); });
            return;
        }
        buildScanModal();
        const modal = document.getElementById('qr-scan-modal');
        modal.querySelector('#qr-scan-title').textContent = opts.title || 'Načíst z QR';
        modal.querySelector('#qr-scan-hint').textContent = opts.hint || 'Namiřte kameru na QR kód kolegy.';
        modal.querySelector('#qr-scan-file').style.display = opts.showFile ? '' : 'none';
        modal.style.display = 'flex';
        const video = document.getElementById('qr-scan-video');
        const status = document.getElementById('qr-scan-status');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(stream => {
            _scanStream = stream; video.srcObject = stream; video.setAttribute('playsinline', true);
            video.play();
            status.innerText = 'Hledám QR kód…';
            let _lastScanT = 0;
            const tick = () => {
                if (!_scanStream) return;
                // BATERIE: dekódovat KAŽDÝ snímek v plném rozlišení (getImageData + jsQR) je
                // nejteplejší smyčka v appce. ~10 snímků/s a zmenšený obraz najdou kód stejně
                // spolehlivě (QR se drží v záběru déle než 100 ms), ale za zlomek energie.
                const _now = performance.now();
                if (_now - _lastScanT < 100) { _scanRAF = requestAnimationFrame(tick); return; }
                _lastScanT = _now;
                if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
                    const _s = Math.min(1, 640 / video.videoWidth);
                    canvas.width = Math.round(video.videoWidth * _s); canvas.height = Math.round(video.videoHeight * _s);
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                    if (code && code.data) {
                        let handled = false;
                        try { handled = !!opts.onData(code.data); } catch (e) { handled = false; }
                        if (handled) return;
                        status.innerText = opts.badMsg || 'Tento QR kód sem nepatří.';
                    }
                }
                _scanRAF = requestAnimationFrame(tick);
            };
            _scanRAF = requestAnimationFrame(tick);
        }).catch(err => { status.innerHTML = '<span style="color:var(--danger);">Kameru nelze spustit: ' + (err && err.message ? err.message : err) + '</span>'; });
    }

    window.openScanQR = function () {
        startScan({
            title: 'Načíst body z QR',
            hint: 'Namiřte kameru na QR kód kolegy.',
            badMsg: 'Tento QR neobsahuje body AR Geodet.',
            showFile: true,
            onData: function (txt) {
                const pts = decodePoints(txt);
                if (!pts || !pts.length) return false;
                closeScanQR(); importDecoded(pts); return true;
            }
        });
    };

    // ---------- Obecne QR API pro ostatni moduly ----------
    function qrDataURL(text, cell) {
        if (typeof qrcode === 'undefined') return null;
        if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
        const qr = qrcode(0, 'M');
        qr.addData(text, 'Byte');
        qr.make();
        return qr.createDataURL(cell || 6, 12);
    }
    window.AGQR = {
        ensureGen: function () { return ensureLib('js/lib/qrcode.min.js'); },
        dataURL: qrDataURL,
        scan: startScan,
        closeScan: function () { window.closeScanQR(); }
    };

    // Sdilene API — firma-chat posila body uplne stejnym formatem, at se to nerozjede.
    window.AGShare = { encode: encodePoints, decode: decodePoints, importPoints: importDecoded, loadDocs: loadDocs };

    window.closeScanQR = function () {
        if (_scanRAF) { cancelAnimationFrame(_scanRAF); _scanRAF = null; }
        if (_scanStream) { _scanStream.getTracks().forEach(t => t.stop()); _scanStream = null; }
        const m = document.getElementById('qr-scan-modal'); if (m) m.style.display = 'none';
    };
})();
