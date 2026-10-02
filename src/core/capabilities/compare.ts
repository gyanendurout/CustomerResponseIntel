import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { commonFilterShape, scopedSignals } from '../filters';
import { run, sql } from '../sql';
import { fmt, num, pct, prepare } from './_shared';

const output = z.array(z.object({
  brand: z.string(),
  volume: z.number(),
  share_of_voice_pct: z.number().nullable(),
  negative_pct: z.number().nullable(),
  positive_pct: z.number().nullable(),
  crisis_count: z.number(),
  top_complaint: z.object({ keyword: z.string(), count: z.number() }).nullable(),
}));

export const compareBrands = defineCapability({
  name: 'compare_brands',
  route: '/compare',
  title: 'Compare brands',
  description: [
    'Side-by-side metrics for 2–5 brands over one period: volume, share of voice (vs ALL tracked brands), negative %,',
    'positive % (of labelled items), crisis count and top complaint keyword.',
    'Use for head-to-head questions; use share_of_voice / volume_over_time for trends over time.',
    'Output: data = [{brand, volume, share_of_voice_pct, negative_pct, positive_pct, crisis_count, top_complaint:{keyword,count}|null}].',
    'Example: "Compare JOOLA, Selkirk and CRBN over the last 90 days."',
  ].join(' '),
  input: z.object({
    ...commonFilterShape,
    brands: z.array(z.string().min(1).max(60)).min(2).max(5).describe('2–5 brands to compare (names, slugs or ids).'),
  }),
  output,
  examples: [
    { question: 'Compare JOOLA, Selkirk and CRBN', input: { brands: ['JOOLA', 'Selkirk', 'CRBN'] } },
    { question: 'JOOLA vs Six Zero on Reddit since June', input: { brands: ['JOOLA', 'Six Zero'], channels: ['reddit'], from: '2026-06-01' } },
  ],
  async run(input, ctx) {
    const { f, x, notes, brandName } = await prepare(input, ctx, true);
    const rows = await run<Record<string, number | string>>(ctx.db, sql`
      select brand_id::text as brand_id, count(*)::int as volume,
        count(*) filter (where sentiment_5 <> 'unlabelled')::int as labelled,
        count(*) filter (where sentiment_3 = 'negative')::int as neg,
        count(*) filter (where sentiment_3 = 'positive')::int as pos,
        count(*) filter (where is_crisis)::int as crisis
      from ${scopedSignals(f, true)} s group by 1`);
    const [all] = await run<{ n: number }>(ctx.db, sql`select count(*)::int as n from ${scopedSignals({ ...f, brandIds: null }, true)} s`);
    const complaints = await run<{ brand_id: string; keyword: string; n: number }>(ctx.db, sql`
      select brand_id, keyword, n from (
        select a.*, row_number() over (partition by a.brand_id order by a.n desc, a.keyword) rn from (
          select s.brand_id::text as brand_id, lower(btrim(k)) as keyword, count(*)::int as n
          from ${scopedSignals(f, true)} s, unnest(s.complaint_keywords) k where btrim(k) <> '' group by 1, 2
        ) a
      ) c where rn = 1`);
    const total = num(all?.n);
    const data = (f.brandIds ?? []).map(id => {
      const r = rows.find(x => x.brand_id === id);
      const c = complaints.find(x => x.brand_id === id);
      const labelled = num(r?.labelled);
      return {
        brand: brandName(id), volume: num(r?.volume), share_of_voice_pct: pct(num(r?.volume), total),
        negative_pct: pct(num(r?.neg), labelled), positive_pct: pct(num(r?.pos), labelled), crisis_count: num(r?.crisis),
        top_complaint: c ? { keyword: c.keyword, count: num(c.n) } : null,
      };
    });
    notes.push('share_of_voice_pct is against ALL tracked brands under the same filters, not only the compared ones.');
    return {
      data,
      meta: meta({
        filters: f.applied, rows_counted: data.reduce((a, d) => a + d.volume, 0), excluded: x.excluded, notes,
        units: { volume: 'signals', share_of_voice_pct: '% of all brand mentions', negative_pct: '% of labelled items' },
        series: data.map(d => d.brand),
      }, ctx),
    };
  },
  summarise: r => r.data.map(d => `${d.brand}: ${fmt(d.volume)} mentions (${d.share_of_voice_pct ?? 0}% SoV), ${d.negative_pct ?? 'n/a'}% negative, ${d.crisis_count} crises`).join('; ') + '.',
});
