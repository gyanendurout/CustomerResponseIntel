// Keeps docs/API.md and docs/MCP_TOOLS.md in sync with the registry.
// Regenerate with: UPDATE_DOCS=1 npx vitest run tests/docs.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiMarkdown, mcpMarkdown } from '@/server/docs';

const DOCS = join(import.meta.dirname, '..', 'docs');

describe.each([
  ['API.md', apiMarkdown],
  ['MCP_TOOLS.md', mcpMarkdown],
] as const)('%s', (file, gen) => {
  it('is up to date with the capability registry', () => {
    const path = join(DOCS, file);
    const fresh = gen();
    if (process.env.UPDATE_DOCS === '1') writeFileSync(path, fresh);
    expect(existsSync(path), `${file} missing; run with UPDATE_DOCS=1`).toBe(true);
    expect(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).toBe(fresh);
  });
});
