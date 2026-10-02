import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { commonFilterShape, scopedSignals } from '../filters';
import { growthPct, periodExpr, periodsBetween, zeroFill } from '../periods';
import { run, sql } from '../sql';
import { fmt, num, periodLabel, prepare } from './_shared';

const SPLITS = ['brand', 'channel', 'none'] as const;

const output = z.object({
  points: z.array(z.object({ period: z.string(), series: z.string(), value: z.number(), growth_pct: z.number().nullable() })),
  totals: z.array(z.object({ label: z.string(), value: z.number() })),
});

export const volumeOverTime = defineCapability({
  name: 'volume_over_time',
  route: '/volume',
  title: 'Volume over time',
  description: [
    'Time series of mention volume, split by brand (default), channel, or none, with period-over-period growth % per series.',
    'Use for "how many mentions / is volume rising"; use share_of_voice for relative share, metrics for other measures.',
    'Split by brand counts one signal per brand mentioned; other splits count each item once. Periods are zero-filled.',
    'Output: data.points = [{period (YYYY-MM-DD start), series, value, growth_pct}], data.totals = [{label, value}].',
    'Example: "How did JOOLA mention volume trend month by month since May?"',
  ].join(' '),
  input: z.object({ ...commonFilterShape, split_by: z.enum(SPLITS).optional().describe('Series dimension. Default brand.') }),
  output,
  examples: [
    { question: 'Monthly JOOLA vs Selkirk mention volume since May', input: { brands: ['JOOLA', 'Selkirk'], from: '2026-05-01', granularity: 'month' } },
    { question: 'Daily volume by channel over the last 30 days', input: { split_by: 'channel', from: '2026-08-30', to: '2026-09-28' } },
  ],
  async run(input, ctx) {
    const split = input.split_by ?? 'brand';
    const perBrand = split === 'brand';
    const { f, x, notes, brandName } = await prepare(input, ctx, perBrand);
    const seriesCol = split === 'brand' ? sql`brand_id::text` : split === 'channel' ? sql`channel` : sql`'all'`;
    const rows = await run<{ period: string; series: string; n: number }>(ctx.db, sql`
      select ${periodExpr(sql.ref('occurred_at'), f.granularity)} as period, ${seriesCol} as series, count(*)::int as n
      from ${scopedSignals(f, perBrand, { allowUndated: false })} s
      group by 1, 2`);
    const label = (s: string) => (split === 'brand' ? brandName(s) : s);
    const periods = periodsBetween(f.from, f.to, f.granularity);
    const seriesKeys = [...new Set(rows.map(r => r.series))];
    const filled = zeroFill(rows.map(r => ({ period: r.period, series: r.series, value: num(r.n) })), periods, seriesKeys);
    const points = filled.map((p, i) => {
      const prev = i > 0 && filled[i - 1]!.series === p.series ? filled[i - 1]!.value : undefined;
      return { period: p.period, series: label(p.series), value: p.value, growth_pct: growthPct(prev, p.value) };
    });
    const totalsMap = new Map<string, number>();
    for (const p of points) totalsMap.set(p.series, (totalsMap.get(p.series) ?? 0) + p.value);
    const totals = [...totalsMap].map(([l, v]) => ({ label: l, value: v })).sort((a, b) => b.value - a.value);
    if (f.includeUndated) notes.push('include_undated has no effect on a time series: undated items cannot be placed in a period.');
    return {
      data: { points, totals },
      meta: meta({
        filters: { ...f.applied, split_by: split }, rows_counted: totals.reduce((a, t) => a + t.value, 0), excluded: x.excluded, notes,
        units: { value: perBrand ? 'signals (one per brand mentioned)' : 'items', growth_pct: '% vs previous period' },
        series: totals.map(t => t.label), granularity: f.granularity,
      }, ctx),
    };
  },
  summarise: r => {
    const g = (r.meta.granularity as 'day' | 'week' | 'month') ?? 'month';
    const lines = r.data.totals.slice(0, 3).map(t => {
      const pts = r.data.points.filter(p => p.series === t.label);
      const last = pts.at(-1);
      if (!last) return `${t.label}: ${fmt(t.value)}`;
      const gr = last.growth_pct == null ? '' : ` (${last.growth_pct >= 0 ? '+' : ''}${last.growth_pct}% vs previous)`;
      return `${t.label}: ${fmt(last.value)} in ${periodLabel(last.period, g)}${gr}; ${fmt(t.value)} total`;
    });
    return lines.length ? lines.join('. ') + '.' : 'No mentions match these filters.';
  },
});
