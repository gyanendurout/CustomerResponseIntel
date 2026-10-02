// Read-only reconciliation of the platform views (040–046) against independent counts from the raw tables.
// Raw tables: PostgREST GET with the local service key (scripts/sb.mjs). Views: the read-only DATABASE_URL login.
// Prints counts only, never text or identities. Usage: node scripts/check-platform.mjs
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { get } from './sb.mjs';

async function pageAll(table, cols) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const { body } = await get(`/${table}?select=${cols}&order=id.asc&limit=1000&offset=${off}`);
    out.push(...body);
    if (body.length < 1000) return out;
  }
}
const distinctBy = (rows, key) => new Set(rows.map(key)).size;
const blank = v => v == null || String(v).trim() === '';

const url = readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).find(l => l.startsWith('DATABASE_URL=')).slice(13);
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query(`set statement_timeout = '120s'`);
const one = async q => (await db.query(q)).rows;

const checks = [];
const check = (name, expected, actual) => checks.push({ name, expected, actual, ok: JSON.stringify(expected) === JSON.stringify(actual) });

// Accounts
const [ig, yt, x, tt] = await Promise.all([
  pageAll('ig_accounts', 'id,brand_id,handle,is_active'), pageAll('yt_channels', 'id,brand_id,channel_url,is_active'),
  pageAll('x_accounts', 'id,brand_id,handle'), pageAll('tiktok_accounts', 'id,brand_id,handle'),
]);
const expAccounts = {
  instagram: ig.filter(r => r.brand_id && !blank(r.handle) && r.is_active !== false).length,
  youtube: yt.filter(r => r.brand_id && !blank(r.channel_url) && r.is_active !== false).length,
  x: x.filter(r => r.brand_id && !blank(r.handle)).length,
  tiktok: tt.filter(r => r.brand_id && !blank(r.handle)).length,
};
const gotAccounts = Object.fromEntries((await one(`select platform, count(*)::int n from intel.v_brand_accounts group by 1`)).map(r => [r.platform, r.n]));
check('v_brand_accounts per platform', expAccounts, { instagram: gotAccounts.instagram ?? 0, youtube: gotAccounts.youtube ?? 0, x: gotAccounts.x ?? 0, tiktok: gotAccounts.tiktok ?? 0 });

// Audience weekly: distinct (brand, year, week) per platform with valid week
const weekly = { instagram: 'ig_profiles_weekly', youtube: 'yt_channel_weekly', x: 'x_profiles_weekly', tiktok: 'tiktok_profiles_weekly' };
const expWeekly = {};
for (const [p, t] of Object.entries(weekly)) {
  const rows = await pageAll(t, 'id,brand_id,year,week_number');
  expWeekly[p] = distinctBy(rows.filter(r => r.brand_id && r.year >= 2000 && r.year <= 2100 && r.week_number >= 1 && r.week_number <= 53), r => `${r.brand_id}|${r.year}|${r.week_number}`);
}
const gotWeekly = Object.fromEntries((await one(`select platform, count(*)::int n from intel.v_audience_weekly group by 1`)).map(r => [r.platform, r.n]));
check('v_audience_weekly per platform', expWeekly, { instagram: gotWeekly.instagram ?? 0, youtube: gotWeekly.youtube ?? 0, x: gotWeekly.x ?? 0, tiktok: gotWeekly.tiktok ?? 0 });

// Content: distinct platform ids, branded rows only
const [igp, ytv, xp, ttv] = await Promise.all([
  pageAll('ig_posts', 'id,brand_id,instagram_post_id,post_url'), pageAll('yt_videos', 'id,brand_id,youtube_video_id'),
  pageAll('x_posts', 'id,brand_id,tweet_id,post_url'), pageAll('tiktok_videos', 'id,brand_id,tiktok_video_id,video_url'),
]);
const key = (...v) => v.find(s => !blank(s)).toString().trim();
// The view de-duplicates first, then drops unbranded rows; mirror that order.
const contentCount = (rows, k) => {
  const latest = new Map();
  for (const r of rows) latest.set(k(r), r);
  return [...latest.values()].filter(r => r.brand_id).length;
};
const expContent = {
  instagram: contentCount(igp, r => key(r.instagram_post_id, r.post_url, r.id)),
  youtube: contentCount(ytv, r => key(r.youtube_video_id, r.id)),
  x: contentCount(xp, r => key(r.tweet_id, r.post_url, r.id)),
  tiktok: contentCount(ttv, r => key(r.tiktok_video_id, r.video_url, r.id)),
};
const gotContent = Object.fromEntries((await one(`select platform, count(*)::int n from intel.v_content group by 1`)).map(r => [r.platform, r.n]));
check('v_content per platform (approx: duplicate winner may differ in brand)', expContent, { instagram: gotContent.instagram ?? 0, youtube: gotContent.youtube ?? 0, x: gotContent.x ?? 0, tiktok: gotContent.tiktok ?? 0 });
const rawPosts = { instagram: igp.length, youtube: ytv.length, x: xp.length, tiktok: ttv.length };

// Video analysis
const va = await pageAll('yt_video_analysis', 'id,video_id');
const ytIds = new Set(ytv.map(v => v.id));
check('v_video_analysis rows', va.filter(r => ytIds.has(r.video_id)).length, (await one(`select count(*)::int n from intel.v_video_analysis`))[0].n);

// Reddit posts: distinct non-removed posts
const rm = await pageAll('reddit_mentions', 'id,is_removed');
check('v_reddit_posts distinct posts', rm.filter(r => !r.is_removed).length, (await one(`select count(distinct post_id)::int n from intel.v_reddit_posts`))[0].n);

// Product / athlete mentions: distinct (source_table, source_id, entity) with a resolvable entity
const mf = await pageAll('mention_facts', 'id,source_table,source_id,product_id,athlete_id');
const products = new Set((await pageAll('products_catalog', 'id')).map(r => r.id));
const athletes = new Set((await pageAll('influencers', 'id')).map(r => r.id));
check('v_product_mentions rows', distinctBy(mf.filter(r => products.has(r.product_id)), r => `${r.source_table}|${r.source_id}|${r.product_id}`),
  (await one(`select count(*)::int n from intel.v_product_mentions`))[0].n);
check('v_athlete_mentions rows', distinctBy(mf.filter(r => athletes.has(r.athlete_id)), r => `${r.source_table}|${r.source_id}|${r.athlete_id}`),
  (await one(`select count(*)::int n from intel.v_athlete_mentions`))[0].n);

await db.end();
for (const c of checks) console.log(`${c.ok ? 'OK  ' : 'DIFF'} ${c.name}: expected ${JSON.stringify(c.expected)} got ${JSON.stringify(c.actual)}`);
console.log('raw rows before de-duplication:', JSON.stringify(rawPosts), '| mention_facts rows:', mf.length);
