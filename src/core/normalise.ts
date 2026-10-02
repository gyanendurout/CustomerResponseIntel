// Single source of truth (TypeScript side) for channel, sentiment, granularity and brand-name rules.
// The SQL side (intel.normalise_channel / sentiment_5 / sentiment_3 in 001_intel_schema.sql) mirrors these;
// tests/sql/parity.test.ts keeps the two in sync.
import { AppError } from './errors';

export const CHANNELS = ['instagram', 'youtube', 'reddit', 'tiktok', 'x', 'product_review', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_ALIASES: Readonly<Record<string, Channel>> = {
  instagram: 'instagram', ig: 'instagram', ig_comment: 'instagram',
  youtube: 'youtube', yt: 'youtube', yt_comment: 'youtube',
  reddit: 'reddit', reddit_comment: 'reddit',
  tiktok: 'tiktok', tiktok_comment: 'tiktok',
  x: 'x', twitter: 'x', x_influencer: 'x',
  product_review: 'product_review', review: 'product_review', paddle_review: 'product_review',
};

export function normaliseChannel(raw: string | null | undefined): Channel | null {
  if (raw == null || raw.trim() === '') return null;
  return CHANNEL_ALIASES[raw.trim().toLowerCase()] ?? 'other';
}

export const SENTIMENT_5 = ['very_negative', 'negative', 'neutral', 'positive', 'very_positive', 'unlabelled'] as const;
export type Sentiment5 = (typeof SENTIMENT_5)[number];
export const SENTIMENT_3 = ['negative', 'neutral', 'positive', 'unlabelled'] as const;
export type Sentiment3 = (typeof SENTIMENT_3)[number];

/** Filter values: any 5-level value, or a 3-level group (`negative_all` = very_negative + negative). */
export const SENTIMENT_FILTER_VALUES = [...SENTIMENT_5, 'negative_all', 'positive_all'] as const;
export type SentimentFilterValue = (typeof SENTIMENT_FILTER_VALUES)[number];

export function toSentiment5(label: string | null | undefined): Sentiment5 {
  const v = label?.trim().toLowerCase();
  return (SENTIMENT_5 as readonly string[]).includes(v ?? '') ? (v as Sentiment5) : 'unlabelled';
}

export function rollupSentiment3(s5: Sentiment5): Sentiment3 {
  if (s5 === 'very_negative' || s5 === 'negative') return 'negative';
  if (s5 === 'very_positive' || s5 === 'positive') return 'positive';
  return s5;
}

export function sentimentFilterValues(values: readonly SentimentFilterValue[] | undefined): Sentiment5[] | null {
  if (!values || values.length === 0) return null;
  const out = new Set<Sentiment5>();
  for (const v of values) {
    if (v === 'negative_all') { out.add('very_negative'); out.add('negative'); }
    else if (v === 'positive_all') { out.add('positive'); out.add('very_positive'); }
    else out.add(v);
  }
  return [...out];
}

// Reddit user mentions ("u/name", "/u/name"). The database masks @handles, e-mails and links (intel.mask_pii); this
// catches Reddit's own mention style in application code, so it applies to every text field the API returns.
const REDDIT_USER = /(^|[^A-Za-z0-9_/])\/?u\/[A-Za-z0-9_-]{3,20}(?![A-Za-z0-9_-])/gi;

/** Replaces Reddit user mentions with "u/user". Pure; null stays null. */
export function maskUserMentions(text: string | null): string | null {
  return text == null ? null : text.replace(REDDIT_USER, '$1u/user');
}

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];
const DAY_MS = 86_400_000;
const MONTH_THRESHOLD_DAYS = 60;
export const DEFAULT_WINDOW_DAYS = 90;

/** Inclusive day span between two UTC dates. */
export function spanDays(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS) + 1;
}

export function resolveGranularity(from: Date, to: Date, requested?: Granularity): Granularity {
  if (requested) return requested;
  return spanDays(from, to) > MONTH_THRESHOLD_DAYS ? 'month' : 'day';
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Last 90 days of AVAILABLE data (inclusive), ending on the newest data date, not today. */
export function defaultRange(newestData: Date | null, now: Date = new Date()): { from: Date; to: Date } {
  const to = startOfUtcDay(newestData ?? now);
  return { from: new Date(to.getTime() - (DEFAULT_WINDOW_DAYS - 1) * DAY_MS), to };
}

// ---------- brands ----------

export interface BrandRecord {
  brand_id: string;
  name: string;
  slug: string;
  is_joola: boolean;
  is_active: boolean;
}

const GENERIC_WORDS = /\b(pickleball|sports?|paddles?)\b/g;
const MIN_PREFIX = 3;

function brandKey(s: string): string {
  const stripped = s.toLowerCase().replace(GENERIC_WORDS, ' ');
  const key = stripped.replace(/[^a-z0-9]/g, '');
  return key || s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

export class UnknownBrandError extends AppError {
  constructor(readonly input: string, readonly suggestion: string | undefined, validBrands: string[]) {
    const hint = suggestion ? ` — did you mean ${suggestion}?` : '.';
    super('UNKNOWN_BRAND', `Unknown brand '${input}'${hint} Valid brands: ${validBrands.join(', ')}`, { input, suggestion, valid_brands: validBrands });
    this.name = 'UnknownBrandError';
  }
}

function resolveOne(input: string, brands: readonly BrandRecord[]): string {
  const raw = input.trim();
  const byId = brands.find(b => b.brand_id.toLowerCase() === raw.toLowerCase());
  if (byId) return byId.brand_id;
  const key = brandKey(raw);
  const exact = brands.find(b => brandKey(b.name) === key || brandKey(b.slug) === key);
  if (exact) return exact.brand_id;
  if (key.length >= MIN_PREFIX) {
    const prefixed = brands.filter(b => brandKey(b.name).startsWith(key) || brandKey(b.slug).startsWith(key));
    if (prefixed.length === 1) return prefixed[0]!.brand_id;
  }
  const valid = brands.map(b => b.name).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  let best: { name: string; d: number } | undefined;
  for (const b of brands) {
    const d = Math.min(levenshtein(key, brandKey(b.name)), levenshtein(key, brandKey(b.slug)));
    if (!best || d < best.d) best = { name: b.name, d };
  }
  const threshold = Math.max(2, Math.floor(key.length / 3));
  throw new UnknownBrandError(raw, best && best.d <= threshold ? best.name : undefined, valid);
}

/** Resolves names / slugs / ids (case-insensitive) to unique brand ids, in input order. */
export function resolveBrands(inputs: readonly string[], brands: readonly BrandRecord[]): string[] {
  return [...new Set(inputs.map(i => resolveOne(i, brands)))];
}
