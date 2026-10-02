// Shared pieces for the platform tools (brand accounts, audience and content on Instagram, YouTube, X and TikTok).
// Filters reuse the common date/brand resolution; these tools read the platform views, not intel.v_signals.
import { z } from 'zod';
import type { Ctx } from './context';
import { commonFilterShape, resolveFilters, type Filters } from './filters';
import { and, run, sql, type Sql } from './sql';

export const PLATFORMS = ['instagram', 'youtube', 'x', 'tiktok'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = { instagram: 'Instagram', youtube: 'YouTube', x: 'X', tiktok: 'TikTok' };

export const platformFilterShape = {
  from: commonFilterShape.from,
  to: commonFilterShape.to,
  brands: commonFilterShape.brands,
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional()
    .describe('Platforms: instagram, youtube, x, tiktok. Default: all four.'),
};

export interface PlatformFilters { f: Filters; platforms: Platform[] }

export async function resolvePlatformFilters(
  input: { from?: string; to?: string; brands?: string[]; platforms?: Platform[]; granularity?: 'day' | 'week' | 'month' },
  ctx: Ctx,
): Promise<PlatformFilters> {
  const f = await resolveFilters({ from: input.from, to: input.to, brands: input.brands, granularity: input.granularity }, ctx);
  const platforms = input.platforms?.length ? [...new Set(input.platforms)] : [...PLATFORMS];
  return { f: { ...f, applied: { ...f.applied, platforms } }, platforms };
}

/** WHERE parts for a view with brand_id + platform columns and a timestamp column. */
export function platformWhere(pf: PlatformFilters, timeCol: Sql | null): Sql {
  const parts: Sql[] = [sql`platform = any(${pf.platforms}::text[])`];
  if (pf.f.brandIds) parts.push(sql`brand_id = any(${pf.f.brandIds}::uuid[])`);
  if (timeCol) {
    const toExclusive = new Date(pf.f.to.getTime() + 86_400_000).toISOString();
    parts.push(sql`${timeCol} >= ${pf.f.from.toISOString()}::timestamptz and ${timeCol} < ${toExclusive}::timestamptz`);
  }
  return and(parts);
}

export interface BrandAccount { handle: string; url: string }

/** The brands' own accounts (owner-approved: company accounts only), keyed by `${platform}|${brand_id}`. */
export async function brandAccounts(ctx: Ctx): Promise<Map<string, BrandAccount>> {
  const rows = await run<{ platform: string; brand_id: string; account_handle: string; account_url: string }>(ctx.db, sql`
    select platform, brand_id::text as brand_id, account_handle, account_url from intel.v_brand_accounts`);
  const out = new Map<string, BrandAccount>();
  for (const r of rows) {
    const key = `${r.platform}|${r.brand_id}`;
    if (!out.has(key)) out.set(key, { handle: r.account_handle, url: r.account_url });
  }
  return out;
}

export const round1 = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
export const round2 = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
export const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export const ENGAGEMENT_DEFINITIONS = [
  'interactions = likes + comments + shares (TikTok) + reposts (X); X comments are replies.',
  'engagement_rate_by_views = interactions / views × 100, over posts that report views (YouTube, TikTok, X, Instagram reels).',
  'engagement_rate_by_followers = average interactions per post / latest followers × 100.',
] as const;
