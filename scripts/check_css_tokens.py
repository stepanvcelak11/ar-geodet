#!/usr/bin/env python3
# ===== AR Geodet — KONTROLOR DESIGN TOKENU A KONTRASTU =========================
# PROC: dvakrat uz appku polozila tatáz chyba, kterou zadny test nechytil:
#
#   1) var(--text, #eee) — token `--text` NIKDY neexistoval. CSS proto vzdycky
#      vzalo nahradni hodnotu za carkou, a ta je psana pro TMAVOU plochu. Ve
#      svetlem rezimu z toho byl svetly text na svetlem podklade. 36x v 7
#      modulech. V tmavem rezimu to vypadalo spravne, takze si toho nikdo
#      nevsiml.
#
#   2) --accent-grad: var(--accent) zapsane na :root. var() uvnitr vlastni
#      vlastnosti se dosazuje na prvku, kde JE ZAPSANA — takze prepis --accent
#      v body.light-mode se do --accent-grad NEPROMITL a svetly rezim neposlechl.
#
# Tenhle skript hlida oboji + kontrast barevnych dvojic podle WCAG. Neni to
# plnohodnotny CSS parser: umyslne cte jen to, co potrebuje, aby nemel zavislosti
# (Node tu neni, pip taky ne).
#
# Spusteni:   python scripts/check_css_tokens.py
# Navratovy kod 1 = nalez, ktery ma shodit CI.
# ==============================================================================
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CSS_DIR = os.path.join(ROOT, 'css')
JS_DIR = os.path.join(ROOT, 'js')
INDEX = os.path.join(ROOT, 'index.html')

# Selektory, ktere v teto appce nesou tema. :root a body jsou TMAVY rezim
# (vychozi), body.light-mode je svetly.
DARK_SEL = (':root', 'html', 'body')
LIGHT_SEL = ('body.light-mode', '.light-mode')

# ---- kontrastni dvojice, ktere se maji hlidat --------------------------------
# (popis, popredi, pozadi, minimum)
# Hodnota je bud jmeno tokenu (--neco) nebo primo barva (#rrggbb).
# 4.5 = WCAG AA pro bezny text, 3.0 = velky text a grafické prvky.
CONTRAST_PAIRS = [
    ('.btn-primary — bily text na plnem tlacitku', '#ffffff', '--accent-fill', 4.5),
    ('bezny text na podkladu appky', '--text-color', '--bg-color', 4.5),
    ('tlumeny text na podkladu appky', '--text-muted', '--bg-color', 4.5),
]


def read(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        return f.read()


def css_files():
    out = []
    for name in sorted(os.listdir(CSS_DIR)):
        if name.endswith('.css'):
            out.append(os.path.join(CSS_DIR, name))
    return out


# ---- sber definic tokenu -----------------------------------------------------
BLOCK_RE = re.compile(r'([^{}]+)\{([^{}]*)\}', re.S)
DECL_RE = re.compile(r'(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)')


# Tokeny, ktere se nedefinuji v souborech css/, ale prohlizec je stejne dostane:
#   a) element.style.setProperty('--neco', …)  — nastavene za behu,
#   b) uvnitr CSS, ktere si modul sklada jako RETEZEC a injektuje <style>
#      (tak to dela vetsina nastroju: '#ag-gf-modal{--gf-good:#34d399;}'),
#   c) inline style="--neco: …" v HTML.
# Bez tohohle by skript hlasil desitky planych nalezu a nikdo by ho necetl.
SETPROP_RE = re.compile(r"""setProperty\(\s*['"](--[A-Za-z0-9_-]+)""")
INLINE_RE = re.compile(r"""style\s*=\s*["'][^"']*?(--[A-Za-z0-9_-]+)\s*:""")
JSDECL_RE = re.compile(r'(--[A-Za-z0-9_-]+)\s*:')


def strip_js_comments(text):
    """Opatrne: jen CELORADKOVE komentare a blokove /* … */.
       Radkovy // uprostred radku se NEmaze — rozbil by adresy typu https://…
       a s nimi i skutecne deklarace na stejnem radku."""
    # komentare se NAHRAZUJI prazdnym radkem, ne mazou — jinak by cisla radku
    # v hlaseni nesedela se souborem a nikdo by nalez nenasel
    text = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'),
                  text, flags=re.S)
    out = []
    for line in text.splitlines():
        s = line.lstrip()
        out.append('' if (s.startswith('//') or s.startswith('*')) else line)
    return '\n'.join(out)


def collect_runtime_definitions():
    """tokeny z JS (setProperty i CSS skladane do retezce) a z inline stylu v HTML"""
    found = set()
    targets = [INDEX]
    for name in sorted(os.listdir(JS_DIR)):
        if name.endswith('.js'):
            targets.append(os.path.join(JS_DIR, name))
    for path in targets:
        text = read(path)
        for m in INLINE_RE.finditer(text):
            found.add(m.group(1))
        code = strip_js_comments(text) if path.endswith('.js') else text
        for m in SETPROP_RE.finditer(code):
            found.add(m.group(1))
        if path.endswith('.js'):
            # deklarace v CSS retezci; `var(--x, …)` se sem nesmi dostat, proto
            # se nejdriv vyhodi vsechna pouziti
            for m in JSDECL_RE.finditer(re.sub(r'var\(\s*--[A-Za-z0-9_-]+', ' ', code)):
                found.add(m.group(1))
    return found


def collect_definitions():
    """vraci: {token: {'dark': hodnota, 'light': hodnota, 'any': True}}"""
    defs = {}
    for path in css_files():
        text = read(path)
        # komentare pryc, at v nich nehledame tokeny
        text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
        for m in BLOCK_RE.finditer(text):
            sel = ' '.join(m.group(1).split())
            body = m.group(2)
            sels = [s.strip() for s in sel.split(',')]
            is_dark = any(s in DARK_SEL for s in sels)
            is_light = any(s in LIGHT_SEL for s in sels)
            for d in DECL_RE.finditer(body):
                tok, val = d.group(1), d.group(2).strip()
                rec = defs.setdefault(tok, {})
                rec['any'] = True
                if is_dark and 'dark' not in rec:
                    rec['dark'] = val
                if is_light:
                    rec['light'] = val
    return defs


# ---- sber pouziti ------------------------------------------------------------
# var(--token)            -> bez zalohy: kdyz token neexistuje, vlastnost se ZAHODI
# var(--token, zaloha)    -> se zalohou: tise se vezme zaloha psana pro tmavou plochu
USE_RE = re.compile(r'var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^;\'")]*))?')

# Barevna zaloha je ta nebezpecna: je psana pro tmavou plochu, takze ve svetlem
# rezimu z ni je svetly text na svetlem. Zaloha typu `46vh` nebo `7px` nevadi.
COLOR_KEYWORDS = ('transparent', 'currentcolor', 'white', 'black', 'red',
                  'green', 'blue', 'orange', 'gray', 'grey')


def looks_like_color(fb):
    if not fb:
        return False
    v = fb.strip().lower()
    if v.startswith('#') or v.startswith('rgb') or v.startswith('hsl'):
        return True
    return v in COLOR_KEYWORDS


def collect_uses():
    uses = {}          # token -> [(soubor, radek, ma_zalohu, zaloha)]
    targets = css_files() + [INDEX]
    for name in sorted(os.listdir(JS_DIR)):
        if name.endswith('.js'):
            targets.append(os.path.join(JS_DIR, name))
    for path in targets:
        text = read(path)
        if path.endswith('.js'):
            # v komentarich se casto cituje kod, ktery uz v appce NENI
            # (ucty.js vysvetluje zruseny `translate(var(--x0),var(--y0))`)
            text = strip_js_comments(text)
        elif path.endswith('.css'):
            text = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'),
                          text, flags=re.S)
        for i, line in enumerate(text.splitlines(), 1):
            for m in USE_RE.finditer(line):
                tok = m.group(1)
                fb = m.group(2)
                uses.setdefault(tok, []).append(
                    (os.path.relpath(path, ROOT).replace('\\', '/'), i,
                     fb is not None, fb))
    return uses


# ---- barvy a kontrast --------------------------------------------------------
def parse_color(val):
    """#rgb / #rrggbb / rgb() / rgba() -> (r, g, b, a) v 0..255 / 0..1, jinak None"""
    if val is None:
        return None
    v = val.strip()
    m = re.match(r'^#([0-9a-fA-F]{3})$', v)
    if m:
        h = m.group(1)
        return (int(h[0] * 2, 16), int(h[1] * 2, 16), int(h[2] * 2, 16), 1.0)
    m = re.match(r'^#([0-9a-fA-F]{6})$', v)
    if m:
        h = m.group(1)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
    m = re.match(r'^rgba?\(([^)]+)\)$', v)
    if m:
        parts = [p.strip() for p in re.split(r'[,\s/]+', m.group(1)) if p.strip()]
        try:
            r, g, b = (int(round(float(parts[i]))) for i in range(3))
            a = float(parts[3]) if len(parts) > 3 else 1.0
            return (r, g, b, a)
        except (ValueError, IndexError):
            return None
    return None


def resolve(spec, defs, theme, depth=0):
    """token nebo barvu prevede na hodnotu v danem tematu; jde i pres var() retez"""
    if depth > 8 or spec is None:
        return None
    spec = spec.strip()
    if spec.startswith('--'):
        rec = defs.get(spec)
        if not rec:
            return None
        val = rec.get(theme)
        if val is None:
            val = rec.get('dark')      # svetly rezim dedi, co neprepsal
        return resolve(val, defs, theme, depth + 1)
    m = re.match(r'^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*(.+))?\)$', spec)
    if m:
        inner = resolve(m.group(1), defs, theme, depth + 1)
        if inner is not None:
            return inner
        return resolve(m.group(2), defs, theme, depth + 1) if m.group(2) else None
    return spec


def lum(rgb):
    def ch(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = ch(rgb[0]), ch(rgb[1]), ch(rgb[2])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg, bg):
    a, b = lum(fg), lum(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


# ---- kontroly ----------------------------------------------------------------
def check_undefined(defs, uses):
    """Tokeny, ktere se nekde pouzivaji, ale NIKDE se nedefinuji.
       hard  = bez zalohy -> prohlizec vlastnost zahodi
       soft  = s BAREVNOU zalohou -> tise se vezme barva pro tmavou plochu
       note  = s nebarevnou zalohou (46vh, 7px) -> nevadi, jen na vedomi"""
    hard, soft, note = [], [], []
    for tok, places in sorted(uses.items()):
        if tok in defs:
            continue
        for path, line, has_fb, fb in places:
            if not has_fb:
                hard.append((tok, path, line))
            elif looks_like_color(fb):
                soft.append((tok, path, line))
            else:
                note.append((tok, path, line))
    return hard, soft, note


def check_var_in_custom_prop(defs):
    """--a: var(--b) zapsane na :root, kde se --b ve svetlem rezimu prepisuje.
       Hodnota se dosadi na :root, takze prepis se NEPROJEVI."""
    bad = []
    for tok, rec in sorted(defs.items()):
        dark_val = rec.get('dark')
        if not dark_val or 'var(' not in dark_val:
            continue
        if 'light' in rec:
            continue      # token se ve svetlem rezimu prepisuje sam — v poradku
        for inner in re.findall(r'var\(\s*(--[A-Za-z0-9_-]+)', dark_val):
            if 'light' in defs.get(inner, {}):
                bad.append((tok, inner, dark_val))
    return bad


def check_contrast(defs):
    out = []
    for label, fg_spec, bg_spec, minimum in CONTRAST_PAIRS:
        for theme in ('dark', 'light'):
            fg = parse_color(resolve(fg_spec, defs, theme))
            bg = parse_color(resolve(bg_spec, defs, theme))
            if not fg or not bg:
                out.append((label, theme, None, minimum, 'nelze zjistit barvu'))
                continue
            ratio = contrast(fg, bg)
            out.append((label, theme, ratio, minimum, None))
    return out


def main():
    defs = collect_definitions()
    runtime = collect_runtime_definitions()
    uses = collect_uses()
    fail = 0

    # token nastavovany za behu je pro prohlizec stejne platny jako ten z CSS
    for tok in runtime:
        defs.setdefault(tok, {'any': True, 'runtime': True})

    print('Tokeny: {} v CSS + {} nastavovanych za behu, {} pouzivanych.'.format(
        len(defs) - len(runtime), len(runtime), len(uses)))

    hard, soft, note = check_undefined(defs, uses)
    if hard:
        fail = 1
        print('\nCHYBA — var(--token) BEZ zalohy na token, ktery nikde neexistuje.')
        print('        Prohlizec takovou vlastnost ZAHODI, prvek zustane bez stylu:')
        for tok, path, line in hard[:40]:
            print('  {}  {}:{}'.format(tok, path, line))
        if len(hard) > 40:
            print('  … a dalsich {}'.format(len(hard) - 40))
    def vypis(polozky):
        seen = {}
        for tok, path, line in polozky:
            seen.setdefault(tok, []).append('{}:{}'.format(path, line))
        for tok in sorted(seen):
            mista = seen[tok]
            print('  {}  ({}x)  {}'.format(tok, len(mista), ', '.join(mista[:3])
                                           + (' …' if len(mista) > 3 else '')))

    if soft:
        fail = 1
        print('\nCHYBA — var(--token, BARVA) na token, ktery nikde neexistuje.')
        print('        Vzdy se vezme zaloha psana pro TMAVOU plochu => ve svetlem')
        print('        rezimu necitelne. Bud token doplnit, nebo pouzit existujici:')
        vypis(soft)

    if note:
        print('\nPoznamka — var(--token, zaloha) na neexistujici token, ale zaloha')
        print('           NENI barva (rozmer, cas…). Nic se nerozbije, jen se ta')
        print('           zaloha bere vzdycky. CI kvuli tomu nepada:')
        vypis(note)

    bad = check_var_in_custom_prop(defs)
    if bad:
        fail = 1
        print('\nCHYBA — var() uvnitr vlastni vlastnosti na :root.')
        print('        Dosadi se hodnota z :root, takze prepis ve svetlem rezimu')
        print('        se NEPROJEVI. Napis hodnotu natvrdo, nebo token prepis i')
        print('        v body.light-mode:')
        for tok, inner, val in bad:
            print('  {}: {}   ({} se ve svetlem rezimu prepisuje)'.format(tok, val, inner))

    print('\nKontrast (WCAG):')
    for label, theme, ratio, minimum, err in check_contrast(defs):
        rezim = 'tmavy ' if theme == 'dark' else 'svetly'
        if err:
            print('  ? {} [{}] — {}'.format(label, rezim, err))
            continue
        ok = ratio >= minimum
        if not ok:
            fail = 1
        print('  {} {} [{}] {:.2f}:1 (min {:.1f})'.format(
            'OK' if ok else 'CHYBA', label, rezim, ratio, minimum))

    if fail:
        print('\nNALEZY VYSE. Oprav je, nebo uprav pravidla v tomto skriptu.')
    else:
        print('\nOK - tokeny i kontrast v poradku.')
    return fail


if __name__ == '__main__':
    sys.exit(main())
