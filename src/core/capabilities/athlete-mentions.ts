import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { commonFilterShape, resolveFilters } from '../filters';
import { and, run, sql } from '../sql';
import { fmt } from './_shared';
import { mentionWhere, negativePct, rollup, zSentimentCounts } from './_mentions';

const DEFAULT_TOP = 20;

const output = z.array(z.object({
  athlete: z.string(), sponsor_brand: z.string(), contract_type: z.string().nullable(), is_active: z.boolean(), ...zSentimentCounts,
}));

export const athleteMentions = defineCapability({
  name: 'athlete_mentions',
  route: '/athlete-mentions',
  title: 'Athlete mentions',
  description: [
    'Mentions of sponsored pro athletes (the brands\' athlete roster) in comments and posts: per athlete, the sponsoring',
    'brand, contract type, mentions, positive / neutral / negative counts, negative % and a channel split.',
    'brands filters by the SPONSORING brand. Only roster athletes are named; personal social handles are never returned.',
    'Use for "how much do people talk about JOOLA\'s athletes vs competitors\' / which athlete\'s mentions skew negative".',
    'Output: data = [{athlete, sponsor_brand, contract_type, is_active, mentions, positive, neutral, negative, unlabelled, negative_pct, channels}].',
    'Example: "Which sponsored athletes get the most mentions on Instagram?"',
  ].join(' '),
  input: z.object({
    from: commonFilterShape.from,
    to: commonFilterShape.to,
    brands: commonFilterShape.brands,
    channels: commonFilterShape.channels,
    top_n: z.number().int().min(1).max(100).optional().describe(`Athletes to return. Default ${DEFAULT_TOP}.`),
  }),
  output,
  examples: [
    { question: 'Most-mentioned sponsored athletes, last 90 days', input: {} },
    { question: 'JOOLA athletes mentioned on Instagram since May', input: { brands: ['JOOLA'], channels: ['instagram'], from: '2026-05-01' } },
  ],
  async run(input, ctx) {
    const topN = input.top_n ?? DEFAULT_TOP;
    const f = await resolveFilters({ from: input.from, to: input.to, brands: input.brands, channels: input.channels }, ctx);
    const view = sql`intel.v_athlete_mentions`;
    const key = sql`athlete_name || '|' || sponsor_brand_id::text`;
    const [rows, meta2, undated, brands] = await Promise.all([
      rollup(ctx, view, key, mentionWhere(f, sql.ref('sponsor_brand_id'), { dated: true }), topN),
      run<{ key: string; contract_type: string | null; is_active: boolean }>(ctx.db, sql`
        select distinct ${key} as key, contract_type, is_active from intel.v_athlete_mentions`),
      run<{ n: number }>(ctx.db, sql`select count(*)::int as n from intel.v_athlete_mentions
        where ${and([mentionWhere(f, sql.ref('sponsor_brand_id'), { dated: false })])}`),
      ctx.brands(),
    ]);
    const names = new Map(brands.map(b => [b.brand_id, b.name]));
    const info = new Map(meta2.map(m => [m.key, m]));
    const data = rows.map(r => {
      const sep = r.key.lastIndexOf('|');
      const brandId = r.key.slice(sep + 1);
      const { key: _k, ...counts } = r;
      return {
        athlete: r.key.slice(0, sep),
        sponsor_brand: names.get(brandId) ?? brandId,
        contract_type: info.get(r.key)?.contract_type ?? null,
        is_active: info.get(r.key)?.is_active ?? true,
        ...counts,
        negative_pct: negativePct(r),
      };
    });
    const undatedN = undated[0]?.n ?? 0;
    const notes = ['Athletes come from the sponsor roster; a mention counts once per item. Sponsor is the roster brand, not the brand being discussed.'];
    if (undatedN) notes.push(`${fmt(undatedN)} athlete mention${undatedN === 1 ? '' : 's'} with no date excluded.`);
    return {
      data,
      meta: meta({
        filters: { ...f.applied, top_n: topN }, rows_counted: data.reduce((s, d) => s + d.mentions, 0),
        excluded: { undated: undatedN, unbranded: 0, unlabelled_sentiment: data.reduce((s, d) => s + d.unlabelled, 0) }, notes,
      }, ctx),
    };
  },
  summarise: r => {
    if (!r.data.length) return 'No athlete mentions match these filters.';
    return r.data.slice(0, 3).map(d => `${d.athlete} (${d.sponsor_brand}): ${fmt(d.mentions)} mentions${d.negative_pct != null ? `, ${d.negative_pct}% negative` : ''}`).join('; ') + '.';
  },
});
