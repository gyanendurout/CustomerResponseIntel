import { z } from 'zod';
import { defineCapability, meta, NO_EXCLUSIONS } from '../capability';
import { commonFilterShape, resolveFilters } from '../filters';
import { resolveBrands } from '../normalise';
import { periodExpr } from '../periods';
import { and, run, sql, type Sql } from '../sql';
import { fmt, num } from './_shared';
import { AppError } from '../errors';
import { periodsBetween } from '../periods';

const output = z.object({
  focus_brand: z.string(),
  inflow: z.number(),
  outflow: z.number(),
  net: z.number(),
  matrix: z.array(z.object({ from: z.string(), to: z.string(), value: z.number() })),
  trend: z.array(z.object({ period: z.string(), series: z.enum(['inflow', 'outflow']), value: z.number() })),
  gaps: z.object({
    in_range: z.number(), date_from_detection: z.number(), unknown_from: z.number(), unknown_to: z.number(),
    all_time: z.object({ total: z.number(), no_posted_date: z.number(), no_date_at_all: z.number(), no_from: z.number(), no_to: z.number() }),
  }),
});

const { brands: _omitBrands, sentiments: _omitSentiments, crisis_only: _omitCrisis, ...switchFilterShape } = commonFilterShape;

export const brandSwitching = defineCapability({
  name: 'brand_switching',
  route: '/switches',
  title: 'Brand switching',
  description: [
    'People saying they switched from one brand to another. For a focus brand (default JOOLA): inflow (switched TO it),',
    'outflow (switched FROM it), net, a full from→to matrix, a monthly inflow/outflow trend, and data-gap counts.',
    'Event date = posted date, else detection date (date_from_detection counts those). Events with an unknown side',
    'are shown as "Unknown" in the matrix and counted in gaps; they never silently disappear.',
    'Output: data = {focus_brand, inflow, outflow, net, matrix:[{from,to,value}], trend:[{period, series, value}], gaps}.',
    'Example: "Are more people switching to JOOLA or away from it, and to whom?"',
  ].join(' '),
  input: z.object({
    ...switchFilterShape,
    brand: z.string().min(1).max(60).optional().describe('Focus brand (name/slug/id). Default JOOLA.'),
  }),
  output,
  examples: [
    { question: 'Net switching to/from JOOLA', input: {} },
    { question: 'Who is Selkirk losing customers to?', input: { brand: 'Selkirk', from: '2026-01-01' } },
  ],
  async run(input, ctx) {
    const f = await resolveFilters(input, ctx);
    const brands = await ctx.brands();
    const fallback = brands.find(b => b.is_joola) ?? brands[0];
    if (!input.brand && !fallback) throw new AppError('NOT_FOUND', 'No brands are configured.');
    const focusId = input.brand ? resolveBrands([input.brand], brands)[0]! : fallback!.brand_id;
    const names = new Map(brands.map(b => [b.brand_id, b.name]));
    const name = (id: string | null) => (id ? names.get(id) ?? id : 'Unknown');
    const toExclusive = new Date(f.to.getTime() + 86_400_000).toISOString();
    const parts: Sql[] = [
      f.includeUndated
        ? sql`(occurred_at is null or (occurred_at >= ${f.from.toISOString()}::timestamptz and occurred_at < ${toExclusive}::timestamptz))`
        : sql`occurred_at >= ${f.from.toISOString()}::timestamptz and occurred_at < ${toExclusive}::timestamptz`,
    ];
    if (f.channels) parts.push(sql`channel = any(${f.channels}::text[])`);
    const where = and(parts);
    const matrixRows = await run<{ from_id: string | null; to_id: string | null; n: number }>(ctx.db, sql`
      select from_brand_id::text as from_id, to_brand_id::text as to_id, count(*)::int as n
      from intel.v_switch_events where ${where} group by 1, 2 order by n desc`);
    const trendRows = await run<{ period: string; inflow: number; outflow: number }>(ctx.db, sql`
      select ${periodExpr(sql.ref('occurred_at'), 'month')} as period,
        count(*) filter (where to_brand_id = ${focusId}::uuid)::int as inflow,
        count(*) filter (where from_brand_id = ${focusId}::uuid)::int as outflow
      from intel.v_switch_events where ${where} and occurred_at is not null group by 1 order by 1`);
    const [g] = await run<Record<string, number>>(ctx.db, sql`
      select count(*) filter (where ${where})::int as in_range,
        count(*) filter (where ${where} and date_source = 'detected')::int as date_from_detection,
        count(*) filter (where ${where} and not has_from)::int as unknown_from,
        count(*) filter (where ${where} and not has_to)::int as unknown_to,
        count(*)::int as total, count(*) filter (where not has_date)::int as no_posted_date,
        count(*) filter (where occurred_at is null)::int as no_date_at_all,
        count(*) filter (where not has_from)::int as no_from, count(*) filter (where not has_to)::int as no_to
      from intel.v_switch_events`);
    const inflow = matrixRows.filter(r => r.to_id === focusId).reduce((a, r) => a + num(r.n), 0);
    const outflow = matrixRows.filter(r => r.from_id === focusId).reduce((a, r) => a + num(r.n), 0);
    const gaps = {
      in_range: num(g?.in_range), date_from_detection: num(g?.date_from_detection), unknown_from: num(g?.unknown_from), unknown_to: num(g?.unknown_to),
      all_time: { total: num(g?.total), no_posted_date: num(g?.no_posted_date), no_date_at_all: num(g?.no_date_at_all), no_from: num(g?.no_from), no_to: num(g?.no_to) },
    };
    const notes = [
      `All-time data gaps: ${fmt(gaps.all_time.no_posted_date)} of ${fmt(gaps.all_time.total)} events have no posted date (dated by detection instead), ${fmt(gaps.all_time.no_from)} have no "from" brand and ${fmt(gaps.all_time.no_to)} have no "to" brand.`,
    ];
    if (gaps.in_range < 30) notes.push(`Only ${fmt(gaps.in_range)} switch events in range: treat trends as anecdotal.`);
    return {
      data: {
        focus_brand: name(focusId), inflow, outflow, net: inflow - outflow,
        matrix: matrixRows.map(r => ({ from: name(r.from_id), to: name(r.to_id), value: num(r.n) })),
        trend: periodsBetween(f.from, f.to, 'month').flatMap(p => {
          const r = trendRows.find(t => t.period === p);
          return [
            { period: p, series: 'inflow' as const, value: num(r?.inflow) },
            { period: p, series: 'outflow' as const, value: num(r?.outflow) },
          ];
        }),
        gaps,
      },
      meta: meta({
        filters: { ...f.applied, brand: name(focusId) }, rows_counted: gaps.in_range,
        excluded: { ...NO_EXCLUSIONS, undated: f.includeUndated ? 0 : gaps.all_time.no_date_at_all }, notes,
        units: { value: 'switch events' },
      }, ctx),
    };
  },
  summarise: r => {
    const d = r.data;
    const topOut = d.matrix.find(m => m.from === d.focus_brand && m.to !== 'Unknown');
    const topIn = d.matrix.find(m => m.to === d.focus_brand && m.from !== 'Unknown');
    return `${d.focus_brand}: ${fmt(d.inflow)} switched in, ${fmt(d.outflow)} switched out (net ${d.net >= 0 ? '+' : ''}${d.net}).` +
      (topIn ? ` Most from ${topIn.from} (${topIn.value}).` : '') + (topOut ? ` Most lost to ${topOut.to} (${topOut.value}).` : '') +
      ` ${fmt(d.gaps.in_range)} events in range.`;
  },
});
