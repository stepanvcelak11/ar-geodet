// ===== QTRIG — VLASTNÍK PLUS (ODLOŽENÁ vrstva nad Konzolí vlastníka) ===========
// 12. 9. 2026: uživatel vybral na stránce „Návrhy pro vlastníka" 13 ze 14 návrhů.
// Tenhle modul nese ty, které patří do konzole (js/vlastnik.js ho volá přes
// AGVlastnikPlus.view / .dashboard / .items):
//   dnes       — Souhrn dne: dlaždice nahoře v konzoli (lidé, body, účty, žádosti,
//                zprávy, chyby za 24 h) + pohled „prehled" s detailem
//   badge      — tečka „něco čeká" na zlatých vstupech do konzole (tichý dotaz
//                GET /owner/prehled?lite=1 jednou za 5 minut, jen v režimu vlastníka)
//   online     — kdo je v terénu (aktivita < 10 min) + mapa shluků, kde se měřilo
//   audit      — Deník vlastníka (GET /owner/log)
//   kalendar   — komu Pro vyprší (z /owner/ucty), s prodloužením
//   zaloha     — záloha serveru (GET /owner/export → soubor)
//   ocima      — pohled očima účtu (GET /owner/ucty/:id/pohled), otevírá se z Lidí
//   export     — body firmy do CSV (z dat, která už má js/sprava-appky.js)
// Ostatní schválené kusy bydlí tam, kam patří: 14denní zkouška a poznámka u účtu
// a vzkaz v js/prodej-konzole.js, vzkaz firmě a CSV v js/sprava-appky.js, verze
// chyb + Vypnout modul a filtr „jen Pro" přímo v js/vlastnik.js.
//
// Odstranění: smaž tenhle soubor + řádek <script type="ag/lazy"> v index.html
// + './js/vlastnik-plus.js' v sw.js. Konzole pak jen nemá tyhle položky.
// ================================================================================
(function () {
    'use strict';
    if (window.AGVlastnikPlus) return;

    var LS_KEY = 'agFbKey_v1';
    var API_FALLBACK = 'https://ar-geodet-api.ar-geodet.workers.dev';
    var _cache = null, _cacheTs = 0, _lite = null, _liteTs = 0, _log = null, _ucty = null, _pohled = null, _pohledId = null, _zaloha = null;

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'vlastnik-plus:' + kde); } catch (x) { } }
    function X() { return (window.AGVlastnik && AGVlastnik.ext) || null; }
    function esc(s) { var x = X(); return x ? x.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function api(path, opts) { var x = X(); return x ? x.api(path, null, (opts && opts.timeoutMs) || 20000, opts) : Promise.resolve({ ok: false, status: 0, data: null }); }
    function isOn() { try { return !!(window.AGVlastnik && AGVlastnik.isOn()); } catch (e) { return false; } }
    function jdi(v) { try { AGVlastnik.jdi(v); } catch (e) { swallow(e, 'jdi'); } }
    // ⚠ Odpověď serveru může dorazit, až když je otevřený JINÝ pohled — kreslit
    //   do něj by ho přepsalo (kalendář přepsal zálohu). Každý callback se ptá.
    function plati(v) { try { return X().view() === v; } catch (e) { return true; } }
    function datum(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleDateString('cs-CZ'); } catch (e) { return '—'; } }
    function cas(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } }
    function pred(ts) {
        if (!ts) return '—';
        var m = Math.round((Date.now() - ts) / 60000);
        if (m < 1) return 'právě teď'; if (m < 60) return 'před ' + m + ' min';
        var h = Math.round(m / 60); if (h < 48) return 'před ' + h + ' h';
        return 'před ' + Math.round(h / 24) + ' dny';
    }
    function dni(ts) { return Math.ceil((ts - Date.now()) / 864e5); }

    function styly() {
        if (document.getElementById('ag-vp-style')) return;
        var st = document.createElement('style'); st.id = 'ag-vp-style';
        st.textContent = [
            '.agvp-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 14px;}',
            '.agvp-t{padding:10px 8px;border-radius:12px;background:var(--glass-bg,rgba(255,255,255,.05));border:1px solid var(--glass-border,rgba(255,255,255,.12));text-align:center;cursor:pointer;}',
            '.agvp-t b{display:block;font:700 calc(20px * var(--ag-font-scale,1))/1.1 var(--font-mono,ui-monospace,monospace);color:var(--text-color,#e6e8eb);}',
            '.agvp-t small{display:block;margin-top:3px;font:600 10.5px/1.2 var(--font-ui,system-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '.agvp-t.warn{border-color:var(--agv-gold,#d4a02c);}.agvp-t.warn b{color:var(--agv-gold,#d4a02c);}',
            '.agvp-t.bad{border-color:#e2685f;}.agvp-t.bad b{color:#e2685f;}',
            '.agvp-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:11px;margin:0 0 6px;background:var(--glass-bg,rgba(255,255,255,.04));border:1px solid var(--glass-border,rgba(255,255,255,.1));font-size:calc(13px * var(--ag-font-scale,1));}',
            '.agvp-row .tx{flex:1;min-width:0;}.agvp-row .tx b{display:block;}.agvp-row .tx small{display:block;color:var(--text-muted,#9aa1ac);font-size:calc(11.5px * var(--ag-font-scale,1));}',
            '.agvp-row .r{flex:none;text-align:right;font-family:var(--font-mono,ui-monospace,monospace);font-size:calc(12px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);}',
            '.agvp-dot{width:8px;height:8px;border-radius:50%;background:#3fbc8c;flex:none;box-shadow:0 0 8px #3fbc8c;}',
            '.agvp-map{height:220px;border-radius:12px;overflow:hidden;border:1px solid var(--glass-border,rgba(255,255,255,.12));margin:8px 0 12px;background:#0b1015;}',
            '.agvp-log{padding:8px 10px;border-left:2px solid var(--glass-border,rgba(255,255,255,.2));margin:0 0 6px 4px;font-size:calc(12.5px * var(--ag-font-scale,1));}',
            '.agvp-log b{color:var(--accent,#2f9e74);}.agvp-log small{display:block;color:var(--text-muted,#9aa1ac);}',
            '.agvp-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--agv-gold,#d4a02c);color:#fff;font:700 11.5px/1 var(--font-ui,system-ui);margin-left:8px;vertical-align:middle;}',
            '.agvp-m{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px;}',
            '.agvp-m button{font:600 12px var(--font-ui,system-ui);padding:6px 10px;border-radius:999px;border:1px solid var(--glass-border,rgba(255,255,255,.16));background:transparent;color:inherit;cursor:pointer;}',
            '.agvp-m button.on{border-color:var(--accent,#2f9e74);color:var(--accent,#2f9e74);}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // ---- data ------------------------------------------------------------------------------
    function nactiPrehled(cb, vynut) {
        if (!vynut && _cache && Date.now() - _cacheTs < 60000) return cb(_cache);
        api('/owner/prehled').then(function (r) {
            if (r.ok && r.data) { _cache = r.data; _cacheTs = Date.now(); cb(_cache); }
            else cb(null, r);
        });
    }

    // ---- SOUHRN DNE: dlaždice nahoře v konzoli ----------------------------------------------
    function dashboard(b) {
        if (!b || b.querySelector('.agvp-tiles')) return;
        styly();
        var hd = b.querySelector('.agv-hd'); if (!hd) return;
        var box = document.createElement('div'); box.className = 'agvp-tiles';
        box.innerHTML = '<div class="agvp-t"><b>…</b><small>načítám</small></div>';
        hd.parentNode.insertBefore(box, hd.nextSibling);
        nactiPrehled(function (d, r) {
            if (!box.isConnected) return;
            if (!d) { box.innerHTML = '<div class="agvp-t" style="grid-column:1/-1;"><small>souhrn se nenačetl' + (r && r.status ? ' (' + r.status + ')' : '') + '</small></div>'; return; }
            var vyp7 = (d.vyprsi || []).filter(function (u) { return dni(u.tarif_do) <= 7; }).length;
            box.innerHTML =
                tile(d.lidi24, 'lidí za 24 h', 'prehled') + tile(d.body24, 'bodů za 24 h', 'prehled') + tile((d.online || []).length, 'v terénu teď', 'prehled', (d.online || []).length ? 'ok' : '') +
                tile(d.zadosti, 'žádostí o Pro', 'zadosti', d.zadosti ? 'warn' : '') + tile(d.zpravy, 'zpráv čeká', 'zpravy', d.zpravy ? 'warn' : '') + tile(d.chyby24, 'chyb za 24 h', 'errors', d.chyby24 ? 'bad' : '') +
                (vyp7 ? tile(vyp7, 'Pro končí brzy', 'kalendar', 'warn') : '') + (d.ucty24 ? tile(d.ucty24, 'nových účtů', 'lide') : '');
            Array.prototype.forEach.call(box.querySelectorAll('[data-go]'), function (el) {
                el.addEventListener('click', function () { otevri(el.getAttribute('data-go')); });
            });
        });
    }
    function tile(n, popis, go, cls) {
        return '<div class="agvp-t' + (cls ? ' ' + cls : '') + '" data-go="' + go + '"><b>' + (n == null ? '—' : n) + '</b><small>' + popis + '</small></div>';
    }
    function otevri(kam) {
        if (kam === 'zadosti' || kam === 'lide') {
            var go = function () { try { AGVlastnik.close(); AGProdej.open(kam === 'zadosti' ? 'zad' : 'lide'); } catch (e) { swallow(e, 'prodej'); } };
            if (window.AGProdej) go(); else if (window.AGLazy) AGLazy.need('js/prodej-konzole.js', go);
            return;
        }
        if (kam === 'zpravy') {
            var go2 = function () { try { AGVlastnik.close(); AGZpetna.inbox(); } catch (e) { swallow(e, 'zpravy'); } };
            if (window.AGZpetna) go2(); else if (window.AGLazy) AGLazy.need('js/zpetna-vazba.js', go2);
            return;
        }
        jdi(kam);
    }

    // ---- POHLED: souhrn + kdo je v terénu + mapa ---------------------------------------------
    function viewPrehled(b) {
        var x = X(); styly();
        x.cekam(b, 'Sbírám souhrn…');
        nactiPrehled(function (d, r) {
            if (!plati('prehled')) return;
            if (!d) { x.sayFail(r || { status: 0 }, 'souhrn'); jdi(''); return; }
            var h = [x.hlava('Souhrn dne', 'Za posledních 24 hodin, napříč všemi firmami. Aktualizace <button type="button" class="agv-b" id="agvp-refresh">znovu</button>')];
            h.push('<div class="agvp-tiles">' + tile(d.lidi24, 'lidí měřilo') + tile(d.body24, 'bodů přibylo') + tile(d.ucty24, 'nových účtů') +
                tile(d.zadosti, 'žádostí o Pro', 'zadosti', d.zadosti ? 'warn' : '') + tile(d.zpravy, 'zpráv čeká', 'zpravy', d.zpravy ? 'warn' : '') + tile(d.chyby24, 'chyb', 'errors', d.chyby24 ? 'bad' : '') +
                tile(d.uctyCelkem, 'účtů celkem') + tile(d.proCelkem, 's Pro') + tile((d.shluky || []).length, 'míst měření') + '</div>');
            h.push('<div class="agv-sec">Kdo je v terénu teď (aktivita do 10 minut)</div>');
            if (!(d.online || []).length) h.push('<div class="agv-p">Teď nikdo — poslední aktivitu najdeš v Lidech.</div>');
            (d.online || []).forEach(function (o) {
                h.push('<div class="agvp-row"><span class="agvp-dot"></span><span class="tx"><b>' + esc(o.jmeno || o.uid) + '</b><small>' + esc(o.firma || 'vlastní prostor') + (o.job ? ' · ' + esc(o.job) : '') + '</small></span><span class="r">' + esc(pred(o.ts)) + (o.n ? '<br>' + o.n + ' akcí' : '') + '</span></div>');
            });
            h.push('<div class="agv-sec">Kde se za 24 h měřilo</div>');
            if (!(d.shluky || []).length) h.push('<div class="agv-p">Žádné synchronizované body za 24 h (body chodí na server jen ze synchronizace v Pro).</div>');
            else h.push('<div class="agvp-map" id="agvp-map"></div><div class="agv-p">Shluky po ~2 km, počet bodů v každém. Konkrétní souřadnice se sem neposílají.</div>');
            if ((d.vyprsi || []).length) {
                h.push('<div class="agv-sec">Pro vyprší do 60 dní</div>');
                d.vyprsi.slice(0, 8).forEach(function (u) {
                    h.push('<div class="agvp-row"><span class="tx"><b>' + esc(u.name) + '</b><small>' + esc(u.code) + '</small></span><span class="r">' + datum(u.tarif_do) + '<br>za ' + dni(u.tarif_do) + ' d</span></div>');
                });
                h.push('<button type="button" class="agv-b" data-go="kalendar">Celý kalendář ›</button>');
            }
            b.innerHTML = h.join('');
            x.wireZpet(b);
            Array.prototype.forEach.call(b.querySelectorAll('[data-go]'), function (el) { el.addEventListener('click', function () { otevri(el.getAttribute('data-go')); }); });
            var rf = b.querySelector('#agvp-refresh'); if (rf) rf.addEventListener('click', function () { _cache = null; viewPrehled(b); });
            if ((d.shluky || []).length) setTimeout(function () { mapa(d.shluky); }, 60);
        });
    }
    function mapa(shluky) {
        var el = document.getElementById('agvp-map');
        if (!el || !window.L) return;
        try {
            var m = L.map(el, { zoomControl: false, attributionControl: false });
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 16 }).addTo(m);
            var pts = [];
            shluky.forEach(function (s) {
                pts.push([s.lat, s.lng]);
                L.circleMarker([s.lat, s.lng], { radius: Math.min(22, 6 + Math.sqrt(s.n) * 3), color: '#e6bd76', fillColor: '#e6bd76', fillOpacity: .35, weight: 1.5 })
                    .bindTooltip(s.n + ' bodů').addTo(m);
            });
            if (pts.length === 1) m.setView(pts[0], 11); else m.fitBounds(pts, { padding: [20, 20], maxZoom: 12 });
        } catch (e) { swallow(e, 'mapa'); el.innerHTML = '<div class="agv-p" style="padding:12px;">Mapa se nevykreslila.</div>'; }
    }

    // ---- DENÍK VLASTNÍKA --------------------------------------------------------------------
    var AKCE = { 'pro-zapnout': 'Zapnuto Pro', 'pro-vypnout': 'Vypnuto Pro', blokace: 'Zablokován účet', odblokovat: 'Odblokován účet', vypinac: 'Vypínač modulů', 'hlaska-vsem': 'Hláška všem firmám',
        'firma-smazat': 'Smazána firma', 'firma-zmrazit': 'Zmrazení firmy', 'zprava-vyrizeno': 'Zpráva vyřízena', 'zprava-zpet': 'Zpráva zpět mezi nevyřízené', 'zprava-smazat': 'Zpráva smazána', vzkaz: 'Vzkaz', poznamka: 'Poznámka u účtu', zaloha: 'Záloha serveru' };
    function viewDenik(b) {
        var x = X(); styly();
        if (!_log) {
            x.cekam(b, 'Načítám deník…');
            api('/owner/log').then(function (r) {
                if (!plati('denik')) return;
                if (!r.ok) { x.sayFail(r, 'deník'); jdi(''); return; }
                _log = r.data || { rows: [] }; viewDenik(b);
            });
            return;
        }
        var h = [x.hlava('Deník vlastníka', 'Každá akce z konzole se zapisuje na server: co, komu, kdy. Za měsíc si nepamatuješ, proč má někdo Pro navždy — tady to je.')];
        if (!_log.rows.length) h.push('<div class="agv-p" style="padding:20px 4px;text-align:center;">Zatím prázdný — plní se od téhle verze workeru.</div>');
        _log.rows.forEach(function (r) {
            h.push('<div class="agvp-log"><b>' + esc(AKCE[r.akce] || r.akce) + '</b>' + (r.cil ? ' — ' + esc(r.cil) : '') + (r.detail ? '<br>' + esc(r.detail) : '') + '<small>' + esc(cas(r.ts)) + '</small></div>');
        });
        if (_log.more) h.push('<button type="button" class="btn btn-secondary" id="agvp-more" style="margin-top:10px;">Starší záznamy</button>');
        h.push('<button type="button" class="btn btn-secondary" id="agvp-log-rf" style="margin-top:8px;">Načíst znovu</button>');
        b.innerHTML = h.join('');
        x.wireZpet(b);
        var mo = b.querySelector('#agvp-more');
        if (mo) mo.addEventListener('click', function () {
            var last = _log.rows[_log.rows.length - 1];
            api('/owner/log?before=' + (last ? last.id : 0)).then(function (r) {
                if (r.ok && r.data) { _log.rows = _log.rows.concat(r.data.rows || []); _log.more = !!r.data.more; viewDenik(b); }
            });
        });
        b.querySelector('#agvp-log-rf').addEventListener('click', function () { _log = null; viewDenik(b); });
    }

    // ---- KALENDÁŘ VYPRŠENÍ PRO ------------------------------------------------------------
    function nactiUcty(cb) {
        api('/owner/ucty').then(function (r) { cb(r.ok ? ((r.data && r.data.ucty) || []) : null, r); });
    }
    function viewKalendar(b) {
        var x = X(); styly();
        x.cekam(b, 'Načítám účty…');
        nactiUcty(function (ucty, r) {
            if (!plati('kalendar')) return;
            if (!ucty) { x.sayFail(r, 'účty'); jdi(''); return; }
            _ucty = ucty;
            var ted = Date.now();
            var pro = ucty.filter(function (u) { return u.tarif === 'pro' && u.tarif_do; }).sort(function (a, c) { return a.tarif_do - c.tarif_do; });
            var navzdy = ucty.filter(function (u) { return u.tarif === 'pro' && !u.tarif_do; }).length;
            var h = [x.hlava('Kalendář vypršení Pro', 'Komu Pro končí a kdy. Prodloužení se počítá od konce běžícího Pro, nikomu se nic nezkrátí.')];
            var skup = [['Už vypršelo', function (d) { return d < 0; }], ['Do 7 dní', function (d) { return d >= 0 && d <= 7; }], ['Do 30 dní', function (d) { return d > 7 && d <= 30; }], ['Do 90 dní', function (d) { return d > 30 && d <= 90; }], ['Později', function (d) { return d > 90; }]];
            var neco = false;
            skup.forEach(function (sk) {
                var list = pro.filter(function (u) { return sk[1](dni(u.tarif_do)); });
                if (!list.length) return;
                neco = true;
                h.push('<div class="agv-sec">' + sk[0] + ' (' + list.length + ')</div>');
                list.forEach(function (u) {
                    var d = dni(u.tarif_do);
                    h.push('<div class="agvp-row"><span class="tx"><b>' + esc(u.name) + '</b><small>' + esc(u.code) + (u.prostory && u.prostory.length ? ' · ' + esc(u.prostory.filter(function (p) { return !p.vlastni; }).map(function (p) { return p.nazev; }).join(', ') || 'jen vlastní prostor') : '') + '</small></span>' +
                        '<span class="r">' + datum(u.tarif_do) + '<br>' + (d < 0 ? 'před ' + (-d) + ' d' : 'za ' + d + ' d') + '</span>' +
                        '<div class="agvp-m" style="margin:0;"><button type="button" data-pro="' + esc(u.id) + '" data-dni="30">+ měsíc</button><button type="button" data-pro="' + esc(u.id) + '" data-dni="365">+ rok</button></div></div>');
                });
            });
            if (!neco) h.push('<div class="agv-p" style="padding:20px 4px;text-align:center;">Nikomu Pro nevyprší — ' + (navzdy ? navzdy + ' účtů má Pro navždy.' : 'nikdo zatím Pro s koncem nemá.') + '</div>');
            else if (navzdy) h.push('<div class="agv-p" style="margin-top:10px;">Dalších ' + navzdy + ' účtů má Pro navždy.</div>');
            b.innerHTML = h.join('');
            x.wireZpet(b);
            Array.prototype.forEach.call(b.querySelectorAll('[data-pro]'), function (el) {
                el.addEventListener('click', function () {
                    var id = el.getAttribute('data-pro'), dn = parseInt(el.getAttribute('data-dni'), 10) || 30;
                    var u = null; ucty.forEach(function (q) { if (q.id === id) u = q; });
                    x.ask('Prodloužit Pro účtu ' + (u ? u.name : id) + ' o ' + (dn >= 360 ? 'rok' : 'měsíc') + '?').then(function (ok) {
                        if (!ok) return;
                        api('/owner/tarif', { method: 'POST', body: { id: id, tarif: 'pro', dni: dn } }).then(function (r) {
                            if (!r.ok) { x.sayFail(r, 'tarif'); return; }
                            _cache = null; if (plati('kalendar')) viewKalendar(b);
                        });
                    });
                });
            });
        });
    }

    // ---- ZÁLOHA SERVERU -----------------------------------------------------------------------
    function viewZaloha(b) {
        var x = X(); styly();
        var h = [x.hlava('Záloha celého serveru', 'Stáhne všechny firmy, členství, účty (bez hesel), zakázky, body (do 20 000), zprávy, objednávky, vzkazy a deník jako jeden soubor JSON. Nic se na serveru nemění.')];
        h.push('<button type="button" class="btn btn-primary" id="agvp-zal" style="width:100%;">Stáhnout zálohu teď</button>');
        h.push('<div class="agv-p" id="agvp-zal-st" style="margin-top:10px;">' + (_zaloha ? 'Poslední záloha v tomhle běhu: ' + esc(cas(_zaloha.ts)) + ' · ' + _zaloha.kb + ' kB' : '') + '</div>');
        h.push('<div class="agv-p" style="margin-top:12px;">Obnova ze souboru není v appce — záloha je pojistka pro případ, že by databáze na Cloudflare zmizela; obnovit ji jde importem do D1 (viz cloud/README.md).</div>');
        b.innerHTML = h.join('');
        x.wireZpet(b);
        b.querySelector('#agvp-zal').addEventListener('click', function () {
            var btn = this, st = b.querySelector('#agvp-zal-st');
            btn.disabled = true; btn.textContent = 'Stahuji…';
            api('/owner/export', { timeoutMs: 120000 }).then(function (r) {
                btn.disabled = false; btn.textContent = 'Stáhnout zálohu teď';
                if (!r.ok) { x.sayFail(r, 'záloha'); return; }
                var txt = JSON.stringify(r.data);
                var kb = Math.round(txt.length / 1024);
                var d = new Date(), nazev = 'qtrig-zaloha-' + d.toISOString().slice(0, 10) + '.json';
                var pocty = Object.keys(r.data.tabulky || {}).map(function (k) { return k + ' ' + r.data.tabulky[k].length; }).join(', ');
                _zaloha = { ts: Date.now(), kb: kb };
                st.textContent = 'Staženo: ' + kb + ' kB · ' + pocty;
                ulozSoubor(nazev, txt, 'application/json');
            });
        });
    }
    // sdílení / stažení souboru — Web Share s files (iOS) a záloha přes <a download>
    function ulozSoubor(nazev, txt, typ) {
        try {
            var blob = new Blob([txt], { type: typ });
            var f = null;
            try { f = new File([blob], nazev, { type: typ }); } catch (e) { f = null; }
            if (f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
                navigator.share({ files: [f], title: nazev })['catch'](function () { stahni(blob, nazev); });
                return;
            }
            stahni(blob, nazev);
        } catch (e) { swallow(e, 'ulozSoubor'); }
    }
    function stahni(blob, nazev) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = nazev; document.body.appendChild(a); a.click();
        setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) { swallow(e, 'stahni'); } }, 4000);
    }

    // ---- POHLED OČIMA ÚČTU ------------------------------------------------------------------
    // Ne skutečná impersonace (přepínat cizí stav v telefonu by rozbilo vlastní data):
    // karta, která říká, co ten člověk má a vidí — tarif, role a oprávnění v každém
    // prostoru, které nástroje používá, na jakém telefonu, co mu padá, co dostal za vzkazy.
    function pohled(id) {
        _pohledId = id; _pohled = null;
        var go = function () { try { AGVlastnik.open(); AGVlastnik.jdi('pohled'); } catch (e) { swallow(e, 'pohled'); } };
        go();
    }
    function viewPohled(b) {
        var x = X(); styly();
        if (!_pohledId) { jdi(''); return; }
        if (!_pohled) {
            x.cekam(b, 'Skládám pohled účtu…');
            api('/owner/ucty/' + encodeURIComponent(_pohledId) + '/pohled').then(function (r) {
                if (!plati('pohled')) return;
                if (!r.ok) { x.sayFail(r, 'pohled'); jdi(''); return; }
                _pohled = r.data; viewPohled(b);
            });
            return;
        }
        var d = _pohled, u = d.ucet || {};
        var reg = [];
        try { reg = (window.AGReg && AGReg.all) ? AGReg.all() : []; } catch (e) { reg = []; }
        var proN = reg.filter(function (t) { return t.pro && !t.hidden; }).length, volN = reg.filter(function (t) { return !t.pro && !t.hidden; }).length;
        var h = [x.hlava('Očima účtu: ' + (u.name || u.code), 'Co tenhle člověk v appce má a vidí. Nic se tím nemění.')];
        h.push('<div class="agvp-tiles">' + tile(u.tarifPlati ? 'Pro' : 'Základ', u.tarifPlati ? (u.tarif_do ? 'do ' + datum(u.tarif_do) : 'navždy') : 'tarif') +
            tile(u.tarifPlati ? (volN + proN) : volN, 'nástrojů vidí odemčených') + tile(u.tarifPlati ? 0 : proN, 'zamčených') + '</div>');
        h.push('<div class="agv-p">Kód <b>' + esc(u.code) + '</b> · založen ' + datum(u.created) + ' · poslední přihlášení ' + esc(pred(u.last_login)) + (u.disabled ? ' · <b style="color:#e2685f">ZABLOKOVÁN</b>' : '') + (u.note ? '<br>Poznámka: ' + esc(u.note) : '') + '</div>');
        h.push('<div class="agv-sec">Kde je a jakou má roli</div>');
        (d.clenstvi || []).forEach(function (c) {
            var p = c.perms || {};
            var zak = Object.keys(p).filter(function (k) { return p[k] === false || (p[k] && p[k][c.role] === false); });
            h.push('<div class="agvp-row"><span class="tx"><b>' + esc(c.vlastni ? 'vlastní prostor' : (c.nazev || '?')) + (c.kod ? ' (' + esc(c.kod) + ')' : '') + '</b><small>role ' + esc(c.role) + (c.archiv ? ' · odešel (archiv)' : '') + (c.blokovan ? ' · zablokován' : '') + (c.frozen ? ' · firma zmrazená' : '') +
                (zak.length ? ' · zakázáno: ' + esc(zak.join(', ')) : '') + '</small></span><span class="r">' + esc(pred(c.lastLogin)) + '</span></div>');
        });
        h.push('<div class="agv-sec">Co za 30 dní používá</div>');
        if (!(d.nastroje || []).length) h.push('<div class="agv-p">Žádný nástroj (nebo starší appka, která užívání neposílá).</div>');
        (d.nastroje || []).slice(0, 15).forEach(function (n) {
            var t = null; try { t = AGReg.get(n.k); } catch (e) { t = null; }
            h.push('<div class="agvp-row"><span class="tx"><b>' + esc(t && t.vl ? t.vl : n.k) + '</b>' + (t && t.pro ? '<small>Pro nástroj</small>' : '') + '</span><span class="r">' + n.n + '×<br>' + esc(pred(n.last)) + '</span></div>');
        });
        if ((d.zarizeni || []).length) h.push('<div class="agv-sec">Zařízení</div><div class="agv-p">' + d.zarizeni.map(function (z) { return esc(z.dev) + ' (' + esc(pred(z.last)) + ')'; }).join(' · ') + '</div>');
        h.push('<div class="agv-sec">Co mu padá (' + (d.chyby || []).length + ')</div>');
        if (!(d.chyby || []).length) h.push('<div class="agv-p">Žádná chyba od tohohle člověka.</div>');
        (d.chyby || []).slice(0, 8).forEach(function (c) {
            h.push('<div class="agvp-log">' + esc(c.msg || '') + '<small>' + esc((c.src || '').split('/').pop()) + (c.line ? ':' + c.line : '') + ' · ' + esc(c.ver || '') + ' · ' + esc(cas(c.ts)) + '</small></div>');
        });
        if ((d.vzkazy || []).length) {
            h.push('<div class="agv-sec">Vzkazy od tebe</div>');
            d.vzkazy.forEach(function (v) { h.push('<div class="agvp-log">' + esc(v.txt) + '<small>' + esc(cas(v.ts)) + ' · ' + (v.read_ts ? 'přečteno ' + esc(cas(v.read_ts)) : 'nepřečteno') + '</small></div>'); });
        }
        h.push('<button type="button" class="btn btn-secondary" id="agvp-poh-lide" style="margin-top:14px;">Zpět do Lidí</button>');
        b.innerHTML = h.join('');
        x.wireZpet(b);
        b.querySelector('#agvp-poh-lide').addEventListener('click', function () { otevri('lide'); });
    }

    // ---- TEČKA „NĚCO ČEKÁ" NA VSTUPECH -----------------------------------------------------
    function badge() {
        if (!isOn()) { odznak(0); return; }
        if (Date.now() - _liteTs < 5 * 60000) { odznak(_lite ? (_lite.zadosti + _lite.zpravy) : 0); return; }
        _liteTs = Date.now();
        api('/owner/prehled?lite=1').then(function (r) {
            if (r.ok && r.data) { _lite = r.data; odznak(_lite.zadosti + _lite.zpravy); }
        });
    }
    function odznak(n) {
        styly();
        ['agv-set-btn', 'agv-tools-btn', 'agv-menu-btn'].forEach(function (id) {
            var el = document.getElementById(id); if (!el) return;
            var b = el.querySelector('.agvp-badge');
            if (!n) { if (b) b.remove(); return; }
            if (!b) { b = document.createElement('span'); b.className = 'agvp-badge'; el.appendChild(b); }
            var t = String(n); if (b.textContent !== t) b.textContent = t;
            b.title = (_lite ? _lite.zadosti + ' žádostí o Pro, ' + _lite.zpravy + ' zpráv' : '');
        });
    }

    // ---- CSV export bodů firmy (pro js/sprava-appky.js) --------------------------------------
    function csv(firma, jobs) {
        var radky = ['zakazka;cislo;kod;Y;X;lat;lng;vyska;presnost;kdo;kdy'];
        (jobs || []).forEach(function (j) {
            (j.points || []).forEach(function (p) {
                var yx = null;
                try { if (window.GeoCore && GeoCore.toSJTSK) yx = GeoCore.toSJTSK(p.lat, p.lng); } catch (e) { yx = null; }
                radky.push([j.name || j.key, p.name || '', p.kod || '', yx ? yx.y.toFixed(2) : '', yx ? yx.x.toFixed(2) : '', p.lat, p.lng, p.vyska != null ? p.vyska : '', p.acc != null ? p.acc : '', p.uname || '', p.ts ? new Date(p.ts).toISOString() : '']
                    .map(function (v) { return String(v == null ? '' : v).replace(/;/g, ','); }).join(';'));
            });
        });
        ulozSoubor('body-' + String(firma.code || firma.name || 'firma').replace(/[^\w-]+/g, '_') + '.csv', '﻿' + radky.join('\r\n'), 'text/csv');
        return radky.length - 1;
    }

    function view(name, b) {
        if (name === 'prehled') { viewPrehled(b); return true; }
        if (name === 'denik') { viewDenik(b); return true; }
        if (name === 'kalendar') { viewKalendar(b); return true; }
        if (name === 'zaloha') { viewZaloha(b); return true; }
        if (name === 'pohled') { viewPohled(b); return true; }
        return false;
    }

    function tik() { try { badge(); } catch (e) { swallow(e, 'tik'); } }
    (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(tik, 4000);
    setTimeout(tik, 1500);

    window.AGVlastnikPlus = { view: view, dashboard: dashboard, items: function () { return []; }, pohled: pohled, csv: csv, ulozSoubor: ulozSoubor, badge: badge };
})();
