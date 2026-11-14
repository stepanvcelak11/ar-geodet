// ===== QTRIG — VLASTNÍ BODOVÉ POLE: místopis, fotka se směrem, stav bodu (ODPOJITELNÁ) =====
// (14. 11. 2026, přání uživatele: „pointa appky je dohledávání bodů … geodet si vytváří vlastní
// bodové pole, aby je nemusel náročně hledat — klikne tady je bod, má to číslo a může ho zpětně
// snáze dohledat.")
//
// CO DRŽÍ (per zakázka, přes getStoredData/setStoredData — veze se se zakázkou i v záloze):
//   agPoleInfo_v1  { idBodu: { stab, popis, foto, az, t } }
//                  stab  = 'hreb' | 'kolik' | 'znak' | 'kamen' | 'jine'  (čím je bod v terénu označený)
//                  popis = krátký místopis („roh plotu, 1,2 m od sloupku")
//                  foto  = id fotky v IndexedDB, az = azimut, KAM SE FOTKA DÍVALA (kompas v okamžiku focení)
//   agPoleStav_v1  { idBodu: { s: 'ok' | 'nenalezen' | 'znicen', t } }  — poslední ověření v terénu
//   Fotky: IndexedDB 'agPoleFoto' (JPEG ≤ 1280 px), klíč = id fotky. Fotky se NEVEZOU v záloze
//   účtu (záloha je bez fotek — viz soukromi.html), jen v telefonu.
// Stejný mechanismus platí pro úřední body (ČÚZK) — id je u nich stabilní z polohy.
//
// KDO TO POUŽÍVÁ: js/jednoduchy-rezim.js (nový bod, karta bodu, hledací režim u bodu) a
// js/grafika.js (_drawOneMarker: barevný puntík stavu — zničen / nenalezen / ověřen).
//
// API window.AGPole: info, setInfo, stav, setStav, foto, porizFoto, kameraSFotkou, badge, znak,
//   STAB (popisky stabilizací), stavText.
// Odstranění: smaž tenhle soubor + řádek v index.html; volající mají `window.AGPole &&`.
// ================================================================================
(function () {
    'use strict';
    if (window.AGPole) return;

    var K_INFO = 'agPoleInfo_v1', K_STAV = 'agPoleStav_v1';
    var DB = 'agPoleFoto', STORE = 'f';
    var STAB = { hreb: 'hřeb', kolik: 'kolík', znak: 'znak (barva)', kamen: 'kámen', jine: 'jiné' };

    function swallow(e, kde) { try { if (window.AG && AG.swallow) AG.swallow(e, 'vlastni-pole:' + kde); } catch (e2) { /* nic */ } }
    function T(cs, o) { var v = cs; try { if (window.AGJazyk) v = AGJazyk.t(cs); } catch (e) { v = cs; } return o ? v.replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }) : v; }
    function cti(k) {
        try { var s = (typeof getStoredData === 'function') ? getStoredData(k) : localStorage.getItem(k); var o = s ? JSON.parse(s) : {}; return (o && typeof o === 'object') ? o : {}; }
        catch (e) { return {}; }
    }
    function zapis(k, o) {
        try { var s = JSON.stringify(o); if (typeof setStoredData === 'function') setStoredData(k, s); else localStorage.setItem(k, s); }
        catch (e) { swallow(e, 'zapis'); }
    }
    function prekresliMapu() { try { if (typeof drawAllMarkersOnMap === 'function') drawAllMarkersOnMap(); } catch (e) { swallow(e, 'mapa'); } }

    // ---- místopis a stav --------------------------------------------------------------------
    function info(id) { return id ? (cti(K_INFO)[id] || null) : null; }
    function setInfo(id, o) {
        if (!id) return;
        var all = cti(K_INFO), cur = all[id] || {};
        Object.keys(o || {}).forEach(function (k) { if (o[k] === null || o[k] === '') delete cur[k]; else cur[k] = o[k]; });
        cur.t = Date.now();
        all[id] = cur; zapis(K_INFO, all);
    }
    function stav(id) { return id ? (cti(K_STAV)[id] || null) : null; }
    function setStav(id, s) {
        if (!id) return;
        var all = cti(K_STAV);
        if (!s) delete all[id]; else all[id] = { s: s, t: Date.now() };
        zapis(K_STAV, all);
        prekresliMapu();
    }
    function datum(t) { try { var d = new Date(t); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear(); } catch (e) { return ''; } }
    function stavText(id) {
        var s = stav(id); if (!s) return '';
        var d = datum(s.t);
        if (s.s === 'ok') return T('ověřen {d}', { d: d });
        if (s.s === 'nenalezen') return T('nenalezen {d}', { d: d });
        if (s.s === 'znicen') return T('zničen {d}', { d: d });
        return '';
    }
    // znak do podpisu značky v mapě (js/grafika.js _mkSig) — změna stavu = překreslení značky
    function znak(pt) { var s = pt && stav(pt.id); return s ? s.s.charAt(0) : ''; }
    // puntík ke značce v mapě: zničen (červený ×) · nenalezen (oranžový ?) · ověřen (modrý ✓)
    function badge(pt) {
        var s = pt && stav(pt.id); if (!s) return '';
        var bg = s.s === 'znicen' ? '#ef4444' : (s.s === 'nenalezen' ? '#f59e0b' : '#3b82f6');
        var zn = s.s === 'znicen' ? '×' : (s.s === 'nenalezen' ? '?' : '✓');
        return '<div style="position:absolute; top:-7px; left:-7px; width:13px; height:13px; border-radius:50%; background:' + bg
            + '; border:1.5px solid #fff; display:flex; align-items:center; justify-content:center; color:#fff; font:700 9px/1 system-ui;">' + zn + '</div>';
    }

    // ---- fotky (IndexedDB) ------------------------------------------------------------------
    var _db = null;
    function db() {
        if (_db) return _db;
        _db = new Promise(function (res) {
            try {
                var r = indexedDB.open(DB, 1);
                r.onupgradeneeded = function () { try { r.result.createObjectStore(STORE); } catch (e) { swallow(e, 'upgrade'); } };
                r.onsuccess = function () { res(r.result); };
                r.onerror = function () { res(null); };
                r.onblocked = function () { res(null); };
            } catch (e) { res(null); }
        });
        return _db;
    }
    function ulozFoto(dataUrl) {
        var id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        return db().then(function (d) {
            if (!d) throw new Error('Fotky se v tomhle prohlížeči nedají uložit.');
            return new Promise(function (res, rej) {
                try { var tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(dataUrl, id); tx.oncomplete = function () { res(id); }; tx.onerror = function () { rej(tx.error); }; }
                catch (e) { rej(e); }
            });
        });
    }
    function foto(fotoId) {
        if (!fotoId) return Promise.resolve(null);
        return db().then(function (d) {
            if (!d) return null;
            return new Promise(function (res) {
                try { var q = d.transaction(STORE, 'readonly').objectStore(STORE).get(fotoId); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }
                catch (e) { res(null); }
            });
        });
    }
    function smer() { try { if (typeof smoothedHeading === 'number' && isFinite(smoothedHeading)) return Math.round(((smoothedHeading % 360) + 360) % 360); } catch (e) { swallow(e, 'smer'); } return null; }
    function zmensi(file) {
        return new Promise(function (res, rej) {
            var fr = new FileReader();
            fr.onload = function () {
                var img = new Image();
                img.onload = function () {
                    var max = 1280, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
                    var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    try { res(c.toDataURL('image/jpeg', 0.72)); } catch (e) { rej(e); }
                };
                img.onerror = function () { rej(new Error('Fotku se nepodařilo přečíst.')); };
                img.src = fr.result;
            };
            fr.onerror = function () { rej(fr.error); };
            fr.readAsDataURL(file);
        });
    }
    // Vyfotit: systémová kamera (input capture). Azimut se bere v okamžiku klepnutí na „Vyfotit"
    // — telefon v tu chvíli míří tam, kam bude fotit (přesnější hledáček má js/geo-foto.js,
    // tady jde o „odkud se dívat", na pár stupních nezáleží). Vrací { foto: id, az, dataUrl }.
    function porizFoto() {
        var az = smer();
        return new Promise(function (res, rej) {
            var inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
            inp.style.display = 'none';
            inp.addEventListener('change', function () {
                var f = inp.files && inp.files[0];
                try { inp.remove(); } catch (e) { swallow(e, 'inp'); }
                if (!f) { rej(new Error('zrušeno')); return; }
                zmensi(f).then(function (u) { return ulozFoto(u).then(function (id) { res({ foto: id, az: az, dataUrl: u }); }); }).catch(rej);
            });
            document.body.appendChild(inp);
            inp.click();
        });
    }

    // ---- FOTKA PŘES KAMERU („postav se sem a dívej se tímhle směrem") -------------------------
    // Živý obraz z kamery a přes něj poloprůhledná fotka místa; posuvník průhlednosti. Nahoře
    // šipka, o kolik se otočit, aby telefon mířil tam, kam se dívala fotka.
    var _ov = null, _stream = null, _tik = null;
    function zavriKameru() {
        if (_tik) { clearInterval(_tik); _tik = null; }
        if (_stream) { try { _stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { swallow(e, 'stop'); } _stream = null; }
        if (_ov) { try { _ov.remove(); } catch (e) { swallow(e, 'ov'); } _ov = null; }
    }
    function kameraSFotkou(fotoId, azFoto) {
        zavriKameru();
        return foto(fotoId).then(function (u) {
            if (!u) throw new Error(T('Fotka v telefonu není.'));
            _ov = document.createElement('div');
            _ov.id = 'ag-pole-kam';
            _ov.setAttribute('data-ag-mini-off', '');
            _ov.style.cssText = 'position:fixed;inset:0;z-index:2000001;background:#000;display:flex;flex-direction:column;';
            _ov.innerHTML = '<div style="position:relative;flex:1 1 auto;overflow:hidden;">'
                + '<video autoplay playsinline muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"></video>'
                + '<img alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.5;pointer-events:none;">'
                + '<div id="ag-pole-kam-smer" style="position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 10px);text-align:center;color:#fff;font:700 18px/1.3 system-ui;text-shadow:0 1px 4px #000;"></div></div>'
                + '<div style="padding:12px 16px max(14px, env(safe-area-inset-bottom,0px));background:#0b0f14;color:#fff;display:flex;align-items:center;gap:12px;">'
                + '<span style="font:600 14px system-ui;">' + T('Fotka') + '</span><input type="range" min="0" max="100" value="50" style="flex:1;">'
                + '<button type="button" style="min-height:48px;padding:0 18px;border-radius:14px;border:none;background:#2f9e74;color:#fff;font:700 16px system-ui;">' + T('Zavřít') + '</button></div>';
            document.body.appendChild(_ov);
            var img = _ov.querySelector('img'), vid = _ov.querySelector('video'), rng = _ov.querySelector('input'), sm = _ov.querySelector('#ag-pole-kam-smer');
            img.src = u;
            rng.addEventListener('input', function () { img.style.opacity = String(rng.value / 100); });
            _ov.querySelector('button').addEventListener('click', zavriKameru);
            _tik = setInterval(function () {
                var h = smer();
                if (azFoto == null || h == null) { sm.textContent = azFoto == null ? '' : T('Fotka míří na {a}°', { a: azFoto }); return; }
                var d = ((azFoto - h) % 360 + 540) % 360 - 180;
                sm.textContent = Math.abs(d) <= 10 ? T('✓ Míříš jako fotka') : (d > 0 ? T('Otoč se doprava o {a}°', { a: Math.round(d) }) : T('Otoč se doleva o {a}°', { a: Math.round(-d) }));
            }, 250);
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (s) {
                    if (!_ov) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
                    _stream = s; vid.srcObject = s;
                }).catch(function () { sm.textContent = T('Kamera nejede — fotka je vidět i tak.'); img.style.opacity = '1'; rng.value = 100; });
            }
        });
    }

    window.AGPole = {
        STAB: STAB, info: info, setInfo: setInfo, stav: stav, setStav: setStav, stavText: stavText,
        foto: foto, porizFoto: porizFoto, ulozFoto: ulozFoto, kameraSFotkou: kameraSFotkou, zavriKameru: zavriKameru,
        badge: badge, znak: znak
    };
})();
