// Behaviour of the platform tools on the platform fixture (seed + seedPlatform). Expected numbers are worked out by
// hand from tests/fixtures/seed-platform.ts; every result is also scanned for PII.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb } from '../helpers/pglite';
import { scanForPii, testCtx } from '../helpers/ctx';
import { seed } from '../fixtures/seed';
import { seedPlatform } from '../fixtures/seed-platform';
import { audienceGrowth } from '@/core/capabilities/audience';
import { contentPerformance } from '@/core/capabilities/content';
import { topContent } from '@/core/capabilities/top-content';
import { postingCadence } from '@/core/capabilities/cadence';
import { videoInsights } from '@/core/capabilities/video-insights';
import { redditInsights } from '@/core/capabilities/reddit-insights';
import { productMentions } from '@/core/capabilities/product-mentions';
import { athleteMentions } from '@/core/capabilities/athlete-mentions';
import type { Capability } from '@/core/capability';

let pg: PGlite;
beforeAll(async () => {
  pg = await createTestDb();
  await seed(pg);
  await seedPlatform(pg);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<D>(cap: Capability<any, D>, input: Record<string, unknown>) {
  const res = await cap.run(cap.input.parse(input), testCtx(pg));
  expect(() => cap.output.parse(res.data)).not.toThrow();
  expect(scanForPii(res), cap.name).toEqual([]);
  expect(cap.summarise(res).length).toBeGreaterThan(0);
  return res;
}

describe('audience_growth', () => {
  it('reports latest followers, flags the glitch and the gaps, and only gives week-over-week change for consecutive weeks', async () => {
    const r = await call(audienceGrowth, { from: '2026-08-24', to: '2026-09-27' });
    const find = (platform: string, brand: string) => r.data.accounts.find(a => a.platform === platform && a.brand === brand)!;
    expect(find('instagram', 'JOOLA')).toMatchObject({
      account_handle: 'joolapickleball', account_url: 'https://www.instagram.com/joolapickleball/', latest_week: '2026-09-21',
      followers: 1060, change_vs_previous_week: null, change_in_range: 60, change_in_range_pct: 6, suspect_weeks: 1, missing_weeks: 0,
      weeks_with_data: 4, content_theme: 'paddle-review',
    });
    expect(find('instagram', 'Selkirk Sport')).toMatchObject({ followers: 2100, missing_weeks: 2, change_in_range: 100, change_in_range_pct: 5 });
    expect(find('x', 'JOOLA')).toMatchObject({ followers: 300, change_vs_previous_week: 10, change_vs_previous_week_pct: 3.4 });
    expect(find('youtube', 'JOOLA')).toMatchObject({ followers: 520, change_vs_previous_week: 20, total_views: 12000, content_theme: null });
    expect(find('tiktok', 'JOOLA')).toMatchObject({ followers: 5000, total_hearts: 90000, account_url: 'https://www.tiktok.com/@joolapickleball' });
    expect(r.data.series.find(s => s.platform === 'instagram' && s.brand === 'JOOLA' && s.week === '2026-09-14')).toMatchObject({ followers: 0, flag: 'suspect' });
    expect(r.data.no_data).toHaveLength(6);
    expect(r.data.no_data.every(n => !n.has_account)).toBe(true);
  });

  it('filters by brand and platform', async () => {
    const r = await call(audienceGrowth, { from: '2026-08-24', to: '2026-09-27', brands: ['joola'], platforms: ['x'] });
    expect(r.data.accounts.map(a => `${a.platform}:${a.brand}`)).toEqual(['x:JOOLA']);
    expect(r.data.no_data).toEqual([]);
  });
});

describe('content_performance', () => {
  it('averages all posts per brand and platform, with both engagement rates and the format split', async () => {
    const r = await call(contentPerformance, { from: '2026-08-01', to: '2026-09-28' });
    const ig = r.data.find(d => d.platform === 'instagram' && d.brand === 'JOOLA')!;
    expect(ig).toMatchObject({
      account_handle: 'joolapickleball', posts: 3, avg_interactions: 62.3, avg_views: 1000, engagement_rate_by_views: 11,
      followers: 1060, engagement_rate_by_followers: 5.88, best_format: null,
    });
    expect(ig.formats.map(x => x.format).sort()).toEqual(['carousel', 'image', 'reel']);
    expect(r.data.find(d => d.platform === 'tiktok' && d.brand === 'CRBN Pickleball')).toMatchObject({ posts: 1, avg_shares: 20, engagement_rate_by_views: 8.7 });
    expect(r.data.find(d => d.platform === 'x' && d.brand === 'JOOLA')).toMatchObject({ posts: 2, avg_reposts: 2.5 });
  });
});

describe('top_content', () => {
  it('ranks within the range by interactions by default, with link, masked caption and brand handle', async () => {
    const r = await call(topContent, { from: '2026-08-01', to: '2026-09-28', limit: 3 });
    expect(r.data.items.map(i => `${i.platform}:${i.interactions}`)).toEqual(['tiktok:870', 'youtube:340', 'instagram:110']);
    expect(r.data.items[0]).toMatchObject({ brand: 'CRBN Pickleball', account_handle: 'crbnpickleball', url: 'https://www.tiktok.com/embed/v2/9009' });
  });

  it('supports other rankings and format filters', async () => {
    const byViews = await call(topContent, { from: '2026-08-01', to: '2026-09-28', sort_by: 'views', limit: 1 });
    expect(byViews.data.items[0]).toMatchObject({ platform: 'youtube', format: 'long_form', views: 20000 });
    const shorts = await call(topContent, { from: '2026-08-01', to: '2026-09-28', formats: ['short'] });
    expect(shorts.data.items.map(i => i.caption)).toEqual(['Quick tip with @user']);
    const byRate = await call(topContent, { from: '2026-08-01', to: '2026-09-28', sort_by: 'engagement_rate', limit: 2 });
    expect(byRate.data.items.map(i => i.engagement_rate_by_views)).toEqual([11, 8.7]);
  });
});

describe('posting_cadence', () => {
  it('zero-fills weeks, counts weekdays and shows silent tracked accounts', async () => {
    const r = await call(postingCadence, { from: '2026-09-01', to: '2026-09-28', platforms: ['instagram'] });
    const joola = r.data.summary.find(s => s.brand === 'JOOLA')!;
    expect(joola).toMatchObject({ posts: 3, active_days: 3, last_period_posts: 0, previous_period_posts: 2, busiest_weekday: 'Mon' });
    expect(r.data.series.filter(s => s.brand === 'JOOLA').map(s => s.posts)).toEqual([0, 0, 1, 2, 0]);
    expect(r.data.summary.find(s => s.brand === 'Selkirk Sport')).toMatchObject({ posts: 1 });
    const tt = await call(postingCadence, { from: '2026-09-21', to: '2026-09-28', platforms: ['tiktok'] });
    expect(tt.data.summary.map(s => `${s.brand}:${s.posts}`).sort()).toEqual(['CRBN Pickleball:0', 'JOOLA:0']);
  });
});

describe('video_insights', () => {
  it('splits Shorts vs long-form, mixes content types and returns the thesis with products', async () => {
    const r = await call(videoInsights, { from: '2026-08-01', to: '2026-09-28' });
    expect(r.data.formats).toEqual(expect.arrayContaining([
      expect.objectContaining({ brand: 'JOOLA', format: 'short', videos: 1, avg_views: 5000 }),
      expect.objectContaining({ brand: 'JOOLA', format: 'long_form', videos: 1 }),
      expect.objectContaining({ brand: 'Selkirk Sport', format: 'long_form', videos: 1, avg_views: 20000 }),
    ]));
    expect(r.data.content_types).toEqual([{ brand: 'JOOLA', content_type: 'highlight', videos: 1, avg_views: 5000, paid_promos: 0 }]);
    expect(r.data.coverage.find(c => c.brand === 'JOOLA')).toEqual({ brand: 'JOOLA', videos: 2, analysed: 1 });
    expect(r.data.top_videos[0]).toMatchObject({ performance_thesis: 'Fast hook in first 2s', products: ['Perseus'], performance_signals: ['hook', 'ask @user'] });
  });
});

describe('reddit_insights', () => {
  it('ranks subreddits with JOOLA share, viral posts by velocity and discussed posts by replies', async () => {
    const r = await call(redditInsights, { from: '2026-09-01', to: '2026-09-28' });
    expect(r.data.subreddits).toEqual([
      { subreddit: 'pickleball', posts: 2, joola_posts: 1, joola_share_pct: 50,
        brands: expect.arrayContaining([{ brand: 'JOOLA', posts: 1 }, { brand: 'CRBN Pickleball', posts: 1 }]) },
      { subreddit: 'pickleballpaddles', posts: 1, joola_posts: 0, joola_share_pct: 0, brands: [{ brand: 'Selkirk Sport', posts: 1 }] },
    ]);
    expect(r.data.viral.map(v => v.velocity_per_hour)).toEqual([12.5, 3]);
    expect(r.data.most_discussed.map(v => v.captured_comments)).toEqual([1]);
  });

  it('a brand filter keeps posts naming that brand', async () => {
    const r = await call(redditInsights, { from: '2026-09-01', to: '2026-09-28', brands: ['Selkirk'] });
    expect(r.data.subreddits.map(s => s.subreddit)).toEqual(['pickleballpaddles']);
  });
});

describe('product_mentions', () => {
  it('counts each item once per product, splits sentiment and channel, and reports undated mentions', async () => {
    const r = await call(productMentions, { from: '2026-08-01', to: '2026-09-28' });
    expect(r.data).toEqual([
      { product: 'Perseus', brand: 'JOOLA', mentions: 2, positive: 1, neutral: 0, negative: 1, unlabelled: 0, negative_pct: 50,
        channels: expect.arrayContaining([{ channel: 'instagram', mentions: 1 }, { channel: 'tiktok', mentions: 1 }]) },
      { product: 'Vanguard', brand: 'Selkirk Sport', mentions: 1, positive: 1, neutral: 0, negative: 0, unlabelled: 0, negative_pct: 0,
        channels: [{ channel: 'product_review', mentions: 1 }] },
    ]);
    expect(r.meta.excluded.undated).toBe(1);
    const only = await call(productMentions, { from: '2026-08-01', to: '2026-09-28', products: ['PERSEUS'], channels: ['tiktok'] });
    expect(only.data.map(d => `${d.product}:${d.mentions}`)).toEqual(['Perseus:1']);
  });
});

describe('athlete_mentions', () => {
  it('names the sponsored athlete with sponsor and contract, never a personal handle', async () => {
    const r = await call(athleteMentions, { from: '2026-08-01', to: '2026-09-28' });
    expect(r.data).toEqual([{
      athlete: 'Pro Athlete One', sponsor_brand: 'JOOLA', contract_type: 'Sponsored', is_active: true,
      mentions: 2, positive: 1, neutral: 0, negative: 1, unlabelled: 0, negative_pct: 50,
      channels: expect.arrayContaining([{ channel: 'instagram', mentions: 1 }, { channel: 'tiktok', mentions: 1 }]),
    }]);
  });
});
