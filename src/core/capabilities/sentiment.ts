import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { commonFilterShape, scopedSignals } from '../filters';
import { SENTIMENT_3, SENTIMENT_5 } from '../normalise';
import { periodExpr } from '../periods';
import { run, sql } from '../sql';
import { fmt, num, pct, prepare } from './_shared';

const GROUPS = ['brand', 'channel', 'period', 'none'] as const;

const zLevelRow = z.object({ group: z.string(), label: z.string(), value: z.number(), pct: z.number().nullable() });
const output = z.object({
  five_level: z.array(zLevelRow),
  three_level: z.array(zLevelRow),
  groups: z.array(z.object({ group: z.string(), total: z.number(), labelled: z.number(), negative_pct: z.number().nullable(), positive_pct: z.number().nullable() })),
});

export const sentimentBreakdown = defineCapability({
  name: 'sentiment_breakdown',
  route: '/sentiment',
  title: 'Sentiment breakdown',
  description: [
    'Counts and percentages of the 5 sentiment levels (very_negative … very_positive) and the 3-level rollup',
    '(very_* folded into its parent), grouped by brand (default), channel, period, or none. Unlabelled items are',
    'counted separately and excluded from percentage denominators.',
    'Use for "how negative is X"; use metrics for negative % over time with custom grouping, detect_spikes for anomalies.',
    'Output: data.five_level/three_level = [{group, label (level), value (count), pct}], data.groups = [{group, total, labelled, negative_pct, positive_pct}].',
    'Example: "How does JOOLA sentiment compare with Selkirk on Instagram?"',
  ].join(' '),
  input: z.object({ ...commonFilterShape, group_by: z.enum(GROUPS).optional().describe('Default brand.') }),
  output,
  examples: [
    { question: 'Sentiment by brand over the last 90 days', input: {} },
    { question: 'JOOLA sentiment by channel', input: { brands: ['JOOLA'], group_by: 'channel' } },
  ],
  async run(input, ctx) {
    const groupBy = input.group_by ?? 'brand';
    const perBrand = groupBy === 'brand';
    const { f, x, notes, brandName } = await prepare(input, ctx, perBrand);
    const groupCol = groupBy === 'brand' ? sql`brand_id::text`
      : groupBy === 'channel' ? sql`channel`
      : groupBy === 'period' ? periodExpr(sql.ref('occurred_at'), f.granularity) : sql`'all'`;
    const allowUndated = groupBy !== 'period';
    const rows = await run<{ g: string | null; s5: string; n: number }>(ctx.db, sql`
      select ${groupCol} as g, sentiment_5 as s5, count(*)::int as n
      from ${scopedSignals(f, perBrand, { allowUndated: allowUndated && f.includeUndated })} s group by 1, 2`);
    const label = (g: string | null) => (g == null ? 'undated' : groupBy === 'brand' ? brandName(g) : g);
    const groups = [...new Set(rows.map(r => r.g))];
    const five: z.infer<typeof zLevelRow>[] = [];
    const three: z.infer<typeof zLevelRow>[] = [];
    const summary: z.infer<typeof output>['groups'] = [];
    for (const g of groups) {
      const counts = new Map(rows.filter(r => r.g === g).map(r => [r.s5, num(r.n)]));
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      const labelled = total - (counts.get('unlabelled') ?? 0);
      for (const level of SENTIMENT_5) {
        const v = counts.get(level) ?? 0;
        five.push({ group: label(g), label: level, value: v, pct: level === 'unlabelled' ? null : pct(v, labelled) });
      }
      const neg = (counts.get('very_negative') ?? 0) + (counts.get('negative') ?? 0);
      const pos = (counts.get('very_positive') ?? 0) + (counts.get('positive') ?? 0);
      const r3: Record<string, number> = { negative: neg, neutral: counts.get('neutral') ?? 0, positive: pos, unlabelled: counts.get('unlabelled') ?? 0 };
      for (const level of SENTIMENT_3) three.push({ group: label(g), label: level, value: r3[level]!, pct: level === 'unlabelled' ? null : pct(r3[level]!, labelled) });
      summary.push({ group: label(g), total, labelled, negative_pct: pct(neg, labelled), positive_pct: pct(pos, labelled) });
    }
    summary.sort((a, b) => b.total - a.total);
    return {
      data: { five_level: five, three_level: three, groups: summary },
      meta: meta({
        filters: { ...f.applied, group_by: groupBy }, rows_counted: summary.reduce((a, s) => a + s.total, 0), excluded: x.excluded, notes,
        units: { value: perBrand ? 'signals' : 'items', pct: '% of labelled items in the group' }, series: summary.map(s => s.group),
      }, ctx),
    };
  },
  summarise: r => r.data.groups.length
    ? r.data.groups.slice(0, 4).map(g => `${g.group}: ${g.negative_pct ?? 'n/a'}% negative, ${g.positive_pct ?? 'n/a'}% positive (${fmt(g.labelled)} labelled)`).join('; ') + '.'
    : 'No items match these filters.',
});
