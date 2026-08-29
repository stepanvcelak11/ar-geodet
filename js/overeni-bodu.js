// ===== AR Geodet — OVĚŘENÍ BODU DRUHÝM URČENÍM (ODPOJITELNÁ vrstva) ============
// Neinvazivní vrstva ve stylu js/kvalita-bodu.js: NEEDITUJE logika.js ani
// grafika.js, jen za běhu OBALÍ showDetails() a saveCustomPoint().
//
// PROČ: appka od zavedení protokolu kvality (js/kvalita-bodu.js) ví, z kolika
// odečtů bod vznikl a jaký byl kolem nich rozptyl. To ale říká jen to, jak KLIDNÉ
// bylo měření — ne jestli je bod SPRÁVNĚ. Chyba mobilní GNSS je během jednoho
// sezení systematicky posunutá (atmosféra + okamžitá geometrie družic), takže
// dvě stě klidných odečtů umí být dvě stě odečtů posunutých o půl metru stejným
// směrem. σ o tom mlčí.
//
// Jediná kontrola, kterou telefonem uděláš, je DRUHÉ NEZÁVISLÉ URČENÍ: přijít
// znovu, změřit znovu a porovnat. Karta bodu na to už tlačítko měla („Kontrolní
// bod" — uloží, kde právě stojíš, s odkazem na kontrolovaný bod), jenže ten
// odkaz byl POUZE V NÁZVU („K_B12") a v poznámce jako věta. Appka z toho nic
// nespočítala a nikde se nedalo zjistit, které body ověřené jsou a které ne.
//
// CO MODUL DĚLÁ:
//   1) Při uložení kontrolního bodu zapíše STROJOVĚ ČITELNÝ odkaz prov.checkOf
//      = id ověřovaného bodu (dosud jen text v názvu a poznámce).
//   2) Do karty bodu přidá PEČEŤ — jeden řádek, který rozhodne:
//        „✓ Ověřeno druhým určením · Δ 12 cm (mez 39 cm)"
//        „⚠ Jediné určení — neověřeno"
//   3) Přidá nástroj „Ověření bodů": soupis všech vlastních bodů zakázky
//      s odchylkou druhého určení, verdiktem a exportem do CSV.
//
// ODKUD SE BERE, ŽE JE BOD OVĚŘENÝ — TŘI ZDROJE, V TOMHLE POŘADÍ:
//   1) prov.recheck — výsledek nástroje „Kontrolní měření" (js/dvoji-mereni.js).
//      Tam se druhé určení dělá VEDENĚ (připomínka, rozklad dE/dN/dH, volba
//      nechat/průměr/přepsat) a je to nejlepší podklad, jaký appka má.
//      TENHLE MODUL SI NEDĚLÁ VLASTNÍ — jen z něj čte.
//   2) prov.checkOf — kontrolní bod uložený z karty bodu („Kontrolní bod").
//      Ten postup existoval dřív, ale odkaz byl jen v názvu („K_B12") a ve větě
//      v poznámce, takže z něj appka nic nespočítala. Nově se zapisuje i strojově.
//   3) párování podle názvu — záloha pro body změřené dřív, než tohle vzniklo:
//      bod „K_<jméno>" se páruje s bodem „<jméno>". V soupisu i v kartě je takový
//      pár označený „(dle názvu)", aby bylo poznat, že to appka odvodila.
//
// PROČ TO NENÍ DUPLICITA „Kontrolního měření": ten nástroj řídí JEDNU kontrolu
// (změř, porovnej, rozhodni). Tenhle modul odpovídá na otázku o CELÉ ZAKÁZCE —
// které body kontrolu mají, které ne a které ji neprošly — a dává verdikt proti
// MEZNÍ ODCHYLCE, ne jen číslo rozdílu.
//
// MEZNÍ ODCHYLKA: mezní polohová odchylka podle kódu kvality, převzatá TAK, JAK
// JI PUBLIKUJE katastrální vyhláška č. 357/2013 Sb. (příloha bod 13) — tytéž
// hodnoty, jaké appka ukazuje v Příručce (data/predpisy.json), aby si dvě místa
// v appce neodporovala. Kód se volí v soupisu, výchozí je 3 (nové zaměření
// v terénu, mez 0,39 m). Podrobnosti u konstanty MEZ níž.
//
// POCTIVĚ: dvě určení ze stejného sezení a stejné konstelace družic si můžou
// sednout na sebe, i když jsou obě vedle. Modul proto u páru ukazuje ODSTUP
// V ČASE a pod 20 minut ho označí jako slabou kontrolu.
//
// Odstranění: smaž js/overeni-bodu.js + řádek <script> v index.html, záznam
// 'overeni-bodu' v js/tools-registry.js a jeho text v data/navody.json
// (a přegeneruj sw.js).
// ================================================================================
(function () {
    'use strict';
    if (window.AGOvereni) return;

    var MODAL_ID = 'ag-ov-modal';
    var STYLE_ID = 'ag-ov-style';
    var LS_KOD = 'agOvereniKod_v1';         // zvolený kód kvality (mez odchylky)
    var SLABA_KONTROLA_MS = 20 * 60 * 1000; // dvě určení blíž než 20 min = slabá kontrola
    var CEKANI_MS = 15 * 60 * 1000;         // jak dlouho platí „teď zakládám kontrolní bod"

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.2 3 7.6 8 9 5-1.4 8-4.8 8-9V6z"/><path d="m8.6 12.2 2.3 2.3 4.5-4.6"/></svg>';

    // Mezní polohová odchylka podle kódu kvality. Hodnoty se NEPOČÍTAJÍ ze vzorce,
    // ale berou se TAK, JAK JE PUBLIKUJE tabulka v katastrální vyhlášce
    // č. 357/2013 Sb. (příloha bod 13) — tutéž tabulku ukazuje Příručka
    // (data/predpisy.json). Vzorec 2·√2·mxy dá pro kód 3 hodnotu 0,3960 m, kdežto
    // vyhláška uvádí 0,39 m; kdyby appka počítala, hlásila by o centimetr jinou mez,
    // než má uživatel na papíře.
    var MEZ = { 3: 0.39, 4: 0.74, 5: 1.41, 6: 0.59, 7: 1.41, 8: 2.82 };
    function mez(k) { return MEZ[k] || MEZ[3]; }
    function kod() {
        try { var v = parseInt(localStorage.getItem(LS_KOD), 10); if (MEZ[v]) return v; } catch (e) { swallow(e, 'overeni:kod'); }
        return 3;
    }

    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, kde || 'overeni-bodu'); } catch (err) { /* nic */ } }
    function esc(s) {
        return (window.AG && AG.esc) ? AG.esc(s)
            : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }
    function toast(m) {
        try { if (window.AG && AG.toast) return AG.toast(m); } catch (e) { swallow(e, 'overeni:toast'); }
        try { if (typeof quickToast === 'function') return quickToast(m); } catch (e) { swallow(e, 'overeni:toast'); }
    }
    function body() {
        try { return (typeof persistentCustomPoints !== 'undefined' && Array.isArray(persistentCustomPoints)) ? persistentCustomPoints : []; }
        catch (e) { return []; }
    }
    function uloz() {
        try { if (typeof setStoredData === 'function') setStoredData('arCustomPoints12', JSON.stringify(body())); }
        catch (e) { swallow(e, 'overeni:uloz'); }
    }
    // S-JTSK (kladné Y, X) — stejný převod, jaký používá zbytek appky
    function sjtsk(p) {
        try {
            if (typeof proj4 !== 'function' || p.lat == null || p.lng == null) return null;
            var s = proj4('EPSG:4326', 'EPSG:5514', [p.lng, p.lat]);
            return { y: Math.abs(s[0]), x: Math.abs(s[1]) };
        } catch (e) { return null; }
    }

    // ================================================================
    //  1) zápis odkazu na ověřovaný bod
    // ================================================================
    // Karta bodu („Kontrolní bod") jen předvyplní standardní formulář Nového bodu
    // a nechá uživatele bod uložit. Mezi klepnutím a uložením se toho může stát
    // hodně (fotka, kód bodu, průměrování), takže si tady jen poznamenáme, ČÍ
    // kontrola se zakládá, a při nejbližším uložení to k bodu dopíšeme.
    var _ceka = null;               // { id, name, ts }
    var _kartaPt = null;            // bod, jehož karta je otevřená

    function sledujKartu() {
        if (window.__agOvShowWrapped || typeof window.showDetails !== 'function') return;
        var orig = window.showDetails;
        window.showDetails = function (pt) {
            var r = orig.apply(this, arguments);
            try { _kartaPt = pt || null; pecet(pt); } catch (e) { swallow(e, 'overeni:showDetails'); }
            return r;
        };
        window.__agOvShowWrapped = true;
    }

    // Tlačítko „Kontrolní bod" vyrábí js/karta-bodu.js jako [data-a="check"]
    // uvnitř #ag-kb-acts. Posloucháme v capture fázi na dokumentu, ať na tom
    // nezáleží, kolikrát se lišta akcí překreslí.
    function sledujTlacitko() {
        if (window.__agOvClickWrapped) return;
        document.addEventListener('click', function (e) {
            try {
                var t = e.target && e.target.closest && e.target.closest('[data-a="check"]');
                if (!t || !t.closest('#ag-kb-acts')) return;
                if (!_kartaPt || _kartaPt.id == null) return;
                _ceka = { id: _kartaPt.id, name: _kartaPt.name || '', ts: Date.now() };
            } catch (err) { swallow(err, 'overeni:klik'); }
        }, true);
        window.__agOvClickWrapped = true;
    }

    function wrapSave() {
        if (typeof window.saveCustomPoint !== 'function' || window.saveCustomPoint._agOvWrapped) return;
        var orig = window.saveCustomPoint;
        var wrapped = function () {
            var pred = body().length;
            var editace = false;
            try { editace = (typeof editingCustomPointId !== 'undefined') && !!editingCustomPointId; } catch (e) { swallow(e, 'overeni:wrapSave'); }

            var ret = orig.apply(this, arguments);

            try {
                if (editace || !_ceka) return ret;
                if (Date.now() - _ceka.ts > CEKANI_MS) { _ceka = null; return ret; }
                var arr = body();
                if (!arr.length || arr.length <= pred) return ret;      // nepřibyl bod
                var p = arr[arr.length - 1];
                if (!p) return ret;
                if (!p.prov) p.prov = {};
                if (p.prov.checkOf == null) {
                    p.prov.checkOf = _ceka.id;
                    uloz();
                }
                _ceka = null;
            } catch (e) { swallow(e, 'overeni:wrapSave'); }
            return ret;
        };
        wrapped._agOvWrapped = true;
        wrapped._agOrig = orig;
        window.saveCustomPoint = wrapped;
    }

    // ================================================================
    //  2) párování a výpočet
    // ================================================================
    function cas(p) {
        var t = (p.prov && p.prov.ts) || p.ts || null;
        return t ? +new Date(t) : 0;
    }

    // Kontroly daného bodu: zapsané (prov.checkOf) mají přednost, název je záloha.
    function kontrolyK(p, vse) {
        var out = [], i, q;
        for (i = 0; i < vse.length; i++) {
            q = vse[i];
            if (q === p) continue;
            if (q.prov && q.prov.checkOf != null && q.prov.checkOf === p.id) out.push({ pt: q, podleNazvu: false });
        }
        if (out.length) return out;
        var jm = String(p.name == null ? '' : p.name).trim();
        if (!jm) return out;
        for (i = 0; i < vse.length; i++) {
            q = vse[i];
            if (q === p) continue;
            if (q.prov && q.prov.checkOf != null) continue;             // patří jinam
            if (String(q.name || '').trim() === 'K_' + jm.replace(/\s+/g, '_')) out.push({ pt: q, podleNazvu: true });
        }
        return out;
    }

    // Nejlepší dostupná kontrola bodu = ta s NEJVĚTŠÍM odstupem v čase (nejvíc
    // nezávislá). Vrací null, když bod žádnou kontrolu nemá.
    function overeni(p, vse) {
        // 1) zapsané kontrolní měření (js/dvoji-mereni.js) — má přednost před vším,
        //    protože tam druhé určení proběhlo vedeně a rozdíl je spočítaný z obou
        //    poloh, ne odvozený z párování bodů.
        var rc = p && p.prov && p.prov.recheck;
        if (rc && isFinite(rc.d)) {
            var dt = (rc.t1 && rc.t2) ? Math.abs(rc.t2 - rc.t1) : 0;
            var z = {
                pt: null, zdroj: 'recheck', podleNazvu: false,
                dy: (rc.dE != null) ? rc.dE : null,      // dE/dN je lokální rozklad
                dx: (rc.dN != null) ? rc.dN : null,      // (dvoji-mereni.js), ne S-JTSK
                d: rc.d, odstupMs: dt,
                slaba: dt > 0 && dt < SLABA_KONTROLA_MS,
                mode: rc.mode || ''
            };
            z.mez = mez(kod());
            z.ok = z.d <= z.mez;
            return z;
        }
        var k = kontrolyK(p, vse || body());
        if (!k.length) return null;
        var a = sjtsk(p);
        if (!a) return null;
        var nej = null;
        for (var i = 0; i < k.length; i++) {
            var b = sjtsk(k[i].pt);
            if (!b) continue;
            var dt = Math.abs(cas(k[i].pt) - cas(p));
            var dy = b.y - a.y, dx = b.x - a.x;
            var rec = {
                pt: k[i].pt, zdroj: 'bod', podleNazvu: k[i].podleNazvu,
                dy: dy, dx: dx, d: Math.sqrt(dy * dy + dx * dx),
                odstupMs: dt, slaba: dt > 0 && dt < SLABA_KONTROLA_MS
            };
            if (!nej || dt > nej.odstupMs) nej = rec;
        }
        if (!nej) return null;
        nej.mez = mez(kod());
        nej.ok = nej.d <= nej.mez;
        return nej;
    }

    function cm(m) { return Math.round(m * 100); }
    function odstupText(ms) {
        if (!ms) return 'stejný čas';
        var min = Math.round(ms / 60000);
        if (min < 90) return min + ' min';
        var h = Math.round(min / 6) / 10;
        if (h < 48) return String(h).replace('.', ',') + ' h';
        return Math.round(h / 24) + ' dní';
    }

    // ================================================================
    //  3) pečeť v kartě bodu
    // ================================================================
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '#ag-ov-seal{margin:6px 0 2px;padding:8px 10px;border-radius:12px;display:flex;gap:8px;align-items:flex-start;',
            '  font-size:calc(12.5px * var(--ag-font-scale, 1));line-height:1.4;border:1px solid var(--glass-border,rgba(255,255,255,0.14));}',
            '#ag-ov-seal.ok{background:rgba(16,185,129,0.14);border-color:rgba(16,185,129,0.45);}',
            '#ag-ov-seal.mimo{background:rgba(239,68,68,0.14);border-color:rgba(239,68,68,0.5);}',
            '#ag-ov-seal.chybi{background:rgba(148,163,184,0.12);}',
            '#ag-ov-seal b{font-weight:700;}',
            '#ag-ov-seal .ag-ov-pozn{opacity:0.75;}',
            '#' + MODAL_ID + ' table{width:100%;border-collapse:collapse;font-size:calc(12px * var(--ag-font-scale, 1));}',
            '#' + MODAL_ID + ' th,#' + MODAL_ID + ' td{padding:5px 4px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.12));text-align:right;white-space:nowrap;}',
            '#' + MODAL_ID + ' th:first-child,#' + MODAL_ID + ' td:first-child{text-align:left;white-space:normal;}',
            '#' + MODAL_ID + ' th{opacity:0.7;font-weight:600;}',
            '#' + MODAL_ID + ' td.ok{color:#10b981;font-weight:700;}',
            '#' + MODAL_ID + ' td.mimo{color:#ef4444;font-weight:700;}',
            '#' + MODAL_ID + ' td.chybi{opacity:0.6;}',
            '#ag-ov-souhrn{margin:2px 0 10px;font-size:calc(13px * var(--ag-font-scale, 1));}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function pecet(pt) {
        try {
            if (!pt) return;
            var det = document.getElementById('det-body');
            if (!det) return;
            injectStyles();
            var el = document.getElementById('ag-ov-seal');
            if (!el) {
                el = document.createElement('div');
                el.id = 'ag-ov-seal';
            }
            // Pečeť patří pod navigační pruh a odchylku z js/karta-bodu.js, ale
            // NAD lištu akcí — ať je vidět dřív, než se sáhne po tlačítku.
            var acts = document.getElementById('ag-kb-acts');
            if (acts && acts.parentNode) acts.parentNode.insertBefore(el, acts);
            else det.insertBefore(el, det.firstChild);

            // Kontrolní bod sám o sobě se neověřuje — ukáže, čí kontrola to je.
            if (pt.prov && pt.prov.checkOf != null) {
                var rodic = null, vse = body();
                for (var i = 0; i < vse.length; i++) { if (vse[i].id === pt.prov.checkOf) { rodic = vse[i]; break; } }
                el.className = 'chybi';
                el.innerHTML = '<span>🔎</span><span>Kontrolní měření bodu <b>' + esc(rodic ? (rodic.name || 'bez názvu') : 'smazaného') + '</b>'
                    + '<div class="ag-ov-pozn">Verdikt najdeš v kartě ověřovaného bodu a v nástroji Ověření bodů.</div></span>';
                return;
            }

            var o = overeni(pt, body());
            if (!o) {
                el.className = 'chybi';
                el.innerHTML = '<span>⚠</span><span><b>Jediné určení — neověřeno.</b>'
                    + '<div class="ag-ov-pozn">Systematickou chybu GNSS průměrování neodstraní. Dojdi k bodu znovu a ťukni na <b>Kontrolní bod</b>.</div></span>';
                return;
            }
            el.className = o.ok ? 'ok' : 'mimo';
            var pozn = [];
            pozn.push(o.zdroj === 'recheck' ? 'z Kontrolního měření' : 'z kontrolního bodu');
            pozn.push('odstup ' + odstupText(o.odstupMs));
            if (o.slaba) pozn.push('pod 20 min = slabá kontrola, systematika je nejspíš stejná');
            if (o.podleNazvu) pozn.push('spárováno podle názvu');
            el.innerHTML = '<span>' + (o.ok ? '✓' : '✕') + '</span><span><b>'
                + (o.ok ? 'Ověřeno druhým určením' : 'Druhé určení MIMO mez') + '</b> · Δ ' + cm(o.d) + ' cm'
                + ' (mez ' + cm(o.mez) + ' cm, kód ' + kod() + ')'
                + '<div class="ag-ov-pozn">' + esc(pozn.join(' · ')) + '</div></span>';
        } catch (e) { swallow(e, 'overeni:pecet'); }
    }

    // ================================================================
    //  4) soupis
    // ================================================================
    function ensureModal() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = MODAL_ID;
        m.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent); margin-top:0;">Ověření bodů</h3>'
            + '<label class="filter-row" style="margin:2px 0 6px;">Mezní odchylka podle kódu kvality: '
            + '<select id="ag-ov-kod" style="margin-left:6px;">'
            + '<option value="3">3 — nové zaměření (mez 39 cm)</option>'
            + '<option value="4">4 — zaměření (mez 74 cm)</option>'
            + '<option value="5">5 — zaměření (mez 141 cm)</option>'
            + '</select></label>'
            + '<div id="ag-ov-souhrn"></div>'
            + '<div class="modal-body" id="ag-ov-list"></div>'
            + '<button class="btn btn-secondary" style="width:100%; margin-top:10px;" id="ag-ov-csv">Export do CSV</button>'
            + '<div class="row-buttons"><button class="btn btn-secondary" id="ag-ov-close">Zavřít</button></div>'
            + '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-ov-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-ov-csv').addEventListener('click', exportCsv);
        m.querySelector('#ag-ov-kod').addEventListener('change', function () {
            try { localStorage.setItem(LS_KOD, this.value); } catch (e) { swallow(e, 'overeni:kodSave'); }
            render();
        });
        return m;
    }

    // Vlastní body zakázky bez kontrolních bodů (ty se ověřují jako pár, ne samy).
    function merene() {
        return body().filter(function (p) { return !(p.prov && p.prov.checkOf != null); });
    }

    function render() {
        var box = document.getElementById('ag-ov-list');
        var sou = document.getElementById('ag-ov-souhrn');
        if (!box) return;
        var vse = body(), list = merene();
        if (!list.length) {
            sou.innerHTML = '';
            box.innerHTML = '<p style="text-align:center; opacity:0.7;">V téhle zakázce zatím nejsou vlastní body.</p>';
            return;
        }
        var radky = list.map(function (p) { return { p: p, o: overeni(p, vse) }; });
        var ok = radky.filter(function (r) { return r.o && r.o.ok; }).length;
        var mimoM = radky.filter(function (r) { return r.o && !r.o.ok; }).length;
        var bez = radky.length - ok - mimoM;

        sou.innerHTML = '<b>' + ok + '</b> z <b>' + radky.length + '</b> bodů má druhé určení v mezi'
            + (mimoM ? ' · <span style="color:#ef4444;"><b>' + mimoM + '</b> mimo mez</span>' : '')
            + (bez ? ' · <span style="opacity:0.7;">' + bez + ' neověřeno</span>' : '');

        // nejdřív problémy, pak neověřené, nakonec hotové
        radky.sort(function (a, b) { return poradi(a) - poradi(b); });

        box.innerHTML = '<table><thead><tr><th>Bod</th><th>Δ</th><th>Odstup</th><th>Stav</th></tr></thead><tbody>'
            + radky.map(function (r) {
                if (!r.o) {
                    return '<tr><td>' + esc(r.p.name || 'bez názvu') + '</td><td class="chybi">—</td>'
                        + '<td class="chybi">—</td><td class="chybi">neověřeno</td></tr>';
                }
                return '<tr><td>' + esc(r.p.name || 'bez názvu') + (r.o.podleNazvu ? ' <span style="opacity:.6;">(dle názvu)</span>' : '') + '</td>'
                    + '<td>' + cm(r.o.d) + ' cm</td>'
                    + '<td>' + esc(odstupText(r.o.odstupMs)) + (r.o.slaba ? ' ⚠' : '') + '</td>'
                    + '<td class="' + (r.o.ok ? 'ok' : 'mimo') + '">' + (r.o.ok ? 'v mezi' : 'MIMO') + '</td></tr>';
            }).join('') + '</tbody></table>'
            + '<p style="opacity:0.7; margin-top:10px; font-size:calc(11.5px * var(--ag-font-scale, 1));">'
            + 'Mezní polohová odchylka = 2·√2·mxy (katastrální vyhláška č. 357/2013 Sb., příloha bod 13). '
            + '⚠ u odstupu = obě určení do 20 minut po sobě, takže mají nejspíš stejnou systematickou chybu — '
            + 'jako kontrola to platí míň.</p>';
    }

    function poradi(r) { return !r.o ? 1 : (r.o.ok ? 2 : 0); }

    function exportCsv() {
        var vse = body(), list = merene();
        if (!list.length) { toast('Není co exportovat.'); return; }
        var lines = ['bod;Y;X;stav;dY_m;dX_m;odchylka_m;mez_m;odstup_min;parovani'];
        list.forEach(function (p) {
            var s = sjtsk(p), o = overeni(p, vse);
            var nm = String(p.name == null ? 'bod' : p.name).replace(/[;\r\n]/g, ' ');
            lines.push([
                nm,
                s ? s.y.toFixed(2) : '', s ? s.x.toFixed(2) : '',
                o ? (o.ok ? 'v mezi' : 'MIMO MEZ') : 'neovereno',
                o ? o.dy.toFixed(3) : '', o ? o.dx.toFixed(3) : '',
                o ? o.d.toFixed(3) : '', o ? o.mez.toFixed(2) : '',
                o ? Math.round(o.odstupMs / 60000) : '',
                o ? (o.zdroj === 'recheck' ? 'kontrolni mereni' : (o.podleNazvu ? 'kontrolni bod (dle nazvu)' : 'kontrolni bod')) : ''
            ].join(';'));
        });
        try {
            var csv = '﻿' + lines.join('\r\n') + '\r\n';
            var a = document.createElement('a');
            a.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv));
            a.setAttribute('download', 'overeni-bodu-' + new Date().toISOString().slice(0, 10) + '.csv');
            document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { swallow(e, 'overeni:csv'); }
    }

    function open() {
        var m = ensureModal();
        var sel = document.getElementById('ag-ov-kod');
        if (sel) sel.value = String(kod());
        render();
        m.style.display = 'flex';
    }

    // ================================================================
    //  init
    // ================================================================
    function registruj() {
        if (typeof window.agRegisterFieldTool !== 'function') return false;
        window.agRegisterFieldTool({
            id: 'overeni-bodu', label: 'Ověření bodů', icon: ICON, onClick: open
        });
        return true;
    }

    var _pokusy = 0;
    function init() {
        sledujKartu();
        sledujTlacitko();
        wrapSave();
        if (!registruj() && _pokusy++ < 20) setTimeout(init, 500);
        // saveCustomPoint i showDetails mohou vzniknout/být přebalené později
        // (lazy moduly, přepnutí zakázky) — obalení je idempotentní.
        if (!window.__agOvTimer) {
            window.__agOvTimer = (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
                try { sledujKartu(); wrapSave(); } catch (e) { swallow(e, 'overeni:tik'); }
            }, 1700);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AGOvereni = { open: open, overeni: overeni, mez: mez };
})();
