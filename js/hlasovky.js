// ===== AR Geodet — HLASOVÉ POZNÁMKY S GEORAZÍTKEM (ODPOJITELNÁ vrstva) ==========
// V rukavicích a blátě se nepíše: podržíš jedno velké tlačítko, řekneš co vidíš,
// a poznámka se uloží s časem, polohou (WGS + S-JTSK přes GeoCore), přesností GPS
// a NEJBLIŽŠÍM vlastním bodem zakázky do 25 m („u bodu 105, 3 m"). Večer si je
// přehraješ tady nebo je posbírá Deník dne.
//
//   • Nahrávání: MediaRecorder (Android webm/opus, iOS 14.3+ audio/mp4); strop
//     5 minut na poznámku. POZOR iOS: spuštění mikrofonu může na okamžik
//     přiškrtit kamerový stream AR — po zastavení nahrávání se mikrofon hned
//     uvolňuje (stop všech tracků).
//   • Úložiště: IndexedDB 'agHlasovky1' (audio bloby do localStorage nepatří).
//     Poznámky jsou per zakázka (pid), mazání po jedné (dvoj-ťuk, žádný
//     blokující confirm — na iOS mrazí kameru).
//   • Ke každé poznámce jde dopsat krátký text (inline, žádný prompt()).
//   • Sdílení: navigator.share se souborem, fallback stažení souboru.
//   • Veřejné API pro Deník dne: window.AGHlasovky.listRange(pid, from, to)
//     -> Promise<[{ts, dur, note, ptName, ptDist}]> (bez blobů).
//
// NEEDITUJE logika.js ani grafika.js — čte jen globály (userLat/userLng,
// currentGpsAccuracy, persistentCustomPoints, getDistance, GeoCore) přes typeof.
// Odstranění: smaž js/hlasovky.js + řádek <script> v index.html (a přegeneruj
// sw.js: scripts/gen_sw_assets.py --bump). Data v IndexedDB ničemu nevadí.
// ================================================================================
(function () {
    'use strict';
    if (window.__agHlasovkyInit) return;
    window.__agHlasovkyInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';
    var STYLE_ID = 'ag-hl-style';
    var DB_NAME = 'agHlasovky1';
    var STORE = 'rec';
    var MAX_SEC = 300;            // strop délky jedné poznámky
    var NEAR_M = 25;              // do kolika metrů se poznámka váže k bodu

    var _db = null;
    var _rec = null, _chunks = [], _recT0 = 0, _recTimer = null, _stream = null, _recGeo = null;
    var _audio = null, _playingId = null, _playUrl = null;

    // ---- pomocné -------------------------------------------------------------
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function projName() {
        var id = pid();
        try {
            if (typeof projects !== 'undefined' && Array.isArray(projects)) {
                for (var i = 0; i < projects.length; i++) { if (projects[i] && projects[i].id === id) return projects[i].name || id; }
            }
        } catch (e) {}
        return (id === 'default') ? 'Výchozí zakázka' : id;
    }
    function toast(m) { try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) {} try { agInfo(m); } catch (e2) {} }
    function fmtT(ts) { try { return new Date(ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
    function fmtDur(s) { return Math.floor(s / 60) + ':' + pad2(Math.round(s) % 60); }
    var DAYS_CS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
    function fmtDay(ts) { var d = new Date(ts); return DAYS_CS[d.getDay()] + ' ' + d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear(); }
    function dist(la1, lo1, la2, lo2) {
        try { if (typeof getDistance === 'function') return getDistance(la1, lo1, la2, lo2); } catch (e) {}
        var R = 6371000, r = Math.PI / 180;
        var a = Math.sin((la2 - la1) * r / 2), b = Math.sin((lo2 - lo1) * r / 2);
        var h = a * a + Math.cos(la1 * r) * Math.cos(la2 * r) * b * b;
        return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    function fmtNum(v) { return v.toFixed(1).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function geoStamp(rec) {
        if (rec.lat == null) return 'bez polohy';
        var s = null;
        try { if (window.GeoCore && GeoCore.toSJTSK) s = GeoCore.toSJTSK(rec.lat, rec.lng); } catch (e) {}
        var t = s ? 'Y ' + fmtNum(s.y) + ' · X ' + fmtNum(s.x) : rec.lat.toFixed(6) + ', ' + rec.lng.toFixed(6);
        if (rec.acc != null) t += ' (±' + Math.round(rec.acc) + ' m)';
        return t;
    }

    // ---- IndexedDB --------------------------------------------------------------
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
                tx.oncomplete = res;
                tx.onerror = function () { rej(tx.error); };
            });
        });
    }
    function dbDel(id) {
        return db().then(function (d) {
            return new Promise(function (res, rej) {
                var tx = d.transaction(STORE, 'readwrite');
                tx.objectStore(STORE)['delete'](id);
                tx.oncomplete = res;
                tx.onerror = function () { rej(tx.error); };
            });
        });
    }

    // ---- nahrávání ----------------------------------------------------------------
    function pickMime() {
        var cands = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
        try {
            for (var i = 0; i < cands.length; i++) {
                if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(cands[i])) return cands[i];
            }
        } catch (e) {}
        return '';
    }
    function nearestPoint(lat, lng) {
        try {
            if (lat == null || typeof persistentCustomPoints === 'undefined' || !Array.isArray(persistentCustomPoints)) return null;
            var best = null;
            persistentCustomPoints.forEach(function (p) {
                if (!p || p.lat == null || p.lng == null) return;
                var d = dist(lat, lng, p.lat, p.lng);
                if (d <= NEAR_M && (!best || d < best.d)) best = { name: p.name || p.id, d: d };
            });
            return best;
        } catch (e) { return null; }
    }
    function startRec() {
        if (_rec) return;
        if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            toast('Tenhle prohlížeč neumí nahrávat zvuk (MediaRecorder chybí).');
            return;
        }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            _stream = stream;
            // georazítko se bere HNED při startu (než se stihne odejít od místa)
            _recGeo = { lat: null, lng: null, acc: null };
            try {
                if (typeof userLat !== 'undefined' && userLat != null) {
                    _recGeo.lat = userLat; _recGeo.lng = userLng;
                    if (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy != null) _recGeo.acc = currentGpsAccuracy;
                }
            } catch (e) {}
            var mime = pickMime();
            _rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
            _chunks = [];
            _rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) _chunks.push(ev.data); };
            _rec.onstop = onRecStop;
            _rec.start();
            _recT0 = Date.now();
            _recTimer = setInterval(function () {
                var s = (Date.now() - _recT0) / 1000;
                var el = document.getElementById('ag-hl-rectime');
                if (el) el.textContent = fmtDur(s);
                if (s >= MAX_SEC) stopRec();
            }, 250);
            syncRecUi(true);
        })['catch'](function () {
            toast('Mikrofon se nepodařilo spustit — zkontroluj povolení pro mikrofon.');
        });
    }
    function stopRec() {
        if (!_rec) return;
        try { if (_rec.state !== 'inactive') _rec.stop(); } catch (e) { onRecStop(); }
        if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
    }
    function onRecStop() {
        var recorder = _rec; _rec = null;
        // mikrofon uvolnit OKAMŽITĚ (iOS jinak drží audio session a škrtí kameru)
        try { if (_stream) _stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        _stream = null;
        syncRecUi(false);
        var dur = (Date.now() - _recT0) / 1000;
        if (!_chunks.length || dur < 0.8) { toast('Poznámka je moc krátká, neukládám.'); return; }
        var mime = (recorder && recorder.mimeType) || _chunks[0].type || 'audio/webm';
        var blob = new Blob(_chunks, { type: mime });
        _chunks = [];
        var near = _recGeo ? nearestPoint(_recGeo.lat, _recGeo.lng) : null;
        var rec = {
            id: 'hl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            pid: pid(), ts: _recT0, dur: dur, mime: mime, blob: blob, note: '',
            lat: _recGeo ? _recGeo.lat : null, lng: _recGeo ? _recGeo.lng : null, acc: _recGeo ? _recGeo.acc : null,
            ptName: near ? near.name : null, ptDist: near ? Math.round(near.d) : null
        };
        dbPut(rec).then(function () {
            toast('Hlasovka uložena' + (rec.ptName ? ' (u bodu ' + rec.ptName + ')' : '') + '.');
            renderList();
        }, function () { toast('Uložení se nepovedlo (IndexedDB).'); });
    }
    function syncRecUi(on) {
        var b = document.getElementById('ag-hl-recbtn');
        if (!b) return;
        b.classList.toggle('rec', !!on);
        b.innerHTML = on
            ? '<span class="dot"></span> Nahrávám… <span id="ag-hl-rectime">0:00</span> — klepni pro STOP'
            : '● Nahrát poznámku';
    }

    // ---- přehrávání / sdílení / mazání ------------------------------------------------
    function stopPlay() {
        if (_audio) { try { _audio.pause(); } catch (e) {} }
        if (_playUrl) { try { URL.revokeObjectURL(_playUrl); } catch (e2) {} _playUrl = null; }
        _playingId = null;
        var btns = document.querySelectorAll('#ag-hl-modal .ag-hl-play.on');
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove('on');
    }
    function playRec(rec, btn) {
        if (_playingId === rec.id) { stopPlay(); return; }
        stopPlay();
        if (!_audio) { _audio = document.createElement('audio'); _audio.addEventListener('ended', stopPlay); }
        _playUrl = URL.createObjectURL(rec.blob);
        _audio.src = _playUrl;
        _playingId = rec.id;
        if (btn) btn.classList.add('on');
        _audio.play()['catch'](function () { stopPlay(); toast('Přehrání se nepovedlo.'); });
    }
    function fileFor(rec) {
        var ext = /mp4/.test(rec.mime) ? 'm4a' : (/webm/.test(rec.mime) ? 'webm' : 'audio');
        var d = new Date(rec.ts);
        var name = 'hlasovka_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.' + ext;
        try { return new File([rec.blob], name, { type: rec.mime }); } catch (e) { return null; }
    }
    function shareRec(rec) {
        var f = fileFor(rec);
        var txt = 'Hlasovka ' + fmtT(rec.ts) + ' — ' + projName() + (rec.ptName ? ' — u bodu ' + rec.ptName : '') + ' — ' + geoStamp(rec) + (rec.note ? ' — ' + rec.note : '');
        if (f && navigator.canShare && navigator.canShare({ files: [f] })) {
            navigator.share({ files: [f], title: 'Hlasová poznámka', text: txt })['catch'](function () {});
            return;
        }
        // fallback: stáhnout soubor
        var url = URL.createObjectURL(rec.blob);
        var a = document.createElement('a');
        a.href = url; a.download = f ? f.name : 'hlasovka.audio';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
    }

    // ---- styly --------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-hl-modal .modal-content{display:flex;flex-direction:column;}',
            '#ag-hl-list{flex:1;overflow-y:auto;min-height:0;}',
            '#ag-hl-recbtn{width:100%;padding:16px;border-radius:14px;border:1px solid var(--accent-line,rgba(47,158,116,0.4));',
            '  background:var(--accent-soft,rgba(47,158,116,0.18));color:var(--accent,#2f9e74);',
            '  font:700 16px/1.2 var(--font-ui,system-ui);cursor:pointer;margin:2px 0 12px;}',
            '#ag-hl-recbtn.rec{background:rgba(220,68,68,0.16);border-color:rgba(220,68,68,0.5);color:#f87171;}',
            '#ag-hl-recbtn .dot{display:inline-block;width:10px;height:10px;border-radius:99px;background:#f87171;',
            '  margin-right:6px;animation:ag-hl-blink 1s infinite;}',
            '@keyframes ag-hl-blink{0%,100%{opacity:1}50%{opacity:0.25}}',
            '#ag-hl-modal .ag-hl-day{font:700 12.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);',
            '  text-transform:uppercase;letter-spacing:0.04em;margin:10px 0 6px;}',
            '#ag-hl-modal .ag-hl-item{background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  border-radius:14px;padding:10px 12px;margin-bottom:8px;}',
            '#ag-hl-modal .ag-hl-top{display:flex;align-items:center;gap:10px;}',
            '#ag-hl-modal .ag-hl-play{width:42px;height:42px;flex:none;border-radius:99px;border:1px solid var(--accent-line,rgba(47,158,116,0.4));',
            '  background:transparent;color:var(--accent,#2f9e74);font-size:16px;cursor:pointer;}',
            '#ag-hl-modal .ag-hl-play.on{background:var(--accent-soft,rgba(47,158,116,0.18));}',
            '#ag-hl-modal .ag-hl-meta{flex:1;min-width:0;font:500 12.5px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#c3c9d2);word-break:break-word;}',
            '#ag-hl-modal .ag-hl-meta b{color:var(--text-color,#e6e8eb);font-size:13.5px;}',
            '#ag-hl-modal .ag-hl-note{width:100%;margin-top:8px;padding:7px 10px;border-radius:10px;box-sizing:border-box;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--glass-bg,rgba(255,255,255,0.05));',
            '  color:var(--text-color,#e6e8eb);font:500 13px/1.4 var(--font-ui,system-ui);}',
            '#ag-hl-modal .ag-hl-acts{display:flex;gap:8px;margin-top:8px;}',
            '#ag-hl-modal .ag-hl-acts button{flex:1;padding:7px 8px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:transparent;color:var(--text-muted,#c3c9d2);font:600 12.5px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '#ag-hl-modal .ag-hl-acts button.warn{color:#f87171;border-color:rgba(220,68,68,0.45);}',
            '#ag-hl-modal .ag-hl-empty{font:500 13px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);font-style:italic;padding:8px 2px;}',
            '#ag-hl-modal .ag-hl-foot{display:flex;gap:8px;margin-top:12px;}',
            '#ag-hl-modal .ag-hl-foot .btn{flex:1;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- seznam -----------------------------------------------------------------------------
    function renderList() {
        var box = document.getElementById('ag-hl-list');
        if (!box) return;
        dbAll().then(function (all) {
            var mine = all.filter(function (r) { return r && r.pid === pid(); }).sort(function (a, b) { return b.ts - a.ts; });
            if (!mine.length) {
                box.innerHTML = '<div class="ag-hl-empty">Zatím žádné hlasovky v této zakázce. Klepni nahoře na Nahrát, řekni co vidíš, klepnutím zastavíš.</div>';
                return;
            }
            var h = '', lastDay = '';
            mine.forEach(function (r) {
                var day = fmtDay(r.ts);
                if (day !== lastDay) { h += '<div class="ag-hl-day">' + esc(day) + '</div>'; lastDay = day; }
                h += '<div class="ag-hl-item" data-id="' + esc(r.id) + '">'
                    + '<div class="ag-hl-top">'
                    + '<button type="button" class="ag-hl-play" aria-label="Přehrát">▶</button>'
                    + '<div class="ag-hl-meta"><b>' + esc(fmtT(r.ts)) + ' · ' + esc(fmtDur(r.dur)) + '</b>'
                    + (r.ptName ? ' · u bodu <b>' + esc(r.ptName) + '</b>' + (r.ptDist != null ? ' (' + r.ptDist + ' m)' : '') : '')
                    + '<br>' + esc(geoStamp(r)) + '</div>'
                    + '</div>'
                    + '<input type="text" class="ag-hl-note" placeholder="Dopsat poznámku…" value="' + esc(r.note || '') + '" maxlength="200">'
                    + '<div class="ag-hl-acts">'
                    + '<button type="button" class="ag-hl-share">Sdílet / uložit</button>'
                    + '<button type="button" class="ag-hl-del warn">Smazat</button>'
                    + '</div>'
                    + '</div>';
            });
            box.innerHTML = h;
            // handlery (žádné inline onclicky — CSP i pořádek)
            var items = box.querySelectorAll('.ag-hl-item');
            for (var i = 0; i < items.length; i++) {
                (function (item) {
                    var id = item.getAttribute('data-id');
                    var rec = null;
                    mine.forEach(function (r) { if (r.id === id) rec = r; });
                    if (!rec) return;
                    item.querySelector('.ag-hl-play').addEventListener('click', function () { playRec(rec, this); });
                    item.querySelector('.ag-hl-share').addEventListener('click', function () { shareRec(rec); });
                    var noteEl = item.querySelector('.ag-hl-note');
                    noteEl.addEventListener('change', function () {
                        rec.note = this.value.slice(0, 200);
                        dbPut(rec);
                    });
                    // mazání dvoj-ťukem (žádný blokující confirm)
                    var del = item.querySelector('.ag-hl-del');
                    var armed = null;
                    del.addEventListener('click', function () {
                        if (armed) {
                            clearTimeout(armed);
                            if (_playingId === rec.id) stopPlay();
                            dbDel(rec.id).then(renderList);
                            return;
                        }
                        del.textContent = 'Opravdu smazat?';
                        armed = setTimeout(function () { armed = null; del.textContent = 'Smazat'; }, 3000);
                    });
                })(items[i]);
            }
        }, function () {
            box.innerHTML = '<div class="ag-hl-empty">Úložiště (IndexedDB) se nepodařilo otevřít.</div>';
        });
    }

    // ---- modal -------------------------------------------------------------------------------
    function open() {
        injectStyles();
        var m = document.getElementById('ag-hl-modal');
        if (!m) {
            m = document.createElement('div');
            m.className = 'modal-overlay';
            m.id = 'ag-hl-modal';
            m.innerHTML =
                '<div class="modal-content">' +
                '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Hlasové poznámky</h3>' +
                '  <button type="button" id="ag-hl-recbtn">● Nahrát poznámku</button>' +
                '  <div id="ag-hl-list"></div>' +
                '  <div class="ag-hl-foot">' +
                '    <button type="button" class="btn btn-secondary" id="ag-hl-close">Zavřít</button>' +
                '  </div>' +
                '</div>';
            document.body.appendChild(m);
            m.querySelector('#ag-hl-recbtn').addEventListener('click', function () { _rec ? stopRec() : startRec(); });
            m.querySelector('#ag-hl-close').addEventListener('click', function () {
                if (_rec) stopRec();
                stopPlay();
                m.style.display = 'none';
            });
        }
        m.style.display = 'flex';
        syncRecUi(!!_rec);
        renderList();
    }

    // ---- veřejné API (Deník dne) -----------------------------------------------------------
    window.AGHlasovky = {
        listRange: function (p, from, to) {
            return dbAll().then(function (all) {
                return all
                    .filter(function (r) { return r && r.pid === p && r.ts >= from && r.ts < to; })
                    .sort(function (a, b) { return a.ts - b.ts; })
                    .map(function (r) { return { ts: r.ts, dur: r.dur, note: r.note || '', ptName: r.ptName || null, ptDist: r.ptDist != null ? r.ptDist : null }; });
            })['catch'](function () { return []; });
        }
    };

    // ---- dlaždice v Nástrojích ----------------------------------------------------------------
    var _regTries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'hlasovky', label: 'Hlasové poznámky', icon: ICON, cat: 'Pomůcky', onClick: open, order: 63 });
            return;
        }
        if (_regTries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.agOpenHlasovky = open;
})();
