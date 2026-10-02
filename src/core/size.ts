// Keeps tool results under a byte budget (MCP aim: ~25 KB) by halving the largest arrays in `data`.
// Returns a new object; never mutates the input. Every truncation is reported in meta.notes.
import type { Result } from './capability';

export const MCP_RESULT_BUDGET_BYTES = 25_000;
const MAX_ROUNDS = 20;

type Path = Array<string | number>;

function findArrays(value: unknown, path: Path = [], out: Array<{ path: Path; length: number; bytes: number }> = []) {
  if (Array.isArray(value)) {
    out.push({ path, length: value.length, bytes: Buffer.byteLength(JSON.stringify(value)) });
    value.forEach((v, i) => { if (v && typeof v === 'object') findArrays(v, [...path, i], out); });
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findArrays(v, [...path, k], out);
  }
  return out;
}

function sliceAt(root: unknown, path: Path, keep: number): unknown {
  if (path.length === 0) return (root as unknown[]).slice(0, keep);
  const [head, ...rest] = path;
  if (Array.isArray(root)) return root.map((v, i) => (i === head ? sliceAt(v, rest, keep) : v));
  const obj = root as Record<string, unknown>;
  return { ...obj, [head as string]: sliceAt(obj[head as string], rest, keep) };
}

const size = (r: unknown) => Buffer.byteLength(JSON.stringify(r));
const label = (path: Path) => ['data', ...path].join('.');

export function fitToBudget<R extends Result>(result: R, budget = MCP_RESULT_BUDGET_BYTES): R {
  if (size(result) <= budget) return result;
  let data: unknown = result.data;
  const original = new Map<string, number>();
  for (let round = 0; round < MAX_ROUNDS && size({ data, meta: result.meta }) > budget; round++) {
    const arrays = findArrays(data).filter(a => a.length > 1).sort((a, b) => b.bytes - a.bytes);
    const target = arrays[0];
    if (!target) break;
    const key = label(target.path);
    if (!original.has(key)) original.set(key, target.length);
    data = sliceAt(data, target.path, Math.ceil(target.length / 2));
  }
  const notes = [...result.meta.notes];
  for (const [key, from] of original) {
    const now = findArrays(data).find(a => label(a.path) === key)?.length ?? 0;
    notes.push(`Truncated ${key} from ${from.toLocaleString('en-US')} to ${now.toLocaleString('en-US')} entries to keep the response small; narrow the filters or use the REST API for the full result.`);
  }
  return { ...result, data, meta: { ...result.meta, notes, truncated: true } } as R;
}
