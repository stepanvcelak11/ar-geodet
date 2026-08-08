// ===== AR Geodet - KONTROLA KOMPASU =====
// Dve nezavisle funkce, oddelene od grafika.js (zadny zasah do handleOrientation):
//   1) Varovani na ruseni magnetometru. Geodeticke body byvaji kovove / u armatury,
//      kde kompas lze -> AR sipka miri mimo. Detekujeme bud z iOS webkitCompassAccuracy,
//      nebo (Android) z oscilace headingu (kmita na miste = sum, ne plynule otaceni).
//   2) Kontrola podle Slunce: z casu + GPS spocteme azimut Slunce a porovname s tim,
//      kam podle kompasu miri zadni kamera. Plne offline, nezavisle na magnetometru.
// Cte globaly z logika.js (currentHeading, userLat, userLng, appStarted) za behu.

(function () {
    'use strict';

    function _adiff(a, b) { return ((a - b + 540) % 360) - 180; }
    function _live() { return (typeof appStarted !== 'undefined') && appStarted; }
    function _calibOpen() { const m = document.getElementById('compass-calib-modal'); return m && m.style.display !== 'none' && m.style.display !== ''; }

    // ---------- 1) VAROVANI NA RUSENI ----------
    // dismissed = uzivatel zavrel varovani krizkem (napr. kompas nejde zkalibrovat).
    // Plati do restartu appky (pri pristim spusteni se muze objevit znovu — bezpecnostni hlaska).
    let banner = null, samples = [], shownSince = 0, hiddenSince = 0, t0 = 0, dismissed = false;

    function ensureBanner() {
        if (banner) return banner;
        banner = document.createElement('div');
        banner.id = 'compass-interference';
        // safe-area: bez ni sedel banner na telefonu s vyrezem presne na #gps-warn
        banner.style.cssText = 'position:fixed; left:50%; transform:translateX(-50%); top:calc(env(safe-area-inset-top, 0px) + 96px); z-index:1500; '
            + 'display:none; align-items:center; gap:8px; max-width:90%; padding:9px 10px 9px 14px; border-radius:12px; '
            + 'background:rgba(239,68,68,0.92); color:#fff; font-family:var(--font-display,sans-serif); '
            + 'font-size:calc(13px * var(--ag-font-scale, 1)); font-weight:600; line-height:1.25; text-align:left; '
            + 'box-shadow:0 6px 20px rgba(0,0,0,0.45); backdrop-filter:blur(4px); pointer-events:none;';
        // Text varovani nereaguje na dotek (pointer-events:none na kontejneru), klikaci je jen krizek.
        banner.innerHTML = '<span style="flex:1 1 auto;">⚠ Kompas pravděpodobně rušen (kov poblíž) — ověř směr, AR šipka může mířit mimo</span>'
            + '<button type="button" id="compass-interference-x" aria-label="Skrýt upozornění" '
            + 'style="flex:0 0 auto; pointer-events:auto; width:26px; height:26px; padding:0; border:none; border-radius:50%; '
            + 'background:rgba(255,255,255,0.22); color:#fff; font-size:calc(17px * var(--ag-font-scale, 1)); line-height:1; cursor:pointer; '
            + '-webkit-tap-highlight-color:transparent;">×</button>';
        document.body.appendChild(banner);
        banner.querySelector('#compass-interference-x').addEventListener('click', function () {
            dismissed = true;
            banner.style.display = 'none';
        });
        return banner;
    }

    // Centrum upozorneni (js/upozorneni.js): jednotny sloupec nahore, kde se
    // hlasky neprekryvaji. Vlastni cerveny banner zustava jako fallback, kdyby
    // centrum nebylo nactene (modul je dal odpojitelny samostatne).
    function _center() { return (window.AGNotify && typeof window.AGNotify.set === 'function') ? window.AGNotify : null; }

    function setBanner(show, now) {
        const C = _center();
        if (C) {
            if (banner) banner.style.display = 'none';
            if (dismissed) { C.clear('compass'); return; }
            if (show) {
                if (!shownSince) shownSince = now;
                hiddenSince = 0;
                C.set('compass', {
                    level: 'danger',
                    text: 'Kompas rušen (kov poblíž) — AR šipka může mířit mimo',
                    onDismiss: function () { dismissed = true; }
                });
            } else if (C.has('compass')) {
                // hystereze: skryt az po 2 s klidu, at to neblika
                if (!hiddenSince) hiddenSince = now;
                if (now - hiddenSince > 2000) C.clear('compass');
            }
            return;
        }
        if (dismissed) { if (banner) banner.style.display = 'none'; return; }
        const b = ensureBanner();
        if (show) {
            if (b.style.display === 'none') shownSince = now;
            b.style.display = 'flex';
            hiddenSince = 0;
        } else {
            // hystereze: skryt az po 2 s klidu, at to neblika
            if (b.style.display !== 'none') { if (!hiddenSince) hiddenSince = now; if (now - hiddenSince > 2000) b.style.display = 'none'; }
        }
    }

    var _absSeen = false;   // dorazila pouzitelna ABSOLUTNI udalost? (viz registrace posluchacu niz)
    function onOrient(event) {
        if (!_absSeen && event && event.absolute === true && event.alpha != null) _absSeen = true;
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : (event.timeStamp || 0);
        if (!t0) t0 = now;
        const h = (event.webkitCompassHeading != null) ? event.webkitCompassHeading : (event.alpha != null ? 360 - event.alpha : null);
        if (h == null) return;

        // iOS hlasi presnost primo (stupne); zaporne / velke = nespolehlive
        const acc = (typeof event.webkitCompassAccuracy === 'number') ? event.webkitCompassAccuracy : null;
        let badAcc = (acc != null && (acc < 0 || acc > 30));

        // Android heuristika: kmitani na miste (velka draha, mala vysledna zmena)
        samples.push({ t: now, h: h });
        while (samples.length && now - samples[0].t > 1500) samples.shift();
        let oscillating = false;
        if (samples.length >= 6) {
            let path = 0, reversals = 0, prevSign = 0;
            for (let i = 1; i < samples.length; i++) {
                const d = _adiff(samples[i].h, samples[i - 1].h);
                path += Math.abs(d);
                const s = d > 0.5 ? 1 : (d < -0.5 ? -1 : 0);
                if (s && prevSign && s !== prevSign) reversals++;
                if (s) prevSign = s;
            }
            const net = Math.abs(_adiff(samples[samples.length - 1].h, samples[0].h));
            oscillating = path > 60 && net < path * 0.4 && reversals >= 3;
        }

        // nezdrzovat hned po startu kompasu (ustaleni) ani behem kalibracni napovedy
        const settled = now - t0 > 2500;
        const show = _live() && settled && !_calibOpen() && (badAcc || oscillating);
        setBanner(show, now);
    }

    if (typeof DeviceOrientationEvent !== 'undefined') {
        // vlastni posluchac; na iOS dorazi az po udeleni opravneni (to resi app jinde)
        // BATERIE: Chrome na Androidu doruci OBE udalosti (~60x/s kazdou), takze onOrient
        // s obema posluchaci bezel 2x na snimek a vzorky se do `samples` sypaly dvojmo.
        // Navesime jen absolutni; relativni doregistrujeme az kdyz do 1,5 s neprijde
        // pouzitelna absolutni udalost (iOS ji nezna a hlasi webkitCompassHeading).
        window.addEventListener('deviceorientationabsolute', onOrient, true);
        setTimeout(function () {
            if (!_absSeen) window.addEventListener('deviceorientation', onOrient, true);
        }, 1500);
    }

    // ---------- 2) KONTROLA PODLE SLUNCE ----------
    // Poloha Slunce (NOAA, presnost na des. stupne staci pro kontrolu kompasu).
    function sunPos(date, lat, lng) {
        const rad = Math.PI / 180;
        const tz = -date.getTimezoneOffset() / 60; // hodiny vychodne od UTC
        const start = new Date(date.getFullYear(), 0, 0);
        const doy = Math.floor((date - start) / 86400000);
        const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
        const g = 2 * Math.PI / 365 * (doy - 1 + (hour - 12) / 24);
        const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
        const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
        const tst = hour * 60 + eqtime + 4 * lng - 60 * tz; // pravy slunecni cas (min)
        const ha = tst / 4 - 180; // hodinovy uhel (stupne)
        const latr = lat * rad;
        let cz = Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(ha * rad);
        cz = Math.max(-1, Math.min(1, cz));
        const zen = Math.acos(cz);
        const el = 90 - zen / rad;
        let az = 0;
        const sz = Math.sin(zen);
        if (Math.abs(sz) > 1e-6) {
            let ca = (Math.sin(decl) - Math.sin(latr) * cz) / (Math.cos(latr) * sz);
            ca = Math.max(-1, Math.min(1, ca));
            const a = Math.acos(ca) / rad;
            az = (ha > 0) ? (360 - a) : a;
        }
        return { az: ((az % 360) + 360) % 360, el: el };
    }

    let sunModal = null, sunTimer = null;

    function buildSunModal() {
        sunModal = document.createElement('div');
        sunModal.className = 'modal-overlay';
        sunModal.id = 'sun-check-modal';
        sunModal.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent); margin-top:0;">Kontrola kompasu podle Slunce</h3>'
            + '<div class="modal-body">'
            + '<p style="font-size:calc(13px * var(--ag-font-scale, 1)); line-height:1.4; margin:0 0 14px;">Namíř <b>zadní kameru</b> telefonu na Slunce (nedívej se do něj přímo) a drž telefon svisle. Když kompas sedí, tvůj směr se shoduje s azimutem Slunce.</p>'
            + '<div id="sun-check-rows"></div>'
            + '</div>'
            + '<button class="btn btn-secondary" style="margin-top:15px;" onclick="closeSunCheck()">Zavřít</button>'
            + '</div>';
        document.body.appendChild(sunModal);
    }

    function renderSun() {
        const rows = document.getElementById('sun-check-rows');
        if (!rows) return;
        const lat = (typeof userLat !== 'undefined') ? userLat : null;
        const lng = (typeof userLng !== 'undefined') ? userLng : null;
        if (lat == null || lng == null) {
            rows.innerHTML = '<div style="color:var(--warning); font-size:calc(14px * var(--ag-font-scale, 1));">Čekám na GPS polohu…</div>';
            return;
        }
        const s = sunPos(new Date(), lat, lng);
        const head = (typeof currentHeading !== 'undefined' && currentHeading != null) ? currentHeading : null;
        function row(l, v, c) { return '<div class="rdt"><span class="rdt-l">' + l + '</span><span class="rdt-v"' + (c ? ' style="color:' + c + ';"' : '') + '>' + v + '</span></div>'; }
        let html = '';
        if (s.el < -1) {
            html += '<div style="color:var(--warning); font-size:calc(14px * var(--ag-font-scale, 1)); margin-bottom:10px;">Slunce je pod obzorem — kontrolu nelze provést.</div>';
            html += row('Azimut Slunce', s.az.toFixed(0) + '° (pod obzorem)');
        } else {
            html += row('Azimut Slunce', s.az.toFixed(0) + '°');
            html += row('Výška Slunce', s.el.toFixed(0) + '°');
            if (head != null) {
                html += row('Tvůj směr (kompas)', head.toFixed(0) + '°');
                const dev = _adiff(head, s.az);
                const ad = Math.abs(dev);
                let col = 'var(--accent)', verdict = 'Kompas sedí dobře ✅';
                if (ad > 20) { col = 'var(--danger)'; verdict = 'Velká odchylka — kompas rušen/nezkalibrovaný'; }
                else if (ad > 8) { col = 'var(--warning)'; verdict = 'Mírná odchylka — zvaž rekalibraci (osmička)'; }
                html += row('Odchylka', (dev > 0 ? '+' : '') + dev.toFixed(0) + '°', col);
                html += '<div style="margin-top:10px; font-size:calc(13px * var(--ag-font-scale, 1)); color:' + col + '; font-weight:600;">' + verdict + '</div>';
            } else {
                html += '<div style="color:var(--warning); font-size:calc(13px * var(--ag-font-scale, 1)); margin-top:8px;">Čekám na údaj z kompasu… (povol pohyb/orientaci)</div>';
            }
        }
        rows.innerHTML = html;
    }

    window.openSunCheck = function () {
        const cm = document.getElementById('settings-modal');
        if (cm) cm.style.display = 'none';
        const km = document.getElementById('compass-modal');   // kompas je nyní samostatný modál
        if (km) km.style.display = 'none';
        if (!sunModal) buildSunModal();
        sunModal.style.display = 'flex';
        renderSun();
        if (sunTimer) (window.AG && AG.clearUiInterval ? AG.clearUiInterval : clearInterval)(sunTimer);
        sunTimer = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(renderSun, 250);
    };
    window.closeSunCheck = function () {
        if (sunTimer) { (window.AG && AG.clearUiInterval ? AG.clearUiInterval : clearInterval)(sunTimer); sunTimer = null; }
        if (sunModal) sunModal.style.display = 'none';
    };
})();
