// MCP endpoint with the token in the URL (/api/mcp/<token>), for clients that take only a URL, such as the
// claude.ai custom connector dialog. Same handler as /api/mcp; the token is checked in src/server/mcp-auth.ts.
import { buildMcpRoute } from '@/server/mcp-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const handler = buildMcpRoute();

export { handler as GET, handler as POST, handler as DELETE };
