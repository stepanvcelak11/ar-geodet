// ===== QTRIG — KLEPNUTÍ DO PARCELY (ODPOJITELNÁ vrstva) ====================
// PŘÁNÍ (15. 9. 2026): „Když se zapne katastr jako podklad, tak mít možnost při
// kliknutí do parcely, aby se otevřely údaje o vlastníkovi, ploše atd. — co se
// dá sehnat."
//
// CO TO DĚLÁ: je-li zapnutá vrstva „Katastrální mapa" (WMS KN, visSettings.showKatastr)
// a uživatel klepne do mapy MIMO bod, zeptá se RÚIAN (ČÚZK) na parcelu pod prstem
// a ukáže kartu:
//   • číslo parcely (u stavebních „st."), katastrální území + kód, obec,
//   • výměra (m² i ha), druh pozemku, způsob využití (číselníky ČÚZK v kódu),
//   • stojí-li na ní budova z RÚIAN: č.p./č.e., využití, podlaží, zastavěná plocha,
//   • obrys parcely se na chvíli zvýrazní v mapě (odstraní se se zavřením karty).
//
// CO SE SEHNAT NEDÁ (poctivě): VLASTNÍK A LIST VLASTNICTVÍ. Žádná bezplatná služba
// ČÚZK je nevrací — jsou jen v Nahlížení do KN, které navíc před vlastníky žádá
// opsat kód (ochrana proti robotům). Karta proto vede tlačítkem PŘÍMO na parcelu
// v Nahlížení (MapaIdentifikace.aspx podle S-JTSK souřadnic klepnutí — ověřeno
// 15. 9. 2026: přesměruje na ZobrazObjekt parcely). Otevírá se v prohlížeči,
// do rámu appky se ČÚZK vložit nedá (X-Frame-Options; viz katastrOkno v grafika.js).
//
// ZDROJE (vše bezplatné, © ČÚZK, stejný host jako bodová pole → CORS v pořádku):
//   RÚIAN Prohlížecí služba, MapServer vrstvy 5 Parcela · 7 KatastralniUzemi ·
//   12 Obec · 3 StavebniObjekt, dotaz bodem (esriGeometryPoint, inSR 4326).
//   WMS KN GetFeatureInfo (DEF_PARCELY) vrací prázdno — proto RÚIAN.
//
// CO PŘIBYLO 16. 9. 2026 (přání „zda se dá vytěžit i jinde informace o tom místě"):
//   • parcela: zdroj geometrie DKM/UKM (podle NĚJ přesnost hranice), platnost od,
//     výměra Z GRAFIKY (shoelace v S-JTSK) vedle úřední — rozdíl je vidět hned,
//   • budova: rok dokončení, konstrukce, podlahová plocha, obestavěný prostor,
//   • adresa (RÚIAN AdresniMisto do 40 m), terén DMR 5G (výška Bpv v místě),
//   • OCHRANA A OMEZENÍ jedním identify nad RÚIAN: BPEJ (rozepsaný kód), NP/CHKO/
//     rezervace/památka + jejich ochranná pásma, EVL, ptačí oblast, památný strom,
//     chráněné ložiskové území, dobývací prostor, OCHRANNÉ PÁSMO ZNAČKY BODU ZBP.
//   Ověřeno curl-em 16. 9. 2026 (vrstvy 1, 3, 5, 22–67 služby RÚIAN). Vlastník/LV
//   pořád jen v Nahlížení. Co nejde bezplatně: územní plán (každá obec zvlášť),
//   inženýrské sítě (správci), BPEJ cena (vyhláška, mění se), věcná břemena.
//
// VSTUP: js/grafika.js, handler map.on('click') — větev „klik do prázdna" volá
// AGParcelaKlik.tap(lat, lng), jen když je katastr zapnutý. Bez tohohle modulu
// je podmínka nepravdivá a klik do prázdna dál nedělá nic (rozhodnutí z 14. 6.:
// nabídka „Stáhnout okolí" se NEVRACÍ).
//
// Odstranění: smaž js/parcela-klik.js + řádek <script type="ag/lazy"> v index.html
// (a přegeneruj sw.js: python scripts/gen_sw_assets.py). Volání v grafika.js je
// za typeof-guardem a bez modulu je němé.
// ================================================================================
(function () {
    'use strict';
    if (window.AGParcelaKlik) return;

    var STYLE_ID = 'ag-pcl-style', OV_ID = 'ag-pcl-modal';
    var RUIAN = 'https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/';
    var NAHLIZENI = 'https://nahlizenidokn.cuzk.gov.cz/MapaIdentifikace.aspx?l=KN';
    var TIMEOUT_MS = 12000;
    var BARVA = '#f59e0b';

    // číselníky ČÚZK (vyhláška 357/2013 Sb., přílohy 1–3) — v odpovědi jsou jen kódy
    var DRUH = {
        2: 'orná půda', 3: 'chmelnice', 4: 'vinice', 5: 'zahrada', 6: 'ovocný sad',
        7: 'trvalý travní porost', 8: 'trvalý travní porost', 10: 'lesní pozemek', 11: 'vodní plocha',
        13: 'zastavěná plocha a nádvoří', 14: 'ostatní plocha'
    };
    var VYUZITI = {
        1: 'skleník, pařeniště', 2: 'školka', 3: 'plantáž dřevin', 4: 'les jiný než hospodářský',
        5: 'lesní pozemek, na kterém je budova', 6: 'rybník', 7: 'koryto vodního toku přirozené nebo upravené',
        8: 'koryto vodního toku umělé', 9: 'vodní nádrž přírodní', 10: 'vodní nádrž umělá', 11: 'zamokřená plocha',
        12: 'společný dvůr', 13: 'zbořeniště', 14: 'dráha', 15: 'dálnice', 16: 'silnice', 17: 'ostatní komunikace',
        18: 'ostatní dopravní plocha', 19: 'zeleň', 20: 'sportoviště a rekreační plocha', 21: 'pohřebiště',
        22: 'kulturní a osvětová plocha', 23: 'manipulační plocha', 24: 'dobývací prostor', 25: 'skládka',
        26: 'jiná plocha', 27: 'neplodná půda', 28: 'vodní plocha, na které je budova',
        29: 'fotovoltaická elektrárna', 30: 'mez, stráň'
    };
    var STAVBA = {
        1: 'průmyslový objekt', 2: 'zemědělská usedlost', 3: 'objekt k bydlení', 4: 'objekt lesního hospodářství',
        5: 'objekt občanské vybavenosti', 6: 'bytový dům', 7: 'rodinný dům', 8: 'stavba pro rodinnou rekreaci',
        9: 'stavba pro shromažďování většího počtu osob', 10: 'stavba pro obchod', 11: 'stavba ubytovacího zařízení',
        12: 'stavba pro výrobu a skladování', 13: 'zemědělská stavba', 14: 'stavba pro administrativu',
        15: 'stavba občanského vybavení', 16: 'stavba technického vybavení', 17: 'stavba pro dopravu', 18: 'garáž',
        19: 'jiná stavba', 20: 'víceúčelová stavba', 21: 'skleník', 22: 'přehrada', 23: 'hráz přehrazující vodní tok',
        24: 'hráz k ochraně před zaplavením', 25: 'hráz umělé vodní nádrže', 26: 'jez', 27: 'stavba k plavebním účelům',
        28: 'stavba k využití vodní energie', 29: 'stavba odkališť'
    };

    var KONSTRUKCE = {
        1: 'cihly, tvárnice', 2: 'kámen', 3: 'kámen a cihly', 4: 'stěnové panely', 5: 'nepálené cihly', 6: 'dřevo',
        7: 'jiné / kombinace', 8: 'nedefinováno', 9: 'nezjištěno', 10: 'kámen, cihly, tvárnice', 11: 'monolit',
        41: 'panely — beton', 42: 'panely — dřevo', 43: 'panely — ostatní', 61: 'srub / roubenka', 62: 'dřevo — lehký skelet',
        63: 'dřevo — lehký skelet (na stavbě)', 64: 'dřevo — těžký skelet', 65: 'dřevo — masivní panely', 66: 'dřevo — ostatní'
    };
    // Vrstvy RÚIAN pro „ochrana a omezení" (identify jedním dotazem, tolerance 1 px).
    // Čísla vrstev ověřena 16. 9. 2026 (MapServer?f=json). Volební okrsek (20) nezajímá.
    var OCHRANA = {
        25: 'Ochranné pásmo značky bodu ZBP', 22: 'Dobývací prostor', 24: 'Chráněné ložiskové území', 28: 'BPEJ',
        30: 'Národní park', 32: 'Ochranné pásmo NP', 34: 'Zóna ochrany přírody NP', 36: 'Arondace v zóně NP', 38: 'Klidové území NP',
        40: 'CHKO', 42: 'Zóna CHKO', 44: 'Národní přírodní rezervace', 46: 'Ochranné pásmo NPR', 48: 'Národní přírodní památka',
        50: 'Ochranné pásmo NPP', 52: 'Přírodní rezervace', 54: 'Ochranné pásmo PR', 56: 'Přírodní památka', 58: 'Ochranné pásmo PP',
        60: 'Evropsky významná lokalita (Natura 2000)', 62: 'Ptačí oblast (Natura 2000)', 63: 'Památný strom', 65: 'Ochranné pásmo památného stromu', 67: 'Smluvně chráněné území'
    };
    // BPEJ = 5 číslic: klimatický region · hlavní půdní jednotka (2) · sklon+expozice · hloubka+skeletovitost
    var BPEJ_KLIMA = ['velmi teplý, suchý', 'teplý, suchý', 'teplý, mírně suchý', 'teplý, mírně vlhký', 'mírně teplý, suchý', 'mírně teplý, mírně vlhký', 'mírně teplý (až teplý), vlhký', 'mírně chladný, vlhký', 'mírně chladný, vlhký', 'chladný, vlhký'];
    var BPEJ_SKLON = ['rovina (0–1°)', 'rovina (1–3°)', 'mírný sklon (3–7°), všesměrná expozice', 'mírný sklon (3–7°), jižní', 'mírný sklon (3–7°), severní', 'střední sklon (7–12°), jižní', 'střední sklon (7–12°), severní', 'výrazný sklon (12–17°), jižní', 'výrazný sklon (12–17°), severní', 'příkrý sklon až sráz (17°+)'];
    function bpejText(kod) {
        var k = String(kod || '').replace(/\D/g, '');
        if (k.length !== 5) return null;
        var out = [];
        if (BPEJ_KLIMA[+k[0]]) out.push('klimatický region ' + k[0] + ' — ' + BPEJ_KLIMA[+k[0]]);
        out.push('hlavní půdní jednotka ' + k.slice(1, 3));
        if (BPEJ_SKLON[+k[3]]) out.push(BPEJ_SKLON[+k[3]]);
        out.push('hloubka a skeletovitost: kód ' + k[4]);
        return out.join(' · ');
    }

    var _ov = null, _poly = null, _mark = null, _seq = 0, _posledni = null;

    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, 'parcela-klik:' + kde); } catch (e2) { /* nic */ } }
    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(m) {
        try { if (window.AG && AG.toast) return AG.toast(m); } catch (e) { swallow(e, 'toast'); }
        try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { swallow(e, 'toast'); }
    }
    function getMap() { try { return (typeof map !== 'undefined' && map) ? map : null; } catch (e) { return null; } }
    function katastrOn() { try { return !!(typeof visSettings !== 'undefined' && visSettings && visSettings.showKatastr); } catch (e) { return false; } }
    function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function fetchTO(url, ms) {
        if (typeof fetchWithTimeout === 'function') return fetchWithTimeout(url, ms);
        var ctrl = new AbortController(); var t = setTimeout(function () { ctrl.abort(); }, ms || TIMEOUT_MS);
        return fetch(url, { signal: ctrl.signal }).finally(function () { clearTimeout(t); });
    }

    // ---- RÚIAN: dotaz bodem do jedné vrstvy ------------------------------------------
    function dotaz(vrstva, lat, lng, pole, geom) {
        var p = {
            geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
            geometryType: 'esriGeometryPoint', inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects',
            outFields: pole, returnGeometry: geom ? 'true' : 'false', f: 'json'
        };
        var url = RUIAN + vrstva + '/query?' + Object.keys(p).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
        return fetchTO(url, TIMEOUT_MS).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (j) { if (j && j.error) throw new Error(j.error.message || 'RÚIAN'); return (j && j.features) || []; });
    }
    // nejbližší adresní místo (bodová vrstva 1) do 40 m — dotaz s distance/units
    function adresa(lat, lng) {
        var p = {
            geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
            geometryType: 'esriGeometryPoint', inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects',
            distance: '40', units: 'esriSRUnit_Meter', outFields: 'adresa,psc', returnGeometry: 'true', f: 'json'
        };
        var url = RUIAN + '1/query?' + Object.keys(p).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
        return fetchTO(url, TIMEOUT_MS).then(function (r) { return r.json(); }).then(function (j) {
            var best = null;
            ((j && j.features) || []).forEach(function (f) {
                if (!f.geometry) return;
                var d = 0; try { d = (window.GeoCore && GeoCore.getDistance) ? GeoCore.getDistance(lat, lng, f.geometry.y, f.geometry.x) : 0; } catch (e) { d = 0; }
                if (!best || d < best.d) best = { d: d, adresa: (f.attributes || {}).adresa, psc: (f.attributes || {}).psc };
            });
            return best;
        }).catch(function () { return null; });
    }
    // ochrana a omezení: jedno identify přes všechny polygonové vrstvy z OCHRANA
    function okoli(lat, lng) {
        var ids = Object.keys(OCHRANA).join(',');
        var d = 0.0015;
        var url = RUIAN + 'identify?geometry=' + lng + ',' + lat + '&geometryType=esriGeometryPoint&sr=4326&layers=all:' + ids
            + '&tolerance=1&mapExtent=' + (lng - d) + ',' + (lat - d) + ',' + (lng + d) + ',' + (lat + d) + '&imageDisplay=1000,1000,96&returnGeometry=false&f=json';
        return fetchTO(url, TIMEOUT_MS).then(function (r) { return r.json(); }).then(function (j) {
            var out = [];
            ((j && j.results) || []).forEach(function (r) {
                var a = r.attributes || {}, v = function (k) { var x = a[k]; return (x == null || x === 'Null' || x === '') ? null : String(x); };
                out.push({ vrstva: r.layerId, typ: OCHRANA[r.layerId] || r.layerName, nazev: v('Název účelového prvku') || v('NAZEV') || v('nazev'), odkaz: v('Odkaz do agendového systému zdroje dat'), predpis: v('VyhlasovaciDokumentace'), cislo: v('Číslo účelového prvku') });
            });
            return out;
        }).catch(function () { return null; });
    }
    // výměra z grafiky: shoelace v S-JTSK (vnější kruh − díry); porovnání s úřední výměrou
    function vymeraZGrafiky(rings) {
        try {
            if (!window.GeoCore || !GeoCore.toSJTSK || !rings || !rings.length) return null;
            var total = 0;
            rings.forEach(function (ring, ri) {
                var pts = ring.map(function (c) { var s = GeoCore.toSJTSK(c[0], c[1]); return [s.y, s.x]; });
                var A = 0, n = pts.length;
                for (var i = 0; i < n; i++) { var j = (i + 1) % n; A += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
                A = Math.abs(A) / 2;
                total += ri === 0 ? A : -A;
            });
            return total > 0 ? total : null;
        } catch (e) { swallow(e, 'vymeraZGrafiky'); return null; }
    }
    function zjisti(lat, lng) {
        return Promise.all([
            dotaz(5, lat, lng, 'id,cisloparcely,kmenovecislo,poddelenicisla,druhcislovanikod,vymeraparcely,druhpozemkukod,zpusobyvyuzitipozemku,katastralniuzemi,zdroj,platiod', true),
            dotaz(7, lat, lng, 'kod,nazev,existujedigitalnimapa', false).catch(function () { return []; }),
            dotaz(12, lat, lng, 'kod,nazev', false).catch(function () { return []; }),
            dotaz(3, lat, lng, 'kod,cisladomovni,typstavebnihoobjektukod,zpusobvyuzitikod,pocetpodlazi,zastavenaplocha,pocetbytu,dokonceni,druhkonstrukcekod,podlahovaplocha,obestavenyprostor', false).catch(function () { return []; }),
            adresa(lat, lng),
            okoli(lat, lng),
            (typeof window.terrainElevAsync === 'function' ? Promise.resolve().then(function () { return window.terrainElevAsync(lat, lng); }).catch(function () { return null; }) : Promise.resolve(null))
        ]).then(function (r) {
            var f = r[0][0]; if (!f) return null;
            var a = f.attributes || {};
            var ku = (r[1][0] || {}).attributes || {}, obec = (r[2][0] || {}).attributes || {}, so = (r[3][0] || {}).attributes || null;
            var rings = (f.geometry && f.geometry.rings) ? f.geometry.rings.map(function (ring) { return ring.map(function (c) { return [c[1], c[0]]; }); }) : [];
            return {
                id: a.id, cislo: a.cisloparcely || ((a.kmenovecislo || '?') + (a.poddelenicisla ? '/' + a.poddelenicisla : '')),
                stavebni: a.druhcislovanikod === 1, vymera: a.vymeraparcely, druh: a.druhpozemkukod, vyuziti: a.zpusobyvyuzitipozemku,
                kuKod: a.katastralniuzemi || ku.kod || null, kuNazev: ku.nazev || '', dkm: ku.existujedigitalnimapa === '1',
                zdroj: a.zdroj, platiod: a.platiod, vymeraGraf: vymeraZGrafiky(rings),
                obec: obec.nazev || '', stavba: so, rings: rings, lat: lat, lng: lng,
                adresa: r[4], okoli: r[5], teren: (r[6] != null && isFinite(r[6])) ? +r[6] : null
            };
        });
    }

    // ---- Nahlížení do KN: odkaz na parcelu pod souřadnicemi ----------------------------
    // Parametry jsou S-JTSK se ZÁPORNÝM znaménkem (Křovák nativně): x = −Y (východ),
    // y = −X (sever). Appka drží S-JTSK kladné (GeoCore.toSJTSK), proto se znaménko obrací.
    function nahlizeniUrl(lat, lng) {
        try {
            if (!window.GeoCore || !GeoCore.toSJTSK) return null;
            var s = GeoCore.toSJTSK(lat, lng);
            if (!s || !isFinite(s.y) || !isFinite(s.x)) return null;
            return NAHLIZENI + '&x=' + (-Math.abs(s.y)).toFixed(2) + '&y=' + (-Math.abs(s.x)).toFixed(2);
        } catch (e) { swallow(e, 'nahlizeniUrl'); return null; }
    }

    // ---- mapa: zvýraznění ---------------------------------------------------------------
    function zvyrazni(p) {
        var m = getMap(); if (!m || typeof L === 'undefined') return;
        smazZvyrazneni();
        try {
            if (p && p.rings && p.rings.length) {
                _poly = L.polygon(p.rings, { color: BARVA, weight: 3, opacity: 0.95, fillColor: BARVA, fillOpacity: 0.16, interactive: false, className: 'ag-pcl-poly' }).addTo(m);
            }
            _mark = L.circleMarker([p.lat, p.lng], { radius: 5, color: BARVA, weight: 2, fillColor: '#fff', fillOpacity: 0.9, interactive: false }).addTo(m);
        } catch (e) { swallow(e, 'zvyrazni'); }
    }
    function smazZvyrazneni() {
        var m = getMap();
        try { if (_poly) { if (m) m.removeLayer(_poly); _poly = null; } } catch (e) { _poly = null; }
        try { if (_mark) { if (m) m.removeLayer(_mark); _mark = null; } } catch (e) { _mark = null; }
    }

    // ---- karta ----------------------------------------------------------------------------
    function styl() {
        if (!window.AG || !AG.style) return;
        AG.style(STYLE_ID, [
            '#' + OV_ID + '{z-index:19999;}',
            '#' + OV_ID + ' .agpk-content{display:flex;flex-direction:column;}',
            '.agpk-title{margin:0 0 2px;color:var(--accent);font-family:var(--font-display,sans-serif);}',
            '.agpk-sub{color:var(--text-muted,#9aa1ac);font-size:calc(12.5px * var(--ag-font-scale,1));line-height:1.4;margin-bottom:8px;}',
            '#' + OV_ID + ' .agpk-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;}',
            '.agpk-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:7px 2px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.08));font-size:calc(13px * var(--ag-font-scale,1));}',
            '.agpk-row span:first-child{color:var(--text-muted,#9aa1ac);flex:0 0 auto;}',
            '.agpk-row b{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;}',
            '.agpk-lbl{margin:12px 0 4px;font-size:calc(11.5px * var(--ag-font-scale,1));font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:var(--text-faint,#6b727d);}',
            '.agpk-note{color:var(--text-muted,#9aa1ac);font-size:calc(12px * var(--ag-font-scale,1));line-height:1.5;padding:6px 2px 2px;}',
            '.agpk-note b{color:var(--text-color,#eceef2);}',
            '.agpk-wait{padding:18px 4px;color:var(--text-muted,#9aa1ac);font-size:calc(13px * var(--ag-font-scale,1));}',
            '.agpk-acts{display:flex;flex-direction:column;gap:6px;margin-top:10px;}',
            '#' + OV_ID + ' .agpk-acts .btn{margin:0;}'
        ].join('\n'));
    }
    function build() {
        if (_ov && document.body.contains(_ov)) return _ov;
        styl();
        _ov = document.createElement('div');
        _ov.className = 'modal-overlay agpk-overlay'; _ov.id = OV_ID;
        _ov.innerHTML =
            '<div class="modal-content agpk-content" role="dialog" aria-modal="true" aria-labelledby="agpk-title">' +
            '  <h3 class="agpk-title" id="agpk-title">Parcela</h3>' +
            '  <div class="agpk-sub" id="agpk-sub"></div>' +
            '  <div class="modal-body agpk-body" id="agpk-body"></div>' +
            '  <div class="agpk-acts" id="agpk-acts"></div>' +
            '  <button type="button" class="btn btn-secondary" id="agpk-close">Zavřít</button>' +
            '</div>';
        document.body.appendChild(_ov);
        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov) close(); });
        _ov.querySelector('#agpk-close').addEventListener('click', close);
        _ov.querySelector('#agpk-acts').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-act]') : null; if (!b) return;
            var act = b.getAttribute('data-act'), p = _posledni;
            if (act === 'vlastnik') {
                var u = nahlizeniUrl(p ? p.lat : NaN, p ? p.lng : NaN);
                if (!u) { toast('Nahlížení do KN se nepodařilo otevřít (převod souřadnic).'); return; }
                try { window.open(u, '_blank'); } catch (e2) { swallow(e2, 'open'); }
            } else if (act === 'kopie' && p) {
                var t = 'parc. č. ' + (p.stavebni ? 'st. ' : '') + p.cislo + (p.kuNazev ? ', k.ú. ' + p.kuNazev : '') + (p.kuKod ? ' (' + p.kuKod + ')' : '')
                    + (p.vymera ? ', ' + num(p.vymera) + ' m²' : '');
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('Zkopírováno: ' + t); }, function () { toast(t); });
                    else toast(t);
                } catch (e3) { toast(t); }
            } else if (act === 'znovu' && p) {
                tap(p.lat, p.lng);
            }
        });
        return _ov;
    }
    function open() { build(); _ov.style.display = 'flex'; }
    function close() {
        if (_ov) _ov.style.display = 'none';
        smazZvyrazneni();
        _seq++;   // odpověď, která ještě letí, se už nevykreslí
    }
    function radek(k, v) { return v ? '<div class="agpk-row"><span>' + esc(k) + '</span><b>' + v + '</b></div>' : ''; }
    function vykresli(p, chyba) {
        var t = _ov.querySelector('#agpk-title'), sub = _ov.querySelector('#agpk-sub'), body = _ov.querySelector('#agpk-body'), acts = _ov.querySelector('#agpk-acts');
        acts.innerHTML = '';
        if (chyba) {
            t.textContent = 'Parcela';
            sub.textContent = '';
            body.innerHTML = '<div class="agpk-note">' + esc(chyba) + '</div>';
            acts.innerHTML = '<button type="button" class="btn btn-secondary" data-act="znovu">Zkusit znovu</button>';
            return;
        }
        if (!p) {
            t.textContent = 'Parcela';
            sub.textContent = '';
            body.innerHTML = '<div class="agpk-note">Tady RÚIAN žádnou parcelu nevede — klepni dovnitř parcely (na hranici to nemusí sednout).</div>';
            return;
        }
        t.textContent = 'Parcela ' + (p.stavebni ? 'st. ' : '') + p.cislo;
        var s = [];
        if (p.kuNazev) s.push('k.ú. ' + p.kuNazev + (p.kuKod ? ' (' + p.kuKod + ')' : ''));
        else if (p.kuKod) s.push('k.ú. ' + p.kuKod);
        if (p.obec) s.push('obec ' + p.obec);
        sub.textContent = s.join(' · ');
        var h = '';
        var vym = (p.vymera != null && isFinite(p.vymera)) ? (num(p.vymera) + ' m²' + (p.vymera >= 5000 ? ' <small>(' + (p.vymera / 10000).toFixed(2).replace('.', ',') + ' ha)</small>' : '')) : '';
        h += radek('Výměra', vym);
        h += radek('Druh pozemku', p.druh ? esc(DRUH[p.druh] || ('kód ' + p.druh)) : '');
        h += radek('Způsob využití', p.vyuziti ? esc(VYUZITI[p.vyuziti] || ('kód ' + p.vyuziti)) : '');
        if (p.vymeraGraf != null && p.vymera) {
            var roz = p.vymeraGraf - p.vymera, pct = Math.abs(roz) / p.vymera * 100;
            h += radek('Výměra z grafiky', num(p.vymeraGraf) + ' m² <small>(' + (roz >= 0 ? '+' : '−') + num(Math.abs(roz)) + ' m², ' + pct.toFixed(1).replace('.', ',') + ' %)</small>');
        }
        h += radek('Číslování', p.stavebni ? 'stavební parcela' : 'pozemková parcela');
        // zdroj geometrie TÉTO parcely rozhoduje, jak věřit hranici (DKM ±0,14 m; UKM = přepočtená analogová mapa, metry)
        h += radek('Hranice', p.zdroj === 1 ? 'DKM — digitální, na cm až dm' : (p.zdroj === 2 ? 'UKM — z analogové mapy, na metry' : (p.dkm ? 'digitální (DKM/KMD)' : 'v k.ú. ještě není digitální mapa')));
        if (p.platiod) { try { var dt = new Date(+p.platiod); if (!isNaN(dt)) h += radek('Platí od', dt.toLocaleDateString('cs-CZ')); } catch (e) { /* nic */ } }
        if (p.adresa && p.adresa.adresa) h += radek('Adresa' + (p.adresa.d > 5 ? ' (' + Math.round(p.adresa.d) + ' m)' : ''), esc(p.adresa.adresa));
        if (p.teren != null) h += radek('Terén (DMR 5G)', p.teren.toFixed(1).replace('.', ',') + ' m Bpv');
        if (p.stavba) {
            var so = p.stavba, typ = so.typstavebnihoobjektukod;
            var cislo = so.cisladomovni ? ((typ === 2 ? 'č.e. ' : 'č.p. ') + String(so.cisladomovni).replace(/,/g, ', ')) : 'bez čísla popisného';
            h += '<div class="agpk-lbl">Budova na parcele (RÚIAN)</div>';
            h += radek('Číslo', esc(cislo));
            h += radek('Využití', so.zpusobvyuzitikod ? esc(STAVBA[so.zpusobvyuzitikod] || ('kód ' + so.zpusobvyuzitikod)) : '');
            h += radek('Podlaží', so.pocetpodlazi ? String(so.pocetpodlazi) : '');
            h += radek('Zastavěná plocha', so.zastavenaplocha ? num(so.zastavenaplocha) + ' m²' : '');
            h += radek('Podlahová plocha', so.podlahovaplocha ? num(so.podlahovaplocha) + ' m²' : '');
            h += radek('Obestavěný prostor', so.obestavenyprostor ? num(so.obestavenyprostor) + ' m³' : '');
            h += radek('Konstrukce', so.druhkonstrukcekod ? esc(KONSTRUKCE[so.druhkonstrukcekod] || ('kód ' + so.druhkonstrukcekod)) : '');
            if (so.dokonceni) { try { var dd = new Date(+so.dokonceni); if (!isNaN(dd)) h += radek('Dokončení', String(dd.getFullYear())); } catch (e) { /* nic */ } }
            h += radek('Byty', so.pocetbytu ? String(so.pocetbytu) : '');
        }
        // OCHRANA A OMEZENÍ (RÚIAN účelové prvky) — geodet tu vidí, kam smí sáhnout
        if (p.okoli === null) {
            h += '<div class="agpk-lbl">Ochrana a omezení</div><div class="agpk-note">Vrstvy ochrany (BPEJ, chráněná území, ložiska, ochranné pásmo bodu) teď neodpověděly.</div>';
        } else if (p.okoli) {
            h += '<div class="agpk-lbl">Ochrana a omezení</div>';
            if (!p.okoli.length) h += '<div class="agpk-note">RÚIAN tu nevede žádné chráněné území, ložisko, BPEJ ani ochranné pásmo bodu.</div>';
            p.okoli.forEach(function (o) {
                if (o.vrstva === 28) {
                    var bt = bpejText(o.nazev);
                    h += radek('BPEJ', esc(o.nazev || '?') + (bt ? '<br><small>' + esc(bt) + '</small>' : ''));
                } else if (o.vrstva === 25) {
                    h += radek(o.typ, '<b style="color:var(--warning,#fbbf24)">zde platí</b><br><small>zákon 200/1994 Sb. § 8: značku bodu nepoškodit, v pásmu nestavět bez souhlasu</small>');
                } else {
                    h += radek(o.typ, esc(o.nazev || 'ano') + (o.odkaz ? ' <a href="' + esc(o.odkaz) + '" target="_blank" rel="noopener" style="color:var(--accent)">↗</a>' : ''));
                }
            });
        }
        h += '<div class="agpk-lbl">Vlastník a list vlastnictví</div>';
        h += '<div class="agpk-note">Vlastníka, LV, věcná břemena a řízení dává jen <b>Nahlížení do KN</b> (ČÚZK) — tlačítko dole otevře rovnou tuhle parcelu; ČÚZK před vlastníky chce opsat kód z obrázku. Údaje výše jsou z RÚIAN © ČÚZK, poloha klepnutí ' + p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + '.</div>';
        body.innerHTML = h;
        var uNahl = nahlizeniUrl(p.lat, p.lng);
        acts.innerHTML = (uNahl ? '<button type="button" class="btn btn-blue" data-act="vlastnik">Vlastník a LV — Nahlížení do KN ↗</button>' : '')
            + '<button type="button" class="btn btn-secondary" data-act="kopie">Zkopírovat číslo parcely</button>';
    }

    // ---- vstup ---------------------------------------------------------------------------
    function tap(lat, lng) {
        if (!isFinite(lat) || !isFinite(lng)) return false;
        if (navigator.onLine === false) { toast('Údaje o parcele potřebují signál — teď jsi offline.'); return false; }
        var seq = ++_seq;
        _posledni = { lat: lat, lng: lng, cislo: '', kuNazev: '', kuKod: null, vymera: null };
        open();
        _ov.querySelector('#agpk-title').textContent = 'Parcela';
        _ov.querySelector('#agpk-sub').textContent = '';
        _ov.querySelector('#agpk-acts').innerHTML = '';
        _ov.querySelector('#agpk-body').innerHTML = '<div class="agpk-wait">Hledám parcelu v RÚIAN (ČÚZK)…</div>';
        smazZvyrazneni();
        zjisti(lat, lng).then(function (p) {
            if (seq !== _seq) return;
            if (p) { _posledni = p; zvyrazni(p); }
            vykresli(p, null);
        }).catch(function (e) {
            if (seq !== _seq) return;
            swallow(e, 'tap');
            vykresli(null, 'ČÚZK teď neodpověděl (' + (e && e.message ? e.message : 'síť') + '). Zkus to za chvíli.');
        });
        return true;
    }

    window.AGParcelaKlik = { tap: tap, close: close, on: katastrOn, zjisti: zjisti, nahlizeniUrl: nahlizeniUrl, _cis: { DRUH: DRUH, VYUZITI: VYUZITI, STAVBA: STAVBA } };
})();
