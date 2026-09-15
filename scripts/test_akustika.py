# -*- coding: utf-8 -*-
"""Akusticky dalkomer (js/akusticky-dalkomer.js): detektor chirpu + protokol na
SYNTETICKE nahravce. Bez mikrofonu — modul se nacte do prazdne stranky, vyrobi
se nahravka telefonu A i B (vlastni chirp nahlas, cizi slabe, sum, odraz) a
overi se, ze z detekci vyjde zadana vzdalenost na centimetry.

Spusteni:  python scripts/test_akustika.py
"""
import io
import os
import sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = io.open(os.path.join(ROOT, 'js', 'akusticky-dalkomer.js'), encoding='utf-8').read()

SIM = r"""
(function () {
  var T = window.AGAkustika._test, fs = 48000, c = T.speedOfSound(15);
  var band = T.BANDS.std, up = T.makeChirp(fs, band.a[0], band.a[1], T.CHIRP_S), down = T.makeChirp(fs, band.b[1], band.b[0], T.CHIRP_S);
  var G0 = T.G0, out = [];
  // gaussovsky sum (Box-Muller)
  function gauss() { var u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function place(rec, tpl, t, amp) { var s = Math.round(t * fs), i; for (i = 0; i < tpl.length && s + i < rec.length; i++) rec[s + i] += amp * tpl[i]; }
  function run(rec, det) {
    var evs = [], i, B = 4096;
    for (i = 0; i + B <= rec.length; i += B) evs = evs.concat(det.process(rec.subarray(i, i + B)));
    return evs;
  }
  function scenario(D, noise, echo, offsetM) {
    var dur = 5.0, n = Math.round(dur * fs), recA = new Float32Array(n), recB = new Float32Array(n), i;
    for (i = 0; i < n; i++) { recA[i] = noise * gauss(); recB[i] = noise * gauss(); }
    var dAA = 0.11, dBB = 0.13, tof = D / c;      // repro->mikrofon na kazdem telefonu, doba letu
    // A pipne v case 1.0 (hodiny A). B ma hodiny posunute o +0.37 s (nezalezi na tom).
    var tA = 1.0;
    place(recA, up, tA + dAA / c, 0.9);            // A slysi sam sebe (nahlas)
    var tA_atB = tA + tof;                          // dorazi k B
    place(recB, up, tA_atB, 0.08);                  // B slysi A slabe
    if (echo) place(recB, up, tA_atB + 0.0012, 0.05); // odraz o 1,2 ms pozdeji (o 41 cm delsi cesta)
    var o1 = tA_atB + 0.35;                         // B odpovi po 350 ms (latence)
    place(recB, down, o1 + dBB / c, 0.9);           // B slysi sam sebe
    var dB = (o1 + dBB / c) - tA_atB;               // to B zmeri
    var o2 = o1 + G0 + dB;                          // druhe pipnuti
    place(recB, down, o2 + dBB / c, 0.9);
    place(recA, down, o1 + tof, 0.08);              // A slysi obe odpovedi
    if (echo) place(recA, down, o1 + tof + 0.0009, 0.06);
    place(recA, down, o2 + tof, 0.08);
    if (echo) place(recA, down, o2 + tof + 0.0009, 0.06);
    var detA = new T.Detector(fs, up, down), detB = new T.Detector(fs, up, down);
    var eA = run(recA, detA), eB = run(recB, detB);
    var r = { D: D, noise: noise, echo: echo, eA: eA.map(function (e) { return e.kind + '@' + (e.idx / fs).toFixed(4) + ' snr ' + e.snr.toFixed(0); }), eB: eB.map(function (e) { return e.kind + '@' + (e.idx / fs).toFixed(4); }) };
    var ups = eA.filter(function (e) { return e.kind === 'up'; }), downs = eA.filter(function (e) { return e.kind === 'down'; });
    if (ups.length === 1 && downs.length === 2) {
      var dA = (downs[0].idx - ups[0].idx) / fs, dBm = (downs[1].idx - downs[0].idx) / fs - G0;
      r.Dm = c / 2 * (dA - dBm) + (offsetM != null ? offsetM : 0.12);
      r.err_cm = (r.Dm - D) * 100;
    }
    // B: co by zmeril odpovidac
    var bu = eB.filter(function (e) { return e.kind === 'up'; }), bd = eB.filter(function (e) { return e.kind === 'down'; });
    r.B_ok = (bu.length === 1 && bd.length === 2);
    if (r.B_ok) r.dB_err_ms = ((bd[0].idx - bu[0].idx) / fs - dB) * 1000;
    return r;
  }
  out.push(scenario(10.0, 0.01, false));
  out.push(scenario(25.5, 0.02, true));
  out.push(scenario(3.0, 0.005, false));
  out.push(scenario(40.0, 0.03, true));
  out.push(scenario(30.0, 0.08, true));     // sum stejne silny jako cizi chirp (hlucna stavba)
  out.push(scenario(17.37, 0.15, false));   // sum 2x silnejsi nez cizi chirp
  // protinani z delek: znamy trojuhelnik
  var p1 = { lat: 50.0, lng: 14.0 }, m = { lat: 111320, lng: 111320 * Math.cos(50 * Math.PI / 180) };
  var p2 = { lat: 50.0, lng: 14.0 + 30 / m.lng };         // 30 m na vychod
  var target = { lat: 50.0 + 12 / m.lat, lng: 14.0 + 9 / m.lng };   // (9, 12) → d1 = 15, d2 = sqrt(21^2+12^2)
  var d1 = Math.hypot(9, 12), d2 = Math.hypot(21, 12);
  var pr = T.protinani(p1, d1, p2, d2);
  var ea = Math.hypot((pr.a.lat - target.lat) * m.lat, (pr.a.lng - target.lng) * m.lng), eb = Math.hypot((pr.b.lat - target.lat) * m.lat, (pr.b.lng - target.lng) * m.lng);
  out.push({ protinani_min_err_m: Math.min(ea, eb), gamma: pr.gamma });
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
    for r in res:
        if 'D' in r:
            print('D=%5.1f m sum=%.3f odraz=%s  A:%s  B:%s' % (r['D'], r['noise'], r['echo'], r['eA'], r['eB']))
            if 'Dm' not in r:
                print('   CHYBA: A nema 1x up + 2x down'); ok = False
            else:
                print('   zmereno %.3f m, chyba %+.1f cm, B_ok=%s dB_err=%.2f ms' % (r['Dm'], r['err_cm'], r['B_ok'], r.get('dB_err_ms', float('nan'))))
                if abs(r['err_cm']) > 3.0 or not r['B_ok']:
                    print('   CHYBA: mimo 3 cm nebo B nedetekoval'); ok = False
        else:
            print('protinani: chyba %.4f m, gamma %.1f' % (r['protinani_min_err_m'], r['gamma']))
            if r['protinani_min_err_m'] > 0.01:
                ok = False
    print('OK' if ok else 'SELHALO')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
