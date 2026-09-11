import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // ADR 008: Redis-backed specs share one local Redis. Serialize files so
    // per-test key flushing is sufficient; a userland mutex cannot beat the
    // 10s Vitest hook timeout on slower CI runners.
    fileParallelism: false,
  },
});
