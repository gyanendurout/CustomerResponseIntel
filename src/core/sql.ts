// Kysely is used purely as a SQL compiler: `sql` template values are always bound parameters; identifiers
// are only ever inserted from code-side whitelists via `ident()`. Execution goes through the Db interface.
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql, type RawBuilder } from 'kysely';
import type { Db } from './db';

const compiler = new Kysely<Record<string, never>>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: db => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

export { sql };
export type Sql = RawBuilder<unknown>;

export function compile(q: Sql): { text: string; params: readonly unknown[] } {
  const c = q.compile(compiler);
  return { text: c.sql, params: c.parameters };
}

export async function run<T>(db: Db, q: Sql): Promise<T[]> {
  const { text, params } = compile(q);
  return db.query<T>(text, params);
}

/** Inserts an identifier that MUST come from a whitelist (never user text). */
export function ident<T extends string>(allowed: readonly T[], value: T): Sql {
  if (!allowed.includes(value)) throw new Error(`identifier not allowed: ${value}`);
  return sql.ref(value);
}

/** Inserts a literal keyword that MUST come from a whitelist (e.g. date_trunc unit). */
export function keyword<T extends string>(allowed: readonly T[], value: T): Sql {
  if (!allowed.includes(value)) throw new Error(`keyword not allowed: ${value}`);
  return sql.lit(value);
}

export function and(parts: Sql[]): Sql {
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

/** ISO-8601 UTC text for a timestamptz column, stable across pg and PGlite drivers. */
export function isoText(col: Sql): Sql {
  return sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
}
