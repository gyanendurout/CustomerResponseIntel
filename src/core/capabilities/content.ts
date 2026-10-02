import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { and, run, sql } from '../sql';
import { fmt } from './_shared';
import {
  ENGAGEMENT_DEFINITIONS, PLATFORMS, PLATFORM_LABEL, brandAccounts, numOrNull, platformFilterShape, platformWhere,
  resolvePlatformFilters, round1, round2, type Platform,
} from '../platform';

/** A format needs at least this many posts before it can be called the best one. */
export const MIN_FORMAT_POSTS = 3;

const output = z.array(z.object({
  platform: z.enum(PLATFORMS),
  brand: z.string(),
  account_handle: z.string().nullable(),
  posts: z.number(),
  posts_per_week: z.number().nullable(),
  avg_views: z.number().nullable(),
  avg_likes: z.number().nullable(),
  avg_comments: z.number().nullable(),
  avg_shares: z.number().nullable(),
  avg_reposts: z.number().nullable(),
  avg_interactions: z.number().nullable(),
  engagement_rate_by_views: z.number().nullable(),
  engagement_rate_by_followers: z.number().nullable(),
  followers: z.number().nullable(),
  best_format: z.string().nullable(),
  formats: z.array(z.object({ format: z.string(), posts: z.number(), avg_views: z.number().nullable(), avg_interactions: z.number().nullable() })),
}));

interface Agg {
  platform: Platform; brand_id: string; posts: number; avg_views: unknown; avg_likes: unknown; avg_comments: unknown;
  avg_shares: unknown; avg_reposts: unknown; avg_interactions: unknown; inter_with_views: unknown; views_pos: unknown;
}

export const contentPerformance = defineCapability({
  name: 'content_performance',
  route: '/content',
  title: 'Content performance',
  description: [
    'How each brand\'s OWN posts and videos perform on Instagram, YouTube, X and TikTok in the date range: number of',
    'posts, posts per week, average views / likes / comments / shares / reposts / interactions, engagement rate by views',
    'and by followers, and a per-format breakdown (Instagram reel/carousel/image, YouTube short/long_form) with the best',
    `format (needs ${MIN_FORMAT_POSTS}+ posts). Covers ALL posts in the range, not a top-N sample.`,
    'Use for "whose content gets the most engagement / which format works"; use top_content for individual posts,',
    'audience_growth for followers, posting_cadence for how often brands post.',
    'Output: data = [{platform, brand, account_handle, posts, posts_per_week, avg_views, avg_interactions,',
    'engagement_rate_by_views, engagement_rate_by_followers, followers, best_format, formats:[{format, posts, avg_views, avg_interactions}]}].',
    'Example: "Which brand has the best Instagram engagement rate, and do reels beat carousels?"',
  ].join(' '),
  input: z.object(platformFilterShape),
  output,
  examples: [
    { question: 'Engagement by brand on every platform, last 90 days', input: {} },
    { question: 'JOOLA vs CRBN on TikTok since June', input: { brands: ['JOOLA', 'CRBN'], platforms: ['tiktok'], from: '2026-06-01' } },
  ],
  async run(input, ctx) {
    const pf = await resolvePlatformFilters(input, ctx);
    const { f } = pf;
    const where = platformWhere(pf, sql.ref('posted_at'));
    const toDay = f.to.toISOString().slice(0, 10);
    const [aggs, formats, followers, undated, brands, accounts] = await Promise.all([
      run<Agg>(ctx.db, sql`
        select platform, brand_id::text as brand_id, count(*)::int as posts,
          avg(views)::float8 as avg_views, avg(likes)::float8 as avg_likes, avg(comments)::float8 as avg_comments,
          avg(shares)::float8 as avg_shares, avg(reposts)::float8 as avg_reposts, avg(interactions)::float8 as avg_interactions,
          sum(interactions) filter (where views > 0)::float8 as inter_with_views, sum(views) filter (where views > 0)::float8 as views_pos
        from intel.v_content where ${where} group by 1, 2`),
      run<{ platform: Platform; brand_id: string; format: string; posts: number; avg_views: unknown; avg_interactions: unknown }>(ctx.db, sql`
        select platform, brand_id::text as brand_id, format, count(*)::int as posts,
          avg(views)::float8 as avg_views, avg(interactions)::float8 as avg_interactions
        from intel.v_content where ${where} group by 1, 2, 3 order by 4 desc`),
      run<{ platform: Platform; brand_id: string; followers: unknown }>(ctx.db, sql`
        select distinct on (platform, brand_id) platform, brand_id::text as brand_id, followers
        from intel.v_audience_weekly
        where ${and([platformWhere(pf, null), sql`followers > 0 and week_start <= ${toDay}::date`])}
        order by platform, brand_id, week_start desc`),
      run<{ n: number }>(ctx.db, sql`select count(*)::int as n from intel.v_content where ${platformWhere(pf, null)} and posted_at is null`),
      ctx.brands(),
      brandAccounts(ctx),
    ]);
    const names = new Map(brands.map(b => [b.brand_id, b.name]));
    const followerMap = new Map(followers.map(r => [`${r.platform}|${r.brand_id}`, numOrNull(r.followers)]));
    const days = Math.round((f.to.getTime() - f.from.getTime()) / 86_400_000) + 1;

    const data = aggs.map(a => {
      const key = `${a.platform}|${a.brand_id}`;
      const fmts = formats.filter(x => x.platform === a.platform && x.brand_id === a.brand_id).map(x => ({
        format: x.format, posts: x.posts, avg_views: round1(numOrNull(x.avg_views)), avg_interactions: round1(numOrNull(x.avg_interactions)),
      }));
      const eligible = fmts.filter(x => x.posts >= MIN_FORMAT_POSTS && x.avg_interactions != null);
      const best = eligible.length > 1 ? eligible.reduce((m, x) => ((x.avg_interactions ?? 0) > (m.avg_interactions ?? 0) ? x : m)).format : null;
      const avgInteractions = numOrNull(a.avg_interactions);
      const fol = followerMap.get(key) ?? null;
      const viewsPos = numOrNull(a.views_pos);
      return {
        platform: a.platform,
        brand: names.get(a.brand_id) ?? a.brand_id,
        account_handle: accounts.get(key)?.handle ?? null,
        posts: a.posts,
        posts_per_week: round1((a.posts / days) * 7),
        avg_views: round1(numOrNull(a.avg_views)),
        avg_likes: round1(numOrNull(a.avg_likes)),
        avg_comments: round1(numOrNull(a.avg_comments)),
        avg_shares: round1(numOrNull(a.avg_shares)),
        avg_reposts: round1(numOrNull(a.avg_reposts)),
        avg_interactions: round1(avgInteractions),
        engagement_rate_by_views: viewsPos ? round2(((numOrNull(a.inter_with_views) ?? 0) / viewsPos) * 100) : null,
        engagement_rate_by_followers: fol && avgInteractions != null ? round2((avgInteractions / fol) * 100) : null,
        followers: fol,
        best_format: best,
        formats: fmts,
      };
    }).sort((a, b) => a.platform.localeCompare(b.platform) || b.posts - a.posts);

    const notes: string[] = [...ENGAGEMENT_DEFINITIONS];
    const undatedN = undated[0]?.n ?? 0;
    if (undatedN) notes.push(`${fmt(undatedN)} post${undatedN === 1 ? '' : 's'} with no date excluded.`);
    if (!data.length) notes.push('No brand posts in this range for these filters.');
    return {
      data,
      meta: meta({
        filters: f.applied, rows_counted: data.reduce((s, d) => s + d.posts, 0),
        excluded: { undated: undatedN, unbranded: 0, unlabelled_sentiment: 0 }, notes,
        units: { engagement_rate_by_views: '%', engagement_rate_by_followers: '%', posts_per_week: 'posts per 7 days' },
      }, ctx),
    };
  },
  summarise: r => {
    if (!r.data.length) return 'No brand posts in this range.';
    const lines = [...r.data].sort((a, b) => (b.avg_interactions ?? 0) - (a.avg_interactions ?? 0)).slice(0, 3).map(d =>
      `${d.brand} ${PLATFORM_LABEL[d.platform]}: ${fmt(d.posts)} posts, ${fmt(d.avg_interactions ?? 0)} avg interactions` +
      (d.engagement_rate_by_views != null ? `, ${d.engagement_rate_by_views}% ER by views` : ''));
    return lines.join('; ') + '.';
  },
});
