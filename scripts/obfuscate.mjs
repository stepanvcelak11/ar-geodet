#!/usr/bin/env node
// ===== QTRIG — OBFUSKACE ODLOŽENÝCH MODULŮ PŘI NASAZENÍ =====================
// PROČ: minifikace (scripts/minify-lazy.mjs) jen zkrátí jména a smaže komentáře —
// kód pořád čte kdokoli s F12. Tenhle krok jde dál: přejmenuje vnitřní proměnné
// na hexadecimální nesmysly, řetězce (texty, klíče, URL workeru) schová do
// zakódovaného pole a přisype trochu mrtvého kódu. Výsledek FUNGUJE STEJNĚ, jen
// se v něm nedá vyznat — pochopení logiky z odpoledne na dny. NEZABRÁNÍ zkopírování
// celé appky (spuštěný JS má prohlížeč vždy čitelný v paměti); zvyšuje jen cenu
// za POROZUMĚNÍ tomu, JAK to appka dělá. Skutečná ochrana = soukromé repo +
// ověřování Pro na serveru (viz js/licence.js).
//
// CO DĚLÁ: každý js/*.js (mimo výjimky a js/lib/*) přepíše NA MÍSTĚ obfuskovanou
// verzí. Běží v pages.yml PO `node scripts/minify-lazy.mjs` a PŘED smoke testy,
// takže když obfuskace něco rozbije, smoke to chytí a nasazení se zastaví. Do
// repa nic nepíše (CI si strom mezi vydáními vrací `git checkout`).
//
// ⚠ HLAVNÍ BALÍK dist/app.*.min.js SE ZATÍM NEOBFUSKUJE — měří ho „Rozpočet
//   startu" a obfuskace přidává bajty i práci na hlavním vláknu. Až jeden zelený
//   běh potvrdí řetězec, dá se sem přidat i jádro (viz DÁL DOLE).
//
// ⚠ VÝJIMKY (stejné jako minify + navíc): moduly, které posílají VLASTNÍ ZDROJOVÝ
//   TEXT funkce do Web Workeru přes Function.prototype.toString(), obfuskovat
//   NELZE — přejmenované proměnné by ve workeru spadly na „x is not defined".
//   Ověřeno grepem 19. 9. 2026: jediný takový je js/ag-pocty.js (+ js/dmt-volume.js
//   posílá kód do workeru taktéž). js/lazy-tools.js = MANIFEST čtený regexem.
//
// ⚠ VĚDOMĚ VYPNUTO: disableConsoleOutput (konzole vlastníka + err-log / „Hlášení
//   pro vývoj" na ní stojí), selfDefending a debugProtection (rozbily by ladění,
//   AG-lite a Play občas vrací appky s anti-debugem k prověření), renameGlobals
//   (appka drží 220 souborů pohromadě přes window.AG*, quickToast, t() — přejmenování
//   globálů by ji položilo). controlFlowFlattening je NEJúčinnější, ale 2–3× zpomalí
//   běh (renderAR jede 60×/s) — proto vypnuto.
//
// SOURCE MAPY: ke každému souboru vzniká _obfmaps/<jméno>.map (mimo _site, do webu
// se nenasazuje). Slouží k překladu záhadných stack trace z „Hlášení pro vývoj"
// zpět na původní řádky. sourceMappingURL se z nasazeného .js MAŽE, aby mapa
// obfuskaci neprozradila.
//
// Pouziti:  node scripts/obfuscate.mjs          (přepíše soubory)
//           node scripts/obfuscate.mjs --check  (jen spočítá, nic nepíše)
// ================================================================================
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const MAPDIR = join(ROOT, '_obfmaps');

// Stejná trojice jako minify (js/ag-pocty.js, js/dmt-volume.js posílají kód do
// workeru; js/lazy-tools.js má MANIFEST čtený regexem) — obfuskace je agresivnější,
// takže seznam nesmí být MENŠÍ než u minifikace.
const SKIP = new Set(['js/ag-pocty.js', 'js/dmt-volume.js', 'js/lazy-tools.js']);

let JsObf;
try { JsObf = (await import('javascript-obfuscator')).default; }
catch (e) { throw new Error('javascript-obfuscator není nainstalován. Spusť nejdřív: npm i'); }

// Střední profil: nečitelnost bez cenného zpomalení. Volby vysvětleny v hlavičce.
const OPTS = {
    compact: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    stringArray: true,
    stringArrayThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayIndexShift: true,
    splitStrings: false,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.1,
    controlFlowFlattening: false,
    numbersToExpressions: false,
    simplify: true,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    selfDefending: false,
    debugProtection: false,
    disableConsoleOutput: false,
    sourceMap: true,
    sourceMapMode: 'separate',
    target: 'browser',
};

const files = readdirSync(join(ROOT, 'js'))
    .filter(f => f.endsWith('.js'))
    .map(f => 'js/' + f)
    .filter(f => !SKIP.has(f));

if (!CHECK_ONLY) { try { mkdirSync(MAPDIR, { recursive: true }); } catch (e) { } }

// //# sourceMappingURL=... na konci nasazeného kódu smazat (mapu do webu nedáváme)
const STRIP_MAP = /\n?\/\/# sourceMappingURL=.*$/;

// ⚠⚠ VLASTNÍ PREFIX GLOBÁLŮ PRO KAŽDÝ SOUBOR (23. 9. 2026 — nasazení v388 spadlo na smoke:
//   „TypeError: Cannot read properties of undefined (reading 'charAt')“ jen v zabalené verzi).
//   Obfuskátor ke každému souboru přidá na NEJVYŠŠÍ úroveň pomocné funkce (pole řetězců
//   a jeho dekodér) s náhodným jménem `_0x…`. Klasické <script> sdílejí globální prostor,
//   takže když si dva z 220 souborů vylosují stejné jméno, pozdější přepíše dřívější
//   a dekodér prvního souboru čte CIZÍ pole → undefined.charAt. Je to los při každém
//   sestavení (v387 prošla, v388 ne). identifiersPrefix je přesně na tohle („use this
//   option when you want to obfuscate multiple files“); renameGlobals zůstává vypnuté,
//   prefix dostanou jen nově vzniklé globály obfuskátoru.
const _prefixy = new Set();
function prefixPro(rel) {
    let h = 5381;
    for (let i = 0; i < rel.length; i++) h = ((h * 33) ^ rel.charCodeAt(i)) >>> 0;
    let p = 'q' + h.toString(36);
    while (_prefixy.has(p)) p += 'x';
    _prefixy.add(p);
    return p;
}

let before = 0, after = 0, n = 0;
const fails = [];
for (const rel of files) {
    const abs = join(ROOT, rel);
    const src = readFileSync(abs, 'utf8');
    // už obfuskovaný (druhý průchod PRO→ZÁKLAD nad týmž stromem) přeskočit podle značky
    if (src.startsWith('/*o*/')) { after += statSync(abs).size; before += statSync(abs).size; continue; }
    try {
        const res = JsObf.obfuscate(src, { ...OPTS, identifiersPrefix: prefixPro(rel), sourceMapFileName: rel.replace(/[\/\\]/g, '_') });
        let code = res.getObfuscatedCode().replace(STRIP_MAP, '');
        const out = '/*o*/' + code;
        before += Buffer.byteLength(src, 'utf8'); after += Buffer.byteLength(out, 'utf8'); n++;
        if (!CHECK_ONLY) {
            writeFileSync(abs, out, 'utf8');
            const map = res.getSourceMap && res.getSourceMap();
            if (map) writeFileSync(join(MAPDIR, rel.replace(/[\/\\]/g, '_') + '.map'), map, 'utf8');
        }
    } catch (e) {
        fails.push(rel + ': ' + (e && e.message ? e.message.split('\n')[0] : e));
    }
}
if (fails.length) {
    console.error('obfuscate: ' + fails.length + ' souborů se nepodařilo obfuskovat:\n  ' + fails.join('\n  '));
    process.exit(1);
}
console.error('obfuscate' + (CHECK_ONLY ? ' (--check, nic nepsáno)' : '') + ': ' + n + ' souborů, '
    + Math.round(before / 1024) + ' kB → ' + Math.round(after / 1024) + ' kB (+' + Math.round(after / Math.max(1, before) * 100 - 100) + ' %); '
    + 'přeskočeno: ' + [...SKIP].join(', '));

// ── DÁL DOLE: až bude řetězec ověřený jedním zeleným během, přidat i jádro ──────
// Hlavní balík je dist/app.<hash>.min.js (jediný soubor, viz scripts/build.mjs).
// Obfuskovat ho stejným OPTS (bez controlFlowFlattening kvůli renderAR) a POTÉ
// znovu spustit „Rozpočet startu" — když se vejde, nechat; když ne, snížit
// stringArrayThreshold na ~0.4 a deadCodeInjection vypnout.
