// GET/HEAD-only helper for Phase 0 discovery. Never issues writes.
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const BASE = env.SUPABASE_URL + '/rest/v1';
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };
export async function get(path, extra = {}) {
  const r = await fetch(BASE + path, { method: 'GET', headers: { ...H, ...extra } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path}: ${text.slice(0, 300)}`);
  return { body: text ? JSON.parse(text) : null, headers: r.headers };
}
export async function count(path) {
  const r = await fetch(BASE + path, { method: 'HEAD', headers: { ...H, Prefer: 'count=exact' } });
  if (!r.ok) return `ERR ${r.status}`;
  return Number((r.headers.get('content-range') || '*/NaN').split('/')[1]);
}
