import { defineConfig } from 'vitest/config';

// Each test file starts its own in-memory database; on a busy PC that can take longer than vitest's 10 s default.
export default defineConfig({
  test: { hookTimeout: 60_000, testTimeout: 30_000 },
});
