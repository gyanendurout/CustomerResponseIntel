import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { seededDb, testCtx } from '../helpers/ctx';
import { listBrands } from '@/core/capabilities/list-brands';
import { channelOverview } from '@/core/capabilities/channel-overview';
import { volumeOverTime } from '@/core/capabilities/volume';
import { shareOfVoice } from '@/core/capabilities/share-of-voice';

let pg: PGlite;
beforeAll(async () => { pg = await seededDb(); });

describe('list_brands', () => {
  it('lists JOOLA first with a fixed colour', async () => {
    const r = await listBrands.run({}, testCtx(pg));
    expect(r.data[0]).toMatchObject({ name: 'JOOLA', is_joola: true, colour: { slot: 1, light: '#2a78d6' } });
    expect(r.data).toHaveLength(3);
    expect(listBrands.summarise(r)).toContain('JOOLA + 2 competitors');
  });
});

describe('channel_overview', () => {
  it('covers full history by default and counts multi-brand items once', async () => {
    const r = await channelOverview.run({}, testCtx(pg));
    const ig = r.data.find(d => d.channel === 'instagram')!;
    expect(ig).toMatchObject({ total: 2, dated: 2, undated: 0, date_from_parent: 1 }); // igC1 counted once; reply excluded
    const yt = r.data.find(d => d.channel === 'youtube')!;
    expect(yt).toMatchObject({ total: 2, undated: 1, date_from_parent: 1 });
    expect(r.data.find(d => d.channel === 'product_review')!.total).toBe(2);
    expect(r.meta.notes[0]).toMatch(/Full history/);
  });
});

describe('volume_over_time', () => {
  it('splits by brand by default, zero-fills and computes growth', async () => {
    const r = await volumeOverTime.run({ from: '2026-09-01', to: '2026-09-30', granularity: 'month' }, testCtx(pg));
    const joola = r.data.points.filter(p => p.series === 'JOOLA');
    expect(joola).toEqual([{ period: '2026-09-01', series: 'JOOLA', value: 7, growth_pct: null }]);
    // igC1 counts for JOOLA and Selkirk; ytC2 (undated) excluded and reported.
    expect(r.meta.excluded.undated).toBe(1);
    expect(r.meta.notes.join(' ')).toMatch(/1 YouTube item excluded: no date/);
    expect(r.meta.excluded.unbranded).toBe(1); // rc3
  });

  it('split_by channel counts each item once and keeps product_review separate', async () => {
    const r = await volumeOverTime.run({ from: '2026-09-01', to: '2026-09-30', granularity: 'month', split_by: 'channel' }, testCtx(pg));
    const t = Object.fromEntries(r.data.totals.map(x => [x.label, x.value]));
    expect(t).toMatchObject({ instagram: 2, product_review: 2, reddit: 6 });
    expect(t.youtube).toBeUndefined(); // ytC1 is dated 2026-08-15 via its video
    expect(r.meta.excluded.unbranded).toBe(0);
  });

  it('day granularity growth compares adjacent days', async () => {
    const r = await volumeOverTime.run({ from: '2026-09-22', to: '2026-09-23', split_by: 'none' }, testCtx(pg));
    expect(r.data.points).toEqual([
      { period: '2026-09-22', series: 'all', value: 1, growth_pct: null },
      { period: '2026-09-23', series: 'all', value: 1, growth_pct: 0 },
    ]);
  });
});

describe('share_of_voice', () => {
  it('sums to 100% among brands', async () => {
    const r = await shareOfVoice.run({ from: '2026-09-01', to: '2026-09-30', granularity: 'month' }, testCtx(pg));
    const total = r.data.overall.reduce((a, o) => a + (o.value ?? 0), 0);
    expect(Math.round(total)).toBe(100);
    expect(shareOfVoice.summarise(r)).toMatch(/Overall share: JOOLA/);
  });
});
