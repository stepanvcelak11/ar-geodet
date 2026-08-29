// ===== AR Geodet — KONTROLNÍ MĚŘENÍ: TÝŽ BOD PODRUHÉ S ODSTUPEM (ODPOJITELNÁ) ===
// Neinvazivní vrstva ve stylu js/kvalita-bodu.js: NEEDITUJE logika.js ani
// grafika.js, jen čte globály přes typeof-guardy a registruje vlastní dlaždici.
//
// PROBLÉM: appka o každém bodu hlásí σ a ±, jenže obojí je VNITŘNÍ shoda jednoho
// stání — spočítané z odečtů, které přišly během pár minut ze stejné konstelace
// družic a se stejnými odrazy od stejné fasády. Když telefon celou tu dobu lže
// stejně, odečty se krásně shodnou a ± vyjde malé. Číslo pak vypadá skvěle a
// s realitou nemá nic společného; brutal-gps.js proto ± zdola omezuje reálnou
// mezí, ale ani to není měření — je to odhad.
//
// JEDINÝ způsob, jak z holého mobilu dostat POCTIVÉ číslo, je změřit týž bod
// PODRUHÉ a nezávisle: s odstupem, kdy se konstelace družic znatelně otočí.
// Rozdíl obou určení už systematiku obsahuje, protože se do každého promítla
// jinak. Z jediného rozdílu Δ se pak odhadne:
//     σ jednoho určení ≈ Δ / √2        (dva nezávislé údaje, rozdíl má √2× větší rozptyl)
//     σ průměru obou   ≈ Δ / 2
// Je to hrubý odhad o jednom stupni volnosti — ale je MĚŘENÝ, ne slíbený.
//
// CO DĚLÁ:
//   1) Bod se označí „k ověření" a modul hlídá, kdy uplyne čekací doba (výchozí
//      25 min — pod ní se konstelace neotočí dost a kontrola nic nedokazuje).
//   2) Až doba uplyne, připomene se (jednou, ne opakovaně).
//   3) „Změřit znovu" vezme aktuální průměrovanou GPS, spočítá Δ (dE, dN, dH)
//      a nabídne: nechat původní / vzít průměr obou / přepsat novým.
//   4) Výsledek zapíše do bodu (prov.recheck) — odtud si ho bere protokol
//      kvality v js/kvalita-bodu.js.
//
// Odstranění: smaž js/dvoji-mereni.js + css/dvoji-mereni.css, oba řádky se
// značkou "KONTROLNÍ MĚŘENÍ" v index.html (a cesty v sw.js) a záznam
// 'dvoji-mereni' v js/tools-registry.js.
// ================================================================================
(function () {
    'use strict';
    if (window.AGRecheck) return;

    var Q_KEY = 'agRecheckQueue1';       // fronta „čeká na ověření" (per zakázka přes setStoredData)
    var WAIT_MIN_DEFAULT = 25;           // za jak dlouho má kontrola smysl
    var TICK_MS = 30000;                 // jak často se kouká, jestli něco dozrálo
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M21 3v6h-6"/><circle cx="12" cy="12" r="2.4"/></svg>';

    // Meze pro slovní hodnocení rozdílu. Držené záměrně střízlivě: holým mobilem
    // je decimetr výborný výsledek a metr běžný, ne ostuda.
    var GOOD = 0.50, OK = 1.50, MEH = 3.00;

    // --------------------------------------------------------------------------------
    // Společné pomůcky (stejný vzor jako kvalita-bodu.js)
    // --------------------------------------------------------------------------------
    function esc(s) {
        return (window.AG && AG.esc) ? AG.esc(s)
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }
    function toast(m) {
        try { if (window.AG && AG.toast) return AG.toast(m); } catch (e) { swallow(e, 'dvoji-mereni:toast'); }
        try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { swallow(e, 'dvoji-mereni:toast'); }
    }
    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde); } catch (err) { /* poslední instance */ } }
    function alertBox(title, msg) {
        if (typeof window.agAlert === 'function') return window.agAlert({ title: title, message: msg });
        try { if (typeof agInfo === 'function') agInfo((title ? title + '\n\n' : '') + String(msg).replace(/<[^>]+>/g, '')); } catch (e) { swallow(e, 'dvoji-mereni:alertBox'); }
        return Promise.resolve(true);
    }
    function body() {
        try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; }
        catch (e) { return []; }
    }
    function ptById(id) {
        var arr = body();
        for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === String(id)) return arr[i];
        return null;
    }
    function num(v, d) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d == null ? 2 : d).replace('.', ','); }
    function persist() {
        try { if (typeof setStoredData === 'function') setStoredData('arCustomPoints12', JSON.stringify(body())); }
        catch (e) { swallow(e, 'dvoji-mereni:persist'); }
    }

    // Metry na stupeň — jeden zdroj pravdy je GeoCore (skutečné poloměry křivosti).
    function mPerDeg(lat) {
        try { if (window.GeoCore && GeoCore.metersPerDeg) { var m = GeoCore.metersPerDeg(lat); if (m && m.lat) return m; } }
        catch (e) { swallow(e, 'dvoji-mereni:mPerDeg'); }
        return { lat: 111320, lng: 111320 * Math.cos((lat || 49.8) * Math.PI / 180) };
    }

    // --------------------------------------------------------------------------------
    // Fronta „čeká na ověření"  { id: {t0, wait} }
    // --------------------------------------------------------------------------------
    function loadQ() {
        try {
            var raw = (typeof getStoredData === 'function') ? getStoredData(Q_KEY) : null;
            if (!raw) return {};
            var o = JSON.parse(raw);
            return (o && typeof o === 'object') ? o : {};
        } catch (e) { swallow(e, 'dvoji-mereni:loadQ'); return {}; }
    }
    function saveQ(q) {
        try { if (typeof setStoredData === 'function') setStoredData(Q_KEY, JSON.stringify(q)); }
        catch (e) { swallow(e, 'dvoji-mereni:saveQ'); }
    }
    //! ⚠ Cekaci doba se testuje na null, ne pres `||`: `wait: 0` je legitimni
    //  („overit hned", treba z testu nebo z jineho modulu) a nula je falsy, takze
    //  by ji `||` tise prepsala na 25 minut a bod by hlasil „zbyva 25 min".
    function mark(id, waitMin) {
        var q = loadQ();
        q[id] = { t0: Date.now(), wait: (waitMin == null ? WAIT_MIN_DEFAULT : +waitMin) };
        saveQ(q);
    }
    function unmark(id) { var q = loadQ(); delete q[id]; saveQ(q); }
    function dueAt(rec) { return (rec.t0 || 0) + (rec.wait == null ? WAIT_MIN_DEFAULT : rec.wait) * 60000; }

    // Fronta se čistí o body, které mezitím někdo smazal — jinak by v seznamu
    // navždy visel řádek bez bodu a „Změřit znovu" by nemělo co porovnat.
    function pending() {
        var q = loadQ(), out = [], dirty = false;
        for (var id in q) {
            if (!Object.prototype.hasOwnProperty.call(q, id)) continue;
            var p = ptById(id);
            if (!p) { delete q[id]; dirty = true; continue; }
            out.push({ p: p, rec: q[id], due: dueAt(q[id]) });
        }
        if (dirty) saveQ(q);
        out.sort(function (a, b) { return a.due - b.due; });
        return out;
    }
    function verified() {
        return body().filter(function (p) { return p && p.prov && p.prov.recheck; })
            .sort(function (a, b) { return (b.prov.recheck.t2 || 0) - (a.prov.recheck.t2 || 0); });
    }

    // --------------------------------------------------------------------------------
    // Vlastní výpočet kontroly
    // --------------------------------------------------------------------------------
    function avgGps() {
        try {
            var r = (typeof gpsAvgResult !== 'undefined') ? gpsAvgResult : null;
            if (!r || r.coarse || !isFinite(r.lat) || !isFinite(r.lng)) return null;
            return r;
        } catch (e) { return null; }
    }

    // Δ mezi uloženým bodem a novým určením, rozložené do východu/severu.
    function delta(p, r) {
        var m = mPerDeg((p.lat + r.lat) / 2);
        var dE = (r.lng - p.lng) * m.lng;
        var dN = (r.lat - p.lat) * m.lat;
        var d = Math.hypot(dE, dN);
        var dH = null;
        var h1 = (p.vyska != null && isFinite(p.vyska)) ? p.vyska : null;
        var h2 = (r.alt != null && isFinite(r.alt)) ? r.alt : null;
        if (h1 != null && h2 != null) dH = h2 - h1;
        return { dE: dE, dN: dN, d: d, dH: dH };
    }

    // Slovní verdikt + odhad poctivé přesnosti z jediného rozdílu.
    function verdict(d) {
        if (d <= GOOD) return { c: 'ok', t: 'Výborná shoda', h: 'Obě určení sedí na sebe. Na telefon je to velmi dobrý výsledek.' };
        if (d <= OK) return { c: 'ok', t: 'V pořádku', h: 'Běžný rozdíl pro měření telefonem. Průměr obou určení je lepší než kterékoli samo.' };
        if (d <= MEH) return { c: 'warn', t: 'Znatelný rozdíl', h: 'Jedno z měření bylo nejspíš rušené (odraz od fasády, stromy, málo družic). Průměr ber s rezervou.' };
        return { c: 'bad', t: 'Velký rozdíl', h: 'Tohle není šum, ale chyba v jednom z měření. <b>Neber průměr</b> — změř bod potřetí a spolehni se na tu dvojici, která si sedne.' };
    }
    // σ jednoho určení ≈ Δ/√2, σ průměru ≈ Δ/2. Odhad z jediného rozdílu (1 stupeň
    // volnosti), takže je sám dost nejistý — v UI se to říká nahlas.
    function sigmaFromDelta(d) { return { one: d / Math.SQRT2, mean: d / 2 }; }

    // --------------------------------------------------------------------------------
    // Zápis výsledku do bodu
    //   mode: 'keep'  nechat původní souřadnice
    //         'mean'  průměr obou určení
    //         'new'   přepsat novým určením
    // --------------------------------------------------------------------------------
    function applyResult(p, r, dl, mode) {
        var rc = {
            t1: (p.prov && p.prov.ts) || null,
            lat1: p.lat, lng1: p.lng,
            acc1: (p.prov && p.prov.acc != null) ? p.prov.acc : (p.acc != null ? p.acc : null),
            t2: Date.now(),
            lat2: r.lat, lng2: r.lng,
            acc2: (isFinite(r.sterr) ? Math.round(r.sterr * 1000) / 1000 : null),
            n2: r.n || 0,
            dE: Math.round(dl.dE * 1000) / 1000,
            dN: Math.round(dl.dN * 1000) / 1000,
            d: Math.round(dl.d * 1000) / 1000,
            dH: (dl.dH != null) ? Math.round(dl.dH * 1000) / 1000 : null,
            mode: mode
        };
        if (mode === 'mean') {
            p.lat = (p.lat + r.lat) / 2;
            p.lng = (p.lng + r.lng) / 2;
            if (dl.dH != null && p.vyska != null && r.alt != null) p.vyska = (p.vyska + r.alt) / 2;
        } else if (mode === 'new') {
            p.lat = r.lat; p.lng = r.lng;
            if (r.alt != null && isFinite(r.alt)) p.vyska = r.alt;
        }
        p.prov = p.prov || {};
        p.prov.recheck = rc;
        // Poctivá přesnost z rozdílu. U 'keep'/'new' je to přesnost JEDNOHO určení,
        // u 'mean' přesnost průměru — proto se ukládá to, co k výsledku sedí.
        var sg = sigmaFromDelta(dl.d);
        p.prov.trueAcc = Math.round((mode === 'mean' ? sg.mean : sg.one) * 1000) / 1000;

        // Zrcadlo v arPoints (twin se stejným id) — bez toho by se v mapě a v AR
        // dál kreslila stará poloha, dokud by se appka nenačetla znovu.
        try {
            if ((mode === 'mean' || mode === 'new') && typeof arPoints !== 'undefined' && Array.isArray(arPoints)) {
                var tw = arPoints.find(function (q) { return q.id === p.id; });
                if (tw) {
                    tw.lat = p.lat; tw.lng = p.lng; if (p.vyska != null) tw.vyska = p.vyska;
                    if (tw.element) { tw.element.remove(); tw.element = null; }
                }
            }
        } catch (e) { swallow(e, 'dvoji-mereni:applyResult'); }

        persist();
        unmark(p.id);
        try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { swallow(e, 'dvoji-mereni:applyResult'); }
        try { if (typeof initARMarkers === 'function') initARMarkers(); } catch (e) { swallow(e, 'dvoji-mereni:applyResult'); }
        try { if (window.AGJournal && AGJournal.commit) AGJournal.commit({ op: 'edit', id: p.id, after: p, origin: 'recheck' }); } catch (e) { swallow(e, 'dvoji-mereni:applyResult'); }
    }

    // --------------------------------------------------------------------------------
    // Styly + okno
    // --------------------------------------------------------------------------------
    var _ov = null, _timer = null, _notified = {};

    // Časovače jen pro UI jdou přes AG.uiInterval (js/idle-timers.js) — samy se
    // uspí, když appka jde na pozadí, a probudí po návratu. Bez té vrstvy fallback
    // na nativní setInterval, aby modul zůstal odpojitelný.
    function every(fn, ms) {
        try { if (window.AG && AG.uiInterval) return AG.uiInterval(fn, ms); } catch (e) { /* fallback níž */ }
        return setInterval(fn, ms);
    }
    function stop(h) {
        if (!h) return;
        try { if (window.AG && AG.clearUiInterval) return AG.clearUiInterval(h); } catch (e) { /* fallback níž */ }
        try { clearInterval(h); } catch (e) { /* nic */ }
    }


    function build() {
        if (_ov && document.body.contains(_ov)) return _ov;
        _ov = document.createElement('div');
        _ov.className = 'modal-overlay agdm-overlay';
        _ov.id = 'agdm-modal';
        _ov.innerHTML =
            '<div class="modal-content agdm-content" role="dialog" aria-modal="true" aria-labelledby="agdm-title">' +
            '  <h3 class="agdm-title" id="agdm-title">Kontrolní měření</h3>' +
            '  <div class="agdm-note">Týž bod změřený <b>podruhé s odstupem</b> je jediné poctivé číslo přesnosti, které z telefonu dostaneš — σ z jednoho stání jen popisuje, jak klidné bylo měření, ne jak blízko pravdě leží.</div>' +
            '  <div class="modal-body agdm-body"><div id="agdm-list"></div></div>' +
            '  <div class="agdm-foot">' +
            '    <button type="button" class="btn btn-primary" id="agdm-add">Přidat bod k ověření</button>' +
            '    <button type="button" class="btn btn-secondary" id="agdm-close">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(_ov);
        _ov.addEventListener('mousedown', function (e) { if (e.target === _ov) close(); });
        _ov.querySelector('#agdm-close').addEventListener('click', close);
        _ov.querySelector('#agdm-add').addEventListener('click', addDialog);
        _ov.querySelector('#agdm-list').addEventListener('click', onListClick);
        return _ov;
    }

    function onListClick(e) {
        var b = e.target.closest ? e.target.closest('button[data-act]') : null;
        if (!b) return;
        var id = b.getAttribute('data-id');
        var act = b.getAttribute('data-act');
        if (act === 'drop') { unmark(id); render(); return; }
        if (act === 'measure') { measure(id); return; }
    }

    function fmtLeft(ms) {
        if (ms <= 0) return 'připraveno k ověření';
        var min = Math.ceil(ms / 60000);
        return 'ověřit za ' + min + ' min';
    }

    function render() {
        var host = _ov && _ov.querySelector('#agdm-list');
        if (!host) return;
        var q = pending(), v = verified(), now = Date.now(), h = '';

        h += '<div class="agdm-sec">Čeká na ověření</div>';
        if (!q.length) {
            h += '<div class="agdm-empty">Zatím nic. Klepni na <b>Přidat bod k ověření</b> u bodu, na kterém ti záleží — a za ' + WAIT_MIN_DEFAULT + ' minut se ozvu.</div>';
        } else {
            q.forEach(function (r) {
                var left = r.due - now;
                var ready = left <= 0;
                h += '<div class="agdm-row' + (ready ? ' ready' : '') + '">'
                    + '<div class="agdm-main"><div class="agdm-name">' + esc(r.p.name || r.p.id) + '</div>'
                    + '<div class="agdm-sub">' + esc(fmtLeft(left)) + '</div></div>'
                    + '<div class="agdm-acts">'
                    + '<button type="button" class="btn btn-' + (ready ? 'primary' : 'secondary') + ' agdm-act" data-act="measure" data-id="' + esc(r.p.id) + '">Změřit znovu</button>'
                    + '<button type="button" class="btn btn-secondary agdm-act" data-act="drop" data-id="' + esc(r.p.id) + '">Zrušit</button>'
                    + '</div></div>';
            });
        }

        h += '<div class="agdm-sec">Ověřené body</div>';
        if (!v.length) {
            h += '<div class="agdm-empty">Zatím žádný bod neprošel kontrolou.</div>';
        } else {
            v.forEach(function (p) {
                var rc = p.prov.recheck;
                var vd = verdict(rc.d);
                h += '<div class="agdm-row done">'
                    + '<div class="agdm-main"><div class="agdm-name">' + esc(p.name || p.id) + '</div>'
                    + '<div class="agdm-sub">Δ ' + num(rc.d) + ' m'
                    + (rc.dH != null ? ' · výška ' + (rc.dH > 0 ? '+' : '') + num(rc.dH) + ' m' : '')
                    + ' · ' + esc(rc.mode === 'mean' ? 'uložen průměr' : (rc.mode === 'new' ? 'přepsáno novým' : 'ponechán původní'))
                    + '</div></div>'
                    + '<div class="agdm-num" data-q="' + vd.c + '">±' + num(p.prov.trueAcc) + '</div>'
                    + '</div>';
            });
        }
        host.innerHTML = h;
    }

    // --------------------------------------------------------------------------------
    // Přidání bodu do fronty
    // --------------------------------------------------------------------------------
    function addDialog() {
        var q = loadQ();
        var free = body().filter(function (p) { return !q[p.id]; })
            .sort(function (a, b) { return ((b.prov && b.prov.ts) || 0) - ((a.prov && a.prov.ts) || 0); })
            .slice(0, 60);
        if (!free.length) { alertBox('Není co přidat', 'V téhle zakázce nejsou žádné vlastní body, které by ještě nečekaly na ověření.'); return; }

        var wrap = document.createElement('div');
        wrap.className = 'modal-overlay agdm-pick';
        wrap.innerHTML = '<div class="modal-content agdm-pick-content" role="dialog" aria-modal="true">'
            + '<h3 class="agdm-title">Který bod ověřit?</h3>'
            + '<div class="modal-body"><div class="agdm-picklist">'
            + free.map(function (p) {
                return '<button type="button" class="agdm-pick-i" data-id="' + esc(p.id) + '">'
                    + '<span>' + esc(p.name || p.id) + '</span>'
                    + '<small>' + ((p.prov && p.prov.acc != null) ? '±' + num(p.prov.acc) + ' m' : '') + '</small></button>';
            }).join('')
            + '</div></div>'
            + '<button type="button" class="btn btn-secondary agdm-pick-x">Zpět</button></div>';
        document.body.appendChild(wrap);
        wrap.style.display = 'flex';
        var kill = function () { try { wrap.remove(); } catch (e) { swallow(e, 'dvoji-mereni:addDialog'); } };
        wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) kill(); });
        wrap.querySelector('.agdm-pick-x').addEventListener('click', kill);
        wrap.querySelector('.agdm-picklist').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.agdm-pick-i') : null;
            if (!b) return;
            mark(b.getAttribute('data-id'));
            kill(); render();
            toast('Bod čeká na ověření — ozvu se za ' + WAIT_MIN_DEFAULT + ' min.');
        });
    }

    // --------------------------------------------------------------------------------
    // Druhé měření
    // --------------------------------------------------------------------------------
    function measure(id) {
        var p = ptById(id);
        if (!p) { toast('Bod už v zakázce není.'); render(); return; }
        var r = avgGps();
        if (!r) {
            alertBox('Chybí průměrovaná GPS', 'Kontrola má smysl jen proti <b>průměrovanému</b> určení, ne proti jednomu fixu. Otevři <b>Přesná GPS</b> (nebo panel průměrování), nech nasbírat odečty a pak se sem vrať.');
            try { if (typeof openGpsAvgModal === 'function') { close(); openGpsAvgModal(); } } catch (e) { swallow(e, 'dvoji-mereni:measure'); }
            return;
        }
        var q = loadQ()[id];
        var left = q ? (dueAt(q) - Date.now()) : 0;
        var dl = delta(p, r);
        var vd = verdict(dl.d);
        var sg = sigmaFromDelta(dl.d);

        var msg = ''
            + (left > 0 ? '<p class="agdm-early">⚠ Od prvního měření uplynulo málo času (zbývá ' + Math.ceil(left / 60000) + ' min). Konstelace družic se zatím moc neotočila, takže shoda může být falešná — vypovídací hodnota je nižší.</p>' : '')
            + '<p><b>' + esc(vd.t) + '</b> — ' + vd.h + '</p>'
            + '<table class="agdm-tab">'
            + '<tr><td>Rozdíl v poloze</td><td><b>' + num(dl.d) + ' m</b></td></tr>'
            + '<tr><td>… k východu / severu</td><td>' + num(dl.dE) + ' / ' + num(dl.dN) + ' m</td></tr>'
            + (dl.dH != null ? '<tr><td>Rozdíl výšky</td><td>' + (dl.dH > 0 ? '+' : '') + num(dl.dH) + ' m</td></tr>' : '')
            + '<tr><td>Druhé určení</td><td>' + (r.n || '?') + ' odečtů' + (isFinite(r.sterr) ? ' · ±' + num(r.sterr) + ' m' : '') + '</td></tr>'
            + '</table>'
            + '<p class="agdm-sig">Z rozdílu vychází <b>±' + num(sg.one) + ' m</b> na jedno určení a <b>±' + num(sg.mean) + ' m</b> na průměr obou. '
            + 'Je to odhad z jediného rozdílu, takže sám je nejistý — ale na rozdíl od σ z jednoho stání je <b>naměřený</b>.</p>';

        var dlg = document.createElement('div');
        dlg.className = 'modal-overlay agdm-res';
        dlg.innerHTML = '<div class="modal-content agdm-res-content" role="dialog" aria-modal="true">'
            + '<h3 class="agdm-title" data-q="' + vd.c + '">Kontrola bodu ' + esc(p.name || p.id) + '</h3>'
            + '<div class="modal-body">' + msg + '</div>'
            + '<button type="button" class="btn btn-primary" data-m="mean">Uložit průměr obou</button>'
            + '<div class="agdm-res-row">'
            + '<button type="button" class="btn btn-secondary" data-m="keep">Nechat původní</button>'
            + '<button type="button" class="btn btn-secondary" data-m="new">Přepsat novým</button>'
            + '</div>'
            + '<button type="button" class="btn btn-secondary" data-m="">Zpět (neukládat)</button>'
            + '</div>';
        document.body.appendChild(dlg);
        dlg.style.display = 'flex';
        var kill = function () { try { dlg.remove(); } catch (e) { swallow(e, 'dvoji-mereni:measure'); } };
        dlg.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-m]') : null;
            if (!b) return;
            var mode = b.getAttribute('data-m');
            kill();
            if (!mode) return;
            applyResult(p, r, dl, mode);
            render();
            toast('Kontrola zapsána — Δ ' + num(dl.d) + ' m.');
        });
    }

    // --------------------------------------------------------------------------------
    // Připomínka, až bod dozraje. Jednou na bod, ne opakovaně — jinak by se z toho
    // stalo klikání, přesně jako u zrušené „cílené přesnosti" v qc-engine.js.
    // --------------------------------------------------------------------------------
    function tick() {
        try {
            var now = Date.now();
            pending().forEach(function (r) {
                if (r.due > now || _notified[r.p.id]) return;
                _notified[r.p.id] = 1;
                toast('Bod „' + (r.p.name || r.p.id) + '" je připraven na kontrolní měření.');
            });
        } catch (e) { swallow(e, 'dvoji-mereni:tick'); }
    }

    function open() { build(); render(); _ov.style.display = 'flex'; stop(_timer); _timer = every(render, TICK_MS); }
    function close() { stop(_timer); _timer = null; if (_ov) _ov.style.display = 'none'; }

    window.AGRecheck = {
        open: open, mark: mark, unmark: unmark,
        pending: pending, verified: verified,
        sigmaFromDelta: sigmaFromDelta,
        WAIT_MIN: WAIT_MIN_DEFAULT
    };
    window.openDvojiMereni = open;

    // --------------------------------------------------------------------------------
    // Vstup: dlaždice v Nástrojích (fallback do bočního menu jako u ostatních vrstev)
    // --------------------------------------------------------------------------------
    function injectTile() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'dvoji-mereni', label: 'Kontrolní měření', icon: ICON, cat: 'Měření', onClick: open, order: 24 });
            var stale = document.getElementById('agdm-launch'); if (stale) stale.remove();
            return;
        }
        var menu = document.getElementById('side-menu');
        if (!menu || document.getElementById('agdm-launch')) return;
        var host = menu.querySelector('.menu-scroll') || menu;
        var btn = document.createElement('button');
        btn.id = 'agdm-launch'; btn.className = 'menu-btn'; btn.type = 'button';
        btn.innerHTML = ICON + ' Kontrolní měření';
        btn.addEventListener('click', function () {
            try { if (typeof toggleMenu === 'function') toggleMenu(); } catch (e) { swallow(e, 'dvoji-mereni:injectTile'); }
            open();
        });
        var about = host.querySelector('button[onclick*="openAbout"]');
        if (about) host.insertBefore(btn, about); else host.appendChild(btn);
    }

    var _bg = null;
    function init() {
        try { injectTile(); } catch (e) { console.warn('[dvoji-mereni] tile', e); }
        if (!_bg) { _bg = every(tick, TICK_MS); tick(); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.addEventListener('load', function () { setTimeout(init, 350); });
})();
