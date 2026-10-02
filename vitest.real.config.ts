import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Read-only integration tests against the real database. Requires DATABASE_URL in .env.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['tests/real/**/*.test.ts'], testTimeout: 600_000, hookTimeout: 120_000, fileParallelism: false },
});
