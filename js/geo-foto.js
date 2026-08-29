// ===== AR Geodet — GEO-FOTKA: fotodokumentace s vypáleným razítkem (ODPOJITELNÁ) =
// PROČ: geodet fotí stav bodu, výkop, poškozený mezník nebo hotovou vrstvu — a v
// kanceláři pak u fotky nikdo neví, KDE a KDY vznikla. EXIF se při přeposlání přes
// WhatsApp, mail nebo Teams zahodí, takže „metadata ve fotce" jsou v praxi iluze.
// Tenhle nástroj razítko VYPÁLÍ do pixelů: zakázka, S-JTSK, výška Bpv, datum a čas,
// azimut pohledu a přesnost GPS. Takovou fotku už nejde „ztratit v poště".
//
// AZIMUT SE BERE V OKAMŽIKU SPOUŠTĚ — proto vlastní hledáček:
// kdyby se fotilo systémovou kamerou (input capture), appka by se dozvěděla až
// výsledek a směr pohledu by musela hádat z kompasu o pár sekund později, kdy už
// telefon míří jinam. Vlastní hledáček fotí přesně to, co je vidět, a razítko
// popisuje TENHLE snímek. Pokud v appce zrovna běží AR, POUŽIJE SE JEJÍ STREAM —
// druhý souběžný getUserMedia iOS často odmítne nebo jím škubne kamera v AR.
//
// CO RAZÍTKO NEDOKAZUJE (a proto se to píše i v návodu): vypálené pixely umí
// kdokoli v editoru přemalovat. Když má fotka něco dokládat, je pod tím ještě
// ŘETĚZ OTISKŮ: u každé fotky se spočítá SHA-256 hotového JPEG a uloží se spolu s
// otiskem předchozí fotky (do obrazu se vypaluje zkrácený otisk předchůdce).
// Vyměněná nebo dodatečně upravená fotka řetěz rozbije a tlačítko „Ověřit řetěz"
// to ukáže. Není to elektronický podpis — je to důkaz, že sada nebyla po pořízení
// zamíchaná. Nic se neposílá na server, ověřuje se offline v telefonu.
//
// PROTOKOL: „Uložit PDF" otevře tiskové okno (stejný způsob jako Deník dne a
// Závady — funguje offline, na rozdíl od jsPDF z CDN) s fotkami dne, tabulkou
// souřadnic a výpisem otisků.
//
// NEEDITUJE logika.js ani grafika.js. Čte jen globály přes typeof (userLat, userLng,
// userAlt, currentGpsAccuracy, currentHeading, persistentCustomPoints, projects,
// getGeoidUndulation, GeoCore) a oficiální window.addImportedPoints / savePointDoc.
// Odstranění: smaž js/geo-foto.js + jeho řádek <script> v index.html a přegeneruj
// sw.js. Fotky v IndexedDB ničemu nevadí (smažou se s daty webu).
// ================================================================================
(function () {
    'use strict';
    if (window.__agGeoFotoInit) return;
    window.__agGeoFotoInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H8l1.2-2h5.6L16 6h2.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.4"/><path d="M12 8.4v1.2M12 16.4v1.2M7.4 13h1.2M15.4 13h1.2"/></svg>';
    var STYLE_ID = 'ag-gf-style';
    var DB_NAME = 'agGeoFoto1';
    var STORE = 'foto';
    var NEAR_M = 25;                 // do kolika metrů se fotka váže k bodu
    var MAX_W = 1600;                // delší strana uloženého snímku (px)
    var JPEG_Q = 0.82;

    var _db = null;
    var _stream = null;              // vlastní stream (jen když neběží AR)
    var _usingAr = false;            // hledáček jede na streamu z AR
    var _shooting = false;
    var _filter = '';
    var _day = null;                 // null = vše, jinak 'YYYY-MM-DD'

    // ---- pomocné ------------------------------------------------------------------
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function projName() {
        var id = pid();
        try {
            if (typeof projects !== 'undefined' && Array.isArray(projects)) {
                for (var i = 0; i < projects.length; i++) { if (projects[i] && projects[i].id === id) return projects[i].name || id; }
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:projName'); }
        return (id === 'default') ? 'Výchozí zakázka' : id;
    }
    function userName() {
        try { var u = window.AGUcty && AGUcty.currentUser && AGUcty.currentUser(); if (u && u.name) return u.name; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:userName'); }
        return '';
    }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:toast'); } }
    function fail(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert(t, m); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:fail'); } toast(m); }
    function fmtT(ts) { try { return new Date(ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
    function fmtDT(ts) { var d = new Date(ts); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    var DAYS_CS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
    function fmtDay(ts) { var d = new Date(ts); return DAYS_CS[d.getDay()] + ' ' + d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear(); }
    function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function fmtNum(v) { return v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function toSJTSK(lat, lng) {
        try { if (window.GeoCore && GeoCore.toSJTSK) return GeoCore.toSJTSK(lat, lng); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:toSJTSK'); }
        try { if (typeof proj4 === 'function') { var c = proj4('EPSG:4326', 'EPSG:5514', [lng, lat]); return { y: Math.abs(c[0]), x: Math.abs(c[1]) }; } } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'geo-foto:toSJTSK'); }
        return null;
    }
    function dist(la1, lo1, la2, lo2) {
        try { if (typeof getDistance === 'function') return getDistance(la1, lo1, la2, lo2); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:dist'); }
        var R = 6371000, r = Math.PI / 180;
        var a = Math.sin((la2 - la1) * r / 2), b = Math.sin((lo2 - lo1) * r / 2);
        var h = a * a + Math.cos(la1 * r) * Math.cos(la2 * r) * b * b;
        return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    function nearestPoint(lat, lng) {
        try {
            if (lat == null || typeof persistentCustomPoints === 'undefined' || !Array.isArray(persistentCustomPoints)) return null;
            var best = null;
            persistentCustomPoints.forEach(function (p) {
                if (!p || p.lat == null || p.lng == null) return;
                var d = dist(lat, lng, p.lat, p.lng);
                if (d <= NEAR_M && (!best || d < best.d)) best = { id: p.id, name: p.name || p.id, d: d };
            });
            return best;
        } catch (e) { return null; }
    }
    // stav v okamžiku spouště — sbírá se JEDNOU, ať razítko a záznam nemůžou rozejít
    function grabState() {
        var s = { ts: Date.now(), lat: null, lng: null, acc: null, bpv: null, az: null };
        try {
            if (typeof userLat !== 'undefined' && userLat != null) {
                s.lat = userLat; s.lng = userLng;
                if (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy != null) s.acc = currentGpsAccuracy;
                if (typeof userAlt !== 'undefined' && userAlt != null && isFinite(userAlt)) {
                    var und = 0;
                    try { if (typeof getGeoidUndulation === 'function') und = getGeoidUndulation(s.lat, s.lng) || 0; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:grabState'); }
                    s.bpv = userAlt - und;
                }
            }
        } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'geo-foto:grabState'); }
        try { if (typeof currentHeading === 'number' && isFinite(currentHeading)) s.az = (currentHeading % 360 + 360) % 360; } catch (e3) { window.AG && AG.swallow && AG.swallow(e3, 'geo-foto:grabState'); }
        return s;
    }

    // ---- IndexedDB -----------------------------------------------------------------
    function db() {
        if (_db) return Promise.resolve(_db);
        return new Promise(function (res, rej) {
            var rq = indexedDB.open(DB_NAME, 1);
            rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE, { keyPath: 'id' }); };
            rq.onsuccess = function () { _db = rq.result; res(_db); };
            rq.onerror = function () { rej(rq.error); };
        });
    }
    function dbAll() {
        return db().then(function (d) {
            return new Promise(function (res, rej) {
                var rq = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
                rq.onsuccess = function () { res(rq.result || []); };
                rq.onerror = function () { rej(rq.error); };
            });
        });
    }
    function dbPut(rec) {
        return db().then(function (d) {
            return new Promise(function (res, rej) {
                var tx = d.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(rec);
                tx.oncomplete = function () { res(); };
                tx.onerror = function () { rej(tx.error); };
            });
        });
    }
    function dbDel(id) {
        return db().then(function (d) {
            return new Promise(function (res, rej) {
                var tx = d.transaction(STORE, 'readwrite');
                tx.objectStore(STORE)['delete'](id);
                tx.oncomplete = function () { res(); };
                tx.onerror = function () { rej(tx.error); };
            });
        });
    }

    // ---- otisk (SHA-256) --------------------------------------------------------------
    // Řetěz drží pořadí: každý záznam nese otisk svého předchůdce v RÁMCI ZAKÁZKY.
    // Když někdo fotku vymění nebo vloží jinou doprostřed, otisky přestanou navazovat.
    function sha256Hex(buf) {
        try {
            if (!(window.crypto && crypto.subtle)) return Promise.resolve(null);
            return crypto.subtle.digest('SHA-256', buf).then(function (d) {
                var a = new Uint8Array(d), s = '';
                for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
                return s;
            })['catch'](function () { return null; });
        } catch (e) { return Promise.resolve(null); }
    }
    function blobHash(blob) {
        try { return blob.arrayBuffer().then(sha256Hex)['catch'](function () { return null; }); }
        catch (e) { return Promise.resolve(null); }
    }
    function short(h) { return h ? h.slice(0, 8) : '—'; }

    // ---- vypálení razítka --------------------------------------------------------------
    // Kreslí se do dolního pásu. Písmo se škáluje podle šířky snímku, aby razítko bylo
    // čitelné i po zmenšení do mailu — na malém náhledu je nečitelné razítko k ničemu.
    function stampLines(st, near, note) {
        var l1 = projName() + (near ? '  ·  u bodu ' + near.name + ' (' + Math.round(near.d) + ' m)' : '');
        var sj = (st.lat != null) ? toSJTSK(st.lat, st.lng) : null;
        var l2;
        if (sj) l2 = 'Y ' + fmtNum(sj.y) + '   X ' + fmtNum(sj.x) + (st.bpv != null ? '   Bpv ' + st.bpv.toFixed(1) + ' m' : '');
        else if (st.lat != null) l2 = st.lat.toFixed(6) + ', ' + st.lng.toFixed(6) + ' (WGS84)';
        else l2 = 'poloha nedostupná — GPS nemá fix';
        var l3 = fmtDT(st.ts)
            + '   ·   azimut ' + (st.az != null ? Math.round(st.az) + '°' : 'neurčen')
            + (st.acc != null ? '   ·   GPS ±' + Math.round(st.acc) + ' m' : '');
        var un = userName();
        if (un) l3 += '   ·   ' + un;
        var out = [l1, l2, l3];
        if (note) out.push(note);
        return out;
    }
    function drawStamp(cv, lines, prevHash) {
        var ctx = cv.getContext('2d');
        var W = cv.width, H = cv.height;
        var fs = Math.max(13, Math.round(W / 46));          // velikost písma
        var lh = Math.round(fs * 1.42);
        var padX = Math.round(fs * 0.85), padY = Math.round(fs * 0.7);
        var bandH = lines.length * lh + padY * 2 + Math.round(fs * 0.9);
        var y0 = H - bandH;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(0, y0, W, bandH);
        ctx.fillStyle = 'rgba(47,158,116,0.95)';
        ctx.fillRect(0, y0, W, Math.max(2, Math.round(fs / 7)));

        ctx.textBaseline = 'top';
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 ' + fs + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
        var y = y0 + padY + Math.round(fs * 0.5);
        for (var i = 0; i < lines.length; i++) {
            if (i === 1) ctx.font = '700 ' + Math.round(fs * 1.1) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
            else if (i === 2) { ctx.font = '500 ' + Math.round(fs * 0.92) + 'px -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.86)'; }
            else if (i === 3) { ctx.font = 'italic 500 ' + Math.round(fs * 0.92) + 'px -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.8)'; }
            ctx.fillText(lines[i], padX, y);
            y += lh;
        }
        // patička pásu: původ snímku + navázání na předchozí fotku (řetěz otisků)
        ctx.font = '500 ' + Math.round(fs * 0.72) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        var foot = 'AR Geodet · razítko vypáleno při pořízení' + (prevHash ? '  ·  navazuje na ' + short(prevHash) : '  ·  první snímek zakázky');
        ctx.fillText(foot, padX, H - Math.round(fs * 1.15));
        ctx.restore();
    }

    // ---- hledáček ------------------------------------------------------------------------
    // Stream z AR se JEN půjčuje (nezastavuje se!) — kdybychom ho zavřeli, zhasla by
    // kamera pod celou AR vrstvou. Vlastní stream se naopak zavírá vždy.
    function arStream() {
        try {
            var v = document.getElementById('camera-feed');
            if (v && v.srcObject && v.readyState >= 2 && v.videoWidth > 0) return v.srcObject;
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:arStream'); }
        return null;
    }
    function stopStream() {
        if (_stream) {
            try { _stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:stopStream'); }
            _stream = null;
        }
        _usingAr = false;
        var v = document.getElementById('ag-gf-video');
        if (v) { try { v.pause(); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'geo-foto:stopStream'); } v.srcObject = null; }
    }
    function openView() {
        var ov = ensureViewer();
        ov.style.display = 'flex';
        var v = document.getElementById('ag-gf-video');
        var s = arStream();
        if (s) {
            _usingAr = true;
            v.srcObject = s;
            v.play()['catch'](function () {});
            setViewNote('Fotí se přes kameru, kterou už drží AR.');
            tickView();
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            closeView();
            fallbackFile();
            return;
        }
        setViewNote('Zapínám kameru…');
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } }).then(function (st) {
            if (ov.style.display === 'none') { try { st.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:openView'); } return; }
            _stream = st; _usingAr = false;
            v.srcObject = st;
            v.play()['catch'](function () {});
            setViewNote('');
            tickView();
        })['catch'](function () {
            closeView();
            fallbackFile();
        });
    }
    function closeView() {
        var ov = document.getElementById('ag-gf-view');
        if (ov) ov.style.display = 'none';
        stopStream();
    }
    function setViewNote(t) {
        var el = document.getElementById('ag-gf-vnote');
        if (el) { el.textContent = t || ''; el.style.display = t ? 'block' : 'none'; }
    }
    // živý náhled toho, co se vypálí — ať uživatel VIDÍ, že azimut chybí, než zmáčkne
    function tickView() {
        var ov = document.getElementById('ag-gf-view');
        if (!ov || ov.style.display === 'none') return;
        var st = grabState();
        var box = document.getElementById('ag-gf-vinfo');
        if (box) {
            var sj = (st.lat != null) ? toSJTSK(st.lat, st.lng) : null;
            box.innerHTML = '<b>' + esc(projName()) + '</b><br>'
                + (sj ? 'Y ' + esc(fmtNum(sj.y)) + ' · X ' + esc(fmtNum(sj.x)) + (st.bpv != null ? ' · Bpv ' + st.bpv.toFixed(1) + ' m' : '')
                    : (st.lat != null ? esc(st.lat.toFixed(6) + ', ' + st.lng.toFixed(6)) : '<span class="warn">poloha nedostupná</span>'))
                + '<br>azimut ' + (st.az != null ? Math.round(st.az) + '°' : '<span class="warn">neurčen</span>')
                + (st.acc != null ? ' · GPS ±' + Math.round(st.acc) + ' m' : '');
        }
        setTimeout(tickView, 900);
    }

    // ---- pořízení snímku -------------------------------------------------------------------
    function shoot() {
        if (_shooting) return;
        var v = document.getElementById('ag-gf-video');
        if (!v || !v.videoWidth) { toast('Kamera ještě nenaběhla — vteřinku.'); return; }
        _shooting = true;
        var st = grabState();
        var near = (st.lat != null) ? nearestPoint(st.lat, st.lng) : null;
        var note = (document.getElementById('ag-gf-vnotein') || {}).value || '';
        note = String(note).trim().slice(0, 120);

        var w = v.videoWidth, h = v.videoHeight;
        if (Math.max(w, h) > MAX_W) {
            var k = MAX_W / Math.max(w, h);
            w = Math.round(w * k); h = Math.round(h * k);
        }
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        try { cv.getContext('2d').drawImage(v, 0, 0, w, h); }
        catch (e) { _shooting = false; fail('Snímek se nepovedl', 'Kameru se nepodařilo přečíst.'); return; }

        // otisk předchozí fotky ZAKÁZKY musí být znám dřív, než se pás vykreslí
        dbAll().then(function (all) {
            var mine = all.filter(function (r) { return r && r.pid === pid(); }).sort(function (a, b) { return a.ts - b.ts; });
            var prev = mine.length ? mine[mine.length - 1] : null;
            var prevHash = prev ? (prev.hash || null) : null;
            drawStamp(cv, stampLines(st, near, note), prevHash);
            cv.toBlob(function (blob) {
                if (!blob) { _shooting = false; fail('Snímek se nepovedl', 'Obrázek se nepodařilo zakódovat.'); return; }
                blobHash(blob).then(function (hash) {
                    var rec = {
                        id: 'gf_' + st.ts + '_' + Math.random().toString(36).slice(2, 7),
                        pid: pid(), ts: st.ts, lat: st.lat, lng: st.lng, acc: st.acc, bpv: st.bpv, az: st.az,
                        ptId: near ? near.id : null, ptName: near ? near.name : null, ptDist: near ? Math.round(near.d) : null,
                        note: note, user: userName(), w: cv.width, h: cv.height,
                        mime: 'image/jpeg', blob: blob, hash: hash, prev: prevHash
                    };
                    dbPut(rec).then(function () {
                        _shooting = false;
                        try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:shoot'); }
                        flash();
                        toast('Fotka uložena' + (near ? ' (u bodu ' + near.name + ')' : '') + '.');
                        var ni = document.getElementById('ag-gf-vnotein'); if (ni) ni.value = '';
                        renderList();
                    }, function () { _shooting = false; fail('Uložení se nepovedlo', 'IndexedDB odmítla zápis — může být plná paměť zařízení.'); });
                });
            }, 'image/jpeg', JPEG_Q);
        }, function () { _shooting = false; fail('Uložení se nepovedlo', 'Nepodařilo se otevřít úložiště fotek.'); });
    }
    function flash() {
        var ov = document.getElementById('ag-gf-view'); if (!ov) return;
        var f = document.createElement('div');
        f.className = 'ag-gf-flash';
        ov.appendChild(f);
        setTimeout(function () { try { f.remove(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:flash'); } }, 260);
    }

    // Nouzová cesta: prohlížeč nedá kameru (odmítnuté povolení, desktop bez kamery).
    // Azimut se pak ZÁMĚRNĚ neukládá — kompas v době stisku spouště v systémové
    // aplikaci neznáme a vymyšlený směr je horší než přiznané „neurčen".
    function fallbackFile() {
        var inp = document.getElementById('ag-gf-file');
        if (!inp) return;
        toast('Vlastní hledáček nejde spustit — fotí se systémovou kamerou (bez azimutu).');
        inp.click();
    }
    function onFile(ev) {
        var f = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!f) return;
        var st = grabState();
        st.az = null;                                   // viz fallbackFile()
        var near = (st.lat != null) ? nearestPoint(st.lat, st.lng) : null;
        var img = new Image();
        var url = URL.createObjectURL(f);
        img.onload = function () {
            try { URL.revokeObjectURL(url); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:onload'); }
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (Math.max(w, h) > MAX_W) { var k = MAX_W / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
            var cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(img, 0, 0, w, h);
            dbAll().then(function (all) {
                var mine = all.filter(function (r) { return r && r.pid === pid(); }).sort(function (a, b) { return a.ts - b.ts; });
                var prevHash = mine.length ? (mine[mine.length - 1].hash || null) : null;
                drawStamp(cv, stampLines(st, near, ''), prevHash);
                cv.toBlob(function (blob) {
                    if (!blob) { fail('Snímek se nepovedl', 'Obrázek se nepodařilo zakódovat.'); return; }
                    blobHash(blob).then(function (hash) {
                        dbPut({
                            id: 'gf_' + st.ts + '_' + Math.random().toString(36).slice(2, 7),
                            pid: pid(), ts: st.ts, lat: st.lat, lng: st.lng, acc: st.acc, bpv: st.bpv, az: null,
                            ptId: near ? near.id : null, ptName: near ? near.name : null, ptDist: near ? Math.round(near.d) : null,
                            note: '', user: userName(), w: cv.width, h: cv.height,
                            mime: 'image/jpeg', blob: blob, hash: hash, prev: prevHash
                        }).then(function () { toast('Fotka uložena (bez azimutu).'); renderList(); },
                            function () { fail('Uložení se nepovedlo', 'IndexedDB odmítla zápis.'); });
                    });
                }, 'image/jpeg', JPEG_Q);
            });
        };
        img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:onerror'); } toast('Soubor není platný obrázek.'); };
        img.src = url;
    }

    // ---- ověření řetězu ---------------------------------------------------------------------
    // Přepočítá otisk každé uložené fotky a porovná ho s tím, co je u ní zapsané, plus
    // zkontroluje, že prev navazuje na předchozí záznam. Běží offline nad IndexedDB.
    function verifyChain() {
        toast('Ověřuji…');
        dbAll().then(function (all) {
            var mine = all.filter(function (r) { return r && r.pid === pid(); }).sort(function (a, b) { return a.ts - b.ts; });
            if (!mine.length) { fail('Není co ověřovat', 'V téhle zakázce zatím žádná fotka není.'); return; }
            var i = 0, bad = [], noHash = 0;
            function step() {
                if (i >= mine.length) { report(); return; }
                var r = mine[i];
                if (!r.hash) { noHash++; i++; step(); return; }
                blobHash(r.blob).then(function (h) {
                    if (h && h !== r.hash) bad.push({ r: r, why: 'obsah fotky neodpovídá uloženému otisku' });
                    else {
                        var expect = i > 0 ? (mine[i - 1].hash || null) : null;
                        if ((r.prev || null) !== expect) bad.push({ r: r, why: 'navazuje na jiný snímek, než který je před ní' });
                    }
                    i++; step();
                });
            }
            function report() {
                var head = 'Zakázka: ' + esc(projName()) + '<br>Ověřeno snímků: <b>' + (mine.length - noHash) + '</b> z ' + mine.length
                    + (noHash ? '<br><span style="color:#fbbf24;">' + noHash + '× otisk chybí (fotka z verze bez řetězu, nebo prohlížeč neuměl SHA-256).</span>' : '');
                if (!bad.length) {
                    fail('Řetěz otisků sedí', head + '<br><br>Žádná fotka nebyla po pořízení změněná a pořadí souhlasí.'
                        + '<br><br><i>Pozor: tohle dokládá neporušenost sady v tomhle telefonu, není to elektronický podpis.</i>');
                    return;
                }
                var h = head + '<br><br><b style="color:#f87171;">Nesedí ' + bad.length + ' snímků:</b><ul style="margin:6px 0 0;padding-left:18px;">';
                bad.slice(0, 8).forEach(function (b) { h += '<li>' + esc(fmtDT(b.r.ts)) + ' — ' + esc(b.why) + '</li>'; });
                h += '</ul>';
                fail('Řetěz otisků je porušený', h);
            }
            step();
        });
    }

    // ---- sdílení / mazání / napojení na bod ---------------------------------------------------
    function fileFor(rec) {
        var d = new Date(rec.ts);
        var name = 'geofoto_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '.jpg';
        try { return new File([rec.blob], name, { type: 'image/jpeg' }); } catch (e) { return null; }
    }
    function shareRec(rec) {
        var f = fileFor(rec);
        var txt = projName() + ' — ' + fmtDT(rec.ts) + (rec.ptName ? ' — u bodu ' + rec.ptName : '');
        if (f && navigator.canShare && navigator.canShare({ files: [f] })) {
            navigator.share({ files: [f], title: 'Geo-fotka', text: txt })['catch'](function () {});
            return;
        }
        var url = URL.createObjectURL(rec.blob);
        var a = document.createElement('a');
        a.href = url; a.download = (f && f.name) || 'geofoto.jpg';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:shareRec'); } }, 4000);
    }
    // Připojení k bodu používá STEJNÉ úložiště jako karta bodu (savePointDoc
    // v kalkulacka.js), takže fotka je i v záloze zakázky a v PDF protokolu bodů.
    function attachToPoint(rec) {
        if (!rec.ptId) { toast('Fotka není u žádného bodu (do 25 m nebyl žádný).'); return; }
        if (typeof loadPointDoc !== 'function' || typeof savePointDoc !== 'function') { toast('Karta bodu není k dispozici.'); return; }
        var fr = new FileReader();
        fr.onload = function () {
            loadPointDoc(rec.ptId).then(function (doc) {
                doc = (typeof _normalizeDoc === 'function') ? _normalizeDoc(doc || {}) : (doc || { photos: [] });
                if (!Array.isArray(doc.photos)) doc.photos = [];
                if (doc.photos.length >= 3) { toast('Bod už má 3 fotky — víc karta bodu neunese.'); return; }
                doc.photos.push(fr.result); doc.t = Date.now();
                savePointDoc(rec.ptId, doc).then(function () { toast('Připojeno k bodu ' + rec.ptName + '.'); });
            });
        };
        fr.onerror = function () { toast('Fotku se nepodařilo přečíst.'); };
        fr.readAsDataURL(rec.blob);
    }

    // ---- protokol (tiskové okno) ---------------------------------------------------------------
    function printProtocol() {
        listForView().then(function (rows) {
            if (!rows.length) { toast('Není co tisknout.'); return; }
            Promise.all(rows.map(function (r) {
                return new Promise(function (res) {
                    var fr = new FileReader();
                    fr.onload = function () { res(fr.result); };
                    fr.onerror = function () { res(null); };
                    fr.readAsDataURL(r.blob);
                });
            })).then(function (urls) {
                var h = '<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Fotodokumentace</title><style>'
                    + 'body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px;}'
                    + 'h1{font-size:19px;margin:0 0 2px;} .sub{color:#555;margin:0 0 16px;font-size:12px;}'
                    + '.f{border:1px solid #ccc;border-radius:8px;padding:12px 14px;margin-bottom:12px;page-break-inside:avoid;}'
                    + '.f h2{font-size:14.5px;margin:0 0 6px;}'
                    + 'table{border-collapse:collapse;font-size:12px;} td{padding:2px 14px 2px 0;color:#333;vertical-align:top;} td:first-child{color:#777;white-space:nowrap;}'
                    + 'img{max-width:100%;max-height:420px;border-radius:6px;margin-top:8px;display:block;}'
                    + 'code{font:11px/1.4 ui-monospace,Consolas,monospace;color:#444;word-break:break-all;}'
                    + '.note{margin-top:16px;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:11.5px;color:#555;}'
                    + '@media print{button{display:none}}'
                    + '</style></head><body>'
                    + '<button onclick="window.print()" style="padding:8px 16px;margin-bottom:14px;">Tisk / Uložit PDF</button>'
                    + '<h1>Fotodokumentace — ' + esc(projName()) + '</h1>'
                    + '<p class="sub">' + esc(_day ? ('den ' + _day) : 'celá zakázka') + ' · ' + rows.length + ' snímků · vygenerováno ' + esc(fmtDT(Date.now())) + ' · AR Geodet</p>';
                rows.forEach(function (r, i) {
                    var sj = (r.lat != null) ? toSJTSK(r.lat, r.lng) : null;
                    h += '<div class="f"><h2>' + (i + 1) + '. ' + esc(fmtDT(r.ts)) + (r.ptName ? ' — u bodu ' + esc(r.ptName) + ' (' + r.ptDist + ' m)' : '') + '</h2>'
                        + '<table>'
                        + (sj ? '<tr><td>S-JTSK</td><td>Y ' + fmtNum(sj.y) + ' · X ' + fmtNum(sj.x) + (r.bpv != null ? ' · Bpv ' + r.bpv.toFixed(2) + ' m' : '') + '</td></tr>'
                            : (r.lat != null ? '<tr><td>WGS84</td><td>' + r.lat.toFixed(6) + ', ' + r.lng.toFixed(6) + '</td></tr>' : '<tr><td>Poloha</td><td>nedostupná</td></tr>'))
                        + '<tr><td>Azimut pohledu</td><td>' + (r.az != null ? Math.round(r.az) + '°' : 'neurčen (systémová kamera)') + '</td></tr>'
                        + '<tr><td>Přesnost GPS</td><td>' + (r.acc != null ? '±' + Math.round(r.acc) + ' m' : 'neuvedena') + '</td></tr>'
                        + (r.user ? '<tr><td>Pořídil</td><td>' + esc(r.user) + '</td></tr>' : '')
                        + (r.note ? '<tr><td>Poznámka</td><td>' + esc(r.note) + '</td></tr>' : '')
                        + '<tr><td>Otisk SHA-256</td><td><code>' + esc(r.hash || 'nespočítán') + '</code></td></tr>'
                        + '<tr><td>Navazuje na</td><td><code>' + esc(r.prev || '— první snímek') + '</code></td></tr>'
                        + '</table>'
                        + (urls[i] ? '<img src="' + urls[i] + '" alt="snímek">' : '')
                        + '</div>';
                });
                h += '<div class="note">Souřadnice pocházejí z GPS mobilního telefonu (uvedená přesnost je hodnota hlášená přístrojem) — '
                    + 'jde o dokumentaci stavu, ne o měřický výsledek. Razítko je vypálené do obrazu v okamžiku pořízení; '
                    + 'otisky SHA-256 tvoří řetěz, ve kterém každý snímek odkazuje na předchozí. Neporušenost sady lze ověřit '
                    + 'v aplikaci tlačítkem „Ověřit řetěz". Nejde o elektronický podpis podle eIDAS.</div>'
                    + '</body></html>';
                var w = window.open('', '_blank');
                if (!w) { fail('Protokol se neotevřel', 'Prohlížeč zablokoval nové okno. Povol vyskakovací okna pro tuto aplikaci.'); return; }
                w.document.write(h); w.document.close();
            });
        });
    }

    // ---- styly -------------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-gf-modal .modal-content{display:flex;flex-direction:column;}',
            '#ag-gf-list{flex:1;overflow-y:auto;min-height:0;}',
            '#ag-gf-shot{width:100%;padding:16px;border-radius:14px;border:1px solid var(--accent-line,rgba(47,158,116,0.4));',
            '  background:var(--accent-soft,rgba(47,158,116,0.18));color:var(--accent,#2f9e74);',
            '  font:700 16px/1.2 var(--font-ui,system-ui);cursor:pointer;margin:2px 0 10px;}',
            '#ag-gf-modal .ag-gf-bar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px;}',
            '#ag-gf-modal .ag-gf-bar select,#ag-gf-modal .ag-gf-bar input{flex:1;min-width:110px;padding:8px 10px;border-radius:10px;box-sizing:border-box;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--glass-bg,rgba(255,255,255,0.05));',
            '  color:var(--text-color,#e6e8eb);font:500 13px/1.3 var(--font-ui,system-ui);}',
            '#ag-gf-modal .ag-gf-day{font:700 12.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);',
            '  text-transform:uppercase;letter-spacing:0.04em;margin:10px 0 6px;}',
            '#ag-gf-modal .ag-gf-item{background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  border-radius:14px;padding:10px 12px;margin-bottom:8px;}',
            '#ag-gf-modal .ag-gf-item img{width:100%;border-radius:10px;display:block;margin-bottom:8px;background:#000;}',
            '#ag-gf-modal .ag-gf-meta{font:500 12.5px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#c3c9d2);word-break:break-word;}',
            '#ag-gf-modal .ag-gf-meta b{color:var(--text-color,#e6e8eb);}',
            '#ag-gf-modal .ag-gf-acts{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;}',
            '#ag-gf-modal .ag-gf-acts button{flex:1;min-width:76px;padding:7px 8px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:transparent;color:var(--text-muted,#c3c9d2);font:600 12.5px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '#ag-gf-modal .ag-gf-acts button.warn{color:#f87171;border-color:rgba(220,68,68,0.45);}',
            '#ag-gf-modal .ag-gf-empty{font:500 13px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);font-style:italic;padding:8px 2px;}',
            '#ag-gf-modal .ag-gf-foot{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}',
            '#ag-gf-modal .ag-gf-foot .btn{flex:1;min-width:100px;}',
            // hledáček
            '#ag-gf-view{position:fixed;inset:0;z-index:1000070;display:none;flex-direction:column;background:#000;}',
            '#ag-gf-view video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}',
            '#ag-gf-vinfo{position:absolute;left:0;right:0;bottom:calc(126px + env(safe-area-inset-bottom,0px));',
            '  padding:10px 14px;background:linear-gradient(to top,rgba(0,0,0,0.72),rgba(0,0,0,0));',
            '  color:#fff;font:600 13px/1.5 var(--font-ui,system-ui);text-shadow:0 1px 3px rgba(0,0,0,0.8);}',
            '#ag-gf-vinfo .warn{color:#fbbf24;}',
            '#ag-gf-vnote{position:absolute;top:calc(14px + env(safe-area-inset-top,0px));left:14px;right:14px;padding:9px 12px;border-radius:11px;',
            '  background:rgba(251,191,36,0.16);border:1px solid rgba(251,191,36,0.45);color:#fbbf24;',
            '  font:600 12.5px/1.4 var(--font-ui,system-ui);display:none;}',
            '#ag-gf-vbar{position:absolute;left:0;right:0;bottom:0;padding:12px 14px calc(14px + env(safe-area-inset-bottom,0px));',
            '  display:flex;align-items:center;gap:12px;background:rgba(0,0,0,0.55);}',
            '#ag-gf-vnotein{flex:1;min-width:0;padding:11px 12px;border-radius:12px;box-sizing:border-box;',
            '  border:1px solid rgba(255,255,255,0.22);background:rgba(0,0,0,0.35);color:#fff;',
            '  font:500 13.5px/1.2 var(--font-ui,system-ui);}',
            '#ag-gf-btn-shoot{flex:none;width:72px;height:72px;border-radius:999px;border:4px solid rgba(255,255,255,0.85);',
            '  background:var(--accent,#2f9e74);cursor:pointer;}',
            '#ag-gf-btn-shoot:active{transform:scale(0.94);}',
            '#ag-gf-btn-close{flex:none;width:46px;height:46px;border-radius:999px;border:1px solid rgba(255,255,255,0.3);',
            '  background:rgba(0,0,0,0.4);color:#fff;font:700 18px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '.ag-gf-flash{position:absolute;inset:0;background:#fff;opacity:0.75;animation:ag-gf-fade .26s ease-out forwards;}',
            '@keyframes ag-gf-fade{to{opacity:0}}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- seznam ---------------------------------------------------------------------------------
    function listForView() {
        return dbAll().then(function (all) {
            var mine = all.filter(function (r) { return r && r.pid === pid(); }).sort(function (a, b) { return b.ts - a.ts; });
            if (_day) mine = mine.filter(function (r) { return dayKey(r.ts) === _day; });
            if (_filter) {
                var q = _filter.toLowerCase();
                mine = mine.filter(function (r) {
                    return String(r.note || '').toLowerCase().indexOf(q) >= 0 || String(r.ptName || '').toLowerCase().indexOf(q) >= 0;
                });
            }
            return mine;
        })['catch'](function () { return []; });
    }
    function renderDays() {
        var sel = document.getElementById('ag-gf-daysel');
        if (!sel) return;
        dbAll().then(function (all) {
            var mine = all.filter(function (r) { return r && r.pid === pid(); });
            var days = {}, out = [];
            mine.forEach(function (r) { var k = dayKey(r.ts); if (!days[k]) { days[k] = 1; out.push({ k: k, ts: r.ts }); } });
            out.sort(function (a, b) { return b.ts - a.ts; });
            var h = '<option value="">Všechny dny (' + mine.length + ')</option>';
            out.forEach(function (d) { h += '<option value="' + d.k + '">' + esc(fmtDay(d.ts)) + '</option>'; });
            sel.innerHTML = h;
            sel.value = _day || '';
        });
    }
    var _urls = [];
    function freeUrls() { _urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'geo-foto:freeUrls'); } }); _urls = []; }
    function renderList() {
        var box = document.getElementById('ag-gf-list');
        if (!box) return;
        renderDays();
        listForView().then(function (rows) {
            freeUrls();
            if (!rows.length) {
                box.innerHTML = '<div class="ag-gf-empty">'
                    + (_filter || _day ? 'Nic neodpovídá výběru.'
                        : 'Zatím žádná fotka v této zakázce. Klepni nahoře na <b>Vyfotit</b> — razítko se do snímku vypálí samo.')
                    + '</div>';
                return;
            }
            var h = '', lastDay = '';
            rows.forEach(function (r) {
                var day = fmtDay(r.ts);
                if (day !== lastDay) { h += '<div class="ag-gf-day">' + esc(day) + '</div>'; lastDay = day; }
                var url = URL.createObjectURL(r.blob); _urls.push(url);
                var sj = (r.lat != null) ? toSJTSK(r.lat, r.lng) : null;
                h += '<div class="ag-gf-item" data-id="' + esc(r.id) + '">'
                    + '<img src="' + url + '" alt="snímek ' + esc(fmtT(r.ts)) + '">'
                    + '<div class="ag-gf-meta"><b>' + esc(fmtT(r.ts)) + '</b>'
                    + (r.ptName ? ' · u bodu <b>' + esc(r.ptName) + '</b> (' + r.ptDist + ' m)' : '')
                    + '<br>' + (sj ? 'Y ' + esc(fmtNum(sj.y)) + ' · X ' + esc(fmtNum(sj.x)) : (r.lat != null ? esc(r.lat.toFixed(6) + ', ' + r.lng.toFixed(6)) : 'bez polohy'))
                    + (r.az != null ? ' · azimut ' + Math.round(r.az) + '°' : '')
                    + (r.note ? '<br><i>' + esc(r.note) + '</i>' : '')
                    + '</div>'
                    + '<div class="ag-gf-acts">'
                    + '<button type="button" class="ag-gf-share">Sdílet</button>'
                    + (r.ptId ? '<button type="button" class="ag-gf-attach">K bodu</button>' : '')
                    + '<button type="button" class="ag-gf-del warn">Smazat</button>'
                    + '</div></div>';
            });
            box.innerHTML = h;
            var items = box.querySelectorAll('.ag-gf-item');
            for (var i = 0; i < items.length; i++) {
                (function (item) {
                    var id = item.getAttribute('data-id'), rec = null;
                    rows.forEach(function (r) { if (r.id === id) rec = r; });
                    if (!rec) return;
                    item.querySelector('.ag-gf-share').addEventListener('click', function () { shareRec(rec); });
                    var at = item.querySelector('.ag-gf-attach');
                    if (at) at.addEventListener('click', function () { attachToPoint(rec); });
                    // mazání dvoj-ťukem (blokující confirm na iOS mrazí kameru)
                    var del = item.querySelector('.ag-gf-del'), armed = null;
                    del.addEventListener('click', function () {
                        if (armed) {
                            clearTimeout(armed);
                            // Smazáním se ROZPOJÍ řetěz otisků — je poctivější to říct hned,
                            // než aby se uživatel divil při pozdějším ověřování.
                            dbDel(rec.id).then(function () { toast('Smazáno. Pozor: v řetězu otisků teď chybí článek.'); renderList(); });
                            return;
                        }
                        del.textContent = 'Opravdu smazat?';
                        armed = setTimeout(function () { armed = null; del.textContent = 'Smazat'; }, 3000);
                    });
                })(items[i]);
            }
        });
    }

    // ---- hledáček (DOM) ---------------------------------------------------------------------------
    function ensureViewer() {
        var ov = document.getElementById('ag-gf-view');
        if (ov) return ov;
        injectStyles();
        ov = document.createElement('div');
        ov.id = 'ag-gf-view';
        ov.innerHTML =
            '<video id="ag-gf-video" playsinline muted autoplay></video>'
            + '<div id="ag-gf-vnote"></div>'
            + '<div id="ag-gf-vinfo"></div>'
            + '<div id="ag-gf-vbar">'
            + '  <button type="button" id="ag-gf-btn-close" aria-label="Zavřít hledáček">✕</button>'
            + '  <input type="text" id="ag-gf-vnotein" placeholder="Poznámka do razítka (nepovinné)" maxlength="120">'
            + '  <button type="button" id="ag-gf-btn-shoot" aria-label="Vyfotit"></button>'
            + '</div>';
        document.body.appendChild(ov);
        ov.querySelector('#ag-gf-btn-close').addEventListener('click', closeView);
        ov.querySelector('#ag-gf-btn-shoot').addEventListener('click', shoot);
        return ov;
    }

    // ---- modal ---------------------------------------------------------------------------------------
    function open() {
        injectStyles();
        var m = document.getElementById('ag-gf-modal');
        if (!m) {
            m = document.createElement('div');
            m.className = 'modal-overlay';
            m.id = 'ag-gf-modal';
            m.innerHTML =
                '<div class="modal-content">' +
                '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Geo-fotka</h3>' +
                '  <button type="button" id="ag-gf-shot">Vyfotit s razítkem</button>' +
                '  <div class="ag-gf-bar">' +
                '    <select id="ag-gf-daysel"></select>' +
                '    <input type="text" id="ag-gf-find" placeholder="Hledat v poznámkách…">' +
                '  </div>' +
                '  <div id="ag-gf-list"></div>' +
                '  <div class="ag-gf-foot">' +
                '    <button type="button" class="btn btn-secondary" id="ag-gf-pdf">Uložit PDF</button>' +
                '    <button type="button" class="btn btn-secondary" id="ag-gf-verify">Ověřit řetěz</button>' +
                '    <button type="button" class="btn btn-secondary" id="ag-gf-close">Zavřít</button>' +
                '  </div>' +
                '  <input type="file" id="ag-gf-file" accept="image/*" capture="environment" style="display:none">' +
                '</div>';
            document.body.appendChild(m);
            m.querySelector('#ag-gf-shot').addEventListener('click', openView);
            m.querySelector('#ag-gf-pdf').addEventListener('click', printProtocol);
            m.querySelector('#ag-gf-verify').addEventListener('click', verifyChain);
            m.querySelector('#ag-gf-file').addEventListener('change', onFile);
            m.querySelector('#ag-gf-close').addEventListener('click', function () { closeView(); freeUrls(); m.style.display = 'none'; });
            m.querySelector('#ag-gf-find').addEventListener('input', function () { _filter = this.value.trim(); renderList(); });
            m.querySelector('#ag-gf-daysel').addEventListener('change', function () { _day = this.value || null; renderList(); });
            // Okno umí zavřít i křížek a potáhnutí dolů (modal-close.js) — kdyby zůstal
            // otevřený hledáček, svítila by kamera dál. Hlídáme display stejně jako hlasovky.
            try {
                new MutationObserver(function () {
                    if (m.style.display === 'none') { closeView(); freeUrls(); }
                }).observe(m, { attributes: true, attributeFilter: ['style'] });
            } catch (e) {}
        }
        m.style.display = 'flex';
        renderList();
    }

    // appka do pozadí = kameru pustit (iOS ji stejně utne, jen by zůstala „svítit")
    try {
        window.addEventListener('pagehide', function () { closeView(); });
        document.addEventListener('visibilitychange', function () { if (document.hidden) closeView(); });
    } catch (e) {}

    // ---- veřejné API (Deník dne / protokoly) -----------------------------------------------------------
    window.AGGeoFoto = {
        open: open,
        shoot: function () { open(); openView(); },
        listRange: function (p, from, to) {
            return dbAll().then(function (all) {
                return all.filter(function (r) { return r && r.pid === p && r.ts >= from && r.ts < to; })
                    .sort(function (a, b) { return a.ts - b.ts; })
                    .map(function (r) { return { ts: r.ts, ptName: r.ptName || null, note: r.note || '', lat: r.lat, lng: r.lng, hash: r.hash || null }; });
            })['catch'](function () { return []; });
        }
    };

    // ---- dlaždice v Nástrojích ---------------------------------------------------------------------------
    var _tries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'geo-foto', label: 'Geo-fotka', icon: ICON, cat: 'Pomůcky', onClick: open, order: 64 });
            return;
        }
        if (_tries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.agOpenGeoFoto = open;
})();
