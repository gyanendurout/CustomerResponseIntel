import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { seededDb, testCtx } from '../helpers/ctx';
import { sentimentBreakdown } from '@/core/capabilities/sentiment';
import { topComplaints } from '@/core/capabilities/complaints';
import { searchPosts, likePattern } from '@/core/capabilities/search-posts';
import { crisisMonitor } from '@/core/capabilities/crises';
import { detectSpikes, findSpikes } from '@/core/capabilities/spikes';
import { brandSwitching } from '@/core/capabilities/switches';
import { topicTrends } from '@/core/capabilities/topics';
import { compareBrands } from '@/core/capabilities/compare';
import { metrics } from '@/core/capabilities/metrics';
import { dataHealth } from '@/core/capabilities/data-health';
import { brandReplies } from '@/core/capabilities/replies';
import { AppError } from '@/core/errors';

let pg: PGlite;
beforeAll(async () => { pg = await seededDb(); });
const SEPT = { from: '2026-09-01', to: '2026-09-30' } as const;

describe('sentiment_breakdown', () => {
  it('keeps 5 levels, rolls up to 3, and excludes unlabelled from % denominators', async () => {
    const r = await sentimentBreakdown.run(sentimentBreakdown.input.parse({ ...SEPT, brands: ['JOOLA'] }), testCtx(pg));
    const g = r.data.groups[0]!;
    // JOOLA Sept: igC1 very_neg, rm1 pos, rc1 neg, ttV pos, ttC very_pos, x neutral, pr1 very_neg -> 7 labelled
    expect(g).toMatchObject({ group: 'JOOLA', total: 7, labelled: 7, negative_pct: 42.9, positive_pct: 42.9 });
    const five = Object.fromEntries(r.data.five_level.map(x => [x.label, x.value]));
    expect(five).toEqual({ very_negative: 2, negative: 1, neutral: 1, positive: 2, very_positive: 1, unlabelled: 0 });
    expect(r.data.three_level.find(x => x.label === 'negative')!.value).toBe(3);
  });
});

describe('top_complaints', () => {
  it('combines review categories and crisis keywords, with examples', async () => {
    const r = await topComplaints.run(topComplaints.input.parse({ ...SEPT, brands: ['JOOLA'] }), testCtx(pg));
    const kws = r.data.map(d => d.keyword).sort();
    expect(kws).toEqual(['broke', 'delamination']);
    const del = r.data.find(d => d.keyword === 'delamination')!;
    expect(del.kinds).toEqual(['review_category']);
    expect(del.examples[0]!.channel).toBe('product_review');
    expect(del.trend).toEqual([{ period: '2026-09-01', value: 1 }]);
  });
});

describe('search_posts', () => {
  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
  it('finds by text, masks handles, and pages with a cursor without overlap', async () => {
    const ctx = testCtx(pg);
    const all = await searchPosts.run(searchPosts.input.parse({ ...SEPT, limit: 50 }), ctx);
    const p1 = await searchPosts.run(searchPosts.input.parse({ ...SEPT, limit: 3 }), ctx);
    expect(p1.data.items).toHaveLength(3);
    expect(p1.meta.page!.next_cursor).toBeTruthy();
    const p2 = await searchPosts.run(searchPosts.input.parse({ ...SEPT, limit: 3, cursor: p1.meta.page!.next_cursor! }), ctx);
    const ids = [...p1.data.items, ...p2.data.items].map(i => i.item_id);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toEqual(all.data.items.slice(0, 6).map(i => i.item_id));
    const hit = await searchPosts.run(searchPosts.input.parse({ ...SEPT, q: 'PADDLE BROKE' }), ctx);
    expect(hit.data.items).toHaveLength(1);
    expect(hit.data.items[0]!.text).toBe('@user this paddle broke, email me at [email]');
    expect(hit.data.items[0]!.brands.sort()).toEqual(['JOOLA', 'Selkirk Sport']); // one item, both brands
  });
  it('pages by engagement too', async () => {
    const ctx = testCtx(pg);
    const p1 = await searchPosts.run(searchPosts.input.parse({ ...SEPT, sort: 'engagement', limit: 2 }), ctx);
    expect(p1.data.items.map(i => i.engagement)).toEqual([100, 40]);
    const p2 = await searchPosts.run(searchPosts.input.parse({ ...SEPT, sort: 'engagement', limit: 2, cursor: p1.meta.page!.next_cursor! }), ctx);
    expect(p2.data.items[0]!.engagement).toBeLessThanOrEqual(40);
  });
  it('puts undated items last and only when include_undated', async () => {
    const ctx = testCtx(pg);
    const without = await searchPosts.run(searchPosts.input.parse({ brands: ['JOOLA'], channels: ['youtube'], from: '2026-01-01', to: '2026-09-30' }), ctx);
    expect(without.data.items.every(i => i.occurred_at !== null)).toBe(true);
    const withU = await searchPosts.run(searchPosts.input.parse({ brands: ['JOOLA'], channels: ['youtube'], from: '2026-01-01', to: '2026-09-30', include_undated: true }), ctx);
    expect(withU.data.items.at(-1)!.occurred_at).toBeNull();
  });
  it('rejects a tampered cursor or a cursor from another sort', async () => {
    const ctx = testCtx(pg);
    await expect(searchPosts.run(searchPosts.input.parse({ cursor: 'garbage' }), ctx)).rejects.toThrow(/Invalid cursor/);
    const p1 = await searchPosts.run(searchPosts.input.parse({ ...SEPT, limit: 1 }), ctx);
    await expect(searchPosts.run(searchPosts.input.parse({ ...SEPT, sort: 'engagement', cursor: p1.meta.page!.next_cursor! }), ctx)).rejects.toThrow(/Invalid cursor/);
  });
});

describe('crisis_monitor', () => {
  it('lists only dated crises as recent and reports undated ones', async () => {
    const r = await crisisMonitor.run(crisisMonitor.input.parse({ ...SEPT }), testCtx(pg));
    expect(r.data.total).toBe(2); // igC1, pr1
    expect(r.data.recent.map(i => i.occurred_at!.slice(0, 10))).toEqual(['2026-09-12', '2026-09-10']);
    expect(r.meta.excluded.undated).toBe(1); // ytC2
  });
});

describe('detect_spikes', () => {
  const s = (vals: Array<number | null>) => vals.map((v, i) => ({ period: `p${i}`, value: v, volume: v ?? 0 }));
  it('flags a value above mean + k·sd of the previous window', () => {
    const flags = findSpikes(s([10, 12, 11, 9, 10, 30]), 8, 2, 4);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ period: 'p5', value: 30, baseline_mean: 10.4 });
  });
  it('needs a minimum baseline and skips null periods', () => {
    expect(findSpikes(s([1, 1, 50]), 8, 2, 4)).toEqual([]);
    expect(findSpikes(s([5, null, 5, 5, 5, 5]), 8, 2, 4)).toEqual([]);
  });
  it('handles a flat baseline (sd = 0)', () => {
    const flags = findSpikes(s([5, 5, 5, 5, 6]), 8, 2, 4);
    expect(flags[0]).toMatchObject({ value: 6, z: 99 });
  });
  it('runs end-to-end with weekly default granularity', async () => {
    const r = await detectSpikes.run(detectSpikes.input.parse({ ...SEPT }), testCtx(pg));
    expect(r.meta.granularity).toBe('week');
    expect(r.meta.method).toMatch(/mean \+ 2·sd/);
  });
});

describe('brand_switching', () => {
  it('computes JOOLA inflow/outflow and reports gaps', async () => {
    const r = await brandSwitching.run(brandSwitching.input.parse({ ...SEPT }), testCtx(pg));
    expect(r.data).toMatchObject({ focus_brand: 'JOOLA', inflow: 1, outflow: 1, net: 0 });
    expect(r.data.matrix).toContainEqual({ from: 'JOOLA', to: 'Unknown', value: 1 });
    expect(r.data.gaps).toMatchObject({ in_range: 2, date_from_detection: 1, unknown_to: 1, all_time: { total: 2, no_posted_date: 1, no_to: 1, no_from: 0 } });
  });
  it('accepts another focus brand', async () => {
    const r = await brandSwitching.run(brandSwitching.input.parse({ ...SEPT, brand: 'selkirk' }), testCtx(pg));
    expect(r.data).toMatchObject({ focus_brand: 'Selkirk Sport', inflow: 0, outflow: 1, net: -1 });
  });
});

describe('topic_trends', () => {
  it('computes weekly volume, peak week and JOOLA share', async () => {
    const r = await topicTrends.run(topicTrends.input.parse({ from: '2026-06-22', to: '2026-07-19' }), testCtx(pg));
    expect(r.data.peaks[0]).toMatchObject({ topic: 'power', peak_week: '2026-06-29', peak_count: 23, total: 38 });
    expect(r.data.joola_share[0]).toMatchObject({ topic: 'power', joola: 30, competitors: 8, joola_pct: 78.9 });
  });
});

describe('compare_brands', () => {
  it('compares brands side by side with SoV vs all brands', async () => {
    const r = await compareBrands.run(compareBrands.input.parse({ ...SEPT, brands: ['JOOLA', 'Selkirk'] }), testCtx(pg));
    expect(r.data.map(d => d.brand)).toEqual(['JOOLA', 'Selkirk Sport']);
    expect(r.data[0]).toMatchObject({ volume: 7, crisis_count: 2 });
    expect(r.data[0]!.top_complaint).not.toBeNull();
  });
  it('requires 2-5 brands', () => {
    expect(() => compareBrands.input.parse({ brands: ['JOOLA'] })).toThrow();
  });
});

describe('metrics', () => {
  it('answers "weekly negative % for JOOLA vs Selkirk" in one call', async () => {
    const r = await metrics.run(metrics.input.parse({ measure: 'negative_pct', group_by: ['period', 'brand'], granularity: 'week', brands: ['JOOLA', 'Selkirk'], ...SEPT }), testCtx(pg));
    expect(r.data.rows.every(row => typeof row.period === 'string' && ['JOOLA', 'Selkirk Sport'].includes(String(row.brand)))).toBe(true);
    expect(r.data.points!.length).toBe(r.data.rows.length);
  });
  it('supports topic grouping with count only', async () => {
    const r = await metrics.run(metrics.input.parse({ measure: 'count', group_by: ['topic', 'channel'], from: '2026-06-22', to: '2026-07-19' }), testCtx(pg));
    expect(r.data.rows).toContainEqual({ topic: 'power', channel: 'instagram', value: 30, n: 3 });
    await expect(metrics.run(metrics.input.parse({ measure: 'negative_pct', group_by: ['topic'] }), testCtx(pg))).rejects.toThrow(AppError);
    await expect(metrics.run(metrics.input.parse({ measure: 'count', group_by: ['topic', 'sentiment_5'] }), testCtx(pg))).rejects.toThrow(/period, brand or channel/);
  });
  it('rejects non-whitelisted measures and dimensions', () => {
    expect(() => metrics.input.parse({ measure: 'sum(1);drop table x', group_by: ['brand'] })).toThrow();
    expect(() => metrics.input.parse({ measure: 'count', group_by: ['commenter_username'] })).toThrow();
    expect(() => metrics.input.parse({ measure: 'count', group_by: ['brand', 'channel', 'period'] })).toThrow();
  });
});

describe('data_health', () => {
  it('reports live counts for every known issue', async () => {
    const r = await dataHealth.run({}, testCtx(pg));
    const issue = (id: string) => r.data.known_issues.find(i => i.id === id)!;
    expect(issue('mention_facts_duplicates').live_count).toBe(2);
    expect(issue('youtube_dates').detail).toMatch(/1 dated by their video publish date.*1 remain undated/);
    expect(issue('reddit_brands').detail).toMatch(/mention_facts for 1, from brand keywords for 1; 1 still unbranded/);
    expect(issue('reply_detector').status).toBe('insufficient_data');
    expect(r.data.known_issues).toHaveLength(9);
  });
});

describe('brand_replies', () => {
  it('flags insufficient data and masks reply text', async () => {
    const r = await brandReplies.run({}, testCtx(pg));
    expect(r.data).toMatchObject({ insufficient_data: true, total_replies: 1 });
    expect(r.data.sample[0]!.reply_text).toBe('Sorry @user, DM us');
    expect(r.meta.insufficient_data).toBe(true);
  });
});

describe('review-fix regressions', () => {
  it('search_posts shows every brand an item mentions even when filtering by one brand', async () => {
    const r = await searchPosts.run(searchPosts.input.parse({ ...SEPT, brands: ['Selkirk'], q: 'paddle broke' }), testCtx(pg));
    expect(r.data.items[0]!.brands.sort()).toEqual(['JOOLA', 'Selkirk Sport']);
  });
  it('crisis_monitor recent items list all brands', async () => {
    const r = await crisisMonitor.run(crisisMonitor.input.parse({ ...SEPT, brands: ['Selkirk'] }), testCtx(pg));
    expect(r.data.recent[0]!.brands.sort()).toEqual(['JOOLA', 'Selkirk Sport']);
  });
  it('rejects ranges with too many periods instead of truncating', async () => {
    await expect(volumeRun({ from: '2000-01-01', to: '2026-01-01', granularity: 'day' })).rejects.toThrow(/more than 2000 day periods/);
    await expect(volumeRun({ from: '2000-01-01', to: '2026-01-01', granularity: 'month' })).resolves.toBeTruthy();
  });
  it('bounds years and explains a defaulted `to`', async () => {
    expect(() => searchPosts.input.parse({ to: '9999-12-31' })).toThrow(/Year must be between/);
    await expect(volumeRun({ from: '2026-12-01' })).rejects.toThrow(/to defaulted to the newest date/);
  });
  it('signal links never contain account handles', async () => {
    const r = await searchPosts.run(searchPosts.input.parse({ ...SEPT, channels: ['x', 'tiktok'], limit: 50 }), testCtx(pg));
    expect(r.data.items.length).toBeGreaterThan(0);
    for (const i of r.data.items) expect(i.post_url).toMatch(/^https:\/\/(x\.com\/i\/status\/|www\.tiktok\.com\/embed\/v2\/)\d+$/);
  });
});

async function volumeRun(input: Record<string, unknown>) {
  const { volumeOverTime } = await import('@/core/capabilities/volume');
  return volumeOverTime.run(volumeOverTime.input.parse(input), testCtx(pg));
}
