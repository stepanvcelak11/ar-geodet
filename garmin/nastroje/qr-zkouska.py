# Vyrobi ZKUSEBNI QR kody pro hodinky - jde o to zjistit, jestli se QR
# z transflektivniho MIP displeje vubec da vyfotit a precist.
#
# Pouziva TUTEZ knihovnu, kterou ma appka (js/lib/qrcode.min.js), spustenou
# v py_mini_racer - aby zkouska sedela s tim, co pak bude cist js/sdileni.js.
# Format payloadu je proto taky "AG1" (nazev, lat, lon, vyska oddelene tabem).
#
# MEZ, KTERA O VSEM ROZHODUJE: kruhovy displej 260 px, do nej vepsany ctverec
# ma 184 px. QR potrebuje jeste klidovou zonu 4 moduly z kazde strany, takze
# plati (pocet_modulu + 8) * px_na_modul <= 184.
#   3 px/modul -> max 53 modulu (verze 9)  -> ~230 znaku -> ~7 bodu
#   2 px/modul -> max 84 modulu (verze 16) -> ~510 znaku -> ~17 bodu
import io, os, struct, sys, zlib

from py_mini_racer import MiniRacer

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LIB = os.path.join(REPO, 'js', 'lib', 'qrcode.min.js')
VEN = os.path.join(REPO, 'garmin', 'hodinky', 'resources', 'drawables')

STRANA = 184          # vepsany ctverec do kruhu 260 px
KLID = 4              # klidova zona v modulech (norma)


def body(n, delka_radku=30):
    """n bodu ve formatu AG1 - realisticka delka, ne vata."""
    radky = ['AG1']
    for i in range(n):
        radky.append('%d\t%.6f\t%.6f\t%.2f' % (i + 1, 50.080000 + i * 0.000123,
                                               14.420000 + i * 0.000131, 300.0 + i))
    return '\n'.join(radky)


def matice(ctx, text):
    ctx.eval('var _t = %s;' % _js_str(text))
    ctx.eval("var _q = qrcode(0, 'L'); _q.addData(_t, 'Byte'); _q.make();")
    n = ctx.eval('_q.getModuleCount()')
    radky = ctx.eval(
        "(function(){var o=[];for(var r=0;r<_q.getModuleCount();r++){var s='';"
        "for(var c=0;c<_q.getModuleCount();c++){s+=_q.isDark(r,c)?'1':'0';}o.push(s);}"
        "return o.join('|');})()")
    return n, radky.split('|')


def _js_str(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\t', '\\t') + '"'


def png(cesta, pixely, sirka):
    raw = bytearray()
    for y in range(sirka):
        raw.append(0)
        for x in range(sirka):
            raw.extend(pixely(x, y))

    def chunk(typ, data):
        c = typ + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', sirka, sirka, 8, 6, 0, 0, 0)      # RGBA
    with open(cesta, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
                + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))


def vyrob(ctx, jmeno, px, cil_bodu):
    """Zkousi ubirat body, dokud se QR pri dane hustote nevejde do ctverce."""
    n = cil_bodu
    while n > 0:
        text = body(n)
        modulu, m = matice(ctx, text)
        celkem = (modulu + 2 * KLID) * px
        if celkem <= STRANA:
            break
        n -= 1
    if n == 0:
        print('  %s: nevejde se ani jeden bod' % jmeno)
        return None

    celkem = (modulu + 2 * KLID) * px
    okraj = KLID * px
    bila = (255, 255, 255, 255)
    cerna = (0, 0, 0, 255)

    def pix(x, y):
        mx = (x - okraj) // px
        my = (y - okraj) // px
        if 0 <= mx < modulu and 0 <= my < modulu and m[my][mx] == '1':
            return cerna
        return bila

    cesta = os.path.join(VEN, jmeno + '.png')
    png(cesta, pix, celkem)
    print('  %s: %d bodu, %d znaku, verze %d (%d modulu), %d px/modul -> obrazek %d px, %d B'
          % (jmeno, n, len(text), (modulu - 17) // 4, modulu, px, celkem, os.path.getsize(cesta)))
    return n


def main():
    ctx = MiniRacer()
    # knihovna je UMD - bez okna se navesi na globalni objekt sama
    ctx.eval('var window = this; var module = undefined; var exports = undefined;')
    ctx.eval(io.open(LIB, encoding='utf-8').read())

    os.makedirs(VEN, exist_ok=True)
    print('zkusebni QR (vepsany ctverec %d px, klidova zona %d moduly):' % (STRANA, KLID))
    vyrob(ctx, 'qr_husty', 2, 20)     # ambiciozni: hodne bodu, drobne moduly
    vyrob(ctx, 'qr_ridky', 3, 10)     # opatrny: min bodu, ctivejsi
    return 0


if __name__ == '__main__':
    sys.exit(main())
