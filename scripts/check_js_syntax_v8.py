"""Rychla kontrola syntaxe JS bez node.
esprima (ES2017) neumi vsechno moderni, takze primarni je V8 pres py_mini_racer:
zkompiluje zdroj, ale NESPUSTI ho (new Function by ho spustila; pouzijeme
V8 kompilaci pres eval v try/catch s okamzitym vyhozenim pred spustenim).
Nejjistejsi levny zpusob: obalit zdroj do `function(){...}` a nechat V8 to jen
zkompilovat pri parsovani `(function(){ ... })` bez volani.
"""
import sys, io
from py_mini_racer import MiniRacer


def check(path):
    src = io.open(path, encoding='utf-8').read()
    ctx = MiniRacer()
    # Vlozime zdroj do tela funkce, kterou NIKDY nezavolame. V8 pri evalu tohoto
    # vyrazu MUSI cele telo naparsovat -> chytime SyntaxError, ale nic se nespusti.
    ctx.eval('var __probe = function(){\n' + src + '\n};')
    return True


bad = 0
for p in sys.argv[1:]:
    try:
        check(p)
        print('OK   ' + p)
    except Exception as e:
        bad += 1
        msg = str(e).replace('\n', ' ')[:400]
        print('CHYBA ' + p + ': ' + msg)
sys.exit(1 if bad else 0)
