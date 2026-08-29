// ===== AR Geodet — GEODETICKÉ ÚDAJE BODU (ČÚZK) (ODPOJITELNÁ vrstva) ===========
// Neinvazivní vrstva ve stylu js/vytycovani.js: NEEDITUJE logika.js ani
// grafika.js, jen za běhu OBALÍ showDetails() a do karty bodu přidá tlačítko
// „Geodetické údaje (ČÚZK)". Pro úřední body (TB/ZhB/PBPP/nivelační) ukáže
// všechny atributy stažené z ČÚZK (pt.rawData) + S-JTSK/WGS souřadnice a nabídne
// odkazy na oficiální zdroje (DATAZ — hledání dle čísla bodu, mapa polohy).
//
// Pozn.: ČÚZK veřejně nedokumentuje stabilní „deep-link na konkrétní bod", proto
// místopis/abris je u TB/ZhB nejjistěji v DATAZ po vyhledání dle čísla bodu
// (číslo zde zobrazujeme + lze zkopírovat). Plný geodetický údaj je v Geoprohlížeči
// ČÚZK po výběru bodu na mapě. Data © ČÚZK.
//
// Odstranění: smaž js/cuzk-geodata.js + řádek <script> v index.html (a v sw.js).
// ================================================================================
(function () {
    'use strict';

    function typeLabel(cat) {
        if (cat === 'TB') return 'Trigonometrický bod';
        if (cat === 'ZHB') return 'Zhušťovací bod';
        if (cat === 'NIVEL') return 'Nivelační / výškový bod';
        if (cat === 'PBPP') return 'Podrobný polohový bod (PPBP)';
        return 'Bod bodového pole';
    }
    function prettyKey(k) { return String(k).replace(/_/g, ' ').toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }); }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    function copy(txt) {
        try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); return true; } } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cuzk-geodata:copy'); }
        try { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cuzk-geodata:copy'); }
        return false;
    }

    function ensureModal() {
        if (document.getElementById('aggd-modal')) return;
        var el = document.createElement('div');
        el.className = 'modal-overlay'; el.id = 'aggd-modal'; el.style.zIndex = '100002';
        el.innerHTML =
            '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;margin-bottom:4px;"><svg class="icon"><use href="#i-crosshair"/></svg> <span id="aggd-title">Bod</span></h3>'
            + '<div id="aggd-sub" style="font-size:calc(13px * var(--ag-font-scale, 1));opacity:.75;margin-bottom:8px;"></div>'
            + '<div class="modal-body" id="aggd-body"></div>'
            + '<div id="aggd-actions" style="margin-top:12px;"></div>'
            + '<div style="font-size:calc(11px * var(--ag-font-scale, 1));opacity:.55;margin-top:10px;">Popisné údaje a místopis bodu poskytuje ČÚZK. Data © ČÚZK.</div>'
            + '<button class="btn btn-secondary" style="margin-top:10px;" onclick="document.getElementById(\'aggd-modal\').style.display=\'none\'">Zavřít</button>'
            + '</div>';
        document.body.appendChild(el);
    }

    function row(l, v) { return '<div class="geo-data-row"><span class="geo-label">' + esc(l) + '</span><span class="geo-value">' + esc(v) + '</span></div>'; }

    function openGeodata(pt) {
        ensureModal();
        var Y = '', X = '';
        try { var sj = proj4('EPSG:4326', 'EPSG:5514', [pt.lng, pt.lat]); Y = Math.abs(sj[0]).toFixed(2); X = Math.abs(sj[1]).toFixed(2); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'cuzk-geodata:openGeodata'); }
        document.getElementById('aggd-title').innerText = '#' + pt.name;
        document.getElementById('aggd-sub').innerText = typeLabel(pt.cat);

        var html = row('S-JTSK Y', Y) + row('S-JTSK X', X) + row('WGS84', pt.lat.toFixed(6) + ', ' + pt.lng.toFixed(6));
        // Atributy z ČÚZK (pt.rawData) — vynech prázdné, "Null", geometrii a interní ID
        var raw = pt.rawData || {};
        var skip = /^(OBJECTID|FID|SHAPE|GLOBALID|GEOMETRY)/i;
        var any = false;
        for (var k in raw) {
            if (!raw.hasOwnProperty(k)) continue;
            if (skip.test(k)) continue;
            var v = raw[k];
            if (v == null || v === '' || String(v).trim() === '' || String(v).toLowerCase() === 'null') continue;
            html += row(prettyKey(k), v); any = true;
        }
        if (!any) html += '<div style="font-size:calc(12.5px * var(--ag-font-scale, 1));opacity:.6;margin-top:8px;">Další atributy nejsou u tohoto bodu k dispozici (bod nemusel přijít z databáze ČÚZK, nebo je offline).</div>';
        document.getElementById('aggd-body').innerHTML = html;

        // Akce
        var acts = '';
        acts += '<button class="btn btn-secondary" id="aggd-copy"><svg class="icon"><use href="#i-upload"/></svg> Kopírovat číslo a souřadnice</button>';
        if (pt.cat === 'TB' || pt.cat === 'ZHB') {
            acts += '<button class="btn btn-secondary" style="margin-top:10px;" id="aggd-dataz"><svg class="icon"><use href="#i-star"/></svg> DATAZ ČÚZK — hledat dle čísla bodu</button>';
        }
        acts += '<button class="btn btn-secondary" style="margin-top:10px;" id="aggd-map"><svg class="icon"><use href="#i-star"/></svg> Ukázat polohu na mapě</button>';
        document.getElementById('aggd-actions').innerHTML = acts;

        var cp = document.getElementById('aggd-copy');
        if (cp) cp.onclick = function () { var ok = copy('#' + pt.name + '  Y=' + Y + '  X=' + X + '  (' + pt.lat.toFixed(6) + ', ' + pt.lng.toFixed(6) + ')'); cp.innerHTML = ok ? '✓ Zkopírováno' : 'Kopírování selhalo'; setTimeout(function () { cp.innerHTML = '<svg class="icon"><use href="#i-upload"/></svg> Kopírovat číslo a souřadnice'; }, 1500); };
        var dz = document.getElementById('aggd-dataz');
        if (dz) dz.onclick = function () { copy(pt.name); try { window.open('https://dataz.cuzk.gov.cz/', '_blank', 'noopener'); } catch (e) {} };
        var mp = document.getElementById('aggd-map');
        if (mp) mp.onclick = function () { try { window.open('https://mapy.cz/zakladni?source=coor&id=' + pt.lng.toFixed(6) + ',' + pt.lat.toFixed(6) + '&x=' + pt.lng.toFixed(6) + '&y=' + pt.lat.toFixed(6) + '&z=18', '_blank', 'noopener'); } catch (e) {} };

        document.getElementById('aggd-modal').style.display = 'flex';
    }
    window.agOpenGeodata = openGeodata;

    // ---- obal showDetails: přidat tlačítko do karty bodu (jen úřední body) ------
    function hookShowDetails() {
        if (typeof showDetails !== 'function' || showDetails.__aggd) return false;
        var _orig = showDetails;
        showDetails = function (pt, distance) {
            _orig(pt, distance);
            try {
                if (!pt || pt.cat === 'CUSTOM') { var old = document.getElementById('aggd-btn'); if (old) old.style.display = 'none'; return; }
                var btn = document.getElementById('aggd-btn');
                if (!btn) {
                    btn = document.createElement('button');
                    btn.id = 'aggd-btn'; btn.className = 'btn btn-secondary';
                    btn.innerHTML = '<svg class="icon"><use href="#i-crosshair"/></svg> Geodetické údaje (ČÚZK)';
                    var anchor = document.getElementById('highlight-btn') || document.getElementById('close-card-btn');
                    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
                }
                btn.style.display = '';
                btn.onclick = function () { openGeodata(pt); };
            } catch (e) { console.warn('[cuzk-geodata]', e); }
        };
        showDetails.__aggd = true;
        return true;
    }

    function init() {
        if (hookShowDetails()) return;
        // showDetails ještě není definované → zkusit znovu krátce po načtení
        var tries = 0;
        var iv = setInterval(function () { tries++; if (hookShowDetails() || tries > 40) clearInterval(iv); }, 150);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });
})();
