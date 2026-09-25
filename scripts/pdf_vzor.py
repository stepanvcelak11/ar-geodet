# -*- coding: utf-8 -*-
u"""Malé PDF s textovou vrstvou pro test Body z PDF (bez knihoven — PDF 1.4 ručně, Helvetica).

radky: seznam (y_pt, [(x_pt, text), ...]) — každý kus je samostatný textový objekt, jako ve
skutečné tabulce z výpočetního programu (sloupce zvlášť).
"""


def pdf(radky, sirka=595, vyska=842):
    obsah = []
    for y, kusy in radky:
        for x, txt in kusy:
            t = txt.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            obsah.append('BT /F1 11 Tf %d %d Td (%s) Tj ET' % (x, y, t))
    stream = '\n'.join(obsah).encode('latin-1')
    objs = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        ('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>' % (sirka, vyska)).encode(),
        b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    out = bytearray(b'%PDF-1.4\n')
    ofs = []
    for i, o in enumerate(objs):
        ofs.append(len(out))
        out += ('%d 0 obj\n' % (i + 1)).encode() + o + b'\nendobj\n'
    xref = len(out)
    out += ('xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)).encode()
    for o in ofs:
        out += ('%010d 00000 n \n' % o).encode()
    out += ('trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xref)).encode()
    return bytes(out)


SEZNAM = [
    (790, [(60, 'Seznam souradnic - zakazka Test 2026')]),
    (760, [(60, 'Cislo'), (160, 'Y'), (280, 'X'), (400, 'Z')]),
    (740, [(60, '4001'), (160, '743215.423'), (280, '1042118.375'), (400, '245.318')]),   # sloupce zvlášť
    (722, [(60, '4002'), (160, '743298.10'), (280, '1042071.55'), (400, '244.87')]),
    (704, [(60, '4003  743240.05  1042133.02  245.66')]),                                # celý řádek najednou
    (660, [(60, 'Vypracoval: Test, 24. 9. 2026')]),
]

if __name__ == '__main__':
    import sys
    open(sys.argv[1] if len(sys.argv) > 1 else 'vzor.pdf', 'wb').write(pdf(SEZNAM))
