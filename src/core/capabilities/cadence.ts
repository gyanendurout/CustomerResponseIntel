import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { GRANULARITIES } from '../normalise';
import { periodExpr, periodsBetween } from '../periods';
import { run, sql } from '../sql';
import { fmt, periodLabel } from './_shared';
import { PLATFORMS, PLATFORM_LABEL, brandAccounts, platformFilterShape, platformWhere, resolvePlatformFilters, round1, type Platform } from '../platform';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const output = z.object({
  summary: z.array(z.object({
    platform: z.enum(PLATFORMS),
    brand: z.string(),
    posts: z.number(),
    active_days: z.number(),
    days_in_range: z.number(),
    posts_per_week: z.number().nullable(),
    busiest_weekday: z.enum(WEEKDAYS).nullable(),
    last_period_posts: z.number(),
    previous_period_posts: z.number(),
  })),
  // Compact layout: periods and weekdays are listed once; each series row holds one number per period / weekday.
  periods: z.array(z.string()),
  weekdays: z.array(z.enum(WEEKDAYS)),
  series: z.array(z.object({ platform: z.enum(PLATFORMS), brand: z.string(), posts: z.array(z.number()), by_weekday: z.array(z.number()) })),
});

export const postingCadence = defineCapability({
  name: 'posting_cadence',
  route: '/posting-cadence',
  title: 'Posting cadence',
  description: [
    'How often each brand posts on its OWN Instagram, YouTube, X and TikTok accounts: posts per period (zero-filled,',
    'weekly by default), posts by weekday (UTC), active days, posts per week, busiest weekday, and the last vs previous',
    'period. Brands with a tracked account but no posts in the range appear with 0 (silent), not missing.',
    'Use for "who posts most / is JOOLA posting less"; use content_performance for engagement.',
    'Output: data = {summary:[{platform, brand, posts, active_days, days_in_range, posts_per_week, busiest_weekday,',
    'last_period_posts, previous_period_posts}], periods:[YYYY-MM-DD…], weekdays:[Mon…Sun], series:[{platform, brand,',
    'posts:[one count per period], by_weekday:[one count per weekday]}]}.',
    'Example: "How often did each brand post on Instagram over the last 4 weeks?"',
  ].join(' '),
  input: z.object({
    ...platformFilterShape,
    granularity: z.enum(GRANULARITIES).optional().describe('Series bucket. Default week.'),
  }),
  output,
  examples: [
    { question: 'Weekly posting cadence on Instagram, last 28 days', input: { platforms: ['instagram'], from: '2026-09-01', to: '2026-09-28' } },
    { question: 'Monthly posts per brand on every platform', input: { granularity: 'month' } },
  ],
  async run(input, ctx) {
    const pf = await resolvePlatformFilters({ ...input, granularity: input.granularity ?? 'week' }, ctx);
    const { f } = pf;
    const where = platformWhere(pf, sql.ref('posted_at'));
    const [series, totals, weekdays, brands, accounts] = await Promise.all([
      run<{ platform: Platform; brand_id: string; period: string; n: number }>(ctx.db, sql`
        select platform, brand_id::text as brand_id, ${periodExpr(sql.ref('posted_at'), f.granularity)} as period, count(*)::int as n
        from intel.v_content where ${where} group by 1, 2, 3`),
      run<{ platform: Platform; brand_id: string; n: number; active_days: number }>(ctx.db, sql`
        select platform, brand_id::text as brand_id, count(*)::int as n,
          count(distinct (posted_at at time zone 'UTC')::date)::int as active_days
        from intel.v_content where ${where} group by 1, 2`),
      run<{ platform: Platform; brand_id: string; dow: number; n: number }>(ctx.db, sql`
        select platform, brand_id::text as brand_id, extract(isodow from posted_at at time zone 'UTC')::int as dow, count(*)::int as n
        from intel.v_content where ${where} group by 1, 2, 3`),
      ctx.brands(),
      brandAccounts(ctx),
    ]);
    const names = new Map(brands.map(b => [b.brand_id, b.name]));
    const brandIds = new Set(f.brandIds ?? brands.map(b => b.brand_id));
    // Pairs to report: every brand/platform with posts, plus every tracked brand account (shown as 0 when silent).
    const pairs = new Set(totals.map(t => `${t.platform}|${t.brand_id}`));
    for (const key of accounts.keys()) {
      const [platform, brandId] = key.split('|') as [Platform, string];
      if (pf.platforms.includes(platform) && brandIds.has(brandId)) pairs.add(key);
    }
    const periods = periodsBetween(f.from, f.to, f.granularity);
    const days = Math.round((f.to.getTime() - f.from.getTime()) / 86_400_000) + 1;
    const count = new Map(series.map(s => [`${s.platform}|${s.brand_id}|${s.period}`, s.n]));

    const outSeries: z.infer<typeof output>['series'] = [];
    const summary: z.infer<typeof output>['summary'] = [];
    for (const key of [...pairs].sort()) {
      const [platform, brandId] = key.split('|') as [Platform, string];
      const brand = names.get(brandId) ?? brandId;
      const perPeriod = periods.map(p => count.get(`${key}|${p}`) ?? 0);

      const wd = WEEKDAYS.map((w, i) => ({ weekday: w, posts: weekdays.find(x => `${x.platform}|${x.brand_id}` === key && x.dow === i + 1)?.n ?? 0 }));
      outSeries.push({ platform, brand, posts: perPeriod, by_weekday: wd.map(w => w.posts) });
      const t = totals.find(x => `${x.platform}|${x.brand_id}` === key);
      const busiest = wd.reduce((m, w) => (w.posts > m.posts ? w : m), { weekday: WEEKDAYS[0], posts: 0 } as { weekday: (typeof WEEKDAYS)[number]; posts: number });
      summary.push({
        platform, brand,
        posts: t?.n ?? 0,
        active_days: t?.active_days ?? 0,
        days_in_range: days,
        posts_per_week: round1(((t?.n ?? 0) / days) * 7),
        busiest_weekday: busiest.posts > 0 ? busiest.weekday : null,
        last_period_posts: perPeriod.at(-1) ?? 0,
        previous_period_posts: perPeriod.at(-2) ?? 0,
      });
    }
    summary.sort((a, b) => a.platform.localeCompare(b.platform) || b.posts - a.posts);
    const notes = ['Weekdays and periods use UTC dates. The last period may be partial if the range ends mid-period.'];
    const silent = summary.filter(s => s.posts === 0).length;
    if (silent) notes.push(`${fmt(silent)} tracked brand account${silent === 1 ? '' : 's'} posted nothing in this range.`);
    return {
      data: { summary, periods, weekdays: [...WEEKDAYS], series: outSeries },
      meta: meta({
        filters: f.applied, rows_counted: summary.reduce((s, x) => s + x.posts, 0),
        excluded: { undated: 0, unbranded: 0, unlabelled_sentiment: 0 }, notes, granularity: f.granularity,
      }, ctx),
    };
  },
  summarise: r => {
    if (!r.data.summary.length) return 'No brand accounts or posts match these filters.';
    const g = (r.meta.granularity as 'day' | 'week' | 'month') ?? 'week';
    const p = r.data.periods.at(-1);
    return [...r.data.summary].sort((a, b) => b.posts - a.posts).slice(0, 3).map(s =>
      `${s.brand} ${PLATFORM_LABEL[s.platform]}: ${fmt(s.posts)} posts (${s.posts_per_week ?? 0}/week)` +
      (p ? `, ${fmt(s.last_period_posts)} in ${periodLabel(p, g)}` : '')).join('; ') + '.';
  },
});
