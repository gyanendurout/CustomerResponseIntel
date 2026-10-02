// MCP endpoint (Streamable HTTP via mcp-handler 2.x): auth → per-caller rate limit → tools (src/server/mcp-route.ts).
import { buildMcpRoute } from '@/server/mcp-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const handler = buildMcpRoute();

export { handler as GET, handler as POST, handler as DELETE };
