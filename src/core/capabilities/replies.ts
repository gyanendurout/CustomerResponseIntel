import { z } from 'zod';
import { defineCapability, meta, NO_EXCLUSIONS } from '../capability';
import { isoText, run, sql } from '../sql';
import { fmt, num, truncate } from './_shared';

export const MIN_REPLIES_FOR_STATS = 30;
const SAMPLE_LIMIT = 10;

const output = z.object({
  insufficient_data: z.boolean(),
  total_replies: z.number(),
  by_brand: z.array(z.object({ brand: z.string(), replies: z.number(), median_response_mins: z.number().nullable(), avg_response_mins: z.number().nullable() })),
  first_reply_at: z.string().nullable(),
  last_reply_at: z.string().nullable(),
  sample: z.array(z.object({ brand: z.string(), source_table: z.string(), replied_at: z.string().nullable(), response_time_mins: z.number().nullable(), reply_text: z.string().nullable() })),
});

export const brandReplies = defineCapability({
  name: 'brand_replies',
  route: '/replies',
  title: 'Brand replies',
  description: [
    'How often and how fast brands reply to comments. Returns insufficient_data=true while fewer than',
    `${MIN_REPLIES_FOR_STATS} replies exist (currently the reply detector has captured very few, all with 0-minute response times),`,
    'in which case treat the statistics as unreliable and say so.',
    'Output: data = {insufficient_data, total_replies, by_brand:[{brand, replies, median_response_mins, avg_response_mins}], first_reply_at, last_reply_at, sample:[...]}.',
    'Example: "How quickly does JOOLA reply to comments?"',
  ].join(' '),
  input: z.object({}),
  output,
  examples: [{ question: 'How quickly does JOOLA reply to comments?', input: {} }],
  async run(_input, ctx) {
    const byBrand = await run<{ brand: string | null; n: number; median: number | null; avg: number | null }>(ctx.db, sql`
      select b.name as brand, count(*)::int as n,
        percentile_cont(0.5) within group (order by r.response_time_mins)::float8 as median,
        round(avg(r.response_time_mins)::numeric, 1)::float8 as avg
      from intel.v_replies r left join intel.v_brands b on b.brand_id = r.brand_id group by b.name order by n desc`);
    const [span] = await run<{ first: string | null; last: string | null }>(ctx.db, sql`
      select ${isoText(sql`min(replied_at)`)} as first, ${isoText(sql`max(replied_at)`)} as last from intel.v_replies`);
    const sample = await run<{ brand: string | null; source_table: string; replied_at: string | null; response_time_mins: number | null; reply_text: string | null }>(ctx.db, sql`
      select b.name as brand, r.source_table, ${isoText(sql`r.replied_at`)} as replied_at, r.response_time_mins, r.reply_text
      from intel.v_replies r left join intel.v_brands b on b.brand_id = r.brand_id
      order by r.replied_at desc nulls last limit ${SAMPLE_LIMIT}`);
    const total = byBrand.reduce((a, b) => a + num(b.n), 0);
    const insufficient = total < MIN_REPLIES_FOR_STATS;
    const notes = insufficient
      ? [`Only ${fmt(total)} brand replies recorded (need ${MIN_REPLIES_FOR_STATS}+). The reply detector is not capturing replies reliably; do not draw conclusions from these numbers.`]
      : [];
    return {
      data: {
        insufficient_data: insufficient,
        total_replies: total,
        by_brand: byBrand.map(b => ({ brand: b.brand ?? 'Unknown', replies: num(b.n), median_response_mins: b.median == null ? null : Number(b.median), avg_response_mins: b.avg == null ? null : Number(b.avg) })),
        first_reply_at: span?.first ?? null,
        last_reply_at: span?.last ?? null,
        sample: sample.map(s => ({ brand: s.brand ?? 'Unknown', source_table: s.source_table, replied_at: s.replied_at, response_time_mins: s.response_time_mins == null ? null : num(s.response_time_mins), reply_text: truncate(s.reply_text, 280).text })),
      },
      meta: meta({ filters: {}, rows_counted: total, excluded: NO_EXCLUSIONS, notes, insufficient_data: insufficient }, ctx),
    };
  },
  summarise: r => r.data.insufficient_data
    ? `Insufficient data: only ${fmt(r.data.total_replies)} brand replies recorded, so reply speed cannot be measured reliably.`
    : r.data.by_brand.map(b => `${b.brand}: ${fmt(b.replies)} replies, median ${b.median_response_mins ?? 'n/a'} min`).join('; ') + '.',
});
