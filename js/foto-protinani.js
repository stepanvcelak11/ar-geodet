// ===== AR Geodet — BOD ZE DVOU FOTEK (ODPOJITELNÁ vrstva) ======================
// Neinvazivní. NEEDITUJE logika.js, grafika.js ani js/ar-intersection.js — čte
// jen globály (userLat/userLng, currentHeading, currentGpsAccuracy, arPoints,
// getDistance/getBearing, visSettings, window._arProj) a ukládá přes
// window.addImportedPoints(), stejně jako protínání vpřed.
//
// K ČEMU TO JE
// Doplněk k „Protínání vpřed z úhlů" (js/ar-intersection.js). Ta úloha je
// stejná — určit bod, na který se nedá dojít — ale ZPŮSOB PRÁCE je jiný:
//   • protínání z úhlů: na každém stanovisku musíš KLIDNĚ MÍŘIT křížem kamery
//     a podržet záměru; třes ruky jde přímo do výsledku,
//   • tenhle nástroj: na stanovisku jen CVAKNEŠ FOTKU (vteřina) a na cíl
//     klepneš do ZMRZLÉHO OBRAZU — prstem, v klidu, se zvětšeným detailem, a
//     klidně až v autě. Cíl navíc nemusí být uprostřed záběru.
// Použití: roh budovy za plotem, střešní prvek, komín, bod na druhé straně
// řeky, cokoli, u čeho se nedá vydržet mířit.
//
// ⚠ POCTIVĚ O KOMPASU (nejdůležitější věc na celém nástroji)
// Protínání z úhlů měří na každém stanovisku ROZDÍL dvou záměr, takže se
// konstantní chyba magnetometru vyruší. Tady se azimut bere z kompasu přímo,
// takže se chyba kompasu NEVYRUŠÍ a jde rovnou do výsledku: 10° vedle na
// vzdálenosti 50 m je 9 m mimo. Proto má nástroj REŽIM S ORIENTACÍ: když na
// fotce označíš i jeden ZNÁMÝ bod, azimut cíle se počítá jako
//     azimut(známý bod) + (úhel cíle − úhel známého bodu v obraze)
// a konstantní chyba kompasu vypadne úplně stejně jako u protínání z úhlů.
// Bez orientace nástroj počítá dál, ale výsledek označí jako orientační.
//
// JAK SE Z PIXELU STANE ÚHEL
// Přesně inverzí projekce, kterou appka používá pro AR značky
// (_projectARPoint v js/grafika.js) — jinak by výsledky nesouhlasily s tím,
// co uživatel vidí v obraze:
//     x% = 50 + (uH / halfH) * 50      uH = odchylka azimutu od středu záběru
//     y% = 50 + (vV / halfV) * 50      vV = úhel pod horizontem − sklon kamery
// s rotací obrazu o roll. Tady se to počítá pozpátku: z klepnutí → úhly.
// Snímek se ZÁMĚRNĚ ořezává stejně, jako video ořezává `object-fit: cover`
// do #camera-container — jinak by zorný úhel z Nastavení (fovH/fovV) na
// fotku neseděl a všechny úhly by byly systematicky špatně.
//
// Vstup: dlaždice „Bod ze dvou fotek" v Nástrojích (Měření).
// API: window.agOpenFotoProtinani().
// Odstranění: smaž js/foto-protinani.js + jeho řádek v index.html a spusť
//             python scripts/gen_sw_assets.py --bump.
// ==============================================================================
(function () {
    'use strict';
    if (window.agOpenFotoProtinani) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l6 4-6 4V8zM21 8l-6 4 6 4V8z"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3v4M12 17v4"/></svg>';

    var MIN_BASE = 8;        // kratší základna než tohle nemá pro protnutí smysl
    var MIN_CUT = 12;        // pod tímhle úhlem protnutí je poloha nespolehlivá
    var MAX_W = 1280;        // šířka uloženého snímku
    var SIGMA_TAP = 0.8;     // odhad chyby označení v obraze (°)
    var SIGMA_COMPASS = 6;   // odhad chyby kompasu bez orientace (°)

    var modal = null;
    var shots = [];          // [{img, lat, lng, acc, heading, pitch, roll, halfH, halfV, w, h, target:{x,y}, orient:{x,y,pt}}]
    var active = 0;          // který snímek se právě upravuje
    var result = null;

    function swallow(e, w) { try { window.AG && AG.swallow && AG.swallow(e, 'foto-protinani:' + w); } catch (e2) { /* fail-silent */ } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function info(m, t) { try { if (typeof window.agInfo === 'function') return window.agInfo(m, t); } catch (e) { swallow(e, 'info'); } }
    function num(v) { return Math.round(v * 100) / 100; }
    function cz(v, d) { return v.toFixed(d == null ? 1 : d).replace('.', ','); }

    function here() {
        try { if (typeof userLat === 'number' && typeof userLng === 'number' && isFinite(userLat) && isFinite(userLng)) return { lat: userLat, lng: userLng }; } catch (e) { swallow(e, 'here'); }
        return null;
    }
    function accNow() {
        try { if (typeof currentGpsAccuracy === 'number' && isFinite(currentGpsAccuracy)) return currentGpsAccuracy; } catch (e) { swallow(e, 'acc'); }
        return null;
    }
    function headNow() {
        try { if (typeof currentHeading === 'number' && isFinite(currentHeading)) return currentHeading; } catch (e) { swallow(e, 'head'); }
        return null;
    }
    function dist(a, b) { try { if (typeof getDistance === 'function') return getDistance(a.lat, a.lng, b.lat, b.lng); } catch (e) { swallow(e, 'dist'); } return null; }
    function bear(a, b) { try { if (typeof getBearing === 'function') return getBearing(a.lat, a.lng, b.lat, b.lng); } catch (e) { swallow(e, 'bear'); } return null; }
    function ang(d) { return ((d + 540) % 360) - 180; }

    // bod ve vzdálenosti d a azimutu az od výchozího (sférický model, stejný jako getDistance)
    function destPoint(lat, lng, az, d) {
        var R = 6371000, r = Math.PI / 180;
        var la = lat * r, lo = lng * r, b = az * r, dr = d / R;
        var la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(b));
        var lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
        return { lat: la2 / r, lng: ((lo2 / r) + 540) % 360 - 180 };
    }

    // ---- pořízení snímku -------------------------------------------------------
    function video() {
        var v = document.getElementById('camera-feed');
        return (v && v.videoWidth > 0 && v.readyState >= 2) ? v : null;
    }

    function snap() {
        var v = video();
        if (!v) { info('Kamera neběží. Přepni appku do režimu AR (nebo split), ať je vidět obraz, a zkus to znovu.'); return null; }
        var me = here();
        if (!me) { info('Nemám polohu — bez GPS neumím stanovisko založit.'); return null; }
        var h = headNow();
        if (h == null) { info('Kompas zatím nedává data — pohni telefonem (osmička).'); return null; }

        var cont = document.getElementById('camera-container') || v.parentNode;
        var cw = cont.clientWidth || v.clientWidth || v.videoWidth;
        var ch = cont.clientHeight || v.clientHeight || v.videoHeight;
        var vw = v.videoWidth, vh = v.videoHeight;

        // OŘEZ JAKO `object-fit: cover`: video je v kontejneru zvětšené tak, aby ho
        // vyplnilo, a přesahy se ořežou. Fotka musí obsahovat PRÁVĚ TO, co je vidět —
        // jinak by fovH/fovV z Nastavení platily na jiný výřez, než na jaký byly
        // nastavené, a všechny odečtené úhly by byly systematicky vedle.
        var scale = Math.max(cw / vw, ch / vh);
        var sw = Math.min(vw, cw / scale), sh = Math.min(vh, ch / scale);
        var sx = (vw - sw) / 2, sy = (vh - sh) / 2;

        var outW = Math.min(MAX_W, Math.round(sw));
        var outH = Math.max(1, Math.round(outW * sh / sw));

        var cv = document.createElement('canvas');
        cv.width = outW; cv.height = outH;
        try {
            cv.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, outW, outH);
        } catch (e) { swallow(e, 'snap:draw'); info('Snímek se nepodařilo pořídit.'); return null; }

        var proj = window._arProj || {};
        var fovH = (visSettingsSafe().fovH) || 90, fovV = (visSettingsSafe().fovV) || 75;

        return {
            img: cv.toDataURL('image/jpeg', 0.72),
            lat: me.lat, lng: me.lng, acc: accNow(),
            heading: h,
            pitch: (typeof proj.pitch === 'number') ? proj.pitch : 0,
            roll: (typeof proj.roll === 'number') ? proj.roll : 0,
            halfH: (typeof proj.halfH === 'number') ? proj.halfH : fovH / 2,
            halfV: (typeof proj.halfV === 'number') ? proj.halfV : fovV / 2,
            w: outW, h: outH,
            t: Date.now(),
            target: null, orient: null
        };
    }

    function visSettingsSafe() {
        try { if (typeof visSettings !== 'undefined' && visSettings) return visSettings; } catch (e) { swallow(e, 'visSettings'); }
        return {};
    }

    // ---- z klepnutí na úhly (inverze _projectARPoint) --------------------------
    // vrací { az: zeměpisný azimut, down: úhel pod horizontem (kladně dolů) }
    function angles(shot, nx, ny) {
        var vOffset = (visSettingsSafe().arVerticalOffset) || 0;
        var uH = (nx * 100 - 50) / 50 * shot.halfH;
        var vV = (ny * 100 - 50 + vOffset) / 50 * shot.halfV;
        // zpětná rotace o roll (dopředu bylo: tt = uH*cr - vV*sr; vV' = uH*sr + vV*cr)
        var r = shot.roll || 0;
        if (r) {
            var cr = Math.cos(r), sr = Math.sin(r);
            var u0 = uH * cr + vV * sr;
            var v0 = -uH * sr + vV * cr;
            uH = u0; vV = v0;
        }
        return { uH: uH, az: ((shot.heading + uH) % 360 + 360) % 360, down: vV + (shot.pitch || 0) };
    }

    // Azimut cíle se ZPŘESNĚNOU orientací: pokud je na snímku označený známý bod,
    // vezme se jeho SKUTEČNÝ azimut ze souřadnic a přičte se rozdíl úhlů v obraze.
    // Konstantní chyba kompasu se tím vyruší (stejný princip jako u resekce).
    function targetAz(shot) {
        var t = angles(shot, shot.target.x, shot.target.y);
        if (shot.orient && shot.orient.pt) {
            var o = angles(shot, shot.orient.x, shot.orient.y);
            var trueAz = bear({ lat: shot.lat, lng: shot.lng }, shot.orient.pt);
            if (trueAz != null) return { az: ((trueAz + (t.uH - o.uH)) % 360 + 360) % 360, down: t.down, oriented: true };
        }
        return { az: t.az, down: t.down, oriented: false };
    }

    // ---- protnutí --------------------------------------------------------------
    function compute() {
        if (shots.length < 2 || !shots[0].target || !shots[1].target) return null;
        var A = shots[0], B = shots[1];
        var pa = { lat: A.lat, lng: A.lng }, pb = { lat: B.lat, lng: B.lng };
        var base = dist(pa, pb), bAB = bear(pa, pb);
        if (base == null || bAB == null) return { err: 'Nepodařilo se spočítat základnu mezi stanovisky.' };
        if (base < MIN_BASE) return { err: 'Stanoviska jsou od sebe jen ' + cz(base) + ' m. Protnutí potřebuje aspoň ' + MIN_BASE + ' m základny — přejdi dál a vyfoť znovu.' };

        var ta = targetAz(A), tb = targetAz(B);
        var gA = ang(ta.az - bAB);
        var gB = ang(tb.az - (bAB + 180));

        // Paprsky se protnou před stanovisky jen když cíl leží na téže straně
        // základny z obou pohledů — tedy když mají úhly opačné znaménko.
        if (gA * gB >= 0) return { err: 'Paprsky se před tebou neprotnou. Nejspíš je na jedné z fotek označený jiný detail než na druhé — zkontroluj, že křížek míří na TÝŽ bod.' };

        var a = Math.abs(gA), b = Math.abs(gB), cut = 180 - a - b;
        if (cut <= 0) return { err: 'Geometrie nedává řešení (úhly ' + cz(a) + '° a ' + cz(b) + '°). Zkontroluj označení cíle na obou fotkách.' };

        var sinCut = Math.sin(cut * Math.PI / 180);
        var dA = base * Math.sin(b * Math.PI / 180) / sinCut;
        var dB = base * Math.sin(a * Math.PI / 180) / sinCut;
        var P = destPoint(A.lat, A.lng, ta.az, dA);

        // Výška: z každého stanoviska převýšení nad úrovní očí, pak průměr.
        // `down` je kladně POD horizont, takže cíl nad okem má záporné `down`.
        var eyeH = (visSettingsSafe().eyeHeight) || 1.6;
        var dzA = -dA * Math.tan(ta.down * Math.PI / 180);
        var dzB = -dB * Math.tan(tb.down * Math.PI / 180);
        var dz = (dzA + dzB) / 2;

        // Odhad přesnosti: chyba azimutu se na vzdálenosti d promítne jako d·σ
        // a protnutí ji zesílí podle úhlu řezu. Bez orientace se do σ musí
        // započítat i chyba kompasu — ta je tu na rozdíl od protínání z úhlů
        // NEODSTRANĚNÁ, a je to zdaleka největší člen.
        var oriented = ta.oriented && tb.oriented;
        var sig = oriented ? SIGMA_TAP : Math.sqrt(SIGMA_TAP * SIGMA_TAP + SIGMA_COMPASS * SIGMA_COMPASS);
        var sigRad = sig * Math.PI / 180;
        var sPos = Math.sqrt(Math.pow(dA * sigRad, 2) + Math.pow(dB * sigRad, 2)) / Math.max(0.15, sinCut);

        return {
            lat: P.lat, lng: P.lng, dA: dA, dB: dB, base: base, cut: cut,
            dz: dz, dzSpread: Math.abs(dzA - dzB), eyeH: eyeH,
            oriented: oriented, sigma: sPos,
            azA: ta.az, azB: tb.az
        };
    }

    // ---- UI --------------------------------------------------------------------
    function styles() {
        var css =
            '#fotop-modal .fp-step{color:var(--text-muted,#9aa1ac);font-size:calc(12.5px * var(--ag-font-scale,1));line-height:1.45;margin-bottom:10px;}'
            + '#fotop-modal .fp-tabs{display:flex;gap:6px;margin-bottom:10px;}'
            + '#fotop-modal .fp-tab{flex:1;padding:8px 4px;min-height:var(--tap-min,44px);border-radius:var(--r-sm,9px);'
            + 'border:1px solid var(--glass-border,rgba(255,255,255,.1));background:var(--surface-1,rgba(255,255,255,.06));'
            + 'color:var(--text-muted,#9aa1ac);font-size:calc(12px * var(--ag-font-scale,1));font-family:inherit;cursor:pointer;}'
            + '#fotop-modal .fp-tab.fp-on{background:var(--accent-soft,rgba(47,158,116,.14));border-color:var(--accent-line,rgba(47,158,116,.42));color:var(--accent,#2f9e74);font-weight:600;}'
            + '#fotop-modal .fp-tab.fp-empty{opacity:.55;}'
            + '#fotop-modal .fp-wrap{position:relative;width:100%;border-radius:var(--r-sm,9px);overflow:hidden;'
            + 'border:1px solid var(--glass-border,rgba(255,255,255,.1));background:#000;touch-action:none;}'
            + '#fotop-modal .fp-wrap img{display:block;width:100%;height:auto;}'
            + '#fotop-modal .fp-mark{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;pointer-events:none;}'
            + '#fotop-modal .fp-mark::before,#fotop-modal .fp-mark::after{content:"";position:absolute;background:currentColor;}'
            + '#fotop-modal .fp-mark::before{left:50%;top:0;width:2px;height:100%;margin-left:-1px;}'
            + '#fotop-modal .fp-mark::after{top:50%;left:0;height:2px;width:100%;margin-top:-1px;}'
            + '#fotop-modal .fp-mark i{position:absolute;inset:9px;border:2px solid currentColor;border-radius:50%;}'
            + '#fotop-modal .fp-t{color:var(--danger,#fb7185);}'
            + '#fotop-modal .fp-o{color:var(--accent-blue,#3b82f6);}'
            + '#fotop-modal .fp-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;'
            + 'border-bottom:1px solid var(--glass-border,rgba(255,255,255,.1));font-size:calc(13px * var(--ag-font-scale,1));}'
            + '#fotop-modal .fp-row b{font-family:var(--font-mono,monospace);color:var(--text-color,#eceef2);}'
            + '#fotop-modal .fp-res{margin-top:12px;padding:12px;border-radius:var(--r-sm,9px);'
            + 'background:var(--accent-soft,rgba(47,158,116,.14));border:1px solid var(--accent-line,rgba(47,158,116,.42));'
            + 'font-size:calc(13px * var(--ag-font-scale,1));line-height:1.5;}'
            + '#fotop-modal .fp-warn{margin-top:10px;padding:11px;border-radius:var(--r-sm,9px);background:rgba(251,191,36,.12);'
            + 'border:1px solid var(--warning,#fbbf24);font-size:calc(12.5px * var(--ag-font-scale,1));line-height:1.45;}'
            + '#fotop-modal .fp-hint{color:var(--text-faint,#6b727d);font-size:calc(11.5px * var(--ag-font-scale,1));margin-top:6px;line-height:1.4;}'
            + '#fotop-modal select.fp-sel{width:100%;padding:9px;margin-top:6px;border-radius:var(--r-sm,9px);'
            + 'border:1px solid var(--border,rgba(255,255,255,.1));background:var(--bg-input,rgba(255,255,255,.06));'
            + 'color:var(--text-color,#eceef2);font-family:inherit;font-size:calc(13px * var(--ag-font-scale,1));}';
        try {
            if (window.AG && typeof AG.style === 'function') AG.style('ag-fotop-css', css);
            else { var st = document.createElement('style'); st.id = 'ag-fotop-css'; st.textContent = css; document.head.appendChild(st); }
        } catch (e) { swallow(e, 'styles'); }
    }

    function build() {
        modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'fotop-modal';
        modal.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Bod ze dvou fotek</h3>'
            + '<div class="modal-body" id="fp-body"></div>'
            + '<button class="btn btn-secondary" style="margin-top:15px;" id="fp-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(modal);
        modal.querySelector('#fp-close').addEventListener('click', close);
    }

    function knownPoints(shot) {
        var out = [];
        try {
            if (typeof arPoints === 'undefined' || !arPoints) return out;
            arPoints.forEach(function (p) {
                if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
                var d = dist({ lat: shot.lat, lng: shot.lng }, p);
                if (d != null && d >= 3 && d <= 2000) out.push({ p: p, d: d });
            });
        } catch (e) { swallow(e, 'knownPoints'); }
        out.sort(function (a, b) { return a.d - b.d; });
        return out.slice(0, 40);
    }

    function render() {
        if (!modal) return;
        var body = modal.querySelector('#fp-body');
        var v = video(), me = here();

        var html = '';
        // ---- krok 1/2: pořizování snímků
        if (shots.length < 2) {
            html += '<div class="fp-step">'
                + (shots.length === 0
                    ? 'Postav se tak, abys na cíl <b>viděl</b>, a cvakni <b>první fotku</b>. Mířit nemusíš — cíl stačí mít kdekoli v záběru.'
                    : 'Teď <b>přejdi stranou</b> (aspoň ' + MIN_BASE + ' m, ideálně tak, aby ses na cíl díval z jiného směru) a cvakni <b>druhou fotku</b>.')
                + '</div>';
            if (shots.length === 1) {
                var d0 = me ? dist({ lat: shots[0].lat, lng: shots[0].lng }, me) : null;
                html += '<div class="fp-row"><span>Odstup od první fotky</span><b>' + (d0 == null ? '–' : cz(d0) + ' m') + '</b></div>';
            }
            html += '<button class="btn btn-primary" id="fp-snap" style="margin-top:12px;"' + (v && me ? '' : ' disabled') + '>'
                + (shots.length === 0 ? 'Vyfotit ze stanoviska A' : 'Vyfotit ze stanoviska B') + '</button>';
            if (!v) html += '<div class="fp-warn">Kamera neběží — přepni do režimu <b>AR</b> nebo <b>split</b>, ať je vidět obraz.</div>';
            else if (!me) html += '<div class="fp-warn">Čekám na GPS fix.</div>';
            if (shots.length === 1) html += '<button class="btn btn-secondary" id="fp-reset" style="margin-top:8px;">Začít znovu</button>';
            body.innerHTML = html;
            wire();
            return;
        }

        // ---- krok 3: označení cíle ve fotkách
        html += '<div class="fp-tabs" id="fp-tabs">'
            + '<button type="button" class="fp-tab' + (active === 0 ? ' fp-on' : '') + (shots[0].target ? '' : ' fp-empty') + '" data-i="0">Fotka A' + (shots[0].target ? ' ✓' : '') + '</button>'
            + '<button type="button" class="fp-tab' + (active === 1 ? ' fp-on' : '') + (shots[1].target ? '' : ' fp-empty') + '" data-i="1">Fotka B' + (shots[1].target ? ' ✓' : '') + '</button>'
            + '</div>';

        var s = shots[active];
        html += '<div class="fp-step">Klepni do fotky <b>na cíl</b> (červený křížek). Značku můžeš prstem <b>posunout</b>, dokud nesedí.</div>';
        html += '<div class="fp-wrap" id="fp-wrap"><img id="fp-img" src="' + s.img + '" alt="">'
            + (s.target ? '<div class="fp-mark fp-t" id="fp-mt" style="left:' + (s.target.x * 100) + '%;top:' + (s.target.y * 100) + '%;"><i></i></div>' : '')
            + (s.orient ? '<div class="fp-mark fp-o" id="fp-mo" style="left:' + (s.orient.x * 100) + '%;top:' + (s.orient.y * 100) + '%;"><i></i></div>' : '')
            + '</div>';

        // orientace na známý bod
        var kp = knownPoints(s);
        html += '<div style="margin-top:10px;">'
            + '<label style="font-size:calc(12.5px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);">Orientace na známý bod (nepovinné, ale zpřesní)</label>';
        if (!kp.length) {
            html += '<div class="fp-hint">V okolí nemáš žádný bod, na který by šlo orientovat. Výsledek proto ponese chybu kompasu.</div>';
        } else {
            html += '<select class="fp-sel" id="fp-known"><option value="">— bez orientace —</option>';
            kp.forEach(function (o, i) {
                var sel = (s.orient && s.orient.pt && s.orient.pt === o.p) ? ' selected' : '';
                html += '<option value="' + i + '"' + sel + '>' + esc(o.p.name || 'bod') + ' · ' + cz(o.d, 0) + ' m</option>';
            });
            html += '</select>';
            html += '<div class="fp-hint">' + (s.orient && s.orient.pt
                ? 'Klepni do fotky <b>na tenhle známý bod</b> — modrý křížek. Pak se chyba kompasu z výsledku vyruší.'
                : 'Když vybereš bod, který je na fotce vidět, a klepneš na něj, chyba kompasu se z výsledku vyruší.') + '</div>';
        }
        html += '</div>';

        html += '<div style="margin-top:10px;">'
            + '<div class="fp-row"><span>Stanovisko</span><b>' + (active === 0 ? 'A' : 'B') + ' · ±' + (s.acc == null ? '?' : cz(s.acc, 0)) + ' m</b></div>'
            + '<div class="fp-row"><span>Směr kamery při fotce</span><b>' + cz(s.heading) + '°</b></div>'
            + '</div>';

        // výsledek
        result = compute();
        if (result && result.err) html += '<div class="fp-warn">' + esc(result.err) + '</div>';
        else if (result) {
            html += '<div class="fp-res">'
                + '<div style="font-weight:700;margin-bottom:6px;">Cíl je ' + cz(result.dA) + ' m od A a ' + cz(result.dB) + ' m od B</div>'
                + '<div class="fp-row"><span>Úhel protnutí</span><b>' + cz(result.cut) + '°</b></div>'
                + '<div class="fp-row"><span>Základna A–B</span><b>' + cz(result.base) + ' m</b></div>'
                + '<div class="fp-row"><span>Převýšení nad okem</span><b>' + (result.dz >= 0 ? '+' : '') + cz(result.dz) + ' m</b></div>'
                + '<div class="fp-row"><span>Odhad přesnosti</span><b>± ' + cz(result.sigma) + ' m</b></div>'
                + '<div style="margin-top:8px;color:var(--text-muted,#9aa1ac);">'
                + (result.oriented
                    ? 'Obě fotky mají orientaci na známý bod — chyba kompasu je z výsledku vyloučená.'
                    : '⚠ Bez orientace na známý bod. Výsledek nese celou chybu kompasu (počítáno s ±' + SIGMA_COMPASS + '°) — ber ho jako orientační.')
                + '</div>'
                + '<div style="margin-top:6px;color:var(--text-muted,#9aa1ac);">Výška platí nad úrovní očí (' + cz(result.eyeH, 2) + ' m nad zemí u stanoviska); rozdíl mezi oběma odečty je ' + cz(result.dzSpread) + ' m.</div>'
                + '<button class="btn btn-primary" id="fp-save" style="margin-top:10px;">Uložit jako nový bod</button>'
                + '</div>';
            if (result.cut < MIN_CUT) html += '<div class="fp-warn">Úhel protnutí je jen ' + cz(result.cut) + '°. Paprsky jsou skoro rovnoběžné a poloha je proto nejistá — přejdi dál do strany a druhou fotku zopakuj.</div>';
        } else {
            html += '<div class="fp-hint" style="margin-top:10px;">Označ cíl na <b>obou</b> fotkách, pak se spočítá poloha.</div>';
        }

        html += '<button class="btn btn-secondary" id="fp-reset" style="margin-top:10px;">Začít znovu</button>';
        body.innerHTML = html;
        wire();
    }

    function wire() {
        var b = function (id) { return modal.querySelector(id); };
        var sn = b('#fp-snap');
        if (sn) sn.addEventListener('click', function () {
            var s = snap();
            if (!s) return;
            if (shots.length === 1) {
                var d0 = dist({ lat: shots[0].lat, lng: shots[0].lng }, { lat: s.lat, lng: s.lng });
                if (d0 != null && d0 < MIN_BASE) { info('Od první fotky jsi jen ' + cz(d0) + ' m. Přejdi aspoň ' + MIN_BASE + ' m stranou.'); return; }
            }
            shots.push(s);
            active = shots.length - 1;
            try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) { swallow(e, 'snap:vib'); }
            render();
        });

        var rs = b('#fp-reset');
        if (rs) rs.addEventListener('click', function () { shots = []; active = 0; result = null; render(); });

        var tabs = b('#fp-tabs');
        if (tabs) tabs.addEventListener('click', function (ev) {
            var t = ev.target.closest('.fp-tab'); if (!t) return;
            active = +t.getAttribute('data-i'); render();
        });

        var wrap = b('#fp-wrap');
        if (wrap) {
            var dragging = null;
            var place = function (ev) {
                var img = b('#fp-img'); if (!img) return;
                var r = img.getBoundingClientRect();
                if (!r.width || !r.height) return;
                var nx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
                var ny = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
                var s = shots[active];
                // Nový křížek je vždycky CÍL; modrý (orientace) se staví jen tehdy,
                // když je vybraný známý bod a cíl už označený.
                var mode = (s.orient && s.orient.pt && s.target && dragging !== 'target') ? 'orient' : 'target';
                if (dragging) mode = dragging;
                if (mode === 'orient') s.orient = { x: nx, y: ny, pt: s.orient.pt };
                else s.target = { x: nx, y: ny };
                var mk = b(mode === 'orient' ? '#fp-mo' : '#fp-mt');
                if (mk) { mk.style.left = (nx * 100) + '%'; mk.style.top = (ny * 100) + '%'; }
                else render();
            };
            wrap.addEventListener('pointerdown', function (ev) {
                var s = shots[active];
                // klepnutí blízko existující značky = přetahování právě jí
                var img = b('#fp-img'); if (!img) return;
                var r = img.getBoundingClientRect();
                var nx = (ev.clientX - r.left) / r.width, ny = (ev.clientY - r.top) / r.height;
                var near = function (m) { return m && Math.abs(m.x - nx) < 0.06 && Math.abs(m.y - ny) < 0.06; };
                dragging = near(s.target) ? 'target' : (near(s.orient) ? 'orient' : null);
                place(ev);
                try { wrap.setPointerCapture(ev.pointerId); } catch (e) { swallow(e, 'capture'); }
                ev.preventDefault();
            });
            wrap.addEventListener('pointermove', function (ev) { if (ev.buttons || ev.pressure > 0) place(ev); });
            wrap.addEventListener('pointerup', function () { dragging = null; render(); });
        }

        var kn = b('#fp-known');
        if (kn) kn.addEventListener('change', function () {
            var s = shots[active], kp = knownPoints(s);
            if (kn.value === '') s.orient = null;
            else {
                var o = kp[+kn.value];
                s.orient = { x: (s.orient ? s.orient.x : 0.5), y: (s.orient ? s.orient.y : 0.5), pt: o.p };
            }
            render();
        });

        var sv = b('#fp-save');
        if (sv) sv.addEventListener('click', save);
    }

    function save() {
        if (!result || result.err) return;
        if (typeof window.addImportedPoints !== 'function') { info('Vkládání bodů není v této verzi dostupné.'); return; }
        var name = 'FOTO' + new Date().toISOString().slice(11, 16).replace(':', '');
        try {
            var added = window.addImportedPoints([{ name: name, lat: result.lat, lng: result.lng }]);
            info('Bod ' + name + ' uložen (přesnost ± ' + cz(result.sigma) + ' m'
                + (result.oriented ? ', s orientací' : ', bez orientace — nese chybu kompasu') + ').');
            try { if (navigator.vibrate) navigator.vibrate([25, 40, 25]); } catch (e) { swallow(e, 'save:vib'); }
            return added;
        } catch (e) { swallow(e, 'save'); info('Bod se nepodařilo uložit.'); }
    }

    function open() {
        styles();
        if (!modal) build();
        modal.style.display = 'flex';
        modal.classList.add('ag-open');
        render();
    }

    function close() {
        if (modal) { modal.style.display = 'none'; modal.classList.remove('ag-open'); }
    }

    window.agOpenFotoProtinani = open;
    window.agCloseFotoProtinani = close;
    // `test` je vystavene schvalne: protnuti a inverze projekce jsou jedine misto
    // v teto vrstve, kde se da spocitat spatne, aniz by to bylo videt na obrazovce.
    // Diky tomu jde vypocet overit v prohlizeci proti rucne spocitanemu trojuhelniku
    // (viz scripts/test_navrhy_d2.py), ne jen prokoukat.
    window.AGFotoProtinani = {
        open: open, close: close,
        test: {
            angles: angles, compute: compute, destPoint: destPoint,
            setShots: function (a) { shots = a || []; result = null; }
        }
    };

    try {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'foto-protinani', label: 'Bod ze dvou fotek', icon: ICON, cat: 'Měření', onClick: open });
        }
    } catch (e) { swallow(e, 'register'); }
})();
