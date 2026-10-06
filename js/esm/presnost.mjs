// ===== QTRIG — PŘESNOST TELEFONU: čisté výpočty (ES MODUL) =====================
// (6. 10. 2026, hodnocení — návrh 8: postupný převod na ES moduly)
//
// První ES modul appky. Je v něm JEN čistá logika — žádný DOM, žádné globály, žádný
// localStorage: vstupy dostane v parametrech, výsledek vrátí. Díky tomu se dá
// testovat přímo v Node (scripts/test_esm.mjs, běží v CI) a nikdo ho nemůže rozbít
// tím, že přejmenuje globál.
//
// KDO HO POUŽÍVÁ: klasické skripty appky (js/nejistota.js, js/presnost-nastroje.js,
// js/kotva-nabidka.js) přes můstek js/esm/index.mjs → window.AGEsm.presnost. Proč
// můstek, viz hlavička index.mjs.
//
// JEDNOTKY: metry, stupně, milisekundy. σ = střední chyba (68 %).
// ================================================================================

export const DEG = Math.PI / 180;

/** Za jak dlouho po srovnání severu podle bodu se mu ještě věří (±1°). */
export const KALIBRACE_PLATI_MS = 30 * 60 * 1000;

/**
 * Chyba kompasu (σ ve stupních) a odkud je.
 * @param {{kalibraceTs?: number|null, rozptyl?: number|null, ted: number}} o
 *   kalibraceTs = kdy se naposledy srovnal sever podle bodu, rozptyl = rozptyl kompasu za pár sekund (°)
 * @returns {{kompas: number, zdroj: 'kalibrace'|'rozptyl'|'vychozi'}}
 */
export function sigmaKompasu({ kalibraceTs = null, rozptyl = null, ted }) {
    if (kalibraceTs && ted - kalibraceTs < KALIBRACE_PLATI_MS) return { kompas: 1, zdroj: 'kalibrace' };
    if (rozptyl != null && rozptyl > 0) return { kompas: Math.max(1, Math.min(15, rozptyl)), zdroj: 'rozptyl' };
    return { kompas: 5, zdroj: 'vychozi' };
}

/**
 * σ polohy bodu ve vzdálenosti d (zákon hromadění chyb, nezávislé zdroje):
 *   σ_napříč = d · sin σ_kompas,  σ_bod = √(σ_GPS² + σ_napříč²)
 * @param {{gps: number, kompas: number, d?: number, sKompasem?: boolean}} o
 *   sKompasem = false → jen poloha (mapa: kompas se na polohu bodu nepromítá)
 */
export function sigmaBodu({ gps, kompas, d = 0, sKompasem = true }) {
    const napric = sKompasem ? Math.max(0, d) * Math.sin(kompas * DEG) : 0;
    return { gps, kompas, napric, bod: Math.sqrt(gps * gps + napric * napric) };
}

/** Bod o r metrů daným azimutem (°) — na pár desítkách metrů stačí rovina. */
export function posunOMetry(lat, lng, r, azimut) {
    return {
        lat: lat + r * Math.cos(azimut * DEG) / 111320,
        lng: lng + r * Math.sin(azimut * DEG) / (111320 * Math.cos(lat * DEG))
    };
}

/**
 * Stačí telefon na nástroj? null = nedá se říct (nástroj nic nepotřebuje, nebo není fix).
 * @param {number|null} potreba σ, kterou výsledek nástroje potřebuje (m)
 * @param {number|null} telefon σ polohy, kterou telefon zrovna má (m)
 */
export function telefonStaci(potreba, telefon) {
    if (!(potreba > 0) || !(telefon > 0)) return null;
    return telefon <= potreba;
}

/**
 * Do jaké vzdálenosti od úředního bodu se dá říct „stojíš u něj":
 * když na bodě stojíš, telefon ukazuje vzdálenost zhruba rovnou své chybě.
 * @param {number} acc přesnost GPS (m)
 */
export function dosahKotvy(acc) {
    return Math.max(3, Math.min(10, 1.5 * acc));
}
