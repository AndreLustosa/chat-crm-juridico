import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // Reset modules entre suites pra evitar cross-pollution de cache do
    // crmTrafficService (singleton com Map interno).
    isolate: true,
    globals: false,
  },
});
