// ===== QTRIG — NAVIGAČNÍ PÁS NA ZEMI (ODPOJITELNÁ vrstva, 19. 9. 2026) ============
// Nahrazuje 3D šipku k cíli v AR kameře (čtyři kresby rovně / doleva / doprava /
// otočka, které se střídaly skokem při 35° a 110°) JEDNÍM PÁSEM ŠIPEK (chevronů)
// položených na zem, který se OHÝBÁ k cíli jako navigace v autě: nejbližší chevron
// je největší, vzdálenější blednou, a když je cíl za zády, pás se stočí do otočky.
// Na konci pásu sedí štítek se jménem bodu a vzdáleností (#ar-hud-info) se zlatým
// terčem — štítek už šipku nepřekrývá (dřív margin −10 px přes 48 px vysoký hrot).
//
// Vybráno uživatelem 19. 9. 2026 ze čtyř návrhů (A pás na zemi · B prstenec · C maják
// · D nová šipka) — stránka s návrhy: hlasy/sipka = ["A"].
//
// NAPOJENÍ: grafika.js ve větvi „highlightedPointData" v renderAR volá
//   window.AGNavPas && AGNavPas.snimek(diff)
// a když vrátí true, starou šipku nekreslí (SVG rovně/doleva/doprava/otočka zůstávají
// v HTML, jen schované — bez tohoto souboru appka kreslí přesně jako dřív).
// Barvu bere z Nastavení → AR → „Barva šipky a cíle" (--color-arrow), velikost z jezdce
// „Velikost 3D objektu" (--arrow-size). Volba „Tvar šipky na zemi" u pásu nemá smysl →
// řádek se schová. Za zády (|odchylka| > 135°) pás zčervená, v toleranci ±10° se
// rozsvítí a terč na štítku pulzuje; nad 90° (pas-dal) se terč schová, protože konec pásu už neleží pod štítkem.
//
// VÝKON: renderAR jede 60×/s — pás se přepočítá jen při změně odchylky o ≥ 1° (4 path
// `d` + 1 transform štítku), žádný filter ani animace nad živým videem (stín chevronu
// je druhý, tmavší polygon pod ním). Perspektiva je jeden statický CSS transform.
// ODSTRANĚNÍ: smaž js/nav-pas.js + css/nav-pas.css + jejich řádky v index.html
//             (a přegeneruj sw.js) — háček v grafika.js je pak neškodný.
// =====================================================================================
(function () {
    'use strict';
    if (window.AGNavPas) return;

    var W = 260, H = 280;                  // souřadnice SVG (viewBox), start pásu dole uprostřed
    var START = [W / 2, H - 12];
    var DELKA = 232;                       // délka osy pásu (jednotky SVG)
    var CHEVRONY = [[30, 1.0, 0.98], [96, 0.78, 0.82], [154, 0.6, 0.64], [204, 0.46, 0.46]];   // [s po ose, měřítko, krytí]
    var svg = null, cesty = [], stiny = [], kont = null, info = null, hud = null;
    var _posl = null, _stav = '', _px = null, _init = false;

    function el(n, attrs) { var e = document.createElementNS('http://www.w3.org/2000/svg', n); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }

    // chevron „V" s tloušťkou ramen, hrotem nahoru, střed hrotu v (0,0); měřítko f
    function chevron(x, y, uhel, f) {
        var p = [[-60, 40], [0, 0], [60, 40], [60, 18], [0, -22], [-60, 18]], c = Math.cos(uhel), s = Math.sin(uhel), out = [];
        for (var i = 0; i < p.length; i++) { var px = p[i][0] * f, py = p[i][1] * f; out.push((x + px * c - py * s).toFixed(1) + ' ' + (y + px * s + py * c).toFixed(1)); }
        return 'M' + out.join(' L') + ' Z';
    }

    // osa pásu: začíná dole, směr nahoru, natočení roste lineárně po délce až na odchylku
    function bod(s, odch) {
        var kroky = Math.max(1, Math.round(s / 4)), ds = s / kroky, x = START[0], y = START[1], th = 0;
        for (var i = 1; i <= kroky; i++) { th = odch * (i * ds / DELKA); x += Math.sin(th) * ds; y -= Math.cos(th) * ds; }
        return { x: x, y: y, th: th };
    }

    function init() {
        if (_init) return true;
        kont = document.getElementById('ar-hud-arrow-container'); info = document.getElementById('ar-hud-info'); hud = document.getElementById('ar-hud');
        if (!kont || !info || !hud) return false;
        svg = el('svg', { id: 'arrow-pas', viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true' });
        for (var i = CHEVRONY.length - 1; i >= 0; i--) {   // vzdálené napřed, ať nejbližší leží navrchu
            var st = el('path', { 'class': 'pas-stin' }); svg.appendChild(st); stiny[i] = st;
            var c = el('path', { 'class': 'pas-chevron', style: 'opacity:' + CHEVRONY[i][2] }); svg.appendChild(c); cesty[i] = c;
        }
        kont.appendChild(svg);
        kont.style.transform = '';               // perspektivu řídí css/nav-pas.css, ne inline styl z grafika.js
        document.body.classList.add('ag-nav-pas');
        // volba tvaru staré šipky u pásu nemá smysl — schovat select i jeho popisek
        try { var sel = document.getElementById('v-arrow-shape'); if (sel) { sel.hidden = true; var lab = sel.previousElementSibling; if (lab && lab.tagName === 'LABEL') lab.hidden = true; } } catch (e) { /* nic */ }
        _init = true;
        return true;
    }

    // volá renderAR každý snímek s odchylkou cíle od směru pohledu (°, + = vpravo); vrací true = kreslím já
    function snimek(diff) {
        if (!init()) return false;
        var d = Math.round(diff);
        if (d === _posl) return true;
        _posl = d;
        var odch = diff * Math.PI / 180, konec = null;
        for (var i = 0; i < CHEVRONY.length; i++) {
            var b = bod(CHEVRONY[i][0], odch), dd = chevron(b.x, b.y, b.th, CHEVRONY[i][1]);
            cesty[i].setAttribute('d', dd);
            stiny[i].setAttribute('d', chevron(b.x, b.y + 5 * CHEVRONY[i][1], b.th, CHEVRONY[i][1] * 1.08));
        }
        konec = bod(DELKA, odch);
        // štítek se posune vodorovně za konec pásu (px na obrazovce ≈ podíl šířky SVG × šířka prvku × zúžení perspektivou)
        var sirka = svg.getBoundingClientRect().width || (parseFloat(getComputedStyle(kont).getPropertyValue('--arrow-size')) || 100) * 1.9;   // schovaná kamera → z --arrow-size
        var px = Math.round((konec.x - W / 2) / W * sirka * 0.8);
        if (px !== _px) { _px = px; info.style.transform = 'translateX(' + px + 'px) scale(var(--hud-scale, 1))'; }
        var a = Math.abs(diff), stav = a <= 10 ? 'pas-tol' : a > 135 ? 'pas-zady' : a > 90 ? 'pas-dal' : '';
        if (stav !== _stav) { hud.classList.remove('pas-tol', 'pas-dal', 'pas-zady'); if (stav) hud.classList.add(stav); _stav = stav; }
        return true;
    }

    window.AGNavPas = { snimek: snimek, init: init, cesty: function () { return cesty; }, stav: function () { return { posl: _posl, px: _px, stav: _stav }; } };
})();
