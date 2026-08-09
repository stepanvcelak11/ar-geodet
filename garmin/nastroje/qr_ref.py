# Referencni implementace QR kodu, kterou pak doslova prepisu do Monkey C.
#
# PROC TAKHLE: kodovani QR (Reed-Solomon nad GF(256), rozmisteni, maska) je
# presne ten druh kodu, kde se chyba pozna az tim, ze to skener neprecte -
# a ladit ho naslepo primo v hodinkach by bylo peklo. Napise se tedy nejdriv
# tady, overi skutecnym skenerem (jsQR, tentyz, co ma appka), a teprve pak
# se prepise. Vysledna matice z hodinek se pak porovna s touhle - musi sedet
# bit po bitu.
#
# ROZSAH: verze 1-9, uroven korekce L, rezim Byte, maska 0 napevno.
#   - verze 9 pojme 232 bajtu, coz je ~7 bodu ve formatu AG1 (overeno v teren)
#   - vic se stejne na 260px displej nevejde citelne
#   - maska 0 je legalni volba; vyber nejlepsi z osmi by stal cas navic
#     a hodinky maji watchdog
import sys

# (bloku, datovych slov na blok, ECC slov na blok) pro uroven L
BLOKY = {1: (1, 19, 7), 2: (1, 34, 10), 3: (1, 55, 15), 4: (1, 80, 20),
         5: (1, 108, 26), 6: (2, 68, 18), 7: (2, 78, 20), 8: (2, 97, 24),
         9: (2, 116, 30)}

ZAROVNANI = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
             6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46]}

VERZE_INFO = {7: 0x07C94, 8: 0x085BC, 9: 0x09A99}
FORMAT_L_MASKA0 = 0x77C4

_EXP = [0] * 512
_LOG = [0] * 256


def _tabulky():
    x = 1
    for i in range(255):
        _EXP[i] = x
        _LOG[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
    for i in range(255, 512):
        _EXP[i] = _EXP[i - 255]


_tabulky()


def _nasob(a, b):
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _generator(n):
    g = [1]
    for i in range(n):
        novy = [0] * (len(g) + 1)
        for j in range(len(g)):
            novy[j] ^= g[j]
            novy[j + 1] ^= _nasob(g[j], _EXP[i])
        g = novy
    return g


def _ecc(data, n):
    g = _generator(n)
    zbytek = list(data) + [0] * n
    for i in range(len(data)):
        k = zbytek[i]
        if k == 0:
            continue
        for j in range(len(g)):
            zbytek[i + j] ^= _nasob(g[j], k)
    return zbytek[len(data):]


def verze_pro(delka):
    for v in range(1, 10):
        b, d, _ = BLOKY[v]
        if b * d >= delka + 3:          # 3 bajty rezie: rezim + delka + ukonceni
            return v
    return None


def kodova_slova(text, verze):
    bloku, dat, ecc_n = BLOKY[verze]
    kapacita = bloku * dat
    bajty = text.encode('utf-8')

    bity = []

    def pridej(hodnota, kolik):
        for i in range(kolik - 1, -1, -1):
            bity.append((hodnota >> i) & 1)

    pridej(0b0100, 4)                   # rezim Byte
    pridej(len(bajty), 8)               # delka (8 bitu pro verze 1-9)
    for b in bajty:
        pridej(b, 8)
    pridej(0, min(4, kapacita * 8 - len(bity)))     # ukonceni
    while len(bity) % 8:
        bity.append(0)

    slova = [int(''.join(str(x) for x in bity[i:i + 8]), 2) for i in range(0, len(bity), 8)]
    vypln = [0xEC, 0x11]
    i = 0
    while len(slova) < kapacita:
        slova.append(vypln[i % 2])
        i += 1

    # rozdeleni na bloky + ECC, pak prokladani (bloky jsou u verzi 1-9 stejne velke)
    bl_data = [slova[i * dat:(i + 1) * dat] for i in range(bloku)]
    bl_ecc = [_ecc(b, ecc_n) for b in bl_data]

    ven = []
    for i in range(dat):
        for b in bl_data:
            ven.append(b[i])
    for i in range(ecc_n):
        for b in bl_ecc:
            ven.append(b[i])
    return ven


def matice(text):
    verze = verze_pro(len(text.encode('utf-8')))
    if verze is None:
        return None, None
    n = 4 * verze + 17
    m = [[None] * n for _ in range(n)]

    def hledacek(r, c):
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                rr, cc = r + dr, c + dc
                if 0 <= rr < n and 0 <= cc < n:
                    okraj = (dr in (-1, 7)) or (dc in (-1, 7))
                    tmave = (not okraj) and (dr in (0, 6) or dc in (0, 6)
                                             or (2 <= dr <= 4 and 2 <= dc <= 4))
                    m[rr][cc] = 1 if tmave else 0

    hledacek(0, 0)
    hledacek(0, n - 7)
    hledacek(n - 7, 0)

    for i in range(8, n - 8):           # casovaci pruhy
        b = 1 if i % 2 == 0 else 0
        m[6][i] = b
        m[i][6] = b

    for a in ZAROVNANI[verze]:          # zarovnavaci znacky
        for b in ZAROVNANI[verze]:
            if (a < 9 and b < 9) or (a < 9 and b > n - 10) or (a > n - 10 and b < 9):
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    m[a + dr][b + dc] = 1 if (max(abs(dr), abs(dc)) != 1) else 0

    m[n - 8][8] = 1                     # vzdy tmavy modul

    # rezervace pro informaci o formatu
    for i in range(9):
        if m[8][i] is None:
            m[8][i] = 0
        if m[i][8] is None:
            m[i][8] = 0
    for i in range(8):
        if m[8][n - 1 - i] is None:
            m[8][n - 1 - i] = 0
        if m[n - 1 - i][8] is None:
            m[n - 1 - i][8] = 0

    rezervovano = [[m[r][c] is not None for c in range(n)] for r in range(n)]

    if verze >= 7:                      # informace o verzi
        vi = VERZE_INFO[verze]
        for i in range(18):
            b = (vi >> i) & 1
            m[i // 3][n - 11 + i % 3] = b
            m[n - 11 + i % 3][i // 3] = b
            rezervovano[i // 3][n - 11 + i % 3] = True
            rezervovano[n - 11 + i % 3][i // 3] = True

    # data klikatou cestou zprava, sloupec 6 se preskakuje
    slova = kodova_slova(text, verze)
    bity = []
    for s in slova:
        for i in range(7, -1, -1):
            bity.append((s >> i) & 1)

    idx = 0
    sloupec = n - 1
    nahoru = True
    while sloupec > 0:
        if sloupec == 6:
            sloupec -= 1
        rady = range(n - 1, -1, -1) if nahoru else range(n)
        for r in rady:
            for c in (sloupec, sloupec - 1):
                if rezervovano[r][c]:
                    continue
                b = bity[idx] if idx < len(bity) else 0
                idx += 1
                if (r + c) % 2 == 0:    # maska 0
                    b ^= 1
                m[r][c] = b
        sloupec -= 2
        nahoru = not nahoru

    f = FORMAT_L_MASKA0                 # informace o formatu (L, maska 0)
    for i in range(6):
        m[8][i] = (f >> (14 - i)) & 1
    m[8][7] = (f >> 8) & 1
    m[8][8] = (f >> 7) & 1
    m[7][8] = (f >> 6) & 1
    for i in range(6):
        m[5 - i][8] = (f >> i) & 1
    for i in range(8):
        m[n - 1 - i][8] = (f >> i) & 1
    for i in range(8):
        m[8][n - 8 + i] = (f >> (7 - i)) & 1
    m[n - 8][8] = 1

    return verze, m


if __name__ == '__main__':
    v, m = matice(sys.argv[1] if len(sys.argv) > 1 else 'AG1\n1\t50.080000\t14.420000')
    print('verze', v, 'modulu', len(m))
    for r in m:
        print(''.join('#' if x else '.' for x in r))
