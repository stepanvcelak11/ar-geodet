// ===== AR Geodet — LICENCE PRO VERZE (ODPOJITELNÁ vrstva) =====================
// Appka existuje ve dvou vydáních: ZÁKLAD (zdarma, celý den v terénu — změřit,
// vytyčit, zaznamenat, srovnat AR, katastr, import/export zakázky) a PRO
// (placené, přidává navrch protokoly, objemy, firmu a pokročilé výpočty).
// Co je čí, je zapsané na JEDINÉM místě — pole `pro: 1` u záznamu v
// js/tools-registry.js. Tenhle modul řeší jen jednu otázku: MÁ TENHLE TELEFON
// PRO, NEBO NE. Kdo se podle toho zařídí, je js/pro-zamky.js.
//
// ⚠ KLÍČ SE OVĚŘUJE V TELEFONU, BEZ SERVERU. Geodet ho může dostat u kávy a
//   odemknout si Pro v lese bez signálu. Cena za to je, že podepisovací tajemství
//   leží v balíčku appky — kdo ho vydoluje, umí si vyrobit klíč sám. NEDĚLÁM, ŽE
//   TO TAK NENÍ: tohle není zámek proti útočníkovi, je to zámek proti tomu, aby
//   se klíč šířil opisováním po partě. Kdo umí číst minifikovaný JS, umí si
//   stejně tak přepsat `agLicence_v1` v localStorage.
//
// ⚠ PROČ VLASTNÍ SHA-256 A NE crypto.subtle: subtle.digest je (a) asynchronní,
//   takže by se `isPro()` nedalo zavolat při startu dřív, než se začnou
//   registrovat nástroje, a (b) na `file://` a v nezabezpečeném kontextu vůbec
//   NENÍ. Kdyby se pro ten případ padalo na náhradní otisk (jak to dělá
//   hashPin() v js/ucty.js), vyšel by JINÝ podpis než ten, kterým byl klíč
//   vyroben — a klíč by v tom prohlížeči nešel odemknout. Vlastní implementace
//   je stejná všude a je synchronní.
//
// TVAR KLÍČE:  ARG-XXXX-XXXX-XXXX-XXXX   (16 znaků, base32 bez I/L/O/U, aby
//   nešlo splést 1/I, 0/O — klíč se opisuje z papíru nebo z SMS)
//   10 bajtů:  [0] verze formátu
//              [1..2] pořadové číslo klíče (kvůli budoucímu odvolání)
//              [3..4] platnost do = počet dní od 1. 1. 2026, 0 = navždy
//              [5..9] zkrácený HMAC-SHA256 přes prvních pět bajtů
//
// ⚠ POŘADOVÉ ČÍSLO JE TAM SCHVÁLNĚ, i když ho zatím nikdo nečte. Až bude potřeba
//   odvolat konkrétní klíč (vrácené peníze, klíč vytrouben na fóru), stačí jeho
//   číslo přidat do `flags` na serveru — kanál, kterým appka bere vypínač modulů
//   (js/priznaky.js), chodí tak jako tak a klíč se tím zneplatní BEZ ZMĚNY
//   FORMÁTU, takže dosud vydané klíče zůstanou platné. Kdyby se číslo do klíče
//   nedalo teď, musely by se všechny klíče jednou vyměnit.
//
// API (window.AGLic):
//   isPro()            — má tenhle telefon Pro? (synchronní, platí i při startu)
//   stav()             — { pro, cislo, do, dniDoKonce } nebo { pro:false }
//   over(klic)         — { ok, duvod, cislo, do } bez ukládání
//   uloz(klic)         — ověří a uloží; true/false; vyvolá 'aglic:zmena'
//   zrus()             — smaže licenci z telefonu
//   vyrob(cislo, dni)  — vyrobí klíč (používá Konzole vlastníka; je to tady,
//                        aby se výroba a ověření NIKDY nerozešly)
//
// Odstranění: smaž tenhle soubor + řádek <script> v index.html + './js/licence.js'
// v sw.js. Bez něj se appka chová jako Základ (js/pro-zamky.js bere chybějící
// AGLic jako „Pro není“).
// ================================================================================
(function () {
    'use strict';
    if (window.AGLic) return;

    var LS = 'agLicence_v1';
    var VERZE = 1;
    var EPOCHA = Date.UTC(2026, 0, 1);      // den 0 pro pole „platnost do“
    var DEN = 86400000;

    // Podepisovací tajemství. ⚠ ZMĚNA TÉHLE HODNOTY ZNEPLATNÍ VŠECHNY DOSUD
    // VYDANÉ KLÍČE — neměnit, ani při úklidu. Že leží v balíčku, je popsané výš.
    var TAJEMSTVI = '1362ffb552e2c4a376bb352ef13da61f';

    // Abeceda bez I, L, O, U: 1/I a 0/O se při opisování pletou, U se plete s V.
    var ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, 'licence:' + kde); } catch (x) { } }

    // ---- SHA-256 (vlastní, synchronní; důvod viz hlavička) -----------------------
    var K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    function sha256(bytes) {
        var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        var l = bytes.length, bitLen = l * 8;
        var m = bytes.slice(0);
        m.push(0x80);
        while (m.length % 64 !== 56) m.push(0);
        m.push(0, 0, 0, 0);
        m.push((bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);
        var w = new Array(64);
        for (var i = 0; i < m.length; i += 64) {
            for (var t = 0; t < 16; t++) {
                w[t] = ((m[i + t * 4] << 24) | (m[i + t * 4 + 1] << 16) | (m[i + t * 4 + 2] << 8) | m[i + t * 4 + 3]) >>> 0;
            }
            for (t = 16; t < 64; t++) {
                var x = w[t - 15], y = w[t - 2];
                var s0 = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) >>> 0;
                var s1 = (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) >>> 0;
                w[t] = (((w[t - 16] + s0) >>> 0) + ((w[t - 7] + s1) >>> 0)) >>> 0;
            }
            var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
            for (t = 0; t < 64; t++) {
                var S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
                var ch = ((e & f) ^ (~e & g)) >>> 0;
                var t1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
                var S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
                var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
                var t2 = (S0 + maj) >>> 0;
                hh = g; g = f; f = e; e = (d + t1) >>> 0;
                d = c; c = b; b = a; a = (t1 + t2) >>> 0;
            }
            h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
            h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
        }
        var out = [];
        for (i = 0; i < 8; i++) out.push((h[i] >>> 24) & 255, (h[i] >>> 16) & 255, (h[i] >>> 8) & 255, h[i] & 255);
        return out;
    }
    function bytesOf(s) {
        var out = [];
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c < 128) out.push(c);
            else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
            else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
        }
        return out;
    }
    function hmac(klicStr, zprava) {
        var key = bytesOf(klicStr);
        if (key.length > 64) key = sha256(key);
        while (key.length < 64) key.push(0);
        var ipad = [], opad = [];
        for (var i = 0; i < 64; i++) { ipad.push(key[i] ^ 0x36); opad.push(key[i] ^ 0x5c); }
        return sha256(opad.concat(sha256(ipad.concat(zprava))));
    }

    // ---- base32 (abeceda bez matoucích znaků) -----------------------------------
    function enc(bytes) {
        var bits = 0, val = 0, out = '';
        for (var i = 0; i < bytes.length; i++) {
            val = (val << 8) | bytes[i]; bits += 8;
            while (bits >= 5) { out += ABC[(val >>> (bits - 5)) & 31]; bits -= 5; }
        }
        if (bits > 0) out += ABC[(val << (5 - bits)) & 31];
        return out;
    }
    function dec(s) {
        var bits = 0, val = 0, out = [];
        for (var i = 0; i < s.length; i++) {
            var idx = ABC.indexOf(s.charAt(i));
            if (idx < 0) return null;
            val = (val << 5) | idx; bits += 5;
            if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
        }
        return out;
    }

    // Očista opsaného klíče: pomlčky a mezery pryč, malá písmena nahoru a záměny,
    // které lidi při opisování dělají pořád dokola (0/O, 1/I nebo l, V/U).
    function ocisti(s) {
        return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
            .replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1').replace(/U/g, 'V')
            .replace(/^ARG/, '');
    }

    // ---- výroba a ověření --------------------------------------------------------
    function vyrob(cislo, dni) {
        cislo = Math.max(0, Math.min(65535, cislo | 0));
        var d = 0;
        if (dni && dni > 0) d = Math.max(1, Math.min(65535, Math.round((Date.now() - EPOCHA) / DEN) + (dni | 0)));
        var telo = [VERZE, (cislo >>> 8) & 255, cislo & 255, (d >>> 8) & 255, d & 255];
        var sig = hmac(TAJEMSTVI, telo).slice(0, 5);
        var s = enc(telo.concat(sig));
        return 'ARG-' + s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16);
    }

    function over(klic) {
        var s = ocisti(klic);
        if (s.length !== 16) return { ok: false, duvod: 'tvar' };
        var b = dec(s);
        if (!b || b.length < 10) return { ok: false, duvod: 'tvar' };
        var telo = b.slice(0, 5), sig = b.slice(5, 10);
        if (telo[0] !== VERZE) return { ok: false, duvod: 'verze' };
        var ocek = hmac(TAJEMSTVI, telo).slice(0, 5);
        for (var i = 0; i < 5; i++) if (ocek[i] !== sig[i]) return { ok: false, duvod: 'podpis' };
        var cislo = (telo[1] << 8) | telo[2];
        var d = (telo[3] << 8) | telo[4];
        var doKdy = d ? (EPOCHA + d * DEN) : 0;
        if (doKdy && Date.now() > doKdy) return { ok: false, duvod: 'vyprsel', cislo: cislo, do: doKdy };
        return { ok: true, cislo: cislo, do: doKdy };
    }

    // ---- stav telefonu -----------------------------------------------------------
    // Uloží se SAMOTNÝ KLÍČ, ne příznak „má Pro“. Při každém startu se ověří znovu,
    // takže vypršení platnosti se pozná samo a přepsat v localStorage jedničku
    // nikam nevede — musel by tam někdo podvrhnout platný podpis.
    var _klic = null;
    try { _klic = localStorage.getItem(LS) || null; } catch (e) { swallow(e, 'nacti'); }

    var _stav = _klic ? over(_klic) : { ok: false, duvod: 'nemá' };

    function stav() {
        if (!_stav.ok) return { pro: false, duvod: _stav.duvod || 'nemá' };
        return {
            pro: true, cislo: _stav.cislo, do: _stav.do,
            dniDoKonce: _stav.do ? Math.max(0, Math.ceil((_stav.do - Date.now()) / DEN)) : 0
        };
    }

    window.AGLic = {
        isPro: function () { return !!_stav.ok; },
        stav: stav,
        over: over,
        vyrob: vyrob,
        uloz: function (klic) {
            var r = over(klic);
            if (!r.ok) return r;
            _klic = ocisti(klic);
            _stav = r;
            try { localStorage.setItem(LS, _klic); } catch (e) { swallow(e, 'uloz'); }
            try { window.dispatchEvent(new CustomEvent('aglic:zmena', { detail: stav() })); } catch (e) { swallow(e, 'udalost'); }
            return r;
        },
        zrus: function () {
            _klic = null; _stav = { ok: false, duvod: 'nemá' };
            try { localStorage.removeItem(LS); } catch (e) { swallow(e, 'zrus'); }
            try { window.dispatchEvent(new CustomEvent('aglic:zmena', { detail: stav() })); } catch (e) { swallow(e, 'udalost'); }
        },
        // Které vydání appky je právě sestavené. Nastavuje scripts/build.mjs;
        // ve zdrojích (bez sestavení) je vždycky 'pro', aby šlo vyvíjet obojí.
        vydani: function () { return window.__AG_VYDANI || 'pro'; }
    };
})();
