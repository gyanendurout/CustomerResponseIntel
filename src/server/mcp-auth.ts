// MCP authentication: a secret token sent as "Authorization: Bearer <token>".
// MCP_TOKENS = "label:sha256hex,label2:sha256hex" (same format as API_KEYS). Tokens are never stored in plain text;
// one label per person or device, so a single token can be revoked by removing its entry.
import type { AuthInfo } from '@modelcontextprotocol/server';
import { parseKeyList, verifyKey } from './auth';

const BEARER = /^Bearer\s+(.+)$/i;

/** Returns auth info for a valid token, else undefined. Fails closed when MCP_TOKENS is empty. */
export function verifyMcpRequest(req: Request): AuthInfo | undefined {
  const token = BEARER.exec(req.headers.get('authorization') ?? '')?.[1]?.trim();
  const label = verifyKey(token, parseKeyList(process.env.MCP_TOKENS));
  return label && token ? { token, clientId: label, scopes: [] } : undefined;
}

export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or invalid token. Send "Authorization: Bearer <token>".' } }),
    { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' } },
  );
}
