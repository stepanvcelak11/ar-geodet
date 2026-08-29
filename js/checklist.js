// ===== AR Geodet — RANNÍ CHECKLIST „Co s sebou" (ODPOJITELNÁ vrstva) ============
// Balicí seznam, který se sám přizpůsobí dnešní práci a dnešnímu počasí:
//   • ZÁKLAD (vždy): nabíječka, powerbanka, vesta, blok…
//   • PODLE TYPU PRÁCE zakázky (agWorkProfile::<pid> z js/tools-simple.js):
//     vytyčování → kolíky, hřeby, sprej; pokládka → lať, klín, křída;
//     katastr → mezníky, GP v mobilu; kontrola/monitoring → hřeby, čísla epoch.
//   • PODLE POČASÍ z poslední cache js/pocasi.js (agWeatherCache_v1) — mráz
//     (náhradní baterie, protože kapacita v mrazu padá a telefon se vypne),
//     déšť (pytlík na telefon, pláštěnka), vedro (voda, čepice, krém),
//     vítr (zátěž na stativ), bouřka (výtyčku do auta).
//   • PODLE STAVU ZAKÁZKY: čeká-li vytyčovací seznam nebo epocha k přeměření,
//     připomene, co k tomu patří.
// Odškrtání se pamatuje na den a zakázku; vlastní položky si uživatel přidá.
//
// Neinvazivní: NEEDITUJE logika.js/grafika.js — čte jen localStorage a globály.
// Vstup: dlaždice „Co s sebou" v Nástrojích (Pomůcky). API: window.agOpenChecklist().
// Odstranění: smaž js/checklist.js + řádek <script> v index.html a přegeneruj sw.js.
// ================================================================================
(function () {
    'use strict';
    if (window.__agChecklistInit) return;
    window.__agChecklistInit = true;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"/><rect x="4" y="6" width="16" height="15" rx="2"/><path d="m8.5 12 1.8 1.8 3.5-3.6M8.5 17.5h7"/></svg>';
    var STYLE_ID = 'ag-cl-style';
    var LS_STATE = 'agChecklistState_v1';   // { '<pid>|<YYYY-MM-DD>': {key:1} }
    var LS_CUSTOM = 'agChecklistCustom_v1'; // ['vlastní položka', …]
    var PROF_PREFIX = 'agWorkProfile::';

    function esc(s) { return (window.AG && AG.esc) ? AG.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(m) { try { return (window.AG && AG.toast) ? AG.toast(m) : (typeof quickToast === 'function' ? quickToast(m) : agInfo(m)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'checklist:toast'); } }
    function pid() { try { return localStorage.getItem('arActiveProjectId') || 'default'; } catch (e) { return 'default'; } }
    function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function stateKey() { return pid() + '|' + today(); }

    // ---- seznamy ----------------------------------------------------------------------
    var BASE = [
        { k: 'nabijecka', t: 'Powerbanka + kabel', why: 'AR a GPS sežerou baterii za 2–3 h' },
        { k: 'vesta', t: 'Reflexní vesta', why: 'u komunikace povinná' },
        { k: 'pasmo', t: 'Pásmo / svinovací metr', why: 'kontrolní oměrné se dělají pásmem, ne GPS' },
        { k: 'blok', t: 'Blok a fixa', why: 'když telefon zmokne nebo zmrzne' },
        { k: 'doklady', t: 'Průkaz ÚOZI / oprávnění', why: 'kontrola na cizím pozemku' }
    ];
    var BY_PROFILE = {
        vytycovani: [
            { k: 'koliky', t: 'Kolíky / hřeby + palice', why: 'vytyčené body je nutné stabilizovat' },
            { k: 'sprej', t: 'Značkovací sprej + kříž', why: 'značení na asfaltu a betonu' },
            { k: 'vytycovaci_vykres', t: 'Vytyčovací výkres (i v mobilu)', why: 'kontrola čísel a kót proti projektu' },
            { k: 'vytyc_protokol', t: 'Podklad pro protokol o vytyčení', why: 'předání stavbě podpisem na místě' }
        ],
        pokladka: [
            { k: 'lat', t: 'Lať / nivelační lať', why: 'kontrola výšky vrstvy nezávisle na GPS' },
            { k: 'klin', t: 'Klín / sklonoměrná pomůcka', why: 'ověření příčného sklonu' },
            { k: 'krida', t: 'Křída nebo sprej na asfalt', why: 'zápis odchylky přímo do vrstvy' },
            { k: 'projekt_vrstvy', t: 'Skladba vrstev a tolerance', why: 'kolik cm smí chybět, se hádat nedá' }
        ],
        katastr: [
            { k: 'mezniky', t: 'Mezníky / plastové značky', why: 'stabilizace lomových bodů' },
            { k: 'gp', t: 'Geometrický plán a náčrt v mobilu', why: 'kontrola stavu v terénu proti mapě' },
            { k: 'krumpac', t: 'Rýč / krumpáč', why: 'osazení mezníku a hledání starých značek' },
            { k: 'detektor', t: 'Detektor kovů (pokud máš)', why: 'hledání zarostlých hřebů a trubek' }
        ],
        kontrola: [
            { k: 'hreby', t: 'Hřeby + značky na epochy', why: 'body monitoringu musí zůstat identické' },
            { k: 'protokol_min', t: 'Předchozí epocha (čísla a výšky)', why: 'porovnání se dělá proti minulé epoše' },
            { k: 'foto', t: 'Fotoaparát / čistý telefon na foto', why: 'dokumentace závady musí být čitelná' }
        ],
        univerzal: []
    };

    // ---- počasí → doplňky --------------------------------------------------------------
    function weather() {
        try {
            var c = JSON.parse(localStorage.getItem('agWeatherCache_v1'));
            if (!c || !c.data) return null;
            if (Date.now() - c.t > 18 * 3600 * 1000) return { stale: true, data: c.data, t: c.t };
            return { stale: false, data: c.data, t: c.t };
        } catch (e) { return null; }
    }
    // dnešní extrémy z hodinové řady (jen hodiny do konce dne)
    function todayWx(w) {
        if (!w || !w.data) return null;
        var out = { tmin: null, tmax: null, rain: false, storm: false, wind: 0, gust: 0 };
        var end = new Date(); end.setHours(23, 59, 59, 0);
        var endS = Math.floor(end.getTime() / 1000), nowS = Math.floor(Date.now() / 1000) - 3600;
        var hs = w.data.hourly || [];
        hs.forEach(function (h) {
            if (h.t == null || h.t < nowS || h.t > endS) return;
            if (h.temp != null) {
                if (out.tmin == null || h.temp < out.tmin) out.tmin = h.temp;
                if (out.tmax == null || h.temp > out.tmax) out.tmax = h.temp;
            }
            if ((h.prob != null && h.prob >= 50) || (h.precip != null && h.precip >= 0.5)) out.rain = true;
            if (h.code != null && h.code >= 95) out.storm = true;
            if (h.wind != null && h.wind > out.wind) out.wind = h.wind;
            if (h.gusts != null && h.gusts > out.gust) out.gust = h.gusts;
        });
        // když už je večer a hodiny nejsou, vezmi dnešní denní řádek
        if (out.tmax == null && w.data.daily && w.data.daily.length) {
            var d = w.data.daily[0];
            out.tmin = d.tmin; out.tmax = d.tmax;
            if (d.pprob != null && d.pprob >= 50) out.rain = true;
            if (d.wmax != null) out.wind = d.wmax;
        }
        // UV z aktuálních dat appka nemá → vedro poznáme z teploty
        return out;
    }
    function weatherItems(wx) {
        var out = [];
        if (!wx) return out;
        if (wx.tmin != null && wx.tmin <= 3) {
            out.push({ k: 'w_mraz_bat', t: 'Náhradní nabitá baterie / powerbanka v kapse u těla', why: 'v mrazu klesá kapacita a telefon se vypne i na 40 %' });
            out.push({ k: 'w_mraz_ruk', t: 'Rukavice na dotykový displej', why: 'v rukavicích se AR neovládá' });
        }
        if (wx.tmin != null && wx.tmin <= -3) out.push({ k: 'w_mraz_kolik', t: 'Vrták / sekáč místo kolíků', why: 'promrzlou zem kolíkem neprorazíš' });
        if (wx.rain) {
            out.push({ k: 'w_dest_sac', t: 'Průhledný sáček / obal na telefon', why: 'kapky na displeji rozhodí dotyk i AR' });
            out.push({ k: 'w_dest_plast', t: 'Pláštěnka nebo nepromokavá bunda', why: 'dnes má pršet' });
            out.push({ k: 'w_dest_hadr', t: 'Utěrka na objektiv', why: 'kapka na čočce = rozmazaná AR i fotodokumentace' });
        }
        if (wx.storm) out.push({ k: 'w_bourka', t: 'Plán, kam s výtyčkou při bouřce', why: 'výtyčka i stativ jsou hromosvod — do auta a přečkat' });
        if (wx.tmax != null && wx.tmax >= 27) {
            out.push({ k: 'w_voda', t: 'Voda (2 l a víc)', why: 'nad 27 °C se pije podstatně víc' });
            out.push({ k: 'w_cepice', t: 'Čepice + opalovací krém', why: 'celý den na otevřeném prostoru' });
            out.push({ k: 'w_stin', t: 'Něco na zastínění displeje', why: 'na prudkém slunci displej neuvidíš' });
        }
        if ((wx.gust || wx.wind) >= 40) out.push({ k: 'w_vitr', t: 'Zátěž / šňůry na stativ', why: 'v nárazech nad 40 km/h stativ padá a výtyčka se neudrží svisle' });
        return out;
    }

    // ---- stav zakázky → doplňky ---------------------------------------------------------
    function projectItems() {
        var out = [];
        function raw(suffix) {
            var v = null;
            try { if (typeof getStoredData === 'function') v = getStoredData(suffix); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'checklist:raw'); }
            if (v == null) { try { v = localStorage.getItem(pid() + '_' + suffix); } catch (e2) { window.AG && AG.swallow && AG.swallow(e2, 'checklist:raw'); } }
            return v;
        }
        // vytyčování: kolik vlastních bodů ještě není odškrtnuto jako vytyčené
        // (arStakeout12 je MAPA id → {t,acc} už hotových bodů, ne seznam úkolů)
        try {
            var staked = JSON.parse(raw('arStakeout12') || 'null') || {};
            var nStaked = 0, id;
            for (id in staked) { if (Object.prototype.hasOwnProperty.call(staked, id)) nStaked++; }
            var nCustom = null;
            try {
                if (typeof stakeoutCandidates === 'function') nCustom = stakeoutCandidates().length;
            } catch (e1) { window.AG && AG.swallow && AG.swallow(e1, 'checklist:raw'); }
            if (nCustom == null) {
                var arr = JSON.parse(raw('arCustomPoints12') || 'null');
                if (Array.isArray(arr)) nCustom = arr.length;
            }
            if (nCustom != null && nCustom - nStaked > 0) {
                out.push({ k: 'p_stakeout', t: 'Vytyčovací seznam: ' + (nCustom - nStaked) + ' bodů neodškrtnuto', why: 'vezmi stabilizaci (kolíky/hřeby) aspoň na tolik bodů' });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'checklist:raw'); }
        // monitoring: existují sledované body → jde se na epochu
        try {
            var ep = JSON.parse(raw('agEpochy_v1') || 'null');
            if (ep && Array.isArray(ep.items) && ep.items.length) {
                out.push({ k: 'p_epocha', t: 'Monitoring: ' + ep.items.length + ' sledovaných bodů — vezmi čísla minulé epochy', why: 'epocha se měří na TÉŽ body, jinak je porovnání bezcenné' });
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'checklist:raw'); }
        return out;
    }

    // ---- stav odškrtání ------------------------------------------------------------------
    function loadState() {
        try { var o = JSON.parse(localStorage.getItem(LS_STATE)); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
    }
    function saveState(o) {
        // ukliď staré dny (drž jen 7 posledních klíčů)
        try {
            var keys = Object.keys(o);
            if (keys.length > 7) { keys.sort(); keys.slice(0, keys.length - 7).forEach(function (k) { delete o[k]; }); }
            localStorage.setItem(LS_STATE, JSON.stringify(o));
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'checklist:saveState'); }
    }
    function checked() { var s = loadState(); return s[stateKey()] || {}; }
    function setChecked(k, on) {
        var s = loadState(), d = s[stateKey()] || {};
        if (on) d[k] = 1; else delete d[k];
        s[stateKey()] = d;
        saveState(s);
    }
    function loadCustom() { try { var a = JSON.parse(localStorage.getItem(LS_CUSTOM)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function saveCustom(a) { try { localStorage.setItem(LS_CUSTOM, JSON.stringify(a)); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'checklist:saveCustom'); } }

    function profileId() {
        var id = null;
        try { id = localStorage.getItem(PROF_PREFIX + pid()); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'checklist:profileId'); }
        return (id && BY_PROFILE[id]) ? id : 'univerzal';
    }
    var PROF_LABEL = { univerzal: 'Univerzální', vytycovani: 'Vytyčování', pokladka: 'Pokládka / vrstvy', katastr: 'Katastr a mapování', kontrola: 'Kontrola a monitoring' };

    function buildGroups() {
        var prof = profileId();
        var w = weather(), wx = todayWx(w);
        var g = [];
        g.push({ title: 'Základ', items: BASE });
        if (BY_PROFILE[prof] && BY_PROFILE[prof].length) g.push({ title: 'Pro ' + (PROF_LABEL[prof] || prof).toLowerCase(), items: BY_PROFILE[prof] });
        var wi = weatherItems(wx);
        if (wi.length) {
            var sub = [];
            if (wx.tmin != null) sub.push(Math.round(wx.tmin) + '–' + Math.round(wx.tmax) + ' °C');
            if (wx.rain) sub.push('déšť');
            if (wx.storm) sub.push('bouřka');
            if ((wx.gust || wx.wind) >= 40) sub.push('vítr ' + Math.round(wx.gust || wx.wind) + ' km/h');
            g.push({ title: 'Kvůli počasí', sub: sub.join(' · ') + (w && w.stale ? ' (starší data)' : ''), items: wi });
        } else if (!w) {
            g.push({ title: 'Kvůli počasí', sub: 'nemám stažené počasí — otevři nástroj Počasí a seznam se doplní', items: [] });
        }
        var pi = projectItems();
        if (pi.length) g.push({ title: 'K téhle zakázce', items: pi });
        var cu = loadCustom();
        if (cu.length) g.push({ title: 'Moje položky', items: cu.map(function (t, i) { return { k: 'c_' + i, t: t, custom: true }; }) });
        return g;
    }

    // ---- UI -------------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent =
            '#ag-cl-modal .ag-cl-prog{background:var(--bg-input,rgba(255,255,255,.06));border-radius:10px;padding:9px 12px;margin:8px 0 12px;font-size:.95em;}' +
            '#ag-cl-modal .ag-cl-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.12);margin-top:6px;overflow:hidden;}' +
            '#ag-cl-modal .ag-cl-bar i{display:block;height:100%;background:#34d399;transition:width .2s;}' +
            '#ag-cl-modal h4{margin:14px 0 4px;font-size:.98em;}' +
            '#ag-cl-modal h4 small{display:block;font-weight:400;color:var(--text-muted,#9aa1ac);font-size:.85em;}' +
            '#ag-cl-modal label.ag-cl-it{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.03);margin-bottom:6px;}' +
            '#ag-cl-modal label.ag-cl-it input{margin-top:3px;flex:0 0 auto;width:20px;height:20px;}' +
            '#ag-cl-modal label.ag-cl-it.on{opacity:.5;}' +
            '#ag-cl-modal label.ag-cl-it.on b{text-decoration:line-through;}' +
            '#ag-cl-modal .ag-cl-it b{display:block;font-weight:600;}' +
            '#ag-cl-modal .ag-cl-it small{color:var(--text-muted,#9aa1ac);font-size:.85em;}' +
            '#ag-cl-modal .ag-cl-del{background:none;border:none;color:var(--text-muted,#9aa1ac);font-size:1.15em;padding:0 4px;}' +
            '#ag-cl-modal .ag-cl-note{color:var(--text-muted,#9aa1ac);font-size:.82em;line-height:1.45;margin-top:10px;}' +
            // Seznam bývá přes 700 px vysoký (základ + profil + počasí + zakázka + vlastní),
            // ale .modal-content má overflow:hidden → konec seznamu se nedal odškrtnout.
            // Tělo proto scrolluje samo (stejně jako v brifink.js / denik-dne.js).
            '#ag-cl-modal .modal-content{display:flex;flex-direction:column;}' +
            '#ag-cl-modal h3{flex:none;}' +
            '#ag-cl-modal #ag-cl-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;padding-right:6px;}' +
            // Patička v jedné řadě — .btn je jinak width:100% s margin-top:10px.
            '#ag-cl-modal .ag-cl-foot{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;flex:none;}' +
            '#ag-cl-modal .ag-cl-foot .btn{flex:1 1 0;min-width:96px;margin:0;min-height:44px;}' +
            'body.ag-glove #ag-cl-modal .ag-cl-foot .btn{min-height:52px;}';
        document.head.appendChild(s);
    }
    function ensureModal() {
        var m = document.getElementById('ag-cl-modal');
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = 'ag-cl-modal';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h3 style="color:var(--accent);margin-top:0;">' + ICON + ' Co s sebou</h3>' +
            '  <div id="ag-cl-body"></div>' +
            '  <div class="ag-cl-foot">' +
            '    <button type="button" class="btn btn-secondary" id="ag-cl-add">Přidat položku</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-cl-reset">Odškrtnout vše</button>' +
            '    <button type="button" class="btn btn-secondary" id="ag-cl-close">Zavřít</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#ag-cl-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.querySelector('#ag-cl-add').addEventListener('click', addCustom);
        m.querySelector('#ag-cl-reset').addEventListener('click', function () {
            var s = loadState(); delete s[stateKey()]; saveState(s); render(); toast('Seznam vyčištěn.');
        });
        var body = m.querySelector('#ag-cl-body');
        body.addEventListener('change', function (e) {
            var cb = e.target;
            if (!cb || cb.type !== 'checkbox') return;
            setChecked(cb.getAttribute('data-k'), cb.checked);
            render();
        });
        body.addEventListener('click', function (e) {
            var d = e.target.closest ? e.target.closest('.ag-cl-del') : null;
            if (!d) return;
            e.preventDefault();
            var ix = parseInt(d.getAttribute('data-ix'), 10);
            var cu = loadCustom();
            if (isFinite(ix) && ix >= 0 && ix < cu.length) { cu.splice(ix, 1); saveCustom(cu); render(); }
        });
        return m;
    }
    function addCustom() {
        function go(v) {
            v = String(v || '').trim().slice(0, 60);
            if (!v) return;
            var cu = loadCustom(); cu.push(v); saveCustom(cu); render();
        }
        try {
            if (typeof window.agPrompt === 'function') {
                window.agPrompt({ title: 'Vlastní položka', message: 'Co si ještě přidat do seznamu?', placeholder: 'Např. klíč od brány', okText: 'Přidat' })
                    .then(function (v) { if (v) go(v); });
                return;
            }
        } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'checklist:go'); }
        var t = prompt('Položka:');
        if (t) go(t);
    }

    function render() {
        var body = document.getElementById('ag-cl-body');
        if (!body) return;
        var groups = buildGroups(), ch = checked();
        var total = 0, done = 0;
        groups.forEach(function (g) { g.items.forEach(function (it) { total++; if (ch[it.k]) done++; }); });
        var pct = total ? Math.round(done / total * 100) : 0;
        var h = '<div class="ag-cl-prog"><b>' + done + ' / ' + total + '</b> hotovo' +
            (done === total && total ? ' — můžeš vyrazit ✅' : '') +
            '<div class="ag-cl-bar"><i style="width:' + pct + '%;"></i></div></div>';
        groups.forEach(function (g) {
            h += '<h4>' + esc(g.title) + (g.sub ? '<small>' + esc(g.sub) + '</small>' : '') + '</h4>';
            if (!g.items.length) return;
            g.items.forEach(function (it) {
                var on = !!ch[it.k];
                h += '<label class="ag-cl-it' + (on ? ' on' : '') + '">' +
                    '<input type="checkbox" data-k="' + esc(it.k) + '"' + (on ? ' checked' : '') + '>' +
                    '<span style="flex:1;"><b>' + esc(it.t) + '</b>' + (it.why ? '<small>' + esc(it.why) + '</small>' : '') + '</span>' +
                    (it.custom ? '<button type="button" class="ag-cl-del" data-ix="' + it.k.slice(2) + '" aria-label="Smazat">×</button>' : '') +
                    '</label>';
            });
        });
        h += '<div class="ag-cl-note">Seznam se skládá podle typu práce zakázky (změníš ho v Nástrojích → jednoduchý režim) a podle posledního staženého počasí. ' +
            'Odškrtání platí na dnešní den a tuhle zakázku — ráno je seznam znovu prázdný.</div>';
        body.innerHTML = h;
    }

    function open() {
        var m = ensureModal();
        m.style.display = 'flex';
        render();
    }

    // ---- registrace dlaždice --------------------------------------------------------------
    var _regTries = 0;
    function register() {
        if (typeof window.agRegisterFieldTool === 'function') {
            window.agRegisterFieldTool({ id: 'checklist', label: 'Co s sebou', icon: ICON, cat: 'Pomůcky', onClick: open, order: 10 });
            return;
        }
        if (_regTries++ < 20) setTimeout(register, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
    else register();

    window.agOpenChecklist = open;
})();
