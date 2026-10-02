import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { attributePredicate, brandPredicate, commonFilterShape, datePredicate, scopedSignals } from '../filters';
import { periodExpr, periodsBetween, zeroFill } from '../periods';
import { and, run, sql } from '../sql';
import { fetchItems, fmt, itemRef, num, periodLabel, prepare, toItem, zPoint, zSignalItem, type ItemKey } from './_shared';

const SPLITS = ['none', 'brand', 'channel'] as const;
const RECENT_LIMIT = 10;

const output = z.object({ points: z.array(zPoint), recent: z.array(zSignalItem), total: z.number() });

export const crisisMonitor = defineCapability({
  name: 'crisis_monitor',
  route: '/crises',
  title: 'Crisis monitor',
  description: [
    'Crisis-flagged items per period (optionally split by brand or channel) plus the 10 most recent DATED crisis items.',
    'Undated crisis items are never shown as recent; their count is reported in meta.excluded/notes.',
    'Use for "are there any crises / what are the latest"; use detect_spikes for unusual negativity, top_complaints for themes.',
    'Output: data.points = [{period, series, value}], data.recent = [item], data.total.',
    'Example: "Any JOOLA crises in the last two weeks? Show the latest ones."',
  ].join(' '),
  input: z.object({ ...commonFilterShape, split_by: z.enum(SPLITS).optional().describe('Default none.') }),
  output,
  examples: [
    { question: 'Latest JOOLA crises', input: { brands: ['JOOLA'] } },
    { question: 'Weekly crisis count by channel', input: { split_by: 'channel', granularity: 'week' } },
  ],
  async run(input, ctx) {
    const split = input.split_by ?? 'none';
    const perBrand = split === 'brand';
    const { f: base, x, notes, brandName } = await prepare({ ...input, crisis_only: true }, ctx, perBrand);
    const f = { ...base, crisisOnly: true };
    const seriesCol = split === 'brand' ? sql`brand_id::text` : split === 'channel' ? sql`channel` : sql`'crisis'`;
    const rows = await run<{ period: string; series: string; n: number }>(ctx.db, sql`
      select ${periodExpr(sql.ref('occurred_at'), f.granularity)} as period, ${seriesCol} as series, count(*)::int as n
      from ${scopedSignals(f, perBrand, { allowUndated: false })} s group by 1, 2`);
    const periods = periodsBetween(f.from, f.to, f.granularity);
    const series = [...new Set(rows.map(r => r.series))];
    const label = (s: string) => (split === 'brand' ? brandName(s) : s);
    const points = zeroFill(rows.map(r => ({ period: r.period, series: r.series, value: num(r.n) })), periods, series)
      .map(p => ({ ...p, series: label(p.series) }));
    const recentWhere = and([datePredicate(f, { allowUndated: false }), attributePredicate(f), brandPredicate(f, false)]);
    // Rank on cheap columns, then load masked text for the winners only (occurred_at is per item, not per brand).
    const recentKeys = await run<ItemKey>(ctx.db, sql`
      select source_table, source_row_id::text as source_row_id from intel.v_signals where ${recentWhere}
      group by source_table, source_row_id
      order by max(occurred_at) desc, md5(source_table || ':' || source_row_id::text) desc limit ${RECENT_LIMIT}`);
    const recentItems = await fetchItems(ctx, recentKeys);
    const recent = recentKeys.flatMap(k => recentItems.get(itemRef(k)) ?? []);
    const total = points.reduce((a, p) => a + (p.value ?? 0), 0);
    return {
      data: { points, recent: recent.map(r => toItem(r, brandName)), total },
      meta: meta({
        filters: { ...f.applied, crisis_only: true, split_by: split }, rows_counted: total, excluded: x.excluded, notes,
        units: { value: perBrand ? 'crisis signals' : 'crisis items' }, series: series.map(label), granularity: f.granularity,
      }, ctx),
    };
  },
  summarise: r => {
    const g = (r.meta.granularity as 'day' | 'week' | 'month') ?? 'month';
    if (!r.data.total) return `No dated crisis items in this range${r.meta.excluded.undated ? ` (${fmt(r.meta.excluded.undated)} undated crisis items not shown)` : ''}.`;
    const latest = r.data.recent[0];
    const peak = [...r.data.points].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0]!;
    return `${fmt(r.data.total)} crisis items; peak ${fmt(peak.value ?? 0)} in ${periodLabel(peak.period, g)}.` +
      (latest ? ` Latest: ${latest.occurred_at?.slice(0, 10)} on ${latest.channel}${latest.brands.length ? ' (' + latest.brands.join('/') + ')' : ''}.` : '');
  },
});
