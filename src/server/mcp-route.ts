// Composes the MCP endpoint: token auth → per-token rate limit → mcp-handler.
import { createMcpHandler } from 'mcp-handler';
import { registerTools, SERVER_INFO, SERVER_INSTRUCTIONS } from './mcp';
import { unauthorizedResponse, verifyMcpRequest } from './mcp-auth';
import { RateLimiter } from './rate-limit';

const DEFAULT_MCP_RATE_LIMIT = 120;
let limiter: RateLimiter | undefined;
export function resetMcpRateLimiterForTesting(): void { limiter = undefined; }

/** Rejects callers over MCP_RATE_LIMIT_PER_MINUTE (keyed by token label). */
export function withRateLimit(next: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    limiter ??= new RateLimiter(Number(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? DEFAULT_MCP_RATE_LIMIT) || DEFAULT_MCP_RATE_LIMIT);
    const r = limiter.take(req.auth?.clientId ?? 'anonymous');
    if (!r.ok) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: `Rate limit exceeded. Retry in ${r.retryAfterSec}s.` } }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': String(r.retryAfterSec) } },
      );
    }
    return next(req);
  };
}

/** Rejects requests without a valid token; otherwise attaches req.auth for the handler and rate limiter. */
export function withTokenAuth(next: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const auth = verifyMcpRequest(req);
    if (!auth) return unauthorizedResponse();
    return next(Object.assign(req, { auth }));
  };
}

export function buildMcpRoute(): (req: Request) => Promise<Response> {
  const mcp = createMcpHandler(registerTools, { serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS });
  return withTokenAuth(withRateLimit(mcp));
}
