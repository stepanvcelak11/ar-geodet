# -*- coding: utf-8 -*-
"""Overi js/licence.js proti Pythonu — SHA-256, HMAC, vyroba i cteni klice.

PROC: klice VYRABI Konzole vlastnika a OVERUJE je telefon v lese bez signalu.
Kdyby se ty dve strany rozesly o jediny bit, vlastnik by rozdal klice, ktere
nikde nejdou odemknout — a poznal by to az od nastvanych lidi. Modul si nese
VLASTNI SHA-256 (duvod je v hlavicce js/licence.js), takze se musi dokazat, ze
je to opravdu SHA-256 a ne skoro-SHA-256: porovnava se s hashlib.

Spusteni:  python scripts/test_licence.py
Navratovy kod 1 = licence je rozbita.
"""
import hashlib
import hmac as pyhmac
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAJEMSTVI = '1362ffb552e2c4a376bb352ef13da61f'

try:
    from py_mini_racer import MiniRacer
except ImportError:
    sys.stdout.write('PRESKOCENO - py_mini_racer tu neni\n')
    sys.exit(0)


def ctx_s_modulem(now_ms=None):
    """V8 s minimalnim oknem + nactenym js/licence.js."""
    ctx = MiniRacer()
    ctx.eval('''
        var __ls = {};
        var localStorage = {
            getItem: function (k) { return Object.prototype.hasOwnProperty.call(__ls, k) ? __ls[k] : null; },
            setItem: function (k, v) { __ls[k] = String(v); },
            removeItem: function (k) { delete __ls[k]; }
        };
        var window = this;
        window.localStorage = localStorage;
        window.dispatchEvent = function () { return true; };
        function CustomEvent(n, o) { this.type = n; this.detail = o && o.detail; }
        window.CustomEvent = CustomEvent;
    ''')
    if now_ms is not None:
        ctx.eval('var __now = %d; Date.now = function () { return __now; };' % now_ms)
    src = io.open(os.path.join(ROOT, 'js', 'licence.js'), encoding='utf-8').read()
    ctx.eval(src)
    return ctx


def main():
    chyby = []
    ctx = ctx_s_modulem()

    # ---- 1) je to opravdu SHA-256? ------------------------------------------
    # Modul sha256() nevystavuje (je uvnitr IIFE), ale HMAC pres nej tece do
    # podpisu klice. Dokazeme to obracene: spocitame klic v Pythonu a overime,
    # ze ho appka prijme. Kdyby modul pocital jiny hash, neprijme ho.
    for cislo, dni in [(1, 0), (7, 365), (65535, 30), (0, 0)]:
        klic = ctx.eval("AGLic.vyrob(%d, %d)" % (cislo, dni))
        r = ctx.eval("JSON.stringify(AGLic.over(%s))" % repr(str(klic)))
        import json
        r = json.loads(r)
        if not r.get('ok'):
            chyby.append('vlastni klic %s (cislo=%d dni=%d) neprosel: %s' % (klic, cislo, dni, r.get('duvod')))
        elif r.get('cislo') != cislo:
            chyby.append('klic %s vratil cislo %s, cekalo se %d' % (klic, r.get('cislo'), cislo))

    # ---- 2) HMAC musi sedet s Pythonem --------------------------------------
    # Slozime telo klice tady v Pythonu, podepiseme hashlib/hmac a poskladame
    # klic ze stejne abecedy. Kdyz ho appka prijme, sedi SHA-256 i HMAC i base32.
    ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

    def enc(bs):
        bits = 0
        val = 0
        out = ''
        for b in bs:
            val = (val << 8) | b
            bits += 8
            while bits >= 5:
                out += ABC[(val >> (bits - 5)) & 31]
                bits -= 5
        if bits:
            out += ABC[(val << (5 - bits)) & 31]
        return out

    telo = [1, 0, 42, 0, 0]                      # verze 1, cislo 42, navzdy
    sig = pyhmac.new(TAJEMSTVI.encode('ascii'), bytes(bytearray(telo)), hashlib.sha256).digest()[:5]
    s = enc(telo + list(bytearray(sig)))
    klic_py = 'ARG-' + s[0:4] + '-' + s[4:8] + '-' + s[8:12] + '-' + s[12:16]
    import json
    r = json.loads(ctx.eval("JSON.stringify(AGLic.over(%s))" % repr(klic_py)))
    if not r.get('ok'):
        chyby.append('klic podepsany Pythonem (%s) appka NEPRIJALA (%s) — SHA-256/HMAC/base32 se rozesly'
                     % (klic_py, r.get('duvod')))
    elif r.get('cislo') != 42:
        chyby.append('pythonni klic vratil cislo %s misto 42' % r.get('cislo'))

    # ---- 3) podvrzeny klic musi propadnout ----------------------------------
    dobry = str(ctx.eval("AGLic.vyrob(5, 0)"))
    znaky = dobry.replace('-', '')[3:]
    for i in (0, 7, 15):
        zmen = list(znaky)
        zmen[i] = ABC[(ABC.index(zmen[i]) + 1) % 32]
        spatny = 'ARG-' + ''.join(zmen)
        r = json.loads(ctx.eval("JSON.stringify(AGLic.over(%s))" % repr(spatny)))
        if r.get('ok'):
            chyby.append('zmena %d. znaku klic NEZNEPLATNILA (%s) — podpis se nekontroluje' % (i + 1, spatny))
    for nesmysl in ['', 'ARG', 'ARG-1111-1111-1111-1111', 'uplny nesmysl']:
        r = json.loads(ctx.eval("JSON.stringify(AGLic.over(%s))" % repr(nesmysl)))
        if r.get('ok'):
            chyby.append('nesmysl %r prosel jako platny klic' % nesmysl)

    # ---- 4) opisovaci zamena znaku musi projit ------------------------------
    # Klic se opisuje z papiru; 0/O a 1/I si lidi pletou. Kdo napise O misto 0,
    # ma se dostat dovnitr, ne dostat "neplatny klic".
    zamena = dobry.replace('0', 'O').replace('1', 'I').lower()
    r = json.loads(ctx.eval("JSON.stringify(AGLic.over(%s))" % repr(zamena)))
    if not r.get('ok'):
        chyby.append('opsany klic se zamenou 0/O, 1/I a malymi pismeny (%s) neprosel' % zamena)

    # ---- 5) platnost do budoucna a po vyprseni ------------------------------
    c2 = ctx_s_modulem()
    klic30 = str(c2.eval("AGLic.vyrob(9, 30)"))
    if not json.loads(c2.eval("JSON.stringify(AGLic.over(%s))" % repr(klic30))).get('ok'):
        chyby.append('klic na 30 dni neplati hned po vyrobe')
    # tyz klic o 40 dni pozdeji uz platit nesmi
    import time
    pozdeji = int(time.time() * 1000) + 40 * 86400000
    c3 = ctx_s_modulem(now_ms=pozdeji)
    r = json.loads(c3.eval("JSON.stringify(AGLic.over(%s))" % repr(klic30)))
    if r.get('ok'):
        chyby.append('klic na 30 dni plati i po 40 dnech — platnost se nekontroluje')
    elif r.get('duvod') != 'vyprsel':
        chyby.append('klic po 40 dnech propadl s duvodem %r, cekalo se "vyprsel"' % r.get('duvod'))

    # ---- 6) ulozeni a stav telefonu -----------------------------------------
    c4 = ctx_s_modulem()
    if c4.eval("AGLic.isPro()"):
        chyby.append('cisty telefon hlasi Pro, i kdyz zadny klic nema')
    k = str(c4.eval("AGLic.vyrob(11, 0)"))
    c4.eval("AGLic.uloz(%s)" % repr(k))
    if not c4.eval("AGLic.isPro()"):
        chyby.append('po ulozeni platneho klice appka Pro nehlasi')
    if c4.eval("__ls['agLicence_v1'] ? 1 : 0") != 1:
        chyby.append('klic se neulozil do localStorage')
    c4.eval("AGLic.zrus()")
    if c4.eval("AGLic.isPro()"):
        chyby.append('po zruseni licence appka Pro porad hlasi')

    # ---- 7) podvrzeny localStorage nesmi stacit -----------------------------
    c5 = MiniRacer()
    c5.eval('''
        var __ls = { agLicence_v1: 'ARG-1111-1111-1111-1111' };
        var localStorage = {
            getItem: function (k) { return Object.prototype.hasOwnProperty.call(__ls, k) ? __ls[k] : null; },
            setItem: function (k, v) { __ls[k] = String(v); },
            removeItem: function (k) { delete __ls[k]; }
        };
        var window = this; window.localStorage = localStorage;
        window.dispatchEvent = function () { return true; };
        function CustomEvent(n, o) { this.type = n; this.detail = o && o.detail; }
    ''')
    c5.eval(io.open(os.path.join(ROOT, 'js', 'licence.js'), encoding='utf-8').read())
    if c5.eval("AGLic.isPro()"):
        chyby.append('vymysleny klic vlozeny primo do localStorage odemkl Pro')

    if chyby:
        sys.stdout.write('CHYBY (%d):\n' % len(chyby))
        for c in chyby:
            sys.stdout.write('  - ' + c + '\n')
        return 1
    sys.stdout.write('OK - licence: hash, podpis, platnost, opis i ulozeni sedi.\n')
    sys.stdout.write('    ukazka klice: %s\n' % ctx.eval("AGLic.vyrob(1, 0)"))
    return 0


if __name__ == '__main__':
    sys.exit(main())
