# -*- coding: utf-8 -*-
"""Ověří, že texty v play/texty.md (česky) a play/en/listing.md (anglicky) sedí do limitů Google Play.

Spuštění (z kořene repa):  python play/kontrola-textu.py
"""
import io
import os
import re
import sys

LIMITS = [
    ('Název aplikace', 30),
    ('Krátký popis', 80),
    ('Dlouhý popis', 4000),
]

HERE = os.path.dirname(os.path.abspath(__file__))
SOUBORY = [
    ('texty.md', LIMITS),
    (os.path.join('en', 'listing.md'), [('App name', 30), ('Short description', 80), ('Full description', 4000)]),
]

fail = False
for soubor, limity in SOUBORY:
    text = io.open(os.path.join(HERE, soubor), encoding='utf-8').read()
    print('== ' + soubor)
    for name, limit in limity:
        m = re.search(r'##\s*' + re.escape(name) + r'.*?```\n(.*?)```', text, re.S)
        if not m:
            print('CHYBI sekce: %s' % name)
            fail = True
            continue
        body = m.group(1).rstrip('\n')
        n = len(body)
        status = 'OK  ' if n <= limit else 'MOC DLOUHE'
        print('%-18s %5d / %d  %s' % (name, n, limit, status))
        if n > limit:
            fail = True
    # release notes: obsah mezi <en-US> … </en-US> nejvýš 500 znaků
    m = re.search(r'<en-US>\n(.*?)\n</en-US>', text, re.S)
    if m:
        n = len(m.group(1))
        print('%-18s %5d / 500  %s' % ('Release notes', n, 'OK  ' if n <= 500 else 'MOC DLOUHE'))
        fail = fail or n > 500

sys.exit(1 if fail else 0)
