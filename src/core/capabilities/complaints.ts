import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { commonFilterShape, scopedSignals } from '../filters';
import { periodExpr } from '../periods';
import { run, sql } from '../sql';
import { fetchItems, fmt, itemRef, num, prepare, toItem, zSignalItem, type ItemKey } from './_shared';

const output = z.array(z.object({
  brand: z.string(),
  keyword: z.string(),
  count: z.number(),
  kinds: z.array(z.enum(['review_category', 'crisis_keyword'])),
  trend: z.array(z.object({ period: z.string(), value: z.number() })),
  examples: z.array(zSignalItem),
}));

const EXAMPLE_TEXT_LIMIT = 280;

export const topComplaints = defineCapability({
  name: 'top_complaints',
  route: '/complaints',
  title: 'Top complaints',
  description: [
    'Top complaint keywords per brand with a monthly trend and 3 example items each. Keywords come from two sources:',
    'product-review complaint categories (e.g. delamination, dead_spot, customer_service) and social crisis keywords',
    '(the words that triggered a crisis flag); `kinds` says which.',
    'Use for "what are people complaining about"; use search_posts to read more items for one keyword.',
    'Output: data = [{brand, keyword, count, kinds, trend:[{period, value}], examples:[item]}].',
    'Example: "What are the top complaints about JOOLA paddles this quarter?"',
  ].join(' '),
  input: z.object({
    ...commonFilterShape,
    top_n: z.number().int().min(1).max(20).optional().describe('Keywords per brand. Default 5.'),
  }),
  output,
  examples: [
    { question: 'Top complaints about JOOLA this quarter', input: { brands: ['JOOLA'] } },
    { question: 'Top 3 review complaints per brand', input: { channels: ['product_review'], top_n: 3 } },
  ],
  async run(input, ctx) {
    const topN = input.top_n ?? 5;
    const { f, x, notes, brandName } = await prepare(input, ctx, true);
    const scoped = scopedSignals(f, true, { allowUndated: f.includeUndated });
    const top = await run<{ brand_id: string; keyword: string; n: number; kinds: string[] }>(ctx.db, sql`
      with kw as (
        select brand_id, lower(btrim(k)) as keyword, channel from ${scoped} s, unnest(s.complaint_keywords) k where btrim(k) <> ''
      ), agg as (
        select brand_id, keyword, count(*)::int as n,
          array_agg(distinct case when channel = 'product_review' then 'review_category' else 'crisis_keyword' end) as kinds
        from kw group by 1, 2
      )
      select brand_id::text as brand_id, keyword, n, kinds from (
        select agg.*, row_number() over (partition by brand_id order by n desc, keyword) rn from agg
      ) r where rn <= ${topN} order by brand_id, n desc, keyword`);
    if (!top.length) {
      return { data: [], meta: meta({ filters: { ...f.applied, top_n: topN }, rows_counted: 0, excluded: x.excluded, notes }, ctx) };
    }
    const pairsBrand = top.map(t => t.brand_id);
    const pairsKw = top.map(t => t.keyword);
    const pairs = sql`(select * from unnest(${pairsBrand}::uuid[], ${pairsKw}::text[]) as p(brand_id, keyword))`;
    const trend = await run<{ brand_id: string; keyword: string; period: string; n: number }>(ctx.db, sql`
      with kw as materialized (
        select s.brand_id, lower(btrim(k)) as keyword, s.occurred_at
        from ${scopedSignals(f, true, { allowUndated: false })} s, unnest(s.complaint_keywords) k where btrim(k) <> ''
      )
      select kw.brand_id::text as brand_id, kw.keyword, ${periodExpr(sql.ref('kw.occurred_at'), 'month')} as period, count(*)::int as n
      from kw join ${pairs} p on p.brand_id = kw.brand_id and p.keyword = kw.keyword
      group by 1, 2, 3 order by 3`);
    // Pick the 3 examples per (brand, keyword) on cheap columns, then load masked text for those items only.
    const exKeys = await run<ItemKey & { brand_id: string; keyword: string; rn: number }>(ctx.db, sql`
      -- MATERIALIZED: evaluate the keyword rows once. Inlined, the planner underestimates them and picks a nested loop
      -- that rescans the source tables thousands of times (51 s on real data instead of < 1 s).
      with kw as materialized (
        select s.brand_id, lower(btrim(k)) as keyword, s.source_table, s.source_row_id, s.engagement, s.occurred_at, s.signal_id
        from ${scoped} s, unnest(s.complaint_keywords) k where btrim(k) <> ''
      )
      select * from (
        select kw.brand_id::text as brand_id, kw.keyword, kw.source_table, kw.source_row_id::text as source_row_id,
          row_number() over (partition by kw.brand_id, kw.keyword order by kw.engagement desc, kw.occurred_at desc nulls last, kw.signal_id) rn
        from kw join ${pairs} p on p.brand_id = kw.brand_id and p.keyword = kw.keyword
      ) e where rn <= 3 order by brand_id, keyword, rn`);
    const items = await fetchItems(ctx, exKeys);
    const ex = exKeys.flatMap(k => {
      const it = items.get(itemRef(k));
      return it ? [{ ...it, brand_id: k.brand_id, keyword: k.keyword }] : [];
    });
    const data = top.map(t => ({
      brand: brandName(t.brand_id),
      keyword: t.keyword,
      count: num(t.n),
      kinds: [...t.kinds].sort() as Array<'review_category' | 'crisis_keyword'>,
      trend: trend.filter(r => r.brand_id === t.brand_id && r.keyword === t.keyword).map(r => ({ period: r.period, value: num(r.n) })),
      examples: ex.filter(e => e.brand_id === t.brand_id && e.keyword === t.keyword).map(e => toItem(e, brandName, EXAMPLE_TEXT_LIMIT)),
    }));
    notes.push('Social crisis keywords are the words that triggered a crisis flag, not a full complaint taxonomy.');
    return {
      data,
      meta: meta({
        filters: { ...f.applied, top_n: topN }, rows_counted: data.reduce((a, d) => a + d.count, 0), excluded: x.excluded, notes,
        units: { count: 'signals mentioning the keyword', trend: 'per month' },
      }, ctx),
    };
  },
  summarise: r => {
    if (!r.data.length) return 'No complaint keywords found for these filters.';
    const byBrand = new Map<string, string[]>();
    for (const d of r.data) byBrand.set(d.brand, [...(byBrand.get(d.brand) ?? []), `${d.keyword} (${fmt(d.count)})`]);
    return [...byBrand].slice(0, 4).map(([b, k]) => `${b}: ${k.slice(0, 3).join(', ')}`).join('; ') + '.';
  },
});
