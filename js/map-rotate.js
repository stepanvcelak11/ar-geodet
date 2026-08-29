// ===== AR Geodet — OTÁČENÍ MAPY: sever nahoře / po směru / zamknout (ODPOJITELNÁ) =
// Mapa se dosud VŽDY otáčela s telefonem. Při kontrole úseku silnice je to
// nečitelné (popisky se převracejí, člověk ztrácí orientaci ve staničení) a stojí
// to výkon: každá změna směru o 0,15° překomponuje vrstvu #map-wrapper (150 vmax)
// i transform na každém popisku.
//
// Tři režimy (panel Vrstvy → „Otáčení mapy", volba se pamatuje):
//   • Po směru chůze — původní chování, mapa se točí s telefonem.
//   • Sever nahoře   — mapa stojí, sever je vždy nahoře (a rotace se přestane
//                      přepočítávat → klidnější obraz i míň baterie).
//   • Zamknout směr  — zmrazí NYNĚJŠÍ natočení: podíváš se podél osy silnice,
//                      zamkneš a mapa už se nehýbe, i když se otočíš.
//
// Šipka „já" se točí dál podle skutečného azimutu (grafika.js ji rotuje zvlášť),
// takže i na zamčené mapě je vidět, kam koukáš.
//
// NAPOJENÍ: grafika.js si v renderAR() bere úhel přes window.AGMapRot.mapHeading
// (fallback = živý heading, takže bez tohoto souboru appka jede jako dřív).
// Odstranění: smaž js/map-rotate.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGMapRot) return;

    var KEY = 'agMapRot_v1';               // {m:'course'|'north'|'lock', a:<úhel pro lock>}
    var _mode = 'course', _lockAngle = 0;

    function load() {
        try {
            var o = JSON.parse(localStorage.getItem(KEY));
            if (o && (o.m === 'north' || o.m === 'lock' || o.m === 'course')) {
                _mode = o.m;
                _lockAngle = (typeof o.a === 'number' && isFinite(o.a)) ? o.a : 0;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-rotate:load'); }
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify({ m: _mode, a: _lockAngle })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-rotate:save'); } }

    // ---- jediné, co po nás chce grafika.js ------------------------------------
    // live = aktuální azimut telefonu; vrací úhel, o který se má mapa natočit
    function mapHeading(live) {
        if (_mode === 'north') return 0;
        if (_mode === 'lock') return _lockAngle;
        return live;
    }

    function liveHeading() {
        try { if (typeof currentHeading === 'number' && isFinite(currentHeading)) return ((currentHeading % 360) + 360) % 360; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-rotate:liveHeading'); }
        return 0;
    }

    function setMode(m) {
        if (m !== 'north' && m !== 'lock' && m !== 'course') m = 'course';
        if (m === 'lock') _lockAngle = liveHeading();     // zmrazíme, jak je mapa teď
        _mode = m;
        save();
        sync();
        nudge();
        try {
            if (typeof quickToast === 'function') {
                quickToast(m === 'north' ? 'Mapa: sever nahoře'
                    : m === 'lock' ? ('Mapa zamčena na ' + Math.round(_lockAngle) + '°')
                    : 'Mapa se točí po směru chůze');
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-rotate:setMode'); }
    }

    // Překreslení nečekáme na další událost z kompasu — přepneme mapu hned.
    // (grafika.js si to při dalším snímku spočítá stejně, tohle je jen odezva.)
    function nudge() {
        try {
            var w = document.getElementById('map-wrapper');
            if (!w || typeof map === 'undefined' || !map) return;
            var h = mapHeading(liveHeading());
            if (typeof userLat === 'number' && typeof userLng === 'number') {
                var p = map.latLngToContainerPoint([userLat, userLng]);
                w.style.transformOrigin = p.x + 'px ' + p.y + 'px';
            }
            w.style.transform = 'translate(-50%, -50%) rotate(' + (-h) + 'deg)';
            // mapRotation v grafika.js je `let` (nejde přepsat zvenčí) — dorovná si ho
            // sama při dalším snímku, tohle je jen okamžitá odezva na klepnutí
            var labs = document.querySelectorAll('.map-label-text');
            for (var i = 0; i < labs.length; i++) labs[i].style.transform = 'rotate(' + h + 'deg)';
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'map-rotate:nudge'); }
    }

    // ---- UI v panelu „Mapa a vrstvy" ------------------------------------------
    function build() {
        if (document.getElementById('ms-rot')) return true;
        var sheet = document.getElementById('map-sheet');
        var scroll = sheet ? sheet.querySelector('.ms-scroll') : null;
        var base = document.getElementById('ms-base');
        if (!scroll || !base) return false;

        var lbl = document.createElement('div');
        lbl.className = 'ms-lbl';
        lbl.textContent = 'Otáčení mapy';

        var seg = document.createElement('div');
        seg.className = 'ms-seg';
        seg.id = 'ms-rot';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Otáčení mapy');
        seg.innerHTML = '<button type="button" data-m="course" title="Mapa se točí s telefonem">Po směru</button>'
            + '<button type="button" data-m="north" title="Sever je vždy nahoře">Sever</button>'
            + '<button type="button" data-m="lock" title="Zmrazí nynější natočení mapy">Zamknout</button>';
        seg.addEventListener('click', function (e) {
            var b = e.target.closest('button[data-m]');
            if (b) setMode(b.getAttribute('data-m'));
        });

        // hned za výběr podkladu (nad „Vrstvy přes mapu")
        base.insertAdjacentElement('afterend', seg);
        seg.insertAdjacentElement('beforebegin', lbl);
        sync();
        return true;
    }
    function sync() {
        var seg = document.getElementById('ms-rot');
        if (!seg) return;
        var bs = seg.querySelectorAll('button[data-m]');
        for (var i = 0; i < bs.length; i++) {
            var m = bs[i].getAttribute('data-m');
            bs[i].classList.toggle('on', m === _mode);
            if (m === 'lock') bs[i].textContent = (_mode === 'lock') ? (Math.round(_lockAngle) + '°') : 'Zamknout';
        }
    }

    load();
    window.AGMapRot = {
        mapHeading: mapHeading,
        get mode() { return _mode; },
        set: setMode,
        // po přepnutí zakázky / restartu appky si UI vyžádá sladění
        refresh: function () { sync(); nudge(); }
    };

    function init() { if (!build()) setTimeout(init, 600); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(function () { build(); nudge(); }, 500); });
})();
