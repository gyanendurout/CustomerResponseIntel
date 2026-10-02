// Computes the EXPECTED intel.v_signals counts from the live source tables (GET only, via PostgREST), replicating
// the view logic independently in JS. tests/real/reconcile.test.ts asserts the applied view matches these numbers.
// Text is read only to apply the same keyword match in memory (raw text, like the view); only counts are written.
import { get } from './sb.mjs';
import { writeFileSync } from 'node:fs';

async function pageAll(table, cols, filter = '') {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const { body } = await get(`/${table}?select=${cols}${filter}&order=id.asc&limit=1000&offset=${off}`);
    out.push(...body);
    if (body.length < 1000) return out;
  }
}

const esc = s => s.replace(/[.^$*+?()[\]{}|\\-]/g, '\\$&');

const brands = (await get('/brands?select=id,reddit_keywords')).body;
const kwRegexes = brands.map(b => ({ id: b.id, res: (b.reddit_keywords || []).filter(k => k.trim()).map(k => new RegExp(`(^|[^A-Za-z0-9_])${esc(k.trim())}($|[^A-Za-z0-9_])`, 'i')) }));

const mf = await pageAll('mention_facts', 'source_table,source_id,brand_id', '&brand_id=not.is.null');
const mfBrands = new Map();
for (const m of mf) {
  const k = `${m.source_table}:${m.source_id}`;
  if (!mfBrands.has(k)) mfBrands.set(k, new Set());
  mfBrands.get(k).add(m.brand_id);
}

const SOURCES = [
  { t: 'ig_comments', cols: 'id,brand_id,is_brand_reply,comment_text', keep: r => !r.is_brand_reply, text: r => r.comment_text },
  { t: 'yt_comments', cols: 'id,brand_id,is_brand_reply,comment_text', keep: r => !r.is_brand_reply, text: r => r.comment_text },
  { t: 'reddit_mentions', cols: 'id,brand_id,is_removed,post_title,content_text', keep: r => !r.is_removed, text: r => [r.post_title, r.content_text].map(s => s?.trim()).filter(Boolean).join('\n\n') },
  { t: 'reddit_comments', cols: 'id,brand_id,comment_text', keep: () => true, text: r => r.comment_text },
  { t: 'tiktok_comments', cols: 'id,brand_id,is_brand_reply,comment_text', keep: r => !r.is_brand_reply, text: r => r.comment_text },
  { t: 'tiktok_videos', cols: 'id,brand_id,text', keep: () => true, text: r => r.text },
  { t: 'x_posts', cols: 'id,brand_id,text', keep: () => true, text: r => r.text },
  { t: 'influencer_x_posts', cols: 'id,brand_id,text', keep: () => true, text: r => r.text },
  { t: 'paddle_reviews', cols: 'id,brand_id', keep: () => true, text: () => null },
];

const expected = { generated_at: new Date().toISOString(), per_source: {}, totals: {} };
let items = 0, signals = 0;
for (const s of SOURCES) {
  const rows = (await pageAll(s.t, s.cols)).filter(s.keep);
  const c = { items: rows.length, signals: 0, by_method: { raw: 0, mention_facts: 0, keyword: 0, none: 0 }, multi_brand_items: 0 };
  for (const r of rows) {
    const set = new Map(); // brand -> method
    if (r.brand_id) set.set(r.brand_id, 'raw');
    const fromMf = mfBrands.get(`${s.t}:${r.id}`);
    if (fromMf) for (const b of fromMf) if (!set.has(b)) set.set(b, 'mention_facts');
    if (!r.brand_id && !fromMf) {
      const txt = s.text(r); // raw text, as in intel.v_signal_brands
      if (txt) for (const b of kwRegexes) if (b.res.some(re => re.test(txt))) set.set(b.id, 'keyword');
    }
    if (set.size === 0) { c.signals += 1; c.by_method.none += 1; continue; }
    c.signals += set.size;
    if (set.size > 1) c.multi_brand_items += 1;
    for (const m of set.values()) c.by_method[m] += 1;
  }
  expected.per_source[s.t] = c;
  items += c.items; signals += c.signals;
  console.error('done', s.t);
}
expected.totals = { items, signals };
writeFileSync(new URL('./out/expected-signals.json', import.meta.url), JSON.stringify(expected, null, 2));
console.log(JSON.stringify(expected, null, 1));
