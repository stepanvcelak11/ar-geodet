// ===== AR Geodet - SDILENI BODU PŘES QR =====
// Bez serveru: kolega zobrazi QR ze svych vlastnich bodu, ja ho naskenuji kamerou
// a body se mi pridaji (read-only kopie — cizi body neprepisuji, jen pridavam).
// Vlastni body = persistentCustomPoints (cat 'CUSTOM'). Foto se do QR nevejde -> prenasi se
// jen cislo + souradnice. Pouziva vendorovane knihovny: qrcode-generator (gen) a jsQR (scan).
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
    // Kompaktni format: "AG1\n<jmeno>\t<lat>\t<lng>\n..." (lat/lng na 6 mist ~0,1 m).
    function encodePoints(pts) {
        const lines = pts.map(p => {
            const name = String(p.name || 'Bod').replace(/[\t\n\r]/g, ' ').slice(0, 40);
            return name + '\t' + (+p.lat).toFixed(6) + '\t' + (+p.lng).toFixed(6);
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
            out.push({ name: c[0] || 'Bod', lat: lat, lng: lng });
        }
        return out;
    }

    // ---------- Pridani naskenovanych bodu (nikdy neprepisuje, jen pridava) ----------
    function importDecoded(pts) {
        if (typeof persistentCustomPoints === 'undefined') { alert('Aplikace ještě není připravená.'); return; }
        let added = 0, skipped = 0;
        pts.forEach(np => {
            // duplicita = stejne jmeno a poloha do ~0,5 m -> nepridavat znovu
            const dup = persistentCustomPoints.some(ep => ep.name === np.name &&
                (typeof getDistance === 'function' ? getDistance(ep.lat, ep.lng, np.lat, np.lng) < 0.5
                    : Math.abs(ep.lat - np.lat) < 1e-5 && Math.abs(ep.lng - np.lng) < 1e-5));
            if (dup) { skipped++; return; }
            const pt = { id: 'cp_' + Date.now() + '_' + Math.round(Math.random() * 1e6), name: np.name, lat: np.lat, lng: np.lng, cat: 'CUSTOM', type: 'custom', shared: true };
            persistentCustomPoints.push(pt);
            if (typeof arPoints !== 'undefined') arPoints.push({ ...pt, hidden: false });
            added++;
        });
        if (added) {
            try { setStoredData('arCustomPoints12', JSON.stringify(persistentCustomPoints)); } catch (e) {}
            try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) {}
            try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) {}
            try { if (typeof updateInfoPanel === 'function') updateInfoPanel(); } catch (e) {}
        }
        const msg = `Přidáno ${added} bodů` + (skipped ? `, ${skipped} přeskočeno (už je máte)` : '') + '.';
        if (typeof quickToast === 'function') quickToast(msg); else alert(msg);
    }

    // ---------- Modal: vytvoreni QR ----------
    function buildShareModal() {
        if (document.getElementById('qr-share-modal')) return;
        const m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = 'qr-share-modal';
        m.innerHTML = `<div class="modal-content" style="max-width:420px;">
            <h3 style="color:var(--accent); margin-top:0;">Sdílet body přes QR</h3>
            <div style="font-size:13px; color:var(--text-dim); margin-bottom:10px;">Kolega naskenuje tento kód a vaše vybrané body se mu přidají. Foto se nepřenáší.</div>
            <div id="qr-share-list" class="modal-body" style="max-height:30vh; text-align:left;"></div>
            <button class="btn btn-primary" id="qr-share-gen" style="margin-top:10px;">Vytvořit QR z vybraných</button>
            <div id="qr-share-out" style="text-align:center; margin-top:12px;"></div>
            <button class="btn btn-secondary" style="margin-top:14px;" onclick="document.getElementById('qr-share-modal').style.display='none';">Zavřít</button>
        </div>`;
        document.body.appendChild(m);
        m.querySelector('#qr-share-gen').addEventListener('click', generateFromSelection);
    }

    // názvy bodů mohou pocházet z NASKENOVANÉHO cizího QR / importu = nedůvěryhodný vstup →
    // escapovat před vložením do innerHTML (jinak uložené XSS z názvu typu <img onerror=…>).
    function escHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }

    window.openShareQR = function () {
        if (typeof persistentCustomPoints === 'undefined' || !persistentCustomPoints.length) { alert('Nemáte žádné vlastní body ke sdílení.'); return; }
        ensureLib('js/lib/qrcode.min.js').catch(function () {});   // predehrat, nez uzivatel klikne na "Vytvorit"
        buildShareModal();
        const list = document.getElementById('qr-share-list');
        list.innerHTML = persistentCustomPoints.map((p, i) =>
            `<label class="filter-row"><input type="checkbox" class="qr-share-cb" data-i="${i}" checked> #${escHtml(p.name || 'Bod')} <span style="color:var(--text-muted); font-size:11px;">(${(+p.lat).toFixed(5)}, ${(+p.lng).toFixed(5)})</span></label>`
        ).join('');
        document.getElementById('qr-share-out').innerHTML = '';
        document.getElementById('qr-share-modal').style.display = 'flex';
    };

    function generateFromSelection() {
        const cbs = document.querySelectorAll('.qr-share-cb');
        const sel = [];
        cbs.forEach(cb => { if (cb.checked) sel.push(persistentCustomPoints[+cb.dataset.i]); });
        const out = document.getElementById('qr-share-out');
        if (!sel.length) { out.innerHTML = '<span style="color:var(--warning);">Vyberte alespoň jeden bod.</span>'; return; }
        if (typeof qrcode === 'undefined') {
            out.innerHTML = '<span style="color:var(--text-dim);">Načítám knihovnu QR…</span>';
            ensureLib('js/lib/qrcode.min.js').then(generateFromSelection)
                .catch(function () { out.innerHTML = '<span style="color:var(--danger);">Knihovnu QR se nepodařilo načíst.</span>'; });
            return;
        }
        const payload = encodePoints(sel);
        try {
            if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
            const qr = qrcode(0, 'M');     // 0 = automaticka velikost, M = stredni korekce chyb
            qr.addData(payload, 'Byte');
            qr.make();
            const url = qr.createDataURL(6, 12);
            out.innerHTML = `<img src="${url}" alt="QR" style="width:100%; max-width:300px; image-rendering:pixelated; background:#fff; border-radius:8px;"><div style="font-size:12px; color:var(--text-dim); margin-top:6px;">${sel.length} bodů — ukažte kolegovi k naskenování</div>`;
        } catch (e) {
            out.innerHTML = `<span style="color:var(--danger);">Příliš mnoho bodů pro jeden QR kód (${sel.length}). Vyberte méně bodů, nebo použijte Export souboru.</span>`;
        }
    }

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
            <div style="font-size:13px; color:var(--text-dim); margin-bottom:12px;">Kolega naskenuje kód fotoaparátem a AR&nbsp;Geodet se mu otevře. Pak si ho může „Přidat na plochu".</div>
            <div id="qr-app-out" style="min-height:120px;"><span style="color:var(--text-dim);">Vytvářím QR…</span></div>
            <div id="qr-app-url" style="font-size:12px; color:var(--text-muted); margin-top:8px; word-break:break-all; user-select:all;"></div>
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

    // ---------- Modal: skenovani QR ----------
    function buildScanModal() {
        if (document.getElementById('qr-scan-modal')) return;
        const m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = 'qr-scan-modal';
        m.innerHTML = `<div class="modal-content" style="max-width:420px;">
            <h3 style="color:var(--accent); margin-top:0;">Načíst body z QR</h3>
            <div style="font-size:13px; color:var(--text-dim); margin-bottom:10px;">Namiřte kameru na QR kód kolegy.</div>
            <video id="qr-scan-video" playsinline muted style="width:100%; border-radius:10px; background:#000;"></video>
            <div id="qr-scan-status" style="text-align:center; font-size:13px; margin-top:8px; color:var(--text-dim);">Spouštím kameru…</div>
            <button class="btn btn-secondary" style="margin-top:14px;" onclick="closeScanQR()">Zrušit</button>
        </div>`;
        document.body.appendChild(m);
    }

    window.openScanQR = function () {
        if (typeof jsQR === 'undefined') {
            ensureLib('js/lib/jsqr.min.js').then(window.openScanQR)
                .catch(function () { alert('Knihovnu pro čtení QR se nepodařilo načíst.'); });
            return;
        }
        buildScanModal();
        document.getElementById('qr-scan-modal').style.display = 'flex';
        const video = document.getElementById('qr-scan-video');
        const status = document.getElementById('qr-scan-status');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(stream => {
            _scanStream = stream; video.srcObject = stream; video.setAttribute('playsinline', true);
            video.play();
            status.innerText = 'Hledám QR kód…';
            const tick = () => {
                if (!_scanStream) return;
                if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
                    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                    if (code && code.data) {
                        const pts = decodePoints(code.data);
                        if (pts && pts.length) { closeScanQR(); importDecoded(pts); return; }
                        else { status.innerText = 'Tento QR neobsahuje body AR Geodet.'; }
                    }
                }
                _scanRAF = requestAnimationFrame(tick);
            };
            _scanRAF = requestAnimationFrame(tick);
        }).catch(err => { status.innerHTML = '<span style="color:var(--danger);">Kameru nelze spustit: ' + (err && err.message ? err.message : err) + '</span>'; });
    };

    window.closeScanQR = function () {
        if (_scanRAF) { cancelAnimationFrame(_scanRAF); _scanRAF = null; }
        if (_scanStream) { _scanStream.getTracks().forEach(t => t.stop()); _scanStream = null; }
        const m = document.getElementById('qr-scan-modal'); if (m) m.style.display = 'none';
    };
})();
