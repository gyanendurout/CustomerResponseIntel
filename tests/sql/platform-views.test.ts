// Platform views (040–046): accounts, weekly audience, brand content, YouTube analysis, Reddit posts, product and
// athlete mentions. Runs every migration in embedded Postgres on the real column layout with synthetic data.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb } from '../helpers/pglite';
import { B, ID, seed } from '../fixtures/seed';
import { P, seedPlatform } from '../fixtures/seed-platform';

let pg: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const text = async (sql: string) => JSON.stringify(await rows(sql));

beforeAll(async () => {
  pg = await createTestDb();
  await seed(pg);
  await seedPlatform(pg);
});

describe('v_brand_accounts', () => {
  it('lists brand-owned accounts per platform with a handle and a profile URL', async () => {
    const r = await rows<{ platform: string; brand_id: string; account_handle: string; account_url: string }>(
      `select platform, brand_id::text, account_handle, account_url from intel.v_brand_accounts order by platform, account_handle`);
    expect(r).toEqual([
      { platform: 'instagram', brand_id: B.joola, account_handle: 'joolapickleball', account_url: 'https://www.instagram.com/joolapickleball/' },
      { platform: 'instagram', brand_id: B.selkirk, account_handle: 'selkirksport', account_url: 'https://www.instagram.com/selkirksport/' },
      { platform: 'tiktok', brand_id: B.crbn, account_handle: 'crbnpickleball', account_url: 'https://www.tiktok.com/@crbnpickleball' },
      { platform: 'tiktok', brand_id: B.joola, account_handle: 'joolapickleball', account_url: 'https://www.tiktok.com/@joolapickleball' },
      { platform: 'x', brand_id: B.joola, account_handle: 'joolapickleball', account_url: 'https://x.com/joolapickleball' },
      { platform: 'youtube', brand_id: B.joola, account_handle: 'JOOLA Pickleball', account_url: 'https://www.youtube.com/@joolapickleball' },
    ]);
  });
});

describe('v_audience_weekly', () => {
  it('has one row per platform × brand × ISO week, with week_start on the Monday', async () => {
    const r = await rows<{ week_start: string; followers: number }>(
      `select to_char(week_start, 'YYYY-MM-DD') week_start, followers::int from intel.v_audience_weekly
       where platform = 'instagram' and brand_id = $1 order by week_start`, [B.joola]);
    expect(r).toEqual([
      { week_start: '2026-08-24', followers: 1000 }, { week_start: '2026-08-31', followers: 1010 },
      { week_start: '2026-09-07', followers: 1030 }, { week_start: '2026-09-14', followers: 0 },
      { week_start: '2026-09-21', followers: 1060 },
    ]);
  });

  it('keeps the latest scrape when a week was scraped twice', async () => {
    const r = await rows<{ n: number; followers: number }>(
      `select count(*)::int n, max(followers)::int followers from intel.v_audience_weekly where platform = 'tiktok' and brand_id = $1`, [B.joola]);
    expect(r[0]).toEqual({ n: 1, followers: 5000 });
  });

  it('maps each platform\'s columns and normalises the Instagram content theme', async () => {
    const r = await rows(`select platform, followers::int, following::int, content_count::int, total_hearts::int, total_views::int, content_theme
      from intel.v_audience_weekly where brand_id = $1 and week_start = '2026-09-21' order by platform`, [B.joola]);
    expect(r).toEqual([
      { platform: 'instagram', followers: 1060, following: 52, content_count: 107, total_hearts: null, total_views: null, content_theme: 'paddle-review' },
      { platform: 'tiktok', followers: 5000, following: 5, content_count: 100, total_hearts: 90000, total_views: null, content_theme: null },
      { platform: 'x', followers: 300, following: 20, content_count: 900, total_hearts: null, total_views: null, content_theme: null },
      { platform: 'youtube', followers: 520, following: null, content_count: 52, total_hearts: null, total_views: 12000, content_theme: null },
    ]);
    const theme = await rows<{ t: string }>(`select content_theme t from intel.v_audience_weekly where platform='instagram' and brand_id=$1 and week_start='2026-09-07'`, [B.joola]);
    expect(theme[0]!.t).toBe('pickleball');
  });

  it('never exposes handles, bios or bio links', async () => {
    const cols = await rows<{ c: string }>(`select column_name c from information_schema.columns where table_schema='intel' and table_name='v_audience_weekly'`);
    expect(cols.map(c => c.c)).not.toEqual(expect.arrayContaining(['handle']));
    expect(cols.map(c => c.c).some(c => /handle|bio/.test(c))).toBe(false);
    expect(await text('select * from intel.v_audience_weekly')).not.toMatch(/secret_bio_person|linktr/);
  });
});

describe('v_content', () => {
  it('has one row per brand post across the four platforms, de-duplicating Instagram re-scrapes', async () => {
    const r = await rows<{ platform: string; n: number }>(`select platform, count(*)::int n from intel.v_content group by 1 order by 1`);
    // Instagram: seed igPost + J1, J2 (dup dropped), J3. YouTube: seed ytVideo + S1 + L1. X: seed xPost + x2. TikTok: seed ttVideo + ttCrbn.
    expect(r).toEqual([{ platform: 'instagram', n: 4 }, { platform: 'tiktok', n: 2 }, { platform: 'x', n: 2 }, { platform: 'youtube', n: 3 }]);
    const j2 = await rows<{ likes: number; caption: string }>(`select likes::int, caption from intel.v_content where url like '%/p/J2/%'`);
    expect(j2).toEqual([{ likes: 50, caption: 'Carousel' }]);
  });

  it('normalises formats and keeps platform-specific measures', async () => {
    const r = await rows(`select platform, format, views::int, likes::int, comments::int, shares::int, reposts::int, interactions::int, duration_s
      from intel.v_content where content_id = any($1::uuid[]) order by platform, format`, [[P.igJ1, P.igJ2, P.igJ3, P.ytShort, P.ytLong, P.x2, P.ttCrbn]]);
    expect(r).toEqual([
      { platform: 'instagram', format: 'carousel', views: null, likes: 50, comments: 5, shares: null, reposts: null, interactions: 55, duration_s: null },
      { platform: 'instagram', format: 'image', views: null, likes: 20, comments: 2, shares: null, reposts: null, interactions: 22, duration_s: null },
      { platform: 'instagram', format: 'reel', views: 1000, likes: 100, comments: 10, shares: null, reposts: null, interactions: 110, duration_s: null },
      { platform: 'tiktok', format: 'video', views: 10000, likes: 800, comments: 50, shares: 20, reposts: null, interactions: 870, duration_s: 30 },
      { platform: 'x', format: 'post', views: 2000, likes: 30, comments: 8, shares: null, reposts: 5, interactions: 43, duration_s: null },
      { platform: 'youtube', format: 'long_form', views: 20000, likes: 300, comments: 40, shares: null, reposts: null, interactions: 340, duration_s: 900 },
      { platform: 'youtube', format: 'short', views: 5000, likes: 50, comments: 5, shares: null, reposts: null, interactions: 55, duration_s: 40 },
    ]);
  });

  it('masks captions and builds handle-free content links', async () => {
    const r = await rows<{ caption: string; url: string }>(`select caption, url from intel.v_content where content_id = any($1::uuid[]) order by caption`,
      [[P.igJ3, P.ytShort, P.ttCrbn]]);
    expect(r).toEqual([
      { caption: 'Drop', url: 'https://www.tiktok.com/embed/v2/9009' },
      { caption: 'Quick tip with @user', url: 'https://www.youtube.com/watch?v=S1' },
      { caption: 'Thanks @user, mail [email]', url: 'https://www.instagram.com/p/J3/' },
    ]);
    expect(await text('select * from intel.v_content')).not.toMatch(/fan_person|coach_person|secret_handle|x\.com\/joola/);
  });
});

describe('v_video_analysis', () => {
  it('joins the analysis to its video, maps product ids to names and masks the AI text', async () => {
    const r = await rows(`select content_id::text, brand_id::text, content_type, is_paid_promo, is_short, summary, performance_thesis,
      performance_signals, products, views::int, url from intel.v_video_analysis`);
    expect(r).toEqual([{
      content_id: P.ytShort, brand_id: B.joola, content_type: 'highlight', is_paid_promo: false, is_short: true,
      summary: 'Short featuring @user', performance_thesis: 'Fast hook in first 2s', performance_signals: ['hook', 'ask @user'],
      products: ['Perseus'], views: 5000, url: 'https://www.youtube.com/watch?v=S1',
    }]);
  });

  it('never exposes players_mentioned or the non-discriminating sentiment / crisis fields', async () => {
    expect(await text('select * from intel.v_video_analysis')).not.toMatch(/Secret Player/);
    const cols = (await rows<{ c: string }>(`select column_name c from information_schema.columns where table_schema='intel' and table_name='v_video_analysis'`)).map(c => c.c);
    expect(cols.some(c => /player|sentiment|crisis|opportunity/.test(c))).toBe(false);
  });
});

describe('v_reddit_posts', () => {
  it('normalises subreddits, counts captured comments, attributes brands and drops removed posts', async () => {
    const r = await rows(`select post_id::text, brand_id::text, subreddit, upvotes::int, velocity_per_hour::float, captured_comments
      from intel.v_reddit_posts order by post_id`);
    expect(r).toEqual([
      { post_id: ID.rm1, brand_id: B.joola, subreddit: 'pickleball', upvotes: 40, velocity_per_hour: 3, captured_comments: 0 },
      { post_id: ID.rm2, brand_id: B.crbn, subreddit: 'pickleball', upvotes: 3, velocity_per_hour: null, captured_comments: 1 },
      { post_id: P.rm3, brand_id: B.selkirk, subreddit: 'pickleballpaddles', upvotes: 100, velocity_per_hour: 12.5, captured_comments: 0 },
    ]);
  });

  it('falls back to the post text when there is no title, and never exposes the author', async () => {
    const r = await rows<{ title: string }>(`select title from intel.v_reddit_posts where post_id = $1`, [ID.rm2]);
    expect(r[0]!.title).toBe('CRBN is fine');
    expect(await text('select * from intel.v_reddit_posts')).not.toMatch(/redditor/);
  });
});

describe('v_product_mentions', () => {
  it('has one row per (item, product), with the product\'s own brand and the normalised channel', async () => {
    const r = await rows(`select product_name, product_brand_id::text, channel, source_table, sentiment_5,
      to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD') d from intel.v_product_mentions order by source_table`);
    expect(r).toEqual([
      { product_name: 'Perseus', product_brand_id: B.joola, channel: 'instagram', source_table: 'ig_comments', sentiment_5: 'very_negative', d: '2026-09-10' },
      { product_name: 'Vanguard', product_brand_id: B.selkirk, channel: 'product_review', source_table: 'paddle_reviews', sentiment_5: 'positive', d: '2026-09-13' },
      { product_name: 'Perseus', product_brand_id: B.joola, channel: 'tiktok', source_table: 'tiktok_comments', sentiment_5: 'very_positive', d: '2026-09-06' },
      { product_name: 'Perseus', product_brand_id: B.joola, channel: 'youtube', source_table: 'yt_comments', sentiment_5: 'neutral', d: null },
    ]);
  });
});

describe('v_athlete_mentions', () => {
  it('names sponsored athletes with their sponsor, never their personal handles', async () => {
    const r = await rows(`select athlete_name, sponsor_brand_id::text, contract_type, is_active, channel, sentiment_5
      from intel.v_athlete_mentions order by channel`);
    expect(r).toEqual([
      { athlete_name: 'Pro Athlete One', sponsor_brand_id: B.joola, contract_type: 'Sponsored', is_active: true, channel: 'instagram', sentiment_5: 'very_negative' },
      { athlete_name: 'Pro Athlete One', sponsor_brand_id: B.joola, contract_type: 'Sponsored', is_active: true, channel: 'tiktok', sentiment_5: 'very_positive' },
    ]);
    expect(await text('select * from intel.v_athlete_mentions')).not.toMatch(/pro_one_ig|pro_one_x/);
  });
});

describe('read-only role', () => {
  it('can read every new published view', async () => {
    const r = await rows<{ v: string; ok: boolean }>(`select v, has_table_privilege('intel_reader', 'intel.' || v, 'select') ok from unnest(array[
      'v_brand_accounts','v_audience_weekly','v_content','v_video_analysis','v_reddit_posts','v_product_mentions','v_athlete_mentions']) v`);
    expect(r.filter(x => !x.ok)).toEqual([]);
  });
});
