// ===== AR Geodet — BALÍČEK ZAKÁZKY: sbalit všechno před výjezdem (ODPOJITELNÁ) ==
// Neinvazivní vrstva ve stylu js/bodove-pole.js: NEEDITUJE logika.js ani grafika.js,
// jen volá jejich existující globální funkce přes typeof-guardy.
//
// PROBLÉM: appka umí stáhnout offline všechno potřebné, ale ve třech nespojených
// místech a — hlavně — VŽDYCKY KOLEM MÍSTA, KDE PRÁVĚ STOJÍM:
//     saveForOffline() v logika.js začíná řádkem
//         if (!userLat || !userLng) { agInfo("Počkejte prosím na načtení GPS polohy."); return; }
//     a pak stahuje cacheTilesForArea(userLat, userLng, …).
// Jenže sbaluje se VEČER DOMA nebo RÁNO V KANCELÁŘI, tedy o desítky kilometrů
// vedle. Tam appka poslušně stáhne mapu okolí kanceláře a v terénu je pak prázdno.
// Jediná cesta byla dojet na místo — a přesně tam už signál nemusí být.
//
// CO DĚLÁ: sbalí to samé, ale kolem STŘEDU ZAKÁZKY, spočítaného z jejích bodů —
// takže se to dá udělat odkudkoli. V jednom průchodu a s jedním hlášením:
//     1) body bodového pole ČÚZK v okolí (a uloží je do offline cache),
//     2) mapu OSM + katastrální mapu KN + ortofoto,
//     3) výšky terénu DMR 5G pro body zakázky (aby AR sedělo i ve svahu),
//     4) kontrolní seznam toho, co se předstáhnout NEDÁ (počasí, družice) —
//        s tlačítkem, které to otevře, a s tím, jestli je cache čerstvá.
// Na konci řekne, co se povedlo a co ne — ne „hotovo" nad polovičním výsledkem.
//
// CO VĚDOMĚ NEDĚLÁ: nestahuje DMR na celou plochu (buňka je ~10 m, kilometr
// čtvereční by byl 40 000 dotazů na ČÚZK a cache má strop 6000 položek). Bere jen
// body zakázky a úřední body — což je přesně to, co AR potřebuje posadit na terén.
//
// Odstranění: smaž js/balicek-zakazky.js + css/balicek-zakazky.css, oba řádky se
// značkou "BALÍČEK ZAKÁZKY" v index.html (a cesty v sw.js) a záznam
// 'balicek-zakazky' v js/tools-registry.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGBalicek) return;

    var LAST_KEY = 'agBalicekLast1';     // kdy se naposledy balilo (per zakázka)
    var DMR_MAX = 300;                   // strop odečtů výšek na jeden běh (šetrnost k ČÚZK)
    var WX_FRESH_H = 12;                 // do kolika hodin je předpověď ještě k něčemu
    var WX_NEAR_KM = 40;                 // a jak daleko od zakázky ještě platí
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>';

    var RADII = [
        { m: 500, label: '500 m', note: 'jedna stavba' },
        { m: 1000, label: '1 km', note: 'běžná zakázka' },
        { m: 2000, label: '2 km', note: 'liniová stavba' }
    ];

    // --------------------------------------------------------------------------------
    // Pomůcky
    // --------------------------------------------------------------------------------
    function esc(s) {
        return (window.AG && AG.esc) ? AG.esc(s)
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde); } catch (err) { /* poslední instance */ } }
    function toast(m) {
        try { if (window.AG && AG.toast) return AG.toast(m); } catch (e) { swallow(e, 'balicek:toast'); }
        try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { swallow(e, 'balicek:toast'); }
    }
    function alertBox(title, msg) {
        if (typeof window.agAlert === 'function') return window.agAlert({ title: title, message: msg });
        try { if (typeof agInfo === 'function') agInfo((title ? title + '\n\n' : '') + String(msg).replace(/<[^>]+>/g, '')); } catch (e) { swallow(e, 'balicek:alertBox'); }
        return Promise.resolve(true);
    }
    function customPts() {
        try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; }
        catch (e) { return []; }
    }
    function allPts() {
        try { if (typeof arPoints !== 'undefined' && Array.isArray(arPoints)) return arPoints; } catch (e) { swallow(e, 'balicek:allPts'); }
        return customPts();
    }
    function dist(a, b, c, d) {
        try { if (typeof getDistance === 'function') return getDistance(a, b, c, d); } catch (e) { swallow(e, 'balicek:dist'); }
        try { if (window.GeoCore && GeoCore.getDistance) return GeoCore.getDistance(a, b, c, d); } catch (e) { swallow(e, 'balicek:dist'); }
        return null;
    }

    // --------------------------------------------------------------------------------
    // Střed zakázky. Tohle je celé jádro modulu: sbalit jde odkudkoli, protože se
    // nebere aktuální poloha, ale těžiště obálky bodů zakázky.
    // --------------------------------------------------------------------------------
    function center() {
        var pts = customPts().filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng); });
        var from = 'body zakázky';
        if (!pts.length) {
            pts = allPts().filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng); });
            from = 'stažené body';
        }
        if (pts.length) {
            var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
            pts.forEach(function (p) {
                if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
                if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng;
            });
            var cLat = (minLat + maxLat) / 2, cLng = (minLng + maxLng) / 2;
            // „Rozpětí" = poloměr, který ještě obsáhne nejvzdálenější bod. Podle něj
            // se dá poradit, jestli 500 m stačí, nebo je zakázka rozlezlá.
            var span = 0;
            pts.forEach(function (p) { var d = dist(cLat, cLng, p.lat, p.lng); if (d != null && d > span) span = d; });
            return { lat: cLat, lng: cLng, from: from + ' (' + pts.length + ')', span: span };
        }
        try {
            if (typeof userLat !== 'undefined' && userLat != null && typeof userLng !== 'undefined' && userLng != null) {
                return { lat: userLat, lng: userLng, from: 'moje poloha', span: 0 };
            }
        } catch (e) { swallow(e, 'balicek:center'); }
        try {
            var p = JSON.parse(localStorage.getItem('arLastPos'));
            if (p && p.lat != null) return { lat: +p.lat, lng: +(p.lng != null ? p.lng : p.lon), from: 'poslední známá poloha', span: 0 };
        } catch (e) { swallow(e, 'balicek:center'); }
        return null;
    }

    // Doporučený poloměr: nejbližší z nabídky, který zakázku ještě obsáhne i s rezervou.
    function suggestRadius(span) {
        var need = (span || 0) + 300;
        for (var i = 0; i < RADII.length; i++) if (RADII[i].m >= need) return RADII[i].m;
        return RADII[RADII.length - 1].m;
    }

    // --------------------------------------------------------------------------------
    // Stav „co je hotové"
    // --------------------------------------------------------------------------------
    function lastPacked() {
        try {
            var raw = (typeof getStoredData === 'function') ? getStoredData(LAST_KEY) : null;
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function savePacked(o) {
        try { if (typeof setStoredData === 'function') setStoredData(LAST_KEY, JSON.stringify(o)); }
        catch (e) { swallow(e, 'balicek:savePacked'); }
    }
    // Počasí ani předpověď družic se předstáhnout nedají (nemají prefetch API a
    // předpověď stejně zestárne). Umíme ale říct, jestli je cache čerstvá a JESTLI
    // je z okolí zakázky — cache od kanceláře je v terénu k ničemu.
    function weatherState(c) {
        try {
            var raw = localStorage.getItem('agWeatherCache_v1');
            if (!raw) return { ok: false, why: 'zatím nestažená' };
            var o = JSON.parse(raw);
            if (!o || !o.t) return { ok: false, why: 'zatím nestažená' };
            var hrs = (Date.now() - o.t) / 3600000;
            if (hrs > WX_FRESH_H) return { ok: false, why: 'stará ' + Math.round(hrs) + ' h' };
            if (c && isFinite(o.lat) && isFinite(o.lon)) {
                var d = dist(c.lat, c.lng, o.lat, o.lon);
                if (d != null && d / 1000 > WX_NEAR_KM) return { ok: false, why: 'je pro místo ' + Math.round(d / 1000) + ' km odsud' };
            }
            return { ok: true, why: 'čerstvá (' + (hrs < 1 ? 'do hodiny' : Math.round(hrs) + ' h') + ')' };
        } catch (e) { return { ok: false, why: 'nepodařilo se přečíst' }; }
    }

    // --------------------------------------------------------------------------------
    // Jednotlivé kroky balení
    // --------------------------------------------------------------------------------
    // 1) body bodového pole + jejich uložení do offline cache
    function stepPoints(c, radius, log) {
        if (typeof fetchGeodata !== 'function') { log('body', 'skip', 'stahování bodů není v této sestavě'); return Promise.resolve(); }
        log('body', 'run', 'stahuji z ČÚZK…');
        return Promise.resolve(fetchGeodata(c.lat, c.lng, radius, false)).then(function (n) {
            // fetchGeodata plní jen paměť; do offline cache to musíme uložit sami —
            // stejně jako to na konci dělá saveForOffline() v logika.js.
            var kolik = 0;
            try {
                var off = allPts().filter(function (p) { return p && p.cat && p.cat !== 'CUSTOM'; });
                kolik = off.length;
                if (kolik && typeof setStoredData === 'function') setStoredData('arOfflinePoints12', JSON.stringify(off));
            } catch (e) { swallow(e, 'balicek:stepPoints'); }
            log('body', kolik ? 'ok' : 'warn', kolik ? (kolik + ' bodů uloženo offline' + (n ? ' (' + n + ' nových)' : '')) : 'v okolí nejsou žádné úřední body');
        }).catch(function () {
            log('body', 'err', 'ČÚZK neodpověděl — zkus to znovu s lepším signálem');
        });
    }

    // 2) mapové dlaždice + katastr + ortofoto
    function stepTiles(c, radius, log) {
        if (typeof cacheTilesForArea !== 'function') { log('mapa', 'skip', 'ukládání mapy není v této sestavě'); return Promise.resolve(); }
        log('mapa', 'run', 'stahuji dlaždice…');
        return Promise.resolve(cacheTilesForArea(c.lat, c.lng, radius, true)).then(function (res) {
            try { if (typeof hideOfflineProgress === 'function') hideOfflineProgress(); } catch (e) { swallow(e, 'balicek:stepTiles'); }
            if (!res || res.unsupported) { log('mapa', 'err', 'prohlížeč offline mapu neumí'); return; }
            if (res.tooMany) { log('mapa', 'err', 'oblast je moc velká (' + res.total + ' dlaždic) — zmenši poloměr'); return; }
            var msg = 'mapa ' + res.ok + '/' + res.total;
            var w = res.wms || {};
            if (w.katastr && w.katastr.total) msg += ' · katastr ' + (w.katastr.skipped ? 'přeskočen (moc velká oblast)' : w.katastr.ok + '/' + w.katastr.total);
            if (w.ortofoto && w.ortofoto.total) msg += ' · ortofoto ' + (w.ortofoto.skipped ? 'přeskočeno' : w.ortofoto.ok + '/' + w.ortofoto.total);
            var uplne = res.ok === res.total && !(w.katastr && w.katastr.skipped);
            log('mapa', uplne ? 'ok' : 'warn', msg + (uplne ? '' : ' — část se nestáhla'));
        }).catch(function (e) {
            try { if (typeof hideOfflineProgress === 'function') hideOfflineProgress(); } catch (er) { swallow(er, 'balicek:stepTiles'); }
            log('mapa', 'err', 'stahování selhalo: ' + ((e && e.message) ? e.message : 'neznámá chyba'));
        });
    }

    // 3) výšky terénu DMR 5G pro body (ne pro plochu — viz hlavička)
    function stepTerrain(c, radius, log) {
        if (typeof window.terrainElevAsync !== 'function') { log('teren', 'skip', 'vrstva terénu není v této sestavě'); return Promise.resolve(); }
        var pts = allPts().filter(function (p) {
            if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return false;
            var d = dist(c.lat, c.lng, p.lat, p.lng);
            return d != null && d <= radius;
        }).slice(0, DMR_MAX);
        if (!pts.length) { log('teren', 'skip', 'v okolí nejsou body, ke kterým by se výška hodila'); return Promise.resolve(); }
        log('teren', 'run', 'odečítám výšky (' + pts.length + ')…');
        var ok = 0, fail = 0, i = 0;
        // Sériově po malých dávkách — dmr-terrain.js si sám drží MAX_CONCURRENT 3,
        // ale zahltit ho tisícem promisů naráz by jen nafouklo frontu.
        function davka() {
            if (i >= pts.length) {
                log('teren', ok ? (fail ? 'warn' : 'ok') : 'warn',
                    ok + ' výšek uloženo' + (fail ? ', ' + fail + ' se nepodařilo' : ''));
                return Promise.resolve();
            }
            var chunk = pts.slice(i, i + 6); i += 6;
            return Promise.all(chunk.map(function (p) {
                return Promise.resolve(window.terrainElevAsync(p.lat, p.lng))
                    .then(function (v) { if (v != null && isFinite(v)) ok++; else fail++; })
                    .catch(function () { fail++; });
            })).then(davka);
        }
        return davka();
    }

    // --------------------------------------------------------------------------------
    // UI
    // --------------------------------------------------------------------------------
    var _ov = null, _radius = null, _running = false;

    function build() {
        if (_ov && document.body.contains(_ov)) return _ov;
        _ov = document.createElement('div');
        _ov.className = 'modal-overlay agbz-overlay';
        _ov.id = 'agbz-modal';
        _ov.innerHTML =
            '<div class="modal-content agbz-content" role="dialog" aria-modal="true" aria-labelledby="agbz-title">' +
            '  <h3 class="agbz-title" id="agbz-title">Sbalit zakázku před výjezdem</h3>' +
            '  <div class="agbz-note">Stáhne mapu, katastr a body <b>kolem zakázky</b> — ne kolem místa, kde zrovna stojíš. Dá se to tedy udělat večer doma nebo ráno v kanceláři, kde je Wi-Fi.</div>' +
            '  <div class="modal-body agbz-body">' +
            '    <div id="agbz-where" class="agbz-where"></div>' +
            '    <div class="agbz-lbl">Jak velké okolí</div>' +
            '    <div id="agbz-radii" class="agbz-radii" role="group" aria-label="Poloměr stahování"></div>' +
            '    <div id="agbz-steps" class="agbz-steps"></div>' +
            '    <div id="agbz-check" class="agbz-check"></div>' +
            '  </div>' +
            '  <button type="button" class="btn btn-primary" id="agbz-go">Sbalit</button>' +
            '  <button type="button" class="btn btn-secondary" id="agbz-close">Zavřít</button>' +
            '</div>';
        document.body.appendChild(_ov);
        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov && !_running) close(); });
        _ov.querySelector('#agbz-close').addEventListener('click', function () {
            if (_running) { toast('Počkej, až se balení dokončí.'); return; }
            close();
        });
        _ov.querySelector('#agbz-go').addEventListener('click', run);
        return _ov;
    }

    var STEPS = [
        { k: 'body', t: 'Body bodového pole (ČÚZK)' },
        { k: 'mapa', t: 'Mapa, katastr KN a ortofoto' },
        { k: 'teren', t: 'Výšky terénu DMR 5G' }
    ];
    var _state = {};

    function log(k, st, msg) {
        _state[k] = { st: st, msg: msg };
        renderSteps();
    }
    function renderSteps() {
        var host = _ov && _ov.querySelector('#agbz-steps');
        if (!host) return;
        host.innerHTML = STEPS.map(function (s) {
            var v = _state[s.k] || { st: 'idle', msg: 'čeká' };
            var mark = { idle: '·', run: '…', ok: '✓', warn: '!', err: '×', skip: '–' }[v.st] || '·';
            return '<div class="agbz-step" data-st="' + v.st + '">'
                + '<span class="agbz-mark">' + mark + '</span>'
                + '<span class="agbz-st"><b>' + esc(s.t) + '</b><small>' + esc(v.msg) + '</small></span>'
                + '</div>';
        }).join('');
    }

    function renderWhere() {
        var host = _ov && _ov.querySelector('#agbz-where');
        if (!host) return;
        var c = center();
        if (!c) {
            host.className = 'agbz-where bad';
            host.innerHTML = 'Zakázka nemá <b>žádný bod</b> ani uloženou polohu, takže není podle čeho určit, co sbalit. Přidej aspoň jeden bod (nebo si nech načíst GPS) a vrať se sem.';
            var go = _ov.querySelector('#agbz-go'); if (go) go.disabled = true;
            return;
        }
        var go2 = _ov.querySelector('#agbz-go'); if (go2) go2.disabled = false;
        var last = lastPacked();
        var lastTxt = '';
        if (last && last.t) {
            var h = (Date.now() - last.t) / 3600000;
            lastTxt = '<br><span class="agbz-dim">Naposledy sbaleno ' + (h < 24 ? ('před ' + (h < 1 ? Math.round(h * 60) + ' min' : Math.round(h) + ' h')) : new Date(last.t).toLocaleDateString('cs-CZ'))
                + (last.r ? ' · poloměr ' + last.r + ' m' : '') + '</span>';
        }
        host.className = 'agbz-where';
        host.innerHTML = 'Střed podle: <b>' + esc(c.from) + '</b>'
            + (c.span > 50 ? '<br><span class="agbz-dim">Zakázka je rozlezlá do ' + Math.round(c.span) + ' m od středu.</span>' : '')
            + lastTxt;
    }

    function renderRadii() {
        var host = _ov && _ov.querySelector('#agbz-radii');
        if (!host) return;
        var c = center();
        if (_radius == null) _radius = c ? suggestRadius(c.span) : 1000;
        host.innerHTML = RADII.map(function (r) {
            var doporuc = c && suggestRadius(c.span) === r.m;
            return '<button type="button" class="agbz-r' + (r.m === _radius ? ' on' : '') + '" data-r="' + r.m + '" aria-pressed="' + (r.m === _radius ? 'true' : 'false') + '">'
                + '<b>' + esc(r.label) + '</b><small>' + esc(doporuc ? 'doporučeno' : r.note) + '</small></button>';
        }).join('');
        host.onclick = function (e) {
            if (_running) return;
            var b = e.target.closest ? e.target.closest('.agbz-r') : null;
            if (!b) return;
            _radius = parseInt(b.getAttribute('data-r'), 10);
            renderRadii();
        };
    }

    // Kontrolní seznam věcí, které předstáhnout nejdou — ale jde říct, jak na tom jsou.
    function renderCheck() {
        var host = _ov && _ov.querySelector('#agbz-check');
        if (!host) return;
        var c = center();
        var wx = weatherState(c);
        host.innerHTML = '<div class="agbz-lbl">Ještě před výjezdem</div>'
            + '<div class="agbz-chk" data-ok="' + (wx.ok ? '1' : '0') + '">'
            + '<span class="agbz-mark">' + (wx.ok ? '✓' : '!') + '</span>'
            + '<span class="agbz-st"><b>Počasí</b><small>' + esc(wx.why) + '</small></span>'
            + '<button type="button" class="btn btn-secondary agbz-mini" id="agbz-wx">Otevřít</button></div>'
            + '<div class="agbz-chk" data-ok="0">'
            + '<span class="agbz-mark">·</span>'
            + '<span class="agbz-st"><b>Družice</b><small>předpověď se počítá na místě — stačí ji projít</small></span>'
            + '<button type="button" class="btn btn-secondary agbz-mini" id="agbz-gnss">Otevřít</button></div>';
        var w = host.querySelector('#agbz-wx');
        if (w) w.onclick = function () {
            if (typeof window.agOpenPocasi === 'function') { close(); window.agOpenPocasi(); }
            else toast('Nástroj Počasí není v této sestavě.');
        };
        var g = host.querySelector('#agbz-gnss');
        if (g) g.onclick = function () {
            if (typeof window.agOpenGnssForecast === 'function') { close(); window.agOpenGnssForecast(); }
            else toast('Předpověď družic není v této sestavě.');
        };
    }

    function run() {
        if (_running) return;
        var c = center();
        if (!c) { alertBox('Není co sbalit', 'Zakázka nemá žádný bod ani uloženou polohu.'); return; }
        if (!navigator.onLine) {
            alertBox('Nejsi online', 'Sbalení potřebuje internet — právě proto se dělá doma nebo v kanceláři, ne v terénu.');
            return;
        }
        _running = true;
        _state = {};
        var go = _ov.querySelector('#agbz-go');
        if (go) { go.disabled = true; go.textContent = 'Balím…'; }
        renderSteps();

        stepPoints(c, _radius, log)
            .then(function () { return stepTiles(c, _radius, log); })
            .then(function () { return stepTerrain(c, _radius, log); })
            .then(function () {
                savePacked({ t: Date.now(), r: _radius, lat: c.lat, lng: c.lng });
                var bad = STEPS.filter(function (s) { return _state[s.k] && (_state[s.k].st === 'err' || _state[s.k].st === 'warn'); });
                renderWhere();
                renderCheck();
                if (!bad.length) {
                    alertBox('Sbaleno', 'Všechno pro okolí zakázky je uložené — v terénu to pojede i bez signálu.');
                } else {
                    alertBox('Sbaleno částečně', 'Něco se nestáhlo celé:<br><br>'
                        + bad.map(function (s) { return '• <b>' + esc(s.t) + '</b> — ' + esc(_state[s.k].msg); }).join('<br>')
                        + '<br><br>Zkus to znovu s lepším připojením, nebo zmenši poloměr.');
                }
            })
            .catch(function (e) {
                swallow(e, 'balicek:run');
                alertBox('Balení selhalo', 'Nepodařilo se dokončit: ' + esc((e && e.message) ? e.message : 'neznámá chyba'));
            })
            .then(function () {
                _running = false;
                if (go) { go.disabled = false; go.textContent = 'Sbalit znovu'; }
            });
    }

    function open() {
        build();
        _radius = null;
        _state = {};
        renderWhere(); renderRadii(); renderSteps(); renderCheck();
        _ov.style.display = 'flex';
    }
    function close() { if (_ov) _ov.style.display = 'none'; }

    window.AGBalicek = { open: open, center: center, lastPacked: lastPacked };
    window.openBalicekZakazky = open;

    // --------------------------------------------------------------------------------
    // Vstup: dlaždice v Nástrojích (fallback do bočního menu jako u ostatních vrstev)
    // --------------------------------------------------------------------------------
    function injectTile() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'balicek-zakazky', label: 'Sbalit zakázku', icon: ICON, cat: 'Katastr a data', onClick: open, order: 5 });
            var stale = document.getElementById('agbz-launch'); if (stale) stale.remove();
            return;
        }
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('agbz-launch')) return;
        var host = menu.querySelector('.menu-scroll') || menu;
        var btn = document.createElement('button');
        btn.id = 'agbz-launch'; btn.className = 'menu-btn'; btn.type = 'button';
        btn.innerHTML = ICON + ' Sbalit zakázku';
        btn.addEventListener('click', function () {
            try { if (typeof toggleMenu === 'function') toggleMenu(); } catch (e) { swallow(e, 'balicek:injectTile'); }
            open();
        });
        var about = host.querySelector('button[onclick*="openAbout"]');
        if (about) host.insertBefore(btn, about); else host.appendChild(btn);
    }

    function init() { try { injectTile(); } catch (e) { console.warn('[balicek-zakazky] tile', e); } }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 350); });
})();
