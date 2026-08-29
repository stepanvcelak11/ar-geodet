// =============================================================================
// AR Geodet — sestavení denního Geo zpravodaje (běží v GitHub Actions)
//
// Co dělá:
//   1) Stáhne RSS/Atom zdroje (geodézie ČR i svět), posbírá čerstvé položky.
//   2) Sestaví z nich české vydání v našem formátu (data/zpravodaj.json).
//   3) Výsledek zvaliduje a zapíše.
//
// ⚠ ZMĚNA 29. 8. 2026 — PROČ TENHLE SKRIPT UŽ NEJEDE PŘES GITHUB MODELS
// Krok 2 dřív obstarával model přes GitHub Models (openai/gpt-4o-mini). Ten je
// RETIRED: `https://models.github.ai/inference/chat/completions` vrací
//     HTTP 410 {"error":{"code":"github_models_retirement_brownout", …}}
// a druhý endpoint `models.inference.ai.azure.com` už neexistuje ani v DNS.
// Skript proto od konce července padal KAŽDÉ RÁNO a chodily e-maily „spadla
// aktualizace" — přitom RSS zdroje jsou v pořádku (ověřeno, všechny čtyři vrací
// HTTP 200). Zpravodaj v appce zamrzl na vydání z 30. 7. 2026.
//
// Náhrada je ZDARMA a bez tajemství: vydání se skládá PRAVIDLOVĚ přímo z RSS —
// titulek, úryvek, zdroj, odkaz, rubrika podle klíčových slov. Nic se nevymýšlí
// (na halucinace tedy není kde vzniknout), ale cizojazyčné zprávy zůstávají
// v původním znění; říká to i úvodník, ať to není překvapení.
//
// VOLITELNĚ, když se jednou bude chtít zpátky české shrnutí: stačí do repozitáře
// přidat secret ANTHROPIC_API_KEY a doplnit ho do workflow (viz zpravodaj.yml).
// Skript ho sám najde a nechá text učesat modelem. Bez klíče se ta větev NIKDY
// nezavolá, takže nic nestojí; a kdyby volání selhalo, tiše se použije pravidlové
// vydání — model smí vydání jen VYLEPŠIT, nikdy shodit.
//
// Bezpečnost: když se nepodaří stáhnout dost zpráv, skript skončí chybou
// a NEPŘEPÍŠE poslední dobré vydání.
//
// Zdroje upravíš v poli FEEDS níže. Mrtvý/nedostupný feed se jen přeskočí.
// =============================================================================
import { writeFileSync } from 'node:fs';

const OUT = 'data/zpravodaj.json';

// --- Zdroje (RSS/Atom). Klidně přidávej/odebírej; neexistující se přeskočí. -----
const FEEDS = [
    // ČR — „Z domova" (ověřené RSS 2.0)
    { source: 'ČÚZK', url: 'https://cuzk.gov.cz/Zememerictvi/Zememericke-cinnosti/Aktuality-pro-zememerice.aspx?rss=b02d6eea-7d16-47a4-9816-21dea74247ce', cs: true },
    // Svět (ověřeno, že jdou stáhnout ze serveru)
    { source: 'xyHt', url: 'https://www.xyht.com/feed/' },
    { source: 'The American Surveyor', url: 'https://amerisurv.com/feed/' },
    { source: 'LiDAR Magazine', url: 'https://lidarmag.com/feed/' },
    // Pozn.: GPS World / Geospatial World / GoGeomatics / Esri blog blokují roboty (HTTP 403),
    // GIM International nemá veřejné RSS. Přidávej jen feedy, co projdou serverovým stažením.
];

const RUBRIKY = ['Z domova', 'Ze světa', 'Přístroje', 'Technologie', 'Zákon', 'Z praxe', 'Tip', 'Akce', 'Vzdělávání'];
const SNIPPET_MAX = 700;       // ořez úryvku na položku
const HARD_MAX_AGE_DAYS = 120; // vyřaď jen opravdu staré zprávy; jinak ber nejnovější (obor je pomalý)
const MIN_ITEMS = 4;           // míň než tohle = nepřepisovat staré vydání
const MAX_ITEMS = 8;

// --- Pomocné ------------------------------------------------------------------
function stripTags(s) {
    return String(s || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ').trim();
}
function pick(tag, block) {
    const m = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
    return m ? m[1] : '';
}
function pickLink(block) {
    let m = block.match(/<link[^>]*href=["']([^"']+)["']/i);   // Atom
    if (m) return m[1];
    m = block.match(/<link>([\s\S]*?)<\/link>/i);              // RSS
    if (m) return stripTags(m[1]);
    m = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    return m && /^https?:/i.test(stripTags(m[1])) ? stripTags(m[1]) : '';
}
function toTs(d) { const t = Date.parse(d || ''); return Number.isNaN(t) ? null : t; }

function parseItems(xml, feed) {
    const out = [];
    const re = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(xml))) {
        const b = m[2];
        const title = stripTags(pick('title', b));
        const link = pickLink(b);
        const desc = stripTags(pick('content:encoded', b) || pick('description', b) || pick('summary', b) || pick('content', b));
        const date = stripTags(pick('pubDate', b) || pick('updated', b) || pick('published', b) || pick('dc:date', b));
        if (title && /^https?:/i.test(link)) {
            out.push({ source: feed.source, cs: !!feed.cs, title, link, snippet: desc.slice(0, SNIPPET_MAX), date, ts: toTs(date) });
        }
    }
    return out;
}

async function fetchText(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
        const r = await fetch(url, {
            headers: {
                // Prohlížečová hlavička — část serverů blokuje „robotí" User-Agent (HTTP 403).
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
                'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
                'Accept-Language': 'cs,en;q=0.8',
            },
            signal: ctrl.signal,
            redirect: 'follow',
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.text();
    } finally { clearTimeout(t); }
}

function todayPrague() {
    // TZ je v workflow nastavená na Europe/Prague, takže new Date() je v místním čase.
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function dayOf(ts, fallback) {
    if (!ts) return fallback;
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// --- Pravidlové sestavení vydání (výchozí cesta, bez modelu) -------------------
// Rubrika podle zdroje a klíčových slov. Pořadí testů je záměrné: konkrétnější
// zařazení (zákon, akce) má přednost před obecným „Technologie".
const RULES = [
    { r: 'Zákon', re: /\b(law|legislation|regulation|act|bill|policy|statute|licen[cs]|vyhlá|zákon|novela|předpis)\b/i },
    { r: 'Akce', re: /\b(conference|expo|summit|symposium|webinar|workshop|meeting|konferenc|seminá|veletrh)\b/i },
    { r: 'Vzdělávání', re: /\b(education|student|university|course|training|scholarship|curriculum|škol|studen|kurz|výuk)\b/i },
    { r: 'Přístroje', re: /\b(receiver|total station|theodolite|instrument|hardware|launch|unveil|release[sd]?\s+the\s+new|rover|antenna|tripod|přístroj|totální stanic|přijímač)\b/i },
    { r: 'Technologie', re: /\b(lidar|scan|point cloud|bim|drone|uav|photogramm|ai\b|machine learning|software|digital twin|mračn|skenov|dron|fotogrammetr)\b/i },
    { r: 'Z praxe', re: /\b(project|survey(ed|ing)?\s+of|case study|field|construction|site|stavb|projekt|v terénu)\b/i },
];
// Rubriku hledej NEJDŘÍV V TITULKU a teprve pak v úryvku — a v úryvku už jen
// pravidly, která snesou zmínku mimochodem. Bez toho stačilo, aby text kdekoli
// zmínil konferenci, a zpráva o novém přístroji spadla do „Akcí" (naměřeno:
// 4 z 8 položek skončily v Akcích, tři z nich neprávem).
const SNIPPET_OK = { 'Přístroje': 1, 'Technologie': 1, 'Z praxe': 1 };
function rubrikaOf(it) {
    if (it.cs) return 'Z domova';
    for (const { r, re } of RULES) if (re.test(it.title)) return r;
    for (const { r, re } of RULES) if (SNIPPET_OK[r] && re.test(it.snippet)) return r;
    return 'Ze světa';
}
// První 1–2 věty úryvku jako perex. Když úryvek chybí, ať perex radši řekne
// pravdu („zdroj neposlal úryvek") než aby se vymýšlelo, o čem zpráva je.
function perexOf(it) {
    const s = (it.snippet || '').trim();
    if (!s) return 'Zdroj u této zprávy neposlal úryvek — otevři originál.';
    // Konec věty = tečka, za kterou následuje mezera a VELKÉ písmeno (nebo konec).
    // Prosté [.!?] lámalo perex uprostřed „dne 16. září" a u zkratek („č. j.").
    const m = s.match(/^[\s\S]{40,220}?[.!?](?=\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]|$)/);
    let p = (m ? m[0] : s.slice(0, 200)).trim();
    if (p.length < s.length && !/[.!?]$/.test(p)) p += '…';
    return p;
}
function buildRuleBased(items, today) {
    const polozky = items.map((it) => ({
        rubrika: rubrikaOf(it),
        top: false,
        nadpis: it.title,
        perex: perexOf(it),
        telo: it.snippet || '',
        body: [],
        proc: '',
        zdroj: it.source,
        odkaz: it.link,
        datum: dayOf(it.ts, today),
    }));
    // „Top" = nejnovější domácí zpráva, jinak prostě nejnovější. Domácí má
    // přednost schválně: katastr a ČÚZK se českého geodeta týkají nejvíc.
    let top = polozky.findIndex((p) => p.rubrika === 'Z domova');
    if (top < 0) top = 0;
    if (polozky[top]) polozky[top].top = true;
    const ciziCount = polozky.filter((p) => p.zdroj !== 'ČÚZK').length;
    const uvodnik = 'Vydání ' + today + ' — ' + polozky.length + ' zpráv z geodézie'
        + (ciziCount ? ' (zahraniční zdroje v původním znění).' : '.');
    return { vydani: today, uvodnik, polozky };
}

// --- Volitelné učesání modelem (jen když je klíč; viz hlavička) ----------------
// Raw HTTP schválně: workflow neinstaluje žádné npm balíčky (skript používá jen
// vestavěné moduly Node), takže tu oficiální SDK není k dispozici.
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

function extractJson(text) {
    let t = String(text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try { return JSON.parse(t); } catch (e) { /* zkus podřetězec */ }
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { } }
    return null;
}

async function polishWithClaude(edition, today) {
    const SYS = [
        'Jsi editor českého geodetického zpravodaje pro aplikaci AR Geodet (nástroj pro geodety v terénu).',
        'Dostaneš HOTOVÉ vydání složené z reálných RSS zpráv. Tvoje práce je jazyková, ne rešeršní:',
        '- Přelož do češtiny nadpis, perex a telo u cizojazyčných položek.',
        '- Perex zkrať na 1–2 věty, telo na 4–8 vět. Je-li podklad krátký, napiš kratší text.',
        '- Doplň "proc" (jedna věta, proč to geodeta zajímá) a 2–4 odrážky do "body".',
        '- "uvodnik" přepiš na jednu věcnou větu (žádná reklama, vykřičníky ani superlativy).',
        'TVRDÁ PRAVIDLA:',
        '- NEVYMÝŠLEJ fakta, čísla, data ani jména, která v podkladu nejsou.',
        '- NEMĚŇ pole "odkaz", "zdroj", "datum" ani počet položek. Rubriku měň jen když je zjevně špatná.',
        '- Povolené rubriky: ' + RUBRIKY.join(', ') + '. Právě jedna položka má top:true.',
        '- Vrať POUZE JSON stejného tvaru jako vstup, nic dalšího.',
    ].join('\n');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: ANTHROPIC_MODEL,
            max_tokens: 16000,
            system: SYS,
            messages: [{ role: 'user', content: 'Dnešní datum: ' + today + '\n\nVYDÁNÍ:\n' + JSON.stringify(edition) }],
        }),
    });
    if (!r.ok) throw new Error('Anthropic API → HTTP ' + r.status + ': ' + (await r.text()).slice(0, 300));
    const j = await r.json();
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const raw = extractJson(text);
    if (!raw) throw new Error('Model nevrátil platný JSON.');
    return raw;
}

// --- Validace / normalizace ---------------------------------------------------
function normEdition(raw, today) {
    if (!raw || !Array.isArray(raw.polozky)) throw new Error('Vydání nemá pole "polozky".');
    const seen = new Set();
    let polozky = raw.polozky.map((p) => {
        const odkaz = String(p.odkaz || '').trim();
        if (!/^https?:\/\//i.test(odkaz)) return null;                 // tvrdé pravidlo: bez odkazu pryč
        if (seen.has(odkaz)) return null;
        seen.add(odkaz);
        const rubrika = RUBRIKY.includes(p.rubrika) ? p.rubrika : 'Ze světa';
        const body = Array.isArray(p.body) ? p.body.map((x) => String(x).trim()).filter(Boolean).slice(0, 5) : [];
        let datum = String(p.datum || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) datum = today;
        const nadpis = String(p.nadpis || '').trim();
        const perex = String(p.perex || '').trim();
        if (!nadpis || !perex) return null;
        return {
            rubrika,
            top: !!p.top,
            nadpis,
            perex,
            telo: String(p.telo || '').trim(),
            body,
            proc: String(p.proc || '').trim(),
            zdroj: String(p.zdroj || '').trim(),
            odkaz,
            datum,
        };
    }).filter(Boolean);

    if (polozky.length < MIN_ITEMS) throw new Error('Po validaci zbylo jen ' + polozky.length + ' položek (< ' + MIN_ITEMS + ').');
    polozky = polozky.slice(0, MAX_ITEMS);

    // právě jedna "top"
    let topIdx = polozky.findIndex((p) => p.top);
    polozky.forEach((p, i) => { p.top = (i === (topIdx >= 0 ? topIdx : 0)); });

    let uvodnik = String(raw.uvodnik || '').trim();
    if (!uvodnik) uvodnik = 'Vydání ' + today + ' — ' + polozky.length + ' zpráv z geodézie.';

    return { vydani: today, uvodnik, polozky };
}

// --- Hlavní běh ---------------------------------------------------------------
async function main() {
    const today = todayPrague();
    console.log('[start] sestavuji vydání', today);

    // 1) Sběr zpráv
    let items = [];
    for (const f of FEEDS) {
        try {
            const xml = await fetchText(f.url);
            const it = parseItems(xml, f);
            console.log(`[feed] ${f.source}: ${it.length} položek`);
            items.push(...it);
        } catch (e) {
            console.warn(`[feed] ${f.source} přeskočen: ${e.message}`);
        }
    }

    // dedup (titulek i odkaz), nejnovější první; zprávu bez data bereme jako čerstvou
    const seenT = new Set(), seenL = new Set();
    items = items.filter((x) => {
        const kt = x.title.toLowerCase();
        if (seenT.has(kt) || seenL.has(x.link)) return false;
        seenT.add(kt); seenL.add(x.link);
        return true;
    });
    const now = Date.now();
    const hardCut = now - HARD_MAX_AGE_DAYS * 86400000;
    items.forEach((x) => { if (x.ts == null) x.ts = now; });   // bez data = bereme jako čerstvé
    items = items.filter((x) => x.ts >= hardCut);              // vyřaď jen opravdu staré (>120 dní)
    items.sort((a, b) => b.ts - a.ts);                         // od nejnovějšího

    // Aspoň jedna domácí zpráva, i kdyby byla starší než osm zahraničních: ČÚZK
    // publikuje řídce a bez „Z domova" by vydání pro českého geodeta ztratilo smysl.
    const cs = items.filter((x) => x.cs);
    let vybrane = items.slice(0, MAX_ITEMS);
    if (cs.length && !vybrane.some((x) => x.cs)) vybrane = [cs[0]].concat(vybrane.slice(0, MAX_ITEMS - 1));
    console.log('[sběr] kandidátů:', items.length, '· do vydání:', vybrane.length);

    if (vybrane.length < MIN_ITEMS) {
        console.error('[stop] málo čerstvých zpráv (' + vybrane.length + ') — poslední vydání NEPŘEPISUJI.');
        process.exit(1);
    }

    // 2) Vydání: pravidlově, volitelně učesané modelem
    let edition = buildRuleBased(vybrane, today);
    if (ANTHROPIC_KEY) {
        try {
            edition = normEdition(await polishWithClaude(edition, today), today);
            console.log('[model] vydání učesáno modelem', ANTHROPIC_MODEL);
        } catch (e) {
            console.warn('[model] přeskočeno (' + e.message + ') — beru pravidlové vydání.');
            edition = buildRuleBased(vybrane, today);
        }
    } else {
        console.log('[model] ANTHROPIC_API_KEY není nastaven — pravidlové vydání (zdarma, bez AI).');
    }

    // 3) Validace + zápis
    edition = normEdition(edition, today);
    writeFileSync(OUT, JSON.stringify(edition, null, 2) + '\n', 'utf8');
    console.log('[hotovo] zapsáno', OUT, '·', edition.polozky.length, 'položek, top:', edition.polozky.find((p) => p.top)?.nadpis);
}

main().catch((e) => { console.error('[chyba]', e && e.message ? e.message : e); process.exit(1); });
