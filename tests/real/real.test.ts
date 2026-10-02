// READ-ONLY integration tests against the real database (after the intel migrations are applied).
// Requires DATABASE_URL (read-only role) in .env. Skips cleanly otherwise.
// Before running, refresh the independent expectation: node scripts/expected-signals.mjs
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb, type Db } from '@/core/db';
import { createCtx, clearContextCache } from '@/core/context';
import { CAPABILITIES } from '@/core/registry';
import { CHANNELS, SENTIMENT_5, SENTIMENT_3 } from '@/core/normalise';
import { scanForPii } from '../helpers/ctx';

const ROOT = join(import.meta.dirname, '..', '..');
function loadEnv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !process.env[line.slice(0, i)]) process.env[line.slice(0, i)] = line.slice(i + 1);
  }
}
loadEnv();

let db: Db;
let ready = false;
beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  db = getDb();
  const [r] = await db.query<{ ok: boolean }>(`select to_regclass('intel.v_signals') is not null as ok`);
  ready = Boolean(r?.ok);
});

// `ready` is only known after beforeAll, so each test decides at run time whether to skip.
const live = (name: string, fn: () => Promise<void>) => it(name, async ctx => {
  if (!ready) ctx.skip();
  await fn();
});
// Wall-clock limit per tool. Includes network latency to the database, so it depends on where the tests run:
// ~4–9 s from a laptop far from us-east-1, ~1.5–3 s from Vercel iad1. Override with REAL_P95_LIMIT_MS.
const P95_LIMIT_MS = Number(process.env.REAL_P95_LIMIT_MS ?? 12_000);
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;

describe('real database (read-only)', () => {
  live('connection is read-only', async () => {
    const [r] = await db.query<{ ro: string }>(`select current_setting('transaction_read_only') as ro`);
    expect(r!.ro).toBe('on');
    await expect(db.query(`create temp table x(a int)`)).rejects.toThrow(/read-only/);
  });

  live('v_signals reconciles with the independently computed expectation', async () => {
    const expPath = join(ROOT, 'scripts', 'out', 'expected-signals.json');
    expect(existsSync(expPath), 'run node scripts/expected-signals.mjs first').toBe(true);
    const exp = JSON.parse(readFileSync(expPath, 'utf8'));
    const rows = await db.query<{ source_table: string; items: number; signals: number; raw: number; mf: number; kw: number; none: number }>(`
      select source_table, count(distinct source_row_id)::int items, count(*)::int signals,
        count(*) filter (where brand_method = 'raw')::int raw, count(*) filter (where brand_method = 'mention_facts')::int mf,
        count(*) filter (where brand_method = 'keyword')::int kw, count(*) filter (where brand_method = 'none')::int none
      from intel.v_signals group by source_table`);
    for (const r of rows) {
      const e = exp.per_source[r.source_table];
      expect(e, r.source_table).toBeTruthy();
      expect({ items: r.items, signals: r.signals, raw: r.raw, mf: r.mf, kw: r.kw, none: r.none }, r.source_table)
        .toEqual({ items: e.items, signals: e.signals, raw: e.by_method.raw, mf: e.by_method.mention_facts, kw: e.by_method.keyword, none: e.by_method.none });
    }
  });

  live('database values stay inside the TypeScript enums', async () => {
    const vals = async (col: string) => (await db.query<{ v: string }>(`select distinct ${col} as v from intel.v_signals`)).map(r => r.v);
    for (const v of await vals('channel')) expect(CHANNELS).toContain(v);
    for (const v of await vals('sentiment_5')) expect(SENTIMENT_5).toContain(v);
    for (const v of await vals('sentiment_3')) expect(SENTIMENT_3).toContain(v);
    expect(['post', 'comment', 'mention', 'review']).toEqual(expect.arrayContaining(await vals('signal_type')));
    expect(['posted', 'parent_published', 'none']).toEqual(expect.arrayContaining(await vals('date_source')));
  });

  live('topic weeks are ISO weeks: a topic is never first seen after the week it is counted in', async () => {
    // first_seen_at is the first time the topic was EVER seen (usually weeks earlier), so it bounds week_start from below.
    const [r] = await db.query<{ total: number; after: number }>(`
      select count(*)::int total, count(*) filter (where first_seen_at >= week_start + 7)::int after
      from intel.v_topic_weekly where first_seen_at is not null`);
    expect(r!.total).toBeGreaterThan(0);
    expect(r!.after).toBe(0);
  });

  live('the 1,000-row cap never truncates a count: full-history volume equals SQL count', async () => {
    clearContextCache();
    const cap = CAPABILITIES.find(c => c.name === 'volume_over_time')!;
    const res = await cap.run(cap.input.parse({ from: '2000-01-01', to: '2026-12-31', granularity: 'month', split_by: 'none' }), createCtx());
    const [r] = await db.query<{ n: number }>(`select count(distinct (source_table, source_row_id))::int n from intel.v_signals where occurred_at >= '2000-01-01' and occurred_at < '2027-01-01'`);
    expect(res.meta.rows_counted).toBe(r!.n);
    expect(r!.n).toBeGreaterThan(1000);
  });

  live('every capability works on real data, is PII-free, and p95 stays under the limit', async () => {
    const timings: Record<string, number> = {};
    for (const cap of CAPABILITIES) {
      const ms: number[] = [];
      for (let i = 0; i < 5; i++) {
        clearContextCache();
        const t = Date.now();
        const res = await cap.run(cap.input.parse(cap.examples[0]!.input), createCtx());
        ms.push(Date.now() - t);
        if (i === 0) {
          expect(() => cap.output.parse(res.data), cap.name).not.toThrow();
          expect(scanForPii(res).filter(v => !v.includes('fixture PII')), cap.name).toEqual([]);
        }
      }
      timings[cap.name] = p95(ms);
    }
    console.info('p95 ms per tool (5 runs, cold cache):', timings);
    for (const [name, t] of Object.entries(timings)) expect(t, name).toBeLessThan(P95_LIMIT_MS);
  });
});
