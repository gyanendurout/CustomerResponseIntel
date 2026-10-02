// Prints the sha256 hex of a key for API_KEYS / MCP_TOKENS. Usage: node scripts/hash-key.mjs <key>
import { createHash, randomBytes } from 'node:crypto';
const key = process.argv[2] ?? randomBytes(32).toString('base64url');
if (!process.argv[2]) console.log('generated key (store it safely, it is not saved):', key);
console.log('sha256:', createHash('sha256').update(key).digest('hex'));
