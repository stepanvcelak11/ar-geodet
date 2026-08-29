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

    // rozpracovaný výpočet korekce a rozmisťování dat
    var _d = null;          // datová kódová slova
    var _ecc = null;
    var _blok = 0;
    var _poz = 0;
    var _gen = null;
    var _sloupec = 0;
    var _nahoru = true;
    var _bitIdx = 0;
    var _zbytek = null;
    var _genStupen = 0;

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
    //! Kolik datových slov se zpracuje na jeden krok při výpočtu korekce.
    //!
    //! ⚠ TOHLE ROZDĚLENÍ JE NUTNÉ. Verze 9 (sedm bodů) znamená dva bloky po
    //! 116 datových slovech a generátor o 31 členech, tedy přes SEDM TISÍC
    //! násobení v Galoisově tělese. V jednom volání to hodinky odstřelí
    //! watchdogem — a projeví se to pádem aplikace hned při otevření QR.
    //! U malé dávky (verze 3) to prošlo, proto to dlouho nebylo vidět.
    const DAVKA_ECC = 20;

    function krok() {
        if (hotovo) { return true; }
        if (_faze == 0) { _pripravData();  _faze = 1; return false; }
        if (_faze == 1) { if (_generatorKrok()) { _faze = 2; } return false; }
        if (_faze == 2) { if (_eccKrok()) { _faze = 3; } return false; }
        if (_faze == 3) { _vzory();  _faze = 4; _sloupec = _n - 1; _nahoru = true; return false; }
        if (_faze == 4) { if (_dataKrok()) { _faze = 5; } return false; }
        _format();
        hotovo = true;
        return true;
    }

    // ---- data a korekce ----------------------------------------------

    //! Připraví datová kódová slova (bitový proud, výplň). Rychlé.
    function _pripravData() {
        var bloku = BLOKY[_verze][0];
        var dat = BLOKY[_verze][1];
        var eccN = BLOKY[_verze][2];
        var kapacit = bloku * dat;

        var bajty = _bajty(_text);
        var d = new [kapacit]b;
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

        _d = d;
        _ecc = new [bloku * eccN]b;
        for (i = 0; i < _ecc.size(); i++) { _ecc[i] = 0; }
        // ⚠ Generátor se NESESTAVUJE tady. Pro 30 opravných slov to je přes
        // 460 násobení v Galoisově tělese a 31 rostoucích polí — v jednom
        // volání to hodinky odstřelí watchdogem (odchyceno v simulátoru:
        // pád byl přímo v _generator). Staví se po jednom stupni.
        _gen = new [1]b;
        _gen[0] = 1;
        _genStupen = 0;
        _blok = 0;
        _poz = 0;
    }

    //! Jeden stupeň generátorového polynomu na krok.
    function _generatorKrok() {
        var eccN = BLOKY[_verze][2];
        if (_genStupen >= eccN) { return true; }
        var novy = new [_gen.size() + 1]b;
        for (var j = 0; j < _gen.size(); j++) {
            novy[j] = novy[j] ^ _gen[j];
            novy[j + 1] = novy[j + 1] ^ _nasob(_gen[j], _exp[_genStupen]);
        }
        _gen = novy;
        _genStupen += 1;
        return (_genStupen >= eccN);
    }

    //! Jedna dávka Reed–Solomonova dělení. Vrací true, až je hotová korekce
    //! všech bloků a slova jsou proložená.
    function _eccKrok() {
        var bloku = BLOKY[_verze][0];
        var dat = BLOKY[_verze][1];
        var eccN = BLOKY[_verze][2];

        if (_poz == 0) {
            // zbytek se rozpracuje do _ecc na místě bloku
            _zbytek = new [dat + eccN]b;
            for (var i = 0; i < dat; i++) { _zbytek[i] = _d[_blok * dat + i]; }
            for (var i2 = dat; i2 < dat + eccN; i2++) { _zbytek[i2] = 0; }
        }

        var konec = _poz + DAVKA_ECC;
        if (konec > dat) { konec = dat; }
        for (var i3 = _poz; i3 < konec; i3++) {
            var f = _zbytek[i3];
            if (f == 0) { continue; }
            for (var j = 0; j < _gen.size(); j++) {
                _zbytek[i3 + j] = _zbytek[i3 + j] ^ _nasob(_gen[j], f);
            }
        }
        _poz = konec;
        if (_poz < dat) { return false; }

        for (var k = 0; k < eccN; k++) { _ecc[_blok * eccN + k] = _zbytek[dat + k]; }
        _blok += 1;
        _poz = 0;
        _zbytek = null;
        if (_blok < bloku) { return false; }

        _proloz();
        return true;
    }

    //! Proložení bloků — u verzí 1–9 jsou stejně velké, takže stačí střídat.
    function _proloz() {
        var bloku = BLOKY[_verze][0];
        var dat = BLOKY[_verze][1];
        var eccN = BLOKY[_verze][2];
        var ven = new [bloku * (dat + eccN)]b;
        var p = 0;
        var i;
        for (i = 0; i < dat; i++) {
            for (var b = 0; b < bloku; b++) { ven[p] = _d[b * dat + i]; p += 1; }
        }
        for (i = 0; i < eccN; i++) {
            for (var b2 = 0; b2 < bloku; b2++) { ven[p] = _ecc[b2 * eccN + i]; p += 1; }
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
        // `new [n]b` vrací pole už vynulované — projít 2809 buněk dvakrát
        // navíc je přesně ta práce, kterou si tady nemůžeme dovolit.
        _m = new [n * n]b;
        _rez = new [n * n]b;
        var i;

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

    //! Rozmisťování dat klikatou cestou — po JEDNOM SLOUPCI na krok.
    //!
    //! ⚠ Taky rozdělené: matice verze 9 má 53×53 = 2809 buněk a projít je
    //! najednou je stejná cesta k watchdogu jako u korekce.
    function _dataKrok() {
        var n = _n;
        var celkem = _slova.size() * 8;

        if (_sloupec == 6) { _sloupec -= 1; }
        for (var k = 0; k < n; k++) {
            var r = _nahoru ? (n - 1 - k) : k;
            for (var d = 0; d < 2; d++) {
                var c = _sloupec - d;
                if (c < 0) { continue; }
                if (_rez[r * n + c] != 0) { continue; }
                var b = 0;
                if (_bitIdx < celkem) {
                    b = (_slova[_bitIdx / 8] >> (7 - (_bitIdx % 8))) & 1;
                }
                _bitIdx += 1;
                if ((r + c) % 2 == 0) { b = b ^ 1; }      // maska 0
                _m[r * n + c] = b;
            }
        }
        _sloupec -= 2;
        _nahoru = !_nahoru;
        return (_sloupec <= 0);
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
