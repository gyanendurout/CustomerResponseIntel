// Per-request context shared by every capability. Brands and the newest data date are cached per instance.
import { getDb, type Db } from './db';
import type { BrandRecord } from './normalise';
import { run, sql } from './sql';

const CACHE_TTL_MS = 5 * 60_000;

export interface Ctx {
  db: Db;
  now: Date;
  brands(): Promise<BrandRecord[]>;
  newestDataDate(): Promise<Date | null>;
}

interface Cached<T> { value: T; at: number }
let brandCache: Cached<BrandRecord[]> | undefined;
let newestCache: Cached<Date | null> | undefined;

export function clearContextCache(): void {
  brandCache = undefined;
  newestCache = undefined;
}

export function createCtx(db: Db = getDb(), now: Date = new Date()): Ctx {
  const fresh = (c: Cached<unknown> | undefined) => c !== undefined && Date.now() - c.at < CACHE_TTL_MS;
  return {
    db,
    now,
    async brands() {
      if (fresh(brandCache)) return brandCache!.value;
      const rows = await run<BrandRecord>(db, sql`
        select brand_id::text as brand_id, name, slug, is_joola, is_active from intel.v_brands order by name`);
      brandCache = { value: rows, at: Date.now() };
      return rows;
    },
    async newestDataDate() {
      if (fresh(newestCache)) return newestCache!.value;
      // Guard against bogus future-dated rows pulling the default window forward.
      const [r] = await run<{ d: string | null }>(db, sql`
        select to_char(max(occurred_at) at time zone 'UTC', 'YYYY-MM-DD') as d
        from intel.v_signals where occurred_at <= ${now.toISOString()}::timestamptz + interval '1 day'`);
      const value = r?.d ? new Date(r.d + 'T00:00:00Z') : null;
      newestCache = { value, at: Date.now() };
      return value;
    },
  };
}
