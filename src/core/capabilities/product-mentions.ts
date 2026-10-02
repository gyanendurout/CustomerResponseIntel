import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { commonFilterShape, resolveFilters } from '../filters';
import { and, run, sql } from '../sql';
import { fmt } from './_shared';
import { mentionWhere, negativePct, rollup, zSentimentCounts } from './_mentions';

const DEFAULT_TOP = 20;

const output = z.array(z.object({ product: z.string(), brand: z.string(), ...zSentimentCounts }));

export const productMentions = defineCapability({
  name: 'product_mentions',
  route: '/product-mentions',
  title: 'Product mentions',
  description: [
    'Which paddles (catalogue products) people mention, across Instagram, YouTube, Reddit, TikTok, X comments and posts',
    'and product reviews: mentions per product with positive / neutral / negative counts, negative % (of labelled) and a',
    'channel split. brands filters by the brand that MAKES the product; products filters by product name (case-insensitive).',
    'Each source item counts once per product. Use for "which JOOLA paddles get talked about / which paddle has the most',
    'negative buzz"; use top_complaints for complaint themes and search_posts to read the items.',
    'Output: data = [{product, brand, mentions, positive, neutral, negative, unlabelled, negative_pct, channels:[{channel, mentions}]}].',
    'Example: "Which JOOLA paddles are mentioned most this quarter, and with what sentiment?"',
  ].join(' '),
  input: z.object({
    from: commonFilterShape.from,
    to: commonFilterShape.to,
    brands: commonFilterShape.brands,
    channels: commonFilterShape.channels,
    products: z.array(z.string().min(1).max(80)).max(20).optional().describe('Product names, e.g. ["Perseus"]. Default: all.'),
    top_n: z.number().int().min(1).max(100).optional().describe(`Products to return. Default ${DEFAULT_TOP}.`),
  }),
  output,
  examples: [
    { question: 'Most-mentioned paddles in the last 90 days', input: {} },
    { question: 'JOOLA paddle mentions on TikTok and Instagram since June', input: { brands: ['JOOLA'], channels: ['tiktok', 'instagram'], from: '2026-06-01' } },
  ],
  async run(input, ctx) {
    const topN = input.top_n ?? DEFAULT_TOP;
    const f = await resolveFilters({ from: input.from, to: input.to, brands: input.brands, channels: input.channels }, ctx);
    const productOk = input.products?.length
      ? sql`lower(product_name) = any(${input.products.map(p => p.toLowerCase().trim())}::text[])`
      : sql`true`;
    const where = and([mentionWhere(f, sql.ref('product_brand_id'), { dated: true }), productOk]);
    const key = sql`product_name || '|' || product_brand_id::text`;
    const [rows, undated, brands] = await Promise.all([
      rollup(ctx, sql`intel.v_product_mentions`, key, where, topN),
      run<{ n: number }>(ctx.db, sql`select count(*)::int as n from intel.v_product_mentions
        where ${and([mentionWhere(f, sql.ref('product_brand_id'), { dated: false }), productOk])}`),
      ctx.brands(),
    ]);
    const names = new Map(brands.map(b => [b.brand_id, b.name]));
    const data = rows.map(r => {
      const sep = r.key.lastIndexOf('|');
      const brandId = r.key.slice(sep + 1);
      const { key: _k, ...counts } = r;
      return { product: r.key.slice(0, sep), brand: names.get(brandId) ?? brandId, ...counts, negative_pct: negativePct(r) };
    });
    const undatedN = undated[0]?.n ?? 0;
    const notes = ['Product matching comes from the enrichment pipeline (catalogue aliases); a product named in an item counts once for that item.'];
    if (undatedN) notes.push(`${fmt(undatedN)} product mention${undatedN === 1 ? '' : 's'} with no date excluded (mostly YouTube comments).`);
    if (input.products?.length && !data.length) notes.push('No product matched those names; product names must match the catalogue display name.');
    return {
      data,
      meta: meta({
        filters: { ...f.applied, products: input.products ?? null, top_n: topN }, rows_counted: data.reduce((s, d) => s + d.mentions, 0),
        excluded: { undated: undatedN, unbranded: 0, unlabelled_sentiment: data.reduce((s, d) => s + d.unlabelled, 0) }, notes,
      }, ctx),
    };
  },
  summarise: r => {
    if (!r.data.length) return 'No product mentions match these filters.';
    return r.data.slice(0, 3).map(d => `${d.product} (${d.brand}): ${fmt(d.mentions)} mentions${d.negative_pct != null ? `, ${d.negative_pct}% negative` : ''}`).join('; ') + '.';
  },
});
