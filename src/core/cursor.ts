// Opaque keyset cursors: base64url(JSON {k: sort value | null, id: tie-breaker}). Validated on decode.
import { z } from 'zod';
import { AppError } from './errors';

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const zCursor = z.object({
  k: z.union([z.string().regex(ISO_TS), z.number().int().nonnegative(), z.null()]),
  id: z.string().regex(/^[0-9a-f]{32}$/),
  s: z.string().max(20),
});
export type Cursor = z.infer<typeof zCursor>;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, expectedSort: string): Cursor {
  try {
    const parsed = zCursor.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    if (parsed.s !== expectedSort) throw new Error('sort mismatch');
    return parsed;
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid cursor. Use the next_cursor value from the previous page with the same sort.');
  }
}
