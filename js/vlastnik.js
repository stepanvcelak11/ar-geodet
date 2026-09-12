// ===== QTRIG — REŽIM VLASTNÍKA APLIKACE (ODPOJITELNÁ vrstva) ===============
// Jedno zvláštní přihlášení rovnou na úvodní bráně: vlastník (vývojář) aplikace se
// odemkne KLÍČEM (OWNER_KEY ze serveru), dostane VŠECHNA oprávnění bez ohledu na
// firmy a role a v „Více" mu přibude jediný vchod do vývojářských nástrojů —
// KONZOLE VLASTNÍKA.
//
// ⚠ PROČ TENHLE MODUL VZNIKL: klíč konzole se dosud dal zadat jen tlačítkem
//   v Nastavení → Údržba, jenže TO SE UKÁZALO JEN TOMU, KDO KLÍČ UŽ ULOŽENÝ MĚL
//   (viz injectSettings v js/sprava-appky.js a js/zpetna-vazba.js). Slepice a
//   vejce — kdo klíč v telefonu neměl, neměl ho ani kam napsat. Odsud pramenilo
//   „klíč mi nefunguje". Vstup je proto na BRÁNĚ i na přihlašovací obrazovce
//   (byť skrytý, viz níž) a hlášky říkají přesně, co je špatně (403 = jiná
//   hodnota, 503 = na serveru žádný klíč není, 404 = starý worker, 0 = síť).
//
// ⚠ O PŘÍSTUPU KE CIZÍM DATŮM POŘÁD ROZHODUJE SERVER. Klíč se ověřuje dotazem na
//   /owner/firms a bez správné hodnoty vrátí server 403, i kdyby si někdo příznak
//   v telefonu podvrhl. Příznak `agVlastnik_v1` odemyká jen UI TOHOTO telefonu
//   (dlaždice, záložky, nástroje) — tedy data, která v tom telefonu stejně už
//   leží. Nic cizího se tím neotevře.
//
// REŽIM VLASTNÍKA ZKRATUJE CELOU VRSTVU ÚČTŮ: brána se neukáže, přihlašovací
//   obrazovka taky ne a AGUcty.can() vrací vždy true. Firma se nezakládá ani
//   nepřepisuje — kdo měl na zařízení firmu, najde ji po ukončení režimu
//   nedotčenou (tři místa v js/ucty.js označená komentářem „režim vlastníka").
//
// ⚠⚠ 8. 9. 2026 — VSTUP JE NOVE V KLASICKEM PRIHLASENI, NE V DLOUHEM STISKU.
//   Do teto chvile se rezim otviral DLOUHYM STISKEM ZNAKU APPKY na brane a pak
//   branu i prihlaseni UPLNE PRESKAKOVAL. Uzivatel si na to 8. 9. 2026 stezoval
//   dvema vetami naraz: "musim se nejak prihlasovat specialne pres podrzeni ty
//   ikony" a "aby se tam pri kazdem spusteni zobrazovalo prihlaseni, coz tam
//   vubec momentalne neni". Obe stiznosti mely tutez pricinu.
//   Ted je vlastnik OBYCEJNE PRIHLASENI: do pole "kod uctu" (na brane) nebo
//   "Jmeno" (na prihlasovaci obrazovce firmy) se napise VLASTNIK, do hesla klic
//   OWNER_KEY. Odchyt je v CAPTURE fazi kliku na cele obrazovce — diky tomu se
//   nemusi sahat do obsluh v js/ucty.js a kdyz se jmeno nerovna VLASTNIK, klik
//   projde dal beze zmeny. Navenek to porad vypada jako bezne prihlaseni, takze
//   prani z 30. 8. 2026 ("na uvodni obrazovce nema stat nic o rezimu pro
//   vyvojare") plati dal — jen uz to neni skryte gesto, ale jmeno a heslo.
(function () {
    'use strict';
    if (window.AGVlastnik) return;

    var LS_KEY = 'agFbKey_v1';        // tentýž klíč jako schránka a Správa aplikace
    var LS_ON = 'agVlastnik_v1';      // příznak režimu na TOMTO zařízení
    var MODAL_ID = 'agv-modal';
    var STYLE_ID = 'agv-style';
    var API_FALLBACK = 'https://ar-geodet-api.ar-geodet.workers.dev';
    var HOLD_MS = 1600;               // jak dlouho drzet znak appky, nez se vstup otevre
    var VERIFY_GAP = 6 * 3600000;     // jak casto se klic potichu preveri na serveru
    var LS_VERIF = 'agVlastnikOveren_v1';

    // Konzole je jedno okno s nekolika pohledy: '' = rozcestnik, 'flags' = vypinac
    // modulu, 'errors' = chyby od lidi, 'usage' = zebricek nastroju. Zamerne jedno
    // okno: druhy modal nad modalem se na telefonu spatne zaviral a pod nim zustaval
    // otevreny prvni.
    var _view = '', _load = null, _pick = null, _dni = 14;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M14.7 6.3a5 5 0 0 0 6 6l-9.9 9.9a2.1 2.1 0 0 1-3 0l-3-3a2.1 2.1 0 0 1 0-3z"/><circle cx="18" cy="6" r="3"/></svg>';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'vlastnik:' + kde); } catch (x) { } }
    function esc(s) {
        if (window.AG && AG.esc) return AG.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function agAlert(t, m) {
        try { if (typeof window.agAlert === 'function') return window.agAlert({ title: t, message: m }); } catch (e) { swallow(e, 'agAlert'); }
        try { agInfo(t + (m ? '\n\n' + String(m).replace(/<[^>]*>/g, '') : '')); } catch (e) { swallow(e, 'agAlert2'); }
    }
    function ask(m) {
        try { if (typeof window.agAsk === 'function') return window.agAsk(m); } catch (e) { swallow(e, 'ask'); }
        return Promise.resolve(window.confirm(m));
    }

    // ---- klíč a příznak ---------------------------------------------------------
    function key() { try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; } }
    function setKey(k) {
        try { if (k) localStorage.setItem(LS_KEY, k); else localStorage.removeItem(LS_KEY); } catch (e) { swallow(e, 'setKey'); }
    }
    function isOn() { try { return localStorage.getItem(LS_ON) === '1'; } catch (e) { return false; } }
    function setOn(v) {
        try { if (v) localStorage.setItem(LS_ON, '1'); else localStorage.removeItem(LS_ON); } catch (e) { swallow(e, 'setOn'); }
        znackaSw(v);
    }
    // Značka pro service worker „tenhle telefon je vlastníka" — sw.js nevidí do
    // localStorage, Cache Storage je jediné společné místo. Bez ní by brzda vydání
    // (sw.js: vydanoProOstatni) držela starou verzi i vlastníkovi.
    function znackaSw(v) {
        try {
            if (!('caches' in window)) return;
            if (v) caches.open('ag-vlastnik').then(function (c) { return c.put('/vlastnik', new Response('1')); }).catch(function (e) { swallow(e, 'znackaSw'); });
            else caches.delete('ag-vlastnik').catch(function (e) { swallow(e, 'znackaSw'); });
        } catch (e) { swallow(e, 'znackaSw'); }
    }
    // číslo verze téhle appky (?v=NNN u css/tokens.css píše scripts/gen_sw_assets.py = SHELL_CACHE)
    function verzeAppky() {
        try {
            var l = document.querySelector('link[href*="tokens.css?v="]');
            var m = l && /v=(\d+)/.exec(l.getAttribute('href'));
            return m ? parseInt(m[1], 10) : null;
        } catch (e) { return null; }
    }

    function base() {
        try {
            var u = window.AGUcty;
            if (u && typeof u.apiUrl === 'function') return u.apiUrl();
            if (u && u.DEFAULT_API) return u.DEFAULT_API;
        } catch (e) { swallow(e, 'base'); }
        return API_FALLBACK;
    }
    // Vlastní fetch s hlavičkou X-Owner-Key (AGUcty.cloudFetch ji předat neumí).
    // Timeout ze stejného důvodu jako u schránky: na „mrtvém, ale otevřeném" spoji
    // visí dotaz jinak minuty a drží rádio ve vysokém příkonu.
    function api(path, k, timeoutMs, opts) {
        opts = opts || {};
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var to = null, p;
        try {
            p = fetch(base() + path, {
                method: opts.method || 'GET',
                headers: { 'Content-Type': 'application/json', 'X-Owner-Key': (k == null ? key() : k) },
                body: opts.body != null ? JSON.stringify(opts.body) : undefined,
                signal: ctrl ? ctrl.signal : undefined
            });
            if (ctrl) to = setTimeout(function () { try { ctrl.abort(); } catch (e) { swallow(e, 'abort'); } }, timeoutMs || 15000);
        } catch (e) {
            if (to) clearTimeout(to);
            return Promise.resolve({ ok: false, status: 0, data: null });
        }
        return p.then(function (r) {
            if (to) { clearTimeout(to); to = null; }
            return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
        }).catch(function () {
            if (to) clearTimeout(to);
            return { ok: false, status: 0, data: null };
        });
    }

    // Co je na klíči špatně, řečeno lidsky. Tohle je jádro celé opravy: dosud
    // uživatel viděl jen „Špatný klíč" i tehdy, když na serveru VŮBEC ŽÁDNÝ NEBYL.
    function proc(r) {
        if (r.ok) return '';
        if (r.status === 0) return 'Server neodpověděl. Zkontroluj připojení a zkus to znovu. (Když je síť v pořádku: klíč s háčkem, čárkou nebo emoji hlavička neunese — nastav OWNER_KEY jen z písmen a–z, číslic a pomlček.)';
        // ⚠ 503 znamená DVĚ věci, ne jednu: buď na serveru OWNER_KEY vůbec není, NEBO je
        // kratší než 24 znaků — pak ho cloud/worker.js:263 (ownerOk) bere, jako by tam
        // nebyl. Kdo měl dosud klíč kratší, dostane po nasazení tuhle hlášku a bez té
        // druhé věty by marně přepisoval hodnotu, která „přece je nastavená".
        if (r.status === 503) {
            // Worker v13+ říká, KTERÝ z obou stavů to je (`ownerKey` v těle odpovědi:
            // 'chybi' | 'kratky'). Starší worker pole nemá → obecná hláška zůstává.
            // ⚠⚠ „NASTAVOVAL JSEM HO NĚKOLIKRÁT" (12. 9. 2026): uživatel klíč ukládal
            //   na dash.cloudflare.com jako proměnnou typu TEXT — a každé nasazení
            //   workeru z GitHubu (`wrangler deploy`) takové proměnné přepíše, takže
            //   byl zase pryč. Odteď to drží `keep_vars` ve wrangler.toml a klíč jde
            //   dát i do secretů repozitáře (deploy-worker.yml ho sám zapíše). Ale
            //   hláška to musí říct, jinak bude klíč ukládat počtvrté stejně.
            var st = r.data && r.data.ownerKey;
            var cesta = 'dash.cloudflare.com → Workers &amp; Pages → <b>ar-geodet-api</b> → Settings → Variables and Secrets';
            if (st === 'kratky') return 'Klíč <b>OWNER_KEY</b> na serveru JE, ale má <b>míň než 24 znaků</b> — tak krátký worker odmítá (dal by se vystřílet). Nastav delší: ' + cesta + ' → OWNER_KEY, typ <b>Secret</b>, a klepni na <b>Deploy</b>. Pak sem napiš tutéž hodnotu.';
            if (st === 'chybi') return 'Na serveru teď <b>žádný OWNER_KEY není</b>. Jestli jsi ho už ukládal: uložený jako typ <b>Text</b> ho každé nasazení z GitHubu smazalo. Ulož ho znovu jako typ <b>Secret</b> (' + cesta + ', pak <b>Deploy</b>) — nebo jednou provždy jako secret <b>OWNER_KEY</b> v GitHubu (repozitář → Settings → Secrets and variables → Actions), odkud si ho nasazení samo zapíše. Aspoň 24 znaků, jen a–z, číslice, pomlčky.';
            return 'Na serveru žádný použitelný klíč není. Buď <b>OWNER_KEY</b> nastavený vůbec není, nebo je <b>kratší než 24 znaků</b> — takový server odmítá, protože se dá vystřílet. Nastav ho na ' + cesta + ' → secret <b>OWNER_KEY</b> (aspoň 24 znaků, typ Secret, pak Deploy). Pak sem napiš tutéž hodnotu.';
        }
        if (r.status === 403) return 'Tenhle klíč serveru nesedí. Musí to být PŘESNĚ hodnota, která je na Cloudflare uložená jako secret <b>OWNER_KEY</b> — rozlišuje velká a malá písmena a vadí i mezera na konci.';
        // 429 = brzda proti hádání klíče v cloud/worker.js (ownerGate: deset pokusů
        // z adresy za hodinu). Bez téhle větve by se to schovalo pod obecné „Server
        // odpověděl chybou 429" a vypadalo by to jako výpadek — přitom stačí počkat.
        if (r.status === 429) return 'Moc pokusů o klíč, zkus to za hodinu. Server po deseti chybných klíčích z jedné adresy na hodinu zavře — ne kvůli tobě, ale kvůli hádání zvenčí.';
        if (r.status === 404) return 'Server tuhle funkci nezná — běží na něm starší verze. Nasaď aktuální cloud/worker.js (wrangler deploy).';
        return 'Server odpověděl chybou ' + r.status + '.';
    }

    // ---- přihlášení vlastníka na bráně / přihlašovací obrazovce -----------------
    function loginOverlay() {
        return document.getElementById('ag-gate') || document.getElementById('ag-login') || null;
    }

    // ---- PRIHLASENI VLASTNIKA V KLASICKEM FORMULARI --------------------------------
    // Jmeno se porovnava BEZ DIAKRITIKY a bez ohledu na velikost pismen: klic se
    // opisuje na mobilu, kde prvni pismeno naskoci velke samo a ceska klavesnice
    // umi podstrcit "VLASTNÍK". Dve varianty schvalne — obe si clovek vybavi.
    var JMENA = ['VLASTNIK', 'VYVOJAR'];
    function normJm(v) {
        v = String(v == null ? '' : v).trim().toUpperCase();
        try { v = v.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { swallow(e, 'normJm'); }
        return v;
    }
    function jeJmenoVlastnika(v) { return JMENA.indexOf(normJm(v)) !== -1; }

    // Ktera pole na TEHLE obrazovce nesou jmeno, heslo a hlasku. Brana (#ag-gate)
    // a prihlaseni do firmy (#ag-login) maji jina id, jinak se chovaji stejne.
    function poleFormulare(ov, btn) {
        if (!ov || !btn) return null;
        if (ov.id === 'ag-gate') {
            if (btn.id !== 'agg-go') return null;
            return {
                jm: ov.querySelector('#agg-code'), heslo: ov.querySelector('#agg-pass'),
                err: ov.querySelector('#agg-err'), btn: btn
            };
        }
        if (ov.id === 'ag-login') {
            if (!btn.closest || !btn.closest('.agl-pinbox')) return null;
            return {
                jm: ov.querySelector('.agl-name'), heslo: ov.querySelector('.agl-pin'),
                err: ov.querySelector('.agl-err'), btn: btn
            };
        }
        return null;
    }

    var _odemykam = false;
    function odemkni(p) {
        if (_odemykam) return;
        var k = ((p.heslo && p.heslo.value) || '').trim();
        // ⚠ HTTP HLAVIČKA UNESE JEN ASCII. Klíč s háčkem, čárkou nebo emoji fetch()
        //   odmítne SYNCHRONNĚ (TypeError) ještě před odesláním — catch to proměnil
        //   na status 0 a hláška lhala „server neodpověděl", přitom síť byla v pořádku
        //   (hlášení uživatele 11. 9. 2026). Říct to rovnou a přesně.
        if (k && !/^[ -~]+$/.test(k)) {
            p.err.innerHTML = 'Klíč obsahuje znak, který HTTP hlavička neunese (háček, čárka, emoji…). ' +
                'Nastav OWNER_KEY jen z písmen a–z, číslic a pomlček, aspoň 24 znaků.';
            return;
        }
        if (!k) { p.err.innerHTML = 'Do hesla napi\u0161 kl\u00ed\u010d vlastn\u00edka (OWNER_KEY).'; return; }
        _odemykam = true;
        if (p.btn) p.btn.disabled = true;
        p.err.innerHTML = 'Ov\u011b\u0159uji na serveru\u2026';
        api('/owner/firms', k).then(function (r) {
            _odemykam = false;
            if (p.btn) p.btn.disabled = false;
            if (!r.ok) {
                // ⚠ OFFLINE SE VLASTNIK MUSI DOSTAT DOVNITR TAKY. V terenu bez signalu
                //   by ho jinak vlastni appka zamkla ven. Klic se porovna proti tomu,
                //   co je z minula ulozeny; server si ho stejne overi sam, jakmile je
                //   signal (overKlic nize) — a pri 403 rezim vypne.
                // ⚠ NEJEN status 0. Server umí být nedostupný i tak, že odpoví
                //   (proxy hotelové wifi, 404 ze starého workeru, 5xx při výpadku).
                //   Jediná odpověď, která znamená "tenhle klíč NEPLATÍ", je 403 —
                //   u všech ostatních se vlastník pustí dovnitř proti klíči, který
                //   už na zařízení uložený je (ten se v minulosti ověřit musel).
                //   Kdyby přece jen neplatil, overKlic() režim do šesti hodin vypne.
                if (r.status !== 403 && key() && k === key()) { setOn(true); vstup(); return; }
                p.err.innerHTML = proc(r);
                return;
            }
            setKey(k); setOn(true);
            vstup();
            setTimeout(nabidniFaceId, 900);
        });
    }

    // ---- FACE ID PRO VLASTNÍKA (12. 9. 2026) -------------------------------------
    // Uživatel: „když appku vypnu a znovu se chci přihlásit, nenabízí mi to vlastníka
    // — heslo je fakt dlouhé a nechci ho psát pokaždé, byl bych rád za Face ID."
    // Stejná mechanika jako u běžného účtu (WebAuthn, platform authenticator —
    // js/ucty.js `bio`), jen pod pseudo-účtem BIO_ID. Ověřuje TELEFON; klíč vlastníka
    // zůstává uložený v agFbKey_v1 (server ho dál ověřuje v overKlic).
    var BIO_ID = 'vlastnik', LS_BIO_ASK = 'agVlastnikBioAsk_v1';
    function bio() { return (window.AGUcty && AGUcty.bio) || null; }
    function bioJe() { var b = bio(); try { return !!(b && b.supported() && b.available(BIO_ID)); } catch (e) { return false; } }
    function nabidniFaceId() {
        var b = bio(); if (!b) return;
        try {
            if (!b.supported() || b.available(BIO_ID)) return;
            var t = parseInt(localStorage.getItem(LS_BIO_ASK) || '0', 10);
            if (t && Date.now() - t < 30 * 864e5) return;
        } catch (e) { return; }
        var ov = document.createElement('div');
        ov.className = 'modal-overlay'; ov.style.cssText = 'display:flex;z-index:1000000;';
        ov.innerHTML = '<div class="modal-content" style="max-width:420px;">' +
            '<h3 style="color:#d4a02c;margin-top:0;">Příště jako vlastník přes Face ID?</h3>' +
            '<p style="font-size:calc(13px * var(--ag-font-scale,1));line-height:1.5;">Klíč vlastníka je dlouhý. Když to zapneš, na přihlašovací obrazovce přibude zlaté tlačítko ' +
            '<b>Vlastník — odemknout Face ID</b> a klíč už psát nemusíš. Ověřuje samotný telefon (Face ID / Touch ID / kód); klíč zůstává uložený jen v tomhle zařízení.</p>' +
            '<div style="display:flex;gap:8px;margin-top:6px;">' +
            '<button type="button" class="btn btn-secondary" id="agv-bio-no" style="flex:1;">Teď ne</button>' +
            '<button type="button" class="btn btn-primary" id="agv-bio-yes" style="flex:1;">Zapnout</button></div></div>';
        document.body.appendChild(ov);
        var zavri = function () { try { localStorage.setItem(LS_BIO_ASK, String(Date.now())); } catch (e) { swallow(e, 'bioAsk'); } ov.remove(); };
        ov.querySelector('#agv-bio-no').onclick = zavri;
        ov.querySelector('#agv-bio-yes').onclick = function () {
            var btn = this; btn.disabled = true; btn.textContent = 'Ověřuji…';
            // MUSÍ běžet z gesta (klik) — Safari jinak vyhodí NotAllowedError
            b.enroll({ id: BIO_ID, name: 'Vlastník aplikace' }).then(function (ok) {
                zavri();
                toast(ok ? 'Face ID pro vlastníka zapnuto.' : 'Telefon to nepovolil — zůstává klíč.');
            });
        };
    }
    // Zlaté tlačítko na bráně / přihlášení: ověřit telefonem a vstoupit jako vlastník.
    function injectBio() {
        var ov = loginOverlay();
        var b = document.getElementById('agv-bio-btn');
        if (!ov || !isOn() || !bioJe()) { if (b) b.remove(); return; }
        if (b && ov.contains(b)) return;
        if (b) b.remove();
        var card = ov.querySelector('.agl-card'); if (!card) return;
        b = document.createElement('button');
        b.id = 'agv-bio-btn'; b.type = 'button'; b.className = 'agl-btn';
        b.style.cssText = 'background:rgba(212,160,44,0.16);border:1px solid #d4a02c;color:#d4a02c;margin:4px 0 6px;';
        b.innerHTML = '<span style="display:inline-block;width:18px;height:18px;vertical-align:-3px;margin-right:6px;">' + ICON + '</span>Vlastník — odemknout Face ID';
        b.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            b.disabled = true; b.textContent = 'Ověřuji…';
            bio().verify(BIO_ID).then(function (ok) {
                b.disabled = false;
                b.innerHTML = '<span style="display:inline-block;width:18px;height:18px;vertical-align:-3px;margin-right:6px;">' + ICON + '</span>Vlastník — odemknout Face ID';
                if (!ok) { toast('Ověření telefonem neprošlo — zkus znovu, nebo napiš klíč (jméno VLASTNIK).'); return; }
                vstup();
            });
        }, true);
        // nahoru pod čip firmy / pod nadpis — první věc, na kterou se dá klepnout
        var kotva = card.querySelector('.agl-users, .agl-projpick, .agl-pinbox, #agg-show-join, .agg-box');
        if (kotva) card.insertBefore(b, kotva); else card.appendChild(b);
    }
    function toast(m) { try { if (typeof window.quickToast === 'function') window.quickToast(m); else agAlert('Vlastník', m); } catch (e) { swallow(e, 'toast'); } }

    // Pustit vlastnika do appky POTE, co prosel prihlasenim. Rozdil proti enter()
    // je jediny: rekne se to vrstve uctu, aby branu uz nevracela (gateCheck).
    function vstup() {
        try { if (window.AGUcty && AGUcty.ownerEnter) AGUcty.ownerEnter(); } catch (e) { swallow(e, 'vstup:ucty'); }
        enter();
    }

    // Odchyt kliku na tlacitko "Prihlasit" v CAPTURE fazi. Bezi driv nez obsluha
    // v js/ucty.js, takze kdyz je ve jmene VLASTNIK, klik se tam vubec nedostane
    // a nezapocita se jako spatne heslo do brzdy proti hadani.
    function hookForm() {
        var ov = loginOverlay();
        if (!ov || ov.getAttribute('data-agv') === '1') return;
        ov.setAttribute('data-agv', '1');
        ov.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('button') : null;
            if (!btn) return;
            var p = poleFormulare(ov, btn);
            if (!p || !p.jm || !p.heslo || !p.err) return;
            if (!jeJmenoVlastnika(p.jm.value)) return;
            e.preventDefault(); e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            odemkni(p);
        }, true);
    }
    // Karta se NEPŘEKRESLUJE na místě staré (to by sebralo obsluhu tlačítek brány),
    // ale položí se do TÉHOŽ overlaye vedle ní a stará se jen schová. Díky tomu na
    // ni platí hotové styly `#ag-gate .agl-btn` i `#ag-login .agl-btn`.
    function login() {
        var ov = loginOverlay();
        if (!ov) { promptKey(); return; }          // appka už běží → jen zeptat na klíč
        if (ov.querySelector('.agv-card')) return; // už je otevřené
        injectStyles();
        var stara = ov.querySelector('.agl-card');
        if (stara) stara.style.display = 'none';

        var card = document.createElement('div');
        card.className = 'agl-card agv-card';
        card.innerHTML =
            '<div class="agv-mark">' + ICON + '</div>' +
            '<div class="agl-logo" style="font:800 19px/1.2 var(--font-display,system-ui);">Vlastník aplikace</div>' +
            '<div class="agl-firm">Zvláštní přihlášení pro toho, kdo aplikaci dělá. Odemkne všechny nástroje bez ohledu na firmy a role a přidá konzoli s přehledem celé aplikace.</div>' +
            '<input type="password" class="agv-inp" id="agv-key" placeholder="Klíč vlastníka" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">' +
            '<div class="agl-err" id="agv-err"></div>' +
            '<button type="button" class="agl-btn" id="agv-go">Odemknout</button>' +
            '<button type="button" class="agl-ghost" id="agv-back">Zpět na běžné přihlášení</button>' +
            '<div class="agv-note">Klíč je secret <b>OWNER_KEY</b> workeru na Cloudflare. Uloží se jen do tohohle telefonu.</div>';
        ov.appendChild(card);

        var inp = card.querySelector('#agv-key');
        var err = card.querySelector('#agv-err');
        var go = card.querySelector('#agv-go');
        var busy = false;

        // Uložený klíč se předvyplní: kdo stojí u brány s odemčeným telefonem, ten
        // si ho stejně přečte v úložišti — zato je hned vidět, že tam nějaký JE.
        if (key()) inp.value = key();
        setTimeout(function () { try { inp.focus(); } catch (e) { swallow(e, 'focus'); } }, 60);

        function zpet() {
            card.remove();
            if (stara) stara.style.display = '';
        }
        function submit() {
            if (busy) return;
            var k = (inp.value || '').trim();
            if (!k) { err.innerHTML = 'Napiš klíč.'; return; }
            busy = true; go.disabled = true; err.innerHTML = 'Ověřuji na serveru…';
            api('/owner/firms', k).then(function (r) {
                busy = false; go.disabled = false;
                if (!r.ok) { err.innerHTML = proc(r); return; }
                setKey(k); setOn(true);
                err.innerHTML = '';
                enter();
            });
        }
        go.addEventListener('click', submit);
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
        card.querySelector('#agv-back').addEventListener('click', zpet);
    }

    // Pustit vlastníka do aplikace: sundat bránu i přihlašovací obrazovku, srovnat
    // oprávnění (teď už can() vrací všude true) a přeskočit úvodní kartu — brána
    // byla vstupní obrazovkou, druhé „Spustit" by bylo klepnutí navíc.
    function enter() {
        try {
            var g = document.getElementById('ag-gate'); if (g) g.remove();
            var l = document.getElementById('ag-login'); if (l) l.remove();
        } catch (e) { swallow(e, 'enter:overlay'); }
        try { document.documentElement.classList.remove('ag-prelock'); } catch (e) { swallow(e, 'enter:prelock'); }
        try { if (window.AGUcty && AGUcty.applyPerms) AGUcty.applyPerms(); } catch (e) { swallow(e, 'enter:perms'); }
        try { if (!localStorage.getItem('arSurveyor')) localStorage.setItem('arSurveyor', 'Vývojář'); } catch (e) { swallow(e, 'enter:jmeno'); }
        injectMenu();
        // ⚠ 31. 8. 2026 — DŘÍV tu byla podmínka „jen když je zrovna vidět úvodní
        // obrazovka". Ta je zrušená (jediný vchod je přihlášení), takže by neplatila
        // nikdy a po odemčení klíčem by vlastník koukal na nenastartovanou appku.
        // Rozhoduje jediné, na čem záleží: jestli appka UŽ BĚŽÍ.
        try {
            if (!(document.body && document.body.classList.contains('app-started'))) {
                var tries = 0;
                (function go() {
                    if (document.body && document.body.classList.contains('app-started')) return;
                    if (typeof window.startAppFromWelcome === 'function') {
                        try { window.startAppFromWelcome(); } catch (e) { swallow(e, 'enter:start'); }
                        return;
                    }
                    if (tries++ < 40) setTimeout(go, 150);
                })();
            }
        } catch (e) { swallow(e, 'enter:start'); }
        try { if (typeof window.quickToast === 'function') quickToast('Režim vlastníka zapnut — vidíš úplně všechno.'); } catch (e) { swallow(e, 'enter:toast'); }
        setTimeout(open, 500);
    }

    // Změna klíče za běhu (appka už jede, brána není).
    function promptKey() {
        var k = window.prompt('Klíč vlastníka (OWNER_KEY ze serveru):', key());
        if (k == null) return;
        k = k.trim();
        if (!k) { setKey(''); setOn(false); injectMenu(); return agAlert('Klíč smazán', 'Režim vlastníka je vypnutý.'); }
        api('/owner/firms', k).then(function (r) {
            if (!r.ok) return agAlert('Klíč nesedí', proc(r));
            setKey(k); setOn(true); injectMenu();
            try { if (window.AGUcty && AGUcty.applyPerms) AGUcty.applyPerms(); } catch (e) { swallow(e, 'promptKey:perms'); }
            agAlert('Hotovo', 'Klíč sedí — režim vlastníka je zapnutý.');
        });
    }

    function leave() {
        ask('Ukončit režim vlastníka? Aplikace se vrátí k běžnému přihlášení. Klíč zůstane uložený.').then(function (ok) {
            if (!ok) return;
            setOn(false);
            try { var b = bio(); if (b && b.forget) b.forget(BIO_ID); } catch (e) { swallow(e, 'leave:bio'); }   // Face ID vlastníka pryč
            close(); injectMenu();
            try { if (window.AGUcty && AGUcty.applyPerms) AGUcty.applyPerms(); } catch (e) { swallow(e, 'leave:perms'); }
            try { if (window.AGUcty && AGUcty.showGate) AGUcty.showGate(); } catch (e) { swallow(e, 'leave:gate'); }
        });
    }

    // ---- konzole ----------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            // karta zvláštního přihlášení (žije uvnitř #ag-gate / #ag-login)
            '.agv-card .agv-mark{width:56px;height:56px;color:var(--accent,#2f9e74);}',
            '.agv-card .agv-mark svg{width:100%;height:100%;display:block;}',
            '.agv-card .agv-inp{box-sizing:border-box;width:250px;text-align:center;border-radius:13px;padding:13px 14px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.06));border:1px solid var(--glass-border,rgba(255,255,255,0.16));',
            '  color:var(--text-color,#e6e8eb);font:600 15px/1.2 var(--font-mono,monospace);letter-spacing:.06em;outline:none;}',
            '.agv-card .agv-inp:focus{border-color:var(--accent,#2f9e74);}',
            '.agv-card .agv-note{max-width:300px;text-align:center;font:500 11.5px/1.5 var(--font-ui,system-ui);',
            '  color:var(--text-muted,#9aa1ac);}',
            '.agv-card .agl-err{max-width:320px;}',
            // ===== SPOLEČNÝ MOTIV OKEN VLASTNÍKA (12. 9. 2026, „ať je to přehledné a hezké") =====
            // Konzole, Lidé a prodej, Správa aplikace i Zprávy od lidí = jedna rodina: zlatá
            // linka nahoře + kicker „Vlastník aplikace", stejné dlaždice čísel, stejné řádky
            // seznamů (karta s okrajem), stejné pilulky tlačítek a stejné nadpisy sekcí.
            // Barva vlastníka je zlatá (#d4a02c) — zelená zůstává pro „v pořádku / aktivní".
            ':root{--agv-gold:#d4a02c;--agv-gold-soft:rgba(212,160,44,.13);--agv-gold-line:rgba(212,160,44,.45);}',
            'body.light-mode{--agv-gold:#9a6d18;--agv-gold-soft:rgba(154,109,24,.12);--agv-gold-line:rgba(154,109,24,.45);}',
            '#agv-modal .modal-content,#ag-pd-modal .modal-content,#ag-sa-modal .modal-content,#ag-fb-inbox .modal-content{box-shadow:inset 0 3px 0 var(--agv-gold);}',
            '#agv-modal .modal-content > h2:first-child::before,#ag-pd-modal .modal-content > h2:first-child::before,#ag-sa-modal .modal-content > h2:first-child::before,',
            '#ag-fb-inbox .modal-content > h2:first-child::before,#ag-fb-inbox .modal-content > h3:first-child::before{content:"Vlastník aplikace";display:block;',
            '  font:700 10px/1 var(--font-ui,system-ui);letter-spacing:.16em;text-transform:uppercase;color:var(--agv-gold);margin:4px 0 6px;}',
            '#agv-modal .modal-content > h2:first-child span,#ag-pd-modal .modal-content > h2:first-child span,#ag-sa-modal .modal-content > h2:first-child span{color:var(--agv-gold) !important;}',
            '#ag-fb-inbox .modal-content > h3:first-child .icon,#ag-fb-inbox .modal-content > h3:first-child span{color:var(--agv-gold) !important;}',
            // dlaždice čísel: jedna podoba (konzole .agvp-t, Lidé .pd-cell, Firmy .sa-cell)
            '#ag-pd-modal .pd-top,#ag-sa-modal .sa-top{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 12px;}',
            '#ag-pd-modal .pd-cell,#ag-sa-modal .sa-cell{padding:10px 6px;border-radius:12px;text-align:center;',
            '  background:var(--glass-bg,rgba(255,255,255,.05));border:1px solid var(--glass-border,rgba(255,255,255,.12));}',
            '#ag-pd-modal .pd-cell b,#ag-sa-modal .sa-cell b{display:block;font:700 calc(20px * var(--ag-font-scale,1))/1.1 var(--font-mono,ui-monospace,monospace);color:var(--text-color,#e6e8eb);}',
            '#ag-pd-modal .pd-cell span,#ag-sa-modal .sa-cell span{display:block;margin-top:3px;font:600 10px/1.2 var(--font-ui,system-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);}',
            '#ag-pd-modal .pd-cell.warn,#ag-sa-modal .sa-cell.warn{border-color:var(--agv-gold);}#ag-pd-modal .pd-cell.warn b,#ag-sa-modal .sa-cell.warn b{color:var(--agv-gold);}',
            '#ag-sa-modal .sa-cell.bad{border-color:#e2685f;}#ag-sa-modal .sa-cell.bad b{color:#e2685f;}',
            // řádky seznamů: karta s okrajem, ne holý řádek
            '#ag-pd-modal .pd-row,#ag-sa-modal .sa-row{gap:11px;padding:10px 12px;margin:0 0 6px;border-radius:12px;',
            '  background:var(--glass-bg,rgba(255,255,255,.04));border:1px solid var(--glass-border,rgba(255,255,255,.1));}',
            '#ag-pd-modal .pd-row.on,#ag-sa-modal .sa-row.on{border-color:var(--agv-gold-line);background:var(--agv-gold-soft);}',
            '#ag-pd-modal .pd-dot,#ag-sa-modal .sa-dot{width:10px;height:10px;opacity:1;}',
            '#ag-pd-modal .pd-dot.pro{background:var(--agv-gold);box-shadow:0 0 8px var(--agv-gold);}',
            '#ag-pd-modal .pd-dot.blok{background:#e2685f;}#ag-pd-modal .pd-dot.ceka{background:#d4a02c;}',
            '#ag-pd-modal .pd-det,#ag-sa-modal .sa-det{margin:-2px 0 10px;padding:10px 12px 12px;border:1px solid var(--agv-gold-line);border-top:0;border-radius:0 0 12px 12px;background:var(--agv-gold-soft);}',
            '#ag-pd-modal .pd-row.on,#ag-sa-modal .sa-row.on{border-bottom-left-radius:0;border-bottom-right-radius:0;margin-bottom:0;}',
            // nadpisy sekcí a tlačítka: jedno písmo, jedna pilulka
            '#ag-pd-modal .pd-lab,#ag-sa-modal .sa-lab,#agv-modal .agv-sec{font:700 10.5px/1 var(--font-ui,system-ui);letter-spacing:.09em;text-transform:uppercase;color:var(--text-muted,#9aa1ac);margin:14px 0 7px;}',
            '#ag-pd-modal .pd-b,#ag-sa-modal .sa-b,#agv-modal .agv-b{border-radius:999px;padding:8px 13px;font:600 12px/1 var(--font-ui,system-ui);}',
            '#ag-pd-modal .pd-tabs{gap:6px;}#ag-pd-modal .pd-tabs button{border-radius:999px;}',
            '#ag-pd-modal .pd-nez{border-radius:14px;}',
            '#ag-pd-modal input[type=search],#ag-sa-modal input[type=search],#ag-pd-modal input[type=text],#ag-sa-modal input[type=text]{border-radius:12px;}',
            // zprávy od lidí: karty jako všude jinde
            '#ag-fb-inbox .ag-fb-msg{border-radius:12px;border:1px solid var(--glass-border,rgba(255,255,255,.1));background:var(--glass-bg,rgba(255,255,255,.04));padding:10px 12px;margin:0 0 8px;}',
            '#ag-fb-inbox .ag-fb-tag.pro{color:var(--agv-gold);}',
            // konzole
            '#' + MODAL_ID + ' .agv-hd{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:12px;margin:0 0 12px;',
            '  background:var(--agv-gold-soft);border:1px solid var(--agv-gold-line);}',
            '#' + MODAL_ID + ' .agv-hd small{display:inline !important;margin:0 0 0 6px !important;}',
            '#' + MODAL_ID + ' .agv-hd b{display:inline !important;}',
            '#' + MODAL_ID + ' .agv-hd > div:first-child{color:var(--agv-gold,#d4a02c) !important;}',
            '#' + MODAL_ID + ' .agv-hd b{display:block;font:700 13px/1.3 var(--font-ui,system-ui);color:var(--agv-gold,#d4a02c);}',
            '#' + MODAL_ID + ' .agv-hd small{display:block;margin-top:2px;font:500 11.5px/1.4 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .agv-sec{font:600 10.5px/1 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);',
            '  text-transform:uppercase;letter-spacing:.06em;margin:16px 0 7px;}',
            '#' + MODAL_ID + ' .agv-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 4px;}',
            '#' + MODAL_ID + ' .agv-it{display:flex;flex-direction:column;align-items:flex-start;gap:9px;width:100%;box-sizing:border-box;text-align:left;min-height:118px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));border:1px solid var(--glass-border,rgba(255,255,255,0.1));',
            '  border-radius:12px;padding:11px 12px;margin:0 0 7px;cursor:pointer;color:var(--text-color,#e6e8eb);}',
            '#' + MODAL_ID + ' .agv-it:active{transform:scale(.99);}',
            '#' + MODAL_ID + ' .agv-it .ic{flex:none;width:36px;height:36px;padding:8px;box-sizing:border-box;border-radius:11px;',
            '  background:var(--agv-gold-soft,rgba(212,160,44,.12));color:var(--agv-gold,#d4a02c);}',
            '#' + MODAL_ID + ' .agv-it .ic svg{width:100%;height:100%;display:block;}',
            '#' + MODAL_ID + ' .agv-it .tx{flex:1;min-width:0;}',
            '#' + MODAL_ID + ' .agv-it .tx b{display:block;font:700 13.5px/1.3 var(--font-ui,system-ui);}',
            '#' + MODAL_ID + ' .agv-it .tx small{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:3px;font:500 11px/1.35 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .agv-it .go{display:none;}',
            '#' + MODAL_ID + ' .agv-it.off{opacity:.45;}',
            '#' + MODAL_ID + ' .agv-st{font:500 12px/1.5 var(--font-mono,monospace);color:var(--text-muted,#9aa1ac);',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));border-radius:11px;padding:9px 11px;word-break:break-word;}',
            '#' + MODAL_ID + ' .agv-st b{color:var(--text-color,#e6e8eb);}',
            '#' + MODAL_ID + ' .agv-st .ok{color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .agv-st .bad{color:#e0574a;}',
            // podpohledy konzole
            '#' + MODAL_ID + ' .agv-back{background:transparent;border:none;color:var(--accent,#2f9e74);',
            '  font:700 13px/1 var(--font-ui,system-ui);padding:2px 0 10px;cursor:pointer;}',
            '#' + MODAL_ID + ' .agv-h2{font:800 17px/1.25 var(--font-display,system-ui);color:var(--text-color,#e6e8eb);margin:0 0 6px;}',
            '#' + MODAL_ID + ' .agv-p{font:500 12.5px/1.55 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);margin:0 0 12px;}',
            '#' + MODAL_ID + ' .agv-p code{font-family:var(--font-mono,monospace);}',
            '#' + MODAL_ID + ' .agv-filtr{display:flex;gap:6px;flex-wrap:wrap;}',
            '#' + MODAL_ID + ' .agv-b{border:1px solid var(--glass-border,rgba(255,255,255,0.16));background:transparent;',
            '  color:var(--text-muted,#9aa1ac);border-radius:9px;padding:7px 11px;font:600 11.5px/1 var(--font-ui,system-ui);cursor:pointer;flex:none;}',
            '#' + MODAL_ID + ' .agv-b.on{border-color:var(--accent,#2f9e74);background:var(--accent-soft,rgba(47,158,116,0.14));color:var(--accent,#2f9e74);}',
            '#' + MODAL_ID + ' .agv-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));margin:0 0 5px;cursor:pointer;}',
            '#' + MODAL_ID + ' .agv-row.off{background:rgba(224,87,74,0.10);}',
            '#' + MODAL_ID + ' .agv-row input{flex:none;margin:0;width:18px;height:18px;}',
            '#' + MODAL_ID + ' .agv-row b{display:block;font:600 12.5px/1.3 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '#' + MODAL_ID + ' .agv-row small{display:block;margin-top:1px;font:500 10.5px/1.2 var(--font-mono,monospace);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .agv-err{border-left:3px solid #e0574a;background:var(--glass-bg,rgba(255,255,255,0.04));',
            '  border-radius:0 10px 10px 0;padding:8px 11px;margin:0 0 7px;}',
            '#' + MODAL_ID + ' .agv-err .hd{display:flex;align-items:center;gap:8px;margin-bottom:3px;}',
            '#' + MODAL_ID + ' .agv-err .hd b{font:800 13px/1 var(--font-display,system-ui);color:#e0574a;}',
            '#' + MODAL_ID + ' .agv-err .fm{font:600 10px/1 var(--font-ui,system-ui);color:#d4a02c;',
            '  background:rgba(212,160,44,0.14);border-radius:999px;padding:3px 7px;}',
            '#' + MODAL_ID + ' .agv-err .dt{margin-left:auto;font:500 10.5px/1 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .agv-err .ms{font:500 12.5px/1.45 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);word-break:break-word;}',
            '#' + MODAL_ID + ' .agv-err .sr{margin-top:3px;font:500 10.5px/1.3 var(--font-mono,monospace);color:var(--text-muted,#9aa1ac);}',
            '#' + MODAL_ID + ' .agv-bar{position:relative;border-radius:9px;overflow:hidden;margin:0 0 5px;',
            '  background:var(--glass-bg,rgba(255,255,255,0.04));}',
            '#' + MODAL_ID + ' .agv-bar .fill{position:absolute;inset:0 auto 0 0;background:var(--accent-soft,rgba(47,158,116,0.18));}',
            '#' + MODAL_ID + ' .agv-bar .tx{position:relative;padding:7px 10px;}',
            '#' + MODAL_ID + ' .agv-bar .tx b{display:block;font:600 12.5px/1.3 var(--font-ui,system-ui);color:var(--text-color,#e6e8eb);}',
            '#' + MODAL_ID + ' .agv-bar .tx small{display:block;margin-top:1px;font:500 10.5px/1.2 var(--font-ui,system-ui);color:var(--text-muted,#9aa1ac);}'
        ].join('');
        document.head.appendChild(st);
    }

    // Co konzole nabízí. `run` se volá až po klepnutí; `lazy` říká, který modul se
    // musí předtím donačíst (js/lazy-load.js) — jinak by tlačítko nic neudělalo.
    function polozky() {
        var P = window.AGVlastnikPlus;
        var plus = (P && P.items) ? P.items() : [];
        return [
            {
                sec: 'Celá aplikace',
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
                t: 'Souhrn dne a kdo je v terénu', d: 'Za 24 h: lidé, body, nové účty, žádosti, chyby; kdo teď měří a kde; komu vyprší Pro',
                lazy: 'js/vlastnik-plus.js', keep: true, run: function () { jdi('prehled'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/></svg>',
                t: 'Všechny firmy', d: 'Kdo aplikaci používá, kolik má míst, žádosti o navýšení, zmrazení a úklid',
                lazy: 'js/sprava-appky.js', run: function () { if (window.AGSprava) AGSprava.open(); else chybi('js/sprava-appky.js'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/><path d="M17 3.5a3 3 0 0 1 0 6"/><path d="M19 13.5a5 5 0 0 1 3 4.5v3"/></svg>',
                t: 'Lidé a prodej Pro', d: 'Každý účet: kde je a co dělá, zapnout Pro, zablokovat; objednávky a platby z banky',
                lazy: 'js/prodej-konzole.js', run: function () { if (window.AGProdej) AGProdej.open(); else chybi('js/prodej-konzole.js'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H7l-3 3z"/></svg>',
                t: 'Zprávy od lidí', d: 'Schránka „Napište mi" — nápady a hlášení chyb od uživatelů',
                lazy: 'js/zpetna-vazba.js', run: function () { if (window.AGZpetna) AGZpetna.inbox(); else chybi('js/zpetna-vazba.js'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9"/></svg>',
                t: 'Stav serveru', d: 'Verze workeru, co má zapnuté a jestli klíč sedí',
                keep: true, run: function () { stav(true); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="22" height="12" rx="6"/><circle cx="8" cy="12" r="3"/></svg>',
                t: 'Vypínač modulů', d: 'Zhasnout rozbitý nástroj všem, bez čekání na novou verzi',
                keep: true, run: function () { jdi('flags'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
                t: 'Chyby od lidí', d: 'Co padá uživatelům v terénu, seřazeno podle četnosti',
                keep: true, run: function () { jdi('errors'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-5 3 3 5-7"/></svg>',
                t: 'Co lidi doopravdy používají', d: 'Žebříček nástrojů napříč všemi firmami — i ty, co nepoužil nikdo',
                keep: true, run: function () { jdi('usage'); }
            },
            {
                sec: 'Tenhle telefon',
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
                t: 'Protokol chyb', d: 'Co se v aplikaci na tomhle zařízení pokazilo',
                run: function () { if (window.agErrLog) agErrLog.show(); else chybi('js/err-log.js'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-5 3 3 5-7"/></svg>',
                t: 'Přehled užívání', d: 'Které nástroje se doopravdy používají a kdy',
                run: function () { if (typeof window.agOpenMojeAktivita === 'function') agOpenMojeAktivita(); else chybi('js/moje-aktivita.js'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
                t: 'Historie aktualizací', d: 'Co přibylo v které verzi',
                run: function () { if (typeof window.agOpenHistorie === 'function') agOpenHistorie(); else chybi('js/historie-aktualizaci.js'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/></svg>',
                t: 'Správci firmy (tenhle telefon)', d: 'Kdo je ve firmě admin a co smí — nastavení uložené jen na tomhle zařízení, ne na serveru',
                lazy: 'js/ucty-admin.js', run: function () { if (window.AGUctyAdmin) AGUctyAdmin.open(); else chybi('js/ucty-admin.js'); }
            },
            {
                sec: 'Vydání',
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/><path d="M4 21h16"/></svg>',
                t: 'Pustit tuhle verzi ostatním', d: 'Ty máš vždy nejnovější; lidem venku se nová verze nainstaluje, až ji tady pustíš',
                lazy: 'js/vlastnik-plus.js', keep: true, run: function () { jdi('vydani'); }
            },
            {
                sec: 'Vlastník plus',
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
                t: 'Deník vlastníka', d: 'Co jsi kdy zapnul, vypnul, smazal a komu — s časem',
                lazy: 'js/vlastnik-plus.js', keep: true, run: function () { jdi('denik'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
                t: 'Kalendář vypršení Pro', d: 'Komu Pro končí tento a příští měsíc, s tlačítkem prodloužit',
                lazy: 'js/vlastnik-plus.js', keep: true, run: function () { jdi('kalendar'); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M6 11l6 6 6-6"/><path d="M4 21h16"/></svg>',
                t: 'Záloha celého serveru', d: 'Všechny firmy, účty a body jako jeden soubor (bez hesel)',
                lazy: 'js/vlastnik-plus.js', keep: true, run: function () { jdi('zaloha'); }
            },
            {
                sec: 'Klíč a režim',
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a5 5 0 0 0 6 6l-9.9 9.9a2.1 2.1 0 0 1-3 0l-3-3a2.1 2.1 0 0 1 0-3z"/><circle cx="18" cy="6" r="3"/></svg>',
                t: 'Změnit klíč vlastníka', d: 'Nový klíč se hned ověří na serveru',
                run: function () { promptKey(); }
            },
            {
                ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
                t: 'Ukončit režim vlastníka', d: 'Vrátí se běžná brána a přihlášení do firmy',
                keep: true, run: leave
            }
        ];
    }
    function chybi(soubor) {
        agAlert('Modul není v aplikaci', 'Chybí <code>' + esc(soubor) + '</code> — buď byl odpojený, nebo se nestihl načíst.');
    }

    function build() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        injectStyles();
        m = document.createElement('div');
        m.className = 'modal-overlay';
        m.id = MODAL_ID;
        m.setAttribute('data-no-i18n', '');
        m.innerHTML =
            '<div class="modal-content">' +
            '  <h2 style="margin-top:0;"><span style="display:inline-block;width:22px;height:22px;vertical-align:-4px;color:var(--accent);">' + ICON + '</span> Konzole vlastníka</h2>' +
            '  <div class="modal-body" id="agv-body"></div>' +
            '</div>';
        document.body.appendChild(m);
        return m;
    }

    // Kazdy pohled ma jine rozumne okno: u chyb je 14 dni akorat, u zebricku
    // nastroju by z nej vypadly ty sezonni, tak se zacina mesicem.
    function jdi(v) {
        _view = v; _load = null; _pick = null;
        if (v === 'errors') _dni = 14;
        if (v === 'usage') _dni = 30;
        render();
    }

    // Spolecna hlavicka podpohledu (nadpis + zpet na rozcestnik).
    function hlava(nadpis, popis) {
        return '<button type="button" class="agv-back" id="agv-zpet">‹ Konzole</button>' +
            '<div class="agv-h2">' + esc(nadpis) + '</div>' +
            (popis ? '<div class="agv-p">' + popis + '</div>' : '');
    }
    function wireZpet(b) {
        var z = b.querySelector('#agv-zpet');
        if (z) z.addEventListener('click', function () { jdi(''); });
    }
    function cekam(b, txt) { b.innerHTML = '<div class="agv-p" style="padding:26px 4px;text-align:center;">' + esc(txt || 'Načítám…') + '</div>'; }

    // ---- pohled: VYPINAC MODULU -------------------------------------------------
    // Seznam nabizi nastroje z registru (js/tools-registry.js), protoze prave ty
    // ma smysl zhasinat. Pole dole bere cokoli — vcetne `js/soubor.js`, cimz se da
    // vypnout cely lazy modul, ktery se pak ani nestahne.
    function viewFlags(b) {
        if (!_load) {
            cekam(b, 'Načítám stav vypínače…');
            _load = 1;
            api('/owner/firms').then(function (r) {
                if (!r.ok) { _load = null; sayFail(r, 'vypínač'); jdi(''); return; }
                _pick = {};
                (((r.data || {}).flags || {}).off || []).forEach(function (x) { _pick[x] = 1; });
                _load = 2;
                render();
            });
            return;
        }
        var reg = [];
        try { if (window.AGReg && AGReg.all) reg = AGReg.all(); } catch (e) { swallow(e, 'reg'); }
        var vyp = Object.keys(_pick || {});
        var h = [hlava('Vypínač modulů',
            'Vypnutý nástroj se lidem přestane nabízet při nejbližším spuštění aplikace. ' +
            'Zapsat sem smí jen tenhle klíč; ostatní ho jen čtou spolu s konfigurací firmy.')];

        h.push('<div class="agv-st" style="margin-bottom:10px;">Vypnuto teď: <b>' + vyp.length + '</b>' +
            (vyp.length ? ' — ' + esc(vyp.join(', ')) : '') + '</div>');

        h.push('<div class="agv-sec">Nástroje z registru</div>');
        if (!reg.length) h.push('<div class="agv-p">Registr nástrojů se nenačetl, použij pole níž.</div>');
        // ⚠ Seskupení PODLE SLOVESA, ne podle `cat` (12. 9. 2026): registr je seřazený po
        //   slovesech, takže kategorie se v seznamu střídaly „Ostatní / Měření / Ostatní…"
        //   a nadpisy lhaly. Sloveso je to, co člověk v seznamu čte.
        var cat = '';
        reg.slice().sort(function (a, b) { return String(a.verb || '').localeCompare(String(b.verb || ''), 'cs'); }).forEach(function (t) {
            var id = t.k;
            if (!id) return;
            var grp = t.verb || 'Ostatní';
            if (grp !== cat) { cat = grp; h.push('<div class="agv-sec">' + esc(cat) + '</div>'); }
            var on = !!(_pick && _pick[id]);
            h.push('<label class="agv-row' + (on ? ' off' : '') + '">' +
                '<input type="checkbox" data-flag="' + esc(id) + '"' + (on ? ' checked' : '') + '>' +
                '<span><b>' + esc(t.vl || id) + '</b><small>' + esc(id) + '</small></span>' +
                '</label>');
        });

        // rucne pridane (soubory, nebo id, ktere v registru nejsou)
        var mimo = vyp.filter(function (x) {
            for (var i = 0; i < reg.length; i++) if (reg[i].k === x) return false;
            return true;
        });
        h.push('<div class="agv-sec">Ručně zadané</div>');
        if (!mimo.length) h.push('<div class="agv-p">Zatím nic. Sem patří třeba <code>js/trenazer.js</code> — takový modul se pak vůbec nestáhne.</div>');
        mimo.forEach(function (x) {
            h.push('<label class="agv-row off"><input type="checkbox" data-flag="' + esc(x) + '" checked>' +
                '<span><b>' + esc(x) + '</b><small>ručně zadané</small></span></label>');
        });
        h.push('<div class="sa-line" style="display:flex;gap:6px;margin-top:8px;">' +
            '<input type="text" id="agv-add" placeholder="id nástroje nebo js/soubor.js" style="flex:1;min-width:80px;margin:0;">' +
            '<button type="button" class="agv-b" id="agv-addb">Přidat</button></div>');

        h.push('<button type="button" class="btn" id="agv-save" style="margin-top:16px;">Uložit vypínač</button>');
        h.push('<button type="button" class="btn btn-secondary" id="agv-none" style="margin-top:8px;">Zapnout zase všechno</button>');
        b.innerHTML = h.join('');
        wireZpet(b);
        Array.prototype.forEach.call(b.querySelectorAll('[data-flag]'), function (el) {
            el.addEventListener('change', function () {
                var id = el.getAttribute('data-flag');
                if (el.checked) _pick[id] = 1; else delete _pick[id];
            });
        });
        var add = b.querySelector('#agv-add');
        b.querySelector('#agv-addb').addEventListener('click', function () {
            var v = (add.value || '').trim();
            if (!v) return;
            _pick[v] = 1; add.value = '';
            render();
        });
        b.querySelector('#agv-save').addEventListener('click', function () { ulozFlags(Object.keys(_pick)); });
        b.querySelector('#agv-none').addEventListener('click', function () { ulozFlags([]); });
    }
    function ulozFlags(list) {
        api('/owner/flags', null, 15000, { method: 'PUT', body: { off: list } }).then(function (r) {
            if (!r.ok) return sayFail(r, 'vypínač');
            // Vlastnik ma videt ucinek hned na svem telefonu, ne az po /config.
            try { if (window.AGFlags) AGFlags.set(list, Date.now()); } catch (e) { swallow(e, 'flags:set'); }
            _load = null;
            agAlert('Uloženo', list.length
                ? 'Vypnuto: <b>' + esc(list.join(', ')) + '</b>.<br><br>Lidem se to projeví, jakmile si aplikace natáhne konfiguraci firmy — u spuštěné appky do minuty, jinak při dalším startu.'
                : 'Vypínač je prázdný, všechno je zase zapnuté.');
            render();
        });
    }

    // ---- pohled: CHYBY OD LIDI ---------------------------------------------------
    function viewErrors(b) {
        if (!_load) {
            cekam(b, 'Načítám chyby ze serveru…');
            _load = 1;
            api('/owner/errors?dni=' + _dni).then(function (r) {
                if (!r.ok) { _load = null; sayFail(r, 'chyby'); jdi(''); return; }
                _load = r.data || { rows: [], total: 0 };
                render();
            });
            return;
        }
        var d = _load, rows = d.rows || [];
        var h = [hlava('Chyby od lidí',
            'Sbírá je <code>js/err-log.js</code> v každém telefonu a jednou za deset minut posílá dál. ' +
            'Chodí jen hláška, soubor, řádek a verze — žádné souřadnice ani data měření.')];
        h.push('<div class="agv-filtr">' +
            [7, 14, 30, 90].map(function (x) {
                return '<button type="button" class="agv-b' + (x === _dni ? ' on' : '') + '" data-dni="' + x + '">' + x + ' dní</button>';
            }).join('') + '</div>');
        h.push('<div class="agv-st" style="margin:8px 0 12px;">Celkem <b>' + (d.total || 0) + '</b> výskytů v <b>' + rows.length + '</b> různých chybách</div>');
        // podle verze appky (návrh „zdravi", 12. 9. 2026): stará verze v telefonech
        // hlásí chyby, které v nové už nejsou — bez tohohle se to nepozná
        if (d.verze && d.verze.length) {
            h.push('<div class="agv-sec">Podle verze appky</div><div class="agv-p" style="margin-bottom:10px;">' +
                d.verze.map(function (v) { return '<b>' + esc(v.ver || '?') + '</b> ' + (v.n || 0) + '× (' + (v.sigs || 0) + ' chyb, ' + (v.firms || 0) + ' firem)'; }).join(' · ') + '</div>');
        }
        if (!rows.length) {
            h.push('<div class="agv-p" style="padding:22px 4px;text-align:center;">Nic nespadlo. Buď je klid, nebo ještě nikdo nemá verzi, která chyby posílá.</div>');
        }
        rows.forEach(function (r) {
            h.push('<div class="agv-err">' +
                '<div class="hd"><b>' + (r.n || 1) + '×</b>' +
                (r.firms > 1 ? '<span class="fm">' + r.firms + ' firmy</span>' : '') +
                '<span class="dt">' + esc(kdy(r.last)) + '</span></div>' +
                '<div class="ms">' + esc(r.msg || '') + '</div>' +
                '<div class="sr">' + esc((r.src || '').split('/').pop() || 'neznámý soubor') +
                (r.line ? ':' + r.line : '') + (r.ver ? ' · ' + esc(r.ver) : '') +
                // Vypnout modul rovnou od chyby (návrh „zdravi") — jen u souborů js/*.js
                (/\.js$/.test((r.src || '').split('/').pop() || '') && !/^(logika|grafika|ucty|vlastnik|licence|pro-zamky)\.js$/.test((r.src || '').split('/').pop())
                    ? ' <button type="button" class="agv-b" data-vyp="js/' + esc((r.src || '').split('/').pop()) + '" style="margin-left:6px;">Vypnout modul</button>' : '') +
                '</div>' +
                '</div>');
        });
        h.push('<button type="button" class="btn btn-secondary" id="agv-err-clr" style="margin-top:16px;">Smazat nasbírané chyby</button>');
        b.innerHTML = h.join('');
        wireZpet(b);
        Array.prototype.forEach.call(b.querySelectorAll('[data-dni]'), function (el) {
            el.addEventListener('click', function () { _dni = parseInt(el.getAttribute('data-dni'), 10) || 14; _load = null; render(); });
        });
        Array.prototype.forEach.call(b.querySelectorAll('[data-vyp]'), function (el) {
            el.addEventListener('click', function () {
                var id = el.getAttribute('data-vyp');
                ask('Vypnout modul ' + id + ' všem lidem? Appka ho při příštím /config zhasne; zapneš ho zase ve Vypínači modulů.').then(function (ok) {
                    if (!ok) return;
                    api('/owner/firms').then(function (r) {
                        var off = (r.ok && r.data && r.data.flags && r.data.flags.off) || [];
                        if (off.indexOf(id) === -1) off.push(id);
                        return api('/owner/flags', null, 15000, { method: 'PUT', body: { off: off } });
                    }).then(function (r2) {
                        if (!r2 || !r2.ok) { sayFail(r2 || { status: 0 }, 'vypínač'); return; }
                        el.textContent = 'Vypnuto'; el.disabled = true;
                    });
                });
            });
        });
        b.querySelector('#agv-err-clr').addEventListener('click', function () {
            ask('Smazat všechny nasbírané chyby ze serveru?').then(function (ok) {
                if (!ok) return;
                api('/owner/errors', null, 15000, { method: 'DELETE' }).then(function (r) {
                    if (!r.ok) return sayFail(r, 'mazání chyb');
                    _load = null; render();
                });
            });
        });
    }

    // ---- pohled: ZEBRICEK NASTROJU ------------------------------------------------
    // Nejcennejsi neni prvni desitka, ale POSLEDNI: nastroje, ktere za mesic
    // neotevrel NIKDO. Proto se dopocitavaji z registru a vypisuji zvlast.
    function viewUsage(b) {
        if (!_load) {
            cekam(b, 'Počítám napříč firmami…');
            _load = 1;
            api('/owner/usage?dni=' + _dni).then(function (r) {
                if (!r.ok) { _load = null; sayFail(r, 'užívání'); jdi(''); return; }
                _load = r.data || { rows: [] };
                render();
            });
            return;
        }
        var d = _load, rows = d.rows || [];
        // jen Pro nástroje (návrh „statistika"): podklad, co v Pro drží a co je mrtvé
        if (_jenPro) rows = rows.filter(function (r) { try { return !!(window.AGReg && AGReg.isPro(r.k)); } catch (e) { return false; } });
        var max = rows.length ? (rows[0].n || 1) : 1;
        var videl = {};
        rows.forEach(function (r) { videl[r.k] = 1; });
        var reg = [];
        try { if (window.AGReg && AGReg.all) reg = AGReg.all(); } catch (e) { swallow(e, 'reg2'); }
        var nikdo = reg.filter(function (t) { return t.k && !videl[t.k] && (!_jenPro || t.pro); });

        var h = [hlava('Co lidi doopravdy používají',
            'Ze záznamů užívání ze všech firem. Ukazuje, co má cenu dolaďovat — a co je mrtvé.')];
        h.push('<div class="agv-filtr">' +
            [7, 30, 90, 365].map(function (x) {
                return '<button type="button" class="agv-b' + (x === _dni ? ' on' : '') + '" data-dni="' + x + '">' + (x === 365 ? 'rok' : x + ' dní') + '</button>';
            }).join('') + '<button type="button" class="agv-b' + (_jenPro ? ' on' : '') + '" id="agv-jenpro">jen Pro</button></div>');
        h.push('<div class="agv-st" style="margin:8px 0 12px;">' + rows.length + ' nástrojů · ' +
            (d.firms || 0) + ' firem · ' + (d.lidi || 0) + ' lidí</div>');
        rows.forEach(function (r) {
            var t = null;
            try { t = window.AGReg && AGReg.get ? AGReg.get(r.k) : null; } catch (e) { t = null; }
            var pct = Math.max(2, Math.round((r.n || 0) / max * 100));
            h.push('<div class="agv-bar"><div class="fill" style="width:' + pct + '%;"></div>' +
                '<div class="tx"><b>' + esc(t && t.vl ? t.vl : r.k) + '</b>' +
                '<small>' + (r.n || 0) + '× · ' + (r.firms || 0) + ' firem · ' + (r.lidi || 0) + ' lidí</small></div></div>');
        });
        h.push('<div class="agv-sec">Neotevřel nikdo (' + nikdo.length + ')</div>');
        if (!nikdo.length) h.push('<div class="agv-p">Každý nástroj z registru někdo za tu dobu použil.</div>');
        else h.push('<div class="agv-p">' + nikdo.map(function (t) { return esc(t.vl || t.k); }).join(' · ') + '</div>');
        b.innerHTML = h.join('');
        wireZpet(b);
        Array.prototype.forEach.call(b.querySelectorAll('[data-dni]'), function (el) {
            el.addEventListener('click', function () { _dni = parseInt(el.getAttribute('data-dni'), 10) || 30; _load = null; render(); });
        });
        var jp = b.querySelector('#agv-jenpro');
        if (jp) jp.addEventListener('click', function () { _jenPro = !_jenPro; render(); });
    }
    var _jenPro = false;

    function kdy(ts) {
        if (!ts) return '—';
        var d = Math.floor((Date.now() - ts) / 864e5);
        if (d <= 0) return 'dnes';
        if (d === 1) return 'včera';
        if (d < 31) return 'před ' + d + ' dny';
        return new Date(ts).toLocaleDateString('cs-CZ');
    }
    // spolecna hlaska pro odmitnuty dotaz (drive jen v sprava-appky.js)
    function sayFail(r, kde) {
        if (r.status === 403 || r.status === 503 || r.status === 404 || r.status === 0)
            return agAlert('Nepovedlo se', proc(r));
        agAlert('Nepovedlo se', esc((r.data && r.data.error) || ('Chyba ' + r.status + ' — ' + kde)));
    }

    function render() {
        var b = document.getElementById('agv-body');
        if (!b) return;
        if (_view === 'flags') return viewFlags(b);
        if (_view === 'errors') return viewErrors(b);
        if (_view === 'usage') return viewUsage(b);
        // pohledy z js/vlastnik-plus.js (souhrn, deník, kalendář, záloha, pohled očima účtu)
        if (_view && window.AGVlastnikPlus && AGVlastnikPlus.view && AGVlastnikPlus.view(_view, b)) return;
        // jeden tichý řádek místo zeleného boxu — kicker „Vlastník aplikace" už je v nadpisu
        var h = ['<div class="agv-hd"><div style="flex:none;width:18px;height:18px;">' + ICON + '</div>' +
            '<div><b>Máš odemčeno všechno</b><small>Oprávnění firem a rolí se na tenhle telefon nevztahují.</small></div></div>'];
        // 12. 9. 2026 (uživatel): místo dlouhého seznamu DLAŽDICE po dvou v každé sekci —
        // stejný princip jako kytička v Nástrojích: přehled na jeden pohled, ne rolování.
        var items = polozky(), otevreno = false;
        items.forEach(function (it, i) {
            if (it.sec) { if (otevreno) h.push('</div>'); h.push('<div class="agv-sec">' + esc(it.sec) + '</div><div class="agv-grid">'); otevreno = true; }
            else if (!otevreno) { h.push('<div class="agv-grid">'); otevreno = true; }
            h.push('<button type="button" class="agv-it" data-i="' + i + '">' +
                '<span class="ic">' + it.ic + '</span>' +
                '<span class="tx"><b>' + esc(it.t) + '</b><small>' + esc(it.d) + '</small></span>' +
                '<span class="go">›</span></button>');
        });
        if (otevreno) h.push('</div>');
        h.push('<div class="agv-sec">Server</div>');
        h.push('<div class="agv-st" id="agv-stav">Zjišťuji…</div>');
        h.push('<button type="button" class="btn btn-secondary" id="agv-close" style="margin-top:16px;">Zavřít</button>');
        b.innerHTML = h.join('');
        // dlaždice souhrnu nahoře (js/vlastnik-plus.js) — vloží se, až modul dojede
        try { if (window.AGVlastnikPlus && AGVlastnikPlus.dashboard) AGVlastnikPlus.dashboard(b); } catch (e) { swallow(e, 'dashboard'); }

        Array.prototype.forEach.call(b.querySelectorAll('.agv-it'), function (el) {
            el.addEventListener('click', function () {
                var it = items[parseInt(el.getAttribute('data-i'), 10)];
                if (!it) return;
                if (it.lazy && !it.ready && window.AGLazy && typeof AGLazy.need === 'function') {
                    el.classList.add('off');
                    AGLazy.need(it.lazy, function () {
                        el.classList.remove('off');
                        if (!it.keep) { close(); vratSeDoKonzole(); }
                        it.run();
                    });
                    return;
                }
                if (!it.keep) { close(); vratSeDoKonzole(); }
                it.run();
            });
        });
        var x = b.querySelector('#agv-close');
        // ZAVŘÍT rukou = konec, žádný návrat (jinak by se konzole za chvíli vrátila sama)
        if (x) x.addEventListener('click', function () { if (_zpetT) { clearInterval(_zpetT); _zpetT = null; } close(); });
        stav(false);
    }

    // Stav serveru: /health řekne verzi a co má zapnuté, /owner/firms ověří klíč.
    // Tohle je diagnostika, kvůli které modul vznikl — na jednom řádku je vidět,
    // jestli je vada v klíči, ve workeru, nebo v síti.
    function stav(hlasite) {
        var el = document.getElementById('agv-stav');
        if (el) el.textContent = 'Zjišťuji…';
        api('/health').then(function (h) {
            return api('/owner/firms').then(function (o) { return { h: h, o: o }; });
        }).then(function (r) {
            var d = r.h.data || {};
            var txt;
            if (!r.h.ok) {
                txt = '<span class="bad">Server neodpovídá</span> (' + esc(String(r.h.status || 'bez signálu')) + ')';
            } else {
                txt = 'Worker <b>v' + esc(String(d.v == null ? '?' : d.v)) + '</b>' +
                    ' · konzole ' + (d.owner ? '<span class="ok">zapnutá</span>' : '<span class="bad">vypnutá</span>') +
                    ' · schránka ' + (d.fb ? '<span class="ok">ano</span>' : '<span class="bad">ne</span>') + '<br>' +
                    'Klíč: ' + (r.o.ok
                        ? '<span class="ok">sedí</span>'
                        : '<span class="bad">' + (r.o.status === 503 ? 'na serveru žádný není' : (r.o.status === 403 ? 'nesedí' : 'chyba ' + esc(String(r.o.status)))) + '</span>');
            }
            if (el) el.innerHTML = txt;
            if (hlasite) agAlert('Stav serveru', txt + (r.o.ok ? '' : '<br><br>' + proc(r.o)));
        });
    }

    function open() {
        if (!isOn()) return login();
        _view = ''; _load = null; _pick = null;
        var m = build();
        m.style.display = 'flex';
        m.classList.add('ag-open');
        render();
    }
    function close() {
        var m = document.getElementById(MODAL_ID);
        if (!m) return;
        m.style.display = 'none';
        m.classList.remove('ag-open');
    }

    // ⚠⚠ NÁVRAT DO KONZOLE PO ZAVŘENÍ NÁSTROJE (3. 9. 2026).
    //   Položka, která otevírá cizí okno (Všechny firmy, Zprávy od lidí, Protokol
    //   chyb…), musí konzoli uklidit z cesty — jenže tím konzole ZMIZELA NADOBRO:
    //   po zavření toho okna zůstala prázdná mapa a k dalšímu pohledu se člověk
    //   dostal jen znovu přes dlouhý stisk znaku a klíč. Hlášeno vlastníkem:
    //   „jakmile tu funkci zavřu, zavřou se mi i všechny ostatní funkce a musím
    //   se znovu přihlašovat, abych je viděl."
    //   Teď se počká, až okno nástroje zmizí, a konzole se otevře zpátky sama.
    //   Pojistky: čeká se nejvýš PAUZA_MAX (ať tik nevisí donekonečna), po ztrátě
    //   režimu vlastníka nebo po objevení přihlašovací brány se návrat zahodí,
    //   a další otevření konzole rukou hlídač taky ukončí.
    var _zpetT = null;
    var PAUZA_MAX = 15 * 60 * 1000;
    function velkeOkno() {
        // „okno nástroje" = viditelný celoobrazovkový překryv, který není konzole.
        // ⚠⚠ NESTAČÍ display: čtyři hlavní modály (Nástroje, Nastavení, Body, Nový bod)
        //   VISÍ V DOM POŘÁD s display:flex kvůli animaci a zavřené je jen posune
        //   `transform: translateX(100%)` mimo obraz (viz .ag-open v css/style.css).
        //   Test podle display je tedy pořád „true" a hlídač návratu by čekal marně.
        //   Rozhoduje proto SKUTEČNÁ POLOHA obsahu: co je odsunuté za okraj, je zavřené.
        var uzly = document.querySelectorAll('.modal-overlay, .ag-dlg-overlay.open, [id$="-modal"], [id$="-overlay"]');
        for (var i = 0; i < uzly.length; i++) {
            var el = uzly[i];
            if (el.id === MODAL_ID) continue;
            var cs;
            try { cs = getComputedStyle(el); } catch (e) { continue; }
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;
            var box = el.querySelector('.modal-content') || el;
            var r = box.getBoundingClientRect();
            if (r.right <= 4 || r.left >= innerWidth - 4) continue;      // odsunuté mimo obraz
            if (r.bottom <= 4 || r.top >= innerHeight - 4) continue;
            if (r.width > innerWidth * 0.5 && r.height > 150) return true;
        }
        return false;
    }
    function vratSeDoKonzole() {
        if (_zpetT) { clearInterval(_zpetT); _zpetT = null; }
        var start = Date.now(), videno = false;
        _zpetT = setInterval(function () {
            try {
                if (!isOn() || Date.now() - start > PAUZA_MAX) { clearInterval(_zpetT); _zpetT = null; return; }
                // brána / přihlášení má přednost — do té se konzole plést nesmí
                if (document.getElementById('ag-login') || document.getElementById('ag-gate')) {
                    clearInterval(_zpetT); _zpetT = null; return;
                }
                var m = document.getElementById(MODAL_ID);
                if (m && m.style.display === 'flex') { clearInterval(_zpetT); _zpetT = null; return; }  // otevřel ji sám
                if (velkeOkno()) { videno = true; return; }
                // okno nástroje bylo vidět a teď je pryč → konzole zpátky.
                // Když se nikdy neukázalo (nástroj okno nemá), vrátíme ji po 3 s.
                if (videno || Date.now() - start > 3000) {
                    clearInterval(_zpetT); _zpetT = null;
                    open();
                }
            } catch (e) { clearInterval(_zpetT); _zpetT = null; swallow(e, 'vlastnik:zpet'); }
        }, 600);
    }

    // ---- vstupy v UI ------------------------------------------------------------
    // 1) VSTUP VLASTNÍKA je v běžném přihlašovacím formuláři — viz hookForm() výš.
    //    (Do 8. 9. 2026 tu byl popis dlouhého stisku znaku appky; gesto je zrušené.)
    // ---- 3) SPRAVA APLIKACE MEZI NASTROJI (8. 9. 2026) -----------------------------
    // Na prani uzivatele: "akorat mezi nastroji uvidim zaroven dalsi nastroje jako
    // rizeni aplikace, rizeni firem, rizeni spravcu, co mi prisli". Konzole zustava
    // (je v ni vypinac modulu, chyby, zebricek), ale ctyri veci, ke kterym se chodi
    // nejcasteji, stoji rovnou v mrizce Nastroju pod vlastni kategorii.
    //
    // ⚠ KATEGORII VYRABI TENHLE MODUL, NENI V index.html. Kdyby v HTML byla,
    //   musela by se schovavat — a js/field-tools.js pri hledani nadpisum
    //   display PREPISUJE (viz applyFilter), takze by se pri psani do hledani
    //   rozsvitila i tomu, kdo vlastnik neni. Kdyz nadpis vyrobime az tady a pri
    //   vypnutem rezimu ho SMAZEME, nema se co rozsvitit.
    var KAT = 'Správa aplikace';
    // 12. 9. 2026 (uživatel): v Nástrojích JEN JEDNA dlaždice — „Řízení aplikace". Firmy,
    // správci, prodej i zprávy jsou uvnitř konzole jako dlaždice, ne pět položek v seznamu.
    var NASTROJE = [
        {
            id: 'vlastnik-konzole', label: 'Řízení aplikace', order: 10,
            ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
            run: function () { open(); }
        },
    ];
    function katHead(grid) {
        var h = document.getElementById('agv-cat');
        if (h && h.parentNode === grid) return h;
        h = document.createElement('div');
        h.id = 'agv-cat';
        h.className = 'tool-cat';
        h.textContent = KAT;
        grid.appendChild(h);
        return h;
    }
    var _toolsOn = null;
    function injectTools() {
        var grid = document.querySelector('#tools-modal .tool-grid');
        if (!grid) return;
        var on = isOn();
        if (on === _toolsOn && (!on || document.getElementById('agv-cat'))) return;
        _toolsOn = on;
        var i;
        if (!on) {
            var h = document.getElementById('agv-cat');
            if (h && h.parentNode) h.parentNode.removeChild(h);
            for (i = 0; i < NASTROJE.length; i++) {
                if (typeof window.agUnregisterFieldTool === 'function') window.agUnregisterFieldTool(NASTROJE[i].id);
            }
            return;
        }
        if (typeof window.agRegisterFieldTool !== 'function') { _toolsOn = null; return; }
        katHead(grid);
        for (i = 0; i < NASTROJE.length; i++) {
            (function (it) {
                window.agRegisterFieldTool({
                    id: it.id, label: it.label, icon: it.ic, cat: KAT, order: it.order,
                    onClick: function () {
                        // Tezke moduly jsou odlozene (js/lazy-load.js) — nez se doahnou,
                        // by tlacitko jinak jen reklo "modul chybi".
                        if (it.lazy && window.AGLazy && typeof AGLazy.need === 'function') {
                            AGLazy.need(it.lazy, function () { try { it.run(); } catch (e) { swallow(e, 'nastroj'); } });
                            return;
                        }
                        try { it.run(); } catch (e) { swallow(e, 'nastroj'); }
                    }
                });
            })(NASTROJE[i]);
        }
    }

    // ⚠ DLOUHY STISK ZNAKU APPKY BYL ZRUSEN 8. 9. 2026. Byl to jediny vchod do
    //   rezimu vlastnika a uzivatel ho oznacil za nejvetsi problem appky
    //   ("musim se nejak prihlasovat specialne pres podrzeni ty ikony"). Nahradilo
    //   ho jmeno VLASTNIK v beznem prihlasovacim formulari, viz hookForm() vyse.
    //   Funkce tu zustava jako PRAZDNA, aby se dalo dohledat, proc gesto zmizelo.
    function injectGate() { }

    // 2) položka v „Více" — konzole PATŘÍ SEM, ne do Nastavení → Údržba. Tam byla
    //    schovaná pod dvěma rozbaleními a ukazovala se jen tomu, kdo klíč už měl.
    function injectMenu() {
        var host = document.querySelector('#side-menu .menu-scroll');
        if (!host) return;
        var b = document.getElementById('agv-menu-btn');
        if (isOn()) {
            if (!b) {
                b = document.createElement('button');
                b.id = 'agv-menu-btn'; b.type = 'button'; b.className = 'menu-btn';
                b.style.cssText = 'background:rgba(212,160,44,0.15);border-color:#d4a02c;color:#d4a02c;';
                b.innerHTML = '<span style="display:inline-block;width:18px;height:18px;vertical-align:-3px;">' + ICON + '</span> Konzole vlastníka';
                b.addEventListener('click', function () {
                    // toggleMenu() je PŘEPÍNAČ — bez testu na .open by panel naopak otevřel
                    try {
                        var sm = document.getElementById('side-menu');
                        if (sm && sm.classList.contains('open') && typeof window.toggleMenu === 'function') toggleMenu();
                    } catch (e) { swallow(e, 'menu:toggle'); }
                    open();
                });
                var head = host.querySelector('.menu-head');
                if (head && head.nextSibling) host.insertBefore(b, head.nextSibling);
                else host.insertBefore(b, host.firstChild);
            }
        } else if (b && b.parentNode) b.parentNode.removeChild(b);
    }

    // ⑦ TICHE OVERENI KLICE. Priznak `agVlastnik_v1` sam o sobe odemyka jen UI
    // tohohle telefonu, ale nema smysl ho drzet zapnuty, kdyz uz klic neplati
    // (zmenil jsem OWNER_KEY na serveru, telefon jsem pujcil dal, …). Jednou za
    // sest hodin se proto potichu zeptame serveru — a JEN pri jasnem 403 se rezim
    // vypne. Nedostupny server ani 503 rezim NEVYPINA: v terenu bez signalu by se
    // vlastnik jinak sam zamkl ven z vlastni aplikace.
    function overKlic() {
        if (!isOn()) return;
        // ⚠⚠ PŘÍZNAK BEZ KLÍČE SE VYPÍNÁ ROVNOU. Takový stav nemůže vzniknout
        //   poctivě — režim se zapíná jedině zadáním klíče, který se zároveň
        //   uloží. Vzniknout umí jen tak, že si někdo do úložiště napsal
        //   `agVlastnik_v1` rukou. Dřív to `!key()` propustilo bez ověření, takže
        //   ta jednička držela navždycky; od chvíle, kdy režim vlastníka odemyká
        //   i PRO (js/licence.js), by to byl nejlacinější způsob, jak placenou
        //   verzi obejít — levnější než podepsaný licenční klíč.
        if (!key()) {
            setOn(false); injectMenu();
            try { if (window.AGUcty && AGUcty.applyPerms) AGUcty.applyPerms(); } catch (e) { swallow(e, 'verif:bezKlice'); }
            return;
        }
        if (navigator.onLine === false) return;
        var last = 0;
        try { last = parseInt(localStorage.getItem(LS_VERIF) || '0', 10) || 0; } catch (e) { last = 0; }
        if (Date.now() - last < VERIFY_GAP) return;
        api('/owner/firms').then(function (r) {
            if (r.ok) { try { localStorage.setItem(LS_VERIF, String(Date.now())); } catch (e) { swallow(e, 'verif'); } return; }
            if (r.status !== 403) return;
            setOn(false); injectMenu();
            try { if (window.AGUcty && AGUcty.applyPerms) AGUcty.applyPerms(); } catch (e) { swallow(e, 'verif:perms'); }
            agAlert('Režim vlastníka vypnut', 'Klíč už serveru nesedí, tak se režim sám vypnul. Nový zadej při přihlášení: do jména <b>VLASTNIK</b>, do hesla nový klíč.');
        });
    }

    // 3) VIDITELNÝ VSTUP V NASTAVENÍ A V NÁSTROJÍCH (12. 9. 2026). Uživatel: „dej tu
    //    konzoli po mém přihlášení do nastavení/více/nástroje, abych to dokázal najít."
    //    Do té chvíle: ve „Více" tlačítko (nahoře až teď), v Nástrojích dlaždice v
    //    kategorii „Správa aplikace", která v seznamu úkonů padala do SBALENÉ sekce
    //    „Další nástroje". Teď: zlatý řádek pod záložkami Nastavení (vidět z každé
    //    záložky) a v Nástrojích zlaté tlačítko hned nahoře; sekci „Vlastník aplikace"
    //    v seznamu úkonů skládá js/nastroje-ukony.js z dlaždic vlastnik-*.
    var ZLATE = 'background:rgba(212,160,44,0.15);border:1px solid #d4a02c;color:#d4a02c;';
    function vstupBtn(id, text) {
        var b = document.createElement('button');
        b.id = id; b.type = 'button';
        b.style.cssText = ZLATE + 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:44px;' +
            'margin:0 0 10px;padding:10px 12px;border-radius:12px;font:700 calc(13px * var(--ag-font-scale,1))/1.35 var(--font-ui,system-ui);cursor:pointer;';
        b.innerHTML = '<span style="display:inline-block;width:18px;height:18px;">' + ICON + '</span><span>' + esc(text) + '</span>';
        b.addEventListener('click', function () {
            try {
                var sm = document.getElementById('settings-modal'); if (sm) sm.style.display = 'none';
                var tm = document.getElementById('tools-modal'); if (tm) { tm.style.display = 'none'; tm.classList.remove('ag-open'); }
            } catch (e) { swallow(e, 'vstupBtn'); }
            open();
        });
        return b;
    }
    function injectVstupy() {
        var on = isOn();
        // Nastavení: pruh #ag-set-strip stojí MIMO záložky (vidí ho každá záložka);
        // když pruh chybí (starší index.html), pod pruh záložek.
        var sb = document.getElementById('agv-set-btn');
        if (on && !sb) {
            var strip = document.getElementById('ag-set-strip');
            var sm = document.getElementById('settings-modal');
            var host = strip ? strip.parentNode : (sm && sm.querySelector('.tab-buttons') && sm.querySelector('.tab-buttons').parentNode);
            if (host) {
                sb = vstupBtn('agv-set-btn', 'Konzole vlastníka — lidé, firmy, žádosti o Pro');
                if (strip) host.insertBefore(sb, strip.nextSibling); else host.appendChild(sb);
            }
        } else if (!on && sb) sb.remove();
        // Nástroje: hned pod nadpisem, před hledáním (jako „Napsat autorovi").
        var tb = document.getElementById('agv-tools-btn');
        if (on && !tb) {
            var hled = document.getElementById('tools-search');
            var mc = document.querySelector('#tools-modal .modal-content');
            if (hled && mc) {
                tb = vstupBtn('agv-tools-btn', 'Konzole vlastníka');
                var kotva = document.getElementById('ag-fb-foot-tools') || hled;
                kotva.parentNode.insertBefore(tb, kotva);
            }
        } else if (!on && tb) tb.remove();
    }

    function init() {
        hookForm(); injectMenu(); injectTools(); injectVstupy(); injectBio();
        if (isOn()) znackaSw(true);   // telefony, kde režim běžel už před brzdou vydání
        setTimeout(overKlic, 12000);
        (window.AG && window.AG.uiInterval ? window.AG.uiInterval : setInterval)(function () {
            try { hookForm(); injectMenu(); injectTools(); injectVstupy(); injectBio(); } catch (e) { swallow(e, 'tick'); }
        }, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.agOpenKonzole = open;
    window.AGVlastnik = {
        isOn: isOn, open: open, close: close, login: login, leave: leave,
        key: key, setKey: setKey, promptKey: promptKey,
        // pro js/vlastnik-plus.js (souhrn, deník, kalendář, záloha, pohled očima účtu)
        jdi: jdi, ext: { verze: verzeAppky, hlava: hlava, wireZpet: wireZpet, cekam: cekam, api: api, esc: esc, kdy: kdy, sayFail: sayFail, ask: ask, agAlert: agAlert, render: render, view: function () { return _view; } }
    };
})();
