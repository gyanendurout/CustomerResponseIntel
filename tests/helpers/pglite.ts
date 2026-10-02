// Embedded Postgres (PGlite) loaded with the real column layout of the source tables and every migration.
// Synthetic data only; no customer data is ever copied locally.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../../src/core/db';

const ROOT = join(import.meta.dirname, '..', '..');
export const MIGRATIONS_DIR = join(ROOT, 'supabase', 'sql');

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}_.+\.sql$/.test(f))
    .sort();
}

export async function createTestDb(): Promise<PGlite> {
  const pg = new PGlite();
  // Supabase roles that migrations reference.
  await pg.exec(`create role anon nologin; create role authenticated nologin;`);
  await pg.exec(readFileSync(join(ROOT, 'tests', 'fixtures', 'public-schema.sql'), 'utf8'));
  for (const f of migrationFiles()) {
    try {
      // The role migration refuses to run with its placeholder password; tests use a throwaway one.
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replaceAll('REPLACE_WITH_A_LONG_RANDOM_PASSWORD', 'test-only-password-not-a-secret-123');
      await pg.exec(sql);
    } catch (err) {
      throw new Error(`migration ${f} failed: ${(err as Error).message}`);
    }
  }
  return pg;
}

/** Adapts PGlite to the app's Db interface so capabilities run unchanged in tests. */
export function pgliteDb(pg: PGlite): Db {
  return {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const res = await pg.query<T>(text, params as unknown[]);
      return res.rows;
    },
  };
}
