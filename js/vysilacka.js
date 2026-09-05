// ===== AR Geodet — VYSÍLAČKA: kde je kolega, rychlé zprávy, Man Down (ODPOJITELNÁ) =
// K čemu to je: měřič u přístroje a figurant s výtyčkou se dorozumívají křikem přes
// silnici nebo telefonem, který se v rukavicích nedá ovládat. Tenhle nástroj dělá tři
// věci, které se v terénu potřebují pořád:
//   1) KDE JE KDO — poslední známá poloha lidí ve firmě: vzdálenost, směr (šipka
//      podle kompasu) a JAK STARÁ ta poloha je. Volitelně i značky v mapě.
//   2) RYCHLÉ ZPRÁVY — jedno ťuknutí místo psaní: „Můžu měřit", „Hledám bod",
//      „Stavím stativ", „Přesouvám se"… Odejde do firemního chatu (takže je to
//      dohledatelné) a zároveň se to objeví jako stav u tvé polohy.
//   3) MAN DOWN — když telefon zaznamená volný pád nebo tvrdý náraz a pak se
//      DELŠÍ DOBU NEHÝBE, spustí odpočet. Když ho nezrušíš, odejde nouzová zpráva
//      se souřadnicemi kolegům a nabídne se SMS a tísňová linka.
//
// CO TO NEUMÍ A PROČ SE TO ŘÍKÁ NAHLAS (jinak by to bylo nebezpečné):
//   • Hlídání pádu i vysílání polohy běží JEN dokud je aplikace vepředu. Telefon
//     v kapse se zamčeným displejem prohlížeči uspí JavaScript — iOS ho utne během
//     vteřin. Proto se při zapnutí drží displej rozsvícený (wake lock) a v okně je
//     napsané, kdy hlídání neběželo. Tohle NENÍ náhrada za PERS/SOS zařízení.
//   • Poloha se posílá jen když ji sám zapneš, a jde o POSLEDNÍ ZNÁMÝ BOD, ne o
//     stopu. Server drží jeden přepisovaný řádek na člověka (cloud/worker.js,
//     tabulka pos) — kudy jsi dneska chodil, se odsud vyčíst nedá. Záměrně:
//     nástroj má odpovědět „kde je kolega teď", ne sledovat zaměstnance.
//   • Nouzová zpráva jde přes firemní cloud a POTŘEBUJE SIGNÁL. Bez signálu okno
//     poctivě nabídne SMS a volání, které jdou přes síť operátora (ta bývá i tam,
//     kde nejsou data).
//
// STARŠÍ SERVER: „Kde je kdo" potřebuje endpoint /pos, který přibyl s tímhle
// nástrojem. Když firma jede na starší verzi workeru, poloha se vypne a napíše se
// to; rychlé zprávy i Man Down (přes /chat) fungují dál.
//
// NEEDITUJE logika.js ani grafika.js. Staví na js/ucty.js (AGUcty.cloudFetch).
// Odstranění: smaž js/vysilacka.js + řádek <script> v index.html a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGVysilacka) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="9" width="10" height="12" rx="2"/><path d="M12 9V5"/><path d="M12 5 17 2"/><path d="M9.5 13h5"/><path d="M4 11a8 8 0 0 1 2.2-4.6M20 11a8 8 0 0 0-2.2-4.6"/></svg>';
    var STYLE_ID = 'ag-vs-style';
    var LS = 'agVysilacka_v1';        // {share, md, seenSos}
    var POLL_OPEN_MS = 15000;         // dotaz na server, když je okno otevřené
    var POLL_BG_MS = 60000;           // na pozadí (jen když vysílám polohu)
    var SEND_MS = 25000;              // jak často nejdřív poslat vlastní polohu
    var SEND_MIN_M = 6;               // …a jen když jsem se posunul aspoň o tolik
    var STALE_M = 8 * 60000;          // starší poloha už se v seznamu bere jako „stará"

    // Rychlé zprávy: krátké věty, které si dvojice v terénu říká pořád dokola.
    // st = stav u polohy (do seznamu lidí), txt = text do chatu.
    var QUICK = [
        { st: 'Můžu měřit', txt: 'Můžu měřit — jsem připraven.' },
        { st: 'Hledám bod', txt: 'Hledám bod.' },
        { st: 'Stavím stativ', txt: 'Stavím stativ.' },
        { st: 'Přesouvám se', txt: 'Přesouvám se na další bod.' },
        { st: 'Čekám na tebe', txt: 'Čekám na tebe.' },
        { st: 'Zopakuj bod', txt: 'Zopakuj poslední bod — neuložilo se.' },
        { st: 'Přestávka', txt: 'Dávám si pauzu.' },
        { st: 'Hotovo', txt: 'Hotovo, balím.' }
    ];

    // ---- Man Down: prahy -----------------------------------------------------------
    // Volný pád = zrychlení se blíží nule (telefon padá s tělem). Náraz = špička nad
    // 2,5 g. Samotný pád ještě není nouze — teprve KLID PO NĚM. Prahy jsou schválně
    // konzervativní: planý poplach každou chvíli by vedl k tomu, že si to člověk vypne.
    var G = 9.81;
    var FALL_LOW = 3.5;               // m/s² — pod tím je to volný pád
    var FALL_MS = 90;                 // jak dlouho musí volný pád trvat
    var IMPACT = 25;                  // m/s² — tvrdý náraz
    var STILL_MS = 12000;             // jak dlouho po pádu musí být klid
    var STILL_DEV = 0.9;              // m/s² — kolísání, které se ještě bere jako klid
    var COUNT_S = 30;                 // odpočet, ve kterém jde poplach zrušit

    function U() { return window.AGUcty || null; }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:toast'); } }
    function info(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert(t, m); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:info'); } toast(m); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmtT(ts) { var d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    function ago(ms) {
        var s = Math.round(ms / 1000);
        if (s < 60) return 'před ' + s + ' s';
        var m = Math.round(s / 60);
        if (m < 60) return 'před ' + m + ' min';
        return 'před ' + Math.round(m / 60) + ' h';
    }
    function cfg() {
        var o = {};
        try { o = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:cfg'); }
        if (typeof o.share !== 'boolean') o.share = false;
        if (typeof o.md !== 'boolean') o.md = false;
        return o;
    }
    function saveCfg(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:saveCfg'); } }
    // S-JTSK počítá VÝHRADNĚ GeoCore: je to jediné místo v appce, které si ověří
    // POŘADÍ OS Křováku (_resolveAxis v js/geo-core.js). Dřív tu byla vlastní záloha
    // přes proj4 s pořadím zadrátovaným natvrdo ([-Y, -X]) — jenže právě to je věc,
    // která se při bumpu proj4 nebo přidání +axis= může změnit: GeoCore to ohlásí
    // a přehodí, záloha by osy TIŠE prohodila a bod by skončil o stovky km jinde.
    // V geodetické appce je „souřadnici neznám" lepší než „souřadnice vedle".
    function toSJTSK(lat, lng) {
        try { if (window.GeoCore && GeoCore.toSJTSK) return GeoCore.toSJTSK(lat, lng); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:toSJTSK'); }
        // do protokolu jen jednou za sezení — toSJTSK se volá v cyklu přes všechny body
        if (!toSJTSK._warn) { toSJTSK._warn = 1; try { if (window.agErrLog) agErrLog.record('vysilacka: chybí GeoCore — S-JTSK se nepočítá'); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'vysilacka:toSJTSK'); } }
        return null;
    }
    function fmtNum(v) { return v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    // VZDÁLENOST: nejdřív obě autority — globální getDistance (js/logika.js) a GeoCore.
    // Nouzový výpočet tu ZŮSTÁVÁ schválně: null by se v porovnání typu `d <= LIMIT`
    // přetypoval na 0, tedy „bod je na dosah" — tichá lež horší než chyba v centimetrech.
    // Počítá se ale Gaussovým poloměrem ve střední šířce, ne globální konstantou
    // 6371 km: ta v ČR zkracovala KAŽDOU vzdálenost o ~1700 ppm = 17 cm na 100 m.
    function dist(la1, lo1, la2, lo2) {
        try { if (typeof getDistance === 'function') return getDistance(la1, lo1, la2, lo2); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:dist'); }
        try { if (window.GeoCore && GeoCore.getDistance) return GeoCore.getDistance(la1, lo1, la2, lo2); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'vysilacka:dist'); }
        var r = Math.PI / 180, A = 6378137.0, E2 = 0.00669438002290;      // GRS80
        var sm = Math.sin((la1 + la2) / 2 * r), w2 = 1 - E2 * sm * sm, w = Math.sqrt(w2);
        var R = Math.sqrt((A * (1 - E2) / (w2 * w)) * (A / w));           // Gaussův poloměr sqrt(M*N)
        var a = Math.sin((la2 - la1) * r / 2), b = Math.sin((lo2 - lo1) * r / 2);
        var h = a * a + Math.cos(la1 * r) * Math.cos(la2 * r) * b * b;
        return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    function bearing(la1, lo1, la2, lo2) {
        var r = Math.PI / 180;
        var y = Math.sin((lo2 - lo1) * r) * Math.cos(la2 * r);
        var x = Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos((lo2 - lo1) * r);
        return (Math.atan2(y, x) / r + 360) % 360;
    }
    function myPos() {
        try {
            if (typeof userLat !== 'undefined' && userLat != null) {
                return { lat: userLat, lng: userLng, acc: (typeof currentGpsAccuracy !== 'undefined' ? currentGpsAccuracy : null) };
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:myPos'); }
        return null;
    }
    function jobName() {
        try {
            var id = localStorage.getItem('arActiveProjectId') || 'default';
            if (typeof projects !== 'undefined' && Array.isArray(projects)) {
                for (var i = 0; i < projects.length; i++) if (projects[i] && projects[i].id === id) return projects[i].name || id;
            }
            return id === 'default' ? '' : id;
        } catch (e) { return ''; }
    }
    function cloudOn() {
        var u = U();
        try { return !!(u && u.isCloud && u.isCloud() && u.currentUser && u.currentUser()); } catch (e) { return false; }
    }

    // ---- stav -----------------------------------------------------------------------
    var _people = [], _meId = null, _srvSkew = 0;
    var _poll = null, _pollMs = 0;
    var _sendT = null, _lastSent = null, _lastSentTs = 0, _myState = '';
    var _posUnsupported = false;      // server nezná /pos (starší worker)
    var _layer = null, _mapOn = false;
    var _open = false;
    var _wake = null;

    // ---- posílání vlastní polohy -------------------------------------------------------
    function postPos(force, sos) {
        var u = U();
        if (!cloudOn() || _posUnsupported) return Promise.resolve(false);
        var p = myPos();
        if (!p && !sos) return Promise.resolve(false);
        var now = Date.now();
        if (!force && !sos && _lastSent && p) {
            var moved = dist(p.lat, p.lng, _lastSent.lat, _lastSent.lng);
            if (moved < SEND_MIN_M && (now - _lastSentTs) < 3 * SEND_MS) return Promise.resolve(false);
        }
        return u.cloudFetch('/pos', {
            method: 'POST',
            body: {
                lat: p ? p.lat : null, lng: p ? p.lng : null, acc: p ? p.acc : null,
                st: _myState || null, job: jobName() || null, sos: sos ? 1 : 0
            }
        }).then(function (r) {
            if (r.status === 404) { _posUnsupported = true; renderPeople(); return false; }
            if (r.ok) { if (p) { _lastSent = { lat: p.lat, lng: p.lng }; _lastSentTs = now; } return true; }
            return false;
        });
    }
    function startSending() {
        if (_sendT) return;
        postPos(true, false);
        _sendT = setInterval(function () { postPos(false, false); }, SEND_MS);
    }
    function stopSending() {
        if (_sendT) { clearInterval(_sendT); _sendT = null; }
        // poslední hlášení s prázdným stavem: kolegům pak poloha zestárne a zmizí sama
        _lastSent = null;
    }

    // ---- stahování polohy ostatních -------------------------------------------------------
    function pull() {
        var u = U();
        if (!cloudOn() || _posUnsupported) { renderPeople(); return; }
        u.cloudFetch('/pos').then(function (r) {
            if (r.status === 404) { _posUnsupported = true; renderPeople(); return; }
            if (!r.ok || !r.data) { renderPeople(); return; }
            _meId = (r.data.me && r.data.me.id) || _meId;
            _srvSkew = (r.data.serverTime || Date.now()) - Date.now();
            _people = (r.data.people || []).filter(function (x) { return x && x.uid !== _meId; });
            checkSos();
            renderPeople();
            if (_mapOn) drawLayer();
        });
    }
    function setPoll(ms) {
        if (_poll && _pollMs === ms) return;
        if (_poll) { clearInterval(_poll); _poll = null; }
        _pollMs = ms;
        if (!ms) return;
        pull();
        _poll = setInterval(pull, ms);
    }
    // Poplach kolegy nesmí zapadnout: hlásí se hlasitě i mimo otevřené okno
    // (na pozadí se ale dotazuje jen ten, kdo sám vysílá polohu — jinak by to
    // znamenalo dotazy na server celý den kvůli nikomu).
    var _sosSeen = {};
    function checkSos() {
        _people.forEach(function (p) {
            if (!p.sos) { delete _sosSeen[p.uid]; return; }
            var key = p.uid + '_' + (p.sosTs || p.ts);
            if (_sosSeen[key]) return;
            _sosSeen[key] = 1;
            try { if (navigator.vibrate) navigator.vibrate([200, 120, 200, 120, 400]); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:checkSos'); }
            var d = '';
            var me = myPos();
            if (me && p.lat != null) d = ' · ' + Math.round(dist(me.lat, me.lng, p.lat, p.lng)) + ' m odsud';
            info('NOUZE: ' + (p.u || 'kolega'),
                '<b>' + esc(p.u || 'Kolega') + '</b> hlásí nouzi (' + esc(ago(Date.now() - (p.sosTs || p.ts))) + ').'
                + (p.lat != null ? '<br><br>Poslední poloha: ' + esc(sjText(p)) + d : '<br><br>Poloha není známá.')
                + '<br><br>Otevři Vysílačku — je tam navigace k němu.');
        });
    }
    function sjText(p) {
        if (p.lat == null) return 'neznámá';
        var sj = toSJTSK(p.lat, p.lng);
        return sj ? ('Y ' + fmtNum(sj.y) + ' · X ' + fmtNum(sj.x)) : (p.lat.toFixed(6) + ', ' + p.lng.toFixed(6));
    }

    // ---- rychlé zprávy ------------------------------------------------------------------------
    function sendQuick(q) {
        _myState = q.st;
        var u = U();
        if (!cloudOn()) { info('Chybí firemní účet', 'Rychlé zprávy jdou přes firemní cloud — přihlas se do firmy.'); return; }
        u.cloudFetch('/chat', { method: 'POST', body: { txt: q.txt } }).then(function (r) {
            if (r.ok) toast('Odesláno: ' + q.st + '.');
            else if (r.status === 0) toast('Bez signálu — zpráva neodešla.');
            else toast('Zprávu se nepodařilo odeslat.');
        });
        postPos(true, false);
        renderQuick();
    }

    // ---- Man Down ------------------------------------------------------------------------------
    var _md = {
        on: false, listener: null, buf: [],
        fallStart: 0, armedAt: 0,     // armedAt > 0 = po pádu se sleduje klid
        alarmT: null, left: 0, alarmEl: null,
        pausedAt: 0, pausedMs: 0, audio: null
    };
    function mdSupported() { return typeof DeviceMotionEvent !== 'undefined'; }
    function mdNeedsPerm() {
        try { return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'; } catch (e) { return false; }
    }
    function mdStart() {
        if (_md.on) return Promise.resolve(true);
        if (!mdSupported()) { info('Nejde zapnout', 'Tenhle prohlížeč nehlásí pohybová čidla — detekce pádu nemůže fungovat.'); return Promise.resolve(false); }
        var pre = mdNeedsPerm()
            ? DeviceMotionEvent.requestPermission().then(function (s) { return s === 'granted'; })['catch'](function () { return false; })
            : Promise.resolve(true);
        return pre.then(function (ok) {
            if (!ok) { info('Bez povolení to nejde', 'iOS nepustil aplikaci k pohybovým čidlům. Povolení se ptá jen na klepnutí — zkus přepínač znovu.'); return false; }
            _md.on = true; _md.buf = []; _md.fallStart = 0; _md.armedAt = 0; _md.pausedMs = 0; _md.pausedAt = 0;
            _md.listener = onMotion;
            window.addEventListener('devicemotion', _md.listener);
            lockScreen();
            return true;
        });
    }
    function mdStop() {
        if (_md.listener) { try { window.removeEventListener('devicemotion', _md.listener); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:mdStop'); } _md.listener = null; }
        _md.on = false; _md.armedAt = 0; _md.buf = [];
        cancelAlarm(true);
        unlockScreen();
    }
    function lockScreen() {
        try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { _wake = w; })['catch'](function () {}); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:lockScreen'); }
    }
    function unlockScreen() {
        try { if (_wake) { _wake.release(); _wake = null; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:unlockScreen'); }
    }
    function onMotion(ev) {
        var a = ev.accelerationIncludingGravity;
        if (!a || a.x == null) return;
        var m = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
        var now = Date.now();
        // klouzavé okno pro posouzení klidu (drží se jen tolik, kolik STILL_MS potřebuje)
        _md.buf.push({ t: now, m: m });
        while (_md.buf.length && now - _md.buf[0].t > STILL_MS + 2000) _md.buf.shift();

        if (_md.armedAt) {
            if (now - _md.armedAt >= STILL_MS) {
                if (isStill(now - STILL_MS)) { _md.armedAt = 0; raiseAlarm('pád a pak klid'); }
                else _md.armedAt = 0;                   // hýbe se → planý poplach, zpět k hlídání
            }
            return;
        }
        if (m > IMPACT) { _md.armedAt = now; _md.fallStart = 0; return; }
        if (m < FALL_LOW) {
            if (!_md.fallStart) _md.fallStart = now;
            else if (now - _md.fallStart >= FALL_MS) { _md.armedAt = now; _md.fallStart = 0; }
        } else _md.fallStart = 0;
    }
    function isStill(fromTs) {
        var s = _md.buf.filter(function (r) { return r.t >= fromTs; });
        if (s.length < 8) return false;                 // málo vzorků = radši nehlásit
        var sum = 0, i;
        for (i = 0; i < s.length; i++) sum += s[i].m;
        var avg = sum / s.length, dev = 0;
        for (i = 0; i < s.length; i++) dev += Math.abs(s[i].m - avg);
        dev /= s.length;
        // navíc: průměr musí sedět kolem 1 g — telefon volně letící vzduchem není „klid"
        return dev < STILL_DEV && Math.abs(avg - G) < 4;
    }
    function beep() {
        try {
            var C = window.AudioContext || window.webkitAudioContext;
            if (!C) return;
            if (!_md.audio) _md.audio = new C();
            var o = _md.audio.createOscillator(), g = _md.audio.createGain();
            o.type = 'square'; o.frequency.value = 880;
            g.gain.value = 0.12;
            o.connect(g); g.connect(_md.audio.destination);
            o.start(); setTimeout(function () { try { o.stop(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:beep'); } }, 180);
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:beep'); }
    }
    function raiseAlarm(why) {
        if (_md.alarmT) return;
        _md.left = COUNT_S;
        var el = document.getElementById('ag-vs-alarm');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ag-vs-alarm';
            el.innerHTML =
                '<div class="ag-vs-abox">'
                + '  <div class="ag-vs-ah">Spadl jsi?</div>'
                + '  <div class="ag-vs-aw" id="ag-vs-awhy"></div>'
                + '  <div class="ag-vs-acount" id="ag-vs-acount">30</div>'
                + '  <div class="ag-vs-asub">Za tolik sekund odejde nouzová zpráva kolegům.</div>'
                + '  <button type="button" class="ag-vs-aok" id="ag-vs-aok">Jsem v pořádku</button>'
                + '  <button type="button" class="ag-vs-anow" id="ag-vs-anow">Poslat nouzi hned</button>'
                + '</div>';
            document.body.appendChild(el);
            el.querySelector('#ag-vs-aok').addEventListener('click', function () { cancelAlarm(false); toast('Poplach zrušen.'); });
            el.querySelector('#ag-vs-anow').addEventListener('click', function () { cancelAlarm(true); fireSos(); });
        }
        _md.alarmEl = el;
        el.querySelector('#ag-vs-awhy').textContent = 'Telefon zaznamenal ' + why + '.';
        el.style.display = 'flex';
        tickAlarm();
        _md.alarmT = setInterval(tickAlarm, 1000);
    }
    function tickAlarm() {
        var c = document.getElementById('ag-vs-acount');
        if (c) c.textContent = String(_md.left);
        try { if (navigator.vibrate) navigator.vibrate(300); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:tickAlarm'); }
        beep();
        if (_md.left <= 0) { cancelAlarm(true); fireSos(); return; }
        _md.left--;
    }
    function cancelAlarm(silent) {
        if (_md.alarmT) { clearInterval(_md.alarmT); _md.alarmT = null; }
        var el = document.getElementById('ag-vs-alarm');
        if (el) el.style.display = 'none';
        _md.armedAt = 0; _md.buf = [];
        if (!silent) { /* zrušeno uživatelem — nic dál */ }
    }
    // Nouze: co nejvíc cest naráz, protože každá z nich může selhat.
    function fireSos() {
        var p = myPos();
        var txt = 'NOUZE — automatická detekce pádu. '
            + (p ? ('Poloha: ' + sjText({ lat: p.lat, lng: p.lng }) + (p.acc != null ? ' (±' + Math.round(p.acc) + ' m)' : '')
                + ' · https://mapy.cz/?q=' + p.lat.toFixed(6) + ',' + p.lng.toFixed(6))
                : 'Poloha není známá.')
            + ' Čas ' + fmtT(Date.now()) + '.';
        var sent = false;
        if (cloudOn()) {
            U().cloudFetch('/chat', { method: 'POST', body: { txt: txt } }).then(function (r) {
                sent = !!r.ok;
                showSosPanel(txt, sent);
            });
            postPos(true, true);
        } else {
            showSosPanel(txt, false);
        }
    }
    // Po odeslání zůstane na obrazovce panel s ručními cestami — appka SAMA nikam
    // nevolá a neposílá SMS (prohlížeč to neumí a předstírat to by bylo nebezpečné).
    function showSosPanel(txt, sentToChat) {
        var el = document.getElementById('ag-vs-sos');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ag-vs-sos';
            document.body.appendChild(el);
        }
        var ct = null;
        try {
            var c = JSON.parse(localStorage.getItem('agSafety_v1') || '{}');
            if (c && c.contacts && c.contacts.length) ct = c.contacts[0];
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:showSosPanel'); }
        el.innerHTML =
            '<div class="ag-vs-sbox">'
            + '<div class="ag-vs-sh">Nouzová zpráva</div>'
            + '<div class="ag-vs-st">' + (sentToChat ? 'Odesláno kolegům do firemního chatu.' : 'Zprávu se NEPODAŘILO odeslat (chybí signál nebo firemní účet). Použij tlačítka níž.') + '</div>'
            + '<div class="ag-vs-stx">' + esc(txt) + '</div>'
            + '<a class="ag-vs-sbtn call" href="tel:112">Volat 112</a>'
            + (ct ? '<a class="ag-vs-sbtn" href="sms:' + esc(ct.p) + '?&body=' + encodeURIComponent(txt) + '">SMS: ' + esc(ct.n || ct.p) + '</a>' : '')
            + '<button type="button" class="ag-vs-sbtn" id="ag-vs-scopy">Zkopírovat text</button>'
            + '<button type="button" class="ag-vs-sbtn off" id="ag-vs-sclose">Planý poplach — odvolat</button>'
            + '</div>';
        el.style.display = 'flex';
        el.querySelector('#ag-vs-scopy').addEventListener('click', function () {
            try { navigator.clipboard.writeText(txt); toast('Zkopírováno.'); } catch (e) { toast('Kopírování nejde.'); }
        });
        el.querySelector('#ag-vs-sclose').addEventListener('click', function () {
            el.style.display = 'none';
            if (cloudOn()) {
                postPos(true, false);
                U().cloudFetch('/chat', { method: 'POST', body: { txt: 'Planý poplach — jsem v pořádku.' } });
            }
            toast('Poplach odvolán.');
        });
    }

    // ---- mapová vrstva -------------------------------------------------------------------------
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function drawLayer() {
        var m = getMap();
        if (!m || typeof L === 'undefined') return;
        if (_layer) { try { m.removeLayer(_layer); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:drawLayer'); } _layer = null; }
        var live = _people.filter(function (p) { return p.lat != null; });
        if (!live.length) return;
        _layer = L.layerGroup();
        live.forEach(function (p) {
            try {
                var col = p.sos ? '#ef4444' : ((Date.now() - p.ts) > STALE_M ? '#9aa1ac' : '#2f9e74');
                L.marker([p.lat, p.lng], {
                    icon: L.divIcon({
                        className: 'ag-vs-mk',
                        html: '<div style="width:14px;height:14px;border-radius:99px;background:' + col + ';border:2px solid #fff;box-shadow:0 1px 4px #000;"></div>'
                            + '<div style="font-size:10px;background:rgba(0,0,0,.65);color:#fff;padding:1px 4px;border-radius:4px;white-space:nowrap;margin-top:2px;">' + esc(p.u || '?') + '</div>',
                        iconSize: [0, 0], iconAnchor: [7, 7]
                    }),
                    interactive: false, zIndexOffset: 900
                }).addTo(_layer);
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:drawLayer'); }
        });
        _layer.addTo(m);
    }
    function toggleMap() {
        var m = getMap();
        if (!m) { toast('Mapa není k dispozici.'); return; }
        _mapOn = !_mapOn;
        if (!_mapOn && _layer) { try { m.removeLayer(_layer); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:toggleMap'); } _layer = null; toast('Kolegové v mapě skrytí.'); }
        else { drawLayer(); toast(_layer ? 'Kolegové jsou v mapě.' : 'Zatím nikoho nevidím.'); }
        renderPeople();
    }

    // ---- styly ------------------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-vs-modal .modal-content{display:flex;flex-direction:column;}',
            '#ag-vs-body{flex:1;overflow-y:auto;min-height:0;}',
            '.ag-vs-h{font:700 11px/1 var(--font-display,system-ui);letter-spacing:.09em;text-transform:uppercase;',
            '  color:var(--text-muted,#9aa1ac);margin:14px 0 7px;}',
            '.ag-vs-h:first-child{margin-top:0;}',
            // rychlé zprávy
            '#ag-vs-quick{display:grid;grid-template-columns:1fr 1fr;gap:7px;}',
            '#ag-vs-quick button{padding:12px 10px;border-radius:12px;cursor:pointer;text-align:left;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.12));background:var(--glass-bg,rgba(255,255,255,0.05));',
            '  color:var(--text-color,#e6e8eb);font:600 13.5px/1.25 var(--font-ui,system-ui);}',
            '#ag-vs-quick button.on{border-color:var(--accent-line,rgba(47,158,116,0.5));background:var(--accent-soft,rgba(47,158,116,0.16));color:var(--accent,#2f9e74);}',
            '#ag-vs-quick button:active{transform:scale(0.98);}',
            // lidé
            '.ag-vs-p{display:flex;align-items:center;gap:11px;padding:10px 12px;margin-bottom:7px;border-radius:13px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '.ag-vs-p.sos{border-color:rgba(239,68,68,0.6);background:rgba(239,68,68,0.12);}',
            '.ag-vs-p.stale{opacity:0.62;}',
            '.ag-vs-arrow{flex:none;width:38px;height:38px;border-radius:99px;display:flex;align-items:center;justify-content:center;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.4));color:var(--accent,#2f9e74);font-size:19px;}',
            '.ag-vs-p.sos .ag-vs-arrow{border-color:rgba(239,68,68,0.6);color:#f87171;}',
            '.ag-vs-pt{flex:1;min-width:0;font:500 12px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.ag-vs-pt b{display:block;font-size:14px;color:var(--text-color,#e6e8eb);}',
            '.ag-vs-pt .stx{color:var(--accent,#2f9e74);font-weight:600;}',
            '.ag-vs-d{flex:none;text-align:right;font:700 14px/1.2 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '.ag-vs-d small{display:block;font:500 10.5px/1.3 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            // přepínače
            '.ag-vs-sw{display:flex;align-items:center;gap:10px;padding:11px 12px;margin-bottom:7px;border-radius:13px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '.ag-vs-sw input{width:20px;height:20px;flex:none;accent-color:var(--accent,#2f9e74);}',
            '.ag-vs-sw .tx{flex:1;min-width:0;font:600 13.5px/1.35 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '.ag-vs-sw .tx small{display:block;font:500 11.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin-top:2px;}',
            '.ag-vs-note{padding:9px 11px;border-radius:11px;margin-bottom:8px;font:500 12px/1.45 var(--font-ui,system-ui);',
            '  border:1px solid rgba(251,191,36,0.42);background:rgba(251,191,36,0.09);color:#fbbf24;}',
            '.ag-vs-empty{font:500 13px/1.5 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);font-style:italic;padding:6px 2px;}',
            '#ag-vs-modal .ag-vs-foot{display:flex;gap:8px;margin-top:12px;}',
            '#ag-vs-modal .ag-vs-foot .btn{flex:1;}',
            // poplach
            '#ag-vs-alarm{position:fixed;inset:0;z-index:1000090;display:none;align-items:center;justify-content:center;background:rgba(120,10,10,0.94);}',
            '.ag-vs-abox{width:min(92vw,420px);padding:22px;text-align:center;color:#fff;}',
            '.ag-vs-ah{font:800 26px/1.2 var(--font-display,system-ui);margin-bottom:6px;}',
            '.ag-vs-aw{font:500 13px/1.5 var(--font-ui,system-ui);opacity:0.85;}',
            '.ag-vs-acount{font:800 76px/1 var(--font-display,system-ui);margin:12px 0 2px;}',
            '.ag-vs-asub{font:500 13px/1.5 var(--font-ui,system-ui);opacity:0.85;margin-bottom:20px;}',
            '.ag-vs-aok{width:100%;padding:22px;border:0;border-radius:16px;background:#fff;color:#7a0d0d;',
            '  font:800 20px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '.ag-vs-anow{width:100%;margin-top:10px;padding:13px;border:1px solid rgba(255,255,255,0.5);border-radius:14px;',
            '  background:transparent;color:#fff;font:700 14px/1 var(--font-ui,system-ui);cursor:pointer;}',
            // panel po odeslání nouze
            '#ag-vs-sos{position:fixed;inset:0;z-index:1000091;display:none;align-items:center;justify-content:center;background:rgba(8,10,14,0.95);}',
            '.ag-vs-sbox{width:min(92vw,420px);padding:20px;color:#fff;}',
            '.ag-vs-sh{font:800 22px/1.2 var(--font-display,system-ui);margin-bottom:6px;}',
            '.ag-vs-st{font:600 13px/1.5 var(--font-ui,system-ui);color:#fbbf24;margin-bottom:10px;}',
            '.ag-vs-stx{font:500 12px/1.5 var(--font-ui,system-ui);opacity:0.85;background:rgba(255,255,255,0.07);',
            '  border-radius:10px;padding:10px 12px;margin-bottom:14px;word-break:break-word;}',
            '.ag-vs-sbtn{display:block;width:100%;box-sizing:border-box;margin-bottom:9px;padding:15px;border-radius:14px;text-align:center;',
            '  border:1px solid rgba(255,255,255,0.28);background:rgba(255,255,255,0.08);color:#fff;text-decoration:none;',
            '  font:700 15px/1 var(--font-ui,system-ui);cursor:pointer;}',
            '.ag-vs-sbtn.call{background:#ef4444;border-color:#ef4444;}',
            '.ag-vs-sbtn.off{background:transparent;color:#9aa1ac;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    // ---- vykreslení ---------------------------------------------------------------------------------
    function renderQuick() {
        var box = document.getElementById('ag-vs-quick');
        if (!box) return;
        var h = '';
        QUICK.forEach(function (q, i) {
            h += '<button type="button" data-i="' + i + '"' + (_myState === q.st ? ' class="on"' : '') + '>' + esc(q.st) + '</button>';
        });
        box.innerHTML = h;
        var bs = box.querySelectorAll('button');
        for (var i = 0; i < bs.length; i++) {
            (function (b) {
                b.addEventListener('click', function () { sendQuick(QUICK[+b.getAttribute('data-i')]); });
            })(bs[i]);
        }
    }
    function renderPeople() {
        var box = document.getElementById('ag-vs-people');
        if (!box) return;
        if (!cloudOn()) {
            box.innerHTML = '<div class="ag-vs-note">Bez firemního účtu vidí appka jen sebe. Poloha kolegů i rychlé zprávy '
                + 'jdou přes firemní cloud — přihlas se do firmy. <b>Detekce pádu funguje i tak</b> (nabídne SMS a tísňovou linku).</div>';
            return;
        }
        if (_posUnsupported) {
            box.innerHTML = '<div class="ag-vs-note">Firemní server běží ve starší verzi, která ještě neumí sdílet polohu '
                + '(chybí endpoint <b>/pos</b>). Nasaď aktuální cloud/worker.js. Rychlé zprávy a nouzová zpráva fungují i teď.</div>';
            return;
        }
        if (!_people.length) {
            box.innerHTML = '<div class="ag-vs-empty">Nikdo další právě nevysílá polohu. Kolega ji zapne přepínačem dole ve svém telefonu.</div>';
            return;
        }
        var me = myPos();
        var hd = null;
        try { if (typeof currentHeading === 'number' && isFinite(currentHeading)) hd = currentHeading; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:renderPeople'); }
        var h = '';
        _people.sort(function (a, b) { return (b.sos || 0) - (a.sos || 0) || b.ts - a.ts; });
        _people.forEach(function (p) {
            var age = Date.now() + _srvSkew - p.ts;
            var stale = age > STALE_M;
            var d = null, br = null;
            if (me && p.lat != null) { d = dist(me.lat, me.lng, p.lat, p.lng); br = bearing(me.lat, me.lng, p.lat, p.lng); }
            var rot = (br != null && hd != null) ? (br - hd) : null;
            h += '<div class="ag-vs-p' + (p.sos ? ' sos' : '') + (stale ? ' stale' : '') + '">'
                + '<div class="ag-vs-arrow"' + (rot != null ? ' style="transform:rotate(' + rot.toFixed(0) + 'deg);"' : '') + '>'
                + (rot != null ? '↑' : '?') + '</div>'
                + '<div class="ag-vs-pt"><b>' + esc(p.u || 'Kolega') + (p.sos ? ' — NOUZE' : '') + '</b>'
                + (p.st ? '<span class="stx">' + esc(p.st) + '</span>' : '')
                + esc(sjText(p)) + (p.acc != null ? ' (±' + Math.round(p.acc) + ' m)' : '')
                + (p.job ? '<br>' + esc(p.job) : '')
                + '</div>'
                + '<div class="ag-vs-d">' + (d != null ? (d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km') : '—')
                + '<small>' + esc(ago(age)) + '</small></div>'
                + '</div>';
        });
        box.innerHTML = h;
    }
    function renderSwitches() {
        var c = cfg();
        var s = document.getElementById('ag-vs-share'), m = document.getElementById('ag-vs-md');
        if (s) s.checked = !!c.share;
        if (m) m.checked = !!c.md;
        var mb = document.getElementById('ag-vs-mapbtn');
        if (mb) mb.textContent = _mapOn ? 'Skrýt z mapy' : 'Ukázat v mapě';
        var w = document.getElementById('ag-vs-mdnote');
        if (w) {
            w.style.display = c.md ? 'block' : 'none';
            w.innerHTML = 'Hlídání běží <b>jen dokud je appka vepředu</b> — displej se proto drží rozsvícený. '
                + 'Telefon zamčený v kapse prohlížeč uspí a pád nezaznamená.'
                + (_md.pausedMs > 60000 ? '<br>Zatím nehlídáno celkem ' + Math.round(_md.pausedMs / 60000) + ' min (appka byla v pozadí).' : '');
        }
    }
    function renderAll() { renderQuick(); renderPeople(); renderSwitches(); }

    // ---- zapnutí / vypnutí funkcí -----------------------------------------------------------------------
    function setShare(on) {
        var c = cfg(); c.share = !!on; saveCfg(c);
        if (on) {
            if (!cloudOn()) { toast('Nejdřív se přihlas do firmy.'); c.share = false; saveCfg(c); renderSwitches(); return; }
            startSending();
            setPoll(_open ? POLL_OPEN_MS : POLL_BG_MS);
        } else {
            stopSending();
            setPoll(_open ? POLL_OPEN_MS : 0);
        }
        renderSwitches();
    }
    function setMd(on) {
        var c = cfg();
        if (on) {
            mdStart().then(function (ok) {
                c.md = !!ok; saveCfg(c);
                if (ok) toast('Hlídání pádu je zapnuté.');
                renderSwitches();
            });
            return;
        }
        c.md = false; saveCfg(c);
        mdStop();
        renderSwitches();
    }

    // ---- modal --------------------------------------------------------------------------------------------
    function open() {
        injectStyles();
        var m = document.getElementById('ag-vs-modal');
        if (!m) {
            m = document.createElement('div');
            m.className = 'modal-overlay';
            m.id = 'ag-vs-modal';
            m.innerHTML =
                '<div class="modal-content">' +
                '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Vysílačka</h3>' +
                '  <div id="ag-vs-body">' +
                '    <div class="ag-vs-h">Rychlá zpráva</div>' +
                '    <div id="ag-vs-quick"></div>' +
                '    <div class="ag-vs-h">Kde je kdo</div>' +
                '    <div id="ag-vs-people"></div>' +
                '    <div class="ag-vs-h">Nastavení</div>' +
                '    <label class="ag-vs-sw"><input type="checkbox" id="ag-vs-share">' +
                '      <span class="tx">Vysílat moji polohu<small>Kolegové ve firmě uvidí, kde jsi. Posílá se poslední známý bod, ne stopa — a jen dokud je appka otevřená.</small></span></label>' +
                '    <label class="ag-vs-sw"><input type="checkbox" id="ag-vs-md">' +
                '      <span class="tx">Hlídat pád (Man Down)<small>Volný pád nebo náraz a pak klid = odpočet 30 s a nouzová zpráva kolegům.</small></span></label>' +
                '    <div class="ag-vs-note" id="ag-vs-mdnote" style="display:none;"></div>' +
                '  </div>' +
                '  <div class="ag-vs-foot">' +
                '    <button type="button" class="btn btn-secondary" id="ag-vs-mapbtn">Ukázat v mapě</button>' +
                '    <button type="button" class="btn btn-secondary" id="ag-vs-close">Zavřít</button>' +
                '  </div>' +
                '</div>';
            document.body.appendChild(m);
            m.querySelector('#ag-vs-share').addEventListener('change', function () { setShare(this.checked); });
            m.querySelector('#ag-vs-md').addEventListener('change', function () { setMd(this.checked); });
            m.querySelector('#ag-vs-mapbtn').addEventListener('click', toggleMap);
            m.querySelector('#ag-vs-close').addEventListener('click', function () { m.style.display = 'none'; });
            try {
                new MutationObserver(function () {
                    if (m.style.display === 'none') onClosed();
                }).observe(m, { attributes: true, attributeFilter: ['style'] });
            } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:open'); }
        }
        _open = true;
        m.style.display = 'flex';
        renderAll();
        setPoll(POLL_OPEN_MS);
    }
    function onClosed() {
        _open = false;
        // Na pozadí se dál dotazujeme jen tomu, kdo sám vysílá — jinak by z toho byl
        // dotaz na server každou minutu celý den kvůli nikomu.
        setPoll(cfg().share ? POLL_BG_MS : 0);
    }

    // Když jde appka do pozadí, čidla i síť usnou. Poctivě si to poznamenáme, ať se dá
    // v okně napsat, jak dlouho se NEhlídalo — mlčení by budilo dojem, že hlídání běželo.
    try {
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) { if (_md.on) _md.pausedAt = Date.now(); }
            else {
                if (_md.on && _md.pausedAt) { _md.pausedMs += Date.now() - _md.pausedAt; _md.pausedAt = 0; _md.buf = []; _md.armedAt = 0; }
                if (_md.on && !_wake) lockScreen();
                if (_open || cfg().share) pull();
            }
        });
        window.addEventListener('pagehide', function () { unlockScreen(); });
    } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'vysilacka:onClosed'); }

    // ---- start ------------------------------------------------------------------------------------------------
    // Po startu appky se obnoví jen to, co si uživatel zapnul. Man Down se ZÁMĚRNĚ
    // neobnovuje sám: iOS chce na pohybová čidla povolení z klepnutí, takže by se
    // tvářil zapnutě a nehlídal. Vypnutý přepínač je poctivější než falešná jistota.
    function boot() {
        var c = cfg();
        if (c.md) { c.md = false; saveCfg(c); }
        if (c.share && cloudOn()) { startSending(); setPoll(POLL_BG_MS); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 2500); });
    else setTimeout(boot, 2500);

    // ---- dlaždice v Nástrojích -------------------------------------------------------------------------------------
    var _tries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'vysilacka', label: 'Vysílačka', icon: ICON, cat: 'Pomůcky', onClick: open, order: 11 });
            return;
        }
        if (_tries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.AGVysilacka = { open: open, sos: fireSos, setShare: setShare };
    window.agOpenVysilacka = open;
})();
