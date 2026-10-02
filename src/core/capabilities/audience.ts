import { z } from 'zod';
import { defineCapability, meta, NO_EXCLUSIONS } from '../capability';
import { periodStart } from '../periods';
import { and, run, sql } from '../sql';
import { fmt, num } from './_shared';
import {
  PLATFORMS, PLATFORM_LABEL, brandAccounts, numOrNull, platformFilterShape, resolvePlatformFilters, round1, type Platform,
} from '../platform';

/** A week whose followers fell by more than this share vs the previous good week is treated as a scrape glitch. */
const SUSPECT_DROP = 0.5;
const WEEK_MS = 7 * 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const zPlatform = z.enum(PLATFORMS);
const output = z.object({
  accounts: z.array(z.object({
    platform: zPlatform,
    brand: z.string(),
    account_handle: z.string().nullable(),
    account_url: z.string().nullable(),
    latest_week: z.string().nullable(),
    followers: z.number().nullable(),
    following: z.number().nullable(),
    content_count: z.number().nullable(),
    total_hearts: z.number().nullable(),
    total_views: z.number().nullable(),
    content_theme: z.string().nullable(),
    change_vs_previous_week: z.number().nullable(),
    change_vs_previous_week_pct: z.number().nullable(),
    change_in_range: z.number().nullable(),
    change_in_range_pct: z.number().nullable(),
    weeks_with_data: z.number(),
    missing_weeks: z.number(),
    suspect_weeks: z.number(),
  })),
  // Compact layout: weeks are listed once; each series row holds one value and one flag per week.
  // flag: ok | suspect (glitch, excluded) | missing (no snapshot after tracking began) | not_tracked (before the first snapshot)
  weeks: z.array(z.string()),
  series: z.array(z.object({
    platform: zPlatform, brand: z.string(), followers: z.array(z.number().nullable()),
    flags: z.array(z.enum(['ok', 'suspect', 'missing', 'not_tracked'])),
  })),
  no_data: z.array(z.object({ platform: zPlatform, brand: z.string(), has_account: z.boolean() })),
});

interface WeekRow {
  platform: Platform; brand_id: string; week: string; followers: unknown; following: unknown; content_count: unknown;
  total_hearts: unknown; total_views: unknown; content_theme: string | null;
}

const pct = (delta: number, base: number) => (base > 0 ? round1((delta / base) * 100) : null);

export const audienceGrowth = defineCapability({
  name: 'audience_growth',
  route: '/audience',
  title: 'Audience growth',
  description: [
    'Followers (YouTube: subscribers) of each brand\'s OWN account on Instagram, YouTube, X and TikTok, from weekly',
    'snapshots: latest value, change vs the previous week, change over the date range, plus following, content count,',
    'TikTok lifetime hearts, YouTube lifetime views and the Instagram dominant content theme. Also returns the brand',
    'account handle and profile link. Missing weeks and scrape glitches (0 followers or a >50% one-week drop) are flagged',
    'and excluded from changes, never interpolated. no_data lists brand/platform pairs with no snapshots in range.',
    'Use for "who is growing fastest / how many followers"; use content_performance for post engagement.',
    'Output: data = {accounts:[{platform, brand, account_handle, account_url, latest_week, followers, change_vs_previous_week,',
    'change_vs_previous_week_pct, change_in_range, change_in_range_pct, ...}], weeks:[YYYY-MM-DD…],',
    'series:[{platform, brand, followers:[one per week], flags:[ok|suspect|missing|not_tracked per week]}], no_data:[...]}.',
    'Example: "Which brand gained the most Instagram followers this quarter?"',
  ].join(' '),
  input: z.object(platformFilterShape),
  output,
  examples: [
    { question: 'Follower growth for all brands on every platform', input: {} },
    { question: 'JOOLA vs Selkirk Instagram followers since July', input: { brands: ['JOOLA', 'Selkirk'], platforms: ['instagram'], from: '2026-07-01' } },
  ],
  async run(input, ctx) {
    const pf = await resolvePlatformFilters(input, ctx);
    const { f } = pf;
    const fromWeek = periodStart(f.from, 'week');
    const lastWeek = periodStart(f.to, 'week');
    const rows = await run<WeekRow>(ctx.db, sql`
      select platform, brand_id::text as brand_id, to_char(week_start, 'YYYY-MM-DD') as week, followers, following,
        content_count, total_hearts, total_views, content_theme
      from intel.v_audience_weekly
      where ${and([
        sql`platform = any(${pf.platforms}::text[])`,
        f.brandIds ? sql`brand_id = any(${f.brandIds}::uuid[])` : sql`true`,
        sql`week_start >= ${isoDay(fromWeek)}::date and week_start <= ${isoDay(lastWeek)}::date`,
      ])}
      order by platform, brand_id, week_start`);
    const [brands, accounts] = await Promise.all([ctx.brands(), brandAccounts(ctx)]);
    const names = new Map(brands.map(b => [b.brand_id, b.name]));
    const brandName = (id: string) => names.get(id) ?? id;

    const groups = new Map<string, WeekRow[]>();
    for (const r of rows) {
      const key = `${r.platform}|${r.brand_id}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }

    const out: z.infer<typeof output>['accounts'] = [];
    const weeks: string[] = [];
    for (let t = fromWeek.getTime(); t <= lastWeek.getTime(); t += WEEK_MS) weeks.push(isoDay(new Date(t)));
    const series: z.infer<typeof output>['series'] = [];
    let suspectTotal = 0;
    let missingTotal = 0;
    for (const [key, list] of groups) {
      const [platform, brandId] = key.split('|') as [Platform, string];
      const brand = brandName(brandId);
      const byWeek = new Map(list.map(r => [r.week, r]));
      const firstWeek = list[0]!.week;
      const good: Array<{ week: string; row: WeekRow; followers: number }> = [];
      const values: Array<number | null> = [];
      const flags: z.infer<typeof output>['series'][number]['flags'] = [];
      let missing = 0;
      let suspect = 0;
      for (const week of weeks) {
        const row = byWeek.get(week);
        if (!row) {
          const tracked = week > firstWeek;
          if (tracked) missing += 1;
          values.push(null); flags.push(tracked ? 'missing' : 'not_tracked');
          continue;
        }
        const followers = numOrNull(row.followers);
        const prevGood = good.at(-1);
        const isSuspect = followers == null || followers <= 0 || (prevGood !== undefined && followers < prevGood.followers * (1 - SUSPECT_DROP));
        values.push(followers);
        if (isSuspect) { suspect += 1; flags.push('suspect'); continue; }
        good.push({ week, row, followers: followers! });
        flags.push('ok');
      }
      series.push({ platform, brand, followers: values, flags });
      suspectTotal += suspect;
      missingTotal += missing;
      const latest = good.at(-1);
      const prev = good.at(-2);
      const first = good[0];
      const consecutive = latest && prev && new Date(latest.week).getTime() - new Date(prev.week).getTime() === WEEK_MS;
      const weekDelta = consecutive ? latest!.followers - prev!.followers : null;
      const rangeDelta = latest && first && latest !== first ? latest.followers - first.followers : null;
      const theme = [...list].reverse().find(r => r.content_theme)?.content_theme ?? null;
      const account = accounts.get(key);
      out.push({
        platform, brand,
        account_handle: account?.handle ?? null,
        account_url: account?.url ?? null,
        latest_week: latest?.week ?? null,
        followers: latest?.followers ?? null,
        following: latest ? numOrNull(latest.row.following) : null,
        content_count: latest ? numOrNull(latest.row.content_count) : null,
        total_hearts: latest ? numOrNull(latest.row.total_hearts) : null,
        total_views: latest ? numOrNull(latest.row.total_views) : null,
        content_theme: platform === 'instagram' ? theme : null,
        change_vs_previous_week: weekDelta,
        change_vs_previous_week_pct: weekDelta == null ? null : pct(weekDelta, prev!.followers),
        change_in_range: rangeDelta,
        change_in_range_pct: rangeDelta == null ? null : pct(rangeDelta, first!.followers),
        weeks_with_data: good.length,
        missing_weeks: missing,
        suspect_weeks: suspect,
      });
    }
    out.sort((a, b) => a.platform.localeCompare(b.platform) || (b.followers ?? -1) - (a.followers ?? -1));

    const brandIds = f.brandIds ?? brands.map(b => b.brand_id);
    const noData = pf.platforms.flatMap(platform => brandIds
      .filter(id => !groups.has(`${platform}|${id}`))
      .map(id => ({ platform, brand: brandName(id), has_account: accounts.has(`${platform}|${id}`) })));

    const notes: string[] = ['Followers are subscribers on YouTube. Weeks are ISO weeks (week = the Monday it starts).'];
    if (suspectTotal) notes.push(`${fmt(suspectTotal)} weekly snapshot${suspectTotal === 1 ? ' looks' : 's look'} like a scrape glitch (0 followers or a >50% one-week drop) and ${suspectTotal === 1 ? 'is' : 'are'} excluded from changes.`);
    if (missingTotal) notes.push(`${fmt(missingTotal)} week${missingTotal === 1 ? ' has' : 's have'} no snapshot (flag "missing"); week-over-week change is only given for consecutive weeks.`);
    if (noData.length) notes.push(`${fmt(noData.length)} brand/platform pair${noData.length === 1 ? ' has' : 's have'} no snapshots in this range (see data.no_data; has_account=false means the brand has no tracked account there).`);
    return {
      data: { accounts: out, weeks, series, no_data: noData },
      meta: meta({
        filters: f.applied, rows_counted: rows.length, excluded: NO_EXCLUSIONS, notes,
        units: { followers: 'followers (YouTube: subscribers)', change_vs_previous_week_pct: '% vs previous ISO week' },
      }, ctx),
    };
  },
  summarise: r => {
    if (!r.data.accounts.length) return 'No audience snapshots in this range.';
    const top = [...r.data.accounts].filter(a => a.followers != null).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0)).slice(0, 3);
    return top.map(a => {
      const d = a.change_vs_previous_week;
      const change = d == null ? '' : ` (${d >= 0 ? '+' : ''}${fmt(d)} vs previous week)`;
      return `${a.brand} ${PLATFORM_LABEL[a.platform]}: ${fmt(num(a.followers))} followers${change}`;
    }).join('; ') + '.';
  },
});
