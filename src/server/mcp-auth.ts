// MCP authentication: a secret token, sent either as "Authorization: Bearer <token>" (Claude Code / Desktop) or as the
// last URL segment, /api/mcp/<token>, for clients that cannot send headers (the claude.ai "Add custom connector" dialog
// takes only a URL). A URL token appears in hosting request logs, so give it its own label to revoke it separately.
// MCP_TOKENS = "label:sha256hex,label2:sha256hex" (same format as API_KEYS). Tokens are never stored in plain text.
import type { AuthInfo } from '@modelcontextprotocol/server';
import { parseKeyList, verifyKey } from './auth';

const BEARER = /^Bearer\s+(.+)$/i;
const PATH_TOKEN = /\/api\/mcp\/([^/]+)\/?$/;

function presentedToken(req: Request): string | undefined {
  const header = BEARER.exec(req.headers.get('authorization') ?? '')?.[1]?.trim();
  if (header) return header;
  const segment = PATH_TOKEN.exec(new URL(req.url).pathname)?.[1];
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** Returns auth info for a valid token, else undefined. Fails closed when MCP_TOKENS is empty. */
export function verifyMcpRequest(req: Request): AuthInfo | undefined {
  const token = presentedToken(req);
  const label = verifyKey(token, parseKeyList(process.env.MCP_TOKENS));
  return label && token ? { token, clientId: label, scopes: [] } : undefined;
}

export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or invalid token. Send "Authorization: Bearer <token>" or use /api/mcp/<token>.' } }),
    { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' } },
  );
}
