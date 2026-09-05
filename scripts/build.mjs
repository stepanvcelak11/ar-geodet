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
//   1) Přečte POŘADÍ js souborů přesně tak, jak je v index.html — a to JEN těch
//      spouštěných při startu (<script src=...>), nebo z explicitního seznamu
//      (viz EXPLICIT_ORDER níže), když ho chceš zafixovat.
//   2) VYNECHÁ knihovny js/lib/* (Leaflet, esri, satellite, qrcode, jsqr, proj4) —
//      ty zůstávají samostatné <script> tagy (jsou to třetí strany, mění se zřídka,
//      a chceme je držet mimo náš bundle kvůli cache).
//   3) VYNECHÁ ODLOŽENÉ MODULY (<script type="ag/lazy" data-src="…">) — viz
//      „ODLOŽENÉ MODULY DO BUNDLU NEPATŘÍ" níž. Zůstávají v index.html jako
//      samostatné řádky a stahuje si je js/lazy-load.js až po prvním obraze.
//   4) Konkatenuje zbytek (ve správném pořadí — pořadí MUSÍ zůstat zachované, protože
//      moduly spoléhají na globály vzniklé dřívějšími skripty), zminifikuje přes
//      esbuild.transform a zapíše dist/app.<contenthash>.min.js.
//   5) Vypíše jméno vytvořeného souboru (poslední řádek stdout = čistě název) —
//      použiješ ho pro <script src> a do scripts/README-build.md je cutover postup.
//
//   Bez přepínače --apply skript NEMĚNÍ index.html ani sw.js — jen vyrobí dist/.
//   S --apply přepíše index.html na jediný <script> s bundlem; to se dělá JEN
//   v CI při nasazení (.github/workflows/pages.yml), ve zdrojích v repu zůstává
//   index.html rozdělený na jednotlivé soubory (pohodlný vývoj bez buildu).
//
// ODLOŽENÉ MODULY DO BUNDLU NEPATŘÍ (5. 9. 2026 — do té doby patřily, a byla to
// nejdražší vada nasazované verze):
//   Skript dřív četl i `data-src`, takže do jednoho <script defer> spadlo všech
//   167 vlastních souborů (4,5 MB zdroje) a v produkci se před PRVNÍM OBRAZEM
//   spustilo úplně všechno — celá vrstva js/lazy-load.js i dělené načítání
//   js/lazy-tools.js byly v tom, co má geodet v telefonu, mrtvé. Rozpočet startu
//   přitom svítil zeleně, protože měřil zdrojový index.html, který v produkci
//   neběží. Navíc --apply ty řádky z index.html odstranil i s `data-css`, takže
//   odložené nástroje zůstaly venku bez stylopisu.
//   Bundle se proto dělá JEN z eager modulů; odložené zůstávají jednotlivé.
//
// A PROČ NE DRUHÝ BUNDLE („tools.<hash>.min.js" pro odložené):
//   Nabízí se, ale slepilo by tři věci, které stojí na CESTĚ K SOUBORU:
//     • vzdálený vypínač modulů — js/priznaky.js hlídá `AGFlags.off('js/x.js')`
//       a js/lazy-load.js se ho ptá u KAŽDÉHO souboru zvlášť; v jednom balíku
//       není co vypnout,
//     • AGLazy.need('js/ucty-admin.js') — cílené dotažení jednoho modulu
//       (konzole správce, kalibrace z bodového pole) by v balíku nic nenašlo
//       a zavolalo callback nad ještě nenačteným kódem,
//     • `data-css` — stylopis patří ke KONKRÉTNÍMU modulu.
//   Úspora by byla pár HTTP dotazů (a ty jde po prvním spuštění stejně ze
//   service workeru), cena tři tiché vady, které se projeví až v terénu.
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
//   --apply        po zabalení přepiš index.html na jediný <script> s bundlem
//                  (pro nasazení; pak spusť scripts/gen_sw_assets.py)
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
// --apply: po zabalení PŘEPÍŠE index.html — všechny vlastní <script src> tagy
// nahradí jediným <script defer src="dist/app.<hash>.min.js">. Používá se v CI
// při nasazení (.github/workflows/pages.yml), NE při vývoji: v repu zůstává
// index.html rozdělený na jednotlivé soubory. Po --apply se pouští
// scripts/gen_sw_assets.py, aby si sw.js přegeneroval seznam assetů.
const APPLY = ARGS.includes('--apply');

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
// ODLOŽENÉ (`type="ag/lazy" data-src="…"`) se vrací ZVLÁŠŤ a do bundlu nejdou —
// důvody jsou v hlavičce („ODLOŽENÉ MODULY DO BUNDLU NEPATŘÍ").
function readScriptsFromIndex() {
    const html = readFileSync(INDEX_HTML, 'utf8');
    const re = /<script\b[^>]*\b(?:data-)?src\s*=\s*["']([^"']+)["'][^>]*><\/script>/gi;
    const eager = [], lazy = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(html)) !== null) {
        const src = m[1].trim();
        if (/^https?:\/\//i.test(src)) continue;   // CDN/externí — neřešíme
        if (!/\.js(\?|$)/i.test(src)) continue;     // jen .js
        const clean = src.split('?')[0].split('#')[0];
        if (seen.has(clean)) continue;
        seen.add(clean);
        (isLazyTag(m[0]) ? lazy : eager).push(clean);
    }
    return { eager, lazy };
}

// Odložený řádek poznáme po type="ag/lazy" (prohlížeč takový skript ani nestáhne).
function isLazyTag(tagText) { return /type\s*=\s*["']ag\/lazy["']/i.test(tagText); }

// --- Sestav finální seznam souborů k zabalení ----------------------------------
// Vrací { files, lazy }: files = co jde do bundlu, lazy = odložené moduly, které
// v index.html zůstávají jako samostatné řádky (jen pro výpis a kontrolu).
function buildFileList() {
    const found = readScriptsFromIndex();
    const order = EXPLICIT_ORDER.length ? EXPLICIT_ORDER.slice() : found.eager;
    // Vyhoď knihovny (vždy) a volitelně lazy moduly
    const files = order.filter(src => {
        if (isLib(src)) return false;
        if (SKIP_LAZY && isLazy(src)) return false;
        return true;
    });
    return { files, lazy: found.lazy };
}

// --- Přepis index.html na bundle (jen s --apply) --------------------------------
// ODLOŽENÉ ŘÁDKY (type="ag/lazy") SE NESAHAJÍ. Dřív padaly do stejné regulárky
// (\bsrc se páruje i v `data-src`) a --apply je z index.html vymazal i s atributem
// data-css — v nasazené appce tak neexistoval nikdo, kdo by odložené nástroje
// natáhl, a jejich deset stylopisů se nestáhlo vůbec.
// Vlastní <script src="js/…"> tagy se ODEBEROU a na místo POSLEDNÍHO z nich se
// vloží jediný tag s bundlem. Proč na místo posledního: knihovny (js/lib/*)
// zůstávají samostatné a musí se vykonat PŘED naším kódem — když bundle položíme
// tam, kde stál poslední vlastní modul, je to zaručené. Kdyby některá knihovna
// byla v dokumentu ZA posledním vlastním skriptem, build to odmítne (jinak by se
// pořadí tiše rozbilo).
function applyToIndex(outName) {
    const html = readFileSync(INDEX_HTML, 'utf8');
    const re = /[ \t]*<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>[ \t]*\r?\n?/gi;

    const own = [], libs = [];
    let m;
    let lazyLeft = 0;
    while ((m = re.exec(html)) !== null) {
        const src = m[1].trim();
        if (isLazyTag(m[0])) { lazyLeft++; continue; }      // odložené necháváme být
        if (/^(https?:)?\/\//i.test(src)) continue;         // CDN — neřešíme
        if (!/\.js(\?|$)/i.test(src)) continue;
        const rec = { start: m.index, end: m.index + m[0].length, text: m[0], src: src };
        if (isLib(src)) libs.push(rec); else own.push(rec);
    }
    if (!own.length) throw new Error('--apply: v index.html nejsou žádné vlastní <script src="js/…"> tagy (už je zabalený?).');

    const lastOwn = own[own.length - 1];
    const lateLib = libs.find(l => l.start > lastOwn.start);
    if (lateLib) {
        throw new Error('--apply: knihovna ' + lateLib.src + ' je v index.html ZA posledním vlastním skriptem — '
            + 'přesuň ji výš, jinak by se bundle vykonal před ní.');
    }

    const eol = html.includes('\r\n') ? '\r\n' : '\n';
    const indent = (lastOwn.text.match(/^[ \t]*/) || [''])[0];
    const tag = indent + '<!-- ZABALENÝ KÓD APPKY (vyrobil scripts/build.mjs --apply při nasazení; ve zdrojích'
        + eol + indent + '     zůstávají jednotlivé js/*.js a tenhle řádek se generuje znovu) -->'
        + eol + indent + '<script defer src="dist/' + outName + '"></script>' + eol;

    // odzadu, ať se nerozsypou indexy
    let out = html;
    for (let i = own.length - 1; i >= 0; i--) {
        const rec = own[i];
        const replacement = (rec === lastOwn) ? tag : '';
        out = out.slice(0, rec.start) + replacement + out.slice(rec.end);
    }
    // Pojistka proti tichému návratu staré vady — zkontroluje se JEŠTĚ PŘED zápisem:
    // kdyby regulárka odložené řádky zase spolkla, appka by se nasadila bez nástrojů
    // a poznalo by se to až v terénu.
    if (!/<script[^>]*type\s*=\s*["']ag\/lazy["'][^>]*data-src/i.test(out)) {
        throw new Error('--apply: v index.html by nezůstal ani jeden <script type="ag/lazy"> — '
            + 'odkládací vrstva by v nasazené verzi neměla co načíst. Zkontroluj applyToIndex().');
    }
    writeFileSync(INDEX_HTML, out, 'utf8');
    console.error('--apply: v index.html nahrazeno ' + own.length + ' vlastních <script> tagů jedním bundlem.');
    console.error('--apply: odložených řádků (ag/lazy) ponecháno beze změny: ' + lazyLeft + '.');
    console.error('--apply: teď spusť  python scripts/gen_sw_assets.py  (sladí seznam v sw.js).');
}

// --- Hlavní -------------------------------------------------------------------
async function main() {
    if (!existsSync(INDEX_HTML)) {
        throw new Error('Nenalezen index.html v ' + ROOT + ' — spouštěj z kořene repa (npm run build).');
    }

    const { files, lazy } = buildFileList();
    if (!files.length) throw new Error('Nepodařilo se zjistit žádné JS soubory k zabalení (zkontroluj index.html / EXPLICIT_ORDER).');

    if (LIST_ONLY) {
        console.error('Pořadí souborů k zabalení (' + files.length + '):');
        files.forEach((f, i) => console.error('  ' + String(i + 1).padStart(2, '0') + '  ' + f));
        console.error('Mimo bundle zůstává ' + lazy.length + ' odložených modulů (ag/lazy) '
            + '+ knihovny js/lib/*.');
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
    console.error('Odloženo mimo bundle (načte js/lazy-load.js až po prvním obraze): ' + lazy.length + ' modulů.');
    if (APPLY) {
        // Pojistka platí dál, ale týká se JEN ručního seznamu LAZY_MODULES (těžké
        // EAGER moduly, které by se doloadovaly vzorem ensureTesseract). Odložené
        // `ag/lazy` moduly jsou z bundlu venku vždy a načítá je js/lazy-load.js —
        // tam žádný rozpor není.
        if (SKIP_LAZY) throw new Error('--apply nelze kombinovat s --lazy: moduly z LAZY_MODULES by se z index.html odebraly, ale nikdo by je nenačetl.');
        applyToIndex(outName);
    }
    console.error('Knihovny js/lib/* zůstávají samostatné.' + (SKIP_LAZY ? ' Moduly z LAZY_MODULES VYNECHÁNY z bundlu.' : ''));
    console.error('Cutover (ručně, viz scripts/README-build.md): nahraď blok <script> tagů jediným <script src="dist/' + outName + '">.');
    // Poslední řádek stdout = čistě název (snadné odchytit ve skriptu)
    console.log(outName);
}

main().catch(err => {
    console.error('CHYBA buildu: ' + (err && err.message ? err.message : err));
    process.exit(1);
});
