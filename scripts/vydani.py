# -*- coding: utf-8 -*-
u"""Dělené sestavení: připraví strom repa pro vydání ZÁKLAD nebo PRO.

PROČ NE PŘEPÍNAČ V build.mjs (jak se původně plánovalo):
    build.mjs bere seznam souborů ZE STROMU (z <script> řádků v index.html) a
    nic víc nedělá. Když se Pro řádky z index.html odeberou dřív, než se pustí,
    vyjde balíček Základu SÁM — bez druhé kopie logiky „co je Pro", která by se
    mohla rozejít s registrem. Tenhle skript je proto KROK PŘED buildem, ne
    přepínač uvnitř něj. Druhý důvod je praktický: dělící logiku musí umět
    ověřit i stroj bez Node (scripts/test_vydani.py).

CO DĚLÁ (`--pred`, pouští se PŘED `npm run build -- --apply`):
    1. zjistí Pro soubory z jediného zdroje pravdy — `check_verze.py --mapa`
       (to čte pole `pro: 1` v js/tools-registry.js),
    2. u ZÁKLADU odebere jejich <script> řádky z index.html (eager i odložené)
       a soubory ze stromu SMAŽE, včetně jejich stylopisů,
    3. do <head> zapíše `window.__AG_VYDANI` — podle toho se řídí AGLic.vydani()
       (js/licence.js) a s ním nabídka „Otevřít verzi Pro" v js/pro-zamky.js,
    4. u PRO přepíše jméno v manifest.json (na ploše telefonu musí jít obě
       vydání rozeznat; cesty v manifestu jsou relativní, takže /pro/ sedí samo).

CO DĚLÁ (`--po`, pouští se AŽ PO `scripts/gen_sw_assets.py`):
    5. připíše ke SHELL_CACHE příponu vydání.
       ⚠⚠ TOHLE JE DŮVOD, PROČ JE TO DVĚ FÁZE. Obě vydání bydlí na TÉMŽE
       originu (appka na `/`, Pro na `/pro/`), a `caches` je per-origin —
       kdyby obě vydání psala do 'argeodet-shell-v279', přepisovala by si
       navzájem shell a `activate` jednoho by mazal cache druhého. Service
       worker má sice jiný scope, ale úložiště cache sdílejí.
       Musí to být až po generátoru: ten hledá `argeodet-shell-v(\\d+)'` a na
       jménu s příponou by se nesešel.

SPUŠTĚNÍ:
    python scripts/vydani.py --zaklad --pred
    npm run build -- --apply
    python scripts/gen_sw_assets.py
    python scripts/vydani.py --zaklad --po

⚠ SKRIPT MĚNÍ PRACOVNÍ STROM (maže soubory). V CI je checkout jednorázový, na
  svém stroji si napřed ověř, že nemáš rozdělanou práci — `--nanecisto` vypíše,
  co by udělal, a nesáhne na nic.
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'scripts')

ZNACKA = u'<!-- VYDANI APPKY (zapisuje scripts/vydani.py pri sestaveni) -->'


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def write(rel, text):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def mapa():
    u"""Pro nástroje a jejich soubory — z check_verze.py, ať je zdroj pravdy jeden."""
    out = subprocess.check_output(
        [sys.executable, os.path.join(SCRIPTS, 'check_verze.py'), '--mapa'])
    return json.loads(out.decode('utf-8'))


def pro_soubory():
    u"""Množina cest (od kořene repa), které do balíčku ZÁKLADU nepatří.

    ⚠ SEZNAM SE TU NESESTAVUJE, JEN PŘEBÍRÁ. Který Pro soubor se smí vynechat,
      rozhoduje check_verze.py (`smazatelne`) — ten kromě „je to Pro" hlídá
      i dvě věci, na kterých se to už rozbilo: že v souboru nebydlí zároveň
      nástroj zdarma, a že modul je ODLOŽENÝ (na eager skriptu, který běží při
      startu, může stát celá appka — js/field-tools.js registruje jediný Pro
      nástroj a nese celou mřížku Nástrojů).
    """
    m = mapa()
    return set(m['smazatelne']), m


def styly_odlozenych(html, js_cesty):
    u"""css/*.css, které visí na odložených <script> řádcích mazaných modulů.

    Stylopis odloženého modulu je zapsaný jako `data-css` u TÉHOŽ řádku
    (js/lazy-load.js ho připojí spolu s modulem), takže se pozná bez hádání.
    """
    out = set()
    for js in js_cesty:
        for m in re.finditer(r'<script\b[^>]*data-src="%s"[^>]*>' % re.escape(js), html):
            for c in re.finditer(r'data-css="([^"]+)"', m.group(0)):
                out.add(c.group(1))
    return out


def styly_lazy_tools(js_cesty):
    u"""css u záznamů v MANIFESTu js/lazy-tools.js, jejichž `src` se maže.

    Záznam vypadá jako `{ id: 'vrstvy', src: 'js/vrstvy.js', …, css: 'css/x.css' }`
    a může být přes několik řádků — proto se čte po celých záznamech mezi `{ id:`.
    """
    try:
        text = read('js/lazy-tools.js')
    except OSError:
        return set()
    out = set()
    for zaznam in re.split(r'\n(?=\s*\{ id:)', text):
        m = re.search(r"src:\s*'((?:\./)?js/[^']+)'", zaznam)
        if not m:
            continue
        src = m.group(1).lstrip('./')
        if src not in js_cesty:
            continue
        for c in re.finditer(r"css:\s*'((?:\./)?css/[^']+)'", zaznam):
            out.add(c.group(1).lstrip('./'))
    return out


def vyhod_script_radky(html, js_cesty):
    u"""Odebere celé <script> řádky (eager `src` i odložené `data-src`) daných modulů.

    Bere i případný komentář nad řádkem: odpojitelné moduly mají nad sebou
    vysvětlivku „(odpojitelné: smaž tento řádek + js/x.js)", která by po smazání
    skriptu zůstala viset nad cizím modulem a pletla by.
    """
    kolik = 0
    for js in sorted(js_cesty):
        vzor = re.compile(
            r'(?:[ \t]*<!--(?:(?!-->).)*?-->[ \t]*\r?\n)?'      # nepovinný komentář nad
            r'[ \t]*<script\b[^>]*\b(?:data-)?src="%s"[^>]*>\s*</script>[ \t]*\r?\n?'
            % re.escape(js), re.S)
        html, n = vzor.subn('', html)
        # Komentář nad řádkem se smí sebrat, jen když opravdu patřil TOMUHLE
        # modulu. Když ne, zkusí se to znovu bez něj — radši komentář navíc
        # než utržená vysvětlivka od cizího skriptu.
        if not n:
            vzor2 = re.compile(
                r'[ \t]*<script\b[^>]*\b(?:data-)?src="%s"[^>]*>\s*</script>[ \t]*\r?\n?'
                % re.escape(js))
            html, n = vzor2.subn('', html)
        kolik += n
    return html, kolik


def zapis_znacku(html, vydani):
    u"""Do <head> hned na začátek zapíše window.__AG_VYDANI.

    MUSÍ BÝT PŘED VŠÍM OSTATNÍM: js/licence.js se na hodnotu ptá při startu
    (isPro() odpovídá synchronně dřív, než se registrují nástroje) a zámek
    načtený pozdě nezamyká.
    """
    html = re.sub(
        r'[ \t]*' + re.escape(ZNACKA) + r'\r?\n[ \t]*<script>window\.__AG_VYDANI[^\n]*\r?\n',
        '', html)
    blok = ('    %s\n    <script>window.__AG_VYDANI = %r;</script>\n'
            % (ZNACKA, str(vydani)))
    if '<head>' not in html:
        raise SystemExit('vydani: v index.html nenalezen <head>.')
    return html.replace('<head>\n', '<head>\n' + blok, 1)


def uprav_manifest(vydani, nanecisto):
    u"""Pro vydání PRO přejmenuje appku, ať jdou obě ikony na ploše rozeznat.

    Cesty (`start_url`, `scope`, ikony) jsou v manifestu RELATIVNÍ, takže na
    /pro/ ukazují samy na sebe a měnit se nesmí — přepsat je na absolutní by
    znamenalo, že Pro nainstalované z /pro/ startuje do Základu.
    """
    if vydani != 'pro':
        return
    p = os.path.join(ROOT, 'manifest.json')
    with io.open(p, encoding='utf-8-sig') as f:
        m = json.load(f)
    m['name'] = 'AR Geodet Pro'
    m['short_name'] = 'Geodet Pro'
    if nanecisto:
        print(u'  manifest.json: name -> %s' % m['name'])
        return
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(json.dumps(m, ensure_ascii=False, indent=2) + u'\n')


def faze_pred(vydani, nanecisto):
    files, m = pro_soubory()
    html = read('index.html')

    smazat = set()
    if vydani == 'zaklad':
        css = styly_odlozenych(html, files) | styly_lazy_tools(files)
        smazat = set(files) | css
        html, n = vyhod_script_radky(html, files)
        print(u'ZAKLAD: z index.html odebrano %d <script> radku, ke smazani %d souboru '
              u'(%d js + %d css).' % (n, len(smazat), len(files), len(css)))
        print(u'        %d Pro nastroju bez vlastniho souboru zamyka az za behu '
              u'js/pro-zamky.js: %s' % (len(m['bez_souboru']), ', '.join(m['bez_souboru'])))
    else:
        print(u'PRO: cely strom zustava, meni se jen znacka vydani a jmeno v manifestu.')

    html = zapis_znacku(html, vydani)
    if nanecisto:
        for s in sorted(smazat):
            print(u'  smazal by: ' + s)
        uprav_manifest(vydani, True)
        print(u'(--nanecisto: nic se nezapsalo)')
        return 0

    write('index.html', html)
    chybi = []
    for rel in sorted(smazat):
        p = os.path.join(ROOT, rel)
        if os.path.exists(p):
            os.remove(p)
        else:
            chybi.append(rel)
    if chybi:
        # Není to chyba: css se u modulu nemusí vůbec vyskytovat a soubor mohl
        # zmizet dřív. Vypsat se to ale musí — mlčky mazat nic je horší.
        print(u'  (neexistovalo, preskoceno: %s)' % ', '.join(chybi))
    uprav_manifest(vydani, False)

    # POJISTKA: kdyby v index.html zbyl odkaz na smazaný soubor, build.mjs by
    # spadl na „Chybí soubory" (eager) nebo by se v terénu stahoval 404 (odložený).
    # Platí jen pro ZÁKLAD — v PRO se nemaže nic, takže by tu jinak spadlo vydání,
    # které je v pořádku.
    if vydani != 'zaklad':
        return 0
    zbylo = [f for f in sorted(files) if ('"%s"' % f) in read('index.html')]
    if zbylo:
        raise SystemExit(u'vydani: v index.html zustal odkaz na smazany Pro soubor: %s'
                         % ', '.join(zbylo))
    return 0


SHELL_RE = re.compile(r"(const SHELL_CACHE = ')(argeodet-shell-v\d+)(-(?:zaklad|pro))?(')")


def faze_po(vydani, nanecisto):
    sw = read('sw.js')
    m = SHELL_RE.search(sw)
    if not m:
        raise SystemExit(u'vydani: v sw.js nenalezen SHELL_CACHE — zmenil se zapis?')
    nove = m.group(2) + '-' + vydani
    if nanecisto:
        print(u'  SHELL_CACHE -> %s' % nove)
        return 0
    write('sw.js', sw[:m.start()] + m.group(1) + nove + m.group(4) + sw[m.end():])
    print(u'SHELL_CACHE = %s  (obe vydani bydli na temze originu, cache je per-origin)' % nove)
    return 0


def main():
    args = sys.argv[1:]
    vydani = 'zaklad' if '--zaklad' in args else ('pro' if '--pro' in args else None)
    if not vydani or not ({'--pred', '--po'} & set(args)):
        sys.stderr.write(__doc__ + u'\n')
        return 2
    nanecisto = '--nanecisto' in args
    if '--pred' in args:
        return faze_pred(vydani, nanecisto)
    return faze_po(vydani, nanecisto)


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    sys.exit(main())
