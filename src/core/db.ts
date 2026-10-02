// Database access. Server-only. Pooled connections per serverless instance, to the Supavisor transaction pooler
// (port 6543), logged in as the read-only role `intel_reader`.
// Every query runs inside `BEGIN TRANSACTION READ ONLY` with `SET LOCAL statement_timeout`, so read-only and the
// timeout are enforced per transaction regardless of role settings or pooler support for startup options.
import type { Pool, PoolClient } from 'pg';

export interface Db {
  query<T>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

export class DbTimeoutError extends Error {
  constructor() {
    super('The database took too long to answer. Try a narrower date range or fewer filters.');
    this.name = 'DbTimeoutError';
  }
}

export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbConfigError';
  }
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
const MAX_STATEMENT_TIMEOUT_MS = 60_000;
const POOL_MAX = 3;
const PG_QUERY_CANCELED = '57014';

let pool: Pool | undefined;
let override: Db | undefined;

/** Tests inject a PGlite-backed Db here. */
export function setDbForTesting(db: Db | undefined): void {
  override = db;
}

export function statementTimeoutMs(raw = process.env.DB_STATEMENT_TIMEOUT_MS): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_STATEMENT_TIMEOUT_MS) : DEFAULT_STATEMENT_TIMEOUT_MS;
}

/** TLS: verified with DATABASE_CA_CERT; unverified only outside production or with explicit DATABASE_SSL_INSECURE=1. */
export function sslConfig(env: NodeJS.ProcessEnv = process.env): { ca: string; rejectUnauthorized: true } | { rejectUnauthorized: false } {
  if (env.DATABASE_CA_CERT) return { ca: env.DATABASE_CA_CERT.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  if (env.NODE_ENV === 'production' && env.DATABASE_SSL_INSECURE !== '1') {
    throw new DbConfigError('DATABASE_CA_CERT is required in production (or set DATABASE_SSL_INSECURE=1 to accept unverified TLS).');
  }
  return { rejectUnauthorized: false };
}

async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DbConfigError('DATABASE_URL is not set');
  const { default: pg } = await import('pg');
  pool = new pg.Pool({
    connectionString: url,
    max: POOL_MAX,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    ssl: sslConfig(),
  });
  return pool;
}

async function inReadOnlyTransaction<T>(client: PoolClient, text: string, params: readonly unknown[]): Promise<T[]> {
  await client.query('begin transaction read only');
  try {
    await client.query(`set local statement_timeout = ${statementTimeoutMs()}`);
    const res = await client.query(text, params as unknown[]);
    await client.query('commit');
    return res.rows as T[];
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  }
}

export function getDb(): Db {
  if (override) return override;
  return {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const p = await getPool();
      const client = await p.connect();
      try {
        return await inReadOnlyTransaction<T>(client, text, params);
      } catch (err) {
        if ((err as { code?: string }).code === PG_QUERY_CANCELED) throw new DbTimeoutError();
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
