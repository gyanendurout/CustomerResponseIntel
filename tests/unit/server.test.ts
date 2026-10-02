import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parseKeyList, verifyKey } from '@/server/auth';
import { RateLimiter } from '@/server/rate-limit';
import { coerceQuery } from '@/server/query';
import { z } from 'zod';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('API key auth', () => {
  const keys = parseKeyList(`dashboard:${sha('secret-one')}, ci:${sha('secret-two')}`);
  it('accepts a valid key and returns its label', () => {
    expect(verifyKey('secret-one', keys)).toBe('dashboard');
    expect(verifyKey('secret-two', keys)).toBe('ci');
  });
  it('rejects wrong, empty or missing keys', () => {
    expect(verifyKey('secret-three', keys)).toBeNull();
    expect(verifyKey('', keys)).toBeNull();
    expect(verifyKey(null, keys)).toBeNull();
    expect(verifyKey('secret-one', [])).toBeNull();
  });
  it('ignores malformed entries in API_KEYS', () => {
    expect(parseKeyList('nolabel, bad:xyz, ok:' + sha('k'))).toEqual([{ label: 'ok', hash: Buffer.from(sha('k'), 'hex') }]);
    expect(parseKeyList(undefined)).toEqual([]);
  });
});

describe('rate limiter', () => {
  it('allows up to the limit per window then blocks with retry-after', () => {
    let now = 0;
    const rl = new RateLimiter(3, 60_000, () => now);
    expect([rl.take('a'), rl.take('a'), rl.take('a')].every(r => r.ok)).toBe(true);
    const blocked = rl.take('a');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
    expect(rl.take('b').ok).toBe(true); // per key
    now = 60_001;
    expect(rl.take('a').ok).toBe(true);
  });
});

describe('query coercion', () => {
  const schema = z.object({
    brands: z.array(z.string()).optional(),
    channels: z.array(z.enum(['reddit', 'x'])).optional(),
    crisis_only: z.boolean().optional(),
    limit: z.number().int().optional(),
    q: z.string().optional(),
    brand: z.string().optional(),
  });
  it('splits comma lists, merges repeats, parses booleans and numbers', () => {
    const p = new URLSearchParams('brands=JOOLA,Selkirk&brands=CRBN&crisis_only=true&limit=10&q=a,b');
    expect(coerceQuery(schema, p)).toEqual({ brands: ['JOOLA', 'Selkirk', 'CRBN'], crisis_only: true, limit: 10, q: 'a,b' });
  });
  it('maps singular aliases to plural keys when the schema has only the plural', () => {
    const noBrand = schema.omit({ brand: true });
    expect(coerceQuery(noBrand, new URLSearchParams('brand=JOOLA&channel=reddit'))).toEqual({ brands: ['JOOLA'], channels: ['reddit'] });
    expect(coerceQuery(schema, new URLSearchParams('brand=JOOLA'))).toEqual({ brand: 'JOOLA' });
  });
  it('leaves bad values for zod to reject', () => {
    expect(coerceQuery(schema, new URLSearchParams('crisis_only=maybe&limit=abc'))).toEqual({ crisis_only: 'maybe', limit: 'abc' });
  });
});

describe('db config', async () => {
  const { sslConfig, statementTimeoutMs, DbConfigError } = await import('@/core/db');
  it('fails closed on unverified TLS in production', () => {
    expect(() => sslConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(DbConfigError);
    expect(sslConfig({ NODE_ENV: 'production', DATABASE_SSL_INSECURE: '1' } as NodeJS.ProcessEnv)).toEqual({ rejectUnauthorized: false });
    expect(sslConfig({ NODE_ENV: 'production', DATABASE_CA_CERT: 'A\nB' } as NodeJS.ProcessEnv)).toEqual({ ca: 'A\nB', rejectUnauthorized: true });
    expect(sslConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toEqual({ rejectUnauthorized: false });
  });
  it('sanitises the statement timeout', () => {
    expect(statementTimeoutMs('abc')).toBe(15_000);
    expect(statementTimeoutMs('5000')).toBe(5000);
    expect(statementTimeoutMs('999999')).toBe(60_000);
    expect(statementTimeoutMs(undefined)).toBe(15_000);
  });
});

describe('query coercion hardening', () => {
  it('treats inherited property names as unknown parameters, not schema fields', () => {
    const schema = z.object({ q: z.string().optional() });
    expect(coerceQuery(schema, new URLSearchParams('constructor=1&toString=2&__proto__=3'))).toEqual({ constructor: '1', toString: '2' });
  });
});
