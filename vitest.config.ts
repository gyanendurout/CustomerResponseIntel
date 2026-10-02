import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/docs.test.ts', 'tests/unit/**/*.test.ts', 'tests/sql/**/*.test.ts', 'tests/capabilities/**/*.test.ts', 'tests/api/**/*.test.ts', 'tests/mcp/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: { provider: 'v8', include: ['src/**/*.ts'], reporter: ['text-summary', 'text'] },
  },
});
