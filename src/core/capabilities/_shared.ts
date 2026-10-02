// Helpers shared by capability implementations.
import { z } from 'zod';
import type { Ctx } from '../context';
import { countExclusions, exclusionNotes, resolveFilters, type CommonFilterInput, type Filters, type Exclusions } from '../filters';
import { CHANNELS, SENTIMENT_3, SENTIMENT_5 } from '../normalise';
import { isoText, run, sql } from '../sql';

export const TEXT_LIMIT = 500;

export function truncate(text: string | null, limit = TEXT_LIMIT): { text: string | null; text_truncated: boolean } {
  if (text == null) return { text: null, text_truncated: false };
  if (text.length <= limit) return { text, text_truncated: false };
  return { text: text.slice(0, limit - 1).trimEnd() + '…', text_truncated: true };
}

export const num = (v: unknown): number => (v == null ? 0 : Number(v));
export const fmt = (n: number) => n.toLocaleString('en-US');
export const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null);

export interface Base { f: Filters; x: Exclusions; notes: string[]; brandName: (id: string | null) => string }

/** Resolve filters, count exclusions, build notes and a brand-name lookup in one step. */
export async function prepare(input: CommonFilterInput, ctx: Ctx, perBrand: boolean, opts: { skipExclusions?: boolean } = {}): Promise<Base> {
  const f = await resolveFilters(input, ctx);
  const none: Exclusions = { excluded: { undated: 0, unbranded: 0, unlabelled_sentiment: 0 }, undatedByChannel: {} };
  const [x, brands] = await Promise.all([opts.skipExclusions ? none : countExclusions(ctx, f, perBrand), ctx.brands()]);
  const names = new Map(brands.map(b => [b.brand_id, b.name]));
  const notes = opts.skipExclusions ? ['Exclusion counts are reported on the first page only.'] : exclusionNotes(x, f);
  return { f, x, notes, brandName: id => (id ? names.get(id) ?? id : 'Unbranded') };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Human label for a period key, e.g. 'Aug 2026', 'week of 2026-08-03', '2026-08-03'. */
export function periodLabel(period: string, g: 'day' | 'week' | 'month'): string {
  if (g === 'month') return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
  return g === 'week' ? `week of ${period}` : period;
}

// ---------- shared output schemas ----------
export const zChannel = z.enum(CHANNELS);
export const zPoint = z.object({ period: z.string(), series: z.string(), value: z.number().nullable() });
export const zSentiment5 = z.enum(SENTIMENT_5);
export const zSentiment3 = z.enum(SENTIMENT_3);
export const zSignalItem = z.object({
  item_id: z.string(),
  channel: z.string(),
  signal_type: z.string(),
  brands: z.array(z.string()),
  sentiment_5: zSentiment5,
  sentiment_3: zSentiment3,
  is_crisis: z.boolean(),
  occurred_at: z.string().nullable(),
  date_source: z.string(),
  text: z.string().nullable(),
  text_truncated: z.boolean(),
  post_url: z.string().nullable(),
  engagement: z.number(),
  engagement_kind: z.string(),
});
export type SignalItem = z.infer<typeof zSignalItem>;

export interface RawItemRow {
  item_id: string; channel: string; signal_type: string; brand_ids: string[] | null; sentiment_5: string; sentiment_3: string;
  is_crisis: boolean; occurred_at: string | null; date_source: string; text: string | null; post_url: string | null;
  engagement: unknown; engagement_kind: string;
}

export interface ItemKey { source_table: string; source_row_id: string }
export const itemRef = (k: ItemKey) => `${k.source_table}:${k.source_row_id}`;

/**
 * Loads display fields (masked text, link, every brand) for a few items, keyed by itemRef().
 * Masking text is the expensive part of v_signals, so callers rank on cheap columns (engagement, dates, ids) first
 * and fetch only the winners. Filtering on source_row_id lets the planner use each source table's primary key.
 */
export async function fetchItems(ctx: Ctx, keys: readonly ItemKey[]): Promise<Map<string, RawItemRow>> {
  if (!keys.length) return new Map();
  const rows = await run<RawItemRow & { item_ref: string }>(ctx.db, sql`
    select v.source_table || ':' || v.source_row_id::text as item_ref,
      md5(v.source_table || ':' || v.source_row_id::text) as item_id, min(channel) as channel, min(signal_type) as signal_type,
      array_agg(distinct brand_id::text) filter (where brand_id is not null) as brand_ids,
      min(sentiment_5) as sentiment_5, min(sentiment_3) as sentiment_3, bool_or(is_crisis) as is_crisis,
      ${isoText(sql`max(occurred_at)`)} as occurred_at, min(date_source) as date_source, min(text) as text,
      min(post_url) as post_url, max(engagement) as engagement, min(engagement_kind) as engagement_kind
    from intel.v_signals v
    where v.source_row_id = any(${keys.map(k => k.source_row_id)}::uuid[])
      and v.source_table || ':' || v.source_row_id::text = any(${keys.map(itemRef)}::text[])
    group by v.source_table, v.source_row_id`);
  return new Map(rows.map(r => [r.item_ref, r]));
}

export function toItem(r: RawItemRow, brandName: (id: string | null) => string, textLimit = TEXT_LIMIT): SignalItem {
  return {
    item_id: r.item_id,
    channel: r.channel,
    signal_type: r.signal_type,
    brands: (r.brand_ids ?? []).filter(Boolean).map(id => brandName(id)),
    sentiment_5: r.sentiment_5 as SignalItem['sentiment_5'],
    sentiment_3: r.sentiment_3 as SignalItem['sentiment_3'],
    is_crisis: r.is_crisis,
    occurred_at: r.occurred_at,
    date_source: r.date_source,
    ...truncate(r.text, textLimit),
    post_url: r.post_url,
    engagement: num(r.engagement),
    engagement_kind: r.engagement_kind,
  };
}
