import { z } from 'zod';
import { defineCapability, meta, NO_EXCLUSIONS } from '../capability';
import { commonFilterShape, resolveFilters } from '../filters';
import { and, run, sql, type Sql } from '../sql';
import type { Filters } from '../filters';
import { fmt, num, pct, zPoint } from './_shared';

const MIN_GROWTH_BASE = 5;

const output = z.object({
  weekly: z.array(zPoint),
  fastest_growing: z.array(z.object({ topic: z.string(), last_week: z.string(), count: z.number(), prev_count: z.number(), growth_pct: z.number().nullable() })),
  peaks: z.array(z.object({ topic: z.string(), peak_week: z.string(), peak_count: z.number(), total: z.number() })),
  joola_share: z.array(z.object({ topic: z.string(), joola: z.number(), competitors: z.number(), joola_pct: z.number().nullable() })),
});

const { sentiments: _s, crisis_only: _c, granularity: _g, include_undated: _u, ...topicFilterShape } = commonFilterShape;

/** WHERE over intel.v_topic_weekly for date (week_start), brands and channels. */
export function topicWhere(f: Filters): Sql {
  const parts: Sql[] = [sql`week_start >= ${f.from.toISOString().slice(0, 10)}::date - 6`, sql`week_start <= ${f.to.toISOString().slice(0, 10)}::date`];
  if (f.brandIds) parts.push(sql`brand_id = any(${f.brandIds}::uuid[])`);
  if (f.channels) parts.push(sql`channel = any(${f.channels}::text[])`);
  return and(parts);
}

export const topicTrends = defineCapability({
  name: 'topic_trends',
  route: '/topics',
  title: 'Topic trends',
  description: [
    'Weekly topic volume (from the topic tracker; weeks start Monday) for the top topics, the fastest-growing topics',
    `(last week vs the week before, topics with at least ${MIN_GROWTH_BASE} mentions the week before), the computed peak week per topic,`,
    'and JOOLA vs competitor share per topic. Topic data covers 2026 ISO weeks 26 onward only.',
    'Use for "what are people talking about / what is rising"; use top_complaints for complaints, metrics(group_by topic) for custom cuts.',
    'Output: data = {weekly:[{period, series (topic), value}], fastest_growing:[...], peaks:[...], joola_share:[...]}.',
    'Example: "Which topics are growing fastest for JOOLA on Instagram?"',
  ].join(' '),
  input: z.object({
    ...topicFilterShape,
    top_n: z.number().int().min(1).max(25).optional().describe('Number of topics. Default 10.'),
  }),
  output,
  examples: [
    { question: 'Fastest-growing topics overall', input: {} },
    { question: 'Top topics for JOOLA on Instagram', input: { brands: ['JOOLA'], channels: ['instagram'], top_n: 5 } },
  ],
  async run(input, ctx) {
    const topN = input.top_n ?? 10;
    const f = await resolveFilters(input, ctx);
    const where = topicWhere(f);
    const top = await run<{ topic: string; total: number }>(ctx.db, sql`
      select topic, sum(mention_count)::int as total from intel.v_topic_weekly where ${where}
      group by topic order by total desc, topic limit ${topN}`);
    const topics = top.map(t => t.topic);
    const weekly = topics.length ? await run<{ period: string; topic: string; n: number }>(ctx.db, sql`
      select to_char(week_start, 'YYYY-MM-DD') as period, topic, sum(mention_count)::int as n
      from intel.v_topic_weekly where ${where} and topic = any(${topics}::text[]) group by 1, 2 order by 1`) : [];
    const peaks = topics.map(t => {
      const rows = weekly.filter(w => w.topic === t);
      const best = rows.reduce<typeof rows[number] | undefined>((a, r) => (!a || num(r.n) > num(a.n) ? r : a), undefined);
      return { topic: t, peak_week: best?.period ?? '', peak_count: num(best?.n), total: num(top.find(x => x.topic === t)?.total) };
    });
    const growth = await run<{ topic: string; last_week: string; n: number; prev: number }>(ctx.db, sql`
      with lw as (select max(week_start) as w from intel.v_topic_weekly where ${where}),
      agg as (
        select topic, sum(mention_count) filter (where week_start = (select w from lw))::int as n,
               sum(mention_count) filter (where week_start = (select w from lw) - 7)::int as prev
        from intel.v_topic_weekly where ${where} group by topic
      )
      select topic, to_char((select w from lw), 'YYYY-MM-DD') as last_week, coalesce(n, 0) as n, coalesce(prev, 0) as prev
      from agg where coalesce(prev, 0) >= ${MIN_GROWTH_BASE}
      order by (coalesce(n, 0) - prev)::float8 / prev desc, n desc limit ${topN}`);
    const share = topics.length ? await run<{ topic: string; joola: number; comp: number }>(ctx.db, sql`
      select t.topic, coalesce(sum(t.mention_count) filter (where b.is_joola), 0)::int as joola,
             coalesce(sum(t.mention_count) filter (where not b.is_joola), 0)::int as comp
      from intel.v_topic_weekly t join intel.v_brands b on b.brand_id = t.brand_id
      where ${topicWhere({ ...f, brandIds: null })} and t.topic = any(${topics}::text[]) group by t.topic`) : [];
    const notes = ['Topic counts come from the weekly topic tracker, not from v_signals, so they are not de-duplicated against other tools.'];
    if (f.brandIds) notes.push('joola_share ignores the brand filter so JOOLA can be compared with all competitors.');
    return {
      data: {
        weekly: weekly.map(w => ({ period: w.period, series: w.topic, value: num(w.n) })),
        fastest_growing: growth.map(g => ({
          topic: g.topic, last_week: g.last_week, count: num(g.n), prev_count: num(g.prev),
          growth_pct: num(g.prev) > 0 ? Math.round(((num(g.n) - num(g.prev)) / num(g.prev)) * 1000) / 10 : null,
        })),
        peaks,
        joola_share: topics.map(t => {
          const s = share.find(x => x.topic === t);
          const j = num(s?.joola), c = num(s?.comp);
          return { topic: t, joola: j, competitors: c, joola_pct: pct(j, j + c) };
        }),
      },
      meta: meta({
        filters: { ...f.applied, granularity: 'week', top_n: topN }, rows_counted: top.reduce((a, t) => a + num(t.total), 0),
        excluded: NO_EXCLUSIONS, notes, units: { value: 'topic mentions per week' }, series: topics,
      }, ctx),
    };
  },
  summarise: r => {
    if (!r.data.peaks.length) return 'No topic data in this range.';
    const top = r.data.peaks.slice(0, 3).map(p => `${p.topic} (${fmt(p.total)}, peak week of ${p.peak_week})`).join(', ');
    const g = r.data.fastest_growing[0];
    return `Top topics: ${top}.` + (g ? ` Fastest growing: ${g.topic} ${g.growth_pct != null && g.growth_pct >= 0 ? '+' : ''}${g.growth_pct}% in week of ${g.last_week}.` : '');
  },
});
