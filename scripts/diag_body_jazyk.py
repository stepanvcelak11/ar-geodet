#!/usr/bin/env python3
# ===== AR Geodet - DIAGNOSTIKA: panel Body, vyber nastroje, cizi jazyky =========
# Spousti appku v Chromiu, naplni zakazku body a:
#   1) vyfoti panel Body (cesky / anglicky / nemecky),
#   2) vyfoti okno "Na ktery nastroj?" (vyber zkratky),
#   3) najde texty, ktere v cizim jazyce PRETEKAJI nebo se OREZAVAJI,
#   4) vypise, co zustalo cesky v anglicke/nemecke verzi (viditelne texty).
#
# Pouziti:  python scripts/diag_body_jazyk.py [port]
# ==============================================================================
import asyncio
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
URL = 'http://127.0.0.1:%d/index.html' % PORT
OUT = os.environ.get('AG_SHOTS', os.path.join(ROOT, '_diag'))

BOOT = """
  localStorage.setItem('agGuest_v1', JSON.stringify({ts: Date.now()}));
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agBrifinkLastShown', new Date().toISOString().slice(0,10));
  localStorage.setItem('agLockStart_v1','0');
"""

PTS = [
    {"name": "1001", "lat": 50.0875, "lng": 14.4213, "vyska": 231.44, "acc": 0.85, "kod": "ROH"},
    {"name": "1002", "lat": 50.0878, "lng": 14.4219, "vyska": 232.10, "acc": 1.20, "kod": "SLOUP"},
    {"name": "1003", "lat": 50.0871, "lng": 14.4205, "vyska": 230.77, "acc": 0.42},
    {"name": "H-2045-sachta-vychod", "lat": 50.0866, "lng": 14.4231, "vyska": 229.90, "acc": 2.60, "kod": "SACHTA"},
    {"name": "2001", "lat": 50.0881, "lng": 14.4240, "vyska": 233.12, "acc": 0.31, "kod": "HRANICE"},
    {"name": "2002", "lat": 50.0860, "lng": 14.4190, "vyska": 228.44, "acc": 5.10},
]


def a(x):
    return str(x).encode('ascii', 'replace').decode('ascii')


# vsechno viditelne, co pretece svuj ramecek nebo se orizne
OVERFLOW_JS = r"""
() => {
  const out = [];
  const seen = new Set();
  document.querySelectorAll('body *').forEach(el => {
    if (el.closest('#map') || el.closest('#ar-overlay')) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    if (r.bottom < 0 || r.top > innerHeight + 400) return;
    // ma vlastni text?
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    own = own.trim();
    if (!own) return;
    const clipX = el.scrollWidth - el.clientWidth > 1;
    const clipY = el.scrollHeight - el.clientHeight > 1;
    const scrolls = cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowY === 'auto' || cs.overflowY === 'scroll';
    const ellipsis = cs.textOverflow === 'ellipsis' && clipX;
    const hardClip = (cs.overflowX === 'hidden' && clipX) || (cs.overflowY === 'hidden' && clipY);
    const outside = r.right > innerWidth + 1 || r.left < -1;
    if (!(ellipsis || hardClip || outside) || scrolls) return;
    const key = own.slice(0, 40) + '|' + Math.round(r.top);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      text: own.slice(0, 70),
      tag: el.tagName.toLowerCase(),
      cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '')).slice(0, 60),
      id: el.id || '',
      kind: outside ? 'mimo-obrazovku' : (ellipsis ? 'orez-tri-tecky' : 'orez-natvrdo'),
      over: Math.round(Math.max(el.scrollWidth - el.clientWidth, el.scrollHeight - el.clientHeight, r.right - innerWidth))
    });
  });
  return out;
}
"""

# viditelne texty, ktere po prepnuti jazyka zustaly ceske (maji ceskou diakritiku
# nebo je to slovo z ceskeho slovniku) - hrube, ale pro prehled staci
CZECH_JS = r"""
() => {
  const out = [];
  const seen = new Set();
  const dia = /[ěščřžýáíéúůťďňĚŠČŘŽÝÁÍÉÚŮŤĎŇ]/;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const p = n.parentElement;
    if (!p) continue;
    if (p.closest('#map') || p.closest('#ar-overlay')) continue;
    if (p.closest('script, style')) continue;
    const t = (n.nodeValue || '').trim();
    if (t.length < 3) continue;
    if (!dia.test(t)) continue;
    const cs = getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = p.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push({ text: t.slice(0, 70), where: p.id || (p.className && String(p.className).slice(0, 40)) || p.tagName });
  }
  return out;
}
"""


async def shot(page, name):
    p = os.path.join(OUT, name + '.png')
    await page.screenshot(path=p)
    print('   foto: ' + p)


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(PORT)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    report = {}
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(args=[
                '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
            ctx = await browser.new_context(
                permissions=['geolocation'],
                geolocation={'latitude': 50.0875, 'longitude': 14.4213},
                viewport={'width': 412, 'height': 915})
            await ctx.add_init_script(BOOT)
            page = await ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            await page.goto(URL, wait_until='load')
            await page.wait_for_timeout(1500)

            # start appky z uvodni obrazovky
            await page.evaluate("() => { if (typeof startAppFromWelcome === 'function') startAppFromWelcome(); }")
            await page.wait_for_timeout(2000)
            await page.evaluate("(pts) => window.addImportedPoints && window.addImportedPoints(pts)", PTS)
            await page.wait_for_timeout(600)

            for lang in ('cs', 'en', 'de'):
                print('--- jazyk ' + lang + ' ---')
                if lang != 'cs':
                    await page.evaluate("(l) => window.AGJazyk && window.AGJazyk.set(l)", lang)
                    await page.wait_for_timeout(2500)
                # 1) panel Body
                await page.evaluate("() => openManageModal()")
                await page.wait_for_timeout(900)
                await shot(page, 'body-%s' % lang)
                ov = await page.evaluate(OVERFLOW_JS)
                report['body-%s-overflow' % lang] = ov
                if lang != 'cs':
                    report['body-%s-cesky' % lang] = await page.evaluate(CZECH_JS)
                await page.evaluate("() => closeManageModal()")
                await page.wait_for_timeout(300)

                # 2) vyber nastroje pro zkratku
                opened = await page.evaluate(
                    "() => { if (window.AGGesta && window.AGGesta.open) { window.AGGesta.open(); return 'AGGesta'; } return null; }")
                if not opened:
                    # otevrit pres nastaveni radek gest
                    opened = await page.evaluate(r"""() => {
                        const b = document.getElementById('ag-gz-set') || document.querySelector('[onclick*="agGesta"]');
                        if (b) { b.click(); return 'btn'; }
                        return null; }""")
                await page.wait_for_timeout(500)
                got = await page.evaluate(r"""() => {
                    const add = document.getElementById('ag-gz-add');
                    if (add) { add.click(); return true; }
                    return false; }""")
                await page.wait_for_timeout(800)
                if await page.evaluate("() => !!document.getElementById('ag-gz-tools')"):
                    await shot(page, 'zkratka-%s' % lang)
                    ov2 = await page.evaluate(OVERFLOW_JS)
                    report['zkratka-%s-overflow' % lang] = ov2
                    if lang != 'cs':
                        report['zkratka-%s-cesky' % lang] = await page.evaluate(CZECH_JS)
                else:
                    print('   (okno vyberu nastroje se neotevrelo: %s / %s)' % (opened, got))
                await page.evaluate(r"""() => {
                    ['ag-gz-pick','ag-gz-pad','ag-gz-set'].forEach(id => {
                       const e = document.getElementById(id); if (e) e.style.display='none'; }); }""")
                await page.wait_for_timeout(300)

                # 3) hlavni obrazovka + nastroje + nastaveni (preteceni v cizim jazyce)
                await page.evaluate("() => { const m=document.getElementById('tools-modal'); if(m) m.style.display='flex'; }")
                await page.wait_for_timeout(900)
                await shot(page, 'nastroje-%s' % lang)
                report['nastroje-%s-overflow' % lang] = await page.evaluate(OVERFLOW_JS)
                await page.evaluate("() => { const m=document.getElementById('tools-modal'); if(m) m.style.display='none'; }")
                await page.wait_for_timeout(300)

                await page.evaluate("() => typeof openSettings === 'function' && openSettings()")
                await page.wait_for_timeout(1200)
                await shot(page, 'nastaveni-%s' % lang)
                report['nastaveni-%s-overflow' % lang] = await page.evaluate(OVERFLOW_JS)
                await page.evaluate("() => typeof closeSettings === 'function' ? closeSettings() : (document.getElementById('settings-modal').style.display='none')")
                await page.wait_for_timeout(400)

            report['pageerrors'] = errs[:20]
            with open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8') as f:
                json.dump(report, f, ensure_ascii=False, indent=1)
            print('\n===== SHRNUTI =====')
            for k in sorted(report):
                v = report[k]
                if isinstance(v, list):
                    print('%s: %d' % (a(k), len(v)))
                    for it in v[:14]:
                        print('   ' + a(json.dumps(it, ensure_ascii=False)))
            await browser.close()
    finally:
        srv.terminate()


asyncio.run(main())
