using Toybox.Lang;

//! Generátor QR kódu — verze 1–9, úroveň korekce L, režim Byte, maska 0.
//!
//! Slouží k vynesení bodů z hodinek do mobilu tam, kde není signál: kód se
//! ukáže na displeji a appka ho přečte svým skenerem (js/sdileni.js, formát
//! AG1). Proto to musí umět hodinky samy — server by v takovém místě stejně
//! nebyl k dispozici.
//!
//! ⚠ NENÍ TO PSANÉ NASLEPO. Tentýž algoritmus je v garmin/nastroje/qr_ref.py
//! a je ověřený skutečným skenerem (jsQR, tentýž, který má aplikace) na
//! velikostech 32 / 90 / 148 / 206 bajtů. Matice odsud musí sedět s tou
//! pythonovskou bit po bitu — jinak je chyba tady.
//!
//! ⚠ POČÍTÁ SE PO DÁVKÁCH. Verze 9 znamená kolem 7000 operací v Galoisově
//! tělese a matici 53×53; v jednom volání to hodinky odstřelí watchdogem.
//! Volající proto opakovaně volá krok() a čeká, až vrátí true.
//!
//! Maska 0 je zvolená napevno. Je to legální volba a vyhodnocovat všech osm
//! podle trestných bodů by stálo čas, který tu není.
module Qr {

    //! [bloků, datových slov na blok, ECC slov na blok] pro úroveň L
    var BLOKY;
    var ZAROVNANI;

    const FORMAT_L_MASKA0 = 0x77C4;

    var _exp = null;
    var _log = null;

    // rozdělaný výpočet
    var _text = "";
    var _verze = 0;
    var _n = 0;
    var _faze = 0;
    var _radek = 0;
    var _slova = null;
    var _m = null;          // matice, ByteArray n*n
    var _rez = null;        // co je rezervované (vzory), ByteArray n*n
    var hotovo = false;

    function _tabulky() {
        if (_exp != null) { return; }
        _exp = new [512]b;
        _log = new [256]b;
        var x = 1;
        for (var i = 0; i < 255; i++) {
            _exp[i] = x;
            _log[x] = i;
            x = x << 1;
            if ((x & 0x100) != 0) { x = x ^ 0x11D; }
        }
        for (var i = 255; i < 512; i++) { _exp[i] = _exp[i - 255]; }

        BLOKY = [null, [1, 19, 7], [1, 34, 10], [1, 55, 15], [1, 80, 20],
                 [1, 108, 26], [2, 68, 18], [2, 78, 20], [2, 97, 24], [2, 116, 30]];
        ZAROVNANI = [null, [], [6, 18], [6, 22], [6, 26], [6, 30],
                     [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46]];
    }

    //! Text jako čisté UTF-8 bajty.
    //!
    //! ⚠ `toUtf8Array` přidává ukončovací nulu. Kdyby se dostala do kódu,
    //! mobil by přečetl text s přílepkem. Kontroluje se to podmínkou, ne
    //! natvrdo — kdyby se to v budoucí verzi SDK změnilo, projde obojí.
    function _bajty(text) {
        var b = text.toUtf8Array();
        if (b.size() > 0 && b[b.size() - 1] == 0) {
            b = b.slice(0, b.size() - 1);
        }
        return b;
    }

    function _nasob(a, b) {
        if (a == 0 || b == 0) { return 0; }
        return _exp[_log[a] + _log[b]];
    }

    //! Kolik bajtů se do dané verze vejde (bez režie).
    function kapacita(verze) {
        _tabulky();
        if (verze < 1 || verze > 9) { return 0; }
        return BLOKY[verze][0] * BLOKY[verze][1] - 3;
    }

    function verzePro(delka) {
        _tabulky();
        for (var v = 1; v <= 9; v++) {
            if (BLOKY[v][0] * BLOKY[v][1] >= delka + 3) { return v; }
        }
        return 0;
    }

    //! Zahájí výpočet pro daný text. Vrací false, když se text nevejde.
    function zacni(text) {
        _tabulky();
        hotovo = false;
        _text = text;
        // délka se musí měřit v BAJTECH, ne ve znacích — diakritika je
        // dvoubajtová a podle znaků by vyšla moc malá verze
        _verze = verzePro(_bajty(text).size());
        if (_verze == 0) { return false; }
        _n = 4 * _verze + 17;
        _faze = 0;
        _radek = 0;
        _slova = null;
        _m = null;
        _rez = null;
        return true;
    }

    function modulu() { return _n; }

    function tmavy(r, c) {
        if (_m == null) { return false; }
        return _m[r * _n + c] != 0;
    }

    //! Jeden krok výpočtu. Vrací true, až je hotovo.
    function krok() {
        if (hotovo) { return true; }
        if (_faze == 0) { _kodovaSlova(); _faze = 1; return false; }
        if (_faze == 1) { _vzory(); _faze = 2; _radek = 0; return false; }
        if (_faze == 2) { _data(); _faze = 3; return false; }
        _format();
        hotovo = true;
        return true;
    }

    // ---- data a korekce ----------------------------------------------

    function _kodovaSlova() {
        var bloku = BLOKY[_verze][0];
        var dat = BLOKY[_verze][1];
        var eccN = BLOKY[_verze][2];
        var kapacit = bloku * dat;

        // bitový proud: režim Byte, délka, data, ukončení, výplň
        var bajty = _bajty(_text);
        var d = new [kapacit]b;
        var poz = 0;

        // 4 bity režimu + 8 bitů délky se do bajtů nelámou zarovnaně,
        // proto se skládá po bitech do pomocného pole
        var bity = 4 + 8 + bajty.size() * 8;
        var bitPole = new [kapacit * 8]b;
        var i;
        for (i = 0; i < 4; i++) { bitPole[i] = (0x4 >> (3 - i)) & 1; }
        for (i = 0; i < 8; i++) { bitPole[4 + i] = (bajty.size() >> (7 - i)) & 1; }
        for (var j = 0; j < bajty.size(); j++) {
            for (i = 0; i < 8; i++) { bitPole[12 + j * 8 + i] = (bajty[j] >> (7 - i)) & 1; }
        }
        while (bity % 8 != 0) { bitPole[bity] = 0; bity += 1; }

        var slov = bity / 8;
        for (i = 0; i < slov; i++) {
            var b = 0;
            for (var k = 0; k < 8; k++) { b = (b << 1) | bitPole[i * 8 + k]; }
            d[i] = b;
        }
        // výplň se střídá 0xEC / 0x11, jak žádá norma
        for (i = slov; i < kapacit; i++) { d[i] = ((i - slov) % 2 == 0) ? 0xEC : 0x11; }

        // ECC po blocích a proložení (bloky jsou u verzí 1–9 stejně velké)
        var ven = new [kapacit + bloku * eccN]b;
        var ecc = new [bloku * eccN]b;
        for (var b2 = 0; b2 < bloku; b2++) {
            var zbytek = new [dat + eccN]b;
            for (i = 0; i < dat; i++) { zbytek[i] = d[b2 * dat + i]; }
            for (i = dat; i < dat + eccN; i++) { zbytek[i] = 0; }
            var gen = _generator(eccN);
            for (i = 0; i < dat; i++) {
                var f = zbytek[i];
                if (f == 0) { continue; }
                for (var j2 = 0; j2 < gen.size(); j2++) {
                    zbytek[i + j2] = zbytek[i + j2] ^ _nasob(gen[j2], f);
                }
            }
            for (i = 0; i < eccN; i++) { ecc[b2 * eccN + i] = zbytek[dat + i]; }
        }

        var p = 0;
        for (i = 0; i < dat; i++) {
            for (var b3 = 0; b3 < bloku; b3++) { ven[p] = d[b3 * dat + i]; p += 1; }
        }
        for (i = 0; i < eccN; i++) {
            for (var b4 = 0; b4 < bloku; b4++) { ven[p] = ecc[b4 * eccN + i]; p += 1; }
        }
        _slova = ven;
    }

    var _genCache = null;
    var _genN = -1;

    function _generator(n) {
        if (_genN == n && _genCache != null) { return _genCache; }
        var g = new [1]b;
        g[0] = 1;
        for (var i = 0; i < n; i++) {
            var novy = new [g.size() + 1]b;
            for (var j = 0; j < novy.size(); j++) { novy[j] = 0; }
            for (var j2 = 0; j2 < g.size(); j2++) {
                novy[j2] = novy[j2] ^ g[j2];
                novy[j2 + 1] = novy[j2 + 1] ^ _nasob(g[j2], _exp[i]);
            }
            g = novy;
        }
        _genCache = g;
        _genN = n;
        return g;
    }

    // ---- pevné vzory --------------------------------------------------

    function _vzory() {
        var n = _n;
        _m = new [n * n]b;
        _rez = new [n * n]b;
        var i;
        for (i = 0; i < n * n; i++) { _m[i] = 0; _rez[i] = 0; }

        _hledacek(0, 0);
        _hledacek(0, n - 7);
        _hledacek(n - 7, 0);

        for (i = 8; i < n - 8; i++) {          // časovací pruhy
            var b = (i % 2 == 0) ? 1 : 0;
            _polozId(6, i, b);
            _polozId(i, 6, b);
        }

        var za = ZAROVNANI[_verze];
        for (i = 0; i < za.size(); i++) {
            for (var j = 0; j < za.size(); j++) {
                var a = za[i], b2 = za[j];
                if ((a < 9 && b2 < 9) || (a < 9 && b2 > n - 10) || (a > n - 10 && b2 < 9)) { continue; }
                for (var dr = -2; dr <= 2; dr++) {
                    for (var dc = -2; dc <= 2; dc++) {
                        var kraj = (dr < -1 || dr > 1 || dc < -1 || dc > 1);
                        var stred = (dr == 0 && dc == 0);
                        _polozId(a + dr, b2 + dc, (kraj || stred) ? 1 : 0);
                    }
                }
            }
        }

        _polozId(n - 8, 8, 1);                 // vždy tmavý modul

        for (i = 0; i < 9; i++) {              // rezervace pro formát
            _rez[8 * n + i] = 1;
            _rez[i * n + 8] = 1;
        }
        for (i = 0; i < 8; i++) {
            _rez[8 * n + (n - 1 - i)] = 1;
            _rez[(n - 1 - i) * n + 8] = 1;
        }

        if (_verze >= 7) {                     // informace o verzi
            var vi = (_verze == 7) ? 0x07C94 : ((_verze == 8) ? 0x085BC : 0x09A99);
            for (i = 0; i < 18; i++) {
                var b3 = (vi >> i) & 1;
                _polozId(i / 3, n - 11 + i % 3, b3);
                _polozId(n - 11 + i % 3, i / 3, b3);
            }
        }
    }

    function _polozId(r, c, b) {
        if (r < 0 || c < 0 || r >= _n || c >= _n) { return; }
        _m[r * _n + c] = b;
        _rez[r * _n + c] = 1;
    }

    function _hledacek(r, c) {
        for (var dr = -1; dr <= 7; dr++) {
            for (var dc = -1; dc <= 7; dc++) {
                var okraj = (dr == -1 || dr == 7 || dc == -1 || dc == 7);
                var tmave = (!okraj) && (dr == 0 || dr == 6 || dc == 0 || dc == 6
                            || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
                _polozId(r + dr, c + dc, tmave ? 1 : 0);
            }
        }
    }

    // ---- data klikatou cestou ----------------------------------------

    function _data() {
        var n = _n;
        var idx = 0;
        var celkem = _slova.size() * 8;
        var sloupec = n - 1;
        var nahoru = true;

        while (sloupec > 0) {
            if (sloupec == 6) { sloupec -= 1; }
            for (var k = 0; k < n; k++) {
                var r = nahoru ? (n - 1 - k) : k;
                for (var d = 0; d < 2; d++) {
                    var c = sloupec - d;
                    if (_rez[r * n + c] != 0) { continue; }
                    var b = 0;
                    if (idx < celkem) {
                        b = (_slova[idx / 8] >> (7 - (idx % 8))) & 1;
                    }
                    idx += 1;
                    if ((r + c) % 2 == 0) { b = b ^ 1; }      // maska 0
                    _m[r * n + c] = b;
                }
            }
            sloupec -= 2;
            nahoru = !nahoru;
        }
    }

    function _format() {
        var n = _n;
        var f = FORMAT_L_MASKA0;
        var i;
        for (i = 0; i < 6; i++) { _m[8 * n + i] = (f >> (14 - i)) & 1; }
        _m[8 * n + 7] = (f >> 8) & 1;
        _m[8 * n + 8] = (f >> 7) & 1;
        _m[7 * n + 8] = (f >> 6) & 1;
        for (i = 0; i < 6; i++) { _m[(5 - i) * n + 8] = (f >> i) & 1; }
        for (i = 0; i < 8; i++) { _m[(n - 1 - i) * n + 8] = (f >> i) & 1; }
        for (i = 0; i < 8; i++) { _m[8 * n + (n - 8 + i)] = (f >> (7 - i)) & 1; }
        _m[(n - 8) * n + 8] = 1;
    }
}
