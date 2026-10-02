// MCP server: every registry capability becomes a read-only tool. Tools call core functions directly (no HTTP hop).
// Results carry structuredContent ({data, meta}) plus a short text summary, kept under ~25 KB.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { createCtx } from '@/core/context';
import { CAPABILITIES } from '@/core/registry';
import { fitToBudget } from '@/core/size';
import { toError } from './errors';
import { log } from './log';

export const SERVER_INFO = { name: 'community-intel', version: '1.0.0' } as const;

export const SERVER_INSTRUCTIONS = [
  'Read-only social-listening analytics for JOOLA (pickleball/table tennis) and 10 competitors across Instagram, YouTube,',
  'Reddit, TikTok, X and retailer product reviews. Brand names are accepted case-insensitively (call list_brands if unsure).',
  'Dates default to the last 90 days of AVAILABLE data, not today. Always mention meta.notes caveats (e.g. undated items',
  'excluded, insufficient data) when presenting numbers. For questions no specific tool answers, use `metrics`.',
  'Start with data_health if a number looks surprising.',
].join(' ');

const metaSchema = z.looseObject({
  filters: z.record(z.string(), z.unknown()),
  generated_at: z.string(),
  rows_counted: z.number(),
  excluded: z.object({ undated: z.number(), unbranded: z.number(), unlabelled_sentiment: z.number() }),
  notes: z.array(z.string()),
});

/** Text content: the summary plus any caveats, so Claude can talk about the data without parsing JSON. */
export function summaryText(summary: string, notes: readonly string[]): string {
  const caveats = notes.slice(0, 4);
  return caveats.length ? `${summary}\nNotes: ${caveats.join(' ')}` : summary;
}

export function registerTools(server: McpServer): void {
  for (const cap of CAPABILITIES) {
    server.registerTool(
      cap.name,
      {
        title: cap.title,
        description: cap.description,
        inputSchema: cap.input,
        outputSchema: z.object({ data: cap.output, meta: metaSchema }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args: unknown) => {
        const started = Date.now();
        try {
          const input = cap.input.parse(args ?? {});
          const result = fitToBudget(await cap.run(input, createCtx()));
          log('info', 'mcp_ok', { tool: cap.name, ms: Date.now() - started, rows: result.meta.rows_counted });
          return {
            content: [{ type: 'text' as const, text: summaryText(cap.summarise(result), result.meta.notes) }],
            structuredContent: result as unknown as Record<string, unknown>,
          };
        } catch (err) {
          const { status, body } = toError(err, { tool: cap.name });
          log(status >= 500 ? 'error' : 'warn', 'mcp_error', { tool: cap.name, code: body.error.code, ms: Date.now() - started });
          return { isError: true, content: [{ type: 'text' as const, text: `${body.error.code}: ${body.error.message}` }] };
        }
      },
    );
  }
}
