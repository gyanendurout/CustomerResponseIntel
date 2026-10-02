import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb } from '../helpers/pglite';
import { B, ID, seed } from '../fixtures/seed';

let pg: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;

beforeAll(async () => {
  pg = await createTestDb();
  await seed(pg);
});

describe('helpers', () => {
  it('keeps the 5 sentiment levels, case-insensitively, and labels everything else unlabelled', async () => {
    const r = await rows<{ a: string; b: string; c: string; d: string }>(
      `select intel.sentiment_5('Very_Negative') a, intel.sentiment_5(null) b, intel.sentiment_5('mixed') c, intel.sentiment_5(' positive ') d`);
    expect(r[0]).toEqual({ a: 'very_negative', b: 'unlabelled', c: 'unlabelled', d: 'positive' });
  });

  it('rolls very_* into the parent level', async () => {
    const r = await rows<{ a: string; b: string; c: string; d: string }>(
      `select intel.sentiment_3('very_negative') a, intel.sentiment_3('very_positive') b, intel.sentiment_3('neutral') c, intel.sentiment_3('unlabelled') d`);
    expect(r[0]).toEqual({ a: 'negative', b: 'positive', c: 'neutral', d: 'unlabelled' });
  });

  it('normalises channel aliases (twitter -> x, product_review stays its own channel)', async () => {
    const r = await rows<{ a: string; b: string; c: string; d: string | null }>(
      `select intel.normalise_channel('twitter') a, intel.normalise_channel('product_review') b, intel.normalise_channel('myspace') c, intel.normalise_channel(null) d`);
    expect(r[0]).toEqual({ a: 'x', b: 'product_review', c: 'other', d: null });
  });

  it('masks @handles and e-mails but not the surrounding text', async () => {
    const r = await rows<{ m: string }>(`select intel.mask_pii('hi @bob_smith. mail a.b@ex.co.uk or see @x') m`);
    expect(r[0]!.m).toBe('hi @user. mail [email] or see @user');
  });

  it('masks unicode handles/e-mails, very long handles and links', async () => {
    const r = await rows<{ a: string; b: string; c: string; d: string; e: string | null }>(`select
      intel.mask_pii('thanks @josé_müller!') a,
      intel.mask_pii('write to josé@exämple.com') b,
      intel.mask_pii('@' || repeat('a', 45) || ' hi') c,
      intel.mask_pii('see https://instagram.com/some.user/ and www.tiktok.com/@abc ok') d,
      intel.mask_pii(null) e`);
    expect(r[0]).toEqual({ a: 'thanks @user!', b: 'write to [email]', c: '@user hi', d: 'see [link] and [link] ok', e: null });
  });

  it('masks Reddit user mentions (034) and leaves subreddits, paths and short tokens alone', async () => {
    const r = await rows<{ a: string; b: string; c: string; d: string }>(`select
      intel.mask_pii('/u/Example_Person1 on Authenticity Check') a,
      intel.mask_pii('thanks u/some_user-2! and (U/Someone)') b,
      intel.mask_pii('r/Pickleball, menu/items, u/ab') c,
      intel.mask_pii('see https://www.reddit.com/u/someone/ ok') d`);
    expect(r[0]).toEqual({
      a: 'u/user on Authenticity Check',
      b: 'thanks u/user! and (u/user)',
      c: 'r/Pickleball, menu/items, u/ab',
      d: 'see [link] ok',
    });
  });

  it('a text search for a Reddit username finds nothing (masking happens before matching)', async () => {
    const r = await rows<{ n: number }>(`select count(*)::int n from intel.v_signals where text ilike '%secret_redditor%'`);
    expect(r[0]!.n).toBe(0);
  });
});

describe('canonical_url', () => {
  it('strips account handles from X and TikTok content links, leaves others alone', async () => {
    const r = await rows<{ a: string; b: string; c: string; d: string; e: string; f: null }>(`select
      intel.canonical_url('https://x.com/pro_player/status/1789?s=20') a,
      intel.canonical_url('https://twitter.com/JOOLA/statuses/42') b,
      intel.canonical_url('https://www.tiktok.com/@some.creator/video/7301234567890') c,
      intel.canonical_url('https://www.instagram.com/p/AAA/') d,
      intel.canonical_url('https://www.youtube.com/shorts/xyz') e,
      intel.canonical_url(null) f`);
    expect(r[0]).toEqual({
      a: 'https://x.com/i/status/1789', b: 'https://x.com/i/status/42', c: 'https://www.tiktok.com/embed/v2/7301234567890',
      d: 'https://www.instagram.com/p/AAA/', e: 'https://www.youtube.com/shorts/xyz', f: null,
    });
  });
  it('is applied to every signal link', async () => {
    const r = await rows<{ post_url: string }>(`select post_url from intel.v_signals where channel in ('x', 'tiktok') and post_url is not null`);
    expect(r.length).toBeGreaterThan(0);
    for (const x of r) expect(x.post_url).toMatch(/^https:\/\/(x\.com\/i\/status\/|www\.tiktok\.com\/embed\/v2\/)\d+$/);
  });
});

describe('v_signals', () => {
  it('de-duplicates mention_facts repeats and fans out multi-brand rows (one signal per raw row x brand)', async () => {
    const r = await rows<{ brand_id: string; brand_source: string; brand_method: string; engagement: number }>(
      `select brand_id, brand_source, brand_method, engagement::int as engagement from intel.v_signals where source_row_id = $1 order by brand_method desc`, [ID.igC1]);
    expect(r).toHaveLength(2);
    expect(r).toContainEqual({ brand_id: B.joola, brand_source: 'stored', brand_method: 'raw', engagement: 5 });
    expect(r).toContainEqual({ brand_id: B.selkirk, brand_source: 'inferred', brand_method: 'mention_facts', engagement: 5 });
  });

  it('keeps the raw row type and engagement, and masks PII in text', async () => {
    const [r] = await rows<{ signal_type: string; channel: string; text: string; sentiment_5: string; sentiment_3: string }>(
      `select signal_type, channel, text, sentiment_5, sentiment_3 from intel.v_signals where source_row_id = $1 and brand_id = $2`, [ID.igC1, B.joola]);
    expect(r).toEqual({ signal_type: 'comment', channel: 'instagram', text: '@user this paddle broke, email me at [email]', sentiment_5: 'very_negative', sentiment_3: 'negative' });
  });

  it('excludes brand-account replies', async () => {
    expect(await rows(`select 1 from intel.v_signals where source_row_id = $1`, [ID.igReply])).toHaveLength(0);
  });

  it('falls back to the parent post/video date and records date_source', async () => {
    const r = await rows<{ id: string; date_source: string; occurred_at: Date | null }>(
      `select source_row_id id, date_source, occurred_at from intel.v_signals where source_row_id = any($1::uuid[]) order by id`,
      [[ID.igC1, ID.igC2, ID.ytC1, ID.ytC2]]);
    const by = Object.fromEntries(r.map(x => [x.id, x]));
    expect(by[ID.igC2]!.date_source).toBe('parent_published');
    expect(new Date(by[ID.igC2]!.occurred_at!).toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(by[ID.ytC1]!.date_source).toBe('parent_published');
    expect(by[ID.ytC2]).toMatchObject({ date_source: 'none', occurred_at: null });
  });

  it('infers Reddit comment brands from mention_facts, then keywords on word boundaries only', async () => {
    const r = await rows<{ id: string; brand_id: string | null; brand_method: string; brand_source: string }>(
      `select source_row_id id, brand_id, brand_method, brand_source from intel.v_signals where source_table = 'reddit_comments' order by id`);
    const by = Object.fromEntries(r.map(x => [x.id, x]));
    expect(by[ID.rc1]).toMatchObject({ brand_id: B.joola, brand_method: 'mention_facts', brand_source: 'inferred' });
    expect(by[ID.rc2]).toMatchObject({ brand_id: B.selkirk, brand_method: 'keyword', brand_source: 'inferred' });
    expect(by[ID.rc3]).toMatchObject({ brand_id: null, brand_method: 'none', brand_source: 'none' });
    expect(by[ID.rc4]).toMatchObject({ brand_id: B.crbn, brand_method: 'raw', brand_source: 'stored' });
  });

  it('gives product reviews their own channel, review type and complaint category', async () => {
    const r = await rows<{ id: string; channel: string; signal_type: string; complaint_keywords: string[]; engagement_kind: string; post_url: string | null }>(
      `select source_row_id id, channel, signal_type, complaint_keywords, engagement_kind, post_url from intel.v_signals where source_table = 'paddle_reviews' order by id`);
    expect(r[0]).toMatchObject({ channel: 'product_review', signal_type: 'review', complaint_keywords: ['delamination'], engagement_kind: 'helpful_votes', post_url: null });
    expect(r[1]!.complaint_keywords).toEqual([]);
  });

  it('types Reddit mentions with content_type Comment as comments', async () => {
    const [r] = await rows<{ signal_type: string }>(`select signal_type from intel.v_signals where source_row_id = $1`, [ID.rm2]);
    expect(r!.signal_type).toBe('comment');
  });

  it('reconciles: every non-excluded raw row appears, signals = sum of brand-set sizes', async () => {
    const [r] = await rows<{ raw: number; distinct_rows: number; signals: number }>(`
      select (select count(*) from public.ig_comments where not is_brand_reply)
           + (select count(*) from public.yt_comments) + (select count(*) from public.reddit_mentions)
           + (select count(*) from public.reddit_comments) + (select count(*) from public.tiktok_comments)
           + (select count(*) from public.tiktok_videos) + (select count(*) from public.x_posts)
           + (select count(*) from public.influencer_x_posts) + (select count(*) from public.paddle_reviews) as raw,
             (select count(distinct (source_table, source_row_id)) from intel.v_signals) as distinct_rows,
             (select count(*) from intel.v_signals) as signals`);
    expect(Number(r!.distinct_rows)).toBe(Number(r!.raw));
    expect(Number(r!.signals)).toBe(Number(r!.raw) + 1); // igC1 fans out to one extra brand
  });

  it('signal_id is unique and deterministic', async () => {
    const [r] = await rows<{ n: number; d: number }>(`select count(*)::int n, count(distinct signal_id)::int d from intel.v_signals`);
    expect(r!.d).toBe(r!.n);
    const [x] = await rows<{ ok: boolean }>(
      `select signal_id = md5('ig_comments:' || $1::text || ':' || $2::text)::uuid ok from intel.v_signals where source_row_id = $1::uuid and brand_id = $2::uuid`, [ID.igC1, B.joola]);
    expect(x!.ok).toBe(true);
  });
});

describe('v_switch_events', () => {
  it('flags gaps and falls back to detected_at', async () => {
    const r = await rows<Record<string, unknown>>(
      `select switch_id, date_source, has_date, has_from, has_to, channel, text from intel.v_switch_events order by switch_id`);
    expect(r[0]).toMatchObject({ date_source: 'posted', has_date: true, has_from: true, has_to: true, channel: 'reddit', text: 'moved to joola @user' });
    expect(r[1]).toMatchObject({ date_source: 'detected', has_date: false, has_from: true, has_to: false, channel: 'reddit' });
  });
});

describe('v_topic_weekly', () => {
  it('computes ISO week_start, merges case variants, maps twitter -> x, and only compares adjacent weeks', async () => {
    const r = await rows<{ channel: string; week_number: number; week_start: Date; mention_count: number; prev_count: number; wow_growth_pct: string | null }>(
      `select channel, week_number, week_start, mention_count::int mention_count, prev_count::int prev_count, wow_growth_pct::text
         from intel.v_topic_weekly where topic = 'power' order by channel, week_number`);
    const ig = r.filter(x => x.channel === 'instagram');
    expect(ig.map(x => new Date(x.week_start).toISOString().slice(0, 10))).toEqual(['2026-06-22', '2026-06-29', '2026-07-13']);
    expect(ig.map(x => x.wow_growth_pct)).toEqual([null, '50.0', null]);
    expect(ig[2]!.prev_count).toBe(0);
    expect(r.find(x => x.channel === 'x')!.mention_count).toBe(8);
  });
});

describe('v_replies and v_data_health', () => {
  it('masks reply text', async () => {
    const [r] = await rows<{ reply_text: string }>(`select reply_text from intel.v_replies`);
    expect(r!.reply_text).toBe('Sorry @user, DM us');
  });

  it('counts mention_facts duplicates and per-table nulls', async () => {
    const r = await rows<{ table_name: string; row_count: number; null_date: number; null_brand: number; duplicate_rows: number | null }>(
      `select table_name, row_count::int row_count, null_date::int null_date, null_brand::int null_brand, duplicate_rows::int duplicate_rows from intel.v_data_health`);
    const by = Object.fromEntries(r.map(x => [x.table_name, x]));
    expect(by.mention_facts).toMatchObject({ row_count: 5, duplicate_rows: 2 });
    expect(by.yt_comments).toMatchObject({ row_count: 2, null_date: 2 });
    expect(by.reddit_comments).toMatchObject({ null_brand: 3 });
  });
});

describe('read-only role', () => {
  it('can read published views but not raw tables or adapter views, and cannot write', async () => {
    await pg.exec('set role intel_reader');
    try {
      expect((await rows(`select count(*) from intel.v_signals`)).length).toBe(1);
      await expect(pg.query(`select commenter_username from public.ig_comments`)).rejects.toThrow(/permission denied/);
      await expect(pg.query(`select * from intel.v_src_ig_comments`)).rejects.toThrow(/permission denied/);
      await expect(pg.query(`delete from public.brands`)).rejects.toThrow(/permission denied|read-only/);
    } finally {
      await pg.exec('reset role');
    }
  });
});
