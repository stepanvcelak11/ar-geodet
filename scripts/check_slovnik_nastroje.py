# -*- coding: utf-8 -*-
u"""Kontrola slovníku: každý text, který uživatel vidí v Nástrojích a v panelu Mapa, musí mít
překlad — klíč v jádru (data/jazyky.json: t nebo vzor re) nebo v rozšíření (data/jazyky-en.json).

⚠ PROČ: 18. 9. 2026 (hodnocení v350, návrh N8) — 47 textů nástrojů z v320–v350 (Lovci bodů,
  Přesná GPS, Místopisný náčrt, panel Mapa…) nemělo klíč v ŽÁDNÉM jazyce, takže se v EN/DE/PL/ES/IT
  appce objevovaly česky. Slovník překládá podle PŘESNÉHO českého textu (js/jazyky.js), takže
  nový nástroj = nový klíč, a nic to nehlídalo. Tahle kontrola běží v CI (tests.yml, krok
  „Kód jde zabalit do jednoho souboru") a shodí vydání, dokud se překlad nedoplní.

Co se kontroluje (staticky, bez prohlížeče):
  • js/tools-registry.js — verb, vl, vh každého záznamu + label profilů práce,
  • js/lazy-tools.js — label odložených nástrojů,
  • index.html — všechny texty uvnitř #map-sheet (panel Mapa) a jeho atributy
    placeholder/title/aria-label.
Přeskakují se texty bez písmen (čísla, jednotky) a zkratky psané velkými písmeny.

Spuštění:  python scripts/check_slovnik_nastroje.py     (exit 1 = něco chybí, vypíše seznam)
"""
import io
import os
import re
import sys
import json
from html.parser import HTMLParser

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def key_of(s):
    return re.sub(r'\s+', ' ', s).strip()


def zajimavy(t):
    if len(t) < 2 or len(t) > 900:
        return False
    if not re.search(r'[A-Za-zÀ-ž]', t):
        return False
    if re.fullmatch(r'[A-Z0-9\-–./ ]+', t):   # zkratky a kódy: DXF, S-JTSK, OSM
        return False
    return True


def registr():
    s = src('js/tools-registry.js')
    out = set()
    for m in re.finditer(r"""\b(verb|vl|vh|label)\s*:\s*'((?:[^'\\]|\\.)*)'""", s):
        out.add(key_of(m.group(2).replace("\\'", "'")))
    return out


def lazy():
    s = src('js/lazy-tools.js')
    return set(key_of(m.group(1)) for m in re.finditer(r"""\blabel\s*:\s*'((?:[^'\\]|\\.)*)'""", s))


class PanelMapa(HTMLParser):
    u"""Texty uvnitř prvku s id="map-sheet" (sleduje se hloubka vnoření)."""
    VOID = {'br', 'img', 'input', 'use', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'meta', 'link', 'hr', 'source'}

    def __init__(self):
        HTMLParser.__init__(self)
        self.depth = None
        self.texty = set()

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self.depth is None and a.get('id') == 'map-sheet':
            self.depth = 0
        if self.depth is not None:
            for k in ('placeholder', 'title', 'aria-label'):
                if a.get(k):
                    self.texty.add(key_of(a[k]))
            if tag not in self.VOID:
                self.depth += 1

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.depth is not None and tag not in self.VOID:
            self.depth -= 1

    def handle_endtag(self, tag):
        if self.depth is not None and tag not in self.VOID:
            self.depth -= 1
            if self.depth <= 0:
                self.depth = None

    def handle_data(self, data):
        if self.depth is not None:
            k = key_of(data)
            if k:
                self.texty.add(k)


def panel_mapa():
    p = PanelMapa()
    p.feed(src('index.html'))
    return p.texty


def main():
    core = json.loads(src('data/jazyky.json'))
    ext = json.loads(src('data/jazyky-en.json'))
    klice = set(core['t'].keys()) | set(ext['t'].keys())
    vzory = [re.compile(r[0]) for r in core.get('re', [])]

    def prelozeno(t):
        return t in klice or any(v.search(t) for v in vzory)

    zdroje = [('js/tools-registry.js', registr()), ('js/lazy-tools.js', lazy()), ('index.html #map-sheet', panel_mapa())]
    chybi = []
    celkem = 0
    for jmeno, texty in zdroje:
        for t in sorted(texty):
            if not zajimavy(t):
                continue
            celkem += 1
            if not prelozeno(t):
                chybi.append((jmeno, t))
    # rozšíření musí být pro všechny jazyky stejně velké (klíč přidaný jen do EN by v DE zůstal česky)
    velikosti = {}
    for lang in core.get('poradi', ['en', 'de', 'pl']):
        try:
            velikosti[lang] = len(json.loads(src('data/jazyky-%s.json' % lang))['t'])
        except Exception as e:
            velikosti[lang] = 'CHYBA ' + str(e)
    print('zkontrolováno %d textů, chybí %d; rozšíření: %s' % (celkem, len(chybi), velikosti))
    for jmeno, t in chybi:
        print('CHYBÍ [%s] %s' % (jmeno, t))
    ostatni = {l: json.loads(src('data/jazyky-%s.json' % l))['t'] for l in core.get('poradi', []) if l != 'en'}
    chybi_en = [k for k in ext['t'] if k not in core['t'] and any(k not in d for d in ostatni.values())]
    if chybi_en:
        print('CHYBÍ v jiném jazyce než EN (%d): %s' % (len(chybi_en), chybi_en[:5]))
    sys.exit(1 if (chybi or chybi_en) else 0)


if __name__ == '__main__':
    main()
