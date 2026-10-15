// NEXUS News feed fetcher. Runs in GitHub Actions (.github/workflows/news.yml), no dependencies (Node 20).
// Reads reputable RSS/Atom feeds, cleans + de-duplicates them, and writes compact JSON for the site:
//   OUT/news.json (everything) and OUT/<category>.json (one per category).
import { writeFile, readFile, mkdir } from 'node:fs/promises';

const OUT = process.env.OUT_DIR || 'data';
const UA = 'Mozilla/5.0 (compatible; NEXUS-News/1.0; +https://olivercraftboycompany-design.github.io/NEXUS-News/)';

export const CATS = {
  top: 'Top', world: 'World', tech: 'Tech', science: 'Science', sports: 'Sports', gaming: 'Gaming', iowa: 'Iowa', faith: 'Faith'
};

export const FEEDS = [
  // Top / US: a balanced mix of mainstream outlets
  ['top', 'NPR', 'https://feeds.npr.org/1001/rss.xml'],
  ['top', 'CBS News', 'https://www.cbsnews.com/latest/rss/main'],
  ['top', 'ABC News', 'https://abcnews.go.com/abcnews/topstories'],
  ['top', 'NBC News', 'https://feeds.nbcnews.com/nbcnews/public/news'],
  ['top', 'Fox News', 'https://moxie.foxnews.com/google-publisher/latest.xml'],
  ['top', 'PBS NewsHour', 'https://www.pbs.org/newshour/feeds/rss/headlines'],
  ['top', 'Wall Street Journal', 'https://feeds.content.dowjones.io/public/rss/RSSUSnews'],
  ['top', 'The Hill', 'https://thehill.com/news/feed/'],
  // World
  ['world', 'BBC News', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['world', 'NPR', 'https://feeds.npr.org/1004/rss.xml'],
  ['world', 'CBS News', 'https://www.cbsnews.com/latest/rss/world'],
  ['world', 'Fox News', 'https://moxie.foxnews.com/google-publisher/world.xml'],
  ['world', 'ABC News', 'https://abcnews.go.com/abcnews/internationalheadlines'],
  ['world', 'DW', 'https://rss.dw.com/rdf/rss-en-world'],
  // Tech
  ['tech', 'The Verge', 'https://www.theverge.com/rss/index.xml'],
  ['tech', 'Ars Technica', 'https://feeds.arstechnica.com/arstechnica/index'],
  ['tech', 'TechCrunch', 'https://techcrunch.com/feed/'],
  ['tech', 'Engadget', 'https://www.engadget.com/rss.xml'],
  ['tech', 'BBC News', 'https://feeds.bbci.co.uk/news/technology/rss.xml'],
  ['tech', '9to5Google', 'https://9to5google.com/feed/'],
  ['tech', 'Android Authority', 'https://www.androidauthority.com/feed/'],
  // Science
  ['science', 'NASA', 'https://www.nasa.gov/news-release/feed/'],
  ['science', 'ScienceDaily', 'https://www.sciencedaily.com/rss/top/science.xml'],
  ['science', 'NPR', 'https://feeds.npr.org/1007/rss.xml'],
  ['science', 'Space.com', 'https://www.space.com/feeds/all'],
  ['science', 'Live Science', 'https://www.livescience.com/feeds/all'],
  ['science', 'BBC News', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'],
  // Sports
  ['sports', 'CBS Sports', 'https://www.cbssports.com/rss/headlines/'],
  ['sports', 'Fox Sports', 'https://api.foxsports.com/v2/content/optimized-rss?partnerKey=MB0Wehpmuj2lUhuRhQaafhBjAJqaPU244mlTDK1i&size=30'],
  ['sports', 'Yahoo Sports', 'https://sports.yahoo.com/rss/'],
  ['sports', 'BBC Sport', 'https://feeds.bbci.co.uk/sport/rss.xml'],
  // Gaming
  ['gaming', 'IGN', 'https://feeds.feedburner.com/ign/all'],
  ['gaming', 'GameSpot', 'https://www.gamespot.com/feeds/mashup/'],
  ['gaming', 'Polygon', 'https://www.polygon.com/rss/index.xml'],
  ['gaming', 'PC Gamer', 'https://www.pcgamer.com/rss/'],
  ['gaming', 'Nintendo Life', 'https://www.nintendolife.com/feeds/latest'],
  ['gaming', 'Eurogamer', 'https://www.eurogamer.net/feed'],
  // Iowa / local
  ['iowa', 'KCCI', 'https://www.kcci.com/topstories-rss'],
  ['iowa', 'WHO 13', 'https://who13.com/feed/'],
  ['iowa', 'We Are Iowa', 'https://www.weareiowa.com/feeds/syndication/rss/news'],
  ['iowa', 'Iowa Capital Dispatch', 'https://iowacapitaldispatch.com/feed/'],
  ['iowa', 'Radio Iowa', 'https://www.radioiowa.com/feed/'],
  ['iowa', 'Iowa Public Radio', 'https://www.iowapublicradio.org/news.rss'],
  ['iowa', 'KCRG', 'https://www.kcrg.com/arc/outboundfeeds/rss/?outputType=xml'],
  // Faith
  ['faith', 'Christianity Today', 'https://www.christianitytoday.com/feed/'],
  ['faith', 'The Christian Post', 'https://www.christianpost.com/rss'],
  ['faith', 'Religion News Service', 'https://religionnews.com/feed/'],
  ['faith', 'Catholic News Agency', 'https://www.catholicnewsagency.com/rss/news.xml'],
  ['faith', 'Relevant', 'https://relevantmagazine.com/feed/'],
];

const MAX_AGE_H = { top: 48, world: 48, tech: 72, science: 120, sports: 48, gaming: 72, iowa: 120, faith: 168 };
const PER_FEED = 15, PER_CAT = 70;
const SKIP_ALL = /\b(sponsored|advertorial|horoscope|wordle|quordle|connections hints?|strands hints?|crossword|promo code|coupon)\b/i;
const SKIP_SHOPPING = /\b(deals?|sale|% off|discount|lowest price|price drop|black friday|prime day|best .{0,30} to buy|gift guide)\b/i;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•' };
export function decode(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ''; } }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const cdata = s => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const strip = s => decode(decode(cdata(s)).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function tag(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`, 'i'));
    if (m && m[1].trim()) return m[1];
  }
  return '';
}
function attr(block, re) { const m = block.match(re); return m ? decode(m[1]) : ''; }
function imageOf(block, html) {
  const cands = [];
  for (const m of block.matchAll(/<media:(?:content|thumbnail)\b[^>]*>/gi)) {
    const u = attr(m[0], /\burl=["']([^"']+)["']/i); const w = +attr(m[0], /\bwidth=["']?(\d+)/i) || 0;
    const medium = attr(m[0], /\bmedium=["']([^"']+)/i) + attr(m[0], /\btype=["']([^"']+)/i);
    if (u && !/video|audio/i.test(medium)) cands.push([u, w]);
  }
  for (const m of block.matchAll(/<enclosure\b[^>]*>/gi)) {
    const u = attr(m[0], /\burl=["']([^"']+)["']/i); const t = attr(m[0], /\btype=["']([^"']+)/i);
    if (u && (/image/i.test(t) || /\.(jpe?g|png|webp)(\?|$)/i.test(u))) cands.push([u, 0]);
  }
  const it = attr(block, /<itunes:image[^>]*href=["']([^"']+)/i); if (it) cands.push([it, 0]);
  const img = attr(decode(cdata(html)), /<img[^>]+src=["']([^"']+)["']/i); if (img) cands.push([img, 0]);
  cands.sort((a, b) => b[1] - a[1]);
  const pick = cands.find(c => /^https?:/i.test(c[0]) && !/feedburner|pixel|tracking|1x1|spacer|gravatar/i.test(c[0]));
  return pick ? pick[0].replace(/^http:/, 'https:') : '';
}
function clip(s, n) { if (s.length <= n) return s; const c = s.slice(0, n); return c.slice(0, c.lastIndexOf(' ') > n * 0.6 ? c.lastIndexOf(' ') : n).replace(/[\s,;:.—–-]+$/, '') + '…'; }

export function parseFeed(xml, cat, source) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 40)) {
    const title = strip(tag(b, ['title']));
    let link = strip(tag(b, ['link']));
    if (!/^https?:/.test(link)) link = attr(b, /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i) || attr(b, /<link\b[^>]*href=["']([^"']+)/i);
    if (!/^https?:/.test(link)) { const g = strip(tag(b, ['guid'])); if (/^https?:/.test(g)) link = g; }
    const date = strip(tag(b, ['pubDate', 'published', 'dc:date', 'updated']));
    const p = Date.parse(date.replace(/\s+/g, ' ').replace(/ (EDT|EST|CDT|CST|PDT|PST)$/, m => ({ ' EDT': ' -0400', ' EST': ' -0500', ' CDT': ' -0500', ' CST': ' -0600', ' PDT': ' -0700', ' PST': ' -0800' })[m]));
    const html = tag(b, ['content:encoded', 'description', 'summary', 'content']);
    let d = strip(html).replace(/^(\s*(Read more|Continue reading)[^.]*\.?)/i, '');
    d = d.replace(/\s*(The post .{0,200} appeared first on .{0,80}\.?|Continue reading.*|Read more.*|\[…\]|\[\.\.\.\])\s*$/i, '');
    if (d.toLowerCase().startsWith(title.toLowerCase().slice(0, 40))) d = d.slice(title.length).trim();
    if (!title || !link || !p || isNaN(p)) continue;
    if (SKIP_ALL.test(title) || ((cat === 'tech' || cat === 'gaming') && SKIP_SHOPPING.test(title))) continue;
    items.push({ t: clip(title, 180), u: link.trim(), s: source, c: [cat], p: Math.min(p, Date.now()), i: imageOf(b, html), d: clip(d, 230) });
  }
  return items;
}

const STOP = new Set('the a an and or of to in on for with at by from as is are was were be been has have had it its this that after over into about amid says said new will his her their they them who what why how than more up out not but just could would can may your you our we us vs'.split(' '));
const toks = t => new Set(t.toLowerCase().replace(/[’']s\b/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w.length > 2 && !STOP.has(w)));
function similar(a, b) {
  let shared = 0; for (const w of a) if (b.has(w)) shared++;
  const j = shared / (a.size + b.size - shared || 1);
  return j >= 0.5 || (shared >= 5 && j >= 0.38);
}
const normUrl = u => u.replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();

// De-duplicate within one category: same link, or headlines that say the same thing.
export function dedupe(items) {
  items.sort((a, b) => b.p - a.p);
  const out = [], seen = new Map();
  for (const it of items) {
    const key = normUrl(it.u);
    if (seen.has(key)) continue;
    it._k = toks(it.t);
    const dup = it._k.size >= 3 && out.find(o => similar(o._k, it._k));
    if (dup) {
      if (dup.s !== it.s && !(dup.a ||= []).includes(it.s)) dup.a.push(it.s);
      if (!dup.i && it.i) dup.i = it.i;
      if (!dup.d && it.d) dup.d = it.d;
      seen.set(key, dup); continue;
    }
    out.push(it); seen.set(key, it);
  }
  return out;
}

async function get(url, ms = 20000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' }, signal: ac.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

async function ogImage(url) {
  try {
    const html = (await get(url, 7000)).slice(0, 200000);
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    return m ? decode(m[1]).replace(/^http:/, 'https:') : '';
  } catch { return ''; }
}

export async function build() {
  const started = Date.now();
  const status = [];
  const all = [];
  await Promise.all(FEEDS.map(async ([cat, source, url]) => {
    const t0 = Date.now();
    try {
      const xml = await get(url);
      const items = parseFeed(xml, cat, source)
        .filter(i => started - i.p < MAX_AGE_H[cat] * 3600e3)
        .sort((a, b) => b.p - a.p).slice(0, PER_FEED);
      all.push(...items);
      status.push({ cat, source, ok: true, n: items.length, ms: Date.now() - t0 });
    } catch (e) {
      status.push({ cat, source, ok: false, n: 0, err: String(e.message || e).slice(0, 80) });
    }
  }));
  // 1) de-dupe inside each category (so the Iowa tab stays local, Faith stays faith)
  const byCatRaw = {}; for (const c of Object.keys(CATS)) byCatRaw[c] = [];
  for (const it of all) byCatRaw[it.c[0]].push(it);
  const perCat = {}; for (const c of Object.keys(CATS)) perCat[c] = dedupe(byCatRaw[c]).slice(0, PER_CAT);
  // 2) the same article link in two categories becomes one item tagged with both
  const byUrl = new Map(); let items = [];
  for (const c of Object.keys(CATS)) for (const it of perCat[c]) {
    const k = normUrl(it.u);
    if (byUrl.has(k)) { const o = byUrl.get(k); if (!o.c.includes(c)) o.c.push(c); for (const s of it.a || []) if (s !== o.s && !(o.a ||= []).includes(s)) o.a.push(s); continue; }
    byUrl.set(k, it); items.push(it);
  }
  // 3) how many different outlets carry each Top/World story (across every feed) — used to rank Top stories
  const pool = all.map(x => ({ s: x.s, k: x._k || toks(x.t) }));
  for (const it of items) {
    if (!it.c.includes('top') && !it.c.includes('world')) continue;
    const srcs = new Set(it.a || []);
    for (const x of pool) if (x.s !== it.s && similar(it._k, x.k)) srcs.add(x.s);
    srcs.delete(it.s);
    if (srcs.size) it.a = [...srcs]; else delete it.a;
  }
  for (const it of items) delete it._k;
  // Fill missing images from the article's og:image (cached between runs).
  let cache = {};
  try { cache = JSON.parse(await readFile(`${OUT}/img-cache.json`, 'utf8')); } catch {}
  const need = items.filter(i => !i.i);
  for (const i of need) if (cache[i.u] !== undefined) i.i = cache[i.u];
  const todo = need.filter(i => cache[i.u] === undefined).slice(0, 60);
  for (let k = 0; k < todo.length; k += 10) {
    await Promise.all(todo.slice(k, k + 10).map(async i => { i.i = await ogImage(i.u); cache[i.u] = i.i; }));
  }
  const keep = new Set(items.map(i => i.u)); for (const u of Object.keys(cache)) if (!keep.has(u)) delete cache[u];

  // Give every item a short stable id; build per-category lists.
  for (const i of items) { let h = 0; for (const ch of i.u) h = (h * 31 + ch.charCodeAt(0)) >>> 0; i.id = h.toString(36); }
  const byCat = {}; for (const c of Object.keys(CATS)) byCat[c] = items.filter(i => i.c.includes(c)).sort((a, b) => b.p - a.p);

  // Top stories: stories carried by several outlets rank first, then recency.
  const now = Date.now();
  const score = i => (1 + (i.a ? i.a.length : 0)) * 3 + Math.max(0, 6 - (now - i.p) / 3600e3) * 0.8 + (i.i ? 1 : 0) + (i.c.includes('top') ? 1 : 0);
  const ranked = items.filter(i => (i.c.includes('top') || i.c.includes('world')) && now - i.p < 18 * 3600e3).sort((a, b) => score(b) - score(a));
  const picked = [];
  for (const i of ranked) { const k = toks(i.t); if (/^(watch( live)?|live|listen|opinion)\b/i.test(i.t) || picked.filter(p => p.i.s === i.s).length >= 2) continue; if (picked.some(p => similar(p.k, k) || [...k].filter(w => p.k.has(w)).length >= 3)) continue; picked.push({ i, k }); if (picked.length === 8) break; }
  const top = picked.map(p => p.i.id);

  const updated = new Date().toISOString();
  const doc = { v: 1, updated, cats: CATS, top, sources: status.sort((a, b) => a.cat.localeCompare(b.cat) || a.source.localeCompare(b.source)), items };
  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/news.json`, JSON.stringify(doc));
  for (const c of Object.keys(CATS)) await writeFile(`${OUT}/${c}.json`, JSON.stringify({ v: 1, updated, cat: c, items: byCat[c] }));
  await writeFile(`${OUT}/img-cache.json`, JSON.stringify(cache));
  const bad = status.filter(s => !s.ok || !s.n);
  console.log(`news.json: ${items.length} stories from ${status.filter(s => s.ok).length}/${FEEDS.length} feeds in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const c of Object.keys(CATS)) console.log(`  ${c.padEnd(8)} ${byCat[c].length}`);
  if (bad.length) console.log('  empty/failed:', bad.map(s => `${s.source} (${s.cat}) ${s.err || '0 items'}`).join('; '));
  return doc;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  build().catch(e => { console.error(e); process.exit(1); });
}
