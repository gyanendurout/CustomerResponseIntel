import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { and, isoText, run, sql, type Sql } from '../sql';
import { fmt, truncate } from './_shared';
import {
  PLATFORMS, PLATFORM_LABEL, brandAccounts, numOrNull, platformFilterShape, platformWhere, resolvePlatformFilters, round2,
  type Platform,
} from '../platform';

const FORMATS = ['reel', 'carousel', 'image', 'short', 'long_form', 'post', 'video', 'unknown'] as const;
const SORTS = ['interactions', 'views', 'likes', 'comments', 'shares', 'engagement_rate', 'recent'] as const;
type SortKey = (typeof SORTS)[number];
const DEFAULT_LIMIT = 10;
const CAPTION_LIMIT = 280;

const ORDER: Record<SortKey, Sql> = {
  interactions: sql`interactions desc, posted_at desc`,
  views: sql`views desc nulls last, interactions desc`,
  likes: sql`likes desc, posted_at desc`,
  comments: sql`comments desc, posted_at desc`,
  shares: sql`coalesce(shares, reposts) desc nulls last, interactions desc`,
  engagement_rate: sql`(interactions::float8 / nullif(views, 0)) desc nulls last, interactions desc`,
  recent: sql`posted_at desc, interactions desc`,
};

const output = z.object({
  items: z.array(z.object({
    platform: z.enum(PLATFORMS),
    brand: z.string(),
    account_handle: z.string().nullable(),
    format: z.string(),
    posted_at: z.string().nullable(),
    caption: z.string().nullable(),
    caption_truncated: z.boolean(),
    url: z.string().nullable(),
    views: z.number().nullable(),
    likes: z.number(),
    comments: z.number(),
    shares: z.number().nullable(),
    reposts: z.number().nullable(),
    interactions: z.number(),
    engagement_rate_by_views: z.number().nullable(),
  })),
});

interface Row {
  platform: Platform; brand_id: string; format: string; posted_at: string | null; caption: string | null; url: string | null;
  views: unknown; likes: unknown; comments: unknown; shares: unknown; reposts: unknown; interactions: unknown;
}

export const topContent = defineCapability({
  name: 'top_content',
  route: '/top-content',
  title: 'Top content',
  description: [
    'The best-performing posts and videos from the brands\' OWN accounts (Instagram, YouTube, X, TikTok) published in the',
    'date range, ranked by interactions (default), views, likes, comments, shares, engagement_rate (interactions/views)',
    'or recent. The ranking is computed within the range, over all posts. Returns caption (masked), content link, format',
    'and every metric. Filter by platforms, brands and formats (reel, carousel, image, short, long_form, post, video).',
    'Use for "show me the top posts / most viewed videos"; use content_performance for averages per brand.',
    'Output: data.items = [{platform, brand, account_handle, format, posted_at, caption, url, views, likes, comments,',
    'shares, reposts, interactions, engagement_rate_by_views}].',
    'Example: "What were Selkirk\'s most-viewed YouTube Shorts last month?"',
  ].join(' '),
  input: z.object({
    ...platformFilterShape,
    formats: z.array(z.enum(FORMATS)).max(FORMATS.length).optional().describe('Content formats to include. Default: all.'),
    sort_by: z.enum(SORTS).optional().describe('Ranking. Default interactions.'),
    limit: z.number().int().min(1).max(50).optional().describe(`Number of items. Default ${DEFAULT_LIMIT}.`),
  }),
  output,
  examples: [
    { question: 'Top 10 brand posts by interactions across all platforms', input: {} },
    { question: 'Most-viewed TikTok videos by CRBN and JOOLA', input: { brands: ['CRBN', 'JOOLA'], platforms: ['tiktok'], sort_by: 'views', limit: 5 } },
  ],
  async run(input, ctx) {
    const sort = input.sort_by ?? 'interactions';
    const limit = input.limit ?? DEFAULT_LIMIT;
    const pf = await resolvePlatformFilters(input, ctx);
    const where = and([
      platformWhere(pf, sql.ref('posted_at')),
      input.formats?.length ? sql`format = any(${input.formats}::text[])` : sql`true`,
      sort === 'engagement_rate' ? sql`views > 0` : sql`true`,
    ]);
    const [rows, brands, accounts] = await Promise.all([
      run<Row>(ctx.db, sql`
        select platform, brand_id::text as brand_id, format, ${isoText(sql`posted_at`)} as posted_at, caption, url,
          views, likes, comments, shares, reposts, interactions
        from intel.v_content where ${where}
        order by ${ORDER[sort]}, content_id limit ${limit}`),
      ctx.brands(),
      brandAccounts(ctx),
    ]);
    const names = new Map(brands.map(b => [b.brand_id, b.name]));
    const items = rows.map(r => {
      const views = numOrNull(r.views);
      const interactions = Number(r.interactions);
      const cap = truncate(r.caption, CAPTION_LIMIT);
      return {
        platform: r.platform,
        brand: names.get(r.brand_id) ?? r.brand_id,
        account_handle: accounts.get(`${r.platform}|${r.brand_id}`)?.handle ?? null,
        format: r.format,
        posted_at: r.posted_at,
        caption: cap.text,
        caption_truncated: cap.text_truncated,
        url: r.url,
        views,
        likes: Number(r.likes),
        comments: Number(r.comments),
        shares: numOrNull(r.shares),
        reposts: numOrNull(r.reposts),
        interactions,
        engagement_rate_by_views: views ? round2((interactions / views) * 100) : null,
      };
    });
    const notes = ['interactions = likes + comments + shares (TikTok) + reposts (X); X comments are replies.'];
    if (sort === 'engagement_rate') notes.push('Ranked by engagement rate: only posts that report views are included.');
    return {
      data: { items },
      meta: meta({
        filters: { ...pf.f.applied, formats: input.formats ?? null, sort_by: sort, limit }, rows_counted: items.length,
        excluded: { undated: 0, unbranded: 0, unlabelled_sentiment: 0 }, notes,
      }, ctx),
    };
  },
  summarise: r => {
    const top = r.data.items[0];
    if (!top) return 'No brand posts match these filters.';
    return `${r.data.items.length} items. Top: ${top.brand} ${PLATFORM_LABEL[top.platform]} ${top.format}, ` +
      `${fmt(top.interactions)} interactions${top.views != null ? `, ${fmt(top.views)} views` : ''}, ${top.posted_at?.slice(0, 10) ?? 'undated'}.`;
  },
});
