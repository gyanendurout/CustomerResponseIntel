// Every adapter view must expose exactly the same columns, in the same order, with the same types,
// so a new source can be added to v_signals with one UNION ALL line.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb } from '../helpers/pglite';

const CONTRACT = [
  'source_table', 'source_row_id', 'raw_brand_id', 'channel', 'signal_type', 'sentiment_5', 'is_crisis', 'text', 'post_url',
  'engagement', 'engagement_kind', 'complaint_keywords', 'occurred_at', 'date_source', 'scraped_at',
];
// Columns that identify a person. None may appear in any intel view.
const FORBIDDEN = /username|author|handle|reviewer|commenter|avatar|profile|email|influencer_id|athlete_id|account_id|_comment_id$|^reply_to/;

let pg: PGlite;
beforeAll(async () => { pg = await createTestDb(); });

describe('adapter contract', () => {
  it('all v_src_* views share one column list and type signature', async () => {
    const { rows } = await pg.query<{ table_name: string; cols: string }>(`
      select table_name, string_agg(column_name || ':' || data_type, ',' order by ordinal_position) cols
      from information_schema.columns where table_schema = 'intel' and table_name like 'v\\_src\\_%' group by table_name`);
    expect(rows.length).toBeGreaterThanOrEqual(9);
    const first = rows[0]!.cols;
    expect(first.split(',').map(c => c.split(':')[0])).toEqual(CONTRACT);
    for (const r of rows) expect(r.cols, r.table_name).toBe(first);
  });

  it('no intel view exposes a user-identifying column', async () => {
    const { rows } = await pg.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'intel'`);
    const bad = rows.filter(r => FORBIDDEN.test(r.column_name));
    expect(bad).toEqual([]);
  });
});

describe('role migration guard', () => {
  it('refuses to run with the placeholder password', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { MIGRATIONS_DIR } = await import('../helpers/pglite');
    const fresh = new PGlite();
    await expect(fresh.exec(readFileSync(join(MIGRATIONS_DIR, '090_readonly_role.sql'), 'utf8'))).rejects.toThrow(/Set a real password/);
  });
});
