// Framework-agnostic REST handler: Request -> Response. The Next.js catch-all route just delegates here.
// Flow: CORS preflight → API key → rate limit → route lookup → query coercion → zod → capability → envelope.
import { AppError } from '@/core/errors';
import { createCtx } from '@/core/context';
import { capabilityByRoute } from '@/core/registry';
import { parseKeyList, verifyKey } from './auth';
import { toError } from './errors';
import { log } from './log';
import { buildOpenApi } from './openapi';
import { coerceQuery } from './query';
import { RateLimiter } from './rate-limit';

export const API_PREFIX = '/api/v1';
const DEFAULT_RATE_LIMIT = 60;

let limiter: RateLimiter | undefined;
function getLimiter(): RateLimiter {
  limiter ??= new RateLimiter(Number(process.env.RATE_LIMIT_PER_MINUTE ?? DEFAULT_RATE_LIMIT) || DEFAULT_RATE_LIMIT);
  return limiter;
}
export function resetRateLimiterForTesting(): void { limiter = undefined; }

function baseHeaders(req: Request): Headers {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  const origin = req.headers.get('origin');
  const allowed = process.env.ALLOWED_ORIGIN;
  if (origin && allowed && origin === allowed) {
    h.set('access-control-allow-origin', allowed);
    h.set('vary', 'Origin');
    h.set('access-control-allow-headers', 'x-api-key, content-type');
    h.set('access-control-allow-methods', 'GET, OPTIONS');
    h.set('access-control-max-age', '600');
  }
  return h;
}

const json = (status: number, body: unknown, headers: Headers) => new Response(JSON.stringify(body), { status, headers });

export async function handleRest(req: Request): Promise<Response> {
  const headers = baseHeaders(req);
  const url = new URL(req.url);
  const route = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length).replace(/\/+$/, '') || '/' : url.pathname;

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return json(405, { error: { code: 'VALIDATION_ERROR', message: 'Only GET is supported.', details: null } }, headers);

  // The OpenAPI document is public so tools can discover the API.
  if (route === '/openapi.json') return json(200, buildOpenApi(url.origin), headers);

  const label = verifyKey(req.headers.get('x-api-key'), parseKeyList(process.env.API_KEYS));
  if (!label) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid x-api-key header.', details: null } }, headers);

  const rl = getLimiter().take(label);
  headers.set('x-ratelimit-remaining', String(rl.remaining));
  if (!rl.ok) {
    headers.set('retry-after', String(rl.retryAfterSec));
    return json(429, { error: { code: 'RATE_LIMITED', message: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s.`, details: null } }, headers);
  }

  const cap = capabilityByRoute(route);
  if (!cap) return json(404, { error: { code: 'NOT_FOUND', message: `Unknown route ${API_PREFIX}${route}. See ${API_PREFIX}/openapi.json.`, details: null } }, headers);

  const started = Date.now();
  try {
    const raw = coerceQuery(cap.input, url.searchParams);
    const unknown = Object.keys(raw).filter(k => !Object.hasOwn(cap.input.shape, k));
    if (unknown.length) {
      throw new AppError('VALIDATION_ERROR', `Unknown parameter(s): ${unknown.join(', ')}. Allowed: ${Object.keys(cap.input.shape).join(', ') || 'none'}.`);
    }
    const input = cap.input.parse(raw);
    const result = await cap.run(input, createCtx());
    log('info', 'rest_ok', { route, key: label, ms: Date.now() - started, rows: result.meta.rows_counted });
    return json(200, result, headers);
  } catch (err) {
    const { status, body } = toError(err, { route, key: label });
    log(status >= 500 ? 'error' : 'warn', 'rest_error', { route, key: label, status, code: body.error.code, ms: Date.now() - started });
    return json(status, body, headers);
  }
}
