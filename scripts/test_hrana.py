# -*- coding: utf-8 -*-
"""Kalibrace chuzi po hrane (js/kalibrace-hranou.js): geometrie cary + odhad
chyboveho vektoru GPS na SYNTETICKYCH fixech. Rovna cara musi vratit jen kolmou
slozku (1d), lomena cely vektor (2d). Spusteni: python scripts/test_hrana.py
"""
import io
import os
import sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = io.open(os.path.join(ROOT, 'js', 'kalibrace-hranou.js'), encoding='utf-8').read()

SIM = r"""
(function () {
  var T = window.AGHrana._test, out = [];
  var lat0 = 50.0, lng0 = 14.0, m = { lat: 111320, lng: 111320 * Math.cos(50 * Math.PI / 180) };
  function ll(x, y) { return { lat: lat0 + y / m.lat, lng: lng0 + x / m.lng }; }
  function gauss() { var u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function walk(verts, vE, vN, offset, noise, back, hold) {
    var line = new T.Line(verts), fixes = [], i, tt = 0;
    hold = hold || 0;   // telefon drzeny `hold` m VPRAVO od stopy chuze (otoci se pri chuzi zpet)
    // pravda: jdu po care s bocnim odstupem `offset` (vpravo), GPS pricita (vE, vN) + sum
    function step(s, k, dir) {
      var h = offset + dir * hold;
      var tx = s.a.x + k * s.ux + h * s.uy, ty = s.a.y + k * s.uy - h * s.ux;
      var gx = tx + vE + noise * gauss(), gy = ty + vN + noise * gauss();
      var p = ll(gx, gy), pr = line.project(p.lat, p.lng);
      fixes.push({ nx: pr.nx, ny: pr.ny, e: pr.e - offset, s: pr.s, acc: 5, t: (tt += 1000) });
    }
    for (i = 0; i < line.seg.length; i++) { var s = line.seg[i], k; for (k = 0; k < s.L; k += 1.2) step(s, k, 1); }
    if (back) for (i = line.seg.length - 1; i >= 0; i--) { var s2 = line.seg[i], k2; for (k2 = s2.L; k2 >= 0; k2 -= 1.2) step(s2, k2, -1); }
    // dva hrube outliery (uskok u budovy)
    fixes.push({ nx: fixes[0].nx, ny: fixes[0].ny, e: 9.5, s: 3, acc: 5 });
    fixes.push({ nx: fixes[0].nx, ny: fixes[0].ny, e: -7.0, s: 6, acc: 5 });
    var q = T.solve(fixes, line.spread() >= T.ANGLE_2D);
    return { mode: q.mode, vE: q.vE, vN: q.vN, b: q.b, n: q.n, dropped: q.dropped, sigma: q.sigma, sterr: q.sterr, spread: line.spread(), len: line.len };
  }
  // 1) rovna cara na vychod (60 m), chyba GPS (1.5 V, -2.0 S) -> videt jen slozka kolmo (sever): -2.0
  var r1 = walk([ll(0, 0), ll(60, 0)], 1.5, -2.0, 0.4, 0.6);
  r1.expect = 'vN=-2.0 (1d), vE=0'; out.push(r1);
  // 2) lomena cara L (40 m vychod, pak 40 m sever), stejna chyba -> cely vektor
  var r2 = walk([ll(0, 0), ll(40, 0), ll(40, 40)], 1.5, -2.0, 0, 0.6);
  r2.expect = 'vE=1.5 vN=-2.0 (2d)'; out.push(r2);
  // 3) sikma rovna cara (45°), chyba (2, 0) -> kolma slozka = 2*sin45 = 1.41 ve smeru normaly
  var r3 = walk([ll(0, 0), ll(35, 35)], 2.0, 0.0, 0, 0.5);
  r3.expect = '|v|=1.41 kolmo (1d)'; r3.mag = Math.hypot(r3.vE, r3.vN); out.push(r3);
  // 4) TAM A ZPET: telefon drzeny 0.35 m vpravo od stopy; jen tam -> chyba v korekci, tam+zpet -> oddeleno
  var r4a = walk([ll(0, 0), ll(60, 0)], 0.0, -2.0, 0, 0.5, false, 0.35);
  r4a.expect = 'jen tam: vN ~ -2.35 (drzeni v korekci)'; out.push(r4a);
  var r4b = walk([ll(0, 0), ll(60, 0)], 0.0, -2.0, 0, 0.5, true, 0.35);
  r4b.expect = 'tam+zpet: vN=-2.0, b=0.35'; out.push(r4b);
  // projekce: bod 3 m vpravo od cary na vychod (tj. na jih) -> e = +3
  var line = new T.Line([ll(0, 0), ll(50, 0)]), pr = line.project(ll(20, -3).lat, ll(20, -3).lng);
  out.push({ proj_e: pr.e, proj_s: pr.s, inside: pr.inside, outside: !line.project(ll(60, 0).lat, ll(60, 0).lng).inside });
  return out;
})()
"""


def main():
    ok = True
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.set_content('<html><body></body></html>')
        pg.add_script_tag(content='window.AG={swallow:function(){},esc:function(s){return String(s)},style:function(){}};')
        pg.add_script_tag(content=SRC)
        res = pg.evaluate(SIM)
        b.close()
    r1, r2, r3, r4a, r4b, pr = res
    for r in (r1, r2, r3, r4a, r4b):
        print('%-38s -> mode %s vE %+.2f vN %+.2f b %s n %d dropped %d sigma %.2f sterr %.2f' % (r['expect'], r['mode'], r['vE'], r['vN'], ('%+.2f' % r['b']) if r['b'] is not None else '-', r['n'], r['dropped'], r['sigma'], r['sterr']))
    if not (r1['mode'] == '1d' and abs(r1['vN'] + 2.0) < 0.35 and abs(r1['vE']) < 0.05): print('CHYBA 1'); ok = False
    if not (r2['mode'] == '2d' and abs(r2['vE'] - 1.5) < 0.35 and abs(r2['vN'] + 2.0) < 0.35): print('CHYBA 2'); ok = False
    if not (r3['mode'] == '1d' and abs(r3['mag'] - 1.414) < 0.3): print('CHYBA 3'); ok = False
    if not (r1['dropped'] >= 2 and r2['dropped'] >= 2): print('CHYBA: outliery nevyrazeny'); ok = False
    # jen tam: drzeni telefonu (0.35 m vpravo = na jih) se schova do korekce -> vN ~ -2.35, b nic
    if not (r4a['b'] is None and abs(r4a['vN'] + 2.35) < 0.3): print('CHYBA 4a (jen tam)', r4a); ok = False
    # tam a zpet: drzeni oddeleno -> vN ~ -2.0, b ~ +0.35
    if not (r4b['b'] is not None and abs(r4b['vN'] + 2.0) < 0.25 and abs(r4b['b'] - 0.35) < 0.15): print('CHYBA 4b (tam+zpet)', r4b); ok = False
    if not (r4b['sterr'] < r4a['sterr'] * 1.5): print('CHYBA: sterr tam+zpet neni rozumny', r4a['sterr'], r4b['sterr']); ok = False
    print('projekce: e %.2f (ma byt +3) s %.1f (20) inside %s outside %s' % (pr['proj_e'], pr['proj_s'], pr['inside'], pr['outside']))
    if not (abs(pr['proj_e'] - 3) < 0.02 and abs(pr['proj_s'] - 20) < 0.05 and pr['inside'] and pr['outside']): print('CHYBA projekce'); ok = False
    print('OK' if ok else 'SELHALO')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
