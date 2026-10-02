import { get } from './sb.mjs';
import { writeFileSync } from 'node:fs';
const { body } = await get('/', { Accept: 'application/openapi+json' });
writeFileSync(new URL('./out/openapi.json', import.meta.url), JSON.stringify(body, null, 2));
const defs = body.definitions || {};
console.log('tables/views:', Object.keys(defs).length);
console.log(Object.keys(defs).sort().join('\n'));
console.log('rpc:', Object.keys(body.paths).filter(p => p.startsWith('/rpc/')).join(', '));
