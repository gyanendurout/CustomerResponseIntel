// Turns URLSearchParams into a plain object shaped for a capability's zod input schema.
// Arrays: comma-separated and/or repeated. Booleans: "true"/"false". Numbers: numeric strings.
// Anything that does not coerce cleanly is passed through unchanged so zod reports a precise error.
import type { z } from 'zod';

type Kind = 'array' | 'boolean' | 'number' | 'other';

function kindOf(schema: z.ZodType): Kind {
  let s: z.ZodType = schema;
  // Unwrap optional / default / nullable wrappers.
  for (let i = 0; i < 5; i++) {
    const def = (s as unknown as { _zod: { def: { type: string; innerType?: z.ZodType } } })._zod.def;
    if ((def.type === 'optional' || def.type === 'default' || def.type === 'nullable') && def.innerType) s = def.innerType;
    else break;
  }
  const t = (s as unknown as { _zod: { def: { type: string } } })._zod.def.type;
  return t === 'array' ? 'array' : t === 'boolean' ? 'boolean' : t === 'number' ? 'number' : 'other';
}

const ALIASES: Record<string, string> = { brand: 'brands', channel: 'channels', sentiment: 'sentiments' };

export function coerceQuery(schema: z.ZodObject, params: URLSearchParams): Record<string, unknown> {
  const shape = schema.shape as Record<string, z.ZodType>;
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.hasOwn(shape, k);
  for (const rawKey of new Set(params.keys())) {
    if (rawKey === '__proto__') continue;
    const alias = Object.hasOwn(ALIASES, rawKey) ? ALIASES[rawKey] : undefined;
    const key = !has(rawKey) && alias && has(alias) ? alias : rawKey;
    const values = params.getAll(rawKey);
    const field = has(key) ? shape[key] : undefined;
    const kind = field ? kindOf(field) : 'other';
    if (kind === 'array') {
      const items = values.flatMap(v => v.split(',')).map(v => v.trim()).filter(Boolean);
      out[key] = [...((out[key] as string[] | undefined) ?? []), ...items];
    } else if (kind === 'boolean') {
      const v = values.at(-1)!;
      out[key] = v === 'true' ? true : v === 'false' ? false : v;
    } else if (kind === 'number') {
      const v = values.at(-1)!;
      out[key] = v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
    } else {
      out[key] = values.at(-1)!;
    }
  }
  return out;
}
