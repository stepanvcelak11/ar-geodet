#!/usr/bin/env node
// ===== QTRIG — MINIFIKACE ODLOŽENÝCH MODULŮ PŘI NASAZENÍ ====================
// PROČ: build.mjs zabalí a zminifikuje jen EAGER skripty (dist/app.<hash>.min.js,
// 863 kB). Odložené moduly (<script type="ag/lazy" data-src>, ~103 souborů) a
// nástroje z MANIFESTu js/lazy-tools.js (34 souborů) se ale na Pages servírovaly
// tak, jak leží v repu — 3,0 MB i s komentáři. Změřeno 15. 9. 2026 (CPU 4×):
// fronta odložených modulů po startu = 2,7 s hlavního vlákna; bez komentářů je
// to 2,3 MB, po minifikaci ~1,2 MB. Menší soubor = kratší stažení při
// aktualizaci (service worker precache 254 souborů) i kratší parsování.
//
// CO DĚLÁ: každý js/*.js (mimo js/lib/*) přepíše NA MÍSTĚ minifikovanou verzí
// (esbuild.transform, stejné volby jako build.mjs). Spouští se v pages.yml po
// `npm run build -- --apply`, tedy jen v nasazované kopii — do repa se nic nepíše.
//
// ⚠ VÝJIMKY (nesmí se minifikovat, protože pracují se ZDROJOVÝM TEXTEM funkcí):
//   js/ag-pocty.js + js/dmt-volume.js — Function.prototype.toString() posílá kód
//   do workeru; minifikace by přejmenovala pomocné funkce a worker by spadl na
//   „x is not defined". js/lazy-tools.js — MANIFEST čtou regexem build skripty.
//   Seznam níž, doplnit při každém dalším takovém modulu.
//
// Pouziti:  node scripts/minify-lazy.mjs          (přepíše soubory)
//           node scripts/minify-lazy.mjs --check  (jen spočítá, nic nepíše)
// ================================================================================
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
// js/lazy-tools.js: jeho MANIFEST čtou regexem scripts/gen_sw_assets.py a scripts/vydani.py
// (PRO → ZÁKLAD běží nad týmž stromem) — minifikovaný by přišel o řádkovou strukturu
// a precache by zapomněla 34 nástrojů. Je to 27 kB, nechává se.
const SKIP = new Set(['js/ag-pocty.js', 'js/dmt-volume.js', 'js/lazy-tools.js']);

let esbuild;
try { esbuild = await import('esbuild'); }
catch (e) { throw new Error('esbuild není nainstalován. Spusť nejdřív: npm i'); }

const files = readdirSync(join(ROOT, 'js'))
    .filter(f => f.endsWith('.js'))
    .map(f => 'js/' + f)
    .filter(f => !SKIP.has(f));

let before = 0, after = 0, n = 0;
const fails = [];
for (const rel of files) {
    const abs = join(ROOT, rel);
    const src = readFileSync(abs, 'utf8');
    // už minifikovaný soubor (druhý průchod v CI: PRO → ZÁKLAD) přeskočit podle značky
    if (src.startsWith('/*m*/')) { after += statSync(abs).size; before += statSync(abs).size; continue; }
    try {
        const r = await esbuild.transform(src, { loader: 'js', minify: true, legalComments: 'none', target: 'es2019' });
        const out = '/*m*/' + r.code;
        before += Buffer.byteLength(src, 'utf8'); after += Buffer.byteLength(out, 'utf8'); n++;
        if (!CHECK_ONLY) writeFileSync(abs, out, 'utf8');
    } catch (e) {
        fails.push(rel + ': ' + (e && e.message ? e.message.split('\n')[0] : e));
    }
}
if (fails.length) {
    console.error('minify-lazy: ' + fails.length + ' souborů se nepodařilo minifikovat:\n  ' + fails.join('\n  '));
    process.exit(1);
}
console.error('minify-lazy' + (CHECK_ONLY ? ' (--check, nic nepsáno)' : '') + ': ' + n + ' souborů, '
    + Math.round(before / 1024) + ' kB → ' + Math.round(after / 1024) + ' kB (−' + Math.round(100 - after / Math.max(1, before) * 100) + ' %); '
    + 'přeskočeno: ' + [...SKIP].join(', '));
