import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared/src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 15000,
    env: { NODE_ENV: 'test', DB_PATH: ':memory:' },
  },
})
