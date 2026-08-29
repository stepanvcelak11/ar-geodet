# -*- coding: utf-8 -*-
"""Grafika pro Google Play: feature graphic 1024x500 + úprava screenshotů.

Spuštění (z kořene repa):  python play/make-play-graphics.py

Co dělá:
  1) play/feature-graphic.png  — 1024x500, povinný banner v Play Console.
     Kreslí se ze stejné geometrie jako ikona (znovupoužije draw_motif
     z make-icons.py), takže banner a ikona vypadají jako jedna rodina.

  2) play/screenshoty/*.png    — přerovnané screenshoty z telefonu.
     ⚠ Play NEBERE poměr stran, kde je delší strana víc než 2x delší než
     kratší. Originály z iPhonu jsou 1179x2556 (poměr 2,17) → Console je
     odmítne. Proto se ustřihne stavový řádek (hodiny/baterie z iOS, na
     androidím listingu působí divně) a zbytek se vycentruje na plátno
     v poměru 9:16 s pozadím appky.
"""
import importlib.util
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'play')
SHOTS = os.path.join(OUT, 'screenshoty')

BG0, BG1 = (28, 34, 42), (12, 16, 20)      # stejné jako icon.svg
ACCENT = (76, 205, 153)
TEXT = (232, 237, 242)
MUTED = (139, 147, 161)

FONT_DIR = os.environ.get('WINDIR', 'C:/Windows') + '/Fonts/'


def font(name, size):
    for cand in (FONT_DIR + name, name):
        try:
            return ImageFont.truetype(cand, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def _icons_module():
    """Načte make-icons.py (pomlčka v názvu → nejde běžný import)."""
    spec = importlib.util.spec_from_file_location('mkicons', os.path.join(ROOT, 'make-icons.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def diag_gradient(w, h, c0, c1):
    img = Image.new('RGB', (w, h))
    px = img.load()
    denom = float(w + h - 2) or 1.0
    for y in range(h):
        for x in range(w):
            t = (x + y) / denom
            px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
    return img


def feature_graphic(path, w=1024, h=500):
    SS = 2                                   # supersampling kvůli hranám
    W, H = w * SS, h * SS
    img = diag_gradient(W, H, BG0, BG1)
    d = ImageDraw.Draw(img, 'RGBA')

    # jemná mřížka (motiv z pozadí appky)
    step = 40 * SS
    for x in range(0, W, step):
        d.line([(x, 0), (x, H)], fill=(255, 255, 255, 8), width=SS)
    for y in range(0, H, step):
        d.line([(0, y), (W, y)], fill=(255, 255, 255, 8), width=SS)

    # měkká zelená záře za znakem
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gcx, gcy = int(W * 0.20), H // 2
    for i in range(26, 0, -1):
        r = int(150 * SS * i / 26.0)
        gd.ellipse([gcx - r, gcy - r, gcx + r, gcy + r], fill=(76, 205, 153, 3))
    img = Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB')
    d = ImageDraw.Draw(img, 'RGBA')

    # znak appky (stejná geometrie jako ikona), 512-grid → s = px na jednotku
    mk = _icons_module()
    mark_px = 300 * SS
    mk.draw_motif(d, mark_px / 512.0, gcx, gcy, 1.0, (59, 177, 124))

    # texty vpravo — mimo krajních 5 %, aby je oříznutí v Playi nesežralo
    tx = int(W * 0.40)
    f_title = font('segoeuib.ttf', 78 * SS)
    f_sub = font('seguisb.ttf', 36 * SS)
    f_small = font('segoeui.ttf', 27 * SS)

    d.text((tx, int(H * 0.30)), 'AR Geodet', font=f_title, fill=TEXT, anchor='ls')
    d.text((tx, int(H * 0.47)), 'Bodové pole v rozšířené realitě', font=f_sub, fill=ACCENT, anchor='ls')
    d.text((tx, int(H * 0.63)), 'Vyhledávání bodů kamerou · mapa a katastr', font=f_small, fill=MUTED, anchor='ls')
    d.text((tx, int(H * 0.72)), 'vytyčování · měření · funguje offline', font=f_small, fill=MUTED, anchor='ls')

    img.resize((w, h), Image.LANCZOS).save(path, 'PNG')
    print('OK', path)


def fix_screenshot(src, dst, crop_top=132, crop_bottom=26):
    """Ustřihne stavový řádek a dorovná na poměr 9:16 (Play: delší strana
    smí být max 2x delší než kratší; originál 1179x2556 = 2,17 → neprojde)."""
    im = Image.open(src).convert('RGB')
    w, h = im.size
    im = im.crop((0, crop_top, w, h - crop_bottom))
    w, h = im.size
    target_w = int(round(h * 9.0 / 16.0))
    if target_w < w:                          # obrázek je širší než 9:16 → dorovnat výšku
        target_h = int(round(w * 16.0 / 9.0))
        canvas = Image.new('RGB', (w, target_h), BG1)
        canvas.paste(im, (0, (target_h - h) // 2))
    else:
        canvas = Image.new('RGB', (target_w, h), BG1)
        canvas.paste(im, ((target_w - w) // 2, 0))
    canvas.save(dst, 'PNG')
    ww, hh = canvas.size
    print('OK', dst, canvas.size, 'poměr %.2f' % (max(ww, hh) / float(min(ww, hh))))


if __name__ == '__main__':
    os.makedirs(SHOTS, exist_ok=True)
    feature_graphic(os.path.join(OUT, 'feature-graphic.png'))
    # jen ty screenshoty, které se do obchodu hodí
    for i, name in enumerate(['IMG_4739.png', 'IMG_4746.png'], start=1):
        src = os.path.join(ROOT, name)
        if os.path.exists(src):
            fix_screenshot(src, os.path.join(SHOTS, '%d-%s' % (i, name.lower())))
        else:
            print('CHYBI', src, file=sys.stderr)
