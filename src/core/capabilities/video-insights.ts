import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { commonFilterShape, resolveFilters } from '../filters';
import { and, isoText, run, sql } from '../sql';
import { fmt, truncate } from './_shared';
import { numOrNull, round1 } from '../platform';

const DEFAULT_TOP = 5;

const output = z.object({
  formats: z.array(z.object({ brand: z.string(), format: z.enum(['short', 'long_form']), videos: z.number(), avg_views: z.number().nullable(), avg_interactions: z.number().nullable() })),
  content_types: z.array(z.object({ brand: z.string(), content_type: z.string(), videos: z.number(), avg_views: z.number().nullable(), paid_promos: z.number() })),
  coverage: z.array(z.object({ brand: z.string(), videos: z.number(), analysed: z.number() })),
  top_videos: z.array(z.object({
    brand: z.string(), title: z.string().nullable(), url: z.string().nullable(), posted_at: z.string().nullable(),
    is_short: z.boolean(), content_type: z.string().nullable(), is_paid_promo: z.boolean(), views: z.number().nullable(),
    performance_thesis: z.string().nullable(), performance_signals: z.array(z.string()), products: z.array(z.string()),
  })),
});

export const videoInsights = defineCapability({
  name: 'video_insights',
  route: '/youtube-insights',
  title: 'YouTube video insights',
  description: [
    'YouTube content strategy for the brands\' OWN channels in the date range: Shorts vs long-form (videos, average views',
    'and interactions), content-type mix from the AI video analysis (tutorial, review, highlight, unboxing, comparison, …)',
    'with average views and paid-promo counts, analysis coverage per brand, and the top analysed videos with the AI',
    '"performance thesis" (why it worked), signals and products shown. Only some videos are analysed (see coverage).',
    'Use for "what kind of YouTube content works for competitors"; use top_content for raw top videos.',
    'Output: data = {formats:[...], content_types:[...], coverage:[{brand, videos, analysed}], top_videos:[{brand, title, url,',
    'content_type, views, performance_thesis, performance_signals, products}]}.',
    'Example: "Why are Selkirk\'s YouTube videos getting more views than JOOLA\'s?"',
  ].join(' '),
  input: z.object({
    from: commonFilterShape.from,
    to: commonFilterShape.to,
    brands: commonFilterShape.brands,
    top_n: z.number().int().min(1).max(25).optional().describe(`Top analysed videos to return. Default ${DEFAULT_TOP}.`),
  }),
  output,
  examples: [
    { question: 'What YouTube content works for each brand?', input: {} },
    { question: 'Top 3 Selkirk videos and why they worked, since June', input: { brands: ['Selkirk'], from: '2026-06-01', top_n: 3 } },
  ],
  async run(input, ctx) {
    const topN = input.top_n ?? DEFAULT_TOP;
    const f = await resolveFilters({ from: input.from, to: input.to, brands: input.brands }, ctx);
    const toExclusive = new Date(f.to.getTime() + 86_400_000).toISOString();
    const inRange = sql`posted_at >= ${f.from.toISOString()}::timestamptz and posted_at < ${toExclusive}::timestamptz`;
    const brandOk = f.brandIds ? sql`brand_id = any(${f.brandIds}::uuid[])` : sql`true`;
    const [formats, types, coverage, top, brands] = await Promise.all([
      run<{ brand_id: string; format: 'short' | 'long_form'; videos: number; avg_views: unknown; avg_interactions: unknown }>(ctx.db, sql`
        select brand_id::text as brand_id, format, count(*)::int as videos, avg(views)::float8 as avg_views, avg(interactions)::float8 as avg_interactions
        from intel.v_content where ${and([sql`platform = 'youtube'`, brandOk, inRange])} group by 1, 2 order by 1, 2`),
      run<{ brand_id: string; content_type: string; videos: number; avg_views: unknown; paid: number }>(ctx.db, sql`
        select brand_id::text as brand_id, coalesce(content_type, 'unknown') as content_type, count(*)::int as videos,
          avg(views)::float8 as avg_views, count(*) filter (where is_paid_promo)::int as paid
        from intel.v_video_analysis where ${and([brandOk, inRange])} group by 1, 2 order by 1, 3 desc`),
      run<{ brand_id: string; videos: number; analysed: number }>(ctx.db, sql`
        select c.brand_id::text as brand_id, count(*)::int as videos, count(a.content_id)::int as analysed
        from intel.v_content c left join intel.v_video_analysis a on a.content_id = c.content_id
        where ${and([sql`c.platform = 'youtube'`, f.brandIds ? sql`c.brand_id = any(${f.brandIds}::uuid[])` : sql`true`,
          sql`c.posted_at >= ${f.from.toISOString()}::timestamptz and c.posted_at < ${toExclusive}::timestamptz`])}
        group by 1 order by 2 desc`),
      run<{ brand_id: string; title: string | null; url: string | null; posted_at: string | null; is_short: boolean; content_type: string | null;
        is_paid_promo: boolean; views: unknown; performance_thesis: string | null; performance_signals: string[] | null; products: string[] | null }>(ctx.db, sql`
        select brand_id::text as brand_id, title, url, ${isoText(sql`posted_at`)} as posted_at, is_short, content_type, is_paid_promo,
          views, performance_thesis, performance_signals, products
        from intel.v_video_analysis where ${and([brandOk, inRange])}
        order by views desc nulls last, content_id limit ${topN}`),
      ctx.brands(),
    ]);
    const names = new Map(brands.map(b => [b.brand_id, b.name]));
    const name = (id: string) => names.get(id) ?? id;
    const data = {
      formats: formats.map(r => ({ brand: name(r.brand_id), format: r.format, videos: r.videos, avg_views: round1(numOrNull(r.avg_views)), avg_interactions: round1(numOrNull(r.avg_interactions)) })),
      content_types: types.map(r => ({ brand: name(r.brand_id), content_type: r.content_type, videos: r.videos, avg_views: round1(numOrNull(r.avg_views)), paid_promos: r.paid })),
      coverage: coverage.map(r => ({ brand: name(r.brand_id), videos: r.videos, analysed: r.analysed })),
      top_videos: top.map(r => ({
        brand: name(r.brand_id), title: truncate(r.title, 200).text, url: r.url, posted_at: r.posted_at, is_short: r.is_short,
        content_type: r.content_type, is_paid_promo: r.is_paid_promo, views: numOrNull(r.views),
        performance_thesis: truncate(r.performance_thesis, 400).text,
        performance_signals: (r.performance_signals ?? []).map(s => truncate(s, 200).text ?? ''),
        products: r.products ?? [],
      })),
    };
    const analysed = data.coverage.reduce((s, c) => s + c.analysed, 0);
    const videos = data.coverage.reduce((s, c) => s + c.videos, 0);
    const notes = [
      `${fmt(analysed)} of ${fmt(videos)} brand videos in range have an AI analysis; content types and theses describe those only.`,
      'Performance theses are AI-generated from titles and descriptions, not from watching the video.',
    ];
    return {
      data,
      meta: meta({ filters: { ...f.applied, top_n: topN }, rows_counted: videos, excluded: { undated: 0, unbranded: 0, unlabelled_sentiment: 0 }, notes }, ctx),
    };
  },
  summarise: r => {
    if (!r.data.coverage.length) return 'No brand YouTube videos in this range.';
    const shorts = r.data.formats.filter(x => x.format === 'short').reduce((s, x) => s + x.videos, 0);
    const longs = r.data.formats.filter(x => x.format === 'long_form').reduce((s, x) => s + x.videos, 0);
    const top = r.data.top_videos[0];
    return `${fmt(shorts)} Shorts and ${fmt(longs)} long-form videos.` +
      (top ? ` Top analysed: ${top.brand} "${top.title ?? ''}" (${fmt(top.views ?? 0)} views, ${top.content_type ?? 'unknown'}).` : '');
  },
});
