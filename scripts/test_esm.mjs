// ===== QTRIG — TESTY ES MODULŮ (js/esm/*.mjs) PŘÍMO V NODE =====================
// (6. 10. 2026, hodnocení — návrh 8). ES moduly appky jsou čistá logika bez DOM,
// takže se dají testovat bez prohlížeče: `node --test scripts/test_esm.mjs`.
// Běží v CI (release-check.yml). Prohlížečové testy (test_nejistota.py,
// test_presnost_nastroje.py, test_kotva_nabidka.py) pak ověřují, že je appka
// přes můstek js/esm/index.mjs opravdu používá.
// ================================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as P from '../js/esm/presnost.mjs';

const blizko = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('sigmaKompasu: srovnaný sever ±1° jen 30 min, pak rozptyl (1–15°), jinak ±5°', () => {
    const ted = 1e12;
    assert.deepEqual(P.sigmaKompasu({ kalibraceTs: ted - 60e3, rozptyl: 9, ted }), { kompas: 1, zdroj: 'kalibrace' });
    assert.deepEqual(P.sigmaKompasu({ kalibraceTs: ted - 31 * 60e3, rozptyl: 9, ted }), { kompas: 9, zdroj: 'rozptyl' });
    assert.equal(P.sigmaKompasu({ rozptyl: 0.2, ted }).kompas, 1);
    assert.equal(P.sigmaKompasu({ rozptyl: 40, ted }).kompas, 15);
    assert.deepEqual(P.sigmaKompasu({ ted }), { kompas: 5, zdroj: 'vychozi' });
});

test('sigmaBodu: zákon hromadění chyb, v mapě bez kompasu', () => {
    const s = P.sigmaBodu({ gps: 4, kompas: 5, d: 30 });
    blizko(s.napric, 30 * Math.sin(5 * Math.PI / 180));
    blizko(s.bod, Math.hypot(4, 30 * Math.sin(5 * Math.PI / 180)));
    assert.equal(P.sigmaBodu({ gps: 4, kompas: 5, d: 30, sKompasem: false }).bod, 4);
    assert.equal(P.sigmaBodu({ gps: 3, kompas: 5, d: -10 }).bod, 3);   // záporná vzdálenost = 0
});

test('posunOMetry: 10 m na sever / východ', () => {
    const lat = 50.0755, lng = 14.4378;
    const s = P.posunOMetry(lat, lng, 10, 0), v = P.posunOMetry(lat, lng, 10, 90);
    blizko((s.lat - lat) * 111320, 10, 1e-6); blizko(s.lng, lng, 1e-12);
    blizko((v.lng - lng) * 111320 * Math.cos(lat * Math.PI / 180), 10, 1e-6); blizko(v.lat, lat, 1e-12);
});

test('telefonStaci: true/false, null když není co porovnat', () => {
    assert.equal(P.telefonStaci(0.1, 4), false);
    assert.equal(P.telefonStaci(1, 0.5), true);
    assert.equal(P.telefonStaci(1, 1), true);
    assert.equal(P.telefonStaci(null, 4), null);
    assert.equal(P.telefonStaci(1, null), null);
});

test('dosahKotvy: 1,5 × přesnost, mezi 3 a 10 m', () => {
    assert.equal(P.dosahKotvy(1), 3);
    assert.equal(P.dosahKotvy(4), 6);
    assert.equal(P.dosahKotvy(20), 10);
});

test('můstek js/esm/index.mjs vystaví všechny moduly jako window.AGEsm', async () => {
    globalThis.window = {}; globalThis.document = { dispatchEvent() {} };
    globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
    await import('../js/esm/index.mjs');
    assert.ok(Object.isFrozen(window.AGEsm));
    assert.equal(window.AGEsm.presnost.sigmaBodu, P.sigmaBodu);
    // každý modul z js/esm (kromě můstku) je v můstku naimportovaný
    const most = readFileSync(new URL('../js/esm/index.mjs', import.meta.url), 'utf8');
    assert.match(most, /from '\.\/presnost\.mjs'/);
});
