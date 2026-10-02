import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { commonFilterShape, resolveFilters } from '../filters';
import { and, isoText, run, sql, type Sql } from '../sql';
import { fmt, truncate } from './_shared';
import { numOrNull, round1 } from '../platform';

const DEFAULT_TOP = 10;
const MAX_SUBREDDITS = 15;

const zPost = z.object({
  brands: z.array(z.string()), subreddit: z.string().nullable(), title: z.string().nullable(), url: z.string().nullable(),
  posted_at: z.string().nullable(), upvotes: z.number(), velocity_per_hour: z.number().nullable(), captured_comments: z.number(),
  sentiment_5: z.string(),
});
const output = z.object({
  subreddits: z.array(z.object({
    subreddit: z.string(), posts: z.number(), joola_posts: z.number(), joola_share_pct: z.number().nullable(),
    brands: z.array(z.object({ brand: z.string(), posts: z.number() })),
  })),
  viral: z.array(zPost),
  most_discussed: z.array(zPost),
});

interface PostRow {
  post_id: string; brand_ids: string[] | null; subreddit: string | null; title: string | null; url: string | null; posted_at: string | null;
  upvotes: unknown; velocity_per_hour: unknown; captured_comments: number; sentiment_5: string;
}

export const redditInsights = defineCapability({
  name: 'reddit_insights',
  route: '/reddit-insights',
  title: 'Reddit insights',
  description: [
    'Reddit-specific views that mention counts do not give: which subreddits the brands are discussed in (posts per',
    'subreddit, per brand, and JOOLA\'s share), viral posts ranked by upvote velocity (upvotes per hour), and the most',
    'discussed posts by captured replies. Removed posts are excluded. Brand attribution matches the other tools.',
    'Use for "where on Reddit are people talking about X / what is blowing up"; use volume_over_time or',
    'sentiment_breakdown with channels=["reddit"] for counts and sentiment.',
    'Output: data = {subreddits:[{subreddit, posts, joola_posts, joola_share_pct, brands:[{brand, posts}]}],',
    'viral:[post], most_discussed:[post]} where post = {brands, subreddit, title, url, posted_at, upvotes, velocity_per_hour, captured_comments, sentiment_5}.',
    'Example: "Which subreddits talk about JOOLA most, and what Reddit posts are going viral?"',
  ].join(' '),
  input: z.object({
    from: commonFilterShape.from,
    to: commonFilterShape.to,
    brands: commonFilterShape.brands,
    top_n: z.number().int().min(1).max(50).optional().describe(`Posts per list. Default ${DEFAULT_TOP}.`),
  }),
  output,
  examples: [
    { question: 'Where on Reddit are the brands discussed, and what is going viral?', input: {} },
    { question: 'Viral Reddit posts about Selkirk since August', input: { brands: ['Selkirk'], from: '2026-08-01', top_n: 5 } },
  ],
  async run(input, ctx) {
    const topN = input.top_n ?? DEFAULT_TOP;
    const f = await resolveFilters({ from: input.from, to: input.to, brands: input.brands }, ctx);
    const toExclusive = new Date(f.to.getTime() + 86_400_000).toISOString();
    const where = and([
      sql`posted_at >= ${f.from.toISOString()}::timestamptz and posted_at < ${toExclusive}::timestamptz`,
      // A post is in scope if any of its brands is selected; all of its brands are still listed.
      f.brandIds ? sql`post_id in (select post_id from intel.v_reddit_posts where brand_id = any(${f.brandIds}::uuid[]))` : sql`true`,
    ]);
    const posts = (order: Sql, extra: Sql) => run<PostRow>(ctx.db, sql`
      select post_id::text as post_id, array_agg(distinct brand_id::text) filter (where brand_id is not null) as brand_ids,
        min(subreddit) as subreddit, min(title) as title, min(url) as url, ${isoText(sql`min(posted_at)`)} as posted_at,
        max(upvotes) as upvotes, max(velocity_per_hour)::float8 as velocity_per_hour, max(captured_comments)::int as captured_comments,
        min(sentiment_5) as sentiment_5
      from intel.v_reddit_posts where ${and([where, extra])}
      group by post_id order by ${order}, post_id limit ${topN}`);
    const [subs, viral, discussed, brands] = await Promise.all([
      run<{ subreddit: string; brand_id: string | null; posts: number; is_joola: boolean }>(ctx.db, sql`
        select coalesce(p.subreddit, 'unknown') as subreddit, p.brand_id::text as brand_id, count(distinct p.post_id)::int as posts,
          coalesce(b.is_joola, false) as is_joola
        from intel.v_reddit_posts p left join intel.v_brands b on b.brand_id = p.brand_id
        where ${where} group by 1, 2, 4`),
      posts(sql`max(velocity_per_hour) desc nulls last`, sql`velocity_per_hour is not null`),
      posts(sql`max(captured_comments) desc, max(upvotes) desc`, sql`captured_comments > 0`),
      ctx.brands(),
    ]);
    const names = new Map(brands.map(b => [b.brand_id, b.name]));
    // Posts per subreddit are distinct posts; a post naming two brands counts once in the total.
    const totals = await run<{ subreddit: string; posts: number; joola_posts: number }>(ctx.db, sql`
      select coalesce(p.subreddit, 'unknown') as subreddit, count(distinct p.post_id)::int as posts,
        count(distinct p.post_id) filter (where b.is_joola)::int as joola_posts
      from intel.v_reddit_posts p left join intel.v_brands b on b.brand_id = p.brand_id
      where ${where} group by 1 order by 2 desc limit ${MAX_SUBREDDITS}`);
    const subreddits = totals.map(t => ({
      subreddit: t.subreddit,
      posts: t.posts,
      joola_posts: t.joola_posts,
      joola_share_pct: t.posts ? round1((t.joola_posts / t.posts) * 100) : null,
      brands: subs.filter(s => s.subreddit === t.subreddit && s.brand_id)
        .map(s => ({ brand: names.get(s.brand_id!) ?? s.brand_id!, posts: s.posts })).sort((a, b) => b.posts - a.posts),
    }));
    const toPost = (r: PostRow) => ({
      brands: (r.brand_ids ?? []).map(id => names.get(id) ?? id),
      subreddit: r.subreddit, title: truncate(r.title, 200).text, url: r.url, posted_at: r.posted_at,
      upvotes: Number(r.upvotes), velocity_per_hour: round1(numOrNull(r.velocity_per_hour)), captured_comments: r.captured_comments,
      sentiment_5: r.sentiment_5,
    });
    const notes = [
      'captured_comments counts replies we scraped, a floor rather than Reddit\'s own comment count.',
      'velocity_per_hour is upvotes gained per hour between scrapes; posts without it are not ranked as viral.',
    ];
    return {
      data: { subreddits, viral: viral.map(toPost), most_discussed: discussed.map(toPost) },
      meta: meta({
        filters: { ...f.applied, top_n: topN }, rows_counted: totals.reduce((s, t) => s + t.posts, 0),
        excluded: { undated: 0, unbranded: 0, unlabelled_sentiment: 0 }, notes,
      }, ctx),
    };
  },
  summarise: r => {
    if (!r.data.subreddits.length) return 'No Reddit posts in this range.';
    const top = r.data.subreddits.slice(0, 3).map(s => `r/${s.subreddit} ${fmt(s.posts)}${s.joola_share_pct != null ? ` (JOOLA ${s.joola_share_pct}%)` : ''}`).join(', ');
    const v = r.data.viral[0];
    return `Top subreddits: ${top}.` + (v ? ` Most viral: "${v.title ?? ''}" in r/${v.subreddit ?? '?'} (${v.velocity_per_hour}/h).` : '');
  },
});
