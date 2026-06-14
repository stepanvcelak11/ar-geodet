// =============================================================================
// AR Geodet — sestavení denního Geo zpravodaje (běží v GitHub Actions)
//
// Co dělá:
//   1) Stáhne RSS/Atom zdroje (geodézie ČR i svět), posbírá čerstvé položky.
//   2) Pošle je do GitHub Models a nechá z nich udělat české vydání v NAŠEM
//      formátu (data/zpravodaj.json). Model jen shrnuje/překládá dodaný text;
//      tvrdé pravidlo: položka bez funkčního odkazu se zahodí.
//   3) Výsledek zvaliduje a zapíše do data/zpravodaj.json.
//
// Bezpečnost: když se nepodaří stáhnout dost zpráv NEBO selže model NEBO výstup
// neprojde validací, skript skončí chybou a NEPŘEPÍŠE poslední dobré vydání.
//
// Zdroje upravíš v poli FEEDS níže. Mrtvý/nedostupný feed se jen přeskočí.
// Token: použije se MODELS_TOKEN (secret), jinak GITHUB_TOKEN z Actions.
// =============================================================================
import { writeFileSync, readFileSync } from 'node:fs';

const OUT = 'data/zpravodaj.json';

// --- Zdroje (RSS/Atom). Klidně přidávej/odebírej; neexistující se přeskočí. -----
const FEEDS = [
    // ČR — „Z domova" (ověřené RSS 2.0)
    { source: 'ČÚZK', url: 'https://cuzk.gov.cz/Zememerictvi/Zememericke-cinnosti/Aktuality-pro-zememerice.aspx?rss=b02d6eea-7d16-47a4-9816-21dea74247ce' },
    // Svět (ověřeno, že jdou stáhnout ze serveru)
    { source: 'xyHt', url: 'https://www.xyht.com/feed/' },
    { source: 'The American Surveyor', url: 'https://amerisurv.com/feed/' },
    { source: 'LiDAR Magazine', url: 'https://lidarmag.com/feed/' },
    // Pozn.: GPS World / Geospatial World / GoGeomatics / Esri blog blokují roboty (HTTP 403),
    // GIM International nemá veřejné RSS. Přidávej jen feedy, co projdou serverovým stažením.
];

const RUBRIKY = ['Z domova', 'Ze světa', 'Přístroje', 'Technologie', 'Zákon', 'Z praxe', 'Tip', 'Akce', 'Vzdělávání'];
const SNIPPET_MAX = 500;       // ořez úryvku na položku
const MAX_TO_MODEL = 28;       // kolik kandidátů pošleme modelu
const HARD_MAX_AGE_DAYS = 120; // vyřaď jen opravdu staré zprávy; jinak ber nejnovější (obor je pomalý)
const MIN_ITEMS = 4;           // míň než tohle = nepřepisovat staré vydání
const MAX_ITEMS = 8;

const TOKEN = process.env.MODELS_TOKEN || process.env.GITHUB_TOKEN || '';

// Pořadí poskytovatelů Models — zkusí se, dokud jeden neodpoví (řeší rozdíly endpointů).
const PROVIDERS = (process.env.MODELS_ENDPOINT && process.env.MODELS_MODEL)
    ? [{ endpoint: process.env.MODELS_ENDPOINT, model: process.env.MODELS_MODEL }]
    : [
        { endpoint: 'https://models.github.ai/inference/chat/completions', model: 'openai/gpt-4o-mini' },
        { endpoint: 'https://models.inference.ai.azure.com/chat/completions', model: 'gpt-4o-mini' },
    ];

// --- Pomocné ------------------------------------------------------------------
function stripTags(s) {
    return String(s || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
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

function parseItems(xml, source) {
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
            out.push({ source, title, link, snippet: desc.slice(0, SNIPPET_MAX), date, ts: toTs(date) });
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

function extractJson(text) {
    let t = String(text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try { return JSON.parse(t); } catch (e) { /* zkus podřetězec */ }
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { } }
    return null;
}

// --- Volání GitHub Models -----------------------------------------------------
async function callModel(messages) {
    if (!TOKEN) throw new Error('Chybí token (MODELS_TOKEN ani GITHUB_TOKEN nejsou nastavené).');
    let lastErr = null;
    for (const p of PROVIDERS) {
        try {
            const r = await fetch(p.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
                body: JSON.stringify({ model: p.model, temperature: 0.4, top_p: 0.9, messages }),
            });
            if (!r.ok) { lastErr = new Error('Model ' + p.endpoint + ' → HTTP ' + r.status + ': ' + (await r.text()).slice(0, 300)); continue; }
            const j = await r.json();
            const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
            if (!content) { lastErr = new Error('Model ' + p.endpoint + ' vrátil prázdnou odpověď.'); continue; }
            console.log('[model] použit endpoint:', p.endpoint, '· model:', p.model);
            return content;
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Žádný poskytovatel Models neodpověděl.');
}

// --- Validace / normalizace výstupu ------------------------------------------
function normEdition(raw, today) {
    if (!raw || !Array.isArray(raw.polozky)) throw new Error('Výstup modelu nemá pole "polozky".');
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
            const it = parseItems(xml, f.source);
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
    items = items.slice(0, MAX_TO_MODEL);
    console.log('[sběr] kandidátů pro model:', items.length);

    if (items.length < MIN_ITEMS) {
        console.error('[stop] málo čerstvých zpráv (' + items.length + ') — poslední vydání NEPŘEPISUJI.');
        process.exit(1);
    }

    // 2) Model
    const schema = '{"vydani":"YYYY-MM-DD","uvodnik":"jedna věcná věta","polozky":[{"rubrika":"jedna z povolených","top":true,"nadpis":"...","perex":"1–2 věty","telo":"4–8 vět","body":["odrážka","odrážka"],"proc":"1 věta","zdroj":"název zdroje","odkaz":"https://...","datum":"YYYY-MM-DD"}]}';
    const SYS = [
        'Jsi editor českého geodetického zpravodaje pro aplikaci AR Geodet (nástroj pro geodety v terénu).',
        'Z DODANÝCH reálných zpráv (titulek, zdroj, odkaz, úryvek) sestav jedno denní vydání.',
        'PRAVIDLA:',
        '- Piš česky (i u cizojazyčných zdrojů přelož).',
        '- Vyber 5–8 nejzajímavějších a nejrelevantnějších zpráv pro geodeta (katastr, GNSS, přístroje, skenování/BIM/mračna bodů, legislativa a normy, zajímavé stavby a jejich geodetické řešení, postupy, vzdělávání, akce).',
        '- Každou zařaď do PRÁVĚ JEDNÉ rubriky z: ' + RUBRIKY.join(', ') + '.',
        '- Vyber PRÁVĚ JEDNU zprávu jako "top" (top:true), ostatní top:false.',
        '- telo (4–8 vět) musí VĚRNĚ vycházet z dodaného úryvku/titulku. NEVYMÝŠLEJ konkrétní fakta, čísla, data ani jména, která v úryvku nejsou. Je-li úryvek krátký, napiš telo kratší.',
        '- Zachovej PŘESNĚ původní "odkaz" a název "zdroj". Zprávu bez použitelného odkazu vynech.',
        '- "uvodnik" = jedna věcná věta (NE reklama, žádné vykřičníky a superlativy).',
        '- Vrať POUZE JSON objekt v tomto tvaru, nic dalšího (žádný markdown, žádné ```):',
        schema,
    ].join('\n');

    const list = items.map((x, i) =>
        `[${i + 1}] ZDROJ: ${x.source}\nTITULEK: ${x.title}\nODKAZ: ${x.link}\nDATUM: ${x.date || '?'}\nÚRYVEK: ${x.snippet || '(bez úryvku)'}`
    ).join('\n\n');
    const USER = 'Dnešní datum: ' + today + '\n\nKANDIDÁTI:\n\n' + list;

    const content = await callModel([{ role: 'system', content: SYS }, { role: 'user', content: USER }]);
    const raw = extractJson(content);
    if (!raw) { console.error('[stop] model nevrátil platný JSON — NEPŘEPISUJI.\n', content.slice(0, 400)); process.exit(1); }

    // 3) Validace + zápis
    const edition = normEdition(raw, today);

    // drobná kontrola proti regresi: kdyby model vyrobil míň, než už máme, raději zachovej staré
    try {
        const prev = JSON.parse(readFileSync(OUT, 'utf8'));
        if (Array.isArray(prev.polozky) && prev.vydani === today && prev.polozky.length > edition.polozky.length + 1) {
            console.error('[stop] nové vydání má míň položek než dnešní existující — NEPŘEPISUJI.');
            process.exit(1);
        }
    } catch (e) { /* žádné/nečitelné staré vydání — pokračuj */ }

    writeFileSync(OUT, JSON.stringify(edition, null, 2) + '\n', 'utf8');
    console.log('[hotovo] zapsáno', OUT, '·', edition.polozky.length, 'položek, top:', edition.polozky.find((p) => p.top)?.nadpis);
}

main().catch((e) => { console.error('[chyba]', e && e.message ? e.message : e); process.exit(1); });
