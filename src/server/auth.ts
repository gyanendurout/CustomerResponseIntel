// API key verification. API_KEYS = "label:sha256hex,label2:sha256hex". Keys are never stored or logged in plain text;
// the presented key is hashed and compared in constant time against every configured hash.
import { createHash, timingSafeEqual } from 'node:crypto';

export interface KeyEntry { label: string; hash: Buffer }

const HEX64 = /^[0-9a-f]{64}$/i;
const LABEL = /^[A-Za-z0-9_.-]{1,40}$/;

export function parseKeyList(raw: string | undefined): KeyEntry[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).flatMap(entry => {
    const i = entry.indexOf(':');
    if (i < 1) return [];
    const label = entry.slice(0, i);
    const hex = entry.slice(i + 1);
    return LABEL.test(label) && HEX64.test(hex) ? [{ label, hash: Buffer.from(hex.toLowerCase(), 'hex') }] : [];
  });
}

/** Returns the key's label when valid, else null. Checks every entry so timing does not reveal which matched. */
export function verifyKey(presented: string | null | undefined, keys: readonly KeyEntry[]): string | null {
  if (!presented || keys.length === 0) return null;
  const digest = createHash('sha256').update(presented, 'utf8').digest();
  let match: string | null = null;
  for (const k of keys) {
    if (timingSafeEqual(digest, k.hash) && match === null) match = k.label;
  }
  return match;
}
