# -*- coding: utf-8 -*-
"""Vygeneruje PNG ikony AR Geodet překreslením icon.svg přes PIL.

SVG je jednoduchá geometrie (zaoblený čtverec + rohové závorky + kružnice +
kříž + středový terč), takže ji lze v PIL reprodukovat 1:1 bez SVG rasterizéru.
Kreslí se v supersamplingu 4x a downscaluje (antialiasing).

Výstupy (do kořene repa):
  icon-192.png, icon-512.png            – purpose "any" (zaoblený čtverec jako SVG)
  icon-maskable-192.png, icon-maskable-512.png – purpose "maskable" (pozadí přes
        celý čtverec, motiv zmenšený do bezpečné zóny ~80 %)
  apple-touch-icon.png (180x180)        – iOS si rohy zaobluje samo → plný čtverec
"""
import sys
from PIL import Image, ImageDraw

SS = 4  # supersampling


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def diag_gradient(size, c0, c1):
    """Diagonální gradient (0,0)->(1,1) jako v SVG linearGradient."""
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * (size - 1))
            px[x, y] = lerp(c0, c1, t)
    return img


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_motif(draw, s, cx, cy, scale, bracket_color):
    """Vykreslí závorky + kružnice + kříž + terč. Souřadnice dle SVG (512 grid).

    s = přepočet: kolik px (v supersamplovaném plátně) je 1 jednotka SVG.
    scale = dodatečné zmenšení motivu kolem středu (pro maskable)."""
    def P(x, y):
        return (cx + (x - 256) * s * scale, cy + (y - 256) * s * scale)

    def W(w):
        return max(1, round(w * s * scale))

    # rohové závorky — SVG path: rovný úsek + kvadratický bezier (roh) + rovný úsek,
    # stroke-linecap/linejoin round. Bezier navzorkujeme a kreslíme jako polyline
    # s joint='curve'; kulaté konce doplní kolečka o poloměru šířky/2.
    bw = W(16)
    corners = [
        # (start, konec rovné1 = začátek bezieru, ctrl, konec bezieru, konec rovné2)
        ((118, 178), (118, 140), (118, 118), (140, 118), (178, 118)),
        ((334, 118), (372, 118), (394, 118), (394, 140), (394, 178)),
        ((394, 334), (394, 372), (394, 394), (372, 394), (334, 394)),
        ((178, 394), (140, 394), (118, 394), (118, 372), (118, 334)),
    ]
    for start, b0, ctrl, b1, end in corners:
        pts = [P(*start), P(*b0)]
        for i in range(1, 13):
            t = i / 13.0
            x = (1 - t) ** 2 * b0[0] + 2 * (1 - t) * t * ctrl[0] + t ** 2 * b1[0]
            y = (1 - t) ** 2 * b0[1] + 2 * (1 - t) * t * ctrl[1] + t ** 2 * b1[1]
            pts.append((cx + (x - 256) * s * scale, cy + (y - 256) * s * scale))
        pts.append(P(*b1))
        pts.append(P(*end))
        draw.line(pts, fill=bracket_color, width=bw, joint='curve')
        for cap in (pts[0], pts[-1]):
            draw.ellipse([cap[0] - bw / 2, cap[1] - bw / 2, cap[0] + bw / 2, cap[1] + bw / 2], fill=bracket_color)

    # kružnice (stroke-opacity přes světlejší odstín na tmavém pozadí)
    def ring(radius, width, color):
        bb = [P(256 - radius, 256 - radius), P(256 + radius, 256 + radius)]
        draw.ellipse([bb[0][0], bb[0][1], bb[1][0], bb[1][1]], outline=color, width=width)

    ring(74, W(6), (34, 66, 56))     # 3eb487 @ 20 % na tmavém
    ring(50, W(6), (46, 106, 84))    # 3eb487 @ 45 %

    # kříž
    for x1, y1, x2, y2 in [(256, 206, 256, 226), (256, 286, 256, 306), (206, 256, 226, 256), (286, 256, 306, 256)]:
        draw.line([P(x1, y1), P(x2, y2)], fill=(240, 243, 245), width=W(8))

    # středový terč
    bb = [P(256 - 22, 256 - 22), P(256 + 22, 256 + 22)]
    draw.ellipse([bb[0][0], bb[0][1], bb[1][0], bb[1][1]], fill=(62, 180, 135))
    bb = [P(256 - 9, 256 - 9), P(256 + 9, 256 + 9)]
    draw.ellipse([bb[0][0], bb[0][1], bb[1][0], bb[1][1]], fill=(255, 255, 255))


def make_icon(out_path, size, rounded, motif_scale):
    big = size * SS
    s = big / 512.0
    bg = diag_gradient(big, (28, 34, 42), (12, 16, 20))          # g3bg
    canvas = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    canvas.paste(bg, (0, 0))
    draw = ImageDraw.Draw(canvas)
    # závorky mají v SVG gradient 4ccd99->2a945f; střed = 3bb17c
    draw_motif(draw, s, big / 2.0, big / 2.0, motif_scale, (59, 177, 124))
    if rounded:
        mask = rounded_mask(big, int(116 * s))
        out = Image.new('RGBA', (big, big), (0, 0, 0, 0))
        out.paste(canvas, (0, 0), mask)
        canvas = out
    canvas = canvas.resize((size, size), Image.LANCZOS)
    canvas.save(out_path, 'PNG')
    print('OK', out_path)


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    make_icon(root + '/icon-192.png', 192, True, 1.0)
    make_icon(root + '/icon-512.png', 512, True, 1.0)
    make_icon(root + '/icon-maskable-192.png', 192, False, 0.80)
    make_icon(root + '/icon-maskable-512.png', 512, False, 0.80)
    make_icon(root + '/apple-touch-icon.png', 180, False, 0.92)
