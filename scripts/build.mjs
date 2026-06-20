// =============================================================================
// AR Geodet — volitelný (opt-in) build: zabal + zminifikuj vlastní JS do jednoho
// hashovaného souboru dist/app.<contenthash>.min.js
//
// PROČ vůbec:
//   Appka se dnes načítá ~40 jednotlivými <script> tagy v index.html. To je při
//   vývoji super (žádný build, globální funkce sdílené mezi skripty), ale na
//   produkci to znamená spoustu HTTP requestů a ruční bumpování SHELL_CACHE v
//   sw.js po každém pushi (jinak mobil drží starou verzi). Tento build to umí
//   srazit do jednoho minifikovaného souboru s hashem v názvu — hash sám o sobě
//   funguje jako cache-busting, takže ruční bump SHELL_CACHE odpadá.
//
// CO TENHLE SKRIPT DĚLÁ (a co NE):
//   1) Přečte POŘADÍ js souborů přesně tak, jak je v index.html (z <script src=...>),
//      nebo z explicitního seznamu (viz EXPLICIT_ORDER níže), když ho chceš zafixovat.
//   2) VYNECHÁ knihovny js/lib/* (Leaflet, esri, satellite, qrcode, jsqr, proj4) —
//      ty zůstávají samostatné <script> tagy (jsou to třetí strany, mění se zřídka,
//      a chceme je držet mimo náš bundle kvůli cache).
//   3) VOLITELNĚ vynechá těžké „lazy" moduly (LAZY_MODULES níže) — ty se pak
//      doloadují až na klik (vzorem ensureTesseract v js/logika.js). Defaultně je
//      bundle nechává UVNITŘ (bezpečné, nic se nerozbije); lazy zapneš až ručně.
//   4) Konkatenuje zbytek (ve správném pořadí — pořadí MUSÍ zůstat zachované, protože
//      moduly spoléhají na globály vzniklé dřívějšími skripty), zminifikuje přes
//      esbuild.transform a zapíše dist/app.<contenthash>.min.js.
//   5) Vypíše jméno vytvořeného souboru (poslední řádek stdout = čistě název) —
//      použiješ ho pro <script src> a do scripts/README-build.md je cutover postup.
//
//   Tento skript NEMĚNÍ index.html ani sw.js. Je čistě opt-in nástroj. Dokud
//   nepřepíšeš blok <script> tagů v index.html ručně (viz README), appka jede
//   pořád po staru přes jednotlivé skripty a tento bundle se nikde nepoužije.
//
// IDEMPOTENCE: stejný vstup (stejné soubory + stejné pořadí) => stejný hash =>
//   stejný název souboru. Opakované spuštění nic nerozbije; staré dist/app.*.min.js
//   se před zápisem uklidí (necháme jen ten aktuální).
//
// SPUŠTĚNÍ:
//   npm i            (jednorázově — stáhne esbuild do node_modules)
//   npm run build        => vyrobí dist/app.<hash>.min.js
//   npm run build:check  => jen ověří, že vše projde (transform), ale nezapíše dist
//
// PŘEPÍNAČE:
//   --check        ověř + minifikuj, ale nezapisuj výstup (CI/sanity)
//   --lazy         z bundlu VYNECHEJ moduly z LAZY_MODULES (menší bundle; pak je
//                  musíš lazy-loadovat na klik — viz README)
//   --list         jen vypiš zjištěné pořadí souborů a skonči
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

// --- Cesty (skript běží odkudkoli; kotvíme se na kořen repa = rodič scripts/) ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INDEX_HTML = join(ROOT, 'index.html');
const DIST_DIR = join(ROOT, 'dist');

// --- Argumenty ----------------------------------------------------------------
const ARGS = process.argv.slice(2);
const CHECK_ONLY = ARGS.includes('--check');
const SKIP_LAZY = ARGS.includes('--lazy');
const LIST_ONLY = ARGS.includes('--list');

// --- Co se z bundlu VŽDY vynechá (zůstávají samostatné <script> tagy) ----------
// Knihovny třetích stran v js/lib/*. Poznáme je podle prefixu "js/lib/".
function isLib(src) { return /(^|\/)js\/lib\//.test(src); }

// --- Volitelné „lazy" moduly (vynechají se jen s přepínačem --lazy) -------------
// Těžší nástroje, které nemusí být v hlavním bundlu — dají se doloadovat na klik
// vzorem ensureTesseract (viz README). Match podle koncovky cesty (basename).
const LAZY_MODULES = [
    'js/kalkulacka.js',
    'js/dmt-volume.js',
    'js/satelity.js',
    'js/parcela.js',
    'js/project-import.js',
];
function isLazy(src) {
    const b = src.replace(/^\.?\//, '');
    return LAZY_MODULES.some(m => b === m || b.endsWith('/' + m) || basename(b) === basename(m));
}

// --- EXPLICITNÍ pořadí (necháno prázdné => čte se z index.html) -----------------
// Když budeš chtít pořadí zafixovat nezávisle na index.html, vyplň sem relativní
// cesty (např. 'js/power-save.js', ...) přesně v pořadí načítání. Prázdné pole =
// zdrojem pravdy je index.html (preferováno — jeden zdroj pravdy).
const EXPLICIT_ORDER = [
    // 'js/power-save.js',
    // 'js/logika.js',
    // ...
];

// --- Přečti pořadí <script src="js/..."> z index.html --------------------------
// Bere jen LOKÁLNÍ .js (src bez http/https), v pořadí výskytu. Zachová duplicitní
// kontrolu (kdyby se nějaký omylem objevil 2x, vezme se jednou).
function readOrderFromIndex() {
    const html = readFileSync(INDEX_HTML, 'utf8');
    const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*><\/script>/gi;
    const out = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(html)) !== null) {
        const src = m[1].trim();
        if (/^https?:\/\//i.test(src)) continue;   // CDN/externí — neřešíme
        if (!/\.js(\?|$)/i.test(src)) continue;     // jen .js
        const clean = src.split('?')[0].split('#')[0];
        if (seen.has(clean)) continue;
        seen.add(clean);
        out.push(clean);
    }
    return out;
}

// --- Sestav finální seznam souborů k zabalení ----------------------------------
function buildFileList() {
    let order = EXPLICIT_ORDER.length ? EXPLICIT_ORDER.slice() : readOrderFromIndex();
    // Vyhoď knihovny (vždy) a volitelně lazy moduly
    return order.filter(src => {
        if (isLib(src)) return false;
        if (SKIP_LAZY && isLazy(src)) return false;
        return true;
    });
}

// --- Hlavní -------------------------------------------------------------------
async function main() {
    if (!existsSync(INDEX_HTML)) {
        throw new Error('Nenalezen index.html v ' + ROOT + ' — spouštěj z kořene repa (npm run build).');
    }

    const files = buildFileList();
    if (!files.length) throw new Error('Nepodařilo se zjistit žádné JS soubory k zabalení (zkontroluj index.html / EXPLICIT_ORDER).');

    if (LIST_ONLY) {
        console.error('Pořadí souborů k zabalení (' + files.length + '):');
        files.forEach((f, i) => console.error('  ' + String(i + 1).padStart(2, '0') + '  ' + f));
        if (SKIP_LAZY) console.error('(--lazy: vynechány moduly ' + LAZY_MODULES.join(', ') + ')');
        return;
    }

    // Načti a zkontroluj existenci každého souboru; spoj s oddělovačem a ;\n,
    // ať se IIFE neslepí (každý modul je sám o sobě uzavřený, ale ; je pojistka).
    const parts = [];
    const missing = [];
    for (const rel of files) {
        const abs = join(ROOT, rel);
        if (!existsSync(abs)) { missing.push(rel); continue; }
        const code = readFileSync(abs, 'utf8');
        parts.push('/* === ' + rel + ' === */\n' + code + '\n;');
    }
    if (missing.length) {
        throw new Error('Chybí soubory uvedené v index.html: ' + missing.join(', '));
    }

    const concatenated = parts.join('\n');

    // Minifikace přes esbuild (lazy import — esbuild je devDependency).
    let esbuild;
    try {
        esbuild = await import('esbuild');
    } catch (e) {
        throw new Error('esbuild není nainstalován. Spusť nejdřív: npm i');
    }

    const result = await esbuild.transform(concatenated, {
        loader: 'js',
        minify: true,
        legalComments: 'none',
        // Žádný transpile cílů: appka jede v moderních mobilních prohlížečích,
        // kód je psaný ručně pro ně. Necháme syntax tak, jak je.
        target: 'es2019',
    });

    const minified = result.code;
    const hash = createHash('sha256').update(minified).digest('hex').slice(0, 10);
    const outName = 'app.' + hash + '.min.js';

    if (CHECK_ONLY) {
        console.error('build:check OK — ' + files.length + ' souborů, ' + minified.length + ' B po minifikaci, hash ' + hash);
        console.error('(--check: dist se NEzapisuje)');
        console.log(outName); // poslední řádek = název, který by vznikl
        return;
    }

    // Připrav dist/ a ukliď staré app.*.min.js (necháme jen aktuální)
    mkdirSync(DIST_DIR, { recursive: true });
    try {
        for (const f of readdirSync(DIST_DIR)) {
            if (/^app\.[0-9a-f]+\.min\.js$/i.test(f) && f !== outName) {
                try { unlinkSync(join(DIST_DIR, f)); } catch (e) { /* nevadi */ }
            }
        }
    } catch (e) { /* dist je nový — nevadi */ }

    writeFileSync(join(DIST_DIR, outName), minified, 'utf8');

    console.error('Hotovo: dist/' + outName + '  (' + files.length + ' modulů, ' + minified.length + ' B)');
    console.error('Knihovny js/lib/* zůstávají samostatné. ' + (SKIP_LAZY ? 'Lazy moduly VYNECHÁNY z bundlu.' : 'Lazy moduly jsou UVNITŘ (spusť s --lazy pro jejich vynechání).'));
    console.error('Cutover (ručně, viz scripts/README-build.md): nahraď blok <script> tagů jediným <script src="dist/' + outName + '">.');
    // Poslední řádek stdout = čistě název (snadné odchytit ve skriptu)
    console.log(outName);
}

main().catch(err => {
    console.error('CHYBA buildu: ' + (err && err.message ? err.message : err));
    process.exit(1);
});
