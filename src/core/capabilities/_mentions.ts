// Shared roll-up for product and athlete mention tools: counts per entity with 3-level sentiment and a channel split.
import { z } from 'zod';
import type { Ctx } from '../context';
import type { Filters } from '../filters';
import { and, run, sql, type Sql } from '../sql';
import { round1 } from '../platform';

export const zSentimentCounts = {
  mentions: z.number(),
  positive: z.number(),
  neutral: z.number(),
  negative: z.number(),
  unlabelled: z.number(),
  negative_pct: z.number().nullable(),
  channels: z.array(z.object({ channel: z.string(), mentions: z.number() })),
};

export interface MentionRow {
  key: string; mentions: number; positive: number; neutral: number; negative: number; unlabelled: number;
  channels: Array<{ channel: string; mentions: number }>;
}

/** WHERE for a mention view with occurred_at + channel; `brandCol` is the brand column to filter on. */
export function mentionWhere(f: Filters, brandCol: Sql, opts: { dated: boolean }): Sql {
  const toExclusive = new Date(f.to.getTime() + 86_400_000).toISOString();
  return and([
    opts.dated
      ? sql`occurred_at >= ${f.from.toISOString()}::timestamptz and occurred_at < ${toExclusive}::timestamptz`
      : sql`occurred_at is null`,
    f.brandIds ? sql`${brandCol} = any(${f.brandIds}::uuid[])` : sql`true`,
    f.channels ? sql`channel = any(${f.channels}::text[])` : sql`true`,
  ]);
}

/** Counts per `keyExpr` (a SQL expression producing one text key per entity), sorted by mentions. */
export async function rollup(ctx: Ctx, view: Sql, keyExpr: Sql, where: Sql, topN: number): Promise<MentionRow[]> {
  const counts = await run<Omit<MentionRow, 'channels'>>(ctx.db, sql`
    select ${keyExpr} as key, count(*)::int as mentions,
      count(*) filter (where intel.sentiment_3(sentiment_5) = 'positive')::int as positive,
      count(*) filter (where intel.sentiment_3(sentiment_5) = 'neutral')::int as neutral,
      count(*) filter (where intel.sentiment_3(sentiment_5) = 'negative')::int as negative,
      count(*) filter (where sentiment_5 = 'unlabelled')::int as unlabelled
    from ${view} where ${where} group by 1 order by 2 desc, 1 limit ${topN}`);
  if (!counts.length) return [];
  const keys = counts.map(c => c.key);
  const byChannel = await run<{ key: string; channel: string; n: number }>(ctx.db, sql`
    select ${keyExpr} as key, coalesce(channel, 'other') as channel, count(*)::int as n
    from ${view} where ${and([where, sql`${keyExpr} = any(${keys}::text[])`])} group by 1, 2 order by 3 desc`);
  return counts.map(c => ({ ...c, channels: byChannel.filter(b => b.key === c.key).map(b => ({ channel: b.channel, mentions: b.n })) }));
}

export const negativePct = (r: MentionRow) => {
  const labelled = r.positive + r.neutral + r.negative;
  return labelled ? round1((r.negative / labelled) * 100) : null;
};
