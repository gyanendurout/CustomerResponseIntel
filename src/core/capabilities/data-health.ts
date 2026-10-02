import { z } from 'zod';
import { defineCapability, meta, NO_EXCLUSIONS } from '../capability';
import { isoText, run, sql } from '../sql';
import { fmt, num } from './_shared';

const zIssue = z.object({ id: z.string(), title: z.string(), status: z.enum(['handled', 'open', 'insufficient_data']), live_count: z.number(), detail: z.string() });
const output = z.object({
  tables: z.array(z.object({
    table: z.string(), rows: z.number(), null_date: z.number(), null_date_pct: z.number().nullable(), null_brand: z.number(),
    min_date: z.string().nullable(), max_date: z.string().nullable(), last_loaded_at: z.string().nullable(), duplicate_rows: z.number().nullable(),
  })),
  channels: z.array(z.object({ channel: z.string(), last_scrape_at: z.string().nullable(), items: z.number() })),
  known_issues: z.array(zIssue),
});

export const dataHealth = defineCapability({
  name: 'data_health',
  route: '/data-health',
  title: 'Data health',
  description: [
    'Data-quality report: per source table rows, null dates, null brands, date range and last load; last scrape per channel;',
    'and a checklist of known data issues with LIVE counts (undated YouTube comments, unbranded Reddit comments, mention_facts',
    'duplicates, switch-event gaps, undated crises, product reviews as own channel, unlabelled sentiment, reply-detector coverage).',
    'Use before drawing conclusions, or when a number looks odd. Takes no filters.',
    'Output: data = {tables:[...], channels:[{channel, last_scrape_at, items}], known_issues:[{id, title, status, live_count, detail}]}.',
    'Example: "Can I trust the YouTube numbers? What data problems should I know about?"',
  ].join(' '),
  input: z.object({}),
  output,
  examples: [{ question: 'What data problems should I know about?', input: {} }],
  async run(_input, ctx) {
    const tables = await run<Record<string, unknown>>(ctx.db, sql`
      select table_name, row_count::int as row_count, null_date::int as null_date, null_brand::int as null_brand,
        ${isoText(sql`min_date`)} as min_date, ${isoText(sql`max_date`)} as max_date, ${isoText(sql`last_loaded_at`)} as last_loaded_at,
        duplicate_rows::int as duplicate_rows
      from intel.v_data_health order by table_name`);
    const channels = await run<{ channel: string; last_scrape_at: string | null; items: number }>(ctx.db, sql`
      select channel, ${isoText(sql`max(scraped_at)`)} as last_scrape_at, count(distinct (source_table, source_row_id))::int as items
      from intel.v_signals group by channel order by channel`);
    const [s] = await run<Record<string, number>>(ctx.db, sql`
      select
        count(distinct (source_table, source_row_id)) filter (where channel = 'youtube' and date_source = 'parent_published')::int as yt_parent_dated,
        count(distinct (source_table, source_row_id)) filter (where channel = 'youtube' and date_source = 'none')::int as yt_undated,
        count(distinct source_row_id) filter (where source_table = 'reddit_comments' and brand_method = 'mention_facts')::int as rc_mf,
        count(distinct source_row_id) filter (where source_table = 'reddit_comments' and brand_method = 'keyword')::int as rc_kw,
        count(distinct source_row_id) filter (where source_table = 'reddit_comments' and brand_method = 'none')::int as rc_none,
        count(distinct (source_table, source_row_id)) filter (where is_crisis and occurred_at is null)::int as crisis_undated,
        count(distinct (source_table, source_row_id)) filter (where channel = 'product_review')::int as reviews,
        count(distinct (source_table, source_row_id)) filter (where sentiment_5 = 'unlabelled')::int as unlabelled,
        count(distinct (source_table, source_row_id))::int as items, count(*)::int as signals
      from intel.v_signals`);
    const [sw] = await run<Record<string, number>>(ctx.db, sql`
      select count(*)::int as total, count(*) filter (where not has_date)::int as no_posted, count(*) filter (where not has_from)::int as no_from,
             count(*) filter (where not has_to)::int as no_to from intel.v_switch_events`);
    const [rep] = await run<{ n: number }>(ctx.db, sql`select count(*)::int as n from intel.v_replies`);
    const mf = tables.find(t => t.table_name === 'mention_facts');
    const v = (o: Record<string, number> | undefined, k: string) => num(o?.[k]);
    const known_issues: z.infer<typeof zIssue>[] = [
      { id: 'product_review_channel', title: 'Product reviews are their own channel', status: 'handled', live_count: v(s, 'reviews'), detail: `${fmt(v(s, 'reviews'))} reviews reported as channel product_review, never folded into Reddit.` },
      { id: 'sentiment_levels', title: '5 sentiment levels + unlabelled', status: 'handled', live_count: v(s, 'unlabelled'), detail: `${fmt(v(s, 'unlabelled'))} items have no sentiment label; counted as 'unlabelled', excluded from % denominators.` },
      { id: 'mention_facts_duplicates', title: 'Duplicate rows in mention_facts', status: 'handled', live_count: num(mf?.duplicate_rows), detail: `${fmt(num(mf?.duplicate_rows))} exact duplicate rows in mention_facts are removed; engagement and type come from the raw tables.` },
      { id: 'youtube_dates', title: 'YouTube comments without a posted date', status: 'handled', live_count: v(s, 'yt_parent_dated') + v(s, 'yt_undated'), detail: `${fmt(v(s, 'yt_parent_dated'))} dated by their video publish date (date_source=parent_published); ${fmt(v(s, 'yt_undated'))} remain undated and are excluded from time-based views by default.` },
      { id: 'reddit_brands', title: 'Reddit comments without a stored brand', status: v(s, 'rc_none') ? 'open' : 'handled', live_count: v(s, 'rc_mf') + v(s, 'rc_kw') + v(s, 'rc_none'), detail: `Brand inferred from mention_facts for ${fmt(v(s, 'rc_mf'))}, from brand keywords for ${fmt(v(s, 'rc_kw'))}; ${fmt(v(s, 'rc_none'))} still unbranded (brand_source=inferred / none).` },
      { id: 'switch_gaps', title: 'Switch events with missing date or brand', status: 'open', live_count: v(sw, 'no_posted') + v(sw, 'no_from') + v(sw, 'no_to'), detail: `${fmt(v(sw, 'no_posted'))} of ${fmt(v(sw, 'total'))} have no posted date (detection date used), ${fmt(v(sw, 'no_from'))} no "from" brand, ${fmt(v(sw, 'no_to'))} no "to" brand.` },
      { id: 'undated_crises', title: 'Crisis items without a date', status: 'handled', live_count: v(s, 'crisis_undated'), detail: `${fmt(v(s, 'crisis_undated'))} crisis items have no date; never shown as recent, sorted last.` },
      { id: 'row_cap', title: '1,000-row API cap', status: 'handled', live_count: v(s, 'items'), detail: `All counts are computed in SQL; ${fmt(v(s, 'items'))} items / ${fmt(v(s, 'signals'))} brand signals are counted in full.` },
      { id: 'reply_detector', title: 'Brand reply detector', status: num(rep?.n) < 30 ? 'insufficient_data' : 'handled', live_count: num(rep?.n), detail: `${fmt(num(rep?.n))} brand replies recorded; too few for reliable response-time statistics.` },
    ];
    return {
      data: {
        tables: tables.map(t => ({
          table: String(t.table_name), rows: num(t.row_count), null_date: num(t.null_date),
          null_date_pct: num(t.row_count) ? Math.round((1000 * num(t.null_date)) / num(t.row_count)) / 10 : null,
          null_brand: num(t.null_brand), min_date: (t.min_date as string | null) ?? null, max_date: (t.max_date as string | null) ?? null,
          last_loaded_at: (t.last_loaded_at as string | null) ?? null, duplicate_rows: t.duplicate_rows == null ? null : num(t.duplicate_rows),
        })),
        channels: channels.map(c => ({ channel: c.channel, last_scrape_at: c.last_scrape_at, items: num(c.items) })),
        known_issues,
      },
      meta: meta({ filters: {}, rows_counted: v(s, 'items'), excluded: NO_EXCLUSIONS, notes: ['Full history; this tool takes no filters.'] }, ctx),
    };
  },
  summarise: r => {
    const open = r.data.known_issues.filter(i => i.status !== 'handled');
    const latest = r.data.channels.map(c => c.last_scrape_at).filter(Boolean).sort().at(-1);
    return `${r.data.tables.length} source tables; latest scrape ${latest?.slice(0, 16).replace('T', ' ') ?? 'n/a'} UTC. ` +
      `${open.length} open issue${open.length === 1 ? '' : 's'}: ${open.map(i => i.title).join('; ') || 'none'}.`;
  },
});
