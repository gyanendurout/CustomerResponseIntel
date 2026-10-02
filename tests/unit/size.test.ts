import { describe, expect, it } from 'vitest';
import { fitToBudget } from '@/core/size';
import type { Result } from '@/core/capability';

const baseMeta = { filters: {}, generated_at: 'x', rows_counted: 0, excluded: { undated: 0, unbranded: 0, unlabelled_sentiment: 0 }, notes: [] };

describe('fitToBudget', () => {
  it('leaves small results untouched', () => {
    const r: Result = { data: { points: [1, 2, 3] }, meta: { ...baseMeta, notes: [] } };
    expect(fitToBudget(r, 25_000)).toBe(r);
  });

  it('halves the largest arrays until under budget and says so in notes', () => {
    const big = Array.from({ length: 2000 }, (_, i) => ({ period: `2026-01-${i}`, series: 'JOOLA', value: i }));
    const r: Result = { data: { points: big, totals: [{ label: 'JOOLA', value: 1 }] }, meta: { ...baseMeta, notes: ['keep me'] } };
    const out = fitToBudget(r, 25_000);
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(25_000);
    const pts = (out.data as { points: unknown[] }).points;
    expect(pts.length).toBeLessThan(2000);
    expect((out.data as { totals: unknown[] }).totals).toHaveLength(1);
    expect(out.meta.notes[0]).toBe('keep me');
    expect(out.meta.notes.at(-1)).toMatch(/Truncated data\.points from 2,000 to \d+ entries/);
    expect(out.meta.truncated).toBe(true);
    expect(r.meta.notes).toEqual(['keep me']); // original not mutated
  });

  it('handles a top-level array', () => {
    const r: Result = { data: Array.from({ length: 3000 }, (_, i) => ({ i, pad: 'x'.repeat(20) })), meta: { ...baseMeta } };
    const out = fitToBudget(r, 10_000);
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(10_000);
    expect(out.meta.notes.at(-1)).toMatch(/Truncated data from 3,000/);
  });
});
