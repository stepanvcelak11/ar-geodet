/* OKNA ÚČTU, KTERÁ PŘI STARTU NEJSOU POTŘEBA (25. 9. 2026, 6. hodnocení d1 — rychlejší start)
 *
 * Dřív byla v js/ucty.js, který se stahuje a spouští ještě před prvním vykreslením. Tahle okna
 * se otevírají jen klepnutím (Vytvořit účet, QR firmy, Zapomenuté heslo, Smazat účet, Firmy na
 * zařízení, Nový obnovovací kód, Kód účtu, Prostory), takže se načtou až tehdy (ucty.js → okna()).
 * Kód je beze změny přesunutý; interní funkce ucty.js dostává přes objekt I (jen funkce a konstanty,
 * žádný sdílený měnitelný stav). Přihlašovací obrazovka a brána zůstávají v ucty.js (zámek musí
 * naskočit hned).
 */
(function () {
    'use strict';
    window.AGUctyOkna = function (I) {
        var DEFAULT_API = I.DEFAULT_API;
        var LS_ACC = I.LS_ACC;
        var LS_FIRM = I.LS_FIRM;
        var LS_IDCUR = I.LS_IDCUR;
        var LS_LAST = I.LS_LAST;
        var LS_OFF = I.LS_OFF;
        var LS_SPACES = I.LS_SPACES;
        var LS_SYNC = I.LS_SYNC;
        var LS_TOK = I.LS_TOK;
        var LS_TRUST = I.LS_TRUST;
        var adoptLogin = I.adoptLogin;
        var aktualniProstor = I.aktualniProstor;
        var applyPerms = I.applyPerms;
        var brandHtml = I.brandHtml;
        var bustFirm = I.bustFirm;
        var cloudFetch = I.cloudFetch;
        var ensureLib = I.ensureLib;
        var enterApp = I.enterApp;
        var esc = I.esc;
        var failClear = I.failClear;
        var fillMark = I.fillMark;
        var getFirm = I.getFirm;
        var getProstory = I.getProstory;
        var getTok = I.getTok;
        var getUcet = I.getUcet;
        var injectStyles = I.injectStyles;
        var listProfiles = I.listProfiles;
        var lsKontakt = I.lsKontakt;
        var maProstory = I.maProstory;
        var prepniProstor = I.prepniProstor;
        var profileKeyOf = I.profileKeyOf;
        var removeProfile = I.removeProfile;
        var setProstory = I.setProstory;
        var setSess = I.setSess;
        var showGate = I.showGate;
        var startLive = I.startLive;
        var switchProfile = I.switchProfile;
        var terrainHtml = I.terrainHtml;
        var tick = I.tick;
        var usageLog = I.usageLog;

        // ---- založení účtu -------------------------------------------------------
        // TŘI POLE A ŽÁDNÝ E-MAIL. Registrace je pro obě verze STEJNÁ: člověk si
        // vymyslí jméno, název místa, kde má data, a heslo. Sólo uživatel se o žádné
        // „firmě" nedozví — jen si pojmenoval svůj prostor; teprve s Pro se z něj
        // stane firma, do které jde někoho pozvat.
        //
        // ⚠ HESLO NEJDE OBNOVIT a musí to být napsané TADY, u toho pole, ne v nápovědě.
        //   Bez e-mailu není kam poslat odkaz — a člověk, který si to přečte až ve
        //   chvíli, kdy heslo zapomněl, přijde o data.
        function showRegister(api) {
            injectStyles();
            var g = document.getElementById('ag-gate'); if (g) g.remove();
            var old = document.getElementById('ag-reg'); if (old) old.remove();
            var ov = document.createElement('div');
            ov.id = 'ag-reg';
            ov.className = 'ag-gate-like';
            ov.innerHTML =
                terrainHtml() +
                '<div class="agl-card">' +
                brandHtml() +
                '<div class="agl-firm">Založení účtu — bez e-mailu, za dvě minuty.</div>' +
                '<div class="agg-box on">' +
                '  <input type="text" id="agr-name" maxlength="40" placeholder="Tvoje jméno" autocomplete="name">' +
                // 12. 9. 2026: „Název místa, kde budeš mít data" byl matoucí (uživatel). Je to jméno
                // TVÉHO PROSTORU — firma nebo tvoje jméno; pod ním budou zakázky a body.
                '  <input type="text" id="agr-space" maxlength="60" placeholder="Název firmy nebo tvé jméno (tvůj prostor)" autocomplete="organization">' +
                '  <div class="agg-note" style="margin:-4px 0 8px;text-align:left;">Tak se bude jmenovat <b>tvůj prostor</b> — místo, kde budou tvoje zakázky a body. Když tě pak někdo pozve do své firmy, přibude vedle jako druhý prostor.</div>' +
                '  <input type="password" id="agr-pass" maxlength="64" placeholder="Heslo (aspoň 8 znaků)" autocomplete="new-password">' +
                '  <input type="password" id="agr-pass2" maxlength="64" placeholder="Heslo ještě jednou" autocomplete="new-password">' +
                '  <div class="agl-err" id="agr-err"></div>' +
                '  <button type="button" class="agl-btn" id="agr-go">Založit účet</button>' +
                '  <button type="button" class="agl-ghost" id="agr-back">Zpět na přihlášení</button>' +
                '</div>' +
                '<div class="agg-note">Heslo jde nastavit znovu jen <b>obnovovacím kódem</b>, který dostaneš hned po založení — ulož si ho mimo telefon, e-mail se nikam neposílá. ' +
                'Zakázky si čas od času stáhni jako zálohu, je to jediná pojistka.</div>' +
                '</div>';
            document.body.appendChild(ov);
            fillMark(ov);
            startLive(ov);

            var err = ov.querySelector('#agr-err');
            ov.querySelector('#agr-back').onclick = function () { ov.remove(); showGate(); };
            var busy = false;
            ov.querySelector('#agr-go').onclick = function () {
                if (busy) return;
                var jm = (ov.querySelector('#agr-name').value || '').trim();
                var pr = (ov.querySelector('#agr-space').value || '').trim();
                var h1 = ov.querySelector('#agr-pass').value || '';
                var h2 = ov.querySelector('#agr-pass2').value || '';
                if (!jm) { err.textContent = 'Napiš, jak ti máme říkat.'; return; }
                if (!pr) { err.textContent = 'Pojmenuj místo, kde budeš mít data — třeba svým jménem nebo názvem firmy.'; return; }
                if (h1.length < 8) { err.textContent = 'Heslo musí mít aspoň 8 znaků.'; return; }
                // Heslo dvakrát je tu SCHVÁLNĚ, i když to jinde v appce není zvykem:
                // překlep v hesle bez možnosti obnovy znamená ztrátu dat.
                if (h1 !== h2) { err.textContent = 'Hesla se neshodují.'; return; }
                busy = true;
                err.textContent = 'Zakládám…';
                cloudFetch('/register', {
                    method: 'POST', api: api || DEFAULT_API,
                    body: { name: jm, spaceName: pr, password: h1 }
                }).then(function (r) {
                    busy = false;
                    if (r.ok && r.data && r.data.token) {
                        failClear();
                        adoptLogin(r.data, api || DEFAULT_API, h1);
                        ov.remove();
                        usageLog('login', 'register');
                        // Kód účtu je JEDINÁ cesta zpátky, když si člověk appku smaže
                        // nebo vymění telefon — ukázat ho jednou v hlášce nestačí.
                        ukazKodUctu(r.data.ucet, r.data.recovery);
                        try { window.dispatchEvent(new CustomEvent('agucty:login', { detail: { user: r.data.user } })); }
                        catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:register'); }
                        return;
                    }
                    if (r.status === 0) { err.textContent = 'Server není dosažitelný — účet se zakládá přes internet.'; return; }
                    err.textContent = (r.data && r.data.error) || ('Registrace selhala (' + r.status + ').');
                });
            };
            setTimeout(function () { try { ov.querySelector('#agr-name').focus(); } catch (e) { } }, 60);
        }
        // ---- sken přihlašovacího QR od admina (payload 'AGF1\ncode\tname\tapi?';
        // heslo se NIKDY nepřenáší — to zadá zaměstnanec sám) ----------------------
        function scanFirmQR(done) {
            ensureLib('js/lib/jsqr.min.js').then(function () {
                var ov = document.createElement('div');
                ov.id = 'agg-scan-ov';
                ov.style.cssText = 'position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,0.93);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;';
                ov.innerHTML =
                    '<video id="agg-scan-video" playsinline muted style="width:min(420px,92vw);border-radius:14px;background:#000;"></video>' +
                    '<div id="agg-scan-st" style="color:#9aa1ac;font:600 13px/1.4 system-ui;text-align:center;">Spouštím kameru…</div>' +
                    '<button type="button" id="agg-scan-x" style="background:transparent;border:1px solid rgba(255,255,255,0.3);color:#e6e8eb;border-radius:12px;padding:11px 26px;font:600 14px/1 system-ui;cursor:pointer;">Zrušit</button>';
                document.body.appendChild(ov);
                var video = ov.querySelector('#agg-scan-video');
                var st = ov.querySelector('#agg-scan-st');
                var canvas = document.createElement('canvas');
                var ctx = canvas.getContext('2d', { willReadFrequently: true });
                var stream = null, raf = null;
                function stop() {
                    if (raf) cancelAnimationFrame(raf);
                    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
                    stream = null;
                    ov.remove();
                }
                ov.querySelector('#agg-scan-x').onclick = stop;
                navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (s) {
                    stream = s; video.srcObject = s;
                    try { video.play(); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:stop'); }
                    st.textContent = 'Namiř na QR kód od admina…';
                    var _lastScanT = 0;
                    function tick() {
                        if (!stream) return;
                        // BATERIE: ~10 snímků/s a zmenšený obraz stačí (QR je v záběru déle než
                        // 100 ms); plné rozlišení každý snímek je nejteplejší smyčka v appce.
                        var _now = performance.now();
                        if (_now - _lastScanT < 100) { raf = requestAnimationFrame(tick); return; }
                        _lastScanT = _now;
                        if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
                            var _s = Math.min(1, 640 / video.videoWidth);
                            canvas.width = Math.round(video.videoWidth * _s); canvas.height = Math.round(video.videoHeight * _s);
                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                            var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                            var code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                            if (code && code.data) {
                                if (code.data.indexOf('AGF1\n') === 0) {
                                    var c = code.data.split('\n')[1].split('\t');
                                    stop();
                                    done({ code: (c[0] || '').toUpperCase(), name: c[1] || '', api: c[2] || '' });
                                    return;
                                }
                                st.textContent = 'Tohle není přihlašovací QR QTRIG.';
                            }
                        }
                        raf = requestAnimationFrame(tick);
                    }
                    raf = requestAnimationFrame(tick);
                }).catch(function (err) {
                    st.textContent = 'Kameru nelze spustit: ' + (err && err.message ? err.message : err);
                });
            }).catch(function () { agInfo('Knihovnu pro čtení QR se nepodařilo načíst.'); });
        }
        // ---- obnova hesla obnovovacím kódem (brána, bez přihlášení) ---------------------------
        function showObnova(predvyplnenyKod) {
            injectStyles();
            var old = document.getElementById('ag-obnova'); if (old) old.remove();
            var ov = document.createElement('div');
            ov.id = 'ag-obnova';
            ov.className = 'ag-gate-like';
            ov.innerHTML =
                '<div class="agl-card">' +
                '<div class="agl-firm">Nové heslo obnovovacím kódem</div>' +
                '<div class="agg-box on">' +
                '  <input type="text" id="ago-code" maxlength="8" placeholder="Kód účtu (8 znaků)" autocapitalize="characters" autocomplete="username" style="text-transform:uppercase;letter-spacing:.15em;" value="' + esc(String(predvyplnenyKod || '').toUpperCase()) + '">' +
                '  <input type="text" id="ago-rec" maxlength="23" placeholder="Obnovovací kód (XXXXX-XXXXX-XXXXX-XXXXX)" autocapitalize="characters" autocomplete="one-time-code" style="text-transform:uppercase;">' +
                '  <input type="password" id="ago-p1" maxlength="64" placeholder="Nové heslo (aspoň 8 znaků)" autocomplete="new-password">' +
                '  <input type="password" id="ago-p2" maxlength="64" placeholder="Nové heslo znovu" autocomplete="new-password">' +
                '  <div class="agl-err" id="ago-err"></div>' +
                '  <button type="button" class="agl-btn" id="ago-go">Nastavit nové heslo</button>' +
                '</div>' +
                '<div class="agg-note">Obnovovací kód jsi dostal při založení účtu (nebo v O aplikaci → Účet). Po použití dostaneš nový — starý přestane platit.</div>' +
                '<button type="button" class="agl-ghost" id="ago-zpet">Zpět</button>' +
                '</div>';
            document.body.appendChild(ov);
            var err = ov.querySelector('#ago-err'), busy = false;
            ov.querySelector('#ago-zpet').onclick = function () { ov.remove(); };
            ov.querySelector('#ago-go').onclick = function () {
                if (busy) return;
                var code = (ov.querySelector('#ago-code').value || '').trim().toUpperCase();
                var rec = (ov.querySelector('#ago-rec').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                var p1 = ov.querySelector('#ago-p1').value || '', p2 = ov.querySelector('#ago-p2').value || '';
                if (code.length !== 8) { err.textContent = 'Kód účtu má 8 znaků.'; return; }
                if (rec.length !== 20) { err.textContent = 'Obnovovací kód má 20 znaků (4 × 5).'; return; }
                if (p1.length < 8) { err.textContent = 'Heslo musí mít aspoň 8 znaků.'; return; }
                if (p1 !== p2) { err.textContent = 'Hesla se neshodují.'; return; }
                busy = true; err.textContent = 'Ověřuji…';
                cloudFetch('/account/recover', { method: 'POST', api: DEFAULT_API, body: { code: code, recovery: rec, password: p1 } }).then(function (r) {
                    if (!(r.ok && r.data && r.data.ok)) {
                        busy = false;
                        err.textContent = r.status === 0 ? 'Server není dosažitelný — obnova jde jen přes internet.' : ((r.data && r.data.error) || ('Obnova selhala (' + r.status + ').'));
                        return;
                    }
                    // rovnou přihlásit novým heslem a ukázat nový obnovovací kód
                    var novy = r.data.recovery;
                    cloudFetch('/login', { method: 'POST', api: DEFAULT_API, body: { code: code, password: p1 } }).then(function (l) {
                        busy = false;
                        ov.remove();
                        if (l.ok && l.data && l.data.token) {
                            failClear();
                            adoptLogin(l.data, DEFAULT_API, p1);
                            usageLog('login', 'recover');
                            ukazKodUctu(l.data.ucet, novy);
                            try { window.dispatchEvent(new CustomEvent('agucty:login', { detail: { user: l.data.user } })); } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:recover'); }
                        } else {
                            ukazKodUctu({ code: code }, novy, true);
                            agInfo('Heslo je nastavené. Přihlas se novým heslem.');
                        }
                    });
                });
            };
            setTimeout(function () { try { ov.querySelector(predvyplnenyKod ? '#ago-rec' : '#ago-code').focus(); } catch (e) { } }, 60);
        }
        // ---- smazání účtu ---------------------------------------------------------
        // Google Play (13. 9. 2026): appka, ve které si člověk zakládá účet, musí umět
        // ten účet i smazat — z appky a z webu (smazani-uctu.html). Vchod je v
        // „O aplikaci" (vidí ho Základ i Pro — obrazovka prostorů se v Základu
        // neukazuje) a na obrazovce prostorů. Server (POST /account/delete) chce
        // heslo znovu, aby telefon nechaný na stole nesmazal cizí účet jedním klepnutím.
        function showSmazaniUctu() {
            injectStyles();
            var old = document.getElementById('ag-smazani'); if (old) old.remove();
            var ucet = getUcet() || {};
            var ov = document.createElement('div');
            ov.id = 'ag-smazani';
            ov.className = 'ag-gate-like';
            ov.innerHTML =
                '<div class="agl-card">' +
                '<div class="agl-firm">Smazat účet</div>' +
                '<div class="agg-note" style="color:var(--danger,#e5534b);">Smaže účet <b>' + esc(ucet.code || '') + '</b> na serveru i s tvým vlastním místem (body a zakázky uložené na serveru). ' +
                'Ve firmách, kde jsi členem, zůstanou body firmě. <b>Nejde to vrátit zpět.</b></div>' +
                '<div class="agg-note">Body a zakázky uložené v tomhle telefonu zůstanou — smažeš je smazáním dat aplikace.</div>' +
                '<div class="agg-box on">' +
                '  <input type="password" id="ags-pass" placeholder="Heslo k účtu" autocomplete="current-password">' +
                '  <div class="agl-err" id="ags-err"></div>' +
                '  <button type="button" class="agl-btn" id="ags-go" style="background:var(--danger,#e5534b);">Opravdu smazat účet</button>' +
                '</div>' +
                '<button type="button" class="agl-ghost" id="ags-zpet">Zpět</button>' +
                '</div>';
            document.body.appendChild(ov);
            var err = ov.querySelector('#ags-err');
            ov.querySelector('#ags-zpet').onclick = function () { ov.remove(); };
            ov.querySelector('#ags-go').onclick = function () {
                var pass = ov.querySelector('#ags-pass').value || '';
                if (!pass) { err.textContent = 'Napiš heslo k účtu.'; return; }
                if (!getTok()) { err.textContent = 'Účet na serveru tu není — stačí smazat data appky v telefonu.'; return; }
                err.textContent = 'Mažu…';
                cloudFetch('/account/delete', { method: 'POST', body: { password: pass } }).then(function (r) {
                    if (!r.ok) { err.textContent = (r.data && r.data.error) || (r.status === 0 ? 'Server není dosažitelný — účet se maže přes internet.' : ('Smazání selhalo (' + r.status + ').')); return; }
                    // Server účet zrušil → pryč i všechno, co ho v telefonu drží (stejný
                    // úklid jako nouzové odpojení + účet, prostory, SSO). Body a zakázky
                    // v telefonu zůstávají — patří člověku, ne účtu.
                    try {
                        var f = getFirm(); if (f) removeProfile(profileKeyOf(f));
                        [LS_FIRM, LS_TOK, LS_OFF, LS_SYNC, LS_ACC, LS_SPACES, LS_LAST, LS_TRUST, LS_IDCUR, 'agUcetKontakt_v1'].forEach(function (k) { localStorage.removeItem(k); });
                    } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:smazani'); }
                    bustFirm();
                    setSess(null);
                    ov.remove();
                    try { var ab = document.getElementById('about-modal'); if (ab) ab.style.display = 'none'; } catch (e) { window.AG && AG.swallow && AG.swallow(e, 'ucty:smazani'); }
                    applyPerms();
                    agInfo('Účet je smazaný. Body a zakázky v telefonu zůstaly.');
                    showGate();
                });
            };
            setTimeout(function () { try { ov.querySelector('#ags-pass').focus(); } catch (e) { } }, 60);
        }
        // Rozcestník „Přepnout firmu" z přihlašovací obrazovky: uložené firemní profily
        // tohoto telefonu (přepnutí = jiná firma + její přihlášení, viz switchProfile) a
        // případně prostory účtu (viz showProstory). Nic se nemaže, jen se přepíná.
        function showFirmy() {
            injectStyles();
            var old = document.getElementById('ag-firmy'); if (old) old.remove();
            var f = getFirm(), cur = f ? profileKeyOf(f) : null;
            var prof = listProfiles().filter(function (p) { return p && p.key; });
            var ov = document.createElement('div');
            ov.id = 'ag-firmy';
            ov.className = 'ag-gate-like';
            var seznam = prof.map(function (p) {
                var tady = p.key === cur;
                return '<button type="button" class="agg-prof" data-key="' + esc(p.key) + '"' + (tady ? ' disabled' : '') + '>' +
                    '<span class="agg-pt"><b>' + esc(p.label || 'Firma') + (tady ? ' · tady jsi' : '') + '</b>' +
                    '<span>' + esc(p.cloud ? ('cloud' + (p.code ? ' · kód ' + p.code : '')) : 'jen v tomto telefonu') + '</span></span><span class="agg-go">›</span></button>';
            }).join('');
            var maProstory = getProstory().length > 1 && !!getTok();
            ov.innerHTML =
                '<div class="agl-card">' +
                '<div class="agl-firm">Přepnout firmu</div>' +
                (seznam || '<div class="agg-note">V telefonu je uložená jen tahle firma.</div>') +
                (maProstory ? '<button type="button" class="agl-btn" id="agf-prostory" style="margin-top:8px;">Prostory mého účtu ›</button>' : '') +
                '<button type="button" class="agl-ghost" id="agf-zpet">Zpět</button>' +
                '<div class="agg-note">Přepnutí firmu nemaže — jen ukáže její přihlášení. Body a zakázky zůstávají v telefonu.</div>' +
                '</div>';
            document.body.appendChild(ov);
            ov.querySelector('#agf-zpet').onclick = function () { ov.remove(); };
            var pb = ov.querySelector('#agf-prostory');
            if (pb) pb.onclick = function () { ov.remove(); showProstory(); };
            ov.addEventListener('click', function (e) {
                var b = e.target.closest ? e.target.closest('.agg-prof') : null;
                if (!b || b.disabled) return;
                var key = b.getAttribute('data-key');
                ov.remove();
                var lg = document.getElementById('ag-login'); if (lg) lg.remove();
                switchProfile(key);                      // bez přihlášení → showLogin() cílové firmy
            });
        }
        // ---- nový obnovovací kód pro přihlášený účet (O aplikaci → Účet, obrazovka prostorů) ----
        function showNovyObnovovaciKod() {
            var ucet = getUcet();
            if (!ucet || !ucet.code) { agInfo('Nejdřív se přihlas účtem.'); return; }
            injectStyles();
            var old = document.getElementById('ag-rec'); if (old) old.remove();
            var ov = document.createElement('div');
            ov.id = 'ag-rec';
            ov.className = 'ag-gate-like';
            ov.innerHTML =
                '<div class="agl-card">' +
                '<div class="agl-firm">Obnovovací kód účtu ' + esc(ucet.code) + '</div>' +
                '<div class="agg-note">Kdybys zapomněl heslo, obnovovacím kódem si nastavíš nové — bez e-mailu. Nový kód nahradí ten starý. Potvrď heslem:</div>' +
                '<div class="agg-box on">' +
                '  <input type="password" id="agrc-pass" maxlength="64" placeholder="Heslo účtu" autocomplete="current-password">' +
                '  <div class="agl-err" id="agrc-err"></div>' +
                '  <button type="button" class="agl-btn" id="agrc-go">Vytvořit nový obnovovací kód</button>' +
                '</div>' +
                '<button type="button" class="agl-ghost" id="agrc-zpet">Zpět</button>' +
                '</div>';
            document.body.appendChild(ov);
            var err = ov.querySelector('#agrc-err'), busy = false;
            ov.querySelector('#agrc-zpet').onclick = function () { ov.remove(); };
            ov.querySelector('#agrc-go').onclick = function () {
                if (busy) return;
                var heslo = ov.querySelector('#agrc-pass').value || '';
                if (!heslo) { err.textContent = 'Zadej heslo.'; return; }
                busy = true; err.textContent = 'Vyrábím…';
                cloudFetch('/account/recovery', { method: 'POST', body: { password: heslo } }).then(function (r) {
                    busy = false;
                    if (r.ok && r.data && r.data.recovery) { ov.remove(); ukazKodUctu(ucet, r.data.recovery, true); return; }
                    err.textContent = r.status === 0 ? 'Server není dosažitelný — kód se vyrábí přes internet.' : ((r.data && r.data.error) || ('Nepovedlo se (' + r.status + ').'));
                });
            };
            setTimeout(function () { try { ov.querySelector('#agrc-pass').focus(); } catch (e) { } }, 60);
        }
        // Kód účtu po registraci. Zůstává na obrazovce, dokud ho člověk neodklikne —
        // je to jediné, čím se příště přihlásí, a heslo mu nikdo neobnoví.
        // recovery = obnovovací kód (18. 9. 2026, R3) — ukazuje se JEDNOU, server ho v čitelné podobě nemá
        function ukazKodUctu(ucet, recovery, jenKod) {
            if (!ucet || !ucet.code) return;
            injectStyles();
            var ov = document.createElement('div');
            ov.id = 'ag-kod';
            ov.className = 'ag-gate-like';
            ov.innerHTML =
                '<div class="agl-card">' +
                (jenKod ? '<div class="agl-firm">Nový obnovovací kód</div>'
                    : '<div class="agl-firm">Hotovo. Tímhle kódem se budeš přihlašovat:</div><div class="agk-kod">' + esc(ucet.code) + '</div>') +
                (recovery ? ('<div class="agg-note" style="margin-top:2px;"><b>Obnovovací kód</b> — kdybys zapomněl heslo, tímhle si nastavíš nové. ' +
                    'Ukáže se jen teď; ulož si ho mimo telefon (poznámky, papír, foto obrazovky).</div>' +
                    '<div class="agk-kod agk-rec">' + esc(recovery) + '</div>' +
                    '<button type="button" class="agl-ghost" id="agk-copy">Zkopírovat kód účtu i obnovovací kód</button>') : '') +
                (jenKod ? '' : '<div class="agg-note">Kód účtu si opiš někam mimo telefon. Spolu s heslem je to všechno, ' +
                    'co potřebuješ, aby ses dostal ke svým datům na jiném zařízení.</div>') +
                '<button type="button" class="agl-btn" id="agk-ok">' + (jenKod ? 'Uloženo, zavřít' : 'Zapsáno, jdeme měřit') + '</button>' +
                '</div>';
            document.body.appendChild(ov);
            var cp = ov.querySelector('#agk-copy');
            if (cp) cp.onclick = function () {
                var t = 'QTRIG — kód účtu: ' + ucet.code + (recovery ? '\nobnovovací kód: ' + recovery : '');
                try { navigator.clipboard.writeText(t).then(function () { cp.textContent = 'Zkopírováno — vlož do poznámek'; }, function () { cp.textContent = 'Nejde kopírovat — opiš ručně'; }); }
                catch (e) { cp.textContent = 'Nejde kopírovat — opiš ručně'; }
            };
            ov.querySelector('#agk-ok').onclick = function () { ov.remove(); if (!jenKod) enterApp(); };
        }
        function showProstory() {
            injectStyles();
            var old = document.getElementById('ag-prostory'); if (old) old.remove();
            var ov = document.createElement('div');
            ov.id = 'ag-prostory';
            ov.className = 'ag-gate-like';
            var ted = aktualniProstor();
            var seznam = getProstory().map(function (p) {
                var kde = p.vlastni ? 'Moje vlastní místo' : (p.nazev || 'Firma');
                var pod = p.vlastni
                    ? 'Zůstává ti navždy — sem se nikdo jiný nedostane.'
                    : (p.archiv ? 'Archiv — jen ke čtení, do dne odchodu.' : ('Role: ' + p.role));
                var tady = ted && ted.firmId === p.firmId;
                return '<button type="button" class="agg-prof" data-firm="' + esc(p.firmId) + '"' +
                    (tady ? ' disabled' : '') + '>' +
                    '<span class="agg-pt"><b>' + esc(kde) + (tady ? ' · tady jsi' : '') + '</b>' +
                    '<span>' + esc(pod) + '</span></span><span class="agg-go">›</span></button>';
            }).join('');
            ov.innerHTML =
                '<div class="agl-card">' +
                '<div class="agl-firm">Kde právě pracuješ</div>' +
                (seznam || '<div class="agg-note">Zatím máš jen svoje místo.</div>') +
                '<div class="agg-box on">' +
                '  <input type="text" id="agp-kod" maxlength="6" placeholder="Pozvací kód firmy" ' +
                '         autocapitalize="characters" autocomplete="off" style="text-transform:uppercase;letter-spacing:.15em;">' +
                '  <div class="agl-err" id="agp-err"></div>' +
                '  <button type="button" class="agl-btn" id="agp-join">Připojit se k firmě</button>' +
                '</div>' +
                // Kontakt pro autora appky (13. 9. 2026): nepovinný, vidí ho jen vlastník v konzoli
                // a Napsat autorovi si ho předvyplní. Bez něj se k hlášení není koho zeptat.
                '<div class="agg-box on" id="agp-kontakt-box">' +
                '  <div class="agg-note" style="margin:0 0 6px;">Kontakt na tebe (nepovinné): telefon nebo e-mail. Uvidí ho jen autor appky, když mu pošleš hlášení.</div>' +
                '  <input type="text" id="agp-kontakt" maxlength="120" placeholder="+420 … nebo e-mail" autocomplete="tel" value="' + esc(lsKontakt()) + '">' +
                '  <div class="agl-err" id="agp-kontakt-err"></div>' +
                '  <button type="button" class="agl-btn" id="agp-kontakt-ok">Uložit kontakt</button>' +
                '</div>' +
                '<button type="button" class="agl-ghost" id="agp-zpet">Zpět</button>' +
                // Smazání účtu (13. 9. 2026): Google Play chce u appky s registrací i cestu
                // ven — z appky a z webu (smazani-uctu.html). Sbalené za jedním nenápadným
                // odkazem, rozbalí se pole na heslo: server (POST /account/delete) ho chce
                // znovu, aby telefon nechaný na stole nesmazal cizí účet jedním klepnutím.
                '<button type="button" class="agl-ghost" id="agp-rec-open">Nový obnovovací kód…</button>' +
                '<button type="button" class="agl-ghost" id="agp-del-open" style="opacity:.7;">Smazat účet…</button>' +
                // Odchod je popsaný přesně tak, jak se chová — člověk se musí předem
                // dozvědět, že mu prostor zůstane, ale zamrzlý.
                '<div class="agg-note">Když z firmy odejdeš, prostor ti tu zůstane jako archiv jen ke čtení ' +
                '(do dne odchodu). Správce firmy ti ho ale může odebrat.</div>' +
                '</div>';
            document.body.appendChild(ov);
            var err = ov.querySelector('#agp-err');
            ov.querySelector('#agp-zpet').onclick = function () { ov.remove(); };
            (function () {
                var kin = ov.querySelector('#agp-kontakt'), kerr = ov.querySelector('#agp-kontakt-err');
                var naServer = !!getTok();   // bez účtu na serveru zůstane kontakt jen v telefonu (Napsat autorovi ho předvyplní)
                // serverová hodnota má přednost před tou z telefonu (jiný telefon, nový start)
                if (naServer) cloudFetch('/account/contact').then(function (r) {
                    if (r.ok && r.data && typeof r.data.contact === 'string' && kin.isConnected && document.activeElement !== kin) { kin.value = r.data.contact; lsKontakt(r.data.contact); }
                });
                ov.querySelector('#agp-kontakt-ok').onclick = function () {
                    var c = (kin.value || '').trim().slice(0, 120);
                    kerr.style.color = '';
                    if (!naServer) { lsKontakt(c); kerr.style.color = 'var(--accent,#2f9e74)'; kerr.textContent = c ? 'Uloženo v telefonu.' : 'Kontakt smazán.'; return; }
                    kerr.textContent = 'Ukládám…';
                    cloudFetch('/account/contact', { method: 'POST', body: { contact: c } }).then(function (r) {
                        if (r.ok) { lsKontakt(c); kerr.style.color = 'var(--accent,#2f9e74)'; kerr.textContent = c ? 'Uloženo.' : 'Kontakt smazán.'; return; }
                        kerr.textContent = (r.data && r.data.error) || ('Uložení selhalo (' + r.status + ') — zkus to s lepším signálem.');
                    });
                };
            })();
            ov.querySelector('#agp-del-open').onclick = function () { ov.remove(); showSmazaniUctu(); };
            ov.querySelector('#agp-rec-open').onclick = function () { showNovyObnovovaciKod(); };
            ov.addEventListener('click', function (e) {
                var b = e.target.closest ? e.target.closest('.agg-prof') : null;
                if (!b || b.disabled) return;
                prepniProstor(b.getAttribute('data-firm'), function (chyba) {
                    if (chyba) { err.textContent = chyba; return; }
                    ov.remove();
                });
            });
            ov.querySelector('#agp-join').onclick = function () {
                var kod = (ov.querySelector('#agp-kod').value || '').trim().toUpperCase();
                if (kod.length !== 6) { err.textContent = 'Pozvací kód má šest znaků.'; return; }
                err.textContent = 'Připojuji…';
                cloudFetch('/spaces/join', { method: 'POST', body: { code: kod } }).then(function (r) {
                    if (r.ok && r.data && r.data.prostory) {
                        setProstory(r.data.prostory);
                        err.textContent = '';
                        ov.remove();
                        showProstory();
                        return;
                    }
                    err.textContent = (r.data && r.data.error) || ('Připojení selhalo (' + r.status + ').');
                });
            };
        }

        return { showRegister: showRegister, scanFirmQR: scanFirmQR, showObnova: showObnova, showSmazaniUctu: showSmazaniUctu, showFirmy: showFirmy, showNovyObnovovaciKod: showNovyObnovovaciKod, ukazKodUctu: ukazKodUctu, showProstory: showProstory };
    };
})();
