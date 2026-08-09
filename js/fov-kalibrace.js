// ===== AR Geodet — ZMĚŘENÍ ZORNÉHO ÚHLU KAMERY (FOV) — ODPOJITELNÁ vrstva ======
// Průvodce, který zorný úhel telefonu ZMĚŘÍ místo hádání z posuvníku. AR počítá
// polohu značek na obrazovce právě z FOV: když je zadaný špatně, značky se od
// skutečnosti rozjíždějí tím víc, čím dál jsou od středu obrazu (uprostřed sedí,
// u kraje ne). Každý model telefonu má jiný.
//
// Metoda (nic navíc není potřeba, stačí appka):
//   VODOROVNÝ FOV — vyber si vzdálený osamocený objekt (stožár, roh domu, komín).
//   Natoč telefon tak, aby byl přesně u LEVÉ hrany obrazu, zaznamenej azimut; pak
//   tak, aby byl u PRAVÉ hrany, zaznamenej znovu. Rozdíl azimutů = vodorovný FOV.
//   Objekt musí být DALEKO (nad ~50 m), jinak se do rozdílu promítne i posun tvého
//   těla. Měří se 3× a bere se medián — kompas kolísá.
//   SVISLÝ FOV — totéž se svislým sklonem (vysoký objekt u horní a dolní hrany),
//   nebo se dopočítá z poměru stran obrazu.
//
// Čte jen ověřené globály: currentHeading (azimut po vyhlazení), window._arProj.pitch
// (sklon kamery pod obzor, publikuje renderAR), visSettings, setStoredData,
// applyVisualSettings. Do grafika.js ani logika.js nesahá.
//
// Odstranění: smaž js/fov-kalibrace.js + řádek v index.html a v sw.js (a tlačítko
// „Změřit" u posuvníků FOV v Nastavení).
// ================================================================================
(function () {
    'use strict';
    if (window.AGFov) return;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V7"/><path d="M4 20 12 7l8 13"/><path d="M3.5 9.5a11 11 0 0 1 17 0"/></svg>';
    var STYLE_ID = 'ag-fov-style';
    var ROUNDS_H = 3, ROUNDS_V = 2;
    var MIN_FOV = 30, MAX_FOV = 140;

    var _mode = null;           // 'h' | 'v' | null
    var _first = null;          // první záměra dvojice (hrana A)
    var _round = 0;             // dokončená kola
    var _vals = [];             // naměřené úhly jednotlivých kol
    var _resH = null, _resV = null;   // {val, spread, n}
    var _prevView = null;
    var _live = null;

    // ---- pomocníci -------------------------------------------------------------
    function byId(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }
    function agAlert(t, m) {
        try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) {}
        agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : ''));
    }
    function toast(m) { try { if (typeof quickToast === 'function') { quickToast(m); return; } } catch (e) {} }
    function heading() {
        try { if (typeof currentHeading === 'number' && isFinite(currentHeading)) return currentHeading; } catch (e) {}
        try { if (typeof smoothedHeading === 'number' && isFinite(smoothedHeading)) return smoothedHeading; } catch (e) {}
        return null;
    }
    function pitchNow() {
        try { var p = window._arProj; if (p && typeof p.pitch === 'number' && isFinite(p.pitch)) return p.pitch; } catch (e) {}
        return null;
    }
    function fovH() { try { return +visSettings.fovH || 90; } catch (e) { return 90; } }
    // Zorny uhel plati vzdy pro KONKRETNI rezim kamery. Kdyz telefon spusti jiny rezim
    // (jine rozliseni = jiny vyrez), kalibrace prestane sedet a nebylo jak to poznat.
    function camInfo() {
        try {
            var s = window._agCamSettings;
            if (!s || !s.width) return '';
            return '<br><span style="opacity:.7; font-size:12px;">Kamera běží v ' + s.width + '\u00d7' + s.height
                 + (s.frameRate ? ' · ' + Math.round(s.frameRate) + ' fps' : '') + '</span>';
        } catch (e) { return ''; }
    }
    function fovV() { try { return +visSettings.fovV || 75; } catch (e) { return 75; } }
    function median(a) {
        var s = a.slice().sort(function (x, y) { return x - y; });
        var n = s.length; if (!n) return null;
        return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    }
    function fmt(v) { return (Math.round(v * 10) / 10).toFixed(1).replace('.', ','); }

    // ---- zápis do nastavení (stejnou cestou jako profily kalibrace) -------------
    function applyFov(h, v) {
        try {
            if (typeof visSettings === 'undefined' || !visSettings) return false;
            if (h != null && isFinite(h)) visSettings.fovH = Math.max(40, Math.min(120, Math.round(h * 10) / 10));
            if (v != null && isFinite(v)) visSettings.fovV = Math.max(40, Math.min(130, Math.round(v * 10) / 10));
            if (typeof setStoredData === 'function') setStoredData('arVisSettings12', JSON.stringify(visSettings));
            if (typeof applyVisualSettings === 'function') applyVisualSettings();
            return true;
        } catch (e) { return false; }
    }

    // =====================================================================
    //  Z OHNISKOVÉ VZDÁLENOSTI (bez měření)
    // ---------------------------------------------------------------------
    //  Měřicí průvodce níž potřebuje spolehlivý kompas a vzdálený orientační
    //  bod; komu to nevyjde, dostane úhel rovnou z čísla, které výrobce udává
    //  u fotoaparátu („hlavní 26 mm"). Je to VŽDY přepočet na kinofilm
    //  (ekvivalent 35 mm), takže platí referenční políčko 36 × 24 mm:
    //        FOV = 2 · arctg( rozměr / (2 · ohnisko) )
    //
    //  ⚠⚠ POZOR NA OŘEZ: #camera-feed má v css/style.css `object-fit: cover`,
    //  takže se obraz do okna NAROLUJE a přebytek se UŘÍZNE. Na výšku držený
    //  telefon má okno mnohem užší, než je poměr stran videa, takže se ořezává
    //  ŠÍŘKA a celá zůstává VÝŠKA. Proto se z ohniska počítá SVISLÝ úhel (dlouhá
    //  strana políčka, 36 mm) a vodorovný se z něj teprve dopočítá poměrem stran
    //  okna. Naopak (vodorovný z 24 mm) to vycházelo nesmyslně: pro 26mm objektiv
    //  z toho lezlo 91° svisle, ačkoli víc než ~69° taková optika nikdy nedá.
    var FILM_LONG = 36, FILM_SHORT = 24;
    var FOCAL_PRESETS = [
        { f: 13, t: 'ultraširoký' }, { f: 16, t: 'ultraširoký' },
        { f: 24, t: 'hlavní' }, { f: 26, t: 'hlavní' }, { f: 28, t: 'hlavní' },
        { f: 35, t: 'hlavní' }, { f: 48, t: 'tele' }, { f: 52, t: 'tele' }, { f: 77, t: 'tele' }
    ];
    var _focal = null;                    // naposledy zadané ohnisko (mm)
    function fovFromFocal(f, mm) {
        if (!isFinite(f) || f <= 0) return null;
        return 2 * Math.atan(mm / (2 * f)) * 180 / Math.PI;
    }
    function viewSize() {
        var el = document.getElementById('camera-container') || document.documentElement;
        var r = el.getBoundingClientRect();
        return { w: r.width || window.innerWidth, h: r.height || window.innerHeight };
    }
    function portrait() { var s = viewSize(); return s.h >= s.w; }
    // Dvojice úhlů pro zadané ohnisko: nejdřív ten, který ořez NEbere (dlouhá
    // strana políčka podél delší strany okna), pak druhý z poměru stran okna.
    function fovPairFromFocal(f) {
        var s = viewSize();
        if (!isFinite(f) || f <= 0 || !s.w || !s.h) return null;
        var D2R = Math.PI / 180, full = fovFromFocal(f, FILM_LONG);
        if (full == null) return null;
        var other = 2 * Math.atan(Math.tan((full / 2) * D2R) * (portrait() ? (s.w / s.h) : (s.h / s.w))) / D2R;
        return portrait() ? { h: other, v: full } : { h: full, v: other };
    }

    // svislý FOV dopočtený z poměru stran obrazu (když ho uživatel neměří)
    function fovVFromAspect(h) {
        var el = document.getElementById('camera-container') || document.documentElement;
        var r = el.getBoundingClientRect();
        var w = r.width || window.innerWidth, ht = r.height || window.innerHeight;
        if (!w || !ht) return null;
        var D2R = Math.PI / 180;
        return 2 * Math.atan(Math.tan((h / 2) * D2R) * (ht / w)) / D2R;
    }

    // =====================================================================
    //  Zaměřovací režim — vyčištěná obrazovka nad kamerou
    // =====================================================================
    function declutter(on) {
        document.body.classList.toggle('agfov-clean', !!on);
        if (!on) { try { if (typeof applyViewMode === 'function') applyViewMode(); } catch (e) {} }
    }
    function ensureAim() {
        if (byId('agfov-aim')) return;
        var a = document.createElement('div');
        a.id = 'agfov-aim';
        a.innerHTML =
            '<div id="agfov-bar"><span id="agfov-txt"></span></div>'
            + '<div id="agfov-guide-a" class="agfov-guide"><span></span></div>'
            + '<div id="agfov-guide-b" class="agfov-guide"><span></span></div>'
            + '<div id="agfov-live"></div>'
            + '<div id="agfov-btns">'
            + '  <button id="agfov-shot" class="btn">Zaznamenat</button>'
            + '  <button id="agfov-undo" class="btn btn-secondary">← Zpět</button>'
            + '  <button id="agfov-cancel" class="btn btn-secondary">Zrušit</button>'
            + '</div>';
        document.body.appendChild(a);
        byId('agfov-shot').addEventListener('click', takeShot);
        byId('agfov-undo').addEventListener('click', undoShot);
        byId('agfov-cancel').addEventListener('click', function () { stopAim(true); });
    }
    function showAim(on) { ensureAim(); byId('agfov-aim').classList.toggle('on', !!on); }

    function startAim(mode) {
        // kamera musí běžet — v režimu Mapa je vypnutá
        try {
            if (typeof viewMode !== 'undefined' && viewMode === 'map') {
                _prevView = viewMode; viewMode = 'ar';
                if (typeof applyViewMode === 'function') applyViewMode();
                try { if (typeof window.agSyncViewControls === 'function') window.agSyncViewControls(); } catch (e) {}
            } else _prevView = null;
        } catch (e) { _prevView = null; }

        _mode = mode; _first = null; _round = 0; _vals = [];
        var m = byId('agfov-modal'); if (m) m.style.display = 'none';
        injectStyles(); ensureAim(); declutter(true); showAim(true);
        renderAim();
        if (!_live) _live = (window.AG && AG.uiInterval ? AG.uiInterval : setInterval)(renderLive, 200);
    }
    function stopAim(cancelled) {
        if (_live) { (window.AG && AG.clearUiInterval ? AG.clearUiInterval : clearInterval)(_live); _live = null; }
        showAim(false); declutter(false);
        try {
            if (_prevView) { viewMode = _prevView; if (typeof applyViewMode === 'function') applyViewMode(); }
        } catch (e) {}
        _prevView = null;
        _mode = null; _first = null;
        var m = byId('agfov-modal'); if (m) m.style.display = 'flex';
        renderModal();
        if (cancelled) toast('Měření zrušeno.');
    }

    function needRounds() { return _mode === 'v' ? ROUNDS_V : ROUNDS_H; }
    function edgeNames() {
        return _mode === 'v' ? ['HORNÍ hrany', 'DOLNÍ hrany'] : ['LEVÉ hrany', 'PRAVÉ hrany'];
    }
    function renderAim() {
        var txt = byId('agfov-txt'); if (!txt) return;
        var ga = byId('agfov-guide-a'), gb = byId('agfov-guide-b');
        var vert = (_mode === 'v');
        ga.className = 'agfov-guide ' + (vert ? 'top' : 'left');
        gb.className = 'agfov-guide ' + (vert ? 'bottom' : 'right');
        ga.querySelector('span').textContent = vert ? 'horní hrana' : 'levá hrana';
        gb.querySelector('span').textContent = vert ? 'dolní hrana' : 'pravá hrana';
        ga.classList.toggle('hot', _first == null);
        gb.classList.toggle('hot', _first != null);

        var names = edgeNames();
        var which = (_first == null) ? names[0] : names[1];
        txt.innerHTML = '<b>Kolo ' + (_round + 1) + ' z ' + needRounds() + '</b><br>'
            + 'Otoč telefon tak, aby byl orientační bod přesně u <b>' + which + '</b> obrazu, a klepni Zaznamenat.';
        var u = byId('agfov-undo'); if (u) u.style.display = (_first == null && !_vals.length) ? 'none' : '';
    }
    function renderLive() {
        var el = byId('agfov-live'); if (!el) return;
        if (_mode === 'v') {
            var p = pitchNow();
            el.textContent = (p == null) ? 'sklon: — (namiř na scénu)' : 'sklon ' + fmt(p) + '°'
                + (_first != null ? '   ·   zatím ' + fmt(Math.abs(p - _first)) + '°' : '');
        } else {
            var h = heading();
            if (h == null) { el.textContent = 'azimut: — (kompas nedává data)'; return; }
            var s = 'azimut ' + fmt(h) + '°';
            if (_first != null) {
                var d = Math.abs(((_first - h + 540) % 360) - 180);
                s += '   ·   zatím ' + fmt(d) + '°';
            }
            el.textContent = s;
        }
    }

    function takeShot() {
        var v = (_mode === 'v') ? pitchNow() : heading();
        if (v == null) {
            agAlert('Chybí údaj', _mode === 'v'
                ? 'Sklon kamery zatím není k dispozici — nech chvíli běžet AR pohled a zkus to znovu.'
                : 'Kompas nedává azimut. Zkontroluj, že je v Nastavení povolený a zkalibrovaný (osmička), a zkus to znovu.');
            return;
        }
        if (_first == null) { _first = v; renderAim(); renderLive(); return; }

        var fov = (_mode === 'v') ? Math.abs(v - _first) : Math.abs(((_first - v + 540) % 360) - 180);
        _first = null;
        if (fov < MIN_FOV || fov > MAX_FOV) {
            agAlert('Nedůvěryhodné měření', 'Vyšlo ' + fmt(fov) + '°, což pro kameru telefonu nedává smysl (čekáme zhruba '
                + MIN_FOV + '–' + MAX_FOV + '°). Nejčastější příčina: záměna hran, blízký objekt, nebo se telefon mezi záměrami posunul. Kolo se nezapočítalo, zkus ho znovu.');
            renderAim(); return;
        }
        _vals.push(fov); _round++;
        if (_round < needRounds()) { toast('Kolo ' + _round + ': ' + fmt(fov) + '°'); renderAim(); renderLive(); return; }

        var med = median(_vals), spread = Math.max.apply(null, _vals) - Math.min.apply(null, _vals);
        var res = { val: med, spread: spread, n: _vals.length, vals: _vals.slice() };
        if (_mode === 'v') _resV = res; else _resH = res;
        stopAim(false);
    }
    function undoShot() {
        if (_first != null) { _first = null; renderAim(); renderLive(); return; }
        if (_vals.length) { _vals.pop(); _round = Math.max(0, _round - 1); renderAim(); renderLive(); }
    }

    // =====================================================================
    //  Modál průvodce
    // =====================================================================
    function ensureModal() {
        if (byId('agfov-modal')) return;
        injectStyles();
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'agfov-modal'; el.style.zIndex = '100001';
        el.innerHTML = '<div class="modal-content" style="display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Zorný úhel kamery (FOV)</h3>'
            + '<div id="agfov-body"></div>'
            + '<button class="btn btn-secondary" style="margin-top:12px;" id="agfov-close">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
        byId('agfov-close').addEventListener('click', function () { el.style.display = 'none'; });
    }

    function renderModal() {
        ensureModal();
        var b = byId('agfov-body'); if (!b) return;
        var html =
            '<p style="font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.8;margin:0 0 10px;">AR umisťuje značky na obrazovku podle zorného úhlu kamery. '
            + 'Když nesedí, body ve <b>středu</b> obrazu sedí, ale ke <b>krajům</b> se rozjíždějí. Průvodce ho změří pomocí azimutu — '
            + 'stačí ti jeden vzdálený orientační bod.</p>'
            + '<div class="agfov-now">Teď je nastaveno: <b>' + fmt(fovH()) + '°</b> šířka · <b>' + fmt(fovV()) + '°</b> výška' + camInfo() + '</div>'
            + '<div class="agfov-tip"><b>Než začneš:</b> běž ven, zkalibruj kompas (osmička telefonem) a vyber si '
            + '<b>vzdálený</b> osamocený objekt — stožár, komín, roh domu. Musí být dál než ~50 m, jinak se do měření promítne '
            + 'i to, jak se přitom pohneš. Telefon drž na místě a jen jím otáčej.</div>';

        // --- z ohniskové vzdálenosti (nejrychlejší cesta, bez kompasu) ---
        html += '<div class="agfov-step"><div class="agfov-step-h">1 · Z ohniskové vzdálenosti (bez měření)</div>'
            + '<p style="font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.85;margin:0 0 8px;line-height:1.5;">'
            + 'Nejrychlejší cesta. Výrobce u fotoaparátu udává ohnisko v <b>ekvivalentu kinofilmu</b> — třeba „hlavní 26 mm". '
            + 'Zadej ho a úhel vypadne sám. Nepotřebuje kompas ani orientační bod.</p>'
            + '<div class="agfov-focal-row">';
        FOCAL_PRESETS.forEach(function (p) {
            html += '<button type="button" class="agfov-chip' + (_focal === p.f ? ' on' : '') + '" data-focal="' + p.f + '">'
                + p.f + ' mm<small>' + p.t + '</small></button>';
        });
        html += '</div>'
            + '<label class="agfov-focal-in">jiné ohnisko:'
            + ' <input type="number" id="agfov-focal" inputmode="decimal" step="0.1" min="5" max="300"'
            + ' value="' + (_focal != null ? _focal : '') + '" placeholder="mm"> mm</label>';
        var pair = _focal != null ? fovPairFromFocal(_focal) : null;
        if (pair) {
            html += '<div class="agfov-res">Vychází <b>' + fmt(pair.h) + '°</b> šířka · <b>' + fmt(pair.v) + '°</b> výška'
                + '<div class="agfov-sub">telefon držíš ' + (portrait() ? 'na výšku' : 'na šířku')
                + ', obraz kamery se do okna vejde ' + (portrait() ? 'na výšku a po strancích se ořezává' : 'na šířku a nahoře a dole se ořezává')
                + '<br>' + (portrait() ? 'svislý' : 'vodorovný') + ' úhel je z ohniska, druhý dopočtený z poměru stran okna'
                // applyFov drží jezdce v mezích 40–120 / 40–130°. U hodně úzkého
                // okna vyjde vodorovný úhel pod 40° a uložilo by se něco jiného,
                // než co je tu napsané — to musí uživatel vidět dopředu.
                + (pair.h < 40 ? '<br><span style="color:var(--warning,#fbbf24)">Uloží se ale 40° — appka níž nejde. Zkontroluj to v AR a případně doměř.</span>' : '')
                + '</div></div>'
                + '<button class="btn" id="agfov-focal-use">Použít tenhle úhel</button>';
        } else if (_focal != null) {
            html += '<div class="agfov-sub" style="color:var(--warning,#fbbf24)">Ohnisko musí být kladné číslo v mm.</div>';
        }
        html += '</div>';

        // --- vodorovný ---
        html += '<div class="agfov-step"><div class="agfov-step-h">2 · Vodorovný úhel měřením (záložní)</div>';
        if (_resH) {
            html += '<div class="agfov-res">Naměřeno <b>' + fmt(_resH.val) + '°</b>'
                + '<div class="agfov-sub">' + _resH.n + ' kola, rozptyl ' + fmt(_resH.spread) + '°'
                + (_resH.spread > 6 ? ' — <span style="color:var(--warning,#fbbf24)">dost velký, zkus to raději znovu s klidnější rukou</span>' : ' — dobré')
                + '<br>jednotlivá kola: ' + _resH.vals.map(fmt).join('° / ') + '°</div></div>'
                + '<button class="btn btn-secondary" id="agfov-h-again">Změřit znovu</button>';
        } else {
            html += '<button class="btn" id="agfov-h-start">Změřit vodorovný úhel (3 kola)</button>';
        }
        html += '</div>';

        // --- svislý ---
        html += '<div class="agfov-step"><div class="agfov-step-h">3 · Svislý úhel (výška)</div>';
        if (_resV) {
            html += '<div class="agfov-res">Naměřeno <b>' + fmt(_resV.val) + '°</b>'
                + '<div class="agfov-sub">' + _resV.n + ' kola, rozptyl ' + fmt(_resV.spread) + '°'
                + '<br>jednotlivá kola: ' + _resV.vals.map(fmt).join('° / ') + '°</div></div>'
                + '<button class="btn btn-secondary" id="agfov-v-again">Změřit znovu</button>';
        } else {
            var derived = _resH ? fovVFromAspect(_resH.val) : null;
            html += '<p style="font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.8;margin:0 0 8px;">Nepovinné. Buď ho změříš stejně (vysoký objekt u horní a dolní hrany, sleduje se sklon telefonu), '
                + 'nebo ho appka dopočítá z poměru stran obrazu.</p>'
                + '<button class="btn" id="agfov-v-start">Změřit svislý úhel (2 kola)</button>'
                + (derived ? '<button class="btn btn-secondary" id="agfov-v-calc" style="margin-top:8px;">Dopočítat z poměru stran (' + fmt(derived) + '°)</button>' : '');
        }
        html += '</div>';

        // --- uložení ---
        if (_resH) {
            var vv = _resV ? _resV.val : fovVFromAspect(_resH.val);
            html += '<div class="agfov-save"><div style="font-size:calc(13px * var(--ag-font-scale, 1));margin-bottom:8px;">Uloží se: <b>' + fmt(_resH.val) + '°</b> šířka · <b>'
                + (vv ? fmt(vv) : fmt(fovV())) + '°</b> výška' + (_resV ? '' : ' <span style="opacity:.7">(dopočtená)</span>') + '</div>'
                + '<button class="btn" id="agfov-save">Uložit do nastavení</button></div>';
        }
        // Jezdce nechává appka v Nastavení (cte je saveSettings podle id), ale
        // nastavení k nastroji patri — odsud se na ně dá skočit rovnou.
        if (window.AGSettings && typeof window.AGSettings.reveal === 'function') {
            html += '<button class="btn btn-secondary" id="agfov-manual" style="margin-top:10px;">Doladit ručně jezdcem</button>';
        }
        html += '<details class="adv" style="margin-top:12px;"><summary>Metoda bez kompasu (přes zeď)</summary><div class="adv-body">'
            + '<p style="font-size:calc(12.5px * var(--ag-font-scale, 1));line-height:1.5;">Když kompas zlobí: postav se kolmo k dlouhé zdi ve <b>známé</b> vzdálenosti D. '
            + 'Označ si na zdi místa, která leží přesně u levé a pravé hrany obrazu, a změř mezi nimi šířku W. Pak platí '
            + '<b>FOV = 2 · arctg(W / 2D)</b>. Například W = 4,00 m při D = 3,00 m dává 67,4°. Hodnotu pak zadej posuvníkem '
            + 'v Nastavení → AR a přesnost.</p></div></details>';

        b.innerHTML = html;

        var e, i;
        var chips = b.querySelectorAll('[data-focal]');
        for (i = 0; i < chips.length; i++) {
            chips[i].addEventListener('click', function () {
                _focal = parseFloat(this.getAttribute('data-focal'));
                renderModal();
            });
        }
        if ((e = byId('agfov-focal'))) e.addEventListener('change', function () {
            var v = parseFloat((this.value || '').replace(',', '.'));
            _focal = isFinite(v) ? v : null;
            renderModal();
        });
        if ((e = byId('agfov-focal-use'))) e.addEventListener('click', function () {
            var pr = fovPairFromFocal(_focal), h = pr ? pr.h : null, v = pr ? pr.v : null;
            if (h && applyFov(h, v)) {
                agAlert('Uloženo', 'Zorný úhel <b>' + fmt(fovH()) + '° × ' + fmt(fovV()) + '°</b> je nastavený z ohniska '
                    + fmt(_focal) + ' mm. Zkontroluj to v AR na bodě, který v terénu vidíš: měl by sedět i u kraje obrazu, ne jen uprostřed. '
                    + 'Když je vedle, výrobcem udané ohnisko nesedí na režim, ve kterém kamera běží — pak pomůže měření níž.');
                var m = byId('agfov-modal'); if (m) m.style.display = 'none';
            } else agAlert('Nelze uložit', 'Nastavení se nepodařilo zapsat.');
        });
        if ((e = byId('agfov-manual'))) e.addEventListener('click', function () {
            var m = byId('agfov-modal'); if (m) m.style.display = 'none';
            try { window.AGSettings.reveal('s-fovh'); } catch (er) {}
        });
        if ((e = byId('agfov-h-start'))) e.addEventListener('click', function () { startAim('h'); });
        if ((e = byId('agfov-h-again'))) e.addEventListener('click', function () { _resH = null; startAim('h'); });
        if ((e = byId('agfov-v-start'))) e.addEventListener('click', function () { startAim('v'); });
        if ((e = byId('agfov-v-again'))) e.addEventListener('click', function () { _resV = null; startAim('v'); });
        if ((e = byId('agfov-v-calc'))) e.addEventListener('click', function () {
            var d = fovVFromAspect(_resH.val);
            if (d) { _resV = { val: d, spread: 0, n: 0, vals: [], derived: true }; renderModal(); }
        });
        if ((e = byId('agfov-save'))) e.addEventListener('click', function () {
            var vv = _resV ? _resV.val : fovVFromAspect(_resH.val);
            if (applyFov(_resH.val, vv)) {
                agAlert('Uloženo', 'Zorný úhel <b>' + fmt(fovH()) + '° × ' + fmt(fovV()) + '°</b> je nastavený. '
                    + 'Zkontroluj to v AR na bodě, který v terénu vidíš: měl by sedět i když ho máš u kraje obrazu, ne jen uprostřed.');
                var m = byId('agfov-modal'); if (m) m.style.display = 'none';
            } else agAlert('Nelze uložit', 'Nastavení se nepodařilo zapsat.');
        });
    }

    function openTool() {
        ensureModal();
        renderModal();
        byId('agfov-modal').style.display = 'flex';
    }

    // ---- styly -----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style'); st.id = STYLE_ID;
        st.textContent = [
            '#agfov-modal h3 svg{width:20px;height:20px;vertical-align:-4px;margin-right:6px;}',
            '#agfov-modal .agfov-now{font:600 13px/1.4 var(--font-mono,monospace);color:var(--accent,#2f9e74);',
            '  background:rgba(47,158,116,0.12);border-radius:10px;padding:9px 12px;margin:0 0 10px;}',
            // Pilulky s ohnisky: musí se vejít na úzký displej v rukavicích, proto
            // wrap + velký dotykový cíl (44 px je minimum, na které se dá trefit).
            '#agfov-modal .agfov-focal-row{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;}',
            '#agfov-modal .agfov-chip{flex:1 1 78px;min-height:44px;border-radius:10px;cursor:pointer;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:var(--surface-2,rgba(255,255,255,0.06));',
            '  color:var(--text,#e6eaf0);font:600 13px/1.15 var(--font-ui,system-ui),sans-serif;padding:5px 4px;}',
            '#agfov-modal .agfov-chip small{display:block;font-weight:400;font-size:10.5px;opacity:.65;margin-top:2px;}',
            '#agfov-modal .agfov-chip.on{background:var(--accent,#2f9e74);border-color:var(--accent,#2f9e74);color:#06120d;}',
            '#agfov-modal .agfov-chip.on small{opacity:.8;}',
            '#agfov-modal .agfov-focal-in{display:block;font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.85;margin:0 0 10px;}',
            '#agfov-modal .agfov-focal-in input{width:88px;margin:0 4px;padding:8px;border-radius:8px;',
            '  border:1px solid var(--glass-border,rgba(255,255,255,0.14));background:var(--surface-2,rgba(255,255,255,0.06));',
            '  color:var(--text,#e6eaf0);font:600 14px/1 var(--font-mono,monospace);}',
            '#agfov-modal .agfov-tip{font-size:calc(12.5px * var(--ag-font-scale, 1));line-height:1.5;background:rgba(251,191,36,0.10);',
            '  border-left:3px solid var(--warning,#fbbf24);border-radius:8px;padding:9px 12px;margin:0 0 12px;}',
            '#agfov-modal .agfov-step{border:1px solid var(--glass-border,rgba(255,255,255,0.12));border-radius:12px;',
            '  padding:10px 12px 12px;margin:10px 0;background:rgba(255,255,255,0.025);}',
            '#agfov-modal .agfov-step-h{font:700 12.5px/1.2 var(--font-ui,system-ui);color:var(--accent,#2f9e74);margin-bottom:8px;}',
            '#agfov-modal .agfov-res{background:rgba(47,158,116,0.12);border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:calc(14px * var(--ag-font-scale, 1));}',
            '#agfov-modal .agfov-sub{font-size:calc(11.5px * var(--ag-font-scale, 1));opacity:.75;margin-top:4px;line-height:1.45;}',
            '#agfov-modal .agfov-save{border-top:1px solid var(--glass-border,rgba(255,255,255,0.12));margin-top:12px;padding-top:12px;}',
            // vyčištěná obrazovka během zaměřování (stejně jako AR resekce/protínání)
            'body.agfov-clean #ar-overlay{opacity:0!important;pointer-events:none!important;}',
            'body.agfov-clean #ar-hud{display:none!important;}',
            'body.agfov-clean #camera-container{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;',
            '  display:block!important;flex:1 1 auto!important;z-index:100040!important;}',
            'body.agfov-clean #map-container,body.agfov-clean #resizer{display:none!important;}',
            // zaměřovací vrstva
            '#agfov-aim{position:fixed;inset:0;z-index:100050;display:none;pointer-events:none;}',
            '#agfov-aim.on{display:block;}',
            '#agfov-bar{position:absolute;top:max(16px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);max-width:92vw;',
            '  background:rgba(8,12,16,0.86);color:#fff;padding:10px 16px;border-radius:12px;',
            '  font:500 13.5px/1.4 var(--font-ui,system-ui),sans-serif;text-align:center;}',
            '#agfov-live{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(8,12,16,0.72);',
            '  color:#e2e8f0;padding:6px 12px;border-radius:9px;font:700 13px/1 var(--font-mono,monospace);white-space:nowrap;}',
            // vodicí pruhy u hran obrazu — aktivní hrana svítí
            '.agfov-guide{position:absolute;background:rgba(255,255,255,0.28);}',
            '.agfov-guide span{position:absolute;font:700 10.5px/1 var(--font-ui,system-ui);letter-spacing:.06em;',
            '  text-transform:uppercase;color:rgba(255,255,255,0.65);white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,0.8);}',
            '.agfov-guide.hot{background:var(--accent,#2f9e74);box-shadow:0 0 14px var(--accent,#2f9e74);}',
            '.agfov-guide.hot span{color:var(--accent-bright,#4ade80);}',
            '.agfov-guide.left{left:0;top:0;bottom:0;width:3px;}',
            '.agfov-guide.right{right:0;top:0;bottom:0;width:3px;}',
            '.agfov-guide.left span{left:8px;top:34%;transform:rotate(90deg);transform-origin:left top;}',
            '.agfov-guide.right span{right:8px;top:34%;transform:rotate(-90deg);transform-origin:right top;}',
            '.agfov-guide.top{left:0;right:0;top:0;height:3px;}',
            '.agfov-guide.bottom{left:0;right:0;bottom:0;height:3px;}',
            '.agfov-guide.top span{top:10px;left:50%;transform:translateX(-50%);}',
            '.agfov-guide.bottom span{bottom:10px;left:50%;transform:translateX(-50%);}',
            '#agfov-btns{position:absolute;left:0;right:0;bottom:max(24px,env(safe-area-inset-bottom));display:flex;gap:10px;',
            '  justify-content:center;flex-wrap:wrap;pointer-events:auto;padding:0 16px;}',
            '#agfov-btns .btn{width:auto;flex:0 0 auto;min-width:118px;margin:0;}',
            '#agfov-undo,#agfov-cancel{min-width:92px!important;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- registrace ------------------------------------------------------------
    window.AGFov = { open: openTool };
    window.agOpenFovKalibrace = openTool;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'fov-kalib', label: 'Zorný úhel kamery', icon: ICON, cat: 'AR a kalibrace', onClick: openTool, order: 20 });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();
    window.addEventListener('load', function () { setTimeout(register, 350); });
})();
