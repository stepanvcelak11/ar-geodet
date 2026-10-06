// ===== QTRIG — MŮSTEK ES MODULŮ → window.AGEsm ==============================
// (6. 10. 2026, hodnocení — návrh 8: postupný převod na ES moduly)
//
// PROČ MŮSTEK: appka má ~230 klasických skriptů ve společném globálním prostoru
// a jejich pořadí v index.html je závazné. Klasický skript neumí `import`, takže
// ES moduly se do něj dostanou jen přes globál. Tenhle soubor je JEDINÉ místo,
// které ho plní: naimportuje moduly z js/esm/ a vystaví je jako window.AGEsm.<modul>.
//
// JAK SE NAČÍTÁ: <script type="module" src="js/esm/index.mjs"> v index.html. Modulové
// skripty jsou odložené (jako `defer`) a doběhnou PŘED DOMContentLoaded, ve stejné
// frontě a pořadí jako ostatní `defer` skripty — takže moduly ze vrstvy
// js/lazy-load.js (běží až po prvním obraze) AGEsm vždycky najdou.
//
// CO TO ZNAMENÁ PRO NÁSTROJE KOLEM (ověřeno 6. 10. 2026):
//   • scripts/build.mjs balí jen *.js → .mjs nechá být a jejich <script type="module">
//     zůstane v index.html i v nasazené verzi,
//   • scripts/obfuscate.mjs a minify-lazy.mjs berou jen js/*.js (podadresář esm/ ne),
//   • scripts/gen_sw_assets.py dá do předcache index.mjs i všechno, co importuje,
//   • scripts/check_js.py kontroluje js/esm/*.mjs jako moduly (node --check),
//   • scripts/test_esm.mjs testuje moduly přímo v Node (CI, release-check.yml).
//
// JAK PŘEVÉST DALŠÍ KUS: čistou logiku (bez DOM a globálů) vytáhni do js/esm/<nazev>.mjs
// s `export function …`, přidej ji sem do AGEsm a do scripts/test_esm.mjs; volající
// klasický skript ji bere z window.AGEsm.<nazev>. Moduly s DOM a s obalováním cizích
// funkcí zatím ZŮSTÁVAJÍ klasické — jejich převod potřebuje nejdřív build, který
// umí ES moduly zabalit (esbuild bundle), viz scripts/README-build.md.
// ================================================================================
import * as presnost from './presnost.mjs';

window.AGEsm = Object.freeze(Object.assign({}, window.AGEsm || {}, { presnost }));
try { document.dispatchEvent(new CustomEvent('ag:esm')); } catch (e) { /* starý prohlížeč */ }
