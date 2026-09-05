#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_js.py — kontrola integrity kodu, ktera chyti tichou chybu driv nez telefon.

Duvod: appka ma pres 100 samostatnych <script> souboru a zadny build. Jedina
prekleplá carka nebo duplicitni klic v objektu = tichá chyba, ktera se pozna
az v terenu ("nastroj nejde otevrit"). Realny pripad z historie repa: merge
vyrobil v js/tools-plus.js DVA stejne klice v TOOL_HELP a napoveda prestala
fungovat, aniz by to cokoli ohlasilo.

Co skript kontroluje (vse bez zavislosti mimo stdlib, jako gen_sw_assets.py):

  1) DUPLICITNI KLICE v objektovych literalech v js/*.js
     (napr. dva stejne klice v TOOL_HELP). JS duplicitu tise povoli -
     pozdejsi klic prepise drivejsi, takze polozka "zmizi".
  2) DUPLICITNI id= v index.html
     Appka si prvky tahá pres getElementById; dve stejna id znamenaji, ze
     jeden z prvku je z JS nedosazitelny.
  3) NEEXISTUJICI SOUBORY v <script src> a <link href> v index.html.
  4) NEEXISTUJICI SOUBORY v seznamu ASSETS_TO_CACHE v sw.js.
     Tohle je nejzradnejsi: cache.addAll() u chybejiciho souboru SELZE CELY,
     service worker se nenainstaluje a uzivateli se prestane aktualizovat
     CELA appka - bez jedine chybove hlasky.
  5) ZBYTKY PO MERGI ('<<<<<<<' / '>>>>>>>' na zacatku radku) v js/*.js a sw.js.
     Nezacommitovany konflikt je syntakticka chyba, ktera cely soubor odrovna;
     tohle ji chyti i tam, kde neni Node a kontrola syntaxe se preskoci.
  6) Volitelne SYNTAXE pres `node --check`, kdyz je Node k dispozici
     (na vyvojarskem stroji neni, na GitHub Actions ano). Krome js/*.js se
     kontroluje i sw.js (lezi v korenu, takze dlouho stal mimo) a INLINE
     <script> bloky z index.html (~22 kB, mimo jine firemni zamek). Preklep
     v sw.js je pritom nejtissi chyba, jakou repo umi: novy service worker se
     nenainstaluje, telefon zustane napořád na stare verzi a nic to neohlasi.
  8) OSIRELY MODUL: js/*.js, ktery neni zminen ani v index.html (src/data-src),
     ani v MANIFESTu js/lazy-tools.js, ani v ASSETS_TO_CACHE v sw.js. Takovy
     soubor se v prohlizeci nikdy nespusti, ale v repu vypada hotovy — presne
     tak zustal js/cuzk-geodata.js mesice nezapojeny.
  7) SYNTAXE ES MODULU v tests/*.mjs a *.mjs v korenu (Playwright testy a jeho
     konfigurace). Kontroluji se zvlast, protoze v modulu je uz `import` na
     prvnim radku pro skriptovy rezim chyba - viz check_syntax_modules niz.
     Rozbity spec jinak projde lokalne a odhali se az cervenym CI.

Pouziti:
    python scripts/check_js.py           # exit 1 pri jakemkoli nalezu
    python scripts/check_js.py --list    # jen vypise, co by kontrolovalo

Syntaxi HTML ani CSS skript neresi - jde po chybach, ktere se v tomhle repu
opravdu staly.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / 'index.html'
SW_PATH = ROOT / 'sw.js'
JS_DIR = ROOT / 'js'
TESTS_DIR = ROOT / 'tests'

# Knihovny treti strany se nekontroluji na duplicitni klice: jsou minifikovane
# (jeden radek, vlastni konvence) a nemenime je.
SKIP_DUP_DIRS = {'lib'}

problems = []


def problem(where, msg):
    problems.append('%s: %s' % (where, msg))


# ---------------------------------------------------------------------------
# Mini-tokenizer JS: potrebujeme rozlisit kod od retezcu, komentaru a regexu,
# jinak by "//" uvnitr URL nebo ":" v retezci delaly falesne poplachy.
# ---------------------------------------------------------------------------

# Po techto tokenech nasleduje regulární výraz, ne deleni (bezna heuristika).
REGEX_PREV = set('([{,;:!&|?=+-*%~^<>')
REGEX_PREV_WORDS = {'return', 'typeof', 'instanceof', 'in', 'of', 'new',
                    'delete', 'void', 'throw', 'case', 'do', 'else'}


def tokenize(src):
    """Vrati seznam tokenu (kind, text, index). kind: code | str | tmpl | com | re."""
    out = []
    i, n = 0, len(src)
    last_sig = ''          # posledni vyznamovy token (kvuli regex heuristice)
    buf_start = 0

    def flush(end):
        if end > buf_start:
            out.append(('code', src[buf_start:end], buf_start))

    while i < n:
        c = src[i]
        two = src[i:i + 2]
        if two == '//':
            flush(i)
            j = src.find('\n', i)
            j = n if j < 0 else j
            out.append(('com', src[i:j], i))
            i = buf_start = j
            continue
        if two == '/*':
            flush(i)
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(('com', src[i:j], i))
            i = buf_start = j
            continue
        if c in '"\'':
            flush(i)
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == c:
                    j += 1
                    break
                if src[j] == '\n':      # neuzavreny retezec - necháme na node --check
                    break
                j += 1
            out.append(('str', src[i:j], i))
            last_sig = 'str'
            i = buf_start = j
            continue
        if c == '`':
            flush(i)
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == '`':
                    j += 1
                    break
                j += 1
            out.append(('tmpl', src[i:j], i))
            last_sig = 'tmpl'
            i = buf_start = j
            continue
        if c == '/':
            # regex, nebo deleni? Rozhodne posledni vyznamovy token.
            prev = last_sig
            is_re = (prev == '' or prev in REGEX_PREV or prev in REGEX_PREV_WORDS)
            if is_re:
                flush(i)
                j, in_class = i + 1, False
                while j < n:
                    ch = src[j]
                    if ch == '\\':
                        j += 2
                        continue
                    if ch == '[':
                        in_class = True
                    elif ch == ']':
                        in_class = False
                    elif ch == '/' and not in_class:
                        j += 1
                        break
                    elif ch == '\n':
                        break
                    j += 1
                while j < n and src[j].isalpha():   # priznaky gimsuy
                    j += 1
                out.append(('re', src[i:j], i))
                last_sig = 're'
                i = buf_start = j
                continue
            last_sig = '/'
            i += 1
            continue
        if not c.isspace():
            if c.isalnum() or c in '_$':
                j = i
                while j < n and (src[j].isalnum() or src[j] in '_$'):
                    j += 1
                last_sig = src[i:j]
                i = j
                continue
            last_sig = c
        i += 1
    flush(n)
    return out


def strip_noncode(src):
    """Kod s retezci/komentari/regexy nahrazenymi mezerami (pozice zustavaji)."""
    parts = []
    for kind, text, _ in tokenize(src):
        if kind == 'code':
            parts.append(text)
        else:
            # zachovat radkovani, aby sedela cisla radku v hlasenich
            parts.append(''.join(ch if ch == '\n' else ' ' for ch in text))
    return ''.join(parts)


# ---------------------------------------------------------------------------
# 1) Duplicitni klice v objektovych literalech
# ---------------------------------------------------------------------------

KEY_RE = re.compile(r'''(?x)
    (?P<q>['"])(?P<qkey>(?:\\.|[^\\])*?)(?P=q)\s*:      # 'klic':  /  "klic":
  | (?P<ikey>[A-Za-z_$][\w$]*)\s*:                       # klic:
  | (?P<nkey>\d+(?:\.\d+)?)\s*:                          # 123:
''')

# Po techto znacich zacina '{' OBJEKT (jinak je to blok kodu).
OBJ_AFTER = set('=(,:[?&|+!')


def check_dup_keys(path, src):
    """Najde dva stejne klice ve stejnem objektovem literalu."""
    toks = tokenize(src)
    # Slozime "cistou" verzi pro hledani klicu, ale retezcove klice potrebujeme
    # zachovat - proto jdeme pres puvodni text a pomocnou masku "je to kod?".
    mask = bytearray(len(src))          # 1 = kod, 0 = retezec/komentar/regex
    # Komentare potrebujeme rozlisit OD RETEZCU: nize se z ne-kodu cte retezcovy
    # KLIC ('foo': 1), a bez tehle masky se stejne tak precetl i text v komentari.
    # Realny falesny poplach (8.8.2026, js/pocasi.js): v komentari stalo
    #   // Rodina se ZAMERNE nejmenuje 'chmi': namerena data ...
    # a kontrola to ohlasila jako duplicitni klic 'chmi' - pritom v objektu byl
    # jen jednou. V CI by to shodilo vydani kvuli VETE V KOMENTARI.
    is_com = bytearray(len(src))        # 1 = komentar
    for kind, text, pos in toks:
        if kind == 'code':
            for k in range(pos, min(pos + len(text), len(src))):
                mask[k] = 1
        elif kind == 'com':
            for k in range(pos, min(pos + len(text), len(src))):
                is_com[k] = 1

    stack = []      # ramce: {'obj': bool, 'keys': {}, 'expect': bool}
    i, n = 0, len(src)
    prev_sig = ''
    while i < n:
        if not mask[i]:
            # retezec muze byt KLIC - zkusime ho precist, kdyz cekame klic.
            # Z KOMENTARE nikdy (viz maska is_com vyse).
            if (stack and stack[-1]['obj'] and stack[-1]['expect']
                    and src[i] in '"\'' and not is_com[i]):
                m = KEY_RE.match(src, i)
                if m and m.group('qkey') is not None:
                    add_key(stack[-1], m.group('qkey'), path, src, i)
                    i = m.end()
                    prev_sig = ':'
                    stack[-1]['expect'] = False
                    continue
            i += 1
            continue
        c = src[i]
        if c.isspace():
            i += 1
            continue
        if c == '{':
            is_obj = (prev_sig in OBJ_AFTER or prev_sig == 'return' or prev_sig == '=>')
            stack.append({'obj': is_obj, 'keys': {}, 'expect': is_obj})
            prev_sig = '{'
            i += 1
            continue
        if c == '}':
            if stack:
                stack.pop()
            prev_sig = '}'
            i += 1
            continue
        if c in '([':
            stack.append({'obj': False, 'keys': {}, 'expect': False})
            prev_sig = c
            i += 1
            continue
        if c in ')]':
            if stack:
                stack.pop()
            prev_sig = c
            i += 1
            continue
        if c == ',':
            if stack and stack[-1]['obj']:
                stack[-1]['expect'] = True
            prev_sig = ','
            i += 1
            continue
        if stack and stack[-1]['obj'] and stack[-1]['expect']:
            m = KEY_RE.match(src, i)
            if m:
                key = m.group('qkey')
                if key is None:
                    key = m.group('ikey') or m.group('nkey')
                # 'default:' uvnitr switch (blok) sem nespadne - jsme v objektu
                add_key(stack[-1], key, path, src, i)
                stack[-1]['expect'] = False
                prev_sig = ':'
                i = m.end()
                continue
            stack[-1]['expect'] = False     # napr. ...spread nebo metoda
        # bezny token
        if c.isalnum() or c in '_$':
            j = i
            while j < n and (src[j].isalnum() or src[j] in '_$'):
                j += 1
            prev_sig = src[i:j]
            i = j
            continue
        if src[i:i + 2] == '=>':
            prev_sig = '=>'
            i += 2
            continue
        prev_sig = c
        i += 1
    return


def add_key(frame, key, path, src, pos):
    line = src.count('\n', 0, pos) + 1
    if key in frame['keys']:
        problem(str(path.relative_to(ROOT)).replace('\\', '/'),
                'duplicitni klic %r v objektu (radek %d, uz byl na radku %d) '
                '- pozdejsi prepise drivejsi, polozka tise zmizi'
                % (key, line, frame['keys'][key]))
    else:
        frame['keys'][key] = line


# ---------------------------------------------------------------------------
# 2) + 3) index.html: duplicitni id, neexistujici soubory
# ---------------------------------------------------------------------------

# Typy <script>, ktere prohlizec spousti jako klasicky skript. Cokoli jineho
# (ag/lazy, application/ld+json, sablony) je pro nas jen text.
INLINE_TYPES = {'', 'text/javascript', 'application/javascript', 'javascript'}


class IndexCheck(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = {}
        self.files = []      # (atribut, url)
        self.inline = []     # (radek v index.html, zdrojak) - bezsrcove <script>
        self._buf = None     # sbirame obsah prave otevreneho inline skriptu
        self._buf_line = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        el_id = a.get('id')
        if el_id:
            line = self.getpos()[0]
            if el_id in self.ids:
                problem('index.html', 'duplicitni id="%s" (radek %d, uz bylo na radku %d) '
                                      '- getElementById najde jen prvni' % (el_id, line, self.ids[el_id]))
            else:
                self.ids[el_id] = line
        if tag == 'script' and a.get('src'):
            self.files.append(('script src', a['src']))
        elif tag == 'script' and a.get('data-src'):
            # odlozene moduly (type="ag/lazy") - existovat musi uplne stejne
            self.files.append(('script data-src', a['data-src']))
        elif tag == 'script' and (a.get('type') or '').lower() in INLINE_TYPES:
            # INLINE SKRIPT bez src. V index.html je ho 22 kB (mimo jine cely
            # firemni zamek) a dosud stal MIMO vsechny kontroly - preklep v nem
            # shodi start appky uplne stejne jako preklep v js/*.js.
            self._buf = []
            self._buf_line = self.getpos()[0]
        elif tag == 'link' and a.get('href') and 'stylesheet' in (a.get('rel') or '').lower():
            self.files.append(('link href', a['href']))

    def handle_data(self, data):
        if self._buf is not None:
            self._buf.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self._buf is not None:
            self.inline.append((self._buf_line, ''.join(self._buf)))
            self._buf = None


def local_path(url):
    """Lokalni URL -> Path, nebo None u externich."""
    if url.startswith(('http://', 'https://', '//', 'data:')):
        return None
    clean = url.split('?')[0].split('#')[0]
    if clean.startswith('./'):
        clean = clean[2:]
    return ROOT / clean


# ---------------------------------------------------------------------------
# 4) sw.js: existuji vsechny cachovane soubory?
# ---------------------------------------------------------------------------

def check_sw():
    text = SW_PATH.read_text(encoding='utf-8-sig')
    m = re.search(r'ASSETS_TO_CACHE\s*=\s*\[(.*?)\]', text, re.S)
    if not m:
        problem('sw.js', 'nenasel jsem seznam ASSETS_TO_CACHE')
        return
    for raw in re.findall(r"'([^']+)'|\"([^\"]+)\"", m.group(1)):
        url = raw[0] or raw[1]
        if url in ('./',):
            continue
        p = local_path(url)
        if p is None:
            continue
        if not p.exists():
            problem('sw.js', 'ASSETS_TO_CACHE odkazuje na neexistujici %s '
                             '- cache.addAll() selze CELY a service worker se nenainstaluje' % url)


# ---------------------------------------------------------------------------
# 8) OSIRELY MODUL: js/*.js, ktery nikdo nenacita
#
# Nacitani modulu ma v appce TRI nezavisle seznamy — <script src>/<script
# type="ag/lazy" data-src> v index.html, MANIFEST v js/lazy-tools.js (stahne se
# az na klepnuti na dlazdici) a ASSETS_TO_CACHE v sw.js. Kdyz se novy modul
# zapise jen do jednoho z nich (nebo do zadneho), NIC to neohlasi: soubor je
# v repu, vypada hotove, a pritom se v prohlizeci nikdy nespusti. Presne to se
# stalo js/cuzk-geodata.js — hotova funkce (udaje bodu z CUZK + odkaz do DATAZ),
# kterou uzivatel nikdy nevidel, protoze jeho <script> radek nikdy neexistoval.
#
# sw.js se pocita jako platne misto ZAMERNE: nektere nastroje si soubor dotahuji
# za behu samy (fetch/dynamicky <script>) a v index.html nemaji co delat — hlasit
# je jako osirele by byl falesny poplach a kontrola by se zacala ignorovat.
# ---------------------------------------------------------------------------

LAZY_TOOLS_PATH = JS_DIR / 'lazy-tools.js'


def check_orphan_modules(js_files):
    haystack = []
    for p in (INDEX_PATH, LAZY_TOOLS_PATH, SW_PATH):
        try:
            haystack.append(p.read_text(encoding='utf-8-sig'))
        except OSError:
            problem(p.name, 'soubor nejde precist - kontrola osirelych modulu je slepa')
    text = '\n'.join(haystack)
    orphans = 0
    for p in js_files:
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith('js/lib/'):
            continue                      # knihovny treti strany maji vlastni zivot
        if rel in text:
            continue
        orphans += 1
        problem(rel, 'modul nikdo nenacita - neni v index.html (src ani data-src), '
                     'v MANIFESTu js/lazy-tools.js ani v ASSETS_TO_CACHE v sw.js. '
                     'Bud ho zapoj, nebo presun do _archiv/')
    return orphans


# ---------------------------------------------------------------------------
# 5) syntaxe pres node --check (kdyz je Node po ruce)
# ---------------------------------------------------------------------------

# Jeden proces Node misto 117: vm.Script kod POUZE zkompiluje (neprovede ho),
# takze je to totez co `node --check`, ale bez 117 startu interpretu.
NODE_SNIPPET = r'''
const fs = require('fs'), vm = require('vm');
let bad = 0;
for (const f of process.argv.slice(1)) {
    try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }); }
    catch (e) { bad++; console.log(f + '\t' + String(e.message).split('\n')[0]); }
}
process.exit(bad ? 1 : 0);
'''


# ---------------------------------------------------------------------------
# Zbytky po mergi. '=======' se ZAMERNE nehlasi samo o sobe - v tomhle repu je
# plno oddelovacu v komentarich; hlasi se jen '<<<<<<<' a '>>>>>>>', ktere se
# v beznem kodu nevyskytnou.
# ---------------------------------------------------------------------------


def check_conflicts(files):
    for p in files:
        try:
            src = p.read_text(encoding='utf-8-sig')
        except Exception:                                        # noqa: BLE001
            continue
        rel = p.relative_to(ROOT).as_posix()
        for i, line in enumerate(src.splitlines(), 1):
            t = line.strip()
            if t.startswith('<<<<<<<') or t.startswith('>>>>>>>'):
                problem(rel, 'radek %d: zbytek po mergi: %s' % (i, t[:40]))


# ---------------------------------------------------------------------------
# Inline <script> z index.html -> docasne .js soubory.
#
# Kazdy blok se ulozi ZVLAST (v prohlizeci je to taky samostatny skript, takze
# `const` se stejnym jmenem ve dvou blocich neni chyba parsovani) a PREDSADI se
# mu tolik prazdnych radku, kolik jich v index.html predchazi. Diky tomu sedi
# cislo radku v chybove hlasce presne na index.html a nemusi se prepocitavat.
# ---------------------------------------------------------------------------


def inline_temp_files(bloky):
    """Vrati (cesty, popisky, docasny adresar). Popisky mapuji cestu -> 'index.html …'."""
    if not bloky:
        return [], {}, None
    tmpdir = tempfile.mkdtemp(prefix='agcheck-')
    files, labels = [], {}
    for line, src in bloky:
        p = Path(tmpdir) / ('index-inline-%d.js' % line)
        p.write_text('\n' * (line - 1) + src, encoding='utf-8')
        files.append(p)
        labels[str(p)] = 'index.html (inline <script> od radku %d)' % line
    return files, labels, tmpdir


def check_syntax(files, labels=None):
    labels = labels or {}
    node = shutil.which('node')
    if not node:
        # V CI se spousti s --require-node: tam Node JE a tiche preskoceni by
        # znamenalo zelene CI, ktere nic nekontroluje - to je horsi nez zadne.
        if '--require-node' in sys.argv:
            problem('scripts/check_js.py',
                    'Node nenalezen, ale bylo vyzadano --require-node '
                    '(kontrola syntaxe by se tise preskocila)')
            return
        print('  syntaxe: PRESKOCENO (Node tu neni; na GitHub Actions probehne)')
        return
    r = subprocess.run([node, '-e', NODE_SNIPPET] + [str(f) for f in files],
                       capture_output=True, text=True)
    bad = 0
    for line in (r.stdout or '').strip().split('\n'):
        if not line.strip():
            continue
        fname, _, msg = line.partition('\t')
        rel = labels.get(fname)
        if rel is None:
            try:
                rel = str(Path(fname).relative_to(ROOT)).replace('\\', '/')
            except ValueError:
                rel = fname
        problem(rel, 'chyba syntaxe: %s' % msg)
        bad += 1
    if r.returncode not in (0, 1) and not bad:
        problem('scripts/check_js.py', 'kontrola syntaxe selhala: %s' % (r.stderr or '')[:200])
    print('  syntaxe: %d souboru, %d chybnych' % (len(files), bad))


# ---------------------------------------------------------------------------
# Syntaxe ES MODULU (tests/*.mjs). Proc zvlast a ne do check_syntax vyse:
# vm.Script kompiluje ve SKRIPTOVEM rezimu, kde uz `import` na prvnim radku je
# chyba syntaxe - kazdy spec by hlasil falesny nalez. `node --check` se ridi
# priponou .mjs a naparsuje soubor jako modul, aniz by ho spustil.
#
# PROC TO TU VUBEC JE: 30. 8. 2026 se do tests/smoke.spec.mjs dostal pri
# editaci pres heredoc misto dvouznaku \n SKUTECNY konec radku uvnitr
# retezce. Neuzavreny literal shodil parsovani CELEHO specu, takze naráz padly
# vsechny smoke testy a s nimi obe workflow ("Testy (smoke + bundle)" i
# "Nasazeni na Pages"), job "Publikovat" se preskocil a web se nezabalil.
# Lokalne to nic nechytlo - check_js.py se dival jen do js/.
#
# ZAMERNE OPATRNE: hlasi se JEN kdyz node skutecne dobehne a rekne, ze soubor
# neparsuje (navratovy kod 1). Cokoli jineho (chybejici node, podivny navratovy
# kod) je NEPRUKAZNE a jen se vypise - kontrola, ktera si neni jista, nesmi
# shodit CI vsem ostatnim.
# ---------------------------------------------------------------------------


def check_syntax_modules(files):
    if not files:
        return
    node = shutil.which('node')
    if not node:
        if '--require-node' in sys.argv:
            problem('scripts/check_js.py',
                    'Node nenalezen, ale bylo vyzadano --require-node '
                    '(kontrola syntaxe modulu by se tise preskocila)')
            return
        print('  syntaxe modulu: PRESKOCENO (Node tu neni; na GitHub Actions probehne)')
        return
    bad = 0
    neprukazne = 0
    for f in files:
        rel = str(f.relative_to(ROOT)).replace('\\', '/')
        try:
            r = subprocess.run([node, '--check', str(f)],
                               capture_output=True, text=True, timeout=60)
        except Exception as e:                                    # noqa: BLE001
            print('  ! %s: kontrolu nelze provest (%s)' % (rel, e))
            neprukazne += 1
            continue
        if r.returncode == 0:
            continue
        if r.returncode == 1:
            msg = (r.stderr or '').strip().split('\n')
            detail = next((x.strip() for x in msg if 'Error' in x), msg[-1] if msg else '')
            problem(rel, 'chyba syntaxe: %s' % detail[:160])
            bad += 1
        else:
            print('  ! %s: neprukazne (node skoncil s %d)' % (rel, r.returncode))
            neprukazne += 1
    print('  syntaxe modulu: %d souboru, %d chybnych%s'
          % (len(files), bad, (', %d neprukaznych' % neprukazne) if neprukazne else ''))


def main():
    js_files = sorted(p for p in JS_DIR.rglob('*.js'))
    own_js = [p for p in js_files if p.parent.name not in SKIP_DUP_DIRS]
    # Testy a konfigurace Playwrightu jsou ES moduly (.mjs) - kontroluji se zvlast,
    # viz check_syntax_modules niz.
    mjs_files = sorted(TESTS_DIR.rglob('*.mjs')) if TESTS_DIR.is_dir() else []
    mjs_files += sorted(ROOT.glob('*.mjs'))

    if '--list' in sys.argv:
        for p in js_files:
            print(p.relative_to(ROOT))
        return 0

    print('Kontrola integrity (%d JS souboru)' % len(js_files))

    # 1) duplicitni klice
    for p in own_js:
        try:
            check_dup_keys(p, p.read_text(encoding='utf-8-sig'))
        except Exception as e:                                   # noqa: BLE001
            problem(str(p.relative_to(ROOT)).replace('\\', '/'),
                    'kontrola klicu spadla (%s) - nahlas to, je to chyba skriptu' % e)
    print('  duplicitni klice: prohledano %d souboru' % len(own_js))

    # 2) + 3) index.html
    parser = IndexCheck()
    parser.feed(INDEX_PATH.read_text(encoding='utf-8-sig'))
    missing = 0
    for kind, url in parser.files:
        p = local_path(url)
        if p is not None and not p.exists():
            problem('index.html', '%s="%s" ukazuje na neexistujici soubor' % (kind, url))
            missing += 1
    print('  index.html: %d id, %d odkazu na soubory (%d chybi)'
          % (len(parser.ids), len(parser.files), missing))

    # 4) sw.js
    check_sw()

    # 8) osirele moduly (nikdo je nenacita)
    orphans = check_orphan_modules(js_files)
    print('  osirele moduly: %d' % orphans)

    # 5) zbytky po mergi
    check_conflicts(own_js + [SW_PATH])

    # 6) syntaxe. sw.js lezi v koreni (ne v js/), takze do teto kontroly dlouho
    #    nespadal — a pritom je to soubor, u ktereho tichá chyba boli nejvic:
    #    novy service worker se neda nainstalovat, telefon zustane napořád na
    #    stare verzi appky a NIKDE se to neohlasi. Inline skripty z index.html
    #    se kontroluji pres docasne soubory, viz inline_temp_files.
    inline_files, inline_labels, tmpdir = inline_temp_files(parser.inline)
    try:
        check_syntax(js_files + [SW_PATH] + inline_files, inline_labels)
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)
    check_syntax_modules(mjs_files)

    if problems:
        print('\nNALEZENO %d problemu:' % len(problems))
        for p in problems:
            print('  x %s' % p)
        return 1
    print('\nOK - nic podezreleho.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
