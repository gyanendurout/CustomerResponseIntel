import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { seededDb, scanForPii } from '../helpers/ctx';
import { pgliteDb } from '../helpers/pglite';
import { setDbForTesting } from '@/core/db';
import { clearContextCache } from '@/core/context';
import { handleRest, resetRateLimiterForTesting } from '@/server/rest';
import { CAPABILITIES } from '@/core/registry';

const KEY = 'test-key-123';
const ORIGIN = 'https://dash.example.com';
let pg: PGlite;

beforeAll(async () => {
  pg = await seededDb();
  setDbForTesting(pgliteDb(pg));
  process.env.API_KEYS = `tests:${createHash('sha256').update(KEY).digest('hex')}`;
  process.env.ALLOWED_ORIGIN = ORIGIN;
  process.env.RATE_LIMIT_PER_MINUTE = '1000';
});
afterAll(() => setDbForTesting(undefined));
beforeEach(() => { resetRateLimiterForTesting(); clearContextCache(); });

const get = (path: string, headers: Record<string, string> = { 'x-api-key': KEY }) =>
  handleRest(new Request(`http://localhost/api/v1${path}`, { headers }));

describe('REST envelope and auth', () => {
  it('rejects a missing or wrong key with 401', async () => {
    expect((await get('/brands', {})).status).toBe(401);
    const r = await get('/brands', { 'x-api-key': 'nope' });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid x-api-key header.', details: null } });
  });

  it('returns {data, meta} with security headers', async () => {
    const r = await get('/brands');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await r.json();
    expect(body.data[0].name).toBe('JOOLA');
    expect(body.meta.generated_at).toBeTruthy();
  });

  it('every capability is reachable over REST and PII-free', async () => {
    const extra: Record<string, string> = { '/compare': '?brands=JOOLA,Selkirk', '/metrics': '?measure=count&group_by=brand,channel' };
    for (const c of CAPABILITIES) {
      const r = await get(c.route + (extra[c.route] ?? ''));
      expect(r.status, c.route).toBe(200);
      expect(scanForPii(await r.json()), c.route).toEqual([]);
    }
  });

  it('parses comma lists, singular aliases and booleans', async () => {
    const r = await get('/volume?brand=joola&channel=reddit,instagram&crisis_only=false&from=2026-09-01&to=2026-09-30&granularity=month');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.meta.filters).toMatchObject({ brands: ['JOOLA'], channels: ['reddit', 'instagram'], crisis_only: false });
  });

  it('returns helpful 400s', async () => {
    const unknownBrand = await (await get('/volume?brands=jola')).json();
    expect(unknownBrand.error.code).toBe('UNKNOWN_BRAND');
    expect(unknownBrand.error.message).toMatch(/did you mean JOOLA\?/);
    const badEnum = await get('/volume?channels=myspace');
    expect(badEnum.status).toBe(400);
    expect((await badEnum.json()).error.code).toBe('VALIDATION_ERROR');
    const typo = await (await get('/volume?brnds=joola')).json();
    expect(typo.error.message).toMatch(/Unknown parameter\(s\): brnds/);
    const badDate = await (await get('/volume?from=2026-13-01')).json();
    expect(badDate.error.code).toBe('VALIDATION_ERROR');
    const reversed = await (await get('/volume?from=2026-09-30&to=2026-09-01')).json();
    expect(reversed.error.message).toMatch(/must not be after/);
    const combo = await (await get('/metrics?measure=negative_pct&group_by=topic')).json();
    expect(combo.error.code).toBe('UNSUPPORTED_COMBINATION');
  });

  it('404s unknown routes and 405s non-GET', async () => {
    expect((await get('/nope')).status).toBe(404);
    const post = await handleRest(new Request('http://localhost/api/v1/brands', { method: 'POST', headers: { 'x-api-key': KEY } }));
    expect(post.status).toBe(405);
  });

  it('rate-limits per key with Retry-After', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '2';
    resetRateLimiterForTesting();
    await get('/brands');
    await get('/brands');
    const r = await get('/brands');
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    process.env.RATE_LIMIT_PER_MINUTE = '1000';
  });
});

describe('CORS', () => {
  it('allows only the configured origin', async () => {
    const ok = await get('/brands', { 'x-api-key': KEY, origin: ORIGIN });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const bad = await get('/brands', { 'x-api-key': KEY, origin: 'https://evil.example.com' });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await handleRest(new Request('http://localhost/api/v1/volume', { method: 'OPTIONS', headers: { origin: ORIGIN } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/x-api-key/);
  });
});

describe('OpenAPI', () => {
  it('is public, 3.1, and documents every capability with its parameters', async () => {
    const r = await handleRest(new Request('http://localhost/api/v1/openapi.json'));
    expect(r.status).toBe(200);
    const doc = await r.json();
    expect(doc.openapi).toBe('3.1.0');
    for (const c of CAPABILITIES) expect(doc.paths[`/api/v1${c.route}`].get.operationId).toBe(c.name);
    const vol = doc.paths['/api/v1/volume'].get.parameters.map((p: { name: string }) => p.name);
    expect(vol).toEqual(expect.arrayContaining(['from', 'to', 'brands', 'channels', 'sentiments', 'crisis_only', 'granularity', 'include_undated', 'split_by']));
    expect(doc.components.securitySchemes.apiKey).toEqual({ type: 'apiKey', in: 'header', name: 'x-api-key' });
  });
});
