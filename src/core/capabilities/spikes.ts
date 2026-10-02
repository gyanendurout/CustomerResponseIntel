import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { commonFilterShape, scopedSignals } from '../filters';
import { periodExpr, periodsBetween } from '../periods';
import { run, sql } from '../sql';
import { fmt, num, periodLabel, prepare } from './_shared';

const METRICS = ['volume', 'negative_pct'] as const;
export const SPIKE_DEFAULTS = { window: 8, k: 2, minBaseline: 4, minVolume: 10 } as const;

export interface SeriesValue { period: string; value: number | null; volume: number }
export interface SpikeFlag { period: string; value: number; baseline_mean: number; baseline_sd: number; z: number; threshold: number }

/**
 * Rolling mean + k·sd over the PREVIOUS `window` periods (the period itself is excluded). A period is a spike when
 * value > mean + k·sd and at least `minBaseline` baseline periods exist. sd = population standard deviation;
 * when sd = 0 the threshold is mean + a minimal step (value must strictly exceed the flat baseline).
 * For negative_pct, periods with volume < minVolume are skipped (value null) and never used as baseline.
 */
export function findSpikes(values: SeriesValue[], window: number, k: number, minBaseline: number): SpikeFlag[] {
  const flags: SpikeFlag[] = [];
  for (let i = 0; i < values.length; i++) {
    const cur = values[i]!;
    if (cur.value == null) continue;
    const base = values.slice(Math.max(0, i - window), i).map(v => v.value).filter((v): v is number => v != null);
    if (base.length < minBaseline) continue;
    const mean = base.reduce((a, b) => a + b, 0) / base.length;
    const sd = Math.sqrt(base.reduce((a, b) => a + (b - mean) ** 2, 0) / base.length);
    const threshold = mean + k * sd;
    if (cur.value > threshold && cur.value > mean) {
      flags.push({
        period: cur.period, value: cur.value, baseline_mean: Math.round(mean * 10) / 10, baseline_sd: Math.round(sd * 10) / 10,
        z: sd > 0 ? Math.round(((cur.value - mean) / sd) * 10) / 10 : Infinity, threshold: Math.round(threshold * 10) / 10,
      });
    }
  }
  return flags.map(f => ({ ...f, z: Number.isFinite(f.z) ? f.z : 99 }));
}

const output = z.object({
  spikes: z.array(z.object({ brand: z.string(), period: z.string(), value: z.number(), baseline_mean: z.number(), baseline_sd: z.number(), z: z.number(), threshold: z.number() })),
  series: z.array(z.object({ period: z.string(), series: z.string(), value: z.number().nullable(), volume: z.number() })),
});

export const detectSpikes = defineCapability({
  name: 'detect_spikes',
  route: '/spikes',
  title: 'Detect spikes',
  description: [
    "Finds periods where a brand's volume or negative % jumped above its own rolling baseline.",
    'Method: for each period, baseline = the previous `window` periods (default 8, the period itself excluded);',
    'spike when value > mean + k·sd (default k=2, population sd), needing at least 4 baseline periods.',
    'negative_pct ignores periods with fewer than min_volume labelled items (default 10). Default granularity is week.',
    'Use for "anything unusual?"; use crisis_monitor for flagged crises.',
    'Output: data.spikes = [{brand, period, value, baseline_mean, baseline_sd, z, threshold}], data.series = [{period, series, value, volume}].',
    'Example: "Were there any unusual spikes in negative sentiment for JOOLA this summer?"',
  ].join(' '),
  input: z.object({
    ...commonFilterShape,
    metric: z.enum(METRICS).optional().describe('volume (default) or negative_pct.'),
    window: z.number().int().min(3).max(26).optional().describe('Baseline periods. Default 8.'),
    k: z.number().min(1).max(5).optional().describe('Std-dev multiplier. Default 2.'),
    min_volume: z.number().int().min(1).max(10_000).optional().describe('negative_pct only: minimum labelled items per period. Default 10.'),
  }),
  output,
  examples: [
    { question: 'Unusual weekly negative-sentiment spikes for JOOLA since May', input: { brands: ['JOOLA'], metric: 'negative_pct', from: '2026-05-01' } },
    { question: 'Volume spikes for any brand', input: {} },
  ],
  async run(input, ctx) {
    const metric = input.metric ?? 'volume';
    const window = input.window ?? SPIKE_DEFAULTS.window;
    const k = input.k ?? SPIKE_DEFAULTS.k;
    const minVolume = input.min_volume ?? SPIKE_DEFAULTS.minVolume;
    const { f: base, x, notes, brandName } = await prepare(input, ctx, true);
    const f = { ...base, granularity: input.granularity ?? 'week' as const };
    const rows = await run<{ period: string; brand_id: string; n: number; labelled: number; neg: number }>(ctx.db, sql`
      select ${periodExpr(sql.ref('occurred_at'), f.granularity)} as period, brand_id::text as brand_id, count(*)::int as n,
        count(*) filter (where sentiment_5 <> 'unlabelled')::int as labelled,
        count(*) filter (where sentiment_3 = 'negative')::int as neg
      from ${scopedSignals(f, true, { allowUndated: false })} s group by 1, 2`);
    const periods = periodsBetween(f.from, f.to, f.granularity);
    const byKey = new Map(rows.map(r => [`${r.period}|${r.brand_id}`, r]));
    const brands = [...new Set(rows.map(r => r.brand_id))];
    const series: z.infer<typeof output>['series'] = [];
    const spikes: z.infer<typeof output>['spikes'] = [];
    for (const b of brands) {
      const values: SeriesValue[] = periods.map(p => {
        const r = byKey.get(`${p}|${b}`);
        const n = num(r?.n), labelled = num(r?.labelled), neg = num(r?.neg);
        if (metric === 'volume') return { period: p, value: n, volume: n };
        return { period: p, value: labelled >= minVolume ? Math.round((1000 * neg) / labelled) / 10 : null, volume: labelled };
      });
      for (const v of values) series.push({ period: v.period, series: brandName(b), value: v.value, volume: v.volume });
      for (const s of findSpikes(values, window, k, SPIKE_DEFAULTS.minBaseline)) spikes.push({ brand: brandName(b), ...s });
    }
    spikes.sort((a, b) => b.z - a.z);
    if (periods.length <= SPIKE_DEFAULTS.minBaseline) notes.push(`Only ${periods.length} ${f.granularity} periods in range; at least ${SPIKE_DEFAULTS.minBaseline + 1} are needed. Widen the range or use a finer granularity.`);
    if (f.granularity === 'week') notes.push('Weekly periods start Monday; the first and last weeks may be partial.');
    return {
      data: { spikes, series },
      meta: meta({
        filters: { ...f.applied, granularity: f.granularity, metric, window, k, min_volume: minVolume },
        rows_counted: rows.reduce((a, r) => a + num(r.n), 0), excluded: x.excluded, notes,
        method: `value > mean + ${k}·sd of the previous ${window} ${f.granularity}s (min ${SPIKE_DEFAULTS.minBaseline} baseline periods)`,
        units: { value: metric === 'volume' ? 'signals per period' : '% negative of labelled items' }, granularity: f.granularity,
      }, ctx),
    };
  },
  summarise: r => {
    const g = (r.meta.granularity as 'day' | 'week' | 'month') ?? 'week';
    if (!r.data.spikes.length) return 'No spikes above the rolling baseline in this range.';
    return `${r.data.spikes.length} spike${r.data.spikes.length === 1 ? '' : 's'}. ` + r.data.spikes.slice(0, 3)
      .map(s => `${s.brand} ${periodLabel(s.period, g)}: ${fmt(s.value)} vs baseline ${fmt(s.baseline_mean)} (z=${s.z})`).join('; ') + '.';
  },
});
