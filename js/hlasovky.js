// ===== AR Geodet — HLASOVÉ POZNÁMKY S GEORAZÍTKEM A PŘEPISEM (ODPOJITELNÁ) ======
// V rukavicích a blátě se nepíše: podržíš jedno velké tlačítko, řekneš co vidíš,
// a poznámka se uloží s časem, polohou (WGS + S-JTSK přes GeoCore), přesností GPS
// a NEJBLIŽŠÍM vlastním bodem zakázky do 25 m („u bodu 105, 3 m").
//
// PŘEPIS NA TEXT (samotný zvuk je v kanceláři k ničemu — musí se přehrávat):
//   • Během nahrávání běží rozpoznávání řeči (Web Speech API, cs-CZ) a text
//     naskakuje živě pod tlačítkem. Po uložení je text u poznámky a jde HO
//     UPRAVIT — rozpoznávání dělá chyby, hlavně u geodetického žargonu.
//   • ŽARGON: krátký, ZÁMĚRNĚ konzervativní slovníček (SLANG níže) opraví to,
//     co diktát komolí pravidelně (es jé té es ká → S-JTSK, bé pé vé → Bpv…).
//     Nepřidávej sem nic dvojznačného — přepsat uživateli běžné slovo je horší
//     než ho nechat být.
//   • POTŘEBUJE SIGNÁL: prohlížeče posílají zvuk na server výrobce. Offline
//     (nebo když prohlížeč Web Speech neumí) se poznámka uloží jen jako zvuk
//     a u ní je poznámka „přepis se nepovedl" + tlačítko Diktovat na později.
//   • Zvuk se ukládá VŽDY (i když přepis vyjde) — je to důkaz a záloha, kdyby
//     přepis něco zkomolil. Když naopak selže nahrávání a přepis vyjde, uloží
//     se poznámka jen jako text.
//   • Vypínatelné: přepínač „Přepisovat na text" v hlavičce nástroje
//     (klíč agHlasTxt). POZOR iOS: rozpoznávání i nahrávání sahají na audio
//     session — kdyby to škublo kamerou v AR, tímhle se to vypne.
//
// CO BYLO ŠPATNĚ (oprava 27. 7.) — „sekne se to, nejde stopnout a nepřepisuje":
//   1) SMYČKA ROZPOZNÁVÁNÍ. V onend se rovnou volalo start(). Když start hned
//      zase selhal (offline, mikrofon drží nahrávání, iOS), vznikla tichá
//      smyčka start→error→end→start bez jediné pauzy. Ta ucpe hlavní vlákno,
//      appka „ztuhne" a klepnutí na STOP se nemá kdy zpracovat. Restart je teď
//      přes časovač (odstup SR_GAP_MS) a se stropem pokusů (SR_MAX_STARTS);
//      po tvrdé chybě se nerestartuje vůbec.
//   2) ZASTAVENÍ VISELO NA JEDNOM try. Když spadl jeden krok, neuklidily se
//      ostatní (mikrofon, časovač, rozpoznávání) a rekordér zůstal „zapnutý" —
//      tlačítko dál hlásilo Nahrávám a další klepnutí nedělalo nic. Teď je
//      každý krok samostatně a navíc je pojistka: kdyby onstop nedorazil
//      (iOS umí audio session utnout), poznámka se po 2 s dokončí sama.
//      Ošetřené je i dvojí klepnutí na STOP a klepnutí ještě během dotazu na
//      povolení mikrofonu (dřív z toho vznikla dvě nahrávání a viselý mikrofon).
//   3) TICHÉ SELHÁNÍ PŘEPISU. Když prohlížeč Web Speech neumí (iPhone, často
//      i PWA), nestalo se nic a nikde to nebylo napsané. Teď to okno POCTIVĚ
//      napíše hned při startu nahrávání a zvuk se nahrává dál.
//   4) MIKROFON PO ZAVŘENÍ OKNA. Modál jde zavřít i křížkem/gestem (modal-close.js)
//      a appka může jít do pozadí — úklid se proto hlídá zvlášť (pozorovatel
//      nad oknem + pagehide + visibilitychange), ne jen v našem tlačítku Zavřít.
//
// Úložiště: IndexedDB 'agHlasovky1' per zakázka (audio bloby do localStorage
// nepatří). Mazání dvoj-ťukem (žádný blokující confirm — na iOS mrazí kameru).
// Veřejné API pro Deník dne: window.AGHlasovky.listRange(pid, from, to)
//   -> Promise<[{ts, dur, note, ptName, ptDist}]> (bez blobů; note = přepis).
//
// NEEDITUJE logika.js ani grafika.js — čte jen globály (userLat/userLng,
// currentGpsAccuracy, persistentCustomPoints, getDistance, GeoCore) přes typeof.
// Odstranění: smaž js/hlasovky.js + řádek <script> v index.html (a přegeneruj
// sw.js). Data v IndexedDB ničemu nevadí.
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
    var TXT_KEY = 'agHlasTxt';    // '0' = nepřepisovat na text

    var SR_MAX_STARTS = 40;       // strop restartů rozpoznávání — pojistka proti smyčce
    var SR_GAP_MS = 350;          // odstup mezi restarty; bez pauzy je z toho vytížené čekání
    var STOP_WD_MS = 2000;        // do kdy musí dorazit onstop, jinak dokončíme poznámku sami

    var _db = null;
    var _rec = null, _chunks = [], _recT0 = 0, _recTimer = null, _stream = null, _recGeo = null;
    var _recStarting = false;     // běží dotaz na mikrofon — druhé klepnutí nesmí spustit druhé nahrávání
    var _recAbort = false;        // STOP/zavření okna přišlo dřív, než mikrofon naskočil
    var _recStopping = false;     // STOP už běží — další klepnutí nic needuplikuje
    var _recDone = true;          // dokončeno (onstop i pojistka vedou na stejné místo, ale jen jednou)
    var _recWd = null;            // pojistka pro nedoručený onstop
    var _recSess = 0;             // známka nahrávání — opozdilé kusy zvuku nepatří do další poznámky
    var _audio = null, _playingId = null, _playUrl = null;
    var _sr = null, _srOn = false, _srFinal = '', _srInterim = '', _srDead = false;
    var _srSoft = false;          // přepis selhal jen pro tohle nahrávání (offline, zabraný mikrofon)
    var _srStarts = 0, _srRetry = null;
    var _dictFor = null;          // id poznámky, ke které se právě dodiktovává
    var _dictCtx = null;          // {rec, btn, base, ta} — ať jde dodiktování ukončit odkudkoli
    var _filter = '';

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
    // text poznámky: nový přepis, jinak starý ruční zápisek (zpětná kompatibilita)
    function recText(r) { return (r && (r.txt || r.note)) || ''; }

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

    // ---- přepis řeči na text -------------------------------------------------------
    // ZÁMĚRNĚ KONZERVATIVNÍ: jen to, co diktát komolí pravidelně a co nemůže být
    // běžné české slovo. Radši nechat neopravené než přepsat uživateli, co řekl.
    var SLANG = [
        [/\bes\s+jé\s+té\s+es\s+ká\b/gi, 'S-JTSK'],
        [/\bsjtsk\b/gi, 'S-JTSK'],
        [/\bbé\s+pé\s+vé\b/gi, 'Bpv'],
        [/\bbpv\b/gi, 'Bpv'],
        [/\bzet\s+pé\s+em\s+zet\b/gi, 'ZPMZ'],
        [/\bzpmz\b/gi, 'ZPMZ'],
        [/\bčúzk\b/gi, 'ČÚZK'],
        [/\bgnss\b/gi, 'GNSS'],
        [/\bgé\s+en\s+es\s+es\b/gi, 'GNSS'],
        [/\bpé\s+dé\s+o\s+pé\b/gi, 'PDOP'],
        [/\bdé\s+em\s+er\b/gi, 'DMR'],
        [/\borto\s+foto\b/gi, 'ortofoto'],
        [/\bgeometrický\s+plán\b/gi, 'geometrický plán']
    ];
    function fixGeo(t) {
        var s = String(t || '').replace(/\s+/g, ' ').trim();
        for (var i = 0; i < SLANG.length; i++) s = s.replace(SLANG[i][0], SLANG[i][1]);
        if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
        return s;
    }
    function srCtor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
    function txtOn() { try { return localStorage.getItem(TXT_KEY) !== '0'; } catch (e) { return true; } }
    // proč přepis zrovna teď nejede (null = jede nebo má jet). POCTIVĚ se to
    // ukazuje pod tlačítkem — mlčet by znamenalo, že uživatel mluví do prázdna.
    function srWhyOff() {
        if (!srCtor()) return 'Přepis řeči na text tenhle prohlížeč neumí (typicky iPhone/PWA). Nahrávám zvuk — text pak dopiš k poznámce.';
        if (!txtOn()) return null;                 // vypnuto uživatelem: nehlásit nic
        if (_srDead) return 'Přepis: prohlížeč nepovolil rozpoznávání řeči. Ukládám jen zvuk.';
        if (_srSoft) return 'Přepis se nepovedl (signál nebo zabraný mikrofon). Ukládám jen zvuk.';
        return null;
    }
    function srClearRetry() { if (_srRetry) { try { clearTimeout(_srRetry); } catch (e) {} _srRetry = null; } }
    // jeden pokus o start; false = už se startovat nemá (nebo start spadl)
    function srStart() {
        if (!_sr || !_srOn) return false;
        if (_srStarts >= SR_MAX_STARTS) return false;
        _srStarts++;
        try { _sr.start(); return true; } catch (e) { return false; }   // InvalidStateError = už běží
    }
    // spustí rozpoznávání; onLive(text) dostává průběžný text (interimResults!)
    function startSR(onLive) {
        srClearRetry();
        var C = srCtor();
        if (!C || _srDead || !txtOn()) return false;
        try {
            _sr = new C();
            _sr.lang = 'cs-CZ';
            _sr.continuous = true;
            _sr.interimResults = true;      // bez tohohle se pod tlačítkem nic nezobrazuje
            _srFinal = ''; _srInterim = ''; _srOn = true; _srStarts = 0;
            _sr.onresult = function (ev) {
                _srStarts = 0;              // rozpoznávání zjevně jede → strop restartů se počítá znovu
                var interim = '';
                for (var i = ev.resultIndex; i < ev.results.length; i++) {
                    var r = ev.results[i];
                    if (r.isFinal) _srFinal += r[0].transcript + ' ';
                    else interim += r[0].transcript;
                }
                _srInterim = interim;
                if (onLive) { try { onLive((_srFinal + interim).trim()); } catch (e) {} }
            };
            _sr.onerror = function (ev) {
                var e = ev && ev.error;
                // 'no-speech' a 'aborted' jsou běžné a přejdou. Ostatní chyby přepis
                // ukončí — startovat ho dokola je přesně to, co appku sekalo.
                if (e === 'not-allowed' || e === 'service-not-allowed') _srDead = true;
                else if (e === 'audio-capture' || e === 'network' || e === 'language-not-supported') _srSoft = true;
                var why = srWhyOff();
                if (why) { _srOn = false; srClearRetry(); showLive(why, true); }
            };
            _sr.onend = function () {
                if (!_srOn) return;
                // Prohlížeč rozpoznávání po pauze v řeči sám ukončí; dokud nahráváme,
                // jedeme dál. VŽDY ale přes časovač a se stropem — dřív se tu volalo
                // start() rovnou a při opakovaném selhání z toho byla smyčka, která
                // zablokovala UI (a tím i tlačítko STOP).
                if (!_rec || _srDead || _srSoft) { _srOn = false; return; }
                srClearRetry();
                _srRetry = setTimeout(function () {
                    _srRetry = null;
                    if (!_srOn || !_rec) return;
                    if (!srStart()) { _srOn = false; _srSoft = true; showLive(srWhyOff() || '', true); }
                }, SR_GAP_MS);
            };
            if (!srStart()) { _sr = null; _srOn = false; return false; }
            return true;
        } catch (e) { _sr = null; _srOn = false; return false; }
    }
    // zastavení přepisu: každý krok zvlášť, pád jednoho nesmí zabránit ostatním
    function stopSR() {
        _srOn = false;
        srClearRetry();
        var sr = _sr; _sr = null;
        var out = (_srFinal + ' ' + _srInterim).trim();
        _srFinal = ''; _srInterim = '';
        if (!sr) return '';
        try { sr.onend = null; sr.onerror = null; sr.onresult = null; } catch (e) {}
        try { sr.stop(); } catch (e2) {}
        try { if (sr.abort) sr.abort(); } catch (e3) {}   // jistota, že pustí mikrofon
        return fixGeo(out);
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
    function isRecording() { return !!_rec || _recStarting; }
    function clearRecTimers() {
        if (_recTimer) { try { clearInterval(_recTimer); } catch (e) {} _recTimer = null; }
        if (_recWd) { try { clearTimeout(_recWd); } catch (e2) {} _recWd = null; }
    }
    // Uvolnění mikrofonu je SAMOSTATNÝ krok a musí projít vždycky: iOS jinak drží
    // audio session, škrtí kameru v AR a ikona nahrávání zůstane svítit.
    function releaseMic() {
        var s = _stream; _stream = null;
        if (!s) return;
        var tr = [];
        try { tr = s.getTracks ? s.getTracks() : []; } catch (e) {}
        for (var i = 0; i < tr.length; i++) { try { tr[i].stop(); } catch (e2) {} }
    }
    function tickRec() {
        // časovač nesmí spadnout — vypadl by z něj i strop délky poznámky
        try {
            var s = (Date.now() - _recT0) / 1000;
            var el = document.getElementById('ag-hl-rectime');
            if (el) el.textContent = fmtDur(s);
            if (s >= MAX_SEC) { toast('Poznámka má ' + Math.round(MAX_SEC / 60) + ' minut — ukončuji.'); stopRec(); }
        } catch (e) { clearRecTimers(); }
    }
    function startRec() {
        if (isRecording()) return;
        if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            toast('Tenhle prohlížeč neumí nahrávat zvuk (MediaRecorder chybí).');
            return;
        }
        _recStarting = true; _recAbort = false; _recStopping = false; _srSoft = false;
        syncRecUi('wait');
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            _recStarting = false;
            _stream = stream;
            // mezitím mohl přijít STOP nebo se zavřelo okno → mikrofon hned pustit
            if (_recAbort) { _recAbort = false; releaseMic(); syncRecUi(false); return; }
            // georazítko se bere HNED při startu (než se stihne odejít od místa)
            _recGeo = { lat: null, lng: null, acc: null };
            try {
                if (typeof userLat !== 'undefined' && userLat != null) {
                    _recGeo.lat = userLat; _recGeo.lng = userLng;
                    if (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy != null) _recGeo.acc = currentGpsAccuracy;
                }
            } catch (e) {}
            var mime = pickMime();
            try {
                _rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
            } catch (e2) {
                _rec = null; releaseMic(); syncRecUi(false);
                toast('Nahrávání se nepodařilo spustit (formát zvuku).');
                return;
            }
            _chunks = []; _recDone = false;
            // Známka nahrávání: po pojistce (viz stopRec) může starý rekordér ještě
            // doručit kus zvuku. Bez téhle kontroly by spadl do NÁSLEDUJÍCÍ poznámky.
            var sess = ++_recSess;
            _rec.ondataavailable = function (ev) { if (sess === _recSess && ev.data && ev.data.size) _chunks.push(ev.data); };
            _rec.onstop = function () { if (sess === _recSess) onRecStop(); };
            // chyba rekordéru dřív nechala tlačítko navěky v „Nahrávám" — teď se dokončí
            _rec.onerror = function () {
                if (sess !== _recSess) return;
                toast('Nahrávání skončilo chybou — ukládám, co je.');
                stopRec();
            };
            try { _rec.start(); } catch (e3) {
                _rec = null; _recDone = true; releaseMic(); syncRecUi(false);
                toast('Nahrávání se nepodařilo spustit.');
                return;
            }
            _recT0 = Date.now();
            clearRecTimers();
            _recTimer = setInterval(tickRec, 250);
            syncRecUi(true);
            startSR(showLive);           // přepis běží souběžně; když ho prohlížeč neumí, zvuk jede dál
        })['catch'](function () {
            _recStarting = false; _recAbort = false;
            releaseMic();
            syncRecUi(false);
            toast('Mikrofon se nepodařilo spustit — zkontroluj povolení pro mikrofon.');
        });
    }
    // STOP musí zastavit VŽDY — každý krok zvlášť, aby pád jednoho nezablokoval ostatní
    function stopRec() {
        if (_recStarting) { _recAbort = true; syncRecUi(false); return; }   // ještě běží dotaz na mikrofon
        if (!_rec) {                                                        // nic neběží — pro jistotu uklidit
            clearRecTimers();
            if (!_dictFor) { try { stopSR(); } catch (e) {} }               // běžící dodiktování nezabíjet
            releaseMic(); syncRecUi(false); return;
        }
        if (_recStopping) return;                                           // druhé klepnutí na STOP
        _recStopping = true;
        clearRecTimers();                                                   // časovač jako první
        var st = '';
        try { st = _rec.state; } catch (e2) {}
        try { if (st !== 'inactive') _rec.stop(); } catch (e3) {}
        if (st === 'inactive') { onRecStop(); return; }                     // rekordér už skončil sám, onstop nepřijde
        // pojistka: na iOS umí audio session skončit tak, že onstop nedorazí
        _recWd = setTimeout(function () { _recWd = null; onRecStop(); }, STOP_WD_MS);
    }
    function onRecStop() {
        if (_recDone) return;         // onstop i pojistka vedou sem — dokončit se smí jen jednou
        _recDone = true;
        _recSess++;                   // co dorazí od starého rekordéru později, už není naše
        clearRecTimers();
        var recorder = _rec; _rec = null; _recStopping = false;
        var text = '';
        try { text = stopSR(); } catch (e) {}      // pád přepisu nesmí zdržet uvolnění mikrofonu
        releaseMic();
        syncRecUi(false);
        var dur = (Date.now() - _recT0) / 1000;
        var haveAudio = _chunks.length > 0;
        // uložíme, pokud je co uložit: zvuk NEBO aspoň přepis (kdyby selhalo nahrávání)
        if ((!haveAudio && !text) || dur < 0.8) { toast('Poznámka je moc krátká, neukládám.'); _chunks = []; return; }
        var mime = haveAudio ? ((recorder && recorder.mimeType) || _chunks[0].type || 'audio/webm') : null;
        var blob = haveAudio ? new Blob(_chunks, { type: mime }) : null;
        _chunks = [];
        var near = _recGeo ? nearestPoint(_recGeo.lat, _recGeo.lng) : null;
        var rec = {
            id: 'hl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            pid: pid(), ts: _recT0, dur: dur, mime: mime, blob: blob, txt: text, note: '',
            lat: _recGeo ? _recGeo.lat : null, lng: _recGeo ? _recGeo.lng : null, acc: _recGeo ? _recGeo.acc : null,
            ptName: near ? near.name : null, ptDist: near ? Math.round(near.d) : null
        };
        dbPut(rec).then(function () {
            var why = '';
            if (!text) {
                var off = srWhyOff();
                why = off ? ' ' + off : (txtOn() ? ' Přepis se nepovedl — text dopiš nebo nadiktuj.' : '');
            }
            toast('Hlasovka uložena' + (rec.ptName ? ' (u bodu ' + rec.ptName + ')' : '') + '.' + why);
            renderList();
        }, function () { toast('Uložení se nepovedlo (IndexedDB).'); });
    }
    function showLive(t, info) {
        var el = document.getElementById('ag-hl-live');
        if (!el) return;
        el.style.display = 'block';
        el.classList.toggle('info', !!info);
        el.textContent = t || 'Poslouchám…';
    }
    function hideLive() {
        var el = document.getElementById('ag-hl-live');
        if (!el) return;
        el.style.display = 'none';
        el.textContent = '';
        el.classList.remove('info');
    }
    // stav: false = nic, 'wait' = čekáme na povolení mikrofonu, true = nahrává se
    function syncRecUi(state) {
        var on = !!state;
        var b = document.getElementById('ag-hl-recbtn');
        if (b) {
            b.classList.toggle('rec', on);
            b.innerHTML = (state === 'wait')
                ? 'Zapínám mikrofon… — klepni pro zrušení'
                : (on
                    ? '<span class="dot"></span> Nahrávám… <span id="ag-hl-rectime">0:00</span> — klepni pro STOP'
                    : '● Nahrát poznámku');
        }
        if (!on) { if (!_dictFor) hideLive(); return; }
        // POCTIVĚ: když přepis nejede, řekni to hned — ne až po uložení
        var why = srWhyOff();
        if (why) showLive(why, true);
        else if (txtOn()) showLive('');
        else hideLive();
    }
    // Úklid, který musí proběhnout, i když se okno zavře křížkem/gestem
    // (modal-close.js) nebo appka jde do pozadí — jinak visí mikrofon.
    function cleanupAll() {
        try { if (isRecording()) stopRec(); } catch (e) {}
        try { if (_dictFor) stopDictate(); } catch (e2) {}
        try { stopPlay(); } catch (e3) {}
    }

    // ---- dodiktování textu k existující poznámce -----------------------------------------
    // Když přepis selhal (offline, hluk), jde text doplnit hlasem později — bez
    // nahrávání zvuku, jen rozpoznávání.
    function dictateInto(rec, btn) {
        if (isRecording()) { toast('Nejdřív ukonči nahrávání.'); return; }
        if (!srCtor()) { toast('Rozpoznávání řeči tenhle prohlížeč neumí — text napiš ručně.'); return; }
        if (_dictFor) { stopDictate(); return; }
        _srDead = false; _srSoft = false;
        var ta = document.querySelector('#ag-hl-modal .ag-hl-item[data-id="' + rec.id + '"] .ag-hl-note');
        var base = ta ? ta.value : recText(rec);
        _dictFor = rec.id;
        _dictCtx = { rec: rec, btn: btn, base: base, ta: ta };
        if (btn) { btn.classList.add('on'); btn.textContent = 'Poslouchám… STOP'; }
        var ok = startSR(function (t) { if (ta) ta.value = (base ? base + ' ' : '') + t; });
        if (!ok) { resetDict(); toast('Rozpoznávání se nepodařilo spustit.'); return; }
        // bez nahrávání prohlížeč rozpoznávání po pauze ukončí — dorazíme to sami
        if (_sr) _sr.onend = function () { if (_dictFor) finishDictate(); };
    }
    function resetDict() {
        var c = _dictCtx; _dictCtx = null; _dictFor = null;
        if (c && c.btn) { try { c.btn.classList.remove('on'); c.btn.textContent = 'Diktovat'; } catch (e) {} }
        if (!isRecording()) hideLive();
    }
    // Zastavení nesmí čekat na onend (nemusí dorazit) — dokončíme rovnou.
    function stopDictate() { if (_dictFor) finishDictate(); }
    function finishDictate() {
        var c = _dictCtx;
        var t = '';
        try { t = stopSR(); } catch (e) {}
        resetDict();
        if (!c) return;
        if (!t) { toast('Nic jsem nezachytil.'); return; }
        c.rec.txt = ((c.base ? c.base + ' ' : '') + t).trim();
        if (c.ta) c.ta.value = c.rec.txt;
        dbPut(c.rec).then(function () { toast('Text doplněn.'); }, function () { toast('Uložení se nepovedlo (IndexedDB).'); });
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
        if (!rec.blob) { toast('Tahle poznámka je jen textová.'); return; }
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
        if (!rec.blob) return null;
        var ext = /mp4/.test(rec.mime) ? 'm4a' : (/webm/.test(rec.mime) ? 'webm' : 'audio');
        var d = new Date(rec.ts);
        var name = 'hlasovka_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.' + ext;
        try { return new File([rec.blob], name, { type: rec.mime }); } catch (e) { return null; }
    }
    function shareRec(rec) {
        var f = fileFor(rec);
        var txt = 'Hlasovka ' + fmtT(rec.ts) + ' — ' + projName()
            + (rec.ptName ? ' — u bodu ' + rec.ptName : '') + ' — ' + geoStamp(rec)
            + (recText(rec) ? '\n' + recText(rec) : '');
        if (f && navigator.canShare && navigator.canShare({ files: [f] })) {
            navigator.share({ files: [f], title: 'Hlasová poznámka', text: txt })['catch'](function () {});
            return;
        }
        // bez zvuku (textová poznámka) sdílíme aspoň text
        if (!f) {
            if (navigator.share) { navigator.share({ title: 'Poznámka', text: txt })['catch'](function () {}); return; }
            try { navigator.clipboard.writeText(txt); toast('Zkopírováno do schránky.'); } catch (e) { toast('Sdílení není k dispozici.'); }
            return;
        }
        // fallback: stáhnout soubor
        var url = URL.createObjectURL(rec.blob);
        var a = document.createElement('a');
        a.href = url; a.download = f.name;
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
            '  font:700 16px/1.2 var(--font-ui,system-ui);cursor:pointer;margin:2px 0 8px;}',
            '#ag-hl-recbtn.rec{background:rgba(220,68,68,0.16);border-color:rgba(220,68,68,0.5);color:#f87171;}',
            '#ag-hl-recbtn .dot{display:inline-block;width:10px;height:10px;border-radius:99px;background:#f87171;',
            '  margin-right:6px;animation:ag-hl-blink 1s infinite;}',
            '@keyframes ag-hl-blink{0%,100%{opacity:1}50%{opacity:0.25}}',
            // živý přepis pod tlačítkem
            '#ag-hl-live{display:none;margin:0 0 10px;padding:9px 11px;border-radius:12px;',
            '  border:1px dashed var(--accent-line,rgba(47,158,116,0.4));background:rgba(47,158,116,0.07);',
            '  font:500 13px/1.45 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);',
            '  max-height:88px;overflow-y:auto;}',
            // stejné okénko, ale když poctivě hlásí, že přepis nejede
            '#ag-hl-live.info{border-style:solid;border-color:rgba(251,191,36,0.45);',
            '  background:rgba(251,191,36,0.09);color:#fbbf24;}',
            // hlavička: přepínač přepisu + filtr
            '#ag-hl-modal .ag-hl-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px;}',
            '#ag-hl-modal .ag-hl-chk{display:flex;align-items:center;gap:7px;font:500 12.5px/1.3 var(--font-ui,system-ui);',
            '  color:var(--text-muted,#9aa1ac);cursor:pointer;}',
            '#ag-hl-find{flex:1;min-width:120px;padding:8px 11px;border-radius:10px;box-sizing:border-box;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--glass-bg,rgba(255,255,255,0.05));',
            '  color:var(--text-color,#e6e8eb);font:500 13px/1.3 var(--font-ui,system-ui);}',
            '#ag-hl-modal .ag-hl-day{font:700 12.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);',
            '  text-transform:uppercase;letter-spacing:0.04em;margin:10px 0 6px;}',
            '#ag-hl-modal .ag-hl-item{background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  border-radius:14px;padding:10px 12px;margin-bottom:8px;}',
            '#ag-hl-modal .ag-hl-top{display:flex;align-items:center;gap:10px;}',
            '#ag-hl-modal .ag-hl-play{width:42px;height:42px;flex:none;border-radius:99px;border:1px solid var(--accent-line,rgba(47,158,116,0.4));',
            '  background:transparent;color:var(--accent,#2f9e74);font-size:16px;cursor:pointer;}',
            '#ag-hl-modal .ag-hl-play.on{background:var(--accent-soft,rgba(47,158,116,0.18));}',
            '#ag-hl-modal .ag-hl-play[disabled]{opacity:0.35;}',
            '#ag-hl-modal .ag-hl-meta{flex:1;min-width:0;font:500 12.5px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#c3c9d2);word-break:break-word;}',
            '#ag-hl-modal .ag-hl-meta b{color:var(--text-color,#e6e8eb);font-size:13.5px;}',
            // přepis = hlavní obsah poznámky, proto textarea (ne jednořádkový input)
            '#ag-hl-modal .ag-hl-note{width:100%;margin-top:8px;padding:8px 10px;border-radius:10px;box-sizing:border-box;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--glass-bg,rgba(255,255,255,0.05));',
            '  color:var(--text-color,#e6e8eb);font:500 13.5px/1.45 var(--font-ui,system-ui);resize:vertical;min-height:52px;}',
            '#ag-hl-modal .ag-hl-empty-txt{margin-top:8px;font:500 12.5px/1.4 var(--font-ui,system-ui);color:#fbbf24;font-style:italic;}',
            '#ag-hl-modal .ag-hl-acts{display:flex;gap:8px;margin-top:8px;}',
            '#ag-hl-modal .ag-hl-acts button{flex:1;padding:7px 8px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,0.14));',
            '  background:transparent;color:var(--text-muted,#c3c9d2);font:600 12.5px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '#ag-hl-modal .ag-hl-acts button.on{border-color:rgba(220,68,68,0.5);color:#f87171;}',
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
            var total = mine.length;
            if (_filter) {
                var q = _filter.toLowerCase();
                mine = mine.filter(function (r) {
                    return recText(r).toLowerCase().indexOf(q) >= 0
                        || String(r.ptName || '').toLowerCase().indexOf(q) >= 0;
                });
            }
            // filtr má smysl, až když je co filtrovat
            var find = document.getElementById('ag-hl-find');
            if (find) find.style.display = (total >= 4) ? 'block' : 'none';

            if (!mine.length) {
                // nápověda nesmí slibovat přepis tam, kde ho prohlížeč neumí
                var hint = 'Zatím žádné hlasovky v této zakázce. Klepni nahoře na Nahrát, řekni co vidíš, klepnutím zastavíš — '
                    + (srCtor() ? 'appka to rovnou přepíše na text.' : 'poznámka se uloží jako zvuk (přepis tenhle prohlížeč neumí) a text můžeš dopsat.');
                box.innerHTML = '<div class="ag-hl-empty">' + (total ? 'Nic neodpovídá hledání.' : hint) + '</div>';
                return;
            }
            var h = '', lastDay = '';
            mine.forEach(function (r) {
                var day = fmtDay(r.ts);
                if (day !== lastDay) { h += '<div class="ag-hl-day">' + esc(day) + '</div>'; lastDay = day; }
                var t = recText(r);
                h += '<div class="ag-hl-item" data-id="' + esc(r.id) + '">'
                    + '<div class="ag-hl-top">'
                    + '<button type="button" class="ag-hl-play" aria-label="Přehrát"' + (r.blob ? '' : ' disabled') + '>▶</button>'
                    + '<div class="ag-hl-meta"><b>' + esc(fmtT(r.ts)) + ' · ' + esc(fmtDur(r.dur)) + '</b>'
                    + (r.ptName ? ' · u bodu <b>' + esc(r.ptName) + '</b>' + (r.ptDist != null ? ' (' + r.ptDist + ' m)' : '') : '')
                    + '<br>' + esc(geoStamp(r)) + '</div>'
                    + '</div>'
                    + (t ? '' : '<div class="ag-hl-empty-txt">Bez přepisu — přehraj a dopiš, nebo klepni na Diktovat.</div>')
                    + '<textarea class="ag-hl-note" rows="2" placeholder="Přepis poznámky…" maxlength="2000">' + esc(t) + '</textarea>'
                    + '<div class="ag-hl-acts">'
                    + '<button type="button" class="ag-hl-dict">Diktovat</button>'
                    + '<button type="button" class="ag-hl-share">Sdílet</button>'
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
                    item.querySelector('.ag-hl-dict').addEventListener('click', function () { dictateInto(rec, this); });
                    var noteEl = item.querySelector('.ag-hl-note');
                    noteEl.addEventListener('change', function () {
                        rec.txt = this.value.slice(0, 2000);
                        rec.note = '';
                        dbPut(rec);
                        // varování „bez přepisu" po dopsání textu už nemá co říkat
                        var warn = item.querySelector('.ag-hl-empty-txt');
                        if (warn && rec.txt) warn.remove();
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
                '  <div id="ag-hl-live"></div>' +
                '  <div class="ag-hl-bar">' +
                '    <label class="ag-hl-chk"><input type="checkbox" id="ag-hl-txtchk"> Přepisovat na text</label>' +
                '    <input type="text" id="ag-hl-find" placeholder="Hledat v poznámkách…" style="display:none;">' +
                '  </div>' +
                '  <div id="ag-hl-list"></div>' +
                '  <div class="ag-hl-foot">' +
                '    <button type="button" class="btn btn-secondary" id="ag-hl-close">Zavřít</button>' +
                '  </div>' +
                '</div>';
            document.body.appendChild(m);
            m.querySelector('#ag-hl-recbtn').addEventListener('click', function () {
                // pád obsluhy by zabil i STOP — proto celé v try
                try { isRecording() ? stopRec() : startRec(); }
                catch (e) { try { cleanupAll(); } catch (e2) {} toast('Nahrávání se zaseklo — ukončeno.'); }
            });
            m.querySelector('#ag-hl-close').addEventListener('click', function () {
                cleanupAll();
                m.style.display = 'none';
            });
            // Okno umí zavřít i křížek a potáhnutí dolů (modal-close.js). Když by
            // se to stalo mimo naše tlačítko, visel by mikrofon — hlídáme display.
            try {
                new MutationObserver(function () {
                    if (m.style.display === 'none' && (isRecording() || _dictFor || _playingId)) cleanupAll();
                }).observe(m, { attributes: true, attributeFilter: ['style'] });
            } catch (e) {}
            var chk = m.querySelector('#ag-hl-txtchk');
            chk.addEventListener('change', function () {
                try { localStorage.setItem(TXT_KEY, this.checked ? '1' : '0'); } catch (e) {}
                if (this.checked) { _srDead = false; _srSoft = false; }
                syncRecUi(isRecording() ? (_rec ? true : 'wait') : false);
            });
            var find = m.querySelector('#ag-hl-find');
            find.addEventListener('input', function () { _filter = this.value.trim(); renderList(); });
        }
        var c = m.querySelector('#ag-hl-txtchk');
        c.checked = txtOn();
        c.disabled = !srCtor();
        if (!srCtor()) {
            var lab = c.parentNode;
            if (lab && lab.textContent.indexOf('neumí') < 0) lab.appendChild(document.createTextNode(' — prohlížeč neumí'));
        }
        m.style.display = 'flex';
        syncRecUi(_rec ? true : (_recStarting ? 'wait' : false));
        renderList();
    }

    // Appka v pozadí (přepnutí na jinou appku, zhasnutí displeje): iOS audio session
    // stejně skončí — radši nahrávku poctivě uložit a mikrofon pustit, než ho nechat viset.
    try {
        window.addEventListener('pagehide', function () { cleanupAll(); });
        document.addEventListener('visibilitychange', function () {
            if (document.hidden && isRecording()) stopRec();
        });
    } catch (e) {}

    // ---- veřejné API (Deník dne) -----------------------------------------------------------
    window.AGHlasovky = {
        listRange: function (p, from, to) {
            return dbAll().then(function (all) {
                return all
                    .filter(function (r) { return r && r.pid === p && r.ts >= from && r.ts < to; })
                    .sort(function (a, b) { return a.ts - b.ts; })
                    .map(function (r) { return { ts: r.ts, dur: r.dur, note: recText(r), ptName: r.ptName || null, ptDist: r.ptDist != null ? r.ptDist : null }; });
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
