import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { commonFilterShape, scopedSignals } from '../filters';
import { periodExpr, periodsBetween } from '../periods';
import { run, sql } from '../sql';
import { num, periodLabel, pct, prepare } from './_shared';

const output = z.object({
  points: z.array(z.object({ period: z.string(), series: z.string(), value: z.number().nullable(), count: z.number() })),
  overall: z.array(z.object({ label: z.string(), value: z.number().nullable(), count: z.number() })),
});

export const shareOfVoice = defineCapability({
  name: 'share_of_voice',
  route: '/share-of-voice',
  title: 'Share of voice',
  description: [
    "Each brand's percentage of all brand mentions per period, plus the overall share for the whole range.",
    'If brands are given, shares are computed among THOSE brands only (they sum to 100%).',
    'Use for relative position vs competitors; use volume_over_time for absolute counts.',
    'Output: data.points = [{period, series (brand), value (%), count}], data.overall = [{label, value (%), count}].',
    'Example: "What was JOOLA\'s share of voice vs all competitors each month?"',
  ].join(' '),
  input: z.object(commonFilterShape),
  output,
  examples: [
    { question: "JOOLA's monthly share of voice against all competitors", input: { granularity: 'month' } },
    { question: 'Share of voice on Reddit only', input: { channels: ['reddit'] } },
  ],
  async run(input, ctx) {
    const { f, x, notes, brandName } = await prepare(input, ctx, true);
    const rows = await run<{ period: string; brand_id: string; n: number }>(ctx.db, sql`
      select ${periodExpr(sql.ref('occurred_at'), f.granularity)} as period, brand_id::text as brand_id, count(*)::int as n
      from ${scopedSignals(f, true, { allowUndated: false })} s group by 1, 2`);
    const periods = periodsBetween(f.from, f.to, f.granularity);
    const brands = [...new Set(rows.map(r => r.brand_id))];
    const byKey = new Map(rows.map(r => [`${r.period}|${r.brand_id}`, num(r.n)]));
    const periodTotal = new Map<string, number>();
    for (const r of rows) periodTotal.set(r.period, (periodTotal.get(r.period) ?? 0) + num(r.n));
    const points = brands.flatMap(b => periods.map(p => {
      const count = byKey.get(`${p}|${b}`) ?? 0;
      return { period: p, series: brandName(b), value: pct(count, periodTotal.get(p) ?? 0), count };
    }));
    const grand = rows.reduce((a, r) => a + num(r.n), 0);
    const overall = brands.map(b => {
      const count = rows.filter(r => r.brand_id === b).reduce((a, r) => a + num(r.n), 0);
      return { label: brandName(b), value: pct(count, grand), count };
    }).sort((a, b) => b.count - a.count);
    if (f.brandIds) notes.push('Shares are among the selected brands only.');
    notes.push('A post naming several brands counts once for each brand.');
    return {
      data: { points, overall },
      meta: meta({
        filters: f.applied, rows_counted: grand, excluded: x.excluded, notes,
        units: { value: '% of brand mentions in the period', count: 'signals' }, series: overall.map(o => o.label), granularity: f.granularity,
      }, ctx),
    };
  },
  summarise: r => {
    if (!r.data.overall.length) return 'No brand mentions match these filters.';
    const g = (r.meta.granularity as 'day' | 'week' | 'month') ?? 'month';
    const top = r.data.overall.slice(0, 4).map(o => `${o.label} ${o.value}%`).join(', ');
    const joola = r.data.points.filter(p => p.series === 'JOOLA' && p.value != null).at(-1);
    return `Overall share: ${top}.` + (joola ? ` JOOLA in ${periodLabel(joola.period, g)}: ${joola.value}%.` : '');
  },
});
