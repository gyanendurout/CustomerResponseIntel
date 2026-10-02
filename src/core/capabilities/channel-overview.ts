import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { commonFilterShape, attributePredicate, brandPredicate, datePredicate } from '../filters';
import { and, isoText, run, sql } from '../sql';
import { fmt, num, prepare, zChannel } from './_shared';

const output = z.array(z.object({
  channel: zChannel,
  total: z.number(),
  dated: z.number(),
  undated: z.number(),
  date_from_parent: z.number(),
  first_date: z.string().nullable(),
  last_date: z.string().nullable(),
  last_scrape_at: z.string().nullable(),
}));

export const channelOverview = defineCapability({
  name: 'channel_overview',
  route: '/channels',
  title: 'Channel overview',
  description: [
    'Per normalised channel (instagram, youtube, reddit, tiktok, x, product_review): total items, how many are dated vs undated,',
    'how many dates come from the parent post/video (date_from_parent), first and last item date, and the last scrape time.',
    'Unlike other tools it covers FULL HISTORY unless from/to are given, because it describes data coverage.',
    'Use it to check coverage and freshness before trusting a trend; use data_health for known data problems.',
    'Items are counted once even if they mention several brands.',
    'Output: data = [{channel, total, dated, undated, date_from_parent, first_date, last_date, last_scrape_at}].',
    'Example: "How fresh is our YouTube data and how much of it has dates?"',
  ].join(' '),
  input: z.object(commonFilterShape),
  output,
  examples: [
    { question: 'How fresh is each channel and how much of it is dated?', input: {} },
    { question: 'JOOLA coverage by channel in August', input: { brands: ['JOOLA'], from: '2026-08-01', to: '2026-08-31' } },
  ],
  async run(input, ctx) {
    const explicitRange = Boolean(input.from || input.to);
    const { f, brandName: _b } = await prepare(input, ctx, false);
    const where = and([
      explicitRange ? datePredicate(f, { allowUndated: true }) : sql`true`,
      attributePredicate(f),
      brandPredicate(f, false),
    ]);
    const rows = await run<Record<string, unknown>>(ctx.db, sql`
      select channel,
        count(*)::int as total,
        count(*) filter (where occurred_at is not null)::int as dated,
        count(*) filter (where occurred_at is null)::int as undated,
        count(*) filter (where date_source = 'parent_published')::int as date_from_parent,
        ${isoText(sql`min(occurred_at)`)} as first_date,
        ${isoText(sql`max(occurred_at)`)} as last_date,
        ${isoText(sql`max(scraped_at)`)} as last_scrape_at
      from (select distinct on (source_table, source_row_id) * from intel.v_signals where ${where}
            order by source_table, source_row_id, brand_id nulls last) s
      group by channel order by total desc`);
    const data = rows.map(r => ({
      channel: r.channel as z.infer<typeof zChannel>,
      total: num(r.total), dated: num(r.dated), undated: num(r.undated), date_from_parent: num(r.date_from_parent),
      first_date: (r.first_date as string | null) ?? null, last_date: (r.last_date as string | null) ?? null,
      last_scrape_at: (r.last_scrape_at as string | null) ?? null,
    }));
    const notes: string[] = [];
    if (!explicitRange) notes.push('Full history (no date range given). Pass from/to to restrict.');
    for (const d of data) if (d.date_from_parent) notes.push(`${fmt(d.date_from_parent)} ${d.channel} items are dated by their parent post/video publish date (date_source=parent_published).`);
    const filters = explicitRange ? f.applied : { ...f.applied, from: null, to: null, defaults_used: ['full_history'] };
    return {
      data,
      meta: meta({
        filters, rows_counted: data.reduce((a, d) => a + d.total, 0),
        excluded: { undated: 0, unbranded: 0, unlabelled_sentiment: 0 }, notes, units: { total: 'items' },
      }, ctx),
    };
  },
  summarise: r => r.data.length
    ? r.data.map(d => `${d.channel}: ${fmt(d.total)} items (${fmt(d.undated)} undated), last scrape ${d.last_scrape_at?.slice(0, 10) ?? 'n/a'}`).join('; ')
    : 'No items match these filters.',
});
