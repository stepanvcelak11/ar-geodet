# -*- coding: utf-8 -*-
"""Ověří, že texty v play/texty.md sedí do limitů Google Play.

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

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'texty.md')
text = io.open(path, encoding='utf-8').read()

fail = False
for name, limit in LIMITS:
    m = re.search(r'##\s*' + re.escape(name) + r'.*?```\n(.*?)```', text, re.S)
    if not m:
        print('CHYBI sekce: %s' % name)
        fail = True
        continue
    body = m.group(1).rstrip('\n')
    n = len(body)
    status = 'OK  ' if n <= limit else 'MOC DLOUHE'
    print('%-16s %5d / %d  %s' % (name, n, limit, status))
    if n > limit:
        fail = True

sys.exit(1 if fail else 0)
