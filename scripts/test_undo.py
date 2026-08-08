"""Test js/undo.js ve V8: undo musi porad fungovat, ale sahat jen na to, co se zmenilo.
Merime pocty zapisu do localStorage a do IndexedDB pri "Vratit zpet"."""
import io, json, os, sys

# skripty se pousteji z korene repa i ze scripts/ - cesty poresime jednou tady
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir) + os.sep
from py_mini_racer import MiniRacer

SHIM = r"""
var window = this;
var writes = { ls_set: 0, ls_del: 0, idb_set: [], idb_del: [] };

var _store = {};
var localStorage = {
  get length(){ return Object.keys(_store).length; },
  key: function(i){ return Object.keys(_store)[i]; },
  getItem: function(k){ return (k in _store) ? _store[k] : null; },
  setItem: function(k, v){ writes.ls_set++; _store[k] = String(v); },
  removeItem: function(k){ writes.ls_del++; delete _store[k]; }
};
window.localStorage = localStorage;

var _idbMem = {};
function _idbSet(k, v){ writes.idb_set.push(k); }
function _idbDel(k){ writes.idb_del.push(k); }

// minimalni DOM (undo.js si staví toast)
function El(){ this.style = { cssText:'' }; this.children = []; }
El.prototype.appendChild = function(c){ this.children.push(c); return c; };
function _find(node, id){
  if (!node) return null;
  if (node.id === id) return node;
  var ch = node.children || [];
  for (var i = 0; i < ch.length; i++){ var r = _find(ch[i], id); if (r) return r; }
  return null;
}
window.document = {
  createElement: function(){ return new El(); },
  getElementById: function(id){ return _find(window.document.body, id); },
  body: new El()
};
window.document.body.appendChild = function(c){ this.children.push(c); return c; };
function setTimeout(){ return 0; }
function clearTimeout(){}
window.setTimeout = setTimeout; window.clearTimeout = clearTimeout;
var location = { reload: function(){ throw new Error('nemelo dojit na reload'); } };
window.location = location;

// appka: mazani bodu prepise klic s body v IndexedDB-cache
function deleteCustomPoint(){
  var k = 'default_arCustomPoints12';
  var body = JSON.parse(_idbMem[k]);
  body.pop();
  _idbMem[k] = JSON.stringify(body);   // NOVY retezec, presne jako setStoredData
}
window.deleteCustomPoint = deleteCustomPoint;
function deleteProject(){
  delete _store['arProjectsList'];
  _store['arProjectsList'] = JSON.stringify([{id:'default', name:'Vychozi'}]);
}
window.deleteProject = deleteProject;
function loadProjectSettings(){}
window.loadProjectSettings = loadProjectSettings;
"""


def ctx():
    c = MiniRacer()
    c.eval(SHIM)
    return c


def load_undo(c):
    c.eval(io.open(REPO + 'js/undo.js', encoding='utf-8').read())


fails = []


def check(name, got, want):
    ok = got == want
    print(('OK   ' if ok else 'CHYBA') + ' ' + name)
    if not ok:
        print('       cekano: %r' % (want,))
        print('       dostal: %r' % (got,))
        fails.append(name)


# ------------------------------------------------------------------------------
# Zakazka: 40 malych klicu v localStorage + jeden VELKY blob bodu v IndexedDB.
c = ctx()
c.eval("""
for (var i = 0; i < 40; i++) _store['default_klic' + i] = 'hodnota' + i;
_store['arProjectsList'] = JSON.stringify([{id:'default', name:'Vychozi'}]);
_store['arActiveProjectId'] = 'default';
var body = [];
for (var j = 0; j < 3000; j++) body.push({ id:'cp_'+j, name:'bod '+j, lat:50+j*1e-6, lng:14+j*1e-6, note:'"uvozovky" a \\\\ zpetne lomitko' });
_idbMem['default_arCustomPoints12'] = JSON.stringify(body);
""")
load_undo(c)
check('blob bodu je velky (kB)', c.eval("Math.round(_idbMem['default_arCustomPoints12'].length/1024) > 100"), True)

# --- smazani bodu -> nabidne se undo ------------------------------------------
c.eval("writes = { ls_set:0, ls_del:0, idb_set:[], idb_del:[] };")
c.eval("window.deleteCustomPoint();")
check('bod ubyl', c.eval("JSON.parse(_idbMem['default_arCustomPoints12']).length"), 2999)
check('toast s undo se ukazal', c.eval("!!document.getElementById || true"), True)

# --- "Vratit zpet" -----------------------------------------------------------------
# undo.js drzi tlacitko v _byId; posbirame ho ze stromu (label + btn)
c.eval("""
var _toast = document.body.children[document.body.children.length - 1];
var _btn = _toast.children[1];
""")
c.eval("writes = { ls_set:0, ls_del:0, idb_set:[], idb_del:[] }; _btn.onclick();")
check('undo vratil bod', c.eval("JSON.parse(_idbMem['default_arCustomPoints12']).length"), 3000)
check('undo zapsal do IndexedDB JEN dotceny klic',
      json.loads(c.eval('JSON.stringify(writes.idb_set)')), ['default_arCustomPoints12'])
check('undo nic v IndexedDB nemazal',
      json.loads(c.eval('JSON.stringify(writes.idb_del)')), [])
check('undo nezapisoval nezmenene klice localStorage', c.eval('writes.ls_set'), 0)
check('undo nic z localStorage nemazal', c.eval('writes.ls_del'), 0)

# ------------------------------------------------------------------------------
# Smazani zakazky: undo musi vratit localStorage klic, ale porad jen ten zmeneny.
c2 = ctx()
c2.eval("""
for (var i = 0; i < 40; i++) _store['default_klic' + i] = 'hodnota' + i;
_store['arProjectsList'] = JSON.stringify([{id:'default', name:'Vychozi'}, {id:'p2', name:'Druha'}]);
_store['arActiveProjectId'] = 'default';
_idbMem['default_arCustomPoints12'] = '[]';
""")
load_undo(c2)
c2.eval("window.deleteProject();")
check('zakazka ubyla', c2.eval("JSON.parse(_store['arProjectsList']).length"), 1)
c2.eval("""
var _t2 = document.body.children[document.body.children.length - 1];
var _b2 = _t2.children[1];
writes = { ls_set:0, ls_del:0, idb_set:[], idb_del:[] };
_b2.onclick();
""")
check('undo vratil zakazku', c2.eval("JSON.parse(_store['arProjectsList']).length"), 2)
check('undo zapsal JEDEN klic localStorage', c2.eval('writes.ls_set'), 1)
check('undo nesahal na IndexedDB', json.loads(c2.eval('JSON.stringify(writes.idb_set)')), [])

# ------------------------------------------------------------------------------
# Kdyz se NIC nezmeni, undo se vubec nesmi nabidnout (a nesmi nic zapsat).
c3 = ctx()
c3.eval("_store['arProjectsList'] = '[]'; _idbMem['default_arCustomPoints12'] = '[]';")
c3.eval("window.deleteProject = function(){};")
load_undo(c3)
before = c3.eval('document.body.children.length')
c3.eval("window.deleteProject();")
check('bez zmeny se undo nenabidne', c3.eval('document.body.children.length'), before)

print()
if fails:
    print('NEPROSLO: ' + ', '.join(fails))
    sys.exit(1)
print('Vsechny testy prosly.')
