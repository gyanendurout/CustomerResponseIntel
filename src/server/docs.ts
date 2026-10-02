// Generates docs/API.md and docs/MCP_TOOLS.md from the capability registry so docs cannot drift from code.
import { z } from 'zod';
import { CAPABILITIES } from '@/core/registry';
import { commonFilterShape } from '@/core/filters';

interface Param { name: string; type: string; required: boolean; description: string }

function typeLabel(s: Record<string, unknown>): string {
  if (Array.isArray(s.enum)) return (s.enum as string[]).join(' \\| ');
  if (s.type === 'array') {
    const items = (s.items ?? {}) as Record<string, unknown>;
    return `list of ${Array.isArray(items.enum) ? (items.enum as string[]).join(' \\| ') : String(items.type ?? 'string')}`;
  }
  const range = [s.minimum !== undefined ? `≥${s.minimum}` : '', s.maximum !== undefined ? `≤${s.maximum}` : ''].filter(Boolean).join(', ');
  const fmt = s.format ? ` (${s.format})` : '';
  return `${String(s.type ?? 'any')}${fmt}${range ? ` ${range}` : ''}`;
}

function params(schema: z.ZodObject): Param[] {
  const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  return Object.entries(js.properties ?? {}).map(([name, s]) => ({
    name, type: typeLabel(s), required: (js.required ?? []).includes(name), description: String(s.description ?? '').replace(/\|/g, '\\|'),
  }));
}

const COMMON = new Set(Object.keys(commonFilterShape));

function paramTable(ps: Param[], skipCommon: boolean): string {
  const rows = ps.filter(p => !(skipCommon && COMMON.has(p.name)));
  if (!rows.length) return '_No parameters beyond the common filters._\n';
  return '| Parameter | Type | Required | Description |\n|---|---|---|---|\n' +
    rows.map(p => `| \`${p.name}\` | ${p.type} | ${p.required ? 'yes' : 'no'} | ${p.description} |`).join('\n') + '\n';
}

function query(input: Record<string, unknown>): string {
  const q = Object.entries(input).map(([k, v]) => `${k}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`).join('&');
  return q ? `?${q}` : '';
}

const HEADER = '<!-- GENERATED from src/core/registry.ts by tests/docs.test.ts. Run `UPDATE_DOCS=1 npx vitest run tests/docs.test.ts` after changing a capability. -->\n';

export function apiMarkdown(): string {
  const common = paramTable(params(z.object(commonFilterShape)), false);
  let md = HEADER + `# REST API (v1)

Base URL: \`https://<your-deployment>/api/v1\`. Machine-readable spec: \`GET /api/v1/openapi.json\` (OpenAPI 3.1, public).

## Conventions

* **Auth:** header \`x-api-key: <key>\` on every request except \`/openapi.json\`. Keys are configured as sha256 hashes in \`API_KEYS\`.
* **Method:** \`GET\` only. Lists: \`brands=JOOLA,Selkirk\` or repeated \`brands=JOOLA&brands=Selkirk\`. Singular aliases \`brand\`, \`channel\`, \`sentiment\` are accepted. Booleans: \`true\` / \`false\`. Unknown parameters are rejected (catches typos).
* **Success:** \`200 {"data": …, "meta": {filters, generated_at, rows_counted, excluded:{undated, unbranded, unlabelled_sentiment}, notes[], units?, series?, page?}}\`.
* **Failure:** \`{"error": {"code", "message", "details"}}\` with \`400 VALIDATION_ERROR | UNKNOWN_BRAND | UNSUPPORTED_COMBINATION\`, \`401 UNAUTHORIZED\`, \`404 NOT_FOUND\`, \`429 RATE_LIMITED\` (+ \`Retry-After\`), \`503 DB_TIMEOUT\`, \`500 INTERNAL\` (details logged server-side only).
* **Rate limit:** \`RATE_LIMIT_PER_MINUTE\` per key (default 60), best-effort per server instance. \`x-ratelimit-remaining\` is returned.
* **CORS:** only \`ALLOWED_ORIGIN\` (exact match) gets CORS headers.
* **Counting:** results split by brand count one *signal* per brand mentioned; all other results count each *item* once. Undated items are never placed in a period; they are reported in \`meta.excluded.undated\` and \`meta.notes\`.
* **Dates:** \`from\`/\`to\` are inclusive UTC dates. Default = last 90 days of *available data*, ending on the newest data date (not today).

## Common filters (accepted by most routes)

${common}
`;
  for (const c of CAPABILITIES) {
    const ex = c.examples[0]!;
    md += `\n## \`GET /api/v1${c.route}\` — ${c.title}\n\n${c.description}\n\n${paramTable(params(c.input), true)}
**Example** (${ex.question}):

\`\`\`bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1${c.route}${query(ex.input as Record<string, unknown>)}"
\`\`\`
`;
  }
  return md;
}

export function mcpMarkdown(): string {
  let md = HEADER + `# MCP tools

Endpoint: \`https://<your-deployment>/api/mcp\` (Streamable HTTP). All tools are **read-only**
(\`readOnlyHint: true\`). Every result has \`structuredContent = {data, meta}\` (same shape as the REST API) plus a
short text summary with the main caveats from \`meta.notes\`. Results are kept under ~25 KB; when a list has to be
shortened, \`meta.truncated = true\` and a note says so.

* **Brand names** are case-insensitive and fuzzy-matched (\`joola\`, \`Selkirk\`, \`six zero\`). Unknown names return an
  error such as *"Unknown brand 'jola' — did you mean JOOLA? Valid brands: …"*.
* **Dates** default to the last 90 days of available data.
* **Common filters:** ${[...COMMON].map(k => `\`${k}\``).join(', ')} (see docs/API.md).
* **Spike method (detect_spikes):** for each period, baseline = previous *window* periods (default 8), spike when
  value > mean + k·sd (default k = 2, population sd), at least 4 baseline periods; negative % ignores periods with fewer
  than \`min_volume\` labelled items.

| Tool | REST twin | Answers |
|---|---|---|
${CAPABILITIES.map(c => `| \`${c.name}\` | \`/api/v1${c.route}\` | ${c.title} |`).join('\n')}
`;
  for (const c of CAPABILITIES) {
    md += `\n## \`${c.name}\`\n\n${c.description}\n\n**Inputs**\n\n${paramTable(params(c.input), false)}\n**Example calls**\n\n` +
      c.examples.map(e => `* *${e.question}* → \`${JSON.stringify(e.input)}\``).join('\n') + '\n';
  }
  return md;
}
