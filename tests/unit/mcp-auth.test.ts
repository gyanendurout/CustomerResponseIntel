import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyMcpRequest } from '@/server/mcp-auth';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const req = (authorization?: string) => new Request('http://localhost/api/mcp', authorization ? { headers: { authorization } } : {});

afterEach(() => { delete process.env.MCP_TOKENS; });

describe('MCP token auth', () => {
  it('accepts a configured token and labels the caller', () => {
    process.env.MCP_TOKENS = `laptop:${sha('tok-a')},desktop:${sha('tok-b')}`;
    expect(verifyMcpRequest(req('Bearer tok-a'))).toEqual({ token: 'tok-a', clientId: 'laptop', scopes: [] });
    expect(verifyMcpRequest(req('bearer tok-b'))?.clientId).toBe('desktop');
  });
  it('rejects wrong, missing or non-bearer credentials', () => {
    process.env.MCP_TOKENS = `laptop:${sha('tok-a')}`;
    expect(verifyMcpRequest(req('Bearer nope'))).toBeUndefined();
    expect(verifyMcpRequest(req('Basic tok-a'))).toBeUndefined();
    expect(verifyMcpRequest(req())).toBeUndefined();
  });
  it('fails closed when no tokens are configured', () => {
    expect(verifyMcpRequest(req('Bearer tok-a'))).toBeUndefined();
  });
  it('accepts the token as the last URL segment (/api/mcp/<token>)', () => {
    process.env.MCP_TOKENS = `laptop:${sha('tok-a')}`;
    const at = (path: string) => new Request(`http://localhost${path}`);
    expect(verifyMcpRequest(at('/api/mcp/tok-a'))?.clientId).toBe('laptop');
    expect(verifyMcpRequest(at('/api/mcp/tok-a/'))?.clientId).toBe('laptop');
    expect(verifyMcpRequest(at('/api/mcp/wrong'))).toBeUndefined();
    expect(verifyMcpRequest(at('/api/mcp/%E0%A4%A'))).toBeUndefined();
    expect(verifyMcpRequest(at('/api/mcp'))).toBeUndefined();
  });
});
