import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Same runtime family as Convex functions, and required by convex-test.
    environment: 'edge-runtime',
    include: ['shared/**/*.test.ts', 'convex/**/*.test.ts', 'game/**/*.test.ts'],
    // These packages load their function modules with import.meta.glob.
    server: { deps: { inline: ['convex-test', '@convex-dev/presence', '@convex-dev/batch-worker'] } },
  },
});
