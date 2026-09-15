// ===== QTRIG — KDO JSI? Student · Geodet · Firma (ODPOJITELNÁ vrstva) =========
// Neinvazivní. NEEDITUJE logika.js ani grafika.js. Malý eager modul (načítá se
// hned po registru nástrojů), protože na jeho odpověď čeká první spuštění a jeho
// slova čtou jiné moduly už při vykreslení.
//
// PROČ (hodnocení pro studenty, 13. 9. 2026): appka mluví na každého jako na
// geodeta ve firmě — profily práce, „zaměstnanec / admin / kód firmy", nástroje na
// učení až na konci seznamu. Student to nepozná jako appku pro sebe. Jedna otázka
// po vstupu to otočí: kdo řekne Student, dostane skupinu „Učit se" (Trenažér,
// Odhadni to, Cvičné úlohy, Poznávačka, Vzorce) NAHOŘE v Nástrojích a místo
// „firma" se všude v účtech říká „parta" — stejný mechanismus, jiná slova
// (kód party, zakladatel party, člen). Geodet a Firma nechají appku tak, jak je;
// Firma navíc rovnou otevře průvodce založením firmy, když ještě žádná není.
//
// KDY SE PTÁ: při prvním spuštění, hned po bráně a před „Prvním měřením"
// (hák v js/tutorial-pro.js, hledej „student-start"). Kdo appku měl už dřív,
// otázku nedostane — má řádek „Kdo jsi" v Nastavení → Profily a může si vybrat tam.
//
// API pro ostatní moduly:
//   AGProfilOsoby.je('student')  → bool
//   AGProfilOsoby.get()          → 'student' | 'geodet' | 'firma' | null
//   AGProfilOsoby.skupina()      → slova: {n:'Parta', n2:'partu', n3:'party', n6:'partě',
//                                  N:'Parta', clen:'Člen party', spravce:'zakladatel party'}
//                                  — pro ne-studenty táž struktura se slovem firma
//   AGProfilOsoby.open(cb)       → položit otázku (cb po odpovědi / zavření)
//
// Klíč: agProfilOsoby_v1. Odstranění: smaž js/student-start.js + řádek <script>
// v index.html, hák v js/tutorial-pro.js, větev v js/nastroje-ukony.js (poradiSkupin)
// a slova v js/ucty-admin.js (SK()) — všechna místa mají záložní chování bez modulu.
// ================================================================================
(function () {
    'use strict';
    if (window.AGProfilOsoby) return;

    var LS = 'agProfilOsoby_v1', ID = 'ag-ss-modal', STYLE_ID = 'ag-ss-style';
    function t(cs) { try { return window.AGJazyk ? AGJazyk.t(cs) : cs; } catch (e) { return cs; } }
    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'student-start:' + kde); } catch (x) { } }
    function get() { try { var v = localStorage.getItem(LS); return (v === 'student' || v === 'geodet' || v === 'firma') ? v : null; } catch (e) { return null; } }
    function set(v) {
        try { if (v) localStorage.setItem(LS, v); else localStorage.removeItem(LS); } catch (e) { swallow(e, 'ls'); }
        try { window.dispatchEvent(new CustomEvent('ag:profil-osoby', { detail: { v: v } })); } catch (e) { swallow(e, 'event'); }
        syncSettings();
    }
    function je(v) { return get() === v; }

    var FIRMA = { n: 'firma', N: 'Firma', n2: 'firmu', n3: 'firmy', n4: 'firmě', n6: 'firmě', n7: 'firmou', clen: 'Zaměstnanec', clen2: 'zaměstnanec', spravce: 'admin', spravce2: 'správce firmy', kod: 'kód firmy' };
    var PARTA = { n: 'parta', N: 'Parta', n2: 'partu', n3: 'party', n4: 'partě', n6: 'partě', n7: 'partou', clen: 'Člen party', clen2: 'člen party', spravce: 'zakladatel', spravce2: 'zakladatel party', kod: 'kód party' };
    function skupina() { return je('student') ? PARTA : FIRMA; }

    // ---- otázka ----------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style'); st.id = STYLE_ID;
        st.textContent = [
            '#' + ID + ' .ss-grid{display:grid;gap:10px;margin-top:10px;}',
            '#' + ID + ' .ss-b{display:flex;gap:12px;align-items:flex-start;text-align:left;width:100%;box-sizing:border-box;padding:14px 14px;border-radius:14px;border:1px solid var(--glass-border,rgba(255,255,255,.14));background:rgba(255,255,255,.04);color:inherit;font:inherit;cursor:pointer;}',
            '#' + ID + ' .ss-b:active{background:rgba(47,158,116,.18);}',
            '#' + ID + ' .ss-b .ic{flex:0 0 40px;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:rgba(47,158,116,.16);color:var(--accent,#2f9e74);font-size:20px;font-weight:800;}',
            '#' + ID + ' .ss-b h4{margin:0 0 3px;font-size:calc(16px * var(--ag-font-scale,1));}',
            '#' + ID + ' .ss-b p{margin:0;font-size:calc(12.5px * var(--ag-font-scale,1));color:var(--text-muted,#9aa1ac);line-height:1.4;}',
            '#' + ID + ' .ss-pozn{font-size:calc(12px * var(--ag-font-scale,1));opacity:.65;margin-top:12px;}'
        ].join('\n');
        document.head.appendChild(st);
    }
    var _cb = null;
    function build() {
        var m = document.getElementById(ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay'; m.id = ID; m.style.zIndex = '199500';
        m.innerHTML = '<div class="modal-content">'
            + '<h3 style="color:var(--accent);margin-top:0;">' + t('Kdo jsi?') + '</h3>'
            + '<p style="font-size:calc(13.5px * var(--ag-font-scale,1));opacity:.8;margin:0;">' + t('Appka se podle toho přerovná. Kdykoli to změníš v Nastavení → Profily.') + '</p>'
            + '<div class="ss-grid">'
            + '<button type="button" class="ss-b" data-v="student"><span class="ic">S</span><span><h4>' + t('Student') + '</h4><p>' + t('Učím se geodézii (škola, kroužek). Nahoře dostanu Trenažér, cvičné úlohy, vzorce a poznávačku. Spolužáci a učitel jsou „parta" — přidám se kódem party, nebo ji založím.') + '</p></span></button>'
            + '<button type="button" class="ss-b" data-v="geodet"><span class="ic">G</span><span><h4>' + t('Geodet') + '</h4><p>' + t('Měřím a vytyčuju v terénu — sám, nebo jako zaměstnanec firmy. Tohle je volba pro většinu lidí. Do firmy se pak přihlásím kódem, který mi dá šéf (nic nezakládám).') + '</p></span></button>'
            + '<button type="button" class="ss-b" data-v="firma"><span class="ic">F</span><span><h4>' + t('Firma') + '</h4><p>' + t('Jsem šéf nebo správce: vedu lidi na zakázkách. Založím firmu, dostanu kód firmy pro kolegy, vidím jejich body a řídím účty a oprávnění.') + '</p></span></button>'
            + '</div>'
            + '<p class="ss-pozn">' + t('Nevíš? Dej Geodet — jde to kdykoli změnit v Nastavení → Profily. Nic z toho nezamyká žádný nástroj, mění se jen pořadí a slova.') + '</p>'
            + '<button type="button" class="btn btn-secondary" style="margin-top:auto;" id="ag-ss-later">' + t('Teď ne') + '</button>'
            + '</div>';
        document.body.appendChild(m);
        m.addEventListener('click', function (e) {
            var b = e.target.closest('button[data-v]'); if (!b) return;
            var v = b.getAttribute('data-v');
            set(v); close();
            try { if (typeof quickToast === 'function') quickToast(v === 'student' ? t('Nastaveno pro studenta — „Učit se" je v Nástrojích nahoře.') : (v === 'firma' ? t('Nastaveno pro firmu.') : t('Nastaveno pro geodeta.'))); } catch (err) { swallow(err, 'toast'); }
            if (v === 'firma') {
                try { if (!(window.AGUcty && AGUcty.getFirm && AGUcty.getFirm())) setTimeout(function () { if (window.AGUctyAdmin && AGUctyAdmin.open) AGUctyAdmin.open(); else if (window.AGLazy && AGLazy.need) AGLazy.need('js/ucty-admin.js', function () { window.AGUctyAdmin && AGUctyAdmin.open(); }); }, 400); } catch (err) { swallow(err, 'firma'); }
            }
            var cb = _cb; _cb = null; if (cb) try { cb(v); } catch (err) { swallow(err, 'cb'); }
        });
        m.querySelector('#ag-ss-later').addEventListener('click', function () { close(); var cb = _cb; _cb = null; if (cb) try { cb(null); } catch (err) { swallow(err, 'cb'); } });
        return m;
    }
    function open(cb) { _cb = cb || null; var m = build(); m.style.display = 'flex'; }
    function close() { var m = document.getElementById(ID); if (m) m.style.display = 'none'; }
    function hotovo() { return !!get(); }

    // ---- řádek v Nastavení → Profily -------------------------------------------------------------
    function injectSettings() {
        var tab = document.getElementById('tab-profily'); if (!tab || document.getElementById('ag-ss-setrow')) return;
        var row = document.createElement('div');
        row.className = 'st-row'; row.id = 'ag-ss-setrow';
        row.innerHTML = '<span class="st-lab">' + t('Kdo jsi') + '<small>' + t('Student dostane „Učit se" nahoře a „partu" místo firmy') + '</small></span>'
            + '<select id="ag-ss-sel" style="width:auto;min-width:150px;max-width:60%;flex:0 0 auto;"><option value="">' + t('— nevybráno —') + '</option><option value="student">' + t('Student') + '</option><option value="geodet">' + t('Geodet') + '</option><option value="firma">' + t('Firma') + '</option></select>';
        tab.appendChild(row);
        row.querySelector('#ag-ss-sel').addEventListener('change', function () { set(this.value || null); });
        syncSettings();
    }
    function syncSettings() { var s = document.getElementById('ag-ss-sel'); if (s) s.value = get() || ''; }
    function init() { try { injectSettings(); } catch (e) { swallow(e, 'init'); } }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    window.addEventListener('load', function () { setTimeout(init, 400); });
    (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () { try { injectSettings(); } catch (e) { swallow(e, 'tick'); } }, 4000);

    window.AGProfilOsoby = { get: get, set: set, je: je, skupina: skupina, open: open, close: close, hotovo: hotovo };
})();
