// Generic contract tests run against EVERY registered capability.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { seededDb, testCtx, scanForPii } from '../helpers/ctx';
import { CAPABILITIES } from '@/core/registry';
import { AppError } from '@/core/errors';
import type { Capability } from '@/core/capability';

let pg: PGlite;
beforeAll(async () => { pg = await seededDb(); });

const MAX_BYTES = 25_000;

// One input per common filter, used alone.
const SINGLE_FILTERS: Record<string, Record<string, unknown>> = {
  from: { from: '2026-09-01' },
  to: { to: '2026-09-15' },
  brands: { brands: ['joola'] },
  channels: { channels: ['reddit'] },
  sentiments: { sentiments: ['negative_all'] },
  crisis_only: { crisis_only: true },
  granularity: { granularity: 'week' },
  include_undated: { include_undated: true },
};
const EMPTY_RANGE = { from: '2001-01-01', to: '2001-01-31' };

// Capabilities with required inputs get them merged in.
const REQUIRED: Record<string, Record<string, unknown>> = {
  compare_brands: { brands: ['JOOLA', 'Selkirk'] },
  metrics: { measure: 'count', group_by: ['brand'] },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function check(cap: Capability<any, any>, raw: Record<string, unknown>) {
  const input = cap.input.parse({ ...raw, ...(REQUIRED[cap.name] ?? {}), ...(cap.name === 'compare_brands' && raw.brands ? {} : {}) });
  const result = await cap.run(input, testCtx(pg));
  expect(() => cap.output.parse(result.data), `${cap.name} output shape`).not.toThrow();
  expect(result.meta.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(result.meta.excluded).toEqual(expect.objectContaining({ undated: expect.any(Number), unbranded: expect.any(Number), unlabelled_sentiment: expect.any(Number) }));
  expect(Array.isArray(result.meta.notes)).toBe(true);
  expect(scanForPii(result), `${cap.name} PII`).toEqual([]);
  const summary = cap.summarise(result);
  expect(typeof summary).toBe('string');
  expect(summary.length).toBeGreaterThan(0);
  expect(scanForPii(summary)).toEqual([]);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(MAX_BYTES);
  return result;
}

const filterable = (cap: { input: { shape: Record<string, unknown> } }, key: string) => key in cap.input.shape;

describe.each(CAPABILITIES.map(c => [c.name, c] as const))('%s', (_name, cap) => {
  it('has a complete description for Claude (answers, when, output, example)', () => {
    expect(cap.description.length).toBeGreaterThan(150);
    expect(cap.description).toMatch(/Output:/);
    expect(cap.description).toMatch(/Example:/);
    expect(cap.route).toMatch(/^\/[a-z-]+$/);
    expect(cap.name).toMatch(/^[a-z_]+$/);
  });

  it('works with no filters', async () => { await check(cap, {}); });

  it('works with every documented example', async () => {
    for (const ex of cap.examples) await check(cap, ex.input as Record<string, unknown>);
  });

  it('works with each common filter alone', async () => {
    for (const [key, value] of Object.entries(SINGLE_FILTERS)) {
      if (!filterable(cap, key)) continue;
      if (cap.name === 'compare_brands' && key === 'brands') continue; // needs 2+ brands; covered by REQUIRED
      await check(cap, value);
    }
  });

  it('works with an empty date range', async () => {
    if (!filterable(cap, 'from')) return;
    await check(cap, EMPTY_RANGE);
  });

  it('rejects an unknown brand with a helpful error', async () => {
    if (!filterable(cap, 'brands') && !filterable(cap, 'brand')) return;
    const bad = filterable(cap, 'brands') ? { brands: cap.name === 'compare_brands' ? ['JOOLA', 'jola2x'] : ['jola'] } : { brand: 'jola' };
    const input = cap.input.parse({ ...(REQUIRED[cap.name] ?? {}), ...bad });
    await expect(cap.run(input, testCtx(pg))).rejects.toThrow(AppError);
  });
});
