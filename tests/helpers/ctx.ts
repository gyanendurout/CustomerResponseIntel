import type { PGlite } from '@electric-sql/pglite';
import { createCtx, clearContextCache, type Ctx } from '../../src/core/context';
import { createTestDb, pgliteDb } from './pglite';
import { seed } from '../fixtures/seed';

export const TEST_NOW = new Date('2026-10-02T12:00:00Z');

export async function seededDb(): Promise<PGlite> {
  const pg = await createTestDb();
  await seed(pg);
  return pg;
}

export function testCtx(pg: PGlite): Ctx {
  clearContextCache();
  return createCtx(pgliteDb(pg), TEST_NOW);
}

// Keys/values that must never appear in any output.
const FORBIDDEN_KEYS = /^(commenter_username|username|author|handle|reviewer_name|reviewer_location|display_name|avatar(_url)?|profile_url|email|commenter_id|user_id|account_id|influencer_id|athlete_id|instagram_comment_id|youtube_comment_id|tiktok_comment_id|reddit_comment_id|reply_to_comment_id|media_urls)$/i;
const HANDLE_IN_TEXT = /(^|[^A-Za-z0-9_])@(?!user\b)[A-Za-z0-9_]{2,}/;
const REDDIT_USER_IN_TEXT = /(^|[^A-Za-z0-9_/])\/?u\/(?!user\b)[A-Za-z0-9_-]{3,20}/i;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
// Content links that embed an account handle (x.com/<handle>/status, tiktok.com/@<user>, instagram.com/<user>).
const HANDLE_IN_URL = /(x|twitter)\.com\/(?!i\/)[^/]+\/status|tiktok\.com\/@|instagram\.com\/(?!p\/|reel\/)[A-Za-z0-9_.]+\/?($|[?#])/i;
// Fixture usernames/handles that would only appear if a PII column leaked.
const FIXTURE_PII = ['bob_the_user', 'selkirk_official', 'yt_user', 'redditor1', 'tt_handle', 'pro_player', 'Jane Doe', 'John Roe', 'secret_handle', 'bob_smith', 'secret_redditor'];

/** Returns a list of PII violations found anywhere in a JSON-serialisable value. */
export function scanForPii(value: unknown, path = '$'): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) value.forEach((v, i) => out.push(...scanForPii(v, `${path}[${i}]`)));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(k)) out.push(`${path}.${k}: forbidden key`);
      out.push(...scanForPii(v, `${path}.${k}`));
    }
  } else if (typeof value === 'string') {
    if (HANDLE_IN_TEXT.test(value)) out.push(`${path}: @handle in text`);
    if (REDDIT_USER_IN_TEXT.test(value)) out.push(`${path}: u/username in text`);
    if (EMAIL_IN_TEXT.test(value)) out.push(`${path}: e-mail in text`);
    if (HANDLE_IN_URL.test(value)) out.push(`${path}: account handle in URL`);
    for (const p of FIXTURE_PII) if (value.includes(p)) out.push(`${path}: contains fixture PII '${p}'`);
  }
  return out;
}
