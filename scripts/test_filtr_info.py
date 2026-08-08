"""Test pocitani schovanych bodu (js/filtr-info.js) ve V8 bez prohlizece.
Podstrci minimalni window/document a globaly z logika.js, pak zkontroluje
count() a text hlasky pro nekolik situaci z terenu."""
import io, json, os, sys

# skripty se pousteji z korene repa i ze scripts/ - cesty poresime jednou tady
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir) + os.sep
from py_mini_racer import MiniRacer

SHIM = r"""
var window = this;
var _notes = {};
window.AGNotify = {
  set: function(id, o){ _notes[id] = o; },
  clear: function(id){ delete _notes[id]; },
  has: function(id){ return !!_notes[id]; }
};
var _els = {};
window.document = {
  readyState: 'complete',
  getElementById: function(id){ return _els[id] || null; },
  querySelector: function(){ return null; },
  addEventListener: function(){}
};
function setInterval(){ return 0; }
function clearInterval(){}
window.setInterval = setInterval;
// globaly z logika.js
var arPoints = [];
var filters = { tb:true, zhb:true, pbpp:true, nivel:true, custom:true };
var searchQuery = '';
var appStarted = true;
function setStoredData(){ return true; }
function drawAllMarkersOnMap(){}
function initARMarkers(){}
function updateInfoPanel(){}
function quickToast(){}
"""


def ctx_with_module():
    c = MiniRacer()
    c.eval(SHIM)
    c.eval(io.open(REPO + 'js/filtr-info.js', encoding='utf-8').read())
    return c


def scenario(points, flt=None, query=''):
    c = ctx_with_module()
    c.eval('arPoints = ' + json.dumps(points) + ';')
    if flt:
        c.eval('filters = ' + json.dumps(flt) + ';')
    c.eval('searchQuery = ' + json.dumps(query) + ';')
    c.eval('window.AGFiltrInfo.refresh();')
    return c


def note(c):
    return c.eval('JSON.stringify(_notes["filtr-skryte"] ? {text:_notes["filtr-skryte"].text, level:_notes["filtr-skryte"].level} : null)')


fails = []


def check(name, got, want):
    ok = got == want
    print(('OK   ' if ok else 'CHYBA') + ' ' + name)
    if not ok:
        print('       cekano: %r' % (want,))
        print('       dostal: %r' % (got,))
        fails.append(name)


P = lambda n, cat, hidden=False: {'id': n, 'name': n, 'cat': cat, 'hidden': hidden}

# --- 1) nic se neschovava -> zadna hlaska ---------------------------------------
c = scenario([P('1', 'TB'), P('2', 'CUSTOM')])
check('nic se neschovava = ticho', json.loads(note(c)), None)

# --- 2) vypnuty filtr kategorie -------------------------------------------------
c = scenario([P('1', 'TB'), P('2', 'TB'), P('3', 'CUSTOM')],
             flt={'tb': False, 'zhb': True, 'pbpp': True, 'nivel': True, 'custom': True})
n = json.loads(note(c))
check('vypnuty filtr: text', n and n['text'], 'Filtry kategorií schovávají 2 z 3 bodů')
check('vypnuty filtr: uroven', n and n['level'], 'warn')

# --- 3) filtr schova UPLNE VSECHNO -> danger ------------------------------------
c = scenario([P('1', 'TB'), P('2', 'TB')],
             flt={'tb': False, 'zhb': True, 'pbpp': True, 'nivel': True, 'custom': True})
n = json.loads(note(c))
check('vse schovano: uroven danger', n and n['level'], 'danger')
check('vse schovano: text', n and n['text'],
      'Filtry kategorií schovávají všechny body — na mapě ani v AR nic není')

# --- 4) hledani ------------------------------------------------------------------
c = scenario([P('101', 'CUSTOM'), P('102', 'CUSTOM'), P('201', 'CUSTOM')], query='20')
n = json.loads(note(c))
check('hledani: text', n and n['text'], 'Hledání „20" schovává 2 z 3 bodů')

# --- 5) dva duvody naraz ---------------------------------------------------------
c = scenario([P('1', 'TB'), P('102', 'CUSTOM'), P('103', 'CUSTOM')],
             flt={'tb': False, 'zhb': True, 'pbpp': True, 'nivel': True, 'custom': True},
             query='102')
n = json.loads(note(c))
check('dva duvody: text', n and n['text'], 'Filtry kategorií a hledání „102" schovávají 2 z 3 bodů')

# --- 6) rucne skryty bod ---------------------------------------------------------
c = scenario([P('1', 'TB'), P('2', 'TB', hidden=True)])
n = json.loads(note(c))
check('rucni skryti: text', n and n['text'], 'Ruční skrytí schovává 1 z 2 bodů')

# --- 7) neznama kategorie se NEPOCITA jako schovana ------------------------------
c = scenario([P('1', 'NECO_NOVEHO'), P('2', 'TB')],
             flt={'tb': True, 'zhb': True, 'pbpp': True, 'nivel': True, 'custom': True})
check('neznama kategorie = zobrazena', json.loads(note(c)), None)

# --- 8) 'Zobrazit vse' opravdu vsechno zapne a hlasku zhasne ---------------------
c = scenario([P('1', 'TB'), P('2', 'TB', hidden=True), P('3', 'CUSTOM')],
             flt={'tb': False, 'zhb': True, 'pbpp': True, 'nivel': True, 'custom': True},
             query='3')
check('pred obnovou hlaska je', json.loads(note(c)) is not None, True)
c.eval('window.AGFiltrInfo.showAll();')
check('po obnove: filtr tb zapnut', c.eval('filters.tb'), True)
check('po obnove: hledani smazano', c.eval('searchQuery'), '')
check('po obnove: bod odkryt', c.eval('arPoints[1].hidden'), False)
check('po obnove: hlaska zhasla', json.loads(note(c)), None)

# --- 9) pred startem appky se nehlasi nic ----------------------------------------
c = ctx_with_module()
c.eval('appStarted = false;')
c.eval('arPoints = [' + json.dumps(P('1', 'TB')) + '];')
c.eval('filters = {tb:false,zhb:true,pbpp:true,nivel:true,custom:true};')
c.eval('window.AGFiltrInfo.refresh();')
check('pred startem = ticho', json.loads(note(c)), None)

# --- 10) prazdna zakazka ----------------------------------------------------------
c = scenario([])
check('zadne body = ticho', json.loads(note(c)), None)

# --- 11) strop AR: hlasi se az po prodleve a jen kdyz opravdu ubira ---------------
def capnote(c):
    return c.eval('JSON.stringify(_notes["ar-strop"] ? {text:_notes["ar-strop"].text} : null)')

c = ctx_with_module()
c.eval('var viewMode = "ar";')
c.eval('window._arCapped = {capped: 0, shown: 12, max: 60};')
c.eval('window.AGFiltrInfo.refreshCap();')
check('strop neubira = ticho', json.loads(capnote(c)), None)

c.eval('window._arCapped = {capped: 37, shown: 60, max: 60};')
c.eval('window.AGFiltrInfo.refreshCap();')
check('strop ubira, ale hned = jeste ticho', json.loads(capnote(c)), None)
# posunout cas o vic nez prodleva
c.eval('var _realNow = Date.now; Date.now = function(){ return _realNow() + 999999; };')
c.eval('window.AGFiltrInfo.refreshCap();')
n = json.loads(capnote(c))
check('strop ubira po prodleve: text', n and n['text'],
      'V AR se kreslí jen 60 nejbližších bodů — dalších ~40 se nevejde')

# v mapovem rezimu se strop nehlasi (AR neni videt)
c.eval('viewMode = "map";')
c.eval('window.AGFiltrInfo.refreshCap();')
check('mapovy rezim = strop se nehlasi', json.loads(capnote(c)), None)

print()
if fails:
    print('NEPROSLO: ' + ', '.join(fails))
    sys.exit(1)
print('Vsechny testy prosly.')
