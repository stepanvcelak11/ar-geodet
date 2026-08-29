// ===== AR Geodet — HLASOVÉ KÓDOVÁNÍ BODU (ODPOJITELNÁ vrstva) ===================
// K čemu: při tachymetrii se u každého bodu vyťukává číslo, kód a poznámka. V
// rukavicích, v dešti a s výtyčkou v druhé ruce je to nejpomalejší část práce.
// Tady se řekne jedna věta — „Bod 105, roh plotu, poznámka zborceno" — appka ji
// rozebere na číslo / kód / poznámku, ukáže to velkým písmem ke kontrole a po
// povelu „ulož" založí bod z průměrované GPS.
//
// PROČ JEN OMEZENÁ GRAMATIKA (a ne ovládání celé appky hlasem):
// v hluku finišeru a s větrem do mikrofonu má rozpoznávání chybovost, se kterou
// se nedá pouštět libovolný příkaz. Tady je slovník malý a uzavřený: číslo, kód,
// poznámka, výška + hrstka povelů. Co appka nepozná, NEUDĚLÁ — a co pozná, ukáže
// ke kontrole dřív, než se to uloží. Nic se neukládá bez povelu „ulož" (nebo
// klepnutí) — hlas se dá snadno zaslechnout od kolegy a tiché ukládání cizích vět
// by bylo horší než ruční psaní.
//
// POTŘEBUJE SIGNÁL: prohlížeč posílá zvuk na server výrobce (Web Speech API).
// Bez dat rozpoznávání nejede a na iPhonu ho Safari často neumí vůbec. Okno to
// napíše hned nahoře a nabídne náhradní cestu — nahrát hlasovku (js/hlasovky.js),
// která se přepíše, až bude signál.
//
// ZVUKOVÁ ZPĚTNÁ VAZBA: hands-free má smysl jen když člověk nemusí koukat na
// displej, proto appka po uložení řekne „uloženo 105" (SpeechSynthesis) a pípne.
// Vypínatelné přepínačem — v pracovní době kolegů kolem to může vadit.
//
// POLOHA: bod se NEUKLÁDÁ z jednoho fixu. Po povelu „ulož" se GPS průměruje
// (výchozí 5 s) a teprve pak bod vznikne — se zapsanou dosaženou přesností a
// rozptylem. Bod se zakládá oficiální cestou window.addImportedPoints (původ
// gps-avg), takže platí i lokalizace, žurnál a všechno ostatní jako u ručního bodu.
//
// NEEDITUJE logika.js ani grafika.js. Odstranění: smaž js/hlas-kod.js + řádek
// <script> v index.html a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGHlasKod) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="2.5" width="5" height="10" rx="2.5"/><path d="M5 10.5a6 6 0 0 0 12 0"/><path d="M11 16.5v2"/><path d="M17.5 17.5h4M19.5 15.5v4"/></svg>';
    var STYLE_ID = 'ag-hk-style';
    var LS = 'agHlasKod_v1';          // {avg, say}
    var AVG_DEF = 5;                  // s — výchozí doba průměrování GPS
    var SR_GAP_MS = 350;              // odstup restartu rozpoznávání (vzor hlasovky.js)
    var SR_MAX_STARTS = 60;

    // ---- bezdiakritická kopie věty --------------------------------------------------
    // POZOR, TOHLE JE PODSTATNÉ: `\b` v JavaScriptu je ASCII hranice slova, takže
    // /\bulož\b/ NIKDY nesedne — za „ž" (neASCII) žádná hranice není. Všechny vzory
    // proto běží nad kopií BEZ diakritiky a malými písmeny. Náhrada je znak za znak,
    // takže se NEPOSUNOU indexy a text (kód, poznámka) se pořád vyřezává z originálu.
    var DEA = {
        'á': 'a', 'ä': 'a', 'č': 'c', 'ď': 'd', 'é': 'e', 'ě': 'e', 'ë': 'e', 'í': 'i', 'ï': 'i',
        'ĺ': 'l', 'ľ': 'l', 'ň': 'n', 'ó': 'o', 'ô': 'o', 'ö': 'o', 'ŕ': 'r', 'ř': 'r', 'š': 's',
        'ť': 't', 'ú': 'u', 'ů': 'u', 'ü': 'u', 'ý': 'y', 'ž': 'z'
    };
    function deacc(s) {
        return String(s == null ? '' : s).toLowerCase().replace(/[^\u0000-\u007f]/g, function (c) {
            return DEA.hasOwnProperty(c) ? DEA[c] : c;
        });
    }

    // ---- slovník kódů ---------------------------------------------------------------
    // ZÁMĚRNĚ KONZERVATIVNÍ: jen ustálené výrazy z terénu, které diktát komolí nebo
    // píše víceslovně. Nikdy sem nedávej běžné slovo — přepsat uživateli, co řekl,
    // je horší než nechat kód tak, jak ho vyslovil. Vzory se testují nad bezdiakritickou
    // kopií, výsledek se zapíše správně česky.
    var CODE_FIX = [
        [/roh\s+plotu/, 'roh plotu'],
        [/roh\s+budovy/, 'roh budovy'],
        [/(hrana|kraj)\s+asfaltu/, 'hrana asfaltu'],
        [/obrub/, 'obruba'],
        [/(sacht|kanal)/, 'šachta'],
        [/vpust/, 'vpusť'],
        [/sloup/, 'sloup'],
        [/strom/, 'strom'],
        [/meznik/, 'mezník'],
        [/hreb/, 'hřeb'],
        [/pata\s+svahu/, 'pata svahu'],
        [/hrana\s+svahu/, 'hrana svahu'],
        [/osa\s+komunikace/, 'osa komunikace']
    ];
    // Povely. Krátké a jednoznačné, ať je diktát netrefí náhodou. Bez diakritiky!
    var CMD_SAVE = /\b(uloz(it|te)?|zapis|zapsat|potvrdit|hotovo)\b/;
    var CMD_CLEAR = /\b(zrus(it)?|smaz|vymaz|znovu|oprav)\b/;
    var CMD_STOP = /\b(konec|stop|dost|vypni)\b/;
    var CMD_NEXT = /\b(dalsi|dal)\b/;

    var _sr = null, _srOn = false, _srDead = false, _srSoft = false, _srStarts = 0, _srRetry = null;
    var _draft = { name: '', kod: '', note: '', vyska: null };
    var _avgT = null, _samples = [], _avgUntil = 0;
    var _hist = [];
    var _wake = null;
    var _lastHeard = '';

    // ---- pomocné -------------------------------------------------------------------
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) {} }
    function info(t, m) { try { if (typeof window.agAlert === 'function') return window.agAlert(t, m); } catch (e) {} toast(m); }
    function cfg() {
        var o = {};
        try { o = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) {}
        if (!isFinite(o.avg) || o.avg < 1 || o.avg > 60) o.avg = AVG_DEF;
        if (typeof o.say !== 'boolean') o.say = true;
        return o;
    }
    function saveCfg(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {} }
    function srCtor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
    function say(t) {
        if (!cfg().say) return;
        try {
            if (!window.speechSynthesis) return;
            var u = new SpeechSynthesisUtterance(String(t));
            u.lang = 'cs-CZ'; u.rate = 1.05;
            window.speechSynthesis.speak(u);
        } catch (e) {}
    }
    function beep(ok) {
        try {
            var C = window.AudioContext || window.webkitAudioContext;
            if (!C) return;
            var ctx = beep._c || (beep._c = new C());
            var o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.value = ok ? 1040 : 300;
            g.gain.value = 0.09;
            o.connect(g); g.connect(ctx.destination);
            o.start(); setTimeout(function () { try { o.stop(); } catch (e) {} }, ok ? 110 : 220);
        } catch (e) {}
    }
    function lockScreen() {
        try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { _wake = w; })['catch'](function () {}); } catch (e) {}
    }
    function unlockScreen() { try { if (_wake) { _wake.release(); _wake = null; } } catch (e) {} }

    // ---- rozbor věty ------------------------------------------------------------------
    // Vrací, co ve větě bylo — pole, která ve větě nezazněla, zůstávají beze změny.
    // Díky tomu jde diktovat po částech („bod 105" … „kód obruba" … „ulož").
    function parse(txt) {
        var raw = ' ' + String(txt || '').replace(/\s+/g, ' ').trim() + ' ';
        var n = deacc(raw);                 // stejna delka jako raw -> indexy sedi
        var out = {};
        function pad(k) { return new Array(k + 1).join(' '); }
        // vyrizly kus se NEMAZE, jen prepise mezerami - kdyby se zkracovalo, rozesly
        // by se indexy mezi raw a n a kod by se vyrizl odjinud
        function blank(from, len) {
            var p = pad(len);
            raw = raw.slice(0, from) + p + raw.slice(from + len);
            n = n.slice(0, from) + p + n.slice(from + len);
        }

        // 1) poznamka - bere cely zbytek vety, proto se odrizne jako prvni
        var m = /\bpoznamk[auoy]\b\s*(\S.*)$/.exec(n);
        if (m) {
            var s1 = m.index + (m[0].length - m[1].length);
            out.note = raw.slice(s1).trim().slice(0, 200);
            blank(m.index, m[0].length);
        }
        // 2) vyska rucne (nivelace, lat) - jinak se bere z GPS
        m = /\bvysk[auy]\b\s*(-?\d+(?:[.,]\d+)?)/.exec(n);
        if (m) { out.vyska = parseFloat(m[1].replace(',', '.')); blank(m.index, m[0].length); }
        // 3) cislo bodu: "bod 105" / "cislo 105"; jinak prvni samostatne cislo ve vete
        m = /\b(?:bod|cislo)\b\s*([a-z]{0,3}\s?\d{1,6})/.exec(n);
        if (m) {
            var s2 = m.index + (m[0].length - m[1].length);
            out.name = raw.slice(s2, s2 + m[1].length).replace(/\s+/g, '');
            blank(m.index, m[0].length);
        } else {
            m = /(?:^|\s)(\d{1,6})(?=\s|$)/.exec(n);
            if (m) { var s3 = m.index + m[0].indexOf(m[1]); out.name = m[1]; blank(s3, m[1].length); }
        }
        // 4) kod: bud vyslovne ("kod obruba"), nebo co ve vete zbylo po odecteni povelu
        var restRaw = raw, restN = n;
        m = /\bkod\b\s*(\S.*)$/.exec(n);
        if (m) {
            var s4 = m.index + (m[0].length - m[1].length);
            restRaw = raw.slice(s4); restN = n.slice(s4);
        }
        [CMD_SAVE, CMD_CLEAR, CMD_STOP, CMD_NEXT].forEach(function (re) {
            var mm = re.exec(restN);
            while (mm) {
                var p = pad(mm[0].length);
                restRaw = restRaw.slice(0, mm.index) + p + restRaw.slice(mm.index + mm[0].length);
                restN = restN.slice(0, mm.index) + p + restN.slice(mm.index + mm[0].length);
                mm = re.exec(restN);
            }
        });
        var rest = restRaw.replace(/\s+/g, ' ').trim();
        if (rest) {
            var rn = deacc(rest);
            for (var i = 0; i < CODE_FIX.length; i++) {
                if (CODE_FIX[i][0].test(rn)) { rest = CODE_FIX[i][1]; break; }
            }
            out.kod = rest.slice(0, 60);
        }
        return out;
    }
    function applyParsed(p) {
        if (p.name) _draft.name = p.name;
        if (p.kod) _draft.kod = p.kod;
        if (p.note) _draft.note = p.note;
        if (p.vyska != null && isFinite(p.vyska)) _draft.vyska = p.vyska;
    }

    // ---- rozpoznávání ---------------------------------------------------------------------
    function srWhyOff() {
        if (!srCtor()) return 'Rozpoznávání řeči tenhle prohlížeč neumí (typicky iPhone a PWA). Použij Hlasové poznámky — nahrají zvuk a přepíšou ho, až bude signál.';
        if (_srDead) return 'Prohlížeč nepovolil mikrofon pro rozpoznávání řeči.';
        if (_srSoft) return 'Rozpoznávání se nepovedlo (chybí signál nebo mikrofon drží něco jiného).';
        return null;
    }
    function srClearRetry() { if (_srRetry) { try { clearTimeout(_srRetry); } catch (e) {} _srRetry = null; } }
    function srStart() {
        if (!_sr || !_srOn) return false;
        if (_srStarts >= SR_MAX_STARTS) return false;
        _srStarts++;
        try { _sr.start(); return true; } catch (e) { return false; }
    }
    function listen() {
        var C = srCtor();
        if (!C) { info('Nejde poslouchat', srWhyOff()); return; }
        if (_srOn) return;
        _srDead = false; _srSoft = false;
        try {
            _sr = new C();
            _sr.lang = 'cs-CZ';
            _sr.continuous = true;
            _sr.interimResults = true;
            _srOn = true; _srStarts = 0;
            _sr.onresult = function (ev) {
                _srStarts = 0;
                var finalTxt = '', interim = '';
                for (var i = ev.resultIndex; i < ev.results.length; i++) {
                    var r = ev.results[i];
                    if (r.isFinal) finalTxt += r[0].transcript + ' ';
                    else interim += r[0].transcript;
                }
                _lastHeard = (finalTxt + interim).trim();
                showHeard(_lastHeard);
                if (finalTxt.trim()) handleSentence(finalTxt.trim());
            };
            _sr.onerror = function (ev) {
                var e = ev && ev.error;
                if (e === 'not-allowed' || e === 'service-not-allowed') _srDead = true;
                else if (e === 'audio-capture' || e === 'network' || e === 'language-not-supported') _srSoft = true;
                var why = srWhyOff();
                if (why) { stopListen(); showNote(why); }
            };
            // Prohlížeč rozpoznávání po pauze v řeči sám ukončí. Restart JEN přes časovač
            // a se stropem — volat start() rovnou v onend umí vyrobit smyčku, která ucpe
            // hlavní vlákno (viz stejná oprava v js/hlasovky.js).
            _sr.onend = function () {
                if (!_srOn) return;
                srClearRetry();
                _srRetry = setTimeout(function () {
                    _srRetry = null;
                    if (!_srOn) return;
                    if (!srStart()) { _srSoft = true; stopListen(); showNote(srWhyOff() || ''); }
                }, SR_GAP_MS);
            };
            if (!srStart()) { _sr = null; _srOn = false; showNote('Rozpoznávání se nepodařilo spustit.'); return; }
            lockScreen();
            syncUi();
            showNote('');
            say('Poslouchám');
        } catch (e) { _sr = null; _srOn = false; showNote('Rozpoznávání se nepodařilo spustit.'); }
    }
    function stopListen() {
        _srOn = false;
        srClearRetry();
        var sr = _sr; _sr = null;
        if (sr) {
            try { sr.onend = null; sr.onerror = null; sr.onresult = null; } catch (e) {}
            try { sr.stop(); } catch (e2) {}
            try { if (sr.abort) sr.abort(); } catch (e3) {}
        }
        unlockScreen();
        syncUi();
    }

    // ---- zpracování věty --------------------------------------------------------------------
    function handleSentence(s) {
        var nrm = deacc(s);                 // povely se hledaji bez diakritiky (viz deacc)
        if (CMD_STOP.test(nrm)) { stopListen(); say('Končím'); return; }
        if (CMD_CLEAR.test(nrm)) { clearDraft(); beep(false); say('Zrušeno'); return; }
        var wantSave = CMD_SAVE.test(nrm);
        applyParsed(parse(s));
        renderDraft();
        if (wantSave) saveDraft();
        else if (CMD_NEXT.test(nrm)) { nextName(); renderDraft(); }
    }
    function clearDraft() {
        _draft = { name: '', kod: '', note: '', vyska: null };
        renderDraft();
    }
    function nextName() {
        var n = nextSerie();
        if (n) { _draft.name = n; _draft.kod = ''; _draft.note = ''; _draft.vyska = null; }
    }
    function nextSerie() {
        try { if (typeof window.agNextSerieName === 'function') { var n = window.agNextSerieName(); if (n) return n; } } catch (e) {}
        return '';
    }
    // po uložení posuneme sérii i pro ruční „Nový bod" — jinak by si obě cesty
    // číslovaly každá po svém a v zakázce by vznikly díry
    function bumpSerie(name) {
        try {
            var m = /^(.*?)(\d{1,9})$/.exec(String(name || '').trim());
            if (!m || typeof setStoredData !== 'function') return;
            setStoredData('agPointSerie', JSON.stringify({ prefix: m[1], next: parseInt(m[2], 10) + 1, pad: m[2].length }));
        } catch (e) {}
    }

    // ---- průměrování GPS a uložení bodu ----------------------------------------------------------
    function haveFix() {
        try { return (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null); } catch (e) { return false; }
    }
    function saveDraft() {
        if (_avgT) return;                                  // průměrování už běží
        if (!haveFix()) { beep(false); say('Nemám GPS'); showNote('GPS zatím nemá fix — bod se nedá uložit.'); return; }
        if (!_draft.name) _draft.name = nextSerie() || ('Bod' + (Date.now() % 1000));
        var secs = cfg().avg;
        _samples = [];
        _avgUntil = Date.now() + secs * 1000;
        say('Průměruji ' + secs + ' sekund');
        _avgT = setInterval(function () {
            try {
                if (haveFix()) {
                    var acc = null;
                    try { acc = (typeof currentGpsAccuracy !== 'undefined' && currentGpsAccuracy != null) ? currentGpsAccuracy : null; } catch (e) {}
                    var alt = null;
                    try { alt = (typeof userAlt !== 'undefined' && userAlt != null && isFinite(userAlt)) ? userAlt : null; } catch (e2) {}
                    // stejný vzorek dvakrát (GPS ještě nedodala novou polohu) nemá cenu vážit
                    var last = _samples[_samples.length - 1];
                    if (!last || last.lat !== userLat || last.lng !== userLng) _samples.push({ lat: userLat, lng: userLng, acc: acc, alt: alt });
                }
            } catch (e3) {}
            renderDraft();
            if (Date.now() >= _avgUntil) finishAvg();
        }, 400);
        renderDraft();
    }
    function finishAvg() {
        if (_avgT) { clearInterval(_avgT); _avgT = null; }
        var n = _samples.length;
        if (!n) { beep(false); say('Nepovedlo se'); showNote('Za dobu průměrování nepřišla ani jedna poloha.'); renderDraft(); return; }
        var sLat = 0, sLng = 0, sAcc = 0, nAcc = 0, sAlt = 0, nAlt = 0, i;
        for (i = 0; i < n; i++) {
            sLat += _samples[i].lat; sLng += _samples[i].lng;
            if (_samples[i].acc != null) { sAcc += _samples[i].acc; nAcc++; }
            if (_samples[i].alt != null) { sAlt += _samples[i].alt; nAlt++; }
        }
        var lat = sLat / n, lng = sLng / n;
        var acc = nAcc ? sAcc / nAcc : null;
        // rozptyl vzorků kolem průměru — poctivější číslo než to, co hlásí telefon
        var spread = 0;
        for (i = 0; i < n; i++) spread += distM(lat, lng, _samples[i].lat, _samples[i].lng);
        spread = spread / n;

        var vyska = _draft.vyska;
        if (vyska == null && nAlt) {
            var und = 0;
            try { if (typeof getGeoidUndulation === 'function') und = getGeoidUndulation(lat, lng) || 0; } catch (e) {}
            vyska = (sAlt / nAlt) - und;                     // elipsoidická výška -> Bpv
        }
        if (typeof window.addImportedPoints !== 'function') {
            beep(false); showNote('Ukládání bodů není dostupné (chybí addImportedPoints).'); return;
        }
        var rec = {
            name: _draft.name, lat: lat, lng: lng,
            kod: _draft.kod || undefined,
            vyska: (vyska != null && isFinite(vyska)) ? vyska : undefined,
            acc: (acc != null) ? acc : undefined,
            origin: 'gps-avg'
        };
        var added = window.addImportedPoints([rec]);
        if (!added) {
            beep(false); say('Neuloženo');
            showNote('Bod se neuložil — číslo ' + _draft.name + ' už v zakázce je na stejném místě.');
            return;
        }
        // poznámka jde do foto-dokumentace bodu (stejné úložiště jako karta bodu),
        // ať není jen v hlavě: kód je krátký, poznámka bývá věta
        if (_draft.note) attachNote(_draft.name, _draft.note);
        bumpSerie(_draft.name);
        _hist.unshift({ ts: Date.now(), name: _draft.name, kod: _draft.kod, note: _draft.note, n: n, spread: spread, acc: acc });
        _hist = _hist.slice(0, 30);
        beep(true);
        say('Uloženo ' + _draft.name);
        toast('Bod ' + _draft.name + ' uložen (' + n + ' vzorků, rozptyl ' + spread.toFixed(2) + ' m).');
        clearDraft();
        nextName();
        renderDraft();
        renderHist();
    }
    function distM(la1, lo1, la2, lo2) {
        try { if (typeof getDistance === 'function') return getDistance(la1, lo1, la2, lo2); } catch (e) {}
        var R = 6371000, r = Math.PI / 180;
        var a = Math.sin((la2 - la1) * r / 2), b = Math.sin((lo2 - lo1) * r / 2);
        var h = a * a + Math.cos(la1 * r) * Math.cos(la2 * r) * b * b;
        return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    function attachNote(name, note) {
        try {
            if (typeof persistentCustomPoints === 'undefined' || typeof loadPointDoc !== 'function' || typeof savePointDoc !== 'function') return;
            var p = null;
            for (var i = persistentCustomPoints.length - 1; i >= 0; i--) {
                if (persistentCustomPoints[i] && persistentCustomPoints[i].name === name) { p = persistentCustomPoints[i]; break; }
            }
            if (!p) return;
            loadPointDoc(p.id).then(function (doc) {
                doc = (typeof _normalizeDoc === 'function') ? _normalizeDoc(doc || {}) : (doc || { photos: [] });
                doc.note = (doc.note ? doc.note + ' · ' : '') + note;
                doc.t = Date.now();
                savePointDoc(p.id, doc);
            });
        } catch (e) {}
    }

    // ---- UI ---------------------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-hk-modal .modal-content{display:flex;flex-direction:column;}',
            '#ag-hk-body{flex:1;overflow-y:auto;min-height:0;}',
            '#ag-hk-mic{width:100%;padding:18px;border-radius:16px;margin:2px 0 10px;cursor:pointer;',
            '  border:1px solid var(--accent-line,rgba(47,158,116,0.42));background:var(--accent-soft,rgba(47,158,116,0.16));',
            '  color:var(--accent,#2f9e74);font:800 17px/1.2 var(--font-ui,system-ui);}',
            '#ag-hk-mic.on{background:rgba(220,68,68,0.16);border-color:rgba(220,68,68,0.5);color:#f87171;}',
            '#ag-hk-heard{min-height:20px;margin:0 0 10px;padding:9px 11px;border-radius:12px;',
            '  border:1px dashed var(--accent-line,rgba(47,158,116,0.4));background:rgba(47,158,116,0.07);',
            '  font:500 13px/1.45 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '#ag-hk-note{display:none;margin:0 0 10px;padding:9px 11px;border-radius:12px;',
            '  border:1px solid rgba(251,191,36,0.45);background:rgba(251,191,36,0.09);',
            '  font:600 12.5px/1.45 var(--font-ui,system-ui);color:#fbbf24;}',
            // rozebraná věta velkým písmem — čitelné na sluníčku a přes rukavici
            '#ag-hk-draft{border:1px solid var(--glass-border,rgba(255,255,255,0.12));border-radius:14px;padding:12px 14px;margin-bottom:10px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '#ag-hk-draft .row{display:flex;align-items:baseline;gap:10px;margin-bottom:6px;}',
            '#ag-hk-draft .row:last-child{margin-bottom:0;}',
            '#ag-hk-draft .k{flex:none;width:78px;font:700 10.5px/1.4 var(--font-ui,system-ui);letter-spacing:.07em;',
            '  text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#ag-hk-draft .v{flex:1;min-width:0;font:700 20px/1.25 var(--font-display,system-ui);color:var(--text-color,#e6e8eb);word-break:break-word;}',
            '#ag-hk-draft .v.sm{font-size:15px;font-weight:600;}',
            '#ag-hk-draft .v.empty{color:var(--text-muted,#6f7681);font-weight:500;font-style:italic;}',
            '#ag-hk-avg{font:600 12.5px/1.4 var(--font-ui,system-ui);color:var(--accent,#2f9e74);margin-top:8px;}',
            '#ag-hk-acts{display:flex;gap:8px;margin-bottom:12px;}',
            '#ag-hk-acts button{flex:1;padding:13px 8px;border-radius:12px;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:transparent;',
            '  color:var(--text-muted,#c3c9d2);font:700 13.5px/1 var(--font-ui,system-ui);}',
            '#ag-hk-acts button.prim{border-color:var(--accent-line,rgba(47,158,116,0.5));background:var(--accent-soft,rgba(47,158,116,0.16));color:var(--accent,#2f9e74);}',
            '.ag-hk-h{font:700 11px/1 var(--font-display,system-ui);letter-spacing:.09em;text-transform:uppercase;',
            '  color:var(--text-muted,#9aa1ac);margin:14px 0 7px;}',
            '.ag-hk-cheat{font:500 12.5px/1.6 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.ag-hk-cheat b{color:var(--text-color,#e6e8eb);}',
            '.ag-hk-hi{display:flex;gap:10px;padding:8px 10px;margin-bottom:6px;border-radius:11px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));background:var(--glass-bg,rgba(255,255,255,0.04));',
            '  font:500 12px/1.45 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '.ag-hk-hi b{color:var(--text-color,#e6e8eb);font-size:13.5px;}',
            '.ag-hk-sw{display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:7px;border-radius:12px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.1));background:var(--glass-bg,rgba(255,255,255,0.04));',
            '  font:600 13px/1.35 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '.ag-hk-sw input[type=checkbox]{width:20px;height:20px;accent-color:var(--accent,#2f9e74);}',
            '.ag-hk-sw input[type=number]{width:64px;padding:7px 8px;border-radius:9px;box-sizing:border-box;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:var(--glass-bg,rgba(255,255,255,0.05));',
            '  color:var(--text-color,#e6e8eb);font:600 13px/1 var(--font-ui,system-ui);}',
            '#ag-hk-modal .ag-hk-foot{display:flex;gap:8px;margin-top:12px;}',
            '#ag-hk-modal .ag-hk-foot .btn{flex:1;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }
    function showHeard(t) {
        var el = document.getElementById('ag-hk-heard');
        if (el) el.textContent = t || (_srOn ? 'Poslouchám…' : 'Zatím nic.');
    }
    function showNote(t) {
        var el = document.getElementById('ag-hk-note');
        if (!el) return;
        el.style.display = t ? 'block' : 'none';
        el.innerHTML = t || '';
    }
    function syncUi() {
        var b = document.getElementById('ag-hk-mic');
        if (b) {
            b.classList.toggle('on', _srOn);
            b.textContent = _srOn ? 'Poslouchám — klepni pro konec' : 'Začít poslouchat';
        }
        showHeard(_lastHeard);
    }
    function renderDraft() {
        var box = document.getElementById('ag-hk-draft');
        if (!box) return;
        function row(k, v, sm) {
            return '<div class="row"><div class="k">' + k + '</div><div class="v' + (sm ? ' sm' : '') + (v ? '' : ' empty') + '">'
                + esc(v || '—') + '</div></div>';
        }
        var h = row('Bod', _draft.name)
            + row('Kód', _draft.kod, true)
            + row('Poznámka', _draft.note, true)
            + (_draft.vyska != null ? row('Výška', _draft.vyska.toFixed(2) + ' m (ručně)', true) : '');
        if (_avgT) {
            var left = Math.max(0, Math.ceil((_avgUntil - Date.now()) / 1000));
            h += '<div id="ag-hk-avg">Průměruji GPS… zbývá ' + left + ' s (' + _samples.length + ' vzorků)</div>';
        }
        box.innerHTML = h;
    }
    function renderHist() {
        var box = document.getElementById('ag-hk-hist');
        if (!box) return;
        if (!_hist.length) { box.innerHTML = '<div class="ag-hk-cheat">Zatím nic uloženého v tomhle sezení.</div>'; return; }
        var h = '';
        _hist.forEach(function (r) {
            var d = new Date(r.ts);
            h += '<div class="ag-hk-hi"><div style="flex:1;min-width:0;"><b>' + esc(r.name) + '</b>'
                + (r.kod ? ' · ' + esc(r.kod) : '') + (r.note ? '<br><i>' + esc(r.note) + '</i>' : '')
                + '</div><div style="text-align:right;flex:none;">'
                + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes()
                + '<br>' + r.n + '× · ±' + r.spread.toFixed(2) + ' m</div></div>';
        });
        box.innerHTML = h;
    }

    // ---- modal -------------------------------------------------------------------------------------
    function open() {
        injectStyles();
        var m = document.getElementById('ag-hk-modal');
        if (!m) {
            m = document.createElement('div');
            m.className = 'modal-overlay';
            m.id = 'ag-hk-modal';
            m.innerHTML =
                '<div class="modal-content">' +
                '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Hlasové kódování bodu</h3>' +
                '  <div id="ag-hk-body">' +
                '    <button type="button" id="ag-hk-mic">Začít poslouchat</button>' +
                '    <div id="ag-hk-note"></div>' +
                '    <div id="ag-hk-heard"></div>' +
                '    <div id="ag-hk-draft"></div>' +
                '    <div id="ag-hk-acts">' +
                '      <button type="button" id="ag-hk-save" class="prim">Uložit bod</button>' +
                '      <button type="button" id="ag-hk-clear">Zrušit větu</button>' +
                '      <button type="button" id="ag-hk-next">Další číslo</button>' +
                '    </div>' +
                '    <div class="ag-hk-h">Co můžeš říct</div>' +
                '    <div class="ag-hk-cheat">' +
                '      <b>„Bod 105, roh plotu, poznámka zborcený sloupek"</b><br>' +
                '      <b>„kód obruba"</b> — přepíše jen kód · <b>„výška 312,45"</b> — výška ručně místo GPS<br>' +
                '      <b>„ulož"</b> — spustí průměrování a založí bod · <b>„zruš"</b> — vymaže rozepsané<br>' +
                '      <b>„další"</b> — posune na další číslo série · <b>„konec"</b> — přestane poslouchat' +
                '    </div>' +
                '    <div class="ag-hk-h">Uloženo v tomhle sezení</div>' +
                '    <div id="ag-hk-hist"></div>' +
                '    <div class="ag-hk-h">Nastavení</div>' +
                '    <label class="ag-hk-sw"><input type="checkbox" id="ag-hk-say"><span style="flex:1;">Mluvit zpátky<small style="display:block;font-weight:500;color:var(--text-muted,#9aa1ac);">„Uloženo 105" — ať se nemusíš dívat na displej.</small></span></label>' +
                '    <label class="ag-hk-sw"><span style="flex:1;">Průměrovat GPS<small style="display:block;font-weight:500;color:var(--text-muted,#9aa1ac);">Sekundy od povelu „ulož" do založení bodu.</small></span><input type="number" id="ag-hk-avg-in" min="1" max="60" step="1"> s</label>' +
                '  </div>' +
                '  <div class="ag-hk-foot">' +
                '    <button type="button" class="btn btn-secondary" id="ag-hk-voice">Hlasové poznámky</button>' +
                '    <button type="button" class="btn btn-secondary" id="ag-hk-close">Zavřít</button>' +
                '  </div>' +
                '</div>';
            document.body.appendChild(m);
            m.querySelector('#ag-hk-mic').addEventListener('click', function () { _srOn ? stopListen() : listen(); });
            m.querySelector('#ag-hk-save').addEventListener('click', saveDraft);
            m.querySelector('#ag-hk-clear').addEventListener('click', function () { clearDraft(); });
            m.querySelector('#ag-hk-next').addEventListener('click', function () { nextName(); renderDraft(); });
            m.querySelector('#ag-hk-say').addEventListener('change', function () { var c = cfg(); c.say = this.checked; saveCfg(c); });
            m.querySelector('#ag-hk-avg-in').addEventListener('change', function () {
                var c = cfg(); var v = parseInt(this.value, 10);
                c.avg = (isFinite(v) && v >= 1 && v <= 60) ? v : AVG_DEF;
                this.value = c.avg; saveCfg(c);
            });
            m.querySelector('#ag-hk-voice').addEventListener('click', function () {
                if (typeof window.agOpenHlasovky === 'function') { m.style.display = 'none'; window.agOpenHlasovky(); }
                else toast('Hlasové poznámky nejsou k dispozici.');
            });
            m.querySelector('#ag-hk-close').addEventListener('click', function () { stopListen(); m.style.display = 'none'; });
            // Okno umí zavřít i křížek/gesto (modal-close.js) — bez tohohle by mikrofon
            // zůstal viset a na iOS by škubal kamerou v AR.
            try {
                new MutationObserver(function () {
                    if (m.style.display === 'none' && _srOn) stopListen();
                }).observe(m, { attributes: true, attributeFilter: ['style'] });
            } catch (e) {}
        }
        var c = cfg();
        m.querySelector('#ag-hk-say').checked = !!c.say;
        m.querySelector('#ag-hk-avg-in').value = c.avg;
        m.style.display = 'flex';
        if (!_draft.name) nextName();
        var why = srWhyOff();
        showNote(why || '');
        syncUi();
        renderDraft();
        renderHist();
    }

    try {
        window.addEventListener('pagehide', function () { if (_srOn) stopListen(); });
        document.addEventListener('visibilitychange', function () { if (document.hidden && _srOn) stopListen(); });
    } catch (e) {}

    // ---- dlaždice v Nástrojích ------------------------------------------------------------------------
    var _tries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'hlas-kod', label: 'Hlasové kódování', icon: ICON, cat: 'Měření', onClick: open, order: 11 });
            return;
        }
        if (_tries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.AGHlasKod = { open: open, parse: parse };
    window.agOpenHlasKod = open;
})();
