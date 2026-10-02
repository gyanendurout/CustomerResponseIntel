// Common filters, written ONCE. Every capability gets the same validation, defaults, SQL and exclusion counts.
import { z } from 'zod';
import { AppError } from './errors';
import type { Ctx } from './context';
import {
  CHANNELS, GRANULARITIES, SENTIMENT_FILTER_VALUES, defaultRange, resolveBrands, resolveGranularity,
  sentimentFilterValues, type Channel, type Granularity, type Sentiment5,
} from './normalise';
import { and, run, sql, type Sql } from './sql';
import { MAX_PERIODS, countPeriods } from './periods';

const MAX_BRANDS = 11;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const zDay = z.iso.date().refine(d => { const y = Number(d.slice(0, 4)); return y >= MIN_YEAR && y <= MAX_YEAR; }, { message: `Year must be between ${MIN_YEAR} and ${MAX_YEAR}.` });

export const commonFilterShape = {
  from: zDay.optional().describe('Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`.'),
  to: zDay.optional().describe('End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today).'),
  brands: z.array(z.string().min(1).max(60)).max(MAX_BRANDS).optional()
    .describe('Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands.'),
  channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length).optional()
    .describe('Normalised channels. product_review is its own channel. Default: all.'),
  sentiments: z.array(z.enum(SENTIMENT_FILTER_VALUES)).max(SENTIMENT_FILTER_VALUES.length).optional()
    .describe('5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all.'),
  crisis_only: z.boolean().optional().describe('Only signals flagged as crisis. Default false.'),
  granularity: z.enum(GRANULARITIES).optional().describe('Time bucket. Default: month if the range is over 60 days, else day.'),
  include_undated: z.boolean().optional()
    .describe('Include signals with no date in totals (never placed in a time period). Default false.'),
};

export type CommonFilterInput = z.infer<z.ZodObject<typeof commonFilterShape>>;

export interface Filters {
  from: Date; // inclusive, UTC midnight
  to: Date; // inclusive, UTC midnight
  brandIds: string[] | null;
  channels: Channel[] | null;
  sentiments: Sentiment5[] | null;
  crisisOnly: boolean;
  includeUndated: boolean;
  granularity: Granularity;
  /** Echo for meta.filters (brand names, ISO dates, which defaults were used). */
  applied: Record<string, unknown>;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function resolveFilters(input: CommonFilterInput, ctx: Ctx): Promise<Filters> {
  const defaultsUsed: string[] = [];
  let range: { from: Date; to: Date } | undefined;
  const needDefault = !input.from || !input.to;
  if (needDefault) range = defaultRange(await ctx.newestDataDate(), ctx.now);
  const to = input.to ? new Date(input.to + 'T00:00:00Z') : range!.to;
  const from = input.from ? new Date(input.from + 'T00:00:00Z') : new Date(to.getTime() - 89 * 86_400_000);
  if (!input.to) defaultsUsed.push('to');
  if (!input.from) defaultsUsed.push('from');
  if (from > to) {
    const toNote = input.to ? '' : ' (to defaulted to the newest date in the data)';
    throw new AppError('VALIDATION_ERROR', `'from' (${isoDay(from)}) must not be after 'to' (${isoDay(to)}${toNote}).`);
  }
  if (!input.granularity) defaultsUsed.push('granularity');

  let brandIds: string[] | null = null;
  let brandNames: string[] | null = null;
  if (input.brands?.length) {
    const brands = await ctx.brands();
    brandIds = resolveBrands(input.brands, brands);
    const byId = new Map(brands.map(b => [b.brand_id, b.name]));
    brandNames = brandIds.map(id => byId.get(id) ?? id);
  }
  const channels = input.channels?.length ? [...new Set(input.channels)] : null;
  const sentiments = sentimentFilterValues(input.sentiments);
  const granularity = resolveGranularity(from, to, input.granularity);
  if (countPeriods(from, to, granularity) > MAX_PERIODS) {
    throw new AppError('VALIDATION_ERROR', `That range has more than ${MAX_PERIODS} ${granularity} periods. Use a coarser granularity (week or month) or a shorter range.`);
  }
  return {
    from, to, brandIds, channels, sentiments,
    crisisOnly: input.crisis_only ?? false,
    includeUndated: input.include_undated ?? false,
    granularity,
    applied: {
      from: isoDay(from), to: isoDay(to), brands: brandNames, channels, sentiments,
      crisis_only: input.crisis_only ?? false, include_undated: input.include_undated ?? false,
      granularity, defaults_used: defaultsUsed,
    },
  };
}

// ---------- SQL predicates over intel.v_signals ----------

export function datePredicate(f: Filters, opts: { allowUndated?: boolean } = {}): Sql {
  const toExclusive = new Date(f.to.getTime() + 86_400_000).toISOString();
  const inRange = sql`(occurred_at >= ${f.from.toISOString()}::timestamptz and occurred_at < ${toExclusive}::timestamptz)`;
  return (opts.allowUndated ?? f.includeUndated) ? sql`(occurred_at is null or ${inRange})` : inRange;
}

/** Channel / sentiment / crisis: everything except date and brand. */
export function attributePredicate(f: Filters): Sql {
  const parts: Sql[] = [];
  if (f.channels) parts.push(sql`channel = any(${f.channels}::text[])`);
  if (f.sentiments) parts.push(sql`sentiment_5 = any(${f.sentiments}::text[])`);
  if (f.crisisOnly) parts.push(sql`is_crisis`);
  return and(parts);
}

export function brandPredicate(f: Filters, perBrand: boolean): Sql {
  const parts: Sql[] = [];
  if (f.brandIds) parts.push(sql`brand_id = any(${f.brandIds}::uuid[])`);
  if (perBrand) parts.push(sql`brand_id is not null`);
  return and(parts);
}

/**
 * The filtered set of signals as a subquery.
 * perBrand=true  -> one row per (raw row × brand); unbranded rows excluded. Use when results are split by brand.
 * perBrand=false -> one row per raw row (a comment naming 2 brands counts once). Use for everything else.
 */
export function scopedSignals(f: Filters, perBrand: boolean, opts: { allowUndated?: boolean } = {}): Sql {
  const where = and([datePredicate(f, opts), attributePredicate(f), brandPredicate(f, perBrand)]);
  if (perBrand) return sql`(select * from intel.v_signals where ${where})`;
  return sql`(select distinct on (source_table, source_row_id) * from intel.v_signals where ${where}
              order by source_table, source_row_id, brand_id nulls last)`;
}

export interface Excluded { undated: number; unbranded: number; unlabelled_sentiment: number }
export interface Exclusions { excluded: Excluded; undatedByChannel: Record<string, number> }

/** Counts (distinct raw rows) left out of a result because of missing date / brand, plus unlabelled sentiment. */
export async function countExclusions(ctx: Ctx, f: Filters, perBrand: boolean): Promise<Exclusions> {
  const brandOk = brandPredicate(f, perBrand);
  const dateOk = datePredicate(f, { allowUndated: false });
  const brandMatters = perBrand || f.brandIds !== null;
  const rows = await run<{ channel: string; undated: number; unbranded: number; unlabelled: number }>(ctx.db, sql`
    select channel,
      count(distinct (source_table, source_row_id)) filter (where occurred_at is null and ${brandOk})::int as undated,
      count(distinct (source_table, source_row_id)) filter (where brand_id is null and ${dateOk})::int as unbranded,
      count(distinct (source_table, source_row_id)) filter (where sentiment_5 = 'unlabelled' and ${datePredicate(f)} and ${brandOk})::int as unlabelled
    from intel.v_signals
    where ${attributePredicate(f)}
    group by channel`);
  const undatedByChannel: Record<string, number> = {};
  const excluded: Excluded = { undated: 0, unbranded: 0, unlabelled_sentiment: 0 };
  for (const r of rows) {
    if (!f.includeUndated && r.undated) { excluded.undated += r.undated; undatedByChannel[r.channel] = r.undated; }
    if (brandMatters) excluded.unbranded += r.unbranded;
    excluded.unlabelled_sentiment += r.unlabelled;
  }
  return { excluded, undatedByChannel };
}

const CHANNEL_LABEL: Record<string, string> = {
  instagram: 'Instagram', youtube: 'YouTube', reddit: 'Reddit', tiktok: 'TikTok', x: 'X',
  product_review: 'product review', other: 'other-channel',
};
const fmt = (n: number) => n.toLocaleString('en-US');

/** Plain-English notes for meta.notes. */
export function exclusionNotes(x: Exclusions, f: Filters): string[] {
  const notes: string[] = [];
  for (const [ch, n] of Object.entries(x.undatedByChannel).sort((a, b) => b[1] - a[1])) {
    notes.push(`${fmt(n)} ${CHANNEL_LABEL[ch] ?? ch} item${n === 1 ? '' : 's'} excluded: no date (set include_undated=true to count them in totals).`);
  }
  if (x.excluded.unbranded) notes.push(`${fmt(x.excluded.unbranded)} item${x.excluded.unbranded === 1 ? '' : 's'} excluded: no brand could be attributed.`);
  if (x.excluded.unlabelled_sentiment) notes.push(`${fmt(x.excluded.unlabelled_sentiment)} item${x.excluded.unlabelled_sentiment === 1 ? ' has' : 's have'} no sentiment label (counted as 'unlabelled', not dropped).`);
  if (f.applied.defaults_used && (f.applied.defaults_used as string[]).includes('to')) {
    notes.push(`Date range defaulted to the last 90 days of available data (${String(f.applied.from)} to ${String(f.applied.to)}).`);
  }
  return notes;
}
