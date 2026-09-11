# -*- coding: utf-8 -*-
"""Vygeneruje PNG ikony QTRIG rasterizací icon.svg v prohlížeči (Playwright).

PROČ PROHLÍŽEČ A NE PIL: dřív se geometrie ikony překreslovala v PIL ručně,
takže každá změna icon.svg se musela naprogramovat podruhé — a obojí se časem
rozešlo. Chromium vykreslí přesně to, co je v SVG, takže icon.svg je JEDINÝ
zdroj pravdy.

Výstupy (do kořene repa):
  icon-192.png, icon-512.png                    – purpose "any" (zaoblený čtverec)
  icon-maskable-192.png, icon-maskable-512.png  – purpose "maskable" (pozadí přes
        celý čtverec, motiv zmenšený do bezpečné zóny ~78 %)
  apple-touch-icon.png (180x180)                – iOS si rohy zaobluje samo →
        plný čtverec s motivem v normální velikosti

Spuštění:  python make-icons.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(ROOT, 'icon.svg')


def uprav(svg, plny_ctverec=False, zmenseni=1.0):
    """Odstraní zaoblení rohů a/nebo zmenší motiv do bezpečné zóny."""
    if plny_ctverec:
        svg = re.sub(r'(<rect[^>]*?)\s+rx="\d+"', r'\1', svg, count=1)
    if zmenseni != 1.0:
        # obal VŠECHNO za podkladovým obdélníkem do skupiny zmenšené kolem středu
        m = re.search(r'<rect[^>]*/>', svg)
        if not m:
            raise SystemExit('icon.svg: nenasel jsem podkladovy <rect>')
        obal = ('\n<g transform="translate(256,256) scale(%s) translate(-256,-256)">'
                % zmenseni)
        svg = svg[:m.end()] + obal + svg[m.end():]
        svg = svg.replace('</svg>', '</g>\n</svg>', 1)
    return svg


def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('Chybi playwright:  pip install playwright  &&  playwright install chromium')
        return 1

    with open(SVG, 'r', encoding='utf-8') as f:
        zdroj = f.read()

    ukoly = [
        ('icon-192.png', 192, False, 1.0),
        ('icon-512.png', 512, False, 1.0),
        ('icon-maskable-192.png', 192, True, 0.78),
        ('icon-maskable-512.png', 512, True, 0.78),
        ('apple-touch-icon.png', 180, True, 1.0),
    ]

    with sync_playwright() as p:
        b = p.chromium.launch()
        for jmeno, velikost, plny, zmenseni in ukoly:
            svg = uprav(zdroj, plny_ctverec=plny, zmenseni=zmenseni)
            html = ('<!doctype html><meta charset="utf-8">'
                    '<style>html,body{margin:0;padding:0;background:transparent}'
                    'svg{display:block;width:%dpx;height:%dpx}</style>%s'
                    % (velikost, velikost, svg))
            pg = b.new_page(viewport={'width': velikost, 'height': velikost})
            pg.set_content(html)
            pg.screenshot(path=os.path.join(ROOT, jmeno), omit_background=True)
            pg.close()
            print('%-26s %dx%d' % (jmeno, velikost, velikost))
        b.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
