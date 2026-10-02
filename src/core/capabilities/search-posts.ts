import { z } from 'zod';
import { defineCapability, meta } from '../capability';
import { encodeCursor, decodeCursor } from '../cursor';
import { attributePredicate, brandPredicate, commonFilterShape, datePredicate } from '../filters';
import { and, run, sql, type Sql } from '../sql';
import { fetchItems, fmt, itemRef, prepare, toItem, zSignalItem, type ItemKey } from './_shared';

const SORTS = ['date', 'engagement'] as const;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Escapes LIKE wildcards so user text is matched literally. */
export function likePattern(q: string): string {
  return '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
}

const output = z.object({ items: z.array(zSignalItem) });

export const searchPosts = defineCapability({
  name: 'search_posts',
  route: '/posts',
  title: 'Search posts',
  description: [
    'Finds individual posts, comments and reviews, optionally matching a text query (q, case-insensitive substring), with all common filters.',
    'Sort by date (newest first, default; undated items only appear with include_undated=true and sort last) or engagement.',
    'Cursor-paged: pass meta.page.next_cursor back as `cursor` for the next page. limit ≤ 50; text truncated to 500 chars;',
    '@handles are masked. Each item appears once, with all brands it mentions.',
    'Use to read real examples or quotes; use the aggregate tools for counts.',
    'Output: data.items = [{item_id, channel, signal_type, brands, sentiment_5, sentiment_3, is_crisis, occurred_at, date_source, text, text_truncated, post_url, engagement, engagement_kind}].',
    'Example: "Show the most-liked negative Instagram comments about JOOLA edge guards."',
  ].join(' '),
  input: z.object({
    ...commonFilterShape,
    q: z.string().trim().min(2).max(100).optional().describe('Text to search for (substring, case-insensitive).'),
    sort: z.enum(SORTS).optional().describe('date (default) or engagement.'),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Page size, default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`),
    cursor: z.string().max(400).optional().describe('next_cursor from the previous page.'),
  }),
  output,
  examples: [
    { question: 'Most-liked negative JOOLA comments mentioning "edge guard"', input: { brands: ['JOOLA'], q: 'edge guard', sentiments: ['negative_all'], sort: 'engagement' } },
    { question: 'Latest crisis-flagged product reviews', input: { channels: ['product_review'], crisis_only: true } },
  ],
  async run(input, ctx) {
    const sort = input.sort ?? 'date';
    const limit = input.limit ?? DEFAULT_LIMIT;
    const { f, x, notes, brandName } = await prepare(input, ctx, false, { skipExclusions: Boolean(input.cursor) });
    const where = and([
      datePredicate(f),
      attributePredicate(f),
      brandPredicate(f, false),
      input.q ? sql`text ilike ${likePattern(input.q)}` : sql`true`,
    ]);
    const cursor = input.cursor ? decodeCursor(input.cursor, sort) : null;
    let after: Sql = sql`true`;
    if (cursor && sort === 'engagement') {
      after = sql`(engagement < ${Number(cursor.k)} or (engagement = ${Number(cursor.k)} and item_key < ${cursor.id}))`;
    } else if (cursor && cursor.k !== null) {
      after = sql`(occurred_at < ${String(cursor.k)}::timestamptz or (occurred_at = ${String(cursor.k)}::timestamptz and item_key < ${cursor.id}) or occurred_at is null)`;
    } else if (cursor) {
      after = sql`(occurred_at is null and item_key < ${cursor.id})`;
    }
    const order = sort === 'engagement' ? sql`engagement desc, item_key desc` : sql`occurred_at desc nulls last, item_key desc`;
    // Page on cheap per-item columns (engagement and dates are the same on every brand row of an item), then load
    // masked text for the page only. A text query (q) still has to scan masked text, by design: usernames are
    // masked before matching, so they cannot be searched for.
    const rows = await run<ItemKey & { item_key: string; occurred_raw: string | null; engagement: unknown }>(ctx.db, sql`
      with items as (
        select source_table, source_row_id, md5(source_table || ':' || source_row_id::text) as item_key,
          max(occurred_at) as occurred_at, max(engagement) as engagement
        from intel.v_signals where ${where}
        group by source_table, source_row_id
      )
      select source_table, source_row_id::text as source_row_id, item_key, engagement,
        to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as occurred_raw
      from items where ${after} order by ${order} limit ${limit + 1}`);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last
      ? encodeCursor({ k: sort === 'engagement' ? Number(last.engagement) : last.occurred_raw, id: last.item_key, s: sort })
      : null;
    const details = await fetchItems(ctx, page);
    const items = page.flatMap(k => details.get(itemRef(k)) ?? []).map(r => toItem(r, brandName));
    return {
      data: { items },
      meta: meta({
        filters: { ...f.applied, q: input.q ?? null, sort }, rows_counted: items.length, excluded: x.excluded, notes,
        page: { next_cursor: nextCursor, limit },
      }, ctx),
    };
  },
  summarise: r => {
    const n = r.data.items.length;
    if (!n) return 'No matching items.';
    const top = r.data.items[0]!;
    return `${fmt(n)} item${n === 1 ? '' : 's'} on this page${r.meta.page?.next_cursor ? ' (more available)' : ''}. Top: ${top.channel} ${top.signal_type}` +
      `${top.brands.length ? ' about ' + top.brands.join('/') : ''}, ${top.engagement} ${top.engagement_kind}, ${top.occurred_at?.slice(0, 10) ?? 'undated'}.`;
  },
});
