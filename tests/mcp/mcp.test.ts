// End-to-end MCP tests: the official SDK client talks Streamable HTTP to the real Next.js route handler
// (in-process via a custom fetch), backed by PGlite. Covers auth, tool listing, every tool, errors and output shape.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { seededDb, scanForPii } from '../helpers/ctx';
import { pgliteDb } from '../helpers/pglite';
import { setDbForTesting } from '@/core/db';
import { clearContextCache } from '@/core/context';
import { CAPABILITIES } from '@/core/registry';

const TOKEN = 'inspector-token-xyz';
process.env.MCP_TOKENS = `claude-code:${createHash('sha256').update(TOKEN).digest('hex')}`;

let pg: PGlite;
let POST: (req: Request) => Promise<Response>;

const URL_MCP = 'http://localhost:3000/api/mcp';
const inProcessFetch = (url: string | URL, init?: RequestInit) => POST(new Request(url, init));

async function connect(token: string | null) {
  const client = new Client({ name: 'vitest', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
    fetch: inProcessFetch as never,
    requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : {},
  });
  await client.connect(transport);
  return client;
}

beforeAll(async () => {
  pg = await seededDb();
  setDbForTesting(pgliteDb(pg));
  clearContextCache();
  ({ POST } = await import('../../app/api/mcp/route'));
});
afterAll(() => setDbForTesting(undefined));

describe('MCP auth', () => {
  it('returns 401 when no token is sent', async () => {
    const r = await POST(new Request(URL_MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }));
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toBe('Bearer');
  });
  it('connects with the token in the URL and no header (custom connector dialog)', async () => {
    const client = new Client({ name: 'vitest', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${URL_MCP}/${TOKEN}`), { fetch: inProcessFetch as never }));
    expect((await client.listTools()).tools.length).toBe(CAPABILITIES.length);
    await client.close();
  });
  it('rejects a wrong token', async () => {
    await expect(connect('wrong')).rejects.toThrow();
  });
});

describe('MCP tools', () => {
  it('lists every capability as a read-only tool with input and output schemas', async () => {
    const client = await connect(TOKEN);
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(CAPABILITIES.map(c => c.name).sort());
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.inputSchema.type).toBe('object');
      expect(t.outputSchema?.type).toBe('object');
      expect(t.description!.length).toBeGreaterThan(150);
    }
    await client.close();
  });

  it('every tool returns structuredContent + a text summary, under 25 KB, with no PII', async () => {
    const client = await connect(TOKEN);
    for (const cap of CAPABILITIES) {
      const args = cap.examples[0]!.input as Record<string, unknown>;
      const res = await client.callTool({ name: cap.name, arguments: args });
      expect(res.isError, `${cap.name}: ${JSON.stringify(res.content)}`).toBeFalsy();
      const structured = res.structuredContent as { data: unknown; meta: { notes: string[] } };
      expect(() => cap.output.parse(structured.data), cap.name).not.toThrow();
      const text = (res.content as Array<{ type: string; text: string }>)[0]!;
      expect(text.type).toBe('text');
      expect(text.text.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(JSON.stringify(res))).toBeLessThan(25_000);
      expect(scanForPii(res), cap.name).toEqual([]);
    }
    await client.close();
  });

  it('returns helpful errors as isError results', async () => {
    const client = await connect(TOKEN);
    const res = await client.callTool({ name: 'volume_over_time', arguments: { brands: ['jola'] } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toMatch(/UNKNOWN_BRAND: Unknown brand 'jola' — did you mean JOOLA\? Valid brands:/);
    const bad = await client.callTool({ name: 'metrics', arguments: { measure: 'count', group_by: ['nope'] } });
    expect(bad.isError).toBe(true);
    await client.close();
  });

  it('answers the flexible metrics example in a single call', async () => {
    const client = await connect(TOKEN);
    const res = await client.callTool({ name: 'metrics', arguments: { measure: 'negative_pct', group_by: ['period', 'brand'], granularity: 'week', brands: ['JOOLA', 'Selkirk'], channels: ['reddit'], from: '2026-09-01' } });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { data: { rows: unknown[] } }).data.rows.length).toBeGreaterThan(0);
    await client.close();
  });
});

describe('MCP rate limit', () => {
  it('returns 429 with Retry-After once a caller exceeds the limit', async () => {
    const { withRateLimit, resetMcpRateLimiterForTesting } = await import('@/server/mcp-route');
    process.env.MCP_RATE_LIMIT_PER_MINUTE = '2';
    resetMcpRateLimiterForTesting();
    const limited = withRateLimit(async () => new Response('ok'));
    const req = () => Object.assign(new Request(URL_MCP, { method: 'POST' }), { auth: { token: 't', clientId: 'c', scopes: [] } });
    expect((await limited(req())).status).toBe(200);
    expect((await limited(req())).status).toBe(200);
    const blocked = await limited(req());
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    delete process.env.MCP_RATE_LIMIT_PER_MINUTE;
    resetMcpRateLimiterForTesting();
  });
});
