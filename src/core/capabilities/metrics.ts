import { z } from 'zod';
import { defineCapability, meta, NO_EXCLUSIONS } from '../capability';
import { AppError } from '../errors';
import { commonFilterShape, scopedSignals, resolveFilters, type Filters } from '../filters';
import { periodExpr } from '../periods';
import { run, sql, type Sql } from '../sql';
import { topicWhere } from './topics';
import { fmt, num, periodLabel, prepare } from './_shared';
import type { Ctx } from '../context';

export const MEASURES = ['count', 'negative_pct', 'positive_pct', 'crisis_count', 'avg_engagement', 'total_engagement'] as const;
export const DIMENSIONS = ['period', 'brand', 'channel', 'sentiment_5', 'sentiment_3', 'signal_type', 'topic'] as const;
type Measure = (typeof MEASURES)[number];
type Dimension = (typeof DIMENSIONS)[number];
export const MAX_GROUPS = 500;

const MEASURE_SQL: Record<Measure, Sql> = {
  count: sql`count(*)::float8`,
  negative_pct: sql`round((100.0 * count(*) filter (where sentiment_3 = 'negative') / nullif(count(*) filter (where sentiment_5 <> 'unlabelled'), 0))::numeric, 1)::float8`,
  positive_pct: sql`round((100.0 * count(*) filter (where sentiment_3 = 'positive') / nullif(count(*) filter (where sentiment_5 <> 'unlabelled'), 0))::numeric, 1)::float8`,
  crisis_count: sql`count(*) filter (where is_crisis)::float8`,
  avg_engagement: sql`round(avg(engagement)::numeric, 2)::float8`,
  total_engagement: sql`sum(engagement)::float8`,
};
const MEASURE_UNIT: Record<Measure, string> = {
  count: 'items', negative_pct: '% negative of labelled items', positive_pct: '% positive of labelled items',
  crisis_count: 'crisis items', avg_engagement: 'engagement per item', total_engagement: 'engagement (likes/upvotes/helpful votes)',
};

function dimSql(d: Exclude<Dimension, 'topic'>, f: Filters): Sql {
  switch (d) {
    case 'period': return periodExpr(sql.ref('occurred_at'), f.granularity);
    case 'brand': return sql`brand_id::text`;
    case 'channel': return sql`channel`;
    case 'sentiment_5': return sql`sentiment_5`;
    case 'sentiment_3': return sql`sentiment_3`;
    case 'signal_type': return sql`signal_type`;
  }
}

const output = z.object({
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  points: z.array(z.object({ period: z.string(), series: z.string(), value: z.number().nullable() })).optional(),
  capped: z.boolean(),
});

const metricsInput = z.object({
  ...commonFilterShape,
  measure: z.enum(MEASURES).describe('What to compute.'),
  group_by: z.array(z.enum(DIMENSIONS)).min(1).max(2).describe('1–2 dimensions.'),
});
type MetricsInput = z.output<typeof metricsInput>;

export const metrics = defineCapability({
  name: 'metrics',
  route: '/metrics',
  title: 'Flexible metrics',
  description: [
    'The flexible tool for questions no other tool covers. Pick ONE measure',
    `(${MEASURES.join(', ')}) and 1–2 group_by dimensions (${DIMENSIONS.join(', ')}), plus any common filters.`,
    'Whitelisted only; there is no free SQL. negative_pct/positive_pct use labelled items as the denominator.',
    'group_by topic reads the weekly topic tracker and supports only measure=count with period/brand/channel.',
    `Results are capped at ${MAX_GROUPS} groups (meta.notes says when).`,
    'Output: data.rows = [{<dim>: value, ..., value, n}] (n = items in the group); data.points = [{period, series, value}] when period is a dimension.',
    'Example: "Weekly negative % for JOOLA vs Selkirk on Reddit since May" → measure=negative_pct, group_by=[period, brand], granularity=week, brands=[JOOLA, Selkirk], channels=[reddit], from=2026-05-01.',
  ].join(' '),
  input: metricsInput,
  output,
  examples: [
    {
      question: 'Weekly negative % for JOOLA vs Selkirk on Reddit since May',
      input: { measure: 'negative_pct', group_by: ['period', 'brand'], granularity: 'week', brands: ['JOOLA', 'Selkirk'], channels: ['reddit'], from: '2026-05-01' },
    },
    { question: 'Average engagement by channel and signal type', input: { measure: 'avg_engagement', group_by: ['channel', 'signal_type'] } },
  ],
  async run(input, ctx) {
    const dims = [...new Set(input.group_by)] as Dimension[];
    return dims.includes('topic') ? runTopic(input, dims, ctx) : runSignals(input, dims, ctx);
  },
  summarise: r => {
    const rows = r.data.rows;
    if (!rows.length) return 'No data for this combination.';
    const g = (r.meta.granularity as 'day' | 'week' | 'month') ?? 'month';
    const measure = String(r.meta.measure);
    const dims = (r.meta.group_by as string[]) ?? [];
    const sample = rows.slice(-3).map(row => dims.map(d => (d === 'period' ? periodLabel(String(row[d]), g) : String(row[d]))).join(' / ') + `: ${row.value ?? 'n/a'}`);
    return `${measure} by ${dims.join(' × ')}: ${fmt(rows.length)} groups${r.data.capped ? ' (capped)' : ''}. Latest: ${sample.join('; ')}.`;
  },
});


async function runSignals(input: MetricsInput, dims: Dimension[], ctx: Ctx) {
  const perBrand = dims.includes('brand');
  const { f, x, notes, brandName } = await prepare(input, ctx, perBrand);
  const usesPeriod = dims.includes('period');
  const dimCols = dims.map(d => sql`${dimSql(d as Exclude<Dimension, 'topic'>, f)} as ${sql.ref(d)}`);
  const groupIdx = dims.map((_, i) => sql.lit(i + 1));
  const rows = await run<Record<string, unknown>>(ctx.db, sql`
    select ${sql.join(dimCols)}, ${MEASURE_SQL[input.measure]} as value, count(*)::int as n
    from ${scopedSignals(f, perBrand, { allowUndated: !usesPeriod && f.includeUndated })} s
    group by ${sql.join(groupIdx)} order by ${sql.join(groupIdx)} limit ${MAX_GROUPS + 1}`);
  const capped = rows.length > MAX_GROUPS;
  const out = rows.slice(0, MAX_GROUPS).map(r => {
    const o: Record<string, string | number | null> = {};
    for (const d of dims) o[d] = d === 'brand' ? brandName(r[d] as string) : (r[d] as string);
    o.value = r.value == null ? null : Number(r.value);
    o.n = num(r.n);
    return o;
  });
  if (capped) notes.push(`Result capped at ${MAX_GROUPS} groups; narrow the filters or use a coarser granularity.`);
  if (input.measure.includes('engagement') && (!f.channels || f.channels.length > 1)) {
    notes.push('Engagement mixes units across channels (likes, upvotes, review helpful votes); filter to one channel for a like-for-like figure.');
  }
  if (usesPeriod && f.includeUndated) notes.push('include_undated has no effect when grouping by period.');
  return {
    data: { rows: out, points: usesPeriod ? toPoints(out, dims) : undefined, capped },
    meta: meta({
      filters: { ...f.applied, measure: input.measure, group_by: dims }, rows_counted: out.reduce((a, r) => a + Number(r.n), 0),
      excluded: x.excluded, notes, units: { value: MEASURE_UNIT[input.measure], n: perBrand ? 'signals' : 'items' },
      measure: input.measure, group_by: dims, granularity: f.granularity,
    }, ctx),
  };
}

async function runTopic(input: MetricsInput, dims: Dimension[], ctx: Ctx) {
  if (input.measure !== 'count') {
    throw new AppError('UNSUPPORTED_COMBINATION', `group_by topic only supports measure=count (got ${input.measure}). Topic data has no sentiment, crisis or engagement.`);
  }
  const bad = dims.filter(d => !['topic', 'period', 'brand', 'channel'].includes(d));
  if (bad.length) throw new AppError('UNSUPPORTED_COMBINATION', `group_by topic can be combined only with period, brand or channel (got ${bad.join(', ')}).`);
  if (input.sentiments?.length || input.crisis_only) {
    throw new AppError('UNSUPPORTED_COMBINATION', 'Topic data has no sentiment or crisis flags; remove sentiments / crisis_only.');
  }
  const f = await resolveFilters(input, ctx);
  const brands = await ctx.brands();
  const names = new Map(brands.map(b => [b.brand_id, b.name]));
  const colFor = (d: Dimension): Sql =>
    d === 'topic' ? sql`topic` : d === 'brand' ? sql`brand_id::text` : d === 'channel' ? sql`channel`
      : sql`to_char(date_trunc(${sql.lit(f.granularity === 'day' ? 'week' : f.granularity)}, week_start), 'YYYY-MM-DD')`;
  const dimCols = dims.map(d => sql`${colFor(d)} as ${sql.ref(d)}`);
  const groupIdx = dims.map((_, i) => sql.lit(i + 1));
  const rows = await run<Record<string, unknown>>(ctx.db, sql`
    select ${sql.join(dimCols)}, sum(mention_count)::float8 as value, count(*)::int as n
    from intel.v_topic_weekly where ${topicWhere(f)}
    group by ${sql.join(groupIdx)} order by ${dims.includes('period') ? sql`1` : sql`${sql.lit(dims.length + 1)} desc`} limit ${MAX_GROUPS + 1}`);
  const capped = rows.length > MAX_GROUPS;
  const out = rows.slice(0, MAX_GROUPS).map(r => {
    const o: Record<string, string | number | null> = {};
    for (const d of dims) o[d] = d === 'brand' ? names.get(r[d] as string) ?? (r[d] as string) : (r[d] as string);
    o.value = Number(r.value);
    o.n = num(r.n);
    return o;
  });
  const notes = ['Topic counts come from the weekly topic tracker (weeks start Monday).'];
  if (f.granularity === 'day') notes.push('Topic data is weekly; granularity day was treated as week.');
  if (capped) notes.push(`Result capped at ${MAX_GROUPS} groups; add filters (brands, channels) or a shorter range.`);
  return {
    data: { rows: out, points: dims.includes('period') ? toPoints(out, dims) : undefined, capped },
    meta: meta({
      filters: { ...f.applied, measure: 'count', group_by: dims }, rows_counted: out.reduce((a, r) => a + Number(r.value), 0),
      excluded: NO_EXCLUSIONS, notes, units: { value: 'topic mentions', n: 'topic-week rows' },
      measure: 'count', group_by: dims, granularity: f.granularity === 'day' ? 'week' : f.granularity,
    }, ctx),
  };
}

function toPoints(rows: Array<Record<string, string | number | null>>, dims: Dimension[]) {
  const other = dims.find(d => d !== 'period');
  return rows.map(r => ({ period: String(r.period), series: other ? String(r[other]) : 'value', value: r.value == null ? null : Number(r.value) }));
}
